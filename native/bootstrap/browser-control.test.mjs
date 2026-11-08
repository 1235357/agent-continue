import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import vm from 'node:vm';
import { createHmac, webcrypto } from 'node:crypto';
import { openBrowserControl } from './browser-control.mjs';

const id = '01234567-89ab-4cde-8fab-0123456789ab';

function request(origin, method, pathname, headers = {}, body = '') {
  return new Promise((resolve, reject) => {
    const req = http.request(origin + pathname, { method, headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.once('error', reject);
    req.end(body);
  });
}

async function fixture(t, onControl) {
  const calls = [];
  const session = await openBrowserControl(async input => {
    calls.push(input);
    return onControl ? onControl(input) : { ok: true, id: input.id, state: {
      connection: input.action === 'reconnect' ? 'ready' : 'disconnected', paused: input.action === 'disconnect-and-pause',
      operation: { status: 'settled' }, internalPath: 'do-not-return',
    }};
  });
  t.after(() => session.close());
  const headers = { Origin: session.origin, Authorization: 'Bearer ' + session.code, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' };
  return { session, calls, headers,
    post: (value, override = {}) => request(session.origin, 'POST', '/v1/control', { ...headers, ...override }, JSON.stringify(value)) };
}

test('embed route is opt-in and CSP authorizes only the installed extension origin', async t => {
  const unpaired = await fixture(t);
  assert.equal((await request(unpaired.session.origin, 'GET', '/embed')).status, 404);
  const extensionOrigin = 'chrome-extension://' + 'a'.repeat(32);
  const embedded = await openBrowserControl(async () => { throw new Error('GET mutated state'); }, { extensionOrigin });
  t.after(() => embedded.close());
  const response = await request(embedded.origin, 'GET', '/embed');
  assert.equal(response.status, 200);
  assert.ok(response.headers['content-security-policy'].endsWith('frame-ancestors ' + extensionOrigin));
  assert.match(response.text, /agent-continue-local-control/);
  assert.ok(!response.text.includes(embedded.code));
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  assert.match((await request(embedded.origin, 'GET', '/')).headers['content-security-policy'], /frame-ancestors 'none'/);
  for (const extensionOrigin of ['https://attacker.invalid', 'chrome-extension://*', 'chrome-extension://' + 'a'.repeat(32) + '/']) {
    await assert.rejects(openBrowserControl(async () => {}, { extensionOrigin }), /invalid_extension_origin/);
  }
});

test('serves a no-store loopback page with no embedded secret or cross-origin access', async t => {
  const { session, calls } = await fixture(t);
  assert.match(session.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(session.code, /^[A-Za-z0-9_-]{43}$/);
  const page = await request(session.origin, 'GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.text, /Disconnect and pause/);
  assert.ok(!page.text.includes(session.code));
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(page.headers['access-control-allow-origin'], undefined);
  assert.equal((await request(session.origin, 'GET', '/?code=anything')).status, 404);
  assert.equal((await request(session.origin, 'GET', '/', { Host: 'attacker.invalid' })).status, 403);
  assert.deepEqual(calls, []);
});

test('rejects rebinding, cross-site, unauthenticated, invalid body and unsupported command requests', async t => {
  const { session, calls, headers, post } = await fixture(t);
  const value = { id, action: 'reconnect' };
  for (const override of [{ Host: 'attacker.invalid' }, { Origin: 'https://attacker.invalid' }, { Origin: 'null' },
    { 'Sec-Fetch-Site': 'cross-site' }, { Authorization: 'Bearer wrong' }, { 'Content-Type': 'text/plain' }]) {
    assert.equal((await post(value, override)).status, 403);
  }
  for (const value of [{ id, action: 'shell' }, { id, action: 'status', command: 'dir' }, { id: 'not-a-uuid', action: 'status' }, ['status']]) {
    assert.equal((await post(value)).status, 400);
  }
  assert.equal((await request(session.origin, 'POST', '/v1/control', headers, '{')).status, 400);
  assert.equal((await request(session.origin, 'OPTIONS', '/v1/control', headers)).status, 404);
  assert.equal((await request(session.origin, 'GET', '/v1/control', headers)).status, 404);
  assert.equal((await post({ id, action: 'status', data: 'x'.repeat(1024) })).status, 413);
  assert.deepEqual(calls, []);
});

test('relays only the three lifecycle operations, preserves request IDs and redacts internal values', async t => {
  const { calls, post } = await fixture(t);
  for (const action of ['status', 'disconnect-and-pause', 'reconnect']) {
    const reply = await post({ id, action });
    assert.equal(reply.status, 200);
    assert.deepEqual(JSON.parse(reply.text), { ok: true, id, connection: action === 'reconnect' ? 'ready' : 'disconnected',
      paused: action === 'disconnect-and-pause', operationStatus: 'settled' });
  }
  assert.deepEqual(calls, ['status', 'disconnect-and-pause', 'reconnect'].map(action => ({ id, action })));
});

test('signed commands omit the bearer and accept each authenticated nonce at most once', async t => {
  const { session, calls } = await fixture(t);
  const sign = data => createHmac('sha256', session.code).update(JSON.stringify(data)).digest('hex');
  const action = 'reconnect', nonce = '0a234567-89ab-4cde-8fab-0123456789ab';
  const packet = { id, action, nonce, mac: sign(['ac-request-v1', session.origin, nonce, id, action]) };
  const post = body => request(session.origin, 'POST', '/v1/signed-control', { Origin: session.origin,
    'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, JSON.stringify(body));
  assert.ok(!JSON.stringify(packet).includes(session.code));
  assert.equal((await post({ ...packet, action: 'disconnect-and-pause' })).status, 403);
  const result = await post(packet);
  assert.equal(result.status, 200);
  const { payload, mac } = JSON.parse(result.text);
  assert.equal(mac, sign(['ac-reply-v1', session.origin, nonce, id, action, payload]));
  assert.equal(JSON.parse(payload).connection, 'ready');
  assert.equal((await post(packet)).status, 409);
  assert.deepEqual(calls, [{ id, action }]);
});

test('reports an unconfirmed operation without retrying or leaking exceptions', async t => {
  const { calls, post, session } = await fixture(t, () => { throw new Error('private exception'); });
  const response = await post({ id, action: 'reconnect' });
  assert.equal(response.status, 502);
  assert.deepEqual(JSON.parse(response.text), { ok: false, id, error: 'manager_control_unconfirmed' });
  assert.deepEqual(calls, [{ id, action: 'reconnect' }]);
  await session.close();
  await assert.rejects(post({ id, action: 'status' }), { code: 'ECONNREFUSED' });
});

test('page preserves an unresolved mutation and never claims an unconfirmed pause is stopped', async t => {
  const { session } = await fixture(t);
  const page = await request(session.origin, 'GET', '/');
  const source = page.text.match(/<script>([\s\S]+)<\/script>/)[1];
  const buttons = ['status', 'reconnect', 'disconnect-and-pause'].map(value => ({ value, disabled: false }));
  const state = {}, details = {}, calls = [];
  const elements = { form: { querySelectorAll: () => buttons, addEventListener: (_, fn) => { elements.submit = fn; } },
    '#code': { value: session.code }, '#state': state, '#details': details };
  const replies = [[502, { ok: false }], [403, { ok: false }],
    [200, { ok: true, connection: 'unknown', paused: true, operationStatus: 'unknown-running' }],
    [200, { ok: true, connection: 'disconnected', paused: true, operationStatus: 'settled' }]];
  vm.runInNewContext(source, { document: { querySelector: key => elements[key] }, crypto: { randomUUID: () => id, subtle: webcrypto.subtle },
    location: { origin: session.origin, port: new URL(session.origin).port }, TextEncoder, Uint8Array, setTimeout: () => 1, clearTimeout() {},
    fetch: async (_, init) => {
      const { id, action, nonce } = JSON.parse(init.body);
      calls.push({ id, action });
      const [status, value] = replies.shift();
      const payload = JSON.stringify({ ...value, id, expiresAt: Date.now() + 10000 });
      const mac = createHmac('sha256', session.code).update(JSON.stringify(['ac-reply-v1', session.origin, nonce, id, action, payload])).digest('hex');
      return { ok: status === 200, status, json: async () => ({payload, mac}) };
    } });
  const submit = value => elements.submit({ preventDefault() {}, submitter: buttons.find(button => button.value === value) });
  const port = new URL(session.origin).port;
  assert.equal(session.pairingTicket, `ACPAIR1:${port}:${session.code}`);
  elements['#code'].value = session.pairingTicket.replace(`:${port}:`, port === '50000' ? ':50001:' : ':50000:');
  await submit('disconnect-and-pause');
  assert.equal(state.textContent, 'Pairing code rejected');
  assert.deepEqual(calls, []);
  elements['#code'].value = session.code;
  await submit('disconnect-and-pause');
  assert.equal(buttons[1].disabled, true);
  await submit('reconnect');
  assert.equal(calls.length, 1);
  elements['#code'].value = session.pairingTicket;
  await submit('status');
  assert.match(details.textContent, new RegExp(id));
  await submit('status');
  assert.equal(state.textContent, 'Pause requested; stop unconfirmed');
  assert.equal(buttons[1].disabled, true);
  await submit('status');
  assert.equal(state.textContent, 'Paused');
  assert.equal(buttons[1].disabled, false);
  assert.deepEqual(calls.slice(1), Array.from({length:3}, () => ({ id, action: 'status' })));
});

test('session close rejects new connections but drains an already accepted response', async t => {
  const arrived = Promise.withResolvers(), finish = Promise.withResolvers();
  const { post, session } = await fixture(t, async () => {
    arrived.resolve();
    await finish.promise;
    return { ok: true, id, state: { connection: 'disconnected', paused: true } };
  });
  const result = post({ id, action: 'disconnect-and-pause' });
  await arrived.promise;
  const closing = session.close();
  try { await assert.rejects(post({ id, action: 'status' })); }
  finally { finish.resolve(); }
  assert.equal((await result).status, 200);
  await closing;
  await session.stopped;
});
