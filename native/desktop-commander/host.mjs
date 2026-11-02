import process from 'node:process';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

async function main() {
  // All fallible local imports belong inside the sanitized launch boundary.
  const { buildHostLaunch, readState, validateConfig, verifyUpstream } = await import('./runtime.mjs');
  const { wrapWindowsChildren } = await import('./windows-child.mjs');
  if (process.argv.length !== 4 || process.argv[2] !== '--state-dir') throw new Error('invalid_arguments');
  const root = process.argv[3];
  const launch = buildHostLaunch(root);
  for (const key of Object.keys(process.env)) if (!(key in launch.env)) delete process.env[key];
  Object.assign(process.env, launch.env);
  process.chdir(launch.cwd);
  verifyUpstream();
  if (process.platform === 'win32') { wrapWindowsChildren(childProcess); syncBuiltinESMExports(); }
  globalThis.disableOnboarding = true;
  const upstream = new URL('./node_modules/@wonderwhy-er/desktop-commander/dist/', import.meta.url);
  const { FilteredStdioServerTransport } = await import(new URL('custom-stdio.js', upstream));
  const transport = new FilteredStdioServerTransport();
  globalThis.mcpTransport = transport;
  // Load the server root first: upstream config/capture modules form an ESM cycle.
  const { server, flushDeferredMessages } = await import(new URL('server.js', upstream));
  const { configManager } = await import(new URL('config-manager.js', upstream));
  await configManager.loadConfig();
  validateConfig(await configManager.getConfig());
  readState(root);
  server.oninitialized = () => { transport.enableNotifications(); flushDeferredMessages(); };
  let closing = false;
  async function close(code) {
    if (closing) return;
    closing = true;
    const timer = setTimeout(() => process.exit(code), 1500);
    timer.unref();
    await server.close().catch(() => {});
    process.exit(code);
  }
  process.stdin.once('end', () => void close(0));
  process.once('SIGINT', () => void close(0));
  process.once('SIGTERM', () => void close(0));
  await server.connect(transport);
}

main().catch(() => {
  // Never print paths, environment, raw upstream errors or stacks at the launch boundary.
  process.stderr.write('agent_continue_native_start_failed\n');
  process.exit(1);
});
