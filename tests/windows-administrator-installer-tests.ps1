[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
$entry = Join-Path $PSScriptRoot '../native/bootstrap/install-administrator.ps1'
if (-not [IO.File]::Exists($entry)) { throw 'single_command_administrator_entry_missing' }
$entry = [IO.Path]::GetFullPath($entry)
$parseErrors = $null
$tokens = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($entry,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'installer_parse' }
$required = @('Read-AdministratorInstallSource','New-AdministratorInstallWorker','Test-AdministratorInstallReceipt')
foreach ($name in $required) {
    $fn = $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$true) |
        Where-Object Name -CEQ $name
    if (@($fn).Count -ne 1) { throw ('missing_installer_boundary_' + $name) }
    . ([ScriptBlock]::Create($fn.Extent.Text))
}
$temp = Join-Path ([IO.Path]::GetTempPath()) ('ac-guided-source-test-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($temp) | Out-Null
try {
    $source = Join-Path $temp 'stager.ps1'
    [IO.File]::WriteAllText($source,'# deterministic source fixture',[Text.UTF8Encoding]::new($false))
    $digest = (Get-FileHash -LiteralPath $source).Hash.ToLowerInvariant()
    $read = Read-AdministratorInstallSource $source $digest
    if ($read -cne '# deterministic source fixture') { throw 'source_snapshot_mismatch' }
    try { $null = Read-AdministratorInstallSource $source ('f' * 64); throw 'accepted_changed_source' }
    catch { if ($_.Exception.Message -cne 'administrator_stager_hash') { throw } }
    [Console]::WriteLine('PASS checked source snapshot and altered-byte refusal')

    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $request = @{Archive='C:\bundle with space.zip';ExpectedSha256=('a' * 64);ExpectedStagerSha256=$digest;
        ExpectedUserSid=$sid;BrowserExtensionId=('b' * 32);HostedTunnelId=('tunnel_' + ('c' * 32));
        RuntimeKeyFile='C:\local key path.txt';OperationReceiptId=('d' * 32);InstallerSourcePath=$source}
    $worker = New-AdministratorInstallWorker $request
    $workerErrors = $null
    $null = [Management.Automation.Language.Parser]::ParseInput($worker,[ref]$tokens,[ref]$workerErrors)
    if ($workerErrors.Count -or $worker -notmatch 'ScriptBlock\]::Create\(\$source\)' -or
        $worker -notmatch 'InstallBrowserOwner' -or $worker -match 'ExecutionPolicy Bypass|Register-ScheduledTask|Stop-Process') {
        throw 'worker_not_verified_snapshot_only'
    }
    [Console]::WriteLine('PASS worker carries pinned inputs without interpolated command or runtime key')

    $receipt = [pscustomobject]@{version=1;operationId=('d' * 32);bundleSha256=('a' * 64);stagerSha256=$digest;
        result=[pscustomobject]@{ok=$true;phase='complete';protectedFilesVerified=$true;administratorStateVerified=$true;
            administratorChildVerified=$true;hostedBindingPrepared=$true;hostedLaunchPlanVerified=$true;
            hostedOwnerAuthorized=$true;browserEnrollmentCommitted=$true;readyToConnect=$true;
            registrationChanged=$true;tunnelStarted=$false;activated=$false}}
    if (-not (Test-AdministratorInstallReceipt $receipt $request)) { throw 'rejected_complete_installation_receipt' }
    foreach ($field in @('administratorChildVerified','hostedBindingPrepared','browserEnrollmentCommitted','readyToConnect')) {
        $receipt.result.$field = $false
        if (Test-AdministratorInstallReceipt $receipt $request) { throw ('accepted_unverified_' + $field) }
        $receipt.result.$field = $true
    }
    $receipt.operationId = 'e' * 32
    if (Test-AdministratorInstallReceipt $receipt $request) { throw 'accepted_another_operation' }
    $receipt.operationId = $request.OperationReceiptId
    $receipt.result.tunnelStarted = $true
    if (Test-AdministratorInstallReceipt $receipt $request) { throw 'installer_claimed_tunnel_connection' }
    [Console]::WriteLine('PASS exact receipt matching and partial-result rejection')
} finally {
    if ([IO.Path]::GetDirectoryName($temp) -ine [IO.Path]::GetTempPath().TrimEnd('\') -or
        [IO.Path]::GetFileName($temp) -cnotmatch '\Aac-guided-source-test-[a-f0-9]{32}\z') { throw 'cleanup_target' }
    Remove-Item -LiteralPath $temp -Recurse -Force
}
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$output = & $ps -NoLogo -NoProfile -NonInteractive -File $entry
if ($LASTEXITCODE -ne 0) { throw 'default_plan_failed' }
$plan = ($output -join [char]10) | ConvertFrom-Json
if (-not $plan.ok -or -not $plan.dryRun -or $plan.uacRequested -or $plan.tunnelStarted -or
    @($plan.steps).Count -ne 6) { throw 'plan_has_side_effects' }
$output = & $ps -NoLogo -NoProfile -NonInteractive -File $entry -Apply
if ($LASTEXITCODE -ne 1 -or ($output | ConvertFrom-Json).status -cne 'consent-required') { throw 'apply_without_consent' }
[Console]::WriteLine('PASS default plan and consent-before-elevation gate')

$publicEntry = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../native/bootstrap/install.ps1'))
$previousErrorPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try { $output = & $ps -NoLogo -NoProfile -NonInteractive -File $publicEntry -Administrator -Apply 2>&1 }
finally { $ErrorActionPreference = $previousErrorPreference }
if ($LASTEXITCODE -ne 1 -or ($output -join [char]10) -notmatch 'consent_required') { throw 'public_admin_dispatch_missing_consent_gate' }
$publicAst = [Management.Automation.Language.Parser]::ParseFile($publicEntry,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'public_entry_parse' }
$text = [IO.File]::ReadAllText($publicEntry)
if ($text.IndexOf("'install-administrator.ps1'") -lt 0 -or $text -notmatch '\$Administrator') { throw 'public_admin_dispatch_missing' }
[Console]::WriteLine('PASS public command delegates administrator setup without changing the standard default')
$boundary = $publicAst.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$true) |
    Where-Object Name -CEQ 'Get-AdministratorInstallerCommand'
if (@($boundary).Count -ne 1) { throw 'public_admin_snapshot_boundary_missing' }
. ([ScriptBlock]::Create($boundary.Extent.Text))
$snapshotFile = Join-Path ([IO.Path]::GetTempPath()) ('ac-installer-snapshot-' + [Guid]::NewGuid().ToString('N') + '.ps1')
try {
    [IO.File]::WriteAllText($snapshotFile,'param([string]$Marker) [Console]::WriteLine($Marker); exit 0',[Text.UTF8Encoding]::new($false))
    $snapshotDigest = (Get-FileHash -LiteralPath $snapshotFile).Hash.ToLowerInvariant()
    $command = Get-AdministratorInstallerCommand $snapshotFile $snapshotDigest @{Marker='checked_snapshot'}
    if ($command.Length -gt 30000) { throw 'snapshot_command_size' }
    [IO.File]::WriteAllText($snapshotFile,'throw "reopened_path"')
    $output = & $ps -NoLogo -NoProfile -NonInteractive -EncodedCommand $command
    if ($LASTEXITCODE -ne 0 -or ($output -join '') -cne 'checked_snapshot') { throw 'snapshot_execution_reopened_writable_path' }
    try { $null = Get-AdministratorInstallerCommand $snapshotFile $snapshotDigest @{}; throw 'accepted_replaced_installer' }
    catch { if ($_.Exception.Message -cne 'administrator_installer_hash') { throw } }
} finally { if ([IO.File]::Exists($snapshotFile)) { [IO.File]::Delete($snapshotFile) } }
[Console]::WriteLine('PASS public dispatch executes the verified snapshot despite subsequent pathname replacement')
$helper = [IO.File]::ReadAllText($entry)
if ($helper -match 'Get-AdministratorReleaseDigest' -or $helper -match "Join-Path .+SHA256SUMS" -or
    $helper -notmatch "acAdministratorBundleSha256 = ''" -or $helper -notmatch "acAdministratorStagerSha256 = ''") {
    throw 'administrator_pins_still_come_from_writable_metadata'
}
$output = & $ps -NoLogo -NoProfile -NonInteractive -File $entry -Apply -Consent accept-administrator-browser-installation -OperationId ('a' * 32)
if ($LASTEXITCODE -ne 1 -or ($output | ConvertFrom-Json).status -cne 'use-observe-for-existing-operation') { throw 'historical_apply_replayed' }
[Console]::WriteLine('PASS embedded release pins, historical observation boundary and Apply ID refusal')
$cmd = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../native/bootstrap/install.cmd'))
if ($cmd -notmatch 'guided-administrator' -or $cmd -notmatch '-Administrator -Apply -Consent accept-administrator-browser-installation') {
    throw 'cmd_administrator_entry_missing'
}
[Console]::WriteLine('PASS CMD exposes the same consented command path without an installer executable')
