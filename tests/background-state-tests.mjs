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
const backgroundSource=readFileSync(path.join(root,'background.js'),'utf8');
const readSource=backgroundSource.match(/const invalidation = \(\) => \{[\s\S]*?(?=\r?\nfunction diagnosticFailure\()/)?.[0];
const writerSource=backgroundSource.match(/async function logEvent\([\s\S]*?(?=\r?\nasync function updateBadge\()/)?.[0];
assert.ok(readSource,'The focused writer harness must execute the production log read dependencies');
assert.ok(writerSource,'The focused writer harness must execute the production logEvent function');
function writerHarness(logs=[]) {
  const state={logs:copy(logs)};
  const chrome={storage:{local:{
    async get(){return {logs:copy(state.logs)};},
    async set(value){state.logs=copy(value.logs);},
  }}};
  return {state,write:runInNewContext(`${readSource}\n${writerSource}\nlogEvent`,{
    chrome,activityEpoch:0,activityDiscardPrevious:false,activityStorageWrite:Promise.resolve(),
  })};
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
    async get(key){return Object.fromEntries((Array.isArray(key)?key:[key]).map(item=>[item,copy(state[name][item])]));},
    async set(value){Object.assign(state[name],copy(value));},
    async remove(key){for(const item of Array.isArray(key)?key:[key])delete state[name][item];},
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
      async sendMessage(id,message){return {revoked:true,runId:message.runId,resultToken:message.resultToken};},
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
    runtime:{id:'fixture-extension',getURL:name=>'chrome-extension://fixture/'+name,onMessage:event()},commands:{onCommand:event()},
  };
  const h={state,chrome,pageResult:async args=>({status:args.mode==='check'?'ready':'sent',message:'mock'}),
    message(message,sender={id:'fixture-extension',url:'chrome-extension://fixture/popup.html'}){
      if(message.type==='COMMIT_RUN' && !Object.hasOwn(message,'receiptBoundaryToken'))
        message={receiptBoundaryToken:'00000000-0000-0000-0000-000000000001',...message};
      return new Promise(resolve=>chrome.runtime.onMessage.listeners[0](message,sender,resolve));
    },
    sender(){return {id:'fixture-extension',tab:copy(state.tab),frameId:0,documentId:'synthetic-bound-document',url:state.tab.url};},
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

await scenario('A finite command permit without an active invocation cannot be revived by an observer',async()=>{
  const h=await harness();const job=await h.start();
  const lease=Date.now()+8000;
  h.state.session.job={...job,phase:'sending',runKind:'send',runDeadline:lease};
  const runId=job.runId;
  assert.equal((await h.message({type:'WAIT_RUN',runId,delayMs:50,renew:false},h.sender())).runDeadline,lease);
  assert.equal(h.state.session.job.runDeadline,lease);
  assert.equal((await h.message({type:'CHECK_RUN',runId}, {...h.sender(),frameId:1})).allowed,false);
  assert.equal(h.state.session.job.runDeadline,lease);
  const renewed=await h.message({type:'CHECK_RUN',runId},h.sender());
  assert.equal(renewed.allowed,true);
  assert.ok(renewed.runDeadline>=Date.now()+19000);
  h.state.session.job.runDeadline=Date.now()-1;
  assert.equal((await h.message({type:'CHECK_RUN',runId},h.sender())).allowed,false);
  await h.message({type:'PAUSE'});
});

await scenario('A redundant page receipt survives a missing injection result and rejects wrong origins, runs and tokens',async()=>{
  const h=await harness();await h.start();const gate=deferred();
  h.pageResult=()=>gate.promise;
  const round=h.message({type:'SEND_NOW'});
  await until(()=>h.state.injections.some(item=>item.args[0].mode==='send'));
  const args=h.state.injections.find(item=>item.args[0].mode==='send').args[0];
  const receipt={type:'PAGE_RESULT',runId:args.runId,resultToken:args.resultToken,result:{status:'sent',message:'Fixture receipt'}};
  assert.match(args.resultToken,/^[a-f0-9-]{36}$/);
  assert.equal((await h.message({type:'CHECK_RUN',runId:args.runId},h.sender())).allowed,true);
  for(const sender of [{...h.sender(),id:'other-extension'},{...h.sender(),frameId:1},
    {...h.sender(),url:'https://chatgpt.com/c/other'},{...h.sender(),tab:{...h.state.tab,id:99}},
    {...h.sender(),documentId:'another-document'}]) {
    assert.equal((await h.message(receipt,sender)).ok,false);
  }
  assert.equal((await h.message({...receipt,resultToken:'wrong'},h.sender())).ok,false);
  assert.equal((await h.message({...receipt,runId:'wrong'},h.sender())).ok,false);
  assert.equal((await h.message({...receipt,result:{status:'invented'}},h.sender())).ok,false);
  assert.equal((await h.message({type:'CHECK_RUN',runId:args.runId},{...h.sender(),documentId:'another-document'})).allowed,false);
  gate.resolve(null);
  await delay(10);
  assert.equal(h.state.session.job.phase,'sending','Missing return waits for the same invocation, not another send');
  assert.equal((await h.message(receipt,h.sender())).ok,true);
  assert.equal((await round).job.sentCount,1);
  assert.equal((await h.message(receipt,h.sender())).ok,false,'A settled receipt cannot increment again');
  assert.equal(h.state.injections.filter(item=>item.args[0].mode==='send').length,1);
  assert.equal(h.state.session.job.sentCount,1);
  await h.message({type:'PAUSE'});
});

await scenario('Pause rejects a pending redundant result without waiting for an unresolved injection',async()=>{
  const h=await harness();await h.start();const gate=deferred();h.pageResult=()=>gate.promise;
  const round=h.message({type:'SEND_NOW'});
  await until(()=>h.state.injections.some(item=>item.args[0].mode==='send'));
  const args=h.state.injections.find(item=>item.args[0].mode==='send').args[0];
  await h.message({type:'PAUSE'});
  assert.equal((await round).job.enabled,false);
  assert.equal((await h.message({type:'PAGE_RESULT',runId:args.runId,resultToken:args.resultToken,result:{status:'sent'}},h.sender())).ok,false);
  gate.resolve({status:'sent'});
  assert.equal(h.state.session.job.sentCount,0);
});

await scenario('A replacement document with unproven submission pauses until explicit Resume and preserves target isolation',async()=>{
  const h=await harness();await h.start();const gate=deferred();
  let replacement=false;
  h.chrome.scripting.executeScript=async request=>{
    h.state.injections.push(request);
    if(request.func.name==='pageInvocationState') {
      if(request.target.documentIds && replacement) throw new Error('Old document no longer exists');
      return [{frameId:0,documentId:replacement?'replacement-document':'synthetic-bound-document',result:{state:'absent'}}];
    }
    return [{frameId:0,documentId:replacement?'replacement-document':'synthetic-bound-document',
      result:request.args[0].mode==='send'?(replacement?{status:'sent'}:await gate.promise):{status:'ready'}}];
  };
  const round=h.message({type:'SEND_NOW'});
  try {
    await until(()=>h.state.injections.some(item=>item.args[0].mode==='send'));
    const args=h.state.injections.find(item=>item.args[0].mode==='send').args[0];
    assert.equal((await h.message({type:'CHECK_RUN',runId:args.runId},h.sender())).allowed,true);
    replacement=true;
    let completed=false;
    round.then(()=>{completed=true;});
    for(let i=0;i<250 && !completed;i++) await delay(20);
    assert.equal(completed,true,'A read-only top-frame probe must detect replacement instead of renewing an unreachable document forever');
    const result=await round;
    assert.equal(result.job.enabled,false);
    assert.equal(result.job.phase,'idle');
    assert.equal(result.job.sentCount,0);
    assert.equal(result.job.unknownCount,1,'Document replacement cannot prove the old page did not submit');
    assert.equal(result.job.nextAt,null);
    assert.equal(h.state.alarms.size,0);
    assert.equal(h.state.local.resumeJob.enabled,false);
    h.chrome.alarms.onAlarm.emit({name:'agent-continue-heartbeat'});
    await delay(20);
    assert.equal(h.state.injections.filter(item=>item.args[0].mode==='send').length,1,'No automatic replacement send is authorized');
    for(const request of h.state.injections.filter(item=>item.func.name==='pageInvocationState'))
      assert.equal(request.target.documentIds,undefined,'Replacement diagnosis must not address the destroyed document');
    assert.equal((await h.message({type:'CHECK_RUN',runId:args.runId},h.sender())).allowed,false);
    gate.resolve({status:'sent'});
    await delay(5);
    assert.equal(h.state.session.job.sentCount,0,'A stale late return cannot count as a current send');
    h.chrome.scripting.executeScript=async request=>{
      h.state.injections.push(request);
      return [{frameId:0,documentId:'replacement-document',result:{status:request.args[0].mode==='check'?'ready':'sent'}}];
    };
    const resumed=await h.message({type:'RESUME'});
    assert.equal(resumed.ok,true,JSON.stringify(resumed));
    assert.equal(resumed.job.enabled,true);
    h.state.tab.url='https://chatgpt.com/c/another-chat';
    const foreign=await h.message({type:'SEND_NOW'});
    assert.equal(foreign.job.sentCount,0);
    assert.equal(h.state.injections.filter(item=>item.args[0].mode==='send').length,1,'Resume must not send into another conversation');
    h.state.tab.url=url;
    assert.equal((await h.message({type:'SEND_NOW'})).job.sentCount,1);
    const sends=h.state.injections.filter(item=>item.args[0].mode==='send');
    assert.equal(sends.length,2);
    assert.notEqual(sends[0].args[0].runId,sends[1].args[0].runId,'Explicit Resume receives fresh authorization');
    assert.equal(sends[1].target.tabId,h.state.tab.id);
    assert.equal(sends[1].args[0].expectedUrl,url);
    assert.equal((await h.message({type:'CHECK_RUN',runId:args.runId},{...h.sender(),documentId:'replacement-document'})).allowed,false);
  } finally {
    await h.message({type:'PAUSE'});
    gate.resolve({status:'sent'});
    await round;
  }
});

await scenario('Observed manual submission with a lost notification before document replacement must pause without another admission',async()=>{
  const h=await harness();await h.start();const gate=deferred();let replacement=false;
  h.chrome.scripting.executeScript=async request=>{
    h.state.injections.push(request);
    if(request.func.name==='pageInvocationState') return [{frameId:0,documentId:replacement?'replacement-document':'synthetic-bound-document',
      result:replacement?{state:'absent'}:{state:'running',diagnosticProgress:{stage:'receipt',reason:'manual-submission',
        counters:{dispatchAttempts:0,manualIntents:1},observations:{manualPending:true}}}}];
    return [{frameId:0,documentId:replacement?'replacement-document':'synthetic-bound-document',
      result:request.args[0].mode==='send'?(replacement?{status:'sent'}:await gate.promise):{status:'ready'}}];
  };
  const round=h.message({type:'SEND_NOW'});
  try {
    await until(()=>h.state.injections.some(item=>item.args[0].mode==='send'));
    const args=h.state.injections.find(item=>item.args[0].mode==='send').args[0];
    assert.equal((await h.message({type:'CHECK_RUN',runId:args.runId},h.sender())).allowed,true);
    for(let i=0;i<300 && !h.state.local.deliveryDiagnostics?.some(item=>item.counters?.manualIntents===1 && item.observations?.manualPending===true);i++) await delay(20);
    assert.ok(h.state.local.deliveryDiagnostics?.some(item=>item.counters?.manualIntents===1 && item.observations?.manualPending===true),
      'The background must observe the manual progress before the document is replaced');
    assert.equal(h.state.injections.filter(item=>item.args[0].mode==='send').length,1);
    replacement=true;
    let completed=false;round.then(()=>{completed=true;});
    for(let i=0;i<300 && !completed;i++) await delay(20);
    assert.equal(completed,true,'The replacement must resolve the original invocation');
    const result=await round;
    assert.deepEqual({admissions:h.state.injections.filter(item=>item.args[0].mode==='send').length,
      enabled:result.job.enabled,sentCount:result.job.sentCount,unknownCount:result.job.unknownCount,
      nextAt:result.job.nextAt,alarms:h.state.alarms.size,persistedEnabled:h.state.local.resumeJob.enabled},
    {admissions:1,enabled:false,sentCount:0,unknownCount:1,nextAt:null,alarms:0,persistedEnabled:false},
    'Observed manual intent cannot be treated as proof that the previous invocation was unsent');
  } finally {
    await h.message({type:'PAUSE'});
    gate.resolve({status:'unknown'});
    await round;
  }
});

for(const [timing,evidence] of [
  ['none','none'], ...['sleep','write'].flatMap(timing=>['receipt','manual','pause'].map(evidence=>[timing,evidence])),
  ['prepare','receipt'], ['prepare','manual'], ['commit','receipt'],
]) {
await scenario(timing==='none'
  ? 'A replaced document during held MAIN preparation retires the old permit before retrying the same delivery'
  : `Replacement recovery honors old ${evidence} during successor ${timing} without replay`,async()=>{
  const h=await harness();await h.start({maxSends:1});
  const oldPage=deferred(),prepare=deferred(),nextPhase=deferred();let replacement=false;
  let injectEvidence;
  const sender=()=>({...h.sender(),documentId:replacement?'replacement-document':'synthetic-bound-document'});
  h.chrome.tabs.sendMessage=async(id,message)=>({granted:true,...message});
  h.chrome.scripting.executeScript=async request=>{
    h.state.injections.push(request);
    const documentId=request.target.documentIds?.[0] || sender().documentId;
    if(request.func.name==='pageInvocationState') return [{frameId:0,documentId:sender().documentId,result:{state:'running'}}];
    if(request.func.name==='editorCommit') {
      const phase=request.args[0].phase;
      if(phase==='prepare' && documentId==='synthetic-bound-document') await prepare.promise;
      if(documentId==='replacement-document' && timing===phase && !followup) {
        injectEvidence();
        await nextPhase.promise;
      }
      return [{frameId:0,documentId,result:{supported:true,dispatched:phase==='commit',hasSend:true,
        code:phase==='prepare'?'prepared':phase==='observe'?'ready':'dispatched'}}];
    }
    if(request.args[0].mode==='send') {
      if(!replacement) return oldPage.promise;
      const commit=await h.message({type:'COMMIT_RUN',runId:request.args[0].runId},sender());
      if(timing==='prepare' || timing==='commit') return [{frameId:0,documentId,result:{status:'cancelled'}}];
      assert.equal(commit.dispatched,true,'The fresh document must obtain its own MAIN commit');
      return [{frameId:0,documentId,result:{status:'sent'}}];
    }
    return [{frameId:0,documentId,result:{status:'ready'}}];
  };
  const round=h.message({type:'SEND_NOW'});let oldCommit,followup,timeout;
  try {
    await until(()=>h.state.injections.some(item=>item.args[0].mode==='send'));
    const original=h.state.injections.find(item=>item.args[0].mode==='send').args[0];
    const oldSender=sender();
    oldCommit=h.message({type:'COMMIT_RUN',runId:original.runId},oldSender);
    await until(()=>h.state.injections.some(item=>item.func.name==='editorCommit' && item.args[0].phase==='prepare'));
    injectEvidence=()=> {
      const ids={runId:original.runId,resultToken:original.resultToken};
      followup=evidence==='receipt'?h.message({type:'PAGE_RESULT',...ids,result:{status:'manual-sent'}},oldSender)
        : evidence==='manual'?h.message({type:'MANUAL_SUBMISSION',...ids},oldSender)
        : h.message({type:'PAUSE'});
    };
    if(timing==='write') {
      const write=h.chrome.storage.session.set;
      h.chrome.storage.session.set=async value=>{
        if(!followup && value.job?.phase==='sending' && value.job.runId!==original.runId) {
          // Enter the successor transaction after it has queued the write but
          // before session/local storage has acknowledged it. Do not await a
          // message whose accounting is queued behind this write.
          injectEvidence();
          await delay(20);
        }
        return write(value);
      };
    }
    replacement=true;
    let denied=false;
    for(let i=0;i<250 && !denied;i++) {
      denied=!(await h.message({type:'CHECK_RUN',runId:original.runId},oldSender)).allowed;
      if(!denied) await delay(10);
    }
    assert.equal(denied,true,'Retirement must fence the original document before the retry delay finishes');
    assert.equal(h.state.session.job.phase,'sending','A proven pre-submit replacement must not terminate the delivery');
    assert.equal(h.state.session.job.runId,original.runId,'The old permit must already be denied while the replacement transaction is pending');
    if(timing==='sleep') injectEvidence();
    const result=await Promise.race([round,new Promise((_,reject)=>{
      timeout=setTimeout(()=>reject(new Error('The replacement round did not settle')),6000);
    })]);
    prepare.resolve();
    assert.equal((await oldCommit).code,'cancelled','A late prepare return must not reach MAIN commit');
    const admissions=h.state.injections.filter(item=>item.args[0].mode==='send');
    const commits=h.state.injections.filter(item=>item.func.name==='editorCommit' && item.args[0].phase==='commit');
    if(evidence!=='none') {
      assert.ok(followup,'The test must actually deliver the racing event');
      assert.equal((await followup).ok,true);
      assert.equal(admissions.length,['prepare','commit'].includes(timing)?2:1);
      assert.equal(commits.length,timing==='commit'?1:0);
      assert.equal(result.job.enabled,false);
      assert.equal(result.job.sentCount,0);
      assert.equal(result.job.manualSentCount||0,evidence==='receipt' && timing!=='commit'?1:0);
      assert.equal(result.job.unknownCount,evidence==='manual' || timing==='commit'?1:0);
      return;
    }
    assert.equal(admissions.length,2);
    assert.notEqual(admissions[0].args[0].runId,admissions[1].args[0].runId);
    assert.notEqual(admissions[0].args[0].resultToken,admissions[1].args[0].resultToken);
    assert.deepEqual(admissions[0].args[0].promptDelivery,admissions[1].args[0].promptDelivery);
    assert.equal(commits.length,1);
    assert.deepEqual(commits[0].target.documentIds,['replacement-document']);
    assert.equal(result.job.sentCount,1);
    assert.equal(result.job.unknownCount,0);
    assert.equal(result.job.prompt,'Continue mock task.');
  } finally {
    clearTimeout(timeout);
    await h.message({type:'PAUSE'});
    prepare.resolve();nextPhase.resolve();oldPage.resolve([{frameId:0,result:{status:'unknown'}}]);
    await oldCommit;await round;
  }
});
}

async function boundedRecoveryResult(promise,description) {
  let timer;
  try {
    return await Promise.race([promise,new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error(description)),7000);
    })]);
  } finally { clearTimeout(timer); }
}

for(const area of ['session','local']) {
await scenario(`Late retired manual receipt during held ${area} receipt-finalization write stays unknown`,async()=>{
  const h=await harness();await h.start({mode:'queue-loop',queue:[{text:'FIRST'},{text:'SECOND'}]});
  const oldPage=deferred(),oldPrepare=deferred(),writeEntered=deferred(),releaseWrite=deferred();
  let replacement=false,original,oldCommit,lateReceipt,held=false;
  const oldSender={...h.sender(),documentId:'synthetic-bound-document'};
  const sender=()=>({...h.sender(),documentId:replacement?'replacement-document':'synthetic-bound-document'});
  h.chrome.tabs.sendMessage=async(id,message)=>({granted:true,revoked:true,...message});
  h.chrome.scripting.executeScript=async request=>{
    h.state.injections.push(request);
    const documentId=request.target.documentIds?.[0] || sender().documentId;
    const args=request.args[0];
    if(request.func.name==='pageInvocationState')
      return [{frameId:0,documentId:sender().documentId,result:{state:'running'}}];
    if(request.func.name==='editorCommit') {
      if(args.phase==='prepare' && documentId==='synthetic-bound-document') await oldPrepare.promise;
      return [{frameId:0,documentId,result:{supported:true,dispatched:args.phase==='commit',hasSend:true,
        code:args.phase==='prepare'?'prepared':args.phase==='observe'?'ready':'dispatched'}}];
    }
    if(args.mode==='send') {
      if(!replacement) { original=args;return oldPage.promise; }
      const commit=await h.message({type:'COMMIT_RUN',runId:args.runId},sender());
      assert.equal(commit.dispatched,true,'The successor commit must precede the late retired receipt');
      return [{frameId:0,documentId,result:{status:'sent'}}];
    }
    return [{frameId:0,documentId,result:{status:'ready'}}];
  };
  const write=h.chrome.storage[area].set;
  h.chrome.storage[area].set=async value=>{
    const job=area==='session'?value.job:value.resumeJob;
    if(!held && job?.phase==='idle' && job.sentCount===1 && job.runId!==original?.runId) {
      held=true;writeEntered.resolve(copy(job));
      await releaseWrite.promise;
    }
    return write(value);
  };
  const round=h.message({type:'SEND_NOW'});
  let roundSettled=false;
  void round.then(()=>{roundSettled=true;});
  try {
    await until(()=>original);
    oldCommit=h.message({type:'COMMIT_RUN',runId:original.runId},oldSender);
    await until(()=>h.state.injections.some(item=>item.func.name==='editorCommit' && item.args[0].phase==='prepare'));
    replacement=true;
    const provisional=await boundedRecoveryResult(writeEntered.promise,'Successor receipt accounting did not reach the held write');
    assert.equal(roundSettled,false,'Receipt accounting must still be awaiting the exact held write');
    assert.equal(h.state[area][area==='session'?'job':'resumeJob'].phase,'sending',
      'The held storage area must not have acknowledged the provisional idle snapshot');
    const receipt={type:'PAGE_RESULT',runId:original.runId,resultToken:original.resultToken,result:{status:'manual-sent'}};
    lateReceipt=h.message(receipt,oldSender);
    let receiptSettled=false;
    void lateReceipt.then(()=>{receiptSettled=true;});
    // The evidence handler latches before queuing accounting behind the held write.
    await delay(0);
    assert.equal(receiptSettled,false,'Retired evidence accounting must be queued behind the held successor write');
    releaseWrite.resolve();
    const result=await boundedRecoveryResult(round,'Ambiguous receipt finalization did not settle');
    const receiptReply=await boundedRecoveryResult(lateReceipt,'Retired receipt accounting did not settle');
    const admissions=h.state.injections.filter(item=>item.args[0].mode==='send');
    const commits=h.state.injections.filter(item=>item.func.name==='editorCommit' && item.args[0].phase==='commit');
    assert.equal(admissions.length,2);
    assert.notEqual(admissions[0].args[0].runId,admissions[1].args[0].runId);
    assert.deepEqual(admissions[0].args[0].promptDelivery,admissions[1].args[0].promptDelivery);
    assert.equal(provisional.runId,admissions[1].args[0].runId);
    assert.equal(commits.length,1,'No further MAIN commit may follow the ambiguous receipts');
    assert.deepEqual(commits[0].target.documentIds,['replacement-document']);
    await until(()=>h.state.local.deliveryDiagnostics?.some(item=>item.state!=='running'));
    const trace=h.state.local.deliveryDiagnostics.at(-1);
    const summary=job=>({enabled:job.enabled,phase:job.phase,sentCount:job.sentCount,
      manualSentCount:job.manualSentCount||0,unknownCount:job.unknownCount,queueIndex:job.queueIndex,
      ordinal:job.promptDelivery?.ordinal,lastResult:job.lastResult});
    console.log('EVIDENCE '+JSON.stringify({case:`held ${area} receipt-finalization`,receiptReply,
      response:summary(result.job),session:summary(h.state.session.job),local:summary(h.state.local.resumeJob),traceState:trace.state}));
    const expected={enabled:false,phase:'idle',sentCount:0,manualSentCount:0,unknownCount:1,
      queueIndex:0,ordinal:original.promptDelivery.ordinal,lastResult:'unknown'};
    for(const job of [result.job,h.state.session.job,h.state.local.resumeJob])
      assert.deepEqual(summary(job),expected,'Late retired evidence must reconcile from the original uncounted sending baseline');
    assert.equal(trace.state,'unknown','An ambiguous round must not persist a false successful terminal delivery trace');
    assert.equal(h.state.alarms.size,0);
    assert.equal((await h.message(receipt,oldSender)).ok,false,'A duplicate retired receipt cannot count another result');
    assert.equal(h.state.session.job.unknownCount,1);
  } finally {
    releaseWrite.resolve();
    await h.message({type:'PAUSE'});
    oldPrepare.resolve();oldPage.resolve([{frameId:0,result:{status:'cancelled'}}]);
    if(oldCommit) assert.equal((await oldCommit).code,'cancelled','The held old prepare must never obtain MAIN commit authority');
    await round;if(lateReceipt) await lateReceipt;
  }
});
}

await scenario('Immediate retryable result before document-change detection cannot replay an admitted old MAIN commit',async()=>{
  const h=await harness();await h.start({maxSends:1});
  const queuedCommit=deferred(),releaseDetector=deferred();
  let replacement=false,original,commitReply,oldDetectorReturns=0;
  const sender=()=>({...h.sender(),documentId:replacement?'replacement-document':'synthetic-bound-document'});
  h.chrome.tabs.sendMessage=async(id,message)=>({granted:true,revoked:true,...message});
  h.chrome.scripting.executeScript=async request=>{
    h.state.injections.push(request);
    const args=request.args[0],documentId=request.target.documentIds?.[0] || sender().documentId;
    if(request.func.name==='pageInvocationState') {
      if(args.runId===original?.runId && args.resultToken) { await releaseDetector.promise;oldDetectorReturns++; }
      return [{frameId:0,documentId:sender().documentId,result:{state:'running'}}];
    }
    if(request.func.name==='editorCommit') {
      if(args.phase==='commit' && documentId==='synthetic-bound-document')
        return [{frameId:0,documentId,result:await queuedCommit.promise}];
      return [{frameId:0,documentId,result:{supported:true,dispatched:args.phase==='commit',hasSend:true,
        code:args.phase==='prepare'?'prepared':args.phase==='observe'?'ready':'dispatched'}}];
    }
    if(args.mode==='send') {
      const first=!original;
      if(first) original=args;
      const committed=await h.message({type:'COMMIT_RUN',runId:args.runId},sender());
      if(first) {
        commitReply=committed;
        assert.equal(oldDetectorReturns,0,'The retryable page result must beat every old-document replacement observation');
        return [{frameId:0,documentId,result:{status:'blocked',retryable:true,diagnosticCode:'commit-not-dispatched',
          diagnosticProgress:{counters:{dispatchAttempts:0,manualIntents:0}}}}];
      }
      return [{frameId:0,documentId,result:{status:committed.dispatched?'sent':'unknown'}}];
    }
    return [{frameId:0,documentId,result:{status:'ready'}}];
  };
  const round=h.message({type:'SEND_NOW'});
  try {
    await until(()=>h.state.injections.some(item=>item.func.name==='editorCommit' && item.args[0].phase==='commit'));
    assert.equal(h.state.session.job.editorCommitRunId,original.runId);
    replacement=true;
    queuedCommit.resolve({supported:true,dispatched:false,code:'send-ambiguous'});
    const result=await boundedRecoveryResult(round,'The immediate retryable result did not settle');
    const admissions=h.state.injections.filter(item=>item.args[0].mode==='send');
    const commits=h.state.injections.filter(item=>item.func.name==='editorCommit' && item.args[0].phase==='commit');
    console.log('EVIDENCE '+JSON.stringify({case:'immediate retryable result before document-change detection',commitReply,
      admissions:admissions.length,commitDocuments:commits.map(item=>item.target.documentIds),
      enabled:result.job.enabled,sentCount:result.job.sentCount,unknownCount:result.job.unknownCount}));
    assert.equal(oldDetectorReturns,0,'No document-change detector may settle before the no-replay decision');
    assert.equal(admissions.length,1,'An admitted old MAIN commit must fence outer retry even when the page immediately returns retryable zero counters');
    assert.equal(commits.length,1);
    assert.deepEqual(commits[0].target.documentIds,['synthetic-bound-document']);
    for(const job of [result.job,h.state.session.job,h.state.local.resumeJob]) {
      assert.equal(job.enabled,false);
      assert.equal(job.phase,'idle');
      assert.equal(job.sentCount,0);
      assert.equal(job.manualSentCount||0,0);
      assert.equal(job.unknownCount,1);
      assert.deepEqual(job.promptDelivery,original.promptDelivery,'Unknown admission must preserve the original ordinal');
    }
    assert.equal(h.state.alarms.size,0);
    await until(()=>h.state.local.deliveryDiagnostics?.some(item=>item.state!=='running'));
    assert.equal(h.state.local.deliveryDiagnostics.at(-1).state,'unknown','A fenced admission cannot report trace success');
  } finally {
    queuedCommit.resolve({supported:true,dispatched:false,code:'send-ambiguous'});
    releaseDetector.resolve();
    await h.message({type:'PAUSE'});await round;
  }
});

for(const replaceAfterRead of [false,true]) await scenario(replaceAfterRead
  ? 'Replacement after same-document retry readback cannot redirect pinned successor authority'
  : 'Explicit no-dispatch same-document retry retains its document pin and sends once',async()=>{
  const h=await harness();await h.start({maxSends:1});
  let replacement=false,original,commits=0,readbacks=0;
  const oldDocument='synthetic-bound-document';
  const sender=()=>({...h.sender(),documentId:replacement?'replacement-document':oldDocument});
  h.chrome.tabs.sendMessage=async(id,message)=>({granted:true,revoked:true,...message});
  h.chrome.scripting.executeScript=async request=>{
    h.state.injections.push(request);
    const args=request.args[0],documentId=request.target.documentIds?.[0] || sender().documentId;
    if(request.func.name==='pageInvocationState') {
      if(!args.resultToken && args.runId===original?.runId) {
        readbacks++;
        const result=[{frameId:0,documentId:oldDocument,result:{state:'settled'}}];
        if(replaceAfterRead) replacement=true;
        return result;
      }
      return [{frameId:0,documentId:sender().documentId,result:{state:'running'}}];
    }
    if(replacement && documentId===oldDocument) throw new Error('The pinned old document no longer exists');
    if(request.func.name==='editorCommit') {
      if(args.phase==='commit') {
        commits++;
        return [{frameId:0,documentId,result:{supported:true,dispatched:commits>1,
          hasSend:true,code:commits===1?'attachments':'dispatched'}}];
      }
      return [{frameId:0,documentId,result:{supported:true,dispatched:false,hasSend:true,
        code:args.phase==='prepare'?'prepared':'ready'}}];
    }
    if(args.mode==='send') {
      original??=args;
      const committed=await h.message({type:'COMMIT_RUN',runId:args.runId},sender());
      return [{frameId:0,documentId,result:committed.dispatched?{status:'sent'}:
        {status:'blocked',retryable:true,diagnosticCode:'commit-not-dispatched',
          diagnosticProgress:{counters:{dispatchAttempts:0,manualIntents:0}}}}];
    }
    return [{frameId:0,documentId,result:{status:'ready'}}];
  };
  try {
    const result=await boundedRecoveryResult(h.message({type:'SEND_NOW'}),'Pinned same-document retry did not settle');
    const admissions=h.state.injections.filter(item=>item.args[0].mode==='send');
    assert.equal(readbacks,1);
    assert.ok(admissions.length>=2);
    assert.deepEqual(admissions[1].target.documentIds,[oldDocument],'Retry must be injected only into the admitted document');
    assert.deepEqual(admissions[0].args[0].promptDelivery,admissions[1].args[0].promptDelivery);
    assert.equal(result.job.enabled,false);
    assert.equal(commits,replaceAfterRead?1:2);
    assert.equal(result.job.sentCount,replaceAfterRead?0:1);
    assert.equal(result.job.unknownCount,replaceAfterRead?1:0);
    assert.equal(h.state.injections.filter(item=>item.func.name==='editorCommit'
      && item.target.documentIds?.includes('replacement-document')).length,0);
    assert.equal(h.state.alarms.size,0);
  } finally { await h.message({type:'PAUSE'}); }
});

await scenario('Known pre-submission failures keep retrying without waiting an interval and Pause prevents later admissions',async()=>{
  const h=await harness();await h.start();let sends=0;
  h.pageResult=async args=>args.mode==='send'?(++sends,{status:'blocked',retryable:true,message:'Synthetic remount',diagnosticProgress:{counters:{dispatchAttempts:0,manualIntents:0}}}):{status:'ready'};
  const round=h.message({type:'SEND_NOW'});
  for(let i=0;i<100 && sends<2;i++) await delay(20);
  assert.ok(sends>=2,'A blocked pre-submit composer must retry without a one-minute or full-interval delay');
  assert.equal(h.state.session.job.phase,'sending');
  assert.equal(h.state.session.job.sentCount,0);
  await h.message({type:'PAUSE'});
  await round;
  const stopped=sends;await delay(1100);
  assert.equal(sends,stopped);
  assert.equal(h.state.session.job.enabled,false);
});

await scenario('A retryable result missing manualIntents must not trigger another send',async()=>{
  const h=await harness();await h.start();let sends=0;
  h.pageResult=async args=>args.mode!=='send'?{status:'ready'}:++sends===1
    ?{status:'blocked',retryable:true,diagnosticProgress:{counters:{dispatchAttempts:0}}}
    :{status:'sent'};
  const result=await h.message({type:'SEND_NOW'});
  assert.equal(sends,1,'A missing manual-intent count cannot prove the first attempt was unsent');
  assert.equal(result.job.enabled,false);
  assert.equal(result.job.sentCount,0);
  assert.equal(result.job.unknownCount,1);
  assert.equal(result.job.nextAt,null);
  assert.equal(h.state.alarms.size,0);
  assert.equal(h.state.local.resumeJob.enabled,false);
});

await scenario('A retryable result with explicit zero counters permits a fresh send',async()=>{
  const h=await harness();await h.start({maxSends:1});let sends=0;
  h.pageResult=async args=>args.mode!=='send'?{status:'ready'}:++sends===1
    ?{status:'blocked',retryable:true,diagnosticProgress:{counters:{dispatchAttempts:0,manualIntents:0}}}
    :{status:'sent'};
  const result=await h.message({type:'SEND_NOW'});
  const admissions=h.state.injections.filter(item=>item.args[0].mode==='send');
  assert.equal(sends,2);
  assert.equal(admissions.length,2);
  assert.notEqual(admissions[0].args[0].runId,admissions[1].args[0].runId);
  assert.equal(result.job.sentCount,1);
  assert.equal(result.job.unknownCount,0);
  assert.equal(result.job.enabled,false);
});

for(const status of ['busy','draft','blocked','error']) {
  for(const [label,evidence] of [
    ['missing retry flag',{}],
    ['false retry flag',{retryable:false}],
    ['zero counters without retry flag',{diagnosticProgress:{counters:{dispatchAttempts:0,manualIntents:0}}}],
    ['retry flag without counters',{retryable:true}],
  ]) {
    await scenario(`Send ${status} with ${label} must not schedule a resend`,async()=>{
      const h=await harness();await h.start();let sends=0;
      h.pageResult=async args=>args.mode!=='send'?{status:'ready'}:++sends===1
        ?{status,...evidence,message:'Synthetic unconfirmed result'}:{status:'sent'};
      try {
        const result=await h.message({type:'SEND_NOW'});
        const scheduled=copy(h.state.session.job);
        const alarms=h.state.alarms.size;
        const persisted=copy(h.state.local.resumeJob);
        if(scheduled.enabled && Number.isFinite(scheduled.nextAt)) h.state.session.job.nextAt=Date.now()-1;
        h.chrome.alarms.onAlarm.emit({name:'agent-continue-heartbeat'});
        for(let i=0;i<50 && sends<2;i++) await delay(2);
        assert.equal(sends,1,'An alarm must not dispatch an unproven send again');
        assert.equal(result.job.sentCount,0);
        assert.equal(scheduled.enabled,false);
        assert.equal(scheduled.unknownCount,1);
        assert.equal(scheduled.nextAt,null);
        assert.equal(alarms,0);
        assert.equal(persisted.enabled,false);
      } finally {
        await h.message({type:'PAUSE'});
      }
    });
  }
}

for(const status of ['busy','draft','blocked','error']) {
  await scenario(`Send ${status} with explicit retry and zero counters permits a fresh admission`,async()=>{
    const h=await harness();await h.start({maxSends:1});let sends=0;
    h.pageResult=async args=>args.mode!=='send'?{status:'ready'}:++sends===1
      ?{status,retryable:true,diagnosticProgress:{counters:{dispatchAttempts:0,manualIntents:0}}}:{status:'sent'};
    try {
      const result=await h.message({type:'SEND_NOW'});
      const admissions=h.state.injections.filter(item=>item.args[0].mode==='send');
      assert.equal(sends,2);
      assert.equal(admissions.length,2);
      assert.notEqual(admissions[0].args[0].runId,admissions[1].args[0].runId);
      assert.equal(result.job.sentCount,1);
      assert.equal(result.job.unknownCount,0);
      assert.equal(result.job.enabled,false);
    } finally {
      await h.message({type:'PAUSE'});
    }
  });
}

await scenario('Read-only busy reply checks may be scheduled again without any send',async()=>{
  const h=await harness();await h.start();let checks=0;
  h.pageResult=async args=>args.mode==='check'?(checks++,{status:'busy',message:'Synthetic working agent'}):{status:'sent'};
  try {
    h.state.session.job.awaitingReply=true;
    h.state.session.job.nextAt=Date.now()-1;
    h.chrome.alarms.onAlarm.emit({name:'agent-continue-heartbeat'});
    await until(()=>checks===1 && h.state.session.job.phase==='idle');
    assert.equal(h.state.session.job.enabled,true);
    assert.ok(h.state.session.job.nextAt>Date.now());
    assert.equal(h.state.alarms.size,1);
    h.state.session.job.nextAt=Date.now()-1;
    h.chrome.alarms.onAlarm.emit({name:'agent-continue-heartbeat'});
    await until(()=>checks===2 && h.state.session.job.phase==='idle');
    assert.equal(h.state.injections.filter(item=>item.args[0].mode==='send').length,0);
    assert.equal(h.state.session.job.sentCount,0);
    assert.equal(h.state.session.job.unknownCount,0);
  } finally {
    await h.message({type:'PAUSE'});
  }
});

for(const outcome of ['dispatched','queued','not-dispatched','fallback']) {
await scenario(`Document replacement after ${outcome} remains unknown and pauses`,async()=>{
  const h=await harness();await h.start();const gate=deferred();let replacement=false;
  const queued=deferred();
  h.chrome.tabs.sendMessage=async(id,message)=>({granted:true,...message});
  h.chrome.scripting.executeScript=async request=>{
    h.state.injections.push(request);
    if(request.func.name==='pageInvocationState') return [{frameId:0,documentId:replacement?'replacement-document':'synthetic-bound-document',result:{state:'absent'}}];
    if(request.func.name==='editorCommit') {
      const phase=request.args[0].phase;
      let result={supported:true,dispatched:phase==='commit',code:phase==='prepare'?'prepared':phase==='observe'?'ready':'dispatched',hasSend:true};
      if(phase==='prepare' && outcome==='fallback') result={supported:false,dispatched:false,code:'unsupported-view'};
      if(phase==='commit' && outcome==='not-dispatched') result={supported:true,dispatched:false,code:'send-ambiguous'};
      if(phase==='commit' && outcome==='queued') result=await queued.promise;
      return [{frameId:0,documentId:'synthetic-bound-document',result}];
    }
    return [{frameId:0,result:request.args[0].mode==='send'?await gate.promise:{status:'ready'}}];
  };
  const round=h.message({type:'SEND_NOW'});
  let commit;
  try {
    await until(()=>h.state.injections.some(item=>item.args[0].mode==='send'));
    const args=h.state.injections.find(item=>item.args[0].mode==='send').args[0];
    commit=h.message({type:'COMMIT_RUN',runId:args.runId},h.sender());
    if(outcome==='queued') await until(()=>h.state.injections.some(item=>item.func.name==='editorCommit' && item.args[0].phase==='commit'));
    else assert.equal((await commit).dispatched,outcome==='dispatched');
    replacement=true;
    let completed=false;round.then(()=>{completed=true;});
    for(let i=0;i<200 && !completed;i++) await delay(20);
    assert.equal(completed,true);
    await round;
    assert.equal(h.state.session.job.sentCount,0);
    assert.equal(h.state.session.job.unknownCount,1,'Replacement cannot prove whether the previous submission succeeded');
    assert.equal(h.state.session.job.enabled,false);
    assert.equal(h.state.session.job.nextAt,null);
    assert.equal(h.state.local.resumeJob.enabled,false);
    assert.equal(h.state.injections.filter(item=>item.args[0].mode==='send').length,1);
    assert.equal(h.state.injections.filter(item=>item.func.name==='editorCommit' && item.args[0].phase==='commit').length,outcome==='fallback'?0:1);
  } finally {
    queued.resolve({supported:true,dispatched:false,code:'send-ambiguous'});
    await h.message({type:'PAUSE'});
    gate.resolve({status:'sent'});
    await commit;await round;
  }
});
}

await scenario('An injection API rejection cannot discard a later valid same-invocation receipt',async()=>{
  const h=await harness();await h.start();h.pageResult=async()=>{throw new Error('PRIVATE_SENTINEL');};
  const round=h.message({type:'SEND_NOW'});
  await until(()=>h.state.injections.some(item=>item.args[0].mode==='send'));
  await delay(10);
  const args=h.state.injections.find(item=>item.args[0].mode==='send').args[0];
  assert.equal(h.state.session.job.phase,'sending');
  assert.equal((await h.message({type:'PAGE_RESULT',runId:args.runId,resultToken:args.resultToken,result:{status:'sent'}},h.sender())).ok,true);
  assert.equal((await round).job.sentCount,1);
  assert.equal(h.state.injections.filter(item=>item.args[0].mode==='send').length,1);
  await h.message({type:'PAUSE'});
});

await scenario('Pause awaits exact page revocation; missing acknowledgement is visible and fences the old permit',async()=>{
  const h=await harness();await h.start();const gate=deferred();h.pageResult=()=>gate.promise;
  const round=h.message({type:'SEND_NOW'});
  await until(()=>h.state.injections.some(item=>item.args[0].mode==='send'));
  h.chrome.tabs.sendMessage=async()=>({revoked:true,runId:'wrong',resultToken:'wrong'});
  const paused=await h.message({type:'PAUSE'});
  assert.equal(paused.job.enabled,false);
  assert.ok(paused.job.submissionFenceUntil>Date.now());
  assert.match(paused.job.statusText,/尚未确认/);
  assert.equal((await round).job.sentCount,0);
  assert.equal((await h.message({type:'RESUME'})).ok,false);
  assert.equal((await h.message({type:'START',config:{intervalMinutes:30,prompt:'A new synthetic job'}})).ok,false);
  await h.message({type:'CLEAR_DATA'});
  assert.equal((await h.message({type:'START',config:{intervalMinutes:30,prompt:'A new synthetic job'}})).ok,false,'Clear Data must not erase an outstanding page permit fence');
  gate.resolve({status:'sent'});
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

await scenario('A live waiting invocation can refresh its command permit, but foreign tabs and paused runs cannot',async()=>{
  const h=await harness();await h.start();const gate=deferred();h.pageResult=()=>gate.promise;
  const round=h.message({type:'SEND_NOW'});
  await until(()=>h.state.injections.some(x=>x.args[0].mode==='send'));
  const runId=h.state.session.job.runId;
  const wrong=h.sender();wrong.tab.id=8;
  assert.equal((await h.message({type:'CHECK_RUN',runId},wrong)).allowed,false);
  h.state.session.job.runDeadline=Date.now()-1;
  assert.equal((await h.message({type:'CHECK_RUN',runId},h.sender())).allowed,true);
  await h.message({type:'PAUSE'});
  assert.equal((await h.message({type:'CHECK_RUN',runId},h.sender())).allowed,false);
  gate.resolve({status:'cancelled'});await round;
});

await scenario('A busy send with explicit zero counters retries and counts only the confirmed send',async()=>{
  const h=await harness();await h.start({maxSends:1});let sends=0;
  h.pageResult=async args=>args.mode!=='send'?{status:'ready'}:++sends===1
    ?{status:'busy',retryable:true,message:'Agent working',diagnosticProgress:{counters:{dispatchAttempts:0,manualIntents:0}}}
    :{status:'sent',message:'Confirmed'};
  const sent=await h.message({type:'SEND_NOW'});
  const admissions=h.state.injections.filter(item=>item.args[0].mode==='send');
  assert.equal(sends,2);
  assert.notEqual(admissions[0].args[0].runId,admissions[1].args[0].runId);
  assert.equal(sent.job.sentCount,1);assert.equal(sent.job.unknownCount,0);assert.equal(sent.job.enabled,false);
});

await scenario('Unknown submission results persistently pause with the unresolved cycle intact',async()=>{
  const h=await harness();await h.start();h.pageResult=async()=>({status:'unknown',message:'Unconfirmed'});
  const result=await h.message({type:'SEND_NOW'});
  assert.equal(result.job.enabled,false);assert.equal(result.job.sentCount,0);
  assert.equal(result.job.unknownCount,1);assert.equal(result.job.needsAttention,true);
  assert.equal(result.job.nextAt,null);assert.equal(h.state.alarms.size,0);
  assert.equal(result.job.promptDelivery.ordinal,1);
  assert.deepEqual(h.state.local.resumeJob.promptDelivery,result.job.promptDelivery);
  assert.equal(h.state.local.resumeJob.enabled,false);
  assert.equal((await h.message({type:'SEND_NOW'})).ok,false);
  assert.equal(h.state.injections.filter(x=>x.args[0].mode==='send').length,1);
  const restored=await harness({local:copy(h.state.local)});
  assert.equal(restored.state.session.job.enabled,false);
  assert.equal(restored.state.session.job.nextAt,null);
  assert.deepEqual(restored.state.session.job.promptDelivery,result.job.promptDelivery);
  assert.equal(restored.state.alarms.size,0);
  assert.equal(restored.state.injections.length,0);
});

await scenario('Switching the bound tab waits without sending into another conversation',async()=>{
  const h=await harness();await h.start();h.state.tab.url='https://chatgpt.com/c/another-chat';
  const result=await h.message({type:'SEND_NOW'});
  assert.equal(result.job.enabled,true);
  assert.equal(h.state.injections.filter(x=>x.args[0].mode==='send').length,0);
  await h.message({type:'PAUSE'});
});

await scenario('A worker restarted during submission pauses until explicit review',async()=>{
  const first=await harness();await first.start();
  const snapshot=copy(first.state.session);
  snapshot.job.phase='sending';snapshot.job.runDeadline=Date.now()+12_000;
  const h=await harness({session:snapshot,tab:{autoDiscardable:false}});
  assert.equal(h.state.session.job.enabled,false);
  assert.equal(h.state.session.job.phase,'idle');
  assert.equal(h.state.session.job.nextAt,null);
  assert.equal(h.state.session.job.unknownCount,1);
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

await scenario('Completed reads do not accumulate invalidation subscribers',async()=>{
  const {invalidation,readUntilInvalidated}=runInNewContext(`${readSource}\n({invalidation,readUntilInvalidated})`);
  const signal=invalidation();
  assert.equal(typeof signal.subscribe,'function','Invalidation must support cancellable subscriptions');
  const listeners=new Set();
  const observed={
    subscribe(callback){
      listeners.add(callback);
      const unsubscribe=signal.subscribe(callback);
      return ()=>{listeners.delete(callback);unsubscribe();};
    },
  };
  for(let i=0;i<32;i++) {
    const result=await readUntilInvalidated(()=>i,observed);
    assert.equal(result.value,i);
    assert.equal(result.invalidated,undefined);
    assert.equal(listeners.size,0,'A completed read must unsubscribe');
  }
  const failure=new Error('synthetic read failure');
  const failed=await readUntilInvalidated(()=>{throw failure;},observed);
  assert.equal(failed.error,failure);
  assert.equal(listeners.size,0,'A failed read must unsubscribe');
  const pending=deferred();
  const reading=readUntilInvalidated(()=>pending.promise,observed);
  await until(()=>listeners.size===1);
  signal.invalidate();
  assert.equal((await reading).invalidated,true);
  assert.equal(listeners.size,0,'An invalidated read must unsubscribe');
  pending.reject(new Error('late synthetic failure'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await readUntilInvalidated(()=>42,signal)).invalidated,true);
});

await scenario('Invalidation notifies only active subscribers and remains invalidated',async()=>{
  const {invalidation}=runInNewContext(`${readSource}\n({invalidation})`);
  const signal=invalidation();
  const notifications=[];
  const cancel=signal.subscribe(()=>notifications.push('cancelled'));
  signal.subscribe(()=>notifications.push('active'));
  cancel();
  cancel();
  signal.invalidate();
  signal.invalidate();
  signal.subscribe(()=>notifications.push('late'))();
  assert.deepEqual(notifications,['active','late']);
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
await scenario('Log writer preserves long finite durations instead of clipping a stalled delivery to two minutes',async()=>{
  for(const code of ['adapter-result','execution-exception','execution-timeout','no-valid-result']) {
    for(const [durationMs,expected] of [[0,0],[12.5,12.5],[-4,0],[120000,120000],[250000,250000]]) {
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
for (const [name, pageResult, code] of [
  ['missing injection return', async()=>null, 'no-valid-result'],
  ['rejected injection transport', async()=>{throw new Error('PRIVATE_SENTINEL');}, 'execution-exception'],
]) {
  await scenario(`No fixed wait limit for ${name}; Pause still ends the same invocation without replay`,async()=>{
    const h=await harness();await h.start();h.pageResult=pageResult;
    const round=h.message({type:'SEND_NOW'});
    await until(()=>h.state.injections.some(item=>item.args[0].mode==='send'));
    await delay(20100);
    assert.equal(h.state.session.job.phase,'sending');
    assert.equal(h.state.session.job.sentCount,0);
    assert.ok(h.state.session.job.runDeadline>Date.now());
    const entry=h.state.local.logs.findLast(item=>item.event==='busy');
    assert.equal(entry.diagnostic.code,code);
    assert.equal(h.state.local.logs.some(item=>item.event==='unconfirmed'),false);
    assert.doesNotMatch(JSON.stringify(h.state.local.logs),/PRIVATE_SENTINEL|Continue mock task\./);
    assert.equal(h.state.injections.filter(item=>item.args[0].mode==='send').length,1);
    await h.message({type:'PAUSE'});
    assert.equal((await round).job.enabled,false);
  });
}
await scenario('Mandatory priority reaches the adapter and unproven draft pauses while diagnostics remain bounded', async()=>{
  const h=await harness();
  await h.start({extensionPriority:false});
  h.pageResult=async()=>({status:'draft',diagnosticCode:'existing-draft',message:'Synthetic attachment.'});
  const result=await h.message({type:'SEND_NOW'});
  assert.equal(h.state.injections.findLast(item=>item.args[0].mode==='send').args[0].extensionPriority,true);
  assert.equal(result.job.enabled,false);
  assert.equal(result.job.sentCount,0);
  assert.equal(result.job.unknownCount,1);
  assert.equal(result.job.nextAt,null);
  assert.equal(h.state.alarms.size,0);
  assert.equal(h.state.local.resumeJob.enabled,false);
  assert.equal(h.state.local.logs.findLast(item=>item.event==='unconfirmed').diagnostic.code,'adapter-result');
  const checked=await h.message({type:'CHECK_PAGE'});
  assert.equal(checked.result.diagnosticCode,'existing-draft');
  h.pageResult=async()=>({status:'draft',diagnosticCode:'PRIVATE_SENTINEL',message:'Synthetic protection.'});
  const unknown=await h.message({type:'CHECK_PAGE'});
  assert.equal(unknown.result.diagnosticCode,null);
  const logs=writerHarness();
  await logs.write('draft','Synthetic attachment.',{code:checked.result.diagnosticCode});
  await logs.write('draft','Synthetic protection.',{code:'PRIVATE_SENTINEL'});
  assert.equal(logs.state.logs[0].diagnostic.code,'existing-draft');
  assert.equal(logs.state.logs[1].diagnostic,undefined);
  assert.equal(h.state.injections.filter(item=>item.args[0].mode==='send').length,1);
  assert.doesNotMatch(JSON.stringify(h.state.local.logs),/PRIVATE_SENTINEL/);
  assert.doesNotMatch(JSON.stringify(logs.state.logs),/PRIVATE_SENTINEL/);
  await h.message({type:'PAUSE'});
});
await scenario('An obsolete adapter result remains unknown and persistently pauses', async () => {
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
    assert.equal(job.enabled, false);
    assert.equal(job.needsAttention, true);
    assert.equal(job.nextAt, null);
    assert.equal(h.state.alarms.size, 0);
    assert.equal(h.state.local.resumeJob.enabled, false);
    assert.equal(job.promptDelivery.ordinal, 1);
    assert.deepEqual(h.state.local.resumeJob.promptDelivery, job.promptDelivery);
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
  assert.equal(injection.args[0].receiptBoundaryToken, '00000000-0000-0000-0000-000000000001');
  assert.equal(h.state.session.job.editorCommitRunId, job.runId);
  assert.equal((await h.message(request, h.sender())).code, 'unknown');
  assert.equal(h.state.injections.length, before + 3);
  assert.deepEqual(h.state.injections.slice(before).map(item => item.args[0].phase), ['prepare', 'observe', 'commit']);
  await h.message({ type: 'PAUSE' });
  assert.equal((await h.message(request, h.sender())).ok, false);
  assert.equal(h.state.injections.length, before + 3);
});
await scenario('Invalid receipt-boundary tokens never reserve or inject a model submission', async () => {
  const h = await harness();
  const job = await h.start();
  h.state.session.job = { ...job, phase: 'sending', runKind: 'send', runDeadline: Date.now() + 10000 };
  const before = h.state.injections.length;
  for (const receiptBoundaryToken of [undefined, null, '', 'invalid', 'a'.repeat(1000), 42]) {
    const reply = await h.message({ type: 'COMMIT_RUN', runId: job.runId, receiptBoundaryToken }, h.sender());
    assert.equal(reply.dispatched, false);
    assert.equal(reply.code, 'not-dispatched');
    assert.equal(h.state.session.job.editorCommitRunId, undefined);
  }
  assert.equal(h.state.injections.length, before);
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
await scenario('A replaced document waits only on the bound document until Pause, never tabId fallback', async () => {
  const h = await harness();
  const job = await h.start();
  h.state.session.job = { ...job, phase: 'sending', runKind: 'send', runDeadline: Date.now() + 10000 };
  const before = h.state.injections.length;
  let observations = 0;
  h.chrome.scripting.executeScript = async request => {
    h.state.injections.push(request);
    assert.deepEqual(request.target.documentIds, ['synthetic-bound-document']);
    if (request.args[0].phase !== 'prepare') {
      if (++observations === 2) await h.message({ type: 'PAUSE' });
      throw new Error('Bound document no longer exists');
    }
    return [{ frameId: 0, result: { supported: true, dispatched: false, code: 'prepared' } }];
  };
  assert.equal((await h.message({ type: 'COMMIT_RUN', runId: job.runId }, h.sender())).code, 'cancelled');
  assert.deepEqual(h.state.injections.slice(before).map(item => item.args[0].phase), ['prepare', 'observe', 'observe']);
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
  h.pageResult = async args => {
    if (args.phase === 'commit') throw new Error('UNLOGGED_PAGE_DATA');
    return { supported: true, dispatched: false, code: args.phase === 'prepare' ? 'prepared' : 'ready', hasSend: true };
  };
  const before = h.state.injections.length;
  assert.equal((await h.message({ type: 'COMMIT_RUN', runId: job.runId }, h.sender())).code, 'unknown');
  assert.equal((await h.message({ type: 'COMMIT_RUN', runId: job.runId }, h.sender())).code, 'unknown');
  assert.equal(h.state.injections.length, before + 3);
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
await scenario('An explicitly expired unattempted MAIN phase is refreshed inside the same reservation, never a second submit',async()=>{
  const h=await harness();const job=await h.start();
  h.state.session.job={...job,phase:'sending',runKind:'send',runDeadline:Date.now()+10000};
  let preparations=0;
  h.pageResult=async args=>{
    if(args.phase==='prepare' && ++preparations===1) return {supported:false,dispatched:false,code:'expired'};
    return {supported:true,dispatched:args.phase==='commit',code:args.phase==='prepare'?'prepared':args.phase==='observe'?'ready':'dispatched',hasSend:true};
  };
  const result=await h.message({type:'COMMIT_RUN',runId:job.runId},h.sender());
  assert.equal(result.dispatched,true);
  assert.equal(preparations,2);
  assert.equal(h.state.injections.filter(item=>item.args[0].phase==='commit').length,1);
  assert.equal(h.state.session.job.editorCommitRunId,job.runId);
  await h.message({type:'PAUSE'});
});
const failed=results.filter(x=>x.status==='FAIL').length;
console.log(`RESULT ${results.length-failed}/${results.length} passed`);
process.exitCode=failed?1:0;
