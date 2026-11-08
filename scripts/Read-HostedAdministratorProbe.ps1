param(
    [Parameter(Mandatory=$true)][ValidatePattern('\A[a-f0-9]{64}\z')][string]$BundleSha256,
    [Parameter(Mandatory=$true)][ValidatePattern('\A[a-f0-9]{32}\z')][string]$WindowId,
    [Parameter(Mandatory=$true)][ValidatePattern('\A[a-f0-9]{32}\z')][string]$StepId,
    [string]$BrowserMarker = ''
)
$ErrorActionPreference = 'Stop'
$sha = [Security.Cryptography.SHA256]::Create()
$state = [IO.Path]::Combine([Environment]::GetFolderPath('ProgramFiles'),
    'AgentContinueAdmin',$BundleSha256.Substring(0,24) + '.state')
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
function Read-AdministratorChildWitness([string]$Text, [string]$ExpectedSid) {
    $match = [regex]::Match($Text,'\A(?:(?<version>v2):)?(?<pid>[1-9][0-9]{0,9}):(?<sid>S-1-[0-9-]+):(?:(?<token>1:S-1-16-12288):)?(?<marker>AC_ADMIN_[a-f0-9]{32})\z')
    if (-not $match.Success -or $match.Groups['sid'].Value -cne $ExpectedSid -or
        $match.Groups['version'].Success -ne $match.Groups['token'].Success) { return $null }
    return @{
        Pid=$match.Groups['pid'].Value
        Marker=$match.Groups['marker'].Value
        TokenElevationVerified=$match.Groups['token'].Success
    }
}

try {
    function Read-SmallFile([string]$File, [int]$Limit) {
        if (-not [IO.File]::Exists($File)) { return $null }
        $info = [IO.FileInfo]::new($File)
        if (($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $info.Length -gt $Limit) { throw 'unexpected_artifact' }
        return [Text.UTF8Encoding]::new($false,$true).GetString([IO.File]::ReadAllBytes($File))
    }
    if ($BundleSha256 -cnotmatch '\A[a-f0-9]{64}\z' -or $WindowId -cnotmatch '\A[a-f0-9]{32}\z' -or
        $StepId -cnotmatch '\A[a-f0-9]{32}\z' -or
        ($BrowserMarker -and $BrowserMarker -cnotmatch '\AAC_ADMIN_[a-f0-9]{32}\z') -or
        -not [Security.Principal.WindowsPrincipal]::new($id).IsInRole(
            [Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'invalid_probe_readback' }
    $identity = ConvertFrom-Json -InputObject (Read-SmallFile ([IO.Path]::Combine($state,'administrator.json')) 512)
    if ($identity.bundleSha256 -cne $BundleSha256 -or $identity.userSid -cne $id.User.Value) { throw 'wrong_protected_identity' }
    $work = [IO.Path]::Combine($state,'work')
    $plan = ConvertFrom-Json -InputObject (Read-SmallFile ([IO.Path]::Combine($work,'acceptance-'+$WindowId+'.plan.json')) 65536)
    $step = @($plan | Where-Object { $_.id -ceq $StepId -and $_.name -ceq 'agent_continue_start_process_exact' })
    if ($step.Count -ne 1) { throw 'wrong_probe_step' }
    $op = $step[0].arguments.agent_continue_operation_id
    if ($op -cnotmatch '\A[a-f0-9-]{36}\z') { throw 'wrong_probe_operation' }
    $opHash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($op))).Replace('-','').ToLowerInvariant()
    $operation = Read-SmallFile ([IO.Path]::Combine($state,'mcp-operation-receipts',$opHash+'.admitted')) 64
    $accepted = [IO.Path]::Combine($state,'acceptance-'+$WindowId+'-receipts',$StepId)
    $proof = Read-SmallFile ([IO.Path]::Combine($work,'ac-hosted-admin-'+$StepId+'.proof')) 192
    $witness = Read-AdministratorChildWitness ([string]$proof) $id.User.Value
    $selected = $null -ne $witness
    $browserMatch = $selected -and $BrowserMarker -and $witness.Marker -ceq $BrowserMarker
    $startPidMatches = $false
    $reportedFinished = $false
    if ($selected) {
        $history = Read-SmallFile ([IO.Path]::Combine($state,'home','.claude-server-commander','tool-history.jsonl')) 1MB
        $expected = $step[0].arguments
        $matching = @($history -split '\r?\n' | Where-Object { $_.Contains($witness.Marker) } | ForEach-Object {
            ConvertFrom-Json -InputObject $_
        } | Where-Object {
            $_.toolName -ceq 'start_process' -and $_.arguments.command -ceq $expected.command -and
            $_.arguments.shell -ceq $expected.shell -and $_.arguments.timeout_ms -eq $expected.timeout_ms -and
            $_.output.isError -ne $true
        })
        if ($matching.Count -eq 1) {
            $result = @($matching[0].output.content | Where-Object { $_.type -ceq 'text' } | ForEach-Object { $_.text }) -join "`n"
            $pidPattern = [regex]::Escape($witness.Pid)
            $startPidMatches = $result -cmatch ('(?m)^Process started with PID '+$pidPattern+'(?:\s|$)')
            $reportedFinished = $result -cmatch ('(?m)Process '+$pidPattern+' has finished execution\s*$')
        }
    }
    [ordered]@{
        guardedAdmitted=[IO.File]::Exists($accepted+'.admitted')
        guardedProviderReplied=[IO.File]::Exists($accepted+'.provider-replied')
        exactProviderResult=$operation -ceq "admitted-exact`nprovider-reported-result`n"
        selectedAccountWitness=$selected
        childTokenElevationVerified=$selected -and $witness.TokenElevationVerified -and $startPidMatches
        browserMarkerMatched=[bool]$browserMatch
        providerPidMatched=$startPidMatches
        providerReportedFinished=$reportedFinished
        exitCodeVerified=$false
    } | ConvertTo-Json -Compress
} finally { $sha.Dispose(); $id.Dispose() }
