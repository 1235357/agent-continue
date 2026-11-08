import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const windows = { skip: process.platform !== 'win32' };
const extensionId = 'a'.repeat(32);
const bootstrap = new URL('../native/bootstrap/', import.meta.url);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, 'ac-current-adoption-'));
  t.after(() => {
    assert.equal(path.dirname(root), parent);
    assert.equal(fs.realpathSync(root), root);
    fs.rmSync(root, { recursive: true });
  });
  const pkg = path.join(root, 'package'), install = path.join(root, 'installed');
  const app = path.join(install, 'app'), state = path.join(install, 'state');
  fs.mkdirSync(pkg); fs.mkdirSync(app, { recursive: true }); fs.mkdirSync(state);
  for (const name of ['browser-wake-registration.mjs', 'bin.mjs']) {
    fs.copyFileSync(new URL(name, bootstrap), path.join(pkg, name));
  }
  const mocks = {
    'bootstrap.mjs': `export const observations={verify:0,error:null};
export const resolveLocalPath=value=>value;
export async function verifyProviderStage(){observations.verify++;if(observations.error)throw observations.error;}
export function stageRuntime(){throw Error('unexpected acquisition');}`,
    'registry-win.mjs': `export const observations={inspect:0,values:new Map(),error:null};
export function createWinRegistry(){return {inspect(plan){observations.inspect++;observations.onInspect?.();
if(observations.error)throw observations.error;
const key=plan.view+':'+plan.hive;return observations.values.has(key)?{present:true,value:observations.values.get(key)}:{present:false};},
createOnly(){throw Error('unexpected registry publication');}};}`,
    'payload-layout.mjs': 'export const BOOTSTRAP_VERSION="fixture";',
    'client-acquisition.mjs': 'export function acquireClient(){throw Error("unexpected client acquisition");} export function validateClientInput(){throw Error("unexpected client preflight");}',
    'device-enrollment.mjs': 'export function enrollSshTarget(){throw Error("unexpected enrollment");}',
    'device-setup.mjs': `export const observations={setup:0};
export function setupDevice(){observations.setup++;throw Error('unexpected setup');}
export const setupServer=setupDevice,setupManager=setupDevice,startLocalManager=setupDevice,observeLocalManagerOperation=setupDevice,requestLocalManager=setupDevice;
export function readSetupRequest(){throw Error('unexpected request read');}`,
  };
  for (const [name, bytes] of Object.entries(mocks)) fs.writeFileSync(path.join(pkg, name), bytes);
  fs.writeFileSync(path.join(pkg, 'payload-manifest.json'), '{"fixture":"verified only by test double"}\n');
  const binding = { format: 'agent-continue-native-binding', version: 1, extensionId, stateRoot: state };
  fs.writeFileSync(path.join(app, 'device-native-binding.json'), JSON.stringify(binding) + '\n');
  fs.writeFileSync(path.join(app, 'device-owner.mjs'), `import fs from 'node:fs';
export function readNativeBinding(file){const bytes=fs.readFileSync(file,'utf8'),value=JSON.parse(bytes);
return {root:value.stateRoot,extensionId:value.extensionId,assertCurrent(){if(fs.readFileSync(file,'utf8')!==bytes)throw Error('binding changed');}};}`);
  fs.writeFileSync(path.join(app, 'profile.mjs'), 'export function inspectTunnelProfile(){return {configured:true};}');
  fs.writeFileSync(path.join(state, 'binding.json'), 'fixture configuration, not credentials');
  fs.writeFileSync(path.join(state, 'tunnel.yaml'), 'fixture configuration, not credentials');
  const receipt = { format: 'agent-continue-device-setup-result', version: 1, status: 'configured',
    providerVersion: '0.3.1', tunnelRelease: 'v0.0.19', target: 'windows', extensionId,
    nativeHost: 'com.agentcontinue.device_control', requestSha256: 'b'.repeat(64), configured: true,
    activated: false, authenticationVerified: false, nativeRegistrationVerified: false,
    chatAuthorizationVerified: false, protectedInstallationVerified: false, nativeDependenciesVerified: false };
  fs.writeFileSync(path.join(install, 'setup-receipt.json'), JSON.stringify(receipt) + '\n');
  const module = await import(pathToFileURL(path.join(pkg, 'browser-wake-registration.mjs')).href);
  const provider = (await import(pathToFileURL(path.join(pkg, 'bootstrap.mjs')).href)).observations;
  const registry = (await import(pathToFileURL(path.join(pkg, 'registry-win.mjs')).href)).observations;
  const calls = [];
  module.publishBrowserWake({ app, binding: { extensionId, assertCurrent() {} }, node: process.execPath,
    registry: { inspect(plan) {
      const key = plan.view + ':' + plan.hive;
      return registry.values.has(key) ? { present: true, value: registry.values.get(key) } : { present: false };
    }, createOnly(plan) {
      calls.push(plan); registry.values.set(plan.view + ':' + plan.hive, plan.regSzValue); return true;
    } } });
  const { main } = await import(pathToFileURL(path.join(pkg, 'bin.mjs')).href);
  const device = (await import(pathToFileURL(path.join(pkg, 'device-setup.mjs')).href)).observations;
  return { root, pkg, install, app, state, module, main, provider, registry, device, calls };
}

function snapshot(root) {
  return Object.fromEntries(fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => {
      const file = path.join(entry.parentPath, entry.name);
      return [path.relative(root, file), hash(fs.readFileSync(file))];
    }));
}

async function withoutMutations(body) {
  const saved = new Map();
  for (const name of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'unlinkSync', 'rmSync', 'renameSync', 'linkSync', 'symlinkSync']) {
    saved.set(name, fs[name]);
    fs[name] = () => { throw Error('unexpected mutation: ' + name); };
  }
  const uuid = crypto.randomUUID;
  crypto.randomUUID = () => { throw Error('unexpected operation allocation'); };
  try { return await body(); }
  finally {
    for (const [name, value] of saved) fs[name] = value;
    crypto.randomUUID = uuid;
  }
}

test('existing current-account adoption is matched only for the complete requested identity', windows, async t => {
  const f = await fixture(t), before = snapshot(f.install);
  const result = await withoutMutations(() => f.module.inspectExistingBrowserWake({ installDir: f.install, extensionId }));
  assert.equal(result.ok, true);
  assert.equal(result.status, 'existing-matched');
  assert.equal(result.extensionId, extensionId);
  assert.equal(result.payloadManifestSha256, hash(fs.readFileSync(path.join(f.pkg, 'payload-manifest.json'))));
  assert.equal(result.configuration, 'verified');
  assert.equal(result.registration, 'matched');
  assert.equal(result.next, 'open-devices');
  assert.equal(result.devicesUrl, `chrome-extension://${extensionId}/devices.html?mode=browser-managed`);
  assert.equal(result.runtime, 'not-observed');
  assert.equal(result.mutationPerformed, false);
  assert.equal(f.device.setup, 0);
  assert.ok(f.provider.verify >= 2);
  assert.deepEqual(snapshot(f.install), before);
});

test('existing adoption preserves paused and revoked state and never dispatches setup', windows, async t => {
  for (const revoked of [false, true]) {
    const f = await fixture(t);
    fs.writeFileSync(path.join(f.state, 'lifecycle.json'), '{"paused":true}\n');
    if (revoked) fs.writeFileSync(path.join(f.state, 'owner-revoked'), 'retained revocation');
    fs.writeFileSync(path.join(f.state, 'installer-reconnect.json'), '{"operationId":"do-not-replay"}\n');
    const before = snapshot(f.install);
    const result = await withoutMutations(() => f.main(['install-local', '--install-dir', f.install, '--consent', 'accept-install',
      '--guided-extension-id', extensionId, '--browser-managed', 'true', '--tunnel-id', 'not-used',
      '--runtime-key-file', 'never-read']));
    assert.equal(result.status, 'existing-matched');
    assert.equal(f.device.setup, 0);
    assert.deepEqual(snapshot(f.install), before);
  }
});

test('wrong extension, partial installation, denied access and unconfirmed registration stay distinct', windows, async t => {
  for (const kind of ['extension', 'partial', 'denied', 'registry', 'payload', 'configuration']) {
    const f = await fixture(t);
    if (kind === 'partial') fs.unlinkSync(path.join(f.install, 'setup-receipt.json'));
    if (kind === 'registry') f.registry.error = Error('private registry failure');
    if (kind === 'payload') f.provider.error = Error('provider_stage_invalid');
    if (kind === 'configuration') fs.writeFileSync(path.join(f.app, 'profile.mjs'), 'export function inspectTunnelProfile(){return {configured:false};}');
    const before = snapshot(f.install), original = fs.lstatSync;
    if (kind === 'denied') fs.lstatSync = function(file, ...args) {
      if (file === f.install) throw Object.assign(Error('private denied path'), { code: 'EACCES' });
      return original.call(this, file, ...args);
    };
    let result;
    try { result = await f.module.inspectExistingBrowserWake({ installDir: f.install,
      extensionId: kind === 'extension' ? 'c'.repeat(32) : extensionId }); }
    finally { fs.lstatSync = original; }
    assert.equal(result.ok, false, kind);
    assert.equal(result.status, { extension: 'existing-incompatible', partial: 'existing-partial',
      denied: 'existing-denied', registry: 'existing-unconfirmed', payload: 'existing-unconfirmed',
      configuration: 'existing-unconfirmed' }[kind]);
    assert.equal(result.mutationPerformed, false);
    assert.notEqual(result.next, 'open-devices');
    assert.doesNotMatch(JSON.stringify(result), /private registry|private denied/);
    assert.equal(f.device.setup, 0);
    assert.deepEqual(snapshot(f.install), before);
  }
});

test('launcher preflight rejects non-ASCII paths before acquisition or setup', windows, async t => {
  const f = await fixture(t);
  const install = path.join(f.root, '\u7528\u6237', 'new-install');
  const before = snapshot(f.root);
  await assert.rejects(f.main(['install-local', '--install-dir', install, '--consent', 'accept-install',
    '--guided-extension-id', extensionId, '--browser-managed', 'true', '--tunnel-id', 'unused',
    '--runtime-key-file', 'never-read']), /browser_wake_invalid_install/);
  assert.equal(f.device.setup, 0);
  assert.equal(f.provider.verify, 0);
  assert.deepEqual(snapshot(f.root), before);
});

test('adoption status CLI verifies the expected extension without accepting mutation flags', windows, async t => {
  const f = await fixture(t), args = ['browser-install-status', '--install-dir', f.install, '--extension-id', extensionId];
  assert.equal((await f.main(args)).status, 'existing-matched');
  for (const suffix of [['--connect', 'true'], ['--consent', 'accept-install'], ['--extension-id', extensionId]]) {
    await assert.rejects(f.main([...args, ...suffix]), /invalid_arguments/);
  }
  assert.equal(f.device.setup, 0);
});

test('changing release manifest, receipt or binding cannot produce an existing match', windows, async t => {
  for (const name of ['payload-manifest.json', 'setup-receipt.json', 'device-native-binding.json']) {
    const f = await fixture(t);
    const file = name === 'payload-manifest.json' ? path.join(f.pkg, name)
      : name === 'setup-receipt.json' ? path.join(f.install, name) : path.join(f.app, name);
    let changed = false;
    f.registry.onInspect = () => {
      if (!changed) { changed = true; fs.appendFileSync(file, ' '); }
    };
    const result = await f.module.inspectExistingBrowserWake({ installDir: f.install, extensionId });
    assert.equal(result.ok, false, name);
    assert.equal(result.status, 'existing-unconfirmed');
    assert.equal(result.payloadManifestSha256, null);
  }
});

test('an absent registry entry and a different interpreter are not complete adoption', windows, async t => {
  for (const kind of ['absent', 'interpreter']) {
    const f = await fixture(t);
    if (kind === 'absent') f.registry.values.clear();
    else {
      const launcher = path.join(f.app, 'browser-wake', 'wake.cmd');
      fs.writeFileSync(launcher, fs.readFileSync(launcher, 'utf8').replace(process.execPath, 'C:\\different-node\\node.exe'));
    }
    const before = snapshot(f.install);
    const result = await withoutMutations(() => f.module.inspectExistingBrowserWake({ installDir: f.install, extensionId }));
    assert.equal(result.ok, false);
    assert.equal(result.status, kind === 'absent' ? 'existing-partial' : 'existing-incompatible');
    assert.deepEqual(snapshot(f.install), before);
  }
});
