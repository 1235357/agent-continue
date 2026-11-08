import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createWinRegistry } from './registry-win.mjs';
import { createRegQueryRegistry } from './runtime-precheck.mjs';
const plan = { keyPath: 'HKCU\\Software\\AgentContinueFixture', view: '64' };
test('precheck registry is read-only and does not hide query failures', {skip:process.platform !== 'win32'}, () => {
  const registry = createRegQueryRegistry(() => ({status:1,stderr:'Access denied'}));
  assert.deepEqual(Object.keys(registry), ['get']);
  assert.throws(() => registry.get(plan), /registry_query_failed/);
  assert.equal(createRegQueryRegistry(() => ({status:0,stdout:'{"missing":true}'})).get(plan), null);
  assert.equal(createRegQueryRegistry(() => ({status:0,stdout:'{"value":"fixture"}'})).get(plan), 'fixture');
});
test('registry query distinguishes confirmed absence from query failure', () => {
  const query = result => createWinRegistry(() => result).get(plan);
  assert.equal(query({ status: 0, stdout: '{"missing":true}' }), null);
  assert.equal(query({ status: 0, stdout: JSON.stringify({value:'C:\\fixture\\host.json'}) }), 'C:\\fixture\\host.json');
  for (const result of [{ status: null, error: new Error('timeout') }, { status: 1, stderr: 'ERROR: Access is denied.' },
    { status: 0, stdout: 'unexpected output' }, { status: 1, stderr: 'unknown localized error' }]) {
    assert.throws(() => query(result), /registry_query_failed/);
  }
});

test('actual Windows read-only query identifies a missing fixture key', {skip:process.platform !== 'win32'}, () => {
  assert.equal(createWinRegistry().get({keyPath:'HKCU\\Software\\AgentContinueMissingFixture_20261104_943b',view:'64'}),null);
});

test('Windows create-only registration cannot overwrite a fixture key', { skip: process.platform !== 'win32' }, () => {
  const key = 'AgentContinueCreateFixture_' + crypto.randomBytes(16).toString('hex');
  const registry = createWinRegistry();
  const first = { keyPath: 'HKCU\\Software\\' + key, view: '32',
    regSzValue: path.join(process.env.SystemRoot, 'fixture', 'host.json') };
  const ps = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const expanded = '%SystemRoot%\\fixture\\host.json';
  const run = script => spawnSync(ps, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }).status;
  const open = "$ErrorActionPreference='Stop';$b=[Microsoft.Win32.RegistryKey]::OpenBaseKey('CurrentUser','Registry32');" +
    "$p=$b.OpenSubKey('Software',$true);";
  assert.deepEqual(registry.inspect(first), { present: false });
  try {
    assert.equal(registry.createOnly(first), true);
    assert.deepEqual(registry.inspect(first), { present: true, value: first.regSzValue });
    assert.equal(registry.createOnly({ ...first, regSzValue: 'C:\\foreign\\host.json' }), false);
    assert.deepEqual(registry.inspect(first), { present: true, value: first.regSzValue });
    assert.equal(run(open + "$k=$p.OpenSubKey('" + key + "',$true);" +
      "$k.SetValue('','" + expanded + "','ExpandString');" +
      "if($k.GetValue('') -cne (Join-Path $env:SystemRoot 'fixture\\host.json')){exit 2};$k.Dispose();$p.Dispose();$b.Dispose();"), 0);
    assert.deepEqual(registry.inspect(first), { present: true, value: null });
    assert.equal(registry.createOnly(first), false);
  } finally {
    const cleanup = open + "$k=$p.OpenSubKey('" + key + "');if($k){" +
      "$owned=@((Join-Path $env:SystemRoot 'fixture\\host.json'),'" + expanded + "');" +
      "if($k.SubKeyCount -ne 0 -or $k.ValueCount -gt 1 -or ($k.ValueCount -eq 1 -and $k.GetValue('',$null,'DoNotExpandEnvironmentNames') -cnotin $owned)){exit 2};" +
      "$k.Dispose();$p.DeleteSubKey('" + key + "')};$p.Dispose();$b.Dispose();";
    assert.equal(run(cleanup), 0);
    assert.deepEqual(registry.inspect(first), { present: false });
  }
});
