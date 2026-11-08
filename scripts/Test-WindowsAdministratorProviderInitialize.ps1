[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Archive,
    [Parameter(Mandatory=$true)][ValidatePattern('\A[a-f0-9]{64}\z')][string]$ExpectedSha256,
    [switch]$KeepScratchOnFailure
)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop' -or -not [Environment]::Is64BitProcess) {
    throw 'windows_powershell_5_1_x64_required'
}
if ($ExpectedSha256 -cnotmatch '\A[a-f0-9]{64}\z') { throw 'invalid_archive_digest' }

# Import only the fixture helpers. The stager entry point also inspects the installed anchor.
$parseErrors = $null
$stager = [Management.Automation.Language.Parser]::ParseFile(
    [IO.Path]::Combine($PSScriptRoot,'Stage-WindowsAdministratorBundle.ps1'),[ref]$null,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'fixture_stager_parse' }
$definitions = $stager.FindAll({
    param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]
},$false)
foreach ($name in @('Assert-AdministratorIdentity','To-Hex','Assert-PathType','New-SealedAcl','Assert-SealedAcl',
    'Ensure-SealedDirectory','Open-SealedNewFile','Get-Layout','Copy-Or-Hash','Get-AdministratorStateLayout',
    'Write-AdministratorState','Assert-FreshAdministratorState','New-AdministratorLaunchPlan',
    'New-AdministratorHostedDocument','Get-AdministratorHostedMetadata','Get-AdministratorOwnerMetadata',
    'Assert-AdministratorOwnerBytes','Write-AdministratorOwnerFile','Test-AdministratorOwnerAbsent',
    'Read-LocalProbeReply')) {
    $matches = @($definitions | Where-Object { $_.Name -ceq $name })
    if ($matches.Count -ne 1) { throw "fixture_stager_helper:$name" }
    . ([scriptblock]::Create($matches[0].Extent.Text))
}

try { Assert-AdministratorIdentity '' } catch { throw 'existing_high_integrity_administrator_token_required' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
try { $sid = $identity.User.Value } finally { $identity.Dispose() }
$system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
$groups = @(& ([IO.Path]::Combine($system,'whoami.exe')) /groups /fo csv /nh)
if ($LASTEXITCODE -ne 0 -or @($groups -match ',"S-1-16-12288",').Count -ne 1) {
    throw 'existing_high_integrity_administrator_token_required'
}

$Archive = $Archive.Replace('/','\')
if ($Archive -notmatch '\A[A-Z]:\\[^\\]' -or $Archive.Substring(2) -match '[\x00-\x1f<>:"|?*]' -or
    $Archive -ine [IO.Path]::GetFullPath($Archive) -or $Archive -match '\\AgentContinueAdmin\\' -or
    [IO.DriveInfo]::new([IO.Path]::GetPathRoot($Archive)).DriveType -ne 'Fixed') { throw 'local_fixture_archive_required' }
Assert-PathType $Archive $false
for ($dir = [IO.Path]::GetDirectoryName($Archive); $dir; $dir = [IO.Path]::GetDirectoryName($dir)) {
    Assert-PathType $dir $true
}

$PSModuleAutoLoadingPreference = 'None'
Import-Module -Name ([IO.Path]::Combine($PSHOME,'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1'))
Import-Module -Name ([IO.Path]::Combine($PSHOME,'Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1'))
Add-Type -AssemblyName System.IO.Compression

$systemSid = 'S-1-5-18'
$administratorsSid = 'S-1-5-32-544'
$requiredFiles = @('runtime/node.exe','client/tunnel-client-runtime.exe','app/host.mjs','app/runtime.mjs',
    'app/lifecycle.mjs','app/profile.mjs','app/tunnel-pins.json','app/upstream-pin.json','app/package-lock.json',
    'app/windows-admin-owner.mjs','app/node_modules/@wonderwhy-er/desktop-commander/dist/server.js')
$manifestLimit = 40000
$entryLimit = 192MB
$totalLimit = 768MB

# Use system scratch, not an inherited TEMP or the installed AgentContinue directory.
$windows = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
$volume = [IO.Path]::GetPathRoot($windows)
$disk = [IO.DriveInfo]::new($volume)
if ($disk.DriveType -ne 'Fixed' -or $disk.DriveFormat -cne 'NTFS' -or
    [IO.Path]::GetDirectoryName($windows) -ine $volume) { throw 'fixture_scratch_volume' }
Assert-PathType $volume $true
Assert-PathType $windows $true
# The packaged loader and owner check the case-sensitive native spelling.
$windows = [IO.Directory]::GetDirectories($volume,[IO.Path]::GetFileName($windows))[0]
$parent = [IO.Directory]::GetDirectories($windows,'Temp')[0]
Assert-PathType $parent $true
$scratch = [IO.Path]::Combine($parent,'ac-admin-init-' + [Guid]::NewGuid().ToString('N'))
$bundle = [IO.Path]::Combine($scratch,$ExpectedSha256.Substring(0,24))
$state = $bundle + '.state'
$vault = $bundle + '.secrets'
$key = [IO.Path]::Combine($vault,'runtime.key')
$held = $zip = $sha = $child = $null
$claimed = $providerAttempted = $passed = $false
try {
    $held = [IO.File]::Open($Archive,'Open','Read','Read')
    $sha = [Security.Cryptography.SHA256]::Create()
    if ((To-Hex ($sha.ComputeHash($held))) -cne $ExpectedSha256) { throw 'fixture_archive_digest_mismatch' }
    $held.Position = 0
    $zip = [IO.Compression.ZipArchive]::new($held,[IO.Compression.ZipArchiveMode]::Read,$true)
    $inventory = Get-Layout $zip $bundle
    if ([IO.File]::Exists($scratch) -or [IO.Directory]::Exists($scratch)) { throw 'fixture_scratch_exists' }
    Ensure-SealedDirectory $scratch $true
    $claimed = $true
    foreach ($entry in $inventory.entries.Values) {
        # Validate the client member as part of the archive, but never materialize the tunnel executable.
        if ($entry.FullName -ceq 'client/tunnel-client-runtime.exe') { continue }
        $destination = [IO.Path]::Combine($bundle,$entry.FullName.Replace('/','\'))
        $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
        $source = $output = $null
        try {
            $source = $entry.Open()
            $output = [IO.File]::Open($destination,'CreateNew','Write','None')
            Copy-Or-Hash $source $entry.Length $output
        } finally {
            if ($null -ne $output) { $output.Dispose() }
            if ($null -ne $source) { $source.Dispose() }
        }
    }

    $layout = Get-AdministratorStateLayout $ExpectedSha256 $sid
    Write-AdministratorState $state $layout
    Assert-FreshAdministratorState $state $layout
    Ensure-SealedDirectory $vault $true
    $tunnelId = 'tunnel_00000000000000000000000000000000'
    $binding = Get-AdministratorHostedMetadata $bundle $state $ExpectedSha256 $sid $tunnelId
    $owner = Get-AdministratorOwnerMetadata $bundle $state $ExpectedSha256 $sid $tunnelId
    Write-AdministratorOwnerFile ([IO.Path]::Combine($vault,'tunnel.yaml')) $binding.profile
    Write-AdministratorOwnerFile ([IO.Path]::Combine($vault,'binding.json')) $binding.receipt
    $ownerProfile = [IO.Path]::Combine($vault,'owner-tunnel.yaml')
    Write-AdministratorOwnerFile $ownerProfile $owner.profile
    Write-AdministratorOwnerFile ([IO.Path]::Combine($vault,'owner-activation.json')) $owner.grant
    $profile = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($ownerProfile))
    if ($profile.control_plane.api_key -cne ('file:' + $key) -or -not (Test-AdministratorOwnerAbsent $key)) {
        throw 'fixture_runtime_key_not_absent'
    }

    $launch = New-AdministratorLaunchPlan $bundle $state
    $exe = [IO.Path]::Combine($bundle,'runtime','node.exe').Replace('\','/')
    $hostPath = [IO.Path]::Combine($bundle,'app','host.mjs').Replace('\','/')
    $loader = ([Uri]::new([IO.Path]::Combine($state,'startup-imports.mjs'))).AbsoluteUri
    $argv = '--no-global-search-paths --import "{0}" "{1}" --state-dir "{2}" --administrator-owner' -f
        $loader,$hostPath,$state.Replace('\','/')
    $command = $profile.mcp.commands[0].command
    $parts = [regex]::Match($command,'\A"([^"]+)" (.+)\z')
    if (-not $parts.Success -or $command -cne ('"' + $exe + '" ' + $argv)) {
        throw 'fixture_owner_command_mismatch'
    }
    # Pass through the serialized profile spelling, including the slash-form state argument.
    $launch.FileName = $parts.Groups[1].Value
    $launch.Arguments = $parts.Groups[2].Value
    $launch.RedirectStandardInput = $launch.RedirectStandardOutput = $launch.RedirectStandardError = $true
    $launch.StandardOutputEncoding = [Text.UTF8Encoding]::new($false,$true)
    $expected = ConvertFrom-Json -InputObject $layout.files['consent.json']
    $protocol = '2025-11-25'
    $request = @{jsonrpc='2.0';id=1;method='initialize';params=@{
        protocolVersion=$protocol;capabilities=@{};clientInfo=@{name='agent-continue-offline-provider-fixture';version='1.0.0'}
    }}
    $bytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $request -Depth 5 -Compress) + [char]10)

    $providerAttempted = $true
    try { $child = [Diagnostics.Process]::Start($launch) } catch { throw 'fixture_provider_start_failed' }
    $null = $child.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
    $inputStream = $child.StandardInput.BaseStream
    try {
        $inputStream.Write($bytes,0,$bytes.Length)
        $inputStream.Flush()
        $result = Read-LocalProbeReply $child 1
    } catch { throw 'fixture_provider_initialize_failed' }
    finally { $inputStream.Dispose() }
    $null = $child.StandardOutput.BaseStream.CopyToAsync([IO.Stream]::Null)
    if (-not $child.WaitForExit(10000) -or $child.ExitCode -ne 0) { throw 'fixture_provider_shutdown_failed' }
    if ($result.protocolVersion -cne $protocol -or $result.serverInfo.name -cne 'desktop-commander' -or
        $result.serverInfo.version -cne $expected.providerVersion -or $null -eq $result.capabilities.tools) {
        throw 'fixture_provider_info_mismatch'
    }
    if (-not (Test-AdministratorOwnerAbsent $key) -or
        -not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($state,'health.url'))) -or
        -not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($state,'native-tunnel.log')))) {
        throw 'fixture_unexpected_tunnel_artifact'
    }
    Assert-AdministratorOwnerBytes ([IO.Path]::Combine($state,'lifecycle.json')) (
        [Text.Encoding]::UTF8.GetBytes($layout.files['lifecycle.json']))
    $passed = $true
} finally {
    if ($null -ne $zip) { $zip.Dispose() }
    if ($null -ne $held) { $held.Dispose() }
    if ($null -ne $sha) { $sha.Dispose() }
    if ($null -ne $child) {
        try {
            if (-not $child.HasExited -and -not $child.WaitForExit(1000)) {
                $child.Kill()
                if (-not $child.WaitForExit(5000)) { throw 'fixture_provider_not_stopped' }
            }
        } finally { $child.Dispose() }
    }
    if ($claimed) {
        Assert-PathType $parent $true
        Assert-SealedAcl $scratch $true $true
        $target = [IO.Path]::GetFullPath($scratch)
        if ([IO.Path]::GetDirectoryName($target) -cne $parent -or
            [IO.Path]::GetFileName($target) -cnotmatch '\Aac-admin-init-[a-f0-9]{32}\z') { throw 'unsafe_fixture_cleanup' }
        if ($KeepScratchOnFailure -and -not $passed -and $providerAttempted -and (Test-AdministratorOwnerAbsent $key)) {
            Write-Warning "Provider fixture retained for diagnosis: $target"
        } else {
            Remove-Item -LiteralPath $target -Recurse -Force
        }
    }
}

[Console]::WriteLine((ConvertTo-Json -Compress -Depth 4 -InputObject ([ordered]@{
    ok=$true;bundleSha256=$ExpectedSha256;serverInfo=@{name=$result.serverInfo.name;version=$result.serverInfo.version}
    protocolVersion=$result.protocolVersion;initializeOnly=$true;stdinCloseExit=0;runtimeKeyPresent=$false
    tunnelStarted=$false;protectedInstallationVerified=$false
})))
