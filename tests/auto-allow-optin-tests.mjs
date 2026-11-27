import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_CONFIG, readConfig, inferPromptLanguage, resolvedTakeoverPrompt, DEFAULT_TAKEOVER_REPLY_EN, DEFAULT_TAKEOVER_REPLY_ZH } from '../config.js';
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
  assert.equal(resolvedTakeoverPrompt({ takeoverReply: '' }, 'en', '继续推进 Zebra PR #42'), DEFAULT_TAKEOVER_REPLY_ZH);
  assert.equal(resolvedTakeoverPrompt({ takeoverReply: '' }, 'zh_CN', 'Continue pushing Zebra PR #42 cleanly'), DEFAULT_TAKEOVER_REPLY_EN);
  assert.equal(resolvedTakeoverPrompt({ takeoverReply: '' }, 'zh_CN', '/goal'), DEFAULT_TAKEOVER_REPLY_ZH);
  assert.equal(inferPromptLanguage('请继续推进', 'en'), 'zh_CN');
  assert.equal(inferPromptLanguage('Continue end to end verification', 'zh_CN'), 'en');
  assert.equal(resolvedTakeoverPrompt({ takeoverReply: 'User delegate' }, 'en'), 'User delegate');
  for (const prompt of [DEFAULT_TAKEOVER_REPLY_ZH, DEFAULT_TAKEOVER_REPLY_EN]) {
    assert.ok(prompt.includes('/elephant-goldfish'), 'default takeover prompt must invoke /elephant-goldfish');
    assert.doesNotMatch(prompt, /only if|stop and report|仅当必须|才明确停下|take over manually/i);
  }
  assert.ok(DEFAULT_TAKEOVER_REPLY_ZH.includes('两步验证') && DEFAULT_TAKEOVER_REPLY_EN.includes('2FA'));
  assert.ok(DEFAULT_TAKEOVER_REPLY_ZH.includes('协作邀请') && DEFAULT_TAKEOVER_REPLY_EN.includes('collaborator'));
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

      // 4b. When autoAuthorizeTakeover: true on Dot, a 2FA/verification code request WITHOUT a CAPTCHA widget
      // delegates to Dot via takeover-needed instead of pausing as captcha-required.
      await page.evaluate(() => {
        document.querySelectorAll('iframe').forEach(f => f.remove());
        const msg = document.querySelector('article.message-row:not(.self) .message-body');
        msg.dataset.messageId = 'acct~dot~Msg~2fa';
        msg.textContent = 'Please enter the 2FA verification code sent to your email to continue.';
      });
      const twoFaCheck = await page.evaluate(pageAction, { ...baseArgs, mode: 'check', detectTakeover: true, autoAuthorizeTakeover: true });
      assert.equal(twoFaCheck.status, 'busy', JSON.stringify(twoFaCheck));
      assert.equal(twoFaCheck.diagnosticCode, 'takeover-needed', JSON.stringify(twoFaCheck));
      assert.equal(twoFaCheck.takeoverAssistantToken, 'acct~dot~Msg~2fa');

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

      // 6. Inline Dot "Sign in to accounts.google.com" [Sign in] card while "Dot Thinking" (.typing-indicator) is shown
      await page.evaluate(() => {
        document.querySelector('#conversation').replaceChildren();
        const uRow = document.createElement('article');
        uRow.className = 'message-row self';
        uRow.dataset.messageId = 'acct~dot~Msg~u-inline';
        const uBody = document.createElement('div');
        uBody.className = 'message-body';
        uBody.dataset.messageId = 'acct~dot~Msg~u-inline';
        uBody.textContent = 'Use browser Google sign in!';
        uRow.append(uBody);
        const card = document.createElement('div');
        card.className = 'inline-oauth-card';
        const label = document.createElement('p');
        label.textContent = 'Sign in to accounts.google.com\naccounts.google.com';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Sign in';
        card.append(label, btn);
        const typing = document.createElement('div');
        typing.className = 'typing-indicator';
        typing.textContent = 'Thinking';
        document.querySelector('#conversation').append(uRow, card);
        document.body.append(typing);
      });
      const inlineCheck = await page.evaluate(pageAction, { ...baseArgs, mode: 'check', detectTakeover: true, autoAuthorizeTakeover: true });
      assert.equal(inlineCheck.status, 'busy');
      assert.equal(inlineCheck.diagnosticCode, 'takeover-needed');
      assert.ok(inlineCheck.takeoverAssistantToken?.startsWith('card:'), JSON.stringify(inlineCheck));

      const inlineReply = await page.evaluate(pageAction, {
        ...baseArgs, mode: 'send', isTakeoverReply: true, autoAuthorizeTakeover: true,
        prompt: 'Authorized Google login via built-in browser',
      });
      assert.equal(inlineReply.status, 'sent', JSON.stringify(inlineReply));
      assert.equal(await page.evaluate(() => window.__sentReplies.at(-1)), 'Authorized Google login via built-in browser');

      const afterReplyCheck = await page.evaluate(pageAction, {
        ...baseArgs, mode: 'check', detectTakeover: true, autoAuthorizeTakeover: true,
        lastTakeoverToken: inlineCheck.takeoverAssistantToken,
      });
      assert.notEqual(afterReplyCheck.diagnosticCode, 'takeover-needed');

      // Also verify content.js observer emits TAKEOVER_PROMPT_OBSERVED when a fresh inline card appears alongside .typing-indicator
      await page.evaluate(() => {
        const inlineCard = document.querySelector('.inline-oauth-card');
        inlineCard.remove();
        const freshCard = document.createElement('div');
        freshCard.className = 'inline-oauth-card-2';
        freshCard.innerHTML = '<p>Sign in to accounts.google.com</p><button type="button">Sign in</button>';
        document.querySelector('#conversation').append(freshCard);
      });
      const contentSrc = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
      const observedTakeovers = await page.evaluate(async src => {
        const sent = [];
        window.chrome = {
          runtime: {
            id: 'ext-test-id',
            connect: () => ({ onDisconnect: { addListener() {} } }),
            onMessage: { addListener() {} },
            sendMessage: async msg => { sent.push(msg); return { ok: true }; },
          },
        };
        delete globalThis.__agentContinueContentRuntimeId;
        new Function(src)();
        await new Promise(r => setTimeout(r, 750));
        return sent.filter(m => m?.type === 'TAKEOVER_PROMPT_OBSERVED');
      }, contentSrc);
      assert.equal(observedTakeovers.length, 1, JSON.stringify(observedTakeovers));
      assert.ok(observedTakeovers[0].assistantToken?.startsWith('card:'), JSON.stringify(observedTakeovers));

      // 7. Standalone inline tool approval card ("Allow upload to ...") outside assistant message-row
      // and conservative GitHub confirmation question ("请确认我可以在 GitHub 上接受...")
      await page.evaluate(() => {
        for (const el of [...document.querySelectorAll('.inline-oauth-card-2, .typing-indicator')]) el.remove();
        window.__uploadToolClicks = [];
        const assistant = document.createElement('article');
        assistant.className = 'message-row';
        assistant.dataset.messageId = 'acct~dot~Msg~cs310-invite';
        const body = document.createElement('div');
        body.className = 'message-body';
        body.dataset.messageId = 'acct~dot~Msg~cs310-invite';
        body.textContent = 'CS310 确认收到 hhhhaa19/newspulse 的协作邀请。请确认我可以在 GitHub 上接受这项指定仓库的协作者邀请；接受后就能按分工开 PR。';
        assistant.append(body);

        const uploadCard = document.createElement('div');
        uploadCard.className = 'standalone-tool-card';
        const q = document.createElement('p');
        q.textContent = 'Allow upload to https://scopecheck-zye.app.space/workspace?';
        const btns = ['Always allow', 'Allow once', 'Allow this tool for this conversation', 'Deny'].map(label => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = label;
          b.addEventListener('click', () => {
            window.__uploadToolClicks.push(label);
            uploadCard.remove();
          });
          return b;
        });
        uploadCard.append(q, ...btns);
        document.querySelector('#conversation').append(assistant, uploadCard);
      });
      const contentSrc2 = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
      const observedApprovals = await page.evaluate(async src => {
        const sent = [];
        window.chrome = {
          runtime: {
            id: 'ext-test-id',
            connect: () => ({ onDisconnect: { addListener() {} } }),
            onMessage: { addListener() {} },
            sendMessage: async msg => { sent.push(msg); return { ok: true }; },
          },
        };
        delete globalThis.__agentContinueContentRuntimeId;
        new Function(src)();
        await new Promise(r => setTimeout(r, 750));
        return sent.filter(m => m?.type === 'ROUTINE_APPROVAL_OBSERVED');
      }, contentSrc2);
      assert.equal(observedApprovals.length, 1, JSON.stringify(observedApprovals));
      const allowStandalone = await page.evaluate(pageAction, { ...baseArgs, autoAllow: true, autoAuthorizeTakeover: true });
      assert.equal(allowStandalone.status, 'busy', JSON.stringify(allowStandalone));
      assert.equal(allowStandalone.diagnosticCode, 'auto-allowed-prompt', JSON.stringify(allowStandalone));
      assert.deepEqual(await page.evaluate(() => window.__uploadToolClicks), ['Always allow']);

      const confirmInvite = await page.evaluate(pageAction, {
        ...baseArgs, mode: 'check', detectTakeover: true, autoAllow: true, autoAuthorizeTakeover: true,
      });
      assert.equal(confirmInvite.status, 'busy', JSON.stringify(confirmInvite));
      assert.equal(confirmInvite.diagnosticCode, 'takeover-needed', JSON.stringify(confirmInvite));
      assert.equal(confirmInvite.takeoverAssistantToken, 'acct~dot~Msg~cs310-invite');
      assert.equal(confirmInvite.takeoverLanguage, 'zh_CN');

      // 8. Multiple simultaneous visible composers (e.g. Citation / quote-reply overlay) distinguish multiple-composers from no-composer
      await page.evaluate(() => {
        document.querySelector('article:last-of-type')?.remove();
        const extraOverlay = document.createElement('div');
        extraOverlay.dataset.composerInput = '';
        const extraBox = document.createElement('div');
        extraBox.setAttribute('contenteditable', 'true');
        extraBox.setAttribute('role', 'textbox');
        extraBox.setAttribute('aria-label', 'Message');
        extraBox.setAttribute('data-composer-markdown', '');
        extraBox.getClientRects = () => [{}];
        extraOverlay.append(extraBox);
        document.body.append(extraOverlay);
      });
      const multiCheck = await page.evaluate(pageAction, { ...baseArgs, mode: 'check' });
      assert.equal(multiCheck.status, 'blocked');
      assert.equal(multiCheck.diagnosticCode, 'composer-unavailable');
      assert.deepEqual(multiCheck.evidenceFlags, ['multiple-composers']);

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
  assert.ok(state.session.job.nextAt >= Date.now() + 19 * 60_000, 'takeover-replied must honor configured interval cooldown instead of colliding after 60s');

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
  // while DIALOG_EXCEPTION oauth-popup delegates to takeover inspection and unknown-modal deduplicates even across intervening sends.
  probeHandler = async () => ({ status: 'ready', identity: 'acct~dot', assistantToken: 'acct~dot~Msg~a1', assistantCount: 1 });
  assert.equal((await msg({ type: 'START', tabId: 7, targetUrl: url, config: { prompt: 'Test', autoAllow: true, autoAuthorizeTakeover: true } })).ok, true);
  assert.equal((await msg({
    type: 'DIALOG_EXCEPTION',
    kind: 'unknown-modal',
    surface: 'modal',
    evidence: ['role-dialog', 'private page text'],
    composerPresent: true,
  }, pageSender)).ok, true);
  assert.equal((await msg({ type: 'DIALOG_EXCEPTION', kind: 'unknown-modal', surface: 'modal', evidence: ['role-dialog', 'private page text'], composerPresent: true }, pageSender)).ok, true);
  await msg({ type: 'SEND_NOW' });
  assert.equal((await msg({ type: 'DIALOG_EXCEPTION', kind: 'unknown-modal', surface: 'modal', evidence: ['role-dialog', 'private page text'], composerPresent: true }, pageSender)).ok, true);
  assert.equal(state.local.logs.filter(e => e.event === 'exception-detected').length, 1, 'consecutive unknown-modal logs must deduplicate across sends');
  const excDiag = state.local.logs.find(e => e.event === 'exception-detected').diagnostic;
  assert.equal(excDiag.code, 'unknown-modal');
  assert.equal(excDiag.surface, 'modal');
  assert.equal(excDiag.composerPresent, true);
  assert.deepEqual(excDiag.evidence, ['role-dialog']);
  assert.ok(state.local.incidentLogs?.some(e => e.event === 'paused' || e.event === 'started'), 'incidentLogs retains lifecycle history');
  assert.ok(state.local.activityStats?.countsByEvent?.['exception-detected'] === 1, 'activityStats tracks event counts');

  probeHandler = async () => ({ status: 'busy', diagnosticCode: 'auto-allowed-prompt', assistantToken: 'acct~dot~Msg~a1', assistantCount: 1 });
  assert.equal((await msg({ type: 'DIALOG_EXCEPTION', kind: 'oauth-popup' }, pageSender)).ok, true);
  assert.equal(state.session.job.enabled, true, 'DIALOG_EXCEPTION oauth-popup must delegate when autoAuthorizeTakeover is enabled');

  probeHandler = async () => ({ status: 'blocked', diagnosticCode: 'oauth-required' });
  await msg({ type: 'ROUTINE_APPROVAL_OBSERVED' }, pageSender);
  assert.equal(state.session.job.enabled, false);
  assert.equal(state.session.job.lastDiagnosticCode, 'oauth-required');
  assert.equal((await msg({ type: 'RESUME' })).ok, true);
  assert.equal(state.session.job.consecutiveTakeoverReplies, 0, 'explicit RESUME resets takeover cap');

  // Even when UI language defaults to English, a Chinese prompt or Chinese Dot confirmation picks DEFAULT_TAKEOVER_REPLY_ZH
  probeHandler = async () => ({ status: 'ready', identity: 'acct~dot', assistantToken: 'acct~dot~Msg~a1', assistantCount: 1 });
  sendHandler = async args => {
    takeoverArgs.push(args);
    return { status: 'sent', assistantToken: args.lastTakeoverToken || 'acct~dot~Msg~zh', assistantCount: 6, identity: 'acct~dot' };
  };
  assert.equal((await msg({ type: 'START', tabId: 7, targetUrl: url, config: { prompt: '继续推进 PR #42 验收', autoAllow: true, autoAuthorizeTakeover: true } })).ok, true);
  probeHandler = async () => ({ status: 'busy', diagnosticCode: 'takeover-needed', takeoverAssistantToken: 'acct~dot~Msg~zh', takeoverLanguage: 'zh_CN', assistantCount: 6 });
  await msg({ type: 'TAKEOVER_PROMPT_OBSERVED' }, pageSender);
  assert.equal(takeoverArgs.length, 4);
  assert.equal(takeoverArgs.at(-1).prompt, DEFAULT_TAKEOVER_REPLY_ZH);

  // Even when the prompt is a short ASCII slash command (/goal) under English UI, triggering Chinese Dot turn picks DEFAULT_TAKEOVER_REPLY_ZH via executePage forwarding
  probeHandler = async () => ({ status: 'ready', identity: 'acct~dot', assistantToken: 'acct~dot~Msg~a1', assistantCount: 1 });
  assert.equal((await msg({ type: 'START', tabId: 7, targetUrl: url, config: { prompt: '/goal', autoAllow: true, autoAuthorizeTakeover: true } })).ok, true);
  probeHandler = async () => ({ status: 'busy', diagnosticCode: 'takeover-needed', takeoverAssistantToken: 'acct~dot~Msg~zh-cmd', takeoverLanguage: 'zh_CN', assistantCount: 7 });
  await msg({ type: 'TAKEOVER_PROMPT_OBSERVED' }, pageSender);
  assert.equal(takeoverArgs.length, 5);
  assert.equal(takeoverArgs.at(-1).prompt, DEFAULT_TAKEOVER_REPLY_ZH);
});
