import path from 'node:path';

const commands = new Map([
  ['prepare', new Set(['--state-dir', '--consent'])],
  ['configure', new Set(['--state-dir', '--tunnel-id', '--runtime-key-file', '--tunnel-client'])],
  ['inspect', new Set(['--state-dir'])],
]);

function fail() { throw new Error('setup_failed'); }

function parse(args) {
  const command = args[0];
  const allowed = commands.get(command);
  if (!allowed || args.length !== 1 + allowed.size * 2) fail();
  const options = new Map();
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!allowed.has(flag) || options.has(flag) || !value || value.startsWith('--') || value.includes('\0')) fail();
    options.set(flag, value);
  }
  for (const flag of ['--state-dir', '--runtime-key-file', '--tunnel-client']) {
    if (options.has(flag) && !path.isAbsolute(options.get(flag))) fail();
  }
  if (command === 'prepare' && options.get('--consent') !== 'full-account') fail();
  return { command, options };
}

async function main(args) {
  const { command, options } = parse(args);
  const root = options.get('--state-dir');
  // Fallible local imports must stay inside the sanitized top-level boundary.
  if (command === 'prepare') {
    const { prepareState } = await import('./runtime.mjs');
    const result = prepareState(root, { consent: 'full-account' });
    if (!result || result.prepared !== true || result.activated !== false ||
        result.protectedInstallationVerified !== false) fail();
    return { ok: true, prepared: true, activated: false };
  }
  if (command === 'configure') {
    const { writeTunnelProfile } = await import('./profile.mjs');
    const result = writeTunnelProfile(root, {
      tunnelId: options.get('--tunnel-id'),
      runtimeKeyFile: options.get('--runtime-key-file'),
      tunnelExecutable: options.get('--tunnel-client'),
    });
    if (!result || result.configured !== true || result.activated !== false ||
        result.authenticationVerified !== false) fail();
    return { ok: true, configured: true, activated: false, authenticationVerified: false };
  }
  const { inspectTunnelProfile } = await import('./profile.mjs');
  const result = inspectTunnelProfile(root);
  if (!result || typeof result.configured !== 'boolean' ||
      result.activation !== 'not-observed' || result.authenticationVerified !== false) fail();
  return { ok: true, configured: result.configured, activation: 'not-observed', authenticationVerified: false };
}

try {
  process.stdout.write(JSON.stringify(await main(process.argv.slice(2))) + '\n');
} catch {
  process.exitCode = 1;
  process.stdout.write(JSON.stringify({ ok: false, error: 'setup_failed' }) + '\n');
}
