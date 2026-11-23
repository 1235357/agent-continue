import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.EXTENSION_ROOT || path.dirname(here));
const { DEFAULT_CONFIG, readConfig } = await import(pathToFileURL(path.join(root, 'config.js')).href);
assert.equal(DEFAULT_CONFIG.extensionPriority, true, 'composer priority is mandatory by default');
for (const legacy of [{}, { extensionPriority: false }, { extensionPriority: true }]) {
  const input = { ...legacy, prompt: '  SYNTHETIC-CONFIG-PROMPT\n', waitForIdle: true, preventDiscard: false, startImmediately: false };
  const savedInput = structuredClone(input);
  const config = readConfig(input);
  assert.equal(config.extensionPriority, true, 'legacy false cannot restore draft protection');
  assert.equal(config.prompt, input.prompt);
  assert.equal(config.waitForIdle, true);
  assert.equal(config.preventDiscard, false);
  assert.equal(config.startImmediately, false);
  assert.deepEqual(input, savedInput, 'normalization does not mutate saved input');
}
for (const invalid of ['false', 0, 1, {}, []]) {
  assert.throws(() => readConfig({ prompt: 'SYNTHETIC-CONFIG-PROMPT', extensionPriority: invalid }), 'legacy key still requires a boolean');
}
const playwright = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE_PATH)).href)
  : await import('playwright');
const screenshots = process.env.POPUP_SCREENSHOT_DIR ? path.resolve(process.env.POPUP_SCREENSHOT_DIR) : null;
const screenshotFont = process.env.POPUP_FONT_PATH ? path.resolve(process.env.POPUP_FONT_PATH) : null;
const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
const checks = [];
const pass = name => { checks.push(name); console.log('PASS ' + name); };
pass('Config: mandatory priority defaults to true, normalizes legacy false without mutating input, preserves other settings, and rejects non-booleans.');
const priorityNotices = {
  en: 'Sending replaces drafts and removes pending attachments; CR/CRLF become LF. Wrong or duplicate sends are possible. Check the conversation before Resume; Resume may resend.',
  zh_CN: '发送会覆盖草稿并移除待发送附件；CR/CRLF 会规范为 LF。可能错发或重复发送。继续前请检查会话；继续可能重发。',
};
const original = { ...structuredClone(DEFAULT_CONFIG), prompt: 'SYNTHETIC-PRIVATE-PROMPT\n  Preserve these spaces.\n', intervalMinutes: 20,
  queue: [{ name: '合成队列 A', text: 'SYNTHETIC-QUEUE-A' }, { name: '合成队列 B', text: 'SYNTHETIC-QUEUE-B' }] };
const resources = new Set(['popup.html', 'popup.css', 'popup.js', 'config.js', 'file-import.js',
  'static-locale.js', 'i18n.js', 'i18n-html.js', 'i18n-popup.js', 'i18n-runtime.js', 'activity-export.js', 'delivery-diagnostics.js']);

async function createPage({ full = false, enabled = false, uiLanguage, fixture = original, title = 'Your dot', statusText = '合成测试任务。', initialTarget = 41, availableTargets = null, localHealth = null, sessionHealth = null, healthReadMode = null, configUnavailable = false } = {}) {
  const context = await browser.newContext({ viewport: { width: full ? 1200 : 650, height: full ? 900 : 600 }, locale: 'zh-CN', colorScheme: 'light', acceptDownloads: true });
  await context.route('**/*', async route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (name === 'setup.html' || name === 'devices.html') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Navigation fixture</title><p id="navigationFixture">' + name + '</p>' });
    }
    if (name === '__test-font.otf' && screenshotFont) return route.fulfill({ status: 200, contentType: 'font/otf', body: await fs.readFile(screenshotFont) });
    if (!resources.has(name)) return route.abort();
    return route.fulfill({ status: 200, contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'application/javascript', body: await fs.readFile(path.join(root, name)) });
  });
  await context.addInitScript(({ original, enabled, uiLanguage, title, statusText, availableTargets, localHealth, sessionHealth, healthReadMode, configUnavailable }) => {
    const mock = {
      config: structuredClone(original), templates: [], uiTheme: 'system', listeners: [], requests: [], draftGeneration: crypto.randomUUID(), draftRevision: 0,
      logs: [{ at: Date.now(), event: 'started', message: '合成任务已就绪；没有记录正文。' }],
      job: { ...structuredClone(original), id: 'test-job', enabled, phase: 'idle', tabId: 41,
        url: 'https://chatgpt.com/dots/home', title, sentCount: 2,
        nextAt: Date.now() + 20 * 60000, discardProtection: 'active', statusText, queueIndex: 0 },
      exports: [], tabs: [], tabAttempts: [], configWrites: [], permissionRequests: [], grantPower: true,
      diagnosticsHealth: localHealth, sessionDiagnosticsHealth: sessionHealth, healthReadMode, configUnavailable,
      availableTargets: availableTargets || [{ id: 41, title, url: 'https://chatgpt.com/dots/home' }, { id: 42, title: '测试对话', url: 'https://chatgpt.com/c/test' }],
    };
    if (uiLanguage !== undefined) mock.uiLanguage = uiLanguage;
    globalThis.__uiMock = mock;
    const notify = (key, oldValue, newValue, area = 'local') => {
      for (const listener of mock.listeners) listener({ [key]: { oldValue: structuredClone(oldValue), newValue: structuredClone(newValue) } }, area);
    };
    globalThis.chrome = {
      runtime: {
        getURL: resource => 'https://ui-fixture.invalid/' + resource,
        async sendMessage(message) {
          mock.requests.push(structuredClone(message));
          if (message.type === 'GET_STATE') {
            const snapshot = { ok: true, ...(mock.configUnavailable ? { configAvailable: false } : { configAvailable: true, config: structuredClone(mock.config), draftGeneration: mock.draftGeneration, draftRevision: mock.draftRevision }), job: structuredClone(mock.job), logs: structuredClone(mock.logs),
              deliveryDiagnostics: structuredClone(mock.deliveryDiagnostics), availableTargets: structuredClone(mock.availableTargets),
              diagnosticsHealth: mock.stateHealthUnknown ? { persistence: 'unknown', writeFailures: 0 } :
                structuredClone(mock.sessionDiagnosticsHealth || mock.diagnosticsHealth) };
            if (mock.rejectState) throw new Error('fixture state read failure');
            if (mock.deferState) await new Promise(resolve => { mock.stateResolvers.push(resolve); });
            return snapshot;
          }
          if (message.type === 'PREPARE_START') return { ok: true, startToken: crypto.randomUUID() };
          if (message.type === 'SAVE_DRAFT') {
            if (mock.deferConfigSave) await new Promise(resolve => { mock.finishConfigSave = resolve; });
            if (message.generation !== mock.draftGeneration || message.revision !== mock.draftRevision)
              return { ok: false, conflict: true, draftGeneration: mock.draftGeneration, draftRevision: mock.draftRevision };
            const old = mock.config;
            mock.config = structuredClone(message.config);
            mock.configWrites.push(structuredClone(message.config));
            mock.draftRevision++;
            notify('config', old, mock.config);
            return { ok: true, draftGeneration: mock.draftGeneration, draftRevision: mock.draftRevision };
          }
          if (message.type === 'SAVE_TEMPLATES') {
            if (message.generation !== mock.draftGeneration || JSON.stringify(message.base) !== JSON.stringify(mock.templates))
              return { ok: false, conflict: true };
            const old = mock.templates;
            mock.templates = structuredClone(message.templates);
            notify('templates', old, mock.templates);
            return { ok: true };
          }
          if (message.type === 'CHECK_PAGE') return { ok: true, result: { status: 'ready', message: '合成页面可用；未填写或发送。' } };
          if (message.type === 'CHECK_TIMING') {
            if (mock.deferTiming) await new Promise(resolve => { mock.finishTiming = resolve; });
            if (mock.timingRejected) throw new Error('SYNTHETIC_PRIVATE_API_ERROR');
            if (mock.timingError) return { ok: false, error: mock.timingError };
            return { ok: true, observations: [
              { kind: 'authorization', status: 'result', elapsedMs: 3, ok: true, allowed: false },
              { kind: 'page-timers', status: 'result', firstMs: 991, elapsedMs: 1992, hidden: true },
            ] };
          }
          if (message.type === 'START') {
            const old = structuredClone(mock.job);
            mock.job = { ...structuredClone(message.config), id: 'new-job', enabled: true, phase: 'idle', tabId: message.tabId || 41, title: 'Your dot',
              sentCount: 0, nextAt: Date.now() + message.config.intervalMinutes * 60000, discardProtection: 'active', statusText: '已开始合成测试。' };
            notify('job', old, mock.job, 'session'); return { ok: true, job: structuredClone(mock.job) };
          }
          if (message.type === 'PAUSE' || message.type === 'RESUME') {
            const old = structuredClone(mock.job); mock.job.enabled = message.type === 'RESUME'; mock.job.phase = 'idle';
            mock.job.nextAt = mock.job.enabled ? Date.now() + mock.job.intervalMinutes * 60000 : null;
            mock.job.statusText = mock.job.enabled ? '已继续原任务。' : '已暂停。';
            notify('job', old, mock.job, 'session'); return { ok: true, job: structuredClone(mock.job) };
          }
          if (message.type === 'SEND_NOW') {
            if (mock.deferSend) await new Promise(resolve => { mock.finishSend = resolve; });
            return { ok: true, job: structuredClone(mock.job) };
          }
          if (message.type === 'CLEAR_LOGS') { mock.logs = []; return { ok: true }; }
          if (message.type === 'CLEAR_DATA') {
            const oldConfig = mock.config;
            const oldTemplates = mock.templates;
            mock.draftGeneration = crypto.randomUUID(); mock.draftRevision = 0;
            mock.job = null; mock.config = null; mock.templates = []; mock.logs = []; mock.uiTheme = 'system';
            notify('config', oldConfig, undefined);
            if (oldTemplates.length) notify('templates', oldTemplates, undefined);
            if (mock.deferClear) await new Promise(resolve => { mock.finishClear = resolve; });
            return { ok: true };
          }
          throw new Error('Unexpected mock request');
        },
      },
      storage: {
        onChanged: { addListener(listener) { mock.listeners.push(listener); } },
        session: { async get() {
          if (mock.healthReadMode === 'reject-session') throw new Error('fixture session read failure');
          if (mock.healthReadMode === 'empty-session') return { diagnosticsHealth: undefined };
          return { diagnosticsHealth: structuredClone(mock.sessionDiagnosticsHealth) };
        } },
        local: {
          async get(keys) {
            if (keys === 'diagnosticsHealth' && mock.healthReadMode === 'hang-local') return new Promise(() => {});
            if (keys === 'diagnosticsHealth' && mock.healthReadMode === 'reject-local') throw new Error('fixture local read failure');
            const result = {}; for (const key of typeof keys === 'string' ? [keys] : keys || []) result[key] = structuredClone(mock[key]); return result;
          },
          async set(values) {
            for (const [key, value] of Object.entries(values)) { const old = mock[key]; mock[key] = structuredClone(value); notify(key, old, value); }
            if (Object.hasOwn(values, 'config')) mock.configWrites.push(structuredClone(values.config));
          },
        },
      },
      permissions: { async request(options) { mock.permissionRequests.push(structuredClone(options)); return mock.grantPower; } },
      tabs: { async query() { return [{ id: 41 }]; }, async create(options) {
        mock.tabAttempts.push(structuredClone(options));
        if (mock.rejectTabs) throw new Error('SYNTHETIC_PRIVATE_NAVIGATION_ERROR');
        mock.tabs.push(options); return { id: 99 };
      } },
    };
    const nativeCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { mock.exports.push(blob); return nativeCreate(blob); };
  }, { original: fixture, enabled, uiLanguage, title, statusText, availableTargets, localHealth, sessionHealth, healthReadMode, configUnavailable });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://ui-fixture.invalid/popup.html' + (full ? '?view=full' + (initialTarget === null ? '' : '&targetTabId=' + initialTarget) : ''));
  await page.waitForFunction(() => document.querySelector('#targetSelect').options.length > 1 &&
    (globalThis.__uiMock.configUnavailable || !document.querySelector('#check').disabled))
    .catch(async error => { throw new Error(JSON.stringify({ errors, state: await page.evaluate(() => ({ requests: globalThis.__uiMock?.requests, feedback: document.querySelector('#feedback')?.textContent })) }), { cause: error }); });
  if (screenshotFont) {
    await page.addStyleTag({ content: '@font-face{font-family:"Microsoft YaHei";src:url("/__test-font.otf") format("opentype");font-display:block}' });
    await page.evaluate(() => document.fonts.load('13px "Microsoft YaHei"'));
  }
  return { page, context, errors };
}
async function assertSealed(page, samples) {
  const content = await page.content();
  const ax = await page.locator('body').ariaSnapshot();
  const fields = await page.locator('input,textarea').evaluateAll(elements => elements.map(element => element.value).join('\n'));
  for (const sample of samples) {
    assert.ok(!content.includes(sample), 'Private prompt must not appear in DOM markup');
    assert.ok(!ax.includes(sample), 'Private prompt must not appear in accessibility tree');
    assert.ok(!fields.includes(sample), 'Hidden form values must not retain private prompt');
  }
}
async function assertLayout(page, full = false) {
  const layout = await page.evaluate(() => {
    const controls = document.querySelector('.controls').getBoundingClientRect();
    const notice = document.querySelector('#composerPriorityNotice');
    const noticeBounds = notice.getBoundingClientRect();
    const buttons = document.querySelector('.main-controls').getBoundingClientRect();
    return { width: innerWidth, pageWidth: document.documentElement.scrollWidth, controls: { top: controls.top, bottom: controls.bottom, height: innerHeight },
      noticeFits: notice.scrollWidth <= notice.clientWidth + 1 && noticeBounds.top >= buttons.bottom - 1
        && noticeBounds.left >= controls.left && noticeBounds.right <= controls.right + 1 && noticeBounds.bottom <= controls.bottom + 1,
      overflow: [...document.querySelectorAll('button,input,select,textarea')].filter(element => {
        if (!element.getClientRects().length) return false;
        const r = element.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1;
      }).map(element => element.id || element.textContent) };
  });
  assert.ok(layout.pageWidth <= layout.width + 1, JSON.stringify(layout));
  assert.deepEqual(layout.overflow, [], JSON.stringify(layout));
  assert.equal(layout.noticeFits, true, 'mandatory notice fits beside task controls without overlap: ' + JSON.stringify(layout));
  if (!full) assert.ok(layout.controls.top >= 0 && layout.controls.bottom <= layout.controls.height + 1, JSON.stringify(layout));
}
async function capture(page, name) {
  if (screenshots && name === 'store-2.1.0-en-console.png') {
    const previous = page.viewportSize();
    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await assertLayout(page, true);
      await fs.mkdir(screenshots, { recursive: true });
      const png = await page.screenshot({ path: path.join(screenshots, name), fullPage: false, omitBackground: false });
      assert.equal(png.readUInt32BE(16), 1280, 'Store console PNG width');
      assert.equal(png.readUInt32BE(20), 800, 'Store console PNG height');
      assert.equal(png[24], 8, 'Store console PNG bit depth');
      assert.equal(png[25], 2, 'Store console PNG must be RGB without alpha');
    } finally { await page.setViewportSize(previous); }
    return;
  }
  if (screenshots && process.env.STORE_SCREENSHOTS === '1' && name.startsWith('console-')) {
    const previous = page.viewportSize();
    try {
      await page.setViewportSize({width:1280,height:800});
      await fs.mkdir(screenshots, {recursive:true});
      await page.screenshot({path:path.join(screenshots, `store-${name}`),fullPage:false,omitBackground:false});
    } finally { await page.setViewportSize(previous); }
  }
  if (screenshots) { await fs.mkdir(screenshots, { recursive: true }); await page.screenshot({ path: path.join(screenshots, name), fullPage: true }); }
}

async function assertLateDraftReplies() {
  const failures = [];
  for (const outcome of ['success', 'conflict', 'rejection']) {
    const clearing = await createPage({ full: true }); const { page } = clearing;
    try {
      await page.evaluate(outcome => {
        __uiMock.deferConfigSave = outcome === 'conflict';
        const send = chrome.runtime.sendMessage;
        chrome.runtime.sendMessage = async message => {
          // Hold the completed reply independently of the pre-write delay.
          const hold = message.type === 'SAVE_DRAFT' && !__uiMock.draftReplyHeld;
          if (hold) __uiMock.draftReplyHeld = true;
          const response = await send(message);
          if (hold) {
            __uiMock.heldDraftResponse = structuredClone(response);
            await new Promise(resolve => { __uiMock.finishDraftReply = resolve; });
            if (outcome === 'rejection') throw new Error('Synthetic late save rejection');
          }
          return response;
        };
      }, outcome);
      await page.locator('#interval').fill('31');
      await page.waitForFunction(outcome => typeof __uiMock[outcome === 'conflict' ? 'finishConfigSave' : 'finishDraftReply'] === 'function', outcome);
      await page.locator('#tab-settings').click();
      await page.locator('#clearData').click(); await page.locator('#confirmClear').click();
      await page.waitForFunction(() => __uiMock.config === null && !document.querySelector('#check').disabled);
      const clearFeedback = await page.locator('#feedback').textContent();
      assert.equal(await page.locator('#feedback').evaluate(element => element.classList.contains('error')), false);
      if (outcome === 'conflict') {
        await page.evaluate(() => { __uiMock.deferConfigSave = false; __uiMock.finishConfigSave(); });
        await page.waitForFunction(() => typeof __uiMock.finishDraftReply === 'function');
        const fresh = { ...structuredClone(original), prompt: 'SYNTHETIC-AFTER-CLEAR\n  Preserve spaces.\n', intervalMinutes: 37 };
        await page.evaluate(async ({ config, base }) => {
          const response = await chrome.runtime.sendMessage({ type: 'SAVE_DRAFT', generation: __uiMock.draftGeneration,
            revision: __uiMock.draftRevision, base, config });
          if (!response.ok) throw new Error('Synthetic post-clear save failed');
        }, { config: fresh, base: structuredClone(DEFAULT_CONFIG) });
        await page.locator('#tab-logs').click();
        await page.waitForFunction(() => __uiMock.requests.filter(request => request.type === 'GET_STATE').length >= 3);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.evaluate(() => __uiMock.heldDraftResponse.draftRevision), 0);
        assert.equal(await page.evaluate(() => __uiMock.draftRevision), 1);
      }
      assert.equal(await page.evaluate(() => __uiMock.heldDraftResponse.ok), outcome !== 'conflict');
      await page.evaluate(async () => {
        __uiMock.finishDraftReply();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      if (outcome !== 'conflict') {
        assert.equal(await page.locator('#feedback').textContent(), clearFeedback,
          'a pre-clear save reply must not replace successful Clear feedback with a save failure');
        assert.equal(await page.evaluate(() => __uiMock.config), null);
        assert.equal(await page.evaluate(() => __uiMock.configWrites.length), 1, 'only the pre-clear save committed');
      } else {
        await page.locator('#tab-task').click();
        await page.locator('#interval').fill('43');
        await page.waitForFunction(() => __uiMock.requests.filter(request => request.type === 'SAVE_DRAFT').length === 3);
        assert.equal(await page.evaluate(() => __uiMock.requests.filter(request => request.type === 'SAVE_DRAFT').at(-1).revision), 1,
          'an old-generation conflict reply must not rewind the refreshed post-clear revision');
        await page.waitForFunction(() => __uiMock.config.intervalMinutes === 43);
        assert.equal(await page.evaluate(() => __uiMock.config.prompt), 'SYNTHETIC-AFTER-CLEAR\n  Preserve spaces.\n');
      }
      assert.equal(await page.locator('#targetSelect').inputValue(), '41', 'Clear does not retarget the panel');
      assert.equal(await page.evaluate(() => __uiMock.job), null);
      assert.equal(await page.evaluate(() => __uiMock.requests.some(request => ['START', 'RESUME', 'SEND_NOW'].includes(request.type))), false);
      assert.deepEqual(clearing.errors, []);
      pass(`Clear Data: a late ${outcome} save reply cannot corrupt post-clear state.`);
    } catch (error) { failures.push(error); }
    finally { await clearing.context.close(); }
  }
  if (failures.length) throw new AggregateError(failures, 'Late draft reply failures');
  {
    const editing = await createPage({ full: true }); const { page } = editing;
    try {
      await page.evaluate(() => {
        const schedule = window.setTimeout.bind(window);
        window.setTimeout = (callback, delay, ...args) => schedule(delay === 180 ? (...values) => {
          callback(...values);
          __uiMock.draftDebounces = (__uiMock.draftDebounces || 0) + 1;
        } : callback, delay, ...args);
        const send = chrome.runtime.sendMessage;
        chrome.runtime.sendMessage = async message => {
          const hold = message.type === 'SAVE_DRAFT' && !__uiMock.draftReplyHeld;
          if (hold) __uiMock.draftReplyHeld = true;
          const response = await send(message);
          if (hold) await new Promise(resolve => { __uiMock.finishDraftReply = resolve; });
          return response;
        };
      });
      await page.locator('#interval').fill('31');
      await page.waitForFunction(() => typeof __uiMock.finishDraftReply === 'function');
      await page.locator('#interval').fill('43');
      await page.waitForFunction(() => __uiMock.draftDebounces === 2);
      await page.evaluate(() => __uiMock.finishDraftReply());
      await page.waitForFunction(() => __uiMock.config.intervalMinutes === 43);
      assert.equal(await page.evaluate(() => __uiMock.draftRevision), 2);
      assert.deepEqual(await page.evaluate(() => __uiMock.config), { ...original, intervalMinutes: 43 });
      assert.equal(await page.evaluate(() => __uiMock.job.enabled), false);
      assert.deepEqual(editing.errors, []);
      pass('Config replies: same-generation queued edits still save with the latest revision.');
    } finally { await editing.context.close(); }
  }
  {
    const editing = await createPage({ full: true }); const { page } = editing;
    try {
      await page.evaluate(() => {
        const send = chrome.runtime.sendMessage;
        chrome.runtime.sendMessage = message => message.type === 'SAVE_DRAFT'
          ? Promise.reject(new Error('Synthetic save failure')) : send(message);
      });
      await page.locator('#interval').fill('31');
      await page.waitForFunction(() => document.querySelector('#feedback').classList.contains('error'));
      assert.equal(await page.locator('#feedback').textContent(), 'Local save failed. Check extension storage.');
      assert.deepEqual(await page.evaluate(() => __uiMock.config), original);
      assert.deepEqual(await page.evaluate(() => __uiMock.configWrites), []);
      assert.equal(await page.evaluate(() => __uiMock.job.enabled), false);
      assert.deepEqual(editing.errors, []);
      pass('Config replies: a current-generation save failure remains visible without changing stored data.');
    } finally { await editing.context.close(); }
  }
}

try {
  await assertLateDraftReplies();
  if (process.env.TEST_CLEAR_CONFIG_REPLY_ONLY === '1') {
    console.log(`\n${checks.length}/${checks.length} UI/config checks passed.`);
    await browser.close();
    process.exit(0);
  }
  for (const uiLanguage of ['en', 'zh_CN']) {
    const manual = await createPage({ full: true, uiLanguage }); const { page } = manual;
    try {
      await page.locator('#tab-prompt').click();
      assert.equal(await page.locator('#exportPromptTxt').count(), 1, 'manual TXT export control must exist');
      await page.locator('#manualTxtNotice').locator('..').locator('summary').click();
      assert.equal(await page.locator('#exportPromptTxt').isEnabled(), true);
      await page.locator('#manualSubmissionSequence').fill('12');
      const download = page.waitForEvent('download');
      await page.locator('#exportPromptTxt').click();
      const item = await download;
      assert.match(item.suggestedFilename(), /^agent-continue-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-12\.txt$/);
      assert.equal(await page.evaluate(async () => __uiMock.exports.at(-1).text()), original.prompt);
      assert.equal(await page.evaluate(() => __uiMock.requests.some(request => ['START', 'RESUME', 'SEND_NOW'].includes(request.type))), false);
      const instruction = await page.locator('#manualTxtNotice').innerText();
      assert.match(instruction, uiLanguage === 'en' ? /manual|manually/i : /手动/);
      assert.match(instruction, uiLanguage === 'en' ? /pause/i : /暂停/);
    } finally { await manual.context.close(); }
  }
  {
    const payload = '  SYNTHETIC 中文 🧭\r\n\n\tEnd  ';
    const exact = await createPage({ full: true, fixture: { ...structuredClone(original), prompt: payload } }); const { page } = exact;
    try {
      await page.locator('#tab-prompt').click();
      await page.locator('#manualTxtNotice').locator('..').locator('summary').click();
      await page.locator('#manualSubmissionSequence').fill('1');
      const download = page.waitForEvent('download');
      await page.locator('#exportPromptTxt').click();
      const item = await download;
      assert.deepEqual(await fs.readFile(await item.path()), Buffer.from(payload, 'utf8'));
      const bytes = await page.evaluate(async () => [...new Uint8Array(await __uiMock.exports.at(-1).arrayBuffer())]);
      assert.deepEqual(bytes, [...Buffer.from(payload, 'utf8')]);
    } finally { await exact.context.close(); }
  }
  {
    const payload = Array.from({ length: 4000 }, (_, index) => `SYNTHETIC_LINE_${index}: 中文 🧭\r\n`).join('');
    const long = await createPage({ full: true, fixture: { ...structuredClone(original), prompt: payload } }); const { page } = long;
    try {
      await page.locator('#tab-prompt').click();
      assert.equal(await page.locator('#prompt').inputValue(), '');
      await page.locator('#manualTxtNotice').locator('..').locator('summary').click();
      await page.locator('#manualSubmissionSequence').fill('4000');
      const download = page.waitForEvent('download');
      await page.locator('#exportPromptTxt').click();
      const item = await download;
      assert.deepEqual(await fs.readFile(await item.path()), Buffer.from(payload, 'utf8'));
      assert.equal(await page.locator('#prompt').inputValue(), '');
      assert.equal(await page.evaluate(() => __uiMock.requests.some(request => ['START', 'RESUME', 'SEND_NOW'].includes(request.type))), false);
    } finally { await long.context.close(); }
  }
  {
    const empty = await createPage({ full: true, fixture: { ...structuredClone(original), prompt: '  \n' } }); const { page } = empty;
    try {
      await page.locator('#tab-prompt').click();
      await page.locator('#manualTxtNotice').locator('..').locator('summary').click();
      await page.locator('#manualSubmissionSequence').fill('1');
      await page.locator('#exportPromptTxt').click();
      assert.equal(await page.evaluate(() => __uiMock.exports.length), 0);
      assert.equal(await page.locator('#feedback').evaluate(element => element.classList.contains('error')), true);
    } finally { await empty.context.close(); }
  }
  {
    const running = await createPage({ full: true, enabled: true }); const { page } = running;
    try {
      await page.locator('#tab-prompt').click();
      assert.equal(await page.locator('#exportPromptTxt').isDisabled(), true);
      assert.equal(await page.evaluate(() => __uiMock.exports.length), 0);
    } finally { await running.context.close(); }
  }
  {
    const stale = await createPage({ full: true }); const { page } = stale;
    try {
      await page.locator('#tab-prompt').click();
      await page.locator('#manualTxtNotice').locator('..').locator('summary').click();
      await page.locator('#manualSubmissionSequence').fill('1');
      await page.evaluate(() => { __uiMock.job.enabled = true; });
      await page.locator('#exportPromptTxt').click();
      assert.equal(await page.evaluate(() => __uiMock.exports.length), 0, 'stale paused UI must not create a file after another panel starts');
    } finally { await stale.context.close(); }
  }
  for (const job of [{ enabled: null }, { enabled: 0 }, { enabled: '' }, {}, false, 0, '']) {
    const malformed = await createPage({ full: true }); const { page } = malformed;
    try {
      await page.locator('#tab-prompt').click();
      await page.locator('#manualTxtNotice').locator('..').locator('summary').click();
      await page.locator('#manualSubmissionSequence').fill('1');
      await page.evaluate(value => { __uiMock.job = value; }, job);
      await page.locator('#exportPromptTxt').click();
      await page.waitForFunction(() => document.querySelector('#feedback').classList.contains('error'));
      assert.equal(await page.evaluate(() => __uiMock.exports.length), 0,
        'malformed scheduler state must not authorize a plaintext download');
    } finally { await malformed.context.close(); }
  }
  {
    const failing = await createPage({ full: true }); const { page } = failing;
    try {
      await page.locator('#tab-prompt').click();
      await page.locator('#manualTxtNotice').locator('..').locator('summary').click();
      await page.locator('#manualSubmissionSequence').fill('1');
      await page.evaluate(() => { __uiMock.rejectState = true; });
      await page.locator('#exportPromptTxt').click();
      await page.waitForFunction(() => document.querySelector('#feedback').classList.contains('error'));
      assert.equal(await page.evaluate(() => __uiMock.exports.length), 0);
    } finally { await failing.context.close(); }
  }
  {
    const deferred = await createPage({ full: true }); const { page } = deferred;
    try {
      await page.locator('#tab-prompt').click();
      await page.locator('#manualTxtNotice').locator('..').locator('summary').click();
      await page.locator('#manualSubmissionSequence').fill('1');
      await page.evaluate(() => { __uiMock.stateResolvers = []; __uiMock.deferState = true; });
      await page.locator('#exportPromptTxt').click();
      await page.waitForFunction(() => __uiMock.stateResolvers.length === 1);
      await page.evaluate(() => {
        const before = structuredClone(__uiMock.job);
        __uiMock.job.enabled = true;
        for (const listener of __uiMock.listeners) listener({ job: { oldValue: before, newValue: structuredClone(__uiMock.job) } }, 'session');
        __uiMock.stateResolvers.shift()();
      });
      await page.waitForFunction(() => document.querySelector('#feedback').classList.contains('error'));
      assert.equal(await page.evaluate(() => __uiMock.exports.length), 0);
    } finally { await deferred.context.close(); }
  }
  {
    const changing = await createPage({ full: true }); const { page } = changing;
    try {
      await page.locator('#tab-prompt').click();
      await page.locator('#manualTxtNotice').locator('..').locator('summary').click();
      await page.locator('#manualSubmissionSequence').fill('1');
      await page.evaluate(() => { __uiMock.stateResolvers = []; __uiMock.deferState = true; });
      await page.locator('#exportPromptTxt').click();
      await page.waitForFunction(() => __uiMock.stateResolvers.length === 1);
      await page.locator('#togglePrompt').click();
      await page.locator('#prompt').fill('SYNTHETIC_INTERVENING_EDIT');
      await page.locator('#prompt').fill(original.prompt);
      await page.evaluate(() => __uiMock.stateResolvers.shift()());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => __uiMock.exports.length), 0,
        'a draft edited during the pause check must not download an earlier click snapshot');
      assert.equal(await page.locator('#feedback').evaluate(element => element.classList.contains('error')), true);
    } finally { await changing.context.close(); }
  }
  {
    const rejected = await createPage({ full: true }); const { page } = rejected;
    try {
      await page.locator('#tab-prompt').click();
      await page.locator('#manualTxtNotice').locator('..').locator('summary').click();
      await page.locator('#manualSubmissionSequence').fill('1');
      await page.evaluate(() => { HTMLAnchorElement.prototype.click = () => { throw new Error('SYNTHETIC_PRIVATE_DOWNLOAD_ERROR'); }; });
      await page.locator('#exportPromptTxt').click();
      await page.waitForFunction(() => document.querySelector('#feedback').classList.contains('error'));
      assert.equal((await page.locator('#feedback').innerText()).includes('SYNTHETIC_PRIVATE_DOWNLOAD_ERROR'), false);
    } finally { await rejected.context.close(); }
  }
  for (const sequence of ['', '0', '-1', '1.5', '9007199254740992']) {
    const invalid = await createPage({ full: true }); const { page } = invalid;
    try {
      await page.locator('#tab-prompt').click();
      await page.locator('#manualTxtNotice').locator('..').locator('summary').click();
      await page.locator('#manualSubmissionSequence').fill(sequence);
      await page.locator('#exportPromptTxt').click();
      assert.equal(await page.evaluate(() => __uiMock.exports.length), 0, `invalid sequence ${sequence} must not create a file`);
      assert.equal(await page.locator('#feedback').evaluate(element => element.classList.contains('error')), true);
    } finally { await invalid.context.close(); }
  }
  {
    const invalid = await createPage({ full: true, fixture: { ...structuredClone(original), prompt: 'SYNTHETIC_\uD800_END' } }); const { page } = invalid;
    try {
      await page.locator('#tab-prompt').click();
      await page.locator('#manualTxtNotice').locator('..').locator('summary').click();
      await page.locator('#manualSubmissionSequence').fill('1');
      await page.locator('#exportPromptTxt').click();
      assert.equal(await page.evaluate(() => __uiMock.exports.length), 0, 'invalid UTF-16 must not be silently replaced');
      assert.equal(await page.locator('#feedback').evaluate(element => element.classList.contains('error')), true);
    } finally { await invalid.context.close(); }
  }
  {
    const queued = await createPage({ full: true, fixture: { ...structuredClone(original), mode: 'queue-loop' } }); const { page } = queued;
    try {
      await page.locator('#tab-prompt').click();
      await page.locator('#manualTxtNotice').locator('..').locator('summary').click();
      await page.locator('#manualSubmissionSequence').fill('2');
      await page.locator('#exportPromptTxt').click();
      assert.equal(await page.evaluate(() => __uiMock.exports.length), 0, 'manual TXT export must not guess a queue item');
      assert.equal(await page.locator('#feedback').evaluate(element => element.classList.contains('error')), true);
    } finally { await queued.context.close(); }
  }
  pass('Manual TXT: both languages, UTF-8 bytes, sequence validation, paused guard, empty prompt and invalid UTF-16 checks.');
  if (process.env.TEST_MANUAL_TXT_ONLY === '1') {
    await browser.close();
    process.exit(0);
  }
  for (const pending of ['permission', 'config save']) {
    const fixture = { ...structuredClone(original), keepAwake: pending === 'permission' };
    const starting = await createPage({ full: true, fixture }); const { page } = starting;
    try {
      await page.evaluate(pending => {
        if (pending === 'permission') chrome.permissions.request = async () => new Promise(resolve => { __uiMock.finishPermission = resolve; });
        else __uiMock.deferConfigSave = true;
      }, pending);
      await page.locator('#start').click();
      await page.waitForFunction(pending => typeof __uiMock[pending === 'permission' ? 'finishPermission' : 'finishConfigSave'] === 'function', pending);
      assert.equal(await page.locator('#pause').isVisible(), true,
        `Pause must be available while Start is awaiting ${pending}`);
      assert.equal(await page.locator('#start').isVisible(), false);
      await page.locator('#pause').click();
      await page.evaluate(pending => {
        if (pending === 'permission') __uiMock.finishPermission(true);
        else { __uiMock.deferConfigSave = false; __uiMock.finishConfigSave(); }
      }, pending);
      await page.waitForFunction(() => __uiMock.requests.some(request => request.type === 'PAUSE'));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => __uiMock.requests.filter(request => request.type === 'START').length), 0,
        `Pause during pending ${pending} must prevent the delayed Start`);
      assert.equal(await page.evaluate(() => __uiMock.job?.enabled), false);
      pass(`Pause: a pending Start cannot run after ${pending} completes.`);
    } finally { await starting.context.close(); }
  }
  {
    const starting = await createPage({ full: true }); const { page } = starting;
    try {
      await page.evaluate(() => { __uiMock.deferConfigSave = true; });
      await page.locator('#start').click();
      await page.waitForFunction(() => typeof __uiMock.finishConfigSave === 'function');
      await page.locator('#start').evaluate(button => button.click());
      await page.evaluate(() => { __uiMock.deferConfigSave = false; __uiMock.finishConfigSave(); });
      await page.waitForFunction(() => __uiMock.requests.some(request => request.type === 'START'));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => __uiMock.requests.filter(request => request.type === 'START').length), 1,
        'a duplicate activation cannot queue a second Start while saving');
      assert.equal(await page.evaluate(() => __uiMock.job?.enabled), true);
      pass('Start: duplicate activation during preparation produces one request.');
    } finally { await starting.context.close(); }
  }
  {
    const starting = await createPage({ full: true, fixture: { ...structuredClone(original), keepAwake: true } });
    const { page } = starting;
    try {
      await page.evaluate(() => {
        chrome.permissions.request = async () => new Promise(resolve => { __uiMock.finishPermission = resolve; });
        const send = chrome.runtime.sendMessage;
        chrome.runtime.sendMessage = message => message.type === 'PREPARE_START'
          ? Promise.reject(new Error('Synthetic reservation failure')) : send(message);
      });
      await page.locator('#start').click();
      await page.waitForFunction(() => typeof __uiMock.finishPermission === 'function');
      await page.locator('#pause').click();
      await page.evaluate(() => __uiMock.finishPermission(true));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => __uiMock.requests.filter(request => request.type === 'START').length), 0);
      assert.deepEqual(starting.errors, [], 'a rejected reservation must be observed even after Pause');
      pass('Pause: a rejected reservation cannot leak an unhandled rejection.');
    } finally { await starting.context.close(); }
  }
  if (process.env.TEST_PAUSE_PENDING_START_ONLY === '1') {
    await browser.close();
    process.exit(0);
  }
  {
    const survivor = await createPage({ full: true }); const { page } = survivor;
    try {
      await page.locator('#interval').fill('41');
      const updated = { ...structuredClone(original), prompt: 'SYNTHETIC-NEWER-PROMPT\n', promptSource: 'file' };
      await page.evaluate(config => {
        const oldValue = structuredClone(__uiMock.config);
        __uiMock.config = structuredClone(config);
        for (const listener of __uiMock.listeners) listener({ config: { oldValue, newValue: structuredClone(config) } }, 'local');
      }, updated);
      await page.waitForFunction(() => __uiMock.config.intervalMinutes === 41);
      assert.equal(await page.evaluate(() => __uiMock.config.prompt), updated.prompt,
        'a pending settings save must retain a newer prompt from another panel');
      assert.equal(await page.evaluate(() => __uiMock.config.promptSource), 'file');
      pass('Cross-panel config: a pending settings save preserves a newer prompt.');
    } finally { await survivor.context.close(); }
  }
  {
    const survivor = await createPage({ full: true }); const { page } = survivor;
    try {
      await page.locator('#tab-prompt').click();
      await page.locator('#togglePrompt').click();
      await page.locator('#prompt').fill('SYNTHETIC-PENDING-PROMPT');
      const updated = { ...structuredClone(original), intervalMinutes: 37 };
      await page.evaluate(config => {
        const oldValue = structuredClone(__uiMock.config);
        __uiMock.config = structuredClone(config);
        for (const listener of __uiMock.listeners) listener({ config: { oldValue, newValue: structuredClone(config) } }, 'local');
      }, updated);
      assert.equal(await page.locator('#prompt').inputValue(), 'SYNTHETIC-PENDING-PROMPT');
      await page.waitForFunction(() => __uiMock.config.prompt === 'SYNTHETIC-PENDING-PROMPT');
      assert.equal(await page.evaluate(() => __uiMock.config.intervalMinutes), 37);
      pass('Cross-panel config: a pending prompt edit preserves a newer setting.');
    } finally { await survivor.context.close(); }
  }
  {
    const survivor = await createPage({ full: true }); const { page } = survivor;
    try {
      await page.locator('#tab-prompt').click();
      await page.locator('#togglePrompt').click();
      await page.locator('#prompt').fill('SYNTHETIC-PENDING-MANUAL');
      const updated = { ...structuredClone(original), prompt: 'SYNTHETIC-REMOTE-FILE', promptSource: 'file' };
      await page.evaluate(config => {
        const oldValue = structuredClone(__uiMock.config);
        __uiMock.config = structuredClone(config);
        for (const listener of __uiMock.listeners) listener({ config: { oldValue, newValue: structuredClone(config) } }, 'local');
      }, updated);
      await page.waitForFunction(() => __uiMock.config.prompt === 'SYNTHETIC-PENDING-MANUAL');
      assert.equal(await page.evaluate(() => __uiMock.config.promptSource), 'manual',
        'a locally edited prompt must retain its matching source');
      pass('Cross-panel config: a pending manual prompt retains its source.');
    } finally { await survivor.context.close(); }
  }
  {
    const survivor = await createPage({ full: true }); const { page } = survivor;
    try {
      assert.deepEqual(await page.evaluate(() => __uiMock.config), original);
      assert.equal(await page.evaluate(() => __uiMock.configWrites.length), 0);
      const updated = { ...structuredClone(original), prompt: 'SYNTHETIC-OTHER-PANEL-PROMPT\n', intervalMinutes: 37 };
      await page.evaluate(config => {
        const oldValue = structuredClone(__uiMock.config);
        __uiMock.config = structuredClone(config);
        for (const listener of __uiMock.listeners) listener({ config: { oldValue, newValue: structuredClone(config) } }, 'local');
      }, updated);
      assert.deepEqual(await page.evaluate(() => __uiMock.config), updated);
      await page.evaluate(async () => {
        dispatchEvent(new Event('pagehide'));
        await new Promise(resolve => setTimeout(resolve, 250));
      });
      assert.deepEqual(await page.evaluate(() => __uiMock.config), updated,
        'pagehide in an unedited panel must not overwrite another panel’s newer configuration');
      assert.deepEqual(survivor.errors, []);
      pass('Cross-panel config: pagehide in an unedited panel preserves the newer configuration.');
    } finally { await survivor.context.close(); }
  }
  {
    const survivor = await createPage({ full: true }); const { page } = survivor;
    try {
      const updated = { ...structuredClone(original), prompt: 'SYNTHETIC-NEWER-PROMPT\n', intervalMinutes: 37 };
      await page.evaluate(config => {
        const oldValue = structuredClone(__uiMock.config);
        __uiMock.config = structuredClone(config);
        for (const listener of __uiMock.listeners) listener({ config: { oldValue, newValue: structuredClone(config) } }, 'local');
      }, updated);
      await page.locator('#interval').fill('41');
      await page.waitForFunction(() => __uiMock.config.intervalMinutes === 41);
      assert.equal(await page.evaluate(() => __uiMock.config.prompt), updated.prompt,
        'editing an interval in an older panel must not overwrite the newer prompt');
      pass('Cross-panel config: editing the interval preserves a newer prompt.');
    } finally { await survivor.context.close(); }
  }
  {
    const survivor = await createPage({ full: true }); const { page } = survivor;
    try {
      await page.locator('#tab-prompt').click();
      await page.locator('#templateName').fill('SYNTHETIC-OLD-TEMPLATE');
      await page.locator('#saveTemplate').click();
      await page.waitForFunction(() => __uiMock.templates.length === 1 && document.querySelector('#templateSelect').options.length === 2);
      await page.evaluate(() => chrome.runtime.sendMessage({ type: 'CLEAR_DATA' }));
      assert.deepEqual(await page.evaluate(() => __uiMock.templates), []);
      await page.locator('#tab-logs').click();
      await page.waitForFunction(() => !document.querySelector('#check').disabled);
      await page.locator('#tab-prompt').click();
      await page.locator('#togglePrompt').click();
      await page.locator('#prompt').fill('SYNTHETIC-NEW-PROMPT');
      await page.locator('#templateName').fill('SYNTHETIC-NEW-TEMPLATE');
      await page.locator('#saveTemplate').click();
      await page.waitForFunction(() => __uiMock.templates.some(template => template.name === 'SYNTHETIC-NEW-TEMPLATE'));
      const templates = await page.evaluate(() => structuredClone(__uiMock.templates));
      assert.deepEqual(templates.map(template => template.name), ['SYNTHETIC-NEW-TEMPLATE'],
        'saving a new template in a surviving panel must not resurrect templates cleared by another panel');
      assert.equal(templates[0].prompt, 'SYNTHETIC-NEW-PROMPT');
      assert.equal(await page.locator('#templateSelect option').count(), 2);
      assert.deepEqual(survivor.errors, []);
      pass('Clear Data: another panel cannot resurrect old templates when saving a new one.');
    } finally { await survivor.context.close(); }
  }
  {
    const failures = [];
    for (const pending of ['permission', 'config save']) {
      const fixture = { ...structuredClone(original), keepAwake: pending === 'permission' };
      const clearing = await createPage({ full: true, fixture }); const { page } = clearing;
      try {
        await page.evaluate(pending => {
          if (pending === 'permission') {
            chrome.permissions.request = async () => new Promise(resolve => { __uiMock.finishPermission = resolve; });
          } else __uiMock.deferConfigSave = true;
        }, pending);
        await page.locator('#start').click();
        await page.waitForFunction(pending => typeof __uiMock[pending === 'permission' ? 'finishPermission' : 'finishConfigSave'] === 'function', pending);
        await page.evaluate(async pending => {
          await chrome.runtime.sendMessage({ type: 'CLEAR_DATA' });
          if (pending === 'permission') __uiMock.finishPermission(true);
          else { __uiMock.deferConfigSave = false; __uiMock.finishConfigSave(); }
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }, pending);
        assert.equal(await page.evaluate(() => __uiMock.requests.filter(request => request.type === 'START').length), 0,
          `cross-panel clear must cancel START after pending ${pending}`);
        if (pending === 'config save') {
          assert.notEqual(await page.evaluate(() => __uiMock.config?.prompt), fixture.prompt,
            'a config save released after cross-panel clear must not restore the old prompt');
          assert.equal(await page.evaluate(prompt => __uiMock.configWrites.some(config => config.prompt === prompt), fixture.prompt), false,
            'a config save released after cross-panel clear must not write the old prompt');
        }
        pass(`Clear Data: another panel cancels START after pending ${pending}.`);
      } catch (error) { failures.push(error); }
      finally { await clearing.context.close(); }
    }
    if (failures.length) throw new AggregateError(failures, 'Cross-panel clear START cancellation failures');
  }
  {
    const diagnostic = await createPage({ full: true }); const { page } = diagnostic;
    await page.locator('#tab-logs').click();
    await page.evaluate(() => {
      __uiMock.stateHealthUnknown = true; __uiMock.healthReadMode = 'reject-session';
      __uiMock.deferState = true; __uiMock.stateResolvers = [];
    });
    await page.locator('#refreshLogs').click();
    await page.waitForFunction(() => __uiMock.stateResolvers.length === 1);
    await page.evaluate(async () => {
      const now = Date.now();
      __uiMock.deliveryDiagnostics = [{ sequence: 18, startedAt: now, updatedAt: now, state: 'running', stage: 'page', reason: 'starting' }];
      for (const listener of __uiMock.listeners) listener({ deliveryDiagnostics: { newValue: __uiMock.deliveryDiagnostics } }, 'local');
      __uiMock.stateResolvers[0]();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await page.locator('#deliveryDiagnosticList summary').count(), 1);
    assert.match(await page.locator('#deliveryDiagnosticHealth').innerText(), /could not be read/,
      'a list update must not discard an unknown health response');
    await diagnostic.context.close();
  }
  for (const full of [false, true]) for (const uiLanguage of ['en', 'zh_CN']) {
    const fixture = { ...structuredClone(original), extensionPriority: false };
    const { page, context, errors } = await createPage({ full, uiLanguage, fixture });
    assert.equal(await page.locator('#extensionPriority').count(), 0, 'no optional priority control remains');
    const notice = page.locator('.controls #composerPriorityNotice');
    assert.equal(await notice.isVisible(), true);
    assert.equal(await notice.textContent(), priorityNotices[uiLanguage]);
    for (const id of ['start', 'resume', 'sendNow']) {
      assert.equal(await page.locator('#' + id).getAttribute('aria-describedby'), 'composerPriorityNotice');
    }
    await assertLayout(page, full);
    assert.deepEqual(await page.evaluate(() => __uiMock.configWrites), [], 'opening old config does not migrate storage or start a task');
    const savedJob = await page.evaluate(() => structuredClone(__uiMock.job));
    await page.locator('#resume').click();
    await page.waitForFunction(() => __uiMock.job.enabled);
    assert.deepEqual(await page.evaluate(() => __uiMock.requests.find(r => r.type === 'RESUME')), { type: 'RESUME' }, 'Resume does not replay the legacy policy from the popup');
    assert.equal(await page.locator('#pause').isEnabled(), true);
    assert.equal(await notice.textContent(), priorityNotices[uiLanguage]);
    await page.locator('#pause').click();
    await page.waitForFunction(() => !__uiMock.job.enabled);
    await page.locator('#interval').fill('29');
    await page.waitForFunction(() => __uiMock.config.intervalMinutes === 29);
    assert.equal(await page.evaluate(() => __uiMock.config.extensionPriority), true);
    assert.equal(await page.evaluate(() => __uiMock.config.prompt), fixture.prompt);
    await page.locator('#tab-settings').click();
    await page.locator('#configFile').setInputFiles({ name: 'legacy-settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ config: { extensionPriority: false, intervalMinutes: 31 } })) });
    await page.waitForFunction(() => __uiMock.config.intervalMinutes === 31);
    assert.equal(await page.evaluate(() => __uiMock.config.extensionPriority), true, 'JSON import cannot restore false');
    assert.equal(await page.evaluate(() => __uiMock.config.prompt), fixture.prompt);
    await page.locator('#tab-task').click();
    assert.deepEqual(await page.evaluate(() => {
      const { enabled, nextAt, statusText, ...config } = __uiMock.job;
      return config;
    }), Object.fromEntries(Object.entries(savedJob).filter(([key]) => !['enabled', 'nextAt', 'statusText'].includes(key))), 'Pause and draft editing leave the saved task configuration unchanged');
    await page.locator('#targetSelect').selectOption('41');
    await page.locator('#start').click();
    await page.waitForFunction(() => __uiMock.requests.some(r => r.type === 'START'));
    const start = await page.evaluate(() => __uiMock.requests.find(r => r.type === 'START'));
    assert.equal(start.config.extensionPriority, true);
    assert.equal(start.config.intervalMinutes, 31);
    assert.equal(start.config.prompt, fixture.prompt);
    assert.equal(start.tabId, 41);
    assert.equal(await page.evaluate(() => __uiMock.configWrites.every(config => config.extensionPriority === true)), true);
    assert.deepEqual(await page.evaluate(() => __uiMock.permissionRequests), [], 'mandatory policy adds no permission prompt');
    assert.deepEqual(errors, []);
    await context.close();
    pass(`Mandatory notice and legacy false normalization preserve Resume, Pause, draft editing and explicit Start (full=${full}, language=${uiLanguage})`);
  }
  for (const full of [false, true]) for (const enabled of [false, true])
  for (const rejectTabs of full ? [false, true] : [false])
  for (const [id, destination] of [['setupWindows', 'setup.html'], ['manageDevices', 'devices.html?mode=browser-managed']]) {
    const { page, context, errors } = await createPage({ full, enabled });
    await page.locator('#tab-settings').click();
    assert.equal(await page.locator('#setupWindows').count(), 1, 'guided Windows setup is directly available');
    assert.equal(await page.locator('#manageDevices').count(), 1, 'existing controls have a dedicated entry');
    const before = await page.evaluate(() => structuredClone(__uiMock.job));
    const popupUrl = page.url();
    const snapshotKeys = ['config', 'configWrites', 'job', 'requests', 'tabs', 'tabAttempts', 'permissionRequests'];
    await page.evaluate(({ rejectTabs, snapshotKeys }) => {
      __uiMock.rejectTabs = rejectTabs;
      __uiMock.deferConfigSave = true;
      addEventListener('pagehide', () => {
        sessionStorage.setItem('navigationSnapshot', JSON.stringify(Object.fromEntries(snapshotKeys.map(key => [key, __uiMock[key]]))));
      }, { once: true });
    }, { rejectTabs, snapshotKeys });
    if (!full && !enabled && id === 'setupWindows') await capture(page, 'windows-entry-en.png');
    await page.locator('#' + id).click();
    await page.waitForFunction(() => typeof __uiMock.finishConfigSave === 'function');
    assert.equal(page.url(), popupUrl, 'navigation must wait for draft persistence');
    assert.deepEqual(await page.evaluate(() => __uiMock.tabAttempts), [], 'no tab may open before draft persistence');
    await page.evaluate(() => __uiMock.finishConfigSave());
    const navigated = !full || rejectTabs;
    if (navigated) {
      await page.waitForURL('https://ui-fixture.invalid/' + destination, { timeout: 5000 });
      assert.equal(await page.locator('#navigationFixture').textContent(), destination.split('?')[0]);
    } else {
      await page.waitForFunction(() => __uiMock.tabs.length === 1);
      assert.equal(page.url(), popupUrl, 'full console remains open when tab creation succeeds');
    }
    const state = await page.evaluate(({ navigated, snapshotKeys }) => navigated
      ? JSON.parse(sessionStorage.getItem('navigationSnapshot'))
      : Object.fromEntries(snapshotKeys.map(key => [key, __uiMock[key]])), { navigated, snapshotKeys });
    const tab = { url: 'https://ui-fixture.invalid/' + destination };
    assert.deepEqual(state.tabAttempts, full ? [tab] : [], 'toolbar popup never attempts an extension tab');
    assert.deepEqual(state.tabs, full && !rejectTabs ? [tab] : []);
    assert.deepEqual(state.configWrites, [original], 'draft is persisted exactly once before navigation');
    assert.deepEqual(state.config, original);
    assert.deepEqual(state.job, before, 'scheduler state is unchanged');
    assert.deepEqual(state.requests.filter(r => !['GET_STATE', 'SAVE_DRAFT'].includes(r.type)), []);
    assert.equal(state.requests.filter(r => r.type === 'SAVE_DRAFT').length, 1);
    assert.deepEqual(state.permissionRequests, []);
    assert.deepEqual(errors, []);
    await context.close(); pass(`Windows ${id} preserves draft and scheduler (full=${full}, enabled=${enabled}, rejectTabs=${rejectTabs})`);
  }
  for (const enabled of [false, true]) {
    const { page, context } = await createPage({ enabled, availableTargets: [
      { id: 41, title: 'Reused tab ID', url: 'https://chatgpt.com/c/unrelated' },
      { id: 99, title: 'Reopened original dot', url: 'https://chatgpt.com/dots/home' },
    ] });
    const before = await page.evaluate(() => structuredClone(__uiMock.job));
    await page.locator('#expand').click();
    await page.waitForFunction(() => __uiMock.tabs.length === 1);
    const expanded = new URL(await page.evaluate(() => __uiMock.tabs[0].url));
    assert.equal(expanded.searchParams.get('targetTabId'), null, 'inherited job ID must not become an explicit choice');
    assert.deepEqual(await page.evaluate(() => __uiMock.job), before);
    assert.deepEqual(await page.evaluate(() => __uiMock.requests.filter(r => /^(START|RESUME|SEND)/.test(r.type))), []);
    await context.close(); pass(`Expand preserves saved-URL recovery rather than an inherited tab ID (enabled=${enabled})`);
  }
  {
    const targets = [
      { id: 41, title: 'Reused old tab ID', url: 'https://chatgpt.com/c/unrelated' },
      { id: 99, title: 'Reopened original dot', url: 'https://chatgpt.com/dots/home/' },
    ];
    const { page, context, errors } = await createPage({ full: true, initialTarget: null, availableTargets: targets });
    assert.equal(await page.locator('#targetSelect').inputValue(), '99');
    const before = await page.evaluate(() => structuredClone(__uiMock.job));
    await page.locator('#check').click();
    await page.waitForFunction(() => __uiMock.requests.some(r => r.type === 'CHECK_PAGE'));
    assert.equal(await page.evaluate(() => __uiMock.requests.find(r => r.type === 'CHECK_PAGE').tabId), 99);
    assert.deepEqual(await page.evaluate(() => __uiMock.job), before);
    assert.deepEqual(await page.evaluate(() => __uiMock.requests.filter(r => /^(START|RESUME|SEND)/.test(r.type))), []);
    assert.deepEqual(errors, []);
    await context.close(); pass('Full console resolves the saved exact URL after tab-ID reuse without resuming or sending');
  }
  for (const ambiguous of [false, true]) {
    const targets = [{ id: 41, title: 'Unrelated', url: 'https://chatgpt.com/c/unrelated' }];
    if (ambiguous) targets.push({ id: 99, title: 'Original A', url: 'https://chatgpt.com/dots/home' },
      { id: 100, title: 'Original B', url: 'https://chatgpt.com/dots/home/' });
    const { page, context, errors } = await createPage({ full: true, initialTarget: null, availableTargets: targets });
    assert.equal(await page.locator('#targetSelect').inputValue(), '');
    await page.locator('#check').click();
    assert.ok((await page.locator('#feedback').textContent()).includes('Select a target tab'));
    assert.deepEqual(await page.evaluate(() => __uiMock.requests.filter(r => /^(CHECK_PAGE|START|RESUME|SEND)/.test(r.type))), []);
    await page.locator('#targetSelect').selectOption('41');
    await page.locator('#tab-logs').click();
    await page.locator('#refreshLogs').click();
    await page.waitForFunction(() => __uiMock.requests.filter(r => r.type === 'GET_STATE').length >= 2);
    assert.equal(await page.locator('#targetSelect').inputValue(), '41', 'explicit manual selection wins over saved-target recovery');
    assert.deepEqual(errors, []);
    await context.close(); pass(`Full console refuses ${ambiguous ? 'duplicate' : 'missing'} saved targets without probing the active page`);
  }
  // Use catalog-key collisions to catch accidental translation of private content.
  const bilingualFixture = { ...structuredClone(original), prompt: '设置\n  保存\n',
    queue: [{ name: '设置', text: '保存\n  任务\n' }, { name: '任务', text: '设置' }] };
  for (const full of [false, true]) {
    const localized = await createPage({ full, fixture: bilingualFixture, title: '设置' });
    const { page } = localized;
    assert.equal(await page.evaluate(() => navigator.language), 'zh-CN');
    assert.equal(await page.evaluate(() => Object.hasOwn(__uiMock, 'uiLanguage')), false);
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.locator('#language').inputValue(), 'en');
    assert.equal((await page.locator('#tab-settings').textContent()).trim(), '⌘Settings');
    const initialRequests = await page.evaluate(() => __uiMock.requests.filter(r => /^(START|SEND)/.test(r.type)));
    const targetBefore = await page.locator('#target').textContent();
    const optionBefore = await page.locator('#targetSelect option[value="41"]').textContent();
    assert.ok(targetBefore.includes('设置'));
    assert.ok(optionBefore.includes('设置'));
    for (const language of ['en', 'zh_CN', 'en']) {
      await page.locator('#tab-settings').click();
      if (await page.locator('#language').inputValue() !== language) await page.locator('#language').selectOption(language);
      await page.waitForFunction(expected => document.querySelector('#tab-settings').textContent.includes(expected), language === 'en' ? 'Settings' : '设置');
      if (language !== 'en' || await page.evaluate(() => Object.hasOwn(__uiMock, 'uiLanguage'))) {
        assert.equal(await page.evaluate(() => __uiMock.uiLanguage), language);
      }
      assert.equal((await page.locator('#tab-settings').textContent()).trim(), language === 'en' ? '⌘Settings' : '⌘设置');
      assert.equal(await page.locator('#composerPriorityNotice').textContent(), priorityNotices[language]);
      assert.equal(await page.locator('#composerPriorityNotice').isVisible(), true);
      await page.locator('#tab-logs').click();
      await page.locator('.help-card summary').click();
      const waitingHelp = await page.locator('.help-card p').first().innerText();
      assert.match(waitingHelp, language === 'en' ? /When a send round ends with an unknown result, the task pauses automatically, whether or not a dispatch was recorded; unknown does not mean the server rejected it\./ : /终态未知时，任务会自动暂停/);
      assert.match(waitingHelp, language === 'en' ? /Check the target conversation.*Resume may resend/ : /先检查目标会话.*继续可能重发/);
      await page.locator('.help-card summary').click();
      assert.equal(await page.locator('#prompt').getAttribute('placeholder'), language === 'en' ? 'Enter the complete prompt to repeat...' : '输入需要重复发送的完整提示词…');
      assert.equal(await page.locator('#expand').getAttribute('aria-label'), language === 'en' ? 'Open full console' : '打开完整控制台');
      for (const panel of ['task', 'prompt', 'settings', 'logs']) {
        await page.locator('#tab-' + panel).click();
        await assertLayout(page, full);
        if (full) {
          await page.setViewportSize({ width: 620, height: 900 });
          await assertLayout(page, true);
          await page.setViewportSize({ width: 1200, height: 900 });
        }
      }
      assert.equal(await page.locator('#target').textContent(), targetBefore);
      assert.equal(await page.locator('#targetSelect option[value="41"]').textContent(), optionBefore);
      await page.locator('#tab-prompt').click();
      const queueNames = await page.locator('#queueList').innerText();
      assert.ok(queueNames.includes('设置') && queueNames.includes('任务'));
      await page.locator('#togglePrompt').click();
      assert.equal(await page.locator('#prompt').inputValue(), bilingualFixture.prompt);
      await page.locator('#queueList .queue-actions').first().locator('button').nth(2).click();
      // Queue editing is an explicit reveal; match by stable editor rather than translated labels.
      assert.equal(await page.locator('#queueEditor').isVisible(), true);
      assert.equal(await page.locator('#queueName').inputValue(), bilingualFixture.queue[0].name);
      assert.equal(await page.locator('#queueText').inputValue(), bilingualFixture.queue[0].text);
      await page.locator('#cancelQueueEdit').click();
      assert.deepEqual(await page.evaluate(() => ({ prompt: __uiMock.config.prompt, queue: __uiMock.config.queue })),
        { prompt: bilingualFixture.prompt, queue: bilingualFixture.queue });
    }
    await page.locator('#tab-task').click();
    assert.deepEqual(await page.evaluate(() => __uiMock.requests.filter(r => /^(START|SEND)/.test(r.type))), initialRequests);
    assert.deepEqual(localized.errors, []);
    await localized.context.close();
  }
  pass('English default on a Chinese browser; en/zh_CN/en switching preserves private content and titles, fits popup/desktop/narrow panels, and sends no START/SEND requests.');

  {
    const localized = await createPage({ fixture: bilingualFixture });
    const { page } = localized;
    await page.locator('#tab-settings').click();
    await page.locator('#includeSecrets').check();
    await page.locator('#exportConfig').click();
    const exportedBefore = await page.evaluate(async () => await __uiMock.exports.at(-1).text());
    const configBefore = await page.evaluate(() => structuredClone(__uiMock.config));
    for (const language of ['en', 'zh_CN', 'en', 'zh_CN', 'en']) {
      if (await page.locator('#language').inputValue() !== language) await page.locator('#language').selectOption(language);
      const expected = language === 'en'
        ? 'Settings exported with prompt content. Store the file securely.'
        : '已导出包含正文的配置，请自行妥善保存。';
      await page.waitForFunction(text => document.querySelector('#feedback').textContent === text, expected);
      assert.equal(await page.evaluate(async () => await __uiMock.exports.at(-1).text()), exportedBefore);
      assert.equal(await page.evaluate(() => __uiMock.exports.length), 1);
      assert.deepEqual(await page.evaluate(() => __uiMock.config), configBefore);
      await assertSealed(page, [bilingualFixture.prompt, bilingualFixture.queue[0].text]);
    }
    const exported = JSON.parse(exportedBefore);
    assert.equal(exported.config.prompt, bilingualFixture.prompt);
    assert.deepEqual(exported.config.queue, bilingualFixture.queue);
    await page.locator('#tab-task').click();
    await page.locator('#check').click();
    await page.waitForFunction(() => document.querySelector('#feedback').textContent === '合成页面可用；未填写或发送。');
    await page.locator('#tab-settings').click();
    for (const language of ['zh_CN', 'en']) {
      await page.locator('#language').selectOption(language);
      await page.waitForFunction(value => document.documentElement.lang === value, language === 'zh_CN' ? 'zh-CN' : 'en');
      assert.equal(await page.locator('#feedback').textContent(), '合成页面可用；未填写或发送。');
    }
    assert.deepEqual(await page.evaluate(() => __uiMock.requests.filter(r => /^(START|SEND)/.test(r.type))), []);
    assert.deepEqual(localized.errors, []);
    await localized.context.close();
  }
  pass('Feedback survives repeated en/zh_CN/en switches; exported private content is unchanged, arbitrary backend feedback stays untouched, and no messages are sent.');

  if (screenshots) {
    for (const full of [false, true]) {
      const fixture = { ...structuredClone(original), queue: [
        { name: 'Synthetic queue A', text: 'SYNTHETIC-QUEUE-A' },
        { name: 'Synthetic queue B', text: 'SYNTHETIC-QUEUE-B' },
      ] };
      const asset = await createPage({ full, fixture, title: 'Synthetic project conversation', statusText: 'Paused — synthetic demonstration.' });
      await asset.page.evaluate(() => {
        const previous = structuredClone(__uiMock.logs);
        __uiMock.logs = [{ at: Date.now(), event: 'paused', message: 'Paused for a synthetic demonstration. No real content is used.' }];
        for (const listener of __uiMock.listeners) listener({ logs: { oldValue: previous, newValue: structuredClone(__uiMock.logs) } }, 'local');
      });
      assert.equal(await asset.page.locator('#statusText').textContent(), 'Paused — synthetic demonstration.');
      assert.deepEqual(await asset.page.locator('.queue-item-name').allTextContents(), ['Synthetic queue A', 'Synthetic queue B']);
      assert.match(await asset.page.locator('#logList').textContent(), /Paused for a synthetic demonstration/);
      await assertLayout(asset.page, full);
      await assertSealed(asset.page, ['SYNTHETIC-PRIVATE-PROMPT', 'SYNTHETIC-QUEUE-A', 'SYNTHETIC-QUEUE-B']);
      await asset.page.mouse.move(0, 0);
      await capture(asset.page, full ? 'store-2.1.0-en-console.png' : 'store-2.1.0-en-popup.png');
      assert.deepEqual(asset.errors, []);
      await asset.context.close();
    }
  }

  const { page, context, errors } = await createPage({ uiLanguage: 'zh_CN' });
  assert.equal(await page.locator('#waitForIdle').isChecked(), false);
  await page.locator('#tab-settings').click();
  assert.match(await page.locator('#panel-settings').innerText(), /默认.*打断/);
  await page.locator('#waitForIdle').check();
  await page.waitForFunction(() => __uiMock.config.waitForIdle === true);
  await page.locator('#waitForIdle').uncheck();
  await page.waitForFunction(() => __uiMock.config.waitForIdle === false);
  assert.equal(await page.locator('#extensionPriority').count(), 0);
  assert.equal(await page.locator('#composerPriorityNotice').textContent(), priorityNotices.zh_CN);
  assert.equal(await page.evaluate(() => __uiMock.config.extensionPriority), true);
  await page.locator('#tab-task').click();
  pass('Interrupt is the visible default; optional waiting persists without disabling mandatory composer priority.');
  await page.locator('#tab-settings').click();
  assert.equal(await page.locator('#sendMethod').inputValue(), 'auto');
  assert.equal(await page.locator('#sendMethod option').count(), 3);
  await page.locator('#sendMethod').selectOption('ctrl-enter');
  await page.waitForFunction(() => __uiMock.config.sendMethod === 'ctrl-enter');
  await page.locator('#tab-task').click();
  assert.match(await page.locator('#configHint').innerText(), /Ctrl\+Enter/);
  pass('Send strategy defaults to auto and a selected Ctrl+Enter method is saved and visible on the task page.');
  await assertSealed(page, ['SYNTHETIC-PRIVATE-PROMPT', 'SYNTHETIC-QUEUE-A', 'SYNTHETIC-QUEUE-B']);
  await page.locator('#tab-prompt').click();
  await assertSealed(page, ['SYNTHETIC-PRIVATE-PROMPT', 'SYNTHETIC-QUEUE-A']);
  await page.locator('#togglePrompt').click();
  assert.equal(await page.locator('#prompt').inputValue(), original.prompt);
  await page.locator('#tab-task').click();
  await assertSealed(page, ['SYNTHETIC-PRIVATE-PROMPT']);
  pass('Privacy: stored prompt and queue text never enter DOM/AX until explicit reveal; leaving panel wipes editor values.');

  await page.locator('#tab-prompt').click();
  await page.locator('#togglePrompt').click();
  const importedText = '  SYNTHETIC-IMPORTED-CONTENT\nLine two.\n';
  await page.locator('#promptFile').setInputFiles({ name: 'synthetic-only.txt', mimeType: 'text/plain', buffer: Buffer.from(importedText) });
  await page.waitForFunction(expected => __uiMock.config.prompt === expected, importedText);
  await assertSealed(page, ['SYNTHETIC-IMPORTED-CONTENT', 'SYNTHETIC-PRIVATE-PROMPT']);
  assert.match(await page.locator('#importStatus').innerText(), /已导入/);
  await page.locator('#tab-settings').click();
  for (const language of ['en', 'zh_CN', 'en', 'zh_CN']) {
    await page.locator('#language').selectOption(language);
    await page.waitForFunction(expected => document.querySelector('#importStatus').textContent.includes(expected),
      language === 'en' ? 'Imported 1 files' : '已导入 1 个文件');
    assert.equal(await page.evaluate(() => __uiMock.config.prompt), importedText);
  }
  await page.locator('#tab-prompt').click();
  assert.ok(!(await page.locator('body').innerText()).includes('synthetic-only.txt'));
  pass('Local import: original spaces/newlines preserved; imported text immediately hidden; filename excluded from UI diagnostics.');

  await page.locator('#queueFiles').setInputFiles([
    { name: 'a.md', mimeType: 'text/markdown', buffer: Buffer.from('SYNTHETIC-BATCH-A') },
    { name: 'b.txt', mimeType: 'text/plain', buffer: Buffer.from('SYNTHETIC-BATCH-B') },
  ]);
  await page.waitForFunction(() => __uiMock.config.queue.length === 4 && __uiMock.config.mode === 'queue-loop');
  await page.getByRole('button', { name: '上移第 4 项', exact: true }).click();
  await page.waitForFunction(() => __uiMock.config.queue[2].text === 'SYNTHETIC-BATCH-B');
  await assertSealed(page, ['SYNTHETIC-BATCH-A', 'SYNTHETIC-BATCH-B']);
  await page.getByRole('button', { name: '编辑正文第 3 项', exact: true }).click();
  assert.equal(await page.locator('#queueText').inputValue(), 'SYNTHETIC-BATCH-B');
  await page.locator('#queueText').fill('SYNTHETIC-EDITED-QUEUE');
  await page.locator('#saveQueueItem').click();
  await page.waitForFunction(() => __uiMock.config.queue[2].text === 'SYNTHETIC-EDITED-QUEUE');
  await assertSealed(page, ['SYNTHETIC-EDITED-QUEUE']);
  pass('Queues: batch import, order changes and explicit edit/save work while keeping all unselected contents out of DOM.');

  await page.locator('#templateName').fill('合成本机模板');
  await page.locator('#saveTemplate').click();
  await page.waitForFunction(() => __uiMock.templates.length === 1);
  await page.locator('#togglePrompt').click();
  await page.locator('#prompt').fill('SYNTHETIC-TEMP-EDIT');
  await page.locator('#templateSelect').selectOption({ label: '合成本机模板' });
  await page.locator('#loadTemplate').click();
  await page.waitForFunction(expected => __uiMock.config.prompt === expected, importedText);
  await assertSealed(page, ['SYNTHETIC-IMPORTED-CONTENT']);
  assert.equal(await page.evaluate(() => __uiMock.requests.filter(request => request.type === 'START').length), 0);
  pass('Templates: save/load stays local, hides restored content and never starts a task.');

  await page.locator('#tab-settings').click();
  await page.locator('#exportConfig').click();
  const safeExport = await page.evaluate(async () => JSON.parse(await __uiMock.exports.at(-1).text()));
  assert.equal(safeExport.includesPrompt, false);
  assert.equal(Object.hasOwn(safeExport.config, 'prompt'), false);
  assert.equal(Object.hasOwn(safeExport.config, 'queue'), false);
  assert.equal(safeExport.config.sendMethod, 'ctrl-enter');
  assert.ok(!JSON.stringify(safeExport).includes('SYNTHETIC-'));
  await page.locator('#includeSecrets').check();
  await page.locator('#exportConfig').click();
  const explicitExport = await page.evaluate(async () => JSON.parse(await __uiMock.exports.at(-1).text()));
  assert.equal(explicitExport.config.prompt, importedText);
  assert.equal(await page.locator('#includeSecrets').isChecked(), false);
  await page.locator('#configFile').setInputFiles({ name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ config: { intervalMinutes: 37, mode: 'repeat', sendMethod: 'button', extensionPriority: false } })) });
  await page.waitForFunction(() => __uiMock.config.intervalMinutes === 37);
  assert.equal(await page.evaluate(() => __uiMock.config.prompt), importedText);
  assert.equal(await page.locator('#sendMethod').inputValue(), 'button');
  assert.equal(await page.evaluate(() => __uiMock.config.extensionPriority), true);
  const beforeInvalidImport = await page.evaluate(() => structuredClone(__uiMock.config));
  await page.locator('#configFile').setInputFiles({ name: 'invalid-settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ config: { intervalMinutes: 99, extensionPriority: 'false' } })) });
  await page.waitForFunction(() => document.querySelector('#feedback').classList.contains('error'));
  assert.deepEqual(await page.evaluate(() => __uiMock.config), beforeInvalidImport, 'invalid legacy flag cannot overwrite the draft');
  pass('Backup: default JSON omits prompts/queue; explicit content export is one-shot; legacy false normalizes to true and invalid priority leaves the draft intact.');

  await page.evaluate(() => { __uiMock.grantPower = false; });
  await page.locator('#keepAwake').click();
  await page.waitForFunction(() => !document.querySelector('#keepAwake').checked);
  assert.deepEqual(await page.evaluate(() => __uiMock.permissionRequests.at(-1)), { permissions: ['power'] });
  await page.locator('#theme').selectOption('dark');
  assert.equal(await page.locator('body').getAttribute('data-theme'), 'dark');
  await assertLayout(page);
  await capture(page, 'popup-dark-settings.png');
  await page.locator('#theme').selectOption('light');
  pass('Optional power: denied permission does not enable the setting; light/dark themes stay local.');

  await page.locator('#tab-task').click();
  await page.locator('#targetSelect').selectOption('42');
  await page.locator('#start').click();
  await page.waitForFunction(() => document.querySelector('#badge').textContent === '运行中');
  assert.equal(await page.evaluate(() => __uiMock.requests.find(request => request.type === 'START').tabId), 42);
  assert.equal(await page.evaluate(() => __uiMock.job.prompt), importedText);
  assert.equal(await page.evaluate(() => __uiMock.job.sendMethod), 'button');
  assert.equal(await page.locator('#sendMethod').isEnabled(), false);
  await page.locator('#pause').click();
  await page.waitForFunction(() => document.querySelector('#badge').textContent === '已暂停');
  await page.locator('#interval').fill('45');
  await page.locator('#tab-settings').click();
  await page.locator('#sendMethod').selectOption('ctrl-enter');
  await page.locator('#tab-task').click();
  await page.locator('#resume').click();
  await page.waitForFunction(() => document.querySelector('#badge').textContent === '运行中');
  assert.equal(await page.locator('#interval').inputValue(), '37');
  assert.equal(await page.locator('#sendMethod').inputValue(), 'button');
  await page.waitForFunction(() => __uiMock.config.intervalMinutes === 45);
  await page.locator('#pause').click();
  await page.waitForFunction(() => document.querySelector('#badge').textContent === '已暂停');
  assert.equal(await page.locator('#interval').inputValue(), '45');
  assert.equal(await page.locator('#sendMethod').inputValue(), 'ctrl-enter');
  await assertSealed(page, ['SYNTHETIC-IMPORTED-CONTENT']);
  pass('Task control: explicit target is passed; Resume keeps original config while Pause restores the separately edited draft.');

  await page.locator('#resume').click();
  await page.waitForFunction(() => document.querySelector('#badge').textContent === '运行中');
  await page.evaluate(() => { __uiMock.deferSend = true; });
  await page.locator('#sendNow').click();
  await page.waitForFunction(() => typeof __uiMock.finishSend === 'function');
  assert.equal(await page.locator('#pause').isEnabled(), true);
  await page.locator('#pause').click();
  await page.waitForFunction(() => document.querySelector('#badge').textContent === '已暂停');
  await page.evaluate(() => { __uiMock.finishSend(); });
  assert.match(await page.locator('#feedback').innerText(), /暂停/);
  pass('Cancellation: Pause remains available during a pending send and a late send result cannot overwrite pause feedback.');

  for (const name of ['task', 'prompt', 'settings', 'logs']) { await page.locator('#tab-' + name).click(); await assertLayout(page); }
  await page.locator('#tab-task').click();
  await capture(page, 'popup-light-task.png');
  await page.locator('#expand').click();
  await page.waitForFunction(() => __uiMock.tabs.length === 1);
  const expanded = new URL(await page.evaluate(() => __uiMock.tabs[0].url));
  assert.equal(expanded.searchParams.get('view'), 'full'); assert.equal(expanded.searchParams.get('targetTabId'), '42');
  assert.deepEqual(errors, []);
  pass('Popup layout: all four panels fit 650 px, fixed task controls stay visible; full-console link preserves target ID.');
  await context.close();

  const full = await createPage({ full: true, enabled: true, uiLanguage: 'zh_CN' });
  for (const name of ['task', 'prompt', 'settings', 'logs']) { await full.page.locator('#tab-' + name).click(); await assertLayout(full.page, true); }
  await full.page.locator('#tab-task').click(); await capture(full.page, 'console-light-task.png');
  await full.page.locator('#tab-prompt').click(); await capture(full.page, 'console-light-prompts.png');
  await assertSealed(full.page, ['SYNTHETIC-PRIVATE-PROMPT', 'SYNTHETIC-QUEUE-A']);
  await full.page.setViewportSize({ width: 620, height: 900 }); await assertLayout(full.page, true);
  await full.page.locator('#tab-settings').click(); await assertLayout(full.page, true);
  assert.deepEqual(full.errors, []);
  pass('Full console: desktop and narrow layouts do not overflow, target selection survives, private text remains hidden.');
  await full.page.locator('#pause').click();
  await full.page.waitForFunction(() => document.querySelector('#badge').textContent === '已暂停');
  await full.page.evaluate(() => {
    const native = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      const data = await native.call(this);
      await new Promise(resolve => { __uiMock.finishImport = resolve; });
      return data;
    };
  });
  await full.page.locator('#tab-prompt').click();
  await full.page.locator('#promptFile').setInputFiles({ name: 'delayed-synthetic.txt', mimeType: 'text/plain', buffer: Buffer.from('SYNTHETIC-CANCELLED-IMPORT') });
  await full.page.waitForFunction(() => typeof __uiMock.finishImport === 'function');
  await full.page.locator('#tab-settings').click();
  await full.page.locator('#clearData').click();
  await full.page.locator('#confirmClear').click();
  await full.page.waitForFunction(() => __uiMock.job === null && __uiMock.config === null);
  await full.page.evaluate(() => __uiMock.finishImport());
  await full.page.waitForFunction(() => document.querySelector('#importStatus').textContent.includes('导入已取消'));
  assert.equal(await full.page.evaluate(() => __uiMock.config), null);
  await assertSealed(full.page, ['SYNTHETIC-CANCELLED-IMPORT', 'SYNTHETIC-PRIVATE-PROMPT']);
  assert.deepEqual(full.errors, []);
  pass('Clear/import race: clearing all data invalidates an in-flight file import so old private contents cannot be written back.');
  await full.context.close();

  {
    const clearing = await createPage({ full: true }); const { page } = clearing;
    await page.evaluate(() => { __uiMock.deferClear = true; });
    await page.locator('#tab-settings').click();
    await page.locator('#clearData').click(); await page.locator('#confirmClear').click();
    await page.waitForFunction(() => typeof __uiMock.finishClear === 'function');
    await page.evaluate(() => dispatchEvent(new Event('pagehide')));
    assert.equal(await page.evaluate(() => __uiMock.configWrites.length), 0);
    assert.equal(await page.evaluate(() => __uiMock.config), null);
    await page.evaluate(() => __uiMock.finishClear());
    pass('Clear Data: pagehide during a pending clear cannot restore the previous draft.');
    await clearing.context.close();
  }
  {
    const clearing = await createPage({ full: true }); const { page } = clearing;
    await page.evaluate(() => {
      __uiMock.config = null;
      for (const listener of __uiMock.listeners) listener({ config: { newValue: undefined } }, 'local');
      dispatchEvent(new Event('pagehide'));
    });
    assert.equal(await page.evaluate(() => __uiMock.configWrites.length), 0);
    assert.equal(await page.evaluate(() => __uiMock.config), null);
    pass('Clear Data: another panel observing config removal cannot restore the previous draft.');
    await clearing.context.close();
  }

  for (const language of ['en', 'zh_CN']) {
    const diagnostic = await createPage({ full: true, uiLanguage: language });
    const { page } = diagnostic;
    await page.locator('#tab-logs').click();
    const saved = await page.evaluate(() => JSON.stringify({ config: __uiMock.config, job: __uiMock.job }));
    await page.evaluate(() => { __uiMock.deferTiming = true; });
    await page.locator('#diagnoseTiming').click();
    await page.waitForFunction(() => typeof __uiMock.finishTiming === 'function');
    assert.equal(await page.locator('#diagnoseTiming').isDisabled(), true);
    await page.evaluate(() => { __uiMock.finishTiming(); __uiMock.deferTiming = false; });
    await page.waitForFunction(() => !document.querySelector('#diagnoseTiming').disabled);
    assert.equal(await page.locator('#timingDiagnostics').innerText(), language === 'en'
      ? 'Authorization: 3 ms; ok=true; allowed=false | Page timers: 991 / 1992 ms; hidden=true'
      : '授权消息: 3 ms; ok=true; allowed=false | 页面计时: 991 / 1992 ms; hidden=true');
    await page.evaluate(() => { __uiMock.timingRejected = true; });
    await page.locator('#diagnoseTiming').click();
    await page.waitForFunction(() => !document.querySelector('#diagnoseTiming').disabled);
    assert.equal(await page.locator('#timingDiagnostics').innerText(), language === 'en' ? 'Diagnostics unavailable.' : '诊断暂不可用。');
    assert.ok(!(await page.content()).includes('SYNTHETIC_PRIVATE_API_ERROR'));
    await page.evaluate(() => { __uiMock.timingRejected = false; });
    await page.locator('#diagnoseTiming').click();
    await page.waitForFunction(() => document.querySelector('#timingDiagnostics').textContent.includes('1992'));
    assert.equal(await page.evaluate(() => JSON.stringify({ config: __uiMock.config, job: __uiMock.job })), saved);
    assert.equal(await page.evaluate(() => __uiMock.requests.filter(r => /^(START|RESUME|SEND)/.test(r.type)).length), 0);
    await assertSealed(page, ['SYNTHETIC-PRIVATE-PROMPT', 'SYNTHETIC-QUEUE-A']);
    assert.deepEqual(diagnostic.errors, []);
    pass(`Timing diagnostics (${language}): bounded values, busy control, private API error suppression, retry and no task mutation.`);
    await diagnostic.context.close();
  }

  {
    const diagnostic = await createPage({ full: true }); const { page } = diagnostic;
    await page.locator('#tab-logs').click();
    await page.evaluate(() => {
      const now = Date.now();
      const trace = { sequence: 1, startedAt: now - 180000, updatedAt: now, state: 'running',
        stage: 'readiness', reason: 'waiting-send', counters: { modelWrites: 1, readinessChecks: 88, preSubmitTransportBackoffs: 3 },
        timings: { elapsedMs: 180000, modelWriteMs: 24, maxPreSubmitTransportBackoffMs: 600 },
        observations: { hidden: true, sendEnabled: false },
        history: [{ elapsedMs: 0, stage: 'prepare', reason: 'prepared' },
          { elapsedMs: 200, stage: 'readiness', reason: 'waiting-send' }], droppedHistory: 0,
        prompt: 'SYNTHETIC_PRIVATE_DIAGNOSTIC_INJECTION' };
      __uiMock.deliveryDiagnostics = [trace];
      for (const listener of __uiMock.listeners) listener({ deliveryDiagnostics: { newValue: [trace] },
        diagnosticsHealth: { newValue: { persistence: 'degraded', writeFailures: 1 } } }, 'local');
    });
    await page.locator('#deliveryDiagnosticList summary').click();
    const text = await page.locator('#deliveryDiagnosticList').innerText();
    assert.match(text, /readiness \/ waiting-send \| 180 s/);
    assert.match(text, /Pre-send transport waits: 3/);
    assert.match(text, /"maxPreSubmitTransportBackoffMs": 600/);
    assert.match(text, /"modelWrites": 1/); assert.match(text, /"readinessChecks": 88/);
    assert.ok(!text.includes('SYNTHETIC_PRIVATE_DIAGNOSTIC_INJECTION'));
    assert.match(await page.locator('#deliveryDiagnosticHealth').innerText(), /persistence failed/);
    await page.setViewportSize({ width: 390, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.evaluate(() => {
      const trace = { ...__uiMock.deliveryDiagnostics[0], updatedAt: Date.now() };
      __uiMock.deliveryDiagnostics = [trace];
      for (const listener of __uiMock.listeners) listener({ deliveryDiagnostics: { newValue: [trace] } }, 'local');
    });
    assert.equal(await page.locator('#deliveryDiagnosticList details').evaluate(element => element.open), true,
      'Live updates must preserve the expanded diagnostic record');
    const download = page.waitForEvent('download'); await page.locator('#exportLogs').click(); await download;
    const report = await page.evaluate(async () => JSON.parse(await __uiMock.exports.at(-1).text()));
    assert.equal(report.version, 5); assert.equal(report.deliveries[0].counters.modelWrites, 1);
    assert.equal(report.deliveries[0].counters.preSubmitTransportBackoffs, 3);
    assert.equal(report.deliveries[0].timings.maxPreSubmitTransportBackoffMs, 600);
    assert.equal(report.deliveries[0].startedAt, undefined);
    assert.ok(!JSON.stringify(report).includes('SYNTHETIC_PRIVATE_DIAGNOSTIC_INJECTION'));
    assert.equal(await page.evaluate(() => __uiMock.requests.filter(r => /^(START|RESUME|SEND)/.test(r.type)).length), 0);
    assert.deepEqual(diagnostic.errors, []);
    pass('Delivery diagnostics: live stage/counters, persistence warning, narrow layout and schema5 export without private fields.');
    await diagnostic.context.close();
  }
  {
    const diagnostic = await createPage({ full: true }); const { page } = diagnostic;
    await page.locator('#tab-logs').click();
    await page.evaluate(() => {
      __uiMock.sessionDiagnosticsHealth = { persistence: 'degraded', writeFailures: 1 };
      for (const listener of __uiMock.listeners) listener({
        diagnosticsHealth: { newValue: __uiMock.sessionDiagnosticsHealth },
      }, 'session');
    });
    assert.match(await page.locator('#deliveryDiagnosticHealth').innerText(), /persistence failed/);
    await page.evaluate(() => {
      __uiMock.diagnosticsHealth = { persistence: 'available', writeFailures: 0 };
      for (const listener of __uiMock.listeners) listener({
        diagnosticsHealth: { newValue: __uiMock.diagnosticsHealth },
      }, 'local');
    });
    assert.match(await page.locator('#deliveryDiagnosticHealth').innerText(), /persistence failed/,
      'a local update must not clear a session-level persistence failure');
    await page.evaluate(() => {
      __uiMock.sessionDiagnosticsHealth = undefined;
      for (const listener of __uiMock.listeners) listener({ diagnosticsHealth: { newValue: undefined } }, 'session');
    });
    assert.equal(await page.locator('#deliveryDiagnosticHealth').innerText(), '',
      'removing session health must reveal the latest local state');
    assert.deepEqual(diagnostic.errors, []);
    pass('Delivery diagnostics: session persistence failure survives later local health updates.');
    await diagnostic.context.close();
  }
  {
    const clearing = await createPage({ full: true }); const { page } = clearing;
    await page.locator('#tab-logs').click();
    await page.evaluate(() => { __uiMock.deferState = true; __uiMock.stateResolvers = []; });
    await page.locator('#refreshLogs').click();
    await page.waitForFunction(() => __uiMock.stateResolvers.length === 1);
    await page.locator('#tab-settings').click();
    await page.locator('#clearData').click();
    await page.locator('#confirmClear').click();
    await page.waitForFunction(() => __uiMock.job === null && __uiMock.config === null);
    await page.evaluate(() => { __uiMock.stateResolvers[0](); });
    await page.waitForFunction(() => __uiMock.stateResolvers.length >= 2);
    await page.evaluate(() => dispatchEvent(new Event('pagehide')));
    assert.equal(await page.evaluate(() => __uiMock.configWrites.length), 0,
      'a pre-clear state response must not cause a cleared prompt to be written back');
    assert.equal(await page.evaluate(() => __uiMock.config), null);
    await page.evaluate(() => { __uiMock.stateResolvers.slice(1).forEach(resolve => resolve()); });
    pass('Clear Data fences earlier state responses before pagehide.');
    await clearing.context.close();
  }
  {
    const unavailable = await createPage({ full: true, enabled: true, configUnavailable: true });
    const { page } = unavailable;
    assert.equal(await page.locator('#pause').isVisible(), true);
    assert.equal(await page.locator('#pause').isEnabled(), true);
    assert.equal(await page.locator('#prompt').isDisabled(), true);
    await page.evaluate(() => dispatchEvent(new Event('pagehide')));
    assert.equal(await page.evaluate(() => __uiMock.configWrites.length), 0,
      'an unreadable configuration must not be overwritten with defaults');
    await page.locator('#pause').click();
    await page.waitForFunction(() => __uiMock.job.enabled === false);
    assert.equal(await page.locator('#start').isDisabled(), true);
    assert.equal(await page.locator('#resume').isDisabled(), true);
    await page.locator('#tab-settings').click();
    await page.locator('#setupWindows').click();
    assert.equal(await page.evaluate(() => __uiMock.configWrites.length), 0,
      'device navigation must not overwrite unreadable settings');
    assert.equal(await page.evaluate(() => __uiMock.config.prompt), original.prompt);
    pass('Configuration unavailable: Pause stays accessible, editing and draft writes stay disabled.');
    await unavailable.context.close();
  }
  {
    const diagnostic = await createPage({ full: true }); const { page } = diagnostic;
    await page.locator('#tab-logs').click();
    await page.evaluate(() => { __uiMock.stateHealthUnknown = true; __uiMock.healthReadMode = 'reject-session'; });
    await page.locator('#refreshLogs').click();
    await page.waitForFunction(() => document.querySelector('#deliveryDiagnosticHealth').textContent.includes('could not be read'),
      undefined, { timeout: 2000 });
    await page.evaluate(() => {
      const now = Date.now();
      __uiMock.deliveryDiagnostics = [{ sequence: 18, startedAt: now, updatedAt: now, state: 'running', stage: 'page', reason: 'starting' }];
      for (const listener of __uiMock.listeners) listener({ deliveryDiagnostics: { newValue: __uiMock.deliveryDiagnostics } }, 'local');
    });
    assert.match(await page.locator('#deliveryDiagnosticHealth').innerText(), /could not be read/,
      'a local trace update cannot confirm a failed session health read');
    await diagnostic.context.close();
  }
  {
    const diagnostic = await createPage({ full: true, sessionHealth: { persistence: 'degraded', writeFailures: 3 },
      localHealth: { persistence: 'available', writeFailures: 0 }, healthReadMode: 'reject-local' });
    const { page } = diagnostic;
    await page.locator('#tab-logs').click();
    assert.match(await page.locator('#deliveryDiagnosticHealth').innerText(), /persistence failed/,
      'an inconsistent partial read must not clear an observed degraded snapshot');
    await diagnostic.context.close();
  }
  {
    const diagnostic = await createPage({ full: true }); const { page } = diagnostic;
    await page.locator('#tab-logs').click();
    await page.evaluate(() => {
      __uiMock.rejectState = true; __uiMock.healthReadMode = 'reject-session';
      __uiMock.diagnosticsHealth = { persistence: 'degraded', writeFailures: 1 };
    });
    await page.locator('#refreshLogs').click();
    await page.waitForFunction(() => document.querySelector('#deliveryDiagnosticHealth').textContent.includes('persistence failed'),
      undefined, { timeout: 2000 });
    await diagnostic.context.close();
  }
  {
    const diagnostic = await createPage({ full: true }); const { page } = diagnostic;
    await page.locator('#tab-logs').click();
    await page.evaluate(() => {
      const now = Date.now();
      const trace = { sequence: 17, startedAt: now - 1000, updatedAt: now, state: 'running', stage: 'readiness', reason: 'waiting-send' };
      __uiMock.deliveryDiagnostics = [trace]; __uiMock.deferState = true; __uiMock.stateResolvers = [];
      for (const listener of __uiMock.listeners) listener({ deliveryDiagnostics: { newValue: [trace] } }, 'local');
    });
    await page.locator('#refreshLogs').click();
    await page.waitForFunction(() => __uiMock.stateResolvers.length === 1);
    await page.evaluate(() => {
      __uiMock.deliveryDiagnostics = [];
      for (const listener of __uiMock.listeners) listener({ deliveryDiagnostics: { newValue: [] } }, 'local');
      __uiMock.stateResolvers[0]();
    });
    await page.waitForFunction(() => __uiMock.requests.filter(request => request.type === 'GET_STATE').length >= 2);
    assert.equal(await page.locator('#deliveryDiagnosticList summary').count(), 0,
      'a late state response must not resurrect a cleared diagnostic');
    assert.deepEqual(diagnostic.errors, []);
    pass('Delivery diagnostics: a late state response cannot restore a cleared trace.');
    await diagnostic.context.close();
  }
  {
    const clearing = await createPage({ full: true }); const { page } = clearing;
    await page.locator('#tab-logs').click();
    await page.evaluate(() => { __uiMock.deferState = true; __uiMock.stateResolvers = []; });
    await page.locator('#refreshLogs').click();
    await page.waitForFunction(() => __uiMock.stateResolvers.length === 1);
    await page.locator('#clearLogs').click();
    await page.waitForFunction(() => __uiMock.logs.length === 0 && __uiMock.stateResolvers.length >= 2);
    await page.evaluate(async () => {
      __uiMock.stateResolvers[0]();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.doesNotMatch(await page.locator('#logList').innerText(), /合成任务已就绪/,
      'a late pre-clear state response must not restore cleared logs');
    await page.evaluate(() => __uiMock.stateResolvers.slice(1).forEach(resolve => resolve()));
    await clearing.context.close();
  }
  {
    const diagnostic = await createPage({ full: true, sessionHealth: { persistence: 'degraded', writeFailures: 2 },
      localHealth: { persistence: 'available', writeFailures: 0 } });
    const { page } = diagnostic;
    await page.locator('#tab-logs').click();
    assert.match(await page.locator('#deliveryDiagnosticHealth').innerText(), /persistence failed/);
    await page.evaluate(() => {
      __uiMock.diagnosticsHealth = { persistence: 'available', writeFailures: 0 };
      for (const listener of __uiMock.listeners) listener({ diagnosticsHealth: { newValue: __uiMock.diagnosticsHealth } }, 'local');
    });
    assert.match(await page.locator('#deliveryDiagnosticHealth').innerText(), /persistence failed/,
      'an existing session failure must survive a local update after opening');
    const download = page.waitForEvent('download'); await page.locator('#exportLogs').click(); await download;
    const report = await page.evaluate(async () => JSON.parse(await __uiMock.exports.at(-1).text()));
    assert.equal(report.diagnosticsHealth.persistence, 'degraded');
    assert.deepEqual(diagnostic.errors, []);
    pass('Delivery diagnostics: existing session failure remains visible and agrees with export.');
    await diagnostic.context.close();
  }
  for (const healthReadMode of ['hang-local', 'reject-session']) {
    const diagnostic = await createPage({ full: true, sessionHealth: { persistence: 'degraded', writeFailures: 2 },
      localHealth: { persistence: 'available', writeFailures: 0 }, healthReadMode });
    const { page } = diagnostic;
    await page.locator('#tab-logs').click();
    await page.waitForFunction(() => document.querySelector('#deliveryDiagnosticHealth').textContent.includes('persistence failed'),
      undefined, { timeout: 2000 });
    assert.deepEqual(diagnostic.errors, []);
    pass(`Delivery diagnostics: a ${healthReadMode} read cannot hide an existing session failure.`);
    await diagnostic.context.close();
  }
  {
    const counter = await createPage({ full: true }); const { page } = counter;
    await page.evaluate(() => {
      const old = structuredClone(__uiMock.job);
      __uiMock.job.sentCount = 2; __uiMock.job.manualSentCount = 1;
      for (const listener of __uiMock.listeners) listener({ job: { oldValue: old, newValue: __uiMock.job } }, 'session');
    });
    assert.equal(await page.locator('#sentCount').innerText(), '3');
    assert.equal(await page.locator('#sentCount').getAttribute('title'), 'Extension sends: 2; manual sends: 1');
    assert.equal(await page.evaluate(() => __uiMock.job.sentCount), 2);
    assert.deepEqual(counter.errors, []);
    pass('Confirmed total includes a verified manual handoff, with extension/manual attribution retained.');
    await counter.context.close();
  }
  {
    const failures = [];
    {
      const clearing = await createPage({ full: true }); const { page } = clearing;
      try {
        await page.locator('#tab-logs').click();
        await page.evaluate(() => {
          const sendMessage = chrome.runtime.sendMessage;
          chrome.runtime.sendMessage = async message => {
            if (message.type !== 'CLEAR_LOGS') return sendMessage(message);
            __uiMock.requests.push(structuredClone(message));
            const oldValue = structuredClone(__uiMock.logs);
            __uiMock.logs = [];
            for (const listener of __uiMock.listeners) listener({ logs: { oldValue, newValue: undefined } }, 'local');
            await new Promise(resolve => { __uiMock.finishClearLogs = resolve; });
            return { ok: true };
          };
        });
        await page.locator('#clearLogs').click();
        await page.waitForFunction(() => typeof __uiMock.finishClearLogs === 'function');
        await page.evaluate(() => {
          __uiMock.logs = [{ at: Date.now(), event: 'started', message: 'SYNTHETIC-POST-CLEAR-LOG' }];
          for (const listener of __uiMock.listeners) listener({ logs: { oldValue: undefined, newValue: __uiMock.logs } }, 'local');
          __uiMock.deferState = true; __uiMock.stateResolvers = [];
        });
        assert.match(await page.locator('#logList').innerText(), /SYNTHETIC-POST-CLEAR-LOG/);
        await page.evaluate(() => __uiMock.finishClearLogs());
        await page.waitForFunction(() => __uiMock.stateResolvers.length > 0);
        assert.match(await page.locator('#logList').innerText(), /SYNTHETIC-POST-CLEAR-LOG/,
          'the clear response must not erase a newer log delivered by storage');
        assert.deepEqual(clearing.errors, []);
        pass('Clear logs: a late clear response preserves newer logs.');
      } catch (error) { failures.push(error); }
      finally { await clearing.context.close(); }
    }
    {
      const diagnostic = await createPage({ full: true });
      const { page } = diagnostic;
      try {
        await page.locator('#tab-logs').click();
        await page.evaluate(() => {
          __uiMock.diagnosticsHealth = { persistence: 'degraded', writeFailures: 1 };
          for (const listener of __uiMock.listeners) listener({ diagnosticsHealth: { oldValue: undefined, newValue: __uiMock.diagnosticsHealth } }, 'local');
        });
        assert.match(await page.locator('#deliveryDiagnosticHealth').innerText(), /persistence failed/);
        await page.evaluate(() => {
          const oldValue = structuredClone(__uiMock.diagnosticsHealth);
          __uiMock.diagnosticsHealth = undefined;
          for (const listener of __uiMock.listeners) listener({ diagnosticsHealth: { oldValue, newValue: undefined } }, 'local');
        });
        assert.equal(await page.locator('#deliveryDiagnosticHealth').innerText(), '',
          'removing the only degraded health record in another panel must clear its old warning');
        assert.deepEqual(diagnostic.errors, []);
        pass('Clear logs: another panel clears the old local health warning.');
      } catch (error) { failures.push(error); }
      finally { await diagnostic.context.close(); }
    }
    if (failures.length) throw new AggregateError(failures, 'Clear logs regression failures');
  }
  console.log(`\n${checks.length}/${checks.length} UI v2 scenarios passed.`);
} finally { await browser.close(); }
