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
  manualReceiptDuringReadiness = false, ignoreButtonSubmit = false } = {}) {
  return `<!doctype html><meta charset="utf-8"><title>Official ProseMirror fixture</title>
  <style>${editorCss}body{font:16px sans-serif;padding:20px}.ProseMirror{min-height:90px;border:1px solid;padding:12px}.message-body{white-space:pre-wrap}</style>
  <main id="history"><article class="message-row" data-message-id="pm-account~pm-dot~old"><div class="message-body">Earlier synthetic response.</div></article></main>
  <div data-composer-body><div data-composer-input id="editorMount"></div>${noSend ? '' : '<button type="button" aria-label="Send" disabled>Send</button>'}</div>
  <script type="importmap">${JSON.stringify({ imports })}</script>
  <script type="module">
  import {EditorView} from 'prosemirror-view';import {EditorState} from 'prosemirror-state';
  import {schema} from 'prosemirror-schema-basic';import {keymap} from 'prosemirror-keymap';
  window.fixture={updates:0,buttonClicks:0,keyboardCommands:0,submits:0,events:[],sentTexts:[],lastKeyTrusted:null,
    modelUpdates:[],sendActivations:[],submissionStates:[],sendActivationDelayMs:${JSON.stringify(sendActivationDelayMs)}};
  const button=document.querySelector('button[aria-label="Send"]');
  let sendActivationTimer;
  const submit=method=>{
    if(method==='button' && ${JSON.stringify(ignoreButtonSubmit)})return;
    const text=window.pm.state.doc.textBetween(0,window.pm.state.doc.content.size,'\\n');
    if(!text.trim())return;
    fixture.submits++;fixture.sentTexts.push(text);
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
      if(${JSON.stringify(sendActivationDelayMs)} && button){
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
  window.pm.dom.addEventListener('keydown',event=>{fixture.lastKeyTrusted=event.isTrusted},true);
  // Only this explicit Tiptap-compatible fixture exposes a documented DOM owner.
  // The vanilla PM cases above exercise the unsupported-view event fallback.
  if (${JSON.stringify(supported)}) window.pm.dom.editor={view:window.pm};
  if (${JSON.stringify(recurringRestore)}) window.pm.dom.addEventListener('input', () => queueMicrotask(() => {
    window.pm.dispatch(window.pm.state.tr.insertText('PAGE_RESTORED_OTHER_TEXT', 0, window.pm.state.doc.content.size));
    fixture.restores = (fixture.restores || 0) + 1;
  }));
  for(const type of ['keydown','keypress','keyup'])window.pm.dom.addEventListener(type,event=>{
    fixture.events.push({type,key:event.key,code:event.code,keyCode:event.keyCode,ctrlKey:event.ctrlKey,trusted:event.isTrusted});
  });
  if(button)button.addEventListener('click',()=>{fixture.buttonClicks++;submit('button')});
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
    await page.close();
  }
}
const inspect = page => page.evaluate(() => ({ ...fixture, editorEmpty: !pm.dom.innerText.trim(), visibility: document.visibilityState }));

try {
  context = await launchBrowser();
  await context.route('https://**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'chatgpt.com' && modules.has(url.pathname)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: modules.get(url.pathname) });
    if (url.hostname === 'chatgpt.com' && url.pathname.startsWith('/dots/pm-')) {
      const index = Number(url.pathname.split('-').at(-1));
      return route.fulfill({ status: 200, contentType: 'text/html', body: fixture({
        noSend: index === 3, rejectSynthetic: [4, 6, 8, 9, 10].includes(index),
        supported: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 22, 23, 24, 25, 26].includes(index),
        sendActivationDelayMs: index === 25 ? 2500 : [11, 16].includes(index) ? 21000 : [17, 20, 21].includes(index) ? 200 : [6, 8, 9, 10, 12, 13, 14, 15].includes(index) ? 100 : 0,
        receiptDelayMs: index === 18 ? 8000 : 0,
        manualReceiptDuringReadiness: index === 9 || index === 10, ignoreButtonSubmit: index === 9,
        recurringRestore: index === 7,
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
      const sent = await call({ type: 'SEND_NOW' });
      const observed = await inspect(page);
      assert.equal(observed.finalMutation, mutation, 'The intended last-wait mutation actually occurred');
      assert.equal(sent.job.sentCount, mutation === 'text' ? 1 : 0, sent.job.statusText);
      assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [0, mutation === 'text' ? 1 : 0, mutation === 'text' ? 1 : 0]);
      assert.deepEqual(observed.sentTexts, mutation === 'text' ? [prompt] : []);
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
  console.log(`RESULT ${selectedCases ? selectedCases.length : passed}/${selectedCases ? selectedCases.length : passed} official ProseMirror MV3 scenarios passed`);
} finally {
  await closeBrowser();
  await fs.rm(profile, { recursive: true, force: true });
}
