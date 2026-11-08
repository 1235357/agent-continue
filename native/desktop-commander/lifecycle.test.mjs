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
const expectedStatus = (paused, runtime, ready) => ({ paused, runtime, ready,
  pauseMode: paused ? 'stay-disconnected' : 'running', loginRecoveryAvailable: false, chatAuthorization: 'not-observed' });

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
  const children = [], launches = [], pauseAtSignal = [], intentsAtSignal = [], probes = [];
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
        const saved = JSON.parse(fs.readFileSync(path.join(root, 'lifecycle.json'), 'utf8'));
        pauseAtSignal.push(saved.paused);
        intentsAtSignal.push(saved);
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
  return { root, base, key, executable, launches, children, probes, pauseAtSignal, intentsAtSignal,
    allowUnknownCleanup() { expectedUnknownCleanup = true; },
    open(overrides = {}) { controller = openController(root, { ...services, ...overrides }); return controller; },
    openController, services };
}

check('opening defaults to paused and repeated status never starts or changes intent', async t => {
  const f = await fixture(t), c = f.open();
  const initial = await c.status();
  assert.deepEqual(initial, expectedStatus(true, 'stopped', false));
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

check('deferred saved intent checks startup authorization again after asynchronous launch resolution', async t => {
  const f = await fixture(t);
  const first = f.open();
  await first.reconnect();
  await first.dispose();
  let release, authorized = true;
  const c = f.open({ deferStartup: true, launch: () => new Promise(resolve => { release = resolve; }) });
  assert.deepEqual(await c.status(), expectedStatus(false, 'stopped', false));
  const startup = c.startSavedIntent(() => authorized);
  authorized = false;
  release({ configured: true, command: f.executable, args: [] });
  await startup;
  assert.equal(f.launches.length, 1, 'no second child was started');
  assert.deepEqual(await c.status(), expectedStatus(false, 'stopped', false));
});

check('a successful automatic wake leaves the running intent file in place', async t => {
  const f = await fixture(t), first = f.open();
  await first.reconnect();
  await first.dispose();
  const file = path.join(f.root, 'lifecycle.json');
  const before = fs.statSync(file, { bigint: true });
  const controller = f.open({ deferStartup: true });
  await controller.startSavedIntent();
  const after = fs.statSync(file, { bigint: true });
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeNs, before.mtimeNs);
  assert.deepEqual(await controller.status(), expectedStatus(false, 'running', true));
  assert.equal(f.launches.length, 2);
});

check('a durable pause published during automatic wake is never overwritten', async t => {
  const f = await fixture(t), first = f.open();
  await first.reconnect();
  await first.dispose();
  let release;
  const controller = f.open({ deferStartup: true, launch: () => new Promise(resolve => { release = resolve; }) });
  const starting = controller.startSavedIntent();
  const pause = '{"format":"agent-continue-lifecycle","version":1,"paused":true}\n';
  const file = path.join(f.root, 'lifecycle.json'), temporary = file + '.outside';
  fs.writeFileSync(temporary, pause);
  fs.renameSync(temporary, file);
  release({ configured: true });
  await starting;
  assert.equal(fs.readFileSync(file, 'utf8'), pause);
  assert.deepEqual(await controller.status(), expectedStatus(true, 'stopped', false));
  assert.equal(f.launches.length, 1);
});

check('reconnect starts exactly one fixed hidden official-client launch and reuses it', async t => {
  const f = await fixture(t), c = f.open();
  assert.deepEqual(await c.reconnect(), expectedStatus(false, 'running', true));
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
  assert.deepEqual(await c.pause(), expectedStatus(true, 'stopped', false));
  assert.deepEqual(f.pauseAtSignal, [true]);
  await c.status(); await c.status(); assert.equal(f.launches.length, 1);
});

const temporaryPause = loginGeneration => ({
  format: 'agent-continue-lifecycle', version: 2, paused: true, resumeOnLogin: true, loginGeneration,
});

check('missing or invalid login evidence never changes pause intent or launches', async t => {
  const f = await fixture(t);
  let login = null;
  const c = f.open({ readInteractiveLoginGeneration: () => login });
  const file = path.join(f.root, 'lifecycle.json');
  await c.pause();
  const original = fs.readFileSync(file);
  for (login of [null, '9', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => c.pauseUntilLogin(), /login_recovery_unavailable/);
    assert.equal((await c.resumeAfterInteractiveLogin()).paused, true);
    assert.equal((await c.status()).loginRecoveryAvailable, false);
    assert.deepEqual(fs.readFileSync(file), original);
  }
  assert.equal(f.launches.length, 0);
});

check('temporary pause survives owner replacement and only a later trusted login resumes once', async t => {
  const f = await fixture(t);
  let login = 18;
  const options = { readInteractiveLoginGeneration: () => login };
  const c = f.open(options), file = path.join(f.root, 'lifecycle.json');
  await c.reconnect();
  const stopped = await c.pauseUntilLogin();
  assert.equal(stopped.pauseMode, 'until-next-login');
  assert.equal(stopped.loginRecoveryAvailable, true);
  assert.deepEqual(f.intentsAtSignal, [temporaryPause(18)]);
  const original = fs.readFileSync(file);
  await c.dispose();
  const replacement = f.open(options);
  for (login of [17, 18, null]) {
    assert.equal((await replacement.resumeAfterInteractiveLogin()).paused, true);
    assert.deepEqual(fs.readFileSync(file), original);
  }
  assert.throws(() => replacement.resumeAfterInteractiveLogin(19), /invalid_login_recovery_arguments/);
  login = 19;
  assert.equal((await replacement.status()).paused, true, 'status cannot resume');
  assert.equal(f.launches.length, 1);
  const resumed = await replacement.resumeAfterInteractiveLogin();
  assert.equal(resumed.pauseMode, 'running');
  assert.equal(resumed.ready, true);
  assert.equal(f.launches.length, 2);
  await replacement.resumeAfterInteractiveLogin();
  assert.equal(f.launches.length, 2);
});

check('login recovery is single-start and yields to newer intent, evidence loss, or disposal', async t => {
  for (const change of ['unavailable', 'persistent', 'temporary', 'disposing']) {
    const f = await fixture(t);
    let login = 8;
    const entered = Promise.withResolvers(), launch = Promise.withResolvers();
    const c = f.open({ readInteractiveLoginGeneration: () => login,
      launch: () => { entered.resolve(); return launch.promise; } });
    await c.pauseUntilLogin();
    login = 9;
    const recovery = c.resumeAfterInteractiveLogin();
    await entered.promise;
    await assert.rejects(c.resumeAfterInteractiveLogin(), /operation_busy/);
    let closing;
    if (change === 'unavailable') login = null;
    if (change === 'persistent') await c.pause();
    if (change === 'temporary') await c.pauseUntilLogin();
    if (change === 'disposing') closing = c.dispose();
    launch.resolve({ configured: true });
    const result = await recovery;
    await closing;
    assert.equal(result.paused, true);
    assert.equal(result.pauseMode, change === 'persistent' ? 'stay-disconnected' : 'until-next-login');
    assert.equal(f.launches.length, 0);
    if (change === 'temporary') {
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, 'lifecycle.json'), 'utf8')), temporaryPause(9));
    }
  }
});

check('a failed saved-running launch cannot overwrite a newer temporary pause', async t => {
  const f = await fixture(t), file = path.join(f.root, 'lifecycle.json');
  const launch = Promise.withResolvers();
  fs.writeFileSync(file, '{"format":"agent-continue-lifecycle","version":1,"paused":false}\n');
  const c = f.open({ readInteractiveLoginGeneration: () => 42, launch: () => launch.promise });
  await c.pauseUntilLogin();
  launch.reject(new Error('tunnel_credentials_incomplete'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), temporaryPause(42));
  assert.equal((await c.status()).pauseMode, 'until-next-login');
  assert.equal(f.launches.length, 0);
});

check('a later temporary pause wins while recovery waits for the old core to exit', async t => {
  const f = await fixture(t), file = path.join(f.root, 'lifecycle.json');
  let login = 12, observation = 'unconfirmed';
  const reached = Promise.withResolvers(), exit = Promise.withResolvers();
  const c = f.open({ readInteractiveLoginGeneration: () => login, async hasExited() {
    if (observation === 'recovery') { reached.resolve(); return exit.promise; }
    return observation === 'confirmed';
  } });
  await c.reconnect();
  assert.equal((await c.pauseUntilLogin()).runtime, 'unknown');
  login = 13;
  observation = 'recovery';
  const pending = c.resumeAfterInteractiveLogin();
  await reached.promise;
  assert.equal(f.launches.length, 1);
  observation = 'confirmed';
  assert.equal((await c.pauseUntilLogin()).runtime, 'stopped');
  exit.resolve(true);
  assert.equal((await pending).paused, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), temporaryPause(13));
  assert.equal(f.launches.length, 1);
});

check('invalid or noncanonical temporary intent never creates an owner lease', async t => {
  const f = await fixture(t), file = path.join(f.root, 'lifecycle.json');
  for (const invalid of [
    { ...temporaryPause(3), paused: false }, { ...temporaryPause(3), resumeOnLogin: false },
    { ...temporaryPause(3), loginGeneration: -1 }, { ...temporaryPause(3), loginGeneration: '3' },
    { ...temporaryPause(3), extra: true }, { version: 2, ...temporaryPause(3) },
  ]) {
    const bytes = JSON.stringify(invalid) + '\n';
    fs.writeFileSync(file, bytes);
    assert.throws(() => f.open(), /invalid_lifecycle_state/);
    assert.equal(fs.readFileSync(file, 'utf8'), bytes);
    assert.equal(fs.existsSync(path.join(f.root, 'controller.lease')), false);
  }
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
  assert.deepEqual(await c.reconnect(), expectedStatus(false, 'running', false));
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

check('unexpected child exit with restart disabled is failed, not an automatic reconnect or a cleared pause', async t => {
  const f = await fixture(t), c = f.open({ maxRestarts: 0 }); await c.reconnect();
  f.children[0].finish();
  assert.deepEqual(await c.status(), expectedStatus(false, 'failed', false));
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

check('dispose stops its own run and preserves exact running user intent; reopening resumes it', async t => {
  const f = await fixture(t), c = f.open(); await c.reconnect();
  const file = path.join(f.root, 'lifecycle.json'), before = fs.readFileSync(file);
  await c.dispose();
  assert.equal(fs.existsSync(path.join(f.root, 'controller.lease')), false);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.deepEqual(f.pauseAtSignal, [false]);
  const reopened = f.open();
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && f.launches.length < 2) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(f.launches.length, 2, 'a persisted resume intent starts the tunnel without a user action');
  const observed = await reopened.status();
  assert.equal(observed.paused, false); assert.equal(observed.runtime !== 'stopped', true);
});

check('dispose never creates missing intent and preserves an explicit manual pause byte-for-byte', async t => {
  const f = await fixture(t), file = path.join(f.root, 'lifecycle.json');
  const empty = f.open(); await empty.dispose();
  assert.equal(fs.existsSync(file), false);
  const c = f.open(); await c.reconnect(); await c.pause();
  const before = fs.readFileSync(file); await c.dispose();
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal((await f.open().status()).paused, true); assert.equal(f.launches.length, 1);
});

check('definitive exit evidence survives disposal but is never reused by a new run', async t => {
  const f = await fixture(t);
  let observations = 0, allowExit = true, cleanup = false;
  const c = f.open({ hasExited: async () => {
    observations++;
    if (cleanup) return true;
    if (allowExit) { allowExit = false; return true; }
    throw new Error('process_observation_failed');
  } });
  try {
    await c.reconnect();
    assert.equal((await c.pause()).runtime, 'stopped');
    assert.equal((await c.status()).runtime, 'stopped');
    assert.equal(observations, 1);
    assert.equal((await c.reconnect()).ready, true);
    assert.equal((await c.pause()).runtime, 'unknown');
    assert.ok(observations > 1);
  } finally {
    cleanup = true;
    await c.dispose();
  }
  assert.equal(fs.existsSync(path.join(f.root, 'controller.lease')), false);
});

check('dispose never writes intent while stopping an in-flight readiness launch', async t => {
  const f = await fixture(t); let requested;
  const probing = new Promise(resolve => { requested = resolve; });
  const c = f.open({ fetch: () => { requested(); return new Promise(() => {}); } });
  const started = c.reconnect(); await probing;
  const file = path.join(f.root, 'lifecycle.json'), before = fs.readFileSync(file);
  const disposing = c.dispose();
  await assert.rejects(c.reconnect(), /operation_busy/);
  const observed = await started; assert.equal(observed.ready, false);
  await disposing;
  assert.deepEqual(fs.readFileSync(file), before); assert.equal(f.launches.length, 1);
  assert.equal(f.children[0].exitCode, 0);
});

check('explicit pause during disposal still persists before the shared stop settles', async t => {
  const f = await fixture(t, { stop: false }), c = f.open(); await c.reconnect();
  const disposing = c.dispose(), file = path.join(f.root, 'lifecycle.json');
  const paused = c.pause();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).paused, true);
  f.children[0].finish(); await paused; await disposing;
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).paused, true);
  assert.deepEqual(f.pauseAtSignal, [false]);
});

check('unconfirmed disposal preserves running intent and does not release or relaunch', async t => {
  const f = await fixture(t, { stop: false }), c = f.open(); await c.reconnect();
  const file = path.join(f.root, 'lifecycle.json'), before = fs.readFileSync(file);
  await assert.rejects(c.dispose(), /stop_unconfirmed/);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(fs.existsSync(path.join(f.root, 'controller.lease')), true);
  await assert.rejects(c.reconnect(), /stop_unconfirmed/);
  assert.equal(f.launches.length, 1); f.children[0].finish();
});

check('disposal signals a live owned launcher even when its provider could not be captured', async t => {
  const f = await fixture(t); f.allowUnknownCleanup();
  const c = f.open({ observeCore: async () => null });
  assert.equal((await c.reconnect()).runtime, 'unknown');
  await assert.rejects(c.dispose(), /stop_unconfirmed/);
  assert.equal(f.children[0].exitCode, 0);
  assert.equal(fs.existsSync(path.join(f.root, 'controller.lease')), true);
});

check('corrupt intent does not prevent signaling an owned launcher or authorize lease release', async t => {
  const f = await fixture(t), c = f.open();
  await c.reconnect();
  const state = path.join(f.root, 'lifecycle.json'), original = fs.readFileSync(state);
  const child = f.children[0];
  child.kill = signal => { assert.equal(signal, 'SIGTERM'); child.finish(); return true; };
  fs.writeFileSync(state, '{}');
  try {
    await assert.rejects(c.dispose(), /invalid_lifecycle_state/);
    assert.equal(child.exitCode, 0);
    assert.equal(fs.existsSync(path.join(f.root, 'controller.lease')), true);
  } finally { fs.writeFileSync(state, original); }
});

check('disposal reserves its transition before a reentrant uncertain-core observation', async t => {
  const f = await fixture(t); let coreExited = false, attempt = false, reentrant;
  const c = f.open({ hasExited: async () => {
    if (attempt) { attempt = false; reentrant = c.reconnect().then(() => 'unexpected-success', error => error.message); }
    return coreExited;
  } });
  await c.reconnect(); assert.equal((await c.pause()).runtime, 'unknown');
  attempt = true;
  try {
    await assert.rejects(c.dispose(), /stop_unconfirmed/);
    assert.equal(await reentrant, 'operation_busy');
    assert.equal(f.launches.length, 1);
  } finally { coreExited = true; }
});

check('a later explicit pause shares the existing stop timer and cannot extend its budget', async t => {
  const f = await fixture(t, { stop: false }), c = f.open(); await c.reconnect();
  const original = globalThis.setTimeout, timers = [];
  globalThis.setTimeout = function(callback, milliseconds, ...args) {
    timers.push(milliseconds); return Reflect.apply(original, this, [callback, milliseconds, ...args]);
  };
  let disposing, paused;
  try {
    disposing = c.dispose();
    assert.equal(timers.length, 1); const initial = [...timers];
    paused = c.pause(); assert.deepEqual(timers, initial); assert.deepEqual(f.pauseAtSignal, [false]);
  } finally { globalThis.setTimeout = original; f.children[0].finish(); }
  await Promise.all([disposing, paused]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'lifecycle.json'), 'utf8')).paused, true);
});

check('a reentrant explicit pause while signaling shares one shutdown stop', async t => {
  const f = await fixture(t), c = f.open(); await c.reconnect();
  const child = f.children[0], kill = child.kill; let entered = false, nested;
  child.kill = function(...args) {
    if (!entered) { entered = true; nested = c.pause(); }
    return Reflect.apply(kill, this, args);
  };
  await c.dispose(); await nested;
  assert.equal(f.pauseAtSignal.length, 1); assert.equal(f.launches.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'lifecycle.json'), 'utf8')).paused, true);
});

check('disposal reservation also blocks reentrant reconnect when core exit is confirmed', async t => {
  const f = await fixture(t); let enabled = false, reentrant;
  const c = f.open({ hasExited: async () => {
    if (enabled) { enabled = false; reentrant = c.reconnect().then(() => 'unexpected-success', error => error.message); }
    return true;
  } });
  await c.reconnect(); enabled = true; await c.dispose();
  assert.equal(await reentrant, 'operation_busy'); assert.equal(f.launches.length, 1);
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
  assert.deepEqual(await c.status(), expectedStatus(true, 'stopped', false));
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
