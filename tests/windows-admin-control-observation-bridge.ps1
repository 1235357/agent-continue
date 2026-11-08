[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Digest,
    [Parameter(Mandatory=$true)][string]$Operation,
    [Parameter(Mandatory=$true)][string]$Control,
    [ValidateSet('receipt','absent','corrupt','mismatch','extra','bad-progress')][string]$Fixture='receipt'
)
$ErrorActionPreference='Stop'
[Console]::Error.WriteLine('OBSERVATION_FIXTURE entry')
$stager=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'))
$tokens=$errorsFound=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($stager,[ref]$tokens,[ref]$errorsFound)
if ($errorsFound.Count) { throw 'stager_parse' }
[Console]::Error.WriteLine('OBSERVATION_FIXTURE source-parsed')
$names=@('Test-AdministratorControlFields','Assert-AdministratorControlIdentity','Get-AdministratorControlStates',
    'Get-AdministratorControlReceiptBytes','Get-AdministratorControlProgressBytes',
    'Assert-AdministratorControlObservationParameters','Read-AdministratorBrowserControlStatus')
foreach ($name in $names) {
    $nodes=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true))
    if ($nodes.Count -ne 1) { throw 'fixture_function' }
    . ([scriptblock]::Create($nodes[0].Extent.Text))
}
[Console]::Error.WriteLine('OBSERVATION_FIXTURE helpers-ready')

# Virtual selected-SID receipt seam only. Never read an installed bundle or dispatch it.
$sid='S-1-5-21-1-2-3-1001'
$root='C:\Program Files\AgentContinueAdmin\'+$Digest.Substring(0,24)
function Read-AdministratorControlReceipt([string]$Directory,[string]$Digest,[string]$Sid,[string]$Id,[string]$Control) {
    [Console]::Error.WriteLine('OBSERVATION_FIXTURE receipt-read')
    if ($Directory -cne ($script:root+'.status') -or $Digest -cne $script:Digest -or $Sid -cne $script:sid -or
        $Id -cne $script:Operation -or $Control -cne $script:Control) { throw 'fixture_read_identity' }
    $state=if ($Control -ceq 'revoke') { 'stopped' } else { 'launch-unconfirmed' }
    $row=@{bundleSha256=$Digest;operationId=$Id;control=$Control;state=$state;progress=@{phase='settled';verifiedFiles=$null;totalFiles=$null}}
    switch ($script:Fixture) {
        'absent' { $row.state='unconfirmed'; $row.progress=$null }
        'corrupt' { throw 'private-fixture-diagnostic-not-for-browser' }
        'mismatch' { $row.operationId='e'*32 }
        'extra' { $row.path='private-fixture-path-not-for-browser' }
        'bad-progress' { $row.progress=@{phase='verifying-full';verifiedFiles='1';totalFiles=100} }
    }
    return $row
}
$bound=@('Action','Archive','ExpectedSha256','ControlKind','ControlOperationId')
$result=Read-AdministratorBrowserControlStatus $Digest $Operation $Control $bound {
    @{Digest=$script:Digest;Sid=$script:sid;Root=$script:root}
}
[Console]::WriteLine((ConvertTo-Json -InputObject $result -Depth 4 -Compress))
[Console]::Error.WriteLine('OBSERVATION_FIXTURE complete')
