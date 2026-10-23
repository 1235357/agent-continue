import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const playwright = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE_PATH)).href)
  : await import('playwright');
const { chromium } = playwright;
const extensionRoot = path.resolve(process.env.EXTENSION_ROOT || path.dirname(here));
const { pageAction } = await import(pathToFileURL(path.join(extensionRoot, 'adapter.js')));
const fixture = await fs.readFile(path.join(here, 'fixture.html'), 'utf8');
const expectedUrl = 'https://chatgpt.com/c/local-test-conversation';
const prompt = '继续推进测试任务，检查这条消息只提交一次。';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.TEST_CHROMIUM_PATH || undefined,
  args: ['--no-sandbox'],
});
const results = [];
let failures = 0;

async function scenario(name, body) {
  const context = await browser.newContext();
  // All requests in this fresh test browser are intercepted: no actual chat traffic.
  await context.route('**/*', route => route.fulfill({status: 200, contentType: 'text/html', body: fixture}));
  const page = await context.newPage();
  await page.goto(expectedUrl);
  const args = {
    mode: 'send', expectedUrl, prompt, runId: 'local-test-run',
    runDeadline: Date.now() + 12_000,
    stopMarkers: ['【任务完成】', '【需要人工处理】'],
  };
  try {
    const detail = await body({context, page, args});
    results.push({name, status: 'PASS', detail});
    console.log(`PASS ${name}${detail ? ': '+detail : ''}`);
  } catch (error) {
    failures++;
    results.push({name, status: 'FAIL', error: error.stack});
    console.error(`FAIL ${name}: ${error.message}`);
  } finally {
    await context.close();
  }
}

try {
  await scenario('Read-only self-check does not fill or submit', async ({page,args}) => {
    const outcome = await page.evaluate(pageAction, {...args,mode:'check',runId:null});
    assert.equal(outcome.status,'ready',JSON.stringify(outcome));
    const state = await page.evaluate(() => ({...fixture,text:document.querySelector('#prompt-textarea').innerText}));
    assert.equal(state.sendClicks,0);
    assert.equal(state.inputEvents,0);
    assert.equal(state.checks,0);
    assert.equal(state.text.trim(),'');
  });

  await scenario('A confirmed new user message is submitted exactly once', async ({page,args}) => {
    const outcome = await page.evaluate(pageAction,args);
    assert.equal(outcome.status,'sent',JSON.stringify(outcome));
    const state = await page.evaluate(() => ({...fixture,userMessages:document.querySelectorAll('[data-message-author-role="user"]').length}));
    assert.equal(state.sendClicks,1);
    assert.equal(state.userMessages,2);
    assert.equal(state.sentTexts[0].trim(),prompt.trim());
    assert.equal(state.clipboardCalls,0);
    assert.equal(state.windowFocusCalls,0);
  });

  await scenario('Multiline prompts survive rich-text paragraph rendering', async ({page,args}) => {
    const multiline='继续推进测试任务。\n检查这条消息只提交一次。';
    const outcome=await page.evaluate(pageAction,{...args,prompt:multiline});
    assert.equal(outcome.status,'sent',JSON.stringify(outcome));
    const state=await page.evaluate(()=>({...fixture}));
    assert.equal(state.sendClicks,1);
    assert.equal(state.sentTexts[0].replace(/\n+/g,'\n').trim(),multiline);
  });

  await scenario('Busy Agent is skipped without input changes', async ({page,args}) => {
    await page.evaluate(() => { const stop=document.createElement('button'); stop.dataset.testid='stop-button';stop.textContent='Stop'; document.body.append(stop); });
    const outcome=await page.evaluate(pageAction,args);
    assert.equal(outcome.status,'busy',JSON.stringify(outcome));
    assert.equal(await page.evaluate(()=>fixture.sendClicks),0);
    assert.equal(await page.evaluate(()=>fixture.inputEvents),0);
  });

  await scenario('Existing user draft is preserved', async ({page,args}) => {
    await page.locator('#prompt-textarea').fill('My unsent personal draft');
    const outcome=await page.evaluate(pageAction,args);
    assert.equal(outcome.status,'draft',JSON.stringify(outcome));
    assert.equal(await page.locator('#prompt-textarea').innerText(),'My unsent personal draft');
    assert.equal(await page.evaluate(()=>fixture.sendClicks),0);
  });

  await scenario('A paused job cannot fill or send', async ({page,args}) => {
    await page.evaluate(()=>{ fixture.allowed=false; });
    const outcome=await page.evaluate(pageAction,args);
    assert.equal(outcome.status,'cancelled',JSON.stringify(outcome));
    assert.equal(await page.evaluate(()=>fixture.sendClicks),0);
    assert.equal((await page.locator('#prompt-textarea').innerText()).trim(),'');
  });

  await scenario('Pause after filling prevents subsequent click', async ({page,args}) => {
    await page.evaluate(()=>{ fixture.cancelOnInput=true; });
    const outcome=await page.evaluate(pageAction,args);
    assert.equal(outcome.status,'cancelled',JSON.stringify(outcome));
    assert.equal(await page.evaluate(()=>fixture.sendClicks),0);
  });

  await scenario('A final permission reply arriving after its deadline cannot submit', async ({page,args}) => {
    const runDeadline = await page.evaluate(() => {
      // The first two queries allow filling and finding the send button.
      // Only the final permission reply is held until after the lease expires.
      fixture.checkDelays = [0, 0, 2500];
      return Date.now() + 2000;
    });
    const outcome = await page.evaluate(pageAction, {...args, runDeadline});
    const state = await page.evaluate(() => ({...fixture}));
    assert.equal(state.checks,3,'The final permission query must be reached');
    assert.equal(state.checkReplies[2].allowed,true,'The late reply must actually allow the run');
    assert.ok(state.checkReplies[2].repliedAt >= runDeadline,'The reply must arrive after the deadline');
    assert.equal(outcome.status,'cancelled',JSON.stringify(outcome));
    assert.equal(state.sendClicks,0);
    assert.equal(await page.locator('[data-message-author-role="user"]').count(),1);
  });

  await scenario('Another conversation URL never receives input', async ({page,args}) => {
    const outcome=await page.evaluate(pageAction,{...args,expectedUrl:'https://chatgpt.com/c/some-other-conversation'});
    assert.ok(['blocked','error'].includes(outcome.status),JSON.stringify(outcome));
    assert.equal(await page.evaluate(()=>fixture.sendClicks),0);
    assert.equal(await page.evaluate(()=>fixture.inputEvents),0);
  });

  await scenario('Default and custom stop markers work, while an empty list disables them', async ({page,args}) => {
    await page.evaluate(()=>{ document.querySelector('[data-message-author-role="assistant"]').textContent='All requested work is finished.\n【任务完成】'; });
    const defaultOutcome=await page.evaluate(pageAction,args);
    assert.equal(defaultOutcome.status,'done',JSON.stringify(defaultOutcome));
    assert.equal(await page.evaluate(()=>fixture.sendClicks),0);

    await page.evaluate(()=>{ document.querySelector('[data-message-author-role="assistant"]').textContent='Waiting for review.\n[CUSTOM_FINISHED]'; });
    const customOutcome=await page.evaluate(pageAction,{...args,stopMarkers:['[CUSTOM_FINISHED]']});
    assert.equal(customOutcome.status,'done',JSON.stringify(customOutcome));
    assert.equal(await page.evaluate(()=>fixture.sendClicks),0);
    assert.equal(await page.evaluate(()=>fixture.inputEvents),0);

    await page.evaluate(()=>{ document.querySelector('[data-message-author-role="assistant"]').textContent='Markers are intentionally disabled.\n【任务完成】\n[CUSTOM_FINISHED]'; });
    const disabledOutcome=await page.evaluate(pageAction,{...args,stopMarkers:[]});
    assert.equal(disabledOutcome.status,'sent',JSON.stringify(disabledOutcome));
    assert.equal(await page.evaluate(()=>fixture.sendClicks),1);
    assert.equal(await page.locator('[data-message-author-role="user"]').count(),2);
  });

  await scenario('Unknown submission outcome is never reported as sent', async ({page,args}) => {
    await page.evaluate(()=>{ fixture.acknowledge=false; });
    const outcome=await page.evaluate(pageAction,args);
    assert.ok(['unknown','blocked','error'].includes(outcome.status),JSON.stringify(outcome));
    assert.equal(await page.evaluate(()=>fixture.sendClicks),1);
    assert.equal(await page.locator('[data-message-author-role="user"]').count(),1);
  });

  await scenario('A user moving focus during confirmation keeps their chosen input', async ({page,args}) => {
    await page.evaluate(() => {
      fixture.deferAcknowledgement = true;
      for (const id of ['previous-focus', 'manual-focus']) {
        const input = document.createElement('input');
        input.id = id;
        input.setAttribute('aria-label',id);
        document.body.append(input);
      }
      document.querySelector('#previous-focus').focus();
    });
    const pendingOutcome = page.evaluate(pageAction,args);
    try {
      await page.waitForFunction(() => fixture.sendClicks === 1);
      // This trusted Playwright click represents the user choosing another
      // input while pageAction is waiting for a new user message to render.
      await page.locator('#manual-focus').click();
      const waitingState = await page.evaluate(() => ({
        activeId: document.activeElement.id,
        userMessages: document.querySelectorAll('[data-message-author-role="user"]').length,
      }));
      assert.equal(waitingState.activeId,'manual-focus');
      assert.equal(waitingState.userMessages,1,'Confirmation must still be pending during the user click');
      await page.evaluate(() => window.acknowledgePending());
      const outcome = await pendingOutcome;
      assert.equal(outcome.status,'sent',JSON.stringify(outcome));
      assert.equal(await page.evaluate(() => document.activeElement.id),'manual-focus');
      assert.equal(await page.evaluate(() => fixture.sendClicks),1);
    } finally {
      await page.evaluate(() => window.acknowledgePending?.()).catch(() => {});
      await pendingOutcome.catch(() => {});
    }
  });

  await scenario('Background send preserves the other tab input and focused element', async ({context,page,args}) => {
    const foreground=await context.newPage();
    await foreground.goto('https://local-foreground.invalid/work');
    await foreground.setContent('<label>Normal work<input id="work" value="Writing my paper"></label>');
    await foreground.bringToFront();
    await foreground.locator('#work').focus();
    await foreground.locator('#work').evaluate(el=>el.setSelectionRange(8,8));
    const before=await foreground.evaluate(()=>({activeId:document.activeElement.id,text:document.querySelector('#work').value,start:document.querySelector('#work').selectionStart,end:document.querySelector('#work').selectionEnd,hasFocus:document.hasFocus()}));
    const outcome=await page.evaluate(pageAction,args);
    assert.equal(outcome.status,'sent',JSON.stringify(outcome));
    const after=await foreground.evaluate(()=>({activeId:document.activeElement.id,text:document.querySelector('#work').value,start:document.querySelector('#work').selectionStart,end:document.querySelector('#work').selectionEnd,hasFocus:document.hasFocus()}));
    assert.deepEqual(after,before);
    assert.equal(await page.evaluate(()=>fixture.clipboardCalls),0);
    assert.equal(await page.evaluate(()=>fixture.windowFocusCalls),0);
    return `other tab focused=${after.hasFocus}, value and caret unchanged; headless environment`;
  });
} finally {
  await browser.close();
}
console.log(`RESULT ${results.length-failures}/${results.length} passed`);
process.exitCode=failures ? 1 : 0;
