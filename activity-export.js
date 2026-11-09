const EVENTS = new Set([
  'started', 'start', 'resumed', 'resume', 'paused', 'pause', 'sent', 'busy',
  'draft', 'unknown', 'blocked', 'error', 'restored', 'recovered', 'unconfirmed',
  'reply-complete', 'limit-reached', 'queue-complete', 'marker-reached',
  'target-closed', 'quiet', 'skipped', 'done', 'stopped', 'browser-restored',
  'interrupted', 'cancelled', 'ready', 'replaced', 'scheduler-error', 'timing-diagnostics',
]);
const DIAGNOSTICS = new Set(['adapter-result', 'execution-exception', 'execution-timeout', 'no-valid-result', 'existing-draft', 'composer-changed', 'timing-probe', 'send-not-ready', 'commit-not-dispatched']);
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function buildActivityExport({ logs, extensionVersion, now = Date.now(), includeTimestamps = false }) {
  if (!validTime(now)) throw new TypeError('Invalid export clock.');
  if (typeof includeTimestamps !== 'boolean') throw new TypeError('Invalid timestamp option.');
  const versionMatch = typeof extensionVersion === 'string'
    ? extensionVersion.match(/^\d{1,5}(?:\.\d{1,5}){2,3}$/u) : null;
  const source = Array.isArray(logs) ? logs : [];
  const output = [];
  let origin;
  for (const item of source.slice(-200)) {
    if (!record(item) || !validTime(item.at) || !EVENTS.has(item.event)) continue;
    // Free-form messages and unknown fields are deliberately not copied.
    origin ??= item.at;
    const entry = { ...(includeTimestamps ? { at: item.at } : { elapsedMs: item.at - origin }), event: item.event };
    const detail = item.diagnostic;
    if (record(detail) && DIAGNOSTICS.has(detail.code)) {
      entry.diagnostic = { code: detail.code };
      if (typeof detail.durationMs === 'number' && Number.isFinite(detail.durationMs)) {
        entry.diagnostic.durationMs = Math.round(Math.max(0, Math.min(120000, detail.durationMs)));
      }
      if (detail.code === 'timing-probe') {
        if (['authorization', 'page-timers'].includes(detail.kind)) entry.diagnostic.kind = detail.kind;
        if (['result', 'invalid-result', 'api-rejected', 'watchdog-expired'].includes(detail.status)) entry.diagnostic.status = detail.status;
        if (typeof detail.firstMs === 'number' && Number.isFinite(detail.firstMs)) {
          entry.diagnostic.firstMs = Math.round(Math.max(0, Math.min(120000, detail.firstMs)));
        }
        for (const key of ['hidden', 'ok', 'allowed']) {
          if (typeof detail[key] === 'boolean') entry.diagnostic[key] = detail[key];
        }
      }
    }
    output.push(entry);
  }
  return {
    format: 'agent-continue-activity', version: 4,
    extensionVersion: versionMatch?.[0] === extensionVersion ? extensionVersion : 'unknown',
    timestampMode: includeTimestamps ? 'unix-ms' : 'relative-ms',
    ...(includeTimestamps ? { exportedAt: new Date(now).toISOString() } : {}),
    excludedEntries: source.length - output.length,
    logs: output,
  };
}
