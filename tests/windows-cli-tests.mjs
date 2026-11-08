import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWindowsSetupArguments, windowsSetup } from '../cli.mjs';

const current = ['--account', 'current', '--extension-id', 'a'.repeat(32), '--consent', 'accept-install'];
const administrator = ['--account', 'administrator', '--extension-id', 'a'.repeat(32),
  '--consent', 'accept-administrator-browser-installation'];

test('Windows setup has one consented account-scoped command, not raw key or shell arguments', () => {
  assert.deepEqual(parseWindowsSetupArguments(current), { account: 'current', extensionId: 'a'.repeat(32), consent: 'accept-install' });
  assert.equal(parseWindowsSetupArguments([...administrator, '--setup-id', 'b'.repeat(32)]).setupId, 'b'.repeat(32));
  for (const extra of [['--runtime-key', 'secret'], ['--shell', 'cmd.exe'], ['--release-root', 'C:\\other'],
    ['--tunnel-id', 'untrusted'], ['--extension-id', 'b'.repeat(32)], ['--setup-request', 'file.json']]) {
    assert.throws(() => parseWindowsSetupArguments([...current, ...extra]), /invalid_arguments/);
  }
});

test('missing or mixed consent cannot choose a more privileged installer', () => {
  for (const args of [[], current.slice(0, -2), [...administrator.slice(0, -1), 'accept-install'],
    [...current, '--setup-id', 'b'.repeat(32)], [...administrator, '--setup-id', '../arbitrary']]) {
    assert.throws(() => parseWindowsSetupArguments(args));
  }
});

test('unsupported or redirected terminals never execute the interactive Windows installer', async () => {
  let calls = 0;
  const execute = () => { calls++; throw Error('must not launch'); };
  await assert.rejects(windowsSetup(current, { platform: 'linux', interactive: true, execute }), /unsupported_platform/);
  await assert.rejects(windowsSetup(administrator, { platform: 'win32', interactive: false, execute }), /interactive_terminal_required/);
  assert.equal(calls, 0);
});

test('invalid bundled release fails before attempting any setup process', async () => {
  let calls = 0;
  await assert.rejects(windowsSetup(current, { platform: 'win32', interactive: true,
    releaseRoot: '/invalid-agent-continue-release', execute() { calls++; } }), /windows_release/);
  assert.equal(calls, 0);
});
