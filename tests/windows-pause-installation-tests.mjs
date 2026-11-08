import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveAdministratorBrowser, createAdministratorBrowserActions } from '../native/desktop-commander/windows-admin-browser-host.mjs';
import { readFrame, writeFrame } from '../native/desktop-commander/device-owner.mjs';

const digest = 'a'.repeat(64), operationId = 'b'.repeat(32);
const origin = 'chrome-extension://' + 'c'.repeat(32) + '/';
const binding = { version: 1, origin, bundleSha256: digest, systemDirectory: 'C:\\Windows\\System32' };
const root = 'C:\\Program Files\\AgentContinueAdmin\\' + digest.slice(0, 24);
const support = () => ({ bundleSha256: digest, state: 'supported' });
const receipt = (state = 'pause-recorded') => ({ bundleSha256: digest, operationId, state });
const request = action => ({ version: 1, id: randomUUID(), action, bundleSha256: digest,
  ...(action === 'pause-installation-support' ? {} : { operationId }) });
const forbidden = () => assert.fail('installation pause cannot enter targeted Pause, control, startup or fallback');

async function framed(req, callbacks = {}, args = [origin]) {
  const input = new PassThrough(), output = new PassThrough();
  try {
    await writeFrame(input, req);
    await serveAdministratorBrowser({ input, output, args, origin, bundleSha256: digest,
      start: forbidden, openSession: forbidden, readStatus: forbidden, readPauseSupport: forbidden,
      requestPause: forbidden, readControlSupport: forbidden, requestControl: forbidden,
      ...callbacks });
    return await readFrame(output, 4000);
  } finally { input.destroy(); output.destroy(); }
}

test('installation pause routes three closed target-free actions and correlates exact replies', async () => {
  for (const [action, callback, reply] of [
    ['pause-installation-support', 'readInstallationPauseSupport', support()],
    ['pause-installation', 'requestInstallationPause', receipt('requested')],
    ['pause-installation-status', 'readInstallationPauseStatus', receipt()],
  ]) {
    const req = request(action), calls = [];
    assert.deepEqual(await framed(req, { [callback]: value => { calls.push(value); return reply; } }), { ...req, ...reply });
    assert.deepEqual(calls, [action.endsWith('-support') ? digest : { bundleSha256: digest, operationId }]);
  }
});

test('installation pause denies malformed fields, target injection, foreign bundle and origin before callbacks', async () => {
  for (const action of ['pause-installation-support', 'pause-installation', 'pause-installation-status']) {
    const req = request(action);
    const callbacks = { readInstallationPauseSupport: forbidden, requestInstallationPause: forbidden, readInstallationPauseStatus: forbidden };
    const bad = [null, {}, { ...req, id: operationId }, { ...req, id: req.id + '\n' },
      { ...req, bundleSha256: 'd'.repeat(64) }, { ...req, bundleSha256: digest + '\n' },
      { ...req, bundleSha256: digest.toUpperCase() }];
    for (const key of Object.keys(req)) { const r = { ...req }; delete r[key]; bad.push(r); }
    for (const key of ['target', 'origin', 'userSid', 'command', 'control', 'consent']) bad.push({ ...req, [key]: 'injected' });
    if (action.endsWith('-support')) bad.push({ ...req, operationId });
    else for (const id of [null, '', randomUUID(), operationId.toUpperCase(), operationId + '\n']) bad.push({ ...req, operationId: id });
    for (const value of bad) await assert.rejects(framed(value, callbacks), /browser_request/);
    await assert.rejects(framed(req, callbacks, [origin.replaceAll('c', 'd')]), /browser_origin/);
  }
});

test('installation pause validates all response states and fails closed with exact identities', async () => {
  for (const [action, callback, states] of [
    ['pause-installation-support', 'readInstallationPauseSupport', ['supported', 'unconfirmed']],
    ['pause-installation', 'requestInstallationPause', ['requested', 'cancelled', 'unconfirmed', 'pause-recorded', 'stopped', 'fenced', 'superseded']],
    ['pause-installation-status', 'readInstallationPauseStatus', ['unconfirmed', 'pause-recorded', 'stopped', 'fenced', 'superseded']],
  ]) {
    const req = request(action), isSupport = action.endsWith('-support');
    const unknown = isSupport ? { bundleSha256: digest, state: 'unconfirmed' } : receipt('unconfirmed');
    for (const state of states) {
      const reply = isSupport ? { bundleSha256: digest, state } : receipt(state);
      assert.deepEqual(await framed(req, { [callback]: () => reply }), { ...req, ...reply });
    }
    for (const reply of [null, {}, [], { ...unknown, state: 'ready' }, { ...unknown, target: null },
      { ...unknown, bundleSha256: 'd'.repeat(64) }, { ...unknown, private: 'secret' },
      ...(isSupport ? [{ ...unknown, operationId }] : [{ ...unknown, operationId: 'e'.repeat(32) }]),
      ...(action.endsWith('-status') ? [receipt('requested'), receipt('cancelled')] : [])]) {
      assert.deepEqual(await framed(req, { [callback]: () => reply }), { ...req, ...unknown });
    }
    assert.deepEqual(await framed(req, { [callback]: () => { throw new Error('private'); } }), { ...req, ...unknown });
    assert.deepEqual(await framed(req), { ...req, ...unknown });
  }
});

test('installation pause adapters use only fixed new stager actions, binding origin, and no target', async () => {
  const calls = [];
  let reply;
  const actions = createAdministratorBrowserActions(root, binding, async (...args) => { calls.push(args); return { stdout: JSON.stringify(reply) }; });
  for (const [method, action, value, result] of [
    ['readInstallationPauseSupport', 'CheckBrowserHostedOwnerInstallationPause', digest, support()],
    ['requestInstallationPause', 'RequestBrowserHostedOwnerInstallationPause', { bundleSha256: digest, operationId }, receipt('requested')],
    ['readInstallationPauseStatus', 'ObserveBrowserHostedOwnerInstallationPause', { bundleSha256: digest, operationId }, receipt()],
  ]) {
    assert.equal(typeof actions[method], 'function');
    reply = result;
    assert.deepEqual(await actions[method](value), result);
    const [exe, argv, options] = calls.at(-1);
    assert.equal(exe, binding.systemDirectory + '\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.deepEqual(argv, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', root + '.browser\\stager.ps1',
      '-Action', action, '-Archive', root + '.browser\\bundle.zip', '-ExpectedSha256', digest,
      '-BrowserExtensionId', 'c'.repeat(32), ...(typeof value === 'string' ? [] : ['-PauseOperationId', operationId])]);
    assert.equal(options.windowsHide, true);
    assert.equal(options.shell, undefined);
    if (method === 'requestInstallationPause') assert.equal(Object.hasOwn(options, 'timeout'), false);
    else assert.ok(options.timeout > 0 && options.timeout <= 20000);
    for (const bad of [null, {}, 'invalid', { bundleSha256: 'd'.repeat(64), operationId },
      { bundleSha256: digest, operationId, target: 'd'.repeat(32) + ':idle' }]) await assert.rejects(actions[method](bad));
  }
  assert.equal(calls.length, 3);
});

test('installation pause response deadline leaves execute pending without timeout, abort, unref or replay', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish, calls = 0, options, returned = false;
  const actions = createAdministratorBrowserActions(root, binding, async (_exe, _argv, opts) => {
    calls++; options = opts;
    return new Promise(resolve => { finish = resolve; });
  });
  const work = actions.requestInstallationPause({ bundleSha256: digest, operationId }).then(result => { returned = true; return result; });
  assert.equal(calls, 1);
  for (const key of ['timeout', 'signal', 'killSignal']) assert.equal(Object.hasOwn(options, key), false);
  t.mock.timers.tick(29999);
  await Promise.resolve();
  assert.equal(returned, false);
  t.mock.timers.tick(1);
  assert.deepEqual(await work, receipt('unconfirmed'));
  finish({ stdout: JSON.stringify(receipt('stopped')) });
  await Promise.resolve();
  t.mock.timers.tick(300000);
  assert.equal(calls, 1);
});

test('installation pause consumes late execute rejection after its exact-ID unknown reply without retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let reject, calls = 0;
  const actions = createAdministratorBrowserActions(root, binding, () => {
    calls++;
    return new Promise((_resolve, no) => { reject = no; });
  });
  const work = actions.requestInstallationPause({ bundleSha256: digest, operationId });
  t.mock.timers.tick(30000);
  assert.deepEqual(await work, receipt('unconfirmed'));
  reject(new Error('late failure'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(calls, 1);
});

test('framed installation pause returns one unknown frame and only explicit same-ID status can follow', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = Promise.withResolvers(), started = Promise.withResolvers(), chunks = [], calls = [];
  let kills = 0, unrefs = 0;
  pending.promise.child = { kill() { kills++; }, unref() { unrefs++; } };
  const actions = createAdministratorBrowserActions(root, binding, (...args) => {
    calls.push(args);
    if (args[1][6] === 'RequestBrowserHostedOwnerInstallationPause') { started.resolve(); return pending.promise; }
    assert.equal(args[1][6], 'ObserveBrowserHostedOwnerInstallationPause');
    return Promise.resolve({ stdout: JSON.stringify(receipt('stopped')) });
  });
  const req = request('pause-installation'), input = new PassThrough(), output = new PassThrough();
  output.on('data', bytes => chunks.push(bytes));
  try {
    await writeFrame(input, req);
    const work = serveAdministratorBrowser({ input, output, args: [origin], origin, ...actions });
    await started.promise;
    t.mock.timers.tick(30000);
    await work;
    const bytes = Buffer.concat(chunks);
    assert.equal(bytes.length, 4 + bytes.readUInt32LE());
    assert.deepEqual(JSON.parse(bytes.subarray(4).toString('utf8')), { ...req, ...receipt('unconfirmed') });
    pending.resolve({ stdout: JSON.stringify(receipt('stopped')) });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(Buffer.concat(chunks), bytes);
    assert.equal(calls.length, 1);
    assert.equal(kills, 0);
    assert.equal(unrefs, 0);
    const read = { ...req, id: randomUUID(), action: 'pause-installation-status' };
    assert.deepEqual(await framed(read, actions), { ...read, ...receipt('stopped') });
    assert.equal(calls.length, 2);
  } finally { pending.resolve({ stdout: '{}' }); input.destroy(); output.destroy(); }
});

test('installation pause adapters never retry malformed/lost replies or use a legacy fallback', async () => {
  for (const [method, value, unknown] of [
    ['readInstallationPauseSupport', digest, { bundleSha256: digest, state: 'unconfirmed' }],
    ['requestInstallationPause', { bundleSha256: digest, operationId }, receipt('unconfirmed')],
    ['readInstallationPauseStatus', { bundleSha256: digest, operationId }, receipt('unconfirmed')],
  ]) {
    for (const bad of ['PRIVATE', JSON.stringify({ ...unknown, bundleSha256: 'f'.repeat(64) }), null]) {
      let calls = 0;
      const actions = createAdministratorBrowserActions(root, binding, async () => {
        calls++;
        if (bad === null) throw new Error('lost reply');
        return { stdout: bad };
      });
      assert.deepEqual(await actions[method](value), unknown);
      assert.equal(calls, 1);
    }
  }
});

test('actual Windows installation pause, Connect race and settlement functions use scratch-only effects',
  { skip: process.platform !== 'win32', timeout: 20000 }, () => {
    const system = path.join(process.env.SystemRoot, 'System32');
    const result = spawnSync(path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./windows-pause-installation-tests.ps1', import.meta.url))],
      { encoding: 'utf8', windowsHide: true, shell: false, timeout: 15000, maxBuffer: 65536,
        env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot, PATH: system,
          PSModulePath: path.join(system, 'WindowsPowerShell', 'v1.0', 'Modules'), TEMP: process.env.TEMP, TMP: process.env.TMP } });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const row = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(row.ok, true);
    assert.ok(row.checks >= 125);
    assert.equal(row.actualUac, false);
    assert.equal(row.productionRead, false);
  });
