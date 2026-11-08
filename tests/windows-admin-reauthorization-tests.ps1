[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'
$tokens=$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'parse'}
$names=@('Restore-AdministratorOwnerAuthorization','Assert-AdministratorReauthorizationQuiescence','Assert-PathType','Test-AdministratorOwnerAbsent','Read-AdministratorOwnerControlRevision',
    'Write-AdministratorOwnerControlRevision','Test-AdministratorOwnerIntent','Write-AdministratorOwnerFile','Write-HostedWindowSignal',
    'Update-AdministratorBrowserPauseTarget','Test-AdministratorBrowserPauseTarget','Read-AdministratorBrowserPauseTargetProjection','Test-AdministratorControlFields')
$definitions=@{}
foreach($node in $ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst]},$true)){
    if($node.Name -cin $names){$definitions[$node.Name]=$node.Extent.Text}
}
foreach($name in $names){if(-not $definitions.ContainsKey($name)){throw ('missing:'+ $name)};. ([scriptblock]::Create($definitions[$name]))}
$scratch=Join-Path ([IO.Path]::GetTempPath()) ('ac-reauthorize-'+[Guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($scratch)
$digest='a'*64;$sid='S-1-5-21-1-2-3-1001';$origin='chrome-extension://'+('c'*32)+'/'
$previous='b'*32;$id='d'*32;$script:checks=0;$script:fixture=$null
function Check($Value,$Name){if(-not $Value){throw $Name};$script:checks++}
function Scoped($Path){if(-not [IO.Path]::GetFullPath($Path).StartsWith($scratch+'\',[StringComparison]::Ordinal)){throw 'scratch_only'}}
# Filesystem semantics only. These stubs do not prove protected Windows ACLs.
function Assert-SealedAcl($Path,$Directory,$Private=$false,$ReaderSid=''){Scoped $Path;if(-not (Test-Path -LiteralPath $Path)){throw 'fixture_missing'}}
function Assert-AdministratorOwnerControlIdentity($Root,$Digest,$Sid){Check ($Digest -ceq $script:digest -and $Sid -ceq $script:sid) 'identity';Scoped $Root}
function Assert-AdministratorOwnerBytes($File,$Bytes){Check ([Convert]::ToBase64String([IO.File]::ReadAllBytes($File)) -ceq [Convert]::ToBase64String($Bytes)) 'bytes'}
function Open-SealedNewFile($Path,$Private=$false,$ReaderSid='',[IO.FileShare]$Share='None'){
    Scoped $Path
    if($script:fixture.FailCommit -and $Path.EndsWith('.committed.json')){throw 'fixture_commit_failure'}
    if($script:fixture.FailStart -and $Path.EndsWith('.started.json')){throw 'fixture_start_failure'}
    return [IO.File]::Open($Path,'CreateNew','Write',$Share)
}
function Open-AdministratorOwnerControl($Vault){Scoped $Vault;return [IO.File]::Open((Join-Path $Vault 'owner-control.guard'),'Open','ReadWrite','None')}
function Get-AdministratorPauseGeneration($Root,$Vault,$Digest,$Sid){return $script:fixture.Generation}
function Read-AdministratorControlRecord($Vault,$Digest,$Sid,$Origin,$Id,$Control){
    if($Origin -cne $script:origin){throw 'record'}
    if($Id -ceq $script:previous -and $Control -ceq 'revoke'){return @{control='revoke'}}
    if($Id -ceq ('e'*32) -and $Control -ceq 'connect'){return @{control='connect';runnerIdentity=@{pid=123;started='123'}}}
    throw 'record'
}
function Read-AdministratorControlReceipt($Status,$Digest,$Sid,$Id,$Control){
    if($Id -ceq $script:previous){return @{state=$script:fixture.RevokeState}}
    return @{state=$script:fixture.RecordState}
}
function Read-AdministratorControlBytes($File,$Private,$Sid){Scoped $File;return ,([IO.File]::ReadAllBytes($File))}
function Test-AdministratorControlRunnerExited($Runner){return -not $script:fixture.LiveRunner}
function Get-AdministratorControlHandoffAckBytes($Digest,$Operation,$Control,$Mode,$Handoff){return ,([byte[]]::new(0))}
function Ensure-SealedDirectory($Path,$Private=$false,$ReaderSid=''){Scoped $Path;$null=[IO.Directory]::CreateDirectory($Path)}
function Publish-AdministratorBrowserControlSupportProjection($Root,$Digest,$Sid,$Target){
    if($script:fixture.FailProjection){throw 'projection'}
    $script:fixture.Projected=$true
}
function Setup {
    $root=Join-Path $scratch ([Guid]::NewGuid().ToString('N'))
    foreach($path in @($root,($root+'.state'),($root+'.secrets'),($root+'.status'),($root+'.browser'))){$null=[IO.Directory]::CreateDirectory($path)}
    [IO.File]::WriteAllBytes(($root+'.browser\pause-launch.json'),[byte[]]::new(0))
    [IO.File]::WriteAllText(($root+'.secrets\owner-control.guard'),$script:previous+"`n",[Text.Encoding]::ASCII)
    [IO.File]::WriteAllText(($root+'.state\lifecycle.json'),'{"format":"agent-continue-lifecycle","version":1,"paused":true}'+"`n",[Text.Encoding]::ASCII)
    [IO.File]::WriteAllBytes(($root+'.secrets\owner-revoked'),[byte[]]::new(0))
    $script:fixture=@{Root=$root;Generation='idle';RevokeState='stopped';Projected=$false;FailProjection=$false;FailCommit=$false;FailStart=$false;Verified=$false;RecordState='launch-requested';LiveRunner=$false}
    return $root
}
function Invoke-Subject($Root,$Operation=$script:id,$Prior=$script:previous){
    Restore-AdministratorOwnerAuthorization $Root $script:digest $script:sid $script:origin $Prior $Operation {
        param($Gate)
        Check ($Gate.CanRead -and $Gate.CanWrite) 'binding_under_guard'
        $script:fixture.Verified=$true
    }
}
function Refuse($Work,$Name){$failed=$false;try{$null=& $Work}catch{$failed=$true};Check $failed $Name}
try {
    $root=Setup
    Check ([IO.File]::ReadAllText($root+'.secrets\owner-control.guard') -ceq ($previous+"`n")) 'fixture_revision'
    Check (Test-AdministratorOwnerIntent ($root+'.state') $true) 'fixture_paused'
    Check ($script:fixture.Generation -ceq 'idle' -and $script:fixture.RevokeState -ceq 'stopped') 'fixture_terminal'
    $answer=Invoke-Subject $root
    Check ($answer.authorized -and $answer.paused -and -not $answer.tunnelStarted) 'authorized_paused_only'
    Check ($script:fixture.Verified -and $script:fixture.Projected) 'binding_and_projection'
    Check (-not [IO.File]::Exists($root+'.secrets\owner-revoked')) 'deny_archived'
    Check ([IO.File]::Exists($root+'.secrets\reauthorization-'+$id+'.revoked')) 'history_preserved'
    Check ([IO.File]::ReadAllText($root+'.secrets\owner-control.guard') -ceq ($id+"`n")) 'old_targets_fenced'
    Refuse {Invoke-Subject $root} 'same_id_never_replayed'
    Check (-not [IO.File]::Exists($root+'.secrets\owner-revoked')) 'replay_refusal_does_not_revoke_settled_authority'
    foreach($mode in @('not-stopped','not-idle','wrong-revision','running','busy-execution','missing-deny','bad-id')){
        $root=Setup;$held=$null
        try {
            switch($mode){
                'not-stopped' {$script:fixture.RevokeState='revocation-recorded'}
                'not-idle' {$script:fixture.Generation='unknown'}
                'wrong-revision' {[IO.File]::WriteAllText($root+'.secrets\owner-control.guard',('e'*32)+"`n")}
                'running' {[IO.File]::WriteAllText($root+'.state\lifecycle.json','{"format":"agent-continue-lifecycle","version":1,"paused":false}'+"`n")}
                'busy-execution' {$held=[IO.File]::Open(($root+'.secrets\control-'+('f'*32)+'.execution.lock'),'CreateNew','ReadWrite','None')}
                'missing-deny' {[IO.File]::Move($root+'.secrets\owner-revoked',$root+'.secrets\not-a-deny')}
            }
            $op=if($mode -ceq 'bad-id'){'invalid'}else{$id}
            Refuse {Invoke-Subject $root $op} $mode
            Check (-not [IO.File]::Exists($root+'.secrets\reauthorization-'+$id+'.started.json')) ($mode+'_before_commit')
        }finally{if($held){$held.Dispose()}}
    }
    $root=Setup;$script:fixture.FailProjection=$true
    $answer=Invoke-Subject $root
    Check ($answer.authorized -and $answer.paused -and -not $answer.ok -and -not $answer.projectionVerified) 'committed_projection_unconfirmed'
    Check (-not [IO.File]::Exists($root+'.secrets\owner-revoked')) 'committed_effect_not_reported_unchanged'
    Check ([IO.File]::Exists($root+'.secrets\reauthorization-'+$id+'.committed.json')) 'commit_evidence_preserved'
    Refuse {Invoke-Subject $root} 'partial_attempt_never_replayed'
    [IO.File]::WriteAllBytes(($root+'.secrets\owner-revoked'),[byte[]]::new(0))
    Refuse {Invoke-Subject $root} 'later_revoke_not_undone_by_old_id'
    Check ([IO.File]::Exists($root+'.secrets\owner-revoked')) 'later_revoke_preserved'
    $root=Setup;$script:fixture.FailStart=$true
    Refuse {Invoke-Subject $root} 'started_publication_failure'
    Check ([IO.File]::ReadAllText($root+'.secrets\owner-control.guard') -ceq ($previous+"`n")) 'start_failure_no_revision_change'
    Check ([IO.File]::Exists($root+'.secrets\owner-revoked')) 'start_failure_stays_denied'
    $root=Setup;$script:fixture.FailCommit=$true
    $answer=Invoke-Subject $root
    Check ($answer.authorized -and $answer.paused -and -not $answer.ok -and -not $answer.commitReceiptVerified) 'commit_receipt_failure_reports_effect'
    Refuse {Invoke-Subject $root} 'commit_receipt_failure_no_replay'
    foreach($mode in @('unsettled-record','live-record-runner','live-peer','foreign-peer','extra-peer-field')){
        $root=Setup
        if($mode -like '*record*'){
            [IO.File]::WriteAllText(($root+'.secrets\control-'+('e'*32)+'.reserved.json'),'{"control":"connect"}')
            if($mode -ceq 'unsettled-record'){$script:fixture.RecordState='launch-unconfirmed'}else{$script:fixture.LiveRunner=$true}
        }else{
            $peer=[ordered]@{version=1;kind='control-peer';bundleSha256=$digest;userSid=$sid;origin=$origin;operationId=('e'*32);control='connect';mode='control';handoffId=('f'*32);runnerIdentity=@{pid=123;started='123'};sessionEvidence=@{}}
            if($mode -ceq 'live-peer'){$script:fixture.LiveRunner=$true}
            if($mode -ceq 'foreign-peer'){$peer.userSid='S-1-5-21-1-2-3-1002'}
            if($mode -ceq 'extra-peer-field'){$peer.extra=$true}
            [IO.File]::WriteAllText(($root+'.secrets\control-'+('f'*32)+'.peer.json'),(ConvertTo-Json -InputObject $peer -Depth 4 -Compress))
        }
        Refuse {Invoke-Subject $root} $mode
        Check ([IO.File]::Exists($root+'.secrets\owner-revoked')) ($mode+'_denial_preserved')
        Check (-not [IO.File]::Exists($root+'.secrets\reauthorization-'+$id+'.started.json')) ($mode+'_before_commit')
    }
    [Console]::WriteLine('reauthorization_scratch_checks='+$script:checks)
}finally{[IO.Directory]::Delete($scratch,$true)}
