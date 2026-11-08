import assert from 'node:assert/strict';
import test from 'node:test';

const source = await import('../setup-controller.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const id = 'a'.repeat(32), digest = 'b'.repeat(64), target = 'c'.repeat(32) + ':idle';
const extension = 'd'.repeat(32), url = `chrome-extension://${extension}/setup.html`;
const sender = {id:extension,frameId:0,tab:{id:1,incognito:false},documentId:'doc-1',url};
const receipt = {setupId:id,state:'installed',bundleSha256:digest,target};
const record = {bundleSha256:digest,operationId:'e'.repeat(32),control:'connect',target,
  outcome:'requested',state:'unconfirmed',progress:null,createdAt:1};
const turn = () => new Promise(resolve => setImmediate(resolve));
function event() {
  const callbacks=[];
  return {addListener:fn=>callbacks.push(fn),emit:(...args)=>callbacks.forEach(fn=>fn(...args))};
}
function fixture(t,options={}) {
  let time=0,permit=true,granted=true;
  const calls=[],removed=event(),updated=event();
  const api={runtime:{id:extension,getURL:path=>`chrome-extension://${extension}/${path}`},
    permissions:{contains:async()=>granted},tabs:{onRemoved:removed,onUpdated:updated}};
  const controls={captureStartupPermit:()=>()=>permit,
    async connectFromSetup(value,admit){calls.push(value);return admit()?record:null;}};
  const controller=source.bindSetupInstallation(api,{controls,now:()=>time,observe:options.observe??(async()=>receipt),
    ...(options.defaultObserver?{}:{prepareObserver:options.prepareObserver??(async()=>true)}),
    ...(options.defaultStopSupport?{}:{checkStopSupport:options.checkStopSupport??(async()=>true)})});
  t.after(()=>controller?.dispose());
  const send=(type,from=sender,setupId=id)=>controller.handleMessage({type,setupId},from);
  return {controller,controls,calls,send,removed,updated,
    deny:()=>{permit=false;},removePermission:()=>{granted=false;},advance:ms=>{time+=ms;}};
}
test('the source-only setup worker implementation is present',()=>{
  assert.equal(typeof source.bindSetupInstallation,'function');
});
test('the default missing observer gate cannot submit a connection',async t=>{
  const f=fixture(t,{defaultObserver:true});await f.send(source.SETUP_BEGIN);
  assert.equal((await f.send(source.SETUP_CONNECT)).state,'unconfirmed');assert.equal(f.calls.length,0);
});
test('Pause while observer attachment is pending prevents all startup transport',async t=>{
  const pending=Promise.withResolvers();let preparing=false;
  const f=fixture(t,{prepareObserver:async()=>{preparing=true;return pending.promise;}});
  await f.send(source.SETUP_BEGIN);const result=f.send(source.SETUP_CONNECT);
  await turn();assert.equal(preparing,true);f.deny();pending.resolve(true);
  assert.equal((await result).state,'cancelled');assert.equal(f.calls.length,0);
});
test('one initiating document can observe then request one journal-backed connection',async t=>{
  const f=fixture(t);
  assert.equal((await f.send(source.SETUP_BEGIN)).state,'waiting');
  assert.equal((await f.send(source.SETUP_OBSERVE)).state,'installed');
  assert.equal(f.calls.length,0);
  const result=await f.send(source.SETUP_CONNECT);
  assert.equal(result.state,'submitted');assert.deepEqual(result.operation,record);
  assert.deepEqual(f.calls,[{setupId:id,bundleSha256:digest,target}]);
  assert.deepEqual(await f.send(source.SETUP_CONNECT),result);assert.equal(f.calls.length,1);
});
test('an unrelated page, tab, frame or document cannot adopt the setup intent',async t=>{
  const f=fixture(t);await f.send(source.SETUP_BEGIN);
  for(const from of [{...sender,id:'f'.repeat(32)},{...sender,url:url+'?automatic=true'},
    {...sender,frameId:1},{...sender,documentId:'doc-2'},{...sender,tab:{id:2}},
    {...sender,tab:{id:1,incognito:true}},{...sender,documentId:undefined}]) {
    assert.equal(await f.send(source.SETUP_OBSERVE,from),null);
    assert.equal(await f.send(source.SETUP_CONNECT,from),null);
  }
  assert.equal(f.calls.length,0);
});
test('Connect without this worker instance receiving Begin cannot start or read native state',async t=>{
  let reads=0;const f=fixture(t,{observe:async()=>{reads++;return receipt;}});
  assert.equal(await f.send(source.SETUP_CONNECT),null);assert.equal(reads,0);assert.equal(f.calls.length,0);
});
test('setup IDs and message fields must be exact rather than prefix-matching',async t=>{
  const f=fixture(t);
  for(const setupId of [id+'\n',id.toUpperCase(),id.slice(1),null]) {
    assert.equal(await f.send(source.SETUP_BEGIN,sender,setupId),null);
  }
  assert.equal(await f.controller.handleMessage({type:source.SETUP_BEGIN,setupId:id,connect:true},sender),null);
  assert.equal(f.calls.length,0);
});
test('Begin captures the original cancellation permit rather than a later replacement',async t=>{
  const f=fixture(t);await f.send(source.SETUP_BEGIN);f.deny();
  assert.equal((await f.send(source.SETUP_CONNECT)).state,'cancelled');assert.equal(f.calls.length,0);
});
test('permission loss and expiry cannot continue an earlier consent',async t=>{
  const f=fixture(t);await f.send(source.SETUP_BEGIN);f.removePermission();
  assert.equal((await f.send(source.SETUP_CONNECT)).state,'cancelled');assert.equal(f.calls.length,0);
  const g=fixture(t);await g.send(source.SETUP_BEGIN);g.advance(900001);
  assert.equal((await g.send(source.SETUP_CONNECT)).state,'expired');assert.equal(g.calls.length,0);
});
test('late native status after Pause, tab close, reload or scope cancellation cannot start',async t=>{
  for(const cancel of [f=>f.deny(),f=>f.removed.emit(1),f=>f.updated.emit(1,{status:'loading'}),
    f=>void f.send(source.SETUP_CANCEL)]) {
    const pending=Promise.withResolvers();let started=false;
    const f=fixture(t,{observe:async()=>{started=true;return pending.promise;}});
    await f.send(source.SETUP_BEGIN);const result=f.send(source.SETUP_CONNECT);
    for(let i=0;i<30&&!started;i++) await turn();
    cancel(f);pending.resolve(receipt);
    assert.equal((await result).state,'cancelled');assert.equal(f.calls.length,0);
  }
});
test('a stale, mismatched or unavailable installation proof never requests a connection',async t=>{
  for(const proof of [null,{...receipt,setupId:'f'.repeat(32)},
    {...receipt,state:'unconfirmed',bundleSha256:null,target:null},{...receipt,extra:true}]) {
    const f=fixture(t,{observe:async()=>proof});await f.send(source.SETUP_BEGIN);
    assert.equal((await f.send(source.SETUP_CONNECT)).state,'unconfirmed');assert.equal(f.calls.length,0);
    await f.send(source.SETUP_CONNECT);assert.equal(f.calls.length,0);
  }
});
test('the default stop-capability gate cannot silently enable automatic connection',async t=>{
  const f=fixture(t,{defaultStopSupport:true});await f.send(source.SETUP_BEGIN);
  assert.equal((await f.send(source.SETUP_CONNECT)).state,'unconfirmed');assert.equal(f.calls.length,0);
  const pending=Promise.withResolvers();let checked;
  const g=fixture(t,{checkStopSupport:async value=>{checked=value;return pending.promise;}});
  await g.send(source.SETUP_BEGIN);const result=g.send(source.SETUP_CONNECT);
  for(let i=0;i<30&&!checked;i++)await turn();
  assert.equal(checked,digest);g.deny();pending.resolve(true);
  assert.equal((await result).state,'cancelled');assert.equal(g.calls.length,0);
});
test('concurrent Continue calls share one pending submission and never replace an uncertain result',async t=>{
  const pending=Promise.withResolvers();const f=fixture(t);await f.send(source.SETUP_BEGIN);
  f.controls.connectFromSetup=async(value,admit)=>{f.calls.push(value);assert.equal(admit(),true);return pending.promise;};
  const a=f.send(source.SETUP_CONNECT),b=f.send(source.SETUP_CONNECT);
  for(let i=0;i<30&&f.calls.length===0;i++)await turn();
  assert.equal(f.calls.length,1);pending.resolve(null);
  assert.equal((await a).state,'unconfirmed');assert.deepEqual(await b,await a);
  await f.send(source.SETUP_CONNECT);assert.equal(f.calls.length,1);
});
test('a new worker never resumes setup implicitly; duplicate Begin cannot rearm a consumed intent',async t=>{
  const f=fixture(t);await f.send(source.SETUP_BEGIN);await f.send(source.SETUP_CONNECT);
  assert.equal(await f.send(source.SETUP_BEGIN),null);assert.equal(f.calls.length,1);
  const restarted=fixture(t);assert.equal(await restarted.send(source.SETUP_CONNECT),null);
  assert.equal(restarted.calls.length,0);
});
test('an uncertain reservation preserves its exact ID without claiming a transport submission',async t=>{
  const f=fixture(t);await f.send(source.SETUP_BEGIN);
  const uncertain={...record,outcome:'unconfirmed'};
  f.controls.connectFromSetup=async()=>uncertain;
  const value=await f.send(source.SETUP_CONNECT);
  assert.equal(value.state,'unconfirmed');assert.deepEqual(value.operation,uncertain);
});
test('document cancellation stays cancellation even after a late valid journal return',async t=>{
  const pending=Promise.withResolvers();const f=fixture(t);await f.send(source.SETUP_BEGIN);
  f.controls.connectFromSetup=async()=>pending.promise;
  const result=f.send(source.SETUP_CONNECT);await turn();await f.send(source.SETUP_CANCEL);
  pending.resolve(record);
  const value=await result;assert.equal(value.state,'cancelled');
  assert.deepEqual(value.operation,record);
});
