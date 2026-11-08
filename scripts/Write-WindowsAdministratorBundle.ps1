[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateSet('Node','Zip')][string]$Action,
    [Parameter(Mandatory=$true)][string]$Source,
    [Parameter(Mandatory=$true)][string]$Destination,
    [Parameter(Mandatory=$true)][string]$Reference
)

# Internal build helper. No code from an input ZIP is executed.
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
$null = [Reflection.Assembly]::Load('System.IO.Compression, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089')
$file = $zip = $null
try {
    if ($Action -eq 'Node') {
        if ($Reference -cne 'node-v22.23.4-win-x64') { throw 'invalid_node_archive' }
        $file = [IO.File]::Open($Source,'Open','Read','Read')
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $hash = [BitConverter]::ToString($sha.ComputeHash($file)).Replace('-','').ToLowerInvariant() }
        finally { $sha.Dispose() }
        if ($hash -cne 'cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20') { throw 'invalid_node_archive' }
        $file.Position = 0
        $zip = [IO.Compression.ZipArchive]::new($file,[IO.Compression.ZipArchiveMode]::Read,$true)
        $entries = @{'node.exe'=192MB; 'LICENSE'=2MB}
        foreach ($name in @('node.exe','LICENSE')) {
            $entry = $zip.GetEntry($Reference + '/' + $name)
            if ($null -eq $entry -or $entry.Length -le 0 -or $entry.Length -gt $entries[$name]) { throw 'invalid_node_archive' }
            $from = $entry.Open()
            $to = $null
            try {
                $to = [IO.File]::Open([IO.Path]::Combine($Destination,$name),'CreateNew','Write','None')
                $from.CopyTo($to)
                $to.Flush($true)
                if ($to.Length -ne $entry.Length) { throw 'invalid_node_archive' }
            } finally { $from.Dispose(); if ($null -ne $to) { $to.Dispose() } }
        }
    } else {
        $names = [IO.File]::ReadAllLines($Reference)
        if ($names.Length -eq 0 -or $names.Length -gt 40000) { throw 'invalid_inventory' }
        $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        $file = [IO.File]::Open($Destination,'CreateNew','Write','None')
        $zip = [IO.Compression.ZipArchive]::new($file,[IO.Compression.ZipArchiveMode]::Create,$true)
        foreach ($name in $names) {
            if ($name -cnotmatch '\A(?:app/[a-zA-Z0-9@_.+/-]+|runtime/node\.exe|client/tunnel-client-runtime\.exe)\z' -or
                $name -match '(?:\A|/)\.{0,2}(?:/|\z)' -or -not $seen.Add($name)) { throw 'invalid_inventory' }
            $inputFile = [IO.Path]::Combine($Source,$name.Replace('/','\'))
            if ([IO.File]::GetAttributes($inputFile) -band ([IO.FileAttributes]::ReparsePoint -bor [IO.FileAttributes]::Directory)) {
                throw 'invalid_inventory'
            }
            $entry = $zip.CreateEntry($name,[IO.Compression.CompressionLevel]::Fastest)
            $entry.LastWriteTime = [DateTimeOffset]::new(2000,1,1,0,0,0,[TimeSpan]::Zero)
            $from = [IO.File]::Open($inputFile,'Open','Read','Read')
            $to = $null
            try { $to = $entry.Open(); $from.CopyTo($to) } finally { $from.Dispose(); if ($null -ne $to) { $to.Dispose() } }
        }
    }
} finally {
    if ($null -ne $zip) { $zip.Dispose() }
    if ($null -ne $file) { $file.Dispose() }
}
