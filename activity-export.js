import { sanitizeDeliveryDiagnostics } from './delivery-diagnostics.js';

const EVENTS = new Set([
  'started', 'start', 'resumed', 'resume', 'paused', 'pause', 'sent', 'manual-sent', 'busy',
  'draft', 'unknown', 'blocked', 'error', 'restored', 'recovered', 'unconfirmed',
  'reply-complete', 'limit-reached', 'queue-complete', 'marker-reached',
  'target-closed', 'quiet', 'skipped', 'done', 'stopped', 'browser-restored',
  'interrupted', 'cancelled', 'ready', 'replaced', 'scheduler-error', 'timing-diagnostics',
]);
const DIAGNOSTICS = new Set(['adapter-result', 'execution-exception', 'execution-timeout', 'no-valid-result', 'existing-draft', 'composer-changed', 'timing-probe', 'send-not-ready', 'commit-not-dispatched']);
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validMs = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
function own(value, key) {
  if (value === null || typeof value !== 'object') return undefined;
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; }
  catch { return undefined; }
}

export function buildActivityExport(options = {}) {
  const input = record(options) ? options : null;
  const logs = own(input, 'logs');
  const deliveries = own(input, 'deliveries');
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
  const source = Array.isArray(logs) ? logs : [];
  const sourceCount = own(source, 'length') ?? 0;
  const output = [];
  for (let index = Math.max(0, sourceCount - 200); index < sourceCount; index++) {
    const item = own(source, index);
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
      if (validMs(durationMs)) {
        entry.diagnostic.durationMs = Math.round(Math.max(0, durationMs));
      }
      const stage = own(detail, 'stage');
      const resultChannel = own(detail, 'resultChannel');
      const leaseRenewals = own(detail, 'leaseRenewals');
      if (['page', 'prepare', 'readiness', 'authorization', 'dispatch', 'receipt'].includes(stage)) entry.diagnostic.stage = stage;
      if (['none', 'execute-script', 'extension-message', 'page-readback'].includes(resultChannel)) entry.diagnostic.resultChannel = resultChannel;
      if (Number.isSafeInteger(leaseRenewals) && leaseRenewals >= 0) entry.diagnostic.leaseRenewals = Math.min(1000000, leaseRenewals);
      if (code === 'timing-probe') {
        const kind = own(detail, 'kind');
        const status = own(detail, 'status');
        const firstMs = own(detail, 'firstMs');
        if (['authorization', 'page-timers'].includes(kind)) entry.diagnostic.kind = kind;
        if (['result', 'invalid-result', 'api-rejected', 'watchdog-expired'].includes(status)) entry.diagnostic.status = status;
        if (validMs(firstMs)) {
          entry.diagnostic.firstMs = Math.round(Math.max(0, firstMs));
        }
        for (const key of ['hidden', 'ok', 'allowed']) {
          const value = own(detail, key);
          if (typeof value === 'boolean') entry.diagnostic[key] = value;
        }
      }
    }
    output.push(entry);
  }
  const deliverySource = Array.isArray(deliveries) ? deliveries : [];
  const deliveryCount = own(deliverySource, 'length') ?? 0;
  const retained = [];
  for (let index = deliveryCount - 1; index >= 0 && retained.length < 20; index--) {
    const value = sanitizeDeliveryDiagnostics(own(deliverySource, index));
    if (value) retained.push(value);
  }
  retained.reverse();
  let origin;
  for (const at of [...output.map(entry => entry.at), ...retained.map(entry => entry.startedAt)]) {
    origin = origin === undefined ? at : Math.min(origin, at);
  }
  const health = record(diagnosticsHealth) ? diagnosticsHealth : null;
  const writeFailures = own(health, 'writeFailures');
  const persistence = own(health, 'persistence');
  const coverage = {
    logs: { retained: output.length, omitted: sourceCount - output.length },
    deliveries: { retained: retained.length, omitted: deliveryCount - retained.length,
      activeSnapshots: retained.filter(entry => entry.state === 'running').length },
  };
  return {
    format: 'agent-continue-activity', version: 5,
    extensionVersion: versionMatch?.[0] === extensionVersion ? extensionVersion : 'unknown',
    timestampMode: includeTimestamps ? 'unix-ms' : 'relative-ms',
    ...(includeTimestamps ? { exportedAt: new Date(now).toISOString() } : {}),
    excludedEntries: sourceCount - output.length,
    logs: includeTimestamps ? output : output.map(({ at, ...entry }) => ({ elapsedMs: at - origin, ...entry })),
    deliveries: includeTimestamps ? retained : retained.map(({ startedAt, updatedAt, ...entry }) => ({
      ...entry, startedElapsedMs: startedAt - origin, updatedElapsedMs: updatedAt - origin,
    })),
    coverage,
    diagnosticsHealth: {
      writeFailures: Number.isSafeInteger(writeFailures) && writeFailures >= 0 ? writeFailures : 0,
      persistence: ['available', 'degraded', 'unknown'].includes(persistence) ? persistence : 'unknown',
    },
  };
}
