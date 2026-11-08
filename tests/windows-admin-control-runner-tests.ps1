[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$stager = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'))
$tokens = $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($stager,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'stager_parse' }
$names = @('Test-AdministratorControlFields','Test-AdministratorControlRunnerExited','Complete-AdministratorControlRevocation')
foreach ($name in $names) {
    $functions = @($ast.FindAll({param($n)
        $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name
    },$true))
    if ($functions.Count -ne 1) { throw ('function_count:' + $name) }
    # Load only these definitions, never the stager's installation/dispatch body.
    . ([scriptblock]::Create($functions[0].Extent.Text))
}

$script:checks = 0
$script:cases = 0
$script:failures = [Collections.Generic.List[string]]::new()
function Check([bool]$Value,[string]$Why) {
    if (-not $Value) { throw $Why }
    $script:checks++
}
function Run-Case([string]$Name,[scriptblock]$Work) {
    $script:cases++
    try {
        $null = & $Work
        [Console]::WriteLine('PASS ' + $Name)
    } catch {
        $message = $Name + ': ' + $_.Exception.Message
        $script:failures.Add($message)
        [Console]::WriteLine('FAIL ' + $message)
    }
}
function Refuse-Runner($Runner) {
    $reason = $null
    try { $null = Test-AdministratorControlRunnerExited $Runner }
    catch { $reason = $_.Exception.Message }
    Check ($reason -ceq 'owner_control_runner') 'invalid_runner_requires_validation_error'
}
function Check-Runner($Runner,[bool]$Exited) {
    $actual = Test-AdministratorControlRunnerExited $Runner
    Check ($actual -is [bool] -and $actual -eq $Exited) 'exact_runner_liveness_result'
}

$selfProcess = [Diagnostics.Process]::GetCurrentProcess()
try {
    $selfId = [int]$selfProcess.Id
    $selfTicks = $selfProcess.StartTime.ToUniversalTime().Ticks
    $selfStarted = $selfTicks.ToString([Globalization.CultureInfo]::InvariantCulture)
} finally { $selfProcess.Dispose() }
$digest = 'a'*64; $sid = 'S-1-5-21-1-2-3-1001'; $id = 'b'*32
$origin = 'chrome-extension://' + ('c'*32) + '/'; $generation = 'd'*32
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$scratch = [IO.Path]::GetFullPath([IO.Path]::Combine($tempRoot,('ac-control-runner-test-' + [Guid]::NewGuid().ToString('N'))))
function Assert-ScratchRoot {
    $resolved = [IO.Path]::GetFullPath($script:scratch)
    if (-not [IO.Path]::IsPathRooted($script:scratch) -or
        -not $resolved.StartsWith($script:tempRoot,[StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolved) -cnotmatch '\Aac-control-runner-test-[a-f0-9]{32}\z') { throw 'scratch_scope' }
    $attributes = [IO.File]::GetAttributes($resolved)
    if (-not ($attributes -band [IO.FileAttributes]::Directory) -or
        ($attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'scratch_root_type' }
}
function Assert-ScratchTree {
    Assert-ScratchRoot
    $pending = [Collections.Generic.Queue[string]]::new()
    $pending.Enqueue($script:scratch)
    while ($pending.Count) {
        foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($pending.Dequeue())) {
            $full = [IO.Path]::GetFullPath($entry)
            if (-not $full.StartsWith($script:scratch + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'cleanup_scope' }
            $attributes = [IO.File]::GetAttributes($full)
            if ($attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'cleanup_reparse' }
            if ($attributes -band [IO.FileAttributes]::Directory) { $pending.Enqueue($full) }
        }
    }
}

$bundle = [IO.Path]::Combine($scratch,'bundle')
$script:fixture = @{
    Bundle=$bundle;Root=($bundle+'.state');Vault=($bundle+'.secrets');Status=($bundle+'.status');
    Record=[ordered]@{version=1;kind='reservation';bundleSha256=$digest;userSid=$sid;origin=$origin;
        operationId=$id;control='revoke';target=$null;observedGeneration=$generation;
        runnerIdentity=[ordered]@{pid=$selfId;started=$selfStarted};
        sessionEvidence=[ordered]@{mediumPid=500;mediumStarted='639295999999999999';
            highPid=$selfId;highStarted=$selfStarted;sessionId=1;userSid=$sid}};
    Receipt=@{bundleSha256=$digest;operationId=$id;control='revoke';state='revocation-recorded';progress=$null};
    TerminalBytes=$null;TerminalReads=0;Published=[Collections.Generic.List[string]]::new()
}

# These exact-argument stubs are in-memory evidence, not ACL, OS-peer or Job proof.
function Read-AdministratorControlRecord([string]$Vault,[string]$Digest,[string]$Sid,[string]$Origin,[string]$Id,[string]$Control) {
    Check ($Vault -ceq $script:fixture.Vault -and $Digest -ceq $script:digest -and $Sid -ceq $script:sid -and
        $Origin -ceq $script:origin -and $Id -ceq $script:id -and $Control -ceq 'revoke') 'record_stub_arguments'
    return $script:fixture.Record
}
function Read-AdministratorControlReceipt([string]$Directory,[string]$Digest,[string]$Sid,[string]$Id,[string]$Control) {
    Check ($Directory -ceq $script:fixture.Status -and $Digest -ceq $script:digest -and $Sid -ceq $script:sid -and
        $Id -ceq $script:id -and $Control -ceq 'revoke') 'receipt_stub_arguments'
    return $script:fixture.Receipt
}
function Test-AdministratorOwnerAbsent([string]$File) {
    Check ($File -ceq [IO.Path]::Combine($script:fixture.Vault,'owner-revoked')) 'deny_stub_path'
    return $false
}
function Test-AdministratorOwnerIntent([string]$Root,[bool]$Paused) {
    Check ($Root -ceq $script:fixture.Root -and $Paused) 'intent_stub_arguments'
    return $true
}
function Get-AdministratorPauseGeneration([string]$Root,[string]$Vault,[string]$Digest,[string]$Sid) {
    Check ($Root -ceq $script:fixture.Root -and $Vault -ceq $script:fixture.Vault -and
        $Digest -ceq $script:digest -and $Sid -ceq $script:sid) 'generation_stub_arguments'
    return 'idle'
}
function Read-AdministratorControlBytes([string]$File,[bool]$Private,[string]$Sid,[int]$Limit) {
    $expected = [IO.Path]::Combine($script:fixture.Vault,('owner-job-' + $script:generation + '.terminal.json'))
    Check ($File -ceq $expected -and $Private -and $Sid -ceq $script:sid -and $Limit -eq 2048) 'terminal_stub_arguments'
    $script:fixture.TerminalReads++
    return ,$script:fixture.TerminalBytes
}
function Publish-AdministratorControlReceipt([string]$Directory,[string]$Digest,[string]$Sid,[string]$Id,[string]$Control,[string]$State) {
    Check ($Directory -ceq $script:fixture.Status -and $Digest -ceq $script:digest -and $Sid -ceq $script:sid -and
        $Id -ceq $script:id -and $Control -ceq 'revoke' -and $State -ceq 'stopped') 'publish_stub_arguments'
    $script:fixture.Published.Add($State)
}
function New-TerminalBytes([string]$VersionToken='1',[string]$Change='') {
    $row = [ordered]@{format='agent-continue-windows-owner-job';version=1;generation=$script:generation;
        bundleSha256=$script:digest;outcome='root-exited';jobDrained=$true;rootCreationAttempted=$true;
        rootExitObserved=$true;rootExitCode=0;innerLeasesClear=$true;tunnelReady='unobserved'}
    switch ($Change) {
        'extra' { $row.extra = $true }
        'missing' { $row.Remove('outcome') }
        'string-drained' { $row.jobDrained = 'true' }
        'leases-held' { $row.innerLeasesClear = $false }
        'exit-unobserved' { $row.rootExitObserved = $false }
        'wrong-generation' { $row.generation = 'e'*32 }
        'wrong-digest' { $row.bundleSha256 = 'f'*64 }
        '' { }
        default { throw 'terminal_fixture_change' }
    }
    $json = ConvertTo-Json -InputObject $row -Compress
    Check ($json.Contains('"version":1,')) 'terminal_fixture_version_anchor'
    # Raw tokens retain exponent/fraction syntax instead of normalizing it first.
    $json = $json.Replace('"version":1,',('"version":' + $VersionToken + ','))
    return ,([Text.Encoding]::UTF8.GetBytes($json + [char]10))
}
function Check-Terminal([byte[]]$Bytes,[bool]$Stopped) {
    $script:fixture.TerminalBytes = $Bytes
    $script:fixture.TerminalReads = 0
    $script:fixture.Published.Clear()
    $actual = Complete-AdministratorControlRevocation $script:bundle $script:digest $script:sid $script:origin $script:id $script:gate
    Check ($null -eq $actual) 'completion_returns_no_unverified_result'
    Check ($script:fixture.TerminalReads -eq 1) 'completion_reads_terminal_fixture'
    if ($Stopped) {
        Check ($script:fixture.Published.Count -eq 1 -and $script:fixture.Published[0] -ceq 'stopped') 'valid_terminal_publishes_stopped_once'
    } else {
        Check ($script:fixture.Published.Count -eq 0) 'invalid_terminal_must_not_publish_stopped'
    }
}

$gate = $null
try {
    $null = [IO.Directory]::CreateDirectory($scratch)
    Assert-ScratchRoot
    $gate = [IO.File]::Open([IO.Path]::Combine($scratch,'guard'),'CreateNew','ReadWrite','None')
    Run-Case 'self Int32 PID remains alive' { Check-Runner @{pid=[int]$selfId;started=$selfStarted} $false }
    Run-Case 'self Int64 PID remains alive' { Check-Runner @{pid=[long]$selfId;started=$selfStarted} $false }
    Run-Case 'JSON self runner remains alive in either shell' {
        $json = ConvertTo-Json -InputObject ([ordered]@{pid=$selfId;started=$selfStarted}) -Compress
        Check-Runner (ConvertFrom-Json -InputObject $json) $false
    }
    Run-Case 'self startTicks mismatch identifies different runner' {
        $different = ($selfTicks + [long]1).ToString([Globalization.CultureInfo]::InvariantCulture)
        Check-Runner @{pid=[int]$selfId;started=$different} $true
    }
    foreach ($tick in @('1','1000000000000000000',([DateTime]::MaxValue.Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)))) {
        Run-Case ('valid tick bound mismatches self: ' + $tick) { Check-Runner @{pid=[long]$selfId;started=$tick} $true }
    }
    $invalidPids = @(
        @{name='null';value=$null},@{name='zero';value=[int]0},@{name='negative';value=[long]-1},
        @{name='string';value=$selfId.ToString()},@{name='bool';value=$true},
        @{name='integral-double';value=[double]$selfId},@{name='fraction';value=0.5},
        @{name='decimal';value=[decimal]$selfId},@{name='array';value=@($selfId)},
        @{name='overflow-int32';value=[long]2147483648},@{name='overflow-int64-range';value=[long]::MaxValue}
    )
    foreach ($bad in $invalidPids) {
        Run-Case ('invalid PID: ' + $bad.name) { Refuse-Runner @{pid=$bad.value;started=$selfStarted} }
    }
    $invalidTicks = @(
        @{name='null';value=$null},@{name='empty';value=''},@{name='zero';value='0'},
        @{name='negative';value='-1'},@{name='plus';value='+1'},@{name='leading-zero';value='01'},
        @{name='space';value=' 1'},@{name='newline';value=('1'+[char]10)},
        @{name='fraction';value='1.0'},@{name='exponent';value='1e0'},
        @{name='number-not-string';value=$selfTicks},@{name='bool';value=$true},@{name='array';value=@($selfStarted)},
        @{name='DateTime-overflow';value='3155378976000000000'},
        @{name='Int64-overflow';value='9223372036854775808'},@{name='twenty-digits';value='10000000000000000000'}
    )
    foreach ($bad in $invalidTicks) {
        Run-Case ('invalid ticks: ' + $bad.name) { Refuse-Runner @{pid=[int]$selfId;started=$bad.value} }
    }
    foreach ($bad in @(@{pid=$selfId},@{started=$selfStarted},@{pid=$selfId;started=$selfStarted;extra=$true})) {
        Run-Case 'runner requires exact closed fields' { Refuse-Runner $bad }
    }
    Run-Case 'writer-shaped terminal numeric version 1 publishes stopped' { Check-Terminal (New-TerminalBytes) $true }
    $invalidVersions = @(
        @{name='string';token='"1"'},@{name='bool-true';token='true'},@{name='bool-false';token='false'},
        @{name='fraction';token='1.0'},@{name='exponent';token='1e0'},@{name='rounded-double';token='1.0000000000000001'},
        @{name='array-one';token='[1]'},@{name='array-repeated';token='[1,1]'},@{name='empty-array';token='[]'},
        @{name='object';token='{}'},@{name='null';token='null'},@{name='zero';token='0'},
        @{name='negative';token='-1'},@{name='wrong-integer';token='2'},
        @{name='Int32-overflow';token='2147483648'},@{name='Int64-max';token='9223372036854775807'},
        @{name='Int64-overflow';token='9223372036854775808'}
    )
    foreach ($bad in $invalidVersions) {
        Run-Case ('invalid terminal version: ' + $bad.name) { Check-Terminal (New-TerminalBytes $bad.token) $false }
    }
    $identityValues=@{format='agent-continue-windows-owner-job';generation=$generation;bundleSha256=$digest}
    foreach ($field in @('format','generation','bundleSha256')) {
        $expected=$identityValues[$field]
        foreach ($bad in @(@{name='empty-array';value=@()},@{name='singleton-array';value=@($expected)},
            @{name='repeated-array';value=@($expected,$expected)},@{name='null';value=$null},
            @{name='bool';value=$true},@{name='number';value=1},
            @{name='leading-bom';value=([string][char]0xfeff+$expected)},@{name='trailing-zero-width';value=($expected+[char]0x200b)})) {
            Run-Case ('invalid terminal identity: '+$field+'/'+$bad.name) {
                $row=ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString((New-TerminalBytes)))
                $row.$field=$bad.value
                $json=ConvertTo-Json -InputObject $row -Compress
                Check-Terminal ([Text.Encoding]::UTF8.GetBytes($json+[char]10)) $false
            }
        }
    }
    foreach ($change in @('extra','missing','string-drained','leases-held','exit-unobserved','wrong-generation','wrong-digest')) {
        Run-Case ('terminal retains existing guard: ' + $change) { Check-Terminal (New-TerminalBytes '1' $change) $false }
    }
    if ($script:failures.Count) {
        throw ('control_runner_tests_failed:' + $script:failures.Count + '/' + $script:cases + [Environment]::NewLine + ($script:failures -join [Environment]::NewLine))
    }
    [Console]::WriteLine(('{"ok":true,"scope":"self-process-read-only-and-stub-terminal-not-protected-runtime-or-os-peer-proof","cases":' + $script:cases + ',"checks":' + $script:checks + '}'))
} finally {
    if ($gate) { $gate.Dispose() }
    if ([IO.Directory]::Exists($scratch)) {
        Assert-ScratchTree
        Remove-Item -LiteralPath $scratch -Recurse -Force
    }
}
