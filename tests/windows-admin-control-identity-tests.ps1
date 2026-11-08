[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$stager = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'))
$tokens = $errorsFound = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($stager,[ref]$tokens,[ref]$errorsFound)
if ($errorsFound.Count) { throw 'stager_parse' }
$names = @('Test-AdministratorControlFields','Assert-AdministratorControlIdentity','Test-AdministratorBrowserPauseTarget',
    'Get-AdministratorControlReservationBytes','Get-AdministratorControlTombstoneBytes',
    'Get-AdministratorControlPhaseBytes','Get-AdministratorControlProgressBytes')
foreach ($fn in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$true)) {
    if ($fn.Name -in $names) { . ([scriptblock]::Create($fn.Extent.Text)) }
}
foreach ($name in $names) {
    if (-not (Get-Command -Name $name -CommandType Function -ErrorAction SilentlyContinue)) { throw ('missing_function:' + $name) }
}
$script:assertions = 0
function Check([bool]$Value,[string]$Why) { if (-not $Value) { throw $Why }; $script:assertions++ }
function Refuse([scriptblock]$Work,[string]$Why) {
    $failed = $false
    try { $null = & $Work } catch { $failed = $true }
    Check $failed $Why
}
function Text($Bytes) {
    Check ($Bytes -is [byte[]]) 'not_bytes'
    return [Text.Encoding]::UTF8.GetString($Bytes)
}
$digest = 'a' * 64; $sid = 'S-1-5-21-1-2-3-1001'; $id = 'b' * 32
$origin = 'chrome-extension://' + ('c' * 32) + '/'
$target = ('d' * 32) + ':idle'
$runner = @{pid=600;started='639296000000000000'}
$pair = @{mediumPid=500;mediumStarted='639295999999999999';highPid=600;
    highStarted='639296000000000000';sessionId=1;userSid=$sid}
$bytes = Get-AdministratorControlReservationBytes $digest $sid $origin $id 'connect' $target 'idle' $runner $pair
$raw = Text $bytes; $row = ConvertFrom-Json $raw
Check ($row.kind -ceq 'reservation' -and $row.target -ceq $target -and
    $row.runnerIdentity.pid -eq 600 -and $row.sessionEvidence.sessionId -eq 1) 'reservation_identity'
Check ($raw.EndsWith([string][char]10) -and $raw.IndexOf([char]13) -lt 0) 'canonical_lf'
Check (@($row.PSObject.Properties.Name).Count -eq 11) 'reservation_closed_fields'
Refuse { Get-AdministratorControlReservationBytes $digest $sid $origin $id 'revoke' $target $null $runner $pair } 'revoke_target'
Refuse { Get-AdministratorControlReservationBytes $digest $sid $origin $id 'connect' $null 'idle' $runner $pair } 'startup_target'
foreach ($bad in @('UNKNOWN','unknown','../x',('f' * 31))) {
    Refuse { Get-AdministratorControlReservationBytes $digest $sid $origin $id 'connect' $target $bad $runner $pair } 'generation'
}
Refuse { Get-AdministratorControlReservationBytes $digest $sid $origin $id 'connect' $target $null $runner $pair } 'startup_generation_unknown'
$denied = ConvertFrom-Json (Text (Get-AdministratorControlReservationBytes $digest $sid $origin $id 'revoke' $null $null $runner $pair))
Check ($null -eq $denied.target -and $null -eq $denied.observedGeneration) 'unknown_liveness_revoke_allowed'
foreach ($field in @('extra','pid','started')) {
    $bad = @{} + $runner
    if ($field -ceq 'extra') { $bad.extra = 'no' } elseif ($field -ceq 'pid') { $bad.pid = 601 } else { $bad.started = '639296000000000001' }
    Refuse { Get-AdministratorControlReservationBytes $digest $sid $origin $id 'connect' $target 'idle' $bad $pair } 'runner_pair_mismatch'
}
foreach ($change in @(@{sessionId=0},@{sessionId=-1},@{sessionId='1'},@{mediumPid=600},
    @{mediumStarted=639295999999999999},@{highStarted='0'},@{userSid='S-1-5-21-1-2-3-1002'},@{extra=$true})) {
    $bad = @{} + $pair
    foreach ($key in $change.Keys) { $bad[$key] = $change[$key] }
    Refuse { Get-AdministratorControlReservationBytes $digest $sid $origin $id 'connect' $target 'idle' $runner $bad } 'unbound_session_pair'
}
foreach ($case in @(@{value=@()},@{value=@($sid)},@{value=@($sid,$sid)},@{value=$null},
    @{value=$true},@{value=1},@{value=([string][char]0xfeff+$sid)},@{value=($sid+[char]0x200b)})) {
    $bad=@{}+$pair
    $bad.userSid=$case.value
    Refuse { Get-AdministratorControlReservationBytes $digest $sid $origin $id 'connect' $target 'idle' $runner $bad } 'session_sid_requires_exact_scalar_string'
}
$invalidOrigins=@(('chrome-extension://' + ('q' * 32) + '/'), 'https://chatgpt.com/', '*', ($origin + 'path'))
Check ($invalidOrigins.Count -eq 4) 'origin_case_count'
foreach ($bad in $invalidOrigins) {
    Refuse { Get-AdministratorControlReservationBytes $digest $sid $bad $id 'connect' $target 'idle' $runner $pair } 'origin'
}
$tomb = ConvertFrom-Json (Text (Get-AdministratorControlTombstoneBytes $digest $sid $origin $id 'resume-saved'))
Check ($tomb.kind -ceq 'control-tombstone' -and $tomb.targetKnowledge -ceq 'unknown' -and
    $null -eq $tomb.target -and @($tomb.PSObject.Properties.Name).Count -eq 9) 'targetless_tombstone_schema'
foreach ($phase in @('intent-write-started','launch-attempted')) {
    $row = ConvertFrom-Json (Text (Get-AdministratorControlPhaseBytes $digest $id 'connect' $phase $null))
    Check ($row.phase -ceq $phase -and $null -eq $row.revision) 'normal_phase'
    Refuse { Get-AdministratorControlPhaseBytes $digest $id 'connect' $phase ('e' * 32) } 'normal_phase_no_revision'
}
$row = ConvertFrom-Json (Text (Get-AdministratorControlPhaseBytes $digest $id 'connect' 'recovery-pause-started' ('e' * 32)))
Check ($row.revision -ceq ('e' * 32)) 'recovery_revision'
Refuse { Get-AdministratorControlPhaseBytes $digest $id 'revoke' 'launch-attempted' $null } 'revoke_cannot_launch'
Refuse { Get-AdministratorControlPhaseBytes $digest $id 'connect' 'recovery-pause-started' $null } 'recovery_revision_required'
Refuse { Get-AdministratorControlPhaseBytes $digest $id 'connect' 'ready' $null } 'unknown_phase'
foreach ($phase in @('verifying-control','waiting-owner','waiting-stop','settled')) {
    $row = ConvertFrom-Json (Text (Get-AdministratorControlProgressBytes $digest $id 'revoke' $phase $null $null))
    Check ($row.phase -ceq $phase -and $null -eq $row.verifiedFiles) 'progress_phase'
    Refuse { Get-AdministratorControlProgressBytes $digest $id 'connect' $phase 0 10 } 'nonverification_counts'
}
$row = ConvertFrom-Json (Text (Get-AdministratorControlProgressBytes $digest $id 'connect' 'verifying-full' 42 100))
Check ($row.verifiedFiles -eq 42 -and $row.totalFiles -eq 100) 'verification_counts'
foreach ($counts in @(@(-1,10),@(11,10),@(0,40001),@('0',10),@($null,10),@(0,$null),@(0.5,10))) {
    Refuse { Get-AdministratorControlProgressBytes $digest $id 'connect' 'verifying-full' $counts[0] $counts[1] } 'invalid_progress_counts'
}
foreach ($bad in @('../x',('B' * 32),('0' * 31),'')) {
    Refuse { Get-AdministratorControlTombstoneBytes $digest $sid $origin $bad 'connect' } 'invalid_id'
}
[Console]::WriteLine(('{"ok":true,"scope":"pure-closed-ledger-serialization-not-os-identity-proof","assertions":' + $script:assertions + '}'))
