<#
AgentContinue command installer (Windows, current user by default).

Default action is a read-only plan. This script never writes the registry and
does not elevate in standard mode: registration is executed by
`native/bootstrap/bin.mjs`. Explicit -Administrator delegates to the separately
verified administrator installer, using one consent and Windows elevation.

  .\install.ps1 -ExtensionId <32 chars>              # plan (no writes)
  .\install.ps1 -ExtensionId <32 chars> -Verify       # verify --json
  .\install.ps1 -InstallLocal -Consent accept-install -SetupRequest setup-request.json `
      -TunnelId <id> -RuntimeKeyFile <file>             # reuses Node or provisions a portable copy
  .\install.ps1 -InstallLocal -Consent accept-install -PromptForConnection -ExtensionId <32 chars>
  .\install.ps1 -InstallLocal -BrowserManaged -Consent accept-install -PromptForConnection -ExtensionId <32 chars>
  .\install.ps1 -Administrator -Apply -Consent accept-administrator-browser-installation -PromptForConnection -ExtensionId <32 chars>
  .\install.ps1 -DeviceAction installer-status        # observes the original connection attempt
  .\install.ps1 -DeviceAction browser-installer-status # read-only browser bridge inspection
  .\install.ps1 -DeviceAction browser -Consent accept-control  # temporary local controls
  .\install.ps1 -DeviceAction register-browser-wake -ExtensionId <32 chars> -Consent accept-browser-wake
  .\install.ps1 -Uninstall                            # local-only dry-run removal plan
  .\install.ps1 -ExtensionId <32> -Apply -ManagerOnly -Consent accept-install `
      -SetupRequest setup-request.json                 # prepared, not connected
  .\install.ps1 -ExtensionId <32> -Apply -Consent accept-install `
      -SetupRequest setup-request.json -TunnelId <id> -RuntimeKeyFile <file>

The remote one-liner downloads only this script, so when `bin.mjs` is not
beside it the payload archive is fetched into a temporary directory, checked
against SHA256SUMS.txt and removed in `finally`. Uninstall inspection is the
exception: it requires the already-extracted local payload and never downloads
one or provisions Node. Administrator mode uses a separate release bundle and
does not invoke a custom EXE/MSI installer or the legacy native launcher.
#>
[CmdletBinding()]
param(
    [string]$ExtensionId = '',
    [string]$BrowserSetupId = '',
    [string]$InstallDir = '',
    [string]$Arch = '',
    [string]$SetupRequest = '',
    [string]$TunnelId = '',
    [string]$RuntimeKeyFile = '',
    [string]$Consent = '',
    [string]$NodePath = '',
    [string]$DeviceAction = '',
    [string]$OperationId = '',
    [string]$PayloadBase = '',
    [string]$ExpectedSumsSha256 = '',
    [switch]$Apply,
    [switch]$InstallLocal,
    [switch]$Administrator,
    [switch]$BrowserManaged,
    [switch]$PromptForConnection,
    [switch]$ManagerOnly,
    [switch]$PrepareNative,
    [switch]$RegisterNative,
    [switch]$Verify,
    [switch]$Uninstall,
    [switch]$AllowUnverifiedPayload
)

$script:acPath = $env:PATH
$script:acTls = [Net.ServicePointManager]::SecurityProtocol
$script:acTemp = ''
$script:acPayloadRoot = ''
$script:acRemote = $false
$script:acKeepTemp = $false
$script:acExistingBrowserInstall = $false
$script:acModulesInitialized = $false
# Stamped in release artifacts; a source checkout deliberately stays unpinned.
$script:acReleaseTag = ''
$script:acAdministratorInstallerSha256 = ''

function Initialize-InstallerModules {
    if ($script:acModulesInitialized) { return }
    # PS7 parents can pass their PSModulePath to PS5.1. Load OS modules only
    # after cheap refusal checks, before the first hashing/archive/JSON use.
    if ($PSVersionTable.PSEdition -eq 'Desktop') {
        foreach ($module in @('Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Archive')) {
            Import-Module (Join-Path $PSHOME ("Modules\$module\$module.psd1")) -ErrorAction Stop
        }
    }
    $script:acModulesInitialized = $true
}

function Assert-BrowserSetupContinuationInput {
    param([string]$Id, [bool]$Administrator, [bool]$Apply, [bool]$InstallLocal,
        [bool]$BrowserManaged, [bool]$PromptForConnection, [string]$Consent)
    if ($Id -cnotmatch '\A[a-f0-9]{32}\z') { throw 'invalid_browser_setup_id' }
    if ($Administrator) {
        if (-not $Apply) { throw 'invalid_browser_setup_id' }
        return
    }
    if (-not $InstallLocal -or -not $BrowserManaged -or -not $PromptForConnection -or $Apply -or
        $Consent -cne 'accept-install') { throw 'invalid_browser_setup_id' }
}

function Get-CurrentAccountSetupPublisherSource {
    return @'
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [payloadRoot,installDir,extensionId,setupId]=process.argv.slice(1);
if (!path.isAbsolute(payloadRoot) || !path.isAbsolute(installDir) || !/^[a-p]{32}$/.test(extensionId) ||
    !/^[a-f0-9]{32}$/.test(setupId)) throw new Error('setup_receipt_failed');
const { verifyProviderStage }=await import(pathToFileURL(path.join(payloadRoot,'bootstrap.mjs')).href);
await verifyProviderStage(installDir,payloadRoot);
const app=path.join(installDir,'app');
const { readNativeBinding }=await import(pathToFileURL(path.join(app,'device-owner.mjs')).href);
const { publishCurrentAccountSetupReceipt }=await import(pathToFileURL(path.join(app,'device-operations.mjs')).href);
await verifyProviderStage(installDir,payloadRoot);
const binding=readNativeBinding(path.join(app,'device-native-binding.json'));
if (binding.extensionId !== extensionId || binding.root !== path.join(installDir,'state')) throw new Error('setup_identity_mismatch');
binding.assertCurrent();
const receipt=publishCurrentAccountSetupReceipt(binding,setupId);
process.stdout.write(JSON.stringify(receipt)+'\n');
'@
}

function Publish-CurrentAccountBrowserSetup([string]$Output) {
    try {
        $value = ConvertFrom-Json -InputObject $Output
        if (-not (Test-ExactJsonProperties $value @('ok','action','mode','configured','registered','connected',
                'browserLaunchVerified','chatAuthorizationVerified','registration')) -or
            $value.ok -isnot [bool] -or -not $value.ok -or $value.action -cne 'install-local' -or
            $value.mode -cne 'browser-managed' -or $value.configured -isnot [bool] -or -not $value.configured -or
            $value.registered -isnot [bool] -or -not $value.registered -or $value.connected -isnot [bool] -or $value.connected -or
            $value.browserLaunchVerified -isnot [bool] -or $value.browserLaunchVerified -or
            $value.chatAuthorizationVerified -isnot [bool] -or $value.chatAuthorizationVerified) { throw 'setup_receipt_failed' }
        $registration = $value.registration
        if (-not (Test-ExactJsonProperties $registration @('ok','status','host','registered','launchVerified','activated','chatAuthorizationVerified')) -or
            $registration.ok -isnot [bool] -or -not $registration.ok -or $registration.status -cnotin @('written','already-present') -or
            $registration.host -cne 'com.agentcontinue.device_wake' -or $registration.registered -isnot [bool] -or -not $registration.registered -or
            $registration.launchVerified -isnot [bool] -or $registration.launchVerified -or
            $registration.activated -isnot [bool] -or $registration.activated -or
            $registration.chatAuthorizationVerified -isnot [bool] -or $registration.chatAuthorizationVerified) { throw 'setup_receipt_failed' }
        $source = Get-CurrentAccountSetupPublisherSource
        $raw = (& $script:acNode '--input-type=module' '-e' $source $script:acPayloadRoot $InstallDir $ExtensionId $BrowserSetupId 2>$null) -join "`n"
        if ($LASTEXITCODE -ne 0 -or $raw.Length -gt 4096) { throw 'setup_receipt_failed' }
        $proof = ConvertFrom-Json -InputObject $raw
        if (-not (Test-ExactJsonProperties $proof @('setupId','state','scope','extensionId','bindingSha256')) -or
            $proof.setupId -cne $BrowserSetupId -or $proof.state -cne 'installed' -or $proof.scope -cne 'current-account' -or
            $proof.extensionId -cne $ExtensionId -or $proof.bindingSha256 -isnot [string] -or
            $proof.bindingSha256 -cnotmatch '\A[a-f0-9]{64}\z') { throw 'setup_receipt_failed' }
        return $proof
    } catch { throw 'setup_receipt_failed' }
}

function Get-DefaultPayloadBase {
    if ($env:AGENT_CONTINUE_PAYLOAD_BASE) { return $env:AGENT_CONTINUE_PAYLOAD_BASE }
    if ($script:acReleaseTag) {
        return ('https://github.com/1235357/agent-continue/releases/download/' + $script:acReleaseTag)
    }
    return 'https://github.com/1235357/agent-continue/releases/latest/download'
}

function Assert-SetupChecksumList([string]$File) {
    if ($ExpectedSumsSha256 -and
        (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedSumsSha256) {
        throw 'payload_digest_mismatch'
    }
}

function Test-UnverifiedPayloadInspection {
    return -not $script:acReleaseTag -and
        -not ($Apply -or $InstallLocal -or $Administrator -or $BrowserManaged -or $PromptForConnection -or
            $ManagerOnly -or $PrepareNative -or $RegisterNative -or $OperationId) -and
        $DeviceAction -cin @('', 'status', 'installer-status', 'browser-installer-status')
}

function Get-InstallFailureCode([string]$Message) {
    $known = @(
        'consent_required', 'invalid_manager_arguments', 'install_argument_missing', 'install_file_missing', 'interactive_terminal_required',
        'setup_request_invalid', 'invalid_extension_id', 'setup_identity_mismatch', 'setup_input_invalid',
        'node_not_found', 'node_version_unreadable', 'node_version_too_old', 'unsupported_architecture',
        'invalid_install_root', 'node_download_failed', 'node_archive_digest_mismatch', 'node_archive_invalid',
        'node_provision_existing_invalid', 'node_provision_invalid', 'architecture_mismatch',
        'payload_digest_mismatch', 'payload_integrity_unverified', 'payload_incomplete', 'payload_path_invalid',
        'payload_file_missing', 'payload_manifest_empty', 'bootstrap_no_output', 'unsupported_os',
        'native_builder_missing', 'native_build_failed', 'native_registration_failed', 'manager_start_unconfirmed', 'manager_profile_mismatch', 'manager_operation_receipt_invalid',
        'browser_wake_invalid_install', 'browser_wake_owner_present', 'browser_wake_registry_conflict',
        'browser_wake_registry_unconfirmed', 'browser_wake_bundle_conflict', 'manager_operation_not_recorded',
        'destination_exists', 'payload_invalid', 'dependency_acquisition_failed', 'acquisition_exit_unconfirmed',
        'provider_verification_failed', 'provider_stage_invalid', 'setup_configuration_failed',
        'setup_receipt_failed', 'setup_cancelled', 'receipt_write_failed', 'client_acquisition_failed',
        'client_verification_failed', 'client_archive_invalid', 'client_receipt_failed', 'npm_unavailable',
        'native_manifest_invalid', 'uninstall_inspection_failed', 'uninstall_inspection_unavailable', 'native_release_unavailable',
        'native_release_invalid', 'native_release_signature_invalid', 'native_release_node_mismatch',
        'native_release_payload_mismatch', 'native_release_destination_exists',
        'native_release_consent_required', 'native_release_preparation_failed', 'device_control_payload_missing',
        'administrator_release_unavailable'
    )
    if ($Message -cin $known -or $Message -cmatch '\Abootstrap_failed_exit_[0-9]{1,10}\z') { return $Message }
    return 'local_install_failed'
}

function Get-BootstrapFailureCode([string]$Output, [int]$ExitCode) {
    if ($Output.Length -le 65536) {
        try {
            $failure = ConvertFrom-Json -InputObject $Output
            if ($failure -is [pscustomobject] -and @($failure.PSObject.Properties).Count -eq 2 -and
                $failure.ok -is [bool] -and -not $failure.ok -and $failure.error -is [string]) {
                $code = Get-InstallFailureCode $failure.error
                if ($code -cne 'local_install_failed') { return $code }
            }
        } catch { }
    }
    return "bootstrap_failed_exit_$ExitCode"
}

function Test-ManagerProfileMismatch([string]$Output, [int]$ExitCode) {
    return $ExitCode -eq 1 -and $Output -ceq '{"ok":false,"error":"manager_profile_mismatch"}'
}

function ConvertFrom-ManagerOperationFailure([string]$Output) {
    if ($Output.Length -gt 1024 -or -not $Output.TrimStart().StartsWith('{')) { return }
    try {
        $value = ConvertFrom-Json -InputObject $Output
        if ($value -isnot [pscustomobject]) { return }
        $names = @($value.PSObject.Properties.Name)
        if ($names.Count -ne 4 -or 'ok' -cnotin $names -or 'error' -cnotin $names -or
            'operationId' -cnotin $names -or 'operationStatus' -cnotin $names -or
            $value.ok -isnot [bool] -or $value.ok -or $value.error -isnot [string] -or
            $value.error -cne 'manager_start_unconfirmed' -or $value.operationId -isnot [string] -or
            $value.operationId -cnotmatch '\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z' -or
            $value.operationStatus -isnot [string] -or
            $value.operationStatus -cnotin @('unobserved','in-progress','unknown-running','unknown','settled','not-executed')) { return }
        return @{ ok = $false; error = $value.error; operationId = $value.operationId; operationStatus = $value.operationStatus }
    } catch { return }
}

function Read-GuidedValue([string]$Label, [switch]$Mask) {
    $hidden = $null
    $pointer = [IntPtr]::Zero
    try {
        if ($Mask) {
            $hidden = Read-Host -Prompt $Label -AsSecureString
            if ($null -ne $hidden) {
                $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($hidden)
                $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
            } else { $value = $null }
        } else {
            $value = Read-Host -Prompt $Label
        }
    } catch [System.Management.Automation.PipelineStoppedException] { throw }
      catch { throw 'interactive_terminal_required' }
    finally {
        if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
        if ($null -ne $hidden) { $hidden.Dispose() }
    }
    if ([string]::IsNullOrWhiteSpace($value)) { throw 'setup_cancelled' }
    return $value.Trim()
}

function Resolve-GuidedFile([string]$Value, [long]$MaxBytes) {
    if ($Value.Length -ge 2 -and $Value[0] -eq '"' -and $Value[$Value.Length - 1] -eq '"') {
        $Value = $Value.Substring(1, $Value.Length - 2)
    }
    if ($Value -cnotmatch '\A[A-Za-z]:\\[^\\]' -or $Value.Substring(2) -match '[\x00-\x1f\x7f<>:"|?*/]' -or
        @($Value.Substring(3).Split('\\') | Where-Object { -not $_ -or $_ -match '[. ]$' }).Count) { throw 'setup_input_invalid' }
    $drive = [IO.DriveInfo]::new($Value.Substring(0, 3))
    if ($drive.DriveType -notin @([IO.DriveType]::Fixed, [IO.DriveType]::Removable)) { throw 'setup_input_invalid' }
    $path = [IO.Path]::GetFullPath($Value)
    $info = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    if ($null -eq $info) { throw 'install_file_missing' }
    if ($info -isnot [IO.FileInfo] -or $info.Length -lt 1 -or $info.Length -gt $MaxBytes) { throw 'setup_input_invalid' }
    for ($entry = $info; $null -ne $entry; $entry = $(if ($entry -is [IO.FileInfo]) { $entry.Directory } else { $entry.Parent })) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'setup_input_invalid' }
    }
    return $path
}

function Assert-FileDigest([string]$File, [string]$Sums, [string]$Name) {
    foreach ($line in Get-Content -LiteralPath $Sums) {
        if ($line -notmatch '^([a-f0-9]{64})\s+\*?(\S.*)$') { continue }
        if ($Matches[2].Trim() -ne $Name) { continue }
        $actual = (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $Matches[1]) { throw 'payload_digest_mismatch' }
        return $true
    }
    return $false
}

function Get-AdjacentSetupArchive([string]$Directory = $PSScriptRoot) {
    if (-not $Directory) { return $null }
    $archive = Join-Path $Directory 'agent-continue-setup.zip'
    $entry = Get-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
    if ($null -eq $entry) {
        foreach ($marker in @('release.json', 'agent-continue-windows-administrator-x64.zip')) {
            if (Get-Item -LiteralPath (Join-Path $Directory $marker) -Force -ErrorAction SilentlyContinue) {
                throw 'payload_integrity_unverified'
            }
        }
        return $null
    }
    $sums = Join-Path $Directory 'SHA256SUMS.txt'
    foreach ($file in @($archive, $sums)) {
        $info = Get-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
        if ($null -eq $info) { throw 'payload_integrity_unverified' }
        $limit = if ($file -ceq $archive) { 64MB } else { 4MB }
        if ($info -isnot [IO.FileInfo] -or $info.Length -le 0 -or $info.Length -gt $limit) { throw 'payload_path_invalid' }
        for ($parent = $info; $null -ne $parent; $parent = $(if ($parent -is [IO.FileInfo]) { $parent.Directory } else { $parent.Parent })) {
            if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'payload_path_invalid' }
        }
    }
    $rows = @(Get-Content -LiteralPath $sums | Where-Object { $_ -cmatch '^[a-f0-9]{64}  agent-continue-setup\.zip$' })
    if ($rows.Count -ne 1 -or -not (Assert-FileDigest $archive $sums 'agent-continue-setup.zip')) {
        throw 'payload_integrity_unverified'
    }
    return @{ Archive=$archive; Sums=$sums }
}

function Get-AdjacentAdministratorParameters([string]$Installer) {
    $adjacent = Get-AdjacentSetupArchive
    if ($null -eq $adjacent) { return @{} }
    if ($script:acAdministratorInstallerSha256 -cnotmatch '\A[a-f0-9]{64}\z') { throw 'payload_integrity_unverified' }
    $paths = @{ Installer=$Installer;
        Archive=(Join-Path $PSScriptRoot 'agent-continue-windows-administrator-x64.zip');
        Stager=(Join-Path $PSScriptRoot 'Stage-WindowsAdministratorBundle.ps1') }
    $limits = @{ Installer=64KB; Archive=768MB; Stager=512KB }
    foreach ($key in @('Installer', 'Archive', 'Stager')) {
        $info = Get-Item -LiteralPath $paths[$key] -Force -ErrorAction SilentlyContinue
        if ($null -eq $info) { throw 'administrator_release_unavailable' }
        if ($info -isnot [IO.FileInfo] -or $info.Length -le 0 -or $info.Length -gt $limits[$key]) { throw 'payload_path_invalid' }
        for ($parent = $info; $null -ne $parent; $parent = $(if ($parent -is [IO.FileInfo]) { $parent.Directory } else { $parent.Parent })) {
            if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'payload_path_invalid' }
        }
    }
    # Parse pins only from the helper bytes covered by the parent release pin.
    $bytes = [IO.File]::ReadAllBytes($Installer)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        if ([BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant() -cne
            $script:acAdministratorInstallerSha256) { throw 'payload_digest_mismatch' }
    } finally { $sha.Dispose() }
    $source = [Text.UTF8Encoding]::new($false,$true).GetString($bytes)
    $pins = @{}
    foreach ($field in @('acAdministratorBundleSha256', 'acAdministratorStagerSha256')) {
        $matches = [regex]::Matches($source, ('(?m)^\$script:' + $field + " = '([a-f0-9]{64})'\r?$"))
        if ($matches.Count -ne 1) { throw 'payload_integrity_unverified' }
        $pins[$field] = $matches[0].Groups[1].Value
    }
    $expected = @{ Archive=$pins.acAdministratorBundleSha256; Stager=$pins.acAdministratorStagerSha256 }
    foreach ($key in @('Archive', 'Stager')) {
        $name = [IO.Path]::GetFileName($paths[$key])
        $rows = @(Get-Content -LiteralPath $adjacent.Sums | Where-Object {
            $_ -cmatch ('^[a-f0-9]{64}  ' + [regex]::Escape($name) + '$') })
        if ($rows.Count -ne 1 -or $rows[0] -cne ($expected[$key] + '  ' + $name)) { throw 'payload_integrity_unverified' }
        if ((Get-FileHash -LiteralPath $paths[$key] -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expected[$key]) {
            throw 'payload_digest_mismatch'
        }
    }
    # Explicit original paths avoid copying the runtime ZIP. The helper/stager
    # retain their own immutable digest checks before any installation action.
    return @{ Archive=$paths.Archive; ExpectedSha256=$expected.Archive;
        Stager=$paths.Stager; ExpectedStagerSha256=$expected.Stager }
}

function Expand-VerifiedSetupArchive([string]$Archive, [string]$Sums, [string]$Destination) {
    if (-not (Assert-FileDigest $Archive $Sums 'agent-continue-setup.zip')) { throw 'payload_integrity_unverified' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        if ($zip.Entries.Count -lt 1 -or $zip.Entries.Count -gt 4000) { throw 'payload_incomplete' }
        $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        $total = 0L
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName
            $kind = ($entry.ExternalAttributes -shr 16) -band 0xF000
            if ($name -cnotmatch '\A[A-Za-z0-9@_.+/-]+\z' -or $name.Length -ge 248 -or
                $name -match '\.(exe|msi|zip)$' -or -not $seen.Add($name) -or
                ($entry.ExternalAttributes -band 0x410) -or $kind -notin @(0, 0x8000) -or
                $entry.Length -gt 4MB) { throw 'payload_path_invalid' }
            foreach ($part in $name.Split('/')) {
                if (-not $part -or $part -cin @('.', '..') -or $part.EndsWith('.') -or
                    $part -match '^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)') { throw 'payload_path_invalid' }
            }
            $total += $entry.Length
            if ($total -gt 64MB) { throw 'payload_incomplete' }
        }
        if (-not $seen.Contains('bin.mjs')) { throw 'payload_incomplete' }
    } finally { $zip.Dispose() }
    Expand-Archive -LiteralPath $Archive -DestinationPath $Destination
    if (-not [IO.File]::Exists((Join-Path $Destination 'bin.mjs'))) { throw 'payload_incomplete' }
    Copy-Item -LiteralPath $Sums -Destination (Join-Path $Destination 'SHA256SUMS.txt') -Force
}

function Test-ExistingBrowserInstall([string]$Root) {
    try { $null = [IO.File]::GetAttributes($Root); return $true }
    catch {
        $cause = $_.Exception.GetBaseException()
        if ($cause -is [IO.FileNotFoundException] -or $cause -is [IO.DirectoryNotFoundException]) { return $false }
        # Denied/unknown is not absence and must never fall through to installation.
        return $true
    }
}

function Assert-BrowserWakeInstallPath([string]$Root) {
    try { $app = [IO.Path]::Combine($Root,'app') }
    catch { throw 'browser_wake_invalid_install' }
    # The path is JSON data, not a literal embedded in the ASCII CMD launcher.
    if ($app -cnotmatch '\A[A-Za-z]:\\[^\x00-\x1f\x7f-\x9f]+\z' -or $app.Substring(2) -match '[:"%!^&|<>()/?*]' -or
        @($app.Substring(3).Split('\') | Where-Object { -not $_ -or $_ -match '[. ]$' -or
            $_ -match '\A(CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)' }).Count) {
        throw 'browser_wake_invalid_install'
    }
    try { $null = [Text.UTF8Encoding]::new($false,$true).GetByteCount($app) }
    catch { throw 'browser_wake_invalid_install' }
    if (-not [string]::Equals([IO.Path]::GetFullPath($app),$app,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'browser_wake_invalid_install'
    }
}

function Assert-ExistingBrowserResult($Value,[string]$Extension,[string]$ManifestPin) {
    $keys = @('ok','action','mode','status','reason','extensionId','payloadManifestSha256','configuration',
        'registration','runtime','mutationPerformed','chatAuthorizationVerified','next','devicesUrl')
    if ($Value -isnot [pscustomobject] -or @($Value.PSObject.Properties).Count -ne $keys.Count) { throw 'existing_result_invalid' }
    foreach ($key in $keys) { if ($key -cnotin @($Value.PSObject.Properties.Name)) { throw 'existing_result_invalid' } }
    foreach ($key in @('action','mode','status','reason','extensionId','configuration','registration','runtime','next')) {
        if ($Value.$key -isnot [string]) { throw 'existing_result_invalid' }
    }
    if ($Value.ok -isnot [bool] -or $Value.extensionId -cne $Extension -or $Value.action -cne 'existing-install' -or
        $Value.mode -cne 'browser-managed' -or $Value.runtime -cne 'not-observed' -or
        $Value.mutationPerformed -isnot [bool] -or $Value.mutationPerformed -or
        $Value.chatAuthorizationVerified -isnot [bool] -or $Value.chatAuthorizationVerified -or
        $Value.reason -isnot [string] -or $Value.reason -cnotmatch '\A[a-z][a-z-]{0,63}\z') { throw 'existing_result_invalid' }
    if ($Value.ok) {
        if ($Value.payloadManifestSha256 -isnot [string] -or $Value.devicesUrl -isnot [string] -or
            $Value.status -cne 'existing-matched' -or $Value.configuration -cne 'verified' -or
            $Value.registration -cne 'matched' -or $Value.payloadManifestSha256 -cne $ManifestPin -or
            $ManifestPin -cnotmatch '\A[a-f0-9]{64}\z' -or $Value.next -cne 'open-devices' -or
            $Value.devicesUrl -cne ('chrome-extension://'+$Extension+'/devices.html?mode=browser-managed')) { throw 'existing_result_invalid' }
    } elseif ($Value.status -cnotin @('existing-incompatible','existing-partial','existing-denied','existing-unconfirmed') -or
        $Value.configuration -cne 'unconfirmed' -or $Value.registration -cne 'unconfirmed' -or
        $null -ne $Value.payloadManifestSha256 -or $null -ne $Value.devicesUrl -or
        $Value.next -cne 'review-existing-installation') { throw 'existing_result_invalid' }
}

function Invoke-ExistingBrowserInstallation([string]$Root,[string]$Extension,[string]$SourceRoot) {
    $unknown = @{ok=$false;action='existing-install';mode='browser-managed';status='existing-unconfirmed';reason='inspection-unavailable';
        extensionId=$Extension;payloadManifestSha256=$null;configuration='unconfirmed';registration='unconfirmed';runtime='not-observed';
        mutationPerformed=$false;chatAuthorizationVerified=$false;next='review-existing-installation';devicesUrl=$null}
    try {
        # A public release contains an adjacent ZIP, not an extracted entry point.
        # Inspect from its verified local snapshot; never fetch or provision here.
        if (-not $SourceRoot) { return $unknown }
        $adjacent = Get-AdjacentSetupArchive $SourceRoot
        if ($null -ne $adjacent) {
            $script:acTemp = Join-Path ([IO.Path]::GetTempPath()) ('agent-continue-' + [guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $script:acTemp -ErrorAction Stop | Out-Null
            $archive = Join-Path $script:acTemp 'agent-continue-setup.zip'
            $sums = Join-Path $script:acTemp 'SHA256SUMS.txt'
            Copy-Item -LiteralPath $adjacent.Archive -Destination $archive
            Copy-Item -LiteralPath $adjacent.Sums -Destination $sums
            $SourceRoot = Join-Path $script:acTemp 'payload'
            Expand-VerifiedSetupArchive $archive $sums $SourceRoot
        }
        $entry = Get-Item -LiteralPath (Join-Path $SourceRoot 'bin.mjs') -Force -ErrorAction Stop
        if ($entry -isnot [IO.FileInfo]) { return $unknown }
        for ($parent=$entry; $null -ne $parent; $parent=$(if ($parent -is [IO.FileInfo]) { $parent.Directory } else { $parent.Parent })) {
            if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { return $unknown }
        }
        $script:acPayloadRoot = $SourceRoot
        if ((Assert-Payload) -lt 1) { return $unknown }
        $manifest = Join-Path $SourceRoot 'payload-manifest.json'
        $manifestPin = (Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash.ToLowerInvariant()
        try { $script:acNode = (Resolve-Node).Path }
        catch {
            if ($NodePath -or $_.Exception.Message -cnotin @('node_not_found','node_version_too_old','node_version_unreadable')) { throw }
            $script:acArch = Get-Arch
            $script:acNode = Install-PortableNode -ReuseOnly
        }
        $raw = Invoke-Bootstrap @('browser-install-status','--install-dir',$Root,'--extension-id',$Extension)
        if ($raw.Length -gt 4096) { return $unknown }
        $value = ConvertFrom-Json -InputObject $raw
        Assert-ExistingBrowserResult $value $Extension $manifestPin
        if ((Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifestPin -or
            (Assert-Payload) -lt 1) { return $unknown }
        $result = @{}
        foreach ($property in $value.PSObject.Properties) { $result[$property.Name] = $property.Value }
        return $result
    } catch {
        if ($_.Exception.GetBaseException() -is [UnauthorizedAccessException]) { $unknown.status='existing-denied' }
        return $unknown
    }
}

try {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'

    trap {
        if ($_.Exception -is [System.Management.Automation.PipelineStoppedException]) {
            if ($PromptForConnection) { exit 1 }
            exit 0
        }
        [Console]::Error.WriteLine('agent_continue_install_failed: ' + (Get-InstallFailureCode $_.Exception.Message))
        exit 1
    }

    # Reject bypass before guided input, Node execution or payload acquisition.
    if ($AllowUnverifiedPayload -and -not (Test-UnverifiedPayloadInspection)) { throw 'payload_integrity_unverified' }
    if ($PSBoundParameters.ContainsKey('ExpectedSumsSha256') -and
        ($ExpectedSumsSha256 -cnotmatch '\A[a-f0-9]{64}\z' -or
         $script:acReleaseTag -cnotmatch '\Av(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\z' -or
         $PayloadBase -or $env:AGENT_CONTINUE_PAYLOAD_BASE -or $AllowUnverifiedPayload -or
         -not $PromptForConnection -or (-not $Administrator -and (-not $InstallLocal -or -not $BrowserManaged)))) {
        throw 'payload_integrity_unverified'
    }

    if ($PSBoundParameters.ContainsKey('BrowserSetupId')) {
        Assert-BrowserSetupContinuationInput -Id $BrowserSetupId -Administrator ([bool]$Administrator) -Apply ([bool]$Apply) `
            -InstallLocal ([bool]$InstallLocal) -BrowserManaged ([bool]$BrowserManaged) `
            -PromptForConnection ([bool]$PromptForConnection) -Consent $Consent
    }
    if ($Administrator) {
        if (-not $Apply -or $Consent -cne 'accept-administrator-browser-installation') { throw 'consent_required' }
        if ($InstallLocal -or $BrowserManaged -or $InstallDir -or $Arch -or $SetupRequest -or $NodePath -or
            $DeviceAction -or $OperationId -or $ManagerOnly -or $PrepareNative -or $RegisterNative -or
            $Verify -or $Uninstall -or $AllowUnverifiedPayload) { throw 'invalid_manager_arguments' }
        if ($ExtensionId -cnotmatch '\A[a-p]{32}\z') { throw 'invalid_extension_id' }
        if ($PromptForConnection -and ($TunnelId -or $RuntimeKeyFile)) { throw 'invalid_manager_arguments' }
    } else {
    if ($BrowserManaged -and (-not $InstallLocal -or $DeviceAction)) { throw 'invalid_manager_arguments' }
    if ($PromptForConnection -and (-not $InstallLocal -or $Apply -or $SetupRequest -or $TunnelId -or $RuntimeKeyFile -or
        $Verify -or $Uninstall -or $ManagerOnly -or $PrepareNative -or $RegisterNative -or $DeviceAction -or $OperationId -or
        $PayloadBase -or $AllowUnverifiedPayload)) { throw 'invalid_manager_arguments' }
    if ($InstallLocal) {
        if ($Consent -cne 'accept-install') { throw 'consent_required' }
        if ($Verify -or $Uninstall -or $ManagerOnly -or $PrepareNative -or $RegisterNative) { throw 'invalid_manager_arguments' }
        if ($BrowserManaged) {
            if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'AgentContinue' }
            if ($InstallDir -cnotmatch '\A[A-Za-z]:\\[^\\]' -or -not [IO.Path]::IsPathRooted($InstallDir)) { throw 'invalid_install_root' }
            $script:acExistingBrowserInstall = Test-ExistingBrowserInstall $InstallDir
            if (-not $script:acExistingBrowserInstall) { Assert-BrowserWakeInstallPath $InstallDir }
        }
        if ($PromptForConnection) {
            if ($env:OS -ne 'Windows_NT') { throw 'unsupported_os' }
            if ($ExtensionId -cnotmatch '\A[a-p]{32}\z') { throw 'invalid_extension_id' }
            if (-not $script:acExistingBrowserInstall) {
            if ($Host.Name -cne 'ConsoleHost' -or [Console]::IsInputRedirected) { throw 'interactive_terminal_required' }
            Initialize-InstallerModules
            if (-not (Get-AdjacentSetupArchive) -and
                -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'bin.mjs') -PathType Leaf) -and
                -not ($script:acReleaseTag -and $ExpectedSumsSha256)) { throw 'payload_incomplete' }
            if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'AgentContinue' }
            if ($InstallDir -cnotmatch '\A[A-Za-z]:\\[^\\]' -or -not [IO.Path]::IsPathRooted($InstallDir)) { throw 'invalid_install_root' }
            if (Test-Path -LiteralPath $InstallDir) { throw 'destination_exists' }
            Write-Host "Chrome extension ID: $ExtensionId"
            Write-Host 'Check that this ID matches the Agent Continue setup page before continuing.'
            $TunnelId = Read-GuidedValue 'OpenAI tunnel ID (blank cancels)'
            if ($TunnelId -cnotmatch '\Atunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}\z') { throw 'setup_input_invalid' }
            $RuntimeKeyFile = Resolve-GuidedFile (Read-GuidedValue 'Absolute runtime-key FILE PATH, not the key itself (masked; blank cancels)' -Mask) 65536
            if (-not $NodePath) {
                Write-Host 'Setup reuses compatible Node.js. If none is found, it downloads and verifies the official portable Node ZIP for this user.'
                Write-Host 'No EXE/MSI installer, administrator access, or system PATH changes are needed.'
            }
            if ($BrowserManaged) {
                $answer = Read-GuidedValue 'Type REGISTER to install under this account and register browser-managed startup; Enter cancels'
                if ($answer -cne 'REGISTER') { throw 'setup_cancelled' }
            } else {
                $answer = Read-GuidedValue 'Type CONNECT to install under this account and request one tunnel connection; Enter cancels'
                if ($answer -cne 'CONNECT') { throw 'setup_cancelled' }
            }
            }
        }
        if (-not $script:acExistingBrowserInstall) {
        if ($BrowserManaged -and (-not $TunnelId -or -not $RuntimeKeyFile)) { throw 'install_argument_missing' }
        if ([bool]$TunnelId -ne [bool]$RuntimeKeyFile) { throw 'install_argument_missing' }
        if ($RuntimeKeyFile -and -not (Test-Path -LiteralPath $RuntimeKeyFile -PathType Leaf)) { throw 'install_file_missing' }
        if ($TunnelId -and $TunnelId -cnotmatch '\Atunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}\z') { throw 'setup_input_invalid' }
        }
        if (-not $PromptForConnection) {
            if (-not $SetupRequest -or -not (Test-Path -LiteralPath $SetupRequest -PathType Leaf)) { throw 'install_file_missing' }
            $requestInfo = Get-Item -LiteralPath $SetupRequest -Force
            if ($requestInfo.Length -gt 16384 -or ($requestInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'setup_request_invalid' }
            Initialize-InstallerModules
            try { $request = Get-Content -LiteralPath $SetupRequest -Raw | ConvertFrom-Json; $requestedId = $request.extensionId }
            catch { throw 'setup_request_invalid' }
            if ($request.format -cne 'agent-continue-device-setup' -or $request.version -ne 1 -or
                $request.target -cne 'windows' -or $request.nativeHost -cne 'com.agentcontinue.device_control' -or
                @($request.PSObject.Properties).Count -ne 5) { throw 'setup_request_invalid' }
            if ($requestedId -isnot [string] -or $requestedId -cnotmatch '\A[a-p]{32}\z') { throw 'invalid_extension_id' }
            if ($ExtensionId -and $ExtensionId -cne $requestedId) { throw 'setup_identity_mismatch' }
            $ExtensionId = $requestedId
        }
        $Apply = $true
    }
    }

    Initialize-InstallerModules

    function Write-Result([hashtable]$Value) { [Console]::Out.WriteLine(($Value | ConvertTo-Json -Compress -Depth 8)) }

    function Resolve-Node {
        if ($NodePath) {
            $command = Get-Command $NodePath -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
            if (-not $command) { throw 'node_not_found' }
            return @{ Path = $command.Source; Version = (Get-NodeVersion $command.Source) }
        }
        $names = @('node.exe', 'node')
        $commands = @(Get-Command $names -CommandType Application -All -ErrorAction SilentlyContinue)
        if (-not $commands) {
            # A previous installer may have changed PATH after this shell started.
            $original = $env:PATH
            try {
                $machine = [Environment]::GetEnvironmentVariable('PATH', 'Machine')
                $user = [Environment]::GetEnvironmentVariable('PATH', 'User')
                $env:PATH = (@($machine, $user) | Where-Object { $_ }) -join ';'
                $commands = @(Get-Command $names -CommandType Application -All -ErrorAction SilentlyContinue)
            } finally { $env:PATH = $original }
        }
        $failure = 'node_not_found'
        foreach ($executable in ($commands | Select-Object -ExpandProperty Source -Unique)) {
            try { return @{ Path = $executable; Version = (Get-NodeVersion $executable) } }
            catch {
                if ($_.Exception.Message -cnotin @('node_version_unreadable', 'node_version_too_old')) { throw }
                $failure = $_.Exception.Message
            }
        }
        throw $failure
    }

    function Get-NodeVersion([string]$Executable) {
        try {
            $raw = (& $Executable '--version' 2>$null) | Select-Object -First 1
            if ($LASTEXITCODE -ne 0) { throw 'node_version_unreadable' }
        } catch [System.Management.Automation.PipelineStoppedException] { throw }
          catch { throw 'node_version_unreadable' }
        if ("$raw" -notmatch '^v?(\d+)\.(\d+)\.(\d+)$') { throw 'node_version_unreadable' }
        $major = [int]$Matches[1]; $minor = [int]$Matches[2]
        if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 13)) { throw 'node_version_too_old' }
        return "$major.$minor.$($Matches[3])"
    }

    function Install-PortableNode([switch]$ReuseOnly) {
        if (-not $ReuseOnly -and (-not $InstallLocal -or $Consent -ne 'accept-install' -or $NodePath)) { throw 'node_not_found' }
        $pins = @{
            'x64' = @('x64', 'cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20', 'dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f')
            'arm64' = @('arm64', 'a8b8cd79cbbb3062435f449591d98dd63730bbbf30ce2d7cc3a6376c236cb111', '64d9f6e69b4703870e8cd30a3477127df8b683ea04feb03660e439396549042a')
            'ia32' = @('x86', '7d6c4dce2ecccca46e3c4b3e43c8bebbd1969bd616fdb4fda1e8269171d9ccea', 'aa39a7741f62832ea50daba0113c8f8b12ccde226abca931326832d5bc47d31f')
        }
        if (-not $pins.ContainsKey($script:acArch) -or -not $env:LOCALAPPDATA) { throw 'unsupported_architecture' }
        $pin = $pins[$script:acArch]
        $stem = 'node-v22.23.4-win-' + $pin[0]
        $parent = Join-Path $env:LOCALAPPDATA 'AgentContinueToolchain'
        $destination = Join-Path $parent $stem
        $archive = Join-Path $parent ($stem + '.zip')
        if ($ReuseOnly -and (-not (Test-Path -LiteralPath $destination) -or -not (Test-Path -LiteralPath $archive))) { throw 'node_not_found' }
        for ($directory = [IO.DirectoryInfo]::new($parent); $null -ne $directory; $directory = $directory.Parent) {
            try { $item = Get-Item -LiteralPath $directory.FullName -Force }
            catch [System.Management.Automation.ItemNotFoundException] { continue }
            if ($item -isnot [IO.DirectoryInfo] -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'invalid_install_root' }
        }
        if (-not $ReuseOnly) { $null = [IO.Directory]::CreateDirectory($parent) }
        if (-not (Test-Path -LiteralPath $archive)) {
            if ($ReuseOnly) { throw 'node_not_found' }
            $stage = Join-Path $parent ([Guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $stage | Out-Null
            $download = Join-Path $stage 'node.zip'
            try {
                [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                try {
                    Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 -Uri ('https://nodejs.org/dist/v22.23.4/' + $stem + '.zip') -OutFile $download
                } catch { throw 'node_download_failed' }
                if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant() -cne $pin[1]) { throw 'node_archive_digest_mismatch' }
                [IO.File]::Move($download, $archive)
            } finally {
                [IO.File]::Delete($download)
                [IO.Directory]::Delete($stage)
            }
        }
        $archiveInfo = Get-Item -LiteralPath $archive -Force
        if ($archiveInfo -isnot [IO.FileInfo] -or ($archiveInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'node_archive_invalid' }
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -cne $pin[1]) { throw 'node_archive_digest_mismatch' }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [IO.Compression.ZipFile]::OpenRead($archive)
        try {
            foreach ($entry in $zip.Entries) {
                if (-not $entry.FullName.StartsWith($stem + '/', [StringComparison]::Ordinal) -or
                    $entry.FullName.Contains('\') -or $entry.FullName.Contains(':') -or
                    @($entry.FullName.Split('/') | Where-Object { $_ -eq '..' -or $_ -eq '.' }).Count -gt 0) { throw 'node_archive_invalid' }
            }
            if (Test-Path -LiteralPath $destination) {
                $directories = New-Object 'System.Collections.Generic.Stack[string]'
                $directories.Push($destination)
                $count = 0
                while ($directories.Count) {
                    $directory = $directories.Pop()
                    $info = Get-Item -LiteralPath $directory -Force
                    if ($info -isnot [IO.DirectoryInfo] -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'node_provision_existing_invalid' }
                    foreach ($item in Get-ChildItem -LiteralPath $directory -Force) {
                        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'node_provision_existing_invalid' }
                        if ($item -is [IO.DirectoryInfo]) { $directories.Push($item.FullName) } else { $count++ }
                    }
                }
                $expectedCount = 0
                foreach ($entry in $zip.Entries) {
                    if ($entry.FullName.EndsWith('/')) { continue }
                    $expectedCount++
                    $relative = $entry.FullName.Substring($stem.Length + 1)
                    $file = Join-Path $destination $relative
                    $info = Get-Item -LiteralPath $file -Force
                    if ($info -isnot [IO.FileInfo] -or $info.Length -ne $entry.Length) { throw 'node_provision_existing_invalid' }
                    $hash = [Security.Cryptography.SHA256]::Create()
                    $stream = $entry.Open()
                    try { $expected = [BitConverter]::ToString($hash.ComputeHash($stream)) } finally { $stream.Dispose(); $hash.Dispose() }
                    $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
                    if ($actual -cne $expected.Replace('-', '')) { throw 'node_provision_existing_invalid' }
                }
                if ($count -ne $expectedCount) { throw 'node_provision_existing_invalid' }
                $existing = Join-Path $destination 'node.exe'
                if ((Get-NodeVersion $existing) -cne '22.23.4') { throw 'node_provision_existing_invalid' }
                return $existing
            }
        } finally { $zip.Dispose() }
        if ($ReuseOnly) { throw 'node_not_found' }
        $stage = Join-Path $parent ([Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $stage | Out-Null
        [IO.Compression.ZipFile]::ExtractToDirectory($archive, $stage)
        $extracted = Join-Path $stage $stem
        $executable = Join-Path $extracted 'node.exe'
        if ((Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant() -cne $pin[2]) { throw 'node_provision_invalid' }
        $version = Get-NodeVersion $executable
        if ($version -cne '22.23.4' -or -not (Test-Path -LiteralPath (Join-Path $extracted 'node_modules\npm\bin\npm-cli.js') -PathType Leaf)) { throw 'node_provision_invalid' }
        [IO.Directory]::Move($extracted, $destination)
        Remove-Item -LiteralPath $stage
        return (Join-Path $destination 'node.exe')
    }

    function Get-Arch {
        $actual = $env:PROCESSOR_ARCHITEW6432
        if (-not $actual) { $actual = $env:PROCESSOR_ARCHITECTURE }
        $map = @{ 'AMD64' = 'x64'; 'ARM64' = 'arm64'; 'x86' = 'ia32' }
        if (-not $map.ContainsKey("$actual")) { throw 'unsupported_architecture' }
        $detected = $map["$actual"]
        if (-not $Arch) { return $detected }
        if ($Arch -eq 'x64' -and $detected -eq 'ia32') { throw 'architecture_mismatch' }
        if ($Arch -ne $detected -and $Arch -ne 'ia32') { throw 'architecture_mismatch' }
        return $Arch
    }

    function Resolve-Payload {
        # `irm ... | iex` leaves $PSScriptRoot empty, so treat that as "not local".
        $local = if ([string]::IsNullOrEmpty($PSScriptRoot)) { '' } else { Join-Path $PSScriptRoot 'bin.mjs' }
        if ($Uninstall) {
            if (-not $local -or -not (Test-Path -LiteralPath $local -PathType Leaf)) { throw 'uninstall_inspection_unavailable' }
            $entry = Get-Item -LiteralPath $local -Force
            if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'uninstall_inspection_unavailable' }
            return $PSScriptRoot
        }
        $adjacent = Get-AdjacentSetupArchive
        if ($null -ne $adjacent) {
            $script:acTemp = Join-Path ([IO.Path]::GetTempPath()) ('agent-continue-' + [guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $script:acTemp -ErrorAction Stop | Out-Null
            $archive = Join-Path $script:acTemp 'agent-continue-setup.zip'
            $sums = Join-Path $script:acTemp 'SHA256SUMS.txt'
            Copy-Item -LiteralPath $adjacent.Archive -Destination $archive
            Copy-Item -LiteralPath $adjacent.Sums -Destination $sums
            Assert-SetupChecksumList $sums
            $expanded = Join-Path $script:acTemp 'payload'
            Expand-VerifiedSetupArchive $archive $sums $expanded
            return $expanded
        }
        if ($local -and (Test-Path -LiteralPath $local)) {
            Assert-SetupChecksumList (Join-Path $PSScriptRoot 'SHA256SUMS.txt')
            return $PSScriptRoot
        }
        # The remote one-liner only downloaded this script. Fetch the payload,
        # pin it to SHA256SUMS.txt, and let `finally` delete the temp directory.
        $archiveName = 'agent-continue-setup.zip'
        $script:acRemote = $true
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $script:acTemp = Join-Path ([IO.Path]::GetTempPath()) ('agent-continue-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:acTemp -Force | Out-Null
        $archive = Join-Path $script:acTemp $archiveName
        $sums = Join-Path $script:acTemp 'SHA256SUMS.txt'
        Invoke-WebRequest -UseBasicParsing -Uri ($PayloadBase + '/' + $archiveName) -OutFile $archive
        Invoke-WebRequest -UseBasicParsing -Uri ($PayloadBase + '/SHA256SUMS.txt') -OutFile $sums
        Assert-SetupChecksumList $sums
        if (-not (Assert-FileDigest $archive $sums $archiveName)) {
            throw 'payload_integrity_unverified'
        }
        $expanded = Join-Path $script:acTemp 'payload'
        Expand-VerifiedSetupArchive $archive $sums $expanded
        return $expanded
    }

    function Get-AdministratorInstallerCommand([string]$File,[string]$Digest,[hashtable]$Arguments) {
        if ($Digest -cnotmatch '\A[a-f0-9]{64}\z') { throw 'administrator_installer_hash' }
        $inputStream = [IO.File]::Open($File,'Open','Read','Read')
        $sha = $snapshot = $compressed = $gzip = $null
        try {
            if ($inputStream.Length -lt 1 -or $inputStream.Length -gt 64KB) { throw 'administrator_installer_size' }
            $snapshot = [IO.MemoryStream]::new()
            $inputStream.CopyTo($snapshot)
            $bytes = $snapshot.ToArray()
            $sha = [Security.Cryptography.SHA256]::Create()
            if ([BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant() -cne $Digest) {
                throw 'administrator_installer_hash'
            }
            # Compress the checked bytes, not a pathname. This fits the Windows
            # command limit without reopening writable code in the child.
            $compressed = [IO.MemoryStream]::new()
            $gzip = [IO.Compression.GZipStream]::new($compressed,[IO.Compression.CompressionMode]::Compress,$true)
            $gzip.Write($bytes,0,$bytes.Length)
            $gzip.Dispose(); $gzip = $null
            $source = [Convert]::ToBase64String($compressed.ToArray())
            $values = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Arguments -Compress)))
            $worker = @'
$ErrorActionPreference='Stop'
try {
    Import-Module ([IO.Path]::Combine($PSHOME,'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
    $data=[IO.MemoryStream]::new([Convert]::FromBase64String('__SOURCE__'),$false)
    $gzip=[IO.Compression.GZipStream]::new($data,[IO.Compression.CompressionMode]::Decompress)
    $reader=[IO.StreamReader]::new($gzip,[Text.UTF8Encoding]::new($false,$true))
    try {$source=$reader.ReadToEnd()}finally{$reader.Dispose();$data.Dispose()}
    $inputValues=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__VALUES__')))
    $parameters=@{}
    foreach($property in $inputValues.PSObject.Properties){$parameters[$property.Name]=$property.Value}
    & ([ScriptBlock]::Create($source)) @parameters
    exit 12
} catch {[Console]::Error.WriteLine('administrator_installer_snapshot_failed');exit 12}
'@
            $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($worker.Replace('__SOURCE__',$source).Replace('__VALUES__',$values)))
            if ($encoded.Length -gt 30000) { throw 'administrator_installer_size' }
            return $encoded
        } finally {
            if ($gzip) { $gzip.Dispose() }
            if ($compressed) { $compressed.Dispose() }
            if ($snapshot) { $snapshot.Dispose() }
            if ($sha) { $sha.Dispose() }
            $inputStream.Dispose()
        }
    }

    function Assert-Payload {
        if ($AllowUnverifiedPayload -and ($script:acReleaseTag -or -not (Test-UnverifiedPayloadInspection))) {
            throw 'payload_integrity_unverified'
        }
        $sums = Join-Path $script:acPayloadRoot 'SHA256SUMS.txt'
        if (-not (Test-Path -LiteralPath $sums)) {
            # Only explicit, unstamped local inspection may omit release digests.
            if (-not $AllowUnverifiedPayload -or $script:acRemote) {
                throw 'payload_integrity_unverified'
            }
            return 0
        }
        $checked = 0
        $entryChecked = $false
        foreach ($line in Get-Content -LiteralPath $sums) {
            if ($line -notmatch '^([a-f0-9]{64})\s+\*?(\S.*)$') { continue }
            $digest = $Matches[1]; $relative = $Matches[2].Trim()
            if ($relative -match '^\s*[/\\]' -or $relative -split '[\\/]' -contains '..') { throw 'payload_path_invalid' }
            if ($relative -match '\.zip$') { continue }
            $file = Join-Path $script:acPayloadRoot $relative
            if (-not (Test-Path -LiteralPath $file)) { throw 'payload_file_missing' }
            $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actual -ne $digest) { throw 'payload_digest_mismatch' }
            $entryFile = Join-Path $script:acPayloadRoot 'bin.mjs'
            if ([IO.Path]::GetFullPath($file) -ieq [IO.Path]::GetFullPath($entryFile)) {
                # Case-folded names may be distinct on a case-sensitive NTFS
                # directory. Cover the exact entry Node will execute as well.
                $entryDigest = (Get-FileHash -LiteralPath $entryFile -Algorithm SHA256).Hash.ToLowerInvariant()
                if ($entryDigest -ceq $digest) { $entryChecked = $true }
            }
            $checked++
        }
        if ($checked -eq 0) { throw 'payload_manifest_empty' }
        if (-not $entryChecked) { throw 'payload_incomplete' }
        return $checked
    }

    function Test-ExactJsonProperties($Value, [string[]]$Names) {
        if ($Value -isnot [pscustomobject]) { return $false }
        $properties = @($Value.PSObject.Properties)
        if ($properties.Count -ne $Names.Count) { return $false }
        foreach ($property in $properties) {
            if ($Names -cnotcontains $property.Name) { return $false }
        }
        return $true
    }

    function Assert-UninstallResult([string]$Output, [string]$Root, [bool]$DirectoryPresent, [bool]$Registered) {
        try {
            if ($Output.Length -gt 65536) { throw 'invalid' }
            $result = ConvertFrom-Json -InputObject $Output
            if (-not (Test-ExactJsonProperties $result @('ok', 'dryRun', 'plan')) -or
                $result.ok -isnot [bool] -or -not $result.ok -or $result.dryRun -isnot [bool] -or -not $result.dryRun) { throw 'invalid' }
            $plan = $result.plan
            if (-not (Test-ExactJsonProperties $plan @('format', 'version', 'os', 'installRoot', 'owned', 'keepData', 'paths', 'steps')) -or
                $plan.format -isnot [string] -or $plan.format -cne 'agent-continue-uninstall-plan' -or
                ($plan.version -isnot [int] -and $plan.version -isnot [long]) -or $plan.version -ne 1 -or
                $plan.os -isnot [string] -or $plan.os -cne 'windows' -or
                $plan.installRoot -isnot [string] -or $plan.installRoot -cne $Root -or
                $plan.owned -isnot [bool] -or $plan.owned -or
                $plan.keepData -isnot [bool] -or $plan.keepData) { throw 'invalid' }
            $expectedPaths = @{ manifest = $Root + '\native-host.json'; launcher = $Root + '\native-launcher.exe'
                host = $Root + '\app\device-native-host.mjs'; state = $Root + '\state' }
            if (-not (Test-ExactJsonProperties $plan.paths @($expectedPaths.Keys))) { throw 'invalid' }
            foreach ($name in $expectedPaths.Keys) {
                if ($plan.paths.$name -isnot [string] -or $plan.paths.$name -cne $expectedPaths[$name]) { throw 'invalid' }
            }
            $ids = @('disable-autostart', 'stop-runtime', 'unregister', 'remove-files')
            $actions = @('user-autostart-remove', 'process-stop-owned', 'registry-remove-current-user', 'write-files-remove')
            $registrationState = if ($Registered) { 'pending' } else { 'satisfied' }
            $directoryState = if ($DirectoryPresent) { 'pending' } else { 'satisfied' }
            $states = @('pending', 'pending', $registrationState, $directoryState)
            if ($plan.steps -isnot [array] -or $plan.steps.Count -ne 4) { throw 'invalid' }
            for ($i = 0; $i -lt 4; $i++) {
                $step = $plan.steps[$i]
                if (-not (Test-ExactJsonProperties $step @('id', 'title', 'action', 'state', 'detail')) -or
                    $step.id -isnot [string] -or $step.id -cne $ids[$i] -or
                    $step.action -isnot [string] -or $step.action -cne $actions[$i] -or
                    $step.state -isnot [string] -or $step.state -cne $states[$i] -or
                    $step.title -isnot [string] -or $step.title.Length -gt 4096 -or
                    $step.detail -isnot [string] -or $step.detail.Length -gt 4096) { throw 'invalid' }
            }
        } catch { throw 'uninstall_inspection_failed' }
    }

    function Invoke-Bootstrap([string[]]$Arguments) {
        $output = (& $script:acNode (Join-Path $script:acPayloadRoot 'bin.mjs') @Arguments) -join "`n"
        $bootstrapExit = $LASTEXITCODE
        if ($bootstrapExit -eq 1 -and $Arguments.Count -eq 5 -and $Arguments[0] -ceq 'browser-install-status' -and
            $Arguments[3] -ceq '--extension-id' -and $output.Length -le 4096) {
            try {
                $observation = ConvertFrom-Json -InputObject $output
                if ($observation.ok -is [bool] -and -not $observation.ok) { return $output }
            } catch { }
        }
        if ($bootstrapExit -eq 1 -and $Arguments[0] -cin @('start-manager', 'install-local')) {
            $operationFailure = ConvertFrom-ManagerOperationFailure $output
            if ($operationFailure) { Write-Result $operationFailure; exit 1 }
        }
        if ($bootstrapExit -ne 0) { throw (Get-BootstrapFailureCode $output $bootstrapExit) }
        if (-not $output) { throw 'bootstrap_no_output' }
        return $output
    }

    function Invoke-NativeRelease([bool]$Execute, [bool]$CheckNode) {
        $helper = Join-Path $script:acPayloadRoot 'Prepare-ReleaseNative.ps1'
        if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { throw 'native_release_unavailable' }
        $releaseRoot = Join-Path $script:acPayloadRoot 'packaged-native-release'
        $packagedRelease = @(Get-ChildItem -LiteralPath $script:acPayloadRoot -Force -ErrorAction Stop |
            Where-Object { $_.Name -ieq 'packaged-native-release' })
        if ($packagedRelease.Count -eq 0) {
            $releaseRoot = Join-Path $script:acPayloadRoot 'native-release'
        }
        $arguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', $helper,
            '-ReleaseRoot', $releaseRoot,
            '-PayloadRoot', $script:acPayloadRoot, '-InstallDir', $InstallDir,
            '-ExtensionId', $ExtensionId, '-Arch', $script:acArch)
        if ($CheckNode) { $arguments += @('-NodePath', $script:acNode) }
        if ($Execute) { $arguments += @('-Apply', '-Consent', $Consent) }
        $output = (& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" @arguments 2>$null) -join "`n"
        $helperExit = $LASTEXITCODE
        if ($helperExit -ne 0) { throw (Get-BootstrapFailureCode $output $helperExit) }
        try { $receipt = $output | ConvertFrom-Json } catch { throw 'native_release_preparation_failed' }
        $mode = if ($Execute) { 'prepared' } else { 'plan' }
        if ($receipt.ok -cne $true -or $receipt.mode -cne $mode -or $receipt.prepared -cne $Execute -or
            $receipt.registered -cne $false -or $receipt.activated -cne $false -or
            $receipt.nodeSha256 -cnotmatch '\A[a-f0-9]{64}\z' -or $receipt.nodeVersion -cne '22.23.4') {
            throw 'native_release_preparation_failed'
        }
        return $receipt
    }

    if ($env:OS -ne 'Windows_NT') { throw 'unsupported_os' }
    if ($InstallLocal -and $BrowserManaged -and $script:acExistingBrowserInstall) {
        $existing = Invoke-ExistingBrowserInstallation $InstallDir $ExtensionId $PSScriptRoot
        Write-Result $existing
        if (-not $existing.ok) { exit 1 }
        return
    }
    if (-not $PayloadBase) {
        $PayloadBase = Get-DefaultPayloadBase
    }
    # `irm ... | iex` cannot pass parameters; accept the documented env fallback.
    if (-not $ExtensionId -and $env:AGENT_CONTINUE_EXTENSION_ID) { $ExtensionId = $env:AGENT_CONTINUE_EXTENSION_ID }
    if ($Administrator) {
        # Reuse release acquisition/integrity checks, but the administrator ZIP
        # supplies its own pinned Node and never invokes the legacy launcher.
        $script:acPayloadRoot = Resolve-Payload
        $checked = Assert-Payload
        $administratorEntry = Join-Path $script:acPayloadRoot 'install-administrator.ps1'
        if (-not [IO.File]::Exists($administratorEntry)) { throw 'administrator_release_unavailable' }
        if ($checked -lt 1) { throw 'payload_integrity_unverified' }
        $parameters = @{Apply=$true;Consent='accept-administrator-browser-installation';ExtensionId=$ExtensionId;
            PayloadDirectory=$script:acPayloadRoot}
        $adjacentParameters = Get-AdjacentAdministratorParameters $administratorEntry
        foreach ($key in $adjacentParameters.Keys) { $parameters[$key] = $adjacentParameters[$key] }
        if ($PSBoundParameters.ContainsKey('BrowserSetupId')) { $parameters.BrowserSetupId = $BrowserSetupId }
        if ($PromptForConnection) { $parameters.PromptForConnection = $true }
        else { $parameters.TunnelId = $TunnelId; $parameters.RuntimeKeyFile = $RuntimeKeyFile }
        $command = Get-AdministratorInstallerCommand $administratorEntry $script:acAdministratorInstallerSha256 $parameters
        & (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::System)) 'WindowsPowerShell\v1.0\powershell.exe') '-NoLogo' '-NoProfile' '-EncodedCommand' $command
        if ($LASTEXITCODE -ne 0) { $script:acKeepTemp = $true }
        exit $LASTEXITCODE
    }
    if ($DeviceAction -or $OperationId) {
        if ($DeviceAction -cnotin @('status', 'installer-status', 'browser-installer-status', 'disconnect-and-pause', 'reconnect', 'start', 'browser', 'register-browser-wake') -or
            $Apply -or $InstallLocal -or $Verify -or $Uninstall -or $ManagerOnly -or $PrepareNative -or $RegisterNative -or
            $SetupRequest -or $TunnelId -or $RuntimeKeyFile -or
            ($DeviceAction -ceq 'browser-installer-status' -and $Consent) -or
            ($OperationId -and ($DeviceAction -cin @('start', 'installer-status', 'browser-installer-status', 'browser', 'register-browser-wake') -or $OperationId -cnotmatch '\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z'))) { throw 'invalid_manager_arguments' }
        if ($DeviceAction -ceq 'register-browser-wake') {
            if ($Consent -cne 'accept-browser-wake') { throw 'consent_required' }
            if ($ExtensionId -cnotmatch '\A[a-p]{32}\z') { throw 'invalid_extension_id' }
        } elseif ($DeviceAction -cnotin @('status', 'installer-status', 'browser-installer-status') -and $Consent -cne 'accept-control') { throw 'consent_required' }
        if (-not $PSScriptRoot) { throw 'device_control_payload_missing' }
        $entry = Get-Item -LiteralPath (Join-Path $PSScriptRoot 'bin.mjs') -Force -ErrorAction SilentlyContinue
        if ($entry -isnot [IO.FileInfo] -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'device_control_payload_missing'
        }
        if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'AgentContinue' }
        $script:acArch = Get-Arch
        $usingPortable = $false
        try {
            $script:acNode = (Resolve-Node).Path
        } catch {
            if ($NodePath -or $_.Exception.Message -cnotin @('node_not_found', 'node_version_too_old', 'node_version_unreadable')) { throw }
            $script:acNode = Install-PortableNode -ReuseOnly
            $usingPortable = $true
        }
        $script:acPayloadRoot = $PSScriptRoot
        $null = Assert-Payload
        $arguments = if ($DeviceAction -ceq 'start') {
            @('start-manager', '--install-dir', $InstallDir, '--consent', 'accept-install')
        } elseif ($DeviceAction -ceq 'installer-status') {
            @('manager-status', '--install-dir', $InstallDir)
        } elseif ($DeviceAction -ceq 'browser-installer-status') {
            @('browser-install-status', '--install-dir', $InstallDir)
        } elseif ($DeviceAction -ceq 'browser') {
            @('manager-browser', '--install-dir', $InstallDir, '--consent', $Consent)
        } elseif ($DeviceAction -ceq 'register-browser-wake') {
            @('register-browser-wake', '--install-dir', $InstallDir, '--extension-id', $ExtensionId, '--consent', $Consent)
        } else {
            @('manager-control', '--install-dir', $InstallDir, '--action', $DeviceAction)
        }
        if ($DeviceAction -cin @('disconnect-and-pause', 'reconnect')) { $arguments += @('--consent', $Consent) }
        if ($OperationId) { $arguments += @('--id', $OperationId) }
        if ($DeviceAction -ceq 'start' -and -not $NodePath -and -not $usingPortable) {
            $output = (& $script:acNode (Join-Path $script:acPayloadRoot 'bin.mjs') @arguments) -join "`n"
            $status = $LASTEXITCODE
            if (Test-ManagerProfileMismatch $output $status) {
                $portable = $null
                try { $portable = Install-PortableNode -ReuseOnly }
                catch { if ($_.Exception.Message -cne 'node_not_found') { throw } }
                if ($portable -and $portable -ine $script:acNode) {
                    & $portable (Join-Path $script:acPayloadRoot 'bin.mjs') @arguments
                    exit $LASTEXITCODE
                }
            }
            if ($output) { [Console]::Out.WriteLine($output) }
            exit $status
        }
        & $script:acNode (Join-Path $script:acPayloadRoot 'bin.mjs') @arguments
        exit $LASTEXITCODE
    }
    if (-not $Verify -and -not $Uninstall -and $ExtensionId -cnotmatch '\A[a-p]{32}\z') { throw 'invalid_extension_id' }
    if ($Uninstall -and ($Verify -or $Apply -or $ManagerOnly -or $PrepareNative -or $RegisterNative)) { throw 'invalid_manager_arguments' }
    if ($Uninstall) {
        # Inspect the already-extracted bundle before resolving target defaults
        # or launching Node. Missing inspection code never triggers acquisition.
        $script:acPayloadRoot = Resolve-Payload
        $checked = Assert-Payload
    }
    if ($RegisterNative -and -not $PrepareNative) { throw 'invalid_manager_arguments' }
    if ($PrepareNative -and -not $ManagerOnly) { throw 'invalid_manager_arguments' }
    if ($ManagerOnly -and (-not $Apply -or $Verify -or $Uninstall -or
        (-not $InstallLocal -and ($TunnelId -or $RuntimeKeyFile)))) { throw 'invalid_manager_arguments' }
    if ($Apply -and $Consent -ne 'accept-install') { throw 'consent_required' }
    if ($Apply -and -not $PromptForConnection) {
        if (-not $SetupRequest -or -not (Test-Path -LiteralPath $SetupRequest -PathType Leaf)) { throw 'install_file_missing' }
        $requestInfo = Get-Item -LiteralPath $SetupRequest -Force
        if ($requestInfo.Length -gt 16384 -or ($requestInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'setup_request_invalid' }
        try { $applyRequest = Get-Content -LiteralPath $SetupRequest -Raw | ConvertFrom-Json }
        catch { throw 'setup_request_invalid' }
        if ($applyRequest.format -cne 'agent-continue-device-setup' -or $applyRequest.version -ne 1 -or
            $applyRequest.target -cne 'windows' -or $applyRequest.nativeHost -cne 'com.agentcontinue.device_control' -or
            @($applyRequest.PSObject.Properties).Count -ne 5) { throw 'setup_request_invalid' }
        if ($applyRequest.extensionId -cne $ExtensionId) { throw 'setup_identity_mismatch' }
    }
    if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'AgentContinue' }
    if (-not [IO.Path]::IsPathRooted($InstallDir)) { throw 'invalid_install_root' }
    # Reject a repeated install before Node download or dependency acquisition.
    # Retain partial installations for explicit verification, never overwrite them.
    if ($Apply -and (Test-Path -LiteralPath $InstallDir)) { throw 'destination_exists' }
    $script:acArch = Get-Arch
    $script:acNativePlan = $null
    if ($InstallLocal -or $PrepareNative) {
        # Do not provision Node for an invalid command package or vendor release.
        $script:acPayloadRoot = Resolve-Payload
        $checked = Assert-Payload
    }
    if ($PrepareNative) {
        $script:acNativePlan = Invoke-NativeRelease $false $false
    }
    try {
        $resolvedNode = Resolve-Node
        $script:acNode = $resolvedNode.Path
        $script:acNodeVersion = $resolvedNode.Version
    } catch {
        if ((-not $InstallLocal -and -not $Verify -and -not $Uninstall) -or $NodePath -or $_.Exception.Message -cnotin @('node_not_found', 'node_version_too_old', 'node_version_unreadable')) { throw }
        $script:acNode = Install-PortableNode -ReuseOnly:($Verify -or $Uninstall)
        $script:acNodeVersion = Get-NodeVersion $script:acNode
    }
    if ($PrepareNative) {
        if ((Get-FileHash -LiteralPath $script:acNode -Algorithm SHA256).Hash.ToLowerInvariant() -cne $script:acNativePlan.nodeSha256) {
            throw 'native_release_node_mismatch'
        }
        if ($script:acNodeVersion -cne $script:acNativePlan.nodeVersion -or
            (Get-FileHash -LiteralPath $script:acNode -Algorithm SHA256).Hash.ToLowerInvariant() -cne $script:acNativePlan.nodeSha256) {
            throw 'native_release_node_mismatch'
        }
    }
    if (-not $script:acPayloadRoot) {
        $script:acPayloadRoot = Resolve-Payload
        $checked = Assert-Payload
    }

    if ($Uninstall) {
        $directoryPresent = Test-Path -LiteralPath $InstallDir
        # Status completeness is not directory absence. Autostart is not inspected
        # by this status command, so leave its removal as requiring review.
        $registered = $false; $autostart = $true
        try {
            $parsed = (Invoke-Bootstrap @('status', '--json', '--install-dir', $InstallDir)) | ConvertFrom-Json
            $statusNames = @($parsed.PSObject.Properties.Name)
            if ('format' -cnotin $statusNames -or 'installed' -cnotin $statusNames -or 'registered' -cnotin $statusNames -or
                $parsed.format -isnot [string] -or $parsed.format -cne 'agent-continue-registration-status' -or $parsed.installed -isnot [bool] -or
                $parsed.registered -isnot [string] -or $parsed.registered -cnotin @('registered', 'not-registered', 'unknown', 'drift', 'error')) { throw 'uninstall_inspection_failed' }
            $installationComplete = $parsed.installed
            $registrationObservation = $parsed.registered
            # Unknown registry state requires review, never a satisfied removal.
            $registered = $registrationObservation -cne 'not-registered'
        } catch { throw 'uninstall_inspection_failed' }
        $query = @('uninstall', '--os', 'windows', '--install-dir', $InstallDir,
            '--installed', "$directoryPresent".ToLowerInvariant(),
            '--registered', "$registered".ToLowerInvariant(),
            '--autostart', "$autostart".ToLowerInvariant())
        $removalOutput = Invoke-Bootstrap $query
        Assert-UninstallResult $removalOutput $InstallDir $directoryPresent $registered
        Write-Result @{ ok = $true; action = 'uninstall'; dryRun = $true; node = $script:acNodeVersion
            directoryPresent = [bool]$directoryPresent; installationComplete = [bool]$installationComplete
            autostartObservation = 'not-inspected'; registrationObservation = $registrationObservation
            inspectionComplete = $false
            payloadChecked = $checked; output = $removalOutput }
        return
    }

    if ($Verify) {
        Write-Result @{ ok = $true; action = 'verify'; node = $script:acNodeVersion; payloadChecked = $checked
            output = (Invoke-Bootstrap @('verify', '--json', '--install-dir', $InstallDir)) }
        return
    }

    if ($ExtensionId -cnotmatch '\A[a-p]{32}\z') { throw 'invalid_extension_id' }

    if ($Apply) {
        if ($Consent -ne 'accept-install') { throw 'consent_required' }
        if ($InstallLocal) {
            $arguments = @('install-local', '--install-dir', $InstallDir, '--consent', $Consent)
            if ($PromptForConnection) { $arguments += @('--guided-extension-id', $ExtensionId) }
            else { $arguments += @('--setup-request', $SetupRequest) }
            if ($TunnelId) { $arguments += @('--tunnel-id', $TunnelId, '--runtime-key-file', $RuntimeKeyFile) }
            if ($BrowserManaged) { $arguments += @('--browser-managed', 'true') }
            $output = Invoke-Bootstrap $arguments
            if ($BrowserManaged -and $PSBoundParameters.ContainsKey('BrowserSetupId')) {
                $null = Publish-CurrentAccountBrowserSetup $output
            }
            [Console]::Out.WriteLine($output)
            if ($PromptForConnection -and -not $BrowserManaged) {
                try {
                    $receipt = ConvertFrom-Json -InputObject $output
                    if ($receipt.ok -is [bool] -and $receipt.ok -and $receipt.connected -is [bool] -and $receipt.connected -and
                        $receipt.action -ceq 'install-local' -and $receipt.manager.operationStatus -ceq 'settled' -and
                        (Read-Host -Prompt 'Type PAIR to open extension controls; Enter keeps the connection without pairing') -ceq 'PAIR') {
                        & $script:acNode (Join-Path $script:acPayloadRoot 'bin.mjs') 'manager-browser' '--install-dir' $InstallDir '--consent' 'accept-control' '--expected-extension-id' $ExtensionId
                        if ($LASTEXITCODE -ne 0) { throw 'local_browser_unavailable' }
                    }
                } catch [System.Management.Automation.PipelineStoppedException] { }
                  catch { [Console]::Error.WriteLine('Local controls unavailable; use the preceding installation receipt.') }
                exit 0
            }
            return
        }
        if ($ManagerOnly) {
            if (-not $SetupRequest -or -not (Test-Path -LiteralPath $SetupRequest -PathType Leaf)) { throw 'install_file_missing' }
            $managerOutput = Invoke-Bootstrap @('setup-manager', '--install-dir', $InstallDir, '--consent', $Consent,
                '--setup-request', $SetupRequest)
            $managerReceipt = $managerOutput | ConvertFrom-Json
            if (-not $managerReceipt.ok -or $managerReceipt.extensionId -cne $ExtensionId) { throw 'setup_identity_mismatch' }
            $nativeReceipt = $null
            $registrationReceipt = $null
            $managerState = $null
            if ($PrepareNative) {
                $nativeReceipt = Invoke-NativeRelease $true $true
                if ($nativeReceipt.extensionId -cne $ExtensionId) { throw 'native_release_preparation_failed' }
                $script:acNode = Join-Path $InstallDir 'runtime\node.exe'
            }
            if ($RegisterNative) {
                $view = if ($script:acArch -eq 'ia32') { '32' } else { '64' }
                $registrationOutput = Invoke-Bootstrap @('register', '--os', 'windows', '--install-dir', $InstallDir,
                    '--extension-id', $ExtensionId, '--view', $view, '--execute', '--consent', $Consent)
                $registrationReceipt = $registrationOutput | ConvertFrom-Json
                if (-not $registrationReceipt.ok -or $registrationReceipt.mode -ne 'executed' -or
                    $registrationReceipt.status -notin @('written', 'already-present')) { throw 'native_registration_failed' }
            }
            Write-Result @{ ok = $true; action = 'setup-manager'; node = $script:acNodeVersion; payloadChecked = $checked
                output = $managerOutput; nativePreparation = $nativeReceipt; registration = $registrationReceipt
                registered = [bool]$RegisterNative; manager = $managerState; connected = [bool]($managerState -and $managerState.connected) }
            return
        }
        if (-not $SetupRequest -or -not $TunnelId -or -not $RuntimeKeyFile) { throw 'install_argument_missing' }
        foreach ($candidate in @($SetupRequest, $RuntimeKeyFile)) {
            if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw 'install_file_missing' }
        }
        $setupOutput = Invoke-Bootstrap @('setup', '--install-dir', $InstallDir, '--consent', $Consent,
            '--setup-request', $SetupRequest, '--tunnel-id', $TunnelId, '--runtime-key-file', $RuntimeKeyFile)
        $setupReceipt = $setupOutput | ConvertFrom-Json
        if (-not $setupReceipt.ok -or $setupReceipt.extensionId -cne $ExtensionId) { throw 'setup_identity_mismatch' }
        Write-Result @{ ok = $true; action = 'setup'; node = $script:acNodeVersion; payloadChecked = $checked
            output = $setupOutput }
        return
    }

    Write-Result @{ ok = $true; action = 'plan'; elevation = 'none'; node = $script:acNodeVersion
        payloadChecked = $checked; output = (Invoke-Bootstrap @('install-plan', '--os', 'windows', '--arch', $script:acArch,
            '--install-dir', $InstallDir, '--extension-id', $ExtensionId, '--node-version', $script:acNodeVersion)) }
}
finally {
    $env:PATH = $script:acPath
    [Net.ServicePointManager]::SecurityProtocol = $script:acTls
    if (-not $script:acKeepTemp -and $script:acTemp -and (Test-Path -LiteralPath $script:acTemp) -and
        $script:acTemp -ceq [IO.Path]::GetFullPath($script:acTemp) -and
        [IO.Path]::GetDirectoryName($script:acTemp) -ieq [IO.Path]::GetTempPath().TrimEnd('\') -and
        [IO.Path]::GetFileName($script:acTemp) -cmatch '\Aagent-continue-[a-f0-9]{32}\z' -and
        -not ([IO.File]::GetAttributes($script:acTemp) -band [IO.FileAttributes]::ReparsePoint)) {
        Remove-Item -LiteralPath $script:acTemp -Recurse -Force -ErrorAction SilentlyContinue
    }
}
