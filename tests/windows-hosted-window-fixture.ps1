param(
    [Parameter(Mandatory=$true)][string]$Bundle,
    [Parameter(Mandatory=$true)][string]$ReceiptId,
    [ValidateSet('Run','Stop')][string]$Action = 'Run',
    [string]$Plan = ''
)
$ErrorActionPreference = 'Stop'
$base = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
if ([IO.Path]::GetDirectoryName($Bundle) -ine $base -or
    [IO.Path]::GetFileName($Bundle) -cnotmatch '\Aac-admin-smoke-[a-f0-9]{32}\z' -or
    $ReceiptId -cnotmatch '\A[a-f0-9]{32}\z') { throw 'fixture_path' }
$profile = [IO.Path]::Combine($Bundle + '.secrets','tunnel.yaml')
$config = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($profile))
if ($config.control_plane.base_url -cnotmatch '\Ahttp://127\.0\.0\.1:[0-9]{1,5}\z' -or
    $config.control_plane.tunnel_id -cne 'tunnel_0123456789abcdef0123456789abcdef') { throw 'fixture_loopback_required' }
$repo = [IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot,'..'))
$stager = [IO.Path]::Combine($repo,'scripts\Stage-WindowsAdministratorBundle.ps1')
$source = [IO.Path]::Combine($repo,'native\desktop-commander\hosted-acceptance-window.mjs')
$tree = [Management.Automation.Language.Parser]::ParseFile($stager,[ref]$null,[ref]$null)
$names = @('To-Hex','Assert-PathType','New-SealedAcl','Assert-SealedAcl','Open-SealedNewFile',
    'Open-LocalProbeReceipt','New-AdministratorLaunchPlan','Write-HostedWindowSignal','Request-HostedWindowStop',
    'Read-HostedWindowBytes','Read-HostedWindowSource','Invoke-AdministratorHostedWindow',
    'New-AdministratorHostedDocument','Write-HostedAcceptanceProfile')
foreach ($fn in $tree.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$true)) {
    if ($fn.Name -in $names) { . ([scriptblock]::Create($fn.Extent.Text)) }
}
$administratorsSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$systemSid = 'S-1-5-18'
$digest = 'a' * 64
if ($Action -eq 'Stop') {
    Request-HostedWindowStop $Bundle $digest $ReceiptId
    return
}
$null = Open-LocalProbeReceipt $Bundle $ReceiptId $digest 'RunHostedWindow'
$state = $Bundle + '.state'
if ($Plan) {
    $admission = [IO.Path]::Combine($repo,'native\desktop-commander\hosted-acceptance-admission.mjs')
    Write-HostedAcceptanceProfile $Bundle $state $ReceiptId $config.control_plane.tunnel_id $admission $Plan `
        ((Get-FileHash -LiteralPath $Plan).Hash.ToLowerInvariant())
    $guardedProfile = [IO.Path]::Combine($state,'work','acceptance-' + $ReceiptId + '.profile.yaml')
    $bound = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($guardedProfile))
    $bound.control_plane.base_url = $config.control_plane.base_url
    [IO.File]::WriteAllText($guardedProfile,(ConvertTo-Json -InputObject $bound -Depth 8 -Compress),[Text.UTF8Encoding]::new($false))
}
Invoke-AdministratorHostedWindow $Bundle $state $ReceiptId 25 $source ([bool]$Plan) | ConvertTo-Json -Compress
