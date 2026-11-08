import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { publishBrowserWake } from './browser-wake-registration.mjs';
import * as browserWake from './browser-wake-registration.mjs';

const extensionId = 'a'.repeat(32);
const hostName = 'com.agentcontinue.device_wake';

function fixture(t, { unicode = false } = {}) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),
    'ac-browser-registration-' + (unicode ? '\u7528\u6237-' : '')));
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

function expectedLauncher(token) {
  return Buffer.from(['@echo off', 'setlocal DisableDelayedExpansion',
    'set "NODE_OPTIONS="', 'set "NODE_PATH="', 'set "NODE_CHANNEL_FD="',
    'set "NODE_CHANNEL_SERIALIZATION_MODE="', 'set "NODE_V8_COVERAGE="',
    'set "NODE_EXTRA_CA_CERTS="', 'set "OPENSSL_CONF="', 'set "SSLKEYLOGFILE="',
    'set "CONTROL_PLANE_API_KEY="', 'set "CONTROL_PLANE_TUNNEL_ID="',
    'set "AGENT_CONTINUE_TUNNEL_CLIENT="',
    '"' + token + '" "%~dp0..\\device-native-host.mjs" --browser-wake "%~1"', ''].join('\r\n'), 'ascii');
}

function fixtureNode(f) {
  const directory = path.join(f.root, 'portable node');
  fs.mkdirSync(directory);
  const node = path.join(directory, 'node.exe');
  fs.writeFileSync(node, 'disposable interpreter identity fixture, never executed');
  return node;
}

function withoutFilesystemMutations(body) {
  const saved = new Map();
  for (const name of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'unlinkSync', 'rmSync',
    'renameSync', 'linkSync', 'symlinkSync', 'openSync']) {
    saved.set(name, fs[name]);
    fs[name] = () => { throw Error('unexpected mutation: ' + name); };
  }
  try { return body(); }
  finally { for (const [name, original] of saved) fs[name] = original; }
}

test('Unicode app paths retain exact legacy ASCII absolute Node launcher bytes, including cross-drive Node',
  { skip: process.platform !== 'win32' }, t => {
    for (const unicode of [false, true]) {
      for (const drive of ['C', 'D']) {
        const f = fixture(t, { unicode }), node = drive + ':\\Portable Node\\node.exe';
        assert.deepEqual(browserWake.preflightBrowserWake({ installDir: f.root, extensionId, node }), { ok: true });
        publishBrowserWake({ app: f.app, binding: f.binding, node, registry: f.registry });
        const manifest = JSON.parse(fs.readFileSync(f.calls[0].regSzValue, 'utf8'));
        assert.equal(manifest.path, path.join(f.app, 'browser-wake', 'wake.cmd'));
        assert.deepEqual(fs.readFileSync(manifest.path), expectedLauncher(node));
        assert.deepEqual(manifest.allowed_origins, ['chrome-extension://' + extensionId + '/']);
        assert.equal(browserWake.inspectPublishedBrowserWake({ app: f.app, binding: f.binding,
          node, registry: f.registry }).bundle, 'verified');
        assert.equal(publishBrowserWake({ app: f.app, binding: f.binding, node, registry: f.registry }).status,
          'already-present');
        assert.equal(f.calls.length, 1);
      }
    }
  });

test('same-profile Unicode Node uses only an exact ASCII suffix relative to the launcher directory',
  { skip: process.platform !== 'win32' }, t => {
    const f = fixture(t, { unicode: true }), node = fixtureNode(f);
    assert.deepEqual(browserWake.preflightBrowserWake({ installDir: f.root, extensionId, node }), { ok: true });
    publishBrowserWake({ app: f.app, binding: f.binding, node, registry: f.registry });
    const launcher = path.join(f.app, 'browser-wake', 'wake.cmd');
    const bytes = fs.readFileSync(launcher);
    assert.deepEqual(bytes, expectedLauncher('%~dp0..\\..\\portable node\\node.exe'));
    assert.equal(bytes.some(byte => byte > 127), false);
    assert.equal(JSON.parse(fs.readFileSync(f.calls[0].regSzValue, 'utf8')).path, launcher);
    assert.equal(browserWake.inspectPublishedBrowserWake({ app: f.app, binding: f.binding,
      node, registry: f.registry }).registered, true);
  });

test('unsafe Unicode or noncanonical wake paths fail mutation-free before registry access',
  { skip: process.platform !== 'win32' }, t => {
    const f = fixture(t, { unicode: true }), node = fixtureNode(f);
    const otherDrive = path.parse(f.root).root[0].toUpperCase() === 'C' ? 'D' : 'C';
    const badComponents = ['bad%PATH%', 'bad!value!', 'bad^name', 'bad&name', 'bad|name',
      'bad<name', 'bad>name', 'bad(name)', 'bad"name', 'bad:name', 'bad*name', 'bad?name',
      'bad\u0000name', 'bad\nname', 'bad\u007fname', 'bad\ud800name', 'trailing.', 'trailing ', 'NUL'];
    const badInstalls = badComponents.map(part => f.root + '\\' + part).concat([
      f.root + '\\..\\alias', f.root + '\\.\\alias', f.root + '\\\\alias',
      f.root.replaceAll('\\', '/'), '\\\\server\\\u7528\u6237', '\\\\?\\' + f.root,
    ]);
    const badNodes = badComponents.map(part => f.root + '\\' + part + '\\node.exe').concat([
      path.join(f.root, '\u8282\u70b9', 'node.exe'),
      otherDrive + ':\\\u7528\u6237\\node.exe', f.root + '\\portable node\\..\\node.exe',
      f.root + '\\portable node\\.\\node.exe', f.root + '\\\\portable node\\node.exe',
      node.replaceAll('\\', '/'), path.join(f.root.toUpperCase(), 'portable node', 'node.exe'),
      'node.exe', '\\portable node\\node.exe', 'C:node.exe',
    ]);
    let registryReads = 0;
    const registry = { inspect() { registryReads++; throw Error('unexpected registry access'); },
      createOnly() { throw Error('unexpected registry write'); } };
    withoutFilesystemMutations(() => {
      for (const installDir of badInstalls) {
        assert.throws(() => browserWake.preflightBrowserWake({ installDir, extensionId, node }),
          /^Error: browser_wake_invalid_install$/, JSON.stringify(installDir));
        assert.throws(() => publishBrowserWake({ app: installDir, binding: f.binding, node, registry }),
          /^Error: browser_wake_invalid_install$/, JSON.stringify(installDir));
      }
      for (const badNode of badNodes) {
        assert.throws(() => browserWake.preflightBrowserWake({ installDir: f.root, extensionId, node: badNode }),
          /^Error: browser_wake_invalid_install$/, JSON.stringify(badNode));
        assert.throws(() => publishBrowserWake({ app: f.app, binding: f.binding, node: badNode, registry }),
          /^Error: browser_wake_invalid_install$/, JSON.stringify(badNode));
      }
    });
    assert.equal(registryReads, 0);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(fs.readdirSync(f.app), []);
  });

test('Unicode relative Node preflight rejects reparse aliases without staging or registry access',
  { skip: process.platform !== 'win32' }, t => {
    const f = fixture(t, { unicode: true }), node = fixtureNode(f);
    const alias = path.join(f.root, 'node-alias');
    fs.symlinkSync(path.dirname(node), alias, 'junction');
    const aliasedNode = path.join(alias, 'node.exe');
    withoutFilesystemMutations(() => {
      assert.throws(() => browserWake.preflightBrowserWake({ installDir: f.root, extensionId, node: aliasedNode }),
        /^Error: browser_wake_invalid_install$/);
      assert.throws(() => publishBrowserWake({ app: f.app, binding: f.binding, node: aliasedNode, registry: {} }),
        /^Error: browser_wake_invalid_install$/);
    });
    assert.deepEqual(fs.readdirSync(f.app), []);
    assert.equal(f.calls.length, 0);
  });

test('Unicode publication preserves all four hive/view conflict checks before staging',
  { skip: process.platform !== 'win32' }, t => {
    for (const slot of ['32:HKCU', '32:HKLM', '64:HKCU', '64:HKLM']) {
      const f = fixture(t, { unicode: true }), node = fixtureNode(f);
      f.values.set(slot, 'foreign-pointer');
      assert.throws(() => publishBrowserWake({ app: f.app, binding: f.binding, node, registry: f.registry }),
        /^Error: browser_wake_registry_conflict$/);
      assert.deepEqual(fs.readdirSync(f.app), []);
      assert.equal(f.calls.length, 0);
      assert.equal(f.values.get(slot), 'foreign-pointer');
    }
  });

test('Unicode bundles retain create-only, hard-link, reparse and binding ownership checks',
  { skip: process.platform !== 'win32' }, t => {
    for (const kind of ['changed', 'hard-link', 'reparse', 'binding']) {
      const f = fixture(t, { unicode: true }), node = fixtureNode(f);
      const directory = path.join(f.app, 'browser-wake'), launcher = path.join(directory, 'wake.cmd');
      if (kind === 'reparse') {
        const target = path.join(f.root, 'other-bundle');
        fs.mkdirSync(target);
        fs.symlinkSync(target, directory, 'junction');
        assert.throws(() => publishBrowserWake({ app: f.app, binding: f.binding, node: process.execPath,
          registry: f.registry }), /^Error: browser_wake_bundle_conflict$/);
        assert.deepEqual(fs.readdirSync(target), []);
        assert.equal(f.calls.length, 0);
        continue;
      }
      publishBrowserWake({ app: f.app, binding: f.binding, node, registry: f.registry });
      if (kind === 'changed') fs.appendFileSync(launcher, 'echo foreign\r\n');
      if (kind === 'hard-link') fs.linkSync(launcher, path.join(f.root, 'linked.cmd'));
      if (kind === 'binding') f.binding.assertCurrent = () => { throw Error('changed binding'); };
      const bytes = fs.readFileSync(launcher);
      assert.throws(() => publishBrowserWake({ app: f.app, binding: f.binding, node, registry: f.registry }),
        kind === 'binding' ? /changed binding/ : /^Error: browser_wake_bundle_conflict$/);
      assert.deepEqual(fs.readFileSync(launcher), bytes);
      assert.equal(f.calls.length, 1);
    }
  });

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

async function inspectionFixture(t, options) {
  const f = fixture(t, options);
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

test('Kelvin/k Unicode paths with different executable identities are never an interpreter match',
  { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
    const cwd = process.cwd(), parent = fs.realpathSync(os.tmpdir());
    const root = fs.mkdtempSync(path.join(parent, 'ac-browser-kelvin-'));
    t.after(() => {
      assert.equal(path.dirname(root), parent);
      assert.match(path.basename(root), /^ac-browser-kelvin-/);
      assert.equal(fs.realpathSync(root), root);
      fs.rmSync(root, { recursive: true, maxRetries: 4, retryDelay: 100 });
      assert.equal(fs.existsSync(root), false);
      assert.equal(process.cwd(), cwd);
    });
    const installDir = path.join(root, '\u212a'), app = path.join(installDir, 'app');
    const recordedNode = path.join(installDir, 'Node', 'node.exe');
    const differentNode = path.join(root, 'k', 'Node', 'node.exe');
    for (const directory of [app, path.join(installDir, 'state'), path.dirname(recordedNode),
      path.dirname(differentNode)]) fs.mkdirSync(directory, { recursive: true });
    for (const node of [recordedNode, differentNode]) {
      fs.copyFileSync(process.execPath, node, fs.constants.COPYFILE_EXCL);
      assert.equal(fs.realpathSync(node), node);
      const info = fs.lstatSync(node, { bigint: true });
      assert.ok(info.isFile() && !info.isSymbolicLink() && info.dev !== 0n && info.ino !== 0n);
    }
    const recorded = fs.lstatSync(recordedNode, { bigint: true });
    const different = fs.lstatSync(differentNode, { bigint: true });
    assert.equal(recordedNode.toLowerCase(), differentNode.toLowerCase());
    assert.ok(recorded.dev !== different.dev || recorded.ino !== different.ino);

    // Clone the inspector unchanged; only provider/profile/registry evidence is simulated.
    const source = new URL('./browser-wake-registration.mjs', import.meta.url);
    const cloned = path.join(root, 'browser-wake-registration.mjs');
    fs.copyFileSync(source, cloned, fs.constants.COPYFILE_EXCL);
    assert.deepEqual(fs.readFileSync(cloned), fs.readFileSync(source));
    fs.writeFileSync(path.join(root, 'bootstrap.mjs'),
      `export {resolveLocalPath} from ${JSON.stringify(new URL('./bootstrap.mjs', import.meta.url).href)};
export const verifyProviderStage=async()=>{};`, { flag: 'wx' });
    const manifest = path.join(app, 'browser-wake', 'host.json');
    fs.writeFileSync(path.join(root, 'registry-win.mjs'),
      `export const createWinRegistry=()=>({inspect:plan=>plan.hive==='HKCU'&&plan.view==='32'
?{present:true,value:${JSON.stringify(manifest)}}:{present:false}});`, { flag: 'wx' });
    fs.writeFileSync(path.join(app, 'device-owner.mjs'),
      `export const readNativeBinding=()=>({root:${JSON.stringify(path.join(installDir, 'state'))},
extensionId:${JSON.stringify(extensionId)},assertCurrent(){}});`, { flag: 'wx' });
    fs.writeFileSync(path.join(app, 'profile.mjs'),
      'export const inspectTunnelProfile=()=>({configured:true});', { flag: 'wx' });
    const inspector = await import(pathToFileURL(cloned).href);
    const values = new Map();
    inspector.publishBrowserWake({ app, node: recordedNode, binding: { extensionId, assertCurrent() {} },
      registry: {
        inspect(plan) { return values.has(plan.view + ':' + plan.hive)
          ? { present: true, value: values.get(plan.view + ':' + plan.hive) } : { present: false }; },
        createOnly(plan) { values.set(plan.view + ':' + plan.hive, plan.regSzValue); return true; },
      } });
    assert.deepEqual(fs.readFileSync(path.join(app, 'browser-wake', 'wake.cmd')),
      expectedLauncher('%~dp0..\\..\\Node\\node.exe'));
    const childSource = `import {inspectBrowserWake} from ${JSON.stringify(pathToFileURL(cloned).href)};
console.log(JSON.stringify({execPath:process.execPath,cwd:process.cwd(),
observation:await inspectBrowserWake({installDir:${JSON.stringify(installDir)}})}));`;
    for (const [node, expected] of [[recordedNode, 'matched'], [differentNode, 'mismatch']]) {
      const child = spawnSync(node, ['--input-type=module'], { input: childSource,
        cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 16384 });
      assert.ifError(child.error);
      assert.equal(child.signal, null);
      assert.equal(child.status, 0, child.stderr);
      assert.equal(process.cwd(), cwd);
      const result = JSON.parse(child.stdout);
      assert.equal(result.execPath, node);
      assert.equal(result.cwd, root);
      assert.equal(result.observation.interpreter, expected);
      assert.equal(result.observation.configuration, expected === 'matched' ? 'verified' : 'not-verified');
      assert.equal(result.observation.bundle, 'verified');
      assert.equal(result.observation.registered, true);
      assert.equal(result.observation.runtime, 'not-observed');
      assert.equal(result.observation.mutationPerformed, false);
    }
  });

test('Unicode interpreter readback resolves from the launcher directory, never CWD, and reports mismatch',
  { skip: process.platform !== 'win32' }, async t => {
    const f = await inspectionFixture(t, { unicode: true }), node = fixtureNode(f);
    f.module.publishBrowserWake({ app: f.app, binding: f.binding, node, registry: f.registry });
    const manifest = path.join(f.app, 'browser-wake', 'host.json');
    const inspected = [];
    f.registryModule.setInspect(plan => {
      inspected.push(plan.view + ':' + plan.hive);
      return plan.view === '32' && plan.hive === 'HKCU' ? { present: true, value: manifest } : { present: false };
    });
    const cwd = process.cwd(), original = Object.getOwnPropertyDescriptor(process, 'execPath');
    try {
      process.chdir(os.tmpdir());
      Object.defineProperty(process, 'execPath', { ...original, value: node });
      const result = await f.module.inspectBrowserWake({ installDir: f.root });
      assert.equal(result.interpreter, 'matched');
      assert.equal(result.configuration, 'verified');
      assert.equal(result.bundle, 'verified');
      assert.equal(result.registered, true);
      assert.equal(result.runtime, 'not-observed');
      assert.equal(result.mutationPerformed, false);
      assert.deepEqual(inspected, ['32:HKCU', '32:HKLM', '64:HKCU', '64:HKLM',
        '32:HKCU', '32:HKLM', '64:HKCU', '64:HKLM']);
      Object.defineProperty(process, 'execPath', original);
      const mismatch = await f.module.inspectBrowserWake({ installDir: f.root });
      assert.equal(mismatch.interpreter, 'mismatch');
      assert.equal(mismatch.configuration, 'not-verified');
      assert.equal(mismatch.bundle, 'verified');
      assert.equal(mismatch.registered, true);
    } finally {
      process.chdir(cwd);
      Object.defineProperty(process, 'execPath', original);
    }
    assert.equal(f.calls.length, 1);
  });

test('interpreter readback rejects malformed, aliased, non-ASCII and extra-command launchers without repair',
  { skip: process.platform !== 'win32' }, async t => {
    for (const unicode of [false, true]) {
      const f = await inspectionFixture(t, { unicode }), node = unicode ? fixtureNode(f) : process.execPath;
      f.module.publishBrowserWake({ app: f.app, binding: f.binding, node, registry: f.registry });
      const launcher = path.join(f.app, 'browser-wake', 'wake.cmd');
      const original = fs.readFileSync(launcher), text = original.toString('ascii');
      const token = unicode ? '%~dp0..\\..\\portable node\\node.exe' : node;
      const changedTokens = ['node.exe', '%~dp0', '%~dp0.\\..\\..\\portable node\\node.exe',
        '%~dp0..\\..\\portable node\\.\\node.exe', '%~dp0..\\..\\portable node\\\\node.exe',
        '%~dp0C:\\node.exe', '%~dp0\\node.exe', '%~dp0..\\%PATH%\\node.exe',
        '%~dp0..\\bad&name\\node.exe'];
      if (!unicode) changedTokens.push('%~dp0' + path.relative(path.dirname(launcher), node));
      const mutations = [Buffer.from('@echo injected\r\n' + text), Buffer.from(text + 'echo injected\r\n'),
        Buffer.from(text + '\r\n'), Buffer.from(text.replace('set "NODE_OPTIONS="\r\n', '')),
        Buffer.from(text.replace(' --browser-wake ', ' & echo injected & ')),
        Buffer.from(text.replaceAll('\r\n', '\n')), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), original]),
        Buffer.from(text.replace('"' + token + '"', '"C:\\\u8282\u70b9\\node.exe"'), 'utf8'),
        ...changedTokens.map(changed => Buffer.from(text.replace('"' + token + '"', '"' + changed + '"'))),
      ];
      for (const bytes of mutations) {
        fs.writeFileSync(launcher, bytes);
        const result = await f.module.inspectBrowserWake({ installDir: f.root });
        assert.equal(result.interpreter, 'not-recorded', bytes.toString('utf8'));
        assert.equal(result.bundle, 'conflict');
        assert.equal(result.mutationPerformed, false);
        assert.deepEqual(fs.readFileSync(launcher), bytes);
      }
      assert.equal(f.calls.length, 1);
    }
  });

test('a redirected Unicode interpreter is a mismatch, never proof of the current interpreter',
  { skip: process.platform !== 'win32' }, async t => {
    const f = await inspectionFixture(t, { unicode: true }), node = fixtureNode(f);
    f.module.publishBrowserWake({ app: f.app, binding: f.binding, node, registry: f.registry });
    const launcher = path.join(f.app, 'browser-wake', 'wake.cmd');
    const manifest = path.join(f.app, 'browser-wake', 'host.json');
    f.registryModule.setInspect(plan => plan.view === '32' && plan.hive === 'HKCU'
      ? { present: true, value: manifest } : { present: false });
    fs.writeFileSync(launcher, expectedLauncher('%~dp0..\\..\\different-node\\node.exe'));
    const original = Object.getOwnPropertyDescriptor(process, 'execPath');
    try {
      Object.defineProperty(process, 'execPath', { ...original, value: node });
      const result = await f.module.inspectBrowserWake({ installDir: f.root });
      assert.equal(result.interpreter, 'mismatch');
      assert.equal(result.configuration, 'not-verified');
      assert.equal(result.bundle, 'verified');
      assert.equal(result.registered, true);
      assert.equal(result.runtime, 'not-observed');
      assert.equal(result.mutationPerformed, false);
    } finally { Object.defineProperty(process, 'execPath', original); }
    assert.equal(f.calls.length, 1);
  });

test('interpreter readback rejects hard-linked launchers and reparse directories',
  { skip: process.platform !== 'win32' }, async t => {
    for (const kind of ['hard-link', 'reparse']) {
      const f = await inspectionFixture(t, { unicode: true }), node = fixtureNode(f);
      f.module.publishBrowserWake({ app: f.app, binding: f.binding, node, registry: f.registry });
      const directory = path.join(f.app, 'browser-wake'), launcher = path.join(directory, 'wake.cmd');
      if (kind === 'hard-link') fs.linkSync(launcher, path.join(f.root, 'linked.cmd'));
      else {
        const target = path.join(f.root, 'moved-bundle');
        fs.renameSync(directory, target);
        fs.symlinkSync(target, directory, 'junction');
      }
      const result = await f.module.inspectBrowserWake({ installDir: f.root });
      assert.equal(result.interpreter, 'not-recorded');
      assert.equal(result.bundle, 'conflict');
      assert.equal(result.mutationPerformed, false);
      assert.equal(f.calls.length, 1);
    }
  });

test('interpreter readback rejects launcher identity replacement even when replacement bytes match',
  { skip: process.platform !== 'win32' }, async t => {
    const f = await inspectionFixture(t);
    f.module.publishBrowserWake({ app: f.app, binding: f.binding, node: process.execPath, registry: f.registry });
    const launcher = path.join(f.app, 'browser-wake', 'wake.cmd'), replacement = path.join(f.root, 'replacement.cmd');
    fs.copyFileSync(launcher, replacement);
    const read = fs.readFileSync;
    let replaced = false;
    fs.readFileSync = function(file, ...args) {
      const bytes = read.call(this, file, ...args);
      if (file === launcher && !replaced) {
        replaced = true;
        fs.unlinkSync(launcher);
        fs.renameSync(replacement, launcher);
      }
      return bytes;
    };
    try {
      assert.equal((await f.module.inspectBrowserWake({ installDir: f.root })).interpreter, 'not-recorded');
    } finally { fs.readFileSync = read; }
    assert.equal(replaced, true);
    assert.equal(f.calls.length, 1);
  });

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
