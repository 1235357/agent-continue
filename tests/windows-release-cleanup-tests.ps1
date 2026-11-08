# Exercise the cleanup helper only, with an inert text file and test doubles.
param([Parameter(Mandatory=$true)][string]$Builder)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$tree=[Management.Automation.Language.Parser]::ParseFile($Builder,[ref]$tokens,[ref]$errors)
if ($errors.Count -ne 0) { throw 'builder_parse_failed' }
$functions=@($tree.FindAll({param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Clear-ReleaseTemporaries'
},$true))
if ($functions.Count -ne 1) { throw 'cleanup_function_missing' }
. ([scriptblock]::Create($functions[0].Extent.Text))
$file=Join-Path ([IO.Path]::GetTempPath()) ('ac-release-cleanup-'+[Guid]::NewGuid().ToString('N')+'.txt')
$held=$null; $script:disposed=$false; $script:deleted=$false
$provider=New-Object PSObject
$provider | Add-Member ScriptMethod Dispose { $script:disposed=$true; throw 'fixture_dispose_failure' }
$temporary=New-Object PSObject
$temporary | Add-Member ScriptMethod Delete { $script:deleted=$true }
try {
    [IO.File]::WriteAllText($file,'inert cleanup fixture')
    $held=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $complete=Clear-ReleaseTemporaries $provider $file $temporary
    if ($complete -cne $false -or -not $script:disposed -or -not $script:deleted -or
        -not [IO.File]::Exists($file)) { throw 'cleanup_failure_not_retained' }
    $held.Dispose(); $held=$null; $script:deleted=$false
    $complete=Clear-ReleaseTemporaries $null $file $temporary
    if ($complete -cne $true -or -not $script:deleted -or [IO.File]::Exists($file)) { throw 'cleanup_success_failed' }
    [Console]::Out.WriteLine('{"ok":true,"failuresReported":true,"allCleanupAttempted":true,"launcherCompiled":false,"launcherExecuted":false}')
} finally {
    if ($null -ne $held) { $held.Dispose() }
    if ([IO.File]::Exists($file)) { [IO.File]::Delete($file) }
}
