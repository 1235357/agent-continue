$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP -or -not $env:GITHUB_ENV) {
    throw 'This downloader is for disposable GitHub-hosted CI only.'
}
if ((-not $IsLinux -and -not $IsWindows) -or [Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -ne 'X64') {
    throw 'This CI fixture currently supports Linux and Windows x64 only.'
}
$pins = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../tunnel-pins.json') -Raw | ConvertFrom-Json
$platform = if ($IsWindows) { 'win32-x64' } else { 'linux-x64' }
$assetOs = if ($IsWindows) { 'windows' } else { 'linux' }
$executableName = if ($IsWindows) { 'tunnel-client-runtime.exe' } else { 'tunnel-client-runtime' }
$pin = $pins.platforms.PSObject.Properties[$platform].Value
if ($pins.release -cne 'v0.0.19' -or $pin.asset -cne "tunnel-client-runtime-v0.0.19-$assetOs-amd64.zip") {
    throw 'Unexpected CI release input.'
}
$root = Join-Path ([IO.Path]::GetFullPath($env:RUNNER_TEMP)) ('agentcontinue-tunnel-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $root
$zipPath = Join-Path $root 'release.zip'
$uri = 'https://github.com/openai/tunnel-client/releases/download/v0.0.19/' + $pin.asset
$downloadClock = [Diagnostics.Stopwatch]::StartNew()
$downloadAttempt = {
    param($Uri, $OutFile, $TimeoutSeconds)
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    try {
        $request = @{
            Uri = $Uri; OutFile = $OutFile; TimeoutSec = $TimeoutSeconds
            MaximumRetryCount = 0; ErrorAction = 'Stop'; Verbose = $false; Debug = $false
        }
        if ((Get-Command Invoke-WebRequest).Parameters.ContainsKey('OperationTimeoutSeconds')) {
            $request.OperationTimeoutSeconds = $TimeoutSeconds
        }
        $null = Invoke-WebRequest @request
        [pscustomobject]@{ State = 'downloaded'; Retry = $false }
    } catch {
        $status = 0
        $transient = $false
        $tlsFailure = $false
        $permanent = $false
        $retryStatuses = @(408, 429, 500, 502, 503, 504)
        $exception = $_.Exception
        while ($exception) {
            $code = 0
            if ($exception.PSObject.Properties['Response'] -and $exception.Response) {
                $code = [int]$exception.Response.StatusCode
            } elseif ($exception.PSObject.Properties['StatusCode'] -and $exception.StatusCode) {
                $code = [int]$exception.StatusCode
            }
            if ($code) {
                if (-not $status -or ($status -in $retryStatuses -and $code -notin $retryStatuses)) { $status = $code }
                if ($code -notin $retryStatuses) { $permanent = $true }
            }
            if ($exception -is [TimeoutException]) { $transient = $true }
            if ($exception -is [Net.WebException]) {
                $transient = $transient -or $exception.Status -in @(
                    'Timeout', 'NameResolutionFailure', 'ProxyNameResolutionFailure', 'ConnectFailure',
                    'ConnectionClosed', 'ReceiveFailure', 'SendFailure', 'KeepAliveFailure'
                )
                $tlsFailure = $tlsFailure -or $exception.Status -in @('TrustFailure', 'SecureChannelFailure')
            }
            if ($exception -is [Security.Authentication.AuthenticationException]) { $tlsFailure = $true }
            if ($exception -is [Net.Http.HttpRequestException] -and $exception.PSObject.Properties['HttpRequestError']) {
                $transient = $transient -or $exception.HttpRequestError -in @('NameResolutionError', 'ConnectionError', 'ResponseEnded')
                $tlsFailure = $tlsFailure -or $exception.HttpRequestError -eq 'SecureConnectionError'
            }
            if ($exception -is [Net.Http.HttpIOException] -and $exception.HttpRequestError -eq 'ResponseEnded') {
                $transient = $true
            } elseif ($exception -is [IO.IOException]) {
                $permanent = $true
            }
            $exception = $exception.InnerException
        }
        if ($status) {
            [pscustomobject]@{ State = "http_$status"; Retry = -not $tlsFailure -and -not $permanent -and $status -in $retryStatuses }
        } else {
            [pscustomobject]@{ State = 'network_error'; Retry = $transient -and -not $tlsFailure -and -not $permanent }
        }
    }
}

# Only fixed worker code is encoded; request data travels separately in the child environment.
$workerCommand = '& {' + $downloadAttempt.ToString() + '} $env:AC_CI_URI $env:AC_CI_FILE ([int]$env:AC_CI_TIMEOUT) | ConvertTo-Json -Compress'
$encodedWorker = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($workerCommand))
$requestLimitMs = 30000
$totalLimitMs = 100000
$reapLimitMs = 5000
# Reserve a finite reap inside the total budget, including process startup and backoff.
for ($attempt = 1; $attempt -le 3; $attempt++) {
    $attemptStart = $downloadClock.ElapsedMilliseconds
    $timeout = [int][Math]::Floor([Math]::Min($requestLimitMs, $totalLimitMs - $attemptStart - $reapLimitMs) / 1000)
    if ($timeout -lt 1) { throw 'CI download budget exhausted.' }
    if (Test-Path -LiteralPath $zipPath) { [IO.File]::Delete($zipPath) }
    $process = [Diagnostics.Process]::new()
    $started = $false
    $result = [pscustomobject]@{ State = 'timeout'; Retry = $true }
    try {
        $info = [Diagnostics.ProcessStartInfo]::new()
        $info.FileName = (Get-Process -Id $PID).Path
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        foreach ($argument in @('-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', $encodedWorker)) {
            $info.ArgumentList.Add($argument)
        }
        $info.Environment['AC_CI_URI'] = $uri
        $info.Environment['AC_CI_FILE'] = $zipPath
        $info.Environment['AC_CI_TIMEOUT'] = [string]$timeout
        $process.StartInfo = $info
        if ($downloadClock.ElapsedMilliseconds -ge $totalLimitMs - $reapLimitMs) { throw 'budget_exhausted' }
        $started = $process.Start()
        if (-not $started) { throw 'worker_start_failed' }
        $now = $downloadClock.ElapsedMilliseconds
        $waitMs = [int][Math]::Max(0, [Math]::Min($requestLimitMs - ($now - $attemptStart), $totalLimitMs - $now - $reapLimitMs))
        if ($process.WaitForExit($waitMs)) {
            if (-not $process.HasExited -or $process.ExitCode -ne 0) { throw 'worker_failed' }
            $json = $process.StandardOutput.ReadToEnd()
            if ($json.Length -gt 256) { throw 'worker_result_invalid' }
            $result = $json | ConvertFrom-Json -ErrorAction Stop
            if (@($result.PSObject.Properties).Count -ne 2 -or $result.Retry -isnot [bool] -or
                $result.State -cnotmatch '^(downloaded|network_error|http_[1-5][0-9]{2})$') { throw 'worker_result_invalid' }
        }
    } catch {
        throw 'CI download worker failed.'
    } finally {
        try {
            if ($started -and -not $process.HasExited) {
                try { $process.Kill($true) } catch { }
                $reapMs = [int][Math]::Max(0, [Math]::Min($reapLimitMs, $totalLimitMs - $downloadClock.ElapsedMilliseconds))
                if (-not $process.WaitForExit($reapMs) -or -not $process.HasExited) {
                    throw 'CI download worker exit unverified.'
                }
            }
        } catch {
            throw 'CI download worker exit unverified.'
        } finally { $process.Dispose() }
    }
    $elapsed = $downloadClock.ElapsedMilliseconds
    if ($elapsed -ge $totalLimitMs) { throw 'CI download budget exhausted.' }
    [pscustomobject]@{ attempt = $attempt; state = $result.State; elapsedMs = $elapsed } | ConvertTo-Json -Compress
    if ($result.State -eq 'downloaded') { break }
    if (-not $result.Retry) { throw 'CI download failed (non-transient).' }
    if ($attempt -eq 3) { throw 'CI download attempt limit exhausted.' }
    $delayMs = 2000 * $attempt
    if ($elapsed + $delayMs + $reapLimitMs + 1000 -ge $totalLimitMs) { throw 'CI download budget exhausted.' }
    Start-Sleep -Milliseconds $delayMs
}
if ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pin.archiveSha256) {
    throw 'CI archive digest mismatch.'
}
$zip = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $entries = @($zip.Entries | Where-Object FullName -ceq $executableName)
    if ($entries.Count -ne 1 -or $entries[0].Length -lt 1 -or $entries[0].Length -gt 134217728) {
        throw 'Unexpected CI executable entry.'
    }
    $type = ($entries[0].ExternalAttributes -shr 16) -band 0xF000
    if ($type -ne 0 -and $type -ne 0x8000) { throw 'CI executable is not a regular archive entry.' }
    $exe = Join-Path $root $executableName
    $entryStream = $entries[0].Open()
    $fileStream = [IO.File]::Open($exe, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $entryStream.CopyTo($fileStream) } finally { $entryStream.Dispose(); $fileStream.Dispose() }
} finally { $zip.Dispose() }
if ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pin.executableSha256) {
    throw 'CI executable digest mismatch.'
}
if ($IsLinux) {
    [IO.File]::SetUnixFileMode($exe, [IO.UnixFileMode]::UserRead -bor [IO.UnixFileMode]::UserWrite -bor [IO.UnixFileMode]::UserExecute)
}
Add-Content -LiteralPath $env:GITHUB_ENV -Value @("TUNNEL_CLIENT_TEST_EXE=$exe", "TUNNEL_CLIENT_TEST_ARCHIVE=$zipPath")
[pscustomobject]@{ state = 'verified'; runtimeStarted = $false } | ConvertTo-Json -Compress
