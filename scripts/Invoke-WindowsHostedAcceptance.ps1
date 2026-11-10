[CmdletBinding()]
param(
    [ValidateSet('Plan', 'Start')][string]$Action = 'Plan',
    [Parameter(Mandatory=$true)][string]$Archive,
    [Parameter(Mandatory=$true)][ValidatePattern('\A[a-fA-F0-9]{64}\z')][string]$ExpectedSha256,
    [Parameter(Mandatory=$true)][ValidatePattern('\Atunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}\z', Options='None')][string]$TunnelId,
    [Parameter(Mandatory=$true)][ValidatePattern('\A[a-p]{32}\z', Options='None')][string]$ExtensionId,
    [Parameter(Mandatory=$true)][ValidatePattern('\A[a-z0-9][a-z0-9-]{0,47}\z', Options='None')][string]$RunId,
    [string]$Consent = '',
    [string]$RuntimeKeyFile = ''
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -eq 'Desktop') {
    try {
        # A clean or PS7-inherited module path must not control OS dependencies.
        foreach ($module in @('Microsoft.PowerShell.Management', 'Microsoft.PowerShell.Utility')) {
            $moduleManifest = [IO.Path]::Combine($PSHOME, "Modules\$module\$module.psd1")
            Import-Module $moduleManifest -ErrorAction Stop
        }
    } catch {
        [Console]::Out.WriteLine('{"ok":false,"action":"preflight","error":"module_initialization_failed"}')
        exit 1
    }
}
$archiveStream = $zip = $null
$runRoot = $null
$claimed = $false
$operationPattern = '\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z'

function Assert-LocalPath([string]$Path) {
    if ($Path -cnotmatch '\A[A-Za-z]:\\[^\\]' -or $Path.Substring(2) -match '[\x00-\x1f<>:"|?*/]' -or
        $Path -ine [IO.Path]::GetFullPath($Path)) { throw 'unsafe_path' }
    if (([IO.DriveInfo]::new($Path.Substring(0, 3))).DriveType -ne [IO.DriveType]::Fixed) { throw 'unsafe_path' }
    $cursor = $Path
    while ($cursor) {
        try { $item = Get-Item -LiteralPath $cursor -Force }
        catch [System.Management.Automation.ItemNotFoundException] { $item = $null }
        if ($null -ne $item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'unsafe_path' }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
}

function Get-AcceptanceArchiveLayout($Zip) {
    $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $total = 0L
    $preview = $false
    if ($Zip.Entries.Count -gt 512) { throw 'archive_invalid' }
    foreach ($entry in $Zip.Entries) {
        $name = $entry.FullName
        $unixType = ($entry.ExternalAttributes -shr 16) -band 0xF000
        if ($name -cnotmatch '\A[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*\z' -or
            $name -match '(^|/)(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?=/|\.|$)' -or
            $name -match '(?:\.(?=/|$)|\.(exe|msi|dll|pem|pfx|key|crx|lnk)$)' -or
            ($unixType -ne 0 -and $unixType -ne 0x8000) -or
            -not $names.Add($name) -or $entry.Length -gt 16MB) { throw 'archive_invalid' }
        $total += $entry.Length
        if ($total -gt 128MB) { throw 'archive_invalid' }
        if ($name -match '\A(?:AgentContinue/|WindowsSetup/|START-HERE\.md\z)') { $preview = $true }
    }
    foreach ($name in $names) {
        $parent = $name
        while (($slash = $parent.LastIndexOf('/')) -ge 0) {
            $parent = $parent.Substring(0, $slash)
            if ($names.Contains($parent)) { throw 'archive_invalid' }
        }
        if ($preview -and $name -cnotmatch '\A(?:AgentContinue/|WindowsSetup/|START-HERE\.md\z|SHA256SUMS\.txt\z)') {
            throw 'archive_invalid'
        }
    }

    $required = @('install.ps1', 'bin.mjs', 'SHA256SUMS.txt')
    if ($preview) {
        if ($total -gt 32MB) { throw 'archive_invalid' }
        $required = @('START-HERE.md', 'SHA256SUMS.txt', 'AgentContinue/manifest.json', 'AgentContinue/setup.html',
            'WindowsSetup/install.cmd') + @($required | ForEach-Object { 'WindowsSetup/' + $_ })
    } elseif ($Zip.Entries.Count -gt 256) {
        throw 'archive_invalid'
    }
    foreach ($name in $required) {
        if ($null -eq $Zip.GetEntry($name)) { throw 'archive_invalid' }
    }
    if ($preview) { return 'windows-preview-kit' }
    return 'standalone-setup'
}

function Expand-AcceptanceSetup($Zip, [string]$Package, [string]$Layout) {
    $prefix = 'WindowsSetup/'
    $buffer = [byte[]]::new(65536)
    foreach ($entry in $Zip.Entries) {
        $name = $entry.FullName
        if ($Layout -ceq 'windows-preview-kit') {
            if (-not $name.StartsWith($prefix, [StringComparison]::Ordinal)) { continue }
            $name = $name.Substring($prefix.Length)
        }
        $destination = Join-Path $Package $name
        $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
        $source = $output = $null
        try {
            $source = $entry.Open()
            $output = [IO.File]::Open($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            # A malformed ZIP may decompress to more bytes than its directory declares.
            $remaining = $entry.Length
            while ($remaining -gt 0) {
                $count = $source.Read($buffer, 0, [int][Math]::Min($remaining, [long]$buffer.Length))
                if ($count -eq 0) { throw 'archive_invalid' }
                $output.Write($buffer, 0, $count)
                $remaining -= $count
            }
            if ($source.ReadByte() -ne -1) { throw 'archive_invalid' }
        } catch [IO.InvalidDataException] {
            throw 'archive_invalid'
        } finally {
            if ($null -ne $output) { $output.Dispose() }
            if ($null -ne $source) { $source.Dispose() }
        }
    }
}

function Get-SafeInstallerResult($Result, [int]$ExitCode) {
    $resultShape = @{
        ok = $false; action = 'start'; error = 'installer_result_unconfirmed'
        runRoot = $runRoot; hostedToolCallVerified = $false
    }
    $booleanFields = @($Result.configured, $Result.registered, $Result.connected, $Result.chatAuthorizationVerified,
        $Result.manager.ok, $Result.manager.managerRunning, $Result.manager.connected, $Result.manager.paused)
    $booleansValid = @($booleanFields | Where-Object { $_ -is [bool] }).Count -eq $booleanFields.Count
    if ($ExitCode -eq 0 -and $Result.ok -is [bool] -and $Result.ok -and $booleansValid -and
        $Result.action -ceq 'install-local' -and $Result.mode -ceq 'command-only' -and
        $Result.configured -eq $true -and $Result.registered -eq $false -and
        $Result.connected -eq $true -and $Result.chatAuthorizationVerified -eq $false -and
        $Result.manager.ok -eq $true -and $Result.manager.managerRunning -eq $true -and
        $Result.manager.connected -eq $true -and $Result.manager.paused -eq $false -and
        $Result.manager.operationStatus -ceq 'settled' -and
        $Result.manager.operationId -is [string] -and $Result.manager.operationId -cmatch $operationPattern) {
        $resultShape.ok = $true
        $resultShape.Remove('error')
        $resultShape.connected = $true
        $resultShape.operationId = $Result.manager.operationId
        $resultShape.operationStatus = 'settled'
    } elseif ($ExitCode -ne 0 -and $Result.ok -is [bool] -and -not $Result.ok -and
        $Result.error -ceq 'manager_start_unconfirmed' -and
        $Result.operationId -is [string] -and $Result.operationId -cmatch $operationPattern -and
        $Result.operationStatus -is [string] -and
        $Result.operationStatus -cin @('unobserved','in-progress','unknown-running','unknown','settled','not-executed')) {
        $resultShape.error = 'manager_start_unconfirmed'
        $resultShape.operationId = $Result.operationId
        $resultShape.operationStatus = $Result.operationStatus
    }
    return $resultShape
}

function Invoke-AcceptanceInstaller([string]$PowerShell, [string[]]$Arguments) {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $PowerShell
    # Validated local paths and fixed arguments never end with a slash or contain quotes.
    $info.Arguments = ($Arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $child = [Diagnostics.Process]::Start($info)
    try {
        $stdout = $child.StandardOutput.ReadToEndAsync()
        $stderr = $child.StandardError.ReadToEndAsync()
        # An inherited pipe can remain open even when the installer exits.
        # Do not kill or retry a manager whose start may already be settled.
        if (-not $child.WaitForExit(180000) -or
            -not [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($stdout, $stderr), 5000)) {
            return @{ exitCode = -1; stdout = $null }
        }
        return @{ exitCode = $child.ExitCode; stdout = $stdout.Result.Trim() }
    } finally {
        $child.Dispose()
    }
}

try {
    if ($env:OS -cne 'Windows_NT') { throw 'windows_required' }
    if ($Action -eq 'Start' -and $Consent -cne 'accept-private-hosted-test') { throw 'consent_required' }
    $runRoot = Join-Path $env:LOCALAPPDATA "AgentContinueHostedAcceptance\run-$RunId"
    $keyFile = if ($RuntimeKeyFile) { $RuntimeKeyFile } else {
        Join-Path $env:LOCALAPPDATA 'AgentContinue-Acceptance-RuntimeKey.txt'
    }
    foreach ($localPath in @($Archive, $runRoot, $keyFile)) { Assert-LocalPath $localPath }
    if (Test-Path -LiteralPath $runRoot) { throw 'run_exists' }

    if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) { throw 'archive_missing' }
    $archiveStream = [IO.File]::Open($Archive, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    if ($archiveStream.Length -gt 64MB) { throw 'archive_invalid' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $actual = [BitConverter]::ToString($sha.ComputeHash($archiveStream)).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
    if ($actual -ne $ExpectedSha256) { throw 'archive_digest_mismatch' }
    $archiveStream.Position = 0
    Add-Type -AssemblyName System.IO.Compression
    try { $zip = [IO.Compression.ZipArchive]::new($archiveStream, [IO.Compression.ZipArchiveMode]::Read, $true) }
    catch { throw 'archive_invalid' }
    $archiveLayout = Get-AcceptanceArchiveLayout $zip
    $keyReady = Test-Path -LiteralPath $keyFile -PathType Leaf
    if ($keyReady) {
        $keyLength = (Get-Item -LiteralPath $keyFile -Force).Length
        if ($keyLength -lt 1 -or $keyLength -gt 64KB) { throw 'acceptance_key_invalid' }
    }
    if ($Action -eq 'Plan') {
        $reason = if ($keyReady) { $null } else { 'acceptance_key_missing' }
        @{ ok = $true; action = 'plan'; ready = $keyReady; reason = $reason; archiveSha256 = $actual; archiveLayout = $archiveLayout
            runRoot = $runRoot; hostedToolCallVerified = $false } | ConvertTo-Json -Compress
        exit 0
    }
    if (-not $keyReady) { throw 'acceptance_key_missing' }

    $runParent = [IO.Path]::GetDirectoryName($runRoot)
    $null = [IO.Directory]::CreateDirectory($runParent)
    Assert-LocalPath $runRoot
    try { $null = New-Item -Path $runParent -Name "run-$RunId" -ItemType Directory }
    catch [System.IO.IOException] { throw 'run_exists' }
    $claimed = $true
    $package = Join-Path $runRoot 'package'
    Expand-AcceptanceSetup $zip $package $archiveLayout
    $requestFile = Join-Path $runRoot 'setup-request.json'
    $request = [ordered]@{ format = 'agent-continue-device-setup'; version = 1; target = 'windows'
        extensionId = $ExtensionId; nativeHost = 'com.agentcontinue.device_control' } | ConvertTo-Json
    [IO.File]::WriteAllText($requestFile, (($request -replace "`r`n", "`n") + "`n"), [Text.Encoding]::ASCII)
    $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $install = Join-Path $package 'install.ps1'
    $manager = Join-Path $runRoot 'manager'
    $invoked = Invoke-AcceptanceInstaller $ps @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', $install,
        '-InstallLocal', '-Consent', 'accept-install', '-InstallDir', $manager, '-SetupRequest', $requestFile,
        '-ExtensionId', $ExtensionId, '-TunnelId', $TunnelId, '-RuntimeKeyFile', $keyFile)
    $raw = $invoked.stdout
    $data = $null
    if ($raw -is [string] -and $raw.Length -le 8192) {
        try { $data = ConvertFrom-Json -InputObject $raw } catch { }
    }
    $receipt = Get-SafeInstallerResult $data $invoked.exitCode
    $receipt.archiveSha256 = $actual
    $receipt.archiveLayout = $archiveLayout
    $out = $receipt | ConvertTo-Json -Compress
    [IO.File]::WriteAllText((Join-Path $runRoot 'receipt.json'), "$out`n", [Text.Encoding]::UTF8)
    $out
    if (-not $receipt.ok) { exit 1 }
} catch {
    $known = @('windows_required','consent_required','unsafe_path','run_exists','archive_missing','archive_invalid',
        'archive_digest_mismatch','acceptance_key_missing','acceptance_key_invalid')
    $code = if ($_.Exception.Message -cin $known) { $_.Exception.Message } else { 'launch_unconfirmed' }
    $errorResult = @{ ok = $false; action = $Action.ToLowerInvariant(); error = $code }
    if ($claimed) { $errorResult.runRoot = $runRoot }
    $errorResult | ConvertTo-Json -Compress
    exit 1
} finally {
    if ($null -ne $zip) { $zip.Dispose() }
    if ($null -ne $archiveStream) { $archiveStream.Dispose() }
}
