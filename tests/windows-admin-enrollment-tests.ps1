[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$stager = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'))
$errorsFound = $null
$tokens = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($stager,[ref]$tokens,[ref]$errorsFound)
if ($errorsFound.Count) { throw 'stager_parse' }
$names = @('New-AdministratorBrowserEnrollmentPlan','New-AdministratorBrowserTaskDefinition',
    'Assert-AdministratorBrowserTaskAcl','Assert-AdministratorBrowserTask',
    'Get-AdministratorBrowserComItem','Remove-AdministratorBrowserEndpoints','Get-AdministratorBrowserReservation',
    'Read-AdministratorBrowserStager','Copy-Or-Hash','To-Hex','Test-FailedBrowserOwnerTask')
foreach ($fn in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] },$true)) {
    if ($fn.Name -in $names) { . ([scriptblock]::Create($fn.Extent.Text)) }
}
$system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
$sourceDigest = (Get-FileHash -LiteralPath $stager).Hash.ToLowerInvariant()
$sha = [Security.Cryptography.SHA256]::Create()
try {
    $previous = [IO.MemoryStream]::new([byte[]]@(1,2,3))
    try { $null = Copy-Or-Hash $previous $previous.Length $null } finally { $previous.Dispose() }
    $sourceBytes = Read-AdministratorBrowserStager $stager $sourceDigest
    if ($sourceBytes -isnot [byte[]] -or $sourceBytes.Length -ne [IO.FileInfo]::new($stager).Length) {
        throw 'verified stager source did not preserve exact bytes'
    }
    try { $null = Read-AdministratorBrowserStager $stager ('0' * 64); throw 'accepted a mismatched stager' }
    catch { if ($_.Exception.Message -cne 'browser_stager_hash') { throw } }
} finally { $sha.Dispose() }
[Console]::WriteLine('PASS stager self-hash after finalized shared bundle digest and mismatched digest refusal')
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$digest = ('7' * 64)
$root = [IO.Path]::Combine([IO.Path]::GetPathRoot($system),'Program Files','AgentContinueAdmin',$digest.Substring(0,24))
$tunnel = 'tunnel_' + ('a' * 32)
$extension = ('b' * 32)
$plan = New-AdministratorBrowserEnrollmentPlan $root $digest $sid $tunnel $extension $system
$hostJson = [Text.Encoding]::UTF8.GetString($plan.Files['host.json']) | ConvertFrom-Json
$binding = [Text.Encoding]::UTF8.GetString($plan.Files['binding.json']) | ConvertFrom-Json
$demand = [Text.Encoding]::ASCII.GetString($plan.DemandBytes)
if ($hostJson.name -cne 'com.agentcontinue.administrator_owner' -or $hostJson.allowed_origins.Count -ne 1 -or
    $hostJson.allowed_origins[0] -cne ('chrome-extension://' + $extension + '/') -or
    $binding.origin -cne $hostJson.allowed_origins[0] -or $binding.bundleSha256 -cne $digest -or
    $demand -notmatch '(?m)^set "NODE_OPTIONS="$' -and $demand -notmatch '(?m)^set "NODE_OPTIONS="\r$' -or
    $demand -match '%|\$\(|powershell\.exe' -or $plan.Arguments -cne ('/D /S /C ""{0}""' -f $plan.DemandScript)) {
    throw 'browser_plan'
}
$reg = [Security.AccessControl.RegistrySecurity]::new()
$regSddl = 'O:BAG:SYD:P(A;;KA;;;SY)(A;;KA;;;BA)(A;;KR;;;' + $sid + ')'
$reg.SetSecurityDescriptorSddlForm($regSddl)
Assert-AdministratorBrowserTaskAcl ($reg.GetSecurityDescriptorSddlForm('Access,Owner')) $regSddl
$caught = $false
try {
    Assert-AdministratorBrowserTaskAcl $plan.Sddl.Replace('(A;;FRFX;;;','(A;;FA;;;') $plan.Sddl
} catch { $caught = $_.Exception.Message -ceq 'browser_task_acl' }
if (-not $caught) { throw 'accepted task ACL giving the selected SID full control' }

# Use the real Task Scheduler COM service, but only construct an unregistered definition.
$scheduler = New-Object -ComObject Schedule.Service
$scheduler.Connect()
$definition = New-AdministratorBrowserTaskDefinition $scheduler $plan
if ($definition.Settings.MultipleInstances -ne 1) { throw 'browser_start_request_would_be_dropped_instead_of_queued' }
$fixture = [pscustomobject]@{Path=('\' + $plan.Folder + '\' + $plan.Name); Enabled=$false; Definition=$definition; Sddl=$plan.Sddl}
$fixture | Add-Member -MemberType ScriptMethod -Name GetSecurityDescriptor -Value { param($parts) $this.Sddl }
Assert-AdministratorBrowserTask $fixture $plan $false
$definition.Settings.MultipleInstances = 2
try { Assert-AdministratorBrowserTask $fixture $plan $false; throw 'accepted_IgnoreNew_policy' }
catch { if ($_.Exception.Message -cne 'browser_task_definition') { throw } }
$definition.Settings.MultipleInstances = 1
$definition.Actions.Item(1).Arguments = '/D /C echo altered'
$caught = $false
try { Assert-AdministratorBrowserTask $fixture $plan $false }
catch { $caught = $_.Exception.Message -ceq 'browser_task_action' }
if (-not $caught) { throw 'accepted a changed task action' }

$reservation = Get-AdministratorBrowserReservation $plan $digest
$different = New-AdministratorBrowserEnrollmentPlan $root $digest $sid $tunnel ('c' * 32) $system
if ($reservation -ceq (Get-AdministratorBrowserReservation $different $digest)) { throw 'reservation did not bind the origin' }
$d = New-AdministratorBrowserTaskDefinition $scheduler $plan
$d.Settings.Enabled = $true
$registered = [pscustomobject]@{Path=('\' + $plan.Folder + '\' + $plan.Name); Enabled=$true;
    Definition=$d; Sddl=$plan.Sddl; Running=1}
$registered | Add-Member -MemberType ScriptMethod -Name GetSecurityDescriptor -Value { param($parts) $this.Sddl }
$registered | Add-Member -MemberType ScriptMethod -Name GetInstances -Value { param($flags) [pscustomobject]@{Count=$this.Running} }
$directory = [pscustomobject]@{Task=$registered;Sddl=$plan.Sddl;Removed=$false;Other=$false}
$directory | Add-Member -MemberType ScriptMethod -Name GetSecurityDescriptor -Value { param($parts) $this.Sddl }
$directory | Add-Member -MemberType ScriptMethod -Name GetFolders -Value { param($flags) [pscustomobject]@{Count=0} }
$directory | Add-Member -MemberType ScriptMethod -Name GetTasks -Value {
    param($flags)
    $count = if ($this.Removed) { 0 } elseif ($this.Other) { 2 } else { 1 }
    $list = [pscustomobject]@{Count=$count; Task=$this.Task}
    $list | Add-Member -MemberType ScriptMethod -Name Item -Value { param($index) $this.Task }
    return $list
}
$directory | Add-Member -MemberType ScriptMethod -Name GetTask -Value {
    param($name) $this.Task.Definition.Settings.Enabled = $this.Task.Enabled; return $this.Task
}
$directory | Add-Member -MemberType ScriptMethod -Name DeleteTask -Value { param($name,$flags) $this.Removed=$true }
$service = [pscustomobject]@{Folder=$directory;Gone=$false}
$service | Add-Member -MemberType ScriptMethod -Name GetFolder -Value {
    param($name)
    if ($name -ceq '\') { return $this }
    if ($this.Gone) { throw [IO.FileNotFoundException]::new() }
    return $this.Folder
}
$service | Add-Member -MemberType ScriptMethod -Name DeleteFolder -Value { param($name,$flags) $this.Gone=$true }
$calls = [pscustomobject]@{Count=0}
$remove = { $calls.Count++ }
$directory.Other=$true
try { Remove-AdministratorBrowserEndpoints $service $plan $remove; throw 'test_expected_refusal' }
catch { if ($_.Exception.Message -cne 'browser_unenrollment_folder') { throw } }
if ($calls.Count -ne 0 -or -not $registered.Enabled -or $directory.Removed -or $service.Gone) { throw 'changed a foreign folder' }
$directory.Other=$false
try { Remove-AdministratorBrowserEndpoints $service $plan $remove; throw 'test_expected_refusal' }
catch { if ($_.Exception.Message -cne 'browser_unenrollment_active') { throw } }
if ($calls.Count -ne 0 -or $registered.Enabled -or $directory.Removed -or $service.Gone) { throw 'removed an active endpoint' }
$registered.Running=0
try { Remove-AdministratorBrowserEndpoints $service $plan { throw 'host_removal_unconfirmed' }; throw 'test_expected_refusal' }
catch { if ($_.Exception.Message -cne 'host_removal_unconfirmed') { throw } }
if ($registered.Enabled -or $directory.Removed -or $service.Gone) { throw 'did not preserve disabled endpoints on an unknown host removal' }
$directory.Removed=$true
try { Remove-AdministratorBrowserEndpoints $service $plan $remove -PendingEnrollment; throw 'test_expected_refusal' }
catch { if ($_.Exception.Message -cne 'browser_unenrollment_folder') { throw } }
if ($calls.Count -ne 0 -or $service.Gone) { throw 'removed an ambiguous empty folder from pending enrollment' }
$directory.Removed=$false
Remove-AdministratorBrowserEndpoints $service $plan $remove
if ($calls.Count -ne 1 -or -not $directory.Removed -or -not $service.Gone) { throw 'expected exact endpoint cleanup' }
[Console]::WriteLine('PASS bound reservation, foreign task refusal, and drained endpoint removal')

$service.Gone=$false
$directory.Removed=$false
$service | Add-Member -NotePropertyName InterruptFolderRemoval -NotePropertyValue $true
$service | Add-Member -MemberType ScriptMethod -Name DeleteFolder -Force -Value {
    param($name,$flags)
    if ($this.InterruptFolderRemoval) { throw 'injected_folder_interruption' }
    $this.Gone=$true
}
if (-not (Test-FailedBrowserOwnerTask $service $plan)) { throw 'failed_owner_exact_task_unobserved' }
try { Remove-AdministratorBrowserEndpoints $service $plan $remove; throw 'test_expected_interruption' }
catch { if ($_.Exception.GetBaseException().Message -cne 'injected_folder_interruption') { throw } }
if ($calls.Count -ne 2 -or -not $directory.Removed -or $service.Gone) { throw 'interruption was not after task deletion' }
try { $null=Test-FailedBrowserOwnerTask $service $plan; throw 'test_expected_refusal' }
catch { if ($_.Exception.Message -cne 'failed_owner_task') { throw } }
if (Test-FailedBrowserOwnerTask $service $plan -RetirementAuthorized) { throw 'partial retirement still claims a task' }
$service.InterruptFolderRemoval=$false
Remove-AdministratorBrowserEndpoints $service $plan $remove
if ($calls.Count -ne 3 -or -not $service.Gone -or (Test-FailedBrowserOwnerTask $service $plan -RetirementAuthorized)) {
    throw 'authorized retirement did not finish after interruption'
}
[Console]::WriteLine('PASS failed retirement refuses unbound empty folder and resumes after task deletion')

$ps = [IO.Path]::Combine($system,'WindowsPowerShell','v1.0','powershell.exe')
$archive = Join-Path ([IO.Path]::GetTempPath()) ('missing-ac-browser-enrollment-' + [guid]::NewGuid().ToString('N') + '.zip')
$args = @('-NoLogo','-NoProfile','-NonInteractive','-File',$stager,'-Archive',$archive,'-ExpectedSha256',$digest)
$reject = & $ps @args -Action Plan -BrowserWake
$exit = $LASTEXITCODE
if ($exit -ne 2 -or ($reject | ConvertFrom-Json).phase -cne 'input') { throw 'accepted browser wake on an unrelated stager action' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
try { $admin = [Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }
finally { $identity.Dispose() }
if (-not $admin) {
    $enroll = @('-Action','EnrollBrowserOwner','-Consent','accept-administrator-browser-enrollment',
        '-ExpectedUserSid',$sid,'-HostedTunnelId',$tunnel,'-BrowserExtensionId',$extension,'-ExpectedStagerSha256',('a' * 64))
    $reject = & $ps @args @enroll
    $exit = $LASTEXITCODE
    $receipt = $reject | ConvertFrom-Json
    if ($exit -ne 2 -or $receipt.phase -cne 'identity' -or $receipt.registrationChanged -ne $false) {
        throw 'ordinary token was not refused before enrollment'
    }
    $source = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class AcEnrollmentAccessFixture {
    [StructLayout(LayoutKind.Sequential)]
    public struct Mapping { public uint Read, Write, Execute, All; }
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool DuplicateToken(IntPtr original, int level, out IntPtr token);
    [DllImport("advapi32.dll")]
    private static extern void MapGenericMask(ref uint mask, ref Mapping mapping);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool AccessCheck(byte[] descriptor, IntPtr token, uint desired, ref Mapping mapping,
        [Out] byte[] privileges, ref uint size, out uint granted, out bool allowed);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
    public static bool Allowed(byte[] descriptor, IntPtr identity, uint desired, bool registry) {
        var map = registry ? new Mapping { Read = 0x20019, Write = 0x20006, Execute = 0x20019, All = 0xf003f }
                           : new Mapping { Read = 0x120089, Write = 0x120116, Execute = 0x1200a0, All = 0x1f01ff };
        MapGenericMask(ref desired, ref map);
        IntPtr token;
        if (!DuplicateToken(identity, 2, out token)) throw new Win32Exception();
        try {
            var privileges = new byte[1024];
            uint granted, size = (uint)privileges.Length;
            bool allowed;
            if (!AccessCheck(descriptor, token, desired, ref map, privileges, ref size, out granted, out allowed))
                throw new Win32Exception();
            return allowed && (granted & desired) == desired;
        } finally { CloseHandle(token); }
    }
}
'@
    Add-Type -TypeDefinition $source
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        foreach ($case in @(@($plan.Sddl,$false),@($regSddl,$true))) {
            $raw = [Security.AccessControl.RawSecurityDescriptor]::new($case[0])
            $bytes = [byte[]]::new($raw.BinaryLength)
            $raw.GetBinaryForm($bytes,0)
            foreach ($right in @([uint32]2147483648,[uint32]536870912)) { # GENERIC_READ, GENERIC_EXECUTE
                if (-not [AcEnrollmentAccessFixture]::Allowed($bytes,$identity.Token,$right,$case[1])) {
                    throw 'selected token was not allowed to read/execute descriptor'
                }
            }
            foreach ($right in @([uint32]1073741824,[uint32]65536,[uint32]262144,[uint32]524288)) {
                if ([AcEnrollmentAccessFixture]::Allowed($bytes,$identity.Token,$right,$case[1])) {
                    throw 'selected token unexpectedly has write, delete, ACL or owner access'
                }
            }
        }
    } finally { $identity.Dispose() }
    [Console]::WriteLine('PASS Windows AccessCheck for the intended descriptors against the real current medium token')
}
[Console]::WriteLine('PASS real COM task definition, pinned command, ACL, and nonmutating refusal')
