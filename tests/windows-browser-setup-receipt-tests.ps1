[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$stager=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'))
$tokens=$errorsFound=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($stager,[ref]$tokens,[ref]$errorsFound)
if($errorsFound.Count){throw 'stager_parse'}
$script:checks=0
function Check($Value,[string]$Label){if(-not $Value){throw $Label};$script:checks++}
function Refuse([scriptblock]$Run,[string]$Label){$threw=$false;try{& $Run|Out-Null}catch{$threw=$true};Check $threw $Label}
$names=@('Assert-AdministratorBrowserSetupParameters','Get-AdministratorBrowserSetupReceiptBytes',
 'Read-AdministratorBrowserSetupReceipt','Read-AdministratorBrowserSetupStatus','Get-AdministratorBrowserSetupBinding',
 'Get-AdministratorBrowserSetupTarget','Publish-AdministratorBrowserSetupReceipt',
 'Publish-AdministratorBrowserEnrollment','Read-AdministratorControlBytes',
 'Read-AdministratorBrowserControlSupportProjection','Read-AdministratorBrowserPauseTargetProjection',
 'Test-AdministratorBrowserPauseTarget','Read-AdministratorBrowserCommit','Test-AdministratorControlFields')
foreach($name in $names){
 $defs=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true))
 Check ($defs.Count -eq 1) ('missing_api:'+ $name)
 . ([scriptblock]::Create($defs[0].Extent.Text))
}
$script:digest='a'*64;$script:setup='b'*32;$script:sid='S-1-5-21-1-2-3-1001'
$script:extension='c'*32;$script:origin='chrome-extension://'+$extension+'/'
$script:target=('d'*32)+':idle';$script:other=('e'*32)+':idle'
$script:scratch=Join-Path ([IO.Path]::GetTempPath()) ('ac-setup-'+[Guid]::NewGuid().ToString('N'))
$script:programFiles=Join-Path $scratch 'ProgramFiles'
$script:root=Join-Path (Join-Path $programFiles 'AgentContinueAdmin') $digest.Substring(0,24);$script:bridge=$root+'.browser'
$script:system='C:\Windows\System32';$script:anchorCalls=0;$script:registryCalls=0;$script:registryFailure=$false
$script:bound=@('Action','Archive','ExpectedSha256','BrowserSetupId','BrowserExtensionId')
$script:aclFailure='';$script:aclCalls=[Collections.Generic.List[string]]::new()
function Assert-SealedAcl($Path,$Directory,$Private=$false,$ReaderSid='S-1-5-32-545'){
 $script:aclCalls.Add($Path)
 if($script:aclFailure -and $Path.EndsWith($script:aclFailure,[StringComparison]::Ordinal)){throw 'fixture_acl_denied'}
 Check (-not ([IO.File]::GetAttributes($Path) -band [IO.FileAttributes]::ReparsePoint)) 'redirected_asset'
}
function Test-AdministratorOwnerAbsent($Path){return -not ([IO.File]::Exists($Path) -or [IO.Directory]::Exists($Path))}
function Assert-AdministratorBrowserPauseAnchors($ProgramFiles,$System){$script:anchorCalls++}
function Assert-AdministratorBrowserRegistry($Plan,$Published){
 $script:registryCalls++;Check $Published 'registry_read_only_published'
 Check ($Plan.Manifest -ceq (Join-Path $script:bridge 'host.json') -and $Plan.Sid -ceq $script:sid) 'fixed_registry_identity'
 if($script:registryFailure){throw 'registry_unenrolled'}
}
function Open-AdministratorOwnerControl($Vault){return [IO.File]::Open((Join-Path $scratch 'guard'),'Open','ReadWrite','None')}
function Read-AdministratorOwnerControlRevision($Gate){return 'd'*32}
function Write-AdministratorBrowserAsset($File,$Bytes,$Sid,$Private=$false){
 Check ($Sid -ceq $script:sid -and -not $Private) 'receipt_uses_selected_sid_readable_sealed_asset'
 $blocked=$false;$other=$null
 try{$other=[IO.File]::Open((Join-Path $scratch 'guard'),'Open','ReadWrite','None')}catch [IO.IOException]{$blocked=$true}
 finally{if($other){$other.Dispose()}}
 Check $blocked 'publisher_holds_enrollment_gate'
 $stream=[IO.File]::Open($File,'CreateNew','Write','None')
 try{$stream.Write($Bytes,0,$Bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
}
function Reset{
 $script:aclFailure='';$script:aclCalls.Clear()
 [IO.File]::WriteAllText((Join-Path $bridge 'enrolled.json'),('{"version":1,"bundleSha256":"'+$digest+'"}'))
 [IO.File]::WriteAllText((Join-Path ($root+'.status') 'pause-target.json'),('{"version":1,"bundleSha256":"'+$digest+'","target":"'+$target+'"}'+[char]10))
 [IO.File]::WriteAllText((Join-Path ($root+'.status') 'control-owner.json'),('{"version":1,"bundleSha256":"'+$digest+'","target":"'+$target+'","ownerState":"paused"}'+[char]10))
 [IO.File]::WriteAllBytes((Join-Path $bridge 'setup-receipt.json'),(Get-AdministratorBrowserSetupReceiptBytes $setup $digest $origin $target))
}
function Observe{
 Read-AdministratorBrowserSetupStatus 'ObserveBrowserSetup' $bound $digest $setup $extension {
  Read-AdministratorBrowserCommit $script:bridge $script:digest $script:sid
  return @{Root=$script:root;Digest=$script:digest;Sid=$script:sid;Origin=$script:origin}
 }
}
function Binding([string]$ExpectedExtension=$extension){
 Get-AdministratorBrowserSetupBinding (Join-Path $bridge 'bundle.zip') $digest (Join-Path $bridge 'stager.ps1') $programFiles $system $sid $ExpectedExtension
}
function Unknown($Row,[string]$Label){
 Check ($Row.Keys.Count -eq 4 -and $Row.setupId -ceq $setup -and $Row.state -ceq 'unconfirmed' -and
  $null -eq $Row.bundleSha256 -and $null -eq $Row.target) $Label
}
try{
 [IO.Directory]::CreateDirectory($bridge)|Out-Null
 [IO.Directory]::CreateDirectory($root)|Out-Null
 [IO.Directory]::CreateDirectory($root+'.status')|Out-Null
 [IO.File]::WriteAllText((Join-Path $scratch 'guard'),'fixture')
 Assert-AdministratorBrowserSetupParameters 'ObserveBrowserSetup' $bound $digest $setup $extension
 foreach($bad in @('',('B'*32),($setup+[char]10),'not-id')){
  Refuse {Assert-AdministratorBrowserSetupParameters 'ObserveBrowserSetup' $bound $digest $bad $extension} 'closed_setup_id'
 }
 foreach($key in @('Consent','ExpectedUserSid','BrowserWake','OperationReceiptId','RuntimeKeyFile')){
  Refuse {Assert-AdministratorBrowserSetupParameters 'ObserveBrowserSetup' @($bound+$key) $digest $setup $extension} 'closed_observation_parameters'
 }
 Reset
 [IO.File]::WriteAllText((Join-Path $bridge 'stager.ps1'),'fixture-not-executed')
 [IO.File]::WriteAllText((Join-Path $bridge 'bundle.zip'),'fixture-not-hashed')
 $bindingFile=Join-Path $bridge 'binding.json'
 $bindingText=(ConvertTo-Json -InputObject ([ordered]@{version=1;origin=$origin;bundleSha256=$digest;systemDirectory=$system}) -Compress)+[char]10
 [IO.File]::WriteAllText($bindingFile,$bindingText)
 $actual=Binding
 Check ($actual.Origin -ceq $origin -and $actual.Root -ceq $root -and $actual.Sid -ceq $sid) 'real_fast_binding_reader'
 Check ($script:anchorCalls -eq 1 -and $script:registryCalls -eq 1) 'binding_protected_anchors_and_enrollment'
 Refuse {Binding ('f'*32)} 'another_extension_cannot_observe_receipt'
 foreach($bad in @($bindingText.Replace($digest,('f'*64)),$bindingText.Replace($origin,('chrome-extension://'+('f'*32)+'/')),
  $bindingText.Replace('"version":1','"version":1,"extra":"private"'),('x'*1025),$bindingText.TrimEnd())){
  [IO.File]::WriteAllText($bindingFile,$bad);Refuse {Binding} 'bad_binding_denied'
 }
 [IO.File]::WriteAllText($bindingFile,$bindingText)
 [IO.File]::WriteAllText((Join-Path $bridge 'enrollment.pending'),'pending')
 Refuse {Binding} 'uncommitted_binding_denied'
 [IO.File]::Delete((Join-Path $bridge 'enrollment.pending'))
 $script:registryFailure=$true;Refuse {Binding} 'unenrolled_binding_denied';$script:registryFailure=$false
 foreach($name in @('binding.json','stager.ps1','bundle.zip')){
  $script:aclFailure=$name;Refuse {Binding} 'binding_asset_acl_denied'
 }
 Reset
 $r=Observe
 Check ($r.Keys.Count -eq 4 -and $r.state -ceq 'installed' -and $r.setupId -ceq $setup -and $r.bundleSha256 -ceq $digest -and $r.target -ceq $target) 'exact_installed'
 foreach($name in @('setup-receipt.json','enrolled.json','pause-target.json','control-owner.json')){
  Check (@($script:aclCalls|Where-Object{$_ -clike ('*'+$name)}).Count -gt 0) ('checked_acl:'+ $name)
 }
 $receipt=Join-Path $bridge 'setup-receipt.json'
 $good=[IO.File]::ReadAllText($receipt)
 foreach($bad in @($good.Replace($setup,('f'*32)),$good.Replace($digest,('0'*64)),
  $good.Replace($extension,('f'*32)),$good.Replace($target,$other),$good.Replace('"version":1','"version":1.0'),
  $good.Replace('"setupId"','"SetupId"'),$good.Replace('"version":1','"version":1,"version":1'),
  $good.Replace('"version":1','"version":1,"key":"secret"'),'{bad}',('x'*513),$good.TrimEnd())){
  Reset;[IO.File]::WriteAllText($receipt,$bad);Unknown (Observe) 'bad_receipt_unconfirmed'
 }
 foreach($name in @('setup-receipt.json','enrolled.json','pause-target.json','control-owner.json')){
  Reset;$script:aclFailure=$name;Unknown (Observe) 'acl_denial_unconfirmed'
 }
 foreach($state in @('running','revoked','unobserved')){
  Reset;$file=Join-Path ($root+'.status') 'control-owner.json'
  [IO.File]::WriteAllText($file,[IO.File]::ReadAllText($file).Replace('paused',$state))
  Unknown (Observe) 'manual_control_invalidates'
 }
 Reset
 foreach($name in @('pause-target.json','control-owner.json')){
  $file=Join-Path ($root+'.status') $name
  [IO.File]::WriteAllText($file,[IO.File]::ReadAllText($file).Replace($target,$other))
 }
 Unknown (Observe) 'stale_receipt_after_paused_target_rotation'
 Reset;[IO.File]::Delete($receipt);Unknown (Observe) 'legacy_not_adopted'
 Reset;[IO.File]::Delete($receipt);[IO.Directory]::CreateDirectory($receipt)|Out-Null
 Unknown (Observe) 'directory_not_receipt';[IO.Directory]::Delete($receipt)
 Reset;[IO.File]::Delete($receipt)
 $redirect=Join-Path $scratch 'redirect';[IO.Directory]::CreateDirectory($redirect)|Out-Null
 $null=New-Item -ItemType Junction -Path $receipt -Target $redirect
 try{Unknown (Observe) 'redirected_receipt_denied'}finally{[IO.Directory]::Delete($receipt)}
 Reset;[IO.File]::WriteAllText((Join-Path $bridge 'enrolled.json'),'stale');Unknown (Observe) 'commit_exact'
 Reset
 $gate=Open-AdministratorOwnerControl ''
 try{
  Refuse {Publish-AdministratorBrowserSetupReceipt $root $digest $sid $origin $setup $target $gate} 'receipt_never_overwritten'
  [IO.File]::Delete($receipt)
  Publish-AdministratorBrowserSetupReceipt $root $digest $sid $origin $setup $target $gate
 }finally{$gate.Dispose()}
 Check ((Observe).state -ceq 'installed') 'writer_roundtrip'
 Check ([IO.File]::ReadAllText($receipt) -ceq $good) 'writer_exact_bytes'
 # Entry is separated from ZIP hashing and cannot inherit mutation parameters.
 $entry=@($ast.EndBlock.Statements|Where-Object{$_ -is [Management.Automation.Language.IfStatementAst] -and
  $_.Clauses[0].Item1.Extent.Text -ceq '$Action -ieq ''ObserveBrowserSetup'''})
 Check ($entry.Count -eq 1) 'early_observation_entry'
 $source=[IO.File]::ReadAllText($stager)
 Check ($entry[0].Extent.EndOffset -lt $source.IndexOf('$inputStream = [IO.File]::Open($Archive')) 'before_archive_hash'
 foreach($denied in @('Process]::Start','runas','Verify-SealedBundle','Get-Layout','ComputeHash','New-Object')){
  Check (-not $entry[0].Extent.Text.Contains($denied)) ('entry_no_mutation_or_full_hash:'+ $denied)
 }
 Check ($entry[0].Extent.Text.Contains('[Security.Principal.WindowsIdentity]::GetCurrent()')) 'selected_sid_from_current_identity'
 $publish=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Publish-AdministratorBrowserEnrollment'},$true))[0].Extent.Text
 Check ($publish.IndexOf('$setupTarget = Get-AdministratorBrowserSetupTarget') -lt $publish.IndexOf('[IO.File]::Move')) 'capture_before_commit'
 Check ($publish.IndexOf('[IO.File]::Move') -lt $publish.IndexOf('Publish-AdministratorBrowserSetupReceipt')) 'receipt_after_commit_same_gate'
 Check ($publish.IndexOf('Publish-AdministratorBrowserSetupReceipt') -lt $publish.IndexOf('$gate.Dispose()')) 'receipt_before_gate_release'
 # Interleave a changed public projection before publication. Never rebase A to B.
 Reset;[IO.File]::Delete($receipt)
 $captured=Get-AdministratorBrowserSetupTarget $root $digest $sid
 $gate=Open-AdministratorOwnerControl ''
 try{
  foreach($name in @('pause-target.json','control-owner.json')){
   $file=Join-Path ($root+'.status') $name
   [IO.File]::WriteAllText($file,[IO.File]::ReadAllText($file).Replace($target,$other))
  }
  Refuse {Publish-AdministratorBrowserSetupReceipt $root $digest $sid $origin $setup $captured $gate} 'enrollment_A_pause_B_publisher_rejects'
  Check (-not [IO.File]::Exists($receipt)) 'pause_B_never_written_as_setup_receipt'
 }finally{$gate.Dispose()}
 # Execute the actual commit function with scratch pending marker and the same real exclusive gate.
 Reset;[IO.File]::Delete($receipt)
 [IO.File]::Move((Join-Path $bridge 'enrolled.json'),(Join-Path $bridge 'enrollment.pending'))
 function Update-AdministratorBrowserPauseTarget($Root,$Vault,$Digest,$Sid,$Gate,[switch]$Require){}
 $plan=@{Bridge=$bridge;Sid=$sid;Files=@{'binding.json'=[Text.Encoding]::UTF8.GetBytes('{"origin":"'+$origin+'"}')}}
 Publish-AdministratorBrowserEnrollment $plan $digest ($root+'.secrets') -RequirePauseTarget -BrowserSetupId $setup
 Check ((Observe).state -ceq 'installed') 'actual_enrollment_publishes_under_same_gate'
 $script:realCommit=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Read-AdministratorBrowserCommit'},$true))[0].Body.GetScriptBlock()
 & {
  # Inject B exactly between the real enrolled-marker commit and its receipt publisher.
  function Read-AdministratorBrowserCommit($Bridge,$Digest,$Sid,[switch]$ForRemoval){
   & $script:realCommit $Bridge $Digest $Sid -ForRemoval:$ForRemoval
   if(-not $ForRemoval){
    foreach($name in @('pause-target.json','control-owner.json')){
     $file=Join-Path ($script:root+'.status') $name
     [IO.File]::WriteAllText($file,[IO.File]::ReadAllText($file).Replace($script:target,$script:other))
    }
   }
  }
  Reset;[IO.File]::Delete($receipt)
  [IO.File]::Move((Join-Path $bridge 'enrolled.json'),(Join-Path $bridge 'enrollment.pending'))
  Refuse {Publish-AdministratorBrowserEnrollment $plan $digest ($root+'.secrets') -RequirePauseTarget -BrowserSetupId $setup} 'actual_commit_A_pause_B_publisher_refuses'
  Check ([IO.File]::Exists((Join-Path $bridge 'enrolled.json')) -and -not [IO.File]::Exists($receipt)) 'commit_retained_but_no_rebased_receipt'
 }
 Reset;[IO.File]::Delete($receipt)
 [IO.File]::Move((Join-Path $bridge 'enrolled.json'),(Join-Path $bridge 'enrollment.pending'))
 Publish-AdministratorBrowserEnrollment $plan $digest ($root+'.secrets') -RequirePauseTarget
 Check (-not [IO.File]::Exists($receipt)) 'legacy_enrollment_cannot_create_setup_receipt'
 # Read-only call graph cannot enter private state, hash/ZIP, UAC, startup or publication.
 $readNames=@('Assert-AdministratorBrowserSetupParameters','Read-AdministratorBrowserSetupReceipt',
  'Get-AdministratorBrowserSetupTarget','Get-AdministratorBrowserSetupBinding','Read-AdministratorBrowserSetupStatus')
 $allowed=@($readNames+@('Read-AdministratorControlBytes','Assert-SealedAcl','Read-AdministratorBrowserCommit',
  'Assert-AdministratorBrowserPauseAnchors','Test-AdministratorOwnerAbsent','Assert-AdministratorBrowserRegistry',
  'Read-AdministratorBrowserPauseTargetProjection','Read-AdministratorBrowserControlSupportProjection',
  'Test-AdministratorBrowserPauseTarget','ConvertTo-Json'))
 foreach($name in $readNames){
  $fn=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true))[0]
  foreach($cmd in $fn.FindAll({param($n)$n -is [Management.Automation.Language.CommandAst]},$true)){
   $called=$cmd.GetCommandName()
   if($null -eq $called){Check ($name -ceq 'Read-AdministratorBrowserSetupStatus' -and $cmd.CommandElements[0].Extent.Text -ceq '$Verify') 'only_readonly_verify_callback'}
   else{Check ([Array]::IndexOf($allowed,$called) -ge 0) ('readonly_call:'+ $called)}
  }
 }
 # The production entry itself is exercised only on missing fixtures, never a real installation.
 $ps=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
 foreach($extra in @(@(),@('-Consent','unexpected'),@('-ExpectedUserSid',$sid))){
  $wire=& $ps -NoLogo -NoProfile -NonInteractive -File $stager -Action ObserveBrowserSetup -Archive (Join-Path $scratch 'missing.zip') -ExpectedSha256 $digest -BrowserSetupId $setup -BrowserExtensionId $extension @extra
  Check ($LASTEXITCODE -eq 0) 'observation_never_requests_elevation'
  $row=ConvertFrom-Json ($wire -join [char]10)
  Unknown @{setupId=$row.setupId;state=$row.state;bundleSha256=$row.bundleSha256;target=$row.target} 'entry_exact_unconfirmed'
  Check (@($row.PSObject.Properties).Count -eq 4) 'entry_no_extra_fields'
 }
 [pscustomobject]@{ok=$true;checks=$checks;scope='scratch-public-files-and-ACL-stubs-not-installed-acceptance';actualUac=$false}|ConvertTo-Json -Compress
}finally{
 if([IO.Path]::GetDirectoryName($scratch).TrimEnd('\') -ceq [IO.Path]::GetTempPath().TrimEnd('\') -and
  [IO.Path]::GetFileName($scratch) -cmatch '\Aac-setup-[a-f0-9]{32}\z' -and [IO.Directory]::Exists($scratch)){
  [IO.Directory]::Delete($scratch,$true)
 }
}
