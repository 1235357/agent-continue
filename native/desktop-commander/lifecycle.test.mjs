import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { prepareState } from './runtime.mjs';

const source = new URL('./lifecycle.mjs', import.meta.url);
const exists = fs.existsSync(source);
test('owned runtime controller exists', () => assert.ok(exists));
const check = (name, run) => test(name, { skip: !exists }, run);

async function fixture(t, { health = true, stop = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcontinue-lifecycle-'));
  const root = path.join(base, 'state');
  prepareState(root, { consent: 'full-account' });
  const copy = path.join(base, 'source'); fs.mkdirSync(copy);
  for (const name of ['lifecycle.mjs', 'profile.mjs', 'tunnel-pins.json']) {
    fs.copyFileSync(new URL('./' + name, import.meta.url), path.join(copy, name));
  }
  fs.writeFileSync(path.join(copy, 'runtime.mjs'), `export * from ${JSON.stringify(new URL('./runtime.mjs', import.meta.url).href)};\n`);
  fs.writeFileSync(path.join(copy, 'process-observation.mjs'), `export * from ${JSON.stringify(new URL('./process-observation.mjs', import.meta.url).href)};\n`);
  const executable = path.join(base, 'inert-client');
  fs.writeFileSync(executable, 'not-executed-synthetic-pin', { mode: 0o700 });
  const pins = JSON.parse(fs.readFileSync(path.join(copy, 'tunnel-pins.json'), 'utf8'));
  pins.platforms[process.platform + '-' + process.arch] = {
    executableSha256: crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex'),
  };
  fs.writeFileSync(path.join(copy, 'tunnel-pins.json'), JSON.stringify(pins));
  const key = path.join(base, 'runtime.key'); fs.writeFileSync(key, 'fake-key-not-for-export', { mode: 0o600 });
  const profile = await import(pathToFileURL(path.join(copy, 'profile.mjs')).href);
  profile.writeTunnelProfile(root, { tunnelId: 'tunnel_' + 'a'.repeat(32), runtimeKeyFile: key, tunnelExecutable: executable });
  const { openController } = await import(pathToFileURL(path.join(copy, 'lifecycle.mjs')).href);
  const children = [], launches = [], pauseAtSignal = [], probes = [];
  let controller, expectedUnknownCleanup = false;
  const services = {
    readyTimeoutMs: 150, stopTimeoutMs: 80, pollIntervalMs: 10,
    spawn(command, args, options) {
      launches.push({ command, args, options });
      const child = new EventEmitter();
      child.pid = 12345; child.exitCode = null; child.signalCode = null;
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.finish = () => {
        if (child.exitCode !== null) return;
        child.exitCode = 0; child.stdout.end(); child.stderr.end(); child.emit('exit', 0, null);
      };
      child.kill = signal => {
        assert.equal(signal, 'SIGTERM');
        pauseAtSignal.push(JSON.parse(fs.readFileSync(path.join(root, 'lifecycle.json'), 'utf8')).paused);
        if (stop) queueMicrotask(child.finish);
        return true;
      };
      const healthFile = args[args.indexOf('--health.url-file') + 1];
      assert.ok(healthFile && path.dirname(healthFile) === root);
      if (health) fs.writeFileSync(healthFile, 'http://127.0.0.1:32456\n', { flag: 'wx', mode: 0o600 });
      children.push(child);
      return child;
    },
    async fetch(url, options) {
      probes.push({ url: String(url), options });
      return { status: 200, body: { cancel: async () => {} } };
    },
    async observeCore() { return { pid: 54321, startTime: '123456789', executable: process.execPath }; },
    async hasExited() { return children.at(-1)?.exitCode !== null; },
  };
  t.after(async () => {
    for (const child of children) child.finish();
    if (controller) {
      try { await controller.dispose(); }
      catch (error) { if (!expectedUnknownCleanup || error.message !== 'stop_unconfirmed') throw error; }
    }
    await fs.promises.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  return { root, base, key, executable, launches, children, probes, pauseAtSignal,
    allowUnknownCleanup() { expectedUnknownCleanup = true; },
    open(overrides = {}) { controller = openController(root, { ...services, ...overrides }); return controller; },
    openController, services };
}

check('opening defaults to paused and repeated status never starts or changes intent', async t => {
  const f = await fixture(t), c = f.open();
  const initial = await c.status();
  assert.deepEqual(initial, { paused: true, runtime: 'stopped', ready: false, chatAuthorization: 'not-observed' });
  await c.status();
  assert.equal(f.launches.length, 0); assert.equal(f.probes.length, 0);
  assert.equal(fs.existsSync(path.join(f.root, 'lifecycle.json')), false);
});

check('second owner rejects without reclaiming the existing lease', async t => {
  const f = await fixture(t); f.open();
  const before = fs.readFileSync(path.join(f.root, 'controller.lease'));
  assert.throws(() => f.openController(f.root, f.services), /controller_owned/);
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'controller.lease')), before);
});

check('reconnect starts exactly one fixed hidden official-client launch and reuses it', async t => {
  const f = await fixture(t), c = f.open();
  assert.deepEqual(await c.reconnect(), { paused: false, runtime: 'running', ready: true, chatAuthorization: 'not-observed' });
  const first = f.launches[0];
  assert.equal(first.command, f.executable);
  assert.deepEqual(first.args.slice(0, 3), ['run', '--profile-file', path.join(f.root, 'tunnel.yaml')]);
  assert.equal(first.options.windowsHide, true); assert.equal(first.options.shell, false);
  assert.equal(first.options.env.NODE_OPTIONS, undefined);
  assert.equal(f.probes[0].url, 'http://127.0.0.1:32456/readyz');
  assert.equal(f.probes[0].options.redirect, 'error');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'lifecycle.json'), 'utf8')).paused, false);
  await c.reconnect(); assert.equal(f.launches.length, 1);
});

check('pause persists before signaling and status never clears it', async t => {
  const f = await fixture(t), c = f.open(); await c.reconnect();
  assert.deepEqual(await c.pause(), { paused: true, runtime: 'stopped', ready: false, chatAuthorization: 'not-observed' });
  assert.deepEqual(f.pauseAtSignal, [true]);
  await c.status(); await c.status(); assert.equal(f.launches.length, 1);
});

check('pause interrupts readiness and reconnect cannot overtake it', async t => {
  const f = await fixture(t, { health: false }), c = f.open();
  const connecting = c.reconnect();
  await assert.rejects(c.reconnect(), /operation_busy/);
  const pausing = c.pause();
  await assert.rejects(c.reconnect(), /operation_busy/);
  const [started, paused] = await Promise.all([connecting, pausing]);
  assert.equal(started.paused, true); assert.equal(started.ready, false);
  assert.equal(paused.runtime, 'stopped'); assert.equal(f.launches.length, 1);
});

check('a readiness timeout retains the same live child instead of retrying the launch', async t => {
  const f = await fixture(t, { health: false }), c = f.open();
  assert.deepEqual(await c.reconnect(), { paused: false, runtime: 'running', ready: false, chatAuthorization: 'not-observed' });
  await c.reconnect(); assert.equal(f.launches.length, 1);
});

check('unconfirmed stop retains paused ownership and forbids release or replacement', async t => {
  const f = await fixture(t, { stop: false }), c = f.open(); await c.reconnect();
  const result = await c.pause();
  assert.equal(result.paused, true); assert.equal(result.runtime, 'unknown'); assert.equal(result.ready, false);
  await assert.rejects(c.reconnect(), /stop_unconfirmed/);
  await assert.rejects(c.dispose(), /stop_unconfirmed/);
  assert.equal(fs.existsSync(path.join(f.root, 'controller.lease')), true);
  assert.equal(f.launches.length, 1);
  f.children[0].finish();
});

check('unexpected child exit is failed, not an automatic reconnect or a cleared pause', async t => {
  const f = await fixture(t), c = f.open(); await c.reconnect();
  f.children[0].finish();
  assert.deepEqual(await c.status(), { paused: false, runtime: 'failed', ready: false, chatAuthorization: 'not-observed' });
  assert.equal(f.launches.length, 1);
});

check('explicit pause and reconnect use fresh health files with no live-child overlap', async t => {
  const f = await fixture(t), c = f.open(); await c.reconnect(); await c.pause(); await c.reconnect();
  const health = f.launches.map(x => x.args[x.args.indexOf('--health.url-file') + 1]);
  assert.notEqual(health[0], health[1]); assert.equal(f.children[0].exitCode, 0);
  assert.equal(f.launches.length, 2);
});

check('malformed intent and an abandoned lease fail closed without overwrite', async t => {
  const f = await fixture(t), file = path.join(f.root, 'lifecycle.json');
  for (const bytes of ['{}', '{"paused":false}', '{"format":"agent-continue-lifecycle","version":1,"paused":"false"}\n']) {
    fs.writeFileSync(file, bytes);
    assert.throws(() => f.openController(f.root, f.services), /invalid_lifecycle_state/);
    assert.equal(fs.readFileSync(file, 'utf8'), bytes);
  }
  fs.rmSync(file);
  fs.writeFileSync(path.join(f.root, 'controller.lease'), 'abandoned');
  assert.throws(() => f.openController(f.root, f.services), /controller_owned/);
});

check('a changed binding cannot start or clear persisted pause', async t => {
  const f = await fixture(t), c = f.open();
  fs.appendFileSync(path.join(f.root, 'tunnel.yaml'), '\n');
  await assert.rejects(c.reconnect(), /binding_changed/);
  assert.equal(f.launches.length, 0);
  assert.equal(fs.existsSync(path.join(f.root, 'lifecycle.json')), false);
});

check('non-loopback or credentialed health addresses never reach fetch', async t => {
  const f = await fixture(t, { health: false }), c = f.open();
  const start = c.reconnect();
  const file = f.launches[0].args[f.launches[0].args.indexOf('--health.url-file') + 1];
  fs.writeFileSync(file, 'http://user:secret@example.invalid:8080\n');
  await start;
  assert.equal(f.probes.length, 0);
  assert.equal((await c.status()).ready, false);
});

check('status neither reads keys nor exports raw local paths or error strings', async t => {
  const f = await fixture(t), c = f.open();
  const read = fs.readFileSync;
  fs.readFileSync = function(file, ...args) {
    if (path.resolve(String(file)) === f.key) throw new Error('key_must_not_be_read');
    return Reflect.apply(read, this, [file, ...args]);
  };
  try {
    await c.reconnect();
    const value = JSON.stringify(await c.status());
    assert.equal(value.includes(f.base), false); assert.equal(value.includes('fake-key'), false);
    assert.equal(value.includes('12345'), false);
  } finally { fs.readFileSync = read; }
});

check('dispose pauses and releases its own lease; reopening preserves pause', async t => {
  const f = await fixture(t), c = f.open(); await c.reconnect(); await c.dispose();
  assert.equal(fs.existsSync(path.join(f.root, 'controller.lease')), false);
  assert.equal((await f.open().status()).paused, true);
});

check('parent exit without confirmed core exit is unknown and cannot release or replace', async t => {
  let coreExited = false;
  const f = await fixture(t), c = f.open({ hasExited: async () => coreExited }); await c.reconnect();
  assert.equal((await c.pause()).runtime, 'unknown');
  await assert.rejects(c.reconnect(), /stop_unconfirmed/);
  await assert.rejects(c.dispose(), /stop_unconfirmed/);
  assert.equal(fs.existsSync(path.join(f.root, 'controller.lease')), true);
  // Test-owned adapter recovery represents a subsequent authoritative observation.
  coreExited = true;
});

check('a late successful readiness response cannot undo a newer pause', async t => {
  const f = await fixture(t);
  let answer, requested;
  const observed = new Promise(resolve => { requested = resolve; });
  const c = f.open({ fetch: () => { requested(); return new Promise(resolve => { answer = resolve; }); } });
  const connecting = c.reconnect(); await observed;
  const pausing = c.pause();
  answer({ status: 200, body: { cancel: async () => {} } });
  await Promise.all([connecting, pausing]);
  assert.deepEqual(await c.status(), { paused: true, runtime: 'stopped', ready: false, chatAuthorization: 'not-observed' });
});

check('reconnect reservation precedes an asynchronous old-core observation', async t => {
  const f = await fixture(t);
  let slow = false, answer;
  const c = f.open({ hasExited: () => slow ? new Promise(resolve => { answer = resolve; }) : Promise.resolve(true) });
  await c.reconnect(); f.children[0].finish(); slow = true;
  const reconnecting = c.reconnect();
  await assert.rejects(c.reconnect(), /operation_busy/);
  const pausing = c.pause(); slow = false; answer(true);
  await Promise.all([reconnecting, pausing]);
  assert.equal(f.launches.length, 1); assert.equal((await c.status()).paused, true);
});

check('replacement of the lease prevents an old owner from starting or deleting it', async t => {
  const f = await fixture(t), c = f.open();
  const lease = path.join(f.root, 'controller.lease'), retained = path.join(f.root, 'retained-lease');
  fs.renameSync(lease, retained); fs.writeFileSync(lease, 'replacement-owner');
  try {
    await assert.rejects(c.reconnect(), /controller_ownership_lost/);
    await assert.rejects(c.dispose(), /controller_ownership_lost/);
    assert.equal(f.launches.length, 0); assert.equal(fs.readFileSync(lease, 'utf8'), 'replacement-owner');
  } finally { fs.unlinkSync(lease); fs.renameSync(retained, lease); }
});

check('a failed pause publication never signals or relaunches a child', async t => {
  const f = await fixture(t), c = f.open(); await c.reconnect();
  const rename = fs.renameSync;
  fs.renameSync = () => { throw new Error('synthetic-private-error'); };
  try { assert.throws(() => c.pause(), /intent_publish_failed/); }
  finally { fs.renameSync = rename; }
  assert.equal(f.pauseAtSignal.length, 0); assert.equal(f.launches.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'lifecycle.json'), 'utf8')).paused, false);
});

check('post-parent-exit discovery cannot capture a reused parent PID child', async t => {
  const f = await fixture(t); f.allowUnknownCleanup();
  let answer;
  const c = f.open({ observeCore: () => new Promise(resolve => { answer = resolve; }) });
  const start = c.reconnect(); f.children[0].finish();
  answer({ pid: 98765, startTime: '456789', executable: process.execPath });
  assert.equal((await start).runtime, 'unknown');
  assert.equal((await c.pause()).runtime, 'unknown');
  await assert.rejects(c.dispose(), /stop_unconfirmed/);
});

check('early parent exit without any captured core is unknown in the first result', async t => {
  const f = await fixture(t); f.allowUnknownCleanup();
  const c = f.open({ observeCore: async () => null });
  const start = c.reconnect(); f.children[0].finish();
  assert.equal((await start).runtime, 'unknown');
});

check('missing lease rejects status with a fixed code rather than a local path', async t => {
  const f = await fixture(t), c = f.open();
  const lease = path.join(f.root, 'controller.lease'), held = path.join(f.root, 'held-lease');
  fs.renameSync(lease, held);
  try {
    await assert.rejects(c.status(), error => error.message === 'controller_ownership_lost' && !error.message.includes(f.base));
  } finally { fs.renameSync(held, lease); }
});

check('elapsed-time budgets never depend on the adjustable wall clock', async t => {
  const f = await fixture(t, { health: false }), c = f.open(), now = Date.now;
  Date.now = () => { throw new Error('wall_clock_used'); };
  try { assert.equal((await c.reconnect()).runtime, 'running'); await c.pause(); }
  finally { Date.now = now; }
});

check('changed provider policy blocks a new launch but cannot disable manual pause', async t => {
  const f = await fixture(t), c = f.open(); await c.reconnect();
  const file = path.join(f.root, 'home', '.claude-server-commander', 'config.json');
  const original = fs.readFileSync(file, 'utf8'), changed = JSON.parse(original); changed.telemetryEnabled = true;
  fs.writeFileSync(file, JSON.stringify(changed));
  try {
    assert.equal((await c.pause()).runtime, 'stopped');
    await assert.rejects(c.reconnect(), /configuration_changed/);
    assert.equal(f.launches.length, 1); assert.equal(f.pauseAtSignal[0], true);
  } finally { fs.writeFileSync(file, original); }
});
