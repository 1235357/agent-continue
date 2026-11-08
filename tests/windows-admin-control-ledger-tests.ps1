#Requires -Version 5.1
[CmdletBinding()]
param([ValidateSet('all','read','publication')][string]$Batch='all')

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
if ($Batch -cnotin @('all','read','publication')) { throw 'control_ledger_batch' }
function Write-LedgerPhase(
    [ValidateSet('entry','source-extracted','canonical-bytes','matrix-connect','matrix-resume-saved','matrix-revoke',
        'matrix-complete','evidence-guards','publication-connect','publication-resume-saved','publication-revoke',
        'publication-complete','input-guards','execution-guards','complete','cleanup')][string]$Phase,
    [ValidateRange(0,6144)][int]$Count) {
    [Console]::WriteLine(('DIAG control-ledger phase=' + $Phase + ' count=' + $Count))
}
Write-LedgerPhase 'entry' 0
if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) {
    throw 'control_ledger_fixture_requires_windows_powershell_5_1'
}

# Parse, never dot-source the stager: none of its top-level setup may execute.
$source = Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'
$tokens = $parseErrors = $null
$tree = [Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'control_ledger_stager_parse' }
$required = @('Get-AdministratorControlReceiptBytes','Read-AdministratorControlReceipt',
    'Publish-AdministratorControlReceipt','Open-AdministratorControlExecution')
$support = @('Assert-PathType','Test-AdministratorOwnerAbsent')
$optional = @('Get-AdministratorControlStates','Resolve-AdministratorControlStates',
    'Assert-AdministratorControlIdentity','Read-AdministratorControlBytes',
    'Publish-AdministratorControlBytes','Test-AdministratorControlFields',
    'Read-AdministratorControlProgress','Get-AdministratorControlProgressBytes')
$names = $required + $support + $optional
$definitions = @{}
foreach ($node in $tree.FindAll({ param($n)
    $n -is [Management.Automation.Language.FunctionDefinitionAst]
},$true)) {
    if ($node.Name -cin $names) {
        if ($definitions.ContainsKey($node.Name)) { throw ('duplicate_fixture_function: ' + $node.Name) }
        $definitions[$node.Name] = $node
    }
}
$missing = @($required + $support | Where-Object { -not $definitions.ContainsKey($_) })
if ($missing.Count) { throw ('control_ledger_missing_functions: ' + ($missing -join ', ')) }
foreach ($name in $names) {
    if ($definitions.ContainsKey($name)) { . ([scriptblock]::Create($definitions[$name].Extent.Text)) }
}
Write-LedgerPhase 'source-extracted' $definitions.Count

$script:Assertions = 0
$script:MatrixCases = 0
$script:PublicationCases = 0
$script:CanonicalCases = 0
$script:EvidenceControls = 0
$script:DamagedHistoryCases = 0
$script:SelectedSidGuard = $false
$script:InputGuards = $false
$script:ExecutionGuards = $false
$script:StorageCalls = 0
$script:NewFiles = [Collections.Generic.List[object]]::new()
$script:AclChecks = [Collections.Generic.List[object]]::new()
$script:CaptureAclChecks = $true
$script:DenyAclPath = ''
$script:Scratch = Join-Path ([IO.Path]::GetTempPath()) ('ac-control-ledger-test-' + [guid]::NewGuid().ToString('N'))
$script:Scratch = [IO.Path]::GetFullPath($script:Scratch)
$scratchPrefix = $script:Scratch.TrimEnd('\') + '\'
$null = [IO.Directory]::CreateDirectory($script:Scratch)
$digest = 'a' * 64
$sid = 'S-1-5-21-1-2-3-1001'
$usersSid = 'S-1-5-32-545'
$id = 'b' * 32
$states = @('reserved','intent-saved','launch-requested','launch-unconfirmed',
    'revocation-recorded','stopped','superseded','rejected','fenced','abandoned','recovered-paused')
$controls = @('connect','resume-saved','revoke')

function Assert-True([bool]$Condition,[string]$Message) {
    $script:Assertions++
    if (-not $Condition) { throw ('control_ledger_assertion: ' + $Message) }
}

function Assert-Throws([scriptblock]$Action,[string]$Message) {
    $caught = $false
    try { $null = & $Action } catch { $caught = $true }
    Assert-True $caught $Message
}

function Assert-ScratchPath([string]$Path) {
    $script:StorageCalls++
    $full = [IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith($scratchPrefix,[StringComparison]::OrdinalIgnoreCase)) {
        throw ('fixture_path_outside_scratch: ' + $full)
    }
    # No fixture may follow a reparse point, including one in an ancestor.
    $cursor = $full
    while ($cursor.Length -ge $script:Scratch.Length) {
        try {
            if ([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint) {
                throw 'fixture_reparse_point'
            }
        } catch {
            $cause = $_.Exception.GetBaseException()
            if ($cause -isnot [IO.FileNotFoundException] -and $cause -isnot [IO.DirectoryNotFoundException]) { throw }
        }
        if ($cursor -ceq $script:Scratch) { break }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
}

# Deliberate scratch-only ACL substitutes, NOT protected ACL acceptance.
function Assert-SealedAcl([string]$Path,[bool]$Directory,[bool]$Private=$false,[string]$ReaderSid='') {
    Assert-ScratchPath $Path
    if ($script:CaptureAclChecks) {
        $script:AclChecks.Add(@{Path=[IO.Path]::GetFullPath($Path);Directory=$Directory;Private=$Private;Sid=$ReaderSid})
    }
    if ($Path -ceq $script:DenyAclPath) { throw 'fixture_acl_denied' }
    Assert-PathType $Path $Directory
}

function Assert-InheritedPrivateAcl([string]$Path,[bool]$Directory) {
    Assert-SealedAcl $Path $Directory $true
}

function Ensure-SealedDirectory([string]$Path,[bool]$Private=$false,[string]$ReaderSid='') {
    Assert-ScratchPath $Path
    $null = [IO.Directory]::CreateDirectory($Path)
    Assert-SealedAcl $Path $true $Private $ReaderSid
}

function Open-SealedNewFile([string]$Path,[bool]$Private=$false,[string]$ReaderSid='',
    [IO.FileShare]$Share=[IO.FileShare]::None) {
    Assert-ScratchPath $Path
    $script:NewFiles.Add(@{Path=[IO.Path]::GetFullPath($Path);Private=$Private;Sid=$ReaderSid;Share=$Share})
    return [IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,$Share)
}

function New-FixtureDirectory {
    $directory = [IO.Path]::Combine($script:Scratch,[guid]::NewGuid().ToString('N'))
    $null = [IO.Directory]::CreateDirectory($directory)
    return $directory
}

function Get-ReceiptPath([string]$Directory,[string]$State,[string]$OperationId=$id) {
    return [IO.Path]::Combine($Directory,('control-' + $OperationId + '.' + $State + '.json'))
}

function Get-ExpectedText([string]$Control,[string]$State,[string]$Digest=$digest,[string]$OperationId=$id) {
    return ('{{"version":1,"bundleSha256":"{0}","operationId":"{1}","control":"{2}","state":"{3}"}}' -f
        $Digest,$OperationId,$Control,$State) + [char]10
}

function Write-RawReceipt([string]$Directory,[string]$Control,[string]$State,[string]$Text='') {
    if (-not $Text) { $Text = Get-ExpectedText $Control $State }
    [IO.File]::WriteAllText((Get-ReceiptPath $Directory $State),$Text,[Text.UTF8Encoding]::new($false))
}

function Assert-Receipt([string]$Directory,[string]$Control,[string]$State,[string]$Message,
    [string]$Digest=$digest,[string]$OperationId=$id) {
    $actual = Read-AdministratorControlReceipt $Directory $Digest $sid $OperationId $Control
    Assert-True ($actual -is [Collections.IDictionary]) ($Message + ': dictionary')
    $keys = @($actual.Keys)
    Assert-True ($keys.Count -eq 5 -and [Array]::IndexOf($keys,'bundleSha256') -ge 0 -and
        [Array]::IndexOf($keys,'control') -ge 0 -and [Array]::IndexOf($keys,'operationId') -ge 0 -and
        [Array]::IndexOf($keys,'progress') -ge 0 -and [Array]::IndexOf($keys,'state') -ge 0) ($Message + ': closed projection')
    Assert-True ($actual.bundleSha256 -ceq $Digest) ($Message + ': digest')
    Assert-True ($actual.operationId -ceq $OperationId) ($Message + ': operation ID')
    Assert-True ($actual.control -ceq $Control) ($Message + ': control')
    Assert-True ($actual.state -ceq $State) ($Message + ': expected ' + $State + ', got ' + $actual.state)
    Assert-True ($null -eq $actual.progress) ($Message + ': progress remains null')
}

function Get-Snapshot([string]$Directory) {
    $rows = foreach ($file in [IO.Directory]::GetFiles($Directory) | Sort-Object) {
        $info = [IO.FileInfo]::new($file)
        [IO.Path]::GetFileName($file) + ':' + $info.CreationTimeUtc.Ticks + ':' + $info.LastWriteTimeUtc.Ticks + ':' +
            [Convert]::ToBase64String([IO.File]::ReadAllBytes($file))
    }
    return (@($rows) -join '|') + ';directories=' + (([IO.Directory]::GetDirectories($Directory) | Sort-Object) -join '|')
}

function Set-OldReceiptTimes([string]$Directory) {
    foreach ($file in [IO.Directory]::GetFiles($Directory)) {
        [IO.File]::SetLastWriteTimeUtc($file,[datetime]::new(2001,1,1,0,0,0,[DateTimeKind]::Utc))
    }
}

function Get-StateMask([string[]]$Values) {
    $mask = 0
    foreach ($value in $Values) { $mask = $mask -bor (1 -shl [array]::IndexOf($states,$value)) }
    return $mask
}

function Get-LegalReadStates([string]$Control) {
    $map = @{}
    $map[(Get-StateMask @('fenced'))] = 'fenced'
    $map[(Get-StateMask @('reserved'))] = 'reserved'
    if ($Control -ceq 'revoke') {
        $map[(Get-StateMask @('reserved','revocation-recorded'))] = 'revocation-recorded'
        $map[(Get-StateMask @('reserved','revocation-recorded','stopped'))] = 'stopped'
    } else {
        $map[(Get-StateMask @('reserved','intent-saved'))] = 'intent-saved'
        foreach ($launch in @('launch-requested','launch-unconfirmed')) {
            $map[(Get-StateMask @('reserved','intent-saved',$launch))] = $launch
        }
        foreach ($terminal in @('abandoned','rejected')) {
            $map[(Get-StateMask @('reserved',$terminal))] = $terminal
        }
        # Every launch-bearing history still requires intent-saved, including
        # recovery. A terminal cannot repair missing prerequisite evidence.
        foreach ($terminal in @('recovered-paused','superseded')) {
            $map[(Get-StateMask @('reserved',$terminal))] = $terminal
            $map[(Get-StateMask @('reserved','intent-saved',$terminal))] = $terminal
            $map[(Get-StateMask @('reserved','intent-saved','launch-unconfirmed',$terminal))] = $terminal
        }
    }
    return $map
}

function Assert-PublishRefused([string]$Directory,[string]$Control,[string]$State,[string]$Message) {
    $before = Get-Snapshot $Directory
    Assert-Throws { Publish-AdministratorControlReceipt $Directory $digest $sid $id $Control $State } $Message
    Assert-True ((Get-Snapshot $Directory) -ceq $before) ($Message + ': immutable directory')
}

try {
    if ($Batch -cin @('all','read')) {
    Write-LedgerPhase 'canonical-bytes' 0
    foreach ($control in $controls) {
        foreach ($state in $states) {
            $legalForControl = $state -cin @('reserved','fenced') -or
                ($control -ceq 'revoke' -and $state -cin @('revocation-recorded','stopped')) -or
                ($control -cne 'revoke' -and $state -cin @('intent-saved','launch-requested','launch-unconfirmed',
                    'abandoned','rejected','superseded','recovered-paused'))
            if ($legalForControl) {
                [byte[]]$actual = Get-AdministratorControlReceiptBytes $digest $id $control $state
                $expected = [Text.Encoding]::ASCII.GetBytes((Get-ExpectedText $control $state))
                Assert-True ([Convert]::ToBase64String($actual) -ceq [Convert]::ToBase64String($expected)) ($control + '/' + $state + ': canonical exact bytes with LF')
            } else {
                Assert-Throws { Get-AdministratorControlReceiptBytes $digest $id $control $state } ($control + '/' + $state + ': action-specific state')
            }
            $script:CanonicalCases++
        }
    }
    Write-Output 'PASS canonical version/digest/ID/control/state bytes, LF, and action-specific enums'
    Write-LedgerPhase 'canonical-bytes' ($controls.Count * $states.Count)

    # Gray-code enumeration changes one file at a time; expectations come from
    # the contract table above, never from the implementation's output.
    # Matrix rows do not inspect trace records; every scratch/type/denial check still runs.
    $script:CaptureAclChecks = $false
    try {
    foreach ($control in $controls) {
        $matrixPhase = switch ($control) {
            'connect' { 'matrix-connect' }
            'resume-saved' { 'matrix-resume-saved' }
            'revoke' { 'matrix-revoke' }
        }
        Write-LedgerPhase $matrixPhase $script:MatrixCases
        $directory = New-FixtureDirectory
        $legal = Get-LegalReadStates $control
        $previous = 0
        for ($n = 0; $n -lt (1 -shl $states.Count); $n++) {
            $mask = $n -bxor ($n -shr 1)
            $changed = $mask -bxor $previous
            if ($n -gt 0) {
                for ($bit = 0; $bit -lt $states.Count; $bit++) {
                    if ($changed -band (1 -shl $bit)) {
                        if ($mask -band (1 -shl $bit)) { Write-RawReceipt $directory $control $states[$bit] }
                        else { [IO.File]::Delete((Get-ReceiptPath $directory $states[$bit])) }
                        break
                    }
                }
            }
            $expected = if ($legal.ContainsKey($mask)) { $legal[$mask] } else { 'unconfirmed' }
            Assert-Receipt $directory $control $expected ($control + ' mask=' + $mask)
            $script:MatrixCases++
            $previous = $mask
            if (($script:MatrixCases % 256) -eq 0) { Write-LedgerPhase $matrixPhase $script:MatrixCases }
        }
    }
    } finally { $script:CaptureAclChecks = $true }
    Write-Output ('PASS exhaustive read-state matrix: ' + $script:MatrixCases + ' combinations')
    Write-LedgerPhase 'matrix-complete' $script:MatrixCases

    Write-LedgerPhase 'evidence-guards' 0
    foreach ($control in $controls) {
        $directory = New-FixtureDirectory
        Assert-Receipt $directory $control 'unconfirmed' 'empty directory'
        Assert-Receipt (Join-Path $directory 'missing') $control 'unconfirmed' 'absent directory'
        $valid = Get-ExpectedText $control 'reserved'
        $mutations = @(
            '{}', '{', ($valid.TrimEnd([char]10)), ($valid.Replace("`n","`r`n")),
            (' ' + $valid), ($valid + 'x'), ([string][char]0xfeff + $valid),
            ($valid.Replace('"version":1','"version":2')),
            ($valid.Replace('"version":1','"version":"1"')),
            ($valid.Replace('"version":1','"version":true')),
            ($valid.Replace('"version":1','"version":1,"extra":null')),
            ($valid.Replace('"version":1','"version":1,"version":1')),
            ($valid.Replace($digest,('c' * 64))), ($valid.Replace($id,('d' * 32))),
            ($valid.Replace('"reserved"','"fenced"')), ($valid.Replace('"control":','"action":')),
            ($valid.Replace('"control":"' + $control + '"','"control":"unknown"')),
            ($valid.Replace('"control":"' + $control + '"','"control":"' + $control.ToUpperInvariant() + '"'))
        )
        foreach ($text in $mutations) {
            Write-RawReceipt $directory $control 'reserved' $text
            Assert-Receipt $directory $control 'unconfirmed' ($control + ': corrupt or mismatched record')
            Assert-PublishRefused $directory $control 'reserved' 'damaged destination is not repaired or overwritten'
        }
        foreach ($other in $controls | Where-Object { $_ -cne $control }) {
            Write-RawReceipt $directory $other 'reserved'
            Assert-Receipt $directory $control 'unconfirmed' 'wrong action binding'
        }
        [IO.File]::WriteAllBytes((Get-ReceiptPath $directory 'reserved'),[byte[]]@(0xff,0xfe,0x00))
        Assert-Receipt $directory $control 'unconfirmed' 'invalid encoded record'
        Write-RawReceipt $directory $control 'reserved'
        $before = Get-Snapshot $directory
        Assert-Receipt $directory $control 'unconfirmed' 'wrong requested bundle' ('e' * 64)
        Assert-Receipt $directory $control 'unconfirmed' 'different ID is not this receipt' $digest ('f' * 32)
        $script:DenyAclPath = Get-ReceiptPath $directory 'reserved'
        try {
            Assert-Receipt $directory $control 'unconfirmed' 'file ACL failure is unconfirmed'
            Assert-PublishRefused $directory $control 'reserved' 'duplicate cannot bypass ACL failure'
        } finally { $script:DenyAclPath = '' }
        $script:DenyAclPath = $directory
        try { Assert-Receipt $directory $control 'unconfirmed' 'directory ACL failure is unconfirmed' }
        finally { $script:DenyAclPath = '' }
        $held = [IO.File]::Open((Get-ReceiptPath $directory 'reserved'),'Open','ReadWrite','None')
        try { Assert-Receipt $directory $control 'unconfirmed' 'inaccessible record is unconfirmed' }
        finally { $held.Dispose() }
        Assert-True ((Get-Snapshot $directory) -ceq $before) 'status and failed publication are read-only'

        $directory = New-FixtureDirectory
        $history = if ($control -ceq 'revoke') { @('reserved','revocation-recorded','stopped') }
            else { @('reserved','intent-saved','launch-requested') }
        foreach ($state in $history) { Write-RawReceipt $directory $control $state }
        foreach ($state in $history) {
            Write-RawReceipt $directory $control $state '{'
            Assert-Receipt $directory $control 'unconfirmed' ('terminal cannot hide corrupt sibling: ' + $state)
            Write-RawReceipt $directory $control $state
        }
        $script:EvidenceControls++
    }
    $directory = New-FixtureDirectory
    $null = [IO.Directory]::CreateDirectory((Get-ReceiptPath $directory 'reserved'))
    Assert-Receipt $directory 'connect' 'unconfirmed' 'directory cannot masquerade as record'
    Write-Output 'PASS corrupt/noncanonical/schema/identity/action/ACL/inaccessible evidence fails closed without repair'
    Write-LedgerPhase 'evidence-guards' $controls.Count
    }

    if ($Batch -cin @('all','publication')) {
    # Each row is a valid ordered prefix and its complete set of new appendable
    # states. Existing exact records may be read back or refused, never rewritten.
    foreach ($control in $controls) {
        $publicationPhase = switch ($control) {
            'connect' { 'publication-connect' }
            'resume-saved' { 'publication-resume-saved' }
            'revoke' { 'publication-revoke' }
        }
        Write-LedgerPhase $publicationPhase $script:PublicationCases
        $rows = @(
            @{History=@();Next=@('reserved','fenced')},
            @{History=@('fenced');Next=@()}
        )
        if ($control -ceq 'revoke') {
            $rows += @(
                @{History=@('reserved');Next=@('revocation-recorded')},
                @{History=@('reserved','revocation-recorded');Next=@('stopped')},
                @{History=@('reserved','revocation-recorded','stopped');Next=@()}
            )
        } else {
            $rows += @(
                @{History=@('reserved');Next=@('intent-saved','abandoned','rejected','superseded','recovered-paused')},
                @{History=@('reserved','intent-saved');Next=@('launch-requested','launch-unconfirmed','recovered-paused','superseded')},
                @{History=@('reserved','intent-saved','launch-requested');Next=@()},
                @{History=@('reserved','intent-saved','launch-unconfirmed');Next=@('recovered-paused','superseded')}
            )
            foreach ($terminal in @('abandoned','rejected','superseded','recovered-paused')) {
                $rows += @{History=@('reserved',$terminal);Next=@()}
            }
            foreach ($terminal in @('superseded','recovered-paused')) {
                $rows += @{History=@('reserved','intent-saved',$terminal);Next=@()}
                $rows += @{History=@('reserved','intent-saved','launch-unconfirmed',$terminal);Next=@()}
            }
        }
        foreach ($row in $rows) {
            foreach ($state in $states) {
                $directory = New-FixtureDirectory
                foreach ($prior in $row.History) { Write-RawReceipt $directory $control $prior }
                Set-OldReceiptTimes $directory
                $before = Get-Snapshot $directory
                if ($state -cin $row.History) {
                    try { $null = Publish-AdministratorControlReceipt $directory $digest $sid $id $control $state } catch { }
                    Assert-True ((Get-Snapshot $directory) -ceq $before) 'duplicate exact publication never overwrites'
                } elseif ($state -cin $row.Next) {
                    $null = Publish-AdministratorControlReceipt $directory $digest $sid $id $control $state
                    Assert-True ([IO.File]::ReadAllText((Get-ReceiptPath $directory $state)) -ceq (Get-ExpectedText $control $state)) 'new immutable canonical filename and contents'
                    Assert-Receipt $directory $control $state 'legal publication'
                    [IO.File]::Delete((Get-ReceiptPath $directory $state))
                    Assert-True ((Get-Snapshot $directory) -ceq $before) 'publication preserves prior files and leaves no temporary files'
                } else {
                    Assert-PublishRefused $directory $control $state ($control + ': illegal/reversed append ' + ($row.History -join ',') + ' -> ' + $state)
                }
                $script:PublicationCases++
                if (($script:PublicationCases % 33) -eq 0) { Write-LedgerPhase $publicationPhase $script:PublicationCases }
            }
        }
        Write-LedgerPhase $publicationPhase $script:PublicationCases
    }
    foreach ($control in $controls) {
        $directory = New-FixtureDirectory
        Write-RawReceipt $directory $control 'reserved'
        Write-RawReceipt $directory $control 'fenced'
        foreach ($state in $states) {
            Assert-PublishRefused $directory $control $state 'contradictory history cannot be extended or acknowledged'
            $script:DamagedHistoryCases++
        }
        $directory = New-FixtureDirectory
        Write-RawReceipt $directory $control 'reserved' '{'
        foreach ($state in $states) {
            Assert-PublishRefused $directory $control $state 'corrupt history cannot be extended or acknowledged'
            $script:DamagedHistoryCases++
        }
    }
    Write-Output ('PASS immutable publication transition matrix: ' + $script:PublicationCases + ' cases, plus damaged/contradictory histories')
    Write-LedgerPhase 'publication-complete' $script:PublicationCases

    Write-LedgerPhase 'input-guards' 0
    $directory = New-FixtureDirectory
    $script:NewFiles.Clear()
    $script:AclChecks.Clear()
    $null = Publish-AdministratorControlReceipt $directory $digest $sid $id 'connect' 'reserved'
    Assert-Receipt $directory 'connect' 'reserved' 'selected-SID public projection'
    Assert-True ($script:NewFiles.Count -ge 1) 'public receipt uses create-new publication helper'
    Assert-True (@($script:NewFiles | Where-Object { $_.Private -or $_.Sid -cne $sid }).Count -eq 0) 'public publication helper carries selected reader SID'
    $publicPath = Get-ReceiptPath $directory 'reserved'
    Assert-True (@($script:AclChecks | Where-Object { $_.Path -ceq $publicPath -and -not $_.Private -and $_.Sid -ceq $sid }).Count -ge 1) 'reader checks public receipt with selected SID'
    $script:SelectedSidGuard = $true

    $directory = New-FixtureDirectory
    $vault = New-FixtureDirectory
    $badIds = @('', '.', '..', '../escape', ('A' * 32), ('b' * 31), ('b' * 33),
        ($id + "`n"), ($id + "`r`n"), (' ' + $id), ($id + ' '), ($id + ':stream'), ('x' * 32))
    foreach ($badId in $badIds) {
        $before = Get-Snapshot $directory
        $calls = $script:StorageCalls
        Assert-Receipt $directory 'connect' 'unconfirmed' 'invalid ID read' $digest $badId
        Assert-Throws { Get-AdministratorControlReceiptBytes $digest $badId 'connect' 'reserved' } 'invalid ID bytes'
        Assert-Throws { Publish-AdministratorControlReceipt $directory $digest $sid $badId 'connect' 'reserved' } 'invalid ID publish'
        Assert-Throws { $stream = Open-AdministratorControlExecution $vault $badId; if ($stream) { $stream.Dispose() } } 'invalid ID execution lease'
        Assert-True ($script:StorageCalls -eq $calls) 'invalid IDs rejected before storage/ACL helpers'
        Assert-True ((Get-Snapshot $directory) -ceq $before -and [IO.Directory]::GetFileSystemEntries($vault).Length -eq 0) 'invalid IDs leave storage untouched'
    }
    foreach ($badDigest in @('',('A' * 64),('a' * 63),('a' * 65),($digest + "`n"))) {
        $calls = $script:StorageCalls
        Assert-Receipt $directory 'connect' 'unconfirmed' 'invalid digest read' $badDigest
        Assert-Throws { Get-AdministratorControlReceiptBytes $badDigest $id 'connect' 'reserved' } 'invalid digest bytes'
        Assert-Throws { Publish-AdministratorControlReceipt $directory $badDigest $sid $id 'connect' 'reserved' } 'invalid digest publish'
        Assert-True ($script:StorageCalls -eq $calls) 'invalid digest rejected before storage helpers'
    }
    foreach ($badControl in @('','Connect','resume','pause','revoke ')) {
        $calls = $script:StorageCalls
        Assert-Receipt $directory $badControl 'unconfirmed' 'invalid control read'
        Assert-Throws { Get-AdministratorControlReceiptBytes $digest $id $badControl 'reserved' } 'invalid control bytes'
        Assert-Throws { Publish-AdministratorControlReceipt $directory $digest $sid $id $badControl 'reserved' } 'invalid control publish'
        Assert-True ($script:StorageCalls -eq $calls) 'invalid control rejected before storage helpers'
    }
    foreach ($badState in @('','Reserved','unconfirmed','running','revoked','reserved ')) {
        Assert-Throws { Get-AdministratorControlReceiptBytes $digest $id 'connect' $badState } 'invalid state bytes'
        Assert-PublishRefused $directory 'connect' $badState 'invalid publication state'
    }
    Write-Output 'PASS strict lowercase IDs/digests, closed controls/states, and invalid-input storage guards'
    $script:InputGuards = $true
    Write-LedgerPhase 'input-guards' $controls.Count

    Write-LedgerPhase 'execution-guards' 0
    $vault = New-FixtureDirectory
    $lockPath = Join-Path $vault ('control-' + $id + '.execution.lock')
    $otherId = 'c' * 32
    $first = $second = $reused = $null
    try {
        $creates = $script:NewFiles.Count
        $first = Open-AdministratorControlExecution $vault $id
        Assert-True ($first -is [IO.FileStream]) 'new execution lease returns FileStream'
        Assert-True ($script:NewFiles.Count -eq ($creates + 1)) 'new lease uses create-new helper'
        $create = $script:NewFiles[$script:NewFiles.Count - 1]
        Assert-True ($create.Path -ceq $lockPath -and $create.Private -and $create.Share -eq [IO.FileShare]::None) 'new lock private and exclusively created'
        Assert-True ([IO.File]::Exists($lockPath) -and $first.Length -eq 0) 'lock is a durable file, not a directory or PID marker'
        Assert-Throws { $busy = Open-AdministratorControlExecution $vault $id; if ($busy) { $busy.Dispose() } } 'same-ID concurrent acquisition is busy'
        Assert-Throws { $busy = [IO.File]::Open($lockPath,'Open','ReadWrite','None'); $busy.Dispose() } 'held lock enforces kernel exclusivity'
        $second = Open-AdministratorControlExecution $vault $otherId
        Assert-True ($second -is [IO.FileStream]) 'different operation IDs can run concurrently'
        $second.Dispose(); $second = $null
        $first.Dispose(); $first = $null
        Assert-True ([IO.File]::Exists($lockPath)) 'handle close does not delete lock'

        [byte[]]$sentinel = @(17,34,51,68)
        [IO.File]::WriteAllBytes($lockPath,$sentinel)
        Set-OldReceiptTimes $vault
        $before = Get-Snapshot $vault
        $creates = $script:NewFiles.Count
        $script:AclChecks.Clear()
        $reused = Open-AdministratorControlExecution $vault $id
        Assert-True ($reused -is [IO.FileStream] -and $reused.CanRead -and $reused.CanWrite) 'stale existing lease opens ReadWrite'
        Assert-True ($script:NewFiles.Count -eq $creates) 'stale lease is opened, not recreated'
        Assert-True (@($script:AclChecks | Where-Object { $_.Path -ceq $lockPath -and -not $_.Directory -and $_.Private }).Count -ge 1) 'existing file requires private ACL check'
        $reused.Position = 0
        Assert-True ($reused.Length -eq $sentinel.Length -and $reused.ReadByte() -eq 17) 'existing lock is not truncated'
        Assert-Throws { $busy = [IO.File]::Open($lockPath,'Open','Read','ReadWrite'); $busy.Dispose() } 'reused lease remains exclusive'
        $reused.Dispose(); $reused = $null
        Assert-True ((Get-Snapshot $vault) -ceq $before) 'stale lock content/timestamps and other-ID lock persist'
        $script:DenyAclPath = $lockPath
        try { Assert-Throws { $busy = Open-AdministratorControlExecution $vault $id; if ($busy) { $busy.Dispose() } } 'existing lock ACL failure refuses reuse' }
        finally { $script:DenyAclPath = '' }
        Assert-True ((Get-Snapshot $vault) -ceq $before) 'ACL-denied stale lock is not deleted or replaced'
    } finally {
        foreach ($stream in @($reused,$second,$first)) { if ($stream) { $stream.Dispose() } }
    }
    $vault = New-FixtureDirectory
    $null = [IO.Directory]::CreateDirectory((Join-Path $vault ('control-' + $id + '.execution.lock')))
    Assert-Throws { $busy = Open-AdministratorControlExecution $vault $id; if ($busy) { $busy.Dispose() } } 'directory cannot masquerade as execution lock'

    # Durable-flush coverage is a source assertion, alongside the real exclusive
    # handle tests above. It is not an OS ACL check or a crash-durability proof.
    $flushes = @($definitions['Open-AdministratorControlExecution'].Body.FindAll({ param($n)
        $n -is [Management.Automation.Language.InvokeMemberExpressionAst] -and
        $n.Member.Extent.Text -ceq 'Flush' -and $null -ne $n.Arguments -and $n.Arguments.Count -eq 1 -and
        $n.Arguments[0].Extent.Text -ceq '$true'
    },$true))
    Assert-True ($flushes.Count -ge 1) 'execution function contains explicit Flush(true)'
    Write-Output 'PASS execution CreateNew/private-helper/Flush(true), same-ID busy, distinct-ID concurrency, exclusive stale-file reuse without deletion'
    $script:ExecutionGuards = $true
    Write-LedgerPhase 'execution-guards' 1
    }
    Write-Output ('PASS control ledger scratch-only fixture: assertions=' + $script:Assertions +
        '; readCombinations=' + $script:MatrixCases + '; publicationCases=' + $script:PublicationCases +
        '; protectedAcceptance=false')
    $coverage = [ordered]@{version=1;batch=$Batch;canonicalCases=$script:CanonicalCases;
        readCombinations=$script:MatrixCases;evidenceControls=$script:EvidenceControls;
        publicationCases=$script:PublicationCases;damagedHistoryCases=$script:DamagedHistoryCases;
        selectedSidGuard=$script:SelectedSidGuard;inputGuards=$script:InputGuards;executionGuards=$script:ExecutionGuards;
        assertions=$script:Assertions;protectedAcceptance=$false}
    Write-Output ('LEDGER_BATCH ' + (ConvertTo-Json -InputObject $coverage -Compress))
    Write-LedgerPhase 'complete' $script:MatrixCases
} finally {
    Write-LedgerPhase 'cleanup' 0
    $full = [IO.Path]::GetFullPath($script:Scratch)
    $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $full.StartsWith($parent,[StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($full) -cnotmatch '\Aac-control-ledger-test-[a-f0-9]{32}\z' -or
        ([IO.File]::GetAttributes($full) -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'control_ledger_cleanup_path_refused'
    }
    foreach ($entry in Get-ChildItem -LiteralPath $full -Force -Recurse) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'control_ledger_cleanup_reparse_refused' }
    }
    Remove-Item -LiteralPath $full -Recurse -Force
    Write-LedgerPhase 'cleanup' 1
}
