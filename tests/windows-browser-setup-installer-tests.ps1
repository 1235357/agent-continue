[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$bootstrap=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../native/bootstrap'))
$ps=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$checks=0
function Check($Value,[string]$Label){if(-not $Value){throw $Label};$script:checks++}
foreach($name in @('install.ps1','install-administrator.ps1')){
 $file=Join-Path $bootstrap $name;$tokens=$errorsFound=$null
 $ast=[Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errorsFound)
 Check (-not $errorsFound.Count) 'installer_parse'
 Check (@($ast.ParamBlock.Parameters|Where-Object{$_.Name.VariablePath.UserPath -ceq 'BrowserSetupId'}).Count -eq 1) ('missing_setup_parameter:'+ $name)
 foreach($value in @('bad',('A'*32),(('a'*32)+[char]10),('a'*32))){
  $output=& $ps -NoLogo -NoProfile -NonInteractive -File $file -BrowserSetupId $value
  Check ($LASTEXITCODE -ne 0) 'setup_id_only_in_administrator_apply'
 }
}
$entry=Join-Path $bootstrap 'install-administrator.ps1'
foreach($value in @('bad',('A'*32),(('a'*32)+[char]10))){
 $output=& $ps -NoLogo -NoProfile -NonInteractive -File $entry -Apply -BrowserSetupId $value
 Check ($LASTEXITCODE -eq 1 -and ($output|ConvertFrom-Json).status -ceq 'setup-input-invalid') 'helper_rejects_invalid_id_before_consent_or_io'
}
$output=& $ps -NoLogo -NoProfile -NonInteractive -File $entry -Apply -BrowserSetupId ('a'*32)
Check ($LASTEXITCODE -eq 1 -and ($output|ConvertFrom-Json).status -ceq 'consent-required') 'valid_setup_id_preserves_consent_gate'
$stager=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'))
foreach($action in @('Plan','EnrollBrowserOwner','InstallBrowserOwner')){
 $value=if($action -ceq 'InstallBrowserOwner'){'bad'}else{'a'*32}
 $output=& $ps -NoLogo -NoProfile -NonInteractive -File $stager -Action $action -Archive 'C:\missing-setup-fixture.zip' -ExpectedSha256 ('a'*64) -BrowserSetupId $value
 Check ($LASTEXITCODE -eq 2 -and ($output|ConvertFrom-Json).phase -ceq 'input') 'setup_id_not_accepted_on_legacy_or_invalid_install'
}
$helper=[IO.File]::ReadAllText((Join-Path $bootstrap 'install-administrator.ps1'))
$parent=[IO.File]::ReadAllText((Join-Path $bootstrap 'install.ps1'))
Check ($helper.Contains('$request.BrowserSetupId = $BrowserSetupId')) 'helper_forwards_data'
Check ($parent.Contains('$parameters.BrowserSetupId = $BrowserSetupId')) 'parent_forwards_data'
$tokens=$errorsFound=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $bootstrap 'install-administrator.ps1'),[ref]$tokens,[ref]$errorsFound)
foreach($fn in $ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst]},$true)){
 if($fn.Name -cin @('Read-AdministratorInstallSource','New-AdministratorInstallWorker')){. ([scriptblock]::Create($fn.Extent.Text))}
}
$id='a'*32;$worker=New-AdministratorInstallWorker @{BrowserSetupId=$id;Action='InstallBrowserOwner'}
$null=$worker -cmatch "FromBase64String\('(?<data>[A-Za-z0-9+/=]+)'\)"
$data=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Matches.data)))
Check ($data.BrowserSetupId -ceq $id) 'worker_embeds_identifier_as_json_data'
Check (-not $worker.Contains($id)) 'worker_no_identifier_code_interpolation'
$cmd=[IO.File]::ReadAllText((Join-Path $bootstrap 'install.cmd'))
Check ($cmd.Contains('-BrowserSetupId "%~3"')) 'cmd_passes_setup_id'
Check ($cmd.Contains('if not "%~4"=="" goto :usage')) 'cmd_refuses_extra_arguments'
Check ($cmd.Contains('if "%~3"=="" goto :guidedAdministratorLegacy')) 'cmd_retains_old_one_id_route'
[pscustomobject]@{ok=$true;checks=$checks;scope='installer-input-refusal-and-source-data-contract';actualInstall=$false;actualUac=$false}|ConvertTo-Json -Compress
