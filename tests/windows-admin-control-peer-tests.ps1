[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# TEST ONLY: source compilation, current-process identity and pure policy calls.
# No stager dispatch, child processes, pipes, UAC, tasks or evidence-file writes.
$script:cases = 0
$script:assertions = 0
$script:failures = New-Object 'Collections.Generic.List[object]'
$script:skipped = New-Object 'Collections.Generic.List[string]'
$script:methods = @{}
$script:peer = $null
$script:sourceHash = $null
$script:identityObserved = $false
$script:actualMediumObserved = $false
$script:observedToken = $null
$script:request = $null
$script:invalid = New-Object 'Collections.Generic.List[object]'
$script:argvVectors = 0

function Assert([bool]$Condition, [string]$Message) {
    $script:assertions++
    if (-not $Condition) { throw ('ASSERT ' + $Message) }
}
function Run-Case([string]$Name, [scriptblock]$Body) {
    $script:cases++
    try { $null = & $Body }
    catch {
        $script:failures.Add([ordered]@{ case = $Name; detail = $_.Exception.GetBaseException().Message })
    }
}
function Get-Method([string]$Name, [bool]$Public, [type[]]$Types, [type]$ReturnType) {
    $flags = if ($Public) { [Reflection.BindingFlags]'Public,Static' } else { [Reflection.BindingFlags]'NonPublic,Static' }
    $method = $script:peer.GetMethod($Name, $flags, $null, $Types, $null)
    Assert ($null -ne $method) ('missing API ' + $Name + ' with exact parameter types (expected initial RED)')
    Assert (-not $method.IsGenericMethod -and $method.IsStatic) ($Name + ' must be a non-generic static method')
    if (-not $Public) { Assert $method.IsPrivate ($Name + ' must remain private policy') }
    if ($null -ne $ReturnType) { Assert ($method.ReturnType -eq $ReturnType) ($Name + ' return type') }
    return $method
}
function Assert-WitnessShape([type]$Type, [string]$Name, [hashtable]$Members) {
    Assert ($Type.Name -ceq $Name -and $Type.IsVisible) ($Name + ' must be a public concrete witness type')
    Assert (-not $Type.IsAbstract -and [IDisposable].IsAssignableFrom($Type)) ($Name + ' must implement IDisposable')
    foreach ($key in @($Members.Keys | Sort-Object)) {
        $field = $Type.GetField($key, [Reflection.BindingFlags]'Public,Instance')
        if ($null -ne $field) {
            Assert ($field.FieldType -eq $Members[$key]) ($Name + '.' + $key + ' field type')
            Assert $field.IsInitOnly ($Name + '.' + $key + ' identity field must be read-only')
        } else {
            $property = $Type.GetProperty($key, [Reflection.BindingFlags]'Public,Instance')
            Assert ($null -ne $property) ($Name + '.' + $key + ' must be public')
            Assert ($property.PropertyType -eq $Members[$key] -and $property.GetIndexParameters().Count -eq 0) ($Name + '.' + $key + ' property type')
            Assert ($null -ne $property.GetGetMethod() -and $null -eq $property.GetSetMethod()) ($Name + '.' + $key + ' must be publicly read-only')
        }
    }
}
function Assert-Refused([Reflection.MethodInfo]$Method, [object[]]$Arguments) {
    # PS5.1 unwraps TargetInvocationException. Check binding first so a reflection
    # type error cannot masquerade as a refusal from the target method.
    $parameters = $Method.GetParameters()
    Assert ($Arguments.Count -eq $parameters.Count) 'fixture reflection argument count'
    for ($i = 0; $i -lt $parameters.Count; $i++) {
        Assert (($null -eq $Arguments[$i] -and -not $parameters[$i].ParameterType.IsValueType) -or
            ($null -ne $Arguments[$i] -and $parameters[$i].ParameterType.IsInstanceOfType($Arguments[$i]))) ('fixture reflection argument type at ' + $i)
    }
    $result = $null
    $refusal = $null
    try { $result = $Method.Invoke($null, $Arguments) }
    catch { $refusal = $_.Exception.GetBaseException() }
    finally {
        if ($null -ne $result -and $result -is [IDisposable]) { $result.Dispose() }
    }
    Assert ($null -eq $result) ($Method.Name + ' must never return a witness/value for refused input')
    Assert ($null -ne $refusal) ($Method.Name + ' must explicitly refuse')
    Assert ($refusal -is [InvalidOperationException] -or $refusal -is [ArgumentException]) ($Method.Name + ' unexpected target exception: ' + $refusal.GetType().FullName)
}
function Assert-NoImpersonation {
    $threadIdentity = [Security.Principal.WindowsIdentity]::GetCurrent($true)
    try { Assert ($null -eq $threadIdentity) 'fixture must have no impersonating thread token' }
    finally { if ($null -ne $threadIdentity) { $threadIdentity.Dispose() } }
}
function Add-Invalid([string]$Name, [int]$Index, $Value, [object[]]$Base = $script:request) {
    $copy = [object[]]$Base.Clone()
    $copy[$Index] = $Value
    $script:invalid.Add([pscustomobject]@{ Name = $Name; Arguments = $copy })
}
function New-ExpectedArguments([string]$Control, [string]$Mode, $Target, [bool]$High) {
    $actions = @{ connect = 'ConnectBrowserHostedOwner'; 'resume-saved' = 'ResumeBrowserHostedOwner'; revoke = 'RevokeBrowserHostedOwner' }
    $consents = @{ connect = 'connect-browser-administrator-owner'; 'resume-saved' = 'resume-browser-administrator-owner'; revoke = 'revoke-browser-administrator-owner' }
    $action = 'RequestBrowserHostedOwnerControl'
    $consent = $consents[$Control]
    if ($Mode -ceq 'fence') {
        $action = if ($High) { 'FenceBrowserHostedOwnerControl' } else { 'RequestBrowserHostedOwnerControlFence' }
        $consent = 'fence-browser-administrator-control'
    } elseif ($Mode -ceq 'reconcile') {
        $action = if ($High) { 'ReconcileBrowserHostedOwnerControl' } else { 'RequestBrowserHostedOwnerControlReconcile' }
        $consent = 'reconcile-browser-administrator-control'
    } elseif ($High) { $action = $actions[$Control] }
    $r = $script:request
    $vector = [string[]]@($script:psImage, '-NoLogo', '-NoProfile', '-NonInteractive', '-File',
        ($r[0] + '.browser\stager.ps1'), '-Action', $action,
        '-Archive', ($r[0] + '.browser\bundle.zip'), '-ExpectedSha256', $r[1],
        '-ControlKind', $Control, '-ControlOperationId', $r[3])
    if ($High) {
        $vector += [string[]]@('-ExpectedUserSid', $r[10], '-Consent', $consent,
            '-ControlCallerPid', $r[7].ToString([Globalization.CultureInfo]::InvariantCulture),
            '-ControlCallerCreated', $r[8], '-ExpectedSessionId', $r[9].ToString([Globalization.CultureInfo]::InvariantCulture))
    }
    if ($null -ne $Target) { $vector += [string[]]@('-BrowserControlTarget', $Target) }
    return ,([string[]]$vector)
}

Run-Case 'PS5.1 x64 and fresh in-memory source compilation' {
    Assert ($PSVersionTable.PSEdition -ceq 'Desktop' -and $PSVersionTable.PSVersion.Major -eq 5 -and
        $PSVersionTable.PSVersion.Minor -eq 1 -and [Environment]::Is64BitProcess) 'Windows PowerShell 5.1 x64 required; fixture never relaunches itself'
    Assert ($null -eq ('AgentContinue.WindowsBrowserPeer' -as [type])) 'fresh process required: do not reuse a cached C# type'
    $source = Join-Path (Split-Path -Parent $PSScriptRoot) 'native\desktop-commander\windows-browser-peer.cs'
    Assert ([IO.File]::Exists($source)) 'missing C# peer source (expected initial RED)'
    $bytes = [IO.File]::ReadAllBytes($source)
    Assert ($bytes.Length -gt 0 -and $bytes.Length -le 1048576) 'bounded C# test-source read'
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $script:sourceHash = [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose() }
    $text = [Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xfeff)
    Add-Type -TypeDefinition $text -ErrorAction Stop
    # Independent self-token oracle: do not choose the Capture/refusal branch
    # from values produced by the NativeProcess implementation under test.
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class ControlPeerFixtureTokenOracle {
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr token, int kind,
        IntPtr buffer, int length, out int needed);
    public sealed class Snapshot {
        public int Integrity;
        public bool Elevated;
    }
    public static Snapshot Read(IntPtr primaryToken) {
        return new Snapshot {
            Integrity = ReadIntegrity(primaryToken),
            Elevated = ReadElevation(primaryToken)
        };
    }
    private static bool ReadElevation(IntPtr token) {
        IntPtr buffer = Marshal.AllocHGlobal(4);
        try {
            int size;
            if (!GetTokenInformation(token, 20, buffer, 4, out size))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            int value = Marshal.ReadInt32(buffer);
            if (size != 4 || (value != 0 && value != 1))
                throw new InvalidOperationException("Invalid fixture elevation result");
            return value == 1;
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    private static int ReadIntegrity(IntPtr token) {
        int size;
        if (GetTokenInformation(token, 25, IntPtr.Zero, 0, out size) ||
            Marshal.GetLastWin32Error() != 122 || size < IntPtr.Size || size > 65536)
            throw new InvalidOperationException("Invalid fixture integrity size");
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try {
            int returned;
            if (!GetTokenInformation(token, 25, buffer, size, out returned))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            if (returned < IntPtr.Size || returned > size)
                throw new InvalidOperationException("Invalid fixture integrity result");
            string sid = new SecurityIdentifier(Marshal.ReadIntPtr(buffer)).Value;
            const string prefix = "S-1-16-";
            if (!sid.StartsWith(prefix, StringComparison.Ordinal))
                throw new InvalidOperationException("Invalid fixture integrity SID");
            int value;
            if (!Int32.TryParse(sid.Substring(prefix.Length), NumberStyles.None,
                CultureInfo.InvariantCulture, out value) || value < 0)
                throw new InvalidOperationException("Invalid fixture integrity RID");
            return value;
        } finally { Marshal.FreeHGlobal(buffer); }
    }
}
'@ -ErrorAction Stop
    $script:peer = 'AgentContinue.WindowsBrowserPeer' -as [type]
    Assert ($null -ne $script:peer) 'compiled peer type must exist'
}

if ($null -ne $script:peer) {
    $openTypes = [type[]]@([string], [string], [string], [string], [string], [string], [string], [uint32], [string], [int], [string])
    $argvTypes = [type[]]@([string], [string], [string], [string], [string], [string], [bool], [uint32], [string], [int], [string])
    $roleTypes = [type[]]@([bool], [string], [int], [int], [bool], [bool], [string], [int])
    Run-Case 'public CaptureControlCallerIdentity interface' {
        $method = Get-Method 'CaptureControlCallerIdentity' $true ([type[]]@()) $null
        Assert-WitnessShape $method.ReturnType 'ControlCallerIdentity' @{
            ProcessId = [uint32]; Started = [string]; SessionId = [int]; UserSid = [string]; Alive = [bool]
        }
        $script:methods.Capture = $method
    }
    Run-Case 'public OpenControlSession interface' {
        $method = Get-Method 'OpenControlSession' $true $openTypes $null
        Assert-WitnessShape $method.ReturnType 'ControlSession' @{
            MediumPid = [uint32]; MediumStarted = [string]; HighPid = [uint32]; HighStarted = [string]
            SessionId = [int]; UserSid = [string]; Alive = [bool]
        }
        $script:methods.Open = $method
    }
    Run-Case 'private ValidateControlRequest interface' {
        $script:methods.Validate = Get-Method 'ValidateControlRequest' $false $openTypes ([void])
    }
    Run-Case 'private ControlArguments interface' {
        $script:methods.Arguments = Get-Method 'ControlArguments' $false $argvTypes ([string[]])
    }
    Run-Case 'private CheckControlRole interface' {
        $script:methods.Role = Get-Method 'CheckControlRole' $false $roleTypes ([void])
    }
    Run-Case 'private CheckControlArguments interface' {
        $script:methods.CheckArguments = Get-Method 'CheckControlArguments' $false ([type[]]@([string[]], [string[]])) ([void])
    }
    Run-Case 'observe actual self token; initialize policy inputs at any token level' {
        Assert-NoImpersonation
        $self = [Diagnostics.Process]::GetCurrentProcess()
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $native = $null
        try {
            $script:psImage = Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell\v1.0\powershell.exe'
            Assert ([string]::Equals($self.MainModule.FileName, $script:psImage, [StringComparison]::OrdinalIgnoreCase)) 'actual System32 PS5.1 image'
            Assert ($self.Id -eq $PID) 'Diagnostics must select this process'
            $principal = New-Object Security.Principal.WindowsPrincipal($identity)
            $oracle = [ControlPeerFixtureTokenOracle]::Read($identity.Token)
            $selectedSid = [regex]::IsMatch($identity.User.Value, '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z')
            # A service/High CI token is not fabricated into a Medium witness.
            # Synthetic fallback SID/session are policy inputs, never identity evidence.
            $policySid = if ($selectedSid) { $identity.User.Value } else { 'S-1-5-21-1-2-3-1001' }
            $policySession = if ($self.SessionId -gt 0) { [int]$self.SessionId } else { [int]1 }
            $digest = 'a' * 64
            $script:request = [object[]]@(('C:\AgentContinue Peer Fixture\' + $digest.Substring(0, 24)), $digest,
                ('chrome-extension://' + ('a' * 32) + '/'), ('b' * 32), 'connect', 'control',
                (('c' * 32) + ':' + ('d' * 32)), [uint32]$PID,
                $self.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture),
                $policySession, $policySid)
            $nativeType = $script:peer.GetNestedType('NativeProcess', [Reflection.BindingFlags]::NonPublic)
            Assert ($null -ne $nativeType) 'existing native self reader must exist'
            $native = [Activator]::CreateInstance($nativeType, [object[]]@([uint32]$PID))
            Assert $native.Alive 'actual held self native process is alive'
            Assert ($native.Sid -ceq $identity.User.Value -and $native.Session -eq $self.SessionId) 'native primary SID/session match WindowsIdentity and Diagnostics'
            Assert ($native.Administrator -eq $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) 'primary-token administrator observation matches WindowsIdentity principal'
            Assert ($native.Integrity -eq $oracle.Integrity) 'native integrity matches independent primary-token oracle'
            Assert ($native.Elevated -eq $oracle.Elevated) 'native elevation matches independent primary-token oracle'
            $script:observedToken = [ordered]@{
                integrity = [int]$oracle.Integrity; elevated = [bool]$oracle.Elevated
                administrator = [bool]$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); session = [int]$self.SessionId
                selectedUserSid = [bool]$selectedSid
            }
            $script:actualMediumObserved = ($oracle.Integrity -eq 8192 -and -not $oracle.Elevated -and
                -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -and $self.SessionId -gt 0 -and $selectedSid)
            Assert-NoImpersonation
            $script:identityObserved = $true
        } finally {
            if ($null -ne $native) { $native.Dispose() }
            $identity.Dispose()
            $self.Dispose()
        }
    }

    if ($script:identityObserved -and $script:methods.ContainsKey('Capture')) {
        if ($script:actualMediumObserved) {
            Run-Case 'actual Medium capture, canonical UTC ticks and disposal' {
                Assert-NoImpersonation
                $witness = $null
                $self = [Diagnostics.Process]::GetCurrentProcess()
                $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
                try {
                    $witness = $script:methods.Capture.Invoke($null, [object[]]@())
                    Assert ($null -ne $witness -and $witness -is [IDisposable]) 'capture returns a disposable actual witness'
                    Assert ($witness.ProcessId -eq [uint32]$PID -and $witness.ProcessId -eq $self.Id) 'capture selects this process, not a supplied claim'
                    $started = $self.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
                    Assert ([regex]::IsMatch($witness.Started, '\A[1-9][0-9]{0,18}\z') -and $witness.Started -ceq $started) 'Started is exact DateTime UTC ticks, not FILETIME or a JSON number'
                    Assert ($witness.SessionId -gt 0 -and $witness.SessionId -eq $self.SessionId) 'captured positive actual session'
                    Assert ($witness.UserSid -ceq $identity.User.Value) 'captured actual WindowsIdentity SID'
                    Assert $witness.Alive 'held self witness is alive before disposal'
                    Assert-NoImpersonation
                    $witness.Dispose()
                    Assert (-not $witness.Alive) 'disposed witness Alive must be false'
                    $witness.Dispose()
                    Assert (-not $witness.Alive) 'repeated disposal cannot revive witness'
                    Assert (-not $self.HasExited) 'disposing witness must not terminate selected process'
                    Assert-NoImpersonation
                } finally {
                    if ($null -ne $witness -and $witness -is [IDisposable]) { $witness.Dispose() }
                    $identity.Dispose()
                    $self.Dispose()
                }
            }
        } else {
            Run-Case 'actual non-Medium token must refuse Capture; no simulated Medium pass' {
                Assert-NoImpersonation
                Assert-Refused $script:methods.Capture ([object[]]@())
                Assert-NoImpersonation
            }
        }
    } else { $script:skipped.Add('actual capture/refusal: missing API or self-token observation') }

    if ($null -ne $script:request) {
        foreach ($value in @($null, '', 'relative', 'C:relative', '\\server\share\bundle', ($script:request[0] + '\'),
            ($script:request[0] + ' '), ($script:request[0] + '.'), ($script:request[0] + '\..'),
            $script:request[0].Replace('\', '/'), ($script:request[0] + ':stream'),
            ('C:\NUL\' + ('a' * 24)), ('C:\one\\two\' + ('a' * 24)),
            ('C:\one.\' + ('a' * 24)), ('C:\one \' + ('a' * 24)),
            ('C:\' + ('x' * 1025) + '\' + ('a' * 24)), ('C:\' + ('e' * 24)),
            ($script:request[0] + [char]0), ($script:request[0] + [char]10))) {
            Add-Invalid ('bundle-' + $script:invalid.Count) 0 $value
        }
        foreach ($value in @($null, '', ('a' * 63), ('a' * 65), ('A' * 64), ('g' * 64), (('a' * 64) + "`n"), (('a' * 64) + ' '),
            (([string][char]0xff41) * 64))) { Add-Invalid ('digest-' + $script:invalid.Count) 1 $value }
        foreach ($value in @($null, '', ('b' * 31), ('b' * 33), ('B' * 32), ('x' * 32), (('b' * 32) + "`n"))) {
            Add-Invalid ('id-' + $script:invalid.Count) 3 $value
        }
        foreach ($value in @($null, '', 'https://example.invalid/', $script:request[2].ToUpperInvariant(),
            $script:request[2].TrimEnd('/'), ($script:request[2] + 'extra'), ($script:request[2] + "`n"),
            ('chrome-extension://' + ('q' * 32) + '/'))) { Add-Invalid ('origin-' + $script:invalid.Count) 2 $value }
        foreach ($value in @($null, '', 'Connect', 'resume', 'resume_saved', 'revoke ', 'connect;revoke', ('connect' + [char]0))) {
            Add-Invalid ('control-' + $script:invalid.Count) 4 $value
        }
        foreach ($value in @($null, '', 'Control', 'Fence', 'Reconcile', 'control ', 'unknown')) {
            Add-Invalid ('mode-' + $script:invalid.Count) 5 $value
        }
        foreach ($value in @($null, '', 'idle', '1:idle', (('c' * 32) + ':IDLE'), (('C' * 32) + ':idle'),
            (('c' * 32) + ':' + ('D' * 32)), (('c' * 32) + ':' + ('d' * 31)), ($script:request[6] + "`n"),
            ($script:request[6] + ':extra'))) { Add-Invalid ('target-' + $script:invalid.Count) 6 $value }
        foreach ($value in @([uint32]0, [uint32]2147483648, [uint32]::MaxValue)) {
            Add-Invalid ('pid-' + $script:invalid.Count) 7 $value
        }
        foreach ($value in @($null, '', '0', '-1', '+1', '01', ('0' + $script:request[8]), '1.0', '1e18',
            (' ' + $script:request[8]), ($script:request[8] + "`n"), '3155378976000000000', '9223372036854775807',
            '99999999999999999999', ([string][char]0xff11))) { Add-Invalid ('started-' + $script:invalid.Count) 8 $value }
        foreach ($value in @([int]0, [int]-1, [int]::MinValue)) { Add-Invalid ('session-' + $script:invalid.Count) 9 $value }
        foreach ($value in @($null, '', 'S-1-5-18', 'S-1-5-32-544', 'S-1-5-21-1-2-3', 'S-1-5-21-1-2-3-4-5',
            'S-1-5-21-01-2-3-1001', 'S-1-5-21-4294967296-2-3-1001', 'S-1-12-1-1-2-3',
            $script:request[10].ToLowerInvariant(), ($script:request[10] + ' '), ($script:request[10] + "`n"))) {
            Add-Invalid ('sid-' + $script:invalid.Count) 10 $value
        }
        foreach ($control in @('connect', 'resume-saved', 'revoke')) {
            foreach ($mode in @('control', 'fence', 'reconcile')) {
                if ($mode -ceq 'control' -and $control -cne 'revoke') { continue }
                $base = [object[]]$script:request.Clone()
                $base[4] = $control; $base[5] = $mode
                Add-Invalid ('forbidden-target-' + $control + '-' + $mode) 6 $script:request[6] $base
                Add-Invalid ('empty-not-null-target-' + $control + '-' + $mode) 6 '' $base
            }
        }
        foreach ($item in $script:invalid) {
            Run-Case ('scalar refusal ' + $item.Name) {
                if ($script:methods.ContainsKey('Open')) { Assert-Refused $script:methods.Open $item.Arguments }
                if ($script:methods.ContainsKey('Validate')) { Assert-Refused $script:methods.Validate $item.Arguments }
            }
        }
        foreach ($control in @('connect', 'resume-saved', 'revoke')) {
            foreach ($mode in @('control', 'fence', 'reconcile')) {
                $targets = @($null)
                if ($mode -ceq 'control' -and $control -cne 'revoke') {
                    $targets = @($script:request[6], (('c' * 32) + ':idle'))
                }
                foreach ($target in $targets) {
                    $candidate = [object[]]$script:request.Clone()
                    $candidate[4] = $control; $candidate[5] = $mode; $candidate[6] = $target
                    # Self PID cannot be the required distinct held Medium/High pair,
                    # even when a CI runner actually has a High primary token.
                    Run-Case ('valid syntax but no high admission ' + $control + '/' + $mode + '/' + $target) {
                        if ($script:methods.ContainsKey('Validate')) { $null = $script:methods.Validate.Invoke($null, $candidate) }
                        if ($script:methods.ContainsKey('Open')) { Assert-Refused $script:methods.Open $candidate }
                        Assert-NoImpersonation
                    }
                    if ($script:methods.ContainsKey('Arguments')) {
                        foreach ($high in @($false, $true)) {
                            Run-Case ('policy-only exact argv ' + $control + '/' + $mode + '/high=' + $high + '/' + $target) {
                                $argumentValues = [object[]]@($candidate[0], $candidate[1], $candidate[3], $control, $mode, $target,
                                    [bool]$high, $candidate[7], $candidate[8], $candidate[9], $candidate[10])
                                $actual = $script:methods.Arguments.Invoke($null, $argumentValues)
                                $expected = New-ExpectedArguments $control $mode $target $high
                                Assert ($actual -is [string[]] -and $actual.Count -eq $expected.Count) 'exact string[] length; no extra argv'
                                for ($i = 0; $i -lt $expected.Count; $i++) {
                                    Assert ([string]::Equals($actual[$i], $expected[$i], [StringComparison]::Ordinal)) ('argv element ' + $i)
                                }
                                $script:argvVectors++
                                if ($script:methods.ContainsKey('CheckArguments')) {
                                    $check = $script:methods.CheckArguments
                                    $null = $check.Invoke($null, [object[]]@($actual, $expected))
                                    $aliases = [string[]]$actual.Clone()
                                    foreach ($index in @(0, 5, 9)) { $aliases[$index] = $aliases[$index].ToUpperInvariant() }
                                    $null = $check.Invoke($null, [object[]]@($aliases, $expected))
                                    Assert-Refused $check ([object[]]@($null, $expected))
                                    Assert-Refused $check ([object[]]@([string[]]($actual + '-Extra'), $expected))
                                    Assert-Refused $check ([object[]]@([string[]]($actual[0..($actual.Count - 2)]), $expected))
                                    for ($i = 0; $i -lt $actual.Count; $i++) {
                                        $bad = [string[]]$actual.Clone(); $bad[$i] += 'x'
                                        Assert-Refused $check ([object[]]@($bad, $expected))
                                        if ($i -notin @(0, 5, 9) -and $actual[$i].ToUpperInvariant() -cne $actual[$i]) {
                                            $bad = [string[]]$actual.Clone(); $bad[$i] = $bad[$i].ToUpperInvariant()
                                            Assert-Refused $check ([object[]]@($bad, $expected))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        if ($script:methods.ContainsKey('Validate')) {
            foreach ($sid in @('S-1-5-21-1-2-3-1001', 'S-1-12-1-1-2-3-4')) {
                Run-Case ('policy-only selected SID syntax ' + $sid) {
                    $candidate = [object[]]$script:request.Clone(); $candidate[10] = $sid
                    $null = $script:methods.Validate.Invoke($null, $candidate)
                    Assert ($true) 'local/Azure syntax validation is not selected-account admission'
                }
            }
        }
        if ($script:methods.ContainsKey('Role')) {
            foreach ($high in @($false, $true)) {
                $role = [object[]]@([bool]$high, $script:request[10], [int]$script:request[9],
                    [int]$(if ($high) { 12288 } else { 8192 }), [bool]$high, [bool]$high, $script:request[10], [int]$script:request[9])
                Run-Case ('policy-only valid role high=' + $high) {
                    $null = $script:methods.Role.Invoke($null, $role)
                    Assert ($true) 'synthetic role tuple accepted by policy only, not kernel high-pair proof'
                }
                $differentSession = [int]$script:request[9] + 1
                $mutations = @(
                    @(1, 'S-1-5-21-1-2-3-1002'), @(6, $script:request[10].ToLowerInvariant()),
                    @(2, $differentSession), @(7, $differentSession), @(2, [int]0), @(7, [int]0),
                    @(2, [int]-1), @(7, [int]-1), @(3, [int]0), @(3, [int]4096), @(3, [int]16384),
                    @(3, [int]$(if ($high) { 8192 } else { 12288 })), @(4, (-not $high)), @(5, (-not $high)))
                $mutationNames = @('wrong-SID', 'nonordinal-expected-SID', 'same-SID-other-positive-session',
                    'same-SID-other-positive-expected-session', 'session-zero', 'expected-session-zero',
                    'session-negative', 'expected-session-negative', 'integrity-zero', 'integrity-low',
                    'integrity-system', 'integrity-other-role', 'wrong-elevation', 'wrong-administrator')
                for ($i = 0; $i -lt $mutations.Count; $i++) {
                    Run-Case ('policy-only role refusal high=' + $high + '/' + $mutationNames[$i]) {
                        $bad = [object[]]$role.Clone(); $bad[$mutations[$i][0]] = $mutations[$i][1]
                        Assert-Refused $script:methods.Role $bad
                    }
                }
            }
        }
        Run-Case 'ordinal policy remains invariant under tr-TR culture' {
            $thread = [Threading.Thread]::CurrentThread
            $culture = $thread.CurrentCulture; $uiCulture = $thread.CurrentUICulture
            try {
                $thread.CurrentCulture = [Globalization.CultureInfo]::GetCultureInfo('tr-TR')
                $thread.CurrentUICulture = $thread.CurrentCulture
                if ($script:methods.ContainsKey('Validate')) {
                    $null = $script:methods.Validate.Invoke($null, $script:request)
                    foreach ($index in @(1, 2, 3, 4, 5, 6, 10)) {
                        $bad = [object[]]$script:request.Clone(); $bad[$index] = $bad[$index].ToUpperInvariant()
                        if ($index -eq 10) { $bad[$index] = $bad[$index].ToLowerInvariant() }
                        Assert-Refused $script:methods.Validate $bad
                    }
                }
                Assert-NoImpersonation
            } finally { $thread.CurrentCulture = $culture; $thread.CurrentUICulture = $uiCulture }
        }
    } else { $script:skipped.Add('public Open and policy matrices: policy-input initialization failed') }
    foreach ($key in @('Open', 'Validate', 'Arguments', 'Role', 'CheckArguments')) {
        if (-not $script:methods.ContainsKey($key)) { $script:skipped.Add('dependent checks: missing ' + $key) }
    }
    Run-Case 'final nonimpersonation' { Assert-NoImpersonation }
} else { $script:skipped.Add('all API and identity checks: C# compilation unavailable') }

$summary = [ordered]@{
    scope = 'TEST_ONLY_PS51_SOURCE_IN_MEMORY_SELF_IDENTITY_AND_POLICY'
    status = $(if ($script:failures.Count -eq 0 -and $script:skipped.Count -eq 0) { 'GREEN' } else { 'RED' })
    cases = $script:cases
    assertions = $script:assertions
    argvVectors = $script:argvVectors
    failureCount = $script:failures.Count
    failures = @($script:failures.ToArray())
    skipped = @($script:skipped.ToArray())
    sourceSha256 = $script:sourceHash
    actualMediumObserved = [bool]$script:actualMediumObserved
    actualHighPairObserved = $false
    observedToken = $script:observedToken
    productionAcceptance = $false
}
$summary | ConvertTo-Json -Depth 5 -Compress
if ($summary.status -cne 'GREEN') { exit 1 }
