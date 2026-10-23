// Real MV3 extension APIs in an isolated throwaway Chromium profile. All chat
// pages are intercepted synthetic fixtures; no signed-in browser or user file.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.EXTENSION_ROOT || path.dirname(here));
const playwright = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE_PATH)).href)
  : await import('playwright');
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-continue-mv3-'));
const chromePath = process.env.FULL_CHROMIUM_PATH || undefined;
const headed = process.env.TEST_HEADED === '1';
const sentinel = 'MV3_SYNTHETIC_PROMPT\nContinue the local fixture only.';
const checks = [];
let context;
let browser;
let browserProcess;
const pass = name => { checks.push(name); console.log('PASS ' + name); };
// Chromium exposes rich-text paragraph boundaries as double innerText line breaks.
// Config is checked verbatim; rendered-message assertions normalize that layout.
const renderedText = value => value.replace(/\r\n?/g, '\n').replace(/\n{2,}/g, '\n').trim();

function chatFixture(dot) {
  const history = dot
    ? '<article class="message-row self" data-message-id="test-user~test-thread~1"><div class="message-body">Synthetic task.</div></article><article class="message-row" data-message-id="test-user~test-thread~2"><div class="message-body">Synthetic answer.</div></article>'
    : '<div data-message-author-role="user">Synthetic task.</div><div data-message-author-role="assistant">Synthetic answer.</div>';
  const editor = dot
    ? '<div data-composer-input><div id="editor" data-composer-markdown contenteditable="true" role="textbox" aria-label="Message"><p><br></p></div></div>'
    : '<div id="prompt-textarea" contenteditable="true" role="textbox" aria-label="Message"><p><br></p></div>';
  return `<!doctype html><meta charset="utf-8"><title>${dot ? 'Your dot' : 'Synthetic ChatGPT'}</title><style>body{padding:20px;font:16px sans-serif}[contenteditable]{min-height:70px;border:1px solid;padding:10px}.message-body,[data-message-author-role]{white-space:pre-wrap}</style><main><div id="history">${history}</div><form data-composer-root>${editor}<button type="button" aria-label="Send" disabled>Send</button></form></main><script>
  const dot=${JSON.stringify(dot)};
  const editor=document.querySelector('[contenteditable]');
  const send=document.querySelector('button[aria-label="Send"]');
  window.fixture={sendClicks:0,keyboardSends:0,submits:0,keyEvents:[],sentTexts:[],focusCalls:0};
  window.focus=()=>{fixture.focusCalls++};
  editor.addEventListener('input',()=>{send.disabled=!editor.innerText.trim()});
  const submit=method=>{
    const text=editor.innerText;
    if(method==='button')fixture.sendClicks++;else fixture.keyboardSends++;
    if(!text.trim())return;
    fixture.submits++;fixture.sentTexts.push(text);
    const row=document.createElement(dot?'article':'div');
    if(dot){row.className='message-row self';row.dataset.messageId='test-user~test-thread~'+(fixture.submits+2);const body=document.createElement('div');body.className='message-body';body.textContent=text;row.append(body)}
    else{row.dataset.messageAuthorRole='user';row.textContent=text}
    document.querySelector('#history').append(row);editor.replaceChildren(document.createElement('p'));send.disabled=true;
  };
  send.addEventListener('click',()=>submit('button'));
  if(dot)for(const type of ['keydown','keyup'])editor.addEventListener(type,event=>{
    fixture.keyEvents.push({type,key:event.key,code:event.code,keyCode:event.keyCode,ctrlKey:event.ctrlKey,trusted:event.isTrusted});
    if(type==='keydown'&&event.key==='Enter'&&event.ctrlKey&&!event.altKey&&!event.metaKey&&!event.shiftKey&&!event.repeat){event.preventDefault();submit('keyboard')}
  });
  </script>`;
}
// Models the failure boundary that a plain contenteditable fixture misses:
// the page's submission model changes only through a handled beforeinput event.
// While busy, Stop occupies Send's place and replaces the composer after stopping.
function controlledDotFixture(busy) {
  return `<!doctype html><meta charset="utf-8"><title>Your dot controlled fixture</title>
  <style>body{padding:20px;font:16px sans-serif}[contenteditable]{min-height:70px;border:1px solid;padding:10px}.message-body,[contenteditable] p{white-space:pre-wrap}</style>
  <main><div id="history"><article class="message-row self" data-message-id="test-user~test-thread~1"><div class="message-body">Synthetic task.</div></article><article class="message-row" data-message-id="test-user~test-thread~2"><div class="message-body">Synthetic answer.</div></article></div><div id="composerMount"></div><aside><button id="unrelated-stop" aria-label="Stop response">Unrelated stop</button></aside></main>
  <script>
  window.fixture={sendClicks:0,stopClicks:0,unrelatedStopClicks:0,beforeInputs:0,sentTexts:[],focusCalls:0,mounts:0,order:[]};
  window.focus=()=>{fixture.focusCalls++};
  document.querySelector('#unrelated-stop').addEventListener('click',()=>{fixture.unrelatedStopClicks++});
  function mount(busy){
    const form=document.createElement('form');form.dataset.composerRoot='';
    form.innerHTML='<div data-composer-input><div id="controlled-editor" data-composer-markdown contenteditable="true" role="textbox" aria-label="Message"><p><br></p></div></div>';
    const editor=form.querySelector('[contenteditable]');
    const button=document.createElement('button');button.type='button';
    button.setAttribute('aria-label',busy?'Stop response':'Send');button.textContent=busy?'Stop':'Send';button.disabled=!busy;
    form.append(button);document.querySelector('#composerMount').replaceChildren(form);fixture.mounts++;
    if(busy){
      const typing=document.createElement('span');typing.className='typing-indicator';typing.textContent='Synthetic work in progress';form.append(typing);
      button.addEventListener('click',()=>{fixture.stopClicks++;fixture.order.push('stop');setTimeout(()=>mount(false),40)});
      return;
    }
    let model='';
    editor.addEventListener('beforeinput',event=>{
      event.preventDefault();fixture.beforeInputs++;fixture.order.push('beforeinput');
      model=event.inputType==='deleteContentBackward'?'':String(event.data||'');
      const paragraph=document.createElement('p');paragraph.textContent=model;editor.replaceChildren(paragraph);button.disabled=!model.trim();
    });
    button.addEventListener('click',()=>{
      if(!model.trim())return;
      fixture.sendClicks++;fixture.order.push('send');fixture.sentTexts.push(model);
      const row=document.createElement('article');row.className='message-row self';row.dataset.messageId='test-user~test-thread~'+(fixture.sendClicks+2);
      const body=document.createElement('div');body.className='message-body';body.textContent=model;row.append(body);document.querySelector('#history').append(row);
      model='';editor.replaceChildren(document.createElement('p'));button.disabled=true;
    });
  }
  mount(${JSON.stringify(busy)});
  </script>`;
}
const workFixture = '<!doctype html><title>Unrelated work</title><textarea id="work">Ordinary document, keep my cursor here.</textarea><button id="other">Other</button>';
function syntheticPdf(text) {
  const stream = `BT /F1 12 Tf 30 80 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 120] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let output = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(output); output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) output += String(offset).padStart(10, '0') + ' 00000 n \n';
  return Buffer.from(output + `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`);
}
async function launch() {
  // Playwright's launch path enables focus emulation in its own CDP session.
  // Sending false from a second session cannot release that session's capture
  // handle, which keeps inactive tabs visible. The public noDefaults option
  // prevents this override at its source; normal browser visibility is retained.
  browserProcess = spawn(chromePath || playwright.chromium.executablePath(), [
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
  const launched = browser.contexts()[0];
  await launched.route('https://**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'chatgpt.com' && ['/dots/mv3-interrupt', '/dots/mv3-controlled'].includes(url.pathname)) return route.fulfill({ status: 200, contentType: 'text/html', body: controlledDotFixture(url.pathname.endsWith('interrupt')) });
    if (url.hostname === 'chatgpt.com' && /^\/dots\//.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'text/html', body: chatFixture(true) });
    if (url.hostname === 'chatgpt.com' && /^\/c\//.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'text/html', body: chatFixture(false) });
    if (url.hostname === 'unrelated-work.invalid') return route.fulfill({ status: 200, contentType: 'text/html', body: workFixture });
    return route.abort();
  });
  const worker = launched.serviceWorkers().find(item => item.url().endsWith('/background.js'))
    || await launched.waitForEvent('serviceworker', { predicate: item => item.url().endsWith('/background.js'), timeout: 15000 });
  const id = new URL(worker.url()).host;
  const control = await newTestPage(launched);
  await control.goto(`chrome-extension://${id}/popup.html?view=full`);
  await control.waitForFunction(() => !document.querySelector('#check').disabled, null, { timeout: 15000 });
  return { context: launched, worker, id, control };
}
async function newTestPage(browserContext) {
  return browserContext.newPage();
}
async function closeBrowser() {
  const child = browserProcess;
  if (!child) return;
  if (!child.pid) { browserProcess = null; return; }
  const exited = new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', resolve);
  });
  // Browser.close acknowledges the request before the process has finished
  // saving its profile. Do not interrupt that normal exit with an immediate
  // SIGTERM: headed Chromium can then treat the next start as crash recovery.
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  if (browser?.isConnected()) {
    const session = await browser.newBrowserCDPSession();
    await session.send('Browser.close').catch(() => {});
    await browser.close().catch(() => {});
  } else if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await exited; clearTimeout(timeout);
  browser = null; browserProcess = null;
}
const call = (page, message) => page.evaluate(message => chrome.runtime.sendMessage(message), message);
const state = page => call(page, { type: 'GET_STATE' });
const workerTab = (worker, url) => worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url), url);
async function recoveryDiagnostics(worker, control) {
  const current = await state(control);
  const { tabId, url, targetIdentity, lastResult, statusText } = current.job || {};
  const tabs = await worker.evaluate(async () => (await chrome.tabs.query({}))
    .map(({ id, windowId, url, pendingUrl, status, active }) => ({ id, windowId, url, pendingUrl, status, active })));
  const pages = await Promise.all(context.pages().filter(page => page.url().startsWith('https://chatgpt.com/')).map(page => page.evaluate(() => {
    const last = [...document.querySelectorAll('article.message-row')].at(-1);
    return { url: location.href, readyState: document.readyState, identity: last?.dataset.messageId?.split('~').slice(0, 2).join('~') || null };
  })));
  // This profile contains intercepted synthetic fixtures only. Never log a
  // prompt, editor contents or chat message body even when a test fails.
  return { browser: browser?.version(), job: { tabId, url, targetIdentity, lastResult, statusText }, tabs, pages };
}

try {
  let session = await launch(); context = session.context;
  let { worker, control, id } = session;
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, ['https://chatgpt.com/*']);
  assert.equal((await state(control)).ok, true, 'Full extension page must pass sender authorization.');
  pass('Real extension: manifest/service worker load and full-control-page runtime messages are authorized.');

  const dot = await newTestPage(context); await dot.goto('https://chatgpt.com/dots/home');
  const ordinary = await newTestPage(context); await ordinary.goto('https://chatgpt.com/c/mv3-fixture');
  const dotTab = await workerTab(worker, dot.url());
  const originalDiscard = dotTab.autoDiscardable;
  assert.ok(Number.isInteger(dotTab.id));
  await control.bringToFront(); await control.reload(); await control.waitForFunction(() => !document.querySelector('#check').disabled);
  await control.locator('#tab-prompt').click();
  await control.locator('#promptFile').setInputFiles({ name: 'synthetic-only.txt', mimeType: 'text/plain', buffer: Buffer.from(sentinel) });
  await control.waitForFunction(async expected => (await chrome.storage.local.get('config')).config?.prompt === expected, sentinel);
  assert.equal(await control.locator('#prompt').inputValue(), '');
  await control.locator('#tab-task').click();
  await control.locator('#targetSelect').selectOption(String(dotTab.id));
  await control.locator('#check').click();
  await control.waitForFunction(() => document.querySelector('#feedback').textContent.includes('已识别'));
  assert.deepEqual(await dot.evaluate(() => [fixture.sendClicks, fixture.keyboardSends]), [0, 0]);
  await control.locator('#start').click();
  await control.waitForFunction(() => document.querySelector('#badge').textContent === '运行中');
  const started = await state(control);
  assert.equal(started.job.tabId, dotTab.id); assert.equal(started.job.prompt, sentinel); assert.equal(started.job.intervalMinutes, 20);
  assert.equal(started.job.maxSends, 0); assert.deepEqual(started.job.stopMarkers, []);
  assert.equal((await workerTab(worker, dot.url())).autoDiscardable, false);
  assert.ok((await worker.evaluate(() => chrome.alarms.getAll())).length > 0);
  pass('Actual controls: local TXT import, no-send self-check and Start bind dot, create alarms and prevent discarding.');

  const work = await newTestPage(context); await work.goto('https://unrelated-work.invalid/'); await work.bringToFront();
  await work.locator('#work').focus();
  await work.locator('#work').evaluate(element => element.setSelectionRange(9, 17));
  const before = await work.evaluate(() => ({ value: document.querySelector('#work').value, start: document.querySelector('#work').selectionStart, end: document.querySelector('#work').selectionEnd, focus: document.activeElement.id }));
  const foregroundTab = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]);
  const activeBefore = foregroundTab.id;
  const hiddenTab = await workerTab(worker, dot.url());
  assert.equal(hiddenTab.windowId, foregroundTab.windowId, 'Target and foreground must be tabs of the same browser window');
  assert.equal(hiddenTab.active, false);
  await dot.waitForFunction(() => document.visibilityState === 'hidden', null, { polling: 50, timeout: 3000 });
  assert.equal(await dot.evaluate(() => document.visibilityState), 'hidden', 'The target must actually be hidden without any visibility override');
  const sent = await call(control, { type: 'SEND_NOW' });
  assert.equal(sent.ok, true, sent.error); assert.equal(sent.job.sentCount, 1, sent.job.statusText);
  assert.deepEqual(await dot.evaluate(() => [fixture.sendClicks, fixture.keyboardSends, fixture.submits]), [0, 1, 1], 'Default Dot submission must use Ctrl+Enter exactly once and never click Send');
  const keys = await dot.evaluate(() => fixture.keyEvents.filter(event => event.key === 'Enter'));
  assert.deepEqual(keys.map(event => [event.type, event.code, event.keyCode, event.ctrlKey, event.trusted]), [['keydown', 'Enter', 13, true, false], ['keyup', 'Enter', 13, true, false]]);
  assert.equal(renderedText(await dot.evaluate(() => fixture.sentTexts[0])), renderedText(sentinel));
  assert.equal(await ordinary.evaluate(() => fixture.sendClicks), 0);
  assert.deepEqual(await work.evaluate(() => ({ value: document.querySelector('#work').value, start: document.querySelector('#work').selectionStart, end: document.querySelector('#work').selectionEnd, focus: document.activeElement.id })), before);
  assert.equal(await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id), activeBefore);
  assert.equal(await dot.evaluate(() => document.visibilityState), 'hidden');
  assert.equal(await dot.evaluate(() => fixture.focusCalls), 0);
  pass('Real hidden-tab Ctrl+Enter: one dot message confirmed without any Send click; foreground tab, text, selection and focus remain unchanged.');

  const paused = await call(control, { type: 'PAUSE' });
  assert.equal(paused.ok, true); assert.equal(paused.job.enabled, false);
  assert.equal((await worker.evaluate(() => chrome.alarms.getAll())).length, 0);
  assert.equal((await workerTab(worker, dot.url())).autoDiscardable, originalDiscard);
  assert.equal((await call(control, { type: 'SEND_NOW' })).ok, false);
  pass('Pause: actual alarms are removed, original autoDiscardable is restored and Send Now is rejected.');

  for (const busy of [true, false]) {
    const controlled = await newTestPage(context);
    await controlled.goto('https://chatgpt.com/dots/' + (busy ? 'mv3-interrupt' : 'mv3-controlled'));
    const controlledTab = await workerTab(worker, controlled.url());
    const controlledPrompt = 'MV3_CONTROLLED_SYNTHETIC\nOne confirmed message only.';
    // Omit waitForIdle so this exercises the public default through readConfig,
    // storage, runRound and a real isolated-world chrome.scripting invocation.
    const controlledStart = await call(control, { type: 'START', tabId: controlledTab.id, config: { prompt: controlledPrompt, sendMethod: 'button' } });
    assert.equal(controlledStart.ok, true, controlledStart.error);
    assert.equal(controlledStart.job.waitForIdle, false);
    assert.deepEqual(await controlled.evaluate(() => ({ stop: fixture.stopClicks, send: fixture.sendClicks, beforeinput: fixture.beforeInputs })), { stop: 0, send: 0, beforeinput: 0 }, 'Binding remains a read-only self-check');
    await work.bringToFront(); await work.locator('#work').focus();
    await work.locator('#work').evaluate(element => element.setSelectionRange(9, 17));
    const foreground = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
    const controlledSend = await call(control, { type: 'SEND_NOW' });
    assert.equal(controlledSend.ok, true, controlledSend.error);
    assert.equal(controlledSend.job.sentCount, 1, controlledSend.job.statusText);
    const observed = await controlled.evaluate(() => fixture);
    assert.equal(observed.stopClicks, busy ? 1 : 0);
    assert.equal(observed.mounts, busy ? 2 : 1, 'Stop must replace the original composer');
    assert.equal(observed.unrelatedStopClicks, 0, 'Only the selected composer can be interrupted');
    assert.equal(observed.beforeInputs, 1, 'The page model must receive one controlled editing transaction');
    assert.equal(observed.sendClicks, 1);
    assert.deepEqual(observed.sentTexts, [controlledPrompt]);
    assert.deepEqual(observed.order, busy ? ['stop', 'beforeinput', 'send'] : ['beforeinput', 'send']);
    assert.equal(observed.focusCalls, 0);
    assert.equal(await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id), foreground);
    assert.deepEqual(await work.evaluate(() => ({ value: document.querySelector('#work').value, start: document.querySelector('#work').selectionStart, end: document.querySelector('#work').selectionEnd, focus: document.activeElement.id })), before);
    await call(control, { type: 'PAUSE' });
    await controlled.close();
    pass(busy
      ? 'Real default interrupt: scoped Stop remounts the composer, controlled input submits exactly once, and foreground work stays unchanged.'
      : 'Real isolated-world editing: beforeinput updates the controlled page model and confirms one send without foreground focus changes.');
  }

  await control.bringToFront(); await control.locator('#tab-prompt').click();
  const pdfText = 'MV3_LOCAL_PDF_SYNTHETIC';
  const pageErrors = []; control.on('pageerror', error => pageErrors.push(error.message));
  await control.locator('#promptFile').setInputFiles({ name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: syntheticPdf(pdfText) });
  await control.waitForFunction(async expected => (await chrome.storage.local.get('config')).config?.prompt === expected, pdfText, { timeout: 25000 });
  assert.equal(await control.locator('#prompt').inputValue(), '');
  assert.deepEqual(pageErrors, []);
  pass('Real extension CSP: bundled PDF.js worker extracts a synthetic PDF locally without exposing its text in the UI.');

  const ordinaryTab = await workerTab(worker, ordinary.url());
  const config = (await state(control)).config;
  const ordinaryStart = await call(control, { type: 'START', tabId: ordinaryTab.id, config: { ...config, prompt: 'MV3_STANDARD_SYNTHETIC' } });
  assert.equal(ordinaryStart.ok, true, ordinaryStart.error);
  const ordinarySend = await call(control, { type: 'SEND_NOW' });
  assert.equal(ordinarySend.ok, true); assert.equal(ordinarySend.job.sentCount, 1, ordinarySend.job.statusText);
  assert.equal(await ordinary.evaluate(() => fixture.sentTexts[0]), 'MV3_STANDARD_SYNTHETIC');
  pass('Standard ChatGPT: exact target routing and actual isolated-world send also work with the ordinary composer fixture.');

  const restartStart = await call(control, { type: 'START', tabId: dotTab.id, config: { ...config, prompt: sentinel } });
  assert.equal(restartStart.ok, true);
  const oldJobId = restartStart.job.id;
  const oldTabId = restartStart.job.tabId;
  // Closing the entire browser clears session storage, unlike worker suspension.
  await closeBrowser(); context = null;
  session = await launch(); context = session.context; worker = session.worker; control = session.control;
  assert.equal(session.id, id);
  try {
    const restored = await state(control);
    assert.equal(restored.job.id, oldJobId); assert.equal(restored.job.enabled, true);
    assert.equal(restored.job.tabId, null, 'Browser restart must not trust a previous session tab ID.');
    assert.equal(restored.job.prompt, sentinel);
    // This scenario deliberately tests recovery while the original page is
    // closed. Chromium may restore its previous tabs during startup; close only
    // pages in this disposable test profile before establishing that precondition.
    const startupTargets = await worker.evaluate(async url => (await chrome.tabs.query({})).filter(tab => tab.url === url || tab.pendingUrl === url)
      .map(({ id, windowId, url, pendingUrl, status }) => ({ id, windowId, url, pendingUrl, status })), restored.job.url);
    if (startupTargets.length) console.log('INFO Synthetic tabs restored by Chromium before the closed-target scenario: ' + JSON.stringify(startupTargets));
    for (const page of context.pages()) if (page !== control) await page.close();
    assert.equal((await worker.evaluate(async url => (await chrome.tabs.query({})).filter(tab => tab.url === url || tab.pendingUrl === url).length, restored.job.url)), 0,
      'The original target must be closed before testing the missing-page recovery state');
    const wrong = await newTestPage(context); await wrong.goto('https://chatgpt.com/c/wrong-target');
    const waiting = await call(control, { type: 'SEND_NOW' });
    assert.equal(waiting.ok, true); assert.equal(waiting.job.enabled, true);
    assert.equal(waiting.job.tabId, null, 'A missing target must remain unbound rather than selecting a restored or unrelated tab');
    assert.equal(waiting.job.lastResult, 'busy');
    assert.equal(waiting.job.sentCount, 0);
    assert.equal(await wrong.evaluate(() => fixture.sendClicks), 0);
    const restoredDot = await newTestPage(context); await restoredDot.goto('https://chatgpt.com/dots/home');
    await control.waitForFunction(async url => (await chrome.tabs.query({ url: 'https://chatgpt.com/*' }))
      .some(tab => tab.url === url && tab.status === 'complete'), restoredDot.url(), { polling: 50, timeout: 5000 });
    const restoredTab = await workerTab(worker, restoredDot.url());
    assert.equal(restoredTab.status, 'complete');
    assert.equal((await worker.evaluate(async url => (await chrome.tabs.query({})).filter(tab => tab.url === url).length, restoredDot.url())), 1,
      'The reopened target must be unique');
    assert.equal(await restoredDot.evaluate(() => [...document.querySelectorAll('article.message-row')].at(-1)?.dataset.messageId?.split('~').slice(0, 2).join('~')), restored.job.targetIdentity,
      'The reopened synthetic conversation must match the saved identity');
    const resumedSend = await call(control, { type: 'SEND_NOW' });
    assert.equal(resumedSend.ok, true); assert.equal(resumedSend.job.sentCount, 1, resumedSend.job.statusText);
    assert.equal(resumedSend.job.tabId, restoredTab.id);
    assert.equal(renderedText(await restoredDot.evaluate(() => fixture.sentTexts[0])), renderedText(sentinel));
    assert.equal(await wrong.evaluate(() => fixture.sendClicks), 0);
    assert.ok(resumedSend.job.tabId !== oldTabId || restored.job.tabId === null);
    await call(control, { type: 'PAUSE' });
    pass('Real browser restart: persisted enabled job ignores stale tab ID, waits for its exact page and resumes without sending to another conversation.');
  } catch (error) {
    try { console.error('Synthetic restart diagnostics: ' + JSON.stringify(await recoveryDiagnostics(worker, control))); }
    catch { console.error('Synthetic restart diagnostics were unavailable.'); }
    throw error;
  }
  console.log(`\n${checks.length}/${checks.length} MV3 integration scenarios passed.`);
} finally {
  await closeBrowser();
  await fs.rm(profile, { recursive: true, force: true });
}
