import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(process.env.EXTENSION_ROOT || path.dirname(path.dirname(fileURLToPath(import.meta.url))));
assert.ok(await fs.stat(path.join(root, 'devices.html')).catch(() => null), 'device page exists in canonical repository');
const playwright = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE_PATH)).href) : await import('playwright');
const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH || undefined });
const resources = new Set(['devices.html', 'devices.css', 'devices.js', 'device-control.js', 'browser-wake.js', 'admin-browser.js', 'admin-control.js', 'i18n.js']);
const screenshots = process.env.DEVICE_SCREENSHOT_DIR;
const pauseKey = 'windowsAdministratorPauseLastV1';
const pauseRequest = { type: 'WINDOWS_ADMINISTRATOR_PAUSE_V1' };
const pauseRead = operationId => ({ type: 'WINDOWS_ADMINISTRATOR_PAUSE_STATUS_V1', operationId });
const pauseReconcile = operationId => ({ type: 'WINDOWS_ADMINISTRATOR_PAUSE_RECONCILE_V1', operationId });
const pauseId = 'a'.repeat(32);
const otherPauseId = 'b'.repeat(32);
let checks = 0;
const pass = name => { checks++; console.log('PASS ' + name); };

async function createPage({ granted = false, uiLanguage, mode = 'ready', width = 1100, paused = false, connection = 'ready',
  query = '', adminObservation = null, standardBrowser = false, lastPause, account = 'administrator' } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 820 }, locale: 'zh-CN' });
  const network = [], errors = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const name = url.pathname.slice(1);
    if (url.origin !== 'https://device-fixture.invalid' || !resources.has(name)) {
      network.push(route.request().url());
      return route.abort();
    }
    return route.fulfill({ status: 200, contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'application/javascript',
      body: await fs.readFile(path.join(root, name)) });
  });
  await context.addInitScript(({ granted, uiLanguage, mode, paused, connection, adminObservation, standardBrowser, pauseKey, lastPause }) => {
    const data = JSON.parse(localStorage.getItem('fixture-data') ||
      JSON.stringify({ uiLanguage, [pauseKey]: lastPause }));
    const mock = { data, granted, mode, paused, connection, adminObservation, listeners: [], calls: [], schedulerCalls: [], adminCalls: [],
      pauseReceiptCalls: [], pauseReceiptCompletions: [], pauseReceipt: null, pauseCalls: [], pauseCompletions: [],
      reconcileCalls: [], standardBrowserCalls: [],
      permissionRequests: [], writes: [], reads: [], accept: true };
    mock.save = async values => {
      const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { oldValue: data[key], newValue: value }]));
      Object.assign(data, structuredClone(values));
      localStorage.setItem('fixture-data', JSON.stringify(data));
      for (const listener of mock.listeners) listener(changes, 'local');
    };
    const permissionListeners = [];
    mock.removePermission = () => {
      mock.granted = false;
      for (const listener of permissionListeners) listener({ permissions: ['nativeMessaging'] });
    };
    globalThis.__deviceMock = mock;
    globalThis.chrome = {
      storage: {
        onChanged: { addListener(listener) { mock.listeners.push(listener); } },
        local: {
          async get(keys) { mock.reads.push(keys); return Object.fromEntries(keys.map(key => [key, structuredClone(data[key])])); },
          async set(values) {
            mock.writes.push(structuredClone(values));
            await mock.save(values);
          },
        },
      },
      permissions: {
        async contains() {
          const granted = mock.granted;
          if (mock.holdPermissionCheck) {
            mock.holdPermissionCheck = false;
            await new Promise(resolve => { mock.releasePermissionCheck = resolve; });
          }
          return granted;
        },
        request(options) { mock.permissionRequests.push(options); mock.granted = mock.accept; return Promise.resolve(mock.accept); },
        onRemoved: { addListener(listener) { permissionListeners.push(listener); } },
      },
      runtime: {
        async sendMessage(...args) {
          if (args[0]?.type === 'WINDOWS_ADMINISTRATOR_STATUS_V1') {
            mock.adminCalls.push(args[0]); return mock.adminObservation;
          }
          if (args[0]?.type === 'WINDOWS_ADMINISTRATOR_PAUSE_STATUS_V1') {
            mock.pauseReceiptCalls.push(args[0]);
            try {
              if (mock.holdReceipt) await new Promise(resolve => { mock.releaseReceipt = resolve; });
              return mock.pauseReceipt;
            } finally { mock.pauseReceiptCompletions.push(args[0]); }
          }
          if (args[0]?.type === 'WINDOWS_ADMINISTRATOR_PAUSE_RECONCILE_V1') {
            mock.reconcileCalls.push(args[0]);
            if (mock.holdReconcile) await new Promise(resolve => { mock.releaseReconcile = resolve; });
            if (mock.dropReconcileReply) throw Error('C:\\private\\secret');
            return mock.reconcileReply;
          }
          if (args[0]?.type === 'WINDOWS_ADMINISTRATOR_PAUSE_V1') {
            mock.pauseCalls.push(args[0]);
            try {
              if (mock.pausePersist) await mock.save({ [pauseKey]: mock.pausePersist });
              if (mock.holdPause) await new Promise(resolve => { mock.releasePause = resolve; });
              if (mock.dropPauseReply) throw Error('C:\\private\\secret');
              if (Object.hasOwn(mock, 'pauseReply')) return mock.pauseReply;
              return mock.pausePersist ?? data[pauseKey] ?? null;
            } finally { mock.pauseCompletions.push(args[0]); }
          }
          if (standardBrowser && args[0]?.type === 'BROWSER_DEVICE_CONTROL_V1') {
            const { request, ownerId } = args[0];
            mock.standardBrowserCalls.push({ request, ownerId });
            const owner = 'standard-fixture-owner';
            if (request.action === 'disconnect-and-pause' && ownerId === owner) {
              mock.paused = true;
              mock.connection = 'disconnected';
            }
            const state = { paused: mock.paused, connection: mock.connection };
            if (request.action !== 'status') state.operation = { id: request.id, action: request.action, status: 'settled' };
            return { ownerId: owner, response: { ...request, ok: true, state } };
          }
          mock.schedulerCalls.push(args); throw Error('Scheduling must not be touched');
        },
        async sendNativeMessage(host, request) {
          mock.calls.push({ host, request });
          if (mock.mode === 'absent') throw Error('Specified native messaging host not found.');
          if (mock.mode === 'transport') throw Error('C:\\private\\secret');
          if (mock.mode === 'timeout') return new Promise(() => {});
          if (mock.mode === 'invalid') return { ...request, ok: true, state: { paused: true, connection: 'ready', output: 'C:\\private\\secret' } };
          const state = { paused: mock.paused, connection: mock.connection };
          if (mock.mode === 'pending') {
            const pending = request.action === 'status' ? data.deviceControlPendingV1 : request;
            if (pending) state.operation = { id: pending.id, action: pending.action, status: 'in-progress' };
          }
          if (['settled', 'not-executed'].includes(mock.mode)) {
            const pending = data.deviceControlPendingV1;
            if (pending) state.operation = { id: pending.id, action: pending.action, status: mock.mode };
          }
          if (['unrelated', 'wrong-action', 'unknown-operation'].includes(mock.mode)) {
            const pending = data.deviceControlPendingV1;
            if (pending) state.operation = {
              id: mock.mode === 'unrelated' ? 'unrelated' : pending.id,
              action: mock.mode === 'wrong-action' ? (pending.action === 'reconnect' ? 'disconnect-and-pause' : 'reconnect') : pending.action,
              status: mock.mode === 'unknown-operation' ? 'unknown' : 'settled',
            };
          }
          return { ...request, ok: true, state };
        },
      },
    };
  }, { granted, uiLanguage, mode, paused, connection, adminObservation, standardBrowser, pauseKey, lastPause });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://device-fixture.invalid/devices.html' + query);
  await page.waitForFunction(() => !document.querySelector('#language')?.disabled);
  // Existing browser-managed cases exercise administrator controls. Choose
  // that surface explicitly instead of relying on the retired two-panel UI.
  if (query === '?mode=browser-managed' && account === 'administrator') {
    await page.locator('#account-administrator').check();
  }
  assert.equal(await page.locator('#device-advanced').getAttribute('open'), null, 'Advanced starts collapsed');
  return { page, context, errors, network };
}
async function openAdvanced(page) {
  const advanced = page.locator('#device-advanced');
  if (await advanced.getAttribute('open') === null) await advanced.locator(':scope > summary').click();
  assert.notEqual(await advanced.getAttribute('open'), null, 'native summary opens Advanced');
}
async function waitForPauseCompletion(page, requests, receipts) {
  // Unlocked controls do not imply that the detached initial receipt read has completed.
  await page.waitForFunction(({ requests, receipts }) =>
    __deviceMock.pauseCompletions.length === requests && __deviceMock.pauseReceiptCompletions.length === receipts,
  { requests, receipts });
}
async function layout(page) {
  const violations = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    controls: [...document.querySelectorAll('button,select,input,summary')].filter(element => {
      if (!element.getClientRects().length) return false;
      const rect = element.getBoundingClientRect();
      return rect.left < -1 || rect.right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 1;
    }).map(element => element.id),
    radii: [...document.querySelectorAll('section,button,dialog')].filter(element => parseFloat(getComputedStyle(element).borderTopLeftRadius) > 8).map(element => element.tagName),
  }));
  assert.deepEqual(violations, { overflow: false, controls: [], radii: [] });
}
async function check(page) {
  const returnToAdministrator = await page.locator('#account-selector').isVisible() &&
    await page.locator('#account-administrator').isChecked();
  if (returnToAdministrator) await page.locator('#account-current').check();
  await page.locator('[data-action="status"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-action="status"]').disabled);
  if (returnToAdministrator) await page.locator('#account-administrator').check();
}
async function capture(page, name) {
  if (!screenshots) return;
  await fs.mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, name), fullPage: true });
}

try {
  for (const width of [1100, 320]) {
    for (const uiLanguage of ['en', 'zh_CN']) {
      const { page, context, errors, network } = await createPage({ granted: true, query: '?mode=browser-managed', width, uiLanguage });
      try {
        const advanced = page.locator('#device-advanced');
        const summary = advanced.locator(':scope > summary');
        for (const id of ['administrator-guided-connect', 'administrator-check', 'administrator-pause', 'administrator-revoke',
          'permissionRisk', 'riskConsent']) {
          assert.equal(await page.locator('#' + id).isVisible(), true, `${id} remains primary`);
        }
        assert.equal(await page.locator('#permission-check').isVisible(), false);
        assert.equal(await page.locator('#administrator-pause-id').isVisible(), false);
        await layout(page);
        await summary.focus();
        await summary.press('Enter');
        assert.notEqual(await advanced.getAttribute('open'), null, 'Enter opens native details');
        assert.equal(await page.locator('#permission-check').isVisible(), true);
        assert.equal(await page.locator('#administrator-pause-id').isVisible(), true);
        assert.equal(await summary.evaluate(element => element === document.activeElement), true);
        await layout(page);
        await summary.press('Space');
        assert.equal(await advanced.getAttribute('open'), null, 'Space closes native details');
        assert.equal(await page.locator('#permission-check').isVisible(), false);
        await layout(page);
        await summary.press('Space');
        assert.notEqual(await advanced.getAttribute('open'), null, 'Space also opens native details');
        await summary.press('Enter');
        assert.equal(await advanced.getAttribute('open'), null, 'Enter also closes native details');
        assert.equal(await summary.evaluate(element => element === document.activeElement), true);
        await layout(page);
        assert.deepEqual(await page.evaluate(() => {
          const { calls, schedulerCalls, adminCalls, pauseCalls, reconcileCalls, permissionRequests, writes } = __deviceMock;
          return { calls, schedulerCalls, adminCalls, pauseCalls, reconcileCalls, permissionRequests, writes };
        }), { calls: [], schedulerCalls: [], adminCalls: [], pauseCalls: [], reconcileCalls: [], permissionRequests: [], writes: [] });
        assert.deepEqual(errors, []);
        assert.deepEqual(network, []);
        pass(`Advanced starts collapsed and supports Enter/Space without overflow or device effects at ${width}px (${uiLanguage})`);
      } finally { await context.close(); }
    }
  }
  {
    const { page, context, errors } = await createPage({ query: '?mode=browser-managed' });
    try {
      const feedback = page.locator('#permission-feedback');
      assert.equal(await feedback.count(), 1, 'permission outcome is visible beside the consent control');
      await page.locator('#riskConsent').check();
      assert.match(await feedback.innerText(), /consent.*not.*permission|permission.*not.*granted/i);
      assert.deepEqual(await page.evaluate(() => __deviceMock.permissionRequests), []);
      await page.evaluate(() => { __deviceMock.accept = false; });
      await page.locator('#grantPermission').click();
      await page.waitForFunction(() => document.querySelector('#permission-feedback').textContent.includes('denied'));
      assert.match(await feedback.innerText(), /denied/i);
      await page.evaluate(() => { __deviceMock.granted = true; });
      await openAdvanced(page);
      await page.locator('#permission-check').click();
      await page.waitForFunction(() => !document.querySelector('#administrator-check').disabled);
      assert.equal(await page.locator('#permission').innerText(), 'Granted');
      assert.match(await feedback.innerText(), /permission.*granted/i);
      assert.match(await feedback.innerText(), /not.*connect|connection.*not/i);
      assert.deepEqual(await page.evaluate(() => ({ calls: __deviceMock.calls, admin: __deviceMock.adminCalls,
        standard: __deviceMock.standardBrowserCalls, scheduler: __deviceMock.schedulerCalls,
        writes: __deviceMock.writes })), { calls: [], admin: [], standard: [], scheduler: [], writes: [] });
      assert.equal(await page.locator('#grantPermission').innerText(), 'Browser permission granted');
      assert.deepEqual(errors, []);
      await layout(page);
      pass('consent, denial and granted readback are visible locally; permission recheck never starts or mutates a device');
    } finally { await context.close(); }
  }
  {
    const { page, context, errors } = await createPage({ query: '?mode=browser-managed', granted: true });
    try {
      await page.evaluate(() => { __deviceMock.granted = false; });
      await openAdvanced(page);
      await page.locator('#permission-check').click();
      await page.waitForFunction(() => document.querySelector('#permission').textContent === 'Not granted');
      assert.equal(await page.locator('#administrator-check').isDisabled(), true);
      assert.deepEqual(await page.evaluate(() => __deviceMock.permissionRequests), []);
      assert.deepEqual(await page.evaluate(() => __deviceMock.writes), []);
      assert.deepEqual(errors, []);
      pass('permission recheck also removes stale administrator eligibility without requesting access');
    } finally { await context.close(); }
  }
  {
    const { page, context, errors, network } = await createPage({ granted: true, query: '?mode=browser-managed', width: 320,
      adminObservation: { state: 'ready', generation: pauseId }, standardBrowser: true });
    try {
      const action = page.locator('#administrator-pause');
      const dialog = page.locator('#administrator-pause-dialog');
      const confirm = page.locator('#administrator-pause-confirm');
      const requestFeedback = page.locator('#administrator-pause-request-feedback');
      const id = page.locator('#administrator-pause-id');
      const receiptCheck = page.locator('#administrator-pause-check');
      const receiptFeedback = page.locator('#administrator-pause-feedback');
      const status = page.locator('#administrator-status');
      assert.equal(await action.count(), 1, 'dedicated administrator Pause button exists');
      await page.locator('#administrator-check').click();
      await check(page);
      assert.match(await status.textContent(), /local runtime reported ready/i);
      await action.click();
      assert.equal(await dialog.isVisible(), true);
      assert.match(await dialog.innerText(), /Windows.*prompt/i);
      assert.match(await dialog.innerText(), /only the administrator MCP/i);
      assert.match(await dialog.innerText(), /standard.*schedul/i);
      await layout(page);
      await capture(page, 'windows-administrator-pause-confirm-mobile.png');
      await page.keyboard.press('Escape');
      assert.equal(await dialog.isVisible(), false);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseCalls), []);
      await page.evaluate(record => {
        __deviceMock.pausePersist = record;
        __deviceMock.holdPause = true;
      }, { operationId: pauseId, outcome: 'requested' });
      await action.click();
      await confirm.click();
      await page.waitForFunction(() => Boolean(__deviceMock.releasePause));
      await page.evaluate(() => document.querySelector('#administrator-pause-confirm').dispatchEvent(new MouseEvent('click')));
      assert.equal(await action.isDisabled(), true);
      assert.equal(await receiptCheck.isDisabled(), true);
      assert.equal(await status.textContent(), 'Administrator status has not been checked.');
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseReceiptCalls), []);
      assert.doesNotMatch(await requestFeedback.textContent(), /was not running|stopped/i);
      await page.evaluate(() => __deviceMock.releasePause());
      await page.waitForFunction(() => !document.querySelector('#administrator-pause').disabled);
      // The duplicate confirmation is a newer action, so it cancels automatic feedback, not the original Pause.
      await waitForPauseCompletion(page, 1, 0);
      assert.equal(await id.inputValue(), pauseId);
      assert.match(await requestFeedback.textContent(), /requested.*not verified/i);
      assert.equal(await status.textContent(), 'Administrator status has not been checked.');
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseCalls), [pauseRequest]);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseReceiptCalls), []);

      // The worker returns the existing record when the previous operation blocks admission.
      await page.evaluate(() => { __deviceMock.pausePersist = null; __deviceMock.holdPause = false; });
      await action.click();
      assert.match(await dialog.innerText(), /unresolved.*no new request/i);
      await confirm.click();
      await page.waitForFunction(() => !document.querySelector('#administrator-pause').disabled);
      await waitForPauseCompletion(page, 2, 1);
      assert.equal(await id.inputValue(), pauseId);
      assert.match(await requestFeedback.textContent(), /no new request.*existing operation/i);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseCalls), [pauseRequest, pauseRequest]);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseReceiptCalls), [pauseRead(pauseId)]);

      await page.evaluate(operationId => { __deviceMock.pauseReceipt = { operationId, state: 'stopped' }; }, pauseId);
      await openAdvanced(page);
      await receiptCheck.click();
      assert.match(await receiptFeedback.textContent(), /was not running.*not the current connection status/i);
      assert.equal(await requestFeedback.textContent(), await receiptFeedback.textContent());
      assert.equal(await status.textContent(), 'Administrator status has not been checked.');
      assert.equal(await page.locator('#pause').textContent(), 'Not paused');
      assert.equal(await page.locator('#connection').textContent(), 'Ready');
      const effects = await page.evaluate(() => {
        const { adminCalls, pauseCalls, pauseReceiptCalls, standardBrowserCalls, calls, schedulerCalls, permissionRequests, writes } = __deviceMock;
        return { adminCalls, pauseCalls, pauseReceiptCalls, standardActions: standardBrowserCalls.map(call => call.request.action),
          calls, schedulerCalls, permissionRequests, writes };
      });
      assert.deepEqual(effects, { adminCalls: [{ type: 'WINDOWS_ADMINISTRATOR_STATUS_V1' }], pauseCalls: [pauseRequest, pauseRequest],
        pauseReceiptCalls: [pauseRead(pauseId), pauseRead(pauseId)],
        standardActions: ['status'], calls: [], schedulerCalls: [], permissionRequests: [], writes: [] });
      await page.evaluate(() => { __deviceMock.adminObservation = { state: 'unobserved', generation: null }; });
      await page.locator('#administrator-check').click();
      assert.match(await status.textContent(), /readiness was not observed/i);
      assert.match(await receiptFeedback.textContent(), /was not running.*not the current connection status/i);
      assert.deepEqual(errors, []);
      assert.deepEqual(network, []);
      await layout(page);
      pass('administrator Pause is explicitly confirmed, single-send, scoped, and separate from historical stop evidence');
    } finally { await context.close(); }
  }
  for (const [outcome, dropReply] of [['cancelled', false], ['requested', true], ['unconfirmed', false]]) {
    const { page, context, errors } = await createPage({ granted: true, query: '?mode=browser-managed' });
    try {
      const record = { operationId: pauseId, outcome };
      await page.evaluate(({ record, dropReply }) => {
        __deviceMock.pausePersist = record;
        __deviceMock.dropPauseReply = dropReply;
      }, { record, dropReply });
      await page.locator('#administrator-pause').click();
      await page.locator('#administrator-pause-confirm').click();
      const receipt = page.locator('#administrator-pause-check');
      const id = page.locator('#administrator-pause-id');
      await page.waitForFunction(() => !document.querySelector('#administrator-pause-check').disabled);
      await waitForPauseCompletion(page, 1, 1);
      assert.equal(await id.inputValue(), pauseId);
      if (outcome === 'cancelled') assert.match(await page.locator('#administrator-pause-request-feedback').textContent(), /cancelled/i);
      assert.doesNotMatch(await page.locator('#administrator-pause-request-feedback').textContent(), /private|was not running|stopped/i);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseReceiptCalls), [pauseRead(pauseId)]);
      await openAdvanced(page);
      await receipt.click();
      assert.match(await page.locator('#administrator-pause-feedback').textContent(), /No verified pause receipt.*not resent/i);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseCalls), [pauseRequest]);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseReceiptCalls), [pauseRead(pauseId), pauseRead(pauseId)]);

      await page.reload();
      await page.waitForFunction(() => !document.querySelector('#administrator-pause-check').disabled);
      await page.locator('#account-administrator').check();
      assert.equal(await id.inputValue(), pauseId);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseReceiptCalls), []);
      assert.equal(await page.locator('#device-advanced').getAttribute('open'), null, 'reload restores the simple view');
      await openAdvanced(page);
      await receipt.click();
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseCalls), []);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseReceiptCalls), [pauseRead(pauseId)]);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  pass('cancelled, unconfirmed, and lost Pause replies retain read-only receipt access across reopen without resending');

  for (const lastPause of [
    { operationId: pauseId, outcome: 'requested', extra: true },
    { operationId: otherPauseId.toUpperCase(), outcome: 'cancelled' },
    { operationId: pauseId, outcome: 'stopped' },
  ]) {
    const { page, context } = await createPage({ granted: true, query: '?mode=browser-managed', lastPause });
    try {
      await page.waitForFunction(key => __deviceMock.reads.some(keys => keys.includes(key)), pauseKey);
      assert.equal(await page.locator('#administrator-pause-id').inputValue(), '');
      assert.equal(await page.locator('#administrator-pause-check').isDisabled(), true);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseCalls), []);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseReceiptCalls), []);
    } finally { await context.close(); }
  }
  pass('reopen ignores non-exact Pause records and does not turn a stored outcome into a stop receipt');

  {
    const { page, context } = await createPage({ granted: true, query: '?mode=browser-managed' });
    try {
      await page.evaluate(({ operationId, state }) => {
        __deviceMock.pauseReply = { operationId, outcome: state };
      }, { operationId: pauseId, state: 'requested' });
      await page.locator('#administrator-pause').click();
      await page.locator('#administrator-pause-confirm').click();
      await page.waitForFunction(() => !document.querySelector('#administrator-pause').disabled);
      await waitForPauseCompletion(page, 1, 0);
      assert.equal(await page.locator('#administrator-pause-id').inputValue(), '');
      assert.equal(await page.locator('#administrator-pause-reconcile').isVisible(), false);
      assert.equal(await page.locator('#administrator-check').isDisabled(), false);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseReceiptCalls), []);
      await openAdvanced(page);
      await page.locator('#administrator-pause-id').fill(pauseId);
      await page.locator('#administrator-pause-check').click();
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseCalls), [pauseRequest]);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseReceiptCalls), [pauseRead(pauseId)]);
    } finally { await context.close(); }
  }
  pass('a launch acknowledgement without a stored ID leaves manual receipt and current status checks available but cannot be reconciled');

  {
    const { page, context } = await createPage({ granted: true, query: '?mode=browser-managed' });
    try {
      const id = page.locator('#administrator-pause-id');
      await page.evaluate(operationId => {
        __deviceMock.pausePersist = { operationId, outcome: 'requested' };
        __deviceMock.holdPause = true;
      }, pauseId);
      await page.locator('#administrator-pause').click();
      await page.locator('#administrator-pause-confirm').click();
      await page.waitForFunction(() => Boolean(__deviceMock.releasePause));
      await page.evaluate(async ({ pauseKey, operationId }) => {
        await __deviceMock.save({ [pauseKey]: { operationId, outcome: 'cancelled' } });
        __deviceMock.releasePause();
      }, { pauseKey, operationId: otherPauseId });
      await page.waitForFunction(() => !document.querySelector('#administrator-pause').disabled);
      await waitForPauseCompletion(page, 1, 1);
      assert.equal(await id.inputValue(), otherPauseId);
      assert.match(await page.locator('#administrator-pause-request-feedback').textContent(), /cancelled/i);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseReceiptCalls), [pauseRead(otherPauseId)]);

      await page.evaluate(operationId => {
        __deviceMock.holdReceipt = true;
        __deviceMock.pauseReceipt = { operationId, state: 'stopped' };
      }, otherPauseId);
      await openAdvanced(page);
      await page.locator('#administrator-pause-check').click();
      await page.waitForFunction(() => Boolean(__deviceMock.releaseReceipt));
      await id.fill(pauseId);
      await page.evaluate(() => __deviceMock.releaseReceipt());
      await page.waitForFunction(() => !document.querySelector('#administrator-pause-check').disabled);
      assert.equal(await page.locator('#administrator-pause-feedback').isVisible(), false);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseCalls), [pauseRequest]);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseReceiptCalls), [pauseRead(otherPauseId), pauseRead(otherPauseId)]);
    } finally { await context.close(); }
  }
  pass('late mutation and historical receipt replies cannot overwrite newer storage or a newly selected receipt ID');

  {
    const { page, context } = await createPage({ granted: true, query: '?mode=browser-managed' });
    try {
      await page.locator('#administrator-pause').click();
      await page.evaluate(() => {
        __deviceMock.removePermission();
        document.querySelector('#administrator-pause-confirm').dispatchEvent(new MouseEvent('click'));
      });
      await page.waitForFunction(() => !document.querySelector('#administrator-pause-dialog').open);
      assert.equal(await page.locator('#administrator-pause').isDisabled(), true);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseCalls), []);
      assert.deepEqual(await page.evaluate(() => __deviceMock.permissionRequests), []);
    } finally { await context.close(); }
  }
  for (const change of ['permission', 'route']) {
    const { page, context } = await createPage({ granted: true, query: '?mode=browser-managed' });
    try {
      await page.locator('#administrator-pause').click();
      await page.evaluate(() => { __deviceMock.holdPermissionCheck = true; });
      await page.locator('#administrator-pause-confirm').click();
      await page.waitForFunction(() => Boolean(__deviceMock.releasePermissionCheck));
      await page.evaluate(change => {
        if (change === 'permission') __deviceMock.removePermission();
        else history.replaceState(null, '', '/devices.html');
        __deviceMock.releasePermissionCheck();
      }, change);
      await page.waitForFunction(() => !document.querySelector('#administrator-pause-id').disabled);
      assert.equal(await page.locator('#administrator-pause').isDisabled(), true);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseCalls), []);
    } finally { await context.close(); }
  }
  for (const [query, granted] of [['?mode=browser-managed', false], ['', true], ['?mode=%62rowser-managed', true],
    ['?mode=browser-managed&mode=browser-managed', true]]) {
    const { page, context } = await createPage({ query, granted });
    try {
      assert.equal(await page.locator('#administrator-pause').isDisabled(), true);
      await page.evaluate(() => {
        for (const id of ['administrator-pause', 'administrator-pause-confirm']) {
          document.getElementById(id).dispatchEvent(new MouseEvent('click'));
        }
      });
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseCalls), []);
      assert.deepEqual(await page.evaluate(() => __deviceMock.permissionRequests), []);
    } finally { await context.close(); }
  }
  pass('administrator Pause fails closed on permission loss and non-administrator routes');

  {
    const lastPause = { operationId: pauseId, outcome: 'unconfirmed' };
    const { page, context, errors, network } = await createPage({ granted: true, query: '?mode=browser-managed', width: 320,
      adminObservation: { state: 'ready', generation: pauseId }, lastPause, standardBrowser: true });
    try {
      const action = page.locator('#administrator-pause-reconcile');
      const dialog = page.locator('#administrator-pause-reconcile-dialog');
      const confirm = page.locator('#administrator-pause-reconcile-confirm');
      const feedback = page.locator('#administrator-pause-reconcile-feedback');
      const id = page.locator('#administrator-pause-id');
      assert.equal(await action.count(), 1, 'separate administrator Pause reconciliation action exists');
      await page.locator('#administrator-check').click();
      await check(page);
      await openAdvanced(page);
      await id.fill(otherPauseId);
      await action.click();
      assert.match(await dialog.innerText(), new RegExp(pauseId));
      assert.doesNotMatch(await dialog.innerText(), new RegExp(otherPauseId));
      assert.match(await dialog.innerText(), /local Windows authorization/i);
      assert.match(await dialog.innerText(), /only.*this ID.*admitted again/i);
      assert.match(await dialog.innerText(), /does not reconnect.*change the current connection/i);
      assert.match(await dialog.innerText(), /does not.*prove.*never ran/i);
      await layout(page);
      await capture(page, 'windows-administrator-pause-reconcile-mobile.png');
      await page.keyboard.press('Escape');
      assert.equal(await dialog.isVisible(), false);
      assert.deepEqual(await page.evaluate(() => __deviceMock.reconcileCalls), []);

      await page.evaluate(operationId => {
        __deviceMock.holdReconcile = true;
        __deviceMock.reconcileReply = { operationId, outcome: 'requested' };
      }, pauseId);
      await action.click();
      await confirm.click();
      await page.waitForFunction(() => Boolean(__deviceMock.releaseReconcile));
      await confirm.dispatchEvent('click');
      assert.equal(await action.isDisabled(), true);
      assert.equal(await page.locator('#administrator-pause').isDisabled(), true);
      assert.equal(await page.locator('#administrator-pause-check').isDisabled(), true);
      await page.evaluate(() => __deviceMock.releaseReconcile());
      await page.waitForFunction(() => !document.querySelector('#administrator-pause-reconcile').disabled);
      assert.match(await feedback.textContent(), /launch.*requested.*fence.*not verified/i);
      assert.equal(await id.inputValue(), otherPauseId);
      assert.match(await page.locator('#administrator-status').textContent(), /local runtime reported ready/i);
      assert.equal(await page.locator('#pause').textContent(), 'Not paused');
      assert.equal(await page.locator('#connection').textContent(), 'Ready');
      assert.deepEqual(await page.evaluate(key => {
        const { data, reconcileCalls, pauseCalls, pauseReceiptCalls, writes, calls, schedulerCalls, permissionRequests } = __deviceMock;
        return { record: data[key], reconcileCalls, pauseCalls, pauseReceiptCalls, writes, calls, schedulerCalls, permissionRequests };
      }, pauseKey), { record: lastPause, reconcileCalls: [pauseReconcile(pauseId)], pauseCalls: [], pauseReceiptCalls: [],
        writes: [], calls: [], schedulerCalls: [], permissionRequests: [] });
      await page.reload();
      await page.waitForFunction(() => !document.querySelector('#administrator-pause-reconcile').disabled);
      assert.equal(await feedback.isVisible(), false);
      assert.deepEqual(await page.evaluate(() => __deviceMock.reconcileCalls), []);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseCalls), []);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseReceiptCalls), []);
      assert.deepEqual(errors, []);
      assert.deepEqual(network, []);
      pass('reconciliation requires separate confirmation, targets only the persisted latest ID, and never treats launch as completion');
    } finally { await context.close(); }
  }

  for (const [state, message] of [
    ['superseded', /not applied to its original target.*not the current connection status/i],
    ['fenced', /cannot be admitted again.*prior effect is unknown.*not the current connection status/i],
    ['stopped', /was not running.*not the current connection status/i],
    ['pause-recorded', /was recorded.*shutdown was not verified/i],
  ]) {
    const lastPause = { operationId: pauseId, outcome: 'requested' };
    const { page, context } = await createPage({ granted: true, query: '?mode=browser-managed', lastPause,
      adminObservation: { state: 'ready', generation: pauseId } });
    try {
      const action = page.locator('#administrator-pause-reconcile');
      const id = page.locator('#administrator-pause-id');
      const receipt = page.locator('#administrator-pause-check');
      const feedback = page.locator('#administrator-pause-feedback');
      await page.locator('#administrator-check').click();
      await openAdvanced(page);
      await id.fill(otherPauseId);
      await page.evaluate(value => { __deviceMock.pauseReceipt = value; }, { operationId: otherPauseId, state });
      await receipt.click();
      assert.match(await feedback.textContent(), message);
      assert.equal(await action.isVisible(), true, 'unrelated receipt cannot settle the latest Pause');
      await id.fill(pauseId);
      await page.evaluate(value => { __deviceMock.pauseReceipt = value; }, { operationId: pauseId, state });
      await receipt.click();
      assert.match(await feedback.textContent(), message);
      assert.equal(await action.isVisible(), false);
      await id.fill(otherPauseId);
      await id.fill(pauseId);
      await page.evaluate(() => { __deviceMock.pauseReceipt = null; });
      await receipt.click();
      assert.match(await feedback.textContent(), /No verified pause receipt/i);
      assert.equal(await action.isVisible(), false, 'an unconfirmed later read does not erase known readback');
      assert.match(await page.locator('#administrator-status').textContent(), /local runtime reported ready/i);
      assert.deepEqual(await page.evaluate(() => __deviceMock.reconcileCalls), []);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseCalls), []);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseReceiptCalls), [pauseRead(otherPauseId), pauseRead(pauseId), pauseRead(pauseId)]);
      if (state === 'fenced' || state === 'superseded') {
        await page.locator('#administrator-pause').click();
        assert.deepEqual(await page.evaluate(() => __deviceMock.pauseCalls), []);
        await page.locator('#administrator-pause-confirm').click();
        await page.waitForFunction(() => !document.querySelector('#administrator-pause').disabled);
        await waitForPauseCompletion(page, 1, 4);
        assert.deepEqual(await page.evaluate(() => __deviceMock.pauseCalls), [pauseRequest]);
        assert.deepEqual(await page.evaluate(() => __deviceMock.pauseReceiptCalls),
          [pauseRead(otherPauseId), pauseRead(pauseId), pauseRead(pauseId), pauseRead(pauseId)]);
        assert.equal(await page.locator('#administrator-status').textContent(), 'Administrator status has not been checked.');
      }
    } finally { await context.close(); }
    pass(`historical ${state} readback blocks reconciliation for the exact latest ID without changing current status or replaying Pause`);
  }

  for (const [reconcileReply, dropReconcileReply, message] of [
    [{ operationId: pauseId, outcome: 'cancelled' }, false, /authorization was cancelled.*check.*receipt/i],
    [{ operationId: pauseId, outcome: 'unconfirmed' }, false, /launch.*unconfirmed.*check.*receipt/i],
    [{ operationId: otherPauseId, outcome: 'requested' }, false, /launch.*unconfirmed/i],
    [{ operationId: pauseId, outcome: 'requested', state: 'fenced' }, false, /launch.*unconfirmed/i],
    [undefined, true, /launch.*unconfirmed/i],
  ]) {
    const lastPause = { operationId: pauseId, outcome: 'requested' };
    const { page, context } = await createPage({ granted: true, query: '?mode=browser-managed', lastPause });
    try {
      await openAdvanced(page);
      await page.locator('#administrator-pause-check').click();
      await page.evaluate(values => Object.assign(__deviceMock, values), { reconcileReply, dropReconcileReply });
      await page.locator('#administrator-pause-reconcile').click();
      await page.locator('#administrator-pause-reconcile-confirm').click();
      await page.waitForFunction(() => !document.querySelector('#administrator-pause-reconcile').disabled);
      const feedback = await page.locator('#administrator-pause-reconcile-feedback').textContent();
      assert.match(feedback, message);
      assert.doesNotMatch(feedback, /secret|is fenced|was stopped/i);
      assert.deepEqual(await page.evaluate(key => __deviceMock.data[key], pauseKey), lastPause);
      assert.deepEqual(await page.evaluate(() => __deviceMock.writes), []);
      assert.deepEqual(await page.evaluate(() => __deviceMock.reconcileCalls), [pauseReconcile(pauseId)]);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseReceiptCalls), [pauseRead(pauseId)]);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseCalls), []);
    } finally { await context.close(); }
  }
  pass('cancelled, unconfirmed, mismatched, extra-field, and lost reconciliation acknowledgements never overwrite the saved Pause');

  {
    const lastPause = { operationId: pauseId, outcome: 'unconfirmed' };
    const { page, context } = await createPage({ granted: true, query: '?mode=browser-managed', lastPause });
    try {
      const action = page.locator('#administrator-pause-reconcile');
      const feedback = page.locator('#administrator-pause-feedback');
      await openAdvanced(page);
      for (const result of [
        { operationId: pauseId, state: ['fenced'] },
        { operationId: pauseId, state: 'fenced', currentConnection: 'stopped' },
        { operationId: otherPauseId, state: 'superseded' },
      ]) {
        await page.evaluate(value => { __deviceMock.pauseReceipt = value; }, result);
        await page.locator('#administrator-pause-check').click();
        assert.match(await feedback.textContent(), /No verified pause receipt/i);
        assert.equal(await action.isVisible(), true);
      }
      assert.deepEqual(await page.evaluate(() => __deviceMock.reconcileCalls), []);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseCalls), []);
    } finally { await context.close(); }
    pass('malformed or mismatched terminal receipt projections do not settle the latest Pause');
  }

  for (const [query, granted, lastPause] of [
    ['?mode=browser-managed', true, undefined],
    ['?mode=browser-managed', true, { operationId: pauseId, outcome: 'cancelled' }],
    ['?mode=browser-managed', true, { operationId: pauseId, outcome: 'requested', extra: true }],
    ['?mode=browser-managed', false, { operationId: pauseId, outcome: 'requested' }],
    ['?mode=%62rowser-managed', true, { operationId: pauseId, outcome: 'requested' }],
  ]) {
    const { page, context } = await createPage({ query, granted, lastPause });
    try {
      await openAdvanced(page);
      const receiptId = page.locator('#administrator-pause-id');
      if (query === '?mode=%62rowser-managed') {
        assert.equal(await receiptId.isVisible(), false, 'manual administrator diagnostics remain hidden on an invalid route');
      } else {
        await receiptId.fill(otherPauseId);
      }
      assert.equal(await page.locator('#administrator-pause-reconcile').isVisible(), false);
      await page.locator('#administrator-pause-reconcile').dispatchEvent('click');
      await page.locator('#administrator-pause-reconcile-confirm').dispatchEvent('click');
      assert.deepEqual(await page.evaluate(() => __deviceMock.reconcileCalls), []);
    } finally { await context.close(); }
  }
  pass('a manually typed receipt ID cannot authorize reconciliation without an eligible saved record, route and permission');

  for (const change of ['permission', 'storage-event', 'storage-only']) {
    const lastPause = { operationId: pauseId, outcome: 'requested' };
    const { page, context } = await createPage({ granted: true, query: '?mode=browser-managed', lastPause });
    try {
      await openAdvanced(page);
      await page.locator('#administrator-pause-reconcile').click();
      await page.evaluate(() => { __deviceMock.holdPermissionCheck = true; });
      await page.locator('#administrator-pause-reconcile-confirm').click();
      await page.waitForFunction(() => Boolean(__deviceMock.releasePermissionCheck));
      await page.evaluate(async ({ change, key, operationId }) => {
        const replacement = { operationId, outcome: 'requested' };
        if (change === 'permission') __deviceMock.removePermission();
        if (change === 'storage-event') await __deviceMock.save({ [key]: replacement });
        if (change === 'storage-only') __deviceMock.data[key] = replacement;
        __deviceMock.releasePermissionCheck();
      }, { change, key: pauseKey, operationId: otherPauseId });
      await page.waitForFunction(() => !document.querySelector('#administrator-pause-id').disabled);
      assert.deepEqual(await page.evaluate(() => __deviceMock.reconcileCalls), []);
      assert.deepEqual(await page.evaluate(() => __deviceMock.pauseCalls), []);
    } finally { await context.close(); }
  }
  pass('reconciliation confirmation fails closed when permission or the persisted latest operation changes');

  const admin = await createPage({ granted: true, query: '?mode=browser-managed', width: 390,
    adminObservation: { state: 'ready', generation: 'a'.repeat(32) }, standardBrowser: true });
  try {
    const { page } = admin, restore = page.locator('#administrator-restore');
    assert.equal(await page.locator('#connection-label').textContent(), 'Standard MCP connection');
    assert.equal(await page.locator('#pause-label').textContent(), 'Standard connection pause');
    assert.equal(await page.locator('[data-action="disconnect-and-pause"]').textContent(), 'Disconnect and pause standard connection');
    assert.equal(await page.locator('[data-action="reconnect"]').textContent(), 'Reconnect standard connection');
    assert.match(await page.locator('#administrator-controls').textContent(), /administrator actions require local Windows authorization and corresponding native support/i);
    assert.equal(await restore.isDisabled(), true);
    await page.locator('#administrator-check').click();
    await page.waitForFunction(() => !document.querySelector('#administrator-restore').disabled);
    assert.match(await page.locator('#administrator-status').textContent(), /local runtime reported ready.*not verified/i);
    await restore.check();
    await page.waitForFunction(() => window.__deviceMock.data.windowsAdministratorBrowserRestoreV1 === true);
    await restore.uncheck();
    await page.waitForFunction(() => window.__deviceMock.data.windowsAdministratorBrowserRestoreV1 === false);
    assert.deepEqual(await page.evaluate(() => window.__deviceMock.adminCalls), [{ type: 'WINDOWS_ADMINISTRATOR_STATUS_V1' }]);
    const receiptId = 'a'.repeat(32);
    const receiptInput = page.locator('#administrator-pause-id');
    const receiptCheck = page.locator('#administrator-pause-check');
    const receiptFeedback = page.locator('#administrator-pause-feedback');
    assert.equal(await receiptCheck.isDisabled(), true);
    await openAdvanced(page);
    await receiptInput.fill('bad-id');
    assert.equal(await receiptCheck.isDisabled(), true);
    await receiptInput.fill(receiptId);
    await page.evaluate(() => { window.__deviceMock.pauseReceipt = { operationId: 'b'.repeat(32), state: 'stopped' }; });
    await receiptCheck.click();
    assert.match(await receiptFeedback.textContent(), /No verified pause receipt.*not resent/i);
    await page.evaluate(operationId => { window.__deviceMock.pauseReceipt = { operationId, state: 'pause-recorded' }; }, receiptId);
    await receiptCheck.click();
    assert.match(await receiptFeedback.textContent(), /Pause was recorded.*not verified/i);
    await page.evaluate(operationId => { window.__deviceMock.pauseReceipt = { operationId, state: 'stopped' }; }, receiptId);
    await receiptCheck.click();
    assert.match(await receiptFeedback.textContent(), /runtime was not running.*not the current connection status/i);
    assert.match(await page.locator('#administrator-status').textContent(), /local runtime reported ready/i);
    assert.deepEqual(await page.evaluate(() => window.__deviceMock.pauseReceiptCalls),
      Array.from({ length: 3 }, () => ({ type: 'WINDOWS_ADMINISTRATOR_PAUSE_STATUS_V1', operationId: receiptId })));
    assert.deepEqual(await page.evaluate(() => window.__deviceMock.calls), []);
    await check(page);
    await page.locator('#account-current').check();
    await page.locator('[data-action="disconnect-and-pause"]').click();
    assert.match(await page.locator('#dialog-risk').textContent(), /does not pause the administrator runtime/i);
    await page.locator('#confirmOperation').click();
    await page.waitForFunction(() => document.querySelector('#pause').textContent === 'Paused');
    assert.match(await page.locator('#administrator-status').textContent(), /local runtime reported ready/i);
    assert.deepEqual(await page.evaluate(() => window.__deviceMock.standardBrowserCalls.map(
      ({ ownerId, request }) => [ownerId, request.action])), [[null, 'status'], ['standard-fixture-owner', 'disconnect-and-pause']]);
    assert.deepEqual(await page.evaluate(() => window.__deviceMock.adminCalls), [{ type: 'WINDOWS_ADMINISTRATOR_STATUS_V1' }]);
    assert.deepEqual(admin.errors, []);
    await layout(page);
    await capture(page, 'windows-administrator-status-mobile.png');
    pass('administrator opt-in stays separate from standard pause and its confirmation');
  } finally { await admin.context.close(); }
  const adminZh = await createPage({ granted: true, query: '?mode=browser-managed', width: 390, uiLanguage: 'zh_CN' });
  try {
    assert.equal(await adminZh.page.locator('#connection-label').textContent(), '普通权限 MCP 连接');
    assert.equal(await adminZh.page.locator('[data-action="disconnect-and-pause"]').textContent(), '断开并暂停普通权限连接');
    assert.match(await adminZh.page.locator('#administrator-controls').textContent(), /普通权限连接的操作不会影响管理员连接/);
    assert.equal(await adminZh.page.locator('#administrator-pause').textContent(), '暂停管理员连接');
    await adminZh.page.locator('#administrator-pause').click();
    assert.match(await adminZh.page.locator('#administrator-pause-dialog').innerText(), /本机 Windows 会提示授权/);
    await layout(adminZh.page);
    await adminZh.page.keyboard.press('Escape');
    pass('Chinese administrator and standard connection controls remain visibly distinct');
  } finally { await adminZh.context.close(); }
  for (const width of [1100, 390]) {
    const controls = await createPage({ granted: true, query: '?mode=browser-managed', width });
    try {
      const { page } = controls;
      await page.evaluate(() => {
        const mock = __deviceMock, original = chrome.runtime.sendMessage;
        const digest = 'e'.repeat(64), target = 'f'.repeat(32) + ':idle';
        mock.adminControlCalls = [];
        chrome.runtime.sendMessage = async message => {
          if (!message.type?.startsWith('WINDOWS_ADMINISTRATOR_CONTROL')) return original(message);
          mock.adminControlCalls.push(structuredClone(message));
          if (message.type === 'WINDOWS_ADMINISTRATOR_CONTROL_SUPPORT_V1') return {
            control: message.control, state: 'supported', bundleSha256: digest,
            target: message.control === 'revoke' ? null : target,
            ownerState: 'running', eligible: true,
          };
          if (message.type === 'WINDOWS_ADMINISTRATOR_CONTROL_V1') {
            const record = { bundleSha256: digest, operationId: (message.control === 'revoke' ? 'b' : 'a').repeat(32),
              control: message.control, target: message.control === 'revoke' ? null : target,
              outcome: 'requested', state: message.control === 'revoke' ? 'revocation-recorded' : 'reserved',
              progress: null, createdAt: Date.now() };
            await mock.save({ windowsAdministratorControlJournalV1: { version: 1, operations: [
              ...(mock.data.windowsAdministratorControlJournalV1?.operations ?? []), record,
            ] } });
            return record;
          }
          return null;
        };
        const banner = document.createElement('p');
        banner.textContent = 'SIMULATED UI TEST - no Windows command, UAC, tunnel or native control is executed.';
        banner.style.cssText = 'padding:12px;border:2px solid #986e00;color:#ffe1a0;background:#171d20';
        document.querySelector('main').prepend(banner);
      });
      await openAdvanced(page);
      await page.locator('#administrator-control-support-check').click();
      await page.waitForFunction(() => !document.querySelector('#administrator-connect').disabled);
      await page.locator('#administrator-connect').click();
      assert.match(await page.locator('#administrator-control-risk').innerText(), /clear.*pause/i);
      await page.locator('#administrator-control-confirm').click();
      await page.waitForFunction(() => document.querySelector('#administrator-control-id').textContent === 'a'.repeat(32));
      assert.equal(await page.locator('#administrator-connect').isDisabled(), true);
      assert.equal(await page.locator('#administrator-revoke').isDisabled(), false);
      await page.locator('#administrator-revoke').click();
      await page.evaluate(async () => {
        const journal = structuredClone(__deviceMock.data.windowsAdministratorControlJournalV1);
        journal.operations[0].progress = { phase: 'verifying-full', verifiedFiles: 120, totalFiles: 1000 };
        await __deviceMock.save({ windowsAdministratorControlJournalV1: journal });
      });
      assert.equal(await page.locator('#administrator-control-dialog').evaluate(e => e.open), true,
        'unrelated verification progress cannot close installation-wide Revoke consent');
      await page.locator('#administrator-control-confirm').click();
      await page.waitForFunction(() => document.querySelector('#administrator-control-id').textContent === 'b'.repeat(32));
      assert.equal(await page.locator('#administrator-control-state').innerText(),
        'Revocation was recorded for this installation; stopped processes are not verified.');
      const mutations = await page.evaluate(() => __deviceMock.adminControlCalls.filter(message => message.type === 'WINDOWS_ADMINISTRATOR_CONTROL_V1'));
      assert.deepEqual(mutations, [
        { type: 'WINDOWS_ADMINISTRATOR_CONTROL_V1', control: 'connect', bundleSha256: 'e'.repeat(64), target: 'f'.repeat(32) + ':idle' },
        { type: 'WINDOWS_ADMINISTRATOR_CONTROL_V1', control: 'revoke', bundleSha256: 'e'.repeat(64) },
      ]);
      assert.deepEqual(await page.evaluate(() => __deviceMock.calls), []);
      assert.deepEqual(await page.evaluate(() => __deviceMock.schedulerCalls), []);
      assert.deepEqual(controls.errors, []);
      assert.deepEqual(controls.network, []);
      await layout(page);
      await capture(page, `windows-admin-control-next-source-${width}.png`);
      pass(`administrator Connect/Revoke rendered workflow at ${width}px is simulated, single-send and progress-resilient`);
    } finally { await controls.context.close(); }
  }
  for (const [uiLanguage, windowsLabel, chatLabel, bridgeLabel] of [
    ['en', 'Windows command setup and local controls', 'Connect ChatGPT or Dot', 'Optional native bridge'],
    ['zh_CN', 'Windows 命令安装与本机控制', '连接 ChatGPT 或 Dot', '可选的原生桥接'],
  ]) {
    const { page, context, errors, network } = await createPage({ uiLanguage, granted: uiLanguage === 'zh_CN' });
    try {
      assert.equal(page.url(), 'https://device-fixture.invalid/devices.html');
      await openAdvanced(page);
      assert.equal(page.url(), 'https://device-fixture.invalid/devices.html', 'disclosure does not navigate');
      const guide = page.locator('#install-guide');
      assert.equal(await guide.isVisible(), true);
      assert.deepEqual(await guide.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href'))),
        ['setup.html', 'setup.html#chat-connection-title']);
      assert.equal(await guide.getByRole('link', { name: windowsLabel, exact: true }).isVisible(), true);
      assert.equal(await guide.getByRole('link', { name: chatLabel, exact: true }).isVisible(), true);
      assert.equal(await page.locator('#access-title').textContent(), bridgeLabel);
      assert.equal(await page.locator('#grantPermission').isDisabled(), true);
      const effects = await page.evaluate(() => {
        const { calls, schedulerCalls, permissionRequests, writes } = __deviceMock;
        return { calls, schedulerCalls, permissionRequests, writes };
      });
      assert.deepEqual(effects, { calls: [], schedulerCalls: [], permissionRequests: [], writes: [] });
      assert.equal(context.pages().length, 1);
      assert.deepEqual(errors, []);
      assert.deepEqual(network, []);
    } finally { await context.close(); }
  }
  pass('bilingual installation guide links to Windows setup and hosted chat steps without changing device or scheduler state');

  {
    const target = 'a'.repeat(64), remote = await createPage({ granted: true, query: '?target=' + target });
    assert.equal(await remote.page.locator('#selected-target').textContent(), target);
    assert.deepEqual(await remote.page.evaluate(() => __deviceMock.calls), []);
    await check(remote.page);
    assert.deepEqual((await remote.page.evaluate(() => __deviceMock.calls)).map(call => call.request),
      [{ version: 2, target, id: (await remote.page.evaluate(() => __deviceMock.calls))[0].request.id, action: 'status' }]);
    await remote.page.locator('[data-action="reconnect"]').click();
    assert.match(await remote.page.locator('#dialog-risk').textContent(), /selected device/);
    await remote.page.locator('#cancelOperation').click(); await remote.context.close();
    const invalid = await createPage({ granted: true, query: '?target=invalid' });
    assert.equal(await invalid.page.locator('#selected-target').textContent(), 'Invalid device selection');
    assert.equal(await invalid.page.locator('[data-action="status"]').isDisabled(), true);
    assert.equal(await invalid.page.locator('[data-action="reconnect"]').isDisabled(), true);
    assert.deepEqual(await invalid.page.evaluate(() => __deviceMock.calls), []);
    await invalid.context.close(); pass('remote opaque selection is fixed to v2; invalid target cannot fall back to local control');
    const mixed = await createPage({ granted: true, query: '?mode=browser-managed&target=' + target });
    assert.equal(await mixed.page.locator('#selected-target').textContent(), 'Invalid device selection');
    assert.equal(await mixed.page.locator('[data-action="status"]').isDisabled(), true);
    assert.deepEqual(await mixed.page.evaluate(() => __deviceMock.calls), []);
    await mixed.context.close(); pass('mixed browser and remote routes fail closed');
  }
  const f = await createPage();
  const { page } = f;
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.title(), 'Agent Continue | Devices');
  assert.equal(/[\u3400-\u9fff]/u.test(await page.locator('body').innerText()), false);
  assert.equal(await page.locator('#grantPermission').isDisabled(), true);
  assert.equal(await page.locator('[data-action="reconnect"]').isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => __deviceMock.permissionRequests), []);
  assert.deepEqual(await page.evaluate(() => __deviceMock.calls), []);
  await check(page);
  assert.deepEqual(await page.evaluate(() => __deviceMock.permissionRequests), []);
  assert.deepEqual(await page.evaluate(() => __deviceMock.calls), []);
  pass('English default, no native call on load, no permission prompt on check');

  await page.locator('#riskConsent').check();
  await page.locator('#grantPermission').click();
  await page.waitForFunction(() => __deviceMock.permissionRequests.length === 1);
  assert.deepEqual(await page.evaluate(() => __deviceMock.permissionRequests), [{ permissions: ['nativeMessaging'] }]);
  assert.deepEqual(await page.evaluate(() => __deviceMock.calls), []);
  assert.equal(await page.locator('[data-action="reconnect"]').isDisabled(), true);
  await check(page);
  assert.equal(await page.locator('[data-action="reconnect"]').isDisabled(), false);
  pass('explicit risk consent requests only optional nativeMessaging, then requires a separate check');

  await page.evaluate(() => { __deviceMock.mode = 'pending'; });
  await page.locator('[data-action="reconnect"]').click();
  assert.equal(await page.locator('#operationDialog').isVisible(), true);
  await page.locator('#cancelOperation').click();
  assert.equal((await page.evaluate(() => __deviceMock.calls)).length, 1);
  await page.locator('[data-action="reconnect"]').click();
  await page.locator('#confirmOperation').click();
  await page.waitForFunction(() => Boolean(__deviceMock.data.deviceControlPendingV1));
  await page.waitForFunction(() => !document.querySelector('[data-action="status"]').disabled);
  assert.equal(await page.locator('[data-action="reconnect"]').isDisabled(), true);
  assert.equal(await page.locator('[data-action="disconnect-and-pause"]').isDisabled(), true);
  assert.equal(await page.locator('#grantPermission').isDisabled(), true);
  assert.equal(await page.locator('[data-action="status"]').isDisabled(), false);
  const pending = await page.evaluate(() => __deviceMock.data.deviceControlPendingV1);
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('[data-action="status"]').disabled);
  await page.evaluate(() => { __deviceMock.granted = true; });
  await check(page);
  assert.equal(await page.locator('[data-action="reconnect"]').isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => __deviceMock.data.deviceControlPendingV1), pending);
  await page.evaluate(() => { __deviceMock.mode = 'settled'; });
  await check(page);
  assert.equal(await page.locator('[data-action="reconnect"]').isDisabled(), false);
  pass('confirmed actions, pending operation locks across reload, matching status evidence unlocks');

  await page.evaluate(() => { __deviceMock.mode = 'pending'; });
  await page.locator('[data-action="reconnect"]').click();
  await page.locator('#confirmOperation').click();
  await page.waitForFunction(() => Boolean(__deviceMock.data.deviceControlPendingV1) && !document.querySelector('[data-action="status"]').disabled);
  await page.evaluate(() => { __deviceMock.mode = 'not-executed'; });
  await check(page);
  await openAdvanced(page);
  assert.equal(await page.locator('#operation').innerText(), 'Not executed');
  assert.equal(await page.locator('[data-action="reconnect"]').isDisabled(), false);
  pass('not-executed receipt is distinct from settlement and releases only its matching pending intent');

  for (const [language, lang] of [['zh_CN', 'zh-CN'], ['en', 'en']]) {
    await page.locator('#language').selectOption(language);
    await page.waitForFunction(expected => document.documentElement.lang === expected, lang);
    assert.equal(await page.locator('#language').inputValue(), language);
    assert.equal(await page.title(), language === 'en' ? 'Agent Continue | Devices' : 'Agent Continue | 设备');
    assert.ok((await page.locator('body').innerText()).includes(language === 'en' ? 'Installation guide' : '安装指南'));
    if (language === 'en') assert.equal(/[\u3400-\u9fff]/u.test(await page.locator('body').innerText()), false);
    await layout(page);
    await capture(page, `devices-${language}-desktop.png`);
    await page.setViewportSize({ width: 320, height: 600 });
    await layout(page);
    await capture(page, `devices-${language}-mobile.png`);
    await page.setViewportSize({ width: 1100, height: 820 });
  }
  await page.evaluate(() => {
    __deviceMock.data.uiLanguage = 'zh_CN';
    for (const listener of __deviceMock.listeners) listener({ uiLanguage: { newValue: 'zh_CN' } }, 'local');
  });
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  assert.equal(await page.locator('#language').inputValue(), 'zh_CN');
  const dynamicIDs = new Set(['permission', 'registration', 'connection', 'pause', 'operation', 'operation-id', 'observed', 'feedback']);
  const untranslated = await page.locator('[data-i18n]').evaluateAll((elements, excluded) => elements
    .filter(element => !excluded.includes(element.id) && element.textContent !== element.dataset.i18n).map(element => element.dataset.i18n), [...dynamicIDs]);
  assert.deepEqual(untranslated, []);
  pass('shared language preference, live external changes, complete static and dynamic localization, desktop/mobile layout');

  const keys = await page.evaluate(() => [...new Set(__deviceMock.writes.flatMap(Object.keys))].sort());
  assert.deepEqual(keys, ['deviceControlPendingV1', 'deviceControlRevisionV1', 'uiLanguage']);
  assert.deepEqual(await page.evaluate(() => __deviceMock.schedulerCalls), []);
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.network, []);
  assert.equal(await page.locator('a[href^="http"],iframe,img,section section').count(), 0);
  pass('no scheduling writes, remote resources, invented download, private raw errors, or nested sections');
  await f.context.close();

  for (const mode of ['absent', 'transport', 'invalid']) {
    const g = await createPage({ granted: true, mode });
    await check(g.page);
    assert.equal(await g.page.locator('#registration').textContent(), mode === 'absent' ? 'Not registered' : 'Unknown');
    assert.equal(await g.page.locator('#permission').textContent(), 'Granted');
    assert.equal(await g.page.locator('[data-action="reconnect"]').isDisabled(), true);
    assert.ok(!(await g.page.locator('body').innerText()).includes('C:\\private'));
    assert.deepEqual(g.errors, []);
    await g.context.close();
  }
  pass('registration absent, permission absent, transport unknown, and invalid response remain distinct');

  for (const paused of [true, false]) {
    for (const action of ['reconnect', 'disconnect-and-pause']) {
      const g = await createPage({ granted: true, paused, connection: 'unknown' });
      await check(g.page);
      assert.equal(await g.page.locator('#registration').textContent(), 'Bridge reachable');
      assert.equal(await g.page.locator('#connection').textContent(), 'Unknown');
      assert.equal(await g.page.locator('#pause').textContent(), paused ? 'Paused' : 'Not paused');
      assert.ok((await g.page.locator('#feedback').textContent()).includes('does not establish chat grants or successful remote access'));
      assert.equal(await g.page.locator(`[data-action="${action}"]`).isDisabled(), false);
      await g.page.locator(`[data-action="${action}"]`).click();
      assert.equal(await g.page.locator('#operationDialog').isVisible(), true);
      assert.equal((await g.page.evaluate(() => __deviceMock.calls)).length, 1);
      await g.page.locator('#cancelOperation').click();
      assert.equal((await g.page.evaluate(() => __deviceMock.calls)).length, 1);
      await g.page.evaluate(() => { __deviceMock.mode = 'settled'; });
      await g.page.locator(`[data-action="${action}"]`).click();
      await g.page.locator('#confirmOperation').click();
      await g.page.waitForFunction(() => document.querySelector('#operation').textContent === 'Settled, not proof of success');
      assert.deepEqual(await g.page.evaluate(() => __deviceMock.calls.map(call => call.request.action)), ['status', action]);
      assert.equal(await g.page.locator('#connection').textContent(), 'Unknown');
      assert.equal(await g.page.evaluate(() => __deviceMock.data.deviceControlPendingV1), null);
      assert.deepEqual(g.errors, []);
      assert.deepEqual(g.network, []);
      await g.context.close();
    }
  }
  pass('boolean pause and unknown tunnel allow only explicitly confirmed manual actions, without claiming access or success');

  for (const connection of ['unknown', 'ready', 'disconnected']) {
    const g = await createPage({ granted: true, paused: true, connection: 'unknown' });
    await check(g.page);
    assert.equal(await g.page.locator('[data-action="reconnect"]').isDisabled(), false);
    await g.page.evaluate(connection => { __deviceMock.paused = null; __deviceMock.connection = connection; }, connection);
    await check(g.page);
    assert.equal(await g.page.locator('#pause').textContent(), 'Unknown');
    assert.equal(await g.page.locator('[data-action="reconnect"]').isDisabled(), true);
    assert.equal(await g.page.locator('[data-action="disconnect-and-pause"]').isDisabled(), true);
    assert.deepEqual(await g.page.evaluate(() => __deviceMock.calls.map(call => call.request.action)), ['status', 'status']);
    assert.deepEqual(g.errors, []);
    await g.context.close();
  }
  pass('fresh null pause relocks manual controls even after a boolean observation, regardless of tunnel label');

  const uncertain = await createPage({ granted: true, paused: true, connection: 'unknown' });
  await check(uncertain.page);
  await uncertain.page.evaluate(() => { __deviceMock.mode = 'pending'; });
  await uncertain.page.locator('[data-action="reconnect"]').click();
  await uncertain.page.locator('#confirmOperation').click();
  await uncertain.page.waitForFunction(() => document.querySelector('#operation').textContent === 'In progress, not complete');
  const uncertainPending = await uncertain.page.evaluate(() => structuredClone(__deviceMock.data.deviceControlPendingV1));
  await uncertain.page.reload();
  await uncertain.page.waitForFunction(() => !document.querySelector('[data-action="status"]').disabled);
  for (const [mode, connection] of [['ready', 'unknown'], ['ready', 'ready'], ['unrelated', 'unknown'],
    ['wrong-action', 'unknown'], ['unknown-operation', 'unknown']]) {
    await uncertain.page.evaluate(({ mode, connection }) => { __deviceMock.mode = mode; __deviceMock.connection = connection; }, { mode, connection });
    await check(uncertain.page);
    assert.deepEqual(await uncertain.page.evaluate(() => __deviceMock.data.deviceControlPendingV1), uncertainPending);
    assert.equal(await uncertain.page.locator('[data-action="reconnect"]').isDisabled(), true);
    assert.equal(await uncertain.page.locator('[data-action="disconnect-and-pause"]').isDisabled(), true);
    assert.equal(await uncertain.page.locator('[data-action="status"]').isDisabled(), false);
    assert.equal(await uncertain.page.evaluate(() => __deviceMock.calls.filter(call => call.request.action !== 'status').length), 0);
  }
  await uncertain.page.evaluate(() => { __deviceMock.mode = 'settled'; });
  await check(uncertain.page);
  assert.equal(await uncertain.page.locator('#connection').textContent(), 'Unknown');
  assert.equal(await uncertain.page.locator('[data-action="reconnect"]').isDisabled(), false);
  assert.equal(await uncertain.page.evaluate(() => __deviceMock.data.deviceControlPendingV1), null);
  assert.deepEqual(uncertain.errors, []);
  await uncertain.context.close();
  pass('generic healthy, unrelated, mismatched, and unknown operation receipts never clear a pending mutation across reload');

  const chinese = await createPage({ granted: true, uiLanguage: 'zh_CN', width: 320 });
  await check(chinese.page);
  await chinese.page.locator('[data-action="disconnect-and-pause"]').click();
  assert.ok((await chinese.page.locator('#operationDialog').innerText()).includes('断开并暂停'));
  await layout(chinese.page);
  await capture(chinese.page, 'devices-zh_CN-consent-mobile.png');
  await chinese.page.keyboard.press('Escape');
  assert.equal(await chinese.page.locator('#operationDialog').isVisible(), false);
  assert.equal((await chinese.page.evaluate(() => __deviceMock.calls)).length, 1);
  assert.deepEqual(chinese.errors, []);
  await chinese.context.close();
  pass('stored Chinese is honored on first render, accessible action dialog cancels with Escape');

  const stopped = await createPage({ granted: true });
  await check(stopped.page);
  await stopped.page.evaluate(() => { __deviceMock.mode = 'pending'; });
  await stopped.page.locator('[data-action="disconnect-and-pause"]').click();
  await stopped.page.locator('#confirmOperation').click();
  await stopped.page.waitForFunction(() => __deviceMock.calls.length === 2 && document.querySelector('[data-action="reconnect"]').disabled);
  assert.equal(await stopped.page.evaluate(() => __deviceMock.calls[1].request.action), 'disconnect-and-pause');
  const dark = stopped.page;
  await dark.emulateMedia({ colorScheme: 'dark' });
  await dark.setViewportSize({ width: 320, height: 600 });
  await layout(dark);
  await capture(dark, 'devices-en-pending-dark-mobile.png');
  await stopped.context.close();
  pass('disconnect-and-pause sends the exact fixed action, dark mobile pending layout remains bounded');
  console.log(`Device UI: ${checks}/${checks} checks passed (synthetic only; no installed extension or native host).`);
} finally { await browser.close(); }
