import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const installer = fileURLToPath(new URL('../native/bootstrap/install.ps1', import.meta.url));
const source = fs.readFileSync(installer, 'utf8');
const windows = { skip: process.platform !== 'win32', timeout: 20000 };
const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const quote = value => `'${value.replaceAll("'", "''")}'`;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const activePowerShell = new Map();

const normalizeFixtureLongPath = `
  if ($longPath.StartsWith('\\\\?\\UNC\\', [StringComparison]::OrdinalIgnoreCase)) {
    $longPath = '\\\\' + $longPath.Substring(8)
  } elseif ($longPath.StartsWith('\\\\?\\', [StringComparison]::Ordinal)) {
    $longPath = $longPath.Substring(4)
  }
`;

const fixtureCleanupScope = temp => `
  if($script:acTemp) {
    if (-not ('FixtureLongPath' -as [type])) {
      Add-Type @'
using System.Runtime.InteropServices;
using System.Text;
public static class FixtureLongPath {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern uint GetLongPathName(string path, StringBuilder result, uint capacity);
}
'@
    }
    $canonicalCleanup = @()
    foreach ($inputPath in @(${quote(temp)}, $script:acTemp)) {
      if (-not [IO.Path]::IsPathRooted($inputPath)) { throw 'fixture_cleanup_scope' }
      # Check before resolving: canonicalization must never hide a junction.
      $item = Get-Item -LiteralPath $inputPath -Force -ErrorAction Stop
      if ($item -isnot [IO.DirectoryInfo]) { throw 'fixture_cleanup_scope' }
      for ($cursor = $item; $null -ne $cursor; $cursor = $cursor.Parent) {
        if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'fixture_cleanup_scope' }
      }
      $buffer = [Text.StringBuilder]::new(32768)
      $length = [FixtureLongPath]::GetLongPathName([IO.Path]::GetFullPath($inputPath), $buffer, $buffer.Capacity)
      if ($length -eq 0 -or $length -ge $buffer.Capacity) { throw 'fixture_cleanup_scope' }
      $longPath = $buffer.ToString()
      ${normalizeFixtureLongPath}
      $canonicalCleanup += $longPath
    }
    if ([IO.Path]::GetDirectoryName($canonicalCleanup[1]) -ine $canonicalCleanup[0] -or
        [IO.Path]::GetFileName($canonicalCleanup[1]) -cnotmatch '\\Aagent-continue-[a-f0-9]{32}\\z') {
      throw 'fixture_cleanup_scope'
    }
    if ([IO.Path]::GetDirectoryName($script:acTemp) -ine $canonicalCleanup[0]) { Write-FixtureMilestone 'cleanup-parent-alias' }
    if ([IO.Path]::GetFileName($script:acTemp) -cne [IO.Path]::GetFileName($canonicalCleanup[1])) { Write-FixtureMilestone 'cleanup-leaf-alias' }
    $script:acTemp = $canonicalCleanup[1]
    $env:TEMP = $canonicalCleanup[0]; $env:TMP = $canonicalCleanup[0]
    Write-FixtureMilestone 'cleanup-scope-verified'
  }
`;

function fixtureRoot(t) {
  const parent = fs.realpathSync.native(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'ac-offline-payload-'));
  const children = new Set();
  children.started = 0;
  activePowerShell.set(root, children);
  t.after(async () => {
    activePowerShell.delete(root);
    const running = [...children];
    for (const run of running) run.child.kill();
    await Promise.all(running.map(run => run.closed));
    assert.equal(path.dirname(root), parent);
    assert.equal(fs.realpathSync(root), root);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

async function runPowerShell(t, root, body, prelude = '') {
  t.signal.throwIfAborted();
  const children = activePowerShell.get(root);
  assert.ok(children, 'fixture must remain open until its PowerShell child closes');
  assert.equal(children.started++, 0, 'an offline case must use only one cold PowerShell child within its 20s budget');
  const script = path.join(root, 'harness.ps1');
  const milestones = path.join(root, 'milestones.txt');
  fs.writeFileSync(script, `$ErrorActionPreference='Stop'
$fixtureClock = [Diagnostics.Stopwatch]::StartNew()
function Write-FixtureMilestone([string]$Name) {
  [IO.File]::AppendAllText(${quote(milestones)}, ($Name + '=' + $fixtureClock.ElapsedMilliseconds + [Environment]::NewLine))
}
Write-FixtureMilestone 'entry'
${prelude}
$fixtureAutoloadVariable = $ExecutionContext.SessionState.PSVariable.Get('PSModuleAutoLoadingPreference')
$fixtureAutoloadDefined = $null -ne $fixtureAutoloadVariable
$fixtureAutoloadPreference = if ($fixtureAutoloadDefined) { $fixtureAutoloadVariable.Value } else { $null }
try {
  # Bootstrap alone disables discovery; the fixture body keeps its original preference.
  $PSModuleAutoLoadingPreference = 'None'
  # Join-Path itself would require implicit Management discovery here.
  $utilityModule = [IO.Path]::Combine($PSHOME, 'Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1')
  $managementModule = [IO.Path]::Combine($PSHOME, 'Modules\\Microsoft.PowerShell.Management\\Microsoft.PowerShell.Management.psd1')
  $archiveModule = [IO.Path]::Combine($PSHOME, 'Modules\\Microsoft.PowerShell.Archive\\Microsoft.PowerShell.Archive.psd1')
  Write-FixtureMilestone 'utility-import-start'
  Import-Module $utilityModule -ErrorAction Stop
  Write-FixtureMilestone 'utility-imported'
  Write-FixtureMilestone 'management-import-start'
  Import-Module $managementModule -ErrorAction Stop
  Write-FixtureMilestone 'management-imported'
  Write-FixtureMilestone 'archive-import-start'
  Import-Module $archiveModule -ErrorAction Stop
  Write-FixtureMilestone 'archive-imported'
} finally {
  if ($fixtureAutoloadDefined) { $PSModuleAutoLoadingPreference = $fixtureAutoloadPreference }
  else { $ExecutionContext.SessionState.PSVariable.Remove('PSModuleAutoLoadingPreference') }
}
Write-FixtureMilestone 'autoload-restored'
Write-FixtureMilestone 'body-start'
${body}`, 'utf8');
  const started = performance.now();
  const label = `case=${JSON.stringify(t.name)}`;
  process.stderr.write(`[offline-payload] start ${label} timeout_ms=15000\n`);
  const run = {};
  run.closed = new Promise(resolve => {
    let result;
    run.child = execFile(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script], {
      encoding: 'utf8', windowsHide: true, timeout: 15000, signal: t.signal,
      env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
        PATH: path.join(process.env.SystemRoot, 'System32'), TEMP: path.join(root, 'temp'), TMP: path.join(root, 'temp'), OS: 'Windows_NT',
        LOCALAPPDATA: path.join(root, 'local'), APPDATA: path.join(root, 'roaming'),
        PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules') },
    }, (error, stdout, stderr) => {
      result = { stdout, stderr, error: error?.killed || typeof error?.code !== 'number' ? error : null };
    });
    // Abort may notify before OS exit; cleanup must wait for the child's close.
    run.child.once('close', (status, signal) => {
      children.delete(run);
      resolve({ ...result, status, signal });
    });
    children.add(run);
  });
  const result = await run.closed;
  const diagnostic = `[offline-payload] end ${label} elapsed_ms=${Math.round(performance.now() - started)}`
    + ` status=${result.status} signal=${result.signal} error=${result.error?.code || 'none'}`
    + ` milestones_ms=${JSON.stringify(fs.existsSync(milestones) ? fs.readFileSync(milestones, 'utf8').trim() : 'not-entered')}`;
  process.stderr.write(diagnostic + '\n');
  assert.ifError(result.error);
  assert.equal(result.signal, null, diagnostic);
  t.signal.throwIfAborted();
  assert.equal(result.status, 0, diagnostic + '\n' + result.stdout + result.stderr);
  return result;
}

async function run(t, { members, mutation = '', uninstall = false, extracted = false, administrator = false } = {}) {
  const root = fixtureRoot(t);
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
  const result = await runPowerShell(t, root, `
Write-FixtureMilestone 'compression-start'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
Write-FixtureMilestone 'compression-ready'
Write-FixtureMilestone 'archive-create-start'
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
Write-FixtureMilestone 'archive-created'
$lines=@($rows | ForEach-Object { $_.sha256+'  '+$_.name })
$lines+=((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()+'  agent-continue-setup.zip')
${administrator ? `$lines+=${quote(hash(runtimeBytes) + '  ' + runtimeName)}` : ''}
$sums=Join-Path $release 'SHA256SUMS.txt'
[IO.File]::WriteAllText($sums,($lines -join "\n")+"\n",[Text.Encoding]::ASCII)
${extracted ? `[IO.File]::WriteAllText((Join-Path $release 'bin.mjs'),${quote(fixture['bin.mjs'] || '')})` : ''}
Write-FixtureMilestone 'mutation-start'
${mutation}
Write-FixtureMilestone 'mutation-complete'
Write-FixtureMilestone 'source-parse-start'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile(${quote(installer)},[ref]$tokens,[ref]$errors)
if($errors.Count) { throw 'installer_parse_failed' }
Write-FixtureMilestone 'source-parsed'
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
Write-FixtureMilestone 'helpers-loaded'
function Invoke-WebRequest { $script:network++; throw 'fixture_network_forbidden' }
function Expand-Archive {
  param([string]$LiteralPath,[string]$DestinationPath,[switch]$Force)
  $script:expanded++
  Write-FixtureMilestone 'expand-start'
  Microsoft.PowerShell.Archive\\Expand-Archive @PSBoundParameters
  Write-FixtureMilestone 'expand-complete'
}
$script:network=0; $script:expanded=0; $script:acTemp=''; $script:acRemote=$false
$script:acKeepTemp=$false; $script:acPath=$env:PATH; $script:acTls=[Net.ServicePointManager]::SecurityProtocol
$script:acReleaseTag='v3.0.0'; $AllowUnverifiedPayload=$false
${administrator ? `$script:acAdministratorInstallerSha256=${quote(hash(fixture['install-administrator.ps1']))}` : ''}
$Uninstall=$${uninstall}; $PayloadBase='https://example.invalid/must-not-be-contacted'
$result=@{}
try {
  Write-FixtureMilestone 'resolve-start'
  $script:acPayloadRoot=Resolve-Payload
  Write-FixtureMilestone 'payload-resolved'
  $result.checked=Assert-Payload
  Write-FixtureMilestone 'payload-checked'
  $result.local=($script:acPayloadRoot -ne $release)
  $result.temp=$script:acTemp
  ${administrator ? `Write-FixtureMilestone 'administrator-handoff-start'
  $parameters=Get-AdjacentAdministratorParameters (Join-Path $script:acPayloadRoot 'install-administrator.ps1')
  Write-FixtureMilestone 'administrator-handoff-checked'
  $result.originalArchive=($parameters.Archive -ceq (Join-Path $release '${runtimeName}'))
  $result.originalStager=($parameters.Stager -ceq (Join-Path $release 'Stage-WindowsAdministratorBundle.ps1'))
  $result.runtimeCopied=(Test-Path -LiteralPath (Join-Path $script:acPayloadRoot '${runtimeName}'))
  $result.archivePin=$parameters.ExpectedSha256
  $result.stagerPin=$parameters.ExpectedStagerSha256` : ''}
} catch { $result.error=$_.Exception.Message; Write-FixtureMilestone 'payload-error' }
finally {
  Write-FixtureMilestone 'cleanup-start'
  ${fixtureCleanupScope(temp)}
  Invoke-FixtureCleanup
  Write-FixtureMilestone 'cleanup-complete'
}
$result.network=$script:network; $result.expanded=$script:expanded
$result.cleaned=(-not $script:acTemp -or -not (Test-Path -LiteralPath $script:acTemp))
Write-FixtureMilestone 'result-ready'
[Console]::WriteLine(($result | ConvertTo-Json -Compress))
`);
  return JSON.parse(result.stdout.trim());
}

test('offline cleanup extended-prefix normalization preserves drive and UNC roots', windows, async t => {
  const root = fixtureRoot(t);
  fs.mkdirSync(path.join(root, 'temp'));
  const cases = [
    ['C:\\temp\\fixture', 'C:\\temp\\fixture'],
    ['\\\\?\\C:\\temp\\fixture', 'C:\\temp\\fixture'],
    ['\\\\server\\share\\temp', '\\\\server\\share\\temp'],
    ['\\\\?\\UNC\\server\\share\\temp', '\\\\server\\share\\temp'],
  ];
  const result = await runPowerShell(t, root, `
$cases = ConvertFrom-Json ${quote(JSON.stringify(cases))}
$observed = @()
foreach ($case in $cases) {
  $longPath = $case[0]
  ${normalizeFixtureLongPath}
  if ($longPath -cne $case[1]) { throw 'fixture_extended_prefix_mismatch' }
  $observed += $longPath
}
[Console]::WriteLine((@{paths=$observed} | ConvertTo-Json -Compress))
`);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout).paths, cases.map(([, expected]) => expected));
});

test('offline cleanup accepts only verified fixture directory aliases', windows, async t => {
  const root = fixtureRoot(t), temp = path.join(root, 'temp');
  fs.mkdirSync(temp);
  const directory = path.join(temp, 'agent-continue-' + 'a'.repeat(32));
  fs.mkdirSync(directory);
  const canonical = fs.realpathSync.native(directory);
  const result = await runPowerShell(t, root, `
Add-Type @'
using System.Runtime.InteropServices;
using System.Text;
public static class FixtureShortPath {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern uint GetShortPathName(string path, StringBuilder result, uint capacity);
}
'@
$buffer = [Text.StringBuilder]::new(32768)
$length = [FixtureShortPath]::GetShortPathName(${quote(directory)}, $buffer, $buffer.Capacity)
if ($length -eq 0 -or $length -ge $buffer.Capacity) { throw 'fixture_short_path_query_failed' }
$short = $buffer.ToString()
# Extended paths are aliases even on volumes where 8.3 names are disabled.
$aliases = @(${quote(directory)}, $short, ${quote(path.toNamespacedPath(directory))})
$observed = @()
foreach ($alias in $aliases) {
  $script:acTemp = $alias
  $item = Get-Item -LiteralPath $alias -Force
  $observation = @{raw=$alias; rawParent=[IO.Path]::GetDirectoryName($alias)
    rawLeaf=[IO.Path]::GetFileName($alias); itemName=$item.Name; itemFullName=$item.FullName}
  try { ${fixtureCleanupScope(temp)} }
  catch { [Console]::Error.WriteLine(($observation | ConvertTo-Json -Compress)); throw }
  $observation.verified = $script:acTemp
  $observed += $observation
}
# Exercise the unchanged installer finally against the verified canonical path.
$ast = [Management.Automation.Language.Parser]::ParseFile(${quote(installer)}, [ref]$null, [ref]$null)
$outer = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] })[-1]
$cleanup = @($outer.Finally.Statements | ForEach-Object { $_.Extent.Text }) -join [Environment]::NewLine
$script:acPath = $env:PATH; $script:acTls = [Net.ServicePointManager]::SecurityProtocol; $script:acKeepTemp = $false
& ([scriptblock]::Create($cleanup))
[Console]::WriteLine((@{aliases=$observed} | ConvertTo-Json -Depth 4 -Compress))
`);
  assert.equal(result.stderr, '');
  const observed = JSON.parse(result.stdout).aliases;
  assert.equal(observed.length, 3);
  for (const alias of observed) {
    assert.equal(alias.verified.toLowerCase(), canonical.toLowerCase());
  }
  assert.equal(fs.existsSync(directory), false, 'the unchanged installer cleanup must remove the verified directory');
  t.diagnostic(JSON.stringify(observed));
});

test('offline cleanup refuses wrong scope and reparse directories before deletion', windows, async t => {
  const root = fixtureRoot(t), temp = path.join(root, 'temp');
  fs.mkdirSync(temp);
  const leaf = 'agent-continue-' + 'b'.repeat(32);
  const outside = path.join(root, 'outside'), target = path.join(outside, leaf);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'keep.txt'), 'must survive');
  const junction = path.join(temp, leaf), parentJunction = path.join(root, 'redirected-temp');
  fs.symlinkSync(target, junction, 'junction');
  fs.symlinkSync(outside, parentJunction, 'junction');
  const wrongName = path.join(temp, 'not-a-payload');
  fs.mkdirSync(wrongName);
  fs.writeFileSync(path.join(wrongName, 'keep.txt'), 'must survive');
  const cases = [
    ['outside', target, temp], ['wrong-name', wrongName, temp],
    ['temp-root', temp, temp], ['leaf-junction', junction, temp],
    ['parent-junction', path.join(parentJunction, leaf), parentJunction],
  ];
  const result = await runPowerShell(t, root, `
$cases = ConvertFrom-Json ${quote(JSON.stringify(cases))}
$rejected = @()
foreach ($case in $cases) {
  $script:acTemp = $case[1]
  $expected = $case[2]
  $refused = $false
  try {
    & ([scriptblock]::Create(${quote(fixtureCleanupScope('$EXPECTED').replaceAll(quote('$EXPECTED'), '$expected'))}))
  } catch {
    if ($_.Exception.Message -cne 'fixture_cleanup_scope') { throw }
    $refused = $true
  }
  if (-not $refused) { throw ('fixture_unsafe_cleanup_admitted:' + $case[0]) }
  $rejected += $case[0]
}
[Console]::WriteLine((@{rejected=$rejected} | ConvertTo-Json -Compress))
`);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout).rejected, cases.map(([name]) => name));
  assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'must survive');
  assert.equal(fs.readFileSync(path.join(wrongName, 'keep.txt'), 'utf8'), 'must survive');
});

test('offline fixture imports complete modules with implicit discovery disabled', windows, async t => {
  const root = fixtureRoot(t);
  fs.mkdirSync(path.join(root, 'temp'));
  const result = await runPowerShell(t, root, `
$stream = [IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes('fixture'))
try { $hash = (Microsoft.PowerShell.Utility\\Get-FileHash -InputStream $stream -Algorithm SHA256).Hash }
finally { $stream.Dispose() }
$json = Microsoft.PowerShell.Utility\\ConvertFrom-Json '{"value":"fixture"}'
$safePath = Microsoft.PowerShell.Management\\Join-Path ${quote(root)} 'harness.ps1'
$safeItem = Microsoft.PowerShell.Management\\Get-Item -LiteralPath $safePath
$zipPath = Microsoft.PowerShell.Management\\Join-Path ${quote(root)} 'probe.zip'
$destination = Microsoft.PowerShell.Management\\Join-Path ${quote(root)} 'expanded'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$zip = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
try {
  $entry = $zip.CreateEntry('probe.txt'); $stream = $entry.Open()
  try { $bytes = [Text.Encoding]::UTF8.GetBytes('fixture'); $stream.Write($bytes, 0, $bytes.Length) }
  finally { $stream.Dispose() }
} finally { $zip.Dispose() }
Microsoft.PowerShell.Archive\\Expand-Archive -LiteralPath $zipPath -DestinationPath $destination
$discoveryBlocked = $false
try { $null = Get-Command Get-Item }
catch {
  if ($_.Exception.Message -cne 'fixture_implicit_command_discovery_forbidden') { throw }
  $discoveryBlocked = $true
}
[Console]::WriteLine((@{
  utilityPath = (Get-Module Microsoft.PowerShell.Utility).Path
  managementPath = (Get-Module Microsoft.PowerShell.Management).Path
  archivePath = (Get-Module Microsoft.PowerShell.Archive).Path
  autoload = $PSModuleAutoLoadingPreference
  hash = $hash; jsonValue = $json.value; safePath = $safeItem.FullName
  expanded = [IO.File]::ReadAllText([IO.Path]::Combine($destination, 'probe.txt'))
  discoveryBlocked = $discoveryBlocked
} | ConvertTo-Json -Compress))`, `
$PSModuleAutoLoadingPreference = 'None'
function Get-Command { throw 'fixture_implicit_command_discovery_forbidden' }
`);
  assert.equal(result.stderr, '');
  const { utilityPath, managementPath, archivePath, safePath, ...actual } = JSON.parse(result.stdout);
  for (const [name, actualPath] of [['Utility', utilityPath], ['Management', managementPath], ['Archive', archivePath]]) {
    assert.equal(actualPath.toLowerCase(), path.join(path.dirname(ps),
      `Modules/Microsoft.PowerShell.${name}/Microsoft.PowerShell.${name}.psd1`).toLowerCase());
  }
  assert.equal(fs.realpathSync.native(safePath).toLowerCase(),
    fs.realpathSync.native(path.join(root, 'harness.ps1')).toLowerCase());
  assert.deepEqual(actual, {
    autoload: 'None', hash: hash('fixture').toUpperCase(), jsonValue: 'fixture',
    expanded: 'fixture', discoveryBlocked: true,
  });
  const milestones = fs.readFileSync(path.join(root, 'milestones.txt'), 'utf8').trim().split(/\r?\n/);
  assert.deepEqual(milestones.map(line => line.split('=')[0]), [
    'entry', 'utility-import-start', 'utility-imported', 'management-import-start', 'management-imported',
    'archive-import-start', 'archive-imported', 'autoload-restored', 'body-start',
  ]);
  assert.ok(milestones.every(line => /^[a-z-]+=\d+$/.test(line)));
});

for (const preference of [null, 'All', 'ModuleQualified']) {
  test(`offline fixture restores ${preference ?? 'unset'} autoload preference before its body`, windows, async t => {
    const root = fixtureRoot(t);
    fs.mkdirSync(path.join(root, 'temp'));
    const result = await runPowerShell(t, root, `
$variable = $ExecutionContext.SessionState.PSVariable.Get('PSModuleAutoLoadingPreference')
[Console]::WriteLine((@{
  defined = $null -ne $variable
  preference = if ($null -ne $variable) { [string]$variable.Value } else { $null }
} | ConvertTo-Json -Compress))`, preference === null
      ? "$ExecutionContext.SessionState.PSVariable.Remove('PSModuleAutoLoadingPreference')"
      : `$PSModuleAutoLoadingPreference = ${quote(preference)}`);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), { defined: preference !== null, preference });
  });
}

test('guided preflight accepts a verified adjacent ZIP instead of requiring extracted bin', () => {
  const start = source.indexOf("if ($Host.Name -cne 'ConsoleHost'");
  const preflight = source.slice(start, source.indexOf('Write-Host "Chrome extension ID:', start));
  assert.match(preflight, /Get-AdjacentSetupArchive/);
});

test('verified adjacent source ZIP resolves and passes read-only payload checks without executing source', windows, async t => {
  const result = await run(t);
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
  test(`adjacent ${name} fails before extraction or network`, windows, async t => {
    const result = await run(t, { mutation });
    assert.equal(result.error, error, JSON.stringify(result));
    assert.equal(result.expanded, 0);
    assert.equal(result.network, 0);
    assert.equal(result.cleaned, true);
  });
}

for (const name of ['../escape.txt', 'payload/../../escape.txt', 'payload/CON.txt', 'payload/custom.exe']) {
  test(`digest-verified unsafe member ${name} is rejected before expansion`, windows, async t => {
    const result = await run(t, { members: { 'bin.mjs': '// never executed', [name]: 'unsafe' } });
    assert.equal(result.error, 'payload_path_invalid', JSON.stringify(result));
    assert.equal(result.expanded, 0); assert.equal(result.network, 0); assert.equal(result.cleaned, true);
  });
}

test('uninstall refuses archived-only payload without extraction or fetch', windows, async t => {
  const result = await run(t, { uninstall: true });
  assert.equal(result.error, 'uninstall_inspection_unavailable');
  assert.equal(result.expanded, 0); assert.equal(result.network, 0);
});

test('bad adjacent archive cannot fall back to an existing extracted entry', windows, async t => {
  const result = await run(t, { extracted: true, mutation: "[IO.File]::AppendAllText($archive,'tampered')" });
  assert.equal(result.error, 'payload_digest_mismatch');
  assert.equal(result.expanded, 0); assert.equal(result.network, 0);
});

test('existing Assert-Payload rejects changed extracted source before any execution', windows, async t => {
  const result = await run(t, { mutation: "$lines[0]=('0'*64)+'  bin.mjs'; [IO.File]::WriteAllText($sums,($lines -join [Environment]::NewLine)+[Environment]::NewLine)" });
  assert.equal(result.error, 'payload_digest_mismatch');
  assert.equal(result.expanded, 1); assert.equal(result.network, 0); assert.equal(result.cleaned, true);
});

test('missing adjacent archive retains remote legacy route, intercepted before any network', windows, async t => {
  const result = await run(t, { mutation: 'Remove-Item -LiteralPath $archive' });
  assert.equal(result.error, 'fixture_network_forbidden');
  assert.equal(result.network, 1); assert.equal(result.expanded, 0); assert.equal(result.cleaned, true);
});

test('administrator handoff binds verified original sidecars without copying or executing the runtime', windows, async t => {
  const result = await run(t, { administrator: true });
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
  test(`declared local administrator closure rejects ${name} without remote fallback`, windows, async t => {
    const result = await run(t, { administrator: true, mutation });
    assert.equal(result.error, error, JSON.stringify(result));
    assert.equal(result.network, 0); assert.equal(result.cleaned, true);
  });
}
