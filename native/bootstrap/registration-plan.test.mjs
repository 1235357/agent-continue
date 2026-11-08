import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registrationPlan } from './registration-plan.mjs';

const HOST = 'com.agentcontinue.device_control';
const extensionId = 'a'.repeat(32);
const origin = 'chrome-extension://' + extensionId + '/';

function manifest(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aco-registration-'));
  const file = path.join(root, 'native-host.json');
  fs.writeFileSync(file, JSON.stringify({
    name: HOST, description: 'Agent Continue device lifecycle bridge',
    path: path.join(root, 'native-launcher.exe'), type: 'stdio', allowed_origins: [origin] }) + '\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, file };
}

const invalid = (run, code) => assert.throws(run, error => error?.message === code, code);

test('registration plan derives exact key paths for both hives and views', t => {
  const { file } = manifest(t);
  for (const hive of ['HKCU', 'HKLM']) for (const view of ['32', '64']) {
    const plan = registrationPlan({ name: HOST, hive, view, manifestPath: file, origin });
    assert.equal(plan.keyPath,
      hive + '\\Software\\Google\\Chrome\\NativeMessagingHosts\\' + HOST);
    assert.equal(plan.regSzValue, file);
    assert.equal(plan.addArgs[0], 'add');
    assert.equal(plan.addArgs.at(-1), '/reg:' + view);
    assert.equal(plan.queryArgs.at(-1), '/reg:' + view);
    assert.deepEqual(plan.addArgs.slice(1, 7),
      [plan.keyPath, '/ve', '/t', 'REG_SZ', '/d', file]);
    assert.equal(plan.addArgs.includes('reg'), false, 'planner must stay pure data');
  }
});

test('registration plan rejects any name that is not the exact host string', t => {
  const { file } = manifest(t);
  const base = { hive: 'HKCU', view: '32', manifestPath: file, origin };
  for (const name of ['Com.agentcontinue.device_control', HOST + ' ', ' ' + HOST,
    HOST + 'x', 'com.agentcontinue.device', 'com.agentcontinue..device_control', '']) {
    invalid(() => registrationPlan({ ...base, name }), 'invalid_native_host_name');
  }
});

test('registration plan rejects relative, missing and non-file manifest paths', t => {
  const { root, file } = manifest(t);
  const base = { name: HOST, hive: 'HKCU', view: '32', origin };
  invalid(() => registrationPlan({ ...base, manifestPath: 'native-host.json' }), 'invalid_manifest_path');
  invalid(() => registrationPlan({ ...base, manifestPath: path.join(root, 'absent.json') }), 'invalid_manifest_path');
  invalid(() => registrationPlan({ ...base, manifestPath: root }), 'invalid_manifest_path');
  invalid(() => registrationPlan({ ...base, manifestPath: 7 }), 'invalid_manifest_path');
  assert.equal(registrationPlan({ ...base, manifestPath: file }).regSzValue, file);
});

test('registration plan rejects wildcard, unslashed and non-extension origins', t => {
  const { file } = manifest(t);
  const base = { name: HOST, hive: 'HKCU', view: '32', manifestPath: file };
  for (const value of ['chrome-extension://*/', 'chrome-extension://' + extensionId,
    'chrome-extension://' + extensionId.toUpperCase() + '/',
    'chrome-extension://' + 'z'.repeat(32) + '/',
    'http://' + extensionId + '/', undefined]) {
    invalid(() => registrationPlan({ ...base, origin: value }), 'invalid_origin');
  }
});

test('registration plan rejects unknown hives and views without echoing them', t => {
  const { file } = manifest(t);
  const base = { name: HOST, manifestPath: file, origin };
  for (const hive of ['hkcu', 'HKCR', 'HKLM ', '']) {
    invalid(() => registrationPlan({ ...base, hive, view: '32' }), 'invalid_registry_hive');
  }
  for (const view of ['64bit', 'x86', ' 32', '', 32]) {
    invalid(() => registrationPlan({ ...base, hive: 'HKCU', view }), 'invalid_registry_view');
  }
});
