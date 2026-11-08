[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$source=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/Stage-WindowsAdministratorBundle.ps1'))
$tokens=$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'parse'}
foreach($name in @('To-Hex','Get-AdministratorControlEndpointRoute','Invoke-AdministratorBrowserControlEndpoint','Get-Layout','Copy-Or-Hash','Verify-SealedBundle')){
    $n=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
    if(-not $n){throw ('missing:'+ $name)}
    . ([scriptblock]::Create($n.Extent.Text))
}
$requiredAssignment=$ast.EndBlock.Statements|Where-Object{$_ -is [Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -ceq '$requiredFiles'}
$requiredFiles=& ([scriptblock]::Create($requiredAssignment.Right.Extent.Text))
$manifestLimit=40000;$entryLimit=192MB;$totalLimit=768MB
$scratch=[IO.Path]::Combine([IO.Path]::GetTempPath(),'ac-entry-audit-'+[Guid]::NewGuid().ToString('N'))
$bundle=Join-Path $scratch 'subject';$archivePath=Join-Path $scratch 'bundle.zip'
$null=[IO.Directory]::CreateDirectory($bundle)
$digest='a'*64;$id='b'*32;$sid='S-1-5-21-1-2-3-1001'
$script:sha=$null
$script:checks=0;$script:cases=0;$script:failures=[Collections.Generic.List[string]]::new()
$script:observedHash=$null;$script:progress=[Collections.Generic.List[object]]::new();$script:tasks=0
function Check([bool]$Value,[string]$Why){if(-not $Value){throw $Why};$script:checks++}
function Case([string]$Name,[scriptblock]$Work){$script:cases++;try{$null=& $Work;[Console]::WriteLine('PASS '+$Name)}catch{$script:failures.Add($Name+': '+$_.Exception.Message);[Console]::WriteLine('FAIL '+$Name+': '+$_.Exception.Message)}}
function Assert-SealedAcl($Path,$Directory){
    $p=[IO.Path]::GetFullPath($Path)
    Check ($p -ceq $script:bundle -or $p.StartsWith($script:bundle+'\',[StringComparison]::Ordinal)) 'scratch_only_acl_stub'
    $attr=[IO.File]::GetAttributes($p)
    Check (-not ($attr -band [IO.FileAttributes]::ReparsePoint) -and [bool]($attr -band [IO.FileAttributes]::Directory) -eq $Directory) 'scratch_type'
}
function Get-AdministratorControlEndpointBinding {
    return @{Root=$script:bundle;Archive=$script:archivePath;Digest=$script:digest;Sid=$script:sid;Origin=('chrome-extension://'+('c'*32)+'/');System='C:\Windows\System32';Plan=@{}}
}
function Assert-AdministratorControlEndpointBinding {return $true}
function Assert-AdministratorOwnerWake {}
function Get-AdministratorControlEndpointTask {
    $t=[pscustomobject]@{TestOnly=$true}
    $t|Add-Member ScriptMethod Run {param($Args);$script:tasks++;return [pscustomobject]@{TestOnly=$true}}
    return $t
}
function New-AdministratorLaunchPlan {return [Diagnostics.ProcessStartInfo]::new('never-started')}
function Invoke-AdministratorOwnerConnectCheck {}
function Assert-AdministratorBrowserTask {}
function Invoke-AdministratorControlKernelOperation {
    param($Archive,$CompilerTemp,$BundleRoot,$Digest,$Origin,$Id,$Control,$Mode,$Target,$CallerPid,$CallerStarted,$SessionId,$Sid,$VerifyBinding,$Audit,$CheckStartup,$RequestTask)
    Check ($Archive.CanRead -and -not $Archive.CanWrite) 'held_archive'
    $script:observedHash=$sha
    $null=& $Audit {param($Done,$Total);$script:progress.Add(@{Done=$Done;Total=$Total})}
    Check ($null -ne $script:observedHash -and $script:observedHash -is [Security.Cryptography.HashAlgorithm]) 'entry_owns_hash_for_real_audit'
    Check ((& $VerifyBinding) -eq $true -and (& $CheckStartup) -eq $true -and (& $RequestTask) -eq $true) 'effects_only_after_real_audit'
    return @{operationId=$Id;state='launch-requested'}
}
function Invoke-AuditEntry {
    return Invoke-AdministratorBrowserControlEndpoint 'ConnectBrowserHostedOwner' $archivePath $digest 'virtual-stager' $id 'connect' (('d'*32)+':idle') 500 '639295999999999999' 1 $sid 'C:\Program Files' 'C:\Windows\System32'
}
$null=[Reflection.Assembly]::Load('System.IO.Compression, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089')
$zip=$null;$file=$null
try{
    $file=[IO.File]::Open($archivePath,'CreateNew','ReadWrite','None')
    $zip=[IO.Compression.ZipArchive]::new($file,[IO.Compression.ZipArchiveMode]::Create,$true)
    foreach($name in $requiredFiles){
        $bytes=[Text.Encoding]::UTF8.GetBytes('test-only:'+ $name)
        $entry=$zip.CreateEntry($name);$out=$entry.Open()
        try{$out.Write($bytes,0,$bytes.Length)}finally{$out.Dispose()}
        $path=Join-Path $bundle $name;$null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path));[IO.File]::WriteAllBytes($path,$bytes)
    }
    $zip.Dispose();$zip=$null;$file.Dispose();$file=$null
    Case 'real complete verifier hashes all required files without legacy SHA initialization'{
        Check ($null -eq $script:sha) 'legacy_hash_absent'
        $r=Invoke-AuditEntry
        Check ($r.state -ceq 'launch-requested' -and $tasks -eq 1) 'real_audit_before_one_task'
        Check ($progress.Count -eq 2 -and $progress[0].Done -eq 0 -and $progress[1].Done -eq $requiredFiles.Count) 'complete_progress'
        Check ($null -eq $script:sha) 'legacy_global_not_assigned'
        $disposed=$false;try{$null=$observedHash.ComputeHash([byte[]]@(1))}catch [ObjectDisposedException]{$disposed=$true}
        Check $disposed 'owned_hash_disposed'
    }
    Case 'real same-length tamper is refused before task'{
        $path=Join-Path $bundle $requiredFiles[0];$before=[IO.File]::ReadAllBytes($path);$changed=$before.Clone();$changed[0]=$changed[0] -bxor 1
        [IO.File]::WriteAllBytes($path,$changed);$script:tasks=0;$refused=$false
        try{$null=Invoke-AuditEntry}catch{$refused=$_.Exception.Message -ceq 'bundle_content'}finally{[IO.File]::WriteAllBytes($path,$before)}
        Check ($refused -and $tasks -eq 0) 'real_hash_tamper_refused'
    }
    Case 'real closure check refuses extra installed file before task'{
        $path=Join-Path $bundle 'extra.txt';[IO.File]::WriteAllText($path,'fixture');$script:tasks=0;$refused=$false
        try{$null=Invoke-AuditEntry}catch{$refused=$_.Exception.Message -ceq 'bundle_closure'}finally{[IO.File]::Delete($path)}
        Check ($refused -and $tasks -eq 0) 'real_closure_refused'
    }
}finally{
    if($zip){$zip.Dispose()};if($file){$file.Dispose()}
    $full=[IO.Path]::GetFullPath($scratch)
    if(-not $full.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($full) -cnotmatch '\Aac-entry-audit-[a-f0-9]{32}\z'){throw 'cleanup_scope'}
    if(Test-Path -LiteralPath $full){Remove-Item -LiteralPath $full -Recurse -Force}
}
ConvertTo-Json -Compress -Depth 4 ([ordered]@{ok=($failures.Count -eq 0);cases=$cases;checks=$checks;failures=$failures.ToArray();
    scope='real-zip-layout-full-verifier-and-hash-with-scratch-acl-and-kernel-owner-task-stubs';
    realFullVerifier=$true;legacyHashAbsent=$true;actualUac=$false;protectedAcceptance=$false;
    stagerSha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()})
if($failures.Count){exit 1}
