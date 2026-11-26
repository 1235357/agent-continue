import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_CONFIG, readConfig, resolvedTakeoverPrompt, DEFAULT_TAKEOVER_REPLY_EN, DEFAULT_TAKEOVER_REPLY_ZH } from '../config.js';
import { pageAction } from '../adapter.js';
import { setLanguage } from '../i18n.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const playwright = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE_PATH)).href)
  : await import('playwright');

test('opt-in autonomy defaults stay false and validate strict bounds', () => {
  assert.equal(DEFAULT_CONFIG.autoAllow, false);
  assert.equal(DEFAULT_CONFIG.autoAuthorizeTakeover, false);
  assert.equal(DEFAULT_CONFIG.takeoverReply, '');
  const parsed = readConfig({ prompt: 'SYNTHETIC', autoAllow: true, autoAuthorizeTakeover: true, takeoverReply: 'Custom ok' });
  assert.equal(parsed.autoAllow, true);
  assert.equal(parsed.autoAuthorizeTakeover, true);
  assert.equal(parsed.takeoverReply, 'Custom ok');
  assert.equal(resolvedTakeoverPrompt({ takeoverReply: '  ' }, 'en'), DEFAULT_TAKEOVER_REPLY_EN);
  assert.equal(resolvedTakeoverPrompt({ takeoverReply: '' }, 'zh_CN'), DEFAULT_TAKEOVER_REPLY_ZH);
  assert.equal(resolvedTakeoverPrompt({ takeoverReply: 'User delegate' }, 'en'), 'User delegate');
  for (const badBool of ['true', 1, null, {}]) {
    if (badBool === null) continue;
    assert.throws(() => readConfig({ prompt: 'SYNTHETIC', autoAllow: badBool }));
    assert.throws(() => readConfig({ prompt: 'SYNTHETIC', autoAuthorizeTakeover: badBool }));
  }
  assert.throws(() => readConfig({ prompt: 'SYNTHETIC', takeoverReply: 'x'.repeat(4001) }));
  assert.throws(() => readConfig({ prompt: 'SYNTHETIC', takeoverReply: 'bad\u0000text' }));
});

test('content.js uses passive scroll/wheel deferral, requestIdleCallback, and zero legacy auto-click channels', () => {
  const src = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  assert.match(src, /addEventListener\('scroll',.*passive:\s*true/);
  assert.match(src, /addEventListener\('wheel',.*passive:\s*true/);
  assert.match(src, /requestIdleCallback/);
  assert.ok(src.includes('ROUTINE_APPROVAL_OBSERVED'));
  assert.ok(src.includes('TAKEOVER_PROMPT_OBSERVED'));
  assert.equal(src.includes('AUTO_ALLOW_CLICK'), false);
  assert.equal(src.includes('APPROVAL_PROMPT_OBSERVED'), false);
});

test('adapter handles opt-in routine allow, OAuth pause, Dot handover/takeover, and CAPTCHA pause safely', async () => {
  const browser = await playwright.chromium.launch({
    headless: true,
    executablePath: process.env.TEST_CHROMIUM_PATH || undefined,
    args: ['--no-sandbox'],
  });
  const baseHtml = `<!doctype html><html><body>
<main id="conversation">
  <article class="message-row self" data-message-id="acct~dot~Msg~u1"><div class="message-body">Run task</div></article>
  <article class="message-row" data-message-id="acct~dot~Msg~a1"><div class="message-body">Working...</div></article>
</main>
<div data-composer-root><div data-composer-body><div data-composer-input>
  <div data-composer-markdown contenteditable="true" role="textbox" aria-label="Message"></div>
</div><button type="button" aria-label="Send">Send</button></div></div>
</body></html>`;
  const url = 'https://chatgpt.com/dots/home';
  const baseArgs = {
    mode: 'send', expectedUrl: url, targetIdentity: 'acct~dot', prompt: 'Continue',
    sendMethod: 'button', runId: 'run-optin-1', runDeadline: Date.now() + 12000, stopMarkers: [],
  };
  try {
    // 1. Routine approval card with autoAllow: true
    {
      const ctx = await browser.newContext();
      await ctx.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: baseHtml }));
      const page = await ctx.newPage();
      await page.goto(url);
      await page.evaluate(() => {
        window.__clicks = [];
        const art = document.querySelector('article.message-row:not(.self)');
        const p = document.createElement('p');
        p.textContent = 'Allow ChatGPT to run local tool read_file?';
        const allow = document.createElement('button'); allow.textContent = 'Always allow';
        const deny = document.createElement('button'); deny.textContent = 'Deny';
        allow.addEventListener('click', () => window.__clicks.push('allow'));
        deny.addEventListener('click', () => window.__clicks.push('deny'));
        art.append(p, allow, deny);
      });
      const r1 = await page.evaluate(pageAction, { ...baseArgs, autoAllow: true });
      assert.equal(r1.status, 'busy');
      assert.equal(r1.diagnosticCode, 'auto-allowed-prompt');
      assert.deepEqual(await page.evaluate(() => window.__clicks), ['allow']);
      const r2 = await page.evaluate(pageAction, { ...baseArgs, autoAllow: true });
      assert.equal(r2.diagnosticCode, 'auto-allowed-prompt');
      assert.deepEqual(await page.evaluate(() => window.__clicks), ['allow'], '4s debounce prevents duplicate click');
      await ctx.close();
    }
    // 2. OAuth popup must strictly pause even when autoAllow: true
    {
      const ctx = await browser.newContext();
      await ctx.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: baseHtml }));
      const page = await ctx.newPage();
      await page.goto(url);
      await page.evaluate(() => {
        window.__oauthClicked = false;
        const dlg = document.createElement('div');
        dlg.setAttribute('role', 'dialog');
        dlg.innerHTML = '<p>Sign in with GitHub OAuth to authorize this connector</p><a href="https://github.com/login/oauth/authorize">Authorize</a>';
        const btn = document.createElement('button'); btn.textContent = 'Authorize';
        btn.addEventListener('click', () => { window.__oauthClicked = true; });
        dlg.append(btn);
        document.body.append(dlg);
      });
      const r = await page.evaluate(pageAction, { ...baseArgs, autoAllow: true });
      assert.equal(r.status, 'blocked');
      assert.equal(r.diagnosticCode, 'oauth-required');
      assert.equal(await page.evaluate(() => window.__oauthClicked), false);
      await ctx.close();
    }
    // 3. Handover button & conversational takeover prompt when autoAuthorizeTakeover: true
    {
      const ctx = await browser.newContext();
      await ctx.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: baseHtml }));
      const page = await ctx.newPage();
      await page.goto(url);
      await page.evaluate(() => {
        window.__returned = 0;
        const pauseBadge = document.createElement('button');
        pauseBadge.textContent = 'Paused';
        const ret = document.createElement('button');
        ret.textContent = 'Give control back';
        ret.addEventListener('click', () => { window.__returned++; });
        document.body.append(pauseBadge, ret);
      });
      const handover = await page.evaluate(pageAction, { ...baseArgs, autoAuthorizeTakeover: true });
      assert.equal(handover.status, 'busy');
      assert.equal(handover.diagnosticCode, 'auto-allowed-prompt');
      assert.equal(await page.evaluate(() => window.__returned), 1);

      await page.evaluate(() => {
        for (const el of [...document.querySelectorAll('button')].filter(b => b.textContent === 'Paused' || b.textContent === 'Give control back')) el.remove();
        document.querySelector('article.message-row:not(.self) .message-body').textContent = 'Please finish GitHub login and hand control back to me so I can proceed.';
      });
      const promptCheck = await page.evaluate(pageAction, { ...baseArgs, mode: 'check', detectTakeover: true, autoAuthorizeTakeover: true });
      assert.equal(promptCheck.status, 'busy');
      assert.equal(promptCheck.diagnosticCode, 'takeover-needed');
      assert.equal(promptCheck.takeoverAssistantToken, 'acct~dot~Msg~a1');

      const deduped = await page.evaluate(pageAction, { ...baseArgs, autoAuthorizeTakeover: true, lastTakeoverToken: 'acct~dot~Msg~a1' });
      assert.notEqual(deduped.diagnosticCode, 'takeover-needed');
      await ctx.close();
    }
    // 4. CAPTCHA / 2FA must strictly pause when autoAuthorizeTakeover: true
    {
      const ctx = await browser.newContext();
      await ctx.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: baseHtml }));
      const page = await ctx.newPage();
      await page.goto(url);
      await page.evaluate(() => {
        const frame = document.createElement('iframe');
        frame.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
        document.body.append(frame);
        document.querySelector('article.message-row:not(.self) .message-body').textContent = 'Please verify you are human and hand control back.';
      });
      const blocked = await page.evaluate(pageAction, { ...baseArgs, autoAuthorizeTakeover: true });
      assert.equal(blocked.status, 'blocked');
      assert.equal(blocked.diagnosticCode, 'captcha-required');
      await ctx.close();
    }
    // 5. Dot active Sign-in request dialog & Paused takeover prompt vs closed Sign-in request card
    {
      const ctx = await browser.newContext();
      await ctx.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: baseHtml }));
      const page = await ctx.newPage();
      await page.goto(url);
      await page.evaluate(() => {
        window.__signInActions = [];
        const dlg = document.createElement('div');
        dlg.setAttribute('role', 'dialog');
        dlg.innerHTML = '<p>Sign-in request github.com</p>';
        const takeOverBtn = document.createElement('button'); takeOverBtn.textContent = 'Take over';
        const closeBtn = document.createElement('button'); closeBtn.textContent = 'Close';
        takeOverBtn.addEventListener('click', () => window.__signInActions.push('take-over'));
        closeBtn.addEventListener('click', () => { window.__signInActions.push('close'); dlg.remove(); });
        dlg.append(takeOverBtn, closeBtn);
        document.body.append(dlg);
      });
      const handled = await page.evaluate(pageAction, { ...baseArgs, mode: 'check', detectTakeover: true, autoAuthorizeTakeover: true });
      assert.equal(handled.status, 'busy');
      assert.equal(handled.diagnosticCode, 'auto-allowed-prompt');
      assert.deepEqual(await page.evaluate(() => window.__signInActions), ['close']);

      await page.evaluate(() => {
        window.chrome = {
          runtime: {
            sendMessage: async msg => (msg?.type === 'CHECK_RUN' ? { ok: true, allowed: true, runDeadline: Date.now() + 20000 } : { ok: true }),
          },
        };
        const paused = document.createElement('button');
        paused.dataset.testid = 'dot-paused';
        paused.textContent = 'Paused';
        document.body.append(paused);
        document.querySelector('article.message-row:not(.self) .message-body').textContent = 'Sign-in request github.com\nPlease sign in to github.com to continue.';
        const editor = document.querySelector('[data-composer-markdown]');
        const send = document.querySelector('button[aria-label="Send"]');
        window.__sentReplies = [];
        editor.addEventListener('input', () => { send.disabled = !editor.innerText.trim(); });
        send.addEventListener('click', () => {
          const text = editor.innerText.trim();
          window.__sentReplies.push(text);
          const row = document.createElement('article');
          row.className = 'message-row self';
          row.dataset.messageId = 'acct~dot~Msg~u2';
          const body = document.createElement('div');
          body.className = 'message-body';
          body.dataset.messageId = 'acct~dot~Msg~u2';
          body.textContent = text;
          row.append(body);
          document.querySelector('#conversation').append(row);
          editor.innerText = '';
          send.disabled = true;
        });
      });
      const pausedTakeover = await page.evaluate(pageAction, { ...baseArgs, mode: 'check', detectTakeover: true, autoAuthorizeTakeover: true });
      assert.equal(pausedTakeover.status, 'busy');
      assert.equal(pausedTakeover.diagnosticCode, 'takeover-needed');
      assert.equal(pausedTakeover.takeoverAssistantToken, 'acct~dot~Msg~a1');

      const sentWhilePaused = await page.evaluate(pageAction, {
        ...baseArgs, mode: 'send', isTakeoverReply: true, autoAuthorizeTakeover: true,
        prompt: 'Authorized takeover proceed',
      });
      assert.equal(sentWhilePaused.status, 'sent');
      assert.deepEqual(await page.evaluate(() => window.__sentReplies), ['Authorized takeover proceed']);

      await page.evaluate(() => {
        for (const el of [...document.querySelectorAll('button')].filter(b => b.textContent === 'Paused')) el.remove();
        document.querySelector('article.message-row:not(.self) .message-body').textContent = 'Sign-in request closed\ngithub.com\nBuild succeeded.';
      });
      const closedCheck = await page.evaluate(pageAction, { ...baseArgs, mode: 'check', detectTakeover: true, autoAuthorizeTakeover: true });
      assert.equal(closedCheck.status, 'ready');
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
});

test('background handles ROUTINE_APPROVAL_OBSERVED and TAKEOVER_PROMPT_OBSERVED with strict safety bounds', async () => {
  const url = 'https://chatgpt.com/dots/home';
  const listeners = { onMessage: [], onAlarm: [], onRemoved: [], onUpdated: [], onStartup: [], onCommand: [], onInstalled: [], onConnect: [] };
  const state = {
    session: {},
    local: {},
    alarms: new Map(),
    tabs: new Map([[7, { id: 7, url, title: 'Your dot', status: 'complete', active: true, autoDiscardable: true }]]),
    injections: [],
  };
  let probeHandler = async () => ({ status: 'ready', identity: 'acct~dot', assistantToken: 'acct~dot~Msg~a1', assistantCount: 1 });
  let sendHandler = async () => ({ status: 'sent', assistantToken: 'acct~dot~Msg~a2', assistantCount: 2, identity: 'acct~dot' });
  const copy = v => v === undefined ? undefined : structuredClone(v);
  const mkArea = area => ({
    async get(k) { return Object.fromEntries((Array.isArray(k) ? k : [k]).map(key => [key, copy(state[area][key])])); },
    async set(v) { Object.assign(state[area], copy(v)); },
    async remove(k) { for (const key of Array.isArray(k) ? k : [k]) delete state[area][key]; },
    async setAccessLevel() {},
  });
  globalThis.chrome = {
    storage: { session: mkArea('session'), local: mkArea('local') },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setTitle() {} },
    alarms: { async get(n) { return state.alarms.get(n); }, async clear(n) { return state.alarms.delete(n); }, async create(n, v) { state.alarms.set(n, { name: n, ...v }); }, onAlarm: { addListener: fn => listeners.onAlarm.push(fn) } },
    permissions: { async contains() { return false; } },
    power: { requestKeepAwake() {}, releaseKeepAwake() {} },
    tabs: {
      async query(q = {}) { return [...state.tabs.values()].filter(t => !q.url || t.url.startsWith('https://chatgpt.com/')).map(copy); },
      async get(id) { if (!state.tabs.has(id)) throw new Error('missing'); return copy(state.tabs.get(id)); },
      async sendMessage() { return {}; },
      async update(id, upd) { Object.assign(state.tabs.get(id), upd); return copy(state.tabs.get(id)); },
      onRemoved: { addListener: fn => listeners.onRemoved.push(fn) },
      onUpdated: { addListener: fn => listeners.onUpdated.push(fn) },
    },
    scripting: {
      async executeScript(req) {
        state.injections.push(req);
        const arg = req.args?.[0];
        const res = arg?.mode === 'check' ? await probeHandler(arg) : await sendHandler(arg);
        return [{ frameId: 0, result: res }];
      },
    },
    runtime: {
      id: 'ext-test-id',
      getURL: p => 'chrome-extension://ext-test-id/' + p,
      onMessage: { addListener: fn => listeners.onMessage.push(fn) },
      onStartup: { addListener: fn => listeners.onStartup.push(fn) },
      onInstalled: { addListener: fn => listeners.onInstalled.push(fn) },
      onConnect: { addListener: fn => listeners.onConnect.push(fn) },
      async sendMessage() {},
    },
    commands: { onCommand: { addListener: fn => listeners.onCommand.push(fn) } },
  };
  await setLanguage('en');
  await import(pathToFileURL(path.join(root, 'background.js')).href + '?optin-test=1');
  const panel = { id: 'ext-test-id', url: 'chrome-extension://ext-test-id/popup.html' };
  const pageSender = { id: 'ext-test-id', tab: copy(state.tabs.get(7)), frameId: 0, url };
  const msg = (m, s = panel) => new Promise(resolve => listeners.onMessage[0](m, s, resolve));

  assert.equal((await msg({ type: 'GET_STATE' })).ok, true);
  // Start with autoAllow: false -> ROUTINE_APPROVAL_OBSERVED rejected
  const startOff = await msg({
    type: 'START',
    tabId: 7,
    targetUrl: url,
    config: { mode: 'queue-loop', queue: [{ name: 'Q1', text: 'First queued' }, { name: 'Q2', text: 'Second queued' }], autoAllow: false, autoAuthorizeTakeover: true, takeoverReply: 'Authorized takeover reply' },
  });
  assert.equal(startOff.ok, true);
  assert.equal((await msg({ type: 'ROUTINE_APPROVAL_OBSERVED' }, pageSender)).ok, false);

  // Trigger TAKEOVER_PROMPT_OBSERVED -> sends takeover reply once without consuming queueIndex or sentCount
  probeHandler = async () => ({ status: 'busy', diagnosticCode: 'takeover-needed', takeoverAssistantToken: 'acct~dot~Msg~tk1', assistantCount: 2 });
  const takeoverArgs = [];
  sendHandler = async args => {
    takeoverArgs.push(args);
    return { status: 'sent', assistantToken: 'acct~dot~Msg~tk1', assistantCount: 2, identity: 'acct~dot' };
  };
  const tk1 = await msg({ type: 'TAKEOVER_PROMPT_OBSERVED' }, pageSender);
  assert.equal(tk1.ok, true);
  assert.equal(takeoverArgs.length, 1);
  assert.equal(takeoverArgs[0].prompt, 'Authorized takeover reply');
  assert.equal(state.session.job.sentCount, 0, 'takeover reply must not consume sentCount');
  assert.equal(state.session.job.queueIndex, 0, 'takeover reply must preserve queueIndex');
  assert.equal(state.session.job.lastTakeoverToken, 'acct~dot~Msg~tk1');
  assert.equal(state.session.job.consecutiveTakeoverReplies, 1);

  // 2nd and 3rd distinct tokens succeed; 4th is capped and pauses task
  probeHandler = async () => ({ status: 'busy', diagnosticCode: 'takeover-needed', takeoverAssistantToken: 'acct~dot~Msg~tk2', assistantCount: 3 });
  await msg({ type: 'TAKEOVER_PROMPT_OBSERVED' }, pageSender);
  probeHandler = async () => ({ status: 'busy', diagnosticCode: 'takeover-needed', takeoverAssistantToken: 'acct~dot~Msg~tk3', assistantCount: 4 });
  await msg({ type: 'TAKEOVER_PROMPT_OBSERVED' }, pageSender);
  assert.equal(state.session.job.consecutiveTakeoverReplies, 3);
  assert.equal((await msg({ type: 'TAKEOVER_PROMPT_OBSERVED' }, pageSender)).ok, false, 'observer refuses 4th consecutive takeover reply');
  sendHandler = async () => ({ status: 'busy', diagnosticCode: 'takeover-needed', takeoverAssistantToken: 'acct~dot~Msg~tk4', assistantCount: 5, diagnosticProgress: { counters: { dispatchAttempts: 0, manualIntents: 0 } } });
  await msg({ type: 'SEND_NOW' });
  assert.equal(state.session.job.enabled, false, 'more than 3 consecutive takeover replies must pause');
  assert.equal(state.session.job.lastDiagnosticCode, 'takeover-needed');

  // Re-start with autoAllow: true and verify OAuth pauses when probe explicitly reports oauth-required,
  // while DIALOG_EXCEPTION oauth-popup delegates to takeover inspection and unknown-modal deduplicates logs.
  probeHandler = async () => ({ status: 'ready', identity: 'acct~dot', assistantToken: 'acct~dot~Msg~a1', assistantCount: 1 });
  assert.equal((await msg({ type: 'START', tabId: 7, targetUrl: url, config: { prompt: 'Test', autoAllow: true, autoAuthorizeTakeover: true } })).ok, true);
  assert.equal((await msg({ type: 'DIALOG_EXCEPTION', kind: 'unknown-modal' }, pageSender)).ok, true);
  assert.equal((await msg({ type: 'DIALOG_EXCEPTION', kind: 'unknown-modal' }, pageSender)).ok, true);
  assert.equal(state.local.logs.filter(e => e.event === 'exception-detected').length, 1, 'consecutive unknown-modal logs must deduplicate');

  probeHandler = async () => ({ status: 'busy', diagnosticCode: 'auto-allowed-prompt', assistantToken: 'acct~dot~Msg~a1', assistantCount: 1 });
  assert.equal((await msg({ type: 'DIALOG_EXCEPTION', kind: 'oauth-popup' }, pageSender)).ok, true);
  assert.equal(state.session.job.enabled, true, 'DIALOG_EXCEPTION oauth-popup must delegate when autoAuthorizeTakeover is enabled');

  probeHandler = async () => ({ status: 'blocked', diagnosticCode: 'oauth-required' });
  await msg({ type: 'ROUTINE_APPROVAL_OBSERVED' }, pageSender);
  assert.equal(state.session.job.enabled, false);
  assert.equal(state.session.job.lastDiagnosticCode, 'oauth-required');
  assert.equal((await msg({ type: 'RESUME' })).ok, true);
  assert.equal(state.session.job.consecutiveTakeoverReplies, 0, 'explicit RESUME resets takeover cap');
});
