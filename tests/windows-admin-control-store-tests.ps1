[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$file = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'))
$tokens = $errorsFound = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errorsFound)
if ($errorsFound.Count) { throw 'stager_parse' }
$names = @('Read-AdministratorControlRecord','Reserve-AdministratorControlOperation','Fence-AdministratorControlOperation',
    'Publish-AdministratorControlPhase','Read-AdministratorControlPhase','Publish-AdministratorControlProgress','Read-AdministratorControlProgress')
foreach ($name in $names) {
    if (-not $ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)) { throw ('missing_function:'+ $name) }
}
foreach ($node in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$true)) {
    if ($node.Name -cmatch '\A(?:Test|Assert|Get|Read|Publish|Reserve|Fence|Resolve)-AdministratorControl' -or
        $node.Name -cin @('Test-AdministratorBrowserPauseTarget','Test-AdministratorOwnerAbsent','Assert-PathType')) {
        . ([scriptblock]::Create($node.Extent.Text))
    }
}
$scratch = [IO.Path]::Combine([IO.Path]::GetTempPath(),('ac-control-store-test-'+[Guid]::NewGuid().ToString('N')))
$null = [IO.Directory]::CreateDirectory($scratch)
function Assert-SealedAcl([string]$Path,[bool]$Directory,[bool]$Private=$false,[string]$ReaderSid='') {
    if (-not [IO.Path]::GetFullPath($Path).StartsWith($scratch+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'scratch_scope' }
    Assert-PathType $Path $Directory
}
function Open-SealedNewFile([string]$Path,[bool]$Private=$false,[string]$ReaderSid='',[IO.FileShare]$Share='None') {
    Assert-SealedAcl ([IO.Path]::GetDirectoryName($Path)) $true $Private $ReaderSid
    return [IO.File]::Open($Path,'CreateNew','Write',$Share)
}
$script:checks=0
function Check([bool]$Value,[string]$Why) { if (-not $Value) { throw $Why }; $script:checks++ }
function Refuse([scriptblock]$Work,[string]$Why) { $failed=$false; try { $null=& $Work } catch { $failed=$true }; Check $failed $Why }
$digest='a'*64; $sid='S-1-5-21-1-2-3-1001'; $origin='chrome-extension://'+('c'*32)+'/'
$id='b'*32; $unknown='e'*32; $target=('d'*32)+':idle'
$runner=@{pid=600;started='639296000000000000'}
$pair=@{mediumPid=500;mediumStarted='639295999999999999';highPid=600;highStarted='639296000000000000';sessionId=1;userSid=$sid}
$vault=[IO.Path]::Combine($scratch,'vault'); $status=[IO.Path]::Combine($scratch,'status')
$null=[IO.Directory]::CreateDirectory($vault); $null=[IO.Directory]::CreateDirectory($status)
try {
    Check ($null -eq (Read-AdministratorControlRecord $vault $digest $sid $origin $id 'connect')) 'absent_reservation'
    Check (Reserve-AdministratorControlOperation $vault $digest $sid $origin $id 'connect' $target 'idle' $runner $pair) 'initial_reservation'
    $row=Read-AdministratorControlRecord $vault $digest $sid $origin $id 'connect'
    Check ($row.target -ceq $target -and $row.runnerIdentity.pid -eq 600) 'original_identity_preserved'
    $path=[IO.Path]::Combine($vault,('control-'+$id+'.reserved.json')); $before=[IO.File]::ReadAllText($path)
    $next=@{pid=601;started='639296000000000001'}; $newPair=@{}+$pair; $newPair.highPid=601; $newPair.highStarted=$next.started
    Check (-not (Reserve-AdministratorControlOperation $vault $digest $sid $origin $id 'connect' $target 'idle' $next $newPair)) 'duplicate_not_new_runner'
    Check ([IO.File]::ReadAllText($path) -ceq $before) 'reservation_not_overwritten'
    Refuse { Reserve-AdministratorControlOperation $vault $digest $sid $origin $id 'connect' (('f'*32)+':idle') 'idle' $runner $pair } 'target_collision'
    Refuse { Reserve-AdministratorControlOperation $vault $digest $sid $origin $id 'revoke' $null $null $runner $pair } 'action_collision'
    Publish-AdministratorControlReceipt $status $digest $sid $id 'connect' 'reserved'
    $fence=Fence-AdministratorControlOperation $vault $status $digest $sid $origin $id 'connect'
    Check ($fence.state -ceq 'reserved') 'fence_does_not_recover_reserved_runner'
    Check (-not [IO.File]::Exists([IO.Path]::Combine($vault,('control-'+$id+'.tombstone.json')))) 'no_forged_tombstone'
    $fence=Fence-AdministratorControlOperation $vault $status $digest $sid $origin $unknown 'resume-saved'
    Check ($fence.state -ceq 'fenced') 'targetless_fence'
    $tomb=Read-AdministratorControlRecord $vault $digest $sid $origin $unknown 'resume-saved' -Tombstone
    Check ($tomb.kind -ceq 'control-tombstone' -and $null -eq $tomb.target -and $tomb.targetKnowledge -ceq 'unknown') 'unknown_target_not_invented'
    Check (-not (Reserve-AdministratorControlOperation $vault $digest $sid $origin $unknown 'resume-saved' $target 'idle' $runner $pair)) 'delayed_request_consumed'
    Refuse { Reserve-AdministratorControlOperation $vault $digest $sid $origin $unknown 'revoke' $null $null $runner $pair } 'tombstone_action_collision'
    Check ((Fence-AdministratorControlOperation $vault $status $digest $sid $origin $unknown 'resume-saved').state -ceq 'fenced') 'repeat_fence_idempotent'
    $interrupted='2'*32
    $tombPath=[IO.Path]::Combine($vault,('control-'+$interrupted+'.tombstone.json'))
    $tombBytes=Get-AdministratorControlTombstoneBytes $digest $sid $origin $interrupted 'connect'
    $null=Publish-AdministratorControlBytes $vault ([IO.Path]::GetFileName($tombPath)) $tombBytes $true $sid
    Check ((Read-AdministratorControlReceipt $status $digest $sid $interrupted 'connect').state -ceq 'unconfirmed') 'interrupted_fence_no_public_receipt'
    Check (-not (Reserve-AdministratorControlOperation $vault $digest $sid $origin $interrupted 'connect' $target 'idle' $runner $pair)) 'interrupted_fence_blocks_delayed_request'
    Check ((Fence-AdministratorControlOperation $vault $status $digest $sid $origin $interrupted 'connect').state -ceq 'fenced') 'interrupted_fence_recovers_receipt_only'
    Check ([Convert]::ToBase64String([IO.File]::ReadAllBytes($tombPath)) -ceq [Convert]::ToBase64String($tombBytes)) 'interrupted_fence_keeps_original_tombstone'
    foreach ($mismatch in @(@{digest=('9'*64);sid=$sid;origin=$origin},@{digest=$digest;sid='S-1-5-21-1-2-3-1002';origin=$origin},@{digest=$digest;sid=$sid;origin=('chrome-extension://'+('d'*32)+'/')})) {
        Refuse { Read-AdministratorControlRecord $vault $mismatch.digest $mismatch.sid $mismatch.origin $id 'connect' } 'stored_identity_mismatch'
        Check ([IO.File]::ReadAllText($path) -ceq $before) 'stored_identity_collision_preserves_bytes'
    }
    $other='f'*32; $pause=[IO.Path]::Combine($vault,('pause-'+$other+'.reserved.json'))
    [IO.File]::WriteAllText($pause,'old-pause')
    Refuse { Reserve-AdministratorControlOperation $vault $digest $sid $origin $other 'connect' $target 'idle' $runner $pair } 'pause_namespace_collision'
    Refuse { Fence-AdministratorControlOperation $vault $status $digest $sid $origin $other 'connect' } 'pause_namespace_cannot_fence'

    Check ($null -eq (Read-AdministratorControlPhase $vault $digest $sid $id 'connect' 'launch-attempted')) 'missing_phase'
    Refuse { Publish-AdministratorControlPhase $vault $digest $sid $origin $unknown 'resume-saved' 'intent-write-started' $null } 'fenced_operation_no_phase'
    Publish-AdministratorControlPhase $vault $digest $sid $origin $id 'connect' 'intent-write-started' $null
    Publish-AdministratorControlPhase $vault $digest $sid $origin $id 'connect' 'launch-attempted' $null
    Check ((Read-AdministratorControlPhase $vault $digest $sid $id 'connect' 'launch-attempted').phase -ceq 'launch-attempted') 'write_ahead_launch_record'
    Publish-AdministratorControlPhase $vault $digest $sid $origin $id 'connect' 'recovery-pause-started' ('1'*32)
    Refuse { Publish-AdministratorControlPhase $vault $digest $sid $origin $id 'connect' 'recovery-pause-started' ('2'*32) } 'recovery_revision_immutable'
    Publish-AdministratorControlProgress $status $digest $sid $id 'connect' 'verifying-full' 0 24328
    $documents=@(
        @{path=$path;read={ Read-AdministratorControlRecord $vault $digest $sid $origin $id 'connect' };throws=$true},
        @{path=$tombPath;read={ Read-AdministratorControlRecord $vault $digest $sid $origin $interrupted 'connect' -Tombstone };throws=$true},
        @{path=([IO.Path]::Combine($vault,('control-'+$id+'.phase-intent-write-started.json')));read={ Read-AdministratorControlPhase $vault $digest $sid $id 'connect' 'intent-write-started' };throws=$true},
        @{path=([IO.Path]::Combine($vault,('control-'+$id+'.phase-launch-attempted.json')));read={ Read-AdministratorControlPhase $vault $digest $sid $id 'connect' 'launch-attempted' };throws=$true},
        @{path=([IO.Path]::Combine($vault,('control-'+$id+'.phase-recovery-pause-started.json')));read={ Read-AdministratorControlPhase $vault $digest $sid $id 'connect' 'recovery-pause-started' };throws=$true},
        @{path=([IO.Path]::Combine($status,('control-'+$id+'.progress.json')));read={ Read-AdministratorControlProgress $status $digest $sid $id 'connect' };throws=$false}
    )
    $canonicalHashes=@()
    foreach ($document in $documents) {
        $canonical=[IO.File]::ReadAllBytes($document.path)
        $text=[Text.UTF8Encoding]::new($false,$true).GetString($canonical)
        $hash=[Security.Cryptography.SHA256]::Create()
        try { $canonicalHashes += ([BitConverter]::ToString($hash.ComputeHash($canonical))).Replace('-','').ToLowerInvariant() }
        finally { $hash.Dispose() }
        Check ($null -ne (& $document.read)) 'canonical_document_readback'
        $mutations=@()
        foreach ($token in @('"1"','true','false','1.0','1e0','null','[1]','9223372036854775808')) {
            $mutations += $text.Replace('"version":1,',('"version":'+$token+','))
        }
        $mutations += @(
            ([string][char]0xfeff+$text), $text.Replace("`n","`r`n"), $text.TrimEnd([char]10),
            $text.Replace('{"version":1,','{ "version":1,'),
            $text.Replace('{"version":1,','{"version":1,"version":1,'),
            $text.Replace('{"version":1,','{"version":1,"extra":null,')
        )
        if ($document.path -ceq $path) {
            foreach ($token in @('"600"','true','600.0','6e2','0','2147483648')) {
                $mutations += $text.Replace('"pid":600,',('"pid":'+$token+','))
            }
            foreach ($token in @('[]',('["'+$sid+'"]'),'null','true','1')) {
                $mutations += $text.Replace(('"sessionId":1,"userSid":"'+$sid+'"'),('"sessionId":1,"userSid":'+$token))
            }
        }
        if (-not $document.throws) {
            foreach ($token in @('"0"','true','0.0','0e0','-0','-1','40001')) {
                $mutations += $text.Replace('"verifiedFiles":0,',('"verifiedFiles":'+$token+','))
            }
        }
        try {
            $mutationIndex=0
            foreach ($mutated in $mutations) {
                Check (-not [string]::Equals($mutated,$text,[StringComparison]::Ordinal)) ('mutation_changes_document:'+([IO.Path]::GetFileName($document.path))+':'+$mutationIndex)
                $mutationIndex++
                [IO.File]::WriteAllBytes($document.path,[Text.UTF8Encoding]::new($false).GetBytes($mutated))
                if ($document.throws) { Refuse $document.read 'noncanonical_control_document' }
                else { Check ($null -eq (& $document.read)) 'noncanonical_progress_null' }
            }
        } finally { [IO.File]::WriteAllBytes($document.path,$canonical) }
        Check ($null -ne (& $document.read)) 'canonical_document_restored'
        Check ([Convert]::ToBase64String([IO.File]::ReadAllBytes($document.path)) -ceq [Convert]::ToBase64String($canonical)) 'canonical_bytes_unchanged'
    }
    $phase=[IO.Path]::Combine($vault,('control-'+$id+'.phase-launch-attempted.json'))
    [IO.File]::WriteAllText($phase,'{}')
    Refuse { Read-AdministratorControlPhase $vault $digest $sid $id 'connect' 'launch-attempted' } 'corrupt_phase_refused'
    Refuse { Publish-AdministratorControlPhase $vault $digest $sid $origin $id 'connect' 'launch-attempted' $null } 'corrupt_phase_not_overwritten'

    Publish-AdministratorControlProgress $status $digest $sid $id 'connect' 'verifying-full' 0 24328
    $progress=Read-AdministratorControlProgress $status $digest $sid $id 'connect'
    Check ($progress.verifiedFiles -eq 0 -and $progress.totalFiles -eq 24328) 'zero_progress'
    Publish-AdministratorControlProgress $status $digest $sid $id 'connect' 'verifying-full' 64 24328
    Check ((Read-AdministratorControlReceipt $status $digest $sid $id 'connect').progress.verifiedFiles -eq 64) 'receipt_has_bounded_progress'
    Refuse { Publish-AdministratorControlProgress $status $digest $sid $id 'connect' 'verifying-full' 32 24328 } 'progress_does_not_go_backwards'
    Refuse { Publish-AdministratorControlProgress $status $digest $sid $id 'connect' 'verifying-full' 128 24000 } 'progress_total_unchanged'
    Refuse { Publish-AdministratorControlProgress $status $digest $sid $id 'connect' 'verifying-full' $null $null } 'progress_numeric_cannot_revert_to_unknown'
    $knownProgress=[IO.Path]::Combine($status,('control-'+$id+'.progress.json'))
    $hold=[IO.File]::Open($knownProgress,'Open','Read','Read')
    try {
        Refuse { Publish-AdministratorControlProgress $status $digest $sid $id 'connect' 'verifying-full' 128 24328 } 'atomic_progress_replace_failure'
        Check ((Read-AdministratorControlProgress $status $digest $sid $id 'connect').verifiedFiles -eq 64) 'replace_failure_preserves_valid_progress'
    } finally { $hold.Dispose() }
    Publish-AdministratorControlProgress $status $digest $sid $id 'connect' 'verifying-control' $null $null
    Check ($null -eq (Read-AdministratorControlProgress $status $digest $sid $id 'connect').verifiedFiles) 'verification_only_counts'
    $progressFile=[IO.Path]::Combine($status,('control-'+$id+'.progress.json'))
    [IO.File]::WriteAllText($progressFile,'{"phase":"ready","private":"not-for-browser"}')
    Check ($null -eq (Read-AdministratorControlProgress $status $digest $sid $id 'connect')) 'malformed_progress_null'
    $receipt=Read-AdministratorControlReceipt $status $digest $sid $id 'connect'
    Check ($receipt.state -ceq 'reserved' -and $null -eq $receipt.progress) 'bad_progress_not_ready_or_state_change'
    [IO.File]::WriteAllText($path,$before.Replace('"kind":"reservation"','"kind":"control-tombstone"'))
    Refuse { Read-AdministratorControlRecord $vault $digest $sid $origin $id 'connect' } 'tombstone_not_reservation'
    Refuse { Reserve-AdministratorControlOperation $vault $digest $sid $origin $id 'connect' $target 'idle' $runner $pair } 'corrupt_reservation_no_replay'
    [Console]::WriteLine((ConvertTo-Json -InputObject ([ordered]@{ok=$true;scope='scratch-control-store-not-protected-runtime';checks=$script:checks;canonicalHashes=$canonicalHashes}) -Compress))
} finally {
    $resolved=[IO.Path]::GetFullPath($scratch)
    $temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    if (-not $resolved.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolved) -cnotmatch '\Aac-control-store-test-[a-f0-9]{32}\z' -or
        ([IO.File]::GetAttributes($resolved) -band [IO.FileAttributes]::ReparsePoint)) { throw 'cleanup_scope' }
    foreach ($entry in Get-ChildItem -LiteralPath $resolved -Recurse -Force) { if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'cleanup_reparse' } }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
