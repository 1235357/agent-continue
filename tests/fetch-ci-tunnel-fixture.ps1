param(
    [Parameter(Mandatory)][string]$Downloader,
    [Parameter(Mandatory)][string]$Scenario
)

$ErrorActionPreference = 'Stop'
$global:fixture = Get-Content -LiteralPath $Scenario -Raw | ConvertFrom-Json
$global:calls = [Collections.Generic.List[object]]::new()
$global:waits = [Collections.Generic.List[int]]::new()
$global:sleeps = [Collections.Generic.List[int]]::new()
$global:elapsed = 0L
$global:killed = 0
$global:disposed = 0
$global:started = 0
$global:reaps = [Collections.Generic.List[int]]::new()
$global:killTrees = [Collections.Generic.List[bool]]::new()
$global:childPids = [Collections.Generic.List[int]]::new()
$global:scenarioPath = $Scenario
$global:partialCleared = $true

function New-FixtureClock {
    $clock = [pscustomobject]@{}
    $clock | Add-Member -MemberType ScriptProperty -Name ElapsedMilliseconds -Value { $global:elapsed }
    return $clock
}

# This stub is also injected into real children; no request can reach the network.
function Invoke-WebRequest {
    param($Uri, $OutFile, $TimeoutSec, $OperationTimeoutSeconds, $MaximumRetryCount,
          $ErrorAction, $Verbose, $Debug)
    $index = if ($env:AC_CI_FIXTURE_INDEX) { [int]$env:AC_CI_FIXTURE_INDEX } else { $global:calls.Count }
    $step = $global:fixture.steps[$index]
    $global:partialCleared = $global:partialCleared -and -not (Test-Path -LiteralPath $OutFile)
    $call = [pscustomobject]@{
        uri = [string]$Uri; timeout = $TimeoutSec; operationTimeout = $OperationTimeoutSeconds
        automaticRetries = $MaximumRetryCount; partialCleared = $global:partialCleared
        pid = $PID; kind = $step.kind
    }
    $global:calls.Add($call)
    if ($global:fixture.realProcesses) {
        [IO.File]::WriteAllText((Join-Path (Split-Path $env:AC_CI_FIXTURE_SCENARIO) "call-$index.json"),
            ($call | ConvertTo-Json -Compress))
    }
    $global:elapsed += [long]$step.durationMs
    [IO.File]::WriteAllText($OutFile, 'partial previous attempt')
    if ($step.kind -eq 'ok') {
        [IO.File]::Copy($global:fixture.archive, $OutFile, $true)
        return
    }
    $message = 'DO_NOT_LOG https://redirect.invalid/asset?sig=PRIVATE_SIGNATURE'
    if ($step.kind -eq 'http') {
        $response = [Net.Http.HttpResponseMessage]::new([Net.HttpStatusCode][int]$step.status)
        throw [Microsoft.PowerShell.Commands.HttpResponseException]::new($message, $response)
    }
    if ($step.kind -eq 'network') {
        throw [Net.WebException]::new($message, [Net.WebExceptionStatus]::ConnectionClosed)
    }
    if ($step.kind -eq 'tls') {
        throw [Net.WebException]::new($message, [Net.WebExceptionStatus]::TrustFailure)
    }
    if ($step.kind -eq 'timeout') { throw [TimeoutException]::new($message) }
    if ($step.kind -eq 'stall') {
        if ($global:fixture.realProcesses) { Microsoft.PowerShell.Utility\Start-Sleep -Seconds 120 }
        return
    }
    if ($step.kind -in @('thread-sleep', 'thread-sleep-tree')) {
        if ($global:fixture.realProcesses) {
            if ($step.kind -eq 'thread-sleep-tree') {
                $info = [Diagnostics.ProcessStartInfo]::new((Get-Process -Id $PID).Path)
                $info.UseShellExecute = $false
                $info.CreateNoWindow = $true
                foreach ($argument in @('-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
                    [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('[Threading.Thread]::Sleep(120000)')))) {
                    $info.ArgumentList.Add($argument)
                }
                $descendant = [Diagnostics.Process]::Start($info)
                [IO.File]::WriteAllText((Join-Path (Split-Path $env:AC_CI_FIXTURE_SCENARIO) "descendant-$index.pid"),
                    [string]$descendant.Id)
            }
            [Threading.Thread]::Sleep(120000)
        }
        return
    }
    if ($step.kind -eq 'http-network') {
        throw [Net.Http.HttpRequestException]::new([Net.Http.HttpRequestError]::ConnectionError, $message)
    }
    if ($step.kind -eq 'http-tls') {
        throw [Net.Http.HttpRequestException]::new([Net.Http.HttpRequestError]::ConnectionError, $message,
            [Security.Authentication.AuthenticationException]::new($message))
    }
    if ($step.kind -eq 'http-status') {
        throw [Net.Http.HttpRequestException]::new($message, $null, [Net.HttpStatusCode][int]$step.status)
    }
    if ($step.kind -eq 'response-ended') {
        throw [Net.Http.HttpIOException]::new([Net.Http.HttpRequestError]::ResponseEnded, $message)
    }
    if ($step.kind -eq 'other-http-io') {
        throw [Net.Http.HttpIOException]::new([Net.Http.HttpRequestError]::InvalidResponse, $message)
    }
    if ($step.kind -eq 'http-chain') {
        $inner = $null
        foreach ($status in $step.statuses) {
            $inner = [Net.Http.HttpRequestException]::new($message, $inner, [Net.HttpStatusCode][int]$status)
        }
        throw $inner
    }
    if ($step.kind -eq 'tls-status') {
        throw [Net.Http.HttpRequestException]::new($message,
            [Security.Authentication.AuthenticationException]::new($message), [Net.HttpStatusCode][int]$step.status)
    }
    if ($step.kind -eq 'tls-timeout') {
        throw [Net.Http.HttpRequestException]::new([Net.Http.HttpRequestError]::SecureConnectionError,
            $message, [TimeoutException]::new($message))
    }
    if ($step.kind -eq 'cancelled') { throw [Threading.Tasks.TaskCanceledException]::new($message) }
    if ($step.kind -eq 'cancelled-timeout') {
        throw [Threading.Tasks.TaskCanceledException]::new($message, [TimeoutException]::new($message))
    }
    if ($step.kind -eq 'io-timeout') { throw [IO.IOException]::new($message, [TimeoutException]::new($message)) }
    throw [IO.IOException]::new($message)
}

# Substitute only the process boundary, retaining the production worker and deadline logic.
function New-FixtureProcess {
    $process = [pscustomobject]@{
        StartInfo = $null; Native = $null; IsExited = $false; Killed = $false
        Code = 0; Output = ''; Step = $null
    }
    $process | Add-Member ScriptProperty HasExited { if ($this.Native) { $this.Native.HasExited } else { $this.IsExited } }
    $process | Add-Member ScriptProperty ExitCode { if ($this.Native) { $this.Native.ExitCode } else { $this.Code } }
    $process | Add-Member ScriptProperty StandardOutput {
        if ($this.Native) { $this.Native.StandardOutput } else { [IO.StringReader]::new($this.Output) }
    }
    $process | Add-Member ScriptMethod Start {
        $index = $global:started++
        $this.Step = $global:fixture.steps[$index]
        $global:elapsed += [long]$global:fixture.processStartMs
        if ($this.Step.kind -eq 'start-failed') { throw 'DO_NOT_LOG PRIVATE_SIGNATURE' }
        $command = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($this.StartInfo.ArgumentList[-1]))
        if ($global:fixture.realProcesses) {
            $setup = '$global:fixture = Get-Content -LiteralPath $env:AC_CI_FIXTURE_SCENARIO -Raw | ConvertFrom-Json;' +
                '$global:calls = [Collections.Generic.List[object]]::new();' +
                '$global:elapsed = 0L; $global:partialCleared = $true;' +
                'function Invoke-WebRequest {' + (Get-Item Function:Invoke-WebRequest).Definition + "}`n"
            $this.StartInfo.ArgumentList[-1] = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($setup + $command))
            $this.StartInfo.Environment['AC_CI_FIXTURE_SCENARIO'] = $global:scenarioPath
            $this.StartInfo.Environment['AC_CI_FIXTURE_INDEX'] = [string]$index
            $this.Native = [Diagnostics.Process]::new()
            $this.Native.StartInfo = $this.StartInfo
            $started = $this.Native.Start()
            $global:childPids.Add($this.Native.Id)
            return $started
        }
        $saved = @{}
        try {
            foreach ($name in @('AC_CI_URI', 'AC_CI_FILE', 'AC_CI_TIMEOUT')) {
                $saved[$name] = [Environment]::GetEnvironmentVariable($name)
                [Environment]::SetEnvironmentVariable($name, $this.StartInfo.Environment[$name])
            }
            $this.Output = & ([scriptblock]::Create($command)) | Out-String
            $this.IsExited = $this.Step.kind -notin @('stall', 'thread-sleep', 'thread-sleep-tree')
            if ($this.Step.kind -eq 'invalid-json') { $this.Output = 'DO_NOT_LOG PRIVATE_SIGNATURE' }
            if ($this.Step.kind -eq 'worker-failed') { $this.Code = 1 }
        } finally {
            foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
        }
        return $true
    }
    $process | Add-Member ScriptMethod WaitForExit {
        param([int]$Timeout)
        if ($this.Killed) { $global:reaps.Add($Timeout) } else { $global:waits.Add($Timeout) }
        if ($this.Native) { return $this.Native.WaitForExit($Timeout) }
        if ($this.Killed -and $this.Step.reapThrows) { throw 'DO_NOT_LOG PRIVATE_SIGNATURE' }
        if ($this.IsExited) { return $true }
        if ($this.Killed -and -not $this.Step.reapFailure -and $this.Step.reapMs -le $Timeout) {
            $global:elapsed += [long]$this.Step.reapMs
            $this.IsExited = $true
            return $true
        }
        $global:elapsed += $Timeout
        return $false
    }
    $process | Add-Member ScriptMethod Kill {
        param([bool]$EntireProcessTree)
        $global:killed++
        $global:killTrees.Add($EntireProcessTree)
        $this.Killed = $true
        if ($this.Native) { $this.Native.Kill($EntireProcessTree) }
        elseif ($this.Step.killFailure) { throw 'DO_NOT_LOG PRIVATE_SIGNATURE' }
    }
    $process | Add-Member ScriptMethod Dispose {
        $global:disposed++
        if ($this.Native) { $this.Native.Dispose() }
    }
    return $process
}
function Start-Sleep {
    param([int]$Milliseconds, [int]$Seconds)
    $delay = $Milliseconds + 1000 * $Seconds
    $global:sleeps.Add($delay)
    if ($global:fixture.realProcesses) { Microsoft.PowerShell.Utility\Start-Sleep -Milliseconds $delay }
    $global:elapsed += $delay + [long]$global:fixture.sleepOvershootMs
}

$failure = $null
$output = [Collections.Generic.List[string]]::new()
try { & $Downloader *>&1 | ForEach-Object { $output.Add([string]$_) } }
catch { $failure = $_.Exception.Message }
if ($global:fixture.realProcesses) {
    foreach ($file in Get-ChildItem -LiteralPath (Split-Path $Scenario) -Filter 'call-*.json') {
        $call = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
        $global:calls.Add($call)
        $global:partialCleared = $global:partialCleared -and $call.partialCleared
    }
    foreach ($file in Get-ChildItem -LiteralPath (Split-Path $Scenario) -Filter 'descendant-*.pid') {
        $global:childPids.Add([int](Get-Content -LiteralPath $file.FullName -Raw))
    }
}
$remainingProcesses = 0
foreach ($childPid in $global:childPids) {
    try { $child = [Diagnostics.Process]::GetProcessById($childPid) }
    catch [ArgumentException] { continue }
    try {
        if (-not $child.WaitForExit(1000)) {
            $remainingProcesses++
            # Clean up only fixture-owned PIDs, but retain the failed observation.
            $child.Kill($true)
            $null = $child.WaitForExit(5000)
        }
    } finally { $child.Dispose() }
}
[pscustomobject]@{
    calls = @($global:calls.ToArray()); waits = @($global:waits.ToArray())
    sleeps = @($global:sleeps.ToArray()); elapsedMs = $global:elapsed
    reaps = @($global:reaps.ToArray()); killTrees = @($global:killTrees.ToArray())
    killed = $global:killed; disposed = $global:disposed; partialCleared = $global:partialCleared
    output = @($output.ToArray()); failure = $failure
    remainingJobs = @(Microsoft.PowerShell.Core\Get-Job).Count
    remainingProcesses = $remainingProcesses; childPids = @($global:childPids.ToArray())
    exported = @(if (Test-Path -LiteralPath $env:GITHUB_ENV) { Get-Content -LiteralPath $env:GITHUB_ENV })
} | ConvertTo-Json -Depth 8 -Compress
