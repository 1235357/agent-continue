import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { openController } from '../native/desktop-commander/lifecycle.mjs';
import { observeCore } from '../native/desktop-commander/process-observation.mjs';
import { startWindowsAdministratorOwner } from '../native/desktop-commander/windows-admin-owner.mjs';

const [mode, ...args] = process.argv.slice(2);
const script = fileURLToPath(import.meta.url);
const watchdog = setTimeout(() => {
  console.error('owner recovery fixture timed out: ' + mode);
  process.exit(5);
}, 35000);

async function waitFor(read, label) {
  const deadline = performance.now() + 18000;
  do {
    const value = read();
    if (value) return value;
    await delay(50);
  } while (performance.now() < deadline);
  throw new Error('owner recovery fixture did not observe ' + label);
}

async function launcher(release, flag, healthFile) {
  assert.equal(flag, '--health.url-file');
  const provider = spawn(process.execPath, [script, 'provider'], {
    windowsHide: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const exited = once(provider, 'exit');
  const server = http.createServer((request, response) => {
    response.writeHead(request.url === '/readyz' ? 200 : 404).end();
  });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    fs.writeFileSync(healthFile, 'http://127.0.0.1:' + server.address().port + '/\n', { flag: 'wx' });
    await waitFor(() => fs.existsSync(release), 'broker Ready release');
    provider.disconnect();
    assert.deepEqual(await exited, [0, null]);
  } finally {
    if (provider.connected) provider.disconnect();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

async function owner(bundle, directory, selectedSid, brokerPid) {
  const generation = process.env.AC_ADMIN_OWNER_GENERATION;
  assert.match(generation, /^[a-f0-9]{32}$/);
  assert.equal(fs.realpathSync.native(bundle), bundle);
  const root = bundle + '.state';
  const vault = bundle + '.secrets';
  const work = path.join(root, 'work');
  const release = path.join(work, 'release-' + generation);
  let core, launches = 0, providerExitVerified = false;
  const result = await startWindowsAdministratorOwner({ bundle, generation, selectedSid, env: process.env }, {
    openController(state, options) {
      const controller = openController(state, {
        ...options,
        launch() {
          const plan = options.launch();
          assert.equal(plan.configured, true);
          assert.equal(plan.args[2], path.join(vault, 'owner-tunnel.yaml'));
          assert.equal(fs.existsSync(path.join(vault, 'runtime.key')), false);
          assert.equal(++launches, 1, 'no in-generation relaunch');
          return { ...plan, command: process.execPath, args: [script, 'launcher', release] };
        },
        async observeCore(pid, executable) {
          core = await observeCore(pid, executable);
          return core;
        },
        async hasExited(identity) {
          const gone = await options.hasExited(identity);
          if (gone) {
            assert.deepEqual(identity, core);
            providerExitVerified = true;
          }
          return gone;
        },
      });
      return { ...controller, reconnect() { assert.fail('fixture journal mutation replayed'); } };
    },
  });
  assert.equal(result.status, 'ready');
  assert.ok(core, 'real Windows direct provider identity');
  const observed = await waitFor(() => {
    let row;
    try {
      row = JSON.parse(fs.readFileSync(path.join(directory, 'owner-status.json'), 'utf8'),
        (key, value, context) => key === 'rootStarted' ? context.source : value);
    }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (row.generation === generation && row.state === 'ready') return row;
  }, 'native broker Ready');
  assert.equal(observed.brokerPid, Number(brokerPid));
  assert.equal(observed.rootPid, process.pid);
  assert.ok(observed.observedTicks > 0);
  for (const file of [path.join(vault, 'owner-job.lease'), path.join(root, 'controller.lease'),
    path.join(root, 'device-operations.lease')]) assert.ok(fs.existsSync(file), file);
  fs.writeFileSync(release, '', { flag: 'wx' });
  const { status } = await result.finished;
  assert.equal(status, 'tunnel-exited');
  assert.equal(providerExitVerified, true);
  fs.writeFileSync(path.join(work, 'ready-' + generation + '.json'),
    JSON.stringify({ generation, rootPid: observed.rootPid, rootStarted: observed.rootStarted,
      providerPid: core.pid, providerStarted: core.startTime, status, providerExitVerified }), { flag: 'wx' });
}

try {
  if (mode === 'owner') await owner(...args);
  else if (mode === 'launcher') await launcher(...args);
  else if (mode === 'provider') await once(process, 'disconnect');
  else assert.fail('unknown recovery fixture mode');
} finally {
  clearTimeout(watchdog);
}
