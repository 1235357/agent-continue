import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import { administratorControlRecord, administratorControlJournal, administratorControlSupport, administratorControlStatus } from '../admin-control.js';
import { adminBrowserObservation, adminBrowserPauseRecord } from '../admin-browser.js';

// Synthetic DOM/worker contract only: no browser, native messaging, disk writes or processes.
const source = await fs.readFile(new URL('../devices.js', import.meta.url), 'utf8');
const html = await fs.readFile(new URL('../devices.html', import.meta.url), 'utf8');
const executable = source.replace(/^import .*;\r?\n/gm, '');
const digest = 'a'.repeat(64), otherDigest = 'b'.repeat(64);
const target = 'c'.repeat(32) + ':idle', operationId = 'd'.repeat(32);
const contracts = {
  ADMIN_CONTROL_SUPPORT: 'WINDOWS_ADMINISTRATOR_CONTROL_SUPPORT_V1',
  ADMIN_CONTROL: 'WINDOWS_ADMINISTRATOR_CONTROL_V1',
  ADMIN_CONTROL_STATUS: 'WINDOWS_ADMINISTRATOR_CONTROL_STATUS_V1',
  ADMIN_CONTROL_FENCE: 'WINDOWS_ADMINISTRATOR_CONTROL_FENCE_V1',
  ADMIN_CONTROL_RECONCILE: 'WINDOWS_ADMINISTRATOR_CONTROL_RECONCILE_V1',
  ADMIN_CONTROL_JOURNAL: 'windowsAdministratorControlJournalV1',
};
const controls = ['connect', 'resume-saved', 'revoke'];
const record = (values = {}) => ({ bundleSha256: digest, operationId, control: 'connect', target,
  outcome: 'unconfirmed', state: 'reserved', progress: null, createdAt: Date.now() - 5000, ...values });
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('guided administrator Connect prepares support and consent without issuing a mutation', async () => {
  const f = await fixture();
  assert.equal(f.get('administrator-guided-connect').disabled, false);
  await f.click('administrator-guided-connect');
  assert.deepEqual(f.messages.map(message => message.type), controls.map(() => contracts.ADMIN_CONTROL_SUPPORT));
  assert.equal(f.get('administrator-control-dialog').open, true);
  assert.match(f.get('administrator-control-title').textContent, /Connect administrator runtime/);
  assert.equal(f.messages.some(message => message.type === contracts.ADMIN_CONTROL), false);
  assert.deepEqual(f.writes, []);
});

test('guided Connect requests browser permission in the consented click and continues to review', async () => {
  const f = await fixture({ granted: false });
  f.get('riskConsent').checked = true;
  await f.get('riskConsent').fire('change');
  assert.equal(f.get('administrator-guided-connect').disabled, false);
  let requested = 0;
  f.requestPermission(consent => { assert.equal(consent, true); requested++; f.grant(); });
  const checking = f.click('administrator-guided-connect');
  assert.equal(requested, 1, 'permission request begins in the click, before awaiting any check');
  await checking;
  assert.equal(f.get('administrator-control-dialog').open, true);
  assert.deepEqual(f.messages.map(message => message.type), controls.map(() => contracts.ADMIN_CONTROL_SUPPORT));
  assert.deepEqual(f.writes, []);
});

test('guided Connect does not dispatch after declined browser permission or a cancelled consent', async () => {
  const f = await fixture({ granted: false });
  let requests = 0;
  f.requestPermission(() => { requests++; });
  await f.click('administrator-guided-connect');
  assert.equal(requests, 0);
  f.get('riskConsent').checked = true;
  await f.click('administrator-guided-connect');
  assert.equal(requests, 1);
  assert.deepEqual(f.messages, []);
  assert.equal(f.get('administrator-control-dialog').open, false);
});

test('a late browser grant after guided permission timeout never starts connection preparation', async () => {
  const f = await fixture({ granted: false }), pending = deferred();
  f.get('riskConsent').checked = true;
  f.requestPermission(() => pending.promise);
  const checking = f.click('administrator-guided-connect');
  await tick();
  await f.expire(30000);
  await checking;
  f.grant();
  pending.resolve();
  await tick();
  assert.deepEqual(f.messages, []);
  assert.equal(f.get('administrator-control-dialog').open, false);
});

test('withdrawing consent during guided support preparation cancels the pending review', async () => {
  const f = await fixture({ granted: false }), pending = deferred();
  f.get('riskConsent').checked = true;
  f.requestPermission(() => f.grant());
  f.handle(async message => { await pending.promise; return f.support[message.control]; });
  const checking = f.click('administrator-guided-connect');
  await tick();
  f.get('riskConsent').checked = false;
  await f.get('riskConsent').fire('change');
  pending.resolve();
  await checking;
  assert.equal(f.get('administrator-control-dialog').open, false);
  assert.equal(f.messages.some(message => message.type === contracts.ADMIN_CONTROL), false);
});

test('a stalled permission refresh releases its UI lock, stays unverified and allows a fresh read', async () => {
  const f = await fixture(), pending = deferred();
  f.initialize(() => pending.promise);
  const checking = f.click('permission-check');
  await tick();
  assert.equal(f.get('permission-check').disabled, true);
  await f.expire(5000);
  await checking;
  assert.equal(f.get('permission-check').disabled, false);
  assert.equal(f.get('administrator-guided-connect').disabled, true);
  assert.equal(f.get('permission').textContent, 'Unknown');
  pending.resolve();
  await tick();
  assert.equal(f.get('administrator-guided-connect').disabled, true, 'late initialization cannot verify an expired read');
  f.initialize(undefined);
  await f.click('permission-check');
  assert.equal(f.get('administrator-guided-connect').disabled, false);
  assert.equal(f.get('permission').textContent, 'Granted');
  assert.deepEqual(f.messages, []);
});

test('expired permission refresh gates prepared references even with a previously observed owner', async () => {
  const f = await fixture({ validPrepared: true }), pending = deferred();
  f.state.observation = { ownerId: 'f'.repeat(32), connection: 'ready', paused: false };
  f.get('prepared-id').value = 'own-test-operation';
  f.get('prepared-digest').value = 'a'.repeat(64);
  f.initialize(() => pending.promise);
  await f.click('permission-check');
  await f.expire(5000);
  assert.equal(f.get('prepared-check').disabled, true);
  await f.get('prepared-form').fire('submit');
  assert.equal(f.preparedCalls.length, 0);
  pending.resolve();
  await tick();
  assert.equal(f.get('prepared-check').disabled, true);
  f.initialize(undefined);
  await f.click('permission-check');
  assert.equal(f.get('prepared-check').disabled, false);
  await f.get('prepared-form').fire('submit');
  assert.equal(f.preparedCalls.length, 1);
});

test('guided Connect never overlaps or retries an unresolved administrator startup', async () => {
  const f = await fixture({ journal: { version: 1, operations: [record()] } });
  assert.equal(f.get('administrator-guided-connect').disabled, true);
  await f.click('administrator-guided-connect');
  assert.deepEqual(f.messages, []);
  assert.equal(f.get('administrator-control-dialog').open, false);
});

test('guided Connect is single flight and preserves an explicit pause during preparation', async () => {
  const f = await fixture(), pending = deferred();
  f.handle(message => message.type === contracts.ADMIN_CONTROL_SUPPORT ? pending.promise : null);
  const checking = f.click('administrator-guided-connect');
  await tick();
  assert.equal(f.get('administrator-guided-connect').disabled, true);
  await f.click('administrator-guided-connect');
  assert.equal(f.messages.length, 3);
  await f.click('administrator-pause');
  pending.resolve(f.support.connect);
  await checking;
  assert.equal(f.get('administrator-control-dialog').open, false);
  assert.equal(f.get('administrator-pause-dialog').open, true);
  assert.equal(f.messages.some(message => message.type === contracts.ADMIN_CONTROL), false);
});

test('guided Connect fails closed when permission is absent or support times out', async () => {
  const absent = await fixture({ granted: false });
  await absent.click('administrator-guided-connect');
  assert.deepEqual(absent.messages, []);
  const f = await fixture(), pending = deferred();
  f.handle(() => pending.promise);
  const checking = f.click('administrator-guided-connect');
  await tick();
  await f.expire(30000);
  await checking;
  assert.equal(f.get('administrator-control-dialog').open, false);
  assert.equal(f.get('administrator-guided-connect').disabled, false);
  assert.match(f.get('administrator-guided-feedback').textContent, /not.*verified|could not|not confirmed/i);
  pending.resolve(f.support.connect);
  await tick();
  assert.equal(f.get('administrator-control-dialog').open, false);
  assert.equal(f.messages.some(message => message.type === contracts.ADMIN_CONTROL), false);
});

test('guided Connect cannot reopen its dialog after a Pause from another page', async () => {
  const f = await fixture(), pending = deferred();
  f.handle(() => pending.promise);
  const checking = f.click('administrator-guided-connect');
  await tick();
  await f.publishPause({ operationId: 'e'.repeat(32), outcome: 'requested' });
  pending.resolve(f.support.connect);
  await checking;
  assert.equal(f.get('administrator-control-dialog').open, false);
  assert.match(f.get('administrator-guided-feedback').textContent, /pause choice is preserved/i);
  assert.equal(f.messages.some(message => message.type === contracts.ADMIN_CONTROL), false);
});

test('guided Connect cannot replace a Revoke review while preparing', async () => {
  const f = await fixture();
  await f.click('administrator-control-support-check');
  const pending = deferred();
  f.handle(async message => {
    if (message.type !== contracts.ADMIN_CONTROL_SUPPORT) return null;
    await pending.promise;
    return f.support[message.control];
  });
  const checking = f.click('administrator-guided-connect');
  await tick();
  await f.click('administrator-revoke');
  assert.equal(f.get('administrator-control-dialog').open, true);
  pending.resolve();
  await checking;
  assert.match(f.get('administrator-control-title').textContent, /Revoke/);
  assert.equal(f.messages.some(message => message.type === contracts.ADMIN_CONTROL), false);
  await f.click('administrator-control-confirm');
  const writes = f.messages.filter(message => message.type === contracts.ADMIN_CONTROL);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].control, 'revoke');
});

test('guided Connect discards a late support result after permission revocation', async () => {
  const f = await fixture(), pending = deferred();
  f.handle(() => pending.promise);
  const checking = f.click('administrator-guided-connect');
  await tick();
  await f.removePermission();
  pending.resolve(f.support.connect);
  await checking;
  assert.equal(f.get('administrator-control-dialog').open, false);
  assert.equal(f.messages.some(message => message.type === contracts.ADMIN_CONTROL), false);
});

async function fixture({ query = '?mode=browser-managed', granted = true, journal, language = 'en', incognito = false, validPrepared = false, embedded = false } = {}) {
  const elements = new Map(), messages = [], writes = [], permissionListeners = [], storageListeners = [];
  const data = { [contracts.ADMIN_CONTROL_JOURNAL]: journal };
  const timers = new Map();
  const preparedCalls = [];
  let timerId = 0, storageFailed = false, onMessage, onPermission, onPermissionRequest, onInitialize, uiCatalog;
  class Element {
    constructor(id = '') { this.id = id; this.value = ''; this.open = false; this.hidden = false; this.disabled = false;
      this.checked = false; this.textContent = ''; this.dataset = {}; this.handlers = new Map(); this.children = []; }
    addEventListener(name, handler) { this.handlers.set(name, [...(this.handlers.get(name) || []), handler]); }
    async fire(name) { await Promise.all((this.handlers.get(name) || []).map(handler => handler({ target: this, preventDefault() {} }))); await tick(); }
    showModal() { this.open = true; }
    close() { this.open = false; }
    setAttribute() {}
    replaceChildren(...children) { this.children = children; this.value = children[0]?.value ?? ''; }
    append(...children) { this.children.push(...children); }
  }
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) elements.set(match[1], new Element(match[1]));
  const get = id => { assert.ok(elements.has(id), `authored element ${id} exists`); return elements.get(id); };
  const state = { initialized: true, permission: granted ? 'granted' : 'absent', registration: 'unchecked', observation: null,
    observedAt: null, pending: null, journalHealthy: true, feedback: 'not-checked', canMutate: true };
  const support = Object.fromEntries(controls.map(control => [control, { control, state: 'supported', bundleSha256: digest,
    target: control === 'revoke' ? null : target, ownerState: 'running', eligible: true }]));
  const save = async value => {
    data[contracts.ADMIN_CONTROL_JOURNAL] = value;
    for (const listener of storageListeners) listener({ [contracts.ADMIN_CONTROL_JOURNAL]: { newValue: value } }, 'local');
    await tick();
  };
  const location = new URL('chrome-extension://' + 'a'.repeat(32) + '/devices.html' + query);
  const context = vm.createContext({
    URL, location, console, ...contracts, administratorControlRecord, administratorControlJournal,
    administratorControlSupport, administratorControlStatus,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    document: { getElementById: get, querySelectorAll: () => [], documentElement: { lang: 'en' },
      createElement: () => new Element() }, navigator: { locks: { request() {} } },
    createTranslator: catalog => { uiCatalog = catalog; return key => language === 'zh_CN' ? key : catalog[key] ?? key; },
    initializeLanguage: async () => {}, subscribeLanguage() {}, setLanguage: async value => { language = value; }, getLanguage: () => language,
    deviceScope: () => '', HOST: 'fixture', PENDING_KEY: 'pending', REVISION_KEY: 'revision', BROWSER_WAKE_HOST: 'fixture',
    ADMIN_BROWSER_RESTORE: 'restore', ADMIN_BROWSER_PAUSE_LAST: 'pause', ADMIN_BROWSER_MESSAGE: 'administrator-status',
    ADMIN_BROWSER_PAUSE: 'administrator-pause', ADMIN_BROWSER_PAUSE_RECONCILE: 'administrator-pause-reconcile',
    ADMIN_BROWSER_PAUSE_STATUS: 'administrator-pause-status', adminBrowserPauseRecord, adminBrowserObservation,
    validPreparedReference: () => validPrepared, controlPrepared: async (...args) => { preparedCalls.push(args); return null; },
    createDeviceController: ({ onChange }) => ({ getState: () => state, initialize: async () => { if (onInitialize) await onInitialize(); onChange(); }, refreshPending: async () => {},
      requestPermission: async consent => { if (onPermissionRequest) return onPermissionRequest(consent); throw Error('Unexpected permission request'); } }),
    chrome: { extension: { inIncognitoContext: incognito }, runtime: { id: 'a'.repeat(32), async sendMessage(message) {
      messages.push(plain(message));
      if (onMessage) return onMessage(message);
      if (message.type === contracts.ADMIN_CONTROL_SUPPORT) return support[message.control];
      return null;
    } }, permissions: { async contains() { return onPermission ? onPermission() : granted; },
      onAdded: { addListener(listener) { permissionListeners.push(listener); } },
      onRemoved: { addListener(listener) { permissionListeners.push(listener); } } },
    storage: { local: { async get(keys) {
      if (storageFailed) throw Error('private-path-must-not-render');
      return Object.fromEntries(keys.map(key => [key, data[key]]));
    }, async set(values) { writes.push(values); } }, onChanged: { addListener(listener) { storageListeners.push(listener); } } } },
  });
  vm.runInContext(`globalThis.window = globalThis; window.top = ${embedded ? '{}' : 'window'};`, context);
  await vm.runInContext(`(async () => {\n${executable}\n})()`, context);
  return { get, messages, writes, support, save, state, timers, location, preparedCalls, catalog: uiCatalog,
    handle(handler) { onMessage = handler; }, permission(handler) { onPermission = handler; }, failStorage() { storageFailed = true; },
    requestPermission(handler) { onPermissionRequest = handler; }, grant() { granted = true; state.permission = 'granted'; },
    initialize(handler) { onInitialize = handler; },
    async click(id) { await get(id).fire('click'); }, async select(id, bundle = digest) { get('administrator-control-operation').value = id === 'manual' ? id : bundle + ':' + id;
      await get('administrator-control-operation').fire('change'); },
    async publishPause(value) { for (const listener of storageListeners) listener({ pause: { newValue: value } }, 'local'); await tick(); },
    async expire(delay) { for (const [id, timer] of timers) if (timer.delay === delay) { timers.delete(id); timer.callback(); } await tick(); },
    async removePermission() { granted = false; state.permission = 'absent'; for (const listener of permissionListeners) listener({ permissions: ['nativeMessaging'] }); await tick(); },
  };
}

test('an embedded Devices document cannot read or control administrator operations', async () => {
  const f = await fixture({ embedded: true, journal: { version: 1, operations: [record()] } });
  f.get('riskConsent').checked = true;
  f.get('administrator-pause-id').value = operationId;
  for (const id of ['administrator-guided-connect', 'administrator-control-support-check',
    'administrator-check', 'administrator-connect', 'administrator-reconnect', 'administrator-revoke',
    'administrator-control-confirm', 'administrator-pause', 'administrator-pause-confirm',
    'administrator-pause-reconcile', 'administrator-pause-reconcile-confirm',
    'administrator-control-receipt-check', 'administrator-control-recover', 'administrator-control-fence']) {
    await f.click(id);
  }
  await f.get('administrator-pause-receipt').fire('submit');
  f.get('administrator-restore').checked = true;
  await f.get('administrator-restore').fire('change');
  assert.deepEqual(f.messages, []);
  assert.deepEqual(f.writes, []);
  assert.equal(f.get('administrator-control-dialog').open, false);
  assert.equal(f.get('administrator-pause-dialog').open, false);
  assert.equal(f.get('administrator-pause-reconcile-dialog').open, false);
});

test('administrator status reads permission before and after exactly one validated read-only request', async () => {
  const f = await fixture();
  let reads = 0;
  f.permission(() => { reads++; return true; });
  f.handle(() => {
    assert.equal(reads, 1, 'permission must be checked before dispatch');
    return { state: 'ready', generation: 'f'.repeat(32) };
  });
  await f.click('administrator-check');
  assert.equal(reads, 2, 'permission must be checked again before publishing readiness');
  assert.deepEqual(f.messages, [{ type: 'administrator-status' }]);
  assert.match(f.get('administrator-status').textContent, /local runtime reported ready.*not verified/i);
  assert.equal(f.get('administrator-check').disabled, false);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.writes, []);
});

test('an old pending Pause and saved progress are never presented as current connection state', async () => {
  const f = await fixture({ journal: { version: 1, operations: [record({
    state: 'launch-requested', outcome: 'requested', progress: { phase: 'waiting-owner', verifiedFiles: null, totalFiles: null },
  })] } });
  await f.publishPause({ operationId: 'e'.repeat(32), outcome: 'requested' });
  f.handle(() => ({ state: 'ready', generation: 'f'.repeat(32) }));
  await f.click('administrator-check');
  assert.match(f.get('administrator-status').textContent, /reported ready/);
  assert.match(f.get('administrator-pause-request-feedback').textContent, /^Last Pause record \(not current connection status\):/);
  assert.match(f.get('administrator-control-progress').textContent, /^Saved operation progress \(not current status\):/);
  assert.deepEqual(f.messages, [{ type: 'administrator-status' }]);
  assert.deepEqual(f.writes, []);
});

for (const phase of ['before-dispatch', 'awaiting-reply', 'after-reply']) {
  test(`administrator status deadline bounds ${phase}, preserves deny actions and ignores late results`, async () => {
    const f = await fixture({ journal: { version: 1, operations: [record()] } });
    await f.click('administrator-control-support-check');
    const before = f.messages.length, pending = deferred();
    const ready = { state: 'ready', generation: 'f'.repeat(32) };
    let reads = 0, finished = false;
    f.permission(() => ++reads === (phase === 'before-dispatch' ? 1 : phase === 'after-reply' ? 2 : -1) ? pending.promise : true);
    f.handle(() => phase === 'awaiting-reply' ? pending.promise : ready);
    const checking = f.click('administrator-check').then(() => { finished = true; });
    await tick();
    assert.equal(f.get('administrator-check').disabled, true);
    await f.click('administrator-check');
    assert.deepEqual(f.messages.slice(before), phase === 'before-dispatch' ? [] : [{ type: 'administrator-status' }]);
    assert.equal(f.get('administrator-pause').disabled, false);
    assert.equal(f.get('administrator-revoke').disabled, false);
    await f.expire(5000);
    await tick();
    assert.equal(finished, true, 'the whole status read must settle even when an await never resolves');
    await checking;
    assert.equal(f.get('administrator-check').disabled, false);
    assert.match(f.get('administrator-status').textContent, /no valid administrator status response/i);
    assert.equal(f.get('administrator-pause').disabled, false);
    assert.equal(f.get('administrator-revoke').disabled, false);
    assert.equal(f.get('administrator-control-id').textContent, operationId);
    assert.equal(f.get('administrator-control-bundle').textContent, digest);
    assert.equal(f.timers.size, 0);

    // A late old flow must neither publish readiness nor unlock a newer pending read.
    const fresh = deferred();
    f.permission(() => true);
    f.handle(() => fresh.promise);
    const next = f.click('administrator-check');
    await tick();
    const calls = f.messages.length;
    pending.resolve(phase === 'awaiting-reply' ? ready : true);
    await tick();
    assert.equal(f.get('administrator-check').disabled, true);
    assert.doesNotMatch(f.get('administrator-status').textContent, /reported ready/i);
    assert.equal(f.messages.length, calls, 'expired work cannot dispatch or replay a query');
    fresh.resolve({ state: 'unobserved', generation: null });
    await next;
    assert.match(f.get('administrator-status').textContent, /readiness was not observed/i);
    assert.equal(f.get('administrator-check').disabled, false);
    assert.equal(f.timers.size, 0);
    assert.deepEqual(f.writes, []);
  });
}

for (const phase of ['before-dispatch', 'after-reply']) {
  for (const failure of ['absent', 'rejected']) {
    test(`administrator status fails closed on ${failure} permission ${phase}`, async () => {
      const f = await fixture();
      let reads = 0;
      f.permission(() => {
        if (++reads !== (phase === 'before-dispatch' ? 1 : 2)) return true;
        if (failure === 'rejected') throw Error('private-permission-error');
        return false;
      });
      f.handle(() => ({ state: 'ready', generation: 'f'.repeat(32) }));
      await f.click('administrator-check');
      assert.deepEqual(f.messages, phase === 'before-dispatch' ? [] : [{ type: 'administrator-status' }]);
      assert.match(f.get('administrator-status').textContent, /no valid administrator status response/i);
      assert.equal(f.get('administrator-check').disabled, false);
      assert.equal(f.timers.size, 0);
      assert.deepEqual(f.writes, []);
    });
  }
}

for (const change of ['permission-removed', 'permission-rechecked', 'device-selection']) {
  test(`administrator status discards a reply after ${change}`, async () => {
    const f = await fixture(), pending = deferred();
    f.handle(() => pending.promise);
    const checking = f.click('administrator-check');
    await tick();
    if (change === 'permission-removed') await f.removePermission();
    else if (change === 'permission-rechecked') await f.click('permission-check');
    else f.location.search = '?target=' + otherDigest;
    pending.resolve({ state: 'ready', generation: 'f'.repeat(32) });
    await checking;
    assert.doesNotMatch(f.get('administrator-status').textContent, /reported ready/i);
    assert.equal(f.get('administrator-check').disabled, change === 'permission-removed');
    assert.deepEqual(f.messages, [{ type: 'administrator-status' }]);
    assert.equal(f.timers.size, 0);
    assert.deepEqual(f.writes, []);
  });
}

for (const options of [{ query: '' }, { query: '?target=' + otherDigest }, { query: '?mode=browser-managed&extra=1' },
  { query: '?mode=browser-managed&target=' + otherDigest }, { incognito: true }, { granted: false }]) {
  test(`administrator status cannot escape its permitted device route: ${JSON.stringify(options)}`, async () => {
    const f = await fixture(options);
    await f.click('administrator-check');
    assert.deepEqual(f.messages, []);
    assert.equal(f.timers.size, 0);
    assert.deepEqual(f.writes, []);
  });
}

for (const failure of ['transport', 'malformed']) {
  test(`administrator status clears busy after ${failure} without leaking or retrying`, async () => {
    const f = await fixture();
    f.handle(() => {
      if (failure === 'transport') throw Error('private-transport-error');
      return { state: 'ready', generation: 'f'.repeat(32), extra: 'private-response' };
    });
    await f.click('administrator-check');
    assert.match(f.get('administrator-status').textContent, /no valid administrator status response/i);
    assert.equal(f.get('administrator-check').disabled, false);
    assert.deepEqual(f.messages, [{ type: 'administrator-status' }]);
    assert.equal(f.timers.size, 0);
    assert.deepEqual(f.writes, []);
  });
}

test('administrator actions are authored disabled and legacy support never enables them', async () => {
  for (const id of ['administrator-connect', 'administrator-reconnect', 'administrator-revoke']) {
    assert.match(html, new RegExp(`<button[^>]+id="${id}"[^>]+disabled`));
  }
  const f = await fixture();
  assert.deepEqual(f.messages, [], 'loading only reads local records');
  f.handle(() => null);
  await f.click('administrator-control-support-check');
  for (const id of ['administrator-connect', 'administrator-reconnect', 'administrator-revoke']) assert.equal(f.get(id).disabled, true);
  assert.equal(f.messages.length, 3);
  assert.ok(f.messages.every(message => message.type === contracts.ADMIN_CONTROL_SUPPORT));
  assert.deepEqual(f.writes, []);
});

test('page support deadline has headroom over worker and native budgets without a resend', async () => {
  const f = await fixture();
  const pending = deferred();
  f.handle(() => pending.promise);
  let finished = false;
  const check = f.click('administrator-control-support-check').then(() => { finished = true; });
  await tick();
  assert.equal(f.messages.length, 3);
  await f.expire(5000);
  assert.equal(finished, false);
  assert.equal(f.get('administrator-control-support-check').disabled, true);
  await f.expire(30000);
  await check;
  assert.equal(finished, true);
  assert.equal(f.get('administrator-control-support-check').disabled, false);
  for (const id of ['administrator-connect', 'administrator-reconnect', 'administrator-revoke']) assert.equal(f.get(id).disabled, true);
  assert.doesNotMatch(f.get('administrator-connect-support').textContent, /Checking native control support/);
  pending.resolve(f.support.connect);
  await tick();
  assert.equal(f.get('administrator-connect').disabled, true, 'late replies cannot enable an expired check');
  assert.equal(f.messages.length, 3);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.writes, []);
});

for (const phase of ['before-dispatch', 'after-replies']) {
  test(`support check deadline bounds a stalled permission read ${phase} and ignores its late result`, async () => {
    const f = await fixture({ journal: { version: 1, operations: [record({ bundleSha256: otherDigest })] } });
    const pending = deferred();
    let reads = 0, finished = false;
    f.permission(() => ++reads === (phase === 'before-dispatch' ? 1 : 2) ? pending.promise : true);
    const checking = f.click('administrator-control-support-check').then(() => { finished = true; });
    await tick();
    assert.equal(f.messages.length, phase === 'before-dispatch' ? 0 : 3);
    assert.equal(f.get('administrator-control-support-check').disabled, true);
    await f.expire(30000);
    await tick();
    assert.equal(finished, true, 'the entire support check must settle even if permission readback stalls');
    await checking;
    assert.equal(f.get('administrator-control-support-check').disabled, false);
    for (const id of ['administrator-connect', 'administrator-reconnect', 'administrator-revoke',
      'administrator-control-recover', 'administrator-control-fence']) assert.equal(f.get(id).disabled, true);
    assert.doesNotMatch(f.get('administrator-connect-support').textContent, /Checking native control support/);
    assert.equal(f.get('administrator-control-id').textContent, operationId);
    assert.equal(f.get('administrator-control-bundle').textContent, otherDigest);
    assert.equal(f.timers.size, 0);

    // A fresh explicit check may succeed, but the retired unresolved record still blocks startup.
    f.permission(() => true);
    for (const control of controls) f.support[control] = { ...f.support[control], bundleSha256: 'e'.repeat(64) };
    await f.click('administrator-control-support-check');
    const calls = f.messages.length;
    assert.equal(f.get('administrator-connect').disabled, true);
    assert.equal(f.get('administrator-reconnect').disabled, true);
    assert.equal(f.get('administrator-revoke').disabled, false);
    await f.click('administrator-revoke');
    assert.match(f.get('administrator-control-review-reference').textContent, /^e{64} \| revoke/);
    pending.resolve(true);
    await tick();
    assert.equal(f.messages.length, calls, 'an expired permission read cannot dispatch another support batch');
    assert.equal(f.get('administrator-control-support-check').disabled, false);
    assert.equal(f.get('administrator-connect').disabled, true);
    assert.equal(f.get('administrator-revoke').disabled, false);
    assert.equal(f.get('administrator-control-dialog').open, true, 'late support cannot replace the fresh reviewed binding');
    assert.match(f.get('administrator-control-review-reference').textContent, /^e{64} \| revoke/);
    assert.ok(f.messages.every(message => message.type === contracts.ADMIN_CONTROL_SUPPORT));
    assert.deepEqual(f.writes, []);
    assert.equal(f.timers.size, 0);
  });
}

test('support deadline retains known Revoke only until permission is removed', async () => {
  const f = await fixture();
  await f.click('administrator-control-support-check');
  const pending = deferred();
  f.permission(() => pending.promise);
  const checking = f.click('administrator-control-support-check');
  await tick();
  await f.expire(30000);
  await checking;
  assert.equal(f.get('administrator-control-support-check').disabled, false);
  assert.equal(f.get('administrator-connect').disabled, true);
  assert.equal(f.get('administrator-reconnect').disabled, true);
  assert.equal(f.get('administrator-revoke').disabled, false);
  assert.match(f.get('administrator-revoke-support').textContent, /last verified.*unconfirmed/i);
  await f.removePermission();
  pending.resolve(true);
  await tick();
  assert.equal(f.get('administrator-revoke').disabled, true, 'late permission readback cannot restore revoked capability');
  assert.equal(f.messages.length, 3, 'no support batch is dispatched after the permission deadline');
  assert.deepEqual(f.writes, []);
  assert.equal(f.timers.size, 0);
});

test('Connect requires confirmation, the worker owns the ID, and lost replies recover the stored identity without replay', async () => {
  const f = await fixture();
  await f.click('administrator-control-support-check');
  assert.equal(f.get('administrator-connect').disabled, false);
  await f.click('administrator-connect');
  assert.equal(f.get('administrator-control-dialog').open, true);
  assert.match(f.get('administrator-control-risk').textContent, /clear.*pause/i);
  f.handle(async message => {
    if (message.type === contracts.ADMIN_CONTROL_SUPPORT) return f.support[message.control];
    if (message.type === contracts.ADMIN_CONTROL) { await f.save({ version: 1, operations: [record()] }); throw Error('private-path-must-not-render'); }
    return null;
  });
  await f.click('administrator-control-confirm');
  assert.deepEqual(f.messages.filter(message => message.type === contracts.ADMIN_CONTROL),
    [{ type: contracts.ADMIN_CONTROL, control: 'connect', bundleSha256: digest, target }]);
  assert.equal(f.get('administrator-control-operation').value, digest + ':' + operationId);
  assert.equal(f.get('administrator-control-id').textContent, operationId);
  assert.equal(f.get('administrator-connect').disabled, true);
  assert.equal(f.get('administrator-revoke').disabled, false, 'deny remains available while startup is unresolved');
  await f.click('administrator-control-confirm');
  assert.equal(f.messages.filter(message => message.type === contracts.ADMIN_CONTROL).length, 1);
  assert.deepEqual(f.writes, []);
});

for (const options of [{ query: '' }, { query: '?mode=browser-managed&extra=1' }, { incognito: true }, { granted: false }]) {
  test(`wrong route, incognito or absent permission cannot send administrator controls: ${JSON.stringify(options)}`, async () => {
    const f = await fixture(options);
    for (const id of ['administrator-control-support-check', 'administrator-connect', 'administrator-reconnect',
      'administrator-revoke', 'administrator-control-confirm', 'administrator-control-receipt-check']) await f.click(id);
    assert.deepEqual(f.messages, []);
    assert.deepEqual(f.writes, []);
  });
}

test('Reconnect is saved-running only and never falls through to Connect for a paused installation', async () => {
  const f = await fixture();
  f.support.connect.ownerState = 'paused';
  Object.assign(f.support['resume-saved'], { ownerState: 'paused', eligible: false, target: null });
  await f.click('administrator-control-support-check');
  assert.equal(f.get('administrator-connect').disabled, false);
  assert.equal(f.get('administrator-reconnect').disabled, true);
  await f.click('administrator-reconnect');
  await f.click('administrator-control-confirm');
  assert.ok(f.messages.every(message => message.type === contracts.ADMIN_CONTROL_SUPPORT));
  Object.assign(f.support['resume-saved'], { ownerState: 'running', eligible: true, target });
  await f.click('administrator-control-support-check');
  await f.click('administrator-reconnect');
  assert.match(f.get('administrator-control-risk').textContent, /cannot unpause.*never falls through/i);
  await f.click('administrator-control-confirm');
  assert.deepEqual(f.messages.filter(message => message.type === contracts.ADMIN_CONTROL),
    [{ type: contracts.ADMIN_CONTROL, control: 'resume-saved', bundleSha256: digest, target }]);
});

test('Revoke needs no generation or ready owner, requires confirmation, and never claims shutdown', async () => {
  const f = await fixture({ journal: { version: 1, operations: [record()] } });
  f.support.revoke.ownerState = 'unobserved';
  f.handle(async message => {
    if (message.type === contracts.ADMIN_CONTROL_SUPPORT) return f.support[message.control];
    if (message.type === contracts.ADMIN_CONTROL) {
      const revoked = record({ operationId: 'e'.repeat(32), control: 'revoke', target: null,
        outcome: 'requested', state: 'revocation-recorded' });
      await f.save({ version: 1, operations: [record(), revoked] });
      return revoked;
    }
    return null;
  });
  await f.click('administrator-control-support-check');
  assert.equal(f.get('administrator-revoke').disabled, false);
  await f.click('administrator-revoke');
  assert.equal(f.get('administrator-control-dialog').open, true);
  assert.match(f.get('administrator-control-risk').textContent, /entire installation.*not proof of stopped/s);
  assert.equal(f.messages.filter(message => message.type === contracts.ADMIN_CONTROL).length, 0);
  await f.click('administrator-control-confirm');
  assert.deepEqual(f.messages.filter(message => message.type === contracts.ADMIN_CONTROL),
    [{ type: contracts.ADMIN_CONTROL, control: 'revoke', bundleSha256: digest }]);
  assert.match(f.get('administrator-control-state').textContent, /stopped processes are not verified/);
  assert.doesNotMatch(f.get('administrator-status').textContent, /reported ready|stopped/i);
});

for (const control of controls) {
  test(`cancelled ${control} without a protected terminal receipt remains selected and recoverable`, async () => {
    const saved = record({ control, target: control === 'revoke' ? null : target, outcome: 'cancelled', state: 'unconfirmed' });
    const f = await fixture({ journal: { version: 1, operations: [saved] } });
    await f.click('administrator-control-support-check');
    assert.equal(f.get('administrator-control-id').textContent, operationId);
    assert.equal(f.get('administrator-connect').disabled, true);
    assert.equal(f.get('administrator-reconnect').disabled, true);
    assert.equal(f.get('administrator-control-recover').disabled, false);
    assert.equal(f.get('administrator-control-fence').disabled, false);
    assert.equal(f.get('administrator-revoke').disabled, control === 'revoke');
    assert.match(f.get('administrator-control-outcome').textContent, /cancelled.*same ID/i);
    assert.ok(f.messages.every(message => message.type === contracts.ADMIN_CONTROL_SUPPORT));
  });
}

for (const [button, type] of [['administrator-control-recover', contracts.ADMIN_CONTROL_RECONCILE],
  ['administrator-control-fence', contracts.ADMIN_CONTROL_FENCE]]) {
  test(`${button} is an explicit same-ID action without a target or startup replay`, async () => {
    const f = await fixture({ journal: { version: 1, operations: [record({ outcome: 'cancelled' })] } });
    await f.click('administrator-control-support-check');
    await f.click(button);
    assert.equal(f.get('administrator-control-dialog').open, true);
    assert.match(f.get('administrator-control-review-reference').textContent, new RegExp(operationId));
    assert.equal(f.messages.filter(message => message.type === type).length, 0);
    f.handle(message => message.type === contracts.ADMIN_CONTROL_SUPPORT ? f.support[message.control] :
      { bundleSha256: digest, operationId, control: 'connect', outcome: 'requested' });
    await f.click('administrator-control-confirm');
    await f.click('administrator-control-confirm');
    assert.deepEqual(f.messages.filter(message => message.type === type), [{ type, bundleSha256: digest, operationId, control: 'connect' }]);
    assert.equal(f.messages.filter(message => message.type === contracts.ADMIN_CONTROL).length, 0);
    assert.equal(f.get('administrator-connect').disabled, true, 'a recovery submission is not a terminal receipt');
    assert.deepEqual(f.writes, []);
  });
}

test('support changes after review cannot silently refresh Connect authority', async () => {
  const f = await fixture();
  await f.click('administrator-control-support-check');
  await f.click('administrator-connect');
  f.support.connect = { ...f.support.connect, target: 'f'.repeat(32) + ':idle' };
  await f.click('administrator-control-confirm');
  assert.equal(f.messages.filter(message => message.type === contracts.ADMIN_CONTROL).length, 0);
  assert.match(f.get('administrator-control-feedback').textContent, /changed.*No request/s);
  assert.equal(f.get('administrator-connect').disabled, true);
});

test('permission removal closes a reviewed action and discards in-flight support', async () => {
  const f = await fixture();
  await f.click('administrator-control-support-check');
  await f.click('administrator-connect');
  await f.removePermission();
  assert.equal(f.get('administrator-control-dialog').open, false);
  await f.click('administrator-control-confirm');
  assert.equal(f.messages.filter(message => message.type === contracts.ADMIN_CONTROL).length, 0);
  assert.equal(f.get('administrator-revoke').disabled, true);
  const late = await fixture();
  const hold = deferred();
  late.handle(async message => { await hold.promise; return late.support[message.control]; });
  const checking = late.click('administrator-control-support-check');
  await tick();
  await late.removePermission();
  hold.resolve();
  await checking;
  assert.equal(late.get('administrator-connect').disabled, true);
});

test('corrupt journal disables startup/recovery while existing Pause remains independent', async () => {
  const f = await fixture({ journal: { version: 1, operations: [record({ extra: 'invalid' })] } });
  await f.click('administrator-control-support-check');
  assert.equal(f.get('administrator-connect').disabled, true);
  assert.equal(f.get('administrator-control-recover').disabled, true);
  assert.equal(f.get('administrator-pause').disabled, false);
  assert.match(f.get('administrator-control-feedback').textContent, /unavailable or invalid/i);
  await f.save({ version: 1, operations: [] });
  assert.equal(f.get('administrator-connect').disabled, false);
  f.failStorage();
  await f.click('administrator-control-journal-check');
  assert.equal(f.get('administrator-connect').disabled, true);
  assert.doesNotMatch(f.get('administrator-control-feedback').textContent, /private-path/);
});

test('mixed candidate support and cross-candidate recovery fail closed without erasing history', async () => {
  const f = await fixture({ journal: { version: 1, operations: [record()] } });
  f.support.revoke.bundleSha256 = otherDigest;
  await f.click('administrator-control-support-check');
  assert.equal(f.get('administrator-revoke').disabled, true);
  assert.equal(f.get('administrator-control-recover').disabled, true);
  for (const control of controls) f.support[control].bundleSha256 = otherDigest;
  await f.click('administrator-control-support-check');
  assert.equal(f.get('administrator-control-recover').disabled, true);
  assert.equal(f.get('administrator-control-bundle').textContent, digest);
  assert.equal(f.get('administrator-control-receipt-check').disabled, false, 'history readback sends its original digest only');
  await f.click('administrator-control-receipt-check');
  assert.deepEqual(f.messages.at(-1), { type: contracts.ADMIN_CONTROL_STATUS, bundleSha256: digest, operationId, control: 'connect' });
});

test('operation selection binds bundle plus ID and invalidates a recovery dialog', async () => {
  const f = await fixture({ journal: { version: 1, operations: [record(), record({ bundleSha256: otherDigest })] } });
  await f.click('administrator-control-support-check');
  await f.select(operationId);
  await f.click('administrator-control-recover');
  assert.equal(f.get('administrator-control-dialog').open, true);
  await f.select(operationId, otherDigest);
  assert.equal(f.get('administrator-control-dialog').open, false);
  await f.click('administrator-control-confirm');
  assert.ok(f.messages.every(message => message.type === contracts.ADMIN_CONTROL_SUPPORT));
  assert.equal(f.get('administrator-control-bundle').textContent, otherDigest);
});

test('journal changes invalidate recovery confirmation even when the selected ID is unchanged', async () => {
  const f = await fixture({ journal: { version: 1, operations: [record()] } });
  await f.click('administrator-control-support-check');
  await f.click('administrator-control-fence');
  await f.save({ version: 1, operations: [record({ state: 'intent-saved' })] });
  assert.equal(f.get('administrator-control-dialog').open, false);
  await f.click('administrator-control-confirm');
  assert.equal(f.messages.filter(message => message.type === contracts.ADMIN_CONTROL_FENCE).length, 0);
});

test('unrelated Connect intent/progress preserves Revoke confirmation and sends exactly one targetless deny', async () => {
  const f = await fixture({ journal: { version: 1, operations: [record()] } });
  await f.click('administrator-control-support-check');
  await f.click('administrator-revoke');
  await f.save({ version: 1, operations: [record({ state: 'intent-saved', progress: { phase: 'verifying-full', verifiedFiles: 1, totalFiles: 99 } })] });
  assert.equal(f.get('administrator-control-dialog').open, true, 'progress must not obstruct installation-wide deny');
  await f.click('administrator-control-confirm');
  await f.click('administrator-control-confirm');
  assert.deepEqual(f.messages.filter(message => message.type === contracts.ADMIN_CONTROL),
    [{ type: contracts.ADMIN_CONTROL, control: 'revoke', bundleSha256: digest }]);
});

test('new unrelated startup records do not cancel Revoke, but an unresolved Revoke for the same bundle does', async () => {
  const f = await fixture();
  await f.click('administrator-control-support-check');
  await f.click('administrator-revoke');
  await f.save({ version: 1, operations: [record()] });
  assert.equal(f.get('administrator-control-dialog').open, true);
  await f.save({ version: 1, operations: [record(), record({ control: 'revoke', target: null, operationId: 'e'.repeat(32) })] });
  assert.equal(f.get('administrator-control-dialog').open, false);
  await f.click('administrator-control-confirm');
  assert.equal(f.messages.filter(message => message.type === contracts.ADMIN_CONTROL).length, 0);
});

test('a transient Connect recheck failure does not remove previously verified installation-wide Revoke', async () => {
  const f = await fixture();
  await f.click('administrator-control-support-check');
  await f.click('administrator-connect');
  f.handle(() => null);
  await f.click('administrator-control-confirm');
  assert.equal(f.get('administrator-revoke').disabled, false);
  assert.equal(f.messages.filter(message => message.type === contracts.ADMIN_CONTROL).length, 0);
});

test('same-grant permission recheck retains installation-wide Revoke but invalidates startup support', async () => {
  const f = await fixture();
  await f.click('administrator-control-support-check');
  f.handle(() => null);
  await f.click('administrator-control-support-check');
  assert.equal(f.get('administrator-revoke').disabled, false);
  const calls = f.messages.length;
  await f.click('permission-check');
  await tick();
  assert.equal(f.get('administrator-revoke').disabled, false);
  assert.equal(f.get('administrator-connect').disabled, true);
  assert.equal(f.messages.length, calls, 'permission recheck never sends native or administrator messages');
  assert.deepEqual(f.writes, []);
  await f.removePermission();
  assert.equal(f.get('administrator-revoke').disabled, true);
});

test('native progress is displayed only from validated records/receipts and never implies readiness', async () => {
  const f = await fixture({ journal: { version: 1, operations: [record({
    progress: { phase: 'verifying-full', verifiedFiles: 19, totalFiles: 123 } })] } });
  assert.match(f.get('administrator-control-progress').textContent, /19 \/ 123/);
  f.handle(() => ({ bundleSha256: digest, operationId, control: 'connect', state: 'launch-requested',
    progress: { phase: 'waiting-owner', verifiedFiles: null, totalFiles: null } }));
  await f.click('administrator-control-receipt-check');
  assert.match(f.get('administrator-control-receipt').textContent, /waiting for runtime.*not establish current readiness/i);
  assert.equal(f.get('administrator-control-progress').textContent, 'Saved operation progress (not current status): Waiting for runtime');
  assert.doesNotMatch(f.get('administrator-status').textContent, /reported ready|recovered/i);
  assert.equal(f.get('administrator-connect').disabled, true, 'only the worker journal unlocks a protected terminal operation');
  assert.ok(f.messages.every(message => message.type === contracts.ADMIN_CONTROL_STATUS));
});

for (const forged of [
  { bundleSha256: otherDigest }, { operationId: 'e'.repeat(32) }, { control: 'resume-saved' }, { extra: 'private-path' },
  { state: 'ready' }, { progress: { phase: 'verifying-full', verifiedFiles: 10, totalFiles: 9 } },
]) {
  test(`invalid or mismatched receipt does not leak progress or effects: ${JSON.stringify(forged)}`, async () => {
    const f = await fixture({ journal: { version: 1, operations: [record()] } });
    f.handle(() => ({ bundleSha256: digest, operationId, control: 'connect', state: 'intent-saved', progress: null, ...forged }));
    await f.click('administrator-control-receipt-check');
    assert.match(f.get('administrator-control-receipt').textContent, /unconfirmed.*not retried/i);
    assert.equal(f.get('administrator-control-progress').textContent, 'No verified native progress.');
    assert.equal(f.messages.length, 1);
    assert.deepEqual(f.writes, []);
  });
}

test('a five-second manual read timeout is unknown, and its late reply cannot change selection', async () => {
  const f = await fixture({ journal: { version: 1, operations: [record()] } });
  const hold = deferred();
  f.handle(() => hold.promise);
  const checking = f.click('administrator-control-receipt-check');
  await tick();
  await f.expire(5000);
  await checking;
  assert.match(f.get('administrator-control-receipt').textContent, /unconfirmed.*not retried/i);
  hold.resolve({ bundleSha256: digest, operationId, control: 'connect', state: 'stopped', progress: null });
  await tick();
  assert.match(f.get('administrator-control-receipt').textContent, /unconfirmed/i);
  assert.equal(f.messages.length, 1);
  assert.equal(f.timers.size, 0, 'no polling timer remains');
});

test('the thirty-second UI deadline preserves the ID, startup lock and deny actions without a second mutation', async () => {
  const f = await fixture();
  await f.click('administrator-control-support-check');
  const hold = deferred();
  f.handle(async message => {
    if (message.type === contracts.ADMIN_CONTROL_SUPPORT) return f.support[message.control];
    if (message.type === contracts.ADMIN_CONTROL) { await f.save({ version: 1, operations: [record()] }); return hold.promise; }
    return null;
  });
  await f.click('administrator-connect');
  const submitting = f.click('administrator-control-confirm');
  await tick();
  assert.equal(f.get('administrator-revoke').disabled, false, 'Revoke remains available during a long verification');
  await f.expire(30000);
  await submitting;
  assert.equal(f.get('administrator-control-id').textContent, operationId);
  assert.equal(f.get('administrator-connect').disabled, true);
  assert.equal(f.get('administrator-pause').disabled, false);
  assert.equal(f.get('administrator-revoke').disabled, false);
  assert.equal(f.messages.filter(message => message.type === contracts.ADMIN_CONTROL).length, 1);
  assert.equal(f.timers.size, 0);
  hold.resolve(record({ state: 'launch-requested', outcome: 'requested' }));
  await tick();
  assert.match(f.get('administrator-control-state').textContent, /reserved/i, 'late replies do not manufacture journal transitions');
});

test('cancel/close events cannot consume or replay confirmation', async () => {
  const f = await fixture();
  await f.click('administrator-control-support-check');
  await f.click('administrator-connect');
  await f.get('administrator-control-dialog').fire('cancel');
  f.get('administrator-control-dialog').close();
  await f.click('administrator-control-confirm');
  assert.equal(f.messages.filter(message => message.type === contracts.ADMIN_CONTROL).length, 0);
  await f.click('administrator-revoke');
  await f.get('administrator-control-dialog').fire('close');
  await f.click('administrator-control-confirm');
  assert.deepEqual(f.messages.filter(message => message.type === contracts.ADMIN_CONTROL),
    [{ type: contracts.ADMIN_CONTROL, control: 'revoke', bundleSha256: digest }]);
});

test('English authored copy and Chinese dictionary cover new controls without translating IDs', async () => {
  const en = await fixture({ journal: { version: 1, operations: [record()] } });
  for (const match of html.matchAll(/data-i18n="([^"]+)"/g)) assert.ok(Object.hasOwn(en.catalog, match[1]), match[1]);
  const zh = await fixture({ language: 'zh_CN', journal: { version: 1, operations: [record()] } });
  await zh.click('administrator-control-support-check');
  await zh.click('administrator-control-recover');
  assert.match(zh.get('administrator-control-risk').textContent, /同一操作编号/);
  assert.equal(zh.get('administrator-control-id').textContent, operationId);
  assert.equal(zh.get('administrator-control-bundle').textContent, digest);
  assert.match(zh.get('administrator-control-state').textContent, /已保留操作编号/);
  assert.deepEqual(zh.writes, []);
});

test('known Revoke capability survives transient support loss and does not require a fresh support RPC to deny', async () => {
  const f = await fixture({ journal: { version: 1, operations: [record()] } });
  await f.click('administrator-control-support-check');
  f.handle(() => null);
  await f.click('administrator-control-support-check');
  assert.equal(f.get('administrator-revoke').disabled, false);
  assert.match(f.get('administrator-revoke-support').textContent, /last verified.*current.*unconfirmed/i);
  await f.click('administrator-revoke');
  const before = f.messages.length;
  await f.click('administrator-control-confirm');
  assert.deepEqual(f.messages.slice(before), [{ type: contracts.ADMIN_CONTROL, control: 'revoke', bundleSha256: digest }]);
  assert.equal(f.get('administrator-connect').disabled, true);
});

test('manual receipt references support archived IDs as read-only exact identities, never recovery or startup', async () => {
  const f = await fixture();
  await f.select('manual');
  for (const [id, value] of [['administrator-control-reference-bundle', otherDigest],
    ['administrator-control-reference-id', operationId], ['administrator-control-reference-action', 'revoke']]) {
    f.get(id).value = value;
    await f.get(id).fire('input');
    await f.get(id).fire('change');
  }
  f.handle(() => ({ bundleSha256: otherDigest, operationId, control: 'revoke', state: 'revocation-recorded', progress: null }));
  await f.click('administrator-control-receipt-check');
  assert.deepEqual(f.messages, [{ type: contracts.ADMIN_CONTROL_STATUS, bundleSha256: otherDigest, operationId, control: 'revoke' }]);
  assert.match(f.get('administrator-control-reference-feedback').textContent, /stopped processes are not verified/);
  assert.equal(f.get('administrator-control-recover').disabled, true);
  assert.equal(f.get('administrator-control-fence').disabled, true);
  f.get('administrator-control-reference-id').value = 'bad-id';
  await f.get('administrator-control-reference-id').fire('input');
  await f.click('administrator-control-receipt-check');
  assert.equal(f.messages.length, 1);
  assert.deepEqual(f.writes, []);
});
