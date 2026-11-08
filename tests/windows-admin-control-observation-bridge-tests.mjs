import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createAdministratorBrowserActions, serveAdministratorBrowser } from '../native/desktop-commander/windows-admin-browser-host.mjs';
import { readFrame, writeFrame } from '../native/desktop-commander/device-owner.mjs';

const fixture = fileURLToPath(new URL('./windows-admin-control-observation-bridge.ps1', import.meta.url));
const runFile = promisify(execFile);
const digest = 'a'.repeat(64), operationId = 'b'.repeat(32), origin = `chrome-extension://${'c'.repeat(32)}/`;
const system = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const bundle = `C:\\Program Files\\AgentContinueAdmin\\${digest.slice(0, 24)}`;
const binding = { version: 1, origin, bundleSha256: digest, systemDirectory: system };
const windows = { skip: process.platform !== 'win32', timeout: 30_000 };

function fixtureEvidence({ state, started, error, stderr = '' }) {
  return { state, durationMs: Math.floor(performance.now() - started),
    code: Number.isInteger(error?.code) ? error.code :
      ['ETIMEDOUT', 'ENOENT', 'EACCES', 'EPERM'].includes(error?.code) ? error.code : null,
    killed: error?.killed === true,
    signal: ['SIGTERM', 'SIGKILL', 'SIGINT'].includes(error?.signal) ? error.signal : null,
    phases: [...stderr.matchAll(/^OBSERVATION_FIXTURE (entry|source-parsed|helpers-ready|receipt-read|complete)\r?$/gm)]
      .map(match => match[1]).slice(-8) };
}

test('fixture diagnostics keep fixed completion evidence without raw errors or private paths', () => {
  const evidence = fixtureEvidence({ state: 'failed', started: performance.now(),
    error: { code: 'private-code', killed: true, signal: 'private-signal', message: 'private-path' },
    stderr: 'OBSERVATION_FIXTURE entry\nprivate-path\nOBSERVATION_FIXTURE private-secret\nOBSERVATION_FIXTURE source-parsed\n' });
  assert.deepEqual({ ...evidence, durationMs: 0 }, { state: 'failed', durationMs: 0, code: null,
    killed: true, signal: null, phases: ['entry', 'source-parsed'] });
  assert.equal(Number.isInteger(evidence.durationMs) && evidence.durationMs >= 0, true);
  assert.doesNotMatch(JSON.stringify(evidence), /private-/);
});

async function request(control, mode) {
  const calls = [];
  let execution;
  const actions = createAdministratorBrowserActions(bundle, binding, async (exe, args, options) => {
    calls.push({ exe, args, options });
    // Execute only an AST-extracted helper fixture; not the requested stager or installed path.
    const started = performance.now();
    try {
      const result = await runFile(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fixture,
        '-Digest', digest, '-Operation', operationId, '-Control', control, '-Fixture', mode], options);
      execution = fixtureEvidence({ state: 'completed', started, stderr: result.stderr });
      return result;
    } catch (error) {
      execution = fixtureEvidence({ state: 'failed', started, error, stderr: error.stderr });
      throw error;
    }
  });
  const input = new PassThrough(), output = new PassThrough();
  const wire = { version: 1, action: 'control-status', id: '11111111-2222-3333-4444-555555555555',
    bundleSha256: digest, operationId, control };
  try {
    await writeFrame(input, wire);
    await serveAdministratorBrowser({ input, output, args: [origin], origin, ...actions });
    const result = await readFrame(output, 4000);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].exe, path.win32.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
    assert.deepEqual(calls[0].args, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', `${bundle}.browser\\stager.ps1`,
      '-Action', 'ObserveHostedOwnerControl', '-Archive', `${bundle}.browser\\bundle.zip`,
      '-ExpectedSha256', digest, '-ControlKind', control, '-ControlOperationId', operationId]);
    assert.equal(calls[0].options.windowsHide, true);
    assert.equal(calls[0].options.timeout, 3200);
    assert.equal(execution?.state, 'completed', 'PS5.1 fixture must finish before semantic assertions: ' + JSON.stringify(execution));
    assert.deepEqual(execution.phases, ['entry', 'source-parsed', 'helpers-ready', 'receipt-read', 'complete']);
    return { wire, result };
  } finally { input.destroy(); output.destroy(); }
}

test('native framing to actual PS5.1 source helper preserves each control receipt without mutation dispatch', windows, async () => {
  for (const control of ['connect', 'resume-saved', 'revoke']) {
    const { wire, result } = await request(control, 'receipt');
    assert.deepEqual(result, { ...wire, state: control === 'revoke' ? 'stopped' : 'launch-unconfirmed',
      progress: { phase: 'settled', verifiedFiles: null, totalFiles: null } });
  }
});

test('PS5.1 helper absence/corruption/identity/extra-field/progress failures stay original-ID unknown with no fallback', windows, async () => {
  for (const mode of ['absent', 'corrupt', 'mismatch', 'extra', 'bad-progress']) {
    const { wire, result } = await request('connect', mode);
    assert.deepEqual(result, { ...wire, state: 'unconfirmed', progress: null });
    const text = JSON.stringify(result);
    assert.equal(text.includes('private-fixture'), false);
    assert.equal(text.includes('path'), false);
  }
});
