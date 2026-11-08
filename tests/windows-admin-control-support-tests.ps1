[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$stager=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'))
$tokens=$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($stager,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'parse'}
$script:checks=0; $script:cases=0;$script:wireExamples=[Collections.Generic.List[object]]::new()
function Check([bool]$Value,[string]$Label){if(-not $Value){throw $Label};$script:checks++}
function Refuse([scriptblock]$Run,[string]$Label){$threw=$false;try{& $Run|Out-Null}catch{$threw=$true};Check $threw $Label}
$names=@('Test-AdministratorControlFields','Test-AdministratorBrowserPauseTarget',
 'Assert-AdministratorControlSupportParameters','Get-AdministratorControlSupportProjectionBytes',
 'Read-AdministratorBrowserControlSupportProjection','Get-AdministratorBrowserControlOwnerState',
 'Publish-AdministratorBrowserControlSupportProjection','Read-AdministratorBrowserControlSupport')
foreach($name in $names){
 $defs=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true))
 if($defs.Count -ne 1){throw ('missing_api:'+ $name)}
 . ([scriptblock]::Create($defs[0].Extent.Text))
}
$script:digest='a'*64; $script:sid='S-1-5-21-1-2-3-1001'
$script:root=Join-Path ([IO.Path]::GetTempPath()) ('ac-support-'+[Guid]::NewGuid().ToString('N'))
$script:bundle=Join-Path $root $digest.Substring(0,24)
$script:idle=('b'*32)+':idle';$script:active=('b'*32)+':'+('c'*32)
$script:bound=@('Action','Archive','ExpectedSha256','ControlKind')
$script:target=@{Root=$bundle;Digest=$digest;Sid=$sid}
$script:projection=$null;$script:targets=@($idle,$idle);$script:readCount=0;$script:verifyCount=0
function Assert-SealedAcl($Path,$Directory,$Private,$Sid){}
function Ensure-SealedDirectory($Path,$Private,$Sid){[IO.Directory]::CreateDirectory($Path)|Out-Null}
function Open-SealedNewFile($Path,$Private,$Sid){return [IO.File]::Open($Path,'CreateNew','Write','None')}
function Test-AdministratorOwnerAbsent($Path){
 if([IO.Path]::GetFileName($Path) -ceq 'owner-revoked'){return $script:denialAbsent}
 return -not [IO.File]::Exists($Path)
}
function Test-AdministratorOwnerIntent($Root,$Paused){return ($Paused -and $script:intent -ceq 'paused') -or (-not $Paused -and $script:intent -ceq 'running')}
function Read-AdministratorBrowserPauseTargetProjection($Root,$Digest,$Sid){
 $i=[Math]::Min($script:readCount,$script:targets.Count-1);$script:readCount++;return $script:targets[$i]
}
function Reset{
 $script:denialAbsent=$true;$script:intent='paused';$script:readCount=0;$script:verifyCount=0
 $script:targets=@($script:idle,$script:idle)
 $script:projection=@{bundleSha256=$script:digest;target=$script:idle;ownerState='paused'}
}
function Invoke-Support([string]$Kind){
 Read-AdministratorBrowserControlSupport 'CheckBrowserHostedOwnerControl' $script:digest $Kind $script:bound {
  $script:verifyCount++;return $script:target
 }
}
try{
 [IO.Directory]::CreateDirectory($bundle+'.status')|Out-Null
 foreach($kind in @('connect','resume-saved','revoke')){
  Assert-AdministratorControlSupportParameters 'CheckBrowserHostedOwnerControl' $bound $digest $kind
  $script:cases++
 }
 foreach($bad in @('checkbrowserhostedownercontrol','CheckBrowserHostedOwnerControl '+[char]10,'ObserveHostedOwnerControl')){
  Refuse {Assert-AdministratorControlSupportParameters $bad $bound $digest 'connect'} 'closed_action';$script:cases++
 }
 foreach($kind in @('Connect',('resume-saved'+[char]10),'-Command anything','')){
  Refuse {Assert-AdministratorControlSupportParameters 'CheckBrowserHostedOwnerControl' $bound $digest $kind} 'closed_kind';$script:cases++
 }
 foreach($keys in @(@($bound+'Consent'),@($bound+'ControlOperationId'),@('Action','Archive','ExpectedSha256'),
   @('Action','Archive','ExpectedSha256','controlkind'),@('Action','Archive','Archive','ControlKind'))){
  Refuse {Assert-AdministratorControlSupportParameters 'CheckBrowserHostedOwnerControl' $keys $digest 'connect'} 'closed_keys';$script:cases++
 }
 foreach($bad in @('',('A'*64),($digest+[char]10))){
  Refuse {Assert-AdministratorControlSupportParameters 'CheckBrowserHostedOwnerControl' $bound $bad 'connect'} 'closed_digest';$script:cases++
 }
 # Real bounded public-file reader and serializer, scratch ACL only.
 $file=Join-Path ($bundle+'.status') 'control-owner.json'
 foreach($state in @('paused','running','revoked','unobserved')){foreach($snapshot in @($idle,$active)){
  $bytes=Get-AdministratorControlSupportProjectionBytes $digest $snapshot $state
  [IO.File]::WriteAllBytes($file,$bytes)
  $row=Read-AdministratorBrowserControlSupportProjection $bundle $digest $sid
  Check ($row.bundleSha256 -ceq $digest -and $row.target -ceq $snapshot -and $row.ownerState -ceq $state) 'reader_roundtrip'
  Check ($row.Keys.Count -eq 3) 'reader_closed';$script:cases++
 }}
 $good=[Text.Encoding]::ASCII.GetString((Get-AdministratorControlSupportProjectionBytes $digest $idle 'paused'))
 foreach($bad in @($good.Replace('"version":1','"version":1.0'),$good.Replace('paused','Paused'),
   $good.Replace($digest,('d'*64)),$good.TrimEnd(),$good.Replace('"target"','"Target"'),
   $good.Replace('"ownerState":"paused"','"ownerState":"paused","extra":"PRIVATE"'),('x'*257))){
  [IO.File]::WriteAllText($file,$bad,[Text.Encoding]::ASCII)
  Refuse {Read-AdministratorBrowserControlSupportProjection $bundle $digest $sid} 'reader_corrupt';$script:cases++
 }
 foreach($state in @('paused','running','revoked','unobserved')){foreach($kind in @('connect','resume-saved','revoke')){foreach($snapshot in @($idle,$active)){
  Reset
  [IO.File]::WriteAllBytes($file,(Get-AdministratorControlSupportProjectionBytes $digest $snapshot $state))
  $script:targets=@($snapshot,$snapshot)
  $r=Invoke-Support $kind
  $eligible=$kind -ceq 'revoke' -or ($snapshot -ceq $idle -and (($kind -ceq 'connect' -and $state -ceq 'paused') -or ($kind -ceq 'resume-saved' -and $state -ceq 'running')))
  Check ($r.Keys.Count -eq 6 -and $r.control -ceq $kind -and $r.state -ceq 'supported') 'support_closed'
  Check ($r.bundleSha256 -ceq $digest -and $r.ownerState -ceq $state -and $r.eligible -is [bool] -and $r.eligible -eq $eligible) 'eligibility'
  if($eligible -and $kind -cne 'revoke'){Check ($r.target -ceq $snapshot) 'eligible_target'}else{Check ($null -eq $r.target) 'no_target'}
  Check ($script:verifyCount -eq 1) 'single_verify';$script:cases++
  $script:wireExamples.Add($r)
 }}}
 foreach($kind in @('connect','resume-saved','revoke')){foreach($mode in @('missing','malformed','before-mismatch','after-mismatch')){
  Reset
  [IO.File]::WriteAllBytes($file,(Get-AdministratorControlSupportProjectionBytes $digest $idle 'paused'))
  if($mode -ceq 'missing'){[IO.File]::Delete($file)}
  if($mode -ceq 'malformed'){[IO.File]::WriteAllText($file,'PRIVATE')}
  if($mode -ceq 'before-mismatch'){$script:targets=@($active,$idle)}
  if($mode -ceq 'after-mismatch'){$script:targets=@($idle,$active)}
  $r=Invoke-Support $kind
  Check ($r.state -ceq 'supported' -and $r.ownerState -ceq 'unobserved' -and $null -eq $r.target) 'missing_or_mixed_denies_start'
  Check ($r.eligible -eq ($kind -ceq 'revoke')) 'revoke_independent_of_projection';$script:cases++
 }}
 foreach($kind in @('connect','resume-saved','revoke')){
  $r=Read-AdministratorBrowserControlSupport 'CheckBrowserHostedOwnerControl' $digest $kind $bound {throw 'PRIVATE'}
  Check ($r.state -ceq 'unconfirmed' -and $r.bundleSha256 -eq $null -and -not $r.eligible -and $null -eq $r.target -and $r.ownerState -ceq 'unobserved') 'preflight_unconfirmed';$script:cases++
 }
 foreach($key in @('Consent','ExpectedUserSid','ControlOperationId','BrowserControlTarget','ControlCallerPid','ControlCallerCreated','ExpectedSessionId','BrowserExtensionId')){
  Reset
  Refuse {Read-AdministratorBrowserControlSupport 'CheckBrowserHostedOwnerControl' $digest 'connect' @($bound+$key) {$script:verifyCount++;return $script:target}} 'extra_before_verify'
  Check ($script:verifyCount -eq 0) 'no_preflight_on_extra';$script:cases++
 }
 $valid=$script:target
 foreach($key in @('Root','Digest','Sid')){foreach($bad in @($null,@('bad','array'),@{},'bad',('PRIVATE'+[char]10))){
  $script:target=@{Root=$valid.Root;Digest=$valid.Digest;Sid=$valid.Sid};$script:target[$key]=$bad
  Reset
  $r=Invoke-Support 'revoke'
  Check ($r.state -ceq 'unconfirmed' -and -not $r.eligible -and $null -eq $r.bundleSha256) 'binding_refusal';$script:cases++
 }}
 $script:target=$valid
 foreach($owner in @('paused','running','malformed')){foreach($deny in @($true,$false)){
  Reset;$script:intent=$owner;$script:denialAbsent=$deny
  $state=Get-AdministratorBrowserControlOwnerState ($bundle+'.state') ($bundle+'.secrets')
  $expected=if(-not $deny){'revoked'}elseif($owner -ceq 'malformed'){'unobserved'}else{$owner}
  Check ($state -ceq $expected) 'deny_wins';$script:cases++
 }}
 & {
  $script:aclForm='protected';$script:inheritedCalls=0
  function Assert-SealedAcl($Path,$Directory,$Private,$Sid){
   if([IO.Path]::GetFileName($Path) -ceq 'lifecycle.json' -and $script:aclForm -cne 'protected'){throw 'sealed_refusal'}
  }
  function Assert-InheritedPrivateAcl($Path,$Directory){
   $script:inheritedCalls++
   if($Directory -or [IO.Path]::GetFileName($Path) -cne 'lifecycle.json' -or $script:aclForm -cne 'inherited'){throw 'inherited_refusal'}
  }
  foreach($form in @('protected','inherited','invalid')){foreach($intent in @('paused','running')){
   Reset;$script:intent=$intent;$script:aclForm=$form;$script:inheritedCalls=0
   $result=Get-AdministratorBrowserControlOwnerState ($bundle+'.state') ($bundle+'.secrets')
   $expected=if($form -ceq 'invalid'){'unobserved'}else{$intent}
   Check ($result -ceq $expected) ('exact_acl_form:'+ $form)
   Check ($script:inheritedCalls -eq $(if($form -ceq 'protected'){0}else{1})) 'no_broad_acl_fallback';$script:cases++
  }}
 }
 Reset
 # Real atomic scratch publication, not protected ACL or private owner observation.
 $gatePath=Join-Path $root 'guard';$gate=[IO.File]::Open($gatePath,'CreateNew','ReadWrite','None')
 try{
  [IO.File]::Delete($file)
  Check (-not [IO.File]::Exists($file)) 'create_destination_really_absent'
  Publish-AdministratorBrowserControlSupportProjection $bundle $digest $sid $idle
  Check ((Read-AdministratorBrowserControlSupportProjection $bundle $digest $sid).ownerState -ceq 'paused') 'publish_create'
  $script:denialAbsent=$false
  Publish-AdministratorBrowserControlSupportProjection $bundle $digest $sid $active
  $r=Read-AdministratorBrowserControlSupportProjection $bundle $digest $sid
  Check ($r.ownerState -ceq 'revoked' -and $r.target -ceq $active) 'atomic_replace_revoke'
  Check (@([IO.Directory]::GetFiles($bundle+'.status','*.tmp')).Count -eq 0) 'no_temp_leak';$script:cases++
 }finally{$gate.Dispose()}
 # Integrate the real elevated update hook and both real readers in scratch only.
 foreach($name in @('Read-AdministratorBrowserPauseTargetProjection','Update-AdministratorBrowserPauseTarget')){
  $fn=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true))[0]
  . ([scriptblock]::Create($fn.Extent.Text))
 }
 function Read-AdministratorOwnerControlRevision($Gate){return $script:revision}
 function Get-AdministratorPauseGeneration($Root,$Vault,$Digest,$Sid){return 'idle'}
 $gate=[IO.File]::Open($gatePath,'Open','ReadWrite','None')
 try{
  Reset;$script:revision='b'*32
  Update-AdministratorBrowserPauseTarget ($bundle+'.state') ($bundle+'.secrets') $digest $sid $gate -Require
  Check ((Read-AdministratorBrowserPauseTargetProjection $bundle $digest $sid) -ceq $idle) 'hook_pause_target'
  Check ((Invoke-Support 'connect').eligible) 'hook_eligible';$script:cases++
  $script:revision='e'*32;$script:denyPublicWrite=$true
  function Assert-SealedAcl($Path,$Directory,$Private,$Sid){
   if($script:denyPublicWrite -and [IO.Path]::GetFileName($Path) -ceq 'control-owner.json'){throw 'acl_stub_refusal'}
  }
  Refuse {Update-AdministratorBrowserPauseTarget ($bundle+'.state') ($bundle+'.secrets') $digest $sid $gate -Require} 'required_publication_refuses'
  $script:denyPublicWrite=$false
  $r=Invoke-Support 'connect'
  Check ($r.ownerState -ceq 'unobserved' -and -not $r.eligible -and $null -eq $r.target) 'mixed_hook_denies_start'
  Check ((Invoke-Support 'revoke').eligible) 'mixed_hook_preserves_revoke';$script:cases++
 }finally{$gate.Dispose()}
 & {
  # Real deny file and exclusive scratch gate; no installed owner or registry.
  $fn=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Request-AdministratorOwnerRevocation'},$true))[0]
  . ([scriptblock]::Create($fn.Extent.Text))
  $script:updateSubject=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Update-AdministratorBrowserPauseTarget'},$true))[0].Body.GetScriptBlock()
  $vault=$bundle+'.secrets';[IO.Directory]::CreateDirectory($vault)|Out-Null
  $guardPath=Join-Path $vault 'owner-control.guard';[IO.File]::WriteAllText($guardPath,('f'*32)+[char]10)
  $deny=Join-Path $vault 'owner-revoked'
  $script:legacyTrace=[Collections.Generic.List[string]]::new();$script:legacyAcquisitions=0;$script:publicationFailures=0
  function Assert-AdministratorOwnerControlIdentity($Root,$Digest,$Sid){Check ($Root -ceq $script:bundle -and $Digest -ceq $script:digest -and $Sid -ceq $script:sid) 'legacy_fixed_owner'}
  function Test-AdministratorOwnerAbsent($Path){return -not [IO.File]::Exists($Path)}
  function Open-AdministratorOwnerControl($Vault){
   $script:legacyAcquisitions++;return [IO.File]::Open((Join-Path $Vault 'owner-control.guard'),'Open','ReadWrite','None')
  }
  function Write-HostedWindowSignal($Path){$script:legacyTrace.Add('deny');[IO.File]::WriteAllBytes($Path,[byte[]]@())}
  function Assert-SealedAcl($Path,$Directory,$Private,$Sid){
   if([IO.Path]::GetFileName($Path) -ceq 'owner-revoked'){$script:legacyTrace.Add('deny-readback')}
   if([IO.Path]::GetFileName($Path) -ceq 'control-owner.json'){$script:publicationFailures++;throw 'publication_failure'}
  }
  function Update-AdministratorBrowserPauseTarget($Root,$Vault,$Digest,$Sid,$Gate){
   $script:legacyTrace.Add('refresh')
   Check ([IO.File]::Exists((Join-Path $Vault 'owner-revoked')) -and [IO.FileInfo]::new((Join-Path $Vault 'owner-revoked')).Length -eq 0) 'deny_precedes_refresh'
   $blocked=$false;$other=$null
   try{$other=[IO.File]::Open((Join-Path $Vault 'owner-control.guard'),'Open','ReadWrite','None')}catch [IO.IOException]{$blocked=$true}
   finally{if($other){$other.Dispose()}}
   Check $blocked 'refresh_gate_held'
   & $script:updateSubject $Root $Vault $Digest $Sid $Gate
  }
  Reset;$script:revision='f'*32
  # A real metadata marker makes the optional publisher execute and fail internally.
  [IO.Directory]::CreateDirectory($bundle+'.browser')|Out-Null
  [IO.File]::WriteAllText((Join-Path ($bundle+'.browser') 'pause-launch.json'),'fixture')
  Request-AdministratorOwnerRevocation $bundle $digest $sid
  Check (($script:legacyTrace.ToArray()-join ',') -ceq 'deny,deny-readback,refresh') 'legacy_order'
  Check ([IO.File]::Exists($deny) -and [IO.FileInfo]::new($deny).Length -eq 0) 'failed_publication_keeps_deny'
  Check ($script:legacyAcquisitions -eq 1) 'one_gate_acquisition'
  Check ($script:publicationFailures -eq 1) 'publication_failure_actually_reached'
  $released=[IO.File]::Open($guardPath,'Open','ReadWrite','None');$released.Dispose();$script:cases++
  [IO.File]::Delete($guardPath);[IO.File]::Delete($deny);$script:legacyTrace.Clear()
  Request-AdministratorOwnerRevocation $bundle $digest $sid
  Check (($script:legacyTrace.ToArray()-join ',') -ceq 'deny,deny-readback') 'absent_gate_no_refresh_or_repair'
  Check ($script:legacyAcquisitions -eq 1 -and -not [IO.File]::Exists($guardPath) -and [IO.File]::Exists($deny)) 'absent_gate_no_acquisition';$script:cases++
  Check ($script:publicationFailures -eq 1) 'absent_gate_does_not_attempt_publication'
 }
 # Read-query call graph is closed: no dynamic callbacks except the supplied Verify.
 $readNames=@('Assert-AdministratorControlSupportParameters','Get-AdministratorControlSupportProjectionBytes',
  'Read-AdministratorBrowserControlSupportProjection','Read-AdministratorBrowserControlSupport')
 $commands=@($readNames+@('Assert-SealedAcl','Test-AdministratorBrowserPauseTarget','Test-AdministratorControlFields','Read-AdministratorBrowserPauseTargetProjection'))
 foreach($name in $readNames){
  $fn=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true))[0]
  foreach($command in $fn.FindAll({param($n)$n -is [Management.Automation.Language.CommandAst]},$true)){
   $n=$command.GetCommandName()
   if($null -eq $n){Check ($name -ceq 'Read-AdministratorBrowserControlSupport' -and $command.CommandElements[0].Extent.Text -ceq '$Verify') 'only_verify_dynamic'}
   else{Check ([Array]::IndexOf($commands,$n) -ge 0) ('readonly_command:'+ $n)}
  }
  $allowedMembers=@('IndexOf','GetFullPath','GetFileName','Substring','Combine','Open','new','Dispose','ReadToEnd','EndsWith','GetBytes','Equals')
  foreach($member in $fn.FindAll({param($n)$n -is [Management.Automation.Language.InvokeMemberExpressionAst]},$true)){
   Check ([Array]::IndexOf($allowedMembers,$member.Member.Value) -ge 0) ('readonly_member:'+ $member.Member.Value)
   if($member.Member.Value -ceq 'Open'){
    Check ($member.Arguments[1].Value -ceq 'Open' -and $member.Arguments[2].Value -ceq 'Read') 'file_read_only_modes'
   }
  }
 }
 $supportDispatch=@($ast.EndBlock.Statements|Where-Object{
  $_ -is [Management.Automation.Language.IfStatementAst] -and $_.Clauses[0].Item1.Extent.Text -ceq "$"+'Action -ieq ''CheckBrowserHostedOwnerControl'''
 })
 Check ($supportDispatch.Count -eq 1) 'one_exact_support_dispatch'
 $guard=@($ast.EndBlock.Statements|Where-Object{
  $_ -is [Management.Automation.Language.IfStatementAst] -and $_.Clauses[0].Item1.Extent.Text -match '\$Action -ieq ''ObserveHostedOwnerControl'''
 })
 Check ($supportDispatch[0].Extent.EndOffset -lt $guard[0].Extent.StartOffset) 'support_before_control_guard'
 $allowed=@('Assert-AdministratorControlSupportParameters','Assert-AdministratorBrowserPauseAnchors','Import-Module',
  'Read-AdministratorBrowserControlSupport','Get-AdministratorBrowserPauseTarget','Get-AdministratorBrowserPauseIdentity','ConvertTo-Json')
 foreach($cmd in $supportDispatch[0].FindAll({param($n)$n -is [Management.Automation.Language.CommandAst]},$true)){
  Check ([Array]::IndexOf($allowed,$cmd.GetCommandName()) -ge 0) 'entry_fixed_readonly_command'
 }
 [pscustomobject]@{ok=$true;scope='ast-and-real-public-file-scratch-with-acl-and-owner-stubs-not-installed-acceptance';
  cases=$cases;checks=$checks;realPublicFileReader=$true;realAtomicPublication=$true;aclStub=$true;ownerStateStub=$true;
  exactAclFormOracle=$true;legacyDenyPreserved=$true;realLegacyGuard=$true;createAndReplaceVerified=$true;
  publicationFailureReached=($script:publicationFailures -eq 1);
  wireExamples=@($script:wireExamples.ToArray());
  actualUac=$false;protectedAcceptance=$false;stagerSha256=(Get-FileHash -LiteralPath $stager -Algorithm SHA256).Hash.ToLowerInvariant()}|ConvertTo-Json -Compress
}finally{
 # Exact scratch target created above; never production or a computed external directory.
 if([IO.Path]::GetDirectoryName($root).TrimEnd('\') -ceq [IO.Path]::GetTempPath().TrimEnd('\') -and [IO.Path]::GetFileName($root) -cmatch '\Aac-support-[a-f0-9]{32}\z'){
  if([IO.Directory]::Exists($root)){[IO.Directory]::Delete($root,$true)}
 }
}
