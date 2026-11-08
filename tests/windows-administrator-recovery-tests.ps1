[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
$entry = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../native/bootstrap/install-administrator.ps1'))
$tokens = $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($entry,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'recovery_installer_parse' }
$functions = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.FunctionDefinitionAst] })
$names = @('Read-AdministratorInstallReceipt','Test-AdministratorInstallReceipt','New-AdministratorInstallRecoveryCommand')
foreach ($name in $names) {
    $fn = @($functions | Where-Object Name -CEQ $name)
    if ($fn.Count -ne 1) { throw ('recovery_definition_missing:' + $name) }
    . ([ScriptBlock]::Create($fn[0].Extent.Text))
}
$script:checks = 0
function Check($Value,[string]$Label) {
    if (-not $Value) { throw $Label }
    $script:checks++
}
function Parse-Recovery([string]$Text) {
    $tokens = $errorsFound = $null
    $parsed = [Management.Automation.Language.Parser]::ParseInput($Text,[ref]$tokens,[ref]$errorsFound)
    Check ($errorsFound.Count -eq 0) 'recovery_source_parse'
    return $parsed
}
function Decode-Recovery([string]$Command) {
    Check ($Command -cmatch '\Apowershell\.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ([A-Za-z0-9+/]+=*)\z') 'ordinary_encoded_command_only'
    return [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Matches[1]))
}
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
function Invoke-Recovery([string]$Text,[int]$ExpectedExit) {
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Text))
    $wire = @(& $ps -NoLogo -NoProfile -NonInteractive -EncodedCommand $encoded)
    Check ($LASTEXITCODE -eq $ExpectedExit) 'recovery_exit_code'
    Check ($wire.Count -eq 1 -and $wire[0].Length -lt 1024) 'one_bounded_status_record'
    return ConvertFrom-Json -InputObject $wire[0]
}
function Check-Status($Row,[bool]$Ok,[string]$Operation) {
    Check (@($Row.PSObject.Properties).Count -eq 8) 'closed_status_projection'
    Check ($Row.ok -is [bool] -and $Row.ok -eq $Ok) 'recovery_ok'
    $expectedStatus = if ($Ok) { 'installation-recorded' } else { 'installation-outcome-unconfirmed' }
    Check ($Row.status -ceq $expectedStatus -and $Row.operationId -ceq $Operation) 'exact_operation_status'
    foreach ($field in @('automaticallyRetried','mutationPerformed','tunnelStarted','chatAuthorized')) {
        Check ($Row.$field -is [bool] -and -not $Row.$field) ('no_effect_claim:' + $field)
    }
    Check ($Row.currentConnection -ceq 'unobserved') 'receipt_not_live_connection'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
try { $sid = $identity.User.Value } finally { $identity.Dispose() }
$operation = [Guid]::NewGuid().ToString('N')
$digest = 'a' * 64
$stagerDigest = 'b' * 64
$inputs = @{OperationId=$operation;Digest=$digest;StagerDigest=$stagerDigest;Sid=$sid}
foreach ($field in @('OperationId','Digest','StagerDigest','Sid')) {
    $badValues = switch ($field) {
        OperationId { @('',('A'*32),('a'*31),'../receipt',($operation+[char]10),"';throw 'injected'") }
        Digest { @('',('A'*64),('a'*63),($digest+[char]10),'../bundle') }
        StagerDigest { @('',('B'*64),('b'*65),($stagerDigest+[char]10),'../stager') }
        Sid { @('','S-1-5-18','s-1-5-21-1-2-3-1001',($sid+[char]10),"S-1-5-21-1-2-3-1001';throw 'injected'") }
    }
    foreach ($bad in $badValues) {
        $invalid = $inputs.Clone()
        $invalid[$field] = $bad
        $rejected = $false
        try { $null = New-AdministratorInstallRecoveryCommand @invalid }
        catch { Check ($_.Exception.Message -ceq 'administrator_recovery_input') 'specific_invalid_input_error'; $rejected = $true }
        Check $rejected ('invalid_identity_rejected:' + $field)
    }
}
[Console]::WriteLine('PASS closed public identifiers reject malformed, injected and newline inputs')

# Caller state must not be captured, even when it contains the real install request shape.
$PayloadDirectory = 'C:\removed-payload-sentinel'
$request = @{HostedTunnelId='tunnel_private_sentinel';RuntimeKeyFile='C:\private-key-sentinel';
    InstallerSourcePath='C:\private-stager-sentinel';Archive='C:\private-archive-sentinel';
    RuntimeKey='runtime-secret-sentinel';Command='execution-command-sentinel'}
$command = New-AdministratorInstallRecoveryCommand @inputs
Check ($command.Length -lt 30000) 'recovery_fits_windows_command_limit'
$source = Decode-Recovery $command
$recoveryAst = Parse-Recovery $source
foreach ($forbidden in @($PayloadDirectory,$PSScriptRoot,$entry,[IO.Path]::GetTempPath()) + @($request.Values) + @(
    '$PSScriptRoot','$PayloadDirectory','$env:TEMP','RuntimeKey','HostedTunnelId','InstallerSourcePath',
    'Stage-WindowsAdministratorBundle.ps1','install-administrator.ps1','ScriptBlock]::Create',
    'ExecutionPolicy','runas','Process]::Start','Start-Process','Invoke-WebRequest','Set-Acl','SetAccessControl',
    'CreateDirectory','WriteAll','InstallBrowserOwner','ConnectBrowserHostedOwner','Register-ScheduledTask')) {
    Check (-not $source.Contains($forbidden)) ('no_payload_or_private_dependency:' + $forbidden)
}
$recoveryFunctions = @($recoveryAst.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.FunctionDefinitionAst] })
Check ($recoveryFunctions.Count -eq 2) 'only_two_receipt_function_snapshots'
foreach ($name in $names[0..1]) {
    $snapshot = @($recoveryFunctions | Where-Object Name -CEQ $name)
    Check ($snapshot.Count -eq 1) ('exact_snapshot_definition:' + $name)
    $original = (Get-Command -Name $name -CommandType Function).ScriptBlock.ToString()
    Check ($snapshot[0].Body.GetScriptBlock().ToString() -ceq $original) ('unchanged_function_snapshot:' + $name)
}
$allowedCalls = @('Import-Module','ConvertFrom-Json','ConvertTo-Json','Read-AdministratorInstallReceipt','Test-AdministratorInstallReceipt')
foreach ($call in $recoveryAst.FindAll({param($n) $n -is [Management.Automation.Language.CommandAst]},$true)) {
    Check ($null -ne $call.GetCommandName() -and $call.GetCommandName() -cin $allowedCalls) ('closed_readonly_call_graph:' + $call.Extent.Text)
}
$allowedVariables = @('ErrorActionPreference','PSModuleAutoLoadingPreference','PSHOME','PSVersionTable','env:OS',
    'request','ok','identity','programFiles','root','receiptFile','receipt','Receipt','Request','result','name',
    'File','Sid','acl','descriptor','entry','stream','reader','true','false','null')
foreach ($variable in $recoveryAst.FindAll({param($n) $n -is [Management.Automation.Language.VariableExpressionAst]},$true)) {
    Check ($variable.VariablePath.UserPath -cin $allowedVariables) ('no_unbundled_variable:' + $variable.Extent.Text)
}
$assignments = @($recoveryAst.EndBlock.Statements | Where-Object {
    $_ -is [Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -ceq '$request'
})
Check ($assignments.Count -eq 1) 'one_public_request'
$publicRecord = @($assignments[0].Right.FindAll({param($n) $n -is [Management.Automation.Language.HashtableAst]},$true))
Check ($publicRecord.Count -eq 1 -and $publicRecord[0].KeyValuePairs.Count -eq 4) 'only_four_serialized_public_values'
foreach ($pair in $publicRecord[0].KeyValuePairs) {
    Check ($pair.Item1.Value -cin @('OperationReceiptId','ExpectedSha256','ExpectedStagerSha256','ExpectedUserSid')) 'public_field_allowlist'
}
Check ($source.Contains('[Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)')) 'protected_receipt_location_derived'
Check ($source.Contains('$identity.User.Value -cne $request.ExpectedUserSid')) 'exact_current_sid_comparison'
[Console]::WriteLine('PASS exact read-only snapshots, complete closure, public-only record and no temporary dependency')

$receiptFile = [IO.Path]::Combine([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles),
    'AgentContinueAdmin',$digest.Substring(0,24)) + '.install-' + $operation + '.json'
Check (-not [IO.File]::Exists($receiptFile)) 'absent_fixture_operation_precondition'
$absent = Invoke-Recovery $source 1
Check-Status $absent $false $operation
Check (-not [IO.File]::Exists($receiptFile)) 'absence_preserved_no_replay'
$again = Invoke-Recovery $source 1
Check-Status $again $false $operation
[Console]::WriteLine('PASS actual ordinary PowerShell absent-receipt observation stays unconfirmed without replay')

# Fixtures replace only the protected reader in memory; they do not establish live ACL acceptance.
$readerAst = @($recoveryFunctions | Where-Object Name -CEQ 'Read-AdministratorInstallReceipt')[0]
$good = [pscustomobject]@{version=1;operationId=$operation;bundleSha256=$digest;stagerSha256=$stagerDigest;
    secret='receipt-secret-sentinel';result=[pscustomobject]@{ok=$true;phase='complete';protectedFilesVerified=$true;
        administratorStateVerified=$true;administratorChildVerified=$true;hostedBindingPrepared=$true;
        hostedLaunchPlanVerified=$true;hostedOwnerAuthorized=$true;browserEnrollmentCommitted=$true;
        readyToConnect=$true;registrationChanged=$true;tunnelStarted=$false;activated=$false}}
$goodJson = ConvertTo-Json -InputObject $good -Depth 4 -Compress
$stub = "function Read-AdministratorInstallReceipt { param(`$File,`$Sid) return (ConvertFrom-Json '" + $goodJson + "') }"
$fixture = $source.Replace($readerAst.Extent.Text,$stub)
$recorded = Invoke-Recovery $fixture 0
Check-Status $recorded $true $operation
Check (-not (ConvertTo-Json -InputObject $recorded -Compress).Contains('receipt-secret-sentinel')) 'raw_receipt_never_serialized'
foreach ($change in @(
    @(('"operationId":"'+$operation+'"'),('"operationId":"'+('c'*32)+'"')),
    @(('"bundleSha256":"'+$digest+'"'),('"bundleSha256":"'+('c'*64)+'"')),
    @(('"stagerSha256":"'+$stagerDigest+'"'),('"stagerSha256":"'+('c'*64)+'"')),
    @('"administratorChildVerified":true','"administratorChildVerified":false'),
    @('"readyToConnect":true','"readyToConnect":"true"'),
    @('"phase":"complete"','"phase":"partial"'),
    @('"tunnelStarted":false','"tunnelStarted":true'),
    @('"activated":false','"activated":true')
)) {
    $invalidFixture = $fixture.Replace($change[0],$change[1])
    Check ($invalidFixture -cne $fixture) 'negative_fixture_changed'
    Check-Status (Invoke-Recovery $invalidFixture 1) $false $operation
}
foreach ($stubBody in @("throw 'private-error-sentinel'","return (ConvertFrom-Json '{bad-json}')",'return $null')) {
    $failed = $source.Replace($readerAst.Extent.Text,('function Read-AdministratorInstallReceipt { ' + $stubBody + ' }'))
    Check-Status (Invoke-Recovery $failed 1) $false $operation
}
$otherSid = 'S-1-5-21-1-2-3-1001'
if ($otherSid -ceq $sid) { $otherSid = 'S-1-5-21-1-2-3-1002' }
$wrongAccount = Decode-Recovery (New-AdministratorInstallRecoveryCommand $operation $digest $stagerDigest $otherSid)
$wrongAst = Parse-Recovery $wrongAccount
$wrongReader = @($wrongAst.EndBlock.Statements | Where-Object {
    $_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -ceq 'Read-AdministratorInstallReceipt'
})[0]
# A valid receipt would succeed if the SID guard did not run before the reader.
$wrongAccount = $wrongAccount.Replace($wrongReader.Extent.Text,$stub)
Check-Status (Invoke-Recovery $wrongAccount 1) $false $operation
[Console]::WriteLine('PASS receipt mismatch, partial/malformed/unreadable receipt and wrong-current-SID fixtures fail closed')

$installerSource = [IO.File]::ReadAllText($entry)
Check ($installerSource.Contains('$recoveryCommand = New-AdministratorInstallRecoveryCommand $OperationId $ExpectedSha256 $ExpectedStagerSha256 $sid')) 'installer_uses_durable_recovery'
Check (-not $installerSource.Contains('$recoveryEntry')) 'no_stale_payload_recovery_entry'
$uacAt = $installerSource.IndexOf('$child = [Diagnostics.Process]::Start($start)',[StringComparison]::Ordinal)
Check ($installerSource.IndexOf("Write-Host ('Read-only recovery: ' + `$recoveryCommand)",[StringComparison]::Ordinal) -lt $uacAt) 'recovery_printed_before_uac'
$wire = @(& $ps -NoLogo -NoProfile -NonInteractive -File $entry -Observe -OperationId $operation `
    -ExpectedSha256 $digest -ExpectedStagerSha256 $stagerDigest)
Check ($LASTEXITCODE -eq 1 -and $wire.Count -eq 1) 'legacy_observe_exit'
$legacy = ConvertFrom-Json -InputObject $wire[0]
Check (-not $legacy.ok -and $legacy.status -ceq 'installation-outcome-unconfirmed' -and
    $legacy.operationId -ceq $operation -and -not $legacy.automaticallyRetried) 'legacy_direct_observe_preserved'
[Console]::WriteLine('PASS installer recovery wiring and legacy direct Observe stay read-only')
[pscustomobject]@{ok=$true;checks=$checks;scope='readonly-absent-receipt-and-in-memory-reader-fixtures';
    installedAcceptance=$false;uacRequested=$false} | ConvertTo-Json -Compress
