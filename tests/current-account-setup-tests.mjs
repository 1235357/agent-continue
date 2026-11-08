import assert from 'node:assert/strict';
import test from 'node:test';
import { bindSetupInstallation, SETUP_BEGIN, SETUP_CONNECT } from '../setup-controller.js';

const source=await import('../current-account-setup.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;
});
const extensionId='b'.repeat(32),setupId='a'.repeat(32),bindingSha256='c'.repeat(64);
const operationId='12345678-1234-4234-8234-123456789abc';
const setup={setupId,scope:'current-account',extensionId,bindingSha256};
const proof={setupId,state:'installed',scope:'current-account',extensionId,bindingSha256};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const event=()=>{const listeners=[];return {addListener:fn=>listeners.push(fn),emit:value=>listeners.forEach(fn=>fn(value))};};
function fixture(t,options={}){
  assert.equal(typeof source.bindCurrentAccountSetup,'function');
  const data={},calls=[],removed=event();let granted=true,allowed=true,ids=0;
  const api={runtime:{id:extensionId,getURL:path=>`chrome-extension://${extensionId}/${path}`,
    async sendNativeMessage(host,request){calls.push({host,request});return {...request,...proof};}},
    permissions:{contains:async()=>granted,onRemoved:removed},
    storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(data[key])])),
      set:async values=>Object.assign(data,structuredClone(values))}},tabs:{onRemoved:event(),onUpdated:event()}};
  const transport=[];
  let locked=Promise.resolve();
  const locks={request:(_name,work)=>{
    const next=locked.then(()=>work());locked=next.catch(()=>{});return next;
  }};
  const wake={captureSetupPermit:()=>()=>allowed,cancelSetupPreparation(){allowed=false;},
    prepareSetupObserver:async admit=>admit(),async connectFromSetup(value,id,admit){
      transport.push({value,id});assert.equal(admit(),true);
      const saved=data[source.CURRENT_ACCOUNT_SETUP_PREFIX+setupId];
      assert.equal(saved.operationId,id);assert.equal(saved.outcome,'unconfirmed');
      if(options.send)return options.send(value,id,admit);
      return {ownerId:'owner-test',response:{version:1,id,action:'reconnect',ok:true,
        state:{paused:false,connection:'ready',operation:{id,action:'reconnect',status:'settled'}}}};
    }};
  const create=()=>source.bindCurrentAccountSetup(api,{wake,locks,createOperationId:()=>{ids++;return operationId;}});
  const adapter=create();t.after(()=>adapter?.dispose());
  return {api,adapter,create,wake,calls,transport,data,removed,key:source.CURRENT_ACCOUNT_SETUP_PREFIX+setupId,
    get ids(){return ids;},pause:()=>adapter.cancelPendingStartup(),deny:()=>{granted=false;removed.emit({permissions:['nativeMessaging']});}};
}

test('real current-account adapter exists and constructor performs no native or connection operation',t=>{
  const f=fixture(t);assert.equal(f.calls.length,0);assert.equal(f.transport.length,0);
  assert.equal(source.bindCurrentAccountSetup(f.api,{wake:{}}),null);
});

test('real adapter/controller correlation admits one reconnect and never reports readiness',async t=>{
  const f=fixture(t),controls={captureStartupPermit:()=>()=>true,connectFromSetup:()=>assert.fail('administrator dispatch')};
  const controller=bindSetupInstallation(f.api,{controls,currentAccount:f.adapter});t.after(()=>controller.dispose());
  const sender={id:extensionId,frameId:0,documentId:'setup-doc',tab:{id:1},url:f.api.runtime.getURL('setup.html')};
  const send=type=>controller.handleMessage({type,setupId,scope:'current-account'},sender);
  assert.equal((await send(SETUP_BEGIN)).state,'waiting');
  const [first,second]=await Promise.all([send(SETUP_CONNECT),send(SETUP_CONNECT)]);
  assert.equal(first.state,'submitted');assert.deepEqual(first,second);
  assert.deepEqual(first.operation,{...setup,operationId,action:'reconnect',outcome:'requested'});
  assert.equal(f.transport.length,1);assert.equal(f.ids,1);
  assert.equal(Object.hasOwn(first.operation,'ready'),false);
});

test('adapter durable duplicates after restart return the original exact operation without native replay',async t=>{
  const f=fixture(t,{send:async()=>null});
  const first=await f.adapter.connectFromSetup(setup,()=>true);
  assert.equal(first.outcome,'unconfirmed');assert.equal(f.transport.length,1);
  const restarted=f.create();t.after(()=>restarted.dispose());
  assert.deepEqual(await restarted.connectFromSetup(setup,()=>true),first);
  assert.equal(f.transport.length,1);assert.equal(f.ids,1);
  assert.equal(await restarted.connectFromSetup({...setup,bindingSha256:'d'.repeat(64)},()=>true),null);
});

test('uncertain persistence or failed exact readback never reaches wake transport',async t=>{
  for(const fault of ['before','after','lost','corrupt','read']){
    const f=fixture(t),save=f.api.storage.local.set,get=f.api.storage.local.get;let writing=false;
    f.api.storage.local.set=async values=>{
      writing=true;if(fault==='before')throw Error('write failed');
      if(fault!=='lost')await save(values);if(fault==='after')throw Error('acknowledgement lost');
    };
    f.api.storage.local.get=async keys=>{
      const values=await get(keys);if(writing&&fault==='read')throw Error('read failed');
      if(writing&&fault==='corrupt'&&values[f.key])values[f.key].operationId='22345678-1234-4234-8234-123456789abc';return values;
    };
    const first=await f.adapter.connectFromSetup(setup,()=>true);
    assert.equal(first.operationId,operationId);assert.equal(first.outcome,'unconfirmed');
    await f.adapter.connectFromSetup(setup,()=>true);assert.equal(f.transport.length,0);assert.equal(f.ids,1);
  }
});

test('Pause, withdrawn permission and initiating-document cancellation win over late storage admission',async t=>{
  for(const stop of [f=>f.pause(),f=>f.deny(),f=>{f.admit=false;}]){
    const f=fixture(t),pending=Promise.withResolvers(),save=f.api.storage.local.set;f.admit=true;
    f.api.storage.local.set=async values=>{await save(values);await pending.promise;};
    const work=f.adapter.connectFromSetup(setup,()=>f.admit);await tick();stop(f);pending.resolve();
    const result=await work;assert.equal(result.operationId,operationId);assert.equal(result.outcome,'unconfirmed');
    assert.equal(f.transport.length,0);
  }
});

test('incorrect native operation identity, action or schema remains unconfirmed under the same ID',async t=>{
  for(const change of [{id:'wrong'},{action:'disconnect-and-pause'},{extra:true}]){
    const f=fixture(t,{send:async(_,id)=>({ownerId:'owner',response:{version:1,id,action:'reconnect',ok:true,
      state:{paused:false,connection:'ready',operation:{id,action:'reconnect',status:'settled'}},...change}})});
    assert.equal((await f.adapter.connectFromSetup(setup,()=>true)).outcome,'unconfirmed');
    await f.adapter.connectFromSetup(setup,()=>true);assert.equal(f.transport.length,1);assert.equal(f.ids,1);
  }
});
