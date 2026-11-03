$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP -or -not $env:GITHUB_ENV) {
    throw 'This downloader is for disposable GitHub-hosted CI only.'
}
if (-not $IsLinux -or [Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -ne 'X64') {
    throw 'This CI fixture currently supports Linux x64 only.'
}
$pins = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../tunnel-pins.json') -Raw | ConvertFrom-Json
$pin = $pins.platforms.'linux-x64'
if ($pins.release -ne 'v0.0.19' -or $pin.asset -ne 'tunnel-client-runtime-v0.0.19-linux-amd64.zip') {
    throw 'Unexpected CI release input.'
}
$root = Join-Path ([IO.Path]::GetFullPath($env:RUNNER_TEMP)) ('agentcontinue-tunnel-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $root
$zipPath = Join-Path $root 'release.zip'
Invoke-WebRequest -Uri ('https://github.com/openai/tunnel-client/releases/download/v0.0.19/' + $pin.asset) -OutFile $zipPath
if ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pin.archiveSha256) {
    throw 'CI archive digest mismatch.'
}
$zip = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $entries = @($zip.Entries | Where-Object FullName -eq 'tunnel-client-runtime')
    if ($entries.Count -ne 1 -or $entries[0].Length -lt 1 -or $entries[0].Length -gt 134217728) {
        throw 'Unexpected CI executable entry.'
    }
    $type = ($entries[0].ExternalAttributes -shr 16) -band 0xF000
    if ($type -ne 0 -and $type -ne 0x8000) { throw 'CI executable is not a regular archive entry.' }
    $exe = Join-Path $root 'tunnel-client-runtime'
    $entryStream = $entries[0].Open()
    $fileStream = [IO.File]::Open($exe, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $entryStream.CopyTo($fileStream) } finally { $entryStream.Dispose(); $fileStream.Dispose() }
} finally { $zip.Dispose() }
if ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pin.executableSha256) {
    throw 'CI executable digest mismatch.'
}
[IO.File]::SetUnixFileMode($exe, [IO.UnixFileMode]::UserRead -bor [IO.UnixFileMode]::UserWrite -bor [IO.UnixFileMode]::UserExecute)
Add-Content -LiteralPath $env:GITHUB_ENV -Value ('TUNNEL_CLIENT_TEST_EXE=' + $exe)
Write-Output 'Pinned official CI executable verified; no runtime started.'
