import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
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

function runFixture(fixture, batch) {
  const systemRoot = process.env.SystemRoot;
  assert.ok(systemRoot && path.isAbsolute(systemRoot), 'SystemRoot must identify the trusted Windows directory');
  const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const args = ['-NoProfile', '-NonInteractive', '-File', fixture];
  if (batch !== undefined) {
    assert.ok(fixture === ledgerFixture &&
      ['read', 'read-connect', 'read-resume-saved', 'read-revoke', 'publication'].includes(batch), 'control_ledger_batch');
    args.push('-Batch', batch);
  }
  const result = spawnSync(powershell, args, {
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
  if (fixture !== ledgerFixture) {
    assert.ifError(result.error);
    assert.equal(result.signal, null, output);
    assert.equal(result.status, 0, output);
    return output;
  }
  const phases = new Set(['entry', 'source-extracted', 'canonical-bytes', 'matrix-connect', 'matrix-resume-saved',
    'matrix-revoke', 'matrix-complete', 'evidence-guards', 'publication-connect', 'publication-resume-saved',
    'publication-revoke', 'publication-complete', 'input-guards', 'execution-guards', 'complete', 'cleanup']);
  const bounded = value => [...String(value || '').slice(-65536)
    .matchAll(/^DIAG control-ledger phase=([a-z-]+) count=(0|[1-9][0-9]{0,8})\r?$/gm)]
    .filter(row => phases.has(row[1])).slice(-32)
    .map(([, phase, count]) => `DIAG control-ledger phase=${phase} count=${count}`).join('\n') ||
      'DIAG control-ledger phase=unobserved count=0';
  const diagnostic = `stdout:\n${bounded(result.stdout)}\nstderr:\n${bounded(result.stderr)}`;
  const failurePhase = result.error?.code === 'ETIMEDOUT' ? 'spawn-timeout' :
    result.error?.killed === true ? 'spawn-killed' : 'spawn-error';
  assert.ok(!result.error, `DIAG control-ledger-runner phase=${failurePhase} count=1\n` + diagnostic);
  assert.equal(result.signal, null, diagnostic);
  assert.equal(result.status, 0, diagnostic);
  return output;
}

test('ledger diagnostic runner retains sanitized bounded stdout and stderr on spawn failure', () => {
  const markers = Array.from({ length: 80 }, (_, count) => `DIAG control-ledger phase=matrix-connect count=${count}`);
  const run = vm.runInNewContext(`(${runFixture.toString()})`, {
    assert, path: path.win32, ledgerFixture: 'C:\\fixture\\ledger.ps1', process: { env: { SystemRoot: 'C:\\Windows' } },
    spawnSync(_file, _args, options) {
      assert.equal(options.timeout, 60_000);
      assert.equal(options.maxBuffer, 1024 * 1024);
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
      return { error: Object.assign(new Error('C:\\private\\secret S-1-5-21-1-2-3-1001'), { code: 'ETIMEDOUT' }),
        stdout: ['private stdout', ...markers, 'DIAG control-ledger phase=private count=1',
          'DIAG control-ledger phase=matrix-connect count=-1', 'DIAG control-ledger phase=matrix-connect count=9999999999',
          'C:\\private\\secret'].join('\n'),
        stderr: 'private stderr\nDIAG control-ledger phase=publication-revoke count=330\nS-1-5-21-1-2-3-1001', signal: null, status: 0 };
    },
  });
  assert.throws(() => run('C:\\fixture\\ledger.ps1'), error => {
    assert.match(error.message, /phase=spawn-timeout count=1/);
    assert.match(error.message, /stdout:\nDIAG control-ledger phase=matrix-connect count=48/);
    assert.match(error.message, /phase=matrix-connect count=79/);
    assert.match(error.message, /stderr:\nDIAG control-ledger phase=publication-revoke count=330/);
    assert.doesNotMatch(error.message, /private|S-1-5|C:\\|count=-|count=9999999999/);
    assert.equal((error.message.match(/DIAG control-ledger phase=matrix-connect/g) || []).length, 32);
    assert.ok(error.message.length < 8192);
    return true;
  });
});

test('ledger diagnostic runner still fails signals and nonzero exits without printing raw child data', () => {
  for (const failure of [{ signal: 'SIGTERM', status: null }, { signal: null, status: 1 }]) {
    const run = vm.runInNewContext(`(${runFixture.toString()})`, {
      assert, path: path.win32, ledgerFixture: 'C:\\fixture\\ledger.ps1', process: { env: { SystemRoot: 'C:\\Windows' } },
      spawnSync: () => ({ ...failure, stdout: 'DIAG control-ledger phase=entry count=0\nC:\\private\\secret',
        stderr: 'DIAG control-ledger phase=source-extracted count=14\nraw data' }),
    });
    assert.throws(() => run('C:\\fixture\\ledger.ps1'), error => {
      assert.match(error.message, /phase=entry count=0/);
      assert.match(error.message, /phase=source-extracted count=14/);
      assert.doesNotMatch(error.message, /private|raw data/);
      return true;
    });
  }
});

test('ledger diagnostic runner preserves successful fixture output unchanged', () => {
  const output = '{"ok":true}\n';
  const run = vm.runInNewContext(`(${runFixture.toString()})`, {
    assert, path: path.win32, ledgerFixture: 'C:\\fixture\\ledger.ps1', process: { env: { SystemRoot: 'C:\\Windows' } },
    spawnSync: () => ({ stdout: output, stderr: '', signal: null, status: 0 }),
  });
  assert.equal(run('C:\\fixture\\ledger.ps1'), output + '\n');
});

test('ledger diagnostic runner limits typed spawn reasons to fixed timeout, killed and error phases', () => {
  for (const [error, phase] of [[{ code: 'ETIMEDOUT' }, 'spawn-timeout'], [{ killed: true }, 'spawn-killed'],
    [{ code: 'C:\\private\\secret', killed: 'true' }, 'spawn-error']]) {
    const run = vm.runInNewContext(`(${runFixture.toString()})`, {
      assert, path: path.win32, ledgerFixture: 'C:\\fixture\\ledger.ps1', process: { env: { SystemRoot: 'C:\\Windows' } },
      spawnSync: () => ({ error, stdout: '', stderr: '', signal: null, status: 0 }),
    });
    assert.throws(() => run('C:\\fixture\\ledger.ps1'), failure => {
      assert.ok(failure.message.includes(`phase=${phase} count=1`));
      assert.match(failure.message, /stdout:\nDIAG control-ledger phase=unobserved count=0/);
      assert.match(failure.message, /stderr:\nDIAG control-ledger phase=unobserved count=0/);
      assert.doesNotMatch(failure.message, /private|C:\\/);
      return true;
    });
  }
});

test('ledger diagnostic runner preserves other fixtures original spawn and case failure evidence', () => {
  for (const result of [
    { error: new Error('peer-fixture-spawn-original'), status: 0, signal: null },
    { error: null, status: 1, signal: null },
    { error: null, status: null, signal: 'SIGTERM' },
  ]) {
    const run = vm.runInNewContext(`(${runFixture.toString()})`, {
      assert, path: path.win32, ledgerFixture: 'C:\\fixture\\ledger.ps1', process: { env: { SystemRoot: 'C:\\Windows' } },
      spawnSync: () => ({ ...result, stdout: 'peer-case-original-stdout', stderr: 'token-case-original-stderr' }),
    });
    assert.throws(() => run('C:\\fixture\\peer.ps1'), error => {
      if (result.error) assert.match(error.message, /peer-fixture-spawn-original/);
      else {
        assert.match(error.message, /peer-case-original-stdout/);
        assert.match(error.message, /token-case-original-stderr/);
      }
      assert.doesNotMatch(error.message, /control-ledger|unobserved/);
      return true;
    });
  }
});

test('ledger diagnostic phases retain exhaustive matrix and publication coverage', () => {
  const source = readFileSync(ledgerFixture, 'utf8');
  for (const phase of ['entry', 'source-extracted', 'canonical-bytes', 'matrix-complete',
    'evidence-guards', 'publication-complete', 'input-guards', 'execution-guards', 'complete', 'cleanup']) {
    assert.match(source, new RegExp(`Write-LedgerPhase '${phase}' `));
  }
  for (const phase of ['matrix-connect', 'matrix-resume-saved', 'matrix-revoke',
    'publication-connect', 'publication-resume-saved', 'publication-revoke']) assert.ok(source.includes(`'${phase}'`));
  assert.ok(source.indexOf("Write-LedgerPhase 'entry' 0") < source.indexOf('[Management.Automation.Language.Parser]::ParseFile'));
  assert.ok(source.indexOf("Write-LedgerPhase 'source-extracted'") < source.indexOf('[IO.Directory]::CreateDirectory($script:Scratch)'));
  assert.match(source, /for \(\$n = 0; \$n -lt \(1 -shl \$states.Count\); \$n\+\+\)/);
  assert.match(source, /\$script:MatrixCases\+\+/);
  assert.match(source, /\$script:PublicationCases\+\+/);
  assert.match(source, /\$script:MatrixCases % 256/);
  assert.match(source, /\$script:PublicationCases % 33/);
  assert.match(source, /same-ID concurrent acquisition is busy/);
  assert.match(source, /execution function contains explicit Flush\(true\)/);
  assert.match(source, /control_ledger_cleanup_reparse_refused/);
  const scratch = source.slice(source.indexOf('function Assert-ScratchPath('), source.indexOf('function Assert-SealedAcl('));
  assert.doesNotMatch(scratch, /\[IO\.(?:File|Directory)\]::Exists/);
  assert.match(scratch, /GetAttributes\(\$cursor\)[\s\S]*?ReparsePoint/);
  assert.match(scratch, /\[IO\.FileNotFoundException\][\s\S]*?\[IO\.DirectoryNotFoundException\][\s\S]*?\{ throw \}/);
});

test('ledger receipt assertions retain ordinal closed fields without a per-row sorting pipeline', windows, () => {
  const source = readFileSync(ledgerFixture, 'utf8');
  const body = source.slice(source.indexOf('function Assert-Receipt('), source.indexOf('function Get-Snapshot('));
  assert.doesNotMatch(body, /Sort-Object/);
  assert.match(body, /\[Array\]::IndexOf\(\$keys,'bundleSha256'\)/);
  const code = `
$ErrorActionPreference='Stop'
$text=[Console]::In.ReadToEnd()
$tokens=$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($text,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'fixture_parse'}
foreach($name in @('Assert-True','Assert-Receipt','Assert-SealedAcl')){
 $definition=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
 if($definition.Count -ne 1){throw 'fixture_function'}
 . ([scriptblock]::Create($definition[0].Extent.Text))
}
$script:Assertions=0;$digest='a'*64;$sid='S-1-5-21-1-2-3-1001';$id='b'*32;$checks=0
function Read-AdministratorControlReceipt {return $script:row}
$script:row=@{bundleSha256=$digest;operationId=$id;control='connect';state='reserved';progress=$null}
Assert-Receipt 'unused' 'connect' 'reserved' 'valid';$checks++
foreach($field in @('bundleSha256','operationId','control','state','progress')){
 foreach($variant in @('missing','wrong-case','extra')){
  $script:row=[Collections.Hashtable]::new([StringComparer]::Ordinal)
  foreach($key in @('bundleSha256','operationId','control','state','progress')){
   $value=@{bundleSha256=$digest;operationId=$id;control='connect';state='reserved';progress=$null}[$key]
   if($key -ceq $field -and $variant -ceq 'missing'){continue}
   $name=if($key -ceq $field -and $variant -ceq 'wrong-case'){$key.ToUpperInvariant()}else{$key}
   $script:row.Add($name,$value)
  }
  if($variant -ceq 'extra'){$script:row.Add('extra',$null)}
  $failed=$false;try{Assert-Receipt 'unused' 'connect' 'reserved' 'invalid'}catch{$failed=$true}
  if(-not $failed){throw 'fixture_accepted_invalid_fields'};$checks++
 }
}
$script:AclChecks=[Collections.Generic.List[object]]::new();$script:CaptureAclChecks=$false
$script:DenyAclPath='';$script:pathChecks=0;$script:typeChecks=0;$traceChecks=0
function Assert-ScratchPath {param($Path) $script:pathChecks++}
function Assert-PathType {param($Path,$Directory) $script:typeChecks++}
Assert-SealedAcl 'fixture' $true $false $sid
if($script:pathChecks -ne 1 -or $script:typeChecks -ne 1 -or $script:AclChecks.Count -ne 0){throw 'fixture_trace_guard'};$traceChecks++
$script:DenyAclPath='fixture';$failed=$false
try{Assert-SealedAcl 'fixture' $true $false $sid}catch{if($_.Exception.Message -cne 'fixture_acl_denied'){throw};$failed=$true}
if(-not $failed -or $script:pathChecks -ne 2 -or $script:typeChecks -ne 1){throw 'fixture_denial_guard'};$traceChecks++
$script:DenyAclPath='';$script:CaptureAclChecks=$true
Assert-SealedAcl 'fixture' $true $false $sid
if($script:pathChecks -ne 3 -or $script:typeChecks -ne 2 -or $script:AclChecks.Count -ne 1 -or $script:AclChecks[0].Sid -cne $sid){throw 'fixture_trace_identity'};$traceChecks++
[Console]::WriteLine('ordinal_receipt_checks='+$checks+';acl_trace_checks='+$traceChecks)
`;
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', code], {
    input: source, encoding: 'utf8', windowsHide: true, shell: false, timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stdout.trim(), 'ordinal_receipt_checks=16;acl_trace_checks=3');
});

function assertFixtureHostToken(result, kind) {
  assert.ok(kind === 'peer' || kind === 'entry');
  const token = result.observedToken;
  assert.ok(token && typeof token === 'object' && !Array.isArray(token), 'independent host-token observation is required');
  assert.deepEqual(Object.keys(token).sort(), ['administrator', 'elevated', 'integrity', 'selectedUserSid', 'session']);
  for (const field of ['integrity', 'session']) assert.ok(Number.isSafeInteger(token[field]) && token[field] >= 0);
  for (const field of ['elevated', 'administrator', 'selectedUserSid']) assert.equal(typeof token[field], 'boolean');
  const medium = token.integrity === 8192 && !token.elevated && !token.administrator && token.session > 0 &&
    (kind === 'entry' || token.selectedUserSid);
  assert.equal(result.actualMediumObserved, medium, 'classification must match the independent token');
  assert.equal(result.actualMediumCallerObserved, medium, 'positive capture/lifetime evidence belongs only to an actual medium token');
  assert.equal(result.actualNonMediumCaptureRefused, !medium, 'non-medium hosts must prove refusal, not skip capture');
  const refusal = medium ? null : kind === 'peer' ? 'browser_peer_unavailable' :
    token.administrator || token.session <= 0 ? 'identity' : 'owner_control_caller';
  assert.equal(result.actualCaptureRefusal, refusal, 'capture must produce the exact expected refusal');
  if (kind === 'peer') assert.equal(result.actualMediumAdmissionRefused, medium);
}

test('source-only token-aware summaries reject fabricated medium evidence and inexact refusal', () => {
  assert.equal(typeof assertFixtureHostToken, 'function');
  const medium = { integrity: 8192, elevated: false, administrator: false, session: 1, selectedUserSid: true };
  const rows = [
    [medium, true],
    [{ ...medium, integrity: 12288, elevated: true, administrator: true }, false],
    [{ ...medium, session: 0 }, false],
    [{ ...medium, integrity: 4096 }, false],
    [{ ...medium, elevated: true }, false],
    [{ ...medium, administrator: true }, false],
    [{ ...medium, selectedUserSid: false }, false, true],
  ];
  for (const kind of ['peer', 'entry']) {
    for (const [observedToken, peerMedium, entryMedium = peerMedium] of rows) {
      const actualMediumObserved = kind === 'peer' ? peerMedium : entryMedium;
      const actualCaptureRefusal = actualMediumObserved ? null : kind === 'peer' ? 'browser_peer_unavailable' :
        observedToken.administrator || observedToken.session <= 0 ? 'identity' : 'owner_control_caller';
      const result = { observedToken, actualMediumObserved, actualMediumCallerObserved: actualMediumObserved,
        actualNonMediumCaptureRefused: !actualMediumObserved, actualCaptureRefusal,
        actualMediumAdmissionRefused: actualMediumObserved };
      assert.doesNotThrow(() => assertFixtureHostToken(result, kind));
      for (const field of ['actualMediumObserved', 'actualMediumCallerObserved', 'actualNonMediumCaptureRefused',
        ...(kind === 'peer' ? ['actualMediumAdmissionRefused'] : [])]) {
        assert.throws(() => assertFixtureHostToken({ ...result, [field]: !result[field] }, kind));
      }
      assert.throws(() => assertFixtureHostToken({ ...result, actualCaptureRefusal: 'unexpected_error' }, kind));
      assert.throws(() => assertFixtureHostToken({ ...result, observedToken: null }, kind));
      for (const field of Object.keys(medium)) {
        assert.throws(() => assertFixtureHostToken({ ...result, observedToken: { ...observedToken, [field]: 'unknown' } }, kind));
      }
    }
  }
});

test('source-only token-aware fixtures retain the independent oracle and both exact capture outcomes', () => {
  const oracle = source => source.match(/Add-Type -TypeDefinition @'\r?\n([\s\S]*?public static class ControlPeerFixtureTokenOracle[\s\S]*?)\r?\n'@ -ErrorAction Stop/)?.[1].replaceAll('\r\n', '\n');
  const baseline = oracle(readFileSync(peerFixture, 'utf8'));
  assert.ok(baseline);
  for (const fixture of [peerProjectionFixture, entryFixture]) {
    const source = readFileSync(fixture, 'utf8');
    assert.equal(oracle(source), baseline, 'reuse the peer fixture independent token reader unchanged');
    assert.match(source, /\[ControlPeerFixtureTokenOracle\]::Read\(\$identity\.Token\)/);
    assert.match(source, /\$script:observedToken=Get-FixtureHostToken/);
    assert.match(source, /if \(\$script:actualMediumObserved\)/);
    assert.match(source, /actualNonMediumCaptureRefused=\$script:actualNonMediumCaptureRefused/);
    assert.match(source, /actualCaptureRefusal=\$script:actualCaptureRefusal/);
    assert.doesNotMatch(source, /Write-Output ['"]SKIP|\$script:actualMediumObserved=\$true/);
  }
  const projection = readFileSync(peerProjectionFixture, 'utf8');
  assert.match(projection, /\$script:actualMediumObserved=\(\$script:observedToken\.integrity -eq 8192 -and -not \$script:observedToken\.elevated -and\s*-not \$script:observedToken\.administrator -and \$script:observedToken\.session -gt 0 -and \$script:observedToken\.selectedUserSid\)/);
  assert.match(projection, /Case 'actual native request policy validates inputs independently of capture'/);
  assert.ok(projection.indexOf('$script:nativePolicyValidated=$true') < projection.indexOf('$script:observedToken=Get-FixtureHostToken'));
  const policyCase = projection.slice(projection.indexOf("Case 'actual native request policy validates inputs independently of capture'"),
    projection.indexOf("Case 'actual host token requires exact medium capture or exact non-medium refusal'"));
  assert.ok(policyCase.includes("foreach ($mode in @('control','fence','reconcile'))"));
  assert.ok(policyCase.includes("foreach ($control in @('connect','resume-saved','revoke'))"));
  assert.match(policyCase, /\$answer=\$policy\.Invoke\(\$null,\$arguments\)\s+Check \(\$null -eq \$answer\)/);
  assert.ok(policyCase.includes('$invalid[7]=[uint32]0'));
  assert.match(projection, /\$refusal -is \[InvalidOperationException\] -and \$refusal\.Message -ceq 'browser_peer_unavailable'/);
  assert.match(projection, /repeated disposal cannot revive actual witness/);
  const entry = readFileSync(entryFixture, 'utf8');
  assert.match(entry, /\$script:actualMediumObserved=\(\$script:observedToken\.integrity -eq 8192 -and -not \$script:observedToken\.elevated -and\s*-not \$script:observedToken\.administrator -and \$script:observedToken\.session -gt 0\)/);
  assert.match(entry, /\$refusal -is \[Management\.Automation\.RuntimeException\] -and \$refusal\.Message -ceq \$expectedRefusal/);
  assert.match(entry, /\$held\.IsClosed/);
});

function validateLedgerBatch(result, batch) {
  const controls = ['connect', 'resume-saved', 'revoke'];
  const control = controls.find(value => batch === `read-${value}`);
  const readControls = batch === 'read' ? controls : control ? [control] : [];
  const common = { version: 1, batch, canonicalCases: 0, readCombinations: 0, evidenceControls: 0,
    readControls,
    publicationCases: 0, damagedHistoryCases: 0, selectedSidGuard: false, inputGuards: false, executionGuards: false,
    protectedAcceptance: false };
  const expected = readControls.length ? { ...common, canonicalCases: 11 * readControls.length,
    readCombinations: 2048 * readControls.length, evidenceControls: readControls.length } :
    batch === 'publication' ? { ...common, publicationCases: 363, damagedHistoryCases: 66,
      selectedSidGuard: true, inputGuards: true, executionGuards: true } : null;
  assert.ok(expected && result && typeof result === 'object' && !Array.isArray(result), 'control_ledger_batch_manifest');
  assert.ok(Object.keys(result).length === Object.keys(expected).length + 1 &&
    Object.entries(expected).every(([key, value]) => Object.hasOwn(result, key) && (key === 'readControls' ?
      Array.isArray(result[key]) && result[key].length === value.length && value.every((item, index) => result[key][index] === item) :
      result[key] === value)) &&
    Number.isSafeInteger(result.assertions) && result.assertions > 0, 'control_ledger_batch_coverage');
}

function validateLedgerCoverage(results) {
  const batches = ['read-connect', 'read-resume-saved', 'read-revoke', 'publication'];
  assert.ok(Array.isArray(results) && results.length === batches.length, 'control_ledger_aggregate_count');
  const seen = new Set();
  for (const result of results) {
    assert.ok(result && batches.includes(result.batch) && !seen.has(result.batch), 'control_ledger_aggregate_overlap');
    validateLedgerBatch(result, result.batch);
    seen.add(result.batch);
  }
  assert.deepEqual(results.flatMap(result => result.readControls).sort(), ['connect', 'resume-saved', 'revoke'],
    'control_ledger_aggregate_controls');
  const totals = { canonicalCases: 33, readCombinations: 6144, evidenceControls: 3,
    publicationCases: 363, damagedHistoryCases: 66 };
  for (const [field, total] of Object.entries(totals)) {
    assert.equal(results.reduce((sum, result) => sum + result[field], 0), total, 'control_ledger_aggregate_coverage');
  }
  return totals;
}

const ledgerResults = [];
for (const batch of ['read-connect', 'read-resume-saved', 'read-revoke', 'publication']) {
  test(`Windows administrator control ledger ${batch}: scratch-only PS5.1 fixture (not protected acceptance)`, windows, t => {
    const output = runFixture(ledgerFixture, batch);
    const manifests = [...output.matchAll(/^LEDGER_BATCH (\{[^\r\n]*\})\r?$/gm)];
    assert.equal(manifests.length, 1, 'control_ledger_batch_manifest_count');
    let result;
    try { result = JSON.parse(manifests[0][1]); } catch { assert.fail('control_ledger_batch_manifest_json'); }
    validateLedgerBatch(result, batch);
    assert.match(output, /^DIAG control-ledger phase=cleanup count=1\r?$/m);
    ledgerResults.push(result);
    t.diagnostic(JSON.stringify(result));
  });
}

test('Windows administrator control ledger aggregate retains exact disjoint scratch-only coverage', windows, t => {
  t.diagnostic(JSON.stringify(validateLedgerCoverage(ledgerResults)));
});

test('source-only ledger batches retain disjoint exact coverage and reject partial manifests', () => {
  assert.equal(typeof validateLedgerBatch, 'function');
  const read = { version: 1, batch: 'read', canonicalCases: 33, readCombinations: 6144, evidenceControls: 3,
    readControls: ['connect', 'resume-saved', 'revoke'],
    publicationCases: 0, damagedHistoryCases: 0, selectedSidGuard: false, inputGuards: false, executionGuards: false,
    assertions: 1, protectedAcceptance: false };
  const publication = { ...read, batch: 'publication', canonicalCases: 0, readCombinations: 0, evidenceControls: 0,
    readControls: [],
    publicationCases: 363, damagedHistoryCases: 66, selectedSidGuard: true, inputGuards: true, executionGuards: true };
  const actionReads = ['connect', 'resume-saved', 'revoke'].map(control => ({
    ...read, batch: `read-${control}`, canonicalCases: 11, readCombinations: 2048, evidenceControls: 1,
    readControls: [control],
  }));
  for (const result of [read, ...actionReads, publication]) {
    assert.doesNotThrow(() => validateLedgerBatch(result, result.batch));
    for (const field of Object.keys(result)) {
      const invalid = { ...result };
      delete invalid[field];
      assert.throws(() => validateLedgerBatch(invalid, result.batch));
      assert.throws(() => validateLedgerBatch({ ...result, [field]: 'unverified' }, result.batch));
    }
    assert.throws(() => validateLedgerBatch({ ...result, extra: true }, result.batch));
    assert.throws(() => validateLedgerBatch(result, result.batch === 'read' ? 'publication' : 'read'));
    assert.throws(() => validateLedgerBatch(result, 'all'));
  }
  for (const [field, total] of Object.entries({ canonicalCases: 33, readCombinations: 6144, evidenceControls: 3,
    publicationCases: 363, damagedHistoryCases: 66 })) {
    assert.equal(read[field] + publication[field], total);
    assert.equal(Number(read[field] > 0) + Number(publication[field] > 0), 1);
    assert.equal([...actionReads, publication].reduce((sum, result) => sum + result[field], 0), total);
    assert.throws(() => validateLedgerBatch({ ...read, [field]: read[field] + 1 }, 'read'));
  }
  for (const result of actionReads) {
    assert.throws(() => validateLedgerBatch({ ...result, readControls: ['connect', 'revoke'] }, result.batch));
    const other = result.readControls[0] === 'connect' ? 'revoke' : 'connect';
    assert.throws(() => validateLedgerBatch({ ...result, readControls: [other] }, result.batch));
  }
});

test('source-only ledger aggregate rejects missing, overlapping and inflated action coverage', () => {
  assert.equal(typeof validateLedgerCoverage, 'function');
  const reads = ['connect', 'resume-saved', 'revoke'].map(control => ({
    version: 1, batch: `read-${control}`, canonicalCases: 11, readCombinations: 2048, evidenceControls: 1,
    readControls: [control], publicationCases: 0, damagedHistoryCases: 0,
    selectedSidGuard: false, inputGuards: false, executionGuards: false, assertions: 1, protectedAcceptance: false,
  }));
  const publication = { ...reads[0], batch: 'publication', canonicalCases: 0, readCombinations: 0, evidenceControls: 0,
    readControls: [], publicationCases: 363, damagedHistoryCases: 66,
    selectedSidGuard: true, inputGuards: true, executionGuards: true };
  const results = [...reads, publication];
  assert.doesNotThrow(() => validateLedgerCoverage(results));
  assert.doesNotThrow(() => validateLedgerCoverage([...results].reverse()));
  for (let index = 0; index < results.length; index++) {
    assert.throws(() => validateLedgerCoverage(results.filter((_, row) => row !== index)));
    assert.throws(() => validateLedgerCoverage([...results, results[index]]));
    const duplicate = [...results];
    duplicate[index] = results[(index + 1) % results.length];
    assert.throws(() => validateLedgerCoverage(duplicate));
    for (const field of ['canonicalCases', 'readCombinations', 'evidenceControls', 'publicationCases', 'damagedHistoryCases']) {
      const changed = [...results];
      changed[index] = { ...results[index], [field]: results[index][field] + 1 };
      assert.throws(() => validateLedgerCoverage(changed));
    }
  }
  const overlap = [...results];
  overlap[1] = { ...reads[1], readControls: ['connect'] };
  assert.throws(() => validateLedgerCoverage(overlap));
  assert.throws(() => validateLedgerCoverage(null));
});

test('source-only ledger batch selectors preserve child bounds and reject unknown routes before spawn', () => {
  for (const batch of ['read', 'read-connect', 'read-resume-saved', 'read-revoke', 'publication']) {
    const run = vm.runInNewContext(`(${runFixture.toString()})`, {
      assert, path: path.win32, ledgerFixture: 'C:\\fixture\\ledger.ps1', process: { env: { SystemRoot: 'C:\\Windows' } },
      spawnSync(_exe, args, options) {
        assert.equal(args.slice(-2).join('|'), '-Batch|' + batch);
        assert.equal(options.timeout, 60_000);
        assert.equal(options.maxBuffer, 1024 * 1024);
        assert.equal(options.shell, false);
        assert.equal(options.windowsHide, true);
        return { stdout: '', stderr: '', status: 0, signal: null };
      },
    });
    run('C:\\fixture\\ledger.ps1', batch);
  }
  const run = vm.runInNewContext(`(${runFixture.toString()})`, {
    assert, path: path.win32, ledgerFixture: 'C:\\fixture\\ledger.ps1', process: { env: { SystemRoot: 'C:\\Windows' } },
    spawnSync() { assert.fail('invalid batch must not spawn'); },
  });
  for (const batch of ['all', 'READ', '', 'other', 'read-Connect', 'read-resume', 'read-revoke ', 'read-connect\n', null, {}, ['read-connect']]) {
    assert.throws(() => run('C:\\fixture\\ledger.ps1', batch), /control_ledger_batch/);
  }
  for (const batch of ['read', 'read-connect', 'read-resume-saved', 'read-revoke', 'publication']) {
    assert.throws(() => run('C:\\fixture\\peer.ps1', batch), /control_ledger_batch/);
  }
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  assert.match(source, /const windows = \{ skip: process\.platform !== 'win32', timeout: 65_000 \}/);
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
  assert.equal(result.scope, 'typed-projection-with-fake-peer-and-token-aware-capture-not-high-proof');
  assert.ok(Number.isSafeInteger(result.cases) && result.cases >= 66);
  assert.ok(Number.isSafeInteger(result.assertions) && result.assertions >= 213);
  assert.deepEqual(result.failures, []);
  assert.equal(result.compilerAclStub, true);
  assert.equal(result.fakeTypedPeerProjections, true);
  assert.equal(result.actualHighPair, false);
  assert.equal(result.protectedAcceptance, false);
  assert.equal(result.nativeRequestPolicyValidated, true);
  assertFixtureHostToken(result, 'peer');
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
  assertFixtureHostToken(result, 'entry');
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
