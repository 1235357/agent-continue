import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installer = path.join(repo, 'native/bootstrap/install.ps1');
const windows = { skip: process.platform !== 'win32', timeout: 20000 };
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows',
  'System32/WindowsPowerShell/v1.0/powershell.exe');
const codes = [
  'browser_wake_invalid_install', 'browser_wake_owner_present',
  'browser_wake_registry_conflict', 'browser_wake_registry_unconfirmed',
  'browser_wake_bundle_conflict', 'manager_operation_not_recorded',
];
const quote = value => `'${value.replaceAll("'", "''")}'`;
const activePowerShell = new Map();

function fixture(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, 'ac-installer-recovery-'));
  const children = new Set();
  activePowerShell.set(root, children);
  t.after(async () => {
    // A case timeout must close its child before removing that child's fixture.
    activePowerShell.delete(root);
    const running = [...children];
    for (const run of running) run.child.kill();
    await Promise.all(running.map(run => run.closed));
    assert.equal(path.dirname(root), parent);
    assert.match(path.basename(root), /^ac-installer-recovery-[a-zA-Z0-9]{6}$/);
    assert.equal(fs.realpathSync(root), root);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function snapshot(root) {
  if (!fs.existsSync(root)) return null;
  return fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => {
      const file = path.join(root, entry.name);
      const info = fs.lstatSync(file);
      assert.equal(info.isSymbolicLink(), false);
      return [entry.name, info.mtimeMs, entry.isDirectory() ? snapshot(file)
        : createHash('sha256').update(fs.readFileSync(file)).digest('hex')];
    });
}

function pinFixtureEntry(root) {
  const digest = createHash('sha256').update(fs.readFileSync(path.join(root, 'bin.mjs'))).digest('hex');
  fs.writeFileSync(path.join(root, 'SHA256SUMS.txt'), `${digest}  bin.mjs\n`);
}

async function runPowerShell(t, root, body, phase = 'fixture') {
  t.signal.throwIfAborted();
  const children = activePowerShell.get(root);
  assert.ok(children, 'fixture must remain open until its PowerShell child closes');
  const script = path.join(root, 'harness.ps1');
  fs.writeFileSync(script, `$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1')
$env:PROCESSOR_ARCHITECTURE = 'AMD64'
$env:PROCESSOR_ARCHITEW6432 = ''
${body}`, 'utf8');
  const started = performance.now();
  const label = `case=${JSON.stringify(t.name)} phase=${phase}`;
  // Unlike spawnSync, this lets the runner flush progress and enforce case timers.
  process.stderr.write(`[installer-recovery] start ${label} timeout_ms=15000\n`);
  const run = {};
  run.closed = new Promise(resolve => {
    let result;
    run.child = execFile(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script], {
      encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024, signal: t.signal,
      env: {
        SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
        SystemDrive: process.env.SystemDrive, ComSpec: process.env.ComSpec,
        PATH: path.join(process.env.SystemRoot, 'System32'), PATHEXT: '.COM;.EXE;.BAT;.CMD',
        TEMP: root, TMP: root, LOCALAPPDATA: path.join(root, 'local'),
        PROCESSOR_ARCHITECTURE: 'AMD64', PROCESSOR_ARCHITEW6432: '', OS: 'Windows_NT',
        PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules'),
      },
    }, (error, stdout, stderr) => {
      result = { stdout, stderr,
        error: error?.killed || typeof error?.code !== 'number' ? error : null };
    });
    // AbortSignal may invoke the callback before OS exit; cleanup waits for close.
    run.child.once('close', (status, signal) => {
      children.delete(run);
      resolve({ ...result, status, signal });
    });
    children.add(run);
  });
  const result = await run.closed;
  process.stderr.write(`[installer-recovery] end ${label} elapsed_ms=${Math.round(performance.now() - started)}`
    + ` status=${result.status} signal=${result.signal} error=${result.error?.code || 'none'}\n`);
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  t.signal.throwIfAborted();
  return result;
}

function loadFunctions(names) {
  return `
$source = [IO.File]::ReadAllText(${quote(installer)})
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'installer_parse_failed' }
$definitions = @($ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst]
}, $true))
foreach ($name in @(${names.map(quote).join(', ')})) {
    $definition = @($definitions | Where-Object { $_.Name -ceq $name })
    if ($definition.Count -ne 1) { throw 'fixture_definition_invalid' }
    . ([scriptblock]::Create($definition[0].Extent.Text))
}
`;
}

for (const code of codes) {
  test(`installer preserves exact bounded diagnostic ${code}`, windows, async t => {
    const root = fixture(t);
    const payload = path.join(root, 'bin.mjs');
    fs.writeFileSync(payload, `process.stdout.write(${JSON.stringify(JSON.stringify({ ok: false, error: code }))}); process.exit(7);`);
    const result = await runPowerShell(t, root, `${loadFunctions([
      'Get-InstallFailureCode', 'Get-BootstrapFailureCode', 'Invoke-Bootstrap',
    ])}
$json = ${quote(JSON.stringify({ ok: false, error: code }))}
$script:acNode = ${quote(process.execPath)}
$script:acPayloadRoot = ${quote(root)}
try { $null = Invoke-Bootstrap @('verify'); throw 'fixture_expected_failure' }
catch { $invoked = Get-InstallFailureCode $_.Exception.Message }
[Console]::WriteLine((@{
    direct = (Get-InstallFailureCode ${quote(code)})
    bootstrap = (Get-BootstrapFailureCode $json 7)
    invoked = $invoked
} | ConvertTo-Json -Compress))`, 'diagnostic');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), { direct: code, bootstrap: code, invoked: code });
  });
}

test('installer diagnostics redact unknown strings and reject non-exact failure envelopes', windows, async t => {
  const root = fixture(t);
  const privateText = 'C:\\private\\runtime-key.txt synthetic-secret-value';
  const messages = ['', privateText, 'browser_wake_future_error', 'manager_operation_future_error',
    ...codes.flatMap(code => [code.toUpperCase(), ` ${code}`, `${code}\n`, `${code}: ${privateText}`])];
  const envelopes = [
    privateText, 'x'.repeat(65537), 'not json',
    ...messages.map(error => JSON.stringify({ ok: false, error })),
    ...codes.flatMap(error => [
      JSON.stringify({ ok: true, error }), JSON.stringify({ ok: 0, error }),
      JSON.stringify({ ok: false, error, secret: privateText }),
      JSON.stringify({ ok: false, error: [error] }), JSON.stringify([{ ok: false, error }]),
      JSON.stringify({ ok: false }),
    ]),
  ];
  fs.writeFileSync(path.join(root, 'invalid.json'), JSON.stringify({ messages, envelopes }));
  const result = await runPowerShell(t, root, `${loadFunctions(['Get-InstallFailureCode', 'Get-BootstrapFailureCode'])}
$cases = [IO.File]::ReadAllText(${quote(path.join(root, 'invalid.json'))}) | ConvertFrom-Json
[Console]::WriteLine((@{
    direct = @($cases.messages | ForEach-Object { Get-InstallFailureCode $_ })
    bootstrap = @($cases.envelopes | ForEach-Object { Get-BootstrapFailureCode $_ 7 })
} | ConvertTo-Json -Compress))`, 'redaction');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const actual = JSON.parse(result.stdout);
  assert.deepEqual(actual.direct, messages.map(() => 'local_install_failed'));
  assert.deepEqual(actual.bootstrap, envelopes.map(() => 'bootstrap_failed_exit_7'));
  assert.equal(result.stdout.includes(privateText), false);
});

function uninstallOutput(installDir) {
  return {
    ok: true, dryRun: true,
    plan: {
      format: 'agent-continue-uninstall-plan', version: 1, os: 'windows', installRoot: installDir,
      owned: false, keepData: false,
      paths: { manifest: installDir + '\\native-host.json', launcher: installDir + '\\native-launcher.exe',
        host: installDir + '\\app\\device-native-host.mjs', state: installDir + '\\state' },
      steps: [
        ['disable-autostart', 'user-autostart-remove', 'pending'],
        ['stop-runtime', 'process-stop-owned', 'pending'],
        ['unregister', 'registry-remove-current-user', 'satisfied'],
        ['remove-files', 'write-files-remove', 'satisfied'],
      ].map(([id, action, state]) => ({ id, action, state, title: id, detail: '' })),
    },
  };
}

// Execute the real wrapper flow and portable-cache validator. Only OS discovery,
// the synthetic archive's pinned digest/version, and bootstrap execution are mocked.
async function runAction(t, { action, pathNode = 'missing', cache = 'valid', explicit = false, tamperEntry = false }) {
  const root = fixture(t);
  const local = path.join(root, 'local');
  fs.mkdirSync(local);
  const installDir = path.join(local, 'must-not-install');
  const stem = 'node-v22.23.4-win-x64';
  const cacheRoot = path.join(local, 'AgentContinueToolchain');
  const destination = path.join(cacheRoot, stem);
  const archive = destination + '.zip';
  const portable = path.join(destination, 'node.exe');
  const discovered = path.join(root, 'path-node.cmd');
  if (pathNode !== 'missing') {
    const version = { compatible: 'v24.0.0', old: 'v20.0.0', unreadable: 'not-a-version' }[pathNode];
    fs.writeFileSync(discovered, `@echo off\r\necho ${version}\r\nexit /b 0\r\n`);
  }
  if (cache !== 'missing') {
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(portable, 'synthetic-node-not-executable');
  }
  const traceFile = path.join(root, 'trace.jsonl');
  const config = {
    root, local, installDir, stem, cacheRoot, destination, archive, portable, discovered,
    pathNode, cache, traceFile,
    outputs: {
      verify: JSON.stringify({ ok: true, fixture: true }),
      status: JSON.stringify({ format: 'agent-continue-registration-status', installed: false, registered: 'not-registered' }),
      uninstall: JSON.stringify(uninstallOutput(installDir)),
    },
  };
  fs.writeFileSync(path.join(root, 'scenario.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(root, 'bin.mjs'), '// Never executed: bootstrap is a fixture boundary.\n');
  pinFixtureEntry(root);
  if (tamperEntry) fs.appendFileSync(path.join(root, 'bin.mjs'), '// changed after pinning\n');
  const args = `-${action} -InstallDir ${quote(installDir)}`
    + (explicit ? ` -NodePath ${quote(discovered)}` : '');
  const result = await runPowerShell(t, root, `${loadFunctions([])}
$global:scenario = [IO.File]::ReadAllText(${quote(path.join(root, 'scenario.json'))}) | ConvertFrom-Json
function Write-Trace($Value) {
    [IO.File]::AppendAllText($global:scenario.traceFile, ($Value | ConvertTo-Json -Compress -Depth 8) + [Environment]::NewLine)
}
function Invoke-WebRequest { Write-Trace @{ kind = 'forbidden-network' }; throw 'fixture_network_forbidden' }
function Expand-Archive { Write-Trace @{ kind = 'forbidden-extraction' }; throw 'fixture_extraction_forbidden' }
function Start-Process { Write-Trace @{ kind = 'forbidden-launch' }; throw 'fixture_launch_forbidden' }
function Get-Command($Name, $CommandType, [switch]$All, $ErrorAction) {
    Write-Trace @{ kind = 'discovery'; names = @($Name) }
    if ($global:scenario.pathNode -ceq 'unexpected') { throw 'synthetic-secret-resolution-error' }
    if ($global:scenario.pathNode -ceq 'missing') { return }
    if (@($Name).Count -eq 1 -and $Name -cne $global:scenario.discovered) { throw 'fixture_discovery_invalid' }
    return [pscustomobject]@{ Source = $global:scenario.discovered }
}
if ($global:scenario.cache -cnotin @('missing', 'incomplete')) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zipStage = Join-Path $global:scenario.root 'fixture.zip'
    $zip = [IO.Compression.ZipFile]::Open($zipStage, [IO.Compression.ZipArchiveMode]::Create)
    try {
        $entry = $zip.CreateEntry($global:scenario.stem + '/node.exe')
        $stream = $entry.Open()
        try {
            $bytes = [IO.File]::ReadAllBytes($global:scenario.portable)
            $stream.Write($bytes, 0, $bytes.Length)
        } finally { $stream.Dispose() }
    } finally { $zip.Dispose() }
    [IO.File]::Move($zipStage, $global:scenario.archive)
    if ($global:scenario.cache -ceq 'tampered') { [IO.File]::AppendAllText($global:scenario.portable, 'tampered') }
}
$replacements = @{}
$version = @($definitions | Where-Object { $_.Name -ceq 'Get-NodeVersion' })
if ($version.Count -ne 1) { throw 'fixture_definition_invalid' }
$replacements['Get-NodeVersion'] = $version[0].Extent.Text.Replace('function Get-NodeVersion', 'function Get-FixtureNodeVersion') + @'

function Get-FileHash($LiteralPath, $Algorithm) {
    if ($LiteralPath -ceq $global:scenario.archive -and $global:scenario.cache -cne 'bad-archive') {
        Write-Trace @{ kind = 'archive-pin'; path = $LiteralPath }
        return [pscustomobject]@{ Hash = 'cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20' }
    }
    Microsoft.PowerShell.Utility\\Get-FileHash -LiteralPath $LiteralPath -Algorithm $Algorithm
}

function Get-NodeVersion([string]$Executable) {
    if ($Executable -ceq $global:scenario.portable) {
        Write-Trace @{ kind = 'portable-version'; path = $Executable }
        return '22.23.4'
    }
    return Get-FixtureNodeVersion $Executable
}
'@
$replacements['Invoke-Bootstrap'] = @'
function Invoke-Bootstrap([string[]]$Arguments) {
    Write-Trace @{ kind = 'bootstrap'; node = $script:acNode; arguments = $Arguments }
    if ($Arguments[0] -cnotin @('verify', 'status', 'uninstall')) { throw 'fixture_action_forbidden' }
    return $global:scenario.outputs.($Arguments[0])
}
'@
foreach ($name in $replacements.Keys) {
    if (@($definitions | Where-Object { $_.Name -ceq $name }).Count -ne 1) { throw 'fixture_definition_invalid' }
}
foreach ($definition in ($definitions | Where-Object { $replacements.ContainsKey($_.Name) } |
    Sort-Object { $_.Extent.StartOffset } -Descending)) {
    $source = $source.Remove($definition.Extent.StartOffset,
        $definition.Extent.EndOffset - $definition.Extent.StartOffset).Insert(
        $definition.Extent.StartOffset, $replacements[$definition.Name])
}
$copy = Join-Path $global:scenario.root 'install.ps1'
[IO.File]::WriteAllText($copy, $source)
$before = @(Get-ChildItem -LiteralPath $global:scenario.local -Recurse -Force | ForEach-Object {
    @{ path = $_.FullName; length = $(if ($_ -is [IO.FileInfo]) { $_.Length } else { 0 }); ticks = $(if ($_ -is [IO.FileInfo]) { $_.LastWriteTimeUtc.Ticks } else { 0 })
       hash = $(if ($_ -is [IO.FileInfo]) { (Microsoft.PowerShell.Utility\\Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } else { '' }) }
}) | ConvertTo-Json -Compress -Depth 8
[IO.File]::WriteAllText((Join-Path $global:scenario.root 'before.json'), $before)
& $copy ${args}
exit $LASTEXITCODE
`, 'wrapper');
  assert.ok(fs.existsSync(path.join(root, 'before.json')), result.stderr || 'fixture setup did not finish');
  const before = JSON.parse(fs.readFileSync(path.join(root, 'before.json'), 'utf8') || 'null');
  const after = await runPowerShell(t, root, `
$rows = @(Get-ChildItem -LiteralPath ${quote(local)} -Recurse -Force | ForEach-Object {
    @{ path = $_.FullName; length = $(if ($_ -is [IO.FileInfo]) { $_.Length } else { 0 }); ticks = $(if ($_ -is [IO.FileInfo]) { $_.LastWriteTimeUtc.Ticks } else { 0 })
       hash = $(if ($_ -is [IO.FileInfo]) { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } else { '' }) }
})
[Console]::WriteLine((ConvertTo-Json -InputObject $rows -Compress -Depth 8))`, 'cache-readback');
  assert.equal(after.status, 0, after.stderr);
  const normalize = value => (value === null ? [] : Array.isArray(value) ? value : [value]);
  assert.deepEqual(normalize(JSON.parse(after.stdout)), normalize(before), 'inspection must not modify the fixture cache or installation');
  const trace = fs.existsSync(traceFile)
    ? fs.readFileSync(traceFile, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line)) : [];
  assert.equal(trace.some(row => row.kind.startsWith('forbidden-')), false);
  assert.equal(fs.existsSync(installDir), false);
  return { result, trace, portable, discovered };
}

test('read-only installer still rejects a changed entry despite a synthetic digest list', windows, async t => {
  const { result, trace } = await runAction(t, { action: 'Verify', tamperEntry: true });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'agent_continue_install_failed: payload_digest_mismatch');
  assert.equal(trace.some(row => row.kind === 'bootstrap'), false);
});

for (const action of ['Verify', 'Uninstall']) {
  for (const pathNode of ['missing', 'old', 'unreadable']) {
    test(`${action} reuses validated portable Node when PATH Node is ${pathNode}`, windows, async t => {
      const { result, trace, portable } = await runAction(t, { action, pathNode });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      const receipt = JSON.parse(result.stdout);
      assert.equal(receipt.ok, true);
      assert.equal(receipt.action, action.toLowerCase());
      assert.equal(receipt.node, '22.23.4');
      if (action === 'Uninstall') assert.equal(receipt.dryRun, true);
      assert.ok(trace.some(row => row.kind === 'archive-pin'));
      assert.ok(trace.some(row => row.kind === 'portable-version'));
      const bootstrap = trace.filter(row => row.kind === 'bootstrap');
      assert.deepEqual(bootstrap.map(row => row.arguments[0]), action === 'Verify' ? ['verify'] : ['status', 'uninstall']);
      assert.ok(bootstrap.every(row => row.node === portable));
    });
  }

  for (const [cache, expected] of [
    ['missing', 'node_not_found'], ['incomplete', 'node_not_found'],
    ['bad-archive', 'node_archive_digest_mismatch'], ['tampered', 'node_provision_existing_invalid'],
  ]) {
    test(`${action} fails closed with ${cache} portable cache without provisioning`, windows, async t => {
      const { result, trace } = await runAction(t, { action, cache });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr.trim(), `agent_continue_install_failed: ${expected}`);
      assert.equal(trace.some(row => row.kind === 'bootstrap'), false);
    });
  }

  for (const [pathNode, expected] of [
    ['missing', 'node_not_found'], ['old', 'node_version_too_old'], ['unreadable', 'node_version_unreadable'],
  ]) {
    test(`${action} keeps explicit ${pathNode} NodePath strict despite valid portable cache`, windows, async t => {
      const { result, trace } = await runAction(t, { action, pathNode, explicit: true });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr.trim(), `agent_continue_install_failed: ${expected}`);
      assert.equal(trace.some(row => ['archive-pin', 'portable-version', 'bootstrap'].includes(row.kind)), false);
    });
  }

  test(`${action} prefers compatible PATH Node without inspecting portable cache`, windows, async t => {
    const { result, trace, discovered } = await runAction(t, { action, pathNode: 'compatible', cache: 'bad-archive' });
    assert.equal(result.status, 0, result.stderr + JSON.stringify(trace));
    assert.equal(JSON.parse(result.stdout).node, '24.0.0');
    assert.equal(trace.some(row => ['archive-pin', 'portable-version'].includes(row.kind)), false);
    assert.ok(trace.filter(row => row.kind === 'bootstrap').every(row => row.node === discovered));
  });

  test(`${action} does not retry unexpected discovery failures and redacts their text`, windows, async t => {
    const { result, trace } = await runAction(t, { action, pathNode: 'unexpected' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trim(), 'agent_continue_install_failed: local_install_failed');
    assert.equal(trace.some(row => ['archive-pin', 'portable-version', 'bootstrap'].includes(row.kind)), false);
  });
}

test('standalone portable reuse with no cache is read-only and offline', windows, async t => {
  const root = fixture(t);
  const local = path.join(root, 'local');
  fs.mkdirSync(local);
  const before = snapshot(local);
  const result = await runPowerShell(t, root, `${loadFunctions(['Install-PortableNode'])}
$script:acArch = 'x64'; $InstallLocal = $false; $Consent = ''; $NodePath = ''
function Invoke-WebRequest { throw 'fixture_network_forbidden' }
try { $null = Install-PortableNode -ReuseOnly; throw 'fixture_expected_failure' }
catch { [Console]::WriteLine($_.Exception.Message) }`, 'portable-reuse');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'node_not_found');
  assert.equal(result.stderr, '');
  assert.deepEqual(snapshot(local), before);
});

test('browser-managed installer observation uses its own closed read-only PowerShell dispatch', windows, async t => {
  const root = fixture(t), copy = path.join(root, 'install.ps1'), target = path.join(root, 'must-not-install');
  fs.copyFileSync(installer, copy);
  fs.writeFileSync(path.join(root, 'bin.mjs'), 'console.log(JSON.stringify({fixture:true,args:process.argv.slice(2)}));\n');
  pinFixtureEntry(root);
  const result = await runPowerShell(t, root, `
& ${quote(copy)} -DeviceAction browser-installer-status -InstallDir ${quote(target)} -NodePath ${quote(process.execPath)}
exit $LASTEXITCODE`, 'browser-status');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { fixture: true, args: ['browser-install-status', '--install-dir', target] });
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.existsSync(path.join(root, 'local')), false);
});

test('browser-managed installer observation refuses operation IDs and mutating flags before Node dispatch', windows, async t => {
  const root = fixture(t), copy = path.join(root, 'install.ps1');
  fs.copyFileSync(installer, copy);
  fs.writeFileSync(path.join(root, 'bin.mjs'), 'console.log("unexpected-node-dispatch");\n');
  for (const flags of ['-OperationId aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '-Apply', '-Consent accept-control']) {
    const result = await runPowerShell(t, root, `
& ${quote(copy)} -DeviceAction browser-installer-status -NodePath ${quote(process.execPath)} ${flags}
exit $LASTEXITCODE`, `browser-refusal-${flags.split(' ')[0]}`);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trim(), 'agent_continue_install_failed: invalid_manager_arguments');
  }
});
