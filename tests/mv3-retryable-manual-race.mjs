import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-continue-race-'));
const extension = path.join(temporary, 'extension');
const profile = path.join(temporary, 'profile');
const prompt = 'SYNTHETIC_RACE_PROMPT';
let browser;
let child;

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, `Expected one instrumentation anchor: ${before}`);
  return source.replace(before, after);
}

const html = `<!doctype html><meta charset="utf-8"><title>Synthetic Dot</title>
<main><div id="history"><article class="message-row" data-message-id="race-account~race-dot~old"><div class="message-body">Synthetic answer</div></article></div>
<div data-composer-body><div data-composer-input><div contenteditable="true" data-composer-markdown role="textbox" aria-label="Message"><p><br></p></div></div><button type="button" aria-label="Send" disabled>Send</button></div></main>
<script>
window.fixture={submits:[],clicks:[]};
const editor=document.querySelector('[contenteditable]');
function bind(button){button.addEventListener('click',event=>{
  fixture.clicks.push({trusted:event.isTrusted});
  const text=editor.innerText;
  if(!text.trim())return;
  fixture.submits.push({text,trusted:event.isTrusted});
  const row=document.createElement('article');row.className='message-row self';row.dataset.messageId='race-account~race-dot~'+fixture.submits.length;
  const body=document.createElement('div');body.className='message-body';body.textContent=text;row.append(body);document.querySelector('#history').append(row);
  editor.innerHTML='<p><br></p>';button.disabled=true;
})}
document.addEventListener('fixture-replace-button',()=>{const old=document.querySelector('button[aria-label="Send"]');const next=old.cloneNode(true);old.replaceWith(next);bind(next);fixture.replaced=true},{once:true});
editor.addEventListener('input',()=>{document.querySelector('button[aria-label="Send"]').disabled=!editor.innerText.trim()});
bind(document.querySelector('button'));
</script>`;

async function launch() {
  child = spawn(process.env.FULL_CHROMIUM_PATH || chromium.executablePath(), [
    '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-extensions-with-background-pages', '--disable-default-apps', '--disable-dev-shm-usage',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--headless=new', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chromium startup timed out')), 15000);
    let output = '';
    child.stderr.on('data', chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Chromium exited ${code}`)); });
  });
  browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
  const context = browser.contexts()[0];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'chatgpt.com' && url.pathname.startsWith('/dots/race-'))
      return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    return route.abort();
  });
  const worker = context.serviceWorkers().find(item => item.url().endsWith('/background.js'))
    || await context.waitForEvent('serviceworker', { predicate: item => item.url().endsWith('/background.js'), timeout: 15000 });
  const control = await context.newPage();
  await control.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html?view=full`);
  await control.waitForFunction(() => !document.querySelector('#check').disabled);
  return { context, worker, control };
}

async function runCase(context, worker, control, phase) {
  const page = await context.newPage();
  await page.goto(`https://chatgpt.com/dots/race-${phase}`);
  const call = message => control.evaluate(message => chrome.runtime.sendMessage(message), message);
  const tab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(item => item.url === url), page.url());
  await worker.evaluate(async ({ tabId, phase }) => {
    globalThis.raceAdmissions = [];
    globalThis.raceOriginalExecute = chrome.scripting.executeScript;
    chrome.scripting.executeScript = async request => {
      const admission = request.func?.name === 'pageAction' && request.args[0]?.mode === 'send'
        ? { runId: request.args[0].runId } : null;
      if (admission) raceAdmissions.push(admission);
      const frames = await raceOriginalExecute(request);
      if (admission) admission.result = frames.find(frame => frame.frameId === 0)?.result;
      return frames;
    };
    await raceOriginalExecute({ target: { tabId }, world: 'ISOLATED', func: phase => {
      globalThis.__racePhase = phase;
      if (phase === 'after-listeners') {
        const send = chrome.runtime.sendMessage.bind(chrome.runtime);
        globalThis.__raceChannelGate = new Promise(resolve => { globalThis.__raceChannelRelease = resolve; });
        chrome.runtime.sendMessage = async message => {
          if (message.type === 'PAGE_RESULT' && message.result?.retryable && !globalThis.__raceChannelHeld) {
            globalThis.__raceChannelHeld = true;
            await globalThis.__raceChannelGate;
          }
          return send(message);
        };
      }
      const contains = Node.prototype.contains;
      let replaced = false;
      Node.prototype.contains = function(node) {
        const result = contains.call(this, node);
        if (!replaced && result && this.matches?.('[data-composer-body]') && node.matches?.('button[aria-label="Send"]')) {
          replaced = true;
          document.dispatchEvent(new Event('fixture-replace-button'));
        }
        return result;
      };
    }, args: [phase] });
  }, { tabId: tab.id, phase });
  const started = await call({ type: 'START', tabId: tab.id, config: { prompt, intervalMinutes: 30, sendMethod: 'auto' } });
  assert.equal(started.ok, true, started.error);
  const sending = call({ type: 'SEND_NOW' });
  try {
    await page.waitForFunction(phase => document.documentElement.dataset.raceGate === phase, phase, { timeout: 15000 });
    const before = await page.evaluate(() => ({ replaced: fixture.replaced, text: document.querySelector('[contenteditable]').innerText, submits: fixture.submits.length }));
    assert.equal(before.replaced, true);
    assert.equal(before.submits, 0);
    assert.equal(await worker.evaluate(() => raceAdmissions.length), 1, 'The first admission must be the only admission at the gate');
    if (!before.text.trim()) await page.locator('[contenteditable]').fill(prompt);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const manual = await page.evaluate(() => ({ ...fixture.submits.at(-1), count: fixture.submits.length }));
    assert.equal(manual.trusted, true);
    assert.equal(manual.text, prompt);
    assert.equal(await worker.evaluate(() => raceAdmissions.length), 1, 'Manual submission must precede any second admission');
    await worker.evaluate(async tabId => raceOriginalExecute({ target: { tabId }, world: 'ISOLATED', func: () => { globalThis.__raceRelease(); globalThis.__raceChannelRelease?.(); } }), tab.id);
    let timeout;
    const outcome = await Promise.race([sending, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('SEND_NOW timed out')), 15000); })]).finally(() => clearTimeout(timeout));
    await new Promise(resolve => setTimeout(resolve, 1800));
    const admissions = await worker.evaluate(() => raceAdmissions.map(({ runId, result }) => ({ runId, status: result?.status, retryable: result?.retryable,
      dispatchAttempts: result?.diagnosticProgress?.counters?.dispatchAttempts, manualIntents: result?.diagnosticProgress?.counters?.manualIntents,
      manualPending: result?.diagnosticProgress?.observations?.manualPending })));
    const observed = await page.evaluate(() => fixture);
    const final = await call({ type: 'GET_STATE' });
    assert.equal(observed.submits.filter(item => item.trusted).length, 1);
    assert.ok(admissions.length >= 1);
    assert.equal(admissions[0].retryable, true);
    assert.ok(observed.submits.every(item => item.text === prompt));
    if (phase === 'after-listeners') {
      assert.equal(admissions.length, 2);
      assert.notEqual(admissions[0].runId, admissions[1].runId);
      assert.equal(admissions[0].manualIntents, 0);
      assert.deepEqual(observed.submits.map(item => item.trusted), [true, false]);
      assert.equal(final.job.sentCount, 1);
    } else {
      assert.equal(admissions.length, 1);
      assert.equal(admissions[0].manualIntents, 1);
      assert.deepEqual(observed.submits.map(item => item.trusted), [true]);
      assert.equal(final.job.enabled, false);
      assert.equal(final.job.unknownCount, 1);
    }
    return { phase, delayedResultChannel: phase === 'after-listeners', beforeCleanupTextPresent: Boolean(before.text.trim()), admissions: admissions.length,
      distinctRuns: new Set(admissions.map(item => item.runId)).size, results: admissions.map(({ runId, ...item }) => item),
      manualSends: observed.submits.filter(item => item.trusted).length,
      extensionSends: observed.submits.filter(item => !item.trusted).length, totalSends: observed.submits.length,
      job: { enabled: final.job.enabled, sentCount: final.job.sentCount, manualSentCount: final.job.manualSentCount,
        unknownCount: final.job.unknownCount, lastResult: final.job.lastResult }, responseOk: outcome.ok };
  } finally {
    await worker.evaluate(async tabId => raceOriginalExecute({ target: { tabId }, world: 'ISOLATED', func: () => { globalThis.__raceRelease?.(); globalThis.__raceChannelRelease?.(); } }).catch(() => {}), tab.id);
    await call({ type: 'PAUSE' }).catch(() => {});
    await sending.catch(() => {});
    await worker.evaluate(() => { chrome.scripting.executeScript = raceOriginalExecute; delete globalThis.raceOriginalExecute; });
    await page.close();
  }
}

try {
  await fs.mkdir(extension, { recursive: true });
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.isFile()) await fs.copyFile(path.join(root, entry.name), path.join(extension, entry.name));
    else if (['_locales', 'icons', 'vendor'].includes(entry.name)) await fs.cp(path.join(root, entry.name), path.join(extension, entry.name), { recursive: true });
  }
  const adapterPath = path.join(extension, 'adapter.js');
  let adapter = (await fs.readFile(adapterPath, 'utf8')).replace(/\r\n/g, '\n');
  adapter = replaceOnce(adapter, '  const action = async () => {', '  let fixtureReturned = null;\n  const action = async () => {');
  adapter = replaceOnce(adapter, "    return { status, message,\n    ...(args.persistentDelivery", "    return fixtureReturned = { status, message,\n    ...(args.persistentDelivery");
  const gate = phase => `if (fixtureReturned?.retryable && globalThis.__racePhase === '${phase}' && !globalThis.__raceHeld) { globalThis.__raceHeld = true; document.documentElement.dataset.raceGate = '${phase}'; await new Promise(resolve => { globalThis.__raceRelease = resolve; }); }`;
  adapter = replaceOnce(adapter, '  } finally {\n    await clearOwnDraft();\n    if (!manualPending', `  } finally {\n    ${gate('before-cleanup')}\n    await clearOwnDraft();\n    ${gate('after-cleanup')}\n    if (!manualPending`);
  adapter = replaceOnce(adapter, '    removeManualListeners();\n    if (cancellable)', `    removeManualListeners();\n    ${gate('after-listeners')}\n    if (cancellable)`);
  await fs.writeFile(adapterPath, adapter);
  const { context, worker, control } = await launch();
  assert.equal((await worker.evaluate(() => chrome.runtime.getManifest())).manifest_version, 3);
  for (const phase of ['before-cleanup', 'after-cleanup', 'after-listeners']) {
    const result = await runCase(context, worker, control, phase);
    process.stdout.write(JSON.stringify(result) + '\n');
  }
} finally {
  if (browser?.isConnected()) {
    const session = await browser.newBrowserCDPSession().catch(() => null);
    await session?.send('Browser.close').catch(() => {});
    await browser.close().catch(() => {});
  }
  if (child && child.exitCode === null && child.signalCode === null) {
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
