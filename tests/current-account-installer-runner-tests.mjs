import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('current-account installer parser and mocked publication contract, not actual installation', {
  skip: process.platform !== 'win32',
}, () => {
  const systemRoot = process.env.SystemRoot;
  assert.ok(systemRoot && path.isAbsolute(systemRoot));
  const shell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const fixture = fileURLToPath(new URL('./current-account-installer-tests.ps1', import.meta.url));
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fixture], {
    encoding: 'utf8', windowsHide: true, shell: false, timeout: 15000, maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const value = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(value).sort(), ['actualInstall', 'actualRegistry', 'checks', 'ok', 'scope']);
  assert.equal(value.ok, true);
  assert.ok(Number.isInteger(value.checks) && value.checks > 0);
  assert.equal(value.scope, 'parser-pure-input-and-mocked-publisher');
  assert.equal(value.actualInstall, false);
  assert.equal(value.actualRegistry, false);
});
