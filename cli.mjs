#!/usr/bin/env node
// npm bin entry: `npx agent-continue setup`. A thin, safe shell over
// native/bootstrap. The default action is a read-only plan; execution keeps the
// existing --consent gates of the bootstrap commands.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from './native/bootstrap/bin.mjs';
import { isManagerOperationFailure } from './native/bootstrap/device-setup.mjs';

const OS = { win32: 'windows', darwin: 'macos', linux: 'linux' };
const ARCH = { x64: 'x64', arm64: 'arm64', ia32: 'ia32' };

export function requireSupportedNode(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match || Number(match[1]) < 22 || Number(match[1]) === 22 && Number(match[2]) < 13) {
    throw new Error('node_version_too_old');
  }
}

export function installationFailureCode(error) {
  if (error?.killed || error?.signal || error?.code === 'ETIMEDOUT' || error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'local_install_unconfirmed';
  const safe = new Set(['install_file_missing', 'setup_request_invalid', 'invalid_extension_id',
    'setup_identity_mismatch', 'node_not_found', 'node_version_too_old', 'invalid_install_root',
    'native_builder_missing', 'native_build_failed', 'native_registration_failed', 'consent_required',
    'destination_exists', 'manager_start_unconfirmed', 'manager_operation_receipt_invalid', 'node_archive_digest_mismatch',
    'node_archive_invalid', 'node_provision_existing_invalid', 'node_provision_invalid',
    'dependency_acquisition_failed', 'acquisition_exit_unconfirmed', 'provider_verification_failed',
    'setup_configuration_failed', 'setup_receipt_failed', 'setup_cancelled', 'native_manifest_invalid',
    'client_acquisition_failed', 'client_verification_failed', 'client_archive_invalid',
    'client_receipt_failed', 'npm_unavailable', 'uninstall_inspection_failed', 'uninstall_inspection_unavailable', 'native_release_unavailable',
    'native_release_invalid', 'native_release_signature_invalid', 'native_release_node_mismatch',
    'native_release_payload_mismatch', 'native_release_destination_exists',
    'native_release_consent_required', 'native_release_preparation_failed']);
  const match = typeof error?.stderr === 'string' && /^agent_continue_install_failed: ([a-z0-9_]+)$/.exec(error.stderr.trim());
  return match && (safe.has(match[1]) || /^bootstrap_failed_exit_[0-9]{1,10}$/.test(match[1])) ? match[1] : 'local_install_failed';
}

export function installationOperationFailure(error) {
  if (error?.code !== 1 || error.killed || error.signal || typeof error.stdout !== 'string' ||
      error.stdout.length > 1024) return null;
  try {
    const value = JSON.parse(error.stdout);
    return isManagerOperationFailure(value) ? value : null;
  } catch { return null; }
}

function defaultRoot() {
  const home = os.homedir();
  if (OS[process.platform] === 'windows') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'AgentContinue');
  if (OS[process.platform] === 'macos') return path.join(home, 'Library', 'Application Support', 'AgentContinue');
  return path.join(home, '.local', 'share', 'agent-continue');
}

function flags(argv) {
  const out = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!key?.startsWith('--') || out.has(key) || typeof value !== 'string' || !value || value.startsWith('--')) throw new Error('invalid_arguments');
    out.set(key, value);
  }
  return out;
}

const USAGE = [
  'agent-continue windows --account current|administrator --extension-id <32 chars> --consent <account consent> [--setup-id <administrator setup ID>]',
  'agent-continue setup --extension-id <32 chars> [--install-dir <path>] [--arch <arch>]',
  'agent-continue setup --setup-request <file> --tunnel-id <id> --runtime-key-file <file> --consent accept-install',
  'agent-continue status --json [--install-dir <path>]',
  'agent-continue uninstall [--install-dir <path>] [--registered-value <path>] [--keep-data true]',
  'agent-continue install-plan | verify | help | version',
  'agent-continue setup-manager | register | enroll-ssh (explicit consent required for writes)',
  'agent-continue start-manager --install-dir <path> --consent accept-install [--connect true] (one install reconnect)',
  'agent-continue manager-status --install-dir <path> (read-only reconnect observation)',
  'agent-continue browser-install-status --install-dir <path> (read-only browser bridge inspection; no start or retry)',
  'agent-continue install-local --setup-request <file> --consent accept-install [--install-dir <path>] [--tunnel-id <id> --runtime-key-file <file>] (Windows, existing Node, no native registration)',
  'agent-continue manager-control --install-dir <path> --action status [--id <request UUID>]',
  'agent-continue manager-control --install-dir <path> --action disconnect-and-pause|reconnect --consent accept-control',
  'agent-continue manager-browser --install-dir <path> --consent accept-control (temporary Windows browser controls)',
].join('\n');

export function parseWindowsSetupArguments(argv) {
  const parsed = flags(argv);
  if ([...parsed.keys()].some(key => !['--account', '--extension-id', '--consent', '--setup-id'].includes(key))) {
    throw new Error('invalid_arguments');
  }
  const account = parsed.get('--account');
  if (!['current', 'administrator'].includes(account)) throw new Error('windows_account_required');
  const extensionId = parsed.get('--extension-id');
  if (typeof extensionId !== 'string' || !/^[a-p]{32}$/.test(extensionId)) throw new Error('invalid_extension_id');
  const consent = parsed.get('--consent');
  if (consent !== (account === 'administrator' ? 'accept-administrator-browser-installation' : 'accept-install')) {
    throw new Error('consent_required');
  }
  const setupId = parsed.get('--setup-id');
  if (parsed.has('--setup-id') && (account !== 'administrator' || !/^[a-f0-9]{32}$/.test(setupId))) {
    throw new Error('invalid_setup_id');
  }
  return { account, extensionId, consent, ...(setupId ? { setupId } : {}) };
}

export async function windowsSetup(argv, {
  platform = process.platform, interactive = Boolean(process.stdin.isTTY),
  execute = spawnSync,
  releaseRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'native', 'bootstrap', 'windows-release'),
} = {}) {
  const input = parseWindowsSetupArguments(argv);
  if (platform !== 'win32') throw new Error('unsupported_platform');
  if (!interactive) throw new Error('interactive_terminal_required');
  const { buildWindowsCommandPlan } = await import('./native/bootstrap/windows-release.mjs');
  const plan = buildWindowsCommandPlan({ releaseRoot, ...input });
  // Keep the guided terminal's prompts and Windows approval visible. Never retry a
  // setup after an interrupted child: its original durable operation may exist.
  const result = execute(plan.file, plan.args, plan.options);
  if (result.error || result.signal || !Number.isInteger(result.status)) throw new Error('windows_install_unconfirmed');
  if (result.status !== 0) return { ok: false, error: 'windows_installer_failed', installerExitCode: result.status };
  return { ok: true, installerExited: true, account: input.account, chatAuthorizationVerified: false };
}

async function setup(argv) {
  const parsed = flags(argv);
  const allowed = parsed.has('--setup-request')
    ? ['--setup-request', '--install-dir', '--consent', '--tunnel-id', '--runtime-key-file']
    : ['--extension-id', '--install-dir', '--arch'];
  if ([...parsed.keys()].some(key => !allowed.includes(key))) throw new Error('invalid_arguments');
  const osName = OS[process.platform];
  if (!osName || !ARCH[process.arch]) throw new Error('unsupported_platform');
  if (parsed.has('--setup-request')) {
    return main(['setup', '--install-dir', parsed.get('--install-dir') ?? defaultRoot(),
      '--consent', parsed.get('--consent') ?? '',
      '--setup-request', parsed.get('--setup-request'),
      '--tunnel-id', parsed.get('--tunnel-id') ?? '', '--runtime-key-file', parsed.get('--runtime-key-file') ?? '']);
  }
  const extensionId = parsed.get('--extension-id');
  if (!extensionId) return { ok: false, error: 'extension_id_required', usage: USAGE };
  const installRoot = parsed.get('--install-dir') ?? defaultRoot();
  const { buildInstallPlan } = await import('./native/bootstrap/install-plan.mjs');
  const plan = buildInstallPlan({ os: osName, arch: parsed.get('--arch') ?? ARCH[process.arch], installRoot, extensionId,
    nodeVersion: String(process.version).replace(/^v/, ''),
    inspection: { installed: fs.existsSync(installRoot), manifestPresent: false, registered: false, autostart: false } },
    { defaultWindowsEntry: osName === 'windows' && Boolean(process.env.LOCALAPPDATA) && !parsed.has('--install-dir') });
  return { ok: true, dryRun: true, plan, command: plan.entry.local };
}

export async function run(argv) {
  const [first, ...rest] = argv;
  if (!first || first === 'help' || first === '--help') return { ok: true, usage: USAGE };
  requireSupportedNode();
  if (first === 'windows') return windowsSetup(rest);
  if (first === 'setup') return setup(rest);
  if (first === 'install-local') {
    const parsed = flags(rest);
    if ([...parsed.keys()].some(key => !['--setup-request', '--consent', '--install-dir','--tunnel-id','--runtime-key-file','--tunnel-archive'].includes(key))) throw new Error('invalid_arguments');
    if (parsed.get('--consent') !== 'accept-install') throw new Error('consent_required');
    if (!parsed.has('--setup-request')) throw new Error('setup_request_required');
    if (parsed.has('--tunnel-id') !== parsed.has('--runtime-key-file')) throw new Error('install_argument_missing');
    if (process.platform !== 'win32') throw new Error('unsupported_platform');
    const request = path.resolve(parsed.get('--setup-request'));
    if (!fs.existsSync(request)) throw new Error('install_file_missing');
    return main([first, '--setup-request', request, '--consent', 'accept-install',
      '--install-dir', parsed.get('--install-dir') ?? defaultRoot(),
      ...(parsed.has('--tunnel-id') ? ['--tunnel-id', parsed.get('--tunnel-id'),
        '--runtime-key-file', path.resolve(parsed.get('--runtime-key-file'))] : []),
      ...(parsed.has('--tunnel-archive') ? ['--tunnel-archive', path.resolve(parsed.get('--tunnel-archive'))] : [])]);
  }
  if (['status', 'verify', 'install-plan', 'uninstall', 'version', 'setup-manager', 'start-manager', 'manager-status', 'browser-install-status', 'manager-control', 'manager-browser', 'register', 'enroll-ssh'].includes(first)) return main([first, ...rest]);
  throw new Error('invalid_arguments');
}

let direct = false;
try { direct = Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { direct = false; }
if (direct) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === 'status' || args[0] === 'verify') {
      const { executeStatusCommand } = await import('./native/bootstrap/registration-status.mjs');
      if (!args.includes('--install-dir')) args.push('--install-dir', defaultRoot());
      const result = executeStatusCommand(args);
      process.stdout.write(result.output);
      process.exitCode = result.exitCode;
    } else {
      const result = await run(args);
      process.stdout.write(JSON.stringify(result) + '\n');
      if (result?.ok === false) process.exitCode = 1;
    }
  }
  catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: /^[a-z_][a-z0-9_]{0,63}$/.test(error.message) ? error.message : 'cli_failed' }) + '\n');
    process.exitCode = 1;
  }
}
