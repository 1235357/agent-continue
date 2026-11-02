import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(process.env.EXTENSION_ROOT || path.dirname(here));
const { setLanguage } = await import(pathToFileURL(path.join(root, 'i18n.js')));
const url='https://chatgpt.com/c/test-conversation';
const copy=value=>value===undefined ? undefined : structuredClone(value);
let importId=0;
const results=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function deferred() {
  let resolve,reject;
  const promise=new Promise((a,b)=>{resolve=a;reject=b;});
  return {promise,resolve,reject};
}
async function until(condition) {
  for(let i=0;i<100;i++) { if(await condition()) return; await delay(2); }
  throw new Error('Mock state did not reach the expected condition');
}
function event() {
  const listeners=[];
  return {listeners,addListener:fn=>listeners.push(fn),emit(...args){for(const fn of listeners) fn(...args);}};
}
async function harness(seed={}) {
  const state={
    session:copy(seed.session||{}),local:copy(seed.local||{}),
    alarms:new Map(seed.alarms||[]),
    tab:{id:7,url,title:'Mock chat',autoDiscardable:true,...seed.tab},
    injections:[],tabUpdates:[],
  };
  const area=name=>({
    async get(key){return {[key]:copy(state[name][key])};},
    async set(value){Object.assign(state[name],copy(value));},
    async remove(key){delete state[name][key];},
  });
  const chrome={
    storage:{session:area('session'),local:area('local')},
    action:{async setBadgeText(){},async setBadgeBackgroundColor(){},async setTitle(){}},
    alarms:{
      async get(name){return state.alarms.get(name);},
      async clear(name){return state.alarms.delete(name);},
      async create(name,value){state.alarms.set(name,{name,...value});},
      onAlarm:event(),
    },
    tabs:{
      async query(){return [copy(state.tab)];},
      async get(id){if(id!==state.tab.id) throw new Error('Tab missing');return copy(state.tab);},
      async update(id,update){
        assert.deepEqual(Object.keys(update),['autoDiscardable'],'Background module must never activate a tab');
        state.tabUpdates.push({id,...update});
        Object.assign(state.tab,update);
        return copy(state.tab);
      },
      onRemoved:event(),onUpdated:event(),
    },
    scripting:{
      async executeScript(request){
        state.injections.push(request);
        const result=await h.pageResult(request.args[0]);
        return [{frameId:0,result}];
      },
    },
    runtime:{onMessage:event()},commands:{onCommand:event()},
  };
  const h={state,chrome,pageResult:async args=>({status:args.mode==='check'?'ready':'sent',message:'mock'}),
    message(message,sender={id:'fixture-extension',url:'chrome-extension://fixture/popup.html'}){
      return new Promise(resolve=>chrome.runtime.onMessage.listeners[0](message,sender,resolve));
    },
    sender(){return {tab:copy(state.tab),frameId:0,url:state.tab.url};},
    async start(config={}){
      const reply=await this.message({type:'START',config:{intervalMinutes:30,prompt:'Continue mock task.',maxSends:0,...config}});
      assert.equal(reply.ok,true,JSON.stringify(reply));return reply.job;
    },
  };
  globalThis.chrome=chrome;
  // Use the actual shared translator; legacy assertions intentionally use Chinese.
  await setLanguage(seed.language || 'zh_CN');
  await import(pathToFileURL(path.join(root,'background.js')).href+`?test=${++importId}`);
  await h.message({type:'GET_STATE'});
  return h;
}
async function scenario(name,body){
  try{await body();results.push({name,status:'PASS'});console.log('PASS '+name);}
  catch(error){results.push({name,status:'FAIL',error:error.stack});console.error('FAIL '+name+': '+error.message);}
}

await scenario('Starting schedules the first send after the interval',async()=>{
  const h=await harness();const now=Date.now();const job=await h.start();
  assert.equal(job.enabled,true);
  assert.ok(job.nextAt>=now+30*60_000);
  assert.equal(h.state.injections.filter(x=>x.args[0].mode==='send').length,0);
  assert.equal(h.state.tab.autoDiscardable,false);
  assert.ok(h.state.alarms.size===1);
  await h.message({type:'PAUSE'});
  assert.equal(h.state.tab.autoDiscardable,true);
  assert.equal(h.state.alarms.size,0);
});

await scenario('Custom and disabled stop markers reach both self-check and send',async()=>{
  for (const stopMarkers of [['[CUSTOM_FINISHED]','[HUMAN_REQUIRED]'],[]]) {
    const h=await harness();
    const job=await h.start({stopMarkers});
    assert.deepEqual(job.stopMarkers,stopMarkers);
    assert.deepEqual(h.state.injections[0].args[0].stopMarkers,stopMarkers,'Start probe must use the supplied markers');
    const check=await h.message({type:'CHECK_PAGE'});
    assert.equal(check.ok,true,JSON.stringify(check));
    assert.equal(h.state.injections.at(-1).args[0].mode,'check');
    assert.deepEqual(h.state.injections.at(-1).args[0].stopMarkers,stopMarkers,'Later self-check must use saved markers');
    const sent=await h.message({type:'SEND_NOW'});
    assert.equal(sent.ok,true,JSON.stringify(sent));
    const injection=h.state.injections.find(request=>request.args[0].mode==='send');
    assert.ok(injection,'A send must be dispatched');
    assert.deepEqual(injection.args[0].stopMarkers,stopMarkers,'An empty marker list must not fall back to defaults');
    await h.message({type:'PAUSE'});
  }
});

await scenario('Disabling discard protection never changes tab properties',async()=>{
  const h=await harness();
  const originalTab=copy(h.state.tab);
  const job=await h.start({preventDiscard:false});
  assert.equal(job.discardProtection,'off');
  assert.equal(job.autoDiscardableChanged,false);
  await h.message({type:'SEND_NOW'});
  await h.message({type:'PAUSE'});
  const resumed=await h.message({type:'RESUME'});
  assert.equal(resumed.ok,true,JSON.stringify(resumed));
  assert.equal(resumed.job.discardProtection,'off');
  await h.message({type:'PAUSE'});
  assert.deepEqual(h.state.tabUpdates,[],'Start, send, pause and resume must not update tab properties');
  assert.deepEqual(h.state.tab,originalTab);
});

await scenario('Pausing preserves a tab that was already protected from discard',async()=>{
  const h=await harness({tab:{autoDiscardable:false}});
  const job=await h.start();
  assert.equal(job.discardProtection,'active');
  assert.equal(job.originalAutoDiscardable,false);
  assert.equal(job.autoDiscardableChanged,false);
  const paused=await h.message({type:'PAUSE'});
  assert.equal(paused.ok,true,JSON.stringify(paused));
  assert.equal(h.state.tab.autoDiscardable,false,'Pause must not undo a protection setting that predated the task');
  assert.deepEqual(h.state.tabUpdates,[]);
});

await scenario('A pause invalidates the token and a late result cannot restart the job',async()=>{
  const h=await harness();await h.start();const gate=deferred();
  h.pageResult=args=>args.mode==='send'?gate.promise:Promise.resolve({status:'ready'});
  const round=h.message({type:'SEND_NOW'});
  await until(()=>h.state.injections.some(x=>x.args[0].mode==='send'));
  const runId=h.state.session.job.runId;
  assert.equal((await h.message({type:'CHECK_RUN',runId},h.sender())).allowed,true);
  await h.message({type:'PAUSE'});
  assert.equal((await h.message({type:'CHECK_RUN',runId},h.sender())).allowed,false);
  gate.resolve({status:'sent',message:'Late mock acknowledgement'});
  await round;
  assert.equal(h.state.session.job.enabled,false);
  assert.equal(h.state.session.job.sentCount,0);
  assert.equal(h.state.alarms.size,0);
});

await scenario('Pause cancels a pending start self-check',async()=>{
  const h=await harness();const gate=deferred();h.pageResult=()=>gate.promise;
  const start=h.message({type:'START',config:{intervalMinutes:30,prompt:'Continue.',maxSends:0}});
  await until(()=>h.state.injections.length===1);
  await h.message({type:'PAUSE'});
  gate.resolve({status:'ready',message:'Ready'});
  assert.equal((await start).ok,false);
  assert.ok(!h.state.session.job?.enabled);
  assert.equal(h.state.alarms.size,0);
});

await scenario('Expired run tokens and different sender tabs are rejected',async()=>{
  const h=await harness();await h.start();const gate=deferred();h.pageResult=()=>gate.promise;
  const round=h.message({type:'SEND_NOW'});
  await until(()=>h.state.injections.some(x=>x.args[0].mode==='send'));
  const runId=h.state.session.job.runId;
  const wrong=h.sender();wrong.tab.id=8;
  assert.equal((await h.message({type:'CHECK_RUN',runId},wrong)).allowed,false);
  h.state.session.job.runDeadline=Date.now()-1;
  assert.equal((await h.message({type:'CHECK_RUN',runId},h.sender())).allowed,false);
  await h.message({type:'PAUSE'});gate.resolve({status:'cancelled'});await round;
});

await scenario('Busy checks retry later and count only confirmed sends',async()=>{
  const h=await harness();await h.start({maxSends:1});
  h.pageResult=async()=>({status:'busy',message:'Agent working'});
  const busy=await h.message({type:'SEND_NOW'});
  assert.equal(busy.job.enabled,true);assert.equal(busy.job.sentCount,0);
  assert.ok(busy.job.nextAt>Date.now()+59_000&&busy.job.nextAt<Date.now()+61_000);
  h.pageResult=async()=>({status:'sent',message:'Confirmed'});
  const sent=await h.message({type:'SEND_NOW'});
  assert.equal(sent.job.sentCount,1);assert.equal(sent.job.enabled,false);
});

await scenario('Unknown submission results skip this cycle and keep future cycles enabled',async()=>{
  const h=await harness();await h.start();h.pageResult=async()=>({status:'unknown',message:'Unconfirmed'});
  const result=await h.message({type:'SEND_NOW'});
  assert.equal(result.job.enabled,true);assert.equal(result.job.sentCount,0);
  assert.equal(h.state.alarms.size,1);
  assert.ok(result.job.nextAt >= Date.now() + 30*60_000 - 1000);
  await h.message({type:'PAUSE'});
});

await scenario('Switching the bound tab waits without sending into another conversation',async()=>{
  const h=await harness();await h.start();h.state.tab.url='https://chatgpt.com/c/another-chat';
  const result=await h.message({type:'SEND_NOW'});
  assert.equal(result.job.enabled,true);
  assert.equal(h.state.injections.filter(x=>x.args[0].mode==='send').length,0);
  await h.message({type:'PAUSE'});
});

await scenario('A worker restarted during submission skips to the next full interval',async()=>{
  const first=await harness();await first.start();
  const snapshot=copy(first.state.session);
  snapshot.job.phase='sending';snapshot.job.runDeadline=Date.now()+12_000;
  const h=await harness({session:snapshot,tab:{autoDiscardable:false}});
  assert.equal(h.state.session.job.enabled,true);
  assert.equal(h.state.session.job.phase,'idle');
  assert.ok(h.state.session.job.nextAt >= Date.now()+30*60_000-1000);
  assert.equal(h.state.tab.autoDiscardable,false);
  assert.equal(h.state.injections.length,0);
});

await scenario('An idle worker restart restores the alarm and preserves the next send time',async()=>{
  const first=await harness();await first.start();
  const snapshot=copy(first.state.session);
  const h=await harness({session:snapshot,tab:{autoDiscardable:false}});
  assert.equal(h.state.session.job.enabled,true);
  assert.equal(h.state.session.job.nextAt,snapshot.job.nextAt);
  assert.equal(h.state.alarms.size,1);
  assert.equal(h.state.injections.length,0);
  await h.message({type:'PAUSE'});
});

await scenario('A frozen target is deferred without activating or injecting into it',async()=>{
  const h=await harness();await h.start();h.state.tab.frozen=true;
  const result=await h.message({type:'SEND_NOW'});
  assert.equal(result.job.enabled,true);
  assert.equal(result.job.sentCount,0);
  assert.equal(h.state.injections.filter(x=>x.args[0].mode==='send').length,0);
  assert.ok(result.job.nextAt>Date.now()+59_000);
  assert.ok(h.state.tabUpdates.every(update=>!('active' in update)));
  await h.message({type:'PAUSE'});
});

await scenario('An empty browser session clears old alarms instead of reusing tab IDs',async()=>{
  const h=await harness({alarms:[['agent-continue-heartbeat',{name:'agent-continue-heartbeat'}]]});
  assert.equal(h.state.alarms.size,0);
  assert.ok(!h.state.session.job);
  assert.equal(h.state.injections.length,0);
});

for (const [name, pageResult, code] of [
  ['adapter uncertainty', async()=>({status:'unknown'}), 'adapter-result'],
  ['missing adapter result', async()=>null, 'no-valid-result'],
  ['execution exception', async()=>{throw new Error('PRIVATE_SENTINEL');}, 'execution-exception'],
]) {
  await scenario(`Diagnostic classifies ${name} without raw exception or prompt`, async()=>{
    const h=await harness();await h.start();h.pageResult=pageResult;
    const result=await h.message({type:'SEND_NOW'});
    assert.equal(result.job.sentCount,0);
    const entry=h.state.local.logs.findLast(item=>item.event==='unconfirmed');
    assert.equal(entry.diagnostic.code,code);
    assert.ok(Number.isFinite(entry.diagnostic.durationMs));
    assert.doesNotMatch(JSON.stringify(h.state.local.logs),/PRIVATE_SENTINEL|Continue mock task\./);
    assert.ok(h.state.injections.every(item=>item.world==='ISOLATED'));
    await h.message({type:'PAUSE'});
  });
}
await scenario('English runtime copy preserves private content and switches languages', async()=>{
  const h = await harness({ language: 'en' });
  const prompt = '用户提示词 PRIVATE_SENTINEL';
  const job = await h.start({ prompt, intervalMinutes: 30, maxSends: 2 });
  assert.equal(job.statusText, 'Running; the first check is in about 30 minutes.');
  assert.equal(job.prompt, prompt);
  assert.equal(h.state.local.logs.at(-1).message, 'Task started with a 30-minute interval, limit of 2 sends.');
  h.pageResult = async()=>({ status: 'busy', message: 'Agent 仍在运行，稍后再次检查。', identity: '中文身份' });
  const checked = await h.message({ type: 'CHECK_PAGE' });
  assert.equal(checked.result.message, 'The Agent is still running. Checking again later.');
  assert.equal(checked.result.identity, '中文身份');
  h.pageResult = async()=>({ status: 'busy', message: '用户自定义消息' });
  assert.equal((await h.message({ type: 'CHECK_PAGE' })).result.message, '用户自定义消息');
  assert.equal((await h.message({ type: 'PAUSE' })).job.statusText, 'Manually paused; future scheduled sends have stopped.');
  await setLanguage('zh_CN');
  assert.equal((await h.message({ type: 'PAUSE' })).job.statusText, '已手动暂停；后续定时发送已停止。');
});
const failed=results.filter(x=>x.status==='FAIL').length;
console.log(`RESULT ${results.length-failed}/${results.length} passed`);
process.exitCode=failed?1:0;
