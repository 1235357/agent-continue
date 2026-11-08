import { registrationPlan } from './registration-plan.mjs';

const fail = code => { throw new Error(code); };
const consents = new WeakMap();
const boundFields = ['keyPath', 'regSzValue', 'hive', 'view', 'origin', 'manifestSha256'];

export function issueRegistrationConsent({ plan, now, ttlMs = 300_000 } = {}) {
  if (!Number.isFinite(now) || now < 0) fail('invalid_consent_time');
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) fail('invalid_consent_ttl');
  const expected = revalidate(plan);
  const granted = {
    keyPath: expected.keyPath, regSzValue: expected.regSzValue,
    hive: expected.hive, view: expected.view, origin: expected.origin, manifestSha256: expected.manifestSha256, expiresAt: now + ttlMs,
  };
  const consent = Object.freeze(granted);
  consents.set(consent, granted);
  return consent;
}

export function writeRegistration({ plan, consent, echo, registry, now }) {
  const expected = revalidate(plan);
  if (!consent || typeof consent !== 'object' || !consents.has(consent)) fail('invalid_consent');
  const granted = consents.get(consent);
  if (!Number.isFinite(now)) fail('invalid_consent_time');
  if (now >= granted.expiresAt) fail('expired_consent');
  for (const field of boundFields) if (granted[field] !== expected[field]) fail('consent_mismatch');
  if (!echo || typeof echo !== 'object' || Object.keys(echo).length !== 2
    || !Object.hasOwn(echo, 'keyPath') || !Object.hasOwn(echo, 'regSzValue')
    || echo.keyPath !== expected.keyPath || echo.regSzValue !== expected.regSzValue) fail('echo_mismatch');
  if (!registry || typeof registry.get !== 'function' || typeof registry.set !== 'function'
    || typeof registry.remove !== 'function') fail('invalid_registry');
  const existing = registry.get(expected);
  revalidate(expected);
  if (existing !== null && typeof existing !== 'string') fail('invalid_registry');
  if (existing !== null) {
    if (existing === expected.regSzValue) {
      return Object.freeze({ status: 'already-present', keyPath: expected.keyPath,
        regSzValue: expected.regSzValue, hive: expected.hive, view: expected.view });
    }
    fail('registration_conflict');
  }
  try { registry.set(expected); } catch {
    try { registry.remove(expected); } catch { /* rollback is best effort */ }
    fail('registration_write_failed');
  }
  let readback;
  try { readback = registry.get(expected); } catch {
    try { registry.remove(expected); } catch { /* rollback is best effort */ }
    fail('registration_readback_failed');
  }
  if (readback !== expected.regSzValue) {
    try { registry.remove(expected); } catch { /* rollback is best effort */ }
    fail('registration_readback_mismatch');
  }
  revalidate(expected);
  return Object.freeze({ status: 'written', keyPath: expected.keyPath,
    regSzValue: expected.regSzValue, hive: expected.hive, view: expected.view });
}

function revalidate(plan) {
  if (!plan || typeof plan !== 'object') fail('invalid_plan');
  let expected;
  try {
    expected = registrationPlan({ name: plan.name, hive: plan.hive, view: plan.view,
      manifestPath: plan.regSzValue, origin: plan.origin });
  } catch { fail('invalid_plan'); }
  if (expected.keyPath !== plan.keyPath || expected.regSzValue !== plan.regSzValue
    || expected.hive !== plan.hive || expected.view !== plan.view
    || expected.name !== plan.name || expected.origin !== plan.origin || expected.manifestSha256 !== plan.manifestSha256) fail('invalid_plan');
  return expected;
}
