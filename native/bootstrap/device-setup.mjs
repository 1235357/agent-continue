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
const requestKeys = ['format', 'version', 'target', 'extensionId', 'nativeHost'];
const errors = new Set(['consent_required', 'payload_invalid', 'invalid_install_path', 'destination_exists',
  'npm_unavailable', 'dependency_acquisition_failed', 'acquisition_exit_unconfirmed', 'provider_verification_failed',
  'receipt_write_failed', 'bootstrap_failed', 'provider_stage_invalid', 'unsupported_tunnel_platform',
  'client_input_invalid', 'client_exists', 'client_acquisition_failed', 'client_archive_invalid',
  'client_verification_failed', 'client_receipt_failed', 'setup_request_invalid', 'setup_target_mismatch',
  'setup_input_invalid', 'setup_configuration_failed', 'setup_receipt_failed', 'setup_cancelled']);

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
  const key = local(options.runtimeKeyFile), requestFile = local(options.setupRequestFile);
  const keyStat = keyInfo(key), requestStat = info(requestFile, 4096);
  const archive = options.offlineArchive === undefined ? undefined : local(options.offlineArchive);
  const cache = options.offlineCache === undefined ? undefined : local(options.offlineCache);
  if (sameIdentity(keyStat, requestStat) || pathsOverlap(key, requestFile) ||
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

export async function setupDevice(options, trusted = {}) {
  try {
    const consent = options && Object.getOwnPropertyDescriptor(options, 'consent');
    if (!consent || !Object.hasOwn(consent, 'value') || consent.value !== 'full-account') fail('consent_required');
    if (!record(options, ['installDir', 'consent', 'setupRequestFile', 'tunnelId', 'runtimeKeyFile', 'offlineCache', 'offlineArchive', 'signal']) ||
        !record(trusted, ['packageRoot', 'npmCli', 'acquisitionTimeoutMs', 'fetchImpl']) ||
        (options.signal !== undefined && !(options.signal instanceof AbortSignal)) ||
        (trusted.fetchImpl !== undefined && typeof trusted.fetchImpl !== 'function') ||
        (trusted.acquisitionTimeoutMs !== undefined && (!Number.isInteger(trusted.acquisitionTimeoutMs) || trusted.acquisitionTimeoutMs < 20 || trusted.acquisitionTimeoutMs > 180000)) ||
        typeof options.tunnelId !== 'string' || !/^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$/.test(options.tunnelId)) fail('setup_input_invalid');
    const cancelled = () => { if (options.signal?.aborted) fail('setup_cancelled'); };
    cancelled();
    let context;
    try { context = preflight(options, trusted); }
    catch (error) { fail(error.message === 'destination_exists' ? error.message : 'setup_input_invalid'); }
    const snapshot = readRequest(context.requestFile, context.keyStat);
    validateSetupRequest(snapshot.request);
    const clientOptions = { installDir: context.installDir, consent: 'full-account',
      ...(options.offlineArchive !== undefined ? { offlineArchive: options.offlineArchive } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}) };
    const clientTrusted = { packageRoot: context.packageRoot,
      ...(trusted.fetchImpl !== undefined ? { fetchImpl: trusted.fetchImpl } : {}) };
    const input = validateClientInput(clientOptions, clientTrusted);
    const unchanged = () => {
      cancelled();
      if (!sameInfo(context.keyStat, keyInfo(context.key))) fail('setup_input_invalid');
      if (readRequest(context.requestFile, context.keyStat).sha256 !== snapshot.sha256) fail('setup_request_invalid');
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
      runtimeKeyFile: context.key, tunnelExecutable: executable }),
    { configured: true, activated: false, authenticationVerified: false });
    expectResult(profile.inspectTunnelProfile(state),
      { configured: true, activation: 'not-observed', authenticationVerified: false });
    await verifyProviderStage(context.installDir, context.packageRoot);
    verifyClient(input, context.keyStat);
    unchanged();
    expectResult(profile.inspectTunnelProfile(state),
      { configured: true, activation: 'not-observed', authenticationVerified: false });
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
      fs.linkSync(pending, path.join(context.installDir, 'setup-receipt.json'));
    } catch (error) { fail(error.message === 'setup_cancelled' ? error.message : 'setup_receipt_failed'); }
    finally { try { fs.unlinkSync(pending); } catch { /* Successful commitment wins over cleanup. */ } }
    return receipt;
  } catch (error) { fail(errors.has(error?.message) ? error.message : 'setup_configuration_failed'); }
}
