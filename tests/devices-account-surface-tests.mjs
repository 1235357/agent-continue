import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import * as admin from '../admin-control.js';
import * as browser from '../admin-browser.js';

// Synthetic page/worker contract: no browser, native host, network or installed files.
const source = (await fs.readFile(new URL('../devices.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
const html = await fs.readFile(new URL('../devices.html', import.meta.url), 'utf8');
const digest = 'a'.repeat(64), operationId = 'b'.repeat(32);
const support = { control: 'revoke', state: 'supported', bundleSha256: digest, target: null, ownerState: 'running', eligible: true };
const pendingRecord = control => ({ bundleSha256: digest, operationId, control,
  target: control === 'revoke' ? null : 'c'.repeat(32) + ':idle', outcome: 'unconfirmed', state: 'reserved', progress: null, createdAt: 1 });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture({ query = '?mode=browser-managed', restore, granted = true, journal,
  language = 'en', incognito = false, embedded = false, historyFails = false, beforePreference } = {}) {
  const elements = new Map(), stack = [], effects = [], messages = [], listeners = [], timers = new Map();
  const documentListeners = new Map();
  let nextTimer = 0, onMessage = () => support, onPermission = () => granted;
  const data = { [browser.ADMIN_BROWSER_RESTORE]: restore, [admin.ADMIN_CONTROL_JOURNAL]: journal };
  class Element {
    constructor(tag, attrs = {}) {
      this.tag = tag; this.attrs = attrs; this.id = attrs.id; this.dataset = {};
      for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) this.dataset[key.slice(5)] = value;
      this.parents = [...stack]; this.hidden = Object.hasOwn(attrs, 'hidden'); this.disabled = Object.hasOwn(attrs, 'disabled');
      this.checked = Object.hasOwn(attrs, 'checked'); this.value = attrs.value ?? ''; this.open = false;
      this.textContent = ''; this.handlers = new Map(); this.children = [];
    }
    addEventListener(name, handler) { this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]); }
    async fire(name) {
      const event = { target: this, preventDefault() {} };
      for (const handler of documentListeners.get(name) ?? []) handler(event);
      for (const handler of this.handlers.get(name) ?? []) await handler(event);
      await tick();
    }
    closest(selector) { return [...this.parents, this].find(node => '#' + node.id === selector) ?? null; }
    setAttribute(name, value) { this.attrs[name] = value; }
    replaceChildren(...children) { this.children = children; }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  const nodes = [];
  for (const [, closing, tag, raw] of html.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/gi)) {
    if (closing) { stack.pop(); continue; }
    const attrs = Object.fromEntries([...raw.matchAll(/([^\s=]+)(?:="([^"]*)")?/g)].map(([, key, value]) => [key, value ?? '']));
    const node = new Element(tag, attrs); nodes.push(node);
    if (node.id) elements.set(node.id, node);
    if (!['meta', 'link', 'input', 'br'].includes(tag)) stack.push(node);
  }
  const get = id => { assert.ok(elements.has(id), `authored element ${id}`); return elements.get(id); };
  const location = new URL('chrome-extension://' + 'a'.repeat(32) + '/devices.html' + query);
  const state = { initialized: true, permission: granted ? 'granted' : 'absent', registration: 'unchecked', observation: null,
    observedAt: null, pending: null, journalHealthy: true, feedback: 'not-checked', canMutate: true };
  const context = vm.createContext({ ...admin, ...browser, URL, location, console,
    history: { state: null, replaceState(_state, _unused, url) {
      effects.push(['history', url]); if (historyFails) throw Error('history unavailable'); location.href = new URL(url, location).href;
    } },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    document: { getElementById: get, documentElement: { lang: 'en' }, createElement: tag => new Element(tag),
      querySelectorAll(selector) { return nodes.filter(node => selector === '[data-i18n]' ? node.dataset.i18n : selector === '[data-action]' ? node.dataset.action : false); },
      addEventListener(name, handler) { documentListeners.set(name, [...(documentListeners.get(name) ?? []), handler]); } },
    navigator: { locks: { request() { effects.push(['lock']); } } },
    createTranslator: catalog => key => language === 'zh_CN' ? key : catalog[key] ?? key,
    initializeLanguage: async () => {}, subscribeLanguage() {}, getLanguage: () => language,
    setLanguage: async value => { effects.push(['language-write']); language = value; },
    deviceScope: () => '', HOST: 'fixture', BROWSER_WAKE_HOST: 'fixture', PENDING_KEY: 'pending', REVISION_KEY: 'revision',
    validPreparedReference: () => false, controlPrepared: async () => { effects.push(['prepared']); },
    createDeviceController: ({ onChange }) => ({ getState: () => state,
      async initialize() { effects.push(['initialize']); onChange(); },
      async refreshPending() { effects.push(['refresh-pending']); },
      async run(action) { effects.push(['device', action]); },
      async requestPermission() { effects.push(['permission-request']); } }),
    fetch() { effects.push(['network']); throw Error('unexpected network'); },
    chrome: { extension: { inIncognitoContext: incognito },
      runtime: { id: 'a'.repeat(32), async sendMessage(message) {
        const copy = JSON.parse(JSON.stringify(message)); messages.push(copy); effects.push(['message', copy]); return onMessage(message);
      } },
      permissions: { async contains() { effects.push(['permission-read']); return onPermission(); },
        onAdded: { addListener() {} }, onRemoved: { addListener(listener) { listeners.push(listener); } } },
      storage: { local: { async get(keys) {
        effects.push(['storage-read', [...keys]]);
        if (beforePreference && keys.includes(browser.ADMIN_BROWSER_RESTORE)) await beforePreference(get);
        return Object.fromEntries(keys.map(key => [key, data[key]]));
      }, async set(values) { effects.push(['storage-write', values]); } }, onChanged: { addListener(listener) { listeners.push(listener); } } } },
  });
  vm.runInContext(`globalThis.window = globalThis; window.top = ${embedded ? '{}' : 'window'};`, context);
  await vm.runInContext(`(async () => {\n${source}\n})()`, context);
  return { get, location, effects, messages, state, timers, handle(handler) { onMessage = handler; }, permission(handler) { onPermission = handler; },
    visible(id) { const node = get(id); return ![...node.parents, node].some(parent => parent.hidden); },
    async select(account) { const node = get('account-' + account); node.checked = true; await node.fire('change'); },
    async click(id) { if (!get(id).disabled) await get(id).fire('click'); },
    async removePermission() { granted = false; state.permission = 'absent'; for (const listener of listeners) listener({ permissions: ['nativeMessaging'] }); await tick(); },
    async expire() { for (const [id, timer] of [...timers]) if (timer.delay === 30000) { timers.delete(id); timer.callback(); } await tick(); },
    async publishJournal(value) { data[admin.ADMIN_CONTROL_JOURNAL] = value;
      for (const listener of listeners) listener({ [admin.ADMIN_CONTROL_JOURNAL]: { newValue: value } }, 'local'); await tick(); },
    savePause(value) { data[browser.ADMIN_BROWSER_PAUSE_LAST] = value; },
  };
}

test('browser-managed shows only the selected account, including Advanced; permission and setup stay shared', async () => {
  const f = await fixture();
  for (const account of ['current', 'administrator', 'current']) {
    const before = JSON.stringify(f.effects);
    await f.select(account);
    assert.equal(JSON.stringify(f.effects), before, 'selection has no reads, writes, requests or dispatch');
    assert.equal(f.visible('standard-controls'), account === 'current');
    assert.equal(f.visible('administrator-controls'), account === 'administrator');
    assert.equal(f.visible('device-diagnostics'), account === 'current');
    assert.equal(f.visible('administrator-control-panel'), account === 'administrator');
    for (const id of ['permission', 'riskConsent', 'grantPermission', 'permission-check', 'setup-entry', 'install-guide']) assert.ok(f.visible(id), `${id} shared`);
    assert.equal(f.get('account-current').checked, account === 'current');
    assert.equal(f.get('account-administrator').checked, account === 'administrator');
  }
  assert.deepEqual(f.messages, [], 'initialization and switching never check capabilities');
});

test('a selection made before saved intent resolves wins over the default and survives full language renders', async () => {
  const f = await fixture({ restore: true, beforePreference: async get => { await get('account-current').fire('change'); } });
  assert.ok(f.get('account-current').checked);
  await f.select('administrator');
  f.get('language').value = 'zh_CN'; await f.get('language').fire('change');
  assert.ok(f.visible('administrator-controls'));
  assert.equal(f.visible('standard-controls'), false);
  assert.equal(f.get('account-administrator-label').textContent, '管理员');
  await f.select('current');
  await f.click('permission-check');
  assert.ok(f.visible('standard-controls'));
  assert.equal(f.visible('administrator-controls'), false);
});

for (const [restore, expected] of [[true, 'administrator'], [false, 'current'], [undefined, 'current'], ['true', 'current']]) {
  test(`existing saved intent ${String(restore)} defaults to ${expected} without claiming readiness`, async () => {
    const f = await fixture({ restore });
    assert.ok(f.get('account-' + expected).checked);
    assert.match(f.get('administrator-status').textContent, /not been checked/);
    assert.deepEqual(f.messages, []);
  });
}

for (const account of ['current', 'administrator']) {
  test(`explicit ${account} URL hint wins and is canonicalized before any initialization`, async () => {
    const f = await fixture({ query: `?account=${account}&mode=browser-managed#status`, restore: account === 'current' });
    assert.equal(f.location.search, '?mode=browser-managed');
    assert.equal(f.location.hash, '#status');
    assert.equal(f.effects[0][0], 'history');
    assert.ok(f.get('account-' + account).checked);
    await f.select(account === 'current' ? 'administrator' : 'current');
    assert.equal(f.effects.filter(effect => effect[0] === 'history').length, 1, 'switch never touches URL');
    assert.equal(browser.administratorDevicesSender({ id: 'a'.repeat(32), getURL: page => `chrome-extension://${'a'.repeat(32)}/${page}` },
      { id: 'a'.repeat(32), frameId: 0, url: f.location.href }), true, 'unchanged exact sender accepts canonical URL');
  });
}

for (const query of ['?mode=browser-managed&account=invalid', '?mode=browser-managed&account=current&account=administrator',
  '?mode=browser-managed&account=administrator&extra=1', '?mode=browser-managed&mode=browser-managed&account=current',
  '?mode=browser-managed&account=administrator&target=' + 'd'.repeat(64)]) {
  test(`malformed account route never widens administrator sender policy: ${query}`, async () => {
    const f = await fixture({ query });
    assert.equal(f.location.search, query);
    assert.equal(f.visible('administrator-controls'), false);
    await f.get('administrator-revoke').fire('click');
    assert.deepEqual(f.messages, []);
    assert.equal(f.effects.some(effect => effect[0] === 'history'), false);
  });
}

test('history failure fails closed rather than dispatching from a noncanonical account URL', async () => {
  const f = await fixture({ query: '?mode=browser-managed&account=administrator', historyFails: true });
  assert.equal(f.visible('administrator-controls'), false);
  await f.get('administrator-revoke').fire('click');
  assert.deepEqual(f.messages, []);
});

for (const query of ['', '?target=' + 'd'.repeat(64)]) {
  test(`standalone and target behavior retain current controls and no account selector: ${query}`, async () => {
    const f = await fixture({ query, restore: true });
    assert.equal(f.visible('account-selector'), false);
    assert.equal(f.visible('standard-controls'), true);
    assert.equal(f.visible('administrator-controls'), false);
    assert.deepEqual(f.messages, []);
  });
}

test('primary Revoke discovers only Revoke capability then requires the existing confirmation and exact admission', async () => {
  const f = await fixture({ restore: true });
  assert.equal(f.get('administrator-revoke').disabled, false);
  await f.click('administrator-revoke');
  assert.deepEqual(f.messages, [{ type: admin.ADMIN_CONTROL_SUPPORT, control: 'revoke' }]);
  assert.equal(f.get('administrator-control-dialog').open, true);
  assert.match(f.get('administrator-control-risk').textContent, /entire installation.*not proof of stopped/s);
  assert.equal(f.effects.some(effect => effect[0] === 'storage-write'), false);
  const before = JSON.stringify(f.effects);
  await f.select('current'); await f.select('administrator');
  assert.equal(JSON.stringify(f.effects), before);
  assert.equal(f.get('administrator-control-dialog').open, true, 'selection does not alter confirmation');
  f.handle(() => null);
  await f.click('administrator-control-confirm'); await f.click('administrator-control-confirm');
  assert.deepEqual(f.messages.at(-1), { type: admin.ADMIN_CONTROL, control: 'revoke', bundleSha256: digest });
  assert.equal(f.messages.length, 2, 'one capability read, one explicit targetless deny, no retry');
});

test('Ready recovered by Check administrator status plus Restore needs no Advanced discovery for Revoke', async () => {
  const f = await fixture({ restore: true });
  f.handle(message => message.type === browser.ADMIN_BROWSER_MESSAGE ? { state: 'ready', generation: 'd'.repeat(32) } : support);
  await f.click('administrator-check');
  assert.match(f.get('administrator-status').textContent, /reported ready/);
  assert.equal(f.get('administrator-restore').checked, true);
  assert.equal(f.get('administrator-revoke').disabled, false);
  await f.click('administrator-revoke');
  assert.deepEqual(f.messages, [{ type: browser.ADMIN_BROWSER_MESSAGE }, { type: admin.ADMIN_CONTROL_SUPPORT, control: 'revoke' }]);
  assert.equal(f.get('administrator-control-dialog').open, true);
  await f.get('administrator-control-dialog').fire('cancel'); f.get('administrator-control-dialog').close();
  await f.click('administrator-control-confirm');
  assert.equal(f.messages.length, 2, 'cancelled review never submits');
  await f.click('administrator-revoke');
  assert.equal(f.messages.length, 2, 'known Revoke capability needs no liveness or support RPC');
  assert.equal(f.get('administrator-control-dialog').open, true);
});

test('guided Revoke is single flight, times out, discards late capability and can be retried explicitly', async () => {
  const f = await fixture(), pending = deferred();
  f.handle(() => pending.promise);
  const checking = f.click('administrator-revoke'); await tick();
  await f.click('administrator-revoke');
  assert.equal(f.messages.length, 1);
  await f.expire(); await checking;
  assert.equal(f.get('administrator-control-dialog').open, false);
  assert.equal(f.get('administrator-revoke').disabled, false);
  pending.resolve(support); await tick();
  assert.equal(f.get('administrator-control-dialog').open, false);
  assert.equal(f.messages.length, 1);
  f.handle(() => support); await f.click('administrator-revoke');
  assert.equal(f.get('administrator-control-dialog').open, true);
});

for (const phase of ['before', 'after']) {
  test(`guided Revoke bounds stalled ${phase}-dispatch permission read without late admission`, async () => {
    const f = await fixture(), pending = deferred(); let reads = 0;
    f.permission(() => ++reads === (phase === 'before' ? 1 : 2) ? pending.promise : true);
    const checking = f.click('administrator-revoke'); await tick();
    await f.expire(); await checking;
    pending.resolve(true); await tick();
    assert.equal(f.messages.length, phase === 'before' ? 0 : 1);
    assert.equal(f.get('administrator-control-dialog').open, false);
  });
}

for (const reply of [null, { ...support, eligible: false }, { ...support, target: 'invented' }, { ...support, extra: true }]) {
  test(`guided Revoke fails closed on unavailable, ineligible or malformed support: ${JSON.stringify(reply)}`, async () => {
    const f = await fixture(); f.handle(() => reply);
    await f.click('administrator-revoke');
    assert.equal(f.get('administrator-control-dialog').open, false);
    assert.equal(f.messages.length, 1);
    assert.equal(f.effects.some(effect => effect[0] === 'storage-write'), false);
  });
}

test('permission removal or a pending Revoke blocks late guided review; pending startup does not block deny', async () => {
  for (const change of ['permission', 'journal']) {
    const f = await fixture(), pending = deferred(); f.handle(() => pending.promise);
    const checking = f.click('administrator-revoke'); await tick();
    if (change === 'permission') await f.removePermission();
    else await f.publishJournal({ version: 1, operations: [pendingRecord('revoke')] });
    pending.resolve(support); await checking;
    assert.equal(f.get('administrator-control-dialog').open, false);
    assert.equal(f.messages.length, 1);
    assert.doesNotMatch(f.get('administrator-control-feedback').textContent, /Checking Revoke support/);
  }
  const f = await fixture({ journal: { version: 1, operations: [pendingRecord('connect')] } });
  await f.click('administrator-revoke');
  assert.equal(f.get('administrator-control-dialog').open, true);
});

for (const options of [{ granted: false }, { incognito: true }, { embedded: true }, { journal: { invalid: true } },
  { journal: { version: 1, operations: [pendingRecord('revoke')] } }]) {
  test(`primary Revoke preserves route, permission and journal fail-closed gates: ${JSON.stringify(options)}`, async () => {
    const f = await fixture(options);
    assert.equal(f.get('administrator-revoke').disabled, true);
    await f.get('administrator-revoke').fire('click');
    await f.get('administrator-control-confirm').fire('click');
    assert.deepEqual(f.messages, []);
    assert.equal(f.effects.some(effect => effect[0] === 'storage-write'), false);
  });
}

test('account labels follow the existing language flow and switching preserves pause and restore state', async () => {
  const f = await fixture({ language: 'zh_CN', restore: true });
  assert.equal(f.get('account-current-label').textContent, '当前账户');
  assert.equal(f.get('account-administrator-label').textContent, '管理员');
  await f.click('administrator-pause');
  assert.equal(f.get('administrator-pause-dialog').open, true);
  const before = JSON.stringify(f.effects);
  await f.select('current'); await f.select('administrator');
  assert.equal(JSON.stringify(f.effects), before);
  assert.equal(f.get('administrator-pause-dialog').open, true);
  assert.equal(f.get('administrator-restore').checked, true);
});

test('radio and label events leave an existing exact-ID Pause followup untouched', async () => {
  const f = await fixture({ restore: true });
  f.handle(message => {
    if (message.type === browser.ADMIN_BROWSER_PAUSE) {
      const record = { operationId, outcome: 'requested' }; f.savePause(record); return record;
    }
    if (message.type === browser.ADMIN_BROWSER_PAUSE_STATUS) return { operationId, state: 'pause-recorded' };
    return null;
  });
  await f.click('administrator-pause'); await f.click('administrator-pause-confirm'); await tick();
  assert.equal(f.messages.filter(message => message.type === browser.ADMIN_BROWSER_PAUSE).length, 1);
  assert.ok([...f.timers.values()].some(timer => timer.delay === 3000), 'explicit Pause has a scheduled exact-ID followup');
  const timers = [...f.timers.keys()], effects = JSON.stringify(f.effects);
  const pauseFeedback = f.get('administrator-pause-request-feedback').textContent;
  await f.get('account-current-label').fire('click'); await f.select('current');
  await f.get('account-administrator-label').fire('click'); await f.select('administrator');
  assert.deepEqual([...f.timers.keys()], timers, 'selection does not cancel or replace receipt timers');
  assert.equal(JSON.stringify(f.effects), effects, 'selection dispatches no reads, requests or writes');
  assert.equal(f.get('administrator-pause-request-feedback').textContent, pauseFeedback);
  assert.equal(f.get('administrator-pause-id').value, operationId);
});
