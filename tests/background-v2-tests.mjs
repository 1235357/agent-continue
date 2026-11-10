// Synthetic fixtures only. This suite never reads a user prompt or upload.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.EXTENSION_ROOT || path.dirname(here));
const { setLanguage } = await import(pathToFileURL(path.join(root, 'i18n.js')));
const { DEFAULT_CONFIG, inQuietHours, readConfig } = await import(pathToFileURL(path.join(root, 'config.js')));
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
    alarmCreateNoop: seed.alarmCreateNoop ?? false,
  };
  const area = name => ({
    async get(key) { await h.beforeStorageGet?.(name, key); return Object.fromEntries((Array.isArray(key) ? key : [key]).map(item => [item, copy(state[name][item])])); },
    async set(value) { await h.beforeStorageSet?.(name, value); Object.assign(state[name], copy(value)); },
    async remove(key) { await h.beforeStorageRemove?.(name, key); for (const item of Array.isArray(key) ? key : [key]) delete state[name][item]; },
    async setAccessLevel(value) { state.accessLevels.push({ area: name, ...value }); },
  });
  const chrome = {
    storage: { session: area('session'), local: area('local') },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setTitle() {} },
    alarms: {
      async get(name) { return state.alarms.get(name); },
      async clear(name) { return state.alarms.delete(name); },
      async create(name, value) { if (!state.alarmCreateNoop) state.alarms.set(name, { name, ...value }); },
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
      async sendMessage(id, message) { return { revoked: true, runId: message.runId, resultToken: message.resultToken }; },
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
    runtime: { id: 'synthetic-extension', getURL: name => 'chrome-extension://synthetic/' + name, onMessage: event() }, commands: { onCommand: event() },
  };
  const h = {
    state, chrome,
    pageResult: async args => ({ status: args.mode === 'check' ? 'ready' : 'sent', message: 'Synthetic status', assistantToken: 'synthetic-assistant-0', assistantCount: 1 }),
    message(message, sender = { id: 'synthetic-extension', url: 'chrome-extension://synthetic/popup.html' }) {
      return new Promise(resolve => chrome.runtime.onMessage.listeners[0](message, sender, resolve));
    },
    sender(id = state.session.job?.tabId ?? 7) {
      const tab = copy(state.tabs.get(id));
      return { id: 'synthetic-extension', tab, frameId: 0, url: tab?.url };
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
  // Share the production translator and explicitly pin legacy Chinese copy.
  await setLanguage(seed.language || 'zh_CN');
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
  assert.equal(DEFAULT_CONFIG.waitForIdle, false);
  assert.equal(DEFAULT_CONFIG.sendMethod, 'auto');
  const h = await harness();
  const before = Date.now();
  const job = await h.start();
  assert.equal(job.enabled, true);
  assert.equal(job.waitForIdle, false);
  assert.equal(h.state.injections[0].args[0].waitForIdle, false);
  assert.equal(job.sendMethod, 'auto');
  assert.equal(h.state.injections[0].args[0].sendMethod, 'auto');
  assert.ok(job.nextAt >= before + 20 * 60_000);
  assert.equal(h.sends().length, 0);
  assert.deepEqual(h.state.local.resumeJob, h.state.session.job);
  assert.ok(h.state.accessLevels.some(value => value.area === 'local' && value.accessLevel === 'TRUSTED_CONTEXTS'));
  await h.message({ type: 'PAUSE' });
});

await scenario('Send method validates three strategies and freezes the selected strategy in the running task', async () => {
  assert.equal(readConfig({ prompt: 'SYNTHETIC_LEGACY' }).sendMethod, 'auto');
  for (const sendMethod of ['auto', 'ctrl-enter', 'button']) {
    assert.equal(readConfig({ prompt: 'SYNTHETIC_METHOD', sendMethod }).sendMethod, sendMethod);
  }
  for (const sendMethod of ['enter', 'click', '', 42, {}]) {
    assert.throws(() => readConfig({ prompt: 'SYNTHETIC_INVALID_METHOD', sendMethod }), /发送方式/);
  }
  const first = await harness();
  const selected = await first.start({ sendMethod: 'ctrl-enter' });
  assert.equal(selected.sendMethod, 'ctrl-enter');
  assert.equal(first.state.local.config.sendMethod, 'ctrl-enter');
  assert.equal(first.state.local.resumeJob.sendMethod, 'ctrl-enter');
  assert.equal(first.state.injections[0].args[0].sendMethod, 'ctrl-enter');
  first.state.local.config.sendMethod = 'button';
  await first.message({ type: 'PAUSE' });
  await first.message({ type: 'RESUME' });
  const h = await harness({ local: copy(first.state.local), session: copy(first.state.session) });
  await h.message({ type: 'SEND_NOW' });
  assert.equal(h.sends()[0].args[0].sendMethod, 'ctrl-enter', 'Current task must retain its strategy across draft edits and worker restart');
  assert.equal(h.state.local.config.sendMethod, 'button', 'Separately edited draft must remain unchanged');
  await h.message({ type: 'PAUSE' });
});

await scenario('Legacy waiting defaults migrate once while task progress and private content stay unchanged', async () => {
  const legacyConfig = { ...copy(DEFAULT_CONFIG), waitForIdle: true, prompt: 'SYNTHETIC_LEGACY_CONTENT' };
  delete legacyConfig.deliveryBehaviorVersion;
  const legacyJob = { ...legacyConfig, id: 'legacy-job', runId: 'legacy-run', enabled: true,
    tabId: 7, url: originalUrl, phase: 'idle', nextAt: Date.now() + 600_000,
    sentCount: 4, unknownCount: 2, queueIndex: 0, awaitingReply: false };
  const h = await harness({ local: { config: legacyConfig, resumeJob: copy(legacyJob) }, session: { job: legacyJob } });
  assert.equal(h.state.local.config.waitForIdle, false);
  assert.equal(h.state.local.resumeJob.waitForIdle, false);
  assert.equal(h.state.session.job.waitForIdle, false);
  for (const key of ['id', 'enabled', 'prompt', 'nextAt', 'sentCount', 'unknownCount', 'queueIndex', 'awaitingReply']) {
    assert.equal(h.state.session.job[key], legacyJob[key], `${key} must survive migration`);
  }
  assert.equal(h.state.injections.length, 0, 'Migration must not immediately send or interrupt');
  await h.message({ type: 'PAUSE' });
});

await scenario('Legacy persisted recovery receives the interrupt default without activating a tab', async () => {
  const legacy = { ...copy(DEFAULT_CONFIG), waitForIdle: true, prompt: 'SYNTHETIC_RESTORED_CONTENT', id: 'legacy-restored',
    enabled: false, tabId: 7, url: originalUrl, phase: 'idle', nextAt: null, sentCount: 3, unknownCount: 0, queueIndex: 0 };
  delete legacy.deliveryBehaviorVersion;
  const h = await harness({ local: { config: legacy, resumeJob: copy(legacy) } });
  assert.equal(h.state.session.job.waitForIdle, false);
  assert.equal(h.state.local.resumeJob.waitForIdle, false);
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.state.session.job.tabId, null);
  assert.equal(h.state.session.job.sentCount, 3);
  assert.equal(h.state.injections.length, 0);
});

await scenario('Migration repairs a stale legacy session independently of an already updated preference', async () => {
  const preference = { ...copy(DEFAULT_CONFIG), waitForIdle: true, prompt: 'SYNTHETIC_NEW_PREFERENCE' };
  const legacyJob = { ...preference, id: 'legacy-partial', enabled: false, tabId: 7, url: originalUrl,
    phase: 'idle', nextAt: null, sentCount: 2, unknownCount: 0, queueIndex: 0 };
  delete legacyJob.deliveryBehaviorVersion;
  const h = await harness({ local: { config: preference, resumeJob: copy(legacyJob) }, session: { job: legacyJob } });
  assert.equal(h.state.local.config.waitForIdle, true, 'Newly selected waiting must remain selected');
  assert.equal(h.state.session.job.waitForIdle, false, 'Legacy task migrates independently');
  assert.equal(h.state.local.resumeJob.waitForIdle, false);
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.state.injections.length, 0);
});

await scenario('Explicit waiting chosen after upgrade survives worker restarts and reaches the adapter', async () => {
  const first = await harness();
  await first.start({ waitForIdle: true });
  const h = await harness({ local: copy(first.state.local), session: copy(first.state.session) });
  assert.equal(h.state.local.config.waitForIdle, true);
  assert.equal(h.state.session.job.waitForIdle, true);
  assert.equal(h.state.local.resumeJob.waitForIdle, true);
  await h.message({ type: 'SEND_NOW' });
  assert.equal(h.sends()[0].args[0].waitForIdle, true);
  await h.message({ type: 'PAUSE' });
});

await scenario('A restored job without delivery flags uses interrupt and automatic send defaults', async () => {
  const h = await harness();
  await h.start();
  delete h.state.session.job.waitForIdle;
  delete h.state.session.job.sendMethod;
  await h.message({ type: 'SEND_NOW' });
  assert.equal(h.sends()[0].args[0].waitForIdle, false);
  assert.equal(h.sends()[0].args[0].sendMethod, 'auto');
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
  const sending = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  await delay(10);
  assert.equal(h.state.session.job.phase, 'sending', 'A rejected transport must not impose a waiting cutoff or replay');
  await h.message({ type: 'PAUSE' });
  const result = await sending;
  assert.equal(result.job.sentCount, 0);
  assert.ok(!JSON.stringify(h.state.local.logs).includes(secret));
  assert.ok(!result.job.statusText.includes(secret));
  await h.message({ type: 'CLEAR_DATA' });
  assert.equal(h.state.local.config, undefined);
  assert.equal(h.state.local.resumeJob, undefined);
  assert.equal(h.state.session.job, undefined);
  assert.equal(h.state.alarms.size, 0);
});

await scenario('Clear Data preserves unresolved administrator operation and Pause evidence', async () => {
  const journal = { version: 1, operations: [{ bundleSha256: 'a'.repeat(64), operationId: 'b'.repeat(32),
    control: 'connect', target: 'c'.repeat(32) + ':idle', outcome: 'unconfirmed', state: 'reserved',
    progress: null, createdAt: 1 }] };
  const pause = { operationId: 'd'.repeat(32), outcome: 'unconfirmed' };
  const h = await harness({ local: { windowsAdministratorControlJournalV1: journal,
    windowsAdministratorPauseLastV1: pause, windowsAdministratorBrowserRestoreV1: true } });
  await h.message({ type: 'CLEAR_DATA' });
  assert.deepEqual(h.state.local.windowsAdministratorControlJournalV1, journal);
  assert.deepEqual(h.state.local.windowsAdministratorPauseLastV1, pause);
  assert.equal(h.state.local.windowsAdministratorBrowserRestoreV1, undefined);
});

await scenario('English validation and queued sends preserve user-owned Chinese text', async () => {
  const h = await harness({ language: 'en' });
  assert.throws(() => readConfig({ prompt: '测试', sendMethod: 'invalid' }), {
    message: 'Select a valid send method.',
  });
  const queue = [{ name: '用户队列名称', text: '用户提示词：继续' }];
  const job = await h.start({ mode: 'queue-once', queue });
  assert.deepEqual(job.queue, queue);
  assert.equal(job.title, 'Synthetic conversation');
  const result = await h.message({ type: 'SEND_NOW' });
  assert.equal(h.sends()[0].args[0].prompt, queue[0].text);
  assert.equal(result.job.statusText, 'All queued prompts were sent; the one-time queue has finished.');
  await setLanguage('zh_CN');
  assert.throws(() => readConfig({ prompt: '测试', sendMethod: 'invalid' }), /发送方式/);
});

await scenario('Background run clock validates sender and delay and does not block Pause', async () => {
  const h = await harness();
  await h.start();
  const held = deferred();
  h.pageResult = async () => held.promise;
  const sending = h.message({ type: 'SEND_NOW' });
  await until(() => h.state.session.job?.phase === 'sending');
  const runId = h.state.session.job.runId;
  assert.equal(h.sends().at(-1)?.args[0].extensionClock, true);
  for (const delayMs of [0, -1, 1000000, '50', null]) {
    assert.equal((await h.message({ type: 'WAIT_RUN', runId, delayMs }, h.sender())).allowed, false);
  }
  assert.equal((await h.message({ type: 'WAIT_RUN', runId, delayMs: 50 }, { ...h.sender(), frameId: 1 })).allowed, false);
  assert.equal((await h.message({ type: 'WAIT_RUN', runId: 'wrong', delayMs: 50 }, h.sender())).allowed, false);
  assert.equal((await h.message({ type: 'WAIT_RUN', runId, delayMs: 50 }, h.sender())).allowed, true);
  const waiting = h.message({ type: 'WAIT_RUN', runId, delayMs: 180 }, h.sender());
  await delay(5);
  await h.message({ type: 'PAUSE' });
  assert.equal((await waiting).allowed, false);
  held.resolve({ status: 'sent' });
  await sending;
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.state.session.job.sentCount, 0);
});

await scenario('Timing diagnostics are paused-only and cannot issue a send or change saved state', async () => {
  const h = await harness();
  await h.start();
  const beforeRunning = h.state.injections.length;
  assert.equal((await h.message({ type: 'CHECK_TIMING' })).ok, false);
  assert.equal(h.state.injections.length, beforeRunning);
  await h.message({ type: 'PAUSE' });
  const controlState = () => JSON.stringify({ local: { ...h.state.local, logs: undefined }, session: h.state.session });
  const saved = controlState();
  const originalLogCount = h.state.local.logs.length;
  h.pageResult = async kind => kind === 'authorization'
    ? { elapsedMs: 4, ok: true, allowed: false, url: 'MUST_NOT_LEAK' }
    : { firstMs: 64, elapsedMs: 247, hidden: true, text: 'MUST_NOT_LEAK' };
  const before = h.state.injections.length;
  const response = await h.message({ type: 'CHECK_TIMING' });
  assert.equal(response.ok, true);
  assert.deepEqual(response.observations, [
    { kind: 'authorization', status: 'result', elapsedMs: 4, ok: true, allowed: false },
    { kind: 'page-timers', status: 'result', firstMs: 64, elapsedMs: 247, hidden: true },
  ]);
  assert.equal(controlState(), saved);
  assert.equal(h.state.local.logs.length, originalLogCount + 2);
  assert.deepEqual(h.state.local.logs.slice(-2).map(item => item.diagnostic), [
    { code: 'timing-probe', durationMs: 4, kind: 'authorization', status: 'result', ok: true, allowed: false },
    { code: 'timing-probe', durationMs: 247, kind: 'page-timers', status: 'result', firstMs: 64, hidden: true },
  ]);
  const requests = h.state.injections.slice(before);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.world === 'ISOLATED' && request.target.tabId === 7));
  assert.deepEqual(requests.map(request => request.args), [['authorization'], ['page-timers']]);
  assert.equal(JSON.stringify(response).includes('MUST_NOT_LEAK'), false);
});
await scenario('Timing diagnostics reject unbound or changed targets before injecting', async () => {
  const h = await harness();
  assert.equal((await h.message({ type: 'CHECK_TIMING' })).ok, false);
  assert.equal(h.state.injections.length, 0);
  await h.start();
  await h.message({ type: 'PAUSE' });
  h.state.tabs.get(7).url = otherUrl;
  const before = h.state.injections.length;
  assert.equal((await h.message({ type: 'CHECK_TIMING' })).ok, false);
  assert.equal(h.state.injections.length, before);
});
await scenario('Timing diagnostics resolve a reload-invalidated tab without changing the paused task', async () => {
  const h = await harness();
  await h.start();
  await h.message({ type: 'PAUSE' });
  h.state.session.job.tabId = null;
  h.pageResult = async kind => kind === 'authorization' ? { elapsedMs: 1, ok: true, allowed: false }
    : { firstMs: 60, elapsedMs: 240, hidden: true };
  assert.equal((await h.message({ type: 'CHECK_TIMING' })).ok, true);
  assert.equal(h.state.session.job.tabId, null);
  assert.equal(h.state.session.job.enabled, false);
});
await scenario('Timing diagnostics classify API rejection and invalid results without raw errors', async () => {
  const h = await harness();
  await h.start();
  await h.message({ type: 'PAUSE' });
  h.pageResult = async kind => {
    if (kind === 'authorization') throw new Error('SYNTHETIC_PRIVATE_DATA');
    return { elapsedMs: -1 };
  };
  const response = await h.message({ type: 'CHECK_TIMING' });
  assert.deepEqual(response.observations, [
    { kind: 'authorization', status: 'api-rejected' }, { kind: 'page-timers', status: 'invalid-result' },
  ]);
  assert.equal(JSON.stringify(response).includes('SYNTHETIC_PRIVATE_DATA'), false);
});

await scenario('Clearing history serializes behind a diagnostic append and cannot resurrect old entries', async () => {
  const h = await harness();
  await h.start();
  await h.message({ type: 'PAUSE' });
  const captured = deferred();
  const release = deferred();
  const originalGet = h.chrome.storage.local.get;
  let intercept = true;
  h.chrome.storage.local.get = async key => {
    const value = await originalGet(key);
    if (key === 'logs' && intercept) {
      intercept = false;
      captured.resolve();
      await release.promise;
    }
    return value;
  };
  h.pageResult = async kind => kind === 'authorization' ? { elapsedMs: 1, ok: true, allowed: false }
    : { firstMs: 60, elapsedMs: 240, hidden: true };
  const diagnosing = h.message({ type: 'CHECK_TIMING' });
  await captured.promise;
  let clearCompleted = false;
  const clearing = h.message({ type: 'CLEAR_LOGS' }).then(value => { clearCompleted = true; return value; });
  await delay(5);
  const clearWaitedForAppend = !clearCompleted;
  release.resolve();
  await diagnosing;
  await clearing;
  assert.equal(clearWaitedForAppend, true);
  assert.equal(Object.hasOwn(h.state.local, 'logs'), false);
  assert.equal(h.state.session.job.enabled, false);
});

await scenario('Concurrent timing diagnostics retain all four bounded observations', async () => {
  const h = await harness();
  await h.start();
  await h.message({ type: 'PAUSE' });
  const originalLogCount = h.state.local.logs.length;
  h.pageResult = async kind => kind === 'authorization' ? { elapsedMs: 1, ok: true, allowed: false }
    : { firstMs: 60, elapsedMs: 240, hidden: true };
  const first = h.message({ type: 'CHECK_TIMING' });
  const second = h.message({ type: 'CHECK_TIMING' });
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.equal(h.state.local.logs.length, originalLogCount + 4);
  assert.equal(h.state.session.job.enabled, false);
});

await scenario('Already-running Resume repairs a lost heartbeat without resetting the current run', async () => {
  const h = await harness();
  await h.start({ intervalMinutes: 20 });
  const before = copy(h.state.session.job);
  h.state.alarms.delete(alarmName);
  const resumed = await h.message({ type: 'RESUME' });
  assert.equal(resumed.ok, true);
  assert.equal(h.state.alarms.get(alarmName)?.periodInMinutes, 1);
  for (const key of ['id', 'runId', 'phase', 'runDeadline', 'nextAt', 'prompt', 'queueIndex', 'sentCount']) {
    assert.deepEqual(h.state.session.job[key], before[key], `${key} must not reset during alarm repair`);
  }
  assert.equal(h.sends().length, 0, 'Repair must not submit immediately');
  await h.tick();
  assert.equal(h.sends().length, 1, 'The repaired alarm must drive the next scheduled round');
  await h.message({ type: 'PAUSE' });
});

await scenario('Failed Resume alarm creation revokes enabled state and a later Resume can recover', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  await h.message({ type: 'SEND_NOW' });
  await h.message({ type: 'PAUSE' });
  const before = copy(h.state.session.job);
  const create = h.chrome.alarms.create;
  h.chrome.alarms.create = async () => { throw new Error('Synthetic create failure'); };
  const failed = await h.message({ type: 'RESUME' });
  assert.equal(failed.ok, false);
  assert.equal(h.state.session.job.enabled, false, 'No enabled state without a usable heartbeat');
  assert.equal(h.state.local.resumeJob.enabled, false);
  assert.equal(h.state.session.job.nextAt, null);
  assert.equal(h.state.alarms.size, 0);
  for (const key of ['id', 'prompt', 'queue', 'queueIndex', 'sentCount', 'intervalMinutes']) {
    assert.deepEqual(h.state.session.job[key], before[key], `${key} must survive failed Resume`);
  }
  assert.equal(h.sends().length, 1);
  h.chrome.alarms.create = create;
  assert.equal((await h.message({ type: 'RESUME' })).ok, true);
  assert.equal(h.state.alarms.get(alarmName)?.periodInMinutes, 1);
  await h.tick();
  assert.equal(h.sends().length, 2);
  assert.equal(h.sends()[1].args[0].prompt, 'SYNTHETIC_SECOND');
  await h.message({ type: 'PAUSE' });
});

await scenario('Resume alarm lookup failure leaves the original task paused', async () => {
  const h = await harness();
  await h.start();
  await h.message({ type: 'PAUSE' });
  h.chrome.alarms.get = async () => { throw new Error('Synthetic lookup failure'); };
  assert.equal((await h.message({ type: 'RESUME' })).ok, false);
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.state.local.resumeJob.enabled, false);
  assert.equal(h.sends().length, 0);
});

await scenario('Resume rejects a resolved alarm creation with no periodic readback', async () => {
  const h = await harness();
  await h.start();
  await h.message({ type: 'PAUSE' });
  h.chrome.alarms.create = async () => {};
  assert.equal((await h.message({ type: 'RESUME' })).ok, false);
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.state.local.resumeJob.enabled, false);
  assert.equal(h.sends().length, 0);
});

await scenario('Already-running Resume replaces an invalid one-shot alarm', async () => {
  const h = await harness();
  await h.start();
  h.state.alarms.set(alarmName, { name: alarmName, scheduledTime: Date.now() + 60000 });
  assert.equal((await h.message({ type: 'RESUME' })).ok, true);
  assert.equal(h.state.alarms.get(alarmName)?.periodInMinutes, 1);
  assert.equal(h.sends().length, 0);
  await h.message({ type: 'PAUSE' });
});

await scenario('An already-enabled task is paused when its heartbeat cannot be repaired', async () => {
  const h = await harness();
  await h.start();
  h.state.alarms.delete(alarmName);
  h.chrome.alarms.create = async () => { throw new Error('Synthetic repair failure'); };
  assert.equal((await h.message({ type: 'RESUME' })).ok, false);
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.state.local.resumeJob.enabled, false);
  assert.equal(h.sends().length, 0);
});

await scenario('Pause during heartbeat repair wins and cannot trigger an immediate send', async () => {
  const h = await harness();
  await h.start();
  await h.message({ type: 'PAUSE' });
  const captured = deferred();
  const release = deferred();
  const create = h.chrome.alarms.create;
  h.chrome.alarms.create = async (...args) => {
    captured.resolve();
    await release.promise;
    return create(...args);
  };
  const resuming = h.message({ type: 'RESUME' });
  await captured.promise;
  const pausing = h.message({ type: 'PAUSE' });
  release.resolve();
  await resuming;
  assert.equal((await pausing).ok, true);
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.state.local.resumeJob.enabled, false);
  assert.equal(h.state.alarms.size, 0);
  assert.equal(h.sends().length, 0);
});

await scenario('Heartbeat repair keeps an actual in-flight send authorized and accounts for it once', async () => {
  const h = await harness();
  await h.start();
  const result = deferred();
  h.pageResult = async args => args.mode === 'send' ? result.promise : { status: 'ready' };
  const sending = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const before = copy(h.state.session.job);
  h.state.alarms.delete(alarmName);
  assert.equal((await h.message({ type: 'RESUME' })).ok, true);
  for (const key of ['runId', 'runDeadline', 'phase', 'nextAt', 'sentCount']) {
    assert.deepEqual(h.state.session.job[key], before[key]);
  }
  assert.equal((await h.message({ type: 'CHECK_RUN', runId: before.runId }, h.sender())).allowed, true);
  result.resolve({ status: 'sent' });
  assert.equal((await sending).job.sentCount, 1);
  assert.equal(h.sends().length, 1);
  await h.message({ type: 'PAUSE' });
});

for (const outcome of ['last-queue-item', 'stop-marker']) {
  await scenario(`Resume repair cannot undo intervening automatic pause: ${outcome}`, async () => {
    const h = await harness();
    await h.start(outcome === 'last-queue-item'
      ? { mode: 'queue-once', queue: [{ text: 'SYNTHETIC_ONLY_ITEM' }] } : {});
    const pageResult = deferred();
    h.pageResult = async () => pageResult.promise;
    const sending = h.message({ type: 'SEND_NOW' });
    await until(() => h.sends().length === 1);
    const captured = deferred();
    const release = deferred();
    const get = h.chrome.storage.session.get;
    let intercept = true;
    h.chrome.storage.session.get = async key => {
      const value = await get(key);
      if (key === 'job' && intercept) {
        intercept = false;
        captured.resolve();
        await release.promise;
      }
      return value;
    };
    const resuming = h.message({ type: 'RESUME' });
    await captured.promise;
    pageResult.resolve({ status: outcome === 'last-queue-item' ? 'sent' : 'done' });
    await delay(5);
    release.resolve();
    await resuming;
    await sending;
    assert.equal(h.state.session.job.enabled, false, 'Repair must not undo automatic completion/pause');
    assert.equal(h.state.local.resumeJob.enabled, false);
    assert.equal(h.state.alarms.size, 0);
    assert.equal(h.sends().length, 1);
  });
}

await scenario('Startup alarm readback failure preserves reachable Pause and later explicit repair', async () => {
  const first = await harness();
  await first.start();
  const h = await harness({ session: copy(first.state.session), local: copy(first.state.local), alarmCreateNoop: true });
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.state.local.resumeJob.enabled, false);
  assert.equal((await h.message({ type: 'PAUSE' })).ok, true);
  h.state.alarmCreateNoop = false;
  assert.equal((await h.message({ type: 'RESUME' })).ok, true);
  await h.tick();
  assert.equal(h.sends().length, 1);
  await h.message({ type: 'PAUSE' });
});

await scenario('Resume activation storage rejection revokes session authority before returning failure', async () => {
  const h = await harness();
  await h.start();
  await h.message({ type: 'PAUSE' });
  const set = h.chrome.storage.local.set;
  let rejectActivation = true;
  h.chrome.storage.local.set = async value => {
    if (value.resumeJob?.enabled && rejectActivation) {
      rejectActivation = false;
      throw new Error('Synthetic activation persistence failure');
    }
    return set(value);
  };
  assert.equal((await h.message({ type: 'RESUME' })).ok, false);
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.state.local.resumeJob.enabled, false);
  assert.equal(h.sends().length, 0);
});

await scenario('Failed Resume cannot retain a stale running recovery record when rollback storage rejects', async () => {
  const h = await harness();
  await h.start();
  await h.message({ type: 'PAUSE' });
  const set = h.chrome.storage.local.set;
  h.chrome.storage.local.set = async value => {
    if (value.resumeJob?.enabled === false) throw new Error('Synthetic rollback persistence failure');
    return set(value);
  };
  h.chrome.alarms.create = async () => { throw new Error('Synthetic alarm failure'); };
  assert.equal((await h.message({ type: 'RESUME' })).ok, false);
  assert.equal(h.state.session.job.enabled, false);
  assert.notEqual(h.state.local.resumeJob?.enabled, true, 'Stale running recovery must be invalidated');
  assert.equal(h.state.session.job.prompt, 'SYNTHETIC_CONTINUE');
  assert.equal(h.sends().length, 0);
});

await scenario('Already-enabled Resume reconciles a stale paused recovery record without resetting the run', async () => {
  const h = await harness();
  await h.start();
  const before = copy(h.state.session.job);
  h.state.local.resumeJob = { ...copy(before), enabled: false };
  assert.equal((await h.message({ type: 'RESUME' })).ok, true);
  assert.deepEqual(h.state.session.job, before);
  assert.deepEqual(h.state.local.resumeJob, before);
  assert.equal(h.sends().length, 0);
  await h.message({ type: 'PAUSE' });
});

await scenario('Alarm-clear failure cannot prevent Pause resource cleanup or revive sending', async () => {
  const h = await harness({ permissionGranted: true });
  await h.start({ keepAwake: true });
  h.chrome.alarms.clear = async () => { throw new Error('Synthetic clear failure'); };
  assert.equal((await h.message({ type: 'PAUSE' })).ok, true);
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.state.local.resumeJob.enabled, false);
  assert.equal(h.state.tabs.get(7).autoDiscardable, true);
  assert.equal(h.state.powerCalls.at(-1).method, 'release');
  assert.equal(h.state.session.job.autoDiscardableChanged, false);
  await h.tick({ due: false });
  assert.equal(h.sends().length, 0);
});

await scenario('Pause retains failed discard restoration ownership for a later cleanup attempt', async () => {
  const h = await harness();
  await h.start();
  h.beforeTabUpdate = async () => { throw new Error('Synthetic tab update failure'); };
  assert.equal((await h.message({ type: 'PAUSE' })).ok, true);
  assert.equal(h.state.tabs.get(7).autoDiscardable, false);
  assert.equal(h.state.session.job.autoDiscardableChanged, true);
  h.beforeTabUpdate = null;
  assert.equal((await h.message({ type: 'PAUSE' })).ok, true);
  assert.equal(h.state.tabs.get(7).autoDiscardable, true);
  assert.equal(h.state.session.job.autoDiscardableChanged, false);
});

await scenario('Resume cannot discard the restoration obligation left by a failed Pause cleanup', async () => {
  const h = await harness();
  await h.start();
  h.beforeTabUpdate = async () => { throw new Error('Synthetic tab update failure'); };
  await h.message({ type: 'PAUSE' });
  h.beforeTabUpdate = null;
  assert.equal((await h.message({ type: 'RESUME' })).ok, true);
  assert.equal((await h.message({ type: 'PAUSE' })).ok, true);
  assert.equal(h.state.tabs.get(7).autoDiscardable, true);
  assert.equal(h.state.session.job.autoDiscardableChanged, false);
});

await scenario('Delivery summaries persist typed write counters and long elapsed values without page content', async () => {
  const h = await harness(); await h.start();
  const privateText = 'SYNTHETIC_SECRET_PROMPT_URL_PATH';
  h.pageResult = async args => ({ status: 'sent', diagnosticProgress: {
    stage: 'receipt', reason: 'receipt-confirmed', counters: { fillCalls: 2, domWrites: 2, receiptChecks: 4, privateText },
    timings: { domWriteMs: 128000, maxDomWriteMs: 64000 }, observations: { hidden: true, sendEnabled: true, prompt: privateText },
    prompt: privateText, url: privateText, stack: privateText,
  } });
  const outcome = await h.message({ type: 'SEND_NOW' });
  assert.equal(outcome.job.sentCount, 1);
  const trace = h.state.local.deliveryDiagnostics.at(-1);
  assert.equal(trace.state, 'sent'); assert.equal(trace.counters.domWrites, 2);
  assert.equal(trace.counters.fillCalls, 2); assert.equal(trace.timings.domWriteMs, 128000);
  assert.equal(JSON.stringify(trace).includes(privateText), false);
  assert.equal(h.state.local.diagnosticsHealth.persistence, 'available');
  await h.message({ type: 'PAUSE' });
});
await scenario('A diagnostic persistence failure is visible but cannot block sending or Pause', async () => {
  const h = await harness(); await h.start();
  h.beforeStorageSet = async (name, value) => {
    if (name === 'local' && Object.hasOwn(value, 'deliveryDiagnostics')) throw new Error('SYNTHETIC_PRIVATE_STORAGE_ERROR');
  };
  assert.equal((await h.message({ type: 'SEND_NOW' })).job.sentCount, 1);
  assert.equal(h.state.session.diagnosticsHealth.persistence, 'degraded');
  assert.ok(h.state.session.diagnosticsHealth.writeFailures >= 1);
  assert.equal(JSON.stringify(h.state.session.diagnosticsHealth).includes('SYNTHETIC_PRIVATE'), false);
  assert.equal((await h.message({ type: 'PAUSE' })).job.enabled, false);
});
await scenario('Clear Logs fences an in-flight delivery snapshot so it cannot resurrect cleared history', async () => {
  const h = await harness(); await h.start(); const result = deferred();
  h.pageResult = args => args.mode === 'send' ? result.promise : { status: 'ready' };
  const sending = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  await h.message({ type: 'CLEAR_LOGS' });
  result.resolve({ status: 'sent' }); await sending;
  assert.equal(Object.hasOwn(h.state.local, 'deliveryDiagnostics'), false);
  assert.equal((await h.message({ type: 'PAUSE' })).job.enabled, false);
});
await scenario('Matching manual delivery consumes one queue item and limit without claiming an extension send', async () => {
  const h = await harness(); await h.start({ mode: 'queue-once', queue: [{ text: 'SYNTHETIC_CONTINUE' }, { text: 'SYNTHETIC_NEXT' }], maxSends: 1 });
  h.pageResult = async () => ({ status: 'manual-sent' });
  const { job } = await h.message({ type: 'SEND_NOW' });
  assert.equal(job.sentCount, 0); assert.equal(job.manualSentCount, 1);
  assert.equal(job.queueIndex, 1); assert.equal(job.enabled, false);
  assert.equal(h.sends().length, 1);
});
await scenario('A permanently pending diagnostics write cannot retain send completion or Pause authority', async () => {
  const h = await harness(); await h.start(); const writing = deferred();
  h.beforeStorageSet = (name, value) => name === 'local' && Object.hasOwn(value, 'deliveryDiagnostics') ? writing.promise : undefined;
  const sending = h.message({ type: 'SEND_NOW' });
  await until(() => h.state.session.job.phase === 'idle');
  assert.equal((await sending).job.sentCount, 1);
  assert.equal((await h.message({ type: 'PAUSE' })).job.enabled, false);
  const clearing = h.message({ type: 'CLEAR_LOGS' });
  assert.equal((await h.message({ type: 'PAUSE' })).job.enabled, false);
  await clearing; writing.resolve(); await delay(10);
  assert.equal(Object.hasOwn(h.state.local, 'deliveryDiagnostics'), false);
});
await scenario('Clear during diagnostic allocation fences the old delivery without preventing its authorized send', async () => {
  const h = await harness(); await h.start(); const reading = deferred(); let entered = false;
  h.beforeStorageGet = (name, key) => {
    if (name === 'local' && key === 'deliveryDiagnostics' && !entered) { entered = true; return reading.promise; }
  };
  const sending = h.message({ type: 'SEND_NOW' }); await until(() => entered);
  await h.message({ type: 'CLEAR_LOGS' }); reading.resolve();
  assert.equal((await sending).job.sentCount, 1); await delay(10);
  assert.equal(Object.hasOwn(h.state.local, 'deliveryDiagnostics'), false);
  await h.message({ type: 'PAUSE' });
});
await scenario('Exhausted diagnostic sequence degrades logging rather than stranding the live send', async () => {
  const h = await harness({ local: { deliveryDiagnostics: [{ sequence: Number.MAX_SAFE_INTEGER }] } }); await h.start();
  const outcome = await h.message({ type: 'SEND_NOW' });
  assert.equal(outcome.job.sentCount, 1); assert.equal(outcome.job.phase, 'idle');
  assert.equal(h.state.session.diagnosticsHealth.persistence, 'degraded');
  assert.equal((await h.message({ type: 'PAUSE' })).job.enabled, false);
});
await scenario('A new diagnostic epoch cannot merge old history while Clear Logs removal is pending', async () => {
  const h = await harness(); await h.start();
  await h.message({ type: 'SEND_NOW' }); await until(() => h.state.local.deliveryDiagnostics?.at(-1)?.state === 'sent');
  const oldSequence = h.state.local.deliveryDiagnostics.at(-1).sequence;
  const removal = deferred(); let removing = false;
  h.beforeStorageRemove = (name, keys) => {
    if (name === 'local' && Array.isArray(keys) && keys.includes('deliveryDiagnostics')) { removing = true; return removal.promise; }
  };
  const clearing = h.message({ type: 'CLEAR_LOGS' }); await until(() => removing);
  assert.equal((await h.message({ type: 'SEND_NOW' })).job.sentCount, 2, 'Diagnostic clear cannot block the next authorized delivery');
  removal.resolve(); await clearing;
  await until(() => h.state.local.deliveryDiagnostics?.at(-1)?.state === 'sent');
  assert.deepEqual(h.state.local.deliveryDiagnostics.map(item => item.sequence), [oldSequence + 1]);
  await h.message({ type: 'PAUSE' });
});
await scenario('A retired diagnostic write cannot restore cleared history or health metadata', async () => {
  const h = await harness(); await h.start(); const writing = deferred(); let entered = false;
  h.beforeStorageSet = (name, value) => {
    if (name === 'local' && Object.hasOwn(value, 'deliveryDiagnostics')) { entered = true; return writing.promise; }
  };
  await h.message({ type: 'SEND_NOW' }); await until(() => entered);
  await delay(2100);
  assert.equal(h.state.session.diagnosticsHealth.persistence, 'degraded');
  await h.message({ type: 'CLEAR_LOGS' }); writing.resolve(); await delay(15);
  assert.equal(Object.hasOwn(h.state.local, 'deliveryDiagnostics'), false);
  assert.equal(Object.hasOwn(h.state.local, 'diagnosticsHealth'), false);
  assert.equal(Object.hasOwn(h.state.session, 'diagnosticsHealth'), false);
  await h.message({ type: 'PAUSE' });
});
await scenario('Clear fences a pending health write without retaining the Pause queue', async () => {
  const h = await harness(); await h.start(); const healthWrite = deferred(); let entered = false;
  h.beforeStorageGet = (name, key) => { if (name === 'local' && key === 'deliveryDiagnostics') throw new Error('SYNTHETIC_READ_FAILURE'); };
  h.beforeStorageSet = (name, value) => {
    if (name === 'session' && Object.hasOwn(value, 'diagnosticsHealth')) { entered = true; return healthWrite.promise; }
  };
  assert.equal((await h.message({ type: 'SEND_NOW' })).job.sentCount, 1); await until(() => entered);
  const clearing = h.message({ type: 'CLEAR_LOGS' });
  assert.equal((await h.message({ type: 'PAUSE' })).job.enabled, false);
  healthWrite.resolve(); await clearing;
  assert.equal(Object.hasOwn(h.state.session, 'diagnosticsHealth'), false);
});
await scenario('Clear Data diagnostic removal stays outside the shared control transaction', async () => {
  const h = await harness(); await h.start(); const removal = deferred(); let entered = false;
  h.beforeStorageRemove = (name, keys) => {
    if (name === 'local' && Array.isArray(keys) && keys.includes('deliveryDiagnostics')) { entered = true; return removal.promise; }
  };
  const clearing = h.message({ type: 'CLEAR_DATA' }); await until(() => entered);
  let paused = false;
  const pausing = h.message({ type: 'PAUSE' }).then(() => { paused = true; });
  await delay(15);
  try { assert.equal(paused, true); } finally { removal.resolve(); await clearing; await pausing; }
});
await scenario('A pending diagnostics GET_STATE read cannot retain the Pause queue', async () => {
  const h = await harness(); await h.start(); const reading = deferred(); let entered = false;
  h.beforeStorageGet = (name, keys) => {
    if (name === 'local' && Array.isArray(keys) && keys.includes('deliveryDiagnostics')) { entered = true; return reading.promise; }
  };
  const observing = h.message({ type: 'GET_STATE' }); await until(() => entered);
  assert.equal((await h.message({ type: 'PAUSE' })).job.enabled, false);
  reading.resolve();
  assert.equal((await observing).job.enabled, false, 'Delayed diagnostics cannot return the earlier running task after Pause');
});
await scenario('Back-to-back deliveries drain their final snapshots without a subsequent producer', async () => {
  const h = await harness(); await h.start();
  for (let index = 0; index < 5; index++) assert.equal((await h.message({ type: 'SEND_NOW' })).job.sentCount, index + 1);
  await until(() => h.state.local.deliveryDiagnostics?.filter(item => item.state === 'sent').length === 5);
  assert.equal(h.state.local.deliveryDiagnostics.at(-1).state, 'sent');
  await h.message({ type: 'PAUSE' });
});
await scenario('An activity-log storage rejection cannot turn a committed Start into a failed response', async () => {
  for (const failure of ['get', 'set']) {
    const h = await harness();
    h.beforeStorageGet = (name, key) => {
      if (failure === 'get' && name === 'local' && key === 'logs') throw new Error('SYNTHETIC_ACTIVITY_FAILURE');
    };
    h.beforeStorageSet = (name, value) => {
      if (failure === 'set' && name === 'local' && Object.hasOwn(value, 'logs')) throw new Error('SYNTHETIC_ACTIVITY_FAILURE');
    };
    const response = await h.message({ type: 'START', tabId: 7, config: { prompt: 'SYNTHETIC_CONTINUE' } });
    const delivery = response.ok ? await h.message({ type: 'SEND_NOW' }) : null;
    const stopped = await h.message({ type: 'PAUSE' });
    assert.equal(response.ok, true, 'Activity persistence is not task authority');
    assert.equal(delivery.job.sentCount, 1, 'Log rejection cannot discard a confirmed delivery');
    assert.equal(stopped.job.enabled, false);
  }
});
await scenario('A permanently pending activity write cannot retain send completion or the Pause queue', async () => {
  const h = await harness(); await h.start(); const writing = deferred(); let entered = false;
  h.beforeStorageSet = (name, value) => {
    if (name === 'local' && Object.hasOwn(value, 'logs')) { entered = true; return writing.promise; }
  };
  const sending = h.message({ type: 'SEND_NOW' }); await until(() => entered);
  let paused = false;
  const pausing = h.message({ type: 'PAUSE' }).then(response => { paused = response.job.enabled === false; return response; });
  const response = await Promise.race([sending, delay(800).then(() => null)]);
  await delay(300);
  const pausedBeforeStorageReturned = paused;
  writing.resolve(); await sending; await pausing;
  assert.equal(response?.job?.sentCount, 1, 'Completed send must not depend on its log write');
  assert.equal(pausedBeforeStorageReturned, true, 'Pause must finish while diagnostic storage is still pending');
});
await scenario('A pending activity read cannot block immediate Start or restore history after Clear Logs', async () => {
  const h = await harness(); const reading = deferred(); let entered = false;
  h.beforeStorageGet = (name, key) => {
    if (name === 'local' && key === 'logs' && !entered) { entered = true; return reading.promise; }
  };
  const response = await h.message({ type: 'START', tabId: 7, config: { prompt: 'SYNTHETIC_CONTINUE', startImmediately: true } });
  assert.equal(response.ok, true); assert.equal(response.job.sentCount, 1);
  assert.equal(h.state.session.diagnosticsHealth.persistence, 'degraded');
  await h.message({ type: 'CLEAR_LOGS' });
  reading.resolve(); await delay(10);
  assert.equal(Object.hasOwn(h.state.local, 'logs'), false);
  assert.equal(Object.hasOwn(h.state.session, 'diagnosticsHealth'), false);
  await h.message({ type: 'PAUSE' });
  await until(() => h.state.local.logs?.length === 1);
  assert.equal(h.state.local.logs[0].event, 'paused');
});
await scenario('A late activity write cannot resurrect a cleared event or delete the new epoch record', async () => {
  const h = await harness(); await h.start(); const writing = deferred(); let entered = false;
  h.beforeStorageSet = (name, value) => {
    if (name === 'local' && Object.hasOwn(value, 'logs') && !entered) { entered = true; return writing.promise; }
  };
  assert.equal((await h.message({ type: 'SEND_NOW' })).job.sentCount, 1);
  await h.message({ type: 'CLEAR_LOGS' });
  assert.equal((await h.message({ type: 'PAUSE' })).job.enabled, false);
  writing.resolve();
  await until(() => h.state.local.logs?.length === 1);
  assert.equal(h.state.local.logs[0].event, 'paused');
});
await scenario('An activity drain waiting on an older Clear barrier waits for the latest removal', async () => {
  const h = await harness(); await h.start();
  const firstRemoval = deferred(), secondRemoval = deferred();
  let removals = 0, diagnosticRemovals = 0, writes = 0, writesBeforeSecondRemoval;
  h.beforeStorageRemove = (name, keys) => {
    if (name !== 'local') return;
    if (Array.isArray(keys) && keys.includes('deliveryDiagnostics')) diagnosticRemovals++;
    if (keys === 'logs') return ++removals === 1 ? firstRemoval.promise : secondRemoval.promise;
  };
  h.beforeStorageSet = (name, value) => {
    if (name === 'local' && Object.hasOwn(value, 'logs')) writes++;
  };
  const clearing = [];
  try {
    clearing.push(h.message({ type: 'CLEAR_LOGS' }));
    await until(() => removals === 1);
    assert.equal((await h.message({ type: 'PAUSE' })).job.enabled, false);
    clearing.push(h.message({ type: 'CLEAR_LOGS' }));
    await until(() => diagnosticRemovals === 2, 'second Clear epoch cutover');
    assert.equal((await h.message({ type: 'RESUME' })).job.enabled, true);
    firstRemoval.resolve();
    await until(() => removals === 2);
    await delay(10);
    writesBeforeSecondRemoval = writes;
  } finally {
    firstRemoval.resolve(); secondRemoval.resolve();
    await Promise.all(clearing);
  }
  await delay(10);
  const retained = copy(h.state.local.logs);
  await h.message({ type: 'PAUSE' });
  assert.equal(writesBeforeSecondRemoval, 0, 'A current-epoch append must not overtake the latest Clear removal');
  assert.deepEqual(retained?.map(entry => entry.event), ['resumed'], 'The post-Clear event must survive both removals');
});
await scenario('Diagnostic health coalesces failures behind a pending session write to the latest count', async () => {
  const h = await harness(); await h.start();
  const writing = deferred(), writes = [];
  h.beforeStorageGet = (name, key) => {
    if (name === 'local' && key === 'logs') throw new Error('SYNTHETIC_ACTIVITY_FAILURE');
  };
  h.beforeStorageSet = (name, value) => {
    if (name === 'session' && Object.hasOwn(value, 'diagnosticsHealth')) {
      writes.push(copy(value.diagnosticsHealth));
      if (writes.length === 1) return writing.promise;
    }
  };
  try {
    for (let index = 0; index < 32; index++) assert.equal((await h.message({ type: 'PAUSE' })).job.enabled, false);
    assert.equal(writes.length, 1, 'Only one health write may be in flight');
  } finally { writing.resolve(); }
  await until(() => h.state.session.diagnosticsHealth?.writeFailures === 32, 'latest coalesced health count');
  assert.deepEqual(writes.map(value => value.writeFailures), [1, 32], 'Intermediate failure snapshots must not accumulate behind stalled storage');
  assert.equal(writes.at(-1).persistence, 'degraded');
  h.beforeStorageGet = undefined;
  await h.message({ type: 'CLEAR_LOGS' });
  assert.equal(Object.hasOwn(h.state.session, 'diagnosticsHealth'), false);
});
await scenario('Clear retires coalesced old health while preserving failures from the new epoch', async () => {
  const h = await harness(); await h.start();
  const writing = deferred(), writes = [];
  let activityRemovals = 0, healthRemovals = 0, clearCompleted = false;
  h.beforeStorageGet = (name, key) => {
    if (name === 'local' && key === 'logs') throw new Error('SYNTHETIC_ACTIVITY_FAILURE');
  };
  h.beforeStorageSet = (name, value) => {
    if (name === 'session' && Object.hasOwn(value, 'diagnosticsHealth')) {
      writes.push({ ...copy(value.diagnosticsHealth), healthRemovals });
      if (writes.length === 1) return writing.promise;
    }
  };
  h.beforeStorageRemove = (name, keys) => {
    if (name === 'local' && keys === 'logs') activityRemovals++;
    if (name === 'session' && keys === 'diagnosticsHealth') healthRemovals++;
  };
  let clearing;
  try {
    for (let index = 0; index < 5; index++) await h.message({ type: 'PAUSE' });
    assert.equal(writes.length, 1);
    clearing = h.message({ type: 'CLEAR_LOGS' }).then(response => { clearCompleted = true; return response; });
    await until(() => activityRemovals === 1, 'Clear epoch cutover while health write is pending');
    for (let index = 0; index < 3; index++) assert.equal((await h.message({ type: 'PAUSE' })).job.enabled, false);
    assert.equal(clearCompleted, false, 'Clear must still fence the admitted old health write');
    assert.equal(writes.length, 1, 'New health must wait for old-write cleanup');
  } finally {
    writing.resolve();
    if (clearing) await clearing;
  }
  await until(() => h.state.session.diagnosticsHealth?.writeFailures === 3, 'new-epoch failure count');
  assert.deepEqual(writes.map(value => value.writeFailures), [1, 3], 'Clear must discard the unsent old count and reset the new count');
  assert.equal(writes[1].healthRemovals, 1, 'The new health write must follow old-epoch cleanup');
  h.beforeStorageGet = undefined;
  await h.message({ type: 'CLEAR_LOGS' });
  assert.equal(Object.hasOwn(h.state.session, 'diagnosticsHealth'), false);
});
await scenario('A health drain waiting on an older Clear barrier preserves the latest epoch health', async () => {
  const h = await harness(); await h.start();
  const firstRemoval = deferred(), secondRemoval = deferred(), writes = [];
  let diagnosticRemovals = 0, activityRemovals = 0, writesBeforeSecondRemoval;
  h.beforeStorageGet = (name, key) => {
    if (name === 'local' && key === 'logs') throw new Error('SYNTHETIC_ACTIVITY_FAILURE');
  };
  h.beforeStorageSet = (name, value) => {
    if (name === 'session' && Object.hasOwn(value, 'diagnosticsHealth')) writes.push(copy(value.diagnosticsHealth));
  };
  h.beforeStorageRemove = (name, keys) => {
    if (name !== 'local') return;
    if (keys === 'logs') activityRemovals++;
    if (Array.isArray(keys) && keys.includes('deliveryDiagnostics')) {
      return ++diagnosticRemovals === 1 ? firstRemoval.promise : secondRemoval.promise;
    }
  };
  const clearing = [];
  try {
    clearing.push(h.message({ type: 'CLEAR_LOGS' }));
    await until(() => diagnosticRemovals === 1);
    await h.message({ type: 'PAUSE' });
    clearing.push(h.message({ type: 'CLEAR_LOGS' }));
    await until(() => activityRemovals === 2, 'second health epoch cutover');
    for (let index = 0; index < 3; index++) await h.message({ type: 'PAUSE' });
    firstRemoval.resolve();
    await until(() => diagnosticRemovals === 2);
    await delay(10);
    writesBeforeSecondRemoval = writes.length;
  } finally {
    firstRemoval.resolve(); secondRemoval.resolve();
    await Promise.all(clearing);
  }
  await until(() => h.state.session.diagnosticsHealth?.writeFailures === 3, 'health after both Clear barriers');
  assert.equal(writesBeforeSecondRemoval, 0, 'Health must not overtake the latest Clear removal');
  assert.deepEqual(writes.map(value => value.writeFailures), [3]);
  h.beforeStorageGet = undefined;
  await h.message({ type: 'CLEAR_LOGS' });
});
for (const rejectFirst of [false, true]) {
  await scenario(`A delivery drain rechecks the latest Clear barrier after an older removal ${rejectFirst ? 'rejects' : 'resolves'}`, async () => {
    const h = await harness(); await h.start();
    assert.equal((await h.message({ type: 'SEND_NOW' })).job.sentCount, 1);
    await until(() => h.state.local.deliveryDiagnostics?.at(-1)?.state === 'sent');
    const oldSequence = h.state.local.deliveryDiagnostics.at(-1).sequence;
    const firstRemoval = deferred(), secondRemoval = deferred();
    let diagnosticRemovals = 0, activityRemovals = 0, writes = 0, writesBeforeSecondRemoval;
    h.beforeStorageRemove = (name, keys) => {
      if (name !== 'local') return;
      if (keys === 'logs') activityRemovals++;
      if (Array.isArray(keys) && keys.includes('deliveryDiagnostics')) {
        return ++diagnosticRemovals === 1 ? firstRemoval.promise : secondRemoval.promise;
      }
    };
    h.beforeStorageSet = (name, value) => {
      if (name === 'local' && Object.hasOwn(value, 'deliveryDiagnostics')) writes++;
    };
    const clearing = [];
    try {
      clearing.push(h.message({ type: 'CLEAR_LOGS' }));
      await until(() => diagnosticRemovals === 1);
      assert.equal((await h.message({ type: 'SEND_NOW' })).job.sentCount, 2);
      clearing.push(h.message({ type: 'CLEAR_LOGS' }));
      await until(() => activityRemovals === 2, 'second delivery epoch cutover');
      assert.equal((await h.message({ type: 'SEND_NOW' })).job.sentCount, 3);
      if (rejectFirst) firstRemoval.reject(new Error('SYNTHETIC_CLEAR_FAILURE'));
      else firstRemoval.resolve();
      await until(() => diagnosticRemovals === 2);
      await delay(10);
      writesBeforeSecondRemoval = writes;
    } finally {
      firstRemoval.resolve(); secondRemoval.resolve();
      await Promise.all(clearing);
    }
    await delay(10);
    const retained = copy(h.state.local.deliveryDiagnostics);
    await h.message({ type: 'PAUSE' });
    assert.equal(writesBeforeSecondRemoval, 0, 'A current-epoch delivery snapshot must not overtake the latest Clear removal');
    assert.deepEqual(retained?.map(trace => ({ sequence: trace.sequence, state: trace.state })),
      [{ sequence: oldSequence + 2, state: 'sent' }], 'The latest epoch trace must survive without another producer');
    assert.equal(h.sends().length, 3, 'Clear barriers must not block or repeat authorized deliveries');
  });
}
const failed = results.filter(result => result.status === 'FAIL');
console.log(`RESULT ${results.length - failed.length}/${results.length} background v2 scenarios passed`);
for (const result of failed) console.error(result.error);
process.exitCode = failed.length ? 1 : 0;
