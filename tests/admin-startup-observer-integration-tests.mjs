import assert from 'node:assert/strict';
import test from 'node:test';
import { ADMIN_BROWSER_HOST, ADMIN_BROWSER_MESSAGE, ADMIN_BROWSER_PAUSE, ADMIN_BROWSER_RESTORE,
  bindAdministratorBrowser } from '../admin-browser.js';
import { ADMIN_CONTROL, ADMIN_CONTROL_ALARM, ADMIN_CONTROL_JOURNAL, ADMIN_CONTROL_STATUS,
  ADMIN_CONTROL_SUPPORT, bindAdministratorControls } from '../admin-control.js';

const extensionId = 'd'.repeat(32), origin = `chrome-extension://${extensionId}/`;
const sender = { id: extensionId, frameId: 0, url: origin + 'devices.html?mode=browser-managed' };
const digest = 'a'.repeat(64), target = 'c'.repeat(32) + ':idle', now = 700000;
const clone = value => structuredClone(value);
const turn = () => new Promise(resolve => setImmediate(resolve));
const identity = value => ({ bundleSha256: value.bundleSha256, operationId: value.operationId,
  control: value.control });
const startupMessage = control => ({ type: ADMIN_CONTROL, control, bundleSha256: digest, target });

function event() {
  const listeners = [];
  return { addListener: fn => listeners.push(fn), emit: value => listeners.map(fn => fn(value)) };
}

function fixture(t, initial = {}) {
  let installed = false, granted = true;
  const local = { [ADMIN_BROWSER_RESTORE]: true, ...clone(initial) }, saved = {};
  const ports = [], calls = [], writes = [], scheduled = [];
  const startup = event(), added = event(), removed = event(), alarm = event();
  const timers = {
    setTimeout(callback, delay) {
      const timer = { callback, delay, cancelled: false, unref() {} };
      scheduled.push(timer);
      return timer;
    },
    clearTimeout(timer) { if (timer) timer.cancelled = true; },
  };
  const api = {
    runtime: {
      id: extensionId, getURL: path => origin + path,
      getPlatformInfo: async () => ({ os: 'win' }), onStartup: startup,
      connectNative(host) {
        const port = { host, messages: [], closed: false, onMessage: event(), onDisconnect: event(),
          postMessage(frame) { port.messages.push(clone(frame)); },
          disconnect() { port.closed = true; port.onDisconnect.emit(); } };
        ports.push(port);
        // Chrome reports a missing host by disconnecting the returned port, not an ACK.
        if (!installed) queueMicrotask(() => {
          api.runtime.lastError = { message: 'Specified native messaging host not found.' };
          try { port.disconnect(); } finally { delete api.runtime.lastError; }
        });
        return port;
      },
      async sendNativeMessage(host, request) {
        calls.push({ host, ...clone(request), journal: clone(local[ADMIN_CONTROL_JOURNAL]) });
        if (!installed) throw Error('mock host not installed');
        const envelope = { version: 1, action: request.action, id: request.id };
        switch (request.action) {
          case 'control-support':
            return { ...envelope, control: request.control, state: 'supported', bundleSha256: digest,
              target, ownerState: request.control === 'resume-saved' ? 'running' : 'paused', eligible: true };
          case 'control':
            return { ...envelope, ...identity(request), outcome: 'requested' };
          case 'control-status':
            return { ...envelope, ...identity(request), state: 'reserved', progress: null };
          case 'status':
            return { ...envelope, state: 'unobserved', generation: null };
          case 'pause-support':
            return { ...envelope, state: 'supported', target };
          case 'pause':
            return { ...envelope, operationId: request.operationId, state: 'requested' };
          default:
            throw Error('unexpected mock native action: ' + request.action);
        }
      },
    },
    permissions: { contains: async () => granted, onAdded: added, onRemoved: removed },
    storage: {
      session: {
        get: async key => ({ [key]: clone(saved[key]) }),
        set: async values => { Object.assign(saved, clone(values)); },
      },
      local: {
        get: async key => Object.fromEntries((Array.isArray(key) ? key : [key]).map(k => [k, clone(local[k])])),
        set: async values => { writes.push(clone(values)); Object.assign(local, clone(values)); },
        remove: async key => { delete local[key]; },
      },
    },
    alarms: { onAlarm: alarm, clear: async () => true, create: async () => undefined },
  };
  // Match background.js: use both real binders, including the real attachment promise.
  const controls = bindAdministratorControls(api, { now: () => now, timers,
    prepareObserver: admit => browser.prepareSetupObserver(admit) });
  const browser = bindAdministratorBrowser(api, { timers,
    onPauseIntent: () => controls.cancelPendingStartup() });
  assert.ok(controls);
  assert.ok(browser);
  t.after(() => {
    controls.dispose();
    removed.emit({ permissions: ['nativeMessaging'] });
    for (const timer of scheduled) timers.clearTimeout(timer);
  });
  return { local, saved, ports, calls, writes, scheduled, alarm,
    install() { installed = true; },
    async start() { await Promise.all(startup.emit()); await turn(); },
    send: message => controls.handleMessage(message, sender),
    browserSend: message => browser.handleMessage(message, sender),
    removePermission() { granted = false; removed.emit({ permissions: ['nativeMessaging'] }); },
    async grantPermission() { granted = true; await Promise.all(added.emit({ permissions: ['nativeMessaging'] })); await turn(); },
    ack(port, changes = {}) {
      port.onMessage.emit({ version: 1, action: 'session', id: port.messages[0].id,
        outcome: 'attached', ...changes });
    },
  };
}

function startupCalls(f) {
  return f.calls.filter(call => call.action === 'control' && call.control !== 'revoke');
}

function startupReservations(f) {
  return f.writes.flatMap(write => write[ADMIN_CONTROL_JOURNAL]?.operations ?? [])
    .filter(record => record.control !== 'revoke' && record.outcome === 'unconfirmed');
}

async function failedWorkerStartup(f) {
  await f.start();
  assert.equal(f.ports.length, 1);
  assert.equal(f.ports[0].closed, true);
  assert.deepEqual(f.ports[0].messages, [{ version: 1, action: 'session',
    id: f.ports[0].messages[0].id, wake: true }]);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.writes, []);
  assert.equal(f.scheduled.some(timer => !timer.cancelled), false);
}

async function awaitingObserver(f, control) {
  await failedWorkerStartup(f);
  f.install();
  const pending = f.send(startupMessage(control));
  let settled = false;
  void pending.then(() => { settled = true; });
  await turn();
  assert.equal(f.ports.length, 2);
  const port = f.ports[1];
  assert.equal(port.host, ADMIN_BROWSER_HOST);
  assert.deepEqual(port.messages, [{ version: 1, action: 'session', id: port.messages[0].id, wake: false }]);
  assert.notEqual(port.messages[0].id, f.ports[0].messages[0].id);
  assert.deepEqual(f.calls.map(call => call.action), ['control-support']);
  assert.deepEqual(f.writes, []);
  assert.equal(settled, false, 'startup must remain pending until an exact attachment ACK');
  return { pending, port };
}

for (const control of ['connect', 'resume-saved']) {
  test(`explicit ${control} after missing-host startup reserves and dispatches once, only after attachment ACK`,
    { timeout: 3000 }, async t => {
      const f = fixture(t), { pending, port } = await awaitingObserver(f, control);
      f.ack(f.ports[0]);
      await turn();
      assert.deepEqual(startupCalls(f), [], 'a stale startup-port ACK cannot admit the new observer');
      assert.deepEqual(f.writes, []);

      f.ack(port);
      const result = await pending;
      assert.equal(result?.control, control);
      assert.equal(result.outcome, 'requested');
      assert.match(result.operationId, /^[a-f0-9]{32}$/);
      assert.equal(startupReservations(f).length, 1);
      assert.equal(startupCalls(f).length, 1);
      const call = startupCalls(f)[0];
      assert.equal(call.host, ADMIN_BROWSER_HOST);
      assert.deepEqual(identity(call), identity(result));
      assert.equal(call.target, target);
      assert.deepEqual(call.journal, { version: 1, operations: [{ ...result, outcome: 'unconfirmed' }] });

      await f.start();
      const receipt = await f.send({ type: ADMIN_CONTROL_STATUS, ...identity(result) });
      assert.equal(receipt?.state, 'reserved');
      assert.equal(f.ports.length, 2);
      assert.equal(startupCalls(f).length, 1, 'worker startup and receipt readback cannot replay control');
      assert.equal(startupReservations(f).length, 1);
      assert.equal(f.local[ADMIN_CONTROL_JOURNAL].operations.length, 1);
    });

  for (const stop of ['pause', 'revoke', 'permission']) {
    test(`${stop} before ${control} attachment ACK prevents startup reservation and control`,
      { timeout: 3000 }, async t => {
        const f = fixture(t), { pending, port } = await awaitingObserver(f, control);
        if (stop === 'pause') {
          const paused = await f.browserSend({ type: ADMIN_BROWSER_PAUSE });
          assert.equal(paused?.outcome, 'requested');
          assert.equal(f.calls.filter(call => call.action === 'pause').length, 1);
        } else if (stop === 'revoke') {
          const revoked = await f.send({ type: ADMIN_CONTROL, control: 'revoke', bundleSha256: digest });
          assert.equal(revoked?.control, 'revoke');
          assert.equal(revoked.outcome, 'requested');
          assert.equal(f.calls.filter(call => call.action === 'control' && call.control === 'revoke').length, 1);
        } else {
          f.removePermission();
          assert.equal(port.closed, true);
          await f.grantPermission();
        }
        f.ack(port);
        assert.equal(await pending, null);
        await f.start();
        assert.deepEqual(startupCalls(f), []);
        assert.deepEqual(startupReservations(f), []);
        assert.ok((f.local[ADMIN_CONTROL_JOURNAL]?.operations ?? []).every(record => record.control === 'revoke'));
        assert.equal(f.ports.length, 2);
      });
  }
}

test('malformed or unrelated attachment ACKs fail closed without reserving or dispatching',
  { timeout: 3000 }, async t => {
    for (const changes of [{ id: 'wrong' }, { version: 2 }, { action: 'status' },
      { outcome: 'ready' }, { outcome: undefined }, { extra: true }]) {
      const f = fixture(t), { pending, port } = await awaitingObserver(f, 'connect');
      f.ack(port, changes);
      assert.equal(await pending, null, JSON.stringify(changes));
      assert.equal(port.closed, true);
      f.ack(port);
      await f.start();
      assert.deepEqual(startupCalls(f), []);
      assert.deepEqual(f.writes, []);
      assert.equal(f.ports.length, 2);
      assert.equal(f.scheduled.some(timer => !timer.cancelled), false);
    }
  });

test('an absent attachment ACK reaches the bounded deadline and a later ACK cannot dispatch',
  { timeout: 3000 }, async t => {
    const f = fixture(t), { pending, port } = await awaitingObserver(f, 'connect');
    const deadlines = f.scheduled.filter(timer => !timer.cancelled);
    assert.equal(deadlines.length, 1);
    assert.equal(deadlines[0].delay, 9000);
    deadlines[0].callback();
    assert.equal(await pending, null);
    f.ack(port);
    await f.start();
    assert.deepEqual(startupCalls(f), []);
    assert.deepEqual(f.writes, []);
    assert.equal(f.ports.length, 2);
    assert.equal(f.scheduled.some(timer => !timer.cancelled), false);
  });

test('worker startup, support/status readback, alarm and polling never reconnect or replay a saved control',
  { timeout: 3000 }, async t => {
    const previous = { bundleSha256: digest, operationId: 'b'.repeat(32), control: 'resume-saved', target,
      outcome: 'unconfirmed', state: 'unconfirmed', progress: null, createdAt: now - 1000 };
    const f = fixture(t, { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [previous] } });
    await f.start();
    assert.equal(f.ports.length, 1);
    assert.equal(f.ports[0].closed, true);
    assert.ok(f.calls.some(call => call.action === 'control-status'), 'startup observes the saved receipt');
    assert.deepEqual(f.writes, []);

    f.install();
    await f.start();
    const support = await f.send({ type: ADMIN_CONTROL_SUPPORT, control: 'resume-saved' });
    assert.equal(support?.eligible, true);
    assert.deepEqual(await f.browserSend({ type: ADMIN_BROWSER_MESSAGE }), { state: 'unobserved', generation: null });
    assert.equal((await f.send({ type: ADMIN_CONTROL_STATUS, ...identity(previous) }))?.state, 'reserved');
    f.alarm.emit({ name: ADMIN_CONTROL_ALARM });
    await turn();
    const poll = f.scheduled.find(timer => !timer.cancelled && timer.delay === 2000);
    assert.ok(poll, 'automatic receipt observation has a bounded polling timer');
    poll.cancelled = true;
    poll.callback();
    await turn();

    assert.ok(f.calls.every(call => ['control-status', 'control-support', 'status'].includes(call.action)));
    assert.equal(f.ports.length, 1, 'readbacks and worker startup must not prepare another observer');
    assert.deepEqual(startupCalls(f), []);
    assert.deepEqual(f.local[ADMIN_CONTROL_JOURNAL], { version: 1, operations: [{ ...previous, state: 'reserved' }] });
    assert.ok(f.writes.every(write => Object.keys(write).length === 1 &&
      write[ADMIN_CONTROL_JOURNAL]?.operations.length === 1 &&
      write[ADMIN_CONTROL_JOURNAL].operations[0].operationId === previous.operationId));
    assert.equal(f.local[ADMIN_BROWSER_RESTORE], true);
  });
