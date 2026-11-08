[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$stager = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'))
$errorsFound = $null
$tokens = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($stager,[ref]$tokens,[ref]$errorsFound)
if ($errorsFound.Count) { throw 'stager_parse' }
$action = $ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -ceq 'Action' }
$choices = $action.Attributes | Where-Object { $_.TypeName.Name -ceq 'ValidateSet' }
if ('InstallBrowserOwner' -cnotin @($choices.PositionalArguments.Value)) {
    throw 'missing_single_pass_administrator_install'
}

$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$base = @{
    Action='InstallBrowserOwner'; Archive='C:\missing-guided-install.zip'; ExpectedSha256=('1' * 64)
    ExpectedStagerSha256=('2' * 64); ExpectedUserSid=$sid; BrowserExtensionId=('b' * 32)
    HostedTunnelId=('tunnel_' + ('a' * 32)); RuntimeKeyFile='C:\missing-guided-key.txt'
    OperationReceiptId=('3' * 32); Consent='accept-administrator-browser-installation'
}
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
function Assert-Refused([string]$Name,[hashtable]$Changes,[string[]]$Remove = @()) {
    $argsForCase = @{} + $base
    foreach ($key in $Remove) { $argsForCase.Remove($key) }
    foreach ($key in $Changes.Keys) { $argsForCase[$key] = $Changes[$key] }
    $argv = @('-NoLogo','-NoProfile','-NonInteractive','-File',$stager)
    foreach ($key in $argsForCase.Keys) {
        $argv += '-' + $key
        if ($argsForCase[$key] -isnot [bool]) { $argv += [string]$argsForCase[$key] }
    }
    $output = & $ps @argv
    if ($LASTEXITCODE -ne 2) { throw ('unexpected_exit_' + $Name) }
    $receipt = ($output -join [char]10) | ConvertFrom-Json
    if ($receipt.ok -or $receipt.phase -cne 'input' -or $receipt.protectedFilesVerified -or
        $receipt.registrationChanged -or $receipt.tunnelStarted) { throw ('unexpected_mutation_' + $Name) }
    [Console]::WriteLine('PASS single-pass install refuses ' + $Name + ' before identity or mutation')
}
Assert-Refused 'missing consent' @{} @('Consent')
Assert-Refused 'legacy partial consent' @{Consent='accept-administrator-browser-enrollment'}
Assert-Refused 'missing operation receipt' @{} @('OperationReceiptId')
Assert-Refused 'malformed operation receipt' @{OperationReceiptId='not-an-id'}
Assert-Refused 'missing key file' @{} @('RuntimeKeyFile')
Assert-Refused 'missing stager digest' @{} @('ExpectedStagerSha256')
Assert-Refused 'missing browser identity' @{} @('BrowserExtensionId')
Assert-Refused 'wildcard browser identity' @{BrowserExtensionId='*'}
Assert-Refused 'different tunnel input' @{HostedTunnelId='https://not-a-tunnel.invalid'}
Assert-Refused 'SYSTEM account' @{ExpectedUserSid='S-1-5-18'}
Assert-Refused 'acceptance window option' @{HostedWindowSeconds=30}
Assert-Refused 'acceptance witness option' @{LocalAcceptanceWitness=123456}
Assert-Refused 'automatic wake option' @{BrowserWake=$true}

$source = [IO.File]::ReadAllText($stager)
$preflight = $source.IndexOf("if (`$installBrowserOwner) {`r`n", [StringComparison]::Ordinal)
if ($preflight -lt 0) { $preflight = $source.IndexOf("if (`$installBrowserOwner) {`n", [StringComparison]::Ordinal) }
if ($preflight -lt 0 -or $source.IndexOf('Assert-AdministratorBrowserNamespaceFree', $preflight) -gt
    $source.IndexOf("`$phase = 'reserve'", $preflight)) { throw 'install_preflight_must_precede_staging' }
$bindAt = $source.IndexOf('Write-AdministratorHostedBinding $root $stateRoot', $preflight)
$authorizeAt = $source.IndexOf('Write-AdministratorOwnerActivation $root $stateRoot', $bindAt)
$enrollAt = $source.IndexOf('. $completeBrowserEnrollment', $authorizeAt)
if ($bindAt -lt 0 -or $authorizeAt -le $bindAt -or $enrollAt -le $authorizeAt) {
    throw 'install_binding_authorization_enrollment_order'
}
if ($source -notmatch "InstallBrowserOwner\|ProbeLocal\|BindHosted" -or
    $source -notmatch '\$receipt = New-AdministratorInstallResult \$receipt \$browserEnrollmentAttempted \$browserEnrollmentCommitted') {
    throw 'install_durable_receipt_missing'
}
[Console]::WriteLine('PASS install preserves preflight, durable receipt and binding-before-enrollment order')

foreach ($fn in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$true)) {
    if ($fn.Name -cin @('New-AdministratorInstallResult','Publish-AdministratorInstallReceipts')) {
        . ([ScriptBlock]::Create($fn.Extent.Text))
    }
}
if (-not (Get-Command -Name New-AdministratorInstallResult -ErrorAction SilentlyContinue)) { throw 'install_result_projection_missing' }
$fixtureResult = '{"ok":false,"phase":"browser_enrollment_publish","registrationChanged":false,"tunnelStarted":false}'
$uncertain = New-AdministratorInstallResult $fixtureResult $true $false $true $false | ConvertFrom-Json
if ($null -ne $uncertain.browserEnrollmentCommitted -or $null -ne $uncertain.registrationChanged -or
    $uncertain.readyToConnect) { throw 'enrollment_rename_failure_was_reported_as_absence' }
$complete = New-AdministratorInstallResult $fixtureResult $true $true $true $true
$script:privateRecorded = $false
function Publish-LocalProbeReceipt { param($Prefix,$Id,$Digest,$Result) $script:privateRecorded=$true }
function Open-SealedNewFile { throw [IO.IOException]::new('projection_fixture') }
$projection = Publish-AdministratorInstallReceipts 'fixture-prefix' 'fixture-root' ('a' * 32) ('b' * 64) ('c' * 64) $sid $complete
if (-not $script:privateRecorded -or $projection.outcome -cne 'private-recorded-public-unconfirmed' -or
    $projection.registrationChanged -ne $true -or $projection.browserEnrollmentCommitted -ne $true -or
    $projection.operationId -cne ('a' * 32)) { throw 'public_projection_failure_lost_known_commit' }
function Publish-LocalProbeReceipt { throw [IO.IOException]::new('private_fixture') }
$projection = Publish-AdministratorInstallReceipts 'fixture-prefix' 'fixture-root' ('a' * 32) ('b' * 64) ('c' * 64) $sid $complete
if ($projection.outcome -cne 'terminal-receipt-unconfirmed' -or $projection.registrationChanged -ne $true -or
    $projection.browserEnrollmentCommitted -ne $true) { throw 'private_receipt_failure_lost_known_commit' }
[Console]::WriteLine('PASS injected receipt/commit faults preserve known changes and uncertainty without replay')

$closureFunction = $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$true) |
    Where-Object Name -CEQ 'Assert-AdministratorInstallClosure'
if (@($closureFunction).Count -ne 1) { throw 'public_install_closure_missing' }
. ([ScriptBlock]::Create($closureFunction.Extent.Text))
$entries = @{}
$runtime = @('device-native-host.mjs','device-operations.mjs','device-owner.mjs','device-server.mjs','device-ssh.mjs',
    'host.mjs','lifecycle.mjs','operation-receipts.mjs','package-lock.json','package.json','prepared-process.mjs',
    'process-observation.mjs','profile.mjs','research-handoff.mjs','research-runner.mjs','runtime.mjs','setup-cli.mjs',
    'tunnel-pins.json','upstream-pin.json','windows-child.mjs','windows-process-query.cs','windows-admin-owner.mjs',
    'windows-admin-browser-host.mjs','windows-admin-demand.mjs','windows-admin-intent.mjs','windows-owner-job.cs',
    'windows-admin-browser-session.mjs','windows-browser-peer.cs','windows-browser-peer.ps1','agent-continue-build-evidence.json')
foreach ($file in $runtime) { $name='app/' + $file; $entries[$name]=[pscustomobject]@{FullName=$name;Length=1} }
foreach ($name in @('runtime/node.exe','client/tunnel-client-runtime.exe',
    'app/node_modules/@wonderwhy-er/desktop-commander/dist/server.js','app/third-party-notices/node-LICENSE.txt',
    'app/third-party-notices/agent-continue-LICENSE.txt','app/third-party-notices/openai-LICENSE','app/third-party-notices/openai-NOTICE')) {
    $entries[$name]=[pscustomobject]@{FullName=$name;Length=1}
}
Assert-AdministratorInstallClosure @{entries=$entries}
foreach ($name in @($entries.Keys)) {
    $value = $entries[$name]
    $entries.Remove($name)
    try { Assert-AdministratorInstallClosure @{entries=$entries}; throw 'accepted_incomplete_public_install' }
    catch { if ($_.Exception.Message -cne 'administrator_install_closure') { throw } }
    $entries[$name]=$value
}
[Console]::WriteLine('PASS every required public administrator module and license is checked before staging')
