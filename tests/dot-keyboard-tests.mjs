// Deterministic keyboard contracts, kept separate from the real ProseMirror
// and MV3/hidden-tab integration checks. Every prompt here is synthetic.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(process.env.EXTENSION_ROOT || path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const { pageAction } = await import(pathToFileURL(path.join(root, 'adapter.js')));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE_PATH)).href : 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
const expectedUrl = 'https://chatgpt.com/dots/home';
const prompt = 'Keyboard submission regression\nSynthetic continuation only.';
const fixture = `<!doctype html><meta charset="utf-8"><style>
[contenteditable]{min-height:70px;border:1px solid;white-space:pre-wrap}.message-body{white-space:pre-wrap}
</style><main id="history">
<article class="message-row self" data-message-id="test~dot~old-user"><div class="message-body">Old synthetic request</div></article>
<article class="message-row" data-message-id="test~dot~old-assistant"><div class="message-body">Old synthetic reply</div></article>
</main><div data-composer-body><div data-composer-input>
<div data-composer-markdown contenteditable="true" role="textbox" aria-label="Message"></div>
</div><button aria-label="Send" type="button">Send</button></div><script>
window.fixture={keys:[],clicks:0,submissions:0,checks:0,allow:true,cancelAt:0,editAt:0,ignoreKeys:false,receipt:true,delay:0};
const editor=document.querySelector('[contenteditable]');
const button=document.querySelector('button');
function submit(){
  if(!editor.innerText.trim())return;
  const text=editor.innerText;fixture.submissions++;
  editor.replaceChildren();
  if(fixture.receipt)setTimeout(()=>{
    const row=document.createElement('article');row.className='message-row self';row.dataset.messageId='test~dot~new-'+fixture.submissions;
    const body=document.createElement('div');body.className='message-body';body.textContent=text;row.append(body);document.querySelector('#history').append(row);
  },fixture.delay);
}
button.addEventListener('click',()=>{fixture.clicks++;submit()});
for(const type of ['keydown','keyup'])editor.addEventListener(type,event=>{
  fixture.keys.push({type:event.type,key:event.key,code:event.code,keyCode:event.keyCode,ctrl:event.ctrlKey,meta:event.metaKey,alt:event.altKey,shift:event.shiftKey,bubbles:event.bubbles,composed:event.composed,trusted:event.isTrusted});
  if(type==='keydown'&&event.key==='Enter'&&event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&!fixture.ignoreKeys){event.preventDefault();submit()}
});
window.chrome={runtime:{sendMessage:async()=>{
  fixture.checks++;
  if(fixture.checks===fixture.cancelAt)fixture.allow=false;
  if(fixture.checks===fixture.editAt)editor.append(document.createTextNode(' human edit'));
  return {ok:true,allowed:fixture.allow};
}}};
</script>`;
let passed = 0;
let failed = 0;
async function scenario(name, run) {
  const context = await browser.newContext();
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  const page = await context.newPage(); await page.goto(expectedUrl);
  const args = { expectedUrl, targetIdentity: 'test~dot', mode: 'send', prompt, sendMethod: 'ctrl-enter', runId: 'keyboard-regression', runDeadline: Date.now() + 3000, stopMarkers: [] };
  try { await run(page, args); passed++; console.log('PASS ' + name); }
  catch(error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
  finally { await context.close(); }
}
try {
  await scenario('Dot default submits one Ctrl+Enter sequence and never clicks Send', async(page,args)=>{
    const result=await page.evaluate(pageAction,args);
    assert.equal(result.status,'sent',result.message);
    const state=await page.evaluate(()=>fixture);
    assert.equal(state.clicks,0); assert.equal(state.submissions,1);
    assert.deepEqual(state.keys.map(k=>k.type),['keydown','keyup']);
    for(const key of state.keys){assert.equal(key.key,'Enter');assert.equal(key.code,'Enter');assert.equal(key.keyCode,13);assert.equal(key.ctrl,true);assert.equal(key.meta,false);assert.equal(key.alt,false);assert.equal(key.shift,false);assert.equal(key.bubbles,true);assert.equal(key.composed,true);assert.equal(key.trusted,false);}
  });
  await scenario('Dot Ctrl+Enter works when there is no Send button', async(page,args)=>{
    await page.evaluate(()=>document.querySelector('button').remove());
    const result=await page.evaluate(pageAction,args);
    assert.equal(result.status,'sent',result.message);
    assert.equal(await page.evaluate(()=>fixture.submissions),1);
  });
  await scenario('A disabled Send button does not block a valid keyboard handler', async(page,args)=>{
    await page.evaluate(()=>document.querySelector('button').disabled=true);
    const result=await page.evaluate(pageAction,args);
    assert.equal(result.status,'sent',result.message);
    assert.equal(await page.evaluate(()=>fixture.clicks),0);
  });
  await scenario('Explicit button strategy remains available without pressing keys', async(page,args)=>{
    const result=await page.evaluate(pageAction,{...args,sendMethod:'button'});
    assert.equal(result.status,'sent',result.message);
    assert.deepEqual(await page.evaluate(()=>[fixture.clicks,fixture.keys.length,fixture.submissions]),[1,0,1]);
  });
  await scenario('Force mode sends Ctrl+Enter while a typing indicator remains visible', async(page,args)=>{
    await page.evaluate(()=>{const t=document.createElement('div');t.className='typing-indicator';t.textContent='Working';document.body.append(t)});
    const result=await page.evaluate(pageAction,args);
    assert.equal(result.status,'sent',result.message);
    assert.equal(await page.evaluate(()=>fixture.clicks),0);
  });
  await scenario('Explicit wait mode still avoids typing and keyboard submission while busy', async(page,args)=>{
    await page.evaluate(()=>{const t=document.createElement('div');t.className='typing-indicator';t.textContent='Working';document.body.append(t)});
    const result=await page.evaluate(pageAction,{...args,waitForIdle:true});
    assert.equal(result.status,'busy');
    assert.deepEqual(await page.evaluate(()=>[fixture.keys.length,fixture.clicks,document.querySelector('[contenteditable]').textContent]),[0,0,'']);
  });
  await scenario('Pause immediately before submission sends no keys or clicks', async(page,args)=>{
    await page.evaluate(()=>fixture.cancelAt=3);
    const result=await page.evaluate(pageAction,args);
    assert.equal(result.status,'cancelled',result.message);
    assert.deepEqual(await page.evaluate(()=>[fixture.keys.length,fixture.clicks]),[0,0]);
  });
  await scenario('A human draft change immediately before submission is preserved', async(page,args)=>{
    await page.evaluate(()=>fixture.editAt=3);
    const result=await page.evaluate(pageAction,args);
    assert.equal(result.status,'blocked',result.message);
    assert.equal(await page.evaluate(()=>document.querySelector('[contenteditable]').innerText.endsWith(' human edit')),true);
    assert.deepEqual(await page.evaluate(()=>[fixture.keys.length,fixture.clicks]),[0,0]);
  });
  await scenario('Ignored synthetic keys are unconfirmed and never fall back to a click', async(page,args)=>{
    await page.evaluate(()=>fixture.ignoreKeys=true);
    const result=await page.evaluate(pageAction,{...args,runDeadline:Date.now()+800});
    assert.equal(result.status,'unknown',result.message);
    assert.deepEqual(await page.evaluate(()=>[fixture.keys.length,fixture.clicks,fixture.submissions]),[2,0,0]);
    assert.equal(await page.evaluate(()=>!!document.querySelector('[contenteditable]').textContent),true);
  });
  await scenario('A cleared editor without a new message remains unconfirmed, without duplicate actions', async(page,args)=>{
    await page.evaluate(()=>fixture.receipt=false);
    const result=await page.evaluate(pageAction,{...args,runDeadline:Date.now()+800});
    assert.equal(result.status,'unknown',result.message);
    assert.deepEqual(await page.evaluate(()=>[fixture.keys.length,fixture.clicks,fixture.submissions]),[2,0,1]);
  });
  await scenario('Delayed message acknowledgement confirms the same keyboard attempt once', async(page,args)=>{
    await page.evaluate(()=>fixture.delay=300);
    const result=await page.evaluate(pageAction,args);
    assert.equal(result.status,'sent',result.message);
    assert.deepEqual(await page.evaluate(()=>[fixture.keys.length,fixture.clicks,fixture.submissions]),[2,0,1]);
  });
  await scenario('Self-check never emits keyboard events or changes the editor', async(page,args)=>{
    const result=await page.evaluate(pageAction,{...args,mode:'check'});
    assert.equal(result.status,'ready',result.message);
    assert.deepEqual(await page.evaluate(()=>[fixture.keys.length,fixture.clicks,document.querySelector('[contenteditable]').textContent]),[0,0,'']);
  });
  console.log(`\n${passed}/${passed+failed} Dot keyboard scenarios passed.`);
  if(failed)process.exitCode=1;
} finally {await browser.close();}
