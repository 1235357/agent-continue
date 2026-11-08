import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { prepareState } from './runtime.mjs';
import { openDeviceOperations } from './device-operations.mjs';

const source = new URL('./lifecycle.mjs', import.meta.url);
const exists = fs.existsSync(source);
const check = (name, run) => test(name, { skip: !exists, timeout: 30000 }, run);

const readyStub = `import fs from 'node:fs';
import http from 'node:http';
const at = process.argv.indexOf('--health.url-file');
const server = http.createServer((req, res) => { res.writeHead(req.url === '/readyz' ? 200 : 404); res.end(); });
server.listen(0, '127.0.0.1', () => fs.writeFileSync(process.argv[at + 1], 'http://127.0.0.1:' + server.address().port + '\\n', { mode: 0o600 }));
setInterval(() => {}, 1000);
`;
const silentStub = 'setInterval(() => {}, 1000);\n';
const failingStub = 'setTimeout(() => process.exit(9), 150);\n';
const degradedStub = `import fs from 'node:fs';
import http from 'node:http';
const at = process.argv.indexOf('--health.url-file');
let hits = 0;
const server = http.createServer((req, res) => { hits += 1; res.writeHead(hits <= 5 ? 200 : 404); res.end(); });
server.listen(0, '127.0.0.1', () => fs.writeFileSync(process.argv[at + 1], 'http://127.0.0.1:' + server.address().port + '\\n', { mode: 0o600 }));
setInterval(() => {}, 1000);
`;

async function fixture(t, { stub = readyStub, options = {}, paused = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcontinue-supervision-'));
  const root = path.join(base, 'state');
  prepareState(root, { consent: 'full-account' });
  if (!paused) fs.writeFileSync(path.join(root, 'lifecycle.json'),
    JSON.stringify({ format: 'agent-continue-lifecycle', version: 1, paused: false }) + '\n', { mode: 0o600 });
  const client = path.join(base, 'tunnel-stub.mjs');
  fs.writeFileSync(client, stub, { mode: 0o600 });
  const children = [], byPid = new Map();
  const launch = () => ({ configured: true, source: 'test-stub', command: process.execPath,
    args: [client], cwd: path.join(root, 'work'), env: {} });
  const services = {
    readyTimeoutMs: 800, stopTimeoutMs: 2000, pollIntervalMs: 10, restartBackoffMs: 20, maxRestarts: 2,
    launch,
    spawn(command, args, spawnOptions) {
      const child = spawn(command, args, spawnOptions);
      children.push(child); byPid.set(child.pid, child);
      return child;
    },
    async observeCore(pid) { return { pid, startTime: '123456789', executable: process.execPath }; },
    async hasExited(identity) {
      const child = byPid.get(identity.pid);
      return !child || child.exitCode !== null || child.signalCode !== null;
    },
  };
  const { openController } = await import(source.href);
  let controller, operations;
  t.after(async () => {
    try { operations?.close(); } catch { /* fixture cleanup */ }
    try { await controller?.dispose(); } catch { /* fixture cleanup */ }
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) { try { child.kill(); } catch { /* fixture cleanup */ } }
    }
    await fs.promises.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  return {
    base, root, client, children, services,
    open(overrides = {}) { controller = openController(root, { ...services, ...options, ...overrides }); return controller; },
    async operationsFor(value) {
      operations = openDeviceOperations(root, value);
      return operations;
    },
  };
}

async function waitFor(predicate, milliseconds = 5000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return false;
}

check('missing credentials are reported as not configured instead of a silent failure', async t => {
  const f = await fixture(t);
  const { resolveTunnelLaunch } = await import(source.href);
  const none = resolveTunnelLaunch(f.root, { env: {} });
  assert.equal(none.configured, false); assert.equal(none.reason, 'tunnel_not_configured');
  const partial = resolveTunnelLaunch(f.root, { env: { CONTROL_PLANE_TUNNEL_ID: 'tunnel_' + 'b'.repeat(32) } });
  assert.equal(partial.configured, false); assert.equal(partial.reason, 'tunnel_credentials_incomplete');
  const c = f.open({ launch: () => ({ configured: false, source: 'none', reason: 'tunnel_not_configured' }) });
  await assert.rejects(c.reconnect(), /tunnel_not_configured/);
  assert.equal(f.children.length, 0);
  const observed = await c.status();
  assert.equal(observed.paused, true); assert.equal(observed.runtime, 'stopped');
  assert.equal(observed.configured, false); assert.equal(observed.restarts, undefined);
});

check('environment credentials become a launch record without persisting or logging the secret', async t => {
  const f = await fixture(t);
  const { resolveTunnelLaunch } = await import(source.href);
  const secret = 'sk-not-a-real-key-for-fixture';
  const launch = resolveTunnelLaunch(f.root, {
    env: { CONTROL_PLANE_TUNNEL_ID: 'tunnel_' + 'c'.repeat(32), CONTROL_PLANE_API_KEY: secret,
      AGENT_CONTINUE_TUNNEL_CLIENT: path.join(f.base, 'verified-client.exe') },
    verifyClient: file => ({ file, release: 'test' }),
  });
  assert.equal(launch.configured, true); assert.equal(launch.source, 'environment');
  assert.equal(JSON.stringify(launch.args).includes(secret), false);
  assert.ok(launch.args.includes('env:CONTROL_PLANE_API_KEY'));
  assert.equal(launch.env.CONTROL_PLANE_API_KEY, secret);
  assert.equal(JSON.stringify(launch).includes(secret), true, 'the secret exists only in the child environment');
  assert.equal(launch.args.includes(secret), false);
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  for (const file of walk(f.root)) assert.equal(fs.readFileSync(file, 'utf8').includes(secret), false, file);
});

check('status reports connection ready only after the stub actually serves readyz', async t => {
  const f = await fixture(t), c = f.open();
  const connected = await c.reconnect();
  assert.equal(connected.runtime, 'running'); assert.equal(connected.ready, true);
  assert.equal(connected.connection, undefined, 'connection is derived from the state machine, not stored');
  const ops = await f.operationsFor(c);
  const frame = await ops.handle({ version: 1, id: 'ready-frame', action: 'status' });
  assert.equal(frame.ok, true); assert.equal(frame.state.connection, 'ready');
  assert.equal(frame.state.paused, false);
});

check('pause during async launch preparation prevents late spawn and resume intent', async t => {
  const f = await fixture(t);
  let release;
  const prepared = new Promise(resolve => {release = resolve;});
  const c = f.open({launch:() => prepared});
  const pending = c.reconnect();
  await c.pause();
  release(f.services.launch());
  await pending;
  assert.equal(f.children.length,0);
  const state = await c.status();
  assert.equal(state.paused,true);
  assert.equal(state.ready,false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'lifecycle.json'),'utf8')).paused,true);
});

check('a live stub that never becomes ready reports unknown, never ready', async t => {
  const f = await fixture(t, { stub: silentStub }), c = f.open();
  const connected = await c.reconnect();
  assert.equal(connected.runtime, 'running'); assert.equal(connected.ready, false);
  const ops = await f.operationsFor(c);
  const frame = await ops.handle({ version: 1, id: 'silent-frame', action: 'status' });
  assert.equal(frame.state.connection, 'unknown');
  assert.equal(await ops.handle({ version: 1, id: 'silent-pause', action: 'disconnect-and-pause' })
    .then(reply => reply.state.connection), 'disconnected');
});

check('readiness redirects are not followed or treated as connected', async t => {
  const redirectStub = readyStub.replace(
    "res.writeHead(req.url === '/readyz' ? 200 : 404); res.end();",
    "if (req.url === '/redirected') fs.writeFileSync(process.argv[at + 1] + '.followed', 'unexpected'); res.writeHead(302, {Location:'/redirected'}); res.end();");
  assert.notEqual(redirectStub, readyStub);
  const f = await fixture(t, {stub:redirectStub}), c = f.open();
  const state = await c.reconnect();
  assert.equal(state.ready, false);
  const ops = await f.operationsFor(c);
  const frame = await ops.handle({version:1,id:'redirect-status',action:'status'});
  assert.equal(frame.state.connection, 'unknown');
  assert.equal(fs.readdirSync(f.root).some(name => name.endsWith('.followed')), false);
  await c.pause();
});

check('a launch that exits before readiness fails with an explicit code and is not restarted', async t => {
  const f = await fixture(t, { stub: failingStub }), c = f.open();
  await assert.rejects(c.reconnect(), /tunnel_start_failed/);
  const observed = await c.status();
  assert.equal(observed.runtime, 'failed'); assert.equal(observed.ready, false);
  assert.equal(observed.restarts, undefined);
  assert.equal(f.children.length, 1);
});

check('an unexpected exit after readiness restarts within policy and records the count', async t => {
  const f = await fixture(t), c = f.open();
  const first = await c.reconnect();
  assert.equal(first.ready, true);
  f.children[0].kill();
  assert.ok(await waitFor(async () => (await c.status()).ready && f.children.length === 2));
  assert.equal((await c.status()).restarts, 1);
  f.children[1].kill();
  assert.ok(await waitFor(async () => (await c.status()).ready && f.children.length === 3));
  assert.equal((await c.status()).restarts, 2);
  f.children[2].kill();
  assert.ok(await waitFor(async () => (await c.status()).runtime === 'failed'));
  const exhausted = await c.status();
  assert.equal(exhausted.restarts, 2); assert.equal(exhausted.ready, false);
  assert.equal(f.children.length, 3, 'the restart policy cap is exact');
});

check('automatic replacement waits for the old core to exit without a status request', async t => {
  const f = await fixture(t);
  let oldCoreExited = false, checks = 0;
  const c = f.open({ async hasExited(identity) {
    if (identity.pid === f.children[0].pid) {
      checks++;
      if (!oldCoreExited) return false;
    }
    return f.services.hasExited(identity);
  } });
  assert.equal((await c.reconnect()).ready, true);
  f.children[0].kill();
  assert.ok(await waitFor(() => checks > 0, 1000), 'the exited launcher was observed');
  assert.equal(f.children.length, 1, 'a live old core prevents replacement');
  oldCoreExited = true;
  assert.ok(await waitFor(() => f.children.length === 2, 1500), 'the verified old core exit unlocks recovery');
  assert.ok(await waitFor(async () => (await c.status()).ready));
  assert.equal((await c.status()).restarts, 1);
});

check('manual pause wins while automatic replacement is waiting for core exit', async t => {
  const f = await fixture(t);
  let oldCoreExited = false, checks = 0;
  const c = f.open({ async hasExited(identity) {
    checks++;
    return oldCoreExited && f.services.hasExited(identity);
  } });
  assert.equal((await c.reconnect()).ready, true);
  f.children[0].kill();
  assert.ok(await waitFor(() => checks > 0, 1000));
  const paused = c.pause();
  oldCoreExited = true;
  assert.equal((await paused).paused, true);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(f.children.length, 1);
});

check('saved browser intent notices late readiness and recovers without a status request', async t => {
  const f = await fixture(t, { paused: false, options: { deferStartup: true,
    readyTimeoutMs: 300, healthIntervalMs: 25, healthFailureThreshold: 2 } });
  let reachable = false, successfulProbes = 0;
  const c = f.open({ async fetch() {
    if (reachable) successfulProbes++;
    return { status: reachable ? 200 : 503 };
  } });
  await c.startSavedIntent();
  assert.equal(f.children.length, 1);
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(f.children.length, 1, 'initial offline probes must not replace a never-ready child');
  assert.equal(f.children[0].exitCode, null);
  assert.equal(f.children[0].signalCode, null);
  reachable = true;
  assert.ok(await waitFor(() => successfulProbes >= 2, 1500), 'background did not observe late readiness');
  f.children[0].kill();
  assert.ok(await waitFor(() => f.children.length === 2), 'background did not replace the exited child');
  assert.ok(await waitFor(async () => (await c.status()).ready));
  assert.equal((await c.status()).restarts, 1);
  await c.pause();
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(f.children.length, 2, 'manual pause must prevent another restart');
});

check('an in-flight readiness reply cannot promote a child whose state became unknown', async t => {
  const f = await fixture(t, { paused: false, options: { deferStartup: true,
    readyTimeoutMs: 300, healthIntervalMs: 25 } });
  let intercept = false, finishProbe;
  const c = f.open({ async fetch() {
    if (!intercept) return { status: 503 };
    return new Promise(resolve => { finishProbe = resolve; });
  } });
  await c.startSavedIntent();
  intercept = true;
  assert.ok(await waitFor(() => finishProbe));
  f.children[0].emit('error', new Error('fixture child lost'));
  finishProbe({ status: 200 });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal((await c.status()).ready, false);
  f.children[0].kill();
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(f.children.length, 1, 'unknown readiness must not authorize automatic replacement');
});

check('stop terminates the owned child and leaves no process or restart behind', async t => {
  const f = await fixture(t), c = f.open();
  await c.reconnect();
  const stopped = await c.pause();
  assert.equal(stopped.runtime, 'stopped'); assert.equal(stopped.ready, false);
  const child = f.children[0];
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(f.children.length, 1, 'a paused runtime is never restarted');
  assert.equal((await c.status()).runtime, 'stopped');
  await c.dispose();
  assert.equal(fs.existsSync(path.join(f.root, 'controller.lease')), false);
});

check('reopening an owner with persisted resume intent starts the tunnel without a user action', async t => {
  const f = await fixture(t, { paused: false }), c = f.open();
  const ops = await f.operationsFor(c);
  let frame;
  // A concurrent probe can set ready while connect is still publishing its phase.
  assert.ok(await waitFor(async () => {
    frame = await ops.handle({ version: 1, id: 'autostart', action: 'status' });
    return frame.ok && frame.state.connection === 'ready' && frame.state.paused === false;
  }, 6000));
  assert.equal(f.children.length, 1);
  assert.equal(frame.state.connection, 'ready'); assert.equal(frame.state.paused, false);
});

check('a fresh owner process honors the persisted resume intent and reports connection ready', async t => {
  const f = await fixture(t, { paused: false });
  const probe = path.join(f.base, 'owner-probe.mjs');
  fs.writeFileSync(probe, `import { openController } from ${JSON.stringify(new URL('./lifecycle.mjs', import.meta.url).href)};
import { openDeviceOperations } from ${JSON.stringify(new URL('./device-operations.mjs', import.meta.url).href)};
import { spawn } from 'node:child_process';
const [root, client] = process.argv.slice(2);
const children = new Map();
const controller = openController(root, {
  readyTimeoutMs: 3000, pollIntervalMs: 20, healthIntervalMs: 500,
  // This fixture is a direct Node child, not the official launcher's child tree.
  spawn(command, args, options) {
    const child = spawn(command, args, options);
    children.set(child.pid, child);
    return child;
  },
  async observeCore(pid) {
    return children.has(pid) ? { pid, startTime: '123456789', executable: process.execPath } : null;
  },
  async hasExited(identity) {
    const child = children.get(identity.pid);
    return !child || child.exitCode !== null || child.signalCode !== null;
  },
  launch: () => ({ configured: true, source: 'test-stub', command: process.execPath, args: [client], cwd: root, env: {} }),
});
const operations = openDeviceOperations(root, controller);
let state = null;
const deadline = Date.now() + 5000;
while (Date.now() < deadline) {
  state = (await operations.handle({ version: 1, id: 'probe', action: 'status' })).state;
  if (state.connection === 'ready') break;
  await new Promise(resolve => setTimeout(resolve, 50));
}
operations.close();
try { await controller.dispose(); } catch { /* the probe only reports the observed state */ }
console.log(JSON.stringify(state));
`, { mode: 0o600 });
  const output = execFileSync(process.execPath, [probe, f.root, f.client], { encoding: 'utf8', timeout: 20000 });
  const state = JSON.parse(output.trim().split(/\r?\n/).at(-1));
  assert.equal(state.connection, 'ready');
  assert.equal(state.paused, false);
});

check('reopening without credentials stays paused, reports unconfigured and spawns nothing', async t => {
  const f = await fixture(t, { paused: false });
  const c = f.open({ launch: () => ({ configured: false, source: 'none', reason: 'tunnel_not_configured' }) });
  assert.ok(await waitFor(async () => { const s = await c.status(); return s.configured === false && s.paused === true; }, 3000));
  const observed = await c.status();
  assert.equal(observed.paused, true); assert.equal(observed.runtime, 'stopped'); assert.equal(observed.ready, false);
  assert.equal(f.children.length, 0);
});

test('launcher-shaped runtime reaches readiness and stops using real OS identity observation',
  { skip: !exists || !['win32', 'linux'].includes(process.platform), timeout: 60000 }, async t => {
    const f = await fixture(t);
    const launcher = path.join(f.base, 'launcher.mjs');
    fs.writeFileSync(launcher, `import { spawn } from 'node:child_process';
const child = spawn(process.execPath, process.argv.slice(2), { stdio: 'inherit', windowsHide: true });
process.on('SIGTERM', () => child.kill());
child.on('exit', code => process.exit(code ?? 0));
`);
    const { openController } = await import(source.href);
    const controller = openController(f.root, {
      readyTimeoutMs: 15000, stopTimeoutMs: 10000, pollIntervalMs: 100,
      launch: () => ({ configured: true, source: 'test-launcher', command: process.execPath,
        args: [launcher, f.client], cwd: f.root, env: { ...process.env } }),
    });
    try {
      await controller.reconnect();
      assert.equal((await controller.status()).ready, true);
      await controller.pause();
      assert.equal((await controller.status()).runtime, 'stopped');
    } finally { await controller.dispose(); }
  });

check('reconnecting a live child retains health monitoring and rebuilds after degradation', async t => {
  const f = await fixture(t, { stub: degradedStub });
  const c = f.open({ healthIntervalMs: 50, healthFailureThreshold: 3 });
  await c.reconnect();
  await c.reconnect();
  assert.equal(f.children.length, 1, 'reconnect reuses the live instance');
  assert.equal((await c.status()).ready, true);
  assert.ok(await waitFor(async () => (await c.status()).ready === false, 3000), 'degraded before the rebuild');
  assert.ok(await waitFor(async () => (await c.status()).ready && f.children.length === 2, 6000));
  assert.equal((await c.status()).restarts, 1);
  await c.pause();
});

check('pause suspends a pending restart; resuming spawns a new generation only', async t => {
  const f = await fixture(t), c = f.open({ restartBackoffMs: 200 });
  await c.reconnect();
  assert.equal(f.children.length, 1);
  f.children[0].kill();
  await c.pause();
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(f.children.length, 1, 'a restart scheduled before the pause must not fire');
  assert.equal((await c.status()).runtime, 'stopped');
  await c.reconnect();
  assert.ok(await waitFor(async () => (await c.status()).ready && f.children.length === 2));
  assert.equal((await c.status()).ready, true);
});
