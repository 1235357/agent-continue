import test from 'node:test';
import assert from 'node:assert/strict';
import { bindAdministratorControls } from '../admin-control.js';
import { bindInstallationPause } from '../admin-installation-pause.js';
import { bindAdministratorBrowser, ADMIN_BROWSER_PAUSE, ADMIN_BROWSER_PAUSE_STATUS } from '../admin-browser.js';
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
