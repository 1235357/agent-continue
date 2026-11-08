import test from 'node:test';
import assert from 'node:assert/strict';
import { bindAdministratorControls, ADMIN_CONTROL } from '../admin-control.js';
import { bindInstallationPause, INSTALLATION_PAUSE_ASSOCIATIONS } from '../admin-installation-pause.js';
import { bindAdministratorBrowser, ADMIN_BROWSER_PAUSE, ADMIN_BROWSER_PAUSE_STATUS,
  ADMIN_BROWSER_PAUSE_LAST, ADMIN_BROWSER_PAUSE_RECONCILE } from '../admin-browser.js';
import { bindSetupInstallation, SETUP_BEGIN, SETUP_CONNECT } from '../setup-controller.js';

const extension='a'.repeat(32),setupId='b'.repeat(32),bundleSha256='c'.repeat(64),target='d'.repeat(32)+':idle';
const sender={id:extension,frameId:0,documentId:'setup',tab:{id:1},url:`chrome-extension://${extension}/setup.html`};
const devices={...sender,documentId:'devices',url:`chrome-extension://${extension}/devices.html?mode=browser-managed`};
const event=()=>({addListener(){}});
test('all real worker modules let installation Pause override a dispatched Connect without a target resample',async t=>{
  const data={},session={},calls=[];let release,admitted;
  const admission=new Promise(resolve=>{admitted=resolve;});
  const response=new Promise(resolve=>{release=resolve;});
  const api={runtime:{id:extension,getURL:p=>`chrome-extension://${extension}/${p}`,
    getPlatformInfo:async()=>({os:'win'}),onStartup:event(),
    async sendNativeMessage(host,m){
      calls.push(m);
      if(m.action==='setup-status')return {...m,state:'installed',bundleSha256,target};
      if(m.action==='pause-installation-support')return {...m,state:'supported'};
      if(m.action==='control-support')return {...m,state:'supported',bundleSha256,target,ownerState:'paused',eligible:true};
      if(m.action==='control') {admitted();await response;return {...m,target:undefined,outcome:'requested'};}
      if(m.action==='control-status')return {...m,state:'unconfirmed',progress:null};
      if(m.action==='pause-installation')return {...m,state:'requested'};
      if(m.action==='pause-installation-status')return {...m,state:'stopped'};
      assert.fail('unexpected native action '+m.action);
    }},permissions:{contains:async()=>true,onAdded:event(),onRemoved:event()},
    storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(data[k])])),
      set:async value=>Object.assign(data,structuredClone(value)),remove:async key=>{delete data[key];}},
      session:{get:async key=>({[key]:session[key]}),set:async value=>Object.assign(session,value)}},
    tabs:{onRemoved:event(),onUpdated:event()},alarms:{onAlarm:event(),clear:async()=>{},create:async()=>{}}};
  const controls=bindAdministratorControls(api),pause=bindInstallationPause(api);
  const setup=bindSetupInstallation(api,{controls,checkStopSupport:digest=>pause.available(digest),prepareObserver:async()=>true});
  const browser=bindAdministratorBrowser(api,{installationPause:pause,
    onPauseIntent(){controls.cancelPendingStartup();setup.cancelAll();}});
  t.after(()=>{release();controls.dispose();setup.dispose();});
  await setup.handleMessage({type:SETUP_BEGIN,setupId},sender);
  const connect=setup.handleMessage({type:SETUP_CONNECT,setupId},sender);
  await admission;
  const before=calls.length;
  const result=await browser.handleMessage({type:ADMIN_BROWSER_PAUSE},devices);
  assert.equal(result.outcome,'requested');
  assert.deepEqual(calls.slice(before).map(m=>m.action),['pause-installation']);
  assert.equal(Object.hasOwn(calls.at(-1),'target'),false);
  release();assert.equal((await connect).state,'cancelled');
  assert.deepEqual(await browser.handleMessage({type:ADMIN_BROWSER_PAUSE_STATUS,operationId:result.operationId},devices),
    {operationId:result.operationId,state:'stopped'});
  assert.equal(calls.some(m=>m.action==='pause'||m.action==='pause-support'),false);
  assert.equal(calls.filter(m=>m.action==='control').length,1);
});

const legacyId='e'.repeat(32),currentId='f'.repeat(32);
const legacyRecord={operationId:legacyId,outcome:'unconfirmed'};
const legacyKey=INSTALLATION_PAUSE_ASSOCIATIONS+':legacy:'+legacyId;
const mutators=new Set(['pause-installation','pause','pause-reconcile','control']);
function upgradeFixture(t,initial={}){
  const data={[ADMIN_BROWSER_PAUSE_LAST]:structuredClone(legacyRecord),...structuredClone(initial)};
  const session={},calls=[],writes=[],removed=[],startup=[];let granted=true,handler;
  const reply=m=>{
    if(m.action==='control-support')return {...m,state:'supported',bundleSha256,
      target:m.control==='revoke'?null:target,ownerState:'running',eligible:true};
    if(m.action==='pause-installation-support')return {...m,state:'supported'};
    if(m.action==='pause-installation-status')return {...m,state:'unconfirmed'};
    if(m.action==='pause-installation')return {...m,state:'requested'};
    if(m.action==='pause-status')return {...m,state:'unconfirmed'};
    if(m.action==='pause-support')return {...m,state:'supported',target};
    if(m.action==='pause')return {version:m.version,id:m.id,action:m.action,operationId:m.operationId,state:'requested'};
    throw Error('unexpected mock action '+m.action);
  };
  handler=reply;
  const api={extension:{},runtime:{id:extension,getURL:p=>`chrome-extension://${extension}/${p}`,
    getPlatformInfo:async()=>({os:'win'}),onStartup:{addListener:fn=>startup.push(fn)},
    sendNativeMessage:async(host,m)=>{calls.push(structuredClone(m));return handler(m);}},
    permissions:{contains:async()=>granted,onRemoved:{addListener:fn=>removed.push(fn)},onAdded:event()},
    storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(data[k])])),
      set:async value=>{writes.push(structuredClone(value));Object.assign(data,structuredClone(value));},
      remove:async key=>{delete data[key];}},
      session:{get:async key=>({[key]:session[key]}),set:async value=>Object.assign(session,value)}}};
  const controls=bindAdministratorControls(api,{prepareObserver:async()=>true});
  const bind=(options={})=>bindAdministratorBrowser(api,{installationPause:bindInstallationPause(api,options),
    onPauseIntent:()=>controls.cancelPendingStartup()});
  const browser=bind();
  t.after(()=>controls.dispose());
  return {api,data,calls,writes,controls,browser,bind,reply,handle:fn=>{handler=fn;},
    send:(message,from=devices)=>browser.handleMessage(message,from),
    start:()=>Promise.all(startup.map(fn=>fn())),
    revoke(){granted=false;removed.forEach(fn=>fn({permissions:['nativeMessaging']}));},
    grant(){granted=true;}};
}

for(const outcome of ['cancelled','requested','unconfirmed'])
test('upgraded browser Pause archives legacy '+outcome+', uses one fresh untargeted ID and retains original routing',async t=>{
  const prior={operationId:legacyId,outcome},f=upgradeFixture(t,{[ADMIN_BROWSER_PAUSE_LAST]:prior});
  const permit=f.controls.captureStartupPermit();
  const pending=f.send({type:ADMIN_BROWSER_PAUSE});
  assert.equal(permit(),false,'explicit Pause cancels startup before the first asynchronous probe');
  const result=await pending;
  assert.equal(result.outcome,'requested');assert.notEqual(result.operationId,legacyId);
  assert.deepEqual(f.data[legacyKey],prior);
  assert.equal(f.data[INSTALLATION_PAUSE_ASSOCIATIONS][legacyId],undefined);
  assert.equal(f.data[INSTALLATION_PAUSE_ASSOCIATIONS][result.operationId],bundleSha256);
  assert.deepEqual(f.calls.map(m=>m.action),['control-support','pause-installation-support','pause-installation']);
  assert.equal(Object.hasOwn(f.calls.at(-1),'target'),false);
  assert.deepEqual(await f.bind().handleMessage({type:ADMIN_BROWSER_PAUSE},devices),result);
  assert.equal(f.calls.filter(m=>mutators.has(m.action)).length,1);
  const before=f.calls.length;
  assert.deepEqual(await f.send({type:ADMIN_BROWSER_PAUSE_STATUS,operationId:legacyId}),
    {operationId:legacyId,state:'unconfirmed'});
  assert.deepEqual(f.calls.slice(before).map(m=>[m.action,m.operationId]),[['pause-status',legacyId]]);
  assert.equal(await f.send({type:ADMIN_BROWSER_PAUSE_RECONCILE,operationId:legacyId}),null);
  assert.equal(await f.send({type:ADMIN_BROWSER_PAUSE_RECONCILE,operationId:result.operationId}),null);
  assert.equal(f.calls.some(m=>mutators.has(m.action)&&m.operationId===legacyId),false);
});

for(const status of ['unconfirmed','null','throw'])
test('upgraded browser retains legacy record and does not replay a current unknown: '+status,async t=>{
  const f=upgradeFixture(t,{[INSTALLATION_PAUSE_ASSOCIATIONS]:{[currentId]:bundleSha256}});
  f.handle(m=>{
    if(m.action==='pause-installation-status'){
      if(status==='null')return null;
      if(status==='throw')throw Error('lost status');
    }
    return f.reply(m);
  });
  const result={operationId:currentId,outcome:'unconfirmed'};
  assert.deepEqual(await f.send({type:ADMIN_BROWSER_PAUSE}),result);
  assert.deepEqual(f.data[legacyKey],legacyRecord);
  assert.deepEqual(await f.bind().handleMessage({type:ADMIN_BROWSER_PAUSE},devices),result);
  assert.equal(await f.send({type:ADMIN_BROWSER_PAUSE_RECONCILE,operationId:currentId}),null);
  assert.equal(f.calls.some(m=>mutators.has(m.action)),false);
  assert.equal(f.calls.some(m=>m.action==='pause-status'||m.action==='pause-support'),false);
});

for(const branch of ['unknown','fresh'])for(const outcome of ['cancelled','requested','unconfirmed'])
for(const fault of ['write-before','write-after','missing','corrupt','read-throw'])
test(`${branch} browser archive ${fault} preserves legacy ${outcome} without fallback or mutation`,async t=>{
  const prior={operationId:legacyId,outcome},f=upgradeFixture(t,{[ADMIN_BROWSER_PAUSE_LAST]:prior,
    ...(branch==='unknown'?{[INSTALLATION_PAUSE_ASSOCIATIONS]:{[currentId]:bundleSha256}}:{})});
  const {get,set}=f.api.storage.local;let attempted=false;
  f.api.storage.local.set=async values=>{
    if(Object.hasOwn(values,legacyKey)){
      attempted=true;
      if(fault==='write-before')throw Error('archive write');
      await set(values);
      if(fault==='write-after')throw Error('archive acknowledgement');
      return;
    }
    return set(values);
  };
  f.api.storage.local.get=async keys=>{
    const values=await get(keys);
    if(attempted&&Object.hasOwn(values,legacyKey)){
      if(fault==='read-throw')throw Error('archive read');
      if(fault==='missing')values[legacyKey]=undefined;
      if(fault==='corrupt')values[legacyKey]={...prior,extra:true};
    }
    return values;
  };
  assert.equal(await f.send({type:ADMIN_BROWSER_PAUSE}),null);
  assert.equal(attempted,true);assert.deepEqual(f.data[ADMIN_BROWSER_PAUSE_LAST],prior);
  assert.equal(await f.bind().handleMessage({type:ADMIN_BROWSER_PAUSE},devices),null);
  assert.equal(f.calls.some(m=>mutators.has(m.action)),false);
  assert.equal(f.calls.some(m=>m.action==='pause-status'||m.action==='pause-support'),false);
});

for(const branch of ['unknown','fresh'])for(const outcome of ['cancelled','requested','unconfirmed'])
for(const fault of ['write-before','write-after','lost-write','read-throw','wrong-LAST','wrong-association','archive-mismatch','permission'])
test(`${branch} browser atomic LAST ${fault}, legacy ${outcome}, never falls back or replays`,async t=>{
  const prior={operationId:legacyId,outcome},f=upgradeFixture(t,{[ADMIN_BROWSER_PAUSE_LAST]:prior,
    ...(branch==='unknown'?{[INSTALLATION_PAUSE_ASSOCIATIONS]:{[currentId]:bundleSha256}}:{})});
  const {get,set}=f.api.storage.local;let committing=false;
  f.api.storage.local.set=async values=>{
    if(values[ADMIN_BROWSER_PAUSE_LAST]&&values[ADMIN_BROWSER_PAUSE_LAST].operationId!==legacyId){
      committing=true;
      assert.deepEqual(f.data[legacyKey],prior);
      assert.deepEqual(values[legacyKey],prior);
      if(fault==='write-before')throw Error('LAST write');
      if(fault==='lost-write')return;
      await set(values);
      if(fault==='write-after')throw Error('LAST acknowledgement');
      if(fault==='permission'){f.revoke();f.grant();}
      return;
    }
    return set(values);
  };
  f.api.storage.local.get=async keys=>{
    const values=await get(keys);
    if(committing){
      if(fault==='read-throw')throw Error('LAST read');
      if(fault==='wrong-LAST'&&Object.hasOwn(values,ADMIN_BROWSER_PAUSE_LAST))values[ADMIN_BROWSER_PAUSE_LAST]=prior;
      if(fault==='wrong-association'&&Object.hasOwn(values,INSTALLATION_PAUSE_ASSOCIATIONS))values[INSTALLATION_PAUSE_ASSOCIATIONS]={};
      if(fault==='archive-mismatch'&&Object.hasOwn(values,legacyKey))values[legacyKey]={...prior,extra:true};
    }
    return values;
  };
  assert.equal(await f.send({type:ADMIN_BROWSER_PAUSE}),null);
  assert.equal(committing,true);assert.deepEqual(f.data[legacyKey],prior);
  assert.equal(f.calls.some(m=>mutators.has(m.action)),false);
  if(fault==='write-before'||fault==='lost-write')assert.deepEqual(f.data[ADMIN_BROWSER_PAUSE_LAST],prior);
  f.api.storage.local.get=get;f.api.storage.local.set=set;
  if(branch==='unknown'||!['write-before','lost-write'].includes(fault)){
    const id=branch==='unknown'?currentId:f.data[ADMIN_BROWSER_PAUSE_LAST].operationId;
    assert.deepEqual(await f.bind().handleMessage({type:ADMIN_BROWSER_PAUSE},devices),{operationId:id,outcome:'unconfirmed'});
  }
  assert.equal(f.calls.some(m=>mutators.has(m.action)),false);
  assert.equal(f.calls.some(m=>m.action==='pause-status'||m.action==='pause-support'),false);
});

test('upgraded browser permission cycling after archive verification cannot switch LAST or fall back',async t=>{
  const f=upgradeFixture(t,{[INSTALLATION_PAUSE_ASSOCIATIONS]:{[currentId]:bundleSha256}}),{get}=f.api.storage.local;
  f.api.storage.local.get=async keys=>{
    const values=await get(keys);
    if(values[legacyKey]){f.revoke();f.grant();}
    return values;
  };
  assert.equal(await f.send({type:ADMIN_BROWSER_PAUSE}),null);
  assert.deepEqual(f.data[ADMIN_BROWSER_PAUSE_LAST],legacyRecord);assert.deepEqual(f.data[legacyKey],legacyRecord);
  assert.equal(f.calls.some(m=>mutators.has(m.action)),false);
  assert.equal(f.calls.some(m=>m.action==='pause-status'||m.action==='pause-support'),false);
});

for(const outcome of ['cancelled','requested','unconfirmed'])
for(const action of ['control-support','pause-installation-support']){
  for(const field of ['id','action','version','extra','bundleSha256'])
  test(`upgraded browser rejects malformed ${action} ${field}, legacy ${outcome}, without fallback`,async t=>{
    const prior={operationId:legacyId,outcome},f=upgradeFixture(t,{[ADMIN_BROWSER_PAUSE_LAST]:prior});
    const value=field==='version'?2:field==='bundleSha256'?(action==='control-support'?'invalid':'0'.repeat(64)):'wrong';
    f.handle(m=>m.action===action?{...f.reply(m),[field]:value}:
      m.action==='pause-status'?{...f.reply(m),state:'stopped'}:f.reply(m));
    assert.equal(await f.send({type:ADMIN_BROWSER_PAUSE}),null);
    assert.deepEqual(f.data,{[ADMIN_BROWSER_PAUSE_LAST]:prior});assert.equal(f.writes.length,0);
    assert.equal(f.calls.some(m=>mutators.has(m.action)),false);
    assert.equal(f.calls.some(m=>m.action==='pause-status'||m.action==='pause-support'),false);
  });
  test(`upgraded browser cannot use an old permission epoch after ${action}, legacy ${outcome}`,async t=>{
    const prior={operationId:legacyId,outcome},f=upgradeFixture(t,{[ADMIN_BROWSER_PAUSE_LAST]:prior});
    f.handle(m=>{if(m.action===action){f.revoke();f.grant();}return f.reply(m);});
    assert.equal(await f.send({type:ADMIN_BROWSER_PAUSE}),null);
    assert.deepEqual(f.data,{[ADMIN_BROWSER_PAUSE_LAST]:prior});assert.equal(f.writes.length,0);
    assert.equal(f.calls.some(m=>mutators.has(m.action)),false);
    assert.equal(f.calls.some(m=>m.action==='pause-status'||m.action==='pause-support'),false);
  });
  for(const fault of ['null','throw','timeout','unconfirmed'])
  test(`upgraded browser ${action} ${fault} cannot downgrade legacy ${outcome}`,async t=>{
    const prior={operationId:legacyId,outcome},f=upgradeFixture(t,{[ADMIN_BROWSER_PAUSE_LAST]:prior});
    f.handle(m=>{
      if(m.action===action){
        if(fault==='throw')throw Error('capability');
        if(fault==='timeout')return new Promise(()=>{});
        if(fault==='null')return null;
        return action==='control-support'?{...m,state:'unconfirmed',bundleSha256:null,target:null,ownerState:'unobserved',eligible:false}:
          {...m,state:'unconfirmed'};
      }
      return m.action==='pause-status'?{...f.reply(m),state:'stopped'}:f.reply(m);
    });
    const timers={setTimeout:fn=>{queueMicrotask(fn);return {unref(){}};},clearTimeout(){}};
    assert.equal(await f.bind({timers}).handleMessage({type:ADMIN_BROWSER_PAUSE},devices),null);
    assert.equal(f.calls.at(-1).action,action);
    assert.deepEqual(f.data,{[ADMIN_BROWSER_PAUSE_LAST]:prior});assert.deepEqual(f.writes,[]);
    assert.equal(f.calls.some(m=>mutators.has(m.action)||m.action==='pause-status'||m.action==='pause-support'),false);
  });
}

for(const outcome of ['cancelled','requested','unconfirmed'])
for(const fault of ['throw','corrupt','full'])
test(`browser capability storage ${fault} cannot downgrade legacy ${outcome}`,async t=>{
  const prior={operationId:legacyId,outcome},f=upgradeFixture(t,{[ADMIN_BROWSER_PAUSE_LAST]:prior}),{get}=f.api.storage.local;
  f.handle(m=>m.action==='pause-status'?{...f.reply(m),state:'stopped'}:f.reply(m));
  f.api.storage.local.get=async keys=>{
    const values=await get(keys);
    if(Array.isArray(keys)&&f.calls.some(m=>m.action==='control-support')){
      if(fault==='throw')throw Error('capability storage');
      values[INSTALLATION_PAUSE_ASSOCIATIONS]=fault==='corrupt'?null:
        Object.fromEntries(Array.from({length:256},(_,i)=>[i.toString(16).padStart(32,'0'),bundleSha256]));
    }
    return values;
  };
  assert.equal(await f.send({type:ADMIN_BROWSER_PAUSE}),null);
  assert.deepEqual(f.data,{[ADMIN_BROWSER_PAUSE_LAST]:prior});assert.deepEqual(f.writes,[]);
  assert.deepEqual(f.calls.map(m=>m.action),['control-support']);
});

for(const outcome of ['cancelled','requested','unconfirmed'])
test('fresh browser Pause rejects a conflicting legacy '+outcome+' archive without overwriting it',async t=>{
  const prior={operationId:legacyId,outcome},conflict={operationId:legacyId,outcome:outcome==='unconfirmed'?'requested':'unconfirmed'};
  const f=upgradeFixture(t,{[ADMIN_BROWSER_PAUSE_LAST]:prior,[legacyKey]:conflict});
  assert.equal(await f.send({type:ADMIN_BROWSER_PAUSE}),null);
  assert.deepEqual(f.data,{[ADMIN_BROWSER_PAUSE_LAST]:prior,[legacyKey]:conflict});assert.deepEqual(f.writes,[]);
  assert.equal(f.calls.some(m=>mutators.has(m.action)||m.action==='pause-status'||m.action==='pause-support'),false);
});

for(const action of ['control-support','pause-installation-support'])for(const outcome of ['cancelled','requested'])
test(`explicit ${action} unsupported retains legacy ${outcome} browser compatibility`,async t=>{
  const prior={operationId:legacyId,outcome},f=upgradeFixture(t,{[ADMIN_BROWSER_PAUSE_LAST]:prior});
  f.handle(m=>{
    if(m.action===action)return action==='control-support'?
      {...m,state:'unsupported',bundleSha256:null,target:null,ownerState:'unobserved',eligible:false}:{...m,state:'unsupported'};
    return m.action==='pause-status'?{...f.reply(m),state:'stopped'}:f.reply(m);
  });
  const result=await f.send({type:ADMIN_BROWSER_PAUSE});
  assert.equal(result.outcome,'requested');assert.notEqual(result.operationId,legacyId);
  assert.deepEqual(f.calls.filter(m=>mutators.has(m.action)).map(m=>m.action),['pause']);
  assert.equal(f.data[INSTALLATION_PAUSE_ASSOCIATIONS],undefined);
});

for(const outcome of ['cancelled','requested'])for(const action of ['control-support','pause-installation-support'])
for(const fault of ['id','extra','digest','permission','storage','new-association','new-LAST'])
test(`explicit ${action} unsupported ${fault} cannot downgrade legacy ${outcome}`,async t=>{
  const prior={operationId:legacyId,outcome},f=upgradeFixture(t,{[ADMIN_BROWSER_PAUSE_LAST]:prior}),{get}=f.api.storage.local;
  let answered=false;
  f.handle(m=>{
    if(m.action!==action)return m.action==='pause-status'?{...f.reply(m),state:'stopped'}:f.reply(m);
    answered=true;
    const reply=action==='control-support'?
      {...m,state:'unsupported',bundleSha256:null,target:null,ownerState:'unobserved',eligible:false}:{...m,state:'unsupported'};
    if(fault==='id')reply.id='wrong';
    if(fault==='extra')reply.extra=true;
    if(fault==='digest')reply.bundleSha256='0'.repeat(64);
    if(fault==='permission'){f.revoke();f.grant();}
    if(fault==='new-association')f.data[INSTALLATION_PAUSE_ASSOCIATIONS]={[currentId]:bundleSha256};
    if(fault==='new-LAST')f.data[ADMIN_BROWSER_PAUSE_LAST]={...prior,outcome:outcome==='cancelled'?'requested':'cancelled'};
    return reply;
  });
  f.api.storage.local.get=async keys=>{
    if(answered&&fault==='storage'&&Array.isArray(keys))throw Error('fallback storage');
    return get(keys);
  };
  assert.equal(await f.send({type:ADMIN_BROWSER_PAUSE}),null);
  assert.equal(answered,true);assert.deepEqual(f.writes,[]);
  assert.equal(f.calls.some(m=>mutators.has(m.action)||m.action==='pause-status'||m.action==='pause-support'),false);
});

for(const outcome of ['cancelled','requested'])for(const action of ['control-support','pause-installation-support'])
test(`explicit ${action} unsupported cannot bypass existing installation history for legacy ${outcome}`,async t=>{
  const prior={operationId:legacyId,outcome},f=upgradeFixture(t,{[ADMIN_BROWSER_PAUSE_LAST]:prior,
    [INSTALLATION_PAUSE_ASSOCIATIONS]:{[currentId]:bundleSha256}});
  f.handle(m=>m.action!==action?f.reply(m):action==='control-support'?
    {...m,state:'unsupported',bundleSha256:null,target:null,ownerState:'unobserved',eligible:false}:{...m,state:'unsupported'});
  assert.equal(await f.send({type:ADMIN_BROWSER_PAUSE}),null);
  assert.deepEqual(f.data[ADMIN_BROWSER_PAUSE_LAST],prior);assert.deepEqual(f.writes,[]);
  assert.equal(f.calls.some(m=>mutators.has(m.action)||m.action==='pause-status'||m.action==='pause-support'),false);
});

test('upgraded legacy state cannot probe or mutate on worker startup or an untrusted sender',async t=>{
  const f=upgradeFixture(t);
  await f.start();await new Promise(resolve=>setImmediate(resolve));
  const permit=f.controls.captureStartupPermit();
  assert.equal(await f.send({type:ADMIN_BROWSER_PAUSE},{...devices,url:'https://chatgpt.com/'}),null);
  assert.equal(await f.send({type:ADMIN_BROWSER_PAUSE,operationId:legacyId}),null);
  assert.equal(permit(),true);assert.deepEqual(f.calls,[]);assert.deepEqual(f.writes,[]);
  assert.deepEqual(f.data,{[ADMIN_BROWSER_PAUSE_LAST]:legacyRecord});
});

test('upgraded explicit Pause cancels a Connect still awaiting support without replaying either operation',async t=>{
  const f=upgradeFixture(t),entered=Promise.withResolvers(),support=Promise.withResolvers();
  t.after(()=>support.resolve());
  f.handle(async m=>{
    if(m.action==='control-support'&&m.control==='connect'){entered.resolve();await support.promise;}
    return f.reply(m);
  });
  const connecting=f.controls.handleMessage({type:ADMIN_CONTROL,control:'connect',bundleSha256,target},devices);
  await entered.promise;
  assert.equal((await f.send({type:ADMIN_BROWSER_PAUSE})).outcome,'requested');
  support.resolve();assert.equal(await connecting,null);
  assert.equal(f.calls.filter(m=>m.action==='pause-installation').length,1);
  assert.equal(f.calls.some(m=>m.action==='control'||m.action==='pause'||m.action==='pause-reconcile'),false);
});
