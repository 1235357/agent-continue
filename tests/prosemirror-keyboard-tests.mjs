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
const testFontPerformance = process.env.TEST_PM_FONT_PERF === '1';
const testFontExecPerformance = process.env.TEST_PM_FONT_EXEC_PERF === '1';
const testVanillaPerformance = process.env.TEST_PM_VANILLA_PERF === '1' || testFontPerformance || testFontExecPerformance;
const testFastPaste = process.env.TEST_PM_FAST_PASTE === '1';
const testPasteSafety = process.env.TEST_PM_PASTE_SAFETY;
const testShapePerformance = process.env.TEST_PM_SHAPE_PERF === '1';
const testCrOnly = process.env.TEST_PM_CR_ONLY === '1';
assert.ok(!testPasteSafety || ['ignored', 'ignored-bounded', 'takeover', 'rollback', 'retry', 'delayed', 'delayed-manual', 'uncanceled-async', 'natural-attachment'].includes(testPasteSafety), 'TEST_PM_PASTE_SAFETY must be ignored, ignored-bounded, takeover, rollback, retry, delayed, delayed-manual, uncanceled-async, or natural-attachment');
assert.ok(!testPasteSafety || !(testVanillaPerformance || testFastPaste), 'Select only one optional ProseMirror test mode');
assert.ok(!testShapePerformance || !(testVanillaPerformance || testFastPaste || testPasteSafety), 'Select only one optional ProseMirror test mode');
assert.ok(!testCrOnly || !(testVanillaPerformance || testFastPaste || testPasteSafety || testShapePerformance), 'Select only one optional ProseMirror test mode');
const selectedCases = process.env.TEST_PM_CASES?.split(',').map(Number);
const selectedFastCases = process.env.TEST_PM_FAST_CASES?.split(',');
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
function expectedPreparedText(value) {
  return value.replace(/\r\n?/g, '\n');
}
let context;
let browser;
let browserProcess;
let worker;
let control;
let passed = 0;
let executedCases = 0;

function fixture({ noSend = false, rejectSynthetic = false, recurringRestore = false, supported = false, sendActivationDelayMs = 0, receiptDelayMs = 0,
  manualReceiptDuringReadiness = false, ignoreButtonSubmit = false, holdSendDisabled = false, fullForm = false, fontPerformance = false } = {}) {
  return `<!doctype html><meta charset="utf-8"><title>Official ProseMirror fixture</title>
  <style>${editorCss}body{font:16px sans-serif;padding:20px}.ProseMirror{min-height:90px;border:1px solid;padding:12px}.message-body{white-space:pre-wrap}</style>
  <main id="history"><article class="message-row" data-message-id="pm-account~pm-dot~old"><div class="message-body">Earlier synthetic response.</div></article></main>
  <${fullForm ? 'form' : 'div'} data-composer-body><div data-composer-input id="editorMount"></div>${noSend ? '' : '<button type="button" aria-label="Send" disabled>Send</button>'}</${fullForm ? 'form' : 'div'}>
  <script type="importmap">${JSON.stringify({ imports })}</script>
  <script type="module">
  import {EditorView} from 'prosemirror-view';import {EditorState} from 'prosemirror-state';
  import {schema as basicSchema} from 'prosemirror-schema-basic';import {Schema} from 'prosemirror-model';import {keymap} from 'prosemirror-keymap';
  const schema=${JSON.stringify(fontPerformance)}?new Schema({nodes:basicSchema.spec.nodes,marks:basicSchema.spec.marks.addToEnd('perfFont',{parseDOM:[{tag:'font'}],toDOM(){return ['font',0]}})}):basicSchema;
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
async function scenario(name, callback, performanceCase = false) {
  const index = ++passed;
  if (Boolean(testVanillaPerformance || testFastPaste || testPasteSafety || testShapePerformance || testCrOnly) !== performanceCase || (!performanceCase && selectedCases && !selectedCases.includes(index)) || (process.env.TEST_PM_CASE_NAME && !name.includes(process.env.TEST_PM_CASE_NAME))) return;
  const page = await newPage('https://chatgpt.com/dots/pm-' + index + (performanceCase && (testFontPerformance || testFontExecPerformance) && !testFastPaste ? '?font-performance=1' : ''));
  let timeout;
  try {
    await page.waitForFunction(() => window.fixtureReady);
    await Promise.race([callback(page), new Promise((_, reject) => {
      const timeoutMs = performanceCase ? 180000 : testRealDueAlarm && index === 6 ? 155000 :
        index === 8 && process.env.TEST_PM_LONG_TIMEOUT_MS ? Number(process.env.TEST_PM_LONG_TIMEOUT_MS) + 15000 : 60000;
      timeout = setTimeout(() => reject(new Error(`Synthetic browser scenario exceeded ${timeoutMs}ms`)), timeoutMs);
    })]);
    executedCases++;
    console.log('PASS ' + name);
  } catch (error) {
    const fixtureState = await inspect(page);
    const job = (await call({ type: 'GET_STATE' })).job;
    console.log('SYNTHETIC FAILURE STATE ' + JSON.stringify({
      fixture: { pastes: fixtureState.pastes, submits: fixtureState.submits, buttonClicks: fixtureState.buttonClicks,
        keyboardCommands: fixtureState.keyboardCommands, visibility: fixtureState.visibility,
        sentLengths: fixtureState.sentTexts.map(text => text.length) },
      job: { enabled: job?.enabled, sentCount: job?.sentCount, statusText: job?.statusText }
    }));
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
        supported: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 99, 108].includes(index),
        sendActivationDelayMs: index === 40 ? 2000 : index === 25 ? 2500 : [11, 16].includes(index) ? 21000 : [17, 20, 21].includes(index) ? 200 : [6, 8, 9, 10, 12, 13, 14, 15].includes(index) ? 100 : 0,
        receiptDelayMs: [18, 65].includes(index) ? 8000 : [28, 48, 49, 50, 51, 52, 56, 57].includes(index) ? 800 : index === 29 ? 5000 : 0,
        manualReceiptDuringReadiness: index === 9 || index === 10, ignoreButtonSubmit: index === 9,
        recurringRestore: index === 7,
        fontPerformance: url.searchParams.get('font-performance') === '1',
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

  await scenario('Official vanilla ProseMirror fallback sends one Ctrl+Enter event sequence, with no Send click', async page => {
    await start(page, { sendMethod: 'ctrl-enter' });
    const sent = await call({ type: 'SEND_NOW' });
    assert.equal(sent.ok, true, sent.error);
    assert.equal(sent.job.sentCount, 1, sent.job.statusText);
    const observed = await inspect(page);
    assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [1, 0, 1]);
    assert.deepEqual(observed.sentTexts, [prompt]);
    assert.equal(observed.editorEmpty, true);
    assert.deepEqual(observed.events.filter(event => event.key === 'Enter').map(event => [event.type, event.keyCode, event.ctrlKey, event.trusted]),
      [['keydown', 13, true, false], ['keypress', 13, true, false], ['keyup', 13, true, false]]);
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
  await scenario('A recurring official ProseMirror restore is adopted for one authorized submission without reinjection', async page => {
    await page.evaluate(() => {
      fixture.modelWrites = [];
      const dispatch = pm.dispatch.bind(pm);
      pm.dispatch = transaction => {
        if (transaction.docChanged) fixture.modelWrites.push(transaction.doc.textBetween(0, transaction.doc.content.size, '\n'));
        return dispatch(transaction);
      };
    });
    await start(page, { sendMethod: 'button' });
    const sent = await call({ type: 'SEND_NOW' });
    assert.equal(sent.job.sentCount, 1, sent.job.statusText);
    assert.equal(sent.job.lastResult, 'sent');
    assert.equal(sent.job.prompt, prompt, 'adoption must not overwrite the configured prompt');
    const observed = await inspect(page);
    assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 1, 1]);
    assert.deepEqual(observed.sentTexts, ['PAGE_RESTORED_OTHER_TEXT']);
    assert.deepEqual(observed.modelWrites, [prompt, 'PAGE_RESTORED_OTHER_TEXT', ''],
      'prepare once, adopt the page restoration, then clear only through submission');
    assert.equal(observed.restores, 1, 'A real model restore ran after the single input');
    assert.equal(await page.locator('article.message-row.self').count(), 1);
    assert.equal(await page.locator('article.message-row.self .message-body').innerText(), 'PAGE_RESTORED_OTHER_TEXT');
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
      const profile = process.env.TEST_PM_PROFILE_LONG === '1' ? await context.newCDPSession(page) : null;
      if (profile) { await profile.send('Profiler.enable'); await profile.send('Profiler.start'); }
      const operation = call({ type: 'SEND_NOW' });
      let timer;
      const elapsed = performance.now();
      const timeoutMs = Number(process.env.TEST_PM_LONG_TIMEOUT_MS || 45000);
      const outcome = await Promise.race([
        operation.then(value => ({ value })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs); }),
      ]).finally(() => clearTimeout(timer));
      if (profile) {
        const { profile: cpu } = await profile.send('Profiler.stop');
        const weights = new Map();
        for (let i = 0; i < (cpu.samples || []).length; i++) weights.set(cpu.samples[i], (weights.get(cpu.samples[i]) || 0) + (cpu.timeDeltas?.[i] || 0));
        const nodes = new Map(cpu.nodes.map(node => [node.id, node]));
        const top = [...weights.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id, micros]) => {
          const frame = nodes.get(id)?.callFrame || {};
          const url = String(frame.url || '');
          return { function: frame.functionName || '(anonymous)', group: url.includes('__local_pm__') ? 'prosemirror' :
            url.startsWith('chrome-extension:') ? 'extension' : url.startsWith('https://chatgpt.com/dots/pm-') ? 'fixture' : url ? 'other' : 'native',
          selfMs: Math.round(micros / 1000) };
        });
        const job = (await call({ type: 'GET_STATE' })).job;
        const tab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(item => item.url === url), page.url());
        const progress = await worker.evaluate(async ({ tabId, runId }) => {
          const result = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', args: [runId], func: runId => {
            const entries = [...(globalThis.__agentContinuePageInvocationsV1?.values() || [])];
            const current = entries.find(item => item.runId === runId);
            return current ? { state: current.state, metrics: current.metrics } : null;
          } });
          return result.find(frame => frame.frameId === 0)?.result;
        }, { tabId: tab.id, runId: job.runId });
        console.log('LONG MULTILINE PROFILE ' + JSON.stringify({ elapsedMs: Math.round(performance.now() - elapsed),
          timedOut: !!outcome.timedOut, phase: job.phase, metrics: progress?.metrics, top }));
        await profile.detach();
      }
      if (outcome.timedOut) {
        const state = (await call({ type: 'GET_STATE' })).job;
        const tab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(item => item.url === url), page.url());
        const progress = await worker.evaluate(async ({ tabId, runId }) => {
          const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', args: [runId], func: runId => {
            const current = [...(globalThis.__agentContinuePageInvocationsV1?.values() || [])].find(item => item.runId === runId);
            return current?.metrics || null;
          } });
          return frames.find(frame => frame.frameId === 0)?.result;
        }, { tabId: tab.id, runId: state.runId });
        console.log('LONG MULTILINE TIMEOUT ' + JSON.stringify({ elapsedMs: Math.round(performance.now() - elapsed),
          stage: progress?.stage, counters: progress?.counters, timings: progress?.timings }));
        await call({ type: 'PAUSE' });
      }
      const sent = outcome.value || await operation;
      assert.notEqual(outcome.timedOut, true, 'Long multiline text must complete without exceeding the bounded observation');
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
      globalThis.originalTabsSendMessage = chrome.tabs.sendMessage;
      globalThis.releaseHeldCommit = null;
      globalThis.heldCommitDeadline = null;
      globalThis.cancelAcknowledgement = null;
      chrome.tabs.sendMessage = async (...args) => {
        const reply = await originalTabsSendMessage(...args);
        if (args[1].type === 'CANCEL_RUN') cancelAcknowledgement = { request: args[1], reply };
        return reply;
      };
      chrome.scripting.executeScript = request => {
        if (request.func.name === 'editorCommit' && request.args[0].phase === 'commit') {
          heldCommitDeadline = request.args[0].deadline;
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
      const { deadline, acknowledgement } = await worker.evaluate(() => ({ deadline: heldCommitDeadline, acknowledgement: cancelAcknowledgement }));
      assert.equal(acknowledgement?.reply?.revoked, true, 'The real isolated page must acknowledge revocation');
      assert.equal(acknowledgement.reply.runId, acknowledgement.request.runId);
      assert.equal(acknowledgement.reply.resultToken, acknowledgement.request.resultToken);
      assert.ok(Number.isFinite(deadline) && deadline > Date.now(), 'The held MAIN permit must still be live');
      assert.ok(paused.job.submissionFenceUntil >= deadline, 'An in-flight MAIN commit must remain fenced through its original deadline');
      assert.equal(paused.job.lastResult, 'unknown');
      assert.equal((await call({ type: 'RESUME' })).ok, false, 'Resume must not bypass the in-flight MAIN fence');
      const frames = await worker.evaluate(() => releaseHeldCommit());
      assert.equal(frames[0].result.dispatched, false);
      assert.equal((await sending).job.sentCount, 0);
      const observed = await inspect(page);
      assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, 0, 0]);
      assert.deepEqual(observed.sentTexts, []);
    } finally {
      await worker.evaluate(() => { chrome.scripting.executeScript = originalExecuteScript; chrome.tabs.sendMessage = originalTabsSendMessage; delete globalThis.originalExecuteScript; delete globalThis.originalTabsSendMessage; delete globalThis.releaseHeldCommit; delete globalThis.heldCommitDeadline; delete globalThis.cancelAcknowledgement; });
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
  await scenario('Legacy fallback adopts restored prepared text and waits for its known Send without keyboard fallback', async page => {
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
    assert.deepEqual(observed.sentTexts, ['RESTORED_UNSENT_TEXT']);
    assert.equal(sent.job.lastResult, 'sent');
    assert.equal(sent.job.prompt, prompt);
    assert.equal(observed.submissionStates[0].sendDisabled, false);
    const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
    assert.deepEqual([trace.counters.domWrites, trace.counters.fillCalls, trace.counters.dispatchAttempts], [1, 1, 1]);
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
        fixture.readinessPhases = [];
        document.addEventListener('fixture-readiness-phase', event => fixture.readinessPhases.push(event.detail));
        document.addEventListener('fixture-late-change', () => {
          pm.dispatch(pm.state.tr.insertText('RESTORED_UNSENT_TEXT', 0, pm.state.doc.content.size));
          fixture.lateChanges = (fixture.lateChanges || 0) + 1;
          document.querySelector('button[aria-label="Send"]').disabled = true;
        });
        document.addEventListener('fixture-wait-finished', event => {
          if (!fixture.lateChanges || fixture.finalMutation || pm.state.doc.textContent !== 'RESTORED_UNSENT_TEXT') return;
          fixture.finalReadinessProof = event.detail;
          fixture.finalMutationPreparedText = pm.state.doc.textContent;
          fixture.finalMutationBeforeSubmit = fixture.submits === 0;
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
        let phase = 'initial-readiness';
        let initialReadyScans;
        const invocation = message => [...(globalThis.__agentContinuePageInvocationsV1?.values() || [])]
          .find(entry => entry.runId === message.runId && entry.state === 'running');
        chrome.runtime.sendMessage = async message => {
          const before = invocation(message)?.metrics;
          const finalWait = message.type === 'WAIT_RUN' && message.renew !== false
            && phase === 'final-readiness-authorized' && before?.counters.readinessChecks === initialReadyScans + 1;
          const reply = await send(message);
          const metrics = invocation(message)?.metrics;
          if (message.type === 'CHECK_RUN' || finalWait) document.dispatchEvent(new CustomEvent('fixture-readiness-phase',
            { detail: { type: message.type, phase, readinessChecks: metrics?.counters.readinessChecks ?? null,
              sendEnabled: metrics?.observations.sendEnabled ?? null } }));
          if (phase === 'initial-readiness' && message.type === 'CHECK_RUN'
            && metrics?.counters.readinessChecks > 0 && metrics.observations.sendEnabled) {
            // The first enabled-control scan has returned and its loop exited.
            // Disable Send during the following authorization, so only the
            // later final readiness loop can observe its eventual activation.
            phase = 'post-initial-readiness';
            initialReadyScans = metrics.counters.readinessChecks;
            document.dispatchEvent(new Event('fixture-late-change'));
          }
          else if (phase === 'post-initial-readiness' && message.type === 'CHECK_RUN'
            && metrics?.counters.readinessChecks === initialReadyScans + 1 && metrics.observations.sendPresent
            && !metrics.observations.sendEnabled && metrics.counters.dispatchAttempts === 0) {
            phase = 'final-readiness-authorized';
          }
          if (finalWait && metrics?.counters.readinessChecks === initialReadyScans + 1) {
            phase = 'mutated';
            document.dispatchEvent(new CustomEvent('fixture-wait-finished', { detail: {
              stage: metrics.stage, reason: metrics.reason, readinessChecks: metrics.counters.readinessChecks, initialReadyScans,
              dispatchAttempts: metrics.counters.dispatchAttempts, renew: message.renew !== false,
              sendDisabled: document.querySelector('button[aria-label="Send"]').disabled,
            } }));
          }
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
        assert.equal(observed.finalMutation, mutation, 'The intended last-wait mutation actually occurred: ' + JSON.stringify(observed.readinessPhases));
        assert.equal(observed.finalMutationPreparedText, 'RESTORED_UNSENT_TEXT');
        assert.equal(observed.finalMutationBeforeSubmit, true, 'The final mutation must precede any submission');
        assert.ok(observed.finalReadinessProof.initialReadyScans > 0);
        assert.deepEqual(observed.finalReadinessProof, { stage: 'readiness', reason: 'waiting-send',
          readinessChecks: observed.finalReadinessProof.initialReadyScans + 1,
          initialReadyScans: observed.finalReadinessProof.initialReadyScans, dispatchAttempts: 0, renew: true, sendDisabled: true },
        'Mutation must follow the final disabled-control scan and authorization, not an observer or initial wait');
        assert.equal(sent.job.sentCount, mutation === 'text' ? 1 : 0, sent.job.statusText);
        assert.equal(sent.job.unknownCount, 0);
        assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, mutation === 'text' ? 1 : 0, mutation === 'text' ? 1 : 0]);
        assert.deepEqual(observed.sentTexts, mutation === 'text' ? ['LATE_OTHER_TEXT'] : []);
        assert.deepEqual(observed.submissionPayloads, mutation === 'text' ? [{ text: 'LATE_OTHER_TEXT', attachments: 0, files: 0 }] : []);
        if (mutation === 'text') {
          assert.deepEqual(await page.locator('article.message-row.self .message-body').allTextContents(), ['LATE_OTHER_TEXT']);
          assert.equal(observed.submissionStates[0].sendDisabled, false);
          const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
          assert.deepEqual([trace.counters.domWrites, trace.counters.fillCalls, trace.counters.dispatchAttempts], [1, 1, 1]);
        }
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
      await worker.evaluate(() => { rejectReloadedPrepare(); delete globalThis.rejectReloadedPrepare; });
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
  // Nonempty prepared rewrites can be adopted. A page clearing the model
  // leaves nothing sendable and must still exercise the slow recovery path.
  await scenario('A continuously cleared supported MAIN composer retries the same reservation slowly until Pause without dispatching', async page => {
    const restored = '';
    await page.evaluate(({ prompt, restored }) => {
      pm.dom.editor = { view: pm };
      fixture.extensionModelWrites = 0;
      fixture.pageRestores = 0;
      const originalDispatch = pm.props.dispatchTransaction;
      pm.setProps({ dispatchTransaction(transaction) {
        originalDispatch.call(pm, transaction);
        if (!fixture.restoring && transaction.docChanged
          && pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n') === prompt) {
          fixture.extensionModelWrites++;
          fixture.restoring = true;
          try { pm.dispatch(pm.state.tr.insertText(restored, 0, pm.state.doc.content.size)); }
          finally { fixture.restoring = false; }
          fixture.pageRestores++;
        }
      } });
    }, { prompt, restored });
    await worker.evaluate(() => {
      globalThis.originalUnstableExecute = chrome.scripting.executeScript;
      globalThis.unstableMainResults = [];
      chrome.scripting.executeScript = async request => {
        const entry = request.func?.name === 'editorCommit' ? {
          world: request.world, phase: request.args[0].phase, token: request.args[0].receiptBoundaryToken, startedAt: Date.now(),
        } : null;
        if (entry) unstableMainResults.push(entry);
        const frames = await originalUnstableExecute(request);
        if (entry) Object.assign(entry, { endedAt: Date.now(), result: frames.find(frame => frame.frameId === 0)?.result });
        return frames;
      };
    });
    let sending;
    try {
      assert.equal(await page.evaluate(() => pm.dom.editor.view === pm), true);
      const started = await start(page, { sendMethod: 'auto', intervalMinutes: 30 });
      sending = call({ type: 'SEND_NOW' });
      const deadline = Date.now() + 10000;
      let results;
      do {
        results = await worker.evaluate(() => unstableMainResults);
        if (results.filter(entry => entry.result?.code === 'composer-unstable').length >= 3) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      } while (Date.now() < deadline);
      assert.ok(results.filter(entry => entry.result?.code === 'composer-unstable').length >= 3,
        'The same pending send must retry repeated model instability');
      const job = (await call({ type: 'GET_STATE' })).job;
      const observed = await inspect(page);
      results = await worker.evaluate(() => unstableMainResults);
      assert.ok(results.every(entry => entry.world === 'MAIN' && entry.phase === 'prepare'));
      assert.ok(results[0].token && results.every(entry => entry.token === results[0].token), 'Retries must retain the same receipt reservation');
      const completed = results.filter(entry => entry.result);
      assert.ok(completed.every(entry => entry.result.supported === true && entry.result.dispatched === false
        && entry.result.code === 'composer-unstable' && entry.result.diagnosticProgress.counters.dispatchAttempts === 0));
      assert.ok(completed.slice(1).every((entry, index) => entry.startedAt - completed[index].endedAt >= 250),
        'Retries must back off rather than repeatedly writing in a tight loop');
      assert.ok(observed.extensionModelWrites >= 3);
      assert.equal(observed.pageRestores, observed.extensionModelWrites);
      assert.equal(await page.evaluate(() => pm.state.doc.textContent), restored);
      assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [0, 0, 0]);
      assert.deepEqual(observed.sentTexts, []);
      assert.equal(job.id, started.job.id);
      assert.equal(job.enabled, true);
      assert.equal(job.phase, 'sending');
      assert.ok(job.runId);
      assert.equal(job.sentCount, 0);
      assert.equal(job.unknownCount, 0);
      const paused = await call({ type: 'PAUSE' });
      assert.equal(paused.ok, true, paused.error);
      assert.equal(paused.job.enabled, false);
      const outcome = await sending;
      assert.equal(outcome.job.enabled, false);
      assert.equal(outcome.job.sentCount, 0);
      const stoppedResults = await worker.evaluate(() => unstableMainResults);
      assert.ok(stoppedResults.every(entry => entry.phase === 'prepare' && entry.token === results[0].token),
        'No commit or new reservation may appear before Pause completes');
      const stopped = await inspect(page);
      await new Promise(resolve => setTimeout(resolve, 1000));
      assert.deepEqual(await worker.evaluate(() => unstableMainResults), stoppedResults, 'Pause must stop subsequent preparation attempts');
      const afterPause = await inspect(page);
      assert.equal(afterPause.extensionModelWrites, stopped.extensionModelWrites, 'Pause must stop model rewrites');
      assert.deepEqual([afterPause.buttonClicks, afterPause.keyboardCommands, afterPause.submits], [0, 0, 0]);
      assert.deepEqual(afterPause.sentTexts, []);
      assert.equal((await call({ type: 'GET_STATE' })).job.enabled, false);
    } finally {
      await call({ type: 'PAUSE' });
      if (sending) await sending;
      await worker.evaluate(() => {
        chrome.scripting.executeScript = originalUnstableExecute;
        delete globalThis.originalUnstableExecute; delete globalThis.unstableMainResults;
      });
    }
  });
  await scenario('A finite series of MAIN model clears backs off and sends the exact prompt once', async page => {
    const restored = '';
    const restoreLimit = 3;
    await page.evaluate(({ prompt, restored, restoreLimit }) => {
      pm.dom.editor = { view: pm };
      fixture.finiteWrites = [];
      fixture.finiteRestores = [];
      const originalDispatch = pm.props.dispatchTransaction;
      pm.setProps({ dispatchTransaction(transaction) {
        originalDispatch.call(pm, transaction);
        if (!fixture.restoring && transaction.docChanged
          && pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n') === prompt) {
          fixture.finiteWrites.push(performance.now());
          if (fixture.finiteRestores.length < restoreLimit) {
            fixture.restoring = true;
            try { pm.dispatch(pm.state.tr.insertText(restored, 0, pm.state.doc.content.size)); }
            finally { fixture.restoring = false; }
            fixture.finiteRestores.push(performance.now());
          }
        }
      } });
    }, { prompt, restored, restoreLimit });
    await worker.evaluate(() => {
      globalThis.originalFiniteExecute = chrome.scripting.executeScript;
      globalThis.finiteMainResults = [];
      chrome.scripting.executeScript = async request => {
        const startedAt = Date.now();
        const frames = await originalFiniteExecute(request);
        if (request.func?.name === 'editorCommit') finiteMainResults.push({
          world: request.world, phase: request.args[0].phase, startedAt, endedAt: Date.now(),
          result: frames.find(frame => frame.frameId === 0)?.result,
        });
        return frames;
      };
    });
    let sending;
    let timer;
    try {
      assert.equal(await page.evaluate(() => pm.dom.editor.view === pm), true);
      await start(page, { sendMethod: 'auto', intervalMinutes: 30 });
      sending = call({ type: 'SEND_NOW' });
      const settled = await Promise.race([
        sending.then(result => ({ result })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 10000); }),
      ]);
      clearTimeout(timer);
      const observed = await inspect(page);
      const results = await worker.evaluate(() => finiteMainResults);
      const stored = await worker.evaluate(async () => chrome.storage.local.get('deliveryDiagnostics'));
      const gapsMs = observed.finiteWrites.slice(1).map((at, index) => at - observed.finiteWrites[index]);
      console.log('FINITE MAIN REWRITE ' + JSON.stringify({ writes: observed.finiteWrites, restores: observed.finiteRestores,
        gapsMs, results, diagnostics: stored.deliveryDiagnostics?.at(-1), timedOut: !!settled.timedOut,
        sentCount: settled.result?.job.sentCount, lastResult: settled.result?.job.lastResult }));
      assert.ok(results.some(entry => entry.world === 'MAIN' && entry.result?.supported === true), 'Use the actual supported MAIN model path');
      assert.ok(observed.finiteRestores.length >= 2, 'The page must actually rewrite the model at least twice');
      assert.equal(settled.timedOut, undefined, 'A finite sequence of page rewrites must eventually settle');
      assert.equal(settled.result.ok, true, settled.result.error);
      assert.equal(settled.result.job.sentCount, 1, 'Finite page rewrites must not block the only authorized send');
      assert.equal(settled.result.job.unknownCount, 0);
      assert.equal(observed.finiteRestores.length, restoreLimit);
      assert.ok(observed.finiteWrites.length >= restoreLimit + 1 && observed.finiteWrites.length <= restoreLimit + 3);
      assert.ok(gapsMs.slice(1).every(gap => gap >= 75), 'Later correction writes must use a real backoff instead of a tight loop');
      assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [1, 0, 1]);
      assert.deepEqual(observed.sentTexts, [prompt]);
      assert.equal((await page.locator('article.message-row.self .message-body').allTextContents()).length, 1);
    } finally {
      clearTimeout(timer);
      await call({ type: 'PAUSE' });
      if (sending) await sending;
      await worker.evaluate(() => {
        chrome.scripting.executeScript = originalFiniteExecute;
        delete globalThis.originalFiniteExecute; delete globalThis.finiteMainResults;
      });
    }
  });
  await scenario('A final MAIN commit that proves model instability after a clear backs off in the same reservation and sends once', async page => {
    const restored = '';
    const restoreLimit = 3;
    await page.evaluate(({ prompt, restored, restoreLimit }) => {
      pm.dom.editor = { view: pm };
      fixture.finalCommitArmed = false;
      fixture.finalCommitWrites = [];
      fixture.finalCommitRestores = [];
      const originalDispatch = pm.props.dispatchTransaction;
      pm.setProps({ dispatchTransaction(transaction) {
        originalDispatch.call(pm, transaction);
        if (fixture.finalCommitArmed && !fixture.restoring && transaction.docChanged
          && pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n') === prompt) {
          fixture.finalCommitWrites.push(performance.now());
          if (fixture.finalCommitRestores.length < restoreLimit) {
            fixture.restoring = true;
            try { pm.dispatch(pm.state.tr.insertText(restored, 0, pm.state.doc.content.size)); }
            finally { fixture.restoring = false; }
            fixture.finalCommitRestores.push(performance.now());
          }
        }
      } });
    }, { prompt, restored, restoreLimit });
    await worker.evaluate(restored => {
      globalThis.originalFinalModelExecute = chrome.scripting.executeScript;
      globalThis.finalModelResults = [];
      globalThis.finalModelArmed = false;
      chrome.scripting.executeScript = async request => {
        if (request.func?.name !== 'editorCommit') return originalFinalModelExecute(request);
        const phase = request.args[0].phase;
        if (phase === 'commit' && !finalModelArmed) {
          finalModelArmed = true;
          await originalFinalModelExecute({ target: request.target, world: 'MAIN', func: text => {
            fixture.finalCommitArmed = true;
            pm.dispatch(pm.state.tr.insertText(text, 0, pm.state.doc.content.size));
          }, args: [restored] });
        }
        const entry = { world: request.world, phase, token: request.args[0].receiptBoundaryToken, startedAt: Date.now() };
        finalModelResults.push(entry);
        const frames = await originalFinalModelExecute(request);
        Object.assign(entry, { endedAt: Date.now(), result: frames.find(frame => frame.frameId === 0)?.result });
        return frames;
      };
    }, restored);
    let sending;
    let timer;
    try {
      const started = await start(page, { sendMethod: 'auto', intervalMinutes: 30 });
      sending = call({ type: 'SEND_NOW' });
      const settled = await Promise.race([
        sending.then(result => ({ result })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 10000); }),
      ]);
      clearTimeout(timer);
      const results = await worker.evaluate(() => finalModelResults);
      const observed = await inspect(page);
      const firstCommit = results.findIndex(entry => entry.phase === 'commit');
      assert.ok(firstCommit >= 0, 'The page mutation must reach the final MAIN commit');
      const failed = results[firstCommit];
      assert.equal(failed.world, 'MAIN');
      assert.equal(failed.result?.supported, true);
      assert.equal(failed.result?.dispatched, false);
      assert.equal(failed.result?.code, 'composer-unstable');
      assert.equal(failed.result?.diagnosticProgress.counters.dispatchAttempts, 0);
      assert.ok(failed.token && results.every(entry => entry.token === failed.token), 'Recovery must retain the same receipt reservation');
      const recovery = results.slice(firstCommit + 1);
      assert.ok(recovery.length > 0, 'The explicitly undispatched commit must be retried without a new reservation');
      assert.ok(recovery[0].startedAt - failed.endedAt >= 250, 'The first recovery attempt must back off');
      assert.equal(observed.finalCommitRestores.length, restoreLimit, 'The page must restore the model repeatedly after final authorization');
      assert.equal(settled.timedOut, undefined, 'Finite instability must recover without another Send now');
      assert.equal(settled.result.ok, true, settled.result.error);
      assert.equal(settled.result.job.id, started.job.id);
      assert.equal(settled.result.job.sentCount, 1);
      assert.equal(settled.result.job.unknownCount, 0);
      const commits = results.filter(entry => entry.phase === 'commit');
      assert.equal(commits.filter(entry => entry.result?.dispatched === true).length, 1);
      assert.ok(commits.filter(entry => entry.result?.dispatched === false).every(entry => entry.result.diagnosticProgress.counters.dispatchAttempts === 0));
      const gaps = observed.finalCommitWrites.slice(1).map((at, index) => at - observed.finalCommitWrites[index]);
      assert.ok(gaps.every(gap => gap >= 250), 'Repeated model corrections must back off');
      assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [1, 0, 1]);
      assert.deepEqual(observed.sentTexts, [prompt]);
      assert.deepEqual(observed.submissionPayloads, [{ text: prompt, attachments: 0, files: 0 }]);
      assert.equal((await page.locator('article.message-row.self .message-body').allTextContents()).length, 1);
      await new Promise(resolve => setTimeout(resolve, 1000));
      assert.deepEqual((await inspect(page)).sentTexts, [prompt], 'Recovery must not replay a successful submission');
    } finally {
      clearTimeout(timer);
      await call({ type: 'PAUSE' });
      if (sending) await sending;
      await worker.evaluate(() => {
        chrome.scripting.executeScript = originalFinalModelExecute;
        delete globalThis.originalFinalModelExecute; delete globalThis.finalModelResults; delete globalThis.finalModelArmed;
      });
    }
  });
  for (const finite of [false, true]) await scenario(finite
    ? 'Finite legacy composer clears back off and send the exact prompt once'
    : 'Continuous legacy composer clears back off until Pause and never submit', async page => {
    const restored = '';
    const restoreLimit = finite ? 3 : Number.MAX_SAFE_INTEGER;
    await page.evaluate(({ prompt, restored, restoreLimit }) => {
      fixture.legacyWrites = [];
      fixture.legacyRestores = [];
      const originalDispatch = pm.props.dispatchTransaction;
      pm.setProps({ dispatchTransaction(transaction) {
        originalDispatch.call(pm, transaction);
        if (!fixture.restoring && transaction.docChanged
          && pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n') === prompt) {
          fixture.legacyWrites.push(performance.now());
          if (fixture.legacyRestores.length < restoreLimit) {
            fixture.restoring = true;
            try { pm.dispatch(pm.state.tr.insertText(restored, 0, pm.state.doc.content.size)); }
            finally { fixture.restoring = false; }
            fixture.legacyRestores.push(performance.now());
          }
        }
      } });
    }, { prompt, restored, restoreLimit });
    await worker.evaluate(() => {
      globalThis.originalLegacyRecoveryExecute = chrome.scripting.executeScript;
      globalThis.legacyRecoveryProbe = { admissions: [], modelResults: [] };
      chrome.scripting.executeScript = async request => {
        const admission = request.func?.name === 'pageAction' && request.args[0].mode === 'send'
          ? { runId: request.args[0].runId, startedAt: Date.now() } : null;
        if (admission) legacyRecoveryProbe.admissions.push(admission);
        const frames = await originalLegacyRecoveryExecute(request);
        const result = frames.find(frame => frame.frameId === 0)?.result;
        if (admission) Object.assign(admission, { endedAt: Date.now(), result });
        if (request.func?.name === 'editorCommit') legacyRecoveryProbe.modelResults.push({ world: request.world, result });
        return frames;
      };
    });
    let sending;
    let timer;
    try {
      assert.equal(await page.evaluate(() => !!pm.dom.editor?.view), false, 'The fixture must use the legacy event path');
      const started = await start(page, { sendMethod: 'auto', intervalMinutes: 30 });
      sending = call({ type: 'SEND_NOW' });
      await page.waitForFunction(() => fixture.legacyRestores.length >= 3, null, { polling: 100, timeout: 25000 });
      const waiting = await inspect(page);
      const job = (await call({ type: 'GET_STATE' })).job;
      const probe = await worker.evaluate(() => legacyRecoveryProbe);
      assert.ok(probe.modelResults.some(entry => entry.world === 'MAIN' && entry.result?.supported === false),
        'The real extension must reject the unsupported MAIN model before falling back');
      assert.equal(probe.admissions.length, 1, 'Corrections must remain in the original page admission');
      assert.equal(job.id, started.job.id);
      assert.equal(job.enabled, true);
      assert.equal(job.sentCount, 0);
      assert.equal(job.unknownCount, 0);
      assert.deepEqual([waiting.buttonClicks, waiting.keyboardCommands, waiting.submits], [0, 0, 0]);
      assert.ok(waiting.legacyWrites[2] - waiting.legacyWrites[1] >= 8000,
        'Repeated legacy corrections must back off rather than write in a tight loop');
      if (finite) {
        const settled = await Promise.race([
          sending.then(result => ({ result })),
          new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 25000); }),
        ]);
        assert.equal(settled.timedOut, undefined, 'Finite restores must recover without another Send now');
        assert.equal(settled.result.ok, true, settled.result.error);
        assert.equal(settled.result.job.id, started.job.id);
        assert.equal(settled.result.job.sentCount, 1);
        assert.equal(settled.result.job.unknownCount, 0);
        const observed = await inspect(page);
        assert.equal(observed.legacyRestores.length, restoreLimit);
        assert.equal(observed.legacyWrites.length, restoreLimit + 1);
        assert.ok(observed.legacyWrites[3] - observed.legacyWrites[2] >= 8000);
        assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [1, 0, 1]);
        assert.deepEqual(observed.sentTexts, [prompt]);
        assert.deepEqual(observed.submissionPayloads, [{ text: prompt, attachments: 0, files: 0 }]);
        assert.deepEqual(await page.locator('article.message-row.self .message-body').allTextContents(), [prompt]);
        await new Promise(resolve => setTimeout(resolve, 1200));
        assert.deepEqual((await inspect(page)).sentTexts, [prompt], 'A confirmed send must not replay');
      } else {
        assert.equal(await page.evaluate(() => pm.state.doc.textContent), restored);
        const paused = await call({ type: 'PAUSE' });
        assert.equal(paused.ok, true, paused.error);
        assert.equal(paused.job.enabled, false);
        const outcome = await sending;
        assert.equal(outcome.job.sentCount, 0);
        assert.equal(outcome.job.unknownCount, 0);
        const stopped = await inspect(page);
        const stoppedAdmissions = await worker.evaluate(() => legacyRecoveryProbe.admissions.length);
        await new Promise(resolve => setTimeout(resolve, 11000));
        const afterPause = await inspect(page);
        assert.deepEqual(afterPause.legacyWrites, stopped.legacyWrites, 'Pause must cancel the next delayed correction');
        assert.deepEqual(afterPause.legacyRestores, stopped.legacyRestores);
        assert.equal(await worker.evaluate(() => legacyRecoveryProbe.admissions.length), stoppedAdmissions);
        assert.deepEqual([afterPause.buttonClicks, afterPause.keyboardCommands, afterPause.submits], [0, 0, 0]);
        assert.deepEqual(afterPause.sentTexts, []);
        assert.equal((await call({ type: 'SEND_NOW' })).ok, false);
      }
    } finally {
      clearTimeout(timer);
      await call({ type: 'PAUSE' });
      if (sending) await sending;
      await worker.evaluate(() => {
        chrome.scripting.executeScript = originalLegacyRecoveryExecute;
        delete globalThis.originalLegacyRecoveryExecute;
        delete globalThis.legacyRecoveryProbe;
      });
    }
  });
  await scenario('A measured slow legacy write adopts the nonempty changed composer without another page admission', async page => {
    const started = await start(page, { sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => {
      globalThis.originalSlowWriteExecute = chrome.scripting.executeScript;
      globalThis.slowWriteAdmissions = 0;
      const execute = originalSlowWriteExecute;
      await execute({ target: { tabId }, world: 'ISOLATED', func: () => {
        const original = document.execCommand.bind(document);
        let measured = 0;
        Object.defineProperty(performance, 'now', { configurable: true, value: () => measured });
        document.execCommand = (command, showUI, value) => {
          const result = original(command, showUI, value);
          if (command === 'insertText') {
            measured += 3000;
            document.querySelector('[data-composer-markdown]').dispatchEvent(new Event('fixture-slow-restore'));
          }
          return result;
        };
      } });
      chrome.scripting.executeScript = async request => {
        if (request.func?.name === 'pageAction' && request.args[0].mode === 'send') slowWriteAdmissions++;
        return execute(request);
      };
    }, started.job.tabId);
    await page.evaluate(() => {
      fixture.slowRestores = 0;
      pm.dom.addEventListener('fixture-slow-restore', () => {
        fixture.slowRestores++;
        pm.dispatch(pm.state.tr.insertText('SYNTHETIC_RESTORED_AFTER_SLOW_WRITE', 0, pm.state.doc.content.size));
      });
    });
    let sending, timeout;
    try {
      sending = call({ type: 'SEND_NOW' });
      const outcome = await Promise.race([sending, new Promise(resolve => { timeout = setTimeout(() => resolve(null), 7000); })]);
      assert.ok(outcome, 'A slow changed composer must return without another admission');
      assert.equal(outcome.ok, true, outcome.error);
      assert.equal(outcome.job.lastDiagnosticCode, null);
      assert.equal(outcome.job.lastResult, 'sent');
      assert.equal(outcome.job.sentCount, 1);
      assert.equal(outcome.job.unknownCount, 0);
      assert.equal(outcome.job.prompt, prompt);
      assert.equal(await worker.evaluate(() => slowWriteAdmissions), 1);
      const observed = await inspect(page);
      const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
      assert.equal(observed.slowRestores, 2);
      assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [1, 0, 1]);
      assert.deepEqual(observed.sentTexts, [prompt.split('\n')[0]], 'Characterize the partial prepared value; do not claim original-payload fidelity');
      assert.deepEqual(await page.locator('article.message-row.self .message-body').allTextContents(), observed.sentTexts);
      assert.equal(observed.editorEmpty, true);
      assert.deepEqual([trace.counters.domWrites, trace.counters.fillCalls, trace.counters.dispatchAttempts], [2, 2, 1]);
      assert.equal(trace.timings.maxDomWriteMs, 3000);
    } finally {
      clearTimeout(timeout);
      await call({ type: 'PAUSE' });
      if (sending) await sending;
      await worker.evaluate(() => {
        chrome.scripting.executeScript = originalSlowWriteExecute;
        delete globalThis.originalSlowWriteExecute;
        delete globalThis.slowWriteAdmissions;
      });
    }
  });
  await scenario('A space-normalized receipt confirms one MV3 submission without another dispatch', async page => {
    const expected = 'MV3_SYNTHETIC\u00a0RECEIPT';
    await start(page, { prompt: expected, sendMethod: 'button', intervalMinutes: 1 });
    await page.evaluate(() => {
      const history = document.querySelector('#history');
      const append = history.append.bind(history);
      history.append = (...nodes) => {
        for (const node of nodes) {
          const body = node.querySelector?.('.message-body');
          if (body) body.textContent = body.textContent.replace(/\u00a0/g, ' ');
        }
        append(...nodes);
      };
    });
    const result = await call({ type: 'SEND_NOW' });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.job.enabled, true);
    assert.equal(result.job.lastResult, 'sent');
    assert.equal(result.job.lastDiagnosticCode, null);
    assert.equal(result.job.sentCount, 1);
    assert.equal(result.job.unknownCount, 0);
    assert.ok(result.job.nextAt > Date.now());
    const observed = await inspect(page);
    assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [1, 0, 1]);
    assert.deepEqual(observed.sentTexts, [expected]);
    assert.deepEqual(await page.locator('article.message-row.self .message-body').allTextContents(), [expected.replace(/\u00a0/g, ' ')]);
    assert.equal((await worker.evaluate(() => chrome.alarms.getAll())).length, 1);
  });
  await scenario('A replaced document after dispatch pauses an unknown MV3 submission without replay', async page => {
    await start(page, { sendMethod: 'button', intervalMinutes: 1 });
    await page.evaluate(() => {
      globalThis.fixtureSubmitted = new Promise(resolve => {
        document.querySelector('button[aria-label="Send"]').addEventListener('click', resolve, { once: true });
      });
    });
    const sending = call({ type: 'SEND_NOW' });
    await page.evaluate(() => globalThis.fixtureSubmitted);
    await page.goto('https://chatgpt.com/dots/pm-65?replacement=1');
    await page.waitForFunction(() => window.fixtureReady);
    const outcome = await sending;
    assert.equal(outcome.ok, true, outcome.error);
    assert.equal(outcome.job.enabled, false);
    assert.equal(outcome.job.lastResult, 'unknown');
    assert.equal(outcome.job.sentCount, 0);
    assert.equal(outcome.job.unknownCount, 1);
    assert.equal(outcome.job.nextAt, null);
    assert.equal((await call({ type: 'SEND_NOW' })).ok, false);
    assert.equal((await worker.evaluate(() => chrome.alarms.getAll())).length, 0);
    assert.equal((await inspect(page)).submits, 0);
  });
  await scenario('A mismatched new receipt pauses the actual MV3 task with a content-free diagnostic', async page => {
    const expected = 'MV3_SYNTHETIC_EXPECTED_PRIVATE';
    await start(page, { prompt: expected, sendMethod: 'button', intervalMinutes: 1 });
    await page.evaluate(() => {
      const history = document.querySelector('#history');
      const append = history.append.bind(history);
      history.append = (...nodes) => {
        for (const node of nodes) {
          const body = node.querySelector?.('.message-body');
          if (body) body.textContent = 'MV3_SYNTHETIC_OTHER_MESSAGE';
        }
        append(...nodes);
      };
    });
    let timeout;
    const result = await Promise.race([
      call({ type: 'SEND_NOW' }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Mismatched receipt did not pause')), 10000); }),
    ]).finally(() => clearTimeout(timeout));
    assert.equal(result.ok, true, result.error);
    assert.equal(result.job.enabled, false);
    assert.equal(result.job.lastResult, 'unknown');
    assert.equal(result.job.lastDiagnosticCode, 'receipt-mismatch');
    assert.equal(result.job.sentCount, 0);
    assert.equal(result.job.unknownCount, 1);
    assert.equal(result.job.nextAt, null);
    assert.equal((await call({ type: 'SEND_NOW' })).ok, false);
    const observed = await inspect(page);
    assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [1, 0, 1]);
    assert.deepEqual(observed.sentTexts, [expected]);
    assert.equal((await worker.evaluate(() => chrome.alarms.getAll())).length, 0);
    const local = await worker.evaluate(() => chrome.storage.local.get(['logs', 'deliveryDiagnostics']));
    const exported = await control.evaluate(async local => {
      const { buildActivityExport } = await import(chrome.runtime.getURL('activity-export.js'));
      return buildActivityExport({ logs: local.logs, deliveries: local.deliveryDiagnostics });
    }, local);
    assert.equal(exported.logs.findLast(entry => entry.event === 'unconfirmed')?.diagnostic?.code, 'receipt-mismatch');
    assert.equal(JSON.stringify(exported).includes(expected), false);
  });
  await scenario('A paused MV3 extension prepares the exact synthetic draft as a manually numbered TXT', async page => {
    const text = 'MV3_SYNTHETIC 中文 🧭\r\n\n\tEnd  ';
    await start(page, { prompt: text, sendMethod: 'button' });
    const paused = await call({ type: 'PAUSE' });
    assert.equal(paused.ok, true);
    assert.equal(paused.job.enabled, false);
    await control.bringToFront();
    await control.waitForFunction(() => !document.querySelector('#exportPromptTxt').disabled);
    await control.evaluate(() => {
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = blob => { globalThis.syntheticExportBlob = blob; return create(blob); };
      HTMLAnchorElement.prototype.click = function () { globalThis.syntheticExportName = this.download; };
    });
    await control.locator('#tab-prompt').click();
    await control.locator('#manualTxtNotice').locator('..').locator('summary').click();
    await control.locator('#manualSubmissionSequence').fill('9');
    await control.locator('#exportPromptTxt').click();
    await control.waitForFunction(() => globalThis.syntheticExportBlob instanceof Blob
      && typeof globalThis.syntheticExportName === 'string');
    const exported = await control.evaluate(async () => ({ name: globalThis.syntheticExportName,
      bytes: [...new Uint8Array(await globalThis.syntheticExportBlob.arrayBuffer())] }));
    assert.match(exported.name, /^agent-continue-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-9\.txt$/);
    assert.deepEqual(exported.bytes, [...Buffer.from(text, 'utf8')]);
    assert.equal((await inspect(page)).submits, 0);
    assert.equal((await call({ type: 'GET_STATE' })).job.enabled, false);
  });
  await scenario('Pause in the real popup fences a Start waiting on local draft persistence', async page => {
    await call({ type: 'PAUSE' });
    const tab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(item => item.url === url), page.url());
    await control.bringToFront();
    await control.reload();
    await control.waitForFunction(() => !document.querySelector('#start').disabled && document.querySelector('#targetSelect').options.length > 1);
    await control.locator('#targetSelect').selectOption(String(tab.id));
    await control.locator('#tab-prompt').click();
    await control.locator('#togglePrompt').click();
    await control.locator('#prompt').fill('MV3_SYNTHETIC_PAUSE_DURING_START');
    await control.locator('#tab-task').click();
    await control.evaluate(() => {
      const actual = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = message => message.type === 'SAVE_DRAFT'
        ? new Promise((resolve, reject) => {
          globalThis.releaseSyntheticSave = () => actual(message).then(resolve, reject);
        }) : actual(message);
    });
    try {
      await control.locator('#start').click();
      await control.waitForFunction(() => typeof globalThis.releaseSyntheticSave === 'function');
      assert.equal(await control.locator('#pause').isVisible(), true);
      await control.locator('#pause').click();
      await control.waitForFunction(() => document.querySelector('#pause').hidden && !document.querySelector('#start').hidden);
      await control.evaluate(() => globalThis.releaseSyntheticSave());
      await control.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const state = await call({ type: 'GET_STATE' });
      assert.equal(state.ok, true);
      assert.equal(state.job?.enabled ?? false, false);
      assert.equal(state.job?.phase === 'sending', false);
      assert.equal((await inspect(page)).submits, 0);
      assert.equal((await worker.evaluate(() => chrome.alarms.getAll())).length, 0);
    } finally { await control.reload(); }
  });
  await scenario('Pause in another real popup fences a Start waiting on local draft persistence', async page => {
    await call({ type: 'PAUSE' });
    const tab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(item => item.url === url), page.url());
    await control.bringToFront();
    await control.reload();
    await control.waitForFunction(() => !document.querySelector('#start').disabled && document.querySelector('#targetSelect').options.length > 1);
    await control.locator('#targetSelect').selectOption(String(tab.id));
    await control.locator('#tab-prompt').click();
    await control.locator('#togglePrompt').click();
    await control.locator('#prompt').fill('MV3_SYNTHETIC_CROSS_PANEL_PAUSE');
    await control.locator('#tab-task').click();
    await control.evaluate(() => {
      const actual = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = message => message.type === 'SAVE_DRAFT'
        ? new Promise((resolve, reject) => {
          globalThis.releaseCrossPanelSave = () => actual(message).then(resolve, reject);
        }) : actual(message);
    });
    const second = await newPage(`chrome-extension://${new URL(worker.url()).host}/popup.html?view=full`);
    try {
      await control.bringToFront();
      await control.locator('#start').click();
      await control.waitForFunction(() => typeof globalThis.releaseCrossPanelSave === 'function');
      const paused = await second.evaluate(() => chrome.runtime.sendMessage({ type: 'PAUSE' }));
      assert.equal(paused.ok, true);
      await control.evaluate(() => globalThis.releaseCrossPanelSave());
      await control.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const state = await call({ type: 'GET_STATE' });
      assert.equal(state.ok, true);
      assert.equal(state.job?.enabled ?? false, false, 'a cross-panel Pause must fence the delayed Start');
      assert.equal(state.job?.phase === 'sending', false);
      assert.equal((await inspect(page)).submits, 0);
      assert.equal((await worker.evaluate(() => chrome.alarms.getAll())).length, 0);
    } finally { await second.close(); await control.reload(); }
  });
  await scenario('A reserved Start interrupted by a real MV3 worker restart never activates afterward', async page => {
    await call({ type: 'PAUSE' });
    const tab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(item => item.url === url), page.url());
    await control.bringToFront();
    await control.reload();
    await control.waitForFunction(() => !document.querySelector('#start').disabled && document.querySelector('#targetSelect').options.length > 1);
    await control.locator('#targetSelect').selectOption(String(tab.id));
    await control.locator('#tab-prompt').click();
    await control.locator('#togglePrompt').click();
    await control.locator('#prompt').fill('MV3_SYNTHETIC_RESTART_DURING_START');
    await control.locator('#tab-task').click();
    await control.evaluate(() => {
      const actual = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = message => message.type === 'SAVE_DRAFT'
        ? new Promise((resolve, reject) => {
          globalThis.releaseRestartSave = () => actual(message).then(resolve, reject);
        }) : actual(message);
    });
    try {
      await control.locator('#start').click();
      await control.waitForFunction(() => typeof globalThis.releaseRestartSave === 'function');
      const session = await context.newCDPSession(control);
      const versions = new Map();
      session.on('ServiceWorker.workerVersionUpdated', event => {
        for (const version of event.versions) versions.set(version.versionId, version);
      });
      await session.send('ServiceWorker.enable');
      await control.waitForFunction(() => document.readyState === 'complete');
      const started = Date.now();
      while (![...versions.values()].some(version => version.scriptURL === worker.url() && version.runningStatus === 'running')
          && Date.now() - started < 5000) await new Promise(resolve => setTimeout(resolve, 50));
      const running = [...versions.values()].find(version => version.scriptURL === worker.url() && version.runningStatus === 'running');
      assert.ok(running, 'The isolated running worker version must be observed before stopping');
      await session.send('ServiceWorker.stopWorker', { versionId: running.versionId });
      const stoppedAt = Date.now();
      while (versions.get(running.versionId)?.runningStatus !== 'stopped' && Date.now() - stoppedAt < 5000)
        await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(versions.get(running.versionId)?.runningStatus, 'stopped');
      await control.evaluate(() => globalThis.releaseRestartSave());
      await control.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const state = await call({ type: 'GET_STATE' });
      worker = context.serviceWorkers().find(item => item.url().endsWith('/background.js'))
        || await context.waitForEvent('serviceworker', { predicate: item => item.url().endsWith('/background.js'), timeout: 15000 });
      assert.equal(state.ok, true);
      assert.equal(state.job?.enabled ?? false, false);
      assert.equal(state.job?.phase === 'sending', false);
      assert.equal((await inspect(page)).submits, 0);
      assert.equal((await worker.evaluate(() => chrome.alarms.getAll())).length, 0);
    } finally { await control.reload(); }
  });
  await scenario('A real popup START commits only its reserved prepared synthetic draft', async page => {
    await call({ type: 'PAUSE' });
    const tab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(item => item.url === url), page.url());
    await control.bringToFront();
    await control.reload();
    await control.waitForFunction(() => !document.querySelector('#start').disabled && document.querySelector('#targetSelect').options.length > 1);
    await control.locator('#targetSelect').selectOption(String(tab.id));
    await control.locator('#tab-prompt').click();
    await control.locator('#togglePrompt').click();
    await control.locator('#prompt').fill('MV3_SYNTHETIC_RESERVED_START_SUCCESS');
    await control.locator('#tab-task').click();
    await control.locator('#start').click();
    await control.waitForFunction(() => document.querySelector('#badge').textContent === 'Running');
    const state = await call({ type: 'GET_STATE' });
    assert.equal(state.ok, true);
    assert.equal(state.job?.enabled, true);
    assert.equal(state.job?.tabId, tab.id);
    assert.equal(state.job?.prompt, 'MV3_SYNTHETIC_RESERVED_START_SUCCESS');
    assert.equal((await inspect(page)).submits, 0);
    assert.equal((await worker.evaluate(() => chrome.alarms.getAll())).length, 1);
  });
  await scenario('A real popup cancels a TXT download when its draft changes during the pause check', async page => {
    const text = 'MV3_SYNTHETIC_EXACT_DRAFT';
    await start(page, { prompt: text, sendMethod: 'button' });
    assert.equal((await call({ type: 'PAUSE' })).job.enabled, false);
    await control.bringToFront();
    await control.reload();
    await control.waitForFunction(() => !document.querySelector('#exportPromptTxt').disabled);
    await control.locator('#tab-prompt').click();
    await control.locator('#manualTxtNotice').locator('..').locator('summary').click();
    await control.locator('#manualSubmissionSequence').fill('4');
    await control.locator('#togglePrompt').click();
    await control.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      const create = URL.createObjectURL.bind(URL);
      globalThis.syntheticDownloads = 0;
      URL.createObjectURL = blob => { syntheticDownloads++; return create(blob); };
      chrome.runtime.sendMessage = message => message.type === 'GET_STATE'
        ? new Promise((resolve, reject) => {
          globalThis.releaseSyntheticState = () => send(message).then(resolve, reject);
        }) : send(message);
    });
    try {
      await control.locator('#exportPromptTxt').click();
      await control.waitForFunction(() => typeof globalThis.releaseSyntheticState === 'function');
      await control.locator('#prompt').fill('MV3_SYNTHETIC_INTERVENING_DRAFT');
      await control.locator('#prompt').fill(text);
      await control.evaluate(() => globalThis.releaseSyntheticState());
      await control.waitForFunction(() => document.querySelector('#feedback').classList.contains('error'));
      assert.equal(await control.evaluate(() => globalThis.syntheticDownloads), 0);
      assert.equal((await worker.evaluate(async () => (await chrome.storage.session.get('job')).job)).enabled, false);
      assert.equal((await inspect(page)).submits, 0);
    } finally { await control.reload(); }
  });
  await scenario('A pending prompt filename reservation survives a real MV3 worker replacement', async page => {
    await start(page, { prompt: 'MV3_SYNTHETIC_FILENAME_RESERVATION', sendMethod: 'button' });
    await worker.evaluate(() => { globalThis.filenameOriginalExecute = chrome.scripting.executeScript; });
    await worker.evaluate(() => {
      chrome.scripting.executeScript = request => request.func.name === 'pageAction' && request.args[0]?.mode === 'send'
        ? new Promise(() => {}) : filenameOriginalExecute(request);
    });
    const sending = call({ type: 'SEND_NOW' }).catch(() => undefined);
    await control.waitForFunction(() => document.querySelector('#badge').textContent === 'Running');
    let reservation;
    const started = Date.now();
    while (!reservation && Date.now() - started < 5000) {
      const job = await worker.evaluate(async () => (await chrome.storage.session.get('job')).job);
      if (job?.phase === 'sending') reservation = job.promptDelivery;
      if (!reservation) await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(reservation?.ordinal, 1);
    assert.ok(Number.isSafeInteger(reservation.issuedAt));
    assert.deepEqual((await worker.evaluate(async () => (await chrome.storage.local.get('resumeJob')).resumeJob)).promptDelivery, reservation);
    const session = await context.newCDPSession(control);
    const versions = new Map();
    session.on('ServiceWorker.workerVersionUpdated', event => {
      for (const version of event.versions) versions.set(version.versionId, version);
    });
    await session.send('ServiceWorker.enable');
    const discoveredAt = Date.now();
    while (![...versions.values()].some(version => version.scriptURL === worker.url() && version.runningStatus === 'running')
        && Date.now() - discoveredAt < 5000) await new Promise(resolve => setTimeout(resolve, 50));
    const running = [...versions.values()].find(version => version.scriptURL === worker.url() && version.runningStatus === 'running');
    assert.ok(running);
    await session.send('ServiceWorker.stopWorker', { versionId: running.versionId });
    const stoppedAt = Date.now();
    while (versions.get(running.versionId)?.runningStatus !== 'stopped' && Date.now() - stoppedAt < 5000)
      await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(versions.get(running.versionId)?.runningStatus, 'stopped');
    await sending;
    const restored = await call({ type: 'GET_STATE' });
    worker = context.serviceWorkers().find(item => item.url().endsWith('/background.js'))
      || await context.waitForEvent('serviceworker', { predicate: item => item.url().endsWith('/background.js'), timeout: 15000 });
    assert.equal(restored.job.enabled, false);
    assert.equal(restored.job.lastResult ?? 'unknown', 'unknown');
    assert.deepEqual(restored.job.promptDelivery, reservation);
    assert.equal((await inspect(page)).submits, 0);
    assert.equal((await worker.evaluate(() => chrome.alarms.getAll())).length, 0);
    await session.detach();
  });
  await scenario('Long text avoids a page paste-to-attachment handler and sends as one message', async page => {
    const longText = Array.from({ length: 101 }, (_, index) =>
      `PM_CONVERT_${String(index).padStart(3, '0')} synthetic line`).join('\n');
    await page.evaluate(() => {
      fixture.pastes = 0;
      pm.dom.addEventListener('paste', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        fixture.pastes++;
        const chip = document.createElement('span');
        chip.dataset.testid = 'attachment';
        chip.textContent = 'Pasted text.md';
        pm.dom.closest('[data-composer-body]').append(chip);
      }, true);
    });
    await start(page, { prompt: longText, sendMethod: 'auto', intervalMinutes: 30 });
    const started = performance.now();
    const result = await call({ type: 'SEND_NOW' });
    const elapsed = performance.now() - started;
    const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics)).at(-1);
    assert.ok(elapsed < 3000);
    assert.equal(result.job.lastResult, 'sent');
    assert.equal(result.job.sentCount, 1);
    assert.equal((await inspect(page)).pastes, 0);
    assert.deepEqual((await inspect(page)).sentTexts, [longText]);
    assert.equal(trace.reason, 'receipt-confirmed');
    assert.ok(trace.counters.textChunks > 1);
    assert.equal(trace.counters.attachmentsRemoved, 0);
    assert.equal(await page.locator('[data-testid="attachment"]').count(), 0);
  });
  const overwriteLong = Array.from({ length: 1200 }, (_, index) =>
    index % 17 === 0 ? '' : `SYNTHETIC_ROUND_${String(index).padStart(4, '0')} 中文 & <literal>`).join('\n');
  for (const [name, configured, hidden, selectionMode] of [
    ['short', 'SYNTHETIC_ROUND_FIRST\n\nSYNTHETIC_ROUND_LAST', false, 'normal'],
    ['long', overwriteLong, false, 'normal'],
    ['long hidden', overwriteLong, true, 'normal'],
    ['long rejected synthetic selection', overwriteLong, false, 'reject-synthetic'],
  ]) await scenario(`Two consecutive ${name} sends completely replace distinct existing drafts`, async page => {
    const foreground = hidden ? await newPage('https://pm-foreground.invalid/full-overwrite') : null;
    const expected = expectedPreparedText(configured);
    try {
      const startedAt = performance.now();
      if (foreground) {
        await foreground.bringToFront();
        await foreground.locator('#work').focus();
        await foreground.locator('#work').evaluate(input => input.setSelectionRange(3, 8));
        await page.waitForFunction(() => document.hidden && !document.hasFocus());
      }
      await page.evaluate(() => {
        fixture.pasteSelections = [];
        fixture.textSelections = [];
        pm.dom.addEventListener('paste', () => {
          const dom = getSelection();
          fixture.pasteSelections.push({ modelFrom: pm.state.selection.from, modelTo: pm.state.selection.to,
            modelSize: pm.state.doc.content.size, domCollapsed: dom.isCollapsed,
            domSelectedCharacters: dom.toString().length });
        }, true);
      });
      if (selectionMode !== 'normal') await page.evaluate(() => document.addEventListener('selectionchange', event => {
        if (!event.isTrusted) event.stopImmediatePropagation();
      }, true));
      const seedDraft = text => page.evaluate(text => {
        const { state } = pm;
        const blocks = text.split('\n').map(line => state.schema.nodes.paragraph.create(null, line ? state.schema.text(line) : null));
        pm.dispatch(state.tr.replaceWith(0, state.doc.content.size, blocks));
      }, text);
      await seedDraft('SYNTHETIC_OLD_DRAFT_ROUND_ONE\nUNCHANGED_OLD_SUFFIX');
      await start(page, { prompt: configured, sendMethod: 'auto', intervalMinutes: 30 });
      const first = await call({ type: 'SEND_NOW' });
      console.log('SYNTHETIC FULL OVERWRITE ' + JSON.stringify(await page.evaluate(configured => {
        const model = pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n');
        return { pasteSelections: fixture.pasteSelections, currentModelExact: model === configured,
          submittedModelExact: fixture.sentTexts[0] === configured,
          modelLength: model.length, expectedLength: configured.length,
          oldDraftPresent: model.includes('SYNTHETIC_OLD_DRAFT_ROUND_ONE'),
          domParagraphs: pm.dom.querySelectorAll('p').length, firstParagraphEmpty: !pm.dom.firstElementChild?.textContent,
          submissions: fixture.submits };
      }, expected)));
      assert.equal(first.ok, true, first.error);
      assert.equal(first.job.sentCount, 1, first.job.statusText);
      assert.equal((await inspect(page)).sentTexts[0] === expected, true);
      await seedDraft('SYNTHETIC_DIFFERENT_OLD_DRAFT_ROUND_TWO\nSECOND_OLD_SUFFIX');
      const second = await call({ type: 'SEND_NOW' });
      assert.equal(second.ok, true, second.error);
      assert.equal(second.job.sentCount, 2, second.job.statusText);
      const observed = await inspect(page);
      assert.equal(observed.sentTexts.length, 2);
      assert.ok(observed.sentTexts.every(text => text === expected));
      assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [2, 0, 2]);
      if (configured === overwriteLong) {
        assert.equal(observed.pasteSelections.length, 0);
      }
      if (foreground) assert.deepEqual(await foreground.locator('#work').evaluate(input => ({
        value: input.value, start: input.selectionStart, end: input.selectionEnd, focused: document.activeElement === input
      })), { value: 'Unrelated synthetic document', start: 3, end: 8, focused: true });
      const traces = await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics);
      const recent = traces.slice(-2);
      assert.equal(recent.length, 2);
      assert.ok(recent.every(trace => trace.counters.domWrites >= 1 && trace.counters.dispatchAttempts === 1));
      if (configured === overwriteLong) assert.ok(recent.every(trace => trace.counters.textChunks > 1));
      console.log('SYNTHETIC REPEATED OVERWRITE ' + JSON.stringify({ name, elapsedMs: performance.now() - startedAt,
        timings: recent.map(trace => trace.timings), writes: recent.map(trace => trace.counters.domWrites) }));
    } finally { if (foreground) await foreground.close(); }
  });
  await scenario('A rejected initial selection is reasserted before long replacement without appending the old draft', async page => {
    const original = 'SYNTHETIC_SELECTION_BLOCKED_DRAFT';
    await page.evaluate(original => {
      fixture.pastes = 0;
      fixture.collapsedSelection = false;
      pm.dispatch(pm.state.tr.insertText(original, 0, pm.state.doc.content.size));
      pm.dom.addEventListener('paste', () => { fixture.pastes++; }, true);
      document.addEventListener('selectionchange', event => {
        event.stopImmediatePropagation();
        if (!getSelection().isCollapsed) {
          getSelection().collapseToEnd();
          fixture.collapsedSelection = true;
        }
      }, true);
    }, original);
    await start(page, { prompt: overwriteLong, sendMethod: 'auto', intervalMinutes: 30 });
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    const text = await page.evaluate(() => pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n'));
    assert.equal(observed.collapsedSelection, true);
    assert.equal(observed.pastes, 0);
    assert.equal(observed.submits, 1);
    assert.equal(result.job.sentCount, 1);
    assert.deepEqual(observed.sentTexts, [overwriteLong]);
    assert.equal(text, '');
    assert.ok(!observed.sentTexts[0].includes(original));
  });
  await scenario('An externally changed draft during selection synchronization is still completely replaced', async page => {
    const configured = Array.from({ length: 101 }, (_, index) => `SYNC_SYNTHETIC_LINE_${index}`).join('\n');
    await page.evaluate(() => {
      fixture.externalSelectionEdits = 0;
      document.addEventListener('selectionchange', event => {
        if (event.isTrusted || fixture.externalSelectionEdits) return;
        fixture.externalSelectionEdits++;
        queueMicrotask(() => pm.dispatch(pm.state.tr.insertText('SYNTHETIC_INTERVENING_DRAFT', 0, pm.state.doc.content.size)));
      }, true);
    });
    await start(page, { prompt: configured, sendMethod: 'auto', intervalMinutes: 30 });
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    assert.equal(observed.externalSelectionEdits, 1);
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.equal(observed.submits, 1);
    assert.equal(observed.sentTexts[0], configured);
  });
  await scenario('A partial initial selection is reasserted before replacing the entire existing draft', async page => {
    const original = 'SYNTHETIC_PARTIAL_SELECTION_MUST_NOT_REMAIN';
    await page.evaluate(original => {
      fixture.pastes = 0;
      fixture.partialSelections = 0;
      pm.dispatch(pm.state.tr.insertText(original, 0, pm.state.doc.content.size));
      pm.dom.addEventListener('paste', () => { fixture.pastes++; }, true);
      document.addEventListener('selectionchange', event => {
        if (event.isTrusted) return;
        const text = pm.dom.querySelector('p')?.firstChild;
        if (!text || text.nodeType !== Node.TEXT_NODE || text.length < 8) return;
        event.stopImmediatePropagation();
        getSelection().setBaseAndExtent(text, 0, text, 5);
        fixture.partialSelections++;
      }, true);
    }, original);
    await start(page, { prompt: overwriteLong, sendMethod: 'auto', intervalMinutes: 30 });
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    assert.ok(observed.partialSelections > 0);
    assert.equal(observed.pastes, 0);
    assert.equal(observed.submits, 1);
    assert.equal(result.job.sentCount, 1);
    assert.deepEqual(observed.sentTexts, [overwriteLong]);
    assert.equal(await page.evaluate(() => pm.state.doc.textContent), '');
    assert.ok(!observed.sentTexts[0].includes(original));
  });
  for (const duringPreparation of ['pause', 'user-edit']) await scenario(duringPreparation === 'pause'
    ? 'Pause during selection synchronization prevents stale text injection'
    : 'A trusted draft edit retires its preparation before one fresh configured-prompt submission', async page => {
    await page.evaluate(() => {
      fixture.pastes = 0;
      pm.dom.addEventListener('paste', () => { fixture.pastes++; }, true);
      pm.dispatch(pm.state.tr.insertText('SYNTHETIC_PAUSE_DRAFT', 0, pm.state.doc.content.size));
    });
    const started = await start(page, { prompt: overwriteLong, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.selectionPause = { held: false };
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && !selectionPause.held) {
          selectionPause.held = true;
          document.documentElement.dataset.selectionPauseHeld = 'true';
          await new Promise(resolve => { selectionPause.release = resolve; });
        }
        return send(message);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    await page.waitForFunction(() => document.documentElement.dataset.selectionPauseHeld === 'true');
    const heldRunId = (await call({ type: 'GET_STATE' })).job.runId;
    try {
      if (duringPreparation === 'pause') {
        const paused = await call({ type: 'PAUSE' });
        assert.equal(paused.job.enabled, false);
      } else {
        await page.bringToFront();
        await page.locator('[data-composer-markdown]').press('End');
        await page.locator('[data-composer-markdown]').press('X');
        assert.ok((await page.evaluate(() => pm.state.doc.textContent)).includes('X'), 'The trusted edit must actually reach the composer');
        assert.equal((await inspect(page)).submits, 0, 'Editing is not a manual Send receipt');
      }
    } finally {
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED',
        func: () => selectionPause.release() }), started.job.tabId);
    }
    const outcome = await sending;
    const observed = await inspect(page);
    assert.equal(observed.pastes, 0);
    const text = await page.evaluate(() => pm.state.doc.textContent);
    if (duringPreparation === 'pause') {
      assert.equal(outcome.job.enabled, false);
      assert.equal(outcome.job.sentCount, 0);
      assert.equal(observed.submits, 0);
      assert.equal(text, 'SYNTHETIC_PAUSE_DRAFT');
    } else {
      assert.notEqual(outcome.job.runId, heldRunId, 'The edited preparation is not silently reused');
      assert.equal(outcome.job.sentCount, 1);
      assert.equal(outcome.job.prompt, overwriteLong);
      assert.equal(observed.submits, 1);
      assert.deepEqual(observed.sentTexts, [overwriteLong]);
      assert.equal(text, '');
    }
  });
  await scenario('Repeated legacy readbacks retain only actual write totals', async page => {
    const restored = '';
    await page.evaluate(({ prompt, restored }) => {
      fixture.readbackWrites = 0;
      const original = pm.props.dispatchTransaction;
      pm.setProps({ dispatchTransaction(transaction) {
        original.call(pm, transaction);
        if (!fixture.readbackRestoring && transaction.docChanged
          && pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n') === prompt) {
          fixture.readbackWrites++;
          fixture.readbackRestoring = true;
          try { pm.dispatch(pm.state.tr.insertText(restored, 0, pm.state.doc.content.size)); }
          finally { fixture.readbackRestoring = false; }
        }
      } });
    }, { prompt, restored });
    const started = await start(page, { sendMethod: 'auto', intervalMinutes: 30 });
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => fixture.readbackWrites >= 3, null, { timeout: 25000 });
      const before = await inspect(page);
      await page.waitForTimeout(4200);
      const after = await inspect(page);
      const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
      assert.equal(after.readbackWrites, before.readbackWrites);
      assert.ok(trace);
      assert.equal(trace.counters.domWrites, after.readbackWrites);
      assert.equal(trace.counters.fillCalls, after.readbackWrites);
      assert.equal(trace.counters.dispatchAttempts, 0);
      assert.ok(trace.counters.emptyComposerRecoveries > 0);
      assert.equal((await call({ type: 'GET_STATE' })).job.id, started.job.id);
    } finally {
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  for (const [name, oldDraft] of [
    ['matching', overwriteLong],
    ['different', overwriteLong.replaceAll('SYNTHETIC_ROUND_', 'SYNTHETIC_OLD__')],
    ['blank paragraphs', Array.from({ length: 1200 }, (_, index) => index % 2 ? '' : `SYNTHETIC_OLD_${index}`).join('\n')],
    ['single long line', 'SYNTHETIC_OLD_LINE_' + 'x'.repeat(40000)],
  ]) await scenario(`Long prompt completely overwrites a long ${name} draft`, async page => {
    await page.evaluate(oldDraft => {
      const state = pm.state;
      const blocks = oldDraft.split('\n').map(line => state.schema.nodes.paragraph.create(null, line ? state.schema.text(line) : null));
      pm.dispatch(state.tr.replaceWith(0, state.doc.content.size, blocks));
      fixture.pastes = 0;
      pm.dom.addEventListener('paste', () => { fixture.pastes++; }, true);
    }, oldDraft);
    await start(page, { prompt: overwriteLong, sendMethod: 'auto', intervalMinutes: 30 });
    const startedAt = performance.now();
    const outcome = await call({ type: 'SEND_NOW' });
    const elapsedMs = performance.now() - startedAt;
    const observed = await inspect(page);
    const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
    console.log('LONG EXISTING DRAFT ' + JSON.stringify({ name, oldLength: oldDraft.length, promptLength: overwriteLong.length,
      elapsedMs, pastes: observed.pastes, submissions: observed.submits, sentCount: outcome.job?.sentCount,
      result: outcome.job?.lastResult, trace: trace && { counters: trace.counters, timings: trace.timings, reason: trace.reason } }));
    assert.equal(outcome.ok, true, outcome.error);
    assert.equal(outcome.job.sentCount, 1, outcome.job.statusText);
    assert.equal(observed.submits, 1);
    assert.equal(observed.sentTexts[0] === expectedPreparedText(overwriteLong), true);
    assert.equal(observed.pastes, 0);
    assert.ok(elapsedMs < 10000, `Synthetic overwrite took ${Math.round(elapsedMs)}ms`);
    assert.equal(trace.counters.dispatchAttempts, 1);
    assert.ok(trace.counters.domWrites > 1);
    assert.equal(trace.counters.textChunks, trace.counters.domWrites);
  });
  await scenario('A separate stale site submission model remains unconfirmed after one legacy dispatch', async page => {
    await page.evaluate(configured => {
      const state = pm.state;
      const blocks = configured.split('\n').map(line => state.schema.nodes.paragraph.create(null, line ? state.schema.text(line) : null));
      pm.dispatch(state.tr.replaceWith(0, state.doc.content.size, blocks));
      fixture.externalModel = 'SYNTHETIC_STALE_SUBMISSION_MODEL';
      fixture.pastes = 0;
      pm.dom.addEventListener('paste', () => { fixture.pastes++; }, true);
      document.querySelector('button[aria-label="Send"]').addEventListener('click', event => {
        event.stopImmediatePropagation();
        fixture.submits++;
        fixture.sentTexts.push(fixture.externalModel);
      }, true);
    }, overwriteLong);
    await start(page, { prompt: overwriteLong, sendMethod: 'button', intervalMinutes: 30 });
    const sending = call({ type: 'SEND_NOW' });
    let timeout;
    try {
      await page.waitForFunction(() => fixture.submits === 1, null, {timeout:15000});
      const observed = await inspect(page);
      const job = (await call({type:'GET_STATE'})).job;
      console.log('STALE MATCHING MODEL ' + JSON.stringify({ pastes: observed.pastes, submissions: observed.submits,
        submittedExpected: observed.sentTexts[0] === overwriteLong, result: job.lastResult }));
      assert.deepEqual(observed.sentTexts, ['SYNTHETIC_STALE_SUBMISSION_MODEL']);
      assert.equal(observed.buttonClicks,0,'The independent handler intercepted the one extension click');
      assert.equal(job.sentCount,0,'A helper attempt without a new correlated receipt is not success');
      assert.equal(await page.locator('article.message-row.self').count(),0);
      await new Promise(resolve=>setTimeout(resolve,500));
      assert.equal((await inspect(page)).submits,1,'Missing proof must not cause another method or dispatch');
    } finally {
      clearTimeout(timeout);
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  await scenario('Opaque old draft content is removed through full replacement after a rejected initial selection', async page => {
    await page.evaluate(() => {
      fixture.opaqueBeforePaste = 0;
      fixture.pastes = 0;
      document.addEventListener('selectionchange', event => {
        if (event.isTrusted) return;
        fixture.opaqueBeforePaste++;
        if (fixture.opaqueBeforePaste === 1) {
          const node = document.createElement('span');
          node.setAttribute('contenteditable', 'false');
          node.textContent = 'SYNTHETIC_OPAQUE_DRAFT';
          pm.dom.querySelector('p').append(node);
        } else if (fixture.opaqueBeforePaste === 2) {
          event.stopImmediatePropagation();
          getSelection().collapseToEnd();
        }
      }, true);
      pm.dom.addEventListener('paste', () => { fixture.pastes++; }, true);
    });
    await start(page, { prompt: overwriteLong, sendMethod: 'auto', intervalMinutes: 30 });
    const outcome = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    console.log('OPAQUE EXISTING DRAFT ' + JSON.stringify({ opaqueNodes: observed.opaqueBeforePaste, pastes: observed.pastes, submissions: observed.submits,
      sentCount: outcome.job?.sentCount, result: outcome.job?.lastResult, diagnostic: outcome.job?.lastDiagnosticCode }));
    assert.equal(outcome.ok, true, outcome.error);
    assert.ok(observed.opaqueBeforePaste >= 2);
    assert.equal(outcome.job.lastResult, 'sent');
    assert.equal(outcome.job.lastDiagnosticCode, null);
    assert.equal(outcome.job.sentCount, 1);
    assert.equal(observed.submits, 1);
    assert.deepEqual(observed.sentTexts,[overwriteLong]);
    assert.ok(!observed.sentTexts[0].includes('SYNTHETIC_OPAQUE_DRAFT'));
    assert.equal(observed.pastes, 0);
  });
  await scenario('A rewrite after the last selection notification can remain pending without a total deadline until Pause', async page => {
    await page.evaluate(({ configured, original }) => {
      fixture.pastes = 0;
      fixture.selectionEvents = 0;
      const send = document.querySelector('button[aria-label="Send"]');
      pm.dom.addEventListener('paste', () => { fixture.pastes++; }, true);
      pm.dom.addEventListener('beforeinput', event => {
        if (event.isTrusted) return;
        fixture.externalModel = original;
        pm.dom.textContent = configured;
        send.disabled = false;
      });
      send.addEventListener('click', event => {
        event.stopImmediatePropagation();
        fixture.submits++;
        fixture.sentTexts.push(fixture.externalModel);
      }, true);
      document.addEventListener('selectionchange', event => {
        if (event.isTrusted) return;
        fixture.selectionEvents++;
        if (fixture.selectionEvents === 1) pm.dom.textContent = 'SYNTHETIC_INTERMEDIATE';
        if (fixture.selectionEvents === 2) {
          pm.dom.textContent = configured;
          const range = document.createRange();
          range.selectNodeContents(pm.dom);
          getSelection().removeAllRanges();
          getSelection().addRange(range);
        }
      }, true);
    }, { configured: overwriteLong, original: 'SYNTHETIC_STALE_MODEL' });
    await start(page, { prompt: overwriteLong, sendMethod: 'button', intervalMinutes: 30 });
    let timeout;
    const outcome = await Promise.race([
      call({ type: 'SEND_NOW' }),
      new Promise(resolve => { timeout = setTimeout(() => resolve({ timedOut: true }), 2500); }),
    ]).finally(() => clearTimeout(timeout));
    const observed = await inspect(page);
    console.log('SELECTION REWRITE RESULT ' + JSON.stringify({ timedOut: !!outcome.timedOut, events: observed.selectionEvents,
      pastes: observed.pastes, submits: observed.submits, status: outcome.job?.lastResult,
      diagnostic: outcome.job?.lastDiagnosticCode }));
    assert.equal(outcome.timedOut, true, 'An observation window is not a product send timeout');
    assert.ok(observed.selectionEvents >= 2);
    assert.equal(observed.submits, 0);
    assert.equal(observed.pastes, 0);
    assert.equal((await call({type:'GET_STATE'})).job.sentCount, 0);
    const paused = await call({type:'PAUSE'});
    assert.equal(paused.job.enabled,false);
    const stopped = await inspect(page);
    await new Promise(resolve=>setTimeout(resolve,500));
    assert.equal((await inspect(page)).submits,stopped.submits);
  });
  if (testVanillaPerformance && !testFastPaste) await scenario(`${testFontPerformance || testFontExecPerformance ? 'FONT-wrapped' : 'Vanilla'} ProseMirror long multiline MV3 send performance`, async page => {
    const lines = testFontExecPerformance ? 50 : 1200;
    const reproduceWrites = process.env.TEST_PM_REPRO_STALLED_WRITES === '1';
    const reproduceMatchingWrite = process.env.TEST_PM_REPRO_MATCHED_WRITE === '1';
    const writeDelayMs = Number(process.env.TEST_PM_SYNC_WRITE_MS ?? 21000);
    assert.ok(!(reproduceWrites && reproduceMatchingWrite), 'Select only one slow-write reproduction');
    assert.ok(!testFontPerformance || !(reproduceWrites || reproduceMatchingWrite), 'FONT performance comparison does not inject slow writes');
    if (reproduceWrites || reproduceMatchingWrite) assert.ok(Number.isInteger(writeDelayMs) && writeDelayMs >= 0 && writeDelayMs <= 25000,
      'TEST_PM_SYNC_WRITE_MS must be an integer between 0 and 25000');
    const largePrompt = Array.from({ length: lines }, (_, index) =>
      `SYNTHETIC_LINE_${String(index + 1).padStart(4, '0')} ${'multiline performance text '.repeat(3)}`).join('\n');
    const foreground = await newPage('https://pm-foreground.invalid/vanilla-performance');
    try {
      await foreground.bringToFront();
      await foreground.locator('#work').focus();
      await page.waitForFunction(() => document.hidden && !document.hasFocus());
      assert.equal(await page.evaluate(() => !!pm.dom.editor?.view), false);
      if (testFontPerformance || testFontExecPerformance) await page.evaluate(() => {
        fixture.fontWraps = 0;
        fixture.fontNodesAtSubmit = 0;
        fixture.fontPasteEvents = 0;
        fixture.fontInputEvents = 0;
        fixture.fontLastInputType = null;
        const wrapText = () => {
          const walker = document.createTreeWalker(pm.dom, NodeFilter.SHOW_TEXT);
          const nodes = [];
          while (walker.nextNode()) if (walker.currentNode.data && walker.currentNode.parentElement.tagName !== 'FONT') nodes.push(walker.currentNode);
          for (const node of nodes) {
            const font = document.createElement('font');
            node.replaceWith(font);
            font.append(node);
          }
          fixture.fontWraps += nodes.length;
        };
        pm.dom.addEventListener('input', event => {
          fixture.fontInputEvents++;
          fixture.fontLastInputType = event.inputType || null;
          wrapText();
        });
        pm.dom.addEventListener('paste', () => { fixture.fontPasteEvents++; queueMicrotask(wrapText); }, { once: true });
        document.querySelector('button[aria-label="Send"]').addEventListener('click', () => {
          fixture.fontNodesAtSubmit = pm.dom.querySelectorAll('font').length;
        }, true);
      });
      const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
      if (reproduceWrites || reproduceMatchingWrite) {
        if (reproduceWrites) await page.evaluate(() => {
          pm.dom.addEventListener('perf-write-complete', () => {
            if (pm.state.doc.textContent !== 'SYNTHETIC_RESTORED_DRAFT')
              pm.dispatch(pm.state.tr.insertText('SYNTHETIC_RESTORED_DRAFT', 0, pm.state.doc.content.size));
            document.querySelector('button[aria-label="Send"]').disabled = false;
          });
        });
        await worker.evaluate(async ({ tabId, writeDelayMs, largePrompt, reproduceWrites }) => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', args: [writeDelayMs, largePrompt, reproduceWrites], func: (writeDelayMs, largePrompt, reproduceWrites) => {
          const exec = document.execCommand.bind(document);
          const writes = [];
          document.execCommand = (command, showUI, value) => {
            if (command !== 'insertText' || value !== largePrompt) return exec(command, showUI, value);
            const begin = performance.now();
            while (performance.now() - begin < writeDelayMs) {}
            const result = exec(command, showUI, value);
            if (reproduceWrites) document.querySelector('[role="textbox"]').dispatchEvent(new Event('perf-write-complete'));
            writes.push({ elapsedMs: performance.now() - begin, submitted: document.documentElement.dataset.fixtureSubmitted === 'true' });
            document.documentElement.dataset.perfWrites = String(writes.length);
            document.documentElement.dataset.perfWriteDetails = JSON.stringify(writes);
            return result;
          };
          if (reproduceWrites) {
            const original = chrome.runtime.sendMessage.bind(chrome.runtime);
            globalThis.perfAuthorization = { held: false, released: false, allowed: false };
            chrome.runtime.sendMessage = async message => {
              if (message.type === 'WAIT_RUN' && Number(document.documentElement.dataset.perfWrites) >= 3 && !perfAuthorization.held) {
                perfAuthorization.held = true;
                await new Promise(resolve => { perfAuthorization.release = resolve; });
                const reply = await original(message);
                perfAuthorization.allowed = reply?.ok === true && reply.allowed === true;
                document.documentElement.dataset.perfAuthorizationReplied = 'true';
                await new Promise(resolve => { perfAuthorization.continue = resolve; });
                perfAuthorization.released = true;
                return reply;
              }
              return original(message);
            };
          }
        } }), { tabId: started.job.tabId, writeDelayMs, largePrompt, reproduceWrites });
      }
      await page.evaluate(() => {
        const started = performance.now();
        window.perfHeartbeat = { started, last: started, ticks: 0, maxGapMs: 0 };
        window.perfHeartbeat.timer = setInterval(() => {
          const now = performance.now();
          perfHeartbeat.maxGapMs = Math.max(perfHeartbeat.maxGapMs, now - perfHeartbeat.last);
          perfHeartbeat.last = now;
          perfHeartbeat.ticks++;
        }, 100);
      });
      const startTime = performance.now();
      let nodeTicks = 0;
      let nodeLast = startTime;
      let nodeMaxGapMs = 0;
      const nodeHeartbeat = setInterval(() => {
        const now = performance.now();
        nodeMaxGapMs = Math.max(nodeMaxGapMs, now - nodeLast);
        nodeLast = now;
        nodeTicks++;
        if (nodeTicks % 5 === 0) console.log(`PERF HEARTBEAT node elapsedMs=${Math.round(now - startTime)} ticks=${nodeTicks}`);
      }, 1000);
      let result;
      let elapsedMs;
      try {
        const sending = call({ type: 'SEND_NOW' });
        if (reproduceWrites) {
          try {
            const capture = page.waitForFunction(() => Number(document.documentElement.dataset.perfWrites) >= 3, null, { polling: 100, timeout: 3 * writeDelayMs + 15000 })
              .catch(async error => { throw new Error(`Capture failed: ${JSON.stringify(await page.evaluate(() => ({ writes: JSON.parse(document.documentElement.dataset.perfWriteDetails || '[]'), updates: fixture.updates, submits: fixture.submits, text: pm.state.doc.textContent.slice(0, 100) })))}; ${error.message}`); });
            const first = await Promise.race([capture.then(() => 'captured'), sending.then(() => 'settled')]);
            if (first !== 'captured') {
              const observed = await page.evaluate(() => ({ writes: JSON.parse(document.documentElement.dataset.perfWriteDetails || '[]'), submits: fixture.submits }));
              throw new Error(`Send settled before three writes: ${JSON.stringify(observed)}`);
            }
            await page.waitForFunction(() => document.documentElement.dataset.perfWrites === '3', null, { polling: 100, timeout: 5000 });
            const readAuthorization = () => worker.evaluate(async tabId => {
              const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => ({ held: perfAuthorization.held, released: perfAuthorization.released, allowed: perfAuthorization.allowed }) });
              return frames.find(frame => frame.frameId === 0)?.result;
            }, started.job.tabId);
            const authorization = await readAuthorization();
            assert.equal(authorization.held, true, 'The third write must reach the controlled authorization wait');
            assert.equal(authorization.released, false);
            const writes = await page.evaluate(() => ({ writes: JSON.parse(document.documentElement.dataset.perfWriteDetails || '[]'), submits: fixture.submits, clicks: fixture.buttonClicks,
              keyboardCommands: fixture.keyboardCommands, modelIsRestored: pm.state.doc.textContent === 'SYNTHETIC_RESTORED_DRAFT' }));
            console.log('PERF STALLED WRITES ' + JSON.stringify(writes));
            assert.equal(writes.writes.length, 3);
            assert.ok(writes.writes.every(write => write.elapsedMs >= writeDelayMs && write.submitted === false));
            assert.deepEqual([writes.submits, writes.clicks, writes.keyboardCommands], [0, 0, 0]);
            await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => perfAuthorization.release() }), started.job.tabId);
            await page.waitForFunction(() => document.documentElement.dataset.perfAuthorizationReplied === 'true', null, { polling: 100, timeout: 5000 });
            const authorized = await readAuthorization();
            assert.equal(authorized.allowed, true, 'The real worker must authorize the resumed wait');
            assert.equal((await inspect(page)).submits, 0);
          } finally {
            await call({ type: 'PAUSE' });
            await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => { perfAuthorization.release?.(); perfAuthorization.continue?.(); } }), started.job.tabId);
            result = await sending;
          }
        } else result = await sending;
        elapsedMs = performance.now() - startTime;
      } finally {
        clearInterval(nodeHeartbeat);
      }
      const pageHeartbeat = await page.evaluate(() => {
        const now = performance.now();
        clearInterval(perfHeartbeat.timer);
        return { ticks: perfHeartbeat.ticks, maxGapMs: Math.max(perfHeartbeat.maxGapMs, now - perfHeartbeat.last), elapsedMs: now - perfHeartbeat.started };
      });
      const observed = await inspect(page);
      const traces = await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics);
      const trace = traces?.at(-1);
      console.log('PERF RESULT ' + JSON.stringify({ lines, characters: largePrompt.length, visibility: observed.visibility,
        variant: testFontExecPerformance ? 'font-exec' : testFontPerformance ? 'font' : 'vanilla', fontWraps: observed.fontWraps, fontNodesAtSubmit: observed.fontNodesAtSubmit,
        pasteEvents: observed.fontPasteEvents, inputEvents: observed.fontInputEvents, lastInputType: observed.fontLastInputType,
        sendNowElapsedMs: elapsedMs, nodeHeartbeat: { ticks: nodeTicks, maxGapMs: Math.max(nodeMaxGapMs, elapsedMs - (nodeLast - startTime)) },
        pageHeartbeat, pmTransactions: observed.updates, submissions: observed.submits,
        counters: trace?.counters, timings: trace?.timings, state: trace?.state }));
      if (reproduceWrites) {
        assert.equal(result.job.sentCount, 0);
        assert.deepEqual([observed.submits, observed.buttonClicks, observed.keyboardCommands], [0, 0, 0]);
        assert.equal(observed.visibility, 'hidden');
        assert.equal(await foreground.locator('#work').inputValue(), 'Unrelated synthetic document');
        return;
      }
      if (reproduceMatchingWrite) {
        const writes = await page.evaluate(() => JSON.parse(document.documentElement.dataset.perfWriteDetails || '[]'));
        console.log('PERF MATCHING WRITES ' + JSON.stringify(writes));
        assert.equal(writes.length, 1, 'Matching content must not be written again after a slow write');
        assert.ok(writes[0].elapsedMs >= writeDelayMs && writes[0].submitted === false, 'The initial write must actually be slow and precede submission');
      }
      assert.equal(result.ok, true, result.error);
      assert.equal(result.job.sentCount, 1, result.job.statusText);
      assert.deepEqual(observed.sentTexts, [largePrompt]);
      assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [1, 0, 1]);
      assert.equal(observed.visibility, 'hidden');
      assert.equal(await foreground.locator('#work').inputValue(), 'Unrelated synthetic document');
      assert.ok(trace?.counters && Number.isInteger(trace.counters.domWrites));
      if (testFontPerformance || testFontExecPerformance) {
        assert.equal(observed.fontPasteEvents, testFontExecPerformance ? 0 : 1);
        if (testFontExecPerformance) assert.ok(observed.fontInputEvents > 0);
        assert.equal(observed.fontWraps, lines, 'Each synthetic line must be wrapped');
        assert.equal(observed.fontNodesAtSubmit, lines, 'All FONT wrappers must remain present at the actual submission');
        assert.equal(trace.counters.domWrites, 1, 'Unchanged FONT-wrapped text must be written only once');
        assert.equal(trace.counters.fillCalls, 1);
        assert.equal(trace.counters.dispatchAttempts, 1);
      }
    } finally { await foreground.close(); }
  }, true);
  if (testCrOnly) {
    const failures = [];
    for (const testCase of [
      { name: 'nonempty lines', lines: Array.from({ length: 101 }, (_, index) => `LINE_${index}`) },
      { name: 'empty lines', lines: Array.from({ length: 101 }, (_, index) => index % 10 === 5 ? '' : `LINE_${index}`) },
    ]) {
      try {
        await scenario(`ProseMirror MV3 short CR-only fast paste: ${testCase.name}`, async page => {
          const text = testCase.lines.join('\r');
          const normalized = testCase.lines.join('\n');
          assert.equal(text.split('\r').length, 101);
          assert.equal(text.includes('\n'), false);
          assert.ok(text.length < 32768);
          const foreground = await newPage('https://pm-foreground.invalid/cr-only');
          try {
            await foreground.bringToFront();
            await foreground.locator('#work').focus();
            const before = await foreground.evaluate(() => ({ value: document.querySelector('#work').value, focused: document.activeElement === document.querySelector('#work') }));
            await page.waitForFunction(() => document.hidden && !document.hasFocus());
            assert.equal(await page.evaluate(() => !!pm.dom.editor?.view), false);
            await page.evaluate(() => {
              fixture.pastes = 0;
              fixture.pasteEvents = [];
              pm.dom.addEventListener('paste', event => {
                fixture.pastes++;
                fixture.pasteEvents.push({ text: event.clipboardData.getData('text/plain'), trusted: event.isTrusted });
              }, true);
            });
            const started = await start(page, { prompt: text, sendMethod: 'auto', intervalMinutes: 30 });
            assert.equal(started.job.prompt, text);
            const result = await call({ type: 'SEND_NOW' });
            const observed = await inspect(page);
            const receipts = await page.locator('article.message-row.self .message-body').allTextContents();
            console.log('CR-ONLY RESULT ' + JSON.stringify({ name: testCase.name, characters: text.length, lines: testCase.lines.length,
              pastes: observed.pastes, submissions: observed.submits, sentCount: result.job?.sentCount,
              modelNormalized: observed.sentTexts.length === 1 && observed.sentTexts[0] === normalized,
              receiptNormalized: receipts.length === 1 && receipts[0] === normalized }));
            assert.equal(observed.pastes, 1, 'A short 101-line CR-only prompt must use fast paste exactly once');
            assert.deepEqual(observed.pasteEvents, [{ text, trusted: false }]);
            assert.equal(result.ok, true, result.error);
            assert.equal(result.job.sentCount, 1, result.job.statusText);
            assert.equal(result.job.lastResult, 'sent');
            assert.equal(result.job.prompt, text);
            assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [1, 0, 1]);
            assert.deepEqual(observed.sentTexts, [normalized]);
            assert.deepEqual(receipts, [normalized]);
            assert.equal(observed.visibility, 'hidden');
            assert.deepEqual(await foreground.evaluate(() => ({ value: document.querySelector('#work').value, focused: document.activeElement === document.querySelector('#work') })), before);
          } finally { await foreground.close(); }
        }, true);
      } catch (error) {
        failures.push({ name: testCase.name, message: error.message });
        console.log('FAIL CR-ONLY ' + JSON.stringify(failures.at(-1)));
      }
    }
    if (failures.length) throw new Error(`CR-only cases failed: ${JSON.stringify(failures)}`);
  }
  const shapePerformanceCases = [
    { name: '500-lines-3500', characters: 3500, lines: 500, expectedPastes: 1 },
    { name: 'single-100k', characters: 100000, lines: 1 },
    { name: 'two-lines-32767', characters: 32767, lines: 2 },
    { name: 'two-lines-32768', characters: 32768, lines: 2 },
    { name: 'two-lines-100k', characters: 100000, lines: 2 },
    { name: 'five-lines-100k', characters: 100000, lines: 5 },
  ];
  if (testShapePerformance) {
    const failures = [];
    for (const testCase of shapePerformanceCases) {
      try {
        await scenario(`ProseMirror MV3 shape performance: ${testCase.name}`, async page => {
          const text = '中文 e\u0301 & <literal> synthetic performance text 0123456789 ';
          const bodyLength = testCase.characters - (testCase.lines - 1);
          const prefix = '🧑🏽‍💻 ';
          const body = prefix + text.repeat(Math.ceil(bodyLength / text.length)).slice(0, bodyLength - prefix.length);
          const promptParts = Array.from({ length: testCase.lines }, (_, index) =>
            body.slice(Math.floor(index * bodyLength / testCase.lines), Math.floor((index + 1) * bodyLength / testCase.lines)));
          const largePrompt = testCase.name === '500-lines-3500'
            ? Array.from({ length: 500 }, (_, index) => index === 0 ? 'A'.repeat(7) : 'B'.repeat(6)).join('\n')
            : promptParts.join('\n');
          assert.equal(largePrompt.length, testCase.characters);
          assert.equal(largePrompt.split('\n').length, testCase.lines);
          const foreground = await newPage('https://pm-foreground.invalid/shape-performance');
          try {
            await foreground.bringToFront();
            await foreground.locator('#work').focus();
            await foreground.locator('#work').evaluate(input => input.setSelectionRange(3, 8));
            const foregroundState = () => foreground.evaluate(() => {
              const input = document.querySelector('#work');
              return { value: input.value, start: input.selectionStart, end: input.selectionEnd, focused: document.activeElement === input };
            });
            const before = await foregroundState();
            await page.waitForFunction(() => document.hidden && !document.hasFocus());
            assert.equal(await page.evaluate(() => !!pm.dom.editor?.view), false);
            await page.evaluate(() => {
              fixture.pastes = 0;
              fixture.pasteTrusted = [];
              pm.dom.addEventListener('paste', event => { fixture.pastes++; fixture.pasteTrusted.push(event.isTrusted); }, true);
              const started = performance.now();
              window.shapeHeartbeat = { started, last: started, ticks: 0, maxGapMs: 0 };
              shapeHeartbeat.timer = setInterval(() => {
                const now = performance.now();
                shapeHeartbeat.maxGapMs = Math.max(shapeHeartbeat.maxGapMs, now - shapeHeartbeat.last);
                shapeHeartbeat.last = now;
                shapeHeartbeat.ticks++;
              }, 100);
            });
            const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
            assert.equal(started.job.prompt === largePrompt, true, 'The configured prompt must be unchanged');
            const profiling = process.env.TEST_PM_PROFILE === '1' ? await context.newCDPSession(page) : null;
            if (profiling) { await profiling.send('Profiler.enable'); await profiling.send('Profiler.start'); }
            const begin = performance.now();
            const result = await call({ type: 'SEND_NOW' });
            const elapsedMs = performance.now() - begin;
            if (profiling) {
              const { profile } = await profiling.send('Profiler.stop');
              const weights = new Map();
              for (let index = 0; index < (profile.samples || []).length; index++) {
                const id = profile.samples[index];
                weights.set(id, (weights.get(id) || 0) + (profile.timeDeltas?.[index] || 0));
              }
              const nodes = new Map(profile.nodes.map(node => [node.id, node]));
              const top = [...weights.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id, micros]) => {
                const frame = nodes.get(id)?.callFrame || {};
                const source = String(frame.url || '');
                const group = source.includes('__local_pm__') ? 'prosemirror' : source.startsWith('chrome-extension:')
                  ? 'extension' : source.startsWith('https://chatgpt.com/dots/pm-') ? 'fixture' : source ? 'other' : 'native';
                return { function: frame.functionName || '(anonymous)', group, selfMs: Math.round(micros / 1000) };
              });
              console.log('SYNTHETIC CPU PROFILE ' + JSON.stringify({ name: testCase.name, top }));
              await profiling.detach();
            }
            const observed = await inspect(page);
            const heartbeat = await page.evaluate(() => {
              const now = performance.now();
              clearInterval(shapeHeartbeat.timer);
              return { ticks: shapeHeartbeat.ticks, maxGapMs: Math.max(shapeHeartbeat.maxGapMs, now - shapeHeartbeat.last) };
            });
            const receipts = await page.locator('article.message-row.self .message-body').allTextContents();
            const traces = await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics);
            const trace = traces?.at(-1);
            console.log('SHAPE PERF RESULT ' + JSON.stringify({ name: testCase.name, characters: largePrompt.length,
              lines: testCase.lines, elapsedMs, heartbeat, pastes: observed.pastes, pasteTrusted: observed.pasteTrusted,
              transactions: observed.updates, submissions: observed.submits, sentCount: result.job?.sentCount,
              modelExact: observed.sentTexts.length === 1 && observed.sentTexts[0] === largePrompt,
              receiptExact: receipts.length === 1 && receipts[0] === largePrompt, counters: trace?.counters, timings: trace?.timings }));
            assert.equal(result.ok, true, result.error);
            assert.equal(result.job.sentCount, 1, result.job.statusText);
            assert.equal(result.job.lastResult, 'sent');
            assert.equal(result.job.prompt === largePrompt, true);
            assert.equal(observed.pastes, 0, 'Chunked ordinary text must not dispatch paste');
            assert.deepEqual(observed.pasteTrusted, []);
            assert.ok(trace?.counters?.textChunks >= Math.ceil(largePrompt.length / 1000));
            assert.equal(trace.counters.domWrites, trace.counters.textChunks);
            assert.equal(trace?.counters?.dispatchAttempts, 1);
            assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [1, 0, 1]);
            assert.equal(observed.sentTexts.length, 1);
            assert.equal(observed.sentTexts[0] === largePrompt, true, 'Submitted model text must exactly match the original prompt');
            assert.equal(receipts.length, 1);
            assert.equal(receipts[0] === largePrompt, true, 'The actual receipt must exactly match the original prompt');
            assert.equal(observed.visibility, 'hidden');
            assert.deepEqual(await foregroundState(), before);
          } finally { await foreground.close(); }
        }, true);
      } catch (error) {
        failures.push({ name: testCase.name, message: error.message });
        console.log('FAIL SHAPE PERF ' + JSON.stringify(failures.at(-1)));
      }
    }
    if (failures.length) throw new Error(`Shape performance cases failed: ${JSON.stringify(failures)}`);
  }
  if (testFastPaste) await scenario('Vanilla ProseMirror long multiline fast paste sends exact content through MV3', async page => {
    const largePrompt = Array.from({ length: 1200 }, (_, index) =>
      index % 17 === 0 ? '' : `PASTE_LINE_${String(index + 1).padStart(4, '0')} 中文 & <literal> ${'fidelity text '.repeat(3)}`).join('\n');
    const foreground = await newPage('https://pm-foreground.invalid/fast-paste');
    try {
      await foreground.bringToFront();
      await foreground.locator('#work').focus();
      await page.waitForFunction(() => document.hidden && !document.hasFocus());
      assert.equal(await page.evaluate(() => !!pm.dom.editor?.view), false);
      await page.evaluate(() => {
        fixture.pastes = 0;
        pm.dom.addEventListener('paste', () => { fixture.pastes++; }, true);
      });
      await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
      const startedAt = performance.now();
      const result = await call({ type: 'SEND_NOW' });
      const elapsedMs = performance.now() - startedAt;
      const observed = await inspect(page);
      console.log('FAST PASTE RESULT ' + JSON.stringify({ characters: largePrompt.length, elapsedMs, pastes: observed.pastes, submissions: observed.submits }));
      assert.equal(result.ok, true, result.error);
      assert.equal(result.job.sentCount, 1, result.job.statusText);
      assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [1, 0, 1], 'The fixture must actually dispatch one submission');
      assert.deepEqual(observed.sentTexts, [largePrompt], 'The submitted ProseMirror model must retain the exact prompt');
      assert.ok(elapsedMs < 10000, `Long multiline paste and send must complete within 10 seconds; took ${Math.round(elapsedMs)}ms`);
      assert.ok(observed.pastes >= 1, 'The vanilla editor must receive at least one paste event');
      assert.equal(observed.visibility, 'hidden');
      assert.equal(await foreground.locator('#work').inputValue(), 'Unrelated synthetic document');
    } finally { await foreground.close(); }
  }, true);
  const fastPasteCases = [
    { name: 'consecutive empty lines', prefix: 'START\n\n\n\nMIDDLE\n\n\nEND\n' },
    { name: 'leading and trailing whitespace', prefix: '  START  \n  MIDDLE  \n', suffix: '\n  END  ' },
    { name: 'leading and trailing newlines', prefix: '\n\nSTART\n', suffix: '\nEND\n\n' },
    { name: 'CRLF and CR line endings', prefix: 'START\r\nMIDDLE\rEND\r\n', separator: '\r\n' },
    { name: 'Unicode and escaped HTML', prefix: '中文 🧑🏽‍💻 e\u0301 é 漢字 & <literal> "quoted"\n' },
    { name: 'tabs and repeated spaces', prefix: ' A\tB  C\n  \tleading\tand  repeated spaces   \n' },
    { name: 'carriage return only between multiline sections', prefix: 'START\rONLY_CR_BREAK\nCONTINUE\n', separator: '\r' },
    { name: 'Unicode separators', prefix: 'START\u2028LINE\u2029PARAGRAPH\n' },
    { name: 'embedded NUL', prefix: 'START\u0000NUL\n', invalidText: true },
    { name: 'isolated UTF-16 surrogates', prefix: 'START\ud800LONE_HIGH\udc00LONE_LOW\n', invalidText: true },
    { name: 'altered whitespace receipt', prefix: 'RECEIPT\n\nORIGINAL\n', alterReceipt: text => text.replace('\n\n', '\n') },
    { name: 'altered Unicode receipt', prefix: 'RECEIPT e\u0301 🧑🏽‍💻\n', alterReceipt: text => text.replace('e\u0301', 'é') },
  ];
  if (testFastPaste) {
    const failures = [];
    for (const testCase of fastPasteCases) {
      try {
        if (selectedFastCases && !selectedFastCases.includes(testCase.name)) continue;
        await scenario(`Vanilla ProseMirror fast paste: ${testCase.name}`, async page => {
          const separator = testCase.separator || '\n';
          const largePrompt = testCase.prefix + Array.from({ length: 1200 }, (_, index) =>
            `EDGE_LINE_${String(index + 1).padStart(4, '0')} synthetic fidelity text`).join(separator) + (testCase.suffix || '');
          const expected = largePrompt.replace(/\r\n?/g, '\n');
          const alteredReceipt = testCase.alterReceipt?.(expected);
          assert.ok(largePrompt.length >= 32768 && largePrompt.includes('\n'));
          if (testCase.alterReceipt) assert.notEqual(alteredReceipt, expected);
          const foreground = await newPage('https://pm-foreground.invalid/fast-paste-edge');
          try {
            await foreground.bringToFront();
            await foreground.locator('#work').focus();
            await page.waitForFunction(() => document.hidden && !document.hasFocus());
            assert.equal(await page.evaluate(() => !!pm.dom.editor?.view), false);
            await page.evaluate(({ expected, alteredReceipt }) => {
              fixture.pastes = 0;
              fixture.pasteTexts = [];
              pm.dom.addEventListener('paste', event => {
                fixture.pastes++;
                fixture.pasteTexts.push(event.clipboardData.getData('text/plain'));
              }, true);
              if (alteredReceipt !== undefined) {
                const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
                Object.defineProperty(Node.prototype, 'textContent', {
                  ...descriptor,
                  set(value) {
                    if (this.classList?.contains('message-body') && value === expected) value = alteredReceipt;
                    descriptor.set.call(this, value);
                  },
                });
              }
            }, { expected, alteredReceipt });
            if (testCase.invalidText) {
              const tab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(item => item.url === url), page.url());
              const started = await call({ type: 'START', tabId: tab.id, config: { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 } });
              if (started.ok) await call({ type: 'PAUSE' });
              assert.equal(started.ok, false, 'Invalid text must be rejected before any editor or send action');
              assert.match(started.error, /invalid|unsupported|control|text|unicode|无效|控制|文本/i);
              const observed = await inspect(page);
              assert.deepEqual([observed.pastes, observed.buttonClicks, observed.keyboardCommands, observed.submits], [0, 0, 0, 0]);
              return;
            }
            const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
            assert.equal(started.job.prompt, largePrompt, 'The configured prompt must remain unchanged');
            const sending = call({ type: 'SEND_NOW' });
            let timer;
            const outcome = await Promise.race([
              sending.then(result => ({ result })),
              new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 4000); }),
            ]);
            clearTimeout(timer);
            const observed = await inspect(page);
            const receipts = await page.locator('article.message-row.self .message-body').allTextContents();
            const state = (await call({ type: 'GET_STATE' })).job;
            if (outcome.timedOut) await call({ type: 'PAUSE' });
            const result = outcome.result || await sending;
            console.log('FAST PASTE EDGE ' + JSON.stringify({ name: testCase.name, characters: largePrompt.length,
              timedOut: !!outcome.timedOut, pastes: observed.pastes, submissions: observed.submits,
              sentCount: state.sentCount, receipts: receipts.length }));
            assert.equal(observed.pastes, 1, 'The fast path must dispatch exactly one paste');
            assert.equal(observed.pasteTexts[0] === largePrompt, true, 'The clipboard must contain the unchanged original prompt');
            assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [1, 0, 1], 'Submit exactly once');
            assert.equal(observed.sentTexts[0] === expected, true, 'The submitted model must preserve the prompt except line-ending normalization');
            assert.equal(receipts.length, 1, 'Exactly one new message receipt must exist');
            assert.equal(receipts[0] === (alteredReceipt ?? expected), true, 'Inspect the actual receipt text');
            assert.equal(observed.visibility, 'hidden');
            assert.equal(await foreground.locator('#work').inputValue(), 'Unrelated synthetic document');
            if (testCase.alterReceipt) {
              assert.equal(outcome.timedOut, undefined, 'A changed receipt must settle as unknown without waiting for a manual pause');
              assert.equal(result.ok, true, result.error);
              assert.equal(result.job.lastResult, 'unknown');
              assert.equal(result.job.enabled, false);
              assert.equal(result.job.lastDiagnosticCode, 'receipt-mismatch');
              assert.equal(state.sentCount, 0, 'A changed receipt must not increment the sent count');
              assert.equal(result.job.sentCount, 0);
            } else {
              assert.equal(outcome.timedOut, undefined, 'An exact receipt must be confirmed promptly');
              assert.equal(result.ok, true, result.error);
              assert.equal(result.job.sentCount, 1, result.job.statusText);
              assert.equal(result.job.lastResult, 'sent');
              assert.equal(result.job.prompt, largePrompt);
            }
          } finally { await foreground.close(); }
        }, true);
      } catch (error) {
        failures.push({ name: testCase.name, message: error.message });
        console.log('FAIL FAST PASTE EDGE ' + JSON.stringify(failures.at(-1)));
      }
    }
    if (failures.length) throw new Error(`Fast paste edge cases failed: ${JSON.stringify(failures)}`);
  }
  if (testPasteSafety === 'natural-attachment') for (const delay of [0, 500]) await scenario(`A page-created long-paste attachment is not mistaken for a hung text write (${delay}ms)`, async page => {
    const largePrompt = Array.from({ length: 1200 }, (_, index) =>
      `SYNTHETIC_NATURAL_LINE_${String(index + 1).padStart(4, '0')} ${'fidelity '.repeat(4)}`).join('\n');
    await page.evaluate(delay => {
      fixture.pastes = 0;
      pm.dom.addEventListener('paste', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        fixture.pastes++;
        fixture.pasteMatches = event.clipboardData.getData('text/plain').length > 32768;
        const create = () => {
          const chip = document.createElement('span');
          chip.dataset.testid = 'attachment';
          chip.textContent = 'Pasted text.md';
          pm.dom.closest('[data-composer-body]').append(chip);
          document.querySelector('button[aria-label="Send"]').disabled = false;
        };
        if (delay) setTimeout(create, delay);
        else create();
      }, true);
    }, delay);
    await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    const started = performance.now();
    const outcome = await call({ type: 'SEND_NOW' });
    const elapsed = performance.now() - started;
    const observed = await inspect(page);
    const traces = await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics);
    const trace = traces?.at(-1);
    console.log('SYNTHETIC NATURAL ATTACHMENT ' + JSON.stringify({ delayMs: delay, elapsedMs: Math.round(elapsed),
      pastes: observed.pastes, matches: observed.pasteMatches, submissions: observed.submits,
      state: outcome.job?.lastResult, enabled: outcome.job?.enabled, counters: trace?.counters, reason: trace?.reason }));
    assert.equal(outcome.ok, true);
    assert.equal(observed.pastes, 1);
    assert.equal(observed.pasteMatches, true);
    assert.equal(observed.submits, 0);
    assert.equal(outcome.job.sentCount, 0);
    assert.ok(elapsed < 3000, `A visible page-created attachment must not be polled as text for ${Math.round(elapsed)}ms`);
    assert.equal(outcome.job.lastResult, 'unknown');
    assert.equal(outcome.job.enabled, false);
    assert.equal(trace.reason, 'paste-attachment-unconfirmed');
    assert.equal(trace.counters.attachmentsRemoved, 0);
    assert.equal(await page.locator('[data-testid="attachment"]').count(), 1);
    const saved = await worker.evaluate(async () => ({ logs: (await chrome.storage.local.get('logs')).logs,
      resume: (await chrome.storage.local.get('resumeJob')).resumeJob }));
    assert.equal(saved.logs.at(-1).diagnostic.code, 'paste-attachment-unconfirmed');
    assert.equal(saved.resume.enabled, false);
    assert.equal((await call({ type: 'SEND_NOW' })).ok, false);
    assert.equal((await inspect(page)).pastes, 1);
  }, true);
  if (testPasteSafety === 'rollback') await scenario('Fast paste with recurring page rollback does not rewrite or dispatch and remains pausable', async page => {
    const largePrompt = Array.from({ length: 1200 }, (_, index) =>
      `ROLLBACK_LINE_${String(index + 1).padStart(4, '0')} 中文 ${'synthetic text '.repeat(3)}`).join('\n');
    const restored = 'PAGE_SYNTHETIC_RESTORED_DRAFT';
    const foreground = await newPage('https://pm-foreground.invalid/rollback');
    let sending;
    try {
      await foreground.bringToFront();
      await foreground.locator('#work').focus();
      await page.waitForFunction(() => document.hidden && !document.hasFocus());
      assert.equal(await page.evaluate(() => !!pm.dom.editor?.view), false);
      await page.evaluate(({ largePrompt, restored }) => {
        fixture.pastes = 0;
        fixture.rollbackWrites = 0;
        fixture.otherDocumentWrites = 0;
        fixture.promptObserved = false;
        fixture.execCommands = 0;
        const originalExecCommand = document.execCommand.bind(document);
        document.execCommand = (...args) => { fixture.execCommands++; return originalExecCommand(...args); };
        const originalDispatch = pm.props.dispatchTransaction;
        const rollback = () => {
          fixture.rollingBack = true;
          try { pm.dispatch(pm.state.tr.insertText(restored, 0, pm.state.doc.content.size)); }
          finally { fixture.rollingBack = false; }
          fixture.rollbackWrites++;
        };
        pm.setProps({ dispatchTransaction(transaction) {
          if (transaction.docChanged && !fixture.rollingBack) fixture.otherDocumentWrites++;
          originalDispatch.call(pm, transaction);
          if (!fixture.promptObserved && fixture.pastes && pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n') === largePrompt) {
            fixture.promptObserved = true;
            rollback();
            fixture.rollbackTimer = setInterval(rollback, 150);
          }
        } });
        pm.dom.addEventListener('paste', event => {
          fixture.pastes++;
          fixture.clipboardMatches = event.clipboardData.getData('text/plain') === largePrompt;
        }, true);
      }, { largePrompt, restored });
      await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
      sending = call({ type: 'SEND_NOW' });
      await page.waitForFunction(() => fixture.rollbackWrites >= 4, null, { polling: 100, timeout: 10000 });
      const beforePause = await inspect(page);
      assert.equal(beforePause.promptObserved, true, 'The real ProseMirror paste must apply before the page restores its draft');
      assert.equal(beforePause.clipboardMatches, true);
      assert.equal(beforePause.otherDocumentWrites, 1, 'Only the initial paste may change the model outside page-owned rollbacks');
      assert.deepEqual([beforePause.pastes, beforePause.execCommands, beforePause.buttonClicks, beforePause.keyboardCommands, beforePause.submits], [1, 0, 0, 0, 0]);
      assert.equal(await page.evaluate(() => pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n')), restored);
      let pauseTimeout;
      const paused = await Promise.race([
        call({ type: 'PAUSE' }),
        new Promise((_, reject) => { pauseTimeout = setTimeout(() => reject(new Error('Pause timed out during recurring rollback')), 5000); }),
      ]).finally(() => clearTimeout(pauseTimeout));
      assert.equal(paused.ok, true, paused.error);
      assert.equal(paused.job.enabled, false);
      const outcome = await sending;
      assert.equal(outcome.job.sentCount, 0);
      assert.equal((await call({ type: 'SEND_NOW' })).ok, false);
      await page.waitForFunction(count => fixture.rollbackWrites >= count + 4, beforePause.rollbackWrites, { polling: 100, timeout: 10000 });
      const afterPause = await inspect(page);
      assert.equal(afterPause.otherDocumentWrites, 1, 'Pause must not trigger another model write');
      assert.deepEqual([afterPause.pastes, afterPause.execCommands, afterPause.buttonClicks, afterPause.keyboardCommands, afterPause.submits], [1, 0, 0, 0, 0]);
      assert.equal(afterPause.updates - beforePause.updates, afterPause.rollbackWrites - beforePause.rollbackWrites, 'Only page-owned rollback transactions may occur after Pause');
      assert.equal(await page.evaluate(() => pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n')), restored);
      assert.equal(await foreground.locator('#work').inputValue(), 'Unrelated synthetic document');
      const traces = await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics);
      const trace = traces?.at(-1);
      assert.equal(trace?.counters?.domWrites, 1, 'The extension must write the prompt exactly once');
      assert.equal(trace?.counters?.dispatchAttempts || 0, 0, 'The extension must not dispatch a submission');
    } finally {
      await page.evaluate(() => clearInterval(fixture.rollbackTimer)).catch(() => {});
      await call({ type: 'PAUSE' });
      if (sending) await sending;
      await foreground.close();
    }
  }, true);
  if (testPasteSafety === 'ignored-bounded') {
    const failures = [];
    for (const preventDefault of [false, true]) {
      try {
        await scenario(`Ignored long paste settles uncertain without retry (preventDefault=${preventDefault})`, async page => {
          const largePrompt = Array.from({ length: 1200 }, (_, index) =>
            `IGNORED_LINE_${String(index + 1).padStart(4, '0')} 中文 ${'synthetic text '.repeat(3)}`).join('\n');
          assert.ok(largePrompt.length >= 32768 && largePrompt.includes('\n'));
          const foreground = await newPage('https://pm-foreground.invalid/ignored-bounded');
          let sending;
          try {
            await foreground.bringToFront();
            await foreground.locator('#work').focus();
            await page.waitForFunction(() => document.hidden && !document.hasFocus());
            assert.equal(await page.evaluate(() => !!pm.dom.editor?.view), false);
            await page.evaluate(preventDefault => {
              fixture.pastes = 0;
              fixture.pasteEvents = [];
              fixture.execCommands = 0;
              const execCommand = document.execCommand.bind(document);
              document.execCommand = (...args) => { fixture.execCommands++; return execCommand(...args); };
              pm.dom.addEventListener('paste', event => {
                fixture.pastes++;
                fixture.pasteEvents.push({ text: event.clipboardData.getData('text/plain'), trusted: event.isTrusted });
                if (preventDefault) event.preventDefault();
                event.stopImmediatePropagation();
                queueMicrotask(() => { fixture.defaultPrevented = event.defaultPrevented; });
              }, true);
            }, preventDefault);
            await worker.evaluate(() => {
              globalThis.originalIgnoredPasteExecute = chrome.scripting.executeScript;
              globalThis.ignoredPasteAdmissions = [];
              chrome.scripting.executeScript = async request => {
                if (request.func.name === 'pageAction' && request.args[0].mode === 'send')
                  ignoredPasteAdmissions.push(request.args[0].runId);
                return originalIgnoredPasteExecute(request);
              };
            });
            const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
            assert.equal(started.job.prompt, largePrompt);
            sending = call({ type: 'SEND_NOW' });
            let timer;
            const outcome = await Promise.race([
              sending.then(result => ({ result })),
              new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 12000); }),
            ]).finally(() => clearTimeout(timer));
            if (outcome.result) await new Promise(resolve => setTimeout(resolve, 1200));
            const observed = await inspect(page);
            const admissions = await worker.evaluate(() => [...ignoredPasteAdmissions]);
            assert.deepEqual(observed.pasteEvents, [{ text: largePrompt, trusted: false }]);
            assert.equal(observed.defaultPrevented, preventDefault);
            assert.equal(observed.pastes, 1, 'The uncertain paste must never be repeated');
            assert.equal(admissions.length, 1, 'The same cycle must not be readmitted');
            assert.equal(observed.execCommands, 0, 'No alternative editor write may follow the uncertain paste');
            assert.deepEqual([observed.updates, observed.buttonClicks, observed.keyboardCommands, observed.submits], [0, 0, 0, 0]);
            assert.equal(observed.editorEmpty, true);
            assert.equal(await foreground.locator('#work').inputValue(), 'Unrelated synthetic document');
            assert.equal(outcome.timedOut, undefined, 'An ignored paste must settle with an uncertain result within 12 seconds without Pause');
            assert.equal(outcome.result.ok, true, outcome.result.error);
            assert.equal(outcome.result.job.lastResult, 'unknown');
            assert.equal(outcome.result.job.unknownCount, 1);
            assert.equal(outcome.result.job.sentCount, 0);
            assert.equal(outcome.result.job.needsAttention, true);
            assert.equal(outcome.result.job.enabled, false, 'An unconfirmed paste must pause the task');
            assert.equal(outcome.result.job.phase, 'idle');
            assert.equal(outcome.result.job.nextAt, null);
            assert.equal(await worker.evaluate(() => chrome.alarms.get('agent-continue-heartbeat')), undefined);
            assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('resumeJob')).resumeJob.enabled), false);
            assert.equal((await call({ type: 'SEND_NOW' })).ok, false);
          } finally {
            await call({ type: 'PAUSE' });
            if (sending) await sending;
            await worker.evaluate(() => {
              if (globalThis.originalIgnoredPasteExecute) chrome.scripting.executeScript = originalIgnoredPasteExecute;
              delete globalThis.originalIgnoredPasteExecute;
              delete globalThis.ignoredPasteAdmissions;
            });
            await foreground.close();
          }
        }, true);
      } catch (error) {
        failures.push({ preventDefault, message: error.message });
        console.log('FAIL IGNORED BOUNDED ' + JSON.stringify(failures.at(-1)));
      }
    }
    if (failures.length) throw new Error(`Ignored bounded paste cases failed: ${JSON.stringify(failures)}`);
  }
  if (testPasteSafety === 'retry') await scenario('Unhandled first long paste retries without overlap and sends exactly once', async page => {
    const largePrompt = Array.from({ length: 1200 }, (_, index) =>
      `RETRY_LINE_${String(index + 1).padStart(4, '0')} 中文 ${'synthetic text '.repeat(3)}`).join('\n');
    assert.ok(largePrompt.length >= 32768 && largePrompt.includes('\n'));
    const foreground = await newPage('https://pm-foreground.invalid/paste-retry');
    let sending;
    try {
      await foreground.bringToFront();
      await foreground.locator('#work').focus();
      await page.waitForFunction(() => document.hidden && !document.hasFocus());
      assert.equal(await page.evaluate(() => !!pm.dom.editor?.view), false);
      await page.evaluate(() => {
        fixture.pastes = 0;
        fixture.pasteEvents = [];
        fixture.pasteDispatches = [];
        fixture.nonemptyModelWrites = [];
        const dispatchTransaction = pm.props.dispatchTransaction;
        pm.setProps({ dispatchTransaction(transaction) {
          dispatchTransaction.call(pm, transaction);
          const text = pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n');
          if (transaction.docChanged && text) fixture.nonemptyModelWrites.push({ pastes: fixture.pastes, text });
        } });
        pm.dom.addEventListener('paste', event => {
          fixture.pastes++;
          fixture.pasteEvents.push({ text: event.clipboardData.getData('text/plain'), trusted: event.isTrusted,
            modelBefore: pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n') });
          if (fixture.pastes === 1) event.stopImmediatePropagation();
          queueMicrotask(() => fixture.pasteDispatches.push({ cancelable: event.cancelable, defaultPrevented: event.defaultPrevented,
            modelAfter: pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n'), updates: fixture.updates, submits: fixture.submits }));
        }, true);
      });
      await worker.evaluate(() => {
        globalThis.originalPasteRetryExecute = chrome.scripting.executeScript;
        globalThis.pasteRetryProbe = { active: 0, maxActive: 0 };
        chrome.scripting.executeScript = async request => {
          const sending = request.func.name === 'pageAction' && request.args[0].mode === 'send';
          if (sending) pasteRetryProbe.maxActive = Math.max(pasteRetryProbe.maxActive, ++pasteRetryProbe.active);
          try { return await originalPasteRetryExecute(request); }
          finally { if (sending) pasteRetryProbe.active--; }
        };
      });
      const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
      assert.equal(started.job.prompt, largePrompt);
      sending = call({ type: 'SEND_NOW' });
      let timer;
      const outcome = await Promise.race([
        sending.then(result => ({ result })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 10000); }),
      ]).finally(() => clearTimeout(timer));
      if (!outcome.timedOut) await new Promise(resolve => setTimeout(resolve, 1200));
      const observed = await inspect(page);
      const probe = await worker.evaluate(() => ({ ...pasteRetryProbe }));
      const receipts = await page.locator('article.message-row.self .message-body').allTextContents();
      console.log('PASTE RETRY RESULT ' + JSON.stringify({ timedOut: !!outcome.timedOut, pastes: observed.pastes,
        firstDispatch: observed.pasteDispatches[0], modelWrites: observed.nonemptyModelWrites.length, maxActive: probe.maxActive,
        submissions: observed.submits, receipts: receipts.length, result: outcome.result?.job?.lastResult }));
      assert.deepEqual(observed.pasteDispatches[0], { cancelable: true, defaultPrevented: false, modelAfter: '', updates: 0, submits: 0 },
        'The first paste must be uncanceled and leave the model untouched');
      assert.equal(observed.pastes, 2, 'An unhandled first paste must be retried exactly once');
      assert.deepEqual(observed.pasteEvents, [
        { text: largePrompt, trusted: false, modelBefore: '' },
        { text: largePrompt, trusted: false, modelBefore: '' },
      ], 'Both synthetic pastes must preserve the prompt and start from an unchanged model');
      assert.equal(observed.pasteDispatches[1].defaultPrevented, true);
      assert.equal(observed.pasteDispatches[1].modelAfter, largePrompt);
      assert.deepEqual(observed.nonemptyModelWrites, [{ pastes: 2, text: largePrompt }], 'Only the second paste may populate the model');
      assert.equal(probe.maxActive, 1, 'Page send attempts must not overlap');
      assert.equal(outcome.timedOut, undefined, 'The accepted retry must complete');
      assert.equal(outcome.result.ok, true, outcome.result.error);
      assert.equal(outcome.result.job.sentCount, 1, outcome.result.job.statusText);
      assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [1, 0, 1]);
      assert.deepEqual(observed.sentTexts, [largePrompt]);
      assert.deepEqual(receipts, [largePrompt]);
      assert.equal(observed.visibility, 'hidden');
      assert.equal(await foreground.locator('#work').inputValue(), 'Unrelated synthetic document');
    } finally {
      await call({ type: 'PAUSE' });
      if (sending) await sending;
      await worker.evaluate(() => {
        if (globalThis.originalPasteRetryExecute) chrome.scripting.executeScript = originalPasteRetryExecute;
        delete globalThis.originalPasteRetryExecute;
        delete globalThis.pasteRetryProbe;
      });
      await foreground.close();
    }
  }, true);
  if (testPasteSafety === 'uncanceled-async') await scenario('Uncanceled asynchronously handled first paste is not injected or sent twice', async page => {
    const largePrompt = Array.from({ length: 1200 }, (_, index) =>
      `ASYNC_LINE_${String(index + 1).padStart(4, '0')} 中文 ${'synthetic text '.repeat(3)}`).join('\n');
    assert.ok(largePrompt.length >= 32768 && largePrompt.includes('\n'));
    const foreground = await newPage('https://pm-foreground.invalid/paste-uncanceled-async');
    let sending;
    let timer;
    try {
      await foreground.bringToFront();
      await foreground.locator('#work').focus();
      await page.waitForFunction(() => document.hidden && !document.hasFocus());
      assert.equal(await page.evaluate(() => !!pm.dom.editor?.view), false);
      await page.evaluate(() => {
        fixture.pastes = 0;
        fixture.pasteEvents = [];
        fixture.modelWrites = [];
        const dispatchTransaction = pm.props.dispatchTransaction;
        pm.setProps({ dispatchTransaction(transaction) {
          dispatchTransaction.call(pm, transaction);
          const text = pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n');
          if (transaction.docChanged && text) fixture.modelWrites.push(text);
        } });
        pm.dom.addEventListener('paste', event => {
          fixture.pastes++;
          const number = fixture.pastes;
          const text = event.clipboardData.getData('text/plain');
          const html = event.clipboardData.getData('text/html');
          queueMicrotask(() => fixture.pasteEvents.push({ number, text, trusted: event.isTrusted,
            cancelable: event.cancelable, defaultPrevented: event.defaultPrevented,
            modelAfter: pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n') }));
          if (number === 1) {
            event.stopImmediatePropagation();
            fixture.asyncPasteTimer = setTimeout(() => {
              fixture.asyncPasteReleased = pm.pasteHTML(html);
            }, 1200);
          }
        }, true);
      });
      const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
      assert.equal(started.job.prompt, largePrompt);
      sending = call({ type: 'SEND_NOW' });
      await page.waitForFunction(() => fixture.pasteEvents.length > 0, null, { polling: 100, timeout: 10000 });
      const first = await page.evaluate(() => fixture.pasteEvents[0]);
      assert.deepEqual(first, { number: 1, text: largePrompt, trusted: false, cancelable: true, defaultPrevented: false, modelAfter: '' },
        'The first paste must be uncanceled and leave the model unchanged synchronously');
      await page.waitForFunction(() => fixture.asyncPasteReleased !== undefined, null, { polling: 100, timeout: 10000 });
      const outcome = await Promise.race([
        sending.then(result => ({ result })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 10000); }),
      ]).finally(() => clearTimeout(timer));
      await new Promise(resolve => setTimeout(resolve, 1200));
      const observed = await inspect(page);
      const remaining = await page.evaluate(() => pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n'));
      const receipts = await page.locator('article.message-row.self .message-body').allTextContents();
      console.log('UNCANCELED ASYNC PASTE RESULT ' + JSON.stringify({ pastes: observed.pastes,
        asyncPasteReleased: observed.asyncPasteReleased, modelWrites: observed.modelWrites.length,
        submissions: observed.submits, receipts: receipts.length, remainingLength: remaining.length,
        timedOut: !!outcome.timedOut, sentCount: outcome.result?.job?.sentCount }));
      assert.equal(observed.asyncPasteReleased, true, 'The first paste must actually reach ProseMirror asynchronously');
      assert.equal(observed.pastes, 1, 'An uncanceled asynchronous paste must not be reinjected');
      assert.deepEqual(observed.modelWrites, [largePrompt], 'The prompt must enter the model exactly once');
      assert.equal(outcome.timedOut, undefined, 'The original paste must complete the pending send');
      assert.equal(outcome.result.ok, true, outcome.result.error);
      assert.equal(outcome.result.job.sentCount, 1, outcome.result.job.statusText);
      assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [1, 0, 1]);
      assert.deepEqual(observed.sentTexts, [largePrompt]);
      assert.deepEqual(receipts, [largePrompt]);
      assert.equal(remaining, '', 'A late paste must not refill the composer after submission');
      assert.equal(observed.visibility, 'hidden');
      assert.equal(await foreground.locator('#work').inputValue(), 'Unrelated synthetic document');
    } finally {
      clearTimeout(timer);
      await page.evaluate(() => clearTimeout(fixture.asyncPasteTimer)).catch(() => {});
      await call({ type: 'PAUSE' });
      if (sending) await sending;
      await foreground.close();
    }
  }, true);
  if (testPasteSafety === 'delayed') await scenario('Delayed first long paste beyond the retry window is not rewritten and sends exactly once after recovery', async page => {
    const largePrompt = Array.from({ length: 1200 }, (_, index) =>
      `DELAYED_LINE_${String(index + 1).padStart(4, '0')} 中文 ${'synthetic text '.repeat(3)}`).join('\n');
    assert.ok(largePrompt.length >= 32768 && largePrompt.includes('\n'));
    const foreground = await newPage('https://pm-foreground.invalid/paste-delayed');
    let sending;
    try {
      await foreground.bringToFront();
      await foreground.locator('#work').focus();
      await page.waitForFunction(() => document.hidden && !document.hasFocus());
      assert.equal(await page.evaluate(() => !!pm.dom.editor?.view), false);
      await page.evaluate(() => {
        fixture.pastes = 0;
        fixture.pasteEvents = [];
        fixture.modelWrites = [];
        const dispatchTransaction = pm.props.dispatchTransaction;
        pm.setProps({ dispatchTransaction(transaction) {
          dispatchTransaction.call(pm, transaction);
          if (transaction.docChanged && pm.state.doc.textContent)
            fixture.modelWrites.push(pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n'));
        } });
        pm.dom.addEventListener('paste', event => {
          fixture.pastes++;
          const text = event.clipboardData.getData('text/plain');
          const html = event.clipboardData.getData('text/html');
          fixture.pasteEvents.push({ text, trusted: event.isTrusted });
          if (fixture.pastes === 1) fixture.pendingPaste = { text, html };
          event.preventDefault();
          event.stopImmediatePropagation();
        }, true);
        window.fixtureReleasePaste = () => {
          const pending = fixture.pendingPaste;
          fixture.pendingPaste = null;
          fixture.released = pm.pasteHTML(pending.html);
        };
      });
      const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
      assert.equal(started.job.prompt, largePrompt);
      sending = call({ type: 'SEND_NOW' });
      await page.waitForFunction(() => fixture.pastes >= 1, null, { polling: 100, timeout: 10000 });
      await new Promise(resolve => setTimeout(resolve, 8000));
      const beforeRecovery = await inspect(page);
      await page.evaluate(() => fixtureReleasePaste());
      let timer;
      const outcome = await Promise.race([
        sending.then(result => ({ result })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 10000); }),
      ]).finally(() => clearTimeout(timer));
      const observed = await inspect(page);
      const receipts = await page.locator('article.message-row.self .message-body').allTextContents();
      console.log('DELAYED PASTE RESULT ' + JSON.stringify({ beforeRecoveryPastes: beforeRecovery.pastes,
        pastes: observed.pastes, modelWrites: observed.modelWrites.length, submissions: observed.submits,
        receipts: receipts.length, timedOut: !!outcome.timedOut, sentCount: outcome.result?.job?.sentCount }));
      assert.deepEqual([beforeRecovery.updates, beforeRecovery.buttonClicks, beforeRecovery.keyboardCommands, beforeRecovery.submits], [0, 0, 0, 0]);
      assert.equal(observed.released, true, 'The original delayed paste must be processed by ProseMirror');
      assert.deepEqual(observed.modelWrites, [largePrompt], 'Recovery must write the original prompt exactly once');
      assert.equal(outcome.timedOut, undefined, 'The recovered paste must complete the pending send');
      assert.equal(outcome.result.ok, true, outcome.result.error);
      assert.equal(outcome.result.job.sentCount, 1, outcome.result.job.statusText);
      assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [1, 0, 1]);
      assert.deepEqual(observed.sentTexts, [largePrompt]);
      assert.deepEqual(receipts, [largePrompt]);
      assert.equal(observed.visibility, 'hidden');
      assert.equal(await foreground.locator('#work').inputValue(), 'Unrelated synthetic document');
      assert.equal(beforeRecovery.pastes, 1, 'The pending first paste must not be repeated after its observation window');
      assert.deepEqual(observed.pasteEvents, [{ text: largePrompt, trusted: false }]);
    } finally {
      await call({ type: 'PAUSE' });
      if (sending) await sending;
      await foreground.close();
    }
  }, true);
  if (testPasteSafety === 'delayed-manual') await scenario('An accepted delayed paste cannot refill the composer after a trusted manual Send', async page => {
    const largePrompt = Array.from({ length: 1200 }, (_, index) =>
      `MANUAL_DELAYED_LINE_${String(index + 1).padStart(4, '0')} 中文 ${'synthetic text '.repeat(3)}`).join('\n');
    assert.ok(largePrompt.length >= 32768 && largePrompt.includes('\n'));
    let sending;
    try {
      assert.equal(await page.evaluate(() => !!pm.dom.editor?.view), false);
      await page.evaluate(() => {
        fixture.pastes = 0;
        fixture.manualClicks = 0;
        fixture.lateWrites = 0;
        const dispatchTransaction = pm.props.dispatchTransaction;
        pm.setProps({ dispatchTransaction(transaction) {
          if (fixture.releasing && transaction.docChanged) fixture.lateWrites++;
          dispatchTransaction.call(pm, transaction);
        } });
        pm.dom.addEventListener('paste', event => {
          fixture.pastes++;
          fixture.pendingPaste = { text: event.clipboardData.getData('text/plain'), html: event.clipboardData.getData('text/html'), trusted: event.isTrusted };
          event.preventDefault();
          event.stopImmediatePropagation();
          queueMicrotask(() => { fixture.pasteAccepted = event.defaultPrevented; });
        }, true);
        document.querySelector('button[aria-label="Send"]').addEventListener('click', event => {
          if (event.isTrusted) fixture.manualClicks++;
        }, true);
      });
      await page.bringToFront();
      await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
      sending = call({ type: 'SEND_NOW' });
      await page.waitForFunction(() => fixture.pasteAccepted && fixture.pendingPaste, null, { timeout: 10000 });
      const pending = await page.evaluate(() => ({ text: fixture.pendingPaste.text, trusted: fixture.pendingPaste.trusted, pastes: fixture.pastes }));
      assert.deepEqual(pending, { text: largePrompt, trusted: false, pastes: 1 });
      assert.equal(await page.evaluate(() => pm.state.doc.textContent), '');
      await page.evaluate(text => {
        fixture.manualFillResult = pm.pasteText(text);
        fixture.manualTextMatches = pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n') === text;
      }, largePrompt);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      let timeout;
      const outcome = await Promise.race([
        sending,
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Manual Send was not confirmed')), 10000); }),
      ]).finally(() => clearTimeout(timeout));
      const beforeLate = await inspect(page);
      assert.equal(beforeLate.manualFillResult, true);
      assert.equal(beforeLate.manualTextMatches, true);
      assert.equal(outcome.job.sentCount, 0, 'A manual Send must not count as an extension submission');
      assert.equal(outcome.job.manualSentCount, 1);
      assert.deepEqual([beforeLate.manualClicks, beforeLate.buttonClicks, beforeLate.keyboardCommands, beforeLate.submits], [1, 1, 0, 1]);
      assert.deepEqual(beforeLate.sentTexts, [largePrompt]);
      assert.deepEqual(await page.locator('article.message-row.self .message-body').allTextContents(), [largePrompt]);
      assert.equal(beforeLate.editorEmpty, true);
      await page.evaluate(() => {
        fixture.releasing = true;
        fixture.releaseResult = pm.pasteHTML(fixture.pendingPaste.html);
        fixture.releasing = false;
        fixture.pendingPaste = null;
      });
      await new Promise(resolve => setTimeout(resolve, 1200));
      const afterLate = await inspect(page);
      const remaining = await page.evaluate(() => pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n'));
      console.log('DELAYED MANUAL PASTE RESULT ' + JSON.stringify({ pastes: afterLate.pastes, manualClicks: afterLate.manualClicks,
        lateWrites: afterLate.lateWrites, remainingLength: remaining.length, submissions: afterLate.submits, sentCount: outcome.job.sentCount }));
      assert.deepEqual([afterLate.pastes, afterLate.manualClicks, afterLate.buttonClicks, afterLate.keyboardCommands, afterLate.submits], [1, 1, 1, 0, 1]);
      assert.deepEqual(afterLate.sentTexts, [largePrompt]);
      assert.deepEqual(await page.locator('article.message-row.self .message-body').allTextContents(), [largePrompt]);
      assert.equal((await call({ type: 'GET_STATE' })).job.sentCount, 0);
      assert.equal(remaining.length, 0, 'The accepted paste arriving after manual Send must not refill the composer');
      assert.equal(afterLate.lateWrites, 0, 'No late paste transaction may change the composer after manual Send');
    } finally {
      await call({ type: 'PAUSE' });
      if (sending) await sending;
    }
  }, true);
  if (testPasteSafety && !['ignored-bounded', 'rollback', 'retry', 'delayed', 'delayed-manual', 'uncanceled-async', 'natural-attachment'].includes(testPasteSafety)) await scenario(`Vanilla ProseMirror ${testPasteSafety} paste preserves manual control without refilling`, async page => {
    const largePrompt = Array.from({ length: 1200 }, (_, index) =>
      `SAFETY_LINE_${String(index + 1).padStart(4, '0')} 中文 ${'synthetic text '.repeat(3)}`).join('\n');
    await page.evaluate(({ variant, text }) => {
      fixture.pastes = 0;
      fixture.takeoverWrites = 0;
      pm.dom.addEventListener('paste', event => {
        fixture.pastes++;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (variant === 'takeover') setTimeout(() => {
          pm.dispatch(pm.state.tr.insertText(text, 0, pm.state.doc.content.size));
          fixture.takeoverWrites++;
        }, 100);
      }, true);
    }, { variant: testPasteSafety, text: largePrompt });
    await worker.evaluate(() => {
      globalThis.originalPasteSafetySend = chrome.tabs.sendMessage;
      chrome.tabs.sendMessage = (tabId, message, options) => message.type === 'GRANT_RUN'
        ? new Promise(() => {}) : originalPasteSafetySend(tabId, message, options);
    });
    await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    const sending = call({ type: 'SEND_NOW' });
    try {
      const first = await Promise.race([
        page.waitForFunction(() => fixture.pastes > 0, null, { timeout: 10000 }).then(() => 'paste'),
        sending.then(() => 'settled'),
      ]);
      assert.equal(first, 'paste', 'The real extension must attempt a paste before settling');
      if (testPasteSafety === 'takeover') {
        await page.waitForFunction(text => fixture.takeoverWrites === 1 && pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n') === text, largePrompt);
        await page.getByRole('button', { name: 'Send', exact: true }).click();
      }
      const initial = await inspect(page);
      await new Promise(resolve => setTimeout(resolve, 1200));
      const beforePause = await inspect(page);
      assert.deepEqual([beforePause.pastes, beforePause.takeoverWrites, beforePause.updates, beforePause.buttonClicks, beforePause.keyboardCommands, beforePause.submits],
        [initial.pastes, initial.takeoverWrites, initial.updates, initial.buttonClicks, initial.keyboardCommands, initial.submits],
        'Ignored paste or manual submission must not trigger a refill or another submission before Pause');
      assert.equal(beforePause.pastes, 1, 'The paste must not be repeated');
      assert.equal(beforePause.takeoverWrites, testPasteSafety === 'takeover' ? 1 : 0);
      assert.deepEqual([beforePause.buttonClicks, beforePause.keyboardCommands, beforePause.submits], testPasteSafety === 'takeover' ? [1, 0, 1] : [0, 0, 0]);
      assert.deepEqual(beforePause.sentTexts, testPasteSafety === 'takeover' ? [largePrompt] : []);
      assert.equal(beforePause.editorEmpty, true);
      const paused = await call({ type: 'PAUSE' });
      assert.equal(paused.job.enabled, false);
      const outcome = await sending;
      assert.equal(outcome.job.sentCount, 0, 'No extension submission may be attributed after Pause');
      assert.equal((await call({ type: 'SEND_NOW' })).ok, false);
      await new Promise(resolve => setTimeout(resolve, 1200));
      const afterPause = await inspect(page);
      assert.deepEqual([afterPause.pastes, afterPause.takeoverWrites, afterPause.updates, afterPause.buttonClicks, afterPause.keyboardCommands, afterPause.submits],
        [beforePause.pastes, beforePause.takeoverWrites, beforePause.updates, beforePause.buttonClicks, beforePause.keyboardCommands, beforePause.submits],
        'Pause must prevent later refills and submissions');
      assert.equal(afterPause.editorEmpty, true);
    } finally {
      await call({ type: 'PAUSE' });
      await sending;
      await worker.evaluate(() => { chrome.tabs.sendMessage = originalPasteSafetySend; delete globalThis.originalPasteSafetySend; });
    }
  }, true);
  for (const [shape, largePrompt] of [
    ['single-line', 'CHUNK_HEAD_' + 'a'.repeat(999) + '🧑🏽‍💻' + 'b'.repeat(11000) + '_CHUNK_TAIL'],
    ['multiline', 'CHUNK_HEAD_\n\n' + Array.from({ length: 140 }, (_, index) =>
      `CHUNK_LINE_${String(index).padStart(3, '0')} 中文 e\u0301 ${'spacing  '.repeat(18)}`).join('\n') + '\n\n_CHUNK_TAIL'],
  ]) await scenario(`Chunked text insertion replaces drafts and sends one exact ${shape} message per round`, async page => {
    await page.evaluate(() => {
      fixture.pastes = 0;
      fixture.inputs = [];
      pm.dom.addEventListener('paste', () => { fixture.pastes++; }, true);
      pm.dom.addEventListener('input', event => fixture.inputs.push({ type: event.inputType, length: event.data?.length ?? 0 }), true);
      pm.dispatch(pm.state.tr.insertText('SYNTHETIC_PREVIOUS_DRAFT_MUST_BE_REPLACED', 0, pm.state.doc.content.size));
    });
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText' && typeof value === 'string' && value.length > 1000) return false;
        return original(name, ui, value);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    let timeout;
    try {
      const outcome = await Promise.race([
        sending.then(result => ({ result })),
        new Promise(resolve => { timeout = setTimeout(() => resolve({ timedOut: true }), 18000); }),
      ]).finally(() => clearTimeout(timeout));
      if (outcome.timedOut) await call({ type: 'PAUSE' });
      const result = outcome.result || await sending;
      const observed = await inspect(page);
      const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
      console.log('CHUNKED SEND RESULT ' + JSON.stringify({ shape, characters: largePrompt.length,
        timedOut: !!outcome.timedOut, pastes: observed.pastes, inputs: observed.inputs.length,
        submissions: observed.submits, sentCount: result.job?.sentCount, counters: trace?.counters, timings: trace?.timings }));
      assert.notEqual(outcome.timedOut, true, 'Chunked insertion must finish without waiting for a rejected whole-prompt write');
      assert.equal(observed.pastes, 0, 'Normal text insertion must not dispatch a paste event');
      assert.ok(observed.inputs.length > 1, 'A long prompt must be inserted in multiple browser input operations');
      assert.ok(observed.inputs.every(input => input.length <= 1000), 'Each text operation must contain at most 1000 UTF-16 units');
      assert.equal(result.ok, true, result.error);
      assert.equal(result.job.sentCount, 1, result.job.statusText);
      assert.deepEqual(observed.sentTexts, [largePrompt], 'The actual submitted model must exactly match the complete prompt');
      assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [1, 0, 1]);
      assert.ok(trace.counters.domWrites > 1);
      assert.equal(trace.counters.dispatchAttempts, 1);
      await page.evaluate(() => pm.dispatch(pm.state.tr.insertText('SYNTHETIC_DIFFERENT_DRAFT', 0, pm.state.doc.content.size)));
      const next = await call({ type: 'SEND_NOW' });
      const repeated = await inspect(page);
      assert.equal(next.job.sentCount, 2, next.job.statusText);
      assert.deepEqual(repeated.sentTexts, [largePrompt, largePrompt]);
      assert.deepEqual([repeated.buttonClicks, repeated.keyboardCommands, repeated.submits], [2, 0, 2]);
      assert.equal(repeated.pastes, 0);
    } finally {
      clearTimeout(timeout);
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  async function assertAdoptedPreparedSubmission(page, result, configured, expected, {
    method = 'button', receiptKey = 'pm-account~pm-dot~new-1', interceptedButton = false,
  } = {}) {
    assert.notEqual(expected, configured, 'This case must exercise explicitly changed prepared text');
    assert.equal(result.ok, true, result.error);
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.equal(result.job.unknownCount, 0);
    assert.equal(result.job.prompt, configured, 'Adoption must not replace the saved job prompt');
    assert.equal((await call({ type: 'GET_STATE' })).config.prompt, configured);
    const observed = await inspect(page);
    assert.deepEqual(observed.sentTexts, [expected], 'Exactly the adopted model must actually be submitted');
    assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits],
      method === 'button' ? [interceptedButton ? 0 : 1, 0, 1] : [0, 1, 1]);
    const receipts = await page.locator('#history .message-row.self').evaluateAll(rows => rows.map(row => ({
      key: row.dataset.messageId, text: row.querySelector('.message-body').textContent,
    })));
    assert.deepEqual(receipts, [{ key: receiptKey, text: expected }], 'The local receipt must be new and match the actual adopted submission');
    const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
    assert.equal(trace.state, 'sent');
    assert.equal(trace.counters.dispatchAttempts, 1);
    assert.ok(trace.counters.receiptChecks >= 1);
    return trace;
  }
  for (const interruption of ['pause', 'manual-send', 'user-edit', 'page-edit'])
    await scenario(`Chunked insertion handles ${interruption} before writing a later segment`, async page => {
      const largePrompt = 'CHUNK_START_' + 'x'.repeat(18000) + '_CHUNK_END';
      await page.evaluate(() => {
        fixture.pastes = 0;
        fixture.insertedInputs = 0;
        pm.dom.addEventListener('paste', () => { fixture.pastes++; }, true);
        pm.dom.addEventListener('input', () => { fixture.insertedInputs++; }, true);
      });
      const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
        const send = chrome.runtime.sendMessage.bind(chrome.runtime);
        globalThis.chunkGate = { held: false };
        chrome.runtime.sendMessage = async message => {
          if (message.type === 'WAIT_RUN' && message.delayMs === 50 && !chunkGate.held
              && document.querySelector('[data-composer-markdown]')?.textContent?.startsWith('CHUNK_START_')) {
            chunkGate.held = true;
            document.documentElement.dataset.chunkHeld = 'true';
            await new Promise(resolve => { chunkGate.release = resolve; });
          }
          return send(message);
        };
      } }), started.job.tabId);
      const sending = call({ type: 'SEND_NOW' });
      try {
        await page.waitForFunction(() => document.documentElement.dataset.chunkHeld === 'true', null, { timeout: 8000 });
        const initial = await inspect(page);
        assert.equal(initial.insertedInputs, 1);
        assert.equal(initial.submits, 0);
        if (interruption === 'pause') {
          assert.equal((await call({ type: 'PAUSE' })).job.enabled, false);
        } else if (interruption === 'manual-send') {
          await page.getByRole('button', { name: 'Send', exact: true }).click();
        } else if (interruption === 'user-edit') {
          await page.locator('[data-composer-markdown]').press('End');
          await page.locator('[data-composer-markdown]').press('Y');
        } else {
          await page.evaluate(() => pm.dispatch(pm.state.tr.insertText('SYNTHETIC_SITE_EDIT', 0, pm.state.doc.content.size)));
        }
        const afterInterruption = await inspect(page);
        await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => chunkGate.release() }), started.job.tabId);
        const result = await sending;
        await new Promise(resolve => setTimeout(resolve, 250));
        const afterRelease = await inspect(page);
        assert.equal(afterRelease.pastes, 0);
        if (['pause', 'manual-send'].includes(interruption)) {
          assert.equal(afterRelease.insertedInputs, afterInterruption.insertedInputs, 'No segment may be inserted after Pause or manual submission');
          assert.equal(afterRelease.submits, interruption === 'manual-send' ? 1 : 0);
          assert.equal(result.job.sentCount, 0);
          if (interruption === 'manual-send') assert.notEqual(afterRelease.sentTexts[0], largePrompt);
        } else {
          assert.ok(afterRelease.insertedInputs > afterInterruption.insertedInputs);
          const adoptedPrefix = interruption === 'user-edit' ? largePrompt.slice(0, 1000) + 'Y' : 'SYNTHETIC_SITE_EDIT';
          await assertAdoptedPreparedSubmission(page, result, largePrompt, adoptedPrefix + largePrompt.slice(1000));
        }
      } finally {
        await call({ type: 'PAUSE' });
        await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => chunkGate.release?.() }), started.job.tabId);
        await sending;
      }
    });
  for (const supported of [false, true]) await scenario(`Long insertion preserves a hidden foreground and records its actual model or chunk method for supported=${supported}`, async page => {
    const largePrompt = 'SYNTHETIC_CHUNKED_DIAGNOSTIC_' + 'z'.repeat(11000) + '_END';
    const foreground = await newPage('https://pm-foreground.invalid/chunked-diagnostic');
    try {
      await foreground.bringToFront();
      await foreground.locator('#work').focus();
      await foreground.locator('#work').evaluate(input => input.setSelectionRange(3, 8));
      await page.waitForFunction(() => document.hidden && !document.hasFocus());
      assert.equal(await page.evaluate(() => !!pm.dom.editor?.view), supported);
      const before = await foreground.evaluate(() => ({ value: document.querySelector('#work').value,
        start: document.querySelector('#work').selectionStart, end: document.querySelector('#work').selectionEnd,
        focused: document.activeElement === document.querySelector('#work') }));
      await page.evaluate(() => {
        fixture.pastes = 0;
        pm.dom.addEventListener('paste', () => { fixture.pastes++; }, true);
      });
      await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
      const result = await call({ type: 'SEND_NOW' });
      const observed = await inspect(page);
      const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
      assert.equal(result.job.sentCount, 1, result.job.statusText);
      assert.deepEqual(observed.sentTexts, [largePrompt]);
      assert.equal(observed.pastes, 0);
      assert.equal(trace.counters.textChunks, supported ? 0 : Math.ceil(largePrompt.length / 1000));
      assert.equal(trace.counters.modelWrites, supported ? 1 : 0);
      assert.equal(trace.counters.dispatchAttempts, 1);
      assert.deepEqual(await foreground.evaluate(() => ({ value: document.querySelector('#work').value,
        start: document.querySelector('#work').selectionStart, end: document.querySelector('#work').selectionEnd,
        focused: document.activeElement === document.querySelector('#work') })), before);
    } finally { await foreground.close(); }
  });
  await scenario('Chunked insertion recovers from a rejected input command by fully replacing the draft', async page => {
    const largePrompt = 'SYNTHETIC_REJECTED_CHUNK_' + 'w'.repeat(6000);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      let calls = 0;
      document.execCommand = (name, ui, value) => name === 'insertText' && ++calls === 2 ? false : original(name, ui, value);
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
    assert.equal(result.job.enabled, true);
    assert.equal(result.job.sentCount, 1);
    assert.equal(observed.submits, 1);
    assert.deepEqual(observed.sentTexts, [largePrompt]);
    assert.equal(trace.counters.chunkRestarts, 1);
  });
  await scenario('A page-created unremovable attachment holds chunked text until Pause without a false paste diagnosis', async page => {
    const largePrompt = 'SYNTHETIC_ATTACHMENT_DURING_CHUNKS_' + 'q'.repeat(6000);
    await page.evaluate(() => {
      fixture.pastes = 0;
      pm.dom.addEventListener('paste', () => { fixture.pastes++; }, true);
      pm.dom.addEventListener('input', () => {
        if (fixture.addedDuringChunk) return;
        fixture.addedDuringChunk = true;
        const chip = document.createElement('span');
        chip.dataset.testid = 'attachment';
        chip.textContent = 'SYNTHETIC_PAGE_ATTACHMENT';
        pm.dom.closest('[data-composer-body]').append(chip);
      }, true);
    });
    await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => fixture.addedDuringChunk);
      const observed = await inspect(page);
      const waiting = (await call({type:'GET_STATE'})).job;
      assert.equal(waiting.enabled,true);
      assert.equal(waiting.sentCount,0);
      assert.deepEqual([observed.submits,observed.pastes],[0,0]);
      assert.equal(await page.locator('[data-testid="attachment"]').count(), 1);
      assert.equal((await call({type:'PAUSE'})).job.enabled,false);
      assert.equal((await sending).job.sentCount,0);
      const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
      assert.equal(trace.counters.textChunks,1);
      assert.equal(trace.counters.dispatchAttempts,0);
      assert.notEqual(trace.reason,'paste-attachment-unconfirmed');
    } finally { await call({type:'PAUSE'}); await sending; }
  });
  await scenario('A background chunked task cannot silently type into another focused editor after a focus change', async page => {
    const largePrompt = 'SYNTHETIC_FOCUS_RACE_' + 'r'.repeat(9000);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.focusGate = { held: false };
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && !focusGate.held
            && document.querySelector('[data-composer-markdown]')?.textContent?.startsWith('SYNTHETIC_FOCUS_RACE_')) {
          focusGate.held = true;
          document.documentElement.dataset.focusGateHeld = 'true';
          await new Promise(resolve => { focusGate.release = resolve; });
        }
        return send(message);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => document.documentElement.dataset.focusGateHeld === 'true', null, { timeout: 8000 });
      await page.evaluate(() => {
        const other = document.createElement('textarea');
        other.id = 'other-editor';
        other.value = 'SYNTHETIC_OTHER_DRAFT';
        document.body.append(other);
        other.focus();
      });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => focusGate.release() }), started.job.tabId);
      const result = await sending;
      const observed = await inspect(page);
      assert.equal(await page.locator('#other-editor').inputValue(), 'SYNTHETIC_OTHER_DRAFT');
      assert.ok((observed.submits === 0 && result.job.sentCount === 0)
        || (observed.submits === 1 && result.job.sentCount === 1 && observed.sentTexts[0] === largePrompt));
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => focusGate.release?.() }), started.job.tabId);
      await sending;
    }
  });
  await scenario('A private stale model after complete chunked preparation stays unconfirmed after one dispatch', async page => {
    const largePrompt = 'SYNTHETIC_COMPLETE_' + 'm'.repeat(12000) + '_END';
    await page.evaluate(() => {
      fixture.externalModel = 'SYNTHETIC_STALE_EXTERNAL_MODEL';
      document.querySelector('button[aria-label="Send"]').addEventListener('click', event => {
        event.stopImmediatePropagation();
        fixture.submits++;
        fixture.sentTexts.push(fixture.externalModel);
      }, true);
    });
    await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    const sending = call({ type: 'SEND_NOW' });
    let timeout;
    try {
      await page.waitForFunction(()=>fixture.submits===1,null,{timeout:15000});
      const observed = await inspect(page);
      console.log('CHUNK STALE MODEL RESULT ' + JSON.stringify({ submissions: observed.submits,
        exact: observed.sentTexts[0] === largePrompt }));
      assert.deepEqual(observed.sentTexts,['SYNTHETIC_STALE_EXTERNAL_MODEL']);
      assert.equal((await call({type:'GET_STATE'})).job.sentCount,0);
      assert.equal(await page.locator('#history .message-row.self').count(),0);
      await new Promise(resolve=>setTimeout(resolve,500));
      assert.equal((await inspect(page)).submits,1);
    } finally {
      clearTimeout(timeout);
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  await scenario('A no-op replacement remains pending without dispatch and honors Pause', async page => {
    const largePrompt = 'SYNTHETIC_MATCHING_' + 's'.repeat(11000) + '_END';
    await page.evaluate(largePrompt => {
      pm.dispatch(pm.state.tr.insertText(largePrompt, 0, pm.state.doc.content.size));
      fixture.chunkInputs = 0;
      pm.dom.addEventListener('input', () => { fixture.chunkInputs++; }, true);
    }, largePrompt);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      let attempts = 0;
      document.execCommand = () => {
        document.documentElement.dataset.noopAttempts = String(++attempts);
        return true;
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => Number(document.documentElement.dataset.noopAttempts) >= 3, null, { timeout: 10000 });
      const observed = await inspect(page);
      assert.equal((await call({ type: 'GET_STATE' })).job.enabled, true);
      assert.equal(observed.submits, 0);
      assert.equal(observed.chunkInputs, 0);
      assert.equal(await page.evaluate(() => pm.state.doc.textContent), largePrompt);
      assert.equal((await call({ type: 'PAUSE' })).job.enabled, false);
      assert.equal((await sending).job.sentCount, 0);
    } finally {
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  await scenario('A consistently transformed invisible character is adopted with a matching local receipt', async page => {
    const largePrompt = 'SYNTHETIC_INVISIBLE_' + 't'.repeat(800) + '\u00a0' + 'v'.repeat(3000);
    await page.evaluate(() => {
      const send = document.querySelector('button[aria-label="Send"]');
      send.addEventListener('click', event => {
        event.stopImmediatePropagation();
        const source = pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n');
        fixture.submits++;
        fixture.sentTexts.push(source);
        const row = document.createElement('article');
        row.className = 'message-row self';
        row.dataset.messageId = 'pm-account~pm-dot~visible-difference';
        const body = document.createElement('div');
        body.className = 'message-body';
        body.textContent = source;
        row.append(body);
        document.querySelector('#history').append(row);
      }, true);
    });
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      let changes = 0;
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText' && typeof value === 'string' && value.includes('\u00a0'))
          document.documentElement.dataset.invisibleChanges = String(++changes);
        return original(name, ui, name === 'insertText' && typeof value === 'string' ? value.replaceAll('\u00a0', ' ') : value);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    let timer;
    try {
      const outcome = await Promise.race([sending.then(result => ({ result })), new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 12000); })]);
      if (outcome.timedOut) await call({ type: 'PAUSE' });
      const result = outcome.result || await sending;
      const observed = await inspect(page);
      assert.notEqual(outcome.timedOut, true);
      assert.equal(Number(await page.evaluate(() => document.documentElement.dataset.invisibleChanges)), 1);
      const trace = await assertAdoptedPreparedSubmission(page, result, largePrompt, largePrompt.replaceAll('\u00a0', ' '),
        { receiptKey: 'pm-account~pm-dot~visible-difference', interceptedButton: true });
      assert.ok(trace.counters.chunkDifferences > 0);
      assert.equal(trace.counters.chunkRestarts, 0);
    } finally {
      clearTimeout(timer);
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  await scenario('Chunked entry preserves representative Unicode, whitespace, and line boundaries', async page => {
    const boundary = 'A'.repeat(998) + '🧑🏽‍💻' + '\n\n B\t  C\u00a0D e\u0301 <&>\n';
    const largePrompt = boundary + Array.from({ length: 120 }, (_, index) =>
      index % 9 === 0 ? '' : `UNICODE_${index} 中文 e\u0301 é 🧑🏽‍💻 <&> \t`).join('\n') + '\n\n END ';
    const expected = largePrompt;
    await page.evaluate(() => {
      fixture.pastes = 0;
      fixture.inputChunks = 0;
      pm.dom.addEventListener('paste', () => { fixture.pastes++; }, true);
      pm.dom.addEventListener('input', () => { fixture.inputChunks++; }, true);
    });
    await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    const sending = call({ type: 'SEND_NOW' });
    let timer;
    try {
      const outcome = await Promise.race([
        sending.then(result => ({ result })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 12000); }),
      ]).finally(() => clearTimeout(timer));
      if (outcome.timedOut) await call({ type: 'PAUSE' });
      const result = outcome.result || await sending;
      const observed = await inspect(page);
      console.log('CHUNK UNICODE RESULT ' + JSON.stringify({ timedOut: !!outcome.timedOut, pastes: observed.pastes,
        submissions: observed.submits, sentCount: result.job?.sentCount, diagnostic: result.job?.lastDiagnosticCode }));
      assert.notEqual(outcome.timedOut, true);
      assert.equal(result.job.sentCount, 1, result.job.statusText);
      assert.deepEqual(observed.sentTexts, [expected]);
      assert.equal(observed.pastes, 0);
    } finally {
      clearTimeout(timer);
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  for (const supported of [false, true]) await scenario(`Newline-dense text remains responsive and exact with supported=${supported}`, async page => {
    const largePrompt = 'DENSE_HEAD\n' + Array.from({ length: 1800 }, (_, index) =>
      `DENSE_${String(index).padStart(4, '0')} 中文 ${'text '.repeat(8)}`).join('\n') + '\nDENSE_TAIL';
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      globalThis.syntheticBudget = { calls: 0, maxNewlines: 0 };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') {
          syntheticBudget.calls++;
          if (typeof value === 'string') syntheticBudget.maxNewlines = Math.max(syntheticBudget.maxNewlines, (value.match(/\n/g) || []).length);
        }
        return original(name, ui, value);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    let timeout;
    try {
      const outcome = await Promise.race([
        sending.then(result => ({ result })),
        new Promise(resolve => { timeout = setTimeout(() => resolve({ timedOut: true }), 25000); }),
      ]).finally(() => clearTimeout(timeout));
      if (outcome.timedOut) await call({ type: 'PAUSE' });
      const result = outcome.result || await sending;
      const observed = await inspect(page);
      const budget = await worker.evaluate(async tabId => {
        const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => syntheticBudget });
        return frames.find(frame => frame.frameId === 0)?.result;
      }, started.job.tabId);
      console.log('DENSE BUDGET RESULT ' + JSON.stringify({ supported, timedOut: !!outcome.timedOut,
        calls: budget.calls, maxNewlines: budget.maxNewlines, submissions: observed.submits, sentCount: result.job?.sentCount }));
      assert.notEqual(outcome.timedOut, true);
      const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
      if (supported) {
        assert.deepEqual(budget, { calls: 0, maxNewlines: 0 });
        assert.equal(trace.counters.modelWrites, 1);
        assert.equal(trace.counters.textChunks, 0);
      } else {
        assert.ok(budget.maxNewlines > 16);
        assert.ok(budget.calls > 1);
        assert.equal(trace.counters.modelWrites, 0);
        assert.equal(trace.counters.textChunks, budget.calls);
      }
      assert.equal(trace.counters.dispatchAttempts, 1);
      assert.equal(result.job.sentCount, 1, result.job.statusText);
      assert.deepEqual(observed.sentTexts, [largePrompt]);
      assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [1, 0, 1]);
    } finally {
      clearTimeout(timeout);
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  await scenario('Sequential insertion retains a valid collapsed selection between text chunks', async page => {
    const largePrompt = 'SYNTHETIC_COLLAPSED_SELECTION_' + 'g'.repeat(12000);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      globalThis.selectionProbe = [];
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') {
          const selection = getSelection();
          const editor = document.querySelector('[data-composer-markdown]');
          selectionProbe.push({ collapsed: selection?.isCollapsed, inside: editor?.contains(selection?.anchorNode) });
        }
        return original(name, ui, value);
      };
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    const selections = await worker.evaluate(async tabId => {
      const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => selectionProbe });
      return frames.find(frame => frame.frameId === 0)?.result;
    }, started.job.tabId);
    assert.equal(observed.submits, 1);
    assert.deepEqual(observed.sentTexts, [largePrompt]);
    assert.ok(selections.length > 1);
    assert.ok(selections.slice(1).every(selection => selection.collapsed && selection.inside));
  });
  await scenario('Large newline-dense drafts make progress and remain pausable', async page => {
    const largePrompt = Array.from({ length: 8000 }, (_, index) => `DENSE_PROGRESS_${index}`).join('\n');
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      globalThis.progressBudget = { calls: 0, maxMs: 0 };
      document.execCommand = (name, ui, value) => {
        const begin = performance.now();
        const result = original(name, ui, value);
        if (name === 'insertText') {
          progressBudget.calls++;
          progressBudget.maxMs = Math.max(progressBudget.maxMs, performance.now() - begin);
          document.documentElement.dataset.denseProgress = String(progressBudget.calls);
        }
        return result;
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => Number(document.documentElement.dataset.denseProgress) >= 10, null, { timeout: 12000 });
      const observed = await inspect(page);
      assert.equal(observed.submits, 0);
      const current = (await call({ type: 'GET_STATE' })).job;
      assert.equal(current.enabled, true);
    } finally {
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  await scenario('A real-world-shaped mixed Markdown prompt is fully replaced and sent as ordinary text', async page => {
    const sections = Array.from({ length: 9 }, (_, section) => [
      `## ${section + 1}. SYNTHETIC 项目规划与核验`,
      '',
      '先检查公开页面和已授权数据，再区分事实、建议、待确认内容与执行结果。**不得把草案当作完成。**',
      '',
      ...Array.from({ length: 8 }, (_, item) =>
        `- ${section + 1}.${item + 1} 验证页面、版本、输入输出和可复现证据；完整保留原文、标点、链接与状态。`),
      '',
      `Reference: https://example.invalid/synthetic-docs/${section + 1}；未知项需注明。`,
      '',
    ].join('\n'));
    const largePrompt = '# SYNTHETIC Project Execution\n\n' + sections.join('\n') + '\n**END_SYNTHETIC_SAMPLE**';
    const expected = largePrompt;
    const foreground = await newPage('https://pm-foreground.invalid/markdown-sample');
    try {
      await foreground.bringToFront();
      await foreground.locator('#work').focus();
      await page.waitForFunction(() => document.hidden && !document.hasFocus());
      await page.evaluate(() => {
        fixture.pastes = 0;
        pm.dom.addEventListener('paste', () => { fixture.pastes++; }, true);
        pm.dispatch(pm.state.tr.insertText('SYNTHETIC_OLD_DRAFT', 0, pm.state.doc.content.size));
      });
      await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
      const begin = performance.now();
      const result = await call({ type: 'SEND_NOW' });
      const elapsedMs = performance.now() - begin;
      const observed = await inspect(page);
      const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
      console.log('MARKDOWN SAMPLE RESULT ' + JSON.stringify({ characters: largePrompt.length,
        lines: largePrompt.split('\n').length, elapsedMs, submissions: observed.submits,
        pastes: observed.pastes, chunks: trace?.counters?.textChunks, maxWriteMs: trace?.timings?.maxDomWriteMs }));
      assert.equal(result.job.sentCount, 1, result.job.statusText);
      assert.deepEqual(observed.sentTexts, [expected]);
      assert.equal(observed.pastes, 0);
      assert.ok(trace.counters.textChunks > 1);
      assert.ok(trace.timings.maxDomWriteMs < 2000);
      assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [1, 0, 1]);
      assert.equal(await foreground.locator('#work').inputValue(), 'Unrelated synthetic document');
    } finally { await foreground.close(); }
  });
  await scenario('Repeated synchronous slow chunks continue until an explicit Pause', async page => {
    const largePrompt = 'SYNTHETIC_SLOW_CHUNK_' + 'k'.repeat(6000);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      globalThis.syntheticSlow = { calls: 0 };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') {
          syntheticSlow.calls++;
          const begin = performance.now();
          while (performance.now() - begin < 2100) {}
        }
        const accepted = original(name, ui, value);
        if (name === 'insertText') document.documentElement.dataset.slowChunkCount = String(syntheticSlow.calls);
        return accepted;
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => Number(document.documentElement.dataset.slowChunkCount) >= 4, null, { timeout: 18000 });
      const current = (await call({ type: 'GET_STATE' })).job;
      const observed = await inspect(page);
      assert.equal(current.enabled, true);
      assert.equal(current.phase, 'sending');
      assert.equal(current.sentCount, 0);
      assert.equal(observed.submits, 0);
      assert.equal((await call({ type: 'PAUSE' })).job.enabled, false);
      await sending;
      const countAfterPause = Number(await page.evaluate(() => document.documentElement.dataset.slowChunkCount));
      await new Promise(resolve => setTimeout(resolve, 500));
      assert.equal(Number(await page.evaluate(() => document.documentElement.dataset.slowChunkCount)), countAfterPause);
      assert.equal((await inspect(page)).submits, 0);
    } finally {
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  await scenario('A manually paused slow fill resumes with complete replacement after recovery', async page => {
    const largePrompt = 'SYNTHETIC_SLOW_RESUME_' + 'v'.repeat(5000);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      const originalSend = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.syntheticOnce = { calls: 0 };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText' && ++syntheticOnce.calls <= 3) {
          const begin = performance.now();
          while (performance.now() - begin < 2100) {}
        }
        return original(name, ui, value);
      };
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && syntheticOnce.calls === 3 && !syntheticOnce.held) {
          syntheticOnce.held = true;
          document.documentElement.dataset.slowResumeHeld = 'true';
          await new Promise(resolve => { syntheticOnce.release = resolve; });
        }
        return originalSend(message);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => document.documentElement.dataset.slowResumeHeld === 'true', null, { timeout: 16000 });
      const current = (await call({ type: 'GET_STATE' })).job;
      assert.equal(current.enabled, true);
      assert.equal(current.sentCount, 0);
      assert.equal((await inspect(page)).submits, 0);
      assert.equal((await call({ type: 'PAUSE' })).job.enabled, false);
    } finally {
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => syntheticOnce.release?.() }), started.job.tabId);
      await sending;
    }
    assert.equal((await call({ type: 'RESUME' })).ok, true);
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.deepEqual(observed.sentTexts, [largePrompt]);
    assert.equal(observed.submits, 1);
  });
  await scenario('A slow final chunk may submit only after the complete content is confirmed', async page => {
    const largePrompt = 'SYNTHETIC_SLOW_FINAL_' + 'f'.repeat(1500);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      globalThis.finalChunkCount = 0;
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText' && ++finalChunkCount === 2) {
          const begin = performance.now();
          while (performance.now() - begin < 2100) {}
        }
        return original(name, ui, value);
      };
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    const writes = await worker.evaluate(async tabId => {
      const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => finalChunkCount });
      return frames.find(frame => frame.frameId === 0)?.result;
    }, started.job.tabId);
    const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
    assert.equal(writes, 2);
    assert.equal(trace.counters.slowChunks, 1);
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.deepEqual(observed.sentTexts, [largePrompt]);
    assert.equal(observed.submits, 1);
  });
  await scenario('A delayed background permit after the final chunk cannot authorize a stale submission', async page => {
    const largePrompt = 'SYNTHETIC_FINAL_PERMIT_' + 'p'.repeat(4500);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async ({ tabId, expectedLength }) => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: expectedLength => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.permitGate = { held: false };
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 180 && !permitGate.held
            && document.querySelector('[data-composer-markdown]')?.textContent?.length === expectedLength) {
          permitGate.held = true;
          document.documentElement.dataset.finalPermitHeld = 'true';
          await new Promise(resolve => { permitGate.release = resolve; });
        }
        return original(message);
      };
    }, args: [expectedLength] }), { tabId: started.job.tabId, expectedLength: largePrompt.length });
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => document.documentElement.dataset.finalPermitHeld === 'true', null, { timeout: 10000 });
      assert.equal(await page.evaluate(() => pm.state.doc.textContent), largePrompt);
      assert.equal((await call({ type: 'PAUSE' })).job.enabled, false);
    } finally {
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => permitGate.release?.() }), started.job.tabId);
    }
    const result = await sending;
    const observed = await inspect(page);
    assert.equal(result.job.sentCount, 0);
    assert.equal(observed.submits, 0);
    assert.equal((await call({ type: 'GET_STATE' })).job.enabled, false);
  });
  await scenario('Chunk batches remain exact when the editor moves the insertion caret after every input', async page => {
    const largePrompt = 'SYNTHETIC_CARET_HEAD_' + 'r'.repeat(4500) + '_END';
    await page.evaluate(() => {
      fixture.caretMoves = 0;
      pm.dom.addEventListener('input', () => {
        const first = pm.dom.querySelector('p');
        if (!first?.firstChild) return;
        getSelection().collapse(first.firstChild, 0);
        fixture.caretMoves++;
      });
    });
    await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    assert.ok(observed.caretMoves > 1);
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.deepEqual(observed.sentTexts, [largePrompt]);
    assert.equal(observed.submits, 1);
  });
  await scenario('Synthetic isolated-world instrumentation observes repeated prefix traversal and Pause', async page => {
    const largePrompt = Array.from({ length: 1800 }, (_, index) => `TREE_${String(index).padStart(5, '0')} synthetic line`).join('\n');
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      globalThis.serializationProbe = { visits: 0 };
      const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'childNodes');
      Object.defineProperty(Node.prototype, 'childNodes', {
        ...descriptor,
        get() {
          if (this.nodeName === 'P' && document.querySelector('[data-composer-markdown]')?.contains(this)) serializationProbe.visits++;
          return descriptor.get.call(this);
        },
      });
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => pm.state.doc.childCount >= 800, null, { timeout: 25000 });
      await call({ type: 'PAUSE' });
      await sending;
      const paragraphs = await page.evaluate(() => pm.state.doc.childCount);
      const probe = await worker.evaluate(async tabId => {
        const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => serializationProbe });
        return frames.find(frame => frame.frameId === 0)?.result;
      }, started.job.tabId);
      const stats = { paragraphs, visits: probe.visits };
      console.log('SYNTHETIC SERIALIZATION COST ' + JSON.stringify(stats));
      assert.ok(stats.visits > stats.paragraphs, 'The diagnostic must observe repeated prefix traversal');
      assert.equal((await call({ type: 'GET_STATE' })).job.enabled, false);
    } finally {
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  await scenario('Unrelated page content must not stall the chunk fill heartbeat', async page => {
    const largePrompt = Array.from({ length: 1400 }, (_, index) => `SYNTHETIC_LINE_${index} ${'z'.repeat(20)}`).join('\n');
    await page.evaluate(() => {
      window.heartbeat = { maxGap: 0, last: performance.now(), ticks: 0 };
      heartbeat.id = setInterval(() => {
        const now = performance.now();
        heartbeat.maxGap = Math.max(heartbeat.maxGap, now - heartbeat.last);
        heartbeat.last = now;
        heartbeat.ticks++;
      }, 50);
    });
    await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    const heartbeat = await page.evaluate(() => { clearInterval(heartbeat.id); return heartbeat; });
    console.log('SYNTHETIC RESPONSIVENESS ' + JSON.stringify({ ticks: heartbeat.ticks, maxGapMs: heartbeat.maxGap }));
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.deepEqual(observed.sentTexts, [largePrompt]);
    assert.ok(heartbeat.ticks > 0);
    assert.ok(heartbeat.maxGap < 2000);
  });
  await scenario('One slow chunk automatically continues from the confirmed prefix without replaying or submitting early', async page => {
    const largePrompt = 'SYNTHETIC_SLOW_AUTOCONTINUE_' + 'c'.repeat(6000);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      globalThis.slowContinue = { lengths: [] };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') {
          slowContinue.lengths.push(value.length);
          if (slowContinue.lengths.length === 1) {
            const begin = performance.now();
            while (performance.now() - begin < 2100) {}
          }
        }
        return original(name, ui, value);
      };
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    const counts = await worker.evaluate(async tabId => {
      const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => slowContinue });
      return frames.find(frame => frame.frameId === 0)?.result;
    }, started.job.tabId);
    const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
    assert.equal(counts.lengths.reduce((total, length) => total + length, 0), largePrompt.length);
    assert.equal(counts.lengths[0], 1000);
    assert.ok(counts.lengths.slice(1).every(length => length <= 250));
    assert.equal(trace.counters.slowChunks, 1);
    assert.equal(trace.counters.textChunks, counts.lengths.length);
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.deepEqual(observed.sentTexts, [largePrompt]);
    assert.equal(observed.submits, 1);
  });
  await scenario('A delayed rewrite during a slow chunk is adopted before one submission', async page => {
    const largePrompt = 'SYNTHETIC_DELAYED_SLOW_' + 'n'.repeat(4500);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await page.evaluate(() => {
      fixture.delayedRewrite = false;
      pm.dom.addEventListener('input', () => {
        if (fixture.delayedRewrite) return;
        setTimeout(() => {
          pm.dispatch(pm.state.tr.insertText('SYNTHETIC_CHANGED_AFTER_SLOW_WRITE', 0, pm.state.doc.content.size));
          fixture.delayedRewrite = true;
        }, 10);
      }, { once: true });
    });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      globalThis.delayedSlow = { calls: 0 };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText' && ++delayedSlow.calls === 1) {
          const begin = performance.now();
          while (performance.now() - begin < 2100) {}
        }
        return original(name, ui, value);
      };
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    const calls = await worker.evaluate(async tabId => {
      const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => delayedSlow.calls });
      return frames.find(frame => frame.frameId === 0)?.result;
    }, started.job.tabId);
    assert.equal(observed.delayedRewrite, true);
    assert.ok(calls > 1);
    await assertAdoptedPreparedSubmission(page, result, largePrompt,
      'SYNTHETIC_CHANGED_AFTER_SLOW_WRITE' + largePrompt.slice(1000));
  });
  await scenario('A delayed site rewrite after a slow final chunk is adopted with a matching local receipt', async page => {
    const largePrompt = 'SYNTHETIC_DELAYED_FINAL_' + 'q'.repeat(1500);
    await page.evaluate(() => {
      let events = 0;
      pm.dom.addEventListener('input', () => {
        if (++events !== 2) return;
        setTimeout(() => {
          pm.dispatch(pm.state.tr.insertText('SYNTHETIC_DELAYED_FINAL_REWRITE', 0, pm.state.doc.content.size));
          fixture.finalRewrite = true;
        }, 10);
      });
    });
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      let calls = 0;
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText' && ++calls === 2) {
          const begin = performance.now();
          while (performance.now() - begin < 2100) {}
        }
        return original(name, ui, value);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    let timer;
    try {
      const outcome = await Promise.race([
        sending.then(result => ({ result })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 6000); }),
      ]).finally(() => clearTimeout(timer));
      const observed = await inspect(page);
      assert.notEqual(outcome.timedOut, true);
      assert.equal(observed.finalRewrite, true);
      await assertAdoptedPreparedSubmission(page, outcome.result, largePrompt, 'SYNTHETIC_DELAYED_FINAL_REWRITE');
    } finally {
      clearTimeout(timer);
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  await scenario('A disabled editor after a slow final chunk remains undispatched until Pause', async page => {
    const largePrompt = 'SYNTHETIC_FINAL_DISABLED_' + 'u'.repeat(1500);
    await page.evaluate(() => {
      let inputs = 0;
      pm.dom.addEventListener('input', () => {
        if (++inputs === 2) {
          setTimeout(() => {
            pm.dom.contentEditable = 'false';
            fixture.editorDisabledAfterFinal = true;
          }, 10);
        }
      });
    });
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      let calls = 0;
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText' && ++calls === 2) {
          const begin = performance.now();
          while (performance.now() - begin < 2100) {}
        }
        return original(name, ui, value);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => fixture.editorDisabledAfterFinal === true, null, { timeout: 10000 });
      await new Promise(resolve => setTimeout(resolve, 500));
      const observed = await inspect(page);
      assert.equal(observed.editorDisabledAfterFinal, true);
      assert.equal((await call({ type: 'GET_STATE' })).job.enabled, true);
      assert.equal(observed.submits, 0);
      assert.equal((await call({ type: 'PAUSE' })).job.enabled, false);
      assert.equal((await sending).job.sentCount, 0);
    } finally {
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  await scenario('An authorization loss after a slow segment never writes another or sends', async page => {
    const largePrompt = 'SYNTHETIC_SLOW_REVOKE_' + 'j'.repeat(5000);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const originalCommand = document.execCommand.bind(document);
      const originalSend = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.slowRevocation = { writes: 0, revoked: false };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText' && ++slowRevocation.writes === 1) {
          const begin = performance.now();
          while (performance.now() - begin < 2100) {}
        }
        return originalCommand(name, ui, value);
      };
      chrome.runtime.sendMessage = message => {
        if (message.type === 'WAIT_RUN' && slowRevocation.writes === 1 && !slowRevocation.revoked) {
          slowRevocation.revoked = true;
          return Promise.resolve({ ok: true, allowed: false });
        }
        return originalSend(message);
      };
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    const stats = await worker.evaluate(async tabId => {
      const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => slowRevocation });
      return frames.find(frame => frame.frameId === 0)?.result;
    }, started.job.tabId);
    assert.equal(stats.revoked, true);
    assert.equal(stats.writes, 1);
    assert.equal(result.job.sentCount, 0);
    assert.equal(observed.submits, 0);
  });
  await scenario('Slow-chunk fallback eventually recovers even when two successive large writes are slow', async page => {
    const largePrompt = 'SYNTHETIC_REPEAT_SLOW_' + 's'.repeat(5500);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      globalThis.repeatedSlow = { sizes: [] };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') {
          repeatedSlow.sizes.push(value.length);
          if (repeatedSlow.sizes.length <= 2) {
            const begin = performance.now();
            while (performance.now() - begin < 2100) {}
          }
        }
        return original(name, ui, value);
      };
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    const sizes = await worker.evaluate(async tabId => {
      const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => repeatedSlow.sizes });
      return frames.find(frame => frame.frameId === 0)?.result;
    }, started.job.tabId);
    assert.equal(sizes.reduce((sum, size) => sum + size, 0), largePrompt.length);
    assert.equal(sizes[0], 1000);
    assert.equal(sizes[1], 250);
    assert.ok(sizes.slice(2).every(size => size <= 64));
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.deepEqual(observed.sentTexts, [largePrompt]);
    assert.equal(observed.submits, 1);
  });
  await scenario('A sustained slow editor remains authorized beyond one lease and stops only on Pause', async page => {
    const largePrompt = 'SYNTHETIC_SUSTAINED_' + 'h'.repeat(6000);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      const originalSend = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.sustained = { sizes: [] };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') {
          sustained.sizes.push(value.length);
          const begin = performance.now();
          while (performance.now() - begin < 2100) {}
        }
        return original(name, ui, value);
      };
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && sustained.sizes.length === 10 && !sustained.held) {
          sustained.held = true;
          document.documentElement.dataset.sustainedHeld = 'true';
          await new Promise(resolve => { sustained.release = resolve; });
        }
        return originalSend(message);
      };
    } }), started.job.tabId);
    const begin = performance.now();
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => document.documentElement.dataset.sustainedHeld === 'true', null, { timeout: 40000 });
      const current = (await call({ type: 'GET_STATE' })).job;
      assert.ok(performance.now() - begin > 20000);
      assert.equal(current.enabled, true);
      assert.equal(current.phase, 'sending');
      assert.equal(current.sentCount, 0);
      assert.equal((await inspect(page)).submits, 0);
      assert.equal((await call({ type: 'PAUSE' })).job.enabled, false);
    } finally {
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => sustained.release?.() }), started.job.tabId);
      await sending;
    }
    const sizes = await worker.evaluate(async tabId => {
      const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => sustained.sizes });
      return frames.find(frame => frame.frameId === 0)?.result;
    }, started.job.tabId);
    const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
    assert.deepEqual(sizes.slice(0, 4), [1000, 250, 64, 64]);
    assert.equal(sizes.length, 10);
    assert.equal((await inspect(page)).submits, 0);
    assert.equal((await call({ type: 'GET_STATE' })).job.enabled, false);
    assert.equal(trace.counters.slowChunks, 10);
    assert.equal(trace.counters.pageAdmissions, 1);
  });
  await scenario('Chunk splitting prefers paragraph boundaries under the one-thousand-unit limit', async page => {
    const largePrompt = 'HEADING\n\n' + 'A'.repeat(650) + '\n\n' + 'B'.repeat(650) + '\n\n' + 'C'.repeat(650) + '\nEND';
    const expected = largePrompt;
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      globalThis.paragraphChunkProbe = [];
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') paragraphChunkProbe.push({ length: value.length, boundary: value.endsWith('\n\n') });
        return original(name, ui, value);
      };
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    const chunks = await worker.evaluate(async tabId => {
      const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => paragraphChunkProbe });
      return frames.find(frame => frame.frameId === 0)?.result;
    }, started.job.tabId);
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.deepEqual(observed.sentTexts, [expected]);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every(chunk => chunk.length <= 1000));
    assert.ok(chunks[0].length > 500);
    assert.ok(chunks.slice(0, -1).every(chunk => chunk.boundary));
  });
  await scenario('Sustained slow but accepted chunks continue without a fixed time or retry limit', async page => {
    const largePrompt = 'SYNTHETIC_NO_TIME_LIMIT_' + 'z'.repeat(5500);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      globalThis.longRunningProbe = { chunks: 0 };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') {
          longRunningProbe.chunks++;
          if (longRunningProbe.chunks <= 4) {
            const begin = performance.now();
            while (performance.now() - begin < 2100) {}
          }
        }
        return original(name, ui, value);
      };
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.deepEqual(observed.sentTexts, [largePrompt]);
    assert.equal(observed.submits, 1);
    assert.equal(trace.counters.slowChunks, 4);
  });
  await scenario('A verified slow complete draft adopts a page rewrite before one submission', async page => {
    const largePrompt = 'SYNTHETIC_REASSERT_SLOW_' + 'r'.repeat(3500);
    await page.evaluate(expectedLength => {
      fixture.slowRewrite = false;
      pm.dom.addEventListener('input', () => {
        setTimeout(() => {
          if (!fixture.slowRewrite && pm.state.doc.textContent.length === expectedLength) {
            fixture.slowRewrite = true;
            pm.dispatch(pm.state.tr.insertText('SYNTHETIC_PAGE_RESET', 0, pm.state.doc.content.size));
          }
        }, 10);
      });
    }, largePrompt.length);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      let calls = 0;
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText' && ++calls === 1) {
          const begin = performance.now();
          while (performance.now() - begin < 2100) {}
        }
        return original(name, ui, value);
      };
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    assert.equal(observed.slowRewrite, true);
    await assertAdoptedPreparedSubmission(page, result, largePrompt, 'SYNTHETIC_PAGE_RESET');
  });
  await scenario('One synchronous chunk exceeding a lease reacquires authorization before later chunks', async page => {
    const largePrompt = 'SYNTHETIC_LONG_SINGLE_WRITE_' + 'd'.repeat(5500);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      globalThis.longSingleWrite = { chunks: 0 };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText' && ++longSingleWrite.chunks === 1) {
          const begin = performance.now();
          while (performance.now() - begin < 21000) {}
        }
        return original(name, ui, value);
      };
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
    assert.equal(result.job.enabled, true);
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.equal(result.job.unknownCount, 0);
    assert.deepEqual(observed.sentTexts, [largePrompt]);
    assert.equal(observed.submits, 1);
    assert.ok(trace.timings.maxDomWriteMs >= 21000);
    assert.equal(trace.counters.slowChunks, 1);
  });
  await scenario('Paragraph chunks preserve surrogate pairs at the one-thousand-unit boundary', async page => {
    const largePrompt = 'A'.repeat(999) + '😀' + 'B'.repeat(1000) + '\n\nEND';
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      globalThis.boundaryProbe = [];
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') boundaryProbe.push({ length: value.length, wellFormed: value.isWellFormed() });
        return original(name, ui, value);
      };
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    const chunks = await worker.evaluate(async tabId => {
      const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => boundaryProbe });
      return frames.find(frame => frame.frameId === 0)?.result;
    }, started.job.tabId);
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.deepEqual(observed.sentTexts, [largePrompt]);
    assert.equal(chunks[0].length, 999);
    assert.ok(chunks.every(chunk => chunk.length > 0 && chunk.length <= 1000 && chunk.wellFormed));
  });
  await scenario('Consecutive blank lines and normalized CRLF or CR preserve their logical order', async page => {
    const largePrompt = 'SYNTHETIC_HEAD\r\n' + '\n'.repeat(35) + '中段\r' + 'x'.repeat(3000) + '\r\n\r\nEND';
    const expected = largePrompt.replace(/\r\n?/g, '\n');
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      globalThis.lineBoundaryProbe = [];
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') lineBoundaryProbe.push(value.length);
        return original(name, ui, value);
      };
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    const sizes = await worker.evaluate(async tabId => {
      const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => lineBoundaryProbe });
      return frames.find(frame => frame.frameId === 0)?.result;
    }, started.job.tabId);
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.deepEqual(observed.sentTexts, [expected]);
    assert.ok(sizes.length > 1);
    assert.ok(sizes.every(size => size > 0 && size <= 1000));
    assert.equal(sizes.reduce((sum, size) => sum + size, 0), expected.length);
  });
  await scenario('A transient page rewrite between chunks is adopted with the remaining prompt suffix', async page => {
    const largePrompt = 'SYNTHETIC_REWRITE_HEAD_' + 'a'.repeat(8000) + '_TAIL';
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.rewriteGate = { held: false };
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && !rewriteGate.held
            && document.querySelector('[data-composer-markdown]')?.textContent?.startsWith('SYNTHETIC_REWRITE_HEAD_')) {
          rewriteGate.held = true;
          document.documentElement.dataset.rewriteHeld = 'true';
          await new Promise(resolve => { rewriteGate.release = resolve; });
        }
        return send(message);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    let timer;
    try {
      await page.waitForFunction(() => document.documentElement.dataset.rewriteHeld === 'true', null, { timeout: 8000 });
      await page.evaluate(() => pm.dispatch(pm.state.tr.insertText('SYNTHETIC_INTERRUPTING_PAGE_TEXT', 0, pm.state.doc.content.size)));
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => rewriteGate.release() }), started.job.tabId);
      const outcome = await Promise.race([sending.then(result => ({ result })), new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 15000); })]);
      assert.notEqual(outcome.timedOut, true);
      const trace = await assertAdoptedPreparedSubmission(page, outcome.result, largePrompt,
        'SYNTHETIC_INTERRUPTING_PAGE_TEXT' + largePrompt.slice(1000));
      assert.equal(trace.counters.chunkRestarts, 0);
      assert.equal(JSON.stringify(trace).includes('SYNTHETIC_REWRITE_HEAD_'), false);
    } finally {
      clearTimeout(timer);
      await call({ type: 'PAUSE' });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => rewriteGate.release?.() }), started.job.tabId);
      await sending;
    }
  });
  await scenario('Newline-dense appends are not rejected solely because a chunk contains more than sixteen line breaks', async page => {
    const largePrompt = 'SYNTHETIC_DENSE_HEAD\n' + Array.from({ length: 80 }, (_, index) => `段落_${index} ${'a'.repeat(35)}`).join('\n') + '\nSYNTHETIC_DENSE_END';
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      globalThis.lineCounts = [];
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') lineCounts.push((value.match(/\n/g) || []).length);
        return original(name, ui, value);
      };
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    const counts = await worker.evaluate(async tabId => {
      const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => lineCounts });
      return frames.find(frame => frame.frameId === 0)?.result;
    }, started.job.tabId);
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.deepEqual(observed.sentTexts, [largePrompt]);
    assert.ok(counts.some(count => count > 16));
  });
  await scenario('Persistent empty page clears keep retrying without a fixed attempt limit until Pause', async page => {
    const largePrompt = 'SYNTHETIC_REPEAT_REWRITE_' + 'r'.repeat(7000);
    await page.evaluate(() => {
      fixture.rewrites = 0;
      pm.dom.addEventListener('input', () => {
        fixture.rewrites++;
        pm.dispatch(pm.state.tr.delete(0, pm.state.doc.content.size));
      }, true);
    });
    await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => fixture.rewrites >= 3, null, { timeout: 12000 });
      const current = (await call({ type: 'GET_STATE' })).job;
      assert.equal(current.enabled, true);
      assert.equal(current.phase, 'sending');
      assert.equal(current.sentCount, 0);
      assert.equal((await inspect(page)).submits, 0);
      assert.equal((await call({ type: 'PAUSE' })).job.enabled, false);
      await sending;
      const before = (await inspect(page)).rewrites;
      await new Promise(resolve => setTimeout(resolve, 400));
      const after = await inspect(page);
      assert.equal(after.rewrites, before);
      assert.equal(after.submits, 0);
    } finally {
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  await scenario('A single rejected chunk is retried from a complete replacement and eventually sent', async page => {
    const largePrompt = 'SYNTHETIC_REJECT_ONCE_' + 'v'.repeat(7000);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      globalThis.rejectedOnce = { calls: 0 };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText' && ++rejectedOnce.calls === 2) return false;
        return original(name, ui, value);
      };
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.deepEqual(observed.sentTexts, [largePrompt]);
    assert.equal(trace.counters.chunkRestarts, 1);
  });
  await scenario('A page without supported rich-editor serialization does not prevent repeated delivery attempts', async page => {
    const largePrompt = 'SYNTHETIC_UNSERIALIZABLE_' + 'u'.repeat(7000);
    await page.evaluate(() => {
      fixture.customWrappers = 0;
      pm.dom.addEventListener('input', () => {
        const wrapper = document.createElement('section');
        wrapper.append(...pm.dom.childNodes);
        pm.dom.append(wrapper);
        fixture.customWrappers++;
      }, { once: true, capture: true });
    });
    await start(page, { prompt: largePrompt, sendMethod: 'auto', intervalMinutes: 30 });
    const sending = call({ type: 'SEND_NOW' });
    let timer;
    try {
      const outcome = await Promise.race([sending.then(result => ({ result })), new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 12000); })]);
      if (outcome.timedOut) await call({ type: 'PAUSE' });
      const result = outcome.result || await sending;
      assert.notEqual(outcome.timedOut, true);
      assert.equal(result.job.sentCount, 1, result.job.statusText);
      assert.deepEqual((await inspect(page)).sentTexts, [largePrompt]);
      assert.equal((await inspect(page)).customWrappers, 1);
    } finally {
      clearTimeout(timer);
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  await scenario('A persistent page normalization is adopted with a matching local receipt', async page => {
    const largePrompt = 'SYNTHETIC_NORMALIZED_' + 'n'.repeat(7000);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      document.execCommand = (name, ui, value) => original(name, ui,
        name === 'insertText' && typeof value === 'string' ? value.toUpperCase() : value);
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    let timer;
    try {
      const outcome = await Promise.race([sending.then(result => ({ result })), new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 12000); })]);
      if (outcome.timedOut) await call({ type: 'PAUSE' });
      const result = outcome.result || await sending;
      assert.notEqual(outcome.timedOut, true);
      const trace = await assertAdoptedPreparedSubmission(page, result, largePrompt, largePrompt.toUpperCase());
      assert.ok(trace.counters.chunkDifferences > 0);
      assert.equal(trace.counters.chunkRestarts, 0);
    } finally {
      clearTimeout(timer);
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  await scenario('Paragraph-boundary appends preserve the source without adding blank lines', async page => {
    const largePrompt = 'SYNTHETIC_SECTION_A_' + 'a'.repeat(1900) + '\n\n' + 'SYNTHETIC_SECTION_B_' + 'b'.repeat(1900) + '\n\n' + 'SYNTHETIC_SECTION_C_' + 'c'.repeat(1900);
    const expected = largePrompt;
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.deepEqual(observed.sentTexts, [expected]);
    assert.equal(result.job.prompt, largePrompt);
    assert.equal(result.job.unknownCount, 0);
    assert.equal(started.job.prompt, largePrompt);
    const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
    assert.equal(trace.counters.insertedBlankSeparators, 0);
  });
  await scenario('A prepared editor adopts a later nonempty rewrite without changing its saved prompt', async page => {
    const largePrompt = 'SYNTHETIC_CHANGED_TARGET_' + 'c'.repeat(7000);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const originalCommand = document.execCommand.bind(document);
      const originalSend = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.changedDraftGate = { held: false };
      document.execCommand = (name, ui, value) => originalCommand(name, ui,
        name === 'insertText' && typeof value === 'string' ? value.toUpperCase() : value);
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 180 && !changedDraftGate.held
            && document.querySelector('[data-composer-markdown]')?.textContent?.length >= 7000) {
          changedDraftGate.held = true;
          document.documentElement.dataset.changedDraftHeld = 'true';
          await new Promise(resolve => { changedDraftGate.release = resolve; });
        }
        return originalSend(message);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    let timer;
    try {
      await page.waitForFunction(() => document.documentElement.dataset.changedDraftHeld === 'true', null, { timeout: 8000 });
      await page.evaluate(() => pm.dispatch(pm.state.tr.insertText('SYNTHETIC_UNRELATED_REPLACEMENT', 0, pm.state.doc.content.size)));
      assert.equal(await page.evaluate(() => pm.state.doc.textContent), 'SYNTHETIC_UNRELATED_REPLACEMENT');
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => changedDraftGate.release() }), started.job.tabId);
      const outcome = await Promise.race([sending.then(result => ({ result })), new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 12000); })]);
      if (outcome.timedOut) await call({ type: 'PAUSE' });
      const result = outcome.result || await sending;
      assert.notEqual(outcome.timedOut, true);
      const trace = await assertAdoptedPreparedSubmission(page, result, largePrompt, 'SYNTHETIC_UNRELATED_REPLACEMENT');
      assert.ok(trace.counters.chunkDifferences > 0);
      assert.equal(trace.counters.chunkRestarts, 0);
    } finally {
      clearTimeout(timer);
      await call({ type: 'PAUSE' });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => changedDraftGate.release?.() }), started.job.tabId);
      await sending;
    }
  });
  await scenario('A total suppression of accepted input never dispatches an empty or unrelated draft', async page => {
    const largePrompt = 'SYNTHETIC_SUPPRESSED_' + 's'.repeat(7000);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      let writes = 0;
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') {
          document.documentElement.dataset.suppressedWrites = String(++writes);
          return original(name, ui, '');
        }
        return original(name, ui, value);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => Number(document.documentElement.dataset.suppressedWrites) >= 4, null, { timeout: 12000 });
      assert.equal((await call({ type: 'GET_STATE' })).job.enabled, true);
      assert.equal((await inspect(page)).submits, 0);
      assert.equal((await call({ type: 'PAUSE' })).job.enabled, false);
      assert.equal((await sending).job.sentCount, 0);
    } finally {
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  await scenario('A real popup delayed save cannot restore a prompt after another popup clears data', async page => {
    await call({ type: 'PAUSE' });
    await control.bringToFront();
    await control.reload();
    await control.waitForFunction(() => !document.querySelector('#start').disabled);
    await control.locator('#tab-prompt').click();
    await control.locator('#togglePrompt').click();
    await control.locator('#prompt').fill('MV3_SYNTHETIC_SAVED_BEFORE_CLEAR');
    await control.waitForFunction(async () => (await chrome.storage.local.get('config')).config?.prompt === 'MV3_SYNTHETIC_SAVED_BEFORE_CLEAR');
    await control.evaluate(() => {
      const actual = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = message => message.type === 'SAVE_DRAFT'
        ? new Promise((resolve, reject) => { globalThis.releaseClearRaceSave = () => actual(message).then(response => {
          resolve(response); return response;
        }, reject); })
        : actual(message);
    });
    await control.locator('#prompt').fill('MV3_SYNTHETIC_PRE_CLEAR_PRIVATE');
    await control.waitForFunction(() => typeof globalThis.releaseClearRaceSave === 'function', null, { timeout: 8000 });
    const second = await newPage(`chrome-extension://${new URL(worker.url()).host}/popup.html?view=full`);
    try {
      const cleared = await second.evaluate(() => chrome.runtime.sendMessage({ type: 'CLEAR_DATA' }));
      assert.equal(cleared.ok, true);
      await control.waitForFunction(() => document.querySelector('#check').disabled, null, { timeout: 8000 });
      const staleSave = await control.evaluate(() => globalThis.releaseClearRaceSave());
      assert.equal(staleSave.ok, false, 'Clear must reject the actual delayed save');
      assert.equal(staleSave.conflict, true, 'The old generation cannot restore the cleared prompt');
      const data = await worker.evaluate(() => chrome.storage.local.get(['config', 'resumeJob']));
      assert.notEqual(data.config?.prompt, 'MV3_SYNTHETIC_PRE_CLEAR_PRIVATE');
      assert.equal(data.resumeJob, undefined);
      assert.equal(await control.locator('#check').isDisabled(), true);
      const state = await call({ type: 'GET_STATE' });
      assert.equal(state.config?.prompt, '');
      assert.equal(state.job, null);
      await control.reload();
      await control.bringToFront();
      await control.waitForFunction(() => !document.querySelector('#check').disabled);
      await control.locator('#tab-prompt').click();
      await control.locator('#togglePrompt').click();
      await control.locator('#prompt').fill('MV3_SYNTHETIC_AFTER_CLEAR');
      await control.waitForFunction(async () => (await chrome.storage.local.get('config')).config?.prompt === 'MV3_SYNTHETIC_AFTER_CLEAR');
      assert.equal((await inspect(page)).submits, 0);
    } finally {
      await second.close();
      await control.reload();
    }
  });
  await scenario('A real popup template save issued before Clear cannot restore deleted private text', async page => {
    await call({ type: 'PAUSE' });
    await control.bringToFront();
    await control.reload();
    await control.waitForFunction(() => !document.querySelector('#start').disabled);
    await control.locator('#tab-prompt').click();
    await control.locator('#togglePrompt').click();
    await control.locator('#prompt').fill('MV3_SYNTHETIC_TEMPLATE_PRIVATE');
    await control.waitForFunction(async () => (await chrome.storage.local.get('config')).config?.prompt === 'MV3_SYNTHETIC_TEMPLATE_PRIVATE');
    await control.locator('#templateName').fill('MV3_SYNTHETIC_TEMPLATE_NAME');
    await control.evaluate(() => {
      const actual = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = message => message.type === 'SAVE_TEMPLATES'
        ? new Promise((resolve, reject) => { globalThis.releaseTemplateSave = () => actual(message).then(resolve, reject); })
        : actual(message);
    });
    await control.locator('#saveTemplate').click();
    await control.waitForFunction(() => typeof globalThis.releaseTemplateSave === 'function');
    const second = await newPage(`chrome-extension://${new URL(worker.url()).host}/popup.html?view=full`);
    try {
      const cleared = await second.evaluate(() => chrome.runtime.sendMessage({ type: 'CLEAR_DATA' }));
      assert.equal(cleared.ok, true);
      await control.evaluate(() => globalThis.releaseTemplateSave());
      const data = await worker.evaluate(() => chrome.storage.local.get(['templates', 'config']));
      assert.equal(data.templates, undefined, 'A template save issued before Clear must not restore deleted text');
      assert.equal(data.config, undefined);
      assert.equal((await inspect(page)).submits, 0);
    } finally {
      await second.close();
      await control.reload();
    }
  });
  await scenario('A persisted Clear fence survives an actual MV3 service-worker restart', async page => {
    await call({ type: 'PAUSE' });
    await control.bringToFront();
    await control.reload();
    await control.waitForFunction(() => !document.querySelector('#start').disabled);
    await control.locator('#tab-prompt').click();
    await control.locator('#togglePrompt').click();
    await control.locator('#prompt').fill('MV3_SYNTHETIC_CLEAR_RESTART_PRIVATE');
    await control.waitForFunction(async () => (await chrome.storage.local.get('config')).config?.prompt === 'MV3_SYNTHETIC_CLEAR_RESTART_PRIVATE');
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ draftClearPending: true });
      globalThis.testClearMarker = true;
    });
    const session = await context.newCDPSession(control);
    try {
      const versions = new Map();
      const restartEvents = [];
      session.on('ServiceWorker.workerVersionUpdated', event => {
        for (const version of event.versions) {
          versions.set(version.versionId, version);
          restartEvents.push({ id: version.versionId, status: version.runningStatus });
        }
      });
      await session.send('ServiceWorker.enable');
      const started = Date.now();
      while (![...versions.values()].some(version => version.scriptURL === worker.url() && version.runningStatus === 'running')
          && Date.now() - started < 5000) await new Promise(resolve => setTimeout(resolve, 50));
      const running = [...versions.values()].find(version => version.scriptURL === worker.url() && version.runningStatus === 'running');
      assert.ok(running);
      const stopEventStart = restartEvents.length;
      await session.send('ServiceWorker.stopWorker', { versionId: running.versionId });
      const stoppedAt = Date.now();
      const stopped = () => restartEvents.slice(stopEventStart).some(item => item.id === running.versionId && item.status === 'stopped');
      while (!stopped() && Date.now() - stoppedAt < 5000)
        await new Promise(resolve => setTimeout(resolve, 50));
      console.log('CLEAR RESTART EVENTS ' + JSON.stringify(restartEvents));
      assert.equal(stopped(), true, 'The actual worker must stop, even if a subsequent message already restarted it');
      const state = await call({ type: 'GET_STATE' });
      worker = context.serviceWorkers().find(item => item.url().endsWith('/background.js'))
        || await context.waitForEvent('serviceworker', { predicate: item => item.url().endsWith('/background.js'), timeout: 15000 });
      assert.equal(await worker.evaluate(() => globalThis.testClearMarker), undefined, 'The original worker memory must not survive');
      assert.equal(state.configAvailable, false);
      assert.equal((await call({ type: 'PREPARE_START' })).ok, false);
      assert.equal((await call({ type: 'PAUSE' })).ok, true);
      assert.equal((await call({ type: 'CLEAR_DATA' })).ok, true);
      const fresh = await call({ type: 'GET_STATE' });
      assert.equal(fresh.configAvailable, true);
      assert.equal(fresh.config.prompt, '');
      assert.equal((await worker.evaluate(() => chrome.storage.local.get('draftClearPending'))).draftClearPending, undefined);
      assert.equal((await inspect(page)).submits, 0);
    } finally {
      await session.detach();
      await control.reload();
    }
  });
  await scenario('A rejected silent chunk adapts to the accepted size instead of restarting forever', async page => {
    const largePrompt = 'SYNTHETIC_SILENT_HEAD_' + 's'.repeat(7500) + '_TAIL';
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      globalThis.silentChunk = { calls: 0, rejected: 0, maxAccepted: 0 };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') {
          silentChunk.calls++;
          if (value.length > 250) { silentChunk.rejected++; return false; }
          silentChunk.maxAccepted = Math.max(silentChunk.maxAccepted, value.length);
        }
        return original(name, ui, value);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    let timer;
    try {
      const outcome = await Promise.race([sending.then(result => ({ result })), new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 12000); })]);
      const observed = await inspect(page);
      assert.notEqual(outcome.timedOut, true, 'A rejected size should not cause an endless full restart');
      assert.equal(observed.submits, 1);
      assert.equal(observed.sentTexts[0], largePrompt);
      assert.equal(outcome.result.job.sentCount, 1);
      const counts = await worker.evaluate(async tabId => {
        const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => silentChunk });
        return frames.find(frame => frame.frameId === 0)?.result;
      }, started.job.tabId);
      assert.ok(counts.rejected > 0);
      assert.ok(counts.maxAccepted <= 250);
      const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
      assert.ok(trace.counters.rejectedChunks >= 2, 'The exported diagnostic must distinguish rejected chunks from other restarts');
      assert.equal(JSON.stringify(trace).includes(largePrompt), false);
      const exported = await control.evaluate(async () => {
        const { buildActivityExport } = await import('./activity-export.js');
        const stored = await chrome.storage.local.get(['logs', 'deliveryDiagnostics', 'diagnosticsHealth']);
        return buildActivityExport({ logs: stored.logs, deliveries: stored.deliveryDiagnostics, diagnosticsHealth: stored.diagnosticsHealth });
      });
      assert.equal(exported.deliveries.at(-1).counters.rejectedChunks, trace.counters.rejectedChunks);
      assert.equal(JSON.stringify(exported).includes(largePrompt), false);
    } finally {
      clearTimeout(timer);
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  await scenario('A rejected chunk at a surrogate boundary never attempts an empty write', async page => {
    const largePrompt = '🙂'.repeat(1800) + '_SYNTHETIC_UNICODE_END';
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      globalThis.unicodeProbe = { rejected: 0, attempted: [], empty: 0 };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') {
          if (!value) unicodeProbe.empty++;
          unicodeProbe.attempted.push({ length: value.length, valid: value.isWellFormed() });
          if (unicodeProbe.rejected >= 14) document.documentElement.dataset.unicodeProbeComplete = 'true';
          if (value.length > 1) { unicodeProbe.rejected++; return false; }
          if (value.length === 1) return false;
        }
        return original(name, ui, value);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => document.documentElement.dataset.unicodeProbeComplete === 'true', null, { timeout: 12000 });
      const probe = await worker.evaluate(async tabId => {
        const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => unicodeProbe });
        return frames.find(frame => frame.frameId === 0)?.result;
      }, started.job.tabId);
      assert.ok(probe.rejected >= 14);
      assert.equal(probe.empty, 0);
      assert.ok(probe.attempted.every(item => item.length > 0 && item.valid));
      assert.equal((await inspect(page)).submits, 0);
    } finally {
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  await scenario('A slow prefix serialization is visible in content-free delivery diagnostics', async page => {
    const largePrompt = 'SYNTHETIC_SERIALIZE_COST_' + 'x'.repeat(8000) + '_END';
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const exec = document.execCommand.bind(document);
      const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'childNodes');
      globalThis.serializationCost = { writes: 0, delayed: false };
      document.execCommand = (name, ui, value) => {
        const result = exec(name, ui, value);
        if (name === 'insertText') serializationCost.writes++;
        return result;
      };
      Object.defineProperty(Node.prototype, 'childNodes', {
        ...descriptor,
        get() {
          if (!serializationCost.delayed && serializationCost.writes === 1
              && this === document.querySelector('[data-composer-markdown]')) {
            serializationCost.delayed = true;
            const begin = performance.now();
            while (performance.now() - begin < 300) {}
          }
          return descriptor.get.call(this);
        },
      });
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.deepEqual(observed.sentTexts, [largePrompt]);
    assert.ok(trace.timings.serializationMs >= 300, 'Serialization cost must not disappear into unclassified elapsed time');
    assert.ok(trace.timings.maxSerializationMs >= 300);
    assert.equal(JSON.stringify(trace).includes(largePrompt), false);
    const exported = await control.evaluate(async () => {
      const { buildActivityExport } = await import('./activity-export.js');
      const stored = await chrome.storage.local.get(['logs', 'deliveryDiagnostics', 'diagnosticsHealth']);
      return buildActivityExport({ logs: stored.logs, deliveries: stored.deliveryDiagnostics, diagnosticsHealth: stored.diagnosticsHealth });
    });
    assert.equal(exported.deliveries.at(-1).timings.serializationMs, trace.timings.serializationMs);
    assert.equal(exported.deliveries.at(-1).timings.maxSerializationMs, trace.timings.maxSerializationMs);
    assert.equal(JSON.stringify(exported).includes(largePrompt), false);
  });
  await scenario('Large multiline insertion measures repeated prefix verification', async page => {
    const largePrompt = Array.from({ length: 1800 }, (_, index) => `SYNTHETIC_COST_${String(index).padStart(5, '0')} ${'x'.repeat(20)}`).join('\n');
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      globalThis.prefixVisits = 0;
      const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'childNodes');
      Object.defineProperty(Node.prototype, 'childNodes', {
        ...descriptor,
        get() {
          if (this.nodeName === 'P' && document.querySelector('[data-composer-markdown]')?.contains(this)) prefixVisits++;
          return descriptor.get.call(this);
        },
      });
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    const visits = await worker.evaluate(async tabId => {
      const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => prefixVisits });
      return frames.find(frame => frame.frameId === 0)?.result;
    }, started.job.tabId);
    const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.deepEqual(observed.sentTexts, [largePrompt]);
    console.log('SYNTHETIC PREFIX WORK ' + JSON.stringify({ visits, chunks: trace.counters.textChunks,
      serializationMs: trace.timings.serializationMs, domWriteMs: trace.timings.domWriteMs }));
    assert.ok(visits > 1800, 'The diagnostic must observe the existing repeated prefix traversal');
    assert.ok(trace.counters.textChunks > 10);
    assert.equal(trace.counters.dispatchAttempts, 1);
  });
  await scenario('A rewrite between chunks is adopted before the next input without another full selection', async page => {
    const largePrompt = 'SYNTHETIC_REWRITE_ORDER_' + 'a'.repeat(9000);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      const exec = document.execCommand.bind(document);
      globalThis.rewriteOrder = { writes: 0, held: false };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') rewriteOrder.writes++;
        return exec(name, ui, value);
      };
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && rewriteOrder.writes === 1 && !rewriteOrder.held) {
          rewriteOrder.held = true;
          document.documentElement.dataset.rewriteOrderHeld = 'true';
          await new Promise(resolve => { rewriteOrder.release = resolve; });
        }
        return send(message);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => document.documentElement.dataset.rewriteOrderHeld === 'true', null, { timeout: 8000 });
      await page.evaluate(() => pm.dispatch(pm.state.tr.insertText('SYNTHETIC_REPLACED_BETWEEN_CHUNKS', 0, pm.state.doc.content.size)));
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
        const exec = document.execCommand.bind(document);
        document.execCommand = (name, ui, value) => {
          if (name === 'insertText' && rewriteOrder.writes === 1) {
            const editor = document.querySelector('[data-composer-markdown]');
            const range = getSelection().getRangeAt(0), expected = document.createRange();
            expected.selectNodeContents(editor);
            rewriteOrder.nextWasFullSelection = getSelection().toString() === 'SYNTHETIC_REPLACED_BETWEEN_CHUNKS'
              || (range.compareBoundaryPoints(Range.START_TO_START, expected) === 0
                && range.compareBoundaryPoints(Range.END_TO_END, expected) === 0);
          }
          return exec(name, ui, value);
        };
        rewriteOrder.release();
      } }), started.job.tabId);
      const result = await sending;
      const order = await worker.evaluate(async tabId => {
        const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => rewriteOrder });
        return frames.find(frame => frame.frameId === 0)?.result;
      }, started.job.tabId);
      assert.equal(order.nextWasFullSelection, false, 'An adopted prefix must not trigger another complete replacement');
      await assertAdoptedPreparedSubmission(page, result, largePrompt,
        'SYNTHETIC_REPLACED_BETWEEN_CHUNKS' + largePrompt.slice(1000));
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => rewriteOrder.release?.() }), started.job.tabId);
      await sending;
    }
  });
  await scenario('A retained text node rewritten between chunks is adopted before the next input', async page => {
    const largePrompt = 'SYNTHETIC_RETAINED_NODE_' + 'b'.repeat(9000);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime), exec = document.execCommand.bind(document);
      globalThis.retainedGate = { writes: 0, held: false };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') retainedGate.writes++;
        return exec(name, ui, value);
      };
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && retainedGate.writes === 1 && !retainedGate.held) {
          retainedGate.held = true;
          document.documentElement.dataset.retainedGateHeld = 'true';
          await new Promise(resolve => { retainedGate.release = resolve; });
        }
        return send(message);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => document.documentElement.dataset.retainedGateHeld === 'true', null, { timeout: 8000 });
      await page.evaluate(() => {
        const text = pm.dom.querySelector('p')?.firstChild;
        text.data = 'SYNTHETIC_RETAINED_NODE_CHANGED';
      });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
        const exec = document.execCommand.bind(document);
        document.execCommand = (name, ui, value) => {
          if (name === 'insertText' && retainedGate.writes === 1) {
            const editor = document.querySelector('[data-composer-markdown]');
            const range = getSelection().getRangeAt(0), expected = document.createRange();
            expected.selectNodeContents(editor);
            retainedGate.nextWasFullSelection = getSelection().toString() === 'SYNTHETIC_RETAINED_NODE_CHANGED'
              || (range.compareBoundaryPoints(Range.START_TO_START, expected) === 0
                && range.compareBoundaryPoints(Range.END_TO_END, expected) === 0);
          }
          return exec(name, ui, value);
        };
        retainedGate.release();
      } }), started.job.tabId);
      const result = await sending;
      const gate = await worker.evaluate(async tabId => {
        const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => retainedGate });
        return frames.find(frame => frame.frameId === 0)?.result;
      }, started.job.tabId);
      assert.equal(gate.nextWasFullSelection, false);
      await assertAdoptedPreparedSubmission(page, result, largePrompt,
        'SYNTHETIC_RETAINED_NODE_CHANGED' + largePrompt.slice(1000));
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => retainedGate.release?.() }), started.job.tabId);
      await sending;
    }
  });
  await scenario('A page rewrite while the next chunk is constructed is adopted for one submission', async page => {
    const largePrompt = 'SYNTHETIC_PREWRITE_MUTATION_' + 'c'.repeat(9000);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const exec = document.execCommand.bind(document);
      globalThis.prewrite = { writes: 0, fired: false };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') {
          prewrite.writes++;
          if (prewrite.writes === 2 || prewrite.writes === 4) {
            const text = document.querySelector('[data-composer-markdown] p')?.firstChild;
            text.data = 'SYNTHETIC_PREWRITE_EXTERNAL';
            prewrite.fired = true;
          }
        }
        return exec(name, ui, value);
      };
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const trace = await assertAdoptedPreparedSubmission(page, result, largePrompt,
      'c'.repeat(1000) + 'SYNTHETIC_PREWRITE_EXTERNAL' + largePrompt.slice(4000));
    const probe = await worker.evaluate(async tabId => {
      const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => prewrite });
      return frames.find(frame => frame.frameId === 0)?.result;
    }, started.job.tabId);
    assert.equal(probe.fired, true);
    assert.equal(probe.writes, Math.ceil(largePrompt.length / 1000));
    assert.equal(trace.counters.prefixRewriteRestarts, 2, 'The legacy-named counter records both detected prefix changes');
    assert.equal(trace.counters.chunkRestarts, 0);
    const exported = await control.evaluate(async () => {
      const { buildActivityExport } = await import('./activity-export.js');
      const stored = await chrome.storage.local.get(['logs', 'deliveryDiagnostics', 'diagnosticsHealth']);
      return buildActivityExport({ logs: stored.logs, deliveries: stored.deliveryDiagnostics, diagnosticsHealth: stored.diagnosticsHealth });
    });
    assert.equal(exported.deliveries.at(-1).counters.prefixRewriteRestarts, 2);
    assert.equal(JSON.stringify(exported).includes(largePrompt), false);
    assert.equal(JSON.stringify(exported).includes('SYNTHETIC_PREWRITE_EXTERNAL'), false);
  });
  await scenario('A prefix rewrite is adopted without entering a repeated full-refill cycle', async page => {
    const largePrompt = 'SYNTHETIC_PERSISTENT_PREFIX_' + 'd'.repeat(9000);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const exec = document.execCommand.bind(document);
      globalThis.persistentPrefix = { sinceReplace: 0, rewrites: 0 };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') {
          const selected = getSelection();
          if (selected && !selected.isCollapsed) persistentPrefix.sinceReplace = 0;
          else if (persistentPrefix.sinceReplace === 1) {
            const text = document.querySelector('[data-composer-markdown] p')?.firstChild;
            text.data = 'SYNTHETIC_PERSISTENT_PREFIX_EXTERNAL';
            persistentPrefix.rewrites++;
            document.documentElement.dataset.prefixRewrites = String(persistentPrefix.rewrites);
          }
          persistentPrefix.sinceReplace++;
        }
        return exec(name, ui, value);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    try {
      const result = await sending;
      assert.equal(Number(await page.evaluate(() => document.documentElement.dataset.prefixRewrites)), 1);
      const trace = await assertAdoptedPreparedSubmission(page, result, largePrompt,
        'd'.repeat(1000) + 'SYNTHETIC_PERSISTENT_PREFIX_EXTERNAL' + largePrompt.slice(2000));
      assert.equal(trace.counters.prefixRewriteRestarts, 1);
      assert.equal(trace.counters.chunkRestarts, 0);
    } finally {
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  await scenario('A page moving the caret within the prepared prefix adopts that changed text once', async page => {
    const largePrompt = 'SYNTHETIC_MISPLACED_CHUNK_' + 'e'.repeat(9000);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const exec = document.execCommand.bind(document);
      globalThis.misplacedChunk = { writes: 0 };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') {
          misplacedChunk.writes++;
          if (misplacedChunk.writes === 2 || misplacedChunk.writes === 4) {
            const editor = document.querySelector('[data-composer-markdown]');
            const range = document.createRange();
            const text = editor.querySelector('p').firstChild;
            range.setStart(text, 1);
            range.collapse(true);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
          }
        }
        return exec(name, ui, value);
      };
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const trace = await assertAdoptedPreparedSubmission(page, result, largePrompt,
      largePrompt[0] + 'e'.repeat(2000) + largePrompt.slice(1, -2000));
    assert.equal(trace.counters.prefixRewriteRestarts, 2);
    assert.equal(trace.counters.dispatchAttempts, 1);
  });
  await scenario('A page-duplicated prepared prefix is adopted once and remains distinct from exact source delivery', async page => {
    const largePrompt = 'SYNTHETIC_DUPLICATED_PREFIX_' + 'f'.repeat(9000);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const exec = document.execCommand.bind(document);
      globalThis.duplicatePrefix = { writes: 0 };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText' && (++duplicatePrefix.writes === 2 || duplicatePrefix.writes === 4)) {
          const text = document.querySelector('[data-composer-markdown] p').firstChild;
          const old = text.data;
          text.data = old + value + old + value;
        }
        return exec(name, ui, value);
      };
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    let expected = '';
    for (let offset = 0, index = 1; offset < largePrompt.length; offset += 1000, index++) {
      const chunk = largePrompt.slice(offset, offset + 1000);
      // The fixture's text-node replacement resets the range to offset zero.
      expected = index === 2 || index === 4 ? chunk + expected + chunk + expected + chunk : expected + chunk;
    }
    const trace = await assertAdoptedPreparedSubmission(page, result, largePrompt, expected);
    assert.ok(trace.counters.chunkDifferences >= 2);
    assert.equal(trace.counters.chunkRestarts, 0);
  });
  for (const method of ['button', 'ctrl-enter']) await scenario(`Temporary chunk decoration absorbed into prepared text is adopted for one ${method} submission`, async page => {
    const largePrompt = 'SYNTHETIC_TRANSIENT_CHUNK_' + 'g'.repeat(9000) + '_END';
    const started = await start(page, { prompt: largePrompt, sendMethod: method, intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const exec = document.execCommand.bind(document);
      globalThis.transientChunk = { writes: 0, restored: 0 };
      document.execCommand = (name, ui, value) => {
        const result = exec(name, ui, value);
        if (name === 'insertText') {
          transientChunk.writes++;
          const marker = document.createElement('span');
          marker.textContent = 'SYNTHETIC_TRANSIENT_DECORATION';
          document.querySelector('[data-composer-markdown]').append(marker);
          queueMicrotask(() => { marker.remove(); transientChunk.restored++; });
        }
        return result;
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    let timer;
    try {
      const outcome = await Promise.race([sending.then(result => ({ result })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 8000); })]);
      const observed = await inspect(page);
      const probe = await worker.evaluate(async tabId => {
        const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => transientChunk });
        return frames.find(frame => frame.frameId === 0)?.result;
      }, started.job.tabId);
      const marker = await page.evaluate(() => {
        const text = 'SYNTHETIC_TRANSIENT_DECORATION';
        return { model: pm.state.doc.textContent.includes(text), dom: pm.dom.textContent.includes(text),
          originalSpan: [...pm.dom.querySelectorAll('span')].some(node => node.textContent === text) };
      });
      console.log('TRANSIENT CHUNK RESULT ' + JSON.stringify({ method, timedOut: !!outcome.timedOut,
        writes: probe.writes, restored: probe.restored, submissions: observed.submits, marker,
        messageShape: { length: observed.sentTexts[0]?.length, sourceLength: largePrompt.length,
          decorationCount: observed.sentTexts[0]?.split('SYNTHETIC_TRANSIENT_DECORATION').length - 1,
          lineBreaks: observed.sentTexts[0]?.split('\n').length - 1,
          strippedMatches: observed.sentTexts[0]?.replaceAll('SYNTHETIC_TRANSIENT_DECORATION', '').replaceAll('\n', '') === largePrompt } }));
      assert.ok(probe.writes >= 2);
      assert.equal(outcome.timedOut, undefined, 'Adopted decoration must not cause repeated full refilling');
      assert.equal(probe.restored, probe.writes, 'The original temporary spans were actually removed');
      const chunks = Array.from({ length: Math.ceil(largePrompt.length / 1000) }, (_, index) => largePrompt.slice(index * 1000, (index + 1) * 1000));
      const expected = chunks.map(chunk => chunk + '\nSYNTHETIC_TRANSIENT_DECORATION').join('');
      const trace = await assertAdoptedPreparedSubmission(page, outcome.result, largePrompt, expected, { method });
      assert.equal(trace.counters.chunkRestarts, 0);
    } finally {
      clearTimeout(timer);
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  await scenario('Live diagnostics identify chunk preparation before any automatic submission', async page => {
    const largePrompt = 'SYNTHETIC_LIVE_PREPARATION_' + 'p'.repeat(9000);
    const previousSequence = await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics?.at(-1)?.sequence || 0);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      const exec = document.execCommand.bind(document);
      globalThis.livePrepare = { writes: 0, held: false };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') livePrepare.writes++;
        return exec(name, ui, value);
      };
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && livePrepare.writes === 1 && !livePrepare.held) {
          livePrepare.held = true;
          document.documentElement.dataset.livePrepareHeld = 'true';
          await new Promise(resolve => { livePrepare.release = resolve; });
        }
        return send(message);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    let trace;
    try {
      await page.waitForFunction(() => document.documentElement.dataset.livePrepareHeld === 'true', null, { timeout: 8000 });
      const deadline = Date.now() + 9000;
      while (Date.now() < deadline) {
        trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
        if (trace?.sequence > previousSequence && trace?.counters?.domWrites >= 1) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(trace?.sequence > previousSequence && trace?.counters?.domWrites >= 1, 'The current persisted live snapshot must include the held write');
      console.log('LIVE PREPARATION RESULT ' + JSON.stringify({ stage: trace.stage, reason: trace.reason,
        writes: trace.counters.domWrites, dispatches: trace.counters.dispatchAttempts }));
      assert.equal(trace.stage, 'prepare');
      assert.equal(trace.counters.dispatchAttempts, 0);
      assert.equal((await inspect(page)).submits, 0);
      const exported = await control.evaluate(async () => {
        const { buildActivityExport } = await import('./activity-export.js');
        const stored = await chrome.storage.local.get(['logs', 'deliveryDiagnostics', 'diagnosticsHealth']);
        return buildActivityExport({ logs: stored.logs, deliveries: stored.deliveryDiagnostics, diagnosticsHealth: stored.diagnosticsHealth });
      });
      assert.equal(exported.deliveries.at(-1).stage, 'prepare');
      assert.equal(JSON.stringify(exported).includes(largePrompt), false);
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => livePrepare.release?.() }), started.job.tabId);
      await sending;
    }
  });
  await scenario('A duplicate model request cannot hide legacy preparation or cause overlapping model attempts', async page => {
    const largePrompt = 'SYNTHETIC_DUPLICATE_MODEL_' + 'q'.repeat(9000);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      const exec = document.execCommand.bind(document);
      globalThis.duplicateModel = { writes: 0, held: false, commitRequest: null };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') duplicateModel.writes++;
        return exec(name, ui, value);
      };
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'COMMIT_RUN') duplicateModel.commitRequest = message;
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && duplicateModel.writes === 1 && !duplicateModel.held) {
          duplicateModel.held = true;
          document.documentElement.dataset.duplicateModelHeld = 'true';
          duplicateModel.duplicateReply = send(duplicateModel.commitRequest);
          await new Promise(resolve => { duplicateModel.release = resolve; });
        }
        return send(message);
      };
    } }), started.job.tabId);
    await worker.evaluate(() => {
      globalThis.duplicateModelOriginalExecute = chrome.scripting.executeScript;
      globalThis.duplicateModelPreparations = 0;
      chrome.scripting.executeScript = async request => {
        if (request.func.name === 'editorCommit' && request.args[0].phase === 'prepare') duplicateModelPreparations++;
        return duplicateModelOriginalExecute(request);
      };
    });
    const sending = call({ type: 'SEND_NOW' });
    let trace;
    try {
      await page.waitForFunction(() => document.documentElement.dataset.duplicateModelHeld === 'true', null, { timeout: 8000 });
      await new Promise(resolve => setTimeout(resolve, 3500));
      trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
      const count = await worker.evaluate(() => duplicateModelPreparations);
      console.log('DUPLICATE MODEL RESULT ' + JSON.stringify({ preparations: count, stage: trace?.stage,
        writes: trace?.counters?.domWrites, dispatches: trace?.counters?.dispatchAttempts }));
      assert.equal(count, 1, 'One run may prepare the model only once');
      assert.equal(trace.stage, 'prepare');
      assert.equal(trace.counters.dispatchAttempts, 0);
      assert.equal((await inspect(page)).submits, 0);
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => duplicateModel.release?.() }), started.job.tabId);
      await sending;
      await worker.evaluate(() => { chrome.scripting.executeScript = duplicateModelOriginalExecute; });
    }
  });
  for (const method of ['button', 'ctrl-enter']) await scenario(`A delayed private model can confirm a partial local receipt through ${method} without proving full delivery`, async page => {
    const largePrompt = 'SYNTHETIC_DELAYED_MODEL_' + 'z'.repeat(12000) + '_END';
    await page.evaluate(sourceLength => {
      fixture.externalModel = 'SYNTHETIC_STALE_EXTERNAL_MODEL';
      fixture.externalModelUpdates = 0;
      const original = pm.props.dispatchTransaction;
      pm.setProps({ dispatchTransaction(transaction) {
        original.call(pm, transaction);
        if (transaction.docChanged) {
          const value = pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n');
          if (value.length < sourceLength) setTimeout(() => { fixture.externalModel = value; fixture.externalModelUpdates++; }, 500);
        }
      } });
      const submitExternal = event => {
        event.stopImmediatePropagation();
        event.preventDefault();
        fixture.publicModelAtSend = pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n');
        fixture.externalSendType = event.type;
        fixture.submits++;
        fixture.sentTexts.push(fixture.externalModel);
        const row = document.createElement('article');
        row.className = 'message-row self';
        row.dataset.messageId = 'pm-account~pm-dot~external-' + fixture.submits;
        const body = document.createElement('div');
        body.className = 'message-body';
        body.textContent = fixture.externalModel;
        row.append(body);
        document.querySelector('#history').append(row);
      };
      document.querySelector('button[aria-label="Send"]').addEventListener('click', submitExternal, true);
      pm.dom.addEventListener('keydown', event => { if (event.key === 'Enter' && event.ctrlKey) submitExternal(event); }, true);
    }, largePrompt.length);
    await start(page, { prompt: largePrompt, sendMethod: method, intervalMinutes: 30 });
    const sending = call({ type: 'SEND_NOW' });
    let timer;
    try {
      const outcome = await Promise.race([sending.then(result => ({ result })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 8000); })]);
      const observed = await inspect(page);
      console.log('DELAYED MODEL RESULT ' + JSON.stringify({ method, timedOut: !!outcome.timedOut,
        updates: observed.externalModelUpdates, submissions: observed.submits,
        sentLength: observed.sentTexts[0]?.length, exact: observed.sentTexts[0] === largePrompt }));
      assert.equal(outcome.timedOut, undefined);
      assert.equal(observed.submits, 1);
      assert.equal(observed.publicModelAtSend, largePrompt);
      assert.equal(observed.externalSendType, method === 'button' ? 'click' : 'keydown');
      assert.ok(observed.externalModelUpdates > 0);
      assert.ok(observed.sentTexts[0].length > 0 && observed.sentTexts[0].length < largePrompt.length);
      assert.ok(largePrompt.startsWith(observed.sentTexts[0]), 'The private model must be a previously prepared partial prefix');
      assert.deepEqual(await page.locator('#history .message-row.self .message-body').allTextContents(), observed.sentTexts);
      assert.equal(outcome.result.job.sentCount, 1, outcome.result.job.statusText);
      assert.equal(outcome.result.job.unknownCount, 0);
      assert.equal(outcome.result.job.prompt, largePrompt);
      assert.equal((await call({ type: 'GET_STATE' })).config.prompt, largePrompt);
      const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
      assert.equal(trace.counters.dispatchAttempts, 1);
      assert.equal(trace.method, method);
      await new Promise(resolve => setTimeout(resolve, 600));
      assert.equal((await inspect(page)).submits, 1, 'A partial local confirmation must not cause reinjection or another submission');
    } finally {
      clearTimeout(timer);
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  await scenario('Chunk diagnostics retain an adopted changing settled prefix without storing its text', async page => {
    const largePrompt = 'SYNTHETIC_CHANGED_PREFIX_' + 'r'.repeat(7000);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const exec = document.execCommand.bind(document);
      globalThis.changedPrefix = { writes: 0 };
      document.execCommand = (name, ui, value) => {
        const result = exec(name, ui, value);
        if (name === 'insertText' && ++changedPrefix.writes === 1) {
          setTimeout(() => {
            document.querySelector('[data-composer-markdown] p').firstChild.data = 'SYNTHETIC_EXTERNAL_REPLACEMENT';
          }, 10);
        }
        return result;
      };
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const trace = await assertAdoptedPreparedSubmission(page, result, largePrompt,
      'SYNTHETIC_EXTERNAL_REPLACEMENT' + largePrompt.slice(1000));
    assert.ok(trace.counters.chunkSettlementRestarts >= 1);
    assert.equal(trace.counters.dispatchAttempts, 1);
    const exported = await control.evaluate(async () => {
      const { buildActivityExport } = await import('./activity-export.js');
      const stored = await chrome.storage.local.get(['logs', 'deliveryDiagnostics', 'diagnosticsHealth']);
      return buildActivityExport({ logs: stored.logs, deliveries: stored.deliveryDiagnostics, diagnosticsHealth: stored.diagnosticsHealth });
    });
    assert.equal(exported.deliveries.at(-1).counters.chunkSettlementRestarts, trace.counters.chunkSettlementRestarts);
    assert.equal(JSON.stringify(exported).includes(largePrompt), false);
    assert.equal(JSON.stringify(exported).includes('SYNTHETIC_EXTERNAL_REPLACEMENT'), false);
  });
  await scenario('Chunk retries distinguish an unsupported rich draft without storing its text', async page => {
    const largePrompt = 'SYNTHETIC_OPAQUE_CHUNK_' + 'v'.repeat(7000);
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime), exec = document.execCommand.bind(document);
      globalThis.opaqueChunk = { writes: 0, injected: false };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') opaqueChunk.writes++;
        return exec(name, ui, value);
      };
      chrome.runtime.sendMessage = async message => {
        const result = await send(message);
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && opaqueChunk.writes === 1 && !opaqueChunk.injected) {
          opaqueChunk.injected = true;
          const editor = document.querySelector('[data-composer-markdown]');
          const node = document.createElement('canvas');
          node.textContent = 'SYNTHETIC_OPAQUE_CONTENT';
          Object.defineProperty(editor, 'childNodes', { configurable: true, get() {
            opaqueChunk.reads = (opaqueChunk.reads || 0) + 1;
            return [node];
          } });
          setTimeout(() => { Reflect.deleteProperty(editor, 'childNodes'); }, 50);
        }
        return result;
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    try {
      const result = await sending;
      const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
      assert.equal(result.job.sentCount, 1, result.job.statusText);
      assert.equal((await inspect(page)).sentTexts[0] === largePrompt, true);
      assert.ok(trace.counters.chunkUnserializableRecoveries >= 1);
      assert.equal(trace.counters.chunkUnserializableRestarts, 0);
      assert.equal(trace.counters.chunkSettlementRestarts, 0);
      assert.equal(JSON.stringify(trace).includes('SYNTHETIC_OPAQUE_CONTENT'), false);
    } finally {
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  for (const method of ['button', 'ctrl-enter']) await scenario(`A page rewriting accepted large chunks adopts its final prepared text through ${method}`, async page => {
    const largePrompt = 'SYNTHETIC_SHORTER_CHUNKS_' + 's'.repeat(9000) + '_END';
    const started = await start(page, { prompt: largePrompt, sendMethod: method, intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const exec = document.execCommand.bind(document);
      globalThis.shortChunkProbe = { writes: 0, largeWrites: 0, smallWrites: 0 };
      document.execCommand = (name, ui, value) => {
        const result = exec(name, ui, value);
        if (name === 'insertText') {
          shortChunkProbe.writes++;
          if (value.length > 500) {
            shortChunkProbe.largeWrites++;
            setTimeout(() => {
              const editor = document.querySelector('[data-composer-markdown]');
              editor.querySelector('p').firstChild.data = 'SYNTHETIC_OVERSIZED_SEGMENT_RESTORED';
            }, 10);
          } else shortChunkProbe.smallWrites++;
        }
        return result;
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    let timer;
    try {
      const outcome = await Promise.race([sending.then(result => ({ result })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 8000); })]);
      const observed = await inspect(page);
      const probe = await worker.evaluate(async tabId => {
        const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => shortChunkProbe });
        return frames.find(frame => frame.frameId === 0)?.result;
      }, started.job.tabId);
      console.log('SHORT CHUNK RECOVERY ' + JSON.stringify({ method, timedOut: !!outcome.timedOut,
        large: probe.largeWrites, small: probe.smallWrites, submissions: observed.submits }));
      assert.equal(outcome.timedOut, undefined, 'Nonempty restored text must not cause a full-refill loop');
      assert.equal(probe.largeWrites, Math.floor(largePrompt.length / 1000));
      assert.equal(probe.smallWrites, 1);
      const trace = await assertAdoptedPreparedSubmission(page, outcome.result, largePrompt,
        'SYNTHETIC_OVERSIZED_SEGMENT_RESTORED' + largePrompt.slice(9000), { method });
      assert.equal(trace.counters.chunkRestarts, 0);
    } finally {
      clearTimeout(timer);
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  for (const method of ['button', 'ctrl-enter']) await scenario(`A completed chunked prompt is not fully selected before ${method}`, async page => {
    const largePrompt = 'SYNTHETIC_COMPLETE_SELECTION_' + 'a'.repeat(9000) + '_END';
    const started = await start(page, { prompt: largePrompt, sendMethod: method, intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const exec = document.execCommand.bind(document);
      const addRange = Selection.prototype.addRange;
      globalThis.completedSelection = { fullAt: 0, complete: false };
      document.execCommand = (name, ui, value) => {
        const result = exec(name, ui, value);
        if (name === 'insertText' && value.endsWith('_END')) completedSelection.complete = true;
        return result;
      };
      Selection.prototype.addRange = function(range) {
        const editor = document.querySelector('[data-composer-markdown]');
        if (completedSelection.complete && editor && !range.collapsed) {
          const whole = document.createRange();
          whole.selectNodeContents(editor);
          if (range.compareBoundaryPoints(Range.START_TO_START, whole) === 0
              && range.compareBoundaryPoints(Range.END_TO_END, whole) === 0) completedSelection.fullAt++;
        }
        return addRange.call(this, range);
      };
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const probe = await worker.evaluate(async tabId => {
      const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => completedSelection });
      return frames.find(frame => frame.frameId === 0)?.result;
    }, started.job.tabId);
    const observed = await inspect(page);
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.equal(observed.sentTexts[0] === largePrompt, true);
    assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], method === 'button' ? [1, 0, 1] : [0, 1, 1]);
    assert.equal(probe.fullAt, 0, 'The completed unchanged prompt must not be selected again');
  });
  for (const method of ['button', 'ctrl-enter']) await scenario(`A complete segment followed by transient whitespace settles before ${method}`, async page => {
    const largePrompt = 'SYNTHETIC_SETTLING_SELECTION_' + 'b'.repeat(9000) + '_END';
    const started = await start(page, { prompt: largePrompt, sendMethod: method, intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const exec = document.execCommand.bind(document);
      const addRange = Selection.prototype.addRange;
      globalThis.settlingSelection = { writes: 0, inserted: false, selectedAfterComplete: 0 };
      document.execCommand = (name, ui, value) => {
        const result = exec(name, ui, value);
        if (name === 'insertText') {
          settlingSelection.writes++;
          if (!settlingSelection.inserted && value.endsWith('_END')) {
            settlingSelection.inserted = true;
            const text = document.querySelector('[data-composer-markdown] p').firstChild;
            text.data += ' ';
            queueMicrotask(() => { text.data = text.data.slice(0, -1); });
          }
        }
        return result;
      };
      Selection.prototype.addRange = function(range) {
        if (settlingSelection.inserted && !range.collapsed) settlingSelection.selectedAfterComplete++;
        return addRange.call(this, range);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    let timer;
    try {
      const outcome = await Promise.race([sending.then(result => ({ result })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 8000); })]);
      const observed = await inspect(page);
      const probe = await worker.evaluate(async tabId => {
        const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => settlingSelection });
        return frames.find(frame => frame.frameId === 0)?.result;
      }, started.job.tabId);
      console.log('SETTLING SELECTION RESULT ' + JSON.stringify({ method, timedOut: !!outcome.timedOut,
        writes: probe.writes, submissions: observed.submits, exact: observed.sentTexts[0] === largePrompt }));
      assert.equal(outcome.timedOut, undefined);
      assert.equal(outcome.result.job.sentCount, 1, outcome.result.job.statusText);
      assert.equal(observed.sentTexts[0] === largePrompt, true);
      assert.equal(observed.submits, 1);
      assert.equal(probe.writes, Math.ceil(largePrompt.length / 1000), 'A temporary final DOM difference must not trigger a second complete write');
      assert.equal(probe.selectedAfterComplete, 0);
    } finally {
      clearTimeout(timer);
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  for (const action of ['pause', 'attachment', 'change']) await scenario(`A ${action} during final chunk settling prevents stale submission`, async page => {
    const largePrompt = 'SYNTHETIC_FINAL_SETTLING_' + 's'.repeat(9000) + '_END';
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const exec = document.execCommand.bind(document), send = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.finalSettleGate = { inserted: false, held: false };
      document.execCommand = (name, ui, value) => {
        const result = exec(name, ui, value);
        if (name === 'insertText' && value.endsWith('_END')) {
          finalSettleGate.inserted = true;
          const text = document.querySelector('[data-composer-markdown] p').firstChild;
          text.data += ' ';
          queueMicrotask(() => { text.data = text.data.slice(0, -1); });
        }
        return result;
      };
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && finalSettleGate.inserted && !finalSettleGate.held) {
          finalSettleGate.held = true;
          document.documentElement.dataset.finalSettleHeld = 'true';
          await new Promise(resolve => { finalSettleGate.release = resolve; });
        }
        return send(message);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => document.documentElement.dataset.finalSettleHeld === 'true', null, { timeout: 8000 });
      if (action === 'pause') await call({ type: 'PAUSE' });
      else if (action === 'attachment') await page.evaluate(() => fixtureAddAttachment(false));
      else await page.evaluate(() => pm.dispatch(pm.state.tr.insertText('SYNTHETIC_NEW_DRAFT', 0, pm.state.doc.content.size)));
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => finalSettleGate.release() }), started.job.tabId);
      if (action === 'change') {
        const result = await sending;
        await assertAdoptedPreparedSubmission(page, result, largePrompt, 'SYNTHETIC_NEW_DRAFT');
      } else {
        await new Promise(resolve => setTimeout(resolve, 400));
        assert.equal((await inspect(page)).submits, 0);
        if (action === 'attachment') assert.equal(await page.locator('[data-testid="attachment"]').count(), 1);
        await call({ type: 'PAUSE' });
        assert.equal((await sending).job.sentCount, 0);
      }
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => finalSettleGate.release?.() }), started.job.tabId);
      await sending;
    }
  });
  await scenario('The complete prompt remains unselected while a delayed Send becomes enabled', async page => {
    const largePrompt = 'SYNTHETIC_DISABLED_SEND_' + 'e'.repeat(9000) + '_END';
    await page.evaluate(() => {
      const button = document.querySelector('button[aria-label="Send"]');
      const send = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, 'disabled');
      Object.defineProperty(button, 'disabled', { configurable: true, get: () => true, set() {} });
      globalThis.releaseSyntheticSend = () => { Reflect.deleteProperty(button, 'disabled'); send.set.call(button, false); };
    });
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.disabledSendGate = { held: false };
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 150 && !disabledSendGate.held
            && document.querySelector('[data-composer-markdown]')?.textContent?.endsWith('_END')) {
          disabledSendGate.held = true;
          document.documentElement.dataset.disabledSendHeld = 'true';
          await new Promise(resolve => { disabledSendGate.release = resolve; });
        }
        return send(message);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => document.documentElement.dataset.disabledSendHeld === 'true', null, { timeout: 8000 });
      const selection = await page.evaluate(() => ({ collapsed: getSelection().isCollapsed,
        modelExact: pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n') === 'SYNTHETIC_DISABLED_SEND_' + 'e'.repeat(9000) + '_END' }));
      assert.equal(selection.collapsed, true);
      assert.equal(selection.modelExact, true);
      assert.equal((await inspect(page)).submits, 0);
      await page.evaluate(() => releaseSyntheticSend());
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => disabledSendGate.release() }), started.job.tabId);
      const result = await sending;
      assert.equal(result.job.sentCount, 1, result.job.statusText);
      assert.equal((await inspect(page)).sentTexts[0] === largePrompt, true);
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => disabledSendGate.release?.() }), started.job.tabId);
      await sending;
    }
  });
  await scenario('A transient contenteditable overlay during final settling is not removed or submitted', async page => {
    const largePrompt = 'SYNTHETIC_FINAL_OPAQUE_' + 't'.repeat(9000) + '_END';
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const exec = document.execCommand.bind(document), send = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.finalOpaqueGate = { inserted: false, held: false };
      document.execCommand = (name, ui, value) => {
        const result = exec(name, ui, value);
        if (name === 'insertText' && value.endsWith('_END')) {
          finalOpaqueGate.inserted = true;
          const text = document.querySelector('[data-composer-markdown] p').firstChild;
          text.data += ' ';
          queueMicrotask(() => { text.data = text.data.slice(0, -1); });
        }
        return result;
      };
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && finalOpaqueGate.inserted && !finalOpaqueGate.held) {
          finalOpaqueGate.held = true;
          document.documentElement.dataset.finalOpaqueHeld = 'true';
          await new Promise(resolve => { finalOpaqueGate.release = resolve; });
        }
        const reply = await send(message);
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && finalOpaqueGate.held && !finalOpaqueGate.installed) {
          finalOpaqueGate.installed = true;
          const editor = document.querySelector('[data-composer-markdown]');
          const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'childNodes');
          let forced = false;
          Object.defineProperty(editor, 'childNodes', { configurable: true, get() {
            if (!forced) {
              forced = true;
              const node = document.createElement('canvas');
              node.textContent = 'SYNTHETIC_FINAL_OPAQUE_CONTENT';
              return [node];
            }
            return descriptor.get.call(this);
          } });
          setTimeout(() => Reflect.deleteProperty(editor, 'childNodes'), 50);
        }
        return reply;
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => document.documentElement.dataset.finalOpaqueHeld === 'true', null, { timeout: 8000 });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => finalOpaqueGate.release() }), started.job.tabId);
      const result = await sending;
      assert.equal(result.job.sentCount, 1, result.job.statusText);
      assert.equal((await inspect(page)).sentTexts[0] === largePrompt, true);
      const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
      assert.ok(trace.counters.chunkUnserializableChecks >= 1);
      assert.equal(trace.counters.chunkUnserializableRestarts, 0, 'A transient final read must wait without rewriting the prompt');
      assert.equal(trace.counters.chunkRestarts, 0);
      assert.equal(trace.counters.dispatchAttempts, 1);
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => finalOpaqueGate.release?.() }), started.job.tabId);
      await sending;
    }
  });
  for (const method of ['button', 'ctrl-enter']) await scenario(`A short-lived unserializable chunk resumes without full rewrite before ${method}`, async page => {
    const largePrompt = 'SYNTHETIC_TRANSIENT_UNSERIALIZABLE_' + 'q'.repeat(9000) + '_END';
    const started = await start(page, { prompt: largePrompt, sendMethod: method, intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const exec = document.execCommand.bind(document), send = chrome.runtime.sendMessage.bind(chrome.runtime);
      const addRange = Selection.prototype.addRange;
      globalThis.transientUnserializable = { writes: 0, invalidReads: 0, selections: 0 };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') transientUnserializable.writes++;
        return exec(name, ui, value);
      };
      Selection.prototype.addRange = function(range) {
        if (transientUnserializable.writes > 0 && !range.collapsed) transientUnserializable.selections++;
        return addRange.call(this, range);
      };
      chrome.runtime.sendMessage = async message => {
        const reply = await send(message);
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && transientUnserializable.writes === 1
            && !transientUnserializable.installed) {
          transientUnserializable.installed = true;
          const editor = document.querySelector('[data-composer-markdown]');
          const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'childNodes');
          let forced = false;
          Object.defineProperty(editor, 'childNodes', { configurable: true, get() {
            if (!forced) {
              forced = true;
              transientUnserializable.invalidReads++;
              const node = document.createElement('canvas');
              node.textContent = 'SYNTHETIC_TRANSIENT_OPAQUE_CONTENT';
              return [node];
            }
            return descriptor.get.call(this);
          } });
          setTimeout(() => Reflect.deleteProperty(editor, 'childNodes'), 50);
        }
        return reply;
      };
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const probe = await worker.evaluate(async tabId => {
      const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => transientUnserializable });
      return frames.find(frame => frame.frameId === 0)?.result;
    }, started.job.tabId);
    const observed = await inspect(page);
    const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
    console.log('TRANSIENT UNSERIALIZABLE RESULT ' + JSON.stringify({ method, writes: probe.writes,
      invalidReads: probe.invalidReads, selections: probe.selections, restarts: trace.counters.chunkRestarts,
      submissions: observed.submits, exact: observed.sentTexts[0] === largePrompt }));
    assert.equal(probe.invalidReads, 1);
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.equal(observed.sentTexts[0] === largePrompt, true);
    assert.equal(observed.submits, 1);
    assert.equal(probe.writes, Math.ceil(largePrompt.length / 1000), 'A temporary unreadable chunk must not cause the complete prompt to be rewritten');
    assert.equal(probe.selections, 0, 'A temporary unreadable chunk must not select already entered text');
    assert.equal(trace.counters.chunkRestarts, 0);
    assert.ok(trace.counters.chunkUnserializableRecoveries >= 1);
    const exported = await control.evaluate(async () => {
      const { buildActivityExport } = await import('./activity-export.js');
      const stored = await chrome.storage.local.get(['logs', 'deliveryDiagnostics', 'diagnosticsHealth']);
      return buildActivityExport({ logs: stored.logs, deliveries: stored.deliveryDiagnostics, diagnosticsHealth: stored.diagnosticsHealth });
    });
    assert.equal(exported.deliveries.at(-1).counters.chunkUnserializableRecoveries, trace.counters.chunkUnserializableRecoveries);
    assert.equal(JSON.stringify(exported).includes(largePrompt), false);
    assert.equal(JSON.stringify(exported).includes('SYNTHETIC_TRANSIENT_OPAQUE_CONTENT'), false);
  });
  for (const scenarioMode of ['pause', 'persistent', 'mutated', 'attachment']) await scenario(`Unreadable chunk recovery preserves ${scenarioMode} boundaries`, async page => {
    const largePrompt = 'SYNTHETIC_UNREADABLE_BOUNDARY_' + 'b'.repeat(9000) + '_END';
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async ({ tabId, scenarioMode }) => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', args: [scenarioMode], func: mode => {
      const exec = document.execCommand.bind(document), send = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.unreadableBoundary = { writes: 0, invalidReads: 0, held: false, installed: false };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') unreadableBoundary.writes++;
        return exec(name, ui, value);
      };
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && unreadableBoundary.invalidReads && !unreadableBoundary.held) {
          unreadableBoundary.held = true;
          document.documentElement.dataset.unreadableRecoveryHeld = 'true';
          await new Promise(resolve => { unreadableBoundary.release = resolve; });
        }
        const reply = await send(message);
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && unreadableBoundary.writes === 1 && !unreadableBoundary.installed) {
          unreadableBoundary.installed = true;
          const editor = document.querySelector('[data-composer-markdown]');
          const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'childNodes');
          Object.defineProperty(editor, 'childNodes', { configurable: true, get() {
            if (mode === 'persistent' || unreadableBoundary.invalidReads === 0) {
              unreadableBoundary.invalidReads++;
              const node = document.createElement('canvas');
              return [node];
            }
            return descriptor.get.call(this);
          } });
        }
        return reply;
      };
    } }), { tabId: started.job.tabId, scenarioMode });
    const sending = call({ type: 'SEND_NOW' });
    let timer;
    try {
      const gate = await Promise.race([
        page.waitForFunction(() => document.documentElement.dataset.unreadableRecoveryHeld === 'true', null, { timeout: 5000 }).then(() => 'held').catch(() => 'timeout'),
        sending.then(() => 'settled'),
        new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), 5500); }),
      ]);
      assert.equal(gate, 'held', 'Recovery must wait for the unreadable chunk before selecting or writing again');
      const beforeRelease = await worker.evaluate(async tabId => {
        const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => unreadableBoundary });
        return frames.find(frame => frame.frameId === 0)?.result;
      }, started.job.tabId);
      assert.equal(beforeRelease.writes, 1, 'Do not rewrite the first chunk while the serialization check is unresolved');
      if (scenarioMode === 'pause') await call({ type: 'PAUSE' });
      if (scenarioMode === 'attachment') await page.evaluate(() => fixtureAddAttachment(false));
      if (scenarioMode === 'mutated') await page.evaluate(() => pm.dispatch(pm.state.tr.insertText('SYNTHETIC_INTERVENING_CHANGE', 0, pm.state.doc.content.size)));
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => unreadableBoundary.release() }), started.job.tabId);
      if (scenarioMode === 'mutated') {
        const result = await sending;
        await assertAdoptedPreparedSubmission(page, result, largePrompt,
          'SYNTHETIC_INTERVENING_CHANGE' + largePrompt.slice(1000));
      } else {
        await new Promise(resolve => setTimeout(resolve, 350));
        assert.equal((await inspect(page)).submits, 0);
        if (scenarioMode === 'attachment') assert.equal(await page.locator('[data-testid="attachment"]').count(), 1);
        if (scenarioMode === 'persistent') {
          const probe = await worker.evaluate(async tabId => {
            const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => unreadableBoundary });
            return frames.find(frame => frame.frameId === 0)?.result;
          }, started.job.tabId);
          assert.equal(probe.writes, 1, 'Persistent unreadable content must not trigger repeated full writes');
        }
        await call({ type: 'PAUSE' });
        assert.equal((await sending).job.sentCount, 0);
      }
    } finally {
      clearTimeout(timer);
      await call({ type: 'PAUSE' });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => unreadableBoundary.release?.() }), started.job.tabId);
      await sending;
    }
  });
  await scenario('Unsupported model preparation is not repeated while a long adapter fill remains active', async page => {
    const largePrompt = 'SYNTHETIC_UNSUPPORTED_SINGLE_PREPARE_' + 'z'.repeat(7000) + '_END';
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(() => {
      globalThis.singlePrepareOriginal = chrome.scripting.executeScript;
      globalThis.singlePrepareProbe = { prepares: 0, responses: 0, unsupported: 0 };
      chrome.scripting.executeScript = async request => {
        if (request.func.name !== 'editorCommit' || request.args?.[0]?.phase !== 'prepare') return singlePrepareOriginal(request);
        singlePrepareProbe.prepares++;
        const frames = await singlePrepareOriginal(request);
        const result = frames?.find(frame => frame.frameId === 0)?.result;
        singlePrepareProbe.responses++;
        if (result?.code === 'unsupported-view' && result.supported === false && result.dispatched === false) singlePrepareProbe.unsupported++;
        return frames;
      };
    });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const exec = document.execCommand.bind(document), send = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.longAdapterGate = { writes: 0, held: false };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') longAdapterGate.writes++;
        return exec(name, ui, value);
      };
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && longAdapterGate.writes === 1 && !longAdapterGate.held) {
          longAdapterGate.held = true;
          document.documentElement.dataset.longAdapterHeld = 'true';
          await new Promise(resolve => { longAdapterGate.release = resolve; });
        }
        return send(message);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => document.documentElement.dataset.longAdapterHeld === 'true', null, { timeout: 8000 });
      const deadline = Date.now() + 8500;
      while (Date.now() < deadline && await worker.evaluate(() => singlePrepareProbe.prepares) < 2)
        await new Promise(resolve => setTimeout(resolve, 50));
      const probe = await worker.evaluate(() => singlePrepareProbe);
      console.log('UNSUPPORTED PREPARATION RESULT ' + JSON.stringify(probe));
      assert.equal(probe.unsupported, 1);
      assert.equal(probe.prepares, 1, 'A completed unsupported model attempt must not run alongside the active adapter');
      assert.equal((await inspect(page)).submits, 0);
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => longAdapterGate.release() }), started.job.tabId);
      const result = await sending;
      assert.equal(result.job.sentCount, 1, result.job.statusText);
      assert.equal((await inspect(page)).sentTexts[0] === largePrompt, true);
      assert.equal((await inspect(page)).submits, 1);
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => longAdapterGate.release?.() }), started.job.tabId);
      await sending;
      await worker.evaluate(() => { chrome.scripting.executeScript = singlePrepareOriginal; });
    }
  });
  for (const method of ['button', 'ctrl-enter']) await scenario(`A transient unreadable post-write segment resumes without selection before ${method}`, async page => {
    const largePrompt = 'SYNTHETIC_TRANSIENT_POSTWRITE_' + 'p'.repeat(9000) + '_END';
    const started = await start(page, { prompt: largePrompt, sendMethod: method, intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const exec = document.execCommand.bind(document), addRange = Selection.prototype.addRange;
      globalThis.postwriteTransient = { writes: 0, invalidReads: 0, selections: 0 };
      document.execCommand = (name, ui, value) => {
        const result = exec(name, ui, value);
        if (name === 'insertText' && ++postwriteTransient.writes === 1) {
          const editor = document.querySelector('[data-composer-markdown]');
          const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'childNodes');
          let forced = false;
          Object.defineProperty(editor, 'childNodes', { configurable: true, get() {
            if (!forced) {
              forced = true;
              postwriteTransient.invalidReads++;
              const node = document.createElement('canvas');
              return [node];
            }
            return descriptor.get.call(this);
          } });
          setTimeout(() => Reflect.deleteProperty(editor, 'childNodes'), 50);
        }
        return result;
      };
      Selection.prototype.addRange = function(range) {
        if (postwriteTransient.writes && !range.collapsed) postwriteTransient.selections++;
        return addRange.call(this, range);
      };
    } }), started.job.tabId);
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    const probe = await worker.evaluate(async tabId => {
      const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => postwriteTransient });
      return frames.find(frame => frame.frameId === 0)?.result;
    }, started.job.tabId);
    const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
    console.log('POSTWRITE TRANSIENT RESULT ' + JSON.stringify({ method, writes: probe.writes, selections: probe.selections,
      invalidReads: probe.invalidReads, restarts: trace.counters.chunkRestarts, submissions: observed.submits,
      exact: observed.sentTexts[0] === largePrompt }));
    assert.equal(probe.invalidReads, 1);
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.equal(observed.sentTexts[0] === largePrompt, true);
    assert.equal(observed.submits, 1);
    assert.equal(probe.writes, Math.ceil(largePrompt.length / 1000));
    assert.equal(probe.selections, 0);
    assert.equal(trace.counters.chunkRestarts, 0);
    assert.ok(trace.counters.chunkUnserializableRecoveries >= 1);
  });
  for (const action of ['pause', 'persistent', 'changed', 'attachment']) await scenario(`A ${action} during post-write recovery prevents a stale submission`, async page => {
    const largePrompt = 'SYNTHETIC_POSTWRITE_BOUNDARY_' + 'j'.repeat(9000) + '_END';
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async ({ tabId, action }) => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', args: [action], func: action => {
      const exec = document.execCommand.bind(document), send = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.postwriteBoundary = { writes: 0, invalidReads: 0, held: false };
      document.execCommand = (name, ui, value) => {
        const result = exec(name, ui, value);
        if (name === 'insertText' && ++postwriteBoundary.writes === 1) {
          const editor = document.querySelector('[data-composer-markdown]');
          const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'childNodes');
          Object.defineProperty(editor, 'childNodes', { configurable: true, get() {
            if (action === 'persistent' || postwriteBoundary.invalidReads === 0) {
              postwriteBoundary.invalidReads++;
              const node = document.createElement('canvas');
              return [node];
            }
            return descriptor.get.call(this);
          } });
        }
        return result;
      };
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && postwriteBoundary.invalidReads && !postwriteBoundary.held) {
          postwriteBoundary.held = true;
          document.documentElement.dataset.postwriteBoundaryHeld = 'true';
          await new Promise(resolve => { postwriteBoundary.release = resolve; });
        }
        return send(message);
      };
    } }), { tabId: started.job.tabId, action });
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => document.documentElement.dataset.postwriteBoundaryHeld === 'true', null, { timeout: 8000 });
      if (action === 'pause') await call({ type: 'PAUSE' });
      if (action === 'changed') await page.evaluate(() => pm.dispatch(pm.state.tr.insertText('SYNTHETIC_POSTWRITE_CHANGED', 0, pm.state.doc.content.size)));
      if (action === 'attachment') await page.evaluate(() => fixtureAddAttachment(false));
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => postwriteBoundary.release() }), started.job.tabId);
      if (action === 'changed') {
        const result = await sending;
        await assertAdoptedPreparedSubmission(page, result, largePrompt,
          'SYNTHETIC_POSTWRITE_CHANGED' + largePrompt.slice(1000));
      } else {
        await new Promise(resolve => setTimeout(resolve, 350));
        assert.equal((await inspect(page)).submits, 0);
        if (action === 'attachment') assert.equal(await page.locator('[data-testid="attachment"]').count(), 1);
        if (action === 'persistent') {
          const probe = await worker.evaluate(async tabId => {
            const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => postwriteBoundary });
            return frames.find(frame => frame.frameId === 0)?.result;
          }, started.job.tabId);
          assert.equal(probe.writes, 1);
          assert.ok(probe.invalidReads > 1);
        }
        await call({ type: 'PAUSE' });
        assert.equal((await sending).job.sentCount, 0);
      }
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => postwriteBoundary.release?.() }), started.job.tabId);
      await sending;
    }
  });
  for (const method of ['button', 'ctrl-enter']) await scenario(`Page-inserted paragraphs do not alter the user's long prompt for ${method}`, async page => {
    const first = 'SYNTHETIC_PRESERVE_START_' + 'a'.repeat(1800);
    const second = 'SYNTHETIC_PRESERVE_MIDDLE_' + 'b'.repeat(1800);
    const third = 'SYNTHETIC_PRESERVE_END_' + 'c'.repeat(1800);
    const largePrompt = first + '\n\n' + second + '\n\n' + third;
    await start(page, { prompt: largePrompt, sendMethod: method, intervalMinutes: 30 });
    const result = await call({ type: 'SEND_NOW' });
    const observed = await inspect(page);
    console.log('PARAGRAPH FIDELITY RESULT ' + JSON.stringify({ method, exact: observed.sentTexts[0] === largePrompt,
      sentCount: result.job.sentCount, submissions: observed.submits, expectedLength: largePrompt.length,
      actualLength: observed.sentTexts[0]?.length }));
    assert.equal(result.job.sentCount, 1, result.job.statusText);
    assert.equal(observed.submits, 1);
    assert.equal(observed.sentTexts[0] === largePrompt, true, 'Automatically inserted segment separators must not modify the user prompt');
  });
  for (const method of ['button', 'ctrl-enter']) await scenario(`Repeated transformed text is adopted exactly once through ${method}`, async page => {
    const largePrompt = 'SYNTHETIC_REPEATED_CORRUPTION_' + 'c'.repeat(7000);
    const started = await start(page, { prompt: largePrompt, sendMethod: method, intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      document.execCommand = (name, ui, value) => original(name, ui,
        name === 'insertText' && typeof value === 'string' ? value.toUpperCase() : value);
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    let timer;
    try {
      const outcome = await Promise.race([sending.then(result => ({ result })), new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 5000); })]);
      if (outcome.timedOut) await call({ type: 'PAUSE' });
      const result = outcome.result || await sending;
      const observed = await inspect(page);
      console.log('TRANSFORMED DELIVERY RESULT ' + JSON.stringify({ method, timedOut: !!outcome.timedOut,
        submissions: observed.submits, sentCount: result.job.sentCount }));
      assert.notEqual(outcome.timedOut, true);
      const trace = await assertAdoptedPreparedSubmission(page, result, largePrompt, largePrompt.toUpperCase(), { method });
      assert.ok(trace.counters.chunkDifferences > 0);
    } finally {
      clearTimeout(timer);
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  for (const method of ['button', 'ctrl-enter']) await scenario(`Initial UTF-16-safe chunks avoid rejection and send exactly once through ${method}`, async page => {
    const largePrompt = 'A'.repeat(999) + '😀' + 'B'.repeat(998) + '🚀' + 'C'.repeat(2500) + '_END';
    const started = await start(page, { prompt: largePrompt, sendMethod: method, intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const original = document.execCommand.bind(document);
      globalThis.initialChunkProbe = { attempts: [], rejected: 0 };
      document.execCommand = (name, ui, value) => {
        if (name !== 'insertText') return original(name, ui, value);
        const entry = { length: value.length, wellFormed: value.isWellFormed(), accepted: false };
        initialChunkProbe.attempts.push(entry);
        if (value.length > 1000 || !entry.wellFormed) {
          initialChunkProbe.rejected++;
          return false;
        }
        entry.accepted = original(name, ui, value);
        if (!entry.accepted) initialChunkProbe.rejected++;
        return entry.accepted;
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    let timer;
    try {
      const outcome = await Promise.race([sending.then(result => ({ result })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 12000); })]);
      if (outcome.timedOut) await call({ type: 'PAUSE' });
      const result = outcome.result || await sending;
      const observed = await inspect(page);
      const probe = await worker.evaluate(async tabId => {
        const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => initialChunkProbe });
        return frames.find(frame => frame.frameId === 0)?.result;
      }, started.job.tabId);
      const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
      console.log('INITIAL CHUNK RESULT ' + JSON.stringify({ method, timedOut: !!outcome.timedOut,
        attempts: probe.attempts, rejected: probe.rejected, diagnosticRejected: trace?.counters?.rejectedChunks,
        submissions: observed.submits, exact: observed.sentTexts.length === 1 && observed.sentTexts[0] === largePrompt }));
      assert.notEqual(outcome.timedOut, true, 'Chunked delivery must complete without rejected-size retries');
      assert.ok(probe.attempts.length > 1, 'The long prompt must use multiple text operations');
      assert.ok(probe.attempts[0].length <= 1000, 'The initial chunk must not exceed 1000 UTF-16 units');
      assert.ok(probe.attempts.every(chunk => chunk.length > 0 && chunk.length <= 1000 && chunk.wellFormed),
        'Every chunk must fit the limit and preserve surrogate pairs');
      assert.equal(probe.rejected, 0, 'No text insertion may be rejected');
      assert.equal(trace.counters.rejectedChunks, 0);
      assert.equal(result.ok, true, result.error);
      assert.equal(result.job.sentCount, 1, result.job.statusText);
      assert.deepEqual(observed.sentTexts, [largePrompt]);
      assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], method === 'button' ? [1, 0, 1] : [0, 1, 1]);
      assert.equal(trace.counters.dispatchAttempts, 1);
    } finally {
      clearTimeout(timer);
      await call({ type: 'PAUSE' });
      await sending;
    }
  });
  await scenario('A slow synchronous chunk remains cancellable without an early submission', async page => {
    const largePrompt = 'SYNTHETIC_SLOW_LOG_' + 's'.repeat(7000) + '_END';
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const exec = document.execCommand.bind(document);
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.slowLog = { writes: 0, held: false };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText' && ++slowLog.writes === 1) {
          const begin = performance.now();
          while (performance.now() - begin < 2200) {}
        }
        return exec(name, ui, value);
      };
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && slowLog.writes === 1 && !slowLog.held) {
          slowLog.held = true;
          document.documentElement.dataset.slowLogHeld = 'true';
          await new Promise(resolve => { slowLog.release = resolve; });
        }
        return send(message);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => document.documentElement.dataset.slowLogHeld === 'true', null, { timeout: 8000 });
      const frames = await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED',
        func: () => [...globalThis.__agentContinuePageInvocationsV1.values()].at(-1)?.metrics }), started.job.tabId);
      const metrics = frames.find(frame => frame.frameId === 0)?.result;
      assert.equal(metrics.counters.domWrites, 1);
      assert.equal(metrics.counters.textChunks, 1);
      assert.equal(metrics.counters.slowChunks, 1);
      assert.ok(metrics.timings.maxDomWriteMs >= 2000);
      assert.equal(metrics.counters.readinessChecks, 0);
      assert.equal(metrics.counters.dispatchAttempts, 0);
      assert.equal((await inspect(page)).submits, 0);
      await call({ type: 'PAUSE' });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => slowLog.release() }), started.job.tabId);
      assert.equal((await sending).job.sentCount, 0);
      const probe = await worker.evaluate(async tabId => {
        const result = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => slowLog.writes });
        return result.find(frame => frame.frameId === 0)?.result;
      }, started.job.tabId);
      assert.equal(probe, 1);
      assert.equal((await inspect(page)).submits, 0);
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => slowLog.release?.() }), started.job.tabId);
      await sending;
    }
  });
  await scenario('A slow synchronous chunk resumes after the page returns without early dispatch', async page => {
    const largePrompt = 'SYNTHETIC_SLOW_RECOVER_' + 'r'.repeat(3200) + '_END';
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const exec = document.execCommand.bind(document);
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.slowRecover = { writes: 0, held: false };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText' && ++slowRecover.writes === 1) {
          const begin = performance.now();
          while (performance.now() - begin < 2200) {}
        }
        return exec(name, ui, value);
      };
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && slowRecover.writes === 1 && !slowRecover.held) {
          slowRecover.held = true;
          document.documentElement.dataset.slowRecoverHeld = 'true';
          await new Promise(resolve => { slowRecover.release = resolve; });
        }
        return send(message);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => document.documentElement.dataset.slowRecoverHeld === 'true', null, { timeout: 8000 });
      const frames = await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED',
        func: () => [...globalThis.__agentContinuePageInvocationsV1.values()].at(-1)?.metrics }), started.job.tabId);
      const metrics = frames.find(frame => frame.frameId === 0)?.result;
      assert.equal(metrics.counters.readinessChecks, 0);
      assert.equal(metrics.counters.dispatchAttempts, 0);
      assert.equal(metrics.counters.slowChunks, 1);
      assert.ok(metrics.timings.maxDomWriteMs >= 2000);
      assert.equal((await inspect(page)).submits, 0);
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => slowRecover.release() }), started.job.tabId);
      const result = await sending;
      const observed = await inspect(page);
      assert.equal(result.job.sentCount, 1, result.job.statusText);
      assert.equal(observed.submits, 1);
      assert.equal(observed.sentTexts[0], largePrompt);
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => slowRecover.release?.() }), started.job.tabId);
      await sending;
    }
  });
  for (const position of ['post-write', 'between-chunk']) await scenario(`Persistent unreadable ${position} retries are counted without rewriting`, async page => {
    const largePrompt = 'SYNTHETIC_UNREADABLE_RETRY_COUNT_' + 'r'.repeat(9000) + '_END';
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async ({ tabId, position }) => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', args: [position], func: position => {
      const exec = document.execCommand.bind(document), send = chrome.runtime.sendMessage.bind(chrome.runtime);
      const addRange = Selection.prototype.addRange;
      globalThis.unreadableRetryCount = { writes: 0, invalidReads: 0, selections: 0, installed: false, held: false };
      const install = () => {
        if (unreadableRetryCount.installed) return;
        unreadableRetryCount.installed = true;
        const editor = document.querySelector('[data-composer-markdown]');
        Object.defineProperty(editor, 'childNodes', { configurable: true, get() {
          unreadableRetryCount.invalidReads++;
          const node = document.createElement('canvas');
          return [node];
        } });
      };
      document.execCommand = (name, ui, value) => {
        const result = exec(name, ui, value);
        if (name === 'insertText' && ++unreadableRetryCount.writes === 1 && position === 'post-write') install();
        return result;
      };
      Selection.prototype.addRange = function(range) {
        if (unreadableRetryCount.writes && !range.collapsed) unreadableRetryCount.selections++;
        return addRange.call(this, range);
      };
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && unreadableRetryCount.invalidReads >= 4 && !unreadableRetryCount.held) {
          unreadableRetryCount.held = true;
          document.documentElement.dataset.unreadableRetryCountHeld = 'true';
          await new Promise(resolve => { unreadableRetryCount.release = resolve; });
        }
        const reply = await send(message);
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && unreadableRetryCount.writes === 1 && position === 'between-chunk') install();
        return reply;
      };
    } }), { tabId: started.job.tabId, position });
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => document.documentElement.dataset.unreadableRetryCountHeld === 'true', null, { timeout: 10000 });
      const frames = await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => ({
        probe: unreadableRetryCount,
        metrics: [...globalThis.__agentContinuePageInvocationsV1.values()].at(-1)?.metrics,
      }) }), started.job.tabId);
      const { probe, metrics } = frames.find(frame => frame.frameId === 0).result;
      const observed = await inspect(page);
      assert.equal(probe.invalidReads, 4, 'One initial unreadable check must be followed by exactly three unreadable retries');
      assert.equal(probe.writes, 1);
      assert.equal(probe.selections, 0);
      assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [0, 0, 0]);
      assert.equal(metrics.counters.chunkRestarts, 0);
      assert.equal(metrics.counters.chunkUnserializableRecoveries, 0);
      assert.equal(metrics.counters.dispatchAttempts, 0);
      const liveDeadline = Date.now() + 8000;
      let liveTrace;
      while (Date.now() < liveDeadline) {
        liveTrace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
        if (liveTrace?.counters?.chunkUnserializableChecks === 4) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(liveTrace?.counters?.chunkUnserializableChecks, 4);
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED',
        func: () => Reflect.deleteProperty(document.querySelector('[data-composer-markdown]'), 'childNodes') }), started.job.tabId);
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => unreadableRetryCount.release() }), started.job.tabId);
      const result = await sending;
      const final = await inspect(page);
      assert.equal(result.job.sentCount, 1, result.job.statusText);
      assert.equal(final.submits, 1);
      assert.equal(final.sentTexts[0], largePrompt);
      assert.equal(metrics.counters.chunkUnserializableChecks, 4, 'The initial and each repeated unreadable read must be counted');
      const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
      assert.equal(trace.counters.chunkUnserializableChecks, 4);
      const exported = await control.evaluate(async () => {
        const { buildActivityExport } = await import('./activity-export.js');
        const stored = await chrome.storage.local.get(['logs', 'deliveryDiagnostics', 'diagnosticsHealth']);
        return buildActivityExport({ logs: stored.logs, deliveries: stored.deliveryDiagnostics, diagnosticsHealth: stored.diagnosticsHealth });
      });
      assert.equal(exported.deliveries.at(-1).counters.chunkUnserializableChecks, 4);
      assert.equal(JSON.stringify(exported).includes(largePrompt), false);
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => unreadableRetryCount.release?.() }), started.job.tabId);
      await sending;
    }
  });
  for (const position of ['post-write', 'between-chunk']) await scenario(`Pause retains a transient unreadable ${position} check in MV3 diagnostics`, async page => {
    const largePrompt = 'SYNTHETIC_PAUSE_UNREADABLE_' + 'p'.repeat(9000) + '_END';
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async ({ tabId, position }) => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', args: [position], func: position => {
      const exec = document.execCommand.bind(document), send = chrome.runtime.sendMessage.bind(chrome.runtime);
      const addRange = Selection.prototype.addRange;
      globalThis.pauseUnreadable = { writes: 0, invalidReads: 0, selections: 0, installed: false, held: false };
      const install = () => {
        if (pauseUnreadable.installed) return;
        pauseUnreadable.installed = true;
        const editor = document.querySelector('[data-composer-markdown]');
        const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'childNodes');
        Object.defineProperty(editor, 'childNodes', { configurable: true, get() {
          if (!pauseUnreadable.invalidReads) {
            pauseUnreadable.invalidReads++;
            const node = document.createElement('canvas');
            return [node];
          }
          return descriptor.get.call(this);
        } });
      };
      document.execCommand = (name, ui, value) => {
        const result = exec(name, ui, value);
        if (name === 'insertText' && ++pauseUnreadable.writes === 1 && position === 'post-write') install();
        return result;
      };
      Selection.prototype.addRange = function(range) {
        if (pauseUnreadable.writes && !range.collapsed) pauseUnreadable.selections++;
        return addRange.call(this, range);
      };
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && pauseUnreadable.invalidReads && !pauseUnreadable.held) {
          pauseUnreadable.held = true;
          document.documentElement.dataset.pauseUnreadableHeld = 'true';
          await new Promise(resolve => { pauseUnreadable.release = resolve; });
        }
        const reply = await send(message);
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && pauseUnreadable.writes === 1 && position === 'between-chunk') install();
        return reply;
      };
    } }), { tabId: started.job.tabId, position });
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => document.documentElement.dataset.pauseUnreadableHeld === 'true', null, { timeout: 10000 });
      const frames = await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => ({
        probe: pauseUnreadable,
        metrics: [...globalThis.__agentContinuePageInvocationsV1.values()].at(-1)?.metrics,
      }) }), started.job.tabId);
      const { probe, metrics } = frames.find(frame => frame.frameId === 0).result;
      assert.equal(probe.invalidReads, 1);
      assert.equal(probe.writes, 1);
      assert.equal(probe.selections, 0);
      assert.equal(metrics.counters.chunkUnserializableChecks, 1);
      assert.equal(metrics.counters.dispatchAttempts, 0);
      const paused = await call({ type: 'PAUSE' });
      assert.equal(paused.ok, true, paused.error);
      assert.equal(paused.job.enabled, false);
      assert.equal(paused.job.sentCount, 0);
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => pauseUnreadable.release() }), started.job.tabId);
      assert.equal((await sending).job.sentCount, 0);
      const observed = await inspect(page);
      assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [0, 0, 0]);
      const after = await worker.evaluate(async tabId => {
        const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => pauseUnreadable });
        return frames.find(frame => frame.frameId === 0)?.result;
      }, started.job.tabId);
      assert.equal(after.invalidReads, 1);
      assert.equal(after.writes, 1);
      assert.equal(after.selections, 0);
      const deadline = Date.now() + 3000;
      let trace;
      do {
        trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
        if (trace?.counters?.chunkUnserializableChecks === 1) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      assert.equal(trace?.counters?.chunkUnserializableChecks, 1, 'Pause must preserve the observed unreadable check in the final diagnostic trace');
      const exported = await control.evaluate(async () => {
        const { buildActivityExport } = await import('./activity-export.js');
        const stored = await chrome.storage.local.get(['logs', 'deliveryDiagnostics', 'diagnosticsHealth']);
        return buildActivityExport({ logs: stored.logs, deliveries: stored.deliveryDiagnostics, diagnosticsHealth: stored.diagnosticsHealth });
      });
      assert.equal(exported.deliveries.at(-1).counters.chunkUnserializableChecks, 1);
      assert.equal(JSON.stringify(exported).includes(largePrompt), false);
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => pauseUnreadable.release?.() }), started.job.tabId);
      await sending;
    }
  });
  await scenario('An MV3 worker restart during a pending Pause cancellation ACK cannot permit Resume', async page => {
    const started = await start(page, { prompt: 'SYNTHETIC_RESTART_PAUSE_' + 'p'.repeat(9000), sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && !globalThis.restartPauseHeld) {
          globalThis.restartPauseHeld = true;
          document.documentElement.dataset.restartPauseHeld = 'true';
          await new Promise(resolve => { globalThis.releaseRestartPause = resolve; });
        }
        return send(message);
      };
    } }), started.job.tabId);
    await worker.evaluate(() => {
      globalThis.originalRestartPauseSend = chrome.tabs.sendMessage;
      chrome.tabs.sendMessage = (tabId, message, options) => {
        if (message.type === 'CANCEL_RUN') {
          globalThis.restartPauseCancel = { runId: message.runId, resultToken: message.resultToken, at: Date.now() };
          return new Promise(() => {});
        }
        return originalRestartPauseSend.call(chrome.tabs, tabId, message, options);
      };
    });
    const sending = call({ type: 'SEND_NOW' }).catch(() => null);
    const session = await context.newCDPSession(control);
    let stopping = false;
    try {
      await page.waitForFunction(() => document.documentElement.dataset.restartPauseHeld === 'true', null, { timeout: 10000 });
      const inFlight = (await call({ type: 'GET_STATE' })).job;
      assert.equal(inFlight.phase, 'sending');
      assert.ok(inFlight.runDeadline > Date.now());
      const pausing = call({ type: 'PAUSE' }).catch(() => null);
      const deadline = Date.now() + 2000;
      let cancel;
      while (!(cancel = await worker.evaluate(() => globalThis.restartPauseCancel)) && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(cancel?.runId, inFlight.runId, 'Pause must be waiting for the active invocation cancellation ACK');
      assert.ok(cancel?.resultToken);
      const stored = await worker.evaluate(async () => ({ session: await chrome.storage.session.get('job'), local: await chrome.storage.local.get('resumeJob') }));
      assert.equal(stored.session.job.enabled, false);
      assert.equal(stored.local.resumeJob.enabled, false);
      const versions = new Map();
      session.on('ServiceWorker.workerVersionUpdated', event => {
        for (const version of event.versions) versions.set(version.versionId, version);
      });
      await session.send('ServiceWorker.enable');
      const startedAt = Date.now();
      while (![...versions.values()].some(version => version.scriptURL === worker.url() && version.runningStatus === 'running') && Date.now() - startedAt < 5000)
        await new Promise(resolve => setTimeout(resolve, 20));
      const running = [...versions.values()].find(version => version.scriptURL === worker.url() && version.runningStatus === 'running');
      assert.ok(running);
      stopping = true;
      await session.send('ServiceWorker.stopWorker', { versionId: running.versionId });
      const stoppedAt = Date.now();
      while (versions.get(running.versionId)?.runningStatus !== 'stopped' && Date.now() - stoppedAt < 5000)
        await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(versions.get(running.versionId)?.runningStatus, 'stopped');
      assert.ok(Date.now() - cancel.at < 3000, 'The worker must stop before the cancellation ACK timeout');
      const state = await call({ type: 'GET_STATE' });
      worker = context.serviceWorkers().find(item => item.url().endsWith('/background.js'))
        || await context.waitForEvent('serviceworker', { predicate: item => item.url().endsWith('/background.js'), timeout: 15000 });
      assert.equal(state.job.enabled, false);
      assert.ok(inFlight.runDeadline > Date.now(), 'The original page permit must still be live during the Resume attempt');
      const resumed = await call({ type: 'RESUME' });
      const after = await call({ type: 'GET_STATE' });
      const observed = await inspect(page);
      assert.equal(resumed.ok, false, 'An unacknowledged cancellation must survive worker restart and block Resume');
      assert.equal(after.job.enabled, false);
      assert.equal(after.job.sentCount, 0);
      assert.equal((await worker.evaluate(() => chrome.alarms.getAll())).length, 0);
      assert.deepEqual([observed.buttonClicks, observed.keyboardCommands, observed.submits], [0, 0, 0]);
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => globalThis.releaseRestartPause?.() }), started.job.tabId);
      await sending;
      const released = await inspect(page);
      assert.deepEqual([released.buttonClicks, released.keyboardCommands, released.submits], [0, 0, 0]);
      await pausing;
    } finally {
      if (stopping) {
        await call({ type: 'PAUSE' }).catch(() => null);
        await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => globalThis.releaseRestartPause?.() }), started.job.tabId).catch(() => null);
      } else {
        await worker.evaluate(() => { chrome.tabs.sendMessage = originalRestartPauseSend; }).catch(() => null);
        await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => globalThis.releaseRestartPause?.() }), started.job.tabId).catch(() => null);
      }
      await sending;
      await session.detach();
    }
  });
  await scenario('Six synthetic chunks followed by a trusted manual partial receipt stop injection and count only manual confirmation', async page => {
    const largePrompt = 'SYNTHETIC_SIX_SLOW_MANUAL_' + 's'.repeat(9000) + '_END';
    await page.evaluate(() => {
      fixture.manualTrusted = 0;
      document.querySelector('button[aria-label="Send"]').addEventListener('click', event => {
        if (event.isTrusted) fixture.manualTrusted++;
      });
    });
    const started = await start(page, { prompt: largePrompt, sendMethod: 'button', intervalMinutes: 30 });
    await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      const exec = document.execCommand.bind(document);
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.sixSlowManual = { sizes: [], held: false };
      document.execCommand = (name, ui, value) => {
        if (name === 'insertText') {
          sixSlowManual.sizes.push(value.length);
          if (sixSlowManual.sizes.length <= 2) {
            const begin = performance.now();
            while (performance.now() - begin < 2100) {}
          }
        }
        return exec(name, ui, value);
      };
      chrome.runtime.sendMessage = async message => {
        if (message.type === 'WAIT_RUN' && message.delayMs === 50 && sixSlowManual.sizes.length === 6 && !sixSlowManual.held) {
          sixSlowManual.held = true;
          document.documentElement.dataset.sixSlowManualHeld = 'true';
          await new Promise(resolve => { sixSlowManual.release = resolve; });
        }
        return send(message);
      };
    } }), started.job.tabId);
    const sending = call({ type: 'SEND_NOW' });
    try {
      await page.waitForFunction(() => document.documentElement.dataset.sixSlowManualHeld === 'true', null, { timeout: 15000 });
      const frames = await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => ({
        sizes: sixSlowManual.sizes,
        metrics: [...globalThis.__agentContinuePageInvocationsV1.values()].at(-1)?.metrics,
      }) }), started.job.tabId);
      const { sizes, metrics } = frames.find(frame => frame.frameId === 0).result;
      const partial = await page.evaluate(() => pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n'));
      assert.deepEqual(sizes.slice(0, 2), [1000, 250]);
      assert.equal(sizes.length, 6);
      assert.ok(sizes.slice(2).every(size => size <= 64));
      assert.equal(partial, largePrompt.slice(0, sizes.reduce((sum, size) => sum + size, 0)));
      assert.ok(partial.length < largePrompt.length);
      assert.equal(metrics.counters.textChunks, 6);
      assert.equal(metrics.counters.slowChunks, 2);
      assert.ok(metrics.timings.maxDomWriteMs >= 2000);
      assert.equal(metrics.counters.readinessChecks, 0);
      assert.equal(metrics.counters.dispatchAttempts, 0);
      assert.deepEqual([(await inspect(page)).buttonClicks, (await inspect(page)).keyboardCommands, (await inspect(page)).submits], [0, 0, 0]);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      const afterManual = await inspect(page);
      assert.equal(afterManual.manualTrusted, 1);
      assert.deepEqual([afterManual.buttonClicks, afterManual.keyboardCommands, afterManual.submits], [1, 0, 1]);
      assert.deepEqual(afterManual.sentTexts, [partial]);
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => sixSlowManual.release() }), started.job.tabId);
      const result = await sending;
      await new Promise(resolve => setTimeout(resolve, 1000));
      const final = await inspect(page);
      const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
      assert.equal(result.job.sentCount, 0);
      assert.equal(result.job.manualSentCount, 1);
      assert.equal(result.job.unknownCount, 0);
      assert.equal(result.job.lastResult, 'manual-sent');
      assert.equal(result.job.enabled, true);
      assert.ok(result.job.nextAt > Date.now());
      assert.equal(result.job.prompt, largePrompt, 'A manual partial receipt must not replace the saved source');
      assert.equal((await call({ type: 'GET_STATE' })).config.prompt, largePrompt);
      assert.deepEqual(await page.locator('#history .message-row.self .message-body').allTextContents(), [partial]);
      assert.equal(trace.state, 'manual-sent');
      assert.equal(trace.counters.manualIntents, 1);
      assert.equal(trace.counters.dispatchAttempts, 0);
      assert.equal(trace.counters.textChunks, 6);
      assert.equal(trace.counters.slowChunks, 2);
      assert.deepEqual([final.buttonClicks, final.keyboardCommands, final.submits], [1, 0, 1]);
      assert.deepEqual(final.sentTexts, [partial]);
      assert.equal(final.editorEmpty, true);
      const finalSizes = await worker.evaluate(async tabId => {
        const result = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => sixSlowManual.sizes });
        return result.find(frame => frame.frameId === 0)?.result;
      }, started.job.tabId);
      assert.deepEqual(finalSizes, sizes);
    } finally {
      await call({ type: 'PAUSE' });
      await worker.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => sixSlowManual.release?.() }), started.job.tabId);
      await sending;
    }
  });
  for (const method of ['button', 'ctrl-enter']) await scenario(`A short MAIN independent stale model remains a mismatched single attempt via ${method}`, async page => {
    const configured = 'SHORT_SYNTHETIC_PROMPT';
    const stale = 'OLD_SYNTHETIC_MODEL';
    await page.evaluate(stale => {
      pm.dom.editor = { view: pm };
      fixture.externalModel = stale;
      fixture.externalModelUpdates = 0;
      const original = pm.props.dispatchTransaction;
      pm.setProps({ dispatchTransaction(transaction) {
        original.call(pm, transaction);
        if (transaction.docChanged) {
          const value = pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n');
          setTimeout(() => { fixture.externalModel = value; fixture.externalModelUpdates++; }, 5000);
        }
      } });
      const submitExternal = event => {
        event.stopImmediatePropagation();
        event.preventDefault();
        const model = pm.state.doc.textBetween(0, pm.state.doc.content.size, '\n');
        fixture.externalSubmission = { model, dom: pm.dom.innerText, external: fixture.externalModel,
          updates: fixture.externalModelUpdates, type: event.type, trusted: event.isTrusted };
        fixture.submits++;
        fixture.sentTexts.push(fixture.externalModel);
        const row = document.createElement('article');
        row.className = 'message-row self';
        row.dataset.messageId = 'pm-account~pm-dot~short-external-' + fixture.submits;
        const body = document.createElement('div');
        body.className = 'message-body';
        body.textContent = fixture.externalModel;
        row.append(body);
        document.querySelector('#history').append(row);
      };
      document.querySelector('button[aria-label="Send"]').addEventListener('click', submitExternal, true);
      pm.dom.addEventListener('keydown', event => { if (event.key === 'Enter' && event.ctrlKey) submitExternal(event); }, true);
    }, stale);
    await worker.evaluate(() => {
      globalThis.originalShortExternalExecute = chrome.scripting.executeScript;
      globalThis.shortExternalCommits = [];
      chrome.scripting.executeScript = async request => {
        const frames = await originalShortExternalExecute(request);
        if (request.func?.name === 'editorCommit') shortExternalCommits.push({ world: request.world, phase: request.args[0].phase,
          result: frames.find(frame => frame.frameId === 0)?.result });
        return frames;
      };
    });
    let sending;
    try {
      await start(page, { prompt: configured, sendMethod: method, intervalMinutes: 30 });
      sending = call({ type: 'SEND_NOW' });
      await page.waitForFunction(() => fixture.submits > 0, null, { timeout: 10000 });
      const observed = await inspect(page);
      const commits = await worker.evaluate(() => shortExternalCommits);
      const state = await call({ type: 'GET_STATE' });
      console.log('SHORT MAIN EXTERNAL MODEL ' + JSON.stringify({ method, submission: observed.externalSubmission,
        sentTexts: observed.sentTexts, commits, job: { sentCount: state.job.sentCount, unknownCount: state.job.unknownCount } }));
      assert.ok(commits.some(entry => entry.world === 'MAIN' && entry.phase === 'commit' && entry.result?.dispatched === true), 'The actual MV3 MAIN commit must dispatch');
      assert.equal(observed.externalSubmission.model, configured);
      assert.equal(observed.externalSubmission.dom, configured);
      assert.equal(observed.externalSubmission.updates, 0);
      assert.deepEqual(observed.sentTexts, [stale], 'Record the independent stale model; public model readiness does not prove private synchronization');
      const outcome = await sending;
      assert.equal(outcome.job.enabled, false);
      assert.equal(outcome.job.lastResult, 'unknown');
      assert.equal(outcome.job.lastDiagnosticCode, 'receipt-mismatch');
      assert.equal(outcome.job.sentCount, 0);
      assert.equal(outcome.job.unknownCount, 1);
      assert.equal(outcome.job.prompt, configured);
      assert.deepEqual(await page.locator('#history .message-row.self .message-body').allTextContents(), [stale]);
      assert.equal(commits.filter(entry => entry.phase === 'commit').length, 1);
      assert.equal((await worker.evaluate(() => chrome.alarms.getAll())).length, 0);
      const trace = (await worker.evaluate(async () => (await chrome.storage.local.get('deliveryDiagnostics')).deliveryDiagnostics))?.at(-1);
      assert.equal(trace.state, 'unknown');
      assert.equal(trace.reason, 'receipt-mismatch');
      assert.equal(trace.counters.dispatchAttempts, 1);
      assert.equal(trace.counters.modelWrites, 1);
      assert.equal(trace.method, method);
      await new Promise(resolve => setTimeout(resolve, 500));
      assert.equal((await inspect(page)).submits, 1, 'A mismatched receipt must not cause another submission');
    } finally {
      await call({ type: 'PAUSE' });
      if (sending) await sending;
      await worker.evaluate(() => {
        chrome.scripting.executeScript = originalShortExternalExecute;
        delete globalThis.originalShortExternalExecute;
        delete globalThis.shortExternalCommits;
      });
    }
  });
  const resultCount = executedCases;
  assert.ok(resultCount > 0, 'No selected ProseMirror MV3 scenario was executed');
  console.log(`RESULT ${resultCount}/${resultCount} official ProseMirror MV3 scenarios passed`);
} finally {
  await closeBrowser();
  await fs.rm(profile, { recursive: true, force: true });
}
