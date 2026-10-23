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

function fixture({ noSend = false, rejectSynthetic = false } = {}) {
  return `<!doctype html><meta charset="utf-8"><title>Official ProseMirror fixture</title>
  <style>${editorCss}body{font:16px sans-serif;padding:20px}.ProseMirror{min-height:90px;border:1px solid;padding:12px}.message-body{white-space:pre-wrap}</style>
  <main id="history"><article class="message-row" data-message-id="pm-account~pm-dot~old"><div class="message-body">Earlier synthetic response.</div></article></main>
  <div data-composer-body><div data-composer-input id="editorMount"></div>${noSend ? '' : '<button type="button" aria-label="Send" disabled>Send</button>'}</div>
  <script type="importmap">${JSON.stringify({ imports })}</script>
  <script type="module">
  import {EditorView} from 'prosemirror-view';import {EditorState} from 'prosemirror-state';
  import {schema} from 'prosemirror-schema-basic';import {keymap} from 'prosemirror-keymap';
  window.fixture={updates:0,buttonClicks:0,keyboardCommands:0,submits:0,events:[],sentTexts:[],lastKeyTrusted:null};
  const button=document.querySelector('button[aria-label="Send"]');
  const submit=method=>{
    const text=window.pm.state.doc.textBetween(0,window.pm.state.doc.content.size,'\\n');
    if(!text.trim())return;
    fixture.submits++;fixture.sentTexts.push(text);
    const row=document.createElement('article');row.className='message-row self';row.dataset.messageId='pm-account~pm-dot~new-'+fixture.submits;
    const body=document.createElement('div');body.className='message-body';body.textContent=text;row.append(body);document.querySelector('#history').append(row);
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
      if(button)button.disabled=!next.doc.textContent.trim();
    }
  });
  window.pm.dom.addEventListener('keydown',event=>{fixture.lastKeyTrusted=event.isTrusted},true);
  for(const type of ['keydown','keyup'])window.pm.dom.addEventListener(type,event=>{
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
  const page = await newPage('https://chatgpt.com/dots/pm-' + (++passed));
  try {
    await page.waitForFunction(() => window.fixtureReady);
    await callback(page);
    console.log('PASS ' + name);
  } finally {
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
      return route.fulfill({ status: 200, contentType: 'text/html', body: fixture({ noSend: index === 3, rejectSynthetic: index === 4 }) });
    }
    if (url.hostname === 'pm-foreground.invalid') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><textarea id="work">Unrelated synthetic document</textarea>' });
    return route.abort();
  });
  worker = context.serviceWorkers().find(item => item.url().endsWith('/background.js'))
    || await context.waitForEvent('serviceworker', { predicate: item => item.url().endsWith('/background.js'), timeout: 15000 });
  const id = new URL(worker.url()).host;
  control = await newPage(`chrome-extension://${id}/popup.html?view=full`);
  await control.waitForFunction(() => !document.querySelector('#check').disabled);

  await scenario('Official ProseMirror default Dot keymap receives one isolated-world Ctrl+Enter, with no Send click', async page => {
    await start(page);
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
  await scenario('A trusted-event-only keymap automatically falls back to an enabled Send button and confirms submission', async page => {
    await start(page);
    const sent = await call({ type: 'SEND_NOW' });
    assert.equal(sent.ok, true, sent.error);
    assert.equal(sent.job.sentCount, 1);
    assert.equal(sent.job.lastResult, 'sent');
    const observed = await inspect(page);
    assert.deepEqual([observed.keyboardCommands, observed.buttonClicks, observed.submits], [1, 1, 1]);
    assert.equal(observed.editorEmpty, true);
  });
  await scenario('An actually hidden ProseMirror tab receives Ctrl+Enter while foreground text, selection and active tab stay unchanged', async page => {
      await start(page);
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
  console.log(`RESULT ${passed}/${passed} official ProseMirror MV3 scenarios passed`);
} finally {
  await closeBrowser();
  await fs.rm(profile, { recursive: true, force: true });
}
