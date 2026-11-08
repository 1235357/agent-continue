import assert from 'node:assert/strict';
import test from 'node:test';
import { administratorControlSupport, administratorControlProgress, administratorControlStatus } from '../admin-control.js';
import { isAdministratorControlSupport, isAdministratorControlProgress,
  isAdministratorControlStatus } from '../native/desktop-commander/windows-admin-browser-host.mjs';

const digest = 'a'.repeat(64), operationId = 'b'.repeat(32), target = 'c'.repeat(32) + ':idle';
const kinds = ['connect', 'resume-saved', 'revoke'];
test('browser and native support decoders agree on the entire state/target/eligibility matrix', () => {
  for (const control of kinds) for (const state of ['supported', 'unconfirmed', 'ready']) {
    for (const ownerState of ['unobserved', 'paused', 'running', 'revoked']) for (const eligible of [false, true]) {
      for (const bundleSha256 of [digest, null, digest + '\n']) for (const binding of [null, target, target + '\n']) {
        const value = { control, state, ownerState, eligible, bundleSha256, target: binding };
        assert.equal(Boolean(administratorControlSupport(value, control)), isAdministratorControlSupport(value, control), JSON.stringify(value));
      }
    }
  }
});
test('browser and native progress decoders agree on phases, safe counts, and extra fields', () => {
  for (const phase of ['verifying-full', 'verifying-control', 'waiting-owner', 'waiting-stop', 'settled', 'ready']) {
    for (const verifiedFiles of [null, 0, 1, 2, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      for (const totalFiles of [null, 0, 1, 100]) {
        const value = { phase, verifiedFiles, totalFiles };
        assert.equal(administratorControlProgress(value) !== undefined, isAdministratorControlProgress(value), JSON.stringify(value));
        assert.equal(administratorControlProgress({ ...value, raw: 'not allowed' }), undefined);
        assert.equal(isAdministratorControlProgress({ ...value, raw: 'not allowed' }), false);
      }
    }
  }
});
test('browser and native receipt decoders agree on action-specific states and identity', () => {
  for (const control of kinds) for (const state of ['unconfirmed', 'reserved', 'intent-saved', 'launch-requested',
    'launch-unconfirmed', 'revocation-recorded', 'stopped', 'superseded', 'rejected', 'fenced', 'abandoned', 'recovered-paused', 'ready']) {
    const expected = { control, bundleSha256: digest, operationId };
    for (const progress of [null, { phase: 'verifying-full', verifiedFiles: 1, totalFiles: 10 },
      { phase: 'settled', verifiedFiles: 1, totalFiles: 10 }]) {
      const value = { ...expected, state, progress };
      assert.equal(Boolean(administratorControlStatus(value, expected)), isAdministratorControlStatus(value, expected), JSON.stringify(value));
      const wrong = { ...expected, bundleSha256: 'f'.repeat(64) };
      assert.equal(administratorControlStatus(value, wrong), null);
      assert.equal(isAdministratorControlStatus(value, wrong), false);
    }
  }
});
