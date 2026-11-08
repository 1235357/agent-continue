import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registrationPlan } from './registration-plan.mjs';
import { issueRegistrationApproval, runRegistration } from './registration-execution.mjs';

const HOST = 'com.agentcontinue.device_control';
const origin = 'chrome-extension://' + 'a'.repeat(32) + '/';

function planFor(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aco-exec-'));
  const file = path.join(root, 'native-host.json');
  fs.writeFileSync(file, '{}\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return registrationPlan({ name: HOST, hive: 'HKCU', view: '32', manifestPath: file, origin, ...overrides });
}

function fakeRegistry(initial = null, { tamper = false } = {}) {
  let stored = initial;
  const calls = { get: 0, set: 0, remove: 0 };
  return {
    calls,
    get() { calls.get += 1; return stored; },
    set(plan) { calls.set += 1; stored = tamper ? 'tampered-value' : plan.regSzValue; },
    remove() { calls.remove += 1; stored = null; },
    snapshot() { return stored; },
  };
}

const echoFor = plan => ({ keyPath: plan.keyPath, regSzValue: plan.regSzValue });
const invalid = (run, code) => assert.throws(run, error => error?.message === code, code);

function approvals(t, plan, now = 1_000) {
  return [
    issueRegistrationApproval({ plan, issuerId: 'requester', now, ttlMs: 60_000 }),
    issueRegistrationApproval({ plan, issuerId: 'approver', now, ttlMs: 60_000 }),
  ];
}

test('default mode is an inspectable dry run that never touches the registry', t => {
  const plan = planFor(t), registry = fakeRegistry(), grants = approvals(t, plan);
  const result = runRegistration({ plan, approvals: grants, registry, now: 1_100 });
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.keyPath, plan.keyPath);
  assert.equal(result.regSzValue, plan.regSzValue);
  assert.equal(result.hive, 'HKCU');
  assert.equal(result.view, '32');
  assert.deepEqual(result.command, { executable: 'reg.exe', args: plan.addArgs });
  assert.equal(registry.calls.get, 0);
  assert.equal(registry.calls.set, 0);
  const serialized = JSON.stringify(result);
  for (const secret of ['requester', 'approver', 'consent', 'approval', 'expiresAt']) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test('approvals for one extension cannot register another origin at the same path', t => {
  const plan = planFor(t), registry = fakeRegistry(), grants = approvals(t, plan);
  const changed = registrationPlan({ name: HOST, hive: plan.hive, view: plan.view,
    manifestPath: plan.regSzValue, origin: 'chrome-extension://' + 'b'.repeat(32) + '/' });
  invalid(() => runRegistration({ plan: changed, approvals: grants, registry, now: 1100,
    execute: true, echo: echoFor(changed) }), 'approval_mismatch');
  assert.equal(registry.calls.set, 0);
});

test('manifest replacement after approval cannot reach registry writes', t => {
  const plan = planFor(t), registry = fakeRegistry(), grants = approvals(t, plan);
  fs.writeFileSync(plan.regSzValue, '{"changed":true}\n');
  invalid(() => runRegistration({ plan, approvals: grants, registry, now: 1100,
    execute: true, echo: echoFor(plan) }), 'invalid_plan');
  assert.equal(registry.calls.get, 0);
  assert.equal(registry.calls.set, 0);
});

test('missing, forged, expired or duplicate-issuer approvals are rejected in dry run', t => {
  const plan = planFor(t), registry = fakeRegistry(), now = 2_000;
  const [requester, approver] = approvals(t, plan, now);
  invalid(() => runRegistration({ plan, approvals: [requester], registry, now: now + 1 }), 'invalid_approval');
  invalid(() => runRegistration({ plan, approvals: [requester, { ...approver }], registry, now: now + 1 }), 'invalid_approval');
  const same = issueRegistrationApproval({ plan, issuerId: 'requester', now, ttlMs: 60_000 });
  invalid(() => runRegistration({ plan, approvals: [requester, same], registry, now: now + 1 }), 'duplicate_approver');
  const old = issueRegistrationApproval({ plan, issuerId: 'approver', now, ttlMs: 1_000 });
  invalid(() => runRegistration({ plan, approvals: [requester, old], registry, now: now + 1_001 }), 'expired_approval');
  assert.equal(registry.calls.set, 0);
});

test('approvals must agree with the plan byte-for-byte', t => {
  const plan = planFor(t), registry = fakeRegistry(), now = 3_000;
  const [requester] = approvals(t, plan, now);
  const otherHive = planFor(t, { hive: 'HKLM' });
  const wrongHive = issueRegistrationApproval({ plan: otherHive, issuerId: 'approver', now, ttlMs: 60_000 });
  invalid(() => runRegistration({ plan, approvals: [requester, wrongHive], registry, now: now + 1 }), 'approval_mismatch');
  const otherPath = planFor(t);
  const wrongPath = issueRegistrationApproval({ plan: otherPath, issuerId: 'approver', now, ttlMs: 60_000 });
  invalid(() => runRegistration({ plan, approvals: [requester, wrongPath], registry, now: now + 1 }), 'approval_mismatch');
});

test('execution requires both grants plus a boolean execute flag', t => {
  const plan = planFor(t), registry = fakeRegistry(), grants = approvals(t, plan, 4_000);
  invalid(() => runRegistration({ plan, approvals: grants, registry, now: 4_100, execute: 'yes' }), 'invalid_execute_flag');
  invalid(() => runRegistration({ plan, approvals: grants, registry, now: 4_100, execute: 1 }), 'invalid_execute_flag');
  assert.equal(registry.calls.set, 0);
});

test('execute reuses read-before-write, read-back and rollback from the writer', t => {
  const plan = planFor(t), grants = approvals(t, plan, 5_000), echo = echoFor(plan);
  const clean = fakeRegistry();
  const written = runRegistration({ plan, approvals: grants, registry: clean, now: 5_100, execute: true, echo });
  assert.equal(written.mode, 'executed');
  assert.equal(written.status, 'written');
  assert.equal(clean.calls.set, 1);
  assert.equal(clean.snapshot(), plan.regSzValue);
  const conflict = fakeRegistry('C:\\other\\manifest.json');
  invalid(() => runRegistration({ plan, approvals: grants, registry: conflict, now: 5_100, execute: true, echo }), 'registration_conflict');
  assert.equal(conflict.calls.set, 0);
  assert.equal(conflict.snapshot(), 'C:\\other\\manifest.json');
  const tampered = fakeRegistry(null, { tamper: true });
  invalid(() => runRegistration({ plan, approvals: grants, registry: tampered, now: 5_100, execute: true, echo }),
    'registration_readback_mismatch');
  assert.equal(tampered.calls.remove, 1);
  assert.equal(tampered.snapshot(), null);
});

test('execute still refuses echo drift and expired grants', t => {
  const plan = planFor(t), registry = fakeRegistry(), grants = approvals(t, plan, 6_000);
  invalid(() => runRegistration({ plan, approvals: grants, registry, now: 6_100, execute: true,
    echo: { keyPath: plan.keyPath, regSzValue: plan.regSzValue + ' ' } }), 'echo_mismatch');
  const old = issueRegistrationApproval({ plan, issuerId: 'approver', now: 6_000, ttlMs: 1_000 });
  const [requester] = approvals(t, plan, 6_000);
  invalid(() => runRegistration({ plan, approvals: [requester, old], registry, now: 7_100, execute: true,
    echo: echoFor(plan) }), 'expired_approval');
  assert.equal(registry.calls.set, 0);
});
