import { registrationPlan } from './registration-plan.mjs';
import { issueRegistrationConsent, writeRegistration } from './registration-writer.mjs';

const fail = code => { throw new Error(code); };
const approvals = new WeakMap();
const boundFields = ['keyPath', 'regSzValue', 'hive', 'view', 'origin', 'manifestSha256'];

export function issueRegistrationApproval({ plan, issuerId, now, ttlMs = 120_000 } = {}) {
  if (typeof issuerId !== 'string' || issuerId.length === 0) fail('invalid_approver_id');
  if (!Number.isFinite(now) || now < 0) fail('invalid_approval_time');
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) fail('invalid_approval_ttl');
  const expected = revalidate(plan);
  const approval = Object.freeze({
    issuerId, keyPath: expected.keyPath, regSzValue: expected.regSzValue,
    hive: expected.hive, view: expected.view, origin: expected.origin, manifestSha256: expected.manifestSha256, expiresAt: now + ttlMs,
  });
  approvals.set(approval, approval);
  return approval;
}

export function runRegistration({ plan, approvals: grants, registry, now, execute = false, echo }) {
  const expected = revalidate(plan);
  if (typeof execute !== 'boolean') fail('invalid_execute_flag');
  if (!Array.isArray(grants) || grants.length !== 2) fail('invalid_approval');
  for (const grant of grants) {
    if (!grant || typeof grant !== 'object' || !approvals.has(grant)) fail('invalid_approval');
  }
  if (!Number.isFinite(now)) fail('invalid_approval_time');
  for (const grant of grants) if (now >= grant.expiresAt) fail('expired_approval');
  const [first, second] = grants;
  if (first.issuerId === second.issuerId) fail('duplicate_approver');
  for (const field of boundFields) {
    if (first[field] !== expected[field] || second[field] !== expected[field]
      || first[field] !== second[field]) fail('approval_mismatch');
  }
  if (!execute) {
    return Object.freeze({
      mode: 'dry-run', hostName: expected.name, hive: expected.hive, view: expected.view,
      keyPath: expected.keyPath, regSzValue: expected.regSzValue,
      command: Object.freeze({ executable: 'reg.exe', args: expected.addArgs }),
    });
  }
  const consent = issueRegistrationConsent({ plan: expected, now });
  const outcome = writeRegistration({ plan: expected, consent, echo, registry, now });
  return Object.freeze({ mode: 'executed', ...outcome });
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
