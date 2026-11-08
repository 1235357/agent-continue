[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# TEST ONLY: AST-extracted definitions. Never execute the stager dispatch body.
$script:cases = 0
$script:assertions = 0
$script:failures = [Collections.Generic.List[object]]::new()
$script:compilerCases=0
$script:compilerCoverage=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
function Check([bool]$Value, [string]$Why) {
    $script:assertions++
    if (-not $Value) { throw $Why }
}
function Run-Case([string]$CaseName, [scriptblock]$Work) {
    $script:cases++
    try { $null = & $Work }
    catch { $script:failures.Add([ordered]@{case=$CaseName;detail=$_.Exception.GetBaseException().Message}) }
}
$stager = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'))
$tokens = $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($stager, [ref]$tokens, [ref]$parseErrors)
Run-Case 'stager parses without dispatch' { Check ($parseErrors.Count -eq 0) 'stager_parse' }
$names = @('Read-AdministratorControlPeerSource','Get-AdministratorControlPeerType')
foreach ($name in $names) {
    $found = @($ast.FindAll({param($n)
        $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name
    }, $true))
    Run-Case ('required function: ' + $name) {
        Check ($found.Count -eq 1) ('missing_function:' + $name + ' (expected initial RED)')
    }
    if ($found.Count -eq 1) { . ([scriptblock]::Create($found[0].Extent.Text)) }
}
function To-Hex([byte[]]$Bytes) { [BitConverter]::ToString($Bytes).Replace('-','').ToLowerInvariant() }
function Hash-Bytes([byte[]]$Bytes) {
    $hash=[Security.Cryptography.SHA256]::Create()
    try { To-Hex $hash.ComputeHash($Bytes) } finally { $hash.Dispose() }
}
$script:totalLimit=768MB; $script:manifestLimit=40000
Add-Type -AssemblyName System.IO.Compression
$peer=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../native/desktop-commander/windows-browser-peer.cs'))
$script:peerBytes=[IO.File]::ReadAllBytes($peer)
function Zip-Bytes([object[]]$Entries) {
    $memory=[IO.MemoryStream]::new()
    try {
        $zip=[IO.Compression.ZipArchive]::new($memory,[IO.Compression.ZipArchiveMode]::Create,$true)
        try {
            foreach ($row in $Entries) {
                $entry=$zip.CreateEntry($row.Name)
                if ($row.ContainsKey('Attributes')) { $entry.ExternalAttributes=$row.Attributes }
                $output=$entry.Open()
                try { $output.Write($row.Bytes,0,$row.Bytes.Length) } finally { $output.Dispose() }
            }
        } finally { $zip.Dispose() }
        return ,$memory.ToArray()
    } finally { $memory.Dispose() }
}
function Read-Case([byte[]]$Bytes,[bool]$Reject,[byte[]]$Expected=$null,[string]$OverrideDigest='',[bool]$Writable=$false) {
    $stream=[IO.MemoryStream]::new($Bytes,$Writable)
    try {
        $position=[Math]::Min(7,$stream.Length)
        $stream.Position=$position
        $digest=if ($OverrideDigest) { $OverrideDigest } else { Hash-Bytes $Bytes }
        $thrown=$false; $value=$null
        try { $value=Read-AdministratorControlPeerSource $stream $digest } catch { $thrown=$true }
        Check ($thrown -eq $Reject) 'expected source acceptance/refusal'
        Check $stream.CanRead 'caller retains open stream'
        Check ($stream.Position -eq $position) 'caller stream position restored'
        if (-not $Reject) {
            Check ($value -is [byte[]]) 'exact byte array result'
            Check ([Convert]::ToBase64String($value) -ceq [Convert]::ToBase64String($Expected)) 'source bytes not normalized'
        }
    } finally { $stream.Dispose() }
}
$good=@{Name='app/windows-browser-peer.cs';Bytes=$script:peerBytes}
$script:validZip=Zip-Bytes @($good)
Run-Case 'exact archive source byte equality and caller stream preserved' { Read-Case $script:validZip $false $script:peerBytes }
Run-Case 'wrong entire archive digest' { Read-Case $script:validZip $true $null ('f'*64) }
Run-Case 'uppercase digest refused' { Read-Case $script:validZip $true $null (Hash-Bytes $script:validZip).ToUpperInvariant() }
Run-Case 'malformed ZIP refused after valid outer digest' { Read-Case ([byte[]](1,2,3,4)) $true }
Run-Case 'empty archive refused' { Read-Case ([byte[]]::new(0)) $true }
Run-Case 'archive byte limit refused' {
    $before=$script:totalLimit; $script:totalLimit=1
    try { Read-Case $script:validZip $true } finally { $script:totalLimit=$before }
}
Run-Case 'writable archive refused' { Read-Case $script:validZip $true $null '' $true }
Run-Case 'missing selected source' {
    Read-Case (Zip-Bytes @(@{Name='app/other.cs';Bytes=[byte[]](65)})) $true
}
Run-Case 'case-mismatched selected source' {
    Read-Case (Zip-Bytes @(@{Name='app/Windows-browser-peer.cs';Bytes=$script:peerBytes})) $true
}
Run-Case 'duplicate selected source' { Read-Case (Zip-Bytes @($good,$good)) $true }
Run-Case 'case variant duplicate selected source' {
    Read-Case (Zip-Bytes @($good,@{Name='APP/WINDOWS-BROWSER-PEER.CS';Bytes=$script:peerBytes})) $true
}
Run-Case 'entry count bound' {
    $bytes=Zip-Bytes @($good,@{Name='app/other.cs';Bytes=[byte[]](65)})
    $before=$script:manifestLimit; $script:manifestLimit=1
    try { Read-Case $bytes $true } finally { $script:manifestLimit=$before }
}
foreach ($row in @(
    @{Name='zero-length selected source';Bytes=[byte[]]::new(0)},
    @{Name='oversized selected source';Bytes=[byte[]]::new(65537)},
    @{Name='NUL selected source';Bytes=[byte[]](65,0,66)},
    @{Name='invalid UTF8 selected source';Bytes=[byte[]](195,40)}
)) {
    Run-Case $row.Name { Read-Case (Zip-Bytes @(@{Name='app/windows-browser-peer.cs';Bytes=$row.Bytes})) $true }
}
foreach ($row in @(
    @{Name='directory selected source';Attributes=0x10},
    @{Name='reparse selected source';Attributes=0x400},
    @{Name='symlink selected source';Attributes=(0xA000 -shl 16)}
)) {
    Run-Case $row.Name { Read-Case (Zip-Bytes @(@{Name='app/windows-browser-peer.cs';Bytes=$script:peerBytes;Attributes=$row.Attributes})) $true }
}
Run-Case 'valid source with BOM retained exactly' {
    $bytes=[byte[]](@(239,187,191)+@($script:peerBytes))
    Read-Case (Zip-Bytes @(@{Name='app/windows-browser-peer.cs';Bytes=$bytes})) $false $bytes
}
Run-Case 'nonseekable input refused without read or disposal' {
    $memory=[IO.MemoryStream]::new([byte[]](1,2,3,4),$false)
    $stream=[IO.Compression.DeflateStream]::new($memory,[IO.Compression.CompressionMode]::Decompress,$true)
    try {
        $thrown=$false
        try { $null=Read-AdministratorControlPeerSource $stream ('f'*64) } catch { $thrown=$true }
        Check $thrown 'nonseekable denied'; Check $stream.CanRead 'stream remains open'
        Check ($memory.Position -eq 0) 'no read before guard'
    } finally { $stream.Dispose(); $memory.Dispose() }
}

$script:compilerDir=[IO.Path]::Combine([IO.Path]::GetTempPath(),'AC-ControlPeerCompile-'+[Guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($script:compilerDir)
$script:aclCalls=0; $script:denyAcl=$false
function Assert-SealedAcl([string]$Path,[bool]$Directory,[bool]$Private) {
    $script:aclCalls++
    if ($script:denyAcl -or $Path -cne $script:compilerDir -or -not $Directory -or -not $Private) { throw 'fixture_acl_refusal' }
}
function Compile-Case([byte[]]$Bytes,[string]$Directory,[bool]$Reject,[bool]$BeforeAcl=$false) {
    $script:compilerCases++
    $before=@($env:TEMP,$env:TMP,[Environment]::CurrentDirectory)
    $calls=$script:aclCalls; $thrown=$false; $type=$null
    try { $type=Get-AdministratorControlPeerType $Bytes $Directory } catch { $thrown=$true }
    Check ($thrown -eq $Reject) 'expected compile acceptance/refusal'
    Check ($env:TEMP -ceq $before[0] -and $env:TMP -ceq $before[1]) 'TEMP/TMP restored'
    Check ([Environment]::CurrentDirectory -ceq $before[2]) 'working directory restored'
    Check (@([IO.Directory]::EnumerateFiles($script:compilerDir)).Count -eq 0) 'known compiler temporary files removed'
    if ($BeforeAcl) { Check ($script:aclCalls -eq $calls) 'reject before ACL/compile' }
    if (-not $Reject) {
        Check ($type -is [Type] -and $type.FullName -ceq 'AgentContinue.WindowsBrowserPeer') 'actual source returns expected compiled type'
        Check ($null -ne $type.GetMethod('OpenControlSession')) 'kernel session API compiled'
    }
}
Run-Case 'actual current source compiles with explicit ACL stub' {
    Compile-Case $script:peerBytes $script:compilerDir $false
    $null=$script:compilerCoverage.Add('actual-source')
}
Run-Case 'compiler error restores environment and temporary files' {
    Compile-Case ([Text.Encoding]::UTF8.GetBytes('not C sharp syntax')) $script:compilerDir $true
    $null=$script:compilerCoverage.Add('compiler-error')
}
Run-Case 'compiled type lookup failure restores environment and temporary files' {
    Compile-Case ([Text.Encoding]::UTF8.GetBytes('namespace Other { public class Missing { } }')) $script:compilerDir $true
    $null=$script:compilerCoverage.Add('missing-type')
}
Run-Case 'ACL refusal prevents compile and restores state' {
    $script:denyAcl=$true
    try {
        Compile-Case $script:peerBytes $script:compilerDir $true
        $null=$script:compilerCoverage.Add('acl-refusal')
    } finally { $script:denyAcl=$false }
}
foreach ($directory in @('.','child','C:child','\\server\share',($script:compilerDir+'\..\other'))) {
    Run-Case ('relative or noncanonical compiler directory '+$directory) {
        Compile-Case $script:peerBytes $directory $true $true
        $null=$script:compilerCoverage.Add('canonical-directory')
    }
}
foreach ($row in @(
    @{Name='empty compiler source';Bytes=[byte[]]::new(0)},
    @{Name='oversized compiler source';Bytes=[byte[]]::new(65537)},
    @{Name='NUL compiler source';Bytes=[byte[]](65,0,66)},
    @{Name='invalid UTF8 compiler source';Bytes=[byte[]](195,40)}
)) {
    Run-Case $row.Name {
        Compile-Case $row.Bytes $script:compilerDir $true $true
        $null=$script:compilerCoverage.Add('source-guard')
    }
}
$coverage=[string[]]@($script:compilerCoverage)
[Array]::Sort($coverage,[StringComparer]::Ordinal)
[Console]::WriteLine((ConvertTo-Json -InputObject ([ordered]@{
    ok=($script:failures.Count -eq 0);cases=$script:cases;assertions=$script:assertions
    failures=@($script:failures.ToArray());scope='archive-source-and-compiler-scratch-not-protected-runtime'
    compilerCases=$script:compilerCases;compilerCoverage=$coverage
    compilerAclStub=$true;fakeTypedPeerProjections=$false;actualHighPair=$false;protectedAcceptance=$false
    stagerSha256=(Hash-Bytes ([IO.File]::ReadAllBytes($stager)));peerSourceSha256=(Hash-Bytes $script:peerBytes)
}) -Depth 5 -Compress))
if ($script:failures.Count) { exit 1 }
