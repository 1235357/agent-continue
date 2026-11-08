import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { setImmediate as tick } from 'node:timers/promises';
import { bindBrowserWake, BROWSER_WAKE_HOST, BROWSER_DEVICE_PAGE, BROWSER_DEVICE_MESSAGE } from '../browser-wake.js';
import { createPreparedControl, serveBrowserWake } from '../native/desktop-commander/device-native-host.mjs';
import { readFrame, writeFrame } from '../native/desktop-commander/device-owner.mjs';
import * as prepared from '../native/desktop-commander/prepared-process.mjs';
import { createOperationReceipts } from '../native/desktop-commander/operation-receipts.mjs';

const event = () => {
  const listeners = new Set();
  return { addListener: fn => listeners.add(fn), reset: () => listeners.clear(), emit: (...args) => {
    for (const fn of listeners) fn(...args);
  } };
};
const request = { version: 1, action: 'wake', id: 'fixture-1' };
const origin = 'chrome-extension://' + 'a'.repeat(32) + '/';

function extension({ granted = true, os = 'win' } = {}) {
  const attempts = [], messages = [], stored = {}, results = [];
  const startup = event(), removed = event(), added = event(), alarmEvent = event();
  const alarms = new Map(), ports = [];
  let disconnected = 0;
  const api = {
    runtime: { id: 'a'.repeat(32), getURL: page => origin + page, onStartup: startup, getPlatformInfo: async () => ({ os }),
      connectNative(host) {
        const port = { onMessage: event(), onDisconnect: event(),
          disconnect() { disconnected++; this.onDisconnect.emit(); },
          postMessage(message) { messages.push(message); } };
        attempts.push(host); ports.push(port); return port;
      } },
    storage: { session: { async get(key) { return { [key]: stored[key] }; },
      async set(values) { Object.assign(stored, values); },
      async remove(key) { delete stored[key]; } } },
    alarms: { onAlarm: alarmEvent, async create(name, options) { alarms.set(name, options); },
      async clear(name) { return alarms.delete(name); } },
    permissions: { contains: async () => granted, onRemoved: removed, onAdded: added },
  };
  return { api, attempts, messages, results, get native() { return ports.at(-1); }, ports, alarms, startup, removed, added,
    alarm(name) { alarms.delete(name); alarmEvent.emit({ name }); },
    rebind() { alarmEvent.reset(); startup.reset(); removed.reset(); added.reset(); return bindBrowserWake(api); },
    setGrant(value) { granted = value; }, get disconnected() { return disconnected; } };
}

const devicesSender = f => ({ id: f.api.runtime.id, url: origin + BROWSER_DEVICE_PAGE, frameId: 0 });
const statusMessage = (id = 'install-status') => ({ type: BROWSER_DEVICE_MESSAGE, ownerId: null,
  request: { version: 1, id, action: 'status' } });

test('explicit Devices status reattaches after the startup bridge was absent, without reloading', async () => {
  const f = extension(), wake = bindBrowserWake(f.api);
  await tick();
  f.native.onDisconnect.emit();
  f.startup.emit();
  await tick();
  assert.equal(f.attempts.length, 1);
  assert.equal(f.alarms.size, 0);
  const message = statusMessage(), status = wake.handleMessage(message, devicesSender(f));
  await tick();
  assert.equal(f.attempts.length, 2, 'an explicit status may reacquire the newly installed bridge');
  assert.equal(f.messages.at(-1).action, 'wake');
  const handshake = f.messages.at(-1);
  assert.notEqual(handshake.id, f.messages[0].id);
  f.native.onMessage.emit({ ...handshake, ok: true });
  await tick();
  assert.deepEqual(f.messages.at(-1), message.request);
  const response = { ...message.request, ok: true, state: { paused: true, connection: 'disconnected' } };
  f.native.onMessage.emit(response);
  assert.deepEqual(await status, { ownerId: handshake.id, response });
  f.setGrant(false); f.removed.emit({ permissions: ['nativeMessaging'] });
  await tick();
});

test('status arriving before the initial wake acknowledgement waits on the same owner', async () => {
  const f = extension(), wake = bindBrowserWake(f.api);
  await tick();
  const handshake = f.messages[0], message = statusMessage();
  const status = wake.handleMessage(message, devicesSender(f));
  await tick();
  assert.equal(f.attempts.length, 1);
  assert.deepEqual(f.messages, [handshake]);
  const mutation = { ...message, ownerId: handshake.id,
    request: { version: 1, id: 'too-early', action: 'reconnect' } };
  assert.equal(await wake.handleMessage(mutation, devicesSender(f)), null);
  f.native.onMessage.emit({ ...handshake, ok: true });
  await tick();
  assert.deepEqual(f.messages.at(-1), message.request);
  const response = { ...message.request, ok: true, state: { paused: true, connection: 'disconnected' } };
  f.native.onMessage.emit(response);
  assert.deepEqual(await status, { ownerId: handshake.id, response });
});

test('a failed explicit handshake cannot create an implicit reconnect loop, including worker restart', async () => {
  const f = extension(), wake = bindBrowserWake(f.api);
  await tick(); f.native.onDisconnect.emit(); await tick();
  const status = wake.handleMessage(statusMessage(), devicesSender(f));
  await tick(); f.native.onDisconnect.emit();
  assert.equal(await status, null);
  f.startup.emit(); f.startup.emit(); await tick();
  const nextWorker = f.rebind(); await tick();
  assert.equal(f.attempts.length, 2);
  assert.equal(f.alarms.size, 0);
  const next = nextWorker.handleMessage(statusMessage('try-after-install'), devicesSender(f));
  await tick();
  assert.equal(f.attempts.length, 3, 'a later explicit request is allowed after confirmed host absence');
  f.native.onDisconnect.emit();
  assert.equal(await next, null);
});

test('explicit reattachment rejects unauthorized sources, malformed requests, and missing consent', async () => {
  const f = extension(), wake = bindBrowserWake(f.api);
  await tick(); f.native.onDisconnect.emit(); await tick();
  const message = statusMessage(), sender = devicesSender(f);
  for (const from of [{ ...sender, id: 'b'.repeat(32) }, { ...sender, url: 'https://chatgpt.com/' },
    { ...sender, url: sender.url + '&other=1' }, { ...sender, frameId: 1 },
    { ...sender, tab: { incognito: true } }]) {
    assert.equal(await wake.handleMessage(message, from), null);
  }
  for (const invalid of [{ ...message, ownerId: 'stale-owner' }, { ...message, extra: true },
    { ...message, request: { ...message.request, extra: true } },
    ...['reconnect', 'disconnect-and-pause'].map(action => ({ ...message, request: { ...message.request, action } }))]) {
    assert.equal(await wake.handleMessage(invalid, sender), null);
  }
  f.setGrant(false);
  assert.equal(await wake.handleMessage(message, sender), null);
  f.setGrant(true); f.api.runtime.getPlatformInfo = async () => ({ os: 'linux' });
  assert.equal(await wake.handleMessage(message, sender), null);
  assert.equal(f.attempts.length, 1);
  assert.equal(f.alarms.size, 0);
});

test('explicit status has one handshake deadline and concurrent requests cannot create duplicate owners', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = extension(), wake = bindBrowserWake(f.api);
  await tick(); f.native.onDisconnect.emit(); await tick();
  const status = wake.handleMessage(statusMessage(), devicesSender(f));
  const duplicate = wake.handleMessage(statusMessage('duplicate-status'), devicesSender(f));
  await tick();
  assert.equal(f.attempts.length, 2);
  assert.equal(await duplicate, null);
  t.mock.timers.tick(14500);
  assert.equal(await status, null, 'status must finish within the existing UI deadline');
  const handshake = f.messages.at(-1);
  f.native.onMessage.emit({ ...handshake, ok: true });
  await tick();
  assert.equal(f.messages.at(-1).action, 'wake', 'a timed-out status is not sent later');
  f.native.onDisconnect.emit(); await tick();
});

test('a worker restart does not reattach around a possibly still-owned native port', async () => {
  const f = extension(); bindBrowserWake(f.api);
  await tick();
  f.native.onMessage.emit({ ...f.messages[0], ok: true });
  const nextWorker = f.rebind(); await tick();
  assert.equal(await nextWorker.handleMessage(statusMessage(), devicesSender(f)), null);
  assert.equal(f.attempts.length, 1, 'absence of worker memory is not proof that the owner closed');
  f.setGrant(false); f.removed.emit({ permissions: ['nativeMessaging'] });
});

test('lost mutation replies block status reattachment and permission grants across worker restart', async () => {
  for (const action of ['reconnect', 'disconnect-and-pause', 'prepared-revoke']) {
    const f = extension(), wake = bindBrowserWake(f.api);
    await tick();
    const handshake = f.messages[0];
    f.native.onMessage.emit({ ...handshake, ok: true });
    const request = { version: 1, id: 'lost-mutation', action,
      ...(action === 'prepared-revoke' ? { operationId: 'ae900800-b673-4eee-abe5-e7267e0d46b1', sha256: 'a'.repeat(64) } : {}) };
    const mutation = wake.handleMessage({ type: BROWSER_DEVICE_MESSAGE, ownerId: handshake.id, request }, devicesSender(f));
    await tick();
    assert.deepEqual(f.messages.at(-1), request);
    f.native.onDisconnect.emit();
    assert.equal(await mutation, null);
    assert.equal(await wake.handleMessage(statusMessage(), devicesSender(f)), null);
    const nextWorker = f.rebind(); await tick();
    f.removed.emit({ permissions: ['nativeMessaging'] }); await tick();
    f.added.emit({ permissions: ['nativeMessaging'] }); f.startup.emit(); await tick();
    assert.equal(await nextWorker.handleMessage(statusMessage(), devicesSender(f)), null);
    assert.equal(f.attempts.length, 1, action);
    assert.equal(f.alarms.size, 0);
    assert.equal(f.messages.filter(message => message.action === action).length, 1, 'never replay the mutation');
  }
});

test('mutation timeout or malformed/uncertain reply never authorizes another owner', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const outcome of ['timeout', 'malformed', 'unknown-running']) {
    const f = extension(), wake = bindBrowserWake(f.api);
    await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
    const request = { version: 1, id: 'uncertain-pause', action: 'disconnect-and-pause' };
    const pending = wake.handleMessage({ type: BROWSER_DEVICE_MESSAGE, ownerId: f.messages[0].id, request }, devicesSender(f));
    await tick();
    if (outcome === 'timeout') {
      t.mock.timers.tick(14500);
      assert.equal(await pending, null);
      assert.equal(await wake.handleMessage(statusMessage(), devicesSender(f)), null, 'the mutation slot stays reserved');
    } else {
      f.native.onMessage.emit(outcome === 'malformed' ? { ...request, ok: true } :
        { ...request, ok: true, state: { paused: null, connection: 'unknown',
          operation: { id: request.id, action: request.action, status: 'unknown-running' } } });
    }
    f.native.onDisconnect.emit(); await pending; await tick();
    const nextWorker = f.rebind(); await tick();
    assert.equal(await nextWorker.handleMessage(statusMessage(), devicesSender(f)), null);
    assert.equal(f.attempts.length, 1, outcome);
    assert.equal(f.alarms.size, 0);
  }
});

test('confirmed settled mutation still permits the original once-only recovery', async () => {
  const f = extension(), wake = bindBrowserWake(f.api);
  await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
  const request = { version: 1, id: 'settled-pause', action: 'disconnect-and-pause' };
  const pending = wake.handleMessage({ type: BROWSER_DEVICE_MESSAGE, ownerId: f.messages[0].id, request }, devicesSender(f));
  await tick();
  f.native.onMessage.emit({ ...request, ok: true, state: { paused: true, connection: 'disconnected',
    operation: { id: request.id, action: request.action, status: 'settled' } } });
  assert.ok(await pending);
  f.native.onDisconnect.emit(); await tick();
  assert.equal(f.alarms.size, 1);
  const [name] = f.alarms.keys(); f.alarm(name); await tick();
  assert.equal(f.attempts.length, 2);
  assert.equal(f.messages.at(-1).action, 'wake', 'no connect or Pause is replayed');
  f.native.onDisconnect.emit(); await tick();
});

test('worker startup opens one fixed port and permission removal disconnects it', async () => {
  const f = extension();
  bindBrowserWake(f.api, { onResult: value => f.results.push(value) });
  f.startup.emit();
  await tick();
  assert.deepEqual(f.attempts, [BROWSER_WAKE_HOST]);
  assert.deepEqual(f.messages, [{ version: 1, action: 'wake', id: f.messages[0]?.id }]);
  assert.match(f.messages[0].id, /^[a-f0-9-]{36}$/);
  f.native.onMessage.emit({ ...f.messages[0], ok: true });
  assert.deepEqual(f.results, ['acknowledged']);
  f.setGrant(false);
  f.removed.emit({ permissions: ['nativeMessaging'] });
  assert.equal(f.disconnected, 1);
  f.startup.emit();
  await tick();
  assert.equal(f.attempts.length, 1);
});

test('no permission and non-Windows platforms do not open a host; an explicit grant can start it', async () => {
  const no = extension({ granted: false }), linux = extension({ os: 'linux' });
  bindBrowserWake(no.api); bindBrowserWake(linux.api);
  await tick();
  assert.deepEqual([no.attempts, linux.attempts], [[], []]);
  no.setGrant(true);
  no.added.emit({ permissions: ['nativeMessaging'] });
  await tick();
  assert.equal(no.attempts.length, 1);
  no.native.onMessage.emit({ ...no.messages[0], ok: true });
  no.native.onDisconnect.emit();
  bindBrowserWake(no.api);
  await tick();
  assert.equal(no.attempts.length, 1, 'a restarted worker must not spin on a failing host');
});

test('a malformed native reply is not treated as an acknowledgement', async () => {
  const f = extension();
  bindBrowserWake(f.api, { onResult: value => f.results.push(value) });
  await tick();
  f.native.onMessage.emit({ ...f.messages[0], ok: true, secret: 'reject-extra-field' });
  assert.deepEqual(f.results, ['unavailable']);
  assert.equal(f.disconnected, 1);
});

test('acknowledged port loss schedules exactly one fresh wake, even after a worker restart', async () => {
  const f = extension();
  bindBrowserWake(f.api);
  await tick();
  const first = f.native, original = f.messages[0];
  first.onMessage.emit({ ...original, ok: true });
  first.onDisconnect.emit();
  await tick();
  assert.equal(f.alarms.size, 1, 'the browser should schedule recovery without opening another port now');
  const [[name, options]] = f.alarms;
  assert.deepEqual(options, { delayInMinutes: 0.5 });
  assert.equal(f.attempts.length, 1);
  const worker = f.rebind();
  f.alarm('agent-continue-heartbeat');
  await tick();
  assert.equal(f.attempts.length, 1);
  f.alarm(name); f.alarm(name);
  await tick();
  assert.equal(f.attempts.length, 2);
  const next = f.messages[1];
  assert.notEqual(next.id, original.id);
  assert.deepEqual(next, { version: 1, id: next.id, action: 'wake' });
  f.native.onMessage.emit({ ...next, ok: true });
  const sender = { id: f.api.runtime.id, url: origin + BROWSER_DEVICE_PAGE };
  const stale = { type: BROWSER_DEVICE_MESSAGE, ownerId: original.id,
    request: { version: 1, id: 'old-reconnect', action: 'reconnect' } };
  assert.equal(await worker.handleMessage(stale, sender), null);
  assert.equal(f.messages.length, 2);
  f.native.onDisconnect.emit();
  await tick();
  assert.equal(f.alarms.size, 0);
  assert.equal(f.attempts.length, 2, 'do not loop within a browser session');
});

test('permission revocation cancels scheduled recovery and a stale alarm cannot wake a fresh session', async () => {
  const f = extension();
  bindBrowserWake(f.api);
  await tick();
  f.native.onMessage.emit({ ...f.messages[0], ok: true });
  f.native.onDisconnect.emit();
  await tick();
  const [name] = f.alarms.keys();
  assert.ok(name);
  f.setGrant(false);
  f.removed.emit({ permissions: ['nativeMessaging'] });
  await tick();
  assert.equal(f.alarms.size, 0, 'revocation must remove the alarm before it fires');
  f.alarm(name);
  await tick();
  assert.equal(f.attempts.length, 1);
  f.setGrant(true);
  f.added.emit({ permissions: ['nativeMessaging'] });
  await tick();
  assert.equal(f.attempts.length, 2);
  f.native.onDisconnect.emit();
  f.alarm(name);
  await tick();
  assert.equal(f.attempts.length, 2);
  const fresh = extension();
  bindBrowserWake(fresh.api);
  await tick();
  fresh.native.onDisconnect.emit();
  fresh.alarm(name);
  await tick();
  assert.equal(fresh.attempts.length, 1);
  assert.equal(fresh.alarms.size, 0, 'failed initial handshake must not schedule a retry');
});

test('browser control accepts only the exact Devices page and observed owner for mutations', async () => {
  const f = extension(), wake = bindBrowserWake(f.api);
  const sender = { id: f.api.runtime.id, url: origin + BROWSER_DEVICE_PAGE };
  const msg = { type: BROWSER_DEVICE_MESSAGE, ownerId: null, request: { version: 1, id: 'ui-status', action: 'status' } };
  await tick();
  const first = f.messages[0];
  assert.equal(await wake.handleMessage({ ...msg, ownerId: first.id,
    request: { version: 1, id: 'pre-ack-reconnect', action: 'reconnect' } }, sender), null);
  f.native.onMessage.emit({ ...first, ok: true });
  assert.equal(await wake.handleMessage(msg, { ...sender, url: 'https://chatgpt.com/' }), null);
  assert.equal(await wake.handleMessage(msg, { ...sender, url: sender.url + '&target=x' }), null);
  assert.equal(await wake.handleMessage({ ...msg, request: { ...msg.request, action: 'reconnect' } }, sender), null);
  const status = wake.handleMessage(msg, sender);
  await tick();
  assert.deepEqual(f.messages.at(-1), msg.request);
  const reply = { ...msg.request, ok: true, state: { paused: true, connection: 'disconnected' } };
  f.native.onMessage.emit(reply);
  assert.deepEqual(await status, { ownerId: first.id, response: reply });
  const mutate = { ...msg, ownerId: first.id, request: { version: 1, id: 'ui-reconnect', action: 'reconnect' } };
  const pending = wake.handleMessage(mutate, sender);
  await tick();
  assert.deepEqual(f.messages.at(-1), mutate.request);
  f.native.onDisconnect.emit();
  assert.equal(await pending, null);
  assert.equal(await wake.handleMessage(mutate, sender), null);
  await tick();
  assert.equal(f.alarms.size, 0, 'an unresolved mutation must not schedule automatic recovery');
  assert.equal(f.attempts.length, 1);
});

function streams() {
  return { input: new PassThrough(), output: new PassThrough() };
}

test('prepared operation controls require the exact extension page and current owner', async () => {
  const f = extension(), wake = bindBrowserWake(f.api);
  const sender = { id: f.api.runtime.id, url: origin + BROWSER_DEVICE_PAGE, frameId: 0 };
  await tick();
  const { id: ownerId } = f.messages[0];
  f.native.onMessage.emit({ ...f.messages[0], ok: true });
  const review = { version: 1, id: 'review', action: 'prepared-review',
    operationId: 'ae900800-b673-4eee-abe5-e7267e0d46b1', sha256: 'a'.repeat(64) };
  const ask = (request, from = sender, owner = ownerId) =>
    wake.handleMessage({ type: BROWSER_DEVICE_MESSAGE, ownerId: owner, request }, from);
  assert.equal(await ask(review, { ...sender, url: 'https://chatgpt.com/' }), null);
  assert.equal(await ask(review, { ...sender, frameId: 1 }), null);
  assert.equal(await ask(review, sender, 'previous-owner'), null);
  assert.equal(await ask({ ...review, command: 'not a browser control' }), null);
  const pending = ask(review);
  await tick();
  assert.deepEqual(f.messages.at(-1), review);
  const response = { version: 1, id: review.id, action: review.action, ok: true,
    status: 'staged', expiresAt: 1794000000000 };
  f.native.onMessage.emit(response);
  assert.deepEqual(await pending, { ownerId, response });
  const revoke = ask({ ...review, id: 'revoke', action: 'prepared-revoke' });
  await tick();
  f.native.onDisconnect.emit();
  assert.equal(await revoke, null);
  await tick();
  assert.equal(f.alarms.size, 0, 'an unconfirmed revocation is never replayed');
});

test('native wake rejects an ordinary control or foreign origin before owner startup', async () => {
  for (const [args, frame] of [[[origin], { ...request, action: 'reconnect' }], [['https://chatgpt.com/'], request]]) {
    const s = streams();
    const running = serveBrowserWake({ ...s, origin, args, startOwner: () => assert.fail('owner must not start') });
    await writeFrame(s.input, frame);
    await assert.rejects(running, /invalid_browser_wake/);
  }
});

test('native browser owner checks the staged digest and returns only durable receipt metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-prepared-native-'));
  const s = streams();
  let bound = true, lifecycleRequests = 0;
  const running = serveBrowserWake({ ...s, origin, args: [origin],
    handlePrepared: createPreparedControl({ root, assertCurrent() { assert.ok(bound); } }, prepared),
    async startOwner() { return { async close() {}, async request() { lifecycleRequests++; } }; } });
  try {
    const ask = async frame => {
      const reply = readFrame(s.output);
      await writeFrame(s.input, frame);
      return reply;
    };
    assert.deepEqual(await ask(request), { ...request, ok: true });
    const file = path.join(root, 'plan.json'), store = prepared.openPreparedProcesses(root);
    await fs.writeFile(file, JSON.stringify({ command: 'not executed or returned', shell: process.execPath, timeout_ms: 1000 }));
    const digest = prepared.reviewProcessFile(file), stage = () => store.stage(file, digest);
    const ref = stage(), id = ref[prepared.operationField];
    const header = { version: 1, id: 'review-test', action: 'prepared-review' };
    const review = { ...header, operationId: id, sha256: digest };
    assert.deepEqual(await ask({ ...review, sha256: 'a'.repeat(64) }), { ...header, ok: false });
    assert.deepEqual(await ask({ ...review, command: 'arbitrary' }), { ...header, ok: false });
    assert.deepEqual(await ask(review), { ...header, ok: true, status: 'staged', expiresAt: ref.expiresAt });
    const revoke = { ...review, action: 'prepared-revoke', id: 'revoke-test' };
    const revoked = { version: 1, action: revoke.action, id: revoke.id, ok: true, status: 'owner-revoked', expiresAt: ref.expiresAt };
    assert.deepEqual(await ask(revoke), revoked);
    assert.deepEqual(await ask(revoke), revoked);
    assert.deepEqual(createOperationReceipts(root).lookup(id), { status: 'owner-revoked', requestKind: 'prepared-process' });
    const admitted = stage();
    createOperationReceipts(root).reserve(admitted[prepared.operationField], 'prepared-process');
    assert.deepEqual(await ask({ ...revoke, operationId: admitted[prepared.operationField] }),
      { ...revoked, status: 'admitted-outcome-unconfirmed', expiresAt: admitted.expiresAt });
    bound = false;
    assert.deepEqual(await ask(review), { ...header, ok: false });
    assert.equal(lifecycleRequests, 0);
  } finally {
    s.input.end();
    await running;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('native wake holds exactly one owner until the browser closes the pipe', async () => {
  const s = streams();
  let starts = 0, closes = 0;
  const running = serveBrowserWake({ ...s, origin, args: [origin],
    async startOwner(signal) {
      assert.equal(signal.aborted, false);
      starts++;
      return { async close() { closes++; } };
    } });
  const reply = readFrame(s.output);
  await writeFrame(s.input, request);
  assert.deepEqual(await reply, { ...request, ok: true });
  assert.equal(starts, 1); assert.equal(closes, 0);
  s.input.end();
  await running;
  assert.equal(closes, 1);
});

test('native wake routes a framed control to its own owner and closes on invalid input', async () => {
  const s = streams(), calls = [];
  let closes = 0;
  const running = serveBrowserWake({ ...s, origin, args: [origin],
    async startOwner() {
      return { async close() { closes++; }, async request(value) {
        calls.push(value);
        return { ...value, ok: true, state: { paused: true, connection: 'disconnected' } };
      } };
    } });
  const ack = readFrame(s.output);
  await writeFrame(s.input, request);
  assert.deepEqual(await ack, { ...request, ok: true });
  const status = { version: 1, id: 'status-fixture', action: 'status' };
  const reply = readFrame(s.output);
  await writeFrame(s.input, status);
  assert.deepEqual(await reply, { ...status, ok: true, state: { paused: true, connection: 'disconnected' } });
  assert.deepEqual(calls, [status]);
  const rejected = assert.rejects(running, /invalid_device_request/);
  await writeFrame(s.input, { ...status, action: 'run-command' });
  await rejected;
  assert.equal(closes, 1);
  assert.deepEqual(calls, [status]);
});

test('browser closure aborts deferred native startup and still disposes the resulting owner', async () => {
  const s = streams();
  let pending, release, closes = 0;
  const running = serveBrowserWake({ ...s, origin, args: [origin],
    async startOwner(signal) {
      pending = signal;
      await new Promise(resolve => { release = resolve; });
      return { async close() { closes++; } };
    } });
  await writeFrame(s.input, request);
  await tick();
  s.input.end();
  await tick();
  assert.equal(pending.aborted, true);
  release();
  await running;
  assert.equal(closes, 1);
  assert.equal(s.output.readableLength, 0);
});

test('output closure disposes the browser owner even if stdin remains open', async () => {
  const s = streams();
  let closes = 0;
  const running = serveBrowserWake({ ...s, origin, args: [origin],
    async startOwner() {
      return { async close() { closes++; }, async request() { assert.fail('no control'); } };
    } });
  const ack = readFrame(s.output);
  await writeFrame(s.input, request);
  await ack;
  s.output.destroy();
  await running;
  assert.equal(closes, 1);
  assert.equal(s.input.destroyed, false);
  s.input.destroy();
});
