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

function extension({ granted = true, os = 'win', attach = false, pauseAttach = false } = {}) {
  const attempts = [], messages = [], requests = [], stored = {}, results = [], attachments = [];
  const startup = event(), removed = event(), added = event(), alarmEvent = event();
  const alarms = new Map(), ports = [];
  let disconnected = 0;
  const api = {
    runtime: { id: 'a'.repeat(32), getURL: page => origin + page, onStartup: startup, getPlatformInfo: async () => ({ os }),
      connectNative(host) {
        const port = { onMessage: event(), onDisconnect: event(),
          disconnect() { disconnected++; },
          postMessage(message) { messages.push(message); requests.push(message); } };
        attempts.push(host); ports.push(port); return port;
      },
      sendNativeMessage(host, frame) {
        return new Promise((resolve, reject) => {
          attachments.push({ host, frame, resolve, reject });
          requests.push(frame.request);
          // Legacy unavailable-owner cases still forbid a fresh wake; successful attach is tested explicitly.
          if (!attach && !(pauseAttach && frame.request.action === 'disconnect-and-pause')) reject(new Error('synthetic-owner-unavailable'));
        });
      } },
    storage: { session: { async get(key) {
      return Object.fromEntries((Array.isArray(key) ? key : [key]).map(name => [name, structuredClone(stored[name])]));
    },
      async set(values) { Object.assign(stored, structuredClone(values)); },
      async remove(key) { delete stored[key]; } } },
    alarms: { onAlarm: alarmEvent, async create(name, options) { alarms.set(name, options); },
      async clear(name) { return alarms.delete(name); } },
    permissions: { contains: async () => granted, onRemoved: removed, onAdded: added },
  };
  return { api, attempts, messages, requests, results, attachments, get native() { return ports.at(-1); }, ports, alarms, startup, removed, added,
    alarm(name) { alarms.delete(name); alarmEvent.emit({ name }); },
    rebind() { alarmEvent.reset(); startup.reset(); removed.reset(); added.reset(); return bindBrowserWake(api); },
    setGrant(value) { granted = value; }, get disconnected() { return disconnected; } };
}

const devicesSender = f => ({ id: f.api.runtime.id, url: origin + BROWSER_DEVICE_PAGE, frameId: 0 });
const statusMessage = (id = 'install-status') => ({ type: BROWSER_DEVICE_MESSAGE, ownerId: null,
  request: { version: 1, id, action: 'status' } });
const OWNER = 'deviceBrowserWakeOwnerV1';
const MUTATION = 'deviceBrowserWakeMutationV1';
const PRIORITY_PAUSE = 'deviceBrowserWakePriorityPauseV1';
const mutationMessage = (f, request) => ({ type: BROWSER_DEVICE_MESSAGE, ownerId: f.messages[0].id, request });
const operationReply = (request, status, action = request.action) => ({ ...request, ok: true,
  state: { paused: status === 'settled' ? true : null, connection: 'disconnected',
    operation: { id: request.id, action, status } } });
const attachedReply = (call, status, action = call.frame.request.action) => ({ version: 2,
  action: 'attach-control', ownerId: call.frame.ownerId, response: operationReply(call.frame.request, status, action) });
// Pause moved to one-shot attach; keep receipt/fence assertions while targeting its new reply channel.
function replyControl(f, response) {
  const call = f.attachments.findLast(call => call.frame.request.id === response.id && call.frame.request.action === response.action);
  if (call) call.resolve({ version: 2, action: 'attach-control', ownerId: call.frame.ownerId, response });
  else f.native.onMessage.emit(response);
}

async function pendingReconnect(t, options = {}) {
  const f = extension({ attach: true, ...options }), wake = bindBrowserWake(f.api);
  t.after(() => f.native?.onDisconnect.emit());
  await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
  const request = { version: 1, id: 'primary-reconnect', action: 'reconnect' };
  const primary = wake.handleMessage(mutationMessage(f, request), devicesSender(f)); await tick();
  return { f, wake, request, primary, ownerId: f.messages[0].id };
}

const setupTuple={setupId:'a'.repeat(32),scope:'current-account',extensionId:'a'.repeat(32),bindingSha256:'b'.repeat(64)};
const setupOperation='12345678-1234-4234-8234-123456789abc';

test('setup hook uses the existing owner and generic receipt fence but sends an exact scoped native frame',async t=>{
  const f=extension(),wake=bindBrowserWake(f.api);
  t.after(()=>f.native?.onDisconnect.emit());await tick();f.native.onMessage.emit({...f.messages[0],ok:true});
  assert.equal(typeof wake.prepareSetupObserver,'function');assert.equal(typeof wake.connectFromSetup,'function');
  assert.equal(await wake.prepareSetupObserver(()=>true),true);
  const work=wake.connectFromSetup(setupTuple,setupOperation,()=>true);await tick();
  const wire=f.messages.at(-1);
  assert.deepEqual(wire,{version:1,id:setupOperation,action:'current-account-setup-connect',...setupTuple});
  assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION],{
    ownerId:f.messages[0].id,version:1,id:setupOperation,action:'reconnect'});
  const response={version:1,id:setupOperation,action:'reconnect',ok:true,state:{paused:false,connection:'ready',
    operation:{id:setupOperation,action:'reconnect',status:'settled'}}};
  f.native.onMessage.emit(response);assert.deepEqual((await work).response,response);
  assert.equal(await wake.connectFromSetup(setupTuple,setupOperation,()=>true),null);
  assert.equal(f.attempts.length,1);assert.equal(f.messages.filter(v=>v.action==='current-account-setup-connect').length,1);
});

test('current-account setup permit is invalidated synchronously by an explicit Pause intent',async t=>{
  const f=extension({pauseAttach:true});let paused=0;
  const wake=bindBrowserWake(f.api,{onPauseIntent:()=>paused++});
  t.after(()=>f.native?.onDisconnect.emit());await tick();f.native.onMessage.emit({...f.messages[0],ok:true});
  assert.equal(typeof wake.captureSetupPermit,'function');const permit=wake.captureSetupPermit();
  assert.equal(await wake.prepareSetupObserver(()=>true),true);
  const pause={version:1,id:'explicit-pause',action:'disconnect-and-pause'};
  const work=wake.handleMessage(mutationMessage(f,pause),devicesSender(f));await tick();
  assert.equal(permit(),false);assert.equal(paused,1);
  assert.equal(await wake.connectFromSetup(setupTuple,setupOperation,()=>true),null);
  const call=f.attachments.at(-1);call.resolve(attachedReply(call,'settled'));await work;
  assert.equal(f.messages.some(v=>v.action==='current-account-setup-connect'),false);
});

test('permission cycling during setup fence persistence prevents a late scoped native send',async t=>{
  const f=extension(),wake=bindBrowserWake(f.api);
  t.after(()=>f.native?.onDisconnect.emit());await tick();f.native.onMessage.emit({...f.messages[0],ok:true});
  assert.equal(typeof wake.prepareSetupObserver,'function');assert.equal(await wake.prepareSetupObserver(()=>true),true);
  const save=f.api.storage.session.set,pending=Promise.withResolvers();let storing=false;
  f.api.storage.session.set=async values=>{await save(values);if(values[MUTATION]){storing=true;await pending.promise;}};
  const work=wake.connectFromSetup(setupTuple,setupOperation,()=>true);
  for(let i=0;i<30&&!storing;i++)await tick();assert.equal(storing,true);
  f.setGrant(false);f.removed.emit({permissions:['nativeMessaging']});f.setGrant(true);
  pending.resolve();assert.equal(await work,null);
  assert.equal(f.messages.some(v=>v.action==='current-account-setup-connect'),false);
});

test('independent status attaches to the same owner before and after a never-returning Reconnect deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { f, wake, request, primary, ownerId } = await pendingReconnect(t);
  for (const afterDeadline of [false, true]) {
    if (afterDeadline) { t.mock.timers.tick(14500); assert.equal(await primary, null); }
    const message = statusMessage(request.id), status = wake.handleMessage(message, devicesSender(f)); await tick();
    const call = f.attachments.at(-1);
    assert.ok(call, 'status cannot wait for the occupied long-port command');
    assert.equal(call.host, BROWSER_WAKE_HOST);
    assert.deepEqual(call.frame, { version: 2, action: 'attach-control', ownerId, request: message.request });
    const response = attachedReply(call, 'unknown-running', 'reconnect'); call.resolve(response);
    assert.deepEqual(await status, { ownerId, response: response.response });
    assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], { ownerId, ...request });
  }
  assert.deepEqual(f.messages.map(message => message.action), ['wake', 'reconnect']);
  assert.equal(f.attempts.length, 1);
});

test('priority Pause persists separately before attach, rejects duplicates, and never waits for status IPC', async t => {
  const { f, wake, request, ownerId } = await pendingReconnect(t);
  const status = wake.handleMessage(statusMessage(request.id), devicesSender(f)); await tick();
  const pause = { version: 1, id: 'priority-pause', action: 'disconnect-and-pause' };
  const pending = wake.handleMessage(mutationMessage(f, pause), devicesSender(f)); await tick();
  assert.equal(f.attachments.length, 2, 'the status IPC does not hold the admission queue');
  const call = f.attachments[1], record = { ownerId, ...pause };
  assert.deepEqual(call.frame, { version: 2, action: 'attach-control', ownerId, request: pause });
  assert.deepEqual((await f.api.storage.session.get(PRIORITY_PAUSE))[PRIORITY_PAUSE], record);
  assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], { ownerId, ...request });
  assert.equal(await wake.handleMessage(mutationMessage(f, { ...pause, id: 'duplicate-pause' }), devicesSender(f)), null);
  call.resolve({ version: 2, action: 'attach-control', ownerId, response: { ...pause, ok: false } });
  assert.ok(await pending);
  assert.deepEqual((await f.api.storage.session.get(PRIORITY_PAUSE))[PRIORITY_PAUSE], record);
  assert.equal(await wake.handleMessage(mutationMessage(f, { ...pause, id: 'another-pause' }), devicesSender(f)), null);
  f.attachments[0].resolve(attachedReply(f.attachments[0], 'unknown-running', 'reconnect')); assert.ok(await status);
  assert.equal(f.attachments.length, 2);
  assert.deepEqual(f.messages.map(message => message.action), ['wake', 'reconnect']);
});

for (const first of ['primary', 'pause']) {
  test(`independent receipts settle only their own fence when ${first} finishes first`, async t => {
    const { f, wake, request, primary, ownerId } = await pendingReconnect(t);
    const pause = { version: 1, id: 'priority-pause', action: 'disconnect-and-pause' };
    const pending = wake.handleMessage(mutationMessage(f, pause), devicesSender(f)); await tick();
    const call = f.attachments[0]; assert.ok(call);
    if (first === 'primary') {
      f.native.onMessage.emit(operationReply(request, 'settled')); assert.ok(await primary);
      assert.equal((await f.api.storage.session.get(MUTATION))[MUTATION], false);
      assert.deepEqual((await f.api.storage.session.get(PRIORITY_PAUSE))[PRIORITY_PAUSE], { ownerId, ...pause });
      assert.equal(await wake.handleMessage(mutationMessage(f, { ...request, id: 'new-reconnect' }), devicesSender(f)), null);
      f.native.onDisconnect.emit(); await tick();
      assert.equal((await f.api.storage.session.get(OWNER))[OWNER], ownerId);
      assert.equal(f.alarms.size, 0);
      call.resolve(attachedReply(call, 'settled')); assert.ok(await pending);
      assert.equal((await f.api.storage.session.get(PRIORITY_PAUSE))[PRIORITY_PAUSE], false);
    } else {
      call.resolve(attachedReply(call, 'settled')); assert.ok(await pending);
      assert.equal((await f.api.storage.session.get(PRIORITY_PAUSE))[PRIORITY_PAUSE], false);
      assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], { ownerId, ...request });
      f.native.onMessage.emit(operationReply(request, 'settled')); assert.ok(await primary);
      assert.equal((await f.api.storage.session.get(MUTATION))[MUTATION], false);
    }
    assert.equal(f.attempts.length, 1);
  });
}

test('worker restart reads two exact original IDs using attach only without unsolicited startup or IPC', async t => {
  const f = extension({ attach: true }), ownerId = 'retained-browser-owner';
  const primary = { ownerId, version: 1, id: 'retained-reconnect', action: 'reconnect' };
  const pause = { ownerId, version: 1, id: 'retained-pause', action: 'disconnect-and-pause' };
  await f.api.storage.session.set({ [OWNER]: ownerId, [MUTATION]: primary, [PRIORITY_PAUSE]: pause });
  const wake = bindBrowserWake(f.api); await tick(); f.startup.emit(); await tick();
  assert.equal(f.attempts.length, 0); assert.equal(f.attachments.length, 0);
  const one = wake.handleMessage(statusMessage(primary.id), devicesSender(f)); await tick();
  const two = wake.handleMessage(statusMessage(pause.id), devicesSender(f)); await tick();
  assert.equal(f.attachments.length, 2);
  for (const [index, action] of [[0, 'reconnect'], [1, 'disconnect-and-pause']]) {
    const call = f.attachments[index]; assert.equal(call.frame.ownerId, ownerId);
    call.resolve(attachedReply(call, 'settled', action));
  }
  assert.ok(await one); assert.ok(await two);
  assert.equal((await f.api.storage.session.get(MUTATION))[MUTATION], false);
  assert.equal((await f.api.storage.session.get(PRIORITY_PAUSE))[PRIORITY_PAUSE], false);
  assert.equal((await f.api.storage.session.get(OWNER))[OWNER], ownerId, 'receipt settlement is not owner-death proof');
  assert.equal(f.attempts.length, 0);
  assert.equal(f.alarms.size, 0);
});

test('priority Pause survives a primary receipt reconciled by attach and its late original port reply', async t => {
  const { f, wake, request, primary, ownerId } = await pendingReconnect(t);
  const pause = { version: 1, id: 'priority-pause', action: 'disconnect-and-pause' };
  const pending = wake.handleMessage(mutationMessage(f, pause), devicesSender(f)); await tick();
  assert.ok(f.attachments[0]);
  f.attachments[0].resolve(attachedReply(f.attachments[0], 'unknown-running')); assert.ok(await pending);
  const status = wake.handleMessage(statusMessage(request.id), devicesSender(f)); await tick();
  const call = f.attachments[1]; assert.ok(call); call.resolve(attachedReply(call, 'settled', 'reconnect')); assert.ok(await status);
  assert.equal((await f.api.storage.session.get(MUTATION))[MUTATION], false);
  f.native.onMessage.emit(operationReply(request, 'settled')); assert.ok(await primary);
  assert.deepEqual((await f.api.storage.session.get(PRIORITY_PAUSE))[PRIORITY_PAUSE], { ownerId, ...pause });
  assert.equal(await wake.handleMessage(mutationMessage(f, { ...request, id: 'new-reconnect' }), devicesSender(f)), null);
  assert.equal(f.attempts.length, 1);
});

test('attach is bounded to five seconds and late receipts cannot retire a timed-out fence or start another owner', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { f, wake, request, ownerId } = await pendingReconnect(t);
  const status = wake.handleMessage(statusMessage(request.id), devicesSender(f)); await tick();
  assert.equal(f.attachments.length, 1);
  t.mock.timers.tick(5000); assert.equal(await status, null);
  f.attachments[0].resolve(attachedReply(f.attachments[0], 'settled', 'reconnect')); await tick();
  assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], { ownerId, ...request });
  assert.equal(f.attempts.length, 1); assert.equal(f.disconnected, 0); assert.equal(f.alarms.size, 0);
});

test('an attach started near the total status deadline releases its waiter at the remaining budget', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const scheduled = t.mock.method(globalThis, 'setTimeout'), cleared = t.mock.method(globalThis, 'clearTimeout');
  const { f, wake, request } = await pendingReconnect(t);
  const get = f.api.storage.session.get; let release;
  f.api.storage.session.get = async keys => {
    if (!release && Array.isArray(keys) && keys.includes(OWNER)) await new Promise(resolve => { release = resolve; });
    return get(keys);
  };
  const status = wake.handleMessage(statusMessage(request.id), devicesSender(f)); await tick();
  assert.equal(typeof release, 'function');
  t.mock.timers.tick(14000); release(); await tick(); assert.equal(f.attachments.length, 1);
  const timer = scheduled.mock.calls.find(call => call.arguments[1] === 5000)?.result;
  assert.notEqual(timer, undefined);
  t.mock.timers.tick(500); assert.equal(await status, null); await tick();
  assert.ok(cleared.mock.calls.some(call => call.arguments[0] === timer), 'attach waiter must not outlive the total status budget');
});

test('malformed attach envelopes and mismatched receipts fail closed without fallback or fence retirement', async t => {
  for (const corrupt of [reply => ({ ...reply, ownerId: 'foreign-owner' }), reply => ({ ...reply, version: 1 }),
    reply => ({ ...reply, extra: true }), reply => ({ ...reply, response: { ...reply.response, id: 'foreign-id' } }),
    reply => ({ ...reply, response: { ...reply.response, action: 'disconnect-and-pause' } })]) {
    const { f, wake, request, ownerId } = await pendingReconnect(t);
    const status = wake.handleMessage(statusMessage(request.id), devicesSender(f)); await tick();
    const call = f.attachments[0]; assert.ok(call); call.resolve(corrupt(attachedReply(call, 'settled', 'reconnect')));
    assert.equal(await status, null);
    assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], { ownerId, ...request });
    assert.equal(f.attempts.length, 1); assert.equal(f.disconnected, 0);
  }
});

test('permission epoch or persisted owner changes invalidate an attached terminal reply', async t => {
  for (const changed of ['permission', 'owner', 'record']) {
    const { f, wake, request, ownerId } = await pendingReconnect(t);
    const status = wake.handleMessage(statusMessage(request.id), devicesSender(f)); await tick();
    const call = f.attachments[0]; assert.ok(call);
    const record = { ownerId, ...request };
    if (changed === 'permission') {
      f.setGrant(false); f.removed.emit({ permissions: ['nativeMessaging'] });
      f.setGrant(true); f.added.emit({ permissions: ['nativeMessaging'] });
    } else if (changed === 'owner') await f.api.storage.session.set({ [OWNER]: 'replacement-owner' });
    else await f.api.storage.session.set({ [MUTATION]: { ...record, id: 'replacement-operation' } });
    call.resolve(attachedReply(call, 'settled', 'reconnect')); assert.equal(await status, null);
    assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION],
      changed === 'record' ? { ...record, id: 'replacement-operation' } : record);
    assert.equal(f.attempts.length, 1);
  }
});

test('a cancelled priority admission never posts after its total request deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { f, wake, ownerId } = await pendingReconnect(t);
  const set = f.api.storage.session.set; let release;
  f.api.storage.session.set = async values => {
    if (values[PRIORITY_PAUSE]) await new Promise(resolve => { release = resolve; });
    return set(values);
  };
  const pause = { version: 1, id: 'slow-priority-pause', action: 'disconnect-and-pause' };
  const pending = wake.handleMessage(mutationMessage(f, pause), devicesSender(f)); await tick();
  assert.equal(typeof release, 'function');
  t.mock.timers.tick(14500); assert.equal(await pending, null);
  release(); await tick();
  assert.equal(f.attachments.length, 0);
  assert.deepEqual((await f.api.storage.session.get(PRIORITY_PAUSE))[PRIORITY_PAUSE], { ownerId, ...pause });
  assert.equal(f.attempts.length, 1);
});

test('ambiguous priority admission writes never send Pause or erase the primary fence', async t => {
  for (const applied of [false, true]) {
    const { f, wake, request, ownerId } = await pendingReconnect(t);
    const set = f.api.storage.session.set;
    let writes = 0;
    f.api.storage.session.set = async values => {
      if (values[PRIORITY_PAUSE]) {
        writes++;
        if (applied) await set(values);
        throw new Error('ambiguous-priority-admission');
      }
      return set(values);
    };
    const pause = { version: 1, id: 'uncertain-priority-pause', action: 'disconnect-and-pause' };
    assert.equal(await wake.handleMessage(mutationMessage(f, pause), devicesSender(f)), null);
    assert.equal(writes, 1, 'the failed admission must actually reach the durable write boundary');
    assert.equal(f.attachments.length, 0);
    assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], { ownerId, ...request });
    assert.equal((await f.api.storage.session.get(OWNER))[OWNER], ownerId);
    assert.equal(f.attempts.length, 1);
  }
});

test('known-owner status uses attach even on an idle port and never adopts a different or absent owner', async t => {
  const f = extension({ attach: true }), wake = bindBrowserWake(f.api);
  t.after(() => f.native?.onDisconnect.emit());
  await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
  const ownerId = f.messages[0].id;
  const message = { ...statusMessage('known-owner-status'), ownerId };
  const pending = wake.handleMessage(message, devicesSender(f)); await tick();
  assert.equal(f.attachments.length, 1);
  const call = f.attachments[0];
  call.resolve({ version: 2, action: 'attach-control', ownerId,
    response: { ...message.request, ok: true, state: { paused: true, connection: 'disconnected' } } });
  assert.ok(await pending);
  assert.deepEqual(f.messages.map(message => message.action), ['wake']);
  for (const owner of ['different-owner', '', '../invalid']) {
    assert.equal(await wake.handleMessage({ ...message, ownerId: owner }, devicesSender(f)), null);
  }
  const absent = extension({ attach: true, granted: false }), other = bindBrowserWake(absent.api); await tick();
  absent.setGrant(true);
  assert.equal(await other.handleMessage(message, devicesSender(absent)), null);
  assert.equal(absent.attempts.length, 0); assert.equal(absent.attachments.length, 0);
});

test('ordinary known-owner Pause uses the primary slot and attach even while a read-only port command is busy', async t => {
  for (const busy of [false, true]) {
    const f = extension({ attach: true }), wake = bindBrowserWake(f.api);
    t.after(() => f.native?.onDisconnect.emit());
    await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
    const ownerId = f.messages[0].id;
    const status = busy ? wake.handleMessage(statusMessage(), devicesSender(f)) : null; await tick();
    const request = { version: 1, id: 'ordinary-pause', action: 'disconnect-and-pause' };
    const pending = wake.handleMessage(mutationMessage(f, request), devicesSender(f)); await tick();
    assert.equal(f.attachments.length, 1);
    assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], { ownerId, ...request });
    assert.equal((await f.api.storage.session.get(PRIORITY_PAUSE))[PRIORITY_PAUSE], undefined);
    assert.equal(f.messages.some(message => message.action === 'disconnect-and-pause'), false);
    const call = f.attachments[0]; call.resolve(attachedReply(call, 'settled')); assert.ok(await pending);
    assert.equal((await f.api.storage.session.get(MUTATION))[MUTATION], false);
    if (busy) {
      f.native.onMessage.emit({ ...statusMessage().request, ok: true, state: { paused: true, connection: 'disconnected' } });
      assert.ok(await status);
    }
  }
});

test('priority Pause may attach after port loss and worker restart but only over the retained Reconnect', async t => {
  const { f, request, primary, ownerId } = await pendingReconnect(t);
  f.native.onDisconnect.emit(); assert.equal(await primary, null); await tick();
  const wake = f.rebind(); await tick();
  const pause = { version: 1, id: 'restored-priority-pause', action: 'disconnect-and-pause' };
  const pending = wake.handleMessage({ type: BROWSER_DEVICE_MESSAGE, ownerId, request: pause }, devicesSender(f)); await tick();
  const call = f.attachments[0]; assert.ok(call);
  assert.deepEqual(call.frame, { version: 2, action: 'attach-control', ownerId, request: pause });
  call.resolve(attachedReply(call, 'settled')); assert.ok(await pending);
  assert.equal((await f.api.storage.session.get(PRIORITY_PAUSE))[PRIORITY_PAUSE], false);
  assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], { ownerId, ...request });
  assert.equal(f.attempts.length, 1); assert.equal(f.alarms.size, 0);
});

test('priority Pause timeout keeps its exact record and a late attach result cannot release it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { f, wake, ownerId } = await pendingReconnect(t);
  const pause = { version: 1, id: 'timed-out-priority-pause', action: 'disconnect-and-pause' };
  const pending = wake.handleMessage(mutationMessage(f, pause), devicesSender(f)); await tick();
  assert.equal(f.attachments.length, 1);
  t.mock.timers.tick(5000); assert.equal(await pending, null);
  f.attachments[0].resolve(attachedReply(f.attachments[0], 'settled')); await tick();
  assert.deepEqual((await f.api.storage.session.get(PRIORITY_PAUSE))[PRIORITY_PAUSE], { ownerId, ...pause });
  assert.equal(await wake.handleMessage(mutationMessage(f, { ...pause, id: 'duplicate' }), devicesSender(f)), null);
  assert.equal(f.attachments.length, 1);
});

test('no permission or foreign persisted records deny attach and priority admission without any wake fallback', async t => {
  for (const invalid of ['permission', 'primary-owner', 'pause-owner', 'same-id', 'platform']) {
    const { f, wake, request, ownerId } = await pendingReconnect(t);
    const primary = { ownerId, ...request };
    if (invalid === 'permission') f.setGrant(false);
    else if (invalid === 'primary-owner') await f.api.storage.session.set({ [MUTATION]: { ...primary, ownerId: 'foreign' } });
    else if (invalid === 'pause-owner') await f.api.storage.session.set({ [PRIORITY_PAUSE]:
      { ownerId: 'foreign', version: 1, id: 'foreign-pause', action: 'disconnect-and-pause' } });
    else if (invalid === 'platform') f.api.runtime.getPlatformInfo = async () => ({ os: 'linux' });
    const pause = { version: 1, id: invalid === 'same-id' ? request.id : 'new-pause', action: 'disconnect-and-pause' };
    assert.equal(await wake.handleMessage(mutationMessage(f, pause), devicesSender(f)), null);
    if (invalid !== 'same-id') assert.equal(await wake.handleMessage(statusMessage(request.id), devicesSender(f)), null);
    assert.equal(f.attachments.length, 0); assert.equal(f.attempts.length, 1);
  }
});

test('a priority-only fence prevents startup and a late receipt cannot erase its replacement', async t => {
  const isolated = extension(), isolatedWake = bindBrowserWake(isolated.api);
  await tick(); isolated.native.onDisconnect.emit(); await tick();
  await isolated.api.storage.session.set({ [PRIORITY_PAUSE]: { ownerId: 'retained-owner', version: 1,
    id: 'retained-pause', action: 'disconnect-and-pause' } });
  assert.equal(await isolatedWake.handleMessage(statusMessage(), devicesSender(isolated)), null);
  assert.equal(isolated.attempts.length, 1);
  const { f, wake, ownerId } = await pendingReconnect(t);
  const pause = { version: 1, id: 'old-priority-pause', action: 'disconnect-and-pause' };
  const pending = wake.handleMessage(mutationMessage(f, pause), devicesSender(f)); await tick();
  const replacement = { ownerId, ...pause, id: 'replacement-pause' };
  await f.api.storage.session.set({ [PRIORITY_PAUSE]: replacement });
  const call = f.attachments[0]; assert.ok(call); call.resolve(attachedReply(call, 'settled'));
  assert.equal(await pending, null);
  assert.deepEqual((await f.api.storage.session.get(PRIORITY_PAUSE))[PRIORITY_PAUSE], replacement);
});

test('ambiguous priority retirement retains owner and never clears an unresolved primary', async t => {
  for (const applied of [false, true]) {
    const { f, wake, request, ownerId } = await pendingReconnect(t);
    const pause = { version: 1, id: 'priority-pause', action: 'disconnect-and-pause' };
    const pending = wake.handleMessage(mutationMessage(f, pause), devicesSender(f)); await tick();
    const set = f.api.storage.session.set;
    f.api.storage.session.set = async values => {
      if (values[PRIORITY_PAUSE] === false) {
        if (applied) await set(values);
        throw new Error('ambiguous-priority-retirement');
      }
      return set(values);
    };
    const call = f.attachments[0]; assert.ok(call); call.resolve(attachedReply(call, 'settled'));
    assert.equal(await pending, null);
    assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], { ownerId, ...request });
    assert.equal((await f.api.storage.session.get(OWNER))[OWNER], ownerId);
    assert.equal(await wake.handleMessage(mutationMessage(f, { ...pause, id: 'duplicate' }), devicesSender(f)), null);
    assert.equal(f.attachments.length, 1);
  }
});

test('a long-port terminal receipt cannot retire a primary after its persisted owner changes', async t => {
  const { f, request, primary, ownerId } = await pendingReconnect(t);
  await f.api.storage.session.set({ [OWNER]: 'replacement-owner' });
  f.native.onMessage.emit(operationReply(request, 'settled'));
  assert.equal(await primary, null);
  assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], { ownerId, ...request });
  assert.equal((await f.api.storage.session.get(OWNER))[OWNER], 'replacement-owner');
  assert.equal(f.alarms.size, 0);
});

test('an exact terminal status repairs priority retirement rejected before or after commit on the same live owner', async t => {
  for (const applied of [false, true]) {
    const { f, wake, request, ownerId } = await pendingReconnect(t);
    const pause = { version: 1, id: 'retirement-recovery-pause', action: 'disconnect-and-pause' };
    const pending = wake.handleMessage(mutationMessage(f, pause), devicesSender(f)); await tick();
    const set = f.api.storage.session.set;
    f.api.storage.session.set = async values => {
      if (values[PRIORITY_PAUSE] === false) {
        if (applied) await set(values);
        throw new Error('retirement-rejected');
      }
      return set(values);
    };
    f.attachments[0].resolve(attachedReply(f.attachments[0], 'settled'));
    assert.equal(await pending, null);
    f.api.storage.session.set = set;
    const observed = wake.handleMessage(statusMessage(pause.id), devicesSender(f)); await tick();
    const statusCall = f.attachments.at(-1);
    statusCall.resolve(attachedReply(statusCall, 'settled', 'disconnect-and-pause'));
    assert.ok(await observed);
    assert.equal((await f.api.storage.session.get(PRIORITY_PAUSE))[PRIORITY_PAUSE], false);
    const nextPause = { ...pause, id: 'next-explicit-pause' };
    const next = wake.handleMessage(mutationMessage(f, nextPause), devicesSender(f)); await tick();
    const nextCall = f.attachments.at(-1);
    assert.equal(nextCall.frame.request.id, nextPause.id, 'terminal proof must retire the in-memory fence too');
    nextCall.resolve(attachedReply(nextCall, 'settled')); assert.ok(await next);
    assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], { ownerId, ...request });
    assert.deepEqual(f.messages.map(value => value.action), ['wake', 'reconnect']);
  }
});

test('permission removal during priority persistence cancels transport but preserves both records', async t => {
  const { f, wake, request, ownerId } = await pendingReconnect(t);
  const set = f.api.storage.session.set; let release;
  f.api.storage.session.set = async values => {
    if (values[PRIORITY_PAUSE]) await new Promise(resolve => { release = resolve; });
    return set(values);
  };
  const pause = { version: 1, id: 'revoked-priority-pause', action: 'disconnect-and-pause' };
  const pending = wake.handleMessage(mutationMessage(f, pause), devicesSender(f)); await tick();
  assert.equal(typeof release, 'function');
  f.setGrant(false); f.removed.emit({ permissions: ['nativeMessaging'] }); release();
  assert.equal(await pending, null); await tick();
  assert.equal(f.attachments.length, 0);
  assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], { ownerId, ...request });
  assert.deepEqual((await f.api.storage.session.get(PRIORITY_PAUSE))[PRIORITY_PAUSE], { ownerId, ...pause });
  assert.equal((await f.api.storage.session.get(OWNER))[OWNER], ownerId);
});

test('local disconnect retires a certain owner after permission removal and regrant', async t => {
  const f = extension(), wake = bindBrowserWake(f.api);
  t.after(() => f.native?.onDisconnect.emit());
  await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
  f.setGrant(false); f.removed.emit({ permissions: ['nativeMessaging'] }); await tick();
  assert.equal(f.disconnected, 1);
  assert.equal((await f.api.storage.session.get(OWNER))[OWNER], null);
  f.setGrant(true); f.added.emit({ permissions: ['nativeMessaging'] }); await tick();
  assert.equal(f.attempts.length, 2);
  const handshake = f.messages.at(-1);
  f.native.onMessage.emit({ ...handshake, ok: true });
  const message = statusMessage(), status = wake.handleMessage(message, devicesSender(f));
  await tick(); f.native.onMessage.emit({ ...message.request, ok: true, state: { paused: true, connection: 'disconnected' } });
  assert.ok(await status);
});

test('handshake timeout and malformed reply retire only a certain disconnected owner', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const outcome of ['timeout', 'malformed']) {
    const f = extension(), wake = bindBrowserWake(f.api);
    t.after(() => f.native?.onDisconnect.emit());
    await tick();
    if (outcome === 'timeout') t.mock.timers.tick(15000);
    else f.native.onMessage.emit({ ...f.messages[0], ok: true, extra: true });
    await tick();
    assert.equal((await f.api.storage.session.get(OWNER))[OWNER], null, outcome);
    assert.equal(f.alarms.size, 0);
    const status = wake.handleMessage(statusMessage(), devicesSender(f)); await tick();
    assert.equal(f.attempts.length, 2, outcome);
    f.native.onDisconnect.emit(); assert.equal(await status, null);
  }
});

test('cancelled final owner write retires its exact unconnected owner', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const cancel of ['deadline', 'permission']) {
    const f = extension(), wake = bindBrowserWake(f.api);
    await tick(); f.native.onDisconnect.emit(); await tick();
    const set = f.api.storage.session.set;
    let release;
    f.api.storage.session.set = async values => {
      if (values[OWNER]) await new Promise(resolve => { release = resolve; });
      return set(values);
    };
    const status = wake.handleMessage(statusMessage(), devicesSender(f)); await tick();
    assert.equal(typeof release, 'function');
    if (cancel === 'deadline') t.mock.timers.tick(14500);
    else { f.setGrant(false); f.removed.emit({ permissions: ['nativeMessaging'] }); }
    release(); await tick();
    assert.equal(await status, null);
    assert.equal(f.attempts.length, 1, 'cancelled attachment never opens a port');
    assert.equal((await f.api.storage.session.get(OWNER))[OWNER], null, cancel);
    f.api.storage.session.set = set; f.setGrant(true);
    const retry = wake.handleMessage(statusMessage('retry'), devicesSender(f)); await tick();
    assert.equal(f.attempts.length, 2);
    f.native.onDisconnect.emit(); assert.equal(await retry, null);
  }
});

test('cancelled owner cleanup never erases a replacement owner', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = extension(), wake = bindBrowserWake(f.api);
  await tick(); f.native.onDisconnect.emit(); await tick();
  const set = f.api.storage.session.set;
  let release;
  f.api.storage.session.set = async values => {
    if (values[OWNER]) await new Promise(resolve => { release = resolve; });
    await set(values);
    if (values[OWNER]) await set({ [OWNER]: 'replacement-owner' });
  };
  const status = wake.handleMessage(statusMessage(), devicesSender(f)); await tick();
  t.mock.timers.tick(14500); assert.equal(await status, null);
  release(); await tick();
  assert.equal((await f.api.storage.session.get(OWNER))[OWNER], 'replacement-owner');
  assert.equal(await wake.handleMessage(statusMessage('retry'), devicesSender(f)), null);
  assert.equal(f.attempts.length, 1);
});

test('concurrent status callers share a successful pending handshake and serialize their replies', async t => {
  for (const absent of [false, true]) {
    const f = extension(), wake = bindBrowserWake(f.api);
    t.after(() => f.native?.onDisconnect.emit());
    await tick();
    if (absent) { f.native.onDisconnect.emit(); await tick(); }
    const first = statusMessage('first'), second = statusMessage('second');
    const one = wake.handleMessage(first, devicesSender(f));
    const two = wake.handleMessage(second, devicesSender(f));
    await tick();
    assert.equal(f.attempts.length, absent ? 2 : 1);
    const handshake = f.messages.at(-1);
    f.native.onMessage.emit({ ...handshake, ok: true }); await tick();
    assert.deepEqual(f.messages.at(-1), first.request);
    const reply = message => ({ ...message.request, ok: true, state: { paused: true, connection: 'disconnected' } });
    f.native.onMessage.emit(reply(first)); assert.ok(await one); await tick();
    assert.deepEqual(f.messages.at(-1), second.request);
    f.native.onMessage.emit(reply(second));
    assert.deepEqual(await two, { ownerId: handshake.id, response: reply(second) });
    assert.equal(f.attempts.length, absent ? 2 : 1);
  }
});

test('read-only timeout tears down its port and allows explicit status attachment without mutation replay', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = extension(), wake = bindBrowserWake(f.api);
  t.after(() => f.native?.onDisconnect.emit());
  await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
  const pending = wake.handleMessage(statusMessage(), devicesSender(f)); await tick();
  t.mock.timers.tick(14500); assert.equal(await pending, null); await tick();
  assert.equal(f.disconnected, 1);
  assert.equal((await f.api.storage.session.get(OWNER))[OWNER], null);
  const retry = wake.handleMessage(statusMessage('retry'), devicesSender(f)); await tick();
  assert.equal(f.attempts.length, 2);
  assert.deepEqual(f.messages.map(message => message.action), ['wake', 'status', 'wake']);
  f.native.onDisconnect.emit(); assert.equal(await retry, null);
});

test('status deadline also bounds a slow acknowledgement and never posts an expired queued status', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = extension(), wake = bindBrowserWake(f.api);
  t.after(() => f.native?.onDisconnect.emit());
  await tick();
  const first = wake.handleMessage(statusMessage('first'), devicesSender(f));
  const second = wake.handleMessage(statusMessage('second'), devicesSender(f));
  t.mock.timers.tick(14000);
  f.native.onMessage.emit({ ...f.messages[0], ok: true }); await tick();
  t.mock.timers.tick(500);
  assert.equal(await first, null); assert.equal(await second, null); await tick();
  assert.equal(f.disconnected, 1);
  assert.equal(f.messages.filter(message => message.action === 'status').length, 1);
});

test('mutation admission persists its operation identity before posting and rejects unrelated mutations', async t => {
  const f = extension({ pauseAttach: true }), wake = bindBrowserWake(f.api);
  t.after(() => f.native?.onDisconnect.emit());
  await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
  const request = { version: 1, id: 'unknown-pause', action: 'disconnect-and-pause' };
  const post = f.api.runtime.sendNativeMessage;
  let persisted;
  f.api.runtime.sendNativeMessage = (host, frame) => {
    if (frame.request.action === request.action) persisted = f.api.storage.session.get(MUTATION);
    return post(host, frame);
  };
  const mutation = wake.handleMessage(mutationMessage(f, request), devicesSender(f)); await tick();
  const record = (await persisted)[MUTATION];
  assert.deepEqual(record, { ownerId: f.messages[0].id, ...request });
  replyControl(f, operationReply(request, 'unknown-running')); assert.ok(await mutation);
  const other = { version: 1, id: 'other', action: 'reconnect' };
  assert.equal(await wake.handleMessage(mutationMessage(f, other), devicesSender(f)), null);
  assert.deepEqual(f.requests.at(-1), request);
  assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], record);
});

for (const action of ['reconnect', 'disconnect-and-pause', 'prepared-revoke']) {
  test(`generic ${action} rejection preserves its mutation fence across disconnect and worker restart`, async t => {
    const f = extension({ pauseAttach: true }), wake = bindBrowserWake(f.api);
    t.after(() => f.native?.onDisconnect.emit());
    await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
    const request = { version: 1, id: 'rejected-mutation', action,
      ...(action === 'prepared-revoke' ? { operationId: 'ae900800-b673-4eee-abe5-e7267e0d46b1', sha256: 'a'.repeat(64) } : {}) };
    const pending = wake.handleMessage(mutationMessage(f, request), devicesSender(f)); await tick();
    const record = { ownerId: f.messages[0].id, ...request };
    const response = { version: 1, id: request.id, action, ok: false };
    replyControl(f, response);
    assert.deepEqual(await pending, { ownerId: record.ownerId, response });
    assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], record);
    assert.equal(await wake.handleMessage(mutationMessage(f,
      { version: 1, id: 'unrelated-reconnect', action: 'reconnect' }), devicesSender(f)), null);
    assert.deepEqual(f.requests.at(-1), request);
    f.native.onDisconnect.emit(); await tick();
    assert.equal((await f.api.storage.session.get(OWNER))[OWNER], record.ownerId);
    assert.equal(f.alarms.size, 0);
    const next = f.rebind(); await tick();
    f.setGrant(false); f.removed.emit({ permissions: ['nativeMessaging'] }); await tick();
    f.setGrant(true); f.added.emit({ permissions: ['nativeMessaging'] }); await tick();
    assert.equal(await next.handleMessage(statusMessage(), devicesSender(f)), null);
    assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], record);
    assert.equal(f.attempts.length, 1);
    assert.equal(f.requests.filter(message => message.action === action).length, 1);
    assert.equal(f.alarms.size, 0);
  });
}

test('a generic mutation rejection remains reconcilable only through its matching terminal receipt', async t => {
  for (const action of ['reconnect', 'disconnect-and-pause', 'prepared-revoke']) {
    const f = extension({ pauseAttach: true }), wake = bindBrowserWake(f.api);
    t.after(() => f.native?.onDisconnect.emit());
    await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
    const request = { version: 1, id: 'rejected-mutation', action,
      ...(action === 'prepared-revoke' ? { operationId: 'ae900800-b673-4eee-abe5-e7267e0d46b1', sha256: 'a'.repeat(64) } : {}) };
    const pending = wake.handleMessage(mutationMessage(f, request), devicesSender(f)); await tick();
    replyControl(f, { version: 1, id: request.id, action, ok: false }); assert.ok(await pending);
    assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], { ownerId: f.messages[0].id, ...request });
    const message = action === 'prepared-revoke' ?
      mutationMessage(f, { ...request, id: 'matching-review', action: 'prepared-review' }) : statusMessage(request.id);
    const readback = wake.handleMessage(message, devicesSender(f)); await tick();
    const response = action === 'prepared-revoke' ?
      { version: 1, id: message.request.id, action: 'prepared-review', ok: true, status: 'owner-revoked', expiresAt: 1794000000000 } :
      operationReply(message.request, 'not-executed', action);
    f.native.onMessage.emit(response); assert.ok(await readback);
    assert.equal((await f.api.storage.session.get(MUTATION))[MUTATION], false);
    assert.equal(f.requests.filter(message => message.action === action).length, 1);
    f.native.onDisconnect.emit(); await tick();
    assert.equal((await f.api.storage.session.get(OWNER))[OWNER], null);
    assert.equal(f.alarms.size, 1);
  }
});

test('blocked-by-local-control directly settles its exact prepared revoke without replay', async t => {
  const f = extension(), wake = bindBrowserWake(f.api);
  t.after(() => f.native?.onDisconnect.emit());
  await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
  const request = { version: 1, id: 'blocked-revoke', action: 'prepared-revoke',
    operationId: 'ae900800-b673-4eee-abe5-e7267e0d46b1', sha256: 'a'.repeat(64) };
  const pending = wake.handleMessage(mutationMessage(f, request), devicesSender(f)); await tick();
  const response = { version: 1, id: request.id, action: request.action, ok: true,
    status: 'blocked-by-local-control', expiresAt: 1794000000000 };
  f.native.onMessage.emit(response);
  assert.deepEqual(await pending, { ownerId: f.messages[0].id, response });
  assert.equal((await f.api.storage.session.get(MUTATION))[MUTATION], false);
  assert.equal(f.disconnected, 0);
  assert.equal(f.messages.filter(message => message.action === request.action).length, 1);
  f.native.onDisconnect.emit(); await tick();
  assert.equal((await f.api.storage.session.get(OWNER))[OWNER], null);
  assert.equal(f.alarms.size, 1);
});

test('blocked-by-local-control review settles only the exact unresolved prepared revoke reference', async t => {
  const f = extension(), wake = bindBrowserWake(f.api);
  t.after(() => f.native?.onDisconnect.emit());
  await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
  const request = { version: 1, id: 'uncertain-revoke', action: 'prepared-revoke',
    operationId: 'ae900800-b673-4eee-abe5-e7267e0d46b1', sha256: 'a'.repeat(64) };
  const pending = wake.handleMessage(mutationMessage(f, request), devicesSender(f)); await tick();
  const reply = (request, status) => ({ version: 1, id: request.id, action: request.action, ok: true,
    status, expiresAt: 1794000000000 });
  f.native.onMessage.emit(reply(request, 'admitted-outcome-unconfirmed')); assert.ok(await pending);
  const record = { ownerId: f.messages[0].id, ...request };
  for (const reference of [{ ...request, sha256: 'b'.repeat(64) },
    { ...request, operationId: 'be900800-b673-4eee-abe5-e7267e0d46b1' }]) {
    const review = { ...reference, id: 'unrelated-review', action: 'prepared-review' };
    const readback = wake.handleMessage(mutationMessage(f, review), devicesSender(f)); await tick();
    const response = reply(review, 'blocked-by-local-control');
    f.native.onMessage.emit(response);
    assert.deepEqual(await readback, { ownerId: record.ownerId, response });
    assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], record);
    assert.equal(f.disconnected, 0);
  }
  const review = { ...request, id: 'matching-review', action: 'prepared-review' };
  const readback = wake.handleMessage(mutationMessage(f, review), devicesSender(f)); await tick();
  const response = reply(review, 'blocked-by-local-control');
  f.native.onMessage.emit(response);
  assert.deepEqual(await readback, { ownerId: record.ownerId, response });
  assert.equal((await f.api.storage.session.get(MUTATION))[MUTATION], false);
  assert.equal(f.disconnected, 0);
  assert.equal(f.messages.filter(message => message.action === request.action).length, 1);
  f.native.onDisconnect.emit(); await tick();
  assert.equal((await f.api.storage.session.get(OWNER))[OWNER], null);
  assert.equal(f.alarms.size, 1);
});

test('only an exact matching terminal status receipt clears a lifecycle mutation fence', async t => {
  for (const terminal of ['settled', 'not-executed']) {
    const f = extension({ pauseAttach: true }), wake = bindBrowserWake(f.api);
    t.after(() => f.native?.onDisconnect.emit());
    await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
    const request = { version: 1, id: 'unknown-pause', action: 'disconnect-and-pause' };
    const mutation = wake.handleMessage(mutationMessage(f, request), devicesSender(f)); await tick();
    replyControl(f, operationReply(request, 'unknown-running')); await mutation;
    const record = (await f.api.storage.session.get(MUTATION))[MUTATION];
    for (const [id, response] of [
      ['unrelated', { version: 1, id: 'unrelated', action: 'status', ok: false }],
      [request.id, { version: 1, id: request.id, action: 'status', ok: true, state: { paused: true, connection: 'disconnected' } }],
      [request.id, operationReply({ ...request, action: 'status' }, 'settled', 'reconnect')],
      [request.id, operationReply({ ...request, action: 'status' }, 'unknown-running', request.action)],
    ]) {
      const status = wake.handleMessage(statusMessage(id), devicesSender(f)); await tick();
      f.native.onMessage.emit(response); assert.ok(await status);
      assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], record);
    }
    const status = wake.handleMessage(statusMessage(request.id), devicesSender(f)); await tick();
    f.native.onMessage.emit(operationReply({ ...request, action: 'status' }, terminal, request.action));
    assert.ok(await status);
    assert.equal((await f.api.storage.session.get(MUTATION))[MUTATION], false, terminal);
    f.native.onDisconnect.emit(); await tick();
    assert.equal((await f.api.storage.session.get(OWNER))[OWNER], null);
    assert.equal(f.alarms.size, 1);
  }
});

test('unrelated lifecycle and prepared mutations cannot replace or retire an unresolved Pause', async t => {
  const f = extension({ pauseAttach: true }), wake = bindBrowserWake(f.api);
  t.after(() => f.native?.onDisconnect.emit());
  await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
  const request = { version: 1, id: 'unresolved-pause', action: 'disconnect-and-pause' };
  const pause = wake.handleMessage(mutationMessage(f, request), devicesSender(f)); await tick();
  replyControl(f, operationReply(request, 'unknown-running')); await pause;
  const record = (await f.api.storage.session.get(MUTATION))[MUTATION];
  for (const other of [{ version: 1, id: 'other', action: 'reconnect' },
    { version: 1, id: 'other-revoke', action: 'prepared-revoke',
      operationId: 'ae900800-b673-4eee-abe5-e7267e0d46b1', sha256: 'a'.repeat(64) }]) {
    const pending = wake.handleMessage(mutationMessage(f, other), devicesSender(f)); await tick();
    assert.deepEqual(f.requests.at(-1), request, 'an unrelated mutation must not reach transport');
    assert.equal(await pending, null);
    assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], record);
  }
  f.native.onDisconnect.emit(); await tick();
  assert.equal(f.alarms.size, 0);
  assert.equal(await wake.handleMessage(statusMessage(), devicesSender(f)), null);
});

test('prepared review can reconcile only its exact unresolved revoke reference', async t => {
  const f = extension(), wake = bindBrowserWake(f.api);
  t.after(() => f.native?.onDisconnect.emit());
  await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
  const request = { version: 1, id: 'uncertain-revoke', action: 'prepared-revoke',
    operationId: 'ae900800-b673-4eee-abe5-e7267e0d46b1', sha256: 'a'.repeat(64) };
  const revoke = wake.handleMessage(mutationMessage(f, request), devicesSender(f)); await tick();
  const reply = (request, status) => ({ version: 1, id: request.id, action: request.action, ok: true,
    status, expiresAt: 1794000000000 });
  f.native.onMessage.emit(reply(request, 'admitted-outcome-unconfirmed')); assert.ok(await revoke);
  const record = { ownerId: f.messages[0].id, ...request };
  assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], record);
  for (const [reference, status] of [
    [{ ...request, sha256: 'b'.repeat(64) }, 'owner-revoked'],
    [{ ...request, operationId: 'be900800-b673-4eee-abe5-e7267e0d46b1' }, 'owner-revoked'],
    [request, 'staged'], [request, 'expired'], [request, 'receipt-unavailable'],
  ]) {
    const review = { ...reference, id: 'review', action: 'prepared-review' };
    const pending = wake.handleMessage(mutationMessage(f, review), devicesSender(f)); await tick();
    f.native.onMessage.emit(reply(review, status)); assert.ok(await pending);
    assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], record);
  }
  const review = { ...request, id: 'matching-review', action: 'prepared-review' };
  const pending = wake.handleMessage(mutationMessage(f, review), devicesSender(f)); await tick();
  f.native.onMessage.emit(reply(review, 'owner-revoked')); assert.ok(await pending);
  assert.equal((await f.api.storage.session.get(MUTATION))[MUTATION], false);
});

test('a terminal receipt cannot clear a replacement persisted mutation fence', async t => {
  const f = extension(), wake = bindBrowserWake(f.api);
  t.after(() => f.native?.onDisconnect.emit());
  await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
  const request = { version: 1, id: 'original-pause', action: 'disconnect-and-pause' };
  const pause = wake.handleMessage(mutationMessage(f, request), devicesSender(f)); await tick();
  const replacement = { ownerId: 'different-owner', version: 1, id: 'other-pause', action: request.action };
  await f.api.storage.session.set({ [MUTATION]: replacement });
  f.native.onMessage.emit(operationReply(request, 'settled')); await pause; await tick();
  assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], replacement);
  f.native.onDisconnect.emit(); await tick();
  assert.equal((await f.api.storage.session.get(OWNER))[OWNER], f.messages[0].id);
  assert.equal(f.alarms.size, 0);
});

test('legacy and unknown stored mutation fences never authorize a new owner', async () => {
  for (const record of [true, { ownerId: 'old-owner', version: 1, id: 'old-pause', action: 'disconnect-and-pause' }]) {
    const f = extension(); await f.api.storage.session.set({ [MUTATION]: record });
    const wake = bindBrowserWake(f.api); await tick();
    assert.equal(await wake.handleMessage(statusMessage(), devicesSender(f)), null);
    f.added.emit({ permissions: ['nativeMessaging'] }); await tick();
    assert.equal(f.attempts.length, 0);
    assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], record);
  }
});

test('read-only timeout with an unresolved mutation preserves owner and mutation across worker restart', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = extension({ pauseAttach: true }), wake = bindBrowserWake(f.api);
  await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
  const request = { version: 1, id: 'unknown-pause', action: 'disconnect-and-pause' };
  const mutation = wake.handleMessage(mutationMessage(f, request), devicesSender(f)); await tick();
  replyControl(f, operationReply(request, 'unknown-running')); await mutation;
  const record = (await f.api.storage.session.get(MUTATION))[MUTATION];
  const status = wake.handleMessage(statusMessage(request.id), devicesSender(f)); await tick();
  t.mock.timers.tick(14500); assert.equal(await status, null); await tick();
  assert.equal(f.disconnected, 1);
  assert.equal((await f.api.storage.session.get(OWNER))[OWNER], f.messages[0].id);
  assert.deepEqual((await f.api.storage.session.get(MUTATION))[MUTATION], record);
  const next = f.rebind(); await tick();
  assert.equal(await next.handleMessage(statusMessage('retry'), devicesSender(f)), null);
  assert.equal(f.attempts.length, 1);
  assert.equal(f.alarms.size, 0);
});

test('local disconnect failure keeps ownership until remote closure is confirmed', async t => {
  const f = extension(), wake = bindBrowserWake(f.api);
  t.after(() => f.native?.onDisconnect.emit());
  await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
  f.native.disconnect = () => { throw new Error('closure-unconfirmed'); };
  f.setGrant(false); f.removed.emit({ permissions: ['nativeMessaging'] }); await tick();
  assert.equal((await f.api.storage.session.get(OWNER))[OWNER], f.messages[0].id);
  f.setGrant(true); f.added.emit({ permissions: ['nativeMessaging'] }); await tick();
  assert.equal(await wake.handleMessage(statusMessage(), devicesSender(f)), null);
  f.native.onDisconnect.emit(); await tick();
  assert.equal((await f.api.storage.session.get(OWNER))[OWNER], null);
  const retry = wake.handleMessage(statusMessage('retry'), devicesSender(f)); await tick();
  assert.equal(f.attempts.length, 2);
  f.native.onDisconnect.emit(); assert.equal(await retry, null);
});

test('a late exact mutation reply can settle its timed-out slot without replay', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = extension(), wake = bindBrowserWake(f.api);
  t.after(() => f.native?.onDisconnect.emit());
  await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
  // Only Reconnect retains the long-port slot now; late one-shot Pause replies stay unconfirmed.
  const request = { version: 1, id: 'late-reconnect', action: 'reconnect' };
  const pause = wake.handleMessage(mutationMessage(f, request), devicesSender(f)); await tick();
  t.mock.timers.tick(14500); assert.equal(await pause, null);
  assert.equal(await wake.handleMessage(mutationMessage(f, { ...request, id: 'other' }), devicesSender(f)), null);
  f.native.onMessage.emit(operationReply(request, 'settled')); await tick();
  assert.equal((await f.api.storage.session.get(MUTATION))[MUTATION], false);
  assert.equal(f.messages.filter(message => message.action === request.action).length, 1);
  f.native.onDisconnect.emit(); await tick();
  assert.equal(f.alarms.size, 1);
});

test('ambiguous admission or retirement writes keep the owner fenced across worker restart', async () => {
  for (const stage of ['admission', 'retirement']) for (const applied of [false, true]) {
    const f = extension({ pauseAttach: true }), wake = bindBrowserWake(f.api);
    await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
    const set = f.api.storage.session.set;
    f.api.storage.session.set = async values => {
      if (Object.hasOwn(values, MUTATION) && (values[MUTATION] === false) === (stage === 'retirement')) {
        if (applied) await set(values);
        throw new Error('ambiguous-session-write');
      }
      return set(values);
    };
    const request = { version: 1, id: 'ambiguous-pause', action: 'disconnect-and-pause' };
    const pause = wake.handleMessage(mutationMessage(f, request), devicesSender(f)); await tick();
    if (stage === 'retirement') { replyControl(f, operationReply(request, 'settled')); await tick(); }
    assert.equal(await pause, null);
    assert.equal((await f.api.storage.session.get(OWNER))[OWNER], f.messages[0].id);
    assert.equal(f.requests.filter(message => message.action === request.action).length, stage === 'admission' ? 0 : 1);
    f.api.storage.session.set = set;
    const next = f.rebind(); await tick();
    assert.equal(await next.handleMessage(statusMessage(), devicesSender(f)), null);
    assert.equal(f.attempts.length, 1);
    assert.equal(f.alarms.size, 0);
  }
});

test('disconnect during terminal receipt persistence retires only after the exact proof commits', async () => {
  const f = extension({ pauseAttach: true }), wake = bindBrowserWake(f.api);
  await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
  const request = { version: 1, id: 'settling-pause', action: 'disconnect-and-pause' };
  const pause = wake.handleMessage(mutationMessage(f, request), devicesSender(f)); await tick();
  const set = f.api.storage.session.set;
  let release;
  f.api.storage.session.set = async values => {
    if (values[MUTATION] === false) await new Promise(resolve => { release = resolve; });
    return set(values);
  };
  replyControl(f, operationReply(request, 'settled')); await tick();
  // Losing the long port does not cancel this already-validated independent receipt.
  f.native.onDisconnect.emit();
  assert.equal((await f.api.storage.session.get(OWNER))[OWNER], f.messages[0].id);
  assert.equal(f.attempts.length, 1);
  release(); assert.ok(await pause); await tick();
  assert.equal((await f.api.storage.session.get(MUTATION))[MUTATION], false);
  assert.equal((await f.api.storage.session.get(OWNER))[OWNER], null);
  const retry = wake.handleMessage(statusMessage(), devicesSender(f)); await tick();
  assert.equal(f.attempts.length, 2);
  f.native.onDisconnect.emit(); assert.equal(await retry, null);
});

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
  t.mock.timers.tick(14500);
  assert.equal(await status, null, 'status must finish within the existing UI deadline');
  assert.equal(await duplicate, null, 'all pending callers share the same bounded handshake');
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
    const f = extension({ pauseAttach: true }), wake = bindBrowserWake(f.api);
    await tick();
    const handshake = f.messages[0];
    f.native.onMessage.emit({ ...handshake, ok: true });
    const request = { version: 1, id: 'lost-mutation', action,
      ...(action === 'prepared-revoke' ? { operationId: 'ae900800-b673-4eee-abe5-e7267e0d46b1', sha256: 'a'.repeat(64) } : {}) };
    const mutation = wake.handleMessage({ type: BROWSER_DEVICE_MESSAGE, ownerId: handshake.id, request }, devicesSender(f));
    await tick();
    assert.deepEqual(f.requests.at(-1), request);
    // Simulate loss of both transports; long-port closure alone cannot cancel an independent Pause.
    if (action === 'disconnect-and-pause') f.attachments.at(-1).reject(new Error('synthetic-reply-lost'));
    f.native.onDisconnect.emit();
    assert.equal(await mutation, null);
    assert.equal(await wake.handleMessage(statusMessage(), devicesSender(f)), null);
    const nextWorker = f.rebind(); await tick();
    f.removed.emit({ permissions: ['nativeMessaging'] }); await tick();
    f.added.emit({ permissions: ['nativeMessaging'] }); f.startup.emit(); await tick();
    assert.equal(await nextWorker.handleMessage(statusMessage(), devicesSender(f)), null);
    assert.equal(f.attempts.length, 1, action);
    assert.equal(f.alarms.size, 0);
    assert.equal(f.requests.filter(message => message.action === action).length, 1, 'never replay the mutation');
  }
});

test('mutation timeout or malformed/uncertain reply never authorizes another owner', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const outcome of ['timeout', 'malformed', 'unknown-running']) {
    const f = extension({ pauseAttach: true }), wake = bindBrowserWake(f.api);
    await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
    const request = { version: 1, id: 'uncertain-pause', action: 'disconnect-and-pause' };
    const pending = wake.handleMessage({ type: BROWSER_DEVICE_MESSAGE, ownerId: f.messages[0].id, request }, devicesSender(f));
    await tick();
    if (outcome === 'timeout') {
      t.mock.timers.tick(14500);
      assert.equal(await pending, null);
      // A fresh status is allowed through attach, but this fixture's status endpoint is unavailable.
      assert.equal(await wake.handleMessage({ ...statusMessage(), ownerId: f.messages[0].id }, devicesSender(f)), null,
        'the unresolved mutation fence stays reserved');
    } else {
      replyControl(f, outcome === 'malformed' ? { ...request, ok: true } :
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
  const f = extension({ pauseAttach: true }), wake = bindBrowserWake(f.api);
  await tick(); f.native.onMessage.emit({ ...f.messages[0], ok: true });
  const request = { version: 1, id: 'settled-pause', action: 'disconnect-and-pause' };
  const pending = wake.handleMessage({ type: BROWSER_DEVICE_MESSAGE, ownerId: f.messages[0].id, request }, devicesSender(f));
  await tick();
  replyControl(f, { ...request, ok: true, state: { paused: true, connection: 'disconnected',
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
