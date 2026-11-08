[CmdletBinding()]
param(
    [ValidateSet('Plan','Start')][string]$Action = 'Plan',
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedStagerSha256,
    [string]$Consent = ''
)

$ErrorActionPreference = 'Stop'
$receipt = [ordered]@{
    ok=$false; phase='input'; mediumVerified=$false; elevatedRegistrationVerified=$false
    mediumMutationDenied=$false; mediumRunRequested=$false; elevatedActionVerified=$false
    cleaned=$null; registryChanged=$false; tunnelStarted=$false
}
$child = $null
$parent = $null
$folderName = ''

function Get-WitnessComCode($ErrorRecord) {
    return ($ErrorRecord.Exception.GetBaseException().HResult -band 65535)
}

try {
    if (($Action -eq 'Plan' -and $Consent) -or
        ($Action -eq 'Start' -and $Consent -cne 'accept-one-inert-administrator-demand-witness')) { throw 'consent' }
    $receipt.phase = 'source'
    $sourcePath = [IO.Path]::Combine($PSScriptRoot,'Stage-WindowsAdministratorBundle.ps1')
    $bytes = [IO.File]::ReadAllBytes($sourcePath)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
    if ($hash -cne $ExpectedStagerSha256) { throw 'stager_digest' }
    $parseErrors = $null
    $tokens = $null
    $ast = [Management.Automation.Language.Parser]::ParseInput([Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xFEFF),
        [ref]$tokens,[ref]$parseErrors)
    if ($parseErrors.Count) { throw 'stager_parse' }
    $names = @('New-AdministratorBrowserTaskDefinition','Assert-AdministratorBrowserTaskAcl','Assert-AdministratorBrowserTask',
        'Get-AdministratorBrowserComItem','Remove-AdministratorBrowserEndpoints')
    $functions = @($ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -in $names },$true))
    if ($functions.Count -ne $names.Count -or @($functions.Name | Sort-Object -Unique).Count -ne $names.Count) {
        throw 'stager_functions'
    }
    $definitionCode = ($functions | ForEach-Object { $_.Extent.Text }) -join [char]10
    . ([scriptblock]::Create($definitionCode))

    $receipt.phase = 'identity'
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        $sid = $identity.User.Value
        $admin = [Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } finally { $identity.Dispose() }
    $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
    $shell = [IO.Path]::Combine($system,'WindowsPowerShell','v1.0','powershell.exe')
    $session = [Diagnostics.Process]::GetCurrentProcess().SessionId
    $groups = & ([IO.Path]::Combine($system,'whoami.exe')) /groups /fo csv /nh
    $integrity = [regex]::Matches(($groups -join [char]10),'(?:^|,)"S-1-16-([0-9]{1,5})"(?=,|$)')
    if ($LASTEXITCODE -ne 0 -or $integrity.Count -ne 1 -or $admin -or
        [int]$integrity[0].Groups[1].Value -lt 8192 -or [int]$integrity[0].Groups[1].Value -ge 12288 -or
        $session -lt 1 -or $sid -cnotmatch '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z') { throw 'standard_interactive_required' }
    $receipt.mediumVerified = $true

    $folderName = 'AgentContinueDemandWitness-' + [guid]::NewGuid().ToString('N')
    $random = [byte[]]::new(4)
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($random) } finally { $rng.Dispose() }
    $nonce = 65536 + ([BitConverter]::ToUInt32($random,0) -band 0xffffff)
    $sddl = 'O:BAG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FRFX;;;' + $sid + ')'
    $actionSource = @'
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
try {
    $id=[Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        $admin=[Security.Principal.WindowsPrincipal]::new($id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        if(-not $admin -or $id.User.Value -cne '__SID__' -or
            [Diagnostics.Process]::GetCurrentProcess().SessionId -ne __SESSION__){exit 61}
    } finally {$id.Dispose()}
    $system=[Environment]::GetFolderPath([Environment+SpecialFolder]::System)
    $groups=& ([IO.Path]::Combine($system,'whoami.exe')) /groups /fo csv /nh
    $integrity=[regex]::Matches(($groups -join [char]10),'(?:^|,)"S-1-16-([0-9]{1,5})"(?=,|$)')
    if($LASTEXITCODE -ne 0 -or $integrity.Count -ne 1 -or
        [int]$integrity[0].Groups[1].Value -lt 12288 -or [int]$integrity[0].Groups[1].Value -ge 16384){exit 62}
    exit __NONCE__
} catch {exit 63}
'@
    $actionSource = $actionSource.Replace('__SID__',$sid).Replace('__SESSION__',[string]$session).Replace('__NONCE__',[string]$nonce)
    $actionArguments = '-NoLogo -NoProfile -NonInteractive -EncodedCommand ' +
        [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($actionSource))
    if ($shell -notmatch '\A[A-Za-z]:\\Windows\\System32\\[a-zA-Z0-9.\\]+\z') { throw 'witness_system_path' }
    $arguments = '/D /S /C ""{0}" {1}"' -f $shell,$actionArguments
    $plan = [pscustomobject]@{Folder=$folderName;Name='Demand';Program=[IO.Path]::Combine($system,'cmd.exe');
        Arguments=$arguments;System=$system;Sid=$sid;Sddl=$sddl}

    $elevatedSource = @'
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
__DEFINITIONS__
$ownedFolder=$false
$ownedTask=$false
$parent=$null
$folder=$null
$task=$null
$outcome=51
$enabledExpected=$false
try {
    $id=[Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        if($id.User.Value -cne '__SID__' -or
            -not [Security.Principal.WindowsPrincipal]::new($id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -or
            [Diagnostics.Process]::GetCurrentProcess().SessionId -ne __SESSION__){exit 52}
    } finally {$id.Dispose()}
    $system=[Environment]::GetFolderPath([Environment+SpecialFolder]::System)
    Import-Module -Name ([IO.Path]::Combine($system,'WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1'))
    $planData=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__PLAN__'))
    $plan=ConvertFrom-Json -InputObject $planData
    $scheduler=New-Object -ComObject Schedule.Service
    $scheduler.Connect()
    $parent=$scheduler.GetFolder('\')
    $definition=New-AdministratorBrowserTaskDefinition $scheduler $plan
    $folder=$parent.CreateFolder($plan.Folder,$plan.Sddl)
    $ownedFolder=$true
    Assert-AdministratorBrowserTaskAcl ($folder.GetSecurityDescriptor(5)) $plan.Sddl
    $null=$folder.RegisterTaskDefinition($plan.Name,$definition,0x32,$plan.Sid,$null,3,$plan.Sddl)
    $ownedTask=$true
    $task=$folder.GetTask($plan.Name)
    Assert-AdministratorBrowserTask $task $plan $false
    if($task.LastTaskResult -eq __NONCE__){throw 'witness_already_recorded'}
    $task.Enabled=$true
    $enabledExpected=$true
    $task=$folder.GetTask($plan.Name)
    Assert-AdministratorBrowserTask $task $plan $true
    $outcome=53
    $watch=[Diagnostics.Stopwatch]::StartNew()
    while($watch.ElapsedMilliseconds -lt 30000){
        $task=$folder.GetTask($plan.Name)
        if($task.LastTaskResult -eq __NONCE__){$outcome=__NONCE__;break}
        [Threading.Thread]::Sleep(100)
    }
} catch {
    if($_.Exception.Message -eq 'browser_task_acl'){$outcome=54}
    elseif($_.Exception.Message -in @('browser_task_definition','browser_task_action')){
        $outcome=55
        if($task){
            $d=$task.Definition
            $s=$d.Settings
            $p=$d.Principal
            $differences=@(
                ($task.Path -cne ('\'+$plan.Folder+'\'+$plan.Name)),
                ([bool]$task.Enabled -ne $enabledExpected),
                ([bool]$s.Enabled -ne $enabledExpected),
                ($d.Triggers.Count -ne 0),
                ($d.Actions.Count -ne 1),
                ($p.LogonType -ne 3),
                ($p.RunLevel -ne 1),
                (-not $s.AllowDemandStart),
                ($s.StartWhenAvailable -or $s.RunOnlyIfIdle -or $s.RunOnlyIfNetworkAvailable),
                ($s.DisallowStartIfOnBatteries -or $s.StopIfGoingOnBatteries -or $s.WakeToRun),
                ($s.MultipleInstances -ne 2),
                ($s.RestartCount -ne 0),
                ($s.ExecutionTimeLimit -cne 'PT0S')
            )
            $outcome=536870912
            for($i=0;$i -lt $differences.Count;$i++){
                if($differences[$i]){$outcome=$outcome -bor (1 -shl $i)}
            }
            if($_.Exception.Message -eq 'browser_task_action'){$outcome=$outcome -bor (1 -shl 13)}
            if($enabledExpected){$outcome=$outcome -bor (1 -shl 14)}
        }
    }
    else {$outcome=56}
} finally {
    if($ownedTask){
        try {
            $task=$folder.GetTask($plan.Name)
            $task.Enabled=$false
            $task=$folder.GetTask($plan.Name)
            Assert-AdministratorBrowserTask $task $plan $false
            if($task.GetInstances(0).Count -gt 0){$task.Stop(0)}
            $drain=[Diagnostics.Stopwatch]::StartNew()
            while($task.GetInstances(0).Count -gt 0 -and $drain.ElapsedMilliseconds -lt 3000){
                [Threading.Thread]::Sleep(50)
            }
            if($task.GetInstances(0).Count -ne 0){throw 'witness_active'}
            Remove-AdministratorBrowserEndpoints $scheduler $plan {}
            $ownedFolder=$false
        } catch {$outcome=59}
    }
    if($ownedFolder){
        try {
            $parent.DeleteFolder($plan.Folder,0)
            try {$null=$parent.GetFolder($plan.Folder);throw 'witness_folder_still_exists'}
            catch {if(($_.Exception.GetBaseException().HResult -band 65535) -notin @(2,3)){throw}}
        } catch {$outcome=59}
    }
}
exit $outcome
'@
    $planJson = ConvertTo-Json -InputObject $plan -Compress
    $elevatedSource = $elevatedSource.Replace('__DEFINITIONS__',$definitionCode).
        Replace('__PLAN__',[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($planJson))).
        Replace('__SID__',$sid).Replace('__SESSION__',[string]$session).Replace('__NONCE__',[string]$nonce)
    $receipt.phase = 'prepare-worker'
    $buffer = [IO.MemoryStream]::new()
    try {
        $compress = [IO.Compression.GZipStream]::new($buffer,[IO.Compression.CompressionMode]::Compress,$true)
        try {
            $body = [Text.Encoding]::UTF8.GetBytes($elevatedSource)
            $compress.Write($body,0,$body.Length)
        } finally { $compress.Dispose() }
        $packed = [Convert]::ToBase64String($buffer.ToArray())
    } finally { $buffer.Dispose() }
    $bootstrap = @'
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
$inputBytes=[IO.MemoryStream]::new([Convert]::FromBase64String('__COMPRESSED__'),$false)
$zip=[IO.Compression.GZipStream]::new($inputBytes,[IO.Compression.CompressionMode]::Decompress)
$reader=[IO.StreamReader]::new($zip,[Text.UTF8Encoding]::new($false,$true))
try {$body=$reader.ReadToEnd()} finally {$reader.Dispose()}
& ([scriptblock]::Create($body))
'@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($bootstrap.Replace('__COMPRESSED__',$packed)))
    if ($encoded.Length -ge 30000) { throw 'elevated_command_length' }
    if ($Action -eq 'Plan') {
        $receipt.ok = $true
        $receipt.phase = 'ready-for-inert-witness'
    } else {
        $receipt.phase = 'elevated-registration'
        $scheduler = New-Object -ComObject Schedule.Service
        $scheduler.Connect()
        $parent = $scheduler.GetFolder('\')
        $launch = [Diagnostics.ProcessStartInfo]::new($shell,('-NoLogo -NoProfile -NonInteractive -EncodedCommand ' + $encoded))
        $launch.WorkingDirectory = $system
        $launch.UseShellExecute = $true
        $launch.Verb = 'runas'
        $launch.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
        $child = [Diagnostics.Process]::Start($launch)
        $watch = [Diagnostics.Stopwatch]::StartNew()
        $task = $null
        while ($watch.ElapsedMilliseconds -lt 12000 -and -not $child.HasExited) {
            try {
                $folder = $parent.GetFolder($folderName)
                $found = $folder.GetTask($plan.Name)
                if ($found.Enabled) { $task = $found; break }
            } catch {
                if ((Get-WitnessComCode $_) -notin @(2,3)) { throw }
            }
            [Threading.Thread]::Sleep(100)
        }
        if (-not $task) { throw 'registration_unobserved' }
        Assert-AdministratorBrowserTaskAcl ($folder.GetSecurityDescriptor(5)) $plan.Sddl
        Assert-AdministratorBrowserTask $task $plan $true
        $receipt.elevatedRegistrationVerified = $true
        $receipt.phase = 'medium-access'
        $denied = $false
        try { $task.Enabled = $false }
        catch { if ((Get-WitnessComCode $_) -eq 5) { $denied = $true } else { throw } }
        if (-not $denied) { throw 'medium_mutation_allowed' }
        $receipt.mediumMutationDenied = $true
        $receipt.phase = 'medium-run'
        $taskPath = '\' + $folderName + '\' + $plan.Name
        $schtasks = [IO.Path]::Combine($system,'schtasks.exe')
        $runInfo = [Diagnostics.ProcessStartInfo]::new($schtasks,('/Run /TN "{0}"' -f $taskPath))
        $runInfo.WorkingDirectory = $system
        $runInfo.UseShellExecute = $false
        $runInfo.CreateNoWindow = $true
        $runInfo.RedirectStandardOutput = $true
        $runInfo.RedirectStandardError = $true
        $run = [Diagnostics.Process]::Start($runInfo)
        try {
            $stdout = $run.StandardOutput.ReadToEndAsync()
            $stderr = $run.StandardError.ReadToEndAsync()
            if (-not $run.WaitForExit(5000) -or $run.ExitCode -ne 0) { throw 'run_request_unconfirmed' }
        } finally {
            if (-not $run.HasExited) { $run.Kill(); $null = $run.WaitForExit(1000) }
            $run.Dispose()
        }
        $receipt.mediumRunRequested = $true
    }
} catch {
    if ((Get-WitnessComCode $_) -eq 1223) { $receipt.phase = 'uac-canceled' }
} finally {
    if ($child) {
        try {
            if ($child.WaitForExit(45000)) {
                $exitCode = $child.ExitCode
                $receipt.elevatedActionVerified = $exitCode -eq $nonce
                if (-not $receipt.elevatedActionVerified -and $exitCode -in @(52,53,54,55,56,59)) {
                    $receipt.workerResult = switch ($exitCode) {
                        52 {'identity-refused'} 53 {'no-matching-action-result'} 54 {'acl-readback-refused'}
                        55 {'definition-readback-refused'} 56 {'registration-error'} 59 {'cleanup-unconfirmed'}
                    }
                }
                if (($exitCode -band 536870912) -ne 0) {
                    $fields = @('task-path','task-enabled','definition-enabled','triggers','actions','logon-type','run-level',
                        'demand-start','availability','power-policy','multiple-instances','restart-count','execution-limit',
                        'action-or-principal','after-enable')
                    $receipt.definitionDifferences = @(
                        for ($i=0; $i -lt $fields.Count; $i++) {
                            if ($exitCode -band (1 -shl $i)) { $fields[$i] }
                        }
                    )
                }
                try { $null = $parent.GetFolder($folderName); $receipt.cleaned = $false }
                catch { $receipt.cleaned = (Get-WitnessComCode $_) -in @(2,3) }
                $receipt.ok = $receipt.elevatedRegistrationVerified -and $receipt.mediumMutationDenied -and
                    $receipt.mediumRunRequested -and $receipt.elevatedActionVerified -and $receipt.cleaned
                if ($receipt.ok) { $receipt.phase = 'complete' }
                elseif (-not $receipt.cleaned) { $receipt.cleanupFolder = $folderName }
            } else { $receipt.phase = 'worker-outcome-unconfirmed' }
        } finally { $child.Dispose() }
    }
}
[Console]::WriteLine((ConvertTo-Json -InputObject $receipt -Compress))
if (-not $receipt.ok) { exit 2 }
