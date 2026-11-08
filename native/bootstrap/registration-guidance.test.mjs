import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registrationPlan } from './registration-plan.mjs';
import { issueRegistrationApproval, runRegistration } from './registration-execution.mjs';
import { renderRegistrationDisplay } from './registration-render.mjs';
import { buildFirstInstallGuidance, buildPendingFirstInstallGuidance } from './registration-guidance.mjs';

const HOST = 'com.agentcontinue.device_control';
const origin = 'chrome-extension://' + 'a'.repeat(32) + '/';
const PLACEHOLDER = '<absolute manifest path supplied by the reviewed installer>';
const guidanceKeys = ['format', 'version', 'valueKind', 'status', 'statusLabel', 'hostName',
  'hive', 'view', 'keyPath', 'regSzValue', 'command', 'text'];

function plan(t, hive = 'HKCU', view = '32') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aco-registration-guidance-'));
  const manifest = path.join(root, 'native-host.json');
  fs.writeFileSync(manifest, JSON.stringify({
    name: HOST, description: 'Agent Continue device lifecycle bridge',
    path: path.join(root, 'native-launcher.exe'), type: 'stdio', allowed_origins: [origin] }) + '\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return registrationPlan({ name: HOST, hive, view, manifestPath: manifest, origin });
}

function countingRegistry() {
  const calls = { get: 0, set: 0, remove: 0 };
  let stored = null;
  return {
    calls,
    get() { calls.get += 1; return stored; },
    set(value) { calls.set += 1; stored = value.regSzValue; },
    remove() { calls.remove += 1; stored = null; },
  };
}

function display(t, hive = 'HKCU', view = '32') {
  const registry = countingRegistry();
  const value = plan(t, hive, view);
  const now = 1000;
  const approvals = [
    issueRegistrationApproval({ plan: value, issuerId: 'alpha', now }),
    issueRegistrationApproval({ plan: value, issuerId: 'beta', now, ttlMs: 90_000 }),
  ];
  const result = runRegistration({ plan: value, approvals, now: now + 1, registry });
  assert.deepEqual(registry.calls, { get: 0, set: 0, remove: 0 });
  return { display: renderRegistrationDisplay(result), registry };
}

const invalid = (run, code) => assert.throws(run, error => error?.message === code, code);

test('builds the read-only first-install guidance from an exact dry-run display', t => {
  const { display: rendered, registry } = display(t);
  const guidance = buildFirstInstallGuidance({ display: rendered, registrationStatus: 'not-registered' });
  assert.deepEqual(Object.keys(guidance), guidanceKeys);
  assert.equal(guidance.format, 'agent-continue-first-install-guidance');
  assert.equal(guidance.version, 1);
  assert.equal(guidance.valueKind, 'exact');
  assert.equal(guidance.status, 'not-registered');
  assert.equal(guidance.statusLabel, 'Registration status: not registered. Nothing has been written.');
  assert.equal(guidance.hostName, HOST);
  assert.equal(guidance.hive, 'HKCU');
  assert.equal(guidance.view, '32');
  assert.equal(guidance.keyPath, rendered.keyPath);
  assert.equal(guidance.regSzValue, rendered.regSzValue);
  assert.deepEqual(guidance.command.args, rendered.command.args);
  assert.equal(guidance.text, [
    'First-install registration preview (read only)',
    'Status: not registered - nothing has been written to the registry.',
    'Host: ' + HOST,
    'Hive: HKCU',
    'View: 32-bit',
    'Key: ' + rendered.keyPath,
    'REG_SZ: ' + rendered.regSzValue,
    'Command: reg.exe ' + rendered.command.args.join(' '),
  ].join('\n') + '\n');
  assert.deepEqual(registry.calls, { get: 0, set: 0, remove: 0 });
  assert.ok(Object.isFrozen(guidance) && Object.isFrozen(guidance.command));
});

test('builds a placeholder guidance for a page without a reviewed plan', () => {
  for (const [hive, view] of [['HKCU', '32'], ['HKLM', '64']]) {
    const guidance = buildPendingFirstInstallGuidance({ hive, view });
    assert.equal(guidance.format, 'agent-continue-first-install-guidance');
    assert.equal(guidance.valueKind, 'placeholder');
    assert.equal(guidance.status, 'not-registered');
    assert.equal(guidance.hive, hive);
    assert.equal(guidance.view, view);
    assert.equal(guidance.keyPath, hive + '\\Software\\Google\\Chrome\\NativeMessagingHosts\\' + HOST);
    assert.equal(guidance.regSzValue, PLACEHOLDER);
    assert.equal(guidance.command.executable, 'reg.exe');
    assert.deepEqual(guidance.command.args, ['add', guidance.keyPath, '/ve', '/t', 'REG_SZ',
      '/d', PLACEHOLDER, '/f', '/reg:' + view]);
    assert.ok(guidance.text.includes('Hive: ' + hive + '\n'));
    assert.ok(guidance.text.includes('View: ' + view + '-bit\n'));
    assert.ok(guidance.text.includes('REG_SZ: ' + PLACEHOLDER + '\n'));
    assert.ok(guidance.text.includes('Command: reg.exe add ' + guidance.keyPath));
    assert.ok(guidance.text.includes('/d ' + PLACEHOLDER + ' /f /reg:' + view + '\n'));
    assert.equal(/[A-Za-z]:\\/.test(guidance.text), false, 'no invented concrete path');
    assert.ok(Object.isFrozen(guidance.command.args));
  }
});

test('refuses states other than not-registered and refuses an executed result', t => {
  const { display: rendered } = display(t);
  for (const registrationStatus of ['registered', 'written', 'already-present', 'unknown',
    'not-registered ', 'Not-registered', '', null, 1, undefined]) {
    invalid(() => buildFirstInstallGuidance({ display: rendered, registrationStatus }), 'invalid_guidance_input');
  }
  invalid(() => buildFirstInstallGuidance({ display: { ...rendered, mode: 'executed' },
    registrationStatus: 'not-registered' }), 'invalid_guidance_input');
  invalid(() => buildFirstInstallGuidance({ display: rendered }), 'invalid_guidance_input');
  invalid(() => buildFirstInstallGuidance({ display: rendered, registrationStatus: 'not-registered',
    execute: true }), 'invalid_guidance_input');
  invalid(() => buildFirstInstallGuidance({ display: rendered, registrationStatus: 'not-registered',
    extra: 1 }), 'invalid_guidance_input');
  invalid(() => buildPendingFirstInstallGuidance({ hive: 'HKCU', view: '32', extra: 1 }), 'invalid_guidance_input');
  invalid(() => buildPendingFirstInstallGuidance({ hive: 'HKCU' }), 'invalid_guidance_input');
  for (const value of [null, undefined, [], 'HKCU', 1]) {
    invalid(() => buildPendingFirstInstallGuidance(value), 'invalid_guidance_input');
  }
  for (const hive of ['hkcu', 'HKCU ', '', 'HKEY_CURRENT_USER']) {
    invalid(() => buildPendingFirstInstallGuidance({ hive, view: '32' }), 'invalid_guidance_input');
  }
  for (const view of ['31', ' 32', 'x64', 32]) {
    invalid(() => buildPendingFirstInstallGuidance({ hive: 'HKCU', view }), 'invalid_guidance_input');
  }
});

test('refuses a display whose status text, key path or arguments disagree with its fields', t => {
  const { display: rendered } = display(t);
  invalid(() => buildFirstInstallGuidance({ display: { ...rendered,
    text: 'Registration completed.\n' }, registrationStatus: 'not-registered' }), 'invalid_guidance_input');
  invalid(() => buildFirstInstallGuidance({ display: { ...rendered,
    text: rendered.text.replace('Registration preview only', 'Registration succeeded') },
    registrationStatus: 'not-registered' }), 'invalid_guidance_input');
  invalid(() => buildFirstInstallGuidance({ display: { ...rendered,
    text: rendered.text + 'extra line\n' }, registrationStatus: 'not-registered' }), 'invalid_guidance_input');
  invalid(() => buildFirstInstallGuidance({ display: { ...rendered,
    keyPath: rendered.keyPath.replace('HKCU', 'HKLM') }, registrationStatus: 'not-registered' }), 'invalid_guidance_input');
  const args = [...rendered.command.args];
  args[8] = '/reg:64';
  invalid(() => buildFirstInstallGuidance({ display: { ...rendered,
    command: { executable: 'reg.exe', args } }, registrationStatus: 'not-registered' }), 'invalid_guidance_input');
  invalid(() => buildFirstInstallGuidance({ display: { ...rendered,
    command: { executable: 'reg', args: rendered.command.args } },
    registrationStatus: 'not-registered' }), 'invalid_guidance_input');
});

test('refuses missing or extra display fields instead of degrading the block', t => {
  const { display: rendered } = display(t);
  for (const key of Object.keys(rendered)) {
    const copy = Object.fromEntries(Object.entries(rendered).filter(([name]) => name !== key));
    invalid(() => buildFirstInstallGuidance({ display: copy, registrationStatus: 'not-registered' }),
      'invalid_guidance_input');
  }
  invalid(() => buildFirstInstallGuidance({ display: { ...rendered, consent: {} },
    registrationStatus: 'not-registered' }), 'invalid_guidance_input');
  invalid(() => buildFirstInstallGuidance({ display: { ...rendered,
    command: { executable: 'reg.exe', args: [...rendered.command.args], extra: 1 } },
    registrationStatus: 'not-registered' }), 'invalid_guidance_input');
});

test('the guidance path has no execution or registry access at all', () => {
  const source = fs.readFileSync(new URL('./registration-guidance.mjs', import.meta.url), 'utf8');
  for (const word of ['child_process', 'spawn', 'execFile', 'require',
    'registration-writer', 'registration-execution']) {
    assert.equal(source.includes(word), false, word);
  }
  assert.equal(buildFirstInstallGuidance.length > 0, true);
});
