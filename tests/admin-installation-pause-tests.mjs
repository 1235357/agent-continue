import test from 'node:test';
import assert from 'node:assert/strict';
import { bindInstallationPause, INSTALLATION_PAUSE_ASSOCIATIONS } from '../admin-installation-pause.js';
import { ADMIN_BROWSER_PAUSE_LAST } from '../admin-browser.js';
import { ADMIN_CONTROL_SETUP_INSTALLATION } from '../admin-control.js';

const digest='a'.repeat(64), operationId='b'.repeat(32);
const nativeReply=m=>({...m,...(m.action==='control-support'?{state:'supported',control:'revoke',bundleSha256:digest,
  target:null,ownerState:'running',eligible:true}:m.action==='pause-installation-support'?{state:'supported'}:
  m.action==='pause-installation-status'?{state:'unconfirmed'}:{state:'requested'})});
function fixture(initial={}) {
  const data=structuredClone(initial), calls=[], events=[], writes=[];
  let grant=true, native=nativeReply, failWrite=false, corruptRead=false;
  const api={extension:{},runtime:{getPlatformInfo:async()=>({os:'win'}),
    sendNativeMessage:async(host,message)=>{calls.push(message);return native(message);}},
    permissions:{contains:async()=>grant,onRemoved:{addListener:fn=>events.push(fn)}},
    storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,
      corruptRead&&key===INSTALLATION_PAUSE_ASSOCIATIONS?{}:structuredClone(data[key])])),
      set:async values=>{if(failWrite)throw Error('storage');writes.push(structuredClone(values));
        Object.assign(data,structuredClone(values));}}}};
  return {api,data,calls,writes,bind:options=>bindInstallationPause(api,options),handle:fn=>{native=fn;},
    revoke(){grant=false;events.forEach(fn=>fn({permissions:['nativeMessaging']}));},
    grant(){grant=true;},
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
test('missing native capability reply fails closed without a legacy downgrade',async()=>{
  const f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:{operationId,outcome:'unconfirmed'}}),control=f.bind();
  f.handle(async()=>null);
  assert.equal(await control.pause(),null);assert.equal(await control.observe(operationId),undefined);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].action,'control-support');
  assert.deepEqual(f.data[ADMIN_BROWSER_PAUSE_LAST],{operationId,outcome:'unconfirmed'});
});

test('verified installation stop capability is not blocked by an unassociated legacy record',async()=>{
  const prior={operationId,outcome:'unconfirmed'};
  const f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:prior}),control=f.bind();
  const result=await control.pause();
  assert.equal(result.outcome,'requested');assert.notEqual(result.operationId,operationId);
  assert.deepEqual(f.data[INSTALLATION_PAUSE_ASSOCIATIONS+':legacy:'+operationId],prior);
  assert.equal(f.data[INSTALLATION_PAUSE_ASSOCIATIONS][operationId],undefined);
  assert.equal(f.data[INSTALLATION_PAUSE_ASSOCIATIONS][result.operationId],digest);
  assert.equal(await control.observe(operationId),undefined);
  assert.equal(f.calls.filter(m=>m.action==='pause-installation').length,1);
  assert.equal(f.calls.some(m=>m.operationId===operationId),false);
  // Unknown receipt from this same new installation still prohibits replay.
  assert.deepEqual(await f.bind().pause(),result);
  assert.equal(f.calls.filter(m=>m.action==='pause-installation').length,1);
});

test('unassociated legacy record cannot be displaced by unconfirmed installation stop',async()=>{
  const prior={operationId,outcome:'requested'};
  const f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:prior});
  f.handle(async m=>m.action==='control-support'?{version:1,id:m.id,action:m.action,control:'revoke',state:'supported',
    bundleSha256:digest,target:null,ownerState:'running',eligible:true}:{...m,state:'unconfirmed'});
  assert.equal(await f.bind().pause(),null);
  assert.deepEqual(f.data[ADMIN_BROWSER_PAUSE_LAST],prior);
  assert.equal(f.data[INSTALLATION_PAUSE_ASSOCIATIONS],undefined);
  assert.equal(f.calls.some(m=>m.action==='pause-installation'),false);
});
test('missing installation Pause capability fails closed without a write',async()=>{
  const f=fixture(),control=f.bind();f.handle(async()=>null);
  assert.equal(await control.pause(),null);assert.equal(f.data[ADMIN_BROWSER_PAUSE_LAST],undefined);
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
  assert.equal(await control.pause(),null);
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
test('admitted installation Pause survives an unavailable binding read and needs no fresh target',async()=>{
  const f=fixture({[ADMIN_CONTROL_SETUP_INSTALLATION]:{version:1,setupId:'e'.repeat(32),bundleSha256:digest}});
  f.handle(async m=>{assert.equal(m.action,'pause-installation');return {...m,state:'requested'};});
  const result=await f.bind().pause();
  assert.equal(result.outcome,'requested');assert.equal(f.calls.length,2);
  assert.equal(f.calls[0].action,'control-support');
  assert.equal(f.calls[1].bundleSha256,digest);assert.equal(Object.hasOwn(f.calls[1],'target'),false);
});
for(const outcome of ['cancelled','requested','unconfirmed'])test('known installation does not downgrade for legacy '+outcome,async()=>{
  const f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:{operationId,outcome},
    [ADMIN_CONTROL_SETUP_INSTALLATION]:{version:1,setupId:'e'.repeat(32),bundleSha256:digest}});
  f.handle(async m=>{assert.equal(m.action,'pause-installation');return {...m,state:'requested'};});
  assert.equal((await f.bind().pause()).outcome,'requested');
  assert.equal(f.calls.length,2);assert.equal(f.calls[0].action,'control-support');
  assert.notEqual(f.calls[1].operationId,operationId);
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
  assert.deepEqual(f.calls.map(m=>m.action),['control-support','pause-installation-status']);
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

const currentId='c'.repeat(32), legacyArchive=INSTALLATION_PAUSE_ASSOCIATIONS+':legacy:'+operationId;

test('registration upgrade overrides stale setup installation without rebinding its unknown Pause',async()=>{
  const old='f'.repeat(64),prior={operationId,outcome:'requested'};
  const setup={version:1,setupId:'e'.repeat(32),bundleSha256:old};
  const f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:prior,[INSTALLATION_PAUSE_ASSOCIATIONS]:{[operationId]:old},
    [ADMIN_CONTROL_SETUP_INSTALLATION]:setup});
  const result=await f.bind().pause();
  assert.equal(result.outcome,'requested');assert.notEqual(result.operationId,operationId);
  assert.equal(f.calls.filter(m=>m.action==='pause-installation').length,1);
  assert.equal(f.calls.find(m=>m.action==='pause-installation').bundleSha256,digest);
  assert.equal(f.calls.some(m=>m.operationId===operationId),false);
  assert.equal(f.data[INSTALLATION_PAUSE_ASSOCIATIONS][operationId],old);
  assert.deepEqual(f.data[ADMIN_CONTROL_SETUP_INSTALLATION],setup);
  assert.deepEqual(await f.bind().pause(),result);
  assert.equal(f.calls.filter(m=>m.action==='pause-installation').length,1);
});

test('upgrade capability without verified stop support cannot replace a saved installation',async()=>{
  const old='f'.repeat(64),prior={operationId,outcome:'requested'};
  const f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:prior,[INSTALLATION_PAUSE_ASSOCIATIONS]:{[operationId]:old},
    [ADMIN_CONTROL_SETUP_INSTALLATION]:{version:1,setupId:'e'.repeat(32),bundleSha256:old}});
  f.handle(m=>m.action==='pause-installation-support'?null:nativeReply(m));
  assert.equal(await f.bind().pause(),null);
  assert.deepEqual(f.data[ADMIN_BROWSER_PAUSE_LAST],prior);
  assert.equal(f.calls.some(m=>m.action==='pause-installation'),false);
});
for(const known of [false,true])for(const outcome of ['cancelled','requested','unconfirmed'])
  for(const status of ['unconfirmed','null','throw'])
test(`unknown associated Pause preserves legacy ${outcome}, ${status} status, known=${known}`,async()=>{
  const prior={operationId,outcome},original={operationId:currentId,outcome:'unconfirmed'};
  const f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:prior,[INSTALLATION_PAUSE_ASSOCIATIONS]:{[currentId]:digest},
    ...(known?{[ADMIN_CONTROL_SETUP_INSTALLATION]:{version:1,setupId:'e'.repeat(32),bundleSha256:digest}}:{})});
  f.handle(async m=>{
    if(m.action==='pause-installation-status'){
      if(status==='null')return null;
      if(status==='throw')throw Error('transport');
    }
    return nativeReply(m);
  });
  let verifiedBeforeSwitch=false;
  const {get,set}=f.api.storage.local;
  f.api.storage.local.get=async keys=>{
    const values=await get(keys);
    if(values[legacyArchive]?.operationId===operationId&&values[legacyArchive].outcome===outcome&&
      f.data[ADMIN_BROWSER_PAUSE_LAST].operationId===operationId)verifiedBeforeSwitch=true;
    return values;
  };
  f.api.storage.local.set=async values=>{
    if(values[ADMIN_BROWSER_PAUSE_LAST]?.operationId===currentId){
      assert.equal(verifiedBeforeSwitch,true,'verify the archive before switching LAST');
      assert.deepEqual(values[legacyArchive],prior,'commit LAST with the unchanged legacy archive');
    }
    return set(values);
  };
  assert.deepEqual(await f.bind().pause(),original);
  assert.deepEqual(f.data[legacyArchive],prior);
  assert.deepEqual(f.data[INSTALLATION_PAUSE_ASSOCIATIONS],{[currentId]:digest});
  assert.equal(await f.bind().observe(operationId),undefined);
  assert.deepEqual(await f.bind().pause(),original);
  assert.equal(f.calls.some(m=>m.action==='pause-installation'||m.operationId===operationId),false);
});

for(const branch of ['unknown','fresh'])for(const outcome of ['cancelled','requested','unconfirmed'])
for(const fault of ['write-before','write-after','lost-write','read-throw','missing','wrong-id','wrong-outcome','extra-field'])
test(`${branch} Pause fails closed before switching legacy ${outcome} LAST on archive ${fault}`,async()=>{
  const prior={operationId,outcome},map=branch==='unknown'?{[currentId]:digest}:undefined;
  const f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:prior,...(map?{[INSTALLATION_PAUSE_ASSOCIATIONS]:map}:{})});
  const {get,set}=f.api.storage.local;let attempted=false;
  f.api.storage.local.set=async values=>{
    if(Object.hasOwn(values,legacyArchive)){
      attempted=true;
      if(fault==='write-before')throw Error('archive write');
      if(fault==='lost-write')return;
      await set(values);
      if(fault==='write-after')throw Error('archive write acknowledgement');
      return;
    }
    return set(values);
  };
  f.api.storage.local.get=async keys=>{
    const values=await get(keys);
    if(attempted&&Object.hasOwn(values,legacyArchive)){
      if(fault==='read-throw')throw Error('archive read');
      if(fault==='missing')values[legacyArchive]=undefined;
      if(fault==='wrong-id')values[legacyArchive]={...prior,operationId:currentId};
      if(fault==='wrong-outcome')values[legacyArchive]={...prior,outcome:outcome==='requested'?'cancelled':'requested'};
      if(fault==='extra-field')values[legacyArchive]={...prior,extra:true};
    }
    return values;
  };
  assert.equal(await f.bind().pause(),null);
  assert.equal(attempted,true);
  assert.deepEqual(f.data[ADMIN_BROWSER_PAUSE_LAST],prior);
  assert.deepEqual(f.data[INSTALLATION_PAUSE_ASSOCIATIONS],map);
  assert.equal(f.calls.some(m=>m.action==='pause-installation'||m.operationId===operationId),false);
});

for(const branch of ['unknown','fresh'])for(const outcome of ['cancelled','requested','unconfirmed'])
test(`${branch} Pause cannot overwrite a conflicting original legacy ${outcome} archive`,async()=>{
  const prior={operationId,outcome},conflict={operationId,outcome:outcome==='unconfirmed'?'requested':'unconfirmed'};
  const f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:prior,...(branch==='unknown'?{[INSTALLATION_PAUSE_ASSOCIATIONS]:{[currentId]:digest}}:{}),
    [legacyArchive]:conflict});
  assert.equal(await f.bind().pause(),null);
  assert.deepEqual(f.data[ADMIN_BROWSER_PAUSE_LAST],prior);assert.deepEqual(f.data[legacyArchive],conflict);
  assert.equal(f.writes.length,0);assert.equal(f.calls.some(m=>m.action==='pause-installation'),false);
});

for(const branch of ['unknown','fresh'])for(const outcome of ['cancelled','requested','unconfirmed'])
test(`${branch} Pause rechecks the exact legacy ${outcome} archive after the atomic LAST commit`,async()=>{
  const prior={operationId,outcome},f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:prior,
    ...(branch==='unknown'?{[INSTALLATION_PAUSE_ASSOCIATIONS]:{[currentId]:digest}}:{})});
  const {get}=f.api.storage.local;
  f.api.storage.local.get=async keys=>{
    const values=await get(keys);
    if(f.data[ADMIN_BROWSER_PAUSE_LAST].operationId!==operationId&&Object.hasOwn(values,legacyArchive))
      values[legacyArchive]={...prior,extra:true};
    return values;
  };
  assert.equal(await f.bind().pause(),null);
  assert.deepEqual(f.data[legacyArchive],prior);
  assert.equal(f.calls.some(m=>m.action==='pause-installation'),false);
});

for(const branch of ['unknown','fresh'])for(const outcome of ['cancelled','requested','unconfirmed'])
for(const stage of ['archive-write','archive-read'])
test(`${branch} Pause cannot switch legacy ${outcome} LAST after permission cycling at ${stage}`,async()=>{
  const prior={operationId,outcome},f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:prior,
    ...(branch==='unknown'?{[INSTALLATION_PAUSE_ASSOCIATIONS]:{[currentId]:digest}}:{})});
  const {get,set}=f.api.storage.local;let written=false;
  const cycle=()=>{f.revoke();f.grant();};
  f.api.storage.local.set=async values=>{
    await set(values);
    if(Object.hasOwn(values,legacyArchive)){written=true;if(stage==='archive-write')cycle();}
  };
  f.api.storage.local.get=async keys=>{
    const values=await get(keys);
    if(written&&Object.hasOwn(values,legacyArchive)&&stage==='archive-read')cycle();
    return values;
  };
  assert.equal(await f.bind().pause(),null);
  assert.deepEqual(f.data[ADMIN_BROWSER_PAUSE_LAST],prior);assert.deepEqual(f.data[legacyArchive],prior);
  assert.equal(f.calls.some(m=>m.action==='pause-installation'),false);
});

test('an interrupted archive resumes with the original legacy record and never dispatches a replacement',async()=>{
  const prior={operationId,outcome:'requested'},f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:prior,
    [INSTALLATION_PAUSE_ASSOCIATIONS]:{[currentId]:digest}}),{set}=f.api.storage.local;
  f.api.storage.local.set=async values=>{await set(values);throw Error('lost archive acknowledgement');};
  assert.equal(await f.bind().pause(),null);
  assert.deepEqual(f.data[legacyArchive],prior);assert.deepEqual(f.data[ADMIN_BROWSER_PAUSE_LAST],prior);
  f.api.storage.local.set=set;
  assert.deepEqual(await f.bind().pause(),{operationId:currentId,outcome:'unconfirmed'});
  assert.deepEqual(f.data[legacyArchive],prior);
  assert.deepEqual(f.data[INSTALLATION_PAUSE_ASSOCIATIONS],{[currentId]:digest});
  assert.equal(f.calls.some(m=>m.action==='pause-installation'||m.operationId===operationId),false);
});

for(const action of ['control-support','pause-installation-support']){
  for(const [field,value] of [['id','wrong'],['action','wrong'],['version',2],['extra',true],
    ['bundleSha256',action==='control-support'?'invalid':'f'.repeat(64)],['state','invalid'],
    ...(action==='control-support'?[['control','connect'],['target','d'.repeat(32)+':idle'],['eligible','yes']]:[])])
  test(`legacy upgrade rejects ${action} ${field} without a storage write or mutation`,async()=>{
    const prior={operationId,outcome:'unconfirmed'},f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:prior});
    f.handle(async m=>m.action===action?{...nativeReply(m),[field]:value}:nativeReply(m));
    assert.equal(await f.bind().pause(),null);
    assert.equal(f.calls.at(-1).action,action);
    assert.deepEqual(f.data,{[ADMIN_BROWSER_PAUSE_LAST]:prior});assert.equal(f.writes.length,0);
    assert.equal(f.calls.some(m=>m.action==='pause-installation'),false);
  });
  test('legacy upgrade rejects a permission removal/regrant during '+action,async()=>{
    const prior={operationId,outcome:'unconfirmed'},f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:prior});
    f.handle(async m=>{if(m.action===action){f.revoke();f.grant();}return nativeReply(m);});
    assert.equal(await f.bind().pause(),null);
    assert.deepEqual(f.data,{[ADMIN_BROWSER_PAUSE_LAST]:prior});assert.equal(f.writes.length,0);
    assert.equal(f.calls.some(m=>m.action==='pause-installation'),false);
  });
  for(const failure of ['null','throw','timeout'])
  test(`legacy upgrade leaves LAST unchanged when ${action} returns ${failure}`,async()=>{
    const prior={operationId,outcome:'unconfirmed'},f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:prior});
    f.handle(m=>{
      if(m.action!==action)return nativeReply(m);
      if(failure==='throw')throw Error('transport');
      return failure==='null'?null:new Promise(()=>{});
    });
    const timers={setTimeout:fn=>{queueMicrotask(fn);return {unref(){}};},clearTimeout(){}};
    assert.equal(await f.bind({timers}).pause(),null);
    assert.equal(f.calls.at(-1).action,action);
    assert.deepEqual(f.data,{[ADMIN_BROWSER_PAUSE_LAST]:prior});assert.equal(f.writes.length,0);
    assert.equal(f.calls.some(m=>m.action==='pause-installation'),false);
  });
}

test('legacy upgrade accepts a valid newly discovered digest only with matching stop support',async()=>{
  const other='f'.repeat(64),prior={operationId,outcome:'unconfirmed'},f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:prior});
  f.handle(async m=>m.action==='control-support'?{...nativeReply(m),bundleSha256:other}:nativeReply(m));
  const result=await f.bind().pause();
  assert.equal(result.outcome,'requested');assert.notEqual(result.operationId,operationId);
  assert.deepEqual(f.data[legacyArchive],prior);assert.equal(f.data[INSTALLATION_PAUSE_ASSOCIATIONS][result.operationId],other);
});

for(const context of ['linux','permission-denied','incognito'])
test('legacy upgrade cannot probe or mutate in '+context,async()=>{
  const prior={operationId,outcome:'unconfirmed'},f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:prior});
  if(context==='linux')f.api.runtime.getPlatformInfo=async()=>({os:'linux'});
  if(context==='permission-denied')f.revoke();
  if(context==='incognito')f.api.extension.inIncognitoContext=true;
  const control=f.bind();
  if(context==='incognito')assert.equal(control,null);
  else assert.equal(await control.pause(),null);
  assert.deepEqual(f.calls,[]);assert.deepEqual(f.writes,[]);
  assert.deepEqual(f.data,{[ADMIN_BROWSER_PAUSE_LAST]:prior});
});

for(const action of ['control-support','pause-installation-support'])
for(const outcome of ['cancelled','requested','unconfirmed'])
test(`only explicit valid ${action} unsupported permits legacy ${outcome} fallback`,async()=>{
  const prior={operationId,outcome},f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:prior});
  f.handle(m=>m.action!==action?nativeReply(m):action==='control-support'?
    {...m,state:'unsupported',bundleSha256:null,target:null,ownerState:'unobserved',eligible:false}:{...m,state:'unsupported'});
  assert.equal(await f.bind().pause(),undefined);
  assert.deepEqual(f.data,{[ADMIN_BROWSER_PAUSE_LAST]:prior});assert.deepEqual(f.writes,[]);
  assert.equal(f.calls.at(-1).action,action);
});

for(const outcome of ['cancelled','requested','unconfirmed'])
test('valid unconfirmed discovery cannot enable legacy '+outcome+' fallback',async()=>{
  const prior={operationId,outcome},f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:prior});
  f.handle(m=>({...m,state:'unconfirmed',bundleSha256:null,target:null,ownerState:'unobserved',eligible:false}));
  assert.equal(await f.bind().pause(),null);assert.deepEqual(f.data,{[ADMIN_BROWSER_PAUSE_LAST]:prior});
  assert.deepEqual(f.writes,[]);assert.equal(f.calls.length,1);
});

for(const outcome of ['cancelled','requested','unconfirmed'])
for(const fault of ['throw','corrupt','full'])
test(`capability storage ${fault} cannot enable legacy ${outcome} fallback`,async()=>{
  const prior={operationId,outcome},f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:prior});
  const {get}=f.api.storage.local;
  f.api.storage.local.get=async keys=>{
    const values=await get(keys);
    if(f.calls.some(m=>m.action==='control-support')&&Array.isArray(keys)){
      if(fault==='throw')throw Error('capability storage');
      values[INSTALLATION_PAUSE_ASSOCIATIONS]=fault==='corrupt'?null:
        Object.fromEntries(Array.from({length:256},(_,i)=>[i.toString(16).padStart(32,'0'),digest]));
    }
    return values;
  };
  assert.equal(await f.bind().pause(),null);assert.deepEqual(f.writes,[]);
  assert.deepEqual(f.data,{[ADMIN_BROWSER_PAUSE_LAST]:prior});
  assert.deepEqual(f.calls.map(m=>m.action),['control-support']);
});

for(const outcome of ['cancelled','requested','unconfirmed'])
test('fresh Pause verifies legacy '+outcome+' before switching LAST and dispatching once',async()=>{
  const prior={operationId,outcome},f=fixture({[ADMIN_BROWSER_PAUSE_LAST]:prior});
  const {get,set}=f.api.storage.local;let verified=false;
  f.api.storage.local.get=async keys=>{
    const values=await get(keys);
    if(values[legacyArchive]?.outcome===outcome&&f.data[ADMIN_BROWSER_PAUSE_LAST].operationId===operationId)verified=true;
    return values;
  };
  f.api.storage.local.set=async values=>{
    if(values[ADMIN_BROWSER_PAUSE_LAST]?.operationId!==operationId&&Object.hasOwn(values,INSTALLATION_PAUSE_ASSOCIATIONS)){
      assert.equal(verified,true);assert.deepEqual(values[legacyArchive],prior);
    }
    return set(values);
  };
  const result=await f.bind().pause();assert.equal(result.outcome,'requested');assert.notEqual(result.operationId,operationId);
  assert.deepEqual(f.data[legacyArchive],prior);assert.equal(f.data[INSTALLATION_PAUSE_ASSOCIATIONS][operationId],undefined);
  assert.deepEqual(await f.bind().pause(),result);
  assert.equal(f.calls.filter(m=>m.action==='pause-installation').length,1);
});
