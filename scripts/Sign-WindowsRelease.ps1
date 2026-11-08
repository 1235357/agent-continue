# Maintainer-only Authenticode signing. Does not build, register or execute artifacts.
[CmdletBinding()]
param(
    [string]$FilePath = '',
    [string]$ExpectedSha256 = '',
    [string]$OutputPath = '',
    [string]$CertificateThumbprint = '',
    [string]$TimestampServer = '',
    [string]$Consent = '',
    [switch]$Sign
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$inputStream = $null
$known = @('signing_input_invalid', 'signing_output_exists', 'signing_consent_required',
    'signing_certificate_required', 'signing_certificate_unavailable', 'signing_timestamp_invalid',
    'signing_readback_failed', 'release_signing_failed')

function Assert-SigningPath([string]$Value, [bool]$Existing) {
    if ($Value -cnotmatch '\A[A-Za-z]:\\' -or $Value.Length -ge 260 -or $Value.Contains('/') -or
        $Value.Substring(2).Contains(':') -or [IO.Path]::GetFullPath($Value) -cne $Value -or
        [IO.Path]::GetExtension($Value) -cnotin @('.exe', '.ps1')) { throw 'signing_input_invalid' }
    foreach ($part in $Value.Substring(3).Split([char]'\')) {
        if (-not $part -or $part -in @('.', '..') -or $part.EndsWith('.') -or $part.EndsWith(' ') -or
            $part.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 -or
            $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3]|CONIN\$|CONOUT\$)(?:\.|$)') { throw 'signing_input_invalid' }
    }
    $drive = New-Object IO.DriveInfo([IO.Path]::GetPathRoot($Value))
    if ($drive.DriveType -ne [IO.DriveType]::Fixed) { throw 'signing_input_invalid' }
    if ($Existing) {
        $item = Get-Item -LiteralPath $Value -Force
        if ($item -isnot [IO.FileInfo]) { throw 'signing_input_invalid' }
    } else {
        if (Test-Path -LiteralPath $Value) { throw 'signing_output_exists' }
        $item = Get-Item -LiteralPath ([IO.Path]::GetDirectoryName($Value)) -Force
        if ($item -isnot [IO.DirectoryInfo]) { throw 'signing_input_invalid' }
    }
    while ($null -ne $item) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'signing_input_invalid' }
        if ($item -is [IO.FileInfo]) { $item = $item.Directory } else { $item = $item.Parent }
    }
}

function Get-StreamDigest([IO.Stream]$Stream) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $Stream.Position = 0
        return ([BitConverter]::ToString($sha.ComputeHash($Stream))).Replace('-', '').ToLowerInvariant()
    } finally { $sha.Dispose(); $Stream.Position = 0 }
}

function Get-SelectedCertificate {
    if ($CertificateThumbprint -cnotmatch '\A[A-Fa-f0-9]{40}\z') { throw 'signing_certificate_required' }
    # Do not select a certificate implicitly or export any private-key material.
    try { $cert = Get-Item -LiteralPath ('Cert:\CurrentUser\My\' + $CertificateThumbprint) }
    catch { throw 'signing_certificate_unavailable' }
    $now = [DateTime]::UtcNow
    if (-not $cert.HasPrivateKey -or $cert.NotBefore.ToUniversalTime() -gt $now -or
        $cert.NotAfter.ToUniversalTime() -le $now -or
        $cert.EnhancedKeyUsageList.ObjectId -notcontains '1.3.6.1.5.5.7.3.3') { throw 'signing_certificate_unavailable' }
    return $cert
}

try {
    if ($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion -lt [version]'5.1') { throw 'signing_input_invalid' }
    # Resolve the OS module explicitly, not a Node parent's PSModulePath.
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
    if ($Sign -and $Consent -cne 'accept-sign') { throw 'signing_consent_required' }
    if ($Sign -and -not $CertificateThumbprint) { throw 'signing_certificate_required' }
    if ($ExpectedSha256 -cnotmatch '\A[a-f0-9]{64}\z') { throw 'signing_input_invalid' }
    Assert-SigningPath $FilePath $true
    # Retain a read-only source handle throughout; sign only a new output copy.
    $inputStream = [IO.File]::Open($FilePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    if ((Get-StreamDigest $inputStream) -cne $ExpectedSha256) { throw 'signing_input_invalid' }
    $before = Get-AuthenticodeSignature -LiteralPath $FilePath
    $cert = $null
    if ($CertificateThumbprint) { $cert = Get-SelectedCertificate }
    if (-not $Sign) {
        $result = [ordered]@{ok=$true;mode='plan';sourceSha256=$ExpectedSha256;artifactChanged=$false
            certificateAvailable=($null -ne $cert);localSignatureValid=($before.Status -eq 'Valid')
            classificationVerified=$false;runtimeVerified=$false}
    } else {
        Assert-SigningPath $OutputPath $false
        if ([IO.Path]::GetExtension($OutputPath) -cne [IO.Path]::GetExtension($FilePath)) { throw 'signing_input_invalid' }
        $uri = $null
        if (-not [Uri]::TryCreate($TimestampServer, [UriKind]::Absolute, [ref]$uri) -or
            $uri.Scheme -cne 'http' -or -not $uri.Host -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) { throw 'signing_timestamp_invalid' }
        $output = [IO.File]::Open($OutputPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $inputStream.CopyTo($output); $output.Flush($true) } finally { $output.Dispose() }
        if ((Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedSha256) { throw 'signing_readback_failed' }
        # Certificate credentials stay in the OS provider. No trust-store modification.
        $signed = Set-AuthenticodeSignature -LiteralPath $OutputPath -Certificate $cert -HashAlgorithm 'SHA256' `
            -IncludeChain NotRoot -TimestampServer $TimestampServer -Confirm:$false
        $readback = Get-AuthenticodeSignature -LiteralPath $OutputPath
        if ($signed.Status -ne 'Valid' -or $readback.Status -ne 'Valid' -or
            $null -eq $readback.SignerCertificate -or $null -eq $readback.TimeStamperCertificate -or
            $readback.SignerCertificate.Thumbprint -ine $cert.Thumbprint) { throw 'signing_readback_failed' }
        Assert-SigningPath $OutputPath $true
        if ((Get-StreamDigest $inputStream) -cne $ExpectedSha256) { throw 'signing_readback_failed' }
        $result = [ordered]@{ok=$true;mode='signed-copy';sourceSha256=$ExpectedSha256;artifactChanged=$true
            signedSha256=(Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
            certificateAvailable=$true;localSignatureValid=$true;timestampPresent=$true
            classificationVerified=$false;runtimeVerified=$false}
    }
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
} catch {
    $code = $_.Exception.Message
    if ($code -cnotin $known) { $code = 'release_signing_failed' }
    [Console]::Out.WriteLine((@{ok=$false;error=$code;failureLine=$_.InvocationInfo.ScriptLineNumber
        failureCategory=[string]$_.CategoryInfo.Category;failureHResult=$_.Exception.HResult
        classificationVerified=$false;runtimeVerified=$false} | ConvertTo-Json -Compress))
    exit 1
} finally { if ($null -ne $inputStream) { $inputStream.Dispose() } }
