import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.EXTENSION_ROOT || path.dirname(here));
const { pageAction, mainWorldAutoAllowClick } = await import(pathToFileURL(path.join(root, 'adapter.js')));
const { buildActivityExport } = await import(pathToFileURL(path.join(root, 'activity-export.js')));
const { DEFAULT_CONFIG, readConfig, currentPrompt } = await import(pathToFileURL(path.join(root, 'config.js')));
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
      if (msg.type === 'AUTO_ALLOW_CLICK') return { ok: true };
      return { ok: true };
    }
  }
};
</script></body></html>`;

test('Auto-Allow Exception Engine: Dot pre-existing A Allow / B Deny is clicked immediately without injecting prompt into composer', async () => {
  const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: dotFixture }));
    const page = await context.newPage();
    await page.goto(dotUrl);

    const sendOutcome = await page.evaluate(pageAction, {
      mode: 'send',
      expectedUrl: dotUrl,
      targetIdentity: 'acct~dot',
      prompt,
      sendMethod: 'auto',
      persistentDelivery: true,
      unlimitedReadiness: true,
      runId: 'run-dot-allow-1',
      runDeadline: Date.now() + 20_000,
      stopMarkers: [],
    });

    assert.equal(sendOutcome.status, 'busy');
    assert.equal(sendOutcome.diagnosticCode, 'auto-allowed-prompt');
    assert.notEqual(sendOutcome.retryable, true);

    const stateAfterAllow = await page.evaluate(() => ({
      allowClicks: window.fixture.allowClicks,
      denyClicks: window.fixture.denyClicks,
      composerInputs: window.fixture.composerInputs,
      sends: window.fixture.sends,
      composerText: document.querySelector('[data-composer-markdown]').innerText,
    }));
    assert.equal(stateAfterAllow.allowClicks, 1, 'Must click A Allow exactly once');
    assert.equal(stateAfterAllow.denyClicks, 0, 'Must never click B Deny');
    assert.equal(stateAfterAllow.composerInputs, 0, 'Must never write prompt into composer while approval prompt is pending');
    assert.equal(stateAfterAllow.sends, 0, 'Must never submit composer while approval prompt is pending');
    assert.equal(stateAfterAllow.composerText, '');

    // Verify historical answered card (with SVG checkmark) is not re-clicked after a new response arrives
    await page.evaluate(() => {
      document.getElementById('options-group').removeAttribute('data-agent-continue-allowed');
      document.getElementById('opt-allow').removeAttribute('data-agent-continue-allowed');
      const row = document.createElement('article');
      row.className = 'message-row';
      row.setAttribute('data-message-id', 'acct~dot~Msg~a2');
      const body = document.createElement('div');
      body.className = 'message-body';
      body.setAttribute('data-message-id', 'acct~dot~Msg~a2');
      body.innerText = 'Completed user_message_read tool execution.';
      row.appendChild(body);
      document.getElementById('conversation').appendChild(row);
    });

    const checkAfterAnswered = await page.evaluate(pageAction, {
      mode: 'check',
      expectedUrl: dotUrl,
      targetIdentity: 'acct~dot',
      prompt: '',
      sendMethod: 'auto',
      runId: null,
      stopMarkers: [],
    });
    assert.equal(checkAfterAnswered.status, 'ready');
    assert.equal(await page.evaluate(() => window.fixture.allowClicks), 1, 'Answered historical card with SVG checkmark must not be clicked again');

    await context.close();
  } finally {
    await browser.close();
  }
});

test('Auto-Allow Exception Engine: ChatGPT Always allow / Allow once / Deny prioritizes Always allow and supports React __reactProps$ fallback', async () => {
  const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext();
    const chatFixture = `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <main id="history">
      <div data-message-author-role="user" data-message-id="u-1">Run search</div>
      <div data-message-author-role="assistant" data-message-id="a-1">
        <div id="mcp-confirm">
          <p>Allow ChatGPT to search Fireflies meeting transcripts for "Zebra"?</p>
          <div id="btn-allow-once" class="pill">Allow once</div>
          <div id="btn-always-allow" class="pill">Always allow</div>
          <div id="btn-deny" class="pill">Deny</div>
        </div>
      </div>
    </main>
    <form data-chatgpt-composer>
      <div id="prompt-textarea" class="ProseMirror" contenteditable="true"></div>
      <button type="button" data-testid="send-button" disabled>Send</button>
    </form>
    <script>
      window.fixture = { alwaysAllow: 0, allowOnce: 0, deny: 0 };
      const alwaysBtn = document.getElementById('btn-always-allow');
      alwaysBtn['__reactProps$synthetic123'] = {
        onClick: (evt) => {
          if (evt && evt.isTrusted) {
            window.fixture.alwaysAllow++;
            const spinner = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            alwaysBtn.appendChild(spinner);
          }
        }
      };
      document.getElementById('btn-allow-once').addEventListener('click', () => { window.fixture.allowOnce++; });
      document.getElementById('btn-deny').addEventListener('click', () => { window.fixture.deny++; });
      window.chrome = {
        runtime: {
          sendMessage: async () => ({ ok: true, allowed: true, runDeadline: Date.now() + 20000 })
        }
      };
    </script></body></html>`;

    await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: chatFixture }));
    const page = await context.newPage();
    await page.goto(chatUrl);

    const outcome = await page.evaluate(pageAction, {
      mode: 'check',
      expectedUrl: chatUrl,
      prompt: '',
      sendMethod: 'auto',
      runId: null,
      stopMarkers: [],
    });

    assert.equal(outcome.status, 'busy');
    assert.equal(outcome.diagnosticCode, 'auto-allowed-prompt');

    const counts = await page.evaluate(() => window.fixture);
    assert.equal(counts.alwaysAllow, 1, 'Must prioritize Always allow and invoke __reactProps$.onClick when DOM click is ignored');
    assert.equal(counts.allowOnce, 0);
    assert.equal(counts.deny, 0);

    // Immediate second check during cooldown must return busy WITHOUT auto-allowed-prompt (preventing duplicate logs)
    const cooldownOutcome = await page.evaluate(pageAction, {
      mode: 'check',
      expectedUrl: chatUrl,
      prompt: '',
      sendMethod: 'auto',
      runId: null,
      stopMarkers: [],
    });
    assert.equal(cooldownOutcome.status, 'busy');
    assert.equal(cooldownOutcome.diagnosticCode, undefined, 'Recently-allowed cooldown must not emit duplicate auto-allowed-prompt diagnostic');

    await context.close();
  } finally {
    await browser.close();
  }
});

test('Auto-Allow Exception Engine: Handles Authorize / Connect / Sign in / OAuth modal prompts while ignoring sidebar, user turns, and code blocks', async () => {
  const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext();
    const authFixture = `<!doctype html><html><head><meta charset="utf-8"><title>ChatGPT</title></head><body>
      <header><button id="headerSignIn" onclick="window.fixture.falsePositives++">Sign in</button></header>
      <aside data-testid="sidebar"><button id="sidebarConnect" onclick="window.fixture.falsePositives++">Connect</button></aside>
      <main>
        <article class="message-row self" data-message-id="acct~dot~Msg~u1">
          <div class="message-body" data-message-id="acct~dot~Msg~u1">Please Sign in with Google and Allow access</div>
          <button id="userTurnButton" onclick="window.fixture.falsePositives++">Allow access</button>
        </article>
        <article class="message-row" data-message-id="acct~dot~Msg~a1">
          <div class="message-body" data-message-id="acct~dot~Msg~a1">
            <div class="prose">
              <p>To continue, please connect your account:</p>
              <ul><li onclick="window.fixture.falsePositives++">1. Continue</li></ul>
              <pre><code><button id="codeRunBtn" onclick="window.fixture.falsePositives++">Run</button></code></pre>
            </div>
            <div id="singleBtnOAuthCard" class="connector-card">
              <p>Requires authentication with Smartsheet</p>
              <button id="connectSmartsheetBtn" type="button" onclick="window.fixture.smartsheetConnected++; this.setAttribute('aria-checked', 'true');">Sign in with Smartsheet</button>
            </div>
            <div id="pairedAuthorizeCard" class="connector-card">
              <p>Authorize ChatGPT to access your calendar?</p>
              <button id="authorizeBtn" type="button" onclick="window.fixture.authorized++; this.setAttribute('aria-checked', 'true');">同意并继续</button>
              <button id="cancelBtn" type="button" onclick="window.fixture.cancelled++">取消</button>
            </div>
          </div>
        </article>
      </main>
      <div data-composer-root><div data-composer-body><div data-composer-input><div data-composer-markdown contenteditable="true" role="textbox" aria-label="Message"><p><br></p></div></div><button type="button" aria-label="Send">Send</button></div></div>
      <script>
        window.fixture = { falsePositives: 0, smartsheetConnected: 0, authorized: 0, cancelled: 0 };
        window.chrome = {
          runtime: {
            sendMessage: async () => ({ ok: true, allowed: true, runDeadline: Date.now() + 20000 })
          }
        };
      </script></body></html>`;

    await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: authFixture }));
    const page = await context.newPage();
    await page.goto(dotUrl);

    // Round 1: Bottom-most pending card (paired 同意并继续 / 取消) is clicked first
    const r1 = await page.evaluate(pageAction, {
      mode: 'check',
      expectedUrl: dotUrl,
      prompt: '',
      sendMethod: 'auto',
      runId: null,
      stopMarkers: [],
    });
    assert.equal(r1.status, 'busy');
    assert.equal(r1.diagnosticCode, 'auto-allowed-prompt');

    // Round 2: Single-button OAuth card ("Sign in with Smartsheet") is clicked next (not blocked by paired card's recently-allowed state!)
    const r2 = await page.evaluate(pageAction, {
      mode: 'check',
      expectedUrl: dotUrl,
      prompt: '',
      sendMethod: 'auto',
      runId: null,
      stopMarkers: [],
    });
    assert.equal(r2.status, 'busy');
    assert.equal(r2.diagnosticCode, 'auto-allowed-prompt');

    // Round 3: Now all valid approval/auth cards are completed; false-positive candidates must NEVER be clicked
    const r3 = await page.evaluate(pageAction, {
      mode: 'check',
      expectedUrl: dotUrl,
      prompt: '',
      sendMethod: 'auto',
      runId: null,
      stopMarkers: [],
    });
    assert.equal(r3.status, 'ready', 'Once all valid approval cards are answered, page check must return ready without clicking false positives');

    const counts = await page.evaluate(() => window.fixture);
    assert.equal(counts.authorized, 1, 'Must click paired Chinese consent button (同意并继续)');
    assert.equal(counts.smartsheetConnected, 1, 'Must click single-button OAuth login CTA (Sign in with Smartsheet)');
    assert.equal(counts.cancelled, 0);
    assert.equal(counts.falsePositives, 0, 'Must never click header/sidebar Sign in, user turn buttons, code block Run, or markdown list items');

    await context.close();
  } finally {
    await browser.close();
  }
});

test('Auto-Allow Exception Engine: Background START, SEND_NOW, and real-time APPROVAL_PROMPT_OBSERVED record auto-allowed log and skip premature send', async () => {
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
              message: '检测到权限确认选项，已自动点击 Allow 并继续推进。',
              diagnosticCode: 'auto-allowed-prompt',
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

  await import(pathToFileURL(path.join(root, 'background.js')).href + '?test=auto-allow');
  const sendMsg = (msg, sender = { id: 'synthetic-extension', url: 'chrome-extension://synthetic/popup.html' }) =>
    new Promise(resolve => listeners[0](msg, sender, resolve));

  // 1. Start when an approval prompt is already on the page: must click Allow during probe, log 'auto-allowed', and NOT inject mode='send'
  const startRes = await sendMsg({
    type: 'START',
    tabId: 7,
    config: { ...DEFAULT_CONFIG, prompt: 'Continue working', startImmediately: true },
  });
  assert.equal(startRes.ok, true);
  assert.equal(startRes.job.enabled, true);
  assert.equal(state.injections.filter(i => i.args[0]?.mode === 'send').length, 0, 'Must skip immediate send round when START already auto-allowed a prompt');
  assert.ok(state.local.logs.some(l => l.event === 'auto-allowed' && l.diagnostic?.code === 'auto-allowed-prompt'), 'Must record auto-allowed log entry on START');

  // 2. Real-time APPROVAL_PROMPT_OBSERVED from content.js while running and idle
  await new Promise(r => setTimeout(r, 1300));
  const observedRes = await sendMsg(
    { type: 'APPROVAL_PROMPT_OBSERVED' },
    { id: 'synthetic-extension', tab: { id: 7, url: dotUrl }, frameId: 0, url: dotUrl }
  );
  assert.equal(observedRes.ok, true);
  assert.equal(observedRes.autoAllowed, true);
  assert.equal(state.local.logs.filter(l => l.event === 'auto-allowed').length, 2, 'Must record second auto-allowed log entry from real-time observer');
});

test('Auto-Allow Exception Engine & Cyclic Queue: 3 consecutive A Allow / B Deny cards in one Dot turn + 3-prompt 20-min cyclic queue (60 min/cycle)', async () => {
  const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext();
    const multiCardFixture = `<!doctype html><html><head><meta charset="utf-8"></head><body>
      <main id="conversation">
        <article class="message-row self" data-message-id="acct~dot~Msg~u1"><div class="message-body" data-message-id="acct~dot~Msg~u1">Check Smartsheet, 497, and 396</div></article>
        <article class="message-row" data-message-id="acct~dot~Msg~a1">
          <div id="turn-body" class="message-body" data-message-id="acct~dot~Msg~a1">
            <div class="card-1"><p>Allow ChatGPT to search your messages in your room for "Smartsheet"?</p><div><button id="allow-1" type="button">A Allow</button><button id="deny-1" type="button">B Deny</button></div></div>
          </div>
        </article>
      </main>
      <div data-composer-root><div data-composer-body><div data-composer-input><div data-composer-markdown contenteditable="true" role="textbox" aria-label="Message"></div></div><button type="button" aria-label="Send">Send</button></div></div>
      <script>
        window.clicks = [];
        const addSpinner = btn => {
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          btn.appendChild(svg);
        };
        document.getElementById('allow-1').addEventListener('click', function () { window.clicks.push('card-1'); addSpinner(this); });
        window.chrome = { runtime: { sendMessage: async () => ({ ok: true, allowed: true, runDeadline: Date.now() + 20000 }) } };
      </script></body></html>`;

    await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: multiCardFixture }));
    const page = await context.newPage();
    await page.goto(dotUrl);

    // Card 1 ("Smartsheet") clicked
    const c1 = await page.evaluate(pageAction, { mode: 'check', expectedUrl: dotUrl, prompt: '', sendMethod: 'auto', runId: null, stopMarkers: [] });
    assert.equal(c1.diagnosticCode, 'auto-allowed-prompt');

    // Append Card 2 ("497") into the SAME assistant turn while Card 1 has SVG checkmark
    await page.evaluate(() => {
      const card2 = document.createElement('div');
      card2.className = 'card-2';
      card2.innerHTML = '<p>Allow ChatGPT to search your messages for "497"?</p><div><button id="allow-2" type="button">A Allow</button><button id="deny-2" type="button">B Deny</button></div>';
      document.getElementById('turn-body').appendChild(card2);
      document.getElementById('allow-2').addEventListener('click', function () {
        window.clicks.push('card-2');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.appendChild(svg);
      });
    });

    const c2 = await page.evaluate(pageAction, { mode: 'check', expectedUrl: dotUrl, prompt: '', sendMethod: 'auto', runId: null, stopMarkers: [] });
    assert.equal(c2.diagnosticCode, 'auto-allowed-prompt');

    // Append Card 3 ("396") into the SAME assistant turn while Cards 1 & 2 have SVG checkmarks
    await page.evaluate(() => {
      const card3 = document.createElement('div');
      card3.className = 'card-3';
      card3.innerHTML = '<p>Allow ChatGPT to search messages in your room for "396"?</p><div><button id="allow-3" type="button">A Allow</button><button id="deny-3" type="button">B Deny</button></div>';
      document.getElementById('turn-body').appendChild(card3);
      document.getElementById('allow-3').addEventListener('click', function () {
        window.clicks.push('card-3');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.appendChild(svg);
      });
    });

    const c3 = await page.evaluate(pageAction, { mode: 'check', expectedUrl: dotUrl, prompt: '', sendMethod: 'auto', runId: null, stopMarkers: [] });
    assert.equal(c3.diagnosticCode, 'auto-allowed-prompt');

    assert.deepEqual(await page.evaluate(() => window.clicks), ['card-1', 'card-2', 'card-3'], 'Must click all 3 consecutive cards in the same turn exactly once in order');

    // Verify 3-prompt sequential cyclic queue (20 min interval x 3 prompts = 60 min full cycle)
    const cyclicConfig = readConfig({
      intervalMinutes: 20,
      mode: 'queue-loop',
      queue: [
        { name: 'Task 1', text: 'Prompt 1: Audit status' },
        { name: 'Task 2', text: 'Prompt 2: Run tests' },
        { name: 'Task 3', text: 'Prompt 3: Deploy & verify' },
      ],
    });
    assert.equal(cyclicConfig.mode, 'queue-loop');
    assert.equal(cyclicConfig.queue.length * cyclicConfig.intervalMinutes, 60);
    assert.equal(currentPrompt({ ...cyclicConfig, queueIndex: 0 }), 'Prompt 1: Audit status');
    assert.equal(currentPrompt({ ...cyclicConfig, queueIndex: 1 }), 'Prompt 2: Run tests');
    assert.equal(currentPrompt({ ...cyclicConfig, queueIndex: 2 }), 'Prompt 3: Deploy & verify');
    assert.equal(currentPrompt({ ...cyclicConfig, queueIndex: 3 }), 'Prompt 1: Audit status');

    // Performance benchmark: 50 historical turns with 20,000+ nested div/span nodes must scan in < 50ms (zero scroll lag)
    await page.evaluate(() => {
      const conv = document.getElementById('conversation');
      const frag = document.createDocumentFragment();
      for (let t = 0; t < 50; t++) {
        const row = document.createElement('article');
        row.className = t % 2 === 0 ? 'message-row self' : 'message-row';
        row.setAttribute('data-message-id', `acct~dot~Msg~hist${t}`);
        const body = document.createElement('div');
        body.className = 'message-body';
        body.setAttribute('data-message-id', `acct~dot~Msg~hist${t}`);
        for (let b = 0; b < 80; b++) {
          const wrap = document.createElement('div');
          wrap.innerHTML = '<div><span>Historical discussion block with nested spans and prose content for performance benchmarking.</span><span>More nested text</span></div>';
          body.appendChild(wrap);
        }
        row.appendChild(body);
        frag.appendChild(row);
      }
      conv.insertBefore(frag, conv.firstChild);
    });

    const t0 = performance.now();
    await page.evaluate(pageAction, { mode: 'check', expectedUrl: 'https://chatgpt.com/dots/home', prompt: '', sendMethod: 'auto', runId: null, stopMarkers: [] });
    const scanMs = performance.now() - t0;
    assert.ok(scanMs < 100, `Expected sub-100ms scan on 20,000+ DOM nodes, got ${scanMs.toFixed(2)}ms`);

    await context.close();
  } finally {
    await browser.close();
  }
});
