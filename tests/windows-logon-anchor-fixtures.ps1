[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$probe = Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts\Read-WindowsInteractiveSessionEvidence.ps1'
$ast = [Management.Automation.Language.Parser]::ParseFile($probe, [ref]$null, [ref]$null)
$names = @('ConvertTo-LogonRecord', 'ConvertTo-MatchedLogonAnchor', 'Find-UniqueLogonAnchor',
    'Read-LogonRecordById', 'Get-CurrentLogonAnchor', 'Get-RetainedLogonOrder',
    'Read-LogonHead', 'Get-ObservationUtc', 'Get-PauseBoundary', 'Read-RetainedPauseBoundary')
$functions = $ast.FindAll({param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -cin $names
}, $false)
if ($functions.Count -ne $names.Count) { throw 'anchor_fixture_functions_missing' }
foreach ($entry in $functions) { . ([scriptblock]::Create($entry.Extent.Text)) }

$provider = 'Microsoft-Windows-TerminalServices-LocalSessionManager'
$providerId = [guid]'5d896912-022d-40aa-a3a8-4fa5515c76d7'
$channel = $provider + '/Operational'
$anchorWindowSeconds = 30
$moment = [datetime]::new(2026, 11, 1, 6, 30, 15, [DateTimeKind]::Utc).AddTicks(1234567)
$evidence = [pscustomobject]@{
    Account = 'TEST\User'; SessionId = [uint32]7; LogonUtc = $moment
    SessionTag = 'a' * 64; OwnerTag = 'b' * 64
}

function New-Record([long]$RecordId = 40, [int]$Id = 21, [string]$Account = 'TEST\User',
                    [uint32]$SessionId = 7, [datetime]$Time = $moment, [string]$Address = 'LOCAL',
                    [guid]$IdOfProvider = $providerId) {
    $value = [pscustomobject]@{
        LogName = $channel; ProviderName = $provider; ProviderId = $IdOfProvider
        Id = $Id; Version = [byte]0; RecordId = $RecordId; TimeCreated = $Time
        Properties = @([pscustomobject]@{Value=$Account}, [pscustomobject]@{Value=$SessionId}, [pscustomobject]@{Value=$Address})
    }
    $value | Add-Member -MemberType ScriptMethod -Name Dispose -Value { $script:disposedRecords++ }
    return $value
}

function Assert-Refused([scriptblock]$Operation) {
    try { $null = & $Operation }
    catch { if ($_.Exception.Message -ceq 'logon_anchor_unavailable') { return }; throw }
    throw 'anchor_fixture_expected_refusal'
}

function Get-WinEvent {
    [CmdletBinding()]
    param([string]$LogName, [string]$FilterXPath, [int]$MaxEvents)
    if ($LogName -cne $channel -or -not $script:answers.Count) { throw 'unexpected_fixture_query' }
    if ($FilterXPath.Contains('TimeCreated')) {
        $lower = $moment.AddSeconds(-30).ToString('o', [Globalization.CultureInfo]::InvariantCulture)
        $upper = $moment.AddSeconds(30).ToString('o', [Globalization.CultureInfo]::InvariantCulture)
        if ($MaxEvents -ne 33 -or -not $FilterXPath.Contains("EventID=21") -or
            -not $FilterXPath.Contains($lower) -or -not $FilterXPath.Contains($upper)) { throw 'fixture_query_lost_utc' }
    } elseif ($MaxEvents -eq 1) {
        if ($FilterXPath -cne "*[System[Provider[@Name='$provider'] and EventID=21]]") {
            throw 'fixture_head_query_changed'
        }
    } elseif ($MaxEvents -ne 2 -or $FilterXPath -cnotmatch '^\*\[System\[EventRecordID=(38|39|40)\]\]$') {
        throw 'fixture_readback_changed'
    }
    $result = $script:answers.Dequeue()
    if ($null -ne $result) { $result }
}

function Set-Queue([object[]]$Items) {
    $script:answers = [Collections.Generic.Queue[object]]::new()
    foreach ($item in $Items) {
        $script:answers.Enqueue($item)
    }
}

function Set-Responses($First, $Readback, $Second) {
    Set-Queue @($First, $Readback, $Second)
}

$script:disposedRecords = 0
$match = ConvertTo-MatchedLogonAnchor (New-Record -Time $moment.AddSeconds(30)) $evidence
if ($match.recordId -ne 40 -or $match.recordTag -cnotmatch '^[a-f0-9]{64}$') { throw 'boundary_match_missing' }
foreach ($bad in @(
    (New-Record -Id 25),
    (New-Record -Account 'OTHER\User'),
    (New-Record -SessionId 8),
    (New-Record -IdOfProvider ([guid]::Empty)),
    (New-Record -Time $moment.AddSeconds(30).AddTicks(1))
)) {
    if ($null -ne (ConvertTo-MatchedLogonAnchor $bad $evidence)) { throw 'unexpected_anchor_match' }
}

Set-Responses -First (New-Record) -Readback (New-Record) -Second (New-Record)
$selected = Get-CurrentLogonAnchor $evidence
if ($selected.recordId -ne 40 -or $script:disposedRecords -ne 3) { throw 'valid_anchor_not_rechecked' }
Set-Responses -First (New-Record) -Readback (New-Record -Address 'changed') -Second (New-Record)
Assert-Refused { Get-CurrentLogonAnchor $evidence }
Set-Responses -First (New-Record) -Readback $null -Second (New-Record)
Assert-Refused { Get-CurrentLogonAnchor $evidence }
Set-Responses -First (New-Record) -Readback (New-Record) -Second @((New-Record), (New-Record -RecordId 41))
Assert-Refused { Get-CurrentLogonAnchor $evidence }
Set-Responses -First @(1..33 | ForEach-Object { New-Record -RecordId $_ }) -Readback $null -Second $null
Assert-Refused { Get-CurrentLogonAnchor $evidence }

$oldRow = New-Record -RecordId 39 -SessionId 2 -Time $moment.AddMinutes(-20)
$old = ConvertTo-LogonRecord $oldRow
$prior = @{
    recordId = 39L; recordTag = $old.recordTag; sessionTag = 'c' * 64; ownerTag = $evidence.OwnerTag
}
Set-Queue @($oldRow, (New-Record), (New-Record), (New-Record), $oldRow)
if ((Get-RetainedLogonOrder $evidence $selected $prior) -cne 'later' -or $script:answers.Count) {
    throw 'later_retained_login_not_proved'
}

# A log clear/rollover can remove the prior record or reuse its numeric ID.
foreach ($oldReadback in @($null, (New-Record -RecordId 39 -SessionId 9 -Time $moment))) {
    Set-Queue @($oldReadback)
    Assert-Refused { Get-RetainedLogonOrder $evidence $selected $prior }
}
Set-Queue @($oldRow, (New-Record), (New-Record), (New-Record), $null)
Assert-Refused { Get-RetainedLogonOrder $evidence $selected $prior }
Set-Queue @($oldRow, (New-Record -Address 'changed'), (New-Record -Address 'changed'), (New-Record -Address 'changed'))
Assert-Refused { Get-RetainedLogonOrder $evidence $selected $prior }

$future = New-Record -RecordId 39 -Time $moment.AddSeconds(1)
$other = New-Record -RecordId 39 -Account 'OTHER\User' -Time $moment.AddMinutes(-20)
foreach ($invalidPrior in @($future, $other, (New-Record -RecordId 39 -Time $moment))) {
    $prior.recordTag = (ConvertTo-LogonRecord $invalidPrior).recordTag
    Set-Queue @($invalidPrior)
    Assert-Refused { Get-RetainedLogonOrder $evidence $selected $prior }
}
$prior.recordTag = $old.recordTag
$prior.ownerTag = 'd' * 64
Set-Queue @()
Assert-Refused { Get-RetainedLogonOrder $evidence $selected $prior }

function Get-ObservationUtc { return $script:clock }
$script:clock = $moment.AddMinutes(10)
Set-Queue @((New-Record), (New-Record), (New-Record), (New-Record))
$captured = Get-PauseBoundary $evidence $selected
if ($captured.recordId -ne $selected.recordId -or $captured.recordTag -cne $selected.recordTag -or
    $captured.observedUtcTicks -cne $script:clock.Ticks.ToString([Globalization.CultureInfo]::InvariantCulture) -or
    $script:answers.Count) { throw 'pause_checkpoint_missing' }
Set-Queue @((New-Record), (New-Record), (New-Record -Address 'raced'), (New-Record))
Assert-Refused { Get-PauseBoundary $evidence $selected }
Set-Queue @((New-Record), (New-Record), (New-Record), $null)
Assert-Refused { Get-PauseBoundary $evidence $selected }
$otherHead = New-Record -RecordId 40 -Account 'OTHER\User'
Set-Queue @($otherHead, $otherHead, $otherHead, $oldRow)
$foreignHead = Get-PauseBoundary $evidence $old
if ($foreignHead.recordId -ne 40 -or $foreignHead.recordTag -ceq $old.recordTag -or $script:answers.Count) {
    throw 'channel_head_must_be_independent_of_owner_anchor'
}

$prior.ownerTag = $evidence.OwnerTag
$boundary = @{
    recordId = $prior.recordId; recordTag = $prior.recordTag; observedUtcTicks = $moment.AddMinutes(-1).Ticks
}
Set-Queue @($oldRow, $oldRow, (New-Record), (New-Record), (New-Record), $oldRow, $oldRow)
if ((Get-RetainedLogonOrder $evidence $selected $prior $boundary) -cne 'candidate-after-pause' -or $script:answers.Count) {
    throw 'later_login_after_checkpoint_not_proved'
}
# A different session already logged in when pause was requested.
$boundary.recordId = 40L
$boundary.recordTag = $selected.recordTag
$boundary.observedUtcTicks = $moment.AddMinutes(1).Ticks
Set-Queue @((New-Record))
Assert-Refused { Get-RetainedLogonOrder $evidence $selected $prior $boundary }

# A pre-existing WTS session can publish its logon event after the checkpoint.
$boundary.recordId = 39L
$boundary.recordTag = $prior.recordTag
$boundary.observedUtcTicks = $moment.AddSeconds(10).Ticks
$delayed = ConvertTo-LogonRecord (New-Record -Time $moment.AddSeconds(20))
Set-Queue @($oldRow)
Assert-Refused { Get-RetainedLogonOrder $evidence $delayed $prior $boundary }

$boundary.observedUtcTicks = $moment.AddMinutes(-1).Ticks
Set-Queue @($oldRow, $oldRow, (New-Record), (New-Record), (New-Record), $oldRow, $null)
Assert-Refused { Get-RetainedLogonOrder $evidence $selected $prior $boundary }
$script:clock = $moment.AddMinutes(-3)
Set-Queue @()
Assert-Refused { Get-RetainedLogonOrder $evidence $selected $prior $boundary }
'windows-logon-anchor-fixtures=pass'
