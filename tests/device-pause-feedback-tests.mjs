import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { test, afterEach } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import * as adminBrowser from '../admin-browser.js';
import * as adminControl from '../admin-control.js';
import * as deviceControl from '../device-control.js';
import * as browserWake from '../browser-wake.js';

// Run the authored page and event handlers without a browser, native host or OS changes.
const source = await fs.readFile(new URL('../devices.js', import.meta.url), 'utf8');
const html = await fs.readFile(new URL('../devices.html', import.meta.url), 'utf8');
const executable = source.replace(/^import .*;\r?\n/gm, '');
const operationId = 'a'.repeat(32), otherId = 'b'.repeat(32);
const pauseKey = adminBrowser.ADMIN_BROWSER_PAUSE_LAST;
const record = (id = operationId, outcome = 'requested') => ({ operationId: id, outcome });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const cleanups = new Set();
afterEach(async () => { for (const cleanup of cleanups) await cleanup(); cleanups.clear(); });

async function fixture({ lastPause = record(), language = 'en' } = {}) {
  const elements = new Map(), messages = [], writes = [], storageListeners = [], permissionListeners = [], timers = new Map();
  const documentListeners = new Map(), windowListeners = new Map();
  const data = { [pauseKey]: lastPause };
  let timerId = 0, now = 0, onMessage, onGet, onPermission;
  const listen = (listeners, name, handler) => listeners.set(name, [...(listeners.get(name) ?? []), handler]);
  const dispatch = (listeners, name) => { for (const handler of listeners.get(name) ?? []) handler(); };
  class Element {
    constructor(id = '') {
      this.id = id; this.value = ''; this.open = false; this.hidden = false; this.disabled = false;
      this.checked = false; this.textContent = ''; this.dataset = {}; this.handlers = new Map();
    }
    addEventListener(name, handler) { this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]); }
    async fire(name) {
      dispatch(documentListeners, name);
      await Promise.all((this.handlers.get(name) ?? []).map(handler => handler({ target: this, preventDefault() {} })));
      await tick();
    }
    showModal() { this.open = true; }
    close() { this.open = false; }
    setAttribute() {}
    replaceChildren() {}
  }
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) elements.set(match[1], new Element(match[1]));
  const get = id => { assert.ok(elements.has(id), `authored element ${id} exists`); return elements.get(id); };
  const state = { initialized: true, permission: 'granted', registration: 'unchecked', observation: null,
    observedAt: null, pending: null, journalHealthy: true, feedback: 'not-checked', canMutate: false };
  const save = async value => {
    data[pauseKey] = value;
    for (const listener of storageListeners) listener({ [pauseKey]: { newValue: value } }, 'local');
    await tick();
  };
  const notify = async (key, value) => {
    data[key] = value;
    for (const listener of storageListeners) listener({ [key]: { newValue: value } }, 'local');
    await tick();
  };
  const context = vm.createContext({
    ...adminBrowser, ...adminControl, ...deviceControl, ...browserWake,
    URL, console, location: new URL('chrome-extension://' + 'c'.repeat(32) + '/devices.html?mode=browser-managed'),
    Date: class extends Date { static now() { return now; } },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, handler) { listen(windowListeners, name, handler); },
    document: { getElementById: get, querySelectorAll: () => [], documentElement: { lang: 'en' }, createElement: () => new Element(),
      addEventListener(name, handler) { listen(documentListeners, name, handler); } },
    navigator: { locks: { request() {} } },
    createTranslator: catalog => key => language === 'zh_CN' ? key : catalog[key] ?? key,
    initializeLanguage: async () => {}, subscribeLanguage() {}, setLanguage: async () => {}, getLanguage: () => language,
    createDeviceController: ({ onChange }) => ({ getState: () => state, initialize: async () => onChange(), refreshPending: async () => {} }),
    chrome: {
      runtime: { async sendMessage(message) {
        messages.push(JSON.parse(JSON.stringify(message)));
        if (onMessage) return onMessage(messages.at(-1));
        if (message.type === adminBrowser.ADMIN_BROWSER_MESSAGE) return { state: 'ready', generation: otherId };
        return null;
      } },
      permissions: {
        async contains() { return onPermission ? onPermission() : state.permission === 'granted'; },
        onRemoved: { addListener(listener) { permissionListeners.push(listener); } },
      },
      storage: { local: {
        async get(keys) { return onGet ? onGet(keys) : Object.fromEntries(keys.map(key => [key, data[key]])); },
        async set(values) { writes.push(values); },
      }, onChanged: { addListener(listener) { storageListeners.push(listener); } } },
    },
  });
  vm.runInContext('globalThis.window = globalThis; window.top = window;', context);
  await vm.runInContext(`(async () => {\n${executable}\n})()`, context);
  cleanups.add(async () => { dispatch(windowListeners, 'pagehide'); await tick(); assert.equal(timers.size, 0, 'no fixture timers remain'); });
  return {
    get, messages, writes, state, timers, save, notify,
    handle(handler) { onMessage = handler; },
    handleGet(handler) { onGet = handler; },
    handlePermission(handler) { onPermission = handler; },
    navigate() { context.location = new URL('https://device-fixture.invalid/elsewhere'); },
    async pagehide() { dispatch(windowListeners, 'pagehide'); await tick(); },
    jump(ms) { now += ms; },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = Math.max(now, next[1].at);
        timers.delete(next[0]);
        next[1].callback();
        await tick();
      }
      now = end;
      await tick();
    },
    async removePermission() {
      state.permission = 'denied';
      for (const listener of permissionListeners) listener({ permissions: ['nativeMessaging'] });
      await tick();
    },
    async click(id) { await get(id).fire('click'); },
    async input(id) { get('administrator-pause-id').value = id; await get('administrator-pause-id').fire('input'); },
    async read(receipt) { onMessage = () => receipt; await get('administrator-pause-receipt').fire('submit'); },
    async pause() { await get('administrator-pause').fire('click'); await get('administrator-pause-confirm').fire('click'); },
  };
}

function assertSuperseded(f) {
  const request = f.get('administrator-pause-request-feedback'), receipt = f.get('administrator-pause-feedback');
  assert.equal(request.hidden, false);
  assert.equal(receipt.hidden, false);
  assert.equal(request.textContent, receipt.textContent, 'the latest verified receipt supersedes stale request feedback');
}

async function pendingPause(f, receipt = { operationId, state: 'unconfirmed' }) {
  f.handle(async message => {
    if (message.type === adminBrowser.ADMIN_BROWSER_PAUSE) { await f.save(record()); return record(); }
    assert.deepEqual(message, { type: adminBrowser.ADMIN_BROWSER_PAUSE_STATUS, operationId });
    return receipt;
  });
  await f.pause();
}
const pauseReads = f => f.messages.filter(message => message.type === adminBrowser.ADMIN_BROWSER_PAUSE_STATUS);

test('bounded followup advances unknown to pause-recorded to stopped using only the stored exact ID', async () => {
  const f = await fixture();
  await pendingPause(f);
  assert.equal(f.timers.size, 1);
  f.handle(() => ({ operationId, state: 'pause-recorded' }));
  await f.advance(3000);
  assert.match(f.get('administrator-pause-request-feedback').textContent, /was recorded.*not verified/i);
  f.handle(() => ({ operationId, state: 'stopped' }));
  await f.advance(3000);
  assertSuperseded(f);
  assert.match(f.get('administrator-pause-feedback').textContent, /was not running.*not the current connection status/i);
  assert.equal(f.get('administrator-status').textContent, 'Administrator status has not been checked.');
  assert.equal(f.timers.size, 0);
  await f.advance(30000);
  assert.deepEqual(f.messages, [{ type: adminBrowser.ADMIN_BROWSER_PAUSE },
    ...Array.from({ length: 3 }, () => ({ type: adminBrowser.ADMIN_BROWSER_PAUSE_STATUS, operationId }))]);
  assert.deepEqual(f.writes, []);
});

for (const state of ['unconfirmed', 'pause-recorded']) {
  test(`bounded ${state} followup permits at most four additional reads and leaves manual controls usable`, async () => {
    const f = await fixture();
    await pendingPause(f, { operationId, state });
    assert.equal(f.get('administrator-pause').disabled, false);
    assert.equal(f.get('administrator-pause-check').disabled, false);
    assert.equal(f.get('administrator-pause-id').disabled, false);
    await f.advance(15000);
    assert.equal(pauseReads(f).length, 5);
    assert.ok(pauseReads(f).every(message => message.operationId === operationId));
    assert.equal(f.timers.size, 0);
    await f.advance(60000);
    assert.equal(pauseReads(f).length, 5);
    assert.equal(f.messages.filter(message => message.type === adminBrowser.ADMIN_BROWSER_PAUSE).length, 1);
    assert.deepEqual(f.writes, []);
  });
}

for (const state of ['stopped', 'fenced', 'superseded']) {
  for (const phase of ['initial', 'followup']) {
    test(`${state} on ${phase} read ends automatic feedback without claiming current readiness`, async () => {
      const f = await fixture();
      await pendingPause(f, { operationId, state: phase === 'initial' ? state : 'unconfirmed' });
      if (phase === 'followup') {
        f.handle(() => ({ operationId, state }));
        await f.advance(3000);
      }
      assertSuperseded(f);
      assert.equal(f.timers.size, 0);
      await f.advance(30000);
      assert.equal(pauseReads(f).length, phase === 'initial' ? 1 : 2);
      assert.equal(f.get('administrator-status').textContent, 'Administrator status has not been checked.');
      assert.deepEqual(f.writes, []);
    });
  }
}

test('page load and a manual unknown read never start automatic followup', async () => {
  const f = await fixture();
  await f.advance(30000);
  assert.deepEqual(f.messages, []);
  await f.read({ operationId, state: 'unconfirmed' });
  await f.advance(30000);
  assert.equal(pauseReads(f).length, 1);
  assert.equal(f.timers.size, 0);
});

test('a delayed timer after the feedback window cannot dispatch another native read', async () => {
  const f = await fixture();
  await pendingPause(f);
  f.jump(16000);
  await f.advance(0);
  assert.equal(pauseReads(f).length, 1);
  assert.equal(f.timers.size, 0);
});

test('manual Pause takes precedence even during the initial automatic native read', async () => {
  const f = await fixture(), pending = deferred(), reading = deferred();
  f.handle(async message => {
    if (message.type === adminBrowser.ADMIN_BROWSER_PAUSE) { await f.save(record()); return record(); }
    reading.resolve(); return pending.promise;
  });
  const pausing = f.pause();
  await reading.promise;
  await tick();
  assert.equal(f.get('administrator-pause').disabled, false);
  assert.equal(f.get('administrator-pause-check').disabled, false);
  await f.click('administrator-pause');
  assert.equal(f.get('administrator-pause-dialog').open, true);
  pending.resolve({ operationId, state: 'stopped' });
  await pausing;
  await f.advance(30000);
  assert.equal(pauseReads(f).length, 1);
  assert.doesNotMatch(f.get('administrator-pause-request-feedback').textContent, /was not running/i);
});

test('a new user action while the Pause reply is pending prevents a later automatic sequence', async () => {
  const f = await fixture(), pending = deferred(), launched = deferred();
  f.handle(async message => {
    if (message.type === adminBrowser.ADMIN_BROWSER_PAUSE) {
      await f.save(record()); launched.resolve(); return pending.promise;
    }
    return { state: 'unobserved', generation: null };
  });
  const pausing = f.pause();
  await launched.promise;
  await f.click('administrator-check');
  pending.resolve(record());
  await pausing;
  await f.advance(30000);
  assert.equal(pauseReads(f).length, 0);
  assert.equal(f.timers.size, 0);
});

for (const phase of ['permission', 'native']) {
  test(`the initial automatic ${phase} read also expires and ignores a late result`, async () => {
    const f = await fixture(), pending = deferred(), reading = deferred();
    f.handle(async message => {
      if (message.type === adminBrowser.ADMIN_BROWSER_PAUSE) {
        await f.save(record());
        if (phase === 'permission') f.handlePermission(() => { reading.resolve(); return pending.promise; });
        return record();
      }
      reading.resolve(); return pending.promise;
    });
    const pausing = f.pause();
    await reading.promise;
    await f.advance(5000);
    await pausing;
    assert.equal(f.get('administrator-pause').disabled, false);
    assert.equal(f.get('administrator-pause-check').disabled, false);
    assert.equal(f.timers.size, 0);
    pending.resolve(phase === 'permission' ? true : { operationId, state: 'stopped' });
    await tick();
    await f.advance(30000);
    assert.equal(pauseReads(f).length, phase === 'permission' ? 0 : 1);
    assert.doesNotMatch(f.get('administrator-pause-request-feedback').textContent, /was not running/i);
  });
}

test('a stalled followup native read expires without blocking Pause or publishing a late receipt', async () => {
  const f = await fixture(), pending = deferred();
  await pendingPause(f);
  f.handle(() => pending.promise);
  await f.advance(3000);
  assert.equal(pauseReads(f).length, 2);
  assert.equal(f.get('administrator-pause').disabled, false);
  assert.equal(f.get('administrator-pause-check').disabled, false);
  const before = f.get('administrator-pause-request-feedback').textContent;
  await f.advance(5000);
  assert.equal(f.timers.size, 0);
  pending.resolve({ operationId, state: 'stopped' });
  await tick();
  await f.advance(30000);
  assert.equal(f.get('administrator-pause-request-feedback').textContent, before);
  assert.equal(pauseReads(f).length, 2);
});

for (const phase of ['before native read', 'after native read']) {
  test(`stalled ${phase} permission read has a deadline and cannot dispatch or publish late`, async () => {
    const f = await fixture(), pending = deferred();
    await pendingPause(f);
    if (phase === 'before native read') f.handlePermission(() => pending.promise);
    else f.handle(() => { f.handlePermission(() => pending.promise); return { operationId, state: 'stopped' }; });
    await f.advance(3000);
    await f.advance(5000);
    assert.equal(f.timers.size, 0);
    pending.resolve(true);
    await tick();
    await f.advance(30000);
    assert.equal(pauseReads(f).length, phase === 'before native read' ? 1 : 2);
    assert.doesNotMatch(f.get('administrator-pause-request-feedback').textContent, /was not running/i);
  });
}

test('the total fifteen-second deadline includes slow initial and followup reads', async () => {
  const f = await fixture();
  const pending = [];
  f.handle(async message => {
    if (message.type === adminBrowser.ADMIN_BROWSER_PAUSE) { await f.save(record()); return record(); }
    const read = deferred(); pending.push(read); return read.promise;
  });
  const pausing = f.pause();
  for (let i = 0; i < 10 && !pending.length; i++) await tick();
  assert.equal(pending.length, 1);
  await f.advance(4000);
  pending[0].resolve({ operationId, state: 'pause-recorded' });
  await pausing;
  await tick();
  await f.advance(3000);
  await f.advance(4000);
  pending[1].resolve({ operationId, state: 'pause-recorded' });
  await tick();
  await f.advance(3000);
  assert.equal(pending.length, 3);
  await f.advance(1000);
  assert.equal(f.timers.size, 0);
  pending[2].resolve({ operationId, state: 'stopped' });
  await tick();
  await f.advance(30000);
  assert.equal(pauseReads(f).length, 3);
  assert.doesNotMatch(f.get('administrator-pause-request-feedback').textContent, /was not running/i);
});

for (const phase of ['waiting', 'reading']) {
  for (const change of ['selection', 'same-ID storage revision', 'different-ID storage', 'permission removal', 'navigation',
    'cleared storage', 'invalid storage', 'administrator journal revision', 'device operation revision', 'silent permission loss',
    'pagehide', 'new Pause', 'Revoke', 'manual receipt', 'status check']) {
    test(`${change} while ${phase} cancels the original followup and rejects late feedback`, async () => {
      const f = await fixture(), pending = deferred();
      if (change === 'Revoke') {
        f.handle(message => ({ control: message.control, state: 'supported', bundleSha256: 'c'.repeat(64),
          target: message.control === 'revoke' ? null : otherId, ownerState: 'running', eligible: true }));
        await f.click('administrator-control-support-check');
      }
      await pendingPause(f);
      if (phase === 'reading') {
        f.handle(() => pending.promise);
        await f.advance(3000);
        assert.equal(pauseReads(f).length, 2);
      }
      const reads = pauseReads(f).length;
      if (change === 'selection') { await f.input(otherId); await f.input(operationId); }
      if (change === 'same-ID storage revision') await f.save(record(operationId, 'unconfirmed'));
      if (change === 'different-ID storage') await f.save(record(otherId));
      if (change === 'cleared storage') await f.save(undefined);
      if (change === 'invalid storage') await f.save({ ...record(), extra: true });
      if (change === 'administrator journal revision') await f.notify(adminControl.ADMIN_CONTROL_JOURNAL, { version: 1, operations: [] });
      if (change === 'device operation revision') await f.notify(deviceControl.REVISION_KEY + ':browser-managed', 'new-revision');
      if (change === 'permission removal') await f.removePermission();
      if (change === 'silent permission loss') f.handlePermission(() => false);
      if (change === 'navigation') f.navigate();
      if (change === 'pagehide') await f.pagehide();
      if (change === 'new Pause') {
        await f.click('administrator-pause');
        assert.equal(f.get('administrator-pause-dialog').open, true, 'Pause takes precedence over automatic readback');
      }
      if (change === 'Revoke') {
        assert.equal(f.get('administrator-revoke').disabled, false);
        await f.click('administrator-revoke');
        assert.equal(f.get('administrator-control-dialog').open, true, 'Revoke retains precedence over automatic readback');
      }
      if (change === 'manual receipt') await f.read({ operationId, state: 'pause-recorded' });
      if (change === 'status check') { f.handle(() => ({ state: 'unobserved', generation: null })); await f.click('administrator-check'); }
      pending.resolve({ operationId, state: 'stopped' });
      await tick();
      await f.advance(30000);
      assert.equal(pauseReads(f).length, reads + (change === 'manual receipt' ? 1 : 0));
      assert.doesNotMatch(f.get('administrator-pause-request-feedback').textContent, /was not running/i);
      assert.equal(f.timers.size, 0);
      assert.deepEqual(f.writes, []);
      assert.equal(f.messages.filter(message => message.type === adminBrowser.ADMIN_BROWSER_PAUSE).length, 1);
    });
  }
}

for (const language of ['en', 'zh_CN']) {
  for (const receiptState of ['stopped', 'pause-recorded']) {
    test(`GUI Pause automatically reads exact ${receiptState} receipt (${language})`, async () => {
      const f = await fixture({ language, lastPause: undefined });
      await f.save(undefined);
      await f.click('administrator-check');
      const status = f.get('administrator-status').textContent;
      f.handle(async message => {
        if (message.type === adminBrowser.ADMIN_BROWSER_PAUSE) {
          await f.save(record());
          return record();
        }
        assert.deepEqual(message, { type: adminBrowser.ADMIN_BROWSER_PAUSE_STATUS, operationId });
        return { operationId, state: receiptState };
      });
      await f.pause();
      assertSuperseded(f);
      const labels = language === 'en' ? {
        stopped: 'The managed administrator runtime was not running when this operation was verified. This is not the current connection status.',
        'pause-recorded': 'Pause was recorded for this operation. Shutdown was not verified.',
      } : {
        stopped: '核实该操作时，受管管理员运行端未在运行；这不是当前连接状态。',
        'pause-recorded': '该操作的暂停已记录，未证实已停止。',
      };
      assert.equal(f.get('administrator-pause-request-feedback').textContent, labels[receiptState]);
      assert.notEqual(f.get('administrator-status').textContent, status, 'Pause invalidates the earlier Ready observation');
      assert.equal(f.get('administrator-status').textContent,
        language === 'en' ? 'Administrator status has not been checked.' : '尚未核对管理员状态。');
      assert.equal(f.get('administrator-pause-reconcile').hidden, true);
      assert.deepEqual(f.messages.map(message => message.type), [adminBrowser.ADMIN_BROWSER_MESSAGE,
        adminBrowser.ADMIN_BROWSER_PAUSE, adminBrowser.ADMIN_BROWSER_PAUSE_STATUS]);
      assert.deepEqual(f.writes, []);
      assert.equal(f.timers.size, receiptState === 'pause-recorded' ? 1 : 0);
    });
  }
}

test('confirming Pause immediately clears Ready, including an earlier in-flight status read', async () => {
  const f = await fixture(), status = deferred(), pause = deferred();
  await f.click('administrator-check');
  assert.match(f.get('administrator-status').textContent, /reported ready/i);
  f.handle(message => message.type === adminBrowser.ADMIN_BROWSER_MESSAGE ? status.promise : pause.promise);
  const checking = f.click('administrator-check');
  await tick();
  await f.click('administrator-pause');
  const pausing = f.click('administrator-pause-confirm');
  await tick();
  assert.equal(f.get('administrator-status').textContent, 'Administrator status has not been checked.');
  status.resolve({ state: 'ready', generation: otherId });
  await checking;
  assert.equal(f.get('administrator-status').textContent, 'Administrator status has not been checked.');
  await f.save(undefined);
  pause.resolve(null);
  await pausing;
  assert.deepEqual(f.messages.map(message => message.type), [adminBrowser.ADMIN_BROWSER_MESSAGE,
    adminBrowser.ADMIN_BROWSER_MESSAGE, adminBrowser.ADMIN_BROWSER_PAUSE]);
});

for (const launch of ['lost reply', 'different reply ID', 'existing operation']) {
  test(`automatic readback uses only the latest stored ID after ${launch}`, async () => {
    const f = await fixture();
    const latestId = launch === 'existing operation' ? operationId : otherId;
    f.handle(async message => {
      if (message.type === adminBrowser.ADMIN_BROWSER_PAUSE) {
        await f.save(record(latestId));
        if (launch === 'lost reply') throw new Error('fixture transport loss');
        return record();
      }
      assert.deepEqual(message, { type: adminBrowser.ADMIN_BROWSER_PAUSE_STATUS, operationId: latestId });
      return { operationId: latestId, state: 'stopped' };
    });
    await f.pause();
    assertSuperseded(f);
    assert.match(f.get('administrator-pause-request-feedback').textContent, /was not running/i);
    assert.deepEqual(f.messages, [{ type: adminBrowser.ADMIN_BROWSER_PAUSE },
      { type: adminBrowser.ADMIN_BROWSER_PAUSE_STATUS, operationId: latestId }]);
    assert.equal(f.timers.size, 0);
    assert.deepEqual(f.writes, []);
  });
}

for (const saved of [undefined, { ...record(), extra: true }]) {
  test(`no automatic receipt lookup without a valid stored ID (${saved ? 'invalid' : 'absent'})`, async () => {
    const f = await fixture();
    f.handle(async () => { await f.save(saved); return record(); });
    await f.pause();
    assert.deepEqual(f.messages, [{ type: adminBrowser.ADMIN_BROWSER_PAUSE }]);
    assert.doesNotMatch(f.get('administrator-pause-request-feedback').textContent, /was not running/i);
    assert.equal(f.timers.size, 0);
  });
}

for (const phase of ['before lookup', 'during lookup']) {
  for (const change of ['permission removal', 'navigation']) {
    test(`${change} ${phase} prevents stale automatic Pause feedback`, async () => {
      const f = await fixture();
      f.handle(async message => {
        if (message.type === adminBrowser.ADMIN_BROWSER_PAUSE) await f.save(record());
        if ((phase === 'before lookup') === (message.type === adminBrowser.ADMIN_BROWSER_PAUSE)) {
          if (change === 'permission removal') await f.removePermission();
          else f.navigate();
        }
        return message.type === adminBrowser.ADMIN_BROWSER_PAUSE ? record() : { operationId, state: 'stopped' };
      });
      await f.pause();
      assert.deepEqual(f.messages.map(message => message.type), phase === 'before lookup' ?
        [adminBrowser.ADMIN_BROWSER_PAUSE] : [adminBrowser.ADMIN_BROWSER_PAUSE, adminBrowser.ADMIN_BROWSER_PAUSE_STATUS]);
      assert.doesNotMatch(f.get('administrator-pause-request-feedback').textContent, /was not running/i);
      assert.equal(f.get('administrator-pause').disabled, true);
      assert.equal(f.timers.size, 0);
    });
  }
}

test('storage change during the automatic permission check selects no stale operation', async () => {
  const f = await fixture();
  f.handle(async message => {
    assert.equal(message.type, adminBrowser.ADMIN_BROWSER_PAUSE);
    await f.save(record());
    f.handlePermission(async () => { await f.save(record(otherId)); return true; });
    return record();
  });
  await f.pause();
  assert.deepEqual(f.messages, [{ type: adminBrowser.ADMIN_BROWSER_PAUSE }]);
  assert.equal(f.get('administrator-pause-id').value, otherId);
  assert.doesNotMatch(f.get('administrator-pause-request-feedback').textContent, /was not running/i);
});

for (const nextRecord of [record(otherId), record(operationId, 'unconfirmed')]) {
  test(`storage revision change during automatic readback discards its receipt (${nextRecord.operationId === operationId ? 'same ID' : 'new ID'})`, async () => {
    const f = await fixture();
    f.handle(async message => {
      if (message.type === adminBrowser.ADMIN_BROWSER_PAUSE) {
        await f.save(record());
        return record();
      }
      await f.save(nextRecord);
      return { operationId, state: 'stopped' };
    });
    await f.pause();
    assert.deepEqual(f.messages, [{ type: adminBrowser.ADMIN_BROWSER_PAUSE },
      { type: adminBrowser.ADMIN_BROWSER_PAUSE_STATUS, operationId }]);
    assert.doesNotMatch(f.get('administrator-pause-request-feedback').textContent, /was not running/i);
    assert.equal(f.get('administrator-pause-reconcile').hidden, false);
    assert.equal(f.timers.size, 0);
  });
}

test('a newer storage notification wins over the delayed post-Pause storage snapshot', async () => {
  const f = await fixture(), snapshot = deferred(), reading = deferred();
  f.handle(async message => {
    if (message.type === adminBrowser.ADMIN_BROWSER_PAUSE) {
      await f.save(record());
      f.handleGet(() => { reading.resolve(); return snapshot.promise; });
      return record();
    }
    assert.deepEqual(message, { type: adminBrowser.ADMIN_BROWSER_PAUSE_STATUS, operationId: otherId });
    return { operationId: otherId, state: 'pause-recorded' };
  });
  const pausing = f.pause();
  await reading.promise;
  await f.save(record(otherId));
  snapshot.resolve({ [pauseKey]: record() });
  await pausing;
  assert.equal(f.get('administrator-pause-id').value, otherId);
  assertSuperseded(f);
  assert.match(f.get('administrator-pause-request-feedback').textContent, /Pause was recorded.*not verified/i);
  assert.deepEqual(f.messages, [{ type: adminBrowser.ADMIN_BROWSER_PAUSE },
    { type: adminBrowser.ADMIN_BROWSER_PAUSE_STATUS, operationId: otherId }]);
});

for (const outcome of ['requested', 'cancelled', 'unconfirmed']) {
  for (const receiptState of ['pause-recorded', 'stopped', 'superseded', 'fenced']) {
    test(`${receiptState} supersedes ${outcome} only as historical receipt evidence`, async () => {
      const f = await fixture({ lastPause: record(operationId, outcome) });
      const status = f.get('administrator-status').textContent;
      await f.read({ operationId, state: receiptState });
      assertSuperseded(f);
      assert.equal(f.get('administrator-status').textContent, status);
      assert.equal(f.get('administrator-pause-reconcile').hidden, true);
      assert.equal(f.get('administrator-pause').disabled, false);
      assert.deepEqual(f.messages, [{ type: adminBrowser.ADMIN_BROWSER_PAUSE_STATUS, operationId }]);
      assert.deepEqual(f.writes, []);
    });
  }
}

const invalidReceipts = [
  ['missing', undefined], ['null', null], ['unknown', { operationId, state: 'unconfirmed' }],
  ['different ID', { operationId: otherId, state: 'stopped' }],
  ['upper-case ID', { operationId: operationId.toUpperCase(), state: 'stopped' }],
  ['extra field', { operationId, state: 'stopped', extra: true }],
  ['missing ID', { state: 'stopped' }], ['missing state', { operationId }],
  ['invalid state', { operationId, state: 'ready' }],
];
for (const [name, receipt] of invalidReceipts) {
  test(`${name} receipt cannot supersede request feedback`, async () => {
    const f = await fixture();
    const before = f.get('administrator-pause-request-feedback').textContent;
    await f.read(receipt);
    assert.equal(f.get('administrator-pause-request-feedback').hidden, false);
    assert.equal(f.get('administrator-pause-request-feedback').textContent, before);
    assert.match(f.get('administrator-pause-feedback').textContent, /No verified pause receipt.*not resent/i);
    assert.equal(f.get('administrator-pause-reconcile').hidden, false);
  });
}

for (const [name, receipt] of [...invalidReceipts, ['transport failure', 'throw']]) {
  test(`automatic ${name} receipt retains unknown feedback and bounds read-only followup without replay`, async () => {
    const f = await fixture();
    await f.save(undefined);
    f.handle(async message => {
      if (message.type === adminBrowser.ADMIN_BROWSER_PAUSE) {
        await f.save(record());
        return record();
      }
      if (receipt === 'throw') throw new Error('fixture receipt failure');
      return receipt;
    });
    await f.pause();
    assert.match(f.get('administrator-pause-request-feedback').textContent, /requested.*not verified/i);
    assert.match(f.get('administrator-pause-feedback').textContent, /No verified pause receipt.*not resent/i);
    assert.equal(f.get('administrator-pause-reconcile').hidden, false);
    assert.deepEqual(f.messages, [{ type: adminBrowser.ADMIN_BROWSER_PAUSE },
      { type: adminBrowser.ADMIN_BROWSER_PAUSE_STATUS, operationId }]);
    assert.equal(f.timers.size, 1);
    await f.advance(15000);
    assert.equal(pauseReads(f).length, 5);
    assert.ok(pauseReads(f).every(message => message.operationId === operationId));
    assert.equal(f.messages.filter(message => message.type === adminBrowser.ADMIN_BROWSER_PAUSE).length, 1);
    assert.equal(f.timers.size, 0);
    assert.deepEqual(f.writes, []);
  });
}

test('a valid historical-ID receipt does not replace the latest request feedback', async () => {
  const f = await fixture();
  const before = f.get('administrator-pause-request-feedback').textContent;
  await f.input(otherId);
  await f.read({ operationId: otherId, state: 'stopped' });
  assert.equal(f.get('administrator-pause-request-feedback').textContent, before);
  assert.match(f.get('administrator-pause-feedback').textContent, /was not running.*not the current connection status/i);
  assert.equal(f.get('administrator-pause-reconcile').hidden, false);
});

test('pending and then unknown reread restores submission feedback without clearing verified-readback history', async () => {
  const f = await fixture(), pending = deferred();
  const before = f.get('administrator-pause-request-feedback').textContent;
  await f.read({ operationId, state: 'stopped' });
  f.handle(() => pending.promise);
  const submitting = f.get('administrator-pause-receipt').fire('submit');
  await tick();
  assert.equal(f.get('administrator-pause-check').disabled, true);
  assert.equal(f.get('administrator-pause-request-feedback').textContent, before);
  assert.match(f.get('administrator-pause-feedback').textContent, /checking.*receipt/i);
  pending.resolve({ operationId, state: 'unconfirmed' });
  await submitting;
  assert.equal(f.get('administrator-pause-request-feedback').textContent, before);
  assert.equal(f.get('administrator-pause-reconcile').hidden, true, 'unknown reread cannot undo earlier valid readback');
  assert.equal(f.get('administrator-pause-check').disabled, false);
});

test('input edits clear receipt presentation but preserve the latest-ID readback latch', async () => {
  const f = await fixture();
  const before = f.get('administrator-pause-request-feedback').textContent;
  await f.read({ operationId, state: 'stopped' });
  await f.input(otherId);
  assert.equal(f.get('administrator-pause-request-feedback').textContent, before);
  assert.equal(f.get('administrator-pause-feedback').hidden, true);
  assert.equal(f.get('administrator-pause-reconcile').hidden, true);
  await f.read({ operationId: otherId, state: 'stopped' });
  assert.equal(f.get('administrator-pause-request-feedback').textContent, before);
  await f.input(operationId);
  assert.equal(f.get('administrator-pause-request-feedback').textContent, before);
  assert.equal(f.get('administrator-pause-feedback').hidden, true);
  await f.read({ operationId, state: 'stopped' });
  assertSuperseded(f);
});

test('late valid latest-ID receipt cannot overwrite an edited selection', async () => {
  const f = await fixture(), pending = deferred();
  const before = f.get('administrator-pause-request-feedback').textContent;
  f.handle(() => pending.promise);
  const reading = f.get('administrator-pause-receipt').fire('submit');
  await tick();
  await f.input(otherId);
  pending.resolve({ operationId, state: 'stopped' });
  await reading;
  assert.equal(f.get('administrator-pause-id').value, otherId);
  assert.equal(f.get('administrator-pause-request-feedback').textContent, before);
  assert.equal(f.get('administrator-pause-feedback').hidden, true);
  assert.equal(f.get('administrator-pause-reconcile').hidden, true, 'valid latest readback survives an input edit');
});

test('a new GUI Pause retains pending feedback and resets the previous-ID readback latch', async () => {
  const f = await fixture(), pending = deferred();
  await f.read({ operationId, state: 'stopped' });
  f.handle(async message => {
    if (message.type === adminBrowser.ADMIN_BROWSER_PAUSE_STATUS) return null;
    assert.equal(message.type, adminBrowser.ADMIN_BROWSER_PAUSE);
    await f.save(record(otherId));
    return pending.promise;
  });
  await f.click('administrator-pause');
  const pausing = f.click('administrator-pause-confirm');
  await tick();
  assert.equal(f.get('administrator-pause').disabled, true);
  assert.equal(f.get('administrator-pause-check').disabled, true);
  assert.equal(f.get('administrator-pause-id').disabled, true);
  assert.match(f.get('administrator-pause-request-feedback').textContent, /requesting.*not verified/i);
  pending.resolve(record(otherId));
  await pausing;
  assert.equal(f.get('administrator-pause-id').value, otherId);
  assert.match(f.get('administrator-pause-request-feedback').textContent, /requested.*not verified/i);
  assert.match(f.get('administrator-pause-feedback').textContent, /No verified pause receipt.*not resent/i);
  assert.equal(f.get('administrator-pause-reconcile').hidden, false);
  assert.equal(f.get('administrator-pause').disabled, false);
  await f.read({ operationId: otherId, state: 'pause-recorded' });
  assertSuperseded(f);
});

test('verified receipt supersedes but does not erase the blocked-new-request note', async () => {
  const f = await fixture();
  f.handle(() => record());
  await f.pause();
  const note = f.get('administrator-pause-request-feedback').textContent;
  assert.match(note, /no new request.*existing operation/i);
  await f.read({ operationId, state: 'stopped' });
  assertSuperseded(f);
  await f.input(otherId);
  assert.equal(f.get('administrator-pause-request-feedback').textContent, note);
});

test('valid manual receipt without a latest stored ID does not invent request feedback', async () => {
  const f = await fixture();
  await f.save(undefined);
  await f.input(operationId);
  await f.read({ operationId, state: 'stopped' });
  assert.equal(f.get('administrator-pause-request-feedback').hidden, true);
  assert.match(f.get('administrator-pause-feedback').textContent, /was not running.*not the current connection status/i);
});

test('invalid latest storage remains visible without hiding an inspected historical receipt', async () => {
  const f = await fixture();
  await f.read({ operationId, state: 'stopped' });
  await f.input(otherId);
  await f.read({ operationId: otherId, state: 'stopped' });
  await f.save({ ...record(), extra: true });
  assert.match(f.get('administrator-pause-request-feedback').textContent, /could not read.*pause record/i);
  assert.match(f.get('administrator-pause-feedback').textContent, /was not running.*not the current connection status/i);
  assert.equal(f.get('administrator-pause-id').value, otherId);
  assert.equal(f.get('administrator-pause').disabled, true);
});
