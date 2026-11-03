import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { spawn } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { performance } from 'node:perf_hooks';

const file = new URL('./process-observation.mjs', import.meta.url);
const api = fs.existsSync(file) ? await import(file) : null;
test('read-only process observation exists', () => assert.ok(api));
const check = (name, run) => test(name, { skip: !api }, run);

// A cold metadata provider may time out; retry reads, never child creation.
async function observeOwnedChild(child, read, attempts) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    assert.equal(child.exitCode, null, 'owned fixture already exited');
    assert.equal(child.signalCode, null, 'owned fixture already signaled');
    try {
      const identity = await read();
      assert.equal(child.exitCode, null, 'owned fixture exited during observation');
      assert.equal(child.signalCode, null, 'owned fixture signaled during observation');
      if (identity) {
        assert.equal(identity.pid, child.pid, 'observation must identify the owned fixture');
        return identity;
      }
    } catch (error) {
      if (error.message !== 'process_observation_failed') throw error;
      lastError = error;
    }
    if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error('owned_fixture_not_identified');
}

test('owned fixture observation retries only bounded unknown reads', async () => {
  const child = { pid: 321, exitCode: null, signalCode: null }, identity = { pid: 321 };
  let reads = 0;
  assert.equal(await observeOwnedChild(child, async () => {
    if (++reads === 1) throw new Error('process_observation_failed');
    return identity;
  }, 3), identity);
  assert.equal(reads, 2);
  reads = 0;
  await assert.rejects(observeOwnedChild(child, async () => {
    reads++; throw new Error('process_observation_failed');
  }, 3), /process_observation_failed/);
  assert.equal(reads, 3);
});

test('wrong identity, unexpected error and fixture exit are never retried', async () => {
  for (const result of ['wrong', 'error', 'exited', 'signaled']) {
    let reads = 0;
    const child = { pid: 321, exitCode: null, signalCode: null };
    await assert.rejects(observeOwnedChild(child, async () => {
      reads++;
      if (result === 'error') throw new Error('unexpected_failure');
      if (result === 'exited') child.exitCode = 0;
      if (result === 'signaled') child.signalCode = 'SIGTERM';
      return { pid: result === 'wrong' ? 322 : 321 };
    }, 3));
    assert.equal(reads, 1);
  }
});

check('malformed process identities reject before operating-system queries', async () => {
  for (const pid of [0, -1, 1.5, true, '1', Number.NaN, 2147483648]) {
    await assert.rejects(api.observeCore(pid, process.execPath), /invalid_process_identity/);
  }
  for (const executable of ['', 'relative', null, '/absolute\0bad']) {
    await assert.rejects(api.observeCore(process.pid, executable), /invalid_process_identity/);
  }
  for (const identity of [null, {}, { pid: process.pid, startTime: '0', executable: process.execPath },
    { pid: process.pid, startTime: '123', executable: process.execPath, extra: true }]) {
    await assert.rejects(api.hasExited(identity), /invalid_process_identity/);
  }
});

check('Linux stat parser handles spaces and closing parentheses in the comm field', () => {
  const fields = Array(50).fill('0'); fields[0] = 'S'; fields[1] = '123'; fields[19] = '987654';
  assert.deepEqual(api.parseLinuxStat('456 (name with ) parentheses) ' + fields.join(' '), 456),
    { pid: 456, parentPid: 123, startTime: '987654', state: 'S' });
  assert.throws(() => api.parseLinuxStat('bad', 456), /process_observation_failed/);
  assert.throws(() => api.parseLinuxStat('457 (wrong pid) ' + fields.join(' '), 456), /process_observation_failed/);
});

test('Windows metadata helper requests limited query rights without WMI or process control', () => {
  const source = fs.readFileSync(new URL('./windows-process-query.cs', import.meta.url), 'utf8');
  assert.match(source, /OpenProcess\(0x1000, false, entry\.th32ProcessID\)/);
  assert.match(source, /Marshal\.GetLastWin32Error\(\) != 18/);
  assert.doesNotMatch(source, /PROCESS_ALL_ACCESS|TerminateProcess|ReadProcessMemory|WriteProcessMemory|Get-CimInstance|Win32_Process/);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /Get-CimInstance|Win32_Process/);
});

test('missing Windows helper is unknown, never process exit evidence', { skip: !api || process.platform !== 'win32' }, async () => {
  const read = fs.readFileSync;
  fs.readFileSync = function(file, ...args) {
    if (String(file).endsWith('/windows-process-query.cs')) throw Object.assign(new Error('private missing path'), { code: 'ENOENT' });
    return Reflect.apply(read, this, [file, ...args]);
  };
  try {
    await assert.rejects(api.hasExited({ pid: process.pid, startTime: '1', executable: process.execPath }),
      error => error.message === 'process_observation_failed');
  } finally { fs.readFileSync = read; }
});

test('a finite owned Node child is identified and its actual exit is observed', { skip: !api, timeout: 35000 }, async t => {
  const originalExecFile = childProcess.execFile;
  if (process.platform === 'win32') {
    childProcess.execFile = function(...args) {
      const callback = args.pop(), started = performance.now();
      return Reflect.apply(originalExecFile, this, [...args, (error, stdout, stderr) => {
        t.diagnostic(JSON.stringify({ processMetadataQuery: true,
          elapsedMs: Math.round(performance.now() - started),
          killed: error?.killed === true, failed: Boolean(error), stderrPresent: Boolean(stderr),
          errorKind: ['ENOENT', 'EACCES', 'ETIMEDOUT'].includes(error?.code) ? error.code : (error ? 'other' : 'none') }));
        callback(error, stdout, stderr);
      }]);
    };
    syncBuiltinESMExports();
    t.after(() => { childProcess.execFile = originalExecFile; syncBuiltinESMExports(); });
  }
  const child = spawn(process.execPath, ['-e', "process.stdin.resume();process.stdin.once('end',()=>process.exit(0));setTimeout(()=>process.exit(0),30000);console.log('owned-ready')"],
    { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => { if (child.exitCode === null) child.kill(); await exited; });
  child.stderr.resume();
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); });
  const identity = await observeOwnedChild(child, () => api.observeCore(process.pid, process.execPath), process.platform === 'win32' ? 3 : 1);
  assert.equal(identity.pid, child.pid); assert.match(identity.startTime, /^[1-9]\d*$/);
  assert.equal(identity.executable, process.execPath);
  assert.equal(await api.hasExited(identity), false);
  assert.equal(await api.hasExited({ ...identity, startTime: '1' }), true);
  child.stdin.end(); await exited;
  assert.equal(await api.hasExited(identity), true);
});

test('missing Linux executable metadata is not exit evidence for a live creation identity', { skip: !api || process.platform !== 'linux' }, async () => {
  const read = fs.readFileSync, readlink = fs.readlinkSync, pid = process.pid;
  const fields = Array(50).fill('0'); fields[0] = 'S'; fields[1] = String(process.ppid); fields[19] = '987654';
  fs.readFileSync = function(file, ...args) {
    if (String(file) === '/proc/' + pid + '/stat') return pid + ' (synthetic live) ' + fields.join(' ');
    return Reflect.apply(read, this, [file, ...args]);
  };
  fs.readlinkSync = function(file, ...args) {
    if (String(file) === '/proc/' + pid + '/exe') throw Object.assign(new Error('missing metadata'), { code: 'ENOENT' });
    return Reflect.apply(readlink, this, [file, ...args]);
  };
  try {
    for (const state of ['R', 'S', 'D', 'T', 't', 'I']) {
      fields[0] = state;
      await assert.rejects(api.hasExited({ pid, startTime: '987654', executable: process.execPath }), /process_observation_failed/);
    }
    for (const state of ['Z', 'X', 'x']) {
      fields[0] = state;
      assert.equal(await api.hasExited({ pid, startTime: '987654', executable: process.execPath }), true);
    }
    fs.readFileSync = function(file, ...args) {
      if (String(file) === '/proc/self/stat') throw Object.assign(new Error('proc unavailable'), { code: 'ENOENT' });
      return Reflect.apply(read, this, [file, ...args]);
    };
    await assert.rejects(api.hasExited({ pid, startTime: '987654', executable: process.execPath }), /process_observation_failed/);
  } finally { fs.readFileSync = read; fs.readlinkSync = readlink; }
});
