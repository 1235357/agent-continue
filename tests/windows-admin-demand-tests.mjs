import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { administratorDemandLaunch } from '../native/desktop-commander/windows-admin-demand.mjs';

const digest = 'b'.repeat(64);
const root = 'C:\\Program Files\\AgentContinueAdmin\\' + digest.slice(0, 24);
const binding = {
  version: 1, bundleSha256: digest, userSid: 'S-1-5-21-1-2-3-1001',
  tunnelId: 'tunnel_' + 'a'.repeat(32), systemDirectory: 'C:\\Windows\\System32',
};

test('demand bootstrap builds a fixed no-shell launch without inheriting caller settings', () => {
  const { command, args, options } = administratorDemandLaunch(root, binding);
  assert.equal(command, binding.systemDirectory + '\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(args, ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
    '-File', root + '.browser\\stager.ps1', '-Action', 'StartHostedOwner', '-Archive', root + '.browser\\bundle.zip',
    '-ExpectedSha256', digest, '-ExpectedUserSid', binding.userSid, '-HostedTunnelId', binding.tunnelId,
    '-Consent', 'restore-authorized-administrator-owner', '-BrowserWake']);
  assert.equal(options.cwd, binding.systemDirectory);
  assert.equal(options.shell, false);
  assert.equal(options.windowsHide, true);
  assert.deepEqual(Object.keys(options.env), ['SystemRoot', 'WINDIR', 'SystemDrive', 'PATH', 'PATHEXT', 'ComSpec', 'TEMP', 'TMP']);
  assert.equal(options.env.PATHEXT, '.EXE');
  for (const invalid of [{ ...binding, command: 'override' }, { ...binding, userSid: 'S-1-5-18' },
    { ...binding, tunnelId: 'tunnel_with spaces' }, { ...binding, systemDirectory: 'C:\\Temp' }]) {
    assert.throws(() => administratorDemandLaunch(root, invalid), /administrator_demand_invalid/);
  }
});

test('the demand launch shape reaches real Windows PowerShell with a clean environment',
  { skip: process.platform !== 'win32' }, t => {
    const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ac-demand-test-'));
    t.after(() => {
      assert.match(path.basename(scratch), /^ac-demand-test-[a-zA-Z0-9]{6}$/);
      assert.equal(fs.realpathSync(scratch), scratch);
      fs.rmSync(scratch, { recursive: true, force: true });
    });
    const target = path.join(scratch, 'AgentContinueAdmin', digest.slice(0, 24));
    const temp = path.join(target + '.state', 'temp'), bridge = target + '.browser';
    fs.mkdirSync(temp, { recursive: true });
    fs.mkdirSync(bridge);
    fs.writeFileSync(path.join(bridge, 'stager.ps1'), [
      'param($Action,$Archive,$ExpectedSha256,$ExpectedUserSid,$HostedTunnelId,$Consent,[switch]$BrowserWake)',
      "if ($Action -cne 'StartHostedOwner' -or -not $BrowserWake -or !$env:ComSpec -or " +
        "$env:COR_ENABLE_PROFILING -or $env:PSExecutionPolicyPreference -or $env:NODE_OPTIONS -or " +
        "$env:CONTROL_PLANE_API_KEY -or $env:AGENTCONTINUE_TEST_AMBIENT) { exit 7 }",
      "$PSModuleAutoLoadingPreference = 'None'",
      "$system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)",
      "$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
      "$rows = @(& ([IO.Path]::Combine($system,'whoami.exe')) /user /fo csv /nh)",
      "if ($null -eq $LASTEXITCODE -or $LASTEXITCODE -ne 0 -or @($rows -match [regex]::Escape($sid)).Count -ne 1) { exit 8 }",
      "[Console]::WriteLine('AC_WINDOWS_DEMAND_CLEAN_ENV')",
    ].join('\r\n'));
    const original = process.env.AGENTCONTINUE_TEST_AMBIENT;
    process.env.AGENTCONTINUE_TEST_AMBIENT = 'do-not-inherit';
    try {
      const { command, args, options } = administratorDemandLaunch(target,
        { ...binding, systemDirectory: path.join(process.env.SystemRoot, 'System32') });
      const result = spawnSync(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8', timeout: 12000, maxBuffer: 8192 });
      assert.equal(result.status, 0, result.stderr || 'the absolute system whoami did not return the caller SID');
      assert.equal(result.stdout.trim(), 'AC_WINDOWS_DEMAND_CLEAN_ENV');
    } finally {
      if (original === undefined) delete process.env.AGENTCONTINUE_TEST_AMBIENT;
      else process.env.AGENTCONTINUE_TEST_AMBIENT = original;
    }
  });
