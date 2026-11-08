import assert from 'node:assert/strict';
import test from 'node:test';
import { bindSetupInstallation, SETUP_BEGIN, SETUP_CONNECT } from '../setup-controller.js';
import { bindAdministratorControls, ADMIN_CONTROL_JOURNAL, ADMIN_CONTROL_SETUP } from '../admin-control.js';

const extension='a'.repeat(32),setupId='b'.repeat(32),bundleSha256='c'.repeat(64),target='d'.repeat(32)+':idle';
const sender={id:extension,frameId:0,documentId:'setup-document',tab:{id:1},url:`chrome-extension://${extension}/setup.html`};
function event(){return {addListener(){}};}
function fixture(t){
  const data={},calls=[];
  const api={runtime:{id:extension,getURL:path=>`chrome-extension://${extension}/${path}`,
    getPlatformInfo:async()=>({os:'win'}),onStartup:event(),
    async sendNativeMessage(host,request){
      calls.push(structuredClone(request));
      if(request.action==='setup-status') return {...request,state:'installed',bundleSha256,target};
      if(request.action==='control-support')return {...request,state:'supported',bundleSha256,target,ownerState:'paused',eligible:true};
      if(request.action==='control-status')return {version:1,id:request.id,action:request.action,
        bundleSha256,operationId:request.operationId,control:'connect',state:'unconfirmed',progress:null};
      if(request.action==='control')return {version:1,id:request.id,action:request.action,
        bundleSha256,operationId:request.operationId,control:'connect',outcome:'requested'};
      assert.fail('unexpected native action');
    }},
    permissions:{contains:async()=>true,onRemoved:event(),onAdded:event()},
    storage:{local:{async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(data[key])]));},
      async set(value){Object.assign(data,structuredClone(value));}}},
    tabs:{onRemoved:event(),onUpdated:event()},alarms:{onAlarm:event(),clear:async()=>{},create:async()=>{}}};
  const instances=[];
  const start=()=>{
    const controls=bindAdministratorControls(api,{now:()=>700000});
    const setup=bindSetupInstallation(api,{controls,now:()=>0,checkStopSupport:async()=>true,prepareObserver:async()=>true});
    const instance={controls,setup,dispose(){setup.dispose();controls.dispose();},
      send:type=>setup.handleMessage({type,setupId},sender)};
    instances.push(instance);return instance;
  };
  t.after(()=>instances.forEach(instance=>instance.dispose()));
  return {api,data,calls,start};
}
test('actual setup/control modules associate one original ID before one native Connect',async t=>{
  const f=fixture(t),worker=f.start();
  await worker.send(SETUP_BEGIN);
  const [a,b]=await Promise.all([worker.send(SETUP_CONNECT),worker.send(SETUP_CONNECT)]);
  assert.equal(a.state,'submitted');assert.deepEqual(a,b);
  const association=f.data[ADMIN_CONTROL_SETUP+setupId],record=f.data[ADMIN_CONTROL_JOURNAL].operations[0];
  assert.equal(association.operationId,record.operationId);
  assert.equal(record.operationId,a.operation.operationId);
  assert.equal(f.calls.filter(call=>call.action==='control').length,1);
});
test('a restarted worker with the same setup cannot dispatch another Connect',async t=>{
  const f=fixture(t),first=f.start();await first.send(SETUP_BEGIN);
  const original=await first.send(SETUP_CONNECT);first.dispose();
  const next=f.start();
  assert.equal(await next.send(SETUP_CONNECT),null);
  await next.send(SETUP_BEGIN);
  const existing=await next.send(SETUP_CONNECT);
  assert.equal(existing.operation.operationId,original.operation.operationId);
  assert.equal(f.calls.filter(call=>call.action==='control').length,1);
});
test('Pause during the atomic admission keeps the original uncertain ID but prevents transport',async t=>{
  const f=fixture(t),worker=f.start();await worker.send(SETUP_BEGIN);
  const save=f.api.storage.local.set;
  f.api.storage.local.set=async value=>{
    await save(value);
    if(Object.hasOwn(value,ADMIN_CONTROL_SETUP+setupId))worker.controls.cancelPendingStartup();
  };
  const value=await worker.send(SETUP_CONNECT);
  assert.equal(value.state,'cancelled');
  assert.ok(value.operation.operationId);
  assert.equal(value.operation.operationId,f.data[ADMIN_CONTROL_SETUP+setupId].operationId);
  assert.equal(f.calls.some(call=>call.action==='control'),false);
});
