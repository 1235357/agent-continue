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
const resources = new Set(['popup.html', 'popup.css', 'popup.js', 'config.js', 'file-import.js',
  'static-locale.js', 'i18n.js', 'i18n-html.js', 'i18n-popup.js', 'i18n-runtime.js']);

async function createPage({ full = false, enabled = false, uiLanguage, fixture = original, title = 'Your dot', statusText = '合成测试任务。' } = {}) {
  const context = await browser.newContext({ viewport: { width: full ? 1200 : 650, height: full ? 900 : 600 }, locale: 'zh-CN', colorScheme: 'light', acceptDownloads: true });
  await context.route('**/*', async route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (name === '__test-font.otf' && screenshotFont) return route.fulfill({ status: 200, contentType: 'font/otf', body: await fs.readFile(screenshotFont) });
    if (!resources.has(name)) return route.abort();
    return route.fulfill({ status: 200, contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'application/javascript', body: await fs.readFile(path.join(root, name)) });
  });
  await context.addInitScript(({ original, enabled, uiLanguage, title, statusText }) => {
    const mock = {
      config: structuredClone(original), templates: [], uiTheme: 'system', listeners: [], requests: [],
      logs: [{ at: Date.now(), event: 'started', message: '合成任务已就绪；没有记录正文。' }],
      job: { ...structuredClone(original), id: 'test-job', enabled, phase: 'idle', tabId: 41,
        url: 'https://chatgpt.com/dots/home', title, sentCount: 2,
        nextAt: Date.now() + 20 * 60000, discardProtection: 'active', statusText, queueIndex: 0 },
      exports: [], tabs: [], permissionRequests: [], grantPower: true,
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
          if (message.type === 'GET_STATE') return { ok: true, config: structuredClone(mock.config), job: structuredClone(mock.job), logs: structuredClone(mock.logs),
            availableTargets: [{ id: 41, title, url: 'https://chatgpt.com/dots/home' }, { id: 42, title: '测试对话', url: 'https://chatgpt.com/c/test' }] };
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
  }, { original: fixture, enabled, uiLanguage, title, statusText });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://ui-fixture.invalid/popup.html' + (full ? '?view=full&targetTabId=41' : ''));
  await page.waitForFunction(() => !document.querySelector('#check').disabled && document.querySelector('#targetSelect').options.length > 1)
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

try {
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
  await page.locator('#tab-task').click();
  pass('Interrupt is the visible default; optional waiting can be selected and persisted.');
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
  await page.locator('#configFile').setInputFiles({ name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ config: { intervalMinutes: 37, mode: 'repeat', sendMethod: 'button' } })) });
  await page.waitForFunction(() => __uiMock.config.intervalMinutes === 37);
  assert.equal(await page.evaluate(() => __uiMock.config.prompt), importedText);
  assert.equal(await page.locator('#sendMethod').inputValue(), 'button');
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

  console.log(`\n${checks.length}/${checks.length} UI v2 scenarios passed.`);
} finally { await browser.close(); }
