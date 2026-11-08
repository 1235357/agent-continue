import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, CancelledNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { prepareState } from './runtime.mjs';
import { openController } from './lifecycle.mjs';
import { createWindowsAdministratorAdmission, openWindowsAdministratorAdmission, observeWindowsAdministratorOwner,
  startWindowsAdministratorOwner } from './windows-admin-owner.mjs';
import { fenceToolReplays } from './host.mjs';
import * as receiptStore from './operation-receipts.mjs';

const digest = 'a'.repeat(64);
const sid = 'S-1-5-21-1-2-3-1001';
const encode = value => JSON.stringify(value) + '\n';

test('browser-required owner cannot open its controller before a live peer is verified', async t => {
  const f = fixture(t); addBrowserBinding(f);
  let checks = 0;
  await assert.rejects(startWindowsAdministratorOwner({ bundle: f.bundle, selectedSid: sid, env: {},
    generation: '8'.repeat(32), browserRequired: true }, {
    openBrowserSession: async () => { checks++; throw new Error('browser_peer_unavailable'); },
    openController: () => { assert.fail('provider controller opened without peer proof'); },
  }), /browser_peer_unavailable/);
  assert.equal(checks, 1);
});

test('browser lifetime loss disposes the owner without pause and closes its witness', async t => {
  const f = fixture(t), generation = '9'.repeat(32); addBrowserBinding(f);
  const before = fs.readFileSync(f.state, 'utf8');
  let lost, sessionClosed = 0, active = true;
  const finished = new Promise(resolve => { lost = resolve; });
  const owner = await startWindowsAdministratorOwner({ bundle: f.bundle, selectedSid: sid, env: {},
    generation, browserRequired: true }, {
    openBrowserSession: async () => ({ isLive: () => active, finished, close() { sessionClosed++; } }),
    openController(root, options) {
      assert.equal(root, f.root);
      active = true;
      return {
        status: async () => ({ paused: false, ready: active, runtime: active ? 'running' : 'stopped' }),
        startSavedIntent: async authorize => { if (authorize()) f.events.push('launch'); },
        dispose: async () => { active = false; f.events.push('dispose'); },
        pause: async () => assert.fail('browser loss is not user pause'),
        reconnect: async () => assert.fail('browser session must not clear pause'),
      };
    },
  });
  t.after(() => owner.close?.());
  assert.equal(owner.status, 'ready');
  assert.deepEqual(f.events, ['launch']);
  lost();
  const result = await Promise.race([owner.finished, delay(2000).then(() => ({ status: 'test-timeout' }))]);
  assert.equal(result.status, 'browser-closed');
  assert.deepEqual(f.events, ['launch', 'dispose']);
  assert.equal(sessionClosed, 1);
  assert.equal(fs.readFileSync(f.state, 'utf8'), before);
  assert.equal(createWindowsAdministratorAdmission(f.root, sid)(), false, 'metadata alone cannot admit browser commands');
});

function addBrowserBinding(f) {
  fs.mkdirSync(f.bundle + '.browser');
  fs.writeFileSync(path.join(f.bundle + '.browser', 'binding.json'), encode({ version: 1, bundleSha256: digest,
    origin: 'chrome-extension://' + 'b'.repeat(32) + '/', systemDirectory: 'C:\\Windows\\System32' }));
  fs.writeFileSync(path.join(f.bundle + '.browser', 'enrolled.json'), JSON.stringify({ version: 1, bundleSha256: digest }));
}

test('each provider pins a separate live witness and cannot recover admission after its loss', async t => {
  const f = fixture(t); addBrowserBinding(f);
  let live = true, closes = 0;
  const generation = '7'.repeat(32);
  const provider = await openWindowsAdministratorAdmission(f.root, { selectedSid: sid, generation,
    openBrowserSession: async args => {
      assert.equal(args.role, 'Provider'); assert.equal(args.generation, generation);
      return { isLive: () => live, finished: new Promise(() => {}), close: async () => { closes++; } };
    },
  });
  t.after(() => provider.close());
  assert.equal(provider.canAdmit(), true);
  live = false; assert.equal(provider.canAdmit(), false);
  live = true; assert.equal(provider.canAdmit(), false);
  assert.equal(closes, 0);
});

test('partial browser enrollment cannot downgrade to a maintenance owner or provider', async t => {
  const f = fixture(t); fs.mkdirSync(f.bundle + '.browser');
  await assert.rejects(f.run(), /admin_owner_authorization_invalid/);
  await assert.rejects(openWindowsAdministratorAdmission(f.root, { selectedSid: sid, generation: '7'.repeat(32),
    openBrowserSession: async () => assert.fail('missing binding was accepted') }));
  assert.equal(createWindowsAdministratorAdmission(f.root, sid)(), false);
});

test('browser loss while first status is pending cannot acquire a journal after disposal', async t => {
  const f = fixture(t); addBrowserBinding(f);
  let lost, statusReady, calls = 0;
  const browserFinished = new Promise(resolve => { lost = resolve; });
  const firstStatus = new Promise(resolve => { statusReady = resolve; });
  const pending = startWindowsAdministratorOwner({ bundle: f.bundle, selectedSid: sid, env: {}, generation: '6'.repeat(32) }, {
    openBrowserSession: async () => ({ isLive: () => true, finished: browserFinished, close: async () => {} }),
    openController: () => ({ status: () => { calls++; return firstStatus; },
      startSavedIntent: async () => assert.fail('disposed startup continued'),
      reconnect: async () => {}, pause: async () => assert.fail('unexpected pause'), dispose: async () => {} }),
  });
  while (!calls) await delay(1);
  lost(); await delay(5);
  statusReady({ paused: false, ready: false, runtime: 'stopped' });
  assert.equal((await pending).status, 'browser-closed');
  assert.equal(fs.existsSync(path.join(f.root, 'device-operations.lease')), false);
});

test('owner shutdown closes the independent witness before waiting for controller disposal', async t => {
  const f = fixture(t); addBrowserBinding(f);
  let closeWitness = 0, finishDispose;
  const disposal = new Promise(resolve => { finishDispose = resolve; });
  const owner = await startWindowsAdministratorOwner({ bundle: f.bundle, selectedSid: sid, env: {}, generation: '5'.repeat(32) }, {
    openBrowserSession: async () => ({ isLive: () => true, finished: new Promise(() => {}),
      close: () => { closeWitness++; return Promise.resolve(); } }),
    openController: () => ({ status: async () => ({ paused: false, ready: true, runtime: 'running' }),
      startSavedIntent: async () => {}, reconnect: async () => {}, pause: async () => {}, dispose: () => disposal }),
  });
  t.after(() => { finishDispose(); return owner.close(); });
  const closing = owner.close();
  assert.equal(closeWitness, 1, 'provider channels must be closed before a slow controller can block cleanup');
  finishDispose(); await closing;
});

test('provider cannot downgrade if enrollment disappears during native witness acquisition', async t => {
  const f = fixture(t); addBrowserBinding(f);
  let closes = 0;
  await assert.rejects(openWindowsAdministratorAdmission(f.root, { selectedSid: sid, generation: '4'.repeat(32),
    openBrowserSession: async () => {
      fs.rmSync(f.bundle + '.browser', { recursive: true });
      return { isLive: () => true, close: async () => { closes++; }, finished: new Promise(() => {}) };
    },
  }), /admin_owner_authorization_invalid/);
  assert.equal(closes, 1);
});

test('provider pins enrollment origin and commit identity and permanently denies replacement', async t => {
  for (const name of ['binding.json', 'enrolled.json']) {
    const f = fixture(t); addBrowserBinding(f);
    const provider = await openWindowsAdministratorAdmission(f.root, { selectedSid: sid, generation: '3'.repeat(32),
      openBrowserSession: async () => ({ isLive: () => true, close: async () => {}, finished: new Promise(() => {}) }),
    });
    t.after(() => provider.close());
    assert.equal(provider.canAdmit(), true);
    const file = path.join(f.bundle + '.browser', name), bytes = fs.readFileSync(file);
    fs.renameSync(file, file + '.old'); fs.writeFileSync(file, bytes);
    assert.equal(provider.canAdmit(), false);
    fs.unlinkSync(file); fs.renameSync(file + '.old', file);
    assert.equal(provider.canAdmit(), false);
  }
});

function fixture(t, { paused = false, activated = true, pending = false, guarded = true } = {}) {
  const top = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'ac-admin-owner-test-'));
  t.after(() => fs.rmSync(top, { recursive: true, force: true }));
  const bundle = path.join(top, digest.slice(0, 24));
  const root = bundle + '.state', vault = bundle + '.secrets';
  fs.mkdirSync(bundle); fs.mkdirSync(vault);
  prepareState(root, { consent: 'full-account' });
  const admin = { format: 'agent-continue-administrator-state', version: 1, bundleSha256: digest,
    userSid: sid, scope: 'full-account', initiallyPaused: true };
  const profile = { control_plane: { base_url: 'https://api.openai.com',
    tunnel_id: 'tunnel_' + 'b'.repeat(32), api_key: 'file:' + path.join(vault, 'runtime.key') } };
  const proofBytes = encode(profile), proofSha256 = createHash('sha256').update(proofBytes).digest('hex');
  const profileBytes = encode({ ...profile, mcp: { commands: [
    { channel: 'main', command: 'fixture-host' + (guarded ? ' --administrator-owner' : '') },
  ] } });
  const profileSha256 = createHash('sha256').update(profileBytes).digest('hex');
  fs.writeFileSync(path.join(root, 'administrator.json'), encode(admin));
  fs.writeFileSync(path.join(vault, 'tunnel.yaml'), proofBytes);
  fs.writeFileSync(path.join(vault, 'owner-tunnel.yaml'), profileBytes);
  fs.writeFileSync(path.join(vault, 'binding.json'), encode({ format: 'agent-continue-administrator-hosted-binding',
    version: 1, bundleSha256: digest, userSid: sid, profileSha256: proofSha256, activationAuthorized: false }));
  const activation = path.join(vault, 'owner-activation.json');
  const revoked = path.join(vault, 'owner-revoked');
  if (activated) fs.writeFileSync(activation, encode({ format: 'agent-continue-windows-admin-activation',
    version: 1, bundleSha256: digest, userSid: sid, profileSha256, scope: 'full-account' }));
  const state = path.join(root, 'lifecycle.json');
  fs.writeFileSync(state, encode({ format: 'agent-continue-lifecycle', version: 1, paused }));
  if (pending) fs.writeFileSync(path.join(root, 'device-operations.jsonl'),
    encode({ format: 'agent-continue-device-operations', version: 1 }) +
    encode({ id: 'unknown-control', action: 'reconnect', status: 'in-progress' }));
  const events = [];
  let active = false;
  const controller = {
    async status() { return { paused, ready: active, runtime: active ? 'running' : 'stopped' }; },
    async startSavedIntent(authorize) {
      events.push('consider-wake');
      if (authorize()) { active = true; events.push('launch'); }
    },
    async reconnect() { assert.fail('wake must never invoke reconnect'); },
    async pause() { assert.fail('wake must never rewrite the saved intent'); },
    async dispose() { active = false; events.push('dispose'); },
  };
  const run = extra => startWindowsAdministratorOwner({ bundle, selectedSid: sid, env: {} },
    { openController(rootObserved, options) {
      assert.equal(rootObserved, root);
      assert.equal(options.deferStartup, true);
      assert.equal(options.maxRestarts, 0);
      events.push('open');
      if (extra) extra(options);
      return controller;
    } });
  return { run, bundle, root, vault, state, activation, revoked, events };
}

test('proof binding without separate activation cannot start a product owner', async t => {
  const f = fixture(t, { activated: false });
  await assert.rejects(f.run(), /admin_owner_authorization_invalid/);
  assert.deepEqual(f.events, []);
});

test('even a matching grant cannot start an owner profile missing its provider guard', async t => {
  const f = fixture(t, { guarded: false });
  await assert.rejects(f.run(), /admin_owner_authorization_invalid/);
  assert.deepEqual(f.events, []);
});

test('native wake uses the exact approved profile and preserves saved running intent', async t => {
  const f = fixture(t);
  const original = fs.readFileSync(f.state, 'utf8');
  const owner = await f.run(options => {
    const launch = options.launch();
    assert.deepEqual(launch.args, ['run', '--profile-file', path.join(f.vault, 'owner-tunnel.yaml')]);
    assert.equal(launch.cwd, path.join(f.root, 'work'));
    assert.equal(launch.env.AC_ADMIN_BOOT_APP_ROOT, path.join(f.bundle, 'app'));
  });
  t.after(() => owner.close());
  assert.equal(owner.status, 'ready');
  assert.deepEqual(f.events, ['open', 'consider-wake', 'launch']);
  await owner.close();
  assert.deepEqual(f.events, ['open', 'consider-wake', 'launch', 'dispose']);
  assert.equal(fs.readFileSync(f.state, 'utf8'), original);
});

test('pause and uncertain journal refuse auto start and release only their own leases', async t => {
  for (const [input, status] of [[{ paused: true }, 'paused'], [{ pending: true }, 'unsettled']]) {
    const f = fixture(t, input);
    const owner = await f.run();
    assert.equal(owner.status, status);
    assert.deepEqual(f.events, ['open', 'dispose']);
    assert.equal(fs.existsSync(path.join(f.root, 'device-operations.lease')), false);
  }
});

test('profile replacement or revoked activation refuses to start', async t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.vault, 'owner-tunnel.yaml'), '\n');
  await assert.rejects(f.run(), /admin_owner_authorization_invalid/);
  assert.deepEqual(f.events, []);
  const g = fixture(t);
  const owner = await g.run(() => fs.unlinkSync(g.activation));
  assert.equal(owner.status, 'unauthorized');
  assert.deepEqual(g.events, ['open', 'consider-wake', 'dispose']);
});

test('a revoked administrator admission never reopens, even if the signal disappears', t => {
  const f = fixture(t);
  const canAdmit = createWindowsAdministratorAdmission(f.root, sid);
  assert.equal(canAdmit(), true);
  fs.writeFileSync(f.revoked, '', { flag: 'wx' });
  assert.equal(canAdmit(), false);
  fs.unlinkSync(f.revoked);
  assert.equal(canAdmit(), false);
});

test('an existing deny marker prevents both owner wake and provider admission', async t => {
  const f = fixture(t);
  fs.mkdirSync(f.revoked);
  assert.throws(() => createWindowsAdministratorAdmission(f.root, sid), /admin_owner_authorization_invalid/);
  await assert.rejects(f.run(), /admin_owner_authorization_invalid/);
  assert.deepEqual(f.events, []);
});

test('admission follows durable pause without rewriting it', t => {
  const f = fixture(t);
  const canAdmit = createWindowsAdministratorAdmission(f.root, sid);
  assert.equal(canAdmit(), true);
  fs.writeFileSync(f.state, encode({ format: 'agent-continue-lifecycle', version: 1, paused: true }));
  assert.equal(canAdmit(), false);
  fs.writeFileSync(f.state, '{}');
  assert.equal(canAdmit(), false);
});

test('Windows provider accepts the same exact state using its tunnel command path spelling',
  { skip: process.platform !== 'win32' }, t => {
    const f = fixture(t);
    const profileState = f.root.replaceAll('\\', '/');
    const allowed = createWindowsAdministratorAdmission(profileState, sid);
    assert.equal(allowed(), true);
    fs.writeFileSync(f.revoked, '', { flag: 'wx' });
    assert.equal(allowed(), false);
  });

test('Windows provider path spelling cannot introduce traversal or a mixed path',
  { skip: process.platform !== 'win32' }, t => {
    const f = fixture(t);
    const profileState = f.root.replaceAll('\\', '/');
    const escaped = profileState.replace(/([^/]+)$/, 'unused/../$1');
    const mixed = profileState.replace('/', '\\');
    for (const input of [escaped, mixed, '//server/share/' + path.basename(f.root)]) {
      assert.throws(() => createWindowsAdministratorAdmission(input, sid), /admin_owner_authorization_invalid/);
    }
  });

test('owner observation binds a fresh probe to one generation and invalidates readiness', async t => {
  const f = fixture(t);
  const generation = 'c'.repeat(32);
  const file = path.join(f.vault, 'owner-observation-' + generation + '.json');
  let healthy = true;
  const publish = observeWindowsAdministratorOwner(f.bundle, generation, async () => healthy);
  assert.equal(fs.existsSync(file), false);
  await publish();
  const { bootMs, ...first } = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(Math.abs(bootMs - os.uptime() * 1000) < 1500);
  assert.deepEqual(first, { version: 1, generation, pid: process.pid, sequence: 1, ready: true });
  healthy = false;
  await publish();
  const { bootMs: nextBootMs, ...second } = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(nextBootMs >= bootMs);
  assert.deepEqual(second, { version: 1, generation, pid: process.pid, sequence: 2, ready: false });
  assert.throws(() => observeWindowsAdministratorOwner(f.bundle, '../unsafe', async () => true));
});

test('revocation denies a new provider call before reservation without stealing an in-flight reply', async t => {
  const f = fixture(t);
  const delivered = [], replies = [];
  const transport = {
    start() {},
    onmessage(request) { delivered.push(request); },
    async send(reply) { replies.push(reply); },
  };
  fenceToolReplays(transport, f.root, null, null, receiptStore, createWindowsAdministratorAdmission(f.root, sid));
  transport.start();
  const operation = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const deniedOperation = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'write_file', arguments: { agent_continue_operation_id: operation } } };
  transport.onmessage(request);
  fs.writeFileSync(f.revoked, '', { flag: 'wx' });
  transport.onmessage(request);
  transport.onmessage({ ...request, id: 2,
    params: { ...request.params, arguments: { agent_continue_operation_id: deniedOperation } } });
  const { id, ...notification } = request;
  transport.onmessage(notification);
  assert.equal(delivered.length, 1);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].id, 2);
  assert.equal(replies[0].error.code, -32075);
  await transport.send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'test' }] } });
  const receipts = receiptStore.createOperationReceipts(f.root);
  assert.deepEqual(receipts.lookup(operation), { status: 'provider-reported-result' });
  assert.deepEqual(receipts.lookup(deniedOperation), { status: 'not-recorded' });
});

for (const action of ['pause', 'revoke']) {
  test(`${action} committed during a durable reservation prevents dispatch`, t => {
    const f = fixture(t);
    const delivered = [], replies = [];
    const transport = {
      start() {},
      onmessage(request) { delivered.push(request); },
      async send(reply) { replies.push(reply); },
    };
    const operation = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const actual = receiptStore.createOperationReceipts(f.root);
    const store = { ...receiptStore, createOperationReceipts: () => ({
      ...actual,
      reserve(id, kind) {
        const receipt = actual.reserve(id, kind);
        if (action === 'revoke') fs.writeFileSync(f.revoked, '', { flag: 'wx' });
        else fs.writeFileSync(f.state, encode({ format: 'agent-continue-lifecycle', version: 1, paused: true }));
        return receipt;
      },
    }) };
    fenceToolReplays(transport, f.root, null, null, store, createWindowsAdministratorAdmission(f.root, sid));
    transport.start();
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'write_file', arguments: { agent_continue_operation_id: operation } } };
    transport.onmessage(request);
    assert.deepEqual(delivered, []);
    assert.equal(replies[0]?.error?.code, -32075);
    assert.deepEqual(receiptStore.createOperationReceipts(f.root).lookup(operation), { status: 'blocked-by-local-control' });
    if (action === 'pause') {
      fs.writeFileSync(f.state, encode({ format: 'agent-continue-lifecycle', version: 1, paused: false }));
      transport.onmessage({ ...request, id: 2 });
      assert.equal(replies.at(-1)?.error?.code, -32070);
      assert.deepEqual(delivered, []);
    }
  });

  test(`${action} committed in the pinned SDK queue prevents the tool handler from starting`,
    { timeout: 5000 }, async t => {
      const f = fixture(t);
      const work = path.join(f.root, 'work', 'must-not-run.txt');
      const operation = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      let reply;
      const replyPromise = new Promise(resolve => { reply = resolve; });
      const transport = { async start() {}, async close() {}, async send(value) { reply(value); } };
      const server = new Server({ name: 'sdk-queue-test', version: '1.0.0' }, { capabilities: { tools: {} } });
      server.setRequestHandler(CallToolRequestSchema, async () => {
        fs.writeFileSync(work, 'handler started');
        return { content: [{ type: 'text', text: 'executed' }] };
      });
      fenceToolReplays(transport, f.root, null, null, receiptStore, createWindowsAdministratorAdmission(f.root, sid), server, CancelledNotificationSchema);
      await server.connect(transport);
      t.after(() => server.close());
      transport.onmessage({ jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'write_file', arguments: { agent_continue_operation_id: operation } } });
      const receipts = receiptStore.createOperationReceipts(f.root);
      assert.deepEqual(receipts.lookup(operation), { status: 'admitted-outcome-unconfirmed' });
      assert.equal(fs.existsSync(work), false);
      if (action === 'revoke') fs.writeFileSync(f.revoked, '', { flag: 'wx' });
      else fs.writeFileSync(f.state, encode({ format: 'agent-continue-lifecycle', version: 1, paused: true }));
      const result = await replyPromise;
      assert.equal(fs.existsSync(work), false);
      assert.equal(result.error?.code, -32075);
      assert.deepEqual(receipts.lookup(operation), { status: 'blocked-by-local-control' });
    });
}

test('the pinned SDK can finish a handler that started before local pause without admitting a second call',
  { timeout: 5000 }, async t => {
    const f = fixture(t);
    const replies = new Map();
    const transport = {
      async start() {}, async close() {},
      async send(value) { replies.get(value.id)?.(value); },
    };
    const server = new Server({ name: 'sdk-queue-test', version: '1.0.0' }, { capabilities: { tools: {} } });
    let started, finish, entered = 0;
    const running = new Promise(resolve => { started = resolve; });
    const completion = new Promise(resolve => { finish = resolve; });
    server.setRequestHandler(CallToolRequestSchema, async () => {
      entered++;
      started();
      await completion;
      return { content: [{ type: 'text', text: 'already started' }] };
    });
    fenceToolReplays(transport, f.root, null, null, receiptStore, createWindowsAdministratorAdmission(f.root, sid), server, CancelledNotificationSchema);
    await server.connect(transport);
    t.after(() => server.close());
    const send = (id, operation) => new Promise(resolve => {
      replies.set(id, resolve);
      transport.onmessage({ jsonrpc: '2.0', id, method: 'tools/call',
        params: { name: 'write_file', arguments: { agent_continue_operation_id: operation } } });
    });
    const original = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const successor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const first = send(1, original);
    await running;
    fs.writeFileSync(f.state, encode({ format: 'agent-continue-lifecycle', version: 1, paused: true }));
    assert.equal((await send(2, successor)).error?.code, -32075);
    finish();
    assert.deepEqual((await first).result?.content, [{ type: 'text', text: 'already started' }]);
    const receipts = receiptStore.createOperationReceipts(f.root);
    assert.deepEqual(receipts.lookup(original), { status: 'provider-reported-result' });
    assert.deepEqual(receipts.lookup(successor), { status: 'not-recorded' });
    assert.equal(entered, 1);
  });

test('a cancelled SDK queue entry cannot borrow the admission of a reused RPC ID (including zero)',
  { timeout: 5000 }, async t => {
    const f = fixture(t);
    const delivered = [];
    let reply;
    const replyPromise = new Promise(resolve => { reply = resolve; });
    const transport = { async start() {}, async close() {}, async send(value) { reply(value); } };
    const server = new Server({ name: 'sdk-queue-test', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(CallToolRequestSchema, async request => {
      delivered.push(request.params.arguments?.path);
      return { content: [{ type: 'text', text: 'executed' }] };
    });
    fenceToolReplays(transport, f.root, null, null, receiptStore, createWindowsAdministratorAdmission(f.root, sid), server, CancelledNotificationSchema);
    await server.connect(transport);
    t.after(() => server.close());
    const oldId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const newId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const call = (operation, file) => transport.onmessage({ jsonrpc: '2.0', id: 0, method: 'tools/call',
      params: { name: 'write_file', arguments: { path: file, agent_continue_operation_id: operation } } });
    call(oldId, 'cancelled');
    transport.onmessage({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 0 } });
    queueMicrotask(() => call(newId, 'new'));
    const result = await replyPromise;
    assert.deepEqual(delivered, ['new']);
    assert.deepEqual(result.result?.content, [{ type: 'text', text: 'executed' }]);
    const receipts = receiptStore.createOperationReceipts(f.root);
    assert.deepEqual(receipts.lookup(oldId), { status: 'admitted-outcome-unconfirmed' });
    assert.deepEqual(receipts.lookup(newId), { status: 'provider-reported-result' });
  });

test('an invalid SDK cancellation cannot release the old request slot or steal its receipt',
  { timeout: 5000 }, async t => {
    const f = fixture(t);
    let entered, finish, reply;
    const started = new Promise(resolve => { entered = resolve; });
    const done = new Promise(resolve => { finish = resolve; });
    const answered = new Promise(resolve => { reply = resolve; });
    const delivered = [];
    const transport = { async start() {}, async close() {}, async send(value) { reply(value); } };
    const server = new Server({ name: 'sdk-queue-test', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.onerror = () => {};
    server.setRequestHandler(CallToolRequestSchema, async request => {
      delivered.push(request.params.arguments?.path);
      entered();
      await done;
      return { content: [{ type: 'text', text: 'original result' }] };
    });
    fenceToolReplays(transport, f.root, null, null, receiptStore, createWindowsAdministratorAdmission(f.root, sid), server, CancelledNotificationSchema);
    await server.connect(transport);
    t.after(() => server.close());
    const original = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const successor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const call = (operation, file) => transport.onmessage({ jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'write_file', arguments: { path: file, agent_continue_operation_id: operation } } });
    call(original, 'original');
    await started;
    transport.onmessage({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1, reason: 7 } });
    await Promise.resolve();
    call(successor, 'too early');
    finish();
    await answered;
    assert.deepEqual(delivered, ['original']);
    const receipts = receiptStore.createOperationReceipts(f.root);
    assert.deepEqual(receipts.lookup(original), { status: 'provider-reported-result' });
    assert.deepEqual(receipts.lookup(successor), { status: 'not-recorded' });
  });

test('an unmatched SDK cancellation cannot be applied to a later call',
  { timeout: 5000 }, async t => {
    const f = fixture(t);
    let reply;
    const answered = new Promise(resolve => { reply = resolve; });
    const transport = { async start() {}, async close() {}, async send(value) { reply(value); } };
    const server = new Server({ name: 'sdk-queue-test', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'later result' }] }));
    fenceToolReplays(transport, f.root, null, null, receiptStore, createWindowsAdministratorAdmission(f.root, sid), server, CancelledNotificationSchema);
    await server.connect(transport);
    t.after(() => server.close());
    const operation = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    transport.onmessage({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } });
    transport.onmessage({ jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'write_file', arguments: { agent_continue_operation_id: operation } } });
    const result = await Promise.race([answered, delay(150, null, { ref: false })]);
    assert.deepEqual(result?.result?.content, [{ type: 'text', text: 'later result' }]);
    assert.deepEqual(receiptStore.createOperationReceipts(f.root).lookup(operation), { status: 'provider-reported-result' });
  });

for (const administrator of [true, false]) test(`the next ${administrator ? 'administrator' : 'ordinary'} SDK call can reuse an answered wire ID before stdout drains`,
  { timeout: 5000 }, async t => {
    const f = fixture(t);
    const input = new PassThrough();
    const replies = [];
    let releaseWrite, notifyFirst, notifySecond, notifyEntered, finishSuccessor;
    const firstWritten = new Promise(resolve => { notifyFirst = resolve; });
    const secondWritten = new Promise(resolve => { notifySecond = resolve; });
    const successorEntered = new Promise(resolve => { notifyEntered = resolve; });
    const allowSuccessorResult = new Promise(resolve => { finishSuccessor = resolve; });
    const output = new Writable({ highWaterMark: 1, write(chunk, _encoding, done) {
      replies.push(JSON.parse(chunk.toString()));
      if (replies.length === 1) {
        releaseWrite = done;
        notifyFirst();
      } else {
        notifySecond();
        done();
      }
    } });
    const transport = new StdioServerTransport(input, output);
    const server = new Server({ name: 'sdk-backpressure-test', version: '1.0.0' }, { capabilities: { tools: {} } });
    t.after(async () => {
      finishSuccessor();
      releaseWrite?.();
      await server.close();
      input.destroy();
      output.destroy();
    });
    const received = [];
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const file = request.params.arguments?.path;
      received.push(file);
      if (file === 'second') {
        notifyEntered(extra.signal);
        await allowSuccessorResult;
      }
      return { content: [{ type: 'text', text: file }] };
    });
    fenceToolReplays(transport, f.root, null, null, receiptStore,
      administrator ? createWindowsAdministratorAdmission(f.root, sid) : null, server, CancelledNotificationSchema);
    await server.connect(transport);
    const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const overlapping = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const call = (operation, file) => input.write(encode({ jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: { name: 'write_file', arguments: { path: file, agent_continue_operation_id: operation } } }));
    call(first, 'first');
    await firstWritten;
    assert.equal(output.writableNeedDrain, true);
    input.write(encode({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7 } }) +
      encode({ jsonrpc: '2.0', id: 7, method: 'tools/call',
        params: { name: 'write_file', arguments: { path: 'second', agent_continue_operation_id: second } } }));
    call(overlapping, 'overlapping');
    const successorSignal = await Promise.race([successorEntered, delay(500, null, { ref: false })]);
    assert.ok(successorSignal instanceof AbortSignal);
    assert.deepEqual(received, ['first', 'second']);
    const drained = once(output, 'drain');
    const finish = releaseWrite;
    releaseWrite = undefined;
    finish();
    await drained;
    await delay(0);
    const receipts = receiptStore.createOperationReceipts(f.root);
    assert.equal(server._requestHandlerAbortControllers.get(7)?.signal, successorSignal);
    assert.equal(successorSignal.aborted, false);
    assert.deepEqual(receipts.lookup(first), { status: 'provider-reported-result' });
    assert.deepEqual(receipts.lookup(second), { status: 'admitted-outcome-unconfirmed' });
    finishSuccessor();
    assert.equal(await Promise.race([secondWritten.then(() => 'written'), delay(500, null, { ref: false })]), 'written');
    assert.deepEqual(replies.map(reply => reply.result?.content[0]?.text), ['first', 'second']);
    for (const operation of [first, second]) assert.deepEqual(receipts.lookup(operation), { status: 'provider-reported-result' });
    assert.deepEqual(receipts.lookup(overlapping), { status: 'not-recorded' });
  });

test('revocation interrupts startup before readiness', { timeout: 10000 }, async t => {
  const f = fixture(t);
  let child;
  t.after(() => { if (child && child.exitCode === null && child.signalCode === null) child.kill(); });
  const result = await startWindowsAdministratorOwner({ bundle: f.bundle, selectedSid: sid, env: {} },
    { openController(root, options) {
      return openController(root, { ...options, readyTimeoutMs: 5000, stopTimeoutMs: 3500,
        spawn(_command, _args, opts) {
          child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], opts);
          child.once('spawn', () => fs.writeFileSync(f.revoked, '', { flag: 'wx' }));
          return child;
        },
        async observeCore(pid) { return { pid, startTime: '1', executable: process.execPath }; },
        async hasExited() { return child && (child.exitCode !== null || child.signalCode !== null); },
      });
    } });
  assert.deepEqual(result, { status: 'revoked' });
  assert.notEqual(child.exitCode ?? child.signalCode, null);
  assert.equal(fs.existsSync(path.join(f.root, 'controller.lease')), false);
});

test('durable pause also closes an already ready owner without altering intent', async t => {
  const f = fixture(t);
  const owner = await f.run();
  t.after(() => owner.close());
  const pause = encode({ format: 'agent-continue-lifecycle', version: 1, paused: true });
  fs.writeFileSync(f.state, pause);
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('pause did not close the owner')), 2200);
    owner.finished.then(value => { clearTimeout(timeout); resolve(value); });
  });
  assert.deepEqual(result, { status: 'paused' });
  assert.equal(fs.readFileSync(f.state, 'utf8'), pause);
});

async function waitFor(observe, message) {
  const deadline = performance.now() + 3000;
  do {
    const result = observe();
    if (result) return result;
    await delay(20);
  } while (performance.now() < deadline);
  assert.fail(message);
}

async function terminalFixture(t) {
  const f = fixture(t);
  const generation = 'd'.repeat(32);
  const observation = path.join(f.vault, 'owner-observation-' + generation + '.json');
  const leases = ['controller.lease', 'device-operations.lease'].map(name => path.join(f.root, name));
  const originalIntent = fs.readFileSync(f.state, 'utf8');
  let launches = 0, signals = 0, healthy = true, confirmExit = () => true;
  const child = Object.assign(new EventEmitter(), { pid: 1234, exitCode: null, signalCode: null,
    kill() { signals++; throw new Error('fixture_signal_refused'); } });
  const exit = () => {
    if (child.exitCode === null) {
      child.exitCode = 1;
      child.emit('exit', child.exitCode, null);
    }
  };
  const hasExited = async identity => {
    assert.deepEqual(identity, { pid: child.pid, startTime: '1', executable: process.execPath });
    return child.exitCode !== null && confirmExit();
  };
  const owner = await startWindowsAdministratorOwner({ bundle: f.bundle, selectedSid: sid, env: {}, generation },
    { hasExited, openController(root, options) {
      return openController(root, { ...options,
        readyTimeoutMs: 1000, stopTimeoutMs: 1000, healthIntervalMs: 25, healthFailureThreshold: 1,
        spawn(_command, args) {
          assert.equal(++launches, 1, 'the owner must not relaunch');
          fs.writeFileSync(args.at(-1), 'http://127.0.0.1:32456\n');
          return child;
        },
        async fetch() { return { status: healthy ? 200 : 503 }; },
        async observeCore(pid) { return { pid, startTime: '1', executable: process.execPath }; },
      });
    } });
  let result;
  void owner.finished.then(value => { result = value; });
  const ready = value => fs.existsSync(observation) && JSON.parse(fs.readFileSync(observation, 'utf8')).ready === value;
  async function cleanup() {
    confirmExit = () => true;
    exit();
    await owner.close();
  }
  return { ...f, leases, originalIntent, exit, ready, cleanup,
    get result() { return result; },
    get signals() { return signals; },
    setHealthy(value) { healthy = value; },
    setExitConfirmation(fn) { confirmExit = fn; } };
}

test('confirmed terminal exit after Ready releases inner leases without retry or an intent write', async t => {
  const f = await terminalFixture(t);
  try {
    await waitFor(() => f.ready(true), 'expected a Ready observation before the exit');
    f.exit();
    assert.deepEqual(await waitFor(() => f.result, 'confirmed exit left the owner open'), { status: 'tunnel-exited' });
    assert.equal(f.ready(false), true);
    for (const lease of f.leases) assert.equal(fs.existsSync(lease), false);
    assert.equal(fs.readFileSync(f.state, 'utf8'), f.originalIntent);
    assert.equal(f.signals, 0);
  } finally { await f.cleanup(); }
});

test('the owner remains alive after its last child handle is gone until terminal disposal', t => {
  const f = fixture(t);
  const source = `
    import { startWindowsAdministratorOwner } from ${JSON.stringify(new URL('./windows-admin-owner.mjs', import.meta.url).href)};
    const [bundle, selectedSid] = process.argv.slice(1);
    let exited = false;
    const owner = await startWindowsAdministratorOwner({ bundle, selectedSid, env: {} }, {
      hasExited: async () => exited,
      openController(_root, options) {
        let started = false;
        return {
          async startSavedIntent(authorize) { started = authorize(); },
          async status() {
            if (exited && await options.hasExited({})) return { paused: false, runtime: 'failed', ready: false };
            return { paused: false, runtime: started ? 'running' : 'stopped', ready: started };
          },
          async reconnect() { throw new Error('unexpected_reconnect'); },
          async pause() { throw new Error('unexpected_pause'); },
          async dispose() {},
        };
      },
    });
    setImmediate(() => { exited = true; });
    process.stdout.write(JSON.stringify(await owner.finished));
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '--eval', source, f.bundle, sid],
    { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  assert.ifError(run.error);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { status: 'tunnel-exited' });
  assert.equal(fs.existsSync(path.join(f.root, 'device-operations.lease')), false);
});

test('unknown terminal exit after Ready invalidates readiness but keeps the owner and its leases', async t => {
  const f = await terminalFixture(t);
  try {
    await waitFor(() => f.ready(true), 'expected a Ready observation before the exit');
    const leases = f.leases.map(file => fs.readFileSync(file, 'utf8'));
    f.setExitConfirmation(() => false);
    f.exit();
    await waitFor(() => f.ready(false), 'unknown exit did not invalidate readiness');
    assert.equal(f.result, undefined);
    assert.deepEqual(f.leases.map(file => fs.readFileSync(file, 'utf8')), leases);
    assert.equal(fs.readFileSync(f.state, 'utf8'), f.originalIntent);
    assert.equal(f.signals, 0);
    f.setExitConfirmation(() => true);
    assert.deepEqual(await waitFor(() => f.result, 'later confirmation did not close the owner'), { status: 'tunnel-exited' });
  } finally { await f.cleanup(); }
});

test('a failed health stop signal does not turn a live child into a confirmed exit', async t => {
  const f = await terminalFixture(t);
  try {
    await waitFor(() => f.ready(true), 'expected a Ready observation before health loss');
    f.setHealthy(false);
    await waitFor(() => f.signals === 1 && f.ready(false), 'expected a failed health stop and non-Ready observation');
    assert.equal(f.result, undefined);
    for (const lease of f.leases) assert.equal(fs.existsSync(lease), true);
    assert.equal(fs.readFileSync(f.state, 'utf8'), f.originalIntent);
  } finally { await f.cleanup(); }
});

test('durable Pause or Revoke arriving during exit confirmation wins over terminal cleanup', async t => {
  for (const reason of ['paused', 'revoked']) {
    const f = await terminalFixture(t);
    const intent = reason === 'paused' ? encode({ format: 'agent-continue-lifecycle', version: 1, paused: true }) : f.originalIntent;
    try {
      await waitFor(() => f.ready(true), 'expected a Ready observation before the exit');
      f.setExitConfirmation(() => {
        if (reason === 'paused') fs.writeFileSync(f.state, intent);
        else fs.writeFileSync(f.revoked, '', { flag: 'wx' });
        return true;
      });
      f.exit();
      assert.deepEqual(await waitFor(() => f.result, 'owner did not settle after denial'), { status: reason });
      assert.equal(fs.readFileSync(f.state, 'utf8'), intent);
      assert.equal(fs.existsSync(f.revoked), reason === 'revoked');
      for (const lease of f.leases) assert.equal(fs.existsSync(lease), false);
    } finally { await f.cleanup(); }
  }
});

test('revoking a live real lifecycle owner stops its exact child and leaves the deny marker', { timeout: 15000 }, async t => {
  const f = fixture(t);
  let child, owner;
  try {
    owner = await startWindowsAdministratorOwner({ bundle: f.bundle, selectedSid: sid, env: {} },
      { openController(root, options) {
        return openController(root, { ...options, readyTimeoutMs: 4000, stopTimeoutMs: 4000,
          spawn(_command, args, opts) {
            assert.equal(child, undefined);
            fs.writeFileSync(args.at(-1), 'http://127.0.0.1:32456\n');
            child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], opts);
            return child;
          },
          async fetch() { return { status: 200 }; },
          async observeCore(pid) { return { pid, startTime: '1', executable: process.execPath }; },
          async hasExited() { return child && (child.exitCode !== null || child.signalCode !== null); },
        });
      } });
    assert.equal(owner.status, 'ready');
    assert.equal(child.exitCode, null);
    assert.equal(fs.existsSync(path.join(f.root, 'controller.lease')), true);
    await assert.rejects(startWindowsAdministratorOwner({ bundle: f.bundle, selectedSid: sid, env: {} }), /controller_owned/);
    fs.writeFileSync(f.revoked, '', { flag: 'wx' });
    assert.deepEqual(await owner.finished, { status: 'revoked' });
    assert.notEqual(child.exitCode ?? child.signalCode, null);
    await assert.rejects(f.run(), /admin_owner_authorization_invalid/);
  } finally {
    await owner?.close?.();
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
  }
  assert.equal(JSON.parse(fs.readFileSync(f.state, 'utf8')).paused, false);
  assert.equal(fs.existsSync(f.revoked), true);
  for (const file of ['controller.lease', 'device-operations.lease']) assert.equal(fs.existsSync(path.join(f.root, file)), false);
});
