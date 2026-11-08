[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$source=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'))
$tokens=$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'stager_parse'}
$required=@('Get-AdministratorControlEndpointRoute','Assert-AdministratorControlEndpointParameters',
    'New-AdministratorControlEndpointLaunchPlan','Get-AdministratorControlEndpointCaller',
    'Wait-AdministratorControlEndpointHandoff','Invoke-AdministratorBrowserControlRequest',
    'Get-AdministratorControlEndpointBinding','Assert-AdministratorControlEndpointBinding',
    'Invoke-AdministratorBrowserControlEndpoint')
foreach($name in $required){
    $found=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true))
    if($found.Count -ne 1){throw ('missing_entry_function:'+ $name)}
}
$import=@($required+@('To-Hex','Test-AdministratorControlFields','Assert-AdministratorControlIdentity',
    'Get-AdministratorControlHandoffId','Test-AdministratorBrowserPauseTarget','Get-AdministratorBrowserPauseIdentity'))
foreach($name in $import){
    $node=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
    if(-not $node){throw ('missing_dependency:'+ $name)}
    . ([scriptblock]::Create($node.Extent.Text))
}
$script:cases=0;$script:checks=0;$script:failures=[Collections.Generic.List[string]]::new()
$digest='a'*64;$id='b'*32;$sid='S-1-5-21-1-2-3-1001';$snapshot=('d'*32)+':idle'
$root='C:\Program Files\AgentContinueAdmin\'+$digest.Substring(0,24)
$binding=@{Root=$root;Digest=$digest;Sid=$sid;System='C:\Windows\System32';
    Stager=$root+'.browser\stager.ps1';Archive=$root+'.browser\bundle.zip'}
$caller=@{Pid=500;Started='639295999999999999';SessionId=1;Sid=$sid;Process=$null}
$baseKeys=@('Action','Archive','ExpectedSha256','ControlKind','ControlOperationId')
$highKeys=@('ExpectedUserSid','Consent','ControlCallerPid','ControlCallerCreated','ExpectedSessionId')
$vectors=@(
    @('RequestBrowserHostedOwnerControl','connect','medium','control','ConnectBrowserHostedOwner','connect-browser-administrator-owner'),
    @('RequestBrowserHostedOwnerControl','resume-saved','medium','control','ResumeBrowserHostedOwner','resume-browser-administrator-owner'),
    @('RequestBrowserHostedOwnerControl','revoke','medium','control','RevokeBrowserHostedOwner','revoke-browser-administrator-owner'),
    @('RequestBrowserHostedOwnerControlFence','connect','medium','fence','FenceBrowserHostedOwnerControl','fence-browser-administrator-control'),
    @('RequestBrowserHostedOwnerControlReconcile','revoke','medium','reconcile','ReconcileBrowserHostedOwnerControl','reconcile-browser-administrator-control'),
    @('ConnectBrowserHostedOwner','connect','high','control','ConnectBrowserHostedOwner','connect-browser-administrator-owner'),
    @('ResumeBrowserHostedOwner','resume-saved','high','control','ResumeBrowserHostedOwner','resume-browser-administrator-owner'),
    @('RevokeBrowserHostedOwner','revoke','high','control','RevokeBrowserHostedOwner','revoke-browser-administrator-owner'),
    @('FenceBrowserHostedOwnerControl','resume-saved','high','fence','FenceBrowserHostedOwnerControl','fence-browser-administrator-control'),
    @('ReconcileBrowserHostedOwnerControl','connect','high','reconcile','ReconcileBrowserHostedOwnerControl','reconcile-browser-administrator-control'))
function Check([bool]$Value,[string]$Why){if(-not $Value){throw $Why};$script:checks++}
function Refuse([scriptblock]$Work,[string]$Why){$refused=$false;try{$null=& $Work}catch{$refused=$true};Check $refused $Why}
function Case([string]$Name,[scriptblock]$Work){
    $script:cases++
    try{$null=& $Work;[Console]::WriteLine('PASS '+$Name)}catch{
        $script:failures.Add($Name+': '+$_.Exception.Message);[Console]::WriteLine('FAIL '+$Name+': '+$_.Exception.Message)
    }
}
function Target-For($Vector){if($Vector[3] -ceq 'control' -and $Vector[1] -cne 'revoke'){return $snapshot};return $null}
function Keys-For($Vector){
    $keys=@($baseKeys)
    if($Vector[2] -ceq 'high'){$keys+=@($highKeys)}
    if($null -ne (Target-For $Vector)){$keys+='BrowserControlTarget'}
    return ,$keys
}
function Validate-Vector($Vector,[string[]]$Keys=(Keys-For $Vector)){
    $high=$Vector[2] -ceq 'high'
    return Assert-AdministratorControlEndpointParameters $Vector[0] $Keys $digest $id $Vector[1] (Target-For $Vector) `
        $(if($high){500}else{0}) $(if($high){$caller.Started}else{''}) $(if($high){1}else{0}) `
        $(if($high){$sid}else{''}) $(if($high){$Vector[5]}else{''})
}
function New-Handle([int]$Id=601){
    $h=[pscustomobject]@{Id=$Id;StartTime=[DateTime]::new(639296000000000000,[DateTimeKind]::Utc);SessionId=1;HasExited=$false;Disposed=0;Waits=0}
    $h|Add-Member ScriptMethod Dispose {$this.Disposed++}
    $h|Add-Member ScriptMethod WaitForExit {param($Milliseconds);$this.Waits++;return $this.HasExited}
    return $h
}
Case 'actual medium caller capture observes self only and holds exact process identity'{
    $c=Get-AdministratorControlEndpointCaller ([Environment]::GetFolderPath([Environment+SpecialFolder]::System))
    $self=[Diagnostics.Process]::GetCurrentProcess();$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    try{
        Check ($c.Pid -eq $PID -and $c.Process -is [Diagnostics.Process] -and -not $c.Process.HasExited) 'actual_self_handle'
        Check ($c.Started -ceq $self.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)) 'actual_self_utc_ticks'
        Check ($c.SessionId -eq $self.SessionId -and $c.SessionId -gt 0 -and $c.Sid -ceq $identity.User.Value) 'independent_self_identity'
        $script:actualMediumCallerObserved=$true
    }finally{$c.Process.Dispose();$self.Dispose();$identity.Dispose()}
}
foreach($v in $vectors){
    Case ('canonical envelope '+$v[0]+'/'+$v[1]){
        $r=Validate-Vector $v
        Check ($r.Role -ceq $v[2] -and $r.Mode -ceq $v[3] -and $r.HighAction -ceq $v[4] -and $r.Consent -ceq $v[5]) 'route_literals'
        foreach($key in (Keys-For $v)){
            Refuse {Validate-Vector $v @((Keys-For $v)|Where-Object{$_ -cne $key})} 'required_key'
            Refuse {Validate-Vector $v @((Keys-For $v)+$key)} 'duplicate_key'
        }
        foreach($key in @('Verbose','ErrorAction','BrowserWake','RuntimeKeyFile','origin','ControlKind ','controlkind')){
            Refuse {Validate-Vector $v @((Keys-For $v)+$key)} 'extra_or_noncanonical_key'
        }
    }
}
foreach($a in @('Plan','ObserveHostedOwnerControl','requestbrowserhostedownercontrol','RequestBrowserHostedOwnerControl ','')){
    Case ('unrecognized exact action '+$a){Refuse {Get-AdministratorControlEndpointRoute $a 'connect'} 'noncanonical_action'}
}
foreach($kind in @('','CONNECT','resume','pause','revoke ')){
    Case ('unrecognized exact kind '+$kind){Refuse {Get-AdministratorControlEndpointRoute 'RequestBrowserHostedOwnerControl' $kind} 'noncanonical_kind'}
}
Case 'high action cannot change its kind'{
    foreach($a in @('ConnectBrowserHostedOwner','ResumeBrowserHostedOwner','RevokeBrowserHostedOwner')){
        foreach($k in @('connect','resume-saved','revoke')){
            if(($a -ceq 'ConnectBrowserHostedOwner' -and $k -ceq 'connect') -or
                ($a -ceq 'ResumeBrowserHostedOwner' -and $k -ceq 'resume-saved') -or ($a -ceq 'RevokeBrowserHostedOwner' -and $k -ceq 'revoke')){continue}
            Refuse {Get-AdministratorControlEndpointRoute $a $k} 'action_kind_mismatch'
        }
    }
}
Case 'absent targets remain null and present empty target is rejected'{
    foreach($v in $vectors){
        if($null -eq (Target-For $v)){
            Refuse {Validate-Vector $v @((Keys-For $v)+'BrowserControlTarget')} 'present_empty_not_absent'
        }
    }
    $v=$vectors[5];$keys=Keys-For $v
    foreach($target in @('',('e'*32)+':unknown',($snapshot+"`n"))){
        Refuse {Assert-AdministratorControlEndpointParameters $v[0] $keys $digest $id 'connect' $target 500 $caller.Started 1 $sid $v[5]} 'invalid_target'
    }
}
Case 'high caller identifiers and consent are canonical'{
    $v=$vectors[5];$keys=Keys-For $v
    foreach($pidValue in @(0,[uint32]::MaxValue)){
        Refuse {Assert-AdministratorControlEndpointParameters $v[0] $keys $digest $id 'connect' $snapshot $pidValue $caller.Started 1 $sid $v[5]} 'invalid_caller_pid'
    }
    foreach($ticks in @('0','01','3155378976000000000','not-ticks')){
        Refuse {Assert-AdministratorControlEndpointParameters $v[0] $keys $digest $id 'connect' $snapshot 500 $ticks 1 $sid $v[5]} 'invalid_caller_ticks'
    }
    Refuse {Assert-AdministratorControlEndpointParameters $v[0] $keys $digest $id 'connect' $snapshot 500 $caller.Started 0 $sid $v[5]} 'zero_session'
    Refuse {Assert-AdministratorControlEndpointParameters $v[0] $keys $digest $id 'connect' $snapshot 500 $caller.Started 1 ($sid+'0') 'wrong'} 'wrong_consent'
    Refuse {Assert-AdministratorControlEndpointParameters $v[0] $keys $digest $id 'connect' $snapshot 500 $caller.Started 1 'S-1-5-18' $v[5]} 'not_selected_user_sid'
}
foreach($v in $vectors|Where-Object{$_[2] -ceq 'medium'}){
    Case ('fixed high launch vector '+$v[0]+'/'+$v[1]){
        $route=Get-AdministratorControlEndpointRoute $v[0] $v[1]
        $p=New-AdministratorControlEndpointLaunchPlan $binding $route $id $v[1] (Target-For $v) $caller
        $expected='-NoLogo -NoProfile -NonInteractive -File "'+$binding.Stager+'" -Action '+$v[4]+' -Archive "'+$binding.Archive+'" -ExpectedSha256 '+$digest+
            ' -ControlKind '+$v[1]+' -ControlOperationId '+$id+' -ExpectedUserSid '+$sid+' -Consent '+$v[5]+
            ' -ControlCallerPid 500 -ControlCallerCreated '+$caller.Started+' -ExpectedSessionId 1'
        if($null -ne (Target-For $v)){$expected+=' -BrowserControlTarget '+$snapshot}
        Check ($p.FileName -ceq 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -and $p.Arguments -ceq $expected) 'exact_native_order'
        Check ($p.UseShellExecute -and $p.Verb -ceq 'runas' -and $p.WindowStyle -eq 'Hidden' -and $p.WorkingDirectory -ceq $binding.System) 'native_hidden_uac_plan'
    }
}
Case 'OS system directory casing remains valid without admitting other paths'{
    $route=Get-AdministratorControlEndpointRoute 'RequestBrowserHostedOwnerControl' 'connect'
    $actualSystem=[Environment]::GetFolderPath([Environment+SpecialFolder]::System)
    foreach($systemPath in @($actualSystem,'C:\WINDOWS\system32','C:\windows\SYSTEM32','C:\Windows\System32')){
        $variant=@{}+$binding;$variant.System=$systemPath
        $plan=New-AdministratorControlEndpointLaunchPlan $variant $route $id 'connect' $snapshot $caller
        Check ($plan.FileName -ceq [IO.Path]::Combine($systemPath,'WindowsPowerShell\v1.0\powershell.exe')) 'preserve_os_system_path'
        Check ($plan.WorkingDirectory -ceq $systemPath -and $plan.Verb -ceq 'runas' -and $plan.UseShellExecute) 'preserve_elevation_contract'
    }
    foreach($systemPath in @('C:\Windows\System32Extra','C:\Windows\System32\..\Temp','C:/Windows/System32',
        'C:\Users\Public\System32','C:\Windows\System32 ','\\server\Windows\System32')){
        $variant=@{}+$binding;$variant.System=$systemPath
        Refuse {New-AdministratorControlEndpointLaunchPlan $variant $route $id 'connect' $snapshot $caller} 'reject_other_system_path'
    }
}
Case 'waiter requires exact ACK before child exit and never kills'{
    $child=New-Handle;$child.HasExited=$true;$route=Get-AdministratorControlEndpointRoute $vectors[0][0] 'connect'
    $script:reads=0
    $r=Wait-AdministratorControlEndpointHandoff $binding $route $id 'connect' $caller $child 25 {
        param($Status,$Digest,$Sid,$Id,$Control,$Mode,$HandoffId)
        $script:reads++
        Check ($Status -ceq ($root+'.status') -and $Mode -ceq 'control' -and $HandoffId -cmatch '\A[a-f0-9]{32}\z') 'expected_ack_identity'
        return $true
    }
    Check ($r -is [bool] -and $r -and $script:reads -eq 1 -and $child.Waits -eq 0 -and $child.Disposed -eq 0) 'ack_precedes_exit_no_handle_ownership'
}
foreach($value in @($false,$null,1,'true')){
    Case ('no ACK child exited returns unconfirmed '+[string]$value){
        $child=New-Handle;$child.HasExited=$true;$route=Get-AdministratorControlEndpointRoute $vectors[0][0] 'connect'
        Check (-not (Wait-AdministratorControlEndpointHandoff $binding $route $id 'connect' $caller $child 25 {return $value})) 'not_exact_ack'
        Check ($child.Waits -eq 0 -and $child.Disposed -eq 0) 'no_kill_or_disposal'
    }
}
Case 'wait timeout returns false without replay or killing child'{
    $child=New-Handle;$route=Get-AdministratorControlEndpointRoute $vectors[0][0] 'connect'
    $script:reads=0
    Check (-not (Wait-AdministratorControlEndpointHandoff $binding $route $id 'connect' $caller $child 30 {$script:reads++;return $false})) 'bounded_no_ack'
    Check ($script:reads -ge 1 -and $child.Waits -ge 1 -and $child.Disposed -eq 0) 'wait_without_kill'
}
Case 'ACK published between initial read and observed child exit is accepted'{
    $child=New-Handle;$route=Get-AdministratorControlEndpointRoute $vectors[0][0] 'connect'
    $script:ackVisible=$false;$script:reads=0
    $child.PSObject.Properties.Remove('HasExited')
    $child|Add-Member ScriptProperty HasExited {$script:ackVisible=$true;return $true}
    $r=Wait-AdministratorControlEndpointHandoff $binding $route $id 'connect' $caller $child 100 {$script:reads++;return $script:ackVisible}
    Check ($r -and $script:reads -eq 2 -and $child.Waits -eq 0) 'final_read_after_observed_exit'
}
Case 'ACK at timeout boundary gets one final exact read, no new launch'{
    $child=New-Handle;$route=Get-AdministratorControlEndpointRoute $vectors[0][0] 'connect'
    $script:ackVisible=$false;$script:reads=0
    $child|Add-Member -Force ScriptMethod WaitForExit {param($Milliseconds);$this.Waits++;$script:ackVisible=$true;[Threading.Thread]::Sleep(80);return $false}
    $r=Wait-AdministratorControlEndpointHandoff $binding $route $id 'connect' $caller $child 40 {$script:reads++;return $script:ackVisible}
    Check ($r -and $script:reads -eq 2 -and $child.Waits -eq 1 -and $child.Disposed -eq 0) 'final_read_after_timeout'
}
Case 'waiter rejects wrong child metadata before reading ACK'{
    $route=Get-AdministratorControlEndpointRoute $vectors[0][0] 'connect'
    foreach($field in @('Id','StartTime','SessionId')){
        $child=New-Handle
        switch($field){'Id'{$child.Id=500};'StartTime'{$child.StartTime=[DateTime]::new(1,[DateTimeKind]::Utc)};'SessionId'{$child.SessionId=2}}
        $script:unexpectedReads=0
        Check (-not (Wait-AdministratorControlEndpointHandoff $binding $route $id 'connect' $caller $child 25 {$script:unexpectedReads++;return $false})) 'bad_child_refused'
        Check ($script:unexpectedReads -eq 0) 'bad_metadata_never_reaches_ack_reader'
    }
}
function Reset-Request {
    $script:req=@{Steps=[Collections.Generic.List[string]]::new();Child=(New-Handle);Self=(New-Handle 500);Wait=$true;Cancel=$false;NullStart=$false;Fail=''}
}
function Invoke-Request {
    return Invoke-AdministratorBrowserControlRequest 'RequestBrowserHostedOwnerControl' $digest $id 'connect' $snapshot (Keys-For $vectors[0]) {
        $script:req.Steps.Add('verify');if($script:req.Fail -ceq 'verify'){throw 'private_error'};return $script:binding
    } {
        $script:req.Steps.Add('capture');if($script:req.Fail -ceq 'capture'){throw 'private_error'}
        return @{Pid=500;Started=$script:caller.Started;SessionId=1;Sid=$sid;Process=$script:req.Self}
    } {
        param($Plan);$script:req.Steps.Add('start')
        if($script:req.Cancel){throw ([ComponentModel.Win32Exception]::new(1223))}
        if($script:req.Fail -ceq 'start'){throw 'private_error'}
        if($script:req.NullStart){return $null};return $script:req.Child
    } {
        param($Target,$Route,$Id,$Control,$Caller,$Child)
        $script:req.Steps.Add('wait');if($script:req.Fail -ceq 'wait'){throw 'private_error'};return $script:req.Wait
    }
}
foreach($outcome in @('requested','unconfirmed','cancelled')){
    Case ('medium submission '+$outcome){
        Reset-Request
        $script:req.Wait=$outcome -ceq 'requested';$script:req.Cancel=$outcome -ceq 'cancelled'
        $r=Invoke-Request
        Check ($r.bundleSha256 -ceq $digest -and $r.operationId -ceq $id -and $r.control -ceq 'connect' -and $r.outcome -ceq $outcome) 'closed_correlated_submission'
        Check ($script:req.Self.Disposed -eq 1) 'caller_handle_disposed'
        if($script:req.Cancel){Check (($script:req.Steps -join ',') -ceq 'verify,capture,start') 'no_wait_after_cancel'}
        else{Check (($script:req.Steps -join ',') -ceq 'verify,capture,start,wait' -and $script:req.Child.Disposed -eq 1) 'one_launch_wait_then_dispose'}
    }
}
foreach($phase in @('verify','capture','start','wait')){
    Case ('submission failure '+$phase+' has no retry or raw error'){
        Reset-Request;$script:req.Fail=$phase;$r=Invoke-Request
        Check ($r.outcome -ceq 'unconfirmed' -and (ConvertTo-Json $r -Compress) -cnotmatch 'private_error') 'failure_not_claimed_or_leaked'
        Check (@($script:req.Steps|Where-Object{$_ -ceq 'start'}).Count -le 1) 'start_at_most_once'
    }
}
Case 'null child and nonboolean ACK do not become requested'{
    Reset-Request;$script:req.NullStart=$true
    Check ((Invoke-Request).outcome -ceq 'unconfirmed') 'null_start_unconfirmed'
    Check ($script:req.Steps -cnotcontains 'wait') 'null_start_no_wait'
    foreach($answer in @(1,'true',$null)){Reset-Request;$script:req.Wait=$answer;Check ((Invoke-Request).outcome -ceq 'unconfirmed') 'nonboolean_wait'}
}

# AST-only high orchestration with explicit binding/kernel/owner/task substitutes.
$scratch=[IO.Path]::Combine([IO.Path]::GetTempPath(),'ac-control-entry-'+[Guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($scratch)
$archivePath=Join-Path $scratch 'bundle.zip'
$null=[Reflection.Assembly]::Load('System.IO.Compression, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089')
$file=[IO.File]::Open($archivePath,'CreateNew','ReadWrite','None')
try{$zip=[IO.Compression.ZipArchive]::new($file,[IO.Compression.ZipArchiveMode]::Create,$true);$zip.Dispose()}finally{$file.Dispose()}
$script:high=$null
function Reset-High {
    $script:high=@{Steps=[Collections.Generic.List[string]]::new();Held=$null;Fail='';Calls=0;Progress=0;TaskRuns=0;ExpectedMode='control';ExpectedKind='connect';ExpectedTarget=$snapshot}
}
function Get-AdministratorControlEndpointBinding {
    param($ArchivePath,$Digest,$ScriptPath,$Sid,$ProgramFiles,$System)
    $script:high.Steps.Add('binding')
    if($script:high.Fail -ceq 'binding'){throw 'fixture_binding'}
    return @{Root=$script:root;Archive=$script:archivePath;Stager=$script:binding.Stager;Digest=$script:digest;Sid=$script:sid;
        Origin=('chrome-extension://'+('c'*32)+'/');System=$script:binding.System;Tunnel=('tunnel_'+('e'*32));Plan=@{Marker='fixed-plan'}}
}
function Assert-AdministratorControlEndpointBinding($Binding){
    $script:high.Steps.Add('verify')
    if($script:high.Fail -ceq 'verify'){throw 'fixture_verify'}
    Check ($Binding.Sid -ceq $script:sid -and $Binding.Origin -ceq ('chrome-extension://'+('c'*32)+'/')) 'selected_fixed_binding'
    return $true
}
function Get-Layout($Zip,$Root){
    $script:high.Steps.Add('layout')
    Check ($Zip -is [IO.Compression.ZipArchive] -and $Root -ceq $script:root) 'layout_from_held_archive'
    return @{Marker='full-layout'}
}
function Verify-SealedBundle($Root,$Layout,[scriptblock]$Progress){
    $script:high.Steps.Add('audit')
    Check ($Root -ceq $script:root -and $Layout.Marker -ceq 'full-layout') 'full_verifier_not_bypassed'
    $null=& $Progress 3 3
    if($script:high.Fail -ceq 'audit'){throw 'fixture_audit'}
}
function Assert-AdministratorOwnerWake($Root,$State,$Digest,$Sid,$Tunnel){
    $script:high.Steps.Add('wake-check')
    Check ($State -ceq ($script:root+'.state') -and $Sid -ceq $script:sid -and $Tunnel -ceq ('tunnel_'+('e'*32))) 'fixed_owner_metadata'
}
function Get-AdministratorControlEndpointTask($Plan){
    $script:high.Steps.Add('task-check');Check ($Plan.Marker -ceq 'fixed-plan') 'fixed_task_only'
    $task=[pscustomobject]@{Marker='task'}
    $task|Add-Member ScriptMethod Run {param($Args);$script:high.TaskRuns++;return [pscustomobject]@{Requested=$true}}
    return $task
}
function New-AdministratorLaunchPlan {param($BundleRoot,$StateRoot,[string]$ConnectCheckSid)
    $script:high.Steps.Add('startup-plan');Check ($ConnectCheckSid -ceq $script:sid) 'selected_startup_identity'
    return [Diagnostics.ProcessStartInfo]::new('fixture-only')
}
function Invoke-AdministratorOwnerConnectCheck($Check){$script:high.Steps.Add('startup-check');if($script:high.Fail -ceq 'startup'){throw 'fixture_startup'}}
function Assert-AdministratorBrowserTask($Task,$Plan,$Enabled){
    $script:high.Steps.Add('task-recheck');Check ($Task.Marker -ceq 'task' -and $Plan.Marker -ceq 'fixed-plan' -and $Enabled) 'task_rechecked_before_rpc'
}
function Invoke-AdministratorControlKernelOperation {
    param($Archive,$CompilerTemp,$BundleRoot,$Digest,$Origin,$Id,$Control,$Mode,$Target,$CallerPid,$CallerStarted,$SessionId,$Sid,$VerifyBinding,$Audit,$CheckStartup,$RequestTask)
    $h=$script:high;$h.Steps.Add('kernel');$h.Calls++;$h.Held=$Archive
    Check ($Archive -is [IO.FileStream] -and $Archive.CanRead -and -not $Archive.CanWrite) 'read_only_held_archive'
    Refuse {$writer=[IO.File]::Open($script:archivePath,'Open','Write','ReadWrite');$writer.Dispose()} 'archive_write_denied_while_held'
    Check ($BundleRoot -ceq $script:root -and $Digest -ceq $script:digest -and $Id -ceq $script:id -and $Sid -ceq $script:sid) 'original_kernel_identity'
    Check ($CompilerTemp -ceq ($script:root+'.state\temp') -and $Mode -ceq $h.ExpectedMode -and $Control -ceq $h.ExpectedKind) 'derived_kernel_mode'
    Check ($Target -ceq $h.ExpectedTarget -and $CallerPid -eq 500 -and $CallerStarted -ceq $script:caller.Started -and $SessionId -eq 1) 'exact_target_caller'
    Check ((& $VerifyBinding) -eq $true) 'binding_callback_true'
    if($Mode -ceq 'control' -and $Control -cne 'revoke'){
        $null=& $Audit {param($Done,$Total);Check ($Done -eq 3 -and $Total -eq 3) 'progress_forwarded';$script:high.Progress++}
        Check ((& $CheckStartup) -eq $true) 'startup_true'
        Check ((& $VerifyBinding) -eq $true) 'later_binding_true'
        Check ((& $RequestTask) -eq $true) 'fixed_task_requested'
    }
    return @{bundleSha256=$Digest;operationId=$Id;control=$Control;state='reserved';progress=$null}
}
function Invoke-High($Vector){
    $script:high.ExpectedMode=$Vector[3];$script:high.ExpectedKind=$Vector[1];$script:high.ExpectedTarget=Target-For $Vector
    return Invoke-AdministratorBrowserControlEndpoint $Vector[0] $script:archivePath $script:digest $script:binding.Stager $script:id $Vector[1] `
        (Target-For $Vector) 500 $script:caller.Started 1 $script:sid 'C:\Program Files' $script:binding.System
}
try{
    foreach($v in $vectors|Where-Object{$_[2] -ceq 'high'}){
        Case ('high entry selected path '+$v[0]+'/'+$v[1]){
            Reset-High;$r=Invoke-High $v
            Check ($r.operationId -ceq $id -and $script:high.Calls -eq 1) 'one_original_kernel_dispatch'
            Check (-not $script:high.Held.CanRead) 'held_archive_disposed_after_dispatch'
            if($v[3] -ceq 'control' -and $v[1] -cne 'revoke'){
                Check ($script:high.TaskRuns -eq 1 -and $script:high.Progress -eq 1) 'startup_once'
                Check (($script:high.Steps -join ',') -ceq 'binding,kernel,verify,layout,audit,wake-check,task-check,startup-plan,startup-check,verify,task-recheck') 'fixed_callback_order'
            }else{Check ($script:high.TaskRuns -eq 0 -and ($script:high.Steps -join ',') -ceq 'binding,kernel,verify') 'no_startup_callbacks_for_denial_or_recovery'}
        }
    }
    foreach($fail in @('binding','verify','audit','startup')){
        Case ('high failure '+$fail+' releases archive without task'){
            Reset-High;$script:high.Fail=$fail
            Refuse {Invoke-High $vectors[5]} 'high_error_propagates'
            Check ($script:high.TaskRuns -eq 0) 'no_task_on_failed_precondition'
            if($script:high.Held){Check (-not $script:high.Held.CanRead) 'failure_disposes_stream'}
        }
    }
    Case 'public entry declares fixed eight actions and caller parameters'{
        $action=$ast.ParamBlock.Parameters|Where-Object{$_.Name.VariablePath.UserPath -ceq 'Action'}
        $set=@($action.Attributes|Where-Object{$_.TypeName.Name -ceq 'ValidateSet'})[0]
        $actual=@($set.PositionalArguments|ForEach-Object{$_.Value})
        foreach($actionName in @($vectors|ForEach-Object{$_[0]}|Select-Object -Unique)){Check ($actual -ccontains $actionName) 'fixed_action_declared'}
        foreach($name in @('BrowserControlTarget','ControlCallerPid','ControlCallerCreated','ExpectedSessionId')){
            Check (@($ast.ParamBlock.Parameters|Where-Object{$_.Name.VariablePath.UserPath -ceq $name}).Count -eq 1) 'new_parameter_declared'
        }
    }
    # Run the real metadata/binding functions with a declared in-memory sealed-FS oracle.
    foreach($name in @('Get-AdministratorControlEndpointBinding','Assert-AdministratorControlEndpointBinding','New-AdministratorBrowserEnrollmentPlan')){
        $node=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
        . ([scriptblock]::Create($node.Extent.Text))
    }
    function Reset-Metadata {
        $p=New-AdministratorBrowserEnrollmentPlan $script:root $script:digest $script:sid ('tunnel_'+('e'*32)) ('c'*32) 'C:\Windows\System32'
        $script:meta=@{Plan=$p;Bytes=@{};Pending=$false;Fail='';Assets=0;PrivateAssets=0;Registries=0;IdentityChecks=0}
        foreach($name in $p.Files.Keys){$script:meta.Bytes[[IO.Path]::Combine($p.Bridge,$name)]=$p.Files[$name]}
        $script:meta.Bytes[$p.DemandScript]=$p.DemandBytes
        $script:meta.Bytes[$p.DemandBinding]=$p.DemandBindingBytes
    }
    function Assert-AdministratorBrowserPauseAnchors($ProgramFiles,$System){Check ($ProgramFiles -ceq 'C:\Program Files' -and $System -ceq 'C:\Windows\System32') 'canonical_endpoint_anchors'}
    function Assert-AdministratorBrowserIdentity($Sid){$script:meta.IdentityChecks++;Check ($Sid -ceq $script:sid) 'actual_identity_callback_selected_sid';if($script:meta.Fail -ceq 'identity'){throw 'fixture_identity'}}
    function Assert-SealedAcl {param($Path,$Directory,$Private=$false,$ReaderSid='');if($script:meta.Fail -ceq 'acl'){throw 'fixture_acl'}}
    function Assert-AdministratorOwnerControlIdentity($Root,$Digest,$Sid){Check ($Root -ceq $script:root -and $Digest -ceq $script:digest -and $Sid -ceq $script:sid) 'selected_owner_identity'}
    function Read-AdministratorBrowserCommit($Bridge,$Digest,$Sid){if($script:meta.Fail -ceq 'commit'){throw 'fixture_commit'};Check ($Bridge -ceq ($script:root+'.browser') -and $Digest -ceq $script:digest -and $Sid -ceq $script:sid) 'committed_binding_identity'}
    function Test-AdministratorOwnerAbsent($Path){return -not $script:meta.Pending}
    function Read-AdministratorControlBytes($Path,$Private,$Sid){
        Check ($Sid -ceq $script:sid) 'metadata_read_for_selected_sid'
        if($Path.EndsWith('\demand.json',[StringComparison]::Ordinal)){Check ($Private -is [bool] -and $Private) 'demand_metadata_private'}
        else{Check ($Private -is [bool] -and -not $Private) 'binding_metadata_public'}
        if(-not $script:meta.Bytes.ContainsKey($Path)){throw 'fixture_missing_metadata'}
        return ,$script:meta.Bytes[$Path]
    }
    function Assert-AdministratorBrowserAsset($Path,$Expected,$Sid,$Private=$false){
        $script:meta.Assets++;if($Private){$script:meta.PrivateAssets++}
        Check ($Sid -ceq $script:sid -and $script:meta.Bytes.ContainsKey($Path)) 'exact_expected_asset_path'
        if([Convert]::ToBase64String($script:meta.Bytes[$Path]) -cne [Convert]::ToBase64String($Expected)){throw 'fixture_asset_mismatch'}
    }
    function Assert-AdministratorBrowserRegistry($Plan,$Registered){
        $script:meta.Registries++;Check ($Registered -is [bool] -and $Registered -and $Plan.Sid -ceq $script:sid) 'exact_registered_owner'
        if($script:meta.Fail -ceq 'registry'){throw 'fixture_unregistered'}
    }
    function Open-AdministratorBrowserPauseAsset($Path,$Sid){return [IO.MemoryStream]::new([byte[]]@(1))}
    function Read-AdministratorBrowserPauseMetadata($Stream,$Digest,$Sid){if($script:meta.Fail -ceq 'pin'){throw 'fixture_pin'};return 'f'*64}
    function Read-AdministratorBrowserPauseAssetHash($Stream,$Limit){if($script:meta.Fail -ceq 'stager-hash'){return '0'*64};return 'f'*64}
    function Read-MetadataBinding {
        return Get-AdministratorControlEndpointBinding $script:binding.Archive $script:digest $script:binding.Stager $script:sid 'C:\Program Files' 'C:\Windows\System32'
    }
    Case 'real binding parser derives origin tunnel plan and verifies exact assets'{
        Reset-Metadata;$b=Read-MetadataBinding
        Check ($b.Root -ceq $root -and $b.Origin -ceq ('chrome-extension://'+('c'*32)+'/') -and $b.Tunnel -ceq ('tunnel_'+('e'*32))) 'parsed_sealed_identity'
        Check ($script:meta.Assets -eq 5 -and $script:meta.PrivateAssets -eq 1 -and $script:meta.Registries -eq 1 -and $script:meta.IdentityChecks -eq 1) 'all_public_private_assets_and_identity_verified'
        Check ((Assert-AdministratorControlEndpointBinding $b) -eq $true -and $script:meta.Registries -eq 2) 'later_binding_rechecks_not_cached'
    }
    foreach($fail in @('identity','acl','commit','registry','pin','stager-hash')){
        Case ('binding failure refuses '+$fail){Reset-Metadata;$script:meta.Fail=$fail;Refuse {Read-MetadataBinding} 'untrusted_binding_refused'}
    }
    Case 'pending enrollment refuses before any registry verification'{
        Reset-Metadata;$script:meta.Pending=$true
        Refuse {Read-MetadataBinding} 'incomplete_enrollment_refused'
        Check ($script:meta.Registries -eq 0) 'no_registry_after_pending'
    }
    foreach($fileName in @('binding.json','demand.json')){
        foreach($mutation in @('extra','version','digest','system','collection')){
            Case ('closed metadata '+$fileName+'/'+$mutation){
                Reset-Metadata;$path=Join-Path $script:meta.Plan.Bridge $fileName
                $row=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString($script:meta.Bytes[$path]))
                switch($mutation){
                    'extra'{$row|Add-Member NoteProperty untrusted 'private-sentinel'}
                    'version'{}
                    'digest'{$row.bundleSha256='b'*64}
                    'system'{$row.systemDirectory='C:\Wrong\System32'}
                    'collection'{if($fileName -ceq 'binding.json'){$row.origin=@($row.origin)}else{$row.tunnelId=@($row.tunnelId)}}
                }
                $text=(ConvertTo-Json $row -Depth 4 -Compress)+[char]10
                if($mutation -ceq 'version'){
                    $changed=$text.Replace('"version":1,','"version":1.0,')
                    Check ($changed -cne $text) 'literal_fractional_version_reached_parser'
                    $text=$changed
                }
                $script:meta.Bytes[$path]=[Text.Encoding]::UTF8.GetBytes($text)
                Refuse {Read-MetadataBinding} 'mutated_metadata_refused'
            }
        }
    }
    Case 'parsed but noncanonical metadata bytes are rejected by reconstructed plan'{
        Reset-Metadata;$path=Join-Path $script:meta.Plan.Bridge 'binding.json'
        $script:meta.Bytes[$path]=[Text.Encoding]::UTF8.GetBytes(' '+[Text.Encoding]::UTF8.GetString($script:meta.Bytes[$path]))
        Refuse {Read-MetadataBinding} 'canonical_assets_required'
    }
}finally{
    $resolved=[IO.Path]::GetFullPath($scratch)
    if(-not $resolved.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolved) -cnotmatch '\Aac-control-entry-[a-f0-9]{32}\z'){throw 'cleanup_scope'}
    if(Test-Path -LiteralPath $resolved){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
ConvertTo-Json -Compress -Depth 5 ([ordered]@{ok=($script:failures.Count -eq 0);cases=$script:cases;checks=$script:checks;
    failures=$script:failures.ToArray();scope='ast-and-scratch-entry-with-owner-os-kernel-task-stubs-not-native-acceptance';
    actualArchiveFileExclusion=$true;positiveHighPairStub=$true;bindingMetadataOracle=$true;actualUac=$false;protectedAcceptance=$false;
    actualMediumCallerObserved=($script:actualMediumCallerObserved -eq $true);
    fixtureSubstitutions=@('process-start-and-wait-handles','owner-identity-and-acl','registry-and-enrollment-oracle',
        'scheduler-task-and-startup','kernel-admission','orchestration-full-verifier','orchestration-sealed-binding');
    stagerSha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()})
if($script:failures.Count){exit 1}
