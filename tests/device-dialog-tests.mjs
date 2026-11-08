import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import { BROWSER_WAKE_HOST, validPreparedReference } from '../browser-wake.js';
import { ADMIN_BROWSER_MESSAGE, ADMIN_BROWSER_RESTORE, adminBrowserObservation } from '../admin-browser.js';
import { deviceScope, HOST, PENDING_KEY, PRIORITY_PAUSE_KEY, REVISION_KEY } from '../device-control.js';

const source = await fs.readFile(new URL('../devices.js', import.meta.url), 'utf8');
const executable = source.replace(/^import .*;\r?\n/gm, '');

async function fixture({ browserManaged = false, controlPrepared } = {}) {
  const queued = [], calls = [], elements = new Map();
  class Element {
    constructor(id, action) {
      this.id = id;
      this.dataset = action ? { action } : {};
      this.handlers = new Map();
      this.open = false;
      this.checked = false;
      this.value = '';
    }
    addEventListener(name, handler) {
      const handlers = this.handlers.get(name) || [];
      handlers.push(handler);
      this.handlers.set(name, handlers);
    }
    dispatch(name) {
      for (const handler of this.handlers.get(name) || []) handler({ target: this, preventDefault() {} });
    }
    close() {
      if (!this.open) return;
      this.open = false;
      queued.push(() => this.dispatch('close'));
    }
    showModal() { this.open = true; }
    setAttribute() {}
  }
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  };
  const actions = ['status', 'disconnect-and-pause', 'reconnect'].map(action => new Element(action, action));
  const state = {
    initialized: true, permission: 'granted', registration: 'reachable',
    observation: { paused: false, connection: 'unknown', ownerId: 'owner-a' }, observedAt: null,
    pending: null, journalHealthy: true, statusBusy: false, mutationBusy: false,
    requestingPermission: false, feedback: 'observed', canMutate: true,
  };
  const context = vm.createContext({
    URL, location: { href: 'chrome-extension://jpioilmpbolfokedaefmbfbjeaahfdkl/devices.html' +
      (browserManaged ? '?mode=browser-managed' : '') },
    document: {
      getElementById: get,
      querySelectorAll: selector => selector === '[data-action]' ? actions : [],
      documentElement: { lang: 'en' },
    },
    navigator: { locks: { request() {} } },
    createTranslator: () => key => key,
    initializeLanguage: async () => {},
    subscribeLanguage() {}, setLanguage: async () => {}, getLanguage: () => 'en',
    deviceScope, HOST, PENDING_KEY, PRIORITY_PAUSE_KEY, REVISION_KEY, BROWSER_WAKE_HOST, validPreparedReference, controlPrepared,
    ADMIN_BROWSER_MESSAGE, ADMIN_BROWSER_RESTORE, adminBrowserObservation,
    createDeviceController: ({ onChange }) => ({
      getState: () => structuredClone(state),
      initialize: async () => onChange(),
      run: async action => { calls.push(action); },
      requestPermission: async () => {}, refreshPending: async () => {},
    }),
    chrome: {
      runtime: { id: 'jpioilmpbolfokedaefmbfbjeaahfdkl' },
      storage: { local: {}, onChanged: { addListener() {} } }, permissions: {},
    },
  });
  await vm.runInContext(`(async () => {\n${executable}\n})()`, context);
  return {
    calls, dialog: get('operationDialog'), get,
    click: id => get(id).dispatch('click'),
    action: action => actions.find(element => element.dataset.action === action).dispatch('click'),
    escape: () => { get('operationDialog').dispatch('cancel'); get('operationDialog').close(); },
    setCanMutate: value => { state.canMutate = value; },
    setOwner: ownerId => { state.observation.ownerId = ownerId; },
    deliverClose: () => { assert.ok(queued.length, 'a native close task is queued'); queued.shift()(); },
  };
}

test('prepared revocation is explicitly confirmed, is tied to the checked reference and does not retry', async () => {
  const messages = [];
  const f = await fixture({ browserManaged: true, async controlPrepared(_runtime, ...values) {
    messages.push(values);
    return values[0] === 'prepared-review' ? { status: 'staged', expiresAt: Date.now() + 60000 } : null;
  } });
  const id = 'ae900800-b673-4eee-abe5-e7267e0d46b1', digest = 'b'.repeat(64);
  const update = (key, value) => { f.get(key).value = value; f.get(key).dispatch('input'); };
  const check = async () => { f.get('prepared-form').dispatch('submit'); await tick(); };
  assert.equal(f.get('prepared-controls').hidden, false);
  update('prepared-id', id);
  update('prepared-digest', digest);
  assert.equal(f.get('prepared-revoke').disabled, true);
  await check();
  assert.equal(f.get('prepared-revoke').disabled, false);
  f.click('prepared-revoke');
  assert.equal(f.get('prepared-dialog').open, true);
  assert.match(f.get('prepared-reference').textContent, new RegExp(digest));
  update('prepared-digest', 'a'.repeat(64));
  assert.equal(f.get('prepared-dialog').open, false);
  f.click('prepared-confirm');
  assert.equal(messages.length, 1);
  update('prepared-digest', digest);
  await check();
  f.click('prepared-revoke');
  f.setOwner('owner-b');
  f.click('prepared-confirm');
  assert.equal(messages.length, 2, 'stale owner never sends revoke');
  await check();
  f.click('prepared-revoke');
  f.click('prepared-confirm');
  f.click('prepared-confirm');
  await tick();
  assert.deepEqual(messages.at(-1), ['prepared-revoke', 'owner-b', id, digest]);
  assert.equal(messages.filter(([action]) => action === 'prepared-revoke').length, 1);
  assert.equal(f.get('prepared-revoke').disabled, true);
  assert.match(f.get('prepared-feedback').textContent, /未自动重试/);
  assert.deepEqual(f.calls, []);
});

for (const cancel of ['button', 'escape']) {
  for (const next of ['disconnect-and-pause', 'reconnect']) {
    test(`queued ${cancel} close cannot erase the newly reviewed ${next} action`, async () => {
      const f = await fixture();
      f.action(next === 'reconnect' ? 'disconnect-and-pause' : 'reconnect');
      if (cancel === 'button') f.click('cancelOperation'); else f.escape();
      assert.equal(f.dialog.open, false);
      f.action(next);
      assert.equal(f.dialog.open, true);
      f.deliverClose();
      assert.equal(f.dialog.open, true, 'an older close task does not close the new dialog');
      assert.deepEqual(f.calls, [], 'neither cancellation nor reopening sends a command');
      f.click('confirmOperation');
      assert.deepEqual(f.calls, [next], 'confirmation sends the currently reviewed action once');
      f.click('confirmOperation');
      assert.deepEqual(f.calls, [next], 'a second click cannot reuse consumed consent');
    });
  }
}

test('cancel without a new review never sends a device action', async () => {
  const f = await fixture();
  f.action('reconnect');
  f.click('cancelOperation');
  f.deliverClose();
  f.click('confirmOperation');
  assert.deepEqual(f.calls, []);
});

test('delivered close tasks cannot reuse a previously confirmed action', async () => {
  const f = await fixture();
  f.action('disconnect-and-pause');
  f.click('confirmOperation');
  f.deliverClose();
  f.click('confirmOperation');
  assert.deepEqual(f.calls, ['disconnect-and-pause']);
});

for (const cancel of ['button', 'escape']) {
  test(`${cancel} revokes consent before the queued close task is delivered`, async () => {
    const f = await fixture();
    f.action('reconnect');
    if (cancel === 'button') f.click('cancelOperation'); else f.escape();
    assert.equal(f.dialog.open, false);
    f.click('confirmOperation');
    assert.deepEqual(f.calls, [], 'a hidden confirmation cannot reuse cancelled consent');
    f.deliverClose();
  });
}

for (const next of ['disconnect-and-pause', 'reconnect']) {
  test(`a confirmed review's queued close cannot consume the next ${next} review`, async () => {
    const f = await fixture();
    const first = next === 'reconnect' ? 'disconnect-and-pause' : 'reconnect';
    f.action(first);
    f.click('confirmOperation');
    f.action(next);
    f.deliverClose();
    assert.equal(f.dialog.open, true);
    f.click('confirmOperation');
    assert.deepEqual(f.calls, [first, next]);
  });
}

test('confirmation rechecks current UI eligibility rather than calling the controller blindly', async () => {
  const f = await fixture();
  f.action('reconnect');
  f.setCanMutate(false);
  f.click('confirmOperation');
  assert.equal(f.dialog.open, false);
  assert.deepEqual(f.calls, [], 'a consent dialog is not continuing authorization');
});
