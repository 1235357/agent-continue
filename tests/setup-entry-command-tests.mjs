import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as entry from '../setup-entry.js';

const extensionId = 'hjnopijiekcbgiljjfiekeiepkebhido';
const setupId = 'a'.repeat(32);
const version = '3.0.0';
const metadata = Object.freeze({ format: 'agent-continue-windows-setup-entry', version: 1,
  releaseTag: 'v3.0.0', entryUrl: 'https://github.com/1235357/agent-continue/releases/download/v3.0.0/install.ps1',
  entrySha256: 'b'.repeat(64), sumsSha256: 'c'.repeat(64) });
const build = (extra = {}) => entry.buildWindowsSetupCommand({ extensionId, setupId,
  scope: 'administrator', shell: 'browserPowerShell', version, entryMetadata: metadata, ...extra });

test('a release command needs an exact validated version-bound entry descriptor', () => {
  assert.equal(typeof entry.buildWindowsSetupCommand, 'function');
  for (const entryMetadata of [null, {}, { ...metadata, extra: true }, { ...metadata, version: 2 },
    { ...metadata, entrySha256: 'B'.repeat(64) }, { ...metadata, releaseTag: 'v3.0.1' },
    { ...metadata, entryUrl: metadata.entryUrl + '?x=1' },
    { ...metadata, entryUrl: metadata.entryUrl.replace('v3.0.0', 'latest') },
    { ...metadata, entryUrl: metadata.entryUrl.replace('1235357', 'other') }]) {
    assert.equal(build({ entryMetadata }), '');
  }
  for (const extra of [{ version: '3.0.1' }, { extensionId: '*' }, { setupId: '' },
    { scope: 'root' }, { shell: 'bash' }, { mode: 'unknown' }]) assert.equal(build(extra), '');
});

test('both shells and scopes preserve identity and fit the complete CMD transport limit', () => {
  for (const scope of ['administrator', 'current-account']) {
    for (const shell of ['browserPowerShell', 'browserCmd']) {
      const command = build({ scope, shell });
      assert.ok(command.length > 500);
      assert.ok(command.length < 8191, `${shell}: ${command.length}`);
      assert.ok(command.includes(extensionId));
      assert.ok(command.includes(setupId));
      assert.ok(command.includes(metadata.entrySha256));
      assert.ok(command.includes(metadata.sumsSha256));
      assert.doesNotMatch(command, /EncodedCommand|ExecutionPolicy|Invoke-Expression|\biex\b|NonInteractive/);
      assert.ok(command.includes('-NoProfile'));
      assert.ok(command.includes('-ExpectedSumsSha256'));
      assert.ok(command.includes(scope === 'administrator' ? '-Administrator' : '-BrowserManaged'));
    }
  }
});

test('local fallback is explicit and never silently replaces release acquisition', () => {
  assert.equal(build({ entryMetadata: null }), '');
  assert.match(build({ mode: 'local', entryMetadata: null }), /^\.\\install\.ps1 -Administrator/);
  assert.match(build({ mode: 'local', scope: 'current-account', entryMetadata: null }), /^\.\\install\.ps1 -InstallLocal -BrowserManaged/);
  assert.match(build({ mode: 'local', shell: 'browserCmd', entryMetadata: null }), /^install\.cmd guided-administrator/);
});

test('remote bootstrap has finite entry acquisition, restrictive storage and verified separate child', () => {
  const source = entry.windowsEntryBootstrapSource({ extensionId, setupId, scope: 'administrator', metadata });
  for (const marker of ['90000', '4194304', 'AllowAutoRedirect=$false', 'release-assets.githubusercontent.com',
    'objects.githubusercontent.com', 'ReadTimeout', 'SetAccessRuleProtection', 'CreateNew', 'ReadBytes',
    'ComputeHash', 'acReleaseTag', 'FileShare]::Read', '-File $file', '$LASTEXITCODE']) assert.ok(source.includes(marker), marker);
  assert.ok(source.indexOf('ComputeHash') < source.indexOf('-File $file'));
  assert.ok(source.indexOf('acReleaseTag') < source.indexOf('-File $file'));
  assert.doesNotMatch(source, /Set-Location|Expand-Archive|ScriptBlock\]::Create|WebClient|UseDefaultCredentials=\$true/);
});

test('temporary directory is exclusive, ACLs are read back, and cleanup cannot mask the child exit', () => {
  const source = entry.windowsEntryBootstrapSource({ extensionId, setupId, scope: 'administrator', metadata });
  assert.ok(source.includes('CreateDirectoryW'));
  assert.ok(source.includes('GetSecurityDescriptorBinaryForm'));
  assert.ok(source.includes('AreAccessRulesProtected'));
  assert.ok(source.includes('GetAccessRules'));
  assert.doesNotMatch(source, /CreateDirectory\(\$dir,\$acl\)/);
  assert.match(source, /try\{\$held\.Dispose\(\)\}catch\{\}/);
  for (const shell of ['browserPowerShell','browserCmd']) {
    assert.doesNotMatch(build({ shell }), /C:\\Windows/);
  }
});

test('actual PowerShell 5.1 parser accepts both scoped programs without executing them', { skip: process.platform !== 'win32' }, () => {
  for (const scope of ['administrator', 'current-account']) {
    const source = entry.windowsEntryBootstrapSource({ extensionId, setupId, scope, metadata });
    const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        "$t=$e=$null;[void][Management.Automation.Language.Parser]::ParseInput([Console]::In.ReadToEnd(),[ref]$t,[ref]$e);if($e.Count){$e.Message;exit 1};'parse-only-pass'"],
      { input: source, encoding: 'utf8', windowsHide: true, timeout: 15000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.trim(), 'parse-only-pass');
    const psCommand = build({ scope });
    const literal = psCommand.slice(psCommand.indexOf('-Command ') + 9);
    assert.equal(literal.slice(1, -1).replaceAll("''", "'"), source);
    assert.equal(build({ scope, shell: 'browserCmd' }).split('-Command "')[1].slice(0, -1), source);
  }
});

test('real downloader functions enforce redirects, limits and truncation with stubbed network only', { skip: process.platform !== 'win32' }, () => {
  const source = entry.windowsEntryBootstrapSource({ extensionId, setupId, scope: 'administrator', metadata });
  const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./setup-entry-download-tests.ps1', import.meta.url))],
    { input: source, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.ok, true);
  assert.ok(value.checks >= 45);
  assert.deepEqual([value.network, value.entryExecuted, value.aclTouched], [false, false, false]);
  assert.equal(value.declarationCompiled, true);
  assert.equal(value.cleanupExitPreserved, true);
});

test('entry storage actually creates an exclusive protected temporary directory and refuses collisions', { skip: process.platform !== 'win32' }, () => {
  const source = entry.windowsEntryBootstrapSource({ extensionId, setupId, scope: 'administrator', metadata });
  const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./setup-entry-storage-tests.ps1', import.meta.url))],
    { input: source, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const value = JSON.parse(result.stdout);
  assert.deepEqual(value, { ok: true, actualDirectoryCreated: true, protectedAclVerified: true,
    existingDirectoryRefused: true, existingFileRefused: true, cleanupVerified: true,
    network: false, entryExecuted: false, installedRuntimeTouched: false });
});

test('verified entry actually launches a harmless OS PowerShell child with the read lease held', { skip: process.platform !== 'win32' }, () => {
  const payload = Buffer.from(`param([switch]$Administrator,[switch]$Apply,[string]$Consent,[switch]$PromptForConnection,[string]$ExtensionId,[string]$BrowserSetupId,[string]$ExpectedSumsSha256)
$script:acReleaseTag = 'v3.0.0'
$ErrorActionPreference='Stop'
if(-not $Administrator -or -not $Apply -or -not $PromptForConnection -or $Consent -cne 'accept-administrator-browser-installation' -or $ExtensionId -cne '${extensionId}' -or $BrowserSetupId -cne '${setupId}' -or $ExpectedSumsSha256 -cne '${metadata.sumsSha256}'){throw 'fixture_arguments'}
$writeRefused=$false
try{$writer=[IO.File]::Open($PSCommandPath,'Open','Write','ReadWrite');$writer.Dispose()}catch [IO.IOException]{$writeRefused=$true}
if(-not $writeRefused){throw 'fixture_read_lease_missing'}
[ordered]@{ok=$true;childExecuted=$true;writeRefused=$writeRefused;administratorGranted=$false;runtimeInstalled=$false;network=$false}|ConvertTo-Json -Compress
exit 23
`, 'utf8');
  const pinned = { ...metadata, entrySha256: createHash('sha256').update(payload).digest('hex') };
  const original = entry.windowsEntryBootstrapSource({ extensionId, setupId, scope: 'administrator', metadata: pinned });
  const download = `Download ([uri]'${metadata.entryUrl}') $output;`;
  assert.equal(original.split(download).length, 2);
  const source = original.replace(download,
    `$fixture=[Convert]::FromBase64String('${payload.toString('base64')}');$output.Write($fixture,0,$fixture.Length);`);
  const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', source],
    { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.ifError(result.error);
  assert.equal(result.status, 23, result.stdout + result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, childExecuted: true,
    writeRefused: true, administratorGranted: false, runtimeInstalled: false, network: false });
});
