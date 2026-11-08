import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveLocalPath, verifyProviderStage } from './bootstrap.mjs';
import { createWinRegistry } from './registry-win.mjs';

const HOST = 'com.agentcontinue.device_wake';
const KEY = '\\Software\\Google\\Chrome\\NativeMessagingHosts\\' + HOST;
const here = path.dirname(fileURLToPath(import.meta.url));
const fail = code => { throw new Error(code); };
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const safeCmdPath = value => typeof value === 'string' && /^[A-Z]:\\[ -~]+$/i.test(value) &&
  !/[:"%!^&|<>()]/.test(value.slice(2)) && !value.slice(3).split('\\').some(part => !part || /[. ]$/.test(part));

function assertDirectory(file, original) {
  const current = fs.lstatSync(file, { bigint: true });
  if (!current.isDirectory() || current.isSymbolicLink() || current.ino === 0n ||
      original && !same(current, original)) fail('browser_wake_bundle_conflict');
  return current;
}

function assertFile(file, bytes) {
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.ino === 0n ||
      before.size !== BigInt(bytes.length) || !fs.readFileSync(file).equals(bytes) ||
      !same(before, fs.lstatSync(file, { bigint: true }))) fail('browser_wake_bundle_conflict');
  return before;
}

function put(file, bytes) {
  let fd;
  try { fd = fs.openSync(file, 'wx', 0o600); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (fd !== undefined) {
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
  }
  return assertFile(file, bytes);
}

function browserWakeLayout({ app, binding, node }) {
  if (process.platform !== 'win32') fail('unsupported_platform');
  if (!/^[a-p]{32}$/.test(binding?.extensionId ?? '') || typeof binding.assertCurrent !== 'function' ||
      !safeCmdPath(app) || !safeCmdPath(node) || path.basename(node).toLowerCase() !== 'node.exe') fail('browser_wake_invalid_install');
  const directory = path.join(app, 'browser-wake'), launcher = path.join(directory, 'wake.cmd');
  const manifest = path.join(directory, 'host.json');
  const origin = 'chrome-extension://' + binding.extensionId + '/';
  const environment = ['NODE_OPTIONS', 'NODE_PATH', 'NODE_CHANNEL_FD', 'NODE_CHANNEL_SERIALIZATION_MODE',
    'NODE_V8_COVERAGE', 'NODE_EXTRA_CA_CERTS', 'OPENSSL_CONF', 'SSLKEYLOGFILE',
    'CONTROL_PLANE_API_KEY', 'CONTROL_PLANE_TUNNEL_ID', 'AGENT_CONTINUE_TUNNEL_CLIENT'];
  // Chrome's first argument is the origin. Do not expand %* or forward window arguments.
  const cmd = Buffer.from(['@echo off', 'setlocal DisableDelayedExpansion', ...environment.map(name => 'set "' + name + '="'),
    '"' + node + '" "%~dp0..\\device-native-host.mjs" --browser-wake "%~1"', ''].join('\r\n'), 'ascii');
  const json = Buffer.from(JSON.stringify({ name: HOST, description: 'AgentContinue Windows browser wake',
    path: launcher, type: 'stdio', allowed_origins: [origin] }) + '\n');
  const views = ['32', '64'].flatMap(view => ['HKCU', 'HKLM'].map(hive => ({ view, hive, keyPath: hive + KEY })));
  return { directory, launcher, manifest, cmd, json, views };
}

export function preflightBrowserWake({ installDir, extensionId, node = process.execPath }) {
  browserWakeLayout({ app: path.join(installDir, 'app'), binding: { extensionId, assertCurrent() {} }, node });
  return { ok: true };
}

// Trusted installer entry, never called by the browser or by a native message.
export function publishBrowserWake({ app, binding, node, registry }) {
  const { directory, launcher, manifest, cmd, json, views } = browserWakeLayout({ app, binding, node });
  const readRegistry = () => {
    let own = false;
    for (const view of views) {
      let record;
      try { record = registry.inspect(view); } catch { fail('browser_wake_registry_unconfirmed'); }
      if (!record || typeof record.present !== 'boolean') fail('browser_wake_registry_unconfirmed');
      if (!record.present) continue;
      if (view.hive !== 'HKCU' || record.value !== manifest) fail('browser_wake_registry_conflict');
      own = true;
    }
    return own;
  };
  const appIdentity = assertDirectory(app);
  binding.assertCurrent();
  const registered = readRegistry();
  let directoryIdentity, launcherIdentity, manifestIdentity;
  try {
    if (!registered) {
      try { fs.mkdirSync(directory, { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    directoryIdentity = assertDirectory(directory);
    launcherIdentity = registered ? assertFile(launcher, cmd) : put(launcher, cmd);
    manifestIdentity = registered ? assertFile(manifest, json) : put(manifest, json);
  } catch { fail('browser_wake_bundle_conflict'); }
  const assertBundle = () => {
    try {
      binding.assertCurrent();
      assertDirectory(app, appIdentity);
      assertDirectory(directory, directoryIdentity);
      if (!same(launcherIdentity, assertFile(launcher, cmd)) ||
          !same(manifestIdentity, assertFile(manifest, json))) fail('browser_wake_bundle_conflict');
    } catch { fail('browser_wake_bundle_conflict'); }
  };
  let written = false;
  if (!readRegistry()) {
    assertBundle();
    try { written = registry.createOnly({ ...views[0], regSzValue: manifest }); }
    catch { fail('browser_wake_registry_unconfirmed'); }
    if (!readRegistry()) fail(written ? 'browser_wake_registry_unconfirmed' : 'browser_wake_registry_conflict');
  }
  assertBundle();
  return { ok: true, status: written ? 'written' : 'already-present', host: HOST,
    registered: true, launchVerified: false, activated: false, chatAuthorizationVerified: false };
}

export function inspectPublishedBrowserWake({ app, binding, node, registry }) {
  const layout = browserWakeLayout({ app, binding, node });
  let appIdentity;
  const assertOwner = () => {
    try { binding.assertCurrent(); assertDirectory(app, appIdentity); }
    catch { fail('browser_wake_invalid_install'); }
  };
  try { appIdentity = assertDirectory(app); } catch { fail('browser_wake_invalid_install'); }
  assertOwner();
  const inspectBundle = () => {
    try { fs.lstatSync(layout.directory); }
    catch (error) { return error.code === 'ENOENT' ? 'absent' : 'conflict'; }
    try {
      const directory = assertDirectory(layout.directory);
      assertFile(layout.launcher, layout.cmd);
      assertFile(layout.manifest, layout.json);
      assertDirectory(layout.directory, directory);
      return 'verified';
    } catch { return 'conflict'; }
  };
  const inspectRegistry = () => {
    return layout.views.map(view => {
      try {
        const entry = registry.inspect(view);
        if (!entry || typeof entry.present !== 'boolean') return 'unconfirmed';
        if (!entry.present) return 'absent';
        return view.hive === 'HKCU' && entry.value === layout.manifest ? 'owned' : 'conflict';
      } catch { return 'unconfirmed'; }
    });
  };
  const before = inspectBundle();
  const first = inspectRegistry(), second = inspectRegistry(), slots = [...first, ...second];
  const registryComplete = !slots.includes('unconfirmed') && first.every((state, index) => state === second[index]);
  const registration = slots.includes('conflict') ? 'conflict' : !registryComplete ? 'unconfirmed'
    : slots.includes('owned') ? 'matched' : 'absent';
  const after = inspectBundle();
  assertOwner();
  const bundle = before === after ? after : 'conflict';
  return { registration, registryComplete, bundle,
    registered: registration === 'matched' && bundle === 'verified' ? true : registration === 'absent' ? false : null,
    runtime: 'not-observed', mutationPerformed: false };
}

function recordedWakeNode(app, binding) {
  const file = path.join(app, 'browser-wake', 'wake.cmd');
  try {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 65536) return null;
    const bytes = fs.readFileSync(file);
    if (bytes.some(byte => byte > 127)) return null;
    const match = /"([A-Za-z]:\\[ -~]+)" "%~dp0\.\.\\device-native-host\.mjs" --browser-wake "%~1"\r\n$/.exec(bytes.toString('ascii'));
    if (!match) return null;
    const layout = browserWakeLayout({ app, binding, node: match[1] });
    assertDirectory(path.dirname(file));
    assertFile(file, layout.cmd);
    return match[1];
  } catch { return null; }
}

export async function inspectBrowserWake({ installDir, expectedExtensionId }, { packageRoot } = {}) {
  if (process.platform !== 'win32') fail('unsupported_platform');
  if (expectedExtensionId !== undefined && !/^[a-p]{32}$/.test(expectedExtensionId)) fail('invalid_arguments');
  let app, binding, inspectTunnelProfile;
  try {
    installDir = resolveLocalPath(installDir);
    app = path.join(installDir, 'app');
    await verifyProviderStage(installDir, packageRoot);
    const { readNativeBinding } = await import(pathToFileURL(path.join(app, 'device-owner.mjs')).href);
    binding = readNativeBinding(path.join(app, 'device-native-binding.json'));
    if (binding.root !== path.join(installDir, 'state')) fail('browser_wake_invalid_install');
    if (expectedExtensionId !== undefined && binding.extensionId !== expectedExtensionId) fail('setup_identity_mismatch');
    ({ inspectTunnelProfile } = await import(pathToFileURL(path.join(app, 'profile.mjs')).href));
    await verifyProviderStage(installDir, packageRoot);
    binding.assertCurrent();
  } catch (error) {
    if (expectedExtensionId !== undefined && (error.message === 'setup_identity_mismatch' ||
        ['EACCES', 'EPERM'].includes(error.code))) throw error;
    fail('browser_wake_invalid_install');
  }
  const currentNode = resolveLocalPath(process.execPath);
  const installedNode = recordedWakeNode(app, binding);
  const interpreterMismatch = installedNode !== null && installedNode.toLowerCase() !== currentNode.toLowerCase();
  let configurationVerified = null;
  const assertConfiguration = () => {
    try {
      binding.assertCurrent();
      if (interpreterMismatch) configurationVerified = false;
      else {
        let configured = false;
        try { configured = inspectTunnelProfile(binding.root).configured === true; } catch { /* Report missing interpreter evidence without a corruption verdict. */ }
        if (!configured && (installedNode !== null || configurationVerified === true)) fail('invalid');
        configurationVerified = configurationVerified === false ? false : configured;
      }
      binding.assertCurrent();
    } catch { fail('browser_wake_invalid_install'); }
  };
  assertConfiguration();
  const observation = inspectPublishedBrowserWake({ app, binding,
    node: installedNode ?? currentNode, registry: createWinRegistry() });
  try { await verifyProviderStage(installDir, packageRoot); } catch { fail('browser_wake_invalid_install'); }
  assertConfiguration();
  return { ok: true, mode: 'browser-managed', configuration: configurationVerified ? 'verified' : 'not-verified',
    interpreter: installedNode === null ? 'not-recorded' : interpreterMismatch ? 'mismatch' : 'matched', ...observation,
    chatAuthorizationVerified: false };
}

function existingResult(extensionId, status, reason, payloadManifestSha256 = null) {
  const matched = status === 'existing-matched';
  return { ok: matched, action: 'existing-install', mode: 'browser-managed', status, reason, extensionId,
    payloadManifestSha256, configuration: matched ? 'verified' : 'unconfirmed',
    registration: matched ? 'matched' : 'unconfirmed', runtime: 'not-observed', mutationPerformed: false,
    chatAuthorizationVerified: false, next: matched ? 'open-devices' : 'review-existing-installation',
    devicesUrl: matched ? `chrome-extension://${extensionId}/devices.html?mode=browser-managed` : null };
}

function snapshot(file) {
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.ino === 0n ||
      before.size <= 0n || before.size > 65536n) fail('browser_wake_invalid_install');
  const bytes = fs.readFileSync(file);
  const assertCurrent = () => {
    const after = fs.lstatSync(file, { bigint: true });
    if (!same(before, after) || before.size !== after.size || before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs || after.nlink !== 1n || !after.isFile() || after.isSymbolicLink() ||
        !fs.readFileSync(file).equals(bytes)) fail('browser_wake_invalid_install');
  };
  assertCurrent();
  return { bytes, assertCurrent, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

// This is recognition, not repair, registration, startup or fresh-install consent.
export async function inspectExistingBrowserWake({ installDir, extensionId }, { packageRoot = here } = {}) {
  if (process.platform !== 'win32') fail('unsupported_platform');
  if (typeof extensionId !== 'string' || !/^[a-p]{32}$/.test(extensionId)) fail('invalid_arguments');
  const result = (status, reason) => existingResult(extensionId, status, reason);
  try {
    const root = fs.lstatSync(installDir, { bigint: true });
    if (!root.isDirectory() || root.isSymbolicLink()) return result('existing-incompatible', 'invalid-root');
  } catch (error) {
    if (error.code === 'ENOENT') return result('existing-absent', 'missing-root');
    return result(['EACCES', 'EPERM'].includes(error.code) ? 'existing-denied' : 'existing-unconfirmed', 'root-unreadable');
  }
  try {
    installDir = resolveLocalPath(installDir);
    const root = assertDirectory(installDir), app = path.join(installDir, 'app');
    const binding = snapshot(path.join(app, 'device-native-binding.json'));
    const record = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(binding.bytes));
    if (binding.bytes.toString('utf8') !== JSON.stringify({ format: 'agent-continue-native-binding', version: 1,
      extensionId: record.extensionId, stateRoot: path.join(installDir, 'state') }) + '\n') {
      return result('existing-incompatible', 'binding-invalid');
    }
    if (record.extensionId !== extensionId) return result('existing-incompatible', 'extension-mismatch');
    const receipt = snapshot(path.join(installDir, 'setup-receipt.json'));
    const saved = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(receipt.bytes));
    const expected = { format: 'agent-continue-device-setup-result', version: 1, status: 'configured',
      providerVersion: '0.3.1', tunnelRelease: 'v0.0.19', target: 'windows', extensionId,
      nativeHost: 'com.agentcontinue.device_control', requestSha256: saved.requestSha256, configured: true,
      activated: false, authenticationVerified: false, nativeRegistrationVerified: false,
      chatAuthorizationVerified: false, protectedInstallationVerified: false, nativeDependenciesVerified: false };
    if (typeof saved.requestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(saved.requestSha256) ||
        receipt.bytes.toString('utf8') !== JSON.stringify(expected) + '\n') return result('existing-incompatible', 'receipt-invalid');
    // Capture the caller's release manifest; verifyProviderStage checks its complete
    // payload/lock/provider chain before any installed module is imported.
    const manifest = snapshot(resolveLocalPath(path.join(packageRoot, 'payload-manifest.json')));
    for (const name of ['state/binding.json', 'state/tunnel.yaml', 'app/browser-wake/wake.cmd', 'app/browser-wake/host.json']) {
      const file = resolveLocalPath(path.join(installDir, name));
      const info = fs.lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) return result('existing-incompatible', 'invalid-component');
    }
    const observation = await inspectBrowserWake({ installDir, expectedExtensionId: extensionId }, { packageRoot });
    binding.assertCurrent(); receipt.assertCurrent(); manifest.assertCurrent(); assertDirectory(installDir, root);
    if (observation.registration === 'conflict' || observation.bundle === 'conflict' || observation.interpreter === 'mismatch') {
      return result('existing-incompatible', 'registration-or-interpreter-mismatch');
    }
    if (observation.registration === 'absent' || observation.bundle === 'absent') return result('existing-partial', 'registration-missing');
    if (observation.registryComplete !== true || observation.registered !== true || observation.bundle !== 'verified' ||
        observation.registration !== 'matched' || observation.configuration !== 'verified' || observation.interpreter !== 'matched') {
      return result('existing-unconfirmed', 'verification-incomplete');
    }
    return existingResult(extensionId, 'existing-matched', 'verified', manifest.sha256);
  } catch (error) {
    const status = ['EACCES', 'EPERM'].includes(error.code) ? 'existing-denied' : error.code === 'ENOENT'
      ? 'existing-partial' : error.message === 'setup_identity_mismatch' ? 'existing-incompatible' : 'existing-unconfirmed';
    return result(status, 'verification-incomplete');
  }
}

export async function registerBrowserWake({ installDir, extensionId, consent }, { packageRoot, signal } = {}) {
  if (consent !== 'accept-browser-wake') fail('consent_required');
  if (process.platform !== 'win32') fail('unsupported_platform');
  if (!/^[a-p]{32}$/.test(extensionId ?? '')) fail('browser_wake_invalid_install');
  if (signal?.aborted) fail('setup_cancelled');
  let app, binding;
  try {
    installDir = resolveLocalPath(installDir);
    app = path.join(installDir, 'app');
    await verifyProviderStage(installDir, packageRoot);
    const { readNativeBinding } = await import(pathToFileURL(path.join(app, 'device-owner.mjs')).href);
    binding = readNativeBinding(path.join(app, 'device-native-binding.json'));
    if (binding.root !== path.join(installDir, 'state') || binding.extensionId !== extensionId) fail('browser_wake_invalid_install');
    const { inspectTunnelProfile } = await import(pathToFileURL(path.join(app, 'profile.mjs')).href);
    if (inspectTunnelProfile(binding.root).configured !== true) fail('browser_wake_invalid_install');
    await verifyProviderStage(installDir, packageRoot);
    binding.assertCurrent();
  } catch { fail('browser_wake_invalid_install'); }
  if (signal?.aborted) fail('setup_cancelled');
  for (const name of ['device-channel.json', 'controller.lease', 'device-operations.lease']) {
    try { fs.lstatSync(path.join(binding.root, name)); fail('browser_wake_owner_present'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return publishBrowserWake({ app, binding, node: resolveLocalPath(process.execPath), registry: createWinRegistry() });
}
