import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const launcher = fileURLToPath(new URL('../scripts/Invoke-WindowsHostedAcceptance.ps1', import.meta.url));
const tunnelId = 'tunnel_' + 'a1'.repeat(16);
const extensionId = 'abcdefghijklmnop'.repeat(2);
const start = ['-Action', 'Start'];
const approvedStart = [...start, '-Consent', 'accept-private-hosted-test'];
const keyName = 'AgentContinue-Acceptance-RuntimeKey.txt';
const settledId = '12345678-1234-4321-8123-123456789abc';
const unconfirmedId = '87654321-4321-4123-9123-fedcba987654';
const success = {
  ok: true, action: 'install-local', mode: 'command-only', configured: true, registered: false,
  connected: true, chatAuthorizationVerified: false, manager: {
    ok: true, managerRunning: true, connected: true, paused: false,
    operationStatus: 'settled', operationId: settledId,
  },
};
const unconfirmed = {
  ok: false, error: 'manager_start_unconfirmed', operationId: unconfirmedId, operationStatus: 'unknown-running',
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

const installer = `[CmdletBinding()]
param(
    [switch]$InstallLocal,
    [string]$Consent,
    [string]$SetupRequest,
    [string]$ExtensionId,
    [string]$TunnelId,
    [string]$RuntimeKeyFile,
    [string]$InstallDir
)
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
foreach ($module in @('Microsoft.PowerShell.Management', 'Microsoft.PowerShell.Utility')) {
    Import-Module ([IO.Path]::Combine($PSHOME, 'Modules', $module, "$module.psd1")) -ErrorAction Stop
}
$call = @{
    package = $PSScriptRoot; installLocal = [bool]$InstallLocal; consent = $Consent
    setupRequest = $SetupRequest; extensionId = $ExtensionId; tunnelId = $TunnelId
    runtimeKeyFile = $RuntimeKeyFile; installDir = $InstallDir
}
$audit = Join-Path $env:LOCALAPPDATA 'fixture-installer-calls.jsonl'
[IO.File]::AppendAllText($audit, (($call | ConvertTo-Json -Compress) + [Environment]::NewLine))

# Do not read or write paths supplied by a misbound launcher.
$expectedKey = if ($env:AC_FIXTURE_KEY) { $env:AC_FIXTURE_KEY } else { Join-Path $env:LOCALAPPDATA '${keyName}' }
$expectedManager = Join-Path $env:AC_FIXTURE_RUN_ROOT 'manager'
if ($RuntimeKeyFile -cne $expectedKey -or $InstallDir -cne $expectedManager -or
    -not (Test-Path -LiteralPath $expectedKey -PathType Leaf) -or
    (Test-Path -LiteralPath $expectedManager)) { exit 97 }
$null = [IO.Directory]::CreateDirectory($expectedManager)

if ($env:AC_FIXTURE_UNCONFIRMED -eq '1') {
    # Simulate a sensitive child diagnostic without changing the stdout receipt.
    [Console]::Error.WriteLine([IO.File]::ReadAllText($expectedKey).Trim())
    [Console]::Out.WriteLine('${JSON.stringify(unconfirmed)}')
    exit 23
}
[Console]::Out.WriteLine('${JSON.stringify(success)}')
exit 0
`;

function snapshot(root, inspect = () => {}) {
  const entries = [];
  function walk(relative) {
    for (const entry of readdirSync(path.join(root, relative), {withFileTypes: true})
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        entries.push([name, 'directory']);
        walk(name);
      } else {
        assert.ok(entry.isFile(), 'fixture must not contain links or special files');
        const bytes = readFileSync(path.join(root, name));
        inspect(name, bytes);
        entries.push([name, sha256(bytes)]);
      }
    }
  }
  walk('');
  return entries;
}

test('Windows hosted acceptance launcher with a local stub ZIP', {skip: process.platform !== 'win32'}, async t => {
  assert.ok(existsSync(launcher), 'expected scripts/Invoke-WindowsHostedAcceptance.ps1');
  const temporary = realpathSync.native(tmpdir());
  const scratch = mkdtempSync(path.join(temporary, 'ac hosted launcher fixture-'));
  t.after(() => {
    assert.equal(realpathSync.native(scratch), scratch);
    assert.equal(path.dirname(scratch), temporary);
    rmSync(scratch, {recursive: true, maxRetries: 5, retryDelay: 100});
  });

  const SystemRoot = process.env.SystemRoot;
  assert.ok(SystemRoot, 'expected a Windows system directory');
  const system32 = path.join(SystemRoot, 'System32');
  const powershell = path.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // Do not inherit credentials, proxy settings, or user PowerShell module paths.
  // PATHEXT keeps Windows PowerShell's nested .exe invocation synchronous.
  const env = {SystemRoot, OS: 'Windows_NT', PATH: [system32, path.dirname(powershell)].join(';'),
    PATHEXT: '.COM;.EXE;.BAT;.CMD', USERPROFILE: scratch, LOCALAPPDATA: scratch, TEMP: scratch, TMP: scratch};
  function run(args, cwd, extraEnv = {}, timeout = 15000) {
    const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', ...args], {
      cwd, env: {...env, ...extraEnv}, windowsHide: true, encoding: 'utf8', timeout, maxBuffer: 64 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  }

  const payload = path.join(scratch, 'zip input');
  const archive = path.join(scratch, 'stub setup.zip');
  mkdirSync(payload);
  writeFileSync(path.join(payload, 'install.ps1'), installer);
  writeFileSync(path.join(payload, 'bin.mjs'), 'throw new Error("fixture bin must not run");\n');
  const sums = ['install.ps1', 'bin.mjs'].map(name =>
    sha256(readFileSync(path.join(payload, name))) + '  ' + name + '\n').join('');
  writeFileSync(path.join(payload, 'SHA256SUMS.txt'), sums);
  const expectedSetup = snapshot(payload);
  // Fixture preparation is not a launcher operation. A cold hosted Windows
  // runner gets its own bounded assembly-load budget; launch checks stay 15s.
  const packed = run(['-Command', [
    "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem",
    '$zip = [IO.Compression.ZipFile]::Open($env:AC_FIXTURE_ARCHIVE, [IO.Compression.ZipArchiveMode]::Create)',
    "try { foreach ($name in @('install.ps1','bin.mjs','SHA256SUMS.txt')) {",
    '$null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, [IO.Path]::Combine($pwd.Path, $name), $name)',
    '} } finally { $zip.Dispose() }',
  ].join('; ')], payload, {AC_FIXTURE_ARCHIVE: archive}, 60000);
  assert.equal(packed.status, 0, packed.stderr);
  const digest = sha256(readFileSync(archive));

  const previewFiles = path.join(scratch, 'preview inputs');
  mkdirSync(previewFiles);
  writeFileSync(path.join(previewFiles, 'start.md'), '# Fixture\n');
  writeFileSync(path.join(previewFiles, 'manifest.json'), JSON.stringify({
    manifest_version: 3, version: '2.9.0', version_name: '2.9.0 Windows device preview',
  }));
  writeFileSync(path.join(previewFiles, 'setup.html'), '<title>Not extracted</title>\n');
  writeFileSync(path.join(previewFiles, 'install.cmd'), '@exit /b 99\n');
  writeFileSync(path.join(previewFiles, 'runtime.mjs'), '// Nested payload must stay nested.\n');
  // Windows/PowerShell can initialize profile caches in a disposable working
  // tree. They are not members of the synthetic installer payload.
  mkdirSync(path.join(payload, 'Microsoft'), {recursive: true});
  const setupFiles = expectedSetup.map(([name]) => [name, path.join(payload, name)]);
  const previewMembers = [
    ...setupFiles.map(([name, file]) => ['WindowsSetup/' + name, file]),
    ['WindowsSetup/install.cmd', path.join(previewFiles, 'install.cmd')],
    ['WindowsSetup/payload/runtime.mjs', path.join(previewFiles, 'runtime.mjs')],
    ['AgentContinue/manifest.json', path.join(previewFiles, 'manifest.json')],
    ['AgentContinue/setup.html', path.join(previewFiles, 'setup.html')],
    ['START-HERE.md', path.join(previewFiles, 'start.md')],
    ['SHA256SUMS.txt', path.join(payload, 'SHA256SUMS.txt')],
  ];
  function packPreview(label, members = previewMembers) {
    const zipPath = path.join(scratch, label + '.zip');
    const packedPreview = run(['-Command', [
      "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem",
      '$zip = [IO.Compression.ZipFile]::Open($env:AC_FIXTURE_ARCHIVE, [IO.Compression.ZipArchiveMode]::Create)',
      'try { foreach ($member in (ConvertFrom-Json $env:AC_FIXTURE_MEMBERS)) {',
      '$null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $member.file, $member.name)',
      '} } finally { $zip.Dispose() }',
    ].join('; ')], previewFiles, {AC_FIXTURE_ARCHIVE: zipPath,
      AC_FIXTURE_MEMBERS: JSON.stringify(members.map(([name, file]) => ({name, file})))}, 60000);
    assert.equal(packedPreview.status, 0, packedPreview.stderr);
    return {zipPath, zipDigest: sha256(readFileSync(zipPath))};
  }

  function fixture(runId, {withKey = true, pending = false, zipPath = archive, zipDigest = digest, explicitKey = false,
    coldModules = false, failModules = false} = {}) {
    const root = path.join(scratch, runId);
    const localAppData = path.join(root, 'Local AppData');
    const appData = path.join(root, 'AppData', 'Roaming');
    // Account for Windows PowerShell's own profile-directory initialization.
    mkdirSync(appData, {recursive: true});
    mkdirSync(path.join(localAppData, 'Microsoft', 'Windows', 'Caches'), {recursive: true});
    let invokedLauncher = launcher;
    if (coldModules || failModules) {
      invokedLauncher = path.join(root, 'cold-launcher.ps1');
      const source = readFileSync(launcher, 'utf8');
      const anchor = "$ErrorActionPreference = 'Stop'";
      assert.equal(source.split(anchor).length, 2);
      const coldPrelude = coldModules ? "$PSModuleAutoLoadingPreference = 'None'\n" : '';
      const failurePrelude = failModules ? "function Import-Module { throw 'synthetic-private-module-detail' }\n" : '';
      writeFileSync(invokedLauncher, source.replace(anchor, coldPrelude + failurePrelude + anchor));
    }
    const runRoot = path.join(localAppData, 'AgentContinueHostedAcceptance', 'run-' + runId);
    const keyFile = explicitKey ? path.join(root, 'existing owner key.txt') : path.join(localAppData, keyName);
    const secret = 'fixture-only-runtime-key-' + randomBytes(24).toString('hex');
    const writeKey = () => writeFileSync(keyFile, secret + '\n', {flag: 'wx'});
    if (withKey) writeKey();
    const needles = [Buffer.from(secret), Buffer.from(secret, 'utf16le')];

    function invoke(args = [], expectedDigest = zipDigest) {
      const result = run(['-File', invokedLauncher, '-Archive', zipPath, '-ExpectedSha256', expectedDigest,
        '-TunnelId', tunnelId, '-ExtensionId', extensionId, '-RunId', runId,
        ...(explicitKey ? ['-RuntimeKeyFile', keyFile] : []), ...args], root, {
        APPDATA: appData, LOCALAPPDATA: localAppData, USERPROFILE: root, TEMP: root, TMP: root,
        AC_FIXTURE_RUN_ROOT: runRoot, AC_FIXTURE_UNCONFIRMED: pending ? '1' : '0',
        ...(coldModules ? {PSModulePath: path.join(root, 'absent-modules')} : {}),
        ...(explicitKey ? {AC_FIXTURE_KEY: keyFile} : {}),
      });
      assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret),
        'launcher must not echo the synthetic key');
      assert.ok(result.stdout.trim(), 'launcher must return a bounded JSON receipt even without module discovery');
      return {status: result.status, receipt: JSON.parse(result.stdout)};
    }

    function unchanged(action) {
      const before = snapshot(root);
      action();
      assert.deepEqual(snapshot(root), before, 'launcher must not change the fixture tree');
    }

    function assertOneStart(expectedPackage = expectedSetup) {
      const calls = readFileSync(path.join(localAppData, 'fixture-installer-calls.jsonl'), 'utf8')
        .trim().split(/\r?\n/).map(line => JSON.parse(line));
      assert.deepEqual(calls, [{
        package: path.join(runRoot, 'package'), installLocal: true, consent: 'accept-install',
        setupRequest: path.join(runRoot, 'setup-request.json'), extensionId, tunnelId,
        runtimeKeyFile: keyFile, installDir: path.join(runRoot, 'manager'),
      }]);
      assert.deepEqual(snapshot(path.join(runRoot, 'package')), expectedPackage);
      assert.deepEqual(readJson(path.join(runRoot, 'setup-request.json')), {
        format: 'agent-continue-device-setup', version: 1, target: 'windows',
        extensionId, nativeHost: 'com.agentcontinue.device_control',
      });
      assert.ok(readdirSync(runRoot, {withFileTypes: true})
        .some(entry => entry.name === 'manager' && entry.isDirectory()), 'expected a staged manager directory');
      assert.ok(readFileSync(keyFile, 'utf8') === secret + '\n', 'original fake key must remain unchanged');
      snapshot(root, (name, bytes) => {
        if (path.join(root, name) !== keyFile) {
          assert.ok(needles.every(needle => !bytes.includes(needle)), 'launcher must not copy the synthetic key');
        }
      });
    }

    return {invoke, unchanged, assertOneStart, runRoot, writeKey};
  }

  function refuse({status, receipt}, error) {
    assert.ok(Number.isInteger(status) && status > 0, 'refusal must exit nonzero');
    assert.equal(receipt.ok, false);
    assert.equal(receipt.error, error);
  }

  await t.test('default Plan reports a missing key, then readiness, without writes', () => {
    const f = fixture('plan', {withKey: false});
    f.unchanged(() => {
      const {status, receipt: {ok, action, ready, reason, runRoot}} = f.invoke();
      assert.equal(status, 0);
      assert.deepEqual({ok, action, ready, reason, runRoot}, {
        ok: true, action: 'plan', ready: false, reason: 'acceptance_key_missing', runRoot: f.runRoot,
      });
    });
    f.writeKey();
    f.unchanged(() => {
      const {status, receipt: {ok, action, ready, runRoot}} = f.invoke();
      assert.equal(status, 0);
      assert.deepEqual({ok, action, ready, runRoot}, {ok: true, action: 'plan', ready: true, runRoot: f.runRoot});
    });
  });

  await t.test('cold Plan works without implicit module discovery or a caller module path', () => {
    const f = fixture('cold-modules', {coldModules: true, withKey: false});
    f.unchanged(() => {
      const {status, receipt} = f.invoke();
      assert.equal(status, 0);
      assert.equal(receipt.ready, false);
      assert.equal(receipt.reason, 'acceptance_key_missing');
      assert.equal(receipt.hostedToolCallVerified, false);
    });
  });

  await t.test('OS module initialization failure returns only a bounded refusal without staging a run', () => {
    const f = fixture('module-refusal', {failModules: true, withKey: false});
    f.unchanged(() => {
      const {status, receipt} = f.invoke();
      assert.equal(status, 1);
      assert.deepEqual(receipt, {ok: false, action: 'preflight', error: 'module_initialization_failed'});
    });
  });

  await t.test('Start refuses bad digest, missing or incorrect consent, and missing key without writes', () => {
    const f = fixture('refusal');
    const wrongDigest = (digest[0] === '0' ? '1' : '0') + digest.slice(1);
    f.unchanged(() => refuse(f.invoke(approvedStart, wrongDigest), 'archive_digest_mismatch'));
    f.unchanged(() => refuse(f.invoke(start), 'consent_required'));
    f.unchanged(() => refuse(f.invoke([...start, '-Consent', 'accept-install']), 'consent_required'));
    const noKey = fixture('no-key', {withKey: false});
    noKey.unchanged(() => refuse(noKey.invoke(approvedStart), 'acceptance_key_missing'));
  });

  await t.test('Start binds the staged installer once and refuses to reuse the run', () => {
    const f = fixture('start');
    const {status, receipt} = f.invoke(approvedStart);
    assert.equal(status, 0, receipt.error);
    const {ok, action, connected, hostedToolCallVerified, operationId} = receipt;
    assert.deepEqual({ok, action, connected, hostedToolCallVerified, operationId}, {
      ok: true, action: 'start', connected: true, hostedToolCallVerified: false, operationId: settledId,
    });
    f.assertOneStart();
    f.unchanged(() => refuse(f.invoke(approvedStart), 'run_exists'));
  });

  await t.test('Start references an explicitly supplied existing key outside the run without copying it', () => {
    const f = fixture('explicit-key', {explicitKey: true});
    f.unchanged(() => assert.equal(f.invoke().receipt.ready, true));
    const {status, receipt} = f.invoke(approvedStart);
    assert.equal(status, 0, receipt.error);
    assert.equal(receipt.operationId, settledId);
    f.assertOneStart();
  });

  await t.test('nonzero child exit preserves the unconfirmed operation without relaunching', () => {
    const f = fixture('unconfirmed', {pending: true});
    const result = f.invoke(approvedStart);
    refuse(result, unconfirmed.error);
    const {operationId, operationStatus, connected, hostedToolCallVerified} = result.receipt;
    assert.equal(operationId, unconfirmedId);
    assert.equal(operationStatus, 'unknown-running');
    assert.notEqual(connected, true);
    assert.equal(hostedToolCallVerified, false);
    f.assertOneStart();
    assert.deepEqual(readJson(path.join(f.runRoot, 'receipt.json')), result.receipt);
    f.unchanged(() => refuse(f.invoke(approvedStart), 'run_exists'));
  });

  await t.test('preview Plan verifies the exact ZIP and Start stages only its setup subtree', () => {
    const kit = packPreview('preview');
    const f = fixture('preview', kit);
    f.unchanged(() => {
      const {status, receipt} = f.invoke();
      assert.equal(status, 0, receipt.error);
      assert.equal(receipt.archiveSha256, kit.zipDigest);
      assert.equal(receipt.archiveLayout, 'windows-preview-kit');
      assert.equal(receipt.ready, true);
      assert.equal(receipt.hostedToolCallVerified, false);
    });
    const {status, receipt} = f.invoke(approvedStart);
    assert.equal(status, 0, receipt.error);
    assert.equal(receipt.archiveSha256, kit.zipDigest);
    assert.equal(receipt.archiveLayout, 'windows-preview-kit');
    assert.equal(receipt.hostedToolCallVerified, false);
    const expected = [
      ...expectedSetup,
      ['install.cmd', sha256(readFileSync(path.join(previewFiles, 'install.cmd')))],
      ['payload', 'directory'],
    ].sort(([left], [right]) => left.localeCompare(right));
    expected.splice(expected.findIndex(([name]) => name === 'payload') + 1, 0,
      [path.join('payload', 'runtime.mjs'), sha256(readFileSync(path.join(previewFiles, 'runtime.mjs')))]);
    f.assertOneStart(expected);
  });

  await t.test('preview refuses mixed roots, traversal, and case-insensitive file/directory collisions', () => {
    for (const [label, names] of [
      ['mixed', ['install.ps1', 'bin.mjs']],
      ['escape', ['WindowsSetup/../escape.ps1']],
      ['collision', ['WindowsSetup/Payload']],
      ['case-alias', ['windowssetup/another.mjs']],
    ]) {
      const kit = packPreview(label, [...previewMembers, ...names.map(name => [name, setupFiles[0][1]])]);
      const f = fixture(label, kit);
      f.unchanged(() => refuse(f.invoke(approvedStart), 'archive_invalid'));
    }
  });

  await t.test('Start never runs an installer when a setup entry exceeds its declared size', () => {
    const {zipPath} = packPreview('bad-size');
    const bytes = readFileSync(zipPath);
    const directoryEnd = bytes.lastIndexOf(Buffer.from('504b0506', 'hex'));
    assert.ok(directoryEnd > 0, 'expected ZIP directory end');
    let changed = false;
    for (let offset = bytes.readUInt32LE(directoryEnd + 16); offset < directoryEnd;) {
      assert.equal(bytes.readUInt32LE(offset), 0x02014b50, 'expected central entry');
      const nameLength = bytes.readUInt16LE(offset + 28);
      const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
      if (name === 'WindowsSetup/payload/runtime.mjs') {
        assert.ok(bytes.readUInt32LE(offset + 24) > 1);
        bytes.writeUInt32LE(1, offset + 24);
        changed = true;
        break;
      }
      offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    }
    assert.ok(changed, 'expected runtime fixture member');
    writeFileSync(zipPath, bytes);
    const f = fixture('bad-size', {zipPath, zipDigest: sha256(bytes)});
    refuse(f.invoke(approvedStart), 'archive_invalid');
    assert.equal(existsSync(path.join(f.runRoot, 'setup-request.json')), false);
    assert.equal(existsSync(path.join(path.dirname(path.dirname(f.runRoot)), 'fixture-installer-calls.jsonl')), false);
  });

  const suppliedKit = process.env.AGENT_CONTINUE_HOSTED_PLAN_TEST_KIT;
  await t.test('Plan accepts the freshly built preview kit without opening a key or staging a run',
    {skip: !suppliedKit}, () => {
      const zipPath = realpathSync.native(suppliedKit);
      const [zipDigest] = readFileSync(zipPath + '.sha256', 'ascii').trim().split('  ');
      assert.equal(sha256(readFileSync(zipPath)), zipDigest);
      const f = fixture('built-preview', {zipPath, zipDigest, withKey: false});
      f.unchanged(() => {
        const {status, receipt} = f.invoke();
        assert.equal(status, 0, receipt.error);
        assert.equal(receipt.archiveLayout, 'windows-preview-kit');
        assert.equal(receipt.archiveSha256, zipDigest);
        assert.equal(receipt.ready, false);
        assert.equal(receipt.reason, 'acceptance_key_missing');
        assert.equal(receipt.hostedToolCallVerified, false);
      });
    });
});
