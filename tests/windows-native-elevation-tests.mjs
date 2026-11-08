import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/Test-WindowsNativeElevation.ps1', import.meta.url));
const windowsOnly = { skip: process.platform !== 'win32' };
function invoke(...args) {
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const run = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-File', script, ...args],
    { windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 8192 });
  assert.ifError(run.error);
  assert.equal(run.stderr, '');
  return { code: run.status, output: JSON.parse(run.stdout) };
}
const output = (action, status, administratorChildVerified = false) =>
  ({ action, status, uacRequested: false, administratorChildVerified, tunnelStarted: false, registrationChanged: false });

test('the default mode is a local read-only plan and never requests UAC', windowsOnly, () => {
  assert.deepEqual(invoke(), { code: 0, output: output('plan', 'ready-for-local-probe') });
});

test('Start without the exact consent and Probe with consent never request UAC', windowsOnly, () => {
  for (const args of [
    ['Start'], ['Start', '-Consent', 'accept-local-admin-probe '],
    ['Start', '-Consent', 'ACCEPT-LOCAL-ADMIN-PROBE'], ['Probe', '-Consent', 'accept-local-admin-probe'],
  ]) {
    const [action, ...options] = args;
    assert.deepEqual(invoke('-Action', action, ...options),
      { code: 2, output: output(action.toLowerCase(), 'consent-required-or-unexpected') });
  }
});

test('a real child verifies the inherited identity without launching UAC, a tunnel or a registration', windowsOnly, () => {
  const probe = invoke('-Action', 'Probe');
  assert.equal(probe.code, 0);
  assert.ok(['standard-child', 'administrator-child-verified'].includes(probe.output.status));
  assert.deepEqual(probe.output, output('probe', probe.output.status, probe.output.status === 'administrator-child-verified'));
});
