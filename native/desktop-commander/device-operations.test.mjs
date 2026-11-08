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

const setupId = 'a'.repeat(32), setupExtension = 'b'.repeat(32);
const setupOperation = '12345678-1234-4234-8234-123456789abc';
async function setupFixture(t) {
  const f=await fixture(t),api=await import(source.href);
  for(const name of ['publishCurrentAccountSetupReceipt','readCurrentAccountSetupReceipt','dispatchCurrentAccountSetup'])
    assert.equal(typeof api[name],'function',name);
  const binding={root:f.root,extensionId:setupExtension,assertCurrent(){}};
  const receipt=api.publishCurrentAccountSetupReceipt(binding,setupId);
  const frame={version:1,id:setupOperation,action:'current-account-setup-connect',setupId,
    scope:'current-account',extensionId:setupExtension,bindingSha256:receipt.bindingSha256};
  return {...f,api,binding,receipt,frame,send:(owner,value=frame)=>api.dispatchCurrentAccountSetup(binding,value,request=>owner.handle(request))};
}

test('fresh setup publication is create-only and proof binds scope, setup, extension and canonical binding',async t=>{
  const f=await setupFixture(t);
  assert.deepEqual(f.api.readCurrentAccountSetupReceipt(f.binding,setupId),f.receipt);
  assert.equal(f.receipt.scope,'current-account');assert.equal(f.receipt.state,'installed');
  assert.throws(()=>f.api.publishCurrentAccountSetupReceipt(f.binding,setupId),/setup_receipt_failed/);
  assert.equal(f.api.readCurrentAccountSetupReceipt(f.binding,'c'.repeat(32)).state,'unconfirmed');
  assert.equal(f.api.readCurrentAccountSetupReceipt({...f.binding,extensionId:'c'.repeat(32)},setupId).state,'unconfirmed');
});

test('setup consumption and the original journal admission precede one reconnect, including after reopen',async t=>{
  const f=await setupFixture(t),owner=f.open(),reconnect=f.controller.reconnect;
  f.controller.reconnect=async()=>{
    const consumed=JSON.parse(fs.readFileSync(path.join(f.root,'browser-setup-consumed.json'),'utf8'));
    assert.equal(consumed.operationId,setupOperation);assert.equal(consumed.setupId,setupId);
    assert.equal(JSON.parse(fs.readFileSync(f.journal,'utf8').trim().split('\n').at(-1)).id,setupOperation);
    return reconnect();
  };
  assert.equal((await f.send(owner)).state.operation.id,setupOperation);
  assert.equal(f.api.readCurrentAccountSetupReceipt(f.binding,setupId).state,'unconfirmed');
  await f.send(owner);owner.close();await f.send(f.open());
  assert.equal(f.calls.filter(value=>value==='reconnect').length,1);
});

test('setup action, scope, extension, digest and setup substitutions cannot admit a standard reconnect',async t=>{
  const f=await setupFixture(t),owner=f.open();
  for(const change of [{scope:'administrator'},{extensionId:'c'.repeat(32)},{setupId:'c'.repeat(32)},
    {bindingSha256:'c'.repeat(64)},{action:'reconnect'},{id:'not-a-uuid'},{extra:true}])
    assert.equal((await f.send(owner,{...f.frame,...change})).ok,false);
  assert.equal(f.calls.includes('reconnect'),false);
  assert.equal(fs.existsSync(path.join(f.root,'browser-setup-consumed.json')),false);
});

test('a settled Pause or a lifecycle marker prevents automatic fresh continuation',async t=>{
  const f=await setupFixture(t),owner=f.open();
  await owner.handle(request('prior-pause','disconnect-and-pause'));
  assert.equal((await f.send(owner)).ok,false);assert.equal(f.calls.includes('reconnect'),false);
  assert.equal(f.api.readCurrentAccountSetupReceipt(f.binding,setupId).state,'unconfirmed');
  const g=await setupFixture(t),second=g.open();
  fs.writeFileSync(path.join(g.root,'lifecycle.json'),encode({format:'agent-continue-lifecycle',version:1,paused:true}));
  assert.equal((await g.send(second)).ok,false);assert.equal(g.calls.includes('reconnect'),false);
});

test('consumption uncertainty has no replay permit for same-ID, replacement-ID or generic reconnect',async t=>{
  const f=await setupFixture(t),owner=f.open(),open=fs.openSync,sync=fs.fsyncSync;let consumedFD;
  const openMock=t.mock.method(fs,'openSync',(...args)=>{
    const fd=open(...args);if(args[0]===path.join(f.root,'browser-setup-consumed.json'))consumedFD=fd;return fd;
  });
  const syncMock=t.mock.method(fs,'fsyncSync',fd=>{if(fd===consumedFD)throw Error('injected lost write acknowledgement');return sync(fd);});
  assert.equal((await f.send(owner)).ok,false);openMock.mock.restore();syncMock.mock.restore();
  assert.equal(fs.existsSync(path.join(f.root,'browser-setup-consumed.json')),true);
  assert.equal((await f.send(owner)).ok,false);
  assert.equal((await f.send(owner,{...f.frame,id:'22345678-1234-4234-8234-123456789abc'})).ok,false);
  assert.equal((await owner.handle(request(setupOperation,'reconnect'))).ok,false);
  assert.equal((await owner.handle(request('replacement','reconnect'))).ok,false);
  assert.equal(owner.canRestoreSavedIntent(),false);assert.equal(f.calls.includes('reconnect'),false);
});

test('expiry, noncanonical bytes, hard links and changed receipt identity fail closed',async t=>{
  const f=await setupFixture(t),owner=f.open(),file=path.join(f.root,'browser-setup.json');
  const original=fs.readFileSync(file,'utf8'),saved=JSON.parse(original);
  for(const bytes of [original+' ',encode({...saved,createdAt:saved.createdAt-900001,expiresAt:saved.expiresAt-900001}),
    encode({...saved,scope:'administrator'}),encode({...saved,version:2})]){
    fs.writeFileSync(file,bytes);assert.equal((await f.send(owner)).ok,false);
  }
  fs.writeFileSync(file,original);fs.linkSync(file,path.join(f.root,'receipt-alias'));
  assert.equal((await f.send(owner)).ok,false);assert.equal(f.calls.includes('reconnect'),false);
});

test('scoped dispatch requires the actual in-process operation-lease owner and cannot retain a deferred permit',async t=>{
  const f=await setupFixture(t);
  assert.equal((await f.api.dispatchCurrentAccountSetup(f.binding,f.frame,()=>assert.fail('no owner'))).ok,false);
  assert.equal(fs.existsSync(path.join(f.root,'browser-setup-consumed.json')),false);
  const owner=f.open();let delayed;
  await f.api.dispatchCurrentAccountSetup(f.binding,f.frame,value=>{delayed=value;return {...value,ok:false};});
  assert.equal((await owner.handle(delayed)).ok,false);assert.equal(f.calls.includes('reconnect'),false);
});

test('only observed successful setup can allow saved-intent restoration; settled failure cannot',async t=>{
  const f=await setupFixture(t),owner=f.open();
  f.controller.reconnect=async()=>({paused:false,runtime:'failed',ready:false});
  assert.equal((await f.send(owner)).state.operation.status,'settled');
  assert.equal(owner.canRestoreSavedIntent(),false);
  assert.equal(f.api.deviceOperationRecoverySettled(f.root),false);
  const g=await setupFixture(t),successful=g.open();
  await g.send(successful);assert.equal(successful.canRestoreSavedIntent(),true);
  assert.equal(g.api.deviceOperationRecoverySettled(g.root),true);
});

test('missing setup consumption cannot turn incomplete setup history into legacy restore authority',async t=>{
  const fresh=await setupFixture(t);
  assert.equal(fresh.api.deviceOperationRecoverySettled(fresh.root),false,'setup publication without a journal is not recovery authority');
  for(const success of [false,true]){
    const f=await setupFixture(t),owner=f.open();
    if(!success)f.controller.reconnect=async()=>({paused:false,runtime:'failed',ready:false});
    await f.send(owner);
    fs.unlinkSync(path.join(f.root,'browser-setup-consumed.json'));
    assert.equal(owner.canRestoreSavedIntent(),false,'missing consumption with retained setup evidence');
    assert.equal(f.api.deviceOperationRecoverySettled(f.root),false,'read-only recovery requires the same evidence');
    if(success){
      fs.unlinkSync(path.join(f.root,'browser-setup.json'));
      assert.equal(owner.canRestoreSavedIntent(),false,'orphaned success cannot become legacy authority');
      assert.equal(f.api.deviceOperationRecoverySettled(f.root),false);
    }
    owner.close();
    assert.equal(f.open().canRestoreSavedIntent(),false,'reopening cannot erase setup provenance');
  }
  const legacy=await fixture(t),owner=legacy.open(),api=await import(source.href);
  await owner.handle(request('legacy-manual-connect','reconnect'));
  assert.equal(owner.canRestoreSavedIntent(),true,'no setup history retains existing manual recovery');
  assert.equal(api.deviceOperationRecoverySettled(legacy.root),true);
});

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
