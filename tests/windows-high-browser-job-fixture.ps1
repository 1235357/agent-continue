[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$PlanFile,
      [Parameter(Mandatory=$true)][string]$ExpectedPlanSha256,
      [switch]$CleanupOnly)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=$state=$job=$outside=$rootProcess=$null
$created=$false
$ok=$false
$settled=@()
$control=$null
$phase='identity'
$cleanupError='none'
function Hash-Bytes([byte[]]$Bytes) {
    $sha=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function Read-Pinned([string]$File,[string]$Expected,[long]$Limit) {
    if($Expected -cnotmatch '\A[a-f0-9]{64}\z' -or
       ([IO.File]::GetAttributes($File) -band [IO.FileAttributes]::ReparsePoint)){throw 'fixture_input'}
    $s=[IO.File]::Open($File,'Open','Read','Read')
    try {
        if($s.Length -lt 1 -or $s.Length -gt $Limit){throw 'fixture_input_size'}
        $b=[byte[]]::new([int]$s.Length);$n=0
        while($n -lt $b.Length){$r=$s.Read($b,$n,$b.Length-$n);if($r -le 0){throw 'fixture_input_read'};$n+=$r}
        if((Hash-Bytes $b) -cne $Expected){throw 'fixture_input_hash'}
        return ,$b
    } finally {$s.Dispose()}
}
function Fixture-Acl([bool]$Directory) {
    $a=if($Directory){[Security.AccessControl.DirectorySecurity]::new()}else{[Security.AccessControl.FileSecurity]::new()}
    $a.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    $a.SetAccessRuleProtection($true,$false)
    foreach($pair in @(@('S-1-5-18','FullControl'),@('S-1-5-32-544','FullControl'),@('S-1-5-32-545','ReadAndExecute'))){
        # CodeDom creates its own temp subdirectories; an empty inherited DACL
        # denies even this elevated fixture access to those children.
        $inherit=if($Directory){'ContainerInherit,ObjectInherit'}else{'None'}
        $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new($pair[0]),$pair[1],$inherit,'None','Allow'))
    }
    return $a
}
function New-FixtureDirectory([string]$Path) {
    if([IO.Directory]::Exists($Path) -or [IO.File]::Exists($Path)){throw 'fixture_existing_target'}
    $null=[IO.Directory]::CreateDirectory($Path,(Fixture-Acl $true))
}
function Write-FixtureFile([string]$Path,[byte[]]$Bytes) {
    $s=[IO.FileStream]::new($Path,'CreateNew',[Security.AccessControl.FileSystemRights]::Write,
        [IO.FileShare]::Read,65536,[IO.FileOptions]::None,(Fixture-Acl $false))
    try {$s.Write($Bytes,0,$Bytes.Length);$s.Flush($true)}finally{$s.Dispose()}
}
function Publish([string]$Name,$Value) {
    $b=[Text.UTF8Encoding]::new($false).GetBytes((ConvertTo-Json -InputObject $Value -Depth 6 -Compress))
    $s=[IO.File]::Open((Join-Path $control $Name),'CreateNew','Write','Read')
    try {$s.Write($b,0,$b.Length);$s.Flush($true)}finally{$s.Dispose()}
}
function Wait-FixtureFile([string]$Name,[int]$Seconds) {
    $watch=[Diagnostics.Stopwatch]::StartNew()
    $file=Join-Path $control $Name
    while(-not [IO.File]::Exists($file)) {
        if([IO.File]::Exists((Join-Path $control 'stop'))){throw 'fixture_stopped'}
        if($watch.Elapsed.TotalSeconds -gt $Seconds){throw 'fixture_request_timeout'}
        Start-Sleep -Milliseconds 25
    }
    return $file
}
function Repair-EmptyFixtureTempAcl([string]$StateRoot) {
    $temp=[IO.Path]::Combine($StateRoot,'temp')
    $pending=[Collections.Generic.Stack[string]]::new();$pending.Push($temp)
    $seen=0
    while($pending.Count){
        $p=$pending.Pop();$full=[IO.Path]::GetFullPath($p)
        if(++$seen -gt 100 -or ($full -cne $temp -and -not $full.StartsWith(($temp+'\'),[StringComparison]::Ordinal))){throw 'fixture_temp_cleanup_bounds'}
        $attributes=[IO.File]::GetAttributes($full)
        if($attributes -band [IO.FileAttributes]::ReparsePoint){throw 'fixture_temp_cleanup_reparse'}
        $directory=[bool]($attributes -band [IO.FileAttributes]::Directory)
        $acl=if($directory){[IO.Directory]::GetAccessControl($full)}else{[IO.File]::GetAccessControl($full)}
        $descriptor=[Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(),0)
        if($descriptor.Owner.Value -cne 'S-1-5-32-544' -or $null -eq $descriptor.DiscretionaryAcl){throw 'fixture_temp_cleanup_owner'}
        if($descriptor.DiscretionaryAcl.Count -eq 0){
            # The owner has implicit WRITE_DAC, not WRITE_OWNER on an empty DACL.
            # Preserve the existing owner instead of setting it again.
            $acl.SetAccessRuleProtection($true,$false)
            $inherit=if($directory){'ContainerInherit,ObjectInherit'}else{'None'}
            foreach($pair in @(@('S-1-5-18','FullControl'),@('S-1-5-32-544','FullControl'),@('S-1-5-32-545','ReadAndExecute'))){
                $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
                    [Security.Principal.SecurityIdentifier]::new($pair[0]),$pair[1],$inherit,'None','Allow'))
            }
            if($directory){[IO.Directory]::SetAccessControl($full,$acl)}
            else{[IO.File]::SetAccessControl($full,$acl)}
        }
        if($directory){foreach($member in [IO.Directory]::EnumerateFileSystemEntries($full)){$pending.Push($member)}}
    }
}
try {
    if($PSVersionTable.PSEdition -cne 'Desktop' -or -not [Environment]::Is64BitProcess){throw 'fixture_host'}
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        if(-not [Security.Principal.WindowsPrincipal]::new($identity).IsInRole(
            [Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'fixture_not_high'}
        $sid=$identity.User.Value
    } finally {$identity.Dispose()}
    $phase='plan'
    $plan=([Text.UTF8Encoding]::new($false,$true).GetString((Read-Pinned $PlanFile $ExpectedPlanSha256 65536)))|ConvertFrom-Json
    if($plan.format -cne 'ac-high-browser-job-fixture-v1' -or $plan.id -cnotmatch '\A[a-f0-9]{24}\z' -or
       $plan.sid -cne $sid -or $plan.origin -cnotmatch '\Achrome-extension://[a-p]{32}/\z' -or
       $plan.nodeSha256 -cne 'dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f'){
        throw 'fixture_plan'
    }
    $control=[IO.Path]::GetFullPath([IO.Path]::GetDirectoryName($PlanFile))
    if([IO.Path]::GetFileName($control) -cne ('ac-high-browser-job-'+$plan.id) -or
       ([IO.File]::GetAttributes($control) -band [IO.FileAttributes]::ReparsePoint)){throw 'fixture_control'}
    $base=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'AgentContinueAdmin'
    $root=Join-Path $base $plan.id
    $state=$root+'.state'
    $expectedNames=@('windows-admin-browser-host.mjs','windows-admin-browser-session.mjs','windows-browser-peer.cs',
        'windows-browser-peer.ps1','windows-owner-job.cs','inert-root.mjs')
    if($plan.files.Count -ne $expectedNames.Count){throw 'fixture_sources'}
    $sources=@{}
    foreach($entry in $plan.files){
        if($entry.name -cnotin $expectedNames -or $sources.ContainsKey($entry.name)){throw 'fixture_sources'}
        $sources[$entry.name]=Read-Pinned (Join-Path (Join-Path $control 'input') $entry.name) $entry.sha256 131072
    }
    $phase='sources'
    $nodeBytes=Read-Pinned $plan.nodeSource $plan.nodeSha256 128MB
    if($CleanupOnly){
        foreach($entry in $plan.files){
            $target=Join-Path $root ('app\'+$entry.name)
            if([IO.File]::Exists($target)){$null=Read-Pinned $target $entry.sha256 131072}
        }
        if([IO.File]::Exists((Join-Path $root 'runtime\node.exe'))){$null=Read-Pinned (Join-Path $root 'runtime\node.exe') $plan.nodeSha256 128MB}
        $matches=@(Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='powershell.exe'" | Where-Object {
            $_.ExecutablePath -and $_.ExecutablePath.StartsWith(($root+'\'),[StringComparison]::OrdinalIgnoreCase)
        })
        if($matches.Count){throw 'fixture_processes_still_live'}
        Repair-EmptyFixtureTempAcl $state
        $created=$true
        $ok=$true
        return
    }
    $phase='stage'
    if([IO.Directory]::Exists($state) -or [IO.File]::Exists($state)){throw 'fixture_existing_state'}
    New-FixtureDirectory $root
    $created=$true
    New-FixtureDirectory (Join-Path $root 'app')
    New-FixtureDirectory (Join-Path $root 'runtime')
    New-FixtureDirectory $state
    New-FixtureDirectory (Join-Path $state 'temp')
    $node=Join-Path $root 'runtime\node.exe'
    Write-FixtureFile $node $nodeBytes
    foreach($name in $sources.Keys){Write-FixtureFile (Join-Path $root ('app\'+$name)) $sources[$name]}
    Add-Type -TypeDefinition ([Text.UTF8Encoding]::new($false,$true).GetString($sources['windows-owner-job.cs']))
    $outsidePlan=[Diagnostics.ProcessStartInfo]::new($node,'-e "setInterval(()=>{},1000)"')
    $outsidePlan.UseShellExecute=$false;$outsidePlan.CreateNoWindow=$true
    $outside=[Diagnostics.Process]::Start($outsidePlan)
    $null=$outside.Handle
    Publish 'broker-ready.json' @{pid=$PID;sid=$sid;outsidePid=$outside.Id;sealedFixture=$true;session=[Diagnostics.Process]::GetCurrentProcess().SessionId}
    for($index=1;$index -le 2;$index++) {
        $phase='request'
        $request=Wait-FixtureFile ('request-'+$index+'.txt') 100
        $generation=[IO.File]::ReadAllText($request)
        if($generation -cnotmatch '\A[a-f0-9]{32}\z' -or $settled -ccontains $generation){throw 'fixture_generation'}
        $launch=[Diagnostics.ProcessStartInfo]::new($node,('"'+(Join-Path $root 'app\inert-root.mjs')+'" '+$generation))
        $launch.UseShellExecute=$false;$launch.CreateNoWindow=$true;$launch.WorkingDirectory=$base
        $launch.EnvironmentVariables.Clear()
        foreach($name in @('SystemRoot','WINDIR')){$launch.EnvironmentVariables[$name]=$env:SystemRoot}
        $system=[Environment]::SystemDirectory
        $launch.EnvironmentVariables['PATH']=$system+';'+(Join-Path $system 'WindowsPowerShell\v1.0')
        $launch.EnvironmentVariables['PATHEXT']='.COM;.EXE;.BAT;.CMD'
        $launch.EnvironmentVariables['ComSpec']=Join-Path $system 'cmd.exe'
        $launch.EnvironmentVariables['TEMP']=Join-Path $state 'temp';$launch.EnvironmentVariables['TMP']=Join-Path $state 'temp'
        $job=[AgentContinue.WindowsOwnerJob]::new()
        try {
            $phase='job_start'
            $job.Start($launch)
            $rootProcess=[Diagnostics.Process]::GetProcessById([int]$job.RootProcessId)
            $null=$rootProcess.Handle
            $phase='wait_ready'
            $watch=[Diagnostics.Stopwatch]::StartNew()
            while(-not $job.WaitForRoot(25) -and -not [IO.File]::Exists((Join-Path $control ('ready-'+$generation+'.json')))) {
                if([IO.File]::Exists((Join-Path $control 'stop')) -or $watch.Elapsed.TotalSeconds -gt 45){throw 'fixture_start_timeout'}
            }
            $phase='membership'
            if($job.WaitForRoot(0) -or $job.ActiveCount() -lt 3 -or $job.ContainsProcess($outside.SafeHandle) -or
               -not $job.ContainsProcess($rootProcess.SafeHandle)){throw 'fixture_job_membership'}
            Publish ('job-ready-'+$generation+'.json') @{generation=$generation;rootPid=$rootProcess.Id;
                rootCreatedTicks=$rootProcess.StartTime.ToUniversalTime().Ticks.ToString();active=$job.ActiveCount();outsideAlive=(-not $outside.HasExited)}
            $phase='wait_exit'
            $watch.Restart()
            while(-not $job.WaitForRoot(25)){
                if([IO.File]::Exists((Join-Path $control 'stop')) -or $watch.Elapsed.TotalSeconds -gt 90){throw 'fixture_close_timeout'}
            }
            $phase='drain'
            $code=$job.RootExitCode()
            if($code -ne 0 -or -not $job.Drain(7000) -or $job.ActiveCount() -ne 0 -or
               -not $rootProcess.WaitForExit(1000) -or $outside.HasExited){throw 'fixture_job_drain'}
            Publish ('settled-'+$generation+'.json') @{generation=$generation;rootPid=$rootProcess.Id;rootExit=$code;
                jobActive=0;outsideAlive=$true;settledAtUtc=[DateTime]::UtcNow.ToString('o')}
            $settled+=,$generation
        } finally {
            if($job){$null=$job.Drain(7000);$job.Dispose();$job=$null}
            if($rootProcess){$rootProcess.Dispose();$rootProcess=$null}
        }
    }
    $phase='release'
    $null=Wait-FixtureFile 'release' 40
    $ok=$true
} catch {
    if($control){
        try{Publish $(if($CleanupOnly){'cleanup-'+$PID+'-error.json'}else{'broker-error.json'}) @{
            code='fixture_failed';phase=$phase;errorType=$_.Exception.GetBaseException().GetType().Name;settled=$settled.Count
        }}catch{}
        if(-not $CleanupOnly){
            $wait=[Diagnostics.Stopwatch]::StartNew()
            while(-not [IO.File]::Exists((Join-Path $control 'stop')) -and $wait.Elapsed.TotalSeconds -lt 30){Start-Sleep -Milliseconds 50}
        }
    }
} finally {
    if($job){try{$null=$job.Drain(7000)}finally{$job.Dispose()}}
    if($outside){try{if(-not $outside.HasExited){$outside.Kill();$null=$outside.WaitForExit(7000)}}finally{$outside.Dispose()}}
    $removed=$false
    if($created){
        try {
            foreach($target in @($state,$root)){
                $full=[IO.Path]::GetFullPath($target)
                if([IO.Path]::GetDirectoryName($full) -cne $base -or
                   [IO.Path]::GetFileName($full) -cnotmatch ('\A'+$plan.id+'(?:\.state)?\z')){throw 'fixture_cleanup_target'}
                if(-not [IO.Directory]::Exists($full)){continue}
                $stack=[Collections.Generic.Stack[string]]::new();$stack.Push($full)
                while($stack.Count){
                    $current=$stack.Pop()
                    if([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint){throw 'fixture_cleanup_reparse'}
                    foreach($member in [IO.Directory]::EnumerateFileSystemEntries($current)){
                        $attributes=[IO.File]::GetAttributes($member)
                        if($attributes -band [IO.FileAttributes]::ReparsePoint){throw 'fixture_cleanup_reparse'}
                        if($attributes -band [IO.FileAttributes]::Directory){$stack.Push($member)}
                    }
                }
                [IO.Directory]::Delete($full,$true)
            }
            $removed=$true
        }catch{$cleanupError=$_.Exception.GetBaseException().GetType().Name;$ok=$false}
    }
    if($control){try{Publish $(if($CleanupOnly){'cleanup-'+$PID+'-complete.json'}else{'broker-complete.json'}) @{
        ok=$ok;settled=$settled.Count;fixtureRemoved=$removed;pid=$PID;cleanupError=$cleanupError
    }}catch{$ok=$false}}
    if($CleanupOnly){if($ok){exit 0}else{exit 2}}
}
if($ok){exit 0}else{exit 2}
