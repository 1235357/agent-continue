import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.EXTENSION_ROOT || path.dirname(here));
const { pageAction } = await import(pathToFileURL(path.join(root, 'adapter.js')));
const { DEFAULT_CONFIG } = await import(pathToFileURL(path.join(root, 'config.js')));
const { buildActivityExport } = await import(pathToFileURL(path.join(root, 'activity-export.js')));
const playwright = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE_PATH)).href)
  : await import('playwright');

const dotUrl = 'https://chatgpt.com/dots/home';
const chatUrl = 'https://chatgpt.com/c/synthetic-approval-test';
const prompt = '## 3. 文档产品：忠实镜像，原位修订，表格直达';

const dotFixture = `<!doctype html><html><head><meta charset="utf-8"><style>
body { font: 16px sans-serif; padding: 20px; }
[contenteditable] { min-height: 80px; border: 1px solid #555; }
.pill { display: inline-flex; gap: 8px; padding: 8px 14px; border-radius: 999px; cursor: pointer; margin: 4px 0; }
</style></head><body>
<main id="conversation">
  <article class="message-row self" data-message-id="acct~dot~Msg~u1"><div class="message-body" data-message-id="acct~dot~Msg~u1">Earlier user request</div></article>
  <article class="message-row" data-message-id="acct~dot~Msg~a1">
    <div class="message-body" data-message-id="acct~dot~Msg~a1">
      <p>${'长段落进度汇报内容。'.repeat(350)}</p>
      <div id="approval-card">
        <p>Your scheduled task "求职进度与阻塞督办" wants to read messages. Allow ChatGPT to use user_message_read?</p>
        <div><div><div><div><div><div>
          <div id="options-group">
            <button type="button" id="opt-allow" class="pill"><span>A</span><span>Allow</span></button>
            <button type="button" id="opt-deny" class="pill"><span>B</span><span>Deny</span></button>
          </div>
        </div></div></div></div></div></div>
      </div>
    </div>
  </article>
</main>
<div data-composer-root><div data-composer-body><div data-composer-input><div data-composer-markdown contenteditable="true" role="textbox" aria-label="Message"></div></div><button type="button" aria-label="Send" disabled>Send</button></div></div>
<script>
window.fixture = { allowClicks: 0, denyClicks: 0, composerInputs: 0, sends: 0 };
const editor = document.querySelector('[data-composer-markdown]');
const send = document.querySelector('button[aria-label="Send"]');
editor.addEventListener('input', () => {
  window.fixture.composerInputs++;
  send.disabled = !editor.innerText.trim();
});
send.addEventListener('click', () => {
  window.fixture.sends++;
});
document.getElementById('opt-allow').addEventListener('click', function () {
  window.fixture.allowClicks++;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  this.appendChild(svg);
});
document.getElementById('opt-deny').addEventListener('click', function () {
  window.fixture.denyClicks++;
});
window.chrome = {
  runtime: {
    sendMessage: async msg => {
      if (msg.type === 'CHECK_RUN') return { ok: true, allowed: true, runDeadline: Date.now() + 20000 };
      return { ok: true };
    }
  }
};
</script></body></html>`;


test('Dot probes are read-only, then ordinary readiness returns after a human responds', async () => {
  const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH || undefined });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: dotFixture }));
    const page = await context.newPage();
    await page.goto(dotUrl);
    const base = { expectedUrl: dotUrl, targetIdentity: 'acct~dot', prompt, sendMethod: 'auto',
      persistentDelivery: true, unlimitedReadiness: true, runId: 'synthetic-id', runDeadline: Date.now() + 20000 };
    for (const mode of ['check', 'send', 'check']) {
      const outcome = await page.evaluate(pageAction, { ...base, mode });
      assert.equal(outcome.status, 'busy');
      assert.equal(outcome.diagnosticCode, 'approval-required');
      assert.notEqual(outcome.retryable, true);
    }
    assert.deepEqual(await page.evaluate(() => window.fixture),
      { allowClicks: 0, denyClicks: 0, composerInputs: 0, sends: 0 });
    assert.equal(await page.locator('[data-agent-continue-allowed], [data-agent-continue-target-allow]').count(), 0);
    await page.locator('#opt-allow').click();
    assert.equal((await page.evaluate(pageAction, { ...base, mode: 'check' })).status, 'ready');
    assert.equal(await page.evaluate(() => window.fixture.allowClicks), 1);

    await page.evaluate(() => {
      const pause = document.createElement('button');
      pause.dataset.testid = 'dot-paused';
      pause.textContent = 'Paused';
      document.body.append(pause);
    });
    for (const hasComposer of [true, false]) {
      if (!hasComposer) await page.locator('[data-composer-root]').evaluate(node => node.remove());
      const outcome = await page.evaluate(pageAction, { ...base, mode: 'send', waitForIdle: false });
      assert.equal(outcome.status, 'busy');
      assert.equal(outcome.diagnosticCode, 'agent-paused');
      assert.equal(outcome.diagnosticProgress.counters.dispatchAttempts, 0);
    }
    await page.getByText('Paused', { exact: true }).evaluate(node => node.remove());
    assert.equal((await page.evaluate(pageAction, { ...base, mode: 'send' })).diagnosticCode, 'composer-unavailable');
    assert.equal(await page.evaluate(() => window.fixture.composerInputs), 0);
    assert.equal(await page.evaluate(() => window.fixture.sends), 0);
  } finally { await browser.close(); }
});

test('ordinary ChatGPT approval and OAuth controls are not triggered by DOM or framework callbacks', async () => {
  const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH || undefined });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html>
      <main><div role="dialog" id="approval"><p>Authorize ChatGPT to use the selected workspace</p>
      <button id="always">Always allow</button><button id="once">Allow once</button><button>Deny</button></div>
      <form data-chatgpt-composer><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form>
      </main>` }));
    const page = await context.newPage();
    await page.goto(chatUrl);
    await page.evaluate(() => {
      window.fixture = { clicks: 0, framework: 0, inputs: 0 };
      for (const button of document.querySelectorAll('button')) {
        button.addEventListener('click', () => window.fixture.clicks++);
        button.__reactProps$fixture = { onClick: () => window.fixture.framework++ };
      }
      document.querySelector('textarea').addEventListener('input', () => window.fixture.inputs++);
    });
    const base = { expectedUrl: chatUrl, mode: 'check', sendMethod: 'auto', prompt, stopMarkers: [] };
    assert.equal((await page.evaluate(pageAction, base)).diagnosticCode, 'approval-required');
    await page.locator('#approval').evaluate(dialog => {
      dialog.innerHTML = '<p>Sign in to your account to continue</p><button>Authorize</button>';
      dialog.querySelector('button').addEventListener('click', () => window.fixture.clicks++);
    });
    assert.equal((await page.evaluate(pageAction, base)).diagnosticCode, 'approval-required');
    assert.deepEqual(await page.evaluate(() => window.fixture), { clicks: 0, framework: 0, inputs: 0 });
  } finally { await browser.close(); }
});

test('worker waits without dispatching and rejects stale approval messages', async () => {
  const state = {
    session: {},
    local: {},
    alarms: new Map(),
    tabs: new Map([[7, { id: 7, url: dotUrl, title: 'Your dot', active: true, autoDiscardable: true }]]),
    injections: [],
  };
  const area = name => ({
    async get(key) { return Object.fromEntries((Array.isArray(key) ? key : [key]).map(item => [item, structuredClone(state[name][item])])); },
    async set(value) { Object.assign(state[name], structuredClone(value)); },
    async remove(key) { for (const item of Array.isArray(key) ? key : [key]) delete state[name][item]; },
    async setAccessLevel() {},
  });
  let mockPromptPending = true;
  const listeners = [];
  globalThis.chrome = {
    storage: { session: area('session'), local: area('local'), onChanged: { addListener() {} } },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setTitle() {} },
    alarms: {
      async get(name) { return state.alarms.get(name); },
      async clear(name) { return state.alarms.delete(name); },
      async create(name, value) { state.alarms.set(name, { name, ...value }); },
      onAlarm: { addListener() {} },
    },
    permissions: { async contains() { return false; } },
    power: { requestKeepAwake() {}, releaseKeepAwake() {} },
    tabs: {
      async query() { return [...state.tabs.values()].map(t => structuredClone(t)); },
      async get(id) { return structuredClone(state.tabs.get(id)); },
      async sendMessage(id, message) { return { revoked: true, runId: message.runId, resultToken: message.resultToken }; },
      async update(id, update) { Object.assign(state.tabs.get(id), update); return structuredClone(state.tabs.get(id)); },
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} },
    },
    scripting: {
      async executeScript(request) {
        state.injections.push(request);
        if (mockPromptPending) {
          return [{
            frameId: 0,
            result: {
              status: 'busy',
              message: 'Approval required',
              diagnosticCode: 'approval-required',
              identity: 'acct~dot',
              assistantToken: 'acct~dot~Msg~a1',
              assistantCount: 1,
            },
          }];
        }
        return [{
          frameId: 0,
          result: {
            status: request.args[0]?.mode === 'check' ? 'ready' : 'sent',
            message: 'Sent',
            identity: 'acct~dot',
            assistantToken: 'acct~dot~Msg~a2',
            assistantCount: 2,
          },
        }];
      },
    },
    runtime: {
      id: 'synthetic-extension',
      getURL: name => 'chrome-extension://synthetic/' + name,
      onMessage: { addListener(fn) { listeners.push(fn); } },
      onStartup: { addListener() {} },
      async sendMessage() {},
    },
    commands: { onCommand: { addListener() {} } },
  };

  await import(pathToFileURL(path.join(root, 'background.js')).href + '?test=manual-approval');
  const sendMsg = (msg, sender = { id: 'synthetic-extension', url: 'chrome-extension://synthetic/popup.html' }) =>
    new Promise(resolve => listeners[0](msg, sender, resolve));

  const reserved = await sendMsg({ type: 'PREPARE_START' });
  assert.equal(reserved.ok, true);
  const startRes = await sendMsg({
    type: 'START', startToken: reserved.startToken, tabId: 7,
    config: { ...DEFAULT_CONFIG, prompt: 'Continue working', startImmediately: true },
  });
  assert.equal(startRes.ok, true);
  assert.equal(startRes.job.enabled, true);
  assert.equal(startRes.job.needsAttention, true);
  assert.equal(startRes.job.sentCount, 0);
  assert.ok(startRes.job.nextAt > Date.now());
  assert.equal(state.injections.filter(i => i.args?.[0]?.mode === 'send').length, 0);
  assert.ok(state.local.logs.some(e => e.event === 'busy' && e.diagnostic?.code === 'approval-required'));

  const bound = { id: 'synthetic-extension', tab: { id: 7, url: dotUrl }, frameId: 0, url: dotUrl };
  const before = state.injections.length;
  for (const type of ['AUTO_ALLOW_CLICK', 'APPROVAL_PROMPT_OBSERVED']) {
    assert.equal((await sendMsg({ type, token: 'stale' }, bound)).ok, false);
  }
  for (const sender of [{ ...bound, frameId: 1 }, { ...bound, tab: { id: 8, url: dotUrl } },
    { ...bound, url: chatUrl }, { ...bound, tab: { ...bound.tab, url: chatUrl } }]) {
    assert.equal((await sendMsg({ type: 'DIALOG_EXCEPTION', kind: 'oauth-popup' }, sender)).ok, false);
  }
  assert.equal((await sendMsg({ type: 'DIALOG_EXCEPTION', kind: 'unrecognized' }, bound)).ok, false);
  assert.equal(state.injections.length, before, 'legacy IPC must not trigger script injection');
  assert.equal((await sendMsg({ type: 'DIALOG_EXCEPTION', kind: 'unknown-modal', evidence: ['private page text'] }, bound)).ok, true);
  const exported = buildActivityExport({ logs: state.local.logs });
  assert.ok(exported.logs.some(e => e.event === 'exception-detected'));
  assert.ok(exported.logs.some(e => e.event === 'busy' && e.diagnostic?.code === 'approval-required'));
  assert.doesNotMatch(JSON.stringify(exported), /private page text|Continue working/i);
  assert.equal((await sendMsg({ type: 'GET_STATE' })).job.enabled, true);
  assert.equal((await sendMsg({ type: 'DIALOG_EXCEPTION', kind: 'oauth-popup' }, bound)).ok, true);
  assert.equal((await sendMsg({ type: 'GET_STATE' })).job.enabled, false);
});
