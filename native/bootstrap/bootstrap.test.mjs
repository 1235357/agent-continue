import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import childProcess from 'node:child_process';
import crypto from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const library = new URL('./bootstrap.mjs', import.meta.url);
const builderFile = new URL('./build-package.mjs', import.meta.url);
const api = fs.existsSync(library) ? await import(library) : null;
const builder = fs.existsSync(builderFile) ? await import(builderFile) : null;
test('zero-dependency acquisition API and package builder exist', () => { assert.ok(api); assert.ok(builder); });
const check = (name, run) => test(name, { skip: !api || !builder }, run);

function fixture(t) {
  const temporary = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporary, 'agent-bootstrap-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), temporary);
    assert.match(path.basename(root), /^agent-bootstrap-test-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const packaged = path.join(root, 'package');
  builder.buildPackage(packaged);
  return { root, packaged, installDir: path.join(root, 'install') };
}

function fakeNpm(root, body) {
  const directory = path.join(root, 'fake-npm');
  fs.mkdirSync(path.join(directory, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'npm', version: '11.0.0' }));
  const script = path.join(directory, 'bin', 'npm-cli.js');
  fs.writeFileSync(script, body);
  return script;
}

const composition = (packaged, npmCli) => ({ packageRoot: packaged, ...(npmCli ? { npmCli } : {}) });

function assertRuntimeImportClosure(payload) {
  const names = fs.readdirSync(payload);
  let protectedImports = 0;
  for (const name of names.filter(name => name.endsWith('.mjs'))) {
    const text = fs.readFileSync(path.join(payload, name), 'utf8');
    for (const match of text.matchAll(/(?:from\s*|import\s*\()(['"])(\.\/[^'"\n]+\.mjs)\1/g)) {
      if (name === 'host.mjs' && match[0].startsWith('import') && match[2] === './windows-admin-owner.mjs') {
        assert.match(text, /const administratorOwner = process\.argv\.length === 5 && process\.argv\[4\] === '--administrator-owner';/);
        assert.match(text, /const administratorAdmission = administratorOwner\s*\?\s*await \(await import\('\.\/windows-admin-owner\.mjs'\)\)\.openWindowsAdministratorAdmission\(root\)\s*:\s*null;/);
        assert.equal(names.includes('windows-admin-owner.mjs'), false, 'protected sidecar belongs only in the administrator bundle');
        protectedImports++;
      } else {
        assert.ok(names.includes(match[2].slice(2)), 'missing imported runtime source: ' + match[2]);
      }
    }
  }
  assert.equal(protectedImports, 1, 'only the single guarded administrator sidecar import is separate');
}

function replacePayloadJSON(packaged, name, value) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  fs.writeFileSync(path.join(packaged, 'payload', name), bytes);
  const file = path.join(packaged, 'payload-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file));
  Object.assign(manifest.files.find(record => record.path === name), {
    bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  });
  fs.writeFileSync(file, JSON.stringify(manifest) + '\n');
}

check('lock permits only the pinned parent-contained bundle, not arbitrary unverified sources', t => {
  for (const change of ['bundle-version', 'bundle-owner', 'bundle-source', 'missing-bundle', 'dangling-bundle', 'arbitrary-bundle', 'missing-integrity', 'file-source']) {
    const { packaged } = fixture(t), lock = JSON.parse(fs.readFileSync(path.join(packaged, 'payload', 'package-lock.json')));
    const provider = 'node_modules/@wonderwhy-er/desktop-commander';
    const bundle = provider + '/node_modules/@desktop-commander/telemetry-contract';
    const other = Object.keys(lock.packages).find(name => name && name !== provider && name !== bundle);
    if (change === 'bundle-version') lock.packages[bundle].version = '9.9.9';
    if (change === 'bundle-owner') lock.packages[provider].bundleDependencies = [];
    if (change === 'bundle-source') lock.packages[bundle].resolved = 'file:other';
    if (change === 'missing-bundle') delete lock.packages[bundle];
    if (change === 'dangling-bundle') { delete lock.packages[bundle]; lock.packages[provider].bundleDependencies = ['unexpected']; }
    if (change === 'arbitrary-bundle') lock.packages[other] = { version: '1.0.0', inBundle: true };
    if (change === 'missing-integrity') delete lock.packages[other].integrity;
    if (change === 'file-source') lock.packages[other].resolved = 'file:other';
    replacePayloadJSON(packaged, 'package-lock.json', lock);
    assert.throws(() => api.verifyPayload(packaged), /payload_invalid/);
  }
});

function inventoryNpm(root) {
  const provider = path.resolve(here, '../desktop-commander/node_modules/@wonderwhy-er/desktop-commander');
  return fakeNpm(root, `const fs=require('fs'),path=require('path');const src=${JSON.stringify(provider)};const out=path.join(process.cwd(),'node_modules','@wonderwhy-er','desktop-commander');fs.mkdirSync(out,{recursive:true});fs.copyFileSync(path.join(src,'package.json'),path.join(out,'package.json'));fs.cpSync(path.join(src,'dist'),path.join(out,'dist'),{recursive:true});`);
}

check('built package is private, dependency-free and has no lifecycle hooks', t => {
  const { packaged } = fixture(t), meta = JSON.parse(fs.readFileSync(path.join(packaged, 'package.json')));
  assert.equal(meta.private, true);
  assert.equal(Object.keys(meta.dependencies || {}).length, 0);
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'postpack']) assert.equal(meta.scripts?.[hook], undefined);
  assert.equal(meta.bin['agent-continue-device'], 'bin.mjs');
  assert.equal(api.verifyPayload(packaged).files, 21);
});

check('built payload includes the native bridge dependency closure but never a device binding or channel secret', t => {
  const { packaged } = fixture(t), payload = path.join(packaged, 'payload');
  const names = fs.readdirSync(payload).sort();
  for (const name of ['device-native-host.mjs', 'device-operations.mjs', 'device-owner.mjs', 'device-server.mjs', 'device-ssh.mjs']) {
    assert.ok(names.includes(name), 'missing native source: ' + name);
    assert.deepEqual(fs.readFileSync(path.join(payload, name)), fs.readFileSync(path.resolve(here, '../desktop-commander', name)));
  }
  assertRuntimeImportClosure(payload);
  for (const name of ['device-native-binding.json', 'device-channel.json', 'device-operations.jsonl']) {
    assert.equal(names.includes(name), false);
  }
});

check('ordinary closure rejects missing imports outside the exact guarded protected sidecar edge', t => {
  for (const change of ['missing-source', 'wrong-importer', 'static-sidecar', 'duplicate-sidecar', 'unguarded-sidecar', 'wrong-flag']) {
    const { packaged } = fixture(t), payload = path.join(packaged, 'payload');
    const name = change === 'wrong-importer' ? 'device-owner.mjs' : 'host.mjs';
    const file = path.join(payload, name);
    let text = fs.readFileSync(file, 'utf8');
    if (change === 'missing-source') text += "\nawait import('./missing-runtime.mjs');\n";
    if (change === 'wrong-importer') text += "\nawait import('./windows-admin-owner.mjs');\n";
    if (change === 'static-sidecar') text += "\nimport { openWindowsAdministratorAdmission } from './windows-admin-owner.mjs';\n";
    if (change === 'duplicate-sidecar') text += "\nawait import('./windows-admin-owner.mjs');\n";
    if (change === 'unguarded-sidecar') text = text.replace('const administratorAdmission = administratorOwner ?', 'const administratorAdmission = true ?');
    if (change === 'wrong-flag') text = text.replace("process.argv[4] === '--administrator-owner'", "process.argv[4] === '--ordinary'");
    fs.writeFileSync(file, text);
    assert.throws(() => assertRuntimeImportClosure(payload), { code: 'ERR_ASSERTION' }, change);
    assert.throws(() => api.verifyPayload(packaged), /payload_invalid/, change);
  }
});

check('builder canonicalizes a CRLF bin hashbang before npm can rewrite the installed file', t => {
  const { root } = fixture(t), destination = path.join(root, 'crlf-package');
  const read = fs.readFileSync;
  fs.readFileSync = function(file, ...args) {
    const bytes = Reflect.apply(read, this, [file, ...args]);
    if (String(file) === path.join(here, 'bin.mjs') && Buffer.isBuffer(bytes)) {
      return Buffer.from(bytes.toString('utf8').replace(/\r?\n/g, '\r\n'));
    }
    return bytes;
  };
  try { builder.buildPackage(destination); }
  finally { fs.readFileSync = read; }
  assert.ok(fs.readFileSync(path.join(destination, 'bin.mjs'), 'utf8').startsWith('#!/usr/bin/env node\n'));
});

check('consent refusal precedes destination creation and npm execution', async t => {
  const { root, packaged, installDir } = fixture(t);
  const marker = path.join(root, 'must-not-run');
  const npmCli = fakeNpm(root, `require('fs').writeFileSync(${JSON.stringify(marker)},'bad')`);
  for (const consent of [undefined, true, '', 'full-account', 'yes']) {
    await assert.rejects(api.stageRuntime({ installDir, consent }, composition(packaged, npmCli)), /consent_required/);
  }
  assert.equal(fs.existsSync(installDir), false); assert.equal(fs.existsSync(marker), false);
});

check('payload tampering, missing entries, extra files and hard links reject before staging', t => {
  for (const change of ['bytes', 'missing', 'extra', 'hardlink']) {
    const { root, packaged, installDir } = fixture(t), file = path.join(packaged, 'payload', 'host.mjs');
    if (change === 'bytes') fs.appendFileSync(file, '\nchanged');
    if (change === 'missing') fs.unlinkSync(file);
    if (change === 'extra') fs.writeFileSync(path.join(packaged, 'payload', 'unexpected.json'), '{}');
    if (change === 'hardlink') fs.linkSync(file, path.join(root, 'alias'));
    assert.throws(() => api.verifyPayload(packaged), /payload_invalid/);
    assert.equal(fs.existsSync(installDir), false);
  }
});

check('manifest mutations are not accepted as canonical payload metadata', t => {
  for (const change of ['extra', 'duplicate', 'invalid-size', 'provider']) {
    const { packaged } = fixture(t), file = path.join(packaged, 'payload-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file));
    if (change === 'extra') manifest.unknown = true;
    if (change === 'duplicate') manifest.files.push(manifest.files[0]);
    if (change === 'invalid-size') manifest.files[0].bytes = -1;
    if (change === 'provider') manifest.provider.version = 'latest';
    fs.writeFileSync(file, JSON.stringify(manifest) + '\n');
    assert.throws(() => api.verifyPayload(packaged), /payload_invalid/);
  }
});

check('existing destinations and relative or overlapping targets have no effects', async t => {
  const { root, packaged, installDir } = fixture(t);
  fs.mkdirSync(installDir); const marker = path.join(installDir, 'keep'); fs.writeFileSync(marker, 'original');
  for (const target of [installDir, 'relative', packaged, path.join(packaged, 'child')]) {
    await assert.rejects(api.stageRuntime({ installDir: target, consent: 'acquire-provider' }, composition(packaged)));
  }
  assert.equal(fs.readFileSync(marker, 'utf8'), 'original');
  assert.deepEqual(fs.readdirSync(installDir), ['keep']);
  assert.deepEqual(fs.readdirSync(root).sort(), ['install', 'package']);
});

check('case aliases of existing source ancestors cannot become a writable destination', async t => {
  const { packaged } = fixture(t);
  const alias = path.join(path.dirname(packaged), 'PACKAGE');
  if (!fs.existsSync(alias) || fs.statSync(alias, { bigint: true }).ino !== fs.statSync(packaged, { bigint: true }).ino) {
    t.skip('Case-sensitive test volume; case-insensitive filesystem regression not executed'); return;
  }
  const installDir = path.join(alias, 'must-not-be-created');
  await assert.rejects(api.stageRuntime({ installDir, consent: 'acquire-provider' }, { packageRoot: packaged }), /^Error: invalid_install_path$/);
  assert.equal(fs.existsSync(installDir), false);
});

check('failed dependency acquisition is one attempt with no success receipt or repair', async t => {
  const { root, packaged, installDir } = fixture(t), marker = path.join(root, 'attempts');
  const npmCli = fakeNpm(root, `require('fs').appendFileSync(${JSON.stringify(marker)},'1');process.exit(2)`);
  await assert.rejects(api.stageRuntime({ installDir, consent: 'acquire-provider' }, composition(packaged, npmCli)), /dependency_acquisition_failed/);
  assert.equal(fs.readFileSync(marker, 'utf8'), '1');
  assert.equal(fs.existsSync(path.join(installDir, 'receipt.json')), false);
  assert.equal(fs.existsSync(path.join(installDir, 'app', 'package-lock.json')), true);
  await assert.rejects(api.stageRuntime({ installDir, consent: 'acquire-provider' }, composition(packaged, npmCli)));
  assert.equal(fs.readFileSync(marker, 'utf8'), '1');
});

check('npm receives fixed arguments and isolated configuration without inherited credentials', async t => {
  const { root, packaged, installDir } = fixture(t), report = path.join(root, 'npm-report.json');
  const npmCli = fakeNpm(root, `require('fs').writeFileSync(${JSON.stringify(report)},JSON.stringify({args:process.argv.slice(2),env:process.env,cwd:process.cwd()}));process.exit(2)`);
  const inherited = ['NPM_TOKEN', 'NODE_AUTH_TOKEN', 'NODE_OPTIONS', 'npm_config_registry', 'HTTP_PROXY'];
  const before = Object.fromEntries(inherited.map(key => [key, process.env[key]]));
  try {
    for (const key of inherited) process.env[key] = 'private-do-not-forward';
    await assert.rejects(api.stageRuntime({ installDir, consent: 'acquire-provider' }, composition(packaged, npmCli)), /dependency_acquisition_failed/);
  } finally { for (const key of inherited) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } }
  const result = JSON.parse(fs.readFileSync(report));
  assert.deepEqual(result.args.slice(0, 4), ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  assert.ok(result.args.includes('--registry=https://registry.npmjs.org/'));
  assert.ok(result.args.includes('--workspaces=false'));
  assert.equal(result.args[result.args.indexOf('--prefix') + 1], path.join(installDir, 'app'));
  assert.equal(result.args[result.args.indexOf('--logs-dir') + 1], path.join(installDir, 'acquisition', 'logs'));
  assert.ok(result.args.includes('--update-notifier=false'));
  assert.equal(result.cwd, path.join(installDir, 'app'));
  for (const key of inherited) assert.equal(result.env[key], undefined);
  assert.equal(result.env.HOME, path.join(installDir, 'acquisition', 'home'));
  assert.equal(result.env.CI, 'true');
  if (process.platform === 'win32') {
    const system = path.join(process.env.SystemRoot || process.env.WINDIR, 'System32');
    assert.equal(result.env.ComSpec, path.join(system, 'cmd.exe'));
    assert.deepEqual(result.env.PATH.split(path.delimiter), [path.dirname(process.execPath), system]);
  }
});

check('npm success without the pinned provider never becomes staged success', async t => {
  const { root, packaged, installDir } = fixture(t), npmCli = fakeNpm(root, 'process.exit(0)');
  await assert.rejects(api.stageRuntime({ installDir, consent: 'acquire-provider' }, composition(packaged, npmCli)), /provider_verification_failed/);
  assert.equal(fs.existsSync(path.join(installDir, 'receipt.json')), false);
});

check('source mutation during acquisition prevents a success receipt', async t => {
  const { root, packaged, installDir } = fixture(t);
  const npmCli = fakeNpm(root, "require('fs').appendFileSync('host.mjs','changed');process.exit(0)");
  await assert.rejects(api.stageRuntime({ installDir, consent: 'acquire-provider' }, composition(packaged, npmCli)), /payload_invalid/);
  assert.equal(fs.existsSync(path.join(installDir, 'receipt.json')), false);
});

check('import has no write, network or process-launch effects', async () => {
  const mkdir = fs.mkdirSync, run = childProcess.execFile, fetch = globalThis.fetch;
  try {
    fs.mkdirSync = () => { throw new Error('unexpected_write'); };
    childProcess.execFile = () => { throw new Error('unexpected_process'); };
    globalThis.fetch = () => { throw new Error('unexpected_network'); };
    await import(library.href + '?side-effects');
  } finally { fs.mkdirSync = mkdir; childProcess.execFile = run; globalThis.fetch = fetch; }
});

check('a raced existing destination cannot become a second acquisition owner', async t => {
  const { root, packaged, installDir } = fixture(t), marker = path.join(root, 'attempts');
  const npmCli = fakeNpm(root, `require('fs').appendFileSync(${JSON.stringify(marker)},'1');setTimeout(()=>process.exit(2),100)`);
  const exists = fs.existsSync;
  fs.existsSync = function(file) { return String(file) === installDir ? false : Reflect.apply(exists, this, [file]); };
  let results;
  try {
    results = await Promise.allSettled([0, 1].map(() => api.stageRuntime({ installDir, consent: 'acquire-provider' }, composition(packaged, npmCli))));
  } finally { fs.existsSync = exists; }
  assert.deepEqual(results.map(result => result.reason?.message).sort(), ['dependency_acquisition_failed', 'destination_exists']);
  assert.equal(fs.readFileSync(marker, 'utf8'), '1');
});

check('explicit offline cache is validated and passed as a deliberately writable cache', async t => {
  const { root, packaged, installDir } = fixture(t), report = path.join(root, 'args');
  const cache = path.join(root, 'cache'); fs.mkdirSync(path.join(cache, '_cacache'), { recursive: true });
  const npmCli = fakeNpm(root, `require('fs').writeFileSync(${JSON.stringify(report)},JSON.stringify(process.argv.slice(2)));process.exit(2)`);
  await assert.rejects(api.stageRuntime({ installDir, consent: 'acquire-provider', offlineCache: cache }, composition(packaged, npmCli)), /dependency_acquisition_failed/);
  const args = JSON.parse(fs.readFileSync(report));
  assert.ok(args.includes('--offline')); assert.equal(args[args.indexOf('--cache') + 1], cache);
  for (const offlineCache of ['relative', packaged, path.join(root, 'missing')]) {
    await assert.rejects(api.stageRuntime({ installDir: path.join(root, 'other'), consent: 'acquire-provider', offlineCache }, composition(packaged, npmCli)), /invalid_install_path/);
  }
  assert.equal(fs.existsSync(path.join(root, 'other')), false);
});

check('a separately located Node toolchain cannot be selected as writable npm cache', async t => {
  const { root, packaged, installDir } = fixture(t);
  const nodeDirectory = path.join(root, 'node-toolchain'), cache = path.join(nodeDirectory, 'cache');
  fs.mkdirSync(path.join(cache, '_cacache'), { recursive: true });
  const executable = path.join(nodeDirectory, path.basename(process.execPath));
  fs.writeFileSync(executable, 'owned synthetic executable, never run');
  const npmCli = fakeNpm(root, 'throw new Error("must not run")');
  const original = Object.getOwnPropertyDescriptor(process, 'execPath');
  try {
    Object.defineProperty(process, 'execPath', { ...original, value: executable });
    await assert.rejects(api.stageRuntime({ installDir, consent: 'acquire-provider', offlineCache: cache },
      composition(packaged, npmCli)), /invalid_install_path/);
  } finally { Object.defineProperty(process, 'execPath', original); }
  assert.equal(fs.existsSync(installDir), false);
});

check('negative or malformed verifier returns cannot publish a staged receipt', async t => {
  for (const result of [null, false, {}, { version: '0.3.1', verifiedFiles: 0 },
    { version: 'other', verifiedFiles: 274 }, { version: '0.3.1', verifiedFiles: 274, extra: true }]) {
    const { root, packaged, installDir } = fixture(t);
    const manifestFile = path.join(packaged, 'payload-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile));
    const changed = `export function verifyUpstream(){return ${JSON.stringify(result)}}\n`;
    fs.writeFileSync(path.join(packaged, 'payload', 'runtime.mjs'), changed);
    const record = manifest.files.find(entry => entry.path === 'runtime.mjs');
    const crypto = await import('node:crypto');
    record.bytes = Buffer.byteLength(changed); record.sha256 = crypto.createHash('sha256').update(changed).digest('hex');
    fs.writeFileSync(manifestFile, JSON.stringify(manifest) + '\n');
    const npmCli = fakeNpm(root, 'process.exit(0)');
    await assert.rejects(api.stageRuntime({ installDir, consent: 'acquire-provider' }, composition(packaged, npmCli)), /provider_verification_failed/);
    assert.equal(fs.existsSync(path.join(installDir, 'receipt.json')), false);
  }
});

check('cancellation stops only the owned acquisition and never publishes a success receipt', async t => {
  const { root, packaged, installDir } = fixture(t), ready = path.join(root, 'ready');
  const npmCli = fakeNpm(root, `process.on('SIGTERM',()=>{});require('fs').writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},100)`);
  const controller = new AbortController();
  const pending = api.stageRuntime({ installDir, consent: 'acquire-provider', signal: controller.signal }, composition(packaged, npmCli));
  const failure = assert.rejects(pending, /dependency_acquisition_failed|acquisition_exit_unconfirmed/);
  const end = performance.now() + 3000;
  while (!fs.existsSync(ready) && performance.now() < end) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(fs.existsSync(ready), true); controller.abort();
  await failure;
  assert.equal(fs.existsSync(path.join(installDir, 'receipt.json')), false);
});

check('default acquisition has no automatic deadline and can complete normally', async t => {
  const { root, packaged, installDir } = fixture(t);
  const npmCli = inventoryNpm(root);
  const schedule = globalThis.setTimeout, delays = [];
  globalThis.setTimeout = (callback, milliseconds, ...args) => {
    delays.push(milliseconds);
    return schedule(callback, milliseconds === 180000 ? 0 : milliseconds, ...args);
  };
  try {
    const receipt = await api.stageRuntime({ installDir, consent: 'acquire-provider' }, composition(packaged, npmCli));
    assert.equal(receipt.status, 'staged');
    assert.deepEqual(delays, [], 'Default acquisition must not schedule a total-time cutoff');
    const report = JSON.parse(fs.readFileSync(path.join(installDir, 'acquisition', 'process.json')));
    assert.equal(report.result, 'completed');
    assert.equal(report.cancelReason, null);
  } finally { globalThis.setTimeout = schedule; }
});

check('trusted fixture deadlines above the old cap avoid Node timer overflow', async t => {
  const { root, packaged, installDir } = fixture(t), npmCli = inventoryNpm(root);
  const schedule = globalThis.setTimeout, delays = [];
  globalThis.setTimeout = (callback, milliseconds, ...args) => {
    delays.push(milliseconds);
    return schedule(callback, milliseconds, ...args);
  };
  try {
    const receipt = await api.stageRuntime({ installDir, consent: 'acquire-provider' },
      { ...composition(packaged, npmCli), acquisitionTimeoutMs: Number.MAX_SAFE_INTEGER });
    assert.equal(receipt.status, 'staged');
    assert.deepEqual(delays, [2147483647]);
  } finally { globalThis.setTimeout = schedule; }
});

check('explicit trusted fixture deadline does not retry or publish a success receipt', async t => {
  const { root, packaged, installDir } = fixture(t), marker = path.join(root, 'attempts');
  const npmCli = fakeNpm(root, `require('fs').appendFileSync(${JSON.stringify(marker)},'1');process.on('SIGTERM',()=>{});setInterval(()=>{},100)`);
  await assert.rejects(api.stageRuntime({ installDir, consent: 'acquire-provider' },
    { ...composition(packaged, npmCli), acquisitionTimeoutMs: 500 }),
  /dependency_acquisition_failed|acquisition_exit_unconfirmed/);
  assert.equal(fs.readFileSync(marker, 'utf8'), '1');
  assert.equal(fs.existsSync(path.join(installDir, 'receipt.json')), false);
  const report = JSON.parse(fs.readFileSync(path.join(installDir, 'acquisition', 'process.json')));
  assert.equal(report.cancelReason, 'deadline');
  assert.equal(report.result === 'completed', false);
});

check('verified inventory yields only an acquisition receipt, never configuration or activation', async t => {
  const { root, packaged, installDir } = fixture(t);
  const result = await api.stageRuntime({ installDir, consent: 'acquire-provider' }, composition(packaged, inventoryNpm(root)));
  assert.deepEqual(result, { format: 'agent-continue-acquisition', version: 1, status: 'staged', providerVersion: '0.3.1',
    configured: false, activated: false, protectedInstallationVerified: false, nativeDependenciesVerified: false });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(installDir, 'receipt.json'))), result);
  assert.equal(fs.existsSync(path.join(installDir, 'app', 'consent.json')), false);
});

check('provider stage verification checks canonical receipt, copied bytes and installed inventory', async t => {
  const { root, packaged, installDir } = fixture(t);
  await api.stageRuntime({ installDir, consent: 'acquire-provider' }, composition(packaged, inventoryNpm(root)));
  assert.equal(typeof api.verifyProviderStage, 'function');
  assert.deepEqual(await api.verifyProviderStage(installDir, packaged), { providerVersion: '0.3.1', files: 21 });
  const receiptFile = path.join(installDir, 'receipt.json'), bytes = fs.readFileSync(receiptFile);
  fs.appendFileSync(receiptFile, ' ');
  await assert.rejects(api.verifyProviderStage(installDir, packaged), /^Error: provider_stage_invalid$/);
  fs.writeFileSync(receiptFile, bytes);
  const runtimeFile = path.join(installDir, 'app', 'host.mjs');
  fs.appendFileSync(runtimeFile, '\nchanged');
  await assert.rejects(api.verifyProviderStage(installDir, packaged), /^Error: provider_stage_invalid$/);
});

check('provider stage rechecks payload and receipt after its awaited runtime import', async t => {
  for (const kind of ['payload', 'receipt']) {
    const { root, packaged, installDir } = fixture(t);
    await api.stageRuntime({ installDir, consent: 'acquire-provider' }, composition(packaged, inventoryNpm(root)));
    const read = fs.readFileSync, receiptFile = path.join(installDir, 'receipt.json'); let changed = false, scheduled = false;
    fs.readFileSync = function(file, ...args) {
      const bytes = Reflect.apply(read, this, [file, ...args]);
      if (String(file) === receiptFile && !scheduled) {
        scheduled = true;
        queueMicrotask(() => {
          fs.appendFileSync(kind === 'receipt' ? receiptFile : path.join(installDir, 'app', 'host.mjs'), 'changed');
          changed = true;
        });
      }
      return bytes;
    };
    try { await assert.rejects(api.verifyProviderStage(installDir, packaged), /^Error: provider_stage_invalid$/, kind); }
    finally { fs.readFileSync = read; }
    assert.equal(changed, true, kind);
  }
});

check('cancellation before receipt commit and publication errors leave no final receipt', async t => {
  for (const failure of ['cancel', 'publish']) {
    const { root, packaged, installDir } = fixture(t), controller = new AbortController();
    const write = fs.writeFileSync, link = fs.linkSync;
    fs.writeFileSync = function(file, ...args) {
      const result = Reflect.apply(write, this, [file, ...args]);
      if (failure === 'cancel' && path.basename(String(file)).startsWith('receipt.pending.')) controller.abort();
      return result;
    };
    fs.linkSync = function(from, to) {
      if (failure === 'publish' && String(to) === path.join(installDir, 'receipt.json')) throw new Error('private filesystem failure');
      return Reflect.apply(link, this, [from, to]);
    };
    try {
      await assert.rejects(api.stageRuntime({ installDir, consent: 'acquire-provider', signal: controller.signal },
        composition(packaged, inventoryNpm(root))), /dependency_acquisition_failed|receipt_write_failed/);
    } finally { fs.writeFileSync = write; fs.linkSync = link; }
    assert.equal(fs.existsSync(path.join(installDir, 'receipt.json')), false);
  }
});

check('post-commit cancellation or pending-link cleanup cannot retract the published receipt', async t => {
  const { root, packaged, installDir } = fixture(t), controller = new AbortController();
  const link = fs.linkSync, unlink = fs.unlinkSync;
  fs.linkSync = function(from, to) {
    const result = Reflect.apply(link, this, [from, to]);
    if (String(to) === path.join(installDir, 'receipt.json')) controller.abort();
    return result;
  };
  fs.unlinkSync = function(file) {
    if (path.basename(String(file)).startsWith('receipt.pending.')) throw new Error('private cleanup failure');
    return Reflect.apply(unlink, this, [file]);
  };
  let result;
  try {
    result = await api.stageRuntime({ installDir, consent: 'acquire-provider', signal: controller.signal },
      composition(packaged, inventoryNpm(root)));
  } finally { fs.linkSync = link; fs.unlinkSync = unlink; }
  assert.equal(result.status, 'staged');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(installDir, 'receipt.json'))), result);
});
