# Test installer diagnostics without invoking install, registry or a launcher.
param([string]$FixtureRoot = '', [string]$NodePath = '')
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\native\bootstrap\install.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'installer_parse_failed' }
$functions = @('Get-InstallFailureCode', 'Get-BootstrapFailureCode', 'Test-ManagerProfileMismatch', 'ConvertFrom-ManagerOperationFailure')
if ($FixtureRoot) { $functions += @('Invoke-Bootstrap', 'Write-Result') }
foreach ($name in $functions) {
    $definition = $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $true) |
        Where-Object { $_.Name -ceq $name }
    if (@($definition).Count -ne 1) { throw 'classifier_definition_invalid' }
    . ([scriptblock]::Create($definition.Extent.Text))
}
if ($FixtureRoot) {
    $script:acNode = $NodePath
    $script:acPayloadRoot = $FixtureRoot
    Invoke-Bootstrap @('start-manager')
    throw 'operation_failure_exit_lost'
}
$checks = 0
foreach ($code in @('destination_exists', 'manager_start_unconfirmed', 'node_download_failed', 'node_archive_digest_mismatch', 'setup_cancelled', 'bootstrap_failed_exit_1',
    'uninstall_inspection_unavailable', 'native_release_unavailable', 'native_release_invalid', 'native_release_signature_invalid', 'native_release_node_mismatch',
    'native_release_payload_mismatch', 'native_release_destination_exists', 'native_release_consent_required', 'native_release_preparation_failed')) {
    if ((Get-InstallFailureCode $code) -cne $code) { throw 'known_error_lost' }
    $checks++
}
foreach ($message in @('C:\private\runtime-key.txt', 'private-token-value', "node_not_found`nprivate", 'NODE_NOT_FOUND', '')) {
    if ((Get-InstallFailureCode $message) -cne 'local_install_failed') { throw 'private_error_exposed' }
    $checks++
}
foreach ($code in @('destination_exists', 'manager_start_unconfirmed', 'dependency_acquisition_failed')) {
    $json = @{ok=$false;error=$code} | ConvertTo-Json -Compress
    if ((Get-BootstrapFailureCode $json 1) -cne $code) { throw 'bootstrap_error_lost' }
    $checks++
}
foreach ($json in @(
    '{"ok":false,"error":"C:\\private\\runtime-key.txt"}',
    '{"ok":true,"error":"destination_exists"}',
    '{"ok":false,"error":"destination_exists","extra":"private"}',
    '{"ok":0,"error":"destination_exists"}',
    '{"ok":false}', 'not json', ('x' * 65537)
)) {
    if ((Get-BootstrapFailureCode $json 7) -cne 'bootstrap_failed_exit_7') { throw 'invalid_bootstrap_error_accepted' }
    $checks++
}
$id = '12345678-1234-4321-8123-123456789abc'
$valid = '{"ok":false,"error":"manager_start_unconfirmed","operationId":"' + $id + '","operationStatus":"unobserved"}'
$mismatch = '{"ok":false,"error":"manager_profile_mismatch"}'
if (-not (Test-ManagerProfileMismatch $mismatch 1) -or (Test-ManagerProfileMismatch $mismatch 0) -or
    (Test-ManagerProfileMismatch $mismatch 2)) { throw 'mismatch_exit_not_enforced' }
foreach ($output in @($valid, '{"ok":false,"error":"manager_start_unconfirmed"}', $mismatch.ToUpperInvariant(),
    (' ' + $mismatch), ($mismatch + "`n" + $mismatch))) {
    if (Test-ManagerProfileMismatch $output 1) { throw 'unsafe_runtime_retry_accepted' }
}
$receipt = ConvertFrom-ManagerOperationFailure $valid
if ($receipt.Count -ne 4 -or $receipt.ok -ne $false -or $receipt.operationId -cne $id -or
    $receipt.operationStatus -cne 'unobserved' -or $receipt.error -cne 'manager_start_unconfirmed') { throw 'operation_receipt_lost' }
foreach ($invalid in @(
    ('[' + $valid + ']'), $valid.Replace('"ok"', '"OK"'), $valid.Replace($id, 'private-token-value'),
    $valid.Replace('"unobserved"', '["unobserved"]'), $valid.Replace('"unobserved"', '"replayed"'),
    $valid.Replace('"ok":false', '"ok":false,"path":"private"'), (' ' * 1024 + $valid)
)) {
    if ($null -ne (ConvertFrom-ManagerOperationFailure $invalid)) { throw 'invalid_operation_receipt_accepted' }
}
[Console]::Out.WriteLine('manager_operation_failure_receipt=PASS')
[Console]::Out.WriteLine(('installer_failure_classifiers=PASS checks={0}' -f $checks))
