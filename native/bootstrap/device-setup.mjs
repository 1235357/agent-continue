import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveLocalPath, pathsOverlap, stageRuntime, verifyProviderStage } from './bootstrap.mjs';
import { acquireClient, validateClientInput } from './client-acquisition.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fail = code => { throw new Error(code); };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const serialize = value => JSON.stringify(value, null, 2) + '\n';

export function managerEnvironment(parent = process.env) {
  const env = {};
  for (const [key,value] of Object.entries(parent)) {
    if (/^(NODE_|NPM_|UV_|OPENSSL_|CONTROL_PLANE_|TUNNEL_|OPENAI_|DC_|DESKTOP_COMMANDER_)/i.test(key) ||
        /^(ICU_DATA|SSL_CERT_FILE|SSL_CERT_DIR|SSLKEYLOGFILE|ELECTRON_RUN_AS_NODE|VSCODE_INSPECTOR_OPTIONS)$/i.test(key)) continue;
    if (value !== undefined) env[key] = value;
  }
  return env;
}

const managerStarts = new Map();
const managerStatusTimeout = 10000;
const operationFile = 'installer-reconnect.json';
const operationIdOK = value => typeof value === 'string' && value.length === 36 &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const operationStatuses = new Set(['unobserved', 'in-progress', 'unknown-running', 'unknown', 'settled', 'not-executed']);

export function isManagerOperationFailure(value) {
  return record(value, ['ok', 'error', 'operationId', 'operationStatus'], true) &&
    value.ok === false && value.error === 'manager_start_unconfirmed' &&
    operationIdOK(value.operationId) && operationStatuses.has(value.operationStatus);
}

function operationFailure(operationId, operationStatus = 'unobserved') {
  return { ok: false, error: 'manager_start_unconfirmed', operationId, operationStatus };
}

function operationBytes(binding, id) {
  return Buffer.from(JSON.stringify({ format: 'agent-continue-installer-reconnect', version: 1,
    extensionId: binding.extensionId, id }) + '\n');
}

function readManagerOperation(binding) {
  try {
    binding.assertCurrent();
    const file = path.join(binding.root, operationFile);
    let entry;
    try { entry = fs.lstatSync(file, { bigint: true }); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (process.platform !== 'win32' && (entry.uid !== BigInt(process.getuid()) || (entry.mode & 0o077n) !== 0n)) {
      fail('manager_operation_receipt_invalid');
    }
    const bytes = boundedRead(file, 1024), value = JSON.parse(bytes.toString('utf8'));
    if (!operationIdOK(value?.id) || !bytes.equals(operationBytes(binding, value.id)) ||
        !sameInfo(entry, info(file, 1024))) fail('manager_operation_receipt_invalid');
    binding.assertCurrent();
    return value.id;
  } catch { fail('manager_operation_receipt_invalid'); }
}

function reserveManagerOperation(binding) {
  binding.assertCurrent();
  const id = crypto.randomUUID(), file = path.join(binding.root, operationFile);
  let fd;
  try { fd = fs.openSync(file, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') return null; fail('manager_operation_receipt_invalid'); }
  try {
    fs.writeFileSync(fd, operationBytes(binding, id));
    fs.fsyncSync(fd);
    if (process.platform !== 'win32') {
      const directory = fs.openSync(binding.root, fs.constants.O_RDONLY);
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    }
    if (!sameIdentity(fs.fstatSync(fd, { bigint: true }), info(file, 1024)) ||
        readManagerOperation(binding) !== id) fail('manager_operation_receipt_invalid');
    return id;
  } catch { fail('manager_operation_receipt_invalid'); }
  finally { fs.closeSync(fd); }
}

async function managerBinding(installDir, packageRoot) {
  await verifyProviderStage(installDir, packageRoot ?? here);
  const moduleFile = path.join(installDir, 'app', 'device-owner.mjs');
  const {readNativeBinding, sendDeviceRequest, pinDeviceChannel} = await import(pathToFileURL(moduleFile).href);
  const binding = readNativeBinding(path.join(installDir, 'app', 'device-native-binding.json'));
  if (path.resolve(binding.root) !== path.join(installDir,'state')) fail('setup_input_invalid');
  return { binding, sendDeviceRequest, pinDeviceChannel, moduleFile };
}

function managerObservation(response, operationId) {
  const state = response?.state, operation = state?.operation;
  if (response?.ok !== true || !state ||
      operation && (operation.id !== operationId || operation.action !== 'reconnect')) return operationFailure(operationId);
  return { ok: true, operationId, operationStatus: operation?.status ?? 'unobserved', managerRunning: true,
    connection: state.connection, paused: state.paused };
}

async function observeManagerOperation(binding, sendDeviceRequest, id) {
  try {
    const reply = await sendDeviceRequest(binding, { version: 1, id, action: 'status' }, { timeoutMs: managerStatusTimeout });
    if (readManagerOperation(binding) !== id) return operationFailure(id);
    return managerObservation(reply, id);
  } catch { return operationFailure(id); }
}

export async function observeLocalManagerOperation(installDir, trusted = {}) {
  const { binding, sendDeviceRequest } = await managerBinding(local(installDir), trusted.packageRoot);
  const id = readManagerOperation(binding);
  if (id === null) fail('manager_operation_not_recorded');
  return observeManagerOperation(binding, sendDeviceRequest, id);
}

export async function pinLocalManager(installDir) {
  const { binding, pinDeviceChannel } = await managerBinding(local(installDir));
  const pinned = pinDeviceChannel(binding);
  return Object.freeze({ extensionOrigin: 'chrome-extension://' + binding.extensionId,
    request: (id, action) => requestLocalManager({ installDir, id, action,
      ...(action === 'status' ? {} : { consent: 'accept-control' }) }, { pinned }) });
}

export async function requestLocalManager(options, trusted = {}) {
  if (!record(options, ['installDir', 'action', 'id', 'consent']) ||
      !['status', 'disconnect-and-pause', 'reconnect'].includes(options.action) ||
      (options.id !== undefined && !operationIdOK(options.id))) fail('setup_input_invalid');
  if (options.action !== 'status' && options.consent !== 'accept-control') fail('consent_required');
  const id = options.id ?? crypto.randomUUID();
  const { binding, sendDeviceRequest } = await managerBinding(local(options.installDir), trusted.packageRoot);
  try {
    const owner = trusted.pinned ?? binding;
    if (owner.origin !== binding.origin || owner.root !== binding.root) fail('device_binding_changed');
    const reply = await sendDeviceRequest(owner, { version: 1, id, action: options.action },
      { timeoutMs: options.action === 'status' ? managerStatusTimeout : 30000 });
    if (options.action === 'status') return reply;
    const state = reply.state;
    const succeeded = reply.ok && state?.operation?.status === 'settled' &&
      (options.action === 'reconnect' ? state.connection === 'ready' && state.paused === false
        : state.connection === 'disconnected' && state.paused === true);
    return { ...reply, ok: Boolean(succeeded) };
  } catch {
    // The owner may have acted. Return the ID for a read-only status check.
    return { ok: false, error: 'manager_control_unconfirmed', id, action: options.action };
  }
}

function connectionResult(observation) {
  const { operationId, operationStatus } = observation;
  if (!observation.ok || operationStatus !== 'settled' || observation.connection !== 'ready' || observation.paused !== false) {
    return operationFailure(operationId, operationStatus);
  }
  return { ok: true, managerRunning: true, connected: true, paused: false, operationId, operationStatus };
}

export async function startLocalManager(options = {}, trusted = {}) {
  if (options.consent !== 'accept-install') fail('consent_required');
  if (!record(options, ['installDir','consent','connect']) || typeof options.installDir !== 'string' ||
      (options.connect !== undefined && typeof options.connect !== 'boolean')) fail('setup_input_invalid');
  const installDir = local(options.installDir);
  const key = process.platform === 'win32' ? installDir.toLowerCase() : installDir;
  if (managerStarts.has(key)) {
    const active = managerStarts.get(key);
    if (active.connect !== (options.connect === true)) fail('manager_start_unconfirmed');
    return active.promise;
  }
  const pending = startManager(installDir, trusted, options.connect === true);
  const reservation = {promise:pending,connect:options.connect === true};
  managerStarts.set(key, reservation);
  try { return await pending; }
  finally { if (managerStarts.get(key) === reservation) managerStarts.delete(key); }
}

async function startManager(installDir, trusted, connect) {
  const { binding, sendDeviceRequest, moduleFile } = await managerBinding(installDir, trusted.packageRoot);
  const channel = path.join(installDir, 'state', 'device-channel.json');
  let deadline = performance.now() + managerStatusTimeout;
  const reconcile = async id => connectionResult(await observeManagerOperation(binding, sendDeviceRequest, id));
  const prior = connect ? readManagerOperation(binding) : null;
  if (prior !== null) return reconcile(prior);
  const status = () => {
    const timeoutMs = Math.floor(deadline - performance.now());
    if (timeoutMs < 1) fail('manager_start_unconfirmed');
    return sendDeviceRequest(binding, {version:1,id:crypto.randomUUID(),action:'status'}, {timeoutMs});
  };
  const finish = async response => {
    const current = receipt(response);
    if (!connect) return current;
    const id = reserveManagerOperation(binding);
    if (id === null) {
      const existing = readManagerOperation(binding);
      if (existing === null) fail('manager_operation_receipt_invalid');
      return reconcile(existing);
    }
    try {
      const connected = await sendDeviceRequest(binding, {version:1,id,action:'reconnect'}, {timeoutMs:30000});
      if (readManagerOperation(binding) !== id) return operationFailure(id);
      return connectionResult(managerObservation(connected, id));
    } catch { return operationFailure(id); }
  };
  const receipt = response => {
    if (response?.ok !== true || typeof response.state?.paused !== 'boolean') fail('manager_start_unconfirmed');
    return {ok:true,managerRunning:true,connected:response.state?.connection === 'ready',
      paused:response.state?.paused === true};
  };
  const useExistingOwner = async () => {
    let observed;
    try { observed = await status(); }
    catch { fail('manager_start_unconfirmed'); }
    return finish(observed);
  };
  if (fs.existsSync(channel)) return useExistingOwner();
  if (process.platform === 'win32') {
    // A moved PATH must not start an owner that cannot launch its bound profile.
    const { inspectTunnelProfile } = await import(pathToFileURL(path.join(installDir, 'app', 'profile.mjs')).href);
    let mismatch = false;
    try { inspectTunnelProfile(binding.root); }
    catch (error) {
      mismatch = error?.message === 'binding_changed';
      // Other profile failures retain the existing owner/status behavior.
    }
    binding.assertCurrent();
    deadline = performance.now() + managerStatusTimeout;
    if (fs.existsSync(channel)) return useExistingOwner();
    if (mismatch) fail('manager_profile_mismatch');
  }
  const spawn = trusted.spawn ?? (await import('node:child_process')).spawn;
  deadline = performance.now() + managerStatusTimeout;
  const child = spawn(process.execPath, [moduleFile], {cwd:path.join(installDir,'app'),
    detached:true,windowsHide:true,stdio:'ignore',shell:false,env:managerEnvironment()});
  let failed = false;
  child.once('error', () => {failed = true;});
  child.unref();
  while (performance.now() < deadline) {
    if (failed || child.exitCode !== null || child.signalCode !== null) fail('manager_start_unconfirmed');
    if (fs.existsSync(channel)) {
      let observed;
      try {observed = await status();} catch { /* IPC may still be opening. */ }
      if (observed) {
        return finish(observed);
      }
    }
    await new Promise(resolve => setTimeout(resolve,Math.min(100,Math.max(0,deadline-performance.now()))));
  }
  // Timeout is not proof of exit. Never launch a replacement or remove its lease.
  fail('manager_start_unconfirmed');
}
const requestKeys = ['format', 'version', 'target', 'extensionId', 'nativeHost'];
const errors = new Set(['consent_required', 'payload_invalid', 'invalid_install_path', 'destination_exists',
  'npm_unavailable', 'dependency_acquisition_failed', 'acquisition_exit_unconfirmed', 'provider_verification_failed',
  'receipt_write_failed', 'bootstrap_failed', 'provider_stage_invalid', 'unsupported_tunnel_platform',
  'client_input_invalid', 'client_exists', 'client_acquisition_failed', 'client_archive_invalid',
  'client_verification_failed', 'client_receipt_failed', 'setup_request_invalid', 'setup_target_mismatch', 'setup_identity_mismatch',
  'setup_input_invalid', 'setup_configuration_failed', 'setup_receipt_failed', 'setup_cancelled', 'unsupported_platform']);

function record(value, keys, complete = false) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    (!complete || Reflect.ownKeys(value).length === keys.length) &&
    Reflect.ownKeys(value).every(key => keys.includes(key) &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

function requestValue(value) {
  if (!record(value, requestKeys, true) || value.format !== 'agent-continue-device-setup' || value.version !== 1 ||
      !['windows', 'macos', 'linux', 'linux-server'].includes(value.target) ||
      typeof value.extensionId !== 'string' || !/^[a-p]{32}$/.test(value.extensionId) ||
      value.nativeHost !== (value.target === 'linux-server' ? null : 'com.agentcontinue.device_control')) {
    fail('setup_request_invalid');
  }
  return Object.freeze(Object.fromEntries(requestKeys.map(key => [key, value[key]])));
}

export function validateSetupRequest(value, platform = process.platform) {
  const request = requestValue(value);
  const targets = { win32: ['windows'], darwin: ['macos'], linux: ['linux', 'linux-server'] };
  if (typeof platform !== 'string' || !Object.hasOwn(targets, platform) || !targets[platform].includes(request.target)) {
    fail('setup_target_mismatch');
  }
  return request;
}

function local(value) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) fail('setup_input_invalid');
  const resolved = resolveLocalPath(value), root = path.parse(resolved).root;
  if (process.platform === 'win32' && resolved.slice(root.length).split(path.sep).some(part => /[<>:"|?*]|[. ]$/.test(part))) {
    fail('setup_input_invalid');
  }
  return resolved;
}

function info(file, limit) {
  const stat = fs.lstatSync(local(file), { bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n || stat.ino === 0n || stat.size < 1n || stat.size > BigInt(limit)) fail('setup_input_invalid');
  return stat;
}

const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino;
const sameInfo = (a, b) => sameIdentity(a, b) && ['size', 'mtimeNs', 'ctimeNs', 'mode', 'uid', 'gid', 'nlink']
  .every(key => a[key] === b[key]);

function boundedRead(file, limit, excludedIdentity) {
  file = local(file);
  const before = info(file, limit);
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || !sameInfo(before, opened) ||
        (excludedIdentity && sameIdentity(opened, excludedIdentity))) fail('setup_input_invalid');
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) fail('setup_input_invalid');
      offset += count;
    }
    if (!sameInfo(opened, fs.fstatSync(fd, { bigint: true })) || !sameInfo(opened, info(file, limit))) fail('setup_input_invalid');
    return bytes;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function readRequest(file, excludedIdentity) {
  try {
    const bytes = boundedRead(file, 4096, excludedIdentity);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const request = requestValue(JSON.parse(text));
    if (!bytes.equals(Buffer.from(serialize(request)))) fail('setup_request_invalid');
    return { request, sha256: hash(bytes) };
  } catch { fail('setup_request_invalid'); }
}

export function readSetupRequest(file) { return readRequest(file); }

function keyInfo(file) {
  const stat = info(file, 65536);
  if (process.platform !== 'win32' && (stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o077n) !== 0n)) fail('setup_input_invalid');
  return stat;
}

// Only metadata is inspected here: acquisition must never consume the key as data.
function preflight(options, trusted) {
  const installDir = local(options.installDir), packageRoot = local(trusted.packageRoot ?? here);
  const key = local(options.runtimeKeyFile), keyStat = keyInfo(key);
  const requestFile = options.guidedExtensionId === undefined ? local(options.setupRequestFile) : undefined;
  const archive = options.offlineArchive === undefined ? undefined : local(options.offlineArchive);
  const cache = options.offlineCache === undefined ? undefined : local(options.offlineCache);
  if ((requestFile !== undefined && (sameIdentity(keyStat, info(requestFile, 4096)) || pathsOverlap(key, requestFile))) ||
      (archive !== undefined && (sameIdentity(keyStat, info(archive, 64 * 1024 * 1024)) || pathsOverlap(key, archive)))) fail('setup_input_invalid');
  const nodeDir = path.dirname(fs.realpathSync(process.execPath));
  const candidates = trusted.npmCli === undefined ? [process.env.npm_execpath,
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(nodeDir, '../lib/node_modules/npm/bin/npm-cli.js')] : [trusted.npmCli];
  const excluded = [installDir, packageRoot, nodeDir, ...(cache ? [cache] : [])];
  for (const candidate of candidates.filter(value => value !== undefined)) {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
      if (trusted.npmCli !== undefined) fail('setup_input_invalid');
      continue;
    }
    let resolved;
    try { resolved = fs.realpathSync(candidate); }
    catch (error) { if (error.code !== 'ENOENT') throw error; resolved = path.resolve(candidate); }
    excluded.push(path.dirname(path.dirname(resolved)));
  }
  if (excluded.some(root => pathsOverlap(key, root))) fail('setup_input_invalid');
  try { fs.lstatSync(installDir); fail('destination_exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!sameInfo(keyStat, keyInfo(key))) fail('setup_input_invalid');
  return { installDir, packageRoot, key, keyStat, requestFile };
}

function expectResult(value, expected) {
  if (!record(value, Object.keys(expected), true) || Object.keys(expected).some(key => value[key] !== expected[key])) {
    fail('setup_configuration_failed');
  }
}

function clientReceipt(platform, pin) {
  return { format: 'agent-continue-device-acquisition', version: 1, status: 'acquired',
    providerVersion: '0.3.1', tunnelRelease: 'v0.0.19', platform, executableSha256: pin.executableSha256,
    configured: false, activated: false, protectedInstallationVerified: false, nativeDependenciesVerified: false };
}

function verifyClient(input, excludedIdentity) {
  try {
    const client = path.join(input.installDir, 'client'), pin = input.pin;
    const executable = path.join(client, input.platform.startsWith('win32-') ? 'tunnel-client-runtime.exe' : 'tunnel-client-runtime');
    const receipt = boundedRead(path.join(client, 'receipt.json'), 16384, excludedIdentity);
    if (!receipt.equals(Buffer.from(JSON.stringify(clientReceipt(input.platform, pin)) + '\n')) ||
        hash(boundedRead(path.join(client, 'release.zip'), 64 * 1024 * 1024, excludedIdentity)) !== pin.archiveSha256 ||
        hash(boundedRead(executable, 128 * 1024 * 1024, excludedIdentity)) !== pin.executableSha256 ||
        hash(boundedRead(path.join(client, pin.asset.slice(0, -4) + '.spdx.json'), 2 * 1024 * 1024, excludedIdentity)) !== pin.spdxSha256) {
      fail('client_verification_failed');
    }
    return executable;
  } catch { fail('client_verification_failed'); }
}

export async function setupManager(options, trusted = {}) {
  try {
    const consent = options && Object.getOwnPropertyDescriptor(options, 'consent');
    if (!consent || !Object.hasOwn(consent, 'value') || consent.value !== 'full-account') fail('consent_required');
    if (!record(options, ['installDir', 'consent', 'setupRequestFile', 'offlineCache', 'signal']) ||
        !record(trusted, ['packageRoot', 'npmCli', 'acquisitionTimeoutMs']) ||
        typeof options.installDir !== 'string' || typeof options.setupRequestFile !== 'string' ||
        (options.offlineCache !== undefined && typeof options.offlineCache !== 'string') ||
        (options.signal !== undefined && !(options.signal instanceof AbortSignal)) ||
        (trusted.acquisitionTimeoutMs !== undefined && (!Number.isSafeInteger(trusted.acquisitionTimeoutMs) ||
          trusted.acquisitionTimeoutMs < 20))) fail('setup_input_invalid');
    const input = Object.fromEntries(Reflect.ownKeys(options).map(key => [key, options[key]]));
    const dependencies = Object.fromEntries(Reflect.ownKeys(trusted).map(key => [key, trusted[key]]));
    const cancelled = () => { if (input.signal?.aborted) fail('setup_cancelled'); };
    cancelled();
    let installDir, packageRoot, requestFile;
    try {
      installDir = local(input.installDir); packageRoot = local(dependencies.packageRoot ?? here);
      if (pathsOverlap(installDir, packageRoot)) fail('setup_input_invalid');
      try { fs.lstatSync(installDir); fail('destination_exists'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      requestFile = local(input.setupRequestFile);
    } catch (error) { fail(error.message === 'destination_exists' ? error.message : 'setup_input_invalid'); }
    const snapshot = readRequest(requestFile), request = validateSetupRequest(snapshot.request);
    if (request.nativeHost === null) fail('setup_target_mismatch');
    const unchanged = () => {
      cancelled();
      if (local(input.setupRequestFile) !== requestFile || readRequest(requestFile).sha256 !== snapshot.sha256) fail('setup_request_invalid');
    };
    await stageRuntime({ installDir, consent: 'acquire-provider',
      ...(input.offlineCache !== undefined ? { offlineCache: input.offlineCache } : {}),
      ...(input.signal !== undefined ? { signal: input.signal } : {}) }, { packageRoot,
      ...(dependencies.npmCli !== undefined ? { npmCli: dependencies.npmCli } : {}),
      ...(dependencies.acquisitionTimeoutMs !== undefined ? { acquisitionTimeoutMs: dependencies.acquisitionTimeoutMs } : {}) });
    unchanged();
    const app = path.join(installDir, 'app'), state = path.join(installDir, 'state');
    const directories = [installDir, app].map(file => ({ file, identity: fs.lstatSync(file, { bigint: true }) }));
    const checkInstall = () => {
      try {
        for (const { file, identity } of directories) {
          const current = fs.lstatSync(local(file), { bigint: true });
          if (!current.isDirectory() || current.ino === 0n || !sameIdentity(current, identity) ||
              process.platform !== 'win32' && (current.uid !== BigInt(process.getuid()) || (current.mode & 0o077n) !== 0n)) fail('setup_configuration_failed');
        }
      } catch { fail('setup_configuration_failed'); }
    };
    checkInstall();
    await verifyProviderStage(installDir, packageRoot);
    checkInstall(); unchanged();
    const runtime = await import(pathToFileURL(path.join(app, 'runtime.mjs')).href);
    checkInstall(); unchanged();
    const owner = await import(pathToFileURL(path.join(app, 'device-owner.mjs')).href);
    checkInstall(); unchanged();
    expectResult(runtime.prepareState(state, { consent: 'full-account' }),
      { prepared: true, activated: false, protectedInstallationVerified: false });
    const nativeFile = path.join(app, 'device-native-binding.json');
    const bindingBytes = JSON.stringify({ format: 'agent-continue-native-binding', version: 1,
      extensionId: request.extensionId, stateRoot: state }) + '\n';
    fs.writeFileSync(nativeFile, bindingBytes, { flag: 'wx', mode: 0o600 });
    const nativeInfo = info(nativeFile, 16384), binding = owner.readNativeBinding(nativeFile);
    const checkBinding = () => {
      try {
        checkInstall();
        if (!sameInfo(nativeInfo, info(nativeFile, 16384)) ||
            !boundedRead(nativeFile, 16384).equals(Buffer.from(bindingBytes)) ||
            binding.root !== state || binding.extensionId !== request.extensionId) fail('setup_configuration_failed');
        binding.assertCurrent();
      } catch { fail('setup_configuration_failed'); }
    };
    checkBinding(); unchanged();
    try { await verifyProviderStage(installDir, packageRoot); }
    catch { fail('setup_configuration_failed'); }
    checkBinding(); unchanged();
    const receipt = { format: 'agent-continue-manager-setup-result', version: 1, status: 'prepared', providerVersion: '0.3.1',
      target: request.target, extensionId: request.extensionId, nativeHost: request.nativeHost,
      requestSha256: snapshot.sha256, prepared: true, localTunnelConfigured: false, activated: false,
      authenticationVerified: false, nativeRegistrationVerified: false, chatAuthorizationVerified: false,
      protectedInstallationVerified: false, nativeDependenciesVerified: false };
    const bytes = Buffer.from(JSON.stringify(receipt) + '\n'), pending = path.join(installDir, 'manager.pending.' + crypto.randomUUID());
    let receiptFd;
    try {
      receiptFd = fs.openSync(pending, 'wx', 0o600);
      const pendingInfo = fs.fstatSync(receiptFd, { bigint: true });
      fs.writeFileSync(receiptFd, bytes);
      const writtenInfo = fs.fstatSync(receiptFd, { bigint: true });
      if (!sameIdentity(pendingInfo, writtenInfo) || !sameInfo(writtenInfo, info(pending, 16384)) ||
          !boundedRead(pending, 16384).equals(bytes)) fail('setup_receipt_failed');
      checkBinding(); unchanged();
      if (!sameInfo(writtenInfo, info(pending, 16384))) fail('setup_receipt_failed');
      fs.linkSync(pending, path.join(installDir, 'manager-receipt.json'));
    } catch (error) {
      fail(['setup_cancelled', 'setup_configuration_failed', 'setup_request_invalid'].includes(error.message) ? error.message : 'setup_receipt_failed');
    } finally {
      try { if (receiptFd !== undefined) fs.closeSync(receiptFd); } catch { /* Successful commitment wins over cleanup. */ }
      try { fs.unlinkSync(pending); } catch { /* Successful commitment wins over cleanup. */ }
    }
    return receipt;
  } catch (error) { fail(errors.has(error?.message) ? error.message : 'setup_configuration_failed'); }
}

export function setupDevice(options, trusted = {}) {
  return configureDevice(options, trusted);
}

export function setupServer(options, trusted = {}) {
  return configureDevice(options, trusted, true);
}

async function configureDevice(options, trusted, serverOnly = false) {
  try {
    const consent = options && Object.getOwnPropertyDescriptor(options, 'consent');
    if (!consent || !Object.hasOwn(consent, 'value') || consent.value !== 'full-account') fail('consent_required');
    if (serverOnly && process.platform !== 'linux') fail('unsupported_platform');
    if (!record(options, ['installDir', 'consent', 'setupRequestFile', 'tunnelId', 'runtimeKeyFile', 'offlineCache', 'offlineArchive', 'signal','privateRuntime', 'expectedExtensionId', 'guidedExtensionId']) ||
        !record(trusted, ['packageRoot', 'npmCli', 'acquisitionTimeoutMs', 'fetchImpl']) ||
        (options.privateRuntime!==undefined && (typeof options.privateRuntime!=='boolean' ||
          options.privateRuntime===true && process.platform!=='win32')) ||
        (options.signal !== undefined && !(options.signal instanceof AbortSignal)) ||
        (options.expectedExtensionId !== undefined && (typeof options.expectedExtensionId !== 'string' ||
          options.expectedExtensionId.length !== 32 || !/^[a-p]{32}$/.test(options.expectedExtensionId))) ||
        (options.guidedExtensionId !== undefined && (process.platform !== 'win32' ||
          typeof options.guidedExtensionId !== 'string' || options.guidedExtensionId.length !== 32 ||
          !/^[a-p]{32}$/.test(options.guidedExtensionId) || options.setupRequestFile !== undefined ||
          options.expectedExtensionId !== undefined || options.privateRuntime === true)) ||
        (trusted.fetchImpl !== undefined && typeof trusted.fetchImpl !== 'function') ||
        (trusted.acquisitionTimeoutMs !== undefined && (!Number.isSafeInteger(trusted.acquisitionTimeoutMs) || trusted.acquisitionTimeoutMs < 20)) ||
        typeof options.tunnelId !== 'string' || !/^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$/.test(options.tunnelId)) fail('setup_input_invalid');
    const cancelled = () => { if (options.signal?.aborted) fail('setup_cancelled'); };
    cancelled();
    let context;
    try { context = preflight(options, trusted); }
    catch (error) { fail(error.message === 'destination_exists' ? error.message : 'setup_input_invalid'); }
    const snapshot = context.requestFile !== undefined ? readRequest(context.requestFile, context.keyStat) : (() => {
      const request = requestValue({ format: 'agent-continue-device-setup', version: 1, target: 'windows',
        extensionId: options.guidedExtensionId, nativeHost: 'com.agentcontinue.device_control' });
      return { request, sha256: hash(Buffer.from(serialize(request))) };
    })();
    validateSetupRequest(snapshot.request);
    if (serverOnly && snapshot.request.target !== 'linux-server') fail('setup_target_mismatch');
    if (options.expectedExtensionId !== undefined && options.expectedExtensionId !== snapshot.request.extensionId) fail('setup_identity_mismatch');
    const clientOptions = { installDir: context.installDir, consent: 'full-account',
      ...(options.offlineArchive !== undefined ? { offlineArchive: options.offlineArchive } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}) };
    const clientTrusted = { packageRoot: context.packageRoot,
      ...(trusted.fetchImpl !== undefined ? { fetchImpl: trusted.fetchImpl } : {}) };
    const input = validateClientInput(clientOptions, clientTrusted);
    const unchanged = () => {
      cancelled();
      if (!sameInfo(context.keyStat, keyInfo(context.key))) fail('setup_input_invalid');
      if (context.requestFile !== undefined && readRequest(context.requestFile, context.keyStat).sha256 !== snapshot.sha256) {
        fail('setup_request_invalid');
      }
    };
    unchanged();
    await stageRuntime({ installDir: context.installDir, consent: 'acquire-provider',
      ...(options.offlineCache !== undefined ? { offlineCache: options.offlineCache } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}) },
    { packageRoot: context.packageRoot, ...(trusted.npmCli !== undefined ? { npmCli: trusted.npmCli } : {}),
      ...(trusted.acquisitionTimeoutMs !== undefined ? { acquisitionTimeoutMs: trusted.acquisitionTimeoutMs } : {}) });
    unchanged();
    await acquireClient(clientOptions, clientTrusted);
    unchanged();
    await verifyProviderStage(context.installDir, context.packageRoot);
    const executable = verifyClient(input, context.keyStat), app = path.join(context.installDir, 'app');
    const runtime = await import(pathToFileURL(path.join(app, 'runtime.mjs')).href);
    const profile = await import(pathToFileURL(path.join(app, 'profile.mjs')).href);
    unchanged();
    const state = path.join(context.installDir, 'state');
    expectResult(runtime.prepareState(state, { consent: 'full-account' }),
      { prepared: true, activated: false, protectedInstallationVerified: false });
    unchanged();
    expectResult(profile.writeTunnelProfile(state, { tunnelId: options.tunnelId,
      runtimeKeyFile: context.key, tunnelExecutable: executable,
      ...(options.privateRuntime===true ? {privateRuntime:true} : {}) }),
    { configured: true, activated: false, authenticationVerified: false });
    expectResult(profile.inspectTunnelProfile(state),
      { configured: true, activation: 'not-observed', authenticationVerified: false });
    const nativeFile = path.join(app, 'device-native-binding.json');
    const nativeBytes = JSON.stringify({ format: 'agent-continue-native-binding', version: 1,
      extensionId: snapshot.request.extensionId, stateRoot: state }) + '\n';
    let nativeInfo;
    if (snapshot.request.nativeHost !== null) {
      fs.writeFileSync(nativeFile, nativeBytes, { flag: 'wx', mode: 0o600 });
      nativeInfo = info(nativeFile, 16384);
    }
    const checkNativeBinding = () => {
      try {
        if (snapshot.request.nativeHost === null) {
          try { fs.lstatSync(nativeFile); fail('setup_configuration_failed'); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          return;
        }
        const current = info(nativeFile, 16384);
        if (!sameInfo(nativeInfo, current) || process.platform !== 'win32' &&
            (current.uid !== BigInt(process.getuid()) || (current.mode & 0o077n) !== 0n) ||
            !boundedRead(nativeFile, 16384, context.keyStat).equals(Buffer.from(nativeBytes))) fail('setup_configuration_failed');
      } catch { fail('setup_configuration_failed'); }
    };
    checkNativeBinding();
    await verifyProviderStage(context.installDir, context.packageRoot);
    verifyClient(input, context.keyStat);
    unchanged();
    expectResult(profile.inspectTunnelProfile(state),
      { configured: true, activation: 'not-observed', authenticationVerified: false });
    checkNativeBinding();
    cancelled();
    const request = snapshot.request;
    const receipt = { format: 'agent-continue-device-setup-result', version: 1, status: 'configured',
      providerVersion: '0.3.1', tunnelRelease: 'v0.0.19', target: request.target,
      extensionId: request.extensionId, nativeHost: request.nativeHost, requestSha256: snapshot.sha256,
      configured: true, activated: false, authenticationVerified: false, nativeRegistrationVerified: false,
      chatAuthorizationVerified: false, protectedInstallationVerified: false, nativeDependenciesVerified: false };
    const pending = path.join(context.installDir, 'setup.pending.' + crypto.randomUUID());
    try {
      fs.writeFileSync(pending, JSON.stringify(receipt) + '\n', { flag: 'wx', mode: 0o600 });
      cancelled();
      checkNativeBinding();
      fs.linkSync(pending, path.join(context.installDir, 'setup-receipt.json'));
    } catch (error) { fail(['setup_cancelled', 'setup_configuration_failed'].includes(error.message) ? error.message : 'setup_receipt_failed'); }
    finally { try { fs.unlinkSync(pending); } catch { /* Successful commitment wins over cleanup. */ } }
    return receipt;
  } catch (error) { fail(errors.has(error?.message) ? error.message : 'setup_configuration_failed'); }
}
