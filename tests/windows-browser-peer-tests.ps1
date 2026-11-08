[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion -lt [version]'5.1' -or
    -not [Environment]::Is64BitProcess) { throw 'Windows PowerShell 5.1 x64 required' }
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'native\desktop-commander\windows-browser-peer.cs'
$runner = Join-Path $root 'native\desktop-commander\windows-browser-peer.ps1'
if (-not [IO.File]::Exists($source) -or -not [IO.File]::Exists($runner)) {
    throw 'ASSERT transport implementation is missing (expected initial red)'
}
Add-Type -TypeDefinition ([IO.File]::ReadAllText($source))
$powershell = Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell\v1.0\powershell.exe'
$origin = 'chrome-extension://' + ('a' * 32) + '/'
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$g = 'b' * 32
$script:checks = 0
$script:processes = New-Object Collections.ArrayList
$script:pipes = New-Object Collections.ArrayList

function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw ('ASSERT ' + $Message) }
    $script:checks++
}
function New-Bundle { Join-Path ([IO.Path]::GetTempPath().TrimEnd('\')) ('acb-test-' + [guid]::NewGuid().ToString('N')) }
function Start-Helper([string]$Role, [string]$Bundle, [string]$Generation = '', [string]$ExpectedSid = '', [string]$Extra = '') {
    $arguments = '-NoLogo -NoProfile -NonInteractive -File "{0}" -Role {1} -Bundle "{2}" -Origin {3}' -f $runner,$Role,$Bundle,$origin
    if ($Generation) { $arguments += ' -Generation ' + $Generation }
    if ($ExpectedSid) { $arguments += ' -ExpectedSid ' + $ExpectedSid }
    $arguments += $Extra
    $start = New-Object Diagnostics.ProcessStartInfo($powershell,$arguments)
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $start.RedirectStandardOutput = $start.RedirectStandardError = $true
    $process = [Diagnostics.Process]::Start($start)
    $null = $script:processes.Add($process)
    return $process
}
function Read-Line($Process, [int]$Timeout = 19000) {
    $read = $Process.StandardOutput.ReadLineAsync()
    if (-not $read.Wait($Timeout)) { throw 'ASSERT bounded helper output timed out' }
    return $read.Result
}
function Assert-Exit($Process, [int]$Timeout = 3000, [bool]$Success = $true) {
    Assert ($Process.WaitForExit($Timeout)) 'helper exit must be observed within deadline'
    if ($Success) { Assert ($Process.ExitCode -eq 0) ('unexpected helper failure: ' + $Process.StandardError.ReadToEnd()) }
    else { Assert ($Process.ExitCode -ne 0) 'helper must fail closed' }
}
function Start-Server([string]$Bundle) {
    $process = Start-Helper Server $Bundle
    Assert ((Read-Line $process) -ceq 'LISTENING') 'server stdout must start with LISTENING only'
    return $process
}
function Connect-Raw([string]$Bundle) {
    $pipe = New-Object IO.Pipes.NamedPipeClientStream('.', [AgentContinue.WindowsBrowserPeer]::PipeName($Bundle),
        [IO.Pipes.PipeDirection]::InOut, [IO.Pipes.PipeOptions]::Asynchronous,
        [Security.Principal.TokenImpersonationLevel]::Anonymous)
    $pipe.Connect(3000)
    $null = $script:pipes.Add($pipe)
    return $pipe
}
function Send-Bytes($Pipe, [byte[]]$Bytes) {
    $write = $Pipe.BeginWrite($Bytes,0,$Bytes.Length,$null,$null)
    if (-not $write.AsyncWaitHandle.WaitOne(3000)) { throw 'ASSERT bounded fixture write timed out' }
    try { $Pipe.EndWrite($write) } finally { $write.AsyncWaitHandle.Close() }
}
function Read-Bytes($Pipe, [int]$Count, [int]$Timeout = 3000) {
    $bytes = New-Object byte[] $Count
    $read = $Pipe.BeginRead($bytes,0,$Count,$null,$null)
    try {
        if (-not $read.AsyncWaitHandle.WaitOne($Timeout)) { throw 'ASSERT bounded fixture read timed out' }
        try { $n = $Pipe.EndRead($read) } catch [IO.IOException] { $n = 0 }
        return ,@($n,$bytes)
    } finally { $read.AsyncWaitHandle.Close() }
}
function Handshake($Pipe, [string]$Role, [string]$Generation = $g) {
    $frame = [Text.Encoding]::ASCII.GetBytes("ACB1 $Role $Generation`n")
    Send-Bytes $Pipe $frame
    $reply = New-Object Collections.Generic.List[byte]
    while ($reply.Count -lt $frame.Length) {
        $read = Read-Bytes $Pipe ($frame.Length - $reply.Count)
        Assert ($read[0] -gt 0) 'valid frame must be echoed'
        for ($i = 0; $i -lt $read[0]; $i++) { $reply.Add($read[1][$i]) }
    }
    Assert ([Text.Encoding]::ASCII.GetString($reply.ToArray()) -ceq [Text.Encoding]::ASCII.GetString($frame)) 'echo must be exact'
}
function Assert-Closed($Pipe, [int]$Timeout = 3000) {
    $read = Read-Bytes $Pipe 96 $Timeout
    Assert ($read[0] -eq 0) 'pipe must close without emitting bytes'
}
function Invoke-Policy([string]$Name, [object[]]$Arguments) {
    $method = [AgentContinue.WindowsBrowserPeer].GetMethod($Name, [Reflection.BindingFlags]'Static,NonPublic')
    if (-not $method) { throw ('ASSERT missing policy ' + $Name) }
    $parameters = $method.GetParameters()
    $converted = New-Object object[] $Arguments.Count
    for ($i = 0; $i -lt $Arguments.Count; $i++) {
        $converted[$i] = [Management.Automation.LanguagePrimitives]::ConvertTo($Arguments[$i],$parameters[$i].ParameterType)
    }
    return $method.Invoke($null,$converted)
}
function Assert-Refused([scriptblock]$Action) {
    $refused = $false
    try { & $Action } catch { $refused = $true }
    Assert $refused 'invalid policy input must be refused'
}

try {
    $bundle = New-Bundle
    $server = Start-Server $bundle
    $owner = Connect-Raw $bundle; Handshake $owner owner
    $retainedProvider = Connect-Raw $bundle; Handshake $retainedProvider provider
    for ($i = 0; $i -lt 32; $i++) {
        $provider = Connect-Raw $bundle
        Handshake $provider provider
        $provider.Dispose()
        Assert (-not $server.HasExited) 'provider EOF must release a slot without ending the live owner generation'
    }
    $providers = @($retainedProvider)
    for ($i = 1; $i -lt 16; $i++) {
        $provider = Connect-Raw $bundle; Handshake $provider provider
        $providers += $provider
    }
    $providers[0].Dispose()
    $providers[0] = Connect-Raw $bundle; Handshake $providers[0] provider
    $owner.Dispose()
    foreach ($provider in $providers) { Assert-Closed $provider }
    Assert-Exit $server
    Write-Output 'PASS 32 sequential provider EOFs release slots; same owner then supports 16 concurrent providers and EOF fanout'

    $bundle = New-Bundle
    $old = Start-Server $bundle
    $replacement = Start-Helper Server $bundle
    Start-Sleep -Milliseconds 1800
    Assert (-not $replacement.HasExited) 'collision-only create must wait boundedly for old server EOF cleanup'
    $old.StandardInput.Close(); Assert-Exit $old
    Assert ((Read-Line $replacement 6500) -ceq 'LISTENING') 'replacement must bind only after the old pipe disappears'
    $p = Connect-Raw $bundle; Handshake $p owner ('d' * 32)
    $replacement.StandardInput.Close(); Assert-Exit $replacement; Assert-Closed $p
    Write-Output 'PASS collision-only create handoff after old server EOF (not task/Job acceptance)'

    $bundle = New-Bundle
    Assert ([AgentContinue.WindowsBrowserPeer]::PipeName($bundle) -cmatch '\AAgentContinue\.AdminBrowser\.[a-f0-9]{64}\z') 'fixed pipe namespace'
    Assert ([AgentContinue.WindowsBrowserPeer]::PipeName($bundle) -ceq [AgentContinue.WindowsBrowserPeer]::PipeName($bundle.ToUpperInvariant())) 'case aliases share one pipe'
    foreach ($bad in @('relative','C:relative',($bundle + '\..'),($bundle + '\'),('\\server\share'),($bundle + ' '))) {
        Assert-Refused { [AgentContinue.WindowsBrowserPeer]::PipeName($bad) }
    }
    Write-Output 'PASS PS5.1 compilation and canonical bundle validation'

    $nativeType = [AgentContinue.WindowsBrowserPeer].GetNestedType('NativeProcess',[Reflection.BindingFlags]::NonPublic)
    $self = [Activator]::CreateInstance($nativeType,[object[]]@([uint32]$PID))
    try {
        Assert $self.Alive 'retained native process handle must be live'
        Assert ($self.Sid -ceq $sid -and $self.Session -eq [Diagnostics.Process]::GetCurrentProcess().SessionId) 'native token SID/session must match OS observations'
        Assert ([string]::Equals($self.Image,$powershell,[StringComparison]::OrdinalIgnoreCase)) 'native process image must match PS5.1'
        $argv = $self.Arguments()
        Assert ([string]::Equals($argv[0],$powershell,[StringComparison]::OrdinalIgnoreCase)) 'native command-line parser must preserve image'
        Assert ($argv -ccontains '-File' -and [IO.Path]::GetFileName($argv[-1]) -ceq 'windows-browser-peer-tests.ps1') 'native command-line parser must read the actual test launch vector'
    } finally { $self.Dispose() }
    Write-Output 'PASS actual retained native handle, image, token SID/session and native argv acquisition'

    $server = Start-Server $bundle
    $duplicate = Start-Helper Server $bundle
    Assert-Exit $duplicate 19000 $false
    Assert ([string]::IsNullOrEmpty($duplicate.StandardOutput.ReadToEnd())) 'duplicate must never LISTEN'
    $owner = Connect-Raw $bundle
    $security = $owner.GetAccessControl()
    Assert $security.AreAccessRulesProtected 'DACL must be explicit and protected'
    Assert ($security.GetOwner([Security.Principal.SecurityIdentifier]).Value -ceq $sid) 'pipe owner must be native owner SID'
    $rules = @($security.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
    Assert ($rules.Count -eq 4) 'DACL must contain exactly Network deny and three explicit allows'
    foreach ($rule in $rules) {
        Assert (-not $rule.IsInherited) 'no inherited pipe access'
        $isNetwork = $rule.IdentityReference.Value -ceq 'S-1-5-2'
        Assert ($isNetwork -or $rule.IdentityReference.Value -cin @($sid,'S-1-5-18','S-1-5-32-544')) 'unexpected pipe principal'
        Assert ($rule.AccessControlType -eq $(if($isNetwork){[Security.AccessControl.AccessControlType]::Deny}else{[Security.AccessControl.AccessControlType]::Allow})) 'wrong ACE kind'
        Assert ($rule.PipeAccessRights -eq [IO.Pipes.PipeAccessRights]::FullControl) 'wrong ACE rights'
    }
    Handshake $owner owner
    $providers = @()
    for ($i = 0; $i -lt 16; $i++) {
        $provider = Connect-Raw $bundle
        Handshake $provider provider
        $providers += $provider
    }
    $owner.Dispose()
    foreach ($provider in $providers) { Assert-Closed $provider }
    Assert-Exit $server
    Assert ([string]::IsNullOrEmpty($server.StandardOutput.ReadToEnd())) 'server emits no generation or CLOSED output'
    Write-Output 'PASS actual DACL readback, FirstPipeInstance duplicate refusal, 16 providers, owner EOF fanout'

    foreach ($payload in @("ACB1 provider $g`n", "ACB1 stranger $g`n", "ACB1 owner BAD`n", ('x' * 97),
        "ACB1 owner $g`nextra", "ACB1 owner $g`r`n", "ACB1 owner $g`n`n")) {
        $bundle = New-Bundle; $server = Start-Server $bundle; $pipe = Connect-Raw $bundle
        Send-Bytes $pipe ([Text.Encoding]::ASCII.GetBytes($payload))
        Assert-Closed $pipe
        Assert-Exit $server 3000 $false
    }
    $bundle = New-Bundle; $server = Start-Server $bundle; $pipe = Connect-Raw $bundle
    Send-Bytes $pipe ([byte[]]@(65,67,66,49,32,255,10))
    Assert-Closed $pipe; Assert-Exit $server 3000 $false
    Write-Output 'PASS malformed, first-provider, unknown-role, oversize, non-ASCII, CRLF and extra initial bytes consume session'

    foreach ($kind in @('stale','second-owner','extra-byte','provider-byte','limit')) {
        $bundle = New-Bundle; $server = Start-Server $bundle; $owner = Connect-Raw $bundle; Handshake $owner owner
        if ($kind -eq 'extra-byte') { Send-Bytes $owner ([byte[]]@(65)) }
        elseif ($kind -eq 'provider-byte') {
            $p = Connect-Raw $bundle; Handshake $p provider
            Send-Bytes $p ([byte[]]@(65)); Assert-Closed $p
        }
        else {
            if ($kind -eq 'stale') {
                $p = Connect-Raw $bundle; Handshake $p provider; $p.Dispose()
            }
            if ($kind -eq 'limit') {
                for ($i = 0; $i -lt 16; $i++) { $p = Connect-Raw $bundle; Handshake $p provider }
            }
            $p = Connect-Raw $bundle
            $role = if ($kind -eq 'second-owner') { 'owner' } else { 'provider' }
            $generation = if ($kind -eq 'stale') { 'c' * 32 } else { $g }
            Send-Bytes $p ([Text.Encoding]::ASCII.GetBytes("ACB1 $role $generation`n"))
            Assert-Closed $p
        }
        Assert-Closed $owner; Assert-Exit $server 3000 $false
    }
    Write-Output 'PASS immutable generation, duplicate owner, post-handshake bytes and provider cap'

    $bundle = New-Bundle; $server = Start-Server $bundle; $pipe = Connect-Raw $bundle
    $watch = [Diagnostics.Stopwatch]::StartNew()
    Send-Bytes $pipe ([Text.Encoding]::ASCII.GetBytes('ACB1 owner '))
    Assert-Closed $pipe 6500
    Assert ($watch.ElapsedMilliseconds -lt 6500) 'partial handshake must have a total 5-second deadline'
    Assert-Exit $server 3000 $false
    foreach ($connected in @($false,$true)) {
        $bundle = New-Bundle; $server = Start-Server $bundle
        if ($connected) {
            $owner = Connect-Raw $bundle; Handshake $owner owner
            $provider = Connect-Raw $bundle; Handshake $provider provider
        }
        $server.StandardInput.Close()
        Assert-Exit $server
        if ($connected) { Assert-Closed $owner; Assert-Closed $provider }
    }
    Write-Output 'PASS total initial-read deadline and pre/post-handshake stdin EOF cancellation'

    foreach ($expected in @($sid,'S-1-5-18')) {
        $bundle = New-Bundle; $server = Start-Server $bundle
        $client = Start-Helper Owner $bundle $g $expected
        Assert-Exit $client 19000 $false
        Assert ([string]::IsNullOrEmpty($client.StandardOutput.ReadToEnd())) 'unverified client must never READY'
        $server.StandardInput.Close(); Assert-Exit $server 3000 $false
    }
    Write-Output 'PASS native pipe PID/token/SID and wrong server argv refusal before sending any frame'

    $bundle = New-Bundle
    $fake = New-Object IO.Pipes.NamedPipeServerStream([AgentContinue.WindowsBrowserPeer]::PipeName($bundle),
        [IO.Pipes.PipeDirection]::InOut,1,[IO.Pipes.PipeTransmissionMode]::Byte,[IO.Pipes.PipeOptions]::Asynchronous)
    $null = $script:pipes.Add($fake)
    $accept = $fake.BeginWaitForConnection($null,$null)
    $client = Start-Helper Owner $bundle $g $sid
    Assert ($accept.AsyncWaitHandle.WaitOne(19000)) 'counterfeit endpoint must be reached'
    $fake.EndWaitForConnection($accept); $accept.AsyncWaitHandle.Close()
    Assert-Closed $fake
    Assert-Exit $client 3000 $false
    Assert ([string]::IsNullOrEmpty($client.StandardOutput.ReadToEnd())) 'counterfeit cannot produce READY'
    Write-Output 'PASS actual counterfeit PowerShell argv refusal with zero handshake bytes'

    $bundle = New-Bundle
    $name = [AgentContinue.WindowsBrowserPeer]::PipeName($bundle)
    $fakeCode = @'
$ErrorActionPreference='Stop'
$pipe = [IO.Pipes.NamedPipeServerStream]::new('PIPE_NAME',[IO.Pipes.PipeDirection]::InOut,1,
    [IO.Pipes.PipeTransmissionMode]::Byte,[IO.Pipes.PipeOptions]::Asynchronous)
try {
    [Console]::Out.WriteLine('LISTENING')
    $pipe.WaitForConnection()
    $bytes = [byte[]]::new(96)
    $read = $pipe.ReadAsync($bytes,0,96)
    if (-not $read.Wait(5000)) { exit 2 }
    if ($read.Result -ne 0) { exit 3 }
    [Console]::Out.WriteLine('EMPTY')
} finally { $pipe.Dispose() }
'@
    $fakeCode = $fakeCode.Replace('PIPE_NAME',$name)
    $pwsh = (Get-Command pwsh.exe -CommandType Application | Select-Object -First 1).Source
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($fakeCode))
    $launch = New-Object Diagnostics.ProcessStartInfo($pwsh,('-NoLogo -NoProfile -NonInteractive -EncodedCommand ' + $encoded))
    $launch.UseShellExecute = $false; $launch.CreateNoWindow = $true
    $launch.RedirectStandardInput = $launch.RedirectStandardOutput = $launch.RedirectStandardError = $true
    $counterfeit = [Diagnostics.Process]::Start($launch); $null = $script:processes.Add($counterfeit)
    Assert ((Read-Line $counterfeit) -ceq 'LISTENING') 'wrong-image fixture must create a real endpoint'
    $client = Start-Helper Owner $bundle $g $sid
    Assert-Exit $client 19000 $false
    Assert ([string]::IsNullOrEmpty($client.StandardOutput.ReadToEnd())) 'wrong native image must not READY'
    Assert ((Read-Line $counterfeit 3000) -ceq 'EMPTY') 'wrong native image must receive zero frame bytes'
    Assert-Exit $counterfeit
    Write-Output 'PASS actual pwsh.exe server image refused before handshake'

    $system = [Environment]::SystemDirectory
    $psImage = Join-Path $system 'WindowsPowerShell\v1.0\powershell.exe'
    $nodeImage = Join-Path $bundle 'runtime\node.exe'
    $vector = [string[]]@($psImage,'-NoLogo','-NoProfile','-NonInteractive','-File',
        (Join-Path $bundle 'app\windows-browser-peer.ps1'),'-Role','Server','-Bundle',$bundle,'-Origin',$origin)
    Invoke-Policy CheckServerArguments @($vector,$bundle,$origin)
    $caseVariant = $vector.Clone()
    foreach ($index in @(0,5,9)) { $caseVariant[$index] = $caseVariant[$index].ToUpperInvariant() }
    Invoke-Policy CheckServerArguments @($caseVariant,$bundle,$origin)
    $bad = $vector.Clone(); $bad[1] = '-NOLOGO'
    Assert-Refused { Invoke-Policy CheckServerArguments @($bad,$bundle,$origin) }
    foreach ($index in @(0,1,2,3,4,5,6,7,8,9,10,11)) {
        $bad = $vector.Clone(); $bad[$index] += 'x'
        Assert-Refused { Invoke-Policy CheckServerArguments @($bad,$bundle,$origin) }
    }
    Assert-Refused { Invoke-Policy CheckServerArguments @([string[]]($vector + '-Extra'),$bundle,$origin) }
    $nodeArgs = [string[]]@($nodeImage,(Join-Path $bundle 'app\windows-admin-browser-host.mjs'),$origin)
    Invoke-Policy CheckNodeArguments @($nodeArgs,$bundle,$origin)
    $caseVariant = $nodeArgs.Clone(); $caseVariant[0] = $caseVariant[0].ToUpperInvariant(); $caseVariant[1] = $caseVariant[1].ToUpperInvariant()
    Invoke-Policy CheckNodeArguments @($caseVariant,$bundle,$origin)
    Invoke-Policy CheckNodeArguments @([string[]]($nodeArgs + '--parent-window=123'),$bundle,$origin)
    foreach ($extra in @('--parent-window=x','--parent-window=','--parent-window=1x','--other=1')) {
        Assert-Refused { Invoke-Policy CheckNodeArguments @([string[]]($nodeArgs + $extra),$bundle,$origin) }
    }
    Invoke-Policy CheckIdentity @($sid,1,$sid,1)
    Assert-Refused { Invoke-Policy CheckIdentity @($sid,1,'S-1-5-18',1) }
    Assert-Refused { Invoke-Policy CheckIdentity @($sid,1,$sid,2) }
    Assert-Refused { Invoke-Policy CheckIdentity @($sid,0,$sid,0) }
    Invoke-Policy CheckParentTime @([long]1,[long]2)
    Assert-Refused { Invoke-Policy CheckParentTime @([long]2,[long]2) }
    Assert-Refused { Invoke-Policy CheckParentTime @([long]3,[long]2) }
    Write-Output 'PASS exact PS/Node argv policy, SID/session policy and strict parent creation order (policy checks, not cross-session acceptance)'

    foreach ($role in @('Owner','Provider')) {
        $client = Start-Helper $role (New-Bundle) $g $sid
        $watch = [Diagnostics.Stopwatch]::StartNew()
        $client.StandardInput.Close()
        Assert-Exit $client 19000
        Assert ([string]::IsNullOrEmpty($client.StandardOutput.ReadToEnd())) 'cancelled acquisition cannot READY'
        Assert ($watch.ElapsedMilliseconds -lt 19000) 'compile and cancelled connect must be bounded'
    }
    $client = Start-Helper Owner (New-Bundle) $g $sid
    Assert-Exit $client 19000 $false
    Assert ([string]::IsNullOrEmpty($client.StandardOutput.ReadToEnd())) 'missing server cannot READY'
    foreach ($extra in @(' -Generation ' + $g,' -ExpectedSid ' + $sid,' -Unknown value')) {
        $invalid = Start-Helper Server (New-Bundle) '' '' $extra
        Assert-Exit $invalid 19000 $false
        Assert ([string]::IsNullOrEmpty($invalid.StandardOutput.ReadToEnd())) 'invalid parameter set cannot LISTEN'
    }
    Write-Output ('PASS ' + $script:checks + ' assertions; bounded native transport only, not sealed Chrome/Job/admin acceptance')
} finally {
    foreach ($pipe in $script:pipes) { $pipe.Dispose() }
    foreach ($process in $script:processes) {
        try {
            if (-not $process.HasExited) {
                $process.StandardInput.Close()
                if (-not $process.WaitForExit(3000)) {
                    $process.Kill()
                    if (-not $process.WaitForExit(3000)) { throw 'fixture helper cleanup unconfirmed' }
                }
            }
        } finally { $process.Dispose() }
    }
}
