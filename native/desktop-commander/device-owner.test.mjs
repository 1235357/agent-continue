import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { prepareState } from './runtime.mjs';

const ownerSource = new URL('./device-owner.mjs', import.meta.url);
const hostSource = new URL('./device-native-host.mjs', import.meta.url);
const exists = fs.existsSync(ownerSource) && fs.existsSync(hostSource);
test('persistent local owner and one-shot native bridge exist', () => assert.ok(exists));
const check = (name, run) => test(name, { skip: !exists, timeout: 20000 }, run);
const extensionId = 'a'.repeat(32), origin = 'chrome-extension://' + extensionId + '/';
const request = (id, action = 'status') => ({ version: 1, id, action });
const encode = value => JSON.stringify(value) + '\n';
function frame(value) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  const length = Buffer.alloc(4); length.writeUInt32LE(body.length);
  return Buffer.concat([length, body]);
}
function decode(bytes) {
  assert.ok(bytes.length >= 4, 'a complete native response is required');
  const length = bytes.readUInt32LE();
  assert.equal(bytes.length, length + 4, 'exactly one native response');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(4)));
}
const mac = (secret, domain, nonce, ...values) => crypto.createHmac('sha256', Buffer.from(secret, 'hex'))
  .update(JSON.stringify([domain, nonce, ...values])).digest('hex');

check('pinned device channel cannot follow a replacement owner under the same binding', async t => {
  const f = await fixture(t, { start: false });
  const { readNativeBinding, pinDeviceChannel, sendDeviceRequest, startDeviceOwner } = await import(ownerSource.href);
  const controller = {
    status: async () => ({ paused: true, runtime: 'stopped', ready: false }),
    pause: async () => { throw new Error('stale request reached new owner'); },
    dispose: async () => {}, reconnect: async () => { throw new Error('stale request reached new owner'); },
  };
  const first = await startDeviceOwner(f.bindingFile, { controller });
  t.after(() => first.close());
  const pinned = pinDeviceChannel(readNativeBinding(f.bindingFile));
  assert.equal((await sendDeviceRequest(pinned, request(crypto.randomUUID()))).ok, true);
  await first.close();
  const second = await startDeviceOwner(f.bindingFile, { controller });
  try {
    await assert.rejects(sendDeviceRequest(pinned, request(crypto.randomUUID(), 'reconnect')), /device_channel_changed/);
    assert.equal((await sendDeviceRequest(readNativeBinding(f.bindingFile), request(crypto.randomUUID()))).ok, true);
  } finally { await second.close(); }
});

async function message(child, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('fixture_message_timeout')), 7000);
    const received = value => { if (predicate(value)) finish(null, value); };
    const exited = () => finish(new Error('fixture_exited_before_message'));
    function finish(error, value) {
      clearTimeout(timer); child.off('message', received); child.off('exit', exited);
      if (error) reject(error); else resolve(value);
    }
    child.on('message', received); child.once('exit', exited);
  });
}

test('the actual Windows wake CLI holds a paused owner until its native pipe closes',
  { skip: process.platform !== 'win32' || !exists, timeout: 20000 }, async t => {
    const f = await fixture(t, { start: false });
    for (const name of ['lifecycle.mjs', 'profile.mjs', 'process-observation.mjs', 'tunnel-pins.json']) {
      fs.copyFileSync(new URL('./' + name, import.meta.url), path.join(f.source, name));
    }
    const lifecycle = path.join(f.root, 'lifecycle.json');
    const saved = encode({ format: 'agent-continue-lifecycle', version: 1, paused: true });
    fs.writeFileSync(lifecycle, saved, { mode: 0o600 });
    const wake = { version: 1, id: 'fixture-wake', action: 'wake' };
    const { child, done } = f.bridge(null, ['--browser-wake', origin, '--parent-window=0'], false);
    const { readNativeBinding, readFrame, writeFrame, sendDeviceRequest } = await import(ownerSource.href);
    try {
      const reply = readFrame(child.stdout, 8000);
      await writeFrame(child.stdin, wake);
      assert.deepEqual(await reply, { ...wake, ok: true });
      const status = await sendDeviceRequest(readNativeBinding(f.bindingFile), request('fixture-status'));
      assert.deepEqual(status.state, { paused: true, connection: 'disconnected' });
    } finally { child.stdin.end(); }
    assert.equal((await done).code, 0);
    assert.equal(fs.readFileSync(lifecycle, 'utf8'), saved);
    assert.equal(fs.existsSync(f.channel), false);
    assert.equal(fs.existsSync(path.join(f.root, 'controller.lease')), false);
  });

check('browser port loss after admission drains the original mutation before releasing ownership', async t => {
  const f = await fixture(t, { start: false });
  const { startDeviceOwner, readFrame, writeFrame } = await import(ownerSource.href);
  const { serveBrowserWake } = await import(hostSource.href);
  const input = new PassThrough(), output = new PassThrough();
  let reached, release, mutations = 0;
  const entered = new Promise(resolve => { reached = resolve; });
  const admitted = new Promise(resolve => { release = resolve; });
  const controller = {
    status: async () => ({ paused: true, runtime: 'stopped', ready: false }),
    async reconnect() {
      mutations++;
      reached();
      await admitted;
      return { paused: false, runtime: 'running', ready: true };
    },
    async pause() { throw new Error('unexpected pause'); },
    async dispose() {},
  };
  const serving = serveBrowserWake({ input, output, origin, args: [origin],
    startOwner: signal => startDeviceOwner(f.bindingFile, { controller, signal }) });
  try {
    const ack = readFrame(output, 5000);
    await writeFrame(input, { version: 1, id: 'wake-test', action: 'wake' });
    await ack;
    await writeFrame(input, request('admitted-browser-op', 'reconnect'));
    await entered;
    assert.match(fs.readFileSync(f.journal, 'utf8'), /"status":"in-progress"/);
    output.destroy();
    input.end();
    await assert.rejects(startDeviceOwner(f.bindingFile, { controller }), /device_owner_unavailable/);
    assert.equal(fs.existsSync(f.channel), true);
  } finally {
    release();
    input.destroy();
    output.destroy();
    await serving;
  }
  assert.equal(mutations, 1);
  assert.equal(fs.existsSync(f.channel), false);
  const successor = await startDeviceOwner(f.bindingFile, { controller });
  try {
    const status = await successor.request(request('admitted-browser-op'));
    assert.deepEqual(status.state.operation, { id: 'admitted-browser-op', action: 'reconnect', status: 'settled' });
  } finally { await successor.close(); }
});

async function fixture(t, { hold = false, start = true, failAdmission = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-device-ipc-'));
  const root = path.join(base, 'state'), source = path.join(base, 'source');
  prepareState(root, { consent: 'full-account' }); fs.mkdirSync(source, { mode: 0o700 });
  for (const name of ['device-owner.mjs', 'device-native-host.mjs', 'device-operations.mjs', 'runtime.mjs', 'upstream-pin.json']) {
    fs.copyFileSync(new URL('./' + name, import.meta.url), path.join(source, name));
  }
  const bindingFile = path.join(source, 'device-native-binding.json');
  fs.writeFileSync(bindingFile, encode({ format: 'agent-continue-native-binding', version: 1, extensionId, stateRoot: root }), { mode: 0o600 });
  const entry = path.join(source, 'fixture-owner.mjs');
  fs.writeFileSync(entry, `import fs from 'node:fs';
import { startDeviceOwner } from './device-owner.mjs';
let current={paused:true,runtime:'stopped',ready:false}, release;
const calls=[];
const controller={
 async status(){return {...current};},
 async reconnect(){calls.push('reconnect');process.send({effect:'reconnect'});${hold ? 'await new Promise(resolve=>{release=resolve;});' : ''}current={paused:false,runtime:'running',ready:true};return {...current};},
 async pause(){calls.push('pause');current={paused:true,runtime:'stopped',ready:false};return {...current};},
 async dispose(){current={paused:true,runtime:'stopped',ready:false};}
};
try {
 const owner=await startDeviceOwner(${JSON.stringify(bindingFile)},{controller});
 ${failAdmission ? "const originalSync=fs.fsyncSync;fs.fsyncSync=()=>{throw new Error('fixture_durability_failure');};" : ''}
 process.on('message',async value=>{
  ${failAdmission ? "if(value==='restore-durability'){fs.fsyncSync=originalSync;process.send({durabilityRestored:true});}" : ''}
  if(value==='release'){release?.();}
  if(value==='calls'){process.send({calls});}
  if(value==='close'){try{await owner.close();process.send({closed:true});process.disconnect();}catch{process.send({closed:false});process.disconnect();}}
 });
 process.send({listening:true});
}catch{process.send({listening:false});process.disconnect();process.exitCode=1;}
`, { mode: 0o600 });
  const children = new Set();
  const f = { base, root, source, bindingFile, entry, owner: null, children,
    channel: path.join(root, 'device-channel.json'),
    journal: path.join(root, 'device-operations.jsonl'),
    async start() {
      const child = spawn(process.execPath, [entry], { cwd: source, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      children.add(child); child.stderr.resume();
      child.once('exit', () => children.delete(child));
      const value = await message(child, value => Object.hasOwn(value, 'listening'));
      return { child, value };
    },
    bridge(bytes, args = [origin], end = true) {
      const child = spawn(process.execPath, [path.join(source, 'device-native-host.mjs'), ...args], {
        cwd: base, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
      children.add(child); const out = [], errors = [];
      child.stdout.on('data', value => out.push(value)); child.stderr.on('data', value => errors.push(value));
      child.stdin.on('error', () => {});
      const done = once(child, 'close').then(([code, signal]) => {
        children.delete(child); return { code, signal, out: Buffer.concat(out), error: Buffer.concat(errors).toString('utf8') };
      });
      if (bytes) child.stdin.write(bytes);
      if (end) child.stdin.end();
      return { child, done };
    },
    async ask(value, args) { return this.bridge(frame(value), args).done; },
    async calls() { const pending = message(this.owner, value => Array.isArray(value.calls)); this.owner.send('calls'); return (await pending).calls; },
    async close() {
      if (!this.owner || this.owner.exitCode !== null || this.owner.signalCode !== null) return;
      const pending = message(this.owner, value => Object.hasOwn(value, 'closed'));
      const exited = once(this.owner, 'exit'); this.owner.send('close');
      assert.equal((await pending).closed, true); await exited;
    },
  };
  t.after(async () => {
    if (f.owner?.connected && f.owner.exitCode === null && f.owner.signalCode === null) {
      try { await f.close(); } catch { /* Only exact test-owned children are terminated below. */ }
    }
    await Promise.all(Array.from(children, child => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const ended = once(child, 'close'); child.kill(); return ended;
    }));
    await fs.promises.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 });
  });
  if (start) {
    const { child, value } = await f.start(); f.owner = child;
    assert.deepEqual(value, { listening: true });
  }
  return f;
}

check('different native processes reach one persistent owner and exact retained receipts', async t => {
  const f = await fixture(t);
  const initial = await f.ask(request('initial'));
  assert.equal(initial.code, 0);
  assert.deepEqual(decode(initial.out), { ...request('initial'), ok: true, state: { paused: true, connection: 'disconnected' } });
  const intent = request('first-connect', 'reconnect');
  const first = decode((await f.ask(intent)).out);
  assert.equal(first.state.connection, 'ready');
  assert.deepEqual(first.state.operation, { id: intent.id, action: intent.action, status: 'settled' });
  assert.deepEqual(decode((await f.ask(intent)).out), first);
  await f.ask(request('later-pause', 'disconnect-and-pause'));
  const retained = decode((await f.ask(request(intent.id))).out);
  assert.deepEqual(retained.state.operation, first.state.operation);
  assert.deepEqual(await f.calls(), ['reconnect', 'pause']);
  assert.equal(JSON.stringify(retained).includes(f.base), false);
  assert.equal(JSON.stringify(retained).includes(JSON.parse(fs.readFileSync(f.channel, 'utf8')).secret), false);
});

check('bounded IPC observation closes its socket but preserves channel metadata and the server', async t => {
  const f = await fixture(t, {start:false});
  const {readNativeBinding,sendDeviceRequest} = await import('./device-owner.mjs');
  const id=crypto.randomBytes(16).toString('hex');
  const endpoint=process.platform==='win32' ? '\\\\.\\pipe\\agentcontinue-device-'+id : path.join(f.root,'device-'+id+'.sock');
  const channel={format:'agent-continue-device-channel',version:1,extensionId,endpoint,secret:'a'.repeat(64)};
  const channelBytes=encode(channel);
  fs.writeFileSync(f.channel,channelBytes,{mode:0o600});
  const sockets=new Set();let closed=0;
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('error',()=>{});
    socket.once('close',()=>{sockets.delete(socket);closed++;});
    // A reachable but silent endpoint must not stretch an installer's deadline.
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(endpoint,resolve);});
  if(process.platform!=='win32') fs.chmodSync(endpoint,0o600);
  let timer;
  try {
    const response=sendDeviceRequest(readNativeBinding(f.bindingFile),request('bounded-status'),{timeoutMs:100});
    const limit=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('fixture_deadline_not_enforced')),1000);});
    await assert.rejects(Promise.race([response,limit]),error=>{
      assert.notEqual(error.message,'fixture_deadline_not_enforced');return true;
    });
    clearTimeout(timer);
    for(let index=0;index<20 && !closed;index++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(closed,1);assert.equal(sockets.size,0);
    assert.equal(server.listening,true);
    assert.equal(fs.readFileSync(f.channel,'utf8'),channelBytes);
    assert.equal(fs.existsSync(f.journal),false);
  } finally {
    clearTimeout(timer);for(const socket of sockets) socket.destroy();
    await new Promise(resolve=>server.close(resolve));
  }
});

check('IPC deadline options reject invalid values before binding or channel access', async () => {
  const {sendDeviceRequest} = await import('./device-owner.mjs');
  let reads=0;
  const binding={assertCurrent(){reads++;throw new Error('fixture_must_not_read');}};
  for(const options of [null,{timeoutMs:0},{timeoutMs:-1},{timeoutMs:1.5},{timeoutMs:30001},
    {timeoutMs:'100'},{timeoutMs:undefined},{timeoutMs:100,extra:true}]) {
    await assert.rejects(sendDeviceRequest(binding,request('invalid-deadline'),options),
      {message:'invalid_device_request_options'});
  }
  assert.equal(reads,0);
});

check('a one-shot native bridge responds and exits while Chrome still holds its stdin open', async t => {
  const f = await fixture(t);
  const bridge = f.bridge(frame(request('open-stdin')), [origin], false);
  const result = await bridge.done;
  assert.equal(result.code, 0); assert.equal(decode(result.out).state.paused, true);
  assert.equal(f.owner.exitCode, null); assert.equal(f.owner.signalCode, null);
  assert.deepEqual(await f.calls(), []);
});

check('existing Devices controller recovers a lost reply through real native bridge processes after page reload', async t => {
  const f = await fixture(t);
  const { createDeviceController, HOST, PENDING_KEY } = await import('../../device-control.js');
  const data = {}, sent = [];
  let discard = true;
  const options = {
    runtime: { async sendNativeMessage(host, value) {
      assert.equal(host, HOST); sent.push(value);
      const result = await f.ask(value); assert.equal(result.code, 0);
      if (value.action === 'reconnect' && discard) { discard = false; throw new Error('fixture_lost_response'); }
      return decode(result.out);
    } },
    permissions: { async contains() { return true; } },
    storage: { async get() { return structuredClone(data); }, async set(value) { Object.assign(data, structuredClone(value)); } },
    locks: { async request(name, run) { return run(); } },
  };
  const first = createDeviceController(options);
  await first.initialize(); await first.run('status'); assert.equal(first.getState().canMutate, true);
  await first.run('reconnect');
  const pending = first.getState().pending;
  assert.equal(pending.action, 'reconnect'); assert.equal(first.getState().canMutate, false);
  const reloaded = createDeviceController(options); await reloaded.initialize();
  assert.deepEqual(reloaded.getState().pending, pending);
  await reloaded.run('status');
  assert.deepEqual(sent.at(-1), request(pending.id));
  assert.equal(reloaded.getState().pending, null); assert.equal(reloaded.getState().canMutate, true);
  assert.equal(data[PENDING_KEY], null); assert.deepEqual(await f.calls(), ['reconnect']);
});

check('Devices queries a durable not-executed receipt through native frames and IPC after admission failure', async t => {
  const f = await fixture(t, { failAdmission: true });
  const { createDeviceController, HOST, PENDING_KEY } = await import('../../device-control.js');
  const data = {}, sent = [];
  const options = {
    runtime: { async sendNativeMessage(host, value) {
      assert.equal(host, HOST); sent.push(value);
      const result = await f.ask(value); assert.equal(result.code, 0);
      return decode(result.out);
    } },
    permissions: { async contains() { return true; } },
    storage: { async get() { return structuredClone(data); }, async set(value) { Object.assign(data, structuredClone(value)); } },
    locks: { async request(name, run) { return run(); } },
  };
  const first = createDeviceController(options);
  await first.initialize(); await first.run('status'); await first.run('reconnect');
  const pending = first.getState().pending;
  assert.equal(pending.action, 'reconnect');
  assert.deepEqual(await f.calls(), []);
  const restored = message(f.owner, value => value.durabilityRestored === true);
  f.owner.send('restore-durability'); await restored;
  const reloaded = createDeviceController(options);
  await reloaded.initialize(); await reloaded.run('status');
  assert.deepEqual(sent.at(-1), request(pending.id));
  assert.equal(reloaded.getState().pending, null);
  assert.equal(data[PENDING_KEY], null);
  assert.equal(reloaded.getState().observation.operation.status, 'not-executed');
  assert.equal(reloaded.getState().canMutate, true);
  const duplicate = decode((await f.ask(pending)).out);
  assert.equal(duplicate.state.operation.status, 'not-executed');
  assert.deepEqual(await f.calls(), []);
});

check('real lifecycle retains one finite runtime across native bridges and confirms its stop', async t => {
  const f = await fixture(t, { start: false });
  for (const name of ['lifecycle.mjs', 'process-observation.mjs']) fs.copyFileSync(new URL('./' + name, import.meta.url), path.join(f.source, name));
  const client = path.join(f.source, 'finite-runtime.mjs');
  fs.writeFileSync(client, `import fs from 'node:fs';import http from 'node:http';
const at=process.argv.indexOf('--health.url-file');
const server=http.createServer((req,res)=>{res.writeHead(req.url==='/readyz'?200:404);res.end();});
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(process.argv[at+1],'http://127.0.0.1:'+server.address().port+'\\n',{mode:0o600}));
const timer=setTimeout(()=>{server.close();},12000);timer.unref();
process.on('SIGTERM',()=>{clearTimeout(timer);server.close();});
`);
  fs.writeFileSync(path.join(f.source, 'profile.mjs'), `export function buildTunnelLaunch(){return {command:process.execPath,args:[${JSON.stringify(client)}],cwd:${JSON.stringify(f.root)},env:{}};}\n`);
  const { openController } = await import(pathToFileURL(path.join(f.source, 'lifecycle.mjs')).href);
  const { startDeviceOwner } = await import(ownerSource.href);
  let runtime, launches = 0;
  const controller = openController(f.root, {
    readyTimeoutMs: 3000, stopTimeoutMs: 2000, pollIntervalMs: 10,
    spawn(command, args, options) {
      launches++; runtime = spawn(command, args, options); f.children.add(runtime);
      runtime.once('close', () => f.children.delete(runtime)); return runtime;
    },
    // This finite fixture is the directly owned child, not a production tunnel/Core tree.
    async observeCore() { return { pid: runtime.pid, startTime: '123456789', executable: process.execPath }; },
    async hasExited() { return runtime.exitCode !== null || runtime.signalCode !== null; },
  });
  const owner = await startDeviceOwner(f.bindingFile, { controller });
  try {
    const initial = decode((await f.ask(request('finite-initial'))).out);
    assert.equal(initial.state.paused, true); assert.equal(launches, 0);
    assert.equal(decode((await f.ask(request('finite-connect', 'reconnect'))).out).state.connection, 'ready');
    assert.equal(decode((await f.ask(request('finite-check'))).out).state.connection, 'ready');
    assert.equal(launches, 1); assert.equal(runtime.exitCode, null); assert.equal(runtime.signalCode, null);
    const paused = decode((await f.ask(request('finite-pause', 'disconnect-and-pause'))).out);
    assert.equal(paused.state.paused, true); assert.equal(paused.state.connection, 'disconnected');
    assert.ok(runtime.exitCode !== null || runtime.signalCode !== null);
    assert.equal(launches, 1);
    await owner.close();
    assert.equal(fs.existsSync(path.join(f.root, 'controller.lease')), false);
    assert.equal(fs.existsSync(path.join(f.root, 'device-operations.lease')), false);
  } finally {
    await owner.close().catch(() => {});
    if (runtime && runtime.exitCode === null && runtime.signalCode === null) { const closed = once(runtime, 'close'); runtime.kill(); await closed; }
  }
});

check('only the bound extension origin and documented optional Windows argument are accepted', async t => {
  const f = await fixture(t), before = fs.readFileSync(f.journal, 'utf8');
  for (const args of [[], ['https://chatgpt.com/'], ['chrome-extension://' + 'b'.repeat(32) + '/'],
    [origin + 'devices.html'], [origin, '--binding-file', f.bindingFile], [origin, '--parent-window=1', '--parent-window=2']]) {
    const result = await f.ask(request('not-admitted', 'reconnect'), args);
    assert.equal(result.code, 1); assert.equal(result.out.length, 0);
    assert.equal(result.error.includes(f.base), false);
  }
  const optional = await f.ask(request('window-argument'), [origin, '--parent-window=0']);
  assert.equal(optional.code, process.platform === 'win32' ? 0 : 1);
  assert.equal(fs.readFileSync(f.journal, 'utf8'), before);
  assert.deepEqual(await f.calls(), []);
});

check('oversized, malformed, truncated, non-UTF8 and multiple native frames never dispatch', async t => {
  const f = await fixture(t), before = fs.readFileSync(f.journal, 'utf8');
  const tooLarge = Buffer.alloc(4); tooLarge.writeUInt32LE(4097);
  for (const bytes of [Buffer.alloc(4), tooLarge, Buffer.from([1, 0]), Buffer.from([8, 0, 0, 0, 123]),
    frame(Buffer.from('{')), frame(Buffer.from([0xff])), frame({ ...request('bad'), command: 'private' }),
    Buffer.concat([frame(request('one', 'reconnect')), frame(request('two', 'reconnect'))])]) {
    const result = await f.bridge(bytes).done;
    assert.equal(result.code, 1); assert.equal(result.out.length, 0);
    assert.equal(result.error.includes('private'), false);
  }
  assert.equal(fs.readFileSync(f.journal, 'utf8'), before);
  assert.deepEqual(await f.calls(), []);
});

check('status with no owner never starts an owner, runtime or operation journal', async t => {
  const f = await fixture(t, { start: false });
  const result = await f.ask(request('absent'));
  assert.equal(result.code, 1); assert.equal(result.out.length, 0);
  assert.equal(fs.existsSync(f.channel), false);
  assert.equal(fs.existsSync(f.journal), false);
  assert.equal(fs.existsSync(path.join(f.root, 'controller.lease')), false);
});

check('IPC authenticates each fresh challenge and never transmits its local secret', async t => {
  const f = await fixture(t), channel = JSON.parse(fs.readFileSync(f.channel, 'utf8'));
  const { readFrame } = await import(ownerSource.href);
  const sockets = []; t.after(() => sockets.forEach(socket => socket.destroy()));
  async function connect() {
    const socket = net.createConnection(channel.endpoint); sockets.push(socket); socket.on('error', () => {});
    const challenge = await readFrame(socket);
    assert.deepEqual(Object.keys(challenge).sort(), ['nonce', 'version']);
    return { socket, challenge };
  }
  const a = await connect(), intent = request('authenticated', 'reconnect');
  const auth = { version: 1, origin, request: intent,
    mac: mac(channel.secret, 'device-request-v1', a.challenge.nonce, origin, intent) };
  a.socket.write(frame(auth));
  const reply = await readFrame(a.socket);
  assert.equal(reply.mac, mac(channel.secret, 'device-response-v1', a.challenge.nonce, origin, intent, reply.response));
  assert.equal(JSON.stringify(reply).includes(channel.secret), false);
  const b = await connect(); assert.notEqual(b.challenge.nonce, a.challenge.nonce);
  const closed = once(b.socket, 'close'); b.socket.write(frame(auth)); await closed;
  const c = await connect(), refused = once(c.socket, 'close');
  c.socket.write(frame({ ...auth, request: request('wrong-secret', 'reconnect'), mac: '0'.repeat(64) })); await refused;
  assert.deepEqual(await f.calls(), ['reconnect']);
});

check('lost native reply does not cancel or replay a durably admitted operation', async t => {
  const f = await fixture(t, { hold: true }), intent = request('lost-reply', 'reconnect');
  const effect = message(f.owner, value => value.effect === 'reconnect');
  const bridge = f.bridge(frame(intent), [origin], false); await effect;
  const row = JSON.parse(fs.readFileSync(f.journal, 'utf8').trim().split('\n').at(-1));
  assert.deepEqual(row, { id: intent.id, action: intent.action, status: 'in-progress' });
  bridge.child.kill(); await bridge.done;
  f.owner.send('release');
  const observed = decode((await f.ask(request(intent.id))).out);
  assert.equal(observed.state.operation.status, 'settled');
  assert.equal(decode((await f.ask(intent)).out).state.operation.status, 'settled');
  assert.deepEqual(await f.calls(), ['reconnect']);
});

check('a replacement channel during an admitted action prevents an authenticated settled reply', async t => {
  const f = await fixture(t, { hold: true }), intent = request('channel-changed', 'reconnect');
  const effect = message(f.owner, value => value.effect === 'reconnect');
  const bridge = f.bridge(frame(intent)); await effect;
  const previous = fs.readFileSync(f.channel); const held = f.channel + '.held';
  fs.renameSync(f.channel, held); fs.writeFileSync(f.channel, previous, { mode: 0o600 });
  f.owner.send('release');
  const result = await bridge.done; assert.equal(result.code, 1); assert.equal(result.out.length, 0);
  // Restore only the exact test-owned original so the fixture can gracefully drain.
  fs.unlinkSync(f.channel); fs.renameSync(held, f.channel);
});

check('owner death retains fences and a second owner cannot silently reclaim the channel', async t => {
  const f = await fixture(t, { hold: true }), intent = request('owner-died', 'reconnect');
  const effect = message(f.owner, value => value.effect === 'reconnect');
  const bridge = f.bridge(frame(intent)); await effect;
  const channel = fs.readFileSync(f.channel);
  const exited = once(f.owner, 'exit'); f.owner.kill(); await exited;
  const reply = await bridge.done; assert.equal(reply.code, 1); assert.equal(reply.out.length, 0);
  const replacement = await f.start(); assert.deepEqual(replacement.value, { listening: false });
  assert.deepEqual(fs.readFileSync(f.channel), channel);
  assert.equal(JSON.parse(fs.readFileSync(f.journal, 'utf8').trim().split('\n').at(-1)).status, 'in-progress');
  const later = await f.ask(request(intent.id)); assert.equal(later.code, 1); assert.equal(later.out.length, 0);
});

check('graceful close stops admission and drains an already admitted disconnected request before releasing fences', async t => {
  const f = await fixture(t, { hold: true }), intent = request('drained-connect', 'reconnect');
  const effect = message(f.owner, value => value.effect === 'reconnect');
  const bridge = f.bridge(frame(intent)); await effect;
  const closing = f.close();
  const lost = await bridge.done; assert.equal(lost.code, 1); assert.equal(lost.out.length, 0);
  assert.equal(fs.existsSync(path.join(f.root, 'device-operations.lease')), true);
  assert.equal(JSON.parse(fs.readFileSync(f.journal, 'utf8').trim().split('\n').at(-1)).status, 'in-progress');
  f.owner.send('release'); await closing;
  assert.equal(JSON.parse(fs.readFileSync(f.journal, 'utf8').trim().split('\n').at(-1)).status, 'settled');
  assert.equal(fs.existsSync(f.channel), false);
  assert.equal(fs.existsSync(path.join(f.root, 'device-operations.lease')), false);
});

check('frame reader accepts fragmented UTF-8 and rejects idle or truncated streams within its own bound', async () => {
  const { PassThrough } = await import('node:stream');
  const { readFrame } = await import(ownerSource.href);
  const stream = new PassThrough(), value = { example: '多字节内容' }, bytes = frame(value);
  const received = readFrame(stream, 500);
  for (const byte of bytes) stream.write(Buffer.from([byte]));
  assert.deepEqual(await received, value); stream.destroy();
  const idle = new PassThrough(); await assert.rejects(readFrame(idle, 15), /device_frame_timeout/); idle.destroy();
  const truncated = new PassThrough(), refused = readFrame(truncated, 500);
  truncated.end(bytes.subarray(0, bytes.length - 1));
  await assert.rejects(refused, /invalid_device_frame/); truncated.destroy();
});

check('invalid local native bindings never create an owner channel or operation journal', async t => {
  const f = await fixture(t, { start: false });
  const { startDeviceOwner } = await import(ownerSource.href);
  const binding = JSON.parse(fs.readFileSync(f.bindingFile, 'utf8'));
  for (const value of [{ ...binding, extensionId: 'x'.repeat(32) }, { ...binding, stateRoot: 'relative' },
    { ...binding, command: 'forbidden' }, { ...binding, version: 2 }]) {
    fs.writeFileSync(f.bindingFile, encode(value), { mode: 0o600 });
    await assert.rejects(startDeviceOwner(f.bindingFile), /invalid_device_binding/);
    const browser = await f.ask(request('invalid-local-binding', 'reconnect'));
    assert.equal(browser.code, 1); assert.equal(browser.out.length, 0);
    assert.equal(fs.existsSync(f.channel), false); assert.equal(fs.existsSync(f.journal), false);
  }
});

check('the default owner does not resolve a tunnel launch before validating the journal', async t => {
  const f = await fixture(t, { start: false });
  const marker = path.join(f.base, 'launch-resolved');
  const intent = path.join(f.root, 'lifecycle.json');
  const saved = encode({ format: 'agent-continue-lifecycle', version: 1, paused: false });
  fs.writeFileSync(intent, saved, { mode: 0o600 });
  fs.writeFileSync(f.journal, 'incomplete', { mode: 0o600 });
  for (const name of ['lifecycle.mjs', 'process-observation.mjs']) {
    fs.copyFileSync(new URL('./' + name, import.meta.url), path.join(f.source, name));
  }
  fs.writeFileSync(path.join(f.source, 'profile.mjs'), `import fs from 'node:fs';
export function buildTunnelLaunch(){
  fs.writeFileSync(${JSON.stringify(marker)},'unexpected');
  throw new Error('fixture_launch_blocked');
}`);
  const { startDeviceOwner } = await import(pathToFileURL(path.join(f.source, 'device-owner.mjs')).href);
  await assert.rejects(startDeviceOwner(f.bindingFile), /device_owner_unavailable/);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.readFileSync(intent, 'utf8'), saved);
  assert.equal(fs.existsSync(f.channel), false);
  assert.equal(fs.existsSync(path.join(f.root, 'controller.lease')), false);
});

check('an unfinished journal blocks legacy login recovery and preserves the existing receipt', async t => {
  const f = await fixture(t, { start: false });
  const { readNativeBinding, sendDeviceRequest, startDeviceOwner } = await import(ownerSource.href);
  const receipt = { id: 'interrupted-pause', action: 'disconnect-and-pause', status: 'in-progress' };
  const journal = encode({ format: 'agent-continue-device-operations', version: 1 }) + encode(receipt);
  fs.writeFileSync(f.journal, journal, { mode: 0o600 });
  let reconnects = 0;
  const state = { paused: true, runtime: 'stopped', ready: false };
  const controller = { async status() { return { ...state }; },
    async reconnect() { reconnects++; return { ...state, paused: false }; },
    async pause() { return { ...state }; }, async dispose() {} };
  const owner = await startDeviceOwner(f.bindingFile, { controller, resumeOnLogin: true });
  try {
    const binding = readNativeBinding(f.bindingFile);
    const status = await sendDeviceRequest(binding, request(receipt.id));
    assert.deepEqual(status.state.operation, { ...receipt, status: 'unknown' });
    assert.equal((await sendDeviceRequest(binding, request('new-reconnect', 'reconnect'))).ok, false);
    assert.equal(reconnects, 0);
    assert.equal(fs.readFileSync(f.journal, 'utf8'), journal);
  } finally { await owner.close(); }
});

check('only explicit login startup reconnects; normal owner startup preserves pause', async t => {
  const { startDeviceOwner } = await import(ownerSource.href);
  for (const mode of [undefined, false, true]) {
    const f = await fixture(t, { start: false });
    let reconnects = 0, disposed = 0;
    const state = { paused: true, runtime: 'stopped', ready: false };
    const controller = { async status() { return { ...state }; },
      async reconnect() { reconnects++; return { ...state, paused: false }; },
      async pause() { return { ...state }; }, async dispose() { disposed++; } };
    const owner = await startDeviceOwner(f.bindingFile, { controller,
      ...(mode === undefined ? {} : { resumeOnLogin: mode }) });
    try { assert.equal(reconnects, mode === true ? 1 : 0); }
    finally { await owner.close(); }
    assert.equal(disposed, 1);
  }
});

check('legacy login startup cannot bypass a temporary pause generation', async t => {
  const { startDeviceOwner } = await import(ownerSource.href);
  const f = await fixture(t, { start: false });
  let reconnects = 0;
  const controller = {
    async status() { return { paused: true, pauseMode: 'until-next-login', runtime: 'stopped', ready: false }; },
    async reconnect() { reconnects++; },
    async pause() { throw new Error('unexpected mutation'); },
    async dispose() {},
  };
  const owner = await startDeviceOwner(f.bindingFile, { controller, resumeOnLogin: true });
  try { assert.equal(reconnects, 0); }
  finally { await owner.close(); }
});

check('login recovery finishes before the IPC endpoint accepts connections', async t => {
  const f = await fixture(t, {start:false});
  const {startDeviceOwner} = await import(ownerSource.href);
  let release, reached;
  const entered = new Promise(resolve => {reached = resolve;});
  const gate = new Promise(resolve => {release = resolve;});
  let resumed = false;
  const controller = {async status(){if (!resumed) {reached();await gate;} return {paused:!resumed,runtime:resumed?'running':'stopped',ready:resumed};},
    async reconnect(){resumed=true;return {paused:false,runtime:'running',ready:true};},
    async pause(){return {paused:true};},async dispose(){} };
  const starting = startDeviceOwner(f.bindingFile,{controller,resumeOnLogin:true});
  t.after(async () => {release();try {const owner = await starting;await owner.close();} catch {}});
  await entered;
  const endpoint = JSON.parse(fs.readFileSync(f.channel,'utf8')).endpoint;
  const outcome = await new Promise(resolve => {
    const socket = net.createConnection(endpoint);
    const finish = value => {socket.destroy();resolve(value);};
    socket.once('connect',()=>finish('connected'));
    socket.once('error',()=>finish('refused'));
    socket.setTimeout(1000,()=>finish('timeout'));
  });
  assert.equal(outcome,'refused');
  release();
  await starting;
  const reply = await f.ask(request('after-login-init'));
  assert.equal(decode(reply.out).ok,true);
});

check('login startup does not reconnect an already-resuming controller', async t => {
  const f = await fixture(t, {start:false});
  const {startDeviceOwner} = await import(ownerSource.href);
  let reconnects = 0;
  const controller = {async status(){return {paused:false,runtime:'starting',ready:false};},
    async reconnect(){reconnects++;throw new Error('operation_busy');},
    async pause(){return {paused:true};},async dispose(){} };
  const owner = await startDeviceOwner(f.bindingFile,{controller,resumeOnLogin:true});
  try {assert.equal(reconnects,0);} finally {await owner.close();}
});

check('failed explicit login reconnect releases the owner and permits manual recovery', async t => {
  const f = await fixture(t, { start: false });
  const { startDeviceOwner } = await import(ownerSource.href);
  let disposed = 0;
  const controller = { async status() { return { paused: true, runtime: 'stopped', ready: false }; },
    async reconnect() { throw new Error('fixture_login_failure'); },
    async pause() { return { paused: true }; }, async dispose() { disposed++; } };
  await assert.rejects(startDeviceOwner(f.bindingFile, { controller, resumeOnLogin: true }), /device_owner_unavailable/);
  assert.equal(disposed, 1);
  assert.equal(fs.existsSync(f.channel), false);
  assert.equal(fs.existsSync(path.join(f.root, 'device-operations.lease')), false);
  const owner = await startDeviceOwner(f.bindingFile, { controller });
  await owner.close();
  assert.equal(disposed, 2);
});

check('channel replacement cannot skip stopping the owned controller and must retain fences', async t => {
  const f = await fixture(t, { start: false });
  const { startDeviceOwner } = await import(ownerSource.href);
  let disposed = 0;
  const state = { paused: false, runtime: 'running', ready: true };
  const controller = { async status() { return { ...state }; }, async reconnect() { return { ...state }; },
    async pause() { return { ...state, paused: true, runtime: 'stopped', ready: false }; },
    async dispose() { disposed++; } };
  const owner = await startDeviceOwner(f.bindingFile, { controller });
  t.after(() => owner.close().catch(() => {}));
  const original = fs.readFileSync(f.channel), held = f.channel + '.held';
  fs.renameSync(f.channel, held); fs.writeFileSync(f.channel, original, { mode: 0o600 });
  await assert.rejects(owner.close(), /device_channel_changed/);
  assert.equal(disposed, 1, 'channel validation must not skip this owner stop');
  assert.deepEqual(fs.readFileSync(f.channel), original);
  assert.equal(fs.existsSync(path.join(f.root, 'device-operations.lease')), true);
  await assert.rejects(owner.close(), /device_channel_changed/);
  assert.equal(disposed, 1, 'repeated close must not repeat lifecycle effects');
});

check('graceful owner shutdown releases only its channel and operation lease', async t => {
  const f = await fixture(t); await f.ask(request('close-start', 'reconnect')); await f.close();
  assert.equal(fs.existsSync(f.channel), false);
  assert.equal(fs.existsSync(path.join(f.root, 'device-operations.lease')), false);
  const later = await f.ask(request('closed')); assert.equal(later.code, 1); assert.equal(later.out.length, 0);
});
