import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = await import('../setup-handoff.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const id = 'a'.repeat(32), digest = 'b'.repeat(64), target = 'c'.repeat(32) + ':idle';
const receipt = { setupId: id, state: 'installed', bundleSha256: digest, target };
const turn = () => new Promise(resolve => setImmediate(resolve));
function session() {
  const data = {};
  return { data, async get(key) { return { [key]: data[key] }; },
    async set(value) { Object.assign(data, value); }, async remove(key) { delete data[key]; } };
}
function clock() {
  let at = 0, next = 0;
  const pending = new Map();
  return { now: () => at, pending,
    setTimeout(fn, delay) { const id = ++next; pending.set(id, { fn, at: at + delay }); return id; },
    clearTimeout(id) { pending.delete(id); },
    async advance(ms) { at += ms; for (const [key, value] of [...pending]) if (value.at <= at) {
      pending.delete(key); value.fn();
    } await turn(); },
  };
}

test('the handoff implementation is present', () => {
  for (const name of ['validSetupReceipt','readSetupStatus','watchSetupInstallation','putSetupHandoff','consumeSetupHandoff']) {
    assert.equal(typeof source[name], 'function', name);
  }
});
test('installation proof requires exact setup identity and bounded fields', () => {
  assert.equal(source.validSetupReceipt(receipt, id), true);
  for (const value of [{ ...receipt, setupId: 'd'.repeat(32) }, { ...receipt, target: null },
    { ...receipt, bundleSha256: digest.toUpperCase() }, { ...receipt, extra: true },
    { ...receipt, target: target + '\n' }, { ...receipt, state: 'ready' }]) {
    assert.equal(source.validSetupReceipt(value, id), false);
  }
  assert.equal(source.validSetupReceipt({setupId:id,state:'unconfirmed',bundleSha256:null,target:null}, id), true);
});
test('status is one read-only correlated native request, not a permission request or control', async () => {
  const calls = [];
  const api = {permissions:{async contains(){return true;},request(){assert.fail('permission request');}},
    runtime:{async sendNativeMessage(host, request){calls.push({host,request});return {...request,...receipt};}}};
  assert.deepEqual(await source.readSetupStatus(api, id), receipt);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].host, 'com.agentcontinue.administrator_owner');
  assert.equal(calls[0].request.action, 'setup-status');
});
test('missing permission and a lost permission cannot produce installation authority', async () => {
  let reads = 0, sends = 0;
  const api = {permissions:{async contains(){return ++reads === 1;}},
    runtime:{async sendNativeMessage(_,request){sends++;return {...request,...receipt};}}};
  assert.equal(await source.readSetupStatus(api, id), null);
  assert.equal(sends, 1);
  assert.equal(await source.readSetupStatus(api, id), null);
  assert.equal(sends, 1);
});
test('a native reply for another transport ID or setup ID is not adopted', async () => {
  for (const change of [{id:'wrong'}, {setupId:'e'.repeat(32)}, {action:'wake'}]) {
    const api = { permissions:{async contains(){return true;}}, runtime:{async sendNativeMessage(_,request){return {...request,...receipt,...change};}} };
    assert.equal(await source.readSetupStatus(api,id),null);
  }
});
test('an exact installed observation continues once and never repeats after callback failure', async () => {
  const c = clock(); let reads = 0, continued = 0;
  const watch = source.watchSetupInstallation({setupId:id, timers:c, now:c.now,
    async observe(){reads++;return receipt;}, async onInstalled(){continued++;throw Error('lost navigation');}});
  await turn(); await c.advance(60000);
  assert.equal(continued,1);assert.equal(reads,1);assert.equal(watch.getState(),'finished');assert.equal(c.pending.size,0);
});
test('cancel during an in-flight observation wins over a late valid reply', async () => {
  const c = clock(); let resolve, continued = 0;
  const watch = source.watchSetupInstallation({setupId:id,timers:c,now:c.now,
    observe:()=>new Promise(r=>{resolve=r;}), onInstalled:()=>continued++});
  await turn();watch.cancel();resolve(receipt);await turn();
  assert.equal(continued,0);assert.equal(c.pending.size,0);assert.equal(watch.getState(),'cancelled');
});
test('unknown observations only schedule bounded read-only checks and expire', async () => {
  const c = clock(); let reads=0,continued=0,stopped;
  const watch=source.watchSetupInstallation({setupId:id,timers:c,now:c.now,maxMs:1000,
    async observe(){reads++;return null;},onInstalled:()=>continued++,onStop:reason=>{stopped=reason;}});
  await turn();await c.advance(1001);
  assert.equal(reads,1);assert.equal(continued,0);assert.equal(stopped,'expired');assert.equal(watch.getState(),'expired');
});
test('a proof arriving after the deadline cannot authorize connection', async () => {
  const c=clock();let resolve,continued=0;
  source.watchSetupInstallation({setupId:id,timers:c,now:c.now,maxMs:1000,
    observe:()=>new Promise(r=>{resolve=r;}),onInstalled:()=>continued++});
  await turn();await c.advance(1001);resolve(receipt);await turn();assert.equal(continued,0);
});
test('handoff is written only to session storage and consumed exactly once under a lock', async () => {
  const s=session();const held=[];
  const locks={async request(name,options,fn){held.push({name,options});return fn({name});}};
  await source.putSetupHandoff(s,receipt,id,()=>1000);
  const first=await source.consumeSetupHandoff({session:s,locks,setupId:id,now:()=>1001});
  assert.equal(first.bundleSha256,digest);assert.equal(first.target,target);assert.equal(first.setupId,id);
  assert.equal(await source.consumeSetupHandoff({session:s,locks,setupId:id,now:()=>1002}),null);
  assert.equal(Object.keys(s.data).length,0);assert.equal(held[0].options.ifAvailable,true);
});
test('no storage, no lock, expired or future receipt means manual continuation only', async () => {
  const locks={async request(_,__,fn){return fn({});}};
  for (const now of [999, 62000]) {
    const s=session();await source.putSetupHandoff(s,receipt,id,()=>1000);
    assert.equal(await source.consumeSetupHandoff({session:s,locks,setupId:id,now:()=>now}),null);
  }
  const s=session();await source.putSetupHandoff(s,receipt,id,()=>1000);
  assert.equal(await source.consumeSetupHandoff({session:s,setupId:id,now:()=>1001}),null);
  assert.equal(await source.consumeSetupHandoff({locks,setupId:id,now:()=>1001}),null);
});
test('a handoff removal failure cannot authorize connection', async () => {
  const s=session();await source.putSetupHandoff(s,receipt,id,()=>1000);
  s.remove=async()=>{throw Error('storage unavailable');};
  const locks={async request(_,__,fn){return fn({});}};
  assert.equal(await source.consumeSetupHandoff({session:s,locks,setupId:id,now:()=>1001}),null);
});
test('malformed or unconfirmed observations are never persisted as handoffs', async () => {
  const s=session();
  await assert.rejects(source.putSetupHandoff(s,{...receipt,state:'unconfirmed'},id,()=>1000));
  assert.deepEqual(s.data,{});
});
