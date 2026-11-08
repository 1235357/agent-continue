import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { publishBrowserWake } from './browser-wake-registration.mjs';
import * as browserWake from './browser-wake-registration.mjs';

const extensionId = 'a'.repeat(32);
const hostName = 'com.agentcontinue.device_wake';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ac-browser-registration-'));
  t.after(() => {
    assert.equal(fs.realpathSync(root), root);
    fs.rmSync(root, { recursive: true });
  });
  const app = path.join(root, 'app');
  fs.mkdirSync(app);
  const binding = { extensionId, assertCurrent() {} };
  const values = new Map(), calls = [];
  const selector = plan => plan.view + ':' + plan.keyPath.slice(0, 4);
  const registry = {
    inspect(plan) {
      assert.equal(plan.keyPath, plan.keyPath.slice(0, 4) + '\\Software\\Google\\Chrome\\NativeMessagingHosts\\' + hostName);
      return values.has(selector(plan)) ? { present: true, value: values.get(selector(plan)) } : { present: false };
    },
    createOnly(plan) {
      calls.push(plan);
      assert.equal(plan.view, '32');
      assert.equal(plan.keyPath.slice(0, 4), 'HKCU');
      if (values.has(selector(plan))) return false;
      values.set(selector(plan), plan.regSzValue);
      return true;
    },
  };
  return { root, app, binding, registry, values, calls };
}

test('browser wake registration stages a fixed wrapper and one origin, and is idempotent', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const outcome = publishBrowserWake({ app: f.app, binding: f.binding, node: process.execPath, registry: f.registry });
  assert.equal(outcome.status, 'written');
  assert.equal(outcome.launchVerified, false);
  assert.equal(outcome.activated, false);
  const registration = f.calls[0];
  const manifest = JSON.parse(fs.readFileSync(registration.regSzValue, 'utf8'));
  assert.equal(manifest.name, hostName);
  assert.deepEqual(manifest.allowed_origins, ['chrome-extension://' + extensionId + '/']);
  const launcher = fs.readFileSync(manifest.path, 'ascii');
  assert.match(launcher, /--browser-wake "%~1"/);
  assert.doesNotMatch(launcher, /%\*|start |powershell/i);
  assert.match(launcher, /set "NODE_OPTIONS="/);
  assert.equal(publishBrowserWake({ app: f.app, binding: f.binding, node: process.execPath, registry: f.registry }).status, 'already-present');
  assert.equal(f.calls.length, 1);
});

test('conflicting registry views, even empty keys, fail without publishing', { skip: process.platform !== 'win32' }, t => {
  for (const [slot, value] of [['32:HKLM', 'foreign'], ['64:HKCU', 'foreign'], ['32:HKCU', null]]) {
    const f = fixture(t);
    f.values.set(slot, value);
    assert.throws(() => publishBrowserWake({ app: f.app, binding: f.binding, node: process.execPath, registry: f.registry }),
      /browser_wake_registry_conflict/);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(fs.readdirSync(f.app), []);
  }
});

test('foreign values or ambiguous registry writes are never removed or overwritten', { skip: process.platform !== 'win32' }, t => {
  for (const duringWrite of ['other-value', 'unknown-result']) {
    const f = fixture(t);
    f.registry.createOnly = plan => {
      f.calls.push(plan);
      if (duringWrite === 'other-value') { f.values.set('32:HKCU', 'foreign'); return false; }
      f.values.set('32:HKCU', plan.regSzValue);
      throw new Error('cannot determine write result');
    };
    assert.throws(() => publishBrowserWake({ app: f.app, binding: f.binding, node: process.execPath, registry: f.registry }),
      /browser_wake_registry_(?:conflict|unconfirmed)/);
    assert.equal(f.values.get('32:HKCU'), duringWrite === 'other-value' ? 'foreign' : f.calls[0].regSzValue);
    assert.ok(fs.existsSync(f.calls[0].regSzValue), 'never remove a file a possibly published pointer refers to');
  }
});

test('a preexisting registration must match the complete owned bundle, not just a path', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  publishBrowserWake({ app: f.app, binding: f.binding, node: process.execPath, registry: f.registry });
  const installed = JSON.parse(fs.readFileSync(f.calls[0].regSzValue, 'utf8'));
  fs.appendFileSync(installed.path, 'changed');
  assert.throws(() => publishBrowserWake({ app: f.app, binding: f.binding, node: process.execPath, registry: f.registry }),
    /browser_wake_bundle_conflict/);
  assert.equal(f.calls.length, 1);
});

test('unsupported CMD paths are rejected before staging or registry access', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  assert.throws(() => publishBrowserWake({ app: f.app, binding: f.binding,
    node: 'C:\\test%environment%\\node.exe', registry: {} }), /browser_wake_invalid_install/);
  assert.deepEqual(fs.readdirSync(f.app), []);
});

test('browser install inspection observes an absent registration without staging or publishing',
  { skip: process.platform !== 'win32' }, t => {
    const f = fixture(t);
    const result = browserWake.inspectPublishedBrowserWake({ app: f.app, binding: f.binding,
      node: process.execPath, registry: f.registry });
    assert.deepEqual(result, { registration: 'absent', registryComplete: true, bundle: 'absent', registered: false,
      runtime: 'not-observed', mutationPerformed: false });
    assert.deepEqual(fs.readdirSync(f.app), []);
    assert.equal(f.calls.length, 0);
    assert.equal(f.values.size, 0);
  });

test('browser install inspection verifies existing bytes but never republishes or connects',
  { skip: process.platform !== 'win32' }, t => {
    const f = fixture(t);
    publishBrowserWake({ app: f.app, binding: f.binding, node: process.execPath, registry: f.registry });
    const names = fs.readdirSync(path.join(f.app, 'browser-wake'));
    const bytes = names.map(name => fs.readFileSync(path.join(f.app, 'browser-wake', name)));
    const result = browserWake.inspectPublishedBrowserWake({ app: f.app, binding: f.binding,
      node: process.execPath, registry: f.registry });
    assert.equal(result.registration, 'matched');
    assert.equal(result.bundle, 'verified');
    assert.equal(result.registered, true);
    assert.equal(result.runtime, 'not-observed');
    assert.equal(result.mutationPerformed, false);
    assert.equal(f.calls.length, 1);
    names.forEach((name, index) => assert.deepEqual(fs.readFileSync(path.join(f.app, 'browser-wake', name)), bytes[index]));
  });

test('browser install inspection keeps conflicts and unknown registry reads distinct from absence',
  { skip: process.platform !== 'win32' }, t => {
    for (const kind of ['foreign', 'unreadable', 'untyped']) {
      const f = fixture(t);
      publishBrowserWake({ app: f.app, binding: f.binding, node: process.execPath, registry: f.registry });
      if (kind === 'foreign') f.values.set('64:HKLM', 'not-our-pointer');
      if (kind === 'unreadable') f.registry.inspect = () => { throw Error('private original exception'); };
      if (kind === 'untyped') f.registry.inspect = () => ({ present: 'false' });
      const result = browserWake.inspectPublishedBrowserWake({ app: f.app, binding: f.binding,
        node: process.execPath, registry: f.registry });
      assert.equal(result.registration, kind === 'foreign' ? 'conflict' : 'unconfirmed');
      assert.equal(result.registered, null);
      assert.equal(result.bundle, 'verified');
      assert.equal(f.calls.length, 1);
      assert.doesNotMatch(JSON.stringify(result), /private original|not-our-pointer/);
    }
  });

test('browser install inspection never accepts an owned pointer without exact bundle bytes',
  { skip: process.platform !== 'win32' }, t => {
    for (const kind of ['changed', 'missing']) {
      const f = fixture(t);
      publishBrowserWake({ app: f.app, binding: f.binding, node: process.execPath, registry: f.registry });
      const launcher = path.join(f.app, 'browser-wake', 'wake.cmd');
      if (kind === 'changed') fs.appendFileSync(launcher, 'changed');
      else fs.unlinkSync(launcher);
      const result = browserWake.inspectPublishedBrowserWake({ app: f.app, binding: f.binding,
        node: process.execPath, registry: f.registry });
      assert.equal(result.registration, 'matched');
      assert.equal(result.bundle, 'conflict');
      assert.equal(result.registered, null);
      assert.equal(f.calls.length, 1);
      assert.equal(fs.existsSync(launcher), kind === 'changed');
    }
  });

test('browser install inspection rejects changing bindings instead of returning a stale success',
  { skip: process.platform !== 'win32' }, t => {
    const f = fixture(t);
    publishBrowserWake({ app: f.app, binding: f.binding, node: process.execPath, registry: f.registry });
    let checks = 0;
    f.binding.assertCurrent = () => { if (++checks > 1) throw Error('binding-changed'); };
    assert.throws(() => browserWake.inspectPublishedBrowserWake({ app: f.app, binding: f.binding,
      node: process.execPath, registry: f.registry }), /browser_wake_invalid_install/);
    assert.equal(f.calls.length, 1);
  });

test('browser install inspection rechecks binding after the last bundle file read',
  { skip: process.platform !== 'win32' }, t => {
    const f = fixture(t);
    publishBrowserWake({ app: f.app, binding: f.binding, node: process.execPath, registry: f.registry });
    const manifest = path.join(f.app, 'browser-wake', 'host.json');
    let changed = false, reads = 0;
    f.binding.assertCurrent = () => { if (changed) throw Error('binding-changed'); };
    const originalRead = fs.readFileSync;
    fs.readFileSync = function(file, ...args) {
      const result = originalRead.call(this, file, ...args);
      if (file === manifest && ++reads === 2) changed = true;
      return result;
    };
    try {
      assert.throws(() => browserWake.inspectPublishedBrowserWake({ app: f.app, binding: f.binding,
        node: process.execPath, registry: f.registry }), /browser_wake_invalid_install/);
    } finally { fs.readFileSync = originalRead; }
  });

test('browser install inspection checks every hive/view even after an unknown slot',
  { skip: process.platform !== 'win32' }, t => {
    const f = fixture(t), inspected = [];
    f.registry.inspect = plan => {
      const slot = plan.view + ':' + plan.hive;
      inspected.push(slot);
      if (slot === '32:HKCU') throw Error('private query detail');
      return slot === '64:HKLM' ? { present: true, value: 'foreign' } : { present: false };
    };
    const result = browserWake.inspectPublishedBrowserWake({ app: f.app, binding: f.binding,
      node: process.execPath, registry: f.registry });
    assert.deepEqual(inspected, ['32:HKCU', '32:HKLM', '64:HKCU', '64:HKLM',
      '32:HKCU', '32:HKLM', '64:HKCU', '64:HKLM']);
    assert.equal(result.registration, 'conflict');
    assert.equal(result.registryComplete, false);
    assert.equal(result.registered, null);
    assert.equal(f.calls.length, 0);
  });

async function inspectionFixture(t) {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'state'));
  const configured = path.join(f.root, 'profile-present');
  fs.writeFileSync(configured, 'present');
  for (const [name, source] of Object.entries({
    'bootstrap.mjs': 'export const resolveLocalPath=value=>value;export const verifyProviderStage=async()=>{};',
    'registry-win.mjs': 'let inspect=()=>({present:false});export const setInspect=value=>{inspect=value};export const createWinRegistry=()=>({inspect:plan=>inspect(plan)});',
    'app/device-owner.mjs': `export const readNativeBinding=()=>({root:${JSON.stringify(path.join(f.root, 'state'))},extensionId:${JSON.stringify(extensionId)},assertCurrent(){}});`,
    'app/profile.mjs': `import fs from 'node:fs';export const inspectTunnelProfile=()=>({configured:fs.existsSync(${JSON.stringify(configured)})});`,
  })) fs.writeFileSync(path.join(f.root, name), source);
  fs.copyFileSync(new URL('./browser-wake-registration.mjs', import.meta.url), path.join(f.root, 'browser-wake-registration.mjs'));
  const module = await import(pathToFileURL(path.join(f.root, 'browser-wake-registration.mjs')).href);
  const registryModule = await import(pathToFileURL(path.join(f.root, 'registry-win.mjs')).href);
  return { ...f, configured, module, registryModule };
}

test('browser install status rejects profile drift during registry inspection',
  { skip: process.platform !== 'win32' }, async t => {
    const f = await inspectionFixture(t);
    f.registryModule.setInspect(() => { fs.rmSync(f.configured, { force: true }); return { present: false }; });
    await assert.rejects(f.module.inspectBrowserWake({ installDir: f.root }), /browser_wake_invalid_install/);
  });

test('browser install status distinguishes a different inspecting interpreter from a broken bridge',
  { skip: process.platform !== 'win32' }, async t => {
    const f = await inspectionFixture(t);
    const installedNode = 'C:\\AgentContinuePortableNode\\node.exe';
    f.module.publishBrowserWake({ app: f.app, binding: f.binding, node: installedNode, registry: f.registry });
    const manifest = path.join(f.app, 'browser-wake', 'host.json');
    f.registryModule.setInspect(plan => plan.view === '32' && plan.hive === 'HKCU'
      ? { present: true, value: manifest } : { present: false });
    const result = await f.module.inspectBrowserWake({ installDir: f.root });
    assert.equal(result.configuration, 'not-verified');
    assert.equal(result.interpreter, 'mismatch');
    assert.equal(result.registration, 'matched');
    assert.equal(result.bundle, 'verified');
    assert.equal(result.registered, true);
    assert.equal(result.runtime, 'not-observed');
    assert.equal(result.mutationPerformed, false);
  });

test('browser install status rechecks native binding after the final profile read',
  { skip: process.platform !== 'win32' }, async t => {
    const f = await inspectionFixture(t), changed = path.join(f.root, 'binding-changed');
    fs.writeFileSync(path.join(f.app, 'device-owner.mjs'), `import fs from 'node:fs';export const readNativeBinding=()=>({root:${JSON.stringify(path.join(f.root, 'state'))},extensionId:${JSON.stringify(extensionId)},assertCurrent(){if(fs.existsSync(${JSON.stringify(changed)}))throw Error('changed')}});`);
    fs.writeFileSync(path.join(f.app, 'profile.mjs'), `import fs from 'node:fs';let reads=0;export const inspectTunnelProfile=()=>{if(++reads===2)fs.writeFileSync(${JSON.stringify(changed)},'changed');return {configured:true}};`);
    await assert.rejects(f.module.inspectBrowserWake({ installDir: f.root }), /browser_wake_invalid_install/);
  });

test('missing wrapper with an unverifiable interpreter remains an observation, not a corruption verdict',
  { skip: process.platform !== 'win32' }, async t => {
    const f = await inspectionFixture(t);
    fs.writeFileSync(path.join(f.app, 'profile.mjs'), 'export const inspectTunnelProfile=()=>{throw Error("binding_changed")};');
    const result = await f.module.inspectBrowserWake({ installDir: f.root });
    assert.equal(result.configuration, 'not-verified');
    assert.equal(result.interpreter, 'not-recorded');
    assert.equal(result.registration, 'absent');
    assert.equal(result.bundle, 'absent');
    assert.equal(result.registered, false);
    assert.equal(result.mutationPerformed, false);
  });

test('browser install status CLI is closed and read-only', async t => {
  const f = fixture(t);
  fs.copyFileSync(new URL('./bin.mjs', import.meta.url), path.join(f.root, 'bin.mjs'));
  const mocks = {
    'payload-layout.mjs': 'export const BOOTSTRAP_VERSION="fixture";',
    'bootstrap.mjs': 'export const stageRuntime=()=>{throw Error("unexpected stage")};',
    'client-acquisition.mjs': 'export const acquireClient=()=>{},validateClientInput=()=>{};',
    'device-enrollment.mjs': 'export const enrollSshTarget=()=>{};',
    'device-setup.mjs': 'export const setupDevice=()=>{},setupServer=()=>{},setupManager=()=>{},startLocalManager=()=>{},observeLocalManagerOperation=()=>{},requestLocalManager=()=>{};',
    'browser-wake-registration.mjs': `export const inspectBrowserWake=async(input)=>({fixture:true,root:input.installDir});
export const registerBrowserWake=()=>{throw Error("unexpected publication")};`,
  };
  for (const [name, source] of Object.entries(mocks)) fs.writeFileSync(path.join(f.root, name), source);
  const { main } = await import(pathToFileURL(path.join(f.root, 'bin.mjs')).href);
  assert.deepEqual(await main(['browser-install-status', '--install-dir', f.root]), { fixture: true, root: f.root });
  for (const suffix of [['--consent', 'accept-install'], ['--connect', 'true']]) {
    await assert.rejects(main(['browser-install-status', '--install-dir', f.root, ...suffix]), /invalid_arguments/);
  }
});

test('npm CLI forwards browser install inspection without turning it into an installation',
  { skip: process.platform !== 'win32' }, async t => {
    const f = fixture(t);
    const { run } = await import('../../cli.mjs');
    await assert.rejects(run(['browser-install-status', '--install-dir', f.root]),
      /^Error: browser_wake_invalid_install$/);
    assert.deepEqual(fs.readdirSync(f.app), []);
    assert.equal(f.calls.length, 0);
  });

test('browser-managed CLI installation registers the configured device without starting a detached owner',
  { skip: process.platform !== 'win32' }, async t => {
    const f = fixture(t);
    fs.copyFileSync(new URL('./bin.mjs', import.meta.url), path.join(f.root, 'bin.mjs'));
    const mock = {
      'payload-layout.mjs': 'export const BOOTSTRAP_VERSION="fixture";',
      'bootstrap.mjs': 'export const stageRuntime=()=>{throw Error("unexpected stage")};',
      'client-acquisition.mjs': 'export const acquireClient=()=>{}, validateClientInput=()=>{};',
      'device-enrollment.mjs': 'export const enrollSshTarget=()=>{};',
      'device-setup.mjs': `import {calls} from './browser-wake-registration.mjs';
export const setupServer=()=>{}, setupManager=()=>{}, observeLocalManagerOperation=()=>{}, requestLocalManager=()=>{};
export const readSetupRequest=()=>({request:{extensionId:${JSON.stringify(extensionId)}}});
export const validateSetupRequest=value=>value;
export const startLocalManager=()=>{throw Error("unexpected detached manager")};
export async function setupDevice(input){
  if(input.consent!=="full-account") throw Error("missing full-account consent");
  if(calls.join(',')!=='inspect,preflight')throw Error('launcher preflight must precede setup');
  calls.push('setup');
  return {extensionId:${JSON.stringify(extensionId)}};
}`,
      'browser-wake-registration.mjs': `export const calls=[];
export async function inspectExistingBrowserWake(){calls.push('inspect');return {status:'existing-absent'};}
export function preflightBrowserWake(){calls.push('preflight');}
export async function registerBrowserWake(input){
  if(input.consent!=="accept-browser-wake" || input.extensionId!==${JSON.stringify(extensionId)}) throw Error("wrong registration consent or origin");
  calls.push('register');
  return {registered:true, activated:false};
}`,
    };
    for (const [name, source] of Object.entries(mock)) fs.writeFileSync(path.join(f.root, name), source);
    const { main } = await import(pathToFileURL(path.join(f.root, 'bin.mjs')).href);
    const options = ['install-local', '--install-dir', f.root, '--consent', 'accept-install',
      '--setup-request', 'fixture-request', '--browser-managed', 'true'];
    await assert.rejects(main(options), /invalid_arguments/);
    const receipt = await main([...options, '--tunnel-id', 'fixture-tunnel', '--runtime-key-file', 'fixture-key']);
    assert.deepEqual(receipt, { ok: true, action: 'install-local', mode: 'browser-managed', configured: true,
      registered: true, connected: false, browserLaunchVerified: false, chatAuthorizationVerified: false,
      registration: { registered: true, activated: false } });
    assert.deepEqual((await import(pathToFileURL(path.join(f.root, 'browser-wake-registration.mjs')).href)).calls,
      ['inspect', 'preflight', 'setup', 'register']);
  });
