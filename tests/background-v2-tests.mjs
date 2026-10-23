// Synthetic fixtures only. This suite never reads a user prompt or upload.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.EXTENSION_ROOT || path.dirname(here));
const { DEFAULT_CONFIG, inQuietHours } = await import(pathToFileURL(path.join(root, 'config.js')));
const originalUrl = 'https://chatgpt.com/c/synthetic-original';
const otherUrl = 'https://chatgpt.com/c/synthetic-other';
const alarmName = 'agent-continue-heartbeat';
const copy = value => value === undefined ? undefined : structuredClone(value);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let importId = 0;
const results = [];

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function until(condition, description = 'expected state') {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (await condition()) return;
    await delay(2);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
function event() {
  const listeners = [];
  return {
    listeners,
    addListener(callback) { listeners.push(callback); },
    emit(...args) { for (const callback of listeners) callback(...args); },
  };
}

async function harness(seed = {}) {
  const state = {
    session: copy(seed.session || {}), local: copy(seed.local || {}),
    alarms: new Map(seed.alarms || []),
    tabs: new Map((seed.tabs || [{ id: 7, url: originalUrl, active: true }])
      .map(tab => [tab.id, { title: 'Synthetic conversation', autoDiscardable: true, ...copy(tab) }])),
    injections: [], tabUpdates: [], tabGets: [], accessLevels: [], powerCalls: [],
    permissionGranted: seed.permissionGranted ?? false,
  };
  const area = name => ({
    async get(key) { return { [key]: copy(state[name][key]) }; },
    async set(value) { Object.assign(state[name], copy(value)); },
    async remove(key) { delete state[name][key]; },
    async setAccessLevel(value) { state.accessLevels.push({ area: name, ...value }); },
  });
  const chrome = {
    storage: { session: area('session'), local: area('local') },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setTitle() {} },
    alarms: {
      async get(name) { return state.alarms.get(name); },
      async clear(name) { return state.alarms.delete(name); },
      async create(name, value) { state.alarms.set(name, { name, ...value }); },
      onAlarm: event(),
    },
    permissions: { async contains() { return state.permissionGranted; } },
    power: {
      requestKeepAwake(level) { state.powerCalls.push({ method: 'request', level }); },
      releaseKeepAwake() { state.powerCalls.push({ method: 'release' }); },
    },
    tabs: {
      async query(query = {}) {
        return [...state.tabs.values()]
          .filter(tab => !query.active || tab.active)
          .filter(tab => !query.url || tab.url.startsWith('https://chatgpt.com/'))
          .map(copy);
      },
      async get(id) {
        state.tabGets.push(id);
        if (!state.tabs.has(id)) throw new Error('Synthetic tab is absent');
        return copy(state.tabs.get(id));
      },
      async update(id, update) {
        assert.deepEqual(Object.keys(update), ['autoDiscardable'], 'A background task must never activate a tab');
        await h.beforeTabUpdate?.(id, update);
        if (!state.tabs.has(id)) throw new Error('Synthetic tab is absent');
        state.tabUpdates.push({ id, ...copy(update) });
        Object.assign(state.tabs.get(id), update);
        return copy(state.tabs.get(id));
      },
      onRemoved: event(), onUpdated: event(),
    },
    scripting: {
      async executeScript(request) {
        state.injections.push(request);
        return [{ frameId: 0, result: await h.pageResult(request.args[0], request.target.tabId) }];
      },
    },
    runtime: { onMessage: event() }, commands: { onCommand: event() },
  };
  const h = {
    state, chrome,
    pageResult: async args => ({ status: args.mode === 'check' ? 'ready' : 'sent', message: 'Synthetic status', assistantToken: 'synthetic-assistant-0', assistantCount: 1 }),
    message(message, sender = { id: 'synthetic-extension', url: 'chrome-extension://synthetic/popup.html' }) {
      return new Promise(resolve => chrome.runtime.onMessage.listeners[0](message, sender, resolve));
    },
    sender(id = state.session.job?.tabId ?? 7) {
      const tab = copy(state.tabs.get(id));
      return { tab, frameId: 0, url: tab?.url };
    },
    async start(config = {}, tabId = 7) {
      const response = await this.message({ type: 'START', tabId, config: { prompt: 'SYNTHETIC_CONTINUE', ...config } });
      assert.equal(response.ok, true, JSON.stringify(response));
      return response.job;
    },
    sends() { return state.injections.filter(request => request.args[0].mode === 'send'); },
    async tick({ due = true } = {}) {
      if (due) state.session.job.nextAt = Date.now() - 1;
      chrome.alarms.onAlarm.emit({ name: alarmName });
      if (due) await until(() => state.session.job?.phase === 'idle' && (!state.session.job.enabled || state.session.job.nextAt > Date.now()), 'heartbeat completion');
      else { await delay(5); await this.message({ type: 'GET_STATE' }); }
      return copy(state.session.job);
    },
    async close(id = 7) {
      state.tabs.delete(id);
      chrome.tabs.onRemoved.emit(id);
      await until(() => state.session.job?.tabId !== id, 'target removal');
    },
    async navigate(url, id = 7) {
      state.tabs.get(id).url = url;
      chrome.tabs.onUpdated.emit(id, { url });
      await until(() => state.session.job?.tabId !== id, 'target navigation');
    },
  };
  globalThis.chrome = chrome;
  await import(pathToFileURL(path.join(root, 'background.js')).href + `?v2-test=${++importId}`);
  assert.equal((await h.message({ type: 'GET_STATE' })).ok, true);
  return h;
}

async function scenario(name, body) {
  try { await body(); results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, status: 'FAIL', error: error.stack }); console.error(`FAIL ${name}: ${error.message}`); }
}

await scenario('Defaults run every 20 minutes without a send limit or immediate first send', async () => {
  assert.equal(DEFAULT_CONFIG.intervalMinutes, 20);
  assert.equal(DEFAULT_CONFIG.maxSends, 0);
  const h = await harness();
  const before = Date.now();
  const job = await h.start();
  assert.equal(job.enabled, true);
  assert.ok(job.nextAt >= before + 20 * 60_000);
  assert.equal(h.sends().length, 0);
  assert.deepEqual(h.state.local.resumeJob, h.state.session.job);
  assert.ok(h.state.accessLevels.some(value => value.area === 'local' && value.accessLevel === 'TRUSTED_CONTEXTS'));
  await h.message({ type: 'PAUSE' });
});

await scenario('A newer START wins over an older slow page check', async () => {
  const h = await harness({ tabs: [{ id: 7, url: originalUrl }, { id: 9, url: otherUrl }] });
  const gate = deferred();
  h.pageResult = async (args, tabId) => tabId === 7 ? gate.promise : { status: 'ready' };
  const older = h.message({ type: 'START', tabId: 7, config: { prompt: 'SYNTHETIC_OLD', startImmediately: true } });
  await until(() => h.state.injections.length === 1);
  const newer = await h.start({ prompt: 'SYNTHETIC_NEW' }, 9);
  gate.resolve({ status: 'ready' });
  assert.equal((await older).ok, false);
  assert.equal(h.state.session.job.id, newer.id);
  assert.equal(h.state.session.job.tabId, 9);
  assert.equal(h.sends().length, 0);
  await h.message({ type: 'PAUSE' });
});

await scenario('PAUSE cancels START while its page check is pending', async () => {
  const h = await harness();
  const gate = deferred();
  h.pageResult = () => gate.promise;
  const starting = h.message({ type: 'START', tabId: 7, config: { prompt: 'SYNTHETIC_PENDING', startImmediately: true } });
  await until(() => h.state.injections.length === 1);
  await h.message({ type: 'PAUSE' });
  gate.resolve({ status: 'ready' });
  assert.equal((await starting).ok, false);
  assert.ok(!h.state.session.job?.enabled);
  assert.equal(h.sends().length, 0);
  assert.equal(h.state.alarms.size, 0);
});

await scenario('PAUSE during START commit prevents the queued immediate send', async () => {
  const h = await harness();
  const entered = deferred(), release = deferred();
  h.beforeTabUpdate = async (_id, update) => {
    if (update.autoDiscardable === false) { entered.resolve(); await release.promise; }
  };
  const starting = h.message({ type: 'START', tabId: 7, config: { prompt: 'SYNTHETIC_COMMIT', startImmediately: true } });
  await entered.promise;
  const pausing = h.message({ type: 'PAUSE' });
  release.resolve();
  await Promise.all([starting, pausing]);
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.sends().length, 0);
  assert.equal(h.state.alarms.size, 0);
});

await scenario('Concurrent manual sends and an alarm claim only one round', async () => {
  const h = await harness();
  await h.start();
  const gate = deferred();
  h.pageResult = () => gate.promise;
  const first = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const second = await h.message({ type: 'SEND_NOW' });
  assert.equal(second.ok, false);
  h.chrome.alarms.onAlarm.emit({ name: alarmName });
  await delay(5);
  assert.equal(h.sends().length, 1);
  gate.resolve({ status: 'sent' });
  await first;
  assert.equal(h.state.session.job.sentCount, 1);
  await h.message({ type: 'PAUSE' });
});

await scenario('A late successful result cannot revive or increment a paused task', async () => {
  const h = await harness();
  await h.start();
  const gate = deferred();
  h.pageResult = () => gate.promise;
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const runId = h.state.session.job.runId;
  assert.equal((await h.message({ type: 'CHECK_RUN', runId }, h.sender())).allowed, true);
  await h.message({ type: 'PAUSE' });
  assert.equal((await h.message({ type: 'CHECK_RUN', runId }, h.sender())).allowed, false);
  gate.resolve({ status: 'sent' });
  await round;
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.state.session.job.sentCount, 0);
  assert.equal(h.state.local.resumeJob.enabled, false);
  assert.equal(h.state.alarms.size, 0);
});

await scenario('A late result from a replaced job cannot modify the new job', async () => {
  const h = await harness();
  const older = await h.start();
  const gate = deferred();
  h.pageResult = args => args.mode === 'send' ? gate.promise : Promise.resolve({ status: 'ready' });
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const newer = await h.start({ prompt: 'SYNTHETIC_REPLACEMENT' });
  assert.notEqual(older.id, newer.id);
  gate.resolve({ status: 'sent' });
  await round;
  assert.equal(h.state.session.job.id, newer.id);
  assert.equal(h.state.session.job.sentCount, 0);
  await h.message({ type: 'PAUSE' });
});

await scenario('Browser restart discards old tab IDs and resolves the unique exact URL', async () => {
  const first = await harness();
  await first.start();
  const local = copy(first.state.local);
  const h = await harness({ local, tabs: [{ id: 7, url: otherUrl, active: true }, { id: 19, url: originalUrl }] });
  assert.equal(h.state.session.job.tabId, null);
  assert.equal(h.sends().length, 0);
  const result = await h.message({ type: 'SEND_NOW' });
  assert.equal(result.ok, true);
  assert.equal(result.job.tabId, 19);
  assert.equal(h.sends()[0].target.tabId, 19);
  assert.ok(h.state.tabUpdates.every(update => update.id !== 7));
  await h.message({ type: 'PAUSE' });
});

await scenario('Recovery refuses ambiguous matching tabs without sending to the active tab', async () => {
  const first = await harness();
  await first.start();
  const h = await harness({ local: copy(first.state.local), tabs: [{ id: 10, url: originalUrl }, { id: 11, url: originalUrl, active: true }] });
  const response = await h.message({ type: 'SEND_NOW' });
  assert.equal(response.job.enabled, true);
  assert.equal(response.job.sentCount, 0);
  assert.equal(response.job.tabId, null);
  assert.equal(h.sends().length, 0);
  await h.message({ type: 'PAUSE' });
});

await scenario('Interrupted submission recovery skips a full interval without replaying immediately', async () => {
  const first = await harness();
  const job = await first.start();
  const before = Date.now();
  const h = await harness({ session: { job: { ...job, phase: 'sending', runKind: 'send', runDeadline: before + 12_000 } } });
  assert.equal(h.state.session.job.enabled, true);
  assert.equal(h.state.session.job.phase, 'idle');
  assert.equal(h.state.session.job.unknownCount, 1);
  assert.ok(h.state.session.job.nextAt >= before + 20 * 60_000);
  await h.tick({ due: false });
  assert.equal(h.sends().length, 0);
  await h.message({ type: 'PAUSE' });
});

await scenario('Looping queues preserve progress over pause/resume and send items in order', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ name: 'A', text: 'SYNTHETIC_A' }, { name: 'B', text: 'SYNTHETIC_B' }] });
  await h.message({ type: 'SEND_NOW' });
  assert.equal(h.state.session.job.queueIndex, 1);
  await h.message({ type: 'PAUSE' });
  await h.message({ type: 'RESUME' });
  await h.message({ type: 'SEND_NOW' });
  assert.equal(h.state.session.job.queueIndex, 0);
  await h.message({ type: 'SEND_NOW' });
  assert.deepEqual(h.sends().map(request => request.args[0].prompt), ['SYNTHETIC_A', 'SYNTHETIC_B', 'SYNTHETIC_A']);
  assert.equal(h.state.local.resumeJob.queueIndex, 1);
  assert.equal(h.state.local.resumeJob.sentCount, 3);
  await h.message({ type: 'PAUSE' });
});

await scenario('Single-pass queue stops after its last confirmed item and cannot resume as an empty queue', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-once', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_LAST' }] });
  await h.message({ type: 'SEND_NOW' });
  assert.equal(h.state.session.job.enabled, true);
  const last = await h.message({ type: 'SEND_NOW' });
  assert.equal(last.job.enabled, false);
  assert.equal(last.job.queueIndex, 2);
  assert.equal(last.job.sentCount, 2);
  assert.equal((await h.message({ type: 'RESUME' })).ok, false);
  assert.equal(h.state.alarms.size, 0);
});

await scenario('An unknown repeat result skips this cycle and resumes only after the full interval', async () => {
  const h = await harness();
  await h.start();
  h.pageResult = async () => ({ status: 'unknown' });
  const before = Date.now();
  const result = await h.message({ type: 'SEND_NOW' });
  assert.equal(result.job.enabled, true);
  assert.equal(result.job.sentCount, 0);
  assert.equal(result.job.unknownCount, 1);
  assert.ok(result.job.nextAt >= before + 20 * 60_000);
  await h.tick({ due: false });
  assert.equal(h.sends().length, 1);
  h.pageResult = async () => ({ status: 'sent' });
  await h.tick();
  assert.equal(h.sends().length, 2);
  assert.equal(h.state.session.job.sentCount, 1);
  await h.message({ type: 'PAUSE' });
});

await scenario('Busy, draft and page errors preserve queue position and retry only a check cycle later', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_QUEUE_ITEM' }, { text: 'SYNTHETIC_NEXT_ITEM' }] });
  for (const status of ['busy', 'draft', 'error', 'blocked']) {
    h.pageResult = async () => ({ status, message: 'Synthetic fixed status' });
    const before = Date.now();
    const result = await h.message({ type: 'SEND_NOW' });
    assert.equal(result.job.enabled, true);
    assert.equal(result.job.queueIndex, 0);
    assert.equal(result.job.sentCount, 0);
    assert.ok(result.job.nextAt >= before + 60_000 && result.job.nextAt <= Date.now() + 60_000);
  }
  h.pageResult = async () => ({ status: 'sent' });
  await h.tick();
  assert.equal(h.state.session.job.queueIndex, 1);
  await h.message({ type: 'PAUSE' });
});

await scenario('After-reply scheduling waits for a new completed response and then a full interval', async () => {
  const h = await harness();
  await h.start({ scheduleMode: 'after-reply' });
  await h.message({ type: 'SEND_NOW' });
  assert.equal(h.state.session.job.awaitingReply, true);
  await h.tick();
  assert.equal(h.sends().length, 1);
  assert.equal(h.state.session.job.awaitingReply, true);
  h.pageResult = async args => ({ status: args.mode === 'check' ? 'ready' : 'sent', assistantToken: 'synthetic-assistant-1', assistantCount: 2 });
  const before = Date.now();
  await h.tick();
  assert.equal(h.sends().length, 1);
  assert.equal(h.state.session.job.awaitingReply, false);
  assert.ok(h.state.session.job.nextAt >= before + 20 * 60_000);
  await h.tick({ due: false });
  assert.equal(h.sends().length, 1);
  await h.tick();
  assert.equal(h.sends().length, 2);
  await h.message({ type: 'PAUSE' });
});

await scenario('A failed read-only reply check preserves the reply gate and never becomes an uncertain submission', async () => {
  const h = await harness();
  await h.start({ scheduleMode: 'after-reply' });
  await h.message({ type: 'SEND_NOW' });
  h.pageResult = async args => { assert.equal(args.mode, 'check'); throw new Error('Synthetic injection failure'); };
  await h.tick();
  assert.equal(h.state.session.job.awaitingReply, true);
  assert.equal(h.state.session.job.unknownCount, 0);
  assert.equal(h.sends().length, 1);
  h.pageResult = async () => ({ status: 'ready', assistantToken: 'synthetic-assistant-0', assistantCount: 1 });
  await h.tick();
  assert.equal(h.state.session.job.awaitingReply, true);
  assert.equal(h.sends().length, 1);
  await h.message({ type: 'PAUSE' });
});

await scenario('Worker restart during a read-only reply check preserves the reply gate', async () => {
  const first = await harness();
  await first.start({ scheduleMode: 'after-reply' });
  await first.message({ type: 'SEND_NOW' });
  const snapshot = copy(first.state.session.job);
  const before = Date.now();
  const h = await harness({ session: { job: { ...snapshot, phase: 'sending', runKind: 'reply-check', runDeadline: before + 12_000 } } });
  assert.equal(h.state.session.job.awaitingReply, true);
  assert.equal(h.state.session.job.unknownCount, 0);
  assert.ok(h.state.session.job.nextAt >= before + 60_000 && h.state.session.job.nextAt <= Date.now() + 60_000);
  await h.tick();
  assert.equal(h.sends().length, 0);
  assert.equal(h.state.session.job.awaitingReply, true);
  await h.message({ type: 'PAUSE' });
});

await scenario('Closing a target during submission invalidates the token and defers a full interval', async () => {
  const h = await harness();
  await h.start();
  const gate = deferred();
  h.pageResult = () => gate.promise;
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const before = Date.now();
  await h.close();
  gate.resolve({ status: 'sent' });
  await round;
  assert.equal(h.state.session.job.enabled, true);
  assert.equal(h.state.session.job.sentCount, 0);
  assert.equal(h.state.session.job.unknownCount, 1);
  assert.ok(h.state.session.job.nextAt >= before + 20 * 60_000);
  h.state.tabs.set(17, { id: 17, url: originalUrl, autoDiscardable: true });
  await h.tick({ due: false });
  assert.equal(h.sends().length, 1);
  await h.message({ type: 'PAUSE' });
});

await scenario('Navigating away during submission cannot send to the new conversation or retry early', async () => {
  const h = await harness();
  await h.start();
  const gate = deferred();
  h.pageResult = () => gate.promise;
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const before = Date.now();
  await h.navigate(otherUrl);
  gate.resolve({ status: 'sent' });
  await round;
  assert.equal(h.state.session.job.url, originalUrl);
  assert.equal(h.state.session.job.tabId, null);
  assert.equal(h.state.session.job.unknownCount, 1);
  assert.ok(h.state.session.job.nextAt >= before + 20 * 60_000);
  await h.tick({ due: false });
  assert.equal(h.sends().length, 1);
  await h.message({ type: 'PAUSE' });
});

await scenario('Closing or navigating during a read-only reply check preserves the reply gate', async () => {
  for (const changeTarget of ['close', 'navigate']) {
    const h = await harness();
    await h.start({ scheduleMode: 'after-reply' });
    await h.message({ type: 'SEND_NOW' });
    const gate = deferred();
    h.pageResult = args => {
      assert.equal(args.mode, 'check');
      return gate.promise;
    };
    const tick = h.tick();
    await until(() => h.state.injections.length === 3, 'read-only reply check');
    if (changeTarget === 'close') await h.close();
    else await h.navigate(otherUrl);
    gate.resolve({ status: 'ready', assistantToken: 'synthetic-late-response', assistantCount: 2 });
    await tick;
    await delay(5);
    await h.message({ type: 'GET_STATE' });
    assert.equal(h.state.session.job.awaitingReply, true);
    assert.equal(h.state.session.job.unknownCount, 0);
    assert.equal(h.state.session.job.sentCount, 1);
    assert.equal(h.state.session.job.tabId, null);
    assert.equal(h.sends().length, 1);
    await h.message({ type: 'PAUSE' });
  }
});

await scenario('Closing an idle target preserves the existing schedule and waits for the original URL', async () => {
  const h = await harness();
  const job = await h.start();
  await h.close();
  assert.equal(h.state.session.job.nextAt, job.nextAt);
  assert.equal(h.state.session.job.unknownCount, 0);
  h.state.tabs.set(27, { id: 27, url: otherUrl, active: true });
  await h.tick();
  assert.equal(h.sends().length, 0);
  assert.equal(h.state.session.job.enabled, true);
  h.state.tabs.set(28, { id: 28, url: originalUrl, autoDiscardable: true });
  await h.tick();
  assert.equal(h.sends().length, 1);
  assert.equal(h.sends()[0].target.tabId, 28);
  await h.message({ type: 'PAUSE' });
});

await scenario('Dot targets require a readable stable identity before starting', async () => {
  const h = await harness({ tabs: [{ id: 7, url: 'https://chatgpt.com/dots/home', frozen: true }] });
  const rejected = await h.message({ type: 'START', tabId: 7, config: { prompt: 'SYNTHETIC_DOT' } });
  assert.equal(rejected.ok, false);
  assert.ok(!h.state.session.job?.enabled);
  h.state.tabs.get(7).frozen = false;
  h.pageResult = async args => ({ status: args.mode === 'check' ? 'ready' : 'sent', identity: 'synthetic-account~synthetic-dot' });
  const job = await h.start();
  assert.equal(job.targetIdentity, 'synthetic-account~synthetic-dot');
  await h.message({ type: 'SEND_NOW' });
  assert.equal(h.sends()[0].args[0].targetIdentity, job.targetIdentity);
  await h.message({ type: 'PAUSE' });
});

await scenario('Quiet hours cover midnight boundaries and also block a manual immediate send', async () => {
  const quiet = { quietHours: { enabled: true, start: '23:00', end: '07:00' } };
  const local = (hour, minute) => new Date(2026, 0, 2, hour, minute).getTime();
  assert.equal(inQuietHours(quiet, local(22, 59)), false);
  assert.equal(inQuietHours(quiet, local(23, 0)), true);
  assert.equal(inQuietHours(quiet, local(0, 0)), true);
  assert.equal(inQuietHours(quiet, local(6, 59)), true);
  assert.equal(inQuietHours(quiet, local(7, 0)), false);
  const now = new Date();
  const minute = now.getHours() * 60 + now.getMinutes();
  const clock = value => `${String(Math.floor((value % 1440) / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  const h = await harness();
  await h.start({ startImmediately: true, quietHours: { enabled: true, start: clock(minute), end: clock(minute + 2) } });
  await h.message({ type: 'SEND_NOW' });
  assert.equal(h.sends().length, 0);
  assert.equal(h.state.session.job.enabled, true);
  assert.equal(h.state.session.job.sentCount, 0);
  await h.message({ type: 'PAUSE' });
});

await scenario('System keep-awake requires the optional permission and releases on pause', async () => {
  for (const granted of [false, true]) {
    const h = await harness({ permissionGranted: granted });
    const job = await h.start({ keepAwake: true });
    assert.equal(job.systemAwake, granted);
    assert.equal(h.state.powerCalls.filter(call => call.method === 'request').length, granted ? 1 : 0);
    if (granted) assert.equal(h.state.powerCalls.find(call => call.method === 'request').level, 'system');
    await h.message({ type: 'PAUSE' });
    assert.equal(h.state.powerCalls.at(-1).method, 'release');
    assert.equal(h.state.session.job.systemAwake, false);
    assert.ok(h.state.tabUpdates.every(update => !('active' in update)));
  }
});

await scenario('Unexpected page exceptions cannot copy prompt content into operational logs or status', async () => {
  const secret = 'SYNTHETIC_SECRET_FOR_REDACTION_TEST_ONLY';
  const h = await harness();
  await h.start({ prompt: secret });
  h.pageResult = async () => { throw new Error(`Synthetic page failure containing ${secret}`); };
  const result = await h.message({ type: 'SEND_NOW' });
  assert.equal(result.job.unknownCount, 1);
  assert.ok(!JSON.stringify(h.state.local.logs).includes(secret));
  assert.ok(!result.job.statusText.includes(secret));
  await h.message({ type: 'CLEAR_DATA' });
  assert.equal(h.state.local.config, undefined);
  assert.equal(h.state.local.resumeJob, undefined);
  assert.equal(h.state.session.job, undefined);
  assert.equal(h.state.alarms.size, 0);
});

const failed = results.filter(result => result.status === 'FAIL');
console.log(`RESULT ${results.length - failed.length}/${results.length} background v2 scenarios passed`);
for (const result of failed) console.error(result.error);
process.exitCode = failed.length ? 1 : 0;
