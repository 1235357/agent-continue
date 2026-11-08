import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let owner, stopping = false, closing;
  const stop = () => {
    stopping = true;
    if (owner && !closing) {
      closing = owner.close().catch(() => { process.exitCode = 1; process.stderr.write('device_server_stop_unconfirmed\n'); });
    }
  };
  try {
    const [mode, ...args] = process.argv.slice(2);
    const serving = mode === 'serve';
    const expected = serving ? ['--state-dir'] : mode === 'request' ? ['--state-dir', '--id', '--action'] : [];
    if (!expected.length || args.length !== expected.length * 2) throw new Error('invalid_device_server_arguments');
    const values = new Map();
    for (let i = 0; i < args.length; i += 2) {
      if (!expected.includes(args[i]) || values.has(args[i])) throw new Error('invalid_device_server_arguments');
      values.set(args[i], args[i + 1]);
    }
    if (serving) { process.on('SIGTERM', stop); process.on('SIGINT', stop); }
    const { readServerBinding, startServerOwner, sendDeviceRequest } = await import('./device-owner.mjs');
    const { validateDeviceRequest } = await import('./device-operations.mjs');
    const root = values.get('--state-dir');
    if (mode === 'request') {
      const request = validateDeviceRequest({ version: 1, id: values.get('--id'), action: values.get('--action') });
      const binding = readServerBinding(root);
      const response = await sendDeviceRequest(binding, request);
      binding.assertCurrent();
      process.stdout.write(JSON.stringify(response) + '\n');
      if (response.ok !== true) process.exitCode = 1;
    } else if (!stopping) {
      owner = await startServerOwner(root);
      if (stopping) { stop(); await closing; }
      else process.stdout.write(JSON.stringify({ version: 1, status: 'listening' }) + '\n');
    }
  } catch {
    process.exitCode = 1;
    process.stderr.write('device_server_unavailable\n');
  }
}
