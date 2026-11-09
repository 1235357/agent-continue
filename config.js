import { createTranslator } from './i18n.js';
import runtimeCatalog from './i18n-runtime.js';

const t = createTranslator(runtimeCatalog);

// Stored records from 0.2.0 did not distinguish the old waiting default from a
// deliberate choice. Versioned records preserve choices made after the change.
export const DELIVERY_BEHAVIOR_VERSION = 1;
export const DEFAULT_CONFIG = Object.freeze({
  deliveryBehaviorVersion: DELIVERY_BEHAVIOR_VERSION,
  intervalMinutes: 20,
  prompt: '',
  promptSource: 'manual',
  maxSends: 0,
  stopMarkers: Object.freeze([]),
  preventDiscard: true,
  keepAwake: false,
  waitForIdle: false,
  extensionPriority: true,
  sendMethod: 'auto',
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
  const prompt = value.prompt === undefined ? DEFAULT_CONFIG.prompt : value.prompt;
  if (typeof prompt !== 'string') throw new Error(t('提示词必须是文本。'));
  const markerInput = value.stopMarkers ?? DEFAULT_CONFIG.stopMarkers;
  if (!Array.isArray(markerInput) || markerInput.length > 20 || markerInput.some(marker => typeof marker !== 'string' || marker.length > 100 || /[\r\n]/.test(marker))) {
    throw new Error(t('停止标记最多 20 条，每条最多 100 个字符，且不能包含换行。'));
  }
  const stopMarkers = [...new Set(markerInput.map(marker => marker.trim()).filter(Boolean))];
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 10080) throw new Error(t('发送间隔必须为 1 至 10080 分钟。'));
  if (!Number.isInteger(maxSends) || maxSends < 0 || maxSends > 1000000) throw new Error(t('发送上限必须是 0 至 1000000 的整数；0 表示不限。'));
  const mode = value.mode ?? DEFAULT_CONFIG.mode;
  const scheduleMode = value.scheduleMode ?? DEFAULT_CONFIG.scheduleMode;
  const sendMethod = value.sendMethod ?? DEFAULT_CONFIG.sendMethod;
  if (!['repeat', 'queue-loop', 'queue-once'].includes(mode)) throw new Error(t('请选择有效的重复或队列模式。'));
  if (!['interval', 'after-reply'].includes(scheduleMode)) throw new Error(t('请选择有效的计时方式。'));
  if (!['auto', 'ctrl-enter', 'button'].includes(sendMethod)) throw new Error(t('请选择有效的发送方式。'));
  const queueInput = value.queue ?? [];
  if (!Array.isArray(queueInput) || queueInput.length > 50) throw new Error(t('队列最多包含 50 条提示词。'));
  const queue = queueInput.map((item, index) => {
    if (!item || typeof item.text !== 'string' || !item.text.trim()) throw new Error(t('队列提示词必须是非空文本。'));
    return { name: String(item.name || `提示词 ${index + 1}`).slice(0, 100), text: item.text };
  });
  if (!allowEmpty && ((mode === 'repeat' && !prompt.trim()) || (mode !== 'repeat' && !queue.length))) throw new Error(mode === 'repeat' ? t('请先输入或导入提示词。') : t('请先向队列添加提示词。'));
  const booleans = {};
  for (const key of ['preventDiscard', 'keepAwake', 'waitForIdle', 'startImmediately', 'extensionPriority']) {
    const item = value[key] ?? DEFAULT_CONFIG[key];
    if (typeof item !== 'boolean') throw new Error(t('开关设置必须为布尔值。'));
    // Keep validating the legacy key, but it can no longer disable delivery.
    booleans[key] = key === 'extensionPriority' ? true : item;
  }
  const quiet = value.quietHours ?? DEFAULT_CONFIG.quietHours;
  if (!quiet || typeof quiet.enabled !== 'boolean' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.end)) throw new Error(t('静默时段须为有效的本地时间。'));
  if (quiet.enabled && quiet.start === quiet.end) throw new Error(t('静默时段的开始与结束不能相同。'));
  const promptSource = ['manual', 'file', 'private-file', 'template'].includes(value.promptSource) ? value.promptSource : 'manual';
  return { deliveryBehaviorVersion: DELIVERY_BEHAVIOR_VERSION, intervalMinutes, prompt, promptSource, maxSends, stopMarkers, ...booleans, sendMethod, mode, scheduleMode, queue, quietHours: { enabled: quiet.enabled, start: quiet.start, end: quiet.end } };
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
