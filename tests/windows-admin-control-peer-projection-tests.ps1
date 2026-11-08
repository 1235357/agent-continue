[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$script:cases=0; $script:checks=0
$script:failures=[Collections.Generic.List[object]]::new()
$script:nativePolicyValidated=$false; $script:mediumAdmissionRefused=$false
$script:observedToken=$null; $script:actualMediumObserved=$false
$script:actualMediumCallerObserved=$false; $script:actualNonMediumCaptureRefused=$false
$script:actualCaptureRefusal=$null; $script:actual=$null
function Check([bool]$Condition,[string]$Message) {
    $script:checks++
    if (-not $Condition) { throw ('ASSERT '+$Message) }
}
function Case([string]$Name,[scriptblock]$Body) {
    $script:cases++
    try { $null=& $Body } catch { $script:failures.Add(@{name=$Name;error=$_.Exception.GetBaseException().Message}) }
}
function Get-FixtureHostToken {
    # Independent primary-token oracle, identical to windows-admin-control-peer-tests.ps1.
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
    Check ($PSVersionTable.PSEdition -ceq 'Desktop' -and $PSVersionTable.PSVersion.Major -eq 5 -and
        $PSVersionTable.PSVersion.Minor -eq 1 -and [Environment]::Is64BitProcess) 'actual x64 PS5.1 host'
    $thread=[Security.Principal.WindowsIdentity]::GetCurrent($true)
    try { Check ($null -eq $thread) 'actual host has no thread impersonation' }
    finally { if ($null -ne $thread) { $thread.Dispose() } }
    $self=[Diagnostics.Process]::GetCurrentProcess()
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        $image=[IO.Path]::Combine([Environment]::SystemDirectory,'WindowsPowerShell\v1.0\powershell.exe')
        Check ([string]::Equals($self.MainModule.FileName,$image,[StringComparison]::OrdinalIgnoreCase)) 'actual System32 PS5.1 image'
        $oracle=[ControlPeerFixtureTokenOracle]::Read($identity.Token)
        $principal=[Security.Principal.WindowsPrincipal]::new($identity)
        return [ordered]@{integrity=[int]$oracle.Integrity;elevated=[bool]$oracle.Elevated;
            administrator=[bool]$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);
            session=[int]$self.SessionId;selectedUserSid=[bool][regex]::IsMatch($identity.User.Value,'\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z')}
    } finally { $identity.Dispose(); $self.Dispose() }
}
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stager=[IO.Path]::Combine($repo,'scripts\Stage-WindowsAdministratorBundle.ps1')
$peer=[IO.Path]::Combine($repo,'native\desktop-commander\windows-browser-peer.cs')
$tokens=$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($stager,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'fixture_stager_parse' }
foreach ($name in @('Get-AdministratorControlPeerType','Open-AdministratorControlKernelSession',
    'Test-AdministratorControlFields','Assert-AdministratorControlIdentity','Test-AdministratorBrowserPauseTarget',
    'Get-AdministratorControlReservationBytes')) {
    $nodes=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true))
    if ($nodes.Count -ne 1) { throw ('fixture_missing_function_'+$name) }
    . ([scriptblock]::Create($nodes[0].Extent.Text))
}

# Test-only compiler directory: ACL checks are explicitly stubbed, not elevated.
$scratch=[IO.Path]::Combine([IO.Path]::GetTempPath(),'AC-ControlPeerProjection-'+[Guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($scratch)
function Assert-SealedAcl([string]$Path,[bool]$Directory,[bool]$Private) {
    if ($Path -cne $script:scratch -or -not $Directory -or -not $Private) { throw 'fixture_acl_contract' }
}
$fakeSource=@'
using System;
namespace AgentContinue {
 public static class WindowsBrowserPeer {
  public static object Next;
  public static object SeenTarget;
  public static object OpenControlSession(string bundle,string digest,string origin,string id,string control,
   string mode,string target,uint pid,string started,int session,string sid) { SeenTarget=target; return Next; }
  public sealed class ControlSession : IDisposable {
   public uint MediumPid=11,HighPid=12;
   public string MediumStarted="638000000000000001",HighStarted="638000000000000002",UserSid="S-1-5-21-1-2-3-1001";
   public int SessionId=1,Reads;
   public bool Disposed,InitialAlive=true,FailFinal;
   public bool Alive { get { Reads++; return !Disposed && InitialAlive && !(FailFinal && Reads>=3); } }
   public void Dispose() { Disposed=true; }
  }
  public sealed class WrongWitness : IDisposable {
   public bool Disposed;
   public void Dispose() { Disposed=true; }
  }
 }
}
'@
$script:fake=Get-AdministratorControlPeerType ([Text.Encoding]::UTF8.GetBytes($fakeSource)) $scratch
$script:reservation=[scriptblock](Get-Item Function:\Get-AdministratorControlReservationBytes).ScriptBlock
$script:reservationCalls=0
function Get-AdministratorControlReservationBytes([string]$Digest,[string]$Sid,[string]$Origin,[string]$Id,
    [string]$Control,$Target,$Generation,$Runner,$Session) {
    $script:reservationCalls++
    & $script:reservation @PSBoundParameters
}
$script:digest='a'*64; $script:sid='S-1-5-21-1-2-3-1001'
$script:target=('b'*32)+':idle'
$script:bundle=[IO.Path]::Combine([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles),
    'AgentContinueAdmin',$script:digest.Substring(0,24))
if ($script:bundle -cnotmatch '\A[A-Z]:\\[^\\]' -or
    -not [string]::Equals([IO.Path]::GetFullPath($script:bundle),$script:bundle,[StringComparison]::Ordinal)) {
    throw 'fixture_canonical_bundle'
}
function Parameters([string]$Control='connect',[string]$Mode='control') {
    @{PeerType=$script:fake;BundleRoot=$script:bundle;Digest=$script:digest;Origin=('chrome-extension://'+('a'*32)+'/');
      Id=('c'*32);Control=$Control;Mode=$Mode;Target=$(if($Mode -ceq 'control' -and $Control -cne 'revoke'){$script:target}else{$null});
      CallerPid=[uint32]11;CallerStarted='638000000000000001';SessionId=1;Sid=$script:sid}
}
function New-Witness {
    $value=[Activator]::CreateInstance($script:fake.GetNestedType('ControlSession'))
    $script:fake::Next=$value
    return $value
}
foreach ($mode in @('control','fence','reconcile')) {
    foreach ($control in @('connect','resume-saved','revoke')) {
        Case ('typed projection '+$mode+' '+$control) {
            $witness=New-Witness; $parameters=Parameters $control $mode
            $before=$script:reservationCalls
            $row=Open-AdministratorControlKernelSession @parameters
            try {
                Check ([object]::ReferenceEquals($witness,$row.Witness)) 'actual typed witness retained'
                Check (-not $witness.Disposed) 'success transfers disposable ownership'
                Check (Test-AdministratorControlFields $row @('Witness','Runner','Session')) 'closed projection'
                Check ($row.Runner.pid -is [int] -and $row.Runner.pid -eq 12) 'uint high PID becomes bounded Int32'
                Check ($row.Session.mediumPid -is [int] -and $row.Session.mediumPid -eq 11) 'uint medium PID becomes Int32'
                Check ($row.Session.highPid -is [int] -and $row.Session.sessionId -is [int]) 'other projected numbers Int32'
                Check ($row.Runner.started -ceq '638000000000000002') 'UTC ticks preserved'
                Check ($row.Session.userSid -ceq $script:sid) 'selected SID preserved'
                Check (($script:reservationCalls-$before) -eq $(if($mode -ceq 'control'){1}else{0})) 'only control serializes original reservation'
                if ($null -eq $parameters.Target) { Check ($null -eq $script:fake::SeenTarget) 'null remains null at native call' }
                else { Check ($script:fake::SeenTarget -ceq $script:target) 'original target remains exact' }
            } finally { $row.Witness.Dispose() }
            Check $witness.Disposed 'caller releases successful witness'
        }
    }
}
$bad=@(
    @{Name='medium PID zero';Field='MediumPid';Value=[uint32]0},
    @{Name='high PID zero';Field='HighPid';Value=[uint32]0},
    @{Name='high PID overflow';Field='HighPid';Value=[uint32]::MaxValue},
    @{Name='medium PID overflow';Field='MediumPid';Value=[uint32]::MaxValue},
    @{Name='medium identity mismatch';Field='MediumPid';Value=[uint32]13},
    @{Name='same PID';Field='HighPid';Value=[uint32]11},
    @{Name='wrong session';Field='SessionId';Value=2},
    @{Name='session zero';Field='SessionId';Value=0},
    @{Name='wrong SID';Field='UserSid';Value='S-1-5-21-1-2-3-1002'},
    @{Name='null SID';Field='UserSid';Value=$null},
    @{Name='wrong medium start';Field='MediumStarted';Value='638000000000000003'},
    @{Name='tick zero';Field='HighStarted';Value='0'},
    @{Name='tick prefix';Field='HighStarted';Value='0638000000000000002'},
    @{Name='tick overflow';Field='HighStarted';Value='9223372036854775807'},
    @{Name='tick invisible';Field='HighStarted';Value=('638000000000000002'+[char]0x200B)},
    @{Name='tick null';Field='HighStarted';Value=$null},
    @{Name='initially dead';Field='InitialAlive';Value=$false},
    @{Name='dies before transfer';Field='FailFinal';Value=$true}
)
foreach ($item in $bad) {
    foreach ($mode in @('control','fence','reconcile')) {
        Case ($mode+' refuses '+$item.Name) {
            $witness=New-Witness
            $witness.GetType().GetField($item.Field).SetValue($witness,$item.Value)
            $parameters=Parameters 'connect' $mode
            $thrown=$false; $row=$null
            try { $row=Open-AdministratorControlKernelSession @parameters } catch { $thrown=$true }
            if ($null -ne $row) { $row.Witness.Dispose() }
            Check $thrown 'malformed typed witness refused'
            Check $witness.Disposed 'failed witness disposed'
        }
    }
}
Case 'wrong disposable type rejected and disposed' {
    $wrong=[Activator]::CreateInstance($script:fake.GetNestedType('WrongWitness'))
    $script:fake::Next=$wrong
    $parameters=Parameters
    $thrown=$false
    try { $null=Open-AdministratorControlKernelSession @parameters } catch { $thrown=$true }
    Check $thrown 'not a nested ControlSession'
    Check $wrong.Disposed 'wrong disposable object released'
}
Case 'null return refused' {
    $script:fake::Next=$null
    $parameters=Parameters; $thrown=$false
    try { $null=Open-AdministratorControlKernelSession @parameters } catch { $thrown=$true }
    Check $thrown 'no witness no session'
}
Case 'actual native request policy validates inputs independently of capture' {
    $script:actual=Get-AdministratorControlPeerType ([IO.File]::ReadAllBytes($peer)) $scratch
    $policy=$script:actual.GetMethod('ValidateControlRequest',[Reflection.BindingFlags]'NonPublic,Static')
    Check ($null -ne $policy -and $policy.IsPrivate -and $policy.IsStatic -and $policy.ReturnType -eq [void]) 'exact native request policy available'
    foreach ($mode in @('control','fence','reconcile')) {
        foreach ($control in @('connect','resume-saved','revoke')) {
            # These are synthetic policy inputs, never observed process claims.
            $parameters=Parameters $control $mode
            $arguments=[object[]]@($parameters.BundleRoot,$parameters.Digest,$parameters.Origin,$parameters.Id,
                $parameters.Control,$parameters.Mode,$parameters.Target,$parameters.CallerPid,$parameters.CallerStarted,
                $parameters.SessionId,$parameters.Sid)
            $answer=$policy.Invoke($null,$arguments)
            Check ($null -eq $answer) ('canonical policy inputs return void '+$mode+'/'+$control)
            $invalid=[object[]]$arguments.Clone(); $invalid[7]=[uint32]0
            $refusal=$null
            try { $null=$policy.Invoke($null,$invalid) } catch { $refusal=$_.Exception.GetBaseException() }
            Check ($refusal -is [InvalidOperationException] -and $refusal.Message -ceq 'browser_peer_unavailable') 'invalid policy PID refused exactly'
        }
    }
    $script:nativePolicyValidated=$true
}
Case 'actual host token requires exact medium capture or exact non-medium refusal' {
    $script:observedToken=Get-FixtureHostToken
    $script:actualMediumObserved=($script:observedToken.integrity -eq 8192 -and -not $script:observedToken.elevated -and
        -not $script:observedToken.administrator -and $script:observedToken.session -gt 0 -and $script:observedToken.selectedUserSid)
    Check ($null -ne $script:actual) 'actual peer source compiled before capture'
    $process=[Diagnostics.Process]::GetCurrentProcess()
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    $self=$null; $refusal=$null
    try {
        try { $self=$script:actual::CaptureControlCallerIdentity() } catch { $refusal=$_.Exception.GetBaseException() }
        if ($script:actualMediumObserved) {
            Check ($null -eq $refusal -and $null -ne $self -and $self -is [IDisposable]) 'actual medium capture succeeds'
            Check ($self.ProcessId -eq [uint32]$PID -and $self.ProcessId -eq $process.Id) 'actual capture selects self only'
            $started=$process.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
            Check ($self.Started -cmatch '\A[1-9][0-9]{0,18}\z' -and $self.Started -ceq $started) 'actual capture preserves exact UTC ticks'
            Check ($self.SessionId -eq $process.SessionId -and $self.SessionId -gt 0 -and $self.UserSid -ceq $identity.User.Value) 'actual capture preserves independent session and SID'
            Check $self.Alive 'actual medium self identity held'
            $parameters=Parameters
            $parameters.PeerType=$script:actual
            $parameters.CallerPid=$self.ProcessId
            $parameters.CallerStarted=$self.Started
            $parameters.SessionId=$self.SessionId
            $parameters.Sid=$self.UserSid
            $policy=$script:actual.GetMethod('ValidateControlRequest',[Reflection.BindingFlags]'NonPublic,Static')
            $arguments=[object[]]@($parameters.BundleRoot,$parameters.Digest,$parameters.Origin,$parameters.Id,
                $parameters.Control,$parameters.Mode,$parameters.Target,$parameters.CallerPid,$parameters.CallerStarted,
                $parameters.SessionId,$parameters.Sid)
            $null=$policy.Invoke($null,$arguments)
            $refusal=$null; $unexpected=$null
            try { $unexpected=Open-AdministratorControlKernelSession @parameters }
            catch { $refusal=$_.Exception.GetBaseException() }
            finally { if ($null -ne $unexpected) { $unexpected.Witness.Dispose() } }
            Check ($null -eq $unexpected) 'medium never returns a high witness'
            Check ($refusal -is [InvalidOperationException] -and $refusal.Message -ceq 'browser_peer_unavailable') 'exact native admission refusal after valid policy'
            $script:mediumAdmissionRefused=$true
            $self.Dispose(); Check (-not $self.Alive) 'actual self witness disposed'
            $self.Dispose(); Check (-not $self.Alive) 'repeated disposal cannot revive actual witness'
            Check (-not $process.HasExited) 'disposing actual witness never terminates self'
            $script:actualMediumCallerObserved=$true
        } else {
            Check ($null -eq $self) 'non-medium capture never returns a witness'
            Check ($refusal -is [InvalidOperationException] -and $refusal.Message -ceq 'browser_peer_unavailable') 'non-medium capture refuses exactly'
            $script:actualCaptureRefusal=$refusal.Message
            $script:actualNonMediumCaptureRefused=$true
        }
    } finally {
        if ($null -ne $self) { $self.Dispose() }
        $identity.Dispose(); $process.Dispose()
    }
}
function Hash([string]$File) {
    $hash=[Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash([IO.File]::ReadAllBytes($File))).Replace('-','').ToLowerInvariant() }
    finally { $hash.Dispose() }
}
[Console]::WriteLine((ConvertTo-Json -InputObject ([ordered]@{
    ok=($script:failures.Count -eq 0);scope='typed-projection-with-fake-peer-and-token-aware-capture-not-high-proof';
    cases=$script:cases;assertions=$script:checks;failures=@($script:failures.ToArray());
    compilerAclStub=$true;fakeTypedPeerProjections=$true;actualHighPair=$false;protectedAcceptance=$false;
    nativeRequestPolicyValidated=$script:nativePolicyValidated;actualMediumAdmissionRefused=$script:mediumAdmissionRefused;
    observedToken=$script:observedToken;actualMediumObserved=$script:actualMediumObserved;
    actualMediumCallerObserved=$script:actualMediumCallerObserved;actualNonMediumCaptureRefused=$script:actualNonMediumCaptureRefused;
    actualCaptureRefusal=$script:actualCaptureRefusal;
    stagerSha256=(Hash $stager);peerSourceSha256=(Hash $peer)
}) -Depth 5 -Compress))
if ($script:failures.Count) { exit 1 }
