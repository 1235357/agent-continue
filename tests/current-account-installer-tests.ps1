[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$entry=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../native/bootstrap/install.ps1'))
$tokens=$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($entry,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'installer_parse'}
$checks=0
function Check($Value,[string]$Name){if(-not $Value){throw $Name};$script:checks++}
function Refuse([scriptblock]$Work,[string]$Name){$rejected=$false;try{&$Work}catch{$rejected=$true};Check $rejected $Name}
foreach($name in @('Assert-BrowserSetupContinuationInput','Get-CurrentAccountSetupPublisherSource','Publish-CurrentAccountBrowserSetup','Test-ExactJsonProperties')){
 $fn=$ast.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true)
 Check ($null -ne $fn) ('missing_function:'+ $name)
 . ([scriptblock]::Create($fn.Extent.Text))
}
$id='a'*32;$extension='b'*32
$current=@{Id=$id;Administrator=$false;Apply=$false;InstallLocal=$true;BrowserManaged=$true;PromptForConnection=$true;Consent='accept-install'}
Assert-BrowserSetupContinuationInput @current
foreach($change in @(@{InstallLocal=$false},@{BrowserManaged=$false},@{PromptForConnection=$false},@{Apply=$true},
 @{Consent='accept-control'},@{Id='bad'},@{Id=('A'*32)},@{Id=($id+[char]10)})){
 $input=@{}+$current;foreach($key in $change.Keys){$input[$key]=$change[$key]}
 Refuse {Assert-BrowserSetupContinuationInput @input} 'reject_nonclosed_current_scope'
}
Assert-BrowserSetupContinuationInput -Id $id -Administrator $true -Apply $true
Refuse {Assert-BrowserSetupContinuationInput -Id $id -Administrator $true -Apply $false} 'administrator_still_requires_apply'
$script:acPayloadRoot='C:\inert-payload';$script:acNode='Invoke-SyntheticPublisher'
$InstallDir='C:\inert-install';$ExtensionId=$extension;$BrowserSetupId=$id
$script:nodeCalls=0;$script:nodeArguments=$null;$script:proofChange=@{}
function Invoke-SyntheticPublisher {
 $script:nodeCalls++;$script:nodeArguments=@($args);$global:LASTEXITCODE=0
 $proof=@{setupId=$id;state='installed';scope='current-account';extensionId=$extension;bindingSha256=('c'*64)}
 foreach($key in $script:proofChange.Keys){$proof[$key]=$script:proofChange[$key]}
 $proof|ConvertTo-Json -Compress
}
$registration=@{ok=$true;status='written';host='com.agentcontinue.device_wake';registered=$true;launchVerified=$false;activated=$false;chatAuthorizationVerified=$false}
$installed=@{ok=$true;action='install-local';mode='browser-managed';configured=$true;registered=$true;connected=$false;
 browserLaunchVerified=$false;chatAuthorizationVerified=$false;registration=$registration}
$json=$installed|ConvertTo-Json -Compress
$null=Publish-CurrentAccountBrowserSetup $json
Check ($script:nodeCalls -eq 1) 'one_fixed_publisher_after_fresh_result'
Check ($script:nodeArguments[0] -ceq '--input-type=module' -and $script:nodeArguments[1] -ceq '-e') 'publisher_is_fixed_module_source'
Check ($script:nodeArguments[-2] -ceq $extension -and $script:nodeArguments[-1] -ceq $id) 'extension_and_setup_are_argument_data'
$source=Get-CurrentAccountSetupPublisherSource
Check ($source.Contains('verifyProviderStage') -and $source.IndexOf('await verifyProviderStage') -lt $source.IndexOf("'device-owner.mjs'")) 'verified_before_installed_import'
Check ($source.Contains('publishCurrentAccountSetupReceipt') -and -not $source.Contains('startDeviceOwner') -and -not $source.Contains('reconnect(')) 'publisher_cannot_connect'
$source | node --check --input-type=module
Check ($LASTEXITCODE -eq 0) 'fixed_publisher_source_parses_without_execution'
foreach($change in @(@{action='existing-install'},@{mode='command-only'},@{connected=$true},@{registered=$false},@{ok='true'})){
 $value=@{}+$installed;foreach($key in $change.Keys){$value[$key]=$change[$key]}
 $before=$script:nodeCalls;Refuse {Publish-CurrentAccountBrowserSetup ($value|ConvertTo-Json -Compress)} 'reject_nonfresh_result'
 Check ($script:nodeCalls -eq $before) 'nonfresh_does_not_invoke_publisher'
}
foreach($change in @(@{scope='administrator'},@{setupId=('d'*32)},@{extensionId=('d'*32)},@{extra=$true},@{bindingSha256='bad'})){
 $script:proofChange=$change;Refuse {Publish-CurrentAccountBrowserSetup $json} 'reject_mismatched_publication_projection'
}
$raw=[IO.File]::ReadAllText($entry)
$existing=$raw.IndexOf('if ($InstallLocal -and $BrowserManaged -and $script:acExistingBrowserInstall)')
$publish=$raw.LastIndexOf('$null = Publish-CurrentAccountBrowserSetup $output')
Check ($existing -ge 0 -and $publish -ge 0 -and $existing -lt $publish) 'existing_install_returns_before_publication'
[pscustomobject]@{ok=$true;checks=$checks;scope='parser-pure-input-and-mocked-publisher';actualInstall=$false;actualRegistry=$false}|ConvertTo-Json -Compress
