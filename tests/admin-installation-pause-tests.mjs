import test from 'node:test';
import assert from 'node:assert/strict';
import { bindInstallationPause, INSTALLATION_PAUSE_ASSOCIATIONS } from '../admin-installation-pause.js';
import { ADMIN_BROWSER_PAUSE_LAST } from '../admin-browser.js';
import { ADMIN_CONTROL_SETUP_INSTALLATION } from '../admin-control.js';

const digest='a'.repeat(64), operationId='b'.repeat(32);
function fixture(initial={}) {
  const data=structuredClone(initial), calls=[], events=[];
  let grant=true, native, failWrite=false, corruptRead=false;
  const api={extension:{},runtime:{getPlatformInfo:async()=>({os:'win'}),
    sendNativeMessage:async(host,message)=>{calls.push(message);return native(message);}},
    permissions:{contains:async()=>grant,onRemoved:{addListener:fn=>events.push(fn)}},
    storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,
      corruptRead&&key===INSTALLATION_PAUSE_ASSOCIATIONS?{}:structuredClone(data[key])])),
      set:async values=>{if(failWrite)throw Error('storage');Object.assign(data,structuredClone(values));}}}};
  native=async m=>({...m, ...(m.action==='control-support'?{state:'supported',control:'revoke',bundleSha256:digest,
    target:null,ownerState:'running',eligible:true}:m.action==='pause-installation-support'?{state:'supported'}:
    m.action==='pause-installation-status'?{state:'unconfirmed'}:{state:'requested'})});
  // Native replies do not echo request-only fields. All identities are correlated.
  api.runtime.sendNativeMessage=async(host,m)=>{calls.push(m);const reply=await native(m);delete reply.target;
    if(m.action==='control-support')reply.target=null;
    return reply;};
  return {api,data,calls,bind:()=>bindInstallationPause(api),handle:fn=>{native=fn;},
    revoke(){grant=false;events.forEach(fn=>fn({permissions:['nativeMessaging']}));},
    failWrite(){failWrite=true;},corruptRead(){corruptRead=true;}};
}
test('supported installation Pause is recorded before exactly one untargeted dispatch',async()=>{
  const f=fixture(),control=f.bind();
  f.handle(async m=>{
    if(m.action==='control-support')return {version:1,id:m.id,action:m.action,control:'revoke',state:'supported',
      bundleSha256:digest,target:null,ownerState:'running',eligible:true};
    if(m.action==='pause-installation') {
      const record=f.data[ADMIN_BROWSER_PAUSE_LAST];
      assert.equal(record.operationId,m.operationId);assert.equal(record.outcome,'unconfirmed');
      assert.equal(f.data[INSTALLATION_PAUSE_ASSOCIATIONS][m.operationId],digest);
      assert.equal(Object.hasOwn(m,'target'),false);
    }
    return {...m,state:m.action==='pause-installation-support'?'supported':'requested'};
  });
  const result=await control.pause();
  assert.equal(result.outcome,'requested');
  assert.equal(f.calls.filter(m=>m.action==='pause-installation').length,1);
});
test('unknown mutator result and worker replacement never replay its original operation',async()=>{
  const f=fixture(),control=f.bind();
  f.handle(async m=>m.action==='control-support'?{version:1,id:m.id,action:m.action,control:'revoke',state:'supported',
    bundleSha256:digest,target:null,ownerState:'running',eligible:true}:m.action==='pause-installation-support'?{...m,state:'supported'}:
    m.action==='pause-installation-status'?{...m,state:'unconfirmed'}:null);
  const first=await control.pause();assert.equal(first.outcome,'unconfirmed');
  assert.deepEqual(await f.bind().pause(),first);
  assert.equal(f.calls.filter(m=>m.action==='pause-installation').length,1);
  assert.equal(await control.reconcile(first.operationId),null);
});
test('legacy records are not silently converted into installation Pause',async()=>{
  const f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:{operationId,outcome:'unconfirmed'}}),control=f.bind();
  assert.equal(await control.pause(),undefined);assert.equal(await control.observe(operationId),undefined);
  assert.equal(f.calls.length,0);
});
test('missing installation Pause capability leaves legacy fallback available without a write',async()=>{
  const f=fixture(),control=f.bind();f.handle(async()=>null);
  assert.equal(await control.pause(),undefined);assert.equal(f.data[ADMIN_BROWSER_PAUSE_LAST],undefined);
  assert.equal(await control.available(digest),false);
});
test('storage failure and corrupt association readback deny native mutation',async()=>{
  for(const method of ['failWrite','corruptRead']){
    const f=fixture(),control=f.bind();f[method]();
    assert.equal(await control.pause(),null);
    assert.equal(f.calls.some(m=>m.action==='pause-installation'),false);
  }
});
test('permission revocation during support invalidates the pending operation',async()=>{
  const f=fixture(),control=f.bind();
  f.handle(async m=>{f.revoke();return {...m,state:'supported'};});
  assert.equal(await control.pause(),undefined);
  assert.equal(f.calls.some(m=>m.action==='pause-installation'),false);
});
test('foreign bundle or transport reply cannot claim stop capability',async()=>{
  const f=fixture(),control=f.bind();
  f.handle(async m=>({...m,bundleSha256:'f'.repeat(64),state:'supported'}));
  assert.equal(await control.available(digest),false);
});
test('durable stopped receipt is bound to original installation, not current support',async()=>{
  const f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:{operationId,outcome:'requested'},
    [INSTALLATION_PAUSE_ASSOCIATIONS]:{[operationId]:digest}}),control=f.bind();
  f.handle(async m=>({...m,state:'stopped'}));
  assert.deepEqual(await control.observe(operationId),{operationId,state:'stopped'});
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].bundleSha256,digest);
});
test('Pause during or after admitted Connect needs no fresh target or support observation',async()=>{
  const f=fixture({[ADMIN_CONTROL_SETUP_INSTALLATION]:{version:1,setupId:'e'.repeat(32),bundleSha256:digest}});
  f.handle(async m=>{assert.equal(m.action,'pause-installation');return {...m,state:'requested'};});
  const result=await f.bind().pause();
  assert.equal(result.outcome,'requested');assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].bundleSha256,digest);assert.equal(Object.hasOwn(f.calls[0],'target'),false);
});
for(const outcome of ['cancelled','requested','unconfirmed'])test('known installation does not downgrade for legacy '+outcome,async()=>{
  const f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:{operationId,outcome},
    [ADMIN_CONTROL_SETUP_INSTALLATION]:{version:1,setupId:'e'.repeat(32),bundleSha256:digest}});
  f.handle(async m=>{assert.equal(m.action,'pause-installation');return {...m,state:'requested'};});
  assert.equal((await f.bind().pause()).outcome,'requested');
  assert.equal(f.calls.length,1);assert.notEqual(f.calls[0].operationId,operationId);
});
test('unresolved installation A does not block a distinct known installation B denial',async()=>{
  const other='f'.repeat(64),f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:{operationId,outcome:'unconfirmed'},
    [INSTALLATION_PAUSE_ASSOCIATIONS]:{[operationId]:other},
    [ADMIN_CONTROL_SETUP_INSTALLATION]:{version:1,setupId:'e'.repeat(32),bundleSha256:digest}});
  f.handle(async m=>{assert.equal(m.action,'pause-installation');assert.equal(m.bundleSha256,digest);return {...m,state:'requested'};});
  assert.equal((await f.bind().pause()).outcome,'requested');
  assert.equal(f.data[INSTALLATION_PAUSE_ASSOCIATIONS][operationId],other);
});
test('full active association storage cannot advertise automatic-Connect stop capacity',async()=>{
  const map=Object.fromEntries(Array.from({length:256},(_,i)=>[i.toString(16).padStart(32,'0'),digest]));
  const f=fixture({[INSTALLATION_PAUSE_ASSOCIATIONS]:map});
  assert.equal(await f.bind().available(digest),false);assert.equal(f.calls.length,0);
});
test('settled association is archived and remains installation-routed before active retention is freed',async()=>{
  const f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:{operationId,outcome:'requested'},
    [INSTALLATION_PAUSE_ASSOCIATIONS]:{[operationId]:digest},
    [ADMIN_CONTROL_SETUP_INSTALLATION]:{version:1,setupId:'e'.repeat(32),bundleSha256:digest}}),control=f.bind();
  f.handle(async m=>({...m,state:m.action==='pause-installation-status'?'stopped':'requested'}));
  assert.equal((await control.pause()).outcome,'requested');
  assert.equal(f.data[INSTALLATION_PAUSE_ASSOCIATIONS][operationId],undefined);
  assert.equal(f.data[INSTALLATION_PAUSE_ASSOCIATIONS+':'+operationId].bundleSha256,digest);
  assert.deepEqual(await control.observe(operationId),{operationId,state:'stopped'});
  assert.equal(await control.reconcile(operationId),null);
});
test('archived original ID cannot downgrade to legacy or be replaced on an unknown status',async()=>{
  const f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:{operationId,outcome:'unconfirmed'},
    [INSTALLATION_PAUSE_ASSOCIATIONS+':'+operationId]:{version:1,operationId,bundleSha256:digest},
    [ADMIN_CONTROL_SETUP_INSTALLATION]:{version:1,setupId:'e'.repeat(32),bundleSha256:digest}}),control=f.bind();
  f.handle(async m=>{assert.equal(m.action,'pause-installation-status');return {...m,state:'unconfirmed'};});
  assert.deepEqual(await control.pause(),{operationId,outcome:'unconfirmed'});
  assert.equal(f.calls.length,1);
});
test('A unknown then B Pause then A Pause retains A original operation without a second mutation',async()=>{
  const other='f'.repeat(64),f=fixture({[INSTALLATION_PAUSE_ASSOCIATIONS]:{[operationId]:digest},
    [ADMIN_BROWSER_PAUSE_LAST]:{operationId:'c'.repeat(32),outcome:'requested'},
    [ADMIN_CONTROL_SETUP_INSTALLATION]:{version:1,setupId:'e'.repeat(32),bundleSha256:digest}});
  f.data[INSTALLATION_PAUSE_ASSOCIATIONS]['c'.repeat(32)]=other;
  f.handle(async m=>({...m,state:'unconfirmed'}));
  assert.deepEqual(await f.bind().pause(),{operationId,outcome:'unconfirmed'});
  assert.equal(f.calls.some(m=>m.action==='pause-installation'),false);
  assert.equal(f.data[ADMIN_BROWSER_PAUSE_LAST].operationId,operationId);
});
