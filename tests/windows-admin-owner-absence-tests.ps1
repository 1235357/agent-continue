[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$stager = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'))
$tokens = $errorsFound = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($stager,[ref]$tokens,[ref]$errorsFound)
if ($errorsFound.Count) { throw 'stager_parse' }
$definitions = @{}
foreach ($name in @('Test-AdministratorOwnerAbsent','Get-AdministratorBrowserComItem','Assert-AdministratorBrowserNamespaceFree')) {
    $matches = @($ast.FindAll({param($n)
        $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name
    },$true))
    if ($matches.Count -ne 1) { throw ('missing_function:' + $name) }
    $definitions[$name] = $matches[0]
    . ([scriptblock]::Create($matches[0].Extent.Text))
}

$script:checks = 0
$script:failures = 0
function Check([bool]$Value,[string]$Label) {
    $script:checks++
    if ($Value) { [Console]::WriteLine('PASS ' + $Label) }
    else { $script:failures++; [Console]::WriteLine('FAIL ' + $Label) }
}

$script:registryChecks = 0
function Assert-AdministratorBrowserRegistry($Plan,[bool]$Published) {
    if ($Published) { throw 'fixture_must_check_unpublished_registry' }
    $script:registryChecks++
}
$scheduler = [pscustomobject]@{}
$scheduler | Add-Member -MemberType ScriptMethod -Name GetFolder -Value {
    param($Path)
    throw [IO.DirectoryNotFoundException]::new('fixture_scheduler_folder_absent')
}

$scratch = Join-Path ([IO.Path]::GetTempPath()) ('ac-owner-absence-' + [Guid]::NewGuid().ToString('N'))
$presentFile = Join-Path $scratch 'present.txt'
$presentDirectory = Join-Path $scratch 'present-directory'
try {
    $null = [IO.Directory]::CreateDirectory($scratch)
    $null = [IO.Directory]::CreateDirectory($presentDirectory)
    [IO.File]::WriteAllText($presentFile,'fixture')
    $missingParent = Join-Path (Join-Path $scratch 'missing-parent') 'bridge'
    $cause = $null
    try { $null = [IO.File]::GetAttributes($missingParent) }
    catch { $cause = $_.Exception.GetBaseException() }
    Check ($cause -is [IO.DirectoryNotFoundException]) 'missing-parent fixture raises DirectoryNotFoundException'
    Check (Test-AdministratorOwnerAbsent $missingParent) 'missing parent is absent'
    Check (Test-AdministratorOwnerAbsent (Join-Path $scratch 'missing-file')) 'missing leaf is absent'
    Check (-not (Test-AdministratorOwnerAbsent $presentFile)) 'existing file is not absent'
    Check (-not (Test-AdministratorOwnerAbsent $presentDirectory)) 'existing directory is not absent'
    Check (-not (Test-AdministratorOwnerAbsent '')) 'invalid path is not absent'

    $plan = @{Folder='AgentContinue';Bridge=$missingParent}
    $namespaceFree = $true
    try { Assert-AdministratorBrowserNamespaceFree $scheduler $plan }
    catch { $namespaceFree = $false }
    Check ($namespaceFree -and $script:registryChecks -eq 1) 'missing-parent namespace reaches registry preflight stub'
    $plan.Bridge = $presentDirectory
    $script:registryChecks = 0
    $collision = $false
    try { Assert-AdministratorBrowserNamespaceFree $scheduler $plan }
    catch { $collision = $_.Exception.GetBaseException().Message -ceq 'browser_enrollment_collision' }
    Check ($collision -and $script:registryChecks -eq 0) 'existing bridge still refuses before registry preflight'

    # Exercise the production catch body without changing any filesystem ACL.
    $tryStatement = @($definitions['Test-AdministratorOwnerAbsent'].Body.EndBlock.Statements |
        Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] })
    if ($tryStatement.Count -ne 1 -or $tryStatement[0].CatchClauses.Count -ne 1) { throw 'absence_catch_shape' }
    $body = $tryStatement[0].CatchClauses[0].Body.Extent.Text
    $handler = [scriptblock]::Create($body.Substring(1,$body.Length-2))
    foreach ($fault in @(
        [UnauthorizedAccessException]::new('fixture_access_denied'),
        [Security.SecurityException]::new('fixture_security_error'),
        [IO.IOException]::new('fixture_other_io_error'),
        [InvalidOperationException]::new('fixture_other_error')
    )) {
        $result = $null
        try { throw $fault }
        catch { $result = & $handler }
        Check ($result -is [bool] -and -not $result) ($fault.GetType().Name + ' remains not absent')
    }
} finally {
    if ([IO.File]::Exists($presentFile)) { [IO.File]::Delete($presentFile) }
    if ([IO.Directory]::Exists($presentDirectory)) { [IO.Directory]::Delete($presentDirectory,$false) }
    if ([IO.Directory]::Exists($scratch)) { [IO.Directory]::Delete($scratch,$false) }
}
[Console]::WriteLine(('RESULT checks={0} failures={1}; scope=extracted-functions-scratch-files-and-stubs; actualInstall=false; actualRegistry=false; actualUac=false; actualRuntime=false' -f $checks,$failures))
if ($failures) { throw 'owner_absence_regression_failed' }
