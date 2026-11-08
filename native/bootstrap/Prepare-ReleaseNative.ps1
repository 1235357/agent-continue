# Offline vendor-release preparation only; never compile, execute or register.
# Retained read handles and rechecks narrow races, but are NOT a complete
# same-user/ACL or ancestor-rename race defense or a protected installation.
[CmdletBinding()]
param(
    [string]$ReleaseRoot = '',
    [string]$PayloadRoot = '',
    [string]$InstallDir = '',
    [string]$ExtensionId = '',
    [string]$Arch = '',
    [string]$NodePath = '',
    [string]$Consent = '',
    [switch]$Apply
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
$script:records = [Collections.ArrayList]::new()
$script:utf8 = [Text.UTF8Encoding]::new($false, $true)
$script:runtimeFiles = @(
    'device-native-host.mjs', 'device-operations.mjs', 'device-owner.mjs', 'device-server.mjs', 'device-ssh.mjs',
    'host.mjs', 'lifecycle.mjs', 'operation-receipts.mjs', 'package-lock.json', 'package.json',
    'prepared-process.mjs', 'process-observation.mjs', 'profile.mjs', 'research-handoff.mjs', 'research-runner.mjs', 'runtime.mjs', 'setup-cli.mjs',
    'tunnel-pins.json', 'upstream-pin.json', 'windows-child.mjs', 'windows-process-query.cs'
)
$safeCodes = @('native_release_unavailable', 'native_release_invalid', 'native_release_signature_invalid',
    'native_release_node_mismatch', 'native_release_payload_mismatch', 'native_release_destination_exists',
    'native_release_consent_required', 'native_release_preparation_failed')
$exitCode = 0
$output = ''

function Assert-LocalPath([string]$Path, [string]$Kind, [bool]$AllowMissing, [string]$Code) {
    if ([string]::IsNullOrEmpty($Path) -or $Path.Length -lt 3 -or $Path.Length -ge 260 -or
        $Path -cnotmatch '\A[A-Za-z]:\\' -or $Path.Contains('/') -or $Path.Substring(2).Contains(':')) { throw $Code }
    try {
        if ([IO.Path]::GetFullPath($Path) -cne $Path) { throw $Code }
        if ($Path.Length -gt 3) {
            foreach ($part in $Path.Substring(3).Split([char]'\')) {
                if ($part.Length -eq 0 -or $part -eq '.' -or $part -eq '..' -or $part.EndsWith('.') -or
                    $part.EndsWith(' ') -or $part.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 -or
                    $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3]|CONIN\$|CONOUT\$)(?:\.|$)') { throw $Code }
            }
        }
        $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($Path))
        if ($drive.DriveType -ne [IO.DriveType]::Fixed) { throw $Code }
        for ($cursor = $Path; $null -ne $cursor; $cursor = [IO.Path]::GetDirectoryName($cursor)) {
            try { $attributes = [IO.File]::GetAttributes($cursor) }
            catch [IO.FileNotFoundException] { if ($AllowMissing) { continue }; throw $Code }
            catch [IO.DirectoryNotFoundException] { if ($AllowMissing) { continue }; throw $Code }
            if ($attributes -band [IO.FileAttributes]::ReparsePoint) { throw $Code }
            $directory = ($attributes -band [IO.FileAttributes]::Directory) -ne 0
            if ($cursor -cne $Path -and -not $directory) { throw $Code }
            if ($cursor -ceq $Path -and (($Kind -ceq 'file' -and $directory) -or
                ($Kind -ceq 'directory' -and -not $directory))) { throw $Code }
        }
    } catch { throw $Code }
}

function Test-Entry([string]$Path) {
    try { $null = [IO.File]::GetAttributes($Path); return $true }
    catch [IO.FileNotFoundException] { return $false }
    catch [IO.DirectoryNotFoundException] { return $false }
}

function Get-StreamHash($Stream) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $Stream.Position = 0
        return [BitConverter]::ToString($sha.ComputeHash($Stream)).Replace('-', '').ToLowerInvariant()
    } finally { $Stream.Position = 0; $sha.Dispose() }
}

function Open-Record([string]$Path, [long]$Limit, [long]$Minimum, [string]$Code) {
    $stream = $null
    try {
        Assert-LocalPath $Path 'file' $false $Code
        $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        if ($stream.Length -lt $Minimum -or $stream.Length -gt $Limit) { throw $Code }
        $record = [pscustomobject]@{Path=$Path; Stream=$stream; Length=$stream.Length; Hash=(Get-StreamHash $stream); Error=$Code}
        [void]$script:records.Add($record)
        return $record
    } catch {
        if ($null -ne $stream) { $stream.Dispose() }
        throw $Code
    }
}

function Read-JsonRecord($Record) {
    try {
        $bytes = [byte[]]::new([int]$Record.Length)
        $Record.Stream.Position = 0
        $offset = 0
        while ($offset -lt $bytes.Length) {
            $count = $Record.Stream.Read($bytes, $offset, $bytes.Length - $offset)
            if ($count -eq 0) { throw $Record.Error }
            $offset += $count
        }
        $Record.Stream.Position = 0
        $text = $script:utf8.GetString($bytes)
        if ($text.Length -eq 0 -or $text[0] -eq [char]0xfeff -or $text.Contains([string][char]0)) { throw $Record.Error }
        $value = Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject $text -ErrorAction Stop
        return [pscustomobject]@{Value=$value; Text=$text}
    } catch { throw $Record.Error }
}

function Assert-Fields($Value, [string[]]$Names, [string]$Code) {
    if ($null -eq $Value -or $Value -isnot [pscustomobject] -or @($Value.PSObject.Properties).Count -ne $Names.Count) { throw $Code }
    foreach ($property in $Value.PSObject.Properties) {
        if ($Names -cnotcontains $property.Name) { throw $Code }
    }
}

function Get-CanonicalJson($Value) {
    return (Microsoft.PowerShell.Utility\ConvertTo-Json -InputObject $Value -Depth 8 -Compress) + "`n"
}

function Assert-Publishers($Value, [string]$Text) {
    $code = 'native_release_signature_invalid'
    Assert-Fields $Value @('format', 'version', 'thumbprints') $code
    if ($Value.format -isnot [string] -or $Value.format -cne 'agent-continue-windows-native-publishers' -or
        $Value.version -isnot [int] -or $Value.version -ne 1 -or
        $Value.thumbprints -isnot [array] -or $Value.thumbprints.Count -gt 16) { throw $code }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($thumbprint in $Value.thumbprints) {
        if ($thumbprint -isnot [string] -or $thumbprint -cnotmatch '\A[0-9a-fA-F]{40}\z' -or
            -not $seen.Add($thumbprint)) { throw $code }
    }
    $canonical = [ordered]@{format=$Value.format; version=1; thumbprints=@($Value.thumbprints)}
    if ((Get-CanonicalJson $canonical) -cne $Text) { throw $code }
    return $Value.thumbprints
}

function Read-NativePublishers {
    # Trust is shipped with this reviewed code, never selected by release assets.
    # Provisioning requires an intentional code/policy update, not OS trust edits.
    $record = Open-Record ([IO.Path]::Combine($PSScriptRoot, 'native-publishers.json')) 16384 1 'native_release_signature_invalid'
    if ($record.Hash -cne '436a531b201c7dc4efb26591417d6f59a81d7d2303239d2b9ae363b8b17d76a8') { throw 'native_release_signature_invalid' }
    $json = Read-JsonRecord $record
    return (Assert-Publishers $json.Value $json.Text)
}

function Assert-TrustedPublisher([string]$Thumbprint, [string[]]$Publishers) {
    if ($Thumbprint -cnotmatch '\A[0-9a-fA-F]{40}\z') { throw 'native_release_signature_invalid' }
    foreach ($publisher in $Publishers) {
        if ([string]::Equals($publisher, $Thumbprint, [StringComparison]::OrdinalIgnoreCase)) { return }
    }
    throw 'native_release_signature_invalid'
}

function Assert-Policy($Value, [string]$Text, [string]$Architecture) {
    $code = 'native_release_invalid'
    Assert-Fields $Value @('format', 'version', 'releaseVersion', 'arch', 'nodeVersion', 'nodeSha256',
        'launcherSha256', 'signerThumbprint', 'payloadManifestSha256') $code
    if ($Value.format -isnot [string] -or $Value.format -cne 'agent-continue-windows-native-release' -or
        $Value.version -isnot [int] -or $Value.version -ne 1 -or
        $Value.releaseVersion -isnot [string] -or $Value.releaseVersion -cnotmatch '\A(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\z' -or
        $Value.arch -isnot [string] -or $Value.arch -cne $Architecture -or
        $Value.nodeVersion -isnot [string] -or $Value.nodeVersion -cne '22.23.4' -or
        $Value.signerThumbprint -isnot [string] -or $Value.signerThumbprint -cnotmatch '\A[0-9a-fA-F]{40}\z') { throw $code }
    foreach ($part in $Value.releaseVersion.Split('.')) { if ([int]$part -gt 9999) { throw $code } }
    foreach ($name in @('nodeSha256', 'launcherSha256', 'payloadManifestSha256')) {
        if ($Value.$name -isnot [string] -or $Value.$name -cnotmatch '\A[a-f0-9]{64}\z') { throw $code }
    }
    # Reconstruct the closed schema before byte-equivalent text comparison.
    # This also rejects duplicate/escaped keys, coercions and relaxed JSON syntax.
    $canonical = [ordered]@{format=$Value.format; version=1; releaseVersion=$Value.releaseVersion; arch=$Value.arch
        nodeVersion=$Value.nodeVersion; nodeSha256=$Value.nodeSha256; launcherSha256=$Value.launcherSha256
        signerThumbprint=$Value.signerThumbprint; payloadManifestSha256=$Value.payloadManifestSha256}
    if ((Get-CanonicalJson $canonical) -cne $Text) { throw $code }
}

function Assert-PayloadManifest($Value, [string]$Text) {
    $code = 'native_release_payload_mismatch'
    Assert-Fields $Value @('format', 'version', 'provider', 'files') $code
    Assert-Fields $Value.provider @('name', 'version') $code
    if ($Value.format -isnot [string] -or $Value.format -cne 'agent-continue-payload' -or
        $Value.version -isnot [int] -or $Value.version -ne 1 -or
        $Value.provider.name -isnot [string] -or $Value.provider.name -cne '@wonderwhy-er/desktop-commander' -or
        $Value.provider.version -isnot [string] -or $Value.provider.version -cne '0.3.1' -or
        $Value.files -isnot [array] -or $Value.files.Count -ne $script:runtimeFiles.Count) { throw $code }
    $entries = @()
    $total = [long]0
    for ($index = 0; $index -lt $script:runtimeFiles.Count; $index++) {
        $entry = $Value.files[$index]
        Assert-Fields $entry @('path', 'bytes', 'sha256') $code
        if ($entry.path -isnot [string] -or $entry.path -cne $script:runtimeFiles[$index] -or
            $entry.bytes -isnot [int] -or $entry.bytes -lt 0 -or $entry.bytes -gt 4194304 -or
            $entry.sha256 -isnot [string] -or $entry.sha256 -cnotmatch '\A[a-f0-9]{64}\z') { throw $code }
        $total += $entry.bytes
        $entries += [ordered]@{path=$entry.path; bytes=$entry.bytes; sha256=$entry.sha256}
    }
    if ($total -gt 8388608) { throw $code }
    $canonical = [ordered]@{format=$Value.format; version=1
        provider=[ordered]@{name=$Value.provider.name; version=$Value.provider.version}; files=@($entries)}
    if ((Get-CanonicalJson $canonical) -cne $Text) { throw $code }
    return $entries
}

function Assert-PayloadFiles([string]$Root, $Entries) {
    $code = 'native_release_payload_mismatch'
    Assert-LocalPath $Root 'directory' $false $code
    foreach ($entry in $Entries) {
        $record = Open-Record ([IO.Path]::Combine($Root, $entry.path)) 4194304 0 $code
        if ($record.Length -ne $entry.bytes -or $record.Hash -cne $entry.sha256) { throw $code }
    }
}

function Assert-Install([string]$Root, [string]$Id, $Entries) {
    $code = 'native_release_payload_mismatch'
    Assert-LocalPath $Root 'directory' $false $code
    $app = [IO.Path]::Combine($Root, 'app')
    $state = [IO.Path]::Combine($Root, 'state')
    Assert-LocalPath $state 'directory' $false $code
    Assert-PayloadFiles $app $Entries
    $record = Open-Record ([IO.Path]::Combine($app, 'device-native-binding.json')) 16384 1 $code
    $json = Read-JsonRecord $record
    $value = $json.Value
    Assert-Fields $value @('format', 'version', 'extensionId', 'stateRoot') $code
    if ($value.format -isnot [string] -or $value.format -cne 'agent-continue-native-binding' -or
        $value.version -isnot [int] -or $value.version -ne 1 -or
        $value.extensionId -isnot [string] -or $value.extensionId -cne $Id -or
        $value.stateRoot -isnot [string] -or $value.stateRoot -cne $state) { throw $code }
    $canonical = [ordered]@{format=$value.format; version=1; extensionId=$Id; stateRoot=$state}
    if ((Get-CanonicalJson $canonical) -cne $json.Text) { throw $code }
}

function Assert-Launcher($Record, [string]$Version, [string]$Thumbprint) {
    $code = 'native_release_signature_invalid'
    $reader = $null
    try {
        # Read the actual PE header without loading or executing the image.
        $stream = $Record.Stream
        if ($stream.Length -lt 64) { throw $code }
        $reader = [IO.BinaryReader]::new($stream, $script:utf8, $true)
        $stream.Position = 0
        if ($reader.ReadUInt16() -ne 0x5a4d) { throw $code }
        $stream.Position = 0x3c
        $offset = $reader.ReadInt32()
        if ($offset -lt 64 -or $offset -gt $stream.Length - 94) { throw $code }
        $stream.Position = $offset
        if ($reader.ReadUInt32() -ne 0x4550) { throw $code }
        $stream.Position = $offset + 20
        $optionalSize = $reader.ReadUInt16()
        if ($optionalSize -lt 70 -or $offset + 24 + $optionalSize -gt $stream.Length) { throw $code }
        $stream.Position = $offset + 24
        if ($reader.ReadUInt16() -notin @(0x10b, 0x20b)) { throw $code }
        $stream.Position = $offset + 24 + 68
        if ($reader.ReadUInt16() -ne 2) { throw $code }
        Assert-LocalPath $Record.Path 'file' $false $code
        $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($Record.Path)
        if ($info.ProductName -cne 'Agent Continue' -or $info.FileVersion -cne ($Version + '.0')) { throw $code }
        $signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $Record.Path -ErrorAction Stop
        if ([string]$signature.Status -cne 'Valid' -or $null -eq $signature.SignerCertificate -or
            $null -eq $signature.TimeStamperCertificate -or
            -not [string]::Equals($signature.SignerCertificate.Thumbprint, $Thumbprint, [StringComparison]::OrdinalIgnoreCase)) { throw $code }
    } catch { throw $code }
    finally {
        if ($null -ne $reader) { $reader.Dispose() }
        $Record.Stream.Position = 0
    }
}

function Assert-CurrentRecords {
    foreach ($record in $script:records) {
        $current = $null
        try {
            Assert-LocalPath $record.Path 'file' $false $record.Error
            $current = [IO.File]::Open($record.Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
            if ($current.Length -ne $record.Length -or (Get-StreamHash $current) -cne $record.Hash -or
                (Get-StreamHash $record.Stream) -cne $record.Hash) { throw $record.Error }
        } catch { throw $record.Error }
        finally { if ($null -ne $current) { $current.Dispose() } }
    }
}

function Assert-NewDestination([string]$Path) {
    if (Test-Entry $Path) { throw 'native_release_destination_exists' }
    Assert-LocalPath $Path 'file' $true 'native_release_invalid'
}

function Copy-NewFile($Record, [string]$Destination) {
    Assert-NewDestination $Destination
    Assert-LocalPath ([IO.Path]::GetDirectoryName($Destination)) 'directory' $false 'native_release_invalid'
    $stream = $null
    try {
        $stream = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $Record.Stream.Position = 0
        $Record.Stream.CopyTo($stream)
        $stream.Flush($true)
    } catch {
        if ($null -eq $stream -and (Test-Entry $Destination)) { throw 'native_release_destination_exists' }
        throw 'native_release_preparation_failed'
    } finally {
        if ($null -ne $stream) { $stream.Dispose() }
    }
    $readback = Open-Record $Destination 536870912 0 'native_release_preparation_failed'
    if ($readback.Length -ne $Record.Length -or $readback.Hash -cne $Record.Hash) { throw 'native_release_preparation_failed' }
}

function Write-NewFile([byte[]]$Bytes, [string]$Destination) {
    Assert-NewDestination $Destination
    Assert-LocalPath ([IO.Path]::GetDirectoryName($Destination)) 'directory' $false 'native_release_invalid'
    $stream = $null
    try {
        $stream = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $stream.Write($Bytes, 0, $Bytes.Length)
        $stream.Flush($true)
    } catch {
        if ($null -eq $stream -and (Test-Entry $Destination)) { throw 'native_release_destination_exists' }
        throw 'native_release_preparation_failed'
    } finally { if ($null -ne $stream) { $stream.Dispose() } }
    $readback = Open-Record $Destination 16384 1 'native_release_preparation_failed'
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $expected = [BitConverter]::ToString($sha.ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
    if ($readback.Length -ne $Bytes.Length -or $readback.Hash -cne $expected) { throw 'native_release_preparation_failed' }
}

try {
    # Consent precedes module imports, path probes and all source/destination I/O.
    if ($Apply -and $Consent -cne 'accept-install') { throw 'native_release_consent_required' }
    if ($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion -lt [version]'5.1') { throw 'native_release_invalid' }
    foreach ($module in @('Microsoft.PowerShell.Security', 'Microsoft.PowerShell.Utility')) {
        Import-Module ([IO.Path]::Combine($PSHOME, "Modules\$module\$module.psd1")) -ErrorAction Stop
    }
    if ($Arch -cnotin @('x64', 'arm64') -or $ExtensionId -cnotmatch '\A[a-p]{32}\z') { throw 'native_release_invalid' }
    Assert-LocalPath $ReleaseRoot 'directory' $true 'native_release_invalid'
    Assert-LocalPath $PayloadRoot 'directory' $true 'native_release_invalid'
    if ($Apply -or $InstallDir.Length -gt 0) { Assert-LocalPath $InstallDir 'directory' $true 'native_release_invalid' }
    $assetRoot = [IO.Path]::Combine($ReleaseRoot, $Arch)
    $policyPath = [IO.Path]::Combine($assetRoot, 'release.json')
    Assert-LocalPath $policyPath 'file' $true 'native_release_invalid'
    if (-not (Test-Entry $policyPath)) { throw 'native_release_unavailable' }
    $policyRecord = Open-Record $policyPath 16384 1 'native_release_invalid'
    $json = Read-JsonRecord $policyRecord
    $policy = $json.Value
    Assert-Policy $policy $json.Text $Arch
    $publishers = @(Read-NativePublishers)
    Assert-TrustedPublisher $policy.signerThumbprint $publishers
    $launcher = Open-Record ([IO.Path]::Combine($assetRoot, 'native-launcher.exe')) 536870912 1 'native_release_unavailable'
    $launcher.Error = 'native_release_invalid'
    if ($launcher.Hash -cne $policy.launcherSha256) { throw 'native_release_invalid' }
    $manifestRecord = Open-Record ([IO.Path]::Combine($PayloadRoot, 'payload-manifest.json')) 65536 1 'native_release_payload_mismatch'
    if ($manifestRecord.Hash -cne $policy.payloadManifestSha256) { throw 'native_release_payload_mismatch' }
    $json = Read-JsonRecord $manifestRecord
    $entries = @(Assert-PayloadManifest $json.Value $json.Text)
    Assert-PayloadFiles ([IO.Path]::Combine($PayloadRoot, 'payload')) $entries

    $node = $null
    if ($NodePath.Length -gt 0) {
        $node = Open-Record $NodePath 536870912 1 'native_release_node_mismatch'
        if ($node.Hash -cne $policy.nodeSha256) { throw 'native_release_node_mismatch' }
    }
    if ($Apply) {
        if ($null -eq $node -or [IO.Path]::GetFileName($NodePath) -cne 'node.exe') { throw 'native_release_node_mismatch' }
        Assert-Install $InstallDir $ExtensionId $entries
        $runtime = [IO.Path]::Combine($InstallDir, 'runtime')
        $nodeDestination = [IO.Path]::Combine($runtime, 'node.exe')
        $launcherDestination = [IO.Path]::Combine($InstallDir, 'native-launcher.exe')
        $manifestDestination = [IO.Path]::Combine($InstallDir, 'native-host.json')
        foreach ($destination in @($nodeDestination, $launcherDestination, $manifestDestination)) { Assert-NewDestination $destination }
        Assert-LocalPath $runtime 'directory' $true 'native_release_invalid'
    }
    Assert-Launcher $launcher $policy.releaseVersion $policy.signerThumbprint
    Assert-CurrentRecords
    $result = [ordered]@{ok=$true; mode='plan'; prepared=$false; extensionId=$ExtensionId; arch=$Arch
        releaseVersion=$policy.releaseVersion; nodeVersion=$policy.nodeVersion; nodeSha256=$policy.nodeSha256
        launcherSha256=$policy.launcherSha256; registered=$false; activated=$false; classificationVerified=$false}
    if ($Apply) {
        # CreateNew is final authority for each output. Partial output is retained
        # on every failure; retries must not overwrite or silently clean it up.
        Assert-Install $InstallDir $ExtensionId $entries
        Assert-CurrentRecords
        foreach ($destination in @($nodeDestination, $launcherDestination, $manifestDestination)) { Assert-NewDestination $destination }
        Assert-LocalPath $runtime 'directory' $true 'native_release_invalid'
        $null = [IO.Directory]::CreateDirectory($runtime)
        Assert-LocalPath $runtime 'directory' $false 'native_release_invalid'
        Copy-NewFile $node $nodeDestination
        Copy-NewFile $launcher $launcherDestination
        $nativeManifest = [ordered]@{name='com.agentcontinue.device_control'; description='Agent Continue device lifecycle bridge'
            path=$launcherDestination; type='stdio'; allowed_origins=@('chrome-extension://' + $ExtensionId + '/')}
        Write-NewFile ($script:utf8.GetBytes((Get-CanonicalJson $nativeManifest))) $manifestDestination
        $installedLauncher = Open-Record $launcherDestination 536870912 1 'native_release_preparation_failed'
        Assert-Launcher $installedLauncher $policy.releaseVersion $policy.signerThumbprint
        Assert-Launcher $launcher $policy.releaseVersion $policy.signerThumbprint
        Assert-LocalPath ([IO.Path]::Combine($InstallDir, 'state')) 'directory' $false 'native_release_payload_mismatch'
        Assert-CurrentRecords
        $result.mode = 'prepared'
        $result.prepared = $true
    }
    $output = Microsoft.PowerShell.Utility\ConvertTo-Json -InputObject $result -Depth 4 -Compress
} catch {
    $code = 'native_release_preparation_failed'
    if ($safeCodes -ccontains $_.Exception.Message) { $code = $_.Exception.Message }
    $output = '{"ok":false,"error":"' + $code + '"}'
    $exitCode = 1
} finally {
    foreach ($record in $script:records) {
        try { $record.Stream.Dispose() }
        catch { $output = '{"ok":false,"error":"native_release_preparation_failed"}'; $exitCode = 1 }
    }
}
[Console]::Out.Write($output + "`n")
exit $exitCode
