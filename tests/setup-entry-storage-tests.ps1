param([ValidateSet('success', 'existing')][string]$Scenario = 'success')
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
$preexisting = $null
if ($Scenario -eq 'existing') {
    $fixtureBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $preexisting = Join-Path $fixtureBase ('agent-continue-entry-' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($preexisting)
    $assignment = '$dir=[IO.Path]::Combine($base,(''agent-continue-entry-''+[guid]::NewGuid().ToString(''N'')));'
    if (-not $storage.Contains($assignment)) { throw 'storage_fixture_assignment_missing' }
    $storage = $storage.Replace($assignment, ('$dir=''' + $preexisting.Replace("'", "''") + ''';'))
}
$expectedRefusal = $false
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
    $expectedSids = @($user.Value, 'S-1-5-18', 'S-1-5-32-544') | Sort-Object
    $actualRules = $before.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
    if ((@($actualRules.IdentityReference.Value | Sort-Object) -join ',') -cne ($expectedSids -join ',')) {
        throw 'storage_fixture_acl_sids'
    }
    foreach ($rule in $actualRules) {
        if ($rule.IsInherited -or $rule.AccessControlType -ne 'Allow' -or
            $rule.FileSystemRights -ne 'FullControl' -or
            $rule.InheritanceFlags -ne 'ContainerInherit,ObjectInherit' -or
            $rule.PropagationFlags -ne 'None') { throw 'storage_fixture_acl_rules' }
    }
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
} catch {
    if ($Scenario -ne 'existing' -or $_.Exception.Message -cne 'entry_exists') { throw }
    $expectedRefusal = $true
} finally {
    # No recursion: cleanup can remove only this test's file and empty GUID directory.
    if ($created -and $dir -and $base -and [IO.Path]::GetDirectoryName($dir).TrimEnd('\') -ceq $base.TrimEnd('\') -and
        [IO.Path]::GetFileName($dir) -cmatch '^agent-continue-entry-[a-f0-9]{32}$') {
        if ($collisionFile -and [IO.Path]::GetDirectoryName($collisionFile) -ceq $dir) {
            [IO.File]::Delete($collisionFile)
        }
        [IO.Directory]::Delete($dir, $false)
    }
}
if ($Scenario -eq 'existing') {
    try {
        if (-not $expectedRefusal -or -not [IO.Directory]::Exists($preexisting) -or
            [IO.Directory]::GetFileSystemEntries($preexisting).Length -ne 0) {
            throw 'storage_fixture_unowned_directory_removed'
        }
        '{"ok":true,"existingDirectoryRetained":true,"creationRefused":true,"network":false,"entryExecuted":false}'
    } finally {
        if ($preexisting -and [IO.Path]::GetDirectoryName($preexisting).TrimEnd('\') -ceq $fixtureBase.TrimEnd('\') -and
            [IO.Path]::GetFileName($preexisting) -cmatch '^agent-continue-entry-[a-f0-9]{32}$') {
            [IO.Directory]::Delete($preexisting, $false)
        }
    }
    exit 0
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
