# Framework parser compatibility only. No launcher compilation or execution.
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -cne 'Desktop') { throw 'desktop_powershell_required' }
Add-Type -AssemblyName System.Runtime.Serialization
Add-Type -AssemblyName System.Xml.Linq

function Read-StrictJson([byte[]]$Bytes) {
    $utf8 = New-Object Text.UTF8Encoding($false,$true)
    $null = $utf8.GetString($Bytes)
    $quotas = New-Object Xml.XmlDictionaryReaderQuotas
    $quotas.MaxDepth=8; $quotas.MaxStringContentLength=16384
    $quotas.MaxArrayLength=16384; $quotas.MaxBytesPerRead=16384; $quotas.MaxNameTableCharCount=16384
    $reader = [Runtime.Serialization.Json.JsonReaderWriterFactory]::CreateJsonReader(
        $Bytes,0,$Bytes.Length,$utf8,$quotas,$null)
    try { return [Xml.Linq.XElement]::Load($reader) } finally { $reader.Dispose() }
}

$text = '{"value":"' + [char]0x4e2d + '"}'
$value = Read-StrictJson ([Text.Encoding]::UTF8.GetBytes($text))
if ($value.Element('value').Value -cne [string][char]0x4e2d) { throw 'utf8_roundtrip_failed' }
$rejected=0
foreach ($bytes in @(
    [Text.Encoding]::Unicode.GetBytes($text),
    [Text.Encoding]::BigEndianUnicode.GetBytes($text),
    [byte[]]@(123,34,118,97,108,117,101,34,58,34,195,40,34,125)
)) {
    $failed=$false
    try { $null=Read-StrictJson $bytes } catch { $failed=$true }
    if (-not $failed) { throw 'non_utf8_input_accepted' }
    $rejected++
}
if ($rejected -ne 3) { throw 'missing_encoding_case' }
[Console]::Out.WriteLine('{"ok":true,"utf8Accepted":true,"utf16Rejected":true,"malformedUtf8Rejected":true,"launcherCompiled":false,"launcherExecuted":false}')
