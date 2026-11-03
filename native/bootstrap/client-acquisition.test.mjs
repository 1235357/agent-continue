import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import zlib, { deflateRawSync } from 'node:zlib';
import { Worker } from 'node:worker_threads';
import { RUNTIME_FILES } from './payload-layout.mjs';

const library = new URL('./client-acquisition.mjs', import.meta.url);
const api = fs.existsSync(library) ? await import(library) : null;
const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.resolve(here, '../desktop-commander');
const encode = value => JSON.stringify(value) + '\n';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const MiB = 1024 * 1024;
const platforms = {
  'win32-x64': 'windows-amd64', 'win32-arm64': 'windows-arm64',
  'linux-x64': 'linux-amd64', 'linux-arm64': 'linux-arm64',
  'darwin-x64': 'darwin-amd64', 'darwin-arm64': 'darwin-arm64',
};
const providerReceipt = { format: 'agent-continue-acquisition', version: 1, status: 'staged',
  providerVersion: '0.3.1', configured: false, activated: false,
  protectedInstallationVerified: false, nativeDependenciesVerified: false };
let sandbox;
const tempRoot = fs.realpathSync(os.tmpdir());

// Copy genuine local dependency bytes, never stand-in unzipper code or executables.
before(() => {
  sandbox = fs.mkdtempSync(path.join(tempRoot, 'agent-client-test-'));
  const sourceModules = path.join(runtime, 'node_modules'), copied = new Set();
  function copyDependency(requireFrom, name) {
    const metaFile = requireFrom.resolve(name + '/package.json');
    const source = path.dirname(metaFile);
    if (copied.has(source)) return;
    copied.add(source);
    const relative = path.relative(sourceModules, source);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.cpSync(source, path.join(sandbox, 'node_modules', relative), {
      recursive: true, filter: file => file === source || !path.relative(source, file).split(path.sep).includes('node_modules'),
    });
    const meta = JSON.parse(fs.readFileSync(metaFile));
    const requireNext = createRequire(metaFile);
    for (const dependency of Object.keys(meta.dependencies || {})) copyDependency(requireNext, dependency);
  }
  if (api) copyDependency(createRequire(path.join(runtime, 'package.json')), 'unzipper');
});
after(() => {
  if (!sandbox) return;
  assert.equal(path.dirname(path.resolve(sandbox)), tempRoot);
  assert.match(path.basename(sandbox), /^agent-client-test-/);
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test('client acquisition exposes acquisition and consented preflight APIs', () => {
  assert.equal(typeof api?.acquireClient, 'function');
  assert.equal(typeof api?.validateClientInput, 'function');
});
const check = (name, run) => test(name, { skip: !api }, run);
const codeIs = code => error => {
  assert.equal(error.constructor, Error);
  assert.equal(error.message, code);
  assert.equal(error.cause, undefined);
  assert.deepEqual(Object.keys(error), []);
  return true;
};

function entriesFor(platform = 'linux-x64') {
  const base = 'tunnel-client-runtime-v0.0.19-' + platforms[platform];
  return [
    { name: platform.startsWith('win32-') ? 'tunnel-client-runtime.exe' : 'tunnel-client-runtime', data: Buffer.from('fixture bytes, never executed\n') },
    { name: 'LICENSE', data: Buffer.from('fixture license\n') },
    { name: 'NOTICE', data: Buffer.from('fixture notice\n') },
    { name: base + '-licenses.txt', data: Buffer.from('fixture licenses\n') },
    { name: base + '.spdx.json', data: Buffer.from('{"fixture":true}\n') },
  ];
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// A ZIP fixture writer, not an extraction/parser implementation.
function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), data = entry.data;
    const method = entry.method ?? 0;
    const compressed = entry.compressed || (method === 8 ? deflateRawSync(data) : data);
    const header = Buffer.alloc(30), directory = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4); header.writeUInt16LE(entry.flags ?? 0, 6);
    header.writeUInt16LE(method, 8); header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(entry.size ?? data.length, 22);
    header.writeUInt16LE(name.length, 26);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(0x0314, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(entry.flags ?? 0, 8); directory.writeUInt16LE(method, 10);
    directory.writeUInt32LE(crc32(data), 16); directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(entry.size ?? data.length, 24); directory.writeUInt16LE(name.length, 28);
    directory.writeUInt16LE(entry.disk ?? 0, 34);
    directory.writeUInt32LE(entry.attributes ?? ((0o100600 << 16) >>> 0), 38);
    directory.writeUInt32LE(offset, 42);
    local.push(header, name, compressed); central.push(directory, name);
    offset += header.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function fixture({ platform = 'linux-x64', entries = entriesFor(platform), bytes = zip(entries), pinChange } = {}) {
  const root = fs.mkdtempSync(path.join(sandbox, 'case-'));
  const packageRoot = path.join(root, 'package'), installDir = path.join(root, 'install');
  const payload = path.join(packageRoot, 'payload'), app = path.join(installDir, 'app');
  fs.mkdirSync(payload, { recursive: true }); fs.mkdirSync(app, { recursive: true });
  for (const name of RUNTIME_FILES) fs.copyFileSync(path.join(runtime, name), path.join(payload, name));
  const upstream = JSON.parse(fs.readFileSync(path.join(payload, 'upstream-pin.json')));
  fs.writeFileSync(path.join(payload, 'runtime.mjs'),
    `export function verifyUpstream() { return {version:"0.3.1",verifiedFiles:${upstream.files}}; }\n`);
  const pin = { asset: 'tunnel-client-runtime-v0.0.19-' + platforms[platform] + '.zip',
    archiveSha256: hash(bytes), executableSha256: hash(entries[0].data), spdxSha256: hash(entries.at(-1).data) };
  if (pinChange) pinChange(pin);
  const pins = { release: 'v0.0.19', source: 'https://github.com/openai/tunnel-client/releases/tag/v0.0.19', platforms: { [platform]: pin } };
  fs.writeFileSync(path.join(payload, 'tunnel-pins.json'), encode(pins));
  const manifest = { format: 'agent-continue-payload', version: 1,
    provider: { name: '@wonderwhy-er/desktop-commander', version: '0.3.1' },
    files: RUNTIME_FILES.map(name => {
      const content = fs.readFileSync(path.join(payload, name));
      return { path: name, bytes: content.length, sha256: hash(content) };
    }) };
  fs.writeFileSync(path.join(packageRoot, 'payload-manifest.json'), encode(manifest));
  for (const name of RUNTIME_FILES) fs.copyFileSync(path.join(payload, name), path.join(app, name));
  fs.mkdirSync(path.join(app, 'node_modules'));
  fs.cpSync(path.join(sandbox, 'node_modules', 'unzipper'), path.join(app, 'node_modules', 'unzipper'), { recursive: true });
  fs.writeFileSync(path.join(installDir, 'receipt.json'), encode(providerReceipt));
  const offlineArchive = path.join(root, 'input.zip');
  fs.writeFileSync(offlineArchive, bytes);
  const options = { installDir, consent: 'full-account', offlineArchive };
  const trusted = { packageRoot, platform };
  return { root, packageRoot, installDir, app, offlineArchive, bytes, entries, pin, options, trusted,
    client: path.join(installDir, 'client'), receipt: path.join(installDir, 'client', 'receipt.json') };
}

function unchangedProvider(f) {
  assert.equal(fs.readFileSync(path.join(f.installDir, 'receipt.json'), 'utf8'), encode(providerReceipt));
  assert.equal(fs.existsSync(f.receipt), false);
}
function patch(t, object, key, replacement) {
  const previous = object[key];
  object[key] = replacement(previous);
  t.after(() => { object[key] = previous; });
}
function online(f, fetchImpl) {
  const options = { ...f.options }; delete options.offlineArchive;
  return api.acquireClient(options, { ...f.trusted, fetchImpl });
}

check('import and missing consent have no read/write/network effects', async t => {
  let effects = 0;
  for (const key of ['readFileSync', 'lstatSync', 'mkdirSync', 'writeFileSync']) {
    patch(t, fs, key, original => function(file, ...args) {
      if (key === 'readFileSync' && (file instanceof URL ? fileURLToPath(file) : String(file)) === fileURLToPath(library)) {
        return original.call(this, file, ...args);
      }
      effects++; throw new Error('unexpected_effect');
    });
  }
  patch(t, globalThis, 'fetch', () => () => { effects++; throw new Error('unexpected_network'); });
  await import(library.href + '?no-effects');
  for (const options of [undefined, null, {}, [], { consent: 'acquire-provider', secret: 'do-not-echo' }]) {
    assert.throws(() => api.validateClientInput(options), codeIs('consent_required'));
    await assert.rejects(api.acquireClient(options), codeIs('consent_required'));
  }
  assert.equal(effects, 0);
});

check('preflight normalizes inputs without requiring a provider or mutating the filesystem', t => {
  const f = fixture(); fs.rmSync(f.installDir, { recursive: true });
  patch(t, fs, 'mkdirSync', () => () => assert.fail('preflight mkdir'));
  patch(t, fs, 'writeFileSync', () => () => assert.fail('preflight write'));
  const result = api.validateClientInput({ ...f.options, installDir: path.join(f.root, 'x', '..', 'install') }, f.trusted);
  assert.deepEqual(result, { installDir: f.installDir, offlineArchive: f.offlineArchive, platform: 'linux-x64', pin: f.pin });
  assert.equal(fs.existsSync(f.installDir), false);
});

check('preflight rejects physical case-alias ancestry without relying on realpath spelling', t => {
  const f = fixture();
  const aliasRoot = path.join(path.dirname(f.root), path.basename(f.root).toUpperCase());
  if (!fs.existsSync(aliasRoot)) return t.skip('fixture filesystem is case-sensitive');
  const identity = file => { const info = fs.lstatSync(file, { bigint: true }); return [info.dev, info.ino]; };
  assert.deepEqual(identity(aliasRoot), identity(f.root));
  // Some filesystems retain the caller's case even in their realpath result.
  patch(t, fs, 'realpathSync', () => file => path.resolve(file));
  const installDir = path.join(aliasRoot, 'not-created');
  assert.deepEqual(identity(path.dirname(api.validateClientInput({ ...f.options, installDir }, f.trusted).installDir)), identity(f.root));
  assert.throws(() => api.validateClientInput({ ...f.options, installDir: path.join(aliasRoot, 'PACKAGE', 'nested') }, f.trusted),
    codeIs('client_input_invalid'));
  fs.mkdirSync(f.client);
  fs.copyFileSync(f.offlineArchive, path.join(f.client, 'input.zip'));
  assert.throws(() => api.validateClientInput({ ...f.options, offlineArchive: path.join(aliasRoot, 'INSTALL', 'CLIENT', 'input.zip') }, f.trusted),
    codeIs('client_input_invalid'));
});

check('option, trusted-composition, signal and local-path validation is closed', async () => {
  const f = fixture();
  for (const options of [
    { ...f.options, url: 'https://example.invalid/private' }, { ...f.options, platform: 'linux-x64' },
    { ...f.options, installDir: 'relative' }, { ...f.options, installDir: '//host/share' },
    { ...f.options, installDir: f.root + '\0hidden' }, { ...f.options, signal: {} },
    { ...f.options, offlineArchive: 'relative.zip' }, { ...f.options, offlineArchive: f.root },
    { ...f.options, offlineArchive: path.join(f.root, 'missing.zip') },
    { ...f.options, offlineArchive: path.join(f.client, 'release.zip') },
  ]) await assert.rejects(api.acquireClient(options, f.trusted), codeIs('client_input_invalid'));
  for (const trusted of [null, [], { ...f.trusted, headers: {} }, { ...f.trusted, fetchImpl: 42 }, { ...f.trusted, packageRoot: 'relative' }]) {
    assert.throws(() => api.validateClientInput(f.options, trusted), codeIs('client_input_invalid'));
  }
  assert.equal(fs.existsSync(f.client), false);
});

check('unsupported platforms and malformed or nonprimary pins fail before acquisition', async () => {
  const f = fixture();
  for (const platform of ['freebsd-x64', 'linux-ia32', '', 'LINUX-X64', 42]) {
    await assert.rejects(api.acquireClient(f.options, { ...f.trusted, platform }), codeIs('unsupported_tunnel_platform'));
  }
  const pinsFile = path.join(f.packageRoot, 'payload', 'tunnel-pins.json');
  const original = fs.readFileSync(pinsFile);
  for (const change of [
    pins => { pins.platforms = {}; }, pins => { pins.release = 'latest'; },
    pins => { pins.source = 'https://example.invalid'; },
    pins => { pins.platforms['linux-x64'].asset = 'tunnel-client-v0.0.19-linux-amd64.zip'; },
    pins => { pins.platforms['linux-x64'].archiveSha256 = 'A'.repeat(64); },
    pins => { delete pins.platforms['linux-x64'].spdxSha256; },
  ]) {
    const pins = JSON.parse(original); change(pins); fs.writeFileSync(pinsFile, encode(pins));
    await assert.rejects(api.acquireClient(f.options, f.trusted), codeIs('unsupported_tunnel_platform'));
  }
  assert.equal(fs.existsSync(f.client), false);
});

check('offline archive rejects links, redirected parents and oversized regular files', async () => {
  const f = fixture(), hardlink = path.join(f.root, 'hard.zip');
  fs.linkSync(f.offlineArchive, hardlink);
  await assert.rejects(api.acquireClient(f.options, f.trusted), codeIs('client_input_invalid'));
  fs.unlinkSync(hardlink);
  const target = path.join(f.root, 'target'); fs.mkdirSync(target);
  fs.copyFileSync(f.offlineArchive, path.join(target, 'input.zip'));
  const redirected = path.join(f.root, 'redirected');
  fs.symlinkSync(target, redirected, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(api.acquireClient({ ...f.options, offlineArchive: path.join(redirected, 'input.zip') }, f.trusted), codeIs('client_input_invalid'));
  await assert.rejects(api.acquireClient({ ...f.options, installDir: path.join(redirected, 'install') }, f.trusted), codeIs('client_input_invalid'));
  fs.truncateSync(f.offlineArchive, 64 * MiB + 1);
  await assert.rejects(api.acquireClient(f.options, f.trusted), codeIs('client_input_invalid'));
  assert.equal(fs.existsSync(f.client), false);
});

check('missing, partial or changed provider stages never claim a client directory', async () => {
  for (const change of [
    f => fs.unlinkSync(path.join(f.installDir, 'receipt.json')),
    f => fs.appendFileSync(path.join(f.installDir, 'receipt.json'), ' '),
    f => fs.appendFileSync(path.join(f.app, 'host.mjs'), 'changed'),
    f => fs.appendFileSync(path.join(f.packageRoot, 'payload', 'host.mjs'), 'changed'),
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(api.acquireClient(f.options, f.trusted), codeIs('provider_stage_invalid'));
    assert.equal(fs.existsSync(f.client), false);
  }
});

check('existing client directories and partial files are never repaired or overwritten', async () => {
  for (const directory of [true, false]) {
    const f = fixture();
    if (directory) { fs.mkdirSync(f.client); fs.writeFileSync(path.join(f.client, 'marker'), 'retain'); }
    else fs.writeFileSync(f.client, 'retain');
    await assert.rejects(api.acquireClient(f.options, f.trusted), codeIs('client_exists'));
    assert.equal(fs.readFileSync(directory ? path.join(f.client, 'marker') : f.client, 'utf8'), 'retain');
    unchangedProvider(f);
  }
});

for (const platform of Object.keys(platforms)) check('synthetic offline receipt and retained bytes: ' + platform, async () => {
  const entries = entriesFor(platform).map((entry, index) => ({ ...entry, method: index % 2 ? 8 : 0, attributes: index % 2 ? 0 : ((0o100600 << 16) >>> 0) }));
  const f = fixture({ platform, entries });
  const source = hash(fs.readFileSync(path.join(f.packageRoot, 'payload-manifest.json')));
  const receipt = await api.acquireClient(f.options, f.trusted);
  assert.deepEqual(receipt, { format: 'agent-continue-device-acquisition', version: 1, status: 'acquired',
    providerVersion: '0.3.1', tunnelRelease: 'v0.0.19', platform, executableSha256: f.pin.executableSha256,
    configured: false, activated: false, protectedInstallationVerified: false, nativeDependenciesVerified: false });
  assert.equal(fs.readFileSync(f.receipt, 'utf8'), encode(receipt));
  assert.deepEqual(fs.readdirSync(f.client).sort(), [...entries.map(entry => entry.name), 'receipt.json', 'release.zip'].sort());
  assert.deepEqual(fs.readFileSync(path.join(f.client, 'release.zip')), f.bytes);
  for (const entry of entries) assert.deepEqual(fs.readFileSync(path.join(f.client, entry.name)), entry.data);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(f.client, entries[0].name)).mode & 0o777, 0o700);
  assert.equal(hash(fs.readFileSync(path.join(f.packageRoot, 'payload-manifest.json'))), source);
  assert.equal(fs.readFileSync(path.join(f.installDir, 'receipt.json'), 'utf8'), encode(providerReceipt));
});

check('archive, executable and SPDX hashes use the primary pin only', async () => {
  for (const name of ['archiveSha256', 'executableSha256', 'spdxSha256']) {
    const f = fixture({ pinChange: pin => { pin[name] = '0'.repeat(64); pin.compatibleExecutableSha256 = [hash(entriesFor()[0].data)]; } });
    await assert.rejects(api.acquireClient(f.options, f.trusted), codeIs('client_verification_failed'));
    assert.ok(fs.existsSync(path.join(f.client, 'release.zip'))); unchangedProvider(f);
  }
});

const unsafeEntries = {
  missing: entries => entries.pop(), extra: entries => entries.push({ name: 'extra', data: Buffer.from('x') }),
  duplicate: entries => { entries[1].name = entries[0].name; },
  traversal: entries => { entries[1].name = '../LICENSE'; },
  backslash: entries => { entries[1].name = '..\\LICENSE'; },
  case: entries => { entries[1].name = 'license'; },
  nul: entries => { entries[1].name = 'LICENSE\0'; },
  unicode: entries => { entries[1].name = 'L\u0130CENSE'; },
  directory: entries => { entries[1].name = 'LICENSE/'; entries[1].data = Buffer.alloc(0); },
  symlink: entries => { entries[1].attributes = (0o120777 << 16) >>> 0; },
  fifo: entries => { entries[1].attributes = (0o010600 << 16) >>> 0; },
  'dos-directory': entries => { entries[1].attributes = 0x10; },
  'dos-device': entries => { entries[1].attributes = 0x40; },
  encrypted: entries => { entries[1].flags = 1; },
  method: entries => { entries[1].method = 12; },
  disk: entries => { entries[1].disk = 1; },
  zero: entries => { entries[1].size = 0; },
  'large-document': entries => { entries[1].size = 2 * MiB + 1; },
  'large-executable': entries => { entries[0].size = 128 * MiB + 1; },
};
for (const [name, mutate] of Object.entries(unsafeEntries)) check('rejects unsafe ZIP metadata: ' + name, async () => {
  const entries = entriesFor(); mutate(entries);
  const f = fixture({ entries });
  await assert.rejects(api.acquireClient(f.options, f.trusted), codeIs('client_archive_invalid'));
  unchangedProvider(f);
});

check('unrelated workers and nonclosed extraction tasks only import the library', async () => {
  const f = fixture();
  for (const workerData of [
    { task: 'unrelated' },
    { task: 'agent-continue-client-extraction-v1', archive: Uint8Array.from(f.bytes).buffer,
      client: f.client, platform: 'linux-x64', pin: f.pin, installDir: f.installDir, extra: true },
  ]) {
    const worker = new Worker(library, { workerData, env: {}, execArgv: [], stdout: true, stderr: true, trackUnmanagedFds: true });
    worker.stdout.resume(); worker.stderr.resume();
    const messages = [];
    worker.on('message', message => messages.push(message));
    try {
      const code = await new Promise((resolve, reject) => { worker.once('exit', resolve); worker.once('error', reject); });
      assert.equal(code, 0); assert.equal(worker.threadId, -1); assert.deepEqual(messages, []);
      assert.equal(fs.existsSync(f.client), false);
    } finally { await worker.terminate(); }
  }
});

check('malformed ZIP data is bounded and never publishes success', async () => {
  for (const bytes of [Buffer.from('not a zip'), zip(entriesFor()).subarray(0, 90)]) {
    const f = fixture({ bytes });
    await assert.rejects(api.acquireClient(f.options, f.trusted), codeIs('client_archive_invalid'));
    unchangedProvider(f);
  }
});

check('actual entry lengths are counted rather than trusting metadata', async () => {
  for (const size of [1, 100]) {
    const entries = entriesFor(); entries[1].size = size;
    const f = fixture({ entries });
    await assert.rejects(api.acquireClient(f.options, f.trusted), codeIs('client_verification_failed'));
    unchangedProvider(f);
  }
  const entries = entriesFor(); entries[1] = { ...entries[1], data: Buffer.alloc(2 * MiB + 1, 120), size: 10, method: 8 };
  const f = fixture({ entries });
  await assert.rejects(api.acquireClient(f.options, f.trusted), codeIs('client_verification_failed'));
  unchangedProvider(f);
});

check('unzipper is checked at the staged nonredirected pinned package location', async () => {
  const f = fixture(), meta = path.join(f.app, 'node_modules', 'unzipper', 'package.json');
  const value = JSON.parse(fs.readFileSync(meta)); value.version = '0.0.0'; fs.writeFileSync(meta, encode(value));
  await assert.rejects(api.acquireClient(f.options, f.trusted), codeIs('client_acquisition_failed'));
  unchangedProvider(f);
  const g = fixture(), libraryPath = path.join(g.app, 'node_modules', 'unzipper');
  fs.rmSync(libraryPath, { recursive: true });
  fs.symlinkSync(path.join(sandbox, 'node_modules', 'unzipper'), libraryPath, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(api.acquireClient(g.options, g.trusted), codeIs('client_acquisition_failed'));
  unchangedProvider(g);
});

check('online requests use only pinned HTTPS URLs with no inherited headers or credentials', async () => {
  const f = fixture(), calls = [];
  const target = 'https://release-assets.githubusercontent.com/owned/asset?signature=private';
  const receipt = await online(f, async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: target } }) : new Response(f.bytes);
  });
  assert.equal(receipt.status, 'acquired'); assert.equal(calls.length, 2);
  assert.equal(String(calls[0].url), 'https://github.com/openai/tunnel-client/releases/download/v0.0.19/' + f.pin.asset);
  assert.equal(String(calls[1].url), target);
  for (const { options } of calls) {
    assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
    assert.equal(options.method ?? 'GET', 'GET');
    assert.equal(Array.from(new Headers(options.headers)).length, 0);
    assert.ok(options.signal instanceof AbortSignal);
  }
});

check('redirects are restricted before following them and discarded bodies are cancelled', async () => {
  for (const location of ['http://github.com/a', 'https://evil.invalid/a', 'https://github.com/other',
    'https://release-assets.githubusercontent.com:444/a', 'https://user:secret@objects.githubusercontent.com/a',
    'https://github.com/openai/tunnel-client/releases/download/latest/asset.zip']) {
    const f = fixture(); let calls = 0, cancelled = 0;
    await assert.rejects(online(f, async () => {
      calls++;
      return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 302, headers: { location } });
    }), codeIs('client_acquisition_failed'));
    assert.equal(calls, 1); assert.equal(cancelled, 1); unchangedProvider(f);
  }
});

check('online failures, redirect budgets and body limits do not retry or leak bodies', async () => {
  for (const status of [201, 204, 304, 401, 404, 500]) {
    const f = fixture(); let calls = 0;
    await assert.rejects(online(f, async () => { calls++; return new Response(null, { status }); }), codeIs('client_acquisition_failed'));
    assert.equal(calls, 1); unchangedProvider(f);
  }
  const f = fixture(); let calls = 0;
  await assert.rejects(online(f, async () => {
    calls++; return new Response(null, { status: 307, headers: { location: 'https://objects.githubusercontent.com/loop' } });
  }), codeIs('client_acquisition_failed'));
  assert.equal(calls, 4); unchangedProvider(f);
  const g = fixture(); let cancelled = 0;
  await assert.rejects(online(g, async () => new Response(new ReadableStream({ cancel() { cancelled++; } }),
    { headers: { 'content-length': String(64 * MiB + 1) } })), codeIs('client_acquisition_failed'));
  assert.equal(cancelled, 1); unchangedProvider(g);
  const h = fixture(); let produced = 0, stopped = false;
  await assert.rejects(online(h, async () => new Response(new ReadableStream({
    pull(controller) { produced++; controller.enqueue(new Uint8Array(MiB)); }, cancel() { stopped = true; },
  }))), codeIs('client_acquisition_failed'));
  assert.ok(produced >= 65 && produced <= 67); assert.equal(stopped, true); unchangedProvider(h);
});

check('caller cancellation before acquisition and during fetch cancels and settles the reader', async () => {
  const f = fixture(), before = new AbortController(); before.abort('private reason');
  await assert.rejects(api.acquireClient({ ...f.options, signal: before.signal }, f.trusted), codeIs('client_acquisition_failed'));
  assert.equal(fs.existsSync(f.client), false);
  const g = fixture(), controller = new AbortController(); let cancelled = false;
  const options = { installDir: g.installDir, consent: 'full-account', signal: controller.signal };
  await assert.rejects(api.acquireClient(options, { ...g.trusted, fetchImpl: async (_url, init) => {
    assert.notEqual(init.signal, controller.signal);
    return new Response(new ReadableStream({
      start(stream) { stream.enqueue(new Uint8Array([80, 75])); setImmediate(() => controller.abort()); },
      async cancel() { await new Promise(resolve => setImmediate(resolve)); cancelled = true; },
    }));
  } }), codeIs('client_acquisition_failed'));
  assert.equal(cancelled, true); unchangedProvider(g);
});

check('one 60-second deadline aborts a pending fetch without waiting in real time', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let budget;
  patch(t, globalThis, 'setTimeout', original => (callback, milliseconds, ...args) => {
    if (milliseconds > 59000 && milliseconds <= 60000) budget = milliseconds;
    return original(callback, milliseconds, ...args);
  });
  const f = fixture(); let signal, started;
  const ready = new Promise(resolve => { started = resolve; });
  const pending = online(f, (_url, init) => new Promise((_resolve, reject) => {
    signal = init.signal;
    signal.addEventListener('abort', () => reject(new Error('private fetch error')), { once: true });
    started();
  }));
  const rejected = assert.rejects(pending, codeIs('client_acquisition_failed'));
  await ready; assert.ok(budget > 59000 && budget <= 60000);
  t.mock.timers.tick(Math.ceil(budget) - 1); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); await rejected;
  assert.equal(signal.aborted, true); unchangedProvider(f);
});

check('an abort-aware pending fetch settles its delayed cleanup before rejection', async () => {
  const f = fixture(), controller = new AbortController();
  let started, release, settled = false, cleaned = false;
  const ready = new Promise(resolve => { started = resolve; });
  const pending = api.acquireClient({ installDir: f.installDir, consent: 'full-account', signal: controller.signal },
    { ...f.trusted, fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        release = () => { cleaned = true; reject(new Error('private transport cancellation')); };
      }, { once: true });
      started();
    }) });
  const rejected = assert.rejects(pending, codeIs('client_acquisition_failed')).then(() => { settled = true; });
  await ready; controller.abort();
  await new Promise(resolve => setImmediate(resolve));
  const returnedEarly = settled;
  assert.equal(typeof release, 'function'); release();
  await rejected;
  assert.equal(returnedEarly, false); assert.equal(cleaned, true); unchangedProvider(f);
});

check('a response arriving after abort is cancelled and settled before rejection', async () => {
  const f = fixture(), controller = new AbortController();
  let started, respond, finishCancel, settled = false;
  const ready = new Promise(resolve => { started = resolve; });
  const pending = api.acquireClient({ installDir: f.installDir, consent: 'full-account', signal: controller.signal },
    { ...f.trusted, fetchImpl: () => new Promise(resolve => {
      respond = () => resolve(new Response(new ReadableStream({
        cancel() { return new Promise(done => { finishCancel = done; }); },
      })));
      started();
    }) });
  const rejected = assert.rejects(pending, codeIs('client_acquisition_failed')).then(() => { settled = true; });
  await ready; controller.abort(); respond();
  await new Promise(resolve => setImmediate(resolve));
  const returnedEarly = settled;
  assert.equal(typeof finishCancel, 'function'); finishCancel();
  await rejected;
  assert.equal(returnedEarly, false); unchangedProvider(f);
});

check('a destination setup failure settles the already-owned response reader', async t => {
  const f = fixture(); let finishCancel, settled = false;
  patch(t, fs, 'createWriteStream', original => function(file, ...args) {
    if (String(file) === path.join(f.client, 'release.zip')) throw new Error('private write setup error');
    return original.call(this, file, ...args);
  });
  const pending = online(f, async () => new Response(new ReadableStream({
    cancel() { return new Promise(resolve => { finishCancel = resolve; }); },
  })));
  const rejected = assert.rejects(pending, codeIs('client_acquisition_failed')).then(() => { settled = true; });
  // Provider verification imports the isolated own runtime before requesting the body.
  for (let turn = 0; !finishCancel && turn < 100; turn++) await new Promise(resolve => setImmediate(resolve));
  const returnedEarly = settled;
  assert.equal(typeof finishCancel, 'function'); finishCancel();
  await rejected;
  assert.equal(returnedEarly, false); unchangedProvider(f);
});

check('worker startup cancellation waits for confirmed exit without publishing a receipt', async t => {
  const f = fixture(), controller = new AbortController();
  let worker, exited = false;
  patch(t, Worker.prototype, 'emit', original => function(event, ...args) {
    if (event === 'online') { worker = this; controller.abort(); }
    if (event === 'exit' && this === worker) exited = true;
    return original.call(this, event, ...args);
  });
  await assert.rejects(api.acquireClient({ ...f.options, signal: controller.signal }, f.trusted), codeIs('client_acquisition_failed'));
  assert.ok(worker); assert.equal(exited, true); assert.equal(worker.threadId, -1);
  unchangedProvider(f);
});

check('real deflate cancellation settles the upstream inflater or its owning worker before rejection', async t => {
  const entries = entriesFor();
  entries[0] = { ...entries[0], method: 8, data: Buffer.alloc(8 * MiB, 120) };
  const f = fixture({ entries }), controller = new AbortController();
  let inflater, worker, exited = false, phases = 0;
  // Observe the genuine old in-process inflater as well as the replacement worker.
  const descriptor = Object.getOwnPropertyDescriptor(zlib, 'createInflateRaw');
  Object.defineProperty(zlib, 'createInflateRaw', { ...descriptor, value: function(...args) {
    inflater = descriptor.value.apply(this, args);
    inflater.once('data', () => controller.abort());
    return inflater;
  } });
  t.after(async () => {
    Object.defineProperty(zlib, 'createInflateRaw', descriptor);
    if (inflater && !inflater.closed) {
      await new Promise(resolve => { inflater.once('close', resolve); inflater.destroy(); });
    }
  });
  patch(t, Worker.prototype, 'emit', original => function(event, ...args) {
    if (event === 'message' && args[0]?.phase === 'extracting') {
      worker = this; phases++; controller.abort();
    }
    if (event === 'exit' && this === worker) exited = true;
    return original.call(this, event, ...args);
  });
  await assert.rejects(api.acquireClient({ ...f.options, signal: controller.signal }, f.trusted), codeIs('client_acquisition_failed'));
  if (inflater) assert.equal(inflater.closed, true, 'real upstream zlib resource survives the cancelled API');
  assert.ok(worker); assert.equal(phases, 1); assert.equal(exited, true); assert.equal(worker.threadId, -1);
  unchangedProvider(f);
});

check('real extraction failure waits for worker exit and preserves the fixed error', async t => {
  const entries = entriesFor();
  entries[0] = { ...entries[0], method: 8, data: Buffer.alloc(2 * MiB, 120), size: 1 };
  const f = fixture({ entries });
  let worker, exited = false;
  patch(t, Worker.prototype, 'emit', original => function(event, ...args) {
    if (event === 'online') worker = this;
    if (event === 'exit' && this === worker) exited = true;
    return original.call(this, event, ...args);
  });
  await assert.rejects(api.acquireClient(f.options, f.trusted), codeIs('client_verification_failed'));
  assert.ok(worker); assert.equal(exited, true); assert.equal(worker.threadId, -1);
  unchangedProvider(f);
});

check('provider source changes during client acquisition prevent publication', async () => {
  for (const destination of ['app', 'package']) {
    const f = fixture();
    await assert.rejects(online(f, async () => {
      fs.appendFileSync(path.join(destination === 'app' ? f.app : path.join(f.packageRoot, 'payload'), 'host.mjs'), 'changed');
      return new Response(f.bytes);
    }), codeIs('provider_stage_invalid'));
    unchangedProvider(f);
  }
});

check('precommit abort removes pending receipt but retains the owned partial client', async t => {
  const f = fixture(), controller = new AbortController();
  patch(t, fs, 'writeFileSync', original => function(file, ...args) {
    const result = original.call(this, file, ...args);
    if (String(file).startsWith(path.join(f.client, 'receipt.pending.'))) controller.abort();
    return result;
  });
  await assert.rejects(api.acquireClient({ ...f.options, signal: controller.signal }, f.trusted), codeIs('client_acquisition_failed'));
  assert.ok(fs.existsSync(path.join(f.client, 'release.zip')));
  assert.equal(fs.readdirSync(f.client).some(name => name.startsWith('receipt.pending.')), false);
  unchangedProvider(f);
});

check('postcommit cancellation and pending cleanup failure cannot undo success', async t => {
  const f = fixture(), controller = new AbortController();
  patch(t, fs, 'linkSync', original => function(source, target) {
    const result = original.call(this, source, target);
    if (target === f.receipt) controller.abort();
    return result;
  });
  patch(t, fs, 'unlinkSync', original => function(file) {
    if (String(file).startsWith(path.join(f.client, 'receipt.pending.'))) throw new Error('private cleanup error');
    return original.call(this, file);
  });
  const receipt = await api.acquireClient({ ...f.options, signal: controller.signal }, f.trusted);
  assert.equal(receipt.status, 'acquired'); assert.equal(fs.readFileSync(f.receipt, 'utf8'), encode(receipt));
  assert.equal(fs.statSync(f.receipt).nlink, 2);
});

check('a throwing caller-listener cleanup cannot turn committed success into failure', async t => {
  const f = fixture(), controller = new AbortController();
  patch(t, controller.signal, 'removeEventListener', () => () => { throw new Error('private listener cleanup error'); });
  const receipt = await api.acquireClient({ ...f.options, signal: controller.signal }, f.trusted);
  assert.equal(receipt.status, 'acquired');
  assert.equal(fs.readFileSync(f.receipt, 'utf8'), encode(receipt));
});

check('pending-write and create-only link failures are sanitized receipt failures', async t => {
  for (const key of ['writeFileSync', 'linkSync']) {
    const f = fixture(), original = fs[key];
    fs[key] = function(file, ...args) {
      if (String(file).startsWith(path.join(f.client, 'receipt.pending.'))) throw new Error('secret path and URL');
      return original.call(this, file, ...args);
    };
    try { await assert.rejects(api.acquireClient(f.options, f.trusted), codeIs('client_receipt_failed')); }
    finally { fs[key] = original; }
    unchangedProvider(f);
    assert.equal(fs.readdirSync(f.client).some(name => name.startsWith('receipt.pending.')), false);
  }
});

check('a raced existing receipt remains byte-for-byte unchanged', async t => {
  const f = fixture();
  patch(t, fs, 'linkSync', original => function(source, target) {
    if (target === f.receipt) fs.writeFileSync(target, 'another owner\n', { flag: 'wx' });
    return original.call(this, source, target);
  });
  await assert.rejects(api.acquireClient(f.options, f.trusted), codeIs('client_receipt_failed'));
  assert.equal(fs.readFileSync(f.receipt, 'utf8'), 'another owner\n');
});

check('generic fetch and owned-file failures expose only fixed codes', async t => {
  const f = fixture();
  await assert.rejects(online(f, () => { throw new Error('https://private.invalid/?token=secret'); }), codeIs('client_acquisition_failed'));
  unchangedProvider(f);
  const g = fixture();
  patch(t, fs, 'createWriteStream', original => function(file, ...args) {
    if (String(file) === path.join(g.client, 'release.zip')) throw new Error('private I/O error');
    return original.call(this, file, ...args);
  });
  await assert.rejects(online(g, async () => new Response(g.bytes)), codeIs('client_acquisition_failed'));
  unchangedProvider(g);
});
