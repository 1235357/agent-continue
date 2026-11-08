<#
Command-only Windows administrator setup. Plan is read-only by default.
After one explicit installation consent, one Windows elevation prepares and
verifies the runtime, binding and browser bridge. It never claims chat access
or starts a connection without a browser-owned Connect operation.
#>
[CmdletBinding()]
param(
    [switch]$Apply,
    [switch]$Observe,
    [switch]$InspectExisting,
    [switch]$PromptForConnection,
    [string]$Consent = '',
    [string]$ExtensionId = '',
    [string]$BrowserSetupId = '',
    [string]$TunnelId = '',
    [string]$RuntimeKeyFile = '',
    [string]$Archive = '',
    [string]$ExpectedSha256 = '',
    [string]$Stager = '',
    [string]$ExpectedStagerSha256 = '',
    [string]$PayloadDirectory = '',
    [string]$OperationId = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Stamped with the same immutable release as the setup payload.
$script:acReleaseTag = ''
$script:acAdministratorBundleSha256 = ''
$script:acAdministratorStagerSha256 = ''
$temporary = ''
$child = $null
$request = $null
$status = 'setup-input-invalid'

function Read-AdministratorInstallSource([string]$File,[string]$Digest) {
    if ($Digest -cnotmatch '\A[a-f0-9]{64}\z') { throw 'administrator_stager_hash' }
    $stream = [IO.File]::Open($File,'Open','Read','Read')
    $sha = $snapshot = $null
    try {
        if ($stream.Length -lt 1 -or $stream.Length -gt 512KB) { throw 'administrator_stager_size' }
        $snapshot = [IO.MemoryStream]::new()
        $stream.CopyTo($snapshot)
        $bytes = $snapshot.ToArray()
        $sha = [Security.Cryptography.SHA256]::Create()
        if ([BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant() -cne $Digest) {
            throw 'administrator_stager_hash'
        }
        return [Text.UTF8Encoding]::new($false,$true).GetString($bytes).TrimStart([char]0xfeff)
    } finally {
        if ($sha) { $sha.Dispose() }
        if ($snapshot) { $snapshot.Dispose() }
        $stream.Dispose()
    }
}

function Get-AdministratorExistingInstallation([string]$Digest,[string]$StagerDigest,[string]$Extension,[string]$Sid,
    [bool]$DisplayProgress = $false) {
    if ($Digest -cnotmatch '\A[a-f0-9]{64}\z' -or $StagerDigest -cnotmatch '\A[a-f0-9]{64}\z' -or
        $Extension -cnotmatch '\A[a-p]{32}\z' -or $Sid -cnotmatch '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z') {
        throw 'administrator_existing_input'
    }
    $programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
    $root = [IO.Path]::Combine($programFiles,'AgentContinueAdmin',$Digest.Substring(0,24))
    try { $null = [IO.File]::GetAttributes($root) }
    catch {
        $cause = $_.Exception.GetBaseException()
        if ($cause -is [IO.FileNotFoundException] -or $cause -is [IO.DirectoryNotFoundException]) {
            return @{status='absent';mutationPerformed=$false}
        }
        return @{status='existing-unconfirmed';mutationPerformed=$false}
    }
    try {
        $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
        $bridge = $root + '.browser'
        $stager = [IO.Path]::Combine($bridge,'stager.ps1')
        $archive = [IO.Path]::Combine($bridge,'bundle.zip')
        $source = Read-AdministratorInstallSource $stager $StagerDigest
        $tokens = $errorsFound = $null
        $ast = [Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errorsFound)
        if ($errorsFound.Count) { throw 'administrator_existing_source' }
        # Import definitions, not the stager's dispatcher. Adoption must never
        # execute Install/Connect or require a fresh-install receipt/paused state.
        $definitions = @($ast.EndBlock.Statements | Where-Object {
            $_ -is [Management.Automation.Language.FunctionDefinitionAst]
        } | ForEach-Object { $_.Extent.Text }) -join [char]10
        $constants = @'
$systemSid='S-1-5-18';$administratorsSid='S-1-5-32-544';$usersSid='S-1-5-32-545'
$installerSid='S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
$requiredFiles=@('runtime/node.exe','client/tunnel-client-runtime.exe','app/host.mjs','app/runtime.mjs','app/lifecycle.mjs','app/profile.mjs','app/tunnel-pins.json','app/upstream-pin.json','app/package-lock.json','app/node_modules/@wonderwhy-er/desktop-commander/dist/server.js')
$manifestLimit=40000;$entryLimit=192MB;$totalLimit=768MB
'@
        $module = New-Module -ScriptBlock ([ScriptBlock]::Create($constants + [char]10 + $definitions)) -Verbose:$false
        $verified = & $module {
            param($Root,$Digest,$StagerDigest,$Extension,$Sid,$ProgramFiles,$System,$Stager,$Archive,$DisplayProgress)
            $null = Get-AdministratorBrowserSetupBinding $Archive $Digest $Stager $ProgramFiles $System $Sid $Extension
            $stream = Open-AdministratorBrowserPauseAsset $Stager $Sid
            try {
                if ((Read-AdministratorBrowserPauseAssetHash $stream 512KB) -cne $StagerDigest) { throw 'existing_stager_hash' }
            } finally { $stream.Dispose() }
            $stream = Open-AdministratorBrowserPauseAsset $Archive $Sid
            $zip = $sha = $null
            try {
                if ((Read-AdministratorBrowserPauseAssetHash $stream $totalLimit) -cne $Digest) { throw 'existing_bundle_hash' }
                $stream.Position = 0
                $null = [Reflection.Assembly]::Load('System.IO.Compression, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089')
                $zip = [IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Read,$true)
                $sha = [Security.Cryptography.SHA256]::Create()
                $layout = Get-Layout $zip $Root
                Assert-AdministratorInstallClosure $layout
                $progress = if ($DisplayProgress) {
                    { param($Done,$Total)
                        if ($Done -eq 0 -or $Done -eq $Total -or $Done % 1024 -eq 0) {
                            Write-Host ('Checking existing installation: {0}/{1} files. No connection is being started.' -f $Done,$Total)
                        }
                    }
                } else { $null }
                Verify-SealedBundle $Root $layout $progress
            } finally {
                if ($zip) { $zip.Dispose() }
                if ($sha) { $sha.Dispose() }
                $stream.Dispose()
            }
            # Only public bridge bytes and task identity are adopted. The
            # private tunnel/credential binding is intentionally not inspected;
            # a placeholder affects only the unused private-binding template.
            $plan = New-AdministratorBrowserEnrollmentPlan $Root $Digest $Sid ('tunnel_'+('0'*32)) $Extension $System
            foreach ($name in $plan.Files.Keys) {
                Assert-AdministratorBrowserAsset ([IO.Path]::Combine($plan.Bridge,$name)) $plan.Files[$name] $Sid
            }
            Assert-AdministratorBrowserAsset $plan.DemandScript $plan.DemandBytes $Sid
            $scheduler = New-Object -ComObject Schedule.Service
            $scheduler.Connect()
            $task = $scheduler.GetFolder('\'+$plan.Folder).GetTask($plan.Name)
            Assert-AdministratorBrowserTask $task $plan ([bool]$task.Enabled)
            $null = Get-AdministratorBrowserSetupBinding $Archive $Digest $Stager $ProgramFiles $System $Sid $Extension
            return $true
        } $root $Digest $StagerDigest $Extension $Sid $programFiles $system $stager $archive $DisplayProgress
        if ($verified -cne $true) { throw 'administrator_existing_unconfirmed' }
        return @{status='existing-matched';scope='administrator';extensionId=$Extension;bundleSha256=$Digest;
            stagerSha256=$StagerDigest;registration='matched';mutationPerformed=$false;
            currentConnection='unobserved';privateBinding='not-inspected';chatAuthorized=$false;next='open-devices';
            devicesUrl=('chrome-extension://'+$Extension+'/devices.html?mode=browser-managed')}
    } catch {
        Write-Verbose ('Existing-install read-only verification: ' + $_.Exception.GetBaseException().Message)
        Write-Verbose $_.ScriptStackTrace
        return @{status='existing-unconfirmed';mutationPerformed=$false;currentConnection='unobserved'}
    }
}

function New-AdministratorInstallWorker([hashtable]$Request) {
    $json = ConvertTo-Json -InputObject $Request -Compress
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
    $definition = (Get-Command -Name Read-AdministratorInstallSource -CommandType Function).ScriptBlock.ToString()
    $worker = @'
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
function Read-AdministratorInstallSource { __FUNCTION__ }
try {
    Import-Module ([IO.Path]::Combine($PSHOME,'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
    $inputRecord=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__REQUEST__')))
    $request=@{}
    foreach($property in $inputRecord.PSObject.Properties){$request[$property.Name]=$property.Value}
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        if($identity.User.Value -cne $request.ExpectedUserSid -or -not [Security.Principal.WindowsPrincipal]::new($identity).IsInRole(
            [Security.Principal.WindowsBuiltInRole]::Administrator)){exit 11}
    } finally {$identity.Dispose()}
    $source=Read-AdministratorInstallSource $request.InstallerSourcePath $request.ExpectedStagerSha256
    $request.Action='InstallBrowserOwner'
    $request.Consent='accept-administrator-browser-installation'
    & ([ScriptBlock]::Create($source)) @request
    exit 12
} catch {exit 12}
'@
    return $worker.Replace('__FUNCTION__',$definition).Replace('__REQUEST__',$encoded)
}

function Test-AdministratorInstallReceipt($Receipt,[hashtable]$Request) {
    if ($Receipt -isnot [pscustomobject] -or $Receipt.version -cne 1 -or
        $Receipt.operationId -cne $Request.OperationReceiptId -or $Receipt.bundleSha256 -cne $Request.ExpectedSha256 -or
        $Receipt.stagerSha256 -cne $Request.ExpectedStagerSha256 -or $Receipt.result -isnot [pscustomobject]) { return $false }
    $result = $Receipt.result
    foreach ($name in @('ok','protectedFilesVerified','administratorStateVerified','administratorChildVerified',
        'hostedBindingPrepared','hostedLaunchPlanVerified','hostedOwnerAuthorized','browserEnrollmentCommitted',
        'readyToConnect','registrationChanged')) {
        if ($result.$name -isnot [bool] -or -not $result.$name) { return $false }
    }
    return $result.phase -ceq 'complete' -and $result.tunnelStarted -is [bool] -and -not $result.tunnelStarted -and
        $result.activated -is [bool] -and -not $result.activated
}

function Read-AdministratorInstallReceipt([string]$File,[string]$Sid) {
    if (-not [IO.File]::Exists($File)) { return $null }
    if ([IO.File]::GetAttributes($File) -band ([IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint)) {
        throw 'administrator_receipt_invalid'
    }
    $acl = [IO.File]::GetAccessControl($File)
    $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(),0)
    if ($descriptor.Owner.Value -cne 'S-1-5-32-544' -or -not $acl.AreAccessRulesProtected -or
        $null -eq $descriptor.DiscretionaryAcl -or $descriptor.DiscretionaryAcl.Count -ne 3) { throw 'administrator_receipt_invalid' }
    foreach ($entry in $descriptor.DiscretionaryAcl) {
        if ($entry -isnot [Security.AccessControl.CommonAce] -or $entry.IsCallback -or
            $entry.AceType -ne [Security.AccessControl.AceType]::AccessAllowed -or $entry.AceFlags -ne 0 -or
            $entry.SecurityIdentifier.Value -cnotin @('S-1-5-18','S-1-5-32-544',$Sid) -or
            ($entry.SecurityIdentifier.Value -ceq $Sid -and $entry.AccessMask -ne 0x1200a9)) { throw 'administrator_receipt_invalid' }
    }
    $stream = [IO.File]::Open($File,'Open','Read','Read')
    $reader = $null
    try {
        if ($stream.Length -lt 1 -or $stream.Length -gt 16384) { throw 'administrator_receipt_invalid' }
        $reader = [IO.StreamReader]::new($stream,[Text.UTF8Encoding]::new($false,$true))
        return ConvertFrom-Json -InputObject $reader.ReadToEnd()
    } finally { if ($reader) { $reader.Dispose() } else { $stream.Dispose() } }
}

function New-AdministratorInstallRecoveryCommand([string]$OperationId,[string]$Digest,[string]$StagerDigest,[string]$Sid) {
    if ($OperationId -cnotmatch '\A[a-f0-9]{32}\z' -or $Digest -cnotmatch '\A[a-f0-9]{64}\z' -or
        $StagerDigest -cnotmatch '\A[a-f0-9]{64}\z' -or $Sid -cnotmatch '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z') {
        throw 'administrator_recovery_input'
    }
    $read = (Get-Command -Name Read-AdministratorInstallReceipt -CommandType Function).ScriptBlock.ToString()
    $test = (Get-Command -Name Test-AdministratorInstallReceipt -CommandType Function).ScriptBlock.ToString()
    # Capture only the read-only function bodies and public identity. The setup
    # payload may be deleted; neither it nor the private install request is needed.
    $observer = @'
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
function Read-AdministratorInstallReceipt {__READ__}
function Test-AdministratorInstallReceipt {__TEST__}
$request=@{OperationReceiptId='__OPERATION__';ExpectedSha256='__BUNDLE__';ExpectedStagerSha256='__STAGER__';ExpectedUserSid='__SID__'}
$ok=$false
try {
    Import-Module ([IO.Path]::Combine($PSHOME,'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
    if ($PSVersionTable.PSEdition -cne 'Desktop' -or $env:OS -cne 'Windows_NT' -or -not [Environment]::Is64BitProcess) {
        throw 'administrator_recovery_platform'
    }
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        if ($identity.User.Value -cne $request.ExpectedUserSid) { throw 'administrator_recovery_identity' }
    } finally { $identity.Dispose() }
    $programFiles=[Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
    if (-not [IO.Path]::IsPathRooted($programFiles)) { throw 'administrator_recovery_path' }
    $root=[IO.Path]::Combine($programFiles,'AgentContinueAdmin',$request.ExpectedSha256.Substring(0,24))
    $receiptFile=$root+'.install-'+$request.OperationReceiptId+'.json'
    $receipt=Read-AdministratorInstallReceipt $receiptFile $request.ExpectedUserSid
    $ok=Test-AdministratorInstallReceipt $receipt $request
} catch { $ok=$false }
[Console]::WriteLine((@{ok=$ok;status=$(if ($ok) {'installation-recorded'} else {'installation-outcome-unconfirmed'});
    operationId=$request.OperationReceiptId;automaticallyRetried=$false;mutationPerformed=$false;
    tunnelStarted=$false;chatAuthorized=$false;currentConnection='unobserved'} | ConvertTo-Json -Compress))
if ($ok) { exit 0 } else { exit 1 }
'@
    $observer = $observer.Replace('__READ__',$read).Replace('__TEST__',$test).Replace('__OPERATION__',$OperationId).
        Replace('__BUNDLE__',$Digest).Replace('__STAGER__',$StagerDigest).Replace('__SID__',$Sid)
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($observer))
    if ($encoded.Length -gt 30000) { throw 'administrator_recovery_size' }
    return 'powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ' + $encoded
}

try {
    if ($PSVersionTable.PSEdition -eq 'Desktop') {
        foreach ($module in @('Microsoft.PowerShell.Utility','Microsoft.PowerShell.Management')) {
            Import-Module ([IO.Path]::Combine($PSHOME,"Modules\$module\$module.psd1")) -ErrorAction Stop
        }
    }
    if ($PSBoundParameters.ContainsKey('BrowserSetupId') -and
        (-not $Apply -or $Observe -or $BrowserSetupId -cnotmatch '\A[a-f0-9]{32}\z')) { throw 'stop' }
    if (-not $Apply -and -not $Observe -and -not $InspectExisting) {
        [Console]::WriteLine((@{ok=$true;dryRun=$true;uacRequested=$false;tunnelStarted=$false;
            steps=@('verify-release','elevate-once','install-runtime','verify-administrator','bind-and-register','connect-in-browser');
            consent='accept-administrator-browser-installation';scope='full-selected-account';customInstaller=$false} | ConvertTo-Json -Compress))
        exit 0
    }
    if ($Apply -and ($Observe -or $InspectExisting -or $Consent -cne 'accept-administrator-browser-installation')) {
        $status = 'consent-required'; throw 'stop'
    }
    if ($Apply -and $OperationId) { $status = 'use-observe-for-existing-operation'; throw 'stop' }
    if ($Observe -and ($Consent -or $PromptForConnection)) { throw 'stop' }
    if ($InspectExisting -and ($Observe -or $Consent -or $PromptForConnection -or $TunnelId -or $RuntimeKeyFile -or
        $OperationId -or $Archive -or $Stager -or $BrowserSetupId)) { throw 'stop' }
    if ($PSVersionTable.PSEdition -ne 'Desktop' -or $env:OS -cne 'Windows_NT' -or -not [Environment]::Is64BitProcess -or
        ($env:PROCESSOR_ARCHITECTURE -cne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -cne 'AMD64')) {
        $status = 'windows-x64-required'; throw 'stop'
    }
    if (($Apply -or $InspectExisting) -and $ExtensionId -cnotmatch '\A[a-p]{32}\z') { throw 'stop' }
    $bundleName = 'agent-continue-windows-administrator-x64.zip'
    $stagerName = 'Stage-WindowsAdministratorBundle.ps1'
    if (-not $PayloadDirectory) { $PayloadDirectory = $PSScriptRoot }
    if (-not $PayloadDirectory) { throw 'stop' }
    if ($script:acAdministratorBundleSha256) {
        if (($ExpectedSha256 -and $ExpectedSha256 -cne $script:acAdministratorBundleSha256) -or
            ($ExpectedStagerSha256 -and $ExpectedStagerSha256 -cne $script:acAdministratorStagerSha256)) { throw 'stop' }
        $ExpectedSha256 = $script:acAdministratorBundleSha256
        $ExpectedStagerSha256 = $script:acAdministratorStagerSha256
    }
    if ($ExpectedSha256 -cnotmatch '\A[a-f0-9]{64}\z' -or $ExpectedStagerSha256 -cnotmatch '\A[a-f0-9]{64}\z') {
        $status = 'administrator-release-pins-required'; throw 'stop'
    }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try { $sid = $identity.User.Value }
    finally { $identity.Dispose() }
    if ($Apply -or $InspectExisting) {
        $existing = Get-AdministratorExistingInstallation $ExpectedSha256 $ExpectedStagerSha256 $ExtensionId $sid ([bool]$Apply)
        if ($existing.status -cne 'absent' -or $InspectExisting) {
            $existing.ok = $existing.status -cin @('absent','existing-matched')
            $existing.installed = $false
            $existing.registrationChanged = $false
            $existing.tunnelStarted = $false
            [Console]::WriteLine((ConvertTo-Json -InputObject $existing -Compress))
            if ($existing.ok) { exit 0 } else { exit 1 }
        }
    }
    if ($PromptForConnection) {
        if ($TunnelId -or $RuntimeKeyFile -or $Host.Name -cne 'ConsoleHost' -or [Console]::IsInputRedirected) { throw 'stop' }
        Write-Host 'This installs administrator-level file, PowerShell and process access for the selected account.'
        Write-Host 'Setup uses verified Node and the official tunnel client. No AgentContinue EXE/MSI installer.'
        Write-Host 'Windows elevation and ChatGPT tool authorization are separate confirmations.'
        $TunnelId = Read-Host 'OpenAI tunnel ID (blank cancels)'
        $RuntimeKeyFile = (Read-Host 'Runtime-key FILE PATH, not the key itself (blank cancels)').Trim().Trim('"')
    }
    if ($Apply -and ($TunnelId -cnotmatch '\Atunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}\z' -or
        $RuntimeKeyFile -cnotmatch '\A[A-Za-z]:\\[^\\]' -or -not [IO.File]::Exists($RuntimeKeyFile))) { throw 'stop' }
    if (-not $Archive) { $Archive = Join-Path $PayloadDirectory $bundleName }
    if (-not $Stager) { $Stager = Join-Path $PayloadDirectory $stagerName }
    if ($Apply -and (-not [IO.File]::Exists($Archive) -or -not [IO.File]::Exists($Stager))) {
        if ($script:acReleaseTag -cnotmatch '\Av[0-9]+\.[0-9]+\.[0-9]+\z' -or
            $Archive -ine (Join-Path $PayloadDirectory $bundleName) -or $Stager -ine (Join-Path $PayloadDirectory $stagerName)) {
            $status = 'administrator-release-artifacts-required'; throw 'stop'
        }
        $temporary = Join-Path ([IO.Path]::GetTempPath()) ('agent-continue-admin-' + [Guid]::NewGuid().ToString('N'))
        [IO.Directory]::CreateDirectory($temporary) | Out-Null
        $base = 'https://github.com/1235357/agent-continue/releases/download/' + $script:acReleaseTag
        $Archive = Join-Path $temporary $bundleName
        $Stager = Join-Path $temporary $stagerName
        foreach ($name in @($stagerName,$bundleName)) {
            Invoke-WebRequest -UseBasicParsing -TimeoutSec 180 -Uri ($base + '/' + $name) -OutFile (Join-Path $temporary $name)
        }
    }
    if ($ExpectedSha256 -cnotmatch '\A[a-f0-9]{64}\z' -or $ExpectedStagerSha256 -cnotmatch '\A[a-f0-9]{64}\z') { throw 'stop' }
    if ($OperationId -and $OperationId -cnotmatch '\A[a-f0-9]{32}\z') { throw 'stop' }
    if ($Observe -and -not $OperationId) { throw 'stop' }
    if (-not $OperationId) { $OperationId = [Guid]::NewGuid().ToString('N') }
    $request = @{Archive=[IO.Path]::GetFullPath($Archive);ExpectedSha256=$ExpectedSha256;ExpectedUserSid=$sid;
        ExpectedStagerSha256=$ExpectedStagerSha256;InstallerSourcePath=[IO.Path]::GetFullPath($Stager);
        HostedTunnelId=$TunnelId;RuntimeKeyFile=$RuntimeKeyFile;BrowserExtensionId=$ExtensionId;OperationReceiptId=$OperationId}
    if ($PSBoundParameters.ContainsKey('BrowserSetupId')) { $request.BrowserSetupId = $BrowserSetupId }
    $root = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)) ('AgentContinueAdmin\' + $ExpectedSha256.Substring(0,24))
    $receiptFile = $root + '.install-' + $OperationId + '.json'
    if ($Apply) {
        $status = 'administrator-artifact-invalid'
        $null = Read-AdministratorInstallSource $request.InstallerSourcePath $ExpectedStagerSha256
        if (-not [IO.File]::Exists($Archive) -or [IO.FileInfo]::new($Archive).Length -gt 768MB -or
            (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedSha256) { throw 'stop' }
        $worker = New-AdministratorInstallWorker $request
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($worker))
        $start = [Diagnostics.ProcessStartInfo]::new()
        $start.FileName = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::System)) 'WindowsPowerShell\v1.0\powershell.exe'
        $start.Arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + $encoded
        $start.UseShellExecute = $true
        $start.Verb = 'runas'
        $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
        # Print the exact recovery identifier before the UAC/child boundary.
        Write-Host ('Installation operation: ' + $OperationId)
        $recoveryCommand = New-AdministratorInstallRecoveryCommand $OperationId $ExpectedSha256 $ExpectedStagerSha256 $sid
        Write-Host ('Read-only recovery: ' + $recoveryCommand)
        $status = 'elevation-cancelled-or-unavailable'
        $child = [Diagnostics.Process]::Start($start)
        $status = 'installation-outcome-unconfirmed'
        if ($null -eq $child -or -not $child.WaitForExit(900000)) { throw 'stop' }
        if ($child.ExitCode -ne 0) { throw 'stop' }
    }
    $status = 'installation-outcome-unconfirmed'
    $receipt = Read-AdministratorInstallReceipt $receiptFile $sid
    if (-not (Test-AdministratorInstallReceipt $receipt $request)) { throw 'stop' }
    [Console]::WriteLine((@{ok=$true;status=$(if ($Observe) {'installation-recorded'} else {'installed-ready-to-connect'});operationId=$OperationId;
        administratorChildVerified=$true;registrationChanged=$true;tunnelStarted=$false;chatAuthorized=$false;
        currentConnection='unobserved';
        next='Open Devices and choose Connect Windows; authorize the selected ChatGPT conversation separately.'} | ConvertTo-Json -Compress))
    exit 0
} catch {
    [Console]::WriteLine((@{ok=$false;status=$status;operationId=$OperationId;automaticallyRetried=$false;
        tunnelStarted=$false;chatAuthorized=$false;recoveryCommand=$recoveryCommand} | ConvertTo-Json -Compress))
    exit 1
} finally {
    # Keep downloads if the child may still use them. Unknown is not a retry.
    $canClean = $null -eq $child
    if ($child) { try { $canClean = $child.HasExited } catch { $canClean = $false } }
    if ($temporary -and $canClean -and [IO.Directory]::Exists($temporary) -and $temporary -ceq [IO.Path]::GetFullPath($temporary) -and
        [IO.Path]::GetDirectoryName($temporary) -ieq [IO.Path]::GetTempPath().TrimEnd('\') -and
        [IO.Path]::GetFileName($temporary) -cmatch '\Aagent-continue-admin-[a-f0-9]{32}\z' -and
        -not ([IO.File]::GetAttributes($temporary) -band [IO.FileAttributes]::ReparsePoint)) {
        Remove-Item -LiteralPath $temporary -Recurse -Force
    }
    if ($child) { $child.Dispose() }
}
