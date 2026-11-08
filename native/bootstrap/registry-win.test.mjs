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

test('registry subprocess uses no-BOM UTF-8 stdout with bounded execution', () => {
  const write = { ...plan, regSzValue: 'C:\\fixture\\host.json' };
  for (const method of ['get', 'inspect', 'createOnly']) {
    const registry = createWinRegistry((executable, args, options) => {
      assert.equal(path.win32.basename(executable), 'powershell.exe');
      assert.deepEqual(args.slice(0, -1), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
      const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
      assert.ok(script.startsWith('[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false);\n'));
      assert.deepEqual(options, { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 65536 });
      return { status: 0, stdout: method === 'createOnly' ? '{"written":true}' : '{"missing":true}' };
    });
    registry[method](write);
  }
});

test('registry get/inspect preserve absence, empty, malformed and denied classifications', () => {
  assert.deepEqual(createWinRegistry(() => ({ status: 0, stdout: '{"missing":true}' })).inspect(plan), { present: false });
  assert.deepEqual(createWinRegistry(() => ({ status: 0, stdout: '{"empty":true}' })).inspect(plan), { present: true, value: null });
  for (const method of ['get', 'inspect']) {
    assert.deepEqual(createWinRegistry(() => ({ status: 0, stdout: '{"value":""}' }))[method](plan),
      method === 'get' ? '' : { present: true, value: '' });
    const failures = [
      { status: 1, stderr: 'Access denied' },
      { status: 1, stderr: 'Malformed REG_SZ' },
      { status: null, error: new Error('ETIMEDOUT') },
      { status: null, error: new Error('ENOBUFS') },
      { status: 0, signal: 'SIGTERM' },
      ...['not JSON', 'null', '[]', '{}', '{"missing":false}', '{"value":null}',
        '{"value":42}', '{"value":"fixture","missing":true}', '\ufeff{"missing":true}']
        .map(stdout => ({ status: 0, stdout })),
    ];
    for (const result of failures) {
      assert.throws(() => createWinRegistry(() => result)[method](plan), { message: 'registry_query_failed' });
    }
  }
  assert.throws(() => createWinRegistry(() => ({ status: 0, stdout: '{"empty":true}' })).get(plan),
    { message: 'registry_query_failed' });
});

test('registry createOnly preserves typed results, failures and input validation', () => {
  const write = { ...plan, regSzValue: 'C:\\fixture\\host.json' };
  for (const written of [true, false]) {
    assert.equal(createWinRegistry(() => ({ status: 0, stdout: JSON.stringify({ written }) })).createOnly(write), written);
  }
  for (const result of [{ status: 1, stderr: 'Access denied' }, { status: null, error: new Error('ENOBUFS') },
    ...['not JSON', 'null', '{}', '{"written":"true"}', '{"written":true,"extra":true}']
      .map(stdout => ({ status: 0, stdout }))]) {
    assert.throws(() => createWinRegistry(() => result).createOnly(write), { message: 'registry_create_failed' });
  }
  const noProcess = createWinRegistry(() => assert.fail('invalid plans must not start a subprocess'));
  for (const invalid of [{ keyPath: 'HKLM\\Software\\Fixture' }, { keyPath: 'HKCU\\Software\\bad\'key' },
    { view: '16' }, { regSzValue: 'relative\\host.json' }, { regSzValue: 'C:\\bad\u0000\\host.json' },
    { regSzValue: 'C:\\' + 'x'.repeat(4096) }]) {
    assert.throws(() => noProcess.createOnly({ ...write, ...invalid }), { message: 'registry_create_failed' });
  }
  for (const method of ['get', 'inspect']) {
    for (const invalid of [{ keyPath: 'HKCU\\Software\\bad\'key' }, { keyPath: 'HKXX\\Software\\Fixture' }, { view: '16' }]) {
      assert.throws(() => noProcess[method]({ ...plan, ...invalid }), { message: 'registry_query_failed' });
    }
  }
});

test('actual Windows read-only query identifies a missing fixture key', {skip:process.platform !== 'win32'}, () => {
  assert.equal(createWinRegistry().get({keyPath:'HKCU\\Software\\AgentContinueTestMissing_' + crypto.randomBytes(16).toString('hex'),view:'64'}),null);
});

test('Windows create-only registration cannot overwrite a fixture key', { skip: process.platform !== 'win32' }, t => {
  const key = 'AgentContinueTestCreate_' + crypto.randomBytes(16).toString('hex');
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
    assert.throws(() => registry.get(first), { message: 'registry_query_failed' });
    assert.equal(registry.createOnly(first), false);
  } finally {
    const cleanup = open + "$k=$p.OpenSubKey('" + key + "');if($k){" +
      "$owned=@((Join-Path $env:SystemRoot 'fixture\\host.json'),'" + expanded + "');" +
      "if($k.SubKeyCount -ne 0 -or $k.ValueCount -gt 1 -or ($k.ValueCount -eq 1 -and $k.GetValue('',$null,'DoNotExpandEnvironmentNames') -cnotin $owned)){exit 2};" +
      "$k.Dispose();$p.DeleteSubKey('" + key + "')};$p.Dispose();$b.Dispose();";
    assert.equal(run(cleanup), 0);
    assert.deepEqual(registry.inspect(first), { present: false });
    t.diagnostic('Cleaned exact key and confirmed absence: ' + first.keyPath + ', view ' + first.view);
  }
});

for (const view of ['32', '64']) {
  test('actual PS5.1 CP437 Unicode REG_SZ get/inspect roundtrip, view ' + view,
    { skip: process.platform !== 'win32' }, t => {
      const key = 'AgentContinueTestUnicode_' + crypto.randomBytes(16).toString('hex');
      const first = { keyPath: 'HKCU\\Software\\' + key, view,
        regSzValue: "C:\\Users\\\u6d4b\u8bd5-\u00e9-\ud83d\ude80\\O'Brien\\host.json" };
      const samples = [];
      let powershell;
      // Refuse to change a console shared with any other process.
      const registry = createWinRegistry((executable, args, options) => {
        const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
        const prefix = "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';" +
          "Add-Type -TypeDefinition 'using System.Runtime.InteropServices;public static class AgentContinueTestConsole{" +
          '[DllImport("kernel32.dll")]public static extern uint GetConsoleProcessList([Out] uint[] ids,uint size);' +
          '[DllImport("kernel32.dll")]public static extern uint GetConsoleOutputCP();' +
          "}';$ids=New-Object uint32[] 16;$n=[AgentContinueTestConsole]::GetConsoleProcessList($ids,16);" +
          "if($n -ne 1 -or $ids[0] -ne $PID){throw 'shared console'};" +
          '[Console]::OutputEncoding=[System.Text.Encoding]::GetEncoding(437);' +
          "[Console]::Error.WriteLine(('PS={0};CP={1};PROCESSES={2}' -f $PSVersionTable.PSVersion,[AgentContinueTestConsole]::GetConsoleOutputCP(),$n));";
        const result = spawnSync(executable, [...args.slice(0, -1),
          Buffer.from(prefix + script, 'utf16le').toString('base64')],
        { ...options, encoding: null });
        assert.ifError(result.error);
        assert.equal(result.signal, null);
        assert.equal(result.status, 0, result.stderr?.toString('utf8'));
        assert.match(result.stderr.toString('utf8'), /^PS=5\.1\.[0-9.]+;CP=437;PROCESSES=1\r?\n$/);
        powershell = result.stderr.toString('utf8').trim();
        samples.push(result.stdout);
        return { ...result, stdout: result.stdout.toString('utf8') };
      });
      assert.deepEqual(registry.inspect(first), { present: false });
      const literal = "'" + first.regSzValue.replaceAll("'", "''") + "'";
      const ps = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const open = "$ErrorActionPreference='Stop';$b=[Microsoft.Win32.RegistryKey]::OpenBaseKey('CurrentUser','Registry" + view + "');";
      const run = script => spawnSync(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 15000, maxBuffer: 65536 });
      try {
        assert.equal(registry.createOnly(first), true);
        const actual = { get: registry.get(first), inspect: registry.inspect(first) };
        const stdout = samples.slice(-2);
        t.diagnostic(JSON.stringify({ keyPath: first.keyPath, view, powershell,
          stdoutHex: stdout.map(bytes => bytes.toString('hex')), actual }));
        assert.deepEqual(actual, { get: first.regSzValue, inspect: { present: true, value: first.regSzValue } });
        for (const bytes of stdout) {
          assert.notEqual(bytes.subarray(0, 3).toString('hex'), 'efbbbf');
          assert.ok(bytes.length <= 65536);
          assert.deepEqual(JSON.parse(bytes.toString('utf8')), { value: first.regSzValue });
          assert.ok(bytes.includes(Buffer.from('\u6d4b\u8bd5-\u00e9-\ud83d\ude80', 'utf8')));
        }
        assert.equal(registry.createOnly({ ...first, regSzValue: 'C:\\foreign\\host.json' }), false);
        assert.deepEqual(registry.inspect(first), { present: true, value: first.regSzValue });
        const typed = run(open + "$k=$b.OpenSubKey('Software\\" + key + "');try{" +
          "if($k.GetValueKind('') -ne [Microsoft.Win32.RegistryValueKind]::String -or " +
          "$k.GetValue('') -cne " + literal + "){exit 2}}finally{$k.Dispose();$b.Dispose()}");
        assert.ifError(typed.error);
        assert.equal(typed.status, 0, typed.stderr.toString());
      } finally {
        const cleanup = run(open + "$p=$b.OpenSubKey('Software',$true);$k=$p.OpenSubKey('" + key + "');try{if($k){" +
          "if($k.SubKeyCount -ne 0 -or $k.ValueCount -ne 1 -or $k.GetValueKind('') -ne [Microsoft.Win32.RegistryValueKind]::String -or " +
          "$k.GetValue('') -cnotin @(" + literal + ",'C:\\foreign\\host.json')){exit 2};" +
          "$k.Dispose();$k=$null;$p.DeleteSubKey('" + key + "')}}finally{if($k){$k.Dispose()};$p.Dispose();$b.Dispose()}");
        assert.ifError(cleanup.error);
        assert.equal(cleanup.status, 0, cleanup.stderr.toString());
        assert.deepEqual(registry.inspect(first), { present: false });
        t.diagnostic('Cleaned exact key and confirmed absence: ' + first.keyPath + ', view ' + view);
      }
    });
}
