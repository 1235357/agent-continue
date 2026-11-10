import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeDeliveryDiagnostics, createDeliveryTrace, updateDeliveryTrace } from '../delivery-diagnostics.js';
import { buildActivityExport } from '../activity-export.js';

const now = Date.UTC(2026, 10, 10, 12);
const secret = 'SYNTHETIC_PRIVATE https://example.invalid/private C:\\private\\prompt.txt';
const counterNames = ['pageAdmissions', 'modelWrites', 'domWrites', 'fillCalls', 'readinessChecks',
  'authorizationChecks', 'grantRequests', 'grantReadbacks', 'retiredReadbacks', 'dispatchAttempts',
  'receiptChecks', 'manualIntents', 'attachmentsRemoved', 'transportErrors', 'leaseRenewals', 'documentChanges'];
const timingNames = ['modelWriteMs', 'domWriteMs', 'maxModelWriteMs', 'maxDomWriteMs', 'elapsedMs', 'stageElapsedMs'];
const observationNames = ['hidden', 'sendPresent', 'sendEnabled', 'composerPresent', 'busy', 'manualPending'];
const reasons = ['starting', 'prepared', 'ready', 'waiting-send', 'send-unavailable', 'send-ambiguous',
  'unsupported-view', 'composer-unavailable', 'composer-changed', 'view-changed', 'not-editable',
  'attachments', 'busy', 'expired', 'page-mismatch', 'target-mismatch', 'invalid-arguments', 'invalid-method',
  'invalid-phase', 'invalid-url', 'empty-payload', 'commit-state-unavailable', 'model-not-synchronous',
  'receipt-unavailable', 'dispatched', 'already-dispatched', 'dispatch-error', 'commit-error',
  'manual-submission', 'cancelled', 'transport-pending', 'transport-rejected', 'result-missing',
  'grant-pending', 'grant-accepted', 'awaiting-receipt', 'receipt-confirmed', 'manual-receipt-confirmed',
  'document-replaced', 'worker-interrupted', 'diagnostics-write-failed', 'unknown'];
const exportActivity = extra => buildActivityExport({ extensionVersion: '3.0.12', now, ...extra });

test('new traces have a complete bounded typed shape and use a supplied clock', () => {
  const trace = createDeliveryTrace(1, now);
  assert.deepEqual(trace, {
    sequence: 1, startedAt: now, updatedAt: now, state: 'running', stage: 'page', reason: 'starting', method: 'none', resultChannel: 'none',
    counters: Object.fromEntries(counterNames.map(key => [key, 0])),
    timings: Object.fromEntries(timingNames.map(key => [key, 0])), observations: {},
    history: [{ elapsedMs: 0, stage: 'page', reason: 'starting' }], droppedHistory: 0,
  });
  assert.deepEqual(sanitizeDeliveryDiagnostics(JSON.parse(JSON.stringify(trace))), trace);
});

test('invalid required fields and unsafe epoch clocks are rejected without coercion', () => {
  for (const value of [null, [], true, 1, secret, {}, new Error(secret)]) {
    assert.equal(sanitizeDeliveryDiagnostics(value), null);
  }
  for (const sequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', true, NaN, Infinity]) {
    assert.throws(() => createDeliveryTrace(sequence, now), TypeError);
    assert.equal(sanitizeDeliveryDiagnostics({ ...createDeliveryTrace(1, now), sequence }), null);
  }
  for (const clock of [-1, 1.5, 8_640_000_000_000_001, '100', null, NaN, Infinity]) {
    assert.throws(() => createDeliveryTrace(1, clock), TypeError);
    assert.throws(() => updateDeliveryTrace(createDeliveryTrace(1, now), {}, clock), TypeError);
  }
  for (const patch of [{ startedAt: secret }, { updatedAt: now - 1 }, { state: secret }, { stage: secret }]) {
    assert.equal(sanitizeDeliveryDiagnostics({ ...createDeliveryTrace(1, now), ...patch }), null);
  }
});

test('all required fixed reason, state and stage enums round trip without free text', () => {
  const base = createDeliveryTrace(1, now);
  for (const reason of reasons) assert.equal(sanitizeDeliveryDiagnostics({ ...base, reason }).reason, reason);
  for (const state of ['running', 'sent', 'manual-sent', 'cancelled', 'unknown', 'blocked', 'error', 'interrupted']) {
    assert.equal(sanitizeDeliveryDiagnostics({ ...base, state }).state, state);
  }
  for (const stage of ['page', 'prepare', 'readiness', 'authorization', 'dispatch', 'receipt']) {
    assert.equal(sanitizeDeliveryDiagnostics({ ...base, stage }).stage, stage);
  }
  for (const method of ['none', 'button', 'enter', 'ctrl-enter']) {
    assert.equal(sanitizeDeliveryDiagnostics({ ...base, method }).method, method);
    assert.equal(updateDeliveryTrace(base, { method }, now).method, method);
  }
  for (const resultChannel of ['none', 'execute-script', 'extension-message', 'page-readback']) {
    assert.equal(sanitizeDeliveryDiagnostics({ ...base, resultChannel }).resultChannel, resultChannel);
    assert.equal(updateDeliveryTrace(base, { resultChannel }, now).resultChannel, resultChannel);
  }
  const invalid = sanitizeDeliveryDiagnostics({ ...base, method: secret, resultChannel: secret });
  assert.equal(invalid.method, 'none');
  assert.equal(invalid.resultChannel, 'none');
});

test('sanitization recursively drops malicious fields, values, prototypes and accessors', () => {
  const input = { ...createDeliveryTrace(1, now), prompt: secret, path: secret, url: secret, rawError: new Error(secret),
    reason: secret, counters: { pageAdmissions: 4, modelWrites: secret, prompt: secret, nested: { prompt: secret } },
    timings: { modelWriteMs: 250_001.5, domWriteMs: secret, rawError: secret },
    observations: { hidden: true, busy: 'true', manualPending: false, url: secret },
    history: [{ elapsedMs: 0, stage: 'page', reason: 'starting', prompt: secret },
      { elapsedMs: 1, stage: 'receipt', reason: secret }], droppedHistory: secret,
  };
  Object.defineProperty(input.counters, 'fillCalls', { get() { throw new Error('Accessor must not execute'); } });
  Object.setPrototypeOf(input.observations, { sendPresent: true });
  const value = sanitizeDeliveryDiagnostics(input);
  assert.equal(value.counters.pageAdmissions, 4);
  assert.equal(Object.hasOwn(value.counters, 'modelWrites'), false);
  assert.equal(Object.hasOwn(value.counters, 'fillCalls'), false);
  assert.deepEqual(value.timings, { modelWriteMs: 250_001.5 });
  assert.deepEqual(value.observations, { hidden: true, manualPending: false });
  assert.equal(Object.hasOwn(value, 'reason'), false);
  assert.equal(value.history.length, 1);
  assert.equal(value.droppedHistory, 0);
  assert.equal(JSON.stringify(value).includes(secret), false);
  const inherited = Object.create(createDeliveryTrace(1, now));
  assert.equal(sanitizeDeliveryDiagnostics(inherited), null);
});

test('only nonnegative safe counters, finite safe timings and real booleans survive', () => {
  const base = createDeliveryTrace(1, now);
  for (const bad of [-1, '2', null, true, [], {}, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const value = sanitizeDeliveryDiagnostics({ ...base, counters: { pageAdmissions: bad }, timings: { modelWriteMs: bad } });
    assert.deepEqual(value.counters, {});
    assert.deepEqual(value.timings, {});
  }
  assert.deepEqual(sanitizeDeliveryDiagnostics({ ...base, counters: { fillCalls: 1.5 } }).counters, {});
  const boundary = sanitizeDeliveryDiagnostics({ ...base,
    counters: Object.fromEntries(counterNames.map(key => [key, Number.MAX_SAFE_INTEGER])),
    timings: Object.fromEntries(timingNames.map(key => [key, Number.MAX_SAFE_INTEGER])),
    observations: Object.fromEntries(observationNames.map(key => [key, false])),
  });
  assert.deepEqual(JSON.parse(JSON.stringify(boundary)), boundary);
  assert.equal(Object.keys(boundary.counters).length, counterNames.length);
  assert.equal(Object.keys(boundary.timings).length, timingNames.length);
});

test('updates max-merge absolute totals without mutation or identity replacement', () => {
  const original = createDeliveryTrace(7, now);
  const first = updateDeliveryTrace(original, { sequence: 99, startedAt: 0, updatedAt: 0,
    counters: Object.fromEntries(counterNames.map((key, n) => [key, n + 1])),
    timings: { modelWriteMs: 250_000.5, maxModelWriteMs: 200_000.25, stageElapsedMs: 10 },
    observations: { hidden: true }, prompt: secret,
  }, now + 300_000);
  const next = updateDeliveryTrace(first, { counters: { pageAdmissions: 0, modelWrites: 20, domWrites: secret },
    timings: { modelWriteMs: 1, stageElapsedMs: 5 }, observations: { hidden: false, busy: true },
  }, now + 300_010);
  assert.equal(next.sequence, 7);
  assert.equal(next.startedAt, now);
  assert.equal(next.updatedAt, now + 300_010);
  assert.equal(next.counters.pageAdmissions, 1);
  assert.equal(next.counters.modelWrites, 20);
  assert.equal(next.counters.domWrites, 3);
  assert.equal(next.timings.modelWriteMs, 250_000.5);
  assert.equal(next.timings.maxModelWriteMs, 200_000.25);
  assert.equal(next.timings.stageElapsedMs, 300_010);
  assert.equal(next.timings.elapsedMs, 300_010);
  assert.deepEqual(next.observations, { hidden: false, busy: true });
  assert.deepEqual(original, createDeliveryTrace(7, now));
  assert.equal(JSON.stringify(next).includes(secret), false);
});

test('out-of-order clock updates do not move timestamps, totals or history backward', () => {
  let trace = updateDeliveryTrace(createDeliveryTrace(1, now), { stage: 'prepare', reason: 'prepared' }, now + 1000);
  trace = updateDeliveryTrace(trace, { stage: 'readiness', reason: 'ready' }, now + 500);
  assert.equal(trace.updatedAt, now + 1000);
  assert.equal(trace.timings.elapsedMs, 1000);
  assert.equal(trace.history.at(-1).elapsedMs, 1000);
});

test('stage elapsed exceeds 120 seconds and resets on stage changes, not reason changes', () => {
  let trace = updateDeliveryTrace(createDeliveryTrace(1, now), { stage: 'prepare', reason: 'prepared' }, now + 10);
  trace = updateDeliveryTrace(trace, { counters: { modelWrites: 2 }, timings: { modelWriteMs: 130_000 } }, now + 130_010);
  assert.equal(trace.timings.stageElapsedMs, 130_000);
  assert.equal(trace.timings.elapsedMs, 130_010);
  trace = updateDeliveryTrace(trace, { reason: 'waiting-send', counters: { modelWrites: 1 } }, now + 140_010);
  assert.equal(trace.timings.stageElapsedMs, 140_000);
  assert.equal(trace.counters.modelWrites, 2);
  assert.equal(trace.timings.modelWriteMs, 130_000);
  trace = updateDeliveryTrace(trace, { stage: 'readiness', reason: 'ready', timings: { stageElapsedMs: 999_999 } }, now + 150_010);
  assert.equal(trace.timings.stageElapsedMs, 0);
  assert.equal(trace.timings.elapsedMs, 150_010);
  trace = updateDeliveryTrace(trace, { reason: 'busy' }, now + 151_010);
  assert.equal(trace.timings.stageElapsedMs, 1000);
  trace = updateDeliveryTrace(trace, {}, now + 150_500);
  assert.equal(trace.timings.stageElapsedMs, 1000);
});

test('stage elapsed survives history truncation of reason-only transitions', () => {
  let trace = createDeliveryTrace(1, now);
  for (let n = 1; n <= 100; n++) {
    trace = updateDeliveryTrace(trace, { reason: n % 2 ? 'ready' : 'busy' }, now + n * 2000);
  }
  assert.equal(trace.history.length, 64);
  assert.equal(trace.droppedHistory, 37);
  assert.equal(trace.timings.stageElapsedMs, 200_000);
  trace = updateDeliveryTrace(trace, { stage: 'receipt' }, now + 201_000);
  assert.equal(trace.timings.stageElapsedMs, 0);
});

test('restored stage duration derives from its last stage transition, not a stale cached total', () => {
  for (const cached of [undefined, 0, 99]) {
    const trace = { ...createDeliveryTrace(1, 0), updatedAt: 100, stage: 'prepare', reason: 'ready',
      timings: cached === undefined ? {} : { stageElapsedMs: cached },
      history: [{ elapsedMs: 0, stage: 'page', reason: 'starting' },
        { elapsedMs: 40, stage: 'prepare', reason: 'prepared' },
        { elapsedMs: 90, stage: 'prepare', reason: 'ready' }],
    };
    assert.equal(updateDeliveryTrace(trace, {}, 110).timings.stageElapsedMs, 70);
  }
});

test('only stage/reason transitions append history, using current elapsed time', () => {
  let trace = createDeliveryTrace(1, now);
  trace = updateDeliveryTrace(trace, { stage: 'prepare', reason: 'prepared' }, now + 5);
  trace = updateDeliveryTrace(trace, { counters: { modelWrites: 1 } }, now + 10);
  trace = updateDeliveryTrace(trace, { stage: 'prepare', reason: 'prepared', state: 'blocked' }, now + 15);
  trace = updateDeliveryTrace(trace, { reason: 'waiting-send' }, now + 20);
  trace = updateDeliveryTrace(trace, { stage: 'readiness' }, now + 25);
  assert.deepEqual(trace.history, [
    { elapsedMs: 0, stage: 'page', reason: 'starting' },
    { elapsedMs: 5, stage: 'prepare', reason: 'prepared' },
    { elapsedMs: 20, stage: 'prepare', reason: 'waiting-send' },
    { elapsedMs: 25, stage: 'readiness', reason: 'waiting-send' },
  ]);
});

test('history keeps the latest 64 transitions and counts dropped entries without wrapping', () => {
  let trace = createDeliveryTrace(1, now);
  for (let n = 1; n <= 100; n++) {
    trace = updateDeliveryTrace(trace, { stage: n % 2 ? 'prepare' : 'readiness', reason: 'ready' }, now + n);
  }
  assert.equal(trace.history.length, 64);
  assert.equal(trace.droppedHistory, 37);
  assert.equal(trace.history[0].elapsedMs, 37);
  assert.equal(trace.history.at(-1).elapsedMs, 100);
  assert.deepEqual(sanitizeDeliveryDiagnostics(trace), trace);
  trace.droppedHistory = Number.MAX_SAFE_INTEGER;
  assert.equal(updateDeliveryTrace(trace, { reason: 'busy' }, now + 101).droppedHistory, Number.MAX_SAFE_INTEGER);
});

test('persisted history is sanitized, coalesced and bounded independently of updates', () => {
  const base = updateDeliveryTrace(createDeliveryTrace(1, now), {}, now + 100);
  const duplicate = { elapsedMs: 1, stage: 'page', reason: 'starting' };
  const value = sanitizeDeliveryDiagnostics({ ...base, history: [duplicate, { ...duplicate, elapsedMs: 2 },
    { elapsedMs: 3, stage: secret, reason: 'ready' }, { elapsedMs: 4, stage: 'prepare', reason: 'prepared' }] });
  assert.deepEqual(value.history, [duplicate, { elapsedMs: 4, stage: 'prepare', reason: 'prepared' }]);
  const capped = sanitizeDeliveryDiagnostics({ ...base, droppedHistory: 5,
    history: Array.from({ length: 80 }, (_, elapsedMs) => ({ elapsedMs, stage: elapsedMs % 2 ? 'page' : 'prepare', reason: 'ready' })),
  });
  assert.equal(capped.history.length, 64);
  assert.equal(capped.history[0].elapsedMs, 16);
  assert.equal(capped.droppedHistory, 21);
});

test('history drops future and backward times before recording a new transition', () => {
  const trace = { ...createDeliveryTrace(1, 0), updatedAt: 100,
    history: [{ elapsedMs: 0, stage: 'page', reason: 'starting' },
      { elapsedMs: 50, stage: 'page', reason: 'ready' },
      { elapsedMs: 40, stage: 'page', reason: 'busy' },
      { elapsedMs: 500, stage: 'page', reason: 'unknown' }],
  };
  const updated = updateDeliveryTrace(trace, { reason: 'busy' }, 110);
  assert.deepEqual(updated.history.map(entry => entry.elapsedMs), [0, 50, 110]);
});

test('history and export collections never execute input array getters or iterators', () => {
  const hostile = () => {
    const array = [null];
    Object.defineProperty(array, '0', { get() { throw new Error(secret); } });
    Object.defineProperty(array, Symbol.iterator, { get() { throw new Error(secret); } });
    array.slice = () => { throw new Error(secret); };
    return array;
  };
  assert.deepEqual(sanitizeDeliveryDiagnostics({ ...createDeliveryTrace(1, now), history: hostile() }).history, []);
  const exported = exportActivity({ logs: hostile(), deliveries: hostile() });
  assert.deepEqual(exported.logs, []);
  assert.deepEqual(exported.deliveries, []);
  assert.equal(exported.coverage.logs.omitted, 1);
  assert.equal(exported.coverage.deliveries.omitted, 1);
  const inherited = new Array(1);
  Object.setPrototypeOf(inherited, { 0: createDeliveryTrace(1, now) });
  assert.deepEqual(exportActivity({ deliveries: inherited }).deliveries, []);
});

test('export options also use only own data fields without executing accessors', () => {
  const options = { extensionVersion: '3.0.12', now };
  Object.defineProperty(options, 'logs', { get() { throw new Error(secret); } });
  assert.deepEqual(buildActivityExport(options).logs, []);
  const inherited = Object.create({ logs: [{ at: now, event: 'sent' }], deliveries: [createDeliveryTrace(1, now)] });
  inherited.now = now;
  assert.deepEqual(buildActivityExport(inherited).logs, []);
  assert.deepEqual(buildActivityExport(inherited).deliveries, []);
});

test('invalid update patches cannot inject identity, history, enums or nested text', () => {
  const trace = createDeliveryTrace(1, now);
  const patch = { state: secret, stage: secret, reason: secret, history: [{ prompt: secret }],
    droppedHistory: 500, counters: { pageAdmissions: secret }, timings: { elapsedMs: secret }, observations: { hidden: secret } };
  const updated = updateDeliveryTrace(trace, patch, now);
  assert.deepEqual(updated, trace);
  for (const patch of [null, [], secret, true]) assert.deepEqual(updateDeliveryTrace(trace, patch, now), trace);
  assert.equal(updateDeliveryTrace(null, patch, now), null);
});

test('v5 export retains the latest 20 valid snapshots with coverage and default health', () => {
  const deliveries = Array.from({ length: 25 }, (_, n) => createDeliveryTrace(n + 1, now + n));
  deliveries.push({ sequence: secret }, null);
  const before = structuredClone(deliveries);
  const output = exportActivity({ deliveries });
  assert.equal(output.version, 5);
  assert.equal(output.deliveries.length, 20);
  assert.equal(output.deliveries[0].sequence, 6);
  assert.equal(output.deliveries.at(-1).sequence, 25);
  assert.deepEqual(output.coverage, { logs: { retained: 0, omitted: 0 }, deliveries: { retained: 20, omitted: 7, activeSnapshots: 20 } });
  assert.deepEqual(output.diagnosticsHealth, { writeFailures: 0, persistence: 'unknown' });
  assert.deepEqual(deliveries, before);
});

test('relative exports use one origin for log and delivery epochs without leaking wall clocks', () => {
  const trace = updateDeliveryTrace(createDeliveryTrace(1, now - 5000), { stage: 'receipt', reason: 'awaiting-receipt' }, now - 1000);
  const output = exportActivity({ logs: [{ at: now - 3000, event: 'sent', message: secret }], deliveries: [trace] });
  assert.equal(output.logs[0].elapsedMs, 2000);
  assert.equal(output.deliveries[0].startedElapsedMs, 0);
  assert.equal(output.deliveries[0].updatedElapsedMs, 4000);
  assert.equal(output.deliveries[0].history.at(-1).elapsedMs, 4000);
  assert.equal(Object.hasOwn(output.deliveries[0], 'startedAt'), false);
  assert.equal(Object.hasOwn(output.deliveries[0], 'updatedAt'), false);
  assert.equal(Object.hasOwn(output, 'exportedAt'), false);
  for (const epoch of [now, now - 5000, now - 1000]) assert.equal(JSON.stringify(output).includes(String(epoch)), false);
  const absolute = exportActivity({ deliveries: [trace], includeTimestamps: true });
  assert.deepEqual(absolute.deliveries[0], trace);
  assert.equal(absolute.exportedAt, new Date(now).toISOString());
});

test('export sanitizes active and completed snapshots and never copies free-form data', () => {
  const deliveries = ['running', 'sent', 'manual-sent', 'cancelled', 'unknown', 'blocked', 'error', 'interrupted'].map((state, n) => ({
    ...createDeliveryTrace(n + 1, now), state, prompt: secret, reason: 'unknown',
    counters: { transportErrors: n, secret }, observations: { manualPending: state === 'running', url: secret },
  }));
  const output = exportActivity({ deliveries, prompt: secret, diagnosticsHealth: { writeFailures: 2, persistence: 'degraded', error: secret } });
  assert.equal(output.coverage.deliveries.activeSnapshots, 1);
  assert.deepEqual(output.diagnosticsHealth, { writeFailures: 2, persistence: 'degraded' });
  assert.equal(JSON.stringify(output).includes(secret), false);
  assert.equal(output.deliveries[7].counters.transportErrors, 7);
});

test('v5 exports retain long durations and reject invalid millisecond values rather than coerce', () => {
  const trace = updateDeliveryTrace(createDeliveryTrace(1, now), { timings: { domWriteMs: 500_000.5 } }, now + 600_000);
  const output = exportActivity({ deliveries: [trace], logs: [{ at: now, event: 'timing-diagnostics',
    diagnostic: { code: 'timing-probe', durationMs: 500_001, firstMs: 300_000 } }] });
  assert.equal(output.deliveries[0].timings.domWriteMs, 500_000.5);
  assert.equal(output.deliveries[0].timings.elapsedMs, 600_000);
  assert.equal(output.logs[0].diagnostic.durationMs, 500_001);
  assert.equal(output.logs[0].diagnostic.firstMs, 300_000);
  for (const bad of ['100', true, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const result = exportActivity({ logs: [{ at: now, event: 'sent', diagnostic: { code: 'adapter-result', durationMs: bad } }] });
    assert.equal(Object.hasOwn(result.logs[0].diagnostic, 'durationMs'), false);
  }
  assert.equal(exportActivity({ logs: [{ at: now, event: 'sent',
    diagnostic: { code: 'adapter-result', durationMs: -1 } }] }).logs[0].diagnostic.durationMs, 0);
});

test('health is strictly typed and legacy logs remain usable without delivery input', () => {
  for (const bad of [null, [], secret, { writeFailures: secret, persistence: secret }, { writeFailures: -1, persistence: true }]) {
    assert.deepEqual(exportActivity({ diagnosticsHealth: bad }).diagnosticsHealth, { writeFailures: 0, persistence: 'unknown' });
  }
  const legacy = exportActivity({ logs: [{ at: now, event: 'busy' }] });
  assert.deepEqual(legacy.logs, [{ elapsedMs: 0, event: 'busy' }]);
  assert.deepEqual(legacy.deliveries, []);
  assert.equal(legacy.excludedEntries, 0);
  assert.deepEqual(legacy.coverage.logs, { retained: 1, omitted: 0 });
  assert.equal(exportActivity({ logs: [{ at: now, event: 'manual-sent' }] }).logs[0].event, 'manual-sent');
});
