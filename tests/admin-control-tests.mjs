import assert from 'node:assert/strict';
import test from 'node:test';
import * as adminControl from '../admin-control.js';
import { ADMIN_CONTROL, ADMIN_CONTROL_SUPPORT, ADMIN_CONTROL_STATUS, ADMIN_CONTROL_FENCE,
  ADMIN_CONTROL_RECONCILE, ADMIN_CONTROL_JOURNAL, administratorControlJournal,
  administratorControlRecord, administratorControlSupport, administratorControlStatus,
  administratorControlProgress, bindAdministratorControls } from '../admin-control.js';

const digest = 'a'.repeat(64), operationId = 'b'.repeat(32), target = 'c'.repeat(32) + ':idle';
const extensionId = 'd'.repeat(32), origin = `chrome-extension://${extensionId}/`;
const sender = { id: extensionId, frameId: 0, url: origin + 'devices.html?mode=browser-managed' };
const clone = value => structuredClone(value);
const record = (extra = {}) => ({ bundleSha256: digest, operationId, control: 'connect', target,
  outcome: 'unconfirmed', state: 'unconfirmed', progress: null, createdAt: 1, ...extra });
const support = (control = 'connect', extra = {}) => ({ control, state: 'supported', bundleSha256: digest,
  target: control === 'revoke' ? null : target, ownerState: control === 'resume-saved' ? 'running' : 'paused', eligible: true, ...extra });
const identity = r => ({ bundleSha256: r.bundleSha256, operationId: r.operationId, control: r.control });
const status = (r, state = 'reserved', progress = null) => ({ ...identity(r), state, progress });
const submission = (r, outcome = 'requested') => ({ ...identity(r), outcome });
function event() {
  const listeners = [];
  return { addListener: fn => listeners.push(fn), emit: value => listeners.map(fn => fn(value)) };
}
function fixture(t, { local = {}, native, failure = false, prepareObserver = async () => true } = {}) {
  let granted = true;
  const calls = [], writes = [], removed = event(), added = event(), startup = event(), alarm = event();
  const api = {
    runtime: { id: extensionId, getURL: p => origin + p, getPlatformInfo: async () => ({ os: 'win' }),
      onStartup: startup, async sendNativeMessage(host, request) {
        calls.push({ host, ...clone(request) });
        const body = native ? await native(request) : request.action === 'control-support' ? support(request.control) :
          request.action === 'control-status' ? status(request) : submission(request);
        return body === null ? null : { version: 1, action: request.action, id: request.id, ...body };
      } },
    permissions: { contains: async () => granted, onRemoved: removed, onAdded: added },
    storage: { local: {
      get: async key => Object.fromEntries((Array.isArray(key) ? key : [key]).map(k => [k, clone(local[k])])),
      set: async value => { if (failure) throw new Error('storage_failed'); writes.push(clone(value)); Object.assign(local, clone(value)); },
    } },
    alarms: { onAlarm: alarm, clear: async () => true, create: async () => undefined },
  };
  // Time is outside persisted fixture operation ranges; automatic observation is tested separately.
  const controller = bindAdministratorControls(api, { now: () => 700000, prepareObserver });
  t.after(() => controller?.dispose());
  return { api, local, calls, writes, controller,
    send: (message, ...from) => controller.handleMessage(message, from.length ? from[0] : sender),
    revoke: () => { granted = false; removed.emit({ permissions: ['nativeMessaging'] }); },
    grant: () => { granted = true; added.emit({ permissions: ['nativeMessaging'] }); }, startup, alarm };
}
const connect = { type: ADMIN_CONTROL, bundleSha256: digest, control: 'connect', target };
const query = (r, type = ADMIN_CONTROL_STATUS) => ({ type, ...identity(r) });
const setupId = 'e'.repeat(32), setupKey = 'windowsAdministratorSetupAdmissionV1:' + setupId;
const setup = { setupId, bundleSha256: digest, target };
const association = (r = record()) => ({ version: 1, ...setup, operationId: r.operationId });
const setupConnect = (f, value = setup, admit = f.controller.captureStartupPermit()) =>
  f.controller.connectFromSetup(value, admit);
const turn = () => new Promise(resolve => setImmediate(resolve));

for (const control of ['connect', 'resume-saved']) {
  test(`manual ${control} waits for a correlated browser observer before reserving or dispatching`, async t => {
    const gate = Promise.withResolvers();
    let admitted;
    const f = fixture(t, { prepareObserver: admit => { admitted = admit; return gate.promise; } });
    const pending = f.send({ ...connect, control });
    await turn();
    assert.equal(typeof admitted, 'function');
    assert.equal(admitted(), true);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.calls.map(r => r.action), ['control-support']);
    gate.resolve(true);
    assert.ok(await pending);
    assert.equal(f.calls.filter(r => r.action === 'control').length, 1);
  });
}

test('manual startup fails closed on missing, failed or non-boolean observer preparation', async t => {
  for (const prepareObserver of [null, async () => false, async () => undefined, async () => 'attached',
    async () => { throw Error('observer unavailable'); }]) {
    const f = fixture(t, { prepareObserver });
    assert.equal(await f.send(connect), null);
    assert.deepEqual(f.writes, []);
    assert.equal(f.calls.some(r => r.action === 'control'), false);
  }
});

for (const stop of ['pause', 'revoke', 'permission', 'dispose']) {
  test(`${stop} cancels manual startup while observer preparation is pending`, async t => {
    const gate = Promise.withResolvers();
    let admitted;
    const f = fixture(t, { prepareObserver: admit => { admitted = admit; return gate.promise; } });
    const pending = f.send(connect);
    await turn();
    assert.equal(admitted(), true);
    if (stop === 'pause') f.controller.cancelPendingStartup();
    if (stop === 'permission') f.revoke();
    if (stop === 'dispose') f.controller.dispose();
    if (stop === 'revoke') {
      const revoked = await f.send({ type: ADMIN_CONTROL, control: 'revoke', bundleSha256: digest });
      assert.equal(revoked.control, 'revoke');
    }
    assert.equal(admitted(), false);
    gate.resolve(true);
    assert.equal(await pending, null);
    assert.equal(f.calls.some(r => r.action === 'control' && r.control !== 'revoke'), false);
    assert.equal(f.writes.some(w => w[ADMIN_CONTROL_JOURNAL]?.operations.some(r => r.control !== 'revoke')), false);
  });
}

test('readback, Revoke and an ineligible startup never prepare a browser observer', async t => {
  let preparations = 0;
  const f = fixture(t, { prepareObserver: async () => { preparations++; throw Error('must not prepare'); },
    native: r => r.action === 'control-support' ? support(r.control, { eligible: false, target: null }) :
      r.action === 'control-status' ? status(r) : submission(r) });
  assert.equal(await f.send(connect), null);
  const revoked = await f.send({ type: ADMIN_CONTROL, control: 'revoke', bundleSha256: digest });
  assert.equal(revoked.control, 'revoke');
  await f.send(query(revoked));
  assert.equal(preparations, 0);
});

test('setup admission prefix is exported, but setup methods are not message APIs', async t => {
  assert.equal(adminControl.ADMIN_CONTROL_SETUP, 'windowsAdministratorSetupAdmissionV1:');
  const f = fixture(t);
  assert.equal(typeof f.controller.captureStartupPermit, 'function');
  assert.equal(typeof f.controller.connectFromSetup, 'function');
  const from = { ...sender, url: origin + 'setup.html' };
  for (const message of [connect, { type: 'connectFromSetup', ...setup },
    { type: 'captureStartupPermit' }]) assert.equal(await f.send(message, from), null);
  assert.equal(await f.send({ type: 'connectFromSetup', ...setup }), null);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.calls, []);
});

test('startup permits capture startup and transport epochs and disposal', async t => {
  const f = fixture(t);
  const paused = f.controller.captureStartupPermit();
  assert.equal(paused(), true);
  f.controller.cancelPendingStartup();
  assert.equal(paused(), false);
  const removed = f.controller.captureStartupPermit();
  f.revoke(); f.grant();
  assert.equal(removed(), false);
  const revoked = f.controller.captureStartupPermit();
  assert.equal(await f.send({ type: ADMIN_CONTROL, control: 'revoke', bundleSha256: 'bad' }), null);
  assert.equal(revoked(), true);
  await f.send({ type: ADMIN_CONTROL, control: 'revoke', bundleSha256: digest });
  assert.equal(revoked(), false);
  const disposed = f.controller.captureStartupPermit();
  f.controller.dispose();
  assert.equal(disposed(), false);
  assert.equal(f.controller.captureStartupPermit()(), false);
});

test('parallel setup duplicates atomically reserve one association and journal before dispatch', async t => {
  const local = {}, gate = Promise.withResolvers();
  const f = fixture(t, { local, native: r => {
    if (r.action === 'control-support') return support();
    assert.deepEqual(local[setupKey], association(r));
    assert.equal(local[ADMIN_CONTROL_JOURNAL].operations[0].operationId, r.operationId);
    return gate.promise.then(() => submission(r));
  } });
  const first = setupConnect(f), second = setupConnect(f);
  await turn();
  assert.equal(f.calls.filter(r => r.action === 'control').length, 1);
  const reserved = await second;
  assert.ok(administratorControlRecord(reserved));
  assert.deepEqual(local[setupKey], association(reserved));
  assert.ok(f.writes.some(w => Object.hasOwn(w, setupKey) && Object.hasOwn(w, ADMIN_CONTROL_JOURNAL)));
  assert.ok(f.writes.every(w => !Object.hasOwn(w, setupKey) || Object.hasOwn(w, ADMIN_CONTROL_JOURNAL)));
  gate.resolve();
  assert.equal((await first).operationId, reserved.operationId);
  assert.equal((await setupConnect(f)).operationId, reserved.operationId);
  assert.equal(f.calls.filter(r => r.action === 'control').length, 1);
});

test('a duplicate with late unavailable support still returns the original admitted record', async t => {
  const gate = Promise.withResolvers();
  let checks = 0;
  const f = fixture(t, { native: r => r.action === 'control-support' ?
    ++checks === 2 ? gate.promise : support() : submission(r) });
  const first = setupConnect(f), second = setupConnect(f);
  const saved = await first;
  assert.equal(checks, 2);
  gate.resolve(null);
  assert.deepEqual(await second, saved);
  assert.equal(f.calls.filter(r => r.action === 'control').length, 1);
  assert.equal(f.local[ADMIN_CONTROL_JOURNAL].operations.length, 1);
});

for (const state of ['unconfirmed', 'fenced', 'launch-requested']) {
  test(`setup duplicate after worker restart returns original ${state} record before support`, async t => {
    const previous = record({ state });
    const local = { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [previous] },
      [setupKey]: association(previous) };
    const f = fixture(t, { local, native: () => null });
    await turn();
    assert.deepEqual(await setupConnect(f), previous);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.writes, []);
    f.controller.dispose();
    const restarted = fixture(t, { local, native: () => null });
    await turn();
    assert.deepEqual(await setupConnect(restarted), previous);
    assert.deepEqual(restarted.calls, []);
    assert.deepEqual(restarted.writes, []);
  });
}

test('archived setup duplicate returns only the original matching terminal record', async t => {
  const previous = record({ state: 'fenced' });
  const key = 'windowsAdministratorControlArchiveV1:' + digest + ':' + operationId;
  const f = fixture(t, { local: { [setupKey]: association(), [key]: previous } });
  assert.deepEqual(await setupConnect(f), previous);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.writes, []);
});

test('setup association and referenced records reject corruption, mismatch and missing identities', async t => {
  const previous = record({ state: 'fenced' });
  const archive = 'windowsAdministratorControlArchiveV1:' + digest + ':' + operationId;
  for (const value of [null, {}, [], { ...association(), version: 2 }, { ...association(), extra: true },
    { ...association(), control: 'connect' }, { ...association(), setupId: 'f'.repeat(32) },
    { ...association(), bundleSha256: 'f'.repeat(64) }, { ...association(), operationId: operationId + '\n' },
    { ...association(), target: 'f'.repeat(32) + ':idle' }]) {
    const f = fixture(t, { local: { [setupKey]: value, [archive]: previous } });
    assert.equal(await setupConnect(f), null);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.calls, []);
  }
  for (const referenced of [undefined, record(), record({ state: 'fenced', target: 'f'.repeat(32) + ':idle' }),
    record({ state: 'fenced', control: 'revoke', target: null }), { ...previous, extra: true }]) {
    const f = fixture(t, { local: { [setupKey]: association(), [archive]: referenced } });
    assert.equal(await setupConnect(f), null);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.writes, []);
  }
  for (const mismatch of [record({ target: 'f'.repeat(32) + ':idle' }), record({ control: 'revoke', target: null })]) {
    const f = fixture(t, { local: { [setupKey]: association(), [archive]: previous,
      [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [mismatch] } } });
    assert.equal(await setupConnect(f), null);
    assert.deepEqual(f.calls, []);
  }
});

test('setup input is strict, requires admission and snapshots the original target', async t => {
  const f = fixture(t);
  for (const value of [null, {}, [], { ...setup, extra: 1 }, { ...setup, setupId: setupId + '\n' },
    { ...setup, bundleSha256: digest.toUpperCase() }, { ...setup, target: target + '\n' }]) {
    assert.equal(await setupConnect(f, value), null);
  }
  for (const admit of [undefined, null, true, () => false, () => { throw Error('deny'); }]) {
    assert.equal(await f.controller.connectFromSetup(setup, admit), null);
  }
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.writes, []);
  const mutable = { ...setup }, pending = setupConnect(f, mutable);
  mutable.target = 'f'.repeat(32) + ':idle';
  assert.equal((await pending).target, target);
  assert.deepEqual(f.local[setupKey], association(f.local[ADMIN_CONTROL_JOURNAL].operations[0]));
});

test('target or bundle mismatch on a previously admitted setup never creates another operation', async t => {
  const f = fixture(t);
  const saved = await setupConnect(f);
  const before = clone(f.calls);
  for (const value of [{ ...setup, target: 'f'.repeat(32) + ':idle' },
    { ...setup, bundleSha256: 'f'.repeat(64) }]) assert.equal(await setupConnect(f, value), null);
  assert.deepEqual(f.calls, before);
  assert.deepEqual(f.local[setupKey], association(saved));
  assert.equal(f.local[ADMIN_CONTROL_JOURNAL].operations.length, 1);
});

test('setup set-error after mutation retains original ID and blocks retry after restart', async t => {
  const f = fixture(t), set = f.api.storage.local.set;
  f.api.storage.local.set = async value => { await set(value); throw Error('lost_commit_reply'); };
  const saved = await setupConnect(f);
  assert.ok(administratorControlRecord(saved));
  assert.deepEqual(f.local[setupKey], association(saved));
  assert.equal(f.calls.some(r => r.action === 'control'), false);
  assert.deepEqual(await setupConnect(f), saved);
  f.controller.dispose();
  const restarted = fixture(t, { local: f.local });
  assert.deepEqual(await setupConnect(restarted), saved);
  assert.equal(restarted.calls.some(r => r.action === 'control'), false);
});

test('setup set-error before mutation returns the attempted ID as uncertainty, not durable submission', async t => {
  const f = fixture(t);
  let attempted;
  f.api.storage.local.set = async value => {
    attempted = clone(value);
    throw Error('commit_never_started');
  };
  const saved = await setupConnect(f);
  assert.ok(administratorControlRecord(saved));
  assert.deepEqual(saved, attempted[ADMIN_CONTROL_JOURNAL].operations[0]);
  assert.deepEqual(attempted[setupKey], association(saved));
  assert.equal(saved.outcome, 'unconfirmed');
  assert.equal(saved.state, 'unconfirmed');
  assert.equal(f.calls.some(r => r.action === 'control'), false);
  assert.equal(Object.hasOwn(f.local, setupKey), false);
  assert.equal(Object.hasOwn(f.local, ADMIN_CONTROL_JOURNAL), false);
  assert.deepEqual(f.writes, []);
});

test('admission withdrawn during setup native work returns its pending receipt without accepting late success', async t => {
  const gate = Promise.withResolvers();
  let allowed = true;
  const f = fixture(t, { native: r => r.action === 'control-support' ? support() : gate.promise.then(() => submission(r)) });
  const pending = setupConnect(f, setup, () => allowed);
  await turn();
  assert.equal(f.calls.filter(r => r.action === 'control').length, 1);
  const reserved = clone(f.local[ADMIN_CONTROL_JOURNAL].operations[0]);
  allowed = false;
  gate.resolve();
  assert.deepEqual(await pending, reserved);
  assert.equal(reserved.outcome, 'unconfirmed');
  assert.deepEqual(await setupConnect(f), reserved);
  assert.deepEqual(f.local[setupKey], association(reserved));
  assert.equal(f.calls.filter(r => r.action === 'control').length, 1);
});

for (const corrupt of ['association', 'journal', 'progress', 'missing', 'error']) {
  test(`setup ${corrupt} reservation readback prevents dispatch without replacing the saved ID`, async t => {
    const f = fixture(t), get = f.api.storage.local.get;
    let committed = false;
    const set = f.api.storage.local.set;
    f.api.storage.local.set = async value => { await set(value); committed = true; };
    f.api.storage.local.get = async key => {
      const value = await get(key);
      if (committed) {
        if (corrupt === 'error') throw Error('readback_failed');
        if (corrupt === 'association') value[setupKey] = { ...value[setupKey], operationId };
        if (corrupt === 'journal') value[ADMIN_CONTROL_JOURNAL].operations[0].target = 'f'.repeat(32) + ':idle';
        if (corrupt === 'progress') value[ADMIN_CONTROL_JOURNAL].operations[0].progress =
          { phase: 'waiting-owner', verifiedFiles: null, totalFiles: null };
        if (corrupt === 'missing') delete value[setupKey];
      }
      return value;
    };
    const saved = await setupConnect(f);
    assert.ok(administratorControlRecord(saved));
    assert.equal(f.calls.some(r => r.action === 'control'), false);
    assert.equal(f.local[setupKey].operationId, saved.operationId);
    f.api.storage.local.get = get;
    assert.deepEqual(await setupConnect(f), saved);
    assert.equal(f.calls.filter(r => r.action === 'control').length, 0);
  });
}

test('setup final permission loss preserves the reservation and cannot automatically retry', async t => {
  const f = fixture(t), set = f.api.storage.local.set;
  let committed = false, checks = 0;
  f.api.storage.local.set = async value => { await set(value); committed = true; };
  f.api.permissions.contains = async () => !(committed && ++checks === 2);
  const saved = await setupConnect(f);
  assert.ok(administratorControlRecord(saved));
  assert.equal(checks, 2);
  assert.equal(f.calls.some(r => r.action === 'control'), false);
  f.api.permissions.contains = async () => true;
  assert.deepEqual(await setupConnect(f), saved);
  assert.equal(f.calls.some(r => r.action === 'control'), false);
});

for (const boundary of ['platform', 'permission', 'result-read', 'result-write', 'final-read', 'predicate']) {
  test(`setup exception at post-reservation ${boundary} retains its original uncertain ID`, async t => {
    const f = fixture(t), get = f.api.storage.local.get, set = f.api.storage.local.set;
    let committed = false, resultReads = 0;
    await turn();
    f.api.storage.local.set = async value => {
      if (committed && boundary === 'result-write') throw Error('result_write_failed');
      await set(value);
      if (Object.hasOwn(value, setupKey)) committed = true;
    };
    f.api.runtime.getPlatformInfo = async () => {
      if (committed && boundary === 'platform') throw Error('platform_failed');
      return { os: 'win' };
    };
    f.api.permissions.contains = async () => {
      if (committed && boundary === 'permission') throw Error('permission_failed');
      return true;
    };
    f.api.storage.local.get = async key => {
      if (committed && key === ADMIN_CONTROL_JOURNAL) {
        resultReads++;
        if (boundary === 'result-read' || boundary === 'final-read' && resultReads === 2) throw Error('result_read_failed');
      }
      return get(key);
    };
    let predicateChecks = 0;
    const saved = await setupConnect(f, setup, () => {
      if (committed && boundary === 'predicate' && ++predicateChecks > 2) throw Error('predicate_failed');
      return true;
    });
    assert.ok(administratorControlRecord(saved));
    assert.equal(f.local[setupKey].operationId, saved.operationId);
    f.api.storage.local.get = get;
    assert.equal((await setupConnect(f)).operationId, saved.operationId);
    assert.ok(f.calls.filter(r => r.action === 'control').length <= 1);
  });
}

test('no association is written for unsupported, unauthorized, corrupt or blocked setup admission', async t => {
  const full = { version: 1, operations: Array.from({ length: 256 }, (_, i) => record({
    operationId: i.toString(16).padStart(32, '0'), state: 'reserved' })) };
  for (const reason of ['support', 'platform', 'permission', 'journal', 'pending', 'full']) {
    const local = reason === 'journal' ? { [ADMIN_CONTROL_JOURNAL]: { invalid: true } } :
      reason === 'pending' ? { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [record()] } } :
      reason === 'full' ? { [ADMIN_CONTROL_JOURNAL]: full } : {};
    const f = fixture(t, { local, native: () => reason === 'support' ? null : support() });
    if (reason === 'platform') f.api.runtime.getPlatformInfo = async () => ({ os: 'linux' });
    if (reason === 'permission') f.api.permissions.contains = async () => false;
    assert.equal(await setupConnect(f), null);
    assert.equal(Object.hasOwn(local, setupKey), false);
    assert.equal(f.calls.some(r => r.action === 'control'), false);
    assert.deepEqual(f.writes, []);
  }
});

test('an unresolved setup blocks admission of a different setup without reserving a replacement ID', async t => {
  const f = fixture(t, { native: r => r.action === 'control-support' ? support() : null });
  const saved = await setupConnect(f);
  assert.equal(await setupConnect(f, { ...setup, setupId: 'f'.repeat(32) }), null);
  assert.equal(Object.hasOwn(f.local, 'windowsAdministratorSetupAdmissionV1:' + 'f'.repeat(32)), false);
  assert.deepEqual(f.local[setupKey], association(saved));
  assert.equal(f.calls.filter(r => r.action === 'control').length, 1);
});

test('actual journal archival retains the setup association and duplicate lookup without replay', async t => {
  const f = fixture(t, { native: r => r.action === 'control-support' ? support() :
    r.action === 'control-status' ? status(r, 'fenced') : submission(r) });
  const saved = await setupConnect(f);
  await f.send(query(saved));
  const original = clone(f.local[ADMIN_CONTROL_JOURNAL].operations[0]);
  f.local[ADMIN_CONTROL_JOURNAL].operations.push(...Array.from({ length: 255 }, (_, i) =>
    record({ operationId: i.toString(16).padStart(32, '0'), state: 'fenced' })));
  const second = await setupConnect(f, { ...setup, setupId: 'f'.repeat(32) });
  assert.ok(second && second.operationId !== saved.operationId);
  assert.ok(!f.local[ADMIN_CONTROL_JOURNAL].operations.some(r => r.operationId === saved.operationId));
  const calls = clone(f.calls), writes = clone(f.writes);
  assert.deepEqual(await setupConnect(f), original);
  assert.deepEqual(f.local[setupKey], association(saved));
  assert.deepEqual(f.calls, calls);
  assert.deepEqual(f.writes, writes);
});

for (const cancel of ['Pause', 'Revoke', 'permission-cycle', 'admit', 'dispose']) {
  for (const boundary of ['platform', 'permission', 'support', 'admission-read', 'journal-read', 'commit',
    'readback', 'final-platform', 'final-permission']) {
    test(`setup ${cancel} at ${boundary} await cannot dispatch or replace a reservation`, { timeout: 3000 }, async t => {
      const gate = Promise.withResolvers(), entered = Promise.withResolvers();
      const f = fixture(t), api = f.api;
      await turn();
      let allowed = true, paused = false, reads = 0, committed = false, platforms = 0, permissions = 0;
      const hold = async value => { paused = true; entered.resolve(); await gate.promise; return value; };
      const get = api.storage.local.get, set = api.storage.local.set;
      api.storage.local.get = async key => {
        const value = await get(key);
        if (Array.isArray(key) && !committed) reads++;
        if (!paused && (boundary === 'admission-read' && reads === 1 ||
            boundary === 'journal-read' && reads === 2 || boundary === 'readback' && committed)) return hold(value);
        return value;
      };
      api.storage.local.set = async value => {
        await set(value);
        if (Object.hasOwn(value, setupKey)) {
          committed = true;
          if (boundary === 'commit') return hold(undefined);
        }
      };
      api.runtime.getPlatformInfo = async () => {
        if (!paused && (boundary === 'platform' || boundary === 'final-platform' && committed && ++platforms === 2)) {
          return hold({ os: 'win' });
        }
        return { os: 'win' };
      };
      api.permissions.contains = async () => {
        if (!paused && (boundary === 'permission' || boundary === 'final-permission' && committed && ++permissions === 2)) {
          return hold(true);
        }
        return true;
      };
      const send = api.runtime.sendNativeMessage;
      api.runtime.sendNativeMessage = async (host, request) => {
        const value = await send(host, request);
        return !paused && boundary === 'support' && request.action === 'control-support' ? hold(value) : value;
      };
      const permit = f.controller.captureStartupPermit();
      const pending = setupConnect(f, setup, () => permit() && allowed);
      await entered.promise;
      if (cancel === 'Pause') f.controller.cancelPendingStartup();
      const revoking = cancel === 'Revoke' ? f.send({ type: ADMIN_CONTROL, control: 'revoke', bundleSha256: digest }) : null;
      if (cancel === 'permission-cycle') { f.revoke(); f.grant(); }
      if (cancel === 'admit') allowed = false;
      if (cancel === 'dispose') f.controller.dispose();
      gate.resolve();
      const saved = await pending;
      await revoking;
      assert.equal(f.calls.filter(r => r.action === 'control' && r.control === 'connect').length, 0);
      if (committed) {
        assert.ok(administratorControlRecord(saved));
        assert.equal(f.local[setupKey].operationId, saved.operationId);
        if (cancel !== 'dispose') assert.equal((await setupConnect(f)).operationId, saved.operationId);
      } else {
        assert.equal(saved, null);
        assert.equal(Object.hasOwn(f.local, setupKey), false);
      }
    });
  }
}

test('late setup control callback after cancellation and restart cannot replay or change the association', async t => {
  const gate = Promise.withResolvers();
  const f = fixture(t, { native: r => r.action === 'control-support' ? support() : gate.promise.then(() => submission(r)) });
  const pending = setupConnect(f);
  await turn();
  assert.equal(f.calls.filter(r => r.action === 'control').length, 1);
  const saved = clone(f.local[ADMIN_CONTROL_JOURNAL].operations[0]);
  f.controller.cancelPendingStartup(); f.controller.dispose();
  const restarted = fixture(t, { local: f.local });
  assert.deepEqual(await setupConnect(restarted), saved);
  gate.resolve();
  assert.deepEqual(await pending, saved);
  assert.deepEqual(f.local[setupKey], association(saved));
  assert.equal(restarted.calls.some(r => r.action === 'control'), false);
});

test('a cross-page Pause cancels startup waiting for native support before admission', async t => {
  const pending = Promise.withResolvers();
  const f = fixture(t,{native:request=>request.action==='control-support'?pending.promise:submission(request)});
  const connecting=f.send(connect);
  for(let i=0;i<30&&f.calls.length===0;i++) await Promise.resolve();
  assert.equal(f.calls.length,1);
  assert.equal(typeof f.controller.cancelPendingStartup,'function');
  f.controller.cancelPendingStartup();
  pending.resolve(support());
  assert.equal(await connecting,null);
  assert.equal(f.calls.some(call=>call.action==='control'),false);
  assert.deepEqual(f.writes,[]);
});

test('Pause after journal reservation leaves the exact operation quarantined without dispatch or replay', async t => {
  const f=fixture(t);
  const original=f.api.storage.local.set;
  f.api.storage.local.set=async value=>{
    await original(value);
    if(value[ADMIN_CONTROL_JOURNAL]?.operations.length) f.controller.cancelPendingStartup();
  };
  const saved=await f.send(connect);
  assert.ok(administratorControlRecord(saved));
  assert.equal(f.calls.some(call=>call.action==='control'),false);
  assert.equal(f.local[ADMIN_CONTROL_JOURNAL].operations[0].operationId,saved.operationId);
  assert.equal(await f.send(connect),null);
});

test('Revoke admission invalidates an older in-flight Connect even after revocation settles', async t => {
  const pending=Promise.withResolvers();
  const f=fixture(t,{native:request=>request.action==='control-support'?pending.promise:
    request.action==='control-status'?status(request,'revocation-recorded'):submission(request)});
  const connecting=f.send(connect);
  for(let i=0;i<30&&f.calls.length===0;i++) await Promise.resolve();
  const revoked=await f.send({type:ADMIN_CONTROL,control:'revoke',bundleSha256:digest});
  await f.send(query(revoked));
  pending.resolve(support());
  assert.equal(await connecting,null);
  assert.equal(f.calls.filter(call=>call.action==='control'&&call.control==='connect').length,0);
});

for (const control of ['connect','resume-saved']) {
  test(`${control}: Pause during the last native permission await prevents transport dispatch`, async t => {
    const f=fixture(t,{native:request=>request.action==='control-support'?support(control):submission(request)});
    const original=f.api.storage.local.set;
    let reserved=false,checks=0;
    f.api.storage.local.set=async value=>{await original(value);if(value[ADMIN_CONTROL_JOURNAL]?.operations.length) reserved=true;};
    f.api.permissions.contains=async()=>{
      if(reserved&&++checks===2) f.controller.cancelPendingStartup();
      return true;
    };
    const saved=await f.send({...connect,control});
    assert.ok(administratorControlRecord(saved));
    assert.equal(checks,2);
    assert.equal(f.calls.some(call=>call.action==='control'),false);
    assert.equal(f.local[ADMIN_CONTROL_JOURNAL].operations[0].operationId,saved.operationId);
  });
}

test('read-only support can finish after five seconds without mutation, retry or permission drift', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = Promise.withResolvers();
  const f = fixture(t, { native: () => pending.promise });
  let settled = false;
  const result = f.send({ type: ADMIN_CONTROL_SUPPORT, control: 'connect' }).then(value => { settled = true; return value; });
  for (let i = 0; i < 20 && f.calls.length === 0; i++) await Promise.resolve();
  assert.equal(f.calls.length, 1);
  t.mock.timers.tick(5001);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false);
  pending.resolve(support());
  assert.deepEqual(await result, support());
  assert.deepEqual(f.writes, []);
  assert.equal(f.calls.length, 1);
});

test('support budget ends once, ignores a late reply and never launches an operation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = Promise.withResolvers();
  const f = fixture(t, { native: () => pending.promise });
  const result = f.send({ type: ADMIN_CONTROL_SUPPORT, control: 'connect' });
  for (let i = 0; i < 20 && f.calls.length === 0; i++) await Promise.resolve();
  assert.equal(f.calls.length, 1);
  t.mock.timers.tick(25000);
  assert.equal(await result, null);
  pending.resolve(support());
  await Promise.resolve();
  assert.deepEqual(f.writes, []);
  assert.equal(f.calls.length, 1);
});

test('strict support parser separates unavailable capability, owner state, and revoke authority', () => {
  assert.ok(administratorControlSupport(support(), 'connect'));
  assert.ok(administratorControlSupport(support('revoke', { ownerState: 'unobserved' }), 'revoke'));
  assert.ok(administratorControlSupport({ control: 'connect', state: 'unconfirmed', bundleSha256: null,
    target: null, ownerState: 'unobserved', eligible: false }, 'connect'));
  for (const value of [support('connect', { bundleSha256: digest + '\n' }), support('connect', { target: target + '\n' }),
    support('connect', { ownerState: 'revoked' }), support('resume-saved', { ownerState: 'paused' }),
    support('revoke', { target }), { ...support(), script: 'no' }]) {
    assert.equal(administratorControlSupport(value, value.control), null);
  }
});

test('progress and receipt parsers reject counts, identity mismatch, and fabricated readiness', () => {
  assert.equal(administratorControlProgress(null), null);
  assert.ok(administratorControlProgress({ phase: 'verifying-full', verifiedFiles: 10, totalFiles: 100 }));
  for (const value of [undefined, { phase: 'settled', verifiedFiles: 1, totalFiles: 1 },
    { phase: 'verifying-full', verifiedFiles: 2, totalFiles: 1 }, { phase: 'verifying-full', verifiedFiles: NaN, totalFiles: 10 },
    { phase: 'verifying-full', verifiedFiles: null, totalFiles: 10 }, { phase: 'ready', verifiedFiles: null, totalFiles: null }]) {
    assert.equal(administratorControlProgress(value), undefined);
  }
  assert.ok(administratorControlStatus(status(record()), record()));
  assert.equal(administratorControlStatus(status(record()), record({ operationId: 'e'.repeat(32) })), null);
  assert.equal(administratorControlStatus(status(record(), 'ready'), record()), null);
  assert.equal(administratorControlStatus(status(record(), 'revocation-recorded'), record()), null);
  assert.equal(administratorControlStatus(status(record({ control: 'revoke', target: null }), 'launch-requested')), null);
});

test('journal rejects corruption, duplicate identities, wrong schemas and overflow without eviction', () => {
  assert.deepEqual(administratorControlJournal(undefined), { version: 1, operations: [] });
  const valid = { version: 1, operations: [record()] };
  assert.deepEqual(administratorControlJournal(valid), valid);
  for (const value of [null, {}, [], { ...valid, extra: 1 }, { version: 2, operations: [] },
    { version: 1, operations: [record(), record({ control: 'revoke', target: null })] },
    { version: 1, operations: [record({ createdAt: 0 })] },
    { version: 1, operations: Array.from({ length: 257 }, (_, i) => record({ operationId: i.toString(16).padStart(32, '0') })) }]) {
    assert.equal(administratorControlJournal(value), null);
  }
  assert.equal(administratorControlRecord({ ...record(), extra: true }), null);
});

test('own exact Devices tab or popup is the only new control sender', async t => {
  const f = fixture(t);
  for (const from of [undefined, {}, { ...sender, id: 'x' }, { ...sender, frameId: undefined, tab: { id: 1 } },
    { ...sender, frameId: null }, { ...sender, frameId: -1 },
    { ...sender, frameId: 1 }, { ...sender, tab: { incognito: true } },
    { ...sender, url: origin + 'devices.html' }, { ...sender, url: sender.url + '&x=1' },
    { ...sender, url: origin + 'background.js' },
    { ...sender, url: 'https://chatgpt.com/' }]) {
    assert.equal(await f.send({ type: ADMIN_CONTROL_SUPPORT, control: 'connect' }, from), null);
  }
  assert.equal(f.calls.length, 0);
  assert.ok(await f.send({ type: ADMIN_CONTROL_SUPPORT, control: 'connect' }, { ...sender, url: sender.url + '#control' }));
  assert.ok(await f.send({ type: ADMIN_CONTROL_SUPPORT, control: 'connect' }, { ...sender, frameId: undefined }));
});

test('Devices popup without tab-only metadata can submit once and read its exact receipt', async t => {
  const f = fixture(t), popup = { id: extensionId, url: sender.url };
  const admitted = await f.send(connect, popup);
  assert.ok(admitted);
  assert.equal(f.calls.filter(r => r.action === 'control').length, 1);
  assert.ok(await f.send(query(admitted), popup));
  assert.equal(await f.send(query(admitted), { ...popup, url: origin + 'popup.html' }), null);
  f.revoke();
  assert.equal(await f.send({ type: ADMIN_CONTROL_SUPPORT, control: 'connect' }, popup), null);
});

test('Connect persists one stable operation before dispatch and concurrent requests cannot create two writes', async t => {
  const local = {};
  const f = fixture(t, { local, native: async r => {
    if (r.action === 'control-support') return support(r.control);
    assert.equal(local[ADMIN_CONTROL_JOURNAL].operations.length, 1);
    assert.equal(local[ADMIN_CONTROL_JOURNAL].operations[0].operationId, r.operationId);
    return submission(r);
  } });
  const results = await Promise.all([f.send(connect), f.send(connect)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(f.calls.filter(r => r.action === 'control').length, 1);
  assert.equal(local[ADMIN_CONTROL_JOURNAL].operations.length, 1);
  assert.equal(local[ADMIN_CONTROL_JOURNAL].operations[0].outcome, 'requested');
});

test('cancelled or lost submission remains unresolved and cannot silently unlock another Connect', async t => {
  for (const outcome of ['cancelled', 'unconfirmed', null]) {
    const f = fixture(t, { native: async r => r.action === 'control-support' ? support(r.control) :
      outcome === null ? null : submission(r, outcome) });
    const first = await f.send(connect);
    assert.equal(first.state, 'unconfirmed');
    assert.equal(await f.send(connect), null);
    assert.equal(f.calls.filter(r => r.action === 'control').length, 1);
  }
});

test('storage failure or corrupt/full history prevents a mutation, with no fallback wake', async t => {
  const full = { version: 1, operations: Array.from({ length: 256 }, (_, i) => record({
    operationId: i.toString(16).padStart(32, '0'), state: 'reserved' })) };
  for (const options of [{ failure: true }, { local: { [ADMIN_CONTROL_JOURNAL]: { invalid: true } } },
    { local: { [ADMIN_CONTROL_JOURNAL]: full } }]) {
    const f = fixture(t, options);
    assert.equal(await f.send(connect), null);
    assert.equal(f.calls.some(r => r.action !== 'control-support'), false);
  }
});

test('legacy or stale capability never dispatches Connect and never reuses standard reconnect', async t => {
  for (const body of [null, { state: 'unconfirmed' }, support('connect', { eligible: false }),
    support('connect', { bundleSha256: 'e'.repeat(64) }), support('connect', { target: 'f'.repeat(32) + ':idle' })]) {
    const f = fixture(t, { native: async () => body });
    assert.equal(await f.send(connect), null);
    assert.ok(f.calls.every(r => r.action === 'control-support' && r.host === 'com.agentcontinue.administrator_owner'));
  }
});

test('Revoke is targetless and remains available while startup result is unresolved', async t => {
  const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [record()] } } });
  const revoke = { type: ADMIN_CONTROL, bundleSha256: digest, control: 'revoke' };
  assert.equal(await f.send({ ...revoke, target }), null);
  const result = await f.send(revoke);
  assert.equal(result.control, 'revoke');
  const wire = f.calls.find(r => r.action === 'control');
  assert.equal(Object.hasOwn(wire, 'target'), false);
  assert.equal(f.local[ADMIN_CONTROL_JOURNAL].operations.length, 2);
});

test('an unresolved Revoke blocks startup even if an inconsistent support response says eligible', async t => {
  const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1,
    operations: [record({ control: 'revoke', target: null })] } } });
  assert.equal(await f.send(connect), null);
  assert.equal(f.calls.some(r => r.action === 'control'), false);
});

test('repeated unknown Revoke reads same durable request instead of creating more deny prompts', async t => {
  const previous = record({ control: 'revoke', target: null });
  const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [previous] } } });
  const result = await f.send({ type: ADMIN_CONTROL, bundleSha256: digest, control: 'revoke' });
  assert.deepEqual(result, previous);
  assert.equal(f.calls.some(r => r.action === 'control'), false);
});

test('receipt readback consumes the same ID, unlocks browser startup slot, but does not claim Ready', async t => {
  const previous = record();
  const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [previous] } },
    native: async r => r.action === 'control-status' ? status(r, 'fenced') :
      r.action === 'control-support' ? support(r.control) : submission(r) });
  assert.deepEqual(await f.send(query(previous)), status(previous, 'fenced'));
  assert.equal(f.local[ADMIN_CONTROL_JOURNAL].operations[0].state, 'fenced');
  assert.ok(await f.send(connect));
  assert.equal(f.calls.filter(r => r.action === 'control').length, 1);
  assert.equal(f.local[ADMIN_CONTROL_JOURNAL].operations.length, 2);
});

test('revocation receipt may refine to independently verified stopped without becoming live readiness', async t => {
  const previous = record({ control: 'revoke', target: null, state: 'revocation-recorded' });
  const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [previous] } },
    native: async r => status(r, 'stopped') });
  await f.send(query(previous));
  assert.equal(f.local[ADMIN_CONTROL_JOURNAL].operations[0].state, 'stopped');
});

test('recorded Revoke reconciles only its same active ID without replay and requires stopped readback', async t => {
  const previous = record({ control: 'revoke', target: null, state: 'revocation-recorded' });
  let stopped = false;
  const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [previous] } },
    native: r => r.action === 'control-status' ? status(r, stopped ? 'stopped' : 'revocation-recorded') :
      r.action === 'control-support' ? support(r.control, { ownerState: 'revoked', eligible: false, target: null }) : submission(r) });
  for (const request of [query(previous, ADMIN_CONTROL_FENCE),
    { ...query(previous, ADMIN_CONTROL_RECONCILE), bundleSha256: 'e'.repeat(64) },
    { ...query(previous, ADMIN_CONTROL_RECONCILE), operationId: 'f'.repeat(32) },
    { ...query(previous, ADMIN_CONTROL_RECONCILE), control: 'connect' },
    { ...query(previous, ADMIN_CONTROL_RECONCILE), target }]) assert.equal(await f.send(request), null);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(await f.send(query(previous, ADMIN_CONTROL_RECONCILE)), submission(previous));
  assert.deepEqual(f.calls.map(({ host, version, action, id, ...fields }) => ({ action, ...fields })),
    [{ action: 'control-reconcile', ...identity(previous) }]);
  assert.deepEqual(f.local[ADMIN_CONTROL_JOURNAL].operations, [previous], 'submission is not stop evidence');
  assert.deepEqual(f.writes, []);
  assert.equal(await f.send(connect), null, 'revoked support cannot admit a new Connect');
  await f.send(query(previous));
  assert.equal(f.local[ADMIN_CONTROL_JOURNAL].operations[0].state, 'revocation-recorded');
  stopped = true;
  await f.send(query(previous));
  assert.equal(f.local[ADMIN_CONTROL_JOURNAL].operations[0].state, 'stopped');
  assert.equal(f.local[ADMIN_CONTROL_JOURNAL].operations[0].operationId, previous.operationId);
  assert.equal(await f.send(query(previous, ADMIN_CONTROL_RECONCILE)), null);
  assert.equal(await f.send(query(previous, ADMIN_CONTROL_FENCE)), null);
  assert.equal(f.calls.filter(r => r.action === 'control-reconcile').length, 1);
  assert.ok(f.calls.every(r => ['control-support', 'control-status', 'control-reconcile'].includes(r.action)));
});

test('recorded Revoke reconciliation stays single flight', async t => {
  const previous = record({ control: 'revoke', target: null, state: 'revocation-recorded' });
  const hold = Promise.withResolvers();
  const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [previous] } },
    native: () => hold.promise });
  const pending = f.send(query(previous, ADMIN_CONTROL_RECONCILE));
  await turn();
  assert.equal(f.calls.length, 1);
  assert.equal(await f.send(query(previous, ADMIN_CONTROL_RECONCILE)), null);
  assert.equal(await f.send(query(previous, ADMIN_CONTROL_FENCE)), null);
  hold.resolve(submission(previous));
  assert.deepEqual(await pending, submission(previous));
  assert.deepEqual(f.calls.map(r => r.action), ['control-reconcile']);
  assert.deepEqual(f.writes, []);
});

for (const precheck of ['platform', 'permission']) {
  test(`recorded Revoke dispatch rechecks stopped persisted during the final ${precheck} precheck`, async t => {
    const previous = record({ control: 'revoke', target: null, state: 'revocation-recorded' });
    const hold = Promise.withResolvers();
    const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [previous] } },
      native: r => r.action === 'control-status' ? status(r, 'stopped') : submission(r) });
    await turn();
    let checks = 0;
    const answer = precheck === 'platform' ? { os: 'win' } : true;
    const check = async () => ++checks === 2 ? hold.promise : answer;
    if (precheck === 'platform') f.api.runtime.getPlatformInfo = check;
    else f.api.permissions.contains = check;
    t.after(() => hold.resolve(answer));
    const pending = f.send(query(previous, ADMIN_CONTROL_RECONCILE));
    await turn();
    assert.equal(checks, 2, 'the final native precheck is held before transport');
    assert.deepEqual(f.calls, []);
    assert.deepEqual(await f.send(query(previous)), status(previous, 'stopped'));
    assert.equal(f.local[ADMIN_CONTROL_JOURNAL].operations[0].state, 'stopped');
    assert.equal(f.writes.at(-1)[ADMIN_CONTROL_JOURNAL].operations[0].state, 'stopped');
    hold.resolve(answer);
    assert.equal(await pending, null);
    assert.deepEqual(f.calls.map(r => r.action), ['control-status']);
  });
}

for (const phase of ['pre-dispatch', 'post-response']) {
  for (const check of ['platform', 'permission']) {
    test(`native deadline bounds held ${phase} ${check} checks and ignores their 31-second release`, async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const previous = record({ control: 'revoke', target: null, state: 'revocation-recorded' });
      const hold = Promise.withResolvers();
      const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [previous] } },
        native: r => r.action === 'control-status' ? status(r, 'revocation-recorded') : submission(r) });
      await turn();
      let checks = 0, settled = false;
      const answer = check === 'platform' ? { os: 'win' } : true;
      const heldAt = phase === 'pre-dispatch' ? 2 : 3;
      const verify = async () => ++checks === heldAt ? hold.promise : answer;
      if (check === 'platform') f.api.runtime.getPlatformInfo = verify;
      else f.api.permissions.contains = verify;
      t.after(() => hold.resolve(answer));
      const pending = f.send(query(previous, ADMIN_CONTROL_RECONCILE)).then(value => { settled = true; return value; });
      await turn();
      assert.equal(checks, heldAt, 'initial receipt admission completed before the held native check');
      const permit = f.controller.captureStartupPermit();
      f.controller.cancelPendingStartup();
      assert.equal(permit(), false, 'Pause denial stays synchronous while the native check is stalled');
      assert.deepEqual(await f.send(query(previous)), status(previous, 'revocation-recorded'), 'the journal queue stays available');
      t.mock.timers.tick(30000);
      await turn();
      const settledAtDeadline = settled;
      t.mock.timers.tick(1000);
      hold.resolve(answer);
      assert.equal(await pending, null);
      await turn();
      assert.equal(settledAtDeadline, true, 'the native call must finish before the held check is released');
      assert.equal(f.calls.filter(r => r.action === 'control-reconcile').length, phase === 'pre-dispatch' ? 0 : 1);
      assert.ok(f.calls.every(r => ['control-status', 'control-reconcile'].includes(r.action)));
      assert.equal(f.local[ADMIN_CONTROL_JOURNAL].operations[0].state, 'revocation-recorded');
    });
  }
}

test('recorded Revoke dispatch waits for an in-flight worker status commit, not its old journal snapshot', async t => {
  const previous = record({ control: 'revoke', target: null, state: 'revocation-recorded' });
  const hold = Promise.withResolvers();
  const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [previous] } },
    native: r => r.action === 'control-status' ? status(r, 'stopped') : submission(r) });
  await turn();
  const set = f.api.storage.local.set;
  let committing = false;
  f.api.storage.local.set = async values => { committing = true; await hold.promise; return set(values); };
  t.after(() => hold.resolve());
  const reading = f.send(query(previous));
  await turn();
  assert.equal(committing, true);
  const pending = f.send(query(previous, ADMIN_CONTROL_RECONCILE));
  await turn();
  assert.deepEqual(f.calls.map(r => r.action), ['control-status'], 'no reconcile may overtake the status commit');
  hold.resolve();
  await reading;
  assert.equal(await pending, null);
  assert.equal(f.local[ADMIN_CONTROL_JOURNAL].operations[0].state, 'stopped');
});

for (const cancel of ['timeout', 'permission', 'dispose']) {
  test(`recorded Revoke cancels a delayed dispatch guard after ${cancel}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const previous = record({ control: 'revoke', target: null, state: 'revocation-recorded' });
    const hold = Promise.withResolvers();
    const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [previous] } } });
    await turn();
    const get = f.api.storage.local.get;
    let reads = 0;
    f.api.storage.local.get = async key => {
      const value = await get(key);
      if (key === ADMIN_CONTROL_JOURNAL && ++reads === 2) await hold.promise;
      return value;
    };
    t.after(() => hold.resolve());
    const pending = f.send(query(previous, ADMIN_CONTROL_RECONCILE));
    await turn();
    assert.equal(reads, 2, 'the dispatch guard revalidates the active journal');
    assert.deepEqual(f.calls, []);
    if (cancel === 'timeout') {
      t.mock.timers.tick(30000);
      assert.equal(await pending, null);
      assert.deepEqual(await f.send(query(previous)), status(previous), 'timeout releases the guard queue before its late read');
    } else if (cancel === 'permission') f.revoke();
    else f.controller.dispose();
    hold.resolve();
    assert.equal(await pending, null);
    await turn();
    assert.equal(f.calls.some(r => r.action === 'control-reconcile'), false, 'a late guard cannot open UAC');
  });
}

test('recorded Revoke dispatch releases the journal queue before awaiting native completion', async t => {
  const previous = record({ control: 'revoke', target: null, state: 'revocation-recorded' });
  const hold = Promise.withResolvers();
  const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [previous] } },
    native: r => r.action === 'control-reconcile' ? hold.promise : r.action === 'control-status' ? status(r, 'stopped') : submission(r) });
  t.after(() => hold.resolve(submission(previous)));
  const pending = f.send(query(previous, ADMIN_CONTROL_RECONCILE));
  await turn();
  assert.deepEqual(f.calls.map(r => r.action), ['control-reconcile']);
  const permit = f.controller.captureStartupPermit();
  f.controller.cancelPendingStartup();
  assert.equal(permit(), false, 'Pause denial does not wait for reconciliation');
  assert.deepEqual(await f.send(query(previous)), status(previous, 'stopped'));
  const revoked = await f.send({ type: ADMIN_CONTROL, bundleSha256: digest, control: 'revoke' });
  assert.equal(revoked.control, 'revoke');
  assert.notEqual(revoked.operationId, previous.operationId);
  assert.deepEqual(f.calls.map(r => r.action), ['control-reconcile', 'control-status', 'control']);
  assert.equal(f.calls.at(-1).operationId, revoked.operationId, 'only the new explicit Revoke is dispatched');
  hold.resolve(submission(previous));
  assert.deepEqual(await pending, submission(previous));
});

test('the recorded Revoke exception keeps other terminal and archived operations read-only', async t => {
  for (const previous of [record({ state: 'launch-requested' }),
    record({ control: 'revoke', target: null, state: 'stopped' }), record({ state: 'fenced' })]) {
    const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [previous] } } });
    for (const type of [ADMIN_CONTROL_RECONCILE, ADMIN_CONTROL_FENCE]) assert.equal(await f.send(query(previous, type)), null);
    assert.deepEqual(f.calls, []);
  }
  const previous = record({ control: 'revoke', target: null, state: 'revocation-recorded' });
  const key = 'windowsAdministratorControlArchiveV1:' + digest + ':' + operationId;
  const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [] }, [key]: previous } });
  for (const type of [ADMIN_CONTROL_RECONCILE, ADMIN_CONTROL_FENCE]) assert.equal(await f.send(query(previous, type)), null);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.writes, []);
});

test('explicit recovery/fence only address existing matching journal IDs and never replay control', async t => {
  const previous = record();
  const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [previous] } } });
  for (const type of [ADMIN_CONTROL_FENCE, ADMIN_CONTROL_RECONCILE]) {
    assert.equal(await f.send({ ...query(previous, type), target }), null);
    assert.equal(await f.send({ ...query(previous, type), bundleSha256: 'e'.repeat(64) }), null);
    assert.equal(await f.send({ ...query(previous, type), operationId: 'f'.repeat(32) }), null);
    assert.ok(await f.send(query(previous, type)));
  }
  assert.equal(f.calls.some(r => ['control', 'wake', 'session'].includes(r.action)), false);
  assert.ok(f.calls.every(r => !Object.hasOwn(r, 'target')));
});

test('permission removal preserves durable operation and invalidates an in-flight response', async t => {
  let finish;
  const f = fixture(t, { native: r => r.action === 'control-support' ? support(r.control) :
    new Promise(resolve => { finish = () => resolve(submission(r)); }) });
  const pending = f.send(connect);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  f.revoke(); finish();
  const result = await pending;
  assert.equal(result.outcome, 'unconfirmed');
  assert.equal(f.local[ADMIN_CONTROL_JOURNAL].operations.length, 1);
  assert.equal(await f.send(connect), null);
});

test('worker restart, startup, permission regrant and alarms can read but never replay pending mutation', async t => {
  const previous = record({ createdAt: 700000 });
  const local = { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [previous] } };
  const f = fixture(t, { local });
  await new Promise(resolve => setImmediate(resolve));
  f.revoke(); f.grant(); f.startup.emit(); f.alarm.emit({ name: 'agent-continue-administrator-control-readback' });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.calls.length > 0);
  assert.ok(f.calls.every(r => r.action === 'control-status'));
  assert.equal(local[ADMIN_CONTROL_JOURNAL].operations.length, 1);
});

test('removal and regrant during journal read cannot dispatch old-epoch Fence or Reconcile', async t => {
  for (const type of [ADMIN_CONTROL_FENCE, ADMIN_CONTROL_RECONCILE]) {
    const previous = record();
    const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [previous] } } });
    await new Promise(resolve => setImmediate(resolve));
    const read = f.api.storage.local.get;
    let release;
    f.api.storage.local.get = async key => { const value = await read(key); await new Promise(resolve => { release = resolve; }); return value; };
    const operation = f.send(query(previous, type));
    while (!release) await new Promise(resolve => setImmediate(resolve));
    f.revoke(); f.grant();
    f.api.storage.local.get = read; release();
    assert.equal(await operation, null);
    assert.equal(f.calls.some(r => ['control-fence', 'control-reconcile'].includes(r.action)), false);
  }
});

test('permission regrant queues fresh observation after an old-epoch status reply settles', async t => {
  let release;
  const previous = record({ createdAt: 700000 });
  const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [previous] } },
    native: r => !release ? new Promise(resolve => { release = () => resolve(status(r)); }) : status(r) });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  f.revoke(); f.grant(); release();
  for (let i = 0; i < 20 && f.calls.length < 2; i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.calls.length >= 2);
  assert.ok(f.calls.every(r => r.action === 'control-status'));
  assert.equal(f.local[ADMIN_CONTROL_JOURNAL].operations[0].state, 'reserved');
});

test('installation-scoped Revoke does not depend on a fresh support round trip', async t => {
  const f = fixture(t, { native: r => r.action === 'control-support' ? null : submission(r) });
  const result = await f.send({ type: ADMIN_CONTROL, bundleSha256: digest, control: 'revoke' });
  assert.ok(result && result.control === 'revoke');
  assert.equal(f.calls.some(r => r.action === 'control-support'), false);
  assert.equal(f.calls.filter(r => r.action === 'control').length, 1);
});

test('full resolved history archives a terminal record before admitting durable Revoke, preserving unresolved Connect', async t => {
  const previous = record();
  const terminalHistory = Array.from({ length: 255 }, (_, i) => record({
    operationId: (i + 1).toString(16).padStart(32, '0'), state: 'fenced' }));
  const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [...terminalHistory, previous] } } });
  const result = await f.send({ type: ADMIN_CONTROL, bundleSha256: digest, control: 'revoke' });
  assert.ok(result && result.control === 'revoke');
  const active = f.local[ADMIN_CONTROL_JOURNAL].operations;
  assert.equal(active.length, 256);
  assert.deepEqual(active.find(r => r.operationId === previous.operationId), previous);
  assert.ok(active.some(r => r.operationId === result.operationId));
  const archived = Object.entries(f.local).filter(([key]) => key.startsWith('windowsAdministratorControlArchiveV1:'));
  assert.equal(archived.length, 1);
  assert.deepEqual(archived[0][1], terminalHistory[0]);
  assert.ok(archived[0][0].endsWith(':' + terminalHistory[0].operationId));
});

test('an archive write/readback failure preserves the active journal and dispatches no new denial', async t => {
  for (const corruptReadback of [false, true]) {
    const previous = record();
    const terminalHistory = Array.from({ length: 255 }, (_, i) => record({
      operationId: (i + 1).toString(16).padStart(32, '0'), state: 'fenced' }));
    const initial = { version: 1, operations: [...terminalHistory, previous] };
    const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: initial } });
    const get = f.api.storage.local.get, set = f.api.storage.local.set;
    f.api.storage.local.set = async values => {
      if (Object.keys(values).some(k => k.startsWith('windowsAdministratorControlArchiveV1:'))) {
        if (!corruptReadback) throw Error('archive_quota');
        return;
      }
      return set(values);
    };
    f.api.storage.local.get = key => get(key);
    assert.equal(await f.send({ type: ADMIN_CONTROL, control: 'revoke', bundleSha256: digest }), null);
    assert.deepEqual(f.local[ADMIN_CONTROL_JOURNAL], initial);
    assert.equal(f.calls.some(r => r.action === 'control'), false);
  }
});

test('archived terminal IDs remain queryable but cannot be reissued as Fence or Reconcile', async t => {
  const previous = record({ state: 'fenced' });
  const key = 'windowsAdministratorControlArchiveV1:' + digest + ':' + operationId;
  const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [] }, [key]: previous },
    native: r => status(r, 'fenced') });
  assert.deepEqual(await f.send(query(previous)), status(previous, 'fenced'));
  assert.equal(await f.send(query(previous, ADMIN_CONTROL_FENCE)), null);
  assert.equal(await f.send(query(previous, ADMIN_CONTROL_RECONCILE)), null);
  assert.ok(f.calls.every(r => r.action === 'control-status'));
  assert.deepEqual(f.local[key], previous);
});

test('concurrent manual status checks share only an in-flight read, never cached completed receipts', async t => {
  let release;
  const previous = record();
  const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [previous] } },
    native: r => new Promise(resolve => { release = () => resolve(status(r)); }) });
  const first = f.send(query(previous)), second = f.send(query(previous));
  while (!release) await new Promise(resolve => setImmediate(resolve));
  release();
  assert.deepEqual(await first, status(previous));
  assert.deepEqual(await second, status(previous));
  assert.equal(f.calls.length, 1);
  release = undefined;
  const next = f.send(query(previous));
  while (!release) await new Promise(resolve => setImmediate(resolve));
  release(); await next;
  assert.equal(f.calls.length, 2);
});

test('interrupted archive commit resumes after a legitimate revoked-to-stopped readback', async t => {
  const revoked = record({ operationId: 'e'.repeat(32), control: 'revoke', target: null, state: 'revocation-recorded' });
  const previous = record();
  const history = Array.from({ length: 254 }, (_, i) => record({ operationId: (i + 1).toString(16).padStart(32, '0'), state: 'fenced' }));
  const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [revoked, ...history, previous] } },
    native: r => r.action === 'control-status' ? status(r, 'stopped') : submission(r) });
  const set = f.api.storage.local.set;
  let interrupt = true;
  f.api.storage.local.set = async values => {
    if (interrupt && Object.hasOwn(values, ADMIN_CONTROL_JOURNAL)) { interrupt = false; throw Error('interrupted_active_commit'); }
    return set(values);
  };
  assert.equal(await f.send({ type: ADMIN_CONTROL, control: 'revoke', bundleSha256: digest }), null);
  const archiveKey = 'windowsAdministratorControlArchiveV1:' + digest + ':' + revoked.operationId;
  assert.deepEqual(f.local[archiveKey], revoked);
  assert.equal(f.calls.filter(r => r.action === 'control').length, 0);
  await f.send(query(revoked));
  assert.equal(f.local[ADMIN_CONTROL_JOURNAL].operations[0].state, 'stopped');
  const result = await f.send({ type: ADMIN_CONTROL, control: 'revoke', bundleSha256: digest });
  assert.ok(result);
  assert.equal(f.local[archiveKey].state, 'stopped');
  assert.deepEqual(f.local[ADMIN_CONTROL_JOURNAL].operations.find(r => r.operationId === previous.operationId), previous);
  assert.equal(f.calls.filter(r => r.action === 'control').length, 1);
});

test('a genuine archive action/target identity collision cannot be overwritten or free capacity', async t => {
  const first = record({ state: 'fenced' });
  const history = Array.from({ length: 255 }, (_, i) => record({ operationId: (i + 1).toString(16).padStart(32, '0'), state: 'fenced' }));
  const key = 'windowsAdministratorControlArchiveV1:' + digest + ':' + operationId;
  const conflict = record({ control: 'revoke', target: null, state: 'fenced' });
  const f = fixture(t, { local: { [ADMIN_CONTROL_JOURNAL]: { version: 1, operations: [first, ...history] }, [key]: conflict } });
  assert.equal(await f.send({ type: ADMIN_CONTROL, control: 'revoke', bundleSha256: digest }), null);
  assert.deepEqual(f.local[key], conflict);
  assert.equal(f.local[ADMIN_CONTROL_JOURNAL].operations.length, 256);
  assert.equal(f.calls.some(r => r.action === 'control'), false);
});
