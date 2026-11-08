$ErrorActionPreference = 'Stop'
$source = [Console]::In.ReadToEnd()
$begin = $source.IndexOf('$base=[IO.Path]::GetFullPath([IO.Path]::GetTempPath());', [StringComparison]::Ordinal)
$end = $source.IndexOf('$file=[IO.Path]::Combine($dir,''install.ps1'');', [StringComparison]::Ordinal)
if ($begin -lt 0 -or $end -le $begin) { throw 'storage_fixture_source_missing' }
$storage = $source.Substring($begin, $end - $begin)
$dir = $null
$collisionFile = $null
$directoryRefused = $false
$fileRefused = $false
$created = $false
$aclVerified = $false
try {
    # Execute only the local source's directory block, never its download or child launch.
    . ([ScriptBlock]::Create($storage))
    $created = [IO.Directory]::Exists($dir)
    if (-not $created -or [IO.Path]::GetDirectoryName($dir).TrimEnd('\') -cne $base.TrimEnd('\') -or
        [IO.Path]::GetFileName($dir) -cnotmatch '^agent-continue-entry-[a-f0-9]{32}$') {
        throw 'storage_fixture_directory_invalid'
    }
    $before = ([IO.DirectoryInfo]::new($dir)).GetAccessControl()
    $aclVerified = $before.AreAccessRulesProtected -and
        $before.GetOwner([Security.Principal.SecurityIdentifier]).Value -ceq $user.Value -and
        $before.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]).Count -eq 3
    if (-not $aclVerified) { throw 'storage_fixture_acl_invalid' }
    $beforeSddl = $before.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)
    if ([AcEntryDir]::CreateDirectoryW($dir, [IntPtr]::Zero)) { throw 'storage_fixture_directory_replaced' }
    $directoryRefused = [Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 183
    $afterSddl = ([IO.DirectoryInfo]::new($dir)).GetAccessControl().GetSecurityDescriptorSddlForm(
        [Security.AccessControl.AccessControlSections]::All)
    if (-not $directoryRefused -or $beforeSddl -cne $afterSddl) { throw 'storage_fixture_collision_changed_acl' }
    $collisionFile = [IO.Path]::Combine($dir, 'collision.txt')
    [IO.File]::WriteAllText($collisionFile, 'entry-storage-fixture')
    if ([AcEntryDir]::CreateDirectoryW($collisionFile, [IntPtr]::Zero)) { throw 'storage_fixture_file_replaced' }
    $fileRefused = [Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 183
    if (-not $fileRefused -or [IO.File]::ReadAllText($collisionFile) -cne 'entry-storage-fixture') {
        throw 'storage_fixture_collision_changed_file'
    }
} finally {
    # No recursion: cleanup can remove only this test's file and empty GUID directory.
    if ($dir -and $base -and [IO.Path]::GetDirectoryName($dir).TrimEnd('\') -ceq $base.TrimEnd('\') -and
        [IO.Path]::GetFileName($dir) -cmatch '^agent-continue-entry-[a-f0-9]{32}$') {
        if ($collisionFile -and [IO.Path]::GetDirectoryName($collisionFile) -ceq $dir) {
            [IO.File]::Delete($collisionFile)
        }
        [IO.Directory]::Delete($dir, $false)
    }
}
if ([IO.Directory]::Exists($dir)) { throw 'storage_fixture_cleanup_failed' }
[ordered]@{
    ok = $true
    actualDirectoryCreated = $created
    protectedAclVerified = $aclVerified
    existingDirectoryRefused = $directoryRefused
    existingFileRefused = $fileRefused
    cleanupVerified = $true
    network = $false
    entryExecuted = $false
    installedRuntimeTouched = $false
} | ConvertTo-Json -Compress
