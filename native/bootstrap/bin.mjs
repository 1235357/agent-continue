#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { BOOTSTRAP_VERSION } from './payload-layout.mjs';
import { stageRuntime } from './bootstrap.mjs';
import { acquireClient, validateClientInput } from './client-acquisition.mjs';
import { setupDevice, setupServer, setupManager, startLocalManager, observeLocalManagerOperation, requestLocalManager } from './device-setup.mjs';
import { enrollSshTarget } from './device-enrollment.mjs';

const codes = new Set(['consent_required', 'payload_invalid', 'invalid_install_path', 'destination_exists', 'npm_unavailable',
  'dependency_acquisition_failed', 'acquisition_exit_unconfirmed', 'provider_verification_failed', 'receipt_write_failed', 'bootstrap_failed', 'invalid_arguments',
  'provider_stage_invalid', 'unsupported_tunnel_platform', 'client_input_invalid', 'client_exists',
  'client_acquisition_failed', 'client_archive_invalid', 'client_verification_failed', 'client_receipt_failed',
  'setup_request_invalid', 'setup_target_mismatch', 'setup_identity_mismatch', 'setup_input_invalid', 'setup_configuration_failed',
  'setup_receipt_failed', 'setup_cancelled', 'enrollment_input_invalid', 'enrollment_install_invalid',
  'enrollment_exists', 'enrollment_changed', 'enrollment_write_failed', 'native_manifest_invalid', 'manager_start_unconfirmed', 'manager_profile_mismatch',
  'browser_wake_invalid_install', 'browser_wake_owner_present', 'browser_wake_registry_conflict',
  'browser_wake_registry_unconfirmed', 'browser_wake_bundle_conflict',
  'manager_operation_not_recorded', 'manager_operation_receipt_invalid', 'local_browser_unavailable', 'interactive_terminal_required', 'unsupported_platform']);

function validateRegistrationManifest(file, extensionId) {
  try {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16384 || info.nlink !== 1) throw new Error();
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (manifest.name !== 'com.agentcontinue.device_control' || manifest.type !== 'stdio' ||
        !Array.isArray(manifest.allowed_origins) || manifest.allowed_origins.length !== 1 ||
        manifest.allowed_origins[0] !== `chrome-extension://${extensionId}/` ||
        typeof manifest.path !== 'string' || !path.isAbsolute(manifest.path) ||
        path.resolve(manifest.path) !== path.join(path.dirname(file), 'native-launcher.exe')) throw new Error();
    const launcher = fs.lstatSync(manifest.path);
    if (!launcher.isFile() || launcher.isSymbolicLink() || launcher.nlink !== 1 || launcher.size === 0) throw new Error();
  } catch { throw new Error('native_manifest_invalid'); }
}

export async function main(args) {
  if (args[0] === 'browser-install-status') {
    if (![3, 5].includes(args.length) || args[1] !== '--install-dir' || typeof args[2] !== 'string' || !args[2] || args[2].startsWith('--') ||
        (args.length === 5 && (args[3] !== '--extension-id' || typeof args[4] !== 'string' || !/^[a-p]{32}$/.test(args[4])))) {
      throw new Error('invalid_arguments');
    }
    const { inspectBrowserWake, inspectExistingBrowserWake } = await import('./browser-wake-registration.mjs');
    return args.length === 5 ? inspectExistingBrowserWake({ installDir: args[2], extensionId: args[4] })
      : inspectBrowserWake({ installDir: args[2] });
  }
  if (args[0] === 'register-browser-wake') {
    if (args.length !== 7 || args[1] !== '--install-dir' || !args[2] || args[2].startsWith('--') ||
        args[3] !== '--extension-id' || !/^[a-p]{32}$/.test(args[4] ?? '') || args[5] !== '--consent') throw new Error('invalid_arguments');
    const { registerBrowserWake } = await import('./browser-wake-registration.mjs');
    return registerBrowserWake({ installDir: args[2], extensionId: args[4], consent: args[6] });
  }
  if (args[0] === 'manager-browser') {
    if (![5, 7].includes(args.length) || args[1] !== '--install-dir' || typeof args[2] !== 'string' || !args[2] || args[2].startsWith('--') ||
        args[3] !== '--consent' || (args.length === 7 && (args[5] !== '--expected-extension-id' ||
          typeof args[6] !== 'string' || args[6].length !== 32 || !/^[a-p]{32}$/.test(args[6])))) throw new Error('invalid_arguments');
    if (args[4] !== 'accept-control') throw new Error('consent_required');
    if (process.platform !== 'win32') throw new Error('unsupported_platform');
    if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stderr.isTTY) throw new Error('interactive_terminal_required');
    const { openBrowserManager } = await import('./browser-control.mjs');
    const session = await openBrowserManager(args[2], args[6]);
    const input = createInterface({ input: process.stdin, terminal: false });
    const finish = () => { void session.close(); };
    input.once('line', finish);
    input.once('close', finish);
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
    void session.stopped.then(() => {
      process.removeListener('SIGINT', finish);
      process.removeListener('SIGTERM', finish);
      input.removeListener('close', finish);
      input.removeListener('line', finish);
      input.close();
    });
    process.stderr.write('Paste the next line into local controls only (do not share):\n' + session.pairingTicket + '\n');
    process.stderr.write('Press Enter or Ctrl+C to close local controls; the tunnel is unchanged.\n');
    return { ok: true, url: session.origin, expiresInSeconds: session.expiresInSeconds };
  }
  if (args[0] === 'manager-control') {
    const keys = { '--install-dir': 'installDir', '--action': 'action', '--id': 'id', '--consent': 'consent' };
    const input = {};
    if (![5, 7, 9].includes(args.length)) throw new Error('invalid_arguments');
    for (let i = 1; i < args.length; i += 2) {
      const key = Object.hasOwn(keys, args[i]) ? keys[args[i]] : undefined, value = args[i+1];
      if (!key || Object.hasOwn(input, key) || typeof value !== 'string' || !value || value.startsWith('--')) throw new Error('invalid_arguments');
      input[key] = value;
    }
    if (!input.installDir || !input.action) throw new Error('invalid_arguments');
    return requestLocalManager(input);
  }
  if (args[0] === 'start-manager') {
    const options = {};
    const keys = {'--install-dir':'installDir','--consent':'consent','--connect':'connect'};
    if (![5,7].includes(args.length)) throw new Error('invalid_arguments');
    for (let i=1;i<args.length;i+=2) {
      const key=Object.hasOwn(keys,args[i]) ? keys[args[i]] : undefined, value=args[i+1];
      if (!key || Object.hasOwn(options,key) || typeof value !== 'string' || !value || value.startsWith('--')) throw new Error('invalid_arguments');
      if (key === 'connect' && value !== 'true' && value !== 'false') throw new Error('invalid_arguments');
      options[key]=key === 'connect' ? value === 'true' : value;
    }
    return startLocalManager(options);
  }
  if (args[0] === 'manager-status') {
    if (args.length !== 3 || args[1] !== '--install-dir' || typeof args[2] !== 'string' || !args[2] || args[2].startsWith('--')) {
      throw new Error('invalid_arguments');
    }
    return observeLocalManagerOperation(args[2]);
  }
  if (args.length === 1 && args[0] === 'help') return { ok: true, commands: ['help', 'version', 'stage', 'acquire', 'setup', 'setup-server', 'setup-manager', 'install-local', 'start-manager', 'manager-status', 'browser-install-status', 'manager-control', 'manager-browser', 'enroll-ssh', 'install-plan', 'uninstall', 'register', 'register-browser-wake', 'status', 'verify'] };
  if (args.length === 1 && args[0] === 'version') return { ok: true, version: BOOTSTRAP_VERSION };
  if (args[0] === 'install-plan') {
    const allowed = { '--os': 'os', '--arch': 'arch', '--install-dir': 'installRoot', '--extension-id': 'extensionId',
      '--node-version': 'nodeVersion' };
    if (![7, 9, 11].includes(args.length)) throw new Error('invalid_arguments');
    const input = {};
    for (let index = 1; index < args.length; index += 2) {
      const key = Object.hasOwn(allowed, args[index]) ? allowed[args[index]] : undefined, value = args[index + 1];
      if (!key || Object.hasOwn(input, key) || typeof value !== 'string' || !value || value.startsWith('--')) throw new Error('invalid_arguments');
      input[key] = value;
    }
    const { buildInstallPlan } = await import('./install-plan.mjs');
    const plan = buildInstallPlan({ ...input,
      nodeVersion: input.nodeVersion ?? String(process.version).replace(/^v/, '') });
    return { ok: true, plan };
  }
  if (args[0] === 'uninstall') {
    const allowed = { '--os': 'os', '--install-dir': 'installRoot', '--registered-value': 'registeredValue',
      '--installed': 'installed', '--registered': 'registered', '--autostart': 'autostart', '--keep-data': 'keepData' };
    if (args.length < 5 || args.length > 15 || (args.length - 1) % 2 !== 0) throw new Error('invalid_arguments');
    const input = {};
    for (let index = 1; index < args.length; index += 2) {
      const key = Object.hasOwn(allowed, args[index]) ? allowed[args[index]] : undefined, value = args[index + 1];
      if (!key || Object.hasOwn(input, key) || typeof value !== 'string' || !value || value.startsWith('--')) throw new Error('invalid_arguments');
      input[key] = value;
    }
    const flags = {};
    for (const key of ['installed', 'registered', 'autostart']) {
      if (Object.hasOwn(input, key)) {
        if (input[key] !== 'true' && input[key] !== 'false') throw new Error('invalid_arguments');
        flags[key] = input[key] === 'true';
      }
    }
    const { buildUninstallPlan } = await import('./install-plan.mjs');
    const plan = buildUninstallPlan({ os: input.os, installRoot: input.installRoot,
      ...(Object.hasOwn(input, 'registeredValue') ? { registeredValue: input.registeredValue } : {}),
      inspection: { installed: flags.installed ?? false, manifestPresent: false,
        registered: flags.registered ?? false, autostart: flags.autostart ?? false },
      ...(input.keepData === 'true' ? { keepData: true } : {}) });
    return { ok: true, dryRun: true, plan };
  }
  if (args[0] === 'register') {
    const fields = { '--os': 'os', '--install-dir': 'installRoot', '--extension-id': 'extensionId',
      '--view': 'view', '--consent': 'consent', '--approver-a': 'approverA', '--approver-b': 'approverB' };
    const input = {};
    let execute = false;
    for (let index = 1; index < args.length; index++) {
      if (args[index] === '--execute') {
        if (execute) throw new Error('invalid_arguments');
        execute = true; continue;
      }
      const key = Object.hasOwn(fields, args[index]) ? fields[args[index]] : undefined;
      const value = args[index + 1];
      if (!key || Object.hasOwn(input, key) || typeof value !== 'string' || !value || value.startsWith('--')) {
        throw new Error('invalid_arguments');
      }
      input[key] = value; index++;
    }
    if (!input.os || !input.installRoot || !input.extensionId || !input.view) throw new Error('invalid_arguments');
    if (input.os !== 'windows' || !/^[a-p]{32}$/.test(input.extensionId) || !['32', '64'].includes(input.view)) throw new Error('invalid_arguments');
    if (execute && input.consent !== 'accept-install') throw new Error('consent_required');
    if (execute) validateRegistrationManifest(path.join(input.installRoot, 'native-host.json'), input.extensionId);
    const { registrationPlan } = await import('./registration-plan.mjs');
    const { issueRegistrationApproval, runRegistration } = await import('./registration-execution.mjs');
    const { createWinRegistry } = await import('./registry-win.mjs');
    const { HOST_NAME } = await import('./install-plan.mjs');
    const plan = registrationPlan({ name: HOST_NAME, hive: 'HKCU', view: input.view,
      manifestPath: path.join(input.installRoot, 'native-host.json'),
      origin: 'chrome-extension://' + input.extensionId + '/' });
    const now = Date.now();
    const approvals = [input.approverA ?? 'operator', input.approverB ?? 'agent-continue-installer']
      .map(issuerId => issueRegistrationApproval({ plan, issuerId, now }));
    const result = runRegistration({ plan, approvals, now, execute,
      registry: createWinRegistry(),
      ...(execute ? { echo: { keyPath: plan.keyPath, regSzValue: plan.regSzValue } } : {}) });
    return { ok: true, extensionId: input.extensionId, ...result };
  }
  if (args[0] === 'status' || args[0] === 'verify') {
    const { executeStatusCommand } = await import('./registration-status.mjs');
    const result = executeStatusCommand(args);
    return { ok: result.exitCode === 0, command: args[0], output: result.output };
  }
  if (args[0] === 'enroll-ssh') {
    const fields = { '--install-dir': 'installDir', '--consent': 'consent', '--ssh-executable': 'sshExecutable',
      '--host': 'host', '--port': 'port', '--user': 'user', '--remote-node': 'remoteNode',
      '--remote-install-dir': 'remoteInstallDir', '--known-hosts': 'knownHosts', '--known-hosts-sha256': 'knownHostsSha256' };
    if (args.length !== 21) throw new Error('invalid_arguments');
    const input = {};
    for (let index = 1; index < args.length; index += 2) {
      const key = Object.hasOwn(fields, args[index]) ? fields[args[index]] : undefined, value = args[index + 1];
      if (!key || Object.hasOwn(input, key) || typeof value !== 'string' || !value || value.startsWith('--')) throw new Error('invalid_arguments');
      input[key] = value;
    }
    if (!/^[1-9][0-9]{0,4}$/.test(input.port) || Number(input.port) > 65535) throw new Error('invalid_arguments');
    input.port = Number(input.port);
    return { ok: true, ...await enrollSshTarget(input) };
  }
  const combined = args[0] === 'acquire';
  const localInstall = args[0] === 'install-local';
  const serverSetup = args[0] === 'setup-server';
  const hasTunnel = args.includes('--tunnel-id');
  const browserManaged = args.includes('--browser-managed');
  const setup = args[0] === 'setup' || serverSetup || localInstall && (hasTunnel || browserManaged);
  const manager = args[0] === 'setup-manager' || localInstall && !hasTunnel && !browserManaged;
  if ((!combined && !setup && !manager && args[0] !== 'stage') || browserManaged && !(localInstall && setup) ||
      !(manager ? [7, 9] : setup ? [...(browserManaged ? [7] : []), 11, 13, 15, 17] : combined ? [5, 7, 9] : [5, 7]).includes(args.length - (browserManaged ? 2 : 0))) throw new Error('invalid_arguments');
  const allowed = ['--install-dir', '--consent', '--offline-cache', ...(combined || setup ? ['--tunnel-archive'] : []),
    ...(setup || manager ? ['--setup-request'] : []),
    ...(setup ? ['--tunnel-id', '--runtime-key-file', ...(localInstall ? ['--expected-extension-id', '--guided-extension-id', '--browser-managed'] : serverSetup ? [] : ['--private-runtime'])] : [])];
  const options = new Map();
  for (let index = 1; index < args.length; index += 2) {
    if (!allowed.includes(args[index]) || options.has(args[index]) ||
        typeof args[index + 1] !== 'string' || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('invalid_arguments');
    options.set(args[index], args[index + 1]);
  }
  const guided = options.has('--guided-extension-id');
  if (!options.has('--install-dir') || !options.has('--consent') ||
      ((setup || manager) && options.has('--setup-request') === guided) ||
      (guided && options.has('--expected-extension-id')) ||
      (setup && !(browserManaged && guided) && ['--tunnel-id', '--runtime-key-file'].some(key => !options.has(key))) ||
      (browserManaged && options.has('--tunnel-id') !== options.has('--runtime-key-file'))) throw new Error('invalid_arguments');
  if(options.has('--private-runtime') && options.get('--private-runtime')!=='true') throw new Error('invalid_arguments');
  if (browserManaged && options.get('--browser-managed') !== 'true') throw new Error('invalid_arguments');
  if (localInstall && options.get('--consent') !== 'accept-install') throw new Error('consent_required');
  if (serverSetup && options.get('--consent') !== 'full-account') throw new Error('consent_required');
  if (localInstall && process.platform !== 'win32') throw new Error('unsupported_platform');
  if (localInstall && browserManaged) {
    let extensionId = options.get('--guided-extension-id');
    if (!guided) {
      const { readSetupRequest, validateSetupRequest } = await import('./device-setup.mjs');
      extensionId = validateSetupRequest(readSetupRequest(options.get('--setup-request')).request).extensionId;
    }
    const { inspectExistingBrowserWake, preflightBrowserWake } = await import('./browser-wake-registration.mjs');
    const existing = await inspectExistingBrowserWake({ installDir: options.get('--install-dir'), extensionId });
    if (existing.status !== 'existing-absent') return existing;
    preflightBrowserWake({ installDir: options.get('--install-dir'), extensionId });
    if (!hasTunnel) throw new Error('invalid_arguments');
  }
  const controller = new AbortController(), cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    if (manager || setup) {
      const input = {
      installDir: options.get('--install-dir'), consent: options.get('--consent') === 'accept-install' ? 'full-account' : options.get('--consent'),
        ...(guided ? { guidedExtensionId: options.get('--guided-extension-id') } : { setupRequestFile: options.get('--setup-request') }),
        signal: controller.signal,
      ...(options.has('--offline-cache') ? { offlineCache: options.get('--offline-cache') } : {}),
      };
      const receipt = manager ? await setupManager(input) : await (serverSetup ? setupServer : setupDevice)({
        ...input, tunnelId: options.get('--tunnel-id'), runtimeKeyFile: options.get('--runtime-key-file'),
        ...(options.has('--expected-extension-id') ? { expectedExtensionId: options.get('--expected-extension-id') } : {}),
        ...(options.has('--private-runtime') ? { privateRuntime: true } : {}),
        ...(options.has('--tunnel-archive') ? { offlineArchive: options.get('--tunnel-archive') } : {}),
      });
      if (!localInstall) return { ok: true, ...receipt };
      if (controller.signal.aborted) throw new Error('setup_cancelled');
      if (browserManaged) {
        const { registerBrowserWake } = await import('./browser-wake-registration.mjs');
        const registration = await registerBrowserWake({ installDir: input.installDir, extensionId: receipt.extensionId,
          consent: 'accept-browser-wake' }, { signal: controller.signal });
        return { ok: true, action: 'install-local', mode: 'browser-managed', configured: true, registered: true,
          connected: false, browserLaunchVerified: false, chatAuthorizationVerified: false, registration };
      }
      const connection = setup ? await startLocalManager({ installDir: input.installDir,
        consent: 'accept-install', connect: true }) : null;
      if (connection?.ok === false) return connection;
      return { ok: true, action: 'install-local', mode: 'command-only', configured: setup,
        registered: false, connected: connection?.connected === true, manager: connection,
        chatAuthorizationVerified: false };
    }
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
  try {
    const argv = process.argv.slice(2), first = argv[0];
    if (first === 'status' || first === 'verify') {
      const { executeStatusCommand } = await import('./registration-status.mjs');
      const result = executeStatusCommand(argv);
      process.stdout.write(result.output);
      if (result.exitCode) process.exitCode = result.exitCode;
    } else {
      const result = await main(argv);
      process.stdout.write(JSON.stringify(result) + '\n');
      if (result?.ok === false) process.exitCode = 1;
    }
  }
  catch (error) {
    process.exitCode = 1;
    process.stdout.write(JSON.stringify({ ok: false, error: codes.has(error.message) ? error.message : 'bootstrap_failed' }) + '\n');
  }
}
