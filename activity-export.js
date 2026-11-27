import { sanitizeDeliveryDiagnostics } from './delivery-diagnostics.js';

const EVENTS = new Set([
  'started', 'start', 'resumed', 'resume', 'paused', 'pause', 'sent', 'manual-sent', 'busy',
  'draft', 'unknown', 'blocked', 'error', 'restored', 'recovered', 'unconfirmed',
  'reply-complete', 'limit-reached', 'queue-complete', 'marker-reached',
  'target-closed', 'quiet', 'skipped', 'done', 'stopped', 'browser-restored',
  'interrupted', 'cancelled', 'ready', 'replaced', 'scheduler-error', 'timing-diagnostics', 'auto-allowed', 'takeover-replied', 'exception-detected',
]);
const DIAGNOSTICS = new Set([
  'adapter-result', 'execution-exception', 'execution-timeout', 'no-valid-result', 'existing-draft',
  'composer-changed', 'composer-unstable', 'composer-slow-write', 'chunk-unconfirmed', 'chunk-attachment',
  'chunk-mismatch', 'timing-probe', 'send-not-ready', 'commit-not-dispatched', 'paste-unconfirmed',
  'paste-attachment-unconfirmed', 'receipt-ambiguous', 'receipt-mismatch', 'document-replaced',
  'unconfirmed-retry', 'auto-allowed-prompt', 'approval-required', 'oauth-required', 'captcha-required',
  'takeover-needed', 'takeover-replied', 'pre-dispatch-storage', 'agent-paused', 'agent-busy', 'composer-unavailable',
  'manual-pause', 'command-pause', 'user-clear-data', 'limit-reached', 'queue-complete', 'marker-reached',
  'target-replaced', 'session-expired', 'activation-interrupted', 'pause-restored', 'alarm-unavailable',
  'pause-unconfirmed', 'target-closed', 'target-changed', 'task-started', 'task-resumed',
  'browser-session-restored', 'rebound-tab', 'worker-interrupted', 'reply-check-complete', 'unknown-modal', 'oauth-popup',
]);
const TARGET_KINDS = new Set(['dot', 'chatgpt']);
const RUN_KINDS = new Set(['send', 'takeover-reply', 'reply-check', 'approval-check', 'check']);
const TRIGGERS = new Set(['user', 'command', 'alarm', 'startup', 'rebind', 'observer', 'round', 'initialize', 'tab-removed', 'tab-updated', 'clear-data', 'manual-send']);
const SURFACES = new Set(['modal', 'inline-card', 'assistant-turn', 'page', 'composer']);
const OPTION_KINDS = new Set(['always-allow', 'allow-conversation', 'allow-once', 'allow', 'authorize', 'confirm', 'sign-in', 'close', 'give-control-back', 'return-control', 'done', 'other']);
const EVIDENCE_FLAGS = new Set(['role-dialog', 'role-alertdialog', 'aria-modal', 'html-dialog', 'sign-in-card', 'approval-card', 'oauth-text', 'auth-form', 'external-oauth-link', 'session-expired-title', 'captcha-widget', 'turnstile-iframe', 'recaptcha-iframe', 'hcaptcha-iframe', 'no-composer', 'composer-present', 'assistant-busy', 'agent-paused', 'dot-paused-badge', 'takeover-phrase', '2fa-text', 'allow-options', 'close-button', 'inline-oauth', 'popup-oauth', 'suppressed-modal']);
const BOUNDED_DIAG_COUNTS = ['sentCount', 'manualSentCount', 'unknownCount', 'consecutiveTakeoverReplies', 'suppressedCount', 'domWrites', 'textChunks'];
const BOUNDED_DIAG_FLAGS = ['enabled', 'autoAllow', 'autoAuthorizeTakeover', 'tabBound', 'composerPresent'];

const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validMs = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
function own(value, key) {
  if (value === null || typeof value !== 'object') return undefined;
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; }
  catch { return undefined; }
}

function sanitizeLogCollection(source) {
  const list = Array.isArray(source) ? source : [];
  const sourceCount = own(list, 'length') ?? 0;
  const output = [];
  for (let index = Math.max(0, sourceCount - 200); index < sourceCount; index++) {
    const item = own(list, index);
    if (!record(item)) continue;
    const at = own(item, 'at');
    const event = own(item, 'event');
    if (!validTime(at) || !EVENTS.has(event)) continue;
    // Free-form messages and unknown fields are deliberately not copied.
    const entry = { at, event };
    const detail = own(item, 'diagnostic');
    const code = own(detail, 'code');
    if (record(detail) && DIAGNOSTICS.has(code)) {
      entry.diagnostic = { code };
      const durationMs = own(detail, 'durationMs');
      if (validMs(durationMs)) entry.diagnostic.durationMs = Math.round(Math.max(0, durationMs));
      const stage = own(detail, 'stage');
      const resultChannel = own(detail, 'resultChannel');
      const leaseRenewals = own(detail, 'leaseRenewals');
      if (['page', 'prepare', 'readiness', 'authorization', 'dispatch', 'receipt'].includes(stage)) entry.diagnostic.stage = stage;
      if (['none', 'execute-script', 'extension-message', 'page-readback'].includes(resultChannel)) entry.diagnostic.resultChannel = resultChannel;
      if (Number.isSafeInteger(leaseRenewals) && leaseRenewals >= 0) entry.diagnostic.leaseRenewals = Math.min(1000000, leaseRenewals);
      const targetKind = own(detail, 'targetKind');
      const runKind = own(detail, 'runKind');
      const trigger = own(detail, 'trigger');
      const surface = own(detail, 'surface');
      const optionKind = own(detail, 'optionKind');
      if (TARGET_KINDS.has(targetKind)) entry.diagnostic.targetKind = targetKind;
      if (RUN_KINDS.has(runKind)) entry.diagnostic.runKind = runKind;
      if (TRIGGERS.has(trigger)) entry.diagnostic.trigger = trigger;
      if (SURFACES.has(surface)) entry.diagnostic.surface = surface;
      if (OPTION_KINDS.has(optionKind)) entry.diagnostic.optionKind = optionKind;
      const rawEvidence = own(detail, 'evidence');
      if (Array.isArray(rawEvidence)) {
        const len = own(rawEvidence, 'length') ?? 0;
        const cleanEvidence = [];
        for (let i = 0; i < len && cleanEvidence.length < 8; i++) {
          const flag = own(rawEvidence, i);
          if (EVIDENCE_FLAGS.has(flag) && !cleanEvidence.includes(flag)) cleanEvidence.push(flag);
        }
        if (cleanEvidence.length) entry.diagnostic.evidence = cleanEvidence;
      }
      const sequence = own(detail, 'sequence');
      if (Number.isSafeInteger(sequence) && sequence >= 1) entry.diagnostic.sequence = sequence;
      for (const key of BOUNDED_DIAG_COUNTS) {
        const val = own(detail, key);
        if (Number.isSafeInteger(val) && val >= 0) entry.diagnostic[key] = Math.min(1000000, val);
      }
      const maxDomWriteMs = own(detail, 'maxDomWriteMs');
      if (validMs(maxDomWriteMs)) entry.diagnostic.maxDomWriteMs = Math.round(Math.max(0, maxDomWriteMs));
      for (const key of BOUNDED_DIAG_FLAGS) {
        const val = own(detail, key);
        if (typeof val === 'boolean') entry.diagnostic[key] = val;
      }
      if (code === 'timing-probe') {
        const kind = own(detail, 'kind');
        const status = own(detail, 'status');
        const firstMs = own(detail, 'firstMs');
        if (['authorization', 'page-timers'].includes(kind)) entry.diagnostic.kind = kind;
        if (['result', 'invalid-result', 'api-rejected', 'watchdog-expired'].includes(status)) entry.diagnostic.status = status;
        if (validMs(firstMs)) entry.diagnostic.firstMs = Math.round(Math.max(0, firstMs));
        for (const key of ['hidden', 'ok', 'allowed']) {
          const value = own(detail, key);
          if (typeof value === 'boolean') entry.diagnostic[key] = value;
        }
      }
    }
    output.push(entry);
  }
  return { sourceCount, entries: output };
}

function sanitizeDeliveryCollection(source) {
  const list = Array.isArray(source) ? source : [];
  const count = own(list, 'length') ?? 0;
  const retained = [];
  for (let index = count - 1; index >= 0 && retained.length < 20; index--) {
    const value = sanitizeDeliveryDiagnostics(own(list, index));
    if (value) retained.push(value);
  }
  retained.reverse();
  return { count, retained };
}

function sanitizeSummary(raw, includeTimestamps, origin) {
  if (!record(raw)) return null;
  const copyMap = (obj, validator) => {
    const out = {};
    if (!record(obj)) return out;
    for (const key of Object.keys(obj)) {
      if (!validator.has(key)) continue;
      const val = own(obj, key);
      if (Number.isSafeInteger(val) && val >= 0) out[key] = val;
    }
    return out;
  };
  const totalRaw = own(raw, 'totalLogged');
  const firstAt = own(raw, 'firstEventAt');
  const lastAt = own(raw, 'lastEventAt');
  const summary = {
    totalLogged: Number.isSafeInteger(totalRaw) && totalRaw >= 0 ? totalRaw : 0,
    countsByEvent: copyMap(own(raw, 'countsByEvent'), EVENTS),
    countsByCode: copyMap(own(raw, 'countsByCode'), DIAGNOSTICS),
    pauseByCode: copyMap(own(raw, 'pauseByCode'), DIAGNOSTICS),
    exceptionByKind: copyMap(own(raw, 'exceptionByKind'), DIAGNOSTICS),
  };
  if (validTime(firstAt) && validTime(lastAt) && lastAt >= firstAt) {
    summary.spanMs = lastAt - firstAt;
    if (includeTimestamps) {
      summary.firstEventAt = firstAt;
      summary.lastEventAt = lastAt;
    } else if (origin !== undefined) {
      summary.firstEventElapsedMs = Math.max(0, firstAt - origin);
      summary.lastEventElapsedMs = Math.max(0, lastAt - origin);
    }
  }
  return summary;
}

export function buildActivityExport(options = {}) {
  const input = record(options) ? options : null;
  const logs = own(input, 'logs');
  const deliveries = own(input, 'deliveries');
  const incidentLogs = own(input, 'incidentLogs');
  const incidentDeliveries = own(input, 'incidentDeliveries');
  const activityStats = own(input, 'activityStats');
  const diagnosticsHealth = own(input, 'diagnosticsHealth');
  const extensionVersion = own(input, 'extensionVersion');
  const clock = own(input, 'now');
  const timestamps = own(input, 'includeTimestamps');
  const now = clock === undefined ? Date.now() : clock;
  const includeTimestamps = timestamps === undefined ? false : timestamps;
  if (!validTime(now)) throw new TypeError('Invalid export clock.');
  if (typeof includeTimestamps !== 'boolean') throw new TypeError('Invalid timestamp option.');
  const versionMatch = typeof extensionVersion === 'string'
    ? extensionVersion.match(/^\d{1,5}(?:\.\d{1,5}){2,3}$/u) : null;
  const { sourceCount, entries: output } = sanitizeLogCollection(logs);
  const { count: deliveryCount, retained } = sanitizeDeliveryCollection(deliveries);
  const hasIncidentInputs = incidentLogs !== undefined || incidentDeliveries !== undefined;
  const incLogResult = hasIncidentInputs ? sanitizeLogCollection(incidentLogs) : null;
  const incDelResult = hasIncidentInputs ? sanitizeDeliveryCollection(incidentDeliveries) : null;
  let origin;
  const allTimes = [
    ...output.map(entry => entry.at),
    ...retained.map(entry => entry.startedAt),
    ...(incLogResult ? incLogResult.entries.map(entry => entry.at) : []),
    ...(incDelResult ? incDelResult.retained.map(entry => entry.startedAt) : []),
  ];
  for (const at of allTimes) {
    origin = origin === undefined ? at : Math.min(origin, at);
  }
  const formatLogs = list => includeTimestamps ? list : list.map(({ at, ...entry }) => ({ elapsedMs: at - origin, ...entry }));
  const formatDeliveries = list => includeTimestamps ? list : list.map(({ startedAt, updatedAt, ...entry }) => ({
    ...entry, startedElapsedMs: startedAt - origin, updatedElapsedMs: updatedAt - origin,
  }));
  const health = record(diagnosticsHealth) ? diagnosticsHealth : null;
  const writeFailures = own(health, 'writeFailures');
  const persistence = own(health, 'persistence');
  const coverage = {
    logs: { retained: output.length, omitted: sourceCount - output.length },
    deliveries: { retained: retained.length, omitted: deliveryCount - retained.length,
      activeSnapshots: retained.filter(entry => entry.state === 'running').length },
  };
  const summary = activityStats !== undefined ? sanitizeSummary(activityStats, includeTimestamps, origin) : null;
  return {
    format: 'agent-continue-activity', version: 5,
    extensionVersion: versionMatch?.[0] === extensionVersion ? extensionVersion : 'unknown',
    timestampMode: includeTimestamps ? 'unix-ms' : 'relative-ms',
    ...(includeTimestamps ? { exportedAt: new Date(now).toISOString() } : {}),
    excludedEntries: sourceCount - output.length,
    logs: formatLogs(output),
    deliveries: formatDeliveries(retained),
    ...(hasIncidentInputs ? {
      incidents: {
        logs: formatLogs(incLogResult.entries),
        deliveries: formatDeliveries(incDelResult.retained),
        excludedLogs: incLogResult.sourceCount - incLogResult.entries.length,
        excludedDeliveries: incDelResult.count - incDelResult.retained.length,
      },
    } : {}),
    ...(summary ? { summary } : {}),
    coverage,
    diagnosticsHealth: {
      writeFailures: Number.isSafeInteger(writeFailures) && writeFailures >= 0 ? writeFailures : 0,
      persistence: ['available', 'degraded', 'unknown'].includes(persistence) ? persistence : 'unknown',
    },
  };
}
