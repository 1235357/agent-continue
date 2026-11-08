import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { administratorControlSupport } from '../admin-control.js';
import { isAdministratorControlSupport } from '../native/desktop-commander/windows-admin-browser-host.mjs';

const ledgerFixture = fileURLToPath(new URL('./windows-admin-control-ledger-tests.ps1', import.meta.url));
const identityFixture = fileURLToPath(new URL('./windows-admin-control-identity-tests.ps1', import.meta.url));
const storeFixture = fileURLToPath(new URL('./windows-admin-control-store-tests.ps1', import.meta.url));
const progressFixture = fileURLToPath(new URL('./windows-admin-verification-progress-tests.ps1', import.meta.url));
const operationFixture = fileURLToPath(new URL('./windows-admin-control-operation-tests.ps1', import.meta.url));
const runnerFixture = fileURLToPath(new URL('./windows-admin-control-runner-tests.ps1', import.meta.url));
const observationFixture = fileURLToPath(new URL('./windows-admin-control-observation-tests.ps1', import.meta.url));
const peerFixture = fileURLToPath(new URL('./windows-admin-control-peer-tests.ps1', import.meta.url));
const peerBindingFixture = fileURLToPath(new URL('./windows-admin-control-peer-binding-tests.ps1', import.meta.url));
const peerProjectionFixture = fileURLToPath(new URL('./windows-admin-control-peer-projection-tests.ps1', import.meta.url));
const handoffFixture = fileURLToPath(new URL('./windows-admin-control-handoff-tests.ps1', import.meta.url));
const entryFixture = fileURLToPath(new URL('./windows-admin-control-entry-tests.ps1', import.meta.url));
const entryAuditFixture = fileURLToPath(new URL('./windows-admin-control-entry-audit-tests.ps1', import.meta.url));
const supportFixture = fileURLToPath(new URL('./windows-admin-control-support-tests.ps1', import.meta.url));
const windows = { skip: process.platform !== 'win32', timeout: 65_000 };

function runFixture(fixture) {
  const systemRoot = process.env.SystemRoot;
  assert.ok(systemRoot && path.isAbsolute(systemRoot), 'SystemRoot must identify the trusted Windows directory');
  const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-File', fixture], {
    cwd: path.dirname(fixture),
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      SystemRoot: systemRoot,
      WINDIR: systemRoot,
      PATH: path.join(systemRoot, 'System32'),
      PSModulePath: path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
    },
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.ifError(result.error);
  assert.equal(result.signal, null, output);
  assert.equal(result.status, 0, output);
  return output;
}

test('Windows administrator control ledger: scratch-only PS5.1 fixture (not protected acceptance)', windows, () => {
  const output = runFixture(ledgerFixture);
  assert.match(output, /PASS exhaustive read-state matrix: 6144 combinations/);
  assert.match(output, /PASS immutable publication transition matrix: 363 cases/);
  assert.match(output, /PASS control ledger scratch-only fixture: assertions=\d+; readCombinations=6144; publicationCases=363; protectedAcceptance=false/);
});

test('Windows administrator control pure identity serializers (not OS identity proof)', windows, () => {
  const output = runFixture(identityFixture);
  const result = JSON.parse(output.trim());
  assert.equal(result.ok, true);
  assert.equal(result.scope, 'pure-closed-ledger-serialization-not-os-identity-proof');
  assert.ok(Number.isSafeInteger(result.assertions) && result.assertions >= 67);
});

test('Windows administrator control store: scratch-only immutable records and bounded progress', windows, () => {
  const result = JSON.parse(runFixture(storeFixture).trim());
  assert.equal(result.ok, true);
  assert.equal(result.scope, 'scratch-control-store-not-protected-runtime');
  assert.ok(Number.isSafeInteger(result.checks) && result.checks >= 44);
});

test('Windows full bundle verification emits bounded progress without skipping hashes or closure checks', windows, () => {
  const result = JSON.parse(runFixture(progressFixture).trim());
  assert.equal(result.ok, true);
  assert.equal(result.scope, 'scratch-verifier-progress-not-protected-runtime');
  assert.equal(result.progress, '0,64,128,130');
  assert.equal(result.fullHashesPreserved, true);
  assert.equal(result.tamperAndClosureRefused, true);
});

test('Windows control transactions preserve original IDs, durable phases and Revoke precedence', windows, () => {
  const result = JSON.parse(runFixture(operationFixture).trim().split(/\r?\n/).at(-1));
  assert.equal(result.ok, true);
  assert.equal(result.scope, 'scratch-control-operation-not-installed-runtime');
  assert.ok(result.cases >= 29 && result.checks >= 943);
});

test('Windows runner identity and terminal evidence reject scalar coercion without managing a process', windows, () => {
  const result = JSON.parse(runFixture(runnerFixture).trim().split(/\r?\n/).at(-1));
  assert.equal(result.ok, true);
  assert.equal(result.scope, 'self-process-read-only-and-stub-terminal-not-protected-runtime-or-os-peer-proof');
  assert.ok(result.cases >= 86 && result.checks >= 528);
});

test('Windows control observation preserves original IDs and rejects malformed projections without mutation', windows, () => {
  const result = JSON.parse(runFixture(observationFixture).trim().split(/\r?\n/).at(-1));
  assert.equal(result.ok, true);
  assert.equal(result.scope, 'ast-only-in-memory-observation-not-protected-runtime-os-peer-or-full-stager-proof');
  assert.ok(result.cases >= 417 && result.assertions >= 7093);
  assert.equal(result.failures, 0);
});

test('Windows control peer reads actual self identity and enforces policy without high-pair admission', windows, () => {
  const result = JSON.parse(runFixture(peerFixture).trim());
  assert.equal(result.status, 'GREEN');
  assert.equal(result.scope, 'TEST_ONLY_PS51_SOURCE_IN_MEMORY_SELF_IDENTITY_AND_POLICY');
  assert.ok(result.cases >= 191 && result.assertions >= 10_000);
  assert.equal(result.argvVectors, 22);
  assert.equal(result.failureCount, 0);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.skipped, []);
  assert.equal(typeof result.actualMediumObserved, 'boolean');
  assert.equal(result.actualHighPairObserved, false);
  assert.equal(result.productionAcceptance, false);
  const source = readFileSync(new URL('../native/desktop-commander/windows-browser-peer.cs', import.meta.url));
  assert.equal(result.sourceSha256, createHash('sha256').update(source).digest('hex'));
  if (result.actualMediumObserved) {
    assert.equal(result.observedToken.integrity, 8192);
    assert.equal(result.observedToken.elevated, false);
    assert.equal(result.observedToken.administrator, false);
    assert.ok(result.observedToken.session > 0);
    assert.equal(result.observedToken.selectedUserSid, true);
  }
});

test('Windows stager binds peer source to held archive bytes and preserves compiler/stream lifetime', windows, () => {
  const result = JSON.parse(runFixture(peerBindingFixture).trim().split(/\r?\n/).at(-1));
  assert.equal(result.ok, true);
  assert.equal(result.scope, 'archive-source-and-compiler-scratch-not-protected-runtime');
  assert.ok(Number.isSafeInteger(result.cases) && result.cases >= 37);
  assert.ok(Number.isSafeInteger(result.assertions) && result.assertions >= 133);
  assert.ok(Number.isSafeInteger(result.compilerCases) && result.compilerCases >= 13);
  assert.deepEqual(result.compilerCoverage, [
    'acl-refusal', 'actual-source', 'canonical-directory', 'compiler-error', 'missing-type', 'source-guard',
  ]);
  assert.deepEqual(result.failures, []);
  assert.equal(result.compilerAclStub, true);
  assert.equal(result.fakeTypedPeerProjections, false);
  assert.equal(result.actualHighPair, false);
  assert.equal(result.protectedAcceptance, false);
  for (const [field, source] of [
    ['stagerSha256', '../scripts/Stage-WindowsAdministratorBundle.ps1'],
    ['peerSourceSha256', '../native/desktop-commander/windows-browser-peer.cs'],
  ]) {
    assert.equal(result[field], createHash('sha256').update(readFileSync(new URL(source, import.meta.url))).digest('hex'));
  }
});

test('Windows stager projects typed witnesses without null-target coercion or failed-witness leaks', windows, () => {
  const result = JSON.parse(runFixture(peerProjectionFixture).trim().split(/\r?\n/).at(-1));
  assert.equal(result.ok, true);
  assert.equal(result.scope, 'typed-projection-with-fake-peer-and-actual-medium-refusal-not-high-proof');
  assert.ok(Number.isSafeInteger(result.cases) && result.cases >= 66);
  assert.ok(Number.isSafeInteger(result.assertions) && result.assertions >= 213);
  assert.deepEqual(result.failures, []);
  assert.equal(result.compilerAclStub, true);
  assert.equal(result.fakeTypedPeerProjections, true);
  assert.equal(result.actualHighPair, false);
  assert.equal(result.protectedAcceptance, false);
  assert.equal(result.nativeRequestPolicyValidated, true);
  assert.equal(result.actualMediumAdmissionRefused, true);
  for (const [field, source] of [
    ['stagerSha256', '../scripts/Stage-WindowsAdministratorBundle.ps1'],
    ['peerSourceSha256', '../native/desktop-commander/windows-browser-peer.cs'],
  ]) {
    assert.equal(result[field], createHash('sha256').update(readFileSync(new URL(source, import.meta.url))).digest('hex'));
  }
});

test('Windows durable handoff detaches admission and reads active original operations without replay', windows, () => {
  const result = JSON.parse(runFixture(handoffFixture).trim().split(/\r?\n/).at(-1));
  assert.equal(result.ok, true);
  assert.equal(result.scope, 'scratch-durable-handoff-with-fake-acquisition-not-protected-or-high-pair-proof');
  assert.ok(Number.isSafeInteger(result.cases) && result.cases >= 45);
  assert.ok(Number.isSafeInteger(result.assertions) && result.assertions >= 454);
  assert.deepEqual(result.failures, []);
  assert.equal(result.actualExclusiveLease, true);
  assert.equal(result.aclStub, true);
  assert.equal(result.acquisitionStub, true);
  assert.equal(result.actualHighPair, false);
  assert.equal(result.protectedAcceptance, false);
  assert.deepEqual(result.fixtureSubstitutions, [
    'acl-file-creation', 'owner-identity', 'guard-revision', 'generation-lease-state',
    'lifecycle-intent', 'projection-update', 'revocation-completion', 'task-audit-callbacks',
    'source-compiler-peer-acquisition',
  ]);
  assert.equal(result.stagerSha256, createHash('sha256')
    .update(readFileSync(new URL('../scripts/Stage-WindowsAdministratorBundle.ps1', import.meta.url))).digest('hex'));
});

test('Windows fixed sealed entry and medium ACK waiter preserve identity, lifetime and no-replay boundaries', windows, () => {
  const result = JSON.parse(runFixture(entryFixture).trim().split(/\r?\n/).at(-1));
  assert.equal(result.ok, true);
  assert.equal(result.scope, 'ast-and-scratch-entry-with-owner-os-kernel-task-stubs-not-native-acceptance');
  assert.ok(Number.isSafeInteger(result.cases) && result.cases >= 75);
  assert.ok(Number.isSafeInteger(result.checks) && result.checks >= 646);
  assert.deepEqual(result.failures, []);
  assert.equal(result.actualArchiveFileExclusion, true);
  assert.equal(result.bindingMetadataOracle, true);
  assert.equal(result.actualMediumCallerObserved, true);
  assert.deepEqual(result.fixtureSubstitutions, [
    'process-start-and-wait-handles', 'owner-identity-and-acl', 'registry-and-enrollment-oracle',
    'scheduler-task-and-startup', 'kernel-admission', 'orchestration-full-verifier', 'orchestration-sealed-binding',
  ]);
  assert.equal(result.positiveHighPairStub, true);
  assert.equal(result.actualUac, false);
  assert.equal(result.protectedAcceptance, false);
  assert.equal(result.stagerSha256, createHash('sha256')
    .update(readFileSync(new URL('../scripts/Stage-WindowsAdministratorBundle.ps1', import.meta.url))).digest('hex'));
});

test('Windows early control entry uses the real full ZIP verifier with owned hashing and refuses tamper', windows, () => {
  const result = JSON.parse(runFixture(entryAuditFixture).trim().split(/\r?\n/).at(-1));
  assert.equal(result.ok, true);
  assert.equal(result.scope, 'real-zip-layout-full-verifier-and-hash-with-scratch-acl-and-kernel-owner-task-stubs');
  assert.ok(Number.isSafeInteger(result.cases) && result.cases >= 3);
  assert.ok(Number.isSafeInteger(result.checks) && result.checks >= 56);
  assert.deepEqual(result.failures, []);
  assert.equal(result.realFullVerifier, true);
  assert.equal(result.legacyHashAbsent, true);
  assert.equal(result.actualUac, false);
  assert.equal(result.protectedAcceptance, false);
  assert.equal(result.stagerSha256, createHash('sha256')
    .update(readFileSync(new URL('../scripts/Stage-WindowsAdministratorBundle.ps1', import.meta.url))).digest('hex'));
});

test('Windows read-only support projects saved intent with real atomic public files and both wire decoders', windows, () => {
  const result = JSON.parse(runFixture(supportFixture).trim().split(/\r?\n/).at(-1));
  assert.equal(result.ok, true);
  assert.equal(result.scope, 'ast-and-real-public-file-scratch-with-acl-and-owner-stubs-not-installed-acceptance');
  assert.ok(Number.isSafeInteger(result.cases) && result.cases >= 113);
  assert.ok(Number.isSafeInteger(result.checks) && result.checks >= 267);
  assert.equal(result.realPublicFileReader, true);
  assert.equal(result.realAtomicPublication, true);
  assert.equal(result.aclStub, true);
  assert.equal(result.ownerStateStub, true);
  assert.equal(result.exactAclFormOracle, true);
  assert.equal(result.legacyDenyPreserved, true);
  assert.equal(result.realLegacyGuard, true);
  assert.equal(result.createAndReplaceVerified, true);
  assert.equal(result.publicationFailureReached, true);
  assert.equal(result.actualUac, false);
  assert.equal(result.protectedAcceptance, false);
  assert.equal(result.wireExamples.length, 24);
  for (const reply of result.wireExamples) {
    assert.ok(administratorControlSupport(reply, reply.control));
    assert.equal(isAdministratorControlSupport(reply, reply.control), true);
  }
  assert.equal(result.stagerSha256, createHash('sha256')
    .update(readFileSync(new URL('../scripts/Stage-WindowsAdministratorBundle.ps1', import.meta.url))).digest('hex'));
});
