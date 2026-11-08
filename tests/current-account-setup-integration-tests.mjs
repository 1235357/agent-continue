import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { bindBrowserWake, BROWSER_DEVICE_MESSAGE, BROWSER_DEVICE_PAGE } from '../browser-wake.js';
import { bindCurrentAccountSetup, CURRENT_ACCOUNT_SETUP_PREFIX } from '../current-account-setup.js';
import { bindSetupInstallation } from '../setup-controller.js';
import { createSetupClient } from '../setup-client.js';
import { buildWindowsSetupCommand } from '../setup-entry.js';
import { prepareState } from '../native/desktop-commander/runtime.mjs';
import { openDeviceOperations, publishCurrentAccountSetupReceipt } from '../native/desktop-commander/device-operations.mjs';
import { readFrame, writeFrame } from '../native/desktop-commander/device-owner.mjs';
import { serveBrowserWake } from '../native/desktop-commander/device-native-host.mjs';

const extensionId='b'.repeat(32),setupId='a'.repeat(32),origin=`chrome-extension://${extensionId}/`;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function event(){const listeners=[];return {addListener:fn=>listeners.push(fn),emit:(...args)=>listeners.forEach(fn=>fn(...args))};}

async function fixture(t){
  const base=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'ac-current-integration-')),root=path.join(base,'state');
  prepareState(root,{consent:'full-account'});
  const binding={root,extensionId,origin,assertCurrent(){}};
  publishCurrentAccountSetupReceipt(binding,setupId);
  const local={},session={},wire=[],nativeCalls=[],controllers=[],servers=[],copies=[];
  let locked=Promise.resolve(),worker,globalEpoch=0;
  const locks={request:(_name,fn)=>{const next=locked.then(()=>fn());locked=next.catch(()=>{});return next;}};
  const controller={status:async()=>({paused:true,runtime:'stopped',ready:false}),
    reconnect:async()=>{nativeCalls.push('reconnect');return {paused:false,runtime:'running',ready:true};},
    pause:async()=>{nativeCalls.push('pause');return {paused:true,runtime:'stopped',ready:false};}};
  let operations;
  const api={runtime:{id:extensionId,getURL:value=>origin+value,getPlatformInfo:async()=>({os:'win'}),onStartup:event(),
    connectNative(){
      const input=new PassThrough(),output=new PassThrough(),onMessage=event(),onDisconnect=event();
      const port={onMessage,onDisconnect,postMessage(value){wire.push(value);void writeFrame(input,value);},disconnect(){input.end();}};
      const running=serveBrowserWake({input,output,origin,args:[origin],binding,startOwner:async()=>{
        operations=openDeviceOperations(root,controller);controllers.push(operations);
        return {request:value=>operations.handle(value),close:async()=>operations.close()};
      }});
      void running.catch(()=>{});
      const reading=(async()=>{try{while(!output.destroyed){const value=await readFrame(output);onMessage.emit(value);}}catch{}})();
      servers.push({input,output,running,reading});return port;
    },
    async sendNativeMessage(_host,request){
      if(request.action==='attach-control')return {version:2,action:'attach-control',ownerId:request.ownerId,
        response:await operations.handle(request.request)};
      const input=new PassThrough(),output=new PassThrough();
      const running=serveBrowserWake({input,output,origin,args:[origin],binding,startOwner:()=>assert.fail('proof must not start owner')});
      const reply=readFrame(output);await writeFrame(input,request);const value=await reply;await running;
      input.destroy();output.destroy();return value;
    },
    sendMessage:message=>worker.setupInstallation.handleMessage(message,{id:extensionId,frameId:0,documentId:'setup-doc',
      tab:{id:1},url:origin+'setup.html'})},
    permissions:{contains:async()=>true,onRemoved:event(),onAdded:event()},
    storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(local[key])])),
      set:async values=>Object.assign(local,structuredClone(values))},
      session:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(session[key])])),
        set:async values=>Object.assign(session,structuredClone(values))}},
    tabs:{onRemoved:event(),onUpdated:event()},alarms:{onAlarm:event(),create:async()=>{},clear:async()=>{}}};
  const background=fs.readFileSync(new URL('../background.js',import.meta.url),'utf8').split('const ALARM_NAME')[0]
    .replace(/^import[\s\S]*?from\s+'[^']+';\r?\n/gm,'');
  worker=vm.runInNewContext(background+'\n;({setupInstallation,browserWake,currentAccountSetup:typeof currentAccountSetup===\'undefined\'?null:currentAccountSetup});',{
    chrome:api,bindBrowserWake,bindSetupInstallation,
    bindCurrentAccountSetup:(api,options)=>bindCurrentAccountSetup(api,{...options,locks}),
    bindAdministratorControls:()=>({captureStartupPermit:()=>{const captured=globalEpoch;return ()=>captured===globalEpoch;},
      cancelPendingStartup(){globalEpoch++;},connectFromSetup:()=>assert.fail('current account cannot dispatch administrator')}),
    bindAdministratorBrowser:()=>null,bindInstallationPause:()=>null,
    createTranslator:()=>value=>value,runtimeCatalog:{},
  });
  const context={os:'windows',scope:'current-account',consent:true,connectionConsent:true,epoch:1,extensionId,version:'3.0.0'};
  const client=createSetupClient({api,getContext:()=>({...context}),permissionGranted:()=>true,
    buildCommand:value=>buildWindowsSetupCommand({...value,mode:'local'}),
    clipboard:{writeText:async value=>copies.push(value)},crypto:{getRandomValues:value=>value.fill(0xaa)},page:{addEventListener(){}}});
  t.after(async()=>{
    client.cancel();worker.setupInstallation?.dispose();worker.currentAccountSetup?.dispose();
    for(const server of servers){server.input.end();await server.running;server.output.destroy();await server.reading;}
    fs.rmSync(base,{recursive:true,force:true});
  });
  return {api,worker,client,local,wire,nativeCalls,copies,root};
}

test('actual background wiring carries fresh proof through real client/controller/adapter/wake/native journal once',async t=>{
  const f=await fixture(t);assert.ok(f.worker.currentAccountSetup,'actual background must inject the adapter');
  await f.client.copy({isTrusted:true},'browserPowerShell');
  assert.equal(f.client.getState().state,'requested');assert.deepEqual(f.nativeCalls,['reconnect']);
  const saved=f.local[CURRENT_ACCOUNT_SETUP_PREFIX+setupId];
  const consumed=JSON.parse(fs.readFileSync(path.join(f.root,'browser-setup-consumed.json'),'utf8'));
  assert.equal(consumed.operationId,saved.operationId);assert.equal(saved.outcome,'requested');
  assert.equal(f.wire.filter(value=>value.action==='current-account-setup-connect').length,1);
  assert.match(f.copies[0],new RegExp(`-BrowserSetupId ${setupId}$`));
  await f.client.copy({isTrusted:true},'browserPowerShell');assert.deepEqual(f.nativeCalls,['reconnect']);
});

test('actual background Pause callback defeats delayed setup admission without replacing its reserved ID',async t=>{
  const f=await fixture(t);assert.ok(f.worker.currentAccountSetup);
  const save=f.api.storage.local.set,pending=Promise.withResolvers();let storing=false;
  f.api.storage.local.set=async values=>{await save(values);storing=true;await pending.promise;};
  const work=f.client.copy({isTrusted:true},'browserPowerShell');
  for(let i=0;i<100&&!storing;i++)await tick();assert.equal(storing,true);
  const ownerId=f.wire[0].id;
  await f.worker.browserWake.handleMessage({type:BROWSER_DEVICE_MESSAGE,ownerId,
    request:{version:1,id:'stop-setup',action:'disconnect-and-pause'}},
    {id:extensionId,frameId:0,url:origin+BROWSER_DEVICE_PAGE});
  pending.resolve();await work;
  assert.equal(f.client.getState().state,'cancelled');assert.deepEqual(f.nativeCalls,['pause']);
  assert.equal(f.local[CURRENT_ACCOUNT_SETUP_PREFIX+setupId].outcome,'unconfirmed');
  assert.equal(f.wire.some(value=>value.action==='current-account-setup-connect'),false);
});
