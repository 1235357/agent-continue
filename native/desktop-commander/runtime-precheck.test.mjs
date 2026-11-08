import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { precheckInstall, formatReport } from '../bootstrap/runtime-precheck.mjs';

const HOST = 'com.agentcontinue.device_control';
const extensionId = 'a'.repeat(32);
const origin = 'chrome-extension://' + extensionId + '/';
const FILES = ['device-native-host.mjs', 'device-owner.mjs'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function writePayloadManifest(root, app, names, overrides = {}) {
  const files = names.map(name => {
    const bytes = fs.readFileSync(path.join(app, name));
    return { path: name, bytes: bytes.length, sha256: hash(bytes), ...(overrides[name] || {}) };
  });
  fs.writeFileSync(path.join(root, 'payload-manifest.json'),
    JSON.stringify({ format: 'agent-continue-payload', version: 1, files }) + '\n');
}

function install(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-precheck-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'app'), state = path.join(root, 'state');
  fs.mkdirSync(app, { mode: 0o700 });
  fs.mkdirSync(state, { mode: 0o700 });
  for (const name of FILES) fs.writeFileSync(path.join(app, name), '// fixture ' + name + '\n');
  const id = options.extensionId === undefined ? extensionId : options.extensionId;
  const binding = { format: 'agent-continue-native-binding', version: 1, extensionId: id,
    stateRoot: options.stateRoot === undefined ? state : options.stateRoot };
  fs.writeFileSync(path.join(app, 'device-native-binding.json'),
    options.bindingRaw === undefined ? JSON.stringify(binding) + '\n' : options.bindingRaw);
  if (options.omitManifest !== true) writePayloadManifest(root, app, FILES, options.hashes);
  if (options.manifest !== null) {
    const manifest = { name: HOST, description: 'Agent Continue device lifecycle bridge',
      path: path.join(root, 'native-launcher.exe'), type: 'stdio', allowed_origins: [origin], ...(options.manifest || {}) };
    for (const key of options.drop || []) delete manifest[key];
    fs.writeFileSync(path.join(root, 'native-host.json'), JSON.stringify(manifest) + '\n');
  }
  if (options.channel) fs.writeFileSync(path.join(state, 'device-channel.json'), JSON.stringify(options.channel) + '\n');
  return { root, app, state, manifestPath: path.join(root, 'native-host.json') };
}

const registryOf = values => ({ get: plan => Object.hasOwn(values, plan.hive + '/' + plan.view) ? values[plan.hive + '/' + plan.view] : null });

const run = (root, registry, extra = {}) => precheckInstall({ root, registry,
  verifySyntax: () => ({ ok: true, reason: 'stub parse ok' }), ...extra });

const status = (report, id) => report.checks.find(check => check.id === id)?.status;
const reason = (report, id) => report.checks.find(check => check.id === id)?.reason;
const kind = (report, id) => report.checks.find(check => check.id === id)?.kind;

test('channel metadata never claims a live owner or connection', t => {
  const channel = { format:'agent-continue-device-channel', version:1, extensionId,
    endpoint:process.platform === 'win32' ? '\\\\.\\pipe\\agentcontinue-device-' + 'a'.repeat(32) : '/tmp/ac-fixture.sock',
    secret:'a'.repeat(64) };
  const {root} = install(t, {channel});
  const report = run(root, registryOf({}));
  assert.equal(status(report, 'channel'), 'PASS');
  assert.match(reason(report, 'channel'), /liveness and tunnel connectivity unverified/);
});

test('invalid channel filesystem entry is not reported as absent', t => {
  const {root,state} = install(t);
  fs.mkdirSync(path.join(state,'device-channel.json'));
  const report = run(root, registryOf({}));
  assert.equal(status(report, 'channel'), 'FAIL');
});

test('precheck reports a missing registry key as the normal not-registered state', t => {
  const { root } = install(t);
  const report = run(root, registryOf({}));
  assert.equal(report.failed, 0);
  for (const id of ['registry:HKCU/32', 'registry:HKCU/64']) {
    assert.equal(status(report, id), 'PASS', id);
    assert.match(reason(report, id), /not registered/);
  }
  for (const id of ['registry:HKLM/32', 'registry:HKLM/64']) {
    assert.equal(status(report, id), 'SKIP', id);
    assert.equal(kind(report, id), 'not-applicable', id);
    assert.match(reason(report, id), /per-user install never writes HKLM/);
  }
  assert.equal(status(report, 'install_root'), 'PASS');
  assert.equal(status(report, 'runtime_files'), 'PASS');
  assert.equal(status(report, 'binding'), 'PASS');
  assert.equal(status(report, 'state_root'), 'PASS');
  assert.equal(status(report, 'channel'), 'PASS');
  assert.equal(status(report, 'manifest'), 'PASS');
  assert.match(formatReport(report).join('\n'), /^PASS install_root:/m);
});

test('precheck accepts registration values byte-equal to the manifest path', t => {
  const { root, manifestPath } = install(t);
  const seen = [];
  const registry = { get: plan => { seen.push(plan); return manifestPath; } };
  const report = run(root, registry);
  assert.equal(report.failed, 0);
  for (const id of ['registry:HKCU/32', 'registry:HKCU/64']) {
    assert.equal(status(report, id), 'PASS', id);
    assert.match(reason(report, id), /registered; default value matches/);
  }
  for (const id of ['registry:HKLM/32', 'registry:HKLM/64']) {
    assert.equal(status(report, id), 'SKIP', id);
    assert.match(reason(report, id), /residual with the same value \(informational\)/);
  }
  assert.equal(seen.length, 4);
  assert.deepEqual(seen.map(plan => plan.queryArgs[0]), ['query', 'query', 'query', 'query']);
  assert.deepEqual(seen.map(plan => plan.queryArgs.at(-1)), ['/reg:32', '/reg:64', '/reg:32', '/reg:64']);
});

test('a HKLM residual is informational and can never turn into a failure', t => {
  const { root, manifestPath } = install(t);
  const values = { 'HKCU/32': manifestPath, 'HKCU/64': manifestPath,
    'HKLM/32': path.join(root, 'other.json'), 'HKLM/64': manifestPath };
  const report = run(root, registryOf(values));
  assert.equal(report.failed, 0);
  assert.equal(status(report, 'registry:HKLM/32'), 'SKIP');
  assert.match(reason(report, 'registry:HKLM/32'), /residual with a different value \(informational\)/);
  assert.equal(status(report, 'registry:HKLM/64'), 'SKIP');
});

test('precheck flags a registered value that drifted from the manifest path', t => {
  const { root, app, manifestPath } = install(t);
  const report = run(root, registryOf({ 'HKCU/32': path.join(app, 'elsewhere.json'), 'HKCU/64': manifestPath,
    'HKLM/32': manifestPath, 'HKLM/64': manifestPath }));
  assert.equal(report.failed, 1);
  assert.equal(status(report, 'registry:HKCU/32'), 'FAIL');
  assert.match(reason(report, 'registry:HKCU/32'), /value drift/);
  assert.equal(status(report, 'registry:HKCU/64'), 'PASS');
  assert.equal(status(report, 'registry:HKLM/32'), 'SKIP');
});

test('precheck fails a manifest with a missing field and skips registry checks', t => {
  const { root } = install(t, { drop: ['type'] });
  const report = run(root, registryOf({}));
  assert.equal(report.failed, 1);
  assert.equal(status(report, 'manifest'), 'FAIL');
  assert.match(reason(report, 'manifest'), /keys are/);
  for (const id of ['registry:HKCU/32', 'registry:HKCU/64', 'registry:HKLM/32', 'registry:HKLM/64']) {
    assert.equal(status(report, id), 'SKIP', id);
  }
});

test('intact files match the install-root payload manifest', t => {
  const { root } = install(t);
  const report = run(root, registryOf({}));
  assert.equal(status(report, 'runtime_files'), 'PASS');
  assert.match(reason(report, 'runtime_files'), /2 files match the payload manifest/);
});

test('a real hash mismatch names the file with expected and actual digests', t => {
  const { root, app } = install(t);
  fs.writeFileSync(path.join(app, 'device-native-host.mjs'), '// tampered bytes\n');
  const report = run(root, registryOf({}));
  assert.equal(status(report, 'runtime_files'), 'FAIL');
  assert.match(reason(report, 'runtime_files'), /hash mismatch: device-native-host\.mjs/);
  assert.match(reason(report, 'runtime_files'), /expected bytes=\d+ sha256=[a-f0-9]{64} actual bytes=\d+ sha256=[a-f0-9]{64}/);
  assert.equal(report.failed, 1);
});

test('byte length alone is not enough: a same-length rewrite still fails', t => {
  const { root, app } = install(t);
  const file = path.join(app, 'device-owner.mjs'), original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, original.replace('fixture', 'fixtur3'));
  const report = run(root, registryOf({}));
  assert.equal(status(report, 'runtime_files'), 'FAIL');
  assert.match(reason(report, 'runtime_files'), /hash mismatch: device-owner\.mjs/);
});

test('an explicit --reference manifest overrides the install-root one', t => {
  const { root, app } = install(t);
  const reference = path.join(root, 'reference-payload-manifest.json');
  const bytes = fs.readFileSync(path.join(app, 'device-native-host.mjs'));
  fs.writeFileSync(reference, JSON.stringify({ format: 'agent-continue-payload', version: 1,
    files: [{ path: 'device-native-host.mjs', bytes: bytes.length, sha256: '0'.repeat(64) }] }) + '\n');
  const report = run(root, registryOf({}), { reference });
  assert.equal(status(report, 'runtime_files'), 'FAIL');
  assert.match(reason(report, 'runtime_files'), /hash mismatch: device-native-host\.mjs/);
});

test('a missing or malformed payload manifest fails instead of guessing a reference', t => {
  const missing = install(t, { omitManifest: true });
  const report = run(missing.root, registryOf({}));
  assert.equal(status(report, 'runtime_files'), 'FAIL');
  assert.match(reason(report, 'runtime_files'), /payload manifest: ENOENT/);

  const malformed = install(t);
  fs.writeFileSync(path.join(malformed.root, 'payload-manifest.json'), '{"format":"other"}\n');
  const bad = run(malformed.root, registryOf({}));
  assert.equal(status(bad, 'runtime_files'), 'FAIL');
  assert.match(reason(bad, 'runtime_files'), /payload manifest: shape/);
});

test('precheck rejects an invalid binding without writing anything', t => {
  const invalid = install(t, { extensionId: 'A'.repeat(32) });
  const report = run(invalid.root, registryOf({}));
  assert.equal(status(report, 'binding'), 'FAIL');
  assert.equal(status(report, 'state_root'), 'SKIP');
  assert.equal(status(report, 'registry:HKCU/32'), 'SKIP');
});
