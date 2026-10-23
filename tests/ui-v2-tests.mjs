import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.EXTENSION_ROOT || path.dirname(here));
const { DEFAULT_CONFIG } = await import(pathToFileURL(path.join(root, 'config.js')).href);
const playwright = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE_PATH)).href)
  : await import('playwright');
const screenshots = process.env.POPUP_SCREENSHOT_DIR ? path.resolve(process.env.POPUP_SCREENSHOT_DIR) : null;
const screenshotFont = process.env.POPUP_FONT_PATH ? path.resolve(process.env.POPUP_FONT_PATH) : null;
const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
const checks = [];
const pass = name => { checks.push(name); console.log('PASS ' + name); };
const original = { ...structuredClone(DEFAULT_CONFIG), prompt: 'SYNTHETIC-PRIVATE-PROMPT\n  Preserve these spaces.\n', intervalMinutes: 20,
  queue: [{ name: '合成队列 A', text: 'SYNTHETIC-QUEUE-A' }, { name: '合成队列 B', text: 'SYNTHETIC-QUEUE-B' }] };
const resources = new Set(['popup.html', 'popup.css', 'popup.js', 'config.js', 'file-import.js']);

async function createPage({ full = false, enabled = false } = {}) {
  const context = await browser.newContext({ viewport: { width: full ? 1200 : 420, height: full ? 900 : 600 }, colorScheme: 'light', acceptDownloads: true });
  await context.route('**/*', async route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (name === '__test-font.otf' && screenshotFont) return route.fulfill({ status: 200, contentType: 'font/otf', body: await fs.readFile(screenshotFont) });
    if (!resources.has(name)) return route.abort();
    return route.fulfill({ status: 200, contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'application/javascript', body: await fs.readFile(path.join(root, name)) });
  });
  await context.addInitScript(({ original, enabled }) => {
    const mock = {
      config: structuredClone(original), templates: [], uiTheme: 'system', listeners: [], requests: [],
      logs: [{ at: Date.now(), event: 'started', message: '合成任务已就绪；没有记录正文。' }],
      job: { ...structuredClone(original), id: 'test-job', enabled, phase: 'idle', tabId: 41,
        url: 'https://chatgpt.com/dots/home', title: 'Your dot', sentCount: 2,
        nextAt: Date.now() + 20 * 60000, discardProtection: 'active', statusText: '合成测试任务。', queueIndex: 0 },
      exports: [], tabs: [], permissionRequests: [], grantPower: true,
    };
    globalThis.__uiMock = mock;
    const notify = (key, oldValue, newValue, area = 'local') => {
      for (const listener of mock.listeners) listener({ [key]: { oldValue: structuredClone(oldValue), newValue: structuredClone(newValue) } }, area);
    };
    globalThis.chrome = {
      runtime: {
        getURL: resource => 'https://ui-fixture.invalid/' + resource,
        async sendMessage(message) {
          mock.requests.push(structuredClone(message));
          if (message.type === 'GET_STATE') return { ok: true, config: structuredClone(mock.config), job: structuredClone(mock.job), logs: structuredClone(mock.logs),
            availableTargets: [{ id: 41, title: 'Your dot', url: 'https://chatgpt.com/dots/home' }, { id: 42, title: '测试对话', url: 'https://chatgpt.com/c/test' }] };
          if (message.type === 'CHECK_PAGE') return { ok: true, result: { status: 'ready', message: '合成页面可用；未填写或发送。' } };
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
            mock.job = null; mock.config = null; mock.templates = []; mock.logs = []; mock.uiTheme = 'system'; return { ok: true };
          }
          throw new Error('Unexpected mock request');
        },
      },
      storage: {
        onChanged: { addListener(listener) { mock.listeners.push(listener); } },
        local: {
          async get(keys) { const result = {}; for (const key of typeof keys === 'string' ? [keys] : keys || []) result[key] = structuredClone(mock[key]); return result; },
          async set(values) { for (const [key, value] of Object.entries(values)) { const old = mock[key]; mock[key] = structuredClone(value); notify(key, old, value); } },
        },
      },
      permissions: { async request(options) { mock.permissionRequests.push(structuredClone(options)); return mock.grantPower; } },
      tabs: { async query() { return [{ id: 41 }]; }, async create(options) { mock.tabs.push(options); return { id: 99 }; } },
    };
    const nativeCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { mock.exports.push(blob); return nativeCreate(blob); };
  }, { original, enabled });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://ui-fixture.invalid/popup.html' + (full ? '?view=full&targetTabId=41' : ''));
  await page.waitForFunction(() => !document.querySelector('#check').disabled);
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
    return { width: innerWidth, pageWidth: document.documentElement.scrollWidth, controls: { top: controls.top, bottom: controls.bottom, height: innerHeight },
      overflow: [...document.querySelectorAll('button,input,select,textarea')].filter(element => {
        if (!element.getClientRects().length) return false;
        const r = element.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1;
      }).map(element => element.id || element.textContent) };
  });
  assert.ok(layout.pageWidth <= layout.width + 1, JSON.stringify(layout));
  assert.deepEqual(layout.overflow, [], JSON.stringify(layout));
  if (!full) assert.ok(layout.controls.top >= 0 && layout.controls.bottom <= layout.controls.height + 1, JSON.stringify(layout));
}
async function capture(page, name) {
  if (screenshots) { await fs.mkdir(screenshots, { recursive: true }); await page.screenshot({ path: path.join(screenshots, name), fullPage: true }); }
}

try {
  const { page, context, errors } = await createPage();
  assert.equal(await page.locator('#waitForIdle').isChecked(), false);
  await page.locator('#tab-settings').click();
  assert.match(await page.locator('#panel-settings').innerText(), /默认.*打断/);
  await page.locator('#waitForIdle').check();
  await page.waitForFunction(() => __uiMock.config.waitForIdle === true);
  await page.locator('#waitForIdle').uncheck();
  await page.waitForFunction(() => __uiMock.config.waitForIdle === false);
  await page.locator('#tab-task').click();
  pass('Interrupt is the visible default; optional waiting can be selected and persisted.');
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
  assert.ok(!JSON.stringify(safeExport).includes('SYNTHETIC-'));
  await page.locator('#includeSecrets').check();
  await page.locator('#exportConfig').click();
  const explicitExport = await page.evaluate(async () => JSON.parse(await __uiMock.exports.at(-1).text()));
  assert.equal(explicitExport.config.prompt, importedText);
  assert.equal(await page.locator('#includeSecrets').isChecked(), false);
  await page.locator('#configFile').setInputFiles({ name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ config: { intervalMinutes: 37, mode: 'repeat' } })) });
  await page.waitForFunction(() => __uiMock.config.intervalMinutes === 37);
  assert.equal(await page.evaluate(() => __uiMock.config.prompt), importedText);
  pass('Backup: default JSON omits prompts/queue; explicit content export is one-shot; settings-only import preserves existing prompt.');

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
  await page.locator('#pause').click();
  await page.waitForFunction(() => document.querySelector('#badge').textContent === '已暂停');
  await page.locator('#interval').fill('45');
  await page.locator('#resume').click();
  await page.waitForFunction(() => document.querySelector('#badge').textContent === '运行中');
  assert.equal(await page.locator('#interval').inputValue(), '37');
  await page.waitForFunction(() => __uiMock.config.intervalMinutes === 45);
  await page.locator('#pause').click();
  await page.waitForFunction(() => document.querySelector('#badge').textContent === '已暂停');
  assert.equal(await page.locator('#interval').inputValue(), '45');
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
  pass('Popup layout: all four panels fit 420 px, fixed task controls stay visible; full-console link preserves target ID.');
  await context.close();

  const full = await createPage({ full: true, enabled: true });
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

  console.log(`\n${checks.length}/${checks.length} UI v2 scenarios passed.`);
} finally { await browser.close(); }
