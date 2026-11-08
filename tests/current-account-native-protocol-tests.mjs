import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { prepareState } from '../native/desktop-commander/runtime.mjs';
import { openDeviceOperations, publishCurrentAccountSetupReceipt } from '../native/desktop-commander/device-operations.mjs';
import { readFrame, writeFrame } from '../native/desktop-commander/device-owner.mjs';
import { serveBrowserWake } from '../native/desktop-commander/device-native-host.mjs';

const extensionId='b'.repeat(32),setupId='a'.repeat(32),origin=`chrome-extension://${extensionId}/`;
const operationId='12345678-1234-4234-8234-123456789abc';
const proofRequest={version:1,id:'proof-test',action:'current-account-setup-status',scope:'current-account',extensionId,setupId};
function fixture(t){
  const base=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'ac-current-transport-')),root=path.join(base,'state');
  prepareState(root,{consent:'full-account'});
  const binding={root,extensionId,origin,assertCurrent(){}};
  const receipt=publishCurrentAccountSetupReceipt(binding,setupId);
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  return {root,binding,receipt,input:new PassThrough(),output:new PassThrough()};
}

test('current-account proof is correlated and read-only, without native owner startup',async t=>{
  const f=fixture(t),before=fs.readdirSync(f.root);
  const running=serveBrowserWake({...f,origin,args:[origin],startOwner:()=>assert.fail('proof cannot start owner')});
  const reply=readFrame(f.output);await writeFrame(f.input,proofRequest);
  assert.deepEqual(await reply,{...proofRequest,state:'installed',bindingSha256:f.receipt.bindingSha256});
  await running;assert.deepEqual(fs.readdirSync(f.root),before);
});

test('foreign origin, extra fields and wrong scope/extension/setup never produce installation proof',async t=>{
  for(const [args,change] of [[['https://chatgpt.com/'],{}],[[origin],{extra:true}],
    [[origin],{scope:'administrator'}],[[origin],{extensionId:'c'.repeat(32)}],[[origin],{setupId:'invalid'}],
    [[origin],{id:'proof-test\n'}],[[origin],{id:''}],[[origin],{id:'a'.repeat(65)}]]){
    const f=fixture(t),running=serveBrowserWake({...f,origin,args,startOwner:()=>assert.fail('invalid proof cannot start owner')});
    const rejected=assert.rejects(running,/invalid_(?:browser_wake|current_account_setup)/);
    await writeFrame(f.input,{...proofRequest,...change});await rejected;
    assert.equal(fs.existsSync(path.join(f.root,'browser-setup-consumed.json')),false);
    f.input.destroy();f.output.destroy();
  }
});

test('actual native wake transport consumes scoped setup through the unchanged standard operation handler',async t=>{
  const f=fixture(t),calls=[];
  const controller={status:async()=>({paused:true,runtime:'stopped',ready:false}),
    reconnect:async()=>{calls.push('reconnect');return {paused:false,runtime:'running',ready:true};},
    pause:async()=>({paused:true,runtime:'stopped',ready:false})};
  const operations=openDeviceOperations(f.root,controller);
  const running=serveBrowserWake({...f,origin,args:[origin],startOwner:async()=>({
    request:value=>operations.handle(value),close:async()=>operations.close()})});
  const ask=async frame=>{const reply=readFrame(f.output);await writeFrame(f.input,frame);return reply;};
  try{
    assert.deepEqual(await ask({version:1,id:'owner-test',action:'wake'}),{version:1,id:'owner-test',action:'wake',ok:true});
    const frame={version:1,id:operationId,action:'current-account-setup-connect',setupId,scope:'current-account',
      extensionId,bindingSha256:f.receipt.bindingSha256};
    const first=await ask(frame);assert.equal(first.action,'reconnect');assert.equal(first.ok,true);
    assert.equal(first.state.operation.id,operationId);assert.equal(first.state.operation.action,'reconnect');
    await ask(frame);assert.deepEqual(calls,['reconnect']);
  }finally{f.input.end();await running;}
});

test('setup frames cannot use a foreign binding or become unscoped ordinary reconnect',async t=>{
  const f=fixture(t),operations=openDeviceOperations(f.root,{status:async()=>({paused:true,runtime:'stopped',ready:false}),
    reconnect:()=>assert.fail('wrong binding cannot reconnect'),pause:async()=>({paused:true,runtime:'stopped',ready:false})});
  const running=serveBrowserWake({...f,origin,args:[origin],startOwner:async()=>({request:v=>operations.handle(v),close:async()=>operations.close()})});
  const ask=async frame=>{const reply=readFrame(f.output);await writeFrame(f.input,frame);return reply;};
  try{
    await ask({version:1,id:'owner-test',action:'wake'});
    const frame={version:1,id:operationId,action:'current-account-setup-connect',setupId,scope:'current-account',extensionId,
      bindingSha256:'c'.repeat(64)};
    assert.equal((await ask(frame)).ok,false);
    assert.equal(fs.existsSync(path.join(f.root,'browser-setup-consumed.json')),false);
  }finally{f.input.end();await running;}
});
