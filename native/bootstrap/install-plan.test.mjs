import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInstallPlan, buildUninstallPlan, HOST_NAME, planJson } from './install-plan.mjs';
import { main } from './bin.mjs';
import { run } from '../../cli.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ID = 'a'.repeat(32);
const base = { os: 'windows', arch: 'x64', installRoot: 'C:\\Users\\u\\AppData\\Local\\AgentContinue',
  extensionId: ID, nodeVersion: '22.13.0' };

test('install and uninstall roots must match the selected platform', () => {
  for (const [os, installRoot] of [['windows','/home/u/app'],['linux','C:\\app'],['macos','C:\\app']]) {
    assert.throws(() => buildInstallPlan({...base,os,installRoot}), /invalid_install_root/);
    assert.throws(() => buildUninstallPlan({os,installRoot}), /invalid_install_root/);
  }
});

test('windows plan is current-user, no elevation, seven ordered steps', () => {
  const plan = buildInstallPlan(base, { defaultWindowsEntry: true });
  assert.equal(plan.format, 'agent-continue-install-plan');
  assert.equal(plan.elevation, false);
  assert.equal(plan.registry.hive, 'HKCU');
  assert.equal(plan.registry.view, '64');
  assert.equal(plan.registry.keyPath, 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\' + HOST_NAME);
  assert.deepEqual(plan.steps.map(step => step.id),
    ['preflight', 'verify-payload', 'stage', 'write-manifest', 'register-hkcu', 'autostart', 'verify']);
  assert.equal(plan.steps.find(step => step.id === 'register-hkcu').action, 'registry-write-current-user');
  assert.equal(plan.entry.remote, null);
  assert.equal(plan.entry.local, ".\\install.ps1 -InstallLocal -Consent accept-install -PromptForConnection -ExtensionId '" + ID + "'");
  assert.equal(plan.entry.cmd, 'install.cmd guided ' + ID);
  assert.doesNotMatch(planJson(plan), /ExecutionPolicy|Invoke-WebRequest|@latest/);
});

test('32-bit shell still plans the 64-bit view only when architecture is ia32', () => {
  assert.equal(buildInstallPlan({ ...base, arch: 'ia32' }).registry.view, '32');
  assert.equal(buildInstallPlan({ ...base, arch: 'arm64' }).registry.view, '64');
});

test('macOS and Linux plans never mention a registry hive', () => {
  for (const [os, root, kind] of [['macos', '/Users/u/Library/Application Support/AgentContinue', 'launch-agent'],
    ['linux', '/home/u/.local/share/agent-continue', 'systemd-user']]) {
    const plan = buildInstallPlan({ ...base, os, arch: 'arm64', installRoot: root });
    assert.equal(plan.registry, null);
    assert.equal(plan.autostart.kind, kind);
    assert.deepEqual(plan.steps.map(step => step.id),
      ['preflight', 'verify-payload', 'stage', 'write-manifest', 'register-manifest', 'autostart', 'verify']);
    assert.match(plan.paths.manifest, /native-host\.json$/);
    assert.equal(plan.entry.local, null);
  }
});

test('inspection flips steps to satisfied and marks re-runs as already installed', () => {
  const plan = buildInstallPlan({ ...base,
    inspection: { installed: true, manifestPresent: true, registered: true, autostart: true } });
  assert.equal(plan.alreadyInstalled, true);
  for (const step of plan.steps) {
    if (['preflight', 'verify-payload', 'verify'].includes(step.id)) continue;
    assert.equal(step.state, 'satisfied', step.id);
  }
});

test('plans are deterministic and JSON contains no secret fields', () => {
  const first = planJson(buildInstallPlan(base)), second = planJson(buildInstallPlan(base));
  assert.equal(first, second);
  assert.doesNotMatch(first, /api_key|runtime_key|secret|token/i);
});

test('invalid input is rejected with a stable code', () => {
  const cases = [
    [{ ...base, os: 'plan9' }, 'unsupported_os'],
    [{ ...base, arch: 'mips' }, 'unsupported_architecture'],
    [{ ...base, extensionId: 'A'.repeat(32) }, 'invalid_extension_id'],
    [{ ...base, extensionId: 'a'.repeat(31) }, 'invalid_extension_id'],
    [{ ...base, installRoot: 'AgentContinue' }, 'invalid_install_root'],
    [{ ...base, installRoot: 'C:\\x\\..\\y' }, 'invalid_install_root'],
    [{ ...base, nodeVersion: '22.12.0' }, 'node_version_too_old'],
    [{ ...base, nodeVersion: '22.13' }, 'invalid_node_version'],
    [{ ...base, extra: 'x' }, 'invalid_plan_input'],
    [{ ...base, inspection: { installed: true } }, 'invalid_inspection'],
  ];
  for (const [input, code] of cases) assert.throws(() => buildInstallPlan(input), { message: code });
});

test('uninstall removes autostart before unregistering and deleting files', () => {
  const plan = buildUninstallPlan({ os: 'windows', installRoot: base.installRoot,
    registeredValue: 'C:\\Users\\u\\AppData\\Local\\AgentContinue\\native-host.json',
    inspection: { installed: true, manifestPresent: true, registered: true, autostart: true } });
  assert.equal(plan.format, 'agent-continue-uninstall-plan');
  assert.equal(plan.owned, true);
  assert.equal(plan.keepData, false);
  assert.deepEqual(plan.steps.map(step => step.id),
    ['disable-autostart', 'stop-runtime', 'unregister', 'remove-files']);
});

test('uninstall refuses ownership when the registered value points elsewhere', () => {
  const plan = buildUninstallPlan({ os: 'windows', installRoot: base.installRoot,
    registeredValue: 'C:\\Other\\AgentContinue\\native-host.json',
    inspection: { installed: true, manifestPresent: true, registered: true, autostart: false } });
  assert.equal(plan.owned, false);
  assert.match(plan.steps.find(step => step.id === 'unregister').detail, /does not match/);
  assert.equal(plan.steps.find(step => step.id === 'disable-autostart').state, 'satisfied');
});

test('CLI plan path is read-only and returns the same plan', async () => {
  const result = await main(['install-plan', '--os', 'windows', '--arch', 'x64',
    '--install-dir', base.installRoot, '--extension-id', ID, '--node-version', '22.13.0']);
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan, JSON.parse(planJson(buildInstallPlan(base))));
  await assert.rejects(main(['install-plan', '--os', 'windows']), { message: 'invalid_arguments' });
});

test('Windows npm setup plans do not suggest a default-only command for a custom root',
  { skip: process.platform !== 'win32' || !process.env.LOCALAPPDATA }, async () => {
    const args = ['setup', '--extension-id', ID];
    const normal = await run(args);
    assert.equal(normal.dryRun, true);
    assert.equal(normal.command, normal.plan.entry.local);
    assert.match(normal.command, /-PromptForConnection/);
    const custom = await run([...args, '--install-dir', 'C:\\fixture\\custom-root']);
    assert.equal(custom.plan.installRoot, 'C:\\fixture\\custom-root');
    assert.equal(custom.command, null);
    assert.equal(custom.plan.entry.local, null);
    assert.equal(custom.plan.entry.cmd, undefined);
  });

test('CLI uninstall is always a dry-run', async () => {
  const result = await main(['uninstall', '--os', 'windows', '--install-dir', base.installRoot,
    '--installed', 'true', '--registered', 'true', '--autostart', 'true']);
  assert.equal(result.dryRun, true);
  assert.equal(result.plan.steps[0].id, 'disable-autostart');
});

test('installer scripts keep the safety skeleton and never elevate or write the registry', () => {
  const ps1 = fs.readFileSync(path.join(here, 'install.ps1'), 'utf8');
  const cmd = fs.readFileSync(path.join(here, 'install.cmd'), 'utf8');
  for (const marker of ['$ErrorActionPreference', 'trap {', 'finally {', 'Get-FileHash', 'payload_digest_mismatch',
    'consent_required', 'node_version_too_old', 'install-plan']) {
    assert.ok(ps1.includes(marker), 'install.ps1 missing ' + marker);
  }
  for (const forbidden of ['-Verb RunAs', 'reg add', 'reg.exe', 'New-ItemProperty', 'Set-ExecutionPolicy', 'HKLM']) {
    assert.equal(ps1.includes(forbidden), false, 'install.ps1 must not contain ' + forbidden);
  }
  assert.match(cmd, /node "%~dp0bin\.mjs" %\*/);
  assert.match(cmd, /-InstallLocal -Consent accept-install -PromptForConnection/);
  assert.doesNotMatch(cmd, /ExecutionPolicy|Unblock-File|Bypass|RunAs/);
  assert.match(cmd, /exit \/b %ERRORLEVEL%/);
});

test('installer rejects a tampered payload path before writing anything', () => {
  const ps1 = fs.readFileSync(path.join(here, 'install.ps1'), 'utf8');
  assert.match(ps1, /payload_path_invalid/);
  assert.match(ps1, /if \(\(\$script:acReleaseTag -or \(\$Apply -and \$script:acRemote\)\) -and -not \$AllowUnverifiedPayload\)/);
  assert.equal(/-Apply\b/.test(ps1), true);
});

test('Windows verification uses failing verifier and propagates bootstrap exit', () => {
  const ps1 = fs.readFileSync(path.join(here, 'install.ps1'), 'utf8');
  const start = ps1.indexOf('if ($Verify)');
  assert.ok(start >= 0);
  const branch = ps1.slice(start, ps1.indexOf('if (-not $ExtensionId', start));
  assert.match(branch, /Invoke-Bootstrap @\('verify', '--json'/);
  assert.doesNotMatch(branch, /Invoke-Bootstrap @\('status'/);
  assert.match(ps1, /\$bootstrapExit = \$LASTEXITCODE/);
  assert.match(ps1, /if \(\$bootstrapExit -ne 0\) \{ throw/);
});

test('Windows manager preparation requires consent but not tunnel credentials', () => {
  const ps1 = fs.readFileSync(path.join(here, 'install.ps1'), 'utf8');
  assert.match(ps1, /\[switch\]\$ManagerOnly/);
  assert.match(ps1, /-not \$InstallLocal -and \(\$TunnelId -or \$RuntimeKeyFile\)/);
  const start = ps1.indexOf('if ($ManagerOnly)');
  const branch = ps1.slice(start, ps1.indexOf("if (-not $SetupRequest -or -not $TunnelId", start));
  assert.match(branch, /Invoke-Bootstrap @\('setup-manager'/);
  assert.match(branch, /return/);
  assert.match(ps1, /\$PrepareNative -and -not \$ManagerOnly/);
  assert.match(branch, /\$managerReceipt\.extensionId -cne \$ExtensionId/);
  assert.match(branch, /\$nativeReceipt = Invoke-NativeRelease \$true \$true/);
  assert.doesNotMatch(ps1, /Build-NativeLauncher\.ps1/);
  assert.match(ps1, /Prepare-ReleaseNative\.ps1/);
  assert.match(ps1, /\$RegisterNative -and -not \$PrepareNative/);
  assert.match(ps1, /if \(\$InstallLocal\)/);
  assert.match(ps1, /\$ExtensionId = \$requestedId/);
  assert.doesNotMatch(ps1, /\$Apply = \$true; \$ManagerOnly = \$true/);
  assert.match(ps1, /@\('install-local', '--install-dir'/);
  assert.match(branch, /Invoke-Bootstrap @\('register', '--os', 'windows'/);
  assert.match(branch, /registered = \[bool\]\$RegisterNative; manager = \$managerState; connected = \[bool\]/);
});

test('remote one-liner can rebuild its payload without leaving temp files', () => {
  const ps1 = fs.readFileSync(path.join(here, 'install.ps1'), 'utf8');
  // The `irm` entry downloads only install.ps1, so the script must fetch,
  // digest-check and expand the payload into a temp directory it later deletes.
  for (const marker of ['Resolve-Payload', 'SHA256SUMS.txt', 'agent-continue-setup.zip',
    'Expand-Archive', 'Assert-FileDigest', '$script:acTemp', 'Remove-Item -LiteralPath $script:acTemp']) {
    assert.ok(ps1.includes(marker), 'install.ps1 missing ' + marker);
  }
  assert.equal(ps1.includes('Invoke-Expression'), false);
});

test('unreleased macOS and Linux plans do not advertise a runnable install command', () => {
  for (const [os, root] of [['macos', '/Users/u/Library/Application Support/AgentContinue'],
    ['linux', '/home/u/.local/share/agent-continue']]) {
    const plan = buildInstallPlan({ ...base, os, arch: 'arm64', installRoot: root });
    assert.deepEqual(plan.entry, { kind: 'unavailable', local: null, remote: null });
  }
});
