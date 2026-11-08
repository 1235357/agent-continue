[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)][ValidateSet('Server','Owner','Provider')][string]$Role,
    [Parameter(Mandatory = $true)][string]$Bundle,
    [Parameter(Mandatory = $true)][string]$Origin,
    [string]$Generation,
    [string]$ExpectedSid
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
try {
    if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or
        $PSVersionTable.PSVersion.Minor -ne 1 -or -not [Environment]::Is64BitProcess) { throw 'unsupported host' }
    $image = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    $expected = Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell\v1.0\powershell.exe'
    if (-not [string]::Equals($image,$expected,[StringComparison]::OrdinalIgnoreCase)) { throw 'unsupported image' }
    if ($Role -ceq 'Server') {
        if ($PSBoundParameters.ContainsKey('Generation') -or $PSBoundParameters.ContainsKey('ExpectedSid')) { throw 'server parameter set' }
    } elseif ($Role -cnotin @('Owner','Provider') -or -not $PSBoundParameters.ContainsKey('Generation') -or
        -not $PSBoundParameters.ContainsKey('ExpectedSid')) { throw 'client parameter set' }

    # Compile only the adjacent pinned source, in memory. The parent also owns
    # the 20-second whole-acquisition bound and observed-exit cleanup policy.
    $compiler = [PowerShell]::Create()
    $null = $compiler.AddScript('param($source) $ErrorActionPreference="Stop"; Add-Type -TypeDefinition ([IO.File]::ReadAllText($source))').AddArgument(
        (Join-Path $PSScriptRoot 'windows-browser-peer.cs'))
    $compilation = $compiler.BeginInvoke()
    if (-not $compilation.AsyncWaitHandle.WaitOne(10000)) {
        [Console]::Error.WriteLine('browser_peer_compile_timeout')
        [Environment]::Exit(1)
    }
    try {
        $null = $compiler.EndInvoke($compilation)
        if ($compiler.HadErrors) { throw 'compilation failed' }
    } finally { $compilation.AsyncWaitHandle.Close(); $compiler.Dispose() }
    $g = $s = $null
    if ($Role -cne 'Server') { $g = $Generation; $s = $ExpectedSid }
    $code = [AgentContinue.WindowsBrowserPeer]::Run($Role,$Bundle,$Origin,$g,$s)
    if ($code -ne 0) { [Console]::Error.WriteLine('browser_peer_unavailable') }
    exit $code
} catch {
    [Console]::Error.WriteLine('browser_peer_unavailable')
    exit 1
}
