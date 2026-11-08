[CmdletBinding()]
param()

$ErrorActionPreference='Stop'
$source=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'))
$tokens=$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'stager_parse' }
$helpers=@('To-Hex','Assert-PathType','Test-AdministratorOwnerAbsent','Test-AdministratorOwnerIntent',
    'Test-AdministratorOwnerRunIntent','Test-AdministratorBrowserPauseTarget','Write-HostedWindowSignal',
    'Write-AdministratorOwnerFile','Assert-AdministratorOwnerBytes','Get-AdministratorPauseReceiptBytes',
    'Read-AdministratorOwnerPause','Publish-AdministratorOwnerPause','Get-AdministratorPauseReservationBytes',
    'Publish-AdministratorPauseReservation','Request-AdministratorOwnerPause')
foreach ($node in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$true)) {
    if ($node.Name -cmatch '\A(?:Test|Assert|Get|Read|Publish|Reserve|Fence|Resolve|Open|Invoke)-AdministratorControl' -or $node.Name -cin $helpers) {
        . ([scriptblock]::Create($node.Extent.Text))
    }
}
# Reuse only scratch fixture definitions, not its test body or any stager dispatch.
$fixtureSource=Join-Path $PSScriptRoot 'windows-admin-control-operation-tests.ps1'
$fixtureAst=[Management.Automation.Language.Parser]::ParseFile($fixtureSource,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'fixture_parse' }
foreach ($node in $fixtureAst.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$true)) {
    . ([scriptblock]::Create($node.Extent.Text))
}
$scratch=[IO.Path]::Combine([IO.Path]::GetTempPath(),('ac-control-handoff-'+[Guid]::NewGuid().ToString('N')))
$null=[IO.Directory]::CreateDirectory($scratch)
$script:checks=0; $script:cases=0
$script:failures=[Collections.Generic.List[string]]::new()
$script:fixture=$null
$digest='a'*64; $sid='S-1-5-21-1-2-3-1001'; $usersSid=$sid
$origin='chrome-extension://'+('c'*32)+'/'
$runner=@{pid=600;started='639296000000000000'}
$session=@{mediumPid=500;mediumStarted='639295999999999999';highPid=600;
    highStarted='639296000000000000';sessionId=1;userSid=$sid}
$script:mock=$null

function New-HandoffFixture {
    $f=New-OperationFixture
    $f.ActiveId='1'*32; $f.ActiveControl='connect'
    $f.Handoffs=0; $f.AliveChecks=0
    return $f
}
function Get-HandoffBytes([string]$Mode='control',$Pair=$session) {
    $r=@{pid=$Pair.highPid;started=$Pair.highStarted}
    return Get-AdministratorControlHandoffBytes $digest $sid $origin $script:fixture.ActiveId 'connect' $Mode $r $Pair
}
function Publish-Handoff([scriptblock]$Alive={ $true },[string]$Mode='control',$Pair=$session) {
    $r=@{pid=$Pair.highPid;started=$Pair.highStarted}
    return Publish-AdministratorControlHandoff $script:fixture.Bundle $digest $sid $origin $script:fixture.ActiveId 'connect' $Mode $r $Pair $Alive
}
function Test-Ack($Bytes,[string]$Mode='control') {
    return Read-AdministratorControlHandoff $script:fixture.Status $digest $sid $script:fixture.ActiveId 'connect' $Mode $Bytes.HandoffId
}
function Get-PeerPath($Bytes) { return Join-Path $script:fixture.Vault ('control-'+$Bytes.HandoffId+'.peer.json') }
function Get-AckPath($Bytes) { return Join-Path $script:fixture.Status ('control-'+$Bytes.HandoffId+'.handoff.json') }
function Seed-Original {
    $f=$script:fixture
    $gate=Open-AdministratorOwnerControl $f.Vault
    try {
        Check (Reserve-AdministratorControlOperation $f.Vault $digest $sid $origin $f.ActiveId 'connect' $f.Target 'idle' $runner $session) 'seed_reservation'
        Publish-AdministratorControlReceipt $f.Status $digest $sid $f.ActiveId 'connect' 'reserved'
    } finally { $gate.Dispose() }
}
function Invoke-HandoffOperation([scriptblock]$Handoff) {
    $f=$script:fixture
    return Invoke-AdministratorControlOperation $f.Bundle $digest $sid $origin $f.ActiveId 'connect' $f.Target $runner $session `
        $f.VerifyBinding $f.Audit $f.CheckStartup $f.RequestTask $Handoff
}
function Invoke-HandoffRecovery([scriptblock]$Handoff,[switch]$FenceOnly,[scriptblock]$Gone={ $true }) {
    $f=$script:fixture
    return Invoke-AdministratorControlRecovery $f.Bundle $digest $sid $origin $f.ActiveId 'connect' $f.VerifyBinding $Gone -Handoff $Handoff -FenceOnly:$FenceOnly
}
function New-MockAdmission([int]$HighPid=600,[string]$HighStarted='639296000000000000') {
    $w=[pscustomobject]@{Alive=$true;DisposeCount=0}
    $w|Add-Member ScriptMethod Dispose { $this.Alive=$false; $this.DisposeCount++ }
    $pairSession=$session.Clone();$pairSession.highPid=$HighPid;$pairSession.highStarted=$HighStarted
    $script:mock=@{Calls=[Collections.Generic.List[string]]::new();Witness=$w;Acquired=$false;BindingResult=$true;FailAt='';
        Runner=@{pid=$HighPid;started=$HighStarted};Session=$pairSession}
    return $script:mock
}
# Actual handoff/transaction/immutable-store code runs against imported scratch
# owner/ACL/lifecycle callbacks. These three additional seams replace OS acquisition.
function Read-AdministratorControlPeerSource($Archive,$Digest) {
    $script:mock.Calls.Add('source')
    if ($script:mock.FailAt -ceq 'source') { throw 'fixture_source' }
    return ,([byte[]]@(1))
}
function Get-AdministratorControlPeerType($Source,$CompilerTemp) {
    $script:mock.Calls.Add('compile')
    if ($script:mock.FailAt -ceq 'compile') { throw 'fixture_compile' }
    return [string]
}
function Open-AdministratorControlKernelSession($PeerType,$BundleRoot,$Digest,$Origin,$Id,$Control,$Mode,$Target,$CallerPid,$CallerStarted,$SessionId,$Sid) {
    $script:mock.Calls.Add('pair')
    if ($script:mock.FailAt -ceq 'pair') { throw 'fixture_pair' }
    $script:mock.Acquired=$true
    return @{Witness=$script:mock.Witness;Runner=$script:mock.Runner;Session=$script:mock.Session}
}
function Test-AdministratorControlRunnerExited($Runner) {
    $script:mock.Calls.Add('runner-exited')
    return $true
}
function Invoke-MockKernel([string]$Mode='control') {
    $f=$script:fixture
    $binding={
        $script:mock.Calls.Add('binding')
        if ($script:mock.Acquired) { Observe (Test-FixtureGuardHeld) 'later_binding_under_guard' }
        else { Observe (-not (Test-FixtureGuardHeld)) 'pre_binding_before_acquisition' }
        return $script:mock.BindingResult
    }
    return Invoke-AdministratorControlKernelOperation $null $scratch $f.Bundle $digest $origin $f.ActiveId 'connect' $Mode `
        $(if($Mode -ceq 'control'){$f.Target}else{$null}) 500 $session.mediumStarted 1 $sid `
        $binding $f.Audit $f.CheckStartup $f.RequestTask
}

try {
    Run-Case 'closed pair and public projection distinguish handoff from Ready or permission' {
        $f=New-HandoffFixture; $b=Get-HandoffBytes
        $p=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString($b.Private))
        $a=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString($b.Public))
        Check ($b.Private.Length -le 2048 -and $b.Public.Length -le 2048) 'bounded_documents'
        Check ($p.runnerIdentity.pid -eq 600 -and $p.sessionEvidence.mediumPid -eq 500) 'actual_pair_projection'
        Check ($p.kind -ceq 'control-peer' -and $a.kind -ceq 'control-handoff' -and $a.state -ceq 'validated') 'handoff_not_ready'
        Check (($a.PSObject.Properties.Name -join ',') -ceq 'version,kind,bundleSha256,operationId,control,mode,handoffId,state') 'public_closed_fields'
        Check ([Text.Encoding]::UTF8.GetString($b.Public).IndexOf($sid,[StringComparison]::Ordinal) -eq -1) 'no_public_sid'
        Check ($b.HandoffId -ceq (Get-HandoffBytes).HandoffId) 'deterministic_identity'
    }
    foreach ($field in @('mediumPid','mediumStarted','highPid','highStarted','sessionId','userSid')) {
        Run-Case ('pair field participates or is refused: '+$field) {
            $f=New-HandoffFixture; $baseline=Get-HandoffBytes; $p=$session.Clone()
            switch ($field) {
                'mediumPid' {$p[$field]=501}
                'mediumStarted' {$p[$field]='639295999999999998'}
                'highPid' {$p[$field]=601}
                'highStarted' {$p[$field]='639296000000000001'}
                'sessionId' {$p[$field]=2}
                'userSid' {$p[$field]='S-1-5-21-1-2-3-1002'}
            }
            if($field -ceq 'userSid'){Refuse {Get-HandoffBytes 'control' $p} 'sid_mismatch_refused'}
            else{Check ((Get-HandoffBytes 'control' $p).HandoffId -cne $baseline.HandoffId) 'pair_change_has_separate_record'}
        }
    }
    foreach($bad in @('Control','','other')) {
        Run-Case ('noncanonical mode refused: '+$bad) { $f=New-HandoffFixture; Refuse {Get-HandoffBytes $bad} 'bad_mode' }
    }
    Run-Case 'invalid ticks PID and session are refused' {
        $f=New-HandoffFixture
        foreach($v in @('0','01','3155378976000000000','n/a')) {
            $p=$session.Clone();$p.mediumStarted=$v
            Refuse {Get-HandoffBytes 'control' $p} 'bad_ticks'
        }
        foreach($field in @('mediumPid','highPid','sessionId')) {
            $p=$session.Clone();$p[$field]=0
            Refuse {Get-HandoffBytes 'control' $p} 'bad_integer'
        }
    }
    Run-Case 'private precedes public and acknowledgement is exact idempotent evidence' {
        $f=New-HandoffFixture; $b=Get-HandoffBytes
        Check (-not (Test-Ack $b)) 'absent_ack_false'
        $alive={
            $script:fixture.AliveChecks++
            if($script:fixture.AliveChecks -eq 2){Check ([IO.File]::Exists((Get-PeerPath $b))) 'private_before_second_live_check'}
            Check (-not [IO.File]::Exists((Get-AckPath $b))) 'no_ack_before_commit'
            return $true
        }
        Check ((Publish-Handoff $alive) -ceq $b.HandoffId) 'published_identity'
        Check (Test-Ack $b) 'readback_exact'
        $before=[IO.File]::ReadAllText((Get-PeerPath $b))
        $null=Publish-Handoff
        Check ([IO.File]::ReadAllText((Get-PeerPath $b)) -ceq $before) 'idempotent_no_replacement'
        Check (-not (Test-Ack $b 'fence')) 'wrong_mode_refused'
        [IO.File]::AppendAllText((Get-AckPath $b),' ')
        Check (-not (Test-Ack $b)) 'noncanonical_ack_refused'
    }
    foreach($answer in @($false,$null,1,'true')) {
        Run-Case ('nontrue liveness refuses before publication: '+[string]$answer) {
            $f=New-HandoffFixture; $b=Get-HandoffBytes
            Refuse {Publish-Handoff {return $answer}} 'not_exact_true'
            Check (-not [IO.File]::Exists((Get-PeerPath $b)) -and -not (Test-Ack $b)) 'no_evidence_for_dead_peer'
        }
    }
    Run-Case 'death between checks leaves private-only evidence without acknowledgement' {
        $f=New-HandoffFixture; $b=Get-HandoffBytes
        Refuse {Publish-Handoff {$script:fixture.AliveChecks++;return $script:fixture.AliveChecks -eq 1}} 'peer_died_between_checks'
        Check ([IO.File]::Exists((Get-PeerPath $b)) -and -not (Test-Ack $b)) 'private_only_not_handoff'
    }
    Run-Case 'final sample is admission point; acknowledgement needs no later peer liveness sample' {
        $f=New-HandoffFixture; $b=Get-HandoffBytes
        $null=Publish-Handoff {$script:fixture.AliveChecks++;return $script:fixture.AliveChecks -le 2}
        Check ($f.AliveChecks -eq 2 -and (Test-Ack $b)) 'no_post_ack_liveness_dependency'
    }
    foreach($partial in @($true,$false)) {
        Run-Case ('replacement high runner gets its own handoff after private-only='+$partial) {
            $f=New-HandoffFixture; $first=Get-HandoffBytes
            if($partial){Refuse {Publish-Handoff {$script:fixture.AliveChecks++;return $script:fixture.AliveChecks -eq 1}} 'first_partial'}
            else{$null=Publish-Handoff}
            $p=$session.Clone();$p.highPid=601;$p.highStarted='639296000000000001'
            $second=Get-HandoffBytes 'control' $p
            $null=Publish-Handoff {$true} 'control' $p
            Check ($first.HandoffId -cne $second.HandoffId -and (Test-Ack $second)) 'replacement_not_collision'
            Check ([IO.File]::Exists((Get-PeerPath $first))) 'old_evidence_preserved'
        }
    }
    Run-Case 'private corruption prevents public handoff' {
        $f=New-HandoffFixture;$b=Get-HandoffBytes
        [IO.File]::WriteAllText((Get-PeerPath $b),'{}')
        Refuse {Publish-Handoff} 'private_collision'
        Check (-not (Test-Ack $b)) 'no_ack_after_private_failure'
    }
    Run-Case 'public collision leaves private evidence but does not acknowledge' {
        $f=New-HandoffFixture;$b=Get-HandoffBytes
        [IO.File]::WriteAllText((Get-AckPath $b),'{}')
        Refuse {Publish-Handoff} 'public_collision'
        Check ([IO.File]::Exists((Get-PeerPath $b)) -and -not (Test-Ack $b)) 'public_failure_not_success'
    }
    Run-Case 'transaction handoff holds both guards and precedes audit and effects' {
        $f=New-HandoffFixture
        $f.OnAudit={Observe ($script:fixture.Handoffs -eq 1) 'handoff_precedes_audit'}
        $r=Invoke-HandoffOperation {
            Observe (Test-FixtureGuardHeld) 'handoff_under_global_guard'
            Refuse {Open-AdministratorControlExecution $script:fixture.Vault $script:fixture.ActiveId} 'handoff_holds_execution_lease'
            Observe ($null -ne (Read-AdministratorControlRecord $script:fixture.Vault $digest $sid $origin $script:fixture.ActiveId 'connect')) 'reservation_before_handoff'
            Observe ($script:fixture.Audits -eq 0 -and $script:fixture.Tasks -eq 0 -and $script:fixture.IntentWrites -eq 0) 'handoff_before_effects'
            $script:fixture.Handoffs++
        }
        Check-Receipt $r $f.ActiveId 'connect' 'launch-requested'
        Check ($f.Handoffs -eq 1 -and $f.Tasks -eq 1) 'handoff_and_task_once'
    }
    Run-Case 'handoff failure leaves original recoverable without audit or launch' {
        $f=New-HandoffFixture
        Refuse {Invoke-HandoffOperation {throw 'fixture_handoff_failure'}} 'handoff_error_propagates'
        Check-NoStartupEffects
        Check ($f.Audits -eq 0) 'no_audit_after_handoff_failure'
        Check-OriginalReservation $f.ActiveId 'connect' $f.Target
        Check ((Invoke-HandoffRecovery {$null=Publish-Handoff} -FenceOnly).state -ceq 'reserved') 'fence_only_does_not_recover_admitted'
    }
    foreach($mode in @('control','fence','reconcile')) {
        Run-Case ('active original '+$mode+' returns readback with actual sharing exclusion, no replay') {
            $f=New-HandoffFixture;Seed-Original
            $before=Get-ReservationText $f.ActiveId
            $lease=Open-AdministratorControlExecution $f.Vault $f.ActiveId
            try {
                $h={$script:fixture.Handoffs++;$null=Publish-Handoff {$true} $mode}
                $r=if($mode -ceq 'control'){Invoke-HandoffOperation $h}else{
                    Invoke-HandoffRecovery $h -FenceOnly:($mode -ceq 'fence') -Gone {throw 'busy_must_not_probe_runner'}
                }
                Check-Receipt $r $f.ActiveId 'connect' 'reserved'
                Refuse {Open-AdministratorControlExecution $f.Vault $f.ActiveId} 'original_lease_still_owned'
            }finally{$lease.Dispose()}
            Check ((Get-ReservationText $f.ActiveId) -ceq $before) 'original_identity_unchanged'
            Check ($f.Handoffs -eq 1 -and $f.Audits -eq 0) 'busy_only_handoff_readback'
            Check-NoStartupEffects
        }
    }
    Run-Case 'busy without durable original refuses handoff and all effects' {
        $f=New-HandoffFixture;$lease=Open-AdministratorControlExecution $f.Vault $f.ActiveId
        try{Refuse {Invoke-HandoffOperation {$script:fixture.Handoffs++}} 'missing_busy_record_refused'}finally{$lease.Dispose()}
        Check ($f.Handoffs -eq 0) 'no_busy_handoff_without_record'
        Check-NoStartupEffects
    }
    foreach($fence in @($true,$false)) {
        Run-Case ('missing original fenced durably before ACK, fenceOnly='+$fence) {
            $f=New-HandoffFixture
            $r=Invoke-HandoffRecovery {
                Observe ($null -ne (Read-AdministratorControlRecord $script:fixture.Vault $digest $sid $origin $script:fixture.ActiveId 'connect' -Tombstone)) 'tombstone_before_ack'
                Observe ((Read-AdministratorControlReceipt $script:fixture.Status $digest $sid $script:fixture.ActiveId 'connect').state -ceq 'fenced') 'fenced_receipt_before_ack'
                $null=Publish-Handoff {$true} $(if($fence){'fence'}else{'reconcile'})
            } -FenceOnly:$fence -Gone {throw 'missing_runner_not_probed'}
            Check-Receipt $r $f.ActiveId 'connect' 'fenced'
            Check ((Invoke-HandoffOperation {$null=Publish-Handoff}).state -ceq 'fenced') 'late_original_fenced'
            Check ($f.Audits -eq 0) 'no_replay_audit';Check-NoStartupEffects
        }
    }
    Run-Case 'fence publication survives failed ACK and blocks delayed original' {
        $f=New-HandoffFixture
        Refuse {Invoke-HandoffRecovery {throw 'ack_failed'} -FenceOnly} 'ack_failure'
        Check ((Invoke-HandoffOperation {$null=Publish-Handoff}).state -ceq 'fenced') 'fenced_before_uncertain_ack'
        Check-NoStartupEffects
    }
    Run-Case 'integrated entry detaches only after exact handoff while later binding remains checked' {
        $f=New-HandoffFixture;$m=New-MockAdmission;$b=Get-HandoffBytes
        $f.OnAudit={
            Observe ($script:mock.Witness.DisposeCount -eq 1 -and -not $script:mock.Witness.Alive) 'peer_released_before_long_audit'
            Observe (Test-Ack $b) 'ack_before_audit'
        }
        $r=Invoke-MockKernel
        Check-Receipt $r $f.ActiveId 'connect' 'launch-requested'
        Check (($m.Calls.ToArray()[0..3] -join ',') -ceq 'binding,source,compile,pair') 'binding_before_acquisition'
        Check (@($m.Calls|Where-Object{$_ -ceq 'binding'}).Count -ge 4 -and $m.Witness.DisposeCount -eq 1) 'binding_after_handoff_and_single_disposal'
    }
    foreach($bad in @($false,$null,1,'true')) {
        Run-Case ('integrated binding requires exact true: '+[string]$bad) {
            $f=New-HandoffFixture;$m=New-MockAdmission;$m.BindingResult=$bad
            Refuse {Invoke-MockKernel} 'binding_refused'
            Check (($m.Calls -join ',') -ceq 'binding' -and -not $m.Acquired) 'no_acquisition_after_failed_binding'
            Check-NoStartupEffects
        }
    }
    Run-Case 'late binding failure after handoff prevents effects but preserves ACK' {
        $f=New-HandoffFixture;$m=New-MockAdmission;$b=Get-HandoffBytes
        $f.OnAudit={$script:mock.BindingResult=$false}
        Refuse {Invoke-MockKernel} 'late_binding_refused'
        Check ($m.Witness.DisposeCount -eq 1 -and (Test-Ack $b)) 'durable_handoff_not_effect_success'
        Check-NoStartupEffects
    }
    Run-Case 'integrated failed handoff disposes witness and skips work' {
        $f=New-HandoffFixture;$m=New-MockAdmission;$m.Witness.Alive=$false
        Refuse {Invoke-MockKernel} 'dead_witness_refused'
        Check ($m.Witness.DisposeCount -eq 1 -and $f.Audits -eq 0) 'failed_witness_disposed'
        Check-NoStartupEffects
    }
    Run-Case 'integrated ACK collision leaves original and private peer, disposes witness without work' {
        $f=New-HandoffFixture;$m=New-MockAdmission;$b=Get-HandoffBytes
        [IO.File]::WriteAllText((Get-AckPath $b),'{}')
        Refuse {Invoke-MockKernel} 'integrated_ack_collision'
        Check-OriginalReservation $f.ActiveId 'connect' $f.Target
        Check ([IO.File]::Exists((Get-PeerPath $b)) -and -not (Test-Ack $b)) 'private_only_after_failed_ack'
        Check ($m.Witness.DisposeCount -eq 1 -and $f.Audits -eq 0) 'failed_ack_releases_witness_before_work'
        Check-NoStartupEffects
    }
    Run-Case 'integrated completed duplicate preserves original receipt and has no new effects' {
        $f=New-HandoffFixture;$m=New-MockAdmission
        $r=Invoke-MockKernel
        Check-Receipt $r $f.ActiveId 'connect' 'launch-requested'
        $before=Get-ReservationText $f.ActiveId
        $counts=@($f.Audits,$f.Tasks,$f.IntentWrites,$f.RevisionWrites) -join ','
        $m=New-MockAdmission
        $again=Invoke-MockKernel
        Check-Receipt $again $f.ActiveId 'connect' 'launch-requested'
        Check ((Get-ReservationText $f.ActiveId) -ceq $before) 'duplicate_original_bytes'
        Check ((@($f.Audits,$f.Tasks,$f.IntentWrites,$f.RevisionWrites) -join ',') -ceq $counts) 'duplicate_no_new_work'
        Check ($m.Witness.DisposeCount -eq 1) 'duplicate_witness_released'
    }
    foreach($mode in @('control','fence','reconcile')) {
        Run-Case ('integrated busy '+$mode+' with replacement high pair preserves original ownership') {
            $f=New-HandoffFixture;Seed-Original
            $before=Get-ReservationText $f.ActiveId
            $m=New-MockAdmission 601 '639296000000000001'
            $b=Get-HandoffBytes $mode $m.Session
            $lease=Open-AdministratorControlExecution $f.Vault $f.ActiveId
            try {
                $r=Invoke-MockKernel $mode
                Check-Receipt $r $f.ActiveId 'connect' 'reserved'
                Refuse {Open-AdministratorControlExecution $f.Vault $f.ActiveId} 'busy_original_lease_still_held'
            }finally{$lease.Dispose()}
            Check ((Get-ReservationText $f.ActiveId) -ceq $before) 'busy_original_record_preserved'
            $peer=ConvertFrom-Json ([IO.File]::ReadAllText((Get-PeerPath $b)))
            Check ($peer.runnerIdentity.pid -eq 601 -and $peer.sessionEvidence.highStarted -ceq '639296000000000001') 'new_attempt_has_replacement_pair'
            Check ((Test-Ack $b $mode) -and $m.Witness.DisposeCount -eq 1) 'busy_wrapper_durable_handoff_disposed'
            Check ($f.Audits -eq 0 -and $m.Calls -cnotcontains 'runner-exited') 'busy_wrapper_only_readback'
            Check-NoStartupEffects
        }
    }
    foreach($mode in @('fence','reconcile')) {
        Run-Case ('integrated '+$mode+' does not create fake reservation or launch') {
            $f=New-HandoffFixture;$m=New-MockAdmission
            $r=Invoke-MockKernel $mode
            Check-Receipt $r $f.ActiveId 'connect' 'fenced'
            Check (@(Get-ChildItem -LiteralPath $f.Vault -Filter '*.reserved.json').Count -eq 0) 'no_fake_reservation'
            Check ($m.Witness.DisposeCount -eq 1 -and $m.Calls -cnotcontains 'runner-exited') 'missing_original_no_runner_probe'
            Check-NoStartupEffects
        }
    }
} finally {
    $resolved=[IO.Path]::GetFullPath($scratch)
    if(-not $resolved.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolved) -cnotmatch '\Aac-control-handoff-[a-f0-9]{32}\z'){throw 'cleanup_scope'}
    if(Test-Path -LiteralPath $resolved){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
$hash=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
ConvertTo-Json -Compress -Depth 5 ([ordered]@{ok=($script:failures.Count -eq 0);
    scope='scratch-durable-handoff-with-fake-acquisition-not-protected-or-high-pair-proof';
    cases=$script:cases;assertions=$script:checks;failures=$script:failures.ToArray();stagerSha256=$hash;
    actualExclusiveLease=$true;aclStub=$true;acquisitionStub=$true;actualHighPair=$false;protectedAcceptance=$false;
    fixtureSubstitutions=@('acl-file-creation','owner-identity','guard-revision','generation-lease-state',
        'lifecycle-intent','projection-update','revocation-completion','task-audit-callbacks','source-compiler-peer-acquisition')})
if($script:failures.Count){exit 1}
