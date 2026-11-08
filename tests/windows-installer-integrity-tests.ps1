# Inspect extracted installer boundaries only; never run the installer or payload.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
$source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\native\bootstrap\install.ps1'))
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'installer_parse_failed' }
$definitions = @($ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $true))
foreach ($name in @('Assert-Payload', 'Assert-FileDigest', 'Assert-SetupChecksumList', 'Get-InstallFailureCode')) {
    $definition = @($definitions | Where-Object Name -CEQ $name)
    if ($definition.Count -ne 1) { throw ('installer_boundary_missing_' + $name) }
    . ([scriptblock]::Create($definition[0].Extent.Text))
}
# Optional on the pre-fix source so RED measures behavior, not a missing helper.
$policy = @($definitions | Where-Object Name -CEQ 'Test-UnverifiedPayloadInspection')
if ($policy.Count -gt 1) { throw 'installer_policy_ambiguous' }
if ($policy.Count -eq 1) { . ([scriptblock]::Create($policy[0].Extent.Text)) }

$main = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] })
if ($main.Count -ne 1) { throw 'installer_entry_ambiguous' }
$sumsGate = @($main[0].Body.Statements | Where-Object {
    $_ -is [Management.Automation.Language.IfStatementAst] -and
    $_.Clauses[0].Item1.Extent.Text -match "ContainsKey\('ExpectedSumsSha256'\)"
})
if ($sumsGate.Count -ne 1) { throw 'installer_preflight_boundary_missing' }
$moduleCalls = @($main[0].Body.FindAll({ param($n)
    $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -ceq 'Initialize-InstallerModules'
}, $true))
if ($moduleCalls.Count -ne 3 -or @($moduleCalls | Where-Object {
    $_.Extent.StartOffset -le $sumsGate[0].Extent.EndOffset
}).Count) { throw 'checksum_pin_guard_missing' }
# Run only integrity preflight, not later parameter processing or module loading.
$prefix = [scriptblock]::Create((@($main[0].Body.Statements | Where-Object {
    $_.Extent.EndOffset -le $sumsGate[0].Extent.EndOffset
} | ForEach-Object { $_.Extent.Text }) -join "`n"))
$resolver = @($definitions | Where-Object Name -CEQ 'Resolve-Payload')
if ($resolver.Count -ne 1) { throw 'payload_resolver_missing' }
$archiveGate = @($resolver[0].FindAll({ param($n)
    $n -is [Management.Automation.Language.IfStatementAst] -and
    $n.Clauses[0].Item1.Extent.Text -match 'Assert-FileDigest \$archive \$sums \$archiveName'
}, $true))
$expansion = @($resolver[0].FindAll({ param($n)
    $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -ceq 'Expand-VerifiedSetupArchive'
}, $true))
if ($archiveGate.Count -ne 1 -or $expansion.Count -ne 2 -or
    $archiveGate[0].Extent.EndOffset -ge $expansion[1].Extent.StartOffset) { throw 'archive_gate_not_before_expansion' }
$archiveCheck = [scriptblock]::Create($archiveGate[0].Extent.Text)
$checkSumsArgument = [scriptblock]::Create('param([string]$ExpectedSumsSha256)' + "`n" + $sumsGate[0].Extent.Text)

$script:checks = 0
$script:failures = @()
function Test-Case([string]$Name, [scriptblock]$Body) {
    $script:checks++
    try { & $Body }
    catch { $script:failures += $Name; [Console]::Out.WriteLine(('FAIL {0}: {1}' -f $Name, $_.Exception.Message)) }
}
function Assert-Code([scriptblock]$Body, [string]$Expected) {
    $actual = 'no_error'
    try { $null = & $Body } catch { $actual = $_.Exception.Message }
    if ($actual -cne $Expected) { throw ('expected=' + $Expected + ' actual=' + $actual) }
}
function Invoke-IntegrityCase([hashtable]$Mode, [string]$Tag, [bool]$Bypass, [bool]$Remote, [scriptblock]$Body) {
    $Apply = $InstallLocal = $Administrator = $BrowserManaged = $PromptForConnection = $false
    $ManagerOnly = $PrepareNative = $RegisterNative = $Verify = $Uninstall = $false
    $DeviceAction = $OperationId = ''
    foreach ($key in $Mode.Keys) { Set-Variable -Name $key -Value $Mode[$key] -Scope Local }
    $AllowUnverifiedPayload = $Bypass
    $script:acReleaseTag = $Tag
    $script:acRemote = $Remote
    $script:acPayloadRoot = $fixture
    & $Body
}

$fixture = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ('ac-installer-integrity-' + [guid]::NewGuid().ToString('N'))))
$null = [IO.Directory]::CreateDirectory($fixture)
$entry = Join-Path $fixture 'bin.mjs'
$manifest = Join-Path $fixture 'SHA256SUMS.txt'
$encoding = [Text.UTF8Encoding]::new($false)
# Inert bytes, hashed and read only. There is no Node/process invocation here.
[IO.File]::WriteAllText($entry, 'not executable: installer integrity fixture', $encoding)
$digest = (Get-FileHash -LiteralPath $entry -Algorithm SHA256).Hash.ToLowerInvariant()
$mutating = @(
    @{ Name = 'apply'; Mode = @{ Apply = $true } },
    @{ Name = 'install-local-implies-apply'; Mode = @{ InstallLocal = $true } },
    @{ Name = 'administrator'; Mode = @{ Administrator = $true } },
    @{ Name = 'browser-managed'; Mode = @{ BrowserManaged = $true } },
    @{ Name = 'guided-connection'; Mode = @{ PromptForConnection = $true } },
    @{ Name = 'manager-only'; Mode = @{ ManagerOnly = $true } },
    @{ Name = 'prepare-native'; Mode = @{ PrepareNative = $true } },
    @{ Name = 'register-native'; Mode = @{ RegisterNative = $true } },
    @{ Name = 'operation-id'; Mode = @{ OperationId = '12345678-1234-4321-8123-123456789abc' } }
)
foreach ($action in @('disconnect-and-pause', 'reconnect', 'start', 'browser', 'register-browser-wake', 'future-action', 'STATUS')) {
    $mutating += @{ Name = ('device-' + $action); Mode = @{ DeviceAction = $action } }
}
$inspection = @(
    @{ Name = 'plan'; Mode = @{} },
    @{ Name = 'verify'; Mode = @{ Verify = $true } },
    @{ Name = 'uninstall-dry-run'; Mode = @{ Uninstall = $true } }
)
foreach ($action in @('status', 'installer-status', 'browser-installer-status')) {
    $inspection += @{ Name = $action; Mode = @{ DeviceAction = $action } }
}
try {
    foreach ($bypass in @($false, $true)) {
        Test-Case ('stamped-missing-manifest-bypass-' + $bypass) {
            Invoke-IntegrityCase @{} 'v2.2.1' $bypass $false {
                Assert-Code { Assert-Payload } 'payload_integrity_unverified'
            }
        }
    }
    foreach ($case in $mutating) {
        foreach ($bypass in @($false, $true)) {
            Test-Case ($case.Name + '-missing-manifest-bypass-' + $bypass) {
                Invoke-IntegrityCase $case.Mode '' $bypass $false {
                    Assert-Code { Assert-Payload } 'payload_integrity_unverified'
                }
            }
        }
        Test-Case ($case.Name + '-rejects-before-effects') {
            Invoke-IntegrityCase $case.Mode '' $true $false {
                Assert-Code { & $prefix; throw 'effect_boundary_reached' } 'payload_integrity_unverified'
            }
        }
    }
    foreach ($case in $inspection) {
        Test-Case ($case.Name + '-stamped-rejects-before-effects') {
            Invoke-IntegrityCase $case.Mode 'v2.2.1' $true $false {
                Assert-Code { & $prefix; throw 'effect_boundary_reached' } 'payload_integrity_unverified'
            }
        }
        Test-Case ($case.Name + '-explicit-source-inspection') {
            Invoke-IntegrityCase $case.Mode '' $true $false {
                & $prefix
                if ((Assert-Payload) -ne 0) { throw 'inspection_result_changed' }
            }
        }
        Test-Case ($case.Name + '-requires-explicit-source-bypass') {
            Invoke-IntegrityCase $case.Mode '' $false $false {
                Assert-Code { Assert-Payload } 'payload_integrity_unverified'
            }
        }
        Test-Case ($case.Name + '-remote-missing-manifest') {
            Invoke-IntegrityCase $case.Mode '' $true $true {
                Assert-Code { Assert-Payload } 'payload_integrity_unverified'
            }
        }
    }

    [IO.File]::WriteAllText($manifest, ($digest + '  bin.mjs' + "`n"), $encoding)
    foreach ($case in @($inspection + $mutating)) {
        Test-Case ($case.Name + '-verified-stamped-flow') {
            Invoke-IntegrityCase $case.Mode 'v2.2.1' $false $false {
                & $prefix
                if ((Assert-Payload) -ne 1) { throw 'verified_payload_rejected' }
            }
        }
    }
    Test-Case 'source-bypass-still-checks-present-manifest' {
        Invoke-IntegrityCase @{} '' $true $false {
            if ((Assert-Payload) -ne 1) { throw 'manifest_not_checked' }
        }
    }
    foreach ($case in @($inspection + $mutating)) {
        Test-Case ($case.Name + '-stamped-bypass-rejected-even-with-manifest') {
            Invoke-IntegrityCase $case.Mode 'v2.2.1' $true $false {
                Assert-Code { Assert-Payload } 'payload_integrity_unverified'
            }
        }
    }
    foreach ($case in $mutating) {
        Test-Case ($case.Name + '-source-bypass-rejected-even-with-manifest') {
            Invoke-IntegrityCase $case.Mode '' $true $false {
                Assert-Code { Assert-Payload } 'payload_integrity_unverified'
            }
        }
    }
    [IO.File]::WriteAllText($manifest, (('0' * 64) + '  bin.mjs' + "`n"), $encoding)
    Test-Case 'source-bypass-cannot-ignore-digest-mismatch' {
        Invoke-IntegrityCase @{} '' $true $false { Assert-Code { Assert-Payload } 'payload_digest_mismatch' }
    }
    [IO.File]::WriteAllText($manifest, '', $encoding)
    Test-Case 'source-bypass-cannot-ignore-empty-manifest' {
        Invoke-IntegrityCase @{} '' $true $false { Assert-Code { Assert-Payload } 'payload_manifest_empty' }
    }
    [IO.File]::WriteAllText($manifest, ($digest + '  ../bin.mjs' + "`n"), $encoding)
    Test-Case 'source-bypass-cannot-ignore-path-traversal' {
        Invoke-IntegrityCase @{} '' $true $false { Assert-Code { Assert-Payload } 'payload_path_invalid' }
    }
    [IO.File]::WriteAllText($manifest, ($digest + '  missing.mjs' + "`n"), $encoding)
    Test-Case 'source-bypass-cannot-ignore-missing-file' {
        Invoke-IntegrityCase @{} '' $true $false { Assert-Code { Assert-Payload } 'payload_file_missing' }
    }
    [IO.File]::WriteAllText((Join-Path $fixture 'other.txt'), 'inert companion', $encoding)
    $otherDigest = (Get-FileHash -LiteralPath (Join-Path $fixture 'other.txt') -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText($manifest, ($otherDigest + '  other.txt' + "`n"), $encoding)
    Test-Case 'source-bypass-cannot-ignore-unlisted-entry' {
        Invoke-IntegrityCase @{} '' $true $false { Assert-Code { Assert-Payload } 'payload_incomplete' }
    }
    # Only the digest conditional is executed, never acquisition or expansion.
    foreach ($bypass in @($false, $true)) {
        Test-Case ('archive-entry-must-be-listed-bypass-' + $bypass) {
            $archive = $entry; $sums = $manifest; $archiveName = 'agent-continue-setup.zip'
            $AllowUnverifiedPayload = $bypass
            Assert-Code { & $archiveCheck } 'payload_integrity_unverified'
        }
        Test-Case ('archive-matching-digest-accepted-bypass-' + $bypass) {
            $archive = $entry; $sums = $manifest; $archiveName = 'other.txt'
            $AllowUnverifiedPayload = $bypass
            $archive = Join-Path $fixture 'other.txt'
            & $archiveCheck
        }
        Test-Case ('archive-digest-mismatch-bypass-' + $bypass) {
            $archive = $entry; $sums = $manifest; $archiveName = 'other.txt'
            $AllowUnverifiedPayload = $bypass
            Assert-Code { & $archiveCheck } 'payload_digest_mismatch'
        }
    }
    Test-Case 'integrity-error-remains-bounded' {
        if ((Get-InstallFailureCode 'payload_integrity_unverified') -cne 'payload_integrity_unverified') {
            throw 'integrity_error_lost'
        }
    }
    Test-Case 'checksum-list-pin-verifies-entire-file-before-use' {
        $ExpectedSumsSha256 = (Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash.ToLowerInvariant()
        Assert-SetupChecksumList $manifest
        $ExpectedSumsSha256 = '0' * 64
        Assert-Code { Assert-SetupChecksumList $manifest } 'payload_digest_mismatch'
        $ExpectedSumsSha256 = ''
        Assert-SetupChecksumList $manifest
    }
    foreach ($mode in @('current-account','administrator')) {
        foreach ($damage in @('none','uppercase','empty','source','override','environment','bypass','no-prompt','wrong-scope')) {
            Test-Case ('checksum-pin-closed-' + $mode + '-' + $damage) {
                $ExpectedSumsSha256 = 'a' * 64
                $script:acReleaseTag = 'v3.0.0'
                $PayloadBase = ''
                $AllowUnverifiedPayload = $false
                $PromptForConnection = $true
                $Administrator = $mode -ceq 'administrator'
                $InstallLocal = $BrowserManaged = -not $Administrator
                $prior = $env:AGENT_CONTINUE_PAYLOAD_BASE
                try {
                    $env:AGENT_CONTINUE_PAYLOAD_BASE = $null
                    switch ($damage) {
                        uppercase { $ExpectedSumsSha256 = 'A' * 64 }
                        empty { $ExpectedSumsSha256 = '' }
                        source { $script:acReleaseTag = '' }
                        override { $PayloadBase = 'https://unapproved.invalid' }
                        environment { $env:AGENT_CONTINUE_PAYLOAD_BASE = 'https://unapproved.invalid' }
                        bypass { $AllowUnverifiedPayload = $true }
                        no-prompt { $PromptForConnection = $false }
                        wrong-scope { $Administrator = $InstallLocal = $BrowserManaged = $false }
                    }
                    if ($damage -ceq 'none') { & $checkSumsArgument -ExpectedSumsSha256 $ExpectedSumsSha256 }
                    else { Assert-Code { & $checkSumsArgument -ExpectedSumsSha256 $ExpectedSumsSha256 } 'payload_integrity_unverified' }
                } finally { $env:AGENT_CONTINUE_PAYLOAD_BASE = $prior }
            }
        }
    }
} finally {
    if ([IO.Path]::GetDirectoryName($fixture) -ine [IO.Path]::GetTempPath().TrimEnd('\') -or
        [IO.Path]::GetFileName($fixture) -cnotmatch '\Aac-installer-integrity-[a-f0-9]{32}\z' -or
        ([IO.File]::GetAttributes($fixture) -band [IO.FileAttributes]::ReparsePoint)) { throw 'cleanup_target_invalid' }
    Remove-Item -LiteralPath $fixture -Recurse -Force
}
[Console]::Out.WriteLine(('windows_installer_integrity checks={0} passed={1} failed={2}' -f
    $script:checks, ($script:checks - $script:failures.Count), $script:failures.Count))
if ($script:failures.Count) { throw 'windows_installer_integrity_failed' }
