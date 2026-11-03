#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BOOTSTRAP_VERSION } from './payload-layout.mjs';
import { stageRuntime } from './bootstrap.mjs';
import { acquireClient, validateClientInput } from './client-acquisition.mjs';
import { setupDevice } from './device-setup.mjs';

const codes = new Set(['consent_required', 'payload_invalid', 'invalid_install_path', 'destination_exists', 'npm_unavailable',
  'dependency_acquisition_failed', 'acquisition_exit_unconfirmed', 'provider_verification_failed', 'receipt_write_failed', 'bootstrap_failed', 'invalid_arguments',
  'provider_stage_invalid', 'unsupported_tunnel_platform', 'client_input_invalid', 'client_exists',
  'client_acquisition_failed', 'client_archive_invalid', 'client_verification_failed', 'client_receipt_failed',
  'setup_request_invalid', 'setup_target_mismatch', 'setup_input_invalid', 'setup_configuration_failed',
  'setup_receipt_failed', 'setup_cancelled']);

export async function main(args) {
  if (args.length === 1 && args[0] === 'help') return { ok: true, commands: ['help', 'version', 'stage', 'acquire', 'setup'] };
  if (args.length === 1 && args[0] === 'version') return { ok: true, version: BOOTSTRAP_VERSION };
  const combined = args[0] === 'acquire';
  const setup = args[0] === 'setup';
  if ((!combined && !setup && args[0] !== 'stage') || !(setup ? [11, 13, 15] : combined ? [5, 7, 9] : [5, 7]).includes(args.length)) throw new Error('invalid_arguments');
  const allowed = ['--install-dir', '--consent', '--offline-cache', ...(combined || setup ? ['--tunnel-archive'] : []),
    ...(setup ? ['--setup-request', '--tunnel-id', '--runtime-key-file'] : [])];
  const options = new Map();
  for (let index = 1; index < args.length; index += 2) {
    if (!allowed.includes(args[index]) || options.has(args[index]) ||
        typeof args[index + 1] !== 'string' || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('invalid_arguments');
    options.set(args[index], args[index + 1]);
  }
  if (!options.has('--install-dir') || !options.has('--consent') ||
      (setup && ['--setup-request', '--tunnel-id', '--runtime-key-file'].some(key => !options.has(key)))) throw new Error('invalid_arguments');
  const controller = new AbortController(), cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    if (setup) return { ok: true, ...await setupDevice({
      installDir: options.get('--install-dir'), consent: options.get('--consent'),
      setupRequestFile: options.get('--setup-request'), tunnelId: options.get('--tunnel-id'),
      runtimeKeyFile: options.get('--runtime-key-file'), signal: controller.signal,
      ...(options.has('--offline-cache') ? { offlineCache: options.get('--offline-cache') } : {}),
      ...(options.has('--tunnel-archive') ? { offlineArchive: options.get('--tunnel-archive') } : {}),
    }) };
    const clientOptions = { installDir: options.get('--install-dir'), consent: options.get('--consent'), signal: controller.signal,
      ...(options.has('--tunnel-archive') ? { offlineArchive: options.get('--tunnel-archive') } : {}) };
    if (combined) validateClientInput(clientOptions);
    const staged = await stageRuntime({ installDir: options.get('--install-dir'), consent: combined ? 'acquire-provider' : options.get('--consent'), signal: controller.signal,
      ...(options.has('--offline-cache') ? { offlineCache: options.get('--offline-cache') } : {}) });
    const receipt = combined ? await acquireClient(clientOptions) : staged;
    return { ok: true, ...receipt };
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}

let direct = false;
try { direct = Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { /* Importing the library does not run it. */ }
if (direct) {
  try { process.stdout.write(JSON.stringify(await main(process.argv.slice(2))) + '\n'); }
  catch (error) {
    process.exitCode = 1;
    process.stdout.write(JSON.stringify({ ok: false, error: codes.has(error.message) ? error.message : 'bootstrap_failed' }) + '\n');
  }
}
