const STATES = new Set(['running', 'sent', 'manual-sent', 'cancelled', 'unknown', 'blocked', 'error', 'interrupted']);
const STAGES = new Set(['page', 'prepare', 'readiness', 'authorization', 'dispatch', 'receipt']);
const METHODS = new Set(['none', 'button', 'enter', 'ctrl-enter']);
const CHANNELS = new Set(['none', 'execute-script', 'extension-message', 'page-readback']);
const REASONS = new Set([
  'starting', 'prepared', 'ready', 'waiting-send', 'send-unavailable', 'send-ambiguous',
  'unsupported-view', 'composer-unavailable', 'composer-changed', 'view-changed', 'not-editable',
  'attachments', 'busy', 'expired', 'page-mismatch', 'target-mismatch', 'invalid-arguments',
  'invalid-method', 'invalid-phase', 'invalid-url', 'empty-payload', 'commit-state-unavailable',
  'model-not-synchronous', 'receipt-unavailable', 'dispatched', 'already-dispatched', 'dispatch-error',
  'commit-error', 'manual-submission', 'cancelled', 'transport-pending', 'transport-rejected',
  'result-missing', 'grant-pending', 'grant-accepted', 'awaiting-receipt', 'receipt-confirmed',
  'manual-receipt-confirmed', 'document-replaced', 'worker-interrupted', 'diagnostics-write-failed', 'unknown',
]);
const COUNTERS = ['pageAdmissions', 'modelWrites', 'domWrites', 'fillCalls', 'readinessChecks',
  'authorizationChecks', 'grantRequests', 'grantReadbacks', 'retiredReadbacks', 'dispatchAttempts',
  'receiptChecks', 'manualIntents', 'attachmentsRemoved', 'transportErrors', 'leaseRenewals', 'documentChanges'];
const TIMINGS = ['modelWriteMs', 'domWriteMs', 'maxModelWriteMs', 'maxDomWriteMs', 'elapsedMs', 'stageElapsedMs'];
const OBSERVATIONS = ['hidden', 'sendPresent', 'sendEnabled', 'composerPresent', 'busy', 'manualPending'];
const uint = value => Number.isSafeInteger(value) && value >= 0;
const epoch = value => uint(value) && value <= 8_640_000_000_000_000;
const milliseconds = value => typeof value === 'number' && Number.isFinite(value)
  && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const addDropped = (count, extra = 1) => Math.min(Number.MAX_SAFE_INTEGER, count + extra);

// Persisted values are data, not objects whose getters or prototypes we execute.
function own(value, key) {
  if (value === null || typeof value !== 'object') return undefined;
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; }
  catch { return undefined; }
}

function fields(value, names, valid) {
  const output = {};
  if (!record(value)) return output;
  for (const name of names) {
    const item = own(value, name);
    if (valid(item)) output[name] = item;
  }
  return output;
}

function historyEntries(value, droppedHistory, elapsedLimit) {
  const history = [];
  if (Array.isArray(value)) {
    for (let index = 0; index < own(value, 'length'); index++) {
      const entry = own(value, index);
      if (!record(entry)) continue;
      const elapsedMs = own(entry, 'elapsedMs');
      const stage = own(entry, 'stage');
      const reason = own(entry, 'reason');
      const previous = history.at(-1);
      if (!milliseconds(elapsedMs) || elapsedMs > elapsedLimit || elapsedMs < (previous?.elapsedMs ?? 0)
        || !STAGES.has(stage) || !REASONS.has(reason)) continue;
      if (previous?.stage === stage && previous.reason === reason) continue;
      history.push({ elapsedMs, stage, reason });
      if (history.length > 64) { history.shift(); droppedHistory = addDropped(droppedHistory); }
    }
  }
  return { history, droppedHistory };
}

export function sanitizeDeliveryDiagnostics(value) {
  if (!record(value)) return null;
  const sequence = own(value, 'sequence');
  const startedAt = own(value, 'startedAt');
  const updatedAt = own(value, 'updatedAt');
  const state = own(value, 'state');
  const stage = own(value, 'stage');
  const reason = own(value, 'reason');
  if (!uint(sequence) || sequence === 0 || !epoch(startedAt) || !epoch(updatedAt)
    || updatedAt < startedAt || !STATES.has(state) || !STAGES.has(stage)) return null;
  const dropped = own(value, 'droppedHistory');
  return {
    sequence, startedAt, updatedAt, state, stage,
    method: METHODS.has(own(value, 'method')) ? own(value, 'method') : 'none',
    resultChannel: CHANNELS.has(own(value, 'resultChannel')) ? own(value, 'resultChannel') : 'none',
    ...(REASONS.has(reason) ? { reason } : {}),
    counters: fields(own(value, 'counters'), COUNTERS, uint),
    timings: fields(own(value, 'timings'), TIMINGS, milliseconds),
    observations: fields(own(value, 'observations'), OBSERVATIONS, item => typeof item === 'boolean'),
    ...historyEntries(own(value, 'history'), uint(dropped) ? dropped : 0, updatedAt - startedAt),
  };
}

export function createDeliveryTrace(sequence, now = Date.now()) {
  if (!uint(sequence) || sequence === 0) throw new TypeError('Invalid delivery sequence.');
  if (!epoch(now)) throw new TypeError('Invalid delivery clock.');
  return {
    sequence, startedAt: now, updatedAt: now, state: 'running', stage: 'page', reason: 'starting', method: 'none', resultChannel: 'none',
    counters: Object.fromEntries(COUNTERS.map(name => [name, 0])),
    timings: Object.fromEntries(TIMINGS.map(name => [name, 0])), observations: {},
    history: [{ elapsedMs: 0, stage: 'page', reason: 'starting' }], droppedHistory: 0,
  };
}

export function updateDeliveryTrace(trace, patch, now = Date.now()) {
  if (!epoch(now)) throw new TypeError('Invalid delivery clock.');
  const value = sanitizeDeliveryDiagnostics(trace);
  if (!value) return null;
  const previousStage = value.stage;
  const previousUpdatedAt = value.updatedAt;
  const previousElapsed = previousUpdatedAt - value.startedAt;
  let previousStageElapsed = Math.min(value.timings.stageElapsedMs ?? 0, previousElapsed);
  let stageStart = value.history.length;
  while (stageStart > 0 && value.history[stageStart - 1].stage === previousStage) stageStart--;
  if (stageStart < value.history.length) {
    const fromHistory = previousElapsed - value.history[stageStart].elapsedMs;
    previousStageElapsed = stageStart > 0 || value.droppedHistory === 0
      ? fromHistory : Math.max(previousStageElapsed, fromHistory);
  }
  for (const [name, allowed] of [['state', STATES], ['stage', STAGES], ['reason', REASONS], ['method', METHODS], ['resultChannel', CHANNELS]]) {
    const item = own(patch, name);
    if (allowed.has(item)) value[name] = item;
  }
  for (const [name, names, valid] of [['counters', COUNTERS, uint], ['timings', TIMINGS, milliseconds]]) {
    for (const [key, total] of Object.entries(fields(own(patch, name), names, valid))) {
      value[name][key] = Math.max(value[name][key] ?? 0, total);
    }
  }
  Object.assign(value.observations, fields(own(patch, 'observations'), OBSERVATIONS, item => typeof item === 'boolean'));
  value.updatedAt = Math.max(value.updatedAt, now);
  const elapsedMs = value.updatedAt - value.startedAt;
  value.timings.elapsedMs = Math.max(value.timings.elapsedMs ?? 0, elapsedMs);
  // Carry stage duration independently of the capped reason-transition history.
  value.timings.stageElapsedMs = value.stage === previousStage
    ? previousStageElapsed + (value.updatedAt - previousUpdatedAt) : 0;
  const previous = value.history.at(-1);
  const reason = value.reason ?? 'unknown';
  if (previous?.stage !== value.stage || previous.reason !== reason) {
    value.history.push({ elapsedMs, stage: value.stage, reason });
    if (value.history.length > 64) { value.history.shift(); value.droppedHistory = addDropped(value.droppedHistory); }
  }
  return value;
}
