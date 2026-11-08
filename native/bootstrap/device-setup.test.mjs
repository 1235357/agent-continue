import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPackage } from './build-package.mjs';
import { RUNTIME_FILES } from './payload-layout.mjs';
import { buildSetupRequest, serializeSetupRequest } from '../../setup-model.js';

const library = new URL('./device-setup.mjs', import.meta.url);
const api = fs.existsSync(library) ? await import(library) : null;
const extensionId = 'jpioilmpbolfokedaefmbfbjeaahfdkl';
const check = (name, run) => test(name, { skip: !api, concurrency: false, timeout: 60000 }, run);
const runtimeRoot = fileURLToPath(new URL('../desktop-commander/', import.meta.url));
// Darwin's per-user temp path can exhaust sockaddr_un before the fixture starts.
// Retain canonical-path/inode cleanup checks within a short private scratch root.
const temporary = fs.realpathSync(process.platform === 'darwin' ? '/tmp' : os.tmpdir());
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
  if (process.platform !== 'win32') {
    assert.ok(Buffer.byteLength(path.join(root, 'install', 'state', 'device-' + 'a'.repeat(32) + '.sock')) < 104,
      'fixture socket must fit the shortest supported sockaddr_un path');
  }
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

const managerAvailable = typeof api?.setupManager === 'function';
const managerCheck = (name, run) => test(name, {
  skip: managerAvailable ? false : 'manager API not implemented', concurrency: false, timeout: 60000,
}, run);
const managerOptions = f => ({ installDir: f.installDir, consent: 'full-account', setupRequestFile: f.setupRequestFile });
const managerTrusted = f => ({ packageRoot: f.packageRoot, npmCli: f.trusted.npmCli, acquisitionTimeoutMs: 15000 });
const managerReceiptFile = f => path.join(f.installDir, 'manager-receipt.json');
function managerReceipt(f) {
  return { format: 'agent-continue-manager-setup-result', version: 1, status: 'prepared', providerVersion: '0.3.1',
    target: f.request.target, extensionId: f.request.extensionId, nativeHost: f.request.nativeHost,
    requestSha256: digest(f.requestBytes), prepared: true, localTunnelConfigured: false, activated: false,
    authenticationVerified: false, nativeRegistrationVerified: false, chatAuthorizationVerified: false,
    protectedInstallationVerified: false, nativeDependenciesVerified: false };
}

function expectedReceipt(f) {
  return { format: 'agent-continue-device-setup-result', version: 1, status: 'configured',
    providerVersion: '0.3.1', tunnelRelease: 'v0.0.19', target: f.request.target,
    extensionId: f.request.extensionId, nativeHost: f.request.nativeHost, requestSha256: digest(f.requestBytes),
    configured: true, activated: false, authenticationVerified: false, nativeRegistrationVerified: false,
    chatAuthorizationVerified: false, protectedInstallationVerified: false, nativeDependenciesVerified: false };
}

test('manager setup exposes an independent API and a closed CLI command', async () => {
  assert.equal(typeof api?.setupManager, 'function');
  const { main } = await import('./bin.mjs');
  assert.ok((await main(['help'])).commands.includes('setup-manager'));
});

test('manager setup help identifies the distinct no-local-tunnel command', async () => {
  const { main } = await import('./bin.mjs');
  const help = await main(['help']);
  assert.equal(help.ok, true);
  for (const command of ['setup', 'setup-manager', 'enroll-ssh']) assert.ok(help.commands.includes(command));
});

managerCheck('manager consent, closed data fields and pre-abort refuse before any filesystem access', async () => {
  await withoutIO(async () => {
    for (const options of [undefined, {}, { consent: 'no' }, { get consent() { throw new Error('do-not-call'); } }]) {
      await assert.rejects(api.setupManager(options), codeIs('consent_required'));
    }
    const base = { installDir: '/missing', consent: 'full-account', setupRequestFile: '/request' };
    for (const options of [{ ...base, runtimeKeyFile: '/private' }, { ...base, tunnelId: 'never' },
      { ...base, offlineArchive: '/zip' }, { ...base, [Symbol('extra')]: true }, { ...base, signal: {} },
      { ...base, get offlineCache() { throw new Error('do-not-call'); } }]) {
      await assert.rejects(api.setupManager(options), codeIs('setup_input_invalid'));
    }
    for (const trusted of [{ fetchImpl() {} }, { command: 'private' }, { acquisitionTimeoutMs: 19 },
      { acquisitionTimeoutMs: Infinity }, { acquisitionTimeoutMs: Number.MAX_SAFE_INTEGER + 1 },
      { get packageRoot() { throw new Error('do-not-call'); } }]) {
      await assert.rejects(api.setupManager(base, trusted), codeIs('setup_input_invalid'));
    }
    const controller = new AbortController(); controller.abort();
    await assert.rejects(api.setupManager({ ...base, signal: controller.signal }), codeIs('setup_cancelled'));
    for (const acquisitionTimeoutMs of [180001, Number.MAX_SAFE_INTEGER]) {
      await assert.rejects(api.setupManager({ ...base, signal: controller.signal }, { acquisitionTimeoutMs }), codeIs('setup_cancelled'));
    }
    const nonEnumerableSignal = Object.defineProperty({ ...base }, 'signal', { value: controller.signal });
    await assert.rejects(api.setupManager(nonEnumerableSignal), codeIs('setup_cancelled'));
  }, { metadata: true });
});

managerCheck('manager uses one pinned provider acquisition and actual binding consumer without a local key or client', async t => {
  const f = fixture(t), app = path.join(f.installDir, 'app'), state = path.join(f.installDir, 'state');
  fs.unlinkSync(f.runtimeKeyFile); fs.unlinkSync(f.offlineArchive);
  changeExport(f, 'profile.mjs', 'writeTunnelProfile', 'throw new Error("profile_must_not_run");');
  const offlineCache = path.join(f.root, 'provider-cache'); fs.mkdirSync(path.join(offlineCache, '_cacache'), { recursive: true });
  f.setNpm(`if(!process.argv.includes('--offline'))process.exit(81);`);
  const options = Object.create(null);
  for (const [name, value] of Object.entries({ ...managerOptions(f), offlineCache })) Object.defineProperty(options, name, { value });
  const trusted = Object.create(null);
  for (const [name, value] of Object.entries(managerTrusted(f))) Object.defineProperty(trusted, name, { value });
  const result = await api.setupManager(options, trusted);
  assert.deepEqual(result, managerReceipt(f)); assert.deepEqual(Object.keys(result), Object.keys(managerReceipt(f)));
  assert.equal(fs.readFileSync(path.join(f.root, 'npm-attempts'), 'utf8'), '1');
  assert.equal(fs.existsSync(path.join(f.installDir, 'client')), false);
  assert.equal(fs.existsSync(f.receiptFile), false);
  const file = path.join(app, 'device-native-binding.json');
  assert.equal(fs.readFileSync(file, 'utf8'), encode({ format: 'agent-continue-native-binding', version: 1,
    extensionId: f.request.extensionId, stateRoot: state }));
  const { readNativeBinding } = await import(pathToFileURL(path.join(app, 'device-owner.mjs')));
  const binding = readNativeBinding(file); binding.assertCurrent();
  assert.equal(binding.extensionId, extensionId); assert.equal(binding.root, state);
  assert.equal(fs.lstatSync(file).nlink, 1);
  if (process.platform !== 'win32') assert.equal(fs.lstatSync(file).mode & 0o077, 0);
  for (const name of ['binding.json', 'tunnel.yaml', 'device-channel.json', 'device-operations.jsonl', 'controller.lease', 'health.url']) {
    assert.equal(fs.existsSync(path.join(state, name)), false, name);
  }
  assert.equal(fs.readFileSync(managerReceiptFile(f), 'utf8'), encode(managerReceipt(f)));
  for (const secret of [f.root, f.runtimeKeyFile, f.options.tunnelId, f.keyBytes.toString()]) {
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

managerCheck('manager environment strips preloads and ambient keys without changing user network or home', () => {
  const parent = {HOME:'fixture-home',HTTPS_PROXY:'http://127.0.0.1:8118',PATH:'fixture-path',
    NODE_OPTIONS:'--require fixture',node_path:'fixture',NPM_CONFIG_USERCONFIG:'fixture',UV_THREADPOOL_SIZE:'4',
    OPENSSL_CONF:'fixture',SSLKEYLOGFILE:'fixture',OPENAI_API_KEY:'fixture-secret',CONTROL_PLANE_API_KEY:'fixture-key',
    VSCODE_INSPECTOR_OPTIONS:'fixture',ELECTRON_RUN_AS_NODE:'1',DESKTOP_COMMANDER_CONFIG:'fixture'};
  const before = {...parent};
  assert.deepEqual(api.managerEnvironment(parent),{HOME:parent.HOME,HTTPS_PROXY:parent.HTTPS_PROXY,PATH:parent.PATH});
  assert.deepEqual(parent,before);
});

managerCheck('manager start refuses missing consent and unknown fields before filesystem access', async () => {
  await assert.rejects(api.startLocalManager({installDir:'not-a-path'}),codeIs('consent_required'));
  await assert.rejects(api.startLocalManager({installDir:'not-a-path',consent:'accept-install',extra:true}),codeIs('setup_input_invalid'));
});

managerCheck('invalid existing manager channel is retained without spawning a replacement', async t => {
  const f = fixture(t);
  await api.setupManager(managerOptions(f), managerTrusted(f));
  const channel = path.join(f.installDir,'state','device-channel.json');
  const bytes = 'invalid fixture channel\n';
  fs.writeFileSync(channel,bytes,{mode:0o600});
  let spawns=0;
  await assert.rejects(api.startLocalManager({installDir:f.installDir,consent:'accept-install'},
    {packageRoot:f.packageRoot,spawn(){spawns++;throw new Error('must_not_spawn');}}),codeIs('manager_start_unconfirmed'));
  await assert.rejects(api.startLocalManager({installDir:f.installDir,consent:'accept-install'},
    {packageRoot:f.packageRoot,spawn(){spawns++;throw new Error('must_not_spawn');}}),codeIs('manager_start_unconfirmed'));
  assert.equal(spawns,0);
  assert.equal(fs.readFileSync(channel,'utf8'),bytes);
});

managerCheck('consented manager start reaches authenticated IPC and reuses one owned process', async t => {
  const f = fixture(t);
  const source = fs.readFileSync(path.join(f.packageRoot,'payload','device-owner.mjs'),'utf8');
  reseal(f,'device-owner.mjs',source.replace('export async function sendDeviceRequest(',
    'async function original_sendDeviceRequest(')+`
    export async function sendDeviceRequest(...args) {
      if(args[1]?.action==='status' && (!Number.isInteger(args[2]?.timeoutMs) ||
        args[2].timeoutMs<1 || args[2].timeoutMs>10000)) throw new Error('fixture_missing_status_deadline');
      return original_sendDeviceRequest(...args);
    }\n`);
  await api.setupManager(managerOptions(f), managerTrusted(f));
  const children = [];
  const cleanup = async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) { const exited = once(child,'exit');child.kill();await exited; }
    }
  };
  const trusted = {packageRoot:f.packageRoot,spawn(command,args,options){
    assert.equal(options.windowsHide,true);assert.equal(options.shell,false);
    const child=spawn(command,args,options);children.push(child);return child;
  }};
  const options = {installDir:f.installDir,consent:'accept-install'};
  try {
    const [first, concurrent] = await Promise.all([
      api.startLocalManager(options,trusted), api.startLocalManager(options,trusted)]);
    assert.deepEqual(first,{ok:true,managerRunning:true,connected:false,paused:true});
    assert.deepEqual(concurrent,first);
    assert.deepEqual(await api.startLocalManager(options,trusted),first);
    assert.equal(children.length,1);
    const rejected = await api.startLocalManager({...options,connect:true},trusted);
    assert.equal(api.isManagerOperationFailure(rejected),true);
    assert.deepEqual(await api.startLocalManager({...options,connect:true},trusted),rejected);
    assert.equal(children.length,1,'failed connection never starts another owner');
    const after = await api.startLocalManager(options,trusted);
    assert.equal(after.managerRunning,true);
    assert.equal(after.connected,false);
    assert.equal(after.paused,true,'missing configuration cannot silently clear pause');
  } finally {await cleanup();}
});

managerCheck('explicit connection returns readiness through real owner IPC without duplicate startup', async t => {
  const f = fixture(t);
  // Synthetic readiness only: no credentials, network or production tunnel.
  changeExport(f, 'lifecycle.mjs', 'openController', `
    let connected = false;
    return { dispose: () => result.dispose(),
      status: async () => ({paused:!connected, runtime:connected?'running':'stopped', ready:connected}),
      reconnect: async () => { connected=true; return {paused:false, runtime:'running', ready:true}; },
      pause: async () => { connected=false; } };
  `);
  await api.setupManager(managerOptions(f), managerTrusted(f));
  const children = [];
  const trusted = {packageRoot:f.packageRoot,spawn(command,args,options){
    assert.equal(options.windowsHide,true);assert.equal(options.shell,false);
    const child=spawn(command,args,options);children.push(child);return child;
  }};
  const options = {installDir:f.installDir,consent:'accept-install',connect:true};
  try {
    const [first, concurrent] = await Promise.all([
      api.startLocalManager(options,trusted), api.startLocalManager(options,trusted)]);
    assert.match(first.operationId,/^[0-9a-f-]{36}$/);
    assert.deepEqual(first,{ok:true,managerRunning:true,connected:true,paused:false,operationId:first.operationId,operationStatus:'settled'});
    assert.deepEqual(concurrent,first);
    assert.deepEqual(await api.startLocalManager({...options,connect:false},trusted),
      {ok:true,managerRunning:true,connected:true,paused:false});
    assert.equal(children.length,1);
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited=once(child,'exit');child.kill();await exited;
      }
    }
  }
});

managerCheck('lost reconnect reply is recovered by a separate CLI process with the same durable ID', async t => {
  const f = fixture(t), log = path.join(f.root,'reconnects');
  const receiptFile = path.join(f.installDir,'state','installer-reconnect.json');
  const resumeId = crypto.randomUUID();
  changeExport(f,'lifecycle.mjs','openController',`
    let connected = false;
    const observed = () => ({paused:!connected, runtime:connected?'running':'stopped', ready:connected});
    return { dispose: () => result.dispose(), status: async () => observed(),
      reconnect: async () => { connected=true; return observed(); },
      pause: async () => { connected=false; return observed(); } };
  `);
  const owner = fs.readFileSync(path.join(f.packageRoot,'payload','device-owner.mjs'),'utf8');
  reseal(f,'device-owner.mjs',owner.replace('export async function sendDeviceRequest(', 'async function original_sendDeviceRequest(')+`
    export async function sendDeviceRequest(binding,request,options) {
      if (request.action !== 'reconnect' || request.id === ${JSON.stringify(resumeId)}) return original_sendDeviceRequest(binding,request,options);
      const receipt = JSON.parse(fs.readFileSync(${JSON.stringify(receiptFile)},'utf8'));
      if (receipt.id !== request.id) throw new Error('missing_durable_id');
      fs.appendFileSync(${JSON.stringify(log)},request.id+'\\n');
      await original_sendDeviceRequest(binding,request,options);
      throw new Error('fixture_lost_reply');
    }
  `);
  await api.setupManager(managerOptions(f),managerTrusted(f));
  const children=[];
  const trusted={packageRoot:f.packageRoot,spawn(...args){const child=spawn(...args);children.push(child);return child;}};
  const options={installDir:f.installDir,consent:'accept-install'};
  const run=promisify(execFile);
  async function cli(command,...extra) {
    try {
      const {stdout}=await run(process.execPath,[path.join(f.packageRoot,'bin.mjs'),command,'--install-dir',f.installDir,...extra],
        {windowsHide:true,timeout:20000});
      return {exit:0,result:JSON.parse(stdout)};
    } catch(error) {
      assert.equal(error.code,1);
      return {exit:1,result:JSON.parse(error.stdout)};
    }
  }
  const connect=['--consent','accept-install','--connect','true'];
  try {
    assert.deepEqual(await cli('manager-status'),{exit:1,result:{ok:false,error:'manager_operation_not_recorded'}});
    assert.equal(fs.existsSync(path.join(f.installDir,'state','device-channel.json')),false);
    await api.startLocalManager(options,trusted);
    const outcomes=await Promise.all([cli('start-manager',...connect),cli('start-manager',...connect)]);
    const dispatched=outcomes.find(({result})=>result.operationStatus==='unobserved' && result.operationId);
    assert.ok(dispatched);
    assert.equal(dispatched.exit,1);
    const id=dispatched.result.operationId;
    const saved=fs.readFileSync(receiptFile,'utf8');
    assert.deepEqual(JSON.parse(saved),{format:'agent-continue-installer-reconnect',version:1,extensionId,id});
    assert.equal(fs.readFileSync(log,'utf8'),id+'\n');
    assert.ok(outcomes.every(({result})=>result.operationId===id || result.error==='manager_operation_receipt_invalid'));
    assert.deepEqual(await cli('manager-status'),{exit:0,result:{ok:true,operationId:id,operationStatus:'settled',
      managerRunning:true,connection:'ready',paused:false}});
    assert.deepEqual(await cli('start-manager',...connect),{exit:0,result:{ok:true,operationId:id,operationStatus:'settled',
      managerRunning:true,connected:true,paused:false}});
    assert.deepEqual(await cli('manager-control','--action','disconnect-and-pause'),
      {exit:1,result:{ok:false,error:'consent_required'}});
    const paused=await cli('manager-control','--action','disconnect-and-pause','--consent','accept-control');
    assert.equal(paused.exit,0);
    assert.equal(paused.result.state.paused,true);
    const observation=await cli('manager-control','--action','status','--id',paused.result.id);
    assert.equal(observation.exit,0);
    assert.equal(observation.result.state.operation.action,'disconnect-and-pause');
    assert.deepEqual(await cli('start-manager',...connect),{exit:1,result:{ok:false,error:'manager_start_unconfirmed',
      operationId:id,operationStatus:'settled'}});
    assert.deepEqual(await cli('manager-status'),{exit:0,result:{ok:true,operationId:id,operationStatus:'settled',
      managerRunning:true,connection:'disconnected',paused:true}});
    assert.equal(fs.readFileSync(log,'utf8'),id+'\n');
    assert.equal(fs.readFileSync(receiptFile,'utf8'),saved);
    const resumed=await cli('manager-control','--action','reconnect','--consent','accept-control','--id',resumeId);
    assert.equal(resumed.exit,0);
    assert.equal(resumed.result.state.connection,'ready');
    assert.equal(fs.readFileSync(receiptFile,'utf8'),saved);
    assert.equal(children.length,1);
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {const exited=once(child,'exit');child.kill();await exited;}
    }
  }
  const offline=await cli('manager-status');
  assert.deepEqual(offline,{exit:1,result:{ok:false,error:'manager_start_unconfirmed',
    operationId:JSON.parse(fs.readFileSync(receiptFile,'utf8')).id,operationStatus:'unobserved'}});
  assert.deepEqual(await cli('start-manager',...connect),offline);
});

managerCheck('interrupted receipt states never start or repair an owner on a connect retry', async t => {
  const f=fixture(t);
  await api.setupManager(managerOptions(f),managerTrusted(f));
  const receipt=path.join(f.installDir,'state','installer-reconnect.json');
  fs.writeFileSync(receipt,'',{mode:0o600});
  let spawns=0;
  const trusted={packageRoot:f.packageRoot,spawn(){spawns++;throw new Error('must_not_spawn');}};
  await assert.rejects(api.startLocalManager({installDir:f.installDir,consent:'accept-install',connect:true},trusted),
    codeIs('manager_operation_receipt_invalid'));
  await assert.rejects(api.observeLocalManagerOperation(f.installDir,trusted),codeIs('manager_operation_receipt_invalid'));
  assert.equal(spawns,0);
  assert.equal(fs.statSync(receipt).size,0);
  const id=crypto.randomUUID();
  // Model process interruption after reservation but before dispatch.
  const saved=encode({format:'agent-continue-installer-reconnect',version:1,extensionId,id});
  fs.writeFileSync(receipt,saved);
  const unobserved={ok:false,error:'manager_start_unconfirmed',operationId:id,operationStatus:'unobserved'};
  assert.deepEqual(await api.startLocalManager({installDir:f.installDir,consent:'accept-install',connect:true},trusted),unobserved);
  assert.deepEqual(await api.observeLocalManagerOperation(f.installDir,trusted),unobserved);
  assert.equal(spawns,0);
  assert.equal(fs.readFileSync(receipt,'utf8'),saved);
});

managerCheck('unknown pause observation is not reported as unpaused startup success', async t => {
  const f = fixture(t);
  changeExport(f, 'lifecycle.mjs', 'openController', `
    return { dispose: () => result.dispose(), status: async () => { throw new Error('fixture_unobservable'); },
      reconnect: async () => { throw new Error('must_not_connect'); }, pause: () => result.pause() };
  `);
  await api.setupManager(managerOptions(f), managerTrusted(f));
  const children=[];
  const trusted={packageRoot:f.packageRoot,spawn(command,args,options){
    const child=spawn(command,args,options);children.push(child);return child;
  }};
  try {
    await assert.rejects(api.startLocalManager({installDir:f.installDir,consent:'accept-install'},trusted),codeIs('manager_start_unconfirmed'));
    await assert.rejects(api.startLocalManager({installDir:f.installDir,consent:'accept-install',connect:true},trusted),codeIs('manager_start_unconfirmed'));
    assert.equal(children.length,1);
    assert.equal(fs.existsSync(path.join(f.installDir,'state','device-channel.json')),true);
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited=once(child,'exit');child.kill();await exited;
      }
    }
  }
});

managerCheck('manager rejects malformed requests, mismatched local targets and headless server requests before acquisition', async t => {
  const f = fixture(t);
  for (const target of ['windows', 'macos', 'linux', 'linux-server']) {
    if (target === localTarget) continue;
    fs.writeFileSync(f.setupRequestFile, serializeSetupRequest(buildSetupRequest(target, extensionId)));
    await assert.rejects(api.setupManager(managerOptions(f), managerTrusted(f)), codeIs('setup_target_mismatch'));
    assert.equal(fs.existsSync(f.installDir), false);
  }
  fs.writeFileSync(f.setupRequestFile, '{"private":"not-a-request"}\n');
  await assert.rejects(api.setupManager(managerOptions(f), managerTrusted(f)), codeIs('setup_request_invalid'));
  assert.equal(fs.existsSync(path.join(f.root, 'npm-attempts')), false);
});

managerCheck('manager refuses an existing install without consuming its request or repairing state', async t => {
  const f = fixture(t); fs.mkdirSync(f.installDir); fs.writeFileSync(path.join(f.installDir, 'sentinel'), 'keep');
  fs.unlinkSync(f.setupRequestFile);
  await assert.rejects(api.setupManager(managerOptions(f), managerTrusted(f)), codeIs('destination_exists'));
  assert.deepEqual(fs.readdirSync(f.installDir), ['sentinel']);
});

managerCheck('manager preserves an existing binding and never emits prepared after helper overclaims', async t => {
  for (const kind of ['existing', 'overclaim']) {
    const f = fixture(t), file = path.join(f.installDir, 'app', 'device-native-binding.json');
    if (kind === 'existing') f.setNpm(`fs.writeFileSync(path.join(process.cwd(),'device-native-binding.json'),'private-existing-record\\n',{mode:0o600});`);
    else changeExport(f, 'runtime.mjs', 'prepareState', 'return {...result, activated:true};');
    await assert.rejects(api.setupManager(managerOptions(f), managerTrusted(f)), codeIs('setup_configuration_failed'));
    assert.equal(fs.existsSync(managerReceiptFile(f)), false);
    if (kind === 'existing') assert.equal(fs.readFileSync(file, 'utf8'), 'private-existing-record\n');
    await assert.rejects(api.setupManager(managerOptions(f), managerTrusted(f)), codeIs('destination_exists'));
  }
});

managerCheck('manager checks request mutation before preparing state', async t => {
  const f = fixture(t);
  f.setNpm(`fs.writeFileSync(${JSON.stringify(f.setupRequestFile)},${JSON.stringify(serializeSetupRequest(buildSetupRequest(localTarget, 'a'.repeat(32))))});`);
  await assert.rejects(api.setupManager(managerOptions(f), managerTrusted(f)), codeIs('setup_request_invalid'));
  assert.equal(fs.existsSync(path.join(f.installDir, 'state')), false); assert.equal(fs.existsSync(managerReceiptFile(f)), false);
});

managerCheck('manager retains binding, state and request identity across the final awaited provider verification', async t => {
  for (const kind of ['binding', 'state', 'request', 'provider', 'install-root', 'app-root', 'state-root']) {
    const f = fixture(t), app = path.join(f.installDir, 'app'), binding = path.join(app, 'device-native-binding.json');
    let changed = false;
    await withPatches([[fs, 'writeFileSync', original => function(file, ...args) {
      const result = original.call(this, file, ...args);
      if (String(file) === binding && !changed) queueMicrotask(() => {
        if (kind === 'binding') { const bytes = fs.readFileSync(binding); fs.renameSync(binding, binding + '.held'); original.call(fs, binding, bytes, { mode: 0o600 }); }
        if (kind === 'state') fs.writeFileSync(path.join(f.installDir, 'state', 'consent.json'), '{}\n');
        if (kind === 'request') fs.writeFileSync(f.setupRequestFile, serializeSetupRequest(buildSetupRequest(localTarget, 'b'.repeat(32))));
        if (kind === 'provider') fs.appendFileSync(path.join(app, 'device-owner.mjs'), '\n// changed fixture\n');
        if (kind.endsWith('-root')) {
          const directory = kind === 'install-root' ? f.installDir : kind === 'app-root' ? app : path.join(f.installDir, 'state');
          fs.renameSync(directory, directory + '.held'); fs.cpSync(directory + '.held', directory, { recursive: true });
        }
        changed = true;
      });
      return result;
    }]], () => assert.rejects(api.setupManager(managerOptions(f), managerTrusted(f)),
      codeIs(kind === 'request' ? 'setup_request_invalid' : 'setup_configuration_failed'), kind));
    assert.equal(changed, true, kind); assert.equal(fs.existsSync(managerReceiptFile(f)), false, kind);
  }
});

managerCheck('manager cancellation at each precommit boundary never publishes prepared', async t => {
  for (const phase of ['provider', 'binding', 'pending']) {
    const f = fixture(t), controller = new AbortController(); let observed = false;
    const patches = phase === 'provider' ? [[fs, 'linkSync', original => function(from, to, ...args) {
      const result = original.call(this, from, to, ...args);
      if (String(to) === path.join(f.installDir, 'receipt.json')) { observed = true; controller.abort(); }
      return result;
    }]] : [[fs, 'writeFileSync', original => function(file, bytes, ...args) {
      const result = original.call(this, file, bytes, ...args);
      if (phase === 'binding' ? path.basename(String(file)) === 'device-native-binding.json' : isManagerReceipt(bytes)) {
        observed = true; controller.abort();
      }
      return result;
    }]];
    await withPatches(patches, () => assert.rejects(api.setupManager({ ...managerOptions(f), signal: controller.signal }, managerTrusted(f)), codeIs('setup_cancelled')));
    assert.equal(observed, true, phase); assert.equal(fs.existsSync(managerReceiptFile(f)), false, phase);
    if (phase === 'provider') assert.equal(fs.existsSync(path.join(f.installDir, 'state')), false);
  }
});

function isManagerReceipt(bytes) {
  try { return JSON.parse(String(bytes)).format === 'agent-continue-manager-setup-result'; } catch { return false; }
}

managerCheck('manager pending receipt and binding are checked immediately before commitment', async t => {
  for (const kind of ['binding', 'pending']) {
    const f = fixture(t); let changed = false;
    await withPatches([[fs, 'writeFileSync', original => function(file, bytes, ...args) {
      const result = original.call(this, file, bytes, ...args);
      if (isManagerReceipt(bytes) && !changed) {
        const pending = typeof file === 'number' ? path.join(f.installDir,
          fs.readdirSync(f.installDir).find(name => name.startsWith('manager.pending.'))) : String(file);
        const selected = kind === 'binding' ? path.join(f.installDir, 'app', 'device-native-binding.json') : pending;
        const before = fs.readFileSync(selected); fs.renameSync(selected, selected + '.held');
        original.call(fs, selected, before, { mode: 0o600 }); changed = true;
      }
      return result;
    }]], () => assert.rejects(api.setupManager(managerOptions(f), managerTrusted(f)), codeIs(kind === 'binding' ? 'setup_configuration_failed' : 'setup_receipt_failed'), kind));
    assert.equal(changed, true); assert.equal(fs.existsSync(managerReceiptFile(f)), false);
  }
});

managerCheck('manager receipt failures preserve partial state and never overwrite a concurrent receipt', async t => {
  for (const phase of ['write', 'link', 'existing']) {
    const f = fixture(t); let attempted = false;
    const patch = phase === 'write' ? [fs, 'writeFileSync', original => function(file, bytes, ...args) {
      if (isManagerReceipt(bytes)) { attempted = true; throw new Error('private path ' + f.root); }
      return original.call(this, file, bytes, ...args);
    }] : [fs, 'linkSync', original => function(from, to, ...args) {
      if (String(to) === managerReceiptFile(f)) {
        attempted = true;
        if (phase === 'existing') fs.writeFileSync(to, 'concurrent receipt\n', { flag: 'wx', mode: 0o600 });
        else throw new Error('private link ' + f.root);
      }
      return original.call(this, from, to, ...args);
    }];
    await withPatches([patch], () => assert.rejects(api.setupManager(managerOptions(f), managerTrusted(f)), codeIs('setup_receipt_failed')));
    assert.equal(attempted, true); assert.equal(fs.existsSync(path.join(f.installDir, 'state', 'consent.json')), true);
    if (phase === 'existing') assert.equal(fs.readFileSync(managerReceiptFile(f), 'utf8'), 'concurrent receipt\n');
    else assert.equal(fs.existsSync(managerReceiptFile(f)), false);
    await assert.rejects(api.setupManager(managerOptions(f), managerTrusted(f)), codeIs('destination_exists'));
  }
});

managerCheck('manager successful commit wins over later abort and pending cleanup failure', async t => {
  const f = fixture(t), controller = new AbortController(); let committedPending;
  const result = await withPatches([
    [fs, 'linkSync', original => function(from, to, ...args) {
      const result = original.call(this, from, to, ...args);
      if (String(to) === managerReceiptFile(f)) { committedPending = String(from); controller.abort(); }
      return result;
    }],
    [fs, 'unlinkSync', original => function(file, ...args) {
      if (String(file) === committedPending) throw new Error('fixture cleanup failure');
      return original.call(this, file, ...args);
    }],
  ], () => api.setupManager({ ...managerOptions(f), signal: controller.signal }, managerTrusted(f)));
  assert.ok(committedPending); assert.deepEqual(result, managerReceipt(f));
  assert.equal(fs.readFileSync(managerReceiptFile(f), 'utf8'), encode(managerReceipt(f)));
});

managerCheck('manager CLI rejects nonclosed syntax before I/O and releases its signal handlers', async () => {
  const { main } = await import('./bin.mjs');
  const valid = ['setup-manager', '--install-dir', '/missing', '--consent', 'no', '--setup-request', '/request'];
  const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  await withoutIO(async () => {
    for (const args of [valid.slice(0, -2), [...valid, '--setup-request', '/duplicate'], [...valid, '--runtime-key-file', '/private'],
      [...valid, '--tunnel-archive', '/zip'], [...valid, '--tunnel-id', 'never'], [...valid, '--command', 'never']]) {
      await assert.rejects(main(args), codeIs('invalid_arguments'));
    }
    await assert.rejects(main(valid), codeIs('consent_required'));
  }, { metadata: true });
  assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before);
});

test('device setup exposes the reviewed public APIs', () => {
  for (const name of ['validateSetupRequest', 'readSetupRequest', 'setupDevice', 'setupServer']) {
    assert.equal(typeof api?.[name], 'function', `missing setup API: ${name}`);
  }
});

test('server setup CLI uses only the explicit Linux server consent and flags', async () => {
  const { main } = await import('./bin.mjs');
  assert.ok((await main(['help'])).commands.includes('setup-server'));
  const valid = ['setup-server', '--install-dir', '/missing', '--consent', 'full-account',
    '--setup-request', '/request', '--tunnel-id', 'tunnel_' + 'a'.repeat(32), '--runtime-key-file', '/key'];
  await withoutIO(async () => {
    const alias = valid.map(value => value === 'full-account' ? 'accept-install' : value);
    await assert.rejects(main(alias), codeIs('consent_required'));
    for (const args of [valid.slice(0, -2), [...valid, '--private-runtime', 'true'],
      [...valid, '--browser-managed', 'true'], [...valid, '--expected-extension-id', extensionId]]) {
      await assert.rejects(main(args), codeIs('invalid_arguments'));
    }
    if (process.platform !== 'linux') await assert.rejects(main(valid), codeIs('unsupported_platform'));
  }, { metadata: true });
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

check('Windows private-runtime profile stays inspectable from the external setup interpreter', async t => {
  if(process.platform!=='win32') {t.skip('Windows private-runtime layout only');return;}
  const f=fixture(t);
  const result=await unreadKey(f.runtimeKeyFile,()=>api.setupDevice({...f.options,privateRuntime:true},f.trusted));
  assert.deepEqual(result,expectedReceipt(f));
  const state=path.join(f.installDir,'state');
  const bindingFile=path.join(state,'binding.json');
  const binding=JSON.parse(fs.readFileSync(bindingFile,'utf8'));
  assert.equal(binding.version,2);assert.equal(binding.hostRuntime,'install-private');
  const profile=await import(pathToFileURL(path.join(f.installDir,'app','profile.mjs')).href);
  const fixedNode=path.join(f.installDir,'runtime','node.exe').replaceAll('\\','/');
  assert.notEqual(fixedNode,process.execPath.replaceAll('\\','/'));
  const document=JSON.parse(fs.readFileSync(path.join(state,'tunnel.yaml'),'utf8'));
  assert.ok(document.mcp.commands[0].command.startsWith('"'+fixedNode+'" '));
  assert.deepEqual(profile.inspectTunnelProfile(state),{configured:true,activation:'not-observed',authenticationVerified:false});
  const before=fs.readFileSync(bindingFile);
  fs.mkdirSync(path.join(f.installDir,'runtime'));
  // Inert bytes: this tests binding stability, never Node or tunnel execution.
  fs.writeFileSync(path.join(f.installDir,'runtime','node.exe'),'inert private-node fixture');
  assert.equal(profile.inspectTunnelProfile(state).configured,true);
  assert.deepEqual(fs.readFileSync(bindingFile),before);
  fs.writeFileSync(bindingFile,JSON.stringify({...binding,hostRuntime:'PATH'},null,2)+'\n');
  assert.throws(()=>profile.inspectTunnelProfile(state),/binding_changed/);
});

check('local setup creates an exact private native binding accepted by its installed consumer without starting an owner', async t => {
  const f = fixture(t), app = path.join(f.installDir, 'app'), state = path.join(f.installDir, 'state');
  const result = await unreadKey(f.runtimeKeyFile, () => api.setupDevice(f.options, f.trusted));
  assert.deepEqual(result, expectedReceipt(f));
  const file = path.join(app, 'device-native-binding.json');
  assert.equal(fs.readFileSync(file, 'utf8'), encode({ format: 'agent-continue-native-binding', version: 1,
    extensionId: f.request.extensionId, stateRoot: state }));
  const metadata = fs.lstatSync(file, { bigint: true });
  assert.equal(metadata.nlink, 1n);
  if (process.platform !== 'win32') { assert.equal(metadata.uid, BigInt(process.getuid())); assert.equal(metadata.mode & 0o077n, 0n); }
  const { readNativeBinding } = await import(pathToFileURL(path.join(app, 'device-owner.mjs')).href);
  const binding = readNativeBinding(file);
  assert.equal(binding.root, state); assert.equal(binding.extensionId, f.request.extensionId);
  assert.equal(binding.origin, 'chrome-extension://' + f.request.extensionId + '/'); binding.assertCurrent();
  for (const name of ['device-channel.json', 'device-operations.jsonl', 'device-operations.lease', 'controller.lease', 'health.url']) {
    assert.equal(fs.existsSync(path.join(state, name)), false);
  }
  assert.equal(result.nativeRegistrationVerified, false); assert.equal(result.activated, false);
});

check('configured local package reaches an explicitly started fixture owner through its own native bridge without manual binding', async t => {
  const f = fixture(t); await unreadKey(f.runtimeKeyFile, () => api.setupDevice(f.options, f.trusted));
  const app = path.join(f.installDir, 'app'), binding = path.join(app, 'device-native-binding.json');
  const { startDeviceOwner } = await import(pathToFileURL(path.join(app, 'device-owner.mjs')).href);
  let calls = 0;
  const observed = { paused: true, runtime: 'stopped', ready: false };
  const controller = { async status() { return { ...observed }; },
    async reconnect() { calls++; return { ...observed }; }, async pause() { calls++; return { ...observed }; }, async dispose() {} };
  const owner = await startDeviceOwner(binding, { controller });
  t.after(() => owner.close());
  const child = spawn(process.execPath, [path.join(app, 'device-native-host.mjs'), 'chrome-extension://' + f.request.extensionId + '/'],
    { cwd: f.root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const watchdog = setTimeout(() => child.kill(), 15000);
  t.after(async () => { clearTimeout(watchdog); if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'close'); child.kill(); await ended; } });
  const output = [], errors = []; child.stdout.on('data', bytes => output.push(bytes)); child.stderr.on('data', bytes => errors.push(bytes));
  child.stdin.on('error', () => {});
  const ended = once(child, 'close'), request = { version: 1, id: 'setup-to-native', action: 'status' };
  const bytes = Buffer.from(JSON.stringify(request)), length = Buffer.alloc(4); length.writeUInt32LE(bytes.length);
  child.stdin.write(Buffer.concat([length, bytes]));
  const [code, signal] = await ended, response = Buffer.concat(output);
  assert.equal(code, 0); assert.equal(signal, null); assert.equal(Buffer.concat(errors).length, 0);
  assert.ok(response.length >= 4); assert.equal(response.readUInt32LE(), response.length - 4);
  assert.deepEqual(JSON.parse(response.subarray(4).toString('utf8')),
    { ...request, ok: true, state: { paused: true, connection: 'disconnected' } });
  assert.equal(calls, 0); await owner.close();
  assert.equal(fs.existsSync(path.join(f.installDir, 'state', 'device-channel.json')), false);
});

check('dedicated server setup rejects local-target requests before acquisition', async t => {
  if (process.platform !== 'linux') return t.skip('requires a Linux host for the target preflight');
  const f = fixture(t);
  await unreadKey(f.runtimeKeyFile, () => assert.rejects(api.setupServer(f.options, f.trusted), codeIs('setup_target_mismatch')));
  assert.equal(fs.existsSync(f.installDir), false);
});

check('dedicated Linux setup stages an inactive runtime without Chrome binding', async t => {
  if (process.platform !== 'linux') return t.skip('requires a Linux host for genuine remote-Linux setup');
  const f = fixture(t);
  f.request = buildSetupRequest('linux-server', extensionId); f.requestBytes = serializeSetupRequest(f.request);
  fs.writeFileSync(f.setupRequestFile, f.requestBytes, { mode: 0o600 });
  const result = await unreadKey(f.runtimeKeyFile, () => api.setupServer(f.options, f.trusted));
  assert.deepEqual(result, expectedReceipt(f));
  assert.equal(fs.existsSync(path.join(f.installDir, 'app', 'device-native-binding.json')), false);
  assert.equal(fs.existsSync(path.join(f.installDir, 'state', 'device-channel.json')), false);
  assert.equal(fs.existsSync(path.join(f.installDir, 'state', 'controller.lease')), false);
});

check('existing native binding is never overwritten or accepted as a completed setup', async t => {
  const f = fixture(t), file = path.join(f.installDir, 'app', 'device-native-binding.json');
  const previous = 'existing native binding is diagnostic state\n';
  f.setNpm(`fs.writeFileSync(path.join(process.cwd(),'device-native-binding.json'),${JSON.stringify(previous)},{mode:0o600});`);
  await assert.rejects(api.setupDevice(f.options, f.trusted), codeIs('setup_configuration_failed'));
  assert.equal(fs.readFileSync(file, 'utf8'), previous); assert.equal(fs.existsSync(f.receiptFile), false);
});

check('native binding removed or replaced during final provider verification prevents setup commitment', async t => {
  for (const kind of ['removed', 'replaced']) {
    const f = fixture(t), file = path.join(f.installDir, 'app', 'device-native-binding.json');
    let changed = false;
    await withPatches([[fs, 'readFileSync', original => function(value, ...args) {
      const result = original.call(this, value, ...args);
      if (!changed && String(value) === path.join(f.installDir, 'receipt.json') && fs.existsSync(file)) {
        const before = fs.readFileSync(file); fs.renameSync(file, file + '.held');
        if (kind === 'replaced') fs.writeFileSync(file, before, { mode: 0o600 });
        changed = true;
      }
      return result;
    }]], () => assert.rejects(api.setupDevice(f.options, f.trusted), codeIs('setup_configuration_failed')));
    assert.equal(changed, true); assert.equal(fs.existsSync(f.receiptFile), false);
  }
});

check('native binding is rechecked after pending receipt creation and before final commitment', async t => {
  const f = fixture(t), file = path.join(f.installDir, 'app', 'device-native-binding.json');
  let changed = false;
  await withPatches([[fs, 'writeFileSync', original => function(value, bytes, ...args) {
    const result = original.call(this, value, bytes, ...args);
    if (isSetupReceipt(bytes) && fs.existsSync(file)) {
      const before = fs.readFileSync(file); fs.renameSync(file, file + '.held');
      fs.writeFileSync(file, before, { mode: 0o600 }); changed = true;
    }
    return result;
  }]], () => assert.rejects(api.setupDevice(f.options, f.trusted), codeIs('setup_configuration_failed')));
  assert.equal(changed, true); assert.equal(fs.existsSync(f.receiptFile), false);
});

check('native binding reader excludes a key renamed after the create-only binding write', async t => {
  const f = fixture(t), file = path.join(f.installDir, 'app', 'device-native-binding.json');
  let changed = false;
  await withPatches([[fs, 'writeFileSync', original => function(value, ...args) {
    const result = original.call(this, value, ...args);
    if (String(value) === file && !changed) {
      fs.unlinkSync(file); fs.renameSync(f.runtimeKeyFile, file); changed = true;
    }
    return result;
  }]], () => unreadKey(f.runtimeKeyFile, () => assert.rejects(api.setupDevice(f.options, f.trusted), codeIs('setup_configuration_failed'))));
  assert.equal(changed, true); assert.equal(fs.existsSync(f.receiptFile), false);
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
