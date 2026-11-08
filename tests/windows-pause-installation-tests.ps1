[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$tokens=$parseErrors=$null
$source=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'))
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'stager_parse'}
$script:checks=0
function Check($Value,[string]$Label){if(-not $Value){throw $Label};$script:checks++}
function Refuse([scriptblock]$Run,[string]$Label){$threw=$false;try{& $Run|Out-Null}catch{$threw=$true};Check $threw $Label}
$names=@('Assert-AdministratorInstallationPauseParameters','Invoke-AdministratorInstallationPauseAction',
 'New-AdministratorInstallationPauseLaunchPlan','Invoke-AdministratorInstallationPause',
 'Get-AdministratorInstallationPauseBinding','Request-AdministratorOwnerPause','Test-AdministratorBrowserPauseTarget',
 'Invoke-AdministratorControlOperation','Complete-AdministratorOwnerPause')
foreach($name in $names){
 $defs=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true))
 Check ($defs.Count -eq 1) ('missing_api:'+ $name)
 . ([scriptblock]::Create($defs[0].Extent.Text))
}
$script:digest='a'*64;$script:id='b'*32;$script:sid='S-1-5-21-1-2-3-1001';$script:extension='c'*32
$script:origin='chrome-extension://'+$extension+'/'
$script:root='C:\fixture-only\'+$digest.Substring(0,24)
$script:binding=@{Root=$root;Digest=$digest;Sid=$sid;Origin=$origin;System='C:\Windows\System32';
 Stager=$root+'.browser\stager.ps1';Archive=$root+'.browser\bundle.zip'}
$script:bound=@('Action','Archive','ExpectedSha256','BrowserExtensionId')
$script:scratch=Join-Path ([IO.Path]::GetTempPath()) ('ac-pause-installation-'+[Guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($scratch)
$script:guardPath=Join-Path $scratch 'guard'
[IO.File]::WriteAllText($guardPath,'scratch-only')
function Assert-AdministratorOwnerControlIdentity($Root,$Digest,$Sid){
 Check ($Root -ceq $script:root -and $Digest -ceq $script:digest -and $Sid -ceq $script:sid) 'bound_installation_identity'
}
function Assert-AdministratorControlEndpointBinding($Binding){
 Check ($Binding.Origin -ceq $script:origin -and $Binding.Digest -ceq $script:digest -and $Binding.Sid -ceq $script:sid) 'bound_origin_sid_bundle'
 $other=$null;$held=$false
 try{$other=[IO.File]::Open($script:guardPath,'Open','ReadWrite','None')}catch [IO.IOException]{$held=$true}
 finally{if($other){$other.Dispose()}}
 Check $held 'binding_identity_rechecked_under_exclusive_control_gate'
 if($script:bindingDenied){throw 'fixture_binding_denied'}
 $script:verified++
 if($script:falseBinding){return $false}
 return $true
}
function Open-AdministratorOwnerControl {return [IO.File]::Open($script:guardPath,'Open','ReadWrite','None')}
function Read-AdministratorOwnerControlRevision {return $script:revision}
function Write-AdministratorOwnerControlRevision($Gate,$Revision){$script:revision=if($Revision){$Revision}else{'f'*32};$script:revisionWrites++}
function Write-AdministratorOwnerIntent($Root,$Paused){$script:paused=$Paused;$script:intentWrites++}
function Test-AdministratorOwnerIntent($Root,$Paused){return $script:paused -eq $Paused}
function Test-AdministratorOwnerRunIntent {return -not $script:paused -and -not $script:revoked}
function Test-AdministratorOwnerInnerLeasesClear {return $script:generation -ceq 'idle'}
function Get-AdministratorPauseGeneration {return $script:generation}
function Test-AdministratorOwnerAbsent($Path){
 $name=[IO.Path]::GetFileName($Path)
 if($name -ceq 'owner-revoked'){return -not $script:revoked}
 if($name -cmatch '\Apause-([a-f0-9]{32})\.reserved\.json\z'){return -not $script:reserved.ContainsKey($Matches[1])}
 return $true
}
function Ensure-SealedDirectory {}
function Update-AdministratorBrowserPauseTarget {}
function Publish-AdministratorPauseReservation($Vault,$Digest,$Id,$Generation){$script:reserved[$Id]=$Generation}
function Publish-AdministratorOwnerPause($Status,$Digest,$Sid,$Id,$State){$script:receipts[$Id]=$State}
function Read-AdministratorOwnerPause($Status,$Digest,$Sid,$Id){
 $state=if($script:receipts.ContainsKey($Id)){$script:receipts[$Id]}else{'unconfirmed'}
 return @{operationId=$Id;state=$state}
}
function Get-AdministratorPauseReservationBytes {return ,([byte[]]@(1))}
function Assert-AdministratorOwnerBytes {}
function Reset {
 $script:revision='d'*32;$script:generation='idle';$script:paused=$false;$script:revoked=$false
 $script:reserved=@{};$script:receipts=@{};$script:controlReceipts=@{};$script:records=@{};$script:phases=@{}
 $script:intentWrites=0;$script:revisionWrites=0;$script:verified=0;$script:bindingDenied=$false;$script:falseBinding=$false;$script:starts=0
}
function Invoke-Medium($Action,$Id=''){
 $keys=@($script:bound);if($Id){$keys+='PauseOperationId'}
 Invoke-AdministratorInstallationPauseAction $Action $script:digest $Id $script:extension $keys {return $script:binding} {
  param($Plan)
  $script:starts++;Check ($Plan.Verb -ceq 'runas' -and $Plan.WindowStyle -eq 'Hidden') 'one_fixed_hidden_uac'
  Check ($Plan.Arguments.Contains('-Action PauseBrowserHostedOwnerInstallation') -and -not $Plan.Arguments.Contains('Target')) 'fixed_untargeted_high_action'
  return $true
 }
}
try{
 foreach($action in @('CheckBrowserHostedOwnerInstallationPause','RequestBrowserHostedOwnerInstallationPause',
   'ObserveBrowserHostedOwnerInstallationPause','PauseBrowserHostedOwnerInstallation')){
  $keys=@($bound);$op='';$sidArgument='';$consent=''
  if($action -cne 'CheckBrowserHostedOwnerInstallationPause'){$keys+='PauseOperationId';$op=$id}
  if($action -ceq 'PauseBrowserHostedOwnerInstallation'){$keys+=@('ExpectedUserSid','Consent');$sidArgument=$sid;$consent='pause-browser-administrator-installation'}
  Assert-AdministratorInstallationPauseParameters $action $keys $digest $op $extension $sidArgument $consent
  foreach($extra in @('BrowserPauseTarget','BrowserControlTarget','ControlKind','BrowserWake','RuntimeKeyFile','ControlCallerPid')){
   Refuse {Assert-AdministratorInstallationPauseParameters $action @($keys+$extra) $digest $op $extension $sidArgument $consent} 'closed_parameter_set'
  }
  foreach($key in $keys){Refuse {Assert-AdministratorInstallationPauseParameters $action @($keys|Where-Object{$_ -cne $key}) $digest $op $extension $sidArgument $consent} 'required_parameter'}
  Refuse {Assert-AdministratorInstallationPauseParameters $action $keys ('A'*64) $op $extension $sidArgument $consent} 'closed_digest'
  Refuse {Assert-AdministratorInstallationPauseParameters $action $keys $digest $op ($extension+[char]10) $sidArgument $consent} 'closed_origin'
 }
 Refuse {Assert-AdministratorInstallationPauseParameters 'PauseHostedOwner' $bound $digest '' $extension} 'no_legacy_route'
 Reset
 Check ((Invoke-Medium 'CheckBrowserHostedOwnerInstallationPause').state -ceq 'supported') 'capability_read_only'
 Check ($starts -eq 0 -and $intentWrites -eq 0) 'support_no_uac_or_mutation'
 Check ((Invoke-Medium 'RequestBrowserHostedOwnerInstallationPause' $id).state -ceq 'requested') 'request_launch_only'
 Check ($starts -eq 1 -and $intentWrites -eq 0) 'one_launch_not_effect'
 $script:receipts[$id]='pause-recorded'
 Check ((Invoke-Medium 'RequestBrowserHostedOwnerInstallationPause' $id).state -ceq 'pause-recorded') 'known_duplicate_readback'
 Check ($starts -eq 1) 'known_duplicate_no_uac'
 Check ((Invoke-Medium 'ObserveBrowserHostedOwnerInstallationPause' $id).state -ceq 'pause-recorded') 'new_status_readback'
 Reset
 $script:revision='1'*32
 $r=Invoke-AdministratorInstallationPause $binding $id $extension
 Check ($r.state -ceq 'stopped' -and $paused -and $revision -ceq $id) 'connect_C_then_installation_P_wins'
 Check (-not (Test-AdministratorOwnerRunIntent)) 'C_cannot_start_after_P'
 $writes=$intentWrites;$rotations=$revisionWrites
 $script:revision='2'*32;$script:paused=$false
 $r=Invoke-AdministratorInstallationPause $binding $id $extension
 Check ($r.state -ceq 'stopped' -and -not $paused -and $revision -ceq ('2'*32)) 'duplicate_preserves_newer_authority'
 Check ($intentWrites -eq $writes -and $revisionWrites -eq $rotations) 'duplicate_has_no_effects'
 Reset
 $script:generation='3'*32
 $r=Invoke-AdministratorInstallationPause $binding $id $extension
 Check ($r.state -ceq 'pause-recorded' -and $paused -and $reserved[$id] -ceq $generation) 'active_job_pause_pending'
 $gate=Open-AdministratorOwnerControl
 try{
  Complete-AdministratorOwnerPause ($root+'.state') ($root+'.secrets') ($root+'.status') $digest $sid $generation $gate
  Check ($receipts[$id] -ceq 'pause-recorded') 'active_job_not_stopped_early'
  $oldGeneration=$generation;$script:generation='idle'
  Complete-AdministratorOwnerPause ($root+'.state') ($root+'.secrets') ($root+'.status') $digest $sid $oldGeneration $gate
  Check ($receipts[$id] -ceq 'stopped') 'settled_job_stopped_receipt'
 }finally{$gate.Dispose()}
 Reset;$script:revoked=$true
 $r=Invoke-AdministratorInstallationPause $binding $id $extension
 Check ($paused -and $revoked -and -not (Test-AdministratorOwnerRunIntent)) 'pause_never_clears_revoke'
 Reset;$script:bindingDenied=$true
 Refuse {Invoke-AdministratorInstallationPause $binding $id $extension} 'binding_rechecked_under_gate'
 Check ($intentWrites -eq 0 -and $reserved.Count -eq 0) 'failed_binding_no_effects'
 Reset;$script:falseBinding=$true
 Refuse {Invoke-AdministratorInstallationPause $binding $id $extension} 'false_binding_is_not_authorization'
 Check ($intentWrites -eq 0 -and $reserved.Count -eq 0) 'false_binding_no_effects'
 Reset
 foreach($field in @('Digest','Sid','Origin')){
  $foreign=$binding.Clone();$foreign[$field]=if($field -ceq 'Digest'){'e'*64}elseif($field -ceq 'Sid'){'S-1-5-21-1-2-3-1002'}else{'chrome-extension://'+('e'*32)+'/'}
  Refuse {Invoke-AdministratorInstallationPause $foreign $id $extension} 'foreign_installation_denied'
 }
 Check ($intentWrites -eq 0 -and $reserved.Count -eq 0) 'foreign_identity_no_effects'
 Reset
 $requestKeys=@($bound+'PauseOperationId')
 foreach($errorCode in @(1223,5)){
  $row=Invoke-AdministratorInstallationPauseAction 'RequestBrowserHostedOwnerInstallationPause' $digest $id $extension $requestKeys {return $script:binding} {
   throw [ComponentModel.Win32Exception]::new($errorCode)
  }
  Check ($row.state -ceq $(if($errorCode -eq 1223){'cancelled'}else{'unconfirmed'})) 'uac_cancel_or_failure_no_retry'
 }
 foreach($action in @('CheckBrowserHostedOwnerInstallationPause','ObserveBrowserHostedOwnerInstallationPause')){
  $keys=if($action -ceq 'CheckBrowserHostedOwnerInstallationPause'){$bound}else{$requestKeys}
  $op=if($action -ceq 'CheckBrowserHostedOwnerInstallationPause'){''}else{$id}
  $row=Invoke-AdministratorInstallationPauseAction $action $digest $op $extension $keys {throw 'binding_lost'} {throw 'read_only_must_not_start'}
  Check ($row.state -ceq 'unconfirmed') 'read_only_binding_failure_closed'
 }
 # The new medium binding composes both existing authenticators, without reading a startup target.
 function Get-AdministratorBrowserPauseTarget($Archive,$Digest,$Script,$ProgramFiles,$System,$Identity){
  Check ($Identity -is [scriptblock]) 'existing_medium_identity_check_retained'
  return $script:binding.Clone()
 }
 function Get-AdministratorBrowserSetupBinding($Archive,$Digest,$Script,$ProgramFiles,$System,$Sid,$Extension){
  Check ($Sid -ceq $script:sid -and $Extension -ceq $script:extension) 'setup_binding_selected_sid_origin'
  return @{Root=$script:root;Digest=$script:digest;Sid=$script:sid;Origin=$script:origin}
 }
 $actualBinding=Get-AdministratorInstallationPauseBinding $binding.Archive $digest $binding.Stager 'C:\Program Files' $binding.System $extension
 Check ($actualBinding.Origin -ceq $origin -and $actualBinding.Digest -ceq $digest) 'actual_composed_medium_binding'
 Reset
 $script:reserved[$id]='unknown'
 $r=Invoke-AdministratorInstallationPause $binding $id $extension
 Check ($r.state -ceq 'unconfirmed' -and $intentWrites -eq 0) 'interrupted_reservation_no_replay'
 # Extract the actual Connect transaction too; Pause commits in its post-gate task callback.
 function Assert-AdministratorControlIdentity {}
 function Get-AdministratorControlReservationBytes {}
 function Open-AdministratorControlExecution {return [IO.MemoryStream]::new()}
 function Read-AdministratorControlRecord($Vault,$Digest,$Sid,$Origin,$Id,$Control,[switch]$Tombstone){if(-not $Tombstone){return $script:records[$Id]}}
 function Reserve-AdministratorControlOperation($Vault,$Digest,$Sid,$Origin,$Id,$Control,$Target){$script:records[$Id]=@{target=$Target};return $true}
 function Read-AdministratorControlReceipt($Status,$Digest,$Sid,$Id,$Control){return @{state=$script:controlReceipts[$Id]}}
 function Publish-AdministratorControlReceipt($Status,$Digest,$Sid,$Id,$Control,$State){$script:controlReceipts[$Id]=$State}
 function Read-AdministratorControlPhase($Vault,$Digest,$Sid,$Id,$Control,$Phase){return $script:phases[$Id+':'+$Phase]}
 function Publish-AdministratorControlPhase($Vault,$Digest,$Sid,$Origin,$Id,$Control,$Phase){$script:phases[$Id+':'+$Phase]=@{phase=$Phase}}
 function Publish-AdministratorControlProgress {}
 Reset;$script:paused=$true;$script:connect='4'*32;$script:taskAdmission=$null
 $target=$revision+':idle'
 $result=Invoke-AdministratorControlOperation $root $digest $sid $origin $connect 'connect' $target @{} @{} {} {} {$true} {
  Check ($script:revision -ceq $script:connect -and -not $script:paused) 'actual_Connect_committed_C'
  $null=Invoke-AdministratorInstallationPause $script:binding $script:id $script:extension
  $script:taskAdmission=Test-AdministratorOwnerRunIntent
  return $true
 }
 Check ($paused -and $revision -ceq $id -and $taskAdmission -eq $false) 'A_idle_C_commit_P_task_denied'
 Check ($controlReceipts[$connect] -ceq 'launch-requested') 'launch_receipt_not_readiness_or_authority'
 # Legacy targeted Pause still refuses the same stale A snapshot.
 Reset;$script:revision='4'*32
 $r=Request-AdministratorOwnerPause $root $digest $sid $id (('d'*32)+':idle') {}
 Check ($r.state -ceq 'superseded' -and -not $paused -and $intentWrites -eq 0) 'targeted_semantics_preserved'
 $entry=@($ast.EndBlock.Statements|Where-Object{$_ -is [Management.Automation.Language.IfStatementAst] -and $_.Extent.Text.Contains("'CheckBrowserHostedOwnerInstallationPause'")})
 Check ($entry.Count -eq 1) 'distinct_early_installation_entry'
 Check ($entry[0].Extent.EndOffset -lt [IO.File]::ReadAllText($source).IndexOf('$inputStream = [IO.File]::Open($Archive')) 'new_entry_no_legacy_dispatch'
 $pause=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Invoke-AdministratorInstallationPause'},$true))[0].Extent.Text
 Check ($pause.Contains('Request-AdministratorOwnerPause') -and -not $pause.Contains('BrowserPauseTarget')) 'actual_untargeted_durable_pause'
 foreach($check in @('Get-AdministratorControlEndpointBinding','Read-AdministratorBrowserPauseAssetHash','Invoke-AdministratorInstallationPause')){
  Check ($entry[0].Extent.Text.Contains($check)) ('high_entry_keeps_auth:'+ $check)
 }
 Check ($entry[0].Extent.Text.Contains("'Desktop'") -and $entry[0].Extent.Text.Contains('Is64BitProcess')) 'entry_desktop_x64_only'
 [pscustomobject]@{ok=$true;checks=$checks;scope='AST-extracted-control-pause-and-settlement-with-scratch-gate-and-binding-task-UAC-stubs';actualUac=$false;productionRead=$false}|ConvertTo-Json -Compress
}finally{
 $resolved=[IO.Path]::GetFullPath($scratch)
 if([IO.Path]::GetDirectoryName($resolved).TrimEnd('\') -cne [IO.Path]::GetTempPath().TrimEnd('\') -or
  [IO.Path]::GetFileName($resolved) -cnotmatch '\Aac-pause-installation-[a-f0-9]{32}\z'){throw 'cleanup_scope'}
 [IO.File]::Delete($guardPath);[IO.Directory]::Delete($resolved)
}
