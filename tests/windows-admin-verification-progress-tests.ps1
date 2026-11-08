[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'
$tokens=$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'parse' }
$node=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Verify-SealedBundle'},$true)
if (-not $node) { throw 'missing_verifier' }
. ([scriptblock]::Create($node.Extent.Text))
$scratch=[IO.Path]::Combine([IO.Path]::GetTempPath(),'ac-verify-progress-test-'+[Guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($scratch)
$script:events=[Collections.Generic.List[object]]::new()
$script:hashes=0
function Assert-SealedAcl([string]$Path,[bool]$Directory) {
    if ($Path -cne $scratch -and -not $Path.StartsWith($scratch+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'scratch_scope' }
    $a=[IO.File]::GetAttributes($Path)
    if (($a -band [IO.FileAttributes]::ReparsePoint) -or [bool]($a -band [IO.FileAttributes]::Directory) -ne $Directory) { throw 'scratch_type' }
}
function Copy-Or-Hash($Stream,[long]$Length,$Destination) {
    if ($null -ne $Destination) { throw 'scratch_stream' }
    $copy=[IO.MemoryStream]::new(); $Stream.CopyTo($copy)
    if ($copy.Length -ne $Length) { $copy.Dispose(); throw 'scratch_stream' }
    $copy.Position=0
    $script:hashes++
    $sha=[Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToBase64String($sha.ComputeHash($copy)) } finally { $sha.Dispose(); $copy.Dispose() }
}
$memory=[IO.MemoryStream]::new()
$archive=$null
try {
    Add-Type -AssemblyName System.IO.Compression
    $archive=[IO.Compression.ZipArchive]::new($memory,[IO.Compression.ZipArchiveMode]::Create,$true)
    for ($i=0;$i -lt 130;$i++) {
        $name='file-'+$i+'.txt'; $entry=$archive.CreateEntry($name); $bytes=[Text.Encoding]::ASCII.GetBytes('fixture-'+$i)
        $stream=$entry.Open(); try { $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
        [IO.File]::WriteAllBytes([IO.Path]::Combine($scratch,$name),$bytes)
    }
    $archive.Dispose(); $memory.Position=0
    $archive=[IO.Compression.ZipArchive]::new($memory,[IO.Compression.ZipArchiveMode]::Read,$true)
    $entries=@{}; foreach($entry in $archive.Entries) { $entries[$entry.FullName]=$entry }
    $layout=@{entries=$entries;parents=@{}}
    $output=@(Verify-SealedBundle $scratch $layout {param($Done,$Total) $script:events.Add(@{done=$Done;total=$Total})})
    if ($output.Count -ne 0) { throw 'callback_output_contamination' }
    if ($events.Count -ne 4 -or ($events.done -join ',') -cne '0,64,128,130' -or @($events|Where-Object total -ne 130).Count) { throw 'missing_bounded_verification_progress' }
    if ($hashes -ne 260) { throw 'progress_cannot_skip_hashes' }
    $script:hashes=0; Verify-SealedBundle $scratch $layout
    if ($hashes -ne 260 -or $events.Count -ne 4) { throw 'optional_callback_regression' }
    [IO.File]::WriteAllText([IO.Path]::Combine($scratch,'file-129.txt'),'tampered')
    $failed=$false; $events.Clear()
    try { Verify-SealedBundle $scratch $layout {param($Done,$Total) $script:events.Add(@{done=$Done;total=$Total})} } catch { $failed=$true }
    if (-not $failed -or @($events|Where-Object done -eq 130).Count) { throw 'tampering_did_not_abort' }
    [IO.File]::WriteAllText([IO.Path]::Combine($scratch,'file-129.txt'),'fixture-129')
    [IO.File]::WriteAllText([IO.Path]::Combine($scratch,'extra.txt'),'extra')
    $failed=$false; $events.Clear()
    try { Verify-SealedBundle $scratch $layout {param($Done,$Total) $script:events.Add(@{done=$Done;total=$Total})} } catch { $failed=$true }
    if (-not $failed -or @($events|Where-Object done -eq 130).Count) { throw 'closure_did_not_abort' }
    @{ok=$true;scope='scratch-verifier-progress-not-protected-runtime';files=130;progress='0,64,128,130';fullHashesPreserved=$true;tamperAndClosureRefused=$true}|ConvertTo-Json -Compress
} finally {
    if ($archive) { $archive.Dispose() }; $memory.Dispose()
    $full=[IO.Path]::GetFullPath($scratch)
    if (-not $full.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($full) -cnotmatch '\Aac-verify-progress-test-[a-f0-9]{32}\z' -or
        (([IO.File]::GetAttributes($full)) -band [IO.FileAttributes]::ReparsePoint)) { throw 'cleanup_scope' }
    Remove-Item -LiteralPath $full -Recurse -Force
}
