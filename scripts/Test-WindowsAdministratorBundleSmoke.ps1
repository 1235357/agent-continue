[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Archive,
    [Parameter(Mandatory=$true)][ValidatePattern('\A[a-f0-9]{64}\z')][string]$ExpectedSha256,
    [switch]$ExercisePreparedLaunch,
    [switch]$ExerciseTunnelProfile,
    [switch]$ExerciseHostedAdmission,
    [switch]$ExerciseInstalledReadOnly
)

$ErrorActionPreference = 'Stop'
$node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
$powershell = [IO.Path]::Combine($system,'WindowsPowerShell\v1.0\powershell.exe')
$tar = [IO.Path]::Combine($system,'tar.exe')
$repo = [IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot,'..'))
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
try {
    if ($identity.IsSystem -or [Security.Principal.WindowsPrincipal]::new($identity).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'ordinary_windows_token_required' }
    $fixtureSid = $identity.User.Value
} finally { $identity.Dispose() }

function Invoke-PreparedLaunchFixture([string]$Root, [string]$Sid, [string]$Digest, [string]$FixtureRoot = $Root) {
    $installer = Join-Path $PSScriptRoot 'Stage-WindowsAdministratorBundle.ps1'
    $ast = [Management.Automation.Language.Parser]::ParseFile($installer,[ref]$null,[ref]$null)
    $names = @('Assert-PathType','New-SealedAcl','Assert-SealedAcl','Ensure-SealedDirectory','Open-SealedNewFile',
        'Get-AdministratorStateLayout','Write-AdministratorState','Assert-FreshAdministratorState','New-AdministratorLaunchPlan',
        'Read-LocalProbeReply','Send-LocalProbeRequest','Get-LocalProbeFailureCode','Get-LocalProbeProcessId',
        'Read-LocalProbeCompletion','Invoke-LocalTokenProbe')
    foreach ($fn in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] },$true)) {
        if ($fn.Name -in $names) { . ([scriptblock]::Create($fn.Extent.Text)) }
    }
    # Synthetic owner only: the real protected directory and UAC are never used here.
    $administratorsSid = $Sid
    $systemSid = 'S-1-5-18'
    $state = Join-Path $FixtureRoot 'prepared-state-fixture'
    $layout = Get-AdministratorStateLayout $Digest $Sid
    Write-AdministratorState $state $layout
    Assert-FreshAdministratorState $state $layout
    $priorEncoding = [Console]::OutputEncoding
    try {
        [Console]::OutputEncoding = [Text.Encoding]::GetEncoding(936)
        Invoke-LocalTokenProbe $Root $state $Sid 'standard'
    } finally { [Console]::OutputEncoding = $priorEncoding }
    $negative = Join-Path $FixtureRoot 'prepared-nonadmin-negative'
    Write-AdministratorState $negative $layout
    Assert-FreshAdministratorState $negative $layout
    try {
        Invoke-LocalTokenProbe $Root $negative $Sid 'administrator'
        throw 'fixture_standard_token_accepted_as_administrator'
    } catch {
        if ($_.Exception.Message -cne 'probe_token_role') { throw }
    }
    [Console]::WriteLine('{"preparedLaunchVerified":true,"childToken":"standard","selectedAccountMatched":true,"standardRejectedAsAdministrator":true,"shellStartupFlagsVerified":true,"tunnelStarted":false}')
}

function Invoke-TunnelProfileFixture([string]$Root, [string]$Sid, [string]$Digest) {
    $installer = Join-Path $PSScriptRoot 'Stage-WindowsAdministratorBundle.ps1'
    $ast = [Management.Automation.Language.Parser]::ParseFile($installer,[ref]$null,[ref]$null)
    $names = @('Assert-PathType','New-SealedAcl','Assert-SealedAcl','Ensure-SealedDirectory','Open-SealedNewFile',
        'Get-AdministratorStateLayout','Write-AdministratorState','Assert-FreshAdministratorState','New-AdministratorLaunchPlan',
        'To-Hex','Get-AdministratorRuntimeKeyBytes','New-AdministratorHostedDocument','Assert-AdministratorHostedVault',
        'Get-AdministratorHostedMetadata','New-AdministratorHostedLaunchPlan','Write-AdministratorHostedBinding')
    foreach ($fn in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] },$true)) {
        if ($fn.Name -in $names) { . ([scriptblock]::Create($fn.Extent.Text)) }
    }
    $administratorsSid = $Sid
    $systemSid = 'S-1-5-18'
    $state = $Root + '.state'
    $secrets = $Root + '.secrets'
    if ([IO.Directory]::Exists($secrets) -or [IO.File]::Exists($secrets)) { throw 'existing_fixture_secrets' }
    $layout = Get-AdministratorStateLayout $Digest $Sid
    Write-AdministratorState $state $layout
    Assert-FreshAdministratorState $state $layout
    $dummy = ConvertTo-SecureString 'sk-agentcontinue-synthetic-never-valid' -AsPlainText -Force
    try {
        Write-AdministratorHostedBinding $Root $state $Digest $Sid 'tunnel_0123456789abcdef0123456789abcdef' $dummy
        Assert-FreshAdministratorState $state $layout
    } finally { $dummy.Dispose() }
    $launch = New-AdministratorHostedLaunchPlan $Root $state $Digest $Sid 'tunnel_0123456789abcdef0123456789abcdef'
    if ($launch.Arguments -cnotmatch '\Arun --profile-file "([^"]+)"\z' -or $launch.UseShellExecute -or -not $launch.CreateNoWindow) {
        throw 'sealed_launch_fixture_invalid'
    }
    $profileFile = $Matches[1]
    $clean = @{}
    foreach ($name in @('SystemRoot','WINDIR','ComSpec','PATH','PATHEXT','HOME','USERPROFILE',
        'APPDATA','LOCALAPPDATA','TEMP','TMP','AC_ADMIN_BOOT_APP_ROOT')) {
        $clean[$name] = $launch.EnvironmentVariables[$name]
    }
    $oldExe = $env:TUNNEL_CLIENT_TEST_EXE
    $oldProfileFixture = $env:AC_SEALED_TUNNEL_FIXTURE
    $oldAdmissionFixture = $env:AC_SEALED_HOSTED_ADMISSION
    try {
        $env:TUNNEL_CLIENT_TEST_EXE = $launch.FileName
        $env:AC_SEALED_TUNNEL_FIXTURE = @{command=$launch.FileName;profileFile=$profileFile;
            cwd=$launch.WorkingDirectory;env=$clean} | ConvertTo-Json -Depth 4 -Compress
        if ($ExerciseHostedAdmission) { $env:AC_SEALED_HOSTED_ADMISSION = '1' }
        $portableNode = [IO.Path]::Combine($Root,'runtime\node.exe')
        Push-Location -LiteralPath $repo
        try {
            $lines = @(& $portableNode --test '--test-name-pattern=via sealed-profile' native/desktop-commander/tunnel.test.mjs)
            $status = $LASTEXITCODE
        } finally { Pop-Location }
        $lines | Write-Output
        if ($status -ne 0 -or -not ($lines -match '"sealedProfileVerified":true.*"pauseCycleVerified":true')) {
            throw 'sealed_profile_fixture_failed'
        }
        if ($ExerciseHostedAdmission -and -not ($lines -match '"guardedAcceptanceProfileVerified":true')) {
            throw 'guarded_profile_not_observed'
        }
    } finally {
        $env:TUNNEL_CLIENT_TEST_EXE = $oldExe
        $env:AC_SEALED_TUNNEL_FIXTURE = $oldProfileFixture
        $env:AC_SEALED_HOSTED_ADMISSION = $oldAdmissionFixture
    }
}

$parent = & $node -p "require('fs').realpathSync.native(require('os').tmpdir())"
if ($LASTEXITCODE -ne 0 -or $parent -isnot [string] -or -not [IO.Directory]::Exists($parent)) { throw 'temp_unavailable' }
$scratch = [IO.Path]::Combine($parent,'ac-admin-smoke-' + [guid]::NewGuid().ToString('N'))
$oldRoot = $env:AC_WINDOWS_ADMIN_BUNDLE_SMOKE_ROOT
$oldConsent = $env:AC_WINDOWS_ADMIN_BUNDLE_SMOKE
$held = $null
$claimed = $false
$retainTunnelEvidence = $false
try {
    $held = [IO.File]::Open($Archive,'Open','Read','Read')
    if ($ExerciseInstalledReadOnly) {
        if ($ExerciseTunnelProfile -or $ExercisePreparedLaunch -or $ExerciseHostedAdmission) { throw 'installed_read_only_options_conflict' }
        $verifyArgs = @('-NoProfile','-NonInteractive','-File',(Join-Path $PSScriptRoot 'Stage-WindowsAdministratorBundle.ps1'),
            '-Action','Verify','-Archive',$Archive,'-ExpectedSha256',$ExpectedSha256)
        $verified = & $powershell @verifyArgs
        if ($LASTEXITCODE -ne 0 -or ($verified | ConvertFrom-Json).protectedFilesVerified -ne $true) {
            throw 'installed_read_only_verification_failed'
        }
        $installed = [IO.Path]::Combine([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles),
            'AgentContinueAdmin',$ExpectedSha256.Substring(0,24))
        $null = New-Item -ItemType Directory -Path $scratch
        $claimed = $true
        Invoke-PreparedLaunchFixture $installed $fixtureSid $ExpectedSha256 $scratch
        return
    }
    $args = @('-NoProfile','-NonInteractive','-File',(Join-Path $PSScriptRoot 'Stage-WindowsAdministratorBundle.ps1'),
        '-Action','Plan','-Archive',$Archive,'-ExpectedSha256',$ExpectedSha256)
    $report = & $powershell @args
    if ($LASTEXITCODE -ne 0) { throw 'candidate_plan_failed' }
    $plan = $report | ConvertFrom-Json
    if ($plan.ok -ne $true -or $plan.protectedFilesVerified -ne $false -or $plan.activated -ne $false) {
        throw 'candidate_plan_failed'
    }
    $null = New-Item -ItemType Directory -Path $scratch
    $claimed = $true
    & $tar -xf $Archive -C $scratch
    if ($LASTEXITCODE -ne 0) { throw 'candidate_extract_failed' }
    $env:AC_WINDOWS_ADMIN_BUNDLE_SMOKE_ROOT = $scratch
    $env:AC_WINDOWS_ADMIN_BUNDLE_SMOKE = 'accept-disposable-standard-token-test'
    # Node's test glob parser can treat brackets in an absolute repo path as
    # a character class and report exit 0 after running no tests.
    Push-Location -LiteralPath $repo
    try {
        $lines = @(& $node --test native/desktop-commander/stdio.test.mjs)
        $exit = $LASTEXITCODE
    } finally { Pop-Location }
    $lines | Write-Output
    if ($exit -ne 0) { throw 'candidate_stdio_failed' }
    $observations = @(
        foreach ($line in $lines) {
            $start = $line.IndexOf('{"upstream":',[StringComparison]::Ordinal)
            if ($start -ge 0) { $line.Substring($start) | ConvertFrom-Json }
        }
    )
    if ($observations.Count -ne 1 -or $observations[0].extractedBundle -ne $true -or
        $observations[0].windowsToken -cne 'standard' -or $observations[0].rpcReplies -lt 1 -or
        $observations[0].stdinCloseExit -ne 0) { throw 'candidate_stdio_not_observed' }
    if ($ExercisePreparedLaunch) { Invoke-PreparedLaunchFixture $scratch $fixtureSid $ExpectedSha256 }
    if ($ExerciseHostedAdmission) {
        Push-Location -LiteralPath $repo
        try {
            $lines = @(& $node --test native/desktop-commander/hosted-acceptance-admission.test.mjs)
            $status = $LASTEXITCODE
        } finally { Pop-Location }
        $lines | Write-Output
        if ($status -ne 0 -or -not ($lines -match '"actualWindowsProvider":true.*"standardChildTokenVerified":true')) {
            throw 'hosted_admission_fixture_failed'
        }
    }
    if ($ExerciseTunnelProfile) {
        $retainTunnelEvidence = $true
        Invoke-TunnelProfileFixture $scratch $fixtureSid $ExpectedSha256
        $retainTunnelEvidence = $false
    }
} finally {
    if ($null -ne $held) { $held.Dispose() }
    $env:AC_WINDOWS_ADMIN_BUNDLE_SMOKE_ROOT = $oldRoot
    $env:AC_WINDOWS_ADMIN_BUNDLE_SMOKE = $oldConsent
    if ($claimed -and -not $retainTunnelEvidence) {
        $owned = @($scratch)
        if ($ExerciseTunnelProfile) { $owned += @(($scratch + '.state'),($scratch + '.secrets')) }
        foreach ($dir in $owned) {
            $target = [IO.Path]::GetFullPath($dir)
            if (-not [IO.Directory]::Exists($target)) { continue }
            if ([IO.Path]::GetDirectoryName($target) -ine $parent -or
                [IO.Path]::GetFileName($target) -cnotmatch '\Aac-admin-smoke-[a-f0-9]{32}(?:\.state|\.secrets)?\z' -or
                ([IO.File]::GetAttributes($target) -band [IO.FileAttributes]::ReparsePoint)) { throw 'unsafe_fixture_cleanup' }
            Remove-Item -LiteralPath $target -Recurse -Force
        }
    }
}
