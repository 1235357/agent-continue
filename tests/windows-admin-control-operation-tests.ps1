[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'))
$tokens = $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'stager_parse' }
$required = @('Invoke-AdministratorControlOperation','Open-AdministratorControlExecution',
    'Read-AdministratorControlRecord','Read-AdministratorControlReceipt','Read-AdministratorControlPhase',
    'Read-AdministratorControlProgress','Request-AdministratorOwnerPause')
foreach ($name in $required) {
    if (-not $ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)) {
        throw ('missing_function:' + $name)
    }
}
# Extract definitions only. Never execute the stager's installation/dispatch body.
$ownerHelpers = @('Assert-PathType','Test-AdministratorOwnerAbsent','Test-AdministratorOwnerIntent',
    'Test-AdministratorOwnerRunIntent','Test-AdministratorBrowserPauseTarget','Write-HostedWindowSignal',
    'Write-AdministratorOwnerFile','Assert-AdministratorOwnerBytes',
    'Get-AdministratorPauseReceiptBytes','Read-AdministratorOwnerPause','Publish-AdministratorOwnerPause',
    'Get-AdministratorPauseReservationBytes','Publish-AdministratorPauseReservation','Request-AdministratorOwnerPause')
foreach ($node in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$true)) {
    if ($node.Name -cmatch '\A(?:Test|Assert|Get|Read|Publish|Reserve|Fence|Resolve|Open|Invoke)-AdministratorControl' -or
        $node.Name -cin $ownerHelpers) {
        . ([scriptblock]::Create($node.Extent.Text))
    }
}

$scratch = [IO.Path]::Combine([IO.Path]::GetTempPath(),('ac-control-operation-test-' + [Guid]::NewGuid().ToString('N')))
$null = [IO.Directory]::CreateDirectory($scratch)
$script:checks = 0
$script:cases = 0
$script:failures = [Collections.Generic.List[string]]::new()
$script:fixture = $null
$digest = 'a' * 64
$sid = 'S-1-5-21-1-2-3-1001'
$origin = 'chrome-extension://' + ('c' * 32) + '/'
$usersSid = $sid
$runner = @{pid=600;started='639296000000000000'}
$session = @{mediumPid=500;mediumStarted='639295999999999999';highPid=600;
    highStarted='639296000000000000';sessionId=1;userSid=$sid}

function Check([bool]$Value,[string]$Why) {
    if (-not $Value) { throw $Why }
    $script:checks++
}
function Refuse([scriptblock]$Work,[string]$Why) {
    $failed = $false
    try { $null = & $Work } catch { $failed = $true }
    Check $failed $Why
}
# Callback assertions are retained outside the callback, even if the engine catches it.
function Observe([bool]$Value,[string]$Why) {
    $script:checks++
    if (-not $Value) { $script:fixture.Violations.Add($Why) }
}
function Assert-ScratchPath([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith($scratch + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'scratch_scope' }
}
function Assert-SealedAcl([string]$Path,[bool]$Directory,[bool]$Private=$false,[string]$ReaderSid='') {
    Assert-ScratchPath $Path
    Assert-PathType $Path $Directory
    if ($script:fixture -and $Path -ceq $script:fixture.Revoked -and -not $Directory) {
        Observe $Private 'revocation_marker_requires_private_acl_check'
        $script:fixture.MarkerChecked = $true
    }
}
function Ensure-SealedDirectory([string]$Path,[bool]$Private=$false,[string]$ReaderSid='') {
    Assert-ScratchPath $Path
    $null = [IO.Directory]::CreateDirectory($Path)
    Assert-SealedAcl $Path $true $Private $ReaderSid
}
function Open-SealedNewFile([string]$Path,[bool]$Private=$false,[string]$ReaderSid='',[IO.FileShare]$Share='None') {
    Assert-ScratchPath $Path
    Assert-SealedAcl ([IO.Path]::GetDirectoryName($Path)) $true $Private $ReaderSid
    return [IO.File]::Open($Path,'CreateNew','Write',$Share)
}
function Assert-AdministratorOwnerControlIdentity([string]$BundleRoot,[string]$Digest,[string]$Sid) {
    if ($BundleRoot -cne $script:fixture.Bundle -or $Digest -cne $script:digest -or $Sid -cne $script:sid) {
        throw 'fixture_owner_identity'
    }
    Assert-SealedAcl $BundleRoot $true
    Assert-SealedAcl ($BundleRoot + '.state') $true $true
    Assert-SealedAcl ($BundleRoot + '.secrets') $true $true
}
function Test-FixtureGuardHeld {
    foreach ($handle in $script:fixture.Gates) { if ($handle.CanRead) { return $true } }
    return $false
}
function Open-AdministratorOwnerControl([string]$Vault) {
    if ($Vault -cne $script:fixture.Vault) { throw 'fixture_vault' }
    if (Test-FixtureGuardHeld) { throw 'fixture_global_guard_reentered' }
    $stream = [IO.File]::Open($script:fixture.Guard,'Open','ReadWrite','None')
    $script:fixture.Gates.Add($stream)
    return $stream
}
function Read-AdministratorOwnerControlRevision([IO.FileStream]$Gate) {
    Observe ($Gate.CanRead -and (Test-FixtureGuardHeld)) 'revision_read_requires_guard'
    return $script:fixture.Revision
}
function Write-AdministratorOwnerControlRevision([IO.FileStream]$Gate,[string]$Revision=[Guid]::NewGuid().ToString('N')) {
    Observe ($Gate.CanWrite -and (Test-FixtureGuardHeld)) 'revision_write_requires_guard'
    $script:fixture.Revision = $Revision
    $script:fixture.RevisionWrites++
}
function Get-AdministratorPauseGeneration([string]$Root,[string]$Vault,[string]$Digest,[string]$Sid) {
    Observe ($Root -ceq $script:fixture.State -and $Vault -ceq $script:fixture.Vault) 'derived_generation_paths'
    return $script:fixture.Generation
}
function Test-AdministratorOwnerInnerLeasesClear([string]$Root) {
    Observe ($Root -ceq $script:fixture.State) 'derived_inner_lease_path'
    return $script:fixture.InnerClear
}
function Update-AdministratorBrowserPauseTarget([string]$Root,[string]$Vault,[string]$Digest,[string]$Sid,
    [IO.FileStream]$Gate,[switch]$Require) {
    Observe ($Root -ceq $script:fixture.State -and $Vault -ceq $script:fixture.Vault) 'derived_projection_paths'
    Observe ($Gate.CanRead -and (Test-FixtureGuardHeld)) 'projection_update_requires_guard'
}
function Set-FixtureIntent([bool]$Paused) {
    $literal = if ($Paused) { 'true' } else { 'false' }
    [IO.File]::WriteAllText($script:fixture.Intent,
        (('{"format":"agent-continue-lifecycle","version":1,"paused":' + $literal + '}') + [char]10),
        [Text.UTF8Encoding]::new($false))
}
function Write-AdministratorOwnerIntent([string]$Root,[bool]$Paused) {
    $f = $script:fixture
    Observe ($Root -ceq $f.State) 'derived_intent_path'
    Observe (Test-FixtureGuardHeld) 'intent_write_requires_guard'
    if ($f.ActiveControl -ceq 'resume-saved') { Observe $false 'resume_must_never_write_lifecycle' }
    if ($f.ActiveControl -cin @('connect','resume-saved','revoke')) {
        Observe ($null -ne (Read-AdministratorControlRecord $f.Vault $digest $sid $origin $f.ActiveId $f.ActiveControl)) 'intent_requires_original_reservation'
        Observe ($null -ne (Read-AdministratorControlPhase $f.Vault $digest $sid $f.ActiveId $f.ActiveControl 'intent-write-started')) 'intent_phase_precedes_effect'
    }
    if ($f.ActiveControl -ceq 'revoke') {
        Observe ($Paused -and [IO.File]::Exists($f.Revoked) -and $f.MarkerChecked) 'protected_revocation_marker_precedes_paused_intent'
        Observe ([IO.FileInfo]::new($f.Revoked).Length -eq 0) 'revocation_marker_empty'
    }
    $f.IntentWrites++
    if ($f.ThrowIntent) { throw 'fixture_intent_exception' }
    Set-FixtureIntent $Paused
}
# Native owner completion is deliberately outside this engine-test evidence scope.
function Complete-AdministratorControlRevocation { }

function New-OperationFixture([bool]$Paused=$true,[string]$Generation='idle') {
    $base = [IO.Path]::Combine($scratch,[Guid]::NewGuid().ToString('N'),'bundle')
    $script:fixture = @{
        Bundle=$base;State=($base+'.state');Vault=($base+'.secrets');Status=($base+'.status');
        Intent=[IO.Path]::Combine($base+'.state','lifecycle.json');
        Guard=[IO.Path]::Combine($base+'.secrets','owner-control.guard');
        Revoked=[IO.Path]::Combine($base+'.secrets','owner-revoked');
        Revision=('d'*32);Generation=$Generation;InnerClear=$true;Eligible=$true;RequestResult=$true;
        Gates=[Collections.Generic.List[IO.FileStream]]::new();Violations=[Collections.Generic.List[string]]::new();
        Audits=0;Bindings=0;StartupChecks=0;Tasks=0;IntentWrites=0;RevisionWrites=0;
        MarkerChecked=$false;ThrowAudit=$false;ThrowIntent=$false;ThrowTask=$false;
        OnAudit=$null;ActiveId=$null;ActiveControl=$null;LastProgress=$null
    }
    $f = $script:fixture
    foreach ($directory in @($f.Bundle,$f.State,$f.Vault,$f.Status)) { $null = [IO.Directory]::CreateDirectory($directory) }
    [IO.File]::WriteAllText($f.Guard,($f.Revision + [char]10),[Text.Encoding]::ASCII)
    Set-FixtureIntent $Paused
    $f.Target = $f.Revision + ':' + $Generation
    $f.VerifyBinding = {
        $script:fixture.Bindings++
        Observe (Test-FixtureGuardHeld) 'binding_verification_requires_short_global_guard'
    }
    $f.Audit = {
        param([scriptblock]$Progress)
        $f = $script:fixture
        $f.Audits++
        Observe (-not (Test-FixtureGuardHeld)) 'full_audit_outside_global_guard'
        Observe ($null -ne (Read-AdministratorControlRecord $f.Vault $digest $sid $origin $f.ActiveId $f.ActiveControl)) 'reservation_durable_before_audit'
        Observe ((Read-AdministratorControlReceipt $f.Status $digest $sid $f.ActiveId $f.ActiveControl).state -ceq 'reserved') 'reserved_receipt_before_audit'
        Observe ($Progress -is [scriptblock]) 'audit_receives_progress_callback'
        if ($Progress) {
            foreach ($done in @(0,64,130)) {
                $null = & $Progress $done 130
                $p = Read-AdministratorControlProgress $f.Status $digest $sid $f.ActiveId $f.ActiveControl
                Observe ($null -ne $p -and $p.phase -ceq 'verifying-full' -and $p.verifiedFiles -eq $done -and $p.totalFiles -eq 130) 'audit_progress_published_during_callback'
                Observe ((Read-AdministratorControlReceipt $f.Status $digest $sid $f.ActiveId $f.ActiveControl).state -ceq 'reserved') 'audit_progress_is_not_ready'
                $f.LastProgress = $p
            }
        }
        if ($f.OnAudit) { $null = & $f.OnAudit }
        if ($f.ThrowAudit) { throw 'fixture_audit_exception' }
    }
    $f.CheckStartup = {
        $script:fixture.StartupChecks++
        return $script:fixture.Eligible
    }
    $f.RequestTask = {
        $f = $script:fixture
        $f.Tasks++
        Observe (-not (Test-FixtureGuardHeld)) 'task_request_outside_global_guard'
        Observe ($null -ne (Read-AdministratorControlPhase $f.Vault $digest $sid $f.ActiveId $f.ActiveControl 'intent-write-started')) 'intent_phase_durable_before_task'
        Observe ($null -ne (Read-AdministratorControlPhase $f.Vault $digest $sid $f.ActiveId $f.ActiveControl 'launch-attempted')) 'launch_phase_durable_before_task'
        Observe ((Read-AdministratorControlReceipt $f.Status $digest $sid $f.ActiveId $f.ActiveControl).state -ceq 'intent-saved') 'intent_receipt_durable_before_task'
        Observe (Test-AdministratorOwnerRunIntent $f.State $f.Vault) 'task_requires_running_not_revoked'
        if ($f.ThrowTask) { throw 'fixture_task_exception' }
        return $f.RequestResult
    }
    return $f
}
function Invoke-FixtureOperation([string]$Id,[string]$Control,$Target) {
    $f = $script:fixture
    $previousId = $f.ActiveId; $previousControl = $f.ActiveControl
    $f.ActiveId = $Id; $f.ActiveControl = $Control
    try {
        return Invoke-AdministratorControlOperation -BundleRoot $f.Bundle -Digest $digest -Sid $sid -Origin $origin `
            -Id $Id -Control $Control -Target $Target -Runner $runner -Session $session `
            -VerifyBinding $f.VerifyBinding -Audit $f.Audit -CheckStartup $f.CheckStartup -RequestTask $f.RequestTask
    } finally { $f.ActiveId = $previousId; $f.ActiveControl = $previousControl }
}
function Check-Receipt($Receipt,[string]$Id,[string]$Control,[string]$State) {
    Check ($null -ne $Receipt -and $Receipt -isnot [array]) 'one_action_receipt_returned'
    Check ($Receipt.bundleSha256 -ceq $digest -and $Receipt.operationId -ceq $Id -and $Receipt.control -ceq $Control) 'exact_action_receipt_identity'
    Check ($Receipt.state -ceq $State) ('receipt_expected_' + $State + '_actual_' + $Receipt.state)
    $persisted = Read-AdministratorControlReceipt $script:fixture.Status $digest $sid $Id $Control
    Check ($persisted.state -ceq $State) 'returned_receipt_persisted'
    Check ($Receipt.state -cne 'ready' -and $persisted.progress.phase -cne 'ready') 'receipt_does_not_claim_ready'
}
function Check-OriginalReservation([string]$Id,[string]$Control,$Target) {
    $f = $script:fixture
    $row = Read-AdministratorControlRecord $f.Vault $digest $sid $origin $Id $Control
    Check ($null -ne $row -and $row.operationId -ceq $Id -and $row.target -ceq $Target) 'original_id_and_target_reserved'
    Check ($row.runnerIdentity.pid -eq $runner.pid -and $row.runnerIdentity.started -ceq $runner.started -and
        $row.sessionEvidence.mediumPid -eq $session.mediumPid -and $row.sessionEvidence.highPid -eq $session.highPid -and
        $row.sessionEvidence.sessionId -eq $session.sessionId -and $row.sessionEvidence.userSid -ceq $sid) 'original_runner_session_preserved'
    Check (@(Get-ChildItem -LiteralPath $f.Vault -Filter 'control-*.reserved.json').Count -eq 1) 'one_original_reservation'
}
function Get-ReservationText([string]$Id) {
    return [IO.File]::ReadAllText([IO.Path]::Combine($script:fixture.Vault,('control-' + $Id + '.reserved.json')))
}
function Check-NoStartupEffects {
    Check ($script:fixture.Tasks -eq 0 -and $script:fixture.IntentWrites -eq 0) 'no_task_or_lifecycle_effect'
}
function Run-Case([string]$Name,[scriptblock]$Work) {
    $script:cases++
    try {
        $null = & $Work
        Check (-not (Test-FixtureGuardHeld)) 'global_guard_released'
        Check ($script:fixture.Violations.Count -eq 0) ('callback_contract:' + ($script:fixture.Violations -join ','))
        [Console]::WriteLine('PASS ' + $Name)
    } catch {
        $message = $Name + ': ' + $_.Exception.Message
        $script:failures.Add($message)
        [Console]::WriteLine('FAIL ' + $message)
    } finally {
        if ($script:fixture) { foreach ($handle in $script:fixture.Gates) { $handle.Dispose() } }
    }
}

try {
    Run-Case 'connect commits running intent and launches once with durable phases' {
        $f = New-OperationFixture
        $op = '1'*32
        $result = Invoke-FixtureOperation $op 'connect' $f.Target
        Check-Receipt $result $op 'connect' 'launch-requested'
        Check-OriginalReservation $op 'connect' $f.Target
        Check ($f.Audits -eq 1 -and $f.Tasks -eq 1 -and $f.StartupChecks -eq 1 -and $f.Bindings -ge 1) 'connect_callbacks_once'
        Check ($f.IntentWrites -eq 1 -and (Test-AdministratorOwnerIntent $f.State $false)) 'connect_saves_running_intent'
        Check ($f.LastProgress.verifiedFiles -eq 130 -and $f.LastProgress.totalFiles -eq 130) 'full_audit_progress_delivered'
    }
    foreach ($control in @('connect','resume-saved','revoke')) {
        Run-Case ($control + ' duplicate returns original receipt without replay') {
            $f = New-OperationFixture ($control -cne 'resume-saved')
            $op = '2'*32
            $target = if ($control -ceq 'revoke') { $null } else { $f.Target }
            $first = Invoke-FixtureOperation $op $control $target
            $expected = if ($control -ceq 'revoke') { 'revocation-recorded' } else { 'launch-requested' }
            Check-Receipt $first $op $control $expected
            $before = Get-ReservationText $op
            $counts = @($f.Audits,$f.StartupChecks,$f.Tasks,$f.IntentWrites,$f.RevisionWrites)
            $f.Revision = 'e'*32; $f.Generation = 'f'*32
            $again = Invoke-FixtureOperation $op $control $target
            Check-Receipt $again $op $control $expected
            Check ((Get-ReservationText $op) -ceq $before) 'duplicate_preserves_reservation_bytes'
            Check ((@($f.Audits,$f.StartupChecks,$f.Tasks,$f.IntentWrites,$f.RevisionWrites) -join ',') -ceq ($counts -join ',')) 'duplicate_has_no_effects_or_audit'
            Check-OriginalReservation $op $control $target
        }
    }
    foreach ($mutation in @('revision','generation')) {
        Run-Case ('original target ' + $mutation + ' changed during audit is superseded') {
            $f = New-OperationFixture
            $op = '3'*32
            $f.OnAudit = if ($mutation -ceq 'revision') { { $script:fixture.Revision = 'e'*32 } } else { { $script:fixture.Generation = 'f'*32 } }
            Check-Receipt (Invoke-FixtureOperation $op 'connect' $f.Target) $op 'connect' 'superseded'
            Check-OriginalReservation $op 'connect' $f.Target
            Check ($f.Audits -eq 1) 'stale_comparison_after_audit'
            Check-NoStartupEffects
            Check ($f.RevisionWrites -eq 0) 'stale_request_does_not_retarget_live_revision'
        }
    }
    foreach ($control in @('connect','resume-saved')) {
        Run-Case ('pause during ' + $control + ' audit wins') {
            $f = New-OperationFixture ($control -ceq 'connect')
            $op = '4'*32
            $f.OnAudit = {
                $f = $script:fixture
                $previous = $f.ActiveControl; $f.ActiveControl = 'pause'
                try {
                    $f.PauseReceipt = Request-AdministratorOwnerPause $f.Bundle $digest $sid ('5'*32) $f.Target $f.VerifyBinding
                } finally { $f.ActiveControl = $previous }
            }
            Check-Receipt (Invoke-FixtureOperation $op $control $f.Target) $op $control 'superseded'
            Check ($f.PauseReceipt.state -cin @('pause-recorded','stopped')) 'pause_committed_during_audit'
            Check ($f.Tasks -eq 0 -and $f.IntentWrites -eq 1 -and (Test-AdministratorOwnerIntent $f.State $true)) 'startup_cannot_clear_concurrent_pause'
            Check ($f.Revision -ceq ('5'*32)) 'pause_revision_kept'
        }
        Run-Case ('revoke during ' + $control + ' audit wins') {
            $f = New-OperationFixture ($control -ceq 'connect')
            $op = '6'*32
            $f.OnAudit = { $script:fixture.RevokeReceipt = Invoke-FixtureOperation ('7'*32) 'revoke' $null }
            Check-Receipt (Invoke-FixtureOperation $op $control $f.Target) $op $control 'superseded'
            Check-Receipt $f.RevokeReceipt ('7'*32) 'revoke' 'revocation-recorded'
            Check ([IO.File]::Exists($f.Revoked) -and (Test-AdministratorOwnerIntent $f.State $true)) 'revoke_deny_and_pause_preserved'
            Check ($f.Tasks -eq 0 -and $f.Audits -eq 1 -and $f.IntentWrites -eq 1) 'revoke_does_not_run_startup_callbacks'
        }
    }
    foreach ($control in @('connect','resume-saved')) {
        Run-Case ($control + ' denied startup eligibility is rejected without effects') {
            $f = New-OperationFixture ($control -ceq 'connect')
            $f.Eligible = $false
            $op = '8'*32
            $before = [IO.File]::ReadAllText($f.Intent)
            Check-Receipt (Invoke-FixtureOperation $op $control $f.Target) $op $control 'rejected'
            Check ($f.Audits -eq 1 -and $f.StartupChecks -eq 1) 'denial_checks_new_startup'
            Check-NoStartupEffects
            Check ([IO.File]::ReadAllText($f.Intent) -ceq $before) 'denial_preserves_intent_bytes'
            Check-OriginalReservation $op $control $f.Target
        }
    }
    Run-Case 'resume requires saved-running intent and never rewrites lifecycle' {
        $f = New-OperationFixture $false
        $op = '9'*32
        $before = [IO.File]::ReadAllText($f.Intent)
        $modified = [IO.File]::GetLastWriteTimeUtc($f.Intent)
        Check-Receipt (Invoke-FixtureOperation $op 'resume-saved' $f.Target) $op 'resume-saved' 'launch-requested'
        Check ($f.Tasks -eq 1 -and $f.IntentWrites -eq 0) 'resume_task_without_lifecycle_writer'
        Check ([IO.File]::ReadAllText($f.Intent) -ceq $before -and [IO.File]::GetLastWriteTimeUtc($f.Intent) -eq $modified) 'resume_lifecycle_unchanged'
        Check-OriginalReservation $op 'resume-saved' $f.Target
    }
    Run-Case 'resume cannot clear an existing pause even when startup check says true' {
        $f = New-OperationFixture $true
        $op = 'a'*32
        $before = [IO.File]::ReadAllText($f.Intent)
        Check-Receipt (Invoke-FixtureOperation $op 'resume-saved' $f.Target) $op 'resume-saved' 'rejected'
        Check-NoStartupEffects
        Check ([IO.File]::ReadAllText($f.Intent) -ceq $before -and (Test-AdministratorOwnerIntent $f.State $true)) 'resume_preserves_explicit_pause'
    }
    foreach ($control in @('connect','resume-saved')) {
        Run-Case ($control + ' audit exception leaves original durable reservation, not replay') {
            $f = New-OperationFixture ($control -ceq 'connect')
            $f.ThrowAudit = $true
            $op = 'b'*32
            try { $null = Invoke-FixtureOperation $op $control $f.Target }
            catch { Check ($_.Exception.Message -match 'fixture_audit_exception') 'expected_audit_callback_exception' }
            Check-OriginalReservation $op $control $f.Target
            Check-NoStartupEffects
            Check (-not (Test-FixtureGuardHeld)) 'audit_exception_releases_global_guard'
            $before = Get-ReservationText $op
            $prior = Read-AdministratorControlReceipt $f.Status $digest $sid $op $control
            Check ($prior.state -ceq 'reserved') 'audit_exception_remains_recoverable_not_success'
            $f.ThrowAudit = $false
            Check-Receipt (Invoke-FixtureOperation $op $control $f.Target) $op $control 'reserved'
            Check ($f.Audits -eq 1 -and (Get-ReservationText $op) -ceq $before) 'audit_exception_same_id_never_reaudits'
            $lease = Open-AdministratorControlExecution $f.Vault $op
            try { Check $lease.CanWrite 'audit_exception_releases_execution_lease_for_recovery' } finally { $lease.Dispose() }
        }
    }
    foreach ($taskOutcome in @('unknown','exception')) {
        Run-Case ('task ' + $taskOutcome + ' stays launch-unconfirmed and cannot replay') {
            $f = New-OperationFixture
            $f.RequestResult = $false; $f.ThrowTask = ($taskOutcome -ceq 'exception')
            $op = 'c'*32
            Check-Receipt (Invoke-FixtureOperation $op 'connect' $f.Target) $op 'connect' 'launch-unconfirmed'
            $before = Get-ReservationText $op
            Check-Receipt (Invoke-FixtureOperation $op 'connect' $f.Target) $op 'connect' 'launch-unconfirmed'
            Check ($f.Tasks -eq 1 -and $f.Audits -eq 1 -and $f.IntentWrites -eq 1) 'unknown_launch_no_retry'
            Check ((Get-ReservationText $op) -ceq $before) 'unknown_launch_reservation_unchanged'
        }
    }
    Run-Case 'intent writer exception retains write-ahead record without task replay' {
        $f = New-OperationFixture
        $f.ThrowIntent = $true
        $op = 'd'*32
        try { $null = Invoke-FixtureOperation $op 'connect' $f.Target }
        catch { Check ($_.Exception.Message -match 'fixture_intent_exception') 'expected_intent_callback_exception' }
        Check-OriginalReservation $op 'connect' $f.Target
        Check ($null -ne (Read-AdministratorControlPhase $f.Vault $digest $sid $op 'connect' 'intent-write-started')) 'intent_failure_phase_durable'
        $before = Get-ReservationText $op
        $f.ThrowIntent = $false
        $prior = Read-AdministratorControlReceipt $f.Status $digest $sid $op 'connect'
        Check ($prior.state -cnotin @('launch-requested','launch-unconfirmed')) 'failed_intent_never_claims_launch'
        Check-Receipt (Invoke-FixtureOperation $op 'connect' $f.Target) $op 'connect' $prior.state
        Check ($f.Tasks -eq 0 -and $f.IntentWrites -eq 1 -and $f.Audits -eq 1) 'intent_exception_never_replays_effect'
        Check ((Get-ReservationText $op) -ceq $before) 'intent_exception_original_reservation'
    }
    Run-Case 'revoke allows null target and unknown generation without startup callbacks' {
        $f = New-OperationFixture $false 'unknown'
        $op = 'e'*32
        $f.Eligible = $false; $f.ThrowAudit = $true; $f.ThrowTask = $true
        Check-Receipt (Invoke-FixtureOperation $op 'revoke' $null) $op 'revoke' 'revocation-recorded'
        Check-OriginalReservation $op 'revoke' $null
        $row = Read-AdministratorControlRecord $f.Vault $digest $sid $origin $op 'revoke'
        Check ($null -eq $row.observedGeneration) 'unknown_revocation_generation_not_invented'
        Check ($f.Audits -eq 0 -and $f.StartupChecks -eq 0 -and $f.Tasks -eq 0) 'revoke_bypasses_full_startup'
        Check ($f.IntentWrites -eq 1 -and [IO.File]::Exists($f.Revoked) -and (Test-AdministratorOwnerIntent $f.State $true)) 'revoke_marker_then_pause'
        Check (-not [IO.File]::Exists([IO.Path]::Combine($f.Vault,('control-'+$op+'.phase-launch-attempted.json')))) 'revoke_never_attempts_launch'
    }
    Run-Case 'revoke proceeds while an unrelated startup execution lease is held' {
        $f = New-OperationFixture $false
        $other = 'f'*32; $op = '0'*32
        $lease = Open-AdministratorControlExecution $f.Vault $other
        try {
            Check-Receipt (Invoke-FixtureOperation $op 'revoke' $null) $op 'revoke' 'revocation-recorded'
            Check $lease.CanWrite 'unrelated_startup_lease_still_owned'
            Check ($f.Audits -eq 0 -and $f.StartupChecks -eq 0 -and $f.Tasks -eq 0) 'held_startup_lease_cannot_block_revoke_callbacks'
        } finally { $lease.Dispose() }
    }
    Run-Case 'revoke rejects an existing forbidden launch phase before effects' {
        $f = New-OperationFixture $false
        $op = '3'*32
        $forbidden = [IO.Path]::Combine($f.Vault,('control-'+$op+'.phase-launch-attempted.json'))
        [IO.File]::WriteAllText($forbidden,'corrupt-launch-artifact')
        $caught = $null
        try { $null = Invoke-FixtureOperation $op 'revoke' $null }
        catch { $caught = $_.Exception.Message }
        Check ($caught -ceq 'owner_control_unexpected_phase') 'forbidden_revoke_phase_rejected_explicitly'
        Check-NoStartupEffects
        Check (-not [IO.File]::Exists($f.Revoked) -and $f.Audits -eq 0) 'corrupt_phase_has_no_revocation_or_audit_effect'
        Check ([IO.File]::ReadAllText($forbidden) -ceq 'corrupt-launch-artifact') 'forbidden_artifact_not_rewritten'
        Refuse { Get-AdministratorControlPhaseBytes $digest $op 'revoke' 'launch-attempted' $null } 'revoke_phase_serializer_stays_closed'
    }
    foreach ($firstControl in @('connect','resume-saved','revoke')) {
        foreach ($secondControl in @('connect','resume-saved','revoke')) {
            if ($firstControl -ceq $secondControl) { continue }
            Run-Case ($firstControl + ' ID cannot be reused as ' + $secondControl) {
                $f = New-OperationFixture ($firstControl -cne 'resume-saved')
                $op = '1'*32
                $firstTarget = if ($firstControl -ceq 'revoke') { $null } else { $f.Target }
                $null = Invoke-FixtureOperation $op $firstControl $firstTarget
                $before = Get-ReservationText $op
                $counts = @($f.Audits,$f.StartupChecks,$f.Tasks,$f.IntentWrites,$f.RevisionWrites)
                $secondTarget = if ($secondControl -ceq 'revoke') { $null } else { $f.Target }
                Refuse { Invoke-FixtureOperation $op $secondControl $secondTarget } 'cross_action_collision_must_throw'
                Check ((Get-ReservationText $op) -ceq $before) 'cross_action_collision_preserves_original_bytes'
                Check ((@($f.Audits,$f.StartupChecks,$f.Tasks,$f.IntentWrites,$f.RevisionWrites) -join ',') -ceq ($counts -join ',')) 'cross_action_collision_has_no_effects'
            }
        }
    }
    Run-Case 'same-action ID cannot be rebound to another target' {
        $f = New-OperationFixture
        $op = '2'*32
        $null = Invoke-FixtureOperation $op 'connect' $f.Target
        $before = Get-ReservationText $op
        Refuse { Invoke-FixtureOperation $op 'connect' (('e'*32)+':idle') } 'same_id_target_collision_must_throw'
        Check ((Get-ReservationText $op) -ceq $before -and $f.Audits -eq 1 -and $f.Tasks -eq 1 -and $f.IntentWrites -eq 1) 'target_collision_no_replay'
    }
    if ($script:failures.Count) {
        throw ('control_operation_tests_failed:' + $script:failures.Count + '/' + $script:cases + [Environment]::NewLine + ($script:failures -join [Environment]::NewLine))
    }
    [Console]::WriteLine(('{"ok":true,"scope":"scratch-control-operation-not-installed-runtime","cases":' + $script:cases + ',"checks":' + $script:checks + '}'))
} finally {
    if ($script:fixture) { foreach ($handle in $script:fixture.Gates) { $handle.Dispose() } }
    $resolved = [IO.Path]::GetFullPath($scratch)
    $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolved) -cnotmatch '\Aac-control-operation-test-[a-f0-9]{32}\z' -or
        ([IO.File]::GetAttributes($resolved) -band [IO.FileAttributes]::ReparsePoint)) { throw 'cleanup_scope' }
    foreach ($entry in Get-ChildItem -LiteralPath $resolved -Recurse -Force) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'cleanup_reparse' }
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
