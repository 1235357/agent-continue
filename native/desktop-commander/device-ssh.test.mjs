import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import * as owner from './device-owner.mjs';
import { prepareState } from './runtime.mjs';
function encodeNativeFrame(value) {
  const body = Buffer.from(JSON.stringify(value)), header = Buffer.alloc(4);
  header.writeUInt32LE(body.length); return Buffer.concat([header, body]);
}

const source = new URL('./device-ssh.mjs', import.meta.url);
const implemented = fs.existsSync(source) && typeof owner.readSshTarget === 'function';
test('authorized SSH adapter and private target reader exist and participate in default native regression', () => {
  assert.ok(implemented);
  const manifest = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  assert.ok(manifest.scripts.test.includes('device-ssh.test.mjs'));
});
const ssh = implemented ? await import(source) : {};
const check = (name, run) => test(name, { skip: !implemented, timeout: 20000 }, run);
const extensionId = 'a'.repeat(32), encode = value => JSON.stringify(value) + '\n';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const request = (target, id = 'ssh-status', action = 'status') => ({ version: 2, target, id, action });
const targetID = target => digest(JSON.stringify([extensionId, target]));
const response = value => ({ version: 1, id: value.id, action: value.action, ok: true,
  state: { paused: true, connection: 'disconnected', ...(value.action === 'status' ? {} : {
    operation: { id: value.id, action: value.action, status: 'settled' },
  }) } });

function fixture(t) {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ac-ssh-'));
  fs.chmodSync(base, 0o700);
  const knownHosts = path.join(base, 'known hosts'), registry = path.join(base, 'device-ssh-targets.json');
  const bytes = 'server.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureOnly\n';
  fs.writeFileSync(knownHosts, bytes, { mode: 0o600 });
  const descriptor = { host: 'server.example', port: 22, user: 'researcher', node: '/usr/bin/node',
    entry: "/srv/owner's runtime/device-server.mjs", stateRoot: '/srv/owner state', knownHosts,
    knownHostsSha256: digest(bytes) };
  const record = { format: 'agent-continue-ssh-targets', version: 1, extensionId, sshExecutable: process.execPath,
    targets: [{ id: targetID(descriptor), ...descriptor }] };
  const save = () => fs.writeFileSync(registry, encode(record), { mode: 0o600 }); save();
  const cleanup = [];
  t.after(async () => {
    try { for (const dispose of cleanup.reverse()) await dispose(); }
    finally { await fs.promises.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 }); }
  });
  return { base, knownHosts, registry, descriptor, record, save, cleanup, target: record.targets[0].id,
    read() { return owner.readSshTarget(registry, extensionId, record.targets[0].id); } };
}

function fakeSpawn(value, run) {
  const calls = [];
  const spawnProcess = (file, args, options) => {
    calls.push({ file, args, options });
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { queueMicrotask(() => child.emit('close', null, 'SIGTERM')); return true; };
    child.unref = () => {};
    queueMicrotask(() => run ? run(child) : (child.stdout.end(encode(response(value))), child.emit('close', 0, null)));
    return child;
  };
  return { calls, spawnProcess };
}

check('private enrollment yields immutable opaque identity without contacting or starting a target', t => {
  const f = fixture(t), binding = f.read();
  assert.equal(binding.target, f.target); assert.equal(binding.extensionId, extensionId);
  assert.equal(Object.isFrozen(binding), true); binding.assertCurrent();
  assert.equal(fs.existsSync(path.join(f.base, 'device-channel.json')), false);
});

check('enrollment rejects changed origins, non-private or redirected evidence and unbound descriptor edits', t => {
  const f = fixture(t);
  assert.throws(() => owner.readSshTarget(f.registry, 'b'.repeat(32), f.target));
  assert.throws(() => owner.readSshTarget(f.registry, extensionId, 'f'.repeat(64)));
  for (const change of [{ host: '-oProxyCommand=private' }, { user: 'a;private' }, { port: 0 }, { node: 'node' },
    { stateRoot: '/srv/../private' }, { entry: '/srv/other.mjs' }, { password: 'private' }]) {
    const original = structuredClone(f.record.targets[0]); Object.assign(f.record.targets[0], change); f.save();
    assert.throws(() => f.read()); f.record.targets[0] = original; f.save();
  }
  f.record.targets[0].host = 'other.example'; f.save(); assert.throws(() => f.read());
  f.record.targets[0].host = f.descriptor.host; f.save();
  fs.writeFileSync(f.knownHosts, 'changed-host-key\n'); assert.throws(() => f.read());
});

check('OpenSSH expansion syntax cannot redirect a verified known-hosts path', t => {
  const f = fixture(t);
  for (const name of ['%h keys', '${HOME} keys', 'tab\tkeys', 'quote"keys', 'back\\slash keys']) {
    const file = path.join(f.base, name);
    if (process.platform === 'win32' && /["\t\\]/.test(name)) continue;
    fs.writeFileSync(file, fs.readFileSync(f.knownHosts), { mode: 0o600 });
    const descriptor = { ...f.descriptor, knownHosts: file };
    f.record.targets[0] = { id: targetID(descriptor), ...descriptor }; f.save();
    assert.throws(() => f.read(), name);
  }
});

check('retained registry and host-key bytes/inodes are rechecked even for identical-byte replacement', t => {
  const f = fixture(t), binding = f.read();
  const bytes = fs.readFileSync(f.registry); fs.renameSync(f.registry, f.registry + '.held');
  fs.writeFileSync(f.registry, bytes, { mode: 0o600 }); assert.throws(() => binding.assertCurrent());
  const next = f.read(), key = fs.readFileSync(f.knownHosts);
  fs.renameSync(f.knownHosts, f.knownHosts + '.held'); fs.writeFileSync(f.knownHosts, key, { mode: 0o600 });
  assert.throws(() => next.assertCurrent());
});

check('only the closed target-bound lifecycle request reaches one fixed noninteractive SSH argv', async t => {
  const f = fixture(t), value = request(f.target), fake = fakeSpawn(value);
  const result = await ssh.sendSshDeviceRequest(f.read(), value, { spawnProcess: fake.spawnProcess });
  assert.deepEqual(result, { ...response(value), version: 2, target: f.target });
  assert.equal(fake.calls.length, 1); const call = fake.calls[0];
  assert.equal(call.file, process.execPath); assert.equal(call.options.shell, false); assert.equal(call.options.windowsHide, true);
  assert.deepEqual(call.options.stdio, ['ignore', 'pipe', 'pipe']);
  for (const option of ['BatchMode=yes', 'StrictHostKeyChecking=yes', 'ForwardAgent=no', 'ClearAllForwardings=yes',
    'ProxyCommand=none', 'ProxyJump=none', 'ControlMaster=no', 'ControlPath=none', 'PasswordAuthentication=no',
    'KbdInteractiveAuthentication=no', 'IdentityFile=none', 'GlobalKnownHostsFile=none', 'KnownHostsCommand=none']) {
    assert.ok(call.args.includes(option), option);
  }
  assert.deepEqual(call.args.slice(0, 3), ['-F', 'none', '-T']);
  assert.ok(call.args.includes('server.example')); assert.ok(call.args.includes('researcher'));
  assert.match(call.args.at(-1), /^'\/usr\/bin\/node' '/);
  assert.ok(call.args.at(-1).includes("owner'\\''s runtime/device-server.mjs"));
  assert.ok(call.args.at(-1).endsWith("'--id' 'ssh-status' '--action' 'status'"));
  assert.equal(call.options.env.SSH_ASKPASS_REQUIRE, 'never');
  assert.equal(Object.hasOwn(call.options.env, 'NODE_OPTIONS'), false);
  assert.equal(Object.hasOwn(call.options.env, 'SSH_ASKPASS'), false);
  for (const bad of [{ ...value, target: 'b'.repeat(64) }, { ...value, version: 1 }, { ...value, command: 'private' },
    { ...value, action: 'shell' }, { ...value, id: 'a;private' }]) {
    await assert.rejects(ssh.sendSshDeviceRequest(f.read(), bad, { spawnProcess: fake.spawnProcess }));
  }
  assert.equal(fake.calls.length, 1);
});

check('raw remote diagnostics, extra output and wrong receipts never escape or establish completion', async t => {
  const f = fixture(t), value = request(f.target, 'ssh-mutation', 'reconnect');
  for (const output of [encode({ ...response(value), id: 'other' }), encode({ ...response(value), output: 'private' }),
    encode(response(value)) + encode(response(value)), 'x'.repeat(4097), encode({ ...response(value),
      state: { paused: false, connection: 'ready' } })]) {
    const fake = fakeSpawn(value, child => { child.stderr.write('private-key/path'); child.stdout.end(output); child.emit('close', 0, null); });
    await assert.rejects(ssh.sendSshDeviceRequest(f.read(), value, { spawnProcess: fake.spawnProcess }), /^Error: device_ssh_unavailable$/);
    assert.equal(fake.calls.length, 1);
  }
});

check('timeout kills only the one local SSH child and never retries or invents not-executed', async t => {
  const f = fixture(t), value = request(f.target, 'lost', 'reconnect'); let killed = 0;
  const fake = fakeSpawn(value, child => { child.kill = () => { killed++; queueMicrotask(() => child.emit('close', null, 'SIGTERM')); return true; }; });
  await assert.rejects(ssh.sendSshDeviceRequest(f.read(), value, { spawnProcess: fake.spawnProcess, timeoutMs: 20 }), /^Error: device_ssh_unavailable$/);
  assert.equal(killed, 1); assert.equal(fake.calls.length, 1);
});

check('registry replacement during an awaited request refuses the old response', async t => {
  const f = fixture(t), value = request(f.target), binding = f.read();
  const fake = fakeSpawn(value, child => {
    const bytes = fs.readFileSync(f.registry); fs.renameSync(f.registry, f.registry + '.held');
    fs.writeFileSync(f.registry, bytes, { mode: 0o600 }); child.stdout.end(encode(response(value))); child.emit('close', 0, null);
  });
  await assert.rejects(ssh.sendSshDeviceRequest(binding, value, { spawnProcess: fake.spawnProcess }), /^Error: device_ssh_unavailable$/);
});

check('target routing uses only the adjacent enrolled descriptor and keeps native v1 metadata local', async t => {
  const f = fixture(t), value = request(f.target), fake = fakeSpawn(value);
  assert.equal(typeof ssh.routeDeviceRequest, 'function');
  const binding = { extensionId, assertCurrent() {} };
  assert.deepEqual(await ssh.routeDeviceRequest(binding, value, f.registry, { spawnProcess: fake.spawnProcess }),
    { ...response(value), version: 2, target: f.target });
  await assert.rejects(ssh.routeDeviceRequest({ ...binding, extensionId: 'b'.repeat(32) }, value, f.registry,
    { spawnProcess: fake.spawnProcess }));
  assert.equal(fake.calls.length, 1);
});

check('native framed v2 rejects absent enrollment without changing the local owner journal', async t => {
  const f = fixture(t), home = path.join(f.base, 'bridge'); fs.mkdirSync(home, { mode: 0o700 });
  for (const file of ['device-native-host.mjs', 'device-owner.mjs', 'device-ssh.mjs', 'device-operations.mjs',
    'runtime.mjs', 'upstream-pin.json']) {
    fs.copyFileSync(new URL(file, import.meta.url), path.join(home, file));
  }
  const root = path.join(f.base, 'local'); prepareState(root, { consent: 'full-account' });
  fs.writeFileSync(path.join(home, 'device-native-binding.json'), encode({ format: 'agent-continue-native-binding', version: 1,
    extensionId, stateRoot: root }), { mode: 0o600 });
  const value = request(f.target);
  // No fake OpenSSH executable is manufactured. Actual successful routing is
  // separately exercised with the injected SSH boundary, not claimed here.
  const spawnBridge = async (payload, origin = 'chrome-extension://' + extensionId + '/') => {
    const child = spawn(process.execPath, [path.join(home, 'device-native-host.mjs'), origin], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], errors = [];
    child.stdout.on('data', data => out.push(data)); child.stderr.on('data', data => errors.push(data));
    child.stdin.end(encodeNativeFrame(payload));
    const [code] = await once(child, 'close');
    return { code, out: Buffer.concat(out), error: Buffer.concat(errors).toString('utf8') };
  };
  const missing = await spawnBridge(value); assert.equal(missing.code, 1); assert.equal(missing.out.length, 0);
  assert.equal(fs.existsSync(path.join(root, 'device-operations.jsonl')), false);
  assert.equal(fs.existsSync(path.join(root, 'device-channel.json')), false);
  const hostSource = fs.readFileSync(path.join(home, 'device-native-host.mjs'), 'utf8');
  assert.match(hostSource, /routeDeviceRequest/); assert.match(hostSource, /request\?\.version === 2/);
  assert.match(hostSource, /device-ssh-targets\.json/);
  const bad = await spawnBridge(value, 'https://chatgpt.com/'); assert.equal(bad.code, 1); assert.equal(bad.out.length, 0);
  assert.equal(bad.error.includes(f.base), false);
});

check('real independent server request processes retain mutations across a simulated SSH boundary', async t => {
  const f = fixture(t), root = path.join(f.base, 'state'); prepareState(root, { consent: 'full-account' });
  let paused = true; const calls = [];
  const controller = { async status() { return { paused, runtime: paused ? 'stopped' : 'running', ready: !paused }; },
    async reconnect() { calls.push('reconnect'); paused = false; return this.status(); },
    async pause() { calls.push('pause'); paused = true; return this.status(); }, async dispose() {} };
  const running = await owner.startServerOwner(root, { controller }); f.cleanup.push(() => running.close());
  const children = new Set();
  f.cleanup.push(async () => { for (const child of children) { const done = once(child, 'close'); child.kill(); await done; } });
  let current;
  const spawnProcess = () => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./device-server.mjs', import.meta.url)),
      'request', '--state-dir', root, '--id', current.id, '--action', current.action], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child); child.once('close', () => children.delete(child)); return child;
  };
  const ask = async (id, action) => { current = request(f.target, id, action); return ssh.sendSshDeviceRequest(f.read(), current, { spawnProcess }); };
  const first = await ask('once', 'reconnect'); assert.equal(first.state.connection, 'ready');
  assert.deepEqual(await ask('once', 'reconnect'), first);
  await ask('pause', 'disconnect-and-pause');
  assert.deepEqual((await ask('once', 'status')).state.operation, first.state.operation);
  assert.deepEqual(calls, ['reconnect', 'pause']);
});
