import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const clientURL = new URL('../device-control.js', import.meta.url);
test('device client exists in canonical repository', () => assert.ok(fs.existsSync(clientURL)));
const client = fs.existsSync(clientURL) ? await import(clientURL) : {};
const { HOST, PENDING_KEY, REVISION_KEY, controlDevice, decodeResponse, createDeviceController } = client;
const reply = (request, state = { paused: false, connection: 'ready' }) => ({ ...request, ok: true, state });
const operation = (id, action = 'reconnect', status = 'in-progress') => ({ id, action, status });
const envelope = state => reply({ version: 1, id: 'fixture', action: 'status' }, state);

test('fixed host, fixed protocol, and only action and random ID are transmitted', async () => {
  assert.equal(HOST, 'com.agentcontinue.device_control');
  const requests = [];
  const runtime = { async sendNativeMessage(host, request) {
    assert.equal(host, HOST);
    requests.push(request);
    return reply(request);
  } };
  for (let n = 0; n < 2; n++) {
    assert.deepEqual(await controlDevice(runtime, 'status'), { kind: 'observed', paused: false, connection: 'ready' });
  }
  assert.notEqual(requests[0].id, requests[1].id);
  for (const request of requests) {
    assert.deepEqual(Object.keys(request).sort(), ['action', 'id', 'version']);
    assert.equal(request.version, 1);
    assert.match(request.id, /^[a-f0-9-]{36}$/);
  }
});

test('arbitrary commands, IDs, and timeouts are rejected before transport', async () => {
  let calls = 0;
  const runtime = { sendNativeMessage() { calls++; } };
  for (const action of ['powershell', '../status', 'constructor', '', {}, null]) {
    await assert.rejects(controlDevice(runtime, action, 'fixture'), /invalid_action/);
  }
  for (const id of ['../invalid', '', 'x'.repeat(65), {}, null]) {
    await assert.rejects(controlDevice(runtime, 'status', id), /invalid_request/);
  }
  for (const timeout of [0, -1, 120001, NaN, '15']) {
    await assert.rejects(controlDevice(runtime, 'status', 'fixture', timeout), /invalid_request/);
  }
  assert.equal(calls, 0);
});

test('strict response correlation, required fields, and closed schemas', () => {
  const good = envelope({ paused: null, connection: 'unknown' });
  assert.deepEqual(decodeResponse(good, 'fixture', 'status'), { kind: 'observed', paused: null, connection: 'unknown' });
  const bad = [null, [], {}, { ...good, version: 2 }, { ...good, id: 'other' }, { ...good, action: 'reconnect' },
    { ...good, ok: 1 }, { ...good, output: 'private' }, { ...good, state: {} },
    { ...good, state: { paused: 0, connection: 'ready' } },
    { ...good, state: { paused: false, connection: 'healthy' } },
    { ...good, state: { paused: true, connection: 'ready', command: 'private' } },
    { ...good, ok: false }, { version: 1, id: 'fixture', action: 'status', ok: false, error: 'private' },
    { id: 'fixture', ok: true, state: { ready: true } }];
  for (const value of bad) assert.throws(() => decodeResponse(value, 'fixture', 'status'), /invalid_response/);
  assert.deepEqual(decodeResponse({ version: 1, id: 'fixture', action: 'status', ok: false }, 'fixture', 'status'), { kind: 'rejected' });
});

test('bounded operation evidence preserves unknown without inventing success', () => {
  for (const status of ['in-progress', 'unknown-running', 'settled', 'not-executed', 'unknown']) {
    const state = { paused: null, connection: 'unknown', operation: operation('one', 'reconnect', status) };
    assert.deepEqual(decodeResponse(envelope(state), 'fixture', 'status'), { kind: 'observed', ...state });
  }
  for (const op of [null, {}, operation('x'.repeat(65)), operation('../one'), operation('one', 'shell'),
    operation('one', 'reconnect', 'success'), { ...operation('one'), output: 'private' }]) {
    assert.throws(() => decodeResponse(envelope({ paused: false, connection: 'ready', operation: op }), 'fixture', 'status'), /invalid_response/);
  }
});

test('a matching not-executed receipt clears a retained intent without replaying a mutation', async () => {
  const pending = { version: 1, id: 'not-executed-query', action: 'reconnect' };
  const f = fixture({ data: { [PENDING_KEY]: pending }, respond: request =>
    reply(request, { paused: true, connection: 'disconnected', operation: operation(pending.id, pending.action, 'not-executed') }) });
  await f.controller.initialize();
  await f.controller.run('status');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].request.id, pending.id);
  assert.equal(f.calls[0].request.action, 'status');
  assert.equal(f.controller.getState().pending, null);
  assert.equal(f.controller.getState().observation.operation.status, 'not-executed');
  assert.equal(f.controller.getState().canMutate, true);
});

test('only the exact native-host-not-found error establishes absent registration', async () => {
  assert.deepEqual(await controlDevice({ sendNativeMessage() { throw Error('Specified native messaging host not found.'); } }, 'status'),
    { kind: 'unavailable', reason: 'host-absent' });
  for (const message of ['Access denied: C:\\private\\secret', 'Native host has exited.', 'not found']) {
    const result = await controlDevice({ sendNativeMessage() { throw Error(message); } }, 'status');
    assert.deepEqual(result, { kind: 'unavailable', reason: 'transport' });
    assert.ok(!JSON.stringify(result).includes(message));
  }
});

test('timeout makes one attempt and ignores late replies', async () => {
  let calls = 0, finish;
  const result = await controlDevice({ sendNativeMessage(host, request) {
    calls++;
    return new Promise(resolve => { finish = () => resolve(reply(request)); });
  } }, 'disconnect-and-pause', 'fixture', 5);
  assert.deepEqual(result, { kind: 'unavailable', reason: 'timeout' });
  finish();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(calls, 1);
  assert.deepEqual(result, { kind: 'unavailable', reason: 'timeout' });
});

test('remote lifecycle envelopes bind immutable target identity without browser SSH metadata', async () => {
  const target = 'a'.repeat(64), calls = [];
  const runtime = { async sendNativeMessage(host, value) { calls.push(value); return reply(value); } };
  assert.deepEqual(await controlDevice(runtime, 'status', 'remote-one', 100, target),
    { kind: 'observed', paused: false, connection: 'ready' });
  assert.deepEqual(calls, [{ version: 2, target, id: 'remote-one', action: 'status' }]);
  assert.deepEqual(decodeResponse(reply(calls[0]), 'remote-one', 'status', target),
    { kind: 'observed', paused: false, connection: 'ready' });
  for (const response of [reply({ version: 1, id: 'remote-one', action: 'status' }),
    reply({ ...calls[0], target: 'b'.repeat(64) }), { ...reply(calls[0]), host: 'private' }]) {
    assert.throws(() => decodeResponse(response, 'remote-one', 'status', target), /invalid_response/);
  }
  for (const invalid of ['', 'local', '../remote', 'x'.repeat(64), {}, 1]) {
    await assert.rejects(controlDevice(runtime, 'status', 'x', 100, invalid), /invalid_request/);
  }
  assert.equal(calls.length, 1);
});

test('target controllers isolate local and other-server pending receipts across reload and storage changes', async () => {
  const target = 'a'.repeat(64), other = 'b'.repeat(64);
  const local = { version: 1, id: 'local-unconfirmed', action: 'reconnect' };
  const data = { [PENDING_KEY]: local }, locks = [], calls = [];
  const storage = { async get() { return structuredClone(data); },
    async set(value) { Object.assign(data, structuredClone(value)); } };
  const options = { storage, permissions: { async contains() { return true; } },
    locks: { async request(name, run) { locks.push(name); return run(); } },
    runtime: { async sendNativeMessage(host, value) { calls.push(value); return reply(value); } } };
  const first = createDeviceController({ ...options, target }); await first.initialize();
  assert.equal(first.getState().pending, null); assert.equal(first.getState().target, target);
  await first.run('status'); await first.run('reconnect');
  const pending = first.getState().pending;
  assert.equal(pending.action, 'reconnect'); assert.deepEqual(data[PENDING_KEY], local);
  assert.deepEqual(data[PENDING_KEY + ':' + target], pending);
  assert.ok(locks.every(name => name.endsWith(':' + target)));
  const second = createDeviceController({ ...options, target: other }); await second.initialize();
  assert.equal(second.getState().pending, null); assert.equal(second.getState().canMutate, false);
  const reload = createDeviceController({ ...options, target }); await reload.initialize();
  assert.deepEqual(reload.getState().pending, pending);
  options.runtime.sendNativeMessage = async (host, value) => {
    calls.push(value); return reply(value, { paused: true, connection: 'disconnected', operation: operation(pending.id, pending.action, 'settled') });
  };
  await reload.run('status');
  assert.deepEqual(calls.at(-1), { version: 2, target, id: pending.id, action: 'status' });
  assert.equal(reload.getState().pending, null); assert.deepEqual(data[PENDING_KEY], local);
  assert.equal(data[PENDING_KEY + ':' + target], null);
  assert.equal(Object.hasOwn(data, PENDING_KEY + ':' + other), false);
});

test('browser-managed mutations use the observed owner and never fall back to the legacy bridge', async () => {
  const local = { version: 1, id: 'legacy-pending', action: 'reconnect' };
  const f = fixture({ data: { [PENDING_KEY]: local } });
  const messages = [];
  let ownerId = 'owner-before', active = true;
  const runtime = {
    async sendNativeMessage() { assert.fail('must not fallback'); },
    async sendMessage(value) {
      messages.push(value);
      if (!active || value.request.action !== 'status' && value.ownerId !== ownerId) return null;
      return { ownerId, response: reply(value.request) };
    },
  };
  const c = createDeviceController({ ...f.dependencies, runtime, browserManaged: true });
  await c.initialize();
  await c.run('status');
  assert.equal(c.getState().canMutate, true);
  ownerId = 'owner-after';
  await c.run('disconnect-and-pause');
  assert.equal(messages.at(-1).ownerId, 'owner-before');
  const pending = c.getState().pending;
  assert.equal(pending.action, 'disconnect-and-pause');
  assert.deepEqual(f.data[PENDING_KEY], local);
  assert.deepEqual(f.data[PENDING_KEY + ':browser-managed'], pending);
  active = false;
  await c.run('status');
  assert.equal(messages.at(-1).request.id, pending.id);
  assert.equal(c.getState().canMutate, false);
  assert.equal(f.calls.length, 0);
});

function fixture(options = {}) {
  const data = structuredClone(options.data || {});
  const calls = [], permissionRequests = [], writes = [];
  let granted = options.granted ?? true;
  let respond = options.respond || (request => reply(request));
  let tail = Promise.resolve();
  const storage = {
    async get() { if (options.readFailure) throw Error('private'); return structuredClone(data); },
    async set(value) { if (options.writeFailure) throw Error('private'); writes.push(structuredClone(value)); Object.assign(data, structuredClone(value)); },
  };
  const locks = { request(name, config, callback) {
    if (typeof config === 'function') callback = config;
    const task = tail.then(() => callback({ name }));
    tail = task.catch(() => {});
    return task;
  } };
  const dependencies = {
    runtime: { async sendNativeMessage(host, request) { calls.push({ host, request }); return respond(request); } },
    permissions: {
      async contains(value) { assert.deepEqual(value, { permissions: ['nativeMessaging'] }); if (options.permissionFailure) throw Error('private'); return granted; },
      request(value) { permissionRequests.push(value); granted = options.acceptPermission ?? true; return Promise.resolve(granted); },
    },
    storage, locks: options.noLocks ? null : locks, timeoutMs: options.timeoutMs ?? 10,
  };
  return { controller: createDeviceController(dependencies), dependencies, data, calls, writes, permissionRequests,
    respond(value) { respond = value; }, revoke() { granted = false; } };
}

test('load and check never request permission; absent permission never reaches transport', async () => {
  const f = fixture({ granted: false });
  await f.controller.initialize();
  assert.equal(f.calls.length, 0);
  assert.equal(f.controller.getState().permission, 'absent');
  await f.controller.run('status');
  await f.controller.run('reconnect');
  assert.deepEqual(f.permissionRequests, []);
  assert.deepEqual(f.calls, []);
  assert.equal(f.controller.getState().registration, 'unchecked');
});

test('explicit risk consent is required and permission request occurs synchronously in the gesture', async () => {
  const f = fixture({ granted: false });
  await f.controller.initialize();
  await f.controller.requestPermission(false);
  assert.equal(f.permissionRequests.length, 0);
  const pending = f.controller.requestPermission(true);
  assert.deepEqual(f.permissionRequests, [{ permissions: ['nativeMessaging'] }]);
  await pending;
  assert.equal(f.controller.getState().permission, 'granted');
  assert.equal(f.calls.length, 0);
  assert.equal(f.controller.getState().canMutate, false);
});

test('a stale permission read cannot overwrite a later revocation', async () => {
  const f = fixture();
  await f.controller.initialize();
  let release;
  f.dependencies.permissions.contains = () => new Promise(resolve => { release = resolve; });
  const old = f.controller.initialize();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  f.dependencies.permissions.contains = async () => false;
  await f.controller.initialize();
  release(true);
  await old;
  assert.equal(f.controller.getState().permission, 'absent');
  assert.equal(f.controller.getState().canMutate, false);
  assert.deepEqual(f.calls, []);
});

test('a late permission request result cannot overwrite a newer permission read', async () => {
  const f = fixture({ granted: false });
  await f.controller.initialize();
  let release;
  f.dependencies.permissions.request = () => new Promise(resolve => { release = resolve; });
  const old = f.controller.requestPermission(true);
  await f.controller.initialize();
  release(true);
  await old;
  assert.equal(f.controller.getState().permission, 'absent');
  assert.deepEqual(f.calls, []);
});

test('late device status cannot restore readiness across permission revocation and regrant', async () => {
  const f = fixture();
  await f.controller.initialize();
  let release;
  f.respond(request => new Promise(resolve => { release = () => resolve(reply(request)); }));
  const old = f.controller.run('status');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  f.revoke();
  await f.controller.initialize();
  release();
  await old;
  f.dependencies.permissions.contains = async () => true;
  await f.controller.initialize();
  assert.equal(f.controller.getState().observation, null);
  assert.equal(f.controller.getState().canMutate, false);
  assert.equal(f.calls.length, 1);
  f.respond(request => reply(request));
  await f.controller.run('status');
  assert.equal(f.controller.getState().canMutate, true);
});

test('an old-epoch mutation receipt preserves its durable ID until a fresh status reconciles it', async () => {
  const f = fixture();
  await f.controller.initialize();
  await f.controller.run('status');
  let release;
  f.respond(request => new Promise(resolve => { release = () => resolve(reply(request, {
    paused: true, connection: 'disconnected', operation: operation(request.id, request.action, 'settled'),
  })); }));
  const old = f.controller.run('disconnect-and-pause');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const pending = f.controller.getState().pending;
  f.revoke();
  await f.controller.initialize();
  release();
  await old;
  assert.deepEqual(f.controller.getState().pending, pending);
  f.dependencies.permissions.contains = async () => true;
  await f.controller.initialize();
  assert.equal(f.controller.getState().canMutate, false);
  f.respond(request => reply(request, { paused: true, connection: 'disconnected',
    operation: operation(pending.id, pending.action, 'settled') }));
  await f.controller.run('status');
  assert.equal(f.controller.getState().pending, null);
  assert.equal(f.calls.filter(({ request }) => request.action !== 'status').length, 1);
});

test('permission denied, unavailable, and host absent are distinct from unknown state', async () => {
  const denied = fixture({ granted: false, acceptPermission: false });
  await denied.controller.initialize();
  await denied.controller.requestPermission(true);
  assert.equal(denied.controller.getState().permission, 'absent');
  const unknown = fixture({ permissionFailure: true });
  await unknown.controller.initialize();
  await unknown.controller.run('status');
  assert.equal(unknown.controller.getState().permission, 'unknown');
  assert.equal(unknown.calls.length, 0);
  const absent = fixture({ respond() { throw Error('Specified native messaging host not found.'); } });
  await absent.controller.initialize();
  await absent.controller.run('status');
  assert.equal(absent.controller.getState().permission, 'granted');
  assert.equal(absent.controller.getState().registration, 'absent');
  assert.equal(absent.controller.getState().observation, null);
});

test('mutation needs a known check and records intent before sending once', async () => {
  const f = fixture();
  await f.controller.initialize();
  await f.controller.run('reconnect');
  assert.equal(f.calls.length, 0);
  await f.controller.run('status');
  assert.equal(f.controller.getState().canMutate, true);
  f.respond(request => {
    assert.deepEqual(f.data[PENDING_KEY], { version: 1, id: request.id, action: request.action });
    return reply(request, { paused: null, connection: 'unknown', operation: operation(request.id, request.action) });
  });
  await f.controller.run('disconnect-and-pause');
  assert.equal(f.calls.length, 2);
  assert.equal(f.controller.getState().canMutate, false);
  await f.controller.run('reconnect');
  assert.equal(f.calls.length, 2);
});

test('observed pause permits both manual actions without claiming tunnel readiness or successful access', async () => {
  for (const paused of [true, false]) {
    for (const action of ['disconnect-and-pause', 'reconnect']) {
      const f = fixture({ respond: request => reply(request, { paused, connection: 'unknown' }) });
      await f.controller.initialize();
      assert.equal(f.controller.getState().canMutate, false);
      await f.controller.run('status');
      assert.equal(f.controller.getState().registration, 'reachable');
      assert.deepEqual(f.controller.getState().observation, { kind: 'observed', paused, connection: 'unknown' });
      assert.equal(f.controller.getState().canMutate, true);
      assert.equal(f.controller.getState().feedback, 'observed');
      f.respond(request => {
        assert.deepEqual(f.data[PENDING_KEY], { version: 1, id: request.id, action });
        return reply(request, { paused, connection: 'unknown', operation: operation(request.id, action, 'settled') });
      });
      await f.controller.run(action);
      assert.deepEqual(f.calls.map(call => call.request.action), ['status', action]);
      assert.equal(f.data[PENDING_KEY], null);
      assert.equal(f.controller.getState().observation.connection, 'unknown');
      assert.equal(f.controller.getState().observation.operation.status, 'settled');
      assert.equal(f.controller.getState().canMutate, true);
    }
  }
});

test('null pause remains locked regardless of tunnel label and invalidates an earlier boolean observation', async () => {
  for (const connection of ['unknown', 'ready', 'disconnected']) {
    const f = fixture({ respond: request => reply(request, { paused: true, connection: 'unknown' }) });
    await f.controller.initialize();
    await f.controller.run('status');
    assert.equal(f.controller.getState().canMutate, true);
    f.respond(request => reply(request, { paused: null, connection }));
    await f.controller.run('status');
    assert.equal(f.controller.getState().registration, 'reachable');
    assert.equal(f.controller.getState().observation.paused, null);
    assert.equal(f.controller.getState().canMutate, false);
    await f.controller.run('reconnect');
    await f.controller.run('disconnect-and-pause');
    assert.deepEqual(f.calls.map(call => call.request.action), ['status', 'status']);
  }
});

test('boolean pause with unknown tunnel still requires permission, healthy journaling, and cross-page locks', async () => {
  for (const options of [{ granted: false }, { readFailure: true }, { writeFailure: true }, { noLocks: true }]) {
    const f = fixture({ ...options, respond: request => reply(request, { paused: false, connection: 'unknown' }) });
    await f.controller.initialize();
    await f.controller.run('status');
    await f.controller.run('reconnect');
    assert.equal(f.controller.getState().canMutate, false);
    assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 0);
  }
});

test('unknown mutation survives reload and clears only with matching settled evidence', async () => {
  const f = fixture();
  await f.controller.initialize();
  await f.controller.run('status');
  f.respond(() => new Promise(() => {}));
  await f.controller.run('reconnect');
  const pending = structuredClone(f.data[PENDING_KEY]);
  const resumed = createDeviceController(f.dependencies);
  await resumed.initialize();
  assert.equal(resumed.getState().canMutate, false);
  for (const [paused, connection] of [[false, 'ready'], [true, 'unknown'], [false, 'unknown']]) {
    for (const op of [undefined, operation('unrelated', 'reconnect', 'settled'),
      operation(pending.id, 'disconnect-and-pause', 'settled'), operation(pending.id, pending.action, 'unknown-running'),
      operation(pending.id, pending.action, 'unknown')]) {
      f.respond(request => reply(request, { paused, connection, ...(op ? { operation: op } : {}) }));
      await resumed.run('status');
      assert.equal(resumed.getState().canMutate, false);
      assert.deepEqual(f.data[PENDING_KEY], pending);
      await resumed.run('disconnect-and-pause');
      assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 1);
    }
  }
  f.respond(request => reply(request, { paused: false, connection: 'unknown', operation: operation(pending.id, pending.action, 'settled') }));
  await resumed.run('status');
  assert.equal(resumed.getState().canMutate, true);
  assert.equal(resumed.getState().observation.connection, 'unknown');
  assert.equal(f.data[PENDING_KEY], null);
});

test('a resumed status polls the retained mutation ID rather than a new random request ID', async () => {
  const pending = { version: 1, id: 'retained-operation', action: 'reconnect' };
  const f = fixture({ data: { [PENDING_KEY]: pending }, respond: request =>
    reply(request, { paused: false, connection: 'ready', ...(request.id === pending.id ?
      { operation: operation(pending.id, pending.action, 'settled') } : {}) }) });
  await f.controller.initialize();
  await f.controller.run('status');
  assert.equal(f.calls[0].request.id, pending.id);
  assert.equal(f.data[PENDING_KEY], null);
  assert.equal(f.controller.getState().canMutate, true);
  assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 0);
});

test('status remains available while mutation pending; stale mutation reply cannot overwrite newer status', async () => {
  const f = fixture();
  await f.controller.initialize();
  await f.controller.run('status');
  let finish;
  f.respond(request => new Promise(resolve => { finish = () => resolve(reply(request, { paused: null, connection: 'unknown', operation: operation(request.id, request.action) })); }));
  const mutation = f.controller.run('reconnect');
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
  const pending = f.data[PENDING_KEY];
  f.respond(request => reply(request, { paused: true, connection: 'disconnected', operation: operation(pending.id, pending.action, 'settled') }));
  await f.controller.run('status');
  finish();
  await mutation;
  assert.equal(f.controller.getState().observation.connection, 'disconnected');
  assert.equal(f.data[PENDING_KEY], null);
});

test('a pending host operation blocks mutations even without a prior local intent', async () => {
  const f = fixture({ respond: request => reply(request, { paused: false, connection: 'ready', operation: operation('existing') }) });
  await f.controller.initialize();
  await f.controller.run('status');
  assert.equal(f.controller.getState().canMutate, false);
  assert.equal(f.data[PENDING_KEY].id, 'existing');
  const other = createDeviceController(f.dependencies);
  await other.initialize();
  f.respond(request => reply(request));
  await other.run('status');
  await other.run('disconnect-and-pause');
  await f.controller.run('reconnect');
  assert.equal(f.data[PENDING_KEY].id, 'existing');
  assert.equal(other.getState().canMutate, false);
  assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 0);
});

test('failed host-intent persistence survives missing storage and generic status until durable recovery and matching settlement', async () => {
  const options = { writeFailure: true };
  const f = fixture(options);
  const pending = { version: 1, id: 'adopted-host', action: 'reconnect' };
  await f.controller.initialize();
  f.respond(request => reply(request, { paused: true, connection: 'unknown', operation: operation(pending.id, pending.action, 'unknown') }));
  await f.controller.run('status');
  assert.deepEqual(f.controller.getState().pending, pending);
  assert.equal(f.controller.getState().journalHealthy, false);
  assert.equal(f.data[PENDING_KEY], undefined);
  f.respond(request => reply(request, { paused: true, connection: 'unknown' }));
  for (let attempt = 0; attempt < 2; attempt++) {
    await f.controller.refreshPending();
    await f.controller.run('status');
    assert.deepEqual(f.controller.getState().pending, pending);
    assert.equal(f.controller.getState().journalHealthy, false);
    assert.equal(f.controller.getState().canMutate, false);
    await f.controller.run('disconnect-and-pause');
  }
  options.writeFailure = false;
  await f.controller.refreshPending();
  assert.deepEqual(f.data[PENDING_KEY], pending);
  assert.equal(f.controller.getState().journalHealthy, true);
  await f.controller.run('status');
  assert.equal(f.controller.getState().canMutate, false);
  const other = createDeviceController(f.dependencies);
  await other.initialize();
  await other.run('status');
  assert.equal(other.getState().canMutate, false);
  for (const op of [operation('unrelated', pending.action, 'settled'), operation(pending.id, 'disconnect-and-pause', 'settled')]) {
    f.respond(request => reply(request, { paused: false, connection: 'ready', operation: op }));
    await f.controller.run('status');
    assert.deepEqual(f.controller.getState().pending, pending);
    assert.equal(f.controller.getState().canMutate, false);
  }
  f.respond(request => reply(request, { paused: false, connection: 'unknown', operation: operation(pending.id, pending.action, 'settled') }));
  await f.controller.run('status');
  assert.equal(f.controller.getState().canMutate, true);
  assert.equal(f.data[PENDING_KEY], null);
  assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 0);
});

test('quarantined intent never overwrites a conflicting durable page intent', async () => {
  const options = { writeFailure: true };
  const f = fixture(options);
  const adopted = { version: 1, id: 'host-pending', action: 'reconnect' };
  const other = { version: 1, id: 'other-page', action: 'disconnect-and-pause' };
  await f.controller.initialize();
  f.respond(request => reply(request, { paused: true, connection: 'unknown', operation: operation(adopted.id) }));
  await f.controller.run('status');
  options.writeFailure = false;
  f.data[PENDING_KEY] = structuredClone(other);
  f.respond(request => reply(request));
  await f.controller.refreshPending();
  await f.controller.run('status');
  assert.deepEqual(f.controller.getState().pending, adopted);
  assert.deepEqual(f.data[PENDING_KEY], other);
  assert.equal(f.controller.getState().journalHealthy, false);
  assert.equal(f.controller.getState().canMutate, false);
  assert.deepEqual(f.writes, []);
});

test('a failed clear that may already have committed still quarantines the prior intent until matching settlement', async () => {
  const f = fixture();
  const pending = { version: 1, id: 'host-pending', action: 'reconnect' };
  await f.controller.initialize();
  f.respond(request => reply(request, { paused: true, connection: 'unknown', operation: operation(pending.id) }));
  await f.controller.run('status');
  const set = f.dependencies.storage.set;
  let failClear = true;
  f.dependencies.storage.set = async values => {
    await set(values);
    if (failClear && values[PENDING_KEY] === null) throw Error('private ambiguous write');
  };
  f.respond(request => reply(request, { paused: false, connection: 'unknown', operation: operation(pending.id, pending.action, 'settled') }));
  await f.controller.run('status');
  assert.equal(f.data[PENDING_KEY], null);
  assert.deepEqual(f.controller.getState().pending, pending);
  assert.equal(f.controller.getState().journalHealthy, false);
  f.respond(request => reply(request));
  await f.controller.run('status');
  assert.deepEqual(f.data[PENDING_KEY], pending);
  assert.deepEqual(f.controller.getState().pending, pending);
  assert.equal(f.controller.getState().canMutate, false);
  failClear = false;
  f.respond(request => reply(request, { paused: false, connection: 'unknown', operation: operation(pending.id, pending.action, 'settled') }));
  await f.controller.run('status');
  assert.equal(f.data[PENDING_KEY], null);
  assert.equal(f.controller.getState().pending, null);
  assert.equal(f.controller.getState().canMutate, true);
  assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 0);
});

test('bad journal, failed persistence, unavailable locks, and revoked permission fail closed', async () => {
  for (const options of [{ data: { [PENDING_KEY]: { id: '../invalid' } } }, { readFailure: true }, { writeFailure: true }, { noLocks: true }]) {
    const f = fixture(options);
    await f.controller.initialize();
    await f.controller.run('status');
    await f.controller.run('reconnect');
    assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 0);
    assert.equal(f.controller.getState().canMutate, false);
  }
  const f = fixture();
  await f.controller.initialize();
  await f.controller.run('status');
  f.revoke();
  await f.controller.run('reconnect');
  assert.equal(f.calls.length, 1);
  assert.equal(f.controller.getState().canMutate, false);
});

test('two pages cannot start overlapping mutations using the shared journal', async () => {
  const f = fixture({ respond: request => reply(request, { paused: true, connection: 'unknown' }) });
  const other = createDeviceController(f.dependencies);
  await f.controller.initialize();
  await other.initialize();
  await f.controller.run('status');
  await other.run('status');
  f.respond(request => reply(request, { paused: true, connection: 'unknown', operation: operation(request.id, request.action) }));
  await Promise.all([f.controller.run('reconnect'), other.run('disconnect-and-pause')]);
  assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 1);
});

test('delayed cross-page status cannot resurrect a settled operation after a newer completed action', async () => {
  const old = { version: 1, id: 'older-operation', action: 'reconnect' };
  const f = fixture({ data: { [PENDING_KEY]: old }, timeoutMs: 1000 });
  const other = createDeviceController(f.dependencies);
  await f.controller.initialize();
  await other.initialize();
  let release, started;
  const sent = new Promise(resolve => { started = resolve; });
  f.respond(request => new Promise(resolve => {
    release = () => resolve(reply(request, { paused: false, connection: 'ready',
      operation: operation(old.id, old.action) }));
    started();
  }));
  const delayed = f.controller.run('status');
  await sent;
  try {
    f.respond(request => reply(request, { paused: false, connection: 'ready',
      operation: operation(old.id, old.action, 'settled') }));
    await other.run('status');
    assert.equal(f.data[PENDING_KEY], null);
    let latest;
    f.respond(request => {
      latest = operation(request.id, request.action, 'settled');
      return reply(request, { paused: true, connection: 'disconnected', operation: latest });
    });
    await other.run('disconnect-and-pause');
    assert.equal(f.data[PENDING_KEY], null);
    release();
    await delayed;
    assert.equal(f.data[PENDING_KEY], null, 'an old reply must not restore a completed intent');
    f.respond(request => reply(request, { paused: true, connection: 'disconnected', operation: latest }));
    await f.controller.run('status');
    await other.run('status');
    assert.equal(f.controller.getState().canMutate, true);
    assert.equal(other.getState().canMutate, true);
    assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 1);
  } finally { release(); await delayed; }
});

test('an empty-to-pending-to-empty cycle also invalidates an older cross-page status', async () => {
  const f = fixture({ timeoutMs: 1000 });
  const other = createDeviceController(f.dependencies);
  await f.controller.initialize();
  await other.initialize();
  let release, started;
  const sent = new Promise(resolve => { started = resolve; });
  const old = operation('host-existing');
  f.respond(request => new Promise(resolve => {
    release = () => resolve(reply(request, { paused: false, connection: 'ready', operation: old }));
    started();
  }));
  const delayed = f.controller.run('status');
  await sent;
  try {
    f.respond(request => reply(request, { paused: false, connection: 'ready', operation: old }));
    await other.run('status');
    assert.equal(f.data[PENDING_KEY].id, old.id, 'genuinely outstanding host work is still adopted');
    f.respond(request => reply(request, { paused: false, connection: 'ready',
      operation: operation(old.id, old.action, 'settled') }));
    await other.run('status');
    release();
    await delayed;
    assert.equal(f.data[PENDING_KEY], null, 'equal empty snapshots are not proof that the journal never changed');
    await f.controller.run('status');
    assert.equal(f.controller.getState().canMutate, true);
    assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 0);
  } finally { release(); await delayed; }
});

test('delayed old status cannot erase or replace a newer pending operation', async () => {
  for (const status of ['in-progress', 'settled']) {
    const old = { version: 1, id: 'older-operation', action: 'reconnect' };
    const f = fixture({ data: { [PENDING_KEY]: old }, timeoutMs: 1000 });
    const other = createDeviceController(f.dependencies);
    await f.controller.initialize();
    await other.initialize();
    let release, started;
    const sent = new Promise(resolve => { started = resolve; });
    f.respond(request => new Promise(resolve => {
      release = () => resolve(reply(request, { paused: false, connection: 'ready',
        operation: operation(old.id, old.action, status) }));
      started();
    }));
    const delayed = f.controller.run('status');
    await sent;
    try {
      f.respond(request => reply(request, { paused: false, connection: 'ready',
        operation: operation(old.id, old.action, 'settled') }));
      await other.run('status');
      f.respond(request => reply(request, { paused: true, connection: 'unknown',
        operation: operation(request.id, request.action, 'unknown-running') }));
      await other.run('disconnect-and-pause');
      const newer = structuredClone(f.data[PENDING_KEY]);
      const writes = f.writes.length;
      release();
      await delayed;
      assert.deepEqual(f.data[PENDING_KEY], newer);
      assert.equal(f.writes.length, writes, 'stale status must not write the shared journal');
      await f.controller.run('reconnect');
      await other.run('reconnect');
      assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 1);
      assert.equal(f.controller.getState().canMutate, false);
      f.respond(request => reply(request, { paused: true, connection: 'unknown',
        operation: operation(newer.id, newer.action, 'settled') }));
      await f.controller.run('status');
      await other.run('status');
      assert.equal(f.data[PENDING_KEY], null);
      assert.equal(f.controller.getState().canMutate, true);
      assert.equal(other.getState().canMutate, true);
    } finally { release(); await delayed; }
  }
});

test('a changed shared revision requires a fresh manual observation before another mutation', async () => {
  const f = fixture();
  const other = createDeviceController(f.dependencies);
  await f.controller.initialize();
  await other.initialize();
  await f.controller.run('status');
  await other.run('status');
  f.respond(request => reply(request, { paused: true, connection: 'disconnected',
    operation: operation(request.id, request.action, 'settled') }));
  await other.run('disconnect-and-pause');
  await f.controller.run('reconnect');
  assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 1);
  assert.equal(f.controller.getState().canMutate, false);
  f.respond(request => reply(request, { paused: true, connection: 'disconnected' }));
  await f.controller.run('status');
  assert.equal(f.controller.getState().canMutate, true);
});

test('an unread journal cannot relabel a delayed status with the newer cached revision', async () => {
  const options = { timeoutMs: 1000 };
  const f = fixture(options);
  const other = createDeviceController(f.dependencies);
  await f.controller.initialize();
  await other.initialize();
  await other.run('status');
  let release, started;
  const sent = new Promise(resolve => { started = resolve; });
  f.respond(request => new Promise(resolve => {
    release = () => resolve(reply(request, { paused: false, connection: 'ready' }));
    started();
  }));
  const delayed = f.controller.run('status');
  await sent;
  try {
    f.respond(request => reply(request, { paused: true, connection: 'disconnected',
      operation: operation(request.id, request.action, 'settled') }));
    await other.run('disconnect-and-pause');
    await f.controller.refreshPending();
    options.readFailure = true;
    release();
    await delayed;
    assert.equal(f.controller.getState().journalHealthy, false);
    options.readFailure = false;
    await f.controller.refreshPending();
    assert.equal(f.controller.getState().canMutate, false, 'recovered storage is not a fresh status at the cached revision');
    assert.equal(f.controller.getState().observation, null);
    await f.controller.run('reconnect');
    assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 1);
    f.respond(request => reply(request, { paused: true, connection: 'disconnected' }));
    await f.controller.run('status');
    assert.equal(f.controller.getState().canMutate, true);
    assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 1);
  } finally { options.readFailure = false; release(); await delayed; }
});

test('an unread journal cannot certify a reply even when the cached revision did not change', async () => {
  const options = {};
  const f = fixture(options);
  await f.controller.initialize();
  await f.controller.run('status');
  f.respond(request => {
    options.readFailure = true;
    return reply(request);
  });
  await f.controller.run('status');
  options.readFailure = false;
  await f.controller.refreshPending();
  assert.equal(f.controller.getState().observation, null);
  assert.equal(f.controller.getState().canMutate, false);
  await f.controller.run('reconnect');
  assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 0);
  f.respond(request => reply(request));
  await f.controller.run('status');
  assert.equal(f.controller.getState().canMutate, true);
});

test('a failed clear cannot re-quarantine an operation another page has durably settled and superseded', async () => {
  const f = fixture();
  const other = createDeviceController(f.dependencies);
  await f.controller.initialize();
  f.respond(request => reply(request, { paused: false, connection: 'ready', operation: operation('existing') }));
  await f.controller.run('status');
  const set = f.dependencies.storage.set;
  let failClear = true;
  f.dependencies.storage.set = async values => {
    await set(values);
    if (failClear && values[PENDING_KEY] === null) {
      failClear = false;
      throw Error('ambiguous synthetic clear');
    }
  };
  f.respond(request => reply(request, { paused: true, connection: 'disconnected',
    operation: operation('existing', 'reconnect', 'settled') }));
  await f.controller.run('status');
  assert.equal(f.controller.getState().journalHealthy, false);
  assert.equal(f.data[PENDING_KEY], null);
  await other.initialize();
  await other.run('status');
  let latest;
  f.respond(request => {
    latest = operation(request.id, request.action, 'settled');
    return reply(request, { paused: true, connection: 'disconnected', operation: latest });
  });
  await other.run('disconnect-and-pause');
  await f.controller.refreshPending();
  assert.equal(f.data[PENDING_KEY], null, 'local quarantine must not overwrite later durable progress');
  f.respond(request => reply(request, { paused: true, connection: 'disconnected', operation: latest }));
  await f.controller.run('status');
  assert.equal(f.controller.getState().canMutate, true);
  assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 1);
});

test('malformed shared revisions fail closed without native mutation or repair writes', async () => {
  assert.equal(REVISION_KEY, 'deviceControlRevisionV1');
  for (const revision of [false, 1, {}, [], '../path', 'a'.repeat(65)]) {
    const f = fixture({ data: { [REVISION_KEY]: revision } });
    await f.controller.initialize();
    await f.controller.run('status');
    await f.controller.run('reconnect');
    assert.equal(f.controller.getState().journalHealthy, false);
    assert.equal(f.controller.getState().canMutate, false);
    assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 0);
    assert.deepEqual(f.writes, []);
  }
});

test('revision and pending writes finish under the shared lock before a mutation is sent', async () => {
  const f = fixture({ timeoutMs: 1000 });
  const other = createDeviceController(f.dependencies);
  await f.controller.initialize();
  await other.initialize();
  await f.controller.run('status');
  await other.run('status');
  const set = f.dependencies.storage.set;
  let release, started;
  const sent = new Promise(resolve => { started = resolve; });
  const committed = new Promise(resolve => { release = resolve; });
  let delayedOnce = false;
  f.dependencies.storage.set = async values => {
    if (values[PENDING_KEY] && !delayedOnce) {
      delayedOnce = true;
      started();
      await committed;
    }
    await set(values);
  };
  f.respond(request => reply(request, { paused: true, connection: 'unknown',
    operation: operation(request.id, request.action) }));
  const first = f.controller.run('reconnect');
  let second;
  await sent;
  try {
    assert.equal(typeof f.data[REVISION_KEY], 'string');
    assert.equal(f.data[PENDING_KEY], undefined);
    second = other.run('disconnect-and-pause');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 0);
    release();
    await Promise.all([first, second]);
    assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 1);
    assert.equal(f.data[PENDING_KEY].action, 'reconnect');
    assert.deepEqual(Object.keys(f.writes[0]), [REVISION_KEY]);
    assert.deepEqual(Object.keys(f.writes[1]), [PENDING_KEY]);
  } finally { release(); await Promise.all([first, second]); }
});

test('revision-write rejection before or after commit recovers a known-unsent intent with generic status', async () => {
  for (const commitFirst of [false, true]) {
    const f = fixture();
    await f.controller.initialize();
    await f.controller.run('status');
    const set = f.dependencies.storage.set;
    let failOnce = true;
    f.dependencies.storage.set = async values => {
      if (failOnce && Object.hasOwn(values, REVISION_KEY)) {
        failOnce = false;
        if (commitFirst) await set(values);
        throw Error('ambiguous synthetic revision write');
      }
      await set(values);
    };
    await f.controller.run('reconnect');
    const pending = f.controller.getState().pending;
    assert.ok(pending);
    assert.equal(f.controller.getState().journalHealthy, false);
    assert.equal(f.data[PENDING_KEY], undefined);
    assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 0);
    await f.controller.refreshPending();
    assert.equal(f.data[PENDING_KEY] ?? null, null, 'a never-dispatched intent must not be queued for a fictitious host receipt');
    assert.equal(f.controller.getState().pending, null);
    assert.equal(f.controller.getState().canMutate, false);
    await f.controller.run('status');
    assert.equal(f.controller.getState().canMutate, true);
    const other = createDeviceController(f.dependencies);
    await other.initialize();
    await other.run('status');
    assert.equal(other.getState().canMutate, true);
    assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 0);
  }
});

test('pending-write rejection before or after commit recovers a known-unsent intent without a host settlement', async () => {
  for (const commitFirst of [false, true]) {
    const f = fixture();
    await f.controller.initialize();
    await f.controller.run('status');
    const set = f.dependencies.storage.set;
    let failOnce = true;
    f.dependencies.storage.set = async values => {
      if (failOnce && values[PENDING_KEY]) {
        failOnce = false;
        if (commitFirst) await set(values);
        throw Error('ambiguous synthetic pending write');
      }
      await set(values);
    };
    await f.controller.run('disconnect-and-pause');
    const pending = f.controller.getState().pending;
    assert.ok(pending);
    const advanced = f.data[REVISION_KEY];
    assert.equal(typeof advanced, 'string');
    assert.equal(f.controller.getState().journalHealthy, false);
    assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 0);
    await f.controller.refreshPending();
    assert.equal(f.data[PENDING_KEY] ?? null, null, 'only source-known unsent metadata may be retired without a receipt');
    assert.equal(f.controller.getState().pending, null);
    assert.equal(f.controller.getState().canMutate, false);
    assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 0);
    f.respond(request => reply(request, { paused: true, connection: 'unknown' }));
    await f.controller.run('status');
    assert.equal(f.controller.getState().canMutate, true);
    assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 0);
  }
});

test('one explicit generic status recovers a failed unsent admission without an automatic mutation or retry', async () => {
  for (const key of [REVISION_KEY, PENDING_KEY]) {
    for (const commitFirst of [false, true]) {
      const f = fixture();
      await f.controller.initialize();
      await f.controller.run('status');
      const set = f.dependencies.storage.set;
      let failOnce = true;
      f.dependencies.storage.set = async values => {
        if (failOnce && Object.hasOwn(values, key)) {
          failOnce = false;
          if (commitFirst) await set(values);
          throw Error('synthetic pre-transport admission failure');
        }
        await set(values);
      };
      await f.controller.run('reconnect');
      assert.equal(f.controller.getState().canMutate, false);
      assert.deepEqual(f.calls.map(call => call.request.action), ['status']);
      await f.controller.run('status');
      assert.equal(f.data[PENDING_KEY] ?? null, null);
      assert.equal(f.controller.getState().canMutate, true);
      assert.deepEqual(f.calls.map(call => call.request.action), ['status', 'status']);
    }
  }
});

test('known-unsent recovery never clears a newer operation dispatched by another controller', async () => {
  const f = fixture();
  const other = createDeviceController(f.dependencies);
  await f.controller.initialize();
  await other.initialize();
  await f.controller.run('status');
  await other.run('status');
  const set = f.dependencies.storage.set;
  let failOnce = true;
  f.dependencies.storage.set = async values => {
    if (failOnce && Object.hasOwn(values, REVISION_KEY)) {
      failOnce = false;
      throw Error('synthetic uncommitted revision');
    }
    await set(values);
  };
  await f.controller.run('reconnect');
  assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 0);
  f.respond(request => reply(request, { paused: true, connection: 'unknown',
    operation: operation(request.id, request.action, 'unknown-running') }));
  await other.run('disconnect-and-pause');
  const foreign = structuredClone(f.data[PENDING_KEY]);
  const writes = f.writes.length;
  await f.controller.refreshPending();
  assert.deepEqual(f.data[PENDING_KEY], foreign);
  assert.equal(f.writes.length, writes);
  f.respond(request => reply(request, { paused: true, connection: 'unknown' }));
  await f.controller.run('status');
  assert.deepEqual(f.data[PENDING_KEY], foreign);
  assert.equal(f.controller.getState().canMutate, false);
  assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 1);
});

test('generic status and recovered storage never retire an actually dispatched unknown operation', async () => {
  const options = { timeoutMs: 5 };
  const f = fixture(options);
  await f.controller.initialize();
  await f.controller.run('status');
  f.respond(() => new Promise(() => {}));
  await f.controller.run('reconnect');
  const pending = structuredClone(f.data[PENDING_KEY]);
  assert.equal(f.controller.getState().feedback, 'timeout');
  options.readFailure = true;
  await f.controller.refreshPending();
  options.readFailure = false;
  await f.controller.refreshPending();
  f.respond(request => reply(request));
  await f.controller.run('status');
  await f.controller.run('disconnect-and-pause');
  assert.deepEqual(f.data[PENDING_KEY], pending);
  assert.equal(f.controller.getState().canMutate, false);
  assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 1);
});

test('known-unsent cleanup retries metadata only after a rejected clear, before or after commit', async () => {
  for (const commitFirst of [false, true]) {
    const f = fixture();
    await f.controller.initialize();
    await f.controller.run('status');
    const set = f.dependencies.storage.set;
    let rejectAdmission = true, rejectCleanup = true;
    f.dependencies.storage.set = async values => {
      if (rejectAdmission && values[PENDING_KEY]) {
        rejectAdmission = false;
        await set(values);
        throw Error('synthetic committed unsent admission');
      }
      if (rejectCleanup && values[PENDING_KEY] === null) {
        rejectCleanup = false;
        if (commitFirst) await set(values);
        throw Error('synthetic ambiguous unsent cleanup');
      }
      await set(values);
    };
    await f.controller.run('reconnect');
    await f.controller.refreshPending();
    assert.equal(f.controller.getState().journalHealthy, false);
    assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 0);
    await f.controller.refreshPending();
    assert.equal(f.data[PENDING_KEY] ?? null, null);
    await f.controller.run('status');
    assert.equal(f.controller.getState().canMutate, true);
    assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 0);
  }
});

test('a reloaded controller cannot infer that persisted intent was never dispatched by its owner', async () => {
  const f = fixture();
  await f.controller.initialize();
  await f.controller.run('status');
  const set = f.dependencies.storage.set;
  let failOnce = true;
  f.dependencies.storage.set = async values => {
    await set(values);
    if (failOnce && values[PENDING_KEY]) {
      failOnce = false;
      throw Error('synthetic committed unsent admission');
    }
  };
  await f.controller.run('reconnect');
  const pending = structuredClone(f.data[PENDING_KEY]);
  const reloaded = createDeviceController(f.dependencies);
  await reloaded.initialize();
  await reloaded.run('status');
  assert.deepEqual(f.data[PENDING_KEY], pending);
  assert.equal(reloaded.getState().canMutate, false);
  await f.controller.refreshPending();
  assert.equal(f.data[PENDING_KEY], null);
  await reloaded.run('status');
  assert.equal(reloaded.getState().canMutate, true);
  assert.equal(f.calls.filter(call => call.request.action !== 'status').length, 0);
});

test('mutations with missing, rejected, or unrelated operation evidence remain locked', async () => {
  for (const respond of [request => reply(request), request => ({ ...request, ok: false }),
    request => reply(request, { paused: false, connection: 'ready', operation: operation('other', request.action, 'settled') }),
    request => ({ ...reply(request), id: 'other' })]) {
    const f = fixture();
    await f.controller.initialize();
    await f.controller.run('status');
    f.respond(respond);
    await f.controller.run('reconnect');
    assert.equal(f.controller.getState().canMutate, false);
    assert.equal(f.data[PENDING_KEY].action, 'reconnect');
    await f.controller.run('disconnect-and-pause');
    await f.controller.requestPermission(true);
    assert.equal(f.calls.length, 2);
    assert.equal(f.permissionRequests.length, 0);
  }
});

test('matching settled mutation receipt is not conflated with known connection or success', async () => {
  for (const action of ['disconnect-and-pause', 'reconnect']) {
    const f = fixture();
    await f.controller.initialize();
    await f.controller.run('status');
    f.respond(request => reply(request, { paused: null, connection: 'unknown', operation: operation(request.id, action, 'settled') }));
    await f.controller.run(action);
    assert.equal(f.data[PENDING_KEY], null);
    assert.equal(f.controller.getState().observation.connection, 'unknown');
    assert.equal(f.controller.getState().canMutate, false);
  }
});

test('permission request exception and non-consent never imply a granted permission', async () => {
  const f = fixture({ granted: false });
  await f.controller.initialize();
  for (const consent of [undefined, 'true', 1, {}, null]) await f.controller.requestPermission(consent);
  assert.equal(f.permissionRequests.length, 0);
  f.dependencies.permissions.request = () => { throw Error('private path'); };
  await f.controller.requestPermission(true);
  assert.equal(f.controller.getState().permission, 'unknown');
  assert.equal(f.controller.getState().feedback, 'permission-unavailable');
  assert.equal(f.calls.length, 0);
});
