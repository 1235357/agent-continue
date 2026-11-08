import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { prepareState } from '../native/desktop-commander/runtime.mjs';
import * as native from '../native/desktop-commander/device-owner.mjs';
import { serveBrowserWake } from '../native/desktop-commander/device-native-host.mjs';
import { openDeviceOperations } from '../native/desktop-commander/device-operations.mjs';
import { openController } from '../native/desktop-commander/lifecycle.mjs';

const extensionId = 'a'.repeat(32), origin = `chrome-extension://${extensionId}/`;
const ownerId = 'initial-wake-id';
const request = (id, action = 'status') => ({ version: 1, id, action });
const attach = (value, id = ownerId) => ({ version: 2, action: 'attach-control', ownerId: id, request: value });
const encode = value => JSON.stringify(value) + '\n';
const stopped = { paused: true, runtime: 'stopped', ready: false };
const running = { paused: false, runtime: 'running', ready: true };
const check = (name, run) => test(name, { timeout: 8000 }, run);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function within(promise, milliseconds = 2000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('fixture_deadline')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
async function turn() { await new Promise(resolve => setImmediate(resolve)); }

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-existing-control-'));
  const root = path.join(base, 'state');
  prepareState(root, { consent: 'full-account' });
  const bindingFile = path.join(base, 'binding.json');
  fs.writeFileSync(bindingFile, encode({ format: 'agent-continue-native-binding', version: 1, extensionId, stateRoot: root }), { mode: 0o600 });
  const binding = native.readNativeBinding(bindingFile), owners = [], cleanups = [];
  const calls = [];
  let current = { ...stopped };
  const controller = {
    async status() { calls.push('status'); return { ...current }; },
    async reconnect() { calls.push('reconnect'); current = { ...running }; return { ...current }; },
    async pause() { calls.push('pause'); current = { ...stopped }; return { ...current }; },
    beginQuiesce() { calls.push('quiesce'); current = { ...current, runtime: 'stopped', ready: false }; return Promise.resolve({ ...current }); },
    async dispose() { calls.push('dispose'); },
  };
  t.after(async () => {
    for (const cleanup of cleanups) await cleanup();
    for (const owner of owners) await owner.close().catch(() => {});
    fs.rmSync(base, { recursive: true, force: true });
  });
  return { base, root, binding, bindingFile, calls, controller, cleanups,
    channel: path.join(root, 'device-channel.json'), journal: path.join(root, 'device-operations.jsonl'),
    async open(options = {}) {
      const settings = { controller, expectedOrigin: origin, browserOwnerId: ownerId, ...options };
      if (settings.browserOwnerId === undefined) delete settings.browserOwnerId;
      const owner = await native.startDeviceOwner(bindingFile, settings);
      owners.push(owner); return owner;
    },
    setState(value) { current = { ...value }; },
  };
}

async function route(f, value, overrides = {}) {
  const input = new PassThrough(), output = new PassThrough();
  let starts = 0, prepared = 0;
  const serving = serveBrowserWake({ input, output, binding: f.binding, origin, args: [origin],
    startOwner() { starts++; throw new Error('startup_forbidden'); },
    handlePrepared() { prepared++; throw new Error('prepared_forbidden'); }, ...overrides });
  void serving.catch(() => {});
  await native.writeFrame(input, value);
  try {
    await serving;
    return await native.readFrame(output, 1000);
  } finally { input.destroy(); output.destroy(); assert.equal(starts, 0); assert.equal(prepared, 0); }
}

check('frozen existing-browser API is exported', () => {
  assert.equal(typeof native.sendExistingBrowserControl, 'function');
});

check('wake ID is recorded only for browser ownership and forwarded from the first frame', async t => {
  const f = fixture(t), input = new PassThrough(), output = new PassThrough();
  let receivedId;
  const serving = serveBrowserWake({ input, output, origin, args: [origin],
    startOwner: async (signal, id) => {
      receivedId = id;
      return f.open({ signal, browserOwnerId: id });
    } });
  void serving.catch(() => {});
  const ack = native.readFrame(output, 2000);
  void ack.catch(() => {});
  try {
    await native.writeFrame(input, { version: 1, id: ownerId, action: 'wake' });
    await ack;
    assert.equal(receivedId, ownerId);
    assert.equal(JSON.parse(fs.readFileSync(f.channel)).browserOwnerId, ownerId);
  } finally { input.end(); await serving; output.destroy(); }
});

check('same wake host attaches once and returns the exact v2 success envelope', async t => {
  const f = fixture(t); await f.open();
  const value = request('read-original');
  const response = await route(f, attach(value));
  assert.deepEqual(response, { version: 2, action: 'attach-control', ownerId,
    response: { ...value, ok: true, state: { paused: true, connection: 'disconnected' } } });
  assert.deepEqual(f.calls, ['status']);
});

check('attach rejects reconnect, prepared dispatch, extra fields and wrong origin without startup', async t => {
  const f = fixture(t); await f.open();
  for (const value of [attach(request('bad', 'reconnect')), attach(request('bad', 'prepared-revoke')),
    { ...attach(request('bad')), path: f.root }, attach({ ...request('bad'), args: [] }),
    attach(request('bad'), '../invalid'), { ...attach(request('bad')), version: 1 }]) {
    await assert.rejects(route(f, value));
  }
  await assert.rejects(route(f, attach(request('wrong-origin')), { args: ['chrome-extension://' + 'b'.repeat(32) + '/'] }));
  assert.deepEqual(f.calls, []);
});

check('missing, dead and legacy-unassociated owners fail unavailable without creating state', async t => {
  const f = fixture(t);
  const names = fs.readdirSync(f.root);
  await assert.rejects(route(f, attach(request('absent'))), /device_bridge_unavailable/);
  assert.deepEqual(fs.readdirSync(f.root), names);
  const owner = await f.open({ browserOwnerId: undefined });
  assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(f.channel)), 'browserOwnerId'), false);
  await assert.rejects(route(f, attach(request('legacy'))), /device_bridge_unavailable/);
  assert.equal((await native.sendDeviceRequest(f.binding, request('ordinary'))).ok, true);
  await owner.close();
  await assert.rejects(route(f, attach(request('dead'))), /device_bridge_unavailable/);
});

check('browser association requires a quiescence-capable controller rather than a disposal fallback', async t => {
  const f = fixture(t);
  delete f.controller.beginQuiesce;
  await assert.rejects(f.open(), /device_owner_unavailable/);
  assert.equal(fs.existsSync(f.channel), false);
  assert.equal(fs.existsSync(path.join(f.root, 'device-operations.lease')), false);
});

check('wrong owner and a pinned replacement cannot be adopted', async t => {
  const f = fixture(t), first = await f.open();
  await assert.rejects(native.sendExistingBrowserControl(f.binding, 'another-owner', request('conflict'), { timeoutMs: 1000 }));
  const pinned = native.pinDeviceChannel(f.binding);
  await first.close();
  await f.open();
  await assert.rejects(native.sendExistingBrowserControl(pinned, ownerId, request('stale'), { timeoutMs: 1000 }), /device_channel_changed/);
  assert.equal((await native.sendExistingBrowserControl(f.binding, ownerId, request('fresh'), { timeoutMs: 1000 })).ok, true);
});

check('association and authentication use the same retained channel bytes across a challenge', async t => {
  const f = fixture(t);
  assert.equal(typeof native.sendExistingBrowserControl, 'function');
  const endpointId = crypto.randomBytes(16).toString('hex');
  const endpoint = process.platform === 'win32' ? '\\\\.\\pipe\\agentcontinue-device-' + endpointId : path.join(f.root, `device-${endpointId}.sock`);
  const channel = { format: 'agent-continue-device-channel', version: 1, extensionId, endpoint,
    secret: crypto.randomBytes(32).toString('hex'), browserOwnerId: ownerId };
  fs.writeFileSync(f.channel, encode(channel), { mode: 0o600 });
  let bytesReceived = 0;
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    socket.on('data', bytes => { bytesReceived += bytes.length; });
    fs.writeFileSync(f.channel, encode({ ...channel, browserOwnerId: 'replacement-owner' }), { mode: 0o600 });
    void native.writeFrame(socket, { version: 1, nonce: 'b'.repeat(64) });
  });
  await new Promise(resolve => server.listen(endpoint, resolve));
  try {
    await assert.rejects(native.sendExistingBrowserControl(f.binding, ownerId, request('raced'), { timeoutMs: 1000 }), /device_channel_changed/);
    await turn();
    assert.equal(bytesReceived, 0, 'changed snapshot must fail before authenticated dispatch');
  } finally { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
});

check('deferred reconnect leaves independent status and one priority Pause reachable after transport timeout', async t => {
  const f = fixture(t), gate = deferred(), entered = deferred();
  f.controller.reconnect = async () => { f.calls.push('reconnect'); entered.resolve(); await gate.promise; return { ...stopped }; };
  await f.open();
  const original = native.sendDeviceRequest(f.binding, request('primary', 'reconnect'), { timeoutMs: 100 });
  const lost = assert.rejects(original, /device_request_timeout/);
  try {
    await entered.promise;
    const status = await route(f, attach(request('primary')));
    assert.equal(status.response.state.operation.status, 'in-progress');
    await lost;
    assert.equal((await route(f, attach(request('primary')))).response.state.operation.status, 'in-progress');
    const paused = await route(f, attach(request('priority', 'disconnect-and-pause')));
    assert.deepEqual(paused.response.state.operation, { id: 'priority', action: 'disconnect-and-pause', status: 'settled' });
    assert.equal((await route(f, attach(request('primary')))).response.state.operation.status, 'in-progress');
    assert.equal((await route(f, attach(request('priority', 'disconnect-and-pause')))).response.state.operation.status, 'settled');
    assert.equal(f.calls.filter(call => call === 'pause').length, 1);
    assert.equal(f.calls.filter(call => call === 'reconnect').length, 1);
  } finally { gate.resolve(); await lost; }
});

check('lost Pause reply retains its fsynced receipt and unresolved Pause cannot be duplicated', async t => {
  const f = fixture(t), gate = deferred(), entered = deferred();
  f.controller.pause = async () => { f.calls.push('pause'); entered.resolve(); await gate.promise; return { ...stopped }; };
  await f.open();
  const lost = native.sendExistingBrowserControl(f.binding, ownerId, request('lost-pause', 'disconnect-and-pause'), { timeoutMs: 30 });
  try {
    await entered.promise;
    await assert.rejects(lost, /device_request_timeout/);
    const duplicate = await route(f, attach(request('other-pause', 'disconnect-and-pause')));
    assert.equal(duplicate.response.ok, false);
    assert.equal((await route(f, attach(request('lost-pause')))).response.state.operation.status, 'in-progress');
    gate.resolve(); await turn();
    const receipt = await route(f, attach(request('lost-pause')));
    assert.equal(receipt.response.state.operation.status, 'settled');
    assert.match(fs.readFileSync(f.journal, 'utf8'), /"id":"lost-pause","action":"disconnect-and-pause","status":"settled"/);
    assert.equal(f.calls.filter(call => call === 'pause').length, 1);
  } finally { gate.resolve(); }
});

check('a reply lost exactly after terminal fsync is recovered by original ID without replay', async t => {
  const f = fixture(t); await f.open();
  const input = new PassThrough(), output = new PassThrough();
  output.on('error', () => {});
  const serving = serveBrowserWake({ input, output, binding: f.binding, origin, args: [origin],
    startOwner() { throw new Error('startup_forbidden'); } });
  const lost = assert.rejects(serving, /device_bridge_unavailable/);
  const sync = fs.fsyncSync;
  let lostAfterDurability = false;
  try {
    fs.fsyncSync = function(...args) {
      const result = Reflect.apply(sync, this, args);
      if (fs.readFileSync(f.journal, 'utf8').includes('"id":"fsynced-pause","action":"disconnect-and-pause","status":"settled"')) {
        lostAfterDurability = true; output.destroy();
      }
      return result;
    };
    await native.writeFrame(input, attach(request('fsynced-pause', 'disconnect-and-pause')));
    await lost;
  } finally { fs.fsyncSync = sync; input.destroy(); output.destroy(); }
  assert.equal(lostAfterDurability, true);
  const receipt = await route(f, attach(request('fsynced-pause')));
  assert.equal(receipt.response.state.operation.status, 'settled');
  assert.equal((await route(f, attach(request('fsynced-pause', 'disconnect-and-pause')))).response.state.operation.status, 'settled');
  assert.equal(f.calls.filter(call => call === 'pause').length, 1);
});

check('port loss begins quiescence before hung request drain and keeps authenticated status and Pause', async t => {
  const f = fixture(t), gate = deferred(), entered = deferred();
  f.controller.reconnect = async () => { entered.resolve(); await gate.promise; return { ...stopped }; };
  const input = new PassThrough(), output = new PassThrough();
  const serving = serveBrowserWake({ input, output, origin, args: [origin],
    startOwner: (signal, browserOwnerId) => f.open({ signal, browserOwnerId }) });
  void serving.catch(() => {});
  const ack = native.readFrame(output, 2000);
  void ack.catch(() => {});
  try {
    await native.writeFrame(input, { version: 1, id: ownerId, action: 'wake' }); await ack;
    await native.writeFrame(input, request('hung', 'reconnect')); await entered.promise;
    output.destroy(); await turn();
    assert.equal(f.calls.includes('quiesce'), true, 'must stop before the unresolved long-port request returns');
    assert.equal(f.calls.includes('dispose'), false);
    assert.equal(fs.existsSync(f.channel), true);
    const status = await route(f, attach(request('hung')));
    assert.equal(status.response.state.operation.status, 'in-progress');
    const paused = await route(f, attach(request('during-quiesce', 'disconnect-and-pause')));
    assert.equal(paused.response.state.operation.status, 'settled');
    await assert.rejects(native.sendDeviceRequest(f.binding, request('late-connect', 'reconnect')), /device_/);
  } finally { gate.resolve(); input.destroy(); output.destroy(); await serving; }
  assert.equal(f.calls.filter(call => call === 'dispose').length, 1);
  assert.equal(fs.existsSync(f.channel), false);
});

check('close retains the channel and leases through drain, then requires positive stop proof', async t => {
  const f = fixture(t), gate = deferred(), entered = deferred();
  f.controller.reconnect = async () => { entered.resolve(); await gate.promise; return { ...stopped }; };
  f.controller.dispose = async () => { throw new Error('stop_unconfirmed'); };
  const owner = await f.open(), active = owner.request(request('retained', 'reconnect'));
  await entered.promise;
  const closing = owner.close();
  const rejected = assert.rejects(closing, /stop_unconfirmed/);
  assert.equal(f.calls.includes('quiesce'), true);
  assert.equal((await route(f, attach(request('retained')))).response.state.operation.status, 'in-progress');
  gate.resolve(); await active; await rejected;
  assert.equal(fs.existsSync(f.channel), true);
  assert.equal(fs.existsSync(path.join(f.root, 'device-operations.lease')), true);
});

check('drained owner keeps authenticated control open until positive quiescence proof returns', async t => {
  const f = fixture(t), proof = deferred();
  let confirmed = false;
  f.controller.beginQuiesce = () => { f.calls.push('quiesce'); return proof.promise; };
  f.controller.dispose = async () => {
    f.calls.push('dispose');
    if (!confirmed) throw new Error('stop_unconfirmed');
  };
  const owner = await f.open(), closing = owner.close();
  void closing.catch(() => {});
  try {
    await turn();
    assert.equal(f.calls.includes('dispose'), false, 'release may not race ahead of stop proof');
    assert.equal((await route(f, attach(request('proof-pending')))).response.ok, true);
    assert.equal(fs.existsSync(path.join(f.root, 'device-operations.lease')), true);
  } finally { confirmed = true; proof.resolve(stopped); await closing.catch(() => {}); }
});

check('saved-intent startup participates in shutdown drain even without a browser mutation', async t => {
  const f = fixture(t), startup = deferred();
  f.controller.startSavedIntent = () => startup.promise;
  const owner = await f.open(), closing = owner.close();
  void closing.catch(() => {});
  try {
    await turn();
    assert.equal(f.calls.includes('dispose'), false, 'pending saved startup still owns the lifecycle lease');
    assert.equal((await route(f, attach(request('saved-startup-pending')))).response.ok, true);
  } finally { startup.resolve(); await closing; }
});

check('unknown stop proof retains status and Pause, and a later proven stop can finalize', async t => {
  const f = fixture(t);
  const unknown = { paused: false, runtime: 'unknown', ready: false };
  f.controller.beginQuiesce = () => { f.calls.push('quiesce'); f.setState(unknown); return Promise.resolve(unknown); };
  const owner = await f.open();
  try {
    await assert.rejects(owner.close(), /stop_unconfirmed/);
    assert.equal(f.calls.includes('dispose'), false);
    const status = await route(f, attach(request('unconfirmed')));
    assert.equal(status.response.state.connection, 'unknown');
    assert.equal((await route(f, attach(request('explicit-after-stop', 'disconnect-and-pause')))).response.state.paused, true);
  } finally { f.setState(stopped); await owner.close().catch(() => {}); }
  assert.equal(fs.existsSync(f.channel), false);
});

check('failed runtime is not positive quiescence proof and cannot release owner resources', async t => {
  const f = fixture(t), failed = { paused: false, runtime: 'failed', ready: false };
  f.controller.beginQuiesce = () => { f.setState(failed); return Promise.resolve(failed); };
  const owner = await f.open();
  try {
    await assert.rejects(owner.close(), /stop_unconfirmed/);
    assert.equal(f.calls.includes('dispose'), false);
    assert.equal(fs.existsSync(f.channel), true);
    assert.equal(fs.existsSync(path.join(f.root, 'device-operations.lease')), true);
    assert.equal((await route(f, attach(request('failed-proof')))).response.ok, true);
  } finally { f.setState(stopped); await owner.close(); }
});

check('revoked binding and channel bytes reject before any controller dispatch', async t => {
  const f = fixture(t); await f.open();
  const consent = path.join(f.root, 'consent.json'), saved = fs.readFileSync(consent);
  try {
    fs.writeFileSync(consent, '{}');
    await assert.rejects(route(f, attach(request('revoked'))), /device_bridge_unavailable/);
    assert.deepEqual(f.calls, []);
  } finally { fs.writeFileSync(consent, saved); }
});

check('native observation is bounded to one second and cannot terminalize an unknown-running row', async t => {
  const f = fixture(t), gate = deferred();
  f.controller.pause = async () => ({ paused: true, runtime: 'unknown', ready: false });
  const operations = openDeviceOperations(f.root, f.controller);
  try {
    const paused = await operations.handle(request('unknown-stop', 'disconnect-and-pause'));
    assert.equal(paused.state.operation.status, 'unknown-running');
    const journal = fs.readFileSync(f.journal, 'utf8');
    f.controller.status = () => gate.promise;
    const reading = operations.handle(request('unknown-stop'));
    try {
      const result = await within(reading, 1400);
      assert.deepEqual(result.state, { paused: null, connection: 'unknown',
        operation: { id: 'unknown-stop', action: 'disconnect-and-pause', status: 'unknown-running' } });
      assert.equal(fs.readFileSync(f.journal, 'utf8'), journal);
    } finally { gate.resolve(stopped); await reading; }
    await turn();
    assert.equal(fs.readFileSync(f.journal, 'utf8'), journal, 'a late observation cannot append a terminal receipt');
  } finally { operations.close(); }
});

function lifecycleFixture(t, overrides = {}) {
  const f = fixture(t), children = [], launchGate = deferred();
  const intent = path.join(f.root, 'lifecycle.json');
  const initial = encode({ format: 'agent-continue-lifecycle', version: 1, paused: false });
  fs.writeFileSync(intent, initial, { mode: 0o600 });
  const c = openController(f.root, { deferStartup: true, readyTimeoutMs: 80, stopTimeoutMs: 30, pollIntervalMs: 5,
    launch: () => launchGate.promise,
    spawn() {
      const child = new EventEmitter(); child.pid = 12345; child.exitCode = null; child.signalCode = null;
      child.kill = () => { child.exitCode = 0; child.emit('exit', 0, null); return true; };
      children.push(child); return child;
    },
    observeCore: async () => ({ pid: 12345, startTime: '123', executable: process.execPath }),
    hasExited: async () => true,
    fetch: async () => { throw new Error('fake_health_only'); }, ...overrides });
  f.cleanups.push(async () => { launchGate.resolve({ configured: false }); await c.dispose().catch(() => {}); });
  return { ...f, c, children, launchGate, intent, initial };
}

check('lifecycle owner retries close after late verified exit without changing saved running intent', async t => {
  const child = new EventEmitter(), signals = [], observations = [];
  child.pid = 12345; child.exitCode = null; child.signalCode = null;
  child.kill = signal => { signals.push(signal); return true; };
  const identity = { pid: 54321, startTime: '123456789', executable: process.execPath };
  let exitEvidence = true, spawns = 0;
  const f = lifecycleFixture(t, {
    launch: () => ({ configured: true, command: 'fake-never-executed', args: [] }),
    spawn: () => { spawns++; return child; },
    observeCore: async () => identity,
    hasExited: async captured => {
      observations.push(captured);
      if (exitEvidence instanceof Error) throw exitEvidence;
      return exitEvidence;
    },
  });
  await f.c.startSavedIntent();
  const owner = await f.open({ controller: f.c });
  f.cleanups.unshift(async () => {
    if (!fs.existsSync(f.channel)) return;
    // Only a failed test needs an explicit pause to tear down the unfixed owner.
    exitEvidence = true; child.exitCode = 0; child.emit('exit', 0, null);
    await f.c.pause(); await owner.close();
  });
  const leases = [f.channel, path.join(f.root, 'controller.lease'), path.join(f.root, 'device-operations.lease')];
  const retained = leases.map(file => fs.readFileSync(file));
  const intentBefore = fs.statSync(f.intent, { bigint: true });
  const assertRetained = () => {
    leases.forEach((file, index) => assert.deepEqual(fs.readFileSync(file), retained[index]));
    assert.equal(fs.readFileSync(f.intent, 'utf8'), f.initial);
  };

  await assert.rejects(owner.close(), /stop_unconfirmed/);
  assert.equal((await f.c.status()).runtime, 'unknown');
  assert.equal(observations.length, 0, 'a live launcher is not proof of the captured core exit');
  assertRetained();

  child.exitCode = 0; child.emit('exit', 0, null);
  for (exitEvidence of [false, undefined, 'true', new Error('fake_observation_unavailable')]) {
    await assert.rejects(owner.close(), /stop_unconfirmed/);
    assertRetained();
  }
  const unconfirmed = await route(f, attach(request('late-exit-unconfirmed')));
  assert.equal(unconfirmed.response.state.paused, false);
  assert.equal(unconfirmed.response.state.connection, 'unknown');

  exitEvidence = true;
  await owner.close();
  leases.forEach(file => assert.equal(fs.existsSync(file), false));
  assert.equal(fs.readFileSync(f.intent, 'utf8'), f.initial);
  const intentAfter = fs.statSync(f.intent, { bigint: true });
  assert.equal(intentAfter.ino, intentBefore.ino);
  assert.equal(intentAfter.mtimeNs, intentBefore.mtimeNs);
  assert.deepEqual(signals, ['SIGTERM']);
  assert.equal(spawns, 1);
  assert.ok(observations.length > 0);
  observations.forEach(captured => assert.equal(captured, identity));
});

check('beginQuiesce synchronously latches without persisting pause or releasing the lifecycle lease', async t => {
  const f = lifecycleFixture(t);
  assert.equal(typeof f.c.beginQuiesce, 'function');
  const starting = f.c.reconnect();
  const quiescing = f.c.beginQuiesce();
  await assert.rejects(f.c.reconnect(), /operation_busy|controller_quiescing/);
  assert.equal(fs.readFileSync(f.intent, 'utf8'), f.initial);
  assert.equal(fs.existsSync(path.join(f.root, 'controller.lease')), true);
  f.launchGate.resolve({ configured: true, command: 'fake-never-executed', args: [] });
  await starting; await quiescing;
  assert.equal(f.children.length, 0, 'late launch cannot escape shutdown');
  assert.equal((await f.c.status()).paused, false);
  await f.c.pause();
  assert.equal(JSON.parse(fs.readFileSync(f.intent)).paused, true);
});

check('quiesce latch precedes a reentrant stop callback and survives an unconfirmed stop', async t => {
  let reentrant, c;
  const f = lifecycleFixture(t, { launch: () => ({ configured: true, command: 'fake', args: [] }),
    spawn() {
      const child = new EventEmitter(); child.pid = 12345; child.exitCode = null; child.signalCode = null;
      child.kill = () => { reentrant = c.reconnect().then(() => 'unexpected', error => error.message); return true; };
      return child;
    } });
  c = f.c;
  await c.reconnect();
  assert.equal(typeof c.beginQuiesce, 'function');
  await c.beginQuiesce();
  assert.match(await reentrant, /operation_busy|controller_quiescing/);
  await assert.rejects(c.dispose(), /stop_unconfirmed/);
  await assert.rejects(c.reconnect(), /operation_busy|controller_quiescing|stop_unconfirmed/);
  assert.equal(fs.readFileSync(f.intent, 'utf8'), f.initial);
  assert.equal(fs.existsSync(path.join(f.root, 'controller.lease')), true);
});

check('reentrant beginQuiesce observes the already reserved shutdown promise', async t => {
  let nested, c;
  const f = lifecycleFixture(t, { launch: () => ({ configured: true, command: 'fake', args: [] }),
    spawn() {
      const child = new EventEmitter(); child.pid = 12345; child.exitCode = null; child.signalCode = null;
      child.kill = () => { nested = c.beginQuiesce(); child.exitCode = 0; child.emit('exit', 0, null); return true; };
      return child;
    } });
  c = f.c;
  await c.reconnect();
  const outer = c.beginQuiesce();
  assert.equal(nested, outer);
  await outer;
});
