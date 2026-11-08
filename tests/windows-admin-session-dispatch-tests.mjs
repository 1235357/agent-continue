import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { serveAdministratorBrowser } from '../native/desktop-commander/windows-admin-browser-host.mjs';
import { readFrame, writeFrame } from '../native/desktop-commander/device-owner.mjs';

const origin = 'chrome-extension://' + 'a'.repeat(32) + '/';
test('native session attaches without demand and keeps its lifetime until input EOF', async () => {
  const input = new PassThrough(), output = new PassThrough();
  let called = 0, closed = 0, settle;
  const finished = new Promise(resolve => { settle = resolve; });
  const serve = serveAdministratorBrowser({ input, output, args: [origin], origin,
    start: () => assert.fail('session must not use legacy wake'),
    async openSession(wake, source) {
      assert.equal(wake, false); assert.equal(source, input); called++;
      input.once('end', settle); input.resume();
      return { isLive: () => true, finished, close: async () => { closed++; settle(); } };
    },
  });
  const response = readFrame(output, 1000);
  void serve.catch(() => {});
  await writeFrame(input, { version: 1, action: 'session', id: 'first', wake: false });
  assert.deepEqual(await response, { version: 1, action: 'session', id: 'first', outcome: 'attached' });
  assert.equal(called, 1); assert.equal(closed, 0);
  input.end(); await serve;
  assert.equal(closed, 1);
});

test('session rejects untyped wake, injected commands and unknown fields before any action', async () => {
  for (const extra of [{ wake: 'true' }, { command: 'start' }, { generation: 'b'.repeat(32) }]) {
    const input = new PassThrough(), output = new PassThrough();
    const serve = serveAdministratorBrowser({ input, output, args: [origin], origin,
      openSession: () => assert.fail('malformed session was dispatched'),
    });
    await writeFrame(input, { version: 1, action: 'session', id: 'invalid', wake: true, ...extra });
    await assert.rejects(serve, /invalid_administrator_browser_request/);
  }
});

test('failed session attach returns unconfirmed and does not fall back or replay a wake', async () => {
  const input = new PassThrough(), output = new PassThrough(); let attempts = 0;
  const serve = serveAdministratorBrowser({ input, output, args: [origin], origin,
    start: () => assert.fail('unexpected fallback'),
    openSession: async () => { attempts++; throw new Error('fixture'); },
  });
  const response = readFrame(output, 1000);
  void serve.catch(() => {});
  await writeFrame(input, { version: 1, action: 'session', id: 'unknown', wake: true });
  assert.deepEqual(await response, { version: 1, action: 'session', id: 'unknown', outcome: 'unconfirmed' });
  await serve; assert.equal(attempts, 1);
});
