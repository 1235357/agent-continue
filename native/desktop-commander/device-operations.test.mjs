import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareState } from './runtime.mjs';

const source = new URL('./device-operations.mjs', import.meta.url);
const exists = fs.existsSync(source);
test('device lifecycle operation owner exists', () => assert.ok(exists));
const check = (name, run) => test(name, { skip: !exists }, run);
const request = (id, action = 'status') => ({ version: 1, id, action });
const record = (id, action, status) => ({ id, action, status });
const header = { format: 'agent-continue-device-operations', version: 1 };
const encode = value => JSON.stringify(value) + '\n';

async function fixture(t, overrides = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcontinue-device-ops-'));
  const root = path.join(base, 'state');
  prepareState(root, { consent: 'full-account' });
  let current = { paused: true, runtime: 'stopped', ready: false, chatAuthorization: 'not-observed' };
  const calls = [];
  const controller = {
    async status() { calls.push('status'); return { ...current }; },
    async reconnect() { calls.push('reconnect'); current = { ...current, paused: false, runtime: 'running', ready: true }; return { ...current }; },
    async pause() { calls.push('pause'); current = { ...current, paused: true, runtime: 'stopped', ready: false }; return { ...current }; },
    ...overrides,
  };
  const { openDeviceOperations } = await import(source.href);
  const owners = [];
  t.after(() => {
    for (const owner of owners) owner.close();
    fs.rmSync(base, { recursive: true, force: true });
  });
  return { base, root, calls, controller, journal: path.join(root, 'device-operations.jsonl'),
    setState(value) { current = { ...current, ...value }; },
    open() { const owner = openDeviceOperations(root, controller); owners.push(owner); return owner; },
  };
}

check('status validates the closed browser envelope and never mutates', async t => {
  const f = await fixture(t), owner = f.open();
  const before = fs.readFileSync(f.journal, 'utf8');
  assert.deepEqual(await owner.handle(request('read-one')), {
    ...request('read-one'), ok: true, state: { paused: true, connection: 'disconnected' },
  });
  for (const value of [null, [], {}, request('../bad'), request('x'.repeat(65)),
    request('one', 'shell'), { ...request('one'), command: 'private' }, { ...request('one'), version: 2 }]) {
    await assert.rejects(owner.handle(value), /invalid_device_request/);
  }
  assert.deepEqual(f.calls, ['status']);
  assert.equal(fs.readFileSync(f.journal, 'utf8'), before);
});

check('a mutation is durably admitted before its effect and duplicates do not repeat it', async t => {
  let f;
  f = await fixture(t, { async reconnect() {
    const rows = fs.readFileSync(f.journal, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.at(-1), record('connect-one', 'reconnect', 'in-progress'));
    f.calls.push('reconnect');
    f.setState({ paused: false, runtime: 'running', ready: true });
    return f.controller.status();
  } });
  const owner = f.open(), intent = request('connect-one', 'reconnect');
  const first = await owner.handle(intent), repeated = await owner.handle(intent);
  assert.deepEqual(first.state.operation, record('connect-one', 'reconnect', 'settled'));
  assert.deepEqual(repeated.state.operation, first.state.operation);
  assert.equal(f.calls.filter(value => value === 'reconnect').length, 1);
  assert.equal(first.state.connection, 'ready');
  assert.equal(Object.hasOwn(first.state, 'chatAuthorization'), false);
  assert.equal(Object.hasOwn(first, 'path'), false);
});

check('reused mutation ID with changed intent is rejected before another effect', async t => {
  const f = await fixture(t), owner = f.open();
  await owner.handle(request('same', 'reconnect'));
  assert.deepEqual(await owner.handle(request('same', 'disconnect-and-pause')), {
    ...request('same', 'disconnect-and-pause'), ok: false,
  });
  assert.equal(f.calls.includes('pause'), false);
});

check('status queries its exact retained ID even when a newer operation exists', async t => {
  const f = await fixture(t), owner = f.open();
  await owner.handle(request('older', 'reconnect'));
  await owner.handle(request('newer', 'disconnect-and-pause'));
  const older = await owner.handle(request('older'));
  assert.deepEqual(older.state.operation, record('older', 'reconnect', 'settled'));
  assert.equal(Object.hasOwn((await owner.handle(request('unrelated'))).state, 'operation'), false);
  owner.close();
  const reopened = f.open();
  assert.deepEqual((await reopened.handle(request('older'))).state.operation, older.state.operation);
  assert.equal(f.calls.filter(value => value === 'reconnect').length, 1);
});

check('a second operation owner cannot steal the journal lease', async t => {
  const f = await fixture(t); f.open();
  assert.throws(() => f.open(), /device_operations_owned/);
});

check('duplicate in-flight work is observed while an explicit pause may preempt reconnect', async t => {
  let finish, f;
  const pending = new Promise(resolve => { finish = resolve; });
  f = await fixture(t, { async reconnect() {
    f.calls.push('reconnect');
    await pending;
    return f.controller.status();
  } });
  const owner = f.open();
  const started = owner.handle(request('running', 'reconnect'));
  try {
    const duplicate = await owner.handle(request('running', 'reconnect'));
    assert.deepEqual(duplicate.state.operation, record('running', 'reconnect', 'in-progress'));
    assert.equal((await owner.handle(request('other', 'reconnect'))).ok, false);
    assert.throws(() => owner.close(), /device_operation_running/);
    const paused = await owner.handle(request('stop-now', 'disconnect-and-pause'));
    assert.equal(paused.state.paused, true);
    assert.deepEqual(paused.state.operation, record('stop-now', 'disconnect-and-pause', 'settled'));
    assert.equal(f.calls.filter(value => value === 'pause').length, 1);
    assert.equal(f.calls.filter(value => value === 'reconnect').length, 1);
  } finally { finish(); await started; }
  assert.equal((await owner.handle(request('running'))).state.operation.status, 'settled');
});

check('an interrupted admission remains unknown after reopen and cannot be replayed', async t => {
  const f = await fixture(t);
  fs.writeFileSync(f.journal, encode(header) + encode(record('lost', 'reconnect', 'in-progress')), { mode: 0o600 });
  const owner = f.open();
  assert.deepEqual((await owner.handle(request('lost'))).state.operation, record('lost', 'reconnect', 'unknown'));
  assert.equal((await owner.handle(request('lost', 'reconnect'))).state.operation.status, 'unknown');
  assert.equal((await owner.handle(request('new', 'reconnect'))).ok, false);
  assert.equal(f.calls.includes('reconnect'), false);
});

check('thrown lifecycle errors retain uncertainty without exposing private error text', async t => {
  const f = await fixture(t, { async reconnect() { throw new Error('C:\\private\\runtime.key'); } });
  const owner = f.open();
  const result = await owner.handle(request('uncertain', 'reconnect'));
  assert.equal(result.state.operation.status, 'unknown');
  assert.equal(JSON.stringify(result).includes('private'), false);
  f.setState({ paused: false, runtime: 'running', ready: true });
  assert.equal((await owner.handle(request('uncertain'))).state.operation.status, 'unknown');
  assert.equal((await owner.handle(request('next', 'reconnect'))).ok, false);
});

check('only the current owner can reconcile a returned unknown-running lifecycle outcome', async t => {
  const f = await fixture(t, { async pause() {
    f.setState({ paused: true, runtime: 'unknown', ready: false });
    return f.controller.status();
  } });
  const owner = f.open();
  const paused = await owner.handle(request('slow-stop', 'disconnect-and-pause'));
  assert.equal(paused.state.operation.status, 'unknown-running');
  f.setState({ runtime: 'stopped' });
  assert.equal((await owner.handle(request('slow-stop'))).state.operation.status, 'settled');
  await owner.handle(request('lost-owner', 'disconnect-and-pause'));
  owner.close();
  f.setState({ runtime: 'stopped' });
  const reopened = f.open();
  assert.equal((await reopened.handle(request('lost-owner'))).state.operation.status, 'unknown');
});

check('journal admission fsync failure prevents the lifecycle mutation', async t => {
  const f = await fixture(t), owner = f.open();
  const original = fs.fsyncSync;
  let result;
  try {
    fs.fsyncSync = () => { throw new Error('synthetic durability failure'); };
    result = await owner.handle(request('not-durable', 'reconnect'));
  } finally { fs.fsyncSync = original; }
  assert.equal(result.ok, false);
  assert.equal(f.calls.includes('reconnect'), false);
  assert.equal((await owner.handle(request('another', 'reconnect'))).ok, false);
});

check('a failed admission can later durably settle as not executed without replay', async t => {
  const f = await fixture(t), owner = f.open();
  const original = fs.fsyncSync;
  try {
    fs.fsyncSync = () => { throw new Error('synthetic durability failure'); };
    assert.equal((await owner.handle(request('not-applied', 'reconnect'))).ok, false);
  } finally { fs.fsyncSync = original; }
  const recovered = await owner.handle(request('not-applied'));
  assert.deepEqual(recovered.state.operation, record('not-applied', 'reconnect', 'not-executed'));
  assert.equal(f.calls.includes('reconnect'), false);
  assert.equal((await owner.handle(request('fresh-same-owner', 'reconnect'))).state?.operation.status, 'settled');
  assert.equal(f.calls.filter(value => value === 'reconnect').length, 1);
  owner.close();
  const reopened = f.open();
  assert.equal((await reopened.handle(request('not-applied', 'reconnect'))).state.operation.status, 'not-executed');
  assert.equal(f.calls.filter(value => value === 'reconnect').length, 1);
  assert.equal((await reopened.handle(request('fresh', 'reconnect'))).state.operation.status, 'settled');
});

for (const failAt of [1, 2, 3]) check(`admission recovery survives another fsync failure at durability step ${failAt}`, async t => {
  const f = await fixture(t), owner = f.open();
  const original = fs.fsyncSync;
  try {
    fs.fsyncSync = () => { throw new Error('synthetic admission failure'); };
    assert.equal((await owner.handle(request('repeated-failure', 'reconnect'))).ok, false);
  } finally { fs.fsyncSync = original; }
  let syncs = 0;
  try {
    fs.fsyncSync = (...args) => {
      if (++syncs === failAt) throw new Error('synthetic recovery failure');
      return original(...args);
    };
    assert.equal((await owner.handle(request('repeated-failure'))).ok, false);
  } finally { fs.fsyncSync = original; }
  assert.equal(f.calls.includes('reconnect'), false);
  assert.equal((await owner.handle(request('repeated-failure'))).state.operation.status, 'not-executed');
  assert.equal((await owner.handle(request('work-after-recovery', 'reconnect'))).state?.operation.status, 'settled');
  assert.equal((await owner.handle(request('repeated-failure', 'reconnect'))).state.operation.status, 'not-executed');
  assert.equal(f.calls.filter(value => value === 'reconnect').length, 1);
});

check('a no-write admission failure can later retain a durable not-executed receipt', async t => {
  const f = await fixture(t), owner = f.open();
  const original = fs.writeFileSync;
  try {
    fs.writeFileSync = () => { throw new Error('synthetic no-write failure'); };
    assert.equal((await owner.handle(request('no-write', 'reconnect'))).ok, false);
  } finally { fs.writeFileSync = original; }
  const result = await owner.handle(request('no-write'));
  assert.deepEqual(result.state.operation, record('no-write', 'reconnect', 'not-executed'));
  assert.equal(f.calls.includes('reconnect'), false);
  assert.equal((await owner.handle(request('no-write', 'reconnect'))).state.operation.status, 'not-executed');
  assert.equal((await owner.handle(request('no-write', 'disconnect-and-pause'))).ok, false);
  assert.equal(f.calls.includes('pause'), false);
});

check('a known-unsent admission stays queryable as not-executed after owner close', async t => {
  const f = await fixture(t), owner = f.open();
  const original = fs.fsyncSync;
  try {
    fs.fsyncSync = () => { throw new Error('synthetic durability failure'); };
    assert.equal((await owner.handle(request('closed-unsent', 'reconnect'))).ok, false);
  } finally { fs.fsyncSync = original; }
  owner.close();
  const reopened = f.open();
  assert.deepEqual((await reopened.handle(request('closed-unsent'))).state.operation,
    record('closed-unsent', 'reconnect', 'not-executed'));
  assert.equal(f.calls.includes('reconnect'), false);
  assert.equal((await reopened.handle(request('after-close', 'reconnect'))).state.operation.status, 'settled');
});

check('journal replacement during awaited status cannot release an old receipt or owner fence', async t => {
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  let block = false;
  const f = await fixture(t, { async status() {
    if (block) { entered(); await new Promise(resolve => { release = resolve; }); }
    return { paused: true, runtime: 'stopped', ready: false };
  } });
  const owner = f.open();
  await owner.handle(request('completed', 'reconnect'));
  block = true;
  const querying = owner.handle(request('completed'));
  await ready;
  try {
    fs.writeFileSync(f.journal, encode(header), { mode: 0o600 });
  } finally { release(); }
  assert.deepEqual(await querying, { ...request('completed'), ok: false });
  owner.close();
  assert.throws(() => f.open(), /device_operations_owned/);
});

check('an identical-byte journal inode replacement during awaited status cannot return a retained receipt', async t => {
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  let block = false;
  const f = await fixture(t, { async status() {
    if (block) { entered(); await new Promise(resolve => { release = resolve; }); }
    return { paused: true, runtime: 'stopped', ready: false };
  } });
  const owner = f.open();
  await owner.handle(request('completed-inode', 'reconnect'));
  const before = fs.readFileSync(f.journal);
  block = true;
  const querying = owner.handle(request('completed-inode'));
  await ready;
  try {
    fs.renameSync(f.journal, path.join(f.root, 'displaced-journal.jsonl'));
    fs.writeFileSync(f.journal, before, { flag: 'wx', mode: 0o600 });
  } finally { release(); }
  assert.deepEqual(await querying, { ...request('completed-inode'), ok: false });
  owner.close();
  assert.throws(() => f.open(), /device_operations_owned/);
});

check('journal replacement during awaited mutation rejects its response and retains the fence', async t => {
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { async reconnect() {
    entered();
    await new Promise(resolve => { release = resolve; });
    return { paused: false, runtime: 'running', ready: true };
  } });
  const owner = f.open();
  const starting = owner.handle(request('changed-while-starting', 'reconnect'));
  await ready;
  try { fs.writeFileSync(f.journal, encode(header), { mode: 0o600 }); }
  finally { release(); }
  assert.deepEqual(await starting, { ...request('changed-while-starting', 'reconnect'), ok: false });
  owner.close();
  assert.throws(() => f.open(), /device_operations_owned/);
});

check('corrupt, noncanonical or illegal-transition journals reject without repair', async t => {
  const f = await fixture(t);
  for (const bytes of ['', encode({ ...header, key: 'private' }), encode(header) + '{broken\n',
    encode(header) + encode(record('x', 'reconnect', 'settled')),
    encode(header) + encode(record('x', 'reconnect', 'in-progress')) + encode(record('x', 'disconnect-and-pause', 'settled'))]) {
    fs.writeFileSync(f.journal, bytes, { mode: 0o600 });
    assert.throws(() => f.open(), /invalid_device_journal/);
    assert.equal(fs.readFileSync(f.journal, 'utf8'), bytes);
  }
  assert.deepEqual(f.calls, []);
});
