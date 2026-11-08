[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'
$tokens = $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'stager_parse' }
$names = @('Assert-PathType','Test-AdministratorOwnerAbsent','Get-FailedBrowserOwnerFileType',
    'Read-FailedBrowserOwnerEvidence','Assert-FailedBrowserOwnerGeneration')
foreach ($node in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] },$true)) {
    if ($node.Name -in $names) { . ([scriptblock]::Create($node.Extent.Text)) }
}
# The production caller checks exact protected DACLs; fixtures use real NTFS files
# and the actual handle checks without requiring elevation or touching enrollment.
function Assert-SealedAcl($Path,$Directory,$Private) { Assert-PathType $Path $Directory }
function Assert-InheritedPrivateAcl($Path,$Directory) { Assert-PathType $Path $Directory }

$scratch = Join-Path ([IO.Path]::GetTempPath()) ('ac-failed-generation-test-' + [guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($scratch)
$digest = 'a' * 64
$sid = 'S-1-5-21-1-2-3-1001'
$gen = 'b' * 32
$system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)

function Write-Row($File,$Row) {
    [IO.File]::WriteAllText($File,((ConvertTo-Json -InputObject $Row -Compress) + [char]10),[Text.UTF8Encoding]::new($false))
}

function New-FailureFixture {
    $root = Join-Path $scratch ([guid]::NewGuid().ToString('N'))
    $state = $root + '.state'
    $vault = $root + '.secrets'
    $null = [IO.Directory]::CreateDirectory($state)
    $null = [IO.Directory]::CreateDirectory($vault)
    $f = @{Root=$root;State=$state;Vault=$vault;
        Intent=(Join-Path $state 'lifecycle.json'); Controller=(Join-Path $state 'controller.lease');
        Ops=(Join-Path $state 'device-operations.lease'); Journal=(Join-Path $state 'device-operations.jsonl');
        Owner=(Join-Path $vault 'owner-job.lease'); Terminal=(Join-Path $vault "owner-job-$gen.terminal.json")}
    Write-Row $f.Intent ([ordered]@{format='agent-continue-lifecycle';version=1;paused=$true})
    Write-Row $f.Owner ([ordered]@{version=1;bundleSha256=$digest;userSid=$sid;generation=$gen})
    $f.TerminalRow = [ordered]@{format='agent-continue-windows-owner-job';version=1;generation=$gen;bundleSha256=$digest;
        outcome='owner-exited';jobDrained=$true;rootCreationAttempted=$true;rootExitObserved=$true;
        rootExitCode=1;innerLeasesClear=$false;tunnelReady='unobserved'}
    Write-Row $f.Terminal $f.TerminalRow
    Write-Row $f.Controller ([ordered]@{format='agent-continue-controller';version=1;token=[guid]::NewGuid().ToString()})
    Write-Row $f.Ops ([ordered]@{format='agent-continue-device-operation-owner';version=1;token=[guid]::NewGuid().ToString()})
    Write-Row $f.Journal ([ordered]@{format='agent-continue-device-operations';version=1})
    return $f
}

function Assert-Refusal($Fixture,[string]$Why = '',[string]$Generation = $gen) {
    $handles = [Collections.Generic.List[IO.FileStream]]::new()
    try {
        Assert-FailedBrowserOwnerGeneration $Fixture.Root $digest $sid $Generation $fileType $handles
        throw 'expected_refusal'
    } catch {
        if ($_.Exception.Message -ceq 'expected_refusal' -or
            ($Why -and $_.Exception.GetBaseException().Message -cne $Why)) { throw }
    } finally { foreach ($stream in $handles) { $stream.Dispose() } }
}

try {
    $fileType = Get-FailedBrowserOwnerFileType $scratch $system
    $f = New-FailureFixture
    $handles = [Collections.Generic.List[IO.FileStream]]::new()
    try {
        Assert-FailedBrowserOwnerGeneration $f.Root $digest $sid $gen $fileType $handles
        if ($handles.Count -ne 6) { throw 'missing retained handle' }
        try { [IO.File]::ReadAllText($f.Journal); throw 'expected_share_denial' }
        catch { if ($_.Exception.GetBaseException() -isnot [IO.IOException]) { throw } }
    } finally { foreach ($stream in $handles) { $stream.Dispose() } }
    if (-not [IO.File]::Exists($f.Owner) -or -not [IO.File]::Exists($f.Controller) -or
        -not [IO.File]::Exists($f.Ops) -or -not [IO.File]::Exists($f.Terminal)) { throw 'evidence was removed' }
    [Console]::WriteLine('PASS one terminal generation holds all six exact evidence handles without deleting them')

    Assert-Refusal (New-FailureFixture) 'failed_owner_generation' ('c' * 32)
    $f = New-FailureFixture
    $f.TerminalRow.rootExitObserved = $false
    Write-Row $f.Terminal $f.TerminalRow
    Assert-Refusal $f 'failed_owner_terminal'
    $f = New-FailureFixture
    $f.TerminalRow.rootExitCode = '1'
    Write-Row $f.Terminal $f.TerminalRow
    Assert-Refusal $f 'failed_owner_terminal'
    $f = New-FailureFixture
    [IO.File]::WriteAllText((Join-Path $f.Vault "owner-observation-$gen.json"),'{}')
    Assert-Refusal $f 'failed_owner_terminal'
    $f = New-FailureFixture
    Write-Row $f.Intent ([ordered]@{format='agent-continue-lifecycle';version=1;paused=$false})
    Assert-Refusal $f 'failed_owner_not_paused'
    [Console]::WriteLine('PASS wrong generation, nonterminal exit, unexpected readiness sample and running intent refuse')

    $f = New-FailureFixture
    [IO.File]::AppendAllText($f.Journal,('{"id":"pending","action":"reconnect","status":"in-progress"}'+[char]10))
    Assert-Refusal $f 'failed_owner_operation_history'
    $f = New-FailureFixture
    $null = [IO.Directory]::CreateDirectory((Join-Path $f.State 'mcp-operation-receipts'))
    Assert-Refusal $f 'failed_owner_operation_history'
    $f = New-FailureFixture
    $null = New-Item -ItemType HardLink -Path (Join-Path $f.State 'controller-alias') -Target $f.Controller
    Assert-Refusal $f 'failed_owner_file_identity'
    $f = New-FailureFixture
    $live = [IO.File]::Open($f.Ops,'Open','ReadWrite','ReadWrite')
    try { Assert-Refusal $f } finally { $live.Dispose() }
    [Console]::WriteLine('PASS any operation history, hard-link alias or live lease handle refuses')
} finally {
    $full = [IO.Path]::GetFullPath($scratch)
    $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($full.StartsWith($parent,[StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($full) -cmatch '\Aac-failed-generation-test-[a-f0-9]{32}\z') {
        Remove-Item -LiteralPath $full -Recurse -Force
    }
}
