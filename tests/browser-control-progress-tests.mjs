import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import { bindBrowserWake, BROWSER_WAKE_HOST, BROWSER_DEVICE_PAGE } from '../browser-wake.js';
import { createDeviceController, PENDING_KEY, PRIORITY_PAUSE_KEY } from '../device-control.js';

const event = () => {
  const listeners = new Set();
  return { addListener: callback => listeners.add(callback), emit: value => {
    for (const callback of listeners) callback(value);
  } };
};
const memory = () => {
  const data = {};
  return { data, async get(keys) {
    return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(data[key])]));
  }, async set(values) { Object.assign(data, structuredClone(values)); }, async remove(key) { delete data[key]; } };
};

test('actual page and worker modules reconcile two separate receipts after a non-returning Reconnect', async t => {
  const origin = 'chrome-extension://' + 'a'.repeat(32) + '/';
  const local = memory(), session = memory(), ports = [], posted = [], attached = [];
  let wake, paused = false, primaryId, primarySettled = false;
  const api = {
    extension: { inIncognitoContext: false },
    runtime: {
      id: 'a'.repeat(32), getURL: page => origin + page, getPlatformInfo: async () => ({ os: 'win' }), onStartup: event(),
      connectNative(host) {
        assert.equal(host, BROWSER_WAKE_HOST);
        const port = { onMessage: event(), onDisconnect: event(), disconnect() {}, postMessage(request) {
          posted.push(structuredClone(request));
          if (request.action === 'wake') queueMicrotask(() => port.onMessage.emit({ ...request, ok: true }));
          else if (request.action === 'status') queueMicrotask(() => port.onMessage.emit({ ...request, ok: true,
            state: { paused, connection: paused ? 'disconnected' : 'ready' } }));
          else if (request.action === 'reconnect') primaryId = request.id;
          else assert.fail('priority Pause must not queue behind the original port');
        } };
        ports.push(port); return port;
      },
      async sendNativeMessage(host, frame) {
        assert.equal(host, BROWSER_WAKE_HOST);
        assert.equal(frame.action, 'attach-control'); assert.equal(frame.version, 2);
        assert.equal(frame.ownerId, posted[0].id);
        attached.push(structuredClone(frame));
        const request = frame.request;
        let operation;
        if (request.action === 'disconnect-and-pause') {
          paused = true; operation = { id: request.id, action: request.action, status: 'settled' };
        } else if (request.id === primaryId) operation = {
          id: primaryId, action: 'reconnect', status: primarySettled ? 'settled' : 'unknown-running',
        };
        else assert.fail('no invented status request or mutation replay');
        return { version: 2, action: 'attach-control', ownerId: frame.ownerId, response: { ...request, ok: true,
          state: { paused, connection: paused ? 'disconnected' : 'unknown', operation } } };
      },
      sendMessage: message => wake.handleMessage(message, { id: 'a'.repeat(32), url: origin + BROWSER_DEVICE_PAGE, frameId: 0 }),
    },
    storage: { session, local }, permissions: { async contains() { return true; }, onRemoved: event(), onAdded: event() },
    alarms: { onAlarm: event(), async create() {}, async clear() {} },
  };
  wake = bindBrowserWake(api);
  t.after(() => { for (const port of ports) port.onDisconnect.emit(); });
  await tick();
  let lockTail = Promise.resolve();
  const controller = createDeviceController({ ...api, storage: local, browserManaged: true, timeoutMs: 100,
    locks: { request(name, run) {
      const result = lockTail.then(run); lockTail = result.catch(() => {}); return result;
    } } });
  await controller.initialize(); await controller.run('status');
  assert.equal(controller.getState().canMutate, true);
  const reconnect = controller.run('reconnect');
  await tick();
  assert.ok(primaryId);
  const primary = structuredClone(local.data[PENDING_KEY + ':browser-managed']);
  assert.equal(controller.getState().canPause, true);
  await controller.run('disconnect-and-pause');
  assert.equal(paused, true);
  assert.equal(controller.getState().priorityPause, null, 'exact Pause receipt settles only its page slot');
  assert.deepEqual(controller.getState().pending, primary);
  assert.deepEqual(session.data.deviceBrowserWakeMutationV1, { ownerId: posted[0].id, version: 1,
    id: primaryId, action: 'reconnect' });
  assert.equal(session.data.deviceBrowserWakePriorityPauseV1, false);
  assert.equal(local.data[PRIORITY_PAUSE_KEY + ':browser-managed'], null);
  await reconnect;
  primarySettled = true;
  await controller.run('status');
  assert.equal(controller.getState().pending, null);
  assert.equal(session.data.deviceBrowserWakeMutationV1, false);
  assert.equal(controller.getState().observation.paused, true);
  assert.equal(ports.length, 1);
  assert.equal(posted.filter(request => request.action === 'reconnect').length, 1);
  assert.deepEqual(attached.map(frame => frame.request.action), ['disconnect-and-pause', 'status']);
});
