import { createTranslator, initializeLanguage } from './i18n.js';
import runtimeCatalog from './i18n-runtime.js';

const t = createTranslator(runtimeCatalog);

import { DEFAULT_CONFIG, DELIVERY_BEHAVIOR_VERSION, normalizeUrl, validateTarget, readConfig, currentPrompt, inQuietHours } from './config.js';
import { pageAction, pageInvocationState, translatePageResult, mainWorldAutoAllowClick } from './adapter.js';
import { editorCommit } from './editor-commit.js';
import { createDeliveryTrace, updateDeliveryTrace, sanitizeDeliveryDiagnostics } from './delivery-diagnostics.js';
import { BUNDLED_PROMPT } from './preset.js';
import { bindBrowserWake, BROWSER_DEVICE_MESSAGE } from './browser-wake.js';
import { bindAdministratorBrowser, ADMIN_BROWSER_MESSAGE, ADMIN_BROWSER_PAUSE, ADMIN_BROWSER_PAUSE_RECONCILE,
  ADMIN_BROWSER_PAUSE_STATUS, ADMIN_BROWSER_RESTORE } from './admin-browser.js';
import { bindAdministratorControls, ADMIN_CONTROL_MESSAGES } from './admin-control.js';
import { bindInstallationPause } from './admin-installation-pause.js';
import { bindSetupInstallation, SETUP_MESSAGES } from './setup-controller.js';
import { bindCurrentAccountSetup } from './current-account-setup.js';

let setupInstallation, currentAccountSetup;
const browserWake = bindBrowserWake(chrome, {
  onPauseIntent: () => {
    currentAccountSetup?.cancelPendingStartup();
    setupInstallation?.cancelAll();
  },
});
const administratorControls = bindAdministratorControls(chrome, {
  prepareObserver: admit => administratorBrowser?.prepareSetupObserver(admit) ?? false,
});
const installationPause = bindInstallationPause(chrome);
const administratorBrowser = bindAdministratorBrowser(chrome, {
  installationPause,
  onPauseIntent: () => {
    administratorControls?.cancelPendingStartup();
    currentAccountSetup?.cancelPendingStartup();
    setupInstallation?.cancelAll();
  },
});
currentAccountSetup = bindCurrentAccountSetup(chrome, {
  wake: browserWake,
  captureGlobalPermit: () => administratorControls?.captureStartupPermit() ?? (() => false),
});
setupInstallation = bindSetupInstallation(chrome, {
  controls: administratorControls,
  currentAccount: currentAccountSetup,
  checkStopSupport: digest => installationPause?.available(digest) ?? false,
  prepareObserver: admit => administratorBrowser?.prepareSetupObserver(admit) ?? false,
});

const ALARM_NAME = 'agent-continue-heartbeat';
const DRAFT_CLEAR_MARKER = 'draftClearPending';
const UNKNOWN_RECOVERY_VERSION = 1;
const RETRY_MS = 60_000;
// Finite MAIN-command admission permits; never a total send-wait deadline.
const EXECUTION_MS = 20_000;
const RESULT_STATUSES = new Set(['ready', 'sent', 'manual-sent', 'busy', 'draft', 'done', 'blocked', 'cancelled', 'unknown', 'error']);
const pendingPageResults = new Map();
const revokedRuns = new Set();
const runWaiters = new Map();
function wakeRunWaiters(runId) {
  const waiters = runWaiters.get(runId);
  if (!waiters) return;
  runWaiters.delete(runId);
  for (const wake of waiters) wake();
}
let stateQueue = Promise.resolve();
let intentVersion = 0;
let pendingStopIntents = 0;
let failedStopVersion = null;
let pendingActivationVersion = null;
let pendingStartReservation = null;
let pendingDataClears = 0;
let pendingHistoryClears = 0;
let configRevision = 0;
let draftGeneration = crypto.randomUUID();
let draftRevision = 0;
let draftQueue = Promise.resolve();
let draftClearPending = 0;
let draftClearFailed = false;
chrome.storage.onChanged?.addListener?.((changes, area) => {
  if (area === 'local' && changes.config) configRevision++;
});
let diagnosticQueue = Promise.resolve();
let diagnosticSequence = 0;
let diagnosticWriteFailures = 0;
let diagnosticEpoch = 0;
let diagnosticDraining = false;
let diagnosticClearBarrier = Promise.resolve();
let diagnosticHealthWrite = Promise.resolve();
let diagnosticStorageWrite = Promise.resolve();
let diagnosticDiscardPrevious = false;
let diagnosticReportedClearFailure = null;
let diagnosticHealthDraining = false;
let diagnosticHealthPending = null;
const diagnosticSnapshots = new Map();
let activityEpoch = 0;
let activityDraining = false;
let activityClearBarrier = Promise.resolve();
let activityStorageWrite = Promise.resolve();
let activityDiscardPrevious = false;
const activityEvents = [];
const invalidation = () => {
  let invalidated = false;
  const listeners = new Set();
  return {
    subscribe(listener) {
      if (invalidated) { listener(); return () => {}; }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    invalidate() {
      if (invalidated) return;
      invalidated = true;
      const pending = [...listeners];
      listeners.clear();
      for (const listener of pending) listener();
    },
  };
};
let diagnosticReadInvalidation = invalidation();
let activityReadInvalidation = invalidation();
async function readUntilInvalidated(read, signal) {
  let unsubscribe;
  const invalidated = new Promise(resolve => { unsubscribe = signal.subscribe(() => resolve({ invalidated: true })); });
  try {
    return await Promise.race([
      Promise.resolve().then(read).then(value => ({ value }), error => ({ error })),
      invalidated,
    ]);
  } finally { unsubscribe(); }
}
function diagnosticFailure(epoch = diagnosticEpoch) {
  if (epoch !== diagnosticEpoch) return;
  diagnosticWriteFailures++;
  diagnosticHealthPending = { epoch, writeFailures: diagnosticWriteFailures };
  if (!diagnosticHealthDraining) void drainDiagnosticHealth();
}
async function drainDiagnosticHealth() {
  if (diagnosticHealthDraining) return;
  diagnosticHealthDraining = true;
  try {
    while (diagnosticHealthPending) {
      const barrier = diagnosticClearBarrier;
      await barrier.catch(() => undefined);
      if (barrier !== diagnosticClearBarrier) continue;
      const pending = diagnosticHealthPending;
      diagnosticHealthPending = null;
      if (!pending || pending.epoch !== diagnosticEpoch) continue;
      diagnosticHealthWrite = (async () => {
        try {
          await chrome.storage.session.set({ diagnosticsHealth: { persistence: 'degraded', writeFailures: pending.writeFailures } });
        } catch { /* Diagnostics never delay the sender or Pause. */ }
      })();
      await diagnosticHealthWrite;
    }
  } finally {
    diagnosticHealthDraining = false;
    if (diagnosticHealthPending) void drainDiagnosticHealth();
  }
}

function clearDeliveryDiagnostics() {
  diagnosticEpoch++;
  const epoch = diagnosticEpoch;
  diagnosticDiscardPrevious = true;
  diagnosticReportedClearFailure = null;
  diagnosticReadInvalidation.invalidate();
  diagnosticReadInvalidation = invalidation();
  diagnosticSnapshots.clear();
  diagnosticWriteFailures = 0;
  diagnosticHealthPending = null;
  for (const pending of pendingPageResults.values()) { clearTimeout(pending.traceTimer); pending.trace = null; }
  // Wait only for an admitted write, not a drain that may itself await Clear.
  const priorHealth = diagnosticHealthWrite;
  const priorWrite = diagnosticStorageWrite;
  diagnosticClearBarrier = Promise.all([diagnosticClearBarrier.catch(() => undefined), priorHealth.catch(() => undefined), priorWrite.catch(() => undefined)])
    .then(async () => {
      await chrome.storage.local.remove(['deliveryDiagnostics', 'diagnosticsHealth']);
      await chrome.storage.session.remove('diagnosticsHealth');
      if (epoch === diagnosticEpoch) diagnosticDiscardPrevious = false;
    });
  return diagnosticClearBarrier;
}

// Diagnostics have an independent queue and can never hold cancellation or
// authorize a submission. Coalesce live snapshots instead of logging each poll.
function persistDeliveryTrace(trace, epoch = diagnosticEpoch) {
  const snapshot = sanitizeDeliveryDiagnostics(trace);
  if (!snapshot || epoch !== diagnosticEpoch) return diagnosticQueue;
  diagnosticSnapshots.set(snapshot.sequence, { snapshot, epoch });
  while (diagnosticSnapshots.size > 20) diagnosticSnapshots.delete(diagnosticSnapshots.keys().next().value);
  if (diagnosticDraining) return diagnosticQueue;
  diagnosticDraining = true;
  diagnosticQueue = (async () => {
    try { while (diagnosticSnapshots.size) {
      const barrier = diagnosticClearBarrier;
      await barrier.catch(() => {
        if (barrier === diagnosticClearBarrier && diagnosticReportedClearFailure !== barrier) {
          diagnosticReportedClearFailure = barrier;
          diagnosticFailure();
        }
      });
      if (barrier !== diagnosticClearBarrier) continue;
      if (!diagnosticSnapshots.size) break;
      const batch = [...diagnosticSnapshots.values()]; diagnosticSnapshots.clear();
      const currentEpoch = batch.at(-1).epoch;
      const signal = diagnosticReadInvalidation;
      const healthTimer = setTimeout(() => diagnosticFailure(currentEpoch), 2000);
      try {
        const result = await readUntilInvalidated(() => chrome.storage.local.get('deliveryDiagnostics'), signal);
        if (result.invalidated || currentEpoch !== diagnosticEpoch) continue;
        if (result.error) throw result.error;
        const stored = result.value;
        const previous = !diagnosticDiscardPrevious && Array.isArray(stored.deliveryDiagnostics) ? stored.deliveryDiagnostics : [];
        const fresh = batch.filter(item => item.epoch === diagnosticEpoch).map(item => item.snapshot);
        const ids = new Set(fresh.map(item => item.sequence));
        const traces = previous.map(sanitizeDeliveryDiagnostics).filter(Boolean).filter(item => !ids.has(item.sequence));
        const write = chrome.storage.local.set({ deliveryDiagnostics: [...traces, ...fresh].sort((a, b) => a.sequence - b.sequence).slice(-20),
          diagnosticsHealth: { persistence: diagnosticWriteFailures ? 'degraded' : 'available', writeFailures: diagnosticWriteFailures } });
        diagnosticStorageWrite = write;
        await write;
        if (currentEpoch === diagnosticEpoch) diagnosticDiscardPrevious = false;
      } catch { diagnosticFailure(currentEpoch); }
      finally { clearTimeout(healthTimer); }
    } } finally {
      // Release ownership in the same reaction as the final empty-map check.
      diagnosticDraining = false;
      if (diagnosticSnapshots.size) {
        const next = [...diagnosticSnapshots.values()].at(-1);
        void persistDeliveryTrace(next.snapshot, next.epoch);
      }
    }
  })();
  return diagnosticQueue;
}
async function newDeliveryTrace() {
  let timer;
  const epoch = diagnosticEpoch;
  try {
    const observed = await Promise.race([chrome.storage.local.get('deliveryDiagnostics'),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 250); })]);
    if (epoch !== diagnosticEpoch) return null;
    if (!observed) { diagnosticFailure(epoch); return null; }
    const stored = observed.deliveryDiagnostics;
    for (const item of Array.isArray(stored) ? stored : []) if (Number.isSafeInteger(item?.sequence)) diagnosticSequence = Math.max(diagnosticSequence, item.sequence);
    if (diagnosticSequence >= Number.MAX_SAFE_INTEGER) { diagnosticFailure(epoch); return null; }
    return createDeliveryTrace(++diagnosticSequence, Date.now());
  } catch { diagnosticFailure(epoch); return null; }
  finally { clearTimeout(timer); }
}
function deliveryProgress(pending, patch = {}, flush = false) {
  if (!pending?.trace) return;
  const now = Date.now();
  const before = `${pending.trace.stage}:${pending.trace.reason}`;
  pending.trace = updateDeliveryTrace(pending.trace, { ...patch, stage: patch.stage ?? pending.stage }, now);
  if (flush || before !== `${pending.trace.stage}:${pending.trace.reason}` || now - (pending.lastTraceWrite || 0) >= 10000) {
    pending.lastTraceWrite = now;
    if (!pending.traceTimer) pending.traceTimer = setTimeout(() => {
      pending.traceTimer = null; void persistDeliveryTrace(pending.trace, pending.diagnosticEpoch);
    }, flush ? 0 : 1000);
  }
}
function deliveryCounter(pending, name, increment = 1) {
  if (!pending?.trace) return;
  deliveryProgress(pending, { counters: { [name]: (pending.trace.counters?.[name] || 0) + increment } });
}
function pageProgress(pending, progress, source) {
  if (!pending || !progress || typeof progress !== 'object') return;
  if (progress.observations?.manualPending === true
      || Number.isSafeInteger(progress.counters?.manualIntents) && progress.counters.manualIntents > 0) pending.manualSubmission = true;
  if (Number.isSafeInteger(progress.counters?.dispatchAttempts) && progress.counters.dispatchAttempts > 0) pending.dispatched = true;
  if (!pending.trace) return;
  const seen = (pending.pageProgressTotals ??= {})[source] ??= { counters: {}, timings: {} };
  const patch = { counters: {}, timings: {}, observations: progress.observations };
  if (progress.method && progress.method !== 'none') patch.method = progress.method;
  for (const group of ['counters', 'timings']) for (const name of Object.keys(pending.trace[group] || {})) {
    const value = progress[group]?.[name];
    if ((source === 'adapter' && ['pageAdmissions', 'authorizationChecks', 'leaseRenewals'].includes(name))) continue;
    if (source === 'adapter' && name === 'dispatchAttempts' && pending.ownsModelStages) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER
      || (group === 'counters' && !Number.isSafeInteger(value)) || ['elapsedMs', 'stageElapsedMs'].includes(name)) continue;
    const prior = seen[group][name] || 0;
    if (value >= prior) {
      patch[group][name] = name.startsWith('max') || name === 'manualIntents' ? Math.max(pending.trace[group][name] || 0, value)
        : Math.min(Number.MAX_SAFE_INTEGER, (pending.trace[group][name] || 0) + (value - prior));
      seen[group][name] = value;
    }
  }
  if (source !== 'adapter' || !pending.ownsModelStages) {
    patch.stage = progress.stage; patch.reason = progress.reason;
  }
  deliveryProgress(pending, patch);
}

function transact(callback) {
  const work = stateQueue.then(callback, callback);
  stateQueue = work.catch(() => undefined);
  return work;
}
const token = () => crypto.randomUUID();
// Exceptions may contain browser/page data. Only our fixed messages enter logs.
const errorMessage = error => error?.safeMessage || t('操作未完成，请检查目标页面和扩展权限后再试。');
function fail(message) { const error = new Error(message); error.safeMessage = message; return error; }

// Older builds stored rendered status text, sometimes without a diagnostic code.
const retiredDraftNotice = message => typeof message === 'string' && [
  'Content changed after filling; the draft was preserved',
  'Content changed after refilling; the draft was preserved',
  'The composer content changed and was preserved.',
  'The composer changed before interruption; its content was preserved.',
  'The composer contains a draft or attachments; skipping this cycle.',
  'A new draft or attachments were detected; skipping this cycle.',
  'Another draft or attachments were detected after interruption and preserved.',
  '填写后检测到内容变化，已保留草稿',
  '重新填写后检测到内容变化，已保留草稿',
  '输入框内容发生变化，已保留当前内容。',
  '打断前输入框发生变化，已保留当前内容。',
  '输入框已有草稿或附件，本次跳过。',
  '检测到新草稿或附件，本次跳过。',
  '打断后检测到其他草稿或附件，已保留。',
].some(prefix => message.startsWith(prefix));

async function getJob() { return (await chrome.storage.session.get('job')).job || null; }
const migrateDelivery = value => value && value.deliveryBehaviorVersion !== DELIVERY_BEHAVIOR_VERSION
  ? { ...value, waitForIdle: false, deliveryBehaviorVersion: DELIVERY_BEHAVIOR_VERSION } : value;
async function getConfig() {
  return readConfig(migrateDelivery((await chrome.storage.local.get('config')).config), { allowEmpty: true });
}
function saveDraft(message) {
  const work = draftQueue.then(async () => {
    if (draftClearPending || draftClearFailed || message.generation !== draftGeneration
        || !Number.isSafeInteger(message.revision) || message.revision !== draftRevision) {
      return { ok: false, conflict: true, draftGeneration, draftRevision };
    }
    if (!message.config || typeof message.config !== 'object' || Array.isArray(message.config)
        || !message.base || typeof message.base !== 'object' || Array.isArray(message.base))
      throw fail(t('无效请求。'));
    const config = readConfig(message.config, { allowEmpty: true });
    const base = readConfig(message.base, { allowEmpty: true });
    const current = await getConfig();
    if (draftClearPending || draftClearFailed || message.generation !== draftGeneration || message.revision !== draftRevision
        || JSON.stringify(current) !== JSON.stringify(base)) {
      return { ok: false, conflict: true, draftGeneration, draftRevision };
    }
    await chrome.storage.local.set({ config });
    if (draftClearPending || message.generation !== draftGeneration) return { ok: false, conflict: true, draftGeneration, draftRevision };
    draftRevision++;
    return { ok: true, draftGeneration, draftRevision };
  });
  draftQueue = work.catch(() => undefined);
  return work;
}
function saveTemplates(message) {
  const work = draftQueue.then(async () => {
    if (draftClearPending || draftClearFailed || message.generation !== draftGeneration)
      return { ok: false, conflict: true };
    const valid = value => Array.isArray(value) && value.length <= 30 && value.every(item =>
      item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'string'
      && typeof item.name === 'string' && typeof item.prompt === 'string' && Array.isArray(item.queue)
      && ['repeat', 'queue-loop', 'queue-once'].includes(item.mode));
    if (!valid(message.base) || !valid(message.templates)) throw fail(t('无效请求。'));
    const current = (await chrome.storage.local.get('templates')).templates ?? [];
    if (draftClearPending || draftClearFailed || message.generation !== draftGeneration
        || JSON.stringify(current) !== JSON.stringify(message.base)) return { ok: false, conflict: true };
    await chrome.storage.local.set({ templates: message.templates });
    if (draftClearPending || draftClearFailed || message.generation !== draftGeneration)
      return { ok: false, conflict: true };
    return { ok: true };
  });
  draftQueue = work.catch(() => undefined);
  return work;
}
async function setJob(job) {
  if (job) {
    // Session state is the cancellation authority. Persistent state is only a
    // recovery plan; tab IDs from a previous browser session are never trusted.
    await chrome.storage.session.set({ job });
    try { await chrome.storage.local.set({ resumeJob: job }); }
    catch (error) {
      if (job.enabled) throw error;
      const storedFence = (await chrome.storage.local.get('submissionFenceUntil')).submissionFenceUntil;
      const oldJob = (await chrome.storage.local.get('resumeJob')).resumeJob;
      const deadlines = [storedFence, job.submissionFenceUntil, oldJob?.submissionFenceUntil,
        oldJob?.phase === 'sending' && oldJob.runKind !== 'reply-check' ? oldJob.runDeadline : null]
        .filter(value => Number.isFinite(value) && value > Date.now());
      if (deadlines.length) await chrome.storage.local.set({ submissionFenceUntil: Math.max(...deadlines) });
      // If a paused snapshot cannot be saved, discard stale running recovery.
      // The complete paused task remains available in this browser session.
      await chrome.storage.local.remove('resumeJob');
      if ((await chrome.storage.local.get('resumeJob')).resumeJob) throw error;
    }
  } else {
    await chrome.storage.session.remove('job');
    await chrome.storage.local.remove('resumeJob');
  }
}
async function logEvent(event, message, diagnostic = null, epoch = activityEpoch, at = Date.now()) {
  const result = await readUntilInvalidated(() => chrome.storage.local.get('logs'), activityReadInvalidation);
  if (result.invalidated || epoch !== activityEpoch) return;
  if (result.error) throw result.error;
  const stored = result.value.logs;
  const logs = !activityDiscardPrevious && Array.isArray(stored) ? stored.filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry)
    && Number.isFinite(entry.at) && typeof entry.event === 'string' && entry.event.length > 0 && typeof entry.message === 'string') : [];
  const codes = ['adapter-result', 'execution-exception', 'execution-timeout', 'no-valid-result', 'existing-draft', 'composer-changed', 'composer-unstable', 'composer-slow-write', 'chunk-unconfirmed', 'chunk-attachment', 'chunk-mismatch', 'timing-probe', 'send-not-ready', 'commit-not-dispatched', 'paste-unconfirmed', 'paste-attachment-unconfirmed', 'receipt-ambiguous', 'receipt-mismatch', 'document-replaced', 'unconfirmed-retry', 'auto-allowed-prompt'];
  const detail = diagnostic && codes.includes(diagnostic.code)
    ? { diagnostic: { code: diagnostic.code, ...(Number.isFinite(diagnostic.durationMs)
      ? { durationMs: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, diagnostic.durationMs)) } : {}) } } : {};
  if (detail.diagnostic) {
    if (['page', 'prepare', 'readiness', 'authorization', 'dispatch', 'receipt'].includes(diagnostic.stage)) detail.diagnostic.stage = diagnostic.stage;
    if (['none', 'execute-script', 'extension-message', 'page-readback'].includes(diagnostic.resultChannel)) detail.diagnostic.resultChannel = diagnostic.resultChannel;
    if (Number.isSafeInteger(diagnostic.leaseRenewals) && diagnostic.leaseRenewals >= 0) detail.diagnostic.leaseRenewals = Math.min(1000000, diagnostic.leaseRenewals);
  }
  if (detail.diagnostic?.code === 'timing-probe') {
    if (['authorization', 'page-timers'].includes(diagnostic.kind)) detail.diagnostic.kind = diagnostic.kind;
    if (['result', 'invalid-result', 'api-rejected', 'watchdog-expired'].includes(diagnostic.status)) detail.diagnostic.status = diagnostic.status;
    if (typeof diagnostic.firstMs === 'number' && Number.isFinite(diagnostic.firstMs)) {
      detail.diagnostic.firstMs = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, diagnostic.firstMs));
    }
    for (const key of ['hidden', 'ok', 'allowed']) {
      if (typeof diagnostic[key] === 'boolean') detail.diagnostic[key] = diagnostic[key];
    }
  }
  const write = chrome.storage.local.set({ logs: [...logs.slice(-199), { at, event, message, ...detail }] });
  activityStorageWrite = write;
  await write;
  if (epoch === activityEpoch) activityDiscardPrevious = false;
}
async function drainActivityEvents() {
  if (activityDraining) return;
  activityDraining = true;
  try {
    while (activityEvents.length) {
      const barrier = activityClearBarrier;
      await barrier.catch(() => undefined);
      if (barrier !== activityClearBarrier) continue;
      const entry = activityEvents.shift();
      if (!entry) break;
      try {
        if (entry.epoch === activityEpoch) await logEvent(entry.event, entry.message, entry.diagnostic, entry.epoch, entry.at);
      } catch { diagnosticFailure(entry.diagnosticEpoch); }
      finally { entry.resolve(); }
    }
  } finally {
    activityDraining = false;
    if (activityEvents.length) void drainActivityEvents();
  }
}
async function recordActivityEvent(event, message, diagnostic = null) {
  const epoch = diagnosticEpoch;
  const work = new Promise(resolve => {
    activityEvents.push({ event, message, diagnostic, at: Date.now(), epoch: activityEpoch, diagnosticEpoch: epoch, resolve });
    while (activityEvents.length > 200) { activityEvents.shift().resolve(); diagnosticFailure(epoch); }
  });
  void drainActivityEvents();
  let timer;
  try {
    // This bounds only diagnostic observation, never preparation or sending.
    await Promise.race([work, new Promise(resolve => {
      timer = setTimeout(() => { diagnosticFailure(epoch); resolve(); }, 250);
    })]);
  } finally { clearTimeout(timer); }
}
function clearActivityLog() {
  activityEpoch++;
  activityReadInvalidation.invalidate();
  activityReadInvalidation = invalidation();
  const epoch = activityEpoch;
  activityDiscardPrevious = true;
  for (const entry of activityEvents.splice(0)) entry.resolve();
  const priorWrite = activityStorageWrite;
  activityClearBarrier = Promise.all([activityClearBarrier.catch(() => undefined), priorWrite.catch(() => undefined)])
    .then(async () => {
      await chrome.storage.local.remove('logs');
      if (epoch === activityEpoch) activityDiscardPrevious = false;
    });
  return activityClearBarrier;
}
async function updateBadge(job) {
  try {
    await chrome.action.setBadgeText({ text: !job ? '' : !job.enabled ? 'Ⅱ' : job.phase === 'sending' ? '…' : job.needsAttention ? '!' : 'ON' });
    await chrome.action.setBadgeBackgroundColor({ color: !job?.enabled ? '#64748B' : job.needsAttention ? '#B45F2A' : '#156C52' });
    await chrome.action.setTitle({ title: job ? `Agent Continue — ${job.statusText}` : t('Agent Continue — 选择 dot 或会话后开始') });
  } catch { /* Badge errors cannot authorize a send. */ }
}
async function syncAlarm(job) {
  if (!job?.enabled) { await chrome.alarms.clear(ALARM_NAME); return; }
  const periodic = alarm => Number.isFinite(alarm?.periodInMinutes) && alarm.periodInMinutes > 0;
  if (!periodic(await chrome.alarms.get(ALARM_NAME))) {
    await chrome.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: 1 });
    if (!periodic(await chrome.alarms.get(ALARM_NAME))) throw fail(t('无法创建后台计时器。'));
  }
}
async function syncPower(job) {
  if (!chrome.power) return false;
  try {
    if (job?.enabled && job.keepAwake && await chrome.permissions.contains({ permissions: ['power'] })) {
      chrome.power.requestKeepAwake('system');
      return true;
    }
    chrome.power.releaseKeepAwake();
  } catch { /* Optional permission may be revoked during a task. */ }
  return false;
}
async function protectFromDiscard(tab, enabled) {
  const original = typeof tab.autoDiscardable === 'boolean' ? tab.autoDiscardable : null;
  if (!enabled || original !== true) return { originalAutoDiscardable: original, autoDiscardableChanged: false, discardProtection: !enabled ? 'off' : original === false ? 'active' : 'unavailable' };
  try {
    const updated = await chrome.tabs.update(tab.id, { autoDiscardable: false });
    return { originalAutoDiscardable: original, autoDiscardableChanged: true, discardProtection: updated?.autoDiscardable === false ? 'active' : 'unavailable' };
  } catch { return { originalAutoDiscardable: original, autoDiscardableChanged: false, discardProtection: 'unavailable' }; }
}
async function restoreDiscard(job) {
  if (!job?.autoDiscardableChanged || typeof job.originalAutoDiscardable !== 'boolean') return true;
  try {
    const tab = await chrome.tabs.update(job.tabId, { autoDiscardable: job.originalAutoDiscardable });
    return tab?.autoDiscardable === job.originalAutoDiscardable;
  } catch { return false; }
}
function hasDeliveryEvidence(delivery) {
  return Boolean(delivery?.retired.some(item => item.manualSubmission || item.confirmedReceipt
    || item.dispatched || item.commitUncertain));
}
function deliveryIntentCurrent(delivery) {
  return !delivery || (delivery.version === intentVersion && pendingStopIntents === 0 && failedStopVersion !== intentVersion);
}
function pendingRunAllowed(pending) {
  if (!pending?.delivery?.retired.length) return true;
  return !pending.retiredForReplacement && deliveryIntentCurrent(pending.delivery) && !hasDeliveryEvidence(pending.delivery);
}
function evidenceMatchesJob(pending, job) {
  // Only retired documents can route validated evidence to a successor.
  const runId = pending.retiredForReplacement ? pending.delivery.runId : pending.runId;
  return job?.enabled && job.phase === 'sending' && job.runId === runId
    && job.tabId === pending.tabId && job.url === pending.url;
}
async function pauseLocked(job, message, event = 'paused', diagnostic = null, interruptedTarget = false) {
  if (!job) { await syncAlarm(null); await syncPower(null); await updateBadge(null); return null; }
  if (job.phase === 'sending' && typeof job.runId === 'string') revokedRuns.add(job.runId);
  const pendingForRun = [...pendingPageResults.values()].filter(pending => pending.runId === job.runId
    || pending.retiredForReplacement && evidenceMatchesJob(pending, job));
  const activePending = pendingForRun.filter(pending => !pending.retiredForReplacement);
  const ambiguousRecovery = () => job.phase === 'sending' && pendingForRun.some(pending => pending.delivery?.ambiguousRecovery);
  for (const pending of pendingForRun) { pending.closed = true; pending.pauseWriting = true; }
  let receipt;
  let manualUnconfirmed;
  let dispatchUnconfirmed = job.phase === 'sending' && pendingForRun.some(pending => pending.mainCommitPending === true
    || pending.dispatched === true || pending.commitUncertain === true);
  let submissionFenceUntil = null;
  const pausedRunId = token();
  const makePaused = () => {
    receipt = job.enabled && job.phase === 'sending' && !ambiguousRecovery()
      ? pendingForRun.find(pending => pending.confirmedReceipt && !pending.receiptAccounted) : null;
    const paused = { ...job, enabled: false, runId: pausedRunId, runDeadline: null, phase: 'idle', nextAt: null, statusText: message, discardProtection: 'paused', systemAwake: false, needsAttention: event === 'unconfirmed' || diagnostic?.code === 'composer-slow-write' };
    manualUnconfirmed = job.enabled && job.phase === 'sending'
      && (job.manualSubmissionPending || pendingForRun.some(pending => pending.manualSubmission || pending.confirmedReceipt?.diagnosticProgress?.observations?.manualPending))
      && receipt?.confirmedReceipt?.status !== 'manual-sent';
    if (interruptedTarget && (!receipt || manualUnconfirmed)) {
      if (!manualUnconfirmed) paused.unknownCount = (paused.unknownCount || 0) + 1;
      paused.lastResult = 'unknown';
      paused.lastDiagnosticCode = 'document-replaced';
      paused.awaitingReply = false;
    }
    if (manualUnconfirmed) {
      paused.unknownCount = (paused.unknownCount || 0) + 1;
      paused.needsAttention = true;
      paused.statusText = t('手动提交结果未确认；已暂停，请检查会话后再继续。');
      paused.manualSubmissionPending = false;
    }
    if ((dispatchUnconfirmed || ambiguousRecovery()) && !receipt && !manualUnconfirmed) {
      if (!interruptedTarget) paused.unknownCount = (paused.unknownCount || 0) + 1;
      paused.lastResult = 'unknown';
      paused.awaitingReply = false;
      paused.needsAttention = true;
      paused.statusText = t('提交结果未确认；已暂停，请检查会话后再继续。');
    }
    if (receipt) {
      const result = receipt.confirmedReceipt;
      if (!manualUnconfirmed) {
        if (interruptedTarget) {
          paused.lastResult = result.status;
          paused.lastDiagnosticCode = null;
          paused.statusText = t('已确认本轮提交；目标已变化，任务保持暂停。');
        }
        if (result.status === 'sent') paused.sentCount += 1;
        else paused.manualSentCount = (paused.manualSentCount || 0) + 1;
        paused.promptDelivery = null;
        if (paused.mode !== 'repeat') paused.queueIndex += 1;
        if (paused.mode === 'queue-loop') paused.queueIndex %= paused.queue.length;
        if (typeof result.identity === 'string' && !paused.targetIdentity) paused.targetIdentity = result.identity.slice(0, 500);
        paused.assistantToken = typeof result.assistantToken === 'string' ? result.assistantToken.slice(0, 500) : null;
        paused.assistantCount = Number(result.assistantCount) || 0;
        paused.awaitingReply = paused.scheduleMode === 'after-reply';
      }
      paused.manualSubmissionPending = false;
    }
    if (submissionFenceUntil !== null) {
      paused.submissionFenceUntil = submissionFenceUntil;
      if (!manualUnconfirmed && !receipt) paused.statusText = t('已暂停后续发送；正在进行的页面提交尚未确认停止。');
    }
    return paused;
  };
  let paused = makePaused();
  const persistPaused = async () => {
    for (;;) {
      await setJob(paused);
      const updated = makePaused();
      if (JSON.stringify(updated) === JSON.stringify(paused)) break;
      paused = updated;
    }
  };
  try {
    if (job.enabled && job.phase === 'sending' && job.runKind !== 'reply-check'
        && activePending.length && Number.isFinite(job.runDeadline) && job.runDeadline > Date.now()) {
      submissionFenceUntil = Math.max(Number.isFinite(job.submissionFenceUntil) ? job.submissionFenceUntil : 0, job.runDeadline);
      paused = makePaused();
    }
    await persistPaused();
    wakeRunWaiters(job.runId);
    for (const pending of pendingPageResults.values()) {
      if (pending.runId !== job.runId || pending.accountingReceipt || pending === receipt || pending.receiptAccounted) continue;
      let timeout;
      let revoked = false;
      try {
        const reply = await Promise.race([
          chrome.tabs.sendMessage(pending.tabId, { type: 'CANCEL_RUN', runId: pending.runId, resultToken: pending.resultToken },
            pending.documentId ? { documentId: pending.documentId } : { frameId: 0 }),
          new Promise(resolve => { timeout = setTimeout(() => resolve(null), 3000); }),
        ]);
        revoked = reply?.revoked === true && reply.runId === pending.runId && reply.resultToken === pending.resultToken;
        if (revoked && reply.diagnosticProgress) {
          if (Number.isSafeInteger(reply.diagnosticProgress?.counters?.dispatchAttempts)
              && reply.diagnosticProgress.counters.dispatchAttempts > 0) dispatchUnconfirmed = true;
          pageProgress(pending, reply.diagnosticProgress, 'adapter');
        }
      } catch { }
      finally { clearTimeout(timeout); }
      if (!revoked) {
        submissionFenceUntil = Math.max(Number.isFinite(submissionFenceUntil) ? submissionFenceUntil : 0, job.runDeadline);
        try {
          const storedFence = (await chrome.storage.session.get('submissionFenceUntil')).submissionFenceUntil;
          await chrome.storage.session.set({ submissionFenceUntil: Math.max(Number.isFinite(storedFence) ? storedFence : 0, submissionFenceUntil) });
        } catch { }
      } else if (!dispatchUnconfirmed && pendingForRun.every(item => item === pending || item.receiptAccounted || item.accountingReceipt || item === receipt)) {
        submissionFenceUntil = null;
        delete job.submissionFenceUntil;
      }
      const updated = makePaused();
      if (JSON.stringify(updated) !== JSON.stringify(paused)) {
        paused = updated;
        await persistPaused();
      }
    }
    if (receipt && !manualUnconfirmed) {
      submissionFenceUntil = null;
      delete job.submissionFenceUntil;
      const updated = makePaused();
      if (JSON.stringify(updated) !== JSON.stringify(paused)) {
        paused = updated;
        await persistPaused();
      }
    }
    if (receipt) receipt.receiptAccounted = true;
    for (const pending of pendingForRun) {
      pending.pauseWriting = false;
      if (pending.manualSubmission) pending.manualPauseAccounted = true;
      if (!pending.accountingReceipt) pending.resolve(pending.receiptAccounted ? pending.confirmedReceipt : { status: 'cancelled' });
    }
  } catch (error) {
    for (const pending of pendingForRun) { pending.pauseWriting = false; if (pending.confirmedReceipt) pending.receiptFailed = true; }
    if (receipt) {
      try {
        const current = await getJob();
        if (current?.id === job.id && current.runId === pausedRunId) {
          receipt.partialPauseJob = paused;
          receipt.partialPauseObserved = current;
        }
      } catch { }
    }
    wakeRunWaiters(job.runId);
    for (const pending of pendingForRun) {
      try {
        Promise.resolve(chrome.tabs.sendMessage(pending.tabId, { type: 'CANCEL_RUN', runId: pending.runId, resultToken: pending.resultToken },
          pending.documentId ? { documentId: pending.documentId } : { frameId: 0 })).catch(() => undefined);
      } catch { }
    }
    throw error;
  }
  try { await syncAlarm(paused); } catch { /* A stale alarm cannot authorize a paused task. */ }
  await syncPower(paused);
  if (await restoreDiscard(job) && paused.autoDiscardableChanged) {
    paused.autoDiscardableChanged = false;
    await setJob(paused);
  }
  const detail = interruptedTarget && paused.lastResult === 'unknown'
    ? { code: 'document-replaced', durationMs: Date.now() - job.lastRunAt }
    : diagnostic;
  await recordActivityEvent(event, paused.statusText, detail);
  await updateBadge(paused);
  return paused;
}
async function pause(message = t('已手动暂停；后续定时发送已停止。')) {
  return transact(async () => ({ ok: true, job: await pauseLocked(await getJob(), message) }));
}
function assertIntent(version) { if (version !== intentVersion) throw fail(t('此操作已被较新的开始或暂停操作取消。')); }
function assertSupportedTab(tab, expectedUrl = null) {
  if (!tab || !Number.isInteger(tab.id) || !validateTarget(tab.url)) throw fail(t('请选择 chatgpt.com 的 Your dot 页面或已有会话；首页与共享页面不支持。'));
  if (expectedUrl && normalizeUrl(tab.url) !== expectedUrl) throw fail(t('目标标签页已切换到其他会话；原任务会等待原地址重新打开。'));
}
async function executePage(args, tabId, deadline = Date.now() + EXECUTION_MS, trace = null, traceEpoch = diagnosticEpoch, delivery = null) {
  let timer;
  let recoveryTimer;
  let watchdogExpired = false;
  let missingResult = false;
  let rejectedResult = false;
  let settled = false;
  let waitingReported = false;
  let resultChannel = 'none';
  let pending;
  const resultToken = args.mode === 'send' ? token() : null;
  let redundantResult;
  if (resultToken) {
    args = { ...args, resultToken };
    redundantResult = new Promise(resolve => {
      pending = { runId: args.runId, resultToken, tabId, url: args.expectedUrl, stage: 'page', leaseRenewals: 0, delivery,
        ...(delivery?.mainCommitAdmitted ? { documentId: delivery.commitDocumentId } : {}),
        trace: traceEpoch === diagnosticEpoch ? trace : null, diagnosticEpoch: traceEpoch,
        resolve: value => { if (!settled && resultChannel === 'none') resultChannel = 'extension-message'; resolve(value); } };
      pendingPageResults.set(resultToken, pending);
      deliveryProgress(pending, { reason: 'starting' });
    });
  }
  const executionDiagnostic = () => pending ? { stage: pending.stage, resultChannel, leaseRenewals: pending.leaseRenewals } : {};
  try {
    const executionTarget = () => ({ tabId, ...(pending?.documentId ? { documentIds: [pending.documentId] } : {}) });
    const runScript = async (world) => {
      if (!pendingRunAllowed(pending)) return { status: 'cancelled' };
      deliveryCounter(pending, 'pageAdmissions');
      const res = await chrome.scripting.executeScript({
        target: executionTarget(),
        world,
        func: pageAction,
        args: [args]
      });
      return res?.find(frame => frame.frameId === 0)?.result ?? res?.[0]?.result;
    };

    const acceptExecutionResult = value => {
      if (resultToken && (!value || !RESULT_STATUSES.has(value.status))) {
        missingResult = true;
        deliveryProgress(pending, { reason: 'result-missing' });
        return false;
      }
      if (pending && (!pending.closed || pending.pauseWriting) && ['sent', 'manual-sent'].includes(value?.status)) pending.confirmedReceipt ??= value;
      if (resultChannel === 'none') resultChannel = 'execute-script';
      return true;
    };
    const runner = async () => {
      // Keep run authorization in the extension context; never replay a send in another world.
      let value;
      try { value = await runScript('ISOLATED'); }
      catch (error) {
        if (!resultToken) throw error;
        rejectedResult = true;
        deliveryCounter(pending, 'transportErrors');
        deliveryProgress(pending, { reason: 'transport-rejected' });
        return redundantResult;
      }
      if (!acceptExecutionResult(value)) {
        // A lost injection return must not discard the same invocation's receipt.
        return redundantResult;
      }
      if (pending && (['sent', 'manual-sent'].includes(value?.status) || pending.retiredForReplacement)) {
        void receivePageResult({ runId: pending.runId, resultToken, result: value },
          { id: chrome.runtime.id, tab: { id: tabId, url: pending.url }, frameId: 0, documentId: pending.documentId, url: pending.url }).catch(() => undefined);
        return redundantResult;
      }
      return value;
    };

    if (pending) {
      let admissionOutstanding = false;
      const recoverAdmission = async () => {
        try {
          const current = await transact(getJob);
          if (settled || !current?.enabled || current.phase !== 'sending' || current.runId !== args.runId
            || current.tabId !== tabId || current.url !== args.expectedUrl) return;
          // Diagnose replacement using the current top frame, read-only. Every
          // actual page admission and MAIN mutation stays on its pinned document.
          const frames = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED',
            func: pageInvocationState, args: [{ runId: args.runId, resultToken }] });
          const frame = frames?.find(item => item.frameId === 0);
          if (settled || !frame || !['absent', 'running', 'settled'].includes(frame.result?.state)) return;
          if ((!pending.documentId || pending.documentId === frame.documentId) && frame.result.state === 'settled'
            && ['sent', 'manual-sent'].includes(frame.result.result?.status) && (!pending.closed || pending.pauseWriting)) {
            pending.confirmedReceipt ??= translatePageResult(frame.result.result);
          }
          const latest = await transact(getJob);
          if (settled || !pendingRunAllowed(pending) || !latest?.enabled || latest.phase !== 'sending' || latest.runId !== args.runId
            || latest.tabId !== tabId || latest.url !== args.expectedUrl) return;
          if (pending.documentId && frame.documentId && pending.documentId !== frame.documentId) {
            deliveryCounter(pending, 'documentChanges');
            deliveryProgress(pending, { reason: 'document-replaced' });
            if (delivery && deliveryIntentCurrent(delivery) && pending.ownsModelStages && !pending.mainCommitAdmitted && !pending.manualSubmission
              && !latest.manualSubmissionPending && !pending.confirmedReceipt && !pending.dispatched && !pending.commitUncertain) {
              // Keep old evidence routable, but deny every old authorization.
              pending.retiredForReplacement = true;
              delivery.retired.push(pending);
              pending.resolve({ status: 'blocked', diagnosticCode: 'commit-not-dispatched', retryable: true,
                diagnosticProgress: { counters: { dispatchAttempts: 0, manualIntents: 0 } } });
              wakeRunWaiters(pending.runId);
              return;
            }
            pending.resolve({ status: 'unknown', message: t('\u9875\u9762\u672a\u8fd4\u56de\u53ef\u786e\u8ba4\u7684\u7ed3\u679c\u3002') });
            return;
          }
          pending.documentId ??= frame.documentId;
          if (frame.result.diagnosticProgress) pageProgress(pending, frame.result.diagnosticProgress, 'adapter');
          if (frame.result.state === 'settled' && RESULT_STATUSES.has(frame.result.result?.status)) {
            if (resultChannel === 'none') resultChannel = 'page-readback';
            if (['sent', 'manual-sent'].includes(frame.result.result.status)) {
              void receivePageResult({ runId: pending.runId, resultToken, result: frame.result.result },
                { id: chrome.runtime.id, tab: { id: tabId, url: pending.url }, frameId: 0, documentId: pending.documentId, url: pending.url }).catch(() => undefined);
            } else pending.resolve(frame.result.result);
          } else if (frame.result.state === 'absent' && !admissionOutstanding) {
            // The same token is atomically deduplicated inside pageAction. Even
            // an original queued request arriving later can only join it.
            admissionOutstanding = true;
            runScript('ISOLATED').then(value => {
              if (!settled && acceptExecutionResult(value)) {
                if (['sent', 'manual-sent'].includes(value.status)) {
                  void receivePageResult({ runId: pending.runId, resultToken, result: value },
                    { id: chrome.runtime.id, tab: { id: tabId, url: pending.url }, frameId: 0, documentId: pending.documentId, url: pending.url }).catch(() => undefined);
                } else pending.resolve(value);
              }
            }, () => { rejectedResult = true; }).finally(() => { admissionOutstanding = false; });
          }
        } catch { /* Reobserve the same invocation when the renderer is reachable. */ }
        finally {
          if (!settled) recoveryTimer = setTimeout(recoverAdmission, 2000);
        }
      };
      recoveryTimer = setTimeout(recoverAdmission, 2000);
    }

    const observedResult = await Promise.race([
      runner(),
      ...(redundantResult ? [redundantResult] : []),
      new Promise((_, reject) => {
        const inspectLease = async () => {
          if (resultToken) {
            const job = await transact(async () => {
              const current = await getJob();
              if (!current?.enabled || current.phase !== 'sending' || current.runId !== args.runId
                || current.tabId !== tabId || current.url !== args.expectedUrl) return null;
              // Waiting owns this same live invocation, not another submit. A
              // delayed renderer/result transport is not a send time limit.
              const renewed = { ...current, runDeadline: Date.now() + EXECUTION_MS };
              if (!waitingReported) {
                renewed.statusText = t('仍在等待目标页面或发送回执；无固定等待时限，可随时暂停。');
                await recordActivityEvent('busy', t('仍在等待目标页面或发送回执；无固定等待时限，可随时暂停。'),
                  { code: rejectedResult ? 'execution-exception' : missingResult ? 'no-valid-result' : 'adapter-result',
                    durationMs: Date.now() - current.lastRunAt, ...executionDiagnostic() });
                waitingReported = true;
              }
              await setJob(renewed);
              pending.leaseRenewals++;
              return renewed;
            });
            if (settled) return;
            if (job?.enabled && job.phase === 'sending' && job.runId === args.runId
              && job.tabId === tabId && job.url === args.expectedUrl && job.runDeadline > Date.now()) {
              timer = setTimeout(() => { inspectLease().catch(reject); }, job.runDeadline - Date.now());
              return;
            }
          }
          watchdogExpired = true;
          reject(fail(t('页面操作超时，本周期结果未确认。')));
        };
        timer = setTimeout(() => { inspectLease().catch(reject); }, Math.max(1, deadline - Date.now()));
      }),
    ]);
    const result = pending?.confirmedReceipt ? await redundantResult : observedResult;
    if (result?.diagnosticProgress) pageProgress(pending, result.diagnosticProgress, 'adapter');
    const value = translatePageResult(result);
    deliveryProgress(pending, { resultChannel });
    const manualSubmission = pending?.manualSubmission === true || value?.diagnosticProgress?.observations?.manualPending === true;
    if (!value || !RESULT_STATUSES.has(value.status)
      || (['draft', 'blocked'].includes(value.status) && (value.diagnosticCode === 'composer-changed' || retiredDraftNotice(value.message)))) {
      return { status: 'unknown', message: t('页面未返回可确认的结果。'), diagnosticCode: 'no-valid-result', executionDiagnostic: executionDiagnostic(), manualSubmission,
        dispatched: pending?.dispatched === true || pending?.commitUncertain === true };
    }
    if (args.mode === 'send' && ['blocked', 'draft', 'busy', 'error'].includes(value.status)) {
      const counters = value.diagnosticProgress?.counters;
      const hasManualIntent = manualSubmission || counters?.manualIntents > 0;
      const knownPreSubmitStop = value.retryable !== true && value.status === 'blocked'
        && ['composer-slow-write', 'chunk-unconfirmed', 'chunk-attachment', 'chunk-mismatch'].includes(value.diagnosticCode) || (value.retryable !== true && value.status === 'busy' && value.diagnosticCode === 'auto-allowed-prompt');
      if (hasManualIntent || pending?.confirmedReceipt || pending?.dispatched === true || pending?.commitUncertain === true || counters?.dispatchAttempts !== 0 || counters?.manualIntents !== 0
          || (value.retryable !== true && !knownPreSubmitStop)) {
        return { status: 'unknown', message: t('页面未返回可确认的结果。'), diagnosticCode: 'adapter-result', executionDiagnostic: executionDiagnostic(), manualSubmission: hasManualIntent,
          dispatched: pending?.dispatched === true || pending?.commitUncertain === true || Number.isSafeInteger(counters?.dispatchAttempts) && counters.dispatchAttempts > 0, retryable: false };
      }
    }
    // Return only bounded adapter status fields.
    const diagnosticCode = (value.status === 'draft' && value.diagnosticCode === 'existing-draft')
      || (value.status === 'busy' && ['send-not-ready', 'auto-allowed-prompt'].includes(value.diagnosticCode))
      || (value.status === 'blocked' && ['commit-not-dispatched', 'composer-unstable', 'composer-slow-write', 'chunk-unconfirmed', 'chunk-attachment', 'chunk-mismatch'].includes(value.diagnosticCode))
      || (value.status === 'unknown' && ['paste-unconfirmed', 'paste-attachment-unconfirmed', 'receipt-ambiguous', 'receipt-mismatch', 'document-replaced'].includes(value.diagnosticCode)) ? value.diagnosticCode : null;
    const dispatchAttempts = value.diagnosticProgress?.counters?.dispatchAttempts;
    return { status: value.status, message: String(value.message || '').slice(0, 300), identity: typeof value.identity === 'string' ? value.identity.slice(0, 500) : null, assistantToken: typeof value.assistantToken === 'string' ? value.assistantToken.slice(0, 500) : null, assistantCount: Number(value.assistantCount) || 0, diagnosticCode, executionDiagnostic: executionDiagnostic(), manualSubmission,
      dispatched: pending?.dispatched === true || pending?.commitUncertain === true || Number.isSafeInteger(dispatchAttempts) && dispatchAttempts > 0,
      retryable: !manualSubmission && value.retryable === true && ['blocked', 'draft', 'busy', 'error'].includes(value.status) };
  } catch (error) {
    if (watchdogExpired) return { status: 'unknown', message: t('页面操作超时，本周期结果未确认。'), diagnosticCode: rejectedResult ? 'execution-exception' : missingResult ? 'no-valid-result' : 'execution-timeout', executionDiagnostic: executionDiagnostic(), manualSubmission: pending?.manualSubmission === true,
      dispatched: pending?.dispatched === true || pending?.commitUncertain === true };
    throw error;
  } finally {
    settled = true; clearTimeout(timer); clearTimeout(recoveryTimer);
    if (pending?.trace) {
      clearTimeout(pending.traceTimer);
      if (trace) Object.assign(trace, pending.trace);
      void persistDeliveryTrace(pending.trace, pending.diagnosticEpoch);
    }
    if (resultToken && !pending?.confirmedReceipt && !pending?.retiredForReplacement) pendingPageResults.delete(resultToken);
  }
}
async function receivePageResult(message, sender) {
  const pending = pendingPageResults.get(message.resultToken);
  if (!pending || message.runId !== pending.runId || sender.id !== chrome.runtime.id
    || sender.tab?.id !== pending.tabId || sender.frameId !== 0
    || (pending.documentId && sender.documentId !== pending.documentId)
    || normalizeUrl(sender.url || sender.tab?.url) !== pending.url
    || !message.result || !RESULT_STATUSES.has(message.result.status) || (pending.closed && !pending.receiptFailed && !pending.pauseWriting)) return { ok: false };
  const confirmed = ['sent', 'manual-sent'].includes(message.result.status);
  const receiptResult = () => pending.delivery?.ambiguousRecovery
    ? { status: 'unknown', diagnosticCode: 'document-replaced' } : pending.confirmedReceipt ?? message.result;
  if (pending.retiredForReplacement) {
    const progress = message.result.diagnosticProgress;
    if (progress?.observations?.manualPending === true || progress?.counters?.manualIntents > 0) {
      if (!confirmed) return receiveManualSubmission(message, sender);
      pending.manualSubmission = true;
    }
  }
  const duplicate = confirmed && Boolean(pending.receiptReceived);
  if (confirmed) {
    if (pending.confirmedReceipt && pending.confirmedReceipt.status !== message.result.status) return { ok: false };
    pending.confirmedReceipt ??= translatePageResult(message.result);
    pending.receiptReceived = true;
    if (pending.retiredForReplacement && pending.delivery.successorDispatchPossible) pending.delivery.ambiguousRecovery = true;
  }
  const accounting = transact(async () => {
    if (pending.receiptAccounted) return { ok: !duplicate };
    if (duplicate && !pending.receiptFailed) return { ok: false };
    if (confirmed) pending.receiptFailed = false;
    const job = await getJob();
    if (pending.partialPauseJob && JSON.stringify(job) === JSON.stringify(pending.partialPauseObserved)) {
      try {
        await setJob(pending.partialPauseJob);
        pending.receiptAccounted = true;
        pending.partialPauseJob = null;
        pending.partialPauseObserved = null;
        pending.resolve(receiptResult());
        return { ok: true };
      } catch (error) {
        pending.receiptFailed = true;
        try { pending.partialPauseObserved = await getJob(); } catch { }
        throw error;
      }
    }
    if (pending.partialReceiptJob && job?.id === pending.partialReceiptJob.id && job.runId === pending.partialReceiptJob.runId
      && JSON.stringify(job) === JSON.stringify(pending.partialReceiptJob)) {
      try {
        await setJob(job);
        if (pending.delivery?.ambiguousRecovery && pending.receiptBaselineJob) {
          await pauseLocked(pending.receiptBaselineJob, t('提交结果未确认；已暂停，请检查会话后再继续。'),
            'unconfirmed', { code: 'document-replaced' });
        }
        pending.receiptAccounted = true;
        pending.partialReceiptJob = null;
        pending.resolve(receiptResult());
        return { ok: true };
      } catch (error) { pending.receiptFailed = true; throw error; }
    }
    if (!evidenceMatchesJob(pending, job)) return { ok: false };
    if (confirmed) {
      const value = pending.confirmedReceipt;
      pending.receiptBaselineJob ??= job;
      pending.accountingReceipt = true;
      try {
        if (pending.delivery?.ambiguousRecovery) {
          await pauseLocked(job, t('提交结果未确认；已暂停，请检查会话后再继续。'), 'unconfirmed', { code: 'document-replaced' });
        } else await finishRoundLocked(job, {
          status: value.status,
          identity: typeof value.identity === 'string' ? value.identity.slice(0, 500) : null,
          assistantToken: typeof value.assistantToken === 'string' ? value.assistantToken.slice(0, 500) : null,
          assistantCount: Number(value.assistantCount) || 0,
          manualSubmission: pending.manualSubmission === true || value.diagnosticProgress?.observations?.manualPending === true,
        }, pending.delivery);
        pending.receiptAccounted = true;
        if (pending.retiredForReplacement && job.runId !== pending.runId) {
          for (const next of pendingPageResults.values()) {
            if (next.runId === job.runId) next.resolve(pending.delivery.ambiguousRecovery
              ? { status: 'unknown' } : pending.confirmedReceipt);
          }
        }
      } catch (error) {
        pending.receiptFailed = true;
        try {
          const current = await getJob();
          if (current?.id === job.id && current.runId === job.runId && current.phase === 'idle') pending.partialReceiptJob = current;
        } catch { }
        throw error;
      } finally { pending.accountingReceipt = false; }
    }
    pending.resolve(receiptResult());
    return { ok: true };
  });
  return accounting.catch(error => {
    if (confirmed && !pending.receiptAccounted) {
      pending.receiptFailed = true;
      if (!pending.receiptRetryTimer) {
        const delay = Math.min(5000, 25 * 2 ** Math.min(pending.receiptRetryAttempts || 0, 8));
        pending.receiptRetryAttempts = (pending.receiptRetryAttempts || 0) + 1;
        pending.receiptRetryTimer = setTimeout(() => {
          pending.receiptRetryTimer = null;
          if (pendingPageResults.get(message.resultToken) === pending && !pending.receiptAccounted) {
            void receivePageResult(message, sender).catch(() => undefined);
          }
        }, delay);
      }
    }
    throw error;
  });
}
async function receiveManualSubmission(message, sender) {
  const pending = pendingPageResults.get(message.resultToken);
  if (!pending || pending.runId !== message.runId || sender.id !== chrome.runtime.id
    || sender.tab?.id !== pending.tabId || sender.frameId !== 0
    || (pending.documentId && sender.documentId !== pending.documentId)
    || normalizeUrl(sender.url || sender.tab?.url) !== pending.url || (pending.closed && !pending.pauseWriting)) return { ok: false };
  pending.manualSubmission = true;
  if (pending.retiredForReplacement && pending.delivery.successorDispatchPossible) pending.delivery.ambiguousRecovery = true;
  pending.stage = 'receipt';
  deliveryProgress(pending, { reason: 'manual-submission', observations: { manualPending: true } });
  return transact(async () => {
    if (pending.manualPauseAccounted) return { ok: true };
    const job = await getJob();
    if (!evidenceMatchesJob(pending, job)) return { ok: false };
    await setJob({ ...job, manualSubmissionPending: true });
    if (pending.retiredForReplacement && job.runId !== pending.runId) {
      for (const next of pendingPageResults.values()) {
        if (next.runId === job.runId) next.resolve({ status: 'unknown', diagnosticProgress: { observations: { manualPending: true } } });
      }
    }
    return { ok: true };
  });
}
async function probe(tab, config, targetIdentity = null) {
  assertSupportedTab(tab);
  if (tab.discarded || tab.frozen) return { status: 'busy', message: t('目标标签页已休眠或冻结，等待页面恢复。') };
  return executePage({ mode: 'check', expectedUrl: normalizeUrl(tab.url), prompt: '', runId: null, stopMarkers: config.stopMarkers ?? [], waitForIdle: config.waitForIdle ?? false, sendMethod: config.sendMethod ?? 'auto', targetIdentity }, tab.id);
}
async function currentTab(tabId) {
  if (Number.isInteger(tabId)) return chrome.tabs.get(tabId);
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}
async function availableTargets() {
  try { return (await chrome.tabs.query({ url: 'https://chatgpt.com/*' })).filter(tab => validateTarget(tab.url)).map(tab => ({ id: tab.id, title: tab.title || 'ChatGPT / dot', url: tab.url })); }
  catch { return []; }
}
async function checkPage(tabId) {
  const tab = await currentTab(tabId);
  return { ok: true, result: await probe(tab, await getConfig()) };
}
async function timingDiagnostics() {
  const job = await transact(getJob);
  if (!job || job.enabled) throw fail(t('请先暂停已绑定的任务，再运行不发送诊断。'));
  let tab;
  if (Number.isInteger(job.tabId)) {
    try { tab = await chrome.tabs.get(job.tabId); } catch { /* Resolve the saved URL below. */ }
  }
  if (!tab || normalizeUrl(tab.url) !== job.url) {
    const matches = (await chrome.tabs.query({ url: 'https://chatgpt.com/*' }))
      .filter(item => normalizeUrl(item.url) === job.url);
    if (matches.length !== 1) throw fail(t('请只打开一个原绑定页面副本，再运行诊断。'));
    [tab] = matches;
  }
  assertSupportedTab(tab, job.url);
  const observations = [];
  for (const kind of ['authorization', 'page-timers']) {
    let timer;
    let watchdogExpired = false;
    try {
      const frames = await Promise.race([
        chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', args: [kind],
          func: async kind => {
            const started = Date.now();
            if (kind === 'authorization') {
              const reply = await chrome.runtime.sendMessage({ type: 'CHECK_RUN', runId: 'readonly-timing-probe' });
              return { elapsedMs: Date.now() - started, ok: reply?.ok === true, allowed: reply?.allowed === true };
            }
            await new Promise(resolve => setTimeout(resolve, 60));
            const firstMs = Date.now() - started;
            await new Promise(resolve => setTimeout(resolve, 180));
            return { firstMs, elapsedMs: Date.now() - started, hidden: document.visibilityState === 'hidden' };
          } }),
        new Promise((_, reject) => { timer = setTimeout(() => {
          watchdogExpired = true;
          reject(new Error('diagnostic-timeout'));
        }, 4000); }),
      ]);
      const value = frames?.find(frame => frame.frameId === 0)?.result;
      if (!value || !Number.isFinite(value.elapsedMs) || value.elapsedMs < 0) {
        observations.push({ kind, status: 'invalid-result' });
      } else if (kind === 'authorization') {
        observations.push({ kind, status: 'result', elapsedMs: Math.min(120000, Math.round(value.elapsedMs)),
          ok: value.ok === true, allowed: value.allowed === true });
      } else if (Number.isFinite(value.firstMs) && value.firstMs >= 0) {
        observations.push({ kind, status: 'result', firstMs: Math.min(120000, Math.round(value.firstMs)),
          elapsedMs: Math.min(120000, Math.round(value.elapsedMs)), hidden: value.hidden === true });
      } else observations.push({ kind, status: 'invalid-result' });
    } catch {
      observations.push({ kind, status: watchdogExpired ? 'watchdog-expired' : 'api-rejected' });
    } finally { clearTimeout(timer); }
  }
  await transact(async () => {
    for (const item of observations) {
      await recordActivityEvent('timing-diagnostics', t('只读发送计时诊断已完成。'), {
        code: 'timing-probe', kind: item.kind, status: item.status,
        durationMs: item.elapsedMs, firstMs: item.firstMs,
        hidden: item.hidden, ok: item.ok, allowed: item.allowed,
      });
    }
  });
  return { ok: true, observations };
}
function validatedConfig(input) {
  try { return readConfig(input); } catch (error) { throw fail(error.message); }
}
async function assertSubmissionReleased(job) {
  const storedFence = (await chrome.storage.session.get('submissionFenceUntil')).submissionFenceUntil;
  const durableFence = (await chrome.storage.local.get('submissionFenceUntil')).submissionFenceUntil;
  if ([storedFence, durableFence, job?.submissionFenceUntil].some(value => Number.isFinite(value) && Date.now() < value)) {
    throw fail(t('页面提交停止尚未确认；等待当前提交许可到期后再继续。'));
  }
}
async function start(configInput, version, tabId) {
  const config = validatedConfig(configInput || await getConfig());
  await transact(async () => {
    assertIntent(version);
    const old = await getJob();
    await assertSubmissionReleased(old);
    if (old?.enabled) await assertSubmissionReleased(await pauseLocked(old, t('正在绑定新的目标，原任务已替换。'), 'replaced'));
  });
  const tab = await currentTab(tabId);
  assertSupportedTab(tab);
  const result = await probe(tab, config);
  if (!['ready', 'busy', 'draft'].includes(result.status)) throw fail(result.message || t('页面暂时无法启用自动发送。'));
  if (new URL(tab.url).pathname.startsWith('/dots/') && !result.identity) throw fail(t('请先打开 dot 页面并等待会话历史加载，再绑定任务。'));
  const response = await transact(async () => {
    assertIntent(version);
    const latestTab = await chrome.tabs.get(tab.id);
    assertSupportedTab(latestTab, normalizeUrl(tab.url));
    const protection = await protectFromDiscard(latestTab, config.preventDiscard);
    const now = Date.now();
    const autoAllowedOnStart = result.diagnosticCode === 'auto-allowed-prompt';
    const job = { ...config, id: token(), runId: token(), enabled: true, tabId: latestTab.id, url: normalizeUrl(latestTab.url), title: latestTab.title || 'ChatGPT / dot', targetIdentity: result.identity, sentCount: 0, unknownCount: 0, queueIndex: 0, unknownRecoveryVersion: UNKNOWN_RECOVERY_VERSION, nextAt: now + (autoAllowedOnStart ? RETRY_MS : config.startImmediately ? 0 : config.intervalMinutes * 60_000), lastRunAt: null, runDeadline: null, phase: 'idle', awaitingReply: false, assistantToken: null, assistantCount: 0, needsAttention: false, statusText: autoAllowedOnStart ? t('检测到权限确认选项，已自动点击 Allow；一分钟后继续检查。') : config.startImmediately ? t('已开始，即将进行首次后台检查。') : t`持续运行中；约 ${config.intervalMinutes} 分钟后首次检查。`, ...protection };
    job.systemAwake = await syncPower(job);
    await chrome.storage.local.set({ config });
    await setJob(job);
    try { await syncAlarm(job); } catch { await pauseLocked(job, t('后台计时器不可用，未启动任务。'), 'scheduler-error'); throw fail(t('无法创建后台计时器。')); }
    await recordActivityEvent('started', t`开始任务，间隔 ${config.intervalMinutes} 分钟，${config.maxSends ? t`上限 ${config.maxSends} 次` : t('不限次数')}。`);
    if (autoAllowedOnStart) await recordActivityEvent('auto-allowed', t('检测到权限确认选项，已自动点击 Allow 并继续推进。'), { code: 'auto-allowed-prompt' });
    await updateBadge(job);
    return { ok: true, job };
  });
  if (config.startImmediately && result.diagnosticCode !== 'auto-allowed-prompt') return runRound(true, response.job.id);
  return response;
}
async function resume(version) {
  return transact(async () => {
    assertIntent(version);
    const current = await getJob();
    if (!current) throw fail(t('请先绑定 dot 或会话。'));
    if (revokedRuns.has(current.runId)) {
      await pauseLocked(current, t('发送准备未完成；已暂停，请检查后再继续。'));
      throw fail(t('发送准备未完成；已暂停，请检查后再继续。'));
    }
    await assertSubmissionReleased(current);
    try { validatedConfig(current); }
    catch (error) {
      if (current.enabled) await pauseLocked(current, error.safeMessage, 'blocked');
      throw error;
    }
    if (current.maxSends > 0 && current.sentCount + (current.manualSentCount || 0) >= current.maxSends) throw fail(t('已达到所设上限；请开始新任务。'));
    if (current.mode === 'queue-once' && current.queueIndex >= current.queue.length) throw fail(t('队列已完成；请开始新任务。'));
    if (current.enabled) {
      // Repair the heartbeat without invalidating an in-flight page operation.
      try { await syncAlarm(current); await setJob(current); }
      catch {
        await pauseLocked(current, t('后台计时器不可用，未启动任务。'), 'scheduler-error');
        throw fail(t('无法创建后台计时器。'));
      }
      return { ok: true, job: current };
    }
    let protection = {};
    try {
      const tab = await chrome.tabs.get(current.tabId);
      if (normalizeUrl(tab.url) === current.url) {
        protection = await protectFromDiscard(tab, current.preventDiscard);
        if (current.autoDiscardableChanged && protection.originalAutoDiscardable === false) {
          protection.originalAutoDiscardable = current.originalAutoDiscardable;
          protection.autoDiscardableChanged = true;
        }
      }
    } catch { /* Wait for original page. */ }
    const job = { ...current, ...protection, enabled: true, runId: token(), runDeadline: null, phase: 'idle', manualSubmissionPending: false, nextAt: Date.now() + current.intervalMinutes * 60_000, needsAttention: false, statusText: t`已继续原任务；约 ${current.intervalMinutes} 分钟后检查。` };
    job.systemAwake = await syncPower(job);
    try { await setJob(job); await syncAlarm(job); }
    catch {
      await pauseLocked(job, t('后台计时器不可用，未启动任务。'), 'scheduler-error');
      throw fail(t('无法创建后台计时器。'));
    }
    await recordActivityEvent('resumed', t('已使用原提示词与原设置继续任务。'));
    if (Number.isInteger(job.tabId)) pingOrAttachApprovalObserver(job.tabId);
    await updateBadge(job);
    return { ok: true, job };
  });
}
async function checkRun(runId, sender, renew = true) {
  return transact(async () => {
    const job = await getJob();
    const now = Date.now();
    const pending = [...pendingPageResults.values()].find(item => item.runId === runId);
    const allowed = Boolean(!revokedRuns.has(runId) && pendingRunAllowed(pending)
      && sender.id === chrome.runtime.id && job?.enabled && job.phase === 'sending' && job.runId === runId
      && (now < job.runDeadline || pending) && sender.tab?.id === job.tabId
      && sender.frameId === 0 && normalizeUrl(sender.url || sender.tab?.url) === job.url);
    if (!allowed) return { ok: true, allowed: false };
    if (pending?.documentId && sender.documentId !== pending.documentId) return { ok: true, allowed: false };
    if (pending && sender.documentId) pending.documentId ??= sender.documentId;
    deliveryCounter(pending, 'authorizationChecks');
    if ((renew || (pending && now >= job.runDeadline)) && job.runDeadline - now <= EXECUTION_MS / 2) {
      job.runDeadline = now + EXECUTION_MS;
      await setJob(job);
      if (pending) pending.leaseRenewals++;
      deliveryCounter(pending, 'leaseRenewals');
    }
    return { ok: true, allowed: pendingRunAllowed(pending), runDeadline: job.runDeadline };
  });
}
async function waitRun(message, sender) {
  if (![50, 60, 150, 180, 10_000].includes(message.delayMs)) return { ok: false, allowed: false };
  const before = await checkRun(message.runId, sender, message.renew !== false);
  if (!before.allowed) return before;
  // Never retain the state queue while sleeping: Pause and replacement win.
  await new Promise(resolve => {
    let waiters = runWaiters.get(message.runId);
    if (!waiters) { waiters = new Set(); runWaiters.set(message.runId, waiters); }
    let timer;
    const finish = () => {
      clearTimeout(timer); waiters.delete(finish);
      if (!waiters.size && runWaiters.get(message.runId) === waiters) runWaiters.delete(message.runId);
      resolve();
    };
    waiters.add(finish);
    timer = setTimeout(finish, message.delayMs);
  });
  return checkRun(message.runId, sender, message.renew !== false);
}
async function commitRun(message, sender) {
  if (typeof message.receiptBoundaryToken !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(message.receiptBoundaryToken)) {
    return { ok: false, dispatched: false, code: 'not-dispatched', reason: 'commit-unavailable' };
  }
  if (!(await checkRun(message.runId, sender)).allowed) return { ok: false, code: 'cancelled' };
  const permit = await transact(async () => {
    const job = await getJob();
    const pending = [...pendingPageResults.values()].find(item => item.runId === message.runId);
    if (!pendingRunAllowed(pending) || !job?.enabled || job.phase !== 'sending' || job.runKind === 'reply-check'
      || job.runId !== message.runId || Date.now() >= job.runDeadline
      || sender.tab?.id !== job.tabId || sender.frameId !== 0
      || normalizeUrl(sender.url || sender.tab?.url) !== job.url) return null;
    if (job.editorCommitRunId === job.runId) return { duplicate: true };
    const version = intentVersion;
    // Persist before crossing worlds. An uncertain invocation is never replayed.
    await setJob({ ...job, editorCommitRunId: job.runId });
    return { tabId: job.tabId, documentId: sender.documentId, version, args: {
      expectedUrl: job.url, targetIdentity: job.targetIdentity,
      prompt: currentPrompt(job), sendMethod: job.sendMethod ?? 'auto', deadline: job.runDeadline,
      persistentDelivery: true,
      receiptBoundaryToken: message.receiptBoundaryToken,
    } };
  });
  if (!permit) return { ok: false, code: 'cancelled' };
  if (permit.duplicate) return { ok: false, code: 'unknown' };
  if (permit.version !== intentVersion) return { ok: false, code: 'cancelled' };
  try {
    const allowed = async () => {
      const checked = await checkRun(message.runId, sender);
      if (checked.allowed) permit.args.deadline = checked.runDeadline;
      return checked.allowed && permit.version === intentVersion;
    };
    const pending = [...pendingPageResults.values()].find(item => item.runId === message.runId);
    let requireButton = false;
    let absentSendObserved = false;
    let grantRequest = null;
    let grantReadback = null;
    const grantAccepted = async pending => {
      const deadline = permit.args.deadline;
      if (!grantRequest || grantRequest.deadline !== deadline) {
        const request = { deadline, reply: null, settled: false };
        deliveryCounter(pending, 'grantRequests');
        grantRequest = request;
        try {
          request.promise = Promise.resolve(chrome.tabs.sendMessage(pending.tabId,
            { type: 'GRANT_RUN', runId: pending.runId, resultToken: pending.resultToken, runDeadline: deadline },
            pending.documentId ? { documentId: pending.documentId } : { frameId: 0 }))
            .then(reply => { request.reply = reply; }, () => undefined)
            .finally(() => { request.settled = true; });
        } catch { request.promise = Promise.resolve(); request.settled = true; }
      }
      const matchesReply = () => grantRequest?.deadline === deadline && grantRequest.reply?.granted === true
        && grantRequest.reply.runId === pending.runId && grantRequest.reply.resultToken === pending.resultToken
        && grantRequest.reply.runDeadline === deadline && Date.now() < deadline;
      if (matchesReply()) return true;
      // Retire an individual stalled observation, not the live send. A lost
      // read-only reply must not pin all future observations to that promise.
      if (grantReadback && (grantReadback.deadline !== deadline
        || Date.now() - grantReadback.startedAt >= 2000)) {
        deliveryCounter(pending, 'retiredReadbacks'); grantReadback = null;
      }
      if (!grantReadback) {
        const readback = { deadline, startedAt: Date.now(), value: null, settled: false };
        deliveryCounter(pending, 'grantReadbacks');
        grantReadback = readback;
        const target = { tabId: pending.tabId,
          ...(pending.documentId ? { documentIds: [pending.documentId] } : {}) };
        readback.promise = Promise.resolve().then(() => chrome.scripting.executeScript({ target, world: 'ISOLATED', func: pageInvocationState,
          args: [{ runId: pending.runId, resultToken: pending.resultToken }] }))
          .then(frames => { if (grantReadback === readback) readback.value = frames?.find(frame => frame.frameId === 0); }, () => undefined)
          .finally(() => { readback.settled = true; });
      }
      // Message delivery and its acknowledgement are independent. Read only
      // this exact isolated invocation; never infer permission from page DOM.
      let timer;
      try {
        await Promise.race([grantRequest.promise, grantReadback.promise,
          new Promise(resolve => { timer = setTimeout(resolve, 150); })]);
      } finally { clearTimeout(timer); }
      const readback = grantReadback;
      if (readback.settled) grantReadback = null;
      const accepted = matchesReply() || (readback.value?.result?.state === 'running'
        && (!pending.documentId || readback.value.documentId === pending.documentId)
        && readback.value.result.grantedDeadline === deadline && Date.now() < deadline);
      if (!accepted && grantRequest.settled) grantRequest = null;
      deliveryProgress(pending, { reason: accepted ? 'grant-accepted' : 'grant-pending' });
      return accepted;
    };
    const invoke = async phase => {
      if (!pendingRunAllowed(pending)) return { supported: true, dispatched: false, code: 'cancelled' };
      if (pending) pending.ownsModelStages = true;
      if (pending) pending.stage = phase === 'observe' ? 'readiness' : phase === 'commit' ? 'authorization' : 'prepare';
      deliveryProgress(pending, { reason: phase === 'commit' ? 'grant-pending' : phase === 'observe' ? 'waiting-send' : 'starting' });
      const target = { tabId: permit.tabId, ...(permit.documentId ? { documentIds: [permit.documentId] } : {}) };
      while (await allowed()) {
        if (pending?.manualSubmission) return { supported: true, dispatched: false, code: 'manual-submission', manualSubmission: true };
        if (phase === 'commit' && pending) {
          if (!await grantAccepted(pending)) { await new Promise(resolve => setTimeout(resolve, 150)); continue; }
          if (!await allowed()) return { supported: true, dispatched: false, code: 'cancelled' };
        }
        if (pending?.manualSubmission) return { supported: true, dispatched: false, code: 'manual-submission', manualSubmission: true };
        if (!pendingRunAllowed(pending)) return { supported: true, dispatched: false, code: 'cancelled' };
        if (phase === 'commit' && pending) {
          pending.stage = 'dispatch';
          pending.mainCommitPending = true;
          pending.mainCommitAdmitted = true;
          if (pending.delivery) {
            pending.delivery.mainCommitAdmitted = true;
            pending.delivery.commitDocumentId ??= permit.documentId;
            pending.delivery.mainCommitNoDispatch = false;
          }
          if (pending.delivery?.retired.length) pending.delivery.successorDispatchPossible = true;
        }
        let value;
        try {
          const frames = await chrome.scripting.executeScript({ target,
            world: 'MAIN', func: editorCommit, args: [{ ...permit.args, phase, requireButton }] });
          value = frames?.find(frame => frame.frameId === 0)?.result;
          if (pending?.delivery && phase === 'commit') pending.delivery.mainCommitNoDispatch = value?.dispatched === false;
          if (pending && phase === 'commit') pending.mainCommitPending = false;
          if (pending && phase === 'commit' && value?.dispatched === true) pending.dispatched = true;
          if (pending && phase === 'commit' && value?.dispatched !== false && value?.dispatched !== true) pending.commitUncertain = true;
          if (value?.diagnosticProgress) pageProgress(pending, value.diagnosticProgress, 'main');
          deliveryProgress(pending, { reason: value?.code ?? 'result-missing',
            observations: { ...(typeof value?.hasSend === 'boolean' ? { sendPresent: value.hasSend } : {}),
              sendEnabled: value?.code === 'ready' } });
        } catch (error) {
          deliveryCounter(pending, 'transportErrors');
          deliveryProgress(pending, { reason: 'transport-rejected' });
          // Prepare/observe cannot submit. Losing their transport may retry the
          // same reservation; an uncertain commit must never be replayed.
          if (phase === 'commit') { if (pending) { pending.mainCommitPending = false; pending.commitUncertain = true; } throw error; }
          await new Promise(resolve => setTimeout(resolve, 150));
          continue;
        }
        if (value == null && phase !== 'commit') {
          await new Promise(resolve => setTimeout(resolve, 150));
          continue;
        }
        if (!(value?.dispatched === false && value.code === 'expired')) return value;
        // The finite IPC permit expired before execution, with explicit proof
        // that no submission occurred. Keep the same reservation and wait.
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      return { supported: true, dispatched: false, code: 'cancelled' };
    };
    const notDispatched = value => value?.manualSubmission === true || value?.code === 'manual-submission'
      ? { ok: true, supported: true, dispatched: false, manualSubmission: true }
      : ({ ok: false, dispatched: false, code: 'not-dispatched',
      reason: ['waiting-send', 'send-unavailable', 'send-ambiguous', 'attachments', 'busy', 'composer-unstable'].includes(value?.code)
        ? value.code : 'commit-unavailable' });
    if (!await allowed()) return { ok: false, code: 'cancelled' };
    const prepareStable = async () => {
      let value = await invoke('prepare');
      while (value?.supported === true && value.dispatched === false && value.code === 'composer-unstable' && await allowed()) {
        await new Promise(resolve => setTimeout(resolve, 300));
        value = await invoke('prepare');
      }
      return value;
    };
    const prepared = await prepareStable();
    if (!await allowed()) return { ok: false, code: 'cancelled' };
    if (prepared?.manualSubmission) return notDispatched(prepared);
    // Only an explicit, non-mutating unsupported view permits the legacy path.
    if (prepared?.supported === false && prepared.dispatched === false && prepared.code === 'unsupported-view') {
      if (!pendingRunAllowed(pending)) return { ok: false, code: 'cancelled' };
      if (pending) {
        pending.stage = 'dispatch';
        pending.ownsModelStages = false;
        if (pending.delivery?.retired.length) pending.delivery.successorDispatchPossible = true;
      }
      return { ok: true, supported: false, dispatched: false };
    }
    if (prepared?.dispatched !== false) return { ok: false, code: 'unknown' };
    if (!prepared.supported || prepared.code !== 'prepared') return notDispatched(prepared);
    requireButton = prepared.hasSend === true;
    // The extension worker, not a throttled hidden-page timer, owns settling.
    // Waiting is read-only; the durable reservation still permits only one send.
    while (await allowed()) {
      const observation = await invoke('observe');
      if (!await allowed()) return { ok: false, code: 'cancelled' };
      if (observation?.manualSubmission) return notDispatched(observation);
      if (observation?.dispatched !== false) return { ok: false, code: 'unknown' };
      requireButton ||= observation.hasSend === true;
      if (observation.supported && observation.code === 'ready') {
        // Give an initially absent Auto control one worker-owned render turn.
        // Once seen, its temporary removal must never enable keyboard fallback.
        if (permit.args.sendMethod === 'auto' && observation.hasSend === false
          && !requireButton && !absentSendObserved) {
          absentSendObserved = true;
          await new Promise(resolve => setTimeout(resolve, 150));
          continue;
        }
        const value = await invoke('commit');
        if (value?.manualSubmission) return notDispatched(value);
        if (value?.supported === true && value.dispatched === true) {
          const pending = [...pendingPageResults.values()].find(item => item.runId === message.runId);
          if (pending) pending.stage = 'receipt';
          deliveryProgress(pending, { reason: 'awaiting-receipt' });
          return { ok: true, supported: true, dispatched: true };
        }
        if (value?.dispatched !== false) return { ok: false, code: 'unknown' };
        if (value.code === 'composer-unstable') {
          await new Promise(resolve => setTimeout(resolve, 300));
          const recovered = await prepareStable();
          if (!await allowed()) return { ok: false, code: 'cancelled' };
          if (recovered?.manualSubmission) return notDispatched(recovered);
          if (recovered?.dispatched !== false) return { ok: false, code: 'unknown' };
          if (!recovered.supported || recovered.code !== 'prepared') return notDispatched(recovered);
          requireButton ||= recovered.hasSend === true;
          continue;
        }
        // A final model correction may itself schedule a new framework render.
        // Only a proven no-dispatch wait may continue inside this reservation.
        if (value.code !== 'waiting-send') return notDispatched(value);
        requireButton = true;
      } else if (!observation.supported || observation.code !== 'waiting-send') {
        return notDispatched(observation);
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    return { ok: false, dispatched: false, code: 'not-dispatched', reason: 'waiting-send' };
  } catch { return { ok: false, code: 'unknown' }; }
}
async function runStillCurrent(snapshot) {
  return transact(async () => { const job = await getJob(); return Boolean(!revokedRuns.has(snapshot.runId) && job?.enabled && job.phase === 'sending' && job.id === snapshot.id && job.runId === snapshot.runId); });
}
async function resolveTarget(snapshot) {
  let tab;
  try { tab = await chrome.tabs.get(snapshot.tabId); } catch { /* Re-resolve by exact URL below. */ }
  const isDot = snapshot.url.includes('/dots/');
  if (!tab || normalizeUrl(tab.url) !== snapshot.url) {
    const allTabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    let matches = allTabs.filter(item => normalizeUrl(item.url) === snapshot.url);
    if (matches.length !== 1) return { status: 'busy', message: matches.length ? t('找到多个相同目标页，等待只保留一个或重新绑定。') : t('等待原目标页面重新打开；任务仍保持启用。') };
    tab = matches[0];
  }
  const nextUrl = normalizeUrl(tab.url);
  if (snapshot.tabId !== tab.id || (isDot && snapshot.url !== nextUrl)) {
    const changed = await transact(async () => {
      const current = await getJob();
      if (!current?.enabled || current.runId !== snapshot.runId) return false;
      await restoreDiscard(current);
      const protection = await protectFromDiscard(tab, current.preventDiscard);
      Object.assign(snapshot, protection, { tabId: tab.id, url: nextUrl });
      await setJob({ ...current, ...protection, tabId: tab.id, url: nextUrl });
      return true;
    });
    if (!changed) return { status: 'cancelled', message: t('本次检查已取消。') };
  }
  return { tab };
}
async function finishRound(snapshot, result, delivery = null) {
  return transact(() => finishRoundLocked(snapshot, result, delivery));
}
async function finishRoundLocked(snapshot, result, delivery = null) {
    const current = await getJob();
    if (!current || current.id !== snapshot.id || current.runId !== snapshot.runId || !current.enabled || current.phase !== 'sending') return { ok: true, job: current };
    const confirmed = ['sent', 'manual-sent'].includes(result.status);
    // Validated old-document evidence can arrive while receipt persistence
    // yields. Reconcile from the pre-count snapshot, never from provisional idle counts.
    const ambiguous = () => confirmed && delivery?.ambiguousRecovery === true;
    const pauseAmbiguous = async () => ({ ok: true, job: await pauseLocked(current,
      t('提交结果未确认；已暂停，请检查会话后再继续。'), 'unconfirmed', { code: 'document-replaced' }) });
    if (ambiguous()) return pauseAmbiguous();
    const now = Date.now();
    const manualUnconfirmed = (current.manualSubmissionPending || result.manualSubmission) && result.status !== 'manual-sent';
    const job = { ...current, phase: 'idle', runKind: null, runDeadline: null, needsAttention: false };
    if (result.identity && !job.targetIdentity) job.targetIdentity = result.identity;
    if (manualUnconfirmed) {
      job.unknownCount = (job.unknownCount || 0) + 1;
      job.manualSubmissionPending = false;
      job.lastResult = 'unknown';
      job.lastDiagnosticCode = result.diagnosticCode ?? null;
      const diagnostic = result.diagnosticCode
        ? { code: result.diagnosticCode, durationMs: now - snapshot.lastRunAt, ...result.executionDiagnostic }
        : null;
      return { ok: true, job: await pauseLocked(job, t('手动提交结果未确认；已暂停，请检查会话后再继续。'), 'unconfirmed', diagnostic) };
    }
    job.manualSubmissionPending = false;
    if (result.status === 'blocked' && ['composer-slow-write', 'chunk-unconfirmed', 'chunk-attachment', 'chunk-mismatch'].includes(result.diagnosticCode)) {
      job.lastResult = result.status;
      job.lastDiagnosticCode = result.diagnosticCode;
      const message = result.diagnosticCode === 'chunk-unconfirmed' ? t('分段文字写入未被页面接受；已暂停且未点击发送，请检查输入框。')
        : result.diagnosticCode === 'chunk-attachment' ? t('分段输入时页面出现附件；已暂停并保留附件，未点击发送。')
        : result.diagnosticCode === 'chunk-mismatch' ? t('分段文字与原文不一致；已暂停且未点击发送，请检查输入框。')
        : t('输入框写入耗时过长；已暂停，请检查页面后再继续。');
      return { ok: true, job: await pauseLocked(job, message, 'blocked',
        { code: result.diagnosticCode, durationMs: now - snapshot.lastRunAt, ...result.executionDiagnostic }) };
    }
    if (result.status === 'unknown' && ['paste-unconfirmed', 'paste-attachment-unconfirmed', 'receipt-ambiguous', 'receipt-mismatch', 'composer-slow-write'].includes(result.diagnosticCode)) {
      job.unknownCount = (job.unknownCount || 0) + 1;
      job.lastResult = result.status;
      job.lastDiagnosticCode = result.diagnosticCode;
      const message = result.diagnosticCode === 'paste-unconfirmed'
        ? t('粘贴结果未确认；已暂停，请检查输入框和会话后再继续。')
        : result.diagnosticCode === 'paste-attachment-unconfirmed' ? t('粘贴后页面出现附件；内容尚未确认，已暂停并保留附件，请检查会话。')
        : result.diagnosticCode === 'receipt-ambiguous' ? t('消息回执与提示词存在无法确认的空格差异；已暂停，请检查会话。')
        : result.diagnosticCode === 'receipt-mismatch' ? t('新消息与配置的提示词不同；已暂停，请检查会话后再继续。')
        : t('写入耗时过长且提交结果未确认；已暂停，请检查会话后再继续。');
      return { ok: true, job: await pauseLocked(job, message, 'unconfirmed',
        { code: result.diagnosticCode, durationMs: now - snapshot.lastRunAt, ...result.executionDiagnostic }) };
    }
    if (['sent', 'manual-sent'].includes(result.status)) {
      if (result.status === 'sent') job.sentCount += 1;
      else job.manualSentCount = (job.manualSentCount || 0) + 1;
      job.promptDelivery = null;
      if (job.mode !== 'repeat') job.queueIndex += 1;
      if (job.maxSends > 0 && job.sentCount + (job.manualSentCount || 0) >= job.maxSends) {
        const paused = await pauseLocked(job, t`已确认发送 ${job.sentCount + (job.manualSentCount || 0)} 次，达到你设置的上限。`, 'limit-reached');
        return ambiguous() ? pauseAmbiguous() : { ok: true, job: paused };
      }
      if (job.mode === 'queue-once' && job.queueIndex >= job.queue.length) {
        const paused = await pauseLocked(job, t('队列已全部发送，按单次队列设置结束。'), 'queue-complete');
        return ambiguous() ? pauseAmbiguous() : { ok: true, job: paused };
      }
      if (job.mode === 'queue-loop') job.queueIndex %= job.queue.length;
      job.awaitingReply = job.scheduleMode === 'after-reply';
      job.assistantToken = result.assistantToken;
      job.assistantCount = result.assistantCount;
      job.nextAt = now + (job.awaitingReply ? RETRY_MS : job.intervalMinutes * 60_000);
      job.statusText = result.status === 'manual-sent' ? t('已确认手动提交本轮提示词；停止重复填写，按原间隔继续。')
        : job.awaitingReply ? t('已确认发送，等待 Agent 回复完成后开始下一间隔。') : t`已确认发送 ${job.sentCount} 次；约 ${job.intervalMinutes} 分钟后继续。`;
      await recordActivityEvent(result.status, result.status === 'manual-sent' ? t('已确认手动提交本轮提示词；停止重复填写，按原间隔继续。') : t('已在目标会话确认新消息。'),
        { sentCount: result.status === 'sent' ? job.sentCount : job.manualSentCount, durationMs: now - snapshot.lastRunAt, ...result.executionDiagnostic });
    } else if (result.status === 'reply-complete') {
      job.awaitingReply = false;
      job.nextAt = now + job.intervalMinutes * 60_000;
      job.statusText = t`检测到新的回复已结束；约 ${job.intervalMinutes} 分钟后发送下一条。`;
      await recordActivityEvent('reply-complete', t('新的回复已结束，开始下一发送间隔。'));
    } else if (result.status === 'busy' && result.diagnosticCode === 'auto-allowed-prompt') {
      job.nextAt = now + RETRY_MS;
      job.needsAttention = false;
      job.statusText = t('检测到权限确认选项，已自动点击 Allow；一分钟后继续检查。');
      await recordActivityEvent('auto-allowed', t('检测到权限确认选项，已自动点击 Allow 并继续推进。'),
        { code: 'auto-allowed-prompt', durationMs: now - snapshot.lastRunAt, ...result.executionDiagnostic });
    } else if (['busy', 'draft', 'blocked', 'error'].includes(result.status)) {
      job.nextAt = now + (result.diagnosticCode === 'composer-unstable' ? job.intervalMinutes * 60_000 : RETRY_MS);
      job.needsAttention = ['blocked', 'error'].includes(result.status);
      job.statusText = (result.message || t('页面暂不可用。')) + (result.diagnosticCode === 'composer-unstable'
        ? t(' 按原间隔再次检查，任务仍保持启用。') : t(' 一分钟后再检查，任务仍保持启用。'));
      if (current.lastResult !== result.status || (current.lastDiagnosticCode ?? null) !== (result.diagnosticCode ?? null)) {
        await recordActivityEvent(result.status, result.status === 'draft' ? t('保留附件，等待附件移除后再检查。') : result.status === 'busy' ? t('目标暂忙或未就绪，延后检查。') : t('页面暂不可用，保持启用并等待恢复。'),
          result.diagnosticCode ? { code: result.diagnosticCode, durationMs: now - snapshot.lastRunAt, ...result.executionDiagnostic } : null);
      }
    } else if (result.status === 'done') {
      return { ok: true, job: await pauseLocked(job, t('检测到你设置的停止标记，按设置暂停。'), 'marker-reached') };
    } else {
      job.unknownCount = (job.unknownCount || 0) + 1;
      job.awaitingReply = false;
      job.lastResult = 'unknown';
      job.lastDiagnosticCode = result.diagnosticCode ?? null;
      return { ok: true, job: await pauseLocked(job, t('提交结果未确认；已暂停，请检查会话后再继续。'), 'unconfirmed',
        { code: result.diagnosticCode || 'adapter-result', durationMs: now - snapshot.lastRunAt, ...result.executionDiagnostic }) };
    }
    job.lastResult = result.status;
    job.lastDiagnosticCode = result.diagnosticCode ?? null;
    if (ambiguous()) return pauseAmbiguous();
    await setJob(job);
    if (ambiguous()) return pauseAmbiguous();
    await syncAlarm(job);
    if (ambiguous()) return pauseAmbiguous();
    await updateBadge(job);
    if (ambiguous()) return pauseAmbiguous();
    return { ok: true, job };
}
async function runRound(force = false, expectedJobId = null, expectedIntentVersion = null) {
  const claim = await transact(async () => {
    const job = await getJob();
    if (pendingStopIntents > 0 || failedStopVersion === intentVersion || expectedIntentVersion !== null && expectedIntentVersion !== intentVersion) return { job, claimed: false };
    if (revokedRuns.has(job?.runId)) throw fail(t('页面提交停止尚未确认；等待当前提交许可到期后再继续。'));
    if (expectedJobId && job?.id !== expectedJobId) return { job, claimed: false };
    if (!job?.enabled) { await syncAlarm(job); if (force) throw fail(t('请先开始或继续任务。')); return { job, claimed: false }; }
    if (job.phase !== 'idle') { if (force) throw fail(t('本次检查尚未结束。')); return { job, claimed: false }; }
    if (!force && Date.now() < job.nextAt) { if (Number.isInteger(job.tabId)) pingOrAttachApprovalObserver(job.tabId); return { job, claimed: false }; }
    if (inQuietHours(job)) {
      const waiting = { ...job, nextAt: Date.now() + RETRY_MS, statusText: t('处于你设置的静默时段；任务保持启用，时段结束后继续。') };
      await setJob(waiting); await updateBadge(waiting); return { job: waiting, claimed: false };
    }
    if (job.maxSends > 0 && job.sentCount + (job.manualSentCount || 0) >= job.maxSends) return { job: await pauseLocked(job, t('已达到你设置的发送上限。'), 'limit-reached'), claimed: false };
    const runKind = job.awaitingReply && !force ? 'reply-check' : 'send';
    if (runKind === 'send') {
      const text = currentPrompt(job);
      if (typeof text === 'string' && (text.includes('\u0000') || !text.isWellFormed())) {
        return { job: await pauseLocked(job, t('提示词含 NUL 或无效 Unicode 代理项，浏览器无法原样发送；原内容已保留，请先修正。'), 'blocked'), claimed: false };
      }
    }
    const prior = job.promptDelivery;
    const ordinal = job.sentCount + (job.manualSentCount || 0) + 1;
    const promptDelivery = runKind === 'send'
      ? prior == null ? { ordinal, issuedAt: Date.now() } : prior
      : prior ?? null;
    if (runKind === 'send' && (!Number.isSafeInteger(ordinal) || ordinal < 1
        || !Number.isSafeInteger(promptDelivery?.ordinal) || promptDelivery.ordinal !== ordinal
        || !Number.isSafeInteger(promptDelivery?.issuedAt) || promptDelivery.issuedAt < 0)) throw fail(t('操作未完成，请重试。'));
    const version = intentVersion;
    const snapshot = { ...job, promptDelivery, phase: 'sending', runKind, runId: token(), runDeadline: Date.now() + EXECUTION_MS, lastRunAt: Date.now(), statusText: t('正在后台检查目标页面…') };
    try { await setJob(snapshot); }
    catch (error) { revokedRuns.add(snapshot.runId); throw error; }
    await updateBadge(snapshot); return { job: snapshot, claimed: true, version };
  });
  if (!claim.claimed) return { ok: true, job: claim.job };
  let snapshot = claim.job;
  const delivery = { version: claim.version, runId: snapshot.runId, retired: [] };
  const traceEpoch = diagnosticEpoch;
  const trace = snapshot.runKind === 'send' ? await newDeliveryTrace() : null;
  let result;
  for (;;) {
  try {
    const resolved = await resolveTarget(snapshot);
    if (!resolved.tab) result = resolved;
    else if (!await runStillCurrent(snapshot) || !deliveryIntentCurrent(delivery) || hasDeliveryEvidence(delivery)) result = { status: 'cancelled' };
    else if (resolved.tab.frozen || resolved.tab.discarded) {
      try {
        await chrome.tabs.reload(resolved.tab.id);
        result = { status: 'busy', message: t('目标标签已休眠，正在自动唤醒刷新，一分钟后再检查。') };
      } catch {
        result = { status: 'busy', message: t('目标标签已冻结或休眠，请设置网站始终保持活动。') };
      }
    }
    else if (snapshot.awaitingReply && !force) {
      result = await probe(resolved.tab, { ...snapshot, waitForIdle: true }, snapshot.targetIdentity);
      if (['unknown', 'cancelled'].includes(result.status)) result = { status: 'error', message: t('回复检查暂不可用，继续等待新回复。') };
      const changed = result.assistantToken ? result.assistantToken !== snapshot.assistantToken : result.assistantCount > snapshot.assistantCount;
      if (result.status === 'ready') result = changed ? { status: 'reply-complete' } : { status: 'busy', message: t('等待新的 Agent 回复完成。') };
    } else {
      result = await executePage({ mode: 'send', expectedUrl: snapshot.url, prompt: currentPrompt(snapshot), promptDelivery: snapshot.promptDelivery, runId: snapshot.runId, runDeadline: snapshot.runDeadline, stopMarkers: snapshot.stopMarkers ?? [], waitForIdle: snapshot.waitForIdle ?? false, extensionPriority: true, extensionClock: true, modelCommit: true, unlimitedReadiness: true, persistentDelivery: true, sendMethod: snapshot.sendMethod ?? 'auto', targetIdentity: snapshot.targetIdentity }, snapshot.tabId, snapshot.runDeadline, trace, traceEpoch, delivery);
    }
  } catch { result = snapshot.runKind === 'reply-check' ? { status: 'error', message: t('回复检查暂不可用，继续等待新回复。') } : { status: 'unknown', message: t('后台页面操作未确认。'), diagnosticCode: 'execution-exception' }; }
  if (snapshot.runKind !== 'send' || result?.retryable !== true || !await runStillCurrent(snapshot)) break;
  // Explicit no-dispatch may recover a same-document attachment. Authority
  // remains pinned even if the page is replaced after this readback.
  if (delivery.mainCommitAdmitted) {
    let sameDocument = false;
    if (delivery.mainCommitNoDispatch && typeof delivery.commitDocumentId === 'string') {
      try {
        const frames = await chrome.scripting.executeScript({ target: { tabId: snapshot.tabId },
          world: 'ISOLATED', func: pageInvocationState, args: [{ runId: snapshot.runId }] });
        sameDocument = frames?.find(frame => frame.frameId === 0)?.documentId === delivery.commitDocumentId;
      } catch { }
    }
    if (!sameDocument) {
      result = { status: 'unknown', diagnosticCode: 'commit-not-dispatched' };
      break;
    }
  }
  // Only an explicit pre-submission result can start a fresh admission. Retire
  // the old run/commit reservation; uncertain or attempted sends never enter here.
  await new Promise(resolve => setTimeout(resolve, 1000));
  const renewed = await transact(async () => {
    const current = await getJob();
    if (!deliveryIntentCurrent(delivery) || hasDeliveryEvidence(delivery) || !current?.enabled || current.phase !== 'sending'
      || current.manualSubmissionPending || current.id !== snapshot.id || current.runId !== snapshot.runId
      || current.url !== snapshot.url || current.tabId !== snapshot.tabId) return null;
    const next = { ...current, runId: token(), editorCommitRunId: null, runDeadline: Date.now() + EXECUTION_MS,
      statusText: t('仍在等待目标页面或发送回执；无固定等待时限，可随时暂停。') };
    // Receipt/manual handlers record evidence before entering this queue. Link
    // their accounting to the successor before storage can yield to them.
    delivery.runId = next.runId;
    try { await setJob(next); await updateBadge(next); }
    catch {
      revokedRuns.add(next.runId);
      revokedRuns.add(current.runId);
      const observed = await getJob().catch(() => null);
      const written = observed?.runId === next.runId ? next : current;
      delivery.runId = written.runId;
      return { job: written, admitted: false };
    }
    return { job: next, admitted: deliveryIntentCurrent(delivery) && !hasDeliveryEvidence(delivery) };
  });
  if (renewed) snapshot = renewed.job;
  if (!renewed?.admitted) {
    result = { status: 'unknown', diagnosticCode: 'commit-not-dispatched',
      manualSubmission: delivery.retired.some(item => item.manualSubmission) };
    break;
  }
  }
  if (trace) void persistDeliveryTrace(updateDeliveryTrace(trace, {
    state: ['sent', 'manual-sent', 'cancelled', 'unknown', 'blocked', 'error'].includes(result?.status) ? result.status : 'blocked',
    reason: result?.status === 'sent' ? 'receipt-confirmed' : result?.status === 'manual-sent' ? 'manual-receipt-confirmed'
      : result?.status === 'cancelled' ? 'cancelled'
      : result?.diagnosticCode === 'auto-allowed-prompt' ? 'auto-allowed-prompt'
      : result?.status === 'blocked' && ['composer-slow-write', 'chunk-unconfirmed', 'chunk-attachment', 'chunk-mismatch'].includes(result?.diagnosticCode) ? result.diagnosticCode
      : result?.status === 'unknown' && ['paste-unconfirmed', 'paste-attachment-unconfirmed', 'receipt-ambiguous', 'receipt-mismatch', 'composer-slow-write', 'document-replaced'].includes(result?.diagnosticCode) ? result.diagnosticCode : undefined,
  }, Date.now()), traceEpoch);
  try { return await finishRound(snapshot, result, delivery); }
  finally {
    for (const [key, pending] of pendingPageResults) {
      if (pending.runId === snapshot.runId || pending.delivery === delivery && pending.retiredForReplacement) {
        clearTimeout(pending.receiptRetryTimer);
        clearTimeout(pending.traceTimer);
        pendingPageResults.delete(key);
      }
    }
  }
}
async function initializePrivatePreset() {
  if (!BUNDLED_PROMPT) return;
  const imported = (await chrome.storage.local.get('privatePresetImported')).privatePresetImported;
  if (imported) return;
  try {
    const response = await fetch(chrome.runtime.getURL('private/prompt.txt'));
    if (!response.ok) return;
    const bytes = await response.arrayBuffer();
    let text;
    const view = new Uint8Array(bytes);
    if (view[0] === 0xff && view[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes);
    else if (view[0] === 0xfe && view[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes);
    else { try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = new TextDecoder('gb18030', { fatal: true }).decode(bytes); } }
    if (!text.trim()) return;
    // No telemetry, hashing, console output, preview or automatic submission.
    await chrome.storage.local.set({ config: { ...DEFAULT_CONFIG, prompt: text, promptSource: 'private-file' }, privatePresetImported: true });
  } catch { /* User can still import through the local file picker. */ }
}
async function initialize() {
  await initializeLanguage();
  try { await chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }); } catch { /* Old browser. */ }
  try { draftClearFailed = (await chrome.storage.local.get(DRAFT_CLEAR_MARKER))[DRAFT_CLEAR_MARKER] === true; }
  catch { draftClearFailed = true; }
  if (!draftClearFailed) await initializePrivatePreset();
  return transact(async () => {
    // Apply the requested interrupt default once to each legacy record. A
    // record-local version survives partial storage writes and never resets a
    // waiting preference explicitly selected in this or a later release.
    const retireDraftNotice = job => retiredDraftNotice(job?.statusText)
      ? { ...job, statusText: job.enabled ? t('任务仍在运行；下次发送使用配置的提示词。') : t('已手动暂停；后续定时发送已停止。') } : job;
    const saved = (await chrome.storage.local.get('resumeJob')).resumeJob;
    const recovery = retireDraftNotice(migrateDelivery(saved));
    const updates = {};
    if (recovery !== saved) updates.resumeJob = recovery;
    if (Object.keys(updates).length) await chrome.storage.local.set(updates);
    let job = retireDraftNotice(migrateDelivery(await getJob()));
    if (!job) {
      if (recovery) {
        // Rebind only to an exact URL; additionally require the dot conversation
        // identity captured from visible message elements, when available.
        job = { ...recovery, tabId: null, runId: token(), autoDiscardableChanged: false, discardProtection: 'pending' };
      }
    }
    if (job && job.unknownRecoveryVersion !== UNKNOWN_RECOVERY_VERSION) {
      const interruptedNotice = [
        '上周期执行被中断；完整间隔后继续，未立即重发。',
        'The previous cycle was interrupted; continuing after a full interval without an immediate resend.',
        '发送期间目标关闭，结果未确认；完整间隔后检查原页面。',
        'The target closed during sending; the result is unconfirmed. Checking the original page after a full interval.',
        '发送期间页面改变，结果未确认；完整间隔后检查原地址。',
        'The page changed during sending; the result is unconfirmed. Checking the original URL after a full interval.',
      ].includes(job.statusText);
      const unresolved = job.enabled === true && job.phase === 'idle'
        && (job.lastResult === 'unknown' || interruptedNotice || Number.isSafeInteger(job.unknownCount) && job.unknownCount > 0);
      job = { ...job, unknownRecoveryVersion: UNKNOWN_RECOVERY_VERSION,
        ...(unresolved ? { enabled: false, nextAt: null, needsAttention: true,
          statusText: t('提交结果未确认；已暂停，请检查会话后再继续。') } : {}) };
      if (unresolved) await recordActivityEvent('unconfirmed', t('提交结果未确认；已暂停，请检查会话后再继续。'));
    }
    if (job && !job.tabId && recovery) {
      if (job.enabled && (!job.nextAt || job.nextAt <= Date.now())) {
        job.nextAt = Date.now() + 3000;
        job.statusText = t('已从重启中恢复；正在连接目标页面并继续推进…');
      }
      await recordActivityEvent('browser-restored', t('已恢复任务设置；等待唯一匹配的原目标页面。'));
    }
    if (job?.phase === 'sending') {
      const readOnly = job.runKind === 'reply-check';
      const manualUnconfirmed = job.manualSubmissionPending === true;
      const deadline = job.runDeadline;
      const submissionFenceUntil = !readOnly && Number.isFinite(deadline) && deadline > Date.now()
        ? Math.max(Number.isFinite(job.submissionFenceUntil) ? job.submissionFenceUntil : 0, deadline) : job.submissionFenceUntil;
      job = { ...job, phase: 'idle', runKind: null, runId: token(), runDeadline: null, submissionFenceUntil, awaitingReply: readOnly ? job.awaitingReply : false, unknownCount: (job.unknownCount || 0) + (readOnly ? 0 : 1), nextAt: readOnly ? Date.now() + RETRY_MS : null, enabled: readOnly ? job.enabled : false, manualSubmissionPending: false, statusText: manualUnconfirmed ? t('手动提交结果未确认；已暂停，请检查会话后再继续。') : readOnly ? t('回复检查被中断；恢复后继续等待新回复。') : t('发送期间后台中断；已暂停，请检查会话后再继续。'), needsAttention: !readOnly };
      await recordActivityEvent('interrupted', readOnly ? t('只读回复检查被中断；仍等待新回复。') : t('发送期间后台中断；已暂停，请检查会话后再继续。'));
    }
    if (job) {
      const deadlines = [job.submissionFenceUntil, saved?.submissionFenceUntil,
        saved?.phase === 'sending' && saved.runKind !== 'reply-check' ? saved.runDeadline : null]
        .filter(value => Number.isFinite(value) && value > Date.now());
      if (deadlines.length) job = { ...job, submissionFenceUntil: Math.max(...deadlines) };
    }
    if (job) { job.systemAwake = await syncPower(job); await setJob(job); if (job.enabled && Number.isInteger(job.tabId)) pingOrAttachApprovalObserver(job.tabId); }
    else await syncPower(null);
    try { await syncAlarm(job); }
    catch {
      await pauseLocked(job, t('后台计时器不可用，未启动任务。'), 'scheduler-error');
      return;
    }
    await updateBadge(job);
  });
}
let initialized = initialize();
initialized.catch(() => { initialized = null; });
async function ensureInitialized() {
  if (!initialized) {
    const attempt = initialize();
    initialized = attempt;
    attempt.catch(() => { if (initialized === attempt) initialized = null; });
  }
  await initialized;
}
async function readDiagnosticsState() {
  let timer, local, session;
  const readLocal = Promise.resolve().then(() => chrome.storage.local.get(['logs', 'deliveryDiagnostics', 'diagnosticsHealth']))
    .then(value => { local = value; }, () => undefined);
  const readSession = Promise.resolve().then(() => chrome.storage.session.get('diagnosticsHealth'))
    .then(value => { session = value; }, () => undefined);
  try {
    await Promise.race([Promise.all([readLocal, readSession]), new Promise(resolve => { timer = setTimeout(resolve, 250); })]);
    const readIncomplete = !local || !session;
    const degraded = [session?.diagnosticsHealth, local?.diagnosticsHealth]
      .find(health => health?.persistence === 'degraded');
    return { ...(local ? { logs: local.logs || [], deliveryDiagnostics: local.deliveryDiagnostics || [] } : {}),
      diagnosticsHealth: degraded || (readIncomplete ? { persistence: 'unknown', writeFailures: 0 } :
        (session.diagnosticsHealth || local.diagnosticsHealth)),
      diagnosticsReadIncomplete: readIncomplete };
  } finally { clearTimeout(timer); }
}
async function readConfigState() {
  let timer;
  try {
    return await Promise.race([
      getConfig().then(config => ({ configAvailable: true, config }), () => ({ configAvailable: false })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ configAvailable: false }), 250); }),
    ]);
  } finally { clearTimeout(timer); }
}
let lastRealtimeApprovalProbeAt = 0;
function pingOrAttachApprovalObserver(tabId) {
  if (!Number.isInteger(tabId)) return;
  try {
    Promise.resolve(chrome.tabs.sendMessage(tabId, { type: 'SCAN_APPROVAL_PROMPT' })).catch(() => {
      if (chrome.runtime?.onInstalled) {
        chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
          .then(() => chrome.tabs.sendMessage(tabId, { type: 'SCAN_APPROVAL_PROMPT' }))
          .catch(() => undefined);
      }
    });
  } catch {}
}
async function handleAutoAllowClick(message, sender) {
  if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id)
      || typeof message?.token !== 'string' || !message.token || message.token.length > 120) {
    return { ok: false };
  }
  try {
    const frames = await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, ...(sender.documentId ? { documentIds: [sender.documentId] } : {}) },
      world: 'MAIN',
      func: mainWorldAutoAllowClick,
      args: [message.token],
    });
    return { ok: true, result: frames?.find(f => f.frameId === 0)?.result ?? frames?.[0]?.result ?? null };
  } catch {
    return { ok: false };
  }
}
async function handleApprovalPromptObserved(sender) {
  if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id)) return { ok: false };
  const now = Date.now();
  if (now - lastRealtimeApprovalProbeAt < 700) return { ok: true, throttled: true };
  const current = await transact(getJob);
  if (!current?.enabled || current.phase !== 'idle') return { ok: false };
  const senderUrl = normalizeUrl(sender.url || sender.tab?.url || '');
  if (current.tabId !== sender.tab.id && senderUrl !== current.url) return { ok: false };
  lastRealtimeApprovalProbeAt = now;
  try {
    const tab = await chrome.tabs.get(sender.tab.id);
    if (!tab || normalizeUrl(tab.url) !== current.url) return { ok: false };
    const result = await probe(tab, current, current.targetIdentity);
    if (result?.diagnosticCode === 'auto-allowed-prompt') {
      await transact(async () => {
        const latest = await getJob();
        if (!latest?.enabled || latest.id !== current.id) return;
        const updated = {
          ...latest,
          statusText: t('检测到权限确认选项，已自动点击 Allow；一分钟后继续检查。'),
          lastResult: 'busy',
          lastDiagnosticCode: 'auto-allowed-prompt',
        };
        await setJob(updated);
        await recordActivityEvent('auto-allowed', t('检测到权限确认选项，已自动点击 Allow 并继续推进。'), { code: 'auto-allowed-prompt' });
        await updateBadge(updated);
      });
      return { ok: true, autoAllowed: true };
    }
    return { ok: true, autoAllowed: false };
  } catch {
    return { ok: false };
  }
}
async function dispatch(message, sender, version) {
  if (SETUP_MESSAGES.includes(message?.type)) return setupInstallation?.handleMessage(message, sender) ?? null;
  if (message?.type === BROWSER_DEVICE_MESSAGE) return browserWake?.handleMessage(message, sender) ?? null;
  if (ADMIN_CONTROL_MESSAGES.includes(message?.type)) return administratorControls?.handleMessage(message, sender) ?? null;
  if (message?.type === ADMIN_BROWSER_MESSAGE || message?.type === ADMIN_BROWSER_PAUSE ||
      message?.type === ADMIN_BROWSER_PAUSE_STATUS || message?.type === ADMIN_BROWSER_PAUSE_RECONCILE) {
    return administratorBrowser?.handleMessage(message, sender) ?? null;
  }
  await ensureInitialized();
  if (!message || typeof message.type !== 'string') throw fail(t('无效请求。'));
  const ownExtensionPage = chrome.runtime.id && sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
  if (['PREPARE_START', 'START', 'PAUSE', 'RESUME', 'CLEAR_DATA', 'SAVE_DRAFT', 'SAVE_TEMPLATES'].includes(message.type) && !ownExtensionPage) throw fail(t('此操作只能从扩展控制面板发起。'));
  if (!['CHECK_RUN', 'WAIT_RUN', 'COMMIT_RUN', 'PAGE_RESULT', 'MANUAL_SUBMISSION', 'AUTO_ALLOW_CLICK', 'APPROVAL_PROMPT_OBSERVED'].includes(message.type) && sender.tab && !ownExtensionPage) throw fail(t('此操作只能从扩展控制面板发起。'));
  if (['PREPARE_START', 'START', 'RESUME'].includes(message.type) && (draftClearPending || draftClearFailed))
    throw fail(t('配置暂时无法读取；暂停仍可使用，重试前不会覆盖本地配置。'));
  switch (message.type) {
    case 'GET_STATE': {
      const clearInProgress = pendingDataClears > 0 || draftClearPending > 0 || draftClearFailed;
      const observedDraftGeneration = draftGeneration;
      const observedDraftRevision = draftRevision;
      const historyClearInProgress = pendingHistoryClears > 0;
      const observedConfigRevision = configRevision;
      const observedActivityEpoch = activityEpoch;
      const observedDiagnosticEpoch = diagnosticEpoch;
      const [diagnostics, config] = await Promise.all([readDiagnosticsState(), readConfigState()]);
      const verifiedConfig = config.configAvailable ? await readConfigState() : config;
      const state = await transact(async () => ({ job: await getJob(), availableTargets: await availableTargets(),
        configCurrent: !clearInProgress && pendingDataClears === 0 && draftClearPending === 0 && !draftClearFailed && version === intentVersion && observedConfigRevision === configRevision &&
          observedDraftGeneration === draftGeneration && observedDraftRevision === draftRevision &&
          verifiedConfig.configAvailable && JSON.stringify(config.config) === JSON.stringify(verifiedConfig.config),
        activityCurrent: !historyClearInProgress && pendingHistoryClears === 0 && observedActivityEpoch === activityEpoch,
        diagnosticsCurrent: !historyClearInProgress && pendingHistoryClears === 0 && observedDiagnosticEpoch === diagnosticEpoch }));
      if (!state.activityCurrent) delete diagnostics.logs;
      if (!state.diagnosticsCurrent) {
        delete diagnostics.deliveryDiagnostics;
        delete diagnostics.diagnosticsHealth;
        diagnostics.diagnosticsReadIncomplete = true;
      }
      return { ok: true, job: state.job, availableTargets: state.availableTargets,
        ...(state.configCurrent ? { ...config, draftGeneration: observedDraftGeneration, draftRevision: observedDraftRevision } : { configAvailable: false }), ...diagnostics };
    }
    case 'CHECK_PAGE': return checkPage(message.tabId);
    case 'CHECK_TIMING': return timingDiagnostics();
    case 'CHECK_RUN': return checkRun(message.runId, sender);
    case 'WAIT_RUN': return waitRun(message, sender);
    case 'COMMIT_RUN': return commitRun(message, sender);
    case 'PAGE_RESULT': return receivePageResult(message, sender);
    case 'MANUAL_SUBMISSION': return receiveManualSubmission(message, sender);
    case 'AUTO_ALLOW_CLICK': return handleAutoAllowClick(message, sender);
    case 'APPROVAL_PROMPT_OBSERVED': return handleApprovalPromptObserved(sender);
    case 'PREPARE_START':
      assertIntent(version);
      if (pendingStartReservation?.version !== version) throw fail(t('此操作已被较新的开始或暂停操作取消。'));
      return { ok: true, startToken: pendingStartReservation.token };
    case 'START': return start(message.config, version, message.tabId);
    case 'PAUSE': return pause();
    case 'RESUME': return resume(version);
    case 'SEND_NOW': return runRound(true);
    case 'SAVE_DRAFT': return saveDraft(message);
    case 'SAVE_TEMPLATES': return saveTemplates(message);
    case 'CLEAR_LOGS': {
      // Queue only the epoch cutover. Diagnostic I/O never holds Pause's queue.
      let clearing, activityClearing;
      let outcomes;
      await transact(async () => {
        clearing = clearDeliveryDiagnostics(); activityClearing = clearActivityLog();
        outcomes = Promise.allSettled([clearing, activityClearing]);
      });
      const results = await outcomes;
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
      return { ok: true };
    }
    case 'CLEAR_DATA': {
      let clearing, activityClearing, outcomes;
      let draftClearing;
      let stateError;
      let markerWritten = false;
      const clearedGeneration = draftGeneration;
      const paused = transact(async () => {
        const stopped = await pauseLocked(await getJob(), t('已停止任务并清除本地数据。'));
        if (Number.isFinite(stopped?.submissionFenceUntil) && stopped.submissionFenceUntil > Date.now()) {
          const storedFence = (await chrome.storage.local.get('submissionFenceUntil')).submissionFenceUntil;
          await chrome.storage.local.set({ submissionFenceUntil: Math.max(Number.isFinite(storedFence) ? storedFence : 0, stopped.submissionFenceUntil) });
        }
        await setJob(null);
        clearing = clearDeliveryDiagnostics();
        activityClearing = clearActivityLog();
        for (const key of ['uiTheme', ADMIN_BROWSER_RESTORE]) await chrome.storage.local.remove(key);
        if (BUNDLED_PROMPT) await chrome.storage.local.set({ privatePresetImported: true });
      });
      draftClearing = draftQueue.then(async () => {
        await paused;
        await chrome.storage.local.set({ [DRAFT_CLEAR_MARKER]: true });
        markerWritten = true;
        const history = Promise.allSettled([clearing, activityClearing]);
        await chrome.storage.local.remove('templates');
        await chrome.storage.local.remove('config');
        if ((await history).every(result => result.status === 'fulfilled'))
          await chrome.storage.local.remove(DRAFT_CLEAR_MARKER);
      });
      draftQueue = draftClearing.catch(() => undefined);
      try {
        await paused;
      } catch (error) { stateError = error; }
      if (clearing && activityClearing) {
        outcomes = Promise.allSettled([clearing, activityClearing, draftClearing]);
      }
      if (!outcomes) { draftClearFailed = true; throw stateError; }
      const results = await outcomes;
      if (results.some(result => result.status === 'rejected') || stateError || !markerWritten) draftClearFailed = true;
      else draftClearFailed = false;
      if (stateError) throw stateError;
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
      chrome.runtime.sendMessage({ type: 'DRAFT_DATA_CLEARED', generation: clearedGeneration }).catch(() => undefined);
      return { ok: true };
    }
    default: throw fail(t('不支持的操作。'));
  }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let version = intentVersion;
  const ownExtensionPage = chrome.runtime.id && sender.id === chrome.runtime.id
    && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
  if (message?.type === 'CLEAR_DATA' && ownExtensionPage) {
    draftGeneration = token();
    draftRevision = 0;
    draftClearPending++;
  }
  if (message?.type === 'PREPARE_START' && ownExtensionPage) {
    version = ++intentVersion;
    pendingActivationVersion = version;
    pendingStartReservation = { version, token: token() };
  } else if (message?.type === 'START' && Object.hasOwn(message, 'startToken')) {
    if (ownExtensionPage && pendingStartReservation?.token === message.startToken
        && pendingStartReservation.version === intentVersion) {
      version = pendingStartReservation.version;
      pendingStartReservation = null;
    } else version = -1;
  } else if (ownExtensionPage && ['START', 'PAUSE', 'RESUME', 'CLEAR_DATA'].includes(message?.type)) {
    version = ++intentVersion;
    pendingStartReservation = null;
    pendingActivationVersion = ['START', 'RESUME'].includes(message.type) ? version : null;
  }
  if (message?.type === 'CLEAR_DATA') pendingDataClears++;
  if (ownExtensionPage && ['PAUSE', 'CLEAR_DATA'].includes(message?.type)) pendingStopIntents++;
  if (['CLEAR_LOGS', 'CLEAR_DATA'].includes(message?.type)) pendingHistoryClears++;
  dispatch(message, sender, version).then(value => value, error => ({ ok: false, error: errorMessage(error) })).then(response => {
    if (message?.type === 'CLEAR_DATA') pendingDataClears--;
    if (ownExtensionPage && ['PAUSE', 'CLEAR_DATA'].includes(message?.type)) {
      pendingStopIntents--;
      if (!response?.ok && version === intentVersion) failedStopVersion = version;
    }
    if (message?.type === 'CLEAR_DATA' && ownExtensionPage) draftClearPending--;
    if (['CLEAR_LOGS', 'CLEAR_DATA'].includes(message?.type)) pendingHistoryClears--;
    if (pendingActivationVersion === version && ['START', 'RESUME'].includes(message?.type)) pendingActivationVersion = null;
    sendResponse(response);
  });
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== ALARM_NAME) return;
  const version = intentVersion;
  ensureInitialized().then(() => runRound(false, null, version)).catch(() => undefined);
});
chrome.tabs.onRemoved.addListener(tabId => {
  ensureInitialized().then(() => transact(async () => {
    const job = await getJob();
    if (job?.tabId !== tabId) return;
    const interrupted = job.phase === 'sending' && job.runKind !== 'reply-check';
    if (interrupted) {
      const paused = await pauseLocked(job, t('发送期间目标关闭，结果未确认；已暂停，请检查会话后再继续。'), 'unconfirmed', null, true);
      await setJob({ ...paused, tabId: null, runKind: null, autoDiscardableChanged: false, discardProtection: 'pending' });
      return;
    }
    const waiting = { ...job, tabId: null, runId: token(), runDeadline: null, phase: 'idle', runKind: null, nextAt: job.enabled ? Math.max(job.nextAt || 0, Date.now() + RETRY_MS) : null, autoDiscardableChanged: false, discardProtection: 'pending', statusText: t('目标标签已关闭；任务保持原启用状态，等待原页面重新打开。') };
    await setJob(waiting); await updateBadge(waiting);
  })).catch(() => undefined);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  ensureInitialized().then(() => transact(async () => {
    const job = await getJob();
    if (!job?.enabled || job.tabId !== tabId) return;
    let tab;
    try { tab = await chrome.tabs.get(tabId); } catch { return; }
    if (normalizeUrl(tab.url) === job.url) return;
    const isDot = job.url.includes('/dots/');
    if (isDot && tab.url && tab.url.includes('/dots/')) {
      const updatedUrl = normalizeUrl(tab.url);
      await setJob({ ...job, url: updatedUrl });
      return;
    }
    const interrupted = job.phase === 'sending' && job.runKind !== 'reply-check';
    if (interrupted) {
      const paused = await pauseLocked(job, t('发送期间页面改变，结果未确认；已暂停，请检查原会话后再继续。'), 'unconfirmed', null, true);
      await setJob({ ...paused, tabId: null, runKind: null, discardProtection: 'pending' });
      return;
    }
    await restoreDiscard(job);
    const waiting = { ...job, tabId: null, runId: token(), runDeadline: null, phase: 'idle', runKind: null, nextAt: Math.max(job.nextAt || 0, Date.now() + RETRY_MS), autoDiscardableChanged: false, discardProtection: 'pending', statusText: t('原目标页面已离开；等待原地址重新打开，不会给其他会话发送。') };
    await setJob(waiting); await updateBadge(waiting);
  })).catch(() => undefined);
});
chrome.runtime.onStartup?.addListener?.(() => {
  const version = intentVersion;
  ensureInitialized().then(async () => {
    const observed = await getJob();
    if (!observed?.enabled || version !== intentVersion) return;
    const running = await transact(async () => {
      const job = await getJob();
      if (!job?.enabled || version !== intentVersion) return false;
      try { await syncAlarm(job); }
      catch {
        if (version === intentVersion) await pauseLocked(job, t('后台计时器不可用，未启动任务。'), 'scheduler-error');
        return false;
      }
      await updateBadge(job);
      return version === intentVersion;
    });
    if (running && version === intentVersion) setTimeout(() => runRound(false, null, version).catch(() => undefined), 2500);
  }).catch(() => undefined);
});
chrome.commands.onCommand.addListener(command => {
  if (command !== 'toggle-running') return;
  const activationWasPending = pendingActivationVersion === intentVersion;
  const version = ++intentVersion;
  pendingActivationVersion = null;
  pendingStartReservation = null;
  pendingStopIntents++;
  (async () => {
    await ensureInitialized();
    const job = await transact(getJob);
    if (version !== intentVersion) return;
    if (activationWasPending || job?.enabled) await transact(async () => {
      if (version !== intentVersion) return;
      await pauseLocked(await getJob(), t('已手动暂停；后续定时发送已停止。'));
    });
    else if (job) { pendingActivationVersion = version; await resume(version); }
  })().catch(() => { if (version === intentVersion) failedStopVersion = version; }).finally(() => {
    pendingStopIntents--;
    if (pendingActivationVersion === version) pendingActivationVersion = null;
  });
});

chrome.runtime.onInstalled?.addListener?.(() => {
  ensureInitialized().then(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' }).catch(() => []);
    for (const tab of tabs) {
      if (!Number.isInteger(tab?.id) || tab.discarded || tab.frozen) continue;
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
        .then(() => chrome.tabs.sendMessage(tab.id, { type: 'SCAN_APPROVAL_PROMPT' }))
        .catch(() => undefined);
    }
  }).catch(() => undefined);
});

chrome.runtime.onConnect?.addListener?.(port => {
  if (port.name === 'agent-continue-keepalive') {
    port.onMessage.addListener(() => {});
  }
});
