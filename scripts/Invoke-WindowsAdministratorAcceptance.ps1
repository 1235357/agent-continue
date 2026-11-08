[CmdletBinding()]
param(
    [ValidateSet('Plan','Inspect','Start','VerifyLocal')][string]$Action = 'Plan',
    [Parameter(Mandatory=$true)][string]$Archive,
    [Parameter(Mandatory=$true)][string]$ExpectedSha256,
    [Parameter(Mandatory=$true)][string]$ExpectedStagerSha256,
    [string]$Consent = '',
    [string]$ProbeReceiptId = ''
)

$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
$status = 'preflight-unavailable'
$uacRequested = $false
$administratorChildVerified = $false
$child = $null
$inspection = $null

function Open-AcceptanceInput {
    param([string]$Path, [long]$MaxBytes)
    if ($Path.Length -gt 240 -or $Path -notmatch '\A[A-Z]:\\[^\\]' -or
        $Path.Substring(2) -match '[\x00-\x1f<>:"|?*/]' -or $Path -ine [IO.Path]::GetFullPath($Path) -or
        [IO.DriveInfo]::new([IO.Path]::GetPathRoot($Path)).DriveType -ne 'Fixed' -or
        ([IO.File]::GetAttributes($Path) -band ([IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint))) {
        throw 'invalid_acceptance_input'
    }
    $stream = [IO.File]::Open($Path,'Open','Read','Read')
    if ($stream.Length -lt 1 -or $stream.Length -gt $MaxBytes) {
        $stream.Dispose()
        throw 'acceptance_input_size'
    }
    return $stream
}

function Assert-AcceptanceHash {
    param($Stream, [string]$Digest)
    if ($Digest -cnotmatch '\A[a-f0-9]{64}\z') { throw 'invalid_acceptance_hash' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        if ([BitConverter]::ToString($sha.ComputeHash($Stream)).Replace('-','').ToLowerInvariant() -cne $Digest) {
            throw 'acceptance_hash_mismatch'
        }
        $Stream.Position = 0
    } finally { $sha.Dispose() }
}

function Read-AcceptanceStager {
    param([string]$Path, [string]$Digest)
    $stream = Open-AcceptanceInput $Path 512KB
    try {
        $bytes = [byte[]]::new($stream.Length)
        $offset = 0
        while ($offset -lt $bytes.Length) {
            $count = $stream.Read($bytes,$offset,$bytes.Length-$offset)
            if ($count -le 0) { throw 'stager_read_incomplete' }
            $offset += $count
        }
        # Execute the exact bytes that were checked, never reopen a verified pathname.
        $snapshot = [IO.MemoryStream]::new($bytes,$false)
        try { Assert-AcceptanceHash $snapshot $Digest } finally { $snapshot.Dispose() }
        return [Text.UTF8Encoding]::new($false,$true).GetString($bytes).TrimStart([char]0xfeff)
    } finally { $stream.Dispose() }
}

function Get-AcceptanceTargetObservation([string]$Root) {
    $unknown = $false
    foreach ($suffix in @('', '.state', '.stage', '.state.stage', '.secrets')) {
        try {
            $null = [IO.File]::GetAttributes($Root + $suffix)
            return 'existing-artifact'
        } catch {
            $cause = $_.Exception.GetBaseException()
            if ($cause -isnot [IO.FileNotFoundException] -and $cause -isnot [IO.DirectoryNotFoundException]) {
                $unknown = $true
            }
        }
    }
    if ($unknown) { return 'unknown' }
    return 'not-observed'
}

function Get-AcceptanceBrowserRegistration([string]$ExpectedManifest) {
    $hostKey = 'SOFTWARE\Google\Chrome\NativeMessagingHosts\com.agentcontinue.administrator_owner'
    $candidate = $false
    $unknown = $false
    foreach ($hive in @('LocalMachine','CurrentUser')) {
        foreach ($view in @('Registry64','Registry32')) {
            $base = $null
            $entry = $null
            try {
                $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
                $entry = $base.OpenSubKey($hostKey,$false)
                if ($null -eq $entry) { continue }
                $manifest = $entry.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
                if ($hive -ne 'LocalMachine' -or $view -ne 'Registry64' -or
                    $manifest -isnot [string] -or $manifest -ine $ExpectedManifest) {
                    return 'other-or-conflicting-registration'
                }
                $candidate = $true
            } catch {
                $unknown = $true
            } finally {
                if ($null -ne $entry) { $entry.Dispose() }
                if ($null -ne $base) { $base.Dispose() }
            }
        }
    }
    if ($unknown) { return 'unknown' }
    if ($candidate) { return 'candidate-registration-present' }
    return 'not-observed'
}

function New-AcceptanceWorker([string]$Stager, [string]$Bundle, [string]$SourceHash,
    [string]$BundleHash, [string]$Sid, [int]$Witness, [string]$ExistingProbeId = '') {
    $fields = [string]::Join([string][char]10,@($Stager,$Bundle,$SourceHash,$BundleHash,$Sid,[string]$Witness,$ExistingProbeId))
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($fields))
    $worker = @'
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
__FUNCTIONS__
try {
    $values=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__DATA__')).Split([char]10)
    if($values.Length -ne 7 -or $values[4] -cnotmatch '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z' -or
        ($values[6] -and $values[6] -cnotmatch '\A[0-9a-f]{32}\z')){exit 10}
    $thread=[Security.Principal.WindowsIdentity]::GetCurrent($true)
    if($thread){$thread.Dispose();exit 11}
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        if($identity.User.Value -cne $values[4] -or -not [Security.Principal.WindowsPrincipal]::new($identity).IsInRole(
            [Security.Principal.WindowsBuiltInRole]::Administrator)){exit 11}
    } finally {$identity.Dispose()}
    try { $source=Read-AcceptanceStager $values[0] $values[2] } catch {exit 12}
    $request=@{Archive=$values[1];ExpectedSha256=$values[3];ExpectedUserSid=$values[4]}
    if($values[6]){
        $request.Action='ProbeLocal'
        $request.Consent='accept-administrator-local-probe'
        $request.OperationReceiptId=$values[6]
    }else{
        $request.Action='AcceptLocal'
        $request.Consent='accept-administrator-first-local-acceptance'
        $request.LocalAcceptanceWitness=[int]$values[5]
    }
    & ([ScriptBlock]::Create($source)) @request
    exit 10
} catch {exit 10}
'@
    $definitions = foreach ($name in @('Open-AcceptanceInput','Assert-AcceptanceHash','Read-AcceptanceStager')) {
        $body = (Get-Command -Name $name -CommandType Function).ScriptBlock.ToString()
        'function ' + $name + ' {' + $body + '}'
    }
    return $worker.Replace('__DATA__',$encoded).Replace('__FUNCTIONS__',($definitions -join [char]10))
}

function Wait-AcceptanceChild($Child, [int]$ExpectedExit) {
    # Full sealed-bundle verification can outlast five minutes on this machine.
    # A deadline is only an observation failure; never kill or replay the child.
    if ($null -eq $Child -or -not $Child.WaitForExit(900000)) { return 'outcome-unconfirmed' }
    $code = $Child.ExitCode
    if ($null -eq $code) { return 'outcome-unconfirmed' }
    if ($code -eq $ExpectedExit) { return 'administrator-child-verified' }
    $known = @{
        11='account-or-elevation-mismatch';12='elevated-stager-integrity';21='stager-identity'
        22='stager-anchor';23='stager-archive';24='existing-acceptance-artifact'
        25='stage-incomplete';26='state-incomplete';27='child-token-unverified';28='probe-cleanup-unconfirmed'
    }
    if ($known.ContainsKey($code)) { return $known[$code] }
    return 'outcome-unconfirmed'
}

try {
    if (($Action -eq 'Start' -and $Consent -cne 'accept-one-native-administrator-acceptance') -or
        ($Action -eq 'VerifyLocal' -and ($Consent -cne 'accept-existing-native-administrator-probe' -or
            $ProbeReceiptId -cnotmatch '\A[0-9a-f]{32}\z')) -or
        ($Action -notin @('Start','VerifyLocal') -and $Consent) -or
        ($Action -ne 'VerifyLocal' -and $ProbeReceiptId)) {
        $status = 'consent-required-or-unexpected'
        throw 'stop'
    }
    if ($PSVersionTable.PSEdition -ne 'Desktop' -or -not [Environment]::Is64BitProcess) { throw 'stop' }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        $sid = $identity.User.Value
        $alreadyElevated = [Security.Principal.WindowsPrincipal]::new($identity).IsInRole(
            [Security.Principal.WindowsBuiltInRole]::Administrator)
    } finally { $identity.Dispose() }
    if ($sid -cnotmatch '\AS-1-(?:5-21|12-1)(?:-[0-9]{1,10}){4}\z') { throw 'stop' }
    $status = 'stager-integrity'
    $stager = [IO.Path]::Combine($PSScriptRoot,'Stage-WindowsAdministratorBundle.ps1')
    $null = Read-AcceptanceStager $stager $ExpectedStagerSha256
    $status = 'archive-integrity'
    $bundle = Open-AcceptanceInput $Archive 768MB
    try { Assert-AcceptanceHash $bundle $ExpectedSha256 } finally { $bundle.Dispose() }
    if ($Action -eq 'Inspect') {
        $status = 'inspection-unavailable'
        $programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
        if (-not [IO.Path]::IsPathRooted($programFiles)) { throw 'program_files_unavailable' }
        $root = [IO.Path]::Combine($programFiles,'AgentContinueAdmin',$ExpectedSha256.Substring(0,24))
        $inspection = [ordered]@{
            callerElevated = $alreadyElevated
            candidateFootprint = Get-AcceptanceTargetObservation $root
            browserRegistration = Get-AcceptanceBrowserRegistration ([IO.Path]::Combine(($root + '.browser'),'host.json'))
        }
        $status = 'inspection-complete'
    }
    elseif ($Action -eq 'Plan') { $status = 'pins-verified' }
    elseif ($alreadyElevated) {
        $status = if ($Action -eq 'VerifyLocal') { 'use-direct-probelocal-in-elevated-session' }
            else { 'use-direct-acceptlocal-in-elevated-session' }
    }
    else {
        if ($Action -eq 'VerifyLocal') {
            $programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
            if (-not [IO.Path]::IsPathRooted($programFiles)) { throw 'stop' }
            $root = [IO.Path]::Combine($programFiles,'AgentContinueAdmin',$ExpectedSha256.Substring(0,24))
            if ((Get-AcceptanceTargetObservation $root) -cne 'existing-artifact') {
                $status = 'existing-installation-not-observed'
                throw 'stop'
            }
        }
        $status = 'elevation-unavailable'
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try {
            $random = [byte[]]::new(4)
            $rng.GetBytes($random)
            $witness = 65536 + ([BitConverter]::ToUInt32($random,0) -band 0xffffff)
        } finally { $rng.Dispose() }
        $worker = New-AcceptanceWorker $stager $Archive $ExpectedStagerSha256 $ExpectedSha256 $sid $witness $ProbeReceiptId
        $argument = '-NoLogo -NoProfile -NonInteractive -EncodedCommand ' +
            [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($worker))
        if ($argument.Length -gt 18000) { throw 'stop' }
        $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
        $shell = [IO.Path]::Combine($system,'WindowsPowerShell\v1.0\powershell.exe')
        $launch = [Diagnostics.ProcessStartInfo]::new($shell,$argument)
        $launch.WorkingDirectory = $system
        $launch.UseShellExecute = $true
        $launch.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
        $launch.Verb = 'runas'
        $uacRequested = $true
        $child = [Diagnostics.Process]::Start($launch)
        $expectedExit = if ($Action -eq 'VerifyLocal') { 0 } else { $witness }
        $status = Wait-AcceptanceChild $child $expectedExit
        $administratorChildVerified = $status -ceq 'administrator-child-verified'
    }
} catch {
    $cause = $_.Exception.GetBaseException()
    if ($uacRequested -and $cause -is [ComponentModel.Win32Exception] -and $cause.NativeErrorCode -eq 1223) {
        $status = 'uac-canceled'
    }
} finally {
    if ($null -ne $child) { $child.Dispose() }
}

if ($null -ne $inspection) {
    # All strings in this receipt are fixed observation labels, not filesystem or registry values.
    [Console]::WriteLine(('{{"status":"inspection-complete","uacRequested":false,"administratorChildVerified":false,"tunnelStarted":false,"registrationChanged":false,"inspection":{{"callerElevated":{0},"candidateFootprint":"{1}","browserRegistration":"{2}"}}}}' -f
        $inspection.callerElevated.ToString().ToLowerInvariant(),$inspection.candidateFootprint,$inspection.browserRegistration))
} else {
    $probeField = if ($Action -eq 'VerifyLocal' -and $ProbeReceiptId -cmatch '\A[0-9a-f]{32}\z') {
        ',"probeReceiptId":"' + $ProbeReceiptId + '"'
    } else { '' }
    [Console]::WriteLine(('{{"status":"{0}","uacRequested":{1},"administratorChildVerified":{2},"tunnelStarted":false,"registrationChanged":false}}' -f
        $status,$uacRequested.ToString().ToLowerInvariant(),$administratorChildVerified.ToString().ToLowerInvariant()).TrimEnd('}') + $probeField + '}')
}
if ($status -in @('pins-verified','inspection-complete') -or $administratorChildVerified) { exit 0 }
exit 2
