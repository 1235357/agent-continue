import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registrationPlan } from './registration-plan.mjs';
import { issueRegistrationConsent, writeRegistration } from './registration-writer.mjs';

const HOST = 'com.agentcontinue.device_control';
const origin = 'chrome-extension://' + 'a'.repeat(32) + '/';

test('manifest changes during registry inspection prevent writing or reporting already-present', t => {
  for (const present of [false, true]) {
    const plan = planFor(t), consent = issueRegistrationConsent({ plan, now: 100 });
    let writes = 0;
    const registry = {
      get() { fs.writeFileSync(plan.regSzValue, '{"replaced":true}'); return present ? plan.regSzValue : null; },
      set() { writes++; }, remove() {},
    };
    assert.throws(() => writeRegistration({ plan, consent, now: 101, registry,
      echo: { keyPath: plan.keyPath, regSzValue: plan.regSzValue } }), /invalid_plan/);
    assert.equal(writes, 0);
  }
});

function manifest(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aco-writer-'));
  const file = path.join(root, 'native-host.json');
  fs.writeFileSync(file, '{}\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return file;
}

function planFor(t, overrides = {}) {
  return registrationPlan({ name: HOST, hive: 'HKCU', view: '32',
    manifestPath: manifest(t), origin, ...overrides });
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

const invalid = (run, code) => assert.throws(run, error => error?.message === code, code);

test('writer stores the planned REG_SZ value after verified consent and echo', t => {
  const plan = planFor(t), registry = fakeRegistry();
  const consent = issueRegistrationConsent({ plan, now: 1_000, ttlMs: 60_000 });
  const result = writeRegistration({ plan, consent, registry, now: 1_100,
    echo: { keyPath: plan.keyPath, regSzValue: plan.regSzValue } });
  assert.equal(result.status, 'written');
  assert.equal(result.keyPath, plan.keyPath);
  assert.equal(result.view, '32');
  assert.equal(registry.snapshot(), plan.regSzValue);
  assert.equal(registry.calls.set, 1);
});

test('writer is idempotent when the same target already holds the same value', t => {
  const plan = planFor(t), registry = fakeRegistry(plan.regSzValue);
  const consent = issueRegistrationConsent({ plan, now: 2_000, ttlMs: 60_000 });
  const result = writeRegistration({ plan, consent, registry, now: 2_100,
    echo: { keyPath: plan.keyPath, regSzValue: plan.regSzValue } });
  assert.equal(result.status, 'already-present');
  assert.equal(registry.calls.set, 0);
});

test('writer refuses to overwrite a different existing value', t => {
  const plan = planFor(t), registry = fakeRegistry('C:\\other\\manifest.json');
  const consent = issueRegistrationConsent({ plan, now: 3_000, ttlMs: 60_000 });
  invalid(() => writeRegistration({ plan, consent, registry, now: 3_100,
    echo: { keyPath: plan.keyPath, regSzValue: plan.regSzValue } }), 'registration_conflict');
  assert.equal(registry.calls.set, 0);
  assert.equal(registry.snapshot(), 'C:\\other\\manifest.json');
});

test('writer rejects missing, forged, expired and plan-mismatched consent', t => {
  const plan = planFor(t), registry = fakeRegistry();
  const echo = { keyPath: plan.keyPath, regSzValue: plan.regSzValue };
  invalid(() => writeRegistration({ plan, registry, now: 4_000, echo }), 'invalid_consent');
  invalid(() => writeRegistration({ plan, registry, now: 4_000, echo,
    consent: { keyPath: plan.keyPath, regSzValue: plan.regSzValue, hive: 'HKCU', view: '32', expiresAt: 9_999 } }),
  'invalid_consent');
  const expired = issueRegistrationConsent({ plan, now: 5_000, ttlMs: 1_000 });
  invalid(() => writeRegistration({ plan, consent: expired, registry, now: 6_001, echo }), 'expired_consent');
  const otherPlan = planFor(t, { hive: 'HKLM' });
  const bound = issueRegistrationConsent({ plan: otherPlan, now: 7_000, ttlMs: 60_000 });
  invalid(() => writeRegistration({ plan, consent: bound, registry, now: 7_100, echo }), 'consent_mismatch');
  const viewPlan = registrationPlan({ name: HOST, hive: 'HKCU', view: '64',
    manifestPath: plan.regSzValue, origin });
  const viewConsent = issueRegistrationConsent({ plan: viewPlan, now: 7_200, ttlMs: 60_000 });
  invalid(() => writeRegistration({ plan, consent: viewConsent, registry, now: 7_300, echo }), 'consent_mismatch');
});

test('writer rejects any echo drift in key path or REG_SZ value', t => {
  const plan = planFor(t), registry = fakeRegistry();
  const consent = issueRegistrationConsent({ plan, now: 8_000, ttlMs: 60_000 });
  const base = { plan, consent, registry, now: 8_100 };
  for (const echo of [
    { keyPath: plan.keyPath.replace('HKCU', 'HKLM'), regSzValue: plan.regSzValue },
    { keyPath: plan.keyPath, regSzValue: plan.regSzValue + ' ' },
    { keyPath: plan.keyPath, regSzValue: plan.regSzValue.slice(0, -1) },
    { keyPath: plan.keyPath },
    { keyPath: plan.keyPath, regSzValue: plan.regSzValue, extra: true },
  ]) invalid(() => writeRegistration({ ...base, echo }), 'echo_mismatch');
  assert.equal(registry.calls.set, 0);
});

test('writer treats a mismatched read-back as failure and rolls the fake back', t => {
  const plan = planFor(t), registry = fakeRegistry(null, { tamper: true });
  const consent = issueRegistrationConsent({ plan, now: 9_000, ttlMs: 60_000 });
  invalid(() => writeRegistration({ plan, consent, registry, now: 9_100,
    echo: { keyPath: plan.keyPath, regSzValue: plan.regSzValue } }),
  'registration_readback_mismatch');
  assert.equal(registry.calls.remove, 1);
  assert.equal(registry.snapshot(), null);
});

test('writer revalidates the plan and rejects forged targets', t => {
  const plan = planFor(t), registry = fakeRegistry();
  const consent = issueRegistrationConsent({ plan, now: 10_000, ttlMs: 60_000 });
  const forged = Object.freeze({ ...plan, keyPath: plan.keyPath + 'x' });
  invalid(() => writeRegistration({ plan: forged, consent, registry, now: 10_100,
    echo: { keyPath: forged.keyPath, regSzValue: forged.regSzValue } }), 'invalid_plan');
});
