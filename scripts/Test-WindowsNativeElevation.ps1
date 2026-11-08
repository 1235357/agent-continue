[CmdletBinding()]
param(
    [ValidateSet('Plan','Probe','Start')][string]$Action = 'Plan',
    [string]$Consent = ''
)

$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
$result = [ordered]@{
    action = $Action.ToLowerInvariant(); status = 'unavailable'
    uacRequested = $false; administratorChildVerified = $false
}
$child = $null

try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        $sid = $identity.User.Value
        $callerIsAdmin = [Security.Principal.WindowsPrincipal]::new($identity).IsInRole(
            [Security.Principal.WindowsBuiltInRole]::Administrator)
    } finally { $identity.Dispose() }
    if ($sid -cnotmatch '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z') { throw 'interactive_account_required' }
    $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
    $shell = [IO.Path]::Combine($system, 'WindowsPowerShell\v1.0\powershell.exe')
    if (-not [IO.File]::Exists($shell)) { throw 'system_powershell_missing' }

    if ($Action -eq 'Plan') {
        if ($Consent) { throw 'unexpected_consent' }
        $result.status = 'ready-for-local-probe'
    } elseif (($Action -eq 'Start' -and $Consent -cne 'accept-local-admin-probe') -or
              ($Action -eq 'Probe' -and $Consent)) {
        $result.status = 'consent-required-or-unexpected'
    } elseif ($Action -eq 'Start' -and $callerIsAdmin) {
        $result.status = 'start-from-a-standard-session'
    } else {
        # Only fixed OS queries are run. Neither the elevated launcher nor its child
        # loads the repository, a profile, the browser, a tunnel or external input.
        $random = [byte[]]::new(4)
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($random) } finally { $rng.Dispose() }
        $witness = 65536 + ([BitConverter]::ToUInt32($random, 0) -band 0x00ffffff)
        $worker = @'
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
try {
    $thread=[Security.Principal.WindowsIdentity]::GetCurrent($true)
    if($thread){$thread.Dispose();exit 11}
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        if($identity.User.Value -cne '__SID__'){exit 12}
        $principal=[Security.Principal.WindowsPrincipal]::new($identity)
        $admin=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } finally { $identity.Dispose() }
    $system=[Environment]::GetFolderPath([Environment+SpecialFolder]::System)
    $groups=& ([IO.Path]::Combine($system,'whoami.exe')) /groups /fo csv /nh
    if($LASTEXITCODE -ne 0){exit 13}
    $integrity=[regex]::Matches(($groups -join "`n"), '(?:^|,)"S-1-16-([0-9]{1,5})"(?=,|$)')
    if($integrity.Count -ne 1){exit 13}
    $rid=[int]$integrity[0].Groups[1].Value
    if(-not $admin -and $rid -ge 8192 -and $rid -lt 12288){exit 14}
    if(-not $admin -or $rid -lt 12288 -or $rid -ge 16384){exit 13}
    exit __WITNESS__
} catch {exit 13}
'@
        $worker = $worker.Replace('__SID__',$sid).Replace('__WITNESS__',[string]$witness)
        $workerArgs = '-NoLogo -NoProfile -NonInteractive -EncodedCommand ' +
            [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($worker))
        $launch = [Diagnostics.ProcessStartInfo]::new($shell, $workerArgs)
        $launch.WorkingDirectory = $system
        $launch.UseShellExecute = $false
        $launch.CreateNoWindow = $true
        if ($Action -eq 'Start') {
            $launcher = @'
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
$child=$null
try {
    $system=[Environment]::GetFolderPath([Environment+SpecialFolder]::System)
    $info=[Diagnostics.ProcessStartInfo]::new([IO.Path]::Combine($system,'WindowsPowerShell\v1.0\powershell.exe'),'__ARGS__')
    $info.WorkingDirectory=$system
    $info.UseShellExecute=$false
    $info.CreateNoWindow=$true
    $child=[Diagnostics.Process]::Start($info)
    if($null -eq $child -or -not $child.WaitForExit(15000)){exit 15}
    exit $child.ExitCode
} catch {exit 13}
finally {if($child){$child.Dispose()}}
'@
            $launcher = $launcher.Replace('__ARGS__', $workerArgs)
            $launch.Arguments = '-NoLogo -NoProfile -NonInteractive -EncodedCommand ' +
                [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($launcher))
            $launch.UseShellExecute = $true
            $launch.CreateNoWindow = $false
            $launch.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
            $launch.Verb = 'runas'
            $result.uacRequested = $true
        }
        $child = [Diagnostics.Process]::Start($launch)
        if ($null -eq $child -or -not $child.WaitForExit(20000)) { $result.status = 'outcome-unconfirmed' }
        elseif ($child.ExitCode -eq $witness) {
            $result.status = 'administrator-child-verified'
            $result.administratorChildVerified = $true
        } elseif ($child.ExitCode -eq 12) { $result.status = 'account-mismatch' }
        elseif ($child.ExitCode -eq 14) { $result.status = 'standard-child' }
        elseif ($child.ExitCode -eq 15) { $result.status = 'outcome-unconfirmed' }
        else { $result.status = 'token-unverified' }
    }
} catch {
    $cause = $_.Exception
    while ($cause.InnerException) { $cause = $cause.InnerException }
    if ($cause -is [ComponentModel.Win32Exception] -and $cause.NativeErrorCode -eq 1223) { $result.status = 'uac-canceled' }
} finally {
    if ($child) { $child.Dispose() }
}

# No SID, token bytes, executable arguments or paths in machine-readable output.
[Console]::WriteLine(('{{"action":"{0}","status":"{1}","uacRequested":{2},"administratorChildVerified":{3},"tunnelStarted":false,"registrationChanged":false}}' -f
    $result.action,$result.status,$result.uacRequested.ToString().ToLowerInvariant(),$result.administratorChildVerified.ToString().ToLowerInvariant()))
if (($Action -eq 'Plan' -and $result.status -eq 'ready-for-local-probe') -or
    ($Action -eq 'Probe' -and $result.status -in @('standard-child','administrator-child-verified')) -or
    ($Action -eq 'Start' -and $result.administratorChildVerified)) { exit 0 }
exit 2
