import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const installer = fileURLToPath(new URL('../native/bootstrap/install.ps1', import.meta.url));
const source = fs.readFileSync(installer, 'utf8');
const windows = { skip: process.platform !== 'win32', timeout: 20000 };
const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const quote = value => `'${value.replaceAll("'", "''")}'`;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function run(t, { members, mutation = '', uninstall = false, extracted = false, administrator = false } = {}) {
  const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'ac-offline-payload-'));
  t.after(() => {
    assert.equal(path.dirname(root), parent);
    assert.equal(fs.realpathSync(root), root);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const release = path.join(root, 'release'), temp = path.join(root, 'temp');
  fs.mkdirSync(release); fs.mkdirSync(temp);
  const fixture = members || { 'bin.mjs': 'throw new Error("fixture must never execute");\n',
    'install.ps1': '# inert archived script must never execute\n', 'payload/runtime.mjs': '// inert source\n' };
  const runtimeName = 'agent-continue-windows-administrator-x64.zip';
  const runtimeBytes = Buffer.from('inert administrator archive, never opened or executed');
  if (administrator) {
    fixture['Stage-WindowsAdministratorBundle.ps1'] = '# inert stager, never executed\n';
    fixture['install-administrator.ps1'] = "$script:acReleaseTag = 'v3.0.0'\n" +
      `$script:acAdministratorBundleSha256 = '${hash(runtimeBytes)}'\n` +
      `$script:acAdministratorStagerSha256 = '${hash(fixture['Stage-WindowsAdministratorBundle.ps1'])}'\n`;
    fs.writeFileSync(path.join(release, runtimeName), runtimeBytes);
    fs.writeFileSync(path.join(release, 'Stage-WindowsAdministratorBundle.ps1'), fixture['Stage-WindowsAdministratorBundle.ps1']);
    fs.writeFileSync(path.join(release, 'release.json'), '{"fixture":"declared local closure"}');
  }
  const encoded = Object.entries(fixture).map(([name, bytes]) => ({ name, data: Buffer.from(bytes).toString('base64'), sha256: hash(bytes) }));
  fs.writeFileSync(path.join(root, 'members.json'), JSON.stringify(encoded));
  const script = path.join(root, 'harness.ps1');
  fs.writeFileSync(script, `
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1')
Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Archive\\Microsoft.PowerShell.Archive.psd1')
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$release=${quote(release)}
$archive=Join-Path $release 'agent-continue-setup.zip'
$rows=ConvertFrom-Json ([IO.File]::ReadAllText(${quote(path.join(root, 'members.json'))}))
$zip=[IO.Compression.ZipFile]::Open($archive,[IO.Compression.ZipArchiveMode]::Create)
try {
  foreach($row in $rows) {
    $entry=$zip.CreateEntry($row.name); $stream=$entry.Open()
    try { $bytes=[Convert]::FromBase64String($row.data); $stream.Write($bytes,0,$bytes.Length) }
    finally { $stream.Dispose() }
  }
} finally { $zip.Dispose() }
$lines=@($rows | ForEach-Object { $_.sha256+'  '+$_.name })
$lines+=((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()+'  agent-continue-setup.zip')
${administrator ? `$lines+=${quote(hash(runtimeBytes) + '  ' + runtimeName)}` : ''}
$sums=Join-Path $release 'SHA256SUMS.txt'
[IO.File]::WriteAllText($sums,($lines -join "\n")+"\n",[Text.Encoding]::ASCII)
${extracted ? `[IO.File]::WriteAllText((Join-Path $release 'bin.mjs'),${quote(fixture['bin.mjs'] || '')})` : ''}
${mutation}
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile(${quote(installer)},[ref]$tokens,[ref]$errors)
if($errors.Count) { throw 'installer_parse_failed' }
$names=@('Assert-FileDigest','Get-AdjacentSetupArchive','Get-AdjacentAdministratorParameters','Expand-VerifiedSetupArchive','Resolve-Payload','Assert-Payload')
$definitions=@()
foreach($fn in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$true)) {
  if($fn.Name -cin $names) { $definitions+=$fn.Extent.Text }
}
$outer=@($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] })[-1]
$cleanup=(@($outer.Finally.Statements | ForEach-Object { $_.Extent.Text }) -join [Environment]::NewLine)
$definitions+=('function Invoke-FixtureCleanup {'+[Environment]::NewLine+$cleanup+[Environment]::NewLine+'}')
$helpers=Join-Path $release 'fixture-helpers.ps1'
[IO.File]::WriteAllText($helpers,($definitions -join [Environment]::NewLine))
. $helpers
function Invoke-WebRequest { $script:network++; throw 'fixture_network_forbidden' }
function Expand-Archive {
  param([string]$LiteralPath,[string]$DestinationPath,[switch]$Force)
  $script:expanded++
  Microsoft.PowerShell.Archive\\Expand-Archive @PSBoundParameters
}
$script:network=0; $script:expanded=0; $script:acTemp=''; $script:acRemote=$false
$script:acKeepTemp=$false; $script:acPath=$env:PATH; $script:acTls=[Net.ServicePointManager]::SecurityProtocol
$script:acReleaseTag='v3.0.0'; $AllowUnverifiedPayload=$false
${administrator ? `$script:acAdministratorInstallerSha256=${quote(hash(fixture['install-administrator.ps1']))}` : ''}
$Uninstall=$${uninstall}; $PayloadBase='https://example.invalid/must-not-be-contacted'
$result=@{}
try {
  $script:acPayloadRoot=Resolve-Payload
  $result.checked=Assert-Payload
  $result.local=($script:acPayloadRoot -ne $release)
  $result.temp=$script:acTemp
  ${administrator ? `$parameters=Get-AdjacentAdministratorParameters (Join-Path $script:acPayloadRoot 'install-administrator.ps1')
  $result.originalArchive=($parameters.Archive -ceq (Join-Path $release '${runtimeName}'))
  $result.originalStager=($parameters.Stager -ceq (Join-Path $release 'Stage-WindowsAdministratorBundle.ps1'))
  $result.runtimeCopied=(Test-Path -LiteralPath (Join-Path $script:acPayloadRoot '${runtimeName}'))
  $result.archivePin=$parameters.ExpectedSha256
  $result.stagerPin=$parameters.ExpectedStagerSha256` : ''}
} catch { $result.error=$_.Exception.Message }
finally {
  if($script:acTemp) {
    if([IO.Path]::GetDirectoryName($script:acTemp) -ine ${quote(temp)} -or
       [IO.Path]::GetFileName($script:acTemp) -cnotmatch '^agent-continue-[a-f0-9]{32}$') { throw 'fixture_cleanup_scope' }
  }
  Invoke-FixtureCleanup
}
$result.network=$script:network; $result.expanded=$script:expanded
$result.cleaned=(-not $script:acTemp -or -not (Test-Path -LiteralPath $script:acTemp))
[Console]::WriteLine(($result | ConvertTo-Json -Compress))
`, 'utf8');
  const result = spawnSync(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script], {
    encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
      PATH: path.join(process.env.SystemRoot, 'System32'), TEMP: temp, TMP: temp, OS: 'Windows_NT',
      LOCALAPPDATA: path.join(root, 'local'), APPDATA: path.join(root, 'roaming'),
      PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules') },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout.trim());
}

test('guided preflight accepts a verified adjacent ZIP instead of requiring extracted bin', () => {
  const start = source.indexOf("if ($Host.Name -cne 'ConsoleHost'");
  const preflight = source.slice(start, source.indexOf('Write-Host "Chrome extension ID:', start));
  assert.match(preflight, /Get-AdjacentSetupArchive/);
});

test('verified adjacent source ZIP resolves and passes read-only payload checks without executing source', windows, t => {
  const result = run(t);
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.equal(result.checked, 3);
  assert.equal(result.local, true);
  assert.equal(result.network, 0);
  assert.equal(result.expanded, 1);
  assert.equal(result.cleaned, true);
});

for (const [name, mutation, error] of [
  ['wrong digest', "[IO.File]::AppendAllText($archive,'tampered')", 'payload_digest_mismatch'],
  ['missing sums', 'Remove-Item -LiteralPath $sums', 'payload_integrity_unverified'],
  ['missing archive checksum', "[IO.File]::WriteAllText($sums,($lines[0]+[Environment]::NewLine))", 'payload_integrity_unverified'],
  ['directory archive', 'Remove-Item -LiteralPath $archive; New-Item -ItemType Directory -Path $archive | Out-Null', 'payload_path_invalid'],
  ['redirected parent', "$saved=$release+'.saved'; Move-Item -LiteralPath $release -Destination $saved; New-Item -ItemType Junction -Path $release -Target $saved | Out-Null", 'payload_path_invalid'],
]) {
  test(`adjacent ${name} fails before extraction or network`, windows, t => {
    const result = run(t, { mutation });
    assert.equal(result.error, error, JSON.stringify(result));
    assert.equal(result.expanded, 0);
    assert.equal(result.network, 0);
    assert.equal(result.cleaned, true);
  });
}

for (const name of ['../escape.txt', 'payload/../../escape.txt', 'payload/CON.txt', 'payload/custom.exe']) {
  test(`digest-verified unsafe member ${name} is rejected before expansion`, windows, t => {
    const result = run(t, { members: { 'bin.mjs': '// never executed', [name]: 'unsafe' } });
    assert.equal(result.error, 'payload_path_invalid', JSON.stringify(result));
    assert.equal(result.expanded, 0); assert.equal(result.network, 0); assert.equal(result.cleaned, true);
  });
}

test('uninstall refuses archived-only payload without extraction or fetch', windows, t => {
  const result = run(t, { uninstall: true });
  assert.equal(result.error, 'uninstall_inspection_unavailable');
  assert.equal(result.expanded, 0); assert.equal(result.network, 0);
});

test('bad adjacent archive cannot fall back to an existing extracted entry', windows, t => {
  const result = run(t, { extracted: true, mutation: "[IO.File]::AppendAllText($archive,'tampered')" });
  assert.equal(result.error, 'payload_digest_mismatch');
  assert.equal(result.expanded, 0); assert.equal(result.network, 0);
});

test('existing Assert-Payload rejects changed extracted source before any execution', windows, t => {
  const result = run(t, { mutation: "$lines[0]=('0'*64)+'  bin.mjs'; [IO.File]::WriteAllText($sums,($lines -join [Environment]::NewLine)+[Environment]::NewLine)" });
  assert.equal(result.error, 'payload_digest_mismatch');
  assert.equal(result.expanded, 1); assert.equal(result.network, 0); assert.equal(result.cleaned, true);
});

test('missing adjacent archive retains remote legacy route, intercepted before any network', windows, t => {
  const result = run(t, { mutation: 'Remove-Item -LiteralPath $archive' });
  assert.equal(result.error, 'fixture_network_forbidden');
  assert.equal(result.network, 1); assert.equal(result.expanded, 0); assert.equal(result.cleaned, true);
});

test('administrator handoff binds verified original sidecars without copying or executing the runtime', windows, t => {
  const result = run(t, { administrator: true });
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.equal(result.originalArchive, true);
  assert.equal(result.originalStager, true);
  assert.equal(result.runtimeCopied, false);
  assert.match(result.archivePin, /^[a-f0-9]{64}$/);
  assert.match(result.stagerPin, /^[a-f0-9]{64}$/);
  assert.equal(result.network, 0); assert.equal(result.cleaned, true);
});

test('production administrator branch forwards the validated explicit paths to the helper', () => {
  const start = source.indexOf('$parameters = @{Apply=$true;');
  const handoff = source.slice(start, source.indexOf('$command = Get-AdministratorInstallerCommand', start));
  assert.match(handoff, /Get-AdjacentAdministratorParameters \$administratorEntry/);
  assert.match(handoff, /\$parameters\[\$key\] = \$adjacentParameters\[\$key\]/);
});

for (const [name, mutation, error] of [
  ['missing runtime', "Remove-Item -LiteralPath (Join-Path $release 'agent-continue-windows-administrator-x64.zip')", 'administrator_release_unavailable'],
  ['tampered runtime', "[IO.File]::AppendAllText((Join-Path $release 'agent-continue-windows-administrator-x64.zip'),'changed')", 'payload_digest_mismatch'],
  ['missing stager', "Remove-Item -LiteralPath (Join-Path $release 'Stage-WindowsAdministratorBundle.ps1')", 'administrator_release_unavailable'],
  ['tampered stager', "[IO.File]::AppendAllText((Join-Path $release 'Stage-WindowsAdministratorBundle.ps1'),'changed')", 'payload_digest_mismatch'],
  ['missing setup ZIP', 'Remove-Item -LiteralPath $archive', 'payload_integrity_unverified'],
]) {
  test(`declared local administrator closure rejects ${name} without remote fallback`, windows, t => {
    const result = run(t, { administrator: true, mutation });
    assert.equal(result.error, error, JSON.stringify(result));
    assert.equal(result.network, 0); assert.equal(result.cleaned, true);
  });
}
