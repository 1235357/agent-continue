import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { ADMIN_BROWSER_HOST, ADMIN_BROWSER_MESSAGE, ADMIN_BROWSER_PAUSE_STATUS, ADMIN_BROWSER_RESTORE,
  bindAdministratorBrowser } from '../admin-browser.js';
import { createAdministratorBrowserActions, serveAdministratorBrowser } from '../native/desktop-commander/windows-admin-browser-host.mjs';
import { readFrame, writeFrame } from '../native/desktop-commander/device-owner.mjs';

const extensionId = 'a'.repeat(32);
const origin = 'chrome-extension://' + extensionId + '/';
const digest = 'd'.repeat(64);
const generation = 'e'.repeat(32);
const sender = { id: extensionId, frameId: 0, url: origin + 'devices.html?mode=browser-managed' };
const message = { type: ADMIN_BROWSER_MESSAGE };
const operationId = 'f'.repeat(32);
const otherOperationId = 'b'.repeat(32);
const pauseMessage = { type: 'WINDOWS_ADMINISTRATOR_PAUSE_STATUS_V1', operationId };
const pauseRequest = { version: 1, id: 'pause-1', action: 'pause-status', operationId };
const reconcileMessage = { type: 'WINDOWS_ADMINISTRATOR_PAUSE_RECONCILE_V1', operationId };
const reconcileRequest = { ...pauseRequest, action: 'pause-reconcile' };
const initiatePause = { type: 'WINDOWS_ADMINISTRATOR_PAUSE_V1' };
const lastPauseKey = 'windowsAdministratorPauseLastV1';
const invalidOperationIds = [null, 1, {}, operationId.toUpperCase(), operationId.slice(1), operationId + '\n', randomUUID()];
const pauseTarget = generation + ':' + otherOperationId;
const idleTarget = generation + ':idle';
const invalidTargets = [null, {}, 1, generation, ':' + operationId, pauseTarget.toUpperCase(),
  pauseTarget + '\n', idleTarget + '\r', generation + ':IDLE', generation + ':idle -Action Wake',
  generation + '\uFF1Aidle', generation + ':idle\u2028'];
const supportReply = request => ({ ...request, state: 'supported', target: pauseTarget });
const pauseReply = ({ target, ...request }, state) => ({ ...request, state });
const binding = { version: 1, origin, bundleSha256: digest, systemDirectory: 'C:\\Windows\\System32' };
const root = 'C:\\Program Files\\AgentContinueAdmin\\' + digest.slice(0, 24);
const sessionWakeKey = 'windowsAdministratorBrowserWakeAttemptV1';
function event() {
  const listeners = [];
  return { addListener: fn => listeners.push(fn), emit: (...args) => listeners.map(fn => fn(...args)) };
}
function extension({ permission = true, optedIn = false, os = 'win', local = {}, saved = {} } = {}) {
  // Synthetic ports verify the extension contract, not real browser/high-owner lifetime.
  let reply;
  const startup = event(), added = event(), removed = event(), sent = [], ports = [];
  const api = {
    runtime: { id: extensionId, getURL: p => origin + p, getPlatformInfo: async () => ({ os }),
      onStartup: { addListener: startup.addListener },
      connectNative(host) {
        const onMessage = event(), onDisconnect = event();
        const port = { host, messages: [], disconnected: false, disconnectCalls: 0, onMessage, onDisconnect,
          postMessage(request) { port.messages.push(request); },
          disconnect() { port.disconnectCalls++; port.lose(); },
          lose() { port.disconnected = true; onDisconnect.emit(); },
          receive(value) { onMessage.emit(value); } };
        ports.push(port);
        return port;
      },
      async sendNativeMessage(host, request) {
        sent.push({ host, request });
        return reply?.(request);
      } },
    permissions: { contains: async () => permission, onAdded: { addListener: added.addListener },
      onRemoved: { addListener: removed.addListener } },
    storage: { session: { get: async key => ({ [key]: saved[key] }), set: async value => Object.assign(saved, value) },
      local: { get: async key => ({ [key]: key === ADMIN_BROWSER_RESTORE ? optedIn : local[key] }),
        set: async value => Object.assign(local, value), remove: async key => { delete local[key]; } } },
  };
  return { api, sent, ports, saved, start: () => Promise.all(startup.emit()),
    revoke() { permission = false; removed.emit({ permissions: ['nativeMessaging'] }); },
    remove: removed.emit, add: change => Promise.all(added.emit(change)),
    grant: () => { permission = true; return Promise.all(added.emit({ permissions: ['nativeMessaging'] })); },
    arm: () => { optedIn = true; },
    response: fn => { reply = fn; } };
}

function sessionAck(port, outcome = 'attached') {
  return { version: 1, action: 'session', id: port.messages[0].id, outcome };
}

test('a valid Pause invalidates pending startup synchronously before permission or native work', async () => {
  const f=extension({permission:false});let denied=0;
  const bridge=bindAdministratorBrowser(f.api,{onPauseIntent:()=>{denied++;}});
  const work=bridge.handleMessage(initiatePause,sender);
  assert.equal(denied,1);
  await work;
  assert.equal(f.sent.length,0);
});

test('a metadata-free Devices popup can read status, persist one Pause and read its exact receipt', async () => {
  const local = {}, f = extension({ local });
  const popup = { id: sender.id, url: sender.url };
  let pauseIntents = 0;
  const controller = bindAdministratorBrowser(f.api, { onPauseIntent() { pauseIntents++; } });
  f.response(request => {
    if (request.action === 'status') return { ...request, state: 'ready', generation };
    if (request.action === 'pause-support') return supportReply(request);
    if (request.action === 'pause') {
      assert.equal(pauseIntents, 1);
      assert.deepEqual(local[lastPauseKey], { operationId: request.operationId, outcome: 'unconfirmed' });
      return pauseReply(request, 'requested');
    }
    return pauseReply(request, 'stopped');
  });
  assert.deepEqual(await controller.handleMessage(message, popup), { state: 'ready', generation });
  const pausing = controller.handleMessage(initiatePause, popup);
  assert.equal(pauseIntents, 1, 'Pause cancels startup before awaiting native work');
  const receipt = await pausing;
  assert.equal(receipt.outcome, 'requested');
  assert.match(receipt.operationId, /^[a-f0-9]{32}$/);
  assert.deepEqual(await controller.handleMessage({ ...pauseMessage, operationId: receipt.operationId }, popup),
    { operationId: receipt.operationId, state: 'stopped' });
  assert.deepEqual(f.sent.map(value => value.request.action), ['status', 'pause-support', 'pause', 'pause-status']);
  assert.equal(f.sent.filter(value => value.request.action === 'pause').length, 1);
});

test('untrusted or malformed Pause messages cannot invalidate startup', async () => {
  const f=extension();let denied=0;
  const bridge=bindAdministratorBrowser(f.api,{onPauseIntent:()=>{denied++;}});
  await bridge.handleMessage(initiatePause,{...sender,url:'https://chatgpt.com/'});
  await bridge.handleMessage({...initiatePause,extra:true},sender);
  assert.equal(denied,0);
});
test('explicit setup can attach an observer after pre-install host failure without any wake demand',async()=>{
  const f=extension(),bridge=bindAdministratorBrowser(f.api);
  await new Promise(resolve=>setImmediate(resolve));
  singlePort(f).lose();
  const prepared=bridge.prepareSetupObserver(()=>true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.ports.length,2);
  const port=f.ports[1];assert.equal(port.messages[0].wake,false);
  port.receive(sessionAck(port));assert.equal(await prepared,true);
  assert.equal(f.sent.length,0);
});
test('setup observer acknowledgement cannot outlive withdrawn admission or lost permission',async()=>{
  for(const revoke of [false,true]){
    const f=extension(),bridge=bindAdministratorBrowser(f.api);let allowed=true;
    await new Promise(resolve=>setImmediate(resolve));
    const prepared=bridge.prepareSetupObserver(()=>allowed);
    await new Promise(resolve=>setImmediate(resolve));
    const port=singlePort(f);if(revoke)f.revoke();else allowed=false;
    port.receive(sessionAck(port));assert.equal(await prepared,false);
  }
});
test('setup observer disconnect during final permission await cannot admit startup',async()=>{
  const f=extension(),bridge=bindAdministratorBrowser(f.api);
  await new Promise(resolve=>setImmediate(resolve));
  const port=singlePort(f);port.receive(sessionAck(port));
  let reads=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  f.api.permissions.contains=async()=>++reads===2?gate:true;
  const prepared=bridge.prepareSetupObserver(()=>true);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,2);
  port.lose();release(true);assert.equal(await prepared,false);
});

function singlePort(fixture) {
  assert.equal(fixture.ports.length, 1);
  return fixture.ports[0];
}

test('retained browser session persists its startup attempt before one exact opted-in attachment per worker', async () => {
  const f = extension({ optedIn: true });
  const connect = f.api.runtime.connectNative;
  f.api.runtime.connectNative = host => {
    assert.equal(f.saved[sessionWakeKey], true);
    return connect(host);
  };
  bindAdministratorBrowser(f.api);
  await Promise.all([f.start(), f.start()]);
  await f.start();
  assert.equal(f.ports.length, 1);
  const port = f.ports[0], { id } = port.messages[0];
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(port.host, ADMIN_BROWSER_HOST);
  assert.deepEqual(port.messages, [{ version: 1, action: 'session', id, wake: true }]);
  assert.equal(port.disconnected, false);
  assert.deepEqual(f.sent, []);
});

test('disarmed browser attaches without demand and enabling restore does not wake this browser session', async () => {
  const local = {}, saved = {}, f = extension({ local, saved });
  bindAdministratorBrowser(f.api);
  await f.start();
  assert.equal(f.ports.length, 1);
  assert.equal(f.ports[0].messages[0].wake, false);
  f.arm();
  await f.start();
  f.ports[0].lose();
  const replacement = extension({ local, saved, optedIn: true });
  bindAdministratorBrowser(replacement.api);
  await replacement.start();
  assert.equal(replacement.ports[0].messages[0].wake, false);
  assert.deepEqual(local, {});
  assert.deepEqual([...f.sent, ...replacement.sent], []);
});

test('retained browser session requires Windows native permission and rejects incognito workers', async () => {
  for (const options of [{ optedIn: true, permission: false }, { optedIn: true, os: 'linux' }]) {
    const f = extension(options); bindAdministratorBrowser(f.api);
    await f.start();
    assert.deepEqual(f.ports, []);
    assert.deepEqual(f.sent, []);
  }
  const f = extension({ optedIn: true });
  f.api.extension = { inIncognitoContext: true };
  assert.equal(bindAdministratorBrowser(f.api), null);
  assert.deepEqual(f.ports, []);
  assert.deepEqual(f.saved, {});
});

test('native permission granted after a no-port startup attaches exactly one observer without waking', async () => {
  for (const optedIn of [false, true]) {
    const f = extension({ permission: false, optedIn }); bindAdministratorBrowser(f.api);
    await f.start();
    assert.deepEqual(f.ports, []);
    assert.equal(f.saved[sessionWakeKey], true);
    await f.add({ permissions: ['storage'] });
    assert.deepEqual(f.ports, []);
    await Promise.all([f.grant(), f.grant(), f.start()]);
    const port = singlePort(f), { id } = port.messages[0];
    assert.deepEqual(port.messages, [{ version: 1, action: 'session', id, wake: false }]);
    port.receive(sessionAck(port));
    await f.grant();
    await f.start();
    assert.equal(f.ports.length, 1);
    assert.equal(port.disconnected, false);
    assert.deepEqual(f.sent, []);
  }
});

test('a grant racing the initial permission read can only attach an observer, never an opted-in wake', async () => {
  for (const initialPermission of [false, true]) {
    const f = extension({ permission: false, optedIn: true });
    const reading = Promise.withResolvers(), permission = Promise.withResolvers();
    let reads = 0;
    f.api.permissions.contains = () => {
      if (++reads === 1) { reading.resolve(); return permission.promise; }
      return Promise.resolve(true);
    };
    bindAdministratorBrowser(f.api);
    await reading.promise;
    const granted = f.grant();
    permission.resolve(initialPermission);
    await granted;
    await f.start();
    assert.equal(singlePort(f).messages[0].wake, false);
    assert.deepEqual(f.sent, []);
  }
});

test('removal before any port seals the worker against later permission grants', async () => {
  const f = extension({ permission: false, optedIn: true }); bindAdministratorBrowser(f.api);
  await f.start();
  f.revoke();
  await f.grant();
  await f.start();
  assert.deepEqual(f.ports, []);
  assert.deepEqual(f.sent, []);
});

test('removal while a permission grant is queued seals the pending observer attachment', async () => {
  const f = extension({ permission: false, optedIn: true });
  const reading = Promise.withResolvers(), permission = Promise.withResolvers();
  f.api.permissions.contains = () => { reading.resolve(); return permission.promise; };
  bindAdministratorBrowser(f.api);
  await reading.promise;
  const granted = f.grant();
  f.revoke();
  permission.resolve(false);
  await granted;
  await f.grant();
  await f.start();
  assert.deepEqual(f.ports, []);
  assert.deepEqual(f.sent, []);
});

test('worker replacement attaches wake false after either acknowledged or lost initial session', async () => {
  for (const acknowledged of [false, true]) {
    const saved = {}, f = extension({ saved, optedIn: true });
    bindAdministratorBrowser(f.api);
    await f.start();
    const first = singlePort(f);
    assert.equal(first.messages[0].wake, true);
    if (acknowledged) first.receive(sessionAck(first));
    first.lose();
    await f.start();
    assert.equal(f.ports.length, 1);
    const replacement = extension({ saved, optedIn: true });
    bindAdministratorBrowser(replacement.api);
    await Promise.all([replacement.start(), replacement.start()]);
    const port = replacement.ports[0];
    assert.equal(replacement.ports.length, 1);
    assert.notEqual(port.messages[0].id, first.messages[0].id);
    assert.deepEqual(port.messages[0], { version: 1, action: 'session', id: port.messages[0].id, wake: false });
    assert.deepEqual([...f.sent, ...replacement.sent], []);
  }
});

test('a fresh browser session may restore once but any persisted attempt value forbids another wake', async () => {
  for (const attempted of [true, false, null, 'unknown', 0]) {
    const f = extension({ optedIn: true, saved: { [sessionWakeKey]: attempted } });
    bindAdministratorBrowser(f.api);
    await f.start();
    assert.equal(singlePort(f).messages[0].wake, false);
  }
  const reopened = extension({ optedIn: true });
  bindAdministratorBrowser(reopened.api);
  await reopened.start();
  assert.equal(reopened.ports[0].messages[0].wake, true);
});

test('only an exact correlated attached acknowledgment retains the port; it is not a status observation', async () => {
  const f = extension({ optedIn: true }), controller = bindAdministratorBrowser(f.api);
  await f.start();
  const port = singlePort(f);
  port.receive(sessionAck(port));
  assert.equal(port.disconnected, false);
  assert.deepEqual(f.sent, []);
  f.response(request => request.action === 'pause-support' ? supportReply(request) :
    request.action === 'pause' ? pauseReply(request, 'requested') : { ...request, state: 'unobserved', generation: null });
  assert.deepEqual(await controller.handleMessage(message, sender), { state: 'unobserved', generation: null });
  const paused = await controller.handleMessage(initiatePause, sender);
  assert.equal(paused.outcome, 'requested');
  assert.deepEqual(f.sent.map(({ request }) => request.action), ['status', 'pause-support', 'pause']);
  assert.equal(port.messages.length, 1);
  assert.equal(port.disconnected, false);
});

test('invalid or unconfirmed session replies close the port without retries, timers or one-shot wake fallback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const replies = [
    () => null, () => [], () => true,
    port => ({ ...sessionAck(port), version: 2 }),
    port => ({ ...sessionAck(port), action: 'wake' }),
    port => ({ ...sessionAck(port), id: 'another-id' }),
    port => ({ ...sessionAck(port), outcome: 'requested' }),
    port => ({ ...sessionAck(port), outcome: 'ready' }),
    port => ({ ...sessionAck(port), state: 'ready', generation }),
    port => ({ ...sessionAck(port), wake: true }),
    port => ({ ...sessionAck(port), command: 'anything' }),
    port => { const { outcome, ...reply } = sessionAck(port); return reply; },
    port => sessionAck(port, 'unconfirmed'),
  ];
  for (const reply of replies) {
    const f = extension({ optedIn: true }); bindAdministratorBrowser(f.api);
    await f.start();
    const port = singlePort(f);
    port.receive(reply(port));
    assert.equal(port.disconnected, true);
    assert.equal(port.disconnectCalls, 1);
    port.receive(sessionAck(port));
    t.mock.timers.tick(120000);
    await f.grant();
    await f.start();
    assert.equal(f.ports.length, 1);
    assert.equal(port.messages.length, 1);
    assert.deepEqual(f.sent, []);
  }
});

test('an extra session reply is terminal and never becomes a command or ready observation', async () => {
  const f = extension(); bindAdministratorBrowser(f.api);
  await f.start();
  const port = singlePort(f);
  port.receive(sessionAck(port));
  port.receive(sessionAck(port));
  assert.equal(port.disconnected, true);
  await f.start();
  assert.equal(f.ports.length, 1);
  assert.deepEqual(f.sent, []);
});

test('native disconnect only retries an acknowledged observer, never startup demand or pause', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  for (const acknowledged of [false, true]) {
    const local = {}, f = extension({ optedIn: true, local }); bindAdministratorBrowser(f.api);
    await f.start();
    const port = singlePort(f);
    if (acknowledged) port.receive(sessionAck(port));
    let errorReads = 0;
    Object.defineProperty(f.api.runtime, 'lastError', { get() { errorReads++; return { message: 'lost port' }; } });
    port.lose();
    assert.equal(errorReads, 1);
    t.mock.timers.tick(120000);
    await f.grant();
    await f.start();
    assert.equal(f.ports.length, acknowledged ? 2 : 1);
    if (acknowledged) assert.equal(f.ports[1].messages[0].wake, false);
    assert.equal(port.disconnectCalls, 0);
    assert.deepEqual(f.sent, []);
    assert.deepEqual(local, {});
  }
});

test('permission removal synchronously closes only the retained port and prevents reattachment in this worker', async () => {
  const local = {}, f = extension({ optedIn: true, local }); bindAdministratorBrowser(f.api);
  await f.start();
  const port = singlePort(f);
  port.receive(sessionAck(port));
  f.remove({ permissions: ['storage'] });
  assert.equal(port.disconnected, false);
  f.revoke();
  assert.equal(port.disconnected, true);
  assert.equal(port.disconnectCalls, 1);
  f.grant();
  await f.start();
  assert.equal(f.ports.length, 1);
  assert.deepEqual(f.sent, []);
  assert.deepEqual(local, {});
});

for (const action of ['status', 'pause']) {
  test(`observer recovery cannot resend or overwrite an in-flight ${action}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const local = {}, f = extension({ local });
    const controller = bindAdministratorBrowser(f.api);
    await f.start();
    const port = singlePort(f); port.receive(sessionAck(port));
    const submitted = Promise.withResolvers(), result = Promise.withResolvers(), connected = Promise.withResolvers();
    f.response(request => {
      if (request.action === 'pause-support') return supportReply(request);
      assert.equal(request.action, action); submitted.resolve();
      return result.promise.then(() => action === 'pause' ? pauseReply(request, 'requested') :
        { ...request, state: 'ready', generation });
    });
    const pending = controller.handleMessage(action === 'pause' ? initiatePause : message, sender);
    await submitted.promise;
    const before = structuredClone(local), connect = f.api.runtime.connectNative;
    f.api.runtime.connectNative = host => { const next = connect(host); connected.resolve(); return next; };
    port.lose(); t.mock.timers.tick(1000); await connected.promise;
    assert.equal(f.ports.length, 2); assert.equal(f.ports[1].messages[0].wake, false);
    assert.deepEqual(local, before);
    assert.deepEqual(f.sent.map(row => row.request.action), action === 'pause' ? ['pause-support', 'pause'] : ['status']);
    result.resolve();
    const reply = await pending;
    if (action === 'pause') assert.equal(reply.outcome, 'requested');
    else assert.deepEqual(reply, { state: 'ready', generation });
  });
}

test('permission removal during asynchronous startup prevents the port and demand', async () => {
  for (const stage of ['attempt', 'restore', 'permission']) {
    const f = extension({ optedIn: true });
    if (stage === 'attempt') {
      const set = f.api.storage.session.set;
      f.api.storage.session.set = async value => { await set(value); f.revoke(); };
    } else if (stage === 'restore') {
      const get = f.api.storage.local.get;
      f.api.storage.local.get = async key => { const result = await get(key); f.revoke(); return result; };
    } else {
      f.api.permissions.contains = async () => { f.revoke(); return true; };
    }
    bindAdministratorBrowser(f.api);
    await f.start();
    assert.deepEqual(f.ports, []);
    assert.deepEqual(f.sent, []);
  }
});

test('storage failure is terminal before connecting and is not retried by startup events', async () => {
  for (const [area, method] of [['session', 'get'], ['session', 'set'], ['local', 'get']]) {
    const f = extension({ optedIn: true });
    let calls = 0;
    f.api.storage[area][method] = async () => { calls++; throw new Error('storage unavailable'); };
    bindAdministratorBrowser(f.api);
    await f.start();
    await f.grant();
    await f.start();
    assert.equal(calls, 1);
    assert.deepEqual(f.ports, []);
    assert.deepEqual(f.sent, []);
  }
});

test('connect or post failure closes any owned port and never retries or falls back to one-shot wake', async () => {
  for (const stage of ['connect', 'post']) {
    const f = extension({ optedIn: true });
    const connect = f.api.runtime.connectNative;
    let connections = 0;
    f.api.runtime.connectNative = host => {
      connections++;
      if (stage === 'connect') throw new Error('host unavailable');
      const port = connect(host);
      port.postMessage = () => { throw new Error('port unavailable'); };
      return port;
    };
    bindAdministratorBrowser(f.api);
    await f.start();
    await f.grant();
    await f.start();
    assert.equal(connections, 1);
    assert.equal(f.saved[sessionWakeKey], true);
    if (stage === 'post') assert.equal(f.ports[0].disconnected, true);
    assert.deepEqual(f.sent, []);
  }
});

test('missing retained-port API does not add a legacy wake or disable one-shot Status and Pause', async () => {
  const f = extension({ optedIn: true });
  delete f.api.runtime.connectNative;
  const controller = bindAdministratorBrowser(f.api);
  await f.start();
  assert.deepEqual(f.sent, []);
  f.response(request => request.action === 'pause-support' ? supportReply(request) :
    request.action === 'pause' ? pauseReply(request, 'requested') : { ...request, state: 'ready', generation });
  assert.deepEqual(await controller.handleMessage(message, sender), { state: 'ready', generation });
  assert.equal((await controller.handleMessage(initiatePause, sender)).outcome, 'requested');
  assert.deepEqual(f.sent.map(({ request }) => request.action), ['status', 'pause-support', 'pause']);
});

test('only the exact Devices page can read status; it cannot trigger wake or pass arguments', async () => {
  const f = extension(); const controller = bindAdministratorBrowser(f.api);
  for (const untrusted of [
    { ...sender, url: 'https://chatgpt.com/' }, { ...sender, frameId: 1 }, { ...sender, tab: { incognito: true } },
    { ...sender, url: sender.url + '&extra=1' }, { ...sender, id: 'b'.repeat(32) },
  ]) assert.equal(await controller.handleMessage(message, untrusted), null);
  assert.equal(await controller.handleMessage({ ...message, action: 'wake' }, sender), null);
  assert.deepEqual(f.sent, []);
  f.response(request => ({ ...request, state: 'ready', generation }));
  assert.deepEqual(await controller.handleMessage(message, sender), { state: 'ready', generation });
  assert.equal(f.sent[0].request.action, 'status');
  f.response(request => ({ ...request, outcome: 'requested' }));
  assert.equal(await controller.handleMessage(message, sender), null);
  f.response(request => ({ ...request, state: 'ready', generation: 'stale' }));
  assert.equal(await controller.handleMessage(message, sender), null);
  f.response(request => { f.revoke(); return { ...request, state: 'ready', generation }; });
  assert.equal(await controller.handleMessage(message, sender), null);
});

test('browser pause receipt reads require the exact message, Devices sender, platform and permission', async () => {
  const f = extension(); const controller = bindAdministratorBrowser(f.api);
  const rejected = [
    [{ type: pauseMessage.type }, sender],
    [{ ...pauseMessage, path: 'stager.ps1' }, sender],
    ...invalidOperationIds.map(operationId => [{ ...pauseMessage, operationId }, sender]),
    ...[
      { ...sender, url: 'https://chatgpt.com/' }, { ...sender, frameId: 1 },
      { ...sender, tab: { incognito: true } }, { ...sender, id: 'b'.repeat(32) },
      { ...sender, url: sender.url + '&extra=1' },
    ].map(untrusted => [pauseMessage, untrusted]),
  ];
  for (const [request, from] of rejected) assert.equal(await controller.handleMessage(request, from), null);
  assert.deepEqual(f.sent, []);
  for (const options of [{ permission: false }, { os: 'linux' }]) {
    const denied = extension(options);
    assert.equal(await bindAdministratorBrowser(denied.api).handleMessage(pauseMessage, sender), null);
    assert.deepEqual(denied.sent, []);
  }
  assert.equal(ADMIN_BROWSER_PAUSE_STATUS, pauseMessage.type);
  f.response(request => ({ ...request, state: 'pause-recorded' }));
  assert.deepEqual(await controller.handleMessage(pauseMessage, { ...sender, frameId: 0 }),
    { operationId, state: 'pause-recorded' });
  const { id } = f.sent[0].request;
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(f.sent, [{ host: ADMIN_BROWSER_HOST, request: { ...pauseRequest, id } }]);
});

test('browser correlates concurrent pause receipt reads and does not cache a receipt', async () => {
  const f = extension(); const controller = bindAdministratorBrowser(f.api);
  const queued = Promise.withResolvers(), replies = new Map();
  f.response(request => new Promise(resolve => {
    replies.set(request.operationId, state => resolve({ ...request, state }));
    if (replies.size === 2) queued.resolve();
  }));
  const first = controller.handleMessage(pauseMessage, sender);
  const second = controller.handleMessage({ ...pauseMessage, operationId: otherOperationId }, sender);
  const sent = await Promise.race([queued.promise.then(() => true), first.then(() => false), second.then(() => false)]);
  assert.equal(sent, true);
  replies.get(otherOperationId)('stopped');
  assert.deepEqual(await second, { operationId: otherOperationId, state: 'stopped' });
  replies.get(operationId)('pause-recorded');
  assert.deepEqual(await first, { operationId, state: 'pause-recorded' });
  f.response(request => ({ ...request, state: 'unconfirmed' }));
  assert.deepEqual(await controller.handleMessage(pauseMessage, sender), { operationId, state: 'unconfirmed' });
  assert.equal(new Set(f.sent.map(({ request }) => request.id)).size, 3);
});

test('browser rejects uncorrelated or malformed pause replies and does not retry', async () => {
  const f = extension(); const controller = bindAdministratorBrowser(f.api);
  for (const override of [
    { version: 2 }, { id: 'wrong' }, { action: 'status' }, { operationId: otherOperationId },
    { state: 'ready' }, { state: null }, { generation },
  ]) {
    f.response(request => ({ ...request, state: 'stopped', ...override }));
    assert.equal(await controller.handleMessage(pauseMessage, sender), null);
  }
  assert.equal(f.sent.length, 7);
  f.response(() => { throw new Error('bridge unavailable'); });
  assert.equal(await controller.handleMessage(pauseMessage, sender), null);
  assert.equal(f.sent.length, 8);
  f.response(request => { f.revoke(); return { ...request, state: 'stopped' }; });
  assert.equal(await controller.handleMessage(pauseMessage, sender), null);
  assert.equal(f.sent.length, 9);
});

test('administrator Pause stores one ID before dispatch and never replays it across workers', async () => {
  const local = {}, f = extension({ local }), controller = bindAdministratorBrowser(f.api);
  for (const [request, from] of [[{ ...initiatePause, operationId }, sender], [{ ...initiatePause, target: pauseTarget }, sender],
    [initiatePause, { ...sender, frameId: 1 }], [initiatePause, { ...sender, url: 'https://chatgpt.com/' }]]) {
    assert.equal(await controller.handleMessage(request, from), null);
  }
  assert.deepEqual(f.sent, []);
  f.response(request => {
    if (request.action === 'pause-support') return supportReply(request);
    assert.deepEqual(local[lastPauseKey], { operationId: request.operationId, outcome: 'unconfirmed' });
    if (request.action === 'pause') throw new Error('lost reply');
    return { ...request, state: 'unconfirmed' };
  });
  const [a, b] = await Promise.all([controller.handleMessage(initiatePause, sender), controller.handleMessage(initiatePause, sender)]);
  assert.deepEqual(a, b);
  assert.deepEqual(a, local[lastPauseKey]);
  assert.match(a.operationId, /^[a-f0-9]{32}$/);
  assert.deepEqual(f.sent[1].request,
    { version: 1, id: f.sent[1].request.id, action: 'pause', operationId: a.operationId, target: pauseTarget });
  assert.deepEqual(await bindAdministratorBrowser(f.api).handleMessage(initiatePause, sender), a);
  assert.deepEqual(f.sent.map(x => x.request.action), ['pause-support', 'pause', 'pause-status']);
});

test('administrator Pause permits a fresh explicit action only after cancellation or a receipt that consumes the old ID', async () => {
  const local = {}, f = extension({ local }), controller = bindAdministratorBrowser(f.api);
  f.response(request => request.action === 'pause-support' ? supportReply(request) : pauseReply(request, 'cancelled'));
  const first = await controller.handleMessage(initiatePause, sender);
  assert.equal(first.outcome, 'cancelled');
  f.response(request => request.action === 'pause-support' ? supportReply(request) :
    pauseReply(request, request.action === 'pause-status' ? 'unconfirmed' : 'requested'));
  const second = await controller.handleMessage(initiatePause, sender);
  assert.equal(second.outcome, 'requested');
  assert.notEqual(first.operationId, second.operationId);
  assert.deepEqual(await controller.handleMessage(initiatePause, sender), second);
  for (const state of ['stopped', 'fenced', 'superseded', 'pause-recorded']) {
    const previous = local[lastPauseKey];
    f.response(request => request.action === 'pause-support' ? { ...supportReply(request), target: idleTarget } :
      pauseReply(request, request.action === 'pause-status' ?
        (request.operationId === previous.operationId ? state : 'unconfirmed') : 'requested'));
    const historical = { ...pauseMessage, operationId: previous.operationId };
    assert.deepEqual(await controller.handleMessage(historical, sender), { operationId: previous.operationId, state });
    assert.deepEqual(local[lastPauseKey], previous);
    const fresh = await controller.handleMessage(initiatePause, sender);
    assert.notEqual(fresh.operationId, previous.operationId);
    assert.equal(fresh.outcome, 'requested');
    assert.equal(f.sent.at(-1).request.target, idleTarget);
    assert.deepEqual(await controller.handleMessage(historical, sender), { operationId: previous.operationId, state });
    assert.deepEqual(local[lastPauseKey], fresh);
  }
  assert.deepEqual(f.sent.map(x => x.request.action), ['pause-support', 'pause', 'pause-support', 'pause', 'pause-status',
    ...Array.from({ length: 4 }, () => ['pause-status', 'pause-status', 'pause-support', 'pause', 'pause-status']).flat()]);
});

test('an older bridge or a revoked permission cannot cause a Pause submission', async () => {
  const local = {}, f = extension({ local }), controller = bindAdministratorBrowser(f.api);
  f.response(() => { throw new Error('old bridge'); });
  assert.equal(await controller.handleMessage(initiatePause, sender), null);
  assert.equal(local[lastPauseKey], undefined);
  f.response(request => { f.revoke(); return supportReply(request); });
  assert.equal(await controller.handleMessage(initiatePause, sender), null);
  assert.equal(local[lastPauseKey], undefined);
  assert.deepEqual(f.sent.map(x => x.request.action), ['pause-support', 'pause-support']);
});

test('permission removal after persisting the ID but before dispatch preserves the prior record', async () => {
  const prior = { operationId, outcome: 'cancelled' }, local = { [lastPauseKey]: prior };
  const f = extension({ local }), controller = bindAdministratorBrowser(f.api);
  f.response(supportReply);
  const set = f.api.storage.local.set;
  f.api.storage.local.set = async value => {
    await set(value);
    if (value[lastPauseKey].outcome === 'unconfirmed') f.revoke();
  };
  assert.equal(await controller.handleMessage(initiatePause, sender), null);
  assert.deepEqual(local[lastPauseKey], prior);
  assert.deepEqual(f.sent.map(x => x.request.action), ['pause-support']);
});

test('browser rejects a missing, malformed, uncorrelated or extra-field pause target before persisting', async () => {
  const local = {}, f = extension({ local }), controller = bindAdministratorBrowser(f.api);
  for (const reply of [
    request => ({ ...request, state: 'supported' }),
    ...invalidTargets.map(target => request => ({ ...supportReply(request), target })),
    request => ({ ...supportReply(request), id: 'another-id' }),
    request => ({ ...supportReply(request), action: 'status' }),
    request => ({ ...supportReply(request), operationId }),
  ]) {
    f.response(reply);
    assert.equal(await controller.handleMessage(initiatePause, sender), null);
    assert.equal(local[lastPauseKey], undefined);
  }
  assert.ok(f.sent.length > 0 && f.sent.every(({ request }) => request.action === 'pause-support'));
});

test('browser reconcile requires the exact current durable operation and trusted Devices sender', async () => {
  const previous = { operationId, outcome: 'requested' }, local = { [lastPauseKey]: previous };
  const f = extension({ local }), controller = bindAdministratorBrowser(f.api);
  for (const [request, from] of [
    [{ type: reconcileMessage.type }, sender],
    [{ ...reconcileMessage, operationId: otherOperationId }, sender],
    [{ ...reconcileMessage, target: pauseTarget }, sender],
    [{ ...reconcileMessage, action: 'pause' }, sender],
    ...invalidOperationIds.map(operationId => [{ ...reconcileMessage, operationId }, sender]),
    ...[{ ...sender, frameId: 1 }, { ...sender, frameId: undefined, tab: { id: 1 } }, { ...sender, tab: { incognito: true } },
      { ...sender, url: origin + 'devices.html' }, { ...sender, id: 'c'.repeat(32) }]
      .map(from => [reconcileMessage, from]),
  ]) assert.equal(await controller.handleMessage(request, from), null);
  assert.deepEqual(f.sent, []);
  for (const saved of [undefined, { ...previous, outcome: 'cancelled' }, { ...previous, target: pauseTarget }]) {
    local[lastPauseKey] = saved;
    assert.equal(await controller.handleMessage(reconcileMessage, sender), null);
  }
  local[lastPauseKey] = previous;
  for (const options of [{ permission: false }, { os: 'linux' }]) {
    const denied = extension({ local, ...options });
    assert.equal(await bindAdministratorBrowser(denied.api).handleMessage(reconcileMessage, sender), null);
    assert.deepEqual(denied.sent, []);
  }
  assert.deepEqual(f.sent, []);
  for (const state of ['stopped', 'fenced', 'superseded', 'not-a-receipt']) {
    f.response(request => ({ ...request, state }));
    assert.equal(await controller.handleMessage(reconcileMessage, sender), null);
  }
  assert.deepEqual(f.sent.map(({ request }) => request.action), Array(4).fill('pause-status'));
  assert.deepEqual(local[lastPauseKey], previous);
});

test('browser does not submit a fence when the protected Pause is already recorded', async () => {
  const previous = { operationId, outcome: 'requested' }, local = { [lastPauseKey]: previous };
  const f = extension({ local }), controller = bindAdministratorBrowser(f.api);
  f.response(request => ({ ...request, state: 'pause-recorded' }));
  assert.equal(await controller.handleMessage(reconcileMessage, sender), null);
  assert.deepEqual(f.sent.map(({ request }) => request.action), ['pause-status']);
  assert.deepEqual(local[lastPauseKey], previous);
});

test('Devices popup can reconcile its exact Pause without tab-only frame metadata', async () => {
  const previous = { operationId, outcome: 'unconfirmed' }, local = { [lastPauseKey]: previous };
  const f = extension({ local }), controller = bindAdministratorBrowser(f.api);
  f.response(request => ({ ...request, state: request.action === 'pause-status' ? 'unconfirmed' : 'requested' }));
  assert.deepEqual(await controller.handleMessage(reconcileMessage, { id: extensionId, url: sender.url }),
    { operationId, outcome: 'requested' });
  assert.deepEqual(f.sent.map(({ request }) => request.action), ['pause-status', 'pause-reconcile']);
  assert.deepEqual(local[lastPauseKey], previous);
});

test('browser serializes explicit fence with Pause, preserves the previous record, and does not retry', async () => {
  const previous = { operationId, outcome: 'unconfirmed' }, local = { [lastPauseKey]: previous };
  const f = extension({ local }), controller = bindAdministratorBrowser(f.api);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  f.response(async request => {
    if (request.action === 'pause-status') return { ...request, state: 'unconfirmed' };
    assert.deepEqual(request, { ...reconcileRequest, id: request.id });
    entered.resolve();
    await release.promise;
    throw new Error('fence reply lost');
  });
  const first = controller.handleMessage(reconcileMessage, { ...sender, tab: { id: 1 }, frameId: 0 });
  assert.equal(await Promise.race([entered.promise.then(() => true), first.then(() => false)]), true);
  const duplicate = controller.handleMessage(reconcileMessage, { ...sender, tab: { id: 2 }, frameId: 0 });
  const racingPause = controller.handleMessage(initiatePause, sender);
  release.resolve();
  assert.deepEqual(await first, { operationId, outcome: 'unconfirmed' });
  assert.deepEqual(await duplicate, await first);
  assert.equal(await racingPause, null);
  assert.deepEqual(f.sent.map(({ request }) => request.action), ['pause-status', 'pause-reconcile']);
  assert.deepEqual(local[lastPauseKey], previous);
  const restarted = bindAdministratorBrowser(f.api);
  await f.start();
  assert.equal(f.sent.length, 2);
  f.response(request => ({ ...request, state: request.action === 'pause-status' ? 'unconfirmed' : 'requested' }));
  assert.deepEqual(await restarted.handleMessage(reconcileMessage, sender), { operationId, outcome: 'requested' });
  assert.deepEqual(local[lastPauseKey], previous);
  assert.deepEqual(f.sent.map(({ request }) => request.action), ['pause-status', 'pause-reconcile', 'pause-status', 'pause-reconcile']);
  f.response(request => ({ ...request, state: request.action === 'pause-status' ? 'unconfirmed' : 'cancelled' }));
  assert.deepEqual(await restarted.handleMessage(reconcileMessage, sender), { operationId, outcome: 'cancelled' });
  assert.deepEqual(local[lastPauseKey], previous);
  assert.deepEqual(await restarted.handleMessage(initiatePause, sender), previous,
    'cancelling the fence is not cancellation of the original Pause');
  assert.deepEqual(f.sent.slice(4).map(({ request }) => request.action), ['pause-status', 'pause-reconcile', 'pause-status']);
});

test('browser rejects malformed fence replies and fences nothing after permission removal', async () => {
  const previous = { operationId, outcome: 'requested' }, local = { [lastPauseKey]: previous };
  const f = extension({ local }), controller = bindAdministratorBrowser(f.api);
  for (const override of [{ operationId: otherOperationId }, { state: 'fenced' }, { state: 'stopped' },
    { id: 'wrong' }, { action: 'pause' }, { target: pauseTarget }]) {
    f.response(request => request.action === 'pause-status' ? { ...request, state: 'unconfirmed' } :
      { ...request, state: 'requested', ...override });
    assert.deepEqual(await controller.handleMessage(reconcileMessage, sender), { operationId, outcome: 'unconfirmed' });
  }
  f.response(request => { f.revoke(); return { ...request, state: 'unconfirmed' }; });
  assert.equal(await controller.handleMessage(reconcileMessage, sender), null);
  assert.deepEqual(f.sent.map(({ request }) => request.action),
    [...Array.from({ length: 6 }, () => ['pause-status', 'pause-reconcile']).flat(), 'pause-status']);
  assert.deepEqual(local[lastPauseKey], previous);
});

test('browser does not fence if the durable record changes during receipt readback', async () => {
  const local = { [lastPauseKey]: { operationId, outcome: 'unconfirmed' } };
  const f = extension({ local }), controller = bindAdministratorBrowser(f.api);
  const replacement = { operationId: otherOperationId, outcome: 'requested' };
  f.response(request => {
    if (request.action === 'pause-status') local[lastPauseKey] = replacement;
    return { ...request, state: 'unconfirmed' };
  });
  assert.equal(await controller.handleMessage(reconcileMessage, sender), null);
  assert.deepEqual(f.sent.map(({ request }) => request.action), ['pause-status']);
  assert.deepEqual(local[lastPauseKey], replacement);
});

async function framed(request, { args = [origin, '--parent-window=0'], ...actions } = {}) {
  const input = new PassThrough(), output = new PassThrough();
  await writeFrame(input, request);
  await serveAdministratorBrowser({ input, output, args, origin, ...actions });
  return readFrame(output);
}

test('native session dispatches only wake and stdin, acknowledges attachment exactly, and retains until finished', async t => {
  for (const wake of [false, true]) {
    const input = new PassThrough(), output = new PassThrough(), finished = Promise.withResolvers();
    const request = { version: 1, action: 'session', id: 'session-' + wake, wake };
    let settled = false, closes = 0;
    const calls = [];
    await writeFrame(input, request);
    const unexpected = () => assert.fail('one-shot action during a retained session');
    const serving = serveAdministratorBrowser({ input, output, args: [origin], origin,
      start: unexpected, readStatus: unexpected, requestPause: unexpected,
      openSession(...args) {
        calls.push(args);
        return { isLive: () => true, finished: finished.promise, async close() { closes++; } };
      } }).then(() => { settled = true; });
    t.after(async () => { finished.resolve(); await serving; input.destroy(); output.destroy(); });
    assert.deepEqual(await readFrame(output), { version: 1, action: 'session', id: request.id, outcome: 'attached' });
    assert.deepEqual(calls, [[wake, input]]);
    assert.equal(settled, false);
    assert.equal(closes, 0);
    finished.resolve();
    await serving;
    assert.equal(closes, 1);
  }
});

test('injected native session follows stdin EOF, close and error into retained completion and cleanup', async t => {
  for (const loss of ['end', 'close', 'error']) {
    const input = new PassThrough(), output = new PassThrough(), finished = Promise.withResolvers();
    const request = { version: 1, action: 'session', id: 'input-' + loss, wake: false };
    let live = true, closes = 0;
    await writeFrame(input, request);
    const serving = serveAdministratorBrowser({ input, output, args: [origin], origin,
      openSession(_wake, stream) {
        const end = () => { live = false; finished.resolve(); };
        stream.once('end', end); stream.once('close', end); stream.once('error', end);
        stream.resume();
        return { isLive: () => live, finished: finished.promise, async close() { closes++; } };
      } });
    t.after(async () => { finished.resolve(); await serving; input.destroy(); output.destroy(); });
    assert.deepEqual(await readFrame(output), { version: 1, action: 'session', id: request.id, outcome: 'attached' });
    if (loss === 'end') input.end();
    else input.destroy(loss === 'error' ? new Error('fixture input failure') : undefined);
    await serving;
    assert.equal(live, false);
    assert.equal(closes, 1);
  }
});

test('missing or failed native session action returns only an unconfirmed acknowledgment without legacy fallback', async () => {
  const request = { version: 1, action: 'session', id: 'unavailable-session', wake: true };
  let starts = 0, reads = 0, opens = 0;
  const actions = { start() { starts++; }, readStatus() { reads++; } };
  for (const openSession of [undefined, () => { opens++; throw new Error('helper unavailable'); }]) {
    assert.deepEqual(await framed(request, { ...actions, openSession }),
      { version: 1, action: 'session', id: request.id, outcome: 'unconfirmed' });
  }
  assert.deepEqual([starts, reads, opens], [0, 0, 1]);
});

test('native session rejects missing, nonboolean and additional request fields before any action', async () => {
  const request = { version: 1, action: 'session', id: 'closed-session-request', wake: false };
  const { wake: _wake, ...missing } = request;
  let calls = 0;
  const unexpected = () => { calls++; throw new Error('unexpected dispatch'); };
  for (const malformed of [missing,
    ...[null, 0, 1, 'true', [], {}].map(wake => ({ ...request, wake })),
    ...[{ command: 'anything' }, { generation }, { target: pauseTarget }, { operationId }, { state: 'ready' }]
      .map(extra => ({ ...request, ...extra })),
  ]) {
    await assert.rejects(framed(malformed, { start: unexpected, readStatus: unexpected, openSession: unexpected }), /browser_request/);
  }
  assert.equal(calls, 0);
});

test('one-shot host refuses foreign origins and malformed requests without invoking either action', async () => {
  const status = { version: 1, id: 'test-1', action: 'status' };
  const unexpected = () => assert.fail('unexpected executor call');
  for (const args of [['https://chatgpt.com/'], [origin, '--parent-window=anything'], [origin, '--parent-window=0', 'extra']]) {
    await assert.rejects(framed(status, { args, start: unexpected, readStatus: unexpected }), /browser_origin/);
  }
  for (const request of [{ ...status, command: 'anything' }, { ...status, action: 'reconnect' }, { ...status, id: {} }]) {
    await assert.rejects(framed(request, { start: unexpected, readStatus: unexpected }), /browser_request/);
  }
});

test('native pause request accepts a correlated launch or cancellation and invokes only the fixed broker', async () => {
  const request = { ...pauseRequest, action: 'pause', target: pauseTarget };
  const calls = [];
  let receipt = { operationId, state: 'requested' };
  const actions = createAdministratorBrowserActions(root, binding, async (...call) => {
    calls.push(call); return { stdout: JSON.stringify(receipt) };
  });
  for (const malformed of [{ ...pauseRequest, action: 'pause' }, { ...request, command: 'not allowed' },
    ...invalidTargets.map(target => ({ ...request, target }))]) {
    await assert.rejects(framed(malformed, actions), /browser_request/);
  }
  for (const target of invalidTargets) await assert.rejects(actions.requestPause(operationId, target));
  assert.deepEqual(calls, []);
  assert.deepEqual(await framed(request, actions), pauseReply(request, 'requested'));
  receipt = { operationId, state: 'cancelled' };
  assert.deepEqual(await framed(request, actions), pauseReply(request, 'cancelled'));
  receipt = { operationId: otherOperationId, state: 'cancelled' };
  assert.deepEqual(await framed(request, actions), pauseReply(request, 'unconfirmed'));
  receipt = { operationId, state: 'stopped' };
  assert.deepEqual(await framed(request, actions), pauseReply(request, 'unconfirmed'));
  assert.equal(calls.length, 4);
  assert.ok(calls.every(([file, args, options]) => file === binding.systemDirectory + '\\WindowsPowerShell\\v1.0\\powershell.exe' &&
    args.join('|') === ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', root + '.browser\\stager.ps1',
      '-Action', 'RequestBrowserHostedOwnerPause', '-Archive', root + '.browser\\bundle.zip', '-ExpectedSha256', digest,
      '-PauseOperationId', operationId, '-BrowserPauseTarget', pauseTarget].join('|') && options.windowsHide && !options.shell));
});

test('native preflight publishes only the exact validated target from the fixed read-only broker', async () => {
  const { operationId: _unused, ...request } = { ...pauseRequest, action: 'pause-support' };
  const calls = [];
  let reply;
  const actions = createAdministratorBrowserActions(root, binding, async (...call) => {
    calls.push(call); return { stdout: JSON.stringify(reply) };
  });
  await assert.rejects(framed({ ...request, target: pauseTarget }, actions), /browser_request/);
  for (const target of [pauseTarget, idleTarget]) {
    reply = { state: 'supported', target };
    assert.deepEqual(await framed(request, actions), { ...request, ...reply });
  }
  for (const invalid of [{ state: 'supported' }, true, { state: 'unconfirmed', target: pauseTarget },
    { state: 'supported', target: pauseTarget, path: 'private' },
    ...invalidTargets.map(target => ({ state: 'supported', target }))]) {
    reply = invalid;
    assert.deepEqual(await framed(request, actions), { ...request, state: 'unconfirmed' });
  }
  assert.equal(calls.length, 6 + invalidTargets.length);
  assert.ok(calls.every(([, args]) => args.slice(5).join('|') === [
    '-Action', 'CheckBrowserHostedOwnerPause', '-Archive', root + '.browser\\bundle.zip', '-ExpectedSha256', digest,
  ].join('|')));
});

test('native reconcile accepts only a fixed correlated fence action and never retries', async () => {
  const calls = [];
  let receipt;
  const actions = createAdministratorBrowserActions(root, binding, async (...call) => {
    calls.push(call);
    if (!receipt) throw new Error('lost fence reply');
    return { stdout: JSON.stringify(receipt) };
  });
  for (const malformed of [{ version: 1, id: reconcileRequest.id, action: reconcileRequest.action },
    { ...reconcileRequest, command: 'Wake' }, { ...reconcileRequest, target: pauseTarget },
    ...invalidOperationIds.map(operationId => ({ ...reconcileRequest, operationId }))]) {
    await assert.rejects(framed(malformed, actions), /browser_request/);
  }
  assert.deepEqual(calls, []);
  const cases = [
    ...['requested', 'cancelled', 'unconfirmed'].map(state => [{ operationId, state }, state]),
    [{ operationId: otherOperationId, state: 'requested' }, 'unconfirmed'],
    [{ operationId, state: 'requested', target: pauseTarget }, 'unconfirmed'],
    ...['fenced', 'superseded', 'stopped', 'pause-recorded'].map(state => [{ operationId, state }, 'unconfirmed']),
    [null, 'unconfirmed'],
  ];
  for (const [value, state] of cases) {
    receipt = value;
    assert.deepEqual(await framed(reconcileRequest, actions), { ...reconcileRequest, state });
  }
  assert.equal(calls.length, cases.length);
  assert.ok(calls.every(([file, args, options]) => file === binding.systemDirectory + '\\WindowsPowerShell\\v1.0\\powershell.exe' &&
    args.join('|') === ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', root + '.browser\\stager.ps1',
      '-Action', 'RequestBrowserHostedOwnerPauseFence', '-Archive', root + '.browser\\bundle.zip', '-ExpectedSha256', digest,
      '-PauseOperationId', operationId].join('|') && options.windowsHide && !options.shell));
});

test('native one-shot status and injected legacy wake remain separate from session acknowledgments', async () => {
  let starts = 0, reads = 0;
  const status = { version: 1, id: 'test-2', action: 'status' };
  const wake = { ...status, action: 'wake' };
  const actions = { start: async () => { starts++; }, readStatus: async () => { reads++; return { state: 'ready', generation }; } };
  assert.deepEqual(await framed(status, actions), { ...status, state: 'ready', generation });
  assert.deepEqual([starts, reads], [0, 1]);
  assert.deepEqual(await framed(wake, actions), { ...wake, outcome: 'requested' });
  assert.deepEqual([starts, reads], [1, 1]);
  const failed = { ...actions, start: async () => { starts++; throw new Error('unknown'); } };
  assert.deepEqual(await framed(wake, failed), { ...wake, outcome: 'unconfirmed' });
  assert.deepEqual([starts, reads], [2, 1]);
  assert.deepEqual(await framed(status, { readStatus: () => ({ state: 'ready', generation, key: 'unexpected' }) }),
    { ...status, state: 'unobserved', generation: null });
});

test('native pause receipt reads reject malformed requests before dispatch', async () => {
  let calls = 0;
  const unexpected = () => { calls++; };
  const actions = { start: unexpected, readStatus: unexpected, readPauseStatus: unexpected };
  await assert.rejects(framed(pauseRequest, { ...actions, args: ['https://chatgpt.com/'] }), /browser_origin/);
  for (const request of [{ version: 1, id: pauseRequest.id, action: 'pause-status' }, { ...pauseRequest, archive: 'arbitrary.zip' },
    { ...pauseRequest, action: 'status' }, { ...pauseRequest, action: 'wake' },
    ...invalidOperationIds.map(operationId => ({ ...pauseRequest, operationId })),
  ]) await assert.rejects(framed(request, actions), /browser_request/);
  assert.equal(calls, 0);
});

test('native pause receipt reads only return exact correlated receipts, without wake or retry', async () => {
  let starts = 0, statusReads = 0;
  const pauseReads = [];
  const actions = { start: () => { starts++; }, readStatus: () => { statusReads++; } };
  for (const [receipt, state] of [
    [{ operationId, state: 'pause-recorded' }, 'pause-recorded'],
    [{ operationId, state: 'stopped' }, 'stopped'],
    [{ operationId, state: 'fenced' }, 'fenced'],
    [{ operationId, state: 'superseded' }, 'superseded'],
    [{ operationId, state: 'unconfirmed' }, 'unconfirmed'],
    [{ operationId, state: 'ready' }, 'unconfirmed'],
    [{ operationId: otherOperationId, state: 'stopped' }, 'unconfirmed'],
    [{ operationId, state: 'stopped', sid: 'unexpected' }, 'unconfirmed'],
    [null, 'unconfirmed'],
  ]) {
    assert.deepEqual(await framed(pauseRequest, { ...actions, readPauseStatus: id => {
      pauseReads.push(id);
      if (!receipt) throw new Error('unknown');
      return receipt;
    } }), { ...pauseRequest, state });
  }
  assert.deepEqual(pauseReads, Array(9).fill(operationId));
  assert.deepEqual([starts, statusReads], [0, 0]);
});

test('pause adapter uses the fixed read-only stager and validates its input and output', async () => {
  const calls = [];
  let stdout = JSON.stringify({ operationId, state: 'stopped' });
  const actions = createAdministratorBrowserActions(root, binding, async (...call) => {
    calls.push(call); return { stdout };
  });
  for (const id of invalidOperationIds) await assert.rejects(actions.readPauseStatus(id));
  assert.deepEqual(calls, []);
  assert.deepEqual(await actions.readPauseStatus(operationId), { operationId, state: 'stopped' });
  assert.deepEqual(calls, [[binding.systemDirectory + '\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', root + '.browser\\stager.ps1',
      '-Action', 'ObserveHostedOwnerPause', '-Archive', root + '.browser\\bundle.zip', '-ExpectedSha256', digest,
      '-PauseOperationId', operationId],
    { cwd: binding.systemDirectory, windowsHide: true, timeout: 3200, maxBuffer: 2048,
      env: { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', PATH: binding.systemDirectory } }]]);
  for (const invalid of ['not JSON', JSON.stringify({ operationId, state: 'stopped', path: 'private' }),
    JSON.stringify({ operationId: otherOperationId, state: 'stopped' }), JSON.stringify({ operationId, state: 'ready' })]) {
    stdout = invalid;
    await assert.rejects(actions.readPauseStatus(operationId));
  }
  assert.equal(calls.length, 5);
});

test('browser pause receipt round trip crosses the native frame without reporting current status', async () => {
  const f = extension(); const controller = bindAdministratorBrowser(f.api);
  const calls = [];
  const actions = createAdministratorBrowserActions(root, binding, async (_file, args) => {
    calls.push(args);
    if (calls.length === 1) return { stdout: JSON.stringify({ operationId, state: 'stopped' }) };
    throw new Error('observation unavailable');
  });
  f.response(request => framed(request, actions));
  assert.deepEqual(await controller.handleMessage(pauseMessage, sender), { operationId, state: 'stopped' });
  assert.deepEqual(await controller.handleMessage({ ...pauseMessage, operationId: otherOperationId }, sender),
    { operationId: otherOperationId, state: 'unconfirmed' });
  assert.deepEqual(calls.map(args => args.slice(5)), [operationId, otherOperationId].map(id => [
    '-Action', 'ObserveHostedOwnerPause', '-Archive', root + '.browser\\bundle.zip', '-ExpectedSha256', digest, '-PauseOperationId', id,
  ]));
});

test('action adapters refuse legacy start and keep read-only enrolled paths without shell or inherited environment', async () => {
  const calls = [];
  const actions = createAdministratorBrowserActions(root, binding, async (...call) => {
    calls.push(call); return { stdout: '{"state":"unobserved","generation":null}' };
  });
  await assert.rejects(actions.start(), { message: 'administrator_browser_session_required' });
  assert.deepEqual(calls, []);
  const wake = { version: 1, id: 'legacy-wake-refused', action: 'wake' };
  assert.deepEqual(await framed(wake, actions), { ...wake, outcome: 'unconfirmed' });
  assert.deepEqual(calls, []);
  await actions.readStatus();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], binding.systemDirectory + '\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(calls[0][1], ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', root + '.browser\\stager.ps1',
    '-Action', 'ObserveHostedOwner', '-Archive', root + '.browser\\bundle.zip', '-ExpectedSha256', digest]);
  assert.deepEqual(Object.keys(calls[0][2].env), ['SystemRoot', 'WINDIR', 'PATH']);
  assert.equal(calls[0][2].windowsHide, true);
  assert.throws(() => createAdministratorBrowserActions(root, { ...binding, taskName: 'override' }), /invalid_administrator_browser_binding/);
});

test('real Windows stager reports unobserved reads and refuses a Pause from an unsealed fixture',
  { skip: process.platform !== 'win32' || process.arch !== 'x64' }, async t => {
    const scratch = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'ac-admin-browser-status-'));
    t.after(() => fs.rm(scratch, { recursive: true, force: true }));
    const bundleSha256 = (randomUUID() + randomUUID()).replaceAll('-', '');
    const target = path.join(scratch, bundleSha256.slice(0, 24)), bridge = target + '.browser';
    await fs.mkdir(bridge);
    await fs.copyFile(new URL('../scripts/Stage-WindowsAdministratorBundle.ps1', import.meta.url), path.join(bridge, 'stager.ps1'));
    const actions = createAdministratorBrowserActions(target, { ...binding, bundleSha256, systemDirectory: path.join(process.env.SystemRoot, 'System32') });
    assert.deepEqual(await actions.readStatus(), { state: 'unobserved', generation: null });
    const operationId = randomUUID().replaceAll('-', '');
    assert.deepEqual(await actions.readPauseStatus(operationId), { operationId, state: 'unconfirmed' });
    await assert.rejects(actions.readPauseSupport(), /Command failed/);
    assert.deepEqual(await actions.requestPause(operationId, idleTarget), { operationId, state: 'unconfirmed' });
    assert.deepEqual(await fs.readdir(bridge), ['stager.ps1']);
  });
