import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(process.env.EXTENSION_ROOT || path.dirname(here));
const { setLanguage } = await import(pathToFileURL(path.join(root, 'i18n.js')));
const url='https://chatgpt.com/c/test-conversation';
const copy=value=>value===undefined ? undefined : structuredClone(value);
const writerSource=readFileSync(path.join(root,'background.js'),'utf8')
  .match(/async function logEvent\([\s\S]*?(?=\r?\nasync function updateBadge\()/)?.[0];
assert.ok(writerSource,'The focused writer harness must execute the production logEvent function');
function writerHarness(logs=[]) {
  const state={logs:copy(logs)};
  const chrome={storage:{local:{
    async get(){return {logs:copy(state.logs)};},
    async set(value){state.logs=copy(value.logs);},
  }}};
  return {state,write:runInNewContext(`${writerSource}\nlogEvent`,{chrome})};
}
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
    sender(){return {tab:copy(state.tab),frameId:0,documentId:'synthetic-bound-document',url:state.tab.url};},
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

await scenario('Retired content-change notices are cleared on upgrade without changing the task or its history', async () => {
  const first = await harness();
  const job = await first.start({ intervalMinutes: 37 });
  for (const [persistedOnly, enabled, message] of [
    [true, true, 'Content changed after filling; the draft was preserved and this cycle will not submit. Checking again in one minute; the task remains enabled.'],
    [false, false, '重新填写后检测到内容变化，已保留草稿，本轮不提交。 一分钟后再检查，任务仍保持启用。'],
    [false, true, 'The composer content changed and was preserved. Checking again in one minute; the task remains enabled.'],
    [true, false, '打断前输入框发生变化，已保留当前内容。'],
    [true, true, 'The composer changed before interruption; its content was preserved.'],
    [false, true, '输入框内容发生变化，已保留当前内容。'],
    [false, true, 'The composer contains a draft or attachments; skipping this cycle.'],
    [false, true, '输入框已有草稿或附件，本次跳过。'],
    [true, true, 'A new draft or attachments were detected; skipping this cycle.'],
    [true, true, '检测到新草稿或附件，本次跳过。'],
    [false, false, 'Another draft or attachments were detected after interruption and preserved.'],
    [false, false, '打断后检测到其他草稿或附件，已保留。'],
  ]) {
    const legacy = { ...job, enabled, nextAt: enabled ? job.nextAt : null, statusText: message };
    const logs = [{ at: 1, event: 'draft', message, diagnostic: { code: 'composer-changed' } }];
    const h = await harness({ session: persistedOnly ? {} : { job: legacy }, local: { resumeJob: legacy, logs } });
    const current = (await h.message({ type: 'GET_STATE' })).job;
    assert.notEqual(current.statusText, message);
    assert.equal(current.enabled, enabled);
    assert.equal(current.nextAt, legacy.nextAt);
    assert.equal(current.prompt, job.prompt);
    assert.equal(current.url, job.url);
    assert.equal(current.intervalMinutes, job.intervalMinutes);
    assert.deepEqual(h.state.local.logs[0], logs[0]);
    assert.equal(h.state.injections.length, 0);
  }
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

await scenario('Log writer replaces non-array persisted logs with a valid record',async()=>{
  for(const logs of [undefined,null,false,0,true,42,'corrupt logs',{stale:true}]) {
    const h=writerHarness(logs);
    await h.write('started','Synthetic task started.');
    assert.equal(h.state.logs.length,1);
    assert.equal(h.state.logs[0].event,'started');
    assert.equal(h.state.logs[0].message,'Synthetic task started.');
    assert.ok(Number.isFinite(h.state.logs[0].at));
  }
});
await scenario('Log writer filters malformed rows before keeping the newest 199 valid records',async()=>{
  const at=1700000000000;
  const valid=Array.from({length:205},(_,index)=>({at:at+index,event:'busy',message:`Synthetic row ${index}`}));
  const malformed=[null,undefined,true,42,'bad row',[],{},
    {at:NaN,event:'busy',message:'Invalid time'},
    {at:Infinity,event:'busy',message:'Invalid time'},
    {at:String(at),event:'busy',message:'Invalid time'},
    {at,event:42,message:'Invalid event'},
    {at,event:{nested:'SYNTHETIC_PRIVATE_SENTINEL'},message:'Invalid event'},
    {at,event:'',message:'Invalid event'},
    {at,event:'busy',message:null},
    {at,event:'busy',message:42},
    {at,event:'busy',message:{nested:'SYNTHETIC_PRIVATE_SENTINEL'}}];
  const h=writerHarness([...valid,...malformed]);
  await h.write('sent','Synthetic send confirmed.');
  assert.equal(h.state.logs.length,200);
  assert.deepEqual(h.state.logs.slice(0,-1),valid.slice(-199));
  assert.equal(h.state.logs.at(-1).event,'sent');
  assert.equal(h.state.logs.at(-1).message,'Synthetic send confirmed.');
  assert.doesNotMatch(JSON.stringify(h.state.logs),/SYNTHETIC_PRIVATE_SENTINEL/);
});
for(const [name,durationMs] of [
  ['boolean',true],['numeric string','25'],['object',{}],['array',[]],
  ['Infinity',Infinity],['negative Infinity',-Infinity],['NaN',NaN],
  ['null',null],['missing',undefined],
]) {
  await scenario(`Log writer omits ${name} duration while preserving each known diagnostic code`,async()=>{
    for(const code of ['adapter-result','execution-exception','execution-timeout','no-valid-result']) {
      const h=writerHarness();
      await h.write('unconfirmed','Synthetic uncertainty.',{code,durationMs});
      assert.deepEqual(h.state.logs[0].diagnostic,{code});
      assert.equal(Object.hasOwn(h.state.logs[0].diagnostic,'durationMs'),false);
    }
  });
}
await scenario('Log writer preserves finite numeric durations and existing clamp boundaries',async()=>{
  for(const code of ['adapter-result','execution-exception','execution-timeout','no-valid-result']) {
    for(const [durationMs,expected] of [[0,0],[12.5,12.5],[-4,0],[120000,120000],[250000,120000]]) {
      const h=writerHarness();
      await h.write('unconfirmed','Synthetic uncertainty.',{code,durationMs,stack:'SYNTHETIC_PRIVATE_SENTINEL'});
      assert.deepEqual(h.state.logs[0].diagnostic,{code,durationMs:expected});
    }
  }
});
await scenario('Log writer ignores diagnostics without a known code',async()=>{
  for(const diagnostic of [true,'bad diagnostic',{},Infinity,null,[],
    {code:'unknown-code',durationMs:10},{code:['adapter-result'],durationMs:10}]) {
    const h=writerHarness();
    await h.write('busy','Synthetic status.',diagnostic);
    assert.equal(Object.hasOwn(h.state.logs[0],'diagnostic'),false);
  }
});
await scenario('Timing log writer keeps fixed fields only and does not coerce numbers or booleans',async()=>{
  const h=writerHarness();
  await h.write('timing-diagnostics','Synthetic timing.',{code:'timing-probe',kind:'page-timers',status:'result',
    durationMs:1992,firstMs:991,hidden:true,ok:false,allowed:false,url:'SYNTHETIC_PRIVATE_SENTINEL'});
  assert.deepEqual(h.state.logs[0].diagnostic,{code:'timing-probe',durationMs:1992,kind:'page-timers',
    status:'result',firstMs:991,hidden:true,ok:false,allowed:false});
  await h.write('timing-diagnostics','Synthetic timing.',{code:'timing-probe',kind:'SYNTHETIC_PRIVATE_SENTINEL',
    status:[],durationMs:'5',firstMs:true,hidden:'true',ok:1,allowed:{}});
  assert.deepEqual(h.state.logs[1].diagnostic,{code:'timing-probe'});
  assert.doesNotMatch(JSON.stringify(h.state.logs),/SYNTHETIC_PRIVATE_SENTINEL/);
});
await scenario('Log writer preserves all legitimate current event codes and messages',async()=>{
  const events=['started','resumed','paused','replaced','scheduler-error','sent','reply-complete',
    'busy','draft','blocked','error','marker-reached','limit-reached','queue-complete',
    'unconfirmed','browser-restored','interrupted'];
  const h=writerHarness();
  for(const event of events) await h.write(event,`Synthetic ${event}.`);
  assert.deepEqual(h.state.logs.map(row=>row.event),events);
  assert.deepEqual(h.state.logs.map(row=>row.message),events.map(event=>`Synthetic ${event}.`));
});
await scenario('START repairs malformed logs without changing the interval or sending immediately',async()=>{
  const valid={at:1700000000000,event:'browser-restored',message:'Synthetic recovery.'};
  for(const logs of [{stale:true},[null,valid,{},'bad row']]) {
    const h=await harness({local:{logs}});
    const now=Date.now();
    const job=await h.start({startImmediately:false});
    assert.equal(job.enabled,true);
    assert.ok(job.nextAt>=now+30*60_000);
    assert.equal(h.state.injections.filter(item=>item.args[0].mode==='send').length,0);
    assert.equal(h.state.local.logs.length,Array.isArray(logs)?2:1);
    if(Array.isArray(logs)) assert.deepEqual(h.state.local.logs[0],valid);
    assert.equal(h.state.local.logs.at(-1).event,'started');
    await h.message({type:'PAUSE'});
  }
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
await scenario('Mandatory priority reaches the adapter even for a legacy false flag and logs only bounded diagnostics', async()=>{
  const h=await harness();
  await h.start({extensionPriority:false});
  h.pageResult=async()=>({status:'draft',diagnosticCode:'existing-draft',message:'Synthetic attachment.'});
  await h.message({type:'SEND_NOW'});
  assert.equal(h.state.injections.findLast(item=>item.args[0].mode==='send').args[0].extensionPriority,true);
  assert.equal(h.state.local.logs.findLast(item=>item.event==='draft').diagnostic.code,'existing-draft');
  h.pageResult=async()=>({status:'draft',diagnosticCode:'PRIVATE_SENTINEL',message:'Synthetic protection.'});
  await h.message({type:'SEND_NOW'});
  assert.equal(h.state.local.logs.findLast(item=>item.event==='draft').diagnostic,undefined);
  assert.doesNotMatch(JSON.stringify(h.state.local.logs),/PRIVATE_SENTINEL/);
  await h.message({type:'PAUSE'});
});
await scenario('An obsolete adapter result cannot restore the retired veto or replay a send', async () => {
  for (const oldResult of [
    { status: 'draft', diagnosticCode: 'composer-changed', message: 'Synthetic legacy notice.' },
    { status: 'blocked', message: 'The composer content changed and was preserved.' },
  ]) {
    const h = await harness();
    await h.start();
    h.pageResult = async () => oldResult;
    const { job } = await h.message({ type: 'SEND_NOW' });
    assert.equal(job.sentCount, 0);
    assert.equal(job.unknownCount, 1);
    assert.equal(job.lastDiagnosticCode, 'no-valid-result');
    assert.ok(job.nextAt >= Date.now() + 30 * 60_000 - 1000);
    assert.ok(!job.statusText.includes(oldResult.message));
    assert.equal(h.state.injections.filter(x => x.args[0].mode === 'send').length, 1);
  }
});
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
await scenario('Model commit uses stored prompt, exact frame, and a durable one-attempt marker', async () => {
  const h = await harness();
  const job = await h.start();
  h.state.session.job = { ...job, phase: 'sending', runKind: 'send', runDeadline: Date.now() + 10000 };
  h.pageResult = async args => ({ supported: true, dispatched: args.phase === 'commit',
    code: args.phase === 'prepare' ? 'prepared' : args.phase === 'observe' ? 'ready' : 'dispatched' });
  const request = { type: 'COMMIT_RUN', runId: job.runId, prompt: 'UNTRUSTED_IGNORED' };
  const before = h.state.injections.length;
  assert.equal((await h.message(request, { ...h.sender(), frameId: 1 })).ok, false);
  assert.equal(h.state.injections.length, before);
  assert.equal((await h.message(request, h.sender())).dispatched, true);
  const injection = h.state.injections.at(-1);
  assert.equal(injection.world, 'MAIN');
  assert.deepEqual(injection.target.documentIds, ['synthetic-bound-document']);
  assert.equal(injection.args[0].prompt, job.prompt);
  assert.equal(injection.args[0].runId, undefined);
  assert.equal(h.state.session.job.editorCommitRunId, job.runId);
  assert.equal((await h.message(request, h.sender())).code, 'unknown');
  assert.equal(h.state.injections.length, before + 3);
  assert.deepEqual(h.state.injections.slice(before).map(item => item.args[0].phase), ['prepare', 'observe', 'commit']);
  await h.message({ type: 'PAUSE' });
  assert.equal((await h.message(request, h.sender())).ok, false);
  assert.equal(h.state.injections.length, before + 3);
});
await scenario('Delayed Send is observed in the worker before exactly one submission, without activating the tab', async () => {
  const h = await harness();
  const job = await h.start();
  h.state.session.job = { ...job, phase: 'sending', runKind: 'send', runDeadline: Date.now() + 10000 };
  let observations = 0;
  h.pageResult = async args => {
    assert.equal(h.state.session.job.editorCommitRunId, job.runId, 'Reserve before preparation');
    return { supported: true, dispatched: args.phase === 'commit', code: args.phase === 'prepare'
      ? 'prepared' : args.phase === 'observe' ? ++observations === 1 ? 'waiting-send' : 'ready' : 'dispatched' };
  };
  const before = h.state.injections.length;
  assert.equal((await h.message({ type: 'COMMIT_RUN', runId: job.runId }, h.sender())).dispatched, true);
  assert.deepEqual(h.state.injections.slice(before).map(item => item.args[0].phase), ['prepare', 'observe', 'observe', 'commit']);
  assert.ok(h.state.tabUpdates.every(update => !('active' in update)));
});
await scenario('Observed Send presence persists across framework unmounts within one reservation', async () => {
  const h = await harness();
  const job = await h.start();
  h.state.session.job = { ...job, phase: 'sending', runKind: 'send', runDeadline: Date.now() + 10000 };
  h.pageResult = async args => {
    if (args.phase === 'prepare') return { supported: true, dispatched: false, code: 'prepared', hasSend: true };
    assert.equal(args.requireButton, true);
    return { supported: true, dispatched: args.phase === 'commit', code: args.phase === 'observe' ? 'ready' : 'dispatched' };
  };
  assert.equal((await h.message({ type: 'COMMIT_RUN', runId: job.runId }, h.sender())).dispatched, true);
});
await scenario('Auto waits one render turn for an initially absent Send instead of prematurely choosing keyboard', async () => {
  const h = await harness();
  const job = await h.start({ sendMethod: 'auto' });
  h.state.session.job = { ...job, phase: 'sending', runKind: 'send', runDeadline: Date.now() + 10000 };
  let observations = 0;
  h.pageResult = async args => {
    if (args.phase === 'prepare') return { supported: true, dispatched: false, code: 'prepared', hasSend: false };
    if (args.phase === 'observe') return { supported: true, dispatched: false, code: 'ready', hasSend: ++observations > 1 };
    assert.equal(observations, 2);
    assert.equal(args.requireButton, true);
    return { supported: true, dispatched: true, code: 'dispatched' };
  };
  assert.equal((await h.message({ type: 'COMMIT_RUN', runId: job.runId }, h.sender())).dispatched, true);
});
await scenario('A disabled Send first appearing at final correction stays required through its later unmount', async () => {
  const h = await harness();
  const job = await h.start({ sendMethod: 'auto' });
  h.state.session.job = { ...job, phase: 'sending', runKind: 'send', runDeadline: Date.now() + 10000 };
  let observations = 0, commits = 0;
  h.pageResult = async args => {
    if (args.phase === 'prepare') return { supported: true, dispatched: false, code: 'prepared', hasSend: false };
    if (args.phase === 'observe') {
      observations++;
      if (commits === 1 && observations === 3) {
        assert.equal(args.requireButton, true, 'A waiting commit is evidence a scoped button must remain required');
        return { supported: true, dispatched: false, code: 'waiting-send', hasSend: false };
      }
      if (observations >= 4) return { supported: true, dispatched: false, code: 'ready', hasSend: true };
      return { supported: true, dispatched: false, code: 'ready', hasSend: false };
    }
    if (++commits === 1) return { supported: true, dispatched: false, code: 'waiting-send' };
    return { supported: true, dispatched: true, code: 'dispatched' };
  };
  assert.equal((await h.message({ type: 'COMMIT_RUN', runId: job.runId }, h.sender())).dispatched, true);
  assert.equal(commits, 2, 'Only the known no-dispatch correction is repeated');
});
await scenario('A replaced document cannot receive a later phase through tabId fallback', async () => {
  const h = await harness();
  const job = await h.start();
  h.state.session.job = { ...job, phase: 'sending', runKind: 'send', runDeadline: Date.now() + 10000 };
  const before = h.state.injections.length;
  h.chrome.scripting.executeScript = async request => {
    h.state.injections.push(request);
    assert.deepEqual(request.target.documentIds, ['synthetic-bound-document']);
    if (request.args[0].phase !== 'prepare') throw new Error('Bound document no longer exists');
    return [{ frameId: 0, result: { supported: true, dispatched: false, code: 'prepared' } }];
  };
  assert.equal((await h.message({ type: 'COMMIT_RUN', runId: job.runId }, h.sender())).code, 'unknown');
  assert.deepEqual(h.state.injections.slice(before).map(item => item.args[0].phase), ['prepare', 'observe']);
});
for (const stage of ['prepare', 'observe']) {
  await scenario(`Pause during ${stage} prevents the final submission`, async () => {
    const h = await harness();
    const job = await h.start();
    h.state.session.job = { ...job, phase: 'sending', runKind: 'send', runDeadline: Date.now() + 10000 };
    h.pageResult = async args => {
      if (args.phase === stage) await h.message({ type: 'PAUSE' });
      return { supported: true, dispatched: false, code: args.phase === 'prepare' ? 'prepared' : 'ready' };
    };
    const before = h.state.injections.length;
    assert.equal((await h.message({ type: 'COMMIT_RUN', runId: job.runId }, h.sender())).code, 'cancelled');
    assert.ok(!h.state.injections.slice(before).some(item => item.args[0].phase === 'commit'));
    assert.equal(h.state.session.job.enabled, false);
  });
}
await scenario('A final correction waits only after explicit no-dispatch; unknown never replays commit', async () => {
  for (const finalCode of ['waiting-send', 'unknown']) {
    const h = await harness();
    const job = await h.start();
    h.state.session.job = { ...job, phase: 'sending', runKind: 'send', runDeadline: Date.now() + 10000 };
    let commits = 0;
    h.pageResult = async args => {
      if (args.phase === 'commit') {
        if (++commits === 1) return finalCode === 'unknown' ? undefined
          : { supported: true, dispatched: false, code: 'waiting-send' };
        return { supported: true, dispatched: true, code: 'dispatched' };
      }
      return { supported: true, dispatched: false, code: args.phase === 'prepare' ? 'prepared' : 'ready' };
    };
    const result = await h.message({ type: 'COMMIT_RUN', runId: job.runId }, h.sender());
    assert.equal(commits, finalCode === 'unknown' ? 1 : 2);
    assert.equal(result.code, finalCode === 'unknown' ? 'unknown' : undefined);
    assert.equal(result.dispatched, finalCode === 'unknown' ? undefined : true);
  }
});
await scenario('Ambiguous controls are a proven no-dispatch result, not a replay or uncertain send', async () => {
  const h = await harness();
  const job = await h.start();
  h.state.session.job = { ...job, phase: 'sending', runKind: 'send', runDeadline: Date.now() + 10000 };
  h.pageResult = async args => ({ supported: true, dispatched: false,
    code: args.phase === 'prepare' ? 'prepared' : 'send-ambiguous' });
  assert.deepEqual(await h.message({ type: 'COMMIT_RUN', runId: job.runId }, h.sender()),
    { ok: false, dispatched: false, code: 'not-dispatched', reason: 'send-ambiguous' });
});
await scenario('An uncertain model injection never permits a second send method', async () => {
  const h = await harness();
  const job = await h.start();
  h.state.session.job = { ...job, phase: 'sending', runKind: 'send', runDeadline: Date.now() + 10000 };
  h.pageResult = async () => { throw new Error('UNLOGGED_PAGE_DATA'); };
  const before = h.state.injections.length;
  assert.equal((await h.message({ type: 'COMMIT_RUN', runId: job.runId }, h.sender())).code, 'unknown');
  assert.equal((await h.message({ type: 'COMMIT_RUN', runId: job.runId }, h.sender())).code, 'unknown');
  assert.equal(h.state.injections.length, before + 1);
  assert.doesNotMatch(JSON.stringify(h.state.local.logs), /UNLOGGED_PAGE_DATA/);
});
await scenario('Pause arriving while the model-attempt marker is saved cancels injection', async () => {
  const h = await harness();
  const job = await h.start();
  h.state.session.job = { ...job, phase: 'sending', runKind: 'send', runDeadline: Date.now() + 10000 };
  const before = h.state.injections.length;
  const save = h.chrome.storage.session.set;
  let paused;
  h.chrome.storage.session.set = async value => {
    await save(value);
    if (value.job?.editorCommitRunId && !paused) paused = h.message({ type: 'PAUSE' });
  };
  assert.equal((await h.message({ type: 'COMMIT_RUN', runId: job.runId }, h.sender())).code, 'cancelled');
  await paused;
  assert.equal(h.state.injections.length, before);
  assert.equal(h.state.session.job.enabled, false);
});
await scenario('Model commit rejects expired, foreign-target, foreign-run and reply-only requests', async () => {
  const h = await harness();
  const job = await h.start();
  const running = { ...job, phase: 'sending', runKind: 'send', runDeadline: Date.now() + 10000 };
  const before = h.state.injections.length;
  for (const state of [
    { job: { ...running, runDeadline: Date.now() - 1 }, sender: h.sender(), runId: job.runId },
    { job: running, sender: { ...h.sender(), url: 'https://chatgpt.com/c/different' }, runId: job.runId },
    { job: running, sender: h.sender(), runId: 'other-run' },
    { job: { ...running, runKind: 'reply-check' }, sender: h.sender(), runId: job.runId },
  ]) {
    h.state.session.job = copy(state.job);
    assert.equal((await h.message({ type: 'COMMIT_RUN', runId: state.runId }, state.sender)).ok, false);
  }
  assert.equal(h.state.injections.length, before);
});
const failed=results.filter(x=>x.status==='FAIL').length;
console.log(`RESULT ${results.length-failed}/${results.length} passed`);
process.exitCode=failed?1:0;
