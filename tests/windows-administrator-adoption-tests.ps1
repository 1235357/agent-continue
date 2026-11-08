[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$entry = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../native/bootstrap/install-administrator.ps1'))
$tokens = $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($entry,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'adoption_installer_parse' }
$source = [IO.File]::ReadAllText($entry)
$functions = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.FunctionDefinitionAst] })
$adoption = @($functions | Where-Object Name -CEQ 'Get-AdministratorExistingInstallation')
if ($adoption.Count -ne 1) { throw 'adoption_definition' }
foreach ($name in @('Read-AdministratorInstallSource','Get-AdministratorExistingInstallation')) {
    $fn = @($functions | Where-Object Name -CEQ $name)
    . ([ScriptBlock]::Create($fn[0].Extent.Text))
}
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
foreach ($case in @(
    @{Digest='invalid';Stager=('b'*64);Extension=('c'*32);Sid=$sid},
    @{Digest=('a'*64);Stager='invalid';Extension=('c'*32);Sid=$sid},
    @{Digest=('a'*64);Stager=('b'*64);Extension='*';Sid=$sid},
    @{Digest=('a'*64);Stager=('b'*64);Extension=('c'*32);Sid='S-1-5-18'}
)) {
    try {
        $null = Get-AdministratorExistingInstallation $case.Digest $case.Stager $case.Extension $case.Sid
        throw 'accepted_invalid_adoption_identity'
    } catch { if ($_.Exception.Message -cne 'administrator_existing_input') { throw } }
}
[Console]::WriteLine('PASS invalid artifact, extension and account identities fail before inspection')

$text = $adoption[0].Extent.Text
foreach ($forbidden in @('Read-Host','InstallBrowserOwner','ConnectBrowserHostedOwner','Request-AdministratorOwnerConnect',
    'Write-AdministratorOwnerIntent','CreateDirectory','Set-Acl','Start-Process','NewGuid','RuntimeKeyFile')) {
    if ($text.Contains($forbidden)) { throw ('adoption_mutation_surface_'+$forbidden) }
}
foreach ($required in @('Get-AdministratorBrowserSetupBinding','Verify-SealedBundle $Root $layout',
    'Assert-AdministratorBrowserTask','Read-AdministratorInstallSource $stager $StagerDigest',
    "privateBinding='not-inspected'","currentConnection='unobserved'","next='open-devices'")) {
    if (-not $text.Contains($required)) { throw ('adoption_verifier_missing_'+$required) }
}
if ($text.Contains("Read-AdministratorControlBytes ([IO.Path]::Combine(`$Root+'.browser','demand.json'))")) {
    throw 'adoption_must_not_read_private_tunnel_binding'
}
$inspectAt = $source.LastIndexOf('$existing = Get-AdministratorExistingInstallation',[StringComparison]::Ordinal)
foreach ($later in @("`$TunnelId = Read-Host",'if (-not $OperationId) { $OperationId = [Guid]::NewGuid()',
    '$worker = New-AdministratorInstallWorker $request')) {
    if ($inspectAt -lt 0 -or $source.IndexOf($later,[StringComparison]::Ordinal) -lt $inspectAt) {
        throw 'adoption_must_precede_credentials_operation_and_elevation'
    }
}
[Console]::WriteLine('PASS read-only identity/inventory/task chain precedes credentials and fresh setup')

$temp = Join-Path ([IO.Path]::GetTempPath()) ('ac-admin-adoption-'+[Guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($temp)
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
try {
    foreach ($state in @('existing-matched','existing-unconfirmed')) {
        # Execute the real installer dispatcher with only the read-only
        # classifier mocked. Any credentials, acquisition or elevation would
        # fail in this redirected, keyless fixture instead of being performed.
        $stub = "function Get-AdministratorExistingInstallation { return @{status='$state';mutationPerformed=`$false;currentConnection='unobserved';next='open-devices'} }"
        $fixture = $source.Replace($adoption[0].Extent.Text,$stub)
        $file = Join-Path $temp ($state+'.ps1')
        [IO.File]::WriteAllText($file,$fixture,[Text.UTF8Encoding]::new($false))
        $output = & $ps -NoLogo -NoProfile -NonInteractive -File $file -Apply -PromptForConnection `
            -Consent accept-administrator-browser-installation -ExtensionId ('c'*32) `
            -ExpectedSha256 ('a'*64) -ExpectedStagerSha256 ('b'*64) -PayloadDirectory $temp
        $exitCode = $LASTEXITCODE
        $result = ($output -join [char]10) | ConvertFrom-Json
        if ($result.status -cne $state -or $result.installed -ne $false -or $result.registrationChanged -ne $false -or
            $result.mutationPerformed -ne $false -or $result.tunnelStarted -ne $false -or $result.operationId -or
            $exitCode -ne $(if ($state -ceq 'existing-matched') {0} else {1})) { throw 'adoption_dispatch_side_effect' }
    }
    [Console]::WriteLine('PASS matched and unconfirmed installed routes return before prompts, UAC, download or new operation')
} finally {
    $absolute = [IO.Path]::GetFullPath($temp)
    if ([IO.Path]::GetDirectoryName($absolute) -ine [IO.Path]::GetTempPath().TrimEnd('\') -or
        [IO.Path]::GetFileName($absolute) -cnotmatch '\Aac-admin-adoption-[a-f0-9]{32}\z') { throw 'adoption_fixture_cleanup' }
    Remove-Item -LiteralPath $absolute -Recurse -Force
}
