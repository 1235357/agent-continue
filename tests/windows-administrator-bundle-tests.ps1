[CmdletBinding()]
param([string]$NodeArchive = '', [switch]$BrowserPauseFixturesOnly)
$ErrorActionPreference = 'Stop'
$stager = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'))

function Test-BrowserPauseStagerFixtures {
    $parseErrors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($stager,[ref]$null,[ref]$parseErrors)
    if ($parseErrors) { throw ($parseErrors -join [char]10) }
    $names = @('To-Hex','Get-AdministratorBrowserPauseMetadata','Read-AdministratorBrowserPauseMetadata',
        'Read-AdministratorBrowserPauseAssetHash','Get-AdministratorBrowserPauseTarget',
        'New-AdministratorBrowserPauseLaunchPlan','Invoke-AdministratorBrowserPauseAction')
    $definitions = @($ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] },$true))
    foreach ($name in $names) {
        $fn = $definitions | Where-Object Name -CEQ $name
        if (-not $fn) { throw "Missing browser Pause fixture subject: $name" }
        . ([scriptblock]::Create($fn.Extent.Text))
    }

    $program = 'C:\Program Files'
    $system = 'C:\Windows\System32'
    $base = "$program\AgentContinueAdmin"
    $sid = 'S-1-5-21-1-2-3-1001'
    $fixtureIdentity = @{Sid=$sid; SessionId=1; Elevated=$false; Integrity='S-1-16-8192'}
    $archiveBytes = [byte[]]@(1,2,3)
    $stagerBytes = [byte[]]@(4,5,6)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $digest = To-Hex $sha.ComputeHash($archiveBytes)
        $stagerHash = To-Hex $sha.ComputeHash($stagerBytes)
    } finally { $sha.Dispose() }
    $totalLimit = 768MB
    $bridge = "$base\$($digest.Substring(0,24)).browser"
    $archivePath = "$bridge\bundle.zip"
    $stagerPath = "$bridge\stager.ps1"
    $metadataPath = "$bridge\pause-launch.json"
    $executable = "$system\WindowsPowerShell\v1.0\powershell.exe"
    $operation = 'a' * 32
    $request = 'RequestBrowserHostedOwnerPause'
    $check = 'CheckBrowserHostedOwnerPause'
    $fence = 'RequestBrowserHostedOwnerPauseFence'
    $targetToken = ('b' * 32) + ':idle'
    $common = @('Action','Archive','ExpectedSha256')
    $requestArgs = $common + @('PauseOperationId','BrowserPauseTarget')
    $fixture = @{
        Refuse=''; Pending=$false; Archive=$archivePath; Stager=$stagerPath; Digest=$digest
        VerifyCount=0; StartCount=0; StartError=0; Started=$true; VerifyError=0; Plan=$null
        Bytes=@{ $archivePath=$archiveBytes; $stagerPath=$stagerBytes
            $metadataPath=(Get-AdministratorBrowserPauseMetadata $digest $sid $stagerHash) }
        Checks=[Collections.Generic.List[string]]::new()
    }
    function Assert-AdministratorBrowserPauseAnchors([string]$ProgramFiles,[string]$System) {
        if ($ProgramFiles -cne $program -or $System -cne $system -or $fixture.Refuse -ceq 'anchor') { throw 'anchor' }
        $fixture.Checks.Add('anchor')
    }
    function Assert-SealedAcl([string]$Path,[bool]$Directory,[bool]$Private=$false,[string]$ReaderSid='') {
        if ($Private -or $Path -cne $base -or -not $Directory -or $ReaderSid -or $fixture.Refuse -ceq 'base') {
            throw 'base_acl'
        }
        $fixture.Checks.Add('base')
    }
    function Read-AdministratorBrowserCommit([string]$Bridge,[string]$Digest,[string]$Sid) {
        if ($Bridge -cne $fixtureBridge -or $Digest -cne $fixture.Digest -or $Sid -cne $selectedSid -or
            $fixture.Refuse -ceq 'commit') { throw 'commit_acl' }
        $fixture.Checks.Add('commit')
    }
    function Test-AdministratorOwnerAbsent([string]$Path) {
        if ($Path -cne "$bridge\enrollment.pending") { throw 'unexpected pending path' }
        return (-not $fixture.Pending)
    }
    function Assert-AdministratorBrowserRegistry($Plan,[bool]$Published) {
        if (-not $Published -or $Plan.Sid -cne $selectedSid -or $Plan.Manifest -cne "$bridge\host.json" -or
            $Plan.Registry -cne 'Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.administrator_owner' -or
            $fixture.Refuse -ceq 'registry') { throw 'registry' }
        $fixture.Checks.Add('registry')
    }
    function Open-AdministratorBrowserPauseAsset([string]$Path,[string]$Sid) {
        if ($Sid -cne $selectedSid -or -not $fixture.Bytes.ContainsKey($Path) -or $fixture.Refuse -ceq $Path) {
            throw 'asset_acl_or_missing'
        }
        $fixture.Checks.Add($Path)
        return [IO.MemoryStream]::new([byte[]]$fixture.Bytes[$Path],$false)
    }
    function Read-AdministratorBrowserPauseTargetProjection([string]$Root,[string]$Digest,[string]$Sid) {
        if ($Root + '.browser' -cne $fixtureBridge -or $Digest -cne $fixture.Digest -or $Sid -cne $selectedSid) {
            throw 'unexpected projection target'
        }
        return $targetToken
    }
    function Test-AdministratorBrowserPauseTarget([string]$Value) {
        return $Value -cmatch '\A[a-f0-9]{32}:(?:[a-f0-9]{32}|idle)\z'
    }
    $fixtureBridge = $bridge
    $selectedSid = $sid
    $verify = {
        $fixture.VerifyCount++
        if ($fixture.VerifyError) { throw [ComponentModel.Win32Exception]::new($fixture.VerifyError) }
        Get-AdministratorBrowserPauseTarget $fixture.Archive $fixture.Digest $fixture.Stager $program $system {
            param($SystemDirectory)
            if ($SystemDirectory -cne $system) { throw 'unexpected system directory' }
            return $fixtureIdentity
        }
    }
    $start = {
        param($Plan)
        $fixture.StartCount++
        $fixture.Plan = $Plan
        if ($fixture.StartError) { throw [ComponentModel.Win32Exception]::new($fixture.StartError) }
        return $fixture.Started
    }
    $reply = Invoke-AdministratorBrowserPauseAction $check '' $common $verify $start
    if ($reply -cne ('{"state":"supported","target":"' + $targetToken + '"}') -or $fixture.StartCount -ne 0 -or $fixture.VerifyCount -ne 1) {
        $null = & $verify
        throw "Read-only support check did not verify exactly once without starting: $reply"
    }
    $checks = @('anchor','base','commit','registry',$metadataPath,$stagerPath,$archivePath)
    if (($fixture.Checks -join '|') -cne ($checks -join '|')) { throw 'support check skipped or reordered a required check' }
    $fixture.Checks.Clear()
    $reply = Invoke-AdministratorBrowserPauseAction $request $operation $requestArgs $verify $start $targetToken
    $requested = '{"operationId":"' + $operation + '","state":"requested"}'
    $unknown = '{"operationId":"' + $operation + '","state":"unconfirmed"}'
    $cancelled = '{"operationId":"' + $operation + '","state":"cancelled"}'
    $expected = '-NoLogo -NoProfile -NonInteractive -File "{0}" -Action PauseBrowserHostedOwner -Archive "{1}" -ExpectedSha256 {2} -PauseOperationId {3} -ExpectedUserSid {4} -Consent pause-browser-administrator-owner -BrowserPauseTarget {5}' -f
        $stagerPath,$archivePath,$digest,$operation,$sid,$targetToken
    if ($reply -cne $requested -or $fixture.StartCount -ne 1 -or $fixture.VerifyCount -ne 2 -or
        ($fixture.Checks -join '|') -cne ($checks -join '|') -or
        $fixture.Plan -isnot [Diagnostics.ProcessStartInfo] -or $fixture.Plan.FileName -cne $executable -or
        $fixture.Plan.WorkingDirectory -cne $system -or $fixture.Plan.Arguments -cne $expected -or
        -not $fixture.Plan.UseShellExecute -or $fixture.Plan.Verb -cne 'runas' -or
        $fixture.Plan.WindowStyle -ne [Diagnostics.ProcessWindowStyle]::Hidden -or
        $fixture.Plan.RedirectStandardInput -or $fixture.Plan.RedirectStandardOutput -or $fixture.Plan.RedirectStandardError) {
        throw 'request did not verify and construct only the fixed runas Pause command'
    }
    Write-Output 'PASS support and request share preflight; request prepares only the sealed runas command'

    function Assert-PreflightRefused([string]$Case) {
        $starts = $fixture.StartCount
        if ((Invoke-AdministratorBrowserPauseAction $check '' $common $verify $start) -or
            (Invoke-AdministratorBrowserPauseAction $request $operation $requestArgs $verify $start $targetToken) -cne $unknown -or
            $fixture.StartCount -ne $starts) { throw "Preflight admitted: $Case" }
    }
    foreach ($refusal in @('anchor','base','commit','registry',$metadataPath,$stagerPath,$archivePath)) {
        $fixture.Refuse = $refusal
        Assert-PreflightRefused $refusal
    }
    $fixture.Refuse = ''
    $fixture.Pending = $true
    Assert-PreflightRefused 'pending enrollment'
    $fixture.Pending = $false
    foreach ($case in @(
        @{Key='SessionId'; Value=0}, @{Key='Elevated'; Value=$true}, @{Key='Integrity'; Value='S-1-16-12288'},
        @{Key='Sid'; Value='S-1-5-18'}, @{Key='Sid'; Value='S-1-5-21-1-2-3-1002'})) {
        $saved = $fixtureIdentity[$case.Key]
        $fixtureIdentity[$case.Key] = $case.Value
        Assert-PreflightRefused $case.Key
        $fixtureIdentity[$case.Key] = $saved
    }
    foreach ($case in @(
        @{Key='Archive'; Value="$bridge\other.zip"}, @{Key='Stager'; Value="C:\Temp\stager.ps1"},
        @{Key='Digest'; Value=('f' * 64)}, @{Key='Digest'; Value='not-hex'})) {
        $saved = $fixture[$case.Key]
        $fixture[$case.Key] = $case.Value
        Assert-PreflightRefused $case.Key
        $fixture[$case.Key] = $saved
    }
    $metadata = $fixture.Bytes[$metadataPath]
    $fixture.Bytes.Remove($metadataPath)
    Assert-PreflightRefused 'legacy enrollment without stager hash'
    foreach ($invalidMetadata in @(
        (Get-AdministratorBrowserPauseMetadata ('f' * 64) $sid $stagerHash),
        (Get-AdministratorBrowserPauseMetadata $digest 'S-1-5-21-1-2-3-1002' $stagerHash),
        (Get-AdministratorBrowserPauseMetadata $digest $sid ('f' * 64)),
        ([Text.Encoding]::ASCII.GetBytes('{"version":1}')))) {
        $fixture.Bytes[$metadataPath] = $invalidMetadata
        Assert-PreflightRefused 'malformed or mismatched enrollment metadata'
    }
    $fixture.Bytes[$metadataPath] = $metadata
    $fixture.Bytes[$archivePath] = [byte[]]@(1,2,4)
    Assert-PreflightRefused 'changed sealed archive bytes'
    $fixture.Bytes[$archivePath] = $archiveBytes
    $fixture.Bytes[$stagerPath] = [byte[]]@(4,5,7)
    Assert-PreflightRefused 'changed sealed stager bytes'
    $fixture.Bytes[$stagerPath] = $stagerBytes
    $fixture.VerifyError = 1223
    Assert-PreflightRefused 'verification errors cannot report OS launch cancellation'
    $fixture.VerifyError = 0
    Write-Output 'PASS support and request refuse untrusted identity, paths, enrollment, ACLs and bytes before launch'

    $starts = $fixture.StartCount
    $verifies = $fixture.VerifyCount
    foreach ($forbidden in @('Consent','ExpectedUserSid','BrowserExtensionId','ExpectedStagerSha256','BrowserWake','HostedWindowSource')) {
        if ((Invoke-AdministratorBrowserPauseAction $request $operation ($requestArgs + $forbidden) $verify $start $targetToken) -cne $unknown -or
            (Invoke-AdministratorBrowserPauseAction $check '' ($common + $forbidden) $verify $start)) {
            throw "Unexpected browser Pause parameter admitted: $forbidden"
        }
    }
    if ((Invoke-AdministratorBrowserPauseAction $request 'bad"id' $requestArgs $verify $start $targetToken) -cne
            '{"operationId":null,"state":"unconfirmed"}' -or
        (Invoke-AdministratorBrowserPauseAction $check $operation $requestArgs $verify $start) -or
        (Invoke-AdministratorBrowserPauseAction $check '' $requestArgs $verify $start) -or
        $fixture.StartCount -ne $starts -or $fixture.VerifyCount -ne $verifies) {
        throw 'invalid request fields reached preflight or start'
    }
    foreach ($case in @(@{Code=1223; Reply=$cancelled}, @{Code=5; Reply=$unknown}, @{Code=0; Reply=$unknown})) {
        $fixture.StartError = $case.Code
        $fixture.Started = $false
        if ((Invoke-AdministratorBrowserPauseAction $request $operation $requestArgs $verify $start $targetToken) -cne $case.Reply) {
            throw "Incorrect launch acknowledgement for code $($case.Code)"
        }
    }
    if ($fixture.StartCount -ne ($starts + 3)) { throw 'a launch was retried or skipped' }
    Write-Output 'PASS compact launch acknowledgements distinguish Windows cancellation and never claim Pause committed'

    $fixture.Started = $true
    $starts = $fixture.StartCount
    $oldTarget = ('d' * 32) + ':idle'
    if ((Invoke-AdministratorBrowserPauseAction $request $operation $requestArgs $verify $start $oldTarget) -cne $unknown -or
        (Invoke-AdministratorBrowserPauseAction $request $operation $requestArgs $verify $start) -cne $unknown -or
        $fixture.StartCount -ne $starts) { throw 'missing or changed target reached runas' }
    $fenceArgs = $common + 'PauseOperationId'
    $fencePlan = '-NoLogo -NoProfile -NonInteractive -File "{0}" -Action FenceBrowserHostedOwnerPause -Archive "{1}" -ExpectedSha256 {2} -PauseOperationId {3} -ExpectedUserSid {4} -Consent fence-browser-administrator-pause' -f
        $stagerPath,$archivePath,$digest,$operation,$sid
    if ((Invoke-AdministratorBrowserPauseAction $fence $operation $fenceArgs $verify $start) -cne $requested -or
        $fixture.StartCount -ne ($starts + 1) -or $fixture.Plan.Arguments -cne $fencePlan) {
        throw 'reconciliation did not build the separate fixed fence command'
    }
    Write-Output 'PASS stale target never prompts; reconciliation launches only the fixed fence command'
}

function Test-BrowserPauseNativeToken {
    $process = [Diagnostics.Process]::GetCurrentProcess()
    $current = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        if ($process.SessionId -eq 0 -or ([Security.Principal.WindowsPrincipal]::new($current)).IsInRole(
                [Security.Principal.WindowsBuiltInRole]::Administrator)) {
            Write-Output 'SKIP actual browser Pause token probe requires an ordinary interactive Windows process'
            return
        }
        $systemSid = 'S-1-5-18'
        $administratorsSid = 'S-1-5-32-544'
        $installerSid = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
        $source = [IO.Path]::Combine([IO.Path]::GetDirectoryName($PSScriptRoot),'scripts','Stage-WindowsAdministratorBundle.ps1')
        $ast = [Management.Automation.Language.Parser]::ParseFile($source,[ref]$null,[ref]$null)
        $names = @('Assert-PathType','Assert-Anchor','Assert-AdministratorBrowserPauseAnchors','Get-AdministratorBrowserPauseIdentity')
        $definitions = $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -cin $names },$false)
        if ($definitions.Count -ne $names.Count) { throw 'missing native token fixture functions' }
        . ([scriptblock]::Create(($definitions.Extent.Text -join [char]10)))
        $system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
        $program = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
        Assert-AdministratorBrowserPauseAnchors $program $system
        $result = Get-AdministratorBrowserPauseIdentity $system
        if ($result.Sid -cne $current.User.Value -or $result.SessionId -ne $process.SessionId -or
            $result.Elevated -ne $false -or $result.Integrity -cne 'S-1-16-8192') { throw 'native token probe mismatch' }
        Write-Output 'PASS actual native anchors and actual medium interactive Windows token'
    } finally {
        $current.Dispose()
        $process.Dispose()
    }
}

Test-BrowserPauseStagerFixtures
Test-BrowserPauseNativeToken
if ($BrowserPauseFixturesOnly) { return }

$node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$ps = [IO.Path]::Combine([Environment]::GetFolderPath([Environment+SpecialFolder]::System),'WindowsPowerShell\v1.0\powershell.exe')
$tmp = & $node -p "require('fs').realpathSync.native(require('os').tmpdir())"
if ($LASTEXITCODE -ne 0 -or $tmp -isnot [string] -or -not [IO.Directory]::Exists($tmp)) { throw 'test_tmp_unavailable' }
$scratch = [IO.Path]::Combine($tmp,'ac-admin-bundle-test-' + [guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($scratch)
$required = @('runtime/node.exe','client/tunnel-client-runtime.exe','app/host.mjs',
    'app/runtime.mjs','app/lifecycle.mjs','app/profile.mjs','app/tunnel-pins.json','app/upstream-pin.json',
    'app/package-lock.json','app/node_modules/@wonderwhy-er/desktop-commander/dist/server.js')
$null = [Reflection.Assembly]::Load('System.IO.Compression, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089')

function New-Bundle([string[]]$Names, [string]$Special = '', [int]$Flags = 0) {
    $file = Join-Path $scratch ([guid]::NewGuid().ToString('N') + '.zip')
    $stream = [IO.File]::Open($file,'CreateNew','ReadWrite','None')
    $zip = [IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($name in $Names) {
            $entry = $zip.CreateEntry($name)
            if ($name -ceq $Special) { $entry.ExternalAttributes = $Flags }
            $data = $entry.Open()
            try { $data.WriteByte(65) } finally { $data.Dispose() }
        }
    } finally { $zip.Dispose() }
    return $file
}

function Invoke-Case([string]$Name, [string]$Archive, [string]$Action, [bool]$Ok, [string]$Phase,
    [string]$Consent = '', [string]$Digest = '', [string]$ExpectedUserSid = '', [int]$Witness = 0,
    [int]$ExpectedExit = -1, [string]$HostedTunnelId = '', [string]$RuntimeKeyFile = '', [string]$OperationReceiptId = '',
    [string]$HostedWindowSource = '', [int]$HostedWindowSeconds = 0, [string]$BrowserExtensionId = '',
    [string]$PauseOperationId = '',[string]$BrowserPauseTarget = '') {
    if (-not $Digest) { $Digest = (Get-FileHash -LiteralPath $Archive).Hash.ToLowerInvariant() }
    $args = @('-NoLogo','-NoProfile','-NonInteractive','-File',$stager,
        '-Archive',$Archive,'-ExpectedSha256',$Digest,'-Action',$Action)
    if ($Consent) { $args += @('-Consent',$Consent) }
    if ($ExpectedUserSid) { $args += @('-ExpectedUserSid',$ExpectedUserSid) }
    if ($Witness) { $args += @('-LocalAcceptanceWitness',$Witness) }
    if ($HostedTunnelId) { $args += @('-HostedTunnelId',$HostedTunnelId) }
    if ($RuntimeKeyFile) { $args += @('-RuntimeKeyFile',$RuntimeKeyFile) }
    if ($OperationReceiptId) { $args += @('-OperationReceiptId',$OperationReceiptId) }
    if ($HostedWindowSource) { $args += @('-HostedWindowSource',$HostedWindowSource) }
    if ($HostedWindowSeconds) { $args += @('-HostedWindowSeconds',$HostedWindowSeconds) }
    if ($BrowserExtensionId) { $args += @('-BrowserExtensionId',$BrowserExtensionId) }
    if ($PauseOperationId) { $args += @('-PauseOperationId',$PauseOperationId) }
    if ($BrowserPauseTarget) { $args += @('-BrowserPauseTarget',$BrowserPauseTarget) }
    if ($ExpectedExit -eq -1) { $ExpectedExit = if ($Ok) { 0 } else { 2 } }
    $lines = @(& $ps @args)
    $exit = $LASTEXITCODE
    if ($lines.Count -ne 1) { throw "$Name unexpected output" }
    $result = $lines[0] | ConvertFrom-Json
    if ($result.ok -ne $Ok -or $result.phase -cne $Phase -or $result.protectedFilesVerified -ne $false -or
        $result.administratorStateVerified -ne $false -or $result.cleanLaunchPlanVerified -ne $false -or
        $result.administratorChildVerified -ne $false -or $result.tunnelStarted -ne $false -or
        $result.hostedBindingPrepared -ne $false -or $result.hostedLaunchPlanVerified -ne $false -or
        $result.activated -ne $false -or $result.registrationChanged -ne $false -or
        $exit -ne $ExpectedExit) { throw "$Name unexpected result: $($lines[0])" }
    Write-Output "PASS $Name"
}

function Assert-PauseResult($Result, [string]$Id, [string]$State) {
    if ($Result.operationId -cne $Id -or $Result.state -cne $State) {
        throw "Expected pause $Id to be $($State): $(ConvertTo-Json -InputObject $Result -Compress)"
    }
}

try {
    if ($NodeArchive) {
        $nodeFolder = Join-Path $scratch 'official-node'
        $null = [IO.Directory]::CreateDirectory($nodeFolder)
        $writer = Join-Path ([IO.Path]::GetDirectoryName($stager)) 'Write-WindowsAdministratorBundle.ps1'
        & $ps -NoProfile -NonInteractive -File $writer -Action Node -Source $NodeArchive -Destination $nodeFolder -Reference 'node-v22.23.4-win-x64'
        if ($LASTEXITCODE -ne 0) { throw 'test_node_extract_failed' }
        $node = Join-Path $nodeFolder 'node.exe'
        if ((Get-FileHash -LiteralPath $node).Hash.ToLowerInvariant() -cne 'dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f') {
            throw 'test_node_digest_mismatch'
        }
    }
    $valid = New-Bundle $required
    Invoke-Case 'native Program Files anchor and exact ZIP layout' $valid Plan $true 'complete'
    Invoke-Case 'an acceptance witness cannot be used with a successful Plan' $valid Plan $false 'input' -Witness 654321
    Invoke-Case 'digest mismatch' $valid Plan $false 'archive' -Digest ('0' * 64)
    Invoke-Case 'stage requires explicit approval' $valid Stage $false 'input'
    Invoke-Case 'verify rejects unstaged bundle' $valid Verify $false 'verify'
    Invoke-Case 'missing provider' (New-Bundle $required[0..8]) Plan $false 'layout'
    foreach ($member in @('app/../outside.js','app/a.js:stream','app/CON.txt','app/.env.local',
        'app/host.MJS','app/HOST.MJS/child.js','app/node_MODULES/unexpected.mjs','state/runtime.key')) {
        Invoke-Case "reject $member" (New-Bundle ($required + $member)) Plan $false 'layout'
    }
    $redirect = 'app/redirect.js'
    Invoke-Case 'reject Unix ZIP symbolic link' (New-Bundle ($required + $redirect) $redirect (-1610612736)) Plan $false 'layout'
    Invoke-Case 'reject Windows ZIP reparse attribute' (New-Bundle ($required + $redirect) $redirect 1024) Plan $false 'layout'
    $who = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        $admin = [Security.Principal.WindowsPrincipal]::new($who).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        $fixtureSid = $who.User.Value
        Invoke-Case 'state needs explicit approval' $valid PrepareState $false 'input' -ExpectedUserSid $fixtureSid
        Invoke-Case 'state rejects SYSTEM as selected user' $valid PrepareState $false 'input' 'accept-administrator-state-preparation' -ExpectedUserSid 'S-1-5-18'
        Invoke-Case 'local probe needs explicit approval' $valid ProbeLocal $false 'input' -ExpectedUserSid $fixtureSid
        Invoke-Case 'local probe rejects SYSTEM as selected user' $valid ProbeLocal $false 'input' 'accept-administrator-local-probe' -ExpectedUserSid 'S-1-5-18'
        Invoke-Case 'first acceptance requires separate approval' $valid AcceptLocal $false 'input' 'accept-administrator-local-probe' -ExpectedUserSid $fixtureSid
        Invoke-Case 'first acceptance rejects SYSTEM as selected user' $valid AcceptLocal $false 'input' 'accept-administrator-first-local-acceptance' -ExpectedUserSid 'S-1-5-18'
        Invoke-Case 'first acceptance requires the selected account' $valid AcceptLocal $false 'identity' 'accept-administrator-first-local-acceptance' -ExpectedUserSid 'S-1-5-21-1-2-3-1001'
        Invoke-Case 'mediated first acceptance preserves an account refusal as failure' $valid AcceptLocal $false 'identity' 'accept-administrator-first-local-acceptance' -ExpectedUserSid 'S-1-5-21-1-2-3-1001' -Witness 654321 -ExpectedExit 21
        $fixtureTunnel = 'tunnel_0123456789abcdef0123456789abcdef'
        Invoke-Case 'binding requires explicit consent' $valid BindHosted $false 'input' -ExpectedUserSid $fixtureSid -HostedTunnelId $fixtureTunnel
        Invoke-Case 'binding rejects a malformed tunnel before any mutation' $valid BindHosted $false 'input' 'accept-administrator-hosted-binding' -ExpectedUserSid $fixtureSid -HostedTunnelId 'http://untrusted.invalid/'
        Invoke-Case 'hosted launch verification does not accept mutation consent' $valid VerifyHosted $false 'input' 'accept-administrator-hosted-binding' -ExpectedUserSid $fixtureSid -HostedTunnelId $fixtureTunnel
        Invoke-Case 'persistent owner requires its own full-account consent' $valid AuthorizeHostedOwner $false 'input' 'accept-administrator-hosted-binding' -ExpectedUserSid $fixtureSid -HostedTunnelId $fixtureTunnel
        Invoke-Case 'owner revocation requires explicit consent' $valid RevokeHostedOwner $false 'input' 'accept-persistent-administrator-full-account' -ExpectedUserSid $fixtureSid
        Invoke-Case 'fixed owner wake requires explicit setup authorization' $valid StartHostedOwner $false 'input' 'accept-persistent-administrator-full-account' -ExpectedUserSid $fixtureSid -HostedTunnelId $fixtureTunnel
        Invoke-Case 'first Connect rejects reuse of wake consent' $valid ConnectHostedOwner $false 'input' 'restore-authorized-administrator-owner' -ExpectedUserSid $fixtureSid -HostedTunnelId $fixtureTunnel -BrowserExtensionId ('b' * 32)
        Invoke-Case 'persistent Pause requires its own consent' $valid PauseHostedOwner $false 'input' 'restore-authorized-administrator-owner' -ExpectedUserSid $fixtureSid
        Invoke-Case 'browser unenroll requires separate consent' $valid UnenrollBrowserOwner $false 'input' 'accept-administrator-browser-enrollment' -ExpectedUserSid $fixtureSid -HostedTunnelId $fixtureTunnel -BrowserExtensionId ('b' * 32)
        Invoke-Case 'browser unenroll refuses a missing exact origin' $valid UnenrollBrowserOwner $false 'input' 'accept-administrator-browser-unenrollment' -ExpectedUserSid $fixtureSid -HostedTunnelId $fixtureTunnel
        Invoke-Case 'browser unenroll refuses a different account before touching registration' $valid UnenrollBrowserOwner $false 'identity' 'accept-administrator-browser-unenrollment' -ExpectedUserSid 'S-1-5-21-1-2-3-1001' -HostedTunnelId $fixtureTunnel -BrowserExtensionId ('b' * 32)
        Invoke-Case 'tunnel input is refused for an unrelated action' $valid Plan $false 'input' -HostedTunnelId $fixtureTunnel
        $keySource = Join-Path $scratch 'source key.txt'
        Invoke-Case 'key file requires a durable receipt ID' $valid BindHosted $false 'input' 'accept-administrator-hosted-binding' -ExpectedUserSid $fixtureSid -HostedTunnelId $fixtureTunnel -RuntimeKeyFile $keySource
        Invoke-Case 'readback never accepts a key file' $valid VerifyHosted $false 'input' -ExpectedUserSid $fixtureSid -HostedTunnelId $fixtureTunnel -RuntimeKeyFile $keySource -OperationReceiptId ('a' * 32)
        $windowParams = @{ExpectedUserSid=$fixtureSid;HostedTunnelId=$fixtureTunnel;OperationReceiptId=('b' * 32);
            HostedWindowSource=$keySource;HostedWindowSeconds=30}
        Invoke-Case 'window requires separate runtime consent' $valid RunHostedWindow $false 'input' @windowParams
        Invoke-Case 'stop requires a specific window receipt' $valid StopHostedWindow $false 'input' 'stop-administrator-hosted-window' -ExpectedUserSid $fixtureSid
        if (-not $admin) {
            Invoke-Case 'ordinary token cannot stage' $valid Stage $false 'identity' 'accept-administrator-bundle-stage'
            Invoke-Case 'ordinary token cannot prepare protected state' $valid PrepareState $false 'identity' 'accept-administrator-state-preparation' -ExpectedUserSid $fixtureSid
            Invoke-Case 'ordinary token cannot run the administrator probe' $valid ProbeLocal $false 'identity' 'accept-administrator-local-probe' -ExpectedUserSid $fixtureSid
            Invoke-Case 'ordinary token cannot perform first acceptance' $valid AcceptLocal $false 'identity' 'accept-administrator-first-local-acceptance' -ExpectedUserSid $fixtureSid
            Invoke-Case 'ordinary token cannot prepare hosted binding or prompt for a secret' $valid BindHosted $false 'identity' 'accept-administrator-hosted-binding' -ExpectedUserSid $fixtureSid -HostedTunnelId $fixtureTunnel
            Invoke-Case 'ordinary token cannot verify an elevated launch plan' $valid VerifyHosted $false 'identity' -ExpectedUserSid $fixtureSid -HostedTunnelId $fixtureTunnel
            Invoke-Case 'ordinary token cannot open a hosted window' $valid RunHostedWindow $false 'identity' 'accept-administrator-hosted-window' @windowParams
            Invoke-Case 'ordinary token cannot authorize a persistent administrator owner' $valid AuthorizeHostedOwner $false 'identity' 'accept-persistent-administrator-full-account' -ExpectedUserSid $fixtureSid -HostedTunnelId $fixtureTunnel
            Invoke-Case 'ordinary token cannot revoke the protected administrator owner' $valid RevokeHostedOwner $false 'identity' 'revoke-persistent-administrator-full-account' -ExpectedUserSid $fixtureSid
            Invoke-Case 'ordinary token cannot launch the protected administrator owner' $valid StartHostedOwner $false 'identity' 'restore-authorized-administrator-owner' -ExpectedUserSid $fixtureSid -HostedTunnelId $fixtureTunnel
            Invoke-Case 'ordinary token cannot grant first Connect' $valid ConnectHostedOwner $false 'identity' 'connect-authorized-administrator-owner' -ExpectedUserSid $fixtureSid -HostedTunnelId $fixtureTunnel -BrowserExtensionId ('b' * 32)
            Invoke-Case 'ordinary token cannot invoke the elevated pause action' $valid PauseHostedOwner $false 'identity' 'pause-authorized-administrator-owner' -ExpectedUserSid $fixtureSid
            Invoke-Case 'ordinary token cannot apply a browser Pause' $valid PauseBrowserHostedOwner $false 'identity' 'pause-browser-administrator-owner' -ExpectedUserSid $fixtureSid -PauseOperationId ('a'*32) -BrowserPauseTarget (('b'*32)+':idle')
            Invoke-Case 'ordinary token cannot fence a browser Pause' $valid FenceBrowserHostedOwnerPause $false 'identity' 'fence-browser-administrator-pause' -ExpectedUserSid $fixtureSid -PauseOperationId ('a'*32)
            Invoke-Case 'ordinary token cannot repair the protected Pause target' $valid RepairBrowserHostedOwnerPauseTarget $false 'identity' 'repair-browser-administrator-pause-target' -ExpectedUserSid $fixtureSid
            Invoke-Case 'ordinary token cannot remove machine-wide browser enrollment' $valid UnenrollBrowserOwner $false 'identity' 'accept-administrator-browser-unenrollment' -ExpectedUserSid $fixtureSid -HostedTunnelId $fixtureTunnel -BrowserExtensionId ('b' * 32)
        } else { Write-Output 'SKIP ordinary-token refusal: test shell already elevated' }
    } finally { $who.Dispose() }

    # Exercise the native creation and descriptor checks against a disposable
    # tree with fixture ownership. No test writes to the real protected root.
    $ast = [Management.Automation.Language.Parser]::ParseFile($stager,[ref]$null,[ref]$null)
    $names = @('Assert-PathType','Assert-FirstLocalAcceptanceAvailable','New-SealedAcl','Assert-SealedAcl','Ensure-SealedDirectory','Open-SealedNewFile',
        'Copy-Or-Hash','To-Hex','Get-Layout','Verify-SealedBundle','Get-AdministratorStateLayout',
        'Write-AdministratorState','Assert-FreshAdministratorState','New-AdministratorLaunchPlan','Test-LocalProbeResult','Get-LocalProbeFailureCode',
        'Get-AdministratorRuntimeKeyBytes','New-AdministratorHostedDocument','Assert-AdministratorHostedVault',
        'Get-AdministratorHostedMetadata','New-AdministratorHostedLaunchPlan','Write-AdministratorHostedBinding','Write-AdministratorOwnerActivation','Request-AdministratorOwnerRevocation',
        'Get-AdministratorOwnerMetadata','Write-AdministratorOwnerFile','Assert-AdministratorOwnerBytes','Assert-AdministratorOwnerWake',
        'Test-AdministratorOwnerAbsent','Test-AdministratorOwnerIntent','Test-AdministratorOwnerRunIntent','Test-AdministratorOwnerInnerLeasesClear',
        'Get-AdministratorOwnerJobType','Invoke-AdministratorOwnerJob',
        'Open-AdministratorOwnerControl','Read-AdministratorOwnerControlRevision','Write-AdministratorOwnerControlRevision',
        'Write-AdministratorOwnerIntent','Request-AdministratorOwnerPause','Fence-AdministratorOwnerPause','Assert-AdministratorOwnerControlIdentity',
        'Get-AdministratorPauseReceiptBytes','Read-AdministratorOwnerPause','Publish-AdministratorOwnerPause',
        'Get-AdministratorPauseReservationBytes','Publish-AdministratorPauseReservation','Get-AdministratorPauseGeneration','Complete-AdministratorOwnerPause',
        'Test-AdministratorBrowserPauseTarget','Read-AdministratorBrowserPauseTargetProjection','Update-AdministratorBrowserPauseTarget',
        'Get-AdministratorControlSupportProjectionBytes','Read-AdministratorBrowserControlSupportProjection',
        'Get-AdministratorBrowserControlOwnerState','Publish-AdministratorBrowserControlSupportProjection',
        'Repair-AdministratorBrowserPauseTarget',
        'Request-AdministratorOwnerConnect','Invoke-AdministratorOwnerConnectCheck',
        'Read-AdministratorBrowserCommit','Write-AdministratorBrowserAsset','Assert-AdministratorBrowserAsset','Publish-AdministratorBrowserEnrollment',
        'Read-AdministratorOwnerObservationDocument','Read-AdministratorOwnerSample',
        'Publish-AdministratorOwnerObservation','Read-AdministratorOwnerObservation',
        'Open-LocalProbeReceipt','Publish-LocalProbeReceipt','Get-LocalProbeProcessId','Read-LocalProbeCompletion',
        'Read-AdministratorRuntimeKeyFile','Read-HostedWindowBytes','Read-HostedWindowSource','Request-HostedWindowStop','Write-HostedWindowSignal',
        'Assert-InheritedPrivateAcl','Read-PriorReadOnlyWindow','Assert-ReadOnlyProviderConfig')
    $definitions = @($ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] },$true) |
        Where-Object { $_.Name -in $names })
    foreach ($fn in $definitions) {
        . ([scriptblock]::Create($fn.Extent.Text))
    }
    $nonce = 'a' * 32
    $marker = "AC_LOCAL_TOKEN_$($nonce):123"
    $start = 'Process started with PID 123 (shell: Windows PowerShell)'
    $done = ([string][char]0x2705) + ' Process 123 has finished execution'
    $lines = @(
        "$start" + [char]10 + "$marker" + [char]10 + "$done"
        "$start" + [char]10 + "$marker" + [char]10 + ($done -replace '123','456')
        "$start" + [char]10 + ($marker -replace '123','456') + [char]10 + "$done"
        "$start" + [char]10 + ($marker -replace $nonce,('b' * 32)) + [char]10 + "$done"
        "$start" + [char]10 + "$done" + [char]10 + "$marker"
    )
    for ($i=0; $i -lt $lines.Count; $i++) {
        $reply = [pscustomobject]@{content=@([pscustomobject]@{type='text';text=$lines[$i]})}
        if ((Test-LocalProbeResult $reply $nonce) -ne ($i -eq 0)) { throw "bad_token_receipt_case_$i" }
    }
    Write-Output 'PASS probe requires ordered start, exact nonce and same child PID on exit'
    $failureMarker = "AC_LOCAL_FAILURE_$($nonce):123:native_setup"
    $diagnostics = @(
        "$start`n$failureMarker"
        "$start`n$($failureMarker.Replace(':123:',':456:'))"
        "$start`n$($failureMarker.Replace($nonce,('b' * 32)))"
        "$start`n$($failureMarker.Replace('native_setup','unrecognized'))"
        "$failureMarker`n$start"
        "$start`n$failureMarker`n$failureMarker"
    )
    for ($i=0; $i -lt $diagnostics.Count; $i++) {
        $reply = [pscustomobject]@{content=@([pscustomobject]@{type='text';text=$diagnostics[$i]})}
        $expected = if ($i -eq 0) { 'probe_token_native_setup' } else { 'probe_child_token' }
        if ((Get-LocalProbeFailureCode $reply $nonce) -cne $expected -or (Test-LocalProbeResult $reply $nonce)) {
            throw "bad_token_diagnostic_case_$i"
        }
    }
    Write-Output 'PASS diagnostic requires exact nonce, same child PID, and a single known category'
    $startReply = [pscustomobject]@{structuredContent=[pscustomobject]@{pid=123};content=@([pscustomobject]@{type='text';text=$start})}
    if ((Get-LocalProbeProcessId $startReply) -ne 123) { throw 'probe_pid_not_accepted' }
    $startReply.structuredContent.pid = 456
    if (Get-LocalProbeProcessId $startReply) { throw 'probe_pid_mismatch_accepted' }
    $startReply.structuredContent = $null
    if ((Get-LocalProbeProcessId $startReply) -ne 123) { throw 'pinned_provider_text_only_pid_rejected' }
    $startReply.content[0].text = "unrelated`n$start"
    if (Get-LocalProbeProcessId $startReply) { throw 'embedded_start_pid_accepted' }
    $readEnd = ([string][char]0x2705) + ' Process completed with exit code 0 (runtime: 1.25s)'
    $followUps = @(
        @{text=$marker; status='pending'}
        @{text="$marker`n$readEnd"; status='ok'}
        @{text="$readEnd`n$marker"; status='probe_marker_missing'}
        @{text="$marker`n$marker`n$readEnd"; status='probe_marker_missing'}
        @{text="$($marker.Replace(':123',':456'))`n$readEnd"; status='probe_marker_missing'}
        @{text="$marker`n$($readEnd.Replace('exit code 0','exit code 1'))"; status='probe_process_nonzero'}
        @{text="$failureMarker`n$($readEnd.Replace('exit code 0','exit code 31'))"; status='probe_token_native_setup'}
    )
    foreach ($case in $followUps) {
        $reply = [pscustomobject]@{content=@([pscustomobject]@{type='text';text=$case.text})}
        if ((Read-LocalProbeCompletion $reply $nonce 123) -cne $case.status) { throw 'bad_probe_completion' }
    }
    Write-Output 'PASS later output requires the same child nonce and actual zero exit code'
    $slots = Join-Path $scratch 'first-acceptance'
    $null = [IO.Directory]::CreateDirectory($slots)
    $suffixes = @('', '.state', '.stage', '.state.stage', '.secrets')
    for ($i=0; $i -lt $suffixes.Count; $i++) {
        $candidate = Join-Path $slots ('bundle-' + $i)
        Assert-FirstLocalAcceptanceAvailable $candidate
        $occupied = $candidate + $suffixes[$i]
        if ($i -lt 2 -or $suffixes[$i] -eq '.secrets') { $null = [IO.Directory]::CreateDirectory($occupied) }
        else { [IO.File]::WriteAllText($occupied, 'reservation') }
        try {
            Assert-FirstLocalAcceptanceAvailable $candidate
            throw 'accepted_occupied_first_install_slot'
        } catch {
            if ($_.Exception.Message -cne 'existing_acceptance_artifact') { throw }
        }
    }
    Write-Output 'PASS first acceptance refuses both existing targets and partial reservations'
    $me = [Security.Principal.WindowsIdentity]::GetCurrent()
    try { $administratorsSid = $me.User.Value } finally { $me.Dispose() }
    $systemSid = 'S-1-5-18'
    $usersSid = 'S-1-5-32-545'
    $enrollment = Join-Path $scratch 'interrupted-browser-enrollment'
    Ensure-SealedDirectory $enrollment $false $fixtureSid
    $prepared = Join-Path $enrollment 'enrollment.pending'
    $published = Join-Path $enrollment 'enrolled.json'
    $digest = 'b' * 64
    $commit = '{{"version":1,"bundleSha256":"{0}"}}' -f $digest
    Write-AdministratorBrowserAsset $prepared ([Text.Encoding]::ASCII.GetBytes($commit)) $fixtureSid
    Read-AdministratorBrowserCommit $enrollment $digest $fixtureSid -ForRemoval
    try { Read-AdministratorBrowserCommit $enrollment $digest $fixtureSid; throw 'pending_enrollment_admitted' }
    catch { if ($_.Exception.GetBaseException() -isnot [IO.FileNotFoundException]) { throw } }
    try { Read-AdministratorBrowserCommit $enrollment ('c' * 64) $fixtureSid -ForRemoval; throw 'foreign_pending_accepted' }
    catch { if ($_.Exception.Message -cne 'browser_enrollment_not_committed') { throw } }
    $markerVault = Join-Path $scratch 'interrupted-enrollment-vault'
    Ensure-SealedDirectory $markerVault $true
    Write-AdministratorOwnerFile (Join-Path $markerVault 'owner-control.guard') ([Text.Encoding]::ASCII.GetBytes(('a' * 32) + [char]10))
    $denial = Join-Path $markerVault 'owner-revoked'
    Write-AdministratorOwnerFile $denial ([byte[]]::new(0))
    $markerPlan = @{Bridge=$enrollment; Sid=$fixtureSid}
    try { Publish-AdministratorBrowserEnrollment $markerPlan $digest $markerVault; throw 'revoked_enrollment_published' }
    catch { if ($_.Exception.Message -cne 'browser_owner_unavailable') { throw } }
    if ([IO.File]::Exists($published)) { throw 'revocation_lost_to_publish' }
    Read-AdministratorBrowserCommit $enrollment $digest $fixtureSid -ForRemoval
    [IO.File]::Delete($denial)
    Publish-AdministratorBrowserEnrollment $markerPlan $digest $markerVault
    Read-AdministratorBrowserCommit $enrollment $digest $fixtureSid
    Read-AdministratorBrowserCommit $enrollment $digest $fixtureSid -ForRemoval
    Write-Output 'PASS incomplete browser publication can be reconciled without allowing wake'
    $entryLimit = 192MB
    $totalLimit = 768MB
    $manifestLimit = 40000
    $requiredFiles = $required
    $sha = [Security.Cryptography.SHA256]::Create()
    $bundle = Join-Path $scratch 'native'
    Ensure-SealedDirectory $bundle
    $probeId = 'b' * 32
    $probeDigest = 'c' * 64
    $receiptPrefix = Open-LocalProbeReceipt $bundle $probeId $probeDigest
    $started = [IO.File]::ReadAllText($receiptPrefix + '.started.json') | ConvertFrom-Json
    if ($started.receiptId -cne $probeId -or $started.bundleSha256 -cne $probeDigest -or
        $started.state -cne 'started' -or $started.pid -ne $PID -or [IO.File]::Exists($receiptPrefix + '.result.json')) {
        throw 'probe_started_receipt_mismatch'
    }
    Assert-SealedAcl ($receiptPrefix + '.started.json') $false $true
    try { $null = Open-LocalProbeReceipt $bundle $probeId $probeDigest; throw 'accepted_duplicate_probe_receipt' }
    catch { if ($_.Exception.GetBaseException() -isnot [IO.IOException]) { throw } }
    Publish-LocalProbeReceipt $receiptPrefix $probeId $probeDigest '{"ok":false,"phase":"probe_child"}'
    $finishedPath = $receiptPrefix + '.result.json'
    Assert-SealedAcl $finishedPath $false $true
    $finished = [IO.File]::ReadAllText($finishedPath) | ConvertFrom-Json
    if ($finished.receiptId -cne $probeId -or $finished.bundleSha256 -cne $probeDigest -or
        $finished.result.ok -ne $false -or $finished.result.phase -cne 'probe_child' -or
        [IO.File]::Exists($receiptPrefix + '.result.pending')) { throw 'probe_result_receipt_mismatch' }
    Write-Output 'PASS protected probe receipt is create-only, digest-bound, and publishes the result atomically'
    try { Request-HostedWindowStop $bundle $probeDigest $probeId; throw 'probe_receipt_accepted_as_window' }
    catch { if ($_.Exception.Message -cne 'window_receipt') { throw } }
    $windowId = 'e' * 32
    $windowPrefix = Open-LocalProbeReceipt $bundle $windowId $probeDigest 'RunHostedWindow'
    Request-HostedWindowStop $bundle $probeDigest $windowId
    Request-HostedWindowStop $bundle $probeDigest $windowId
    Assert-SealedAcl ($windowPrefix + '.stop') $false $true
    Write-Output 'PASS stop is private, idempotent, and bound to the same hosted window receipt'
    $stateAfterWindow = $bundle + '.state'
    $stateSpec = Get-AdministratorStateLayout $probeDigest $fixtureSid
    Write-AdministratorState $stateAfterWindow $stateSpec
    $workStem = Join-Path $stateAfterWindow ('work\acceptance-' + $windowId)
    $stepId = 'f' * 32
    $planBody = '[{"id":"' + $stepId + '","name":"read_file","arguments":{}}]'
    foreach ($ext in @('.plan.json','.runner.mjs','.profile.yaml')) {
        $file = Open-SealedNewFile ($workStem + $ext) $true
        try {
            if ($ext -ceq '.plan.json') {
                $body = [Text.Encoding]::UTF8.GetBytes($planBody)
                $file.Write($body,0,$body.Length)
            }
        } finally { $file.Dispose() }
    }
    $priorReceipts = Join-Path $stateAfterWindow ('acceptance-' + $windowId + '-receipts')
    $null = [IO.Directory]::CreateDirectory($priorReceipts)
    [IO.File]::WriteAllText((Join-Path $priorReceipts ($stepId + '.admitted')),'')
    $lifecyclePath = Join-Path $stateAfterWindow 'lifecycle.json'
    [IO.File]::Delete($lifecyclePath)
    [IO.File]::WriteAllText($lifecyclePath,$stateSpec.files['lifecycle.json'],[Text.UTF8Encoding]::new($false))
    $providerPath = Join-Path $stateAfterWindow 'home\.claude-server-commander\config.json'
    $providerBody = $stateSpec.files['home/.claude-server-commander/config.json'].TrimEnd() -replace '\}$',',"usageStats":{}}'
    [IO.File]::Delete($providerPath)
    [IO.File]::WriteAllText($providerPath,$providerBody)
    $cacheDir = Join-Path $stateAfterWindow 'home\AppData\Local\Microsoft\Windows\PowerShell'
    $null = [IO.Directory]::CreateDirectory($cacheDir)
    [IO.File]::WriteAllText((Join-Path $cacheDir 'StartupProfileData-NonInteractive'),'fixture')
    try { $null = Read-PriorReadOnlyWindow $bundle $stateAfterWindow $probeDigest $windowId; throw 'accepted_nonterminal_window' }
    catch { if ($_.Exception.GetBaseException() -isnot [IO.FileNotFoundException]) { throw } }
    Publish-LocalProbeReceipt $windowPrefix $windowId $probeDigest '{"ok":true,"phase":"complete","hostedWindowStoppedConfirmed":true,"hostedWindowOutcome":"stop-requested"}'
    try { $null = Read-PriorReadOnlyWindow $bundle $stateAfterWindow $probeDigest $windowId; throw 'accepted_unsettled_read' }
    catch { if ($_.Exception.GetBaseException() -isnot [IO.FileNotFoundException]) { throw } }
    [IO.File]::WriteAllText((Join-Path $priorReceipts ($stepId + '.provider-replied')),'')
    $prior = Read-PriorReadOnlyWindow $bundle $stateAfterWindow $probeDigest $windowId
    Assert-FreshAdministratorState $stateAfterWindow $stateSpec $prior
    [IO.File]::WriteAllText($providerPath,$providerBody.Replace('"telemetryEnabled":false','"telemetryEnabled":true'))
    try { Assert-FreshAdministratorState $stateAfterWindow $stateSpec $prior; throw 'accepted_changed_provider_policy' }
    catch { if ($_.Exception.Message -cne 'state_content') { throw } }
    [IO.File]::WriteAllText($providerPath,$providerBody)
    $leasePath = Join-Path $stateAfterWindow 'controller.lease'
    [IO.File]::WriteAllText($leasePath,'lease')
    try { Assert-FreshAdministratorState $stateAfterWindow $stateSpec $prior; throw 'accepted_active_lease' }
    catch { if ($_.Exception.Message -cne 'state_closure') { throw } }
    [IO.File]::Delete($leasePath)
    Write-Output 'PASS settled read-only history permits one fresh window; unknown and leased states are refused'
    $unusedId = '7' * 32
    $unusedPrefix = Open-LocalProbeReceipt $bundle $unusedId $probeDigest 'RunHostedWindow'
    Publish-LocalProbeReceipt $unusedPrefix $unusedId $probeDigest '{"ok":true,"phase":"complete","hostedWindowStoppedConfirmed":true,"hostedWindowOutcome":"stop-requested"}'
    $unusedStem = Join-Path $stateAfterWindow ('work\acceptance-' + $unusedId)
    foreach ($ext in @('.plan.json','.runner.mjs','.profile.yaml')) {
        $file = Open-SealedNewFile ($unusedStem + $ext) $true
        try {
            if ($ext -ceq '.plan.json') {
                $body = [Text.Encoding]::UTF8.GetBytes($planBody.Replace('read_file','agent_continue_start_process_exact'))
                $file.Write($body,0,$body.Length)
            }
        } finally { $file.Dispose() }
    }
    $unusedReceipts = Join-Path $stateAfterWindow ('acceptance-' + $unusedId + '-receipts')
    $null = [IO.Directory]::CreateDirectory($unusedReceipts)
    $unused = Read-PriorReadOnlyWindow $bundle $stateAfterWindow $probeDigest $unusedId -Unused
    Assert-FreshAdministratorState $stateAfterWindow $stateSpec $prior $unused
    [IO.File]::WriteAllText((Join-Path $unusedReceipts ($stepId + '.admitted')),'')
    try { $null = Read-PriorReadOnlyWindow $bundle $stateAfterWindow $probeDigest $unusedId -Unused; throw 'accepted_an_admitted_unused_window' }
    catch { if ($_.Exception.Message -cne 'window_receipt') { throw } }
    try { Assert-FreshAdministratorState $stateAfterWindow $stateSpec $prior $unused; throw 'accepted_a_late_admission' }
    catch { if ($_.Exception.Message -cne 'state_closure') { throw } }
    Write-Output 'PASS closed unused window preserves its artifacts and rejects even one admission'
    $source = [IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot,'..\native\desktop-commander\hosted-acceptance-window.mjs'))
    $code = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((Read-HostedWindowSource $source)))
    if ($code -cnotmatch 'export async function runProtectedHostedWindow') { throw 'wrong_window_source' }
    $fakeSource = [IO.Path]::Combine($scratch,'other.js')
    [IO.File]::WriteAllText($fakeSource, $code + ' ')
    try { $null = Read-HostedWindowSource $fakeSource; throw 'accepted_modified_window_source' }
    catch { if ($_.Exception.Message -cne 'window_source') { throw } }
    Write-Output 'PASS hosted window runs only the pinned in-memory source'
    $keySource = Join-Path $scratch 'source key.txt'
    $fixtureKey = 'sk-synthetic-key-for-file-loader-only'
    [IO.File]::WriteAllText($keySource,"$fixtureKey`r`n",[Text.UTF8Encoding]::new($true))
    $parsedKey = Read-AdministratorRuntimeKeyFile $keySource
    try {
        $keyBytes = Get-AdministratorRuntimeKeyBytes $parsedKey
        if ([Text.Encoding]::ASCII.GetString($keyBytes) -cne $fixtureKey) { throw 'bad_key_file' }
    } finally { $parsedKey.Dispose(); if ($keyBytes) { [Array]::Clear($keyBytes,0,$keyBytes.Length) } }
    foreach ($bad in @("$fixtureKey`n$fixtureKey", "$fixtureKey`n`n", "$fixtureKey ", 'sk-too-short', ('x' * 4102))) {
        [IO.File]::WriteAllText($keySource,$bad,[Text.UTF8Encoding]::new($false))
        try { $unexpected = Read-AdministratorRuntimeKeyFile $keySource; $unexpected.Dispose(); throw 'accepted_bad_key_file' }
        catch { if ($_.Exception.Message -cne 'binding_key_format') { throw } }
    }
    foreach ($bad in @('relative.txt','\\example.invalid\share\key.txt',($keySource + ':stream'))) {
        try { $unexpected = Read-AdministratorRuntimeKeyFile $bad; $unexpected.Dispose(); throw 'accepted_bad_key_path' }
        catch { if ($_.Exception.Message -cne 'binding_key_path') { throw } }
    }
    Write-Output 'PASS key-file loader accepts one key and refuses malformed or nonlocal input'
    $stream = [IO.File]::Open($valid,'Open','Read','Read')
    $zip = [IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Read)
    try {
        $layout = Get-Layout $zip $bundle
        foreach ($entry in $zip.Entries) {
            $dir = $bundle
            $segments = $entry.FullName.Split('/')
            for ($i=0; $i -lt $segments.Length-1; $i++) {
                $dir = [IO.Path]::Combine($dir,$segments[$i])
                Ensure-SealedDirectory $dir
            }
            $target = [IO.Path]::Combine($dir,$segments[-1])
            $data = $entry.Open()
            $out = Open-SealedNewFile $target
            try { Copy-Or-Hash $data $entry.Length $out } finally { $data.Dispose(); $out.Dispose() }
        }
        Verify-SealedBundle $bundle $layout
        [IO.File]::WriteAllText((Join-Path $bundle 'app\host.mjs'),'B')
        $refused = $false
        try { Verify-SealedBundle $bundle $layout } catch { if ($_.Exception.Message -cne 'bundle_content') { throw }; $refused = $true }
        if (-not $refused) { throw 'changed bundle content passed' }
        Write-Output 'PASS native create-time ACL and matching bytes; changed bytes rejected'
        $hostFile = Join-Path $bundle 'app\host.mjs'
        [IO.File]::WriteAllText($hostFile,'A')
        $altered = [IO.File]::GetAccessControl($hostFile)
        $altered.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new('S-1-5-11'),'Read','Allow'))
        try {
            [IO.File]::SetAccessControl($hostFile,$altered)
            $refused = $false
            try { Verify-SealedBundle $bundle $layout } catch { if ($_.Exception.Message -cne 'sealed_acl') { throw }; $refused = $true }
            if (-not $refused) { throw 'changed ACL passed' }
        } finally { [IO.File]::SetAccessControl($hostFile,(New-SealedAcl $false)) }
        Write-Output 'PASS additional native ACL entry rejected'
        $extra = Join-Path $bundle 'app\extra.mjs'
        $out = Open-SealedNewFile $extra
        $out.Dispose()
        $refused = $false
        try { Verify-SealedBundle $bundle $layout } catch { if ($_.Exception.Message -cne 'bundle_closure') { throw }; $refused = $true }
        if (-not $refused) { throw 'extra file passed' }
        Write-Output 'PASS unlisted file rejected even with exact ACL'
    } finally { $zip.Dispose(); $sha.Dispose() }

    $state = Join-Path $scratch 'private.state'
    $layout = Get-AdministratorStateLayout ('1' * 64) $fixtureSid
    Write-AdministratorState $state $layout
    Assert-FreshAdministratorState $state $layout
    $refused = $false
    try { Write-AdministratorState $state $layout } catch { if ($_.Exception.Message -cne 'state_exists') { throw }; $refused = $true }
    if (-not $refused) { throw 'state unexpectedly replaced' }
    $refused = $false
    try { Assert-FreshAdministratorState $state (Get-AdministratorStateLayout ('2' * 64) $fixtureSid) }
    catch { if ($_.Exception.Message -cne 'state_content') { throw }; $refused = $true }
    if (-not $refused) { throw 'wrong bundle accepted' }
    $readState = Join-Path ([IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($stager))) 'native\desktop-commander\runtime.mjs'
    & $node --input-type=module -e "import {pathToFileURL} from 'node:url'; (await import(pathToFileURL(process.argv[1]))).readState(process.argv[2])" $readState $state
    if ($LASTEXITCODE -ne 0) { throw 'private state incompatible with runtime' }
    $pause = [IO.File]::ReadAllText((Join-Path $state 'lifecycle.json')) | ConvertFrom-Json
    if ($pause.paused -ne $true) { throw 'initial pause missing' }
    Write-Output 'PASS private initial state is compatible, paused, immutable to duplicate preparation, and digest-bound'
    $generated = Join-Path $state 'work\fixture-output.txt'
    [IO.File]::WriteAllText($generated,'fixture')
    try {
        $acl = [IO.File]::GetAccessControl($generated)
        $rules = @($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
        $owners = @($rules | Where-Object { $_.IdentityReference.Value -ceq 'S-1-3-4' })
        if ($owners.Count -ne 1 -or -not $owners[0].IsInherited -or
            ($owners[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::ChangePermissions) -or
            @($rules | Where-Object { $_.IdentityReference.Value -ceq $usersSid }).Count -ne 0) {
            throw 'private state child inherits unsafe rights'
        }
    } finally { [IO.File]::Delete($generated) }
    Assert-FreshAdministratorState $state $layout
    Write-Output 'PASS generated state file inherits owner-rights fence without Users access'

    $bound = Join-Path $scratch 'isolated-admin-fixture'
    $boundState = $bound + '.state'
    $client = Join-Path $bound 'client\tunnel-client-runtime.exe'
    Ensure-SealedDirectory $bound
    Ensure-SealedDirectory ([IO.Path]::GetDirectoryName($client))
    $inert = Open-SealedNewFile $client
    $inert.Dispose()
    $boundLayout = Get-AdministratorStateLayout ('1' * 64) $fixtureSid
    Write-AdministratorState $boundState $boundLayout
    $invalidKey = ConvertTo-SecureString 'synthetic-invalid-format-never-valid' -AsPlainText -Force
    try {
        try {
            Write-AdministratorHostedBinding $bound $boundState ('1' * 64) $fixtureSid $fixtureTunnel $invalidKey
            throw 'malformed key accepted'
        } catch { if ($_.Exception.Message -cne 'binding_key_format') { throw } }
        if ([IO.Directory]::Exists($bound + '.secrets')) { throw 'bad_key_created_vault' }
    } finally { $invalidKey.Dispose() }
    $dummy = 'sk-agentcontinue-synthetic-never-valid'
    $secret = ConvertTo-SecureString $dummy -AsPlainText -Force
    try {
        Write-AdministratorHostedBinding $bound $boundState ('1' * 64) $fixtureSid $fixtureTunnel $secret
        $vault = $bound + '.secrets'
        $keyFile = Join-Path $vault 'runtime.key'
        $profileFile = Join-Path $vault 'tunnel.yaml'
        $bindingFile = Join-Path $vault 'binding.json'
        Assert-SealedAcl $vault $true $true
        foreach ($file in @($keyFile,$profileFile,$bindingFile)) { Assert-SealedAcl $file $false $true }
        $profile = [IO.File]::ReadAllText($profileFile) | ConvertFrom-Json
        $receipt = [IO.File]::ReadAllText($bindingFile) | ConvertFrom-Json
        if ([IO.File]::ReadAllText($keyFile) -cne $dummy -or $profile.control_plane.api_key -cne ('file:' + $keyFile) -or
            $profile.control_plane.base_url -cne 'https://api.openai.com' -or
            $receipt.profileSha256 -cne (Get-FileHash -LiteralPath $profileFile).Hash.ToLowerInvariant() -or
            $receipt.activationAuthorized -ne $false -or [IO.File]::ReadAllText($profileFile).Contains($dummy) -or
            [IO.File]::ReadAllText($bindingFile).Contains($dummy)) { throw 'binding_fixture_invalid' }
        try {
            Write-AdministratorHostedBinding $bound $boundState ('1' * 64) $fixtureSid $fixtureTunnel $secret
            throw 'binding replaced'
        } catch { if ($_.Exception.Message -cne 'binding_exists') { throw } }
        Assert-FreshAdministratorState $boundState $boundLayout
        Write-Output 'PASS protected create-only hosted binding stores the key only in its dedicated file and leaves state paused'
        $planned = New-AdministratorHostedLaunchPlan $bound $boundState ('1' * 64) $fixtureSid $fixtureTunnel
        if ($planned.FileName -cne $client -or $planned.Arguments -cne ('run --profile-file "' + $profileFile + '"') -or
            $planned.WorkingDirectory -cne (Join-Path $boundState 'work') -or
            $planned.UseShellExecute -or -not $planned.CreateNoWindow -or $planned.EnvironmentVariables['CONTROL_PLANE_API_KEY']) {
            throw 'unexpected_hosted_launch_plan'
        }
        try {
            $null = New-AdministratorHostedLaunchPlan $bound $boundState ('1' * 64) $fixtureSid ('tunnel_' + ('a' * 32))
            throw 'mismatched_tunnel_accepted'
        } catch { if ($_.Exception.Message -cne 'binding_readback') { throw } }
        Write-Output 'PASS launch plan binds the exact official client and profile without exporting credentials'
        $profileBytes = [IO.File]::ReadAllBytes($profileFile)
        $receiptBytes = [IO.File]::ReadAllBytes($bindingFile)
        [IO.File]::WriteAllText($profileFile,'mutated')
        try {
            Assert-AdministratorHostedVault $vault $profileBytes $receiptBytes
            throw 'mutated profile accepted'
        } catch { if ($_.Exception.Message -cne 'binding_readback') { throw } }
        [IO.File]::WriteAllBytes($profileFile,$profileBytes)
        $unexpected = Open-SealedNewFile (Join-Path $vault 'unexpected.txt') $true
        $unexpected.Dispose()
        try {
            Assert-AdministratorHostedVault $vault $profileBytes $receiptBytes
            throw 'extra vault entry accepted'
        } catch { if ($_.Exception.Message -cne 'binding_closure') { throw } }
        Write-Output 'PASS vault readback rejects changed profile bytes and unlisted entries without reading key bytes'
        [IO.File]::Delete((Join-Path $vault 'unexpected.txt'))
        try {
            Write-AdministratorOwnerActivation $bound $boundState ('1' * 64) $fixtureSid $fixtureTunnel
            throw 'proof_only_bundle_promoted'
        } catch { if ($_.Exception.GetBaseException() -isnot [IO.FileNotFoundException] -and
            $_.Exception.GetBaseException() -isnot [IO.DirectoryNotFoundException]) { throw } }
        Ensure-SealedDirectory (Join-Path $bound 'app')
        $entry = Open-SealedNewFile (Join-Path $bound 'app\windows-admin-owner.mjs')
        $entry.Dispose()
        try {
            Write-AdministratorOwnerActivation $bound $boundState ('1' * 64) $fixtureSid $fixtureTunnel
            throw 'unmanaged_owner_bundle_authorized'
        } catch { if ($_.Exception.GetBaseException() -isnot [IO.FileNotFoundException]) { throw } }
        $entry = Open-SealedNewFile (Join-Path $bound 'app\windows-owner-job.cs')
        $entry.Dispose()
        Write-AdministratorOwnerActivation $bound $boundState ('1' * 64) $fixtureSid $fixtureTunnel
        $activationFile = Join-Path $vault 'owner-activation.json'
        $ownerProfileFile = Join-Path $vault 'owner-tunnel.yaml'
        Assert-SealedAcl $ownerProfileFile $false $true
        $ownerProfile = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($ownerProfileFile))
        $ownerPlan = New-AdministratorLaunchPlan $bound $boundState -OwnerEntry
        if (-not $ownerProfile.mcp.commands[0].command.EndsWith(' --administrator-owner') -or
            $profile.mcp.commands[0].command.EndsWith(' --administrator-owner') -or
            -not $ownerPlan.Arguments.EndsWith('windows-admin-owner.mjs"') -or
            $ownerPlan.Arguments.Contains('--state-dir') -or -not $ownerPlan.CreateNoWindow -or $ownerPlan.UseShellExecute) {
            throw 'owner_launch_not_separate'
        }
        Assert-SealedAcl $activationFile $false $true
        $grant = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($activationFile))
        if ($grant.format -cne 'agent-continue-windows-admin-activation' -or $grant.version -ne 1 -or
            $grant.scope -cne 'full-account' -or $grant.userSid -cne $fixtureSid -or
            $grant.bundleSha256 -cne ('1' * 64) -or $grant.profileSha256 -ceq $receipt.profileSha256 -or
            $grant.profileSha256 -cne (Get-FileHash -LiteralPath $ownerProfileFile).Hash.ToLowerInvariant()) {
            throw 'owner_activation_invalid'
        }
        Assert-FreshAdministratorState $boundState $boundLayout
        Assert-AdministratorOwnerWake $bound $boundState ('1' * 64) $fixtureSid $fixtureTunnel
        if (Test-AdministratorOwnerRunIntent $boundState $vault) { throw 'fresh owner woke from paused intent' }
        $gate = Open-AdministratorOwnerControl $vault
        try {
            $firstRevision = Read-AdministratorOwnerControlRevision $gate
            try {
                $unexpected = Open-AdministratorOwnerControl $vault
                $unexpected.Dispose()
                throw 'owner_intent_gate_not_exclusive'
            } catch { if ($_.Exception.Message -cne 'owner_control_busy') { throw } }
            Write-AdministratorOwnerIntent $boundState $false
        } finally { $gate.Dispose() }
        if (-not (Test-AdministratorOwnerRunIntent $boundState $vault)) { throw 'explicit_running_intent_not_published' }
        $controlLease = Open-SealedNewFile (Join-Path $boundState 'device-operations.lease') $true
        $controlLease.Dispose()
        $reader = [IO.File]::Open((Join-Path $boundState 'lifecycle.json'),'Open','Read',
            ([IO.FileShare]::Read -bor [IO.FileShare]::Delete))
        try { Request-AdministratorOwnerPause $bound ('1' * 64) $fixtureSid }
        finally { $reader.Dispose() }
        if ((Test-AdministratorOwnerRunIntent $boundState $vault) -or
            -not [IO.File]::Exists((Join-Path $boundState 'device-operations.lease'))) { throw 'pause_did_not_preserve_lease' }
        Request-AdministratorOwnerPause $bound ('1' * 64) $fixtureSid
        $gate = Open-AdministratorOwnerControl $vault
        try {
            $newRevision = Read-AdministratorOwnerControlRevision $gate
            if ($newRevision -ceq $firstRevision) { throw 'pause_did_not_invalidate_old_connect' }
        } finally { $gate.Dispose() }
        [IO.File]::Delete((Join-Path $boundState 'device-operations.lease'))
        $checkPlan = [Diagnostics.ProcessStartInfo]::new($node,'-e "process.stdout.write(String.fromCharCode(99,111,110,110,101,99,116,45,101,108,105,103,105,98,108,101,10))"')
        $checkPlan.UseShellExecute = $false
        $checkPlan.CreateNoWindow = $true
        $task = [pscustomobject]@{Calls=0; LoseResponse=$false; LockReleased=$false; Vault=$vault}
        $task | Add-Member -MemberType ScriptMethod -Name Run -Value {
            param($request)
            $this.Calls++
            $available = [IO.File]::Open([IO.Path]::Combine($this.Vault,'owner-control.guard'),'Open','ReadWrite','None')
            $available.Dispose()
            $this.LockReleased = $true
            if ($null -ne $request -or $this.LoseResponse) { throw 'fixture_no_scheduler_ack' }
            return [pscustomobject]@{State='requested'}
        }
        try {
            $null = Request-AdministratorOwnerConnect $task $checkPlan $boundState $vault $firstRevision
            throw 'stale_connect_overrode_pause'
        } catch { if ($_.Exception.Message -cne 'owner_connect_superseded') { throw } }
        if ($task.Calls -ne 0 -or (Test-AdministratorOwnerRunIntent $boundState $vault)) { throw 'stale_connect_side_effect' }
        $task.LoseResponse = $true
        $result = Request-AdministratorOwnerConnect $task $checkPlan $boundState $vault $newRevision
        if ($result.ok -or -not $result.runningIntentSaved -or $result.launchRequest -cne 'unconfirmed' -or
            $result.tunnelReady -cne 'unobserved' -or $task.Calls -ne 1 -or -not $task.LockReleased -or
            -not (Test-AdministratorOwnerRunIntent $boundState $vault)) { throw 'unknown_scheduler_outcome_replayed_or_misreported' }
        try {
            $null = Request-AdministratorOwnerConnect $task $checkPlan $boundState $vault $newRevision
            throw 'connect_revision_reused'
        } catch { if ($_.Exception.Message -cne 'owner_connect_superseded') { throw } }
        $gate = Open-AdministratorOwnerControl $vault
        try { $usedRevision = Read-AdministratorOwnerControlRevision $gate } finally { $gate.Dispose() }
        try {
            $null = Request-AdministratorOwnerConnect $task $checkPlan $boundState $vault $usedRevision
            throw 'duplicate_connect_replayed'
        } catch { if ($_.Exception.Message -cne 'owner_connect_not_paused') { throw } }
        if ($task.Calls -ne 1) { throw 'duplicate_scheduler_request' }
        Request-AdministratorOwnerPause $bound ('1' * 64) $fixtureSid
        Assert-FreshAdministratorState $boundState $boundLayout
        Write-Output 'PASS protected pause tolerates a live reader and supersedes stale Connect; Scheduler holds no lock and a lost reply is not replayed'
        try {
            Write-AdministratorOwnerActivation $bound $boundState ('1' * 64) $fixtureSid $fixtureTunnel
            throw 'owner_activation_replaced'
        } catch { if ($_.Exception.Message -cne 'binding_closure') { throw } }
        Write-Output 'PASS separate owner grant is create-only, bound to a product bundle and leaves intent paused'
        $lease = Open-SealedNewFile (Join-Path $boundState 'controller.lease') $true
        $lease.Dispose()
        try {
            Request-AdministratorOwnerRevocation $bound ('1' * 64) 'S-1-5-21-1-2-3-1002'
            throw 'owner_revocation_wrong_sid'
        } catch { if ($_.Exception.Message -cne 'owner_revocation_identity') { throw } }
        Request-AdministratorOwnerRevocation $bound ('1' * 64) $fixtureSid
        Request-AdministratorOwnerRevocation $bound ('1' * 64) $fixtureSid
        $revocation = Join-Path $vault 'owner-revoked'
        Assert-SealedAcl $revocation $false $true
        if ([IO.FileInfo]::new($revocation).Length -ne 0 -or
            -not [IO.File]::Exists($activationFile) -or -not [IO.File]::Exists((Join-Path $boundState 'controller.lease'))) {
            throw 'owner_revocation_changed_runtime'
        }
        Write-Output 'PASS revoke records one sealed deny signal even with a live lease without claiming shutdown'
    } finally { $secret.Dispose() }

    $jobTest = Join-Path $scratch 'job-supervisor'
    $jobVault = $jobTest + '.secrets'
    Write-AdministratorState $jobTest (Get-AdministratorStateLayout ('7' * 64) $fixtureSid)
    Ensure-SealedDirectory $jobVault $true
    $jobZipPath = Join-Path $scratch 'job-helper-fixture.zip'
    $jobZipFile = [IO.File]::Open($jobZipPath,'CreateNew','ReadWrite','None')
    $jobZip = [IO.Compression.ZipArchive]::new($jobZipFile,[IO.Compression.ZipArchiveMode]::Create,$true)
    try {
        $entry = $jobZip.CreateEntry('app/windows-owner-job.cs').Open()
        try {
            $source = [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot '../native/desktop-commander/windows-owner-job.cs'))
            $entry.Write($source,0,$source.Length)
        } finally { $entry.Dispose() }
    } finally { $jobZip.Dispose() }
    try {
        $jobZipFile.Position = 0
        $jobZip = [IO.Compression.ZipArchive]::new($jobZipFile,[IO.Compression.ZipArchiveMode]::Read,$true)
        try { $jobType = Get-AdministratorOwnerJobType $jobZip (Join-Path $jobTest 'temp') }
        finally { $jobZip.Dispose() }
    } finally { $jobZipFile.Dispose() }
    $jobPlan = [Diagnostics.ProcessStartInfo]::new($node,'-e "process.exit(0)"')
    $jobPlan.UseShellExecute = $false
    $jobPlan.CreateNoWindow = $true
    $jobPlan.WorkingDirectory = Join-Path $jobTest 'work'
    $jobPlan.EnvironmentVariables.Clear()
    $jobPlan.EnvironmentVariables['SystemRoot'] = $env:SystemRoot
    $denied = Invoke-AdministratorOwnerJob $jobType $jobPlan $jobTest $jobVault ('7' * 64) $fixtureSid
    $jobLease = Join-Path $jobVault 'owner-job.lease'
    if ($denied.rootCreationAttempted -or $denied.outcome -cne 'wake-denied-by-local-intent' -or [IO.File]::Exists($jobLease)) {
        throw 'paused job start was not rejected cleanly'
    }
    $intent = Join-Path $jobTest 'lifecycle.json'
    [IO.File]::WriteAllText($intent,('{"format":"agent-continue-lifecycle","version":1,"paused":false}' + [char]10))
    if (-not (Test-AdministratorOwnerRunIntent $jobTest $jobVault)) { throw 'valid running intent rejected' }
    $occupied = Open-SealedNewFile $jobLease $true
    try {
        try {
            $null = Invoke-AdministratorOwnerJob $jobType $jobPlan $jobTest $jobVault ('7' * 64) $fixtureSid
            throw 'duplicate owner launch accepted'
        } catch { if ($_.Exception.GetBaseException() -isnot [IO.IOException]) { throw } }
    } finally { $occupied.Dispose() }
    [IO.File]::Delete($jobLease)
    $result = Invoke-AdministratorOwnerJob $jobType $jobPlan $jobTest $jobVault ('7' * 64) $fixtureSid
    $receiptFile = Join-Path $jobVault ('owner-job-' + $result.generation + '.terminal.json')
    Assert-SealedAcl $receiptFile $false $true
    if (-not $result.jobDrained -or -not $result.rootExitObserved -or $result.rootExitCode -ne 0 -or
        $result.tunnelReady -cne 'unobserved' -or [IO.File]::Exists($jobLease)) { throw 'job confirmation mismatch' }
    & {
        function Write-AdministratorOwnerFile { throw 'fixture_receipt_write_failed' }
        try {
            $null = Invoke-AdministratorOwnerJob $jobType $jobPlan $jobTest $jobVault ('7' * 64) $fixtureSid
            throw 'terminal write failure hidden'
        } catch { if ($_.Exception.Message -cne 'fixture_receipt_write_failed') { throw } }
    }
    if (-not [IO.File]::Exists($jobLease)) { throw 'failed terminal write released the job fence' }
    [IO.File]::Delete($jobLease)
    $inner = Open-SealedNewFile (Join-Path $jobTest 'device-operations.lease') $true
    $inner.Dispose()
    $unresolved = Invoke-AdministratorOwnerJob $jobType $jobPlan $jobTest $jobVault ('7' * 64) $fixtureSid
    if ($unresolved.rootCreationAttempted -or -not $unresolved.jobDrained -or $unresolved.innerLeasesClear -or
        -not [IO.File]::Exists($jobLease)) {
        throw 'unresolved operation permitted a later wake'
    }
    Write-Output 'PASS fixed owner supervisor compiles verified bytes, honors pause, and fences duplicate and unconfirmed launches'

    $pauseBundle = Join-Path $scratch 'pause-job'
    $pauseState = $pauseBundle + '.state'
    $pauseVault = $pauseBundle + '.secrets'
    $pauseStatus = $pauseBundle + '.status'
    $pauseDigest = '6' * 64
    Ensure-SealedDirectory $pauseBundle
    Ensure-SealedDirectory (Join-Path $pauseBundle 'app')
    (Open-SealedNewFile (Join-Path $pauseBundle 'app\windows-admin-owner.mjs')).Dispose()
    Write-AdministratorState $pauseState (Get-AdministratorStateLayout $pauseDigest $fixtureSid)
    Ensure-SealedDirectory $pauseVault $true
    $guardPath = Join-Path $pauseVault 'owner-control.guard'
    Write-AdministratorOwnerFile $guardPath ([Text.Encoding]::ASCII.GetBytes(('1' * 32) + [char]10))
    Write-AdministratorOwnerIntent $pauseState $false

    $idleId = '2' * 32
    Assert-PauseResult (Request-AdministratorOwnerPause $pauseBundle $pauseDigest $fixtureSid $idleId) $idleId 'stopped'
    Assert-PauseResult (Read-AdministratorOwnerPause $pauseStatus $pauseDigest $fixtureSid $idleId) $idleId 'stopped'
    if (-not (Test-AdministratorOwnerIntent $pauseState $true)) { throw 'idle Pause did not persist paused intent' }
    $idleReservation = Join-Path $pauseVault "pause-$idleId.reserved.json"
    $idleRecorded = Join-Path $pauseStatus "pause-$idleId.pause-recorded.json"
    $idleStopped = Join-Path $pauseStatus "pause-$idleId.stopped.json"
    $laterRevision = '3' * 32
    $gate = Open-AdministratorOwnerControl $pauseVault
    try {
        Write-AdministratorOwnerControlRevision $gate $laterRevision
        Write-AdministratorOwnerIntent $pauseState $false
    } finally { $gate.Dispose() }
    # Read-only sharing lets the duplicate read the historical receipts but forbids replacing them.
    $receiptReaders = @()
    try {
        foreach ($path in @($idleReservation,$idleRecorded,$idleStopped)) {
            $receiptReaders += [IO.File]::Open($path,'Open','Read','Read')
        }
        Assert-PauseResult (Request-AdministratorOwnerPause $pauseBundle $pauseDigest $fixtureSid $idleId) $idleId 'stopped'
    } finally { foreach ($handle in $receiptReaders) { $handle.Dispose() } }
    if (-not (Test-AdministratorOwnerRunIntent $pauseState $pauseVault) -or
        [IO.File]::ReadAllText($guardPath) -cne ($laterRevision + [char]10)) { throw 'old Pause replaced newer authority' }
    Assert-PauseResult (Read-AdministratorOwnerPause $pauseStatus ('9' * 64) $fixtureSid $idleId) $idleId 'unconfirmed'
    $malformed = [IO.File]::ReadAllText($idleStopped)
    [IO.File]::WriteAllText($idleStopped,('!' + $malformed.Substring(1)))
    Assert-PauseResult (Read-AdministratorOwnerPause $pauseStatus $pauseDigest $fixtureSid $idleId) $idleId 'unconfirmed'
    Write-Output 'PASS idle Pause is durable; replay preserves newer authority and readback rejects foreign or malformed receipts'

    $reservedId = '4' * 32
    & {
        function Write-AdministratorOwnerControlRevision { throw 'fixture_interrupted_after_reservation' }
        try {
            $null = Request-AdministratorOwnerPause $pauseBundle $pauseDigest $fixtureSid $reservedId
            throw 'fixture interruption did not run'
        } catch { if ($_.Exception.Message -cne 'fixture_interrupted_after_reservation') { throw } }
    }
    Assert-AdministratorOwnerBytes (Join-Path $pauseVault "pause-$reservedId.reserved.json") (
        Get-AdministratorPauseReservationBytes $pauseDigest $reservedId 'idle')
    Assert-PauseResult (Read-AdministratorOwnerPause $pauseStatus $pauseDigest $fixtureSid $reservedId) $reservedId 'unconfirmed'
    Assert-PauseResult (Request-AdministratorOwnerPause $pauseBundle $pauseDigest $fixtureSid $reservedId) $reservedId 'unconfirmed'
    if (-not (Test-AdministratorOwnerRunIntent $pauseState $pauseVault) -or
        [IO.File]::ReadAllText($guardPath) -cne ($laterRevision + [char]10) -or
        -not (Test-AdministratorOwnerAbsent (Join-Path $pauseStatus "pause-$reservedId.pause-recorded.json")) -or
        -not (Test-AdministratorOwnerAbsent (Join-Path $pauseStatus "pause-$reservedId.stopped.json"))) {
        throw 'reservation-only Pause was replayed'
    }
    Write-Output 'PASS an interrupted Pause reservation consumes the ID without confirming or replaying intent'

    $bridge = $pauseBundle + '.browser'
    Ensure-SealedDirectory $bridge $false $fixtureSid
    Write-AdministratorBrowserAsset (Join-Path $bridge 'pause-launch.json') ([byte[]]@(1)) $fixtureSid
    $held = Open-AdministratorOwnerControl $pauseVault
    try { Update-AdministratorBrowserPauseTarget $pauseState $pauseVault $pauseDigest $fixtureSid $held }
    finally { $held.Dispose() }
    $idleTarget = Read-AdministratorBrowserPauseTargetProjection $pauseBundle $pauseDigest $fixtureSid
    if ($idleTarget -cne ($laterRevision + ':idle')) { throw 'idle target projection was not verified' }
    $verifyBinding = {
        try { $opened = [IO.File]::Open($guardPath,'Open','Read','Read') }
        catch [IO.IOException] { return }
        $opened.Dispose()
        throw 'binding check was not serialized by the owner control guard'
    }
    $staleRevisionId = '7' * 32
    $staleTarget = ('f' * 32) + ':idle'
    $projectionPath = Join-Path $pauseStatus 'pause-target.json'
    $priorProjection = [IO.File]::ReadAllText($projectionPath)
    [IO.File]::WriteAllText($projectionPath,$priorProjection.Replace($idleTarget,$staleTarget))
    Assert-PauseResult (Request-AdministratorOwnerPause $pauseBundle $pauseDigest $fixtureSid $staleRevisionId $staleTarget $verifyBinding) $staleRevisionId 'superseded'
    if ((Read-AdministratorBrowserPauseTargetProjection $pauseBundle $pauseDigest $fixtureSid) -cne $idleTarget) {
        throw 'stale rejection did not repair the projected target'
    }
    $unknownId = '8' * 32
    $partialId = '0' * 32
    (Open-SealedNewFile (Join-Path $pauseVault "pause-$partialId.reserved.json") $true).Dispose()
    $interruptedId = '1' * 32
    & {
        function Write-AdministratorOwnerFile([string]$Path,[byte[]]$Bytes) {
            if ([IO.Path]::GetFileName($Path) -notmatch '^pause-reserve-') { throw 'partial reservation attempted a final write' }
            (Open-SealedNewFile $Path $true).Dispose()
            throw 'interrupted temporary reservation'
        }
        try {
            $null = Request-AdministratorOwnerPause $pauseBundle $pauseDigest $fixtureSid $interruptedId $idleTarget $verifyBinding
            throw 'simulated reservation write succeeded'
        } catch { if ($_.Exception.Message -cne 'interrupted temporary reservation') { throw } }
    }
    if (-not (Test-AdministratorOwnerAbsent (Join-Path $pauseVault "pause-$interruptedId.reserved.json"))) {
        throw 'partial reservation became authoritative'
    }
    foreach ($id in @($unknownId,$reservedId,$partialId,$interruptedId)) {
        Assert-PauseResult (Fence-AdministratorOwnerPause $pauseBundle $pauseDigest $fixtureSid $id $verifyBinding) $id 'fenced'
        Assert-PauseResult (Fence-AdministratorOwnerPause $pauseBundle $pauseDigest $fixtureSid $id $verifyBinding) $id 'fenced'
        Assert-PauseResult (Request-AdministratorOwnerPause $pauseBundle $pauseDigest $fixtureSid $id $idleTarget $verifyBinding) $id 'fenced'
    }
    $notBound = '9' * 32
    try {
        $null = Fence-AdministratorOwnerPause $pauseBundle $pauseDigest $fixtureSid $notBound { throw 'removed_browser_binding' }
        throw 'invalid registration was accepted'
    } catch { if ($_.Exception.Message -cne 'removed_browser_binding') { throw } }
    if (-not (Test-AdministratorOwnerAbsent (Join-Path $pauseVault "pause-$notBound.reserved.json")) -or
        -not (Test-AdministratorOwnerRunIntent $pauseState $pauseVault) -or
        [IO.File]::ReadAllText($guardPath) -cne ($laterRevision + [char]10)) { throw 'stale or fenced request changed running intent' }
    Write-Output 'PASS expired revision and fenced unknown or interrupted requests never mutate intent or admit delayed approval'

    [IO.File]::Delete($projectionPath)
    if ((Repair-AdministratorBrowserPauseTarget $pauseBundle $pauseDigest $fixtureSid $verifyBinding) -cne $idleTarget -or
        (Read-AdministratorBrowserPauseTargetProjection $pauseBundle $pauseDigest $fixtureSid) -cne $idleTarget -or
        -not (Test-AdministratorOwnerRunIntent $pauseState $pauseVault)) { throw 'local repair changed intent or failed to restore the target' }
    Write-Output 'PASS guarded local projection repair restores missing readback without changing intent'

    $pauseWork = Join-Path $pauseState 'work'
    $pauseFixture = Join-Path $PSScriptRoot 'windows-owner-job-fixture.cjs'
    $pausePlan = [Diagnostics.ProcessStartInfo]::new($node,('"{0}" "{1}" root' -f $pauseFixture,$pauseWork))
    $pausePlan.UseShellExecute = $false
    $pausePlan.CreateNoWindow = $true
    $pausePlan.WorkingDirectory = $pauseWork
    $pausePlan.EnvironmentVariables.Clear()
    $pausePlan.EnvironmentVariables['SystemRoot'] = $env:SystemRoot
    $pausePlan.EnvironmentVariables['AC_OWNER_JOB_FIXTURE'] = 'exact value'
    $fixtureExit = Join-Path $pauseWork 'exit-root'
    $ownerLease = Join-Path $pauseVault 'owner-job.lease'
    $activeId = '5' * 32
    $worker = [PowerShell]::Create()
    $pendingJob = $null
    $members = @()
    try {
        $null = $worker.AddScript({
            param($functions,$jobType,$plan,$root,$vault,$digest,$sid,$status,$administratorsSid,$systemSid,$usersSid)
            $ErrorActionPreference = 'Stop'
            . ([scriptblock]::Create($functions))
            Invoke-AdministratorOwnerJob $jobType $plan $root $vault $digest $sid $status -SerializeControl
        }.ToString()).AddArgument(($definitions.Extent.Text -join [char]10)).AddArgument($jobType).AddArgument($pausePlan).
            AddArgument($pauseState).AddArgument($pauseVault).AddArgument($pauseDigest).AddArgument($fixtureSid).
            AddArgument($pauseStatus).AddArgument($administratorsSid).AddArgument($systemSid).AddArgument($usersSid)
        $pendingJob = $worker.BeginInvoke()
        $watch = [Diagnostics.Stopwatch]::StartNew()
        foreach ($role in @('root','child','grandchild')) {
            $pidFile = Join-Path $pauseWork ($role + '.pid')
            do {
                if ($pendingJob.IsCompleted) {
                    $early = $worker.EndInvoke($pendingJob)
                    throw "Job ended before $($role): $(ConvertTo-Json -InputObject $early -Compress)"
                }
                $memberId = if ([IO.File]::Exists($pidFile)) { [IO.File]::ReadAllText($pidFile) } else { '' }
                if ($memberId -cmatch '\A[1-9][0-9]{0,8}\z') { break }
                Start-Sleep -Milliseconds 25
            } while ($watch.ElapsedMilliseconds -lt 10000)
            if ($memberId -cnotmatch '\A[1-9][0-9]{0,8}\z') { throw "Missing live Job fixture: $role" }
            $member = [Diagnostics.Process]::GetProcessById([int]$memberId)
            $members += $member
            $null = $member.Handle
        }
        $liveLease = Read-AdministratorOwnerObservationDocument $ownerLease @('version','bundleSha256','userSid','generation')
        $liveTarget = Read-AdministratorBrowserPauseTargetProjection $pauseBundle $pauseDigest $fixtureSid
        $liveRevision = [IO.File]::ReadAllText($guardPath).TrimEnd([char]10)
        if ($liveRevision -ceq $laterRevision -or $liveTarget -cne ($liveRevision + ':' + $liveLease.generation)) {
            throw 'Job did not advance the control revision or project its exact generation'
        }
        $oldGenerationId = 'a' * 32
        Assert-PauseResult (Request-AdministratorOwnerPause $pauseBundle $pauseDigest $fixtureSid $oldGenerationId ($liveRevision + ':idle') $verifyBinding) $oldGenerationId 'superseded'
        if (-not (Test-AdministratorOwnerRunIntent $pauseState $pauseVault) -or $members[0].HasExited) {
            throw 'late browser approval affected the new generation'
        }
        Assert-PauseResult (Request-AdministratorOwnerPause $pauseBundle $pauseDigest $fixtureSid $activeId $liveTarget $verifyBinding) $activeId 'pause-recorded'
        Assert-PauseResult (Fence-AdministratorOwnerPause $pauseBundle $pauseDigest $fixtureSid $activeId $verifyBinding) $activeId 'pause-recorded'
        Assert-PauseResult (Read-AdministratorOwnerPause $pauseStatus $pauseDigest $fixtureSid $activeId) $activeId 'pause-recorded'
        if ($members[0].HasExited -or -not (Test-AdministratorOwnerIntent $pauseState $true) -or
            -not (Test-AdministratorOwnerAbsent (Join-Path $pauseStatus "pause-$activeId.stopped.json"))) {
            throw 'active Pause claimed stopped before drain or did not persist intent'
        }
        Assert-AdministratorOwnerBytes (Join-Path $pauseVault "pause-$activeId.reserved.json") (
            Get-AdministratorPauseReservationBytes $pauseDigest $activeId $liveLease.generation)
        $terminalFile = Join-Path $pauseVault ('owner-job-' + $liveLease.generation + '.terminal.json')
        $held = Open-AdministratorOwnerControl $pauseVault
        try {
            [IO.File]::WriteAllText($fixtureExit,'')
            $watch.Restart()
            while (-not [IO.File]::Exists($terminalFile) -and $watch.ElapsedMilliseconds -lt 4500) {
                Start-Sleep -Milliseconds 25
            }
            if (-not [IO.File]::Exists($terminalFile)) { throw 'Job did not write terminal evidence before lease release' }
            Start-Sleep -Milliseconds 250
            if (-not [IO.File]::Exists($ownerLease)) { throw 'Job deleted its generation lease outside the owner control guard' }
            Assert-PauseResult (Read-AdministratorOwnerPause $pauseStatus $pauseDigest $fixtureSid $activeId) $activeId 'pause-recorded'
        } finally { $held.Dispose() }
        if (-not $pendingJob.AsyncWaitHandle.WaitOne(15000)) { throw 'Pause Job did not settle' }
        $terminal = $worker.EndInvoke($pendingJob)
        if ($terminal.Count -ne 1 -or $terminal[0].generation -cne $liveLease.generation -or
            $terminal[0].bundleSha256 -cne $pauseDigest -or $terminal[0].outcome -cne 'authorization-stopped' -or
            -not $terminal[0].jobDrained -or -not $terminal[0].rootExitObserved -or $terminal[0].rootExitCode -ne 17 -or
            -not $terminal[0].innerLeasesClear -or -not (Test-AdministratorOwnerAbsent $ownerLease)) {
            throw "Wrong terminal evidence for Pause: $(ConvertTo-Json -InputObject $terminal -Compress)"
        }
        Assert-AdministratorOwnerBytes $terminalFile ([Text.Encoding]::UTF8.GetBytes(
            (ConvertTo-Json -InputObject $terminal[0] -Compress) + [char]10))
        foreach ($member in $members) {
            if (-not $member.WaitForExit(1000)) { throw 'a Pause Job member survived the terminal receipt' }
        }
        Assert-PauseResult (Read-AdministratorOwnerPause $pauseStatus $pauseDigest $fixtureSid $activeId) $activeId 'stopped'
        if ((Read-AdministratorBrowserPauseTargetProjection $pauseBundle $pauseDigest $fixtureSid) -cne ($activeId + ':idle')) {
            throw 'drained generation was still projected after settlement'
        }
    } finally {
        if ($pendingJob -and -not $pendingJob.IsCompleted) {
            [IO.File]::WriteAllText($fixtureExit,'')
            if (-not $pendingJob.AsyncWaitHandle.WaitOne(15000)) { $worker.Stop() }
        }
        $worker.Dispose()
        foreach ($member in $members) { $member.Dispose() }
    }
    Write-Output 'PASS active Pause remains recorded until its exact Windows Job generation drains and publishes stopped'

    # A synthetically reserved generation must not borrow the real terminal receipt above.
    $foreignId = '6' * 32
    $foreignGeneration = [Guid]::NewGuid().ToString('N')
    $foreignLease = [ordered]@{version=1;bundleSha256=$pauseDigest;userSid=$fixtureSid;generation=$foreignGeneration}
    Write-AdministratorOwnerFile $ownerLease ([Text.Encoding]::UTF8.GetBytes(
        (ConvertTo-Json -InputObject $foreignLease -Compress) + [char]10))
    Assert-PauseResult (Request-AdministratorOwnerPause $pauseBundle $pauseDigest $fixtureSid $foreignId) $foreignId 'pause-recorded'
    Assert-AdministratorOwnerBytes (Join-Path $pauseVault "pause-$foreignId.reserved.json") (
        Get-AdministratorPauseReservationBytes $pauseDigest $foreignId $foreignGeneration)
    [IO.File]::Delete($ownerLease)
    try { Complete-AdministratorOwnerPause $pauseState $pauseVault $pauseStatus $pauseDigest $fixtureSid $liveLease.generation }
    catch { if ($_.Exception.Message -cne 'owner_metadata_readback') { throw } }
    Assert-PauseResult (Read-AdministratorOwnerPause $pauseStatus $pauseDigest $fixtureSid $foreignId) $foreignId 'pause-recorded'
    Write-Output 'PASS a different broker generation cannot publish a terminal Pause receipt'

    $statusState = Join-Path $scratch 'observed-job'
    $statusVault = $statusState + '.secrets'
    $statusDir = $statusState + '.status'
    $statusWitness = Join-Path $scratch 'status-witness'
    $statusDigest = '8' * 64
    Write-AdministratorState $statusState (Get-AdministratorStateLayout $statusDigest $fixtureSid)
    Ensure-SealedDirectory $statusVault $true
    $running = '{"format":"agent-continue-lifecycle","version":1,"paused":false}' + [char]10
    [IO.File]::WriteAllText((Join-Path $statusState 'lifecycle.json'),$running)
    $jobPlan.WorkingDirectory = Join-Path $statusState 'work'
    $statusScript = Join-Path $PSScriptRoot 'windows-owner-status-fixture.mjs'
    $jobPlan.Arguments = '"{0}" "{1}" "{2}" "{3}"' -f $statusScript,$statusState,$statusDir,$statusWitness
    $result = Invoke-AdministratorOwnerJob $jobType $jobPlan $statusState $statusVault $statusDigest $fixtureSid $statusDir
    if (-not $result.jobDrained -or $result.rootExitCode -ne 0 -or $result.outcome -cne 'authorization-stopped' -or
        [IO.File]::ReadAllText($statusWitness) -cne $result.generation -or
        (Read-AdministratorOwnerObservation $statusDir $statusDigest $fixtureSid).state -cne 'unobserved') {
        throw 'live owner observation did not follow verified revoke'
    }
    $actualSample = Join-Path $statusVault ('owner-observation-' + $result.generation + '.json')
    $actualFields = @('version','generation','pid','sequence','bootMs','ready')
    $last = Read-AdministratorOwnerObservationDocument $actualSample $actualFields
    if ((Read-AdministratorOwnerSample $actualSample $result.generation $last.pid $last.sequence $last.bootMs) -or
        (Read-AdministratorOwnerSample $actualSample ('a'*32) $last.pid 0 $last.bootMs) -or
        (Read-AdministratorOwnerSample $actualSample $result.generation ($last.pid+1) 0 $last.bootMs) -or
        (Read-AdministratorOwnerSample $actualSample $result.generation $last.pid 0 ($last.bootMs+5000))) {
        throw 'private readback accepted replay, wrong generation/PID, or expired sample'
    }
    Write-Output 'PASS live Job observation follows fresh Node samples, rejects replays, and becomes unobserved on revoke'

    $recoveryDigest = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
    $recoveryBundle = Join-Path $scratch $recoveryDigest.Substring(0,24)
    $recoveryState = $recoveryBundle + '.state'
    $recoveryVault = $recoveryBundle + '.secrets'
    $recoveryStatus = $recoveryBundle + '.status'
    Ensure-SealedDirectory $recoveryBundle $true
    Write-AdministratorState $recoveryState (Get-AdministratorStateLayout $recoveryDigest $fixtureSid)
    Ensure-SealedDirectory $recoveryVault $true
    $tunnel = 'tunnel_' + ('0' * 32)
    $binding = Get-AdministratorHostedMetadata $recoveryBundle $recoveryState $recoveryDigest $fixtureSid $tunnel
    $grant = Get-AdministratorOwnerMetadata $recoveryBundle $recoveryState $recoveryDigest $fixtureSid $tunnel
    Write-AdministratorOwnerFile (Join-Path $recoveryVault 'tunnel.yaml') $binding.profile
    Write-AdministratorOwnerFile (Join-Path $recoveryVault 'binding.json') $binding.receipt
    Write-AdministratorOwnerFile (Join-Path $recoveryVault 'owner-tunnel.yaml') $grant.profile
    Write-AdministratorOwnerFile (Join-Path $recoveryVault 'owner-activation.json') $grant.grant
    $intent = Join-Path $recoveryState 'lifecycle.json'
    $journal = Join-Path $recoveryState 'device-operations.jsonl'
    $journalBytes = [Text.Encoding]::UTF8.GetBytes((@(
        '{"format":"agent-continue-device-operations","version":1}'
        '{"id":"prior-fixture-op","action":"reconnect","status":"in-progress"}'
        '{"id":"prior-fixture-op","action":"reconnect","status":"settled"}'
        ''
    ) -join [char]10))
    Write-AdministratorOwnerFile $journal $journalBytes
    $recoveryPlan = New-AdministratorLaunchPlan $recoveryBundle $recoveryState
    $recoveryPlan.FileName = $node
    $recoveryScript = Join-Path $PSScriptRoot 'windows-owner-recovery-fixture.mjs'
    $recoveryPlan.Arguments = '"{0}" owner "{1}" "{2}" "{3}" {4}' -f
        $recoveryScript,$recoveryBundle,$recoveryStatus,$fixtureSid,$PID
    $paused = Invoke-AdministratorOwnerJob $jobType $recoveryPlan $recoveryState $recoveryVault $recoveryDigest $fixtureSid
    if ($paused.rootCreationAttempted -or $paused.outcome -cne 'wake-denied-by-local-intent' -or
        -not (Test-AdministratorOwnerAbsent (Join-Path $recoveryVault 'owner-job.lease'))) {
        throw 'recovery fixture did not honor clean pause'
    }
    [IO.File]::WriteAllText($intent,$running)
    $previous = $null
    foreach ($attempt in 1..2) {
        $terminal = Invoke-AdministratorOwnerJob $jobType $recoveryPlan $recoveryState $recoveryVault $recoveryDigest $fixtureSid $recoveryStatus
        $terminalFile = Join-Path $recoveryVault ('owner-job-' + $terminal.generation + '.terminal.json')
        $terminalBytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $terminal -Compress) + [char]10)
        Assert-AdministratorOwnerBytes $terminalFile $terminalBytes
        if ($terminal.bundleSha256 -cne $recoveryDigest -or $terminal.generation -cnotmatch '\A[a-f0-9]{32}\z' -or
            -not $terminal.rootCreationAttempted -or -not $terminal.jobDrained -or -not $terminal.rootExitObserved -or
            $terminal.rootExitCode -ne 0 -or -not $terminal.innerLeasesClear -or $terminal.outcome -cne 'owner-exited' -or
            -not (Test-AdministratorOwnerInnerLeasesClear $recoveryState) -or
            -not (Test-AdministratorOwnerAbsent (Join-Path $recoveryVault 'owner-job.lease')) -or
            -not (Test-AdministratorOwnerAbsent (Join-Path $recoveryVault 'runtime.key')) -or
            [IO.File]::ReadAllText($intent) -cne $running -or
            (Read-AdministratorOwnerObservation $recoveryStatus $recoveryDigest $fixtureSid).state -cne 'unobserved') {
            throw "post-Ready recovery did not settle: $(ConvertTo-Json -InputObject $terminal -Compress)"
        }
        Assert-AdministratorOwnerBytes $journal $journalBytes
        $witnessPath = Join-Path $recoveryState ('work\ready-' + $terminal.generation + '.json')
        $witness = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($witnessPath))
        $lastStatus = Read-AdministratorOwnerObservationDocument (Join-Path $recoveryStatus 'owner-status.json') @(
            'version','bundleSha256','generation','brokerPid','brokerStarted','rootPid','rootStarted','observedTicks','state')
        if ($witness.generation -cne $terminal.generation -or $witness.status -cne 'tunnel-exited' -or
            $lastStatus.generation -cne $terminal.generation -or $lastStatus.state -cne 'unobserved' -or
            $witness.rootPid -ne $lastStatus.rootPid -or $witness.rootStarted -cne [string]$lastStatus.rootStarted -or
            $witness.providerExitVerified -ne $true -or $witness.providerPid -le 0 -or $witness.providerStarted -notmatch '^[0-9]+$' -or
            ($previous -and ($witness.generation -ceq $previous.generation -or
                ($witness.rootPid -eq $previous.rootPid -and $witness.rootStarted -ceq $previous.rootStarted) -or
                ($witness.providerPid -eq $previous.providerPid -and $witness.providerStarted -ceq $previous.providerStarted)))) {
            throw 'post-Ready recovery lacks distinct broker and process evidence'
        }
        $previous = $witness
    }
    Write-Output 'PASS post-Ready recovery: two native Job Ready generations, exit-0 receipts, leases cleared, no journal replay; pause denied'

    $readPlan = [Diagnostics.ProcessStartInfo]::new($node,'-e "setTimeout(()=>{},8000)"')
    $readPlan.UseShellExecute = $false
    $readPlan.CreateNoWindow = $true
    $child = [Diagnostics.Process]::Start($readPlan)
    $broker = [Diagnostics.Process]::GetCurrentProcess()
    try {
        $view = [ordered]@{version=1;bundleSha256=$statusDigest;generation=$result.generation;
            brokerPid=$broker.Id;brokerStarted=$broker.StartTime.ToUniversalTime().Ticks;
            rootPid=$child.Id;rootStarted=$child.StartTime.ToUniversalTime().Ticks;
            observedTicks=[Diagnostics.Stopwatch]::GetTimestamp();state='ready'}
        Publish-AdministratorOwnerObservation $statusDir $fixtureSid $view
        $live = Read-AdministratorOwnerObservation $statusDir $statusDigest $fixtureSid
        if ($live.state -cne 'ready' -or $live.generation -cne $result.generation -or
            (Read-AdministratorOwnerObservation $statusDir ('9'*64) $fixtureSid).state -cne 'unobserved') {
            throw 'sanitized observation is not bound to the bundle'
        }
        $view.observedTicks -= [long](3*[Diagnostics.Stopwatch]::Frequency)
        Publish-AdministratorOwnerObservation $statusDir $fixtureSid $view
        if ((Read-AdministratorOwnerObservation $statusDir $statusDigest $fixtureSid).state -cne 'unobserved') {
            throw 'expired public observation accepted'
        }
        $view.observedTicks = [Diagnostics.Stopwatch]::GetTimestamp()
        $view.rootStarted += [long]100
        Publish-AdministratorOwnerObservation $statusDir $fixtureSid $view
        if ((Read-AdministratorOwnerObservation $statusDir $statusDigest $fixtureSid).state -cne 'unobserved') {
            throw 'wrong root creation time accepted'
        }
    } finally {
        if (-not $child.HasExited) { $child.Kill(); $null = $child.WaitForExit(3000) }
        $child.Dispose(); $broker.Dispose()
    }
    Write-Output 'PASS sanitized readback checks live process identity and expires monotonically'

    $fixture = Join-Path $scratch 'boot'
    foreach ($dir in @('app','runtime','node_modules/ambient-probe')) {
        $null = [IO.Directory]::CreateDirectory((Join-Path $fixture $dir))
    }
    [IO.File]::Copy($node,(Join-Path $fixture 'runtime\node.exe'),$false)
    [IO.File]::WriteAllText((Join-Path $fixture 'app\inside.mjs'),"export const ok = true;")
    [IO.File]::WriteAllText((Join-Path $fixture 'outside.mjs'),"export const leaked = true;")
    [IO.File]::WriteAllText((Join-Path $fixture 'node_modules\ambient-probe\index.js'),'module.exports = true;')
    $probe = @'
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ok } from './inside.mjs';
assert.equal(ok, true);
assert.equal(process.env.NODE_OPTIONS, undefined);
assert.equal(process.env.HTTPS_PROXY, undefined);
assert.equal(process.env.CONTROL_PLANE_API_KEY, undefined);
assert.equal(process.env.AC_ADMIN_BOOT_APP_ROOT, undefined);
await assert.rejects(import('../outside.mjs'), /administrator_module_outside_bundle/);
assert.throws(() => createRequire(import.meta.url)('ambient-probe'), /administrator_module_outside_bundle/);
console.log('AC_PROTECTED_IMPORTS_PASS');
'@
    [IO.File]::WriteAllText((Join-Path $fixture 'app\host.mjs'),$probe)
    $old = @{}
    foreach ($envKey in @('NODE_OPTIONS','HTTPS_PROXY','CONTROL_PLANE_API_KEY')) {
        $old[$envKey] = [Environment]::GetEnvironmentVariable($envKey,'Process')
        [Environment]::SetEnvironmentVariable($envKey,'synthetic-must-not-inherit','Process')
    }
    try { $plan = New-AdministratorLaunchPlan $fixture $state }
    finally { foreach ($envKey in $old.Keys) { [Environment]::SetEnvironmentVariable($envKey,$old[$envKey],'Process') } }
    $plan.RedirectStandardOutput = $true
    $plan.RedirectStandardError = $true
    $child = [Diagnostics.Process]::Start($plan)
    try {
        $stdout = $child.StandardOutput.ReadToEndAsync()
        $stderr = $child.StandardError.ReadToEndAsync()
        if (-not $child.WaitForExit(15000)) { $child.Kill(); $null = $child.WaitForExit(5000); throw 'boot fixture timeout' }
        if ($child.ExitCode -ne 0 -or $stdout.GetAwaiter().GetResult().Trim() -cne 'AC_PROTECTED_IMPORTS_PASS' -or
            $stderr.GetAwaiter().GetResult()) { throw "boot fixture failed: $($stderr.GetAwaiter().GetResult())" }
    } finally { $child.Dispose() }
    Write-Output 'PASS native clean environment and Node import fencing, including an ambient ancestor package'
} finally {
    $actual = [IO.Path]::GetFullPath($scratch)
    if ([IO.Path]::GetDirectoryName($actual) -ine $tmp.TrimEnd('\') -or
        [IO.Path]::GetFileName($actual) -cnotmatch '\Aac-admin-bundle-test-[a-f0-9]{32}\z' -or
        ([IO.File]::GetAttributes($actual) -band [IO.FileAttributes]::ReparsePoint)) { throw 'unsafe fixture cleanup' }
    Remove-Item -LiteralPath $actual -Recurse -Force
}
