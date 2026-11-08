[CmdletBinding(DefaultParameterSetName='Semantic')]
param(
    [Parameter(Mandatory=$true,ParameterSetName='Prepare')][switch]$Prepare,
    [Parameter(Mandatory=$true)][string]$PreparedRoot,
    [Parameter(Mandatory=$true)][string]$FixtureTempRoot,
    [Parameter(Mandatory=$true,ParameterSetName='Semantic')][string]$Digest,
    [Parameter(Mandatory=$true,ParameterSetName='Semantic')][string]$Operation,
    [Parameter(Mandatory=$true,ParameterSetName='Semantic')][string]$Control,
    [Parameter(Mandatory=$true,ParameterSetName='Semantic')][string]$SourceSha256,
    [Parameter(Mandatory=$true,ParameterSetName='Semantic')][string]$PayloadSha256,
    [Parameter(ParameterSetName='Semantic')][ValidateSet('receipt','absent','corrupt','mismatch','extra','bad-progress')][string]$Fixture='receipt'
)
$ErrorActionPreference='Stop'
if ($Prepare) {
    [Console]::Error.WriteLine('OBSERVATION_FIXTURE prepare-entry')
    [Console]::Error.WriteLine('OBSERVATION_FIXTURE utility-import-start')
}
Import-Module ([IO.Path]::Combine($PSHOME,'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
if ($Prepare) { [Console]::Error.WriteLine('OBSERVATION_FIXTURE utility-import-complete') }
function Get-FixtureHash([byte[]]$Bytes) {
    $hash=[Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash($Bytes)).Replace('-','').ToLowerInvariant() }
    finally { $hash.Dispose() }
}
function Assert-PreparedRoot {
    $root=[IO.Path]::GetFullPath($PreparedRoot)
    $parent=[IO.Path]::GetFullPath($FixtureTempRoot).TrimEnd('\')
    if (-not [IO.Path]::IsPathRooted($PreparedRoot) -or -not [IO.Path]::IsPathRooted($FixtureTempRoot) -or
        $root -ine $PreparedRoot -or [IO.Path]::GetDirectoryName($root) -ine $parent -or
        [IO.Path]::GetFileName($root) -cnotmatch '\Aac-observation-fixture-[a-f0-9]{32}\z') { throw 'fixture_scope' }
    foreach ($path in @($parent,$root)) {
        for ($cursor=[IO.DirectoryInfo]::new($path); $null -ne $cursor; $cursor=$cursor.Parent) {
            if (-not $cursor.Exists -or ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'fixture_scope' }
        }
    }
}
Assert-PreparedRoot
$stager=[IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot,'..','scripts','Stage-WindowsAdministratorBundle.ps1'))
$payloadFile=[IO.Path]::Combine($PreparedRoot,'helpers.ps1')
$names=@('Test-AdministratorControlFields','Assert-AdministratorControlIdentity','Get-AdministratorControlStates',
    'Get-AdministratorControlReceiptBytes','Get-AdministratorControlProgressBytes',
    'Assert-AdministratorControlObservationParameters','Read-AdministratorBrowserControlStatus')
if ($Prepare) {
    $sourceBytes=[IO.File]::ReadAllBytes($stager)
    $text=[Text.UTF8Encoding]::new($false,$true).GetString($sourceBytes).TrimStart([char]0xfeff)
    [Console]::Error.WriteLine('OBSERVATION_FIXTURE source-read')
    $tokens=$errorsFound=$null
    $ast=[Management.Automation.Language.Parser]::ParseInput($text,[ref]$tokens,[ref]$errorsFound)
    if ($errorsFound.Count) { throw 'stager_parse' }
    [Console]::Error.WriteLine('OBSERVATION_FIXTURE source-parsed')
    # Keep recursive AST discovery without a PowerShell callback for every node.
    $node=[Linq.Expressions.Expression]::Parameter([Management.Automation.Language.Ast],'node')
    $predicate=[Linq.Expressions.Expression]::Lambda(
        [Func[Management.Automation.Language.Ast,bool]],
        [Linq.Expressions.Expression]::TypeIs($node,[Management.Automation.Language.FunctionDefinitionAst]),
        [Linq.Expressions.ParameterExpression[]]@($node)).Compile()
    [Console]::Error.WriteLine('OBSERVATION_FIXTURE source-predicate-ready')
    $definitions=[Collections.Generic.Dictionary[string,Management.Automation.Language.FunctionDefinitionAst]]::new([StringComparer]::Ordinal)
    foreach ($definition in $ast.FindAll($predicate,$true)) {
        if ($names -ccontains $definition.Name) {
            if ($definitions.ContainsKey($definition.Name)) { throw 'fixture_function' }
            $definitions.Add($definition.Name,$definition)
        }
    }
    [Console]::Error.WriteLine('OBSERVATION_FIXTURE source-discovered')
    $parts=@(); $functions=@()
    foreach ($name in $names) {
        if (-not $definitions.ContainsKey($name)) { throw 'fixture_function' }
        $extent=$definitions[$name].Extent
        $parts+=$extent.Text
        $functions+=@{name=$name;start=$extent.StartOffset;end=$extent.EndOffset;
            sha256=(Get-FixtureHash ([Text.Encoding]::UTF8.GetBytes($extent.Text)))}
    }
    [Console]::Error.WriteLine('OBSERVATION_FIXTURE source-indexed')
    $payload=[Text.Encoding]::UTF8.GetBytes($parts -join [char]10)
    $stream=[IO.File]::Open($payloadFile,'CreateNew','Write','None')
    try { $stream.Write($payload,0,$payload.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    [Console]::Error.WriteLine('OBSERVATION_FIXTURE payload-written')
    [Console]::Error.WriteLine('OBSERVATION_FIXTURE source-hash-start')
    $sourceHash=Get-FixtureHash $sourceBytes
    [Console]::Error.WriteLine('OBSERVATION_FIXTURE source-hash-complete')
    [Console]::Error.WriteLine('OBSERVATION_FIXTURE payload-hash-start')
    $payloadHash=Get-FixtureHash $payload
    [Console]::Error.WriteLine('OBSERVATION_FIXTURE payload-hash-complete')
    $manifest=@{version=1;sourceSha256=$sourceHash;payloadSha256=$payloadHash;functions=$functions}
    [Console]::Error.WriteLine('OBSERVATION_FIXTURE json-start')
    $json=ConvertTo-Json -InputObject $manifest -Depth 5 -Compress
    [Console]::Error.WriteLine('OBSERVATION_FIXTURE json-complete')
    [Console]::WriteLine($json)
    [Console]::Error.WriteLine('OBSERVATION_FIXTURE prepare-complete')
    return
}
[Console]::Error.WriteLine('OBSERVATION_FIXTURE entry')
if ($SourceSha256 -cnotmatch '\A[a-f0-9]{64}\z' -or $PayloadSha256 -cnotmatch '\A[a-f0-9]{64}\z') { throw 'fixture_manifest' }
$attributes=[IO.File]::GetAttributes($payloadFile)
if ($attributes -band ([IO.FileAttributes]::ReparsePoint -bor [IO.FileAttributes]::Directory)) { throw 'fixture_scope' }
if ((Get-FixtureHash ([IO.File]::ReadAllBytes($stager))) -cne $SourceSha256 -or
    (Get-FixtureHash ([IO.File]::ReadAllBytes($payloadFile))) -cne $PayloadSha256) { throw 'fixture_manifest' }
[Console]::Error.WriteLine('OBSERVATION_FIXTURE source-verified')
. $payloadFile
[Console]::Error.WriteLine('OBSERVATION_FIXTURE prepared-source-loaded')

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
