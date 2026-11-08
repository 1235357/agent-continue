import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFrame, writeFrame } from './device-owner.mjs';
import { openAdministratorBrowserSessionServer } from './windows-admin-browser-session.mjs';

const runFile = promisify(execFile);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const originPattern = /^chrome-extension:\/\/[a-p]{32}\/$/;
const digestPattern = /^[a-f0-9]{64}$/;
const validOperationId = value => typeof value === 'string' && value.length === 32 && /^[a-f0-9]{32}$/.test(value);
const validPauseTarget = value => typeof value === 'string' && (value.length === 37 || value.length === 65) &&
  /^[a-f0-9]{32}:(?:[a-f0-9]{32}|idle)$/.test(value);
const unknown = () => ({ state: 'unobserved', generation: null });
const unconfirmedSetup = setupId => ({ setupId, state: 'unconfirmed', bundleSha256: null, target: null });

function setupStatus(reply, setupId) {
  return exact(reply, ['setupId', 'state', 'bundleSha256', 'target']) && reply.setupId === setupId &&
    (reply.state === 'unconfirmed' ? reply.bundleSha256 === null && reply.target === null :
      reply.state === 'installed' && validControlDigest(reply.bundleSha256) && validPauseTarget(reply.target));
}

function observation(reply) {
  return exact(reply, ['state', 'generation']) && reply.state === 'ready' &&
    typeof reply.generation === 'string' && /^[a-f0-9]{32}$/.test(reply.generation) ? reply : unknown();
}

function pauseSupport(reply) {
  return exact(reply, ['state', 'target']) && reply.state === 'supported' && validPauseTarget(reply.target) ? reply : null;
}

const pauseReceiptStates = ['unconfirmed', 'pause-recorded', 'stopped', 'fenced', 'superseded'];
const pauseRequestStates = ['requested', 'cancelled', 'unconfirmed'];

function pauseReceipt(reply, operationId, states = pauseReceiptStates) {
  return exact(reply, ['operationId', 'state']) && reply.operationId === operationId &&
    states.includes(reply.state) ? reply : null;
}

const installationPauseActions = ['pause-installation-support', 'pause-installation', 'pause-installation-status'];
const installationPauseStates = [...pauseRequestStates, ...pauseReceiptStates.filter(state => state !== 'unconfirmed')];
function installationPauseReply(reply, expected, support, submission = false) {
  return exact(reply, support ? ['bundleSha256', 'state'] : ['bundleSha256', 'operationId', 'state']) &&
    reply.bundleSha256 === expected.bundleSha256 && (support || reply.operationId === expected.operationId) &&
    (support ? ['supported', 'unconfirmed'] : submission ? installationPauseStates : pauseReceiptStates).includes(reply.state);
}

const controlActions = ['control-support', 'control', 'control-status', 'control-fence', 'control-reconcile'];
const controlKinds = ['connect', 'resume-saved', 'revoke'];
const controlIdentityKeys = ['bundleSha256', 'operationId', 'control'];
const controlOutcomes = ['requested', 'cancelled', 'unconfirmed'];
const commonControlStates = ['unconfirmed', 'reserved', 'superseded', 'rejected', 'fenced', 'abandoned'];
const startupControlStates = ['intent-saved', 'launch-requested', 'launch-unconfirmed', 'recovered-paused'];
const revokeControlStates = ['revocation-recorded', 'stopped'];
const controlProgressPhases = ['verifying-full', 'verifying-control', 'waiting-owner', 'waiting-stop', 'settled'];
const validControlDigest = value => typeof value === 'string' && value.length === 64 && digestPattern.test(value);
const validControlIdentity = value => validControlDigest(value?.bundleSha256) &&
  validOperationId(value?.operationId) && controlKinds.includes(value?.control);
const controlIdentity = value => ({ bundleSha256: value.bundleSha256, operationId: value.operationId, control: value.control });
const unconfirmedControlSupport = control => ({ control, state: 'unconfirmed', bundleSha256: null,
  target: null, ownerState: 'unobserved', eligible: false });
const unconfirmedControlSubmission = value => ({ ...controlIdentity(value), outcome: 'unconfirmed' });
const unconfirmedControlStatus = value => ({ ...controlIdentity(value), state: 'unconfirmed', progress: null });

function controlPayload(value, action, headerKeys = []) {
  if (!controlActions.includes(action) || !controlKinds.includes(value?.control)) return false;
  const keys = [...headerKeys, ...(action === 'control-support' ? ['control'] : controlIdentityKeys)];
  const targeted = action === 'control' && value.control !== 'revoke';
  if (targeted) keys.push('target');
  return Boolean(exact(value, keys) && (action === 'control-support' || validControlIdentity(value)) &&
    (!targeted || validPauseTarget(value.target)));
}

// New messages require UUID transport IDs; the existing version-1 ID contracts stay unchanged.
export function isAdministratorControlRequest(value) {
  return Boolean(value?.version === 1 && typeof value.id === 'string' && value.id.length === 36 &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.id) &&
    controlPayload(value, value.action, ['version', 'action', 'id']));
}

// Reply validators consume header-free projections and correlate them to the caller's identity.
export function isAdministratorControlSupport(value, control) {
  if (!controlKinds.includes(control) || !exact(value, ['control', 'state', 'bundleSha256', 'target', 'ownerState', 'eligible']) ||
      value.control !== control || !['unobserved', 'paused', 'running', 'revoked'].includes(value.ownerState) ||
      typeof value.eligible !== 'boolean') return false;
  if (value.state === 'unconfirmed') return value.bundleSha256 === null && value.target === null &&
    value.ownerState === 'unobserved' && !value.eligible;
  if (value.state !== 'supported' || !validControlDigest(value.bundleSha256)) return false;
  if (control === 'revoke' || !value.eligible) return value.target === null;
  return validPauseTarget(value.target) && (value.ownerState === 'running' || control === 'connect' && value.ownerState === 'paused');
}

function matchingControlIdentity(value, expected) {
  return validControlIdentity(expected) && controlIdentityKeys.every(key => value[key] === expected[key]);
}

export function isAdministratorControlSubmission(value, expected) {
  return Boolean(exact(value, [...controlIdentityKeys, 'outcome']) && matchingControlIdentity(value, expected) &&
    controlOutcomes.includes(value.outcome));
}

export function isAdministratorControlProgress(value) {
  return Boolean(exact(value, ['phase', 'verifiedFiles', 'totalFiles']) && controlProgressPhases.includes(value.phase) &&
    (value.verifiedFiles === null && value.totalFiles === null ||
      value.phase === 'verifying-full' && Number.isSafeInteger(value.verifiedFiles) && Number.isSafeInteger(value.totalFiles) &&
      value.verifiedFiles >= 0 && value.verifiedFiles <= value.totalFiles));
}

export function isAdministratorControlStatus(value, expected) {
  return Boolean(exact(value, [...controlIdentityKeys, 'state', 'progress']) && matchingControlIdentity(value, expected) &&
    (commonControlStates.includes(value.state) ||
      (value.control === 'revoke' ? revokeControlStates : startupControlStates).includes(value.state)) &&
    (value.progress === null || isAdministratorControlProgress(value.progress)));
}

export async function serveAdministratorBrowser({ input, output, args, origin, start, readStatus,
  readPauseStatus, requestPause, readPauseSupport, requestPauseFence, openSession,
  readControlSupport, requestControl, readControlStatus, requestControlFence, requestControlReconcile, readSetupStatus,
  bundleSha256, readInstallationPauseSupport, requestInstallationPause, readInstallationPauseStatus }) {
  if (!originPattern.test(origin) || args[0] !== origin ||
      !(args.length === 1 || args.length === 2 && /^--parent-window=\d{1,20}$/.test(args[1]))) {
    throw new Error('invalid_administrator_browser_origin');
  }
  const request = await readFrame(input, 4000);
  const action = request?.action;
  if (installationPauseActions.includes(action)) {
    const support = action === 'pause-installation-support';
    if (!exact(request, ['version', 'id', 'action', 'bundleSha256', ...(support ? [] : ['operationId'])]) ||
        request.version !== 1 || typeof request.id !== 'string' || request.id.length !== 36 ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(request.id) ||
        !validControlDigest(bundleSha256) || request.bundleSha256 !== bundleSha256 ||
        !support && !validOperationId(request.operationId)) throw new Error('invalid_administrator_browser_request');
    if (output.destroyed || output.writableEnded) return;
    const identity = { bundleSha256, ...(support ? {} : { operationId: request.operationId }) };
    let result = { ...identity, state: 'unconfirmed' };
    try {
      const callback = support ? readInstallationPauseSupport :
        action === 'pause-installation' ? requestInstallationPause : readInstallationPauseStatus;
      const reply = await callback(support ? bundleSha256 : identity);
      if (installationPauseReply(reply, identity, support, action === 'pause-installation')) result = reply;
    } catch { /* No targeted, control or startup fallback, including unknown dispatch. */ }
    await writeFrame(output, { version: 1, action, id: request.id, ...result });
    return;
  }
  if (action === 'setup-status') {
    if (!exact(request, ['version', 'id', 'action', 'setupId']) || request.version !== 1 ||
        typeof request.id !== 'string' || request.id.length !== 36 ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(request.id) || !validOperationId(request.setupId)) {
      throw new Error('invalid_administrator_browser_request');
    }
    if (output.destroyed || output.writableEnded) return;
    let result;
    try {
      const reply = await readSetupStatus(request.setupId);
      if (setupStatus(reply, request.setupId)) result = reply;
    } catch { /* Read-only observation never falls back to startup or legacy status. */ }
    await writeFrame(output, { version: 1, action, id: request.id, ...(result ?? unconfirmedSetup(request.setupId)) });
    return;
  }
  if (controlActions.includes(action)) {
    if (!isAdministratorControlRequest(request)) throw new Error('invalid_administrator_browser_request');
    if (output.destroyed || output.writableEnded) return;
    let result;
    if (action === 'control-support') {
      try {
        const reply = await readControlSupport(request.control);
        if (isAdministratorControlSupport(reply, request.control)) result = reply;
      } catch { /* Absent or legacy capability is unconfirmed, never a wake fallback. */ }
      result ??= unconfirmedControlSupport(request.control);
    } else {
      const value = { ...controlIdentity(request) };
      if (action === 'control' && request.control !== 'revoke') value.target = request.target;
      const readOnly = action === 'control-status';
      try {
        const callback = action === 'control' ? requestControl : readOnly ? readControlStatus :
          action === 'control-fence' ? requestControlFence : requestControlReconcile;
        const reply = await callback(value);
        if ((readOnly ? isAdministratorControlStatus : isAdministratorControlSubmission)(reply, request)) result = reply;
      } catch { /* A lost submission reply never authorizes retry, reconcile or another control. */ }
      result ??= readOnly ? unconfirmedControlStatus(request) : unconfirmedControlSubmission(request);
    }
    await writeFrame(output, { version: 1, action, id: request.id, ...result });
    return;
  }
  const pause = action === 'pause-status' || action === 'pause-reconcile' || action === 'pause';
  const keys = ['version', 'id', 'action'];
  if (action === 'session') keys.push('wake');
  if (pause) keys.push('operationId');
  if (action === 'pause') keys.push('target');
  if (!exact(request, keys) || request.version !== 1 ||
      typeof request.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(request.id) ||
      (pause ? !validOperationId(request.operationId) : !['session', 'wake', 'status', 'pause-support'].includes(action)) ||
      (action === 'session' && typeof request.wake !== 'boolean') ||
      (action === 'pause' && !validPauseTarget(request.target))) {
    throw new Error('invalid_administrator_browser_request');
  }
  if (output.destroyed || output.writableEnded) return;
  const header = { version: 1, id: request.id, action };
  if (action === 'session') {
    let session;
    try {
      session = await openSession(request.wake, input);
      if (!session.isLive() || input.destroyed || input.readableEnded) throw new Error('browser_session_closed');
      await writeFrame(output, { ...header, outcome: 'attached' });
      await session.finished;
    } catch {
      // Acknowledgement is not owner readiness. Never fall back to a one-shot wake.
      if (!session && !output.destroyed && !output.writableEnded) {
        await writeFrame(output, { ...header, outcome: 'unconfirmed' });
      }
    } finally { if (session) await session.close(); }
  } else if (pause) {
    const { operationId } = request;
    let receipt;
    try {
      if (action === 'pause') {
        receipt = pauseReceipt(await requestPause(operationId, request.target), operationId, pauseRequestStates);
      } else if (action === 'pause-reconcile') {
        receipt = pauseReceipt(await requestPauseFence(operationId), operationId, pauseRequestStates);
      } else {
        receipt = pauseReceipt(await readPauseStatus(operationId), operationId);
      }
    } catch { /* No retry. */ }
    await writeFrame(output, { ...header, operationId, state: receipt?.state ?? 'unconfirmed' });
  } else if (action === 'pause-support') {
    let supported;
    try { supported = pauseSupport(await readPauseSupport()); } catch { /* Absent or older install. */ }
    await writeFrame(output, { ...header, ...(supported ?? { state: 'unconfirmed' }) });
  } else if (action === 'status') {
    let result;
    try { result = observation(await readStatus()); } catch { result = unknown(); }
    await writeFrame(output, { ...header, ...result });
  } else {
    let outcome = 'unconfirmed';
    try { await start(); outcome = 'requested'; } catch { /* Do not retry a possibly admitted wake. */ }
    await writeFrame(output, { ...header, outcome });
  }
}

export function createAdministratorBrowserActions(bundleRoot, binding, execute = runFile) {
  const win = path.win32;
  if (!exact(binding, ['version', 'origin', 'bundleSha256', 'systemDirectory']) || binding.version !== 1 ||
      typeof binding.origin !== 'string' || !originPattern.test(binding.origin) ||
      typeof binding.bundleSha256 !== 'string' || !digestPattern.test(binding.bundleSha256) ||
      typeof binding.systemDirectory !== 'string' || !/^[A-Z]:\\Windows\\System32$/i.test(binding.systemDirectory) ||
      typeof bundleRoot !== 'string' || !/^[A-Z]:\\[^\\]/i.test(bundleRoot) ||
      /[\x00-\x1f*?"<>|:]/.test(bundleRoot.slice(2)) || win.normalize(bundleRoot) !== bundleRoot ||
      win.basename(bundleRoot) !== binding.bundleSha256.slice(0, 24)) throw new Error('invalid_administrator_browser_binding');
  const { systemDirectory: system, bundleSha256 } = binding;
  const systemRoot = win.dirname(system);
  const taskName = '\\AgentContinue\\AdministratorOwner-' + bundleSha256.slice(0, 24);
  const bridge = bundleRoot + '.browser';
  const options = { cwd: system, windowsHide: true, timeout: 3200, maxBuffer: 2048,
    env: { SystemRoot: systemRoot, WINDIR: systemRoot, PATH: system } };
  async function invoke(action, extra = [], executionOptions = options) {
    const { stdout } = await execute(win.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', win.join(bridge, 'stager.ps1'),
        '-Action', action, '-Archive', win.join(bridge, 'bundle.zip'), '-ExpectedSha256', bundleSha256, ...extra], executionOptions);
    return JSON.parse(stdout);
  }
  function boundControl(value, action) {
    if (!controlPayload(value, action) || value.bundleSha256 !== bundleSha256) {
      throw new Error('invalid_administrator_browser_control_request');
    }
    return { ...value };
  }
  function controlParameters(value) {
    const extra = ['-ControlKind', value.control, '-ControlOperationId', value.operationId];
    if (Object.hasOwn(value, 'target')) extra.push('-BrowserControlTarget', value.target);
    return extra;
  }
  async function installationPause(value, action, support = false, submission = false) {
    if (support ? value !== bundleSha256 : !exact(value, ['bundleSha256', 'operationId']) ||
        value.bundleSha256 !== bundleSha256 || !validOperationId(value.operationId)) {
      throw new Error('invalid_administrator_browser_installation_pause');
    }
    const identity = { bundleSha256, ...(support ? {} : { operationId: value.operationId }) };
    let timer;
    try {
      const extra = ['-BrowserExtensionId', binding.origin.slice(19, 51),
        ...(support ? [] : ['-PauseOperationId', value.operationId])];
      const { timeout: _killTimeout, ...writeOptions } = options;
      // Only end the response wait. Keep child/pipe refs; never kill, abort or replay a write.
      const reply = submission ? await Promise.race([
        invoke(action, extra, writeOptions),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), 30000); }),
      ]) : await invoke(action, extra, { ...options, timeout: 20000 });
      if (installationPauseReply(reply, identity, support, submission)) return reply;
    } catch { /* A timeout is unknown; never retry an elevated request. */ }
    finally { clearTimeout(timer); }
    return { ...identity, state: 'unconfirmed' };
  }
  async function submitControl(value, wireAction, stagerAction) {
    const request = boundControl(value, wireAction);
    const { timeout: _killTimeout, ...writeOptions } = options;
    let timer;
    try {
      // execFile's promisified timeout kills its child. This 30s race ends only the bridge
      // response wait: no abort, kill or retry. Child/pipe refs can keep this host alive
      // after replying. maxBuffer/OS/process failures are still possible. New sealed
      // stagers keep medium alive through a validated durable high handoff; older
      // installed stagers may not implement that entry. Never infer it from this race.
      const reply = await Promise.race([
        invoke(stagerAction, controlParameters(request), writeOptions),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), 30000); }),
      ]);
      return isAdministratorControlSubmission(reply, request) ? reply : unconfirmedControlSubmission(request);
    } catch { return unconfirmedControlSubmission(request); }
    finally { clearTimeout(timer); }
  }
  return Object.freeze({
    bundleSha256,
    readInstallationPauseSupport: value => installationPause(value, 'CheckBrowserHostedOwnerInstallationPause', true),
    requestInstallationPause: value => installationPause(value, 'RequestBrowserHostedOwnerInstallationPause', false, true),
    readInstallationPauseStatus: value => installationPause(value, 'ObserveBrowserHostedOwnerInstallationPause'),
    async start() { throw new Error('administrator_browser_session_required'); },
    async openSession(wake, input) {
      const session = await openAdministratorBrowserSessionServer({ bundle: bundleRoot, origin: binding.origin, input });
      try {
        if (wake) {
          if (!session.isLive()) throw new Error('browser_session_closed');
          await execute(win.join(system, 'schtasks.exe'), ['/Run', '/TN', taskName], options);
        }
        return session;
      } catch (error) { await session.close(); throw error; }
    },
    readStatus: () => invoke('ObserveHostedOwner'),
    async readSetupStatus(setupId) {
      if (!validOperationId(setupId)) throw new Error('invalid_administrator_browser_setup_id');
      try {
        const reply = await invoke('ObserveBrowserSetup', ['-BrowserSetupId', setupId,
          '-BrowserExtensionId', binding.origin.slice(19, 51)]);
        if (setupStatus(reply, setupId) && (reply.state === 'unconfirmed' || reply.bundleSha256 === bundleSha256)) return reply;
      } catch { /* Missing, legacy or mismatched installations stay unconfirmed. */ }
      return unconfirmedSetup(setupId);
    },
    async readPauseSupport() { return pauseSupport(await invoke('CheckBrowserHostedOwnerPause')); },
    async readPauseStatus(operationId) {
      if (!validOperationId(operationId)) throw new Error('invalid_administrator_browser_pause_operation');
      const receipt = pauseReceipt(await invoke('ObserveHostedOwnerPause', ['-PauseOperationId', operationId]), operationId);
      if (!receipt) throw new Error('invalid_administrator_browser_pause_receipt');
      return receipt;
    },
    async requestPause(operationId, target) {
      if (!validOperationId(operationId)) throw new Error('invalid_administrator_browser_pause_operation');
      if (!validPauseTarget(target)) throw new Error('invalid_administrator_browser_pause_target');
      const receipt = pauseReceipt(await invoke('RequestBrowserHostedOwnerPause',
        ['-PauseOperationId', operationId, '-BrowserPauseTarget', target],
        { ...options, timeout: 20000 }), operationId, pauseRequestStates);
      if (!receipt) throw new Error('invalid_administrator_browser_pause_request_receipt');
      return receipt;
    },
    async requestPauseFence(operationId) {
      if (!validOperationId(operationId)) throw new Error('invalid_administrator_browser_pause_operation');
      const receipt = pauseReceipt(await invoke('RequestBrowserHostedOwnerPauseFence', ['-PauseOperationId', operationId],
        { ...options, timeout: 20000 }), operationId, pauseRequestStates);
      if (!receipt) throw new Error('invalid_administrator_browser_pause_fence_receipt');
      return receipt;
    },
    async readControlSupport(control) {
      if (!controlKinds.includes(control)) throw new Error('invalid_administrator_browser_control_kind');
      try {
        const reply = await invoke('CheckBrowserHostedOwnerControl', ['-ControlKind', control], { ...options, timeout: 20000 });
        if (isAdministratorControlSupport(reply, control) &&
            (reply.state === 'unconfirmed' || reply.bundleSha256 === bundleSha256)) return reply;
      } catch { /* Legacy stagers do not implement this action. */ }
      return unconfirmedControlSupport(control);
    },
    requestControl: value => submitControl(value, 'control', 'RequestBrowserHostedOwnerControl'),
    async readControlStatus(value) {
      const request = boundControl(value, 'control-status');
      try {
        const reply = await invoke('ObserveHostedOwnerControl', controlParameters(request));
        if (isAdministratorControlStatus(reply, request)) return reply;
      } catch { /* Read-only failure preserves the same operation identity. */ }
      return unconfirmedControlStatus(request);
    },
    requestControlFence: value => submitControl(value, 'control-fence', 'RequestBrowserHostedOwnerControlFence'),
    requestControlReconcile: value => submitControl(value, 'control-reconcile', 'RequestBrowserHostedOwnerControlReconcile'),
  });
}

const here = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === here) {
  try {
    if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('windows_x64_required');
    const bundleRoot = path.dirname(path.dirname(here));
    if (path.basename(path.dirname(bundleRoot)) !== 'AgentContinueAdmin' ||
        process.execPath !== path.join(bundleRoot, 'runtime', 'node.exe')) {
      throw new Error('invalid_administrator_browser_install');
    }
    const file = path.join(bundleRoot + '.browser', 'binding.json');
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024) {
      throw new Error('invalid_administrator_browser_binding');
    }
    const binding = JSON.parse(fs.readFileSync(file, 'utf8'));
    const actions = createAdministratorBrowserActions(bundleRoot, binding);
    const committed = path.join(bundleRoot + '.browser', 'enrolled.json');
    const marker = fs.lstatSync(committed);
    const expected = JSON.stringify({ version: 1, bundleSha256: binding.bundleSha256 });
    if (!marker.isFile() || marker.isSymbolicLink() || marker.nlink !== 1 || marker.size !== expected.length ||
        fs.readFileSync(committed, 'utf8') !== expected) throw new Error('invalid_administrator_browser_commit');
    await serveAdministratorBrowser({ input: process.stdin, output: process.stdout,
      args: process.argv.slice(2), origin: binding.origin, ...actions });
  } catch {
    process.exitCode = 1;
    process.stderr.write('administrator_browser_bridge_unavailable\n');
  } finally { process.stdin.destroy(); }
}
