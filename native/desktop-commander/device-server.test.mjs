import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { prepareState } from './runtime.mjs';
import * as api from './device-owner.mjs';

const entrySource = new URL('./device-server.mjs', import.meta.url);
const implemented = fs.existsSync(entrySource) && typeof api.readServerBinding === 'function' && typeof api.startServerOwner === 'function';
test('binding-free server owner exports and foreground CLI exist', () => assert.ok(implemented));
const check = (name, run) => test(name, { skip: !implemented, timeout: 20000 }, run);
const encode = value => JSON.stringify(value) + '\n';
const request = (id, action = 'status') => ({ version: 1, id, action });
const extensionId = 'a'.repeat(32);
const mac = (secret, nonce, origin, value) => crypto.createHmac('sha256', Buffer.from(secret, 'hex'))
  .update(JSON.stringify(['device-request-v1', nonce, origin, value])).digest('hex');

function fixture(t) {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ac-device-server-'));
  const root = path.join(base, 'state'), source = path.join(base, 'source');
  prepareState(root, { consent: 'full-account' }); fs.mkdirSync(source, { mode: 0o700 });
  for (const name of ['device-server.mjs', 'device-owner.mjs', 'device-native-host.mjs', 'device-operations.mjs',
    'runtime.mjs', 'upstream-pin.json', 'lifecycle.mjs', 'profile.mjs', 'tunnel-pins.json', 'process-observation.mjs']) {
    fs.copyFileSync(new URL('./' + name, import.meta.url), path.join(source, name));
  }
  const entry = path.join(source, 'device-server.mjs'), channel = path.join(root, 'device-channel.json');
  const bindingFile = path.join(source, 'device-native-binding.json');
  const bindingBytes = encode({ format: 'agent-continue-native-binding', version: 1, extensionId, stateRoot: root });
  const children = new Set(), owners = new Set();
  const f = { base, root, source, entry, channel, bindingFile, bindingBytes, children, owners,
    journal: path.join(root, 'device-operations.jsonl'),
    spawn(args, { script = entry, ipc = false, input } = {}) {
      const child = spawn(process.execPath, [script, ...args], { cwd: base, windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe', ...(ipc ? ['ipc'] : [])] });
      children.add(child);
      const out = [], err = []; let firstResolve, firstReject, received = false;
      const first = new Promise((resolve, reject) => { firstResolve = resolve; firstReject = reject; });
      first.catch(() => {});
      child.stdout.on('data', bytes => {
        out.push(bytes);
        const text = Buffer.concat(out).toString('utf8');
        if (!received && text.includes('\n')) { received = true; firstResolve(text.split('\n')[0]); }
      });
      child.stderr.on('data', bytes => err.push(bytes));
      child.stdin.on('error', () => {}); child.stdin.end(input);
      const timer = setTimeout(() => child.kill(), 12000);
      const done = once(child, 'close').then(([code, signal]) => {
        clearTimeout(timer); children.delete(child);
        if (!received) firstReject(new Error('fixture_closed_before_ready'));
        return { code, signal, out: Buffer.concat(out).toString('utf8'), err: Buffer.concat(err).toString('utf8') };
      });
      return { child, first, done };
    },
    async ask(id, action = 'status') {
      return this.spawn(['request', '--state-dir', root, '--id', id, '--action', action]).done;
    },
    async own(options) { const owner = await api.startServerOwner(root, options); owners.add(owner); return owner; },
    nativeBinding() { fs.writeFileSync(bindingFile, bindingBytes, { mode: 0o600 }); return api.readNativeBinding(bindingFile); },
  };
  t.after(async () => {
    for (const owner of owners) await owner.close().catch(() => {});
    await Promise.all(Array.from(children, async child => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const closed = once(child, 'close'); child.kill(); await closed;
    }));
    await fs.promises.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 });
  });
  return f;
}

function controller() {
  const calls = [];
  let state = { paused: true, runtime: 'stopped', ready: false };
  return { calls,
    async status() { return { ...state }; },
    async reconnect() { calls.push('reconnect'); state = { paused: false, runtime: 'running', ready: true }; return { ...state }; },
    async pause() { calls.push('pause'); state = { paused: true, runtime: 'stopped', ready: false }; return { ...state }; },
    async dispose() { calls.push('dispose'); },
  };
}

check('server owner refuses legacy resume without trusted login evidence', async t => {
  const f = fixture(t), c = controller();
  await assert.rejects(f.own({ controller: c, resumeOnLogin: true }), /device_server_login_unverified/);
  assert.deepEqual(c.calls, []);
  assert.equal(fs.existsSync(f.bindingFile), false);
  assert.equal(fs.existsSync(f.channel), false);
  assert.equal(fs.existsSync(f.journal), false);
});

check('removed serve-login mode is rejected without creating ownership', async t => {
  const f = fixture(t);
  const result = await f.spawn(['serve-login', '--state-dir', f.root]).done;
  assert.equal(result.code, 1);
  assert.equal(result.out, '');
  assert.equal(result.err, 'device_server_unavailable\n');
  assert.equal(fs.existsSync(f.channel), false);
  assert.equal(fs.existsSync(f.journal), false);
  assert.equal(fs.existsSync(path.join(f.root, 'device-operations.lease')), false);
});

check('server identity validates a prepared private root without fabricating Chrome binding or starting anything', async t => {
  const f = fixture(t), binding = api.readServerBinding(f.root);
  assert.equal(binding.root, f.root); assert.equal(binding.extensionId, null);
  assert.equal(binding.origin, 'agent-continue-local://server/'); assert.equal(Object.isFrozen(binding), true);
  binding.assertCurrent();
  for (const file of [f.bindingFile, f.channel, f.journal, path.join(f.root, 'controller.lease')]) assert.equal(fs.existsSync(file), false);
});

check('server identity rejects invalid, redirected and replaced state roots', async t => {
  const f = fixture(t);
  for (const root of ['relative', f.root + '\n', path.join(f.base, 'absent'), path.join(f.root, 'consent.json')]) {
    assert.throws(() => api.readServerBinding(root));
  }
  const redirected = path.join(f.base, 'redirected');
  fs.symlinkSync(f.root, redirected, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => api.readServerBinding(redirected));
  const binding = api.readServerBinding(f.root);
  fs.renameSync(f.root, f.root + '.held'); prepareState(f.root, { consent: 'full-account' });
  assert.throws(() => binding.assertCurrent(), /device_binding_changed/);
  assert.equal(fs.existsSync(f.channel), false);
});

check('independent request processes share one server owner and retained duplicate-ID results', async t => {
  const f = fixture(t), c = controller(); await f.own({ controller: c });
  assert.equal(JSON.parse(fs.readFileSync(f.channel, 'utf8')).extensionId, null);
  const connected = await f.ask('server-connect', 'reconnect'); assert.equal(connected.code, 0);
  const response = JSON.parse(connected.out);
  assert.deepEqual(response.state.operation, { id: 'server-connect', action: 'reconnect', status: 'settled' });
  assert.equal(response.state.connection, 'ready');
  assert.equal((await f.ask('server-connect', 'reconnect')).out, connected.out);
  const paused = await f.ask('server-pause', 'disconnect-and-pause'); assert.equal(paused.code, 0);
  assert.equal(JSON.parse(paused.out).state.paused, true);
  assert.deepEqual(JSON.parse((await f.ask('server-connect')).out).state.operation, response.state.operation);
  const rejected = await f.ask('server-connect', 'disconnect-and-pause');
  assert.equal(rejected.code, 1, 'an authenticated rejected operation must fail at the shell boundary');
  assert.deepEqual(JSON.parse(rejected.out), { ...request('server-connect', 'disconnect-and-pause'), ok: false });
  assert.deepEqual(c.calls, ['reconnect', 'pause']);
  const output = connected.out + paused.out;
  assert.equal(output.includes(f.base), false);
  assert.equal(output.includes(JSON.parse(fs.readFileSync(f.channel, 'utf8')).secret), false);
  assert.equal(fs.existsSync(f.bindingFile), false);
});

check('a caller-provided login ID cannot resume a persistently paused server', async t => {
  const f = fixture(t), c = controller(); await f.own({ controller: c });
  const before = fs.readFileSync(f.channel);
  const journal = fs.readFileSync(f.journal);
  const args = ['resume-login', '--state-dir', f.root, '--id', 'login-event-one'];
  const first = await f.spawn(args).done;
  assert.deepEqual(first, { code: 1, signal: null, out: '', err: 'device_server_unavailable\n' });
  assert.deepEqual(c.calls, []);
  assert.deepEqual(fs.readFileSync(f.journal), journal);
  assert.equal(JSON.parse((await f.ask('still-paused')).out).state.paused, true);
  assert.deepEqual(fs.readFileSync(f.channel), before);
});

check('login resume without an owner fails without starting or reclaiming anything', async t => {
  const f = fixture(t);
  const result = await f.spawn(['resume-login', '--state-dir', f.root, '--id', 'absent-login']).done;
  assert.equal(result.code, 1);
  assert.equal(fs.existsSync(f.channel), false);
  assert.equal(fs.existsSync(f.journal), false);
  assert.equal(fs.existsSync(path.join(f.root, 'device-operations.lease')), false);
});

check('foreground serve starts only a management owner; independent status/pause do not need a tunnel profile', async t => {
  const f = fixture(t), serving = f.spawn(['serve', '--state-dir', f.root]);
  assert.deepEqual(JSON.parse(await serving.first), { version: 1, status: 'listening' });
  assert.equal(serving.child.exitCode, null); assert.equal(serving.child.signalCode, null);
  const first = await f.ask('foreground-status'); assert.equal(first.code, 0);
  assert.deepEqual(JSON.parse(first.out), { ...request('foreground-status'), ok: true, state: { paused: true, connection: 'disconnected' } });
  const paused = await f.ask('foreground-pause', 'disconnect-and-pause'); assert.equal(paused.code, 0);
  assert.equal(JSON.parse(paused.out).state.operation.status, 'settled');
  const journal = fs.readFileSync(f.journal, 'utf8');
  assert.equal((await f.ask('foreground-pause', 'disconnect-and-pause')).out, paused.out);
  assert.equal(fs.readFileSync(f.journal, 'utf8'), journal);
  assert.equal(fs.readdirSync(f.root).some(name => /^health\./.test(name)), false);
  assert.equal(fs.existsSync(f.bindingFile), false);
  // Force-stop only the disposable child at teardown; this is not graceful Windows-signal acceptance.
});

check('status with no owner cannot start a channel, journal, lease or tunnel', async t => {
  const f = fixture(t), before = fs.readdirSync(f.root).sort();
  const result = await f.ask('no-owner');
  assert.equal(result.code, 1); assert.equal(result.out, ''); assert.equal(result.err, 'device_server_unavailable\n');
  assert.deepEqual(fs.readdirSync(f.root).sort(), before);
});

check('server CLI accepts only closed serve/request flags and sanitized failures', async t => {
  const f = fixture(t), before = fs.readdirSync(f.root).sort();
  const valid = ['request', '--state-dir', f.root, '--id', 'bad-input', '--action', 'status'];
  for (const args of [[], ['serve'], ['serve', '--state-dir', 'relative'], ['serve', '--state-dir', f.root, '--id', 'x'],
    [...valid, '--command', 'private-command'], [...valid, '--state-dir', f.root],
    ['request', '--state-dir', f.root, '--id', 'x'.repeat(65), '--action', 'status'],
    ['request', '--state-dir', f.root, '--id', 'x', '--action', 'shell'],
    ['request', '--id', 'x', '--action', 'status'], ['request', '--state-dir', f.root, '--id', '--action', 'status']]) {
    const result = await f.spawn(args).done;
    assert.equal(result.code, 1); assert.equal(result.out, ''); assert.equal(result.err, 'device_server_unavailable\n');
  }
  assert.deepEqual(fs.readdirSync(f.root).sort(), before);
});

check('native and server identities cannot cross-use a channel or create a second owner', async t => {
  const f = fixture(t), c = controller(), server = await f.own({ controller: c });
  const channel = fs.readFileSync(f.channel), native = f.nativeBinding();
  await assert.rejects(api.sendDeviceRequest(native, request('native-to-server')), /invalid_device_channel/);
  await assert.rejects(api.startDeviceOwner(f.bindingFile, { controller: controller() }));
  await assert.rejects(api.startServerOwner(f.root, { controller: controller() }));
  assert.deepEqual(fs.readFileSync(f.channel), channel);
  const descriptor = JSON.parse(channel), socket = net.createConnection(descriptor.endpoint);
  socket.on('error', () => {}); t.after(() => socket.destroy());
  const challenge = await api.readFrame(socket), intent = request('wrong-origin', 'reconnect');
  const closed = once(socket, 'close');
  await api.writeFrame(socket, { version: 1, origin: native.origin, request: intent,
    mac: mac(descriptor.secret, challenge.nonce, native.origin, intent) });
  await closed; assert.deepEqual(c.calls, []);
  await server.close();
  const nativeOwner = await api.startDeviceOwner(f.bindingFile, { controller: controller() }); f.owners.add(nativeOwner);
  await assert.rejects(api.sendDeviceRequest(api.readServerBinding(f.root), request('server-to-native')), /invalid_device_channel/);
});

check('a stale channel is preserved rather than reclaimed by status or serve', async t => {
  const f = fixture(t), id = crypto.randomBytes(16).toString('hex');
  const channel = encode({ format: 'agent-continue-device-channel', version: 1, extensionId: null,
    endpoint: process.platform === 'win32' ? '\\\\.\\pipe\\agentcontinue-device-' + id : path.join(f.root, 'device-' + id + '.sock'),
    secret: crypto.randomBytes(32).toString('hex') });
  fs.writeFileSync(f.channel, channel, { mode: 0o600 });
  assert.equal((await f.ask('stale')).code, 1);
  assert.equal((await f.spawn(['serve', '--state-dir', f.root]).done).code, 1);
  assert.equal(fs.readFileSync(f.channel, 'utf8'), channel); assert.equal(fs.existsSync(f.journal), false);
});

check('server requests manage one real finite lifecycle child without official credentials or tool forwarding', async t => {
  const f = fixture(t), client = path.join(f.source, 'finite-runtime.mjs');
  fs.writeFileSync(client, `import fs from 'node:fs';import http from 'node:http';
const at=process.argv.indexOf('--health.url-file');
const server=http.createServer((req,res)=>{res.writeHead(req.url==='/readyz'?200:404);res.end();});
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(process.argv[at+1],'http://127.0.0.1:'+server.address().port+'\\n',{mode:0o600}));
const timer=setTimeout(()=>server.close(),10000);timer.unref();
process.on('SIGTERM',()=>{clearTimeout(timer);server.close();});
`);
  fs.writeFileSync(path.join(f.source, 'profile.mjs'), `export function buildTunnelLaunch(){return {command:process.execPath,args:[${JSON.stringify(client)}],cwd:${JSON.stringify(f.root)},env:{}};}\n`);
  const { openController } = await import(pathToFileURL(path.join(f.source, 'lifecycle.mjs')).href);
  let runtime, launches = 0;
  const c = openController(f.root, { readyTimeoutMs: 3000, stopTimeoutMs: 2000, pollIntervalMs: 10,
    spawn(command, args, options) {
      launches++; runtime = spawn(command, args, options); f.children.add(runtime);
      runtime.once('close', () => f.children.delete(runtime)); return runtime;
    },
    async observeCore() { return { pid: runtime.pid, startTime: '123456789', executable: process.execPath }; },
    async hasExited() { return runtime.exitCode !== null || runtime.signalCode !== null; },
  });
  const owner = await f.own({ controller: c });
  assert.equal(JSON.parse((await f.ask('finite-status')).out).state.paused, true); assert.equal(launches, 0);
  assert.equal(JSON.parse((await f.ask('finite-connect', 'reconnect')).out).state.connection, 'ready');
  assert.equal(JSON.parse((await f.ask('finite-connect', 'reconnect')).out).state.connection, 'ready');
  assert.equal(launches, 1);
  const pause = JSON.parse((await f.ask('finite-pause', 'disconnect-and-pause')).out);
  assert.equal(pause.state.connection, 'disconnected'); assert.equal(pause.state.paused, true);
  assert.ok(runtime.exitCode !== null || runtime.signalCode !== null);
  await owner.close();
  for (const file of [f.channel, path.join(f.root, 'controller.lease'), path.join(f.root, 'device-operations.lease')]) assert.equal(fs.existsSync(file), false);
});

check('simultaneous foreground servers admit only one shared state owner', async t => {
  const f = fixture(t);
  const attempts = [f.spawn(['serve', '--state-dir', f.root]), f.spawn(['serve', '--state-dir', f.root])];
  const results = await Promise.all(attempts.map(async serving => {
    try { return { serving, ready: JSON.parse(await serving.first) }; }
    catch { return { serving, result: await serving.done }; }
  }));
  assert.equal(results.filter(value => value.ready?.status === 'listening').length, 1);
  const refused = results.find(value => value.result);
  assert.equal(refused.result.code, 1); assert.equal(refused.result.err, 'device_server_unavailable\n');
  assert.equal(JSON.parse((await f.ask('one-owner')).out).state.paused, true);
});

test('root replacement during awaited server status cannot return a retained response', {
  skip: !implemented || process.platform === 'win32' ? 'Live directory rename requires Unix; Windows rejects the open journal directory with EPERM' : false,
  timeout: 20000,
}, async t => {
  const f = fixture(t), c = controller();
  let entered, release;
  const waiting = new Promise(resolve => { entered = resolve; });
  c.status = async () => { entered(); await new Promise(resolve => { release = resolve; }); return { paused: true, runtime: 'stopped', ready: false }; };
  const owner = await f.own({ controller: c });
  const reply = f.ask('root-in-flight'); await waiting;
  const held = f.root + '.held'; let moved = false;
  try {
    t.diagnostic('server status reached controlled await');
    fs.renameSync(f.root, held); moved = true;
    t.diagnostic('original state directory renamed');
    prepareState(f.root, { consent: 'full-account' });
    release();
    const result = await reply;
    assert.equal(result.code, 1); assert.equal(result.out, '');
    assert.equal(fs.existsSync(path.join(held, 'device-operations.lease')), true);
  } finally {
    release();
    if (moved) {
      // Restore only the exact test-owned original after observing rejection or a fixture failure.
      fs.rmSync(f.root, { recursive: true, force: true }); fs.renameSync(held, f.root);
    }
  }
  await owner.close(); assert.equal(fs.existsSync(f.channel), false);
});

check('a stop signal during asynchronous owner startup prevents listening and disposes the owner', async t => {
  const f = fixture(t), wrapper = path.join(f.source, 'startup-signal-fixture.mjs');
  const disposed = path.join(f.base, 'disposed');
  fs.writeFileSync(path.join(f.source, 'lifecycle.mjs'), `import fs from 'node:fs';
await new Promise(resolve=>{const receive=value=>{if(value==='continue'){process.off('message',receive);resolve();}};process.on('message',receive);process.send({opening:true});});
export function openController(){return {
 async status(){return {paused:true,runtime:'stopped',ready:false};},
 async reconnect(){throw Error('fixture_no_runtime');},async pause(){return {paused:true,runtime:'stopped',ready:false};},
 async dispose(){fs.writeFileSync(${JSON.stringify(disposed)},'disposed');}
};}\n`);
  fs.writeFileSync(wrapper, `process.argv[1]=${JSON.stringify(f.entry)};
process.on('message',value=>{if(value==='stop'){process.emit('SIGTERM');process.send({stopObserved:true});}});
await import(${JSON.stringify(pathToFileURL(f.entry).href)});if(process.connected)process.disconnect();\n`);
  const serving = f.spawn(['serve', '--state-dir', f.root], { script: wrapper, ipc: true });
  function nextMessage() { return once(serving.child, 'message').then(([value]) => value); }
  assert.deepEqual(await nextMessage(), { opening: true });
  const acknowledged = nextMessage(); serving.child.send('stop');
  assert.deepEqual(await acknowledged, { stopObserved: true });
  // If stop was lost, fail promptly instead of keeping the erroneous foreground owner alive.
  serving.first.then(() => serving.child.kill(), () => {});
  serving.child.send('continue');
  const result = await serving.done;
  t.diagnostic(JSON.stringify({ code: result.code, signal: result.signal, advertisedListening: result.out.includes('listening') }));
  assert.equal(result.code, 0); assert.equal(result.out, ''); assert.equal(result.err, '');
  assert.equal(fs.readFileSync(disposed, 'utf8'), 'disposed');
  assert.equal(fs.existsSync(f.channel), false);
  assert.equal(fs.existsSync(path.join(f.root, 'device-operations.lease')), false);
});

check('foreground signal handler disposes the default controller and releases only owned fences', async t => {
  const f = fixture(t), wrapper = path.join(f.source, 'signal-fixture.mjs');
  // A trusted fixture emits Node's signal event on Windows; actual Unix delivery is tested separately.
  fs.writeFileSync(wrapper, `process.argv[1]=${JSON.stringify(f.entry)};
process.on('message',value=>{if(value==='stop'){process.emit('SIGTERM');process.disconnect();}});
await import(${JSON.stringify(pathToFileURL(f.entry).href)});\n`);
  const serving = f.spawn(['serve', '--state-dir', f.root], { script: wrapper, ipc: true });
  assert.deepEqual(JSON.parse(await serving.first), { version: 1, status: 'listening' });
  serving.child.send('stop');
  const result = await serving.done; assert.equal(result.code, 0); assert.equal(result.err, '');
  assert.equal(fs.existsSync(f.channel), false);
  assert.equal(fs.existsSync(path.join(f.root, 'controller.lease')), false);
  assert.equal(fs.existsSync(path.join(f.root, 'device-operations.lease')), false);
  assert.equal(fs.existsSync(path.join(f.root, 'lifecycle.json')), false, 'shutdown must not create a manual pause');
});

test('actual Unix SIGTERM cleanly closes the foreground server owner', { skip: !implemented || process.platform === 'win32', timeout: 20000 }, async t => {
  const f = fixture(t), serving = f.spawn(['serve', '--state-dir', f.root]);
  await serving.first; serving.child.kill('SIGTERM');
  const result = await serving.done; assert.equal(result.code, 0); assert.equal(result.signal, null);
  assert.equal(fs.existsSync(f.channel), false);
});

test('Unix server state root must be private to the current account', { skip: !implemented || process.platform === 'win32' }, async t => {
  const f = fixture(t); fs.chmodSync(f.root, 0o755);
  assert.throws(() => api.readServerBinding(f.root));
  await assert.rejects(api.startServerOwner(f.root));
  assert.equal(fs.existsSync(f.channel), false);
});
