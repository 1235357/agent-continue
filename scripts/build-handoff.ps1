#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Destination,
    [string]$LegacySourceRoot,
    [string]$OfflineAssetDirectory,
    [string]$PrivateContextFile
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$utf8 = [Text.UTF8Encoding]::new($false)

function Git([string[]]$Arguments) {
    $start = [Diagnostics.ProcessStartInfo]::new('git')
    $start.WorkingDirectory = $root
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = $utf8
    foreach ($arg in $Arguments) { $start.ArgumentList.Add($arg) }
    $process = [Diagnostics.Process]::Start($start)
    $outputTask = $process.StandardOutput.ReadToEndAsync()
    $errorTask = $process.StandardError.ReadToEndAsync()
    if (!$process.WaitForExit(60000)) { $process.Kill(); throw 'handoff_git_timeout' }
    $output = $outputTask.GetAwaiter().GetResult()
    $null = $errorTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { throw 'handoff_git_failed' }
    $process.Dispose()
    return $output
}
function WriteText([string]$File, [string]$Text) {
    $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($File))
    if ([IO.File]::Exists($File)) { throw 'handoff_destination_exists' }
    [IO.File]::WriteAllText($File, $Text, $utf8)
}
function SafeFile([string]$Base, [string]$Relative) {
    if ([IO.Path]::IsPathRooted($Relative) -or $Relative.Split('/') -contains '..') { throw 'handoff_invalid_relative_path' }
    $basePath = [IO.Path]::GetFullPath($Base).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $file = [IO.Path]::GetFullPath((Join-Path $basePath $Relative))
    if (!$file.StartsWith($basePath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'handoff_path_escape' }
    for ($cursor = $file; $cursor; $cursor = [IO.Path]::GetDirectoryName($cursor)) {
        $item = Get-Item -LiteralPath $cursor -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'handoff_redirected_source' }
        if ($cursor -eq $basePath) { break }
    }
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw 'handoff_source_not_file' }
    return $file
}
function CopyChecked([string]$Base, [string]$Relative, [string]$TargetBase) {
    $file = SafeFile $Base $Relative
    if ($Relative -match '(?i)(^|/)(\.env(?:\..*)?|auth\.json|.*(?:runtimekey|api[_-]?key|github[_-]?token).*\.txt)$') { throw 'handoff_secret_filename' }
    if ([IO.Path]::GetExtension($file) -match '^\.(js|mjs|cjs|json|md|yml|yaml|ps1|py|sh|cs|html|css|txt|conf|in|service)$') {
        $text = [IO.File]::ReadAllText($file)
        # A header-only negative-test marker is not a private key. Require PEM body bytes.
        if ($text -match '(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n \t]{64,}-----END (?:OPENSSH |RSA |EC )?PRIVATE KEY-----)') {
            throw ('handoff_secret_pattern:' + $Relative)
        }
    }
    $target = Join-Path $TargetBase $Relative
    $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
    [IO.File]::Copy($file, $target, $false)
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash) { throw 'handoff_copy_changed' }
}
function Seal([string]$Directory, [string]$Archive) {
    $records = @(Get-ChildItem -LiteralPath $Directory -File -Recurse | Sort-Object FullName | ForEach-Object {
        [ordered]@{ path = [IO.Path]::GetRelativePath($Directory, $_.FullName).Replace('\', '/'); bytes = $_.Length;
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    })
    $manifest = [ordered]@{ format = 'agent-continue-handoff-manifest'; version = 1; excludesSelf = 'file-manifest.json'; files = $records }
    WriteText (Join-Path $Directory 'file-manifest.json') (($manifest | ConvertTo-Json -Depth 8) + "`n")
    [IO.Compression.ZipFile]::CreateFromDirectory($Directory, $Archive, [IO.Compression.CompressionLevel]::Optimal, $false)
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        if ($zip.Entries.Count -ne $records.Count + 1) { throw 'handoff_zip_inventory_mismatch' }
        foreach ($record in $records) {
            $entry = $zip.GetEntry($record.path)
            if (!$entry -or $entry.Length -ne $record.bytes) { throw 'handoff_zip_size_mismatch' }
            $stream = $entry.Open()
            try { $actual = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)).ToLowerInvariant() }
            finally { $stream.Dispose() }
            if ($actual -ne $record.sha256) { throw 'handoff_zip_hash_mismatch' }
        }
    } finally { $zip.Dispose() }
    return [ordered]@{ file = [IO.Path]::GetFileName($Archive); files = $records.Count + 1;
        bytes = (Get-Item -LiteralPath $Archive).Length; sha256 = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant(); verified = $true }
}

if (![IO.Path]::IsPathRooted($Destination)) { throw 'handoff_absolute_destination_required' }
if ((Git -Arguments @('rev-parse', '--is-shallow-repository')).Trim() -ne 'false') { throw 'handoff_shallow_history_fetch_required' }
$Destination = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $Destination) { throw 'handoff_destination_exists' }
if ($Destination.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'handoff_output_inside_source' }
$null = [IO.Directory]::CreateDirectory($Destination)
$public = Join-Path $Destination 'public'
$local = Join-Path $Destination 'local-full'
$null = [IO.Directory]::CreateDirectory($public)
$head = (Git -Arguments @('rev-parse', 'HEAD')).Trim()
$branch = (Git -Arguments @('branch', '--show-current')).Trim()
if ($branch -ne 'main') { throw 'handoff_requires_canonical_main' }
$paths = @((Git -Arguments @('-c', 'core.quotepath=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard')).Split([char]0) |
    Where-Object { $_ -and $_ -notmatch '(^|/)(\.artifacts|node_modules|dist|test-results|private|state|playwright-report)(/|$)' } | Sort-Object -Unique)
foreach ($relative in $paths) { CopyChecked $root $relative (Join-Path $public 'source') }
# These ignored PDF resources are reproducible public dependencies, not user data.
foreach ($item in Get-ChildItem -LiteralPath (Join-Path $root 'vendor/pdfjs') -File -Recurse) {
    $relative = [IO.Path]::GetRelativePath($root, $item.FullName).Replace('\', '/')
    if ($paths -notcontains $relative) { CopyChecked $root $relative (Join-Path $public 'source') }
}
$untracked = @((Git -Arguments @('-c', 'core.quotepath=false', 'ls-files', '-z', '--others', '--exclude-standard')).Split([char]0) | Where-Object { $_ -and $paths -contains $_ })
WriteText (Join-Path $public 'pending-tracked.patch') (Git -Arguments @('diff', 'HEAD', '--binary', '--no-ext-diff'))
WriteText (Join-Path $public 'pending-untracked.json') ((ConvertTo-Json -InputObject $untracked) + "`n")
WriteText (Join-Path $public 'git-log.txt') (Git -Arguments @('log', 'main', '--date=iso-strict', '--format=%H %ad %s'))
$null = Git -Arguments @('bundle', 'create', (Join-Path $public 'history.bundle'), 'main', '--tags')
$null = Git -Arguments @('bundle', 'verify', (Join-Path $public 'history.bundle'))
# Verify without the source repository's object database or shallow boundaries.
$recovery = Join-Path $Destination 'restore-check'
$null = Git -Arguments @('clone', '--no-checkout', (Join-Path $public 'history.bundle'), $recovery)
$null = Git -Arguments @('-C', $recovery, 'checkout', 'main')
$null = Git -Arguments @('-C', $recovery, 'apply', '--check', (Join-Path $public 'pending-tracked.patch'))
$metadata = [ordered]@{ format = 'agent-continue-handoff'; version = 1; createdAtUtc = [DateTime]::UtcNow.ToString('o');
    branch = $branch; commit = $head; repository = 'https://github.com/1235357/agent-continue';
    developmentPaused = $true; stableExtension = '2.2.0'; privateBootstrap = '0.3.0';
    sourceSnapshotIncludesUnshippedCandidates = $true; sourceFiles = $paths.Count;
    cleanOfflineCloneVerified = $true; pendingTrackedPatchApplicable = $true;
    exclusions = @('credentials and auth files', 'browser profiles and private prompts', 'production state and research files', 'node_modules and npm caches', 'arbitrary .artifacts/test-results', 'legacy private prototype source from the public package');
    integrityScope = 'file checksums and known-secret-pattern scan, not proof of absence of all sensitive content' }
WriteText (Join-Path $public 'handoff.json') (($metadata | ConvertTo-Json -Depth 6) + "`n")
WriteText (Join-Path $public 'START-HERE.md') @"
# Paused development handoff

Read source/docs/DEVELOPMENT-HANDOFF.md first. This archive is NOT an installer.
Committed baseline: $head on main. source/ is the full current working-source
snapshot, including unshipped Devices/Setup work. history.bundle restores main
and release tags offline. pending-tracked.patch is relative to that baseline;
pending-untracked.json lists additional files present under source/.
Do not mistake the pending browser snapshot for stable2.2.0 release bytes.
No credentials, production state or actual runtime authorization are included.
Build/test commands, chronology, known failures and remaining gates are in the
handoff document. Every included file is covered by file-manifest.json except
that manifest itself. The outer archive checksum is in SHA256SUMS.
"@
$publicZip = Join-Path $Destination 'agent-continue-public-handoff-20261103.zip'
$publicResult = Seal $public $publicZip
$null = [IO.Directory]::CreateDirectory($local)
foreach ($file in Get-ChildItem -LiteralPath $public -File -Recurse) {
    $relative = [IO.Path]::GetRelativePath($public, $file.FullName)
    if ($relative -ne 'file-manifest.json') { CopyChecked $public $relative $local }
}
if ($LegacySourceRoot) {
    foreach ($directory in @($LegacySourceRoot, (Join-Path $LegacySourceRoot 'linux'), (Join-Path $LegacySourceRoot 'extension'))) {
        foreach ($file in Get-ChildItem -LiteralPath $directory -File -ErrorAction Stop) {
            if ($file.Extension -notmatch '^\.(cjs|mjs|js|cs|ps1|py|sh|md|json|conf|in|service|html|css)$' -and $file.Name -ne 'LICENSE') { continue }
            $relative = [IO.Path]::GetRelativePath($LegacySourceRoot, $file.FullName).Replace('\', '/')
            CopyChecked $LegacySourceRoot $relative (Join-Path $local 'LOCAL-ONLY/legacy-private-mcp-source')
        }
    }
}
if ($OfflineAssetDirectory) {
    $pins = Get-Content -LiteralPath (Join-Path $root 'native/desktop-commander/tunnel-pins.json') -Raw | ConvertFrom-Json
    foreach ($pin in $pins.platforms.PSObject.Properties.Value) {
        $file = SafeFile $OfflineAssetDirectory $pin.asset
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pin.archiveSha256) { throw 'handoff_official_asset_hash_mismatch' }
        CopyChecked $OfflineAssetDirectory $pin.asset (Join-Path $local 'LOCAL-ONLY/official-offline-assets')
    }
}
if ($PrivateContextFile) { CopyChecked ([IO.Path]::GetDirectoryName($PrivateContextFile)) ([IO.Path]::GetFileName($PrivateContextFile)) (Join-Path $local 'LOCAL-ONLY') }
WriteText (Join-Path $local 'LOCAL-ONLY/DO-NOT-PUBLISH.md') "Local handoff supplement only. Contains machine paths and private-prototype source. No credentials or live state. Do not upload this full archive to a public repository or issue.`n"
$localZip = Join-Path $Destination 'agent-continue-COMPLETE-LOCAL-handoff-20261103.zip'
$localResult = Seal $local $localZip
WriteText (Join-Path $Destination 'SHA256SUMS') (($publicResult.sha256 + '  ' + $publicResult.file + "`n") + ($localResult.sha256 + '  ' + $localResult.file + "`n"))
$result = [ordered]@{ commit = $head; branch = $branch; public = $publicResult; local = $localResult; productionChanged = $false }
WriteText (Join-Path $Destination 'pack-result.json') (($result | ConvertTo-Json -Depth 6) + "`n")
$result | ConvertTo-Json -Depth 6
