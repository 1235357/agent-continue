# Source-only preparation. No registration, elevation, owner start or activation.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [Parameter(Mandatory = $true)][string]$ManifestPath,
    [Parameter(Mandatory = $true)][string]$NodePath,
    [Parameter(Mandatory = $true)][string]$HostScriptPath,
    [Parameter(Mandatory = $true)][string]$ExtensionId
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$provider = $null
$temporaryFiles = $null
$compiledPath = $null
$receipt = $null
$failed = $false

function Assert-LocalPath([string]$Value, [bool]$Existing) {
    if ([string]::IsNullOrEmpty($Value) -or $Value.Length -lt 4 -or $Value.Length -ge 260 -or
        $Value -cnotmatch '\A[A-Za-z]:\\' -or $Value.Contains('/') -or
        $Value.Substring(2).Contains(':') -or [IO.Path]::GetFullPath($Value) -cne $Value) { throw 'invalid_path' }
    foreach ($part in $Value.Substring(3).Split([char]'\')) {
        if ($part.Length -eq 0 -or $part -eq '.' -or $part -eq '..' -or $part.EndsWith('.') -or
            $part.EndsWith(' ') -or $part.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 -or
            $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3]|CONIN\$|CONOUT\$)(?:\.|$)') { throw 'invalid_path' }
    }
    $drive = New-Object IO.DriveInfo([IO.Path]::GetPathRoot($Value))
    if ($drive.DriveType -ne [IO.DriveType]::Fixed) { throw 'invalid_path' }
    if ($Existing) {
        $item = Get-Item -LiteralPath $Value -Force
        if ($item -isnot [IO.FileInfo]) { throw 'invalid_file' }
    } else {
        if (Test-Path -LiteralPath $Value) { throw 'output_exists' }
        $item = Get-Item -LiteralPath ([IO.Path]::GetDirectoryName($Value)) -Force
        if ($item -isnot [IO.DirectoryInfo]) { throw 'invalid_parent' }
    }
    while ($null -ne $item) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'redirected_path' }
        if ($item -is [IO.FileInfo]) { $item = $item.Directory } else { $item = $item.Parent }
    }
}

function Get-SHA256([string]$Value) {
    $hash = (Get-FileHash -LiteralPath $Value -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -cnotmatch '\A[a-f0-9]{64}\z') { throw 'hash_failed' }
    return $hash
}

function Assert-GuiPE([string]$Value) {
    $bytes = [IO.File]::ReadAllBytes($Value)
    if ($bytes.Length -lt 64 -or $bytes[0] -ne 0x4d -or $bytes[1] -ne 0x5a) { throw 'invalid_pe' }
    $offset = [BitConverter]::ToInt32($bytes, 0x3c)
    if ($offset -lt 64 -or $offset -gt $bytes.Length - 94 -or
        [BitConverter]::ToUInt32($bytes, $offset) -ne 0x4550 -or
        [BitConverter]::ToUInt16($bytes, $offset + 24 + 68) -ne 2) { throw 'invalid_pe' }
}

function Assert-InputsUnchanged {
    foreach ($record in $snapshots) {
        Assert-LocalPath $record.Path $true
        if ((Get-SHA256 $record.Path) -cne $record.Hash) { throw 'input_changed' }
    }
}

try {
    if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion -lt [version]'5.1') { throw 'unsupported_powershell' }
    Assert-LocalPath $OutputPath $false
    Assert-LocalPath $ManifestPath $false
    Assert-LocalPath $NodePath $true
    Assert-LocalPath $HostScriptPath $true
    $sourcePath = [IO.Path]::Combine($PSScriptRoot, 'NativeLauncher.cs')
    Assert-LocalPath $sourcePath $true
    if ([IO.Path]::GetExtension($OutputPath) -ine '.exe' -or
        [IO.Path]::GetExtension($ManifestPath) -ine '.json' -or
        [IO.Path]::GetFileName($NodePath) -ine 'node.exe' -or
        [IO.Path]::GetFileName($HostScriptPath) -cne 'device-native-host.mjs' -or
        $ExtensionId -cnotmatch '\A[a-p]{32}\z') { throw 'invalid_input' }
    $snapshots = @($NodePath, $HostScriptPath, $sourcePath) | ForEach-Object {
        @{ Path = $_; Hash = (Get-SHA256 $_) }
    }
    $origin = 'chrome-extension://' + $ExtensionId + '/'
    $source = [IO.File]::ReadAllText($sourcePath, (New-Object Text.UTF8Encoding($false, $true)))
    Assert-InputsUnchanged

    Add-Type -AssemblyName Microsoft.CSharp
    $provider = New-Object Microsoft.CSharp.CSharpCodeProvider
    # Intermediate compiler artifacts never become workspace deliverables.
    $temporaryFiles = New-Object CodeDom.Compiler.TempFileCollection([IO.Path]::GetTempPath(), $false)
    $unit = New-Object CodeDom.CodeCompileUnit
    $namespace = New-Object CodeDom.CodeNamespace
    $binding = New-Object CodeDom.CodeTypeDeclaration('NativeLauncherBinding')
    $binding.TypeAttributes = [Reflection.TypeAttributes]::NotPublic -bor [Reflection.TypeAttributes]::Sealed
    foreach ($entry in @(
        @{ Name = 'NodePath'; Value = $NodePath },
        @{ Name = 'HostScriptPath'; Value = $HostScriptPath },
        @{ Name = 'Origin'; Value = $origin }
    )) {
        $field = New-Object CodeDom.CodeMemberField([string], $entry.Name)
        $field.Attributes = [CodeDom.MemberAttributes]::Assembly -bor [CodeDom.MemberAttributes]::Const
        $field.InitExpression = New-Object CodeDom.CodePrimitiveExpression($entry.Value)
        $null = $binding.Members.Add($field)
    }
    $null = $namespace.Types.Add($binding)
    $null = $unit.Namespaces.Add($namespace)
    $writer = New-Object IO.StringWriter([Globalization.CultureInfo]::InvariantCulture)
    try {
        $provider.GenerateCodeFromCompileUnit($unit, $writer, (New-Object CodeDom.Compiler.CodeGeneratorOptions))
        $bindingSource = $writer.ToString()
    } finally { $writer.Dispose() }

    $parameters = New-Object CodeDom.Compiler.CompilerParameters
    $parameters.GenerateExecutable = $true
    $parameters.GenerateInMemory = $false
    $parameters.IncludeDebugInformation = $false
    $parameters.TreatWarningsAsErrors = $true
    $parameters.CompilerOptions = '/target:winexe /optimize+ /debug- /platform:anycpu'
    $parameters.TempFiles = $temporaryFiles
    $compiledPath = $temporaryFiles.AddExtension('exe', $true)
    $parameters.OutputAssembly = $compiledPath
    $null = $parameters.ReferencedAssemblies.Add('System.dll')
    $null = $parameters.ReferencedAssemblies.Add('System.Core.dll')
    $result = $provider.CompileAssemblyFromSource($parameters, [string[]]@($source, $bindingSource))
    if ($result.NativeCompilerReturnValue -ne 0 -or $result.Errors.HasErrors -or $result.Errors.HasWarnings) { throw 'compilation_failed' }
    Assert-LocalPath $compiledPath $true
    Assert-GuiPE $compiledPath
    $compiledHash = Get-SHA256 $compiledPath
    Assert-InputsUnchanged
    Assert-LocalPath $OutputPath $false
    Assert-LocalPath $ManifestPath $false
    # File.Copy(overwrite:false) also supports a distinct output volume.
    [IO.File]::Copy($compiledPath, $OutputPath, $false)
    Assert-LocalPath $OutputPath $true
    Assert-GuiPE $OutputPath
    if ((Get-SHA256 $OutputPath) -cne $compiledHash) { throw 'launcher_readback_failed' }

    # This implementation produces a GUI PE; it is not a Chrome requirement.
    # Chromium launch_context_win.cc also supports non-EXE hosts via CMD.
    # Node execFile behavior does not establish Chrome host compatibility.
    # Signing establishes publisher/integrity, not Defender clearance; keep
    # generated executable acceptance blocked pending security classification.
    $manifest = [ordered]@{
        name = 'com.agentcontinue.device_control'
        description = 'Agent Continue device lifecycle bridge'
        path = $OutputPath
        type = 'stdio'
        allowed_origins = @($origin)
    }
    $encoding = New-Object Text.UTF8Encoding($false, $true)
    $manifestBytes = $encoding.GetBytes(($manifest | ConvertTo-Json -Depth 3 -Compress) + "`n")
    Assert-LocalPath $ManifestPath $false
    $stream = [IO.File]::Open($ManifestPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($manifestBytes, 0, $manifestBytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    Assert-LocalPath $ManifestPath $true
    $readback = [IO.File]::ReadAllBytes($ManifestPath)
    if ([Convert]::ToBase64String($readback) -cne [Convert]::ToBase64String($manifestBytes)) { throw 'manifest_readback_failed' }
    Assert-InputsUnchanged
    Assert-LocalPath $OutputPath $true
    Assert-GuiPE $OutputPath
    if ((Get-SHA256 $OutputPath) -cne $compiledHash) { throw 'launcher_readback_failed' }
    $receipt = [ordered]@{
        ok = $true
        format = 'agent-continue-native-launcher'
        version = 1
        status = 'prepared'
        nativeHost = 'com.agentcontinue.device_control'
        extensionId = $ExtensionId
        launcherSha256 = $compiledHash
        manifestSha256 = (Get-SHA256 $ManifestPath)
        nodeSha256 = $snapshots[0].Hash
        hostScriptSha256 = $snapshots[1].Hash
        sourceSha256 = $snapshots[2].Hash
        registered = $false
        activated = $false
        protectedInstallationVerified = $false
    }
} catch {
    $failed = $true
} finally {
    try {
        if ($null -ne $compiledPath -and [IO.File]::Exists($compiledPath)) { [IO.File]::Delete($compiledPath) }
        if ($null -ne $temporaryFiles) { $temporaryFiles.Delete() }
        if ($null -ne $provider) { $provider.Dispose() }
    } catch { $failed = $true }
}
# Partial output is diagnostic evidence, never an invitation to overwrite or repair.
if ($failed -or $null -eq $receipt) {
    [Console]::Out.Write("{`"ok`":false,`"error`":`"native_launcher_build_failed`"}`n")
    exit 1
}
[Console]::Out.Write(($receipt | ConvertTo-Json -Depth 3 -Compress) + "`n")
exit 0
