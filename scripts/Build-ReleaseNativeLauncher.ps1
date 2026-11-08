# Maintainer release builder; default is read-only. Never runs the generated PE.
[CmdletBinding()]
param(
    [string]$NodePath = '',
    [string]$ExpectedNodeSha256 = '',
    [string]$Version = '',
    [string]$OutputPath = '',
    [string]$Consent = '',
    [switch]$Compile
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$provider = $null; $temporary = $null; $compiled = $null
$code = 'release_launcher_build_failed'
$exitCode = 0; $artifactVerified = $false

function Clear-ReleaseTemporaries($Provider, [string]$Compiled, $Temporary) {
    $complete = $true
    try { if ($null -ne $Provider) { $null = $Provider.Dispose() } } catch { $complete = $false }
    try { if ($Compiled -and [IO.File]::Exists($Compiled)) { [IO.File]::Delete($Compiled) } } catch { $complete = $false }
    try { if ($null -ne $Temporary) { $null = $Temporary.Delete() } } catch { $complete = $false }
    return $complete
}

function Read-ReleaseSource([string]$Path) {
    if ($Path -cnotmatch '\A[A-Za-z]:\\' -or $Path.Substring(2).Contains(':') -or
        [IO.Path]::GetFullPath($Path) -cne $Path) { throw 'release_launcher_input_invalid' }
    $drive = New-Object IO.DriveInfo([IO.Path]::GetPathRoot($Path))
    if ($drive.DriveType -ne [IO.DriveType]::Fixed) { throw 'release_launcher_input_invalid' }
    $item = Get-Item -LiteralPath $Path -Force
    if ($item -isnot [IO.FileInfo] -or $item.Length -lt 1 -or $item.Length -gt 536870912) { throw 'release_launcher_input_invalid' }
    for ($cursor=$item; $null -ne $cursor;) {
        if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'release_launcher_input_invalid' }
        if ($cursor -is [IO.FileInfo]) { $cursor=$cursor.Directory } else { $cursor=$cursor.Parent }
    }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

try {
    if ($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion -lt [version]'5.1') { throw 'release_launcher_input_invalid' }
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
    if ($Compile -and $Consent -cne 'accept-build') { throw 'release_launcher_consent_required' }
    if ($ExpectedNodeSha256 -cnotmatch '\A[a-f0-9]{64}\z' -or $Version -cnotmatch '\A(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\z') { throw 'release_launcher_input_invalid' }
    if (-not [IO.Path]::IsPathRooted($NodePath) -or [IO.Path]::GetFileName($NodePath) -cne 'node.exe' -or
        (Read-ReleaseSource $NodePath) -cne $ExpectedNodeSha256) { throw 'release_launcher_input_invalid' }
    $root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $bootstrap = Join-Path $root 'native\bootstrap'
    $sourceFiles = @((Join-Path $bootstrap 'NativeLauncher.cs'), (Join-Path $bootstrap 'ReleaseLauncherBinding.cs'))
    $manifestPath = Join-Path $bootstrap 'payload-manifest.json'
    $snapshots = @($sourceFiles + @($manifestPath, $NodePath)) | ForEach-Object {
        @{Path=$_;Sha256=(Read-ReleaseSource $_)}
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.format -cne 'agent-continue-payload' -or $manifest.version -ne 1 -or @($manifest.files).Count -ne 17) { throw 'release_launcher_input_invalid' }
    $names = @(); $digests = @()
    foreach ($entry in $manifest.files) {
        $name = $entry.path
        if ($name -isnot [string] -or $name -cnotmatch '\A[a-z0-9-]+\.(mjs|json|cs)\z' -or $name -in $names -or
            $entry.sha256 -cnotmatch '\A[a-f0-9]{64}\z') { throw 'release_launcher_input_invalid' }
        $file = Join-Path (Join-Path $bootstrap 'payload') $name
        if ((Read-ReleaseSource $file) -cne $entry.sha256) { throw 'release_launcher_input_invalid' }
        $snapshots += @{Path=$file;Sha256=$entry.sha256}
        $names += $name; $digests += $entry.sha256
    }
    if ('device-native-host.mjs' -cnotin $names) { throw 'release_launcher_input_invalid' }
    if (-not $Compile) {
        $result = [ordered]@{ok=$true;mode='plan';version=$Version;runtimePins=$names.Count
            nodeSha256=$ExpectedNodeSha256;perInstallPathsEmbedded=$false;artifactCreated=$false
            signed=$false;classificationVerified=$false;runtimeVerified=$false}
    } else {
        if ($OutputPath -cnotmatch '\A[A-Za-z]:\\' -or [IO.Path]::GetFullPath($OutputPath) -cne $OutputPath -or
            $OutputPath.Substring(2).Contains(':') -or [IO.Path]::GetExtension($OutputPath) -cne '.exe' -or
            [IO.Path]::GetFileName($OutputPath) -match '^(?i:CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3]|CONIN\$|CONOUT\$)(?:\.|$)' -or
            (Test-Path -LiteralPath $OutputPath)) { throw 'release_launcher_input_invalid' }
        $outputDrive = New-Object IO.DriveInfo([IO.Path]::GetPathRoot($OutputPath))
        if ($outputDrive.DriveType -ne [IO.DriveType]::Fixed) { throw 'release_launcher_input_invalid' }
        $parent = Get-Item -LiteralPath ([IO.Path]::GetDirectoryName($OutputPath)) -Force
        if ($parent -isnot [IO.DirectoryInfo]) { throw 'release_launcher_input_invalid' }
        for ($cursor=$parent; $null -ne $cursor; $cursor=$cursor.Parent) {
            if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'release_launcher_input_invalid' }
        }
        Add-Type -AssemblyName Microsoft.CSharp
        $provider = New-Object Microsoft.CSharp.CSharpCodeProvider
        $unit = New-Object CodeDom.CodeCompileUnit
        $namespace = New-Object CodeDom.CodeNamespace
        $pins = New-Object CodeDom.CodeTypeDeclaration('NativeLauncherReleasePins')
        $pins.TypeAttributes = [Reflection.TypeAttributes]::NotPublic -bor [Reflection.TypeAttributes]::Sealed
        foreach ($pair in @(@{Name='Names';Values=$names},@{Name='Digests';Values=$digests})) {
            $field = New-Object CodeDom.CodeMemberField([string[]], $pair.Name)
            $field.Attributes = [CodeDom.MemberAttributes]::Assembly -bor [CodeDom.MemberAttributes]::Static
            $items = @($pair.Values | ForEach-Object { New-Object CodeDom.CodePrimitiveExpression($_) })
            $field.InitExpression = New-Object CodeDom.CodeArrayCreateExpression([string], [CodeDom.CodeExpression[]]$items)
            $null = $pins.Members.Add($field)
        }
        $field = New-Object CodeDom.CodeMemberField([string], 'NodeSha256')
        $field.Attributes = [CodeDom.MemberAttributes]::Assembly -bor [CodeDom.MemberAttributes]::Const
        $field.InitExpression = New-Object CodeDom.CodePrimitiveExpression($ExpectedNodeSha256)
        $null = $pins.Members.Add($field); $null = $namespace.Types.Add($pins); $null = $unit.Namespaces.Add($namespace)
        foreach ($pair in @(@{Type=[Reflection.AssemblyProductAttribute];Value='Agent Continue'},
            @{Type=[Reflection.AssemblyVersionAttribute];Value=($Version+'.0')},
            @{Type=[Reflection.AssemblyFileVersionAttribute];Value=($Version+'.0')})) {
            $attribute = New-Object CodeDom.CodeAttributeDeclaration($pair.Type.FullName)
            $argument = New-Object CodeDom.CodeAttributeArgument((New-Object CodeDom.CodePrimitiveExpression($pair.Value)))
            $null = $attribute.Arguments.Add($argument); $null = $unit.AssemblyCustomAttributes.Add($attribute)
        }
        $writer = New-Object IO.StringWriter([Globalization.CultureInfo]::InvariantCulture)
        try { $provider.GenerateCodeFromCompileUnit($unit,$writer,(New-Object CodeDom.Compiler.CodeGeneratorOptions)); $pinSource=$writer.ToString() }
        finally { $writer.Dispose() }
        $temporary = New-Object CodeDom.Compiler.TempFileCollection([IO.Path]::GetTempPath(),$false)
        $compiled = $temporary.AddExtension('exe',$true)
        $options = New-Object CodeDom.Compiler.CompilerParameters
        $options.GenerateExecutable=$true; $options.GenerateInMemory=$false; $options.TreatWarningsAsErrors=$true
        $options.IncludeDebugInformation=$false; $options.CompilerOptions='/target:winexe /optimize+ /debug- /platform:anycpu'
        $options.TempFiles=$temporary; $options.OutputAssembly=$compiled
        foreach ($assembly in @('System.dll','System.Core.dll','System.Xml.dll','System.Xml.Linq.dll','System.Runtime.Serialization.dll')) { $null=$options.ReferencedAssemblies.Add($assembly) }
        $sources = @($sourceFiles | ForEach-Object { [IO.File]::ReadAllText($_,(New-Object Text.UTF8Encoding($false,$true))) }) + @($pinSource)
        $built = $provider.CompileAssemblyFromSource($options,[string[]]$sources)
        if ($built.NativeCompilerReturnValue -ne 0 -or $built.Errors.HasWarnings -or $built.Errors.HasErrors) { throw 'release_launcher_build_failed' }
        foreach ($snapshot in $snapshots) { if ((Read-ReleaseSource $snapshot.Path) -cne $snapshot.Sha256) { throw 'release_launcher_input_invalid' } }
        $compiledHash = Read-ReleaseSource $compiled
        [IO.File]::Copy($compiled,$OutputPath,$false)
        if ((Read-ReleaseSource $OutputPath) -cne $compiledHash) { throw 'release_launcher_build_failed' }
        $artifactVerified = $true
        $result = [ordered]@{ok=$true;mode='unsigned-build';version=$Version;runtimePins=$names.Count
            nodeSha256=$ExpectedNodeSha256;launcherSha256=$compiledHash;perInstallPathsEmbedded=$false
            artifactCreated=$true;signed=$false;classificationVerified=$false;runtimeVerified=$false}
    }
} catch {
    if ($_.Exception.Message -cin @('release_launcher_input_invalid','release_launcher_consent_required')) { $code=$_.Exception.Message }
    $result = @{ok=$false;error=$code;failureLine=$_.InvocationInfo.ScriptLineNumber
        classificationVerified=$false;runtimeVerified=$false}
    $exitCode = 1
} finally {
    $cleanupComplete = Clear-ReleaseTemporaries $provider $compiled $temporary
}
if (-not $cleanupComplete) {
    $result = @{ok=$false;error='release_launcher_cleanup_failed';artifactVerified=$artifactVerified
        classificationVerified=$false;runtimeVerified=$false}
    $exitCode = 1
}
$result['cleanupComplete'] = $cleanupComplete
[Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
if ($exitCode -ne 0) { exit $exitCode }
