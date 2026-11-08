[CmdletBinding()]
param(
    [ValidateSet('Runner','Child')][string]$Mode = 'Runner',
    [string]$NodeArchive,
    [string]$TunnelArchive,
    [string]$NpmCache,
    [string]$WorkRoot,
    [string]$ExpectedSid
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# CI adapter only. The builder and smoke-test token guards remain authoritative.
# https://docs.github.com/en/actions/reference/runners/github-hosted-runners#administrative-privileges
# https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createprocesswithlogonw
# https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.username
function Assert-CiPath([string]$Path, [string]$Within = '') {
    if ($Path -cnotmatch '\A[A-Za-z]:[\\/]' -or $Path -match '[\x00-\x1f<>"|?*'']' -or
        $Path.Substring(2).Contains(':')) { throw 'ci_path_invalid' }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    if ($Within -and -not $full.StartsWith($Within.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'ci_path_outside_root'
    }
    $cursor = $full
    while ($cursor.Length -gt 3) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw 'ci_path_redirected'
            }
        }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
    return $full
}

function Test-CiWorkflowRoute([hashtable]$Context) {
    if ($null -eq $Context -or $Context['job'] -cne 'windows-sidecar') { return $false }
    # Preserve the existing release route; manual verification is a separate,
    # canonical-main workflow, not a fabricated tag-push context.
    $release = $Context['event'] -ceq 'push' -and
        $Context['ref'] -cmatch '\Arefs/tags/v[0-9]+\.[0-9]+\.[0-9]+\z'
    $verification = $Context['event'] -ceq 'workflow_dispatch' -and
        $Context['ref'] -ceq 'refs/heads/main' -and
        $Context['repository'] -ceq '1235357/agent-continue' -and
        $Context['workflowRef'] -ceq '1235357/agent-continue/.github/workflows/verify-windows-delivery.yml@refs/heads/main'
    return ($release -or $verification)
}

function Assert-CiHost {
    $context = @{ job = $env:GITHUB_JOB; event = $env:GITHUB_EVENT_NAME; ref = $env:GITHUB_REF
        repository = $env:GITHUB_REPOSITORY; workflowRef = $env:GITHUB_WORKFLOW_REF }
    if (-not $IsWindows -or [Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -ne 'X64' -or
        $PSVersionTable.PSVersion.Major -lt 7 -or $env:GITHUB_ACTIONS -cne 'true' -or
        $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:RUNNER_OS -cne 'Windows' -or
        -not (Test-CiWorkflowRoute $context)) {
        throw 'disposable_github_windows_release_runner_required'
    }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        if ($identity.IsSystem -or -not [Security.Principal.WindowsPrincipal]::new($identity).IsInRole(
            [Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'ci_administrator_parent_required' }
    } finally { $identity.Dispose() }
}

function Set-CiAcl([string]$Path, [string]$Sid, [switch]$Writable) {
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($entry in @(@('S-1-5-18','FullControl'), @('S-1-5-32-544','FullControl'),
        @($Sid, $(if ($Writable) { 'Modify' } else { 'ReadAndExecute' })))) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new($entry[0]),
            [Security.AccessControl.FileSystemRights]$entry[1],
            [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
            [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Copy-CiTree([string]$Source, [string]$Destination, [hashtable]$Budget, [int]$Depth = 0) {
    if ($Depth -gt 30) { throw 'ci_input_limit' }
    $Source = Assert-CiPath $Source
    $null = New-Item -ItemType Directory -Path $Destination
    foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'ci_input_redirected' }
        $to = Join-Path $Destination $item.Name
        if ($item.PSIsContainer) { Copy-CiTree $item.FullName $to $Budget ($Depth + 1) }
        else { Copy-CiFile $item.FullName $to $Budget }
    }
}

function Copy-CiFile([string]$Source, [string]$Destination, [hashtable]$Budget) {
    $Source = Assert-CiPath $Source
    $info = Get-Item -LiteralPath $Source -Force
    if ($info.PSIsContainer -or $info.Length -gt 192MB) { throw 'ci_input_invalid' }
    $Budget.files++; $Budget.bytes += $info.Length
    if ($Budget.files -gt 60000 -or $Budget.bytes -gt 2GB) { throw 'ci_input_limit' }
    [IO.File]::Copy($Source, $Destination, $false)
}

function New-CiEnvironment([string]$Root, [string]$SystemRoot) {
    $childHome = Join-Path $Root 'work\home'
    $system = Join-Path $SystemRoot 'System32'
    return @{
        SystemRoot = $SystemRoot; WINDIR = $SystemRoot; ComSpec = (Join-Path $system 'cmd.exe')
        PATH = ((Join-Path $Root 'inputs\node'), $system, (Join-Path $system 'WindowsPowerShell\v1.0') -join ';')
        PATHEXT = '.COM;.EXE;.BAT;.CMD'; HOME = $childHome; USERPROFILE = $childHome
        APPDATA = (Join-Path $childHome 'AppData\Roaming'); LOCALAPPDATA = (Join-Path $childHome 'AppData\Local')
        TEMP = (Join-Path $Root 'work\temp'); TMP = (Join-Path $Root 'work\temp')
        PSModulePath = (Join-Path $SystemRoot 'System32\WindowsPowerShell\v1.0\Modules')
    }
}

function Read-CiProcess([Diagnostics.Process]$Process, [int]$TimeoutMs = 600000, [int]$CharacterLimit = 1048576) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $streams = @($Process.StandardOutput, $Process.StandardError)
    $buffers = @([char[]]::new(2048), [char[]]::new(2048))
    $text = @([Text.StringBuilder]::new(), [Text.StringBuilder]::new())
    $pending = @($streams[0].ReadAsync($buffers[0],0,2048), $streams[1].ReadAsync($buffers[1],0,2048))
    while ($null -ne $pending[0] -or $null -ne $pending[1] -or -not $Process.HasExited) {
        if ($clock.ElapsedMilliseconds -gt $TimeoutMs) { throw 'ci_child_timeout' }
        for ($i = 0; $i -lt 2; $i++) {
            if ($null -ne $pending[$i] -and $pending[$i].IsCompleted) {
                $count = $pending[$i].GetAwaiter().GetResult()
                if ($text[$i].Length + $count -gt $CharacterLimit) { throw 'ci_child_output_limit' }
                $null = $text[$i].Append($buffers[$i],0,$count)
                $pending[$i] = if ($count -eq 0) { $null } else { $streams[$i].ReadAsync($buffers[$i],0,2048) }
            }
        }
        Start-Sleep -Milliseconds 20
    }
    return @{ exitCode = $Process.ExitCode; stdout = $text[0].ToString(); stderr = $text[1].ToString() }
}

function Stop-CiAccountProcesses([string]$Sid) {
    if ($Sid -cnotmatch '\AS-1-5-21-(?:[0-9]+-){3}[0-9]+\z') { throw 'ci_cleanup_sid_invalid' }
    # Includes grandchildren after the launcher exits. Never select by process name.
    $clock = [Diagnostics.Stopwatch]::StartNew()
    do {
        $found = $false
        foreach ($process in Get-CimInstance Win32_Process -ErrorAction Stop) {
            try { $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid -ErrorAction Stop }
            catch {
                if (@(Get-CimInstance Win32_Process -Filter "ProcessId = $($process.ProcessId)" -ErrorAction Stop |
                    Where-Object { $_.CreationDate -eq $process.CreationDate }).Count) { throw }
                continue
            }
            if ($owner.ReturnValue -eq 0 -and $owner.Sid -ceq $Sid) {
                $found = $true
                $stopped = Invoke-CimMethod -InputObject $process -MethodName Terminate -Arguments @{Reason = [uint32]1} -ErrorAction Stop
                if ($stopped.ReturnValue -notin @(0,9)) { throw 'ci_account_process_cleanup_failed' }
            }
        }
        if ($clock.ElapsedMilliseconds -gt 15000) { throw 'ci_account_process_cleanup_timeout' }
        if ($found) { Start-Sleep -Milliseconds 20 }
    } while ($found)
}

function Assert-CiResult([string]$Root, [string]$Sid) {
    $output = Assert-CiPath (Join-Path $Root 'work\output') $Root
    $files = @(Get-ChildItem -LiteralPath $output -Force)
    $expected = @('agent-continue-windows-administrator-x64.zip','ordinary-token.json')
    if ($files.Count -ne 2 -or (Compare-Object -CaseSensitive $expected @($files.Name)) -or
        @($files | Where-Object { $_.PSIsContainer -or $_.Length -lt 1 -or $_.LinkType -or
            ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) }).Count) { throw 'ci_output_inventory' }
    if ((Get-Item -LiteralPath (Join-Path $output 'ordinary-token.json')).Length -gt 4096 -or
        (Get-Item -LiteralPath (Join-Path $output $expected[0])).Length -gt 768MB) { throw 'ci_output_limit' }
    $receipt = Get-Content -LiteralPath (Join-Path $output 'ordinary-token.json') -Raw | ConvertFrom-Json
    $fields = @('format','version','accountSid','windowsToken','builderPassed','smokePassed','sha256','installed','published')
    if ($null -eq $receipt -or (Compare-Object -CaseSensitive $fields @($receipt.PSObject.Properties.Name)) -or
        $receipt.builderPassed -isnot [bool] -or $receipt.smokePassed -isnot [bool] -or
        $receipt.installed -isnot [bool] -or $receipt.published -isnot [bool] -or
        $receipt.version -isnot [long] -or $receipt.sha256 -isnot [string]) { throw 'ci_child_receipt_invalid' }
    $hash = (Get-FileHash -LiteralPath (Join-Path $output $expected[0]) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($receipt.format -cne 'agent-continue-release-ordinary-token-ci' -or $receipt.version -cne 1 -or
        $receipt.accountSid -cne $Sid -or $receipt.windowsToken -cne 'standard' -or
        $receipt.builderPassed -cne $true -or $receipt.smokePassed -cne $true -or
        $receipt.sha256 -cne $hash -or $receipt.installed -cne $false -or $receipt.published -cne $false) {
        throw 'ci_child_receipt_invalid'
    }
    return $hash
}

function Invoke-CiChild {
    $root = Assert-CiPath $WorkRoot
    if ([IO.Path]::GetFileName($root) -cnotmatch '\Aac-release-ci-[a-f0-9]{32}\z' -or
        $PSScriptRoot -ine (Join-Path $root 'inputs\repo\scripts')) { throw 'ci_child_root_invalid' }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        if ($identity.User.Value -cne $ExpectedSid -or $identity.IsSystem -or
            [Security.Principal.WindowsPrincipal]::new($identity).IsInRole(
                [Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'ordinary_windows_token_required' }
    } finally { $identity.Dispose() }
    if (@(Get-ChildItem Env: | Where-Object { $_.Name -match '\A(?:GITHUB_|ACTIONS_|RUNNER_|NODE_OPTIONS\z|NPM_CONFIG_)' }).Count) {
        throw 'ci_child_environment_invalid'
    }
    $node = Join-Path $root 'inputs\node\node.exe'
    $bundle = Join-Path $root 'work\output\agent-continue-windows-administrator-x64.zip'
    Set-Location -LiteralPath (Join-Path $root 'inputs\repo')
    & $node scripts/build-windows-administrator-bundle.mjs --node-archive (Join-Path $root 'inputs\node.zip') `
        --tunnel-archive (Join-Path $root 'inputs\tunnel.zip') --npm-cache (Join-Path $root 'inputs\cache') --out $bundle
    if ($LASTEXITCODE -ne 0) { throw 'ci_builder_failed' }
    $hash = (Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash.ToLowerInvariant()
    & (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoLogo -NoProfile -NonInteractive `
        -File scripts/Test-WindowsAdministratorBundleSmoke.ps1 -Archive $bundle -ExpectedSha256 $hash
    if ($LASTEXITCODE -ne 0) { throw 'ci_smoke_failed' }
    @{ format = 'agent-continue-release-ordinary-token-ci'; version = 1; accountSid = $ExpectedSid
        windowsToken = 'standard'; builderPassed = $true; smokePassed = $true; sha256 = $hash
        installed = $false; published = $false } | ConvertTo-Json -Compress |
        Set-Content -LiteralPath (Join-Path $root 'work\output\ordinary-token.json') -Encoding utf8
}

function Invoke-CiRunner {
    Assert-CiHost
    $temp = Assert-CiPath $env:RUNNER_TEMP
    $repo = Assert-CiPath $env:GITHUB_WORKSPACE
    if ($PSScriptRoot -ine (Join-Path $repo 'scripts')) { throw 'ci_checkout_mismatch' }
    $node = Assert-CiPath (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $nodeRoot = [IO.Path]::GetDirectoryName($node)
    $root = Join-Path $temp ('ac-release-ci-' + [guid]::NewGuid().ToString('N'))
    $name = 'ac_ci_' + [guid]::NewGuid().ToString('N').Substring(0,14)
    $account = $null; $password = $null; $process = $null; $claimed = $false
    try {
        $null = New-Item -ItemType Directory -Path $root
        $claimed = $true
        # Unpredictable, expiring CI-only secret; never logged, serialized or passed in argv/env.
        $password = ConvertTo-SecureString ('Ac9!' + [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))) -AsPlainText -Force
        $account = New-LocalUser -Name $name -Password $password -AccountExpires ([DateTime]::Now.AddHours(1)) `
            -UserMayNotChangePassword -Description 'Disposable AgentContinue release CI'
        $sid = $account.SID.Value
        Add-LocalGroupMember -SID ([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545')) -Member $account
        if (@(Get-LocalGroupMember -SID ([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')) |
            Where-Object { $_.SID.Value -ceq $sid }).Count) { throw 'ci_child_account_is_administrator' }
        Set-CiAcl $root $sid
        foreach ($dir in @('inputs','inputs\repo','inputs\repo\scripts','inputs\repo\native',
            'inputs\repo\native\bootstrap','inputs\repo\native\desktop-commander','work')) {
            $null = New-Item -ItemType Directory -Path (Join-Path $root $dir)
        }
        Set-CiAcl (Join-Path $root 'work') $sid -Writable
        foreach ($dir in @('output','temp','home','home\AppData','home\AppData\Roaming','home\AppData\Local')) {
            $null = New-Item -ItemType Directory -Path (Join-Path $root ('work\' + $dir))
        }
        $budget = @{ files = 0; bytes = [long]0 }
        # Only source directories and declared helpers, never .git, node_modules, .npmrc or the runner home.
        foreach ($folder in @('native\bootstrap','native\desktop-commander')) {
            foreach ($file in Get-ChildItem -LiteralPath (Join-Path $repo $folder) -File -Force) {
                if ($file.Extension -in @('.mjs','.json','.ps1','.cmd','.cs','.md') -or $file.Name -ceq 'LICENSE') {
                    Copy-CiFile $file.FullName (Join-Path $root ('inputs\repo\' + $folder + '\' + $file.Name)) $budget
                }
            }
        }
        foreach ($file in @('LICENSE','scripts\Invoke-WindowsReleaseOrdinaryTokenCI.ps1',
            'scripts\build-windows-administrator-bundle.mjs','scripts\Write-WindowsAdministratorBundle.ps1',
            'scripts\Stage-WindowsAdministratorBundle.ps1','scripts\Test-WindowsAdministratorBundleSmoke.ps1',
            'scripts\hosted-read-acceptance.mjs','scripts\prepare-hosted-administrator-probe.mjs')) {
            Copy-CiFile (Join-Path $repo $file) (Join-Path $root ('inputs\repo\' + $file)) $budget
        }
        $fixtures = Join-Path $root 'inputs\repo\native\desktop-commander\test-fixtures'
        $null = New-Item -ItemType Directory -Path $fixtures
        Copy-CiFile (Join-Path $repo 'native\desktop-commander\test-fixtures\startup-guard.mjs') (Join-Path $fixtures 'startup-guard.mjs') $budget
        Copy-CiFile $NodeArchive (Join-Path $root 'inputs\node.zip') $budget
        Copy-CiFile $TunnelArchive (Join-Path $root 'inputs\tunnel.zip') $budget
        Copy-CiTree $nodeRoot (Join-Path $root 'inputs\node') $budget
        $null = New-Item -ItemType Directory -Path (Join-Path $root 'inputs\cache')
        Copy-CiTree (Join-Path (Assert-CiPath $NpmCache) '_cacache') (Join-Path $root 'inputs\cache\_cacache') $budget
        $start = [Diagnostics.ProcessStartInfo]::new()
        $start.FileName = Join-Path $PSHOME 'pwsh.exe'
        $start.UseShellExecute = $false; $start.CreateNoWindow = $true
        $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
        $start.LoadUserProfile = $false; $start.UserName = $name; $start.Domain = $env:COMPUTERNAME
        $start.Password = $password; $start.UseCredentialsForNetworkingOnly = $false
        $start.WorkingDirectory = Join-Path $root 'work'
        $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
        $start.Environment.Clear()
        foreach ($entry in (New-CiEnvironment $root (Assert-CiPath $env:SystemRoot)).GetEnumerator()) {
            $start.Environment[$entry.Key] = $entry.Value
        }
        foreach ($arg in @('-NoLogo','-NoProfile','-NonInteractive','-File',
            (Join-Path $root 'inputs\repo\scripts\Invoke-WindowsReleaseOrdinaryTokenCI.ps1'),
            '-Mode','Child','-WorkRoot',$root,'-ExpectedSid',$sid)) { $start.ArgumentList.Add($arg) }
        $process = [Diagnostics.Process]::new(); $process.StartInfo = $start
        if (-not $process.Start()) { throw 'ci_child_start_failed' }
        $result = Read-CiProcess $process
        # Do not interpret child stdout as Actions workflow commands.
        if ($result.exitCode -ne 0) {
            $diagnostic = $result.stdout + $result.stderr
            if ($diagnostic.Length -gt 16384) { $diagnostic = $diagnostic.Substring($diagnostic.Length - 16384) }
            foreach ($line in ($diagnostic -split '\r?\n')) { Write-Output ('ci child: ' + $line.Replace("`r", ' ')) }
            throw 'ci_child_failed'
        }
        Stop-CiAccountProcesses $sid
        $hash = Assert-CiResult $root $sid
        foreach ($pair in @(@('agent-continue-windows-administrator-x64.zip','agent-continue-windows-administrator-x64.zip'),
            @('ordinary-token.json','agent-continue-release-ordinary-token.json'))) {
            $destination = Assert-CiPath (Join-Path $temp $pair[1]) $temp
            [IO.File]::Copy((Join-Path $root ('work\output\' + $pair[0])), $destination, $false)
        }
        Write-Output ('ordinary Windows child build and smoke passed; sha256=' + $hash)
    } finally {
        try {
            if ($null -ne $account) {
                try { Disable-LocalUser -SID $account.SID }
                finally {
                    try { Stop-CiAccountProcesses $account.SID.Value }
                    finally { Remove-LocalUser -SID $account.SID }
                }
            }
        } finally {
            if ($null -ne $process) { $process.Dispose() }
            if ($null -ne $password) { $password.Dispose() }
            if ($claimed) {
                $target = Assert-CiPath $root $temp
                if ([IO.Path]::GetDirectoryName($target) -ine $temp -or
                    [IO.Path]::GetFileName($target) -cnotmatch '\Aac-release-ci-[a-f0-9]{32}\z') { throw 'ci_cleanup_path_invalid' }
                # Recheck every descendant before recursive deletion, including writable child output.
                $queue = [Collections.Generic.Queue[string]]::new(); $queue.Enqueue($target)
                while ($queue.Count) {
                    foreach ($item in Get-ChildItem -LiteralPath $queue.Dequeue() -Force) {
                        $null = Assert-CiPath $item.FullName $temp
                        if ($item.PSIsContainer) { $queue.Enqueue($item.FullName) }
                    }
                }
                Remove-Item -LiteralPath $target -Recurse -Force
            }
        }
    }
}

if ($Mode -ceq 'Child') { Invoke-CiChild } else { Invoke-CiRunner }
