# Execute extracted read-only boundaries with fixture files and process stubs only.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
$source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../native/bootstrap/install.ps1'))
$tokens = $errorsFound = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errorsFound)
if ($errorsFound.Count) { throw 'installer_parse_failed' }
$functions = @($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$true))
foreach ($name in @('Test-ExistingBrowserInstall','Assert-BrowserWakeInstallPath','Invoke-ExistingBrowserInstallation','Assert-ExistingBrowserResult','Get-AdjacentSetupArchive','Assert-FileDigest','Expand-VerifiedSetupArchive')) {
    $fn = @($functions | Where-Object Name -CEQ $name)
    if ($fn.Count -ne 1) { throw ('missing_read_only_boundary_' + $name) }
    . ([scriptblock]::Create($fn[0].Extent.Text))
}
$checks = 0
function Check($Value,[string]$Label) { if (-not $Value) { throw $Label }; $script:checks++ }
$root = Join-Path ([IO.Path]::GetTempPath()) ('ac-current-adoption-ps-' + [Guid]::NewGuid().ToString('N'))
$pkg = Join-Path $root 'package'; $install = Join-Path $root 'installed'
[IO.Directory]::CreateDirectory($pkg) | Out-Null
[IO.Directory]::CreateDirectory($install) | Out-Null
[IO.File]::WriteAllText((Join-Path $pkg 'bin.mjs'),'inert fixture, never executed')
[IO.File]::WriteAllText((Join-Path $pkg 'payload-manifest.json'),'inert manifest')
$extension = 'a' * 32
$script:nodeCalls = $script:payloadCalls = $script:bootstrapCalls = 0
$script:status = 'existing-matched'; $script:invalidResult = $false
function Resolve-Payload { throw 'unexpected_payload_acquisition' }
function Read-GuidedValue { throw 'unexpected_credential_prompt' }
function Resolve-GuidedFile { throw 'unexpected_credential_read' }
function Install-PortableNode { throw 'unexpected_node_provisioning' }
function Assert-Payload { $script:payloadCalls++; return 1 }
function Resolve-Node { $script:nodeCalls++; return @{Path='C:\fixture\node.exe';Version='22.23.4'} }
function Invoke-Bootstrap([string[]]$Arguments) {
    $script:bootstrapCalls++
    Check (($Arguments -join '|') -ceq ('browser-install-status|--install-dir|'+$install+'|--extension-id|'+$extension)) 'closed_inspection_arguments'
    $matched = $script:status -ceq 'existing-matched'
    $row = @{ok=$matched;action='existing-install';mode='browser-managed';status=$script:status;reason='verified';extensionId=$extension;
        payloadManifestSha256=$(if ($matched) {(Get-FileHash -LiteralPath (Join-Path $pkg 'payload-manifest.json')).Hash.ToLowerInvariant()} else {$null});configuration=$(if ($matched) {'verified'} else {'unconfirmed'});
        registration=$(if ($matched) {'matched'} else {'unconfirmed'});runtime='not-observed';mutationPerformed=$false;chatAuthorizationVerified=$false;
        next=$(if ($matched) {'open-devices'} else {'review-existing-installation'});
        devicesUrl=$(if ($matched) {'chrome-extension://'+$extension+'/devices.html?mode=browser-managed'} else {$null})}
    if ($script:invalidResult) { $row.extensionId = 'c'*32 }
    return ConvertTo-Json -InputObject $row -Compress
}
try {
    Check (Test-ExistingBrowserInstall $install) 'existing_root_detected'
    Check (-not (Test-ExistingBrowserInstall (Join-Path $root 'absent'))) 'missing_root_not_adopted'
    Assert-BrowserWakeInstallPath 'C:\Users\example\AgentContinue'
    $badRoot = 'C:\Users\' + [char]0x7528 + '\AgentContinue'
    $refused = $false
    try { Assert-BrowserWakeInstallPath $badRoot } catch { $refused = $_.Exception.Message -ceq 'browser_wake_invalid_install' }
    Check $refused 'non_ascii_launcher_path_refused'
    foreach ($paused in @($true,$false)) {
        [IO.File]::WriteAllText((Join-Path $install 'lifecycle.json'),('{"paused":'+$paused.ToString().ToLowerInvariant()+'}'))
        [IO.File]::WriteAllText((Join-Path $install 'owner-revoked'),'retained')
        $before = (Get-FileHash -LiteralPath (Join-Path $install 'lifecycle.json')).Hash
        $result = Invoke-ExistingBrowserInstallation $install $extension $pkg
        Check ($result -is [hashtable]) 'existing_result_compatible_with_parent_writer'
        Check ($result.ok -and $result.status -ceq 'existing-matched' -and $result.next -ceq 'open-devices') 'compatible_existing_result'
        Check (-not $result.mutationPerformed -and $result.runtime -ceq 'not-observed') 'no_readiness_or_mutation_claim'
        Check ((Get-FileHash -LiteralPath (Join-Path $install 'lifecycle.json')).Hash -ceq $before) 'lifecycle_preserved'
        Check ([IO.File]::ReadAllText((Join-Path $install 'owner-revoked')) -ceq 'retained') 'revocation_preserved'
    }
    foreach ($value in @('existing-incompatible','existing-partial','existing-denied','existing-unconfirmed')) {
        $script:status = $value
        $result = Invoke-ExistingBrowserInstallation $install $extension $pkg
        Check (-not $result.ok -and $result.status -ceq $value -and -not $result.mutationPerformed) 'failure_class_preserved_without_fallback'
    }
    $script:status='existing-matched'; $script:invalidResult=$true
    $result=Invoke-ExistingBrowserInstallation $install $extension $pkg
    Check (-not $result.ok -and $result.status -ceq 'existing-unconfirmed') 'another_extension_result_never_promoted'
    $script:invalidResult=$false
    $result=Invoke-ExistingBrowserInstallation $install $extension (Join-Path $root 'archive-only')
    Check (-not $result.ok -and $result.status -ceq 'existing-unconfirmed') 'missing_local_inspection_source_never_downloaded'
    $text=[IO.File]::ReadAllText($source)
    Check ($text.Contains("if (`$Apply -and (Test-Path -LiteralPath `$InstallDir)) { throw 'destination_exists' }")) 'fresh_guard_retained'
    $dispatch=$text.IndexOf('Invoke-ExistingBrowserInstallation $InstallDir $ExtensionId $PSScriptRoot',[StringComparison]::Ordinal)
    Check ($dispatch -gt 0 -and $dispatch -lt $text.IndexOf('# Reject a repeated install',[StringComparison]::Ordinal)) 'adoption_before_final_fresh_guard'
    Check ($text.IndexOf('Assert-BrowserWakeInstallPath $InstallDir',[StringComparison]::Ordinal) -lt
        $text.IndexOf("`$TunnelId = Read-GuidedValue",[StringComparison]::Ordinal)) 'launcher_preflight_before_prompts'
    $inputGate = @($ast.FindAll({param($n)
        $n -is [Management.Automation.Language.IfStatementAst] -and $n.Clauses[0].Item1.Extent.Text -ceq '$InstallLocal' -and
        $n.Extent.Text.Contains('$script:acExistingBrowserInstall = Test-ExistingBrowserInstall')
    },$true))
    Check ($inputGate.Count -eq 1) 'bounded_current_input_gate'
    $InstallLocal=$BrowserManaged=$PromptForConnection=$true
    $Consent='accept-install';$InstallDir=$install;$ExtensionId=$extension
    $Verify=$Uninstall=$ManagerOnly=$PrepareNative=$RegisterNative=$false
    $Apply=$false;$NodePath=$SetupRequest=$TunnelId=$RuntimeKeyFile=''
    $script:acExistingBrowserInstall=$false
    . ([scriptblock]::Create($inputGate[0].Extent.Text))
    Check ($script:acExistingBrowserInstall -and $Apply -and -not $RuntimeKeyFile -and -not $TunnelId) 'existing_input_gate_never_prompts_or_reads_credentials'
    $InstallDir=$badRoot;$Apply=$false;$refused=$false
    try { . ([scriptblock]::Create($inputGate[0].Extent.Text)) }
    catch { $refused=$_.Exception.Message -ceq 'browser_wake_invalid_install' }
    Check $refused 'actual_fresh_input_gate_refuses_non_ascii_before_prompt'
    $script:status='existing-matched';$script:invalidResult=$false
    $script:fixtureOutput=Invoke-Bootstrap @('browser-install-status','--install-dir',$install,'--extension-id',$extension)
    function Invoke-InertAdoptionNode { $global:LASTEXITCODE=1; return $script:fixtureOutput }
    function Get-BootstrapFailureCode { return 'bootstrap_failed_exit_1' }
    $realBootstrap=@($functions | Where-Object Name -CEQ 'Invoke-Bootstrap')
    . ([scriptblock]::Create($realBootstrap[0].Extent.Text))
    $script:acNode='Invoke-InertAdoptionNode';$refused=$false
    try { $null=Invoke-Bootstrap @('browser-install-status','--install-dir',$install,'--extension-id',$extension) }
    catch { $refused=$_.Exception.Message -ceq 'bootstrap_failed_exit_1' }
    Check $refused 'failed_child_cannot_promote_matched_json'
} finally {
    if ([IO.Path]::GetDirectoryName($root) -ine [IO.Path]::GetTempPath().TrimEnd('\') -or
        [IO.Path]::GetFileName($root) -cnotmatch '\Aac-current-adoption-ps-[a-f0-9]{32}\z') { throw 'cleanup_target_invalid' }
    Remove-Item -LiteralPath $root -Recurse -Force
}
[pscustomobject]@{ok=$true;checks=$checks;actualRegistry=$false;actualRuntime=$false;scope='extracted-current-adoption-boundaries'} | ConvertTo-Json -Compress
