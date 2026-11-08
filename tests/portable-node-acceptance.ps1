[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Fixture, [switch]$AllowDownload)
$ErrorActionPreference = 'Stop'
$prior = $env:LOCALAPPDATA
$tls = [Net.ServicePointManager]::SecurityProtocol
$original = $null
try {
    $root = [IO.Path]::GetFullPath($Fixture)
    $temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $root.StartsWith($temporary, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($root) -notmatch '^ac-node-provision-[a-f0-9]{32}$') { throw 'invalid_test_fixture' }
    $source = Join-Path (Split-Path $PSScriptRoot -Parent) 'native\bootstrap\install.ps1'
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($source,[ref]$null,[ref]$null)
    $functions = $ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $n.Name -in @('Install-PortableNode','Get-NodeVersion','Resolve-Node')},$true)
    if ($functions.Count -ne 3) { throw 'missing_test_functions' }
    foreach ($function in $functions) { . ([scriptblock]::Create($function.Extent.Text)) }
    $env:LOCALAPPDATA = $root
    $InstallLocal = $true; $Consent = 'accept-install'; $NodePath = ''; $script:acArch = 'x64'
    try { $null = Install-PortableNode -ReuseOnly; throw 'missing_cache_was_provisioned' }
    catch { if ($_.Exception.Message -ne 'node_not_found') { throw } }
    if (Test-Path -LiteralPath $root) { throw 'read_only_reuse_created_directory' }
    $Consent = ''
    try { $null = Install-PortableNode; throw 'provisioned_without_consent' }
    catch { if ($_.Exception.Message -ne 'node_not_found') { throw } }
    if (Test-Path -LiteralPath $root) { throw 'refusal_created_directory' }
    $Consent = 'accept-install'

    # Test failed and corrupt downloads without contacting the network.
    $env:LOCALAPPDATA = Join-Path $root 'failed-download-fixture'
    & {
        function Invoke-WebRequest($Uri, $OutFile, $TimeoutSec, [switch]$UseBasicParsing) {
            if ($Uri -cne 'https://nodejs.org/dist/v22.23.4/node-v22.23.4-win-x64.zip') { throw 'unexpected_url' }
            [IO.File]::WriteAllText($OutFile, 'partial or corrupt archive')
            if ($expectedError -ceq 'node_download_failed') { throw 'synthetic_connection_error' }
        }
        foreach ($expectedError in @('node_download_failed', 'node_archive_digest_mismatch')) {
            try { $null = Install-PortableNode; throw 'invalid_download_accepted' }
            catch { if ($_.Exception.Message -cne $expectedError) { throw } }
            if (Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'AgentContinueToolchain') -Force) {
                throw 'failed_download_left_staging_files'
            }
        }
    }
    $discovery = Join-Path $root 'discovery-fixture'
    $broken = Join-Path $discovery 'broken'
    $compatible = Join-Path $discovery 'compatible'
    $null = [IO.Directory]::CreateDirectory($broken)
    $null = [IO.Directory]::CreateDirectory($compatible)
    $brokenCommand = Join-Path $broken 'node.cmd'
    [IO.File]::WriteAllText($brokenCommand, "@echo off`r`necho v24.0.0`r`nexit /b 1`r`n")
    [IO.File]::WriteAllText((Join-Path $compatible 'node.cmd'), "@echo off`r`necho v24.0.0`r`n")
    $priorPath = $env:PATH
    try {
        $env:PATH = "$broken;$compatible;${env:SystemRoot}\System32"
        $found = Resolve-Node
        if ($found.Path -cne (Join-Path $compatible 'node.cmd') -or $found.Version -cne '24.0.0') {
            throw 'valid_candidate_not_selected'
        }
        $NodePath = $brokenCommand
        try { $null = Resolve-Node; throw 'explicit_broken_node_accepted' }
        catch { if ($_.Exception.Message -ne 'node_version_unreadable') { throw } }
        $NodePath = ''
        $env:PATH = "$broken;${env:SystemRoot}\System32"
        [IO.File]::WriteAllText($brokenCommand, "@echo off`r`necho v20.0.0`r`n")
        try { $null = Resolve-Node; throw 'old_node_accepted' }
        catch { if ($_.Exception.Message -ne 'node_version_too_old') { throw } }
    } finally { $env:PATH = $priorPath }

    $redirected = Join-Path $root 'redirected'
    $target = Join-Path $root 'junction-target'
    $null = [IO.Directory]::CreateDirectory($target)
    $null = New-Item -ItemType Junction -Path $redirected -Target $target
    $env:LOCALAPPDATA = $redirected
    try { $null = Install-PortableNode; throw 'redirected_root_accepted' }
    catch { if ($_.Exception.Message -ne 'invalid_install_root') { throw } }
    if (Get-ChildItem -LiteralPath $target -Force) { throw 'redirected_root_was_modified' }

    $env:LOCALAPPDATA = $root
    if (-not $AllowDownload) { function Invoke-WebRequest { throw 'unexpected_download' } }
    $first = Install-PortableNode
    function Invoke-WebRequest { throw 'unexpected_download' }
    $second = Install-PortableNode -ReuseOnly
    if ($first -cne $second) { throw 'reuse_mismatch' }
    $npm = Join-Path (Split-Path $second -Parent) 'node_modules\npm\bin\npm-cli.js'
    $original = [IO.File]::ReadAllBytes($npm)
    $mutated = [byte[]]$original.Clone()
    $mutated[$mutated.Length - 1] = $mutated[$mutated.Length - 1] -bxor 1
    [IO.File]::WriteAllBytes($npm, $mutated)
    $rejected = $false
    try { $null = Install-PortableNode -ReuseOnly } catch {
        if ($_.Exception.Message -ne 'node_provision_existing_invalid') { throw }
        $rejected = $true
    }
    if (-not $rejected) { throw 'corrupt_npm_accepted' }
    [IO.File]::WriteAllBytes($npm,$original); $original = $null
    $null = Install-PortableNode
    [pscustomobject]@{Passed=$true;PSEdition=$PSVersionTable.PSEdition;NodeVersion=(Get-NodeVersion $second);
        ConsentRequired=$true;FailedDownloadCleaned=$true;CorruptDownloadCleaned=$true;
        BrokenCandidateSkipped=$true;ExplicitNodeRemainsStrict=$true;RedirectedRootUnchanged=$true;
        ReuseWithoutDownload=$true;CorruptNpmRejected=$true;RestoredTreeVerified=$true;
        NativeRegistration=$false;TunnelStarted=$false;Fixture=$root} | ConvertTo-Json
} finally {
    if ($null -ne $original) { [IO.File]::WriteAllBytes($npm,$original) }
    $env:LOCALAPPDATA = $prior
    [Net.ServicePointManager]::SecurityProtocol = $tls
}
