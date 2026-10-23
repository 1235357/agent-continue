import { DEFAULT_CONFIG, DELIVERY_BEHAVIOR_VERSION, normalizeUrl, validateTarget, readConfig, currentPrompt, inQuietHours, MAX_PROMPT_CHARS } from './config.js';
import { pageAction } from './adapter.js';
import { BUNDLED_PROMPT } from './preset.js';

const ALARM_NAME = 'agent-continue-heartbeat';
const RETRY_MS = 60_000;
// Leave room for a Stop -> composer replacement -> Send -> receipt transition.
const EXECUTION_MS = 20_000;
const RESULT_STATUSES = new Set(['ready', 'sent', 'busy', 'draft', 'done', 'blocked', 'cancelled', 'unknown', 'error']);
let stateQueue = Promise.resolve();
let intentVersion = 0;
let pendingActivationVersion = null;

function transact(callback) {
  const work = stateQueue.then(callback, callback);
  stateQueue = work.catch(() => undefined);
  return work;
}
const token = () => crypto.randomUUID();
// Exceptions may contain browser/page data. Only our fixed messages enter logs.
const errorMessage = error => error?.safeMessage || '操作未完成，请检查目标页面和扩展权限后再试。';
function fail(message) { const error = new Error(message); error.safeMessage = message; return error; }

async function getJob() { return (await chrome.storage.session.get('job')).job || null; }
async function getConfig() {
  try { return readConfig((await chrome.storage.local.get('config')).config, { allowEmpty: true }); }
  catch { return { ...DEFAULT_CONFIG }; }
}
async function setJob(job) {
  if (job) {
    // Session state is the cancellation authority. Persistent state is only a
    // recovery plan; tab IDs from a previous browser session are never trusted.
    await chrome.storage.session.set({ job });
    await chrome.storage.local.set({ resumeJob: job });
  } else {
    await chrome.storage.session.remove('job');
    await chrome.storage.local.remove('resumeJob');
  }
}
async function logEvent(event, message) {
  const logs = (await chrome.storage.local.get('logs')).logs || [];
  await chrome.storage.local.set({ logs: [...logs.slice(-199), { at: Date.now(), event, message }] });
}
async function updateBadge(job) {
  try {
    await chrome.action.setBadgeText({ text: !job ? '' : !job.enabled ? 'Ⅱ' : job.phase === 'sending' ? '…' : job.needsAttention ? '!' : 'ON' });
    await chrome.action.setBadgeBackgroundColor({ color: !job?.enabled ? '#64748B' : job.needsAttention ? '#B45F2A' : '#156C52' });
    await chrome.action.setTitle({ title: job ? `Agent Continue — ${job.statusText}` : 'Agent Continue — 选择 dot 或会话后开始' });
  } catch { /* Badge errors cannot authorize a send. */ }
}
async function syncAlarm(job) {
  if (!job?.enabled) { await chrome.alarms.clear(ALARM_NAME); return; }
  if (!await chrome.alarms.get(ALARM_NAME)) await chrome.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: 1 });
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
  if (!job?.autoDiscardableChanged || typeof job.originalAutoDiscardable !== 'boolean') return;
  try { await chrome.tabs.update(job.tabId, { autoDiscardable: job.originalAutoDiscardable }); } catch { /* Closed target. */ }
}
async function pauseLocked(job, message, event = 'paused') {
  if (!job) { await syncAlarm(null); await syncPower(null); await updateBadge(null); return null; }
  const paused = { ...job, enabled: false, runId: token(), runDeadline: null, phase: 'idle', nextAt: null, statusText: message, autoDiscardableChanged: false, discardProtection: 'paused', systemAwake: false, needsAttention: false };
  await setJob(paused); // revoke before housekeeping
  await syncAlarm(paused);
  await syncPower(paused);
  await restoreDiscard(job);
  await logEvent(event, message);
  await updateBadge(paused);
  return paused;
}
async function pause(message = '已手动暂停；后续定时发送已停止。') {
  return transact(async () => ({ ok: true, job: await pauseLocked(await getJob(), message) }));
}
function assertIntent(version) { if (version !== intentVersion) throw fail('此操作已被较新的开始或暂停操作取消。'); }
function assertSupportedTab(tab, expectedUrl = null) {
  if (!tab || !Number.isInteger(tab.id) || !validateTarget(tab.url)) throw fail('请选择 chatgpt.com 的 Your dot 页面或已有会话；首页与共享页面不支持。');
  if (expectedUrl && normalizeUrl(tab.url) !== expectedUrl) throw fail('目标标签页已切换到其他会话；原任务会等待原地址重新打开。');
}
async function executePage(args, tabId, deadline = Date.now() + EXECUTION_MS) {
  let timer;
  try {
    const result = await Promise.race([
      chrome.scripting.executeScript({ target: { tabId }, func: pageAction, args: [args] }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(fail('页面操作超时，本周期结果未确认。')), Math.max(1, deadline - Date.now())); }),
    ]);
    const value = result?.find(frame => frame.frameId === 0)?.result ?? result?.[0]?.result;
    if (!value || !RESULT_STATUSES.has(value.status)) return { status: 'unknown', message: '页面未返回可确认的结果。' };
    // These values originate only in our isolated adapter. Never return page text.
    return { status: value.status, message: String(value.message || '').slice(0, 300), identity: typeof value.identity === 'string' ? value.identity.slice(0, 500) : null, assistantToken: typeof value.assistantToken === 'string' ? value.assistantToken.slice(0, 500) : null, assistantCount: Number(value.assistantCount) || 0 };
  } finally { clearTimeout(timer); }
}
async function probe(tab, config, targetIdentity = null) {
  assertSupportedTab(tab);
  if (tab.discarded || tab.frozen) return { status: 'busy', message: '目标标签页已休眠或冻结，等待页面恢复。' };
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
function validatedConfig(input) {
  try { return readConfig(input); } catch (error) { throw fail(error.message); }
}
async function start(configInput, version, tabId) {
  const config = validatedConfig(configInput || await getConfig());
  await transact(async () => {
    assertIntent(version);
    const old = await getJob();
    if (old?.enabled) await pauseLocked(old, '正在绑定新的目标，原任务已替换。', 'replaced');
  });
  const tab = await currentTab(tabId);
  assertSupportedTab(tab);
  const result = await probe(tab, config);
  if (!['ready', 'busy', 'draft'].includes(result.status)) throw fail(result.message || '页面暂时无法启用自动发送。');
  if (new URL(tab.url).pathname.startsWith('/dots/') && !result.identity) throw fail('请先打开 dot 页面并等待会话历史加载，再绑定任务。');
  const response = await transact(async () => {
    assertIntent(version);
    const latestTab = await chrome.tabs.get(tab.id);
    assertSupportedTab(latestTab, normalizeUrl(tab.url));
    const protection = await protectFromDiscard(latestTab, config.preventDiscard);
    const now = Date.now();
    const job = { ...config, id: token(), runId: token(), enabled: true, tabId: latestTab.id, url: normalizeUrl(latestTab.url), title: latestTab.title || 'ChatGPT / dot', targetIdentity: result.identity, sentCount: 0, unknownCount: 0, queueIndex: 0, nextAt: now + (config.startImmediately ? 0 : config.intervalMinutes * 60_000), lastRunAt: null, runDeadline: null, phase: 'idle', awaitingReply: false, assistantToken: null, assistantCount: 0, needsAttention: false, statusText: config.startImmediately ? '已开始，即将进行首次后台检查。' : `持续运行中；约 ${config.intervalMinutes} 分钟后首次检查。`, ...protection };
    job.systemAwake = await syncPower(job);
    await chrome.storage.local.set({ config });
    await setJob(job);
    try { await syncAlarm(job); } catch { await pauseLocked(job, '后台计时器不可用，未启动任务。', 'scheduler-error'); throw fail('无法创建后台计时器。'); }
    await logEvent('started', `开始任务，间隔 ${config.intervalMinutes} 分钟，${config.maxSends ? `上限 ${config.maxSends} 次` : '不限次数'}。`);
    await updateBadge(job);
    return { ok: true, job };
  });
  if (config.startImmediately) return runRound(true, response.job.id);
  return response;
}
async function resume(version) {
  const snapshot = await transact(async () => {
    assertIntent(version);
    const job = await getJob();
    if (!job) throw fail('请先绑定 dot 或会话。');
    if (job.maxSends > 0 && job.sentCount >= job.maxSends) throw fail('已达到所设上限；请开始新任务。');
    if (job.mode === 'queue-once' && job.queueIndex >= job.queue.length) throw fail('队列已完成；请开始新任务。');
    return job;
  });
  if (snapshot.enabled) return { ok: true, job: snapshot };
  return transact(async () => {
    assertIntent(version);
    const current = await getJob();
    if (!current || current.id !== snapshot.id) throw fail('目标任务已改变，请刷新面板。');
    let protection = {};
    try { const tab = await chrome.tabs.get(current.tabId); if (normalizeUrl(tab.url) === current.url) protection = await protectFromDiscard(tab, current.preventDiscard); } catch { /* Wait for original page. */ }
    const job = { ...current, ...protection, enabled: true, runId: token(), runDeadline: null, phase: 'idle', nextAt: Date.now() + current.intervalMinutes * 60_000, needsAttention: false, statusText: `已继续原任务；约 ${current.intervalMinutes} 分钟后检查。` };
    job.systemAwake = await syncPower(job);
    await setJob(job);
    await syncAlarm(job);
    await logEvent('resumed', '已使用原提示词与原设置继续任务。');
    await updateBadge(job);
    return { ok: true, job };
  });
}
async function checkRun(runId, sender) {
  return transact(async () => {
    const job = await getJob();
    return { ok: true, allowed: Boolean(job?.enabled && job.phase === 'sending' && job.runId === runId && Date.now() < job.runDeadline && sender.tab?.id === job.tabId && sender.frameId === 0 && normalizeUrl(sender.url || sender.tab?.url) === job.url) };
  });
}
async function runStillCurrent(snapshot) {
  return transact(async () => { const job = await getJob(); return Boolean(job?.enabled && job.phase === 'sending' && job.id === snapshot.id && job.runId === snapshot.runId && Date.now() < job.runDeadline); });
}
async function resolveTarget(snapshot) {
  let tab;
  try { tab = await chrome.tabs.get(snapshot.tabId); } catch { /* Re-resolve by exact URL below. */ }
  if (!tab || normalizeUrl(tab.url) !== snapshot.url) {
    const matches = (await chrome.tabs.query({ url: 'https://chatgpt.com/*' })).filter(item => normalizeUrl(item.url) === snapshot.url);
    if (matches.length !== 1) return { status: 'busy', message: matches.length ? '找到多个相同目标页，等待只保留一个或重新绑定。' : '等待原目标页面重新打开；任务仍保持启用。' };
    tab = matches[0];
  }
  if (snapshot.tabId !== tab.id) {
    const changed = await transact(async () => {
      const current = await getJob();
      if (!current?.enabled || current.runId !== snapshot.runId) return false;
      await restoreDiscard(current);
      const protection = await protectFromDiscard(tab, current.preventDiscard);
      Object.assign(snapshot, protection, { tabId: tab.id });
      await setJob({ ...current, ...protection, tabId: tab.id });
      return true;
    });
    if (!changed) return { status: 'cancelled', message: '本次检查已取消。' };
  }
  return { tab };
}
async function finishRound(snapshot, result) {
  return transact(async () => {
    const current = await getJob();
    if (!current || current.id !== snapshot.id || current.runId !== snapshot.runId || !current.enabled || current.phase !== 'sending') return { ok: true, job: current };
    const now = Date.now();
    const job = { ...current, phase: 'idle', runKind: null, runDeadline: null, needsAttention: false };
    if (result.identity && !job.targetIdentity) job.targetIdentity = result.identity;
    if (result.status === 'sent') {
      job.sentCount += 1;
      if (job.mode !== 'repeat') job.queueIndex += 1;
      if (job.maxSends > 0 && job.sentCount >= job.maxSends) return { ok: true, job: await pauseLocked(job, `已确认发送 ${job.sentCount} 次，达到你设置的上限。`, 'limit-reached') };
      if (job.mode === 'queue-once' && job.queueIndex >= job.queue.length) return { ok: true, job: await pauseLocked(job, '队列已全部发送，按单次队列设置结束。', 'queue-complete') };
      if (job.mode === 'queue-loop') job.queueIndex %= job.queue.length;
      job.awaitingReply = job.scheduleMode === 'after-reply';
      job.assistantToken = result.assistantToken;
      job.assistantCount = result.assistantCount;
      job.nextAt = now + (job.awaitingReply ? RETRY_MS : job.intervalMinutes * 60_000);
      job.statusText = job.awaitingReply ? '已确认发送，等待 Agent 回复完成后开始下一间隔。' : `已确认发送 ${job.sentCount} 次；约 ${job.intervalMinutes} 分钟后继续。`;
      await logEvent('sent', '已在目标会话确认新消息。');
    } else if (result.status === 'reply-complete') {
      job.awaitingReply = false;
      job.nextAt = now + job.intervalMinutes * 60_000;
      job.statusText = `检测到新的回复已结束；约 ${job.intervalMinutes} 分钟后发送下一条。`;
      await logEvent('reply-complete', '新的回复已结束，开始下一发送间隔。');
    } else if (['busy', 'draft', 'blocked', 'error'].includes(result.status)) {
      job.nextAt = now + RETRY_MS;
      job.needsAttention = ['blocked', 'error'].includes(result.status);
      job.statusText = (result.message || '页面暂不可用。') + ' 一分钟后再检查，任务仍保持启用。';
      if (current.lastResult !== result.status) await logEvent(result.status, result.status === 'draft' ? '保留现有草稿或附件，等待输入框空闲。' : result.status === 'busy' ? '目标暂忙或未就绪，延后检查。' : '页面暂不可用，保持启用并等待恢复。');
    } else if (result.status === 'done') {
      return { ok: true, job: await pauseLocked(job, '检测到你设置的停止标记，按设置暂停。', 'marker-reached') };
    } else {
      // A missed/uncertain cycle is never replayed immediately. In repeat mode
      // the next scheduled cycle remains enabled, as explicitly requested.
      job.unknownCount = (job.unknownCount || 0) + 1;
      job.nextAt = now + job.intervalMinutes * 60_000;
      job.awaitingReply = false;
      job.needsAttention = true;
      job.statusText = '本周期提交结果未确认；本周期不重试，完整间隔后继续。请检查页面记录。';
      await logEvent('unconfirmed', '本周期结果未知；未立即重试，将在下一正常周期继续。');
    }
    job.lastResult = result.status;
    await setJob(job);
    await syncAlarm(job);
    await updateBadge(job);
    return { ok: true, job };
  });
}
async function runRound(force = false, expectedJobId = null) {
  const claim = await transact(async () => {
    const job = await getJob();
    if (expectedJobId && job?.id !== expectedJobId) return { job, claimed: false };
    if (!job?.enabled) { await syncAlarm(job); if (force) throw fail('请先开始或继续任务。'); return { job, claimed: false }; }
    if (job.phase !== 'idle') { if (force) throw fail('本次检查尚未结束。'); return { job, claimed: false }; }
    if (!force && Date.now() < job.nextAt) return { job, claimed: false };
    if (inQuietHours(job)) {
      const waiting = { ...job, nextAt: Date.now() + RETRY_MS, statusText: '处于你设置的静默时段；任务保持启用，时段结束后继续。' };
      await setJob(waiting); await updateBadge(waiting); return { job: waiting, claimed: false };
    }
    if (job.maxSends > 0 && job.sentCount >= job.maxSends) return { job: await pauseLocked(job, '已达到你设置的发送上限。', 'limit-reached'), claimed: false };
    const snapshot = { ...job, phase: 'sending', runKind: job.awaitingReply && !force ? 'reply-check' : 'send', runId: token(), runDeadline: Date.now() + EXECUTION_MS, lastRunAt: Date.now(), statusText: '正在后台检查目标页面…' };
    await setJob(snapshot); await updateBadge(snapshot); return { job: snapshot, claimed: true };
  });
  if (!claim.claimed) return { ok: true, job: claim.job };
  const snapshot = claim.job;
  let result;
  try {
    const resolved = await resolveTarget(snapshot);
    if (!resolved.tab) result = resolved;
    else if (!await runStillCurrent(snapshot)) result = { status: 'cancelled' };
    else if (resolved.tab.frozen || resolved.tab.discarded) result = { status: 'busy', message: '目标标签已冻结或休眠，请设置网站始终保持活动。' };
    else if (snapshot.awaitingReply && !force) {
      result = await probe(resolved.tab, { ...snapshot, waitForIdle: true }, snapshot.targetIdentity);
      if (['unknown', 'cancelled'].includes(result.status)) result = { status: 'error', message: '回复检查暂不可用，继续等待新回复。' };
      const changed = result.assistantToken ? result.assistantToken !== snapshot.assistantToken : result.assistantCount > snapshot.assistantCount;
      if (result.status === 'ready') result = changed ? { status: 'reply-complete' } : { status: 'busy', message: '等待新的 Agent 回复完成。' };
    } else {
      result = await executePage({ mode: 'send', expectedUrl: snapshot.url, prompt: currentPrompt(snapshot), runId: snapshot.runId, runDeadline: snapshot.runDeadline, stopMarkers: snapshot.stopMarkers ?? [], waitForIdle: snapshot.waitForIdle ?? false, sendMethod: snapshot.sendMethod ?? 'auto', targetIdentity: snapshot.targetIdentity }, snapshot.tabId, snapshot.runDeadline);
    }
  } catch { result = snapshot.runKind === 'reply-check' ? { status: 'error', message: '回复检查暂不可用，继续等待新回复。' } : { status: 'unknown', message: '后台页面操作未确认。' }; }
  return finishRound(snapshot, result);
}
async function initializePrivatePreset() {
  if (!BUNDLED_PROMPT) return;
  const imported = (await chrome.storage.local.get('privatePresetImported')).privatePresetImported;
  if (imported) return;
  try {
    const response = await fetch(chrome.runtime.getURL('private/prompt.txt'));
    if (!response.ok) return;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 5 * 1024 * 1024) return;
    let text;
    const view = new Uint8Array(bytes);
    if (view[0] === 0xff && view[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes);
    else if (view[0] === 0xfe && view[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes);
    else { try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = new TextDecoder('gb18030', { fatal: true }).decode(bytes); } }
    if (!text.trim() || text.length > MAX_PROMPT_CHARS) return;
    // No telemetry, hashing, console output, preview or automatic submission.
    await chrome.storage.local.set({ config: { ...DEFAULT_CONFIG, prompt: text, promptSource: 'private-file' }, privatePresetImported: true });
  } catch { /* User can still import through the local file picker. */ }
}
async function initialize() {
  try { await chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }); } catch { /* Old browser. */ }
  await initializePrivatePreset();
  return transact(async () => {
    // Apply the requested interrupt default once to each legacy record. A
    // record-local version survives partial storage writes and never resets a
    // waiting preference explicitly selected in this or a later release.
    const migrateDelivery = value => value && value.deliveryBehaviorVersion !== DELIVERY_BEHAVIOR_VERSION
      ? { ...value, waitForIdle: false, deliveryBehaviorVersion: DELIVERY_BEHAVIOR_VERSION } : value;
    const storedConfig = (await chrome.storage.local.get('config')).config;
    const saved = (await chrome.storage.local.get('resumeJob')).resumeJob;
    const config = migrateDelivery(storedConfig);
    const recovery = migrateDelivery(saved);
    const updates = {};
    if (config !== storedConfig) updates.config = config;
    if (recovery !== saved) updates.resumeJob = recovery;
    if (Object.keys(updates).length) await chrome.storage.local.set(updates);
    let job = migrateDelivery(await getJob());
    if (!job) {
      if (recovery) {
        // Rebind only to an exact URL; additionally require the dot conversation
        // identity captured from visible message elements, when available.
        job = { ...recovery, tabId: null, runId: token(), runDeadline: null, autoDiscardableChanged: false, discardProtection: 'pending' };
        await logEvent('browser-restored', '已恢复任务设置；等待唯一匹配的原目标页面。');
      }
    }
    if (job?.phase === 'sending') {
      const readOnly = job.runKind === 'reply-check';
      job = { ...job, phase: 'idle', runKind: null, runId: token(), runDeadline: null, awaitingReply: readOnly ? job.awaitingReply : false, unknownCount: (job.unknownCount || 0) + (readOnly ? 0 : 1), nextAt: Date.now() + (readOnly ? RETRY_MS : job.intervalMinutes * 60_000), statusText: readOnly ? '回复检查被中断；恢复后继续等待新回复。' : '上周期执行被中断；完整间隔后继续，未立即重发。', needsAttention: !readOnly };
      await logEvent('interrupted', readOnly ? '只读回复检查被中断；仍等待新回复。' : '后台执行被中断；延后到下一完整周期。');
    }
    if (job) { job.systemAwake = await syncPower(job); await setJob(job); }
    else await syncPower(null);
    await syncAlarm(job); await updateBadge(job);
  });
}
const initialized = initialize();
async function dispatch(message, sender, version) {
  await initialized;
  if (!message || typeof message.type !== 'string') throw fail('无效请求。');
  const ownExtensionPage = chrome.runtime.id && sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
  if (message.type !== 'CHECK_RUN' && sender.tab && !ownExtensionPage) throw fail('此操作只能从扩展控制面板发起。');
  switch (message.type) {
    case 'GET_STATE': return transact(async () => ({ ok: true, job: await getJob(), config: await getConfig(), logs: (await chrome.storage.local.get('logs')).logs || [], availableTargets: await availableTargets() }));
    case 'CHECK_PAGE': return checkPage(message.tabId);
    case 'CHECK_RUN': return checkRun(message.runId, sender);
    case 'START': return start(message.config, version, message.tabId);
    case 'PAUSE': return pause();
    case 'RESUME': return resume(version);
    case 'SEND_NOW': return runRound(true);
    case 'CLEAR_LOGS': return transact(async () => { await chrome.storage.local.remove('logs'); return { ok: true }; });
    case 'CLEAR_DATA': return transact(async () => {
      await pauseLocked(await getJob(), '已停止任务并清除本地数据。');
      await setJob(null);
      for (const key of ['config', 'logs', 'templates', 'uiTheme']) await chrome.storage.local.remove(key);
      // Do not silently reimport a personal bundle after an explicit clear.
      if (BUNDLED_PROMPT) await chrome.storage.local.set({ privatePresetImported: true });
      return { ok: true };
    });
    default: throw fail('不支持的操作。');
  }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let version = intentVersion;
  if (['START', 'PAUSE', 'RESUME', 'CLEAR_DATA'].includes(message?.type)) { version = ++intentVersion; pendingActivationVersion = ['START', 'RESUME'].includes(message.type) ? version : null; }
  dispatch(message, sender, version).then(sendResponse).catch(error => sendResponse({ ok: false, error: errorMessage(error) })).finally(() => {
    if (pendingActivationVersion === version && ['START', 'RESUME'].includes(message?.type)) pendingActivationVersion = null;
  });
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== ALARM_NAME) return;
  initialized.then(() => runRound(false)).catch(() => undefined);
});
chrome.tabs.onRemoved.addListener(tabId => {
  initialized.then(() => transact(async () => {
    const job = await getJob();
    if (job?.tabId !== tabId) return;
    const interrupted = job.phase === 'sending' && job.runKind !== 'reply-check';
    const waiting = { ...job, tabId: null, runId: token(), runDeadline: null, phase: 'idle', runKind: null, awaitingReply: interrupted ? false : job.awaitingReply, unknownCount: (job.unknownCount || 0) + (interrupted ? 1 : 0), nextAt: job.enabled ? Math.max(job.nextAt || 0, Date.now() + (interrupted ? job.intervalMinutes * 60_000 : RETRY_MS)) : null, autoDiscardableChanged: false, discardProtection: 'pending', statusText: interrupted ? '发送期间目标关闭，结果未确认；完整间隔后检查原页面。' : '目标标签已关闭；任务保持原启用状态，等待原页面重新打开。' };
    if (interrupted) await logEvent('interrupted', '发送期间目标关闭，等待下一完整周期。');
    await setJob(waiting); await updateBadge(waiting);
  })).catch(() => undefined);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  initialized.then(() => transact(async () => {
    const job = await getJob();
    if (!job?.enabled || job.tabId !== tabId) return;
    let tab;
    try { tab = await chrome.tabs.get(tabId); } catch { return; }
    if (normalizeUrl(tab.url) === job.url) return;
    await restoreDiscard(job);
    const interrupted = job.phase === 'sending' && job.runKind !== 'reply-check';
    const waiting = { ...job, tabId: null, runId: token(), runDeadline: null, phase: 'idle', runKind: null, awaitingReply: interrupted ? false : job.awaitingReply, unknownCount: (job.unknownCount || 0) + (interrupted ? 1 : 0), nextAt: Math.max(job.nextAt || 0, Date.now() + (interrupted ? job.intervalMinutes * 60_000 : RETRY_MS)), autoDiscardableChanged: false, discardProtection: 'pending', statusText: interrupted ? '发送期间页面改变，结果未确认；完整间隔后检查原地址。' : '原目标页面已离开；等待原地址重新打开，不会给其他会话发送。' };
    if (interrupted) await logEvent('interrupted', '发送期间目标改变，等待下一完整周期。');
    await setJob(waiting); await updateBadge(waiting);
  })).catch(() => undefined);
});
chrome.commands.onCommand.addListener(command => {
  if (command !== 'toggle-running') return;
  const activationWasPending = pendingActivationVersion === intentVersion;
  const version = ++intentVersion;
  pendingActivationVersion = null;
  (async () => {
    await initialized;
    const job = await transact(getJob);
    if (activationWasPending || job?.enabled) await pause();
    else if (job) { pendingActivationVersion = version; await resume(version); }
  })().catch(() => undefined).finally(() => { if (pendingActivationVersion === version) pendingActivationVersion = null; });
});
