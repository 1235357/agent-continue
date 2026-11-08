import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = readFileSync(new URL('../scripts/Stage-WindowsAdministratorBundle.ps1', import.meta.url), 'utf8');
test('reauthorization is an explicit high-token maintenance action before fresh-state creation', () => {
  assert.match(source, /'ReauthorizeHostedOwner'/);
  assert.match(source, /\$reauthorizeHostedOwner -and \$Consent -cne 'reauthorize-revoked-administrator-full-account'/);
  const verify = source.indexOf('Verify-SealedBundle $root $layout');
  const restore = source.indexOf("$phase='owner_reauthorization_preflight'");
  const fresh = source.indexOf('Assert-FreshAdministratorState $stateRoot $stateLayout');
  assert.ok(verify >= 0 && restore > verify && fresh > restore);
  const branch = source.slice(restore, source.indexOf('$completeBrowserEnrollment = {', restore));
  for (const required of ['Read-AdministratorBrowserCommit', 'Read-AdministratorBrowserStager', 'Assert-AdministratorOwnerWake',
    'Assert-AdministratorBrowserRegistry', 'Assert-AdministratorBrowserTask', '$task.GetInstances(0).Count',
    "$origin='chrome-extension://'+$BrowserExtensionId+'/'", 'Restore-AdministratorOwnerAuthorization']) {
    assert.ok(branch.includes(required), required);
  }
  assert.doesNotMatch(branch, /Write-AdministratorOwnerActivation|Write-AdministratorHostedBinding|\.Run\(|Register-AdministratorBrowserOwner|\.Origin/);
});

test('reauthorization archives denial only after journal and revision, with no first-activation or launch replay', () => {
  const body = source.slice(source.indexOf('function Restore-AdministratorOwnerAuthorization('), source.indexOf('function New-AdministratorHostedLaunchPlan('));
  const steps = ["Write-AdministratorOwnerFile ($prefix+'.started.json')", 'Write-AdministratorOwnerControlRevision $gate $Id',
    "[IO.File]::Move($deny,($prefix+'.revoked'))", "Write-AdministratorOwnerFile ($prefix+'.committed.json')"];
  let last = -1;
  for (const step of steps) { const index = body.indexOf(step); assert.ok(index > last, step); last = index; }
  assert.match(body, /\.started\.json','\.committed\.json','\.revoked'/);
  assert.match(body, /reauthorization_id_exists/);
  assert.match(body, /authorized=\$true;paused=\$true/);
  assert.match(body, /registrationChanged=\$false;tunnelStarted=\$false/);
  assert.doesNotMatch(body, /\[IO\.File\]::Delete|Write-AdministratorOwnerIntent|\.Run\(|Start-Process|Request-AdministratorOwnerConnect/);
});

test('same-installation reauthorization scratch transaction and interruptions', { skip: process.platform !== 'win32', timeout: 20_000 }, () => {
  const ps = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const fixture = fileURLToPath(new URL('./windows-admin-reauthorization-tests.ps1', import.meta.url));
  const child = spawnSync(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fixture], {
    windowsHide: true, encoding: 'utf8', shell: false, timeout: 15_000,
  });
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /reauthorization_scratch_checks=[5-9][0-9]/);
});
