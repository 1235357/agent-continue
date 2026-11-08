import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const windows = process.platform === 'win32';
const probe = fileURLToPath(new URL('../scripts/Read-WindowsInteractiveSessionEvidence.ps1', import.meta.url));
const anchorFixtures = fileURLToPath(new URL('./windows-logon-anchor-fixtures.ps1', import.meta.url));
const windowsPowerShell = path.join(process.env.SystemRoot || '', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const unavailable = { version: 1, available: false, reason: 'session_evidence_unavailable' };
const anchorArgs = ['-File', probe, '-RequireLogonAnchor', '-Verbose'];
const tagPattern = /^[a-f0-9]{64}$/;

function assertReceiptKeys(value, keys) {
  assert.ok(value && typeof value === 'object' && Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key)), 'probe must emit only the closed receipt fields');
}

function observe(shell, args = ['-File', probe], extraEnvironment = {}, mode = 'session') {
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', ...args], {
    env: { ...process.env, ...extraEnvironment }, windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 8192,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.ok(!result.stderr, 'probe must not emit raw diagnostics');
  const raw = result.stdout.trim();
  let value;
  try { value = JSON.parse(raw); } catch { assert.fail('probe must emit one JSON receipt'); }
  assert.ok(value?.version === 1, 'expected a version 1 receipt');
  if (value.available === true) {
    assert.equal(result.status, 0);
    const keys = ['available', 'kind', 'sessionTag', 'version'];
    if (mode !== 'session') keys.push('logonAnchor');
    if (mode === 'comparison') keys.push('logonOrder');
    if (mode === 'boundary') keys.push('pauseBoundary');
    assertReceiptKeys(value, keys);
    assert.ok(value.kind === 'console' || value.kind === 'remote-desktop');
    assert.ok(typeof value.sessionTag === 'string' && tagPattern.test(value.sessionTag), 'expected a bounded session tag');
    if (mode !== 'session') {
      assertReceiptKeys(value.logonAnchor, ['recordId', 'recordTag', 'ownerTag']);
      assert.ok(Number.isSafeInteger(value.logonAnchor.recordId) && value.logonAnchor.recordId > 0);
      for (const key of ['recordTag', 'ownerTag']) {
        assert.ok(typeof value.logonAnchor[key] === 'string' && tagPattern.test(value.logonAnchor[key]),
          `expected a bounded ${key}`);
      }
    }
    if (mode === 'boundary') {
      const boundary = value.pauseBoundary;
      assertReceiptKeys(boundary, ['recordId', 'recordTag', 'observedUtcTicks']);
      assert.ok(Number.isSafeInteger(boundary.recordId) && boundary.recordId >= value.logonAnchor.recordId);
      assert.ok(typeof boundary.recordTag === 'string' && tagPattern.test(boundary.recordTag));
      assert.ok(typeof boundary.observedUtcTicks === 'string' && /^[1-9][0-9]{0,17}$/.test(boundary.observedUtcTicks));
    }
  } else {
    assert.equal(result.status, 1);
    assertReceiptKeys(value, ['version', 'available', 'reason']);
    assert.ok(value.available === false && (value.reason === unavailable.reason ||
      (mode !== 'session' && value.reason === 'logon_anchor_unavailable')), 'expected a fixed unavailable reason');
  }
  return value;
}

test('independent Windows processes observe the same desktop session, not ambient environment values', { skip: !windows }, t => {
  const baseline = observe(windowsPowerShell);
  if (!baseline.available) {
    assert.notEqual(process.env.AGENT_CONTINUE_REQUIRE_INTERACTIVE_SESSION, '1', 'this run requires live interactive evidence');
    t.skip('no eligible desktop session for this runner; closed refusal verified');
    return;
  }
  const environment = { USERNAME: 'untrusted-fixture-user', USERDOMAIN: 'UNTRUSTED-FIXTURE',
    SESSIONNAME: 'untrusted-fixture-session' };
  const shells = [windowsPowerShell, process.env.AGENT_CONTINUE_TEST_PWSH || windowsPowerShell];
  for (const shell of shells) {
    const next = observe(shell, ['-File', probe], environment);
    assert.ok(next.available && next.kind === baseline.kind && next.sessionTag === baseline.sessionTag,
      'process or environment change must not mint a new session tag');
  }
});

test('an unavailable Win32 probe fails with a fixed receipt and no session tag', { skip: !windows }, () => {
  const blocked = observe(windowsPowerShell,
    ['-Command', "$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'; & $env:AC_SESSION_PROBE_FILE"],
    { AC_SESSION_PROBE_FILE: probe });
  assert.deepEqual(blocked, unavailable);
});

test('a retained login anchor compares as same across independent PowerShell processes', { skip: !windows }, t => {
  const baseline = observe(windowsPowerShell, anchorArgs, {}, 'anchor');
  if (!baseline.available) {
    assert.notEqual(process.env.AGENT_CONTINUE_REQUIRE_LOGON_ANCHOR, '1', 'this run requires a retained live login anchor');
    t.skip('no matching retained logon event for this runner; closed refusal verified');
    return;
  }
  const shell = process.env.AGENT_CONTINUE_TEST_PWSH || windowsPowerShell;
  const prior = baseline.logonAnchor;
  const compare = (recordTag = prior.recordTag, ownerTag = prior.ownerTag) => observe(shell, [
    ...anchorArgs, '-PriorRecordId', String(prior.recordId), '-PriorRecordTag', recordTag,
    '-PriorSessionTag', baseline.sessionTag, '-PriorOwnerTag', ownerTag,
  ], {}, 'comparison');
  const next = compare();
  assert.ok(next.available && next.logonOrder === 'same' && next.kind === baseline.kind &&
    next.sessionTag === baseline.sessionTag && next.logonAnchor.recordId === prior.recordId &&
    next.logonAnchor.recordTag === prior.recordTag && next.logonAnchor.ownerTag === prior.ownerTag,
    're-observing one session must report same without minting new login evidence');

  const differentTag = tag => (tag[0] === '0' ? '1' : '0') + tag.slice(1);
  assert.ok(compare(differentTag(prior.recordTag)).reason === 'logon_anchor_unavailable',
    'a forged record tag must return the fixed anchor refusal');
  assert.ok(compare(prior.recordTag, differentTag(prior.ownerTag)).reason === 'logon_anchor_unavailable',
    'a mismatched owner tag must return the fixed anchor refusal');
});

test('incomplete prior anchor input fails without revealing any prior fields', { skip: !windows }, () => {
  const result = observe(windowsPowerShell, [
    ...anchorArgs, '-PriorRecordId', '1', '-PriorRecordTag', 'a'.repeat(64), '-PriorSessionTag', 'b'.repeat(64),
  ], {}, 'comparison');
  assert.ok(result.reason === 'logon_anchor_unavailable', 'incomplete input must return the fixed anchor refusal');
});

test('a pause-time checkpoint does not promote a restart in the same real session', { skip: !windows }, t => {
  const captured = observe(windowsPowerShell, [...anchorArgs, '-CapturePauseBoundary'], {}, 'boundary');
  if (!captured.available) {
    assert.notEqual(process.env.AGENT_CONTINUE_REQUIRE_LOGON_ANCHOR, '1', 'this run requires a real pause checkpoint');
    t.skip('no pause checkpoint for this runner; closed refusal verified');
    return;
  }
  const { logonAnchor: prior, pauseBoundary: pause } = captured;
  const shell = process.env.AGENT_CONTINUE_TEST_PWSH || windowsPowerShell;
  const args = [...anchorArgs, '-PriorRecordId', String(prior.recordId), '-PriorRecordTag', prior.recordTag,
    '-PriorSessionTag', captured.sessionTag, '-PriorOwnerTag', prior.ownerTag, '-PauseRecordId', String(pause.recordId),
    '-PauseObservedUtcTicks', pause.observedUtcTicks];
  const checked = observe(shell, [...args, '-PauseRecordTag', pause.recordTag], {}, 'comparison');
  assert.ok(checked.available && checked.logonOrder === 'same', 'same session must not become a candidate after pause');
  const alteredTag = (pause.recordTag[0] === '0' ? '1' : '0') + pause.recordTag.slice(1);
  assert.ok(observe(shell, [...args, '-PauseRecordTag', alteredTag], {}, 'comparison').reason === 'logon_anchor_unavailable',
    'changed boundary must fail closed');
  assert.ok(observe(shell, args, {}, 'comparison').reason === 'logon_anchor_unavailable', 'partial boundary must fail closed');
});

test('anchor matcher rejects logon lookalikes, missing readback, and late ambiguity', { skip: !windows }, () => {
  const result = spawnSync(windowsPowerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', anchorFixtures],
    { windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 8192 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'windows-logon-anchor-fixtures=pass');
});
