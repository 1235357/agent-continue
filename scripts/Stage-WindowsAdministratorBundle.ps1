[CmdletBinding()]
param(
    [ValidateSet('Plan','Stage','Verify','PrepareState','VerifyState','ProbeLocal','AcceptLocal','InstallBrowserOwner','BindHosted','VerifyHosted','RunHostedWindow','StopHostedWindow','AuthorizeHostedOwner','ReauthorizeHostedOwner','RevokeHostedOwner','StartHostedOwner','ObserveHostedOwner','EnrollBrowserOwner','UnenrollBrowserOwner','InspectFailedBrowserOwner','RetireFailedBrowserOwner','ConnectHostedOwner','PauseHostedOwner','ObserveHostedOwnerPause','CheckBrowserHostedOwnerPause','RequestBrowserHostedOwnerPause','RequestBrowserHostedOwnerPauseFence','PauseBrowserHostedOwner','FenceBrowserHostedOwnerPause','RepairBrowserHostedOwnerPauseTarget','ObserveHostedOwnerControl','RequestBrowserHostedOwnerControl','RequestBrowserHostedOwnerControlFence','RequestBrowserHostedOwnerControlReconcile','ConnectBrowserHostedOwner','ResumeBrowserHostedOwner','RevokeBrowserHostedOwner','FenceBrowserHostedOwnerControl','ReconcileBrowserHostedOwnerControl','CheckBrowserHostedOwnerControl','ObserveBrowserSetup','CheckBrowserHostedOwnerInstallationPause','RequestBrowserHostedOwnerInstallationPause','ObserveBrowserHostedOwnerInstallationPause','PauseBrowserHostedOwnerInstallation')][string]$Action = 'Plan',
    [Parameter(Mandatory=$true)][string]$Archive,
    [Parameter(Mandatory=$true)][string]$ExpectedSha256,
    [string]$Consent = '',
    [string]$ExpectedUserSid = '',
    [int]$LocalAcceptanceWitness = 0,
    [string]$HostedTunnelId = '',
    [Alias('ProbeReceiptId')][string]$OperationReceiptId = '',
    [string]$RuntimeKeyFile = '',
    [string]$HostedWindowSource = '',
    [int]$HostedWindowSeconds = 0,
    [string]$HostedAdmissionSource = '',
    [string]$HostedAcceptancePlan = '',
    [string]$HostedAcceptancePlanSha256 = '',
    [string]$AfterReadOnlyWindow = '',
    [string]$AfterUnusedWindow = '',
    [string]$BrowserExtensionId = '',
    [string]$BrowserSetupId = '',
    [string]$ExpectedStagerSha256 = '',
    [string]$PreviousRevocationId = '',
    [string]$ReauthorizationId = '',
    [string]$InstallerSourcePath = '',
    [string]$FailedOwnerGeneration = '',
    [string]$PauseOperationId = '',
    [string]$BrowserPauseTarget = '',
    [string]$ControlOperationId = '',
    [string]$ControlKind = '',
    [string]$BrowserControlTarget = '',
    [uint32]$ControlCallerPid = 0,
    [string]$ControlCallerCreated = '',
    [int]$ExpectedSessionId = 0,
    [switch]$BrowserWake
)

# The stager must itself come from a trusted local source. Only the local probe actions run the sealed bundle.
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
$systemSid = 'S-1-5-18'
$administratorsSid = 'S-1-5-32-544'
$usersSid = 'S-1-5-32-545'
$installerSid = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
$requiredFiles = @('runtime/node.exe','client/tunnel-client-runtime.exe','app/host.mjs',
    'app/runtime.mjs','app/lifecycle.mjs','app/profile.mjs','app/tunnel-pins.json','app/upstream-pin.json',
    'app/package-lock.json','app/node_modules/@wonderwhy-er/desktop-commander/dist/server.js')
$manifestLimit = 40000
$entryLimit = 192MB
$totalLimit = 768MB
$phase = 'input'
$installBrowserOwner = $false
$sha = $inputStream = $zip = $reservation = $stateReservation = $null
$files = $null
$success = $false
$stateVerified = $false
$launchPlanVerified = $false
$localProbeVerified = $false
$hostedBindingPrepared = $false
$hostedOwnerAuthorized = $false
$browserEnrollmentAttempted = $false
$browserEnrollmentCommitted = $false
$installSecret = $null
$hostedLaunchPlanVerified = $false
$filesVerified = $false
$diagnostic = 'none'
$probeReceipt = $null
$hostedWindowResult = $null

function To-Hex([byte[]]$Bytes) {
    [BitConverter]::ToString($Bytes).Replace('-','').ToLowerInvariant()
}

function Assert-PathType([string]$Path, [bool]$Directory) {
    $attributes = [IO.File]::GetAttributes($Path)
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -or
        ([bool]($attributes -band [IO.FileAttributes]::Directory) -ne $Directory)) { throw 'path_type' }
}

function Assert-FirstLocalAcceptanceAvailable([string]$Root) {
    foreach ($path in @($Root,($Root + '.state'),($Root + '.stage'),($Root + '.state.stage'),($Root + '.secrets'))) {
        try { $null = [IO.File]::GetAttributes($path) }
        catch {
            $cause = $_.Exception.GetBaseException()
            if ($cause -is [IO.FileNotFoundException] -or $cause -is [IO.DirectoryNotFoundException]) { continue }
            throw
        }
        throw 'existing_acceptance_artifact'
    }
}

function Assert-Anchor([string]$Path, [bool]$Volume, [bool]$Directory = $true) {
    Assert-PathType $Path $Directory
    $acl = if ($Directory) { [IO.Directory]::GetAccessControl($Path) } else { [IO.File]::GetAccessControl($Path) }
    $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(),0)
    if ($descriptor.Owner.Value -notin @($systemSid,$administratorsSid,$installerSid) -or
        $null -eq $descriptor.DiscretionaryAcl) { throw 'anchor_acl' }
    # On a standard Windows volume, non-admins may create other directories at
    # the volume root. They must not be able to delete or replace Program Files.
    $mask = if ($Volume) { 0x500D0140 } else { 0x500D0156 }
    foreach ($rule in $descriptor.DiscretionaryAcl) {
        if ($rule -isnot [Security.AccessControl.CommonAce] -or $rule.IsCallback -or
            [string]$rule.AceType -notin @('AccessAllowed','AccessDenied')) { throw 'anchor_acl' }
        if ([string]$rule.AceType -eq 'AccessAllowed' -and
            -not ([int]$rule.AceFlags -band [int][Security.AccessControl.AceFlags]::InheritOnly) -and
            $rule.SecurityIdentifier.Value -notin @($systemSid,$administratorsSid,$installerSid) -and
            ($rule.AccessMask -band $mask)) { throw 'anchor_acl' }
    }
}

function New-SealedAcl([bool]$Directory, [bool]$Private = $false, [string]$ReaderSid = $usersSid) {
    $acl = if ($Directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($administratorsSid))
    $acl.SetAccessRuleProtection($true,$false)
    $entries = @(@($administratorsSid,'FullControl'), @($systemSid,'FullControl'))
    if ($Private) { $entries += ,@('S-1-3-4','ReadPermissions') }
    else { $entries += ,@($ReaderSid,'ReadAndExecute') }
    $inherit = if ($Private -and $Directory) { 'ContainerInherit,ObjectInherit' } else { 'None' }
    foreach ($entry in $entries) {
        # OWNER RIGHTS removes implicit WRITE_DAC from later files owned by the
        # account SID rather than the enabled Administrators group.
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new($entry[0]), $entry[1], $inherit, 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    return $acl
}

function Assert-SealedAcl([string]$Path, [bool]$Directory, [bool]$Private = $false, [string]$ReaderSid = $usersSid) {
    Assert-PathType $Path $Directory
    $acl = if ($Directory) { [IO.Directory]::GetAccessControl($Path) } else { [IO.File]::GetAccessControl($Path) }
    $actual = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(),0)
    $baseline = New-SealedAcl $Directory $Private $ReaderSid
    $expected = [Security.AccessControl.RawSecurityDescriptor]::new($baseline.GetSecurityDescriptorBinaryForm(),0)
    if (-not $acl.AreAccessRulesProtected -or -not $expected.Owner.Equals($actual.Owner) -or
        $null -eq $actual.DiscretionaryAcl -or $actual.DiscretionaryAcl.Count -ne $expected.DiscretionaryAcl.Count) { throw 'sealed_acl' }
    foreach ($rule in $expected.DiscretionaryAcl) {
        $matches = @($actual.DiscretionaryAcl | Where-Object { $_.Equals($rule) })
        if ($matches.Count -ne 1) { throw 'sealed_acl' }
    }
}

function Assert-InheritedPrivateAcl([string]$Path, [bool]$Directory) {
    Assert-PathType $Path $Directory
    $acl = if ($Directory) { [IO.Directory]::GetAccessControl($Path) } else { [IO.File]::GetAccessControl($Path) }
    $actual = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(),0)
    $baseline = New-SealedAcl $Directory $true
    $expected = [Security.AccessControl.RawSecurityDescriptor]::new($baseline.GetSecurityDescriptorBinaryForm(),0)
    if ($acl.AreAccessRulesProtected -or -not $expected.Owner.Equals($actual.Owner) -or
        $null -eq $actual.DiscretionaryAcl -or $actual.DiscretionaryAcl.Count -ne $expected.DiscretionaryAcl.Count) { throw 'sealed_acl' }
    foreach ($rule in $expected.DiscretionaryAcl) {
        $flags = [int]$rule.AceFlags -bor [int][Security.AccessControl.AceFlags]::Inherited
        $matches = 0
        foreach ($ace in $actual.DiscretionaryAcl) {
            if ($ace -is [Security.AccessControl.CommonAce] -and -not $ace.IsCallback -and
                $ace.AceType -eq $rule.AceType -and $ace.SecurityIdentifier.Value -ceq $rule.SecurityIdentifier.Value -and
                $ace.AccessMask -eq $rule.AccessMask -and [int]$ace.AceFlags -eq $flags) { $matches++ }
        }
        if ($matches -ne 1) { throw 'sealed_acl' }
    }
}

function Ensure-SealedDirectory([string]$Path, [bool]$Private = $false, [string]$ReaderSid = $usersSid) {
    if (-not [IO.Directory]::Exists($Path)) {
        $null = [IO.Directory]::CreateDirectory($Path, (New-SealedAcl $true $Private $ReaderSid))
    }
    Assert-SealedAcl $Path $true $Private $ReaderSid
}

function Open-SealedNewFile([string]$Path, [bool]$Private = $false, [string]$ReaderSid = $usersSid,
    [IO.FileShare]$Share = [IO.FileShare]::None) {
    return [IO.FileStream]::new($Path, [IO.FileMode]::CreateNew, [Security.AccessControl.FileSystemRights]::Write,
        $Share, 65536, [IO.FileOptions]::SequentialScan, (New-SealedAcl $false $Private $ReaderSid))
}

function Open-LocalProbeReceipt([string]$BundleRoot, [string]$Id, [string]$BundleDigest, [string]$ReceiptAction = 'ProbeLocal') {
    if ($Id -cnotmatch '\A[0-9a-f]{32}\z' -or $BundleDigest -cnotmatch '\A[0-9a-f]{64}\z') { throw 'receipt_input' }
    if ($ReceiptAction -cnotmatch '\A(?:InstallBrowserOwner|ProbeLocal|BindHosted|VerifyHosted|RunHostedWindow)\z') { throw 'receipt_input' }
    $prefix = $BundleRoot + '.receipt-' + $Id
    $stream = Open-SealedNewFile ($prefix + '.started.json') $true
    try {
        $body = '{{"receiptId":"{0}","bundleSha256":"{1}","state":"started","pid":{2},"action":"{3}"}}' -f $Id,$BundleDigest,$PID,$ReceiptAction
        $bytes = [Text.Encoding]::UTF8.GetBytes($body)
        $stream.Write($bytes,0,$bytes.Length)
        $stream.Flush($true)
    } finally { $stream.Dispose() }
    return $prefix
}

function Publish-LocalProbeReceipt([string]$Prefix, [string]$Id, [string]$BundleDigest, [string]$Result) {
    $pending = $Prefix + '.result.pending'
    $complete = $Prefix + '.result.json'
    $stream = Open-SealedNewFile $pending $true
    try {
        $body = '{{"receiptId":"{0}","bundleSha256":"{1}","result":{2}}}' -f $Id,$BundleDigest,$Result
        $bytes = [Text.Encoding]::UTF8.GetBytes($body)
        $stream.Write($bytes,0,$bytes.Length)
        $stream.Flush($true)
    } finally { $stream.Dispose() }
    [IO.File]::Move($pending,$complete)
}

function New-AdministratorInstallResult([string]$Result,[bool]$Attempted,[bool]$Committed,
    [bool]$Authorized,[bool]$Succeeded) {
    $changed = if ($Committed) { 'true' } elseif ($Attempted) { 'null' } else { 'false' }
    return $Result.Replace('"registrationChanged":false',('"registrationChanged":' + $changed)).TrimEnd('}') +
        ',"browserEnrollmentCommitted":' + $changed + ',"hostedOwnerAuthorized":' + $Authorized.ToString().ToLowerInvariant() +
        ',"readyToConnect":' + ($Succeeded -and $Committed).ToString().ToLowerInvariant() + '}'
}

function Publish-AdministratorInstallReceipts([string]$Prefix,[string]$Root,[string]$Id,[string]$Digest,
    [string]$StagerDigest,[string]$Sid,[string]$Result) {
    $privateRecorded = $false
    $publicReceipt = $null
    try {
        Publish-LocalProbeReceipt $Prefix $Id $Digest $Result
        $privateRecorded = $true
        $publicReceipt = Open-SealedNewFile ($Root + '.install-' + $Id + '.json') $false $Sid
        $body = '{{"version":1,"operationId":"{0}","bundleSha256":"{1}","stagerSha256":"{2}","result":{3}}}' -f
            $Id,$Digest,$StagerDigest,$Result
        $bytes = [Text.Encoding]::UTF8.GetBytes($body)
        $publicReceipt.Write($bytes,0,$bytes.Length)
        $publicReceipt.Flush($true)
        return $null
    } catch {
        $known = ConvertFrom-Json -InputObject $Result
        return [ordered]@{ok=$false;phase='installation_receipt_projection';operationId=$Id;
            outcome=$(if ($privateRecorded) {'private-recorded-public-unconfirmed'} else {'terminal-receipt-unconfirmed'});
            registrationChanged=$known.registrationChanged;browserEnrollmentCommitted=$known.browserEnrollmentCommitted;
            automaticallyRetried=$false;tunnelStarted=$false;activated=$false}
    } finally {
        if ($publicReceipt) { try { $publicReceipt.Dispose() } catch { } }
    }
}

function Assert-AdministratorIdentity([string]$ExpectedSid) {
    $thread = [Security.Principal.WindowsIdentity]::GetCurrent($true)
    if ($thread) { $thread.Dispose(); throw 'identity' }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        if ($identity.User.Value -cnotmatch '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z' -or
            ($ExpectedSid -and $identity.User.Value -cne $ExpectedSid) -or
            -not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole(
                [Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'identity' }
    } finally { $identity.Dispose() }
}

function Assert-AdministratorBrowserIdentity([string]$ExpectedSid) {
    Assert-AdministratorIdentity $ExpectedSid
    $process = [Diagnostics.Process]::GetCurrentProcess()
    try { if ($process.SessionId -eq 0) { throw 'browser_session' } }
    finally { $process.Dispose() }
    $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
    $groups = @(& ([IO.Path]::Combine($system,'whoami.exe')) /groups /fo csv /nh)
    if ($LASTEXITCODE -ne 0 -or @($groups -match ',"S-1-16-12288",').Count -ne 1) { throw 'browser_integrity' }
}

function Get-AdministratorStateLayout([string]$BundleSha256, [string]$Sid) {
    $lf = [string][char]10
    $imports = @'
import { isBuiltin, registerHooks } from 'node:module';
import { realpathSync } from 'node:fs';
import { relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const configured = process.env.AC_ADMIN_BOOT_APP_ROOT;
const root = realpathSync.native(configured);
if (root !== configured) throw new Error('administrator_app_root_redirected');
delete process.env.AC_ADMIN_BOOT_APP_ROOT;
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    if (result.url.startsWith('node:') && isBuiltin(result.url)) return result;
    const url = new URL(result.url);
    if (url.protocol !== 'file:' || url.search || url.hash) throw new Error('administrator_module_outside_bundle');
    const target = fileURLToPath(url);
    const name = relative(root, realpathSync.native(target));
    if (!name || name === '..' || name.startsWith('..' + sep) || isAbsolute(name)) {
      throw new Error('administrator_module_outside_bundle');
    }
    return result;
  },
});
'@
    return @{
        directories = @('home','home/.claude-server-commander','home/AppData','home/AppData/Local','home/AppData/Roaming','temp','work')
        files = [ordered]@{
            'home/.claude-server-commander/config.json' = '{"telemetryEnabled":false,"allowedDirectories":[],"blockedCommands":[],"welcomeOnboardingEligible":false,"pendingWelcomeOnboarding":false,"fileReadLineLimit":1000,"fileWriteLineLimit":50}' + $lf
            'consent.json' = '{"format":"agent-continue-native-consent","version":1,"provider":"@wonderwhy-er/desktop-commander","providerVersion":"0.3.1","scope":"full-account","protectedInstallationVerified":false,"activated":false}' + $lf
            'lifecycle.json' = '{"format":"agent-continue-lifecycle","version":1,"paused":true}' + $lf
            'startup-imports.mjs' = $imports.Replace("`r`n","`n") + $lf
            'administrator.json' = ('{{"format":"agent-continue-administrator-state","version":1,"bundleSha256":"{0}","userSid":"{1}","scope":"full-account","initiallyPaused":true}}' -f $BundleSha256,$Sid) + $lf
        }
    }
}

function Write-AdministratorState([string]$StateRoot, $StateLayout) {
    if ([IO.Directory]::Exists($StateRoot) -or [IO.File]::Exists($StateRoot)) { throw 'state_exists' }
    Ensure-SealedDirectory $StateRoot $true
    foreach ($name in $StateLayout.directories) {
        Ensure-SealedDirectory ([IO.Path]::Combine($StateRoot,$name.Replace('/','\'))) $true
    }
    foreach ($name in $StateLayout.files.Keys) {
        $output = Open-SealedNewFile ([IO.Path]::Combine($StateRoot,$name.Replace('/','\'))) $true
        try {
            $bytes = [Text.Encoding]::UTF8.GetBytes($StateLayout.files[$name])
            $output.Write($bytes,0,$bytes.Length)
            $output.Flush($true)
        } finally { $output.Dispose() }
    }
}

function Assert-FreshAdministratorState([string]$StateRoot, $StateLayout, $PriorReadOnly = $null, $PriorUnused = $null) {
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push($StateRoot)
    $runtimeDirectories = @('home/AppData/Local/Microsoft','home/AppData/Local/Microsoft/Windows',
        'home/AppData/Local/Microsoft/Windows/PowerShell')
    $runtimeFiles = @('native-tunnel.log','home/.claude-server-commander/claude_tool_call.log',
        'home/.claude-server-commander/tool-history.jsonl',
        'home/AppData/Local/Microsoft/Windows/PowerShell/StartupProfileData-NonInteractive')
    $directories = $count = 0
    while ($pending.Count) {
        $dir = $pending.Pop()
        $relativeDir = if ($dir -ceq $StateRoot) { '' } else { $dir.Substring($StateRoot.Length + 1).Replace('\','/') }
        if ($PriorReadOnly -and $runtimeDirectories -ccontains $relativeDir) { Assert-InheritedPrivateAcl $dir $true }
        else { Assert-SealedAcl $dir $true $true }
        foreach ($member in [IO.Directory]::EnumerateFileSystemEntries($dir)) {
            $name = $member.Substring($StateRoot.Length + 1).Replace('\','/')
            if ($StateLayout.directories -ccontains $name) {
                $pending.Push($member)
                $directories++
            } elseif ($StateLayout.files.Keys -ccontains $name) {
                if ($PriorReadOnly -and $name -ceq 'home/.claude-server-commander/config.json') {
                    Assert-InheritedPrivateAcl $member $false
                    Assert-ReadOnlyProviderConfig $member $StateLayout.files[$name]
                    $count++
                    continue
                }
                if ($PriorReadOnly -and $name -ceq 'lifecycle.json') { Assert-InheritedPrivateAcl $member $false }
                else { Assert-SealedAcl $member $false $true }
                $expected = [Text.Encoding]::UTF8.GetBytes($StateLayout.files[$name])
                if ([IO.FileInfo]::new($member).Length -ne $expected.Length -or
                    [Convert]::ToBase64String([IO.File]::ReadAllBytes($member)) -cne [Convert]::ToBase64String($expected)) { throw 'state_content' }
                $count++
            } elseif (($PriorReadOnly -and $PriorReadOnly.sealedFiles -ccontains $name) -or
                ($PriorUnused -and $PriorUnused.sealedFiles -ccontains $name)) {
                Assert-SealedAcl $member $false $true
            } elseif ($PriorReadOnly -and $runtimeDirectories -ccontains $name) {
                $pending.Push($member)
            } elseif ($PriorReadOnly -and ($runtimeFiles -ccontains $name -or
                $name -cmatch '\Ahealth\.[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.url\z')) {
                Assert-InheritedPrivateAcl $member $false
            } elseif (($PriorReadOnly -and $name -ceq $PriorReadOnly.receiptDirectory) -or
                ($PriorUnused -and $name -ceq $PriorUnused.receiptDirectory)) {
                Assert-InheritedPrivateAcl $member $true
                $expectedReceipts = if ($PriorUnused -and $name -ceq $PriorUnused.receiptDirectory) {
                    @()
                } else { $PriorReadOnly.expectedReceipts }
                foreach ($receipt in [IO.Directory]::EnumerateFileSystemEntries($member)) {
                    Assert-InheritedPrivateAcl $receipt $false
                    if ($expectedReceipts -cnotcontains [IO.Path]::GetFileName($receipt) -or
                        [IO.FileInfo]::new($receipt).Length -ne 0) { throw 'state_closure' }
                }
            } else { throw 'state_closure' }
        }
    }
    if ($directories -ne $StateLayout.directories.Count -or $count -ne $StateLayout.files.Count) { throw 'state_closure' }
}

function New-AdministratorLaunchPlan([string]$BundleRoot, [string]$StateRoot, [switch]$OwnerEntry, [string]$ConnectCheckSid = '') {
    $windows = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
    $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
    $runtime = [IO.Path]::Combine($BundleRoot,'runtime')
    $app = [IO.Path]::Combine($BundleRoot,'app')
    $profileHome = [IO.Path]::Combine($StateRoot,'home')
    $temp = [IO.Path]::Combine($StateRoot,'temp')
    $loader = [IO.Path]::Combine($StateRoot,'startup-imports.mjs')
    if ($ConnectCheckSid -and ($OwnerEntry -or $ConnectCheckSid -cnotmatch '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z')) {
        throw 'owner_connect_identity'
    }
    $entryName = if ($OwnerEntry) { 'windows-admin-owner.mjs' } elseif ($ConnectCheckSid) { 'windows-admin-intent.mjs' } else { 'host.mjs' }
    $hostFile = [IO.Path]::Combine($app,$entryName)
    foreach ($value in @($BundleRoot,$StateRoot,$loader,$hostFile)) {
        if ($value -notmatch '\A[A-Z]:\\[^\\]' -or $value.Substring(2) -match '[\x00-\x1f<>:"|?*/]' -or
            $value -ine [IO.Path]::GetFullPath($value)) { throw 'launch_path' }
    }
    $launch = [Diagnostics.ProcessStartInfo]::new([IO.Path]::Combine($runtime,'node.exe'))
    $launch.Arguments = '--no-global-search-paths --import "' + ([Uri]::new($loader)).AbsoluteUri + '" "' + $hostFile + '"'
    if ($ConnectCheckSid) { $launch.Arguments += ' ' + $ConnectCheckSid }
    elseif (-not $OwnerEntry) { $launch.Arguments += ' --state-dir "' + $StateRoot + '"' }
    $launch.WorkingDirectory = [IO.Path]::Combine($StateRoot,'work')
    $launch.UseShellExecute = $false
    $launch.CreateNoWindow = $true
    $launch.EnvironmentVariables.Clear()
    $clean = @{
        SystemRoot=$windows; WINDIR=$windows; ComSpec=[IO.Path]::Combine($system,'cmd.exe')
        PATH=($system + ';' + [IO.Path]::Combine($system,'WindowsPowerShell\v1.0') + ';' + $runtime)
        PATHEXT='.COM;.EXE;.BAT;.CMD'; USERPROFILE=$profileHome; HOME=$profileHome
        APPDATA=[IO.Path]::Combine($profileHome,'AppData\Roaming'); LOCALAPPDATA=[IO.Path]::Combine($profileHome,'AppData\Local')
        TEMP=$temp; TMP=$temp; AC_ADMIN_BOOT_APP_ROOT=$app
    }
    foreach ($key in $clean.Keys) { $launch.EnvironmentVariables.Add($key,$clean[$key]) }
    return $launch
}

function Get-AdministratorRuntimeKeyBytes([Security.SecureString]$Secret) {
    if ($null -eq $Secret -or $Secret.Length -lt 20 -or $Secret.Length -gt 4096) { throw 'binding_key_format' }
    $bytes = [byte[]]::new($Secret.Length)
    $buffer = [IntPtr]::Zero
    $valid = $false
    try {
        $buffer = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($Secret)
        for ($i=0; $i -lt $bytes.Length; $i++) {
            $c = [Runtime.InteropServices.Marshal]::ReadInt16($buffer,2*$i)
            if ($c -lt 33 -or $c -gt 126) { throw 'binding_key_format' }
            $bytes[$i] = $c
        }
        if ($bytes[0] -ne 115 -or $bytes[1] -ne 107 -or $bytes[2] -ne 45) { throw 'binding_key_format' }
        $valid = $true
        return ,$bytes
    } finally {
        if ($buffer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($buffer) }
        if (-not $valid) { [Array]::Clear($bytes,0,$bytes.Length) }
    }
}

function Read-AdministratorRuntimeKeyFile([string]$File) {
    if ($File -notmatch '\A[A-Z]:\\[^\\]' -or $File.Substring(2) -match '[\x00-\x1f<>:"|?*/]' -or
        $File -ine [IO.Path]::GetFullPath($File)) { throw 'binding_key_path' }
    $disk = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($File))
    if ($disk.DriveType -ne 'Fixed') { throw 'binding_key_path' }
    for ($parent = [IO.Path]::GetDirectoryName($File); $parent; $parent = [IO.Path]::GetDirectoryName($parent)) {
        Assert-PathType $parent $true
    }
    Assert-PathType $File $false
    $stream = [IO.File]::Open($File,'Open','Read','Read')
    $buffer = $secret = $null
    $complete = $false
    try {
        if ($stream.Length -lt 20 -or $stream.Length -gt 4101) { throw 'binding_key_format' }
        $buffer = [byte[]]::new([int]$stream.Length)
        $count = 0
        while ($count -lt $buffer.Length) {
            $read = $stream.Read($buffer,$count,$buffer.Length-$count)
            if (-not $read) { throw 'binding_key_format' }
            $count += $read
        }
        if ($stream.ReadByte() -ne -1) { throw 'binding_key_format' }
        $start = if ($buffer[0] -eq 239 -and $buffer[1] -eq 187 -and $buffer[2] -eq 191) { 3 } else { 0 }
        if ($buffer[$count-1] -eq 10) {
            $count--
            if ($buffer[$count-1] -eq 13) { $count-- }
        }
        if ($count-$start -lt 20 -or $count-$start -gt 4096 -or $buffer[$start] -ne 115 -or
            $buffer[$start+1] -ne 107 -or $buffer[$start+2] -ne 45) { throw 'binding_key_format' }
        $secret = [Security.SecureString]::new()
        for ($i=$start; $i -lt $count; $i++) {
            if ($buffer[$i] -lt 33 -or $buffer[$i] -gt 126) { throw 'binding_key_format' }
            $secret.AppendChar([char]$buffer[$i])
        }
        $secret.MakeReadOnly()
        $complete = $true
        return $secret
    } finally {
        if ($buffer) { [Array]::Clear($buffer,0,$buffer.Length) }
        if ($secret -and -not $complete) { $secret.Dispose() }
        $stream.Dispose()
    }
}

function New-AdministratorHostedDocument([string]$BundleRoot, [string]$StateRoot, [string]$TunnelId, [switch]$Owner) {
    if ($TunnelId -cnotmatch '\Atunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}\z' -or
        $StateRoot -cne ($BundleRoot + '.state')) { throw 'binding_target' }
    $launch = New-AdministratorLaunchPlan $BundleRoot $StateRoot
    $key = [IO.Path]::Combine($BundleRoot + '.secrets','runtime.key')
    $command = '"' + $launch.FileName.Replace('\','/') + '" ' + $launch.Arguments.Replace('\','/')
    if ($Owner) { $command += ' --administrator-owner' }
    return [ordered]@{
        config_version=1
        control_plane=[ordered]@{base_url='https://api.openai.com';tunnel_id=$TunnelId;api_key='file:' + $key}
        health=[ordered]@{listen_addr='127.0.0.1:0';url_file=[IO.Path]::Combine($StateRoot,'health.url')}
        admin_ui=[ordered]@{open_browser=$false}
        log=[ordered]@{level='warn';format='json';file=[IO.Path]::Combine($StateRoot,'native-tunnel.log');http_raw_unsafe=$false}
        mcp=[ordered]@{commands=@([ordered]@{channel='main';command=$command});stdio_failure_policy='exit'}
    }
}

function Assert-AdministratorHostedVault([string]$Vault, [byte[]]$ProfileBytes, [byte[]]$ReceiptBytes) {
    Assert-SealedAcl $Vault $true $true
    $expected = [ordered]@{'runtime.key'=$null; 'tunnel.yaml'=$ProfileBytes; 'binding.json'=$ReceiptBytes}
    $count = 0
    foreach ($file in [IO.Directory]::EnumerateFileSystemEntries($Vault)) {
        $name = [IO.Path]::GetFileName($file)
        if ($expected.Keys -cnotcontains $name) { throw 'binding_closure' }
        Assert-SealedAcl $file $false $true
        $size = [IO.FileInfo]::new($file).Length
        if ($name -ceq 'runtime.key') {
            if ($size -lt 20 -or $size -gt 4096) { throw 'binding_key_metadata' }
        } elseif ($size -ne $expected[$name].Length -or [Convert]::ToBase64String([IO.File]::ReadAllBytes($file)) -cne
            [Convert]::ToBase64String($expected[$name])) { throw 'binding_readback' }
        $count++
    }
    if ($count -ne $expected.Count) { throw 'binding_closure' }
}

function Get-AdministratorHostedMetadata([string]$BundleRoot, [string]$StateRoot, [string]$Digest,
    [string]$Sid, [string]$TunnelId) {
    $profile = New-AdministratorHostedDocument $BundleRoot $StateRoot $TunnelId
    $profileBytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $profile -Depth 8 -Compress) + [char]10)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $profileHash = To-Hex $sha.ComputeHash($profileBytes) } finally { $sha.Dispose() }
    $receipt = [ordered]@{format='agent-continue-administrator-hosted-binding';version=1;
        bundleSha256=$Digest;userSid=$Sid;profileSha256=$profileHash;activationAuthorized=$false}
    $receiptBytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $receipt -Depth 4 -Compress) + [char]10)
    return @{profile=$profileBytes;receipt=$receiptBytes;profileSha256=$profileHash}
}

function Write-AdministratorOwnerActivation([string]$BundleRoot, [string]$StateRoot, [string]$Digest,
    [string]$Sid, [string]$TunnelId) {
    $entry = [IO.Path]::Combine($BundleRoot,'app','windows-admin-owner.mjs')
    Assert-SealedAcl $entry $false
    Assert-SealedAcl ([IO.Path]::Combine($BundleRoot,'app','windows-owner-job.cs')) $false
    $null = New-AdministratorLaunchPlan $BundleRoot $StateRoot -OwnerEntry
    $vault = $BundleRoot + '.secrets'
    $expected = Get-AdministratorHostedMetadata $BundleRoot $StateRoot $Digest $Sid $TunnelId
    Assert-AdministratorHostedVault $vault $expected.profile $expected.receipt
    $owner = Get-AdministratorOwnerMetadata $BundleRoot $StateRoot $Digest $Sid $TunnelId
    Write-AdministratorOwnerFile ([IO.Path]::Combine($vault,'owner-tunnel.yaml')) $owner.profile
    Write-AdministratorOwnerFile ([IO.Path]::Combine($vault,'owner-control.guard')) ([Text.Encoding]::ASCII.GetBytes([Guid]::NewGuid().ToString('N') + [char]10))
    Write-AdministratorOwnerFile ([IO.Path]::Combine($vault,'owner-activation.json')) $owner.grant
}

function Get-AdministratorOwnerMetadata([string]$BundleRoot, [string]$StateRoot, [string]$Digest,
    [string]$Sid, [string]$TunnelId) {
    $profile = New-AdministratorHostedDocument $BundleRoot $StateRoot $TunnelId -Owner
    $profileBytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $profile -Depth 8 -Compress) + [char]10)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $profileHash = To-Hex $sha.ComputeHash($profileBytes) } finally { $sha.Dispose() }
    $document = [ordered]@{format='agent-continue-windows-admin-activation';version=1;
        bundleSha256=$Digest;userSid=$Sid;profileSha256=$profileHash;scope='full-account'}
    $bytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $document -Compress) + [char]10)
    return @{profile=$profileBytes;grant=$bytes}
}

function Assert-AdministratorOwnerBytes([string]$File,[byte[]]$Bytes) {
    Assert-SealedAcl $File $false $true
    if ([IO.FileInfo]::new($File).Length -ne $Bytes.Length -or
        [Convert]::ToBase64String([IO.File]::ReadAllBytes($File)) -cne [Convert]::ToBase64String($Bytes)) {
        throw 'owner_metadata_readback'
    }
}

function Write-AdministratorOwnerFile([string]$File,[byte[]]$Bytes) {
    $stream = Open-SealedNewFile $file $true
    try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    Assert-AdministratorOwnerBytes $File $Bytes
}

function Test-AdministratorOwnerAbsent([string]$File) {
    try { $null = [IO.File]::GetAttributes($File); return $false }
    catch {
        $cause = $_.Exception.GetBaseException()
        return ($cause -is [IO.FileNotFoundException] -or $cause -is [IO.DirectoryNotFoundException])
    }
}

function Test-AdministratorOwnerIntent([string]$Root,[bool]$Paused) {
    $stream = $null
    try {
        $file = [IO.Path]::Combine($Root,'lifecycle.json')
        Assert-PathType $file $false
        $literal = if ($Paused) { 'true' } else { 'false' }
        $expected = ('{{"format":"agent-continue-lifecycle","version":1,"paused":{0}}}' -f $literal) + [char]10
        $stream = [IO.File]::Open($file,'Open','Read',([IO.FileShare]::Read -bor [IO.FileShare]::Delete))
        if ($stream.Length -ne $expected.Length) { return $false }
        foreach ($character in $expected.ToCharArray()) {
            if ($stream.ReadByte() -ne [int]$character) { return $false }
        }
        return ($stream.ReadByte() -eq -1)
    } catch { return $false }
    finally { if ($stream) { $stream.Dispose() } }
}

function Test-AdministratorOwnerRunIntent([string]$Root,[string]$Vault) {
    return (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($Vault,'owner-revoked'))) -and
        (Test-AdministratorOwnerIntent $Root $false)
}

function Test-AdministratorOwnerInnerLeasesClear([string]$Root) {
    return (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($Root,'controller.lease'))) -and
        (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($Root,'device-operations.lease')))
}

function Open-AdministratorOwnerControl([string]$Vault) {
    Assert-SealedAcl $Vault $true $true
    $file = [IO.Path]::Combine($Vault,'owner-control.guard')
    $watch = [Diagnostics.Stopwatch]::StartNew()
    do {
        try {
            Assert-SealedAcl $file $false $true
            return [IO.File]::Open($file,'Open','ReadWrite','None')
        } catch {
            $cause = $_.Exception.GetBaseException()
            if ($cause -isnot [IO.IOException] -or ($cause.HResult -band 65535) -notin @(32,33)) { throw }
            if ($watch.ElapsedMilliseconds -ge 6000) { throw 'owner_control_busy' }
            [Threading.Thread]::Sleep(25)
        }
    } while ($true)
}

function Read-AdministratorOwnerControlRevision([IO.FileStream]$Gate) {
    $buffer = [byte[]]::new(33)
    $Gate.Position = 0
    $count = 0
    while ($count -lt $buffer.Length) {
        $read = $Gate.Read($buffer,$count,$buffer.Length-$count)
        if ($read -le 0) { throw 'owner_control_revision' }
        $count += $read
    }
    if ($Gate.ReadByte() -ne -1) { throw 'owner_control_revision' }
    $value = [Text.Encoding]::ASCII.GetString($buffer)
    if ($value -cnotmatch '\A[0-9a-f]{32}\n\z') { throw 'owner_control_revision' }
    return $value.Substring(0,32)
}

function Write-AdministratorOwnerControlRevision([IO.FileStream]$Gate,[string]$Revision = [Guid]::NewGuid().ToString('N')) {
    if ($Revision -cnotmatch '\A[a-f0-9]{32}\z') { throw 'owner_control_revision' }
    $bytes = [Text.Encoding]::ASCII.GetBytes($Revision + [char]10)
    $Gate.Position = 0
    $Gate.Write($bytes,0,$bytes.Length)
    $Gate.SetLength($bytes.Length)
    $Gate.Flush($true)
    if ((Read-AdministratorOwnerControlRevision $Gate) -cne $Revision) {
        throw 'owner_control_readback'
    }
}

function Write-AdministratorOwnerIntent([string]$Root,[bool]$Paused) {
    $file = [IO.Path]::Combine($Root,'lifecycle.json')
    $literal = if ($Paused) { 'true' } else { 'false' }
    $bytes = [Text.Encoding]::ASCII.GetBytes(('{{"format":"agent-continue-lifecycle","version":1,"paused":{0}}}' -f $literal) + [char]10)
    Assert-SealedAcl $file $false $true
    if ([IO.FileInfo]::new($file).Length -eq $bytes.Length -and
        [Convert]::ToBase64String([IO.File]::ReadAllBytes($file)) -ceq [Convert]::ToBase64String($bytes)) { return }
    $next = [IO.Path]::Combine($Root,('.owner-intent-' + [Guid]::NewGuid().ToString('N') + '.tmp'))
    Write-AdministratorOwnerFile $next $bytes
    try {
        $watch = [Diagnostics.Stopwatch]::StartNew()
        while ($true) {
            try { [IO.File]::Replace($next,$file,[NullString]::Value); break }
            catch {
                $cause = $_.Exception.GetBaseException()
                if ($cause -isnot [IO.IOException] -or ($cause.HResult -band 65535) -notin @(32,33) -or
                    $watch.ElapsedMilliseconds -ge 500) { throw }
                [Threading.Thread]::Sleep(25)
            }
        }
        Assert-AdministratorOwnerBytes $file $bytes
    } finally {
        if ([IO.File]::Exists($next)) { Assert-SealedAcl $next $false $true; [IO.File]::Delete($next) }
    }
}

function Invoke-AdministratorOwnerConnectCheck([Diagnostics.ProcessStartInfo]$Plan) {
    $Plan.RedirectStandardOutput = $true
    $Plan.RedirectStandardError = $true
    $child = [Diagnostics.Process]::Start($Plan)
    try {
        $answer = $child.StandardOutput.ReadToEndAsync()
        $discard = $child.StandardError.ReadToEndAsync()
        if (-not $child.WaitForExit(4500)) { throw 'owner_connect_check_timeout' }
        if ($child.ExitCode -ne 0 -or -not $answer.Wait(250) -or $answer.Result -cne ('connect-eligible' + [char]10)) {
            throw 'owner_connect_not_eligible'
        }
    } finally {
        if (-not $child.HasExited) { $child.Kill(); $null = $child.WaitForExit(1000) }
        $child.Dispose()
    }
}

function Request-AdministratorOwnerConnect($Task,[Diagnostics.ProcessStartInfo]$Check,
    [string]$Root,[string]$Vault,[string]$ExpectedControlRevision,[string]$Digest = '',[string]$Sid = '') {
    $gate = Open-AdministratorOwnerControl $Vault
    try {
        if ((Read-AdministratorOwnerControlRevision $gate) -cne $ExpectedControlRevision) {
            throw 'owner_connect_superseded'
        }
        if (-not (Test-AdministratorOwnerIntent $Root $true)) { throw 'owner_connect_not_paused' }
        Invoke-AdministratorOwnerConnectCheck $Check
        if (-not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($Vault,'owner-revoked'))) -or
            -not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($Vault,'owner-job.lease'))) -or
            -not (Test-AdministratorOwnerInnerLeasesClear $Root)) { throw 'owner_connect_not_eligible' }
        try {
            Write-AdministratorOwnerControlRevision $gate
            Write-AdministratorOwnerIntent $Root $false
            if ($Digest -and $Sid) { Update-AdministratorBrowserPauseTarget $Root $Vault $Digest $Sid $gate }
        }
        catch {
            return [ordered]@{ok=$false;runningIntentSaved=$null;launchRequest='not-requested';tunnelReady='unobserved'}
        }
    } finally { $gate.Dispose() }
    # The demand task rechecks Pause and Revoke; a Scheduler RPC must not hold the control lock.
    try {
        $request = $Task.Run($null)
        $launchRequest = if ($request) { 'requested' } else { 'unconfirmed' }
    } catch { $launchRequest = 'unconfirmed' }
    return [ordered]@{ok=($launchRequest -eq 'requested');runningIntentSaved=$true;
        launchRequest=$launchRequest;tunnelReady='unobserved'}
}

function New-AdministratorBrowserEnrollmentPlan([string]$Root,[string]$Digest,[string]$Sid,
    [string]$TunnelId,[string]$ExtensionId,[string]$System) {
    if ($Digest -cnotmatch '\A[a-f0-9]{64}\z' -or $ExtensionId -cnotmatch '\A[a-p]{32}\z' -or
        $Sid -cnotmatch '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z' -or
        $TunnelId -cnotmatch '\Atunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}\z' -or
        $System -notmatch '\A[A-Z]:\\Windows\\System32\z' -or
        $Root -notmatch '\A[A-Z]:\\[ -~]+\z' -or $Root.Substring(2) -match '[%!^&|<>():*?"]' -or
        $Root -cne [IO.Path]::GetFullPath($Root) -or
        [IO.Path]::GetFileName($Root) -cne $Digest.Substring(0,24)) { throw 'browser_enrollment_input' }
    $bridge = $Root + '.browser'
    $stager = [IO.Path]::Combine($bridge,'stager.ps1')
    $archive = [IO.Path]::Combine($bridge,'bundle.zip')
    $launcher = [IO.Path]::Combine($bridge,'wake.cmd')
    $manifest = [IO.Path]::Combine($bridge,'host.json')
    $origin = 'chrome-extension://' + $ExtensionId + '/'
    $node = [IO.Path]::Combine($Root,'runtime','node.exe')
    $entry = [IO.Path]::Combine($Root,'app','windows-admin-browser-host.mjs')
    $hostName = 'com.agentcontinue.administrator_owner'
    $crlf = [string][char]13 + [char]10
    $cmd = @('@echo off','setlocal DisableDelayedExpansion')
    foreach ($name in @('NODE_OPTIONS','NODE_PATH','NODE_CHANNEL_FD','NODE_CHANNEL_SERIALIZATION_MODE',
        'NODE_V8_COVERAGE','NODE_EXTRA_CA_CERTS','NODE_COMPILE_CACHE','NODE_ICU_DATA','NODE_REDIRECT_WARNINGS',
        'NODE_REPL_EXTERNAL_MODULE','NODE_PRESERVE_SYMLINKS','NODE_INSPECT_RESUME_ON_START',
        'OPENSSL_CONF','OPENSSL_MODULES','SSLKEYLOGFILE','CONTROL_PLANE_API_KEY',
        'CONTROL_PLANE_TUNNEL_ID','AGENT_CONTINUE_TUNNEL_CLIENT')) { $cmd += 'set "' + $name + '="' }
    $demand = $cmd + @(
        ('set "PATH={0}"' -f $System),('set "WINDIR={0}"' -f [IO.Path]::GetDirectoryName($System)),
        ('set "SystemRoot={0}"' -f [IO.Path]::GetDirectoryName($System)),
        ('set "ComSpec={0}"' -f [IO.Path]::Combine($System,'cmd.exe')),
        ('set "TEMP={0}"' -f [IO.Path]::Combine($Root + '.state','temp')),
        ('set "TMP={0}"' -f [IO.Path]::Combine($Root + '.state','temp')),
        'set "__COMPAT_LAYER="','set "NODE_DISABLE_COMPILE_CACHE=1"',
        ('"{0}" "{1}"' -f $node,[IO.Path]::Combine($Root,'app','windows-admin-demand.mjs'))
    )
    $cmd += ('"{0}" "{1}" "%~1"' -f $node,$entry)
    $json = @{
        'wake.cmd' = [Text.Encoding]::ASCII.GetBytes(($cmd -join $crlf) + $crlf)
        'host.json' = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -Compress -InputObject ([ordered]@{
            name=$hostName; description='AgentContinue Windows administrator owner'; path=$launcher
            type='stdio'; allowed_origins=@($origin)
        })) + [char]10)
        'binding.json' = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -Compress -InputObject ([ordered]@{
            version=1; origin=$origin; bundleSha256=$Digest; systemDirectory=$System
        })) + [char]10)
    }
    $demandBytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -Compress -InputObject ([ordered]@{
        version=1; bundleSha256=$Digest; userSid=$Sid; tunnelId=$TunnelId; systemDirectory=$System
    })) + [char]10)
    $demandScript = [IO.Path]::Combine($bridge,'demand.cmd')
    return [pscustomobject]@{
        Bridge=$bridge; Stager=$stager; Archive=$archive; Manifest=$manifest; Files=$json; Sid=$Sid
        DemandScript=$demandScript; DemandBytes=[Text.Encoding]::ASCII.GetBytes(($demand -join $crlf) + $crlf)
        DemandBinding=[IO.Path]::Combine($bridge,'demand.json'); DemandBindingBytes=$demandBytes
        Folder='AgentContinue'; Name=('AdministratorOwner-' + $Digest.Substring(0,24))
        Program=[IO.Path]::Combine($System,'cmd.exe')
        System=$System; Arguments=('/D /S /C ""{0}""' -f $demandScript)
        Sddl=('O:BAG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FRFX;;;{0})' -f $Sid)
        Registry=('Software\Google\Chrome\NativeMessagingHosts\' + $hostName)
    }
}

function New-AdministratorBrowserTaskDefinition($Scheduler,$Plan) {
    $task = $Scheduler.NewTask(0)
    $task.Principal.UserId = $Plan.Sid
    $task.Principal.LogonType = 3 # InteractiveToken
    $task.Principal.RunLevel = 1 # HighestAvailable
    $s = $task.Settings
    $s.Enabled = $false
    $s.AllowDemandStart = $true
    $s.StartWhenAvailable = $false
    $s.RunOnlyIfIdle = $false
    $s.RunOnlyIfNetworkAvailable = $false
    $s.DisallowStartIfOnBatteries = $false
    $s.StopIfGoingOnBatteries = $false
    $s.WakeToRun = $false
    $s.MultipleInstances = 1 # Queue: retain one new browser session's request while the previous root settles.
    $s.ExecutionTimeLimit = 'PT0S'
    $s.RestartCount = 0
    $action = $task.Actions.Create(0) # Exec
    $action.Path = $Plan.Program
    $action.Arguments = $Plan.Arguments
    $action.WorkingDirectory = $Plan.System
    return $task
}

function Assert-AdministratorBrowserTaskAcl([string]$Sddl,[string]$Expected) {
    $actual = [Security.AccessControl.RawSecurityDescriptor]::new($Sddl)
    $template = [Security.AccessControl.RawSecurityDescriptor]::new($Expected)
    if (-not $template.Owner.Equals($actual.Owner) -or
        -not ($actual.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -or
        $null -eq $actual.DiscretionaryAcl -or $actual.DiscretionaryAcl.Count -ne $template.DiscretionaryAcl.Count) {
        throw 'browser_task_acl'
    }
    foreach ($ace in $template.DiscretionaryAcl) {
        if (@($actual.DiscretionaryAcl | Where-Object { $_.Equals($ace) }).Count -ne 1) { throw 'browser_task_acl' }
    }
}

function Assert-AdministratorBrowserTask($Task,$Plan,[bool]$Enabled) {
    $d = $Task.Definition
    $s = $d.Settings
    $p = $d.Principal
    if ($Task.Path -cne ('\' + $Plan.Folder + '\' + $Plan.Name) -or
        [bool]$Task.Enabled -ne $Enabled -or [bool]$s.Enabled -ne $Enabled -or $d.Triggers.Count -ne 0 -or
        $d.Actions.Count -ne 1 -or $p.LogonType -ne 3 -or $p.RunLevel -ne 1 -or
        -not $s.AllowDemandStart -or $s.StartWhenAvailable -or $s.RunOnlyIfIdle -or $s.RunOnlyIfNetworkAvailable -or
        $s.DisallowStartIfOnBatteries -or $s.StopIfGoingOnBatteries -or $s.WakeToRun -or
        $s.MultipleInstances -ne 1 -or $s.RestartCount -ne 0 -or $s.ExecutionTimeLimit -cne 'PT0S') {
        throw 'browser_task_definition'
    }
    $sid = if ($p.UserId -match '\AS-1-') { [Security.Principal.SecurityIdentifier]::new($p.UserId) } else {
        ([Security.Principal.NTAccount]::new($p.UserId)).Translate([Security.Principal.SecurityIdentifier])
    }
    $a = $d.Actions.Item(1)
    if ($sid.Value -cne $Plan.Sid -or $a.Type -ne 0 -or $a.Path -cne $Plan.Program -or
        $a.WorkingDirectory -cne $Plan.System -or $a.Arguments -cne $Plan.Arguments) { throw 'browser_task_action' }
    Assert-AdministratorBrowserTaskAcl ($Task.GetSecurityDescriptor(5)) $Plan.Sddl
}

function Get-AdministratorBrowserRegistryType([string]$CompilerTemp) {
    Assert-SealedAcl $CompilerTemp $true $true
    $source = @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;
public static class AgentContinueAdminBrowserRegistry {
    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes {
        public int Length;
        public IntPtr Descriptor;
        public int InheritHandle;
    }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int RegCreateKeyExW(IntPtr root, string subkey, int reserved, string cls,
        int options, int access, ref SecurityAttributes security, out SafeRegistryHandle key, out int disposition);
    public static void Create64(string path, string manifest, byte[] security) {
        var pinned = GCHandle.Alloc(security, GCHandleType.Pinned);
        try {
            var sa = new SecurityAttributes {
                Length = Marshal.SizeOf(typeof(SecurityAttributes)),
                Descriptor = pinned.AddrOfPinnedObject()
            };
            SafeRegistryHandle handle;
            int disposition;
            // 64-bit view, read control, query and set value.
            int error = RegCreateKeyExW(new IntPtr(unchecked((int)0x80000002)), path, 0, null, 0,
                0x20103, ref sa, out handle, out disposition);
            if (error != 0) throw new InvalidOperationException("browser_registry_create");
            using (handle) {
                if (disposition != 1) throw new InvalidOperationException("browser_registry_collision");
                using (var key = RegistryKey.FromHandle(handle, RegistryView.Registry64)) {
                    key.SetValue("", manifest, RegistryValueKind.String);
                    key.Flush();
                }
            }
        } finally { pinned.Free(); }
    }
}
'@
    $temps = [CodeDom.Compiler.TempFileCollection]::new($CompilerTemp,$false)
    $compiler = [Microsoft.CSharp.CSharpCodeProvider]::new()
    $previous = @($env:TEMP,$env:TMP)
    $previousCwd = [Environment]::CurrentDirectory
    try {
        $env:TEMP = $env:TMP = $CompilerTemp
        [Environment]::CurrentDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
        $parameters = [CodeDom.Compiler.CompilerParameters]::new()
        $parameters.TempFiles = $temps
        $parameters.GenerateInMemory = $true
        $results = $compiler.CompileAssemblyFromSource($parameters,$source)
        if ($results.Errors.HasErrors) { throw 'browser_registry_compile' }
        return $results.CompiledAssembly.GetType('AgentContinueAdminBrowserRegistry',$true)
    } finally {
        $env:TEMP = $previous[0]; $env:TMP = $previous[1]
        [Environment]::CurrentDirectory = $previousCwd
        $compiler.Dispose(); $temps.Dispose()
    }
}

function Assert-AdministratorBrowserRegistry($Plan,[bool]$Published,[switch]$AllowMissing) {
    $matched = $false
    $expected = 'O:BAG:SYD:P(A;;KA;;;SY)(A;;KA;;;BA)(A;;KR;;;' + $Plan.Sid + ')'
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)) {
        foreach ($hive in @([Microsoft.Win32.RegistryHive]::Users,[Microsoft.Win32.RegistryHive]::LocalMachine)) {
            $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
            $account = $entry = $null
            try {
                if ($hive -eq [Microsoft.Win32.RegistryHive]::Users) {
                    $account = $baseKey.OpenSubKey($Plan.Sid)
                    if ($null -eq $account) { throw 'browser_registry_user_hive' }
                    $entry = $account.OpenSubKey($Plan.Registry)
                } else { $entry = $baseKey.OpenSubKey($Plan.Registry) }
                if ($null -eq $entry) { continue }
                if (-not $Published -or $hive -ne [Microsoft.Win32.RegistryHive]::LocalMachine -or
                    @($entry.GetValueNames()).Count -ne 1 -or @($entry.GetSubKeyNames()).Count -ne 0 -or
                    $entry.GetValueKind('') -ne [Microsoft.Win32.RegistryValueKind]::String -or
                    $entry.GetValue('') -cne $Plan.Manifest) { throw 'browser_registry_collision' }
                $acl = $entry.GetAccessControl()
                Assert-AdministratorBrowserTaskAcl ($acl.GetSecurityDescriptorSddlForm('Access,Owner')) $expected
                if ($view -eq [Microsoft.Win32.RegistryView]::Registry64) { $matched = $true }
            } finally {
                if ($entry) { $entry.Dispose() }
                if ($account) { $account.Dispose() }
                $baseKey.Dispose()
            }
        }
    }
    if ($Published -and -not $AllowMissing -and -not $matched) { throw 'browser_registry_unconfirmed' }
}

function Get-AdministratorBrowserReservation($Plan,[string]$Digest) {
    return $Digest + [char]10 + $Plan.Sid + [char]10 +
        [Convert]::ToBase64String($Plan.Files['binding.json']) + [char]10
}

function Get-AdministratorBrowserComItem([scriptblock]$Lookup) {
    try { return & $Lookup }
    catch {
        if ($_.Exception.GetBaseException().HResult -notin @(-2147024894,-2147024893)) { throw }
        return $null
    }
}

function Remove-AdministratorBrowserEndpoints($Scheduler,$Plan,[scriptblock]$RemoveHost,[switch]$PendingEnrollment) {
    $parent = $Scheduler.GetFolder('\')
    $folderPath = '\' + $Plan.Folder
    $folder = Get-AdministratorBrowserComItem { $Scheduler.GetFolder($folderPath) }
    $task = $null
    if ($folder) {
        Assert-AdministratorBrowserTaskAcl ($folder.GetSecurityDescriptor(5)) $Plan.Sddl
        $tasks = $folder.GetTasks(1)
        if ($folder.GetFolders(0).Count -ne 0 -or $tasks.Count -gt 1) { throw 'browser_unenrollment_folder' }
        if ($PendingEnrollment -and $tasks.Count -eq 0) { throw 'browser_unenrollment_folder' }
        if ($tasks.Count -eq 1) {
            $task = $tasks.Item(1)
            Assert-AdministratorBrowserTask $task $Plan ([bool]$task.Enabled)
            if ($task.Enabled) { $task.Enabled = $false }
            $task = $folder.GetTask($Plan.Name)
            Assert-AdministratorBrowserTask $task $Plan $false
            if ($task.GetInstances(0).Count -ne 0) { throw 'browser_unenrollment_active' }
        }
    }
    & $RemoveHost
    if ($folder) {
        if ($task) { $folder.DeleteTask($Plan.Name,0) }
        if ($folder.GetTasks(1).Count -ne 0 -or $folder.GetFolders(0).Count -ne 0) { throw 'browser_unenrollment_folder' }
        $parent.DeleteFolder($Plan.Folder,0)
        if (Get-AdministratorBrowserComItem { $Scheduler.GetFolder($folderPath) }) { throw 'browser_unenrollment_folder' }
    }
}

function Test-FailedBrowserOwnerTask($Scheduler,$Plan,[switch]$RetirementAuthorized) {
    $folder = Get-AdministratorBrowserComItem { $Scheduler.GetFolder(('\' + $Plan.Folder)) }
    if ($folder) {
        Assert-AdministratorBrowserTaskAcl ($folder.GetSecurityDescriptor(5)) $Plan.Sddl
        $tasks = $folder.GetTasks(1)
        if ($folder.GetFolders(0).Count -ne 0 -or $tasks.Count -gt 1) { throw 'failed_owner_task' }
        if ($tasks.Count -eq 1) {
            $task = $tasks.Item(1)
            Assert-AdministratorBrowserTask $task $Plan ([bool]$task.Enabled)
            if ($task.GetInstances(0).Count -ne 0) { throw 'browser_unenrollment_active' }
            return $true
        }
    }
    if (-not $RetirementAuthorized) { throw 'failed_owner_task' }
    return $false
}

function Write-FailedBrowserOwnerRetirement([string]$File,[byte[]]$Bytes) {
    $temp = $File + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    try {
        Write-AdministratorOwnerFile $temp $Bytes
        [IO.File]::Move($temp,$File)
    } finally {
        if (-not (Test-AdministratorOwnerAbsent $temp)) { [IO.File]::Delete($temp) }
    }
    Assert-AdministratorOwnerBytes $File $Bytes
}

function Get-FailedBrowserOwnerFileType([string]$Temp,[string]$System) {
    Assert-SealedAcl $Temp $true $true
    $source = @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class AgentContinueFailedOwnerFile {
    [StructLayout(LayoutKind.Sequential)]
    private struct Info {
        public uint Attributes, CreatedLow, CreatedHigh, AccessedLow, AccessedHigh, WrittenLow, WrittenHigh;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);
    public static string Identity(SafeFileHandle handle) {
        Info info;
        if (!GetFileInformationByHandle(handle, out info)) throw new InvalidOperationException("failed_owner_file_identity");
        if ((info.Attributes & 0x410u) != 0 || info.Links != 1 ||
            (info.IndexHigh == 0 && info.IndexLow == 0)) throw new InvalidOperationException("failed_owner_file_identity");
        return info.Volume.ToString("X8") + info.IndexHigh.ToString("X8") + info.IndexLow.ToString("X8");
    }
}
'@
    $temps = [CodeDom.Compiler.TempFileCollection]::new($Temp,$false)
    $compiler = [Microsoft.CSharp.CSharpCodeProvider]::new()
    $previous = @($env:TEMP,$env:TMP,[Environment]::CurrentDirectory)
    try {
        $env:TEMP = $env:TMP = $Temp
        [Environment]::CurrentDirectory = $System
        $parameters = [CodeDom.Compiler.CompilerParameters]::new()
        $parameters.TempFiles = $temps
        $parameters.GenerateInMemory = $true
        $result = $compiler.CompileAssemblyFromSource($parameters,$source)
        if ($result.Errors.HasErrors) { throw 'failed_owner_file_compile' }
        return $result.CompiledAssembly.GetType('AgentContinueFailedOwnerFile',$true)
    } finally {
        $env:TEMP = $previous[0]; $env:TMP = $previous[1]; [Environment]::CurrentDirectory = $previous[2]
        $compiler.Dispose(); $temps.Dispose()
    }
}

function Read-FailedBrowserOwnerEvidence([string]$File,[Type]$FileType,[bool]$Inherited,$Handles,$Ids) {
    if ($Inherited) { Assert-InheritedPrivateAcl $File $false }
    else { Assert-SealedAcl $File $false $true }
    # Deny concurrent opens, renames, and writes; hold through endpoint removal.
    $stream = [IO.File]::Open($File,'Open','Read','None')
    $Handles.Add($stream)
    $id = $FileType::Identity($stream.SafeFileHandle)
    if (-not $Ids.Add($id) -or $stream.Length -lt 1 -or $stream.Length -gt 1024) { throw 'failed_owner_file_identity' }
    $bytes = [byte[]]::new([int]$stream.Length)
    $offset = 0
    while ($offset -lt $bytes.Length) {
        $n = $stream.Read($bytes,$offset,$bytes.Length-$offset)
        if (-not $n) { throw 'failed_owner_file_identity' }
        $offset += $n
    }
    if ($stream.ReadByte() -ne -1) { throw 'failed_owner_file_identity' }
    return [Text.UTF8Encoding]::new($false,$true).GetString($bytes)
}

function Assert-FailedBrowserOwnerGeneration([string]$Root,[string]$Digest,[string]$Sid,[string]$Generation,[Type]$FileType,$Handles) {
    if ($Generation -cnotmatch '\A[a-f0-9]{32}\z' -or $Digest -cnotmatch '\A[a-f0-9]{64}\z') { throw 'failed_owner_generation' }
    $vault = $Root + '.secrets'
    $state = $Root + '.state'
    $ids = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $intent = Read-FailedBrowserOwnerEvidence ([IO.Path]::Combine($state,'lifecycle.json')) $FileType $false $Handles $ids
    if ($intent -cne ('{"format":"agent-continue-lifecycle","version":1,"paused":true}' + [char]10)) { throw 'failed_owner_not_paused' }
    $lease = Read-FailedBrowserOwnerEvidence ([IO.Path]::Combine($vault,'owner-job.lease')) $FileType $false $Handles $ids
    $expectedLease = ('{{"version":1,"bundleSha256":"{0}","userSid":"{1}","generation":"{2}"}}' -f $Digest,$Sid,$Generation) + [char]10
    if ($lease -cne $expectedLease) { throw 'failed_owner_generation' }
    $terminal = Read-FailedBrowserOwnerEvidence ([IO.Path]::Combine($vault,('owner-job-' + $Generation + '.terminal.json'))) $FileType $false $Handles $ids
    $row = ConvertFrom-Json -InputObject $terminal
    $exitCode = $row.rootExitCode
    if (($exitCode -isnot [int] -and $exitCode -isnot [long]) -or $exitCode -lt 1 -or $exitCode -gt [uint32]::MaxValue) {
        throw 'failed_owner_terminal'
    }
    $expected = [ordered]@{format='agent-continue-windows-owner-job';version=1;generation=$Generation;
        bundleSha256=$Digest;outcome='owner-exited';jobDrained=$true;rootCreationAttempted=$true;rootExitObserved=$true;
        rootExitCode=$exitCode;innerLeasesClear=$false;tunnelReady='unobserved'}
    if ($terminal -cne ((ConvertTo-Json -InputObject $expected -Compress) + [char]10) -or
        -not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($vault,('owner-observation-' + $Generation + '.json'))))) {
        throw 'failed_owner_terminal'
    }
    # Legacy terminal receipts do not identify these inner files. Check their current
    # protected contents and hold them stable; do not attribute them to the generation.
    foreach ($pair in @(@('controller.lease','agent-continue-controller'),@('device-operations.lease','agent-continue-device-operation-owner'))) {
        $inner = Read-FailedBrowserOwnerEvidence ([IO.Path]::Combine($state,$pair[0])) $FileType $true $Handles $ids
        $shape = '\A\{"format":"' + $pair[1] + '","version":1,"token":"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"\}\n\z'
        if ($inner -cnotmatch $shape) { throw 'failed_owner_inner_lease' }
    }
    $journal = Read-FailedBrowserOwnerEvidence ([IO.Path]::Combine($state,'device-operations.jsonl')) $FileType $true $Handles $ids
    if ($journal -cne ('{"format":"agent-continue-device-operations","version":1}' + [char]10) -or
        -not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($state,'mcp-operation-receipts')))) { throw 'failed_owner_operation_history' }
}

function Remove-AdministratorBrowserOwner($Plan,[string]$Root,[string]$Digest,[string]$Base,
    [string]$FailedGeneration = '',[switch]$InspectOnly) {
    Assert-AdministratorOwnerControlIdentity $Root $Digest $Plan.Sid
    $vault = $Root + '.secrets'
    $state = $Root + '.state'
    $lockPath = [IO.Path]::Combine($Base,'browser-enrollment.lock')
    Assert-SealedAcl $lockPath $false $true
    $reservation = [IO.File]::Open($lockPath,'Open','Read',([IO.FileShare]::Delete))
    $gate = $null
    $evidence = [Collections.Generic.List[IO.FileStream]]::new()
    try {
        $identity = Get-AdministratorBrowserReservation $Plan $Digest
        if ($reservation.Length -ne $identity.Length) { throw 'browser_unenrollment_reservation' }
        foreach ($character in $identity.ToCharArray()) {
            if ($reservation.ReadByte() -ne [int]$character) { throw 'browser_unenrollment_reservation' }
        }
        if ($reservation.ReadByte() -ne -1) { throw 'browser_unenrollment_reservation' }
        $gate = Open-AdministratorOwnerControl $vault
        if (-not $InspectOnly) {
            $deny = [IO.Path]::Combine($vault,'owner-revoked')
            Assert-SealedAcl $deny $false $true
            if ([IO.FileInfo]::new($deny).Length -ne 0) { throw 'browser_unenrollment_active' }
        }
        if (-not $FailedGeneration -and (-not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($vault,'owner-job.lease'))) -or
            -not (Test-AdministratorOwnerInnerLeasesClear $state))) { throw 'browser_unenrollment_active' }
        Read-AdministratorBrowserCommit $Plan.Bridge $Digest $Plan.Sid -ForRemoval
        $pendingOnly = Test-AdministratorOwnerAbsent ([IO.Path]::Combine($Plan.Bridge,'enrolled.json'))
        if ($FailedGeneration -and $pendingOnly) { throw 'failed_owner_pending_enrollment' }
        foreach ($name in $Plan.Files.Keys) {
            Assert-AdministratorBrowserAsset ([IO.Path]::Combine($Plan.Bridge,$name)) $Plan.Files[$name] $Plan.Sid
        }
        Assert-AdministratorBrowserAsset $Plan.DemandScript $Plan.DemandBytes $Plan.Sid
        Assert-AdministratorOwnerBytes $Plan.DemandBinding $Plan.DemandBindingBytes
        $scheduler = New-Object -ComObject Schedule.Service
        $scheduler.Connect()
        if ($FailedGeneration) {
            $retirement = [IO.Path]::Combine($vault,('owner-job-' + $FailedGeneration + '.browser-retirement.json'))
            $retirementBytes = [Text.Encoding]::UTF8.GetBytes(
                ('{{"version":1,"bundleSha256":"{0}","userSid":"{1}","generation":"{2}","intent":"retire-browser-endpoints"}}' -f
                    $Digest,$Plan.Sid,$FailedGeneration) + [char]10)
            $retirementAuthorized = -not (Test-AdministratorOwnerAbsent $retirement)
            if ($retirementAuthorized) { Assert-AdministratorOwnerBytes $retirement $retirementBytes }
            if (Test-FailedBrowserOwnerTask $scheduler $Plan -RetirementAuthorized:$retirementAuthorized) {
                Assert-AdministratorBrowserRegistry $Plan $true -AllowMissing:$retirementAuthorized
            } else {
                # Host deletion precedes task deletion. A remaining host is not this retry state.
                Assert-AdministratorBrowserRegistry $Plan $false
            }
            $scratch = [IO.Path]::Combine($Base,('owner-inspection-' + [guid]::NewGuid().ToString('N')))
            Ensure-SealedDirectory $scratch $true
            try { $fileType = Get-FailedBrowserOwnerFileType $scratch $Plan.System }
            finally { [IO.Directory]::Delete($scratch,$false) }
            Assert-FailedBrowserOwnerGeneration $Root $Digest $Plan.Sid $FailedGeneration $fileType $evidence
            if ($InspectOnly) { return }
            if (-not $retirementAuthorized) { Write-FailedBrowserOwnerRetirement $retirement $retirementBytes }
        } else {
            Assert-AdministratorBrowserRegistry $Plan $true -AllowMissing
        }
        Remove-AdministratorBrowserEndpoints $scheduler $Plan {
            $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey('LocalMachine','Registry64')
            $parentKey = $null
            try {
                $split = $Plan.Registry.LastIndexOf('\')
                $parentKey = $baseKey.OpenSubKey($Plan.Registry.Substring(0,$split),$true)
                if ($parentKey) { $parentKey.DeleteSubKey($Plan.Registry.Substring($split+1),$false) }
            } finally { if ($parentKey) { $parentKey.Dispose() }; $baseKey.Dispose() }
            Assert-AdministratorBrowserRegistry $Plan $false
        } -PendingEnrollment:$pendingOnly
        # The deny marker and archived bridge remain. Release only this bound reservation.
        [IO.File]::Delete($lockPath)
    } finally {
        foreach ($stream in $evidence) { $stream.Dispose() }
        if ($gate) { $gate.Dispose() }
        $reservation.Dispose()
    }
}

function Write-AdministratorBrowserAsset([string]$File,[byte[]]$Bytes,[string]$Sid,[bool]$Private = $false) {
    $out = Open-SealedNewFile $File $Private $Sid
    try { $out.Write($Bytes,0,$Bytes.Length); $out.Flush($true) } finally { $out.Dispose() }
    Assert-AdministratorBrowserAsset $File $Bytes $Sid $Private
}

function Assert-AdministratorBrowserAsset([string]$File,[byte[]]$Bytes,[string]$Sid,[bool]$Private = $false) {
    Assert-SealedAcl $File $false $Private $Sid
    if ([IO.FileInfo]::new($File).Length -ne $Bytes.Length -or
        [Convert]::ToBase64String([IO.File]::ReadAllBytes($File)) -cne [Convert]::ToBase64String($Bytes)) {
        throw 'browser_asset_readback'
    }
}

function Read-AdministratorBrowserCommit([string]$Bridge,[string]$Digest,[string]$Sid,[switch]$ForRemoval) {
    $commit = [IO.Path]::Combine($Bridge,'enrolled.json')
    $value = '{{"version":1,"bundleSha256":"{0}"}}' -f $Digest
    Assert-SealedAcl $Bridge $true $false $Sid
    if ($ForRemoval) {
        $pending = [IO.Path]::Combine($Bridge,'enrollment.pending')
        if (Test-AdministratorOwnerAbsent $commit) { $commit = $pending }
        elseif (-not (Test-AdministratorOwnerAbsent $pending)) { throw 'browser_enrollment_not_committed' }
    }
    Assert-SealedAcl $commit $false $false $Sid
    if ([IO.FileInfo]::new($commit).Length -ne $value.Length -or [IO.File]::ReadAllText($commit) -cne $value) {
        throw 'browser_enrollment_not_committed'
    }
}

function Assert-AdministratorBrowserSetupParameters([string]$Action,[string[]]$BoundParameters,
    [string]$Digest,[string]$SetupId,[string]$ExtensionId) {
    if ($Action -cne 'ObserveBrowserSetup' -or $Digest -cnotmatch '\A[a-f0-9]{64}\z' -or
        $SetupId -cnotmatch '\A[a-f0-9]{32}\z' -or $ExtensionId -cnotmatch '\A[a-p]{32}\z') { throw 'browser_setup_input' }
    $required=@('Action','Archive','ExpectedSha256','BrowserSetupId','BrowserExtensionId')
    if ($BoundParameters.Count -ne $required.Count) { throw 'browser_setup_input' }
    foreach ($name in $required) {
        if ([Array]::IndexOf($BoundParameters,$name) -lt 0) { throw 'browser_setup_input' }
    }
}

function Get-AdministratorBrowserSetupReceiptBytes([string]$SetupId,[string]$Digest,[string]$Origin,[string]$Target) {
    if ($SetupId -cnotmatch '\A[a-f0-9]{32}\z' -or $Digest -cnotmatch '\A[a-f0-9]{64}\z' -or
        $Origin -cnotmatch '\Achrome-extension://[a-p]{32}/\z' -or
        -not (Test-AdministratorBrowserPauseTarget $Target)) { throw 'browser_setup_receipt' }
    return ,([Text.Encoding]::ASCII.GetBytes(
        ('{{"version":1,"setupId":"{0}","bundleSha256":"{1}","origin":"{2}","controlTarget":"{3}"}}' -f
            $SetupId,$Digest,$Origin,$Target)+[char]10))
}

function Read-AdministratorBrowserSetupReceipt([string]$Bridge,[string]$SetupId,[string]$Digest,[string]$Sid,[string]$Origin) {
    Assert-SealedAcl $Bridge $true $false $Sid
    $bytes=Read-AdministratorControlBytes ([IO.Path]::Combine($Bridge,'setup-receipt.json')) $false $Sid 512
    $text=[Text.UTF8Encoding]::new($false,$true).GetString($bytes)
    if ($text -cnotmatch '\A\{"version":1,"setupId":"(?<setup>[a-f0-9]{32})","bundleSha256":"(?<bundle>[a-f0-9]{64})","origin":"(?<origin>chrome-extension://[a-p]{32}/)","controlTarget":"(?<target>[a-f0-9]{32}:(?:[a-f0-9]{32}|idle))"\}\n\z' -or
        $Matches.setup -cne $SetupId -or $Matches.bundle -cne $Digest -or $Matches.origin -cne $Origin) { throw 'browser_setup_receipt' }
    return $Matches.target
}

function Get-AdministratorBrowserSetupTarget([string]$Root,[string]$Digest,[string]$Sid) {
    $before=Read-AdministratorBrowserPauseTargetProjection $Root $Digest $Sid
    $first=Read-AdministratorBrowserControlSupportProjection $Root $Digest $Sid
    $after=Read-AdministratorBrowserPauseTargetProjection $Root $Digest $Sid
    $last=Read-AdministratorBrowserControlSupportProjection $Root $Digest $Sid
    if ($before -isnot [string] -or -not (Test-AdministratorBrowserPauseTarget $before) -or
        -not $before.EndsWith(':idle',[StringComparison]::Ordinal) -or $after -cne $before -or
        $first.target -cne $before -or $last.target -cne $before -or
        $first.ownerState -cne 'paused' -or $last.ownerState -cne 'paused') { throw 'browser_setup_target' }
    return $before
}

function Publish-AdministratorBrowserSetupReceipt([string]$Root,[string]$Digest,[string]$Sid,[string]$Origin,
    [string]$SetupId,[string]$Target,[IO.FileStream]$Gate) {
    # The enrollment caller retains its original gate and captured target. Never rebase consent.
    if ($null -eq $Gate -or -not $Gate.CanRead -or -not $Gate.CanWrite -or
        -not (Test-AdministratorBrowserPauseTarget $Target) -or
        (Read-AdministratorOwnerControlRevision $Gate) -cne $Target.Split(':')[0] -or
        (Get-AdministratorBrowserSetupTarget $Root $Digest $Sid) -cne $Target) { throw 'browser_setup_target' }
    Read-AdministratorBrowserCommit ($Root+'.browser') $Digest $Sid
    $bytes=Get-AdministratorBrowserSetupReceiptBytes $SetupId $Digest $Origin $Target
    Write-AdministratorBrowserAsset ([IO.Path]::Combine($Root+'.browser','setup-receipt.json')) $bytes $Sid
}

function Get-AdministratorBrowserSetupBinding([string]$ArchivePath,[string]$Digest,[string]$ScriptPath,
    [string]$ProgramFiles,[string]$System,[string]$Sid,[string]$ExtensionId) {
    if ($Digest -cnotmatch '\A[a-f0-9]{64}\z' -or $ExtensionId -cnotmatch '\A[a-p]{32}\z' -or
        $Sid -cnotmatch '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z') { throw 'browser_setup_binding' }
    Assert-AdministratorBrowserPauseAnchors $ProgramFiles $System
    $base=[IO.Path]::Combine($ProgramFiles,'AgentContinueAdmin')
    $root=[IO.Path]::Combine($base,$Digest.Substring(0,24));$bridge=$root+'.browser'
    if ($ArchivePath -cne [IO.Path]::Combine($bridge,'bundle.zip') -or
        $ScriptPath -cne [IO.Path]::Combine($bridge,'stager.ps1')) { throw 'browser_setup_binding' }
    Assert-SealedAcl $base $true
    Assert-SealedAcl $root $true
    Read-AdministratorBrowserCommit $bridge $Digest $Sid
    if (-not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($bridge,'enrollment.pending')))) { throw 'browser_setup_binding' }
    Assert-SealedAcl $ScriptPath $false $false $Sid
    Assert-SealedAcl $ArchivePath $false $false $Sid
    $origin='chrome-extension://'+$ExtensionId+'/'
    $bytes=Read-AdministratorControlBytes ([IO.Path]::Combine($bridge,'binding.json')) $false $Sid 1024
    $expected=(ConvertTo-Json -InputObject ([ordered]@{version=1;origin=$origin;bundleSha256=$Digest;systemDirectory=$System}) -Compress)+[char]10
    if ([Text.UTF8Encoding]::new($false,$true).GetString($bytes) -cne $expected) { throw 'browser_setup_binding' }
    Assert-AdministratorBrowserRegistry @{Sid=$Sid;Manifest=[IO.Path]::Combine($bridge,'host.json');
        Registry='Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.administrator_owner'} $true
    return @{Root=$root;Digest=$Digest;Sid=$Sid;Origin=$origin}
}

function Read-AdministratorBrowserSetupStatus([string]$Action,[string[]]$BoundParameters,[string]$Digest,
    [string]$SetupId,[string]$ExtensionId,[scriptblock]$Verify) {
    $unknown=@{setupId=$SetupId;state='unconfirmed';bundleSha256=$null;target=$null}
    try {
        Assert-AdministratorBrowserSetupParameters $Action $BoundParameters $Digest $SetupId $ExtensionId
        $binding=& $Verify
        $origin='chrome-extension://'+$ExtensionId+'/'
        if ($null -eq $binding -or $binding.Digest -cne $Digest -or $binding.Origin -cne $origin -or
            $binding.Sid -isnot [string] -or $binding.Sid -cnotmatch '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z' -or
            $binding.Root -isnot [string] -or $binding.Root -cne [IO.Path]::GetFullPath($binding.Root) -or
            [IO.Path]::GetFileName($binding.Root) -cne $Digest.Substring(0,24)) { return $unknown }
        $before=Get-AdministratorBrowserSetupTarget $binding.Root $Digest $binding.Sid
        $target=Read-AdministratorBrowserSetupReceipt ($binding.Root+'.browser') $SetupId $Digest $binding.Sid $origin
        $after=Get-AdministratorBrowserSetupTarget $binding.Root $Digest $binding.Sid
        if ($target -cne $before -or $after -cne $before) { return $unknown }
        return @{setupId=$SetupId;state='installed';bundleSha256=$Digest;target=$target}
    } catch { return $unknown }
}

function Assert-AdministratorBrowserNamespaceFree($Scheduler,$Plan) {
    $folderPath = '\' + $Plan.Folder
    if ((Get-AdministratorBrowserComItem { $Scheduler.GetFolder($folderPath) }) -or
        -not (Test-AdministratorOwnerAbsent $Plan.Bridge)) { throw 'browser_enrollment_collision' }
    Assert-AdministratorBrowserRegistry $Plan $false
}

function Read-AdministratorBrowserStager([string]$File,[string]$ExpectedDigest) {
    $source = [IO.File]::Open($File,'Open','Read','Read')
    $snapshot = $digest = $null
    try {
        if ($source.Length -lt 1 -or $source.Length -gt 512KB) { throw 'browser_stager_size' }
        $snapshot = [IO.MemoryStream]::new()
        $source.CopyTo($snapshot)
        $bytes = $snapshot.ToArray()
        $digest = [Security.Cryptography.SHA256]::Create()
        if ((To-Hex $digest.ComputeHash($bytes)) -cne $ExpectedDigest) { throw 'browser_stager_hash' }
        return ,$bytes
    } finally {
        if ($digest) { $digest.Dispose() }
        if ($snapshot) { $snapshot.Dispose() }
        $source.Dispose()
    }
}

function Publish-AdministratorBrowserEnrollment($Plan,[string]$Digest,[string]$Vault,[switch]$RequirePauseTarget,
    [string]$BrowserSetupId = '') {
    $gate = Open-AdministratorOwnerControl $Vault
    try {
        $null = Read-AdministratorOwnerControlRevision $gate
        if (-not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($Vault,'owner-revoked')))) {
            throw 'browser_owner_unavailable'
        }
        Read-AdministratorBrowserCommit $Plan.Bridge $Digest $Plan.Sid -ForRemoval
        if ($RequirePauseTarget) {
            if (-not $Vault.EndsWith('.secrets',[StringComparison]::Ordinal)) { throw 'browser_pause_target' }
            $state = $Vault.Substring(0,$Vault.Length-8) + '.state'
            Update-AdministratorBrowserPauseTarget $state $Vault $Digest $Plan.Sid $gate -Require
        }
        $setupTarget = $null
        if ($BrowserSetupId) {
            if (-not $RequirePauseTarget) { throw 'browser_setup_target' }
            $bundleRoot = $Vault.Substring(0,$Vault.Length-8)
            $setupTarget = Get-AdministratorBrowserSetupTarget $bundleRoot $Digest $Plan.Sid
        }
        [IO.File]::Move([IO.Path]::Combine($Plan.Bridge,'enrollment.pending'),[IO.Path]::Combine($Plan.Bridge,'enrolled.json'))
        Read-AdministratorBrowserCommit $Plan.Bridge $Digest $Plan.Sid
        if ($BrowserSetupId) {
            $public = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString($Plan.Files['binding.json']))
            Publish-AdministratorBrowserSetupReceipt $bundleRoot $Digest $Plan.Sid $public.origin $BrowserSetupId $setupTarget $gate
        }
    } finally { $gate.Dispose() }
}

function Register-AdministratorBrowserOwner($Plan,[string]$Digest,[byte[]]$StagerBytes,$ArchiveStream,[string]$CompilerTemp,
    [string]$Vault,[string]$StagerDigest,[string]$BrowserSetupId = '') {
    $scheduler = New-Object -ComObject Schedule.Service
    $scheduler.Connect()
    $parent = $scheduler.GetFolder('\')
    Assert-AdministratorBrowserNamespaceFree $scheduler $Plan
    $registry = Get-AdministratorBrowserRegistryType $CompilerTemp
    $task = New-AdministratorBrowserTaskDefinition $scheduler $Plan
    Ensure-SealedDirectory $Plan.Bridge $false $Plan.Sid
    foreach ($name in $Plan.Files.Keys) {
        Write-AdministratorBrowserAsset ([IO.Path]::Combine($Plan.Bridge,$name)) $Plan.Files[$name] $Plan.Sid
    }
    Write-AdministratorBrowserAsset $Plan.Stager $StagerBytes $Plan.Sid
    Write-AdministratorBrowserAsset $Plan.DemandScript $Plan.DemandBytes $Plan.Sid
    Write-AdministratorBrowserAsset $Plan.DemandBinding $Plan.DemandBindingBytes $Plan.Sid $true
    $out = Open-SealedNewFile $Plan.Archive $false $Plan.Sid
    try { $ArchiveStream.Position = 0; Copy-Or-Hash $ArchiveStream $ArchiveStream.Length $out } finally { $out.Dispose() }
    Assert-SealedAcl $Plan.Archive $false $false $Plan.Sid
    $copy = [IO.File]::Open($Plan.Archive,'Open','Read','Read')
    try {
        if ((Copy-Or-Hash $copy $copy.Length $null) -cne $Digest) { throw 'browser_archive_readback' }
    } finally { $copy.Dispose() }

    # Keep the v1 commit marker byte-compatible with existing native hosts.
    Write-AdministratorBrowserAsset ([IO.Path]::Combine($Plan.Bridge,'pause-launch.json')) (
        Get-AdministratorBrowserPauseMetadata $Digest $Plan.Sid $StagerDigest) $Plan.Sid
    $commit = '{{"version":1,"bundleSha256":"{0}"}}' -f $Digest
    $pending = [IO.Path]::Combine($Plan.Bridge,'enrollment.pending')
    Write-AdministratorBrowserAsset $pending ([Text.Encoding]::ASCII.GetBytes($commit)) $Plan.Sid
    # Pending proves ownership for rollback only; neither the task nor Chrome accepts it for wake.
    $null = $parent.CreateFolder($Plan.Folder,$Plan.Sddl)
    $folder = $scheduler.GetFolder('\' + $Plan.Folder)
    Assert-AdministratorBrowserTaskAcl ($folder.GetSecurityDescriptor(5)) $Plan.Sddl
    $null = $folder.RegisterTaskDefinition($Plan.Name,$task,0x32,$Plan.Sid,$null,3,$Plan.Sddl)
    $registered = $folder.GetTask($Plan.Name)
    Assert-AdministratorBrowserTask $registered $Plan $false
    $registered.Enabled = $true
    $folder = $scheduler.GetFolder('\' + $Plan.Folder)
    Assert-AdministratorBrowserTaskAcl ($folder.GetSecurityDescriptor(5)) $Plan.Sddl
    Assert-AdministratorBrowserTask ($folder.GetTask($Plan.Name)) $Plan $true
    $acl = [Security.AccessControl.RegistrySecurity]::new()
    $acl.SetSecurityDescriptorSddlForm('O:BAG:SYD:P(A;;KA;;;SY)(A;;KA;;;BA)(A;;KR;;;' + $Plan.Sid + ')')
    Assert-AdministratorBrowserRegistry $Plan $false
    $registry::Create64($Plan.Registry,$Plan.Manifest,$acl.GetSecurityDescriptorBinaryForm())
    Assert-AdministratorBrowserRegistry $Plan $true

    if ($BrowserSetupId) {
        Publish-AdministratorBrowserEnrollment $Plan $Digest $Vault -RequirePauseTarget -BrowserSetupId $BrowserSetupId
    } else {
        Publish-AdministratorBrowserEnrollment $Plan $Digest $Vault -RequirePauseTarget
    }
}

function Get-AdministratorBrowserPauseMetadata([string]$Digest,[string]$Sid,[string]$StagerDigest) {
    return ,([Text.Encoding]::ASCII.GetBytes(
        ('{{"version":1,"bundleSha256":"{0}","userSid":"{1}","stagerSha256":"{2}"}}' -f $Digest,$Sid,$StagerDigest)))
}

function Read-AdministratorBrowserPauseMetadata([IO.Stream]$Source,[string]$Digest,[string]$Sid) {
    if ($Source.Length -lt 1 -or $Source.Length -gt 256) { throw 'browser_pause_metadata' }
    $reader = [IO.BinaryReader]::new($Source,[Text.Encoding]::ASCII,$true)
    try {
        $length = [int]$Source.Length
        $bytes = $reader.ReadBytes($length)
        if ($bytes.Length -ne $length -or $Source.ReadByte() -ne -1) { throw 'browser_pause_metadata' }
        $text = [Text.Encoding]::ASCII.GetString($bytes)
        if ($text -cnotmatch '\A\{"version":1,"bundleSha256":"(?<bundle>[a-f0-9]{64})","userSid":"(?<sid>S-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4})","stagerSha256":"(?<stager>[a-f0-9]{64})"\}\z' -or
            $Matches.bundle -cne $Digest -or $Matches.sid -cne $Sid) { throw 'browser_pause_metadata' }
        return $Matches.stager
    } finally { $reader.Dispose() }
}

function Get-AdministratorBrowserPauseIdentity([string]$System) {
    $thread = [Security.Principal.WindowsIdentity]::GetCurrent($true)
    if ($thread) { $thread.Dispose(); throw 'identity' }
    $process = [Diagnostics.Process]::GetCurrentProcess()
    $identity = $null
    $buffer = [IntPtr]::Zero
    try {
        if ($process.SessionId -le 0) { throw 'identity' }
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        if (([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole(
            [Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'identity' }

        # Query the actual token without compiling a DLL or loading a user module.
        $assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly(
            [Reflection.AssemblyName]::new('AgentContinueBrowserPauseToken'),[Reflection.Emit.AssemblyBuilderAccess]::Run)
        $type = $assembly.DefineDynamicModule('Native').DefineType('PauseToken')
        $method = $type.DefinePInvokeMethod('GetTokenInformation',[IO.Path]::Combine($System,'advapi32.dll'),
            [Reflection.MethodAttributes]'Public, Static, PinvokeImpl',[Reflection.CallingConventions]::Standard,
            [int],[Type[]]@([IntPtr],[int],[IntPtr],[int],[int].MakeByRefType()),
            [Runtime.InteropServices.CallingConvention]::Winapi,[Runtime.InteropServices.CharSet]::None)
        $method.SetImplementationFlags($method.GetMethodImplementationFlags() -bor [Reflection.MethodImplAttributes]::PreserveSig)
        $native = $type.CreateType()
        $marshal = [Runtime.InteropServices.Marshal]
        $token = $identity.Token
        $limit = 256
        $buffer = $marshal::AllocHGlobal($limit)
        $size = 0
        # TokenElevation requires the exact DWORD length even with a larger backing buffer.
        if ($native::GetTokenInformation($token,20,$buffer,4,[ref]$size) -eq 0 -or $size -ne 4) { throw 'identity' }
        $elevated = $marshal::ReadInt32($buffer) -ne 0
        $required = 0
        if ($native::GetTokenInformation($token,25,[IntPtr]::Zero,0,[ref]$required) -ne 0 -or
            $required -lt [IntPtr]::Size -or $required -gt $limit) { throw 'identity' }
        if ($native::GetTokenInformation($token,25,$buffer,$required,[ref]$size) -eq 0 -or $size -ne $required) { throw 'identity' }
        $label = [Security.Principal.SecurityIdentifier]::new($marshal::ReadIntPtr($buffer))
        return @{Sid=$identity.User.Value; SessionId=$process.SessionId; Elevated=$elevated; Integrity=$label.Value}
    } finally {
        if ($buffer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer) }
        if ($identity) { $identity.Dispose() }
        $process.Dispose()
    }
}

function Assert-AdministratorBrowserPauseAnchors([string]$ProgramFiles,[string]$System) {
    if ($ProgramFiles -notmatch '\A[A-Z]:\\[ -~]+\z' -or $ProgramFiles.Substring(2) -match '[%!^&|<>():*?"]' -or
        $ProgramFiles -cne [IO.Path]::GetFullPath($ProgramFiles) -or
        [IO.Path]::GetDirectoryName($ProgramFiles) -ine [IO.Path]::GetPathRoot($ProgramFiles) -or
        $System -notmatch '\A[A-Z]:\\Windows\\System32\z') { throw 'anchor' }
    foreach ($volume in @([IO.Path]::GetPathRoot($ProgramFiles),[IO.Path]::GetPathRoot($System))) {
        $disk = [IO.DriveInfo]::new($volume)
        if ($disk.DriveType -ne 'Fixed' -or $disk.DriveFormat -ne 'NTFS') { throw 'anchor' }
        Assert-Anchor $volume $true
    }
    Assert-Anchor $ProgramFiles $false
    Assert-Anchor ([IO.Path]::GetDirectoryName($System)) $false
    Assert-Anchor $System $false
    Assert-Anchor ([IO.Path]::Combine($System,'advapi32.dll')) $false $false
    Assert-Anchor ([IO.Path]::Combine($System,'WindowsPowerShell')) $false
    Assert-Anchor ([IO.Path]::Combine($System,'WindowsPowerShell\v1.0')) $false
    Assert-Anchor ([IO.Path]::Combine($System,'WindowsPowerShell\v1.0\powershell.exe')) $false $false
}

function Open-AdministratorBrowserPauseAsset([string]$Path,[string]$Sid) {
    Assert-SealedAcl $Path $false $false $Sid
    return [IO.File]::Open($Path,'Open','Read','Read')
}

function Read-AdministratorBrowserPauseAssetHash([IO.Stream]$Source,[long]$Limit) {
    if ($Source.Length -lt 1 -or $Source.Length -gt $Limit) { throw 'browser_pause_asset_size' }
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return To-Hex $hash.ComputeHash($Source) }
    finally { $hash.Dispose() }
}

function Get-AdministratorBrowserPauseTarget([string]$ArchivePath,[string]$Digest,[string]$ScriptPath,
    [string]$ProgramFiles,[string]$System,[scriptblock]$ReadIdentity) {
    if ($Digest -cnotmatch '\A[a-f0-9]{64}\z') { throw 'input' }
    Assert-AdministratorBrowserPauseAnchors $ProgramFiles $System
    $identity = & $ReadIdentity $System
    $sid = $identity.Sid
    if ($identity.SessionId -le 0 -or $identity.Elevated -ne $false -or $identity.Integrity -cne 'S-1-16-8192' -or
        $sid -cnotmatch '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z') { throw 'identity' }
    $base = [IO.Path]::Combine($ProgramFiles,'AgentContinueAdmin')
    $bridge = [IO.Path]::Combine($base,($Digest.Substring(0,24) + '.browser'))
    $sealedStager = [IO.Path]::Combine($bridge,'stager.ps1')
    $sealedArchive = [IO.Path]::Combine($bridge,'bundle.zip')
    if ($ArchivePath -cne $sealedArchive -or $ScriptPath -cne $sealedStager) { throw 'browser_enrollment_launch' }
    Assert-SealedAcl $base $true
    Read-AdministratorBrowserCommit $bridge $Digest $sid
    if (-not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($bridge,'enrollment.pending')))) {
        throw 'browser_enrollment_not_committed'
    }
    # An unenrolled installation retains its archived bridge and commit marker.
    Assert-AdministratorBrowserRegistry @{
        Sid=$sid; Manifest=[IO.Path]::Combine($bridge,'host.json')
        Registry='Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.administrator_owner'
    } $true

    $stream = Open-AdministratorBrowserPauseAsset ([IO.Path]::Combine($bridge,'pause-launch.json')) $sid
    try { $stagerDigest = Read-AdministratorBrowserPauseMetadata $stream $Digest $sid }
    finally { $stream.Dispose() }
    $stream = Open-AdministratorBrowserPauseAsset $sealedStager $sid
    try {
        if ((Read-AdministratorBrowserPauseAssetHash $stream 512KB) -cne $stagerDigest) { throw 'browser_stager_hash' }
    } finally { $stream.Dispose() }
    $stream = Open-AdministratorBrowserPauseAsset $sealedArchive $sid
    try {
        if ((Read-AdministratorBrowserPauseAssetHash $stream $totalLimit) -cne $Digest) { throw 'archive_hash' }
    } finally { $stream.Dispose() }
    return @{Stager=$sealedStager; Archive=$sealedArchive; Digest=$Digest; Sid=$sid; System=$System;
        Root=[IO.Path]::Combine($base,$Digest.Substring(0,24))}
}

function Assert-AdministratorInstallationPauseParameters([string]$Action,[string[]]$BoundParameters,
    [string]$Digest,[string]$Id,[string]$Extension,[string]$Sid = '',[string]$Consent = '') {
    $support=$Action -ceq 'CheckBrowserHostedOwnerInstallationPause'
    $high=$Action -ceq 'PauseBrowserHostedOwnerInstallation'
    if ($Action -cnotin @('CheckBrowserHostedOwnerInstallationPause','RequestBrowserHostedOwnerInstallationPause',
        'ObserveBrowserHostedOwnerInstallationPause','PauseBrowserHostedOwnerInstallation') -or
        $Digest -cnotmatch '\A[a-f0-9]{64}\z' -or $Extension -cnotmatch '\A[a-p]{32}\z' -or
        ($support -and $Id) -or (-not $support -and $Id -cnotmatch '\A[a-f0-9]{32}\z')) { throw 'installation_pause_input' }
    $required=@('Action','Archive','ExpectedSha256','BrowserExtensionId')
    if (-not $support) { $required+='PauseOperationId' }
    if ($high) {
        $required+=@('ExpectedUserSid','Consent')
        if ($Sid -cnotmatch '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z' -or
            $Consent -cne 'pause-browser-administrator-installation') { throw 'installation_pause_input' }
    } elseif ($Sid -or $Consent) { throw 'installation_pause_input' }
    if ($BoundParameters.Count -ne $required.Count) { throw 'installation_pause_input' }
    foreach ($name in $required) {
        if ([Array]::IndexOf($BoundParameters,$name) -lt 0) { throw 'installation_pause_input' }
    }
}

function Get-AdministratorInstallationPauseBinding([string]$ArchivePath,[string]$Digest,[string]$ScriptPath,
    [string]$ProgramFiles,[string]$System,[string]$Extension) {
    $target=Get-AdministratorBrowserPauseTarget $ArchivePath $Digest $ScriptPath $ProgramFiles $System {
        param($SystemDirectory) Get-AdministratorBrowserPauseIdentity $SystemDirectory
    }
    $public=Get-AdministratorBrowserSetupBinding $ArchivePath $Digest $ScriptPath $ProgramFiles $System $target.Sid $Extension
    if ($public.Root -cne $target.Root -or $public.Digest -cne $target.Digest -or $public.Sid -cne $target.Sid) {
        throw 'installation_pause_binding'
    }
    $target.Origin=$public.Origin
    return $target
}

function New-AdministratorInstallationPauseLaunchPlan($Binding,[string]$Id,[string]$Extension) {
    $b=$Binding
    Assert-AdministratorInstallationPauseParameters 'PauseBrowserHostedOwnerInstallation' `
        @('Action','Archive','ExpectedSha256','BrowserExtensionId','PauseOperationId','ExpectedUserSid','Consent') `
        $b.Digest $Id $Extension $b.Sid 'pause-browser-administrator-installation'
    if ($b.Origin -cne ('chrome-extension://'+$Extension+'/') -or
        $b.Root -cnotmatch '\A[A-Z]:\\[^\\]' -or $b.Root.Substring(2) -match '[%!^&|<>():*?"\x00-\x1f]' -or
        $b.Root -cne [IO.Path]::GetFullPath($b.Root) -or [IO.Path]::GetFileName($b.Root) -cne $b.Digest.Substring(0,24) -or
        $b.Stager -cne [IO.Path]::Combine($b.Root+'.browser','stager.ps1') -or
        $b.Archive -cne [IO.Path]::Combine($b.Root+'.browser','bundle.zip') -or
        $b.System -notmatch '\A[A-Z]:\\Windows\\System32\z') { throw 'installation_pause_binding' }
    $arguments='-NoLogo -NoProfile -NonInteractive -File "{0}" -Action PauseBrowserHostedOwnerInstallation -Archive "{1}" -ExpectedSha256 {2} -BrowserExtensionId {3} -PauseOperationId {4} -ExpectedUserSid {5} -Consent pause-browser-administrator-installation' -f
        $b.Stager,$b.Archive,$b.Digest,$Extension,$Id,$b.Sid
    $plan=[Diagnostics.ProcessStartInfo]::new([IO.Path]::Combine($b.System,'WindowsPowerShell\v1.0\powershell.exe'),$arguments)
    $plan.UseShellExecute=$true; $plan.Verb='runas'; $plan.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
    $plan.WorkingDirectory=$b.System
    return $plan
}

function Invoke-AdministratorInstallationPauseAction([string]$Action,[string]$Digest,[string]$Id,[string]$Extension,
    [string[]]$BoundParameters,[scriptblock]$Verify,[scriptblock]$Start) {
    Assert-AdministratorInstallationPauseParameters $Action $BoundParameters $Digest $Id $Extension
    if ($Action -ceq 'PauseBrowserHostedOwnerInstallation') { throw 'installation_pause_input' }
    $support=$Action -ceq 'CheckBrowserHostedOwnerInstallationPause'
    $result=@{bundleSha256=$Digest;state='unconfirmed'}
    if (-not $support) { $result.operationId=$Id }
    try {
        $b=& $Verify
        if ($null -eq $b -or $b.Digest -cne $Digest -or $b.Origin -cne ('chrome-extension://'+$Extension+'/')) {
            return $result
        }
        if ($support) { $result.state='supported'; return $result }
        $receipt=Read-AdministratorOwnerPause ($b.Root+'.status') $Digest $b.Sid $Id
        $result.state=$receipt.state
        if ($result.state -cne 'unconfirmed' -or $Action -ceq 'ObserveBrowserHostedOwnerInstallationPause') { return $result }
        $plan=New-AdministratorInstallationPauseLaunchPlan $b $Id $Extension
        try {
            $started=& $Start $plan
            if ($started -is [bool] -and $started) { $result.state='requested' }
        } catch {
            $cause=$_.Exception.GetBaseException()
            if ($cause -is [ComponentModel.Win32Exception] -and $cause.NativeErrorCode -eq 1223) { $result.state='cancelled' }
        }
    } catch { $result.state='unconfirmed' }
    return $result
}

function Invoke-AdministratorInstallationPause($Binding,[string]$Id,[string]$Extension) {
    $b=$Binding
    Assert-AdministratorInstallationPauseParameters 'PauseBrowserHostedOwnerInstallation' `
        @('Action','Archive','ExpectedSha256','BrowserExtensionId','PauseOperationId','ExpectedUserSid','Consent') `
        $b.Digest $Id $Extension $b.Sid 'pause-browser-administrator-installation'
    if ($b.Origin -cne ('chrome-extension://'+$Extension+'/')) { throw 'installation_pause_binding' }
    # Recheck enrollment, origin, profile binding and sealed assets under the same intent gate.
    $verify={
        $verified=Assert-AdministratorControlEndpointBinding $b
        if ($verified -isnot [bool] -or -not $verified) { throw 'installation_pause_binding' }
        return $true
    }
    $receipt=Request-AdministratorOwnerPause $b.Root $b.Digest $b.Sid $Id -VerifyInstallationBinding $verify
    return @{bundleSha256=$b.Digest;operationId=$Id;state=$receipt.state}
}

function New-AdministratorBrowserPauseLaunchPlan($Target,[string]$OperationId,[string]$Snapshot,[bool]$Fence) {
    $exe = [IO.Path]::Combine($Target.System,'WindowsPowerShell\v1.0\powershell.exe')
    $action = if ($Fence) { 'FenceBrowserHostedOwnerPause' } else { 'PauseBrowserHostedOwner' }
    $consent = if ($Fence) { 'fence-browser-administrator-pause' } else { 'pause-browser-administrator-owner' }
    $arguments = '-NoLogo -NoProfile -NonInteractive -File "{0}" -Action {1} -Archive "{2}" -ExpectedSha256 {3} -PauseOperationId {4} -ExpectedUserSid {5} -Consent {6}' -f
        $Target.Stager,$action,$Target.Archive,$Target.Digest,$OperationId,$Target.Sid,$consent
    if (-not $Fence) { $arguments += ' -BrowserPauseTarget ' + $Snapshot }
    $plan = [Diagnostics.ProcessStartInfo]::new($exe,$arguments)
    $plan.UseShellExecute = $true
    $plan.Verb = 'runas'
    $plan.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $plan.WorkingDirectory = $Target.System
    return $plan
}

function Invoke-AdministratorBrowserPauseAction([string]$BrowserAction,[string]$OperationId,[string[]]$BoundParameters,
    [scriptblock]$Verify,[scriptblock]$Start,[string]$Snapshot = '') {
    $check = $BrowserAction -ceq 'CheckBrowserHostedOwnerPause'
    $fence = $BrowserAction -ceq 'RequestBrowserHostedOwnerPauseFence'
    $idValid = $OperationId -cmatch '\A[a-f0-9]{32}\z'
    $idJson = if ($idValid) { '"' + $OperationId + '"' } else { 'null' }
    $receipt = '{{"operationId":{0},"state":"{1}"}}'
    $allowed = @('Action','Archive','ExpectedSha256')
    if (-not $check) { $allowed += 'PauseOperationId' }
    if (-not ($check -or $fence)) { $allowed += 'BrowserPauseTarget' }
    try {
        if (($check -and $OperationId) -or (-not $check -and (-not $idValid -or
            (-not $fence -and $BrowserAction -cne 'RequestBrowserHostedOwnerPause'))) -or
            (($check -or $fence) -and $Snapshot) -or
            (-not ($check -or $fence) -and -not (Test-AdministratorBrowserPauseTarget $Snapshot))) { throw 'input' }
        foreach ($parameter in $BoundParameters) {
            if ($parameter -cnotin $allowed) { throw 'input' }
        }
        $target = & $Verify
        if ($null -eq $target) { throw 'browser_pause_preflight' }
        if (-not $fence) {
            $current = Read-AdministratorBrowserPauseTargetProjection $target.Root $target.Digest $target.Sid
            if (-not (Test-AdministratorBrowserPauseTarget $current)) { throw 'browser_pause_preflight' }
            if ($check) { return ('{{"state":"supported","target":"{0}"}}' -f $current) }
            if ($current -cne $Snapshot) { throw 'browser_pause_target_changed' }
        }
        $plan = New-AdministratorBrowserPauseLaunchPlan $target $OperationId $Snapshot $fence
    } catch {
        if ($check) { return }
        return ($receipt -f $idJson,'unconfirmed')
    }
    $state = 'unconfirmed'
    try {
        $started = & $Start $plan
        if ($started -is [bool] -and $started) { $state = 'requested' }
    } catch {
        $cause = $_.Exception.GetBaseException()
        if ($cause -is [ComponentModel.Win32Exception] -and $cause.NativeErrorCode -eq 1223) { $state = 'cancelled' }
    }
    return ($receipt -f $idJson,$state)
}

function Assert-AdministratorOwnerWake([string]$BundleRoot,[string]$StateRoot,[string]$Digest,
    [string]$Sid,[string]$TunnelId) {
    $vault = $BundleRoot + '.secrets'
    Assert-SealedAcl $StateRoot $true $true
    Assert-SealedAcl $vault $true $true
    foreach ($name in @('work','temp','home','home\AppData','home\AppData\Local','home\AppData\Roaming')) {
        Assert-SealedAcl ([IO.Path]::Combine($StateRoot,$name)) $true $true
    }
    $layout = Get-AdministratorStateLayout $Digest $Sid
    foreach ($name in @('administrator.json','consent.json','startup-imports.mjs')) {
        Assert-AdministratorOwnerBytes ([IO.Path]::Combine($StateRoot,$name)) ([Text.Encoding]::UTF8.GetBytes($layout.files[$name]))
    }
    $proof = Get-AdministratorHostedMetadata $BundleRoot $StateRoot $Digest $Sid $TunnelId
    $owner = Get-AdministratorOwnerMetadata $BundleRoot $StateRoot $Digest $Sid $TunnelId
    Assert-AdministratorOwnerBytes ([IO.Path]::Combine($vault,'binding.json')) $proof.receipt
    Assert-AdministratorOwnerBytes ([IO.Path]::Combine($vault,'tunnel.yaml')) $proof.profile
    Assert-AdministratorOwnerBytes ([IO.Path]::Combine($vault,'owner-tunnel.yaml')) $owner.profile
    Assert-AdministratorOwnerBytes ([IO.Path]::Combine($vault,'owner-activation.json')) $owner.grant
    $key = [IO.Path]::Combine($vault,'runtime.key')
    Assert-SealedAcl $key $false $true
    $size = [IO.FileInfo]::new($key).Length
    if ($size -lt 20 -or $size -gt 4096) { throw 'binding_key_metadata' }
}

function Get-AdministratorOwnerJobType($Zip,[string]$CompilerTemp) {
    $source = $Zip.GetEntry('app/windows-owner-job.cs')
    if (-not $source -or $source.Length -lt 1 -or $source.Length -gt 32768) { throw 'owner_job_source' }
    $stream = $source.Open()
    try {
        $buffer = [byte[]]::new([int]$source.Length)
        $offset = 0
        while ($offset -lt $buffer.Length) {
            $n = $stream.Read($buffer,$offset,$buffer.Length-$offset)
            if (-not $n) { throw 'owner_job_source' }
            $offset += $n
        }
        if ($stream.ReadByte() -ne -1) { throw 'owner_job_source' }
        $code = [Text.UTF8Encoding]::new($false,$true).GetString($buffer)
    } finally { $stream.Dispose() }
    Assert-SealedAcl $CompilerTemp $true $true
    $temps = [CodeDom.Compiler.TempFileCollection]::new($CompilerTemp,$false)
    $compiler = [Microsoft.CSharp.CSharpCodeProvider]::new()
    $previous = @($env:TEMP,$env:TMP)
    $previousCwd = [Environment]::CurrentDirectory
    try {
        $env:TEMP = $env:TMP = $CompilerTemp
        [Environment]::CurrentDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
        $parameters = [CodeDom.Compiler.CompilerParameters]::new([string[]]@([Diagnostics.ProcessStartInfo].Assembly.Location))
        $parameters.GenerateInMemory = $true
        $parameters.TempFiles = $temps
        $compiled = $compiler.CompileAssemblyFromSource($parameters,[string[]]@($code))
        if ($compiled.Errors.HasErrors) { throw 'owner_job_compile' }
        return $compiled.CompiledAssembly.GetType('AgentContinue.WindowsOwnerJob',$true)
    } finally {
        $env:TEMP = $previous[0]; $env:TMP = $previous[1]
        [Environment]::CurrentDirectory = $previousCwd
        $compiler.Dispose(); $temps.Delete()
    }
}

function Read-AdministratorControlPeerSource([IO.Stream]$Archive,[string]$Digest) {
    if ($null -eq $Archive -or -not $Archive.CanRead -or -not $Archive.CanSeek -or $Archive.CanWrite -or
        $Digest -cnotmatch '\A[a-f0-9]{64}\z') { throw 'owner_control_peer_archive' }
    $position=$Archive.Position
    $reader=$null
    try {
        if ($Archive.Length -lt 1 -or $Archive.Length -gt $totalLimit) { throw 'owner_control_peer_archive' }
        $Archive.Position=0
        $hash=[Security.Cryptography.SHA256]::Create()
        try { $observed=To-Hex $hash.ComputeHash($Archive) }
        finally { $hash.Dispose() }
        if (-not [string]::Equals($observed,$Digest,[StringComparison]::Ordinal)) { throw 'owner_control_peer_archive' }
        $Archive.Position=0
        $reader=[IO.Compression.ZipArchive]::new($Archive,[IO.Compression.ZipArchiveMode]::Read,$true)
        if ($reader.Entries.Count -lt 1 -or $reader.Entries.Count -gt $manifestLimit) { throw 'owner_control_peer_source' }
        $found=@($reader.Entries | Where-Object {
            [string]::Equals($_.FullName,'app/windows-browser-peer.cs',[StringComparison]::OrdinalIgnoreCase)
        })
        if ($found.Count -ne 1 -or $found[0].FullName -cne 'app/windows-browser-peer.cs' -or
            $found[0].Length -lt 1 -or $found[0].Length -gt 65536) { throw 'owner_control_peer_source' }
        $entry=$found[0]
        $kind=($entry.ExternalAttributes -shr 16) -band 0xF000
        if (($kind -ne 0 -and $kind -ne 0x8000) -or ($entry.ExternalAttributes -band 0x410)) { throw 'owner_control_peer_source' }
        $stream=$entry.Open()
        try {
            $buffer=[byte[]]::new([int]$entry.Length)
            $offset=0
            while ($offset -lt $buffer.Length) {
                $count=$stream.Read($buffer,$offset,$buffer.Length-$offset)
                if ($count -lt 1) { throw 'owner_control_peer_source' }
                $offset+=$count
            }
            if ($stream.ReadByte() -ne -1) { throw 'owner_control_peer_source' }
            $text=[Text.UTF8Encoding]::new($false,$true).GetString($buffer)
            if ($text.IndexOf([char]0) -ge 0) { throw 'owner_control_peer_source' }
            return ,$buffer
        } finally { $stream.Dispose() }
    } finally {
        if ($null -ne $reader) { $reader.Dispose() }
        $Archive.Position=$position
    }
}

function Get-AdministratorControlPeerType([byte[]]$Source,[string]$CompilerTemp) {
    if ($null -eq $Source -or $Source.Length -lt 1 -or $Source.Length -gt 65536) { throw 'owner_control_peer_source' }
    $code=[Text.UTF8Encoding]::new($false,$true).GetString($Source)
    if ($code.IndexOf([char]0) -ge 0) { throw 'owner_control_peer_source' }
    if ($CompilerTemp -cnotmatch '\A[A-Z]:\\[^\\]' -or
        -not [string]::Equals([IO.Path]::GetFullPath($CompilerTemp),$CompilerTemp,[StringComparison]::Ordinal)) {
        throw 'owner_control_peer_compile_directory'
    }
    Assert-SealedAcl $CompilerTemp $true $true
    $temps=[CodeDom.Compiler.TempFileCollection]::new($CompilerTemp,$false)
    $compiler=[Microsoft.CSharp.CSharpCodeProvider]::new()
    $previous=@($env:TEMP,$env:TMP)
    $previousCwd=[Environment]::CurrentDirectory
    try {
        $env:TEMP=$env:TMP=$CompilerTemp
        [Environment]::CurrentDirectory=[Environment]::SystemDirectory
        $parameters=[CodeDom.Compiler.CompilerParameters]::new([string[]]@(
            [Diagnostics.Process].Assembly.Location,[Linq.Enumerable].Assembly.Location))
        $parameters.GenerateInMemory=$true
        $parameters.TempFiles=$temps
        $compiled=$compiler.CompileAssemblyFromSource($parameters,[string[]]@($code))
        if ($compiled.Errors.HasErrors) { throw 'owner_control_peer_compile' }
        return $compiled.CompiledAssembly.GetType('AgentContinue.WindowsBrowserPeer',$true)
    } finally {
        $env:TEMP=$previous[0]; $env:TMP=$previous[1]
        [Environment]::CurrentDirectory=$previousCwd
        $compiler.Dispose(); $temps.Delete()
    }
}

function Open-AdministratorControlKernelSession([Type]$PeerType,[string]$BundleRoot,[string]$Digest,
    [string]$Origin,[string]$Id,[string]$Control,[string]$Mode,$Target,[uint32]$CallerPid,
    [string]$CallerStarted,[int]$SessionId,[string]$Sid) {
    Assert-AdministratorControlIdentity $Digest $Id $Control
    if ($null -eq $PeerType -or $Mode -cnotin @('control','fence','reconcile') -or
        ($null -ne $Target -and $Target -isnot [string])) { throw 'owner_control_peer_input' }
    $witness=$null
    $returned=$false
    try {
        # PeerType is compiled from the already digest-verified archive; it is not a browser input.
        # PS5.1's direct method binder converts null string arguments to empty strings.
        $method=$PeerType.GetMethod('OpenControlSession',[Reflection.BindingFlags]'Public,Static',$null,
            [Type[]]@([string],[string],[string],[string],[string],[string],[string],
                [uint32],[string],[int],[string]),$null)
        if ($null -eq $method) { throw 'owner_control_peer_witness' }
        $arguments=[object[]]@($BundleRoot,$Digest,$Origin,$Id,$Control,$Mode,$Target,
            $CallerPid,$CallerStarted,$SessionId,$Sid)
        $witness=$method.Invoke($null,$arguments)
        $nested=$PeerType.GetNestedType('ControlSession',[Reflection.BindingFlags]::Public)
        if ($null -eq $witness -or $null -eq $nested -or $witness.GetType() -ne $nested -or
            $witness -isnot [IDisposable] -or $witness.Alive -isnot [bool] -or -not $witness.Alive) {
            throw 'owner_control_peer_witness'
        }
        foreach ($number in @($witness.MediumPid,$witness.HighPid,$witness.SessionId)) {
            if (($number -isnot [uint32] -and $number -isnot [int]) -or $number -lt 1 -or
                $number -gt [int]::MaxValue) { throw 'owner_control_peer_witness' }
        }
        foreach ($tick in @($witness.MediumStarted,$witness.HighStarted)) {
            $parsed=[long]0
            if ($tick -isnot [string] -or $tick -cnotmatch '\A[1-9][0-9]{0,18}\z' -or
                -not [long]::TryParse($tick,[ref]$parsed) -or $parsed -gt [DateTime]::MaxValue.Ticks) {
                throw 'owner_control_peer_witness'
            }
        }
        if ($witness.MediumPid -ne $CallerPid -or $witness.HighPid -eq $CallerPid -or
            $witness.MediumStarted -cne $CallerStarted -or $witness.SessionId -ne $SessionId -or
            $witness.UserSid -isnot [string] -or -not [string]::Equals($witness.UserSid,$Sid,[StringComparison]::Ordinal)) {
            throw 'owner_control_peer_witness'
        }
        $runner=@{pid=[int]$witness.HighPid;started=$witness.HighStarted}
        $session=@{mediumPid=[int]$witness.MediumPid;mediumStarted=$witness.MediumStarted;
            highPid=[int]$witness.HighPid;highStarted=$witness.HighStarted;sessionId=[int]$witness.SessionId;userSid=$witness.UserSid}
        if ($Mode -ceq 'control') {
            $generation=if ($Control -ceq 'revoke') { $null } else { ($Target -split ':')[1] }
            $null=Get-AdministratorControlReservationBytes $Digest $Sid $Origin $Id $Control $Target $generation $runner $session
        }
        if (-not $witness.Alive) { throw 'owner_control_peer_witness' }
        $result=@{Witness=$witness;Runner=$runner;Session=$session}
        $returned=$true
        return $result
    } finally {
        if (-not $returned -and $witness -is [IDisposable]) { $witness.Dispose() }
    }
}

function Read-AdministratorOwnerObservationDocument([string]$File,[string[]]$Fields) {
    Assert-PathType $File $false
    $share = [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete
    $stream = [IO.File]::Open($File,'Open','Read',$share)
    try {
        if ($stream.Length -lt 2 -or $stream.Length -gt 1024) { throw 'observation_size' }
        $bytes = [byte[]]::new([int]$stream.Length)
        $offset = 0
        while ($offset -lt $bytes.Length) {
            $n = $stream.Read($bytes,$offset,$bytes.Length-$offset)
            if (-not $n) { throw 'observation_size' }
            $offset += $n
        }
        if ($stream.ReadByte() -ne -1) { throw 'observation_size' }
        $value = ConvertFrom-Json -InputObject ([Text.UTF8Encoding]::new($false,$true).GetString($bytes))
        if ($value -isnot [pscustomobject] -or @($value.PSObject.Properties.Name).Count -ne $Fields.Count) {
            throw 'observation_fields'
        }
        foreach ($field in $Fields) {
            if ($value.PSObject.Properties.Name -cnotcontains $field) { throw 'observation_fields' }
        }
        return $value
    } finally { $stream.Dispose() }
}

function Read-AdministratorOwnerSample([string]$File,[string]$Generation,[uint32]$RootPid,
    [long]$PreviousSequence,[long]$BootNow) {
    try {
        $row = Read-AdministratorOwnerObservationDocument $File @('version','generation','pid','sequence','bootMs','ready')
        if ($row.version -isnot [int] -or $row.version -ne 1 -or $row.generation -cne $Generation -or
            $row.pid -isnot [int] -or $row.pid -ne $RootPid -or
            ($row.sequence -isnot [int] -and $row.sequence -isnot [long]) -or $row.sequence -le $PreviousSequence -or
            ($row.bootMs -isnot [int] -and $row.bootMs -isnot [long]) -or $row.bootMs -lt 0 -or
            $row.bootMs -gt $BootNow -or $BootNow-$row.bootMs -gt 2200 -or $row.ready -isnot [bool]) { return $null }
        return $row
    } catch { return $null }
}

function Publish-AdministratorOwnerObservation([string]$Directory,[string]$Sid,$Record) {
    $file = [IO.Path]::Combine($Directory,'owner-status.json')
    $temp = [IO.Path]::Combine($Directory,('owner-status-' + [Guid]::NewGuid().ToString('N') + '.tmp'))
    $bytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Record -Compress) + [char]10)
    $stream = Open-SealedNewFile $temp $false $Sid
    try {
        try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        if (Test-AdministratorOwnerAbsent $file) { [IO.File]::Move($temp,$file) }
        else {
            Assert-SealedAcl $file $false $false $Sid
            [IO.File]::Replace($temp,$file,[System.Management.Automation.Language.NullString]::Value)
        }
    } finally {
        if ([IO.File]::Exists($temp)) { [IO.File]::Delete($temp) }
    }
}

function Read-AdministratorOwnerObservation([string]$Directory,[string]$Digest,[string]$Sid) {
    $unknown = @{state='unobserved';generation=$null}
    $broker = $child = $null
    try {
        Assert-SealedAcl $Directory $true $false $Sid
        $file = [IO.Path]::Combine($Directory,'owner-status.json')
        Assert-SealedAcl $file $false $false $Sid
        $row = Read-AdministratorOwnerObservationDocument $file @('version','bundleSha256','generation','brokerPid',
            'brokerStarted','rootPid','rootStarted','observedTicks','state')
        if ($row.version -isnot [int] -or $row.version -ne 1 -or $row.bundleSha256 -cne $Digest -or
            $row.generation -cnotmatch '\A[a-f0-9]{32}\z' -or $row.state -cne 'ready' -or
            $row.brokerPid -isnot [int] -or $row.brokerPid -le 0 -or $row.rootPid -isnot [int] -or $row.rootPid -le 0 -or
            $row.brokerPid -eq $row.rootPid -or $row.brokerStarted -isnot [long] -or $row.rootStarted -isnot [long] -or
            ($row.observedTicks -isnot [long] -and $row.observedTicks -isnot [int]) -or $row.observedTicks -le 0) {
            return $unknown
        }
        $broker = [Diagnostics.Process]::GetProcessById($row.brokerPid)
        $child = [Diagnostics.Process]::GetProcessById($row.rootPid)
        if ($broker.StartTime.ToUniversalTime().Ticks -ne $row.brokerStarted -or
            $child.StartTime.ToUniversalTime().Ticks -ne $row.rootStarted -or $broker.HasExited -or $child.HasExited) {
            return $unknown
        }
        $age = [Diagnostics.Stopwatch]::GetTimestamp() - $row.observedTicks
        if ($age -lt 0 -or $age -gt 2.5*[Diagnostics.Stopwatch]::Frequency) { return $unknown }
        return @{state='ready';generation=$row.generation}
    } catch { return $unknown }
    finally { if ($broker) { $broker.Dispose() }; if ($child) { $child.Dispose() } }
}

function Invoke-AdministratorOwnerJob([Type]$JobType,[Diagnostics.ProcessStartInfo]$Plan,
    [string]$Root,[string]$Vault,[string]$Digest,[string]$Sid,[string]$StatusDirectory = '',
    [switch]$SerializeControl) {
    $generation = [Guid]::NewGuid().ToString('N')
    $leasePath = [IO.Path]::Combine($Vault,'owner-job.lease')
    $gate = $lease = $job = $broker = $rootProcess = $observed = $null
    $release = $false
    try {
        if ($SerializeControl) {
            $gate = Open-AdministratorOwnerControl $Vault
            $null = Read-AdministratorOwnerControlRevision $gate
        }
        # The protected control path can read the generation, but an exclusive
        # recovery inspector still cannot acquire a live lease.
        $lease = Open-SealedNewFile $leasePath $true -Share ([IO.FileShare]::Read)
        $bytes = [Text.Encoding]::UTF8.GetBytes(('{{"version":1,"bundleSha256":"{0}","userSid":"{1}","generation":"{2}"}}' -f $Digest,$Sid,$generation) + [char]10)
        $lease.Write($bytes,0,$bytes.Length); $lease.Flush($true)
        $job = [Activator]::CreateInstance($JobType)
        $cause = 'owner-exited'
        $attempted = $started = $false
        try {
            if (-not (Test-AdministratorOwnerInnerLeasesClear $Root)) {
                $cause = 'wake-denied-by-unsettled-owner'
            } elseif (Test-AdministratorOwnerRunIntent $Root $Vault) {
                if ($gate) {
                    # Idle-to-running-to-idle must not make an old idle snapshot valid again.
                    Write-AdministratorOwnerControlRevision $gate
                    Update-AdministratorBrowserPauseTarget $Root $Vault $Digest $Sid $gate
                }
                if ($StatusDirectory) { Ensure-SealedDirectory $StatusDirectory $false $Sid }
                $Plan.EnvironmentVariables['AC_ADMIN_OWNER_GENERATION'] = $generation
                $attempted = $true
                $job.Start($Plan)
                $started = $true
                if ($gate) { $gate.Dispose(); $gate = $null }
                $sampleFile = [IO.Path]::Combine($Vault,('owner-observation-' + $generation + '.json'))
                $sequence = 0
                if ($StatusDirectory) {
                    try {
                        $broker = [Diagnostics.Process]::GetCurrentProcess()
                        $rootProcess = [Diagnostics.Process]::GetProcessById([int]$job.RootProcessId)
                        $observed = [ordered]@{version=1;bundleSha256=$Digest;generation=$generation;
                            brokerPid=$broker.Id;brokerStarted=$broker.StartTime.ToUniversalTime().Ticks;
                            rootPid=$rootProcess.Id;rootStarted=$rootProcess.StartTime.ToUniversalTime().Ticks;
                            observedTicks=[long]0;state='unobserved'}
                        Publish-AdministratorOwnerObservation $StatusDirectory $Sid $observed
                    } catch { $observed = $null }
                }
                while (-not $job.WaitForRoot(250)) {
                    if (-not (Test-AdministratorOwnerRunIntent $Root $Vault)) {
                        $cause = 'authorization-stopped'
                        if ($observed) {
                            $observed.state = 'unobserved'
                            try { Publish-AdministratorOwnerObservation $StatusDirectory $Sid $observed } catch {}
                        }
                        $null = $job.WaitForRoot(6000)
                        break
                    }
                    if ($observed) {
                        try {
                            $now = [long]$JobType.GetMethod('BootMilliseconds').Invoke($null,$null)
                            $sample = Read-AdministratorOwnerSample $sampleFile $generation $job.RootProcessId $sequence $now
                            if ($sample) {
                                $sequence = $sample.sequence
                                $observed.state = if ($sample.ready) { 'ready' } else { 'unobserved' }
                                $observed.observedTicks = [Diagnostics.Stopwatch]::GetTimestamp() -
                                    [long](($now-$sample.bootMs)*[Diagnostics.Stopwatch]::Frequency/1000)
                                Publish-AdministratorOwnerObservation $StatusDirectory $Sid $observed
                            }
                        } catch { }
                    }
                }
                if ($observed) {
                    $observed.state = 'unobserved'
                    try { Publish-AdministratorOwnerObservation $StatusDirectory $Sid $observed } catch {}
                }
                if (-not (Test-AdministratorOwnerRunIntent $Root $Vault)) { $cause = 'authorization-stopped' }
            } else { $cause = 'wake-denied-by-local-intent' }
        } catch { $cause = 'owner-start-or-wait-failed' }
        if ($gate) { $gate.Dispose(); $gate = $null }
        $drained = $rootExited = $false
        $exitCode = $null
        try {
            $drained = $job.Drain(7000) -and $job.ActiveCount() -eq 0
            if ($started -and $job.WaitForRoot(1000)) {
                $exitCode = $job.RootExitCode()
                $rootExited = $true
            }
        } catch { $drained = $false }
        $innerClear = Test-AdministratorOwnerInnerLeasesClear $Root
        $record = [ordered]@{format='agent-continue-windows-owner-job';version=1;generation=$generation;
            bundleSha256=$Digest;outcome=$cause;jobDrained=$drained;rootCreationAttempted=$attempted;rootExitObserved=$rootExited;
            rootExitCode=$exitCode;innerLeasesClear=$innerClear;tunnelReady='unobserved'}
        $receipt = [IO.Path]::Combine($Vault,('owner-job-' + $generation + '.terminal.json'))
        Write-AdministratorOwnerFile $receipt ([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $record -Compress) + [char]10))
        $release = $drained -and ($rootExited -or -not $attempted) -and $innerClear
        return $record
    } finally {
        if ($gate) { $gate.Dispose() }
        if ($job) { $job.Dispose() }
        if ($broker) { $broker.Dispose() }
        if ($rootProcess) { $rootProcess.Dispose() }
        if ($lease) { $lease.Dispose() }
        if ($release) {
            $settlementGate = $null
            try {
                if ($SerializeControl) { $settlementGate = Open-AdministratorOwnerControl $Vault }
                # Pause must observe either this generation or an already settled idle owner.
                Assert-SealedAcl $leasePath $false $true
                [IO.File]::Delete($leasePath)
                if ($settlementGate) { Update-AdministratorBrowserPauseTarget $Root $Vault $Digest $Sid $settlementGate }
                if ($settlementGate -and $StatusDirectory) {
                    try { Complete-AdministratorOwnerPause $Root $Vault $StatusDirectory $Digest $Sid $generation $settlementGate }
                    catch { # The Job settled, but an unverified pause receipt must not claim it.
                    }
                }
            } finally { if ($settlementGate) { $settlementGate.Dispose() } }
        }
    }
}

function Assert-AdministratorOwnerControlIdentity([string]$BundleRoot, [string]$Digest, [string]$Sid) {
    Assert-SealedAcl $BundleRoot $true
    Assert-SealedAcl ([IO.Path]::Combine($BundleRoot,'app','windows-admin-owner.mjs')) $false
    $root = $BundleRoot + '.state'
    $vault = $BundleRoot + '.secrets'
    Assert-SealedAcl $root $true $true
    Assert-SealedAcl $vault $true $true
    $identity = [IO.Path]::Combine($root,'administrator.json')
    Assert-SealedAcl $identity $false $true
    $expected = (Get-AdministratorStateLayout $Digest $Sid).files['administrator.json']
    if ([IO.FileInfo]::new($identity).Length -ne [Text.Encoding]::UTF8.GetByteCount($expected) -or
        [IO.File]::ReadAllText($identity) -cne $expected) { throw 'owner_revocation_identity' }
}

function Test-AdministratorControlFields($Value,[string[]]$Fields) {
    if ($null -eq $Value) { return $false }
    $names = if ($Value -is [Collections.IDictionary]) { @($Value.Keys) }
        elseif ($Value -is [pscustomobject]) { @($Value.PSObject.Properties.Name) }
        else { return $false }
    if ($names.Count -ne $Fields.Count) { return $false }
    foreach ($field in $Fields) { if ([Array]::IndexOf($names,$field) -lt 0) { return $false } }
    return $true
}

function Assert-AdministratorControlIdentity([string]$Digest,[string]$Id,[string]$Control) {
    if ($Digest -cnotmatch '\A[a-f0-9]{64}\z' -or $Id -cnotmatch '\A[a-f0-9]{32}\z' -or
        $Control -cnotin @('connect','resume-saved','revoke')) { throw 'owner_control_identity' }
}

function Get-AdministratorControlReservationBytes([string]$Digest,[string]$Sid,[string]$Origin,[string]$Id,
    [string]$Control,$Target,$Generation,$Runner,$Session) {
    Assert-AdministratorControlIdentity $Digest $Id $Control
    if ($Sid -cnotmatch '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z' -or
        $Origin -cnotmatch '\Achrome-extension://[a-p]{32}/\z' -or
        -not (Test-AdministratorControlFields $Runner @('pid','started')) -or
        -not (Test-AdministratorControlFields $Session @('mediumPid','mediumStarted','highPid','highStarted','sessionId','userSid'))) {
        throw 'owner_control_reservation_identity'
    }
    if ($Control -ceq 'revoke') {
        if ($null -ne $Target -or ($null -ne $Generation -and
            ($Generation -isnot [string] -or $Generation -cnotmatch '\A(?:[a-f0-9]{32}|idle)\z'))) { throw 'owner_control_reservation_target' }
    } elseif ($Target -isnot [string] -or -not (Test-AdministratorBrowserPauseTarget $Target) -or
        $Generation -isnot [string] -or $Generation -cnotmatch '\A(?:[a-f0-9]{32}|idle)\z') { throw 'owner_control_reservation_target' }
    foreach ($number in @($Runner.pid,$Session.mediumPid,$Session.highPid,$Session.sessionId)) {
        if (($number -isnot [int] -and $number -isnot [long]) -or $number -lt 1 -or $number -gt [int]::MaxValue) {
            throw 'owner_control_reservation_session'
        }
    }
    foreach ($tick in @($Runner.started,$Session.mediumStarted,$Session.highStarted)) {
        $parsed = [long]0
        if ($tick -isnot [string] -or $tick -cnotmatch '\A[1-9][0-9]{0,18}\z' -or
            -not [long]::TryParse($tick,[ref]$parsed) -or $parsed -gt [DateTime]::MaxValue.Ticks) { throw 'owner_control_reservation_session' }
    }
    if ($Runner.pid -ne $Session.highPid -or $Runner.started -cne $Session.highStarted -or
        $Session.mediumPid -eq $Session.highPid -or $Session.userSid -isnot [string] -or
        -not [string]::Equals($Session.userSid,$Sid,[StringComparison]::Ordinal)) { throw 'owner_control_reservation_session' }
    # This serializes a validated pair; the caller must acquire actual kernel identity evidence.
    $row = [ordered]@{version=1;kind='reservation';bundleSha256=$Digest;userSid=$Sid;origin=$Origin;
        operationId=$Id;control=$Control;target=$Target;observedGeneration=$Generation;
        runnerIdentity=[ordered]@{pid=$Runner.pid;started=$Runner.started};
        sessionEvidence=[ordered]@{mediumPid=$Session.mediumPid;mediumStarted=$Session.mediumStarted;
            highPid=$Session.highPid;highStarted=$Session.highStarted;sessionId=$Session.sessionId;userSid=$Session.userSid}}
    return ,([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $row -Depth 5 -Compress) + [char]10))
}

function Get-AdministratorControlTombstoneBytes([string]$Digest,[string]$Sid,[string]$Origin,[string]$Id,[string]$Control) {
    Assert-AdministratorControlIdentity $Digest $Id $Control
    if ($Sid -cnotmatch '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z' -or
        $Origin -cnotmatch '\Achrome-extension://[a-p]{32}/\z') { throw 'owner_control_tombstone_identity' }
    $row = [ordered]@{version=1;kind='control-tombstone';bundleSha256=$Digest;userSid=$Sid;origin=$Origin;
        operationId=$Id;control=$Control;targetKnowledge='unknown';target=$null}
    return ,([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $row -Compress) + [char]10))
}

function Get-AdministratorControlHandoffId([string]$Digest,[string]$Id,[string]$Control,[string]$Mode,
    [int]$MediumPid,[string]$MediumStarted,[int]$SessionId,[string]$Sid,[int]$HighPid,[string]$HighStarted) {
    Assert-AdministratorControlIdentity $Digest $Id $Control
    $ticks=[long]0
    if ([Array]::IndexOf(@('connect','resume-saved','revoke'),$Control) -lt 0 -or
        [Array]::IndexOf(@('control','fence','reconcile'),$Mode) -lt 0 -or $MediumPid -lt 1 -or $HighPid -lt 1 -or $SessionId -lt 1 -or
        $MediumStarted -cnotmatch '\A[1-9][0-9]{0,18}\z' -or -not [long]::TryParse($MediumStarted,[ref]$ticks) -or
        $ticks -gt [DateTime]::MaxValue.Ticks -or $Sid -cnotmatch '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z' -or
        -not [string]::Equals(([Security.Principal.SecurityIdentifier]::new($Sid)).Value,$Sid,[StringComparison]::Ordinal)) {
        throw 'owner_control_handoff_identity'
    }
    $highTicks=[long]0
    if ($HighStarted -cnotmatch '\A[1-9][0-9]{0,18}\z' -or -not [long]::TryParse($HighStarted,[ref]$highTicks) -or
        $highTicks -gt [DateTime]::MaxValue.Ticks -or $HighPid -eq $MediumPid -or $highTicks -le $ticks) {
        throw 'owner_control_handoff_identity'
    }
    $fields=@($Digest,$Id,$Control,$Mode,$MediumPid.ToString([Globalization.CultureInfo]::InvariantCulture),
        $MediumStarted,$SessionId.ToString([Globalization.CultureInfo]::InvariantCulture),$Sid,
        $HighPid.ToString([Globalization.CultureInfo]::InvariantCulture),$HighStarted)
    $hash=[Security.Cryptography.SHA256]::Create()
    try { return (To-Hex $hash.ComputeHash([Text.Encoding]::ASCII.GetBytes($fields -join '|'))).Substring(0,32) }
    finally { $hash.Dispose() }
}

function Get-AdministratorControlHandoffAckBytes([string]$Digest,[string]$Id,[string]$Control,[string]$Mode,[string]$HandoffId) {
    Assert-AdministratorControlIdentity $Digest $Id $Control
    if ([Array]::IndexOf(@('connect','resume-saved','revoke'),$Control) -lt 0 -or
        [Array]::IndexOf(@('control','fence','reconcile'),$Mode) -lt 0 -or $HandoffId -cnotmatch '\A[a-f0-9]{32}\z') {
        throw 'owner_control_handoff_identity'
    }
    $row=[ordered]@{version=1;kind='control-handoff';bundleSha256=$Digest;operationId=$Id;
        control=$Control;mode=$Mode;handoffId=$HandoffId;state='validated'}
    return ,([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $row -Compress)+[char]10))
}

function Get-AdministratorControlHandoffBytes([string]$Digest,[string]$Sid,[string]$Origin,[string]$Id,
    [string]$Control,[string]$Mode,$Runner,$Session) {
    # Reuse only the closed pair schema. No neutral reservation is persisted.
    $null=Get-AdministratorControlReservationBytes $Digest $Sid $Origin $Id 'revoke' $null $null $Runner $Session
    $handoffId=Get-AdministratorControlHandoffId $Digest $Id $Control $Mode $Session.mediumPid $Session.mediumStarted $Session.sessionId $Sid $Session.highPid $Session.highStarted
    $row=[ordered]@{version=1;kind='control-peer';bundleSha256=$Digest;userSid=$Sid;origin=$Origin;
        operationId=$Id;control=$Control;mode=$Mode;handoffId=$handoffId;
        runnerIdentity=[ordered]@{pid=$Runner.pid;started=$Runner.started};
        sessionEvidence=[ordered]@{mediumPid=$Session.mediumPid;mediumStarted=$Session.mediumStarted;
            highPid=$Session.highPid;highStarted=$Session.highStarted;sessionId=$Session.sessionId;userSid=$Session.userSid}}
    return @{HandoffId=$handoffId;Private=[Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $row -Depth 5 -Compress)+[char]10);
        Public=(Get-AdministratorControlHandoffAckBytes $Digest $Id $Control $Mode $handoffId)}
}

function Read-AdministratorControlHandoff([string]$Status,[string]$Digest,[string]$Sid,[string]$Id,
    [string]$Control,[string]$Mode,[string]$HandoffId) {
    try {
        $expected=Get-AdministratorControlHandoffAckBytes $Digest $Id $Control $Mode $HandoffId
        $file=[IO.Path]::Combine($Status,('control-'+$HandoffId+'.handoff.json'))
        $actual=Read-AdministratorControlBytes $file $false $Sid
        return [string]::Equals([Convert]::ToBase64String($actual),[Convert]::ToBase64String($expected),[StringComparison]::Ordinal)
    } catch { return $false }
}

function Publish-AdministratorControlHandoff([string]$BundleRoot,[string]$Digest,[string]$Sid,[string]$Origin,
    [string]$Id,[string]$Control,[string]$Mode,$Runner,$Session,[scriptblock]$PeerAlive) {
    if (-not $PeerAlive) { throw 'owner_control_handoff_peer' }
    $bytes=Get-AdministratorControlHandoffBytes $Digest $Sid $Origin $Id $Control $Mode $Runner $Session
    $live=& $PeerAlive
    if ($live -isnot [bool] -or -not $live) { throw 'owner_control_handoff_peer' }
    Publish-AdministratorControlBytes ($BundleRoot+'.secrets') ('control-'+$bytes.HandoffId+'.peer.json') $bytes.Private $true $Sid
    $live=& $PeerAlive
    if ($live -isnot [bool] -or -not $live) { throw 'owner_control_handoff_peer' }
    # Admission linearizes at this final held-kernel check, before public visibility.
    # A medium that sees the acknowledgement may exit; do not sample it afterwards.
    Publish-AdministratorControlBytes ($BundleRoot+'.status') ('control-'+$bytes.HandoffId+'.handoff.json') $bytes.Public $false $Sid
    if (-not (Read-AdministratorControlHandoff ($BundleRoot+'.status') $Digest $Sid $Id $Control $Mode $bytes.HandoffId)) {
        throw 'owner_control_handoff_readback'
    }
    return $bytes.HandoffId
}

function Get-AdministratorControlPhaseBytes([string]$Digest,[string]$Id,[string]$Control,[string]$Phase,$Revision) {
    Assert-AdministratorControlIdentity $Digest $Id $Control
    if ($Phase -cnotin @('intent-write-started','launch-attempted','recovery-pause-started') -or
        ($Control -ceq 'revoke' -and $Phase -ceq 'launch-attempted') -or
        ($Phase -ceq 'recovery-pause-started' -and ($Revision -isnot [string] -or $Revision -cnotmatch '\A[a-f0-9]{32}\z')) -or
        ($Phase -cne 'recovery-pause-started' -and $null -ne $Revision)) { throw 'owner_control_phase' }
    $row = [ordered]@{version=1;bundleSha256=$Digest;operationId=$Id;control=$Control;phase=$Phase;revision=$Revision}
    return ,([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $row -Compress) + [char]10))
}

function Get-AdministratorControlProgressBytes([string]$Digest,[string]$Id,[string]$Control,[string]$Phase,$Verified,$Total) {
    Assert-AdministratorControlIdentity $Digest $Id $Control
    if ($Phase -cnotin @('verifying-full','verifying-control','waiting-owner','waiting-stop','settled')) { throw 'owner_control_progress' }
    if ($null -ne $Verified -or $null -ne $Total) {
        if ($Phase -cne 'verifying-full' -or ($Verified -isnot [int] -and $Verified -isnot [long]) -or
            ($Total -isnot [int] -and $Total -isnot [long]) -or $Verified -lt 0 -or $Total -lt $Verified -or $Total -gt 40000) {
            throw 'owner_control_progress'
        }
    }
    $row = [ordered]@{version=1;bundleSha256=$Digest;operationId=$Id;control=$Control;phase=$Phase;verifiedFiles=$Verified;totalFiles=$Total}
    return ,([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $row -Compress) + [char]10))
}

function Get-AdministratorControlStates {
    return @('reserved','intent-saved','launch-requested','launch-unconfirmed','revocation-recorded','stopped',
        'superseded','rejected','fenced','abandoned','recovered-paused')
}

function Resolve-AdministratorControlStates([string]$Control,[string[]]$States) {
    if ($Control -cnotin @('connect','resume-saved','revoke')) { throw 'owner_control_identity' }
    $found = @{}
    foreach ($state in $States) {
        if ($state -cnotin (Get-AdministratorControlStates) -or $found.ContainsKey($state)) { throw 'owner_control_history' }
        $found[$state]=$true
    }
    if ($found.Count -eq 0) { return 'unconfirmed' }
    if ($found['fenced']) {
        if ($found.Count -ne 1) { throw 'owner_control_history' }
        return 'fenced'
    }
    if (-not $found['reserved']) { throw 'owner_control_history' }
    if ($Control -ceq 'revoke') {
        foreach ($state in @('intent-saved','launch-requested','launch-unconfirmed','recovered-paused','abandoned','rejected','superseded')) {
            if ($found[$state]) { throw 'owner_control_history' }
        }
        if ($found['stopped'] -and -not $found['revocation-recorded']) { throw 'owner_control_history' }
        if ($found['stopped']) { return 'stopped' }
        if ($found['revocation-recorded']) { return 'revocation-recorded' }
        return 'reserved'
    }
    if ($found['revocation-recorded'] -or $found['stopped'] -or
        ($found['launch-requested'] -and $found['launch-unconfirmed']) -or
        (($found['launch-requested'] -or $found['launch-unconfirmed']) -and -not $found['intent-saved'])) { throw 'owner_control_history' }
    $ends = @(@('abandoned','rejected','superseded','recovered-paused') | Where-Object { $found[$_] })
    if ($ends.Count -gt 1 -or ($ends.Count -and $found['launch-requested']) -or
        (($found['abandoned'] -or $found['rejected']) -and ($found['intent-saved'] -or $found['launch-unconfirmed']))) {
        throw 'owner_control_history'
    }
    if ($ends.Count) { return $ends[0] }
    if ($found['launch-requested']) { return 'launch-requested' }
    if ($found['launch-unconfirmed']) { return 'launch-unconfirmed' }
    if ($found['intent-saved']) { return 'intent-saved' }
    return 'reserved'
}

function Get-AdministratorControlReceiptBytes([string]$Digest,[string]$Id,[string]$Control,[string]$State) {
    Assert-AdministratorControlIdentity $Digest $Id $Control
    if ($State -cnotin (Get-AdministratorControlStates) -or
        ($Control -ceq 'revoke' -and $State -cnotin @('reserved','fenced','revocation-recorded','stopped')) -or
        ($Control -cne 'revoke' -and $State -cin @('revocation-recorded','stopped'))) { throw 'owner_control_receipt_state' }
    return ,([Text.Encoding]::ASCII.GetBytes(
        ('{{"version":1,"bundleSha256":"{0}","operationId":"{1}","control":"{2}","state":"{3}"}}' -f $Digest,$Id,$Control,$State) + [char]10))
}

function Read-AdministratorControlBytes([string]$File,[bool]$Private,[string]$Sid,[int]$Limit = 2048) {
    Assert-SealedAcl $File $false $Private $Sid
    $stream = [IO.File]::Open($File,'Open','Read',([IO.FileShare]::Read -bor [IO.FileShare]::Delete))
    try {
        if ($stream.Length -lt 1 -or $stream.Length -gt $Limit) { throw 'owner_control_document_size' }
        $buffer = [byte[]]::new([int]$stream.Length)
        $count = 0
        while ($count -lt $buffer.Length) {
            $n = $stream.Read($buffer,$count,$buffer.Length-$count)
            if ($n -lt 1) { throw 'owner_control_document_size' }
            $count += $n
        }
        if ($stream.ReadByte() -ne -1) { throw 'owner_control_document_size' }
        return ,$buffer
    } finally { $stream.Dispose() }
}

function Publish-AdministratorControlBytes([string]$Directory,[string]$Name,[byte[]]$Bytes,[bool]$Private,[string]$Sid) {
    if ($Name -cnotmatch '\Acontrol-[a-f0-9]{32}\.[a-z-]+\.json\z' -or $Bytes.Length -lt 1 -or $Bytes.Length -gt 2048) {
        throw 'owner_control_document_input'
    }
    Assert-SealedAcl $Directory $true $Private $Sid
    $file = [IO.Path]::Combine($Directory,$Name)
    $expected = [Convert]::ToBase64String($Bytes)
    if (-not (Test-AdministratorOwnerAbsent $file)) {
        if ([Convert]::ToBase64String((Read-AdministratorControlBytes $file $Private $Sid)) -cne $expected) {
            throw 'owner_control_document_collision'
        }
        return
    }
    $temp = [IO.Path]::Combine($Directory,('control-publish-'+[Guid]::NewGuid().ToString('N')+'.tmp'))
    $stream = Open-SealedNewFile $temp $Private $Sid
    try {
        try { $stream.Write($Bytes,0,$Bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        [IO.File]::Move($temp,$file)
        if ([Convert]::ToBase64String((Read-AdministratorControlBytes $file $Private $Sid)) -cne $expected) {
            throw 'owner_control_document_readback'
        }
    } finally {
        if ([IO.File]::Exists($temp)) { Assert-SealedAcl $temp $false $Private $Sid; [IO.File]::Delete($temp) }
    }
}

function Read-AdministratorControlReceipt([string]$Directory,[string]$Digest,[string]$Sid,[string]$Id,[string]$Control) {
    $result = @{bundleSha256=$Digest;operationId=$Id;control=$Control;state='unconfirmed';progress=$null}
    try {
        Assert-AdministratorControlIdentity $Digest $Id $Control
        Assert-SealedAcl $Directory $true $false $Sid
        $states = @()
        foreach ($state in (Get-AdministratorControlStates)) {
            $file = [IO.Path]::Combine($Directory,('control-'+$Id+'.'+$state+'.json'))
            if (Test-AdministratorOwnerAbsent $file) { continue }
            $expected = Get-AdministratorControlReceiptBytes $Digest $Id $Control $state
            $actual = Read-AdministratorControlBytes $file $false $Sid
            if ([Convert]::ToBase64String($actual) -cne [Convert]::ToBase64String($expected)) { return $result }
            $states += $state
        }
        $result.state = Resolve-AdministratorControlStates $Control $states
        if ($result.state -cne 'unconfirmed') { $result.progress = Read-AdministratorControlProgress $Directory $Digest $Sid $Id $Control }
    } catch { $result.state = 'unconfirmed' }
    return $result
}

function Assert-AdministratorControlSupportParameters([string]$Action,[string[]]$BoundParameters,
    [string]$Digest,[string]$Control) {
    if (-not [string]::Equals($Action,'CheckBrowserHostedOwnerControl',[StringComparison]::Ordinal) -or
        $Digest -cnotmatch '\A[a-f0-9]{64}\z' -or
        [Array]::IndexOf(@('connect','resume-saved','revoke'),$Control) -lt 0) { throw 'owner_control_support_input' }
    $required=@('Action','Archive','ExpectedSha256','ControlKind')
    if ($BoundParameters.Count -ne $required.Count) { throw 'owner_control_support_input' }
    foreach ($name in $required) {
        if ([Array]::IndexOf($BoundParameters,$name) -lt 0) { throw 'owner_control_support_input' }
    }
}

function Get-AdministratorControlSupportProjectionBytes([string]$Digest,[string]$Target,[string]$OwnerState) {
    if ($Digest -cnotmatch '\A[a-f0-9]{64}\z' -or -not (Test-AdministratorBrowserPauseTarget $Target) -or
        [Array]::IndexOf(@('paused','running','revoked','unobserved'),$OwnerState) -lt 0) { throw 'owner_control_support_projection' }
    return ,([Text.Encoding]::ASCII.GetBytes(
        ('{{"version":1,"bundleSha256":"{0}","target":"{1}","ownerState":"{2}"}}' -f $Digest,$Target,$OwnerState)+[char]10))
}

function Read-AdministratorBrowserControlSupportProjection([string]$BundleRoot,[string]$Digest,[string]$Sid) {
    $directory=$BundleRoot+'.status'
    Assert-SealedAcl $directory $true $false $Sid
    $file=[IO.Path]::Combine($directory,'control-owner.json')
    Assert-SealedAcl $file $false $false $Sid
    $stream=[IO.File]::Open($file,'Open','Read',([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    try {
        if ($stream.Length -lt 1 -or $stream.Length -gt 256) { throw 'owner_control_support_projection' }
        $reader=[IO.StreamReader]::new($stream,[Text.Encoding]::ASCII,$false)
        try { $text=$reader.ReadToEnd() } finally { $reader.Dispose() }
        if ($text -cnotmatch '\A\{"version":1,"bundleSha256":"(?<bundle>[a-f0-9]{64})","target":"(?<target>[a-f0-9]{32}:(?:[a-f0-9]{32}|idle))","ownerState":"(?<owner>paused|running|revoked|unobserved)"\}\n\z' -or
            $Matches.bundle -cne $Digest) { throw 'owner_control_support_projection' }
        return @{bundleSha256=$Matches.bundle;target=$Matches.target;ownerState=$Matches.owner}
    } finally { $stream.Dispose() }
}

function Read-AdministratorBrowserControlSupport([string]$Action,[string]$Digest,[string]$Control,
    [string[]]$BoundParameters,[scriptblock]$Verify) {
    Assert-AdministratorControlSupportParameters $Action $BoundParameters $Digest $Control
    $unknown=@{control=$Control;state='unconfirmed';bundleSha256=$null;target=$null;ownerState='unobserved';eligible=$false}
    try {
        if (-not $Verify) { return $unknown }
        $binding=& $Verify
        if ($null -eq $binding -or $binding.Digest -isnot [string] -or $binding.Digest -cne $Digest -or
            $binding.Sid -isnot [string] -or $binding.Sid -cnotmatch '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z' -or
            $binding.Root -isnot [string] -or $binding.Root -cnotmatch '\A[A-Z]:\\[^\\]' -or
            $binding.Root -cne [IO.Path]::GetFullPath($binding.Root) -or
            [IO.Path]::GetFileName($binding.Root) -cne $Digest.Substring(0,24)) { return $unknown }
        $state='unobserved';$snapshot=$null
        try {
            $before=Read-AdministratorBrowserPauseTargetProjection $binding.Root $Digest $binding.Sid
            $row=Read-AdministratorBrowserControlSupportProjection $binding.Root $Digest $binding.Sid
            $after=Read-AdministratorBrowserPauseTargetProjection $binding.Root $Digest $binding.Sid
            if ($before -isnot [string] -or -not (Test-AdministratorBrowserPauseTarget $before) -or
                $after -isnot [string] -or $after -cne $before -or
                -not (Test-AdministratorControlFields $row @('bundleSha256','target','ownerState')) -or
                $row.bundleSha256 -isnot [string] -or $row.bundleSha256 -cne $Digest -or
                $row.target -isnot [string] -or $row.target -cne $before -or $row.ownerState -isnot [string] -or
                [Array]::IndexOf(@('paused','running','revoked','unobserved'),$row.ownerState) -lt 0) { throw 'owner_control_support_projection' }
            $state=$row.ownerState;$snapshot=$before
        } catch { $state='unobserved';$snapshot=$null }
        # Advisory saved intent only. High admission rechecks private denial and the live tuple.
        $eligible=$Control -ceq 'revoke' -or ($null -ne $snapshot -and $snapshot.EndsWith(':idle',[StringComparison]::Ordinal) -and
            (($Control -ceq 'connect' -and $state -ceq 'paused') -or ($Control -ceq 'resume-saved' -and $state -ceq 'running')))
        return @{control=$Control;state='supported';bundleSha256=$Digest;ownerState=$state;eligible=[bool]$eligible;
            target=$(if ($eligible -and $Control -cne 'revoke') { $snapshot } else { $null })}
    } catch { return $unknown }
}

function Assert-AdministratorControlObservationParameters([string]$Action,[string[]]$BoundParameters,
    [string]$Digest,[string]$Id,[string]$Control) {
    if (-not [string]::Equals($Action,'ObserveHostedOwnerControl',[StringComparison]::Ordinal)) { throw 'owner_control_observation_input' }
    $required=@('Action','Archive','ExpectedSha256','ControlKind','ControlOperationId')
    if ($BoundParameters.Count -ne $required.Count) { throw 'owner_control_observation_input' }
    foreach ($name in $required) {
        if ([Array]::IndexOf($BoundParameters,$name) -lt 0) { throw 'owner_control_observation_input' }
    }
    if ([Array]::IndexOf(@('connect','resume-saved','revoke'),$Control) -lt 0) { throw 'owner_control_observation_input' }
    Assert-AdministratorControlIdentity $Digest $Id $Control
}

function Read-AdministratorBrowserControlStatus([string]$Digest,[string]$Id,[string]$Control,
    [string[]]$BoundParameters,[scriptblock]$Verify) {
    Assert-AdministratorControlObservationParameters 'ObserveHostedOwnerControl' $BoundParameters $Digest $Id $Control
    $unknown=@{bundleSha256=$Digest;operationId=$Id;control=$Control;state='unconfirmed';progress=$null}
    try {
        if (-not $Verify) { throw 'owner_control_observation_binding' }
        $target=& $Verify
        if ($null -eq $target -or $target.Digest -isnot [string] -or
            -not [string]::Equals($target.Digest,$Digest,[StringComparison]::Ordinal) -or
            $target.Sid -isnot [string] -or $target.Sid -cnotmatch '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z' -or
            $target.Root -isnot [string] -or $target.Root -cnotmatch '\A[A-Z]:\\[^\\]' -or
            -not [string]::Equals([IO.Path]::GetFullPath($target.Root),$target.Root,[StringComparison]::Ordinal) -or
            -not [string]::Equals([IO.Path]::GetFileName($target.Root),$Digest.Substring(0,24),[StringComparison]::Ordinal)) {
            throw 'owner_control_observation_binding'
        }
        $row=Read-AdministratorControlReceipt ($target.Root+'.status') $Digest $target.Sid $Id $Control
        if (-not (Test-AdministratorControlFields $row @('bundleSha256','operationId','control','state','progress')) -or
            $row.bundleSha256 -isnot [string] -or $row.operationId -isnot [string] -or $row.control -isnot [string] -or
            -not [string]::Equals($row.bundleSha256,$Digest,[StringComparison]::Ordinal) -or
            -not [string]::Equals($row.operationId,$Id,[StringComparison]::Ordinal) -or
            -not [string]::Equals($row.control,$Control,[StringComparison]::Ordinal) -or
            $row.state -isnot [string] -or [Array]::IndexOf((Get-AdministratorControlStates),$row.state) -lt 0) { return $unknown }
        $null=Get-AdministratorControlReceiptBytes $Digest $Id $Control $row.state
        $progress=$null
        if ($null -ne $row.progress) {
            if (-not (Test-AdministratorControlFields $row.progress @('phase','verifiedFiles','totalFiles')) -or
                $row.progress.phase -isnot [string] -or
                [Array]::IndexOf(@('verifying-full','verifying-control','waiting-owner','waiting-stop','settled'),$row.progress.phase) -lt 0) { return $unknown }
            $null=Get-AdministratorControlProgressBytes $Digest $Id $Control $row.progress.phase $row.progress.verifiedFiles $row.progress.totalFiles
            $progress=@{phase=$row.progress.phase;verifiedFiles=$row.progress.verifiedFiles;totalFiles=$row.progress.totalFiles}
        }
        return @{bundleSha256=$Digest;operationId=$Id;control=$Control;state=$row.state;progress=$progress}
    } catch { return $unknown }
}

function Publish-AdministratorControlReceipt([string]$Directory,[string]$Digest,[string]$Sid,[string]$Id,
    [string]$Control,[string]$State) {
    $bytes = Get-AdministratorControlReceiptBytes $Digest $Id $Control $State
    Assert-SealedAcl $Directory $true $false $Sid
    $states = @()
    foreach ($prior in (Get-AdministratorControlStates)) {
        $file = [IO.Path]::Combine($Directory,('control-'+$Id+'.'+$prior+'.json'))
        if (Test-AdministratorOwnerAbsent $file) { continue }
        $expected = Get-AdministratorControlReceiptBytes $Digest $Id $Control $prior
        if ([Convert]::ToBase64String((Read-AdministratorControlBytes $file $false $Sid)) -cne
            [Convert]::ToBase64String($expected)) { throw 'owner_control_history' }
        $states += $prior
    }
    $previous = Resolve-AdministratorControlStates $Control $states
    if ($State -cin $states) { return }
    if ($previous -cin @('launch-requested','stopped','superseded','rejected','fenced','abandoned','recovered-paused') -or
        ($previous -ceq 'revocation-recorded' -and $State -cne 'stopped')) { throw 'owner_control_receipt_terminal' }
    $null = Resolve-AdministratorControlStates $Control @($states + $State)
    Publish-AdministratorControlBytes $Directory ('control-'+$Id+'.'+$State+'.json') $bytes $false $Sid
}

function Open-AdministratorControlExecution([string]$Vault,[string]$Id) {
    if ($Id -cnotmatch '\A[a-f0-9]{32}\z') { throw 'owner_control_identity' }
    Assert-SealedAcl $Vault $true $true
    $file = [IO.Path]::Combine($Vault,('control-'+$Id+'.execution.lock'))
    if (Test-AdministratorOwnerAbsent $file) {
        $stream = $null
        try {
            $stream = Open-SealedNewFile $file $true $usersSid ([IO.FileShare]::None)
            $stream.Flush($true)
            return $stream
        } catch {
            if ($stream) { $stream.Dispose(); throw }
            $cause = $_.Exception.GetBaseException()
            if ($cause -isnot [IO.IOException] -or ($cause.HResult -band 65535) -notin @(80,183)) { throw }
        }
    }
    Assert-SealedAcl $file $false $true
    # A stale pathname is not a live lease; only this exclusive kernel handle is.
    return [IO.File]::Open($file,'Open','ReadWrite','None')
}

function Test-AdministratorControlExecutionBusy([Exception]$Error) {
    $cause=$Error.GetBaseException()
    return $cause -is [IO.IOException] -and ($cause.HResult -band 65535) -in @(32,33)
}

function Invoke-AdministratorControlBusyReadback([string]$BundleRoot,[string]$Digest,[string]$Sid,[string]$Origin,
    [string]$Id,[string]$Control,$Target,[switch]$CheckTarget,[scriptblock]$VerifyBinding,[scriptblock]$Handoff) {
    $vault=$BundleRoot+'.secrets'; $status=$BundleRoot+'.status'
    $gate=Open-AdministratorOwnerControl $vault
    try {
        $null=& $VerifyBinding
        if (-not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($vault,('pause-'+$Id+'.reserved.json'))))) { throw 'owner_control_collision' }
        $prior=Read-AdministratorControlRecord $vault $Digest $Sid $Origin $Id $Control
        $tomb=Read-AdministratorControlRecord $vault $Digest $Sid $Origin $Id $Control -Tombstone
        if (($prior -and $tomb) -or (-not $prior -and -not $tomb)) { throw 'owner_control_busy_unobserved' }
        if ($CheckTarget -and $prior -and $prior.target -cne $Target) { throw 'owner_control_collision' }
        $receipt=Read-AdministratorControlReceipt $status $Digest $Sid $Id $Control
        $null=& $Handoff
        return $receipt
    } finally { $gate.Dispose() }
}

function Read-AdministratorControlRecord([string]$Vault,[string]$Digest,[string]$Sid,[string]$Origin,[string]$Id,
    [string]$Control,[switch]$Tombstone) {
    Assert-AdministratorControlIdentity $Digest $Id $Control
    Assert-SealedAcl $Vault $true $true
    $suffix = if ($Tombstone) { 'tombstone' } else { 'reserved' }
    $file = [IO.Path]::Combine($Vault,('control-'+$Id+'.'+$suffix+'.json'))
    if (Test-AdministratorOwnerAbsent $file) { return $null }
    $bytes = Read-AdministratorControlBytes $file $true $Sid
    $row = ConvertFrom-Json -InputObject ([Text.UTF8Encoding]::new($false,$true).GetString($bytes))
    $fields = @('version','kind','bundleSha256','userSid','origin','operationId','control')
    $fields += if ($Tombstone) { @('targetKnowledge','target') } else { @('target','observedGeneration','runnerIdentity','sessionEvidence') }
    if (-not (Test-AdministratorControlFields $row $fields) -or
        ($row.version -isnot [int] -and $row.version -isnot [long]) -or $row.version -ne 1 -or
        $row.bundleSha256 -cne $Digest -or $row.userSid -cne $Sid -or $row.origin -cne $Origin -or
        $row.operationId -cne $Id -or $row.control -cne $Control) { throw 'owner_control_record' }
    $expected = if ($Tombstone) {
        if ($row.kind -cne 'control-tombstone' -or $row.targetKnowledge -cne 'unknown' -or $null -ne $row.target) { throw 'owner_control_record' }
        Get-AdministratorControlTombstoneBytes $Digest $Sid $Origin $Id $Control
    } else {
        if ($row.kind -cne 'reservation') { throw 'owner_control_record' }
        Get-AdministratorControlReservationBytes $Digest $Sid $Origin $Id $Control $row.target $row.observedGeneration $row.runnerIdentity $row.sessionEvidence
    }
    if ([Convert]::ToBase64String($bytes) -cne [Convert]::ToBase64String($expected)) { throw 'owner_control_record' }
    return $row
}

# Reservation, phase and fence writers run under the caller's owner-control.guard.
# The exclusive operation execution handle is held separately across slow audit.
function Reserve-AdministratorControlOperation([string]$Vault,[string]$Digest,[string]$Sid,[string]$Origin,[string]$Id,
    [string]$Control,$Target,$Generation,$Runner,$Session) {
    $bytes = Get-AdministratorControlReservationBytes $Digest $Sid $Origin $Id $Control $Target $Generation $Runner $Session
    Assert-SealedAcl $Vault $true $true
    if (-not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($Vault,('pause-'+$Id+'.reserved.json'))))) { throw 'owner_control_namespace' }
    $tomb = Read-AdministratorControlRecord $Vault $Digest $Sid $Origin $Id $Control -Tombstone
    $prior = Read-AdministratorControlRecord $Vault $Digest $Sid $Origin $Id $Control
    if ($tomb -and $prior) { throw 'owner_control_namespace' }
    if ($tomb) { return $false }
    if ($prior) {
        if ($prior.target -cne $Target -or $prior.observedGeneration -cne $Generation) { throw 'owner_control_record_collision' }
        return $false
    }
    Publish-AdministratorControlBytes $Vault ('control-'+$Id+'.reserved.json') $bytes $true $Sid
    return $true
}

function Fence-AdministratorControlOperation([string]$Vault,[string]$Status,[string]$Digest,[string]$Sid,
    [string]$Origin,[string]$Id,[string]$Control) {
    $bytes = Get-AdministratorControlTombstoneBytes $Digest $Sid $Origin $Id $Control
    Assert-SealedAcl $Vault $true $true
    Assert-SealedAcl $Status $true $false $Sid
    if (-not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($Vault,('pause-'+$Id+'.reserved.json'))))) { throw 'owner_control_namespace' }
    $prior = Read-AdministratorControlRecord $Vault $Digest $Sid $Origin $Id $Control
    $tomb = Read-AdministratorControlRecord $Vault $Digest $Sid $Origin $Id $Control -Tombstone
    if ($prior -and $tomb) { throw 'owner_control_namespace' }
    if ($prior) { return Read-AdministratorControlReceipt $Status $Digest $Sid $Id $Control }
    Publish-AdministratorControlBytes $Vault ('control-'+$Id+'.tombstone.json') $bytes $true $Sid
    Publish-AdministratorControlReceipt $Status $Digest $Sid $Id $Control 'fenced'
    return Read-AdministratorControlReceipt $Status $Digest $Sid $Id $Control
}

function Read-AdministratorControlPhase([string]$Vault,[string]$Digest,[string]$Sid,[string]$Id,
    [string]$Control,[string]$Phase) {
    # Validate the name before any storage access; recovery needs a revision in its actual record.
    $revision = if ($Phase -ceq 'recovery-pause-started') { '0'*32 } else { $null }
    $null = Get-AdministratorControlPhaseBytes $Digest $Id $Control $Phase $revision
    Assert-SealedAcl $Vault $true $true
    $file = [IO.Path]::Combine($Vault,('control-'+$Id+'.phase-'+$Phase+'.json'))
    if (Test-AdministratorOwnerAbsent $file) { return $null }
    $bytes = Read-AdministratorControlBytes $file $true $Sid
    $row = ConvertFrom-Json -InputObject ([Text.UTF8Encoding]::new($false,$true).GetString($bytes))
    if (-not (Test-AdministratorControlFields $row @('version','bundleSha256','operationId','control','phase','revision')) -or
        ($row.version -isnot [int] -and $row.version -isnot [long]) -or $row.version -ne 1 -or $row.bundleSha256 -cne $Digest -or $row.operationId -cne $Id -or
        $row.control -cne $Control -or $row.phase -cne $Phase) { throw 'owner_control_phase' }
    $expected = Get-AdministratorControlPhaseBytes $Digest $Id $Control $Phase $row.revision
    if ([Convert]::ToBase64String($bytes) -cne [Convert]::ToBase64String($expected)) { throw 'owner_control_phase' }
    return $row
}

function Publish-AdministratorControlPhase([string]$Vault,[string]$Digest,[string]$Sid,[string]$Origin,[string]$Id,
    [string]$Control,[string]$Phase,$Revision) {
    $bytes = Get-AdministratorControlPhaseBytes $Digest $Id $Control $Phase $Revision
    if ((Read-AdministratorControlRecord $Vault $Digest $Sid $Origin $Id $Control -Tombstone) -or
        -not (Read-AdministratorControlRecord $Vault $Digest $Sid $Origin $Id $Control)) { throw 'owner_control_phase_unreserved' }
    if ($Phase -ceq 'launch-attempted' -and
        -not (Read-AdministratorControlPhase $Vault $Digest $Sid $Id $Control 'intent-write-started')) { throw 'owner_control_phase_order' }
    Publish-AdministratorControlBytes $Vault ('control-'+$Id+'.phase-'+$Phase+'.json') $bytes $true $Sid
}

function Read-AdministratorControlProgress([string]$Status,[string]$Digest,[string]$Sid,[string]$Id,[string]$Control) {
    try {
        Assert-AdministratorControlIdentity $Digest $Id $Control
        Assert-SealedAcl $Status $true $false $Sid
        $file = [IO.Path]::Combine($Status,('control-'+$Id+'.progress.json'))
        if (Test-AdministratorOwnerAbsent $file) { return $null }
        $bytes = Read-AdministratorControlBytes $file $false $Sid
        $row = ConvertFrom-Json -InputObject ([Text.UTF8Encoding]::new($false,$true).GetString($bytes))
        if (-not (Test-AdministratorControlFields $row @('version','bundleSha256','operationId','control','phase','verifiedFiles','totalFiles')) -or
            ($row.version -isnot [int] -and $row.version -isnot [long]) -or $row.version -ne 1 -or $row.bundleSha256 -cne $Digest -or
            $row.operationId -cne $Id -or $row.control -cne $Control) { return $null }
        $expected = Get-AdministratorControlProgressBytes $Digest $Id $Control $row.phase $row.verifiedFiles $row.totalFiles
        if ([Convert]::ToBase64String($bytes) -cne [Convert]::ToBase64String($expected)) { return $null }
        return @{phase=$row.phase;verifiedFiles=$row.verifiedFiles;totalFiles=$row.totalFiles}
    } catch { return $null }
}

function Publish-AdministratorControlProgress([string]$Status,[string]$Digest,[string]$Sid,[string]$Id,
    [string]$Control,[string]$Phase,$Verified,$Total) {
    $bytes = Get-AdministratorControlProgressBytes $Digest $Id $Control $Phase $Verified $Total
    Assert-SealedAcl $Status $true $false $Sid
    $previous = Read-AdministratorControlProgress $Status $Digest $Sid $Id $Control
    if ($previous -and $Phase -ceq 'verifying-full' -and $previous.phase -ceq $Phase -and
        $null -ne $previous.verifiedFiles -and ($null -eq $Verified -or $Verified -lt $previous.verifiedFiles -or $Total -ne $previous.totalFiles)) {
        throw 'owner_control_progress_backwards'
    }
    $file = [IO.Path]::Combine($Status,('control-'+$Id+'.progress.json'))
    $temp = [IO.Path]::Combine($Status,('control-progress-'+[Guid]::NewGuid().ToString('N')+'.tmp'))
    $stream = Open-SealedNewFile $temp $false $Sid
    try {
        try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        if (Test-AdministratorOwnerAbsent $file) { [IO.File]::Move($temp,$file) }
        else { Assert-SealedAcl $file $false $false $Sid; [IO.File]::Replace($temp,$file,[NullString]::Value) }
        if ([Convert]::ToBase64String((Read-AdministratorControlBytes $file $false $Sid)) -cne [Convert]::ToBase64String($bytes)) {
            throw 'owner_control_progress_readback'
        }
    } finally { if ([IO.File]::Exists($temp)) { Assert-SealedAcl $temp $false $false $Sid; [IO.File]::Delete($temp) } }
}

function Test-AdministratorControlRunnerExited($Runner) {
    $started=[long]0
    if (-not (Test-AdministratorControlFields $Runner @('pid','started')) -or
        ($Runner.pid -isnot [int] -and $Runner.pid -isnot [long]) -or $Runner.pid -lt 1 -or $Runner.pid -gt [int]::MaxValue -or
        $Runner.started -isnot [string] -or $Runner.started -cnotmatch '\A[1-9][0-9]{0,18}\z' -or
        -not [long]::TryParse($Runner.started,[ref]$started) -or $started -gt [DateTime]::MaxValue.Ticks) { throw 'owner_control_runner' }
    $process=$null
    try {
        try { $process=[Diagnostics.Process]::GetProcessById([int]$Runner.pid) }
        catch [ArgumentException] { return $true }
        $null=$process.Handle
        if ($process.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture) -cne $Runner.started) {
            return $true # The PID now identifies a different process, not the original runner.
        }
        return $process.HasExited
    } catch { return $false }
    finally { if ($process) { $process.Dispose() } }
}

function Complete-AdministratorControlRevocation([string]$BundleRoot,[string]$Digest,[string]$Sid,
    [string]$Origin,[string]$Id,[IO.FileStream]$Gate) {
    if (-not $Gate) { throw 'owner_control_guard' }
    $root=$BundleRoot+'.state'; $vault=$BundleRoot+'.secrets'; $status=$BundleRoot+'.status'
    $record=Read-AdministratorControlRecord $vault $Digest $Sid $Origin $Id 'revoke'
    if (-not $record -or (Read-AdministratorControlReceipt $status $Digest $Sid $Id 'revoke').state -cne 'revocation-recorded') { return }
    if ((Test-AdministratorOwnerAbsent ([IO.Path]::Combine($vault,'owner-revoked'))) -or
        -not (Test-AdministratorOwnerIntent $root $true) -or
        (Get-AdministratorPauseGeneration $root $vault $Digest $Sid) -cne 'idle') { return }
    if ($null -eq $record.observedGeneration) { return }
    if ($record.observedGeneration -cne 'idle') {
        $terminalFile=[IO.Path]::Combine($vault,('owner-job-'+$record.observedGeneration+'.terminal.json'))
        $bytes=Read-AdministratorControlBytes $terminalFile $true $Sid 2048
        $terminal=ConvertFrom-Json -InputObject ([Text.UTF8Encoding]::new($false,$true).GetString($bytes))
        if (-not (Test-AdministratorControlFields $terminal @('format','version','generation','bundleSha256','outcome','jobDrained',
            'rootCreationAttempted','rootExitObserved','rootExitCode','innerLeasesClear','tunnelReady')) -or
            $terminal.format -isnot [string] -or
            -not [string]::Equals($terminal.format,'agent-continue-windows-owner-job',[StringComparison]::Ordinal) -or
            ($terminal.version -isnot [int] -and $terminal.version -isnot [long]) -or $terminal.version -ne 1 -or
            $terminal.generation -isnot [string] -or
            -not [string]::Equals($terminal.generation,$record.observedGeneration,[StringComparison]::Ordinal) -or
            $terminal.bundleSha256 -isnot [string] -or
            -not [string]::Equals($terminal.bundleSha256,$Digest,[StringComparison]::Ordinal) -or
            $terminal.jobDrained -isnot [bool] -or -not $terminal.jobDrained -or
            $terminal.innerLeasesClear -isnot [bool] -or -not $terminal.innerLeasesClear -or
            $terminal.rootCreationAttempted -isnot [bool] -or $terminal.rootExitObserved -isnot [bool] -or
            ($terminal.rootCreationAttempted -and -not $terminal.rootExitObserved)) { return }
    }
    Publish-AdministratorControlReceipt $status $Digest $Sid $Id 'revoke' 'stopped'
}

# Internal high-side transaction. The endpoint must supply a verified OS peer pair;
# the closed serializers below do not establish kernel identity by themselves.
function Invoke-AdministratorControlOperation([string]$BundleRoot,[string]$Digest,[string]$Sid,[string]$Origin,
    [string]$Id,[string]$Control,$Target,$Runner,$Session,[scriptblock]$VerifyBinding,[scriptblock]$Audit,
    [scriptblock]$CheckStartup,[scriptblock]$RequestTask,[scriptblock]$Handoff=$null) {
    Assert-AdministratorControlIdentity $Digest $Id $Control
    if (-not $VerifyBinding -or ($Control -cne 'revoke' -and (-not $Audit -or -not $CheckStartup -or -not $RequestTask))) {
        throw 'owner_control_callbacks'
    }
    $reviewedGeneration=if ($Control -ceq 'revoke') { $null } elseif (Test-AdministratorBrowserPauseTarget $Target) { $Target.Split(':')[1] } else { throw 'owner_control_target' }
    $null=Get-AdministratorControlReservationBytes $Digest $Sid $Origin $Id $Control $Target $reviewedGeneration $Runner $Session
    Assert-AdministratorOwnerControlIdentity $BundleRoot $Digest $Sid
    $root=$BundleRoot+'.state'; $vault=$BundleRoot+'.secrets'; $status=$BundleRoot+'.status'
    try { $lease=Open-AdministratorControlExecution $vault $Id } catch {
        if (-not $Handoff -or -not (Test-AdministratorControlExecutionBusy $_.Exception)) { throw }
        return Invoke-AdministratorControlBusyReadback $BundleRoot $Digest $Sid $Origin $Id $Control $Target `
            -CheckTarget -VerifyBinding $VerifyBinding -Handoff $Handoff
    }
    try {
        $gate=Open-AdministratorOwnerControl $vault
        try {
            $null=& $VerifyBinding
            if (-not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($vault,('pause-'+$Id+'.reserved.json'))))) { throw 'owner_control_collision' }
            $previous=Read-AdministratorControlRecord $vault $Digest $Sid $Origin $Id $Control
            $tombstone=Read-AdministratorControlRecord $vault $Digest $Sid $Origin $Id $Control -Tombstone
            if ($previous -and $tombstone) { throw 'owner_control_collision' }
            if ($previous) {
                if ($previous.target -cne $Target) { throw 'owner_control_collision' }
                if ($Handoff) { $null=& $Handoff }
                return Read-AdministratorControlReceipt $status $Digest $Sid $Id $Control
            }
            if ($tombstone) {
                if ($Handoff) { $null=& $Handoff }
                return Read-AdministratorControlReceipt $status $Digest $Sid $Id $Control
            }
            $generation=Get-AdministratorPauseGeneration $root $vault $Digest $Sid
            if ($generation -ceq 'unknown') {
                if ($Control -cne 'revoke') { throw 'owner_control_generation_unobserved' }
                $generation=$null
            }
            if (-not (Reserve-AdministratorControlOperation $vault $Digest $Sid $Origin $Id $Control $Target $generation $Runner $Session)) {
                if ($Handoff) { $null=& $Handoff }
                return Read-AdministratorControlReceipt $status $Digest $Sid $Id $Control
            }
            Publish-AdministratorControlReceipt $status $Digest $Sid $Id $Control 'reserved'
            if ($Handoff) { $null=& $Handoff }
        } finally { $gate.Dispose() }

        if ($Control -cne 'revoke') {
            $progress={param($Done,$Total) Publish-AdministratorControlProgress $status $Digest $Sid $Id $Control 'verifying-full' $Done $Total}
            $null=& $Audit $progress
        }
        Publish-AdministratorControlProgress $status $Digest $Sid $Id $Control 'verifying-control' $null $null
        $gate=Open-AdministratorOwnerControl $vault
        try {
            $null=& $VerifyBinding
            $receipt=Read-AdministratorControlReceipt $status $Digest $Sid $Id $Control
            if ($receipt.state -cne 'reserved') { return $receipt }
            $phases=@('intent-write-started','recovery-pause-started')
            if ($Control -cne 'revoke') { $phases+='launch-attempted' }
            elseif (-not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($vault,('control-'+$Id+'.phase-launch-attempted.json'))))) {
                throw 'owner_control_unexpected_phase'
            }
            foreach ($phase in $phases) {
                if ($null -ne (Read-AdministratorControlPhase $vault $Digest $Sid $Id $Control $phase)) { throw 'owner_control_unexpected_phase' }
            }
            if ($Control -ceq 'revoke') {
                Publish-AdministratorControlPhase $vault $Digest $Sid $Origin $Id $Control 'intent-write-started' $null
                Write-AdministratorOwnerControlRevision $gate $Id
                $deny=[IO.Path]::Combine($vault,'owner-revoked')
                Write-HostedWindowSignal $deny
                Assert-SealedAcl $deny $false $true
                if ([IO.FileInfo]::new($deny).Length -ne 0) { throw 'owner_control_deny_readback' }
                Publish-AdministratorControlReceipt $status $Digest $Sid $Id $Control 'revocation-recorded'
                Write-AdministratorOwnerIntent $root $true
                Update-AdministratorBrowserPauseTarget $root $vault $Digest $Sid $gate
                Complete-AdministratorControlRevocation $BundleRoot $Digest $Sid $Origin $Id $gate
                return Read-AdministratorControlReceipt $status $Digest $Sid $Id $Control
            }
            $liveTarget=(Read-AdministratorOwnerControlRevision $gate)+':'+(Get-AdministratorPauseGeneration $root $vault $Digest $Sid)
            if ($liveTarget -cne $Target -or -not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($vault,'owner-revoked')))) {
                Publish-AdministratorControlReceipt $status $Digest $Sid $Id $Control 'superseded'
                return Read-AdministratorControlReceipt $status $Digest $Sid $Id $Control
            }
            $eligible=& $CheckStartup
            $intentMatches=if ($Control -ceq 'connect') { Test-AdministratorOwnerIntent $root $true } else { Test-AdministratorOwnerIntent $root $false }
            if ($eligible -isnot [bool] -or -not $eligible -or -not $intentMatches -or
                -not $liveTarget.EndsWith(':idle',[StringComparison]::Ordinal) -or
                -not (Test-AdministratorOwnerInnerLeasesClear $root)) {
                Publish-AdministratorControlReceipt $status $Digest $Sid $Id $Control 'rejected'
                return Read-AdministratorControlReceipt $status $Digest $Sid $Id $Control
            }
            Publish-AdministratorControlPhase $vault $Digest $Sid $Origin $Id $Control 'intent-write-started' $null
            Write-AdministratorOwnerControlRevision $gate $Id
            if ($Control -ceq 'connect') { Write-AdministratorOwnerIntent $root $false }
            Update-AdministratorBrowserPauseTarget $root $vault $Digest $Sid $gate
            Publish-AdministratorControlReceipt $status $Digest $Sid $Id $Control 'intent-saved'
        } finally { $gate.Dispose() }

        # Persist launch uncertainty before leaving the guard for the only task RPC.
        $gate=Open-AdministratorOwnerControl $vault
        try {
            $null=& $VerifyBinding
            if ((Read-AdministratorOwnerControlRevision $gate) -cne $Id -or -not (Test-AdministratorOwnerRunIntent $root $vault)) {
                Publish-AdministratorControlReceipt $status $Digest $Sid $Id $Control 'superseded'
                return Read-AdministratorControlReceipt $status $Digest $Sid $Id $Control
            }
            Publish-AdministratorControlPhase $vault $Digest $Sid $Origin $Id $Control 'launch-attempted' $null
        } finally { $gate.Dispose() }
        $accepted=$false
        try { $answer=& $RequestTask; $accepted=$answer -is [bool] -and $answer } catch { $accepted=$false }
        $gate=Open-AdministratorOwnerControl $vault
        try {
            $state=if ($accepted) { 'launch-requested' } else { 'launch-unconfirmed' }
            Publish-AdministratorControlReceipt $status $Digest $Sid $Id $Control $state
        } finally { $gate.Dispose() }
        Publish-AdministratorControlProgress $status $Digest $Sid $Id $Control 'waiting-owner' $null $null
        return Read-AdministratorControlReceipt $status $Digest $Sid $Id $Control
    } finally { $lease.Dispose() }
}

function Invoke-AdministratorControlRecovery([string]$BundleRoot,[string]$Digest,[string]$Sid,[string]$Origin,
    [string]$Id,[string]$Control,[scriptblock]$VerifyBinding,[scriptblock]$RunnerExited,
    [scriptblock]$Handoff=$null,[switch]$FenceOnly) {
    Assert-AdministratorControlIdentity $Digest $Id $Control
    if (-not $VerifyBinding -or (-not $FenceOnly -and -not $RunnerExited)) { throw 'owner_control_callbacks' }
    Assert-AdministratorOwnerControlIdentity $BundleRoot $Digest $Sid
    $root=$BundleRoot+'.state'; $vault=$BundleRoot+'.secrets'; $status=$BundleRoot+'.status'
    try { $lease=Open-AdministratorControlExecution $vault $Id } catch {
        if (-not $Handoff -or -not (Test-AdministratorControlExecutionBusy $_.Exception)) { throw }
        return Invoke-AdministratorControlBusyReadback $BundleRoot $Digest $Sid $Origin $Id $Control $null `
            -VerifyBinding $VerifyBinding -Handoff $Handoff
    }
    try {
        $gate=Open-AdministratorOwnerControl $vault
        try {
            $null=& $VerifyBinding
            $record=Read-AdministratorControlRecord $vault $Digest $Sid $Origin $Id $Control
            $tombstone=Read-AdministratorControlRecord $vault $Digest $Sid $Origin $Id $Control -Tombstone
            if ($record -and $tombstone) { throw 'owner_control_collision' }
            if (-not $record) {
                $fenced=Fence-AdministratorControlOperation $vault $status $Digest $Sid $Origin $Id $Control
                if ($Handoff) { $null=& $Handoff }
                return $fenced
            }
            if ($Handoff) { $null=& $Handoff }
            if ($FenceOnly) { return Fence-AdministratorControlOperation $vault $status $Digest $Sid $Origin $Id $Control }
            $gone=& $RunnerExited $record.runnerIdentity
            if ($gone -isnot [bool] -or -not $gone) { return Read-AdministratorControlReceipt $status $Digest $Sid $Id $Control }
            $receipt=Read-AdministratorControlReceipt $status $Digest $Sid $Id $Control
            if ($receipt.state -cin @('launch-requested','stopped','superseded','rejected','fenced','abandoned','recovered-paused')) { return $receipt }
            # An interrupted reservation publication may be repaired only from its
            # validated private record, never from browser storage or a new target.
            Publish-AdministratorControlReceipt $status $Digest $Sid $Id $Control 'reserved'
            if ($Control -ceq 'revoke') {
                $deny=[IO.Path]::Combine($vault,'owner-revoked')
                Write-HostedWindowSignal $deny
                Assert-SealedAcl $deny $false $true
                if ([IO.FileInfo]::new($deny).Length -ne 0) { throw 'owner_control_deny_readback' }
                Publish-AdministratorControlReceipt $status $Digest $Sid $Id $Control 'revocation-recorded'
                # Denial is durable even if a later write fails.
                Write-AdministratorOwnerIntent $root $true
                Update-AdministratorBrowserPauseTarget $root $vault $Digest $Sid $gate
                Complete-AdministratorControlRevocation $BundleRoot $Digest $Sid $Origin $Id $gate
                return Read-AdministratorControlReceipt $status $Digest $Sid $Id $Control
            }
            $intent=Read-AdministratorControlPhase $vault $Digest $Sid $Id $Control 'intent-write-started'
            $launch=Read-AdministratorControlPhase $vault $Digest $Sid $Id $Control 'launch-attempted'
            $recovery=Read-AdministratorControlPhase $vault $Digest $Sid $Id $Control 'recovery-pause-started'
            if ($launch -and -not $intent) { throw 'owner_control_phase_history' }
            if (-not ($intent -or $launch -or $recovery)) {
                Publish-AdministratorControlReceipt $status $Digest $Sid $Id $Control 'abandoned'
                return Read-AdministratorControlReceipt $status $Digest $Sid $Id $Control
            }
            $current=Read-AdministratorOwnerControlRevision $gate
            $original=$record.target.Split(':')[0]
            if ($current -cne $Id -and $current -cne $original -and (-not $recovery -or $current -cne $recovery.revision)) {
                Publish-AdministratorControlReceipt $status $Digest $Sid $Id $Control 'superseded'
                return Read-AdministratorControlReceipt $status $Digest $Sid $Id $Control
            }
            if (-not $recovery) {
                $revision=[Guid]::NewGuid().ToString('N')
                Publish-AdministratorControlPhase $vault $Digest $Sid $Origin $Id $Control 'recovery-pause-started' $revision
            } else { $revision=$recovery.revision }
            Write-AdministratorOwnerControlRevision $gate $revision
            Write-AdministratorOwnerIntent $root $true
            Update-AdministratorBrowserPauseTarget $root $vault $Digest $Sid $gate
            Publish-AdministratorControlReceipt $status $Digest $Sid $Id $Control 'recovered-paused'
            return Read-AdministratorControlReceipt $status $Digest $Sid $Id $Control
        } finally { $gate.Dispose() }
    } finally { $lease.Dispose() }
}

function Invoke-AdministratorControlKernelOperation([IO.Stream]$Archive,[string]$CompilerTemp,[string]$BundleRoot,
    [string]$Digest,[string]$Origin,[string]$Id,[string]$Control,[string]$Mode,$Target,[uint32]$CallerPid,
    [string]$CallerStarted,[int]$SessionId,[string]$Sid,[scriptblock]$VerifyBinding,[scriptblock]$Audit,
    [scriptblock]$CheckStartup,[scriptblock]$RequestTask) {
    Assert-AdministratorControlIdentity $Digest $Id $Control
    if (-not $VerifyBinding -or [Array]::IndexOf(@('control','fence','reconcile'),$Mode) -lt 0) {
        throw 'owner_control_admission_input'
    }
    $bindingVerified=& $VerifyBinding
    if ($bindingVerified -isnot [bool] -or -not $bindingVerified) { throw 'owner_control_binding' }
    $source=Read-AdministratorControlPeerSource $Archive $Digest
    $peerType=Get-AdministratorControlPeerType $source $CompilerTemp
    $pair=Open-AdministratorControlKernelSession $peerType $BundleRoot $Digest $Origin $Id $Control $Mode $Target $CallerPid $CallerStarted $SessionId $Sid
    $kernelAdmissionContext=@{Binding=$VerifyBinding;Pair=$pair;HandedOff=$false;Root=$BundleRoot;
        Digest=$Digest;Sid=$Sid;Origin=$Origin;Id=$Id;Control=$Control;Mode=$Mode}
    try {
        $checkedBinding={
            $bindingVerified=& ($kernelAdmissionContext.Binding)
            if ($bindingVerified -isnot [bool] -or -not $bindingVerified) { throw 'owner_control_binding' }
            if (-not $kernelAdmissionContext.HandedOff -and -not $kernelAdmissionContext.Pair.Witness.Alive) {
                throw 'owner_control_handoff_peer'
            }
        }
        $handoff={
            if ($kernelAdmissionContext.HandedOff) { throw 'owner_control_handoff_duplicate' }
            $null=Publish-AdministratorControlHandoff $kernelAdmissionContext.Root $kernelAdmissionContext.Digest `
                $kernelAdmissionContext.Sid $kernelAdmissionContext.Origin $kernelAdmissionContext.Id `
                $kernelAdmissionContext.Control $kernelAdmissionContext.Mode $kernelAdmissionContext.Pair.Runner `
                $kernelAdmissionContext.Pair.Session { $kernelAdmissionContext.Pair.Witness.Alive }
            $kernelAdmissionContext.HandedOff=$true
            $kernelAdmissionContext.Pair.Witness.Dispose()
        }
        if ($Mode -ceq 'control') {
            return Invoke-AdministratorControlOperation $BundleRoot $Digest $Sid $Origin $Id $Control $Target `
                $pair.Runner $pair.Session $checkedBinding $Audit $CheckStartup $RequestTask $handoff
        }
        return Invoke-AdministratorControlRecovery $BundleRoot $Digest $Sid $Origin $Id $Control `
            $checkedBinding {param($Runner) Test-AdministratorControlRunnerExited $Runner} `
            -Handoff $handoff -FenceOnly:($Mode -ceq 'fence')
    } finally {
        if (-not $kernelAdmissionContext.HandedOff) { $pair.Witness.Dispose() }
    }
}

function Get-AdministratorControlEndpointRoute([string]$Action,[string]$Control) {
    if ([Array]::IndexOf(@('connect','resume-saved','revoke'),$Control) -lt 0) { throw 'owner_control_entry_input' }
    $role='high'; $mode='control'; $high=''; $consent=''
    switch -CaseSensitive ($Action) {
        'RequestBrowserHostedOwnerControl' { $role='medium' }
        'RequestBrowserHostedOwnerControlFence' { $role='medium'; $mode='fence' }
        'RequestBrowserHostedOwnerControlReconcile' { $role='medium'; $mode='reconcile' }
        'ConnectBrowserHostedOwner' { if ($Control -cne 'connect') { throw 'owner_control_entry_input' } }
        'ResumeBrowserHostedOwner' { if ($Control -cne 'resume-saved') { throw 'owner_control_entry_input' } }
        'RevokeBrowserHostedOwner' { if ($Control -cne 'revoke') { throw 'owner_control_entry_input' } }
        'FenceBrowserHostedOwnerControl' { $mode='fence' }
        'ReconcileBrowserHostedOwnerControl' { $mode='reconcile' }
        default { throw 'owner_control_entry_input' }
    }
    if ($mode -ceq 'fence') { $high='FenceBrowserHostedOwnerControl'; $consent='fence-browser-administrator-control' }
    elseif ($mode -ceq 'reconcile') { $high='ReconcileBrowserHostedOwnerControl'; $consent='reconcile-browser-administrator-control' }
    elseif ($Control -ceq 'connect') { $high='ConnectBrowserHostedOwner'; $consent='connect-browser-administrator-owner' }
    elseif ($Control -ceq 'resume-saved') { $high='ResumeBrowserHostedOwner'; $consent='resume-browser-administrator-owner' }
    else { $high='RevokeBrowserHostedOwner'; $consent='revoke-browser-administrator-owner' }
    return @{Role=$role;Mode=$mode;HighAction=$high;Consent=$consent}
}

function Assert-AdministratorControlEndpointParameters([string]$Action,[string[]]$BoundParameters,[string]$Digest,
    [string]$Id,[string]$Control,$Target,[uint32]$CallerPid=0,[string]$CallerCreated='',
    [int]$SessionId=0,[string]$Sid='',[string]$Consent='') {
    $route=Get-AdministratorControlEndpointRoute $Action $Control
    Assert-AdministratorControlIdentity $Digest $Id $Control
    $required=@('Action','Archive','ExpectedSha256','ControlKind','ControlOperationId')
    $targetRequired=$route.Mode -ceq 'control' -and $Control -cne 'revoke'
    if ($targetRequired) {
        $required+='BrowserControlTarget'
        if ($Target -isnot [string] -or -not (Test-AdministratorBrowserPauseTarget $Target)) { throw 'owner_control_entry_input' }
    } elseif ($null -ne $Target) { throw 'owner_control_entry_input' }
    if ($route.Role -ceq 'high') {
        $required+=@('ExpectedUserSid','Consent','ControlCallerPid','ControlCallerCreated','ExpectedSessionId')
        $ticks=[long]0
        if ($CallerPid -lt 1 -or $CallerPid -gt [int]::MaxValue -or $SessionId -lt 1 -or
            $CallerCreated -cnotmatch '\A[1-9][0-9]{0,18}\z' -or -not [long]::TryParse($CallerCreated,[ref]$ticks) -or
            $ticks -gt [DateTime]::MaxValue.Ticks -or $Sid -cnotmatch '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z' -or
            -not [string]::Equals(([Security.Principal.SecurityIdentifier]::new($Sid)).Value,$Sid,[StringComparison]::Ordinal) -or
            $Consent -cne $route.Consent) { throw 'owner_control_entry_input' }
    } elseif ($CallerPid -ne 0 -or $CallerCreated -or $SessionId -ne 0 -or $Sid -or $Consent) { throw 'owner_control_entry_input' }
    if ($BoundParameters.Count -ne $required.Count) { throw 'owner_control_entry_input' }
    foreach ($name in $required) { if ([Array]::IndexOf($BoundParameters,$name) -lt 0) { throw 'owner_control_entry_input' } }
    return $route
}

function New-AdministratorControlEndpointLaunchPlan($Target,$Route,[string]$Id,[string]$Control,$Snapshot,$Caller) {
    Assert-AdministratorControlIdentity $Target.Digest $Id $Control
    $mediumAction=if ($Route.Mode -ceq 'fence') {'RequestBrowserHostedOwnerControlFence'}
        elseif ($Route.Mode -ceq 'reconcile') {'RequestBrowserHostedOwnerControlReconcile'} else {'RequestBrowserHostedOwnerControl'}
    $expected=Get-AdministratorControlEndpointRoute $mediumAction $Control
    foreach ($field in @('Role','Mode','HighAction','Consent')) { if ($Route[$field] -cne $expected[$field]) { throw 'owner_control_launch_plan' } }
    if ($Target.Root -isnot [string] -or $Target.Root -cnotmatch '\A[A-Z]:\\[^\\]' -or
        $Target.Root.Substring(2) -match '[%!^&|<>():*?"\x00-\x1f]' -or
        $Target.Root -cne [IO.Path]::GetFullPath($Target.Root) -or [IO.Path]::GetFileName($Target.Root) -cne $Target.Digest.Substring(0,24) -or
        $Target.Stager -cne [IO.Path]::Combine($Target.Root+'.browser','stager.ps1') -or
        $Target.Archive -cne [IO.Path]::Combine($Target.Root+'.browser','bundle.zip') -or
        $Target.System -notmatch '\A[A-Z]:\\Windows\\System32\z' -or $Target.Sid -cne $Caller.Sid) { throw 'owner_control_launch_plan' }
    $keys=@('Action','Archive','ExpectedSha256','ControlKind','ControlOperationId','ExpectedUserSid','Consent',
        'ControlCallerPid','ControlCallerCreated','ExpectedSessionId')
    if ($null -ne $Snapshot) { $keys+='BrowserControlTarget' }
    $null=Assert-AdministratorControlEndpointParameters $Route.HighAction $keys $Target.Digest $Id $Control $Snapshot `
        $Caller.Pid $Caller.Started $Caller.SessionId $Caller.Sid $Route.Consent
    $exe=[IO.Path]::Combine($Target.System,'WindowsPowerShell\v1.0\powershell.exe')
    $arguments='-NoLogo -NoProfile -NonInteractive -File "{0}" -Action {1} -Archive "{2}" -ExpectedSha256 {3} -ControlKind {4} -ControlOperationId {5} -ExpectedUserSid {6} -Consent {7} -ControlCallerPid {8} -ControlCallerCreated {9} -ExpectedSessionId {10}' -f
        $Target.Stager,$Route.HighAction,$Target.Archive,$Target.Digest,$Control,$Id,$Caller.Sid,$Route.Consent,
        $Caller.Pid.ToString([Globalization.CultureInfo]::InvariantCulture),$Caller.Started,$Caller.SessionId.ToString([Globalization.CultureInfo]::InvariantCulture)
    if ($null -ne $Snapshot) { $arguments+=' -BrowserControlTarget '+$Snapshot }
    $plan=[Diagnostics.ProcessStartInfo]::new($exe,$arguments)
    $plan.UseShellExecute=$true; $plan.Verb='runas'; $plan.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
    $plan.WorkingDirectory=$Target.System
    return $plan
}

function Get-AdministratorControlEndpointCaller([string]$System) {
    $identity=Get-AdministratorBrowserPauseIdentity $System
    $self=[Diagnostics.Process]::GetCurrentProcess()
    try {
        $null=$self.Handle
        if ($identity.SessionId -ne $self.SessionId -or $identity.Elevated -ne $false -or
            $identity.Integrity -cne 'S-1-16-8192' -or $self.Id -ne $PID) { throw 'owner_control_caller' }
        return @{Pid=$self.Id;Started=$self.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture);
            SessionId=$self.SessionId;Sid=$identity.Sid;Process=$self}
    } catch { $self.Dispose(); throw }
}

function Wait-AdministratorControlEndpointHandoff($Target,$Route,[string]$Id,[string]$Control,$Caller,$Child,
    [int]$TimeoutMilliseconds=15000,[scriptblock]$ReadAck=$null) {
    try {
        if ($TimeoutMilliseconds -lt 1 -or $TimeoutMilliseconds -gt 15000 -or $null -eq $Child -or
            $Child.SessionId -ne $Caller.SessionId -or $Target.Sid -cne $Caller.Sid) { return $false }
        $highStarted=$Child.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
        $handoffId=Get-AdministratorControlHandoffId $Target.Digest $Id $Control $Route.Mode $Caller.Pid $Caller.Started `
            $Caller.SessionId $Caller.Sid $Child.Id $highStarted
        $clock=[Diagnostics.Stopwatch]::StartNew()
        while ($clock.ElapsedMilliseconds -lt $TimeoutMilliseconds) {
            $ack=if ($ReadAck) { & $ReadAck ($Target.Root+'.status') $Target.Digest $Target.Sid $Id $Control $Route.Mode $handoffId }
                else { Read-AdministratorControlHandoff ($Target.Root+'.status') $Target.Digest $Target.Sid $Id $Control $Route.Mode $handoffId }
            if ($ack -is [bool] -and $ack) { return $true }
            if ($Child.HasExited) { break }
            $remaining=[Math]::Max(1,[Math]::Min(25,$TimeoutMilliseconds-$clock.ElapsedMilliseconds))
            $null=$Child.WaitForExit([int]$remaining)
        }
        # Publication may race either the observed exit or the deadline boundary.
        $ack=if ($ReadAck) { & $ReadAck ($Target.Root+'.status') $Target.Digest $Target.Sid $Id $Control $Route.Mode $handoffId }
            else { Read-AdministratorControlHandoff ($Target.Root+'.status') $Target.Digest $Target.Sid $Id $Control $Route.Mode $handoffId }
        return $ack -is [bool] -and $ack
    } catch { return $false }
}

function Invoke-AdministratorBrowserControlRequest([string]$Action,[string]$Digest,[string]$Id,[string]$Control,
    $Target,[string[]]$BoundParameters,[scriptblock]$Verify,[scriptblock]$Capture,[scriptblock]$Start,[scriptblock]$Wait) {
    $route=Assert-AdministratorControlEndpointParameters $Action $BoundParameters $Digest $Id $Control $Target
    if ($route.Role -cne 'medium' -or -not $Verify -or -not $Capture -or -not $Start -or -not $Wait) { throw 'owner_control_entry_input' }
    $result=@{bundleSha256=$Digest;operationId=$Id;control=$Control;outcome='unconfirmed'}
    $caller=$child=$null
    try {
        $binding=& $Verify
        if ($null -eq $binding -or $binding.Digest -cne $Digest) { return $result }
        $caller=& $Capture $binding.System
        $plan=New-AdministratorControlEndpointLaunchPlan $binding $route $Id $Control $Target $caller
        try { $child=& $Start $plan }
        catch {
            $cause=$_.Exception.GetBaseException()
            if ($cause -is [ComponentModel.Win32Exception] -and $cause.NativeErrorCode -eq 1223) { $result.outcome='cancelled' }
            return $result
        }
        if ($null -eq $child) { return $result }
        $ack=& $Wait $binding $route $Id $Control $caller $child
        if ($ack -is [bool] -and $ack) { $result.outcome='requested' }
        return $result
    } catch { return $result }
    finally {
        if ($child) { try { $child.Dispose() } catch {} }
        if ($caller -and $caller.Process) { try { $caller.Process.Dispose() } catch {} }
    }
}

function Get-AdministratorControlEndpointBinding([string]$ArchivePath,[string]$Digest,[string]$ScriptPath,
    [string]$Sid,[string]$ProgramFiles,[string]$System) {
    Assert-AdministratorBrowserPauseAnchors $ProgramFiles $System
    Assert-AdministratorBrowserIdentity $Sid
    $base=[IO.Path]::Combine($ProgramFiles,'AgentContinueAdmin'); $root=[IO.Path]::Combine($base,$Digest.Substring(0,24))
    $bridge=$root+'.browser'
    if ($ArchivePath -cne [IO.Path]::Combine($bridge,'bundle.zip') -or
        $ScriptPath -cne [IO.Path]::Combine($bridge,'stager.ps1')) { throw 'owner_control_entry_binding' }
    Assert-SealedAcl $base $true
    Assert-AdministratorOwnerControlIdentity $root $Digest $Sid
    Read-AdministratorBrowserCommit $bridge $Digest $Sid
    $bytes=Read-AdministratorControlBytes ([IO.Path]::Combine($bridge,'binding.json')) $false $Sid
    $public=ConvertFrom-Json ([Text.UTF8Encoding]::new($false,$true).GetString($bytes))
    if (-not (Test-AdministratorControlFields $public @('version','origin','bundleSha256','systemDirectory')) -or
        ($public.version -isnot [int] -and $public.version -isnot [long]) -or $public.version -ne 1 -or
        $public.origin -isnot [string] -or $public.origin -cnotmatch '\Achrome-extension://[a-p]{32}/\z' -or
        $public.bundleSha256 -isnot [string] -or $public.bundleSha256 -cne $Digest -or
        $public.systemDirectory -isnot [string] -or $public.systemDirectory -cne $System) { throw 'owner_control_entry_binding' }
    $bytes=Read-AdministratorControlBytes ([IO.Path]::Combine($bridge,'demand.json')) $true $Sid
    $demand=ConvertFrom-Json ([Text.UTF8Encoding]::new($false,$true).GetString($bytes))
    if (-not (Test-AdministratorControlFields $demand @('version','bundleSha256','userSid','tunnelId','systemDirectory')) -or
        ($demand.version -isnot [int] -and $demand.version -isnot [long]) -or $demand.version -ne 1 -or
        $demand.bundleSha256 -isnot [string] -or $demand.bundleSha256 -cne $Digest -or
        $demand.userSid -isnot [string] -or $demand.userSid -cne $Sid -or
        $demand.systemDirectory -isnot [string] -or $demand.systemDirectory -cne $System -or
        $demand.tunnelId -isnot [string] -or $demand.tunnelId -cnotmatch '\Atunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}\z') { throw 'owner_control_entry_binding' }
    $extension=$public.origin.Substring(19,32)
    $plan=New-AdministratorBrowserEnrollmentPlan $root $Digest $Sid $demand.tunnelId $extension $System
    $binding=@{Root=$root;Archive=$ArchivePath;Stager=$ScriptPath;Digest=$Digest;Sid=$Sid;Origin=$public.origin;
        System=$System;Tunnel=$demand.tunnelId;Plan=$plan}
    $null=Assert-AdministratorControlEndpointBinding $binding
    return $binding
}

function Assert-AdministratorControlEndpointBinding($Binding) {
    $b=$Binding; $plan=$b.Plan
    Read-AdministratorBrowserCommit $plan.Bridge $b.Digest $b.Sid
    if (-not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($plan.Bridge,'enrollment.pending')))) { throw 'browser_enrollment_not_committed' }
    Assert-AdministratorOwnerControlIdentity $b.Root $b.Digest $b.Sid
    foreach ($name in $plan.Files.Keys) { Assert-AdministratorBrowserAsset ([IO.Path]::Combine($plan.Bridge,$name)) $plan.Files[$name] $b.Sid }
    Assert-AdministratorBrowserAsset $plan.DemandScript $plan.DemandBytes $b.Sid
    Assert-AdministratorBrowserAsset $plan.DemandBinding $plan.DemandBindingBytes $b.Sid $true
    Assert-AdministratorBrowserRegistry $plan $true
    $stream=Open-AdministratorBrowserPauseAsset ([IO.Path]::Combine($plan.Bridge,'pause-launch.json')) $b.Sid
    try { $stagerHash=Read-AdministratorBrowserPauseMetadata $stream $b.Digest $b.Sid } finally { $stream.Dispose() }
    $stream=Open-AdministratorBrowserPauseAsset $b.Stager $b.Sid
    try { if ((Read-AdministratorBrowserPauseAssetHash $stream 512KB) -cne $stagerHash) { throw 'browser_stager_hash' } } finally { $stream.Dispose() }
    Assert-SealedAcl $b.Archive $false $false $b.Sid
    return $true
}

function Get-AdministratorControlEndpointTask($Plan) {
    $scheduler=New-Object -ComObject Schedule.Service
    $scheduler.Connect()
    $folder=$scheduler.GetFolder('\'+$Plan.Folder)
    Assert-AdministratorBrowserTaskAcl ($folder.GetSecurityDescriptor(5)) $Plan.Sddl
    $task=$folder.GetTask($Plan.Name)
    Assert-AdministratorBrowserTask $task $Plan $true
    return $task
}

function Invoke-AdministratorBrowserControlEndpoint([string]$Action,[string]$ArchivePath,[string]$Digest,
    [string]$ScriptPath,[string]$Id,[string]$Control,$Target,[uint32]$CallerPid,[string]$CallerCreated,
    [int]$SessionId,[string]$Sid,[string]$ProgramFiles,[string]$System) {
    $route=Get-AdministratorControlEndpointRoute $Action $Control
    if ($route.Role -cne 'high') { throw 'owner_control_entry_input' }
    $binding=Get-AdministratorControlEndpointBinding $ArchivePath $Digest $ScriptPath $Sid $ProgramFiles $System
    $archive=[IO.File]::Open($binding.Archive,'Open','Read','Read')
    $endpointRuntimeContext=@{Binding=$binding;Archive=$archive;Task=$null}
    $sha=$null
    try {
        # Copy-Or-Hash resolves this per-entry owned dependency, not legacy dispatch state.
        $sha=[Security.Cryptography.SHA256]::Create()
        $verify={ Assert-AdministratorControlEndpointBinding $endpointRuntimeContext.Binding }
        $audit={
            param([scriptblock]$Progress)
            $endpointRuntimeContext.Archive.Position=0
            $zip=[IO.Compression.ZipArchive]::new($endpointRuntimeContext.Archive,[IO.Compression.ZipArchiveMode]::Read,$true)
            try {
                $layout=Get-Layout $zip $endpointRuntimeContext.Binding.Root
                Verify-SealedBundle $endpointRuntimeContext.Binding.Root $layout $Progress
            } finally { $zip.Dispose() }
        }
        $startup={
            $b=$endpointRuntimeContext.Binding
            Assert-AdministratorOwnerWake $b.Root ($b.Root+'.state') $b.Digest $b.Sid $b.Tunnel
            $endpointRuntimeContext.Task=Get-AdministratorControlEndpointTask $b.Plan
            $check=New-AdministratorLaunchPlan $b.Root ($b.Root+'.state') -ConnectCheckSid $b.Sid
            Invoke-AdministratorOwnerConnectCheck $check
            return $true
        }
        $request={
            if ($null -eq $endpointRuntimeContext.Task) { throw 'owner_control_task_not_checked' }
            Assert-AdministratorBrowserTask $endpointRuntimeContext.Task $endpointRuntimeContext.Binding.Plan $true
            return $null -ne $endpointRuntimeContext.Task.Run($null)
        }
        return Invoke-AdministratorControlKernelOperation $archive ([IO.Path]::Combine($binding.Root+'.state','temp')) `
            $binding.Root $Digest $binding.Origin $Id $Control $route.Mode $Target $CallerPid $CallerCreated $SessionId $Sid `
            $verify $audit $startup $request
    } finally { if ($sha) { $sha.Dispose() }; $archive.Dispose() }
}

function Get-AdministratorPauseReceiptBytes([string]$Digest,[string]$Id,[string]$State) {
    if ($Digest -cnotmatch '\A[a-f0-9]{64}\z' -or $Id -cnotmatch '\A[a-f0-9]{32}\z' -or
        $State -cnotin @('pause-recorded','stopped','superseded','fenced')) { throw 'owner_pause_receipt_input' }
    [Text.Encoding]::ASCII.GetBytes(('{{"version":1,"bundleSha256":"{0}","operationId":"{1}","state":"{2}"}}' -f $Digest,$Id,$State) + [char]10)
}

function Read-AdministratorOwnerPause([string]$Directory,[string]$Digest,[string]$Sid,[string]$Id) {
    $unconfirmed = @{operationId=$Id;state='unconfirmed'}
    if ($Digest -cnotmatch '\A[a-f0-9]{64}\z' -or $Id -cnotmatch '\A[a-f0-9]{32}\z') { return $unconfirmed }
    try {
        Assert-SealedAcl $Directory $true $false $Sid
        $found = @{}
        foreach ($state in @('pause-recorded','stopped','superseded','fenced')) {
            $file = [IO.Path]::Combine($Directory,('pause-' + $Id + '.' + $state + '.json'))
            if (Test-AdministratorOwnerAbsent $file) { continue }
            $expected = Get-AdministratorPauseReceiptBytes $Digest $Id $state
            Assert-SealedAcl $file $false $false $Sid
            if ([IO.FileInfo]::new($file).Length -ne $expected.Length -or
                [IO.File]::ReadAllText($file) -cne [Text.Encoding]::ASCII.GetString($expected)) { return $unconfirmed }
            $found[$state] = $true
        }
        if ($found['pause-recorded'] -and -not ($found['fenced'] -or $found['superseded'])) {
            $state = if ($found['stopped']) { 'stopped' } else { 'pause-recorded' }
            return @{operationId=$Id;state=$state}
        }
        if ($found.Count -eq 1 -and ($found['fenced'] -or $found['superseded'])) {
            $state = if ($found['fenced']) { 'fenced' } else { 'superseded' }
            return @{operationId=$Id;state=$state}
        }
        return $unconfirmed
    } catch { return $unconfirmed }
}

function Publish-AdministratorOwnerPause([string]$Directory,[string]$Digest,[string]$Sid,[string]$Id,[string]$State) {
    $bytes = Get-AdministratorPauseReceiptBytes $Digest $Id $State
    Assert-SealedAcl $Directory $true $false $Sid
    $destination = [IO.Path]::Combine($Directory,('pause-' + $Id + '.' + $State + '.json'))
    $temp = [IO.Path]::Combine($Directory,('pause-publish-' + [Guid]::NewGuid().ToString('N') + '.tmp'))
    $stream = Open-SealedNewFile $temp $false $Sid
    try {
        try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        [IO.File]::Move($temp,$destination)
    } finally {
        if ([IO.File]::Exists($temp)) { [IO.File]::Delete($temp) }
    }
}

function Get-AdministratorPauseReservationBytes([string]$Digest,[string]$Id,[string]$Generation) {
    if ($Digest -cnotmatch '\A[a-f0-9]{64}\z' -or $Id -cnotmatch '\A[a-f0-9]{32}\z' -or
        $Generation -cnotmatch '\A(?:[a-f0-9]{32}|idle|unknown)\z') { throw 'owner_pause_receipt_input' }
    [Text.Encoding]::ASCII.GetBytes(('{{"version":1,"bundleSha256":"{0}","operationId":"{1}","generation":"{2}"}}' -f $Digest,$Id,$Generation) + [char]10)
}

function Publish-AdministratorPauseReservation([string]$Vault,[string]$Digest,[string]$Id,[string]$Generation) {
    $bytes = Get-AdministratorPauseReservationBytes $Digest $Id $Generation
    $destination = [IO.Path]::Combine($Vault,('pause-' + $Id + '.reserved.json'))
    $temp = [IO.Path]::Combine($Vault,('pause-reserve-' + [Guid]::NewGuid().ToString('N') + '.tmp'))
    try {
        Write-AdministratorOwnerFile $temp $bytes
        [IO.File]::Move($temp,$destination)
    } finally {
        if ([IO.File]::Exists($temp)) { Assert-SealedAcl $temp $false $true; [IO.File]::Delete($temp) }
    }
}

function Get-AdministratorPauseGeneration([string]$Root,[string]$Vault,[string]$Digest,[string]$Sid) {
    $file = [IO.Path]::Combine($Vault,'owner-job.lease')
    try {
        if (Test-AdministratorOwnerAbsent $file) {
            if (Test-AdministratorOwnerInnerLeasesClear $Root) { return 'idle' }
            return 'unknown'
        }
        Assert-SealedAcl $file $false $true
        $row = Read-AdministratorOwnerObservationDocument $file @('version','bundleSha256','userSid','generation')
        if ($row.version -is [int] -and $row.version -eq 1 -and $row.bundleSha256 -ceq $Digest -and
            $row.userSid -ceq $Sid -and $row.generation -is [string] -and $row.generation -cmatch '\A[a-f0-9]{32}\z') {
            return $row.generation
        }
    } catch { }
    return 'unknown'
}

function Test-AdministratorBrowserPauseTarget([string]$Value) {
    return $Value -cmatch '\A[a-f0-9]{32}:(?:[a-f0-9]{32}|idle)\z'
}

function Read-AdministratorBrowserPauseTargetProjection([string]$BundleRoot,[string]$Digest,[string]$Sid) {
    $directory = $BundleRoot + '.status'
    Assert-SealedAcl $directory $true $false $Sid
    $file = [IO.Path]::Combine($directory,'pause-target.json')
    Assert-SealedAcl $file $false $false $Sid
    $stream = [IO.File]::Open($file,'Open','Read',([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    try {
        if ($stream.Length -lt 1 -or $stream.Length -gt 192) { throw 'browser_pause_target' }
        $reader = [IO.StreamReader]::new($stream,[Text.Encoding]::ASCII,$false)
        try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
        if ($text -cnotmatch '\A\{"version":1,"bundleSha256":"(?<bundle>[a-f0-9]{64})","target":"(?<target>[a-f0-9]{32}:(?:[a-f0-9]{32}|idle))"\}\n\z' -or
            $Matches.bundle -cne $Digest) { throw 'browser_pause_target' }
        return $Matches.target
    } finally { $stream.Dispose() }
}

function Get-AdministratorBrowserControlOwnerState([string]$Root,[string]$Vault) {
    try {
        Assert-SealedAcl $Root $true $true
        Assert-SealedAcl $Vault $true $true
        if (-not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($Vault,'owner-revoked')))) { return 'revoked' }
        $intent=[IO.Path]::Combine($Root,'lifecycle.json')
        try { Assert-SealedAcl $intent $false $true }
        catch { Assert-InheritedPrivateAcl $intent $false }
        if (Test-AdministratorOwnerIntent $Root $true) { return 'paused' }
        if (Test-AdministratorOwnerIntent $Root $false) { return 'running' }
    } catch { }
    return 'unobserved'
}

function Publish-AdministratorBrowserControlSupportProjection([string]$BundleRoot,[string]$Digest,[string]$Sid,[string]$Target) {
    $ownerState=Get-AdministratorBrowserControlOwnerState ($BundleRoot+'.state') ($BundleRoot+'.secrets')
    $bytes=Get-AdministratorControlSupportProjectionBytes $Digest $Target $ownerState
    $directory=$BundleRoot+'.status'
    Ensure-SealedDirectory $directory $false $Sid
    $file=[IO.Path]::Combine($directory,'control-owner.json')
    $temp=[IO.Path]::Combine($directory,('control-owner-'+[Guid]::NewGuid().ToString('N')+'.tmp'))
    try {
        $stream=Open-SealedNewFile $temp $false $Sid
        try { $stream.Write($bytes,0,$bytes.Length);$stream.Flush($true) } finally { $stream.Dispose() }
        if (Test-AdministratorOwnerAbsent $file) { [IO.File]::Move($temp,$file) }
        else {
            Assert-SealedAcl $file $false $false $Sid
            [IO.File]::Replace($temp,$file,[System.Management.Automation.Language.NullString]::Value)
        }
        $row=Read-AdministratorBrowserControlSupportProjection $BundleRoot $Digest $Sid
        if ($row.target -cne $Target -or $row.ownerState -cne $ownerState) { throw 'owner_control_support_readback' }
    } finally { if ([IO.File]::Exists($temp)) { [IO.File]::Delete($temp) } }
}

function Update-AdministratorBrowserPauseTarget([string]$Root,[string]$Vault,[string]$Digest,[string]$Sid,[IO.FileStream]$Gate,
    [switch]$Require) {
    $temp = $null
    try {
        if (-not $Root.EndsWith('.state',[StringComparison]::Ordinal)) { throw 'browser_pause_target' }
        $bundle = $Root.Substring(0,$Root.Length-6)
        $metadata = [IO.Path]::Combine($bundle + '.browser','pause-launch.json')
        if ((Test-AdministratorOwnerAbsent $metadata) -and -not $Require) { return }
        Assert-SealedAcl $metadata $false $false $Sid
        $target = (Read-AdministratorOwnerControlRevision $Gate) + ':' + (Get-AdministratorPauseGeneration $Root $Vault $Digest $Sid)
        if (-not (Test-AdministratorBrowserPauseTarget $target)) { throw 'browser_pause_target' }
        $directory = $bundle + '.status'
        Ensure-SealedDirectory $directory $false $Sid
        $file = [IO.Path]::Combine($directory,'pause-target.json')
        $temp = [IO.Path]::Combine($directory,('pause-target-' + [Guid]::NewGuid().ToString('N') + '.tmp'))
        $bytes = [Text.Encoding]::ASCII.GetBytes(('{{"version":1,"bundleSha256":"{0}","target":"{1}"}}' -f $Digest,$target) + [char]10)
        $stream = Open-SealedNewFile $temp $false $Sid
        try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        if (Test-AdministratorOwnerAbsent $file) { [IO.File]::Move($temp,$file) }
        else {
            Assert-SealedAcl $file $false $false $Sid
            [IO.File]::Replace($temp,$file,[System.Management.Automation.Language.NullString]::Value)
        }
        if ($Require -and (Read-AdministratorBrowserPauseTargetProjection $bundle $Digest $Sid) -cne $target) { throw 'browser_pause_target' }
        Publish-AdministratorBrowserControlSupportProjection $bundle $Digest $Sid $target
    } catch { # The elevated commit still compares the protected live tuple, not this projection.
        if ($Require) { throw }
    } finally { if ($temp -and [IO.File]::Exists($temp)) { try { [IO.File]::Delete($temp) } catch {} } }
}

function Complete-AdministratorOwnerPause([string]$Root,[string]$Vault,[string]$Status,[string]$Digest,
    [string]$Sid,[string]$Generation,[IO.FileStream]$Gate) {
    $ownGate = -not $Gate
    if ($ownGate) { $Gate = Open-AdministratorOwnerControl $Vault }
    try {
        if (-not (Test-AdministratorOwnerIntent $Root $true) -or
            (Get-AdministratorPauseGeneration $Root $Vault $Digest $Sid) -cne 'idle') { return }
        $id = Read-AdministratorOwnerControlRevision $Gate
        if ((Read-AdministratorOwnerPause $Status $Digest $Sid $id).state -cne 'pause-recorded') { return }
        $reservation = [IO.Path]::Combine($Vault,('pause-' + $id + '.reserved.json'))
        $bytes = Get-AdministratorPauseReservationBytes $Digest $id $Generation
        Assert-AdministratorOwnerBytes $reservation $bytes
        Publish-AdministratorOwnerPause $Status $Digest $Sid $id 'stopped'
    } finally { if ($ownGate) { $Gate.Dispose() } }
}

function Request-AdministratorOwnerPause([string]$BundleRoot, [string]$Digest, [string]$Sid,[string]$OperationId = '',
    [string]$BrowserTarget = '',[scriptblock]$VerifyBrowserBinding,[scriptblock]$VerifyInstallationBinding) {
    if ($VerifyInstallationBinding -and ($BrowserTarget -or $VerifyBrowserBinding -or
        $OperationId -cnotmatch '\A[a-f0-9]{32}\z')) { throw 'installation_pause_input' }
    if (($BrowserTarget -or $VerifyBrowserBinding) -and
        (-not (Test-AdministratorBrowserPauseTarget $BrowserTarget) -or -not $VerifyBrowserBinding -or
         $OperationId -cnotmatch '\A[a-f0-9]{32}\z')) { throw 'browser_pause_target' }
    Assert-AdministratorOwnerControlIdentity $BundleRoot $Digest $Sid
    $root = $BundleRoot + '.state'
    $vault = $BundleRoot + '.secrets'
    $status = $BundleRoot + '.status'
    $gate = Open-AdministratorOwnerControl $vault
    try {
        if ($VerifyInstallationBinding) {
            $verified=& $VerifyInstallationBinding
            if ($verified -isnot [bool] -or -not $verified) { throw 'installation_pause_binding' }
        }
        if ($VerifyBrowserBinding) { $null = & $VerifyBrowserBinding }
        if (-not $OperationId) {
            Write-AdministratorOwnerControlRevision $gate
            Write-AdministratorOwnerIntent $root $true
            Update-AdministratorBrowserPauseTarget $root $vault $Digest $Sid $gate
            return
        }
        if ($OperationId -cnotmatch '\A[a-f0-9]{32}\z') { throw 'owner_pause_receipt_input' }
        $reservation = [IO.Path]::Combine($vault,('pause-' + $OperationId + '.reserved.json'))
        if (-not (Test-AdministratorOwnerAbsent $reservation)) {
            return Read-AdministratorOwnerPause $status $Digest $Sid $OperationId
        }
        Ensure-SealedDirectory $status $false $Sid
        $generation = Get-AdministratorPauseGeneration $root $vault $Digest $Sid
        # Reserve before touching intent; any interruption leaves this ID consumed.
        Publish-AdministratorPauseReservation $vault $Digest $OperationId $generation
        if ($BrowserTarget -and ($BrowserTarget -cne ((Read-AdministratorOwnerControlRevision $gate) + ':' + $generation) -or
            -not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($vault,'owner-revoked'))))) {
            Update-AdministratorBrowserPauseTarget $root $vault $Digest $Sid $gate
            Publish-AdministratorOwnerPause $status $Digest $Sid $OperationId 'superseded'
            return Read-AdministratorOwnerPause $status $Digest $Sid $OperationId
        }
        Write-AdministratorOwnerControlRevision $gate $OperationId
        Write-AdministratorOwnerIntent $root $true
        Update-AdministratorBrowserPauseTarget $root $vault $Digest $Sid $gate
        Publish-AdministratorOwnerPause $status $Digest $Sid $OperationId 'pause-recorded'
        if ($generation -ceq 'idle') { Publish-AdministratorOwnerPause $status $Digest $Sid $OperationId 'stopped' }
        return Read-AdministratorOwnerPause $status $Digest $Sid $OperationId
    } finally { $gate.Dispose() }
}

function Fence-AdministratorOwnerPause([string]$BundleRoot,[string]$Digest,[string]$Sid,[string]$OperationId,
    [scriptblock]$VerifyBrowserBinding) {
    if ($OperationId -cnotmatch '\A[a-f0-9]{32}\z' -or -not $VerifyBrowserBinding) { throw 'owner_pause_receipt_input' }
    Assert-AdministratorOwnerControlIdentity $BundleRoot $Digest $Sid
    $vault = $BundleRoot + '.secrets'
    $status = $BundleRoot + '.status'
    $gate = Open-AdministratorOwnerControl $vault
    try {
        $null = & $VerifyBrowserBinding
        $receipt = Read-AdministratorOwnerPause $status $Digest $Sid $OperationId
        if ($receipt.state -cne 'unconfirmed') { return $receipt }
        foreach ($state in @('pause-recorded','stopped','superseded','fenced')) {
            if (-not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($status,('pause-' + $OperationId + '.' + $state + '.json'))))) {
                return $receipt
            }
        }
        $reservation = [IO.Path]::Combine($vault,('pause-' + $OperationId + '.reserved.json'))
        if (Test-AdministratorOwnerAbsent $reservation) {
            Publish-AdministratorPauseReservation $vault $Digest $OperationId 'unknown'
        } else {
            # Legacy partial reservations still fence replay by existence; do not infer their prior effect.
            Assert-SealedAcl $reservation $false $true
        }
        Ensure-SealedDirectory $status $false $Sid
        Publish-AdministratorOwnerPause $status $Digest $Sid $OperationId 'fenced'
        return Read-AdministratorOwnerPause $status $Digest $Sid $OperationId
    } finally { $gate.Dispose() }
}

function Repair-AdministratorBrowserPauseTarget([string]$BundleRoot,[string]$Digest,[string]$Sid,[scriptblock]$VerifyBrowserBinding) {
    if (-not $VerifyBrowserBinding) { throw 'browser_pause_target' }
    Assert-AdministratorOwnerControlIdentity $BundleRoot $Digest $Sid
    $vault = $BundleRoot + '.secrets'
    $gate = Open-AdministratorOwnerControl $vault
    try {
        $null = & $VerifyBrowserBinding
        if (-not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($vault,'owner-revoked')))) { throw 'browser_owner_unavailable' }
        Update-AdministratorBrowserPauseTarget ($BundleRoot + '.state') $vault $Digest $Sid $gate -Require
        return Read-AdministratorBrowserPauseTargetProjection $BundleRoot $Digest $Sid
    } finally { $gate.Dispose() }
}

function Request-AdministratorOwnerRevocation([string]$BundleRoot, [string]$Digest, [string]$Sid) {
    Assert-AdministratorOwnerControlIdentity $BundleRoot $Digest $Sid
    $vault = $BundleRoot + '.secrets'
    $file = [IO.Path]::Combine($vault,'owner-revoked')
    $gate = $null
    try {
        if (-not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($vault,'owner-control.guard')))) {
            $gate = Open-AdministratorOwnerControl $vault
        }
        Write-HostedWindowSignal $file
        Assert-SealedAcl $file $false $true
        if ([IO.FileInfo]::new($file).Length -ne 0) { throw 'owner_revocation_readback' }
        if ($gate) { Update-AdministratorBrowserPauseTarget ($BundleRoot+'.state') $vault $Digest $Sid $gate }
    } finally { if ($gate) { $gate.Dispose() } }
}

function Assert-AdministratorReauthorizationQuiescence([string]$BundleRoot,[string]$Digest,[string]$Sid,
    [string]$Origin,$Handles) {
    $vault=$BundleRoot+'.secrets'; $status=$BundleRoot+'.status'
    $files=@([IO.Directory]::GetFiles($vault,'control-*'))
    if ($files.Count -gt 4096) { throw 'reauthorization_history_limit' }
    foreach ($file in $files) {
        $name=[IO.Path]::GetFileName($file)
        if ($name -cmatch '\Acontrol-([a-f0-9]{32})\.execution\.lock\z') {
            Assert-SealedAcl $file $false $true
            $Handles.Add([IO.File]::Open($file,'Open','ReadWrite','None'))
        }
    }
    foreach ($file in $files) {
        $name=[IO.Path]::GetFileName($file)
        if ($name -cmatch '\Acontrol-([a-f0-9]{32})\.reserved\.json\z') {
            $operation=$Matches[1]
            $row=ConvertFrom-Json -InputObject ([Text.UTF8Encoding]::new($false,$true).GetString(
                (Read-AdministratorControlBytes $file $true $Sid)))
            $record=Read-AdministratorControlRecord $vault $Digest $Sid $Origin $operation $row.control
            $receipt=Read-AdministratorControlReceipt $status $Digest $Sid $operation $row.control
            if (-not $record -or $receipt.state -cnotin @('launch-requested','stopped','superseded','rejected','fenced','abandoned','recovered-paused') -or
                -not (Test-AdministratorControlRunnerExited $record.runnerIdentity)) { throw 'reauthorization_unsettled_operation' }
        } elseif ($name -cmatch '\Acontrol-([a-f0-9]{32})\.peer\.json\z') {
            $handoff=$Matches[1]
            $row=ConvertFrom-Json -InputObject ([Text.UTF8Encoding]::new($false,$true).GetString(
                (Read-AdministratorControlBytes $file $true $Sid)))
            if (-not (Test-AdministratorControlFields $row @('version','kind','bundleSha256','userSid','origin','operationId','control','mode','handoffId','runnerIdentity','sessionEvidence')) -or
                $row.version -ne 1 -or $row.kind -cne 'control-peer' -or $row.bundleSha256 -cne $Digest -or
                $row.userSid -cne $Sid -or $row.origin -cne $Origin -or $row.handoffId -cne $handoff -or
                -not (Test-AdministratorControlRunnerExited $row.runnerIdentity)) { throw 'reauthorization_live_peer' }
            $null=Get-AdministratorControlHandoffAckBytes $Digest $row.operationId $row.control $row.mode $handoff
        }
    }
}

function Restore-AdministratorOwnerAuthorization([string]$BundleRoot,[string]$Digest,[string]$Sid,
    [string]$Origin,[string]$PreviousId,[string]$Id,[scriptblock]$VerifyBinding) {
    if ($Digest -cnotmatch '\A[a-f0-9]{64}\z' -or $PreviousId -cnotmatch '\A[a-f0-9]{32}\z' -or
        $Id -cnotmatch '\A[a-f0-9]{32}\z' -or $Id -ceq $PreviousId -or
        $Origin -cnotmatch '\Achrome-extension://[a-p]{32}/\z' -or -not $VerifyBinding) { throw 'reauthorization_input' }
    Assert-AdministratorOwnerControlIdentity $BundleRoot $Digest $Sid
    $root=$BundleRoot+'.state'; $vault=$BundleRoot+'.secrets'; $status=$BundleRoot+'.status'
    $prefix=[IO.Path]::Combine($vault,('reauthorization-'+$Id))
    $gate=Open-AdministratorOwnerControl $vault
    $handles=[Collections.Generic.List[IO.FileStream]]::new()
    try {
        # A known or uncertain old attempt is never an instruction to mutate again.
        foreach ($suffix in @('.started.json','.committed.json','.revoked')) {
            if (-not (Test-AdministratorOwnerAbsent ($prefix+$suffix))) { throw 'reauthorization_id_exists' }
        }
        if ((Read-AdministratorOwnerControlRevision $gate) -cne $PreviousId -or
            -not (Read-AdministratorControlRecord $vault $Digest $Sid $Origin $PreviousId 'revoke') -or
            (Read-AdministratorControlReceipt $status $Digest $Sid $PreviousId 'revoke').state -cne 'stopped' -or
            -not (Test-AdministratorOwnerIntent $root $true) -or
            (Get-AdministratorPauseGeneration $root $vault $Digest $Sid) -cne 'idle') { throw 'reauthorization_not_stopped' }
        $deny=[IO.Path]::Combine($vault,'owner-revoked')
        Assert-SealedAcl $deny $false $true
        if ([IO.FileInfo]::new($deny).Length -ne 0) { throw 'reauthorization_marker' }
        Assert-AdministratorReauthorizationQuiescence $BundleRoot $Digest $Sid $Origin $handles
        $null=& $VerifyBinding $gate
        $record=[ordered]@{version=1;kind='administrator-reauthorization';bundleSha256=$Digest;userSid=$Sid;
            origin=$Origin;previousRevocationId=$PreviousId;reauthorizationId=$Id;paused=$true}
        $bytes=[Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $record -Compress)+[char]10)
        Write-AdministratorOwnerFile ($prefix+'.started.json') $bytes
        Write-AdministratorOwnerControlRevision $gate $Id
        # Commit once by archiving the old deny marker. Paused intent is unchanged.
        [IO.File]::Move($deny,($prefix+'.revoked'))
        Assert-SealedAcl ($prefix+'.revoked') $false $true
        $recorded=$false
        try { Write-AdministratorOwnerFile ($prefix+'.committed.json') $bytes; $recorded=$true } catch { }
        $projected=$false
        try { Update-AdministratorBrowserPauseTarget $root $vault $Digest $Sid $gate -Require; $projected=$true } catch { }
        return [ordered]@{ok=($recorded -and $projected);authorized=$true;paused=$true;reauthorizationId=$Id;
            commitReceiptVerified=$recorded;projectionVerified=$projected;registrationChanged=$false;tunnelStarted=$false}
    } finally {
        foreach ($handle in $handles) { $handle.Dispose() }
        $gate.Dispose()
    }
}

function New-AdministratorHostedLaunchPlan([string]$BundleRoot, [string]$StateRoot, [string]$Digest,
    [string]$Sid, [string]$TunnelId) {
    $vault = $BundleRoot + '.secrets'
    $expected = Get-AdministratorHostedMetadata $BundleRoot $StateRoot $Digest $Sid $TunnelId
    Assert-AdministratorHostedVault $vault $expected.profile $expected.receipt
    $plan = New-AdministratorLaunchPlan $BundleRoot $StateRoot
    $plan.FileName = [IO.Path]::Combine($BundleRoot,'client\tunnel-client-runtime.exe')
    Assert-PathType $plan.FileName $false
    $plan.Arguments = 'run --profile-file "' + [IO.Path]::Combine($vault,'tunnel.yaml') + '"'
    return $plan
}

function Write-HostedWindowSignal([string]$File) {
    try { $stream = Open-SealedNewFile $File $true }
    catch {
        if (-not [IO.File]::Exists($File)) { throw }
        Assert-SealedAcl $File $false $true
        return
    }
    $stream.Dispose()
}

function Request-HostedWindowStop([string]$BundleRoot, [string]$Digest, [string]$Id) {
    $prefix = $BundleRoot + '.receipt-' + $Id
    $started = $prefix + '.started.json'
    Assert-SealedAcl $started $false $true
    if ([IO.FileInfo]::new($started).Length -gt 512) { throw 'window_receipt' }
    $doc = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($started))
    if ($doc.receiptId -cne $Id -or $doc.bundleSha256 -cne $Digest -or $doc.action -cne 'RunHostedWindow' -or
        $doc.state -cne 'started' -or $doc.pid -isnot [int] -or $doc.pid -le 0) { throw 'window_receipt' }
    if (-not [IO.File]::Exists($prefix + '.result.json')) { Write-HostedWindowSignal ($prefix + '.stop') }
}

function Read-PriorReadOnlyWindow([string]$BundleRoot, [string]$StateRoot, [string]$Digest, [string]$Id,
    [switch]$Unused) {
    if ($Id -cnotmatch '\A[a-f0-9]{32}\z') { throw 'window_receipt' }
    $prefix = $BundleRoot + '.receipt-' + $Id
    $docs = @()
    foreach ($name in @('.started.json','.result.json')) {
        $file = $prefix + $name
        Assert-SealedAcl $file $false $true
        $doc = ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString((Read-HostedWindowBytes $file 2048)))
        if ($doc.receiptId -cne $Id -or $doc.bundleSha256 -cne $Digest) { throw 'window_receipt' }
        $docs += $doc
    }
    if ($docs[0].action -cne 'RunHostedWindow' -or $docs[0].state -cne 'started' -or
        $docs[1].result.ok -isnot [bool] -or -not $docs[1].result.ok -or
        $docs[1].result.phase -cne 'complete' -or $docs[1].result.hostedWindowStoppedConfirmed -isnot [bool] -or
        -not $docs[1].result.hostedWindowStoppedConfirmed -or
        $docs[1].result.hostedWindowOutcome -cnotin @('stop-requested','window-expired')) { throw 'window_receipt' }
    Assert-SealedAcl $StateRoot $true $true
    Assert-SealedAcl ([IO.Path]::Combine($StateRoot,'work')) $true $true
    $stem = 'work/acceptance-' + $Id
    $planFile = [IO.Path]::Combine($StateRoot,$stem.Replace('/','\') + '.plan.json')
    Assert-SealedAcl $planFile $false $true
    $plan = ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString((Read-HostedWindowBytes $planFile 65536)))
    $ids = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $receiptDirectory = 'acceptance-' + $Id + '-receipts'
    $receiptRoot = [IO.Path]::Combine($StateRoot,$receiptDirectory)
    Assert-InheritedPrivateAcl $receiptRoot $true
    $expectedReceipts = @()
    if ($plan -isnot [array] -or $plan.Count -lt 1 -or $plan.Count -gt 12) { throw 'window_receipt' }
    if ($Unused -and @([IO.Directory]::EnumerateFileSystemEntries($receiptRoot)).Count -ne 0) { throw 'window_receipt' }
    foreach ($step in $plan) {
        if ($step.id -cnotmatch '\A[a-f0-9]{32}\z' -or -not $ids.Add($step.id)) { throw 'window_receipt' }
        if ($Unused) { continue }
        if ($step.name -cne 'read_file') { throw 'window_receipt' }
        foreach ($suffix in @('.admitted','.provider-replied')) {
            $name = $step.id + $suffix
            $receipt = [IO.Path]::Combine($receiptRoot,$name)
            Assert-InheritedPrivateAcl $receipt $false
            if ([IO.FileInfo]::new($receipt).Length -ne 0) { throw 'window_receipt' }
            $expectedReceipts += $name
        }
    }
    return @{sealedFiles=@(($stem+'.plan.json'),($stem+'.runner.mjs'),($stem+'.profile.yaml'));
        receiptDirectory=$receiptDirectory;expectedReceipts=$expectedReceipts}
}

function Assert-ReadOnlyProviderConfig([string]$File, [string]$Baseline) {
    $expected = ConvertFrom-Json -InputObject $Baseline
    $actual = ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString((Read-HostedWindowBytes $File 65536)))
    $expectedKeys = @($expected.PSObject.Properties.Name)
    $actualKeys = @($actual.PSObject.Properties.Name)
    if ($actual -isnot [pscustomobject] -or $actualKeys.Count -ne ($expectedKeys.Count + 1) -or
        $actualKeys -cnotcontains 'usageStats' -or $actual.usageStats -isnot [pscustomobject]) { throw 'state_content' }
    foreach ($key in $expectedKeys) {
        if ($actualKeys -cnotcontains $key -or
            (ConvertTo-Json -InputObject $actual.$key -Depth 6 -Compress) -cne
            (ConvertTo-Json -InputObject $expected.$key -Depth 6 -Compress)) { throw 'state_content' }
    }
}

function Read-HostedWindowBytes([string]$File, [int]$MaxBytes) {
    if ($File -notmatch '\A[A-Z]:\\[^\\]' -or $File.Substring(2) -match '[\x00-\x1f<>:"|?*/]' -or
        $File -ine [IO.Path]::GetFullPath($File)) { throw 'window_source' }
    Assert-PathType $File $false
    $sourceStream = [IO.File]::Open($File,'Open','Read','Read')
    try {
        if ($sourceStream.Length -lt 1 -or $sourceStream.Length -gt $MaxBytes) { throw 'window_source' }
        $bytes = [byte[]]::new([int]$sourceStream.Length)
        $count = 0
        while ($count -lt $bytes.Length) {
            $n = $sourceStream.Read($bytes,$count,$bytes.Length-$count)
            if (-not $n) { throw 'window_source' }
            $count += $n
        }
        if ($sourceStream.ReadByte() -ne -1) { throw 'window_source' }
    } finally { $sourceStream.Dispose() }
    return ,$bytes
}

function Read-HostedWindowSource([string]$File, [string]$ExpectedDigest = '71c9b752bdcc2edbbf8c2804db91c096c6ba72a7a9e31c7976cee8a1f62e7231') {
    $utf8 = [Text.UTF8Encoding]::new($false,$true)
    $bytes = Read-HostedWindowBytes $File 16384
    $source = $utf8.GetString($bytes).Replace("`r`n","`n")
    $bytes = $utf8.GetBytes($source)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        if ((To-Hex $sha.ComputeHash($bytes)) -cne $ExpectedDigest) { throw 'window_source' }
        return [Convert]::ToBase64String($bytes)
    } finally { $sha.Dispose() }
}

function Write-HostedAcceptanceProfile([string]$BundleRoot, [string]$StateRoot, [string]$Id, [string]$TunnelId,
    [string]$AdmissionSource, [string]$PlanSource, [string]$PlanSha256) {
    $module = Read-HostedWindowSource $AdmissionSource 'a9c8ec01244f55a3f66195f34313dba67cf9cec0bdaf7bef3d6bb8a2a79625bf'
    $plan = Read-HostedWindowBytes $PlanSource 65536
    $sha = [Security.Cryptography.SHA256]::Create()
    try { if ((To-Hex $sha.ComputeHash($plan)) -cne $PlanSha256) { throw 'acceptance_plan_digest' } }
    finally { $sha.Dispose() }
    $base = [IO.Path]::Combine($StateRoot,'work','acceptance-' + $Id)
    $planFile = $base + '.plan.json'
    $config = @{bundle=$BundleRoot;stateRoot=$StateRoot;planFile=$planFile;
        receiptDir=[IO.Path]::Combine($StateRoot,'acceptance-' + $Id + '-receipts')} | ConvertTo-Json -Compress
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($config))
    $code = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($module)) + [char]10 +
        "runHostedAcceptanceStdio(JSON.parse(Buffer.from('$encoded','base64').toString('utf8'))).catch(()=>{process.exitCode=1;});"
    $node = [IO.Path]::Combine($BundleRoot,'runtime','node.exe').Replace('\','/')
    $profile = New-AdministratorHostedDocument $BundleRoot $StateRoot $TunnelId
    $runnerFile = $base + '.runner.mjs'
    $profile.mcp.commands[0].command = '"' + $node + '" --no-global-search-paths "' + $runnerFile.Replace('\','/') + '"'
    $stream = Open-SealedNewFile $planFile $true
    try { $stream.Write($plan,0,$plan.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    $bytes = [Text.Encoding]::UTF8.GetBytes($code)
    $stream = Open-SealedNewFile $runnerFile $true
    try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    $bytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $profile -Depth 8 -Compress) + [char]10)
    $stream = Open-SealedNewFile ($base + '.profile.yaml') $true
    try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}

function Invoke-AdministratorHostedWindow([string]$BundleRoot, [string]$StateRoot, [string]$Id, [int]$Seconds, [string]$Source, [bool]$Guarded = $false) {
    $module = Read-HostedWindowSource $Source
    $settings = @{bundle=$BundleRoot;receiptId=$Id;windowMs=($Seconds * 1000);guarded=$Guarded} | ConvertTo-Json -Compress
    $config = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($settings))
    $code = "const write = msg => console.log(JSON.stringify(msg)); import('data:text/javascript;base64,$module').then(m => m.runProtectedHostedWindow(JSON.parse(Buffer.from('$config','base64').toString('utf8')),write)).then(result => write({state:'finished',result}), () => {process.exitCode=1; write({state:'unconfirmed'});});"
    $launch = New-AdministratorLaunchPlan $BundleRoot $StateRoot
    $launch.Arguments = '--no-global-search-paths --eval "' + $code + '"'
    $launch.RedirectStandardOutput = $true
    $launch.RedirectStandardError = $true
    $launch.StandardOutputEncoding = [Text.UTF8Encoding]::new($false,$true)
    $launch.StandardErrorEncoding = $launch.StandardOutputEncoding
    $prefix = $BundleRoot + '.receipt-' + $Id
    $seenReady = $false
    $complete = $false
    $child = [Diagnostics.Process]::Start($launch)
    try {
        $discard = $child.StandardError.ReadToEndAsync()
        $deadline = [Diagnostics.Stopwatch]::StartNew()
        for ($i=0; $i -lt 2; $i++) {
            $line = $child.StandardOutput.ReadLineAsync()
            $budget = if ($seenReady) { ($Seconds + 60) * 1000 - $deadline.ElapsedMilliseconds } else { 45000 }
            if (-not $line.Wait([int][Math]::Max(0,$budget)) -or -not $line.Result -or $line.Result.Length -gt 1024) { throw 'window_unconfirmed' }
            $message = ConvertFrom-Json -InputObject $line.Result
            if ($message.state -ceq 'ready' -and -not $seenReady) {
                Write-HostedWindowSignal ($prefix + '.ready')
                $seenReady = $true
            } elseif ($message.state -ceq 'finished' -and $message.result.paused -eq $true -and
                $message.result.controllerReleased -eq $true -and $message.result.wasReady -is [bool] -and
                $message.result.outcome -cin @('stop-requested','window-expired','start-unconfirmed','acceptance-error')) {
                if (-not $child.WaitForExit(5000) -or $child.ExitCode -ne 0 -or -not $discard.Wait(5000) -or $discard.Result) { throw 'window_unconfirmed' }
                $complete = $true
                return $message.result
            } else { throw 'window_unconfirmed' }
        }
        throw 'window_unconfirmed'
    } finally {
        if (-not $complete) { Write-HostedWindowSignal ($prefix + '.stop') }
        $child.Dispose()
    }
}

function Write-AdministratorHostedBinding([string]$BundleRoot, [string]$StateRoot, [string]$Digest,
    [string]$Sid, [string]$TunnelId, [Security.SecureString]$Secret) {
    $vault = $BundleRoot + '.secrets'
    if ([IO.Directory]::Exists($vault) -or [IO.File]::Exists($vault)) { throw 'binding_exists' }
    $expected = Get-AdministratorHostedMetadata $BundleRoot $StateRoot $Digest $Sid $TunnelId
    $keyBytes = Get-AdministratorRuntimeKeyBytes $Secret
    try {
        Ensure-SealedDirectory $vault $true
        foreach ($name in @('runtime.key','tunnel.yaml','binding.json')) {
            $bytes = switch ($name) {
                'runtime.key' { ,$keyBytes }
                'tunnel.yaml' { ,$expected.profile }
                'binding.json' { ,$expected.receipt }
            }
            $file = [IO.Path]::Combine($vault,$name)
            $stream = Open-SealedNewFile $file $true
            try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) }
            finally { $stream.Dispose() }
        }
        Assert-AdministratorHostedVault $vault $expected.profile $expected.receipt
    } finally { [Array]::Clear($keyBytes,0,$keyBytes.Length) }
}

function Read-LocalProbeReply($Child, [int]$Id) {
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    for ($attempt=0; $attempt -lt 12; $attempt++) {
        $next = $Child.StandardOutput.ReadLineAsync()
        if (-not $next.Wait([Math]::Max(0,20000 - [int]$deadline.ElapsedMilliseconds)) -or
            $null -eq $next.Result -or $next.Result.Length -gt 262144) { throw 'probe_no_reply' }
        $reply = ConvertFrom-Json -InputObject $next.Result
        if ($reply.jsonrpc -cne '2.0') { throw 'probe_invalid_reply' }
        if ($reply.id -is [int] -and $reply.id -eq $Id -and $null -ne $reply.result -and
            $null -eq $reply.error) { return $reply.result }
        if ($null -ne $reply.id -or $reply.method -isnot [string]) { throw 'probe_invalid_reply' }
    }
    throw 'probe_no_reply'
}

function Send-LocalProbeRequest($Child, [string]$Method, [int]$Id, $Parameters) {
    $request = @{jsonrpc='2.0';method=$Method;params=$Parameters}
    if ($Id) { $request.id = $Id }
    $Child.StandardInput.WriteLine((ConvertTo-Json -InputObject $request -Depth 8 -Compress))
    $Child.StandardInput.Flush()
}

function Test-LocalProbeResult($Result, [string]$Nonce) {
    if ($Nonce -cnotmatch '\A[0-9a-f]{32}\z' -or $null -eq $Result -or $Result.isError -or @($Result.content).Count -ne 1 -or
        $Result.content[0].type -cne 'text' -or $Result.content[0].text -isnot [string]) { return $false }
    $output = $Result.content[0].text
    $start = [regex]::Matches($output,'(?m)^Process started with PID ([1-9][0-9]{0,9})(?:\s|$)')
    if ($start.Count -ne 1) { return $false }
    $pidText = $start[0].Groups[1].Value
    $marker = [regex]::Matches($output,('(?m)^AC_LOCAL_TOKEN_' + $Nonce + ':' + $pidText + '\r?$'))
    $done = [regex]::Matches($output,('(?m)^(?:\u2705 )?Process ' + $pidText + ' has finished execution\r?$'))
    return $marker.Count -eq 1 -and $done.Count -eq 1 -and
        $start[0].Index -lt $marker[0].Index -and $marker[0].Index -lt $done[0].Index
}

function Get-LocalProbeFailureCode($Result, [string]$Nonce) {
    if ($Nonce -cnotmatch '\A[0-9a-f]{32}\z' -or $null -eq $Result -or @($Result.content).Count -ne 1 -or
        $Result.content[0].text -isnot [string]) { return 'probe_child_token' }
    $output = $Result.content[0].text
    $start = [regex]::Matches($output,'(?m)^Process started with PID ([1-9][0-9]{0,9})(?:\s|$)')
    if ($start.Count -ne 1) { return 'probe_child_token' }
    $pidText = $start[0].Groups[1].Value
    $errors = [regex]::Matches($output,('(?m)^AC_LOCAL_FAILURE_' + $Nonce + ':' + $pidText +
        ':(flags|impersonation|native_setup|native_exception|account|role|elevation|integrity|token_read)\r?$'))
    if ($errors.Count -eq 1 -and $errors[0].Index -gt $start[0].Index) { return 'probe_token_' + $errors[0].Groups[1].Value }
    return 'probe_child_token'
}

function Get-LocalProbeProcessId($Result) {
    if ($null -eq $Result -or $Result.isError -or @($Result.content).Count -ne 1 -or
        $Result.content[0].type -cne 'text' -or $Result.content[0].text -isnot [string]) { return 0 }
    $start = [regex]::Matches($Result.content[0].text,'(?m)^Process started with PID ([1-9][0-9]{0,9}) \(shell: [^\r\n]+\)\r?$')
    $processId = 0
    if ($start.Count -ne 1 -or $start[0].Index -ne 0 -or
        -not [int]::TryParse($start[0].Groups[1].Value,[ref]$processId)) { return 0 }
    # The pinned packaged provider can omit structuredContent entirely.
    if ($null -ne $Result.structuredContent -and
        ($Result.structuredContent.pid -isnot [int] -or $Result.structuredContent.pid -ne $processId)) { return 0 }
    return $processId
}

function Read-LocalProbeCompletion($Result, [string]$Nonce, [int]$ProcessId) {
    if ($null -eq $Result -or $Result.isError -or @($Result.content).Count -ne 1 -or
        $Result.content[0].type -cne 'text' -or $Result.content[0].text -isnot [string]) { return 'probe_process_readback' }
    $output = $Result.content[0].text
    $done = [regex]::Matches($output,'(?m)^(?:\u2705 )?Process completed with (?:exit code (-?[0-9]+)|signal [A-Z0-9]+)(?: \(runtime: [0-9]+(?:\.[0-9]+)?s\))?\r?$')
    if ($done.Count -eq 0) { return 'pending' }
    if ($done.Count -ne 1 -or $Nonce -cnotmatch '\A[0-9a-f]{32}\z' -or $ProcessId -le 0) { return 'probe_process_readback' }
    $failure = [pscustomobject]@{content=@([pscustomobject]@{text=("Process started with PID $ProcessId`n" + $output)})}
    $code = Get-LocalProbeFailureCode $failure $Nonce
    if ($code -cne 'probe_child_token') { return $code }
    if ($done[0].Groups[1].Value -cne '0') { return 'probe_process_nonzero' }
    $marker = [regex]::Matches($output,('(?m)^AC_LOCAL_TOKEN_' + $Nonce + ':' + $ProcessId + '\r?$'))
    if ($marker.Count -ne 1 -or $marker[0].Index -ge $done[0].Index) { return 'probe_marker_missing' }
    return 'ok'
}

function Invoke-LocalTokenProbe([string]$BundleRoot, [string]$ProbeRoot, [string]$Sid,
    [ValidateSet('standard','administrator')][string]$Role) {
    if ($Sid -cnotmatch '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z') { throw 'probe_identity' }
    $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
    $powerShellHome = [IO.Path]::Combine($system,'WindowsPowerShell\v1.0')
    $shell = [IO.Path]::Combine($powerShellHome,'powershell.exe')
    $utility = [IO.Path]::Combine($powerShellHome,'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')
    Import-Module -Name $utility -ErrorAction Stop
    $nonce = [Guid]::NewGuid().ToString('N')
    # Fixed command: prove the actual PowerShell process token, not the Node parent or UAC receipt.
    $command = @'
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
function Stop-AcLocalProbe($code) {
    [Console]::WriteLine('AC_LOCAL_FAILURE___NONCE__:' + $PID + ':' + $code)
    exit 31
}
$argv=[Environment]::GetCommandLineArgs()
if($argv.Length -lt 6 -or $argv[1] -cne '-NoLogo' -or $argv[2] -cne '-NoProfile' -or
    $argv[3] -cne '-NonInteractive' -or $argv[4] -cne '-Command'){Stop-AcLocalProbe 'flags'}
$thread=[Security.Principal.WindowsIdentity]::GetCurrent($true)
if($thread){$thread.Dispose();Stop-AcLocalProbe 'impersonation'}
try {
Import-Module ([IO.Path]::Combine($PSHOME,'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;
public static class AcLocalToken {
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("advapi32.dll",SetLastError=true)]
  static extern bool OpenProcessToken(IntPtr process,uint access,out SafeAccessTokenHandle token);
  [DllImport("advapi32.dll",SetLastError=true)]
  static extern bool GetTokenInformation(SafeAccessTokenHandle token,int kind,IntPtr buffer,int size,out int length);
  public static string Verify(string user,bool admin) {
    SafeAccessTokenHandle token;
    if(!OpenProcessToken(GetCurrentProcess(),8,out token)) return "token_read";
    using(token) using(var identity=WindowsIdentity.GetCurrent()) {
      if(identity.User.Value!=user) return "account";
      if(new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator)!=admin) return "role";
      IntPtr p=Marshal.AllocHGlobal(4096);
      try {
        int n;
        if(!GetTokenInformation(token,1,p,4096,out n) || n<IntPtr.Size || n>4096) return "token_read";
        if(new SecurityIdentifier(Marshal.ReadIntPtr(p)).Value!=user) return "account";
        if(!GetTokenInformation(token,20,p,4,out n) || n!=4) return "token_read";
        if(Marshal.ReadInt32(p)!=(admin?1:0)) return "elevation";
        if(!GetTokenInformation(token,25,p,4096,out n) || n<IntPtr.Size || n>4096) return "token_read";
        string label=new SecurityIdentifier(Marshal.ReadIntPtr(p)).Value;
        uint rid;
        return label.StartsWith("S-1-16-",StringComparison.Ordinal) && UInt32.TryParse(label.Substring(7),out rid) &&
          (admin ? rid>=12288 && rid<16384 : rid>=8192 && rid<12288) ? "ok" : "integrity";
      } finally { Marshal.FreeHGlobal(p); }
    }
  }
}
"@
} catch { Stop-AcLocalProbe 'native_setup' }
try { $result=[AcLocalToken]::Verify('__SID__',__ADMIN__) } catch { Stop-AcLocalProbe 'native_exception' }
if($result -cne 'ok'){Stop-AcLocalProbe $result}
[Console]::WriteLine('AC_LOCAL_TOKEN___NONCE__:' + $PID)
'@
    $command = $command.Replace('__SID__',$Sid).Replace('__NONCE__',$nonce).Replace('__ADMIN__',
        $(if ($Role -ceq 'administrator') { '$true' } else { '$false' }))
    $launch = New-AdministratorLaunchPlan $BundleRoot $ProbeRoot
    $launch.RedirectStandardInput = $true
    $launch.RedirectStandardOutput = $true
    $launch.RedirectStandardError = $true
    # Node emits UTF-8 JSONL regardless of the Windows console code page.
    $launch.StandardOutputEncoding = [Text.UTF8Encoding]::new($false,$true)
    $launch.StandardErrorEncoding = $launch.StandardOutputEncoding
    try { $child = [Diagnostics.Process]::Start($launch) } catch { throw 'probe_provider_start' }
    try {
        $errors = $child.StandardError.ReadToEndAsync()
        Send-LocalProbeRequest $child 'initialize' 1 @{
            protocolVersion='2025-11-25';capabilities=@{};clientInfo=@{name='agent-continue-local-token-probe';version='1.0.0'}
        }
        try { $init = Read-LocalProbeReply $child 1 } catch { throw 'probe_provider_init' }
        if ($init.serverInfo.name -cne 'desktop-commander' -or $init.serverInfo.version -cne '0.3.1') {
            throw 'probe_provider'
        }
        Send-LocalProbeRequest $child 'notifications/initialized' 0 @{}
        Send-LocalProbeRequest $child 'tools/call' 2 @{name='start_process';arguments=@{
            command=$command;shell=$shell;timeout_ms=5000
        }}
        try { $result = Read-LocalProbeReply $child 2 } catch { throw 'probe_tool_reply' }
        $proofPid = Get-LocalProbeProcessId $result
        if (-not $proofPid) { throw 'probe_process_start_receipt' }
        # Initial output can be partial; read the same process without executing again.
        $deadline = [Diagnostics.Stopwatch]::StartNew()
        $status = 'pending'
        for ($requestId = 3; $status -ceq 'pending' -and $deadline.ElapsedMilliseconds -lt 40000; $requestId++) {
            Send-LocalProbeRequest $child 'tools/call' $requestId @{name='read_process_output';arguments=@{
                pid=$proofPid;offset=-64;length=64;timeout_ms=1000
            }}
            try { $followup = Read-LocalProbeReply $child $requestId } catch { throw 'probe_process_readback' }
            $status = Read-LocalProbeCompletion $followup $nonce $proofPid
            if ($status -ceq 'pending') { [Threading.Thread]::Sleep(500) }
        }
        if ($status -ceq 'pending') { throw 'probe_process_incomplete' }
        if ($status -cne 'ok') { throw $status }
        $child.StandardInput.Close()
        if (-not $child.WaitForExit(5000) -or $child.ExitCode -ne 0 -or -not $errors.Wait(5000) -or
            $errors.Result) { throw 'probe_shutdown' }
    } finally {
        # Close only our one-shot provider's input. Do not kill, replay, or remove uncertain state.
        $child.StandardInput.Close()
        $null = $child.WaitForExit(5000)
        $child.Dispose()
    }
}

function Remove-CompletedLocalProbe([string]$BundleRoot, [string]$ProbeRoot) {
    if ($ProbeRoot -cnotmatch ('\A' + [regex]::Escape($BundleRoot) + '\.probe-[0-9a-f]{32}\z') -or
        $ProbeRoot -cne [IO.Path]::GetFullPath($ProbeRoot)) { throw 'probe_cleanup_path' }
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push($ProbeRoot)
    while ($pending.Count) {
        $dir = $pending.Pop()
        Assert-PathType $dir $true
        foreach ($member in [IO.Directory]::EnumerateFileSystemEntries($dir)) {
            $attrs = [IO.File]::GetAttributes($member)
            if ($attrs -band [IO.FileAttributes]::ReparsePoint) { throw 'probe_cleanup_reparse' }
            if ($attrs -band [IO.FileAttributes]::Directory) { $pending.Push($member) }
        }
    }
    [IO.Directory]::Delete($ProbeRoot,$true)
}

function Assert-AdministratorInstallClosure($Layout) {
    $runtime = @('device-native-host.mjs','device-operations.mjs','device-owner.mjs','device-server.mjs','device-ssh.mjs',
        'host.mjs','lifecycle.mjs','operation-receipts.mjs','package-lock.json','package.json','prepared-process.mjs',
        'process-observation.mjs','profile.mjs','research-handoff.mjs','research-runner.mjs','runtime.mjs','setup-cli.mjs',
        'tunnel-pins.json','upstream-pin.json','windows-child.mjs','windows-process-query.cs','windows-admin-owner.mjs',
        'windows-admin-browser-host.mjs','windows-admin-demand.mjs','windows-admin-intent.mjs','windows-owner-job.cs',
        'windows-admin-browser-session.mjs','windows-browser-peer.cs','windows-browser-peer.ps1','agent-continue-build-evidence.json')
    $required = @($runtime | ForEach-Object { 'app/' + $_ }) + @('runtime/node.exe','client/tunnel-client-runtime.exe',
        'app/node_modules/@wonderwhy-er/desktop-commander/dist/server.js','app/third-party-notices/node-LICENSE.txt',
        'app/third-party-notices/agent-continue-LICENSE.txt','app/third-party-notices/openai-LICENSE','app/third-party-notices/openai-NOTICE')
    foreach ($name in $required) {
        if (-not $Layout.entries.ContainsKey($name) -or $Layout.entries[$name].FullName -cne $name -or
            $Layout.entries[$name].Length -le 0) { throw 'administrator_install_closure' }
    }
}

function Get-Layout($Zip, [string]$Root) {
    $entries = [Collections.Generic.Dictionary[string,IO.Compression.ZipArchiveEntry]]::new([StringComparer]::OrdinalIgnoreCase)
    $parents = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
    $total = 0L
    if ($Zip.Entries.Count -lt $requiredFiles.Count -or $Zip.Entries.Count -gt $manifestLimit) { throw 'bundle_layout' }
    foreach ($entry in $Zip.Entries) {
        $name = $entry.FullName
        $kind = ($entry.ExternalAttributes -shr 16) -band 0xF000
        if ($name -cnotmatch '\A(?:app/[a-zA-Z0-9@_.+/-]+|runtime/node\.exe|client/tunnel-client-runtime\.exe)\z' -or
            ($kind -ne 0 -and $kind -ne 0x8000) -or ($entry.ExternalAttributes -band 0x410) -or
            $entry.Length -gt $entryLimit -or $entries.ContainsKey($name) -or
            $Root.Length + $name.Length + 1 -ge 248) { throw 'bundle_layout' }
        foreach ($segment in $name.Split('/')) {
            if (-not $segment -or $segment.EndsWith('.') -or
                $segment -match '\A(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|\z)' -or
                $segment -match '\A(?:\.env(?:\..*)?|\.npmrc|runtime\.key|tunnel\.yaml|binding\.json)\z' -or
                $segment -match '\.(?:pfx|p12|pem|key)\z') { throw 'bundle_layout' }
        }
        $entries.Add($name,$entry)
        $total += $entry.Length
        if ($total -gt $totalLimit) { throw 'bundle_layout' }
        $parent = $name
        while (($slash = $parent.LastIndexOf('/')) -gt 0) {
            $parent = $parent.Substring(0,$slash)
            if ($parents.ContainsKey($parent)) {
                if ($parents[$parent] -cne $parent) { throw 'bundle_layout' }
            } else { $parents.Add($parent,$parent) }
        }
    }
    foreach ($name in $parents.Keys) { if ($entries.ContainsKey($name)) { throw 'bundle_layout' } }
    foreach ($name in $requiredFiles) {
        if (-not $entries.ContainsKey($name) -or $entries[$name].FullName -cne $name -or $entries[$name].Length -eq 0) {
            throw 'bundle_layout'
        }
    }
    return @{ entries=$entries; parents=$parents }
}

function Copy-Or-Hash($Source, [long]$Length, $Destination) {
    $buffer = [byte[]]::new(65536)
    $remaining = $Length
    $sha.Initialize()
    while ($remaining -gt 0) {
        $count = $Source.Read($buffer,0,[int][Math]::Min([long]$buffer.Length,$remaining))
        if ($count -eq 0) { throw 'bundle_content' }
        if ($null -ne $Destination) { $Destination.Write($buffer,0,$count) }
        else { $null = $sha.TransformBlock($buffer,0,$count,$null,0) }
        $remaining -= $count
    }
    if ($Source.ReadByte() -ne -1) { throw 'bundle_content' }
    if ($null -ne $Destination) { $Destination.Flush($true) }
    else {
        $null = $sha.TransformFinalBlock($buffer,0,0)
        return To-Hex $sha.Hash
    }
}

function Verify-SealedBundle([string]$Root, $Layout, [scriptblock]$Progress=$null) {
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push($Root)
    $count = 0
    $total = $Layout.entries.Count
    if ($Progress) { $null = & $Progress $count $total }
    while ($pending.Count) {
        $dir = $pending.Pop()
        Assert-SealedAcl $dir $true
        foreach ($file in [IO.Directory]::EnumerateFileSystemEntries($dir)) {
            $relative = $file.Substring($Root.Length + 1).Replace('\','/')
            if ($Layout.parents.ContainsKey($relative) -and $Layout.parents[$relative] -ceq $relative) {
                $pending.Push($file)
                continue
            }
            if (-not $Layout.entries.ContainsKey($relative) -or $Layout.entries[$relative].FullName -cne $relative) { throw 'bundle_closure' }
            Assert-SealedAcl $file $false
            $entry = $Layout.entries[$relative]
            $left = $right = $null
            try {
                $left = $entry.Open()
                $expected = Copy-Or-Hash $left $entry.Length $null
                $right = [IO.File]::Open($file,'Open','Read','Read')
                if ($right.Length -ne $entry.Length -or (Copy-Or-Hash $right $entry.Length $null) -cne $expected) { throw 'bundle_content' }
            } finally {
                if ($null -ne $left) { $left.Dispose() }
                if ($null -ne $right) { $right.Dispose() }
            }
            $count++
            if ($Progress -and $count -lt $total -and $count % 64 -eq 0) {
                $null = & $Progress $count $total
            }
        }
    }
    if ($count -ne $Layout.entries.Count) { throw 'bundle_closure' }
    if ($Progress -and $count -gt 0) { $null = & $Progress $count $total }
}

if ($Action -in @('CheckBrowserHostedOwnerInstallationPause','RequestBrowserHostedOwnerInstallationPause',
    'ObserveBrowserHostedOwnerInstallationPause','PauseBrowserHostedOwnerInstallation')) {
    try {
        Assert-AdministratorInstallationPauseParameters $Action @($PSBoundParameters.Keys) $ExpectedSha256 `
            $PauseOperationId $BrowserExtensionId $ExpectedUserSid $Consent
        if ($PSVersionTable.PSEdition -ne 'Desktop' -or -not [Environment]::Is64BitProcess) { throw 'installation_pause_input' }
        $programFiles=[Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
        $system=[Environment]::GetFolderPath([Environment+SpecialFolder]::System)
        Import-Module -Name ([IO.Path]::Combine($system,'WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
        if ($Action -ceq 'PauseBrowserHostedOwnerInstallation') {
            $binding=Get-AdministratorControlEndpointBinding $Archive $ExpectedSha256 $PSCommandPath $ExpectedUserSid $programFiles $system
            $held=Open-AdministratorBrowserPauseAsset $binding.Archive $binding.Sid
            try {
                if ((Read-AdministratorBrowserPauseAssetHash $held $totalLimit) -cne $ExpectedSha256) { throw 'archive_hash' }
                $result=Invoke-AdministratorInstallationPause $binding $PauseOperationId $BrowserExtensionId
            } finally { $held.Dispose() }
        } else {
            $installationPauseScript=$PSCommandPath
            $result=Invoke-AdministratorInstallationPauseAction $Action $ExpectedSha256 $PauseOperationId $BrowserExtensionId @($PSBoundParameters.Keys) {
                Get-AdministratorInstallationPauseBinding $Archive $ExpectedSha256 $installationPauseScript $programFiles $system $BrowserExtensionId
            } {
                param($Plan)
                $child=[Diagnostics.Process]::Start($Plan)
                if ($null -eq $child) { return $false }
                try { $child.Dispose() } catch {}
                return $true
            }
        }
        [Console]::WriteLine((ConvertTo-Json -InputObject $result -Compress))
        exit 0
    } catch {
        [Console]::WriteLine('{"ok":false,"phase":"installation_pause"}')
        exit 2
    }
}

if ($Action -ieq 'ObserveBrowserSetup') {
    try {
        Assert-AdministratorBrowserSetupParameters $Action @($PSBoundParameters.Keys) $ExpectedSha256 $BrowserSetupId $BrowserExtensionId
        if ($PSVersionTable.PSEdition -ne 'Desktop' -or -not [Environment]::Is64BitProcess) { throw 'browser_setup_input' }
        $programFiles=[Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
        $system=[Environment]::GetFolderPath([Environment+SpecialFolder]::System)
        Assert-AdministratorBrowserPauseAnchors $programFiles $system
        Import-Module -Name ([IO.Path]::Combine($system,'WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
        $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
        try { $setupSid=$identity.User.Value } finally { $identity.Dispose() }
        $setupContext=@{Archive=$Archive;Digest=$ExpectedSha256;Script=$PSCommandPath;ProgramFiles=$programFiles;
            System=$system;Sid=$setupSid;Extension=$BrowserExtensionId}
        $result=Read-AdministratorBrowserSetupStatus $Action @($PSBoundParameters.Keys) $ExpectedSha256 $BrowserSetupId $BrowserExtensionId {
            Get-AdministratorBrowserSetupBinding $setupContext.Archive $setupContext.Digest $setupContext.Script `
                $setupContext.ProgramFiles $setupContext.System $setupContext.Sid $setupContext.Extension
        }
        [Console]::WriteLine((ConvertTo-Json -InputObject $result -Compress))
    } catch {
        $setupJson=if ($BrowserSetupId -cmatch '\A[a-f0-9]{32}\z') { '"'+$BrowserSetupId+'"' } else { 'null' }
        [Console]::WriteLine(('{{"setupId":{0},"state":"unconfirmed","bundleSha256":null,"target":null}}' -f $setupJson))
    }
    exit 0
}

if ($Action -ieq 'CheckBrowserHostedOwnerControl') {
    try {
        Assert-AdministratorControlSupportParameters $Action @($PSBoundParameters.Keys) $ExpectedSha256 $ControlKind
        if ($PSVersionTable.PSEdition -ne 'Desktop' -or -not [Environment]::Is64BitProcess) { throw 'owner_control_support_input' }
        $programFiles=[Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
        $system=[Environment]::GetFolderPath([Environment+SpecialFolder]::System)
        Assert-AdministratorBrowserPauseAnchors $programFiles $system
        Import-Module -Name ([IO.Path]::Combine($system,'WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
        $supportContext=@{Archive=$Archive;Digest=$ExpectedSha256;Script=$PSCommandPath;ProgramFiles=$programFiles;System=$system}
        $result=Read-AdministratorBrowserControlSupport $Action $ExpectedSha256 $ControlKind @($PSBoundParameters.Keys) {
            Get-AdministratorBrowserPauseTarget $supportContext.Archive $supportContext.Digest $supportContext.Script `
                $supportContext.ProgramFiles $supportContext.System {param($SystemDirectory) Get-AdministratorBrowserPauseIdentity $SystemDirectory}
        }
        [Console]::WriteLine((ConvertTo-Json -InputObject $result -Depth 3 -Compress))
        exit 0
    } catch {
        [Console]::WriteLine('{"ok":false,"phase":"owner_control_support_input"}')
        exit 2
    }
}

$controlEndpointActions=@('RequestBrowserHostedOwnerControl','RequestBrowserHostedOwnerControlFence',
    'RequestBrowserHostedOwnerControlReconcile','ConnectBrowserHostedOwner','ResumeBrowserHostedOwner',
    'RevokeBrowserHostedOwner','FenceBrowserHostedOwnerControl','ReconcileBrowserHostedOwnerControl')
if ($controlEndpointActions -icontains $Action) {
    try {
        $targetArgument=if ($PSBoundParameters.ContainsKey('BrowserControlTarget')) { $BrowserControlTarget } else { $null }
        $route=Assert-AdministratorControlEndpointParameters $Action @($PSBoundParameters.Keys) $ExpectedSha256 `
            $ControlOperationId $ControlKind $targetArgument $ControlCallerPid $ControlCallerCreated $ExpectedSessionId $ExpectedUserSid $Consent
        if ($PSVersionTable.PSEdition -ne 'Desktop' -or -not [Environment]::Is64BitProcess -or
            $Archive -cnotmatch '\A[A-Z]:\\[^\\]' -or $Archive.Substring(2) -match '[\x00-\x1f<>:"|?*/]' -or
            $Archive -cne [IO.Path]::GetFullPath($Archive)) { throw 'owner_control_entry_input' }
        $programFiles=[Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
        $system=[Environment]::GetFolderPath([Environment+SpecialFolder]::System)
        Assert-AdministratorBrowserPauseAnchors $programFiles $system
        Import-Module -Name ([IO.Path]::Combine($system,'WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
        $null=[Reflection.Assembly]::Load('System.IO.Compression, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089')
        if ($route.Role -ceq 'medium') {
            $controlEntryContext=@{Archive=$Archive;Digest=$ExpectedSha256;Script=$PSCommandPath;ProgramFiles=$programFiles;System=$system}
            $result=Invoke-AdministratorBrowserControlRequest $Action $ExpectedSha256 $ControlOperationId $ControlKind $targetArgument @($PSBoundParameters.Keys) {
                Get-AdministratorBrowserPauseTarget $controlEntryContext.Archive $controlEntryContext.Digest $controlEntryContext.Script `
                    $controlEntryContext.ProgramFiles $controlEntryContext.System {param($SystemDirectory) Get-AdministratorBrowserPauseIdentity $SystemDirectory}
            } {
                param($SystemDirectory)
                Get-AdministratorControlEndpointCaller $SystemDirectory
            } {
                param($Plan)
                [Diagnostics.Process]::Start($Plan)
            } {
                param($Binding,$Route,$Id,$Control,$Caller,$Child)
                Wait-AdministratorControlEndpointHandoff $Binding $Route $Id $Control $Caller $Child
            }
        } else {
            $result=Invoke-AdministratorBrowserControlEndpoint $Action $Archive $ExpectedSha256 $PSCommandPath $ControlOperationId `
                $ControlKind $targetArgument $ControlCallerPid $ControlCallerCreated $ExpectedSessionId $ExpectedUserSid $programFiles $system
        }
        [Console]::WriteLine((ConvertTo-Json -InputObject $result -Depth 4 -Compress))
        exit 0
    } catch {
        [Console]::WriteLine('{"ok":false,"phase":"owner_control_entry"}')
        exit 2
    }
}

if ($Action -ieq 'ObserveHostedOwnerControl' -or $PSBoundParameters.ContainsKey('ControlKind') -or
    $PSBoundParameters.ContainsKey('ControlOperationId') -or $PSBoundParameters.ContainsKey('BrowserControlTarget') -or
    $PSBoundParameters.ContainsKey('ControlCallerPid') -or $PSBoundParameters.ContainsKey('ControlCallerCreated') -or
    $PSBoundParameters.ContainsKey('ExpectedSessionId')) {
    try {
        Assert-AdministratorControlObservationParameters $Action @($PSBoundParameters.Keys) $ExpectedSha256 $ControlOperationId $ControlKind
    } catch {
        [Console]::WriteLine('{"ok":false,"phase":"owner_control_observation_input"}')
        exit 2
    }
}

if ($Action -in @('CheckBrowserHostedOwnerPause','RequestBrowserHostedOwnerPause','RequestBrowserHostedOwnerPauseFence')) {
    $pauseScript = $PSCommandPath
    $result = Invoke-AdministratorBrowserPauseAction $Action $PauseOperationId @($PSBoundParameters.Keys) {
        if ($PSVersionTable.PSEdition -ne 'Desktop' -or -not [Environment]::Is64BitProcess) { throw 'input' }
        $programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
        $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
        Get-AdministratorBrowserPauseTarget $Archive $ExpectedSha256 $pauseScript $programFiles $system {
            param($SystemDirectory)
            Get-AdministratorBrowserPauseIdentity $SystemDirectory
        }
    } {
        param($Plan)
        $child = [Diagnostics.Process]::Start($Plan)
        if ($null -eq $child) { return $false }
        try { $child.Dispose() } catch { }
        return $true
    } $BrowserPauseTarget
    if ($null -eq $result) {
        [Console]::WriteLine('{"ok":false,"phase":"browser_pause_preflight"}')
        exit 2
    }
    [Console]::WriteLine($result)
    exit 0
}

try {
    if ($PSVersionTable.PSEdition -ne 'Desktop' -or -not [Environment]::Is64BitProcess -or
        $ExpectedSha256 -cnotmatch '\A[a-f0-9]{64}\z' -or $Archive -notmatch '\A[A-Z]:\\[^\\]' -or
        $Archive.Substring(2) -match '[\x00-\x1f<>:"|?*/]' -or
        $Archive -ine [IO.Path]::GetFullPath($Archive)) { throw 'input' }
    $installBrowserOwner = $Action -ceq 'InstallBrowserOwner'
    if ($PSBoundParameters.ContainsKey('BrowserSetupId') -and
        (-not $installBrowserOwner -or $BrowserSetupId -cnotmatch '\A[a-f0-9]{32}\z')) { throw 'input' }
    if ($installBrowserOwner) {
        $allowedInstallParameters = @('Action','Archive','ExpectedSha256','Consent','ExpectedUserSid',
            'HostedTunnelId','OperationReceiptId','RuntimeKeyFile','BrowserExtensionId','ExpectedStagerSha256','InstallerSourcePath','BrowserSetupId')
        foreach ($parameter in $PSBoundParameters.Keys) {
            if ($parameter -cnotin $allowedInstallParameters) { throw 'input' }
        }
        if ($Consent -cne 'accept-administrator-browser-installation' -or -not $RuntimeKeyFile -or
            $OperationReceiptId -cnotmatch '\A[0-9a-f]{32}\z') { throw 'input' }
    }
    if ($InstallerSourcePath -and -not $installBrowserOwner) { throw 'input' }
    $enrollmentSourcePath = if ($InstallerSourcePath) { $InstallerSourcePath } else { $PSCommandPath }
    $firstAcceptance = $Action -eq 'AcceptLocal' -or $installBrowserOwner
    $bindHosted = $Action -eq 'BindHosted' -or $installBrowserOwner
    $authorizeHostedOwner = $Action -eq 'AuthorizeHostedOwner' -or $installBrowserOwner
    $reauthorizeHostedOwner = $Action -ceq 'ReauthorizeHostedOwner'
    if ($reauthorizeHostedOwner) {
        $allowed=@('Action','Archive','ExpectedSha256','ExpectedUserSid','HostedTunnelId','BrowserExtensionId',
            'ExpectedStagerSha256','PreviousRevocationId','ReauthorizationId','Consent')
        foreach ($parameter in $PSBoundParameters.Keys) { if ($parameter -cnotin $allowed) { throw 'reauthorization_input' } }
        if ($PreviousRevocationId -cnotmatch '\A[a-f0-9]{32}\z' -or $ReauthorizationId -cnotmatch '\A[a-f0-9]{32}\z' -or
            $PreviousRevocationId -ceq $ReauthorizationId) { throw 'reauthorization_input' }
    } elseif ($PreviousRevocationId -or $ReauthorizationId) { throw 'reauthorization_input' }
    $revokeHostedOwner = $Action -eq 'RevokeHostedOwner'
    $connectHostedOwner = $Action -eq 'ConnectHostedOwner'
    $browserPause = $Action -ceq 'PauseBrowserHostedOwner'
    $browserFence = $Action -ceq 'FenceBrowserHostedOwnerPause'
    $browserRepair = $Action -ceq 'RepairBrowserHostedOwnerPauseTarget'
    $pauseHostedOwner = $Action -eq 'PauseHostedOwner' -or $browserPause -or $browserFence -or $browserRepair
    $startHostedOwner = $Action -eq 'StartHostedOwner' -or $connectHostedOwner
    $observeHostedOwner = $Action -eq 'ObserveHostedOwner'
    $observeHostedOwnerPause = $Action -eq 'ObserveHostedOwnerPause'
    $observeHostedOwnerControl = $Action -ceq 'ObserveHostedOwnerControl'
    if (($PauseOperationId -and (-not ($observeHostedOwnerPause -or $pauseHostedOwner) -or
        $PauseOperationId -cnotmatch '\A[a-f0-9]{32}\z')) -or
        (($observeHostedOwnerPause -or $browserPause -or $browserFence) -and -not $PauseOperationId) -or
        ($browserPause -and -not (Test-AdministratorBrowserPauseTarget $BrowserPauseTarget)) -or
        (-not $browserPause -and $PSBoundParameters.ContainsKey('BrowserPauseTarget'))) { throw 'input' }
    if ($browserPause -or $browserFence -or $browserRepair) {
        $allowedPauseParameters = @('Action','Archive','ExpectedSha256','ExpectedUserSid','Consent')
        if (-not $browserRepair) { $allowedPauseParameters += 'PauseOperationId' }
        if ($browserPause) { $allowedPauseParameters += 'BrowserPauseTarget' }
        foreach ($parameter in $PSBoundParameters.Keys) {
            if ($parameter -cnotin $allowedPauseParameters) { throw 'input' }
        }
    }
    $enrollBrowserOwner = $Action -eq 'EnrollBrowserOwner' -or $installBrowserOwner
    $unenrollBrowserOwner = $Action -eq 'UnenrollBrowserOwner'
    $inspectFailedOwner = $Action -eq 'InspectFailedBrowserOwner'
    $retireFailedOwner = $Action -eq 'RetireFailedBrowserOwner'
    $failedOwnerAction = $inspectFailedOwner -or $retireFailedOwner
    if (($failedOwnerAction -and $FailedOwnerGeneration -cnotmatch '\A[a-f0-9]{32}\z') -or
        (-not $failedOwnerAction -and $FailedOwnerGeneration)) { throw 'input' }
    $usesBrowserOrigin = $enrollBrowserOwner -or $connectHostedOwner -or $unenrollBrowserOwner -or $failedOwnerAction -or $reauthorizeHostedOwner
    $browserEnrollmentAttempted = $false
    if (($BrowserWake -and $Action -ne 'StartHostedOwner') -or
        ($usesBrowserOrigin -and $BrowserExtensionId -cnotmatch '\A[a-p]{32}\z') -or
        (-not $usesBrowserOrigin -and $BrowserExtensionId) -or
        (($enrollBrowserOwner -or $reauthorizeHostedOwner) -and $ExpectedStagerSha256 -cnotmatch '\A[a-f0-9]{64}\z') -or
        (-not ($enrollBrowserOwner -or $reauthorizeHostedOwner) -and $ExpectedStagerSha256)) { throw 'input' }
    $verifyHosted = $Action -eq 'VerifyHosted'
    $runHostedWindow = $Action -eq 'RunHostedWindow'
    $stopHostedWindow = $Action -eq 'StopHostedWindow'
    $guarded = [bool]($HostedAdmissionSource -or $HostedAcceptancePlan -or $HostedAcceptancePlanSha256)
    $hostedAction = $bindHosted -or $verifyHosted -or $runHostedWindow -or $authorizeHostedOwner
    $usesTunnel = $hostedAction -or $startHostedOwner -or $enrollBrowserOwner -or $unenrollBrowserOwner -or $failedOwnerAction -or $reauthorizeHostedOwner
    if (($usesTunnel -and $HostedTunnelId -cnotmatch '\Atunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}\z') -or
        (-not $usesTunnel -and $HostedTunnelId)) { throw 'input' }
    if ($LocalAcceptanceWitness -ne 0 -and
        (-not $firstAcceptance -or $LocalAcceptanceWitness -lt 65536 -or $LocalAcceptanceWitness -gt 16842751)) {
        throw 'input'
    }
    if ($OperationReceiptId -and ($Action -notin @('InstallBrowserOwner','ProbeLocal','BindHosted','VerifyHosted','RunHostedWindow','StopHostedWindow') -or
        $OperationReceiptId -cnotmatch '\A[0-9a-f]{32}\z')) { throw 'input' }
    if ($RuntimeKeyFile -and (-not $bindHosted -or -not $OperationReceiptId)) { throw 'input' }
    if ($guarded -and (-not $runHostedWindow -or -not $HostedAdmissionSource -or -not $HostedAcceptancePlan -or
        $HostedAcceptancePlanSha256 -cnotmatch '\A[a-f0-9]{64}\z')) { throw 'input' }
    if ($AfterReadOnlyWindow -and (-not ($guarded -or $verifyHosted) -or $AfterReadOnlyWindow -cnotmatch '\A[a-f0-9]{32}\z' -or
        $AfterReadOnlyWindow -ceq $OperationReceiptId)) { throw 'input' }
    if ($AfterUnusedWindow -and (-not $AfterReadOnlyWindow -or $AfterUnusedWindow -cnotmatch '\A[a-f0-9]{32}\z' -or
        $AfterUnusedWindow -cin @($AfterReadOnlyWindow,$OperationReceiptId))) { throw 'input' }
    $windowConsent = if ($guarded) { 'accept-administrator-hosted-proof-only' } else { 'accept-administrator-hosted-window' }
    if (($runHostedWindow -and (-not $OperationReceiptId -or -not $HostedWindowSource -or
        $HostedWindowSeconds -lt 15 -or $HostedWindowSeconds -gt 900)) -or
        (-not $runHostedWindow -and ($HostedWindowSource -or $HostedWindowSeconds)) -or
        ($stopHostedWindow -and -not $OperationReceiptId)) { throw 'input' }
    $stateAction = $firstAcceptance -or $hostedAction -or $stopHostedWindow -or $revokeHostedOwner -or $startHostedOwner -or $pauseHostedOwner -or $enrollBrowserOwner -or $unenrollBrowserOwner -or $failedOwnerAction -or $reauthorizeHostedOwner -or $Action -in @('PrepareState','VerifyState','ProbeLocal')
    if ($stateAction) {
        if ($ExpectedUserSid -cnotmatch '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z' -or
            ($Action -eq 'PrepareState' -and $Consent -cne 'accept-administrator-state-preparation') -or
            ($Action -eq 'ProbeLocal' -and $Consent -cne 'accept-administrator-local-probe') -or
            ($firstAcceptance -and -not $installBrowserOwner -and $Consent -cne 'accept-administrator-first-local-acceptance') -or
            ($bindHosted -and -not $installBrowserOwner -and $Consent -cne 'accept-administrator-hosted-binding') -or
            ($authorizeHostedOwner -and -not $installBrowserOwner -and $Consent -cne 'accept-persistent-administrator-full-account') -or
            ($reauthorizeHostedOwner -and $Consent -cne 'reauthorize-revoked-administrator-full-account') -or
            ($revokeHostedOwner -and $Consent -cne 'revoke-persistent-administrator-full-account') -or
            ($Action -eq 'StartHostedOwner' -and $Consent -cne 'restore-authorized-administrator-owner') -or
            ($connectHostedOwner -and $Consent -cne 'connect-authorized-administrator-owner') -or
            ($Action -eq 'PauseHostedOwner' -and $Consent -cne 'pause-authorized-administrator-owner') -or
            ($browserPause -and $Consent -cne 'pause-browser-administrator-owner') -or
            ($browserFence -and $Consent -cne 'fence-browser-administrator-pause') -or
            ($browserRepair -and $Consent -cne 'repair-browser-administrator-pause-target') -or
            ($enrollBrowserOwner -and -not $installBrowserOwner -and $Consent -cne 'accept-administrator-browser-enrollment') -or
            ($unenrollBrowserOwner -and $Consent -cne 'accept-administrator-browser-unenrollment') -or
            ($inspectFailedOwner -and $Consent) -or
            ($retireFailedOwner -and $Consent -cne 'retire-failed-administrator-browser-owner') -or
            ($runHostedWindow -and $Consent -cne $windowConsent) -or
            ($stopHostedWindow -and $Consent -cne 'stop-administrator-hosted-window') -or
            ($verifyHosted -and $Consent) -or
            ($Action -eq 'VerifyState' -and $Consent)) { throw 'consent' }
        $phase = 'identity'
        if ($enrollBrowserOwner -or $unenrollBrowserOwner -or $failedOwnerAction -or $BrowserWake -or $connectHostedOwner -or $pauseHostedOwner) { Assert-AdministratorBrowserIdentity $ExpectedUserSid }
        else { Assert-AdministratorIdentity $ExpectedUserSid }
    } elseif ($ExpectedUserSid) { throw 'input' }
    elseif ($Action -eq 'Stage') {
        if ($Consent -cne 'accept-administrator-bundle-stage') { throw 'consent' }
        $phase = 'identity'
        Assert-AdministratorIdentity ''
    } elseif ($Consent) { throw 'consent' }

    $phase = 'anchor'
    $programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
    $volume = [IO.Path]::GetPathRoot($programFiles)
    $disk = [IO.DriveInfo]::new($volume)
    if ($disk.DriveType -ne 'Fixed' -or $disk.DriveFormat -ne 'NTFS' -or
        [IO.Path]::GetDirectoryName($programFiles) -ine $volume) { throw 'anchor' }
    Assert-Anchor $volume $true
    Assert-Anchor $programFiles $false
    $base = [IO.Path]::Combine($programFiles,'AgentContinueAdmin')
    $root = [IO.Path]::Combine($base,$ExpectedSha256.Substring(0,24))
    $ownerControlRevision = ''
    if ($BrowserWake -or $connectHostedOwner -or $pauseHostedOwner) {
        $phase = 'browser_enrollment_commit'
        $bridge = $root + '.browser'
        if ($Archive -cne [IO.Path]::Combine($bridge,'bundle.zip') -or
            $PSCommandPath -cne [IO.Path]::Combine($bridge,'stager.ps1')) { throw 'browser_enrollment_launch' }
        Assert-SealedAcl $base $true
        Read-AdministratorBrowserCommit $bridge $ExpectedSha256 $ExpectedUserSid
        Assert-SealedAcl $PSCommandPath $false $false $ExpectedUserSid
        Assert-SealedAcl ($root + '.state') $true $true
        Assert-SealedAcl ($root + '.secrets') $true $true
        if ($pauseHostedOwner) {
            $phase = 'owner_pause_request'
            if ($PauseOperationId -or $browserRepair) {
                $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
                Import-Module -Name ([IO.Path]::Combine($system,'WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
                $verifyPauseBinding = {
                    if (-not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($bridge,'enrollment.pending')))) {
                        throw 'browser_enrollment_not_committed'
                    }
                    Assert-AdministratorBrowserRegistry @{
                        Sid=$ExpectedUserSid; Manifest=[IO.Path]::Combine($bridge,'host.json')
                        Registry='Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.administrator_owner'
                    } $true
                }
                if ($browserRepair) {
                    $null = Repair-AdministratorBrowserPauseTarget $root $ExpectedSha256 $ExpectedUserSid $verifyPauseBinding
                    [Console]::WriteLine('{"supported":true}')
                    exit 0
                }
                $pause = if ($browserPause) {
                    Request-AdministratorOwnerPause $root $ExpectedSha256 $ExpectedUserSid $PauseOperationId $BrowserPauseTarget $verifyPauseBinding
                } elseif ($browserFence) {
                    Fence-AdministratorOwnerPause $root $ExpectedSha256 $ExpectedUserSid $PauseOperationId $verifyPauseBinding
                } else {
                    Request-AdministratorOwnerPause $root $ExpectedSha256 $ExpectedUserSid $PauseOperationId
                }
                [Console]::WriteLine((ConvertTo-Json -InputObject $pause -Compress))
                if ($pause.state -ceq 'unconfirmed') { exit 2 }
            } else {
                Request-AdministratorOwnerPause $root $ExpectedSha256 $ExpectedUserSid
                [Console]::WriteLine('{"ok":true,"pauseRecorded":true,"stoppedVerified":false,"tunnelReady":"unobserved"}')
            }
            exit 0
        }
        Assert-SealedAcl $Archive $false $false $ExpectedUserSid
        if ($connectHostedOwner) {
            $phase = 'owner_connect_snapshot'
            $gate = Open-AdministratorOwnerControl ($root + '.secrets')
            try { $ownerControlRevision = Read-AdministratorOwnerControlRevision $gate } finally { $gate.Dispose() }
        } elseif (-not (Test-AdministratorOwnerRunIntent ($root + '.state') ($root + '.secrets'))) {
            [Console]::WriteLine('{"ok":true,"outcome":"wake-denied-by-local-intent","tunnelReady":"unobserved"}')
            exit 0
        }
    }
    if ($observeHostedOwner -or $observeHostedOwnerPause -or $observeHostedOwnerControl) {
        $phase = 'owner_observation'
        $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
        Import-Module -Name ([IO.Path]::Combine($system,'WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        try {
            try {
                Assert-SealedAcl $base $true
                $result = if ($observeHostedOwnerControl) {
                    Read-AdministratorBrowserControlStatus $ExpectedSha256 $ControlOperationId $ControlKind @($PSBoundParameters.Keys) {
                        Get-AdministratorBrowserPauseTarget $Archive $ExpectedSha256 $PSCommandPath $programFiles $system {
                            param($SystemDirectory)
                            Get-AdministratorBrowserPauseIdentity $SystemDirectory
                        }
                    }
                } elseif ($observeHostedOwnerPause) {
                    Read-AdministratorOwnerPause ($root + '.status') $ExpectedSha256 $identity.User.Value $PauseOperationId
                } else {
                    Read-AdministratorOwnerObservation ($root + '.status') $ExpectedSha256 $identity.User.Value
                }
            } catch {
                $result = if ($observeHostedOwnerControl) { @{bundleSha256=$ExpectedSha256;operationId=$ControlOperationId;control=$ControlKind;state='unconfirmed';progress=$null} }
                    elseif ($observeHostedOwnerPause) { @{operationId=$PauseOperationId;state='unconfirmed'} }
                    else { @{state='unobserved';generation=$null} }
            }
        } finally { $identity.Dispose() }
        [Console]::WriteLine((ConvertTo-Json -InputObject $result -Depth 4 -Compress))
        exit 0
    }
    if ($revokeHostedOwner) {
        $phase = 'owner_revocation_request'
        Assert-SealedAcl $base $true
        Request-AdministratorOwnerRevocation $root $ExpectedSha256 $ExpectedUserSid
        [Console]::WriteLine('{"ok":true,"revocationRecorded":true,"stoppedVerified":false}')
        exit 0
    }
    if ($unenrollBrowserOwner -or $failedOwnerAction) {
        $phase = if ($inspectFailedOwner) { 'failed_owner_inspection' } else { 'browser_unenrollment' }
        Assert-SealedAcl $base $true
        $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
        Import-Module -Name ([IO.Path]::Combine($system,'WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
        $plan = New-AdministratorBrowserEnrollmentPlan $root $ExpectedSha256 $ExpectedUserSid $HostedTunnelId $BrowserExtensionId $system
        if ($failedOwnerAction) {
            if ($Archive -cne $plan.Archive) { throw 'failed_owner_archive' }
            Assert-SealedAcl $Archive $false $false $ExpectedUserSid
            $inputStream = [IO.File]::Open($Archive,'Open','Read','Read')
            $sha = [Security.Cryptography.SHA256]::Create()
            if ((To-Hex $sha.ComputeHash($inputStream)) -cne $ExpectedSha256) { throw 'failed_owner_archive' }
        }
        Remove-AdministratorBrowserOwner $plan $root $ExpectedSha256 $base -FailedGeneration $FailedOwnerGeneration -InspectOnly:$inspectFailedOwner
        if ($inspectFailedOwner) {
            [Console]::WriteLine('{"ok":true,"phase":"complete","failedGenerationVerified":true,"registrationChanged":false,"tunnelStarted":false}')
        } elseif ($retireFailedOwner) {
            [Console]::WriteLine('{"ok":true,"phase":"complete","browserRegistrationRemoved":true,"revocationPreserved":true,"failedEvidencePreserved":true,"tunnelStarted":false}')
        } else {
            [Console]::WriteLine('{"ok":true,"phase":"complete","browserRegistrationRemoved":true,"revocationPreserved":true}')
        }
        exit 0
    }
    if ($stopHostedWindow) {
        $phase = 'window_stop_request'
        Assert-SealedAcl $base $true
        Assert-SealedAcl $root $true
        $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
        Import-Module -Name ([IO.Path]::Combine($system,'WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
        Request-HostedWindowStop $root $ExpectedSha256 $OperationReceiptId
        [Console]::WriteLine('{"ok":true,"stopRequestHandled":true,"stoppedVerified":false}')
        exit 0
    }
    if ($OperationReceiptId -and -not $installBrowserOwner) {
        $phase = 'probe_receipt'
        Assert-SealedAcl $base $true
        Assert-SealedAcl $root $true
        $probeReceipt = Open-LocalProbeReceipt $root $OperationReceiptId $ExpectedSha256 $Action
    }

    $phase = 'archive'
    Assert-PathType $Archive $false
    $inputStream = [IO.File]::Open($Archive,'Open','Read','Read')
    if ($inputStream.Length -le 0 -or $inputStream.Length -gt $totalLimit) { throw 'archive_size' }
    $sha = [Security.Cryptography.SHA256]::Create()
    if ((To-Hex $sha.ComputeHash($inputStream)) -cne $ExpectedSha256) { throw 'archive_hash' }
    $inputStream.Position = 0
    $null = [Reflection.Assembly]::Load('System.IO.Compression, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089')
    $zip = [IO.Compression.ZipArchive]::new($inputStream,[IO.Compression.ZipArchiveMode]::Read,$true)
    $phase = 'layout'
    $layout = Get-Layout $zip $root
    $files = $layout.entries.Count

    if ($installBrowserOwner) {
        Assert-AdministratorInstallClosure $layout
        # One approved installation uses the same protected stages once. Refuse
        # occupied identities and invalid key/source inputs before copying files.
        $phase = 'browser_enrollment_preflight'
        $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
        Import-Module -Name ([IO.Path]::Combine($system,'WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
        $browserPlan = New-AdministratorBrowserEnrollmentPlan $root $ExpectedSha256 $ExpectedUserSid $HostedTunnelId $BrowserExtensionId $system
        $scheduler = New-Object -ComObject Schedule.Service
        $scheduler.Connect()
        Assert-AdministratorBrowserNamespaceFree $scheduler $browserPlan
        $null = Read-AdministratorBrowserStager $enrollmentSourcePath $ExpectedStagerSha256
        $installSecret = Read-AdministratorRuntimeKeyFile $RuntimeKeyFile
        $phase = 'first_acceptance_targets'
        Assert-FirstLocalAcceptanceAvailable $root
        Ensure-SealedDirectory $base
        $phase = 'probe_receipt'
        $probeReceipt = Open-LocalProbeReceipt $root $OperationReceiptId $ExpectedSha256 $Action
    }

    if ($Action -eq 'Stage' -or $firstAcceptance) {
        $phase = 'reserve'
        Ensure-SealedDirectory $base
        if ($firstAcceptance) {
            $phase = 'first_acceptance_targets'
            Assert-FirstLocalAcceptanceAvailable $root
            $phase = 'reserve'
        }
        $reservation = Open-SealedNewFile ($root + '.stage')
        if ($firstAcceptance) { $stateReservation = Open-SealedNewFile ($root + '.state.stage') $true }
        if ([IO.Directory]::Exists($root) -or [IO.File]::Exists($root)) { throw 'existing_bundle' }
        Ensure-SealedDirectory $root
        $phase = 'copy'
        foreach ($entry in $zip.Entries) {
            $dir = $root
            $segments = $entry.FullName.Split('/')
            for ($i=0; $i -lt $segments.Length-1; $i++) {
                $dir = [IO.Path]::Combine($dir,$segments[$i])
                Ensure-SealedDirectory $dir
            }
            $file = [IO.Path]::Combine($dir,$segments[-1])
            $source = $destination = $null
            try {
                $source = $entry.Open()
                $destination = Open-SealedNewFile $file
                Copy-Or-Hash $source $entry.Length $destination
            } finally {
                if ($null -ne $source) { $source.Dispose() }
                if ($null -ne $destination) { $destination.Dispose() }
            }
        }
    }
    if ($Action -ne 'Plan') {
        $phase = 'verify'
        Assert-SealedAcl $base $true
        Verify-SealedBundle $root $layout
        $filesVerified = $true
    }
    if ($reauthorizeHostedOwner) {
        $phase='owner_reauthorization_preflight'
        $stateRoot=$root+'.state'; $vault=$root+'.secrets'
        $system=[Environment]::GetFolderPath([Environment+SpecialFolder]::System)
        Import-Module -Name ([IO.Path]::Combine($system,'WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
        $plan=New-AdministratorBrowserEnrollmentPlan $root $ExpectedSha256 $ExpectedUserSid $HostedTunnelId $BrowserExtensionId $system
        if ($Archive -cne $plan.Archive) { throw 'reauthorization_archive' }
        Read-AdministratorBrowserCommit $plan.Bridge $ExpectedSha256 $ExpectedUserSid
        $null=Read-AdministratorBrowserStager ([IO.Path]::Combine($plan.Bridge,'stager.ps1')) $ExpectedStagerSha256
        foreach ($name in $plan.Files.Keys) {
            Assert-AdministratorBrowserAsset ([IO.Path]::Combine($plan.Bridge,$name)) $plan.Files[$name] $ExpectedUserSid
        }
        Assert-AdministratorBrowserAsset $plan.DemandScript $plan.DemandBytes $ExpectedUserSid
        Assert-AdministratorOwnerBytes $plan.DemandBinding $plan.DemandBindingBytes
        Assert-AdministratorOwnerWake $root $stateRoot $ExpectedSha256 $ExpectedUserSid $HostedTunnelId
        $scheduler=New-Object -ComObject Schedule.Service
        $scheduler.Connect()
        $folder=$scheduler.GetFolder('\'+$plan.Folder)
        $task=$folder.GetTask($plan.Name)
        $verifyBinding={
            param($Gate)
            Assert-AdministratorBrowserRegistry $plan $true
            Assert-AdministratorBrowserTaskAcl ($folder.GetSecurityDescriptor(5)) $plan.Sddl
            Assert-AdministratorBrowserTask $task $plan $true
            if ($task.GetInstances(0).Count -ne 0) { throw 'reauthorization_task_busy' }
        }
        $phase='owner_reauthorization_commit'
        $origin='chrome-extension://'+$BrowserExtensionId+'/'
        $record=Restore-AdministratorOwnerAuthorization $root $ExpectedSha256 $ExpectedUserSid $origin `
            $PreviousRevocationId $ReauthorizationId $verifyBinding
        [Console]::WriteLine((ConvertTo-Json -InputObject $record -Compress))
        if ($record.ok) { exit 0 }
        exit 2
    }
    $completeBrowserEnrollment = {
        $phase = 'browser_enrollment_preflight'
        $stateRoot = $root + '.state'
        $vault = $root + '.secrets'
        $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
        Import-Module -Name ([IO.Path]::Combine($system,'WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
        Assert-AdministratorOwnerWake $root $stateRoot $ExpectedSha256 $ExpectedUserSid $HostedTunnelId
        foreach ($name in @('windows-admin-browser-host.mjs','windows-admin-demand.mjs','windows-admin-intent.mjs',
            'windows-admin-browser-session.mjs','windows-browser-peer.cs','windows-browser-peer.ps1')) {
            Assert-SealedAcl ([IO.Path]::Combine($root,'app',$name)) $false
        }
        if (-not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($vault,'owner-revoked'))) -or
            -not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($vault,'owner-job.lease'))) -or
            -not (Test-AdministratorOwnerInnerLeasesClear $stateRoot)) { throw 'browser_owner_unavailable' }
        $intent = [IO.Path]::Combine($stateRoot,'lifecycle.json')
        Assert-PathType $intent $false
        $paused = '{"format":"agent-continue-lifecycle","version":1,"paused":true}' + [char]10
        if ([IO.FileInfo]::new($intent).Length -ne $paused.Length -or [IO.File]::ReadAllText($intent) -cne $paused) {
            throw 'browser_enrollment_requires_pause'
        }
        $phase = 'browser_enrollment_source'
        $stagerBytes = Read-AdministratorBrowserStager $enrollmentSourcePath $ExpectedStagerSha256
        $phase = 'browser_enrollment_plan'
        $browserPlan = New-AdministratorBrowserEnrollmentPlan $root $ExpectedSha256 $ExpectedUserSid $HostedTunnelId $BrowserExtensionId $system
        $phase = 'browser_enrollment_namespace'
        $scheduler = New-Object -ComObject Schedule.Service
        $scheduler.Connect()
        Assert-AdministratorBrowserNamespaceFree $scheduler $browserPlan
        $phase = 'browser_enrollment_reserve'
        $reservation = Open-SealedNewFile ([IO.Path]::Combine($base,'browser-enrollment.lock')) $true
        $identityBytes = [Text.Encoding]::ASCII.GetBytes((Get-AdministratorBrowserReservation $browserPlan $ExpectedSha256))
        $reservation.Write($identityBytes,0,$identityBytes.Length)
        $reservation.Flush($true)
        $browserEnrollmentAttempted = $true
        $phase = 'browser_enrollment_publish'
        Register-AdministratorBrowserOwner $browserPlan $ExpectedSha256 $stagerBytes $inputStream (
            [IO.Path]::Combine($stateRoot,'temp')) $vault $ExpectedStagerSha256 $BrowserSetupId
        $browserEnrollmentCommitted = $true
    }
    if ($enrollBrowserOwner -and -not $installBrowserOwner) {
        . $completeBrowserEnrollment
        [Console]::WriteLine('{"ok":true,"phase":"complete","registrationChanged":true,"browserEnrollmentCommitted":true,"activated":false,"tunnelStarted":false}')
        exit 0
    }
    if ($startHostedOwner) {
        $phase = 'owner_wake_preflight'
        $stateRoot = $root + '.state'
        $vault = $root + '.secrets'
        $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
        Import-Module -Name ([IO.Path]::Combine($system,'WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
        Assert-AdministratorOwnerWake $root $stateRoot $ExpectedSha256 $ExpectedUserSid $HostedTunnelId
        if ($connectHostedOwner) {
            $phase = 'owner_connect_task'
            $browserPlan = New-AdministratorBrowserEnrollmentPlan $root $ExpectedSha256 $ExpectedUserSid $HostedTunnelId $BrowserExtensionId $system
            foreach ($name in $browserPlan.Files.Keys) {
                Assert-AdministratorBrowserAsset ([IO.Path]::Combine($browserPlan.Bridge,$name)) $browserPlan.Files[$name] $ExpectedUserSid
            }
            Assert-AdministratorBrowserAsset $browserPlan.DemandScript $browserPlan.DemandBytes $ExpectedUserSid
            Assert-AdministratorOwnerBytes $browserPlan.DemandBinding $browserPlan.DemandBindingBytes
            Assert-AdministratorBrowserRegistry $browserPlan $true
            $scheduler = New-Object -ComObject Schedule.Service
            $scheduler.Connect()
            $folder = $scheduler.GetFolder('\' + $browserPlan.Folder)
            Assert-AdministratorBrowserTaskAcl ($folder.GetSecurityDescriptor(5)) $browserPlan.Sddl
            $task = $folder.GetTask($browserPlan.Name)
            Assert-AdministratorBrowserTask $task $browserPlan $true
            $check = New-AdministratorLaunchPlan $root $stateRoot -ConnectCheckSid $ExpectedUserSid
            $phase = 'owner_connect_commit'
            $record = Request-AdministratorOwnerConnect $task $check $stateRoot $vault $ownerControlRevision $ExpectedSha256 $ExpectedUserSid
            [Console]::WriteLine((ConvertTo-Json -InputObject $record -Compress))
            if ($record.ok) { exit 0 }
            exit 2
        }
        if (-not (Test-AdministratorOwnerRunIntent $stateRoot $vault)) {
            [Console]::WriteLine('{"ok":true,"outcome":"wake-denied-by-local-intent","tunnelReady":"unobserved"}')
            exit 0
        }
        if (-not (Test-AdministratorOwnerAbsent ([IO.Path]::Combine($vault,'owner-job.lease')))) { throw 'owner_job_owned' }
        $plan = New-AdministratorLaunchPlan $root $stateRoot -OwnerEntry
        $phase = 'owner_job_compile'
        $jobType = Get-AdministratorOwnerJobType $zip ([IO.Path]::Combine($stateRoot,'temp'))
        $zip.Dispose(); $zip = $null
        $inputStream.Dispose(); $inputStream = $null
        $phase = 'owner_job'
        $record = Invoke-AdministratorOwnerJob $jobType $plan $stateRoot $vault $ExpectedSha256 $ExpectedUserSid ($root + '.status') -SerializeControl
        $record['ok'] = $record.jobDrained -and $record.innerLeasesClear -and
            (-not $record.rootCreationAttempted -or ($record.rootExitObserved -and $record.rootExitCode -eq 0))
        [Console]::WriteLine((ConvertTo-Json -InputObject $record -Compress))
        if ($record.ok) { exit 0 }
        exit 2
    }
    if ($stateAction) {
        $phase = 'state'
        $stateRoot = $root + '.state'
        $stateLayout = Get-AdministratorStateLayout $ExpectedSha256 $ExpectedUserSid
        if ($Action -eq 'PrepareState' -or $firstAcceptance) {
            if (-not $firstAcceptance) { $stateReservation = Open-SealedNewFile ($stateRoot + '.stage') $true }
            Write-AdministratorState $stateRoot $stateLayout
        }
        $priorReadOnly = $null
        $priorUnused = $null
        if ($AfterReadOnlyWindow) {
            $phase = 'prior_hosted_window'
            $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
            Import-Module -Name ([IO.Path]::Combine($system,'WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
            $priorReadOnly = Read-PriorReadOnlyWindow $root $stateRoot $ExpectedSha256 $AfterReadOnlyWindow
            if ($AfterUnusedWindow) {
                $priorUnused = Read-PriorReadOnlyWindow $root $stateRoot $ExpectedSha256 $AfterUnusedWindow -Unused
            }
            $phase = 'state'
        }
        Assert-FreshAdministratorState $stateRoot $stateLayout $priorReadOnly $priorUnused
        $stateVerified = $true
        $phase = 'launchplan'
        $null = New-AdministratorLaunchPlan $root $stateRoot
        $launchPlanVerified = $true
        if ($bindHosted) {
            $phase = 'binding_target'
            $vault = $root + '.secrets'
            if ([IO.Directory]::Exists($vault) -or [IO.File]::Exists($vault)) { throw 'binding_exists' }
        }
        if ($Action -eq 'ProbeLocal' -or $firstAcceptance -or $bindHosted) {
            $phase = 'probe_prepare'
            $probeRoot = $root + '.probe-' + [Guid]::NewGuid().ToString('N')
            Write-AdministratorState $probeRoot $stateLayout
            Assert-FreshAdministratorState $probeRoot $stateLayout
            $phase = 'probe_child'
            Invoke-LocalTokenProbe $root $probeRoot $ExpectedUserSid 'administrator'
            $phase = 'probe_cleanup'
            Remove-CompletedLocalProbe $root $probeRoot
            $phase = 'post_probe_state'
            Assert-FreshAdministratorState $stateRoot $stateLayout
            $localProbeVerified = $true
        }
        if ($bindHosted) {
            $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
            Import-Module -Name ([IO.Path]::Combine($system,'WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
            $secret = $null
            try {
                if ($installBrowserOwner) {
                    $secret = $installSecret
                    $installSecret = $null
                } elseif ($RuntimeKeyFile) {
                    $phase = 'binding_key_file'
                    $secret = Read-AdministratorRuntimeKeyFile $RuntimeKeyFile
                } else {
                    $phase = 'binding_key_prompt'
                    $secret = Read-Host 'Enter the dedicated runtime key for this isolated OpenAI tunnel' -AsSecureString
                }
                $phase = 'binding_write'
                Write-AdministratorHostedBinding $root $stateRoot $ExpectedSha256 $ExpectedUserSid $HostedTunnelId $secret
                Assert-FreshAdministratorState $stateRoot $stateLayout
                $hostedBindingPrepared = $true
            } finally { if ($secret) { $secret.Dispose() } }
        }
        if ($hostedAction) {
            $phase = 'hosted_launch_plan'
            $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
            Import-Module -Name ([IO.Path]::Combine($system,'WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
            $null = New-AdministratorHostedLaunchPlan $root $stateRoot $ExpectedSha256 $ExpectedUserSid $HostedTunnelId
            $hostedLaunchPlanVerified = $true
        }
        if ($authorizeHostedOwner) {
            $phase = 'hosted_owner_authorization'
            Write-AdministratorOwnerActivation $root $stateRoot $ExpectedSha256 $ExpectedUserSid $HostedTunnelId
            $hostedOwnerAuthorized = $true
        }
        if ($runHostedWindow) {
            if ($guarded) {
                $phase = 'hosted_acceptance_plan'
                Write-HostedAcceptanceProfile $root $stateRoot $OperationReceiptId $HostedTunnelId `
                    $HostedAdmissionSource $HostedAcceptancePlan $HostedAcceptancePlanSha256
            }
            $phase = 'hosted_window'
            $hostedWindowResult = Invoke-AdministratorHostedWindow $root $stateRoot $OperationReceiptId $HostedWindowSeconds $HostedWindowSource $guarded
            if ($hostedWindowResult.outcome -cin @('start-unconfirmed','acceptance-error')) { throw 'window_not_ready' }
        }
    }
    if ($installBrowserOwner) {
        if ($null -ne $reservation) { $reservation.Dispose(); $reservation = $null }
        if ($null -ne $stateReservation) { $stateReservation.Dispose(); $stateReservation = $null }
        . $completeBrowserEnrollment
    }
    $success = $true
    $phase = 'complete'
} catch {
    # Avoid paths, archives, local account names, and exception details in receipts.
    if ($phase -clike 'browser_enrollment_*') {
        $cause = $_.Exception.GetBaseException()
        $message = $cause.Message
        $diagnostic = if ($message -cmatch '\Abrowser_(?:enrollment_(?:input|collision|not_committed|launch|requires_pause)|owner_unavailable|task_(?:acl|definition|action)|registry_(?:compile|create|collision|user_hive|unconfirmed)|asset_readback|archive_readback|stager_(?:size|hash))\z') {
            $message
        } elseif ($cause -is [UnauthorizedAccessException]) { 'browser_access_denied' }
        elseif ($cause -is [IO.IOException]) { 'browser_io_refused' }
        elseif ($cause -is [ArgumentException]) { 'browser_argument_refused' }
        elseif ($cause -is [Security.Cryptography.CryptographicException]) { 'browser_hash_refused' }
        else { 'browser_enrollment_unconfirmed' }
    } elseif ($phase -cin @('browser_unenrollment','failed_owner_inspection')) {
        $cause = $_.Exception.GetBaseException()
        $message = $cause.Message
        $diagnostic = if ($message -cmatch '\A(?:browser_(?:unenrollment_(?:reservation|folder|active)|registry_(?:collision|user_hive|unconfirmed)|enrollment_not_committed|asset_readback|task_(?:acl|definition|action))|failed_owner_(?:archive|file_(?:identity|compile)|generation|not_paused|terminal|inner_lease|operation_history|pending_enrollment|task)|sealed_acl|path_type)\z') {
            $message
        } elseif ($cause -is [IO.IOException]) { 'browser_io_refused' }
        elseif ($cause -is [UnauthorizedAccessException]) { 'browser_access_denied' }
        else { 'browser_unenrollment_unconfirmed' }
    } elseif ($phase -cin @('owner_pause_request','owner_connect_snapshot','owner_connect_task','owner_connect_commit')) {
        $message = $_.Exception.GetBaseException().Message
        $diagnostic = if ($message -cmatch '\A(?:owner_control_(?:busy|revision|readback)|owner_connect_(?:superseded|not_eligible|check_timeout)|browser_(?:asset_readback|task_(?:acl|definition|action)|registry_(?:collision|user_hive|unconfirmed)))\z') {
            $message
        } else { 'owner_control_unconfirmed' }
    } elseif ($phase -eq 'probe_child') {
        $message = $_.Exception.Message
        if ($message -cmatch '\Aprobe_(?:identity|provider(?:_start|_init)?|tool_reply|child_token|shutdown|marker_missing|process_(?:start_receipt|readback|nonzero|incomplete)|token_(?:flags|impersonation|native_setup|native_exception|account|role|elevation|integrity|token_read))\z') {
            $diagnostic = $message
        } else { $diagnostic = 'probe_internal' }
    }
} finally {
    if ($null -ne $installSecret) { $installSecret.Dispose() }
    if ($null -ne $stateReservation) { $stateReservation.Dispose() }
    if ($null -ne $reservation) { $reservation.Dispose() }
    if ($null -ne $zip) { $zip.Dispose() }
    if ($null -ne $inputStream) { $inputStream.Dispose() }
    if ($null -ne $sha) { $sha.Dispose() }
}

$ok = $success.ToString().ToLowerInvariant()
$verified = $filesVerified.ToString().ToLowerInvariant()
$state = $stateVerified.ToString().ToLowerInvariant()
$launch = $launchPlanVerified.ToString().ToLowerInvariant()
$probe = ($success -and $localProbeVerified).ToString().ToLowerInvariant()
$binding = ($success -and $hostedBindingPrepared).ToString().ToLowerInvariant()
$hostedLaunch = ($success -and $hostedLaunchPlanVerified).ToString().ToLowerInvariant()
$startedTunnel = if ($hostedWindowResult.wasReady) { 'true' } elseif ($phase -eq 'hosted_window' -or $null -ne $hostedWindowResult) { 'null' } else { 'false' }
$closedWindow = ($null -ne $hostedWindowResult).ToString().ToLowerInvariant()
$windowOutcome = if ($null -ne $hostedWindowResult) { $hostedWindowResult.outcome } elseif ($phase -eq 'hosted_window') { 'unconfirmed' } else { 'not-run' }
$receipt = '{{"ok":{0},"phase":"{1}","files":{2},"protectedFilesVerified":{3},"administratorStateVerified":{4},"cleanLaunchPlanVerified":{5},"administratorChildVerified":{6},"hostedBindingPrepared":{7},"hostedLaunchPlanVerified":{8},"diagnostic":"{9}","activated":false,"registrationChanged":false,"tunnelStarted":{10},"hostedWindowStoppedConfirmed":{11},"hostedWindowOutcome":"{12}"}}' -f
    $ok,$phase,([int]$files),$verified,$state,$launch,$probe,$binding,$hostedLaunch,$diagnostic,$startedTunnel,$closedWindow,$windowOutcome
if ($Action -eq 'EnrollBrowserOwner') {
    if ($browserEnrollmentAttempted) { $receipt = $receipt.Replace('"registrationChanged":false','"registrationChanged":null') }
    $receipt = $receipt.TrimEnd('}') + ',"browserEnrollmentCommitted":null}'
}
if ($Action -in @('UnenrollBrowserOwner','RetireFailedBrowserOwner') -and $phase -eq 'browser_unenrollment') {
    $receipt = $receipt.Replace('"registrationChanged":false','"registrationChanged":null')
}
if ($Action -eq 'AuthorizeHostedOwner') {
    $receipt = $receipt.TrimEnd('}') + ',"hostedOwnerAuthorized":' + $hostedOwnerAuthorized.ToString().ToLowerInvariant() + '}'
}
if ($installBrowserOwner) {
    $receipt = New-AdministratorInstallResult $receipt $browserEnrollmentAttempted $browserEnrollmentCommitted $hostedOwnerAuthorized $success
}
if ($null -ne $probeReceipt) {
    if ($installBrowserOwner) {
        # A sealed selected-account projection observes this exact attempt;
        # projection failure cannot erase effects recorded by the private log.
        $projectionFailure = Publish-AdministratorInstallReceipts $probeReceipt $root $OperationReceiptId $ExpectedSha256 $ExpectedStagerSha256 $ExpectedUserSid $receipt
        if ($null -ne $projectionFailure) {
            [Console]::WriteLine((ConvertTo-Json -InputObject $projectionFailure -Compress))
            exit 2
        }
    } else {
        try {
            Publish-LocalProbeReceipt $probeReceipt $OperationReceiptId $ExpectedSha256 $receipt
        }
        catch {
            [Console]::WriteLine('{"ok":false,"phase":"probe_receipt_publish","outcome":"unrecorded","activated":false,"registrationChanged":false,"tunnelStarted":false}')
            exit 2
        }
    }
}
[Console]::WriteLine($receipt)
if ($success) { exit $LocalAcceptanceWitness }
if ($LocalAcceptanceWitness -ge 65536 -and $LocalAcceptanceWitness -le 16842751 -and $Action -eq 'AcceptLocal') {
    switch ($phase) {
        'identity' { exit 21 }
        'anchor' { exit 22 }
        {$_ -in 'archive','layout'} { exit 23 }
        'first_acceptance_targets' { exit 24 }
        {$_ -in 'reserve','copy','verify'} { exit 25 }
        {$_ -in 'state','launchplan','probe_prepare'} { exit 26 }
        'probe_child' { exit 27 }
        {$_ -in 'probe_cleanup','post_probe_state'} { exit 28 }
    }
}
exit 2
