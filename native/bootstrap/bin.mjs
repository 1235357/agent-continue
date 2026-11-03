#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BOOTSTRAP_VERSION } from './payload-layout.mjs';
import { stageRuntime } from './bootstrap.mjs';

const codes = new Set(['consent_required', 'payload_invalid', 'invalid_install_path', 'destination_exists', 'npm_unavailable',
  'dependency_acquisition_failed', 'acquisition_exit_unconfirmed', 'provider_verification_failed', 'receipt_write_failed', 'bootstrap_failed', 'invalid_arguments']);

export async function main(args) {
  if (args.length === 1 && args[0] === 'help') return { ok: true, commands: ['help', 'version', 'stage'] };
  if (args.length === 1 && args[0] === 'version') return { ok: true, version: BOOTSTRAP_VERSION };
  if (args[0] !== 'stage' || ![5, 7].includes(args.length)) throw new Error('invalid_arguments');
  const options = new Map();
  for (let index = 1; index < args.length; index += 2) {
    if (!['--install-dir', '--consent', '--offline-cache'].includes(args[index]) || options.has(args[index]) ||
        typeof args[index + 1] !== 'string' || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('invalid_arguments');
    options.set(args[index], args[index + 1]);
  }
  if (!options.has('--install-dir') || !options.has('--consent')) throw new Error('invalid_arguments');
  const controller = new AbortController(), cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    const receipt = await stageRuntime({ installDir: options.get('--install-dir'), consent: options.get('--consent'), signal: controller.signal,
      ...(options.has('--offline-cache') ? { offlineCache: options.get('--offline-cache') } : {}) });
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
