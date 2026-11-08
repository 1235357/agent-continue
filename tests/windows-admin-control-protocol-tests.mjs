import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import * as host from '../native/desktop-commander/windows-admin-browser-host.mjs';
import { readFrame, writeFrame } from '../native/desktop-commander/device-owner.mjs';

// Every execute below is mocked. No enrolled files, Windows commands or accounts are used.
const origin = 'chrome-extension://' + 'a'.repeat(32) + '/';
const digest = 'd'.repeat(64), otherDigest = 'e'.repeat(64);
const operationId = 'f'.repeat(32), otherOperationId = 'b'.repeat(32);
const target = otherOperationId + ':' + operationId, idleTarget = otherOperationId + ':idle';
const root = 'C:\\Program Files\\AgentContinueAdmin\\' + digest.slice(0, 24);
const binding = { version: 1, origin, bundleSha256: digest, systemDirectory: 'C:\\Windows\\System32' };
const controls = ['connect', 'resume-saved', 'revoke'];
const actions = ['control-support', 'control', 'control-status', 'control-fence', 'control-reconcile'];
const methods = { control: 'requestControl', 'control-status': 'readControlStatus',
  'control-fence': 'requestControlFence', 'control-reconcile': 'requestControlReconcile' };
const stagerActions = { 'control-support': 'CheckBrowserHostedOwnerControl', control: 'RequestBrowserHostedOwnerControl',
  'control-status': 'ObserveHostedOwnerControl', 'control-fence': 'RequestBrowserHostedOwnerControlFence',
  'control-reconcile': 'RequestBrowserHostedOwnerControlReconcile' };
const identity = control => ({ bundleSha256: digest, operationId, control });
const payload = (action, control = 'connect') => action === 'control-support' ? { control } :
  { ...identity(control), ...(action === 'control' && control !== 'revoke' ? { target } : {}) };
const request = (action, control = 'connect') => ({ version: 1, action, id: randomUUID(), ...payload(action, control) });
const support = (control = 'connect') => ({ control, state: 'supported', bundleSha256: digest,
  target: control === 'revoke' ? null : target, ownerState: 'running', eligible: true });
const unknownSupport = control => ({ control, state: 'unconfirmed', bundleSha256: null,
  target: null, ownerState: 'unobserved', eligible: false });
const submission = (control = 'connect', outcome = 'requested') => ({ ...identity(control), outcome });
const status = (control = 'connect', state = 'reserved', progress = null) => ({ ...identity(control), state, progress });
const replyHeader = ({ version, action, id }) => ({ version, action, id });
const unknownReply = req => req.action === 'control-support' ? unknownSupport(req.control) :
  { ...(req.action === 'control-status' ? status(req.control, 'unconfirmed') : submission(req.control, 'unconfirmed')),
    bundleSha256: req.bundleSha256, operationId: req.operationId };
const forbidden = () => assert.fail('ordinary, legacy wake, pause or session fallback');
const legacy = { start: forbidden, openSession: forbidden, readStatus: forbidden, readPauseSupport: forbidden,
  requestPause: forbidden, readPauseStatus: forbidden, requestPauseFence: forbidden };

async function framed(req, callbacks = {}, raw, args = [origin, '--parent-window=0']) {
  const input = new PassThrough(), output = new PassThrough();
  try {
    if (raw) input.write(raw); else await writeFrame(input, req);
    await host.serveAdministratorBrowser({ input, output, args, origin, ...legacy, ...callbacks });
    return await readFrame(output, 4000);
  } finally { input.destroy(); output.destroy(); }
}

function without(value, key) {
  const copy = { ...value }; delete copy[key]; return copy;
}

test('exports reusable closed control validators', () => {
  for (const name of ['isAdministratorControlRequest', 'isAdministratorControlSupport',
    'isAdministratorControlSubmission', 'isAdministratorControlStatus', 'isAdministratorControlProgress']) {
    assert.equal(typeof host[name], 'function', name);
  }
});

test('five wire actions route exact callback arguments and return only their correlated reply', async () => {
  for (const action of actions) for (const control of controls) {
    const req = request(action, control), calls = [];
    const result = action === 'control-support' ? support(control) :
      action === 'control-status' ? status(control) : submission(control);
    const method = action === 'control-support' ? 'readControlSupport' : methods[action];
    const callbacks = { [method]: (...args) => { calls.push(args); return result; } };
    assert.deepEqual(await framed(req, callbacks), { ...replyHeader(req), ...result });
    assert.deepEqual(calls, [[action === 'control-support' ? control : payload(action, control)]]);
    assert.equal(host.isAdministratorControlRequest(req), true);
  }
});

test('invalid wire request matrix is rejected before any callback or execute', async () => {
  let calls = 0;
  const unexpected = () => { calls++; throw new Error('unexpected dispatch'); };
  const callbacks = { readControlSupport: unexpected, ...Object.fromEntries(Object.values(methods).map(key => [key, unexpected])) };
  const invalidIds = ['', 'old-transport-id', operationId, null, 1, {}, randomUUID() + '\n', randomUUID().replaceAll('-', '')];
  const invalidOperations = [null, 0, {}, [], operationId.toUpperCase(), operationId.slice(1), operationId + '\n', randomUUID()];
  const invalidDigests = [null, 1, {}, [], digest.toUpperCase(), digest.slice(1), digest + '\n', 'g'.repeat(64)];
  const invalidTargets = [null, 1, {}, [], operationId, target.toUpperCase(), target + '\n', idleTarget + '\r',
    otherOperationId + ':IDLE', otherOperationId + ':idle -Action Wake'];
  for (const action of actions) for (const control of controls) {
    const req = request(action, control);
    const invalid = [null, true, [], ...Object.keys(req).map(key => without(req, key)),
      ...invalidIds.map(id => ({ ...req, id })),
      ...['Control', 'control-execute', 'control-status\n', 'start', 'wake'].map(action => ({ ...req, action })),
      ...[null, 0, 2, '1'].map(version => ({ ...req, version })),
      ...[null, 1, {}, 'Connect', 'resume', 'revoke\n', 'revoke -Command anything'].map(control => ({ ...req, control })),
      ...['path', 'archive', 'stager', 'command', 'args', 'host', 'userSid', 'origin', 'generation', 'shell', 'state']
        .map(key => ({ ...req, [key]: 'supplied' })),
    ];
    if (action === 'control-support') invalid.push({ ...req, operationId }, { ...req, bundleSha256: digest }, { ...req, target });
    else invalid.push(...invalidOperations.map(operationId => ({ ...req, operationId })),
      ...invalidDigests.map(bundleSha256 => ({ ...req, bundleSha256 })));
    if (action === 'control' && control !== 'revoke') invalid.push(...invalidTargets.map(target => ({ ...req, target })));
    else invalid.push(...[target, null, ''].map(target => ({ ...req, target })));
    for (const malformed of invalid) {
      await assert.rejects(framed(malformed, callbacks), /invalid_administrator_browser_request/);
      assert.equal(host.isAdministratorControlRequest(malformed), false);
    }
  }
  assert.equal(calls, 0);
});

test('new actions retain the exact enrolled native-origin and parent-window checks', async () => {
  for (const action of actions) for (const args of [[], ['https://chatgpt.com/'],
    [origin + '\n'], [origin, '--parent-window=bad'], [origin, '--parent-window=0', 'extra']]) {
    await assert.rejects(framed(request(action), { readControlSupport: forbidden,
      ...Object.fromEntries(Object.values(methods).map(key => [key, forbidden])) }, undefined, args), /browser_origin/);
  }
});

test('native framing rejects trailing bytes and trailing JSON before control dispatch', async () => {
  const req = request('control'), body = Buffer.from(JSON.stringify(req));
  for (const rawBody of [Buffer.concat([body, Buffer.from('{}')]), Buffer.concat([body, Buffer.from([0])])]) {
    const length = Buffer.alloc(4); length.writeUInt32LE(rawBody.length);
    await assert.rejects(framed(req, { requestControl: forbidden }, Buffer.concat([length, rawBody])), /invalid_device_frame/);
  }
  const length = Buffer.alloc(4); length.writeUInt32LE(body.length);
  await assert.rejects(framed(req, { requestControl: forbidden }, Buffer.concat([length, body, Buffer.from([0])])), /invalid_device_frame/);
});

test('support eligibility distinguishes startup, paused, revoked and unobserved targetless revoke', async () => {
  const cases = [
    support(), { ...support(), target: idleTarget, ownerState: 'paused' }, support('resume-saved'), support('revoke'),
    { ...support('revoke'), ownerState: 'unobserved' },
    ...controls.flatMap(control => ['unobserved', 'paused', 'running', 'revoked'].map(ownerState =>
      ({ ...support(control), ownerState, eligible: false, target: null }))),
    ...controls.map(unknownSupport),
  ];
  for (const result of cases) {
    assert.equal(host.isAdministratorControlSupport(result, result.control), true);
    const req = request('control-support', result.control);
    assert.deepEqual(await framed(req, { readControlSupport: () => result }), { ...replyHeader(req), ...result });
  }
});

test('malformed support is unconfirmed, never authorization or readiness', async () => {
  for (const control of controls) {
    const req = request('control-support', control), good = support(control);
    const invalid = [null, true, [], without(good, 'eligible'), { ...good, path: 'private' },
      { ...good, control: 'other' }, { ...good, control: controls.find(value => value !== control) },
      { ...good, state: 'ready' }, { ...good, bundleSha256: null }, { ...good, bundleSha256: digest + '\n' },
      { ...good, eligible: 1 }, { ...good, ownerState: 'ready' }, { ...good, ownerState: null },
      { ...unknownSupport(control), eligible: true }, { ...unknownSupport(control), bundleSha256: digest },
      { ...unknownSupport(control), target }, { ...good, target: 'bad' },
    ];
    if (control === 'revoke') invalid.push({ ...good, target });
    else invalid.push({ ...good, target: null }, { ...good, eligible: false },
      { ...good, ownerState: 'revoked' }, { ...good, ownerState: 'unobserved' });
    if (control === 'resume-saved') invalid.push({ ...good, ownerState: 'paused' });
    for (const result of invalid) {
      assert.equal(host.isAdministratorControlSupport(result, control), false);
      assert.deepEqual(await framed(req, { readControlSupport: () => result }), { ...replyHeader(req), ...unknownSupport(control) });
    }
  }
});

test('submission outcomes are closed and bound to digest, operation ID and control', async () => {
  for (const action of ['control', 'control-fence', 'control-reconcile']) for (const control of controls) {
    const req = request(action, control);
    for (const outcome of ['requested', 'cancelled', 'unconfirmed']) {
      const result = submission(control, outcome);
      assert.equal(host.isAdministratorControlSubmission(result, identity(control)), true);
      assert.deepEqual(await framed(req, { [methods[action]]: () => result }), { ...replyHeader(req), ...result });
    }
    const good = submission(control);
    for (const result of [null, true, [], without(good, 'outcome'), { ...good, target }, { ...good, state: 'reserved' },
      { ...good, path: 'private' }, { ...good, bundleSha256: otherDigest }, { ...good, operationId: otherOperationId },
      { ...good, control: controls.find(value => value !== control) }, { ...good, outcome: 'stopped' },
      { ...good, outcome: 'ready' }, { ...good, outcome: 'requested\n' }]) {
      assert.equal(host.isAdministratorControlSubmission(result, identity(control)), false);
      assert.deepEqual(await framed(req, { [methods[action]]: () => result }), { ...replyHeader(req), ...unknownReply(req) });
    }
  }
});

test('status accepts only protected per-control states and closed safe progress counts', async () => {
  const common = ['unconfirmed', 'reserved', 'superseded', 'rejected', 'fenced', 'abandoned'];
  for (const control of controls) {
    const req = request('control-status', control);
    const states = [...common, ...(control === 'revoke' ? ['revocation-recorded', 'stopped'] :
      ['intent-saved', 'launch-requested', 'launch-unconfirmed', 'recovered-paused'])];
    for (const state of states) {
      const result = status(control, state);
      assert.equal(host.isAdministratorControlStatus(result, identity(control)), true);
      assert.deepEqual(await framed(req, { readControlStatus: () => result }), { ...replyHeader(req), ...result });
    }
  }
  for (const phase of ['verifying-full', 'verifying-control', 'waiting-owner', 'waiting-stop', 'settled']) {
    const counts = phase === 'verifying-full' ? [[null, null], [0, 0], [0, 17], [17, 17], [1, Number.MAX_SAFE_INTEGER]] : [[null, null]];
    for (const [verifiedFiles, totalFiles] of counts) {
      const progress = { phase, verifiedFiles, totalFiles }, result = status('connect', 'reserved', progress);
      assert.equal(host.isAdministratorControlProgress(progress), true);
      assert.equal(host.isAdministratorControlStatus(result, identity('connect')), true);
      const req = request('control-status');
      assert.deepEqual(await framed(req, { readControlStatus: () => result }), { ...replyHeader(req), ...result });
    }
  }
});

test('invalid status and progress matrix fails closed without leaking backend metadata', async () => {
  const goodProgress = { phase: 'verifying-full', verifiedFiles: 1, totalFiles: 2 };
  const invalidProgress = [true, [], {}, without(goodProgress, 'phase'), { ...goodProgress, path: 'private' },
    ...['verifying-control', 'waiting-owner', 'waiting-stop', 'settled'].map(phase => ({ ...goodProgress, phase })),
    ...[null, '', 'ready', 'verifying-full\n'].map(phase => ({ ...goodProgress, phase })),
    ...[[null, 2], [1, null], [-1, 2], [3, 2], [0.5, 2], [1, 1.5], ['1', 2], [1, '2'],
      [NaN, 2], [1, Infinity], [1, Number.MAX_SAFE_INTEGER + 1], [false, 2]]
      .map(([verifiedFiles, totalFiles]) => ({ ...goodProgress, verifiedFiles, totalFiles })),
  ];
  for (const progress of invalidProgress) assert.equal(host.isAdministratorControlProgress(progress), false);
  for (const control of controls) {
    const req = request('control-status', control), good = status(control);
    const invalid = [null, true, [], without(good, 'progress'), { ...good, target }, { ...good, userSid: 'private' },
      { ...good, bundleSha256: otherDigest }, { ...good, operationId: otherOperationId },
      { ...good, control: controls.find(value => value !== control) },
      ...['ready', 'requested', 'pause-recorded', 'intent-write-started', 'reserved\n'].map(state => ({ ...good, state })),
      ...(control === 'revoke' ? ['intent-saved', 'launch-requested', 'launch-unconfirmed', 'recovered-paused'] :
        ['revocation-recorded', 'stopped']).map(state => ({ ...good, state })),
      ...invalidProgress.map(progress => ({ ...good, progress })),
    ];
    for (const result of invalid) {
      assert.equal(host.isAdministratorControlStatus(result, identity(control)), false);
      assert.deepEqual(await framed(req, { readControlStatus: () => result }), { ...replyHeader(req), ...unknownReply(req) });
    }
  }
});

test('missing or failing control callbacks never call legacy/session/ordinary fallbacks', async () => {
  for (const action of actions) for (const control of controls) {
    const req = request(action, control), method = action === 'control-support' ? 'readControlSupport' : methods[action];
    for (const callbacks of [{}, { [method]: () => { throw new Error('legacy unsupported or lost reply'); } }]) {
      assert.deepEqual(await framed(req, callbacks), { ...replyHeader(req), ...unknownReply(req) });
    }
  }
});

test('adapters use only fixed sealed paths, action names, parameters and sanitized environment', async () => {
  for (const action of actions) for (const control of controls) {
    const calls = [], req = request(action, control);
    const result = action === 'control-support' ? support(control) : action === 'control-status' ? status(control) : submission(control);
    const adapters = host.createAdministratorBrowserActions(root, binding, async (...args) => {
      calls.push(args); return { stdout: JSON.stringify(result) };
    });
    assert.deepEqual(await framed(req, adapters), { ...replyHeader(req), ...result });
    const extra = ['-ControlKind', control];
    if (action !== 'control-support') extra.push('-ControlOperationId', operationId);
    if (action === 'control' && control !== 'revoke') extra.push('-BrowserControlTarget', target);
    const options = { cwd: binding.systemDirectory, windowsHide: true, maxBuffer: 2048,
      env: { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', PATH: binding.systemDirectory } };
    if (action === 'control-support') options.timeout = 20000;
    if (action === 'control-status') options.timeout = 3200;
    assert.deepEqual(calls, [[binding.systemDirectory + '\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', root + '.browser\\stager.ps1',
        '-Action', stagerActions[action], '-Archive', root + '.browser\\bundle.zip', '-ExpectedSha256', digest, ...extra], options]]);
  }
});

test('direct adapters reject extra keys, targets and digest binding mismatches before execute', async () => {
  const calls = [];
  const adapters = host.createAdministratorBrowserActions(root, binding, async (...args) => { calls.push(args); throw new Error('unexpected execute'); });
  for (const control of [null, {}, 'Connect', 'revoke\n', '-Command anything']) await assert.rejects(adapters.readControlSupport(control));
  for (const action of Object.keys(methods)) for (const control of controls) {
    const good = payload(action, control);
    const invalid = [null, [], { ...good, bundleSha256: otherDigest }, { ...good, path: root },
      ...Object.keys(good).map(key => without(good, key)), { ...good, operationId: randomUUID() }, { ...good, control: 'bad' }];
    if (action === 'control' && control !== 'revoke') invalid.push({ ...good, target: null });
    else invalid.push({ ...good, target }, { ...good, target: null });
    for (const value of invalid) await assert.rejects(adapters[methods[action]](value));
    const mismatched = { ...request(action, control), bundleSha256: otherDigest };
    assert.deepEqual(await framed(mismatched, adapters), { ...replyHeader(mismatched), ...unknownReply(mismatched) });
  }
  assert.deepEqual(calls, []);
});

test('adapter reply identities, closed shapes, malformed JSON and legacy unsupported fail closed once', async () => {
  for (const action of actions) {
    const req = request(action), expected = { ...replyHeader(req), ...unknownReply(req) };
    const result = action === 'control-support' ? support() : action === 'control-status' ? status() : submission();
    for (const stdout of ['not JSON', JSON.stringify(result) + '{}', JSON.stringify({ ...result, path: 'private' }),
      JSON.stringify({ ...result, bundleSha256: otherDigest }), JSON.stringify({ state: 'unobserved', generation: null }), null]) {
      const calls = [];
      const adapters = host.createAdministratorBrowserActions(root, binding, async (...args) => {
        calls.push(args);
        if (stdout === null) throw new Error('legacy stager rejects unknown action');
        return { stdout };
      });
      assert.deepEqual(await framed(req, adapters), expected);
      assert.equal(calls.length, 1);
      assert.equal(calls[0][1][6], stagerActions[action]);
    }
  }
});

test('30-second submission deadline does not pass kill timeout, retry, fallback or cancel pending execute', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const action of ['control', 'control-fence', 'control-reconcile']) {
    const pending = Promise.withResolvers(), calls = [];
    let kills = 0, settled = false;
    const adapters = host.createAdministratorBrowserActions(root, binding, (...args) => {
      calls.push(args);
      pending.promise.child = { kill() { kills++; } };
      return pending.promise;
    });
    const operation = adapters[methods[action]](payload(action)).then(value => { settled = true; return value; });
    assert.equal(calls.length, 1);
    assert.equal(Object.hasOwn(calls[0][2], 'timeout'), false);
    assert.equal(Object.hasOwn(calls[0][2], 'signal'), false);
    t.mock.timers.tick(29999);
    await Promise.resolve();
    assert.equal(settled, false);
    t.mock.timers.tick(1);
    assert.deepEqual(await operation, submission('connect', 'unconfirmed'));
    assert.equal(kills, 0);
    pending.resolve({ stdout: JSON.stringify(submission()) });
    await Promise.resolve();
    t.mock.timers.tick(300000);
    assert.equal(calls.length, 1);
    assert.equal(kills, 0);
  }
});

test('late execute rejection after response timeout is consumed, not retried or unhandled', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = Promise.withResolvers(), calls = [];
  const adapters = host.createAdministratorBrowserActions(root, binding, (...args) => { calls.push(args); return pending.promise; });
  const operation = adapters.requestControl(payload('control'));
  t.mock.timers.tick(30000);
  assert.deepEqual(await operation, submission('connect', 'unconfirmed'));
  pending.reject(new Error('late medium helper exit'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
});

test('framed timeout replies once, ignores late success, and permits only explicit same-ID readback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const req = request('control'), pending = Promise.withResolvers(), started = Promise.withResolvers();
  const input = new PassThrough(), output = new PassThrough(), chunks = [], calls = [];
  output.on('data', chunk => chunks.push(chunk));
  const adapters = host.createAdministratorBrowserActions(root, binding, (...args) => {
    calls.push(args);
    if (args[1][6] === 'RequestBrowserHostedOwnerControl') { started.resolve(); return pending.promise; }
    assert.equal(args[1][6], 'ObserveHostedOwnerControl');
    return Promise.resolve({ stdout: JSON.stringify(status()) });
  });
  try {
    await writeFrame(input, req);
    const serving = host.serveAdministratorBrowser({ input, output, args: [origin], origin, ...adapters });
    await started.promise;
    t.mock.timers.tick(30000);
    await serving;
    const bytes = Buffer.concat(chunks), size = bytes.readUInt32LE();
    assert.equal(bytes.length, size + 4);
    assert.deepEqual(JSON.parse(bytes.subarray(4).toString('utf8')), { ...replyHeader(req), ...unknownReply(req) });
    pending.resolve({ stdout: JSON.stringify(submission()) });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(Buffer.concat(chunks), bytes);
    assert.equal(calls.length, 1);
    const read = { ...req, action: 'control-status', id: randomUUID() }; delete read.target;
    assert.deepEqual(await framed(read, adapters), { ...replyHeader(read), ...status() });
    assert.equal(calls.length, 2);
  } finally { pending.resolve({ stdout: '{}' }); input.destroy(); output.destroy(); }
});
