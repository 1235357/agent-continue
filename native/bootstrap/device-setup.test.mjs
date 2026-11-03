import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildPackage } from './build-package.mjs';
import { RUNTIME_FILES } from './payload-layout.mjs';
import { buildSetupRequest, serializeSetupRequest } from '../../setup-model.js';

const library = new URL('./device-setup.mjs', import.meta.url);
const api = fs.existsSync(library) ? await import(library) : null;
const extensionId = 'jpioilmpbolfokedaefmbfbjeaahfdkl';
const check = (name, run) => test(name, { skip: !api, concurrency: false, timeout: 60000 }, run);
const runtimeRoot = fileURLToPath(new URL('../desktop-commander/', import.meta.url));
const temporary = fs.realpathSync(os.tmpdir());
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const encode = value => JSON.stringify(value) + '\n';
const localTarget = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform];
const platform = process.platform + '-' + process.arch;
const assets = {
  'win32-x64': 'windows-amd64', 'win32-arm64': 'windows-arm64',
  'linux-x64': 'linux-amd64', 'linux-arm64': 'linux-arm64',
  'darwin-x64': 'darwin-amd64', 'darwin-arm64': 'darwin-arm64',
};
let dependencies, dependenciesIdentity, retained = false, originalFetch;

function codeIs(code) {
  return error => {
    assert.equal(error.constructor, Error);
    assert.equal(error.message, code);
    assert.equal(error.cause, undefined);
    assert.deepEqual(Object.keys(error), []);
    return true;
  };
}

async function withPatches(patches, run) {
  const restore = [];
  try {
    for (const [object, key, make] of patches) {
      const original = object[key];
      object[key] = make(original);
      restore.push(() => { object[key] = original; });
    }
    return await run();
  } finally { for (const undo of restore.reverse()) undo(); }
}

function checkedRemove(root, identity) {
  assert.equal(path.dirname(path.resolve(root)), temporary);
  assert.match(path.basename(root), /^agent-device-setup-/);
  const current = fs.lstatSync(root, { bigint: true });
  assert.ok(current.isDirectory() && !current.isSymbolicLink());
  assert.equal(fs.realpathSync(root), root);
  assert.equal(current.dev, identity.dev);
  assert.equal(current.ino, identity.ino);
  fs.rmSync(root, { recursive: true, force: true });
}

function scratch(t) {
  const root = fs.mkdtempSync(path.join(temporary, 'agent-device-setup-'));
  const identity = fs.lstatSync(root, { bigint: true });
  t.after(() => {
    const acquisition = path.join(root, 'install', 'acquisition');
    if (fs.existsSync(acquisition)) {
      let closed = false;
      try { closed = JSON.parse(fs.readFileSync(path.join(acquisition, 'process.json'))).closeObserved === true; }
      catch { /* An unknown nested process result cannot authorize deletion. */ }
      if (!closed) { retained = true; t.diagnostic('Owned fixture retained: nested npm close unconfirmed'); return; }
    }
    checkedRemove(root, identity);
  });
  return root;
}

before(() => {
  if (!api) return;
  originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('test_network_forbidden'); };
  dependencies = fs.mkdtempSync(path.join(temporary, 'agent-device-setup-deps-'));
  dependenciesIdentity = fs.lstatSync(dependencies, { bigint: true });
  const sourceModules = path.join(runtimeRoot, 'node_modules'), copied = new Set();
  // Copy genuine local unzipper dependencies, preserving their original resolution layout.
  function copyDependency(requireFrom, name) {
    const metaFile = requireFrom.resolve(name + '/package.json'), source = path.dirname(metaFile);
    if (copied.has(source)) return;
    copied.add(source);
    const relative = path.relative(sourceModules, source);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.cpSync(source, path.join(dependencies, 'node_modules', relative), {
      recursive: true,
      filter: file => file === source || !path.relative(source, file).split(path.sep).includes('node_modules'),
    });
    const meta = JSON.parse(fs.readFileSync(metaFile));
    for (const dependency of Object.keys(meta.dependencies || {})) {
      copyDependency(createRequire(metaFile), dependency);
    }
  }
  copyDependency(createRequire(path.join(runtimeRoot, 'package.json')), 'unzipper');
});

after(() => {
  if (api) globalThis.fetch = originalFetch;
  if (dependencies && !retained) checkedRemove(dependencies, dependenciesIdentity);
});

function guardHandle(handle, names, denied, restore) {
  for (const name of names) {
    if (typeof handle[name] !== 'function') continue;
    const original = handle[name];
    handle[name] = (...args) => denied(name, args);
    restore.push(() => { handle[name] = original; });
  }
}

async function withoutIO(run, { metadata = false, reads = true, moduleRead = false } = {}) {
  const attempts = [], handles = [];
  let loaderRead = false;
  const denied = key => () => { attempts.push(key); throw new Error('fixture_unexpected_io'); };
  const names = ['mkdirSync', 'writeFileSync', 'appendFileSync', 'copyFileSync', 'cpSync', 'linkSync', 'renameSync', 'unlinkSync',
    'mkdir', 'writeFile', 'appendFile', 'copyFile', 'cp', 'link', 'rename', 'unlink'];
  if (reads) names.push('readFileSync', 'readSync', 'readvSync', 'createReadStream', 'readFile', 'read', 'readv');
  if (metadata) names.push('lstatSync', 'statSync', 'realpathSync', 'existsSync', 'openSync', 'fstatSync', 'readdirSync', 'accessSync');
  const modulePath = fileURLToPath(library);
  const patches = names.map(key => [fs, key, original => function(file, ...args) {
    const candidate = file instanceof URL ? fileURLToPath(file) : file;
    if (loaderRead && ['openSync', 'readSync', 'fstatSync'].includes(key)) return original.call(this, file, ...args);
    if (moduleRead && ['realpathSync', 'readFileSync', 'openSync', 'statSync', 'lstatSync'].includes(key) &&
        typeof candidate === 'string' && path.resolve(candidate) === modulePath) {
      if (key !== 'readFileSync') return original.call(this, file, ...args);
      loaderRead = true;
      try { return original.call(this, file, ...args); }
      finally { loaderRead = false; }
    }
    return denied(key)();
  }]);
  for (const key of ['writeFile', 'mkdir', 'copyFile', 'link', 'rename', 'unlink', ...(reads ? ['readFile'] : []),
    ...(metadata ? ['stat', 'lstat', 'realpath', 'open'] : [])]) {
    patches.push([fs.promises, key, () => denied('promises.' + key)]);
  }
  if (!metadata) patches.push([fs.promises, 'open', original => async function(...args) {
    const handle = await original.apply(this, args);
    guardHandle(handle, ['write', 'writeFile', 'writev', 'appendFile', 'createWriteStream',
      ...(reads ? ['read', 'readFile', 'readv', 'createReadStream'] : [])],
    key => denied('FileHandle.' + key)(), handles);
    return handle;
  }]);
  try { await withPatches(patches, run); }
  finally {
    for (const restore of handles.reverse()) restore();
    assert.deepEqual(attempts, [], 'refusal attempted forbidden I/O');
  }
}

async function unreadKey(file, run) {
  const descriptors = new Set(), attempts = [], handles = [];
  const identity = fs.lstatSync(file, { bigint: true });
  const normalize = value => {
    if (value instanceof URL) value = fileURLToPath(value);
    if (typeof value !== 'string') return null;
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const key = normalize(file);
  const hasKeyIdentity = value => {
    try {
      const info = typeof value === 'number' ? fs.fstatSync(value, { bigint: true }) :
        normalize(value) === null ? null : fs.statSync(value, { bigint: true });
      return info !== null && info.dev === identity.dev && info.ino === identity.ino;
    } catch { return false; }
  };
  const checkFile = value => {
    if (normalize(value) === key || (typeof value === 'number' && descriptors.has(value)) || hasKeyIdentity(value)) {
      attempts.push('key-content-read'); throw new Error('fixture_key_read_forbidden');
    }
  };
  const patches = ['readFileSync', 'readFile', 'createReadStream'].map(name => [fs, name,
    original => function(value, ...args) { checkFile(value); return original.call(this, value, ...args); }]);
  patches.push([fs, 'openSync', original => function(value, ...args) {
    const fd = original.call(this, value, ...args);
    if (normalize(value) === key || hasKeyIdentity(fd)) descriptors.add(fd);
    return fd;
  }]);
  patches.push([fs, 'closeSync', original => function(fd, ...args) {
    try { return original.call(this, fd, ...args); } finally { descriptors.delete(fd); }
  }]);
  for (const name of ['readSync', 'readvSync']) patches.push([fs, name, original => function(fd, ...args) {
    checkFile(fd); return original.call(this, fd, ...args);
  }]);
  patches.push([fs.promises, 'readFile', original => function(value, ...args) {
    checkFile(value); return original.call(this, value, ...args);
  }]);
  patches.push([fs.promises, 'open', original => async function(value, ...args) {
    const handle = await original.call(this, value, ...args);
    if (normalize(value) === key || hasKeyIdentity(handle.fd)) guardHandle(handle, ['read', 'readFile', 'readv', 'createReadStream'], () => {
      attempts.push('key-content-read'); throw new Error('fixture_key_read_forbidden');
    }, handles);
    return handle;
  }]);
  try { return await withPatches(patches, run); }
  finally {
    for (const restore of handles.reverse()) restore();
    assert.deepEqual(attempts, [], 'setup consumed opaque key bytes');
  }
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}

// Write a stored ZIP fixture; extraction remains the genuine staged unzipper's job.
function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const { name: text, data } of entries) {
    const name = Buffer.from(text), header = Buffer.alloc(30), directory = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(data), 14); header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(0x0314, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc32(data), 16); directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE((0o100600 << 16) >>> 0, 38); directory.writeUInt32LE(offset, 42);
    local.push(header, name, data); central.push(directory, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function reseal(f, name, content) {
  const file = path.join(f.packageRoot, 'payload', name);
  fs.writeFileSync(file, content);
  const manifestFile = path.join(f.packageRoot, 'payload-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile)), bytes = Buffer.from(content);
  Object.assign(manifest.files.find(record => record.path === name), { bytes: bytes.length, sha256: digest(bytes) });
  fs.writeFileSync(manifestFile, encode(manifest));
}

function fixture(t) {
  assert.ok(assets[platform], 'fixture requires a supported native platform');
  const root = scratch(t), packageRoot = path.join(root, 'package');
  buildPackage(packageRoot);
  const request = buildSetupRequest(localTarget, extensionId), requestBytes = serializeSetupRequest(request);
  const setupRequestFile = path.join(root, 'request.json'), runtimeKeyFile = path.join(root, 'opaque-key');
  const keyBytes = Buffer.from('opaque synthetic bytes; never a credential\n');
  fs.writeFileSync(setupRequestFile, requestBytes, { mode: 0o600 });
  fs.writeFileSync(runtimeKeyFile, keyBytes, { mode: 0o600 });
  const executable = process.platform === 'win32' ? 'tunnel-client-runtime.exe' : 'tunnel-client-runtime';
  const base = 'tunnel-client-runtime-v0.0.19-' + assets[platform];
  const entries = [
    { name: executable, data: Buffer.from('inert fixture, never executed\n') },
    { name: 'LICENSE', data: Buffer.from('fixture license\n') },
    { name: 'NOTICE', data: Buffer.from('fixture notice\n') },
    { name: base + '-licenses.txt', data: Buffer.from('fixture licenses\n') },
    { name: base + '.spdx.json', data: Buffer.from('{"fixture":true}\n') },
  ];
  const archive = zip(entries), offlineArchive = path.join(root, 'client.zip');
  fs.writeFileSync(offlineArchive, archive, { mode: 0o600 });
  const pin = { asset: base + '.zip', archiveSha256: digest(archive),
    executableSha256: digest(entries[0].data), spdxSha256: digest(entries.at(-1).data) };
  const f = { root, packageRoot, setupRequestFile, runtimeKeyFile, keyBytes, request, requestBytes,
    installDir: path.join(root, 'install'), offlineArchive, executable, pin };
  reseal(f, 'tunnel-pins.json', encode({ release: 'v0.0.19',
    source: 'https://github.com/openai/tunnel-client/releases/tag/v0.0.19', platforms: { [platform]: pin } }));
  const npmRoot = path.join(root, 'fake-npm'), npmCli = path.join(npmRoot, 'bin', 'npm-cli.js');
  fs.mkdirSync(path.dirname(npmCli), { recursive: true });
  fs.writeFileSync(path.join(npmRoot, 'package.json'), encode({ name: 'npm', version: '11.0.0' }));
  const provider = path.join(runtimeRoot, 'node_modules', '@wonderwhy-er', 'desktop-commander');
  const copier = `const fs=require('node:fs'),path=require('node:path');
const source=${JSON.stringify(provider)},out=path.join(process.cwd(),'node_modules','@wonderwhy-er','desktop-commander');
fs.appendFileSync(${JSON.stringify(path.join(root, 'npm-attempts'))},'1');
fs.mkdirSync(out,{recursive:true});
fs.copyFileSync(path.join(source,'package.json'),path.join(out,'package.json'));
fs.cpSync(path.join(source,'dist'),path.join(out,'dist'),{recursive:true});
fs.cpSync(${JSON.stringify(path.join(dependencies, 'node_modules'))},path.join(process.cwd(),'node_modules'),{recursive:true});
`;
  f.setNpm = body => fs.writeFileSync(npmCli, copier + body);
  f.setNpm('');
  f.npmRoot = npmRoot;
  f.options = { installDir: f.installDir, consent: 'full-account', setupRequestFile,
    tunnelId: 'tunnel_' + 'a'.repeat(32), runtimeKeyFile, offlineArchive };
  f.trusted = { packageRoot, npmCli, acquisitionTimeoutMs: 15000,
    fetchImpl: () => { throw new Error('test_network_forbidden'); } };
  f.receiptFile = path.join(f.installDir, 'setup-receipt.json');
  return f;
}

function expectedReceipt(f) {
  return { format: 'agent-continue-device-setup-result', version: 1, status: 'configured',
    providerVersion: '0.3.1', tunnelRelease: 'v0.0.19', target: f.request.target,
    extensionId: f.request.extensionId, nativeHost: f.request.nativeHost, requestSha256: digest(f.requestBytes),
    configured: true, activated: false, authenticationVerified: false, nativeRegistrationVerified: false,
    chatAuthorizationVerified: false, protectedInstallationVerified: false, nativeDependenciesVerified: false };
}

test('device setup exposes the three reviewed public APIs', () => {
  for (const name of ['validateSetupRequest', 'readSetupRequest', 'setupDevice']) {
    assert.equal(typeof api?.[name], 'function', `missing setup API: ${name}`);
  }
});

check('pure validation clones and freezes the real producer five-field request', () => {
  for (const [platform, targets] of [['win32', ['windows']], ['darwin', ['macos']], ['linux', ['linux', 'linux-server']]]) {
    for (const target of targets) {
      const source = { ...buildSetupRequest(target, extensionId) };
      const request = api.validateSetupRequest(source, platform);
      assert.deepEqual(request, source);
      assert.notEqual(request, source);
      assert.equal(Object.isFrozen(request), true);
      assert.deepEqual(Object.keys(request), ['format', 'version', 'target', 'extensionId', 'nativeHost']);
      assert.equal(serializeSetupRequest(request), JSON.stringify(request, null, 2) + '\n');
    }
  }
});

check('pure validation closes the schema and distinguishes platform mismatch', () => {
  const valid = buildSetupRequest('windows', extensionId);
  for (const value of [null, [], {}, { ...valid, version: '1' }, { ...valid, target: 'win32' },
    { ...valid, extensionId: extensionId + '\n' }, { ...valid, nativeHost: null },
    { ...valid, command: 'do-not-run' }, { ...valid, approved: true },
    { ...valid, [Symbol('hidden')]: true }]) {
    assert.throws(() => api.validateSetupRequest(value, 'win32'), codeIs('setup_request_invalid'));
  }
  for (const host of ['linux', 'darwin', 'freebsd', 'Windows', null]) {
    assert.throws(() => api.validateSetupRequest(valid, host), codeIs('setup_target_mismatch'));
  }
  const reversed = Object.fromEntries(Object.entries(valid).reverse());
  assert.deepEqual(Object.keys(api.validateSetupRequest(reversed, 'win32')), Object.keys(valid));
});

check('reader accepts actual producer bytes for every target independent of this host', async t => {
  const root = scratch(t), file = path.join(root, 'request.json');
  for (const target of ['windows', 'macos', 'linux', 'linux-server']) {
    const expected = buildSetupRequest(target, extensionId), bytes = serializeSetupRequest(expected);
    fs.writeFileSync(file, bytes);
    const result = await api.readSetupRequest(file);
    assert.deepEqual(Object.keys(result), ['request', 'sha256']);
    assert.deepEqual(result, { request: expected, sha256: digest(bytes) });
    assert.equal(Object.isFrozen(result.request), true);
  }
});

check('reader rejects noncanonical order, duplicate keys, encoding and byte bounds', async t => {
  const root = scratch(t), file = path.join(root, 'request.json');
  const request = buildSetupRequest('windows', extensionId), canonical = serializeSetupRequest(request);
  for (const bytes of [
    '', Buffer.alloc(4097, 32), Buffer.from([0xff, 0xfe, 0x7b]), '\ufeff' + canonical,
    canonical.replaceAll('\n', '\r\n'), canonical.trimEnd(), JSON.stringify(request) + '\n',
    JSON.stringify(Object.fromEntries(Object.entries(request).reverse()), null, 2) + '\n',
    canonical.replace('"version": 1,', '"version": 1,\n  "version": 1,'),
    JSON.stringify({ ...request, runtimeKeyFile: 'not-a-browser-field' }, null, 2) + '\n',
  ]) {
    fs.writeFileSync(file, bytes);
    await assert.rejects(async () => api.readSetupRequest(file), codeIs('setup_request_invalid'));
  }
});

check('reader rejects hard links, redirected ancestors and directories', async t => {
  const root = scratch(t), directory = path.join(root, 'requests');
  fs.mkdirSync(directory);
  const file = path.join(directory, 'request.json');
  fs.writeFileSync(file, serializeSetupRequest(buildSetupRequest('windows', extensionId)));
  const alias = path.join(root, 'hardlink.json');
  fs.linkSync(file, alias);
  await assert.rejects(async () => api.readSetupRequest(alias), codeIs('setup_request_invalid'));
  fs.unlinkSync(alias);
  const redirected = path.join(root, 'redirected');
  fs.symlinkSync(directory, redirected, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(async () => api.readSetupRequest(path.join(redirected, 'request.json')), codeIs('setup_request_invalid'));
  await assert.rejects(async () => api.readSetupRequest(directory), codeIs('setup_request_invalid'));
});

check('reader uses one retained descriptor and closes it when the file changes', async t => {
  const root = scratch(t), file = path.join(root, 'request.json');
  const bytes = serializeSetupRequest(buildSetupRequest('windows', extensionId));
  fs.writeFileSync(file, bytes);
  const descriptors = new Set();
  let opened = 0, closed = 0, changed = false;
  await withPatches([
    [fs, 'openSync', original => function(value, ...args) {
      const fd = original.call(this, value, ...args);
      if (String(value) === file) { descriptors.add(fd); opened++; }
      return fd;
    }],
    [fs, 'readSync', original => function(fd, ...args) {
      const result = original.call(this, fd, ...args);
      if (descriptors.has(fd) && !changed) { changed = true; fs.appendFileSync(file, ' '); }
      return result;
    }],
    [fs, 'closeSync', original => function(fd, ...args) {
      if (descriptors.has(fd)) { closed++; descriptors.delete(fd); }
      return original.call(this, fd, ...args);
    }],
  ], async () => {
    await assert.rejects(async () => api.readSetupRequest(file), codeIs('setup_request_invalid'));
  });
  assert.equal(changed, true);
  assert.equal(opened, 1);
  assert.equal(closed, 1);
});

check('imports have no configuration effects; missing consent precedes metadata and content', async () => {
  // The ESM loader must resolve/read this source; that is not a module-body effect.
  await withoutIO(() => import(library.href + '?effect-free-import'), { moduleRead: true });
  await withoutIO(async () => {
    for (const options of [undefined, null, [], {}, { consent: 'yes' }, { consent: 'acquire-provider' }]) {
      await assert.rejects(api.setupDevice(options), codeIs('consent_required'));
    }
  }, { metadata: true });
});

check('closed options, trusted inputs, tunnel IDs and signal fail before content or writes', async t => {
  const f = fixture(t);
  for (const options of [
    { ...f.options, endpoint: 'forbidden' }, { ...f.options, runtimeKey: 'not-accepted' },
    { ...f.options, signal: {} }, { ...f.options, tunnelId: 'tunnel_short' },
    { ...f.options, tunnelId: f.options.tunnelId + '\n' }, { ...f.options, setupRequestFile: 'relative' },
    { ...f.options, runtimeKeyFile: 'relative' },
  ]) {
    await withoutIO(() => assert.rejects(api.setupDevice(options, f.trusted), codeIs('setup_input_invalid')));
  }
  for (const trusted of [null, [], { ...f.trusted, platform: 'linux-x64' },
    { ...f.trusted, fetchImpl: 1 }, { ...f.trusted, acquisitionTimeoutMs: 0 },
    { ...f.trusted, npmCli: 'relative' }]) {
    await withoutIO(() => assert.rejects(api.setupDevice(f.options, trusted), codeIs('setup_input_invalid')));
  }
  assert.equal(fs.existsSync(f.installDir), false);
});

check('key/request and key/archive identity collisions reject before any content read', async t => {
  for (const field of ['setupRequestFile', 'offlineArchive']) {
    const f = fixture(t), options = { ...f.options, [field]: f.runtimeKeyFile };
    await withoutIO(() => assert.rejects(api.setupDevice(options, f.trusted), codeIs('setup_input_invalid')));
    assert.equal(fs.existsSync(f.installDir), false);
  }
});

check('key exclusion covers cache, package, npm roots and destination collisions before content', async t => {
  for (const location of ['cache', 'package', 'npm', 'destination']) {
    const f = fixture(t), options = { ...f.options };
    if (location === 'destination') {
      options.installDir = path.join(f.runtimeKeyFile, 'not-a-directory');
    } else {
      const parent = location === 'package' ? f.packageRoot : location === 'npm' ? f.npmRoot : path.join(f.root, 'cache');
      fs.mkdirSync(parent, { recursive: true });
      if (location === 'cache') {
        fs.mkdirSync(path.join(parent, '_cacache'));
        options.offlineCache = parent;
      }
      options.runtimeKeyFile = path.join(parent, 'opaque-key');
      fs.writeFileSync(options.runtimeKeyFile, f.keyBytes, { mode: 0o600 });
    }
    await withoutIO(() => assert.rejects(api.setupDevice(options, f.trusted), codeIs('setup_input_invalid')));
    assert.equal(fs.existsSync(f.installDir), false);
  }
});

check('physical Node-parent identity excludes a key without reading toolchain contents', async t => {
  const f = fixture(t), nodeDirectory = path.dirname(fs.realpathSync(process.execPath));
  const normalize = value => process.platform === 'win32' ? path.resolve(String(value)).toLowerCase() : path.resolve(String(value));
  const patches = ['statSync', 'lstatSync'].map(name => [fs, name, original => function(value, ...args) {
    return original.call(this, normalize(value) === normalize(nodeDirectory) ? f.root : value, ...args);
  }]);
  await withPatches(patches, () => withoutIO(() =>
    assert.rejects(api.setupDevice(f.options, f.trusted), codeIs('setup_input_invalid'))));
  assert.equal(fs.existsSync(f.installDir), false);
});

check('physical case aliases cannot turn a key into request data', async t => {
  const f = fixture(t), alias = path.join(path.dirname(f.root), path.basename(f.root).toUpperCase());
  if (!fs.existsSync(alias) || fs.statSync(alias, { bigint: true }).ino !== fs.statSync(f.root, { bigint: true }).ino) {
    return t.skip('case-sensitive fixture filesystem');
  }
  const options = { ...f.options, setupRequestFile: path.join(alias, path.basename(f.runtimeKeyFile)) };
  await withPatches([[fs, 'realpathSync', original => function(value, ...args) {
    return normalizePath(value).startsWith(normalizePath(alias) + path.sep) ? path.resolve(String(value)) : original.call(this, value, ...args);
  }]], () => withoutIO(() => assert.rejects(api.setupDevice(options, f.trusted), codeIs('setup_input_invalid'))));
});

function normalizePath(value) {
  return path.resolve(String(value));
}

check('invalid key metadata and its pre-request recheck have no content or write effects', async t => {
  for (const kind of ['empty', 'oversize', 'hardlink', ...(process.platform === 'win32' ? [] : ['mode'])]) {
    const f = fixture(t);
    if (kind === 'empty') fs.writeFileSync(f.runtimeKeyFile, '');
    if (kind === 'oversize') fs.writeFileSync(f.runtimeKeyFile, Buffer.alloc(65537));
    if (kind === 'hardlink') fs.linkSync(f.runtimeKeyFile, path.join(f.root, 'key-alias'));
    if (kind === 'mode') fs.chmodSync(f.runtimeKeyFile, 0o644);
    await withoutIO(() => assert.rejects(api.setupDevice(f.options, f.trusted), codeIs('setup_input_invalid')));
  }
  const f = fixture(t);
  let checks = 0;
  await withPatches([[fs, 'lstatSync', original => function(value, ...args) {
    const result = original.call(this, value, ...args);
    if (String(value) === f.runtimeKeyFile && args[0]?.bigint && ++checks > 1) {
      return Object.assign(Object.create(result), { mtimeNs: result.mtimeNs + 1n });
    }
    return result;
  }]], () => withoutIO(() => assert.rejects(api.setupDevice(f.options, f.trusted), codeIs('setup_input_invalid'))));
  assert.ok(checks >= 2, 'key metadata must be rechecked before request content');
});

check('existing destination wins before request and pin content reads', async t => {
  const f = fixture(t);
  fs.mkdirSync(f.installDir);
  fs.writeFileSync(path.join(f.installDir, 'preserve'), 'unchanged');
  await withoutIO(() => assert.rejects(api.setupDevice(f.options, f.trusted), codeIs('destination_exists')));
  assert.deepEqual(fs.readdirSync(f.installDir), ['preserve']);
});

check('canonical errors, metadata failures and target mismatch precede acquisition effects', async t => {
  for (const kind of ['canonical', 'metadata', 'target']) {
    const f = fixture(t);
    if (kind === 'canonical') fs.writeFileSync(f.setupRequestFile, '{}\n');
    if (kind === 'metadata') fs.unlinkSync(f.setupRequestFile);
    if (kind === 'target') fs.writeFileSync(f.setupRequestFile,
      serializeSetupRequest(buildSetupRequest(localTarget === 'windows' ? 'linux' : 'windows', extensionId)));
    const code = { canonical: 'setup_request_invalid', metadata: 'setup_input_invalid', target: 'setup_target_mismatch' }[kind];
    await withoutIO(() => assert.rejects(api.setupDevice(f.options, f.trusted), codeIs(code)), { reads: false });
    assert.equal(fs.existsSync(f.installDir), false);
    assert.equal(fs.existsSync(path.join(f.root, 'npm-attempts')), false);
  }
});

check('one consent composes acquisition and full-account configuration without reading the key', async t => {
  const f = fixture(t);
  const receipt = await unreadKey(f.runtimeKeyFile, () => api.setupDevice(f.options, f.trusted));
  assert.deepEqual(receipt, expectedReceipt(f));
  assert.deepEqual(Object.keys(receipt), Object.keys(expectedReceipt(f)));
  assert.equal(fs.readFileSync(path.join(f.root, 'npm-attempts'), 'utf8'), '1');
  const state = path.join(f.installDir, 'state');
  const profile = JSON.parse(fs.readFileSync(path.join(state, 'tunnel.yaml')));
  const binding = JSON.parse(fs.readFileSync(path.join(state, 'binding.json')));
  assert.equal(profile.control_plane.api_key, 'file:' + f.runtimeKeyFile);
  assert.equal(profile.control_plane.tunnel_id, f.options.tunnelId);
  assert.equal(profile.control_plane.base_url, 'https://api.openai.com');
  assert.equal(binding.tunnelExecutable, path.join(f.installDir, 'client', f.executable));
  assert.equal(binding.runtimeKeyFile, f.runtimeKeyFile);
  const config = JSON.parse(fs.readFileSync(path.join(state, 'home', '.claude-server-commander', 'config.json')));
  assert.deepEqual(config.allowedDirectories, []);
  assert.deepEqual(config.blockedCommands, []);
  const publicBytes = JSON.stringify(receipt);
  for (const forbidden of [f.root, f.runtimeKeyFile, f.options.tunnelId, f.keyBytes.toString()]) {
    assert.equal(publicBytes.includes(forbidden), false);
  }
  assert.equal(fs.readFileSync(f.receiptFile, 'utf8'), encode(receipt), 'final receipt must be canonical JSON.stringify+LF');
});

check('request and key mutation during provider acquisition prevent configuration success', async t => {
  for (const kind of ['request', 'key']) {
    const f = fixture(t);
    const changed = kind === 'request' ? serializeSetupRequest(buildSetupRequest(localTarget, 'a'.repeat(32))) : 'changed synthetic key bytes\n';
    const file = kind === 'request' ? f.setupRequestFile : f.runtimeKeyFile;
    f.setNpm(`fs.writeFileSync(${JSON.stringify(file)},${JSON.stringify(changed)});`);
    await unreadKey(f.runtimeKeyFile, () => assert.rejects(api.setupDevice(f.options, f.trusted),
      codeIs(kind === 'request' ? 'setup_request_invalid' : 'setup_input_invalid')));
    assert.equal(fs.existsSync(f.receiptFile), false);
    assert.equal(fs.existsSync(path.join(f.installDir, 'state')), false);
  }
});

function changeExport(f, file, name, body) {
  const source = fs.readFileSync(path.join(f.packageRoot, 'payload', file), 'utf8');
  const declaration = 'export function ' + name + '(';
  assert.ok(source.includes(declaration));
  reseal(f, file, source.replace(declaration, 'function original_' + name + '(') +
    `\nexport function ${name}(...args) { const result = original_${name}(...args); ${body} }\n`);
}

check('native helper returns must be exact records, not truthy or overclaiming results', async t => {
  for (const [file, name, body] of [
    ['runtime.mjs', 'prepareState', 'return {...result, extra:true};'],
    ['profile.mjs', 'writeTunnelProfile', 'return {...result, configured:1};'],
    ['profile.mjs', 'inspectTunnelProfile', 'return {...result, authenticationVerified:true};'],
  ]) {
    const f = fixture(t);
    changeExport(f, file, name, body);
    await assert.rejects(api.setupDevice(f.options, f.trusted), codeIs('setup_configuration_failed'));
    assert.equal(fs.existsSync(f.receiptFile), false);
  }
});

check('partial profile failures preserve diagnostics but return only a fixed error code', async t => {
  const f = fixture(t), binding = path.join(f.installDir, 'state', 'binding.json');
  await withPatches([[fs, 'writeFileSync', original => function(file, ...args) {
    if (String(file) === binding) throw new Error('private synthetic path: ' + binding);
    return original.call(this, file, ...args);
  }]], () => assert.rejects(api.setupDevice(f.options, f.trusted), codeIs('setup_configuration_failed')));
  assert.equal(fs.existsSync(path.join(f.installDir, 'state', 'tunnel.yaml')), true);
  assert.equal(fs.existsSync(binding), false);
  assert.equal(fs.existsSync(f.receiptFile), false);
  await assert.rejects(api.setupDevice(f.options, f.trusted), codeIs('destination_exists'));
});

check('archive, executable, SBOM and client receipt are reverified after client acquisition', async t => {
  for (const kind of ['archive', 'executable', 'sbom', 'receipt']) {
    const f = fixture(t), client = path.join(f.installDir, 'client');
    const targets = { archive: 'release.zip', executable: f.executable,
      sbom: f.pin.asset.slice(0, -4) + '.spdx.json', receipt: 'receipt.json' };
    await withPatches([[fs, 'linkSync', original => function(from, to, ...args) {
      const result = original.call(this, from, to, ...args);
      if (String(to) === path.join(client, 'receipt.json')) fs.appendFileSync(path.join(client, targets[kind]), 'changed');
      return result;
    }]], () => assert.rejects(api.setupDevice(f.options, f.trusted), codeIs('client_verification_failed')));
    assert.equal(fs.existsSync(f.receiptFile), false);
    assert.equal(fs.existsSync(path.join(f.installDir, 'state')), false);
  }
});

check('pre-aborted setup has no effects; cancellation after provider commit never configures', async t => {
  const f = fixture(t), before = new AbortController();
  before.abort();
  await withoutIO(() => assert.rejects(api.setupDevice({ ...f.options, signal: before.signal }, f.trusted),
    codeIs('setup_cancelled')), { metadata: true });
  const controller = new AbortController();
  await withPatches([[fs, 'linkSync', original => function(from, to, ...args) {
    const result = original.call(this, from, to, ...args);
    if (String(to) === path.join(f.installDir, 'receipt.json')) controller.abort();
    return result;
  }]], () => assert.rejects(api.setupDevice({ ...f.options, signal: controller.signal }, f.trusted), codeIs('setup_cancelled')));
  assert.equal(fs.existsSync(f.receiptFile), false);
  assert.equal(fs.existsSync(path.join(f.installDir, 'client')), false);
});

function isSetupReceipt(bytes) {
  try { return JSON.parse(String(bytes)).format === 'agent-continue-device-setup-result'; }
  catch { return false; }
}

check('abort after pending receipt write prevents the final create-only commit', async t => {
  const f = fixture(t), controller = new AbortController();
  let pendingObserved = false;
  await withPatches([[fs, 'writeFileSync', original => function(file, bytes, ...args) {
    const result = original.call(this, file, bytes, ...args);
    if (isSetupReceipt(bytes)) { pendingObserved = true; controller.abort(); }
    return result;
  }]], () => assert.rejects(api.setupDevice({ ...f.options, signal: controller.signal }, f.trusted), codeIs('setup_cancelled')));
  assert.equal(pendingObserved, true);
  assert.equal(fs.existsSync(f.receiptFile), false);
});

check('pending-write and final-link failures never publish a setup success receipt', async t => {
  for (const phase of ['write', 'link']) {
    const f = fixture(t);
    const patch = phase === 'write' ? [fs, 'writeFileSync', original => function(file, bytes, ...args) {
      if (isSetupReceipt(bytes)) throw new Error('synthetic receipt write failure: ' + f.root);
      return original.call(this, file, bytes, ...args);
    }] : [fs, 'linkSync', original => function(from, to, ...args) {
      if (String(to) === f.receiptFile) throw new Error('synthetic receipt link failure: ' + f.root);
      return original.call(this, from, to, ...args);
    }];
    await withPatches([patch], () => assert.rejects(api.setupDevice(f.options, f.trusted), codeIs('setup_receipt_failed')));
    assert.equal(fs.existsSync(f.receiptFile), false);
    assert.equal(fs.existsSync(path.join(f.installDir, 'state', 'binding.json')), true);
    await assert.rejects(api.setupDevice(f.options, f.trusted), codeIs('destination_exists'));
  }
});

check('a committed receipt wins over subsequent abort and pending cleanup failure', async t => {
  const f = fixture(t), controller = new AbortController();
  let committedPending;
  const result = await withPatches([
    [fs, 'linkSync', original => function(from, to, ...args) {
      const result = original.call(this, from, to, ...args);
      if (String(to) === f.receiptFile) { committedPending = String(from); controller.abort(); }
      return result;
    }],
    [fs, 'unlinkSync', original => function(file, ...args) {
      if (String(file) === committedPending) throw new Error('synthetic cleanup failure');
      return original.call(this, file, ...args);
    }],
  ], () => api.setupDevice({ ...f.options, signal: controller.signal }, f.trusted));
  assert.ok(committedPending);
  assert.deepEqual(result, expectedReceipt(f));
  assert.deepEqual(JSON.parse(fs.readFileSync(f.receiptFile)), expectedReceipt(f));
});

check('regression: selected npm metadata symlink cannot consume an external key', async t => {
  const f = fixture(t), metadata = path.join(f.npmRoot, 'package.json');
  fs.unlinkSync(metadata);
  try { fs.symlinkSync(f.runtimeKeyFile, metadata, 'file'); }
  catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      return t.skip('Windows denied file-symlink creation; external-key metadata case not executed');
    }
    throw error;
  }
  await unreadKey(f.runtimeKeyFile, () => assert.rejects(api.setupDevice(f.options, f.trusted), codeIs('npm_unavailable')));
  assert.equal(fs.existsSync(f.installDir), false);
  assert.equal(fs.existsSync(f.receiptFile), false);
  assert.equal(fs.existsSync(path.join(f.installDir, 'state')), false);
  assert.equal(fs.existsSync(path.join(f.root, 'npm-attempts')), false);
});

check('regression: profile removed during final provider verification cannot publish configured', async t => {
  const f = fixture(t), state = path.join(f.installDir, 'state');
  const binding = path.join(state, 'binding.json'), profile = path.join(state, 'tunnel.yaml');
  let removals = 0;
  await withPatches([[fs, 'readFileSync', original => function(file, ...args) {
    const bytes = original.call(this, file, ...args);
    if (String(file) === path.join(f.installDir, 'receipt.json') && removals === 0 && fs.existsSync(binding)) {
      fs.unlinkSync(profile);
      removals++;
    }
    return bytes;
  }]], () => assert.rejects(api.setupDevice(f.options, f.trusted), codeIs('setup_configuration_failed')));
  assert.equal(removals, 1);
  assert.equal(fs.existsSync(profile), false);
  assert.equal(fs.existsSync(f.receiptFile), false);
});

check('regression: request retained descriptor excludes a key renamed after preflight', async t => {
  const f = fixture(t), identity = fs.lstatSync(f.runtimeKeyFile, { bigint: true });
  let requestStats = 0, renamed = false, keyReads = 0;
  await withPatches([
    [fs, 'lstatSync', original => function(file, ...args) {
      if (String(file) === f.setupRequestFile && args[0]?.bigint && ++requestStats === 2) {
        fs.unlinkSync(f.setupRequestFile);
        fs.renameSync(f.runtimeKeyFile, f.setupRequestFile);
        renamed = true;
      }
      return original.call(this, file, ...args);
    }],
    [fs, 'readSync', original => function(fd, ...args) {
      const current = fs.fstatSync(fd, { bigint: true });
      if (current.dev === identity.dev && current.ino === identity.ino) {
        keyReads++;
        throw new Error('fixture_renamed_key_read_forbidden');
      }
      return original.call(this, fd, ...args);
    }],
  ], () => assert.rejects(api.setupDevice(f.options, f.trusted), codeIs('setup_request_invalid')));
  assert.equal(renamed, true, 'replacement must occur at reader initial metadata, after key preflight');
  assert.equal(keyReads, 0, 'retained request descriptor must reject the saved key identity before reading');
  assert.equal(fs.existsSync(f.installDir), false);
  assert.equal(fs.existsSync(f.receiptFile), false);
});
