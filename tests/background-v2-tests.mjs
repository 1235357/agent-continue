// Synthetic fixtures only. This suite never reads a user prompt or upload.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.EXTENSION_ROOT || path.dirname(here));
const { setLanguage } = await import(pathToFileURL(path.join(root, 'i18n.js')));
const { DEFAULT_CONFIG, inQuietHours, readConfig } = await import(pathToFileURL(path.join(root, 'config.js')));
const { buildActivityExport } = await import(pathToFileURL(path.join(root, 'activity-export.js')));
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
    injections: [], tabUpdates: [], tabGets: [], accessLevels: [], powerCalls: [], broadcasts: [],
    permissionGranted: seed.permissionGranted ?? false,
    alarmCreateNoop: seed.alarmCreateNoop ?? false,
  };
  const area = name => ({
    async get(key) { await h.beforeStorageGet?.(name, key); return Object.fromEntries((Array.isArray(key) ? key : [key]).map(item => [item, copy(state[name][item])])); },
    async set(value) { await h.beforeStorageSet?.(name, value); Object.assign(state[name], copy(value)); },
    async remove(key) { await h.beforeStorageRemove?.(name, key); for (const item of Array.isArray(key) ? key : [key]) delete state[name][item]; },
    async setAccessLevel(value) { state.accessLevels.push({ area: name, ...value }); },
  });
  const storageChanges = event();
  const localArea = area('local');
  const setLocal = localArea.set;
  localArea.set = async value => {
    const previous = copy(state.local);
    await setLocal(value);
    storageChanges.emit(Object.fromEntries(Object.keys(value).map(key => [key, { oldValue: previous[key], newValue: copy(state.local[key]) }])), 'local');
  };
  const chrome = {
    storage: { session: area('session'), local: localArea, onChanged: storageChanges },
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
    runtime: { id: 'synthetic-extension', getURL: name => 'chrome-extension://synthetic/' + name, onMessage: event(), onStartup: event(), async sendMessage(message) { state.broadcasts.push(copy(message)); } }, commands: { onCommand: event() },
  };
  const h = {
    state, chrome,
    beforeStorageGet: seed.beforeStorageGet, beforeStorageSet: seed.beforeStorageSet,
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
  if (!seed.skipReady) assert.equal((await h.message({ type: 'GET_STATE' })).ok, true);
  return h;
}

async function scenario(name, body) {
  try { await body(); results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, status: 'FAIL', error: error.stack }); console.error(`FAIL ${name}: ${error.message}`); }
}

await scenario('A Clear serializes with issued draft writes while Pause remains available', async () => {
  const h = await harness();
  const initial = await h.message({ type: 'GET_STATE' });
  assert.equal(initial.ok, true);
  assert.equal(typeof initial.draftGeneration, 'string');
  const entered = deferred(), release = deferred();
  h.beforeStorageSet = async (name, value) => {
    if (name === 'local' && value.config?.prompt === 'SYNTHETIC_DELAYED_DRAFT') {
      entered.resolve();
      await release.promise;
    }
  };
  const save = h.message({ type: 'SAVE_DRAFT', generation: initial.draftGeneration, revision: initial.draftRevision,
    base: initial.config, config: { ...DEFAULT_CONFIG, prompt: 'SYNTHETIC_DELAYED_DRAFT' } });
  const arrival = await Promise.race([entered.promise.then(() => true), delay(1000).then(() => false)]);
  if (!arrival) { release.resolve(); await save; }
  assert.equal(arrival, true, 'The delayed save must reach actual persistence');
  const clear = h.message({ type: 'CLEAR_DATA' });
  const cleared = await Promise.race([clear, delay(1000).then(() => null)]);
  assert.equal(cleared, null, 'Clear must not acknowledge before the issued write settles');
  assert.equal((await h.message({ type: 'PAUSE' })).ok, true);
  release.resolve();
  const stale = await save;
  assert.equal(stale.ok, false);
  assert.equal((await clear).ok, true);
  assert.notEqual(h.state.local.config?.prompt, 'SYNTHETIC_DELAYED_DRAFT');
  const current = await h.message({ type: 'GET_STATE' });
  assert.equal(current.ok, true);
  assert.notEqual(current.draftGeneration, initial.draftGeneration);
  assert.notEqual(current.config?.prompt, 'SYNTHETIC_DELAYED_DRAFT');
  const fresh = await h.message({ type: 'SAVE_DRAFT', generation: current.draftGeneration, revision: current.draftRevision,
    base: current.config, config: { ...DEFAULT_CONFIG, prompt: 'SYNTHETIC_NEW_DRAFT' } });
  assert.equal(fresh.ok, true);
  assert.equal(h.state.local.config.prompt, 'SYNTHETIC_NEW_DRAFT');
});

await scenario('Clear fences issued template writes and rejects stale template operations', async () => {
  const h = await harness();
  const initial = await h.message({ type: 'GET_STATE' });
  const template = { id: 'synthetic-id', name: 'SYNTHETIC_TEMPLATE_NAME', prompt: 'SYNTHETIC_TEMPLATE_BODY', queue: [], mode: 'repeat' };
  const entered = deferred(), release = deferred();
  h.beforeStorageSet = async (area, value) => {
    if (area === 'local' && value.templates) { entered.resolve(); await release.promise; }
  };
  const saving = h.message({ type: 'SAVE_TEMPLATES', generation: initial.draftGeneration, base: [], templates: [template] });
  const arrived = await Promise.race([entered.promise.then(() => true), saving.then(() => false), delay(1000).then(() => false)]);
  if (!arrived) { release.resolve(); await saving; }
  assert.equal(arrived, true, 'The template operation must reach actual persistence');
  const clearing = h.message({ type: 'CLEAR_DATA' });
  assert.equal(await Promise.race([clearing.then(() => false), delay(1000).then(() => true)]), true);
  assert.equal((await h.message({ type: 'PAUSE' })).ok, true);
  release.resolve();
  assert.equal((await saving).ok, false);
  assert.equal((await clearing).ok, true);
  assert.equal(h.state.local.templates, undefined);
  assert.equal((await h.message({ type: 'SAVE_TEMPLATES', generation: initial.draftGeneration, base: [], templates: [template] })).ok, false);
  assert.equal(h.state.local.templates, undefined);
});

await scenario('Template writes reject an outdated base without discarding a newer template', async () => {
  const h = await harness();
  const initial = await h.message({ type: 'GET_STATE' });
  const one = { id: 'one', name: 'SYNTHETIC_ONE', prompt: 'ONE', queue: [], mode: 'repeat' };
  const two = { id: 'two', name: 'SYNTHETIC_TWO', prompt: 'TWO', queue: [], mode: 'repeat' };
  const saved = await h.message({ type: 'SAVE_TEMPLATES', generation: initial.draftGeneration, base: [], templates: [one] });
  assert.equal(saved.ok, true);
  const stale = await h.message({ type: 'SAVE_TEMPLATES', generation: initial.draftGeneration, base: [], templates: [two] });
  assert.equal(stale.ok, false);
  assert.deepEqual(h.state.local.templates, [one]);
  const next = await h.message({ type: 'SAVE_TEMPLATES', generation: initial.draftGeneration, base: [one], templates: [one, two] });
  assert.equal(next.ok, true);
  assert.deepEqual(h.state.local.templates, [one, two]);
});

await scenario('Template saves reject requests from another extension identity', async () => {
  const h = await harness();
  const initial = await h.message({ type: 'GET_STATE' });
  const template = { id: 'synthetic', name: 'synthetic', prompt: 'SYNTHETIC_PRIVATE', queue: [], mode: 'repeat' };
  const response = await h.message({ type: 'SAVE_TEMPLATES', generation: initial.draftGeneration, base: [], templates: [template] },
    { id: 'foreign-extension', url: 'chrome-extension://foreign/popup.html' });
  assert.equal(response.ok, false);
  assert.equal(h.state.local.templates, undefined);
});

await scenario('A failed template deletion keeps configuration and templates unavailable', async () => {
  const h = await harness();
  const initial = await h.message({ type: 'GET_STATE' });
  const template = { id: 'synthetic', name: 'synthetic', prompt: 'SYNTHETIC_PRIVATE', queue: [], mode: 'repeat' };
  assert.equal((await h.message({ type: 'SAVE_TEMPLATES', generation: initial.draftGeneration, base: [], templates: [template] })).ok, true);
  h.beforeStorageRemove = async (area, key) => {
    if (area === 'local' && key === 'templates') throw new Error('SYNTHETIC_TEMPLATE_CLEAR_FAILURE');
  };
  assert.equal((await h.message({ type: 'CLEAR_DATA' })).ok, false);
  const state = await h.message({ type: 'GET_STATE' });
  assert.equal(state.configAvailable, false);
  assert.equal((await h.message({ type: 'SAVE_TEMPLATES', generation: state.draftGeneration, base: [template], templates: [] })).ok, false);
  assert.equal((await h.message({ type: 'PAUSE' })).ok, true);
  h.beforeStorageRemove = null;
  assert.equal((await h.message({ type: 'CLEAR_DATA' })).ok, true);
  assert.equal(h.state.local.templates, undefined);
});

await scenario('Draft panel can continue an edit after a worker restart without accepting a pre-clear draft', async () => {
  const first = await harness();
  const initial = await first.message({ type: 'GET_STATE' });
  const config = { ...initial.config, prompt: 'SYNTHETIC_REOPEN_DRAFT' };
  const saved = await first.message({ type: 'SAVE_DRAFT', generation: initial.draftGeneration,
    revision: initial.draftRevision, base: initial.config, config });
  assert.equal(saved.ok, true);

  const restarted = await harness({ local: copy(first.state.local), session: copy(first.state.session) });
  const mode = { ...config, startImmediately: true };
  const next = await restarted.message({ type: 'SAVE_DRAFT', generation: saved.draftGeneration,
    revision: saved.draftRevision, base: config, config: mode });
  assert.equal(next.ok, true, 'A still-open panel does not lose its draft version on worker wake.');
  assert.equal((await restarted.message({ type: 'GET_STATE' })).config.startImmediately, true);
  assert.equal((await restarted.message({ type: 'CLEAR_DATA' })).ok, true);

  const afterClear = await harness({ local: copy(restarted.state.local), session: copy(restarted.state.session) });
  const cleared = await afterClear.message({ type: 'GET_STATE' });
  assert.notEqual(cleared.draftGeneration, next.draftGeneration);
  const stale = await afterClear.message({ type: 'SAVE_DRAFT', generation: next.draftGeneration,
    revision: cleared.draftRevision, base: cleared.config, config });
  assert.equal(stale.conflict, true);
  assert.equal((await afterClear.message({ type: 'GET_STATE' })).config.prompt, '');
});

await scenario('A failed Clear remains fenced after a worker restart', async () => {
  const h = await harness();
  const initial = await h.message({ type: 'GET_STATE' });
  assert.equal((await h.message({ type: 'SAVE_DRAFT', generation: initial.draftGeneration, revision: initial.draftRevision,
    base: initial.config, config: { ...DEFAULT_CONFIG, prompt: 'SYNTHETIC_FAILED_CLEAR_PRIVATE' } })).ok, true);
  h.beforeStorageRemove = async (area, key) => {
    if (area === 'local' && key === 'config') throw new Error('SYNTHETIC_RESTART_CLEAR_FAILURE');
  };
  assert.equal((await h.message({ type: 'CLEAR_DATA' })).ok, false);
  const restarted = await harness({ local: copy(h.state.local), session: copy(h.state.session) });
  const after = await restarted.message({ type: 'GET_STATE' });
  assert.ok(after.configAvailable === false || after.config?.prompt === '', 'Restart must not expose the unsuccessfully cleared private draft');
  assert.equal(restarted.state.local.draftClearPending, true);
  assert.equal((await restarted.message({ type: 'PREPARE_START' })).ok, false);
  assert.equal((await restarted.message({ type: 'PAUSE' })).ok, true);
  assert.equal((await restarted.message({ type: 'CLEAR_DATA' })).ok, true);
  assert.equal(restarted.state.local.draftClearPending, undefined);
  assert.equal((await restarted.message({ type: 'GET_STATE' })).config.prompt, '');
});

await scenario('A Clear issued during pending startup cannot expose a retained private draft', async () => {
  const entered = deferred(), release = deferred();
  const h = await harness({ skipReady: true, local: { config: { ...DEFAULT_CONFIG, prompt: 'SYNTHETIC_STARTUP_PRIVATE' } },
    beforeStorageGet: async (area, key) => {
      if (area === 'local' && key === 'resumeJob') { entered.resolve(); await release.promise; }
    } });
  const arrived = await Promise.race([entered.promise.then(() => true), delay(1000).then(() => false)]);
  if (!arrived) release.resolve();
  assert.equal(arrived, true);
  const clearing = h.message({ type: 'CLEAR_DATA' });
  release.resolve();
  assert.equal((await clearing).ok, true);
  const state = await h.message({ type: 'GET_STATE' });
  assert.equal(state.configAvailable, true);
  assert.equal(state.config.prompt, '');
});

await scenario('A stalled persistent clear marker cannot prevent Pause from completing', async () => {
  const h = await harness();
  await h.start({ prompt: 'SYNTHETIC_RUNNING_MARKER_TEST' });
  const entered = deferred(), release = deferred();
  h.beforeStorageSet = async (area, value) => {
    if (area === 'local' && value.draftClearPending === true) { entered.resolve(); await release.promise; }
  };
  const clearing = h.message({ type: 'CLEAR_DATA' });
  const arrived = await Promise.race([entered.promise.then(() => true), clearing.then(() => false), delay(1000).then(() => false)]);
  if (!arrived) { release.resolve(); await clearing; }
  assert.equal(arrived, true);
  const pausing = h.message({ type: 'PAUSE' });
  const paused = await Promise.race([pausing, delay(1000).then(() => null)]);
  release.resolve();
  await clearing;
  await pausing;
  assert.equal(paused?.ok, true, 'Pause must not wait for persistent clear-marker storage');
});

await scenario('A failed history removal retains the restart clear fence until a successful retry', async () => {
  const h = await harness();
  h.beforeStorageRemove = async (area, key) => {
    if (area === 'local' && key === 'logs') throw new Error('SYNTHETIC_HISTORY_CLEAR_FAILURE');
  };
  assert.equal((await h.message({ type: 'CLEAR_DATA' })).ok, false);
  assert.equal(h.state.local.draftClearPending, true);
  const restarted = await harness({ local: copy(h.state.local), session: copy(h.state.session) });
  assert.equal((await restarted.message({ type: 'GET_STATE' })).configAvailable, false);
  assert.equal((await restarted.message({ type: 'CLEAR_DATA' })).ok, true);
  assert.equal(restarted.state.local.draftClearPending, undefined);
  assert.equal((await restarted.message({ type: 'GET_STATE' })).configAvailable, true);
});

await scenario('Overlapping Clears cannot lose a later failed clear fence', async () => {
  const h = await harness();
  const entered = deferred(), release = deferred();
  let writes = 0;
  h.beforeStorageSet = async (area, value) => {
    if (area === 'local' && value.draftClearPending === true && ++writes === 1) {
      entered.resolve();
      await release.promise;
    }
  };
  const first = h.message({ type: 'CLEAR_DATA' });
  const arrived = await Promise.race([entered.promise.then(() => true), first.then(() => false), delay(1000).then(() => false)]);
  if (!arrived) { release.resolve(); await first; }
  assert.equal(arrived, true);
  const second = h.message({ type: 'CLEAR_DATA' });
  release.resolve();
  assert.equal((await first).ok, true);
  h.beforeStorageRemove = async (area, key) => {
    if (area === 'local' && key === 'config') throw new Error('SYNTHETIC_SECOND_CLEAR_FAILURE');
  };
  assert.equal((await second).ok, false);
  const state = await h.message({ type: 'GET_STATE' });
  assert.equal(state.configAvailable, false);
  assert.equal(h.state.local.draftClearPending, true);
  h.beforeStorageRemove = null;
  assert.equal((await h.message({ type: 'CLEAR_DATA' })).ok, true);
});

await scenario('Overlapping Clears preserve a paused scheduler while marker storage is delayed', async () => {
  const h = await harness();
  await h.start({ prompt: 'SYNTHETIC_RUNNING_BEFORE_CLEAR' });
  const entered = deferred(), release = deferred();
  let writes = 0;
  h.beforeStorageSet = async (area, value) => {
    if (area === 'local' && value.draftClearPending === true && ++writes === 1) {
      entered.resolve();
      await release.promise;
    }
  };
  const first = h.message({ type: 'CLEAR_DATA' });
  const arrived = await Promise.race([entered.promise.then(() => true), first.then(() => false), delay(1000).then(() => false)]);
  if (!arrived) { release.resolve(); await first; }
  assert.equal(arrived, true);
  const second = h.message({ type: 'CLEAR_DATA' });
  assert.equal((await h.message({ type: 'PAUSE' })).ok, true);
  release.resolve();
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.equal(h.state.session.job ?? null, null);
  assert.equal(h.state.alarms.size, 0);
  assert.equal(h.sends().length, 0);
});

await scenario('A failed Clear does not allow stale or new drafts to bypass unfinished cleanup', async () => {
  const h = await harness();
  const initial = await h.message({ type: 'GET_STATE' });
  await h.message({ type: 'SAVE_DRAFT', generation: initial.draftGeneration, revision: initial.draftRevision,
    base: initial.config, config: { ...DEFAULT_CONFIG, prompt: 'SYNTHETIC_MUST_CLEAR' } });
  h.beforeStorageRemove = async (name, key) => {
    if (name === 'local' && key === 'config') throw new Error('SYNTHETIC_REMOVE_FAILED');
  };
  const failed = await h.message({ type: 'CLEAR_DATA' });
  assert.equal(failed.ok, false);
  const after = await h.message({ type: 'GET_STATE' });
  assert.equal(after.configAvailable, false);
  const stale = await h.message({ type: 'SAVE_DRAFT', generation: initial.draftGeneration, revision: initial.draftRevision,
    base: initial.config, config: { ...DEFAULT_CONFIG, prompt: 'SYNTHETIC_REAPPEARED' } });
  assert.equal(stale.ok, false);
  assert.equal(h.state.local.config.prompt, 'SYNTHETIC_MUST_CLEAR');
  h.beforeStorageRemove = null;
  assert.equal((await h.message({ type: 'CLEAR_DATA' })).ok, true);
  const cleared = await h.message({ type: 'GET_STATE' });
  assert.equal(cleared.configAvailable, true);
  assert.equal(cleared.config.prompt, '');
});

await scenario('A Clear interleaving with an issued draft write revokes a later Start reservation', async () => {
  const h = await harness();
  const initial = await h.message({ type: 'GET_STATE' });
  const entered = deferred(), release = deferred();
  h.beforeStorageSet = async (name, value) => {
    if (name === 'local' && value.config?.prompt === 'SYNTHETIC_BEFORE_CLEAR') {
      entered.resolve();
      await release.promise;
    }
  };
  const save = h.message({ type: 'SAVE_DRAFT', generation: initial.draftGeneration, revision: initial.draftRevision,
    base: initial.config, config: { ...DEFAULT_CONFIG, prompt: 'SYNTHETIC_BEFORE_CLEAR' } });
  assert.equal(await Promise.race([entered.promise.then(() => true), delay(1000).then(() => false)]), true);
  const clear = h.message({ type: 'CLEAR_DATA' });
  const reservation = await h.message({ type: 'PREPARE_START' });
  assert.equal(reservation.ok, false);
  const attempted = await h.message({ type: 'START', startToken: reservation.startToken, tabId: 7,
    config: { ...DEFAULT_CONFIG, prompt: 'SYNTHETIC_NEW_DURING_CLEAR' } });
  release.resolve();
  await save;
  assert.equal((await clear).ok, true);
  assert.equal(attempted.ok, false);
  assert.equal(h.state.session.job ?? null, null);
  assert.equal(h.state.local.config, undefined);
  assert.equal(h.state.alarms.size, 0);
});

await scenario('A stale panel revision cannot overwrite a newer saved draft', async () => {
  const h = await harness();
  const state = await h.message({ type: 'GET_STATE' });
  assert.equal(typeof state.draftGeneration, 'string');
  assert.ok(Number.isSafeInteger(state.draftRevision));
  const first = await h.message({ type: 'SAVE_DRAFT', generation: state.draftGeneration, revision: state.draftRevision,
    base: state.config, config: { ...DEFAULT_CONFIG, prompt: 'SYNTHETIC_NEWER_PANEL' } });
  assert.equal(first.ok, true);
  const second = await h.message({ type: 'SAVE_DRAFT', generation: state.draftGeneration, revision: state.draftRevision,
    base: state.config, config: { ...DEFAULT_CONFIG, prompt: 'SYNTHETIC_STALE_PANEL' } });
  assert.equal(second.ok, false);
  assert.equal(h.state.local.config.prompt, 'SYNTHETIC_NEWER_PANEL');
});

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

for (const invalidPrompt of ['SYNTHETIC_\u0000_NUL', 'SYNTHETIC_\ud800_LONE']) {
  await scenario('A retained invalid prompt cannot be resumed into a browser write', async () => {
    const h = await harness();
    await h.start();
    await h.message({ type: 'PAUSE' });
    h.state.session.job.prompt = invalidPrompt;
    h.state.local.resumeJob.prompt = invalidPrompt;
    const result = await h.message({ type: 'RESUME' });
    assert.equal(result.ok, false);
    assert.equal(h.state.session.job.enabled, false);
    assert.equal(h.state.session.job.prompt, invalidPrompt);
    assert.equal(h.sends().length, 0);
    assert.equal(h.state.alarms.size, 0);
  });
}

for (const invalidPrompt of ['SYNTHETIC_\u0000_NUL', 'SYNTHETIC_\ud800_LONE']) {
  for (const mode of ['repeat', 'queue-once']) {
    await scenario(`An enabled legacy ${mode} task cannot send invalid text after forced execution`, async () => {
      const h = await harness();
      await h.start(mode === 'repeat' ? {} : { mode, queue: [{ text: 'SYNTHETIC_VALID' }] });
      if (mode === 'repeat') h.state.session.job.prompt = invalidPrompt;
      else h.state.session.job.queue[0].text = invalidPrompt;
      h.state.local.resumeJob = copy(h.state.session.job);
      const result = await h.message({ type: 'SEND_NOW' });
      assert.equal(result.job.enabled, false);
      assert.equal(h.state.local.resumeJob.enabled, false);
      assert.equal(h.sends().length, 0);
      assert.equal(h.state.alarms.size, 0);
      assert.equal(mode === 'repeat' ? result.job.prompt : result.job.queue[0].text, invalidPrompt);
      assert.equal((await h.message({ type: 'PAUSE' })).ok, true);
    });
  }
}

for (const mode of ['repeat', 'queue-once']) {
  await scenario(`A recovered legacy ${mode} task pauses invalid text before a due alarm`, async () => {
    const first = await harness();
    await first.start(mode === 'repeat' ? {} : { mode, queue: [{ text: 'SYNTHETIC_VALID' }] });
    const local = copy(first.state.local);
    if (mode === 'repeat') local.resumeJob.prompt = 'SYNTHETIC_\u0000_RECOVERY';
    else local.resumeJob.queue[0].text = 'SYNTHETIC_\ud800_RECOVERY';
    const h = await harness({ local });
    assert.equal(h.state.session.job.enabled, true);
    await h.tick();
    assert.equal(h.state.session.job.enabled, false);
    assert.equal(h.state.local.resumeJob.enabled, false);
    assert.equal(h.sends().length, 0);
    assert.equal(h.state.alarms.size, 0);
    assert.equal((await h.message({ type: 'PAUSE' })).ok, true);
  });
}

await scenario('Resume rejects an invalid active task by revoking its scheduler authority', async () => {
  const h = await harness();
  await h.start();
  h.state.session.job.prompt = 'SYNTHETIC_\u0000_ACTIVE';
  h.state.local.resumeJob.prompt = h.state.session.job.prompt;
  const result = await h.message({ type: 'RESUME' });
  assert.equal(result.ok, false);
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.state.local.resumeJob.enabled, false);
  assert.equal(h.state.session.job.prompt, 'SYNTHETIC_\u0000_ACTIVE');
  assert.equal(h.state.alarms.size, 0);
  assert.equal(h.sends().length, 0);
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

await scenario('Legacy waiting defaults migrate while accumulated unknown pauses and preserves task progress and private content', async () => {
  const legacyConfig = { ...copy(DEFAULT_CONFIG), waitForIdle: true, prompt: 'SYNTHETIC_LEGACY_CONTENT' };
  delete legacyConfig.deliveryBehaviorVersion;
  const legacyJob = { ...legacyConfig, id: 'legacy-job', runId: 'legacy-run', enabled: true,
    tabId: 7, url: originalUrl, phase: 'idle', nextAt: Date.now() + 600_000,
    sentCount: 4, unknownCount: 2, queueIndex: 0, awaitingReply: false };
  const h = await harness({ local: { config: legacyConfig, resumeJob: copy(legacyJob) }, session: { job: legacyJob } });
  assert.equal(h.state.local.config.waitForIdle, true);
  assert.equal((await h.message({ type: 'GET_STATE' })).config.waitForIdle, false);
  assert.equal(h.state.local.resumeJob.waitForIdle, false);
  assert.equal(h.state.session.job.waitForIdle, false);
  for (const key of ['id', 'prompt', 'sentCount', 'unknownCount', 'queueIndex', 'awaitingReply']) {
    assert.equal(h.state.session.job[key], legacyJob[key], `${key} must survive migration`);
    assert.equal(h.state.local.resumeJob[key], legacyJob[key], `${key} must survive persisted migration`);
  }
  for (const job of [h.state.session.job, h.state.local.resumeJob]) {
    assert.equal(job.enabled, false);
    assert.equal(job.nextAt, null);
    assert.equal(job.needsAttention, true);
  }
  assert.equal(h.state.alarms.has(alarmName), false);
  await h.tick({ due: false });
  assert.equal(h.state.injections.length, 0, 'Migration must not send or interrupt');
  await h.message({ type: 'PAUSE' });
});

await scenario('A delayed legacy configuration read must not overwrite a newer user configuration', async () => {
  const legacyConfig = { ...copy(DEFAULT_CONFIG), waitForIdle: true, prompt: 'SYNTHETIC_OLD_PROMPT' };
  delete legacyConfig.deliveryBehaviorVersion;
  const newConfig = { ...copy(DEFAULT_CONFIG), waitForIdle: true, prompt: 'SYNTHETIC_NEW_PROMPT' };
  const release = deferred();
  let entered = false;
  const h = await harness({
    skipReady: true,
    local: { config: legacyConfig },
  });
  try {
    const get = h.chrome.storage.local.get;
    h.chrome.storage.local.get = async key => {
      const value = await get(key);
      if (key === 'config' && !entered) { entered = true; await release.promise; }
      return value;
    };
    const observing = h.message({ type: 'GET_STATE' });
    await until(() => entered, 'old configuration read');
    await h.chrome.storage.local.set({ config: newConfig });
    assert.deepEqual(h.state.local.config, newConfig, 'User configuration must be written before migration resumes');
    release.resolve();
    await observing;
  } finally {
    release.resolve();
  }
  assert.equal((await h.message({ type: 'GET_STATE' })).ok, true);
  assert.equal(h.state.local.config.prompt, newConfig.prompt, 'Migration must preserve the newer user prompt');
  assert.deepEqual(h.state.local.config, newConfig, 'Migration must preserve the newer user configuration');
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

await scenario('A stale, closed, or navigating pinned target cannot be probed or replace the active job', async () => {
  const h = await harness({ tabs: [{ id: 7, url: originalUrl, active: true }, { id: 9, url: otherUrl }] });
  const old = await h.start();
  const before = h.state.injections.length;
  const expected = 'https://chatgpt.com/c/synthetic-selected';
  for (const [id, pinned, actual] of [
    [9, expected, { id: 9, url: otherUrl }],
    [9, expected, null],
    [9, expected, { id: 9, url: expected, pendingUrl: otherUrl }],
    [undefined, expected, null],
    [9, 'https://chatgpt.com/', { id: 9, url: otherUrl }],
  ]) {
    if (actual) h.state.tabs.set(9, actual);
    else h.state.tabs.delete(9);
    assert.equal((await h.message({ type: 'CHECK_PAGE', tabId: id, targetUrl: pinned })).ok, false);
    assert.equal((await h.message({ type: 'START', tabId: id, targetUrl: pinned,
      config: { prompt: 'SYNTHETIC_REPLACEMENT', startImmediately: true } })).ok, false);
    assert.equal(h.state.session.job.id, old.id);
    assert.equal(h.state.session.job.enabled, true);
    assert.equal(h.state.alarms.size, 1);
    assert.equal(h.state.injections.length, before);
  }
  await h.message({ type: 'PAUSE' });
});

await scenario('A bound Dot job waits for its original URL after the tab navigates to a different Dot', async () => {
  const original = 'https://chatgpt.com/dots/synthetic-account~original';
  const different = 'https://chatgpt.com/dots/synthetic-account~other';
  const h = await harness({ tabs: [{ id: 7, url: original }] });
  h.pageResult = args => ({ status: args.mode === 'check' ? 'ready' : 'sent', identity: 'synthetic-account~original' });
  const bound = await h.start();
  h.state.tabs.get(7).url = different;
  h.chrome.tabs.onUpdated.emit(7, { url: different });
  await until(() => h.state.session.job.tabId === null || h.state.session.job.url === different);
  assert.equal(h.state.session.job.url, original);
  assert.equal(h.state.session.job.tabId, null);
  assert.equal(h.state.local.resumeJob.url, original);
  await h.tick();
  assert.equal(h.sends().length, 0);
  h.state.tabs.set(9, { id: 9, url: original + '/?view=1#composer', autoDiscardable: true });
  const resumed = await h.tick();
  assert.equal(resumed.id, bound.id);
  assert.equal(resumed.tabId, 9);
  assert.equal(h.sends().length, 1);
  assert.equal(h.sends()[0].args[0].expectedUrl, original);
  assert.equal(h.sends()[0].target.tabId, 9);
  await h.message({ type: 'PAUSE' });
});

await scenario('A pinned target that navigates during its probe leaves the existing job scheduled', async () => {
  const h = await harness({ tabs: [{ id: 7, url: originalUrl }, { id: 9, url: otherUrl }] });
  const old = await h.start({}, 7);
  h.pageResult = async (args, tabId) => {
    assert.equal(args.mode, 'check');
    assert.equal(tabId, 9);
    h.state.tabs.get(9).url = originalUrl;
    return { status: 'ready' };
  };
  const response = await h.message({ type: 'START', tabId: 9, targetUrl: otherUrl,
    config: { prompt: 'SYNTHETIC_REPLACEMENT', startImmediately: true } });
  assert.equal(response.ok, false);
  assert.equal(h.state.session.job.id, old.id);
  assert.equal(h.state.session.job.enabled, true);
  assert.equal(h.state.alarms.size, 1);
  assert.equal(h.sends().length, 0);
  await h.message({ type: 'PAUSE' });
});

await scenario('A legacy request with multiple active-tab results does not pick the first conversation', async () => {
  const h = await harness({ tabs: [{ id: 7, url: originalUrl, active: true }, { id: 9, url: otherUrl, active: true }] });
  assert.equal((await h.message({ type: 'CHECK_PAGE' })).ok, false);
  assert.equal((await h.message({ type: 'START', config: { prompt: 'SYNTHETIC_AMBIGUOUS', startImmediately: true } })).ok, false);
  assert.equal(h.state.injections.length, 0);
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

await scenario('A reserved Start cannot activate after another panel pauses it', async () => {
  const h = await harness();
  const reservation = await h.message({ type: 'PREPARE_START' });
  assert.equal(reservation.ok, true);
  assert.equal(typeof reservation.startToken, 'string');
  assert.equal((await h.message({ type: 'PAUSE' })).ok, true);
  const late = await h.message({ type: 'START', startToken: reservation.startToken,
    tabId: 7, config: { prompt: 'SYNTHETIC_DELAYED_START' } });
  assert.equal(late.ok, false);
  assert.ok(!h.state.session.job?.enabled);
  assert.equal(h.state.alarms.size, 0);
  assert.equal(h.sends().length, 0);
});

await scenario('A newer Start reservation supersedes an older one and is single-use', async () => {
  const h = await harness();
  const first = await h.message({ type: 'PREPARE_START' });
  const second = await h.message({ type: 'PREPARE_START' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.startToken, second.startToken);
  const request = token => ({ type: 'START', startToken: token, tabId: 7,
    config: { prompt: 'SYNTHETIC_RESERVED_START' } });
  assert.equal((await h.message(request(first.startToken))).ok, false);
  assert.equal((await h.message(request(second.startToken))).ok, true);
  assert.equal((await h.message(request(second.startToken))).ok, false);
  assert.equal(h.state.injections.filter(item => item.args[0].mode === 'check').length, 1);
  await h.message({ type: 'PAUSE' });
});

await scenario('Cancelling a Start reservation revokes only the matching token', async () => {
  const h = await harness();
  const prepare = () => h.message({ type: 'PREPARE_START' });
  const cancel = startToken => ({ type: 'CANCEL_START', startToken });
  const start = startToken => h.message({ type: 'START', startToken, tabId: 7, targetUrl: originalUrl,
    config: { prompt: 'SYNTHETIC_RESERVED_START' } });
  const older = await prepare();
  const current = await prepare();
  assert.equal((await h.message(cancel(older.startToken))).ok, true);
  assert.equal((await h.message(cancel(current.startToken), h.sender())).ok, false);
  assert.equal((await start(current.startToken)).ok, true);
  const abandoned = await prepare();
  assert.equal((await h.message(cancel(abandoned.startToken))).ok, true);
  assert.equal((await start(abandoned.startToken)).ok, false);
  assert.equal(h.state.session.job.enabled, true);
  assert.equal(h.state.injections.length, 1);
  await h.message({ type: 'PAUSE' });
});

await scenario('An invalid Start token cannot clear the active reservation for the Pause shortcut', async () => {
  const h = await harness();
  await h.start({ prompt: 'SYNTHETIC_PAUSED_JOB' });
  await h.message({ type: 'PAUSE' });
  const beforePause = h.state.session.job.runId;
  const reservation = await h.message({ type: 'PREPARE_START' });
  assert.equal(reservation.ok, true);
  assert.equal((await h.message({ type: 'START', startToken: 'SYNTHETIC_INVALID_TOKEN',
    tabId: 7, config: { prompt: 'SYNTHETIC_INVALID_START' } })).ok, false);
  h.chrome.commands.onCommand.emit('toggle-running');
  await until(() => h.state.session.job.runId !== beforePause, 'shortcut records a second Pause');
  const late = await h.message({ type: 'START', startToken: reservation.startToken,
    tabId: 7, config: { prompt: 'SYNTHETIC_VALID_BUT_CANCELLED' } });
  assert.equal(late.ok, false);
  assert.equal(h.state.session.job.prompt, 'SYNTHETIC_PAUSED_JOB');
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.state.alarms.size, 0);
});

await scenario('A forged Start cannot cancel another panel’s pending Start', async () => {
  const h = await harness();
  const reservation = await h.message({ type: 'PREPARE_START' });
  assert.equal(reservation.ok, true);
  assert.equal((await h.message({ type: 'START', startToken: 'SYNTHETIC_INVALID_TOKEN',
    tabId: 7, config: { prompt: 'SYNTHETIC_INVALID_START' } })).ok, false);
  const valid = await h.message({ type: 'START', startToken: reservation.startToken,
    tabId: 7, config: { prompt: 'SYNTHETIC_VALID_START' } });
  assert.equal(valid.ok, true);
  assert.equal(valid.job.enabled, true);
  await h.message({ type: 'PAUSE' });
});

await scenario('A Start reservation does not survive a worker restart', async () => {
  const first = await harness();
  const reservation = await first.message({ type: 'PREPARE_START' });
  assert.equal(reservation.ok, true);
  const restarted = await harness({ session: copy(first.state.session), local: copy(first.state.local) });
  const late = await restarted.message({ type: 'START', startToken: reservation.startToken,
    tabId: 7, config: { prompt: 'SYNTHETIC_OLD_WORKER_START' } });
  assert.equal(late.ok, false);
  assert.ok(!restarted.state.session.job?.enabled);
  assert.equal(restarted.state.alarms.size, 0);
  assert.equal(restarted.sends().length, 0);
});

await scenario('A foreign page cannot reserve or cancel an authorized Start', async () => {
  const h = await harness();
  const reservation = await h.message({ type: 'PREPARE_START' });
  assert.equal(reservation.ok, true);
  assert.equal((await h.message({ type: 'PREPARE_START' }, h.sender())).ok, false);
  assert.equal((await h.message({ type: 'PAUSE' }, h.sender())).ok, false);
  const result = await h.message({ type: 'START', startToken: reservation.startToken,
    tabId: 7, config: { prompt: 'SYNTHETIC_AUTHORIZED_START' } });
  assert.equal(result.ok, true);
  assert.equal(result.job.enabled, true);
  await h.message({ type: 'PAUSE' });
});

await scenario('A sender without extension identity cannot control Start or Pause', async () => {
  const h = await harness();
  const foreign = { id: 'foreign-extension', url: 'chrome-extension://foreign-extension/popup.html' };
  assert.equal((await h.message({ type: 'PREPARE_START' }, foreign)).ok, false);
  assert.equal((await h.message({ type: 'START', tabId: 7,
    config: { prompt: 'SYNTHETIC_FOREIGN_START' } }, foreign)).ok, false);
  await h.start({ prompt: 'SYNTHETIC_AUTHORIZED_JOB' });
  assert.equal((await h.message({ type: 'PAUSE' }, foreign)).ok, false);
  assert.equal(h.state.session.job.enabled, true);
  assert.equal(h.state.alarms.size, 1);
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

for (const [source, phase] of [['panel', 'idle'], ['shortcut', 'idle'], ['panel', 'reply-check']]) await scenario(`A ${source} Pause survives exit before its paused snapshot is written (${phase})`, async () => {
  const h = await harness();
  const running = await h.start();
  if (phase === 'reply-check') {
    const checking = { ...running, phase: 'sending', runKind: 'reply-check', runDeadline: Date.now() + 30_000, awaitingReply: true };
    h.state.session.job = copy(checking);
    h.state.local.resumeJob = copy(checking);
  }
  let interrupted;
  h.beforeStorageSet = (area, value) => {
    if (area === 'session' && value.job?.enabled === false && !interrupted) {
      interrupted = { session: copy(h.state.session), local: copy(h.state.local),
        tabs: [...h.state.tabs.values()].map(copy), alarms: [...h.state.alarms.entries()].map(copy) };
    }
  };
  if (source === 'panel') assert.equal((await h.message({ type: 'PAUSE' })).ok, true);
  else {
    h.chrome.commands.onCommand.emit('toggle-running');
    await until(() => h.state.local.resumeJob?.enabled === false && h.state.alarms.size === 0, 'keyboard pause committed');
  }
  assert.ok(interrupted);
  assert.equal(interrupted.local.resumeJob?.enabled, true, 'snapshot is from before the paused job was persisted');

  for (const restart of ['worker', 'browser']) {
    const reopened = await harness(restart === 'worker' ? interrupted : { ...interrupted, session: {}, tabs: [] });
    assert.equal(reopened.state.session.job?.id, running.id);
    assert.equal(reopened.state.session.job?.enabled, false);
    assert.equal(reopened.state.local.resumeJob?.enabled, false);
    assert.equal(reopened.state.alarms.size, 0);
    if (restart === 'worker') assert.equal(reopened.state.tabs.get(7).autoDiscardable, true);
    assert.equal((await reopened.message({ type: 'SEND_NOW' })).ok, false);
    assert.equal(reopened.sends().length, 0);
    const resumed = await reopened.message({ type: 'RESUME' });
    assert.equal(resumed.ok, true);
    const afterResume = await harness({ local: copy(reopened.state.local), session: copy(reopened.state.session) });
    assert.equal(afterResume.state.session.job?.enabled, true, 'the previous Pause must not stop an explicit Resume');
    await afterResume.message({ type: 'PAUSE' });
  }
});

for (const operation of ['START', 'RESUME']) await scenario(`${operation} restart reconciles the exact activation write boundary`, async () => {
  const h = await harness();
  if (operation === 'RESUME') { await h.start(); await h.message({ type: 'PAUSE' }); }
  let before, committed;
  h.beforeStorageSet = (area, value) => {
    if (area !== 'local' || !value.resumeJob?.enabled || before) return;
    before = { session: copy(h.state.session), local: copy(h.state.local), tabs: [...h.state.tabs.values()].map(copy) };
    committed = { ...copy(before), local: { ...copy(before.local), resumeJob: copy(value.resumeJob) } };
  };
  const response = operation === 'RESUME' ? await h.message({ type: 'RESUME' }) : await h.message({
    type: 'START', tabId: 7, targetUrl: originalUrl, config: { prompt: 'SYNTHETIC_ACTIVATION_BOUNDARY' },
  });
  assert.equal(response.ok, true);
  assert.ok(before && committed);
  await h.message({ type: 'PAUSE' });

  const interrupted = await harness(before);
  assert.equal(interrupted.state.session.job?.enabled, false, 'a staged session write is not a committed activation');
  assert.equal(interrupted.state.alarms.size, 0);
  assert.equal(interrupted.state.tabs.get(7).autoDiscardable, true);
  assert.ok(!interrupted.state.local.resumeJob?.enabled);
  assert.equal((await interrupted.message({ type: 'SEND_NOW' })).ok, false);
  assert.equal(interrupted.sends().length, 0);

  const restored = await harness(committed);
  assert.equal(restored.state.session.job?.enabled, true, 'a matching durable write committed the activation');
  assert.equal(restored.state.session.job?.runId, committed.local.resumeJob.runId);
  assert.equal(restored.state.alarms.size, 1);
  assert.equal(restored.sends().length, 0);
  await restored.message({ type: 'PAUSE' });
});

await scenario('A failed durable Start leaves no running job in the current worker or after restart', async () => {
  for (const rejectPausedWrite of [false, true]) {
    const h = await harness({ permissionGranted: true });
    h.beforeStorageSet = (area, value) => {
      if (area === 'local' && value.resumeJob && (value.resumeJob.enabled || rejectPausedWrite)) {
        throw new Error('Synthetic resume snapshot write failure');
      }
    };
    const response = await h.message({ type: 'START', tabId: 7, targetUrl: originalUrl,
      config: { prompt: 'SYNTHETIC_START_WRITE_FAILURE', startImmediately: true, keepAwake: true, preventDiscard: true } });
    assert.equal(response.ok, false);
    assert.equal(h.state.session.job?.enabled, false);
    assert.ok(!h.state.local.resumeJob?.enabled);
    assert.equal(h.state.tabs.get(7).autoDiscardable, true);
    assert.equal(h.state.powerCalls.at(-1)?.method, 'release');
    assert.equal(h.state.alarms.size, 0);
    assert.equal((await h.message({ type: 'SEND_NOW' })).ok, false);
    assert.equal(h.sends().length, 0);
    for (const session of [h.state.session, {}]) {
      const restarted = await harness({ session: copy(session), local: copy(h.state.local) });
      assert.ok(!restarted.state.session.job?.enabled);
      assert.equal(restarted.state.alarms.size, 0);
      assert.equal((await restarted.message({ type: 'SEND_NOW' })).ok, false);
      assert.equal(restarted.sends().length, 0);
    }
  }
});

await scenario('START session write failure does not erase the already paused task', async () => {
  const h = await harness({ permissionGranted: true });
  const original = await h.start();
  await h.message({ type: 'PAUSE' });
  h.beforeStorageSet = (area, value) => {
    if (area === 'session' && value.job?.enabled) throw new Error('Synthetic session write failure');
  };
  const response = await h.message({ type: 'START', tabId: 7, targetUrl: originalUrl,
    config: { prompt: 'SYNTHETIC_START_WRITE_FAILURE', startImmediately: true, keepAwake: true, preventDiscard: true } });
  assert.equal(response.ok, false);
  assert.equal(h.state.session.job.id, original.id);
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.state.local.resumeJob.id, original.id);
  assert.equal(h.state.tabs.get(7).autoDiscardable, true);
  assert.equal(h.state.powerCalls.at(-1)?.method, 'release');
  assert.equal(h.state.alarms.size, 0);
  assert.equal(h.sends().length, 0);
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
  const [result] = await Promise.all([starting, pausing]);
  assert.equal(result.ok, false);
  assert.ok(!h.state.session.job?.enabled);
  assert.equal(h.state.tabs.get(7).autoDiscardable, true);
  assert.equal(h.sends().length, 0);
  assert.equal(h.state.alarms.size, 0);
});

await scenario('Navigation or supersession during tab protection cannot activate a pinned Start', async () => {
  for (const change of ['navigation', 'supersession']) {
    const h = await harness();
    const entered = deferred(), release = deferred();
    h.beforeTabUpdate = async (_id, update) => {
      if (update.autoDiscardable === false) { entered.resolve(); await release.promise; }
    };
    const starting = h.message({ type: 'START', tabId: 7, targetUrl: originalUrl,
      config: { prompt: 'SYNTHETIC_COMMIT', startImmediately: true } });
    await entered.promise;
    if (change === 'navigation') h.state.tabs.get(7).url = otherUrl;
    else assert.equal((await h.message({ type: 'PREPARE_START' })).ok, true);
    release.resolve();
    assert.equal((await starting).ok, false);
    assert.ok(!h.state.session.job?.enabled);
    assert.equal(h.state.tabs.get(7).autoDiscardable, true);
    assert.equal(h.state.alarms.size, 0);
    assert.equal(h.sends().length, 0);
  }
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

await scenario('A foreign extension cannot obtain a live page run authorization', async () => {
  const h = await harness();
  await h.start();
  const gate = deferred();
  h.pageResult = args => args.mode === 'send' ? gate.promise : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  try {
    await until(() => h.sends().length === 1);
    const runId = h.state.session.job.runId;
    for (const sender of [{ ...h.sender(), id: 'foreign-extension' }, { ...h.sender(), id: undefined }]) {
      for (const message of [{ type: 'CHECK_RUN', runId }, { type: 'WAIT_RUN', runId, delayMs: 50 },
        { type: 'COMMIT_RUN', runId, receiptBoundaryToken: '00000000-0000-0000-0000-000000000001' }]) {
        const result = await h.message(message, sender);
        assert.equal(result.allowed ?? false, false);
        assert.notEqual(result.dispatched, true);
      }
    }
  } finally {
    await h.message({ type: 'PAUSE' });
    gate.resolve({ status: 'cancelled' });
    await round;
  }
});

for (const status of ['sent', 'manual-sent']) await scenario(`An accepted ${status} receipt is accounted before a queued Pause`, async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }], maxSends: 1 });
  const injection = deferred();
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const args = h.sends()[0].args[0];
  const reading = deferred();
  let entered = false;
  h.beforeStorageGet = (name, key) => {
    if (name === 'session' && key === 'job' && !entered) { entered = true; return reading.promise; }
  };
  const message = { type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken, result: { status } };
  const receipt = h.message(message, h.sender());
  await until(() => entered);
  const pausing = h.message({ type: 'PAUSE' });
  reading.resolve();
  const accepted = await receipt;
  const paused = await pausing;
  injection.resolve({ status });
  await round;
  assert.equal(accepted.ok, true);
  assert.equal(paused.job.enabled, false);
  assert.equal(paused.job.sentCount, status === 'sent' ? 1 : 0);
  assert.equal(paused.job.manualSentCount || 0, status === 'manual-sent' ? 1 : 0);
  assert.equal(paused.job.queueIndex, 1);
  assert.equal(paused.job.nextAt, null);
  assert.deepEqual(h.state.local.resumeJob, h.state.session.job);
  assert.equal(h.state.alarms.size, 0);
  assert.equal((await h.message(message, h.sender())).ok, false);
  assert.equal((await h.message({ type: 'RESUME' })).ok, false);
  const restarted = await harness({ local: copy(h.state.local) });
  assert.equal(restarted.state.session.job.enabled, false);
  assert.equal(restarted.state.session.job.sentCount, status === 'sent' ? 1 : 0);
  assert.equal(restarted.state.session.job.manualSentCount || 0, status === 'manual-sent' ? 1 : 0);
  assert.equal(restarted.state.session.job.queueIndex, 1);
});

await scenario('Concurrent duplicate receipts are counted once and Resume continues from the next queue item', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const injection = deferred();
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const args = h.sends()[0].args[0];
  const reading = deferred();
  let entered = false;
  h.beforeStorageGet = (name, key) => {
    if (name === 'session' && key === 'job' && !entered) { entered = true; return reading.promise; }
  };
  const message = { type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken, result: { status: 'sent' } };
  const first = h.message(message, h.sender());
  await until(() => entered);
  const second = h.message(message, h.sender());
  const pausing = h.message({ type: 'PAUSE' });
  reading.resolve();
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, false);
  const paused = await pausing;
  injection.resolve({ status: 'sent' });
  await round;
  assert.equal(paused.job.sentCount, 1);
  assert.equal(paused.job.queueIndex, 1);
  assert.equal(paused.job.enabled, false);
  assert.equal(h.state.alarms.size, 0);
  assert.equal((await h.message({ type: 'RESUME' })).ok, true);
  h.pageResult = async () => ({ status: 'sent' });
  assert.equal((await h.message({ type: 'SEND_NOW' })).job.sentCount, 2);
  assert.equal(h.sends().at(-1).args[0].prompt, 'SYNTHETIC_SECOND');
  assert.equal(h.state.session.job.queueIndex, 0);
  await h.message({ type: 'PAUSE' });
});

for (const channel of ['PAGE_RESULT', 'executeScript']) for (const status of ['sent', 'manual-sent']) {
  await scenario(`Pause queued before a confirmed ${status} ${channel} preserves progress without replay on Resume`, async () => {
    const h = await harness();
    await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
    const injection = deferred();
    h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
    const round = h.message({ type: 'SEND_NOW' });
    await until(() => h.sends().length === 1);
    const args = h.sends()[0].args[0];
    const reading = deferred();
    let entered = false;
    h.beforeStorageGet = (name, key) => {
      if (name === 'session' && key === 'job' && !entered) { entered = true; return reading.promise; }
    };
    const checking = h.message({ type: 'CHECK_RUN', runId: args.runId }, h.sender());
    await until(() => entered, 'the state queue is held before Pause');
    const pausing = h.message({ type: 'PAUSE' });
    await delay(0);
    let receipt;
    if (channel === 'PAGE_RESULT') {
      receipt = h.message({ type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken, result: { status } }, h.sender());
    } else {
      injection.resolve({ status });
    }
    await delay(20);
    reading.resolve();
    const checked = await checking;
    const paused = await pausing;
    const received = receipt ? await receipt : null;
    injection.resolve({ status });
    await round;
    const saved = copy(h.state.local.resumeJob);
    const resumed = await h.message({ type: 'RESUME' });
    h.pageResult = async () => ({ status: 'sent' });
    const next = await h.message({ type: 'SEND_NOW' });
    const prompts = h.sends().map(request => request.args[0].prompt);
    await h.message({ type: 'PAUSE' });
    assert.equal(checked.allowed, true);
    assert.equal(resumed.ok, true);
    assert.equal(next.ok, true);
    assert.deepEqual({ enabled: paused.job.enabled, sentCount: saved.sentCount, manualSentCount: saved.manualSentCount || 0,
      queueIndex: saved.queueIndex, prompts }, { enabled: false, sentCount: status === 'sent' ? 1 : 0,
      manualSentCount: status === 'manual-sent' ? 1 : 0, queueIndex: 1, prompts: ['SYNTHETIC_FIRST', 'SYNTHETIC_SECOND'] });
    if (received) assert.equal(received.ok, true);
    assert.equal(next.job.sentCount, status === 'sent' ? 2 : 1);
    assert.equal(next.job.manualSentCount || 0, status === 'manual-sent' ? 1 : 0);
  });
}

await scenario('Pause-first sent receipt with an unresolved manual submission cannot advance the queue', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const injection = deferred();
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const args = h.sends()[0].args[0];
  assert.equal((await h.message({ type: 'MANUAL_SUBMISSION', runId: args.runId, resultToken: args.resultToken }, h.sender())).ok, true);
  const reading = deferred();
  let entered = false;
  h.beforeStorageGet = (name, key) => {
    if (name === 'session' && key === 'job' && !entered) { entered = true; return reading.promise; }
  };
  const checking = h.message({ type: 'CHECK_RUN', runId: args.runId }, h.sender());
  await until(() => entered);
  const pausing = h.message({ type: 'PAUSE' });
  await delay(0);
  const receipt = h.message({ type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken, result: { status: 'sent' } }, h.sender());
  await delay(20);
  reading.resolve();
  await checking;
  const paused = await pausing;
  await receipt;
  injection.resolve({ status: 'sent' });
  await round;
  assert.equal(paused.job.enabled, false);
  assert.equal(paused.job.sentCount, 0);
  assert.equal(paused.job.queueIndex, 0);
  assert.equal(paused.job.unknownCount, 1);
  assert.equal(paused.job.needsAttention, true);
  assert.deepEqual(h.state.local.resumeJob, h.state.session.job);
});

await scenario('Pause preserves an unresolved manual submission without a receipt', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const injection = deferred();
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const args = h.sends()[0].args[0];
  await h.message({ type: 'MANUAL_SUBMISSION', runId: args.runId, resultToken: args.resultToken }, h.sender());
  const paused = await h.message({ type: 'PAUSE' });
  injection.resolve({ status: 'cancelled' });
  await round;
  assert.equal(paused.job.enabled, false);
  assert.equal(paused.job.unknownCount, 1);
  assert.equal(paused.job.needsAttention, true);
  assert.equal(paused.job.queueIndex, 0);
  assert.deepEqual(h.state.local.resumeJob, h.state.session.job);
});

await scenario('A failed Pause persistence leaves its confirmed receipt available for a later Pause', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const injection = deferred();
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const args = h.sends()[0].args[0];
  const reading = deferred();
  let entered = false;
  let failPause = true;
  h.beforeStorageGet = (name, key) => {
    if (name === 'session' && key === 'job' && !entered) { entered = true; return reading.promise; }
  };
  h.beforeStorageSet = (name, value) => {
    if (name === 'session' && value.job && !value.job.enabled && failPause) { failPause = false; throw new Error('Synthetic pause persistence failure'); }
  };
  const checking = h.message({ type: 'CHECK_RUN', runId: args.runId }, h.sender());
  await until(() => entered);
  const firstPause = h.message({ type: 'PAUSE' });
  await delay(0);
  const receipt = h.message({ type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken, result: { status: 'sent' } }, h.sender());
  await delay(20);
  reading.resolve();
  await checking;
  assert.equal((await firstPause).ok, false);
  await receipt;
  const paused = await h.message({ type: 'PAUSE' });
  injection.resolve({ status: 'sent' });
  await round;
  assert.equal(paused.job.sentCount, 1);
  assert.equal(paused.job.queueIndex, 1);
  assert.equal(paused.job.enabled, false);
  assert.deepEqual(h.state.local.resumeJob, h.state.session.job);
});

for (const failedArea of ['session', 'local']) await scenario(`A duplicate receipt recovers failed ${failedArea} accounting without hanging or double counting`, async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const injection = deferred();
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const args = h.sends()[0].args[0];
  let failOnce = true;
  h.beforeStorageSet = (name, value) => {
    const job = name === 'session' ? value.job : value.resumeJob;
    if (name === failedArea && job?.phase === 'idle' && job.sentCount === 1 && failOnce) {
      failOnce = false;
      throw new Error('Synthetic receipt persistence failure');
    }
  };
  const message = { type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken, result: { status: 'sent' } };
  const first = await h.message(message, h.sender());
  const second = await h.message(message, h.sender());
  const settled = await Promise.race([round, delay(500).then(() => null)]);
  injection.resolve({ status: 'sent' });
  if (!settled) await h.message({ type: 'PAUSE' });
  await round;
  assert.equal(first.ok, false);
  assert.equal(second.ok, true);
  assert.ok(settled, 'The original send must settle after receipt recovery');
  assert.equal(h.state.session.job.sentCount, 1);
  assert.equal(h.state.session.job.queueIndex, 1);
  assert.deepEqual(h.state.local.resumeJob, h.state.session.job);
  await h.message({ type: 'PAUSE' });
});

for (const status of ['sent', 'manual-sent']) await scenario(`A failed ${status} receipt accounting overrides a conflicting retryable zero-count result`, async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const injection = deferred(), laterInjection = deferred();
  h.pageResult = args => args.mode !== 'send' ? { status: 'ready' }
    : h.sends().length === 1 ? injection.promise : laterInjection.promise;
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1, 'initial synthetic admission');
  const args = h.sends()[0].args[0];
  let failures = 0;
  h.beforeStorageSet = (name, value) => {
    if (name === 'session' && value.job?.phase === 'idle'
      && value.job.sentCount + (value.job.manualSentCount || 0) === 1) {
      failures += 1;
      throw new Error('Synthetic confirmed receipt accounting failure');
    }
  };
  const receipt = await h.message({ type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken,
    result: { status } }, h.sender());
  injection.resolve({ status: 'blocked', retryable: true,
    diagnosticProgress: { counters: { dispatchAttempts: 0, manualIntents: 0 } } });
  await delay(1300);
  const admissions = h.sends().map(request => ({ runId: request.args[0].runId, prompt: request.args[0].prompt }));
  h.beforeStorageSet = null;
  await h.message({ type: 'PAUSE' });
  laterInjection.resolve({ status: 'cancelled' });
  await round;
  assert.equal(receipt.ok, false, 'The confirmed receipt must encounter the injected accounting failure');
  assert.ok(failures > 0, 'The receipt accounting write must actually fail');
  assert.equal(admissions.length, 1, 'A confirmed receipt must prevent another admission despite a conflicting retryable zero-count result');
  assert.deepEqual(admissions[0], { runId: args.runId, prompt: 'SYNTHETIC_FIRST' });
});

await scenario('A concurrent duplicate retries after the first receipt persistence fails', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const injection = deferred();
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const args = h.sends()[0].args[0];
  const writing = deferred();
  let entered = false;
  h.beforeStorageSet = async (name, value) => {
    if (name === 'session' && value.job?.phase === 'idle' && value.job.sentCount === 1 && !entered) {
      entered = true;
      await writing.promise;
      throw new Error('Synthetic receipt persistence failure');
    }
  };
  const message = { type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken, result: { status: 'sent' } };
  const first = h.message(message, h.sender());
  await until(() => entered);
  const duplicate = h.message(message, h.sender());
  writing.resolve();
  assert.equal((await first).ok, false);
  const second = await duplicate;
  const settled = await Promise.race([round, delay(500).then(() => null)]);
  injection.resolve({ status: 'sent' });
  if (!settled) await h.message({ type: 'PAUSE' });
  await round;
  assert.equal(second.ok, true);
  assert.ok(settled);
  assert.equal(h.state.session.job.sentCount, 1);
  assert.equal(h.state.session.job.queueIndex, 1);
  assert.deepEqual(h.state.local.resumeJob, h.state.session.job);
  await h.message({ type: 'PAUSE' });
});

for (const failedArea of ['session', 'local']) await scenario(`A failed ${failedArea} receipt write settles without another page message`, async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const injection = deferred();
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const args = h.sends()[0].args[0];
  let failOnce = true;
  h.beforeStorageSet = (name, value) => {
    const job = name === 'session' ? value.job : value.resumeJob;
    if (name === failedArea && job?.phase === 'idle' && job.sentCount === 1 && failOnce) {
      failOnce = false;
      throw new Error('Synthetic receipt persistence failure');
    }
  };
  const first = await h.message({ type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken, result: { status: 'sent' } }, h.sender());
  const settled = await Promise.race([round, delay(500).then(() => null)]);
  injection.resolve({ status: 'sent' });
  if (!settled) await h.message({ type: 'PAUSE' });
  await round;
  assert.equal(first.ok, false);
  assert.ok(settled, 'A failed acknowledgement must not leave the invocation hanging');
  assert.equal(h.state.session.job.sentCount, 1);
  assert.equal(h.state.session.job.queueIndex, 1);
  assert.deepEqual(h.state.local.resumeJob, h.state.session.job);
  await h.message({ type: 'PAUSE' });
});

await scenario('Pause after a partially persisted receipt retains the count in the recovery snapshot', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const injection = deferred();
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const args = h.sends()[0].args[0];
  let failOnce = true;
  h.beforeStorageSet = (name, value) => {
    if (name === 'local' && value.resumeJob?.phase === 'idle' && value.resumeJob.sentCount === 1 && failOnce) {
      failOnce = false;
      throw new Error('Synthetic receipt persistence failure');
    }
  };
  const receipt = await h.message({ type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken, result: { status: 'sent' } }, h.sender());
  const paused = await h.message({ type: 'PAUSE' });
  const settled = await Promise.race([round, delay(500).then(() => null)]);
  injection.resolve({ status: 'sent' });
  await round;
  assert.equal(receipt.ok, false);
  assert.equal(paused.job.sentCount, 1);
  assert.equal(paused.job.queueIndex, 1);
  assert.equal(paused.job.enabled, false);
  assert.ok(settled);
  assert.deepEqual(h.state.local.resumeJob, h.state.session.job);
});

for (const status of ['sent', 'manual-sent']) await scenario(`Receipt ${status} arriving during Pause persistence is retained`, async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const injection = deferred();
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const args = h.sends()[0].args[0];
  const writing = deferred();
  let entered = false;
  h.beforeStorageSet = (name, value) => {
    if (name === 'session' && value.job && !value.job.enabled && !entered) { entered = true; return writing.promise; }
  };
  const pausing = h.message({ type: 'PAUSE' });
  await until(() => entered);
  const receipt = h.message({ type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken, result: { status } }, h.sender());
  await delay(20);
  writing.resolve();
  const paused = await pausing;
  const accepted = await receipt;
  injection.resolve({ status });
  await round;
  assert.equal(accepted.ok, true);
  assert.equal(paused.job.enabled, false);
  assert.equal(paused.job.sentCount, status === 'sent' ? 1 : 0);
  assert.equal(paused.job.manualSentCount || 0, status === 'manual-sent' ? 1 : 0);
  assert.equal(paused.job.queueIndex, 1);
  assert.deepEqual(h.state.local.resumeJob, h.state.session.job);
});

await scenario('Pause persists the in-flight fence before an absent CANCEL_RUN ACK and blocks Resume after worker restart', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const injection = deferred(), cancellation = deferred();
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1, 'in-flight synthetic send');
  const args = h.sends()[0].args[0];
  const deadline = h.state.session.job.runDeadline;
  let cancelMessage, restarted, observed;
  h.chrome.tabs.sendMessage = async (id, message) => {
    assert.equal(id, 7);
    cancelMessage = message;
    return cancellation.promise;
  };
  const pausing = h.message({ type: 'PAUSE' });
  try {
    await until(() => cancelMessage, 'unacknowledged CANCEL_RUN');
    assert.deepEqual({ type: cancelMessage.type, runId: cancelMessage.runId, resultToken: cancelMessage.resultToken },
      { type: 'CANCEL_RUN', runId: args.runId, resultToken: args.resultToken });
    assert.ok(Number.isFinite(deadline) && deadline > Date.now());
    const session = copy(h.state.session), local = copy(h.state.local);
    restarted = await harness({ session, local });
    const resumed = await restarted.message({ type: 'RESUME' });
    observed = {
      sessionPaused: session.job.enabled === false,
      localPaused: local.resumeJob.enabled === false,
      sessionFence: Math.max(session.submissionFenceUntil || 0, session.job.submissionFenceUntil || 0) >= deadline,
      localFence: (local.resumeJob.submissionFenceUntil || 0) >= deadline,
      resumeAllowed: resumed.ok,
      enabledAfterResume: restarted.state.session.job.enabled,
      alarmAfterResume: restarted.state.alarms.has(alarmName),
      sendsAfterRestart: restarted.sends().length,
    };
  } finally {
    if (restarted) await restarted.message({ type: 'PAUSE' });
    globalThis.chrome = h.chrome;
    cancellation.resolve(null);
    await pausing;
    injection.resolve({ status: 'cancelled' });
    await round;
  }
  assert.deepEqual(observed, {
    sessionPaused: true, localPaused: true, sessionFence: true, localFence: true,
    resumeAllowed: false, enabledAfterResume: false, alarmAfterResume: false, sendsAfterRestart: 0,
  }, 'The pause fence must be durable before waiting for cancellation and survive a worker restart');
});

for (const restart of ['worker', 'browser', 'fence-storage-failure']) await scenario(`Clear after an unacknowledged Pause must block START before the old lease expires after ${restart} restart`, async () => {
  const h = await harness();
  await h.start({ prompt: 'SYNTHETIC_OLD_RUN' });
  const injection = deferred();
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  let restarted, observed;
  try {
    await until(() => h.sends().length === 1, 'in-flight synthetic send');
    const { runId, resultToken } = h.sends()[0].args[0];
    const deadline = h.state.session.job.runDeadline;
    assert.ok(Number.isFinite(deadline) && deadline > Date.now());
    assert.equal((await h.message({ type: 'CHECK_RUN', runId }, h.sender())).allowed, true);
    if (restart === 'fence-storage-failure') h.beforeStorageGet = (name, key) => {
      if (name === 'session' && key === 'submissionFenceUntil') throw new Error('Synthetic fence read failure');
    };
    let cancelMessage;
    h.chrome.tabs.sendMessage = async (id, message) => {
      cancelMessage = { id, ...message };
      return null;
    };
    const paused = await h.message({ type: 'PAUSE' });
    assert.equal(paused.ok, true);
    assert.deepEqual(cancelMessage, { id: 7, type: 'CANCEL_RUN', runId, resultToken });
    assert.equal((await h.message({ type: 'CHECK_RUN', runId }, h.sender())).allowed, false);
    assert.equal((await h.message({ type: 'CLEAR_DATA' })).ok, true);
    assert.equal(h.state.session.job ?? null, null);
    assert.equal(h.state.local.resumeJob ?? null, null);
    assert.equal(h.state.local.config, undefined);
    assert.ok(Date.now() < deadline, 'The original page lease must still be live');
    restarted = await harness({ local: copy(h.state.local), ...(restart !== 'browser' ? { session: copy(h.state.session) } : {}) });
    const oldRun = await restarted.message({ type: 'CHECK_RUN', runId }, restarted.sender());
    const attempted = await restarted.message({ type: 'START', tabId: 7,
      config: { prompt: 'SYNTHETIC_NEW_RUN', startImmediately: true } });
    observed = {
      oldRunAllowed: oldRun.allowed,
      startAllowed: attempted.ok,
      enabled: Boolean(restarted.state.session.job?.enabled),
      alarm: restarted.state.alarms.has(alarmName),
      sends: restarted.sends().length,
      beforeDeadline: Date.now() < deadline,
    };
  } finally {
    if (restarted) await restarted.message({ type: 'PAUSE' });
    globalThis.chrome = h.chrome;
    h.beforeStorageGet = null;
    injection.resolve({ status: 'cancelled' });
    await round;
  }
  assert.deepEqual(observed, {
    oldRunAllowed: false, startAllowed: false, enabled: false, alarm: false, sends: 0, beforeDeadline: true,
  }, 'Clear and restart must not remove the fence while the old page may still hold a submission lease');
});

for (const failure of ['read', 'write']) for (const restart of ['worker', 'browser']) {
  await scenario(`Failed durable fence ${failure} during Clear preserves the paused task and blocks START after ${restart} restart`, async () => {
    const h = await harness();
    await h.start({ prompt: 'SYNTHETIC_OLD_RUN' });
    const injection = deferred();
    h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
    const round = h.message({ type: 'SEND_NOW' });
    let restarted;
    try {
      await until(() => h.sends().length === 1, 'in-flight synthetic send');
      const { runId, resultToken } = h.sends()[0].args[0];
      const deadline = h.state.session.job.runDeadline;
      assert.ok(Number.isFinite(deadline) && deadline > Date.now());
      let cancelMessage;
      h.chrome.tabs.sendMessage = async (id, message) => { cancelMessage = { id, ...message }; return null; };
      assert.equal((await h.message({ type: 'PAUSE' })).ok, true);
      assert.deepEqual(cancelMessage, { id: 7, type: 'CANCEL_RUN', runId, resultToken });
      const pausedSession = copy(h.state.session.job), pausedLocal = copy(h.state.local.resumeJob);
      assert.equal(pausedSession.enabled, false);
      assert.equal(pausedLocal.enabled, false);
      assert.ok(pausedSession.submissionFenceUntil >= deadline);
      assert.ok(pausedLocal.submissionFenceUntil >= deadline);
      let failures = 0;
      if (failure === 'read') h.beforeStorageGet = (area, key) => {
        if (area === 'local' && key === 'submissionFenceUntil') { failures++; throw new Error('SYNTHETIC_DURABLE_FENCE_READ_FAILURE'); }
      };
      else h.beforeStorageSet = (area, value) => {
        if (area === 'local' && Object.hasOwn(value, 'submissionFenceUntil')) { failures++; throw new Error('SYNTHETIC_DURABLE_FENCE_WRITE_FAILURE'); }
      };
      const cleared = await h.message({ type: 'CLEAR_DATA' });
      assert.equal(failures, 1, 'Clear must reach the injected durable fence failure');
      assert.equal(cleared.ok, false);
      assert.equal(h.state.session.job?.id, pausedSession.id, 'Failed fence persistence must not delete the session task');
      assert.equal(h.state.local.resumeJob?.id, pausedLocal.id, 'Failed fence persistence must not delete the recovery task');
      assert.equal(h.state.session.job.enabled, false);
      assert.equal(h.state.local.resumeJob.enabled, false);
      assert.ok(h.state.session.job.submissionFenceUntil >= deadline);
      assert.ok(h.state.local.resumeJob.submissionFenceUntil >= deadline);
      assert.ok(Date.now() < deadline, 'The original page lease must still be live');
      restarted = await harness({ local: copy(h.state.local), ...(restart === 'worker' ? { session: copy(h.state.session) } : {}) });
      const oldRun = await restarted.message({ type: 'CHECK_RUN', runId }, restarted.sender());
      const attempted = await restarted.message({ type: 'START', tabId: 7,
        config: { prompt: 'SYNTHETIC_NEW_RUN', startImmediately: true } });
      assert.equal(oldRun.allowed, false);
      assert.equal(attempted.ok, false, 'Restart must not bypass the surviving paused task fence');
      assert.equal(restarted.state.session.job?.id, pausedSession.id);
      assert.equal(restarted.state.session.job?.enabled, false);
      assert.equal(restarted.state.alarms.has(alarmName), false);
      assert.equal(restarted.sends().length, 0);
      assert.ok(Date.now() < deadline, 'START must be rejected before the old lease expires');
    } finally {
      if (restarted) await restarted.message({ type: 'PAUSE' });
      globalThis.chrome = h.chrome;
      h.beforeStorageGet = null;
      h.beforeStorageSet = null;
      injection.resolve({ status: 'cancelled' });
      await round;
    }
  });
}

await scenario('Pause revokes an in-flight run when the independent session fence read fails', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const injection = deferred();
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  let observed;
  try {
    await until(() => h.sends().length === 1, 'in-flight synthetic send');
    const { runId, resultToken } = h.sends()[0].args[0];
    assert.equal((await h.message({ type: 'CHECK_RUN', runId }, h.sender())).allowed, true);
    let fenceReads = 0, cancelMessage;
    h.beforeStorageGet = (name, key) => {
      if (name === 'session' && key === 'submissionFenceUntil') {
        fenceReads += 1;
        throw new Error('Synthetic independent session fence read failure');
      }
    };
    h.chrome.tabs.sendMessage = async (id, message) => {
      cancelMessage = { id, ...message };
      return null;
    };
    const paused = await h.message({ type: 'PAUSE' });
    const checked = await h.message({ type: 'CHECK_RUN', runId }, h.sender());
    const completed = await Promise.race([round.then(() => true), delay(500).then(() => false)]);
    observed = {
      fenceReads,
      cancelMessage: { id: cancelMessage?.id, type: cancelMessage?.type, runId: cancelMessage?.runId, resultToken: cancelMessage?.resultToken },
      oldRunAllowed: checked.allowed,
      sessionEnabled: h.state.session.job.enabled,
      localEnabled: h.state.local.resumeJob.enabled,
      runChanged: h.state.session.job.runId !== runId,
      completed,
    };
    assert.deepEqual(observed, {
      fenceReads: 1, cancelMessage: { id: 7, type: 'CANCEL_RUN', runId, resultToken }, oldRunAllowed: false,
      sessionEnabled: false, localEnabled: false, runChanged: true, completed: true,
    }, `Fence read failure must not leave the old run pending or authorized (Pause ok: ${paused.ok})`);
  } finally {
    h.beforeStorageGet = null;
    injection.resolve({ status: 'cancelled' });
    await round;
  }
});

await scenario('A failed session Pause write still attempts page cancellation and denies the old run', async () => {
  const h = await harness();
  await h.start();
  const injection = deferred();
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  let observed;
  try {
    await until(() => h.sends().length === 1, 'in-flight synthetic send');
    const { runId, resultToken } = h.sends()[0].args[0];
    assert.equal((await h.message({ type: 'CHECK_RUN', runId }, h.sender())).allowed, true);
    let failedWrites = 0;
    const cancellations = [];
    h.beforeStorageSet = (name, value) => {
      if (name === 'session' && value.job?.enabled === false) {
        failedWrites += 1;
        throw new Error('SYNTHETIC_SESSION_PAUSE_WRITE_FAILURE');
      }
    };
    h.chrome.tabs.sendMessage = async (id, message, options) => {
      cancellations.push({ id, message: copy(message), options: copy(options) });
      return { revoked: true, runId: message.runId, resultToken: message.resultToken };
    };
    const paused = await h.message({ type: 'PAUSE' });
    const checked = await h.message({ type: 'CHECK_RUN', runId }, h.sender());
    observed = { failedWrites, pauseOk: paused.ok, storedRunId: h.state.session.job.runId,
      storedEnabled: h.state.session.job.enabled, cancellations, oldRunAllowed: checked.allowed };
    assert.deepEqual(observed, {
      failedWrites: 1, pauseOk: false, storedRunId: runId, storedEnabled: true,
      cancellations: [{ id: 7, message: { type: 'CANCEL_RUN', runId, resultToken }, options: { frameId: 0 } }],
      oldRunAllowed: false,
    }, 'A failed pause write must not leave the old page running or authorized');
  } finally {
    h.beforeStorageSet = null;
    await h.message({ type: 'PAUSE' });
    injection.resolve({ status: 'cancelled' });
    await round;
  }
});

for (const channel of ['PAGE_RESULT', 'executeScript']) for (const status of ['sent', 'manual-sent']) {
  await scenario(`Confirmed ${status} via ${channel} during Pause CANCEL_RUN acknowledgement is retained`, async () => {
    const h = await harness();
    await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
    const injection = deferred(), cancellation = deferred();
    h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
    const round = h.message({ type: 'SEND_NOW' });
    await until(() => h.sends().length === 1);
    const args = h.sends()[0].args[0];
    let cancelMessage;
    h.chrome.tabs.sendMessage = async (id, message) => {
      assert.equal(id, 7);
      assert.equal(message.type, 'CANCEL_RUN');
      cancelMessage = message;
      return cancellation.promise;
    };
    const pausing = h.message({ type: 'PAUSE' });
    let receipt, paused, accepted;
    try {
      await until(() => cancelMessage, 'CANCEL_RUN acknowledgement window');
      assert.equal(h.state.session.job.enabled, false);
      assert.equal(h.state.local.resumeJob.enabled, false);
      if (channel === 'PAGE_RESULT') {
        receipt = h.message({ type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken, result: { status } }, h.sender());
      } else {
        injection.resolve({ status });
      }
      await delay(20);
    } finally {
      cancellation.resolve({ revoked: true, runId: args.runId, resultToken: args.resultToken });
      paused = await pausing;
      if (receipt) accepted = await receipt;
      injection.resolve({ status });
      await round;
    }
    assert.equal(paused.ok, true);
    assert.equal(paused.job.enabled, false);
    assert.equal(paused.job.sentCount, status === 'sent' ? 1 : 0);
    assert.equal(paused.job.manualSentCount || 0, status === 'manual-sent' ? 1 : 0);
    assert.equal(paused.job.queueIndex, 1);
    assert.equal(paused.job.nextAt, null);
    if (receipt) assert.equal(accepted.ok, true);
    assert.deepEqual(h.state.session.job, paused.job);
    assert.deepEqual(h.state.local.resumeJob, paused.job);
    assert.equal(h.state.alarms.size, 0);
    const restarted = await harness({ local: copy(h.state.local) });
    assert.equal(restarted.state.session.job.queueIndex, 1);
    assert.equal((await restarted.message({ type: 'RESUME' })).ok, true);
    assert.equal((await restarted.message({ type: 'SEND_NOW' })).ok, true);
    assert.equal(restarted.sends()[0].args[0].prompt, 'SYNTHETIC_SECOND');
    await restarted.message({ type: 'PAUSE' });
  });
}

await scenario('Pause records an unknown dispatched submission when a valid CANCEL_RUN ACK has no receipt', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const injection = deferred();
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1, 'in-flight synthetic send');
  const args = h.sends()[0].args[0];
  let cancelMessage;
  h.chrome.tabs.sendMessage = async (id, message) => {
    cancelMessage = { id, ...message };
    return { revoked: true, runId: args.runId, resultToken: args.resultToken,
      diagnosticProgress: { stage: 'receipt', counters: { dispatchAttempts: 1, manualIntents: 0 } } };
  };
  let paused, session, local, alarms;
  try {
    paused = await h.message({ type: 'PAUSE' });
    session = copy(h.state.session.job);
    local = copy(h.state.local.resumeJob);
    alarms = h.state.alarms.size;
  } finally {
    injection.resolve({ status: 'cancelled' });
    await round;
  }
  assert.deepEqual(cancelMessage, { id: 7, type: 'CANCEL_RUN', runId: args.runId, resultToken: args.resultToken });
  assert.equal(paused.ok, true);
  assert.deepEqual({ enabled: paused.job.enabled, phase: paused.job.phase, nextAt: paused.job.nextAt,
    lastResult: paused.job.lastResult, unknownCount: paused.job.unknownCount, needsAttention: paused.job.needsAttention,
    sentCount: paused.job.sentCount, manualSentCount: paused.job.manualSentCount || 0, queueIndex: paused.job.queueIndex },
  { enabled: false, phase: 'idle', nextAt: null, lastResult: 'unknown', unknownCount: 1, needsAttention: true,
    sentCount: 0, manualSentCount: 0, queueIndex: 0 });
  assert.deepEqual(session, paused.job);
  assert.deepEqual(local, paused.job);
  assert.equal(alarms, 0);
});

await scenario('Manual intent during Pause CANCEL_RUN acknowledgement remains unconfirmed', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const injection = deferred(), cancellation = deferred();
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const args = h.sends()[0].args[0];
  let cancelMessage;
  h.chrome.tabs.sendMessage = async (id, message) => {
    assert.equal(id, 7);
    assert.equal(message.type, 'CANCEL_RUN');
    cancelMessage = message;
    return cancellation.promise;
  };
  const pausing = h.message({ type: 'PAUSE' });
  let manual, paused, accepted;
  try {
    await until(() => cancelMessage, 'CANCEL_RUN acknowledgement window');
    assert.equal(h.state.session.job.enabled, false);
    assert.equal(h.state.local.resumeJob.enabled, false);
    manual = h.message({ type: 'MANUAL_SUBMISSION', runId: args.runId, resultToken: args.resultToken }, h.sender());
    await delay(20);
  } finally {
    cancellation.resolve({ revoked: true, runId: args.runId, resultToken: args.resultToken });
    paused = await pausing;
    if (manual) accepted = await manual;
    injection.resolve({ status: 'cancelled' });
    await round;
  }
  assert.equal(paused.ok, true);
  assert.equal(paused.job.enabled, false);
  assert.equal(paused.job.unknownCount, 1);
  assert.equal(paused.job.needsAttention, true);
  assert.equal(paused.job.sentCount, 0);
  assert.equal(paused.job.manualSentCount || 0, 0);
  assert.equal(paused.job.queueIndex, 0);
  assert.equal(paused.job.nextAt, null);
  assert.equal(accepted.ok, true);
  assert.deepEqual(h.state.session.job, paused.job);
  assert.deepEqual(h.state.local.resumeJob, paused.job);
  assert.equal(h.state.alarms.size, 0);
  const restarted = await harness({ local: copy(h.state.local) });
  assert.equal(restarted.state.session.job.enabled, false);
  assert.equal(restarted.state.session.job.unknownCount, 1);
  assert.equal(restarted.state.session.job.needsAttention, true);
  assert.equal(restarted.sends().length, 0);
});

for (const { status, channel } of [
  { status: 'sent', channel: 'message' },
  { status: 'manual-sent', channel: 'message' },
  { status: 'manual-sent', channel: 'executeScript' },
]) await scenario(`Receipt ${status} via ${channel} during amended Pause persistence is retained`, async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const injection = deferred();
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const args = h.sends()[0].args[0];
  const firstWrite = deferred(), amendedWrite = deferred();
  let writes = 0, amendedSnapshot;
  h.beforeStorageSet = (name, value) => {
    if (name !== 'session' || !value.job || value.job.enabled) return;
    writes += 1;
    if (writes === 1) return firstWrite.promise;
    if (writes === 2) { amendedSnapshot = copy(value.job); return amendedWrite.promise; }
  };
  const pausing = h.message({ type: 'PAUSE' });
  let manual, receipt, paused, accepted;
  try {
    await until(() => writes === 1, 'initial Pause write');
    manual = h.message({ type: 'MANUAL_SUBMISSION', runId: args.runId, resultToken: args.resultToken }, h.sender());
    firstWrite.resolve();
    await until(() => writes === 2, 'amended Pause write');
    assert.equal(amendedSnapshot.unknownCount, 1);
    assert.equal(amendedSnapshot.queueIndex, 0);
    if (channel === 'message') {
      receipt = h.message({ type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken, result: { status } }, h.sender());
    } else {
      injection.resolve({ status });
    }
    await delay(20);
  } finally {
    firstWrite.resolve();
    amendedWrite.resolve();
    paused = await pausing;
    if (receipt) accepted = await receipt;
    injection.resolve({ status });
    if (manual) await manual;
    await round;
  }
  assert.equal(paused.ok, true);
  if (channel === 'message') assert.equal(accepted.ok, true, 'A confirmed receipt must remain admissible throughout Pause persistence');
  assert.equal(paused.job.enabled, false);
  assert.equal(paused.job.sentCount, 0);
  assert.equal(paused.job.manualSentCount || 0, status === 'manual-sent' ? 1 : 0);
  assert.equal(paused.job.unknownCount || 0, status === 'manual-sent' ? 0 : 1);
  assert.equal(paused.job.queueIndex, status === 'manual-sent' ? 1 : 0);
  assert.equal(paused.job.needsAttention, status !== 'manual-sent');
  assert.deepEqual(h.state.local.resumeJob, h.state.session.job);
  assert.deepEqual(h.state.session.job, paused.job);
  assert.equal(h.sends().length, 1);
});

await scenario('A receipt remains recoverable when the amended Pause write fails', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const injection = deferred();
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const args = h.sends()[0].args[0];
  const writing = deferred();
  let entered = false;
  let failOnce = true;
  h.beforeStorageSet = (name, value) => {
    if (name !== 'session' || !value.job || value.job.enabled) return;
    if (!entered) { entered = true; return writing.promise; }
    if (value.job.sentCount === 1 && failOnce) { failOnce = false; throw new Error('Synthetic amended pause failure'); }
  };
  const pausing = h.message({ type: 'PAUSE' });
  await until(() => entered);
  const receipt = h.message({ type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken, result: { status: 'sent' } }, h.sender());
  await delay(20);
  writing.resolve();
  const first = await pausing;
  await receipt;
  await delay(150);
  injection.resolve({ status: 'sent' });
  await h.message({ type: 'PAUSE' });
  await round;
  assert.equal(first.ok, false);
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.state.session.job.sentCount, 1);
  assert.equal(h.state.session.job.queueIndex, 1);
  assert.deepEqual(h.state.local.resumeJob, h.state.session.job);
});

for (const failedArea of ['session', 'local']) await scenario(`executeScript receipt survives a failed ${failedArea} accounting write`, async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const injection = deferred();
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  let failOnce = true;
  h.beforeStorageSet = (name, value) => {
    const job = name === 'session' ? value.job : value.resumeJob;
    if (name === failedArea && job?.phase === 'idle' && job.sentCount === 1 && failOnce) {
      failOnce = false;
      throw new Error('Synthetic receipt persistence failure');
    }
  };
  injection.resolve({ status: 'sent' });
  const result = await Promise.race([round, delay(1000).then(() => null)]);
  await delay(100);
  const saved = copy(h.state.local.resumeJob);
  const current = copy(h.state.session.job);
  await h.message({ type: 'PAUSE' });
  assert.ok(result?.ok, 'The confirmed receipt must recover without a second page message');
  assert.equal(current.sentCount, 1);
  assert.equal(current.queueIndex, 1);
  assert.deepEqual(saved, current);
  assert.equal(h.sends().length, 1);
});

await scenario('A page readback received before queued Pause preserves the receipt', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const injection = deferred();
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const args = h.sends()[0].args[0];
  const reading = deferred();
  let entered = false;
  let checking;
  let pausing;
  const execute = h.chrome.scripting.executeScript;
  h.chrome.scripting.executeScript = async request => {
    if (request.func.name !== 'pageInvocationState') return execute(request);
    h.beforeStorageGet = (name, key) => {
      if (name === 'session' && key === 'job' && !entered) { entered = true; return reading.promise; }
    };
    checking = h.message({ type: 'CHECK_RUN', runId: args.runId }, h.sender());
    await until(() => entered);
    pausing = h.message({ type: 'PAUSE' });
    return [{ frameId: 0, result: { state: 'settled', result: { status: 'sent' } } }];
  };
  for (let attempt = 0; attempt < 1500 && !pausing; attempt += 1) await delay(2);
  assert.ok(pausing, 'page readback must run');
  await delay(20);
  reading.resolve();
  await checking;
  const paused = await pausing;
  injection.resolve({ status: 'sent' });
  await round;
  assert.equal(paused.job.sentCount, 1);
  assert.equal(paused.job.queueIndex, 1);
  assert.equal(paused.job.enabled, false);
  assert.deepEqual(h.state.local.resumeJob, h.state.session.job);
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

await scenario('Interrupted submission recovery pauses instead of scheduling another send', async () => {
  const first = await harness();
  const job = await first.start();
  const before = Date.now();
  const h = await harness({ session: { job: { ...job, phase: 'sending', runKind: 'send', runDeadline: before + 12_000 } } });
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.state.session.job.phase, 'idle');
  assert.equal(h.state.session.job.unknownCount, 1);
  assert.equal(h.state.session.job.nextAt, null);
  assert.equal(h.state.local.resumeJob.enabled, false);
  assert.equal(h.state.alarms.has(alarmName), false);
  await h.tick({ due: false });
  assert.equal(h.sends().length, 0);
  await h.message({ type: 'PAUSE' });
});

for (const restart of ['worker', 'browser']) await scenario(`Legacy unknown idle task must not resend after ${restart} restart`, async () => {
  const first = await harness();
  const started = await first.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_UNCONFIRMED' }, { text: 'SYNTHETIC_NEXT' }] });
  const legacy = { ...started, enabled: true, phase: 'idle', lastResult: 'unknown', unknownCount: 1,
    sentCount: 0, queueIndex: 0, nextAt: Date.now() - 1000 };
  delete legacy.needsAttention;
  delete legacy.unknownRecoveryVersion;
  const h = await harness({ local: { ...copy(first.state.local), resumeJob: copy(legacy) },
    ...(restart === 'worker' ? { session: { job: copy(legacy) } } : {}) });
  if (restart === 'browser') {
    h.chrome.runtime.onStartup.emit();
    await delay(2700);
  }
  await h.tick();
  const observed = { sends: h.sends().length, enabled: h.state.session.job.enabled,
    lastResult: h.state.session.job.lastResult, unknownCount: h.state.session.job.unknownCount,
    sentCount: h.state.session.job.sentCount, queueIndex: h.state.session.job.queueIndex,
    localEnabled: h.state.local.resumeJob.enabled, alarm: h.state.alarms.has(alarmName) };
  await h.message({ type: 'PAUSE' });
  assert.deepEqual(observed, { sends: 0, enabled: false, lastResult: 'unknown', unknownCount: 1,
    sentCount: 0, queueIndex: 0, localEnabled: false, alarm: false },
  'An unconfirmed legacy submission must remain paused until explicit user action');
});

for (const restart of ['worker', 'browser']) for (const language of ['zh_CN', 'en']) for (const lastResult of ['sent', 'missing']) {
  await scenario(`Legacy interrupted send (${language}, lastResult ${lastResult}) pauses after ${restart} restart`, async () => {
    const first = await harness();
    await first.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_CONFIRMED' }, { text: 'SYNTHETIC_UNCONFIRMED' }] });
    const confirmed = await first.message({ type: 'SEND_NOW' });
    assert.equal(confirmed.job.lastResult, 'sent');
    assert.equal(confirmed.job.sentCount, 1);
    assert.equal(confirmed.job.queueIndex, 1);
    const legacy = { ...confirmed.job, enabled: true, phase: 'idle', runKind: null,
      statusText: language === 'zh_CN' ? '上周期执行被中断；完整间隔后继续，未立即重发。'
        : 'The previous cycle was interrupted; continuing after a full interval without an immediate resend.',
      unknownCount: confirmed.job.unknownCount + 1, nextAt: Date.now() + 60_000 };
    if (lastResult === 'missing') delete legacy.lastResult;
    delete legacy.unknownRecoveryVersion;
    const h = await harness({ language, local: { ...copy(first.state.local), resumeJob: copy(legacy) },
      ...(restart === 'worker' ? { session: { job: copy(legacy) } } : {}) });
    try {
      if (restart === 'browser') {
        h.chrome.runtime.onStartup.emit();
        await delay(2700);
      }
      const restored = await h.message({ type: 'GET_STATE' });
      const beforeTick = { enabled: restored.job.enabled, phase: restored.job.phase, nextAt: restored.job.nextAt,
        needsAttention: restored.job.needsAttention, unknownCount: restored.job.unknownCount,
        sentCount: restored.job.sentCount, queueIndex: restored.job.queueIndex,
        localEnabled: h.state.local.resumeJob.enabled, alarm: h.state.alarms.has(alarmName) };
      await h.tick({ due: restored.job.enabled });
      const observed = { ...beforeTick, sends: h.sends().length };
      assert.deepEqual(observed, { enabled: false, phase: 'idle', nextAt: null, needsAttention: true,
        unknownCount: confirmed.job.unknownCount + 1, sentCount: 1, queueIndex: 1, localEnabled: false, alarm: false, sends: 0 },
      'A later interrupted send remains unconfirmed even when the preceding result was sent');
    } finally {
      await h.message({ type: 'PAUSE' });
    }
  });
}

for (const restart of ['worker', 'browser']) for (const language of ['zh_CN', 'en']) {
  for (const target of ['closed', 'changed']) for (const timing of ['future', 'due']) for (const lastResult of ['sent', 'missing']) {
    await scenario(`Legacy ${target} target (${language}, ${timing}, lastResult ${lastResult}) pauses after ${restart} restart`, async () => {
      const first = await harness();
      await first.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_CONFIRMED' }, { text: 'SYNTHETIC_UNCONFIRMED' }] });
      const confirmed = await first.message({ type: 'SEND_NOW' });
      assert.equal(confirmed.job.lastResult, 'sent');
      assert.equal(confirmed.job.sentCount, 1);
      assert.equal(confirmed.job.queueIndex, 1);
      const statusText = target === 'closed'
        ? language === 'zh_CN' ? '发送期间目标关闭，结果未确认；完整间隔后检查原页面。'
          : 'The target closed during sending; the result is unconfirmed. Checking the original page after a full interval.'
        : language === 'zh_CN' ? '发送期间页面改变，结果未确认；完整间隔后检查原地址。'
          : 'The page changed during sending; the result is unconfirmed. Checking the original URL after a full interval.';
      const legacy = { ...confirmed.job, enabled: true, phase: 'idle', runKind: null, tabId: null,
        statusText, unknownCount: confirmed.job.unknownCount + 1,
        nextAt: Date.now() + (timing === 'due' ? -1000 : 60_000) };
      if (lastResult === 'missing') delete legacy.lastResult;
      delete legacy.unknownRecoveryVersion;
      const h = await harness({ language, local: { ...copy(first.state.local), resumeJob: copy(legacy) },
        ...(restart === 'worker' ? { session: { job: copy(legacy) } } : {}) });
      try {
        if (restart === 'browser') {
          h.chrome.runtime.onStartup.emit();
          await delay(2700);
        }
        const restored = await h.message({ type: 'GET_STATE' });
        const beforeTick = { enabled: restored.job.enabled, phase: restored.job.phase, nextAt: restored.job.nextAt,
          needsAttention: restored.job.needsAttention, unknownCount: restored.job.unknownCount,
          sentCount: restored.job.sentCount, queueIndex: restored.job.queueIndex,
          localEnabled: h.state.local.resumeJob.enabled, alarm: h.state.alarms.has(alarmName) };
        await h.tick({ due: restored.job.enabled });
        const observed = { ...beforeTick, sends: h.sends().length };
        assert.deepEqual(observed, { enabled: false, phase: 'idle', nextAt: null, needsAttention: true,
          unknownCount: confirmed.job.unknownCount + 1, sentCount: 1, queueIndex: 1, localEnabled: false, alarm: false, sends: 0 },
        'An unconfirmed legacy target interruption must remain paused, including when its next send is overdue');
      } finally {
        await h.message({ type: 'PAUSE' });
      }
    });
  }
}

for (const restart of ['worker', 'browser']) for (const language of ['zh_CN', 'en']) {
  for (const [notice, lastResult] of [['busy', 'busy'], ['recovery', 'busy'], ['recovery', 'sent'], ['recovery', 'missing']]) {
    await scenario(`Legacy unknown with overwritten ${notice} notice (${language}, lastResult ${lastResult}) must not resend after ${restart} restart`, async () => {
      const first = await harness({ language });
      await first.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_CONFIRMED' }, { text: 'SYNTHETIC_UNCONFIRMED' }] });
      const confirmed = await first.message({ type: 'SEND_NOW' });
      assert.equal(confirmed.job.sentCount, 1);
      assert.equal(confirmed.job.queueIndex, 1);
      const statusText = notice === 'busy'
        ? language === 'zh_CN' ? '目标标签页已休眠或冻结，等待页面恢复。 一分钟后再检查，任务仍保持启用。'
          : 'The target tab is discarded or frozen. Waiting for it to recover. Checking again in one minute; the task remains enabled.'
        : language === 'zh_CN' ? '已从重启中恢复；正在连接目标页面并继续推进…'
          : 'Restored after restart; connecting to the target page to continue…';
      const legacy = { ...confirmed.job, enabled: true, phase: 'idle', runKind: null, statusText,
        lastResult, unknownCount: 1, nextAt: Date.now() + 60_000 };
      if (lastResult === 'missing') delete legacy.lastResult;
      delete legacy.needsAttention;
      delete legacy.unknownRecoveryVersion;
      const h = await harness({ language, local: { ...copy(first.state.local), resumeJob: copy(legacy) },
        ...(restart === 'worker' ? { session: { job: copy(legacy) } } : {}) });
      try {
        if (restart === 'browser') {
          h.chrome.runtime.onStartup.emit();
          await delay(2700);
        }
        const restored = await h.message({ type: 'GET_STATE' });
        const beforeTick = { enabled: restored.job.enabled, phase: restored.job.phase, nextAt: restored.job.nextAt,
          needsAttention: restored.job.needsAttention, unknownCount: restored.job.unknownCount,
          sentCount: restored.job.sentCount, queueIndex: restored.job.queueIndex,
          localEnabled: h.state.local.resumeJob.enabled, alarm: h.state.alarms.has(alarmName) };
        await h.tick({ due: restored.job.enabled });
        const observed = { ...beforeTick, sends: h.sends().length,
          afterSentCount: h.state.session.job.sentCount, afterQueueIndex: h.state.session.job.queueIndex };
        assert.deepEqual(observed, { enabled: false, phase: 'idle', nextAt: null, needsAttention: true,
          unknownCount: 1, sentCount: 1, queueIndex: 1, localEnabled: false, alarm: false, sends: 0,
          afterSentCount: 1, afterQueueIndex: 1 },
        'An unresolved legacy submission must not be replayed merely because its interruption notice was overwritten');
      } finally {
        await h.message({ type: 'PAUSE' });
      }
    });
  }
}

for (const restart of ['worker', 'browser']) await scenario(`A historical unknown followed by sent remains enabled after ${restart} restart`, async () => {
  const first = await harness();
  await first.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_NEXT' }] });
  first.pageResult = async args => args.mode !== 'send' ? { status: 'ready' }
    : first.sends().length === 1 ? { status: 'unknown' } : { status: 'sent' };
  const unknown = await first.message({ type: 'SEND_NOW' });
  assert.equal(unknown.job.enabled, false);
  assert.equal(unknown.job.lastResult, 'unknown');
  assert.equal((await first.message({ type: 'RESUME' })).ok, true);
  const sent = await first.message({ type: 'SEND_NOW' });
  assert.equal(sent.job.enabled, true);
  assert.equal(sent.job.lastResult, 'sent');
  assert.equal(sent.job.unknownCount, 1);
  assert.equal(sent.job.sentCount, 1);
  assert.equal(sent.job.queueIndex, 1);
  const h = await harness({ local: copy(first.state.local),
    ...(restart === 'worker' ? { session: copy(first.state.session) } : {}) });
  try {
    if (restart === 'browser') {
      h.chrome.runtime.onStartup.emit();
      await delay(2700);
    }
    const restored = await h.message({ type: 'GET_STATE' });
    assert.equal(restored.job.enabled, true);
    assert.equal(restored.job.lastResult, 'sent');
    assert.equal(restored.job.unknownCount, 1);
    assert.equal(restored.job.sentCount, 1);
    assert.equal(restored.job.queueIndex, 1);
    assert.equal(h.state.local.resumeJob.enabled, true);
    assert.equal(h.state.alarms.has(alarmName), true);
    assert.equal(h.sends().length, 0);
    const next = await h.message({ type: 'SEND_NOW' });
    assert.equal(next.job.enabled, true);
    assert.equal(next.job.sentCount, 2);
    assert.equal(next.job.unknownCount, 1);
    assert.equal(next.job.queueIndex, 0);
    assert.equal(h.sends()[0].args[0].prompt, 'SYNTHETIC_NEXT');
  } finally {
    await h.message({ type: 'PAUSE' });
  }
});

for (const restart of ['worker', 'browser']) await scenario(`Explicit Resume after unknown remains enabled after ${restart} restart`, async () => {
  const first = await harness();
  await first.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_UNCONFIRMED' }, { text: 'SYNTHETIC_NEXT' }] });
  first.pageResult = async args => args.mode === 'send' ? { status: 'unknown' } : { status: 'ready' };
  const unknown = await first.message({ type: 'SEND_NOW' });
  assert.equal(unknown.job.enabled, false);
  assert.equal(unknown.job.lastResult, 'unknown');
  assert.equal(unknown.job.unknownCount, 1);
  const resumed = await first.message({ type: 'RESUME' });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.job.enabled, true);
  assert.equal(resumed.job.lastResult, 'unknown');
  assert.equal(first.state.local.resumeJob.enabled, true);
  const h = await harness({ local: copy(first.state.local),
    ...(restart === 'worker' ? { session: copy(first.state.session) } : {}) });
  try {
    if (restart === 'browser') {
      h.chrome.runtime.onStartup.emit();
      await delay(2700);
    }
    const restored = await h.message({ type: 'GET_STATE' });
    assert.equal(restored.job.enabled, true);
    assert.equal(restored.job.lastResult, 'unknown');
    assert.equal(restored.job.unknownCount, 1);
    assert.equal(restored.job.sentCount, 0);
    assert.equal(restored.job.queueIndex, 0);
    assert.equal(h.state.local.resumeJob.enabled, true);
    assert.equal(h.state.alarms.has(alarmName), true);
    assert.equal(h.sends().length, 0);
    const retry = await h.message({ type: 'SEND_NOW' });
    assert.equal(retry.job.enabled, true);
    assert.equal(retry.job.lastResult, 'sent');
    assert.equal(retry.job.unknownCount, 1);
    assert.equal(retry.job.sentCount, 1);
    assert.equal(retry.job.queueIndex, 1);
    assert.equal(h.sends()[0].args[0].prompt, 'SYNTHETIC_UNCONFIRMED');
  } finally {
    await h.message({ type: 'PAUSE' });
  }
});

await scenario('Each task round reserves a stable timestamp and ordinal across Pause, restart and explicit Resume', async () => {
  const h = await harness();
  const job = await h.start({ prompt: 'SYNTHETIC_NAMED_ATTACHMENT' });
  const first = deferred();
  h.pageResult = args => args.mode === 'send' ? first.promise : Promise.resolve({ status: 'ready' });
  const sending = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const initial = h.sends()[0].args[0].promptDelivery;
  assert.equal(initial.ordinal, 1);
  assert.ok(Number.isSafeInteger(initial.issuedAt));
  assert.equal(h.state.session.job.promptDelivery.ordinal, 1);
  assert.deepEqual(h.state.local.resumeJob.promptDelivery, initial);
  await h.message({ type: 'PAUSE' });
  first.resolve({ status: 'cancelled' });
  await sending;
  const restarted = await harness({ local: copy(h.state.local), tabs: [{ id: 19, url: originalUrl }] });
  assert.deepEqual(restarted.state.session.job.promptDelivery, initial);
  assert.equal((await restarted.message({ type: 'RESUME' })).ok, true);
  const confirmed = await restarted.message({ type: 'SEND_NOW' });
  assert.equal(confirmed.job.sentCount, 1);
  assert.equal(confirmed.job.promptDelivery, null);
  assert.deepEqual(restarted.sends()[0].args[0].promptDelivery, initial);
  await restarted.message({ type: 'SEND_NOW' });
  const next = restarted.sends()[1].args[0].promptDelivery;
  assert.equal(next.ordinal, 2);
  assert.ok(next.issuedAt >= initial.issuedAt);
  await restarted.message({ type: 'PAUSE' });
  const newJob = await restarted.start({ prompt: 'SYNTHETIC_FRESH_TASK' }, 19);
  assert.notEqual(newJob.id, job.id);
  await restarted.message({ type: 'SEND_NOW' });
  assert.equal(restarted.sends().at(-1).args[0].promptDelivery.ordinal, 1);
  await restarted.message({ type: 'PAUSE' });
});

await scenario('A known-unsent automatic retry keeps one prompt ordinal and timestamp', async () => {
  const h = await harness();
  await h.start();
  h.pageResult = args => args.mode === 'check' ? { status: 'ready' }
    : h.sends().length === 1 ? { status: 'blocked', retryable: true,
      diagnosticProgress: { counters: { dispatchAttempts: 0, manualIntents: 0 } } } : { status: 'sent' };
  const result = await h.message({ type: 'SEND_NOW' });
  assert.equal(result.ok, true);
  assert.equal(result.job.sentCount, 1);
  assert.equal(h.sends().length, 2);
  assert.deepEqual(h.sends()[0].args[0].promptDelivery, h.sends()[1].args[0].promptDelivery);
  assert.equal(h.sends()[0].args[0].promptDelivery.ordinal, 1);
  await h.message({ type: 'PAUSE' });
});

await scenario('Unknown delivery keeps its filename reservation across restart and explicit retry', async () => {
  const first = await harness();
  await first.start();
  first.pageResult = async args => args.mode === 'check' ? { status: 'ready' } : { status: 'unknown' };
  const result = await first.message({ type: 'SEND_NOW' });
  const reservation = first.sends()[0].args[0].promptDelivery;
  assert.equal(result.job.enabled, false);
  assert.equal(result.job.nextAt, null);
  assert.equal(first.state.local.resumeJob.enabled, false);
  assert.deepEqual(result.job.promptDelivery, reservation);
  assert.equal(result.job.sentCount, 0);
  const reopened = await harness({ local: copy(first.state.local), tabs: [{ id: 19, url: originalUrl }] });
  assert.deepEqual(reopened.state.session.job.promptDelivery, reservation);
  assert.equal(reopened.state.session.job.enabled, false);
  assert.equal((await reopened.message({ type: 'SEND_NOW' })).ok, false);
  assert.equal(reopened.sends().length, 0);
  assert.equal((await reopened.message({ type: 'RESUME' })).ok, true);
  const confirmed = await reopened.message({ type: 'SEND_NOW' });
  assert.deepEqual(reopened.sends()[0].args[0].promptDelivery, reservation);
  assert.equal(confirmed.job.sentCount, 1);
  assert.equal(confirmed.job.unknownCount, 1);
  assert.equal(confirmed.job.promptDelivery, null);
  await reopened.message({ type: 'PAUSE' });
});

for (const status of ['sent', 'manual-sent']) await scenario(`A ${status} receipt during Pause advances the reserved ordinal once`, async () => {
  const h = await harness();
  await h.start();
  const injection = deferred(), release = deferred();
  let entered = false;
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  const sending = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  const args = h.sends()[0].args[0];
  h.beforeStorageGet = (name, key) => {
    if (name === 'session' && key === 'job' && !entered) { entered = true; return release.promise; }
  };
  const checking = h.message({ type: 'CHECK_RUN', runId: args.runId }, h.sender());
  await until(() => entered);
  const pausing = h.message({ type: 'PAUSE' });
  const receipt = h.message({ type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken,
    result: { status } }, h.sender());
  release.resolve();
  await checking;
  const paused = await pausing;
  await receipt;
  injection.resolve({ status });
  await sending;
  assert.equal(paused.job.promptDelivery, null);
  assert.equal(paused.job.sentCount + (paused.job.manualSentCount || 0), 1);
  assert.equal((await h.message({ type: 'RESUME' })).ok, true);
  h.pageResult = async () => ({ status: 'sent' });
  await h.message({ type: 'SEND_NOW' });
  assert.equal(h.sends().at(-1).args[0].promptDelivery.ordinal, 2);
  await h.message({ type: 'PAUSE' });
});

await scenario('Invalid stored delivery metadata never starts a new page admission', async () => {
  const h = await harness();
  await h.start();
  h.state.session.job.promptDelivery = { ordinal: 2, issuedAt: 0 };
  const result = await h.message({ type: 'SEND_NOW' });
  assert.equal(result.ok, false);
  assert.equal(h.sends().length, 0);
  assert.equal(h.state.session.job.phase, 'idle');
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

for (const mode of ['repeat', 'queue-loop']) {
  await scenario(`An unknown ${mode} attempt pauses until explicit retry while preserving unconfirmed accounting`, async () => {
    const h = await harness();
    await h.start(mode === 'repeat' ? {} : { mode, queue: [{ text: 'SYNTHETIC_QUEUE_FIRST' }, { text: 'SYNTHETIC_QUEUE_SECOND' }] });
    h.pageResult = async args => args.mode !== 'send' ? { status: 'ready' }
      : h.sends().length === 1 ? { status: 'unknown' } : { status: 'sent' };
    const first = await h.message({ type: 'SEND_NOW' });
    assert.equal(first.job.enabled, false);
    assert.equal(first.job.nextAt, null);
    assert.equal(first.job.needsAttention, true);
    assert.equal(first.job.lastResult, 'unknown');
    assert.equal(first.job.unknownCount, 1);
    assert.equal(first.job.sentCount, 0);
    assert.equal(first.job.queueIndex, 0);
    assert.equal(h.state.alarms.has(alarmName), false);
    assert.equal(h.state.local.resumeJob.enabled, false);
    assert.equal((await h.message({ type: 'SEND_NOW' })).ok, false);
    assert.equal(h.sends().length, 1);
    assert.equal((await h.message({ type: 'RESUME' })).ok, true);
    const second = await h.message({ type: 'SEND_NOW' });
    assert.equal(second.job.enabled, true);
    assert.equal(second.job.sentCount, 1);
    assert.equal(second.job.unknownCount, 1);
    assert.equal(second.job.queueIndex, mode === 'repeat' ? 0 : 1);
    assert.equal(h.sends().length, 2);
    assert.equal(h.sends()[0].args[0].prompt, h.sends()[1].args[0].prompt);
    await h.message({ type: 'PAUSE' });
  });
}

await scenario('A proven dispatched unknown attempt pauses without counting or replaying an unconfirmed receipt', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  h.pageResult = async args => args.mode !== 'send' ? { status: 'ready' }
    : h.sends().length === 1 ? { status: 'unknown', diagnosticProgress: {
      stage: 'receipt', counters: { dispatchAttempts: 1, manualIntents: 0 },
    } } : { status: 'sent' };
  const first = await h.message({ type: 'SEND_NOW' });
  assert.equal(first.job.enabled, false);
  assert.equal(first.job.lastResult, 'unknown');
  assert.equal(first.job.unknownCount, 1);
  assert.equal(first.job.sentCount, 0);
  assert.equal(first.job.queueIndex, 0);
  await until(() => h.state.local.logs?.some(entry => entry.event === 'unconfirmed'), 'unconfirmed activity');
  assert.ok(first.job.statusText.includes('未确认'));
  const exported = buildActivityExport({ logs: h.state.local.logs, deliveries: h.state.local.deliveryDiagnostics });
  assert.equal(exported.logs.findLast(entry => entry.event === 'unconfirmed').diagnostic.code, 'adapter-result');
  assert.equal(JSON.stringify(exported).includes('SYNTHETIC_FIRST'), false);
  const second = await h.message({ type: 'SEND_NOW' });
  assert.equal(second.ok, false);
  assert.equal(h.sends().length, 1);
  await h.message({ type: 'PAUSE' });
});

for (const variant of ['adapter unknown', 'missing trace', 'retryable result', 'invalid adapter result']) {
  await scenario(`A MAIN-dispatched ${variant} must not retry an unconfirmed submission`, async () => {
    const h = await harness();
    await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
    if (variant === 'missing trace') h.beforeStorageGet = (area, key) => {
      if (area === 'local' && key === 'deliveryDiagnostics') throw new Error('SYNTHETIC_TRACE_UNAVAILABLE');
    };
    const execute = h.chrome.scripting.executeScript;
    const sendMessage = h.chrome.tabs.sendMessage;
    const phases = [];
    h.chrome.tabs.sendMessage = async (id, message) => message.type === 'GRANT_RUN'
      ? { granted: true, runId: message.runId, resultToken: message.resultToken, runDeadline: message.runDeadline }
      : sendMessage(id, message);
    h.chrome.scripting.executeScript = async request => {
      if (request.world !== 'MAIN') return execute(request);
      const phase = request.args[0].phase;
      phases.push(phase);
      return [{ frameId: 0, result: phase === 'prepare'
        ? { supported: true, dispatched: false, code: 'prepared', hasSend: true }
        : phase === 'observe' ? { supported: true, dispatched: false, code: 'ready', hasSend: true }
          : { supported: true, dispatched: true, diagnosticProgress: { counters: { dispatchAttempts: 1 } } } }];
    };
    let commit;
    h.pageResult = async args => {
      if (args.mode !== 'send') return { status: 'ready' };
      if (h.sends().length > 1) return { status: 'sent' };
      commit = await h.message({ type: 'COMMIT_RUN', runId: args.runId,
        receiptBoundaryToken: '00000000-0000-0000-0000-000000000001' }, h.sender());
      return variant === 'invalid adapter result'
        ? { status: 'blocked', diagnosticCode: 'composer-changed', diagnosticProgress: { counters: { dispatchAttempts: 0, manualIntents: 0 } } }
        : variant === 'retryable result'
        ? { status: 'blocked', retryable: true, diagnosticProgress: { counters: { dispatchAttempts: 0, manualIntents: 0 } } }
        : { status: 'unknown', diagnosticProgress: { counters: { dispatchAttempts: 0, manualIntents: 0 } } };
    };
    const first = await h.message({ type: 'SEND_NOW' });
    const initial = copy(first.job), saved = copy(h.state.local.resumeJob), alarm = h.state.alarms.has(alarmName);
    const realNow = Date.now, start = realNow();
    let forced, after;
    try {
      Date.now = () => start + 21 * 60_000;
      await h.tick({ due: false });
      forced = await h.message({ type: 'SEND_NOW' });
      after = { job: copy(h.state.session.job), sends: h.sends().length };
    } finally {
      Date.now = realNow;
      await h.message({ type: 'PAUSE' });
    }
    assert.deepEqual(phases, ['prepare', 'observe', 'commit']);
    assert.equal(commit?.dispatched, true, 'MAIN must have actually reported dispatch before the adapter result');
    assert.equal(after.sends, 1, 'A dispatched submission must not be admitted again');
    assert.equal(forced.ok, false, 'Send Now must not replay an unconfirmed submission');
    assert.deepEqual({ enabled: initial.enabled, nextAt: initial.nextAt, result: initial.lastResult,
      unknown: initial.unknownCount, sent: initial.sentCount, queue: initial.queueIndex,
      savedEnabled: saved.enabled, alarm },
    { enabled: false, nextAt: null, result: 'unknown', unknown: 1, sent: 0, queue: 0,
      savedEnabled: false, alarm: false });
    assert.equal(after.job.sentCount, 0);
    assert.equal(after.job.queueIndex, 0);
  });
}

for (const failure of ['throws', 'returns no result']) {
  await scenario(`An uncertain MAIN commit that ${failure} and an adapter unknown must pause without retry`, async () => {
    const h = await harness();
    await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
    const execute = h.chrome.scripting.executeScript;
    const sendMessage = h.chrome.tabs.sendMessage;
    const phases = [];
    h.chrome.tabs.sendMessage = async (id, message) => message.type === 'GRANT_RUN'
      ? { granted: true, runId: message.runId, resultToken: message.resultToken, runDeadline: message.runDeadline }
      : sendMessage(id, message);
    h.chrome.scripting.executeScript = async request => {
      if (request.world !== 'MAIN') return execute(request);
      const phase = request.args[0].phase;
      phases.push(phase);
      if (phase === 'commit') {
        if (failure === 'throws') throw new Error('SYNTHETIC_COMMIT_TRANSPORT_FAILURE');
        return [];
      }
      return [{ frameId: 0, result: phase === 'prepare'
        ? { supported: true, dispatched: false, code: 'prepared', hasSend: true }
        : { supported: true, dispatched: false, code: 'ready', hasSend: true } }];
    };
    let commit;
    h.pageResult = async args => {
      if (args.mode !== 'send') return { status: 'ready' };
      if (h.sends().length > 1) return { status: 'sent' };
      commit = await h.message({ type: 'COMMIT_RUN', runId: args.runId,
        receiptBoundaryToken: '00000000-0000-0000-0000-000000000001' }, h.sender());
      return { status: 'unknown', diagnosticProgress: { counters: { dispatchAttempts: 0, manualIntents: 0 } } };
    };
    const first = await h.message({ type: 'SEND_NOW' });
    const initial = copy(first.job), saved = copy(h.state.local.resumeJob), alarm = h.state.alarms.has(alarmName);
    const realNow = Date.now, start = realNow();
    let forced, after;
    try {
      Date.now = () => start + 21 * 60_000;
      await h.tick({ due: false });
      forced = await h.message({ type: 'SEND_NOW' });
      after = { job: copy(h.state.session.job), sends: h.sends().length };
    } finally {
      Date.now = realNow;
      await h.message({ type: 'PAUSE' });
    }
    assert.deepEqual(phases, ['prepare', 'observe', 'commit']);
    assert.deepEqual(commit, { ok: false, code: 'unknown' }, 'The MAIN commit outcome must be uncertain');
    assert.equal(after.sends, 1, 'An uncertain MAIN commit must not be replayed');
    assert.equal(forced.ok, false, 'Send Now must not replay an uncertain MAIN commit');
    assert.deepEqual({ enabled: initial.enabled, nextAt: initial.nextAt, result: initial.lastResult,
      unknown: initial.unknownCount, sent: initial.sentCount, queue: initial.queueIndex, attention: initial.needsAttention,
      savedEnabled: saved.enabled, savedNextAt: saved.nextAt, alarm },
    { enabled: false, nextAt: null, result: 'unknown', unknown: 1, sent: 0, queue: 0, attention: true,
      savedEnabled: false, savedNextAt: null, alarm: false });
    assert.equal(after.job.sentCount, 0);
    assert.equal(after.job.queueIndex, 0);
  });
}

for (const mode of ['repeat', 'queue-loop']) for (const channel of ['message', 'execute-script']) {
  for (const restart of ['none', 'worker', 'browser']) {
    await scenario(`A dispatched unknown ${mode} ${channel} pauses without replay after ${restart} restart`, async () => {
      const h = await harness();
      await h.start(mode === 'repeat' ? {} : { mode, queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
      const pending = deferred();
      const pageResult = { status: 'unknown', diagnosticProgress: { stage: 'receipt', counters: { dispatchAttempts: 1, manualIntents: 0 } } };
      h.pageResult = args => args.mode === 'send' ? pending.promise : { status: 'ready' };
      const sending = h.message({ type: 'SEND_NOW' });
      await until(() => h.sends().length === 1, 'dispatched synthetic send');
      const args = h.sends()[0].args[0];
      if (channel === 'message') {
        const receipt = await h.message({ type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken, result: pageResult }, h.sender());
        assert.equal(receipt.ok, true);
        await delay(10);
      }
      if (channel === 'execute-script') pending.resolve(pageResult);
      const outcome = await sending;
      if (channel === 'message') pending.resolve({ status: 'unknown' });
      const session = copy(h.state.session), local = copy(h.state.local);
      const originalAlarm = h.state.alarms.has(alarmName);
      const original = copy(outcome.job);
      const realNow = Date.now, start = realNow();
      let current = h, after, forced;
      try {
        Date.now = () => start + 21 * 60_000;
        if (restart !== 'none') {
          current = await harness({ local, ...(restart === 'worker' ? { session, alarms: [...h.state.alarms] } : {}) });
        }
        current.pageResult = async args => args.mode === 'send' ? { status: 'sent' } : { status: 'ready' };
        await current.tick({ due: false });
        forced = await current.message({ type: 'SEND_NOW' });
        after = { job: copy(current.state.session.job), sends: current.sends().length, alarm: current.state.alarms.has(alarmName) };
      } finally {
        Date.now = realNow;
        globalThis.chrome = current.chrome;
        await current.message({ type: 'PAUSE' });
        if (current !== h) {
          globalThis.chrome = h.chrome;
          await h.message({ type: 'PAUSE' });
        }
      }
      assert.equal(original.lastResult, 'unknown');
      assert.equal(original.unknownCount, 1);
      assert.equal(original.sentCount, 0);
      assert.equal(original.manualSentCount || 0, 0);
      assert.equal(original.queueIndex, 0);
      assert.equal(forced.ok, false, 'Send Now must not bypass an unresolved dispatched result');
      assert.deepEqual({ enabled: original.enabled, nextAt: original.nextAt, attention: original.needsAttention, alarm: originalAlarm,
        savedEnabled: local.resumeJob.enabled, savedNextAt: local.resumeJob.nextAt },
      { enabled: false, nextAt: null, attention: true, alarm: false, savedEnabled: false, savedNextAt: null },
      'A dispatched unknown must be durably paused before another scheduler admission');
      assert.deepEqual({ enabled: after.job.enabled, sentCount: after.job.sentCount, manualSentCount: after.job.manualSentCount || 0,
        unknownCount: after.job.unknownCount, queueIndex: after.job.queueIndex, sends: after.sends, alarm: after.alarm },
      { enabled: false, sentCount: 0, manualSentCount: 0, unknownCount: 1, queueIndex: 0,
        sends: restart === 'none' ? 1 : 0, alarm: false }, 'A heartbeat or restart must not replay an unconfirmed dispatched submission');
    });
  }
}

for (const mode of ['repeat', 'queue-loop']) for (const channel of ['message', 'execute-script']) {
  for (const evidence of ['absent', 'empty counters']) for (const restart of ['none', 'worker', 'browser']) {
    await scenario(`An unknown ${mode} ${channel} with ${evidence} dispatch evidence must not replay after ${restart} restart`, async () => {
      const h = await harness();
      await h.start(mode === 'repeat' ? {} : { mode, queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
      const pending = deferred();
      const pageResult = evidence === 'absent' ? { status: 'unknown' }
        : { status: 'unknown', diagnosticProgress: { stage: 'receipt', counters: {} } };
      h.pageResult = args => args.mode === 'send' ? pending.promise : { status: 'ready' };
      const sending = h.message({ type: 'SEND_NOW' });
      await until(() => h.sends().length === 1, 'initial synthetic send');
      const args = h.sends()[0].args[0];
      if (channel === 'message') {
        const receipt = await h.message({ type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken, result: pageResult }, h.sender());
        assert.equal(receipt.ok, true);
        await delay(10);
      } else pending.resolve(pageResult);
      const outcome = await sending;
      if (channel === 'message') pending.resolve(pageResult);
      const session = copy(h.state.session), local = copy(h.state.local);
      const original = copy(outcome.job), originalAlarm = h.state.alarms.has(alarmName);
      const realNow = Date.now, start = realNow();
      let current = h, after, forced;
      try {
        Date.now = () => start + 21 * 60_000;
        if (restart !== 'none') {
          current = await harness({ local, ...(restart === 'worker' ? { session, alarms: [...h.state.alarms] } : {}) });
        }
        current.pageResult = async args => args.mode === 'send' ? { status: 'sent' } : { status: 'ready' };
        await current.tick({ due: false });
        forced = await current.message({ type: 'SEND_NOW' });
        after = { job: copy(current.state.session.job), sends: current.sends().length, alarm: current.state.alarms.has(alarmName) };
      } finally {
        Date.now = realNow;
        globalThis.chrome = current.chrome;
        await current.message({ type: 'PAUSE' });
        if (current !== h) {
          globalThis.chrome = h.chrome;
          await h.message({ type: 'PAUSE' });
        }
      }
      assert.equal(after.sends, restart === 'none' ? 1 : 0, 'Missing dispatch evidence must not permit automatic or forced replay');
      assert.equal(forced.ok, false, 'Send Now must not replay an unresolved unknown result');
      assert.deepEqual({ enabled: original.enabled, nextAt: original.nextAt, result: original.lastResult,
        unknown: original.unknownCount, sent: original.sentCount, manual: original.manualSentCount || 0,
        queue: original.queueIndex, attention: original.needsAttention, alarm: originalAlarm,
        savedEnabled: local.resumeJob.enabled, savedNextAt: local.resumeJob.nextAt },
      { enabled: false, nextAt: null, result: 'unknown', unknown: 1, sent: 0, manual: 0,
        queue: 0, attention: true, alarm: false, savedEnabled: false, savedNextAt: null });
      assert.deepEqual({ enabled: after.job.enabled, nextAt: after.job.nextAt, unknown: after.job.unknownCount,
        sent: after.job.sentCount, manual: after.job.manualSentCount || 0, queue: after.job.queueIndex, alarm: after.alarm },
      { enabled: false, nextAt: null, unknown: 1, sent: 0, manual: 0, queue: 0, alarm: false });
    });
  }
}

for (const mode of ['repeat', 'queue-loop']) for (const channel of ['message', 'execute-script']) {
  await scenario(`An unknown ${mode} ${channel} attempt stays paused after recovery until explicit retry`, async () => {
    const h = await harness();
    await h.start(mode === 'repeat' ? {} : { mode, queue: [{ text: 'SYNTHETIC_QUEUE_FIRST' }, { text: 'SYNTHETIC_QUEUE_SECOND' }] });
    const pending = deferred();
    h.pageResult = args => args.mode === 'send' ? pending.promise : { status: 'ready' };
    const sending = h.message({ type: 'SEND_NOW' });
    await until(() => h.sends().length === 1);
    const args = h.sends()[0].args[0];
    if (channel === 'message') {
      const receipt = await h.message({ type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken,
        result: { status: 'unknown' } }, h.sender());
      assert.equal(receipt.ok, true);
    }
    pending.resolve({ status: 'unknown' });
    const result = await sending;
    const saved = copy(h.state.local.resumeJob);
    const alarmPresent = h.state.alarms.has(alarmName);
    const realNow = Date.now, start = realNow();
    let sendsAfterInterval, afterInterval, restored, restoredSends, forced, retry, retryPrompts, diagnostic;
    try {
      h.pageResult = async () => ({ status: 'sent' });
      Date.now = () => start + 21 * 60_000;
      await h.tick({ due: false });
      sendsAfterInterval = h.sends().length;
      afterInterval = copy(h.state.session.job);
      const browser = await harness({ local: { resumeJob: saved } });
      restored = copy(browser.state.session.job);
      await browser.tick({ due: false });
      forced = await browser.message({ type: 'SEND_NOW' });
      restoredSends = browser.sends().length;
      assert.equal((await browser.message({ type: 'RESUME' })).ok, true);
      retry = await browser.message({ type: 'SEND_NOW' });
      retryPrompts = browser.sends().map(request => request.args[0].prompt);
      await browser.message({ type: 'PAUSE' });
      globalThis.chrome = h.chrome;
      await h.message({ type: 'PAUSE' });
      diagnostic = await h.message({ type: 'CHECK_TIMING' });
    } finally {
      Date.now = realNow;
      globalThis.chrome = h.chrome;
      await h.message({ type: 'PAUSE' });
    }
    assert.equal(result.job.lastResult, 'unknown');
    assert.equal(result.job.enabled, false);
    assert.equal(result.job.nextAt, null);
    assert.equal(result.job.needsAttention, true);
    assert.equal(result.job.unknownCount, 1);
    assert.equal(result.job.sentCount, 0);
    assert.equal(result.job.queueIndex, 0);
    assert.equal(saved.enabled, false);
    assert.equal(saved.nextAt, null);
    assert.equal(alarmPresent, false);
    assert.equal(sendsAfterInterval, 1);
    assert.equal(afterInterval.sentCount, 0);
    assert.equal(afterInterval.unknownCount, 1);
    assert.equal(afterInterval.queueIndex, 0);
    assert.equal(restored.enabled, false);
    assert.equal(restored.nextAt, null);
    assert.equal(restored.unknownCount, 1);
    assert.equal(restored.queueIndex, 0);
    assert.equal(forced.ok, false);
    assert.equal(restoredSends, 0);
    assert.equal(retry.job.sentCount, 1);
    assert.equal(retry.job.unknownCount, 1);
    assert.equal(retry.job.queueIndex, mode === 'repeat' ? 0 : 1);
    assert.deepEqual(retryPrompts, [args.prompt]);
    assert.equal(diagnostic.ok, true);
    assert.equal(h.sends().length, 1);
  });
}

await scenario('Pausing an unknown result retains the bound task for a no-send diagnostic', async () => {
  const h = await harness();
  await h.start();
  h.pageResult = async args => args.mode === 'send' ? { status: 'unknown' } : { status: 'ready' };
  await h.message({ type: 'SEND_NOW' });
  await h.message({ type: 'PAUSE' });
  const result = await h.message({ type: 'CHECK_TIMING' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(h.sends().length, 1);
  await h.message({ type: 'PAUSE' });
});

for (const diagnosticCode of ['paste-unconfirmed', 'paste-attachment-unconfirmed']) await scenario(`A ${diagnosticCode} result pauses durably without replaying the queue item`, async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  h.pageResult = async args => args.mode === 'send'
    ? { status: 'unknown', diagnosticCode }
    : { status: 'ready' };
  const result = await h.message({ type: 'SEND_NOW' });
  const saved = copy(h.state.local.resumeJob);
  const alarmPresent = h.state.alarms.has(alarmName);
  const realNow = Date.now, start = realNow();
  let sendsAfterHeartbeat, forced, restored, restoredSends;
  try {
    h.pageResult = async () => ({ status: 'sent' });
    Date.now = () => start + 21 * 60_000;
    await h.tick({ due: false });
    sendsAfterHeartbeat = h.sends().length;
    forced = await h.message({ type: 'SEND_NOW' });
    const browser = await harness({ local: { resumeJob: saved } });
    restored = copy(browser.state.session.job);
    await browser.tick({ due: false });
    restoredSends = browser.sends().length;
    await browser.message({ type: 'PAUSE' });
  } finally {
    Date.now = realNow;
    globalThis.chrome = h.chrome;
    await h.message({ type: 'PAUSE' });
  }
  assert.equal(result.job.lastResult, 'unknown');
  assert.equal(result.job.enabled, false);
  assert.equal(result.job.lastDiagnosticCode, diagnosticCode);
  assert.equal(result.job.phase, 'idle');
  assert.equal(result.job.nextAt, null);
  assert.equal(result.job.needsAttention, true);
  assert.equal(result.job.unknownCount, 1);
  assert.equal(result.job.sentCount, 0);
  assert.equal(result.job.queueIndex, 0);
  assert.equal(saved.enabled, false);
  assert.equal(saved.nextAt, null);
  assert.equal(alarmPresent, false);
  assert.equal(sendsAfterHeartbeat, 1);
  assert.equal(forced.ok, false);
  assert.equal(restored.enabled, false);
  assert.equal(restoredSends, 0);
});

for (const mode of ['repeat', 'queue-loop']) {
  for (const channel of ['execute-script', 'extension-message']) {
    await scenario(`NBSP/space ambiguous receipt pauses ${mode} without scheduled replay via ${channel}`, async () => {
      const h = await harness();
      const prompt = 'SYNTHETIC\u00a0RECEIPT';
      await h.start(mode === 'repeat' ? { prompt } : { mode, queue: [{ text: prompt }, { text: 'SYNTHETIC_NEXT' }] });
      const pending = deferred();
      const pageResult = { status: 'unknown', diagnosticCode: 'receipt-ambiguous' };
      h.pageResult = args => args.mode === 'send' ? pending.promise : { status: 'ready' };
      const sending = h.message({ type: 'SEND_NOW' });
      await until(() => h.sends().length === 1);
      const args = h.sends()[0].args[0];
      if (channel === 'extension-message') {
        assert.equal((await h.message({ type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken, result: pageResult }, h.sender())).ok, true);
      } else pending.resolve(pageResult);
      const result = await sending;
      pending.resolve(pageResult);
      const saved = copy(h.state.local.resumeJob);
      const alarmPresent = h.state.alarms.has(alarmName);
      const realNow = Date.now, start = realNow();
      let sendsAfterInterval, forced, restored, restoredSends;
      try {
        h.pageResult = async () => ({ status: 'sent' });
        Date.now = () => start + 21 * 60_000;
        await h.tick({ due: false });
        sendsAfterInterval = h.sends().length;
        forced = await h.message({ type: 'SEND_NOW' });
        const browser = await harness({ local: { resumeJob: saved } });
        restored = copy(browser.state.session.job);
        await browser.tick({ due: false });
        restoredSends = browser.sends().length;
        await browser.message({ type: 'PAUSE' });
      } finally {
        Date.now = realNow;
        globalThis.chrome = h.chrome;
        await h.message({ type: 'PAUSE' });
      }
      assert.equal(result.job.lastResult, 'unknown');
      assert.equal(result.job.enabled, false);
      assert.equal(result.job.lastDiagnosticCode, 'receipt-ambiguous');
      assert.equal(result.job.phase, 'idle');
      assert.equal(result.job.nextAt, null);
      assert.equal(result.job.needsAttention, true);
      assert.equal(result.job.unknownCount, 1);
      assert.equal(result.job.sentCount, 0);
      assert.equal(result.job.queueIndex, 0);
      assert.equal(saved.enabled, false);
      assert.equal(saved.nextAt, null);
      assert.equal(alarmPresent, false);
      assert.equal(sendsAfterInterval, 1);
      assert.equal(forced.ok, false);
      assert.equal(restored.enabled, false);
      assert.equal(restoredSends, 0);
    });
  }
}

for (const channel of ['execute-script', 'extension-message']) {
  await scenario(`Paste-unconfirmed ${channel} records content-free activity and delivery diagnostics`, async () => {
    const h = await harness();
    const privateText = 'SYNTHETIC_PRIVATE_PROMPT_PATH_URL';
    await h.start({ prompt: privateText });
    const pending = deferred();
    h.pageResult = args => args.mode === 'send' ? pending.promise : { status: 'ready' };
    const sending = h.message({ type: 'SEND_NOW' });
    await until(() => h.sends().length === 1);
    const args = h.sends()[0].args[0];
    const pageResult = { status: 'unknown', diagnosticCode: 'paste-unconfirmed', message: privateText,
      diagnosticProgress: { stage: 'prepare', reason: privateText, prompt: privateText, observations: { content: privateText } } };
    if (channel === 'extension-message') {
      assert.equal((await h.message({ type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken, result: pageResult }, h.sender())).ok, true);
    } else pending.resolve(pageResult);
    const outcome = await sending;
    pending.resolve(pageResult);
    await until(() => h.state.local.deliveryDiagnostics?.at(-1)?.state === 'unknown');
    const trace = h.state.local.deliveryDiagnostics.at(-1);
    const activity = h.state.local.logs.find(entry => entry.event === 'unconfirmed');
    assert.equal(outcome.job.enabled, false);
    assert.equal(outcome.job.queueIndex, 0);
    assert.equal(trace.reason, 'paste-unconfirmed');
    assert.equal(trace.history.at(-1).reason, 'paste-unconfirmed');
    assert.equal(trace.resultChannel, channel);
    assert.equal(activity.diagnostic.code, 'paste-unconfirmed');
    assert.equal(activity.diagnostic.resultChannel, channel);
    assert.equal(JSON.stringify({ trace, logs: h.state.local.logs }).includes(privateText), false);
    const exported = buildActivityExport({ logs: h.state.local.logs, deliveries: h.state.local.deliveryDiagnostics });
    assert.equal(exported.deliveries.at(-1).reason, 'paste-unconfirmed');
    assert.equal(exported.logs.find(entry => entry.event === 'unconfirmed').diagnostic.code, 'paste-unconfirmed');
    assert.equal(JSON.stringify(exported).includes(privateText), false);
  });
}

for (const channel of ['execute-script', 'extension-message']) {
  await scenario(`A mismatched receipt pauses and exports a content-free reason via ${channel}`, async () => {
    const h = await harness();
    const privateText = 'SYNTHETIC_PRIVATE_PROMPT_PATH_URL';
    await h.start({ prompt: privateText, mode: 'queue-loop', queue: [{ text: privateText }, { text: 'SYNTHETIC_NEXT' }] });
    const pending = deferred();
    h.pageResult = args => args.mode === 'send' ? pending.promise : { status: 'ready' };
    const sending = h.message({ type: 'SEND_NOW' });
    await until(() => h.sends().length === 1);
    const args = h.sends()[0].args[0];
    const pageResult = { status: 'unknown', diagnosticCode: 'receipt-mismatch', message: privateText,
      diagnosticProgress: { stage: 'receipt', reason: privateText, prompt: privateText, observations: { content: privateText } } };
    if (channel === 'extension-message') {
      assert.equal((await h.message({ type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken, result: pageResult }, h.sender())).ok, true);
    } else pending.resolve(pageResult);
    const outcome = await sending;
    pending.resolve(pageResult);
    await until(() => h.state.local.deliveryDiagnostics?.at(-1)?.state === 'unknown');
    const trace = h.state.local.deliveryDiagnostics.at(-1);
    const activity = h.state.local.logs.findLast(entry => entry.event === 'unconfirmed');
    assert.equal(outcome.job.enabled, false);
    assert.equal(outcome.job.lastDiagnosticCode, 'receipt-mismatch');
    assert.equal(outcome.job.queueIndex, 0);
    assert.equal(outcome.job.sentCount, 0);
    assert.equal(trace.reason, 'receipt-mismatch');
    assert.equal(activity.diagnostic.code, 'receipt-mismatch');
    const exported = buildActivityExport({ logs: h.state.local.logs, deliveries: h.state.local.deliveryDiagnostics });
    assert.equal(exported.deliveries.at(-1).reason, 'receipt-mismatch');
    assert.equal(exported.logs.findLast(entry => entry.event === 'unconfirmed').diagnostic.code, 'receipt-mismatch');
    assert.equal(JSON.stringify({ trace, logs: h.state.local.logs, exported }).includes(privateText), false);
  });
}

for (const channel of ['execute-script', 'extension-message']) {
  await scenario(`Manual intent with a mismatched receipt retains the content-free diagnostic via ${channel}`, async () => {
    const h = await harness();
    const privateText = 'SYNTHETIC_MANUAL_PROMPT_PRIVATE';
    await h.start({ prompt: privateText });
    const pending = deferred();
    h.pageResult = args => args.mode === 'send' ? pending.promise : { status: 'ready' };
    const sending = h.message({ type: 'SEND_NOW' });
    await until(() => h.sends().length === 1);
    const args = h.sends()[0].args[0];
    const pageResult = { status: 'unknown', diagnosticCode: 'receipt-mismatch', message: privateText,
      diagnosticProgress: { observations: { manualPending: true, content: privateText } } };
    if (channel === 'extension-message') {
      assert.equal((await h.message({ type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken, result: pageResult }, h.sender())).ok, true);
    } else pending.resolve(pageResult);
    const outcome = await sending;
    pending.resolve(pageResult);
    await until(() => h.state.local.deliveryDiagnostics?.at(-1)?.state === 'unknown');
    const trace = h.state.local.deliveryDiagnostics.at(-1);
    const activity = h.state.local.logs.findLast(entry => entry.event === 'unconfirmed');
    assert.equal(outcome.job.enabled, false);
    assert.equal(outcome.job.unknownCount, 1);
    assert.equal(outcome.job.lastDiagnosticCode, 'receipt-mismatch');
    assert.equal(trace.reason, 'receipt-mismatch');
    assert.equal(activity.diagnostic?.code, 'receipt-mismatch');
    const exported = buildActivityExport({ logs: h.state.local.logs, deliveries: h.state.local.deliveryDiagnostics });
    assert.equal(exported.logs.findLast(entry => entry.event === 'unconfirmed').diagnostic.code, 'receipt-mismatch');
    assert.equal(JSON.stringify({ trace, logs: h.state.local.logs, exported }).includes(privateText), false);
  });
}

await scenario('Busy, draft and page errors without submission evidence pause and preserve the queue', async () => {
  for (const status of ['busy', 'draft', 'error', 'blocked']) for (const counters of [null, {}, { dispatchAttempts: 0 }, { manualIntents: 0 }]) {
    const h = await harness();
    await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_QUEUE_ITEM' }, { text: 'SYNTHETIC_NEXT_ITEM' }] });
    h.pageResult = async () => ({ status, message: 'Synthetic fixed status', retryable: true,
      ...(counters === null ? {} : { diagnosticProgress: { counters } }) });
    const result = await h.message({ type: 'SEND_NOW' });
    assert.equal(result.job.enabled, false);
    assert.equal(result.job.lastResult, 'unknown');
    assert.equal(result.job.unknownCount, 1);
    assert.equal(result.job.queueIndex, 0);
    assert.equal(result.job.sentCount, 0);
    assert.equal(result.job.nextAt, null);
    assert.equal(h.state.local.resumeJob.enabled, false);
    assert.equal(h.state.alarms.has(alarmName), false);
    h.pageResult = async () => ({ status: 'sent' });
    await h.tick({ due: false });
    assert.equal((await h.message({ type: 'SEND_NOW' })).ok, false);
    assert.equal(h.sends().length, 1);
    assert.equal((await h.message({ type: 'RESUME' })).ok, true);
    assert.equal((await h.message({ type: 'SEND_NOW' })).job.queueIndex, 1);
    assert.deepEqual(h.sends().map(request => request.args[0].prompt), ['SYNTHETIC_QUEUE_ITEM', 'SYNTHETIC_QUEUE_ITEM']);
    await h.message({ type: 'PAUSE' });
  }
});

await scenario('A slow known-unsent mutation retries without treating duration as a terminal limit', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  h.pageResult = async args => args.mode === 'send'
    ? h.sends().length === 1 ? { status: 'busy', retryable: true, diagnosticProgress: {
      stage: 'prepare', counters: { domWrites: 1, dispatchAttempts: 0, manualIntents: 0 }, timings: { maxDomWriteMs: 3000 },
    } } : { status: 'sent' }
    : { status: 'ready' };
  const round = h.message({ type: 'SEND_NOW' });
  const finished = await Promise.race([round, delay(5000).then(() => null)]);
  if (!finished) await h.message({ type: 'PAUSE' });
  await round;
  assert.ok(finished, 'Known-unsent slow writes must keep progressing');
  assert.equal(finished.job.enabled, true);
  assert.equal(finished.job.sentCount, 1);
  assert.equal(finished.job.unknownCount, 0);
  assert.equal(finished.job.queueIndex, 1);
  assert.equal(h.sends().length, 2);
  assert.deepEqual(h.sends()[0].args[0].promptDelivery, h.sends()[1].args[0].promptDelivery);
  await until(() => h.state.local.deliveryDiagnostics?.at(-1)?.state === 'sent', 'slow-write trace');
  const exported = buildActivityExport({ logs: h.state.local.logs, deliveries: h.state.local.deliveryDiagnostics });
  assert.equal(exported.deliveries.at(-1).state, 'sent');
  assert.ok(exported.deliveries.at(-1).timings.maxDomWriteMs >= 3000);
  assert.equal(JSON.stringify(exported).includes('SYNTHETIC_FIRST'), false);
  await h.message({ type: 'PAUSE' });
});

for (const counter of ['dispatchAttempts', 'manualIntents']) {
  await scenario(`A retryable result with ${counter} remains unknown without immediate readmission`, async () => {
    const h = await harness();
    await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
    h.pageResult = async args => args.mode === 'send'
      ? { status: 'busy', retryable: true, diagnosticProgress: {
        stage: 'receipt', counters: { [counter]: 1 }, timings: { maxDomWriteMs: 3000 },
      } }
      : { status: 'ready' };
    const round = h.message({ type: 'SEND_NOW' });
    const finished = await Promise.race([round, delay(1500).then(() => null)]);
    if (!finished) await h.message({ type: 'PAUSE' });
    await round;
    assert.ok(finished, 'A possible submit must settle without a fresh admission');
    assert.equal(finished.job.lastResult, 'unknown');
    assert.equal(finished.job.unknownCount, 1);
    assert.equal(finished.job.sentCount, 0);
    assert.equal(finished.job.queueIndex, 0);
    assert.equal(finished.job.enabled, false);
    assert.equal(finished.job.nextAt, null);
    assert.equal(h.state.local.resumeJob.enabled, false);
    assert.equal(h.sends().length, 1);
    await h.message({ type: 'PAUSE' });
  });
}

for (const duration of [20, 3000]) {
  for (const source of ['dispatch', 'manual', 'missing']) {
    await scenario(`A ${source} retryable result after a ${duration}ms write is not replayed as known-unsent`, async () => {
      const h = await harness();
      await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
      h.pageResult = async args => args.mode !== 'send' ? { status: 'ready' }
        : h.sends().length > 1 ? { status: 'sent' }
          : { status: 'busy', retryable: true, diagnosticProgress: {
            stage: 'receipt', counters: source === 'dispatch' ? { dispatchAttempts: 1, manualIntents: 0 }
              : source === 'manual' ? { dispatchAttempts: 0, manualIntents: 1 } : {},
            timings: { maxDomWriteMs: duration },
          } };
      const round = h.message({ type: 'SEND_NOW' });
      const finished = await Promise.race([round, delay(5000).then(() => null)]);
      if (!finished) await h.message({ type: 'PAUSE' });
      await round;
      assert.ok(finished);
      assert.equal(finished.job.enabled, false);
      assert.equal(finished.job.nextAt, null);
      assert.equal(finished.job.needsAttention, true);
      assert.equal(h.state.local.resumeJob.enabled, false);
      assert.equal(h.state.alarms.has(alarmName), false);
      assert.equal(finished.job.lastResult, 'unknown');
      assert.equal(finished.job.unknownCount, 1);
      assert.equal(finished.job.sentCount, 0);
      assert.equal(finished.job.queueIndex, 0);
      assert.equal(h.sends().length, 1);
      await h.message({ type: 'PAUSE' });
    });
  }
}

await scenario('An unstable composer without submission evidence records an unconfirmed diagnostic', async () => {
  const h = await harness();
  await h.start();
  h.pageResult = async () => ({ status: 'blocked', message: 'SYNTHETIC_COMPOSER_UNSTABLE', diagnosticCode: 'composer-unstable' });
  const result = await h.message({ type: 'SEND_NOW' });
  await until(() => h.state.local.logs?.some(entry => entry.event === 'unconfirmed'), 'unconfirmed activity');
  const unconfirmed = h.state.local.logs.find(entry => entry.event === 'unconfirmed');
  await h.message({ type: 'PAUSE' });
  assert.equal(result.job.enabled, false);
  assert.equal(result.job.lastResult, 'unknown');
  assert.equal(result.job.lastDiagnosticCode, 'adapter-result');
  assert.equal(unconfirmed.diagnostic?.code, 'adapter-result');
  assert.equal(JSON.stringify(unconfirmed).includes('SYNTHETIC_COMPOSER_UNSTABLE'), false);
});

await scenario('An unstable composer without evidence remains paused past the full interval', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_QUEUE_ITEM' }, { text: 'SYNTHETIC_NEXT_ITEM' }] });
  h.pageResult = async () => ({ status: 'blocked', message: 'SYNTHETIC_COMPOSER_UNSTABLE', diagnosticCode: 'composer-unstable' });
  const before = Date.now();
  const result = await h.message({ type: 'SEND_NOW' });
  const realNow = Date.now;
  let quickSends, recovered;
  try {
    h.pageResult = async () => ({ status: 'sent' });
    Date.now = () => before + 65_000;
    await h.tick({ due: false });
    quickSends = h.sends().length;
    Date.now = () => before + 20 * 60_000 + 5_000;
    await h.tick({ due: false });
    recovered = copy(h.state.session.job);
  } finally {
    Date.now = realNow;
    await h.message({ type: 'PAUSE' });
  }
  assert.equal(result.job.enabled, false);
  assert.equal(result.job.lastResult, 'unknown');
  assert.equal(result.job.unknownCount, 1);
  assert.equal(result.job.queueIndex, 0);
  assert.equal(result.job.sentCount, 0);
  assert.equal(quickSends, 1, 'The heartbeat must not send again after one minute');
  assert.equal(result.job.nextAt, null);
  assert.deepEqual(h.sends().map(request => request.args[0].prompt), ['SYNTHETIC_QUEUE_ITEM']);
  assert.equal(recovered.enabled, false);
  assert.equal(recovered.sentCount, 0);
  assert.equal(recovered.queueIndex, 0);
});

await scenario('An unstable composer without evidence leaves the queue recoverable only after Resume', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_QUEUE_ITEM' }, { text: 'SYNTHETIC_NEXT_ITEM' }] });
  h.pageResult = async () => ({ status: 'blocked', message: 'SYNTHETIC_COMPOSER_UNSTABLE', diagnosticCode: 'composer-unstable' });
  const blocked = await h.message({ type: 'SEND_NOW' });
  h.pageResult = async () => ({ status: 'sent' });
  await h.tick({ due: false });
  assert.equal(h.sends().length, 1);
  assert.equal((await h.message({ type: 'SEND_NOW' })).ok, false);
  assert.equal((await h.message({ type: 'RESUME' })).ok, true);
  const recovered = (await h.message({ type: 'SEND_NOW' })).job;
  await h.message({ type: 'PAUSE' });
  assert.equal(blocked.job.enabled, false);
  assert.equal(blocked.job.lastResult, 'unknown');
  assert.equal(blocked.job.queueIndex, 0);
  assert.equal(blocked.job.sentCount, 0);
  assert.deepEqual(h.sends().map(request => request.args[0].prompt), ['SYNTHETIC_QUEUE_ITEM', 'SYNTHETIC_QUEUE_ITEM']);
  assert.equal(recovered.sentCount, 1);
  assert.equal(recovered.queueIndex, 1);
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

await scenario('Closing a target during submission pauses an unresolved send instead of replaying it', async () => {
  const h = await harness();
  await h.start();
  const gate = deferred();
  h.pageResult = () => gate.promise;
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  await h.close();
  gate.resolve({ status: 'sent' });
  await round;
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.state.session.job.sentCount, 0);
  assert.equal(h.state.session.job.unknownCount, 1);
  assert.equal(h.state.session.job.nextAt, null);
  assert.equal(h.state.local.resumeJob.enabled, false);
  h.state.tabs.set(17, { id: 17, url: originalUrl, autoDiscardable: true });
  await h.tick({ due: false });
  assert.equal(h.sends().length, 1);
  await h.message({ type: 'PAUSE' });
});

await scenario('Navigating away during submission pauses an unresolved send without replay', async () => {
  const h = await harness();
  await h.start();
  const gate = deferred();
  h.pageResult = () => gate.promise;
  const round = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1);
  await h.navigate(otherUrl);
  gate.resolve({ status: 'sent' });
  await round;
  assert.equal(h.state.session.job.url, originalUrl);
  assert.equal(h.state.session.job.tabId, null);
  assert.equal(h.state.session.job.unknownCount, 1);
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.state.session.job.nextAt, null);
  assert.equal(h.state.local.resumeJob.enabled, false);
  await h.tick({ due: false });
  assert.equal(h.sends().length, 1);
  await h.message({ type: 'PAUSE' });
});

for (const changeTarget of ['close', 'navigate']) {
  await scenario(`Target ${changeTarget} during an uncertain send records a content-free diagnostic`, async () => {
    const h = await harness();
    const privatePrompt = 'SYNTHETIC_PRIVATE_PROMPT_MARKER';
    await h.start({ prompt: privatePrompt });
    const page = deferred();
    h.pageResult = () => page.promise;
    const sending = h.message({ type: 'SEND_NOW' });
    await until(() => h.sends().length === 1);
    if (changeTarget === 'close') await h.close();
    else await h.navigate(otherUrl);
    page.resolve({ status: 'unknown' });
    await sending;
    await until(() => h.state.local.logs?.some(entry => entry.event === 'unconfirmed'));
    const record = h.state.local.logs.findLast(entry => entry.event === 'unconfirmed');
    assert.equal(record.diagnostic?.code, 'document-replaced');
    assert.equal(JSON.stringify(record).includes(privatePrompt), false);
    const exported = buildActivityExport({ logs: h.state.local.logs, extensionVersion: '3.0.12' });
    assert.equal(exported.logs.findLast(entry => entry.event === 'unconfirmed').diagnostic?.code, 'document-replaced');
    assert.equal(JSON.stringify(exported).includes(privatePrompt), false);
    await h.message({ type: 'PAUSE' });
  });
}

for (const changeTarget of ['close', 'navigate']) for (const status of ['sent', 'manual-sent']) for (const channel of ['message', 'execute-script']) {
  await scenario(`A confirmed ${status} ${channel} receipt racing target ${changeTarget} is counted once without adding an unknown`, async () => {
    const h = await harness();
    await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_CONFIRMED' }, { text: 'SYNTHETIC_NEXT' }] });
    const page = deferred();
    const gate = deferred();
    let held = false;
    h.pageResult = () => page.promise;
    const sending = h.message({ type: 'SEND_NOW' });
    await until(() => h.sends().length === 1);
    const args = h.sends()[0].args[0];
    const sender = h.sender();
    h.beforeStorageSet = async (area, value) => {
      if (area === 'session' && value.job?.enabled === false && !held) {
        held = true;
        await gate.promise;
      }
    };
    const changing = changeTarget === 'close' ? h.close() : h.navigate(otherUrl);
    await until(() => held, 'paused state write');
    const result = { status, assistantToken: 'SYNTHETIC_ASSISTANT', assistantCount: 2 };
    const receipt = channel === 'message'
      ? h.message({ type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken, result }, sender)
      : Promise.resolve(page.resolve(result));
    if (channel === 'execute-script') await delay(5);
    gate.resolve();
    await changing;
    await receipt;
    await sending;
    page.resolve(result);
    assert.equal(h.state.session.job.enabled, false);
    assert.equal(h.state.session.job.sentCount, status === 'sent' ? 1 : 0);
    assert.equal(h.state.session.job.manualSentCount || 0, status === 'manual-sent' ? 1 : 0);
    assert.equal(h.state.session.job.queueIndex, 1);
    assert.equal(h.state.session.job.unknownCount, 0);
    assert.equal(h.state.session.job.lastResult, status);
    assert.equal(h.state.local.resumeJob.sentCount, status === 'sent' ? 1 : 0);
    const activity = h.state.local.logs.findLast(entry => entry.event === 'unconfirmed');
    assert.ok(activity);
    assert.equal(activity.diagnostic?.code, undefined);
    assert.match(activity.message, /已确认本轮提交/);
    await h.message({ type: 'PAUSE' });
  });
}

for (const changeTarget of ['close', 'navigate']) {
  await scenario(`Manual intent racing target ${changeTarget} records exactly one unknown submission`, async () => {
    const h = await harness();
    await h.start();
    const page = deferred();
    const gate = deferred();
    let held = false;
    h.pageResult = () => page.promise;
    const sending = h.message({ type: 'SEND_NOW' });
    await until(() => h.sends().length === 1);
    const args = h.sends()[0].args[0];
    const sender = h.sender();
    h.beforeStorageSet = async (area, value) => {
      if (area === 'session' && value.job?.enabled === false && !held) {
        held = true;
        await gate.promise;
      }
    };
    const changing = changeTarget === 'close' ? h.close() : h.navigate(otherUrl);
    await until(() => held, 'paused state write');
    const manual = h.message({ type: 'MANUAL_SUBMISSION', runId: args.runId, resultToken: args.resultToken }, sender);
    gate.resolve();
    await changing;
    await manual;
    await sending;
    page.resolve({ status: 'unknown' });
    assert.equal(h.state.session.job.enabled, false);
    assert.equal(h.state.session.job.sentCount, 0);
    assert.equal(h.state.session.job.unknownCount, 1);
    assert.equal(h.state.session.job.lastResult, 'unknown');
    assert.equal(h.state.session.job.lastDiagnosticCode, 'document-replaced');
    assert.equal(h.state.local.resumeJob.unknownCount, 1);
    await h.message({ type: 'PAUSE' });
  });
}

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

await scenario('Twenty seconds without page evidence does not report send-not-ready', async () => {
  const h = await harness();
  await h.start();
  const pending = deferred();
  h.pageResult = args => args.mode === 'send' ? pending.promise : { status: 'ready' };
  const realSetTimeout = globalThis.setTimeout, realNow = Date.now;
  let watchdog, watchdogTimer, sending, waiting, observedJob;
  try {
    globalThis.setTimeout = (callback, milliseconds, ...args) => {
      const timer = realSetTimeout(callback, milliseconds, ...args);
      if (milliseconds >= 19_000 && milliseconds <= 20_000) { watchdog = callback; watchdogTimer = timer; }
      return timer;
    };
    sending = h.message({ type: 'SEND_NOW' });
    await until(() => h.sends().length === 1 && watchdog, 'send watchdog');
    const before = copy(h.state.session.job);
    assert.equal(before.phase, 'sending');
    assert.equal(before.sentCount, 0);
    Date.now = () => before.lastRunAt + 20_001;
    clearTimeout(watchdogTimer);
    watchdog();
    await until(() => h.state.local.logs?.some(entry => entry.event === 'busy'), 'waiting activity');
    await until(() => h.state.session.job.runDeadline > before.runDeadline, 'renewed waiting lease');
    waiting = copy(h.state.local.logs.findLast(entry => entry.event === 'busy'));
    observedJob = copy(h.state.session.job);
    assert.equal(waiting.diagnostic.durationMs, 20_001);
    assert.equal(observedJob.enabled, true);
    assert.equal(observedJob.phase, 'sending');
    assert.equal(observedJob.sentCount, 0);
    assert.equal(h.sends().length, 1);
    assert.equal(waiting.diagnostic.code, 'adapter-result', 'Waiting alone does not establish that the send control is not ready');
  } finally {
    Date.now = realNow;
    globalThis.setTimeout = realSetTimeout;
    await h.message({ type: 'PAUSE' });
    pending.resolve({ status: 'cancelled' });
    if (sending) await sending;
  }
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

await scenario('A 10-second WAIT_RUN is authorized only for the active run and target', async () => {
  const h = await harness();
  await h.start();
  const held = deferred();
  h.pageResult = async () => held.promise;
  const sending = h.message({ type: 'SEND_NOW' });
  try {
    await until(() => h.state.session.job?.phase === 'sending');
    const runId = h.state.session.job.runId;
    const sender = h.sender();
    assert.equal((await h.message({ type: 'CHECK_RUN', runId }, sender)).allowed, true);
    for (const [request, source] of [
      [{ type: 'WAIT_RUN', runId: 'wrong', delayMs: 10_000 }, sender],
      [{ type: 'WAIT_RUN', runId, delayMs: 10_000 }, { ...sender, frameId: 1 }],
      [{ type: 'WAIT_RUN', runId, delayMs: 10_000 }, { ...sender, url: otherUrl }],
    ]) {
      const response = await Promise.race([h.message(request, source), delay(1000).then(() => null)]);
      assert.equal(response?.allowed, false, 'Invalid authority must be rejected promptly');
    }
    const started = Date.now();
    let timer;
    const response = await Promise.race([
      h.message({ type: 'WAIT_RUN', runId, delayMs: 10_000 }, sender),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 15_000); }),
    ]).finally(() => clearTimeout(timer));
    assert.equal(response?.ok, true, 'The active run must accept the 10-second wait');
    assert.equal(response.allowed, true);
    assert.ok(Date.now() - started >= 9_500, 'An authorized 10-second wait must not complete early');
  } finally {
    await h.message({ type: 'PAUSE' });
    held.resolve({ status: 'sent' });
    await sending;
  }
});

await scenario('Pause promptly interrupts an authorized 10-second WAIT_RUN', async () => {
  const h = await harness();
  await h.start();
  const held = deferred();
  h.pageResult = async () => held.promise;
  const sending = h.message({ type: 'SEND_NOW' });
  let waiting;
  try {
    await until(() => h.state.session.job?.phase === 'sending');
    const runId = h.state.session.job.runId;
    const sender = h.sender();
    assert.equal((await h.message({ type: 'CHECK_RUN', runId }, sender)).allowed, true);
    waiting = h.message({ type: 'WAIT_RUN', runId, delayMs: 10_000 }, sender);
    const beforePause = await Promise.race([waiting, delay(100).then(() => null)]);
    assert.equal(beforePause, null, 'The authorized wait must remain pending until Pause');
    const paused = await Promise.race([h.message({ type: 'PAUSE' }), delay(1200).then(() => null)]);
    assert.equal(paused?.job?.enabled, false, 'Pause must not wait for the 10-second timer');
    const interrupted = await Promise.race([waiting, delay(1200).then(() => null)]);
    assert.equal(interrupted?.allowed, false, 'The wait must promptly lose authorization after Pause');
    assert.equal(h.state.session.job.sentCount, 0);
  } finally {
    await h.message({ type: 'PAUSE' });
    held.resolve({ status: 'sent' });
    await sending;
    if (waiting) {
      let timer;
      await Promise.race([waiting, new Promise(resolve => { timer = setTimeout(resolve, 10_500); })])
        .finally(() => clearTimeout(timer));
    }
  }
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

await scenario('onStartup pauses an enabled task when heartbeat repair fails', async () => {
  const h = await harness();
  const before = await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  h.state.alarms.delete(alarmName);
  const entered = deferred(), release = deferred();
  h.chrome.alarms.create = async () => {
    entered.resolve();
    await release.promise;
    throw new Error('Synthetic startup repair failure');
  };
  h.chrome.runtime.onStartup.emit();
  await entered.promise;
  const observing = h.message({ type: 'GET_STATE' });
  release.resolve();
  const observed = await observing;
  const sessionJob = copy(h.state.session.job);
  const recoveryJob = copy(h.state.local.resumeJob);
  const hasAlarm = h.state.alarms.has(alarmName);
  const sends = h.sends().length;
  await h.message({ type: 'PAUSE' });
  assert.equal(observed.ok, true);
  assert.equal(hasAlarm, false, 'The failed repair must not leave a usable heartbeat');
  assert.equal(sessionJob.enabled, false, 'Startup must not leave an enabled task without a heartbeat');
  assert.equal(recoveryJob.enabled, false, 'The persisted recovery must not revive an enabled task');
  assert.equal(sessionJob.nextAt, null);
  for (const key of ['id', 'prompt', 'queue', 'queueIndex', 'sentCount', 'intervalMinutes']) {
    assert.deepEqual(sessionJob[key], before[key], `${key} must survive failed startup repair`);
  }
  assert.equal(sends, 0, 'Startup repair failure must not submit a message');
});

await scenario('Startup cannot restore an alarm from a job snapshot captured before Pause', async () => {
  const h = await harness();
  const job = await h.start();
  const captured = deferred(), release = deferred();
  const get = h.chrome.storage.session.get;
  let intercept = true;
  h.chrome.storage.session.get = async key => {
    const snapshot = await get(key);
    if (key === 'job' && intercept) {
      intercept = false;
      captured.resolve(snapshot);
      await release.promise;
    }
    return snapshot;
  };
  h.chrome.runtime.onStartup.emit();
  try {
    assert.equal((await captured.promise).job.enabled, true);
    const paused = await h.message({ type: 'PAUSE' });
    assert.equal(paused.ok, true);
    assert.equal(paused.job.id, job.id);
    assert.equal(paused.job.enabled, false);
    assert.equal(h.state.alarms.has(alarmName), false);
  } finally { release.resolve(); }
  await delay(20);
  const alarmAfterStartup = h.state.alarms.has(alarmName);
  await delay(2600);
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.state.local.resumeJob.enabled, false);
  assert.equal(alarmAfterStartup, false, 'Startup must not restore the heartbeat after Pause');
  assert.equal(h.state.alarms.has(alarmName), false);
  assert.equal(h.sends().length, 0);
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
for (const readbackFirst of [false, true]) await scenario(`Validated cancellation ACK persists adapter progress ${readbackFirst ? 'without readding readback totals' : 'without a page result'}`, async () => {
  const h = await harness(); await h.start();
  const injection = deferred();
  const privateText = 'SYNTHETIC_CANCEL_ACK_PRIVATE';
  const progress = (writes, duration) => ({ stage: 'prepare', reason: 'composer-unavailable',
    counters: { domWrites: writes, fillCalls: writes }, timings: { domWriteMs: duration, maxDomWriteMs: 20 },
    observations: { composerPresent: true, prompt: privateText }, prompt: privateText });
  let readbacks = 0, cancelMessage;
  h.pageResult = args => {
    if (args.mode === 'send') return injection.promise;
    if (args.mode === 'check') return { status: 'ready' };
    readbacks++;
    return { state: 'running', diagnosticProgress: progress(7, 100) };
  };
  h.chrome.tabs.sendMessage = async (id, message) => {
    assert.equal(id, 7);
    assert.equal(message.type, 'CANCEL_RUN');
    cancelMessage = copy(message);
    return { revoked: true, runId: message.runId, resultToken: message.resultToken, diagnosticProgress: progress(9, 140) };
  };
  const sending = h.message({ type: 'SEND_NOW' });
  let paused;
  try {
    await until(() => h.sends().length === 1, 'in-flight delivery');
    if (readbackFirst) {
      await delay(2100);
      await until(() => readbacks > 0, 'adapter diagnostic readback');
      await delay(1100);
      await until(() => h.state.local.deliveryDiagnostics?.some(trace => trace.counters.domWrites === 7), 'persisted readback totals');
    }
    paused = await h.message({ type: 'PAUSE' });
  } finally {
    injection.resolve({ status: 'cancelled' });
    await sending;
  }
  assert.equal(paused.ok, true);
  assert.equal(paused.job.enabled, false);
  assert.equal(cancelMessage.runId, h.sends()[0].args[0].runId);
  assert.equal(cancelMessage.resultToken, h.sends()[0].args[0].resultToken);
  await until(() => h.state.local.deliveryDiagnostics?.some(trace => trace.state === 'cancelled'), 'persisted cancelled delivery');
  await delay(50);
  const traces = h.state.local.deliveryDiagnostics;
  assert.equal(traces.length, 1);
  const trace = traces[0];
  assert.equal(trace.counters.domWrites, 9, 'The verified ACK must contribute only previously unseen adapter writes');
  assert.equal(trace.counters.fillCalls, 9);
  assert.equal(trace.timings.domWriteMs, 140);
  assert.equal(trace.timings.maxDomWriteMs, 20);
  assert.equal(trace.observations.composerPresent, true);
  assert.equal(JSON.stringify(trace).includes(privateText), false);
});
for (const invalid of ['revoked', 'runId', 'resultToken']) await scenario(`Cancellation ACK with invalid ${invalid} cannot contribute diagnostic progress`, async () => {
  const h = await harness(); await h.start();
  const injection = deferred();
  h.pageResult = args => args.mode === 'send' ? injection.promise : { status: 'ready' };
  h.chrome.tabs.sendMessage = async (id, message) => ({ revoked: invalid !== 'revoked',
    runId: invalid === 'runId' ? 'SYNTHETIC_WRONG_RUN' : message.runId,
    resultToken: invalid === 'resultToken' ? 'SYNTHETIC_WRONG_TOKEN' : message.resultToken,
    diagnosticProgress: { counters: { domWrites: 99 }, timings: { domWriteMs: 999 } } });
  const sending = h.message({ type: 'SEND_NOW' });
  let paused;
  try {
    await until(() => h.sends().length === 1, 'in-flight delivery');
    paused = await h.message({ type: 'PAUSE' });
  } finally {
    injection.resolve({ status: 'cancelled' });
    await sending;
  }
  assert.equal(paused.ok, true);
  assert.equal(paused.job.enabled, false);
  assert.ok(h.state.session.submissionFenceUntil > 0);
  await until(() => h.state.local.deliveryDiagnostics?.some(trace => trace.state === 'cancelled'), 'persisted cancelled delivery');
  const trace = h.state.local.deliveryDiagnostics.at(-1);
  assert.equal(trace.counters.domWrites, 0);
  assert.equal(trace.timings.domWriteMs, 0);
});
await scenario('A fresh page admission adds its counters without readding the previous snapshot', async () => {
  const h = await harness();
  await h.start();
  const snapshots = [];
  h.beforeStorageSet = async (name, value) => {
    if (name === 'local' && Array.isArray(value.deliveryDiagnostics)) snapshots.push(...copy(value.deliveryDiagnostics));
  };
  let admission = 0;
  h.pageResult = async args => {
    if (args.mode !== 'send') return { status: 'ready' };
    admission++;
    if (admission === 2) await until(() => snapshots.some(trace => trace.sequence === 1 && trace.counters.domWrites === 5),
      'first admission persisted');
    const counters = admission === 1 ? { domWrites: 5, fillCalls: 5, dispatchAttempts: 0, manualIntents: 0 }
      : { domWrites: 2, fillCalls: 2, dispatchAttempts: 1 };
    return { status: admission === 1 ? 'blocked' : 'sent', retryable: admission === 1,
      diagnosticCode: admission === 1 ? 'commit-not-dispatched' : undefined,
      diagnosticProgress: { stage: admission === 1 ? 'prepare' : 'receipt',
        reason: admission === 1 ? 'composer-unavailable' : 'receipt-confirmed', counters,
        timings: { domWriteMs: admission === 1 ? 100 : 40, maxDomWriteMs: 20,
          serializationMs: admission === 1 ? 50 : 70, maxSerializationMs: admission === 1 ? 30 : 45 } } };
  };
  const outcome = await h.message({ type: 'SEND_NOW' });
  assert.equal(outcome.job.sentCount, 1);
  assert.equal(h.sends().length, 2);
  await until(() => snapshots.some(trace => trace.state === 'sent' && trace.counters.domWrites >= 7), 'merged delivery trace');
  assert.ok(snapshots.every(trace => trace.sequence === 1 && trace.counters.domWrites <= 7 && trace.counters.fillCalls <= 7));
  const trace = snapshots.findLast(value => value.state === 'sent' && value.counters.domWrites >= 7);
  assert.equal(trace.counters.domWrites, 7);
  assert.equal(trace.counters.fillCalls, 7);
  assert.equal(trace.timings.domWriteMs, 140);
  assert.equal(trace.timings.maxDomWriteMs, 20);
  assert.equal(trace.timings.serializationMs, 120);
  assert.equal(trace.timings.maxSerializationMs, 45);
  await h.message({ type: 'PAUSE' });
});
await scenario('A diagnostic persistence failure is visible but cannot block sending or Pause', async () => {
  const h = await harness(); await h.start();
  h.beforeStorageSet = async (name, value) => {
    if (name === 'local' && Object.hasOwn(value, 'deliveryDiagnostics')) throw new Error('SYNTHETIC_PRIVATE_STORAGE_ERROR');
  };
  assert.equal((await h.message({ type: 'SEND_NOW' })).job.sentCount, 1);
  await until(() => h.state.session.diagnosticsHealth?.persistence === 'degraded', 'diagnostic failure health');
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
async function manualSubmissionWithUnknownResult() {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const receipt = deferred();
  h.pageResult = args => args.mode === 'send' ? receipt.promise : { status: 'ready' };
  const sending = h.message({ type: 'SEND_NOW' });
  await until(() => h.sends().length === 1, 'manual submission admission');
  const { runId, resultToken } = h.sends()[0].args[0];
  const manual = await h.message({ type: 'MANUAL_SUBMISSION', runId, resultToken }, h.sender());
  assert.equal(manual.ok, true, 'The current page must successfully signal the manual submission');
  receipt.resolve({ status: 'unknown' });
  const result = await sending;
  h.pageResult = async () => ({ status: 'sent' });
  return { h, result };
}
await scenario('An unconfirmed manual submission durably pauses without advancing the queue or counters', async () => {
  const { h, result } = await manualSubmissionWithUnknownResult();
  assert.equal(result.job.enabled, false, 'An unconfirmed manual submission must pause the task');
  assert.equal(result.job.nextAt, null);
  assert.equal(result.job.phase, 'idle');
  assert.equal(result.job.sentCount, 0);
  assert.equal(result.job.manualSentCount || 0, 0);
  assert.equal(result.job.unknownCount, 1);
  assert.equal(result.job.queueIndex, 0);
  assert.equal(h.state.session.job.enabled, false);
  assert.equal(h.state.local.resumeJob.enabled, false, 'The pause must survive loss of session storage');
  assert.equal(h.state.local.resumeJob.queueIndex, 0);
  assert.equal(h.state.alarms.has(alarmName), false);
});
await scenario('An unconfirmed manual submission cannot resend before explicit Resume, including after restarts', async () => {
  const { h } = await manualSubmissionWithUnknownResult();
  const session = copy(h.state.session), local = copy(h.state.local);
  const realNow = Date.now;
  const start = realNow();
  let liveSends, workerSends, browserSends, manualResult, resumed, afterResume;
  try {
    Date.now = () => start + 21 * 60_000;
    await h.tick({ due: false });
    liveSends = h.sends().length;
    const worker = await harness({ session, local: copy(local) });
    await worker.tick({ due: false });
    workerSends = worker.sends().length;
    const browser = await harness({ local: copy(local) });
    Date.now = () => start + 42 * 60_000;
    await browser.tick({ due: false });
    browserSends = browser.sends().length;
    manualResult = await browser.message({ type: 'SEND_NOW' });
    resumed = await browser.message({ type: 'RESUME' });
    afterResume = await browser.message({ type: 'SEND_NOW' });
    await browser.message({ type: 'PAUSE' });
  } finally { Date.now = realNow; }
  assert.deepEqual({ liveSends, workerSends, browserSends, manualAllowed: manualResult.ok },
    { liveSends: 1, workerSends: 0, browserSends: 0, manualAllowed: false },
    'No automatic or forced resend is authorized before explicit Resume');
  assert.equal(resumed.ok, true);
  assert.equal(afterResume.ok, true);
  assert.equal(afterResume.job.sentCount, 1);
  assert.equal(afterResume.job.queueIndex, 1);
});
await scenario('A lost manual submission notification is recovered from an unknown page result and prevents later resends', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  h.pageResult = async args => args.mode === 'send'
    ? { status: 'unknown', diagnosticProgress: { observations: { manualPending: true } } }
    : { status: 'ready' };
  const result = await h.message({ type: 'SEND_NOW' });
  const session = copy(h.state.session), local = copy(h.state.local);
  h.pageResult = async () => ({ status: 'sent' });
  const realNow = Date.now, start = realNow();
  let liveSends, workerSends, browserSends, manualResult;
  try {
    Date.now = () => start + 21 * 60_000;
    await h.tick({ due: false });
    liveSends = h.sends().length;
    const worker = await harness({ session, local: copy(local) });
    await worker.tick({ due: false });
    workerSends = worker.sends().length;
    await worker.message({ type: 'PAUSE' });
    const browser = await harness({ local: copy(local) });
    Date.now = () => start + 42 * 60_000;
    await browser.tick({ due: false });
    browserSends = browser.sends().length;
    manualResult = await browser.message({ type: 'SEND_NOW' });
    await browser.message({ type: 'PAUSE' });
  } finally {
    Date.now = realNow;
    await h.message({ type: 'PAUSE' });
  }
  assert.deepEqual({ liveSends, workerSends, browserSends, manualAllowed: manualResult.ok },
    { liveSends: 1, workerSends: 0, browserSends: 0, manualAllowed: false },
    'The result must prevent automatic and forced resends even when the separate notification was lost');
  assert.equal(result.job.enabled, false);
  assert.equal(result.job.nextAt, null);
  assert.equal(result.job.sentCount, 0);
  assert.equal(result.job.manualSentCount || 0, 0);
  assert.equal(result.job.unknownCount, 1);
  assert.equal(result.job.queueIndex, 0);
  assert.equal(local.resumeJob.enabled, false);
});
await scenario('A retryable result carrying manualPending cannot trigger a fresh page admission', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  h.pageResult = async args => {
    if (args.mode !== 'send') return { status: 'ready' };
    if (h.sends().length === 1) return { status: 'blocked', diagnosticCode: 'commit-not-dispatched', retryable: true,
      diagnosticProgress: { observations: { manualPending: true } } };
    return { status: 'unknown' };
  };
  const result = await h.message({ type: 'SEND_NOW' });
  const sends = h.sends().length;
  const persisted = copy(h.state.local.resumeJob);
  await h.message({ type: 'PAUSE' });
  assert.equal(sends, 1, 'Manual intent in the result must override retryable and prevent a second admission');
  assert.equal(result.job.enabled, false);
  assert.equal(result.job.sentCount, 0);
  assert.equal(result.job.manualSentCount || 0, 0);
  assert.equal(result.job.queueIndex, 0);
  assert.equal(persisted.enabled, false);
});
await scenario('Restart during an unresolved manual submission preserves the pause and does not replay', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const receipt = deferred();
  h.pageResult = args => args.mode === 'send' ? receipt.promise : { status: 'ready' };
  const sending = h.message({ type: 'SEND_NOW' });
  let restored, restartedSends;
  const realNow = Date.now;
  try {
    await until(() => h.sends().length === 1, 'manual submission admission');
    const { runId, resultToken } = h.sends()[0].args[0];
    assert.equal((await h.message({ type: 'MANUAL_SUBMISSION', runId, resultToken }, h.sender())).ok, true);
    const restart = await harness({ local: copy(h.state.local), session: copy(h.state.session) });
    restored = copy(restart.state.session.job);
    Date.now = () => realNow() + 21 * 60_000;
    await restart.tick({ due: false });
    restartedSends = restart.sends().length;
    await restart.message({ type: 'PAUSE' });
  } finally {
    Date.now = realNow;
    receipt.resolve({ status: 'unknown' });
    await sending;
    await h.message({ type: 'PAUSE' });
  }
  assert.equal(restored.enabled, false, 'An interrupted manual submission must recover paused');
  assert.equal(restored.sentCount, 0);
  assert.equal(restored.manualSentCount || 0, 0);
  assert.equal(restored.unknownCount, 1);
  assert.equal(restored.queueIndex, 0);
  assert.equal(restartedSends, 0, 'A later heartbeat must not replay the unresolved manual submission');
});
await scenario('A failed manual-submission local write cannot replay after browser restart', async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const receipt = deferred();
  h.pageResult = args => args.mode === 'send' ? receipt.promise : { status: 'ready' };
  const sending = h.message({ type: 'SEND_NOW' });
  const realNow = Date.now;
  let browser;
  try {
    await until(() => h.sends().length === 1, 'manual submission admission');
    assert.equal(h.state.local.resumeJob.phase, 'sending');
    let failures = 0;
    h.beforeStorageSet = async (name, value) => {
      if (name === 'local' && value.resumeJob?.manualSubmissionPending === true) {
        failures++;
        throw new Error('Synthetic manual submission persistence failure');
      }
    };
    const { runId, resultToken } = h.sends()[0].args[0];
    const manual = await h.message({ type: 'MANUAL_SUBMISSION', runId, resultToken }, h.sender());
    assert.equal(manual.ok, false);
    assert.equal(failures, 1);
    assert.equal(h.state.session.job.manualSubmissionPending, true);
    assert.notEqual(h.state.local.resumeJob.manualSubmissionPending, true);
    browser = await harness({ local: copy(h.state.local) });
    const restored = copy(browser.state.session.job);
    Date.now = () => realNow() + 21 * 60_000;
    await browser.tick({ due: false });
    const forced = await browser.message({ type: 'SEND_NOW' });
    assert.equal(browser.sends().length, 0, 'Neither the heartbeat nor Send Now may replay the uncertain submission');
    assert.equal(forced.ok, false);
    assert.equal(restored.enabled, false);
    assert.equal(restored.phase, 'idle');
    assert.equal(restored.nextAt, null);
    assert.equal(restored.queueIndex, 0);
    assert.equal(restored.sentCount, 0);
    assert.equal(restored.manualSentCount || 0, 0);
    assert.equal(restored.unknownCount, 1);
    assert.equal(browser.state.local.resumeJob.enabled, false);
    assert.equal(browser.state.alarms.has(alarmName), false);
  } finally {
    Date.now = realNow;
    if (browser) await browser.message({ type: 'PAUSE' });
    globalThis.chrome = h.chrome;
    h.beforeStorageSet = null;
    receipt.resolve({ status: 'unknown' });
    await sending;
    await h.message({ type: 'PAUSE' });
  }
});
for (const restartKind of ['worker', 'browser']) await scenario(`A ${restartKind} restart during sending conservatively pauses without a manual notification`, async () => {
  const h = await harness();
  await h.start({ mode: 'queue-loop', queue: [{ text: 'SYNTHETIC_FIRST' }, { text: 'SYNTHETIC_SECOND' }] });
  const receipt = deferred();
  h.pageResult = args => args.mode === 'send' ? receipt.promise : { status: 'ready' };
  const sending = h.message({ type: 'SEND_NOW' });
  const realNow = Date.now;
  let restart;
  try {
    await until(() => h.sends().length === 1, 'sending admission');
    assert.equal(h.state.local.resumeJob.phase, 'sending');
    assert.notEqual(h.state.local.resumeJob.manualSubmissionPending, true);
    const seed = { local: copy(h.state.local) };
    if (restartKind === 'worker') seed.session = copy(h.state.session);
    restart = await harness(seed);
    const restored = copy(restart.state.session.job);
    Date.now = () => realNow() + 21 * 60_000;
    await restart.tick({ due: false });
    const forced = await restart.message({ type: 'SEND_NOW' });
    assert.equal(restart.sends().length, 0, 'Interrupted sending must not be replayed without explicit Resume');
    assert.equal(forced.ok, false);
    assert.equal(restored.enabled, false);
    assert.equal(restored.phase, 'idle');
    assert.equal(restored.nextAt, null);
    assert.equal(restored.queueIndex, 0);
    assert.equal(restored.sentCount, 0);
    assert.equal(restored.manualSentCount || 0, 0);
    assert.equal(restored.unknownCount, 1);
    assert.equal(restart.state.local.resumeJob.enabled, false);
    assert.equal(restart.state.alarms.has(alarmName), false);
  } finally {
    Date.now = realNow;
    if (restart) await restart.message({ type: 'PAUSE' });
    globalThis.chrome = h.chrome;
    receipt.resolve({ status: 'unknown' });
    await sending;
    await h.message({ type: 'PAUSE' });
  }
});
for (const restartKind of ['worker', 'browser']) for (const operation of ['fence', 'RESUME', 'START']) {
  await scenario(`A ${restartKind} restart during sending preserves the old lease and blocks ${operation}`, async () => {
    const h = await harness();
    await h.start({ prompt: 'SYNTHETIC_OLD_RUN' });
    const receipt = deferred();
    h.pageResult = args => args.mode === 'send' ? receipt.promise : { status: 'ready' };
    const sending = h.message({ type: 'SEND_NOW' });
    let restarted, observed;
    try {
      await until(() => h.sends().length === 1, 'in-flight synthetic send');
      const { runId } = h.sends()[0].args[0];
      const deadline = h.state.session.job.runDeadline;
      assert.ok(Number.isFinite(deadline) && deadline > Date.now());
      assert.equal(h.state.local.resumeJob.runDeadline, deadline);
      assert.equal((await h.message({ type: 'CHECK_RUN', runId }, h.sender())).allowed, true);
      const seed = { local: copy(h.state.local) };
      if (restartKind === 'worker') seed.session = copy(h.state.session);
      restarted = await harness(seed);
      const restored = copy(restarted.state.session.job);
      const persistent = copy(restarted.state.local);
      const oldRun = await restarted.message({ type: 'CHECK_RUN', runId }, restarted.sender());
      const attempted = operation === 'RESUME' ? await restarted.message({ type: 'RESUME' })
        : operation === 'START' ? await restarted.message({ type: 'START', tabId: 7,
          config: { prompt: 'SYNTHETIC_NEW_RUN', startImmediately: false } }) : null;
      observed = {
        beforeDeadline: Date.now() < deadline,
        restoredPaused: restored.enabled === false && restored.phase === 'idle',
        sessionFence: Math.max(restarted.state.session.submissionFenceUntil || 0, restored.submissionFenceUntil || 0) >= deadline,
        durableFence: Math.max(persistent.submissionFenceUntil || 0, persistent.resumeJob?.submissionFenceUntil || 0) >= deadline,
        oldRunAllowed: oldRun.allowed,
        operationAllowed: attempted?.ok ?? false,
        enabled: Boolean(restarted.state.session.job?.enabled),
        alarm: restarted.state.alarms.has(alarmName),
        sends: restarted.sends().length,
      };
    } finally {
      if (restarted) await restarted.message({ type: 'PAUSE' });
      globalThis.chrome = h.chrome;
      receipt.resolve({ status: 'unknown' });
      await sending;
      await h.message({ type: 'PAUSE' });
    }
    const expected = { beforeDeadline: true, restoredPaused: true, sessionFence: true, durableFence: true,
      oldRunAllowed: false, operationAllowed: false, enabled: false, alarm: false, sends: 0 };
    if (operation !== 'fence') {
      assert.equal(observed.operationAllowed, false, `${operation} must be rejected while the old page lease is live`);
      assert.equal(observed.enabled, false);
      assert.equal(observed.alarm, false);
      assert.equal(observed.sends, 0);
    }
    assert.deepEqual(observed, expected, 'Restart must preserve the old submission deadline in session and durable storage');
  });
}
await scenario('A permanently pending diagnostics write cannot retain send completion or Pause authority', async () => {
  const h = await harness(); await h.start(); const writing = deferred(); let entered = false;
  h.beforeStorageSet = (name, value) => {
    if (name === 'local' && Object.hasOwn(value, 'deliveryDiagnostics')) { entered = true; return writing.promise; }
  };
  const sending = h.message({ type: 'SEND_NOW' });
  let clearing;
  try {
    await until(() => entered, 'diagnostic write admission');
    const sent = await Promise.race([sending, delay(1200).then(() => null)]);
    assert.equal(sent?.job.sentCount, 1, 'Sending must complete while the diagnostic write remains pending');
    const paused = await Promise.race([h.message({ type: 'PAUSE' }), delay(1200).then(() => null)]);
    assert.equal(paused?.job.enabled, false, 'Pause must complete while the diagnostic write remains pending');
    clearing = h.message({ type: 'CLEAR_LOGS' });
    const pausedDuringClear = await Promise.race([h.message({ type: 'PAUSE' }), delay(1200).then(() => null)]);
    assert.equal(pausedDuringClear?.job.enabled, false, 'Clear must not block Pause');
  } finally {
    writing.resolve();
    if (clearing) await clearing;
  }
  assert.equal((await clearing).ok, true);
  await delay(10);
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
await scenario('A stalled old diagnostic persistence read cannot block a new epoch after Clear Logs', async () => {
  const h = await harness(); await h.start();
  assert.equal((await h.message({ type: 'SEND_NOW' })).job.sentCount, 1);
  await until(() => h.state.local.deliveryDiagnostics?.at(-1)?.state === 'sent');
  const oldSequence = h.state.local.deliveryDiagnostics.at(-1).sequence;
  const reading = deferred();
  const get = h.chrome.storage.local.get; let reads = 0, captured;
  h.chrome.storage.local.get = async key => {
    const value = await get(key);
    if (key === 'deliveryDiagnostics' && ++reads === 2) {
      captured = copy(value.deliveryDiagnostics);
      await reading.promise;
    }
    return value;
  };
  let beforeRelease, afterRelease;
  try {
    assert.equal((await h.message({ type: 'SEND_NOW' })).job.sentCount, 2);
    await until(() => captured, 'old diagnostic persistence read');
    assert.ok(captured.some(trace => trace.sequence === oldSequence));
    assert.equal((await h.message({ type: 'CLEAR_LOGS' })).ok, true);
    assert.equal((await h.message({ type: 'SEND_NOW' })).job.sentCount, 3);
    await delay(600);
    beforeRelease = copy(h.state.local.deliveryDiagnostics);
  } finally {
    reading.resolve();
    h.chrome.storage.local.get = get;
  }
  await until(() => h.state.local.deliveryDiagnostics?.some(trace => trace.sequence === oldSequence + 2 && trace.state === 'sent'));
  afterRelease = copy(h.state.local.deliveryDiagnostics);
  await h.message({ type: 'PAUSE' });
  const expected = [{ sequence: oldSequence + 2, state: 'sent' }];
  const summaries = traces => traces?.map(trace => ({ sequence: trace.sequence, state: trace.state }));
  assert.deepEqual(summaries(afterRelease), expected, 'Releasing the old read must not resurrect cleared diagnostics');
  assert.deepEqual(summaries(beforeRelease), expected, 'The new trace must persist while the old read is still pending');
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
  let clearing, pausing, paused, clearCompleted = false, clearCompletedBeforeWrite;
  try {
    await h.message({ type: 'SEND_NOW' }); await until(() => entered);
    await delay(2100);
    assert.equal(h.state.session.diagnosticsHealth.persistence, 'degraded');
    clearing = h.message({ type: 'CLEAR_LOGS' }).then(response => { clearCompleted = true; return response; });
    pausing = h.message({ type: 'PAUSE' });
    paused = await Promise.race([pausing, delay(1200).then(() => null)]);
    await delay(50);
    clearCompletedBeforeWrite = clearCompleted;
  } finally {
    writing.resolve();
    await Promise.all([clearing, pausing].filter(Boolean));
  }
  await delay(15);
  assert.equal(Object.hasOwn(h.state.local, 'deliveryDiagnostics'), false);
  assert.equal(Object.hasOwn(h.state.local, 'diagnosticsHealth'), false);
  assert.equal(Object.hasOwn(h.state.session, 'diagnosticsHealth'), false);
  assert.equal(paused?.ok, true, 'Pause must respond while the diagnostic write remains pending');
  assert.equal(paused.job.enabled, false);
  assert.equal(clearCompletedBeforeWrite, false, 'Clear must not confirm before the issued diagnostic write settles');
  assert.equal((await clearing).ok, true);
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
await scenario('Clear Logs fences an earlier GET_STATE diagnostics snapshot', async () => {
  const oldLog = { at: 1, event: 'started', message: 'SYNTHETIC_OLD_LOG' };
  const h = await harness({ local: { logs: [oldLog], deliveryDiagnostics: [{ sequence: 4 }] } });
  const reading = deferred(); let captured = false;
  const get = h.chrome.storage.local.get;
  h.chrome.storage.local.get = async keys => {
    const snapshot = await get(keys);
    if (Array.isArray(keys) && keys.includes('deliveryDiagnostics')) {
      captured = true; await reading.promise;
    }
    return snapshot;
  };
  const observing = h.message({ type: 'GET_STATE' }); await until(() => captured);
  try {
    assert.equal((await h.message({ type: 'CLEAR_LOGS' })).ok, true);
  } finally { reading.resolve(); }
  const response = await observing;
  assert.ok(!response.logs?.some(item => item.message === oldLog.message), 'a completed clear must not return the old log');
  assert.ok(!response.deliveryDiagnostics?.some(item => item.sequence === 4), 'a completed clear must not return the old diagnostic');
});
for (const pending of ['logs', 'deliveryDiagnostics', 'sessionHealth']) {
  await scenario(`GET_STATE hides old ${pending} while Clear Logs storage removal is pending`, async () => {
    const oldLog = { at: 1, event: 'started', message: 'SYNTHETIC_OLD_LOG' };
    const oldTrace = { sequence: 4 };
    const oldHealth = { persistence: 'degraded', writeFailures: 7 };
    const h = await harness({ local: { logs: [oldLog], deliveryDiagnostics: [oldTrace], diagnosticsHealth: oldHealth },
      session: { diagnosticsHealth: oldHealth } });
    const removal = deferred(); let entered = false, clearCompleted = false;
    h.beforeStorageRemove = (name, keys) => {
      const target = pending === 'logs' ? name === 'local' && keys === 'logs' :
        pending === 'deliveryDiagnostics' ? name === 'local' && Array.isArray(keys) && keys.includes('deliveryDiagnostics') :
          name === 'session' && keys === 'diagnosticsHealth';
      if (target) { entered = true; return removal.promise; }
    };
    const clearing = h.message({ type: 'CLEAR_LOGS' }).then(response => { clearCompleted = true; return response; });
    try {
      await until(() => entered, `${pending} removal admission`);
      assert.equal(clearCompleted, false, 'Clear must remain pending during the observation');
      const retained = pending === 'logs' ? h.state.local.logs : pending === 'deliveryDiagnostics' ?
        h.state.local.deliveryDiagnostics : h.state.session.diagnosticsHealth;
      assert.deepEqual(retained, pending === 'logs' ? [oldLog] : pending === 'deliveryDiagnostics' ? [oldTrace] : oldHealth);
      const response = await Promise.race([h.message({ type: 'GET_STATE' }), delay(1200).then(() => null)]);
      assert.equal(response?.ok, true, 'GET_STATE must remain available while removal is pending');
      if (pending === 'logs') assert.ok(!response.logs?.some(item => item.message === oldLog.message), 'GET_STATE must not expose the old log');
      else if (pending === 'deliveryDiagnostics') {
        assert.ok(!response.deliveryDiagnostics?.some(item => item.sequence === oldTrace.sequence), 'GET_STATE must not expose the old delivery diagnostic');
        assert.notDeepEqual(response.diagnosticsHealth, oldHealth, 'GET_STATE must not expose the old local diagnostic health');
      } else assert.notDeepEqual(response.diagnosticsHealth, oldHealth, 'GET_STATE must not expose the old session diagnostic health');
    } finally {
      removal.resolve();
      await clearing;
    }
    assert.equal(clearCompleted, true);
  });
}
for (const failedArea of ['local', 'session']) {
  await scenario(`A partial diagnostic read preserves degraded health from ${failedArea === 'local' ? 'session' : 'local'}`, async () => {
    const h = await harness();
    const degraded = { persistence: 'degraded', writeFailures: 3 };
    h.state[failedArea === 'local' ? 'session' : 'local'].diagnosticsHealth = degraded;
    h.beforeStorageGet = (name, keys) => {
      if (name === failedArea && (name === 'local' ? Array.isArray(keys) && keys.includes('deliveryDiagnostics') : keys === 'diagnosticsHealth')) {
        throw new Error('SYNTHETIC_DIAGNOSTIC_READ_FAILURE');
      }
    };
    const response = await h.message({ type: 'GET_STATE' });
    assert.equal(response.ok, true);
    assert.deepEqual(response.diagnosticsHealth, degraded);
  });
}
await scenario('Diagnostic storage failures cannot prevent task state from being read', async () => {
  for (const area of ['local', 'session']) for (const fault of ['reject', 'pending']) {
    const h = await harness({ local: { logs: [{ at: 1, event: 'started' }], deliveryDiagnostics: [{ sequence: 4 }] } });
    const job = await h.start(); const reading = deferred(); let entered = false;
    await until(() => h.state.local.logs?.some(item => item.message?.includes('开始任务')));
    const retainedLogs = copy(h.state.local.logs);
    h.beforeStorageGet = (name, keys) => {
      const target = area === 'local' ? name === 'local' && Array.isArray(keys) && keys.includes('deliveryDiagnostics') :
        name === 'session' && keys === 'diagnosticsHealth';
      if (!target) return;
      entered = true;
      if (fault === 'reject') throw new Error('SYNTHETIC_PRIVATE_DIAGNOSTIC_ERROR');
      return reading.promise;
    };
    const observing = h.message({ type: 'GET_STATE' });
    await until(() => entered, 'diagnostic read admission');
    const response = await Promise.race([observing, delay(1200).then(() => null)]);
    try {
      assert.equal(response?.ok, true, `${area} ${fault} must not block task state`);
      assert.equal(response.job.id, job.id);
      assert.equal(response.job.enabled, true);
      assert.equal(response.config.prompt, 'SYNTHETIC_CONTINUE');
      assert.ok(Array.isArray(response.availableTargets));
      assert.equal(response.diagnosticsHealth?.persistence, 'unknown');
      if (area === 'session') {
        assert.deepEqual(response.logs, retainedLogs);
        assert.deepEqual(response.deliveryDiagnostics, [{ sequence: 4 }]);
      } else {
        assert.equal(Object.hasOwn(response, 'logs'), false);
        assert.equal(Object.hasOwn(response, 'deliveryDiagnostics'), false);
      }
      assert.equal(JSON.stringify(response).includes('SYNTHETIC_PRIVATE_DIAGNOSTIC_ERROR'), false);
    } finally {
      reading.resolve(); h.beforeStorageGet = undefined; await observing;
      await h.message({ type: 'PAUSE' });
    }
  }
});
await scenario('A configuration read failure cannot replace a saved prompt with defaults', async () => {
  const prompt = 'SYNTHETIC_PRESERVE_PRIVATE_PROMPT';
  const h = await harness({ local: { config: { ...DEFAULT_CONFIG, prompt } } });
  h.beforeStorageGet = (name, keys) => {
    if (name === 'local' && keys === 'config') throw new Error('SYNTHETIC_PRIVATE_STORAGE_ERROR');
  };
  const response = await h.message({ type: 'GET_STATE' });
  assert.equal(response.ok, true);
  assert.equal(response.configAvailable, false, 'a failed configuration read must not be reported as defaults');
  assert.equal(Object.hasOwn(response, 'config'), false);
  assert.equal(h.state.local.config.prompt, prompt);
  assert.equal(JSON.stringify(response).includes('SYNTHETIC_PRIVATE_STORAGE_ERROR'), false);
  h.beforeStorageGet = undefined;
  assert.equal((await h.message({ type: 'GET_STATE' })).config.prompt, prompt);
});
await scenario('GET_STATE cannot return an older configuration after another panel saves', async () => {
  const oldConfig = { ...copy(DEFAULT_CONFIG), prompt: 'SYNTHETIC_OLD_PANEL_PROMPT', intervalMinutes: 20 };
  const newConfig = { ...copy(DEFAULT_CONFIG), prompt: 'SYNTHETIC_NEW_PANEL_PROMPT', intervalMinutes: 7 };
  const h = await harness({ local: { config: oldConfig } });
  const reading = deferred(); let captured = false;
  const get = h.chrome.storage.local.get;
  h.chrome.storage.local.get = async key => {
    const snapshot = await get(key);
    if (key === 'config' && !captured) {
      assert.deepEqual(snapshot.config, oldConfig);
      captured = true;
      await reading.promise;
    }
    return snapshot;
  };
  const observing = h.message({ type: 'GET_STATE' });
  try {
    await until(() => captured, 'old configuration snapshot');
    await h.chrome.storage.local.set({ config: newConfig });
    assert.deepEqual(h.state.local.config, newConfig, 'The other panel must finish saving before the snapshot returns');
  } finally {
    reading.resolve();
  }
  const response = await observing;
  h.chrome.storage.local.get = get;
  assert.equal(response.ok, true);
  if (response.configAvailable === false) assert.equal(Object.hasOwn(response, 'config'), false);
  else assert.deepEqual(response.config, readConfig(newConfig, { allowEmpty: true }), 'A stale snapshot must not be returned as the current configuration');
  assert.deepEqual(h.state.local.config, newConfig);
  assert.deepEqual((await h.message({ type: 'GET_STATE' })).config, readConfig(newConfig, { allowEmpty: true }));
});
await scenario('GET_STATE must not return a stale configuration before its change notification arrives', async () => {
  const oldConfig = { ...copy(DEFAULT_CONFIG), prompt: 'SYNTHETIC_OLD_PROMPT' };
  const newConfig = { ...copy(DEFAULT_CONFIG), prompt: 'SYNTHETIC_NEW_PROMPT' };
  const h = await harness({ local: { config: oldConfig } });
  const reading = deferred(); let captured = false;
  const get = h.chrome.storage.local.get;
  h.chrome.storage.local.get = async key => {
    const snapshot = await get(key);
    if (key === 'config' && !captured) { captured = true; await reading.promise; }
    return snapshot;
  };
  const observing = h.message({ type: 'GET_STATE' });
  try {
    await until(() => captured);
    h.state.local.config = copy(newConfig);
  } finally { reading.resolve(); }
  const response = await observing;
  h.chrome.storage.local.get = get;
  assert.equal(response.ok, true);
  if (response.configAvailable === false) assert.equal(Object.hasOwn(response, 'config'), false);
  else assert.deepEqual(response.config, readConfig(newConfig, { allowEmpty: true }));
});
await scenario('A pending configuration read cannot block Pause or hide the running task', async () => {
  const h = await harness(); const job = await h.start(); const reading = deferred(); let entered = false;
  h.beforeStorageGet = (name, key) => {
    if (name === 'local' && key === 'config') { entered = true; return reading.promise; }
  };
  const observing = h.message({ type: 'GET_STATE' }); await until(() => entered);
  const paused = await Promise.race([h.message({ type: 'PAUSE' }), delay(1200).then(() => null)]);
  const response = await Promise.race([observing, delay(1200).then(() => null)]);
  try {
    assert.equal(paused?.job.enabled, false);
    assert.equal(response?.ok, true);
    assert.equal(response.job.id, job.id);
    assert.equal(response.job.enabled, false);
    assert.equal(response.configAvailable, false);
    assert.equal(Object.hasOwn(response, 'config'), false);
  } finally { reading.resolve(); h.beforeStorageGet = undefined; await observing; }
});
await scenario('A state read during Clear Data cannot return the pre-clear prompt', async () => {
  const prompt = 'SYNTHETIC_PRE_CLEAR_PROMPT';
  const h = await harness({ local: { config: { ...DEFAULT_CONFIG, prompt } } });
  await h.start({ prompt });
  const removal = deferred(); let entered = false;
  h.beforeStorageRemove = (name, key) => {
    if (name === 'local' && key === 'config') { entered = true; return removal.promise; }
  };
  const clearing = h.message({ type: 'CLEAR_DATA' }); await until(() => entered);
  const observing = h.message({ type: 'GET_STATE' });
  await delay(20); removal.resolve();
  const [clearResult, state] = await Promise.all([clearing, observing]);
  assert.equal(clearResult.ok, true);
  assert.equal(state.ok, true);
  assert.equal(state.job, null);
  assert.equal(state.configAvailable, false);
  assert.equal(Object.hasOwn(state, 'config'), false);
  assert.equal(Object.hasOwn(h.state.local, 'config'), false);
});
await scenario('GET_STATE hides old snapshots when Clear Data config removal fails before log removal settles', async () => {
  const prompt = 'SYNTHETIC_FAILED_CLEAR_PROMPT';
  const oldLog = { at: 1, event: 'old', message: 'SYNTHETIC_FAILED_CLEAR_LOG' };
  const h = await harness({ local: { config: { ...DEFAULT_CONFIG, prompt }, logs: [oldLog] } });
  const removal = deferred(); let configFailed = false, logPending = false, logSettled = false;
  h.beforeStorageRemove = (name, key) => {
    if (name !== 'local') return;
    if (key === 'config') { configFailed = true; throw new Error('SYNTHETIC_CONFIG_CLEAR_FAILURE'); }
    if (key === 'logs') { logPending = true; return removal.promise.then(() => { logSettled = true; }); }
  };
  const clearing = h.message({ type: 'CLEAR_DATA' });
  let clearResult;
  try {
    await until(() => configFailed && logPending, 'failed config removal and pending log removal');
    await delay(20);
    assert.equal(logSettled, false);
    assert.equal(h.state.local.config.prompt, prompt);
    assert.deepEqual(h.state.local.logs, [oldLog]);
    const state = await Promise.race([h.message({ type: 'GET_STATE' }), delay(1200).then(() => null)]);
    assert.equal(state?.ok, true, 'GET_STATE must remain available while log removal is pending');
    assert.deepEqual({ oldLog: !!state.logs?.some(item => item.message === oldLog.message), oldConfig: state.config?.prompt === prompt },
      { oldLog: false, oldConfig: false }, 'GET_STATE must not return old snapshots while log removal is pending');
  } finally {
    removal.resolve();
    clearResult = await clearing;
  }
  assert.equal(clearResult.ok, false, 'A failed configuration removal must not report a successful clear');
});
await scenario('A cold configuration read failure does not disable Pause', async () => {
  for (const fault of ['reject', 'pending']) {
    const reading = deferred(); let entered = false;
    const h = await harness({ skipReady: true, session: { job: { ...DEFAULT_CONFIG, prompt: 'SYNTHETIC_CONTINUE',
      id: 'cold-job', enabled: true, phase: 'idle', tabId: 7, url: originalUrl, sentCount: 0, nextAt: Date.now() + 60000 } },
    beforeStorageGet: (name, key) => {
      if (name !== 'local' || key !== 'config') return;
      entered = true;
      if (fault === 'reject') throw new Error('SYNTHETIC_PRIVATE_STORAGE_ERROR');
      return reading.promise;
    } });
    const observing = h.message({ type: 'GET_STATE' });
    await until(() => entered);
    const request = h.message({ type: 'PAUSE' });
    const response = await Promise.race([request, delay(1200).then(() => null)]);
    try {
      assert.equal(response?.ok, true, `${fault} cold startup must permit Pause`);
      assert.equal(response.job?.enabled, false);
      assert.equal(h.state.session.job.enabled, false);
    } finally { reading.resolve(); h.beforeStorageGet = undefined; await request; await observing; }
  }
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
await scenario('A stalled old activity read cannot block a new epoch after Clear Logs', async () => {
  const oldLog = { at: 1, event: 'old', message: 'SYNTHETIC_OLD_ACTIVITY' };
  const h = await harness({ local: { logs: [oldLog] } });
  const reading = deferred();
  const get = h.chrome.storage.local.get; let captured;
  h.chrome.storage.local.get = async key => {
    const value = await get(key);
    if (key === 'logs' && !captured) {
      captured = copy(value.logs);
      await reading.promise;
    }
    return value;
  };
  let beforeRelease, afterRelease;
  try {
    await h.start(); await until(() => captured, 'old activity read');
    assert.deepEqual(captured, [oldLog]);
    assert.equal((await h.message({ type: 'CLEAR_LOGS' })).ok, true);
    assert.equal((await h.message({ type: 'PAUSE' })).job.enabled, false);
    await delay(600);
    beforeRelease = copy(h.state.local.logs);
  } finally {
    reading.resolve();
    h.chrome.storage.local.get = get;
  }
  await until(() => h.state.local.logs?.some(entry => entry.event === 'paused'));
  afterRelease = copy(h.state.local.logs);
  assert.deepEqual(afterRelease.map(entry => entry.event), ['paused'], 'Releasing the old read must not resurrect cleared activity');
  assert.deepEqual(beforeRelease?.map(entry => entry.event), ['paused'], 'The new activity must persist while the old read is still pending');
});
await scenario('A late activity write cannot resurrect a cleared event or delete the new epoch record', async () => {
  const h = await harness(); await h.start(); const writing = deferred(); let entered = false;
  await until(() => h.state.local.logs?.some(entry => entry.event === 'started'));
  h.beforeStorageSet = (name, value) => {
    if (name === 'local' && Object.hasOwn(value, 'logs') && !entered) { entered = true; return writing.promise; }
  };
  let clearing, pausing, paused, clearCompleted = false, clearCompletedBeforeWrite;
  try {
    assert.equal((await h.message({ type: 'SEND_NOW' })).job.sentCount, 1);
    await until(() => entered, 'old activity set admission');
    clearing = h.message({ type: 'CLEAR_LOGS' }).then(response => { clearCompleted = true; return response; });
    pausing = h.message({ type: 'PAUSE' });
    paused = await Promise.race([pausing, delay(1200).then(() => null)]);
    await delay(50);
    clearCompletedBeforeWrite = clearCompleted;
  } finally {
    writing.resolve();
    await Promise.all([clearing, pausing].filter(Boolean));
  }
  await until(() => h.state.local.logs?.length === 1);
  assert.equal(h.state.local.logs[0].event, 'paused');
  assert.equal(paused?.ok, true, 'Pause must respond while the activity write remains pending');
  assert.equal(paused.job.enabled, false);
  assert.equal(clearCompletedBeforeWrite, false, 'Clear must not confirm before the issued activity write settles');
  assert.equal((await clearing).ok, true);
});
await scenario('Clear Logs waits for an issued old activity set without blocking Pause', async () => {
  const h = await harness(); await h.start();
  await until(() => h.state.local.logs?.some(entry => entry.event === 'started'));
  const writing = deferred(); let entered = false, clearCompleted = false;
  h.beforeStorageSet = (name, value) => {
    if (name === 'local' && Object.hasOwn(value, 'logs') && !entered) { entered = true; return writing.promise; }
  };
  const sending = h.message({ type: 'SEND_NOW' });
  let clearing, pausing, paused, clearCompletedBeforeWrite;
  try {
    await until(() => entered, 'old activity set admission');
    clearing = h.message({ type: 'CLEAR_LOGS' }).then(response => { clearCompleted = true; return response; });
    pausing = h.message({ type: 'PAUSE' });
    paused = await Promise.race([pausing, delay(1200).then(() => null)]);
    await delay(50);
    clearCompletedBeforeWrite = clearCompleted;
  } finally {
    writing.resolve();
    await Promise.all([sending, clearing, pausing].filter(Boolean));
  }
  assert.equal(paused?.ok, true, 'Pause must respond while the old activity set remains pending');
  assert.equal(paused.job.enabled, false);
  assert.equal(clearCompletedBeforeWrite, false, 'Clear Logs must not confirm before the issued old activity set settles');
  assert.equal((await clearing).ok, true);
  await until(() => h.state.local.logs?.some(entry => entry.event === 'paused'), 'new-epoch Pause activity');
  assert.deepEqual(h.state.local.logs.map(entry => entry.event), ['paused']);
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
await scenario('A delivery after rejected diagnostic removal replaces old history without losing its snapshot', async () => {
  const h = await harness(); await h.start();
  assert.equal((await h.message({ type: 'SEND_NOW' })).job.sentCount, 1);
  await until(() => h.state.local.deliveryDiagnostics?.at(-1)?.state === 'sent');
  const oldTraces = copy(h.state.local.deliveryDiagnostics);
  const oldSequence = oldTraces.at(-1).sequence;
  h.beforeStorageRemove = (name, keys) => {
    if (name === 'local' && Array.isArray(keys) && keys.includes('deliveryDiagnostics')) throw new Error('SYNTHETIC_DIAGNOSTIC_CLEAR_FAILURE');
  };
  assert.equal((await h.message({ type: 'CLEAR_LOGS' })).ok, false);
  assert.deepEqual(h.state.local.deliveryDiagnostics, oldTraces, 'Rejected removal must leave the old fixture in storage');
  assert.equal((await h.message({ type: 'SEND_NOW' })).job.sentCount, 2);
  await until(() => h.state.local.deliveryDiagnostics?.some(trace => trace.sequence === oldSequence + 1 && trace.state === 'sent') ||
    h.state.session.diagnosticsHealth?.persistence === 'degraded', 'new snapshot or failed diagnostic barrier');
  await delay(30);
  const retained = copy(h.state.local.deliveryDiagnostics);
  assert.equal((await h.message({ type: 'PAUSE' })).job.enabled, false);
  assert.deepEqual(retained?.map(trace => ({ sequence: trace.sequence, state: trace.state })),
    [{ sequence: oldSequence + 1, state: 'sent' }], 'The new snapshot must survive without merging the old record');
});
await scenario('A delivery queued during rejected diagnostic removal survives without old history or another producer', async () => {
  const h = await harness(); await h.start();
  assert.equal((await h.message({ type: 'SEND_NOW' })).job.sentCount, 1);
  await until(() => h.state.local.deliveryDiagnostics?.at(-1)?.state === 'sent');
  const oldTraces = copy(h.state.local.deliveryDiagnostics);
  const oldSequence = oldTraces.at(-1).sequence;
  const removal = deferred(); let removing = false, writes = 0;
  h.beforeStorageRemove = (name, keys) => {
    if (name === 'local' && Array.isArray(keys) && keys.includes('deliveryDiagnostics')) { removing = true; return removal.promise; }
  };
  h.beforeStorageSet = (name, value) => {
    if (name === 'local' && Object.hasOwn(value, 'deliveryDiagnostics')) writes++;
  };
  const clearing = h.message({ type: 'CLEAR_LOGS' });
  let clearResult;
  try {
    await until(() => removing, 'diagnostic removal admission');
    assert.equal((await h.message({ type: 'SEND_NOW' })).job.sentCount, 2);
    await delay(30);
    assert.equal(writes, 0, 'The new snapshot must wait for the removal');
    assert.deepEqual(h.state.local.deliveryDiagnostics, oldTraces);
  } finally {
    removal.reject(new Error('SYNTHETIC_DIAGNOSTIC_CLEAR_FAILURE'));
    clearResult = await clearing;
  }
  assert.equal(clearResult.ok, false);
  await until(() => h.state.local.deliveryDiagnostics?.some(trace => trace.sequence === oldSequence + 1 && trace.state === 'sent') ||
    h.state.session.diagnosticsHealth?.persistence === 'degraded', 'new snapshot or failed diagnostic barrier');
  await delay(30);
  const retained = copy(h.state.local.deliveryDiagnostics);
  assert.equal((await h.message({ type: 'PAUSE' })).job.enabled, false);
  assert.deepEqual(retained?.map(trace => ({ sequence: trace.sequence, state: trace.state })),
    [{ sequence: oldSequence + 1, state: 'sent' }], 'The queued snapshot must survive without merging the old record or requiring another delivery');
});
await scenario('A new activity event cannot merge old records after Clear Logs removal rejects', async () => {
  const oldLog = { at: 1, event: 'old', message: 'SYNTHETIC_OLD_ACTIVITY' };
  const h = await harness({ local: { logs: [oldLog] } });
  await h.start();
  await until(() => h.state.local.logs?.some(entry => entry.event === 'started'), 'initial activity event');
  h.state.local.logs = [oldLog];
  h.beforeStorageRemove = (name, key) => {
    if (name === 'local' && key === 'logs') throw new Error('SYNTHETIC_ACTIVITY_CLEAR_FAILURE');
  };
  assert.equal((await h.message({ type: 'CLEAR_LOGS' })).ok, false);
  assert.deepEqual(h.state.local.logs, [oldLog], 'The rejected removal must leave the old fixture in storage');
  assert.equal((await h.message({ type: 'PAUSE' })).ok, true);
  await until(() => h.state.local.logs?.some(entry => entry.event === 'paused'), 'new activity event');
  assert.deepEqual(h.state.local.logs.map(entry => entry.event), ['paused'], 'A new epoch must not append to uncleared old activity');
});
for (const type of ['CLEAR_LOGS', 'CLEAR_DATA']) {
  await scenario(`${type} handles a concurrent removal rejection while the other removal is pending`, async () => {
    const h = await harness();
    const pending = deferred();
    const failure = new Error('SYNTHETIC_CONCURRENT_CLEAR_FAILURE');
    const unhandled = [];
    let pendingEntered = false, rejectedEntered = false;
    const onUnhandled = reason => { if (reason === failure) unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    h.beforeStorageRemove = (name, key) => {
      if (name !== 'local') return;
      const activity = key === 'logs';
      const diagnostics = Array.isArray(key) && key.includes('deliveryDiagnostics');
      if ((type === 'CLEAR_LOGS' && activity) || (type === 'CLEAR_DATA' && diagnostics)) {
        pendingEntered = true;
        return pending.promise;
      }
      if ((type === 'CLEAR_LOGS' && diagnostics) || (type === 'CLEAR_DATA' && activity)) {
        rejectedEntered = true;
        throw failure;
      }
    };
    let clearing, response;
    try {
      clearing = h.message({ type });
      await until(() => pendingEntered && rejectedEntered, 'both concurrent removals admitted');
      await delay(20);
      assert.deepEqual(unhandled, [], 'A rejection must have a handler before the other removal settles');
    } finally {
      pending.resolve();
      if (clearing) response = await clearing;
      await delay(20);
      process.removeListener('unhandledRejection', onUnhandled);
    }
    assert.equal(response.ok, false, 'The failed removal must not report a successful clear');
  });
}
await scenario('initialize deduplicates browser-restored across worker wakes and preserves preDispatch interrupted runs', async () => {
  const preDispatchJob = {
    ...DEFAULT_CONFIG, id: 'job-predispatch-1', runId: 'run-pd-1', enabled: true, tabId: 7,
    url: originalUrl, title: 'Synthetic', targetIdentity: 'acct~dot', phase: 'sending',
    runKind: 'send', preDispatch: true, runDeadline: Date.now() + 60_000,
    sentCount: 2, unknownCount: 0, nextAt: Date.now() - 1000,
  };
  const h = await harness({ local: { resumeJob: preDispatchJob } });
  await until(() => h.state.session.job?.phase === 'idle', 'preDispatch recovery');
  assert.equal(h.state.session.job.enabled, true, 'preDispatch crash must remain enabled');
  assert.equal(h.state.session.job.tabId, null, 'cold initialize must clear stale tabId');
  assert.equal(h.state.session.job.unknownCount, 0, 'preDispatch crash must not count as unknown');
  assert.equal(h.state.session.job.submissionFenceUntil ?? null, null, 'preDispatch crash must not set submissionFenceUntil');
  assert.equal(h.state.local.logs.filter(entry => entry.event === 'browser-restored').length, 1);

  // Re-import worker in same session -> must not duplicate browser-restored
  await import(pathToFileURL(path.join(root, 'background.js')).href + `?v2-test=${++importId}`);
  assert.equal((await h.message({ type: 'GET_STATE' })).ok, true);
  assert.equal(h.state.local.logs.filter(entry => entry.event === 'browser-restored').length, 1);
});

await scenario('tabs.onUpdated auto-rebinds unique complete target tab without binding duplicates', async () => {
  const saved = {
    ...DEFAULT_CONFIG, id: 'job-rebind-1', runId: 'run-rb-1', enabled: true, tabId: null,
    url: originalUrl, title: 'Synthetic', targetIdentity: 'acct~dot', phase: 'idle',
    sentCount: 0, unknownCount: 0, nextAt: Date.now() + 120_000,
  };
  const h = await harness({
    session: { job: copy(saved), browserRestoredLoggedJobId: saved.id },
    local: { resumeJob: copy(saved) },
    tabs: [
      { id: 11, url: originalUrl, active: false, status: 'complete' },
      { id: 12, url: originalUrl, active: true, status: 'complete' },
    ],
  });
  h.chrome.tabs.onUpdated.emit(11, { status: 'complete' }, copy(h.state.tabs.get(11)));
  await delay(30);
  assert.equal(h.state.session.job.tabId, null, 'duplicate URL tabs must refuse auto-rebind');

  h.state.tabs.delete(12);
  h.chrome.tabs.onUpdated.emit(11, { status: 'complete' }, copy(h.state.tabs.get(11)));
  await until(() => h.state.session.job.tabId === 11, 'unique restored tab auto-rebind');
  assert.equal(h.state.session.job.tabId, 11);
  assert.ok(h.state.session.job.nextAt > Date.now() + 60_000, 'future schedule must not accelerate on rebind');
});
const failed = results.filter(result => result.status === 'FAIL');
console.log(`RESULT ${results.length - failed.length}/${results.length} background v2 scenarios passed`);
for (const result of failed) console.error(result.error);
process.exitCode = failed.length ? 1 : 0;
