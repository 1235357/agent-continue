import assert from 'node:assert/strict';
import test from 'node:test';
import { bindAdministratorBrowser, ADMIN_BROWSER_HOST, ADMIN_BROWSER_RESTORE } from '../admin-browser.js';

function event() {
  const listeners = [];
  return { addListener: fn => listeners.push(fn), emit: value => listeners.map(fn => fn(value)) };
}
function fixture() {
  let permission = true;
  const removed = event(), added = event(), startup = event();
  const ports = [], nativeCalls = [], saved = {}, localWrites = [], scheduled = [];
  const timers = {
    setTimeout(callback, delay) {
      const timer = { callback, delay, cancelled: false, unref() {} };
      scheduled.push(timer); return timer;
    },
    clearTimeout(timer) { if (timer) timer.cancelled = true; },
  };
  const api = {
    runtime: {
      id: 'a'.repeat(32), getURL: file => 'chrome-extension://' + 'a'.repeat(32) + '/' + file,
      onStartup: startup, getPlatformInfo: async () => ({ os: 'win' }),
      async sendNativeMessage(...args) { nativeCalls.push(args); throw Error('no one-shot calls permitted'); },
      connectNative(host) {
        const port = { host, messages: [], onMessage: event(), onDisconnect: event(), closed: false,
          postMessage(frame) { port.messages.push(frame); },
          disconnect() { port.closed = true; port.onDisconnect.emit(); } };
        ports.push(port); return port;
      },
    },
    permissions: { contains: async () => permission, onRemoved: removed, onAdded: added },
    storage: {
      session: { get: async key => ({ [key]: saved[key] }), set: async values => Object.assign(saved, values) },
      local: { get: async key => ({ [key]: key === ADMIN_BROWSER_RESTORE }),
        set: async values => { localWrites.push(values); } },
    },
  };
  const pending = () => scheduled.filter(timer => !timer.cancelled);
  return { api, timers, ports, saved, nativeCalls, localWrites, scheduled, pending,
    start: () => Promise.all(startup.emit()),
    ack(port, changes = {}) { port.onMessage.emit({ version: 1, action: 'session', id: port.messages[0].id, outcome: 'attached', ...changes }); },
    lose(port) { port.closed = true; port.onDisconnect.emit(); },
    revoke() { permission = false; removed.emit({ permissions: ['nativeMessaging'] }); },
    grant() { permission = true; return Promise.all(added.emit({ permissions: ['nativeMessaging'] })); },
    async run(timer = pending()[0]) { assert.ok(timer, 'expected pending observer recovery'); timer.cancelled = true; await timer.callback(); },
  };
}

test('an acknowledged lost observer reattaches once without repeating startup demand or mutations', async () => {
  const f = fixture(); bindAdministratorBrowser(f.api, { timers: f.timers }); await f.start();
  const first = f.ports[0]; assert.equal(first.messages[0].wake, true);
  const saved = structuredClone(f.saved);
  f.ack(first); f.lose(first); f.lose(first);
  assert.equal(f.pending().length, 1); assert.equal(f.pending()[0].delay, 1000);
  await f.run();
  assert.equal(f.ports.length, 2);
  const next = f.ports[1];
  assert.equal(next.host, ADMIN_BROWSER_HOST);
  assert.deepEqual(next.messages, [{ version: 1, action: 'session', id: next.messages[0].id, wake: false }]);
  assert.notEqual(next.messages[0].id, first.messages[0].id);
  f.ack(first); assert.equal(next.closed, false, 'late old ACK cannot close replacement');
  f.ack(next); await f.start();
  assert.deepEqual(f.saved, saved); assert.deepEqual(f.nativeCalls, []); assert.deepEqual(f.localWrites, []);
});

test('acknowledgements cannot replenish the three replacement observer attempts', async () => {
  const f = fixture(); bindAdministratorBrowser(f.api, { timers: f.timers }); await f.start();
  for (const delay of [1000, 5000, 15000]) {
    const port = f.ports.at(-1); f.ack(port); f.lose(port);
    assert.equal(f.pending().length, 1); assert.equal(f.pending()[0].delay, delay); await f.run();
    assert.equal(f.ports.at(-1).messages[0].wake, false);
  }
  f.ack(f.ports.at(-1)); f.lose(f.ports.at(-1));
  assert.equal(f.pending().length, 0); assert.equal(f.ports.length, 4);
  assert.deepEqual(f.nativeCalls, []); assert.deepEqual(f.localWrites, []);
});

test('unacknowledged initial loss and malformed or unconfirmed ACKs never schedule recovery', async () => {
  for (const changes of [null, { outcome: 'unconfirmed' }, { id: 'wrong' }, { extra: true }]) {
    const f = fixture(); bindAdministratorBrowser(f.api, { timers: f.timers }); await f.start();
    if (changes) f.ack(f.ports[0], changes);
    f.lose(f.ports[0]); await f.start();
    assert.equal(f.pending().length, 0); assert.equal(f.ports.length, 1); assert.deepEqual(f.nativeCalls, []);
  }
});

test('permission removal cancels recovery even if the cancelled callback runs and permission returns', async () => {
  const f = fixture(); bindAdministratorBrowser(f.api, { timers: f.timers }); await f.start();
  f.ack(f.ports[0]); f.lose(f.ports[0]);
  const timer = f.pending()[0]; assert.ok(timer);
  f.revoke(); await f.grant(); await f.run(timer);
  assert.equal(f.ports.length, 1); assert.equal(f.pending().length, 0); assert.deepEqual(f.nativeCalls, []);
});

test('permission removed while reattachment is awaiting permission cannot create a replacement', async () => {
  const f = fixture(); bindAdministratorBrowser(f.api, { timers: f.timers }); await f.start();
  f.ack(f.ports[0]); f.lose(f.ports[0]);
  const permission = Promise.withResolvers(), checked = Promise.withResolvers();
  f.api.permissions.contains = () => { checked.resolve(); return permission.promise; };
  const run = f.run(); await checked.promise;
  f.revoke(); permission.resolve(true); await run;
  assert.equal(f.ports.length, 1); assert.equal(f.pending().length, 0); assert.deepEqual(f.nativeCalls, []);
});

test('replacement connection failures consume the finite budget without any wake or control request', async () => {
  const f = fixture(); bindAdministratorBrowser(f.api, { timers: f.timers }); await f.start();
  f.ack(f.ports[0]); f.lose(f.ports[0]);
  let attempts = 0;
  f.api.runtime.connectNative = () => { attempts++; throw Error('transient observer unavailable'); };
  for (const delay of [1000, 5000, 15000]) { assert.equal(f.pending()[0]?.delay, delay); await f.run(); }
  assert.equal(attempts, 3); assert.equal(f.pending().length, 0); assert.deepEqual(f.nativeCalls, []);
});

test('malformed replacement ACK stops recovery without interpreting it as Ready', async () => {
  const f = fixture(); bindAdministratorBrowser(f.api, { timers: f.timers }); await f.start();
  f.ack(f.ports[0]); f.lose(f.ports[0]); await f.run();
  f.ack(f.ports[1], { outcome: 'ready' }); f.lose(f.ports[1]);
  assert.equal(f.ports[1].closed, true); assert.equal(f.pending().length, 0); assert.deepEqual(f.nativeCalls, []);
});

test('a failed replacement post closes its port and consumes the same finite observer budget', async () => {
  const f = fixture(); bindAdministratorBrowser(f.api, { timers: f.timers }); await f.start();
  f.ack(f.ports[0]); f.lose(f.ports[0]);
  const connect = f.api.runtime.connectNative;
  f.api.runtime.connectNative = host => {
    const port = connect(host);
    port.postMessage = frame => { port.messages.push(frame); throw Error('lost post'); };
    return port;
  };
  for (const delay of [1000, 5000, 15000]) { assert.equal(f.pending()[0]?.delay, delay); await f.run(); }
  assert.equal(f.ports.length, 4); assert.equal(f.pending().length, 0);
  for (const port of f.ports.slice(1)) { assert.equal(port.closed, true); assert.equal(port.messages[0].wake, false); }
  assert.deepEqual(f.nativeCalls, []); assert.deepEqual(f.localWrites, []);
});

test('permission denial or an unreadable permission stops the observer instead of polling', async () => {
  for (const denied of [false, Error('permission unknown')]) {
    const f = fixture(); bindAdministratorBrowser(f.api, { timers: f.timers }); await f.start();
    f.ack(f.ports[0]); f.lose(f.ports[0]);
    f.api.permissions.contains = async () => { if (denied instanceof Error) throw denied; return denied; };
    await f.run(); await f.start();
    assert.equal(f.ports.length, 1); assert.equal(f.pending().length, 0); assert.deepEqual(f.nativeCalls, []);
  }
});

test('replacement loss before its ACK may use the remaining budget without another wake', async () => {
  const f = fixture(); bindAdministratorBrowser(f.api, { timers: f.timers }); await f.start();
  const first = f.ports[0]; f.ack(first); f.lose(first); await f.run();
  f.lose(f.ports[1]); assert.equal(f.pending().length, 1);
  f.lose(first); f.ack(first, { outcome: 'unconfirmed' });
  assert.equal(f.pending().length, 1); await f.run();
  assert.equal(f.ports.length, 3); assert.equal(f.ports[2].messages[0].wake, false);
  assert.deepEqual(f.nativeCalls, []);
});

test('revoking an active replacement closes it synchronously and cannot be undone by a grant', async () => {
  const f = fixture(); bindAdministratorBrowser(f.api, { timers: f.timers }); await f.start();
  f.ack(f.ports[0]); f.lose(f.ports[0]); await f.run();
  const next = f.ports[1]; f.ack(next); f.revoke();
  assert.equal(next.closed, true); await f.grant(); await f.start();
  f.lose(next); assert.equal(f.pending().length, 0); assert.equal(f.ports.length, 2);
  assert.deepEqual(f.nativeCalls, []); assert.deepEqual(f.localWrites, []);
});

test('permission removal while platform detection is pending cannot open a replacement', async () => {
  const f = fixture(); bindAdministratorBrowser(f.api, { timers: f.timers }); await f.start();
  f.ack(f.ports[0]); f.lose(f.ports[0]);
  const platform = Promise.withResolvers(), checked = Promise.withResolvers();
  f.api.runtime.getPlatformInfo = () => { checked.resolve(); return platform.promise; };
  const run = f.run(); await checked.promise;
  f.revoke(); platform.resolve({ os: 'win' }); await run;
  assert.equal(f.ports.length, 1); assert.equal(f.pending().length, 0); assert.deepEqual(f.nativeCalls, []);
});
