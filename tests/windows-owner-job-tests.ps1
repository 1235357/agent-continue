[CmdletBinding()]
param([string]$CrashBrokerDirectory)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop' -or -not [Environment]::Is64BitProcess) {
    throw 'Windows PowerShell x64 is required'
}
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'native\desktop-commander\windows-owner-job.cs'
Add-Type -TypeDefinition ([IO.File]::ReadAllText($source))
$node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
$fixture = Join-Path $PSScriptRoot 'windows-owner-job-fixture.cjs'

function New-TestLaunch([string]$Dir, [string]$Role) {
    $plan = [Diagnostics.ProcessStartInfo]::new($node, ('"{0}" "{1}" {2}' -f $fixture,$Dir,$Role))
    $plan.UseShellExecute = $false
    $plan.CreateNoWindow = $true
    $plan.WorkingDirectory = $Dir
    $plan.EnvironmentVariables.Clear()
    $plan.EnvironmentVariables['SystemRoot'] = $env:SystemRoot
    $plan.EnvironmentVariables['AC_OWNER_JOB_FIXTURE'] = 'exact value'
    return $plan
}

function Read-ExactProcess([string]$Dir, [string]$Role) {
    $file = Join-Path $Dir ($Role + '.pid')
    $watch = [Diagnostics.Stopwatch]::StartNew()
    do {
        if ([IO.File]::Exists($file)) {
            $value = [IO.File]::ReadAllText($file)
            if ($value -match '\A[1-9][0-9]{0,8}\z') {
                $process = [Diagnostics.Process]::GetProcessById([int]$value)
                $null = $process.Handle
                return $process
            }
        }
        Start-Sleep -Milliseconds 30
    } while ($watch.ElapsedMilliseconds -lt 7000)
    throw ('Missing fixture process: ' + $Role)
}

if ($CrashBrokerDirectory) {
    $managed = [AgentContinue.WindowsOwnerJob]::new()
    try {
        $managed.Start((New-TestLaunch $CrashBrokerDirectory 'root'))
        if (-not $managed.WaitForRoot(20000)) { throw 'crash broker was not stopped' }
    } finally { $managed.Dispose() }
    exit 0
}

$parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$scratch = Join-Path $parent ('ac-owner-job-' + [Guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($scratch)
$outside = $null
try {
    $outside = [Diagnostics.Process]::Start((New-TestLaunch $scratch 'outside'))
    $witness = Read-ExactProcess $scratch 'outside'
    try { if ($witness.Id -ne $outside.Id) { throw 'unrelated fixture identity mismatch' } }
    finally { $witness.Dispose() }
    foreach ($scenario in @('revoke','root-exit','broker-loss')) {
        $case = Join-Path $scratch $scenario
        $null = [IO.Directory]::CreateDirectory($case)
        $job = $broker = $null
        $observed = @()
        try {
            if ($scenario -eq 'broker-loss') {
                $ps = Join-Path $PSHOME 'powershell.exe'
                $args = '-NoLogo -NoProfile -NonInteractive -File "{0}" -CrashBrokerDirectory "{1}"' -f $PSCommandPath,$case
                $command = [Diagnostics.ProcessStartInfo]::new($ps,$args)
                $command.UseShellExecute = $false
                $command.CreateNoWindow = $true
                $broker = [Diagnostics.Process]::Start($command)
            } else {
                $job = [AgentContinue.WindowsOwnerJob]::new()
                $job.Start((New-TestLaunch $case 'root'))
            }
            foreach ($role in @('root','child','grandchild')) { $observed += Read-ExactProcess $case $role }
            if ($scenario -eq 'broker-loss') {
                $broker.Kill()
                if (-not $broker.WaitForExit(7000)) { throw 'fixture broker did not exit' }
            } else {
                if ($job.ActiveCount() -lt 3 -or $job.ContainsProcess($outside.SafeHandle)) { throw 'incorrect job membership' }
                foreach ($process in $observed) {
                    if (-not $job.ContainsProcess($process.SafeHandle)) { throw 'fixture process escaped its job' }
                }
                if ($scenario -eq 'root-exit') {
                    [IO.File]::WriteAllText((Join-Path $case 'exit-root'),'')
                    if (-not $job.WaitForRoot(7000) -or $job.RootExitCode() -ne 17 -or $job.ActiveCount() -lt 2 -or
                        $observed[1].HasExited -or $observed[2].HasExited) {
                        throw 'root exit did not leave two managed descendants'
                    }
                }
                if (-not $job.Drain(7000) -or $job.ActiveCount() -ne 0) { throw 'job not confirmed empty' }
            }
            foreach ($process in $observed) {
                if (-not $process.WaitForExit(7000)) { throw 'a retained process handle is still live' }
            }
            if ($outside.HasExited) { throw 'an unrelated process was stopped' }
            Write-Output ('PASS ' + $scenario + ': all three job members exited; unrelated process alive')
        } finally {
            if ($job) { $job.Dispose() }
            if ($broker) { if (-not $broker.HasExited) { $broker.Kill(); $null = $broker.WaitForExit(7000) }; $broker.Dispose() }
            foreach ($process in $observed) { $process.Dispose() }
        }
    }
} finally {
    if ($outside) { if (-not $outside.HasExited) { $outside.Kill(); $null = $outside.WaitForExit(7000) }; $outside.Dispose() }
    if ([IO.Path]::GetDirectoryName($scratch) -ceq $parent -and
        [IO.Path]::GetFileName($scratch) -cmatch '\Aac-owner-job-[0-9a-f]{32}\z' -and
        -not ([IO.File]::GetAttributes($scratch) -band [IO.FileAttributes]::ReparsePoint)) {
        [IO.Directory]::Delete($scratch,$true)
    }
}
