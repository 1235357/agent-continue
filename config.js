export const MAX_PROMPT_CHARS = 100000;
export const MAX_QUEUE_CHARS = 600000;
export const DEFAULT_CONFIG = Object.freeze({
  intervalMinutes: 20,
  prompt: '',
  promptSource: 'manual',
  maxSends: 0,
  stopMarkers: Object.freeze([]),
  preventDiscard: true,
  keepAwake: false,
  waitForIdle: true,
  startImmediately: false,
  mode: 'repeat',
  scheduleMode: 'interval',
  queue: Object.freeze([]),
  quietHours: Object.freeze({ enabled: false, start: '23:00', end: '07:00' }),
});

export function normalizeUrl(value) {
  try {
    const url = new URL(value);
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch { return ''; }
}

export function validateTarget(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com' || url.port) return false;
    return /^\/(?:g\/[^/]+\/)?c\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
      || /^\/dots\/(?:home|[A-Za-z0-9_-]+(?:~[A-Za-z0-9_-]+)?)\/?$/.test(url.pathname);
  } catch { return false; }
}

export function readConfig(value = {}, { allowEmpty = false } = {}) {
  const intervalMinutes = Number(value.intervalMinutes ?? DEFAULT_CONFIG.intervalMinutes);
  const maxSends = Number(value.maxSends ?? DEFAULT_CONFIG.maxSends);
  // Validate whitespace without changing the user's original prompt.
  const prompt = String(value.prompt ?? DEFAULT_CONFIG.prompt);
  const markerInput = value.stopMarkers ?? DEFAULT_CONFIG.stopMarkers;
  if (!Array.isArray(markerInput) || markerInput.length > 20 || markerInput.some(marker => typeof marker !== 'string' || marker.length > 100 || /[\r\n]/.test(marker))) {
    throw new Error('停止标记最多 20 条，每条最多 100 个字符，且不能包含换行。');
  }
  const stopMarkers = [...new Set(markerInput.map(marker => marker.trim()).filter(Boolean))];
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 10080) throw new Error('发送间隔必须为 1 至 10080 分钟。');
  if (!Number.isInteger(maxSends) || maxSends < 0 || maxSends > 1000000) throw new Error('发送上限必须是 0 至 1000000 的整数；0 表示不限。');
  if (prompt.length > MAX_PROMPT_CHARS) throw new Error('单条提示词最多 100000 个字符。');
  const mode = value.mode ?? DEFAULT_CONFIG.mode;
  const scheduleMode = value.scheduleMode ?? DEFAULT_CONFIG.scheduleMode;
  if (!['repeat', 'queue-loop', 'queue-once'].includes(mode)) throw new Error('请选择有效的重复或队列模式。');
  if (!['interval', 'after-reply'].includes(scheduleMode)) throw new Error('请选择有效的计时方式。');
  const queueInput = value.queue ?? [];
  if (!Array.isArray(queueInput) || queueInput.length > 50) throw new Error('队列最多包含 50 条提示词。');
  const queue = queueInput.map((item, index) => {
    if (!item || typeof item.text !== 'string' || !item.text.trim() || item.text.length > MAX_PROMPT_CHARS) throw new Error('队列中每条提示词须为 1 至 100000 个字符。');
    return { name: String(item.name || `提示词 ${index + 1}`).slice(0, 100), text: item.text };
  });
  if (queue.reduce((n, item) => n + item.text.length, 0) > MAX_QUEUE_CHARS) throw new Error('队列总长度最多 600000 个字符，请分批导入。');
  if (!allowEmpty && ((mode === 'repeat' && !prompt.trim()) || (mode !== 'repeat' && !queue.length))) throw new Error(mode === 'repeat' ? '请先输入或导入提示词。' : '请先向队列添加提示词。');
  const booleans = {};
  for (const key of ['preventDiscard', 'keepAwake', 'waitForIdle', 'startImmediately']) {
    const item = value[key] ?? DEFAULT_CONFIG[key];
    if (typeof item !== 'boolean') throw new Error('开关设置必须为布尔值。');
    booleans[key] = item;
  }
  const quiet = value.quietHours ?? DEFAULT_CONFIG.quietHours;
  if (!quiet || typeof quiet.enabled !== 'boolean' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.end)) throw new Error('静默时段须为有效的本地时间。');
  if (quiet.enabled && quiet.start === quiet.end) throw new Error('静默时段的开始与结束不能相同。');
  const promptSource = ['manual', 'file', 'private-file', 'template'].includes(value.promptSource) ? value.promptSource : 'manual';
  return { intervalMinutes, prompt, promptSource, maxSends, stopMarkers, ...booleans, mode, scheduleMode, queue, quietHours: { enabled: quiet.enabled, start: quiet.start, end: quiet.end } };
}

export function currentPrompt(job) {
  return job.mode === 'repeat' ? job.prompt : job.queue[job.queueIndex % job.queue.length]?.text || '';
}

export function inQuietHours(config, now = Date.now()) {
  const quiet = config.quietHours;
  if (!quiet?.enabled) return false;
  const date = new Date(now);
  const minutes = date.getHours() * 60 + date.getMinutes();
  const toMinutes = value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
  const start = toMinutes(quiet.start), end = toMinutes(quiet.end);
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}
