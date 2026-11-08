[CmdletBinding()]
param([uint32]$BrowserProcessId=0)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if($PSVersionTable.PSEdition -cne 'Desktop' -or -not [Environment]::Is64BitProcess){throw 'PS51_x64_required'}
$source=Join-Path $PSScriptRoot '..\native\desktop-commander\windows-browser-peer.cs'
Add-Type -TypeDefinition ([IO.File]::ReadAllText($source))
$peer=[AgentContinue.WindowsBrowserPeer]
$policy=$peer.GetMethod('CheckPackagedCodexImage',[Reflection.BindingFlags]'NonPublic,Static')
if(-not $policy){throw 'RED_missing_exact_packaged_browser_policy'}
$family='OpenAI.Codex_2p2nqsd0c76g0'
$root='C:\Program Files\WindowsApps\OpenAI.Codex_26.1103.4239.0_x64__2p2nqsd0c76g0'
$image=$root+'\app\ChatGPT.exe'
$script:cases=0
function Accept([string]$Image,[string]$Family,[string]$Root){
    $script:cases++
    $null=$policy.Invoke($null,[object[]]@($Image,$Family,$Root))
}
function Refuse($Image,$Family,$Root){
    $script:cases++
    $refused=$false
    try{$null=$policy.Invoke($null,[object[]]@($Image,$Family,$Root))}catch{
        if($_.Exception.GetBaseException() -isnot [InvalidOperationException]){throw}
        $refused=$true
    }
    if(-not $refused){throw ('packaged_browser_policy_accepted_invalid_identity_case_'+$script:cases)}
}
Accept $image $family $root
Accept $image.ToLowerInvariant() $family $root.ToLowerInvariant()
foreach($badFamily in @($null,'','OpenAI.ChatGPT_2p2nqsd0c76g0','OpenAI.Codex_attacker','OpenAI.Codex_2p2nqsd0c76g0 ')){
    Refuse $image $badFamily $root
}
foreach($badImage in @($null,'',($root+'\ChatGPT.exe'),($root+'\app\chrome.exe'),
    'C:\Users\test\ChatGPT.exe',($root+'\app\..\app\ChatGPT.exe'),
    ($root+'\app\ChatGPT.exe:payload'),($root+'\app\ChatGPT.exe '))){
    Refuse $badImage $family $root
}
foreach($badRoot in @($null,'','relative','\\server\share',($root+'\..'),
    ($root+'\'),($root+'\.'),$root.Replace('\','/'))){
    Refuse $image $family $badRoot
}
Refuse $image $family $root.Replace('26.1103.4239.0','26.1103.4240.0')
$text=[IO.File]::ReadAllText($source)
if([regex]::Matches($text,'else process\.CheckBrowserImage\(\);').Count -ne 2){throw 'both_admission_paths_must_use_shared_policy'}
$actualObserved=$false
if($BrowserProcessId){
    $type=$peer.GetNestedType('NativeProcess',[Reflection.BindingFlags]::NonPublic)
    $ctor=$type.GetConstructor([type[]]@([uint32]))
    $instance=$ctor.Invoke([object[]]@($BrowserProcessId))
    try{
        $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
        try{if($type.GetField('Sid').GetValue($instance) -cne $identity.User.Value){throw 'test_browser_not_current_user'}}finally{$identity.Dispose()}
        $current=[Diagnostics.Process]::GetCurrentProcess()
        try{if($type.GetField('Session').GetValue($instance) -ne $current.SessionId){throw 'test_browser_not_current_session'}}finally{$current.Dispose()}
        $actualImage=[IO.Path]::GetFileName([string]$type.GetField('Image').GetValue($instance))
        if(-not [string]::Equals($actualImage,'ChatGPT.exe',[StringComparison]::OrdinalIgnoreCase)){
            throw 'optional_identity_test_requires_packaged_codex_branch_not_chrome'
        }
        $method=$type.GetMethod('CheckBrowserImage')
        $null=$method.Invoke($instance,[object[]]@())
        $actualObserved=$true
    }finally{$instance.Dispose()}
}
[pscustomobject]@{cases=$script:cases;actualPackagedBrowserIdentityObserved=$actualObserved;controlInvoked=$false;credentialRead=$false;overall='PASS'}|ConvertTo-Json -Compress
