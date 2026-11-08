import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { executeStatusCommand } from './registration-status.mjs';

const HOST = 'com.agentcontinue.device_control';
const extensionId = 'a'.repeat(32);
const origin = 'chrome-extension://' + extensionId + '/';
const FILES = ['device-native-host.mjs', 'device-owner.mjs'];
const USER_VIEWS = ['registry:HKCU/32', 'registry:HKCU/64'];
const MACHINE_VIEWS = ['registry:HKLM/32', 'registry:HKLM/64'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function install(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-status-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'app'), state = path.join(root, 'state');
  fs.mkdirSync(app, { mode: 0o700 });
  fs.mkdirSync(state, { mode: 0o700 });
  for (const name of FILES) fs.writeFileSync(path.join(app, name), '// fixture ' + name + '\n');
  const files = FILES.map(name => {
    const bytes = fs.readFileSync(path.join(app, name));
    return { path: name, bytes: bytes.length, sha256: hash(bytes) };
  });
  fs.writeFileSync(path.join(root, 'payload-manifest.json'),
    JSON.stringify({ format: 'agent-continue-payload', version: 1, files }) + '\n');
  if (options.binding !== false) {
    const binding = { format: 'agent-continue-native-binding', version: 1, extensionId,
      stateRoot: options.stateRoot === undefined ? state : options.stateRoot };
    fs.writeFileSync(path.join(app, 'device-native-binding.json'), JSON.stringify(binding) + '\n');
  }
  const manifest = { name: HOST, description: 'Agent Continue device lifecycle bridge',
    path: path.join(root, 'native-launcher.exe'), type: 'stdio', allowed_origins: [origin],
    ...(options.manifest || {}) };
  for (const key of options.drop || []) delete manifest[key];
  fs.writeFileSync(path.join(root, 'native-host.json'), JSON.stringify(manifest) + '\n');
  return { root, app, state, manifestPath: path.join(root, 'native-host.json') };
}

const deps = registry => ({ registry, verifySyntax: () => ({ ok: true, reason: 'stub parse ok' }) });
const registryOf = values => ({ get: plan => Object.hasOwn(values, plan.hive + '/' + plan.view) ? values[plan.hive + '/' + plan.view] : null });
const status = (root, registry, extra = []) => executeStatusCommand(['status', '--install-dir', root, ...extra], deps(registry));
const verify = (root, registry, extra = []) => executeStatusCommand(['verify', '--install-dir', root, ...extra], deps(registry));

function assertNoSecrets(output) {
  const parsed = JSON.parse(output);
  assert.equal(Object.keys(parsed).some(key => /secret|mac|nonce|key/i.test(key)), false, 'no key-like fields');
  assert.equal(/[a-f0-9]{64}/i.test(output), false, 'no 64-hex material');
}

test('status and verify report the normal unregistered state without failing', t => {
  const { root } = install(t);
  const registry = registryOf({});
  const summary = status(root, registry);
  assert.equal(summary.exitCode, 0);
  assert.match(summary.output, /^install root: /m);
  assert.match(summary.output, /^installed: yes$/m);
  assert.match(summary.output, /^binding: present$/m);
  assert.match(summary.output, /^registered: not-registered$/m);
  assert.match(summary.output, /^host startable: yes$/m);
  const json = status(root, registry, ['--json']);
  assert.equal(json.exitCode, 0);
  assertNoSecrets(json.output);
  assert.equal(JSON.parse(json.output).registered, 'not-registered');
  const full = verify(root, registry);
  assert.equal(full.exitCode, 0);
  assert.match(full.output, /PASS registry:HKCU\/32: not registered/);
  for (const id of MACHINE_VIEWS) assert.match(full.output, new RegExp('SKIP ' + id + ': not applicable'));
  assert.match(full.output, /^VERIFY RESULT pass=11 fail=0 skip=2$/m);
  assertNoSecrets(verify(root, registry, ['--json']).output);
});

test('status and verify accept HKCU values equal to the manifest path', t => {
  const { root, manifestPath } = install(t);
  const values = { 'HKCU/32': manifestPath, 'HKCU/64': manifestPath, 'HKLM/32': manifestPath, 'HKLM/64': manifestPath };
  const summary = status(root, registryOf(values));
  assert.equal(summary.exitCode, 0);
  assert.match(summary.output, /^registered: registered$/m);
  const full = verify(root, registryOf(values));
  assert.equal(full.exitCode, 0);
  for (const id of USER_VIEWS) assert.match(full.output, new RegExp('PASS ' + id + ': registered; default value matches'));
  for (const id of MACHINE_VIEWS) assert.match(full.output, new RegExp('SKIP ' + id + ': not applicable'));
  assert.doesNotMatch(full.output, /partial/);
});

test('status and verify surface registry value drift and verify exits non-zero', t => {
  const { root, app, manifestPath } = install(t);
  const values = { 'HKCU/32': path.join(app, 'elsewhere.json'), 'HKCU/64': manifestPath,
    'HKLM/32': manifestPath, 'HKLM/64': manifestPath };
  const summary = status(root, registryOf(values));
  assert.equal(summary.exitCode, 0);
  assert.match(summary.output, /^registered: drift$/m);
  const full = verify(root, registryOf(values));
  assert.equal(full.exitCode, 1);
  assert.match(full.output, /^FAIL registry:HKCU\/32: value drift/m);
  assert.match(full.output, /^VERIFY RESULT pass=10 fail=1 skip=2$/m);
  assert.match(verify(root, registryOf(values), ['--json']).output, /"failed":1/);
});

test('one HKCU view without our manifest is drift, never a partial state', t => {
  const { root, manifestPath } = install(t);
  const summary = status(root, registryOf({ 'HKCU/64': manifestPath }));
  assert.equal(summary.exitCode, 0);
  assert.match(summary.output, /^registered: drift$/m);
  assert.doesNotMatch(summary.output, /partial/);
});

test('a missing binding is reported as missing and fails only verify', t => {
  const { root } = install(t, { binding: false });
  const summary = status(root, registryOf({}));
  assert.equal(summary.exitCode, 0);
  assert.match(summary.output, /^installed: no$/m);
  assert.match(summary.output, /^binding: missing$/m);
  assert.match(summary.output, /^registered: unknown$/m);
  assert.match(summary.output, /^host startable: no$/m);
  const full = verify(root, registryOf({}));
  assert.equal(full.exitCode, 1);
  assert.match(full.output, /^FAIL binding: missing device-native-binding\.json$/m);
  assert.match(full.output, /^FAIL manifest: binding origin unavailable$/m);
  assert.match(full.output, /^VERIFY RESULT pass=6 fail=2 skip=5$/m);
  assert.match(JSON.parse(status(root, registryOf({}), ['--json']).output).binding, /^missing$/);
});

test('status and verify reject malformed arguments', t => {
  const { root } = install(t);
  assert.throws(() => executeStatusCommand(['status'], deps(registryOf({}))), /invalid_arguments/);
  assert.throws(() => executeStatusCommand(['status', '--install-dir', 'relative'], deps(registryOf({}))), /invalid_arguments/);
  assert.throws(() => executeStatusCommand(['status', '--install-dir', root, '--install-dir', root], deps(registryOf({}))), /invalid_arguments/);
  assert.throws(() => executeStatusCommand(['verify', '--install-dir', root, '--json', '--json'], deps(registryOf({}))), /invalid_arguments/);
  assert.throws(() => executeStatusCommand(['status', '--install-dir', root, '--unknown'], deps(registryOf({}))), /invalid_arguments/);
  assert.throws(() => executeStatusCommand(['status', '--install-dir', root, '--reference', 'relative'], deps(registryOf({}))), /invalid_arguments/);
});
