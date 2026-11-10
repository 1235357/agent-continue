// Official ProseMirror packages, an actual MV3 extension, and a throwaway browser
// profile. All prompts and messages are synthetic; every network route is local.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.EXTENSION_ROOT || path.dirname(here));
const moduleRoot = path.resolve(process.env.PROSEMIRROR_MODULE_ROOT || path.join(path.dirname(here), 'node_modules'));
const playwright = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE_PATH)).href)
  : await import('playwright');
const headed = process.env.TEST_HEADED === '1';
const testRealDueAlarm = process.env.TEST_REAL_DUE_ALARM === '1';
const selectedCases = process.env.TEST_PM_CASES?.split(',').map(Number);
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-continue-pm-keyboard-'));
const moduleNames = ['prosemirror-view', 'prosemirror-state', 'prosemirror-model', 'prosemirror-schema-basic',
  'prosemirror-keymap', 'prosemirror-transform', 'orderedmap', 'w3c-keyname'];
const modules = new Map();
const imports = {};
for (const name of moduleNames) {
  const packageRoot = path.join(moduleRoot, name);
  const metadata = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const route = '/__local_pm__/' + name + '.js';
  imports[name] = route;
  modules.set(route, await fs.readFile(path.join(packageRoot, metadata.module), 'utf8'));
}
const editorCss = await fs.readFile(path.join(moduleRoot, 'prosemirror-view/style/prosemirror.css'), 'utf8');
const prompt = 'PM_SYNTHETIC_FIRST_PARAGRAPH\n\nPM_SYNTHETIC_SECOND_PARAGRAPH';
let context;
let browser;
let browserProcess;
let worker;
let control;
let passed = 0;

function fixture({ noSend = false, rejectSynthetic = false, recurringRestore = false, supported = false, sendActivationDelayMs = 0, receiptDelayMs = 0,
  manualReceiptDuringReadiness = false, ignoreButtonSubmit = false, holdSendDisabled = false, fullForm = false } = {}) {
  return `<!doctype html><meta charset="utf-8"><title>Official ProseMirror fixture</title>
  <style>${editorCss}body{font:16px sans-serif;padding:20px}.ProseMirror{min-height:90px;border:1px solid;padding:12px}.message-body{white-space:pre-wrap}</style>
  <main id="history"><article class="message-row" data-message-id="pm-account~pm-dot~old"><div class="message-body">Earlier synthetic response.</div></article></main>
  <${fullForm ? 'form' : 'div'} data-composer-body><div data-composer-input id="editorMount"></div>${noSend ? '' : '<button type="button" aria-label="Send" disabled>Send</button>'}</${fullForm ? 'form' : 'div'}>
  <script type="importmap">${JSON.stringify({ imports })}</script>
  <script type="module">
  import {EditorView} from 'prosemirror-view';import {EditorState} from 'prosemirror-state';
  import {schema} from 'prosemirror-schema-basic';import {keymap} from 'prosemirror-keymap';
  window.fixture={updates:0,buttonClicks:0,keyboardCommands:0,submits:0,events:[],sentTexts:[],lastKeyTrusted:null,
    modelUpdates:[],sendActivations:[],submissionStates:[],submissionPayloads:[],sendActivationDelayMs:${JSON.stringify(sendActivationDelayMs)}};
  let button=document.querySelector('button[aria-label="Send"]');
  let sendActivationTimer;
  const submit=method=>{
    if(method==='button' && ${JSON.stringify(ignoreButtonSubmit)})return;
    const text=window.pm.state.doc.textBetween(0,window.pm.state.doc.content.size,'\\n');
    if(!text.trim())return;
    fixture.submits++;fixture.sentTexts.push(text);
    const composer=window.pm.dom.closest('[data-composer-body]');
    fixture.submissionPayloads.push({text,attachments:composer.querySelectorAll('[data-testid="attachment"]').length,
      files:[...composer.querySelectorAll('input[type="file"]')].reduce((count,input)=>count+input.files.length,0)});
    document.documentElement.dataset.fixtureSubmitted='true';
    fixture.submissionStates.push({method,hidden:document.hidden,focused:document.hasFocus(),sendDisabled:button?.disabled});
    const insertReceipt=()=>{
      const row=document.createElement('article');row.className='message-row self';row.dataset.messageId='pm-account~pm-dot~new-'+fixture.submits;
      const body=document.createElement('div');body.className='message-body';body.textContent=text;row.append(body);document.querySelector('#history').append(row);
    };
    if(${JSON.stringify(receiptDelayMs)}>0)setTimeout(insertReceipt,${JSON.stringify(receiptDelayMs)});else insertReceipt();
    window.pm.dispatch(window.pm.state.tr.delete(0,window.pm.state.doc.content.size));
  };
  window.pm=new EditorView(document.querySelector('#editorMount'),{
    state:EditorState.create({schema,plugins:[keymap({'Ctrl-Enter':()=>{
      fixture.keyboardCommands++;
      if(!${JSON.stringify(rejectSynthetic)}||fixture.lastKeyTrusted)submit('keyboard');
      return true;
    }})]}),
    attributes:{role:'textbox','aria-label':'Message','data-composer-markdown':''},
    dispatchTransaction(transaction){
      const next=window.pm.state.apply(transaction);window.pm.updateState(next);fixture.updates++;
      if(${JSON.stringify(holdSendDisabled)} && button){button.disabled=true;}
      else if(${JSON.stringify(sendActivationDelayMs)} && button){
        const update={text:next.doc.textBetween(0,next.doc.content.size,'\\n'),docChanged:transaction.docChanged,at:performance.now(),hidden:document.hidden,focused:document.hasFocus()};
        fixture.modelUpdates.push(update);button.disabled=true;clearTimeout(sendActivationTimer);
        if(next.doc.textContent.trim())sendActivationTimer=setTimeout(()=>{
          if(${JSON.stringify(manualReceiptDuringReadiness)} && !fixture.manualReceipt){
            const row=document.createElement('article');row.className='message-row self';row.dataset.messageId='pm-account~pm-dot~manual-during-readiness';
            const body=document.createElement('div');body.className='message-body';body.textContent=update.text;row.append(body);document.querySelector('#history').append(row);
            fixture.manualReceipt={text:update.text,hidden:document.hidden};
          }
          button.disabled=!window.pm.state.doc.textContent.trim();
          fixture.sendActivations.push({elapsedMs:performance.now()-update.at,hidden:document.hidden,focused:document.hasFocus()});
        },${JSON.stringify(sendActivationDelayMs)});
      }else if(button)button.disabled=!next.doc.textContent.trim();
    }
  });
  const clickSend=event=>{
    if(!event.currentTarget.isConnected)fixture.staleButtonClicks=(fixture.staleButtonClicks||0)+1;
    fixture.buttonClicks++;submit('button');
  };
  const bindControls=()=>{
  window.pm.dom.addEventListener('keydown',event=>{fixture.lastKeyTrusted=event.isTrusted},true);
  // Only this explicit Tiptap-compatible fixture exposes a documented DOM owner.
  // The vanilla PM cases above exercise the unsupported-view event fallback.
  if (${JSON.stringify(supported)}) window.pm.dom.editor={view:window.pm};
  if (${JSON.stringify(recurringRestore)}) window.pm.dom.addEventListener('input', () => queueMicrotask(() => {
    window.pm.dispatch(window.pm.state.tr.insertText('PAGE_RESTORED_OTHER_TEXT', 0, window.pm.state.doc.content.size));
    fixture.restores = (fixture.restores || 0) + 1;
  }));
  for(const type of ['keydown','keypress','keyup'])window.pm.dom.addEventListener(type,event=>{
    fixture.events.push({type,key:event.key,code:event.code,keyCode:event.keyCode,ctrlKey:event.ctrlKey,trusted:event.isTrusted,repeat:event.repeat});
  });
  if(button)button.addEventListener('click',clickSend);
  };
  bindControls();
  document.addEventListener('fixture-final-button-disconnect',()=>{
    const replacement=button.cloneNode(true);button.replaceWith(replacement);button=replacement;
    button.addEventListener('click',clickSend);fixture.sendReplacements=(fixture.sendReplacements||0)+1;
  });
  window.fixtureRemountComposer=(restorePrepared=false)=>{
    const previous=window.pm;
    const oldForm=previous.dom.closest('[data-composer-body]');
    const replacement=document.createElement('form');replacement.dataset.composerBody='';
    replacement.innerHTML='<div data-composer-input id="editorMount"></div><button type="button" aria-label="Send" disabled>Send</button>';
    const props={...previous.props,state:restorePrepared?previous.state:EditorState.create({schema,plugins:previous.state.plugins})};
    clearTimeout(sendActivationTimer);previous.destroy();oldForm.replaceWith(replacement);
    button=replacement.querySelector('button[aria-label="Send"]');
    window.pm=new EditorView(replacement.querySelector('#editorMount'),props);bindControls();
    window.fixtureDetachedForms??=[];window.fixtureDetachedForms.push(oldForm);
    fixture.remounts=(fixture.remounts||0)+1;
    if(restorePrepared)window.pm.dom.addEventListener('input',()=>{
      fixture.remountActivationInputs=(fixture.remountActivationInputs||0)+1;
      button.disabled=!window.pm.state.doc.textContent.trim();
    });
    else window.pm.dispatch(window.pm.state.tr.insertText('PM_SYNTHETIC_CHANGED_DRAFT_AFTER_FULL_FORM_REMOUNT'));
    fixture.remountedDraft=window.pm.state.doc.textContent;
  };
  window.fixtureAddAttachment=removable=>{
    const composer=window.pm.dom.closest('[data-composer-body]');
    const chip=document.createElement('span');chip.dataset.testid='attachment';chip.textContent='Synthetic pending upload';
    if(removable){
      const remove=document.createElement('button');remove.type='button';remove.setAttribute('aria-label','Remove attachment synthetic.txt');
      remove.textContent='Remove';remove.addEventListener('click',()=>{fixture.attachmentRemovals=(fixture.attachmentRemovals||0)+1;chip.remove()});chip.append(remove);
    }
    const input=document.createElement('input');input.type='file';input.dataset.pendingUpload='';
    const pending=new DataTransfer();pending.items.add(new File(['SYNTHETIC_PENDING_UPLOAD'],'synthetic.txt',{type:'text/plain'}));input.files=pending.files;
    input.addEventListener('change',()=>{fixture.fileClearEvents=(fixture.fileClearEvents||0)+1});composer.append(chip,input);
    const account=document.createElement('aside');account.dataset.accountFiles='';account.dataset.fileId='account-file-sentinel';
    const remove=document.createElement('button');remove.type='button';remove.setAttribute('aria-label','Remove attachment account-file-sentinel');
    remove.textContent='Account file';remove.addEventListener('click',()=>{fixture.accountRemoveClicks=(fixture.accountRemoveClicks||0)+1;account.remove()});
    const saved=document.createElement('input');saved.type='file';const files=new DataTransfer();
    files.items.add(new File(['SYNTHETIC_ACCOUNT_FILE'],'account-file.txt',{type:'text/plain'}));saved.files=files.files;
    account.append(remove,saved);document.body.append(account);fixture.attachmentAdded=true;
  };
    window.fixtureReady=true;
  </script>`;
}

async function newPage(url) {
  const page = await context.newPage();
  await page.goto(url);
  return page;
}
async function launchBrowser() {
  // Prevent Playwright's own CDP session from enabling focus emulation. A false
  // override sent by another session cannot release the original capture handle.
  browserProcess = spawn(process.env.FULL_CHROMIUM_PATH || playwright.chromium.executablePath(), [
    '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-extensions-with-background-pages',
    '--disable-default-apps', '--disable-dev-shm-usage', '--window-size=1200,1000',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, `--disable-extensions-except=${root}`, `--load-extension=${root}`,
    ...headed ? [] : ['--headless=new'], 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Isolated Chrome startup timed out')), 15000);
    let stderr = '';
    browserProcess.stderr.on('data', chunk => {
      stderr = (stderr + chunk).slice(-8000);
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    browserProcess.once('error', error => { clearTimeout(timeout); reject(error); });
    browserProcess.once('exit', code => { clearTimeout(timeout); reject(new Error(`Isolated Chrome exited (${code}) before connecting`)); });
  });
  browser = await playwright.chromium.connectOverCDP(endpoint, { noDefaults: true });
  return browser.contexts()[0];
}
async function closeBrowser() {
  const child = browserProcess;
  if (!child) return;
  if (!child.pid) { browserProcess = null; return; }
  const exited = new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', resolve);
  });
  // Let Browser.close finish saving the profile and exiting normally.
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  if (browser?.isConnected()) {
    const session = await browser.newBrowserCDPSession();
    await session.send('Browser.close').catch(() => {});
    await browser.close().catch(() => {});
  } else if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await exited; clearTimeout(timeout);
  browser = null; browserProcess = null;
}
const call = message => control.evaluate(message => chrome.runtime.sendMessage(message), message);
async function start(page, config = {}) {
  const tab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url), page.url());
  const result = await call({ type: 'START', tabId: tab.id, config: { prompt, ...config } });
  assert.equal(result.ok, true, result.error);
  return result;
}
async function scenario(name, callback) {
  const index = ++passed;
  if (selectedCases && !selectedCases.includes(index)) return;
  const page = await newPage('https://chatgpt.com/dots/pm-' + index);
  let timeout;
  try {
    await page.waitForFunction(() => window.fixtureReady);
    await Promise.race([callback(page), new Promise((_, reject) => {
      const timeoutMs = testRealDueAlarm && index === 6 ? 155000 : 60000;
      timeout = setTimeout(() => reject(new Error(`Synthetic browser scenario exceeded ${timeoutMs}ms`)), timeoutMs);
    })]);
    console.log('PASS ' + name);
  } catch (error) {
    console.log('SYNTHETIC FAILURE STATE ' + JSON.stringify({ fixture: await inspect(page), job: (await call({ type: 'GET_STATE' })).job }));
    throw error;
  } finally {
    clearTimeout(timeout);
    await call({ type: 'PAUSE' });
    // An unreachable page cannot acknowledge Pause. The next independent case
    // must wait out its real submission permit, never erase that safety fence.
    const fence = (await call({ type: 'GET_STATE' })).job?.submissionFenceUntil;
    if (Number.isFinite(fence) && fence > Date.now())
      await new Promise(resolve => setTimeout(resolve, fence - Date.now() + 30));
    await page.close();
  }
}
const inspect = page => page.evaluate(() => ({ ...fixture, editorEmpty: !pm.dom.innerText.trim(), visibility: document.visibilityState }));

async function mutateBeforeFinalAuthorization(mutation) {
  await worker.evaluate(mutation => {
    globalThis.originalExecuteScript = chrome.scripting.executeScript;
    globalThis.originalTabsSendMessage = chrome.tabs.sendMessage;
    globalThis.finalAuthorizationProbe = { admissions: [], commits: [], grants: 0, mutated: false };
    chrome.scripting.executeScript = async request => {
      const sending = request.func.name === 'pageAction' && request.args[0].mode === 'send';
      let admission;
      if (sending) {
        admission = { runId: request.args[0].runId, persistentDelivery: request.args[0].persistentDelivery };
        finalAuthorizationProbe.admissions.push(admission);
      }
      const frames = await originalExecuteScript(request);
      if (admission) admission.result = frames.find(frame => frame.frameId === 0)?.result;
      if (request.func.name === 'editorCommit' && request.args[0].phase === 'commit')
        finalAuthorizationProbe.commits.push(frames.find(frame => frame.frameId === 0)?.result);
      return frames;
    };
    chrome.tabs.sendMessage = async (tabId, message, options) => {
      if (message.type === 'GRANT_RUN') {
        finalAuthorizationProbe.grants++;
        if (!finalAuthorizationProbe.mutated) {
          await originalExecuteScript({ target: { tabId, ...(options?.documentId ? { documentIds: [options.documentId] } : {}) },
            world: 'MAIN', func: mutation => {
              if (mutation === 'remount') window.fixtureRemountComposer();
              else window.fixtureAddAttachment(mutation === 'removable-attachment');
            }, args: [mutation] });
          finalAuthorizationProbe.mutated = true;
        }
      }
      return originalTabsSendMessage(tabId, message, options);
    };
  }, mutation);
}

async function restoreFinalAuthorizationMutation() {
  await worker.evaluate(() => {
    chrome.scripting.executeScript = originalExecuteScript;
    chrome.tabs.sendMessage = originalTabsSendMessage;
    delete globalThis.originalExecuteScript;
    delete globalThis.originalTabsSendMessage;
    delete globalThis.finalAuthorizationProbe;
  });
}

try {
  context = await launchBrowser();
  await context.route('https://**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'chatgpt.com' && modules.has(url.pathname)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: modules.get(url.pathname) });
    if (url.hostname === 'chatgpt.com' && url.pathname.startsWith('/dots/pm-')) {
      const index = Number(url.pathname.split('-').at(-1));
      return route.fulfill({ status: 200, contentType: 'text/html', body: fixture({
        noSend: index === 3, rejectSynthetic: [4, 6, 8, 9, 10].includes(index),
        supported: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56].includes(index),
        sendActivationDelayMs: index === 40 ? 2000 : index === 25 ? 2500 : [11, 16].includes(index) ? 21000 : [17, 20, 21].includes(index) ? 200 : [6, 8, 9, 10, 12, 13, 14, 15].includes(index) ? 100 : 0,
        receiptDelayMs: index === 18 ? 8000 : [28, 48, 49, 50, 51, 52, 56, 57].includes(index) ? 800 : index === 29 ? 5000 : 0,
        manualReceiptDuringReadiness: index === 9 || index === 10, ignoreButtonSubmit: index === 9,
        recurringRestore: index === 7,
        holdSendDisabled: [33, 48, 49, 50, 51, 52, 56, 57].includes(index),
        fullForm: [36, 37, 38, 39, 40, 41].includes(index),
      }) });
    }
    if (url.hostname === 'pm-foreground.invalid') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><textarea id="work">Unrelated synthetic document</textarea>' });
    return route.abort();
  });
  worker = context.serviceWorkers().find(item => item.url().endsWith('/background.js'))
    || await context.waitForEvent('serviceworker', { predicate: item => item.url().endsWith('/background.js'), timeout: 15000 });
  const id = new URL(worker.url()).host;
  control = await newPage(`chrome-extension://${id}/popup.html?view=full`);
  await control.waitForFunction(() => !document.querySelector('#check').disabled);

  await scenario('Official ProseMirror authorized model commit sends one Ctrl+Enter, with no Send click', async page => {
    await start(page, { sendMethod: 'ctrl-enter' });
    const sent = await call({ type: 'SEND_NOW' });
    assert.equal(sent.ok, true, sent.error);
    assert.equal(sent.job.sentCount, 1, sent.job.statusText);
    const observed = await inspect(page);
    assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [1, 0, 1]);
    assert.deepEqual(observed.sentTexts, [prompt]);
    assert.equal(observed.editorEmpty, true);
    assert.deepEqual(observed.events.filter(event => event.key === 'Enter').map(event => [event.type, event.keyCode, event.ctrlKey, event.trusted]), [['keydown', 13, true, false], ['keyup', 13, true, false]]);
  });
  await scenario('Official ProseMirror explicitly selected button method submits once without keyboard fallback', async page => {
    await start(page, { sendMethod: 'button' });
    const sent = await call({ type: 'SEND_NOW' });
    assert.equal(sent.job.sentCount, 1, sent.job.statusText);
    const observed = await inspect(page);
    assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
    assert.deepEqual(observed.sentTexts, [prompt]);
  });
  await scenario('Official ProseMirror keyboard submission does not require a Send button', async page => {
    assert.equal(await page.locator('button[aria-label="Send"]').count(), 0);
    await start(page);
    const sent = await call({ type: 'SEND_NOW' });
    assert.equal(sent.job.sentCount, 1, sent.job.statusText);
    const observed = await inspect(page);
    assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [1, 0, 1]);
  });
  await scenario('A trusted-event-only keymap remains unconfirmed without replaying through Send', async page => {
    await start(page, { sendMethod: 'ctrl-enter' });
    const sending = call({ type: 'SEND_NOW' });
    await page.waitForFunction(() => fixture.keyboardCommands === 1);
    assert.equal((await call({ type: 'GET_STATE' })).job.phase, 'sending');
    assert.equal((await call({ type: 'GET_STATE' })).job.sentCount, 0);
    await call({ type: 'PAUSE' });
    const sent = await sending;
    assert.equal(sent.job.enabled, false);
    assert.equal(sent.job.sentCount, 0);
    const observed = await inspect(page);
    assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [1, 0, 0]);
    assert.equal(observed.editorEmpty, false);
  });
  await scenario('An actually hidden ProseMirror tab receives Ctrl+Enter while foreground text, selection and active tab stay unchanged', async page => {
      await start(page, { sendMethod: 'ctrl-enter' });
      const foreground = await newPage('https://pm-foreground.invalid/work');
      try {
        await foreground.bringToFront();
        await foreground.locator('#work').focus();
        await foreground.locator('#work').evaluate(input => input.setSelectionRange(3, 8));
        const getForeground = () => foreground.evaluate(() => ({ text: document.querySelector('#work').value, start: document.querySelector('#work').selectionStart, end: document.querySelector('#work').selectionEnd, focused: document.activeElement.id, documentFocused: document.hasFocus() }));
        const before = await getForeground();
        const foregroundTab = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]);
        const activeBefore = foregroundTab.id;
        const targetTab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url), page.url());
        assert.equal(targetTab.windowId, foregroundTab.windowId, 'Target and foreground must be tabs of the same browser window');
        assert.equal(targetTab.active, false);
        await page.waitForFunction(() => document.visibilityState === 'hidden', null, { polling: 50, timeout: 3000 });
        assert.equal(await page.evaluate(() => document.visibilityState), 'hidden', 'This assertion must not be emulated by redefining visibility properties');
        assert.equal(await page.evaluate(() => document.hasFocus()), false);
        const sent = await call({ type: 'SEND_NOW' });
        assert.equal(sent.job.sentCount, 1, sent.job.statusText);
        const observed = await inspect(page);
        assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [1, 0, 1]);
        assert.equal(observed.visibility, 'hidden');
        assert.deepEqual(await getForeground(), before);
        assert.equal(await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id), activeBefore);
      } finally { await foreground.close(); }
  });
  await scenario('A real background alarm waits for delayed ProseMirror Send in Auto without activating the hidden target, then respects Pause', async page => {
    const foreground = await newPage('https://pm-foreground.invalid/delayed-send');
    try {
      await foreground.bringToFront();
      await foreground.locator('#work').focus();
      await foreground.locator('#work').evaluate(input => input.setSelectionRange(3, 8));
      const getForeground = () => foreground.evaluate(() => {
        const input = document.querySelector('#work');
        return { text: input.value, start: input.selectionStart, end: input.selectionEnd,
          focused: document.activeElement.id, documentFocused: document.hasFocus() };
      });
      const before = await getForeground();
      assert.equal(before.documentFocused, true);
      const foregroundTab = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]);
      const targetTab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url), page.url());
      assert.equal(targetTab.windowId, foregroundTab.windowId);
      assert.equal(targetTab.active, false);
      await page.waitForFunction(() => document.hidden && !document.hasFocus(), null, { polling: 50, timeout: 3000 });
      assert.equal(await page.evaluate(() => pm.dom.editor.view === pm), true, 'Use the supported Tiptap-compatible owner, not the legacy event adapter');
      assert.equal(await page.locator('button[aria-label="Send"]').isDisabled(), true);
      await page.evaluate(() => {
        fixture.visibilityChanges = []; fixture.windowFocusEvents = [];
        document.addEventListener('visibilitychange', () => fixture.visibilityChanges.push(document.visibilityState));
        window.addEventListener('focus', () => fixture.windowFocusEvents.push('focus'));
      });
      await foreground.evaluate(() => {
        window.foregroundFocusEvents = [];
        window.addEventListener('blur', () => foregroundFocusEvents.push('window-blur'));
        document.addEventListener('focusout', () => foregroundFocusEvents.push('focusout'));
      });
      await worker.evaluate(() => {
        globalThis.pmBackgroundFocus = { activations: [], windowChanges: [] };
        globalThis.pmOnActivated = info => pmBackgroundFocus.activations.push(info.tabId);
        globalThis.pmOnWindowFocus = id => pmBackgroundFocus.windowChanges.push(id);
        chrome.tabs.onActivated.addListener(pmOnActivated);
        chrome.windows.onFocusChanged.addListener(pmOnWindowFocus);
      });
      const started = await start(page, { sendMethod: 'auto', intervalMinutes: 1, maxSends: 0, startImmediately: false });
      assert.equal(started.job.sentCount, 0);
      assert.equal(started.job.enabled, true);
      const heartbeat = await worker.evaluate(() => chrome.alarms.get('agent-continue-heartbeat'));
      assert.equal(heartbeat.periodInMinutes, 1);
      assert.ok(heartbeat.scheduledTime >= started.job.nextAt);
      assert.equal((await inspect(page)).updates, 0, 'Start must not prepare or submit before the alarm');
      if (!testRealDueAlarm) {
        // Expedite only this throwaway job; Chromium still delivers the real onAlarm event.
        await worker.evaluate(async () => {
          const { job } = await chrome.storage.session.get('job');
          await chrome.storage.session.set({ job: { ...job, nextAt: Date.now() } });
          await chrome.alarms.create('agent-continue-heartbeat', { when: Date.now() + 100, periodInMinutes: 1 });
        });
      }
      console.log(testRealDueAlarm
        ? 'WAIT Natural one-minute Chromium alarm for hidden delayed Send (no SEND_NOW).'
        : 'WAIT Expedited real Chromium alarm for hidden delayed Send (no SEND_NOW).');
      await control.evaluate(({ id, timeoutMs }) => new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timeout); chrome.storage.onChanged.removeListener(onChange); };
        const inspect = job => {
          if (job?.id !== id || job.phase !== 'idle' || !job.lastRunAt) return;
          cleanup(); resolve();
        };
        const onChange = (changes, area) => { if (area === 'session') inspect(changes.job?.newValue); };
        const timeout = setTimeout(() => { cleanup(); reject(new Error('Background alarm did not finish the delayed-Send round')); }, timeoutMs);
        chrome.storage.onChanged.addListener(onChange);
        chrome.storage.session.get('job').then(({ job }) => inspect(job), error => { cleanup(); reject(error); });
      }), { id: started.job.id, timeoutMs: testRealDueAlarm ? 145000 : 20000 });
      const { job } = await call({ type: 'GET_STATE' });
      assert.equal(job.sentCount, 1, job.statusText);
      assert.equal(job.lastResult, 'sent', job.statusText);
      assert.equal(job.unknownCount, 0);
      assert.equal(job.enabled, true, 'Manual Pause, not a send limit, must stop this job');
      assert.equal(job.prompt, prompt);
      assert.equal(job.editorCommitRunId, job.runId, 'The real COMMIT_RUN path must own this send');
      if (testRealDueAlarm) assert.ok(job.lastRunAt >= started.job.nextAt, 'Do not advance the natural due time');
      const observed = await inspect(page);
      assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
      assert.deepEqual(observed.sentTexts, [prompt]);
      assert.deepEqual(observed.events, [], 'No synthetic keyboard fallback, including keypress');
      assert.equal(observed.editorEmpty, true);
      assert.equal(observed.sendActivationDelayMs, 100);
      assert.deepEqual(observed.modelUpdates.filter(update => update.docChanged).map(update => update.text), [prompt, ''], 'Only prepare and the successful submission may change the document; PM selection transactions are not content writes');
      assert.ok(observed.modelUpdates.every(update => update.hidden && !update.focused));
      assert.equal(observed.sendActivations.length, 1);
      assert.ok(observed.sendActivations[0].elapsedMs >= 95, 'Send must not activate synchronously with the model transaction');
      assert.deepEqual(observed.submissionStates, [{ method: 'button', hidden: true, focused: false, sendDisabled: false }]);
      assert.equal(observed.visibility, 'hidden');
      assert.deepEqual(observed.visibilityChanges, []);
      assert.deepEqual(observed.windowFocusEvents, []);
      assert.deepEqual(await getForeground(), before);
      assert.deepEqual(await foreground.evaluate(() => foregroundFocusEvents), []);
      assert.deepEqual(await worker.evaluate(() => pmBackgroundFocus), { activations: [], windowChanges: [] });
      assert.equal(await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id), foregroundTab.id);

      const paused = await call({ type: 'PAUSE' });
      assert.equal(paused.ok, true, paused.error);
      assert.equal(paused.job.enabled, false);
      assert.equal(paused.job.sentCount, 1);
      assert.equal(await worker.evaluate(() => chrome.alarms.get('agent-continue-heartbeat')), undefined);
      assert.equal((await call({ type: 'SEND_NOW' })).ok, false, 'Pause must reject further extension-control sends');
      // A stale/queued real heartbeat must also observe Pause, not just the UI command.
      await worker.evaluate(async () => {
        let listener;
        let timeout;
        const delivered = new Promise((resolve, reject) => {
          listener = alarm => { if (alarm.name === 'agent-continue-heartbeat') resolve(); };
          chrome.alarms.onAlarm.addListener(listener);
          timeout = setTimeout(() => reject(new Error('Post-Pause heartbeat was not delivered')), 10000);
        });
        try {
          await chrome.alarms.create('agent-continue-heartbeat', { when: Date.now() + 100, periodInMinutes: 1 });
          await delivered;
          const deadline = Date.now() + 5000;
          while (await chrome.alarms.get('agent-continue-heartbeat')) {
            if (Date.now() >= deadline) throw new Error('Paused scheduler did not clear the stale heartbeat');
            await new Promise(resolve => setTimeout(resolve, 20));
          }
        } finally {
          clearTimeout(timeout);
          chrome.alarms.onAlarm.removeListener(listener);
        }
      });
      assert.equal((await call({ type: 'GET_STATE' })).job.sentCount, 1);
      assert.deepEqual(await inspect(page), observed, 'A paused heartbeat must not prepare, dispatch, or submit again');
      assert.deepEqual(await getForeground(), before);
      assert.deepEqual(await foreground.evaluate(() => foregroundFocusEvents), []);
      assert.deepEqual(await worker.evaluate(() => pmBackgroundFocus), { activations: [], windowChanges: [] });
    } finally {
      await worker.evaluate(() => {
        if (globalThis.pmOnActivated) chrome.tabs.onActivated.removeListener(pmOnActivated);
        if (globalThis.pmOnWindowFocus) chrome.windows.onFocusChanged.removeListener(pmOnWindowFocus);
        delete globalThis.pmOnActivated; delete globalThis.pmOnWindowFocus; delete globalThis.pmBackgroundFocus;
      });
      await foreground.close();
    }
  });
  await scenario('Recurring official ProseMirror model restores cannot starve or alter one authorized submission', async page => {
    await start(page, { sendMethod: 'button' });
    const sent = await call({ type: 'SEND_NOW' });
    assert.equal(sent.job.sentCount, 1, sent.job.statusText);
    const observed = await inspect(page);
    assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
    assert.deepEqual(observed.sentTexts, [prompt]);
    assert.equal(observed.restores, 1, 'A real model restore ran after the single input');
    assert.equal(await worker.evaluate(async () => (await chrome.storage.session.get('job')).job.editorCommitRunId != null), true);
  });
  await scenario('A prompt above the retired 100000-character cap traverses the actual hidden MV3 model path intact', async page => {
    const largePrompt = '  \t' + 'LONG_LITERAL_\u4e2d\u6587_\ud83d\ude80\n'.repeat(10000) + '\n  ';
    assert.ok(largePrompt.length > 100000);
    const foreground = await newPage('https://pm-foreground.invalid/large-prompt');
    try {
      await foreground.bringToFront();
      await foreground.locator('#work').focus();
      await page.waitForFunction(() => document.visibilityState === 'hidden');
      await start(page, { prompt: largePrompt, sendMethod: 'auto' });
      const sent = await call({ type: 'SEND_NOW' });
      assert.equal(sent.ok, true, sent.error);
      assert.equal(sent.job.sentCount, 1, sent.job.statusText);
      assert.equal(sent.job.prompt, largePrompt);
      const observed = await inspect(page);
      assert.deepEqual(observed.sentTexts, [largePrompt]);
      assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
      assert.deepEqual(observed.events, []);
      assert.equal(observed.visibility, 'hidden');
      assert.equal(await foreground.locator('#work').inputValue(), 'Unrelated synthetic document');
      assert.equal(await foreground.evaluate(() => document.hasFocus()), true);
    } finally { await foreground.close(); }
  });
  for (const accepted of [false, true]) {
    await scenario(accepted
      ? 'The cross-world dispatch boundary counts only the actual submission after a matching readiness-time message'
      : 'A matching readiness-time message cannot confirm an ignored button in a real MV3 isolated world', async page => {
      const foreground = await newPage('https://pm-foreground.invalid/receipt-boundary');
      try {
        await foreground.bringToFront();
        await foreground.locator('#work').focus();
        await page.waitForFunction(() => document.hidden && !document.hasFocus());
        await start(page, { sendMethod: 'auto' });
        const sending = call({ type: 'SEND_NOW' });
        if (!accepted) {
          await page.waitForFunction(() => fixture.buttonClicks === 1, null, { polling: 100 });
          const waiting = (await call({ type: 'GET_STATE' })).job;
          assert.equal(waiting.phase, 'sending');
          assert.equal(waiting.sentCount, 0);
          await call({ type: 'PAUSE' });
        }
        const sent = await sending;
        assert.equal(sent.ok, true, sent.error);
        assert.equal(sent.job.sentCount, accepted ? 1 : 0, sent.job.statusText);
        if (accepted) assert.equal(sent.job.lastResult, 'sent');
        else assert.equal(sent.job.enabled, false);
        const observed = await inspect(page);
        assert.deepEqual(observed.manualReceipt, { text: prompt, hidden: true });
        assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, accepted ? 1 : 0]);
        assert.equal(observed.editorEmpty, accepted);
        assert.equal(await page.locator('article.message-row.self').count(), accepted ? 2 : 1);
        assert.equal(await foreground.evaluate(() => document.hasFocus()), true);
      } finally { await foreground.close(); }
    });
  }
  await scenario('An active hidden model send survives more than twenty seconds of framework readiness without a second submission', async page => {
    const foreground = await newPage('https://pm-foreground.invalid/slow-readiness');
    try {
      await foreground.bringToFront();
      await foreground.locator('#work').focus();
      await page.waitForFunction(() => document.hidden && !document.hasFocus());
      await start(page, { sendMethod: 'auto' });
      const sent = await call({ type: 'SEND_NOW' });
      assert.equal(sent.job.sentCount, 1, sent.job.statusText);
      assert.equal(sent.job.lastResult, 'sent');
      const observed = await inspect(page);
      assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
      assert.deepEqual(observed.sentTexts, [prompt]);
      assert.ok(observed.sendActivations[0].elapsedMs >= 21000);
      assert.equal(observed.visibility, 'hidden');
      assert.equal(await foreground.locator('#work').inputValue(), 'Unrelated synthetic document');
      assert.equal(await foreground.evaluate(() => document.hasFocus()), true);
    } finally { await foreground.close(); }
  });
  await scenario('A lost executeScript return still records the same hidden submission once through the extension result channel', async page => {
    const foreground = await newPage('https://pm-foreground.invalid/lost-return');
    try {
      await foreground.bringToFront();
      await foreground.locator('#work').focus();
      await page.waitForFunction(() => document.hidden && !document.hasFocus());
      await start(page, { sendMethod: 'auto' });
      await worker.evaluate(() => {
        globalThis.originalExecuteScript = chrome.scripting.executeScript;
        globalThis.droppedSendReturns = 0;
        chrome.scripting.executeScript = async request => {
          const frames = await originalExecuteScript(request);
          if (request.func.name === 'pageAction' && request.args[0].mode === 'send') {
            droppedSendReturns++;
            return frames.map(frame => ({ frameId: frame.frameId }));
          }
          return frames;
        };
      });
      const sent = await call({ type: 'SEND_NOW' });
      assert.equal(sent.job.sentCount, 1, sent.job.statusText);
      assert.equal(sent.job.lastResult, 'sent');
      for (let i = 0; i < 20 && !await worker.evaluate(() => droppedSendReturns); i++) await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(await worker.evaluate(() => droppedSendReturns), 1, 'The injection return was actually removed');
      const observed = await inspect(page);
      assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
      assert.deepEqual(observed.sentTexts, [prompt]);
      assert.equal(observed.visibility, 'hidden');
      assert.equal(await foreground.evaluate(() => document.hasFocus()), true);
    } finally {
      await worker.evaluate(() => { chrome.scripting.executeScript = originalExecuteScript; delete globalThis.originalExecuteScript; });
      await foreground.close();
    }
  });
  await scenario('An injection API rejection before the page result still confirms one actual hidden submission', async page => {
    await start(page, { sendMethod: 'auto' });
    await worker.evaluate(() => {
      globalThis.originalExecuteScript = chrome.scripting.executeScript;
      globalThis.rejectedSendReturns = 0;
      chrome.scripting.executeScript = async request => {
        const execution = originalExecuteScript(request);
        if (request.func.name === 'pageAction' && request.args[0].mode === 'send') {
          execution.catch(() => undefined);
          rejectedSendReturns++;
          throw new Error('Synthetic injection transport rejection');
        }
        return execution;
      };
    });
    try {
      const sent = await call({ type: 'SEND_NOW' });
      assert.equal(sent.job.sentCount, 1, sent.job.statusText);
      assert.equal(await worker.evaluate(() => rejectedSendReturns), 1);
      const observed = await inspect(page);
      assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
      assert.deepEqual(observed.sentTexts, [prompt]);
    } finally { await worker.evaluate(() => { chrome.scripting.executeScript = originalExecuteScript; delete globalThis.originalExecuteScript; }); }
  });
  await scenario('Pause acknowledges page revocation before an already-queued final MAIN commit is released', async page => {
    await start(page, { sendMethod: 'auto' });
    await worker.evaluate(() => {
      globalThis.originalExecuteScript = chrome.scripting.executeScript;
      globalThis.releaseHeldCommit = null;
      chrome.scripting.executeScript = request => {
        if (request.func.name === 'editorCommit' && request.args[0].phase === 'commit') {
          return new Promise((resolve, reject) => {
            releaseHeldCommit = () => originalExecuteScript(request).then(frames => { resolve(frames); return frames; }, reject);
          });
        }
        return originalExecuteScript(request);
      };
    });
    const sending = call({ type: 'SEND_NOW' });
    try {
      for (let i = 0; i < 200 && !await worker.evaluate(() => !!releaseHeldCommit); i++) await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(await worker.evaluate(() => !!releaseHeldCommit), true);
      const paused = await call({ type: 'PAUSE' });
      assert.equal(paused.job.enabled, false);
      assert.equal(paused.job.submissionFenceUntil ?? null, null, 'The isolated page actually acknowledged revocation');
      const frames = await worker.evaluate(() => releaseHeldCommit());
      assert.equal(frames[0].result.dispatched, false);
      assert.equal((await sending).job.sentCount, 0);
      const observed = await inspect(page);
      assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 0, 0]);
    } finally {
      await worker.evaluate(() => { chrome.scripting.executeScript = originalExecuteScript; delete globalThis.originalExecuteScript; delete globalThis.releaseHeldCommit; });
      await sending;
    }
  });
  await scenario('A queued MAIN permit expiring before execution refreshes without ending the wait or repeating a submission', async page => {
    await start(page, { sendMethod: 'auto' });
    await worker.evaluate(() => {
      globalThis.originalExecuteScript = chrome.scripting.executeScript;
      globalThis.delayedCommitOnce = false;
      globalThis.expiredCommitResults = 0;
      chrome.scripting.executeScript = async request => {
        if (request.func.name === 'editorCommit' && request.args[0].phase === 'commit' && !delayedCommitOnce) {
          delayedCommitOnce = true;
          await new Promise(resolve => setTimeout(resolve, 21100));
          const frames = await originalExecuteScript(request);
          if (frames[0]?.result.code === 'expired' && frames[0].result.dispatched === false) expiredCommitResults++;
          return frames;
        }
        return originalExecuteScript(request);
      };
    });
    try {
      const sent = await call({ type: 'SEND_NOW' });
      assert.equal(sent.job.sentCount, 1, sent.job.statusText);
      assert.equal(await worker.evaluate(() => expiredCommitResults), 1);
      const observed = await inspect(page);
      assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
      assert.deepEqual(observed.sentTexts, [prompt]);
    } finally { await worker.evaluate(() => { chrome.scripting.executeScript = originalExecuteScript; delete globalThis.originalExecuteScript; }); }
  });
  await scenario('A single isolated permit-observer transport failure cannot strand a delayed Send', async page => {
    await start(page, { sendMethod: 'auto' });
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
    await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      let rejected = false;
      chrome.runtime.sendMessage = message => {
        if (!rejected && message.type === 'WAIT_RUN' && message.renew === false) {
          rejected = true;
          return Promise.reject(new Error('Synthetic one-off observer transport failure'));
        }
        return send(message);
      };
    } }), tabId);
    const sent = await call({ type: 'SEND_NOW' });
    assert.equal(sent.job.sentCount, 1, sent.job.statusText);
    const observed = await inspect(page);
    assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
    assert.deepEqual(observed.sentTexts, [prompt]);
  });
  await scenario('Legacy fallback waits for a known Send after final prompt correction rather than choosing keyboard', async page => {
    await page.evaluate(() => {
      document.addEventListener('fixture-late-change', () => {
        pm.dispatch(pm.state.tr.insertText('RESTORED_UNSENT_TEXT', 0, pm.state.doc.content.size));
        fixture.lateChanges = (fixture.lateChanges || 0) + 1;
      });
    });
    await start(page, { sendMethod: 'auto' });
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
    await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      let changed = false;
      chrome.runtime.sendMessage = async message => {
        const reply = await send(message);
        if (!changed && message.type === 'CHECK_RUN' && document.querySelector('[contenteditable]').textContent.includes('PM_SYNTHETIC_FIRST_PARAGRAPH')) {
          changed = true;
          document.dispatchEvent(new Event('fixture-late-change'));
        }
        return reply;
      };
    } }), tabId);
    const sent = await call({ type: 'SEND_NOW' });
    assert.equal(sent.job.sentCount, 1, sent.job.statusText);
    const observed = await inspect(page);
    assert.equal(observed.lateChanges, 1);
    assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
    assert.deepEqual(observed.sentTexts, [prompt]);
  });
  await scenario('A receipt arriving after the retired 6.5-second cutoff confirms exactly one submission', async page => {
    await start(page, { sendMethod: 'auto' });
    const sent = await call({ type: 'SEND_NOW' });
    assert.equal(sent.job.sentCount, 1, sent.job.statusText);
    const observed = await inspect(page);
    assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
    assert.deepEqual(observed.sentTexts, [prompt]);
  });
  await scenario('An unresponsive result-message channel cannot hold the independent injection result', async page => {
    await start(page, { sendMethod: 'auto' });
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
    await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = message => message.type === 'PAGE_RESULT' ? new Promise(() => {}) : send(message);
    } }), tabId);
    const sent = await call({ type: 'SEND_NOW' });
    assert.equal(sent.job.sentCount, 1, sent.job.statusText);
    const observed = await inspect(page);
    assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
  });
  for (const mutation of ['text', 'attachment']) {
    await scenario(`Legacy final readiness rechecks a late ${mutation} mutation before any click`, async page => {
      await page.evaluate(mutation => {
        document.addEventListener('fixture-late-change', () => {
          pm.dispatch(pm.state.tr.insertText('RESTORED_UNSENT_TEXT', 0, pm.state.doc.content.size));
          fixture.lateChanges = (fixture.lateChanges || 0) + 1;
        });
        document.addEventListener('fixture-wait-finished', () => {
          if (!fixture.lateChanges || fixture.finalMutation || !pm.state.doc.textContent.includes('PM_SYNTHETIC_FIRST_PARAGRAPH')) return;
          fixture.finalMutation = mutation;
          if (mutation === 'text') pm.dispatch(pm.state.tr.insertText('LATE_OTHER_TEXT', 0, pm.state.doc.content.size));
          else {
            const attachment = document.createElement('span');
            attachment.dataset.testid = 'attachment';
            attachment.textContent = 'Synthetic attachment';
            document.querySelector('[data-composer-body]').append(attachment);
          }
          document.querySelector('button[aria-label="Send"]').disabled = false;
        });
      }, mutation);
      await start(page, { sendMethod: 'auto' });
      const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
      await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
        const send = chrome.runtime.sendMessage.bind(chrome.runtime);
        let changed = false;
        chrome.runtime.sendMessage = async message => {
          const reply = await send(message);
          if (!changed && message.type === 'CHECK_RUN' && document.querySelector('[contenteditable]').textContent.includes('PM_SYNTHETIC_FIRST_PARAGRAPH')) {
            changed = true;
            document.dispatchEvent(new Event('fixture-late-change'));
          }
          if (message.type === 'WAIT_RUN' && message.delayMs === 150) document.dispatchEvent(new Event('fixture-wait-finished'));
          return reply;
        };
      } }), tabId);
      const sending = call({ type: 'SEND_NOW' });
      try {
        if (mutation === 'attachment') {
          await page.waitForFunction(() => fixture.finalMutation === 'attachment');
          const state = await Promise.race([sending.then(() => 'settled'), new Promise(resolve => setTimeout(() => resolve('waiting'), 2300))]);
          assert.equal(state, 'waiting', 'An unremovable chip must keep this send waiting for Pause');
          const waiting = await call({ type: 'GET_STATE' });
          assert.equal(waiting.job.enabled, true);
          assert.equal(waiting.job.sentCount, 0);
          assert.equal(waiting.job.unknownCount, 0);
          const paused = await call({ type: 'PAUSE' });
          assert.equal(paused.job.enabled, false);
        }
        const sent = await sending;
        const observed = await inspect(page);
        assert.equal(observed.finalMutation, mutation, 'The intended last-wait mutation actually occurred');
        assert.equal(sent.job.sentCount, mutation === 'text' ? 1 : 0, sent.job.statusText);
        assert.equal(sent.job.unknownCount, 0);
        assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, mutation === 'text' ? 1 : 0, mutation === 'text' ? 1 : 0]);
        assert.deepEqual(observed.sentTexts, mutation === 'text' ? [prompt] : []);
        if (mutation === 'attachment') assert.equal(await page.locator('[data-testid="attachment"]').count(), 1);
      } finally {
        await call({ type: 'PAUSE' });
        await sending;
      }
    });
  }
  await scenario('A rejection before page admission recovers the same hidden run and submits once', async page => {
    const foreground = await newPage('https://pm-foreground.invalid/admission-recovery');
    await foreground.bringToFront();
    await foreground.locator('#work').focus();
    await page.waitForFunction(() => document.hidden && !document.hasFocus());
    await start(page, { sendMethod: 'auto' });
    await worker.evaluate(() => {
      globalThis.originalExecuteScript = chrome.scripting.executeScript;
      globalThis.admissionAttempts = 0;
      globalThis.admissionTokens = [];
      chrome.scripting.executeScript = request => {
        if (request.func.name === 'pageAction' && request.args[0].mode === 'send') {
          admissionTokens.push(request.args[0].resultToken);
          if (++admissionAttempts === 1) return Promise.reject(new Error('Synthetic rejection before any page execution'));
        }
        return originalExecuteScript(request);
      };
    });
    const sending = call({ type: 'SEND_NOW' });
    try {
      const sent = await Promise.race([sending, new Promise(resolve => setTimeout(() => resolve(null), 6000))]);
      assert.ok(sent, 'An absent page invocation must recover without starting another round');
      assert.equal(sent.job.sentCount, 1, sent.job.statusText);
      assert.equal(await worker.evaluate(() => admissionAttempts), 2);
      assert.equal(await worker.evaluate(() => new Set(admissionTokens).size), 1);
      const observed = await inspect(page);
      assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
      assert.deepEqual(observed.sentTexts, [prompt]);
      assert.equal(observed.visibility, 'hidden');
      assert.equal(await foreground.evaluate(() => document.hasFocus()), true);
    } finally {
      await call({ type: 'PAUSE' });
      await sending;
      await worker.evaluate(() => { chrome.scripting.executeScript = originalExecuteScript; delete globalThis.originalExecuteScript; });
      await foreground.close();
    }
  });
  await scenario('A late first injection joins the recovered completed invocation without submitting again', async page => {
    await start(page, { sendMethod: 'auto' });
    await worker.evaluate(() => {
      globalThis.originalExecuteScript = chrome.scripting.executeScript;
      globalThis.releaseFirstAdmission = null;
      globalThis.admissionAttempts = 0;
      chrome.scripting.executeScript = request => {
        if (request.func.name === 'pageAction' && request.args[0].mode === 'send' && ++admissionAttempts === 1) {
          return new Promise((resolve, reject) => {
            releaseFirstAdmission = () => originalExecuteScript(request).then(frames => { resolve(frames); return frames; }, reject);
          });
        }
        return originalExecuteScript(request);
      };
    });
    const sending = call({ type: 'SEND_NOW' });
    try {
      const sent = await Promise.race([sending, new Promise(resolve => setTimeout(() => resolve(null), 6000))]);
      assert.ok(sent, 'A queued initial injection must not strand an unadmitted run');
      assert.equal(sent.job.sentCount, 1, sent.job.statusText);
      const frames = await worker.evaluate(() => releaseFirstAdmission());
      assert.equal(frames[0].result.status, 'sent', 'The late request reads the same settled result');
      assert.equal(await worker.evaluate(() => admissionAttempts), 2);
      assert.equal((await inspect(page)).submits, 1);
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(() => { chrome.scripting.executeScript = originalExecuteScript; delete globalThis.originalExecuteScript; });
      await sending;
    }
  });
  await scenario('Losing both result transports reads back the settled page invocation instead of resubmitting', async page => {
    await start(page, { sendMethod: 'auto' });
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
    await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = message => message.type === 'PAGE_RESULT' ? new Promise(() => {}) : send(message);
    } }), tabId);
    await worker.evaluate(() => {
      globalThis.originalExecuteScript = chrome.scripting.executeScript;
      globalThis.admissionAttempts = 0;
      chrome.scripting.executeScript = async request => {
        const frames = await originalExecuteScript(request);
        if (request.func.name === 'pageAction' && request.args[0].mode === 'send') {
          admissionAttempts++;
          return frames.map(frame => ({ frameId: frame.frameId, documentId: frame.documentId }));
        }
        return frames;
      };
    });
    const sending = call({ type: 'SEND_NOW' });
    try {
      const sent = await Promise.race([sending, new Promise(resolve => setTimeout(() => resolve(null), 6000))]);
      assert.ok(sent, 'A durable page result must remain observable when both return transports lose it');
      assert.equal(sent.job.sentCount, 1, sent.job.statusText);
      assert.equal(await worker.evaluate(() => admissionAttempts), 1);
      assert.equal((await inspect(page)).submits, 1);
    } finally {
      await call({ type: 'PAUSE' });
      await sending;
      await worker.evaluate(() => { chrome.scripting.executeScript = originalExecuteScript; delete globalThis.originalExecuteScript; });
    }
  });
  await scenario('Concurrent duplicate page admissions share one active execution and one submission', async page => {
    await start(page, { sendMethod: 'auto' });
    await worker.evaluate(() => {
      globalThis.originalExecuteScript = chrome.scripting.executeScript;
      globalThis.currentAdmission = null;
      chrome.scripting.executeScript = request => {
        if (request.func.name === 'pageAction' && request.args[0].mode === 'send') currentAdmission = request;
        return originalExecuteScript(request);
      };
    });
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => fixture.modelUpdates.some(update => update.docChanged));
      const duplicates = worker.evaluate(() => Promise.all([
        originalExecuteScript(currentAdmission), originalExecuteScript(currentAdmission),
      ]));
      const sent = await sending;
      assert.equal(sent.job.sentCount, 1, sent.job.statusText);
      const frames = await duplicates;
      assert.deepEqual(frames.map(result => result[0].result.status), ['sent', 'sent']);
      assert.deepEqual((await inspect(page)).sentTexts, [prompt]);
    } finally {
      await call({ type: 'PAUSE' });
      await sending;
      await worker.evaluate(() => { chrome.scripting.executeScript = originalExecuteScript; delete globalThis.originalExecuteScript; });
    }
  });
  await scenario('Pause before page admission cancels all later recovery attempts', async page => {
    await start(page, { sendMethod: 'auto' });
    await worker.evaluate(() => {
      globalThis.originalExecuteScript = chrome.scripting.executeScript;
      globalThis.admissionAttempts = 0;
      chrome.scripting.executeScript = request => {
        if (request.func.name === 'pageAction' && request.args[0].mode === 'send') {
          admissionAttempts++;
          return Promise.reject(new Error('Synthetic renderer temporarily unavailable'));
        }
        return originalExecuteScript(request);
      };
    });
    const sending = call({ type: 'SEND_NOW' });
    try {
      for (let i = 0; i < 100 && !await worker.evaluate(() => admissionAttempts); i++) await new Promise(resolve => setTimeout(resolve, 20));
      const paused = await call({ type: 'PAUSE' });
      assert.equal(paused.job.enabled, false);
      const attemptsAfterPause = await worker.evaluate(() => admissionAttempts);
      await sending;
      await new Promise(resolve => setTimeout(resolve, 2200));
      assert.equal(await worker.evaluate(() => admissionAttempts), attemptsAfterPause);
      assert.equal((await inspect(page)).submits, 0);
      // No page listener acknowledged this pre-admission cancellation. Preserve
      // the real finite permit fence instead of letting the next case clear it.
      const fence = (await call({ type: 'GET_STATE' })).job.submissionFenceUntil;
      if (Number.isFinite(fence) && fence > Date.now()) await new Promise(resolve => setTimeout(resolve, fence - Date.now() + 30));
    } finally { await worker.evaluate(() => { chrome.scripting.executeScript = originalExecuteScript; delete globalThis.originalExecuteScript; }); }
  });
  await scenario('An unreachable renderer keeps at most one recovery admission outstanding and Pause fences late arrivals', async page => {
    await start(page, { sendMethod: 'auto' });
    await worker.evaluate(() => {
      globalThis.originalExecuteScript = chrome.scripting.executeScript;
      globalThis.heldAdmissions = [];
      chrome.scripting.executeScript = request => {
        if (request.func.name === 'pageAction' && request.args[0].mode === 'send') {
          return new Promise((resolve, reject) => {
            heldAdmissions.push(() => originalExecuteScript(request).then(frames => { resolve(frames); return frames; }, reject));
          });
        }
        return originalExecuteScript(request);
      };
    });
    const sending = call({ type: 'SEND_NOW' });
    try {
      await new Promise(resolve => setTimeout(resolve, 6500));
      assert.equal(await worker.evaluate(() => heldAdmissions.length), 2,
        'The initial request and a single recovery request must not grow every probe');
      assert.equal((await call({ type: 'GET_STATE' })).job.phase, 'sending');
      await call({ type: 'PAUSE' });
      const frames = await worker.evaluate(() => Promise.all(heldAdmissions.map(release => release())));
      assert.deepEqual(frames.map(result => result[0].result.status), ['cancelled', 'cancelled']);
      assert.equal((await sending).job.sentCount, 0);
      assert.equal((await inspect(page)).submits, 0);
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(() => { chrome.scripting.executeScript = originalExecuteScript; delete globalThis.originalExecuteScript; });
      await sending;
    }
  });
  await scenario('A transient wait-message failure after dispatch still counts one delayed receipt without resubmitting', async page => {
    await start(page, { sendMethod: 'auto' });
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
    await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      let rejected = false;
      chrome.runtime.sendMessage = message => {
        if (message.type === 'WAIT_RUN' && document.documentElement.dataset.fixtureSubmitted && !rejected) {
          rejected = true;
          document.documentElement.dataset.fixtureWaitRejected = 'true';
          return Promise.reject(new Error('Synthetic temporary wait transport failure'));
        }
        return send(message);
      };
    } }), tabId);
    const sent = await call({ type: 'SEND_NOW' });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.fixtureWaitRejected), 'true');
    assert.equal(sent.job.sentCount, 1, sent.job.statusText);
    assert.equal(sent.job.unknownCount, 0);
    const observed = await inspect(page);
    assert.deepEqual([observed.buttonClicks, observed.submits], [1, 1]);
    assert.deepEqual(observed.sentTexts, [prompt]);
  });
  await scenario('Pause still cancels receipt recovery while the wait transport remains unavailable', async page => {
    await start(page, { sendMethod: 'auto' });
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
    await worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = message => {
        if (message.type === 'WAIT_RUN' && document.documentElement.dataset.fixtureSubmitted) {
          document.documentElement.dataset.fixtureWaitRejected = 'true';
          return Promise.reject(new Error('Synthetic persistent wait transport failure'));
        }
        return send(message);
      };
    } }), tabId);
    const sending = call({ type: 'SEND_NOW' });
    await page.waitForFunction(() => document.documentElement.dataset.fixtureWaitRejected === 'true');
    const paused = await call({ type: 'PAUSE' });
    assert.equal(paused.job.enabled, false);
    await sending;
    const current = await call({ type: 'GET_STATE' });
    assert.equal(current.job.enabled, false);
    assert.equal(current.job.sentCount, 0);
    assert.deepEqual([(await inspect(page)).buttonClicks, (await inspect(page)).submits], [1, 1]);
  });
  await scenario('A lost prepare response retries preparation without stranding the filled composer or duplicating submission', async page => {
    await start(page, { sendMethod: 'auto' });
    await worker.evaluate(() => {
      globalThis.originalExecuteScript = chrome.scripting.executeScript;
      globalThis.prepareResponseLost = false;
      chrome.scripting.executeScript = async request => {
        const frames = await originalExecuteScript(request);
        if (request.func.name === 'editorCommit' && request.args[0].phase === 'prepare' && !prepareResponseLost) {
          prepareResponseLost = true;
          throw new Error('Synthetic lost prepare response');
        }
        return frames;
      };
    });
    try {
      const sent = await call({ type: 'SEND_NOW' });
      assert.equal(await worker.evaluate(() => prepareResponseLost), true);
      assert.equal(sent.job.sentCount, 1, sent.job.statusText);
      assert.equal(sent.job.unknownCount, 0);
      const observed = await inspect(page);
      assert.deepEqual([observed.buttonClicks, observed.submits], [1, 1]);
      assert.deepEqual(observed.sentTexts, [prompt]);
    } finally {
      await worker.evaluate(() => { chrome.scripting.executeScript = originalExecuteScript; delete globalThis.originalExecuteScript; });
    }
  });
  await scenario('Pause cancels persistent prepare transport failure without submitting or replaying a commit', async page => {
    await start(page, { sendMethod: 'auto' });
    await worker.evaluate(() => {
      globalThis.originalExecuteScript = chrome.scripting.executeScript;
      globalThis.prepareFailures = 0;
      chrome.scripting.executeScript = async request => {
        if (request.func.name === 'editorCommit' && request.args[0].phase === 'prepare') {
          prepareFailures++;
          throw new Error('Synthetic unavailable prepare transport');
        }
        return originalExecuteScript(request);
      };
    });
    const sending = call({ type: 'SEND_NOW' });
    try {
      const observationDeadline = Date.now() + 5000;
      while (await worker.evaluate(() => prepareFailures) < 2 && Date.now() < observationDeadline)
        await new Promise(resolve => setTimeout(resolve, 25));
      assert.ok(await worker.evaluate(() => prepareFailures >= 2));
      await call({ type: 'PAUSE' });
      await sending;
      const state = await call({ type: 'GET_STATE' });
      assert.equal(state.job.enabled, false);
      assert.equal(state.job.sentCount, 0);
      assert.deepEqual([(await inspect(page)).buttonClicks, (await inspect(page)).submits], [0, 0]);
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(() => { chrome.scripting.executeScript = originalExecuteScript; delete globalThis.originalExecuteScript; });
      await sending;
    }
  });
  await scenario('Missing prepare and observe results recover within the same one-submit reservation', async page => {
    await start(page, { sendMethod: 'auto' });
    await worker.evaluate(() => {
      globalThis.originalExecuteScript = chrome.scripting.executeScript;
      globalThis.missingPhases = [];
      chrome.scripting.executeScript = async request => {
        const frames = await originalExecuteScript(request);
        const phase = request.args?.[0]?.phase;
        if (request.func.name === 'editorCommit' && ['prepare','observe'].includes(phase) && !missingPhases.includes(phase)) {
          missingPhases.push(phase);
          return [];
        }
        return frames;
      };
    });
    try {
      const sent = await call({ type: 'SEND_NOW' });
      assert.deepEqual(await worker.evaluate(() => missingPhases), ['prepare','observe']);
      assert.equal(sent.job.sentCount, 1, sent.job.statusText);
      assert.equal(sent.job.unknownCount, 0);
      const observed = await inspect(page);
      assert.deepEqual([observed.buttonClicks, observed.submits], [1, 1]);
      assert.deepEqual(observed.sentTexts, [prompt]);
    } finally {
      await worker.evaluate(() => { chrome.scripting.executeScript = originalExecuteScript; delete globalThis.originalExecuteScript; });
    }
  });
  await scenario('A lost prepare response preserves disabled Send through unmount and reappearance without Auto keyboard fallback', async page => {
    await start(page, { sendMethod: 'auto' });
    await worker.evaluate(() => {
      globalThis.originalExecuteScript = chrome.scripting.executeScript;
      globalThis.stickyRecovery = { lost: false, sawDisabled: false, preparedHasSend: false, preparedUpdates: null,
        observations: 0, commits: 0, tokens: [] };
      chrome.scripting.executeScript = async request => {
        const frames = await originalExecuteScript(request);
        if (request.func.name !== 'editorCommit') return frames;
        const { phase, receiptBoundaryToken } = request.args[0];
        stickyRecovery.tokens.push(receiptBoundaryToken);
        if (phase === 'prepare' && !stickyRecovery.lost) {
          stickyRecovery.preparedHasSend = frames.find(frame => frame.frameId === 0)?.result?.hasSend === true;
          const detached = await originalExecuteScript({ target: request.target, world: 'MAIN', func: () => {
            const button = document.querySelector('button[aria-label="Send"]');
            const disabled = button?.disabled === true;
            window.fixtureDetachedSend = button;
            button.remove();
            fixture.sendUnmounted = true;
            return { disabled, updates: fixture.updates };
          } });
          const preparation = detached.find(frame => frame.frameId === 0)?.result;
          stickyRecovery.sawDisabled = preparation?.disabled === true;
          stickyRecovery.preparedUpdates = preparation?.updates;
          stickyRecovery.lost = true;
          throw new Error('Synthetic lost prepare response after disabled Send unmount');
        }
        if (phase === 'observe') stickyRecovery.observations++;
        if (phase === 'commit') stickyRecovery.commits++;
        return frames;
      };
    });
    const sending = call({ type: 'SEND_NOW' });
    try {
      const observationDeadline = Date.now() + 5000;
      let recovery;
      do {
        recovery = await worker.evaluate(() => ({ ...stickyRecovery }));
        if (recovery.observations >= 3 || recovery.commits > 0) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      } while (Date.now() < observationDeadline);
      assert.equal(recovery.lost, true);
      assert.equal(recovery.preparedHasSend, true, 'The discarded prepare result must have seen Send');
      assert.equal(recovery.sawDisabled, true, 'Send must still be disabled when unmounted');
      assert.ok(recovery.observations >= 3, 'Recovery must keep observing while the known Send is absent');
      assert.equal(recovery.commits, 0, 'No commit is allowed before Send reappears');
      const waiting = await inspect(page);
      assert.ok(Number.isInteger(recovery.preparedUpdates));
      assert.equal(waiting.updates, recovery.preparedUpdates,
        'Matching lost-prepare retries must not redispatch the model or reset delayed Send activation');
      assert.deepEqual([waiting.keyboardCommands, waiting.buttonClicks, waiting.submits], [0, 0, 0]);
      await page.evaluate(() => {
        document.querySelector('[data-composer-body]').append(window.fixtureDetachedSend);
        window.fixtureDetachedSend.disabled = false;
        fixture.sendReappeared = true;
      });
      const sent = await sending;
      assert.equal(sent.job.sentCount, 1, sent.job.statusText);
      assert.equal(sent.job.unknownCount, 0);
      const observed = await inspect(page);
      assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
      assert.deepEqual(observed.sentTexts, [prompt]);
      assert.equal(observed.editorEmpty, true);
      const tokens = await worker.evaluate(() => stickyRecovery.tokens);
      assert.equal(typeof tokens[0], 'string');
      assert.ok(tokens.every(token => token === tokens[0]), 'Every recovery phase must use the same receipt token');
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(() => {
        chrome.scripting.executeScript = originalExecuteScript;
        delete globalThis.originalExecuteScript;
        delete globalThis.stickyRecovery;
      });
      await sending;
    }
  });
  await scenario('A late prepare for an already committed receipt token neither refills the composer nor replaces a new draft or resubmits', async page => {
    await start(page, { sendMethod: 'auto' });
    await worker.evaluate(() => {
      globalThis.originalExecuteScript = chrome.scripting.executeScript;
      globalThis.latePrepareRequest = null;
      chrome.scripting.executeScript = async request => {
        if (request.func.name === 'editorCommit' && request.args[0].phase === 'prepare' && !latePrepareRequest)
          latePrepareRequest = request;
        return originalExecuteScript(request);
      };
    });
    try {
      const sent = await call({ type: 'SEND_NOW' });
      assert.equal(sent.job.sentCount, 1, sent.job.statusText);
      assert.equal(sent.job.unknownCount, 0);
      const before = await inspect(page);
      assert.equal(before.editorEmpty, true);
      assert.deepEqual([before.keyboardCommands, before.buttonClicks, before.submits], [0, 1, 1]);
      const releaseLatePrepare = () => worker.evaluate(async () => {
        if (!latePrepareRequest) throw new Error('Synthetic late prepare was not captured');
        const { receiptBoundaryToken, deadline } = latePrepareRequest.args[0];
        const remainingMs = deadline - Date.now();
        const frames = await originalExecuteScript(latePrepareRequest);
        return { receiptBoundaryToken, remainingMs, result: frames.find(frame => frame.frameId === 0)?.result };
      });
      const late = await releaseLatePrepare();
      assert.equal(typeof late.receiptBoundaryToken, 'string');
      assert.ok(late.remainingMs > 0, 'The seal, not an expired permit, must reject the late prepare');
      assert.notEqual(late.result?.code, 'expired');
      const after = await inspect(page);
      assert.equal(after.editorEmpty, true, 'A late prepare must not refill the confirmed empty composer');
      assert.equal(after.updates, before.updates, 'A sealed prepare must not dispatch a model transaction');
      const draft = 'PM_SYNTHETIC_NEW_DRAFT_AFTER_CONFIRMED_SEND';
      const draftUpdates = await page.evaluate(text => {
        pm.dispatch(pm.state.tr.insertText(text, 0, pm.state.doc.content.size));
        return fixture.updates;
      }, draft);
      const repeated = await releaseLatePrepare();
      assert.equal(repeated.receiptBoundaryToken, late.receiptBoundaryToken);
      assert.ok(repeated.remainingMs > 0);
      assert.notEqual(repeated.result?.code, 'expired');
      assert.equal(await page.evaluate(() => pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n')), draft,
        'A sealed prepare must leave a new intervening draft untouched');
      const observed = await inspect(page);
      assert.equal(observed.updates, draftUpdates);
      assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
      assert.deepEqual(observed.sentTexts, [prompt]);
      const current = await call({ type: 'GET_STATE' });
      assert.equal(current.job.sentCount, 1);
      assert.equal(current.job.unknownCount, 0);
    } finally {
      await worker.evaluate(() => {
        chrome.scripting.executeScript = originalExecuteScript;
        delete globalThis.originalExecuteScript;
        delete globalThis.latePrepareRequest;
      });
    }
  });
  await scenario('A same-URL reload during prepare automatically retries the same job on the fresh document once', async page => {
    const started = await start(page, { sendMethod: 'auto' });
    const expectedUrl = page.url();
    await worker.evaluate(() => {
      globalThis.originalExecuteScript = chrome.scripting.executeScript;
      globalThis.reloadRecovery = { prepared: false, phases: [] };
      chrome.scripting.executeScript = async request => {
        if (request.func.name !== 'editorCommit') return originalExecuteScript(request);
        const entry = { phase: request.args[0].phase, token: request.args[0].receiptBoundaryToken,
          targetDocumentId: request.target.documentIds?.[0] };
        reloadRecovery.phases.push(entry);
        const frames = await originalExecuteScript(request);
        entry.resultDocumentId = frames.find(frame => frame.frameId === 0)?.documentId;
        if (entry.phase === 'prepare' && !reloadRecovery.prepared) {
          reloadRecovery.prepared = true;
          return new Promise((_, reject) => {
            globalThis.rejectReloadedPrepare = () => reject(new Error('Synthetic prepare response lost during same-URL reload'));
          });
        }
        return frames;
      };
    });
    const sending = call({ type: 'SEND_NOW' });
    let completionTimer;
    try {
      const prepareDeadline = Date.now() + 5000;
      while (!await worker.evaluate(() => reloadRecovery.prepared) && Date.now() < prepareDeadline)
        await new Promise(resolve => setTimeout(resolve, 25));
      assert.equal(await worker.evaluate(() => reloadRecovery.prepared), true);
      const originalRunId = (await call({ type: 'GET_STATE' })).job.runId;
      const original = await worker.evaluate(() => reloadRecovery.phases[0]);
      assert.equal(typeof original.targetDocumentId, 'string');
      assert.equal(original.resultDocumentId, original.targetDocumentId);
      const beforeReload = await inspect(page);
      assert.equal(beforeReload.editorEmpty, false);
      assert.deepEqual([beforeReload.keyboardCommands, beforeReload.buttonClicks, beforeReload.submits], [0, 0, 0]);
      await page.reload();
      await page.waitForFunction(() => window.fixtureReady);
      assert.equal(page.url(), expectedUrl, 'Only the document, not the bound URL, must change');
      const fresh = await inspect(page);
      assert.equal(fresh.editorEmpty, true, 'The old pinned preparation must leave the new composer empty');
      assert.equal(fresh.updates, 0, 'The old pinned preparation must not mutate the new model');
      assert.deepEqual([fresh.keyboardCommands, fresh.buttonClicks, fresh.submits], [0, 0, 0]);
      assert.ok((await worker.evaluate(() => reloadRecovery.phases)).every(entry => entry.phase !== 'commit'),
        'The old pre-dispatch run must never enter commit');
      await worker.evaluate(() => { rejectReloadedPrepare(); delete globalThis.rejectReloadedPrepare; });
      const sent = await Promise.race([sending, new Promise((_, reject) => {
        completionTimer = setTimeout(() => reject(new Error('The same Send now did not recover automatically after same-URL replacement')), 10000);
      })]);
      clearTimeout(completionTimer);
      assert.equal(sent.job.id, started.job.id, 'Recovery must retain the existing job');
      assert.notEqual(sent.job.runId, originalRunId, 'The fresh document must be handled by a new round');
      assert.equal(sent.job.sentCount, 1, sent.job.statusText);
      assert.equal(sent.job.unknownCount, 0);
      const phases = await worker.evaluate(() => reloadRecovery.phases);
      const newPrepare = phases.find(entry => entry.phase === 'prepare' && entry.token !== original.token);
      assert.ok(newPrepare, 'A fresh round must obtain a new receipt token');
      assert.equal(typeof newPrepare.targetDocumentId, 'string');
      assert.notEqual(newPrepare.targetDocumentId, original.targetDocumentId);
      assert.equal(newPrepare.resultDocumentId, newPrepare.targetDocumentId);
      const commits = phases.filter(entry => entry.phase === 'commit');
      assert.equal(commits.length, 1, 'Only the new round may dispatch, exactly once');
      assert.notEqual(commits[0].token, original.token, 'No old-document reservation may commit');
      assert.equal(commits[0].token, newPrepare.token);
      assert.equal(commits[0].targetDocumentId, newPrepare.targetDocumentId);
      const observed = await inspect(page);
      assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
      assert.deepEqual(observed.sentTexts, [prompt]);
      assert.equal(observed.editorEmpty, true);
    } finally {
      clearTimeout(completionTimer);
      await call({ type: 'PAUSE' });
      await worker.evaluate(() => {
        if (globalThis.rejectReloadedPrepare) rejectReloadedPrepare();
        chrome.scripting.executeScript = originalExecuteScript;
        delete globalThis.originalExecuteScript;
        delete globalThis.rejectReloadedPrepare;
        delete globalThis.reloadRecovery;
      });
      await sending;
    }
  });
  await scenario('A full composer form remount immediately before final authorization replaces its changed draft and sends once', async page => {
    const expectedUrl = page.url();
    const started = await start(page, { sendMethod: 'auto' });
    await mutateBeforeFinalAuthorization('remount');
    const sending = call({ type: 'SEND_NOW' });
    try {
      const sent = await sending;
      assert.equal(sent.job.id, started.job.id);
      assert.equal(sent.job.sentCount, 1, sent.job.statusText);
      assert.equal(sent.job.unknownCount, 0);
      assert.equal(sent.job.targetIdentity, 'pm-account~pm-dot');
      assert.equal(page.url(), expectedUrl);
      const probe = await worker.evaluate(() => finalAuthorizationProbe);
      assert.equal(probe.mutated, true, 'The whole form must actually be replaced before GRANT_RUN');
      assert.ok(probe.grants >= 1);
      const observed = await inspect(page);
      assert.equal(observed.remounts, 1);
      assert.equal(observed.remountedDraft, 'PM_SYNTHETIC_CHANGED_DRAFT_AFTER_FULL_FORM_REMOUNT');
      assert.equal(await page.evaluate(() => fixtureDetachedForms.every(form => !form.isConnected)), true);
      assert.equal(observed.staleButtonClicks || 0, 0, 'No detached Send control may be clicked');
      assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
      assert.deepEqual(observed.sentTexts, [prompt]);
      assert.deepEqual(observed.submissionPayloads, [{ text: prompt, attachments: 0, files: 0 }]);
      assert.equal(observed.editorEmpty, true);
    } finally {
      await call({ type: 'PAUSE' });
      await restoreFinalAuthorizationMutation();
      await sending;
    }
  });
  await scenario('A late composer attachment is detached through its scoped Remove control and only the pure prompt is sent once', async page => {
    const expectedUrl = page.url();
    const started = await start(page, { sendMethod: 'auto' });
    await mutateBeforeFinalAuthorization('removable-attachment');
    const sending = call({ type: 'SEND_NOW' });
    try {
      const sent = await sending;
      assert.equal(sent.job.id, started.job.id);
      assert.equal(sent.job.sentCount, 1, sent.job.statusText);
      assert.equal(sent.job.unknownCount, 0);
      assert.equal(sent.job.targetIdentity, 'pm-account~pm-dot');
      assert.equal(page.url(), expectedUrl);
      const probe = await worker.evaluate(() => finalAuthorizationProbe);
      assert.equal(probe.mutated, true);
      assert.ok(probe.admissions.every(entry => entry.persistentDelivery === true));
      const runIds = [...new Set(probe.admissions.map(entry => entry.runId))];
      assert.ok(runIds.length >= 2, 'A known no-dispatch attachment result must obtain a fresh run without another Send now');
      assert.ok(probe.admissions.some(entry => entry.result?.retryable === true));
      assert.ok(probe.commits.some(result => result.dispatched === false && result.code === 'attachments'));
      const observed = await inspect(page);
      assert.equal(observed.attachmentRemovals, 1, 'The site removal control, not DOM deletion, must detach the chip');
      assert.equal(observed.fileClearEvents, 1);
      assert.equal(observed.accountRemoveClicks || 0, 0, 'A matching Remove outside this composer must remain untouched');
      assert.equal(await page.locator('[data-composer-body] [data-testid="attachment"]').count(), 0);
      assert.equal(await page.locator('[data-composer-body] input[type="file"]').evaluate(input => input.files.length), 0);
      assert.equal(await page.locator('[data-account-files] input[type="file"]').evaluate(input => input.files[0]?.name), 'account-file.txt');
      assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
      assert.deepEqual(observed.sentTexts, [prompt]);
      assert.deepEqual(observed.submissionPayloads, [{ text: prompt, attachments: 0, files: 0 }]);
    } finally {
      await call({ type: 'PAUSE' });
      await restoreFinalAuthorizationMutation();
      await sending;
    }
  });
  await scenario('An unremovable late attachment keeps the same delivery pending until Pause with no submission or account-file removal', async page => {
    const started = await start(page, { sendMethod: 'auto' });
    await mutateBeforeFinalAuthorization('unremovable-attachment');
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => fixture.attachmentAdded === true);
      const state = await Promise.race([sending.then(() => 'settled'), new Promise(resolve => setTimeout(() => resolve('waiting'), 2500))]);
      assert.equal(state, 'waiting', 'Known no-send must stay pending, not finish at a blocked result or total wait cutoff');
      const waiting = await call({ type: 'GET_STATE' });
      assert.equal(waiting.job.id, started.job.id);
      assert.equal(waiting.job.enabled, true);
      assert.equal(waiting.job.sentCount, 0);
      assert.equal(waiting.job.unknownCount, 0);
      const probe = await worker.evaluate(() => finalAuthorizationProbe);
      assert.equal(probe.mutated, true);
      assert.ok(new Set(probe.admissions.map(entry => entry.runId)).size >= 2);
      assert.ok(probe.admissions.some(entry => entry.result?.retryable === true));
      assert.ok(probe.commits.every(result => result.dispatched === false));
      const paused = await call({ type: 'PAUSE' });
      assert.equal(paused.job.enabled, false);
      const stopped = await sending;
      assert.equal(stopped.job.sentCount, 0);
      assert.equal(stopped.job.unknownCount, 0);
      const admissionsAfterPause = await worker.evaluate(() => finalAuthorizationProbe.admissions.length);
      await new Promise(resolve => setTimeout(resolve, 1300));
      assert.equal(await worker.evaluate(() => finalAuthorizationProbe.admissions.length), admissionsAfterPause,
        'Pause must suppress the next scheduled fresh admission');
      const observed = await inspect(page);
      assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 0, 0]);
      assert.deepEqual(observed.sentTexts, []);
      assert.deepEqual(observed.submissionPayloads, []);
      assert.equal(observed.attachmentRemovals || 0, 0);
      assert.equal(observed.accountRemoveClicks || 0, 0);
      assert.equal(await page.locator('[data-composer-body] [data-testid="attachment"]').count(), 1);
      assert.equal(await page.locator('[data-account-files] input[type="file"]').evaluate(input => input.files[0]?.name), 'account-file.txt');
    } finally {
      await call({ type: 'PAUSE' });
      await restoreFinalAuthorizationMutation();
      await sending;
    }
  });
  await scenario('A legacy Send disconnecting synchronously after final selection retries a fresh run instead of waiting for a nonexistent receipt', async page => {
    const started = await start(page, { sendMethod: 'auto' });
    await mutateBeforeFinalAuthorization('legacy-disconnect');
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const contains = Node.prototype.contains;
      let replaced = false;
      // Return the real final scope check, then replace Send in that same stack.
      // The next connectivity check must prove no click occurred and retry.
      Node.prototype.contains = function(node) {
        const contained = contains.call(this, node);
        if (!replaced && contained && this.matches?.('[data-composer-body]') && node.matches?.('button[aria-label="Send"]')) {
          replaced = true;
          document.dispatchEvent(new Event('fixture-final-button-disconnect'));
        }
        return contained;
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    let completionTimer;
    try {
      const completion = await Promise.race([sending.then(result => ({ result })), new Promise(resolve => {
        completionTimer = setTimeout(() => resolve({ waiting: true }), 7000);
      })]);
      clearTimeout(completionTimer);
      assert.ok(completion.result, 'A detached, never-clicked Send must not leave a false pending receipt');
      const sent = completion.result;
      assert.equal(sent.job.id, started.job.id);
      assert.equal(sent.job.sentCount, 1, sent.job.statusText);
      assert.equal(sent.job.unknownCount, 0);
      const probe = await worker.evaluate(() => finalAuthorizationProbe);
      assert.equal(probe.grants, 0, 'This case must exercise the unsupported-view legacy path');
      assert.ok(new Set(probe.admissions.map(entry => entry.runId)).size >= 2);
      assert.ok(probe.admissions.some(entry => entry.result?.status === 'blocked' && entry.result.retryable === true));
      const observed = await inspect(page);
      assert.equal(observed.sendReplacements, 1, 'The control must actually disconnect synchronously');
      assert.equal(observed.staleButtonClicks || 0, 0);
      assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
      assert.deepEqual(observed.sentTexts, [prompt]);
      assert.deepEqual(observed.submissionPayloads, [{ text: prompt, attachments: 0, files: 0 }]);
    } finally {
      clearTimeout(completionTimer);
      await call({ type: 'PAUSE' });
      await restoreFinalAuthorizationMutation();
      await sending;
    }
  });
  await scenario('Legacy sticky disabled Send recovers a whole form remount during readiness through a fresh run and sends once', async page => {
    const expectedUrl = page.url();
    await page.evaluate(() => {
      document.addEventListener('fixture-readiness-remount', () => {
        fixture.readinessRemount = { sendDisabled: document.querySelector('button[aria-label="Send"]').disabled,
          text: pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n'), submits: fixture.submits };
        window.fixtureRemountComposer();
      }, { once: true });
    });
    const started = await start(page, { sendMethod: 'auto' });
    await mutateBeforeFinalAuthorization('legacy-disconnect');
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      let replaced = false;
      chrome.runtime.sendMessage = async message => {
        const reply = await send(message);
        if (!replaced && message.type === 'WAIT_RUN' && message.delayMs === 150
          && document.querySelector('button[aria-label="Send"]')?.disabled
          && document.querySelector('[contenteditable]')?.textContent.includes('PM_SYNTHETIC_FIRST_PARAGRAPH')) {
          replaced = true;
          document.dispatchEvent(new Event('fixture-readiness-remount'));
        }
        return reply;
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    let completionTimer;
    try {
      const completion = await Promise.race([sending.then(result => ({ result })), new Promise(resolve => {
        completionTimer = setTimeout(() => resolve({ waiting: true }), 10000);
      })]);
      clearTimeout(completionTimer);
      assert.ok(completion.result, 'A replaced legacy form must not leave readiness polling the detached disabled Send');
      const sent = completion.result;
      assert.equal(sent.job.id, started.job.id);
      assert.equal(sent.job.sentCount, 1, sent.job.statusText);
      assert.equal(sent.job.unknownCount, 0);
      assert.equal(sent.job.targetIdentity, 'pm-account~pm-dot');
      assert.equal(page.url(), expectedUrl);
      const probe = await worker.evaluate(() => finalAuthorizationProbe);
      assert.equal(probe.grants, 0, 'The replacement must occur in legacy readiness, not the MAIN authorization path');
      assert.ok(new Set(probe.admissions.map(entry => entry.runId)).size >= 2);
      assert.ok(probe.admissions.some(entry => entry.result?.status === 'blocked' && entry.result.retryable === true));
      const observed = await inspect(page);
      assert.deepEqual(observed.readinessRemount, { sendDisabled: true, text: prompt, submits: 0 });
      assert.equal(observed.remounts, 1);
      assert.equal(await page.evaluate(() => fixtureDetachedForms.every(form => !form.isConnected)), true);
      assert.equal(observed.staleButtonClicks || 0, 0);
      assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
      assert.deepEqual(observed.sentTexts, [prompt]);
      assert.deepEqual(observed.submissionPayloads, [{ text: prompt, attachments: 0, files: 0 }]);
      assert.equal(observed.editorEmpty, true);
    } finally {
      clearTimeout(completionTimer);
      await call({ type: 'PAUSE' });
      await restoreFinalAuthorizationMutation();
      await sending;
    }
  });
  await scenario('An expired first positive CHECK_RUN renews before one send, and Pause cancels repeated stale positives without dispatch', async page => {
    const started = await start(page, { sendMethod: 'auto' });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.authorizationProbe = { checks: 0, stalePositives: 0, freshPositives: 0, positiveRunIds: [], holdStale: false };
      chrome.runtime.sendMessage = async message => {
        const reply = await send(message);
        if (message.type !== 'CHECK_RUN') return reply;
        authorizationProbe.checks++;
        if (reply?.ok !== true || reply.allowed !== true) return reply;
        authorizationProbe.positiveRunIds.push(message.runId);
        if (!authorizationProbe.stalePositives || authorizationProbe.holdStale) {
          authorizationProbe.stalePositives++;
          return { ...reply, runDeadline: Date.now() - 1 };
        }
        if (Number.isFinite(reply.runDeadline) && reply.runDeadline > Date.now()) authorizationProbe.freshPositives++;
        return reply;
      };
    } }), started.job.tabId);
    const readAuthorization = () => worker.evaluate(async tabId => {
      const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED',
        func: () => ({ ...authorizationProbe }) });
      return frames.find(frame => frame.frameId === 0)?.result;
    }, started.job.tabId);
    const sent = await call({ type: 'SEND_NOW' });
    assert.equal(sent.job.id, started.job.id);
    assert.equal(sent.job.sentCount, 1, sent.job.statusText);
    assert.equal(sent.job.unknownCount, 0);
    const authorization = await readAuthorization();
    assert.equal(authorization.stalePositives, 1, 'The first actual positive authorization must be delivered expired');
    assert.ok(authorization.freshPositives >= 1, 'A new positive permit must be obtained before dispatch');
    assert.equal(new Set(authorization.positiveRunIds).size, 1, 'Authorization renewal must stay inside the same run');
    const delivered = await inspect(page);
    assert.deepEqual([delivered.keyboardCommands, delivered.buttonClicks, delivered.submits], [0, 1, 1]);
    assert.deepEqual(delivered.sentTexts, [prompt]);
    assert.deepEqual(delivered.submissionPayloads, [{ text: prompt, attachments: 0, files: 0 }]);
    await call({ type: 'PAUSE' });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED',
      func: () => { authorizationProbe.holdStale = true; } }), started.job.tabId);
    await start(page, { sendMethod: 'auto' });
    const sending = call({ type: 'SEND_NOW' });
    try {
      const state = await Promise.race([sending.then(() => 'settled'), new Promise(resolve => setTimeout(() => resolve('waiting'), 800))]);
      assert.equal(state, 'waiting', 'Repeated expired positives must reauthorize, neither dispatch nor cancel the live job');
      const pending = await readAuthorization();
      assert.ok(pending.stalePositives >= 3, 'The test must actually exercise repeated stale-positive renewal');
      const waiting = await call({ type: 'GET_STATE' });
      assert.equal(waiting.job.enabled, true);
      assert.equal(waiting.job.sentCount, 0);
      assert.equal(waiting.job.unknownCount, 0);
      assert.equal((await call({ type: 'PAUSE' })).job.enabled, false);
      const stopped = await sending;
      assert.equal(stopped.job.sentCount, 0);
      assert.equal(stopped.job.unknownCount, 0);
      await new Promise(resolve => setTimeout(resolve, 200));
      const checksAfterPause = (await readAuthorization()).checks;
      await new Promise(resolve => setTimeout(resolve, 350));
      assert.equal((await readAuthorization()).checks, checksAfterPause, 'Pause must terminate the stale-positive reauthorization loop');
      const observed = await inspect(page);
      assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
      assert.deepEqual(observed.sentTexts, [prompt], 'The stale-positive phase must not add a submission');
      assert.equal(observed.updates, delivered.updates, 'No model preparation is authorized by an expired positive reply');
    } finally {
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  await scenario('An accepted final grant survives a lost, rejected, or permanently pending acknowledgement without a second dispatch', async page => {
    await worker.evaluate(() => {
      globalThis.originalGrantSend = chrome.tabs.sendMessage;
      globalThis.grantTransportProbe = { mode: 'missing', accepted: 0 };
      chrome.tabs.sendMessage = async (tabId, message, options) => {
        const result = await originalGrantSend(tabId, message, options);
        if (message.type !== 'GRANT_RUN') return result;
        if (result?.granted === true) grantTransportProbe.accepted++;
        if (grantTransportProbe.mode === 'reject') throw new Error('Synthetic lost accepted-grant reply');
        if (grantTransportProbe.mode === 'pending') return new Promise(() => {});
        return undefined;
      };
    });
    try {
      for (const mode of ['missing', 'reject', 'pending']) {
        await worker.evaluate(mode => { grantTransportProbe.mode = mode; }, mode);
        await start(page, { sendMethod: 'auto' });
        const sending = call({ type: 'SEND_NOW' });
        const outcome = await Promise.race([sending.then(result => ({ result })),
          new Promise(resolve => setTimeout(() => resolve({ waiting: true }), 6000))]);
        if (outcome.waiting) { await call({ type: 'PAUSE' }); await sending; }
        assert.ok(outcome.result, `The ${mode} acknowledgement must not strand an already accepted final grant`);
        assert.equal(outcome.result.job.sentCount, 1, outcome.result.job.statusText);
        assert.equal(outcome.result.job.unknownCount, 0);
        await call({ type: 'PAUSE' });
      }
      const observed = await inspect(page);
      assert.deepEqual([observed.buttonClicks, observed.submits, observed.keyboardCommands], [3, 3, 0]);
      assert.deepEqual(observed.sentTexts, [prompt, prompt, prompt]);
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(() => { chrome.tabs.sendMessage = originalGrantSend; delete globalThis.originalGrantSend; });
    }
  });
  await scenario('Pause cancels a final grant whose delivery and acknowledgement are both unavailable', async page => {
    await worker.evaluate(() => {
      globalThis.originalGrantSend = chrome.tabs.sendMessage;
      globalThis.undeliveredGrantCount = 0;
      chrome.tabs.sendMessage = (tabId, message, options) => {
        if (message.type === 'GRANT_RUN') { undeliveredGrantCount++; return new Promise(() => {}); }
        return originalGrantSend(tabId, message, options);
      };
    });
    const started = await start(page, { sendMethod: 'auto' });
    const sending = call({ type: 'SEND_NOW' });
    try {
      for (let attempt = 0; attempt < 30; attempt++) {
        if (await worker.evaluate(() => undeliveredGrantCount > 0)) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(await worker.evaluate(() => undeliveredGrantCount > 0));
      assert.equal((await call({ type: 'GET_STATE' })).job.id, started.job.id);
      assert.equal((await inspect(page)).submits, 0, 'No grant readback means no submission permission');
      assert.equal((await call({ type: 'PAUSE' })).job.enabled, false);
      await sending;
      await new Promise(resolve => setTimeout(resolve, 1200));
      assert.deepEqual([(await inspect(page)).submits, (await inspect(page)).buttonClicks], [0, 0]);
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(() => { chrome.tabs.sendMessage = originalGrantSend; delete globalThis.originalGrantSend; });
      await sending;
    }
  });
  await scenario('A document reload while the final grant is undelivered recovers preparation, not an unknown attempted send', async page => {
    await worker.evaluate(() => {
      globalThis.originalGrantSend = chrome.tabs.sendMessage;
      globalThis.reloadDuringGrant = { blocked: 0, allow: false };
      chrome.tabs.sendMessage = (tabId, message, options) => {
        if (message.type === 'GRANT_RUN' && !reloadDuringGrant.allow) {
          reloadDuringGrant.blocked++;
          return new Promise(() => {});
        }
        return originalGrantSend(tabId, message, options);
      };
    });
    const started = await start(page, { sendMethod: 'auto' });
    const sending = call({ type: 'SEND_NOW' });
    try {
      for (let attempt = 0; attempt < 30; attempt++) {
        if (await worker.evaluate(() => reloadDuringGrant.blocked > 0)) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(await worker.evaluate(() => reloadDuringGrant.blocked > 0));
      assert.equal((await inspect(page)).submits, 0);
      await page.reload();
      await page.waitForFunction(() => window.fixtureReady);
      await worker.evaluate(() => { reloadDuringGrant.allow = true; });
      const outcome = await Promise.race([sending.then(result => ({ result })),
        new Promise(resolve => setTimeout(() => resolve({ waiting: true }), 8000))]);
      if (outcome.waiting) { await call({ type: 'PAUSE' }); await sending; }
      assert.ok(outcome.result, 'An unattempted old document must retire and recover in a fresh run');
      assert.equal(outcome.result.job.id, started.job.id);
      assert.equal(outcome.result.job.sentCount, 1, outcome.result.job.statusText);
      assert.equal(outcome.result.job.unknownCount, 0, 'A pending grant is not an attempted submission');
      const observed = await inspect(page);
      assert.deepEqual([observed.buttonClicks, observed.submits, observed.keyboardCommands], [1, 1, 0]);
      assert.deepEqual(observed.sentTexts, [prompt]);
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(() => { chrome.tabs.sendMessage = originalGrantSend; delete globalThis.originalGrantSend; });
      await sending;
    }
  });
  await scenario('An accepted grant recovers after its first readback hangs and ignores that retired late response', async page => {
    await worker.evaluate(() => {
      globalThis.originalGrantSend = chrome.tabs.sendMessage;
      globalThis.originalGrantExecute = chrome.scripting.executeScript;
      globalThis.grantReadbackProbe = { requested: false, reads: 0, commits: 0 };
      chrome.tabs.sendMessage = async (tabId, message, options) => {
        if (message.type === 'GRANT_RUN') grantReadbackProbe.requested = true;
        const reply = await originalGrantSend(tabId, message, options);
        if (message.type !== 'GRANT_RUN') return reply;
        return undefined;
      };
      chrome.scripting.executeScript = options => {
        if (options.func?.name === 'editorCommit' && options.args?.[0]?.phase === 'commit') grantReadbackProbe.commits++;
        const result = originalGrantExecute(options);
        if (options.func?.name === 'pageInvocationState' && options.target.documentIds?.length && grantReadbackProbe.requested) {
          grantReadbackProbe.reads++;
          if (grantReadbackProbe.reads === 1) return new Promise(resolve => {
            grantReadbackProbe.release = () => result.then(resolve);
          });
        }
        return result;
      };
    });
    await start(page, { sendMethod: 'auto' });
    const sending = call({ type: 'SEND_NOW' });
    try {
      const outcome = await Promise.race([sending.then(result => ({ result })),
        new Promise(resolve => setTimeout(() => resolve({ waiting: true }), 6000))]);
      if (outcome.waiting) { await call({ type: 'PAUSE' }); await sending; }
      assert.ok(outcome.result, 'A hung first readback must not suppress fresh observation indefinitely');
      assert.equal(outcome.result.job.sentCount, 1);
      assert.equal(outcome.result.job.unknownCount, 0);
      assert.ok(await worker.evaluate(() => grantReadbackProbe.reads >= 2));
      await worker.evaluate(() => grantReadbackProbe.release());
      await new Promise(resolve => setTimeout(resolve, 300));
      assert.equal(await worker.evaluate(() => grantReadbackProbe.commits), 1);
      const observed = await inspect(page);
      assert.deepEqual([observed.buttonClicks, observed.submits], [1, 1]);
      assert.deepEqual(observed.sentTexts, [prompt]);
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(() => {
        chrome.tabs.sendMessage = originalGrantSend;
        chrome.scripting.executeScript = originalGrantExecute;
        grantReadbackProbe.release?.();
        delete globalThis.originalGrantSend; delete globalThis.originalGrantExecute;
      });
      await sending;
    }
  });
  await scenario('A rejected undelivered grant retries independently of a hung readback', async page => {
    await worker.evaluate(() => {
      globalThis.originalGrantSend = chrome.tabs.sendMessage;
      globalThis.originalGrantExecute = chrome.scripting.executeScript;
      globalThis.grantReadbackProbe = { sends: 0, reads: 0 };
      chrome.tabs.sendMessage = (tabId, message, options) => {
        if (message.type === 'GRANT_RUN' && ++grantReadbackProbe.sends === 1) return Promise.reject(new Error('Synthetic undelivered grant'));
        return originalGrantSend(tabId, message, options);
      };
      chrome.scripting.executeScript = options => {
        if (options.func?.name === 'pageInvocationState' && options.target.documentIds?.length) {
          grantReadbackProbe.reads++;
          if (grantReadbackProbe.reads === 1) return new Promise(() => {});
        }
        return originalGrantExecute(options);
      };
    });
    await start(page, { sendMethod: 'auto' });
    const sending = call({ type: 'SEND_NOW' });
    try {
      const outcome = await Promise.race([sending.then(result => ({ result })),
        new Promise(resolve => setTimeout(() => resolve({ waiting: true }), 3000))]);
      if (outcome.waiting) { await call({ type: 'PAUSE' }); await sending; }
      assert.ok(outcome.result, 'A settled failed grant must retry without waiting for a hung observation');
      assert.equal(outcome.result.job.sentCount, 1);
      assert.ok(await worker.evaluate(() => grantReadbackProbe.sends >= 2));
      assert.deepEqual([(await inspect(page)).buttonClicks, (await inspect(page)).submits], [1, 1]);
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(() => {
        chrome.tabs.sendMessage = originalGrantSend;
        chrome.scripting.executeScript = originalGrantExecute;
        delete globalThis.originalGrantSend; delete globalThis.originalGrantExecute;
      });
      await sending;
    }
  });
  await scenario('Pause before a hung accepted-grant readback recovers prevents late dispatch', async page => {
    await worker.evaluate(() => {
      globalThis.originalGrantSend = chrome.tabs.sendMessage;
      globalThis.originalGrantExecute = chrome.scripting.executeScript;
      globalThis.grantReadbackProbe = { requested: false, reads: 0 };
      chrome.tabs.sendMessage = async (tabId, message, options) => {
        if (message.type === 'GRANT_RUN') grantReadbackProbe.requested = true;
        const reply = await originalGrantSend(tabId, message, options);
        if (message.type !== 'GRANT_RUN') return reply;
        return undefined;
      };
      chrome.scripting.executeScript = options => {
        const result = originalGrantExecute(options);
        if (options.func?.name === 'pageInvocationState' && options.target.documentIds?.length && grantReadbackProbe.requested) {
          grantReadbackProbe.reads++;
          return new Promise(resolve => { grantReadbackProbe.release = () => result.then(resolve); });
        }
        return result;
      };
    });
    await start(page, { sendMethod: 'auto' });
    const sending = call({ type: 'SEND_NOW' });
    try {
      for (let attempt = 0; attempt < 30; attempt++) {
        if (await worker.evaluate(() => grantReadbackProbe.reads > 0)) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(await worker.evaluate(() => grantReadbackProbe.reads > 0));
      assert.equal((await call({ type: 'PAUSE' })).job.enabled, false);
      await worker.evaluate(() => grantReadbackProbe.release());
      await sending;
      await new Promise(resolve => setTimeout(resolve, 2500));
      assert.deepEqual([(await inspect(page)).buttonClicks, (await inspect(page)).submits], [0, 0]);
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(() => {
        chrome.tabs.sendMessage = originalGrantSend;
        chrome.scripting.executeScript = originalGrantExecute;
        grantReadbackProbe.release?.();
        delete globalThis.originalGrantSend; delete globalThis.originalGrantExecute;
      });
      await sending;
    }
  });
  for (const variant of ['basic', 'pause', 'remount', 'lease']) await scenario(
    variant === 'remount' ? 'Manual takeover follows the replacement editor when the same preparation reservation is retried'
      : variant === 'lease' ? 'An expired cached MAIN lease does not disable observation of a trusted manual takeover'
      : variant === 'pause' ? 'Pause still wins after a real manual Send while its history receipt is delayed'
      : 'A real manual Send of the prepared prompt stops MAIN refilling and does not become an extension send', async page => {
      const pauseBeforeReceipt = variant === 'pause';
      await worker.evaluate(() => {
        globalThis.originalManualGrant = chrome.tabs.sendMessage;
        chrome.tabs.sendMessage = (tabId, message, options) => message.type === 'GRANT_RUN'
          ? new Promise(() => {}) : originalManualGrant(tabId, message, options);
      });
      if (['remount', 'lease'].includes(variant)) await worker.evaluate(variant => {
        globalThis.originalManualExecute = chrome.scripting.executeScript;
        globalThis.manualPreparationCalls = 0;
        chrome.scripting.executeScript = async options => {
          const frames = await originalManualExecute(options);
          if (options.func?.name === 'editorCommit' && options.args[0].phase === 'prepare') {
            manualPreparationCalls++;
            if (variant === 'remount' && manualPreparationCalls === 1) {
              await originalManualExecute({ target: options.target, world: 'MAIN', func: () => window.fixtureRemountComposer() });
              return [];
            }
            if (variant === 'lease') await originalManualExecute({ target: options.target, world: 'MAIN',
              func: token => { globalThis[Symbol.for('agent-continue.editor-commit.v1')].get(token).deadline = Date.now() - 1; },
              args: [options.args[0].receiptBoundaryToken] });
          }
          return frames;
        };
      }, variant);
      await start(page, { sendMethod: 'auto', intervalMinutes: 30 });
      const sending = call({ type: 'SEND_NOW' });
      try {
        if (variant === 'remount') {
          for (let poll = 0; poll < 300 && !await worker.evaluate(() => manualPreparationCalls >= 2); poll++)
            await new Promise(resolve => setTimeout(resolve, 50));
          assert.ok(await worker.evaluate(() => manualPreparationCalls >= 2), 'Replacement editor must be prepared before the manual click');
        }
        await page.waitForFunction(text => window.pm.state.doc.textBetween(0, window.pm.state.doc.content.size, '\n') === text, prompt);
        await page.evaluate(() => { document.querySelector('button[aria-label="Send"]').disabled = false; });
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        const updatesAfterHuman = (await inspect(page)).updates;
        if (pauseBeforeReceipt) await call({ type: 'PAUSE' });
        const outcome = await sending;
        assert.equal(outcome.job.sentCount, 0, 'Manual submission must not be attributed to extension dispatch');
        if (!pauseBeforeReceipt) {
          assert.equal(outcome.job.manualSentCount, 1);
          assert.equal(outcome.job.phase, 'idle');
          assert.ok(outcome.job.nextAt >= Date.now() + 29 * 60000);
        } else assert.equal(outcome.job.enabled, false);
        await new Promise(resolve => setTimeout(resolve, 1200));
        const actual = await inspect(page);
        assert.equal(actual.updates, updatesAfterHuman, 'No model refill after the human Send');
        assert.deepEqual([actual.buttonClicks, actual.submits], [1, 1]);
        assert.equal(await page.evaluate(() => window.pm.state.doc.textContent), '');
        const traces = await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics);
        assert.ok(traces?.length);
        const trace = traces.at(-1);
        assert.equal(trace.state, pauseBeforeReceipt ? 'cancelled' : 'manual-sent');
        assert.equal(trace.counters.modelWrites, variant === 'remount' ? 2 : 1);
        assert.equal(trace.counters.dispatchAttempts || 0, 0);
      } finally {
        await call({ type: 'PAUSE' }); await sending;
        await worker.evaluate(() => { chrome.tabs.sendMessage = originalManualGrant; delete globalThis.originalManualGrant; });
        if (['remount', 'lease'].includes(variant)) await worker.evaluate(() => {
          chrome.scripting.executeScript = originalManualExecute; delete globalThis.originalManualExecute;
        });
      }
    });
  await scenario('Manual Send on a remounted editor fences a queued MAIN preparation even when its notification is rejected', async page => {
    await worker.evaluate(text => {
      globalThis.originalGapExecute = chrome.scripting.executeScript;
      globalThis.gapPreparationCalls = 0;
      chrome.scripting.executeScript = async options => {
        const prepare = options.func?.name === 'editorCommit' && options.args[0].phase === 'prepare';
        if (prepare && ++gapPreparationCalls === 2) await new Promise(resolve => { globalThis.releaseGapRetry = resolve; });
        const frames = await originalGapExecute(options);
        if (prepare && gapPreparationCalls === 1) {
          await originalGapExecute({ target: options.target, world: 'MAIN', func: text => {
            window.fixtureRemountComposer();
            pm.dispatch(pm.state.tr.insertText(text, 0, pm.state.doc.content.size));
            document.querySelector('button[aria-label="Send"]').disabled = false;
          }, args: [text] });
          return [];
        }
        return frames;
      };
    }, prompt);
    await start(page, { sendMethod: 'auto', intervalMinutes: 30 });
    const sending = call({ type: 'SEND_NOW' });
    try {
      for (let poll = 0; poll < 300 && !await worker.evaluate(() => typeof globalThis.releaseGapRetry === 'function'); poll++)
        await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(await worker.evaluate(() => typeof globalThis.releaseGapRetry), 'function');
      await worker.evaluate(async tabId => originalGapExecute({ target: { tabId }, world: 'ISOLATED', func: () => {
        const send = chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage = message => message.type === 'MANUAL_SUBMISSION'
          ? Promise.reject(new Error('Synthetic notification loss')) : send(message);
      } }), (await call({ type: 'GET_STATE' })).job.tabId);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      const updatesAfterHuman = (await inspect(page)).updates;
      await worker.evaluate(() => releaseGapRetry());
      const outcome = await sending;
      assert.equal(outcome.job.sentCount, 0);
      assert.equal(outcome.job.manualSentCount, 1);
      await new Promise(resolve => setTimeout(resolve, 1200));
      const actual = await inspect(page);
      assert.equal(actual.updates, updatesAfterHuman, 'Queued preparation must not refill after manual Send on replacement editor');
      assert.equal(await page.evaluate(() => pm.state.doc.textContent), '');
      assert.deepEqual([actual.submits, actual.buttonClicks], [1, 1]);
    } finally {
      await worker.evaluate(() => globalThis.releaseGapRetry?.());
      await call({ type: 'PAUSE' }); await sending;
      await worker.evaluate(() => { chrome.scripting.executeScript = originalGapExecute; delete globalThis.originalGapExecute; });
    }
  });
  await scenario('Trusted Enter on a composer tool cannot seal a prepared delivery as a manual Send', async page => {
    await page.evaluate(() => {
      const tool = document.createElement('button');
      tool.type = 'button'; tool.textContent = 'Attach files';
      document.querySelector('[data-composer-body]').append(tool);
      tool.addEventListener('keydown', event => {
        if (event.key === 'Enter' && event.isTrusted) fixture.trustedToolEnters = (fixture.trustedToolEnters || 0) + 1;
      });
    });
    await worker.evaluate(() => {
      globalThis.originalToolGrant = chrome.tabs.sendMessage;
      chrome.tabs.sendMessage = async (tabId, message, options) => {
        if (message.type === 'GRANT_RUN') await new Promise(resolve => { globalThis.releaseToolGrant = resolve; });
        return originalToolGrant(tabId, message, options);
      };
    });
    await start(page, { sendMethod: 'auto' });
    const sending = call({ type: 'SEND_NOW' });
    try {
      for (let poll = 0; poll < 200 && !await worker.evaluate(() => typeof globalThis.releaseToolGrant === 'function'); poll++)
        await new Promise(resolve => setTimeout(resolve, 25));
      assert.equal(await worker.evaluate(() => typeof globalThis.releaseToolGrant), 'function');
      await page.getByRole('button', { name: 'Attach files', exact: true }).press('Control+Enter');
      const manual = await page.evaluate(() => ({
        trusted: fixture.trustedToolEnters,
        sealed: [...globalThis[Symbol.for('agent-continue.editor-commit.v1')].values()].some(state => state.manualSubmission),
      }));
      assert.equal(manual.trusted, 1);
      assert.equal(manual.sealed, false, 'A composer tool key must not seal the prepared MAIN reservation.');
      await worker.evaluate(() => releaseToolGrant());
      const outcome = await sending;
      assert.equal(outcome.job.sentCount, 1, outcome.job.statusText);
      assert.equal(outcome.job.manualSentCount || 0, 0);
      assert.equal(outcome.job.unknownCount, 0);
      const actual = await inspect(page);
      assert.deepEqual([actual.buttonClicks, actual.submits], [1, 1]);
      assert.deepEqual(actual.sentTexts, [prompt]);
    } finally {
      await worker.evaluate(() => globalThis.releaseToolGrant?.());
      await call({ type: 'PAUSE' }); await sending;
      await worker.evaluate(() => {
        chrome.tabs.sendMessage = originalToolGrant;
        delete globalThis.originalToolGrant; delete globalThis.releaseToolGrant;
      });
    }
  });
  for (const lostPrepare of [false, true]) await scenario(
    lostPrepare ? 'A lost prepare reply reactivates a restored model once on the replacement editor in the same reservation'
      : 'Read-only readiness detects a restored-model remount and retries preparation without a total send deadline', async page => {
      await worker.evaluate(lostPrepare => {
        globalThis.originalRestoredExecute = chrome.scripting.executeScript;
        globalThis.restoredProbe = { preparations: 0, observations: 0, remounted: false, tokens: [], commits: 0 };
        chrome.scripting.executeScript = async options => {
          if (options.func?.name !== 'editorCommit') return originalRestoredExecute(options);
          const { phase, receiptBoundaryToken } = options.args[0];
          restoredProbe.tokens.push(receiptBoundaryToken);
          if (phase === 'prepare') restoredProbe.preparations++;
          if (phase === 'observe') restoredProbe.observations++;
          if (phase === 'commit') restoredProbe.commits++;
          if (!lostPrepare && phase === 'observe' && !restoredProbe.remounted) {
            await originalRestoredExecute({ target: options.target, world: 'MAIN', func: () => window.fixtureRemountComposer(true) });
            restoredProbe.remounted = true;
          }
          const frames = await originalRestoredExecute(options);
          if (lostPrepare && phase === 'prepare' && !restoredProbe.remounted) {
            await originalRestoredExecute({ target: options.target, world: 'MAIN', func: () => window.fixtureRemountComposer(true) });
            restoredProbe.remounted = true;
            return [];
          }
          return frames;
        };
      }, lostPrepare);
      await start(page, { sendMethod: 'auto' });
      const sending = call({ type: 'SEND_NOW' });
      try {
        for (let poll = 0; poll < 200 && !await page.evaluate(() => fixture.remountActivationInputs > 0); poll++)
          await new Promise(resolve => setTimeout(resolve, 25));
        assert.equal(await page.evaluate(() => fixture.remountActivationInputs || 0), 1,
          'The restored replacement model must receive one preparation input notification.');
        const outcome = await sending;
        assert.equal(outcome.job.sentCount, 1, outcome.job.statusText);
        assert.equal(outcome.job.manualSentCount || 0, 0);
        assert.equal(outcome.job.unknownCount, 0);
        const probe = await worker.evaluate(() => restoredProbe);
        assert.equal(probe.preparations, 2);
        assert.equal(probe.commits, 1);
        assert.equal(new Set(probe.tokens).size, lostPrepare ? 1 : 2);
        const actual = await inspect(page);
        assert.equal(actual.remounts, 1);
        assert.equal(actual.updates, 3, 'Only the two preparations and successful Send may write the model.');
        assert.deepEqual([actual.buttonClicks, actual.keyboardCommands, actual.submits], [1, 0, 1]);
        assert.deepEqual(actual.sentTexts, [prompt]);
      } finally {
        await call({ type: 'PAUSE' }); await sending;
        await worker.evaluate(() => {
          chrome.scripting.executeScript = originalRestoredExecute;
          delete globalThis.originalRestoredExecute; delete globalThis.restoredProbe;
        });
      }
    });
  for (const legacy of [false, true]) await scenario(
    `A held trusted Ctrl+Enter sends a prepared prompt once without refill (${legacy ? 'legacy' : 'MAIN'})`, async page => {
      const grantKey = legacy ? 'legacy' : 'main';
      assert.equal(await page.evaluate(() => !!pm.dom.editor?.view), !legacy, '明确覆盖 MAIN 与 legacy 两条路径');
      await page.locator('[contenteditable="true"]').focus();
      await page.keyboard.down('Control');
      await page.keyboard.down('Enter');
      assert.equal((await inspect(page)).submits, 0, '按住键的首次事件发生在空输入框');
      await worker.evaluate(() => {
        globalThis.originalRepeatGrant = chrome.tabs.sendMessage;
        chrome.tabs.sendMessage = (tabId, message, options) => message.type === 'GRANT_RUN'
          ? new Promise(() => {}) : originalRepeatGrant(tabId, message, options);
      });
      await start(page, { sendMethod: 'auto', intervalMinutes: 30 });
      const sending = call({ type: 'SEND_NOW' });
      try {
        await page.waitForFunction(text => pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n') === text, prompt);
        await page.keyboard.down('Enter');
        const human = await inspect(page);
        assert.equal(human.events.filter(event => event.type === 'keydown' && event.repeat && event.trusted).length, 1);
        assert.equal(human.submits, 1, `${grantKey} 重复按键已实际触发站点提交`);
        const updatesAfterHuman = human.updates;
        await page.keyboard.up('Enter'); await page.keyboard.up('Control');
        const outcome = await sending;
        assert.equal(outcome.job.sentCount, 0, '人工提交不能计入扩展发送');
        assert.equal(outcome.job.manualSentCount, 1);
        await new Promise(resolve => setTimeout(resolve, 1200));
        const actual = await inspect(page);
        assert.equal(actual.updates, updatesAfterHuman, '人工重复按键发送后不得重新填入');
        assert.deepEqual([actual.submits, actual.buttonClicks], [1, 0]);
        assert.deepEqual(actual.sentTexts, [prompt]);
        assert.equal(await page.evaluate(() => pm.state.doc.textContent), '');
      } finally {
        await page.keyboard.up('Enter'); await page.keyboard.up('Control');
        await call({ type: 'PAUSE' }); await sending;
        await worker.evaluate(() => { chrome.tabs.sendMessage = originalRepeatGrant; delete globalThis.originalRepeatGrant; });
      }
    });
  console.log(`RESULT ${selectedCases ? selectedCases.length : passed}/${selectedCases ? selectedCases.length : passed} official ProseMirror MV3 scenarios passed`);
} finally {
  await closeBrowser();
  await fs.rm(profile, { recursive: true, force: true });
}
