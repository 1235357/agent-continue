import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const windowsOnly = { skip: process.platform !== 'win32' };
const launcher = fileURLToPath(new URL('../scripts/Invoke-WindowsAdministratorAcceptance.ps1', import.meta.url));
const stager = fileURLToPath(new URL('../scripts/Stage-WindowsAdministratorBundle.ps1', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const consent = 'accept-one-native-administrator-acceptance';

function invoke({ action = 'Plan', consentValue, sourceHash = digest(readFileSync(stager)), archiveHash, probeId } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ac-admin-accept-launcher-'));
  try {
    const payload = 'immutable archive hash fixture, not a candidate ZIP';
    const archive = path.join(dir, 'candidate.zip');
    writeFileSync(archive, payload);
    const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', launcher, '-Action', action,
      '-Archive', archive, '-ExpectedSha256', archiveHash ?? digest(payload),
      '-ExpectedStagerSha256', sourceHash];
    if (consentValue !== undefined) args.push('-Consent', consentValue);
    if (probeId !== undefined) args.push('-ProbeReceiptId', probeId);
    const run = spawnSync(powershell, args, { windowsHide: true, encoding: 'utf8', timeout: 12000, maxBuffer: 8192 });
    assert.ifError(run.error);
    assert.equal(run.stderr, '');
    const receipt = JSON.parse(run.stdout);
    assert.equal(receipt.uacRequested, false);
    assert.equal(receipt.administratorChildVerified, false);
    assert.equal(receipt.tunnelStarted, false);
    assert.equal(receipt.registrationChanged, false);
    return { status: receipt.status, exit: run.status, ...(receipt.inspection && { inspection: receipt.inspection }) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Plan only verifies pins; it does not request UAC or claim acceptance', windowsOnly, () => {
  assert.deepEqual(invoke(), { status: 'pins-verified', exit: 0 });
});

test('existing installation verification requires its own consent and stable receipt ID before UAC', windowsOnly, () => {
  for (const input of [
    { action: 'VerifyLocal' },
    { action: 'VerifyLocal', consentValue: consent },
    { action: 'VerifyLocal', consentValue: 'accept-existing-native-administrator-probe' },
    { action: 'VerifyLocal', consentValue: 'accept-existing-native-administrator-probe', probeId: 'invalid' },
    { action: 'Start', consentValue: consent, probeId: 'a'.repeat(32) },
    { action: 'Plan', probeId: 'a'.repeat(32) },
  ]) {
    assert.deepEqual(invoke(input), { status: 'consent-required-or-unexpected', exit: 2 });
  }
});

test('child observation tolerates slow verification but never turns timeout into acceptance', windowsOnly, () => {
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const cmd = String.raw`$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
$ast=[Management.Automation.Language.Parser]::ParseFile('__LAUNCHER__',[ref]$null,[ref]$null)
$fn=$ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Wait-AcceptanceChild'},$true)
if(@($fn).Count -ne 1){exit 41}
. ([ScriptBlock]::Create($fn.Extent.Text))
$child=[pscustomobject]@{ExitCode=777777;Finished=$true;WaitBudget=0}
$child | Add-Member ScriptMethod WaitForExit {param($budget) $this.WaitBudget=$budget;return $this.Finished}
if((Wait-AcceptanceChild $child 777777) -cne 'administrator-child-verified' -or $child.WaitBudget -ne 900000){exit 42}
$child.Finished=$false
if((Wait-AcceptanceChild $child 777777) -cne 'outcome-unconfirmed'){exit 43}
$child.Finished=$true;$child.ExitCode=0
if((Wait-AcceptanceChild $child 777777) -cne 'outcome-unconfirmed'){exit 44}
if((Wait-AcceptanceChild $child 0) -cne 'administrator-child-verified'){exit 45}
$child.ExitCode=$null
if((Wait-AcceptanceChild $child 0) -cne 'outcome-unconfirmed'){exit 46}
if((Wait-AcceptanceChild $null 0) -cne 'outcome-unconfirmed'){exit 47}
exit 0`.replace('__LAUNCHER__', () => launcher.replaceAll("'", "''"));
  const run = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(cmd, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8', timeout: 12000 });
  assert.ifError(run.error);
  assert.equal(run.stderr, '');
  assert.equal(run.status, 0);
});

test('Inspect provides bounded observations only after pin verification', windowsOnly, () => {
  const { status, exit, inspection } = invoke({ action: 'Inspect' });
  assert.equal(status, 'inspection-complete');
  assert.equal(exit, 0);
  assert.deepEqual(Object.keys(inspection).sort(), ['browserRegistration', 'callerElevated', 'candidateFootprint']);
  assert.equal(typeof inspection.callerElevated, 'boolean');
  assert.ok(['not-observed', 'existing-artifact', 'unknown'].includes(inspection.candidateFootprint));
  assert.ok(['not-observed', 'candidate-registration-present', 'other-or-conflicting-registration', 'unknown']
    .includes(inspection.browserRegistration));
  assert.deepEqual(invoke({ action: 'Inspect', archiveHash: '0'.repeat(64) }),
    { status: 'archive-integrity', exit: 2 });
  assert.deepEqual(invoke({ action: 'Inspect', consentValue: consent }),
    { status: 'consent-required-or-unexpected', exit: 2 });
});

test('Start without exact consent and Plan with consent cannot request UAC', windowsOnly, () => {
  for (const input of [{ action: 'Start' }, { action: 'Start', consentValue: consent.toUpperCase() },
    { action: 'Plan', consentValue: consent }]) {
    assert.deepEqual(invoke(input), { status: 'consent-required-or-unexpected', exit: 2 });
  }
});

test('neither source nor bundle mismatch can request elevation', windowsOnly, () => {
  const start = { action: 'Start', consentValue: consent };
  assert.deepEqual(invoke({ ...start, sourceHash: '0'.repeat(64) }), { status: 'stager-integrity', exit: 2 });
  assert.deepEqual(invoke({ ...start, archiveHash: '0'.repeat(64) }), { status: 'archive-integrity', exit: 2 });
  const verify = { action: 'VerifyLocal', consentValue: 'accept-existing-native-administrator-probe', probeId: 'a'.repeat(32) };
  assert.deepEqual(invoke({ ...verify, sourceHash: '0'.repeat(64) }), { status: 'stager-integrity', exit: 2 });
  assert.deepEqual(invoke({ ...verify, archiveHash: '0'.repeat(64) }), { status: 'archive-integrity', exit: 2 });
});

test('the exact generated worker exits before opening input when the account differs', windowsOnly, () => {
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const cmd = String.raw`$ErrorActionPreference='Stop'
$ast=[Management.Automation.Language.Parser]::ParseFile('__LAUNCHER__',[ref]$null,[ref]$null)
$names=@('Open-AcceptanceInput','Assert-AcceptanceHash','Read-AcceptanceStager','New-AcceptanceWorker')
foreach($fn in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$true)){
    if($fn.Name -in $names){. ([ScriptBlock]::Create($fn.Extent.Text))}
}
foreach($probeId in @('',('a'*32),'invalid')){
    $worker=New-AcceptanceWorker "C:\missing'fixture\stager.ps1" 'C:\missing-fixture\candidate.zip' ('a'*64) ('b'*64) 'S-1-5-21-1-2-3-1001' 650000 $probeId
    $arguments='-NoLogo -NoProfile -NonInteractive -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($worker))
    if($arguments.Length -gt 18000){exit 33}
    $info=[Diagnostics.ProcessStartInfo]::new('__PS__',$arguments)
    $info.UseShellExecute=$false
    $info.CreateNoWindow=$true
    $p=[Diagnostics.Process]::Start($info)
    try {
        if(-not $p.WaitForExit(6000)){exit 34}
        $expected=if($probeId -ceq 'invalid'){10}else{11}
        if($p.ExitCode -ne $expected){exit 35}
    } finally {$p.Dispose()}
}
exit 11`
    .replace('__LAUNCHER__', () => launcher.replaceAll("'", "''"))
    .replace('__PS__', () => powershell.replaceAll("'", "''"));
  const run = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(cmd, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8', timeout: 12000, maxBuffer: 8192 });
  assert.ifError(run.error);
  assert.equal(run.stdout, '');
  assert.equal(run.stderr, '');
  assert.equal(run.status, 11);
});
