import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registrationPlan } from './registration-plan.mjs';
import { issueRegistrationApproval, runRegistration } from './registration-execution.mjs';
import { renderRegistrationDisplay } from './registration-render.mjs';

const HOST = 'com.agentcontinue.device_control';
const origin = 'chrome-extension://' + 'a'.repeat(32) + '/';
const displayKeys = ['format', 'version', 'mode', 'hostName', 'hive', 'view', 'keyPath',
  'regSzValue', 'command', 'text'];

function plan(t, hive = 'HKCU', view = '32') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aco-registration-render-'));
  const manifest = path.join(root, 'native-host.json');
  fs.writeFileSync(manifest, JSON.stringify({
    name: HOST, description: 'Agent Continue device lifecycle bridge',
    path: path.join(root, 'native-launcher.exe'), type: 'stdio', allowed_origins: [origin] }) + '\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return registrationPlan({ name: HOST, hive, view, manifestPath: manifest, origin });
}

const forbidden = () => { throw new Error('renderer must not touch the registry'); };
const registry = { get: forbidden, set: forbidden, remove: forbidden };

function dryRun(t, hive = 'HKCU', view = '32') {
  const value = plan(t, hive, view);
  const now = 1000;
  const approvals = [
    issueRegistrationApproval({ plan: value, issuerId: 'alpha', now }),
    issueRegistrationApproval({ plan: value, issuerId: 'beta', now, ttlMs: 90_000 }),
  ];
  return runRegistration({ plan: value, approvals, now: now + 1, registry });
}

const invalid = (run, code) => assert.throws(run, error => error?.message === code, code);

test('renders the exact preview text for a dry-run result', t => {
  const result = dryRun(t);
  assert.equal(result.mode, 'dry-run');
  const display = renderRegistrationDisplay(result);
  assert.deepEqual(Object.keys(display), displayKeys);
  assert.equal(display.format, 'agent-continue-registration-display');
  assert.equal(display.version, 1);
  assert.equal(display.mode, 'dry-run');
  assert.equal(display.hostName, HOST);
  assert.equal(display.hive, 'HKCU');
  assert.equal(display.view, '32');
  assert.equal(display.keyPath, result.keyPath);
  assert.equal(display.regSzValue, result.regSzValue);
  assert.equal(display.command.executable, 'reg.exe');
  assert.deepEqual(display.command.args, result.command.args);
  assert.equal(display.text, [
    'Registration preview only - no registry write has been performed.',
    'Host: ' + HOST,
    'Hive: HKCU',
    'View: 32-bit',
    'Key: ' + result.keyPath,
    'REG_SZ: ' + result.regSzValue,
    'Command: reg.exe ' + result.command.args.join(' '),
  ].join('\n') + '\n');
  assert.ok(Object.isFrozen(display));
  assert.ok(Object.isFrozen(display.command));
  assert.ok(Object.isFrozen(display.command.args));
});

test('renders both hives and both views with their exact registry view suffix', t => {
  for (const hive of ['HKCU', 'HKLM']) for (const view of ['32', '64']) {
    const result = dryRun(t, hive, view);
    const display = renderRegistrationDisplay(result);
    assert.equal(display.hive, hive);
    assert.equal(display.view, view);
    assert.equal(display.keyPath, hive + '\\Software\\Google\\Chrome\\NativeMessagingHosts\\' + HOST);
    assert.ok(display.text.includes('Hive: ' + hive + '\n'));
    assert.ok(display.text.includes('View: ' + view + '-bit\n'));
    assert.ok(display.text.includes('Command: reg.exe add ' + display.keyPath));
    assert.ok(display.text.includes('/d ' + display.regSzValue + ' /f /reg:' + view + '\n'));
  }
});

test('refuses a result that is not exactly the seven-key dry-run record', t => {
  const valid = dryRun(t);
  for (const value of [null, undefined, 1, 'dry-run', true, [], () => {}, new Date(),
    Object.create({ mode: 'dry-run' })]) invalid(() => renderRegistrationDisplay(value), 'invalid_dry_run');
  invalid(() => renderRegistrationDisplay({ ...valid, mode: 'executed' }), 'invalid_dry_run');
  invalid(() => renderRegistrationDisplay({ mode: 'executed', status: 'written',
    hostName: HOST, hive: 'HKCU', view: '32', keyPath: valid.keyPath,
    regSzValue: valid.regSzValue, command: valid.command }), 'invalid_dry_run');
  for (const extra of [{ execute: true }, { execute: 'yes' }, { consent: {} },
    { approval: 'granted' }, { issuerId: 'alpha' }, { expiresAt: 99 }, { status: 'written' }]) {
    invalid(() => renderRegistrationDisplay({ ...valid, ...extra }), 'invalid_dry_run');
  }
  for (const key of ['mode', 'hostName', 'hive', 'view', 'keyPath', 'regSzValue', 'command']) {
    const copy = Object.fromEntries(Object.entries(valid).filter(([name]) => name !== key));
    invalid(() => renderRegistrationDisplay(copy), 'invalid_dry_run');
  }
});

test('refuses wrong field types instead of widening the render', t => {
  const valid = dryRun(t);
  for (const [field, value] of [['hostName', 42], ['hostName', HOST + 'x'],
    ['hive', 'hkcu'], ['hive', 'HKCU '], ['view', 32], ['view', '31'],
    ['keyPath', null], ['keyPath', 7], ['regSzValue', ''], ['regSzValue', 7],
    ['regSzValue', ' ' + valid.regSzValue], ['regSzValue', valid.regSzValue + '\n']]) {
    invalid(() => renderRegistrationDisplay({ ...valid, [field]: value }), 'invalid_dry_run');
  }
  for (const command of [null, undefined, [], 'reg.exe add', { args: valid.command.args },
    { executable: 'reg.exe' }, { executable: 'reg', args: valid.command.args },
    { executable: 'reg.exe', args: 'add' },
    { executable: 'reg.exe', args: valid.command.args.slice(), extra: 1 }]) {
    invalid(() => renderRegistrationDisplay({ ...valid, command }), 'invalid_dry_run');
  }
  const numeric = { executable: 'reg.exe', args: [...valid.command.args] };
  numeric.args[3] = 3;
  invalid(() => renderRegistrationDisplay({ ...valid, command: numeric }), 'invalid_dry_run');
  const shortcut = { executable: 'reg.exe', args: valid.command.args.slice(0, 8) };
  invalid(() => renderRegistrationDisplay({ ...valid, command: shortcut }), 'invalid_dry_run');
});

test('refuses any drift between the key path, hive, view and reg.exe arguments', t => {
  const valid = dryRun(t);
  invalid(() => renderRegistrationDisplay({ ...valid,
    keyPath: valid.keyPath.replace('HKCU', 'HKLM') }), 'invalid_dry_run_binding');
  invalid(() => renderRegistrationDisplay({ ...valid,
    keyPath: valid.keyPath.replace(HOST, HOST + '_x') }), 'invalid_dry_run_binding');
  const cases = [
    args => { args[0] = 'query'; },
    args => { args[1] = args[1] + 'x'; },
    args => { args[3] = 'REG_EXPAND_SZ'; },
    args => { args[6] = args[6] + 'x'; },
    args => { args[8] = '/reg:64'; },
  ];
  for (const change of cases) {
    const args = [...valid.command.args];
    change(args);
    invalid(() => renderRegistrationDisplay({ ...valid,
      command: { executable: 'reg.exe', args } }), 'invalid_dry_run_binding');
  }
});

test('preview text carries no credential or approval material', t => {
  const display = renderRegistrationDisplay(dryRun(t));
  for (const word of ['consent', 'approval', 'approver', 'issuer', 'expires', 'nonce', 'token']) {
    assert.equal(display.text.includes(word), false, word);
    assert.equal(JSON.stringify(display).includes(word), false, word);
  }
  assert.equal(display.text.trimEnd().split('\n').length, 7);
});
