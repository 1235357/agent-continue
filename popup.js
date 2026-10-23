import { DEFAULT_CONFIG, readConfig } from './config.js';
import { importPromptFile, SUPPORTED_ACCEPT, MAX_PROMPT_CHARS } from './file-import.js';

const $ = id => document.getElementById(id);
const clone = value => structuredClone(value);
const request = message => chrome.runtime.sendMessage(message);
const fallbackConfig = {
  ...DEFAULT_CONFIG, intervalMinutes: DEFAULT_CONFIG.intervalMinutes ?? 20,
  mode: 'repeat', queue: [], scheduleMode: 'interval', keepAwake: false,
  startImmediately: false, waitForIdle: false, sendMethod: 'auto',
  quietHours: { enabled: false, start: '23:00', end: '07:00' },
};
const normalized = value => ({ ...clone(fallbackConfig), ...clone(value || {}),
  queue: Array.isArray(value?.queue) ? clone(value.queue) : [],
  quietHours: { ...fallbackConfig.quietHours, ...(value?.quietHours || {}) },
});
const parameters = new URLSearchParams(location.search);
const fullView = parameters.get('view') === 'full';
const initialTabId = Number(parameters.get('targetTabId'));
let selectedTabId = Number.isInteger(initialTabId) && initialTabId > 0 ? initialTabId : null;
let latestJob = null;
let draftConfig = normalized();
let loaded = false;
let pendingAction = null;
let actionSequence = 0;
let importing = false;
let contentEpoch = 0;
let saveTimer;
let revealed = false;
let queueEditing = null;
let templates = [];
let logs = [];
let targets = [];
let activePanel = 'task';
let targetSignature = '';
let queueSignature = '';
let currentSourceIdentity = null;
const configFields = ['interval', 'maxSends', 'stopMarkers', 'preventDiscard', 'mode',
  'scheduleMode', 'startImmediately', 'waitForIdle', 'sendMethod', 'quietEnabled', 'quietStart', 'quietEnd'];
const editableButtons = ['importPrompt', 'importQueue', 'addToQueue', 'loadTemplate', 'deleteTemplate',
  'saveTemplate', 'importConfig', 'saveQueueItem'];
const eventLabels = {
  started: '任务已开始', start: '任务已开始', resumed: '已继续', resume: '已继续',
  paused: '已暂停', pause: '已暂停', sent: '发送已确认', busy: '等待 Agent',
  draft: '保留已有草稿', unknown: '本轮结果未知', blocked: '等待页面可用',
  error: '本轮未完成', restored: '已恢复任务', recovered: '已恢复任务',
  unconfirmed: '本轮结果未知', 'reply-complete': '回复已结束', 'limit-reached': '达到次数上限',
  'queue-complete': '队列已完成', 'marker-reached': '匹配停止标记', 'target-closed': '等待目标重开',
  quiet: '静默时段', skipped: '本轮跳过', done: '达到停止条件', stopped: '任务已停止',
};

if (fullView) document.body.classList.add('full');
$('promptFile').accept = SUPPORTED_ACCEPT;
$('queueFiles').accept = SUPPORTED_ACCEPT;
$('prompt').maxLength = MAX_PROMPT_CHARS || 100000;
$('queueText').maxLength = MAX_PROMPT_CHARS || 100000;

function tell(message, error = false) {
  $('feedback').textContent = message;
  $('feedback').classList.toggle('error', error);
}
function safeFailure(error, fallback = '操作未完成，请重试。') {
  // Our parser and background return content-free errors. Never stringify an
  // imported object or include file text/name in diagnostics.
  return typeof error?.message === 'string' && error.message.length < 600 ? error.message : fallback;
}
function canEdit() { return loaded && !latestJob?.enabled && !pendingAction && !importing; }
function displayedConfig() { return latestJob?.enabled ? normalized(latestJob.config || latestJob) : draftConfig; }
function setField(id, value) { if ($(id).value !== String(value ?? '')) $(id).value = String(value ?? ''); }
function hidePrompt() {
  revealed = false;
  $('prompt').value = '';
  $('prompt').hidden = true;
  $('sealedPrompt').hidden = false;
  $('togglePrompt').textContent = latestJob?.enabled ? '显示正文（只读）' : '显示 / 编辑正文';
}
function closeQueueEditor() {
  queueEditing = null;
  $('queueText').value = '';
  $('queueName').value = '';
  $('queueEditor').hidden = true;
}
function showPanel(name, focus = false) {
  if (!['task', 'prompt', 'settings', 'logs'].includes(name)) return;
  if (activePanel === 'prompt' && name !== 'prompt') { hidePrompt(); closeQueueEditor(); }
  activePanel = name;
  for (const panel of ['task', 'prompt', 'settings', 'logs']) {
    $(`panel-${panel}`).hidden = panel !== name;
    $(`tab-${panel}`).setAttribute('aria-selected', String(panel === name));
    $(`tab-${panel}`).tabIndex = panel === name ? 0 : -1;
  }
  document.querySelector('main').scrollTop = 0;
  if (focus) $(`tab-${name}`).focus();
  if (name === 'logs') refresh();
}
function gatherConfig() {
  return {
    ...clone(draftConfig),
    intervalMinutes: Number($('interval').value),
    maxSends: Number($('maxSends').value),
    stopMarkers: $('stopMarkers').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean),
    preventDiscard: $('preventDiscard').checked,
    mode: $('mode').value,
    scheduleMode: $('scheduleMode').value,
    startImmediately: $('startImmediately').checked,
    waitForIdle: $('waitForIdle').checked,
    sendMethod: $('sendMethod').value,
    keepAwake: $('keepAwake').checked,
    quietHours: { enabled: $('quietEnabled').checked, start: $('quietStart').value, end: $('quietEnd').value },
  };
}
async function persistDraftNow() {
  clearTimeout(saveTimer);
  const snapshot = readConfig(clone(draftConfig), { allowEmpty: true });
  await chrome.storage.local.set({ config: snapshot });
}
function saveDraft() {
  const snapshot = clone(draftConfig);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    let validated;
    try { validated = readConfig(snapshot, { allowEmpty: true }); } catch { return; }
    chrome.storage.local.set({ config: validated }).catch(() => tell('本机保存失败，请检查扩展存储空间。', true));
  }, 180);
}
function onConfigurationInput() {
  if (!canEdit()) return;
  draftConfig = gatherConfig();
  saveDraft();
  paint(latestJob);
}
function renderPromptMeta(config) {
  const length = String(config.prompt || '').length;
  $('promptCount').textContent = `${length.toLocaleString()} 字符`;
  $('sealedLabel').textContent = length ? '正文已隐藏' : '还没有提示词';
  $('promptSummary').textContent = config.mode === 'repeat'
    ? length ? `正文已准备 · ${length.toLocaleString()} 字符` : '请先输入或导入提示词'
    : `队列 ${config.queue.length} 条 · ${config.mode === 'queue-loop' ? '循环发送' : '执行一遍'}`;
  $('promptLabel').textContent = latestJob?.enabled ? '当前任务的提示词' : '重复发送的提示词';
  if (revealed) {
    setField('prompt', config.prompt || '');
    $('prompt').hidden = false;
    $('sealedPrompt').hidden = true;
    $('togglePrompt').textContent = '隐藏正文';
  }
}
function renderQueue(config) {
  // Use only safe item labels and counts in DOM; prompt text stays in memory.
  const signature = JSON.stringify({ items: config.queue.map(item => [item.name, item.text.length]),
    enabled: !!latestJob?.enabled, index: latestJob?.queueIndex, editable: canEdit() });
  if (signature === queueSignature) return;
  queueSignature = signature;
  $('queueList').replaceChildren();
  $('queueCount').textContent = `${config.queue.length} / 50`;
  $('queueEmpty').hidden = config.queue.length > 0;
  config.queue.forEach((item, index) => {
    const row = document.createElement('li');
    row.className = 'queue-item';
    if (latestJob?.enabled && config.mode !== 'repeat' && latestJob.queueIndex === index) row.classList.add('current');
    const number = document.createElement('span'); number.className = 'queue-number'; number.textContent = String(index + 1).padStart(2, '0');
    const body = document.createElement('div'); body.className = 'queue-item-body';
    const name = document.createElement('span'); name.className = 'queue-item-name'; name.textContent = item.name || `提示词 ${index + 1}`;
    const count = document.createElement('span'); count.className = 'queue-item-count'; count.textContent = `${item.text.length.toLocaleString()} 字符 · 正文隐藏`;
    body.append(name, count);
    const actions = document.createElement('div'); actions.className = 'queue-actions';
    for (const [action, label, symbol] of [['up', '上移', '↑'], ['down', '下移', '↓'], ['edit', '编辑正文', '✎'], ['remove', '删除', '×']]) {
      const button = document.createElement('button');
      button.textContent = symbol; button.title = label; button.setAttribute('aria-label', `${label}第 ${index + 1} 项`);
      button.disabled = !canEdit() || (action === 'up' && index === 0) || (action === 'down' && index === config.queue.length - 1);
      button.addEventListener('click', () => queueAction(action, index)); actions.append(button);
    }
    row.append(number, body, actions); $('queueList').append(row);
  });
}
function queueAction(action, index) {
  if (!canEdit()) return;
  if (action === 'edit') {
    queueEditing = index;
    $('queueName').value = draftConfig.queue[index].name || `提示词 ${index + 1}`;
    $('queueText').value = draftConfig.queue[index].text;
    $('queueEditor').hidden = false;
    $('queueName').focus();
    return;
  }
  closeQueueEditor();
  if (action === 'remove') draftConfig.queue.splice(index, 1);
  else {
    const other = action === 'up' ? index - 1 : index + 1;
    [draftConfig.queue[index], draftConfig.queue[other]] = [draftConfig.queue[other], draftConfig.queue[index]];
  }
  queueSignature = ''; saveDraft(); paint(latestJob);
}
function renderTargets() {
  const signature = JSON.stringify(targets.map(target => [target.id, target.title, target.url]));
  if (signature !== targetSignature) {
    targetSignature = signature;
    $('targetSelect').replaceChildren();
    const current = document.createElement('option'); current.value = ''; current.textContent = fullView ? '请选择目标标签页' : '当前标签页';
    $('targetSelect').append(current);
    for (const target of targets) {
      const option = document.createElement('option'); option.value = String(target.id);
      option.textContent = target.title || (target.url?.includes('/dots/') ? 'Your dot' : 'ChatGPT 对话');
      $('targetSelect').append(option);
    }
  }
  const value = latestJob?.enabled ? latestJob.tabId : selectedTabId;
  if (targets.some(target => target.id === value)) $('targetSelect').value = String(value);
  else $('targetSelect').value = '';
}
function renderTemplates() {
  const previous = $('templateSelect').value;
  $('templateSelect').replaceChildren();
  const empty = document.createElement('option'); empty.value = ''; empty.textContent = '选择已保存的模板'; $('templateSelect').append(empty);
  for (const template of templates) {
    const option = document.createElement('option'); option.value = template.id; option.textContent = template.name; $('templateSelect').append(option);
  }
  if (templates.some(template => template.id === previous)) $('templateSelect').value = previous;
}
function renderLogs() {
  $('logCount').textContent = `${logs.length} 条记录`;
  $('logsEmpty').hidden = logs.length > 0;
  $('logList').replaceChildren();
  for (const log of [...logs].reverse()) {
    const row = document.createElement('li'); row.className = 'log-item';
    if (['unknown', 'unconfirmed', 'error', 'blocked'].includes(log.event)) row.classList.add('warning');
    const time = document.createElement('time');
    const date = new Date(log.at);
    time.textContent = Number.isFinite(date.getTime()) ? date.toLocaleString() : '时间未提供';
    if (Number.isFinite(date.getTime())) time.dateTime = date.toISOString();
    const title = document.createElement('strong'); title.textContent = eventLabels[log.event] || '运行状态';
    const message = document.createElement('p'); message.textContent = String(log.message || '');
    row.append(time, title, message); $('logList').append(row);
  }
}
function renderCountdown() {
  const config = displayedConfig();
  let seconds = Math.max(0, Math.ceil((latestJob?.enabled && latestJob.nextAt ? latestJob.nextAt - Date.now() : config.intervalMinutes * 60_000) / 1000));
  if (!Number.isFinite(seconds)) seconds = 1200;
  $('countdown').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  $('countdownLabel').textContent = latestJob?.phase === 'sending' ? '正在检查 / 发送' : latestJob?.awaitingReply ? '等待回复结束' : latestJob?.enabled ? '下一次检查' : '设定的发送间隔';
}
function paint(job) {
  const sourceIdentity = job?.enabled ? `job:${job.id}` : 'draft';
  latestJob = job;
  if (currentSourceIdentity !== sourceIdentity) { hidePrompt(); closeQueueEditor(); currentSourceIdentity = sourceIdentity; }
  const config = displayedConfig();
  const enabled = job?.enabled === true;
  const busy = !!pendingAction || importing;
  const activating = pendingAction === 'START' || pendingAction === 'RESUME';
  const blocked = job?.needsAttention || ['waiting', 'blocked', 'unknown'].includes(job?.phase);
  $('badge').textContent = enabled ? blocked ? '运行 · 等待' : '运行中' : job ? '已暂停' : '未开始';
  $('badge').classList.toggle('on', enabled); $('badge').classList.toggle('attention', enabled && blocked);
  $('target').textContent = job?.title || '选择你希望持续推进的页面';
  $('targetState').textContent = enabled ? '已绑定' : job ? '已暂停' : '尚未绑定';
  $('statusText').textContent = job?.statusText || '先设置提示词，再绑定你的 dot 或 ChatGPT 会话。';
  $('sentCount').textContent = String(job?.sentCount || 0);
  $('nextAt').textContent = enabled && job?.nextAt ? new Date(job.nextAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '尚未计时';
  $('runMode').textContent = config.mode === 'queue-once' ? '队列 · 执行一遍' : config.maxSends > 0 ? `上限 ${config.maxSends} 次` : '无限循环';
  $('protection').textContent = '标签保护 · ' + (!enabled ? '待启动' : ({ active: '已启用', off: '关闭', unavailable: '不可用' }[job.discardProtection] || '检查中'));
  $('powerStatus').textContent = '电脑防休眠 · ' + (enabled && config.keepAwake ? (job.systemAwake === true ? '已启用' : '不可用') : '关闭');
  for (const [id, value] of Object.entries({ interval: config.intervalMinutes, maxSends: config.maxSends,
    stopMarkers: (config.stopMarkers || []).join('\n'), mode: config.mode, scheduleMode: config.scheduleMode, sendMethod: config.sendMethod,
    quietStart: config.quietHours.start, quietEnd: config.quietHours.end })) setField(id, value);
  for (const [id, value] of Object.entries({ preventDiscard: config.preventDiscard, keepAwake: config.keepAwake,
    startImmediately: config.startImmediately, waitForIdle: config.waitForIdle, quietEnabled: config.quietHours.enabled })) $(id).checked = !!value;
  $('start').hidden = enabled || activating; $('start').disabled = !loaded || busy;
  $('pause').hidden = !enabled && !activating; $('pause').disabled = false;
  $('resume').hidden = enabled || activating || !job; $('resume').disabled = !loaded || busy;
  $('check').disabled = !loaded || busy; $('sendNow').disabled = busy || !enabled;
  $('targetSelect').disabled = !loaded || busy || enabled;
  for (const id of [...configFields, 'keepAwake', 'encoding', 'queueName', 'queueText', 'templateName', 'templateSelect']) $(id).disabled = !canEdit();
  $('prompt').readOnly = enabled || busy; $('prompt').disabled = !loaded;
  $('togglePrompt').disabled = !loaded || importing;
  for (const id of editableButtons) $(id).disabled = !canEdit();
  $('dropZone').setAttribute('aria-disabled', String(!canEdit()));
  for (const button of document.querySelectorAll('[data-interval]')) {
    button.disabled = !canEdit(); button.classList.toggle('selected', Number(button.dataset.interval) === config.intervalMinutes);
  }
  $('quietStart').disabled = !canEdit() || !config.quietHours.enabled;
  $('quietEnd').disabled = !canEdit() || !config.quietHours.enabled;
  const deliveryHint = config.waitForIdle ? '当前方式：等待 Agent 空闲再发送。' : '当前方式：到点打断并发送。';
  const submitHint = '提交方式：' + ({ auto: '智能提交（按钮+快捷键+表单）', 'ctrl-enter': 'Ctrl+Enter 优先', button: '发送按钮优先' }[config.sendMethod] || '智能提交') + '。';
  const cadenceHint = config.scheduleMode === 'after-reply' ? '已选择回复结束后才开始下一间隔。' : '';
  $('configHint').textContent = deliveryHint + submitHint + cadenceHint + (enabled
    ? '这里显示正在运行任务的实际配置。暂停后可编辑；“继续原任务”会沿用原配置。'
    : job ? '修改设置后点击“绑定目标并开始”建立新任务。“继续原任务”沿用原提示词、间隔和计数。'
      : '默认每 20 分钟重复同一条提示词，不设发送次数上限。首次发送从启动时计时。');
  renderPromptMeta(config); renderQueue(config); renderTargets(); renderCountdown();
}
async function refresh() {
  try {
    const state = await request({ type: 'GET_STATE' });
    if (!state?.ok) throw new Error(state?.error || '无法读取扩展状态。');
    if (!loaded) { draftConfig = normalized(state.config); loaded = true; }
    targets = Array.isArray(state.availableTargets) ? state.availableTargets : targets;
    if (fullView && !selectedTabId && state.job?.tabId) selectedTabId = state.job.tabId;
    if (Array.isArray(state.logs)) { logs = state.logs; renderLogs(); }
    paint(state.job || null);
  } catch (error) { tell(safeFailure(error), true); }
}
async function act(type, extras = {}) {
  if (pendingAction && !['PAUSE', 'CLEAR_DATA'].includes(type)) return;
  if (type === 'CLEAR_DATA') { contentEpoch += 1; clearTimeout(saveTimer); }
  const sequence = ++actionSequence;
  pendingAction = type; paint(latestJob);
  tell(type === 'CHECK_PAGE' ? '正在检查页面，不会填写或发送消息…' : '正在处理…');
  try {
    const response = await request({ type, ...extras });
    if (sequence !== actionSequence) return;
    if (!response?.ok) throw new Error(response?.error || '操作未完成。');
    if (type === 'CHECK_PAGE') tell(response.result?.message || '页面检查完成。', !['ready', 'busy', 'draft', 'done'].includes(response.result?.status));
    else if (type === 'START') { hidePrompt(); closeQueueEditor(); showPanel('task'); tell('任务已启动。你可以切换标签页，继续使用电脑。'); }
    else if (type === 'PAUSE') tell('后续发送已暂停。已经提交的消息无法撤回。');
    else if (type === 'RESUME') { hidePrompt(); closeQueueEditor(); showPanel('task'); tell('已按原任务配置继续，计时重新开始。'); }
    else if (type === 'CLEAR_LOGS') { logs = []; renderLogs(); tell('本机运行日志已清空。'); }
    else if (type === 'CLEAR_DATA') {
      clearTimeout(saveTimer); draftConfig = normalized(); templates = []; logs = []; loaded = false;
      hidePrompt(); closeQueueEditor(); renderTemplates(); renderLogs();
      $('includeSecrets').checked = false; $('theme').value = 'system'; applyTheme('system');
      tell('任务已暂停，本机配置、模板和日志已清空。');
    } else tell(response.job?.statusText || '本轮检查已结束。');
  } catch (error) { if (sequence === actionSequence) tell(safeFailure(error), true); }
  finally { if (sequence === actionSequence) { pendingAction = null; await refresh(); } }
}
function selectedTarget() {
  const value = Number($('targetSelect').value);
  const id = Number.isInteger(value) && value > 0 ? value : selectedTabId;
  return Number.isInteger(id) && id > 0 ? { tabId: id } : {};
}
async function importFiles(files, appendQueue = false) {
  if (!canEdit() || !files?.length) return;
  const list = Array.from(files);
  if (!appendQueue && list.length > 1) { tell('一次替换一条提示词；多个文件请使用“批量导入文件”。', true); return; }
  if (appendQueue && draftConfig.queue.length + list.length > 50) { tell('队列最多 50 条，请先移除部分项目。', true); return; }
  const originalDraft = clone(draftConfig);
  const importEpoch = contentEpoch;
  importing = true; hidePrompt(); closeQueueEditor(); paint(latestJob);
  $('importStatus').textContent = `正在本地解析 ${list.length} 个文件…`;
  try {
    const imported = [];
    let warningCount = 0;
    for (let index = 0; index < list.length; index++) {
      $('importStatus').textContent = `正在本地解析 ${index + 1} / ${list.length}…`;
      const result = await importPromptFile(list[index], { encoding: $('encoding').value });
      imported.push(result.text);
      warningCount += result.warnings?.length || 0;
    }
    if (importEpoch !== contentEpoch) throw new Error('导入已取消。');
    if (latestJob?.enabled) throw new Error('任务已从其他窗口启动。请暂停后重新导入。');
    const next = clone(draftConfig);
    if (appendQueue) {
      for (const text of imported) next.queue.push({ name: `提示词 ${next.queue.length + 1}`, text });
      next.mode = 'queue-loop';
    } else { next.prompt = imported[0]; next.promptSource = 'file'; }
    draftConfig = readConfig(next, { allowEmpty: true });
    await persistDraftNow();
    $('importStatus').textContent = warningCount
      ? `已导入 ${list.length} 个文件并隐藏正文。文档提取可能调整排版；可自行显示检查。`
      : `已导入 ${list.length} 个文件并隐藏正文。内容仅保存在本机。`;
    tell(appendQueue ? '文件已加入队列；模式已设为循环队列。' : '文件原文已设为提示词。开始后会发送这份实际内容。');
  } catch (error) {
    if (importEpoch === contentEpoch) { draftConfig = originalDraft; $('importStatus').textContent = safeFailure(error, '文件导入失败，请检查格式。'); tell('文件未导入；原配置保持不变。', true); }
    else $('importStatus').textContent = '导入已取消，未重新保存内容。';
  }
  finally {
    importing = false; queueSignature = ''; $('promptFile').value = ''; $('queueFiles').value = ''; paint(latestJob);
  }
}
function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.body.dataset.theme = theme;
  else delete document.body.dataset.theme;
}
function downloadJson(filename, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportableConfig(config, includePrompt) {
  const safe = {};
  for (const key of ['intervalMinutes', 'maxSends', 'stopMarkers', 'preventDiscard', 'mode', 'scheduleMode',
    'keepAwake', 'startImmediately', 'waitForIdle', 'sendMethod', 'quietHours']) safe[key] = clone(config[key]);
  if (includePrompt) { safe.prompt = config.prompt; safe.queue = clone(config.queue); }
  return safe;
}
function checkedImport(value) {
  const source = value?.config || value;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('配置文件格式不正确。');
  const next = clone(draftConfig);
  for (const key of ['intervalMinutes', 'maxSends', 'stopMarkers', 'preventDiscard', 'mode', 'scheduleMode',
    'keepAwake', 'startImmediately', 'waitForIdle', 'sendMethod', 'quietHours', 'prompt', 'queue']) {
    if (Object.hasOwn(source, key)) next[key] = source[key];
  }
  if ('prompt' in source && typeof source.prompt !== 'string') throw new Error('提示词必须是文本。');
  if ('prompt' in source) next.promptSource = 'file';
  return readConfig(next, { allowEmpty: true });
}

for (const name of ['task', 'prompt', 'settings', 'logs']) {
  $(`tab-${name}`).addEventListener('click', () => showPanel(name));
  $(`tab-${name}`).addEventListener('keydown', event => {
    const names = ['task', 'prompt', 'settings', 'logs']; let index = names.indexOf(name);
    if (event.key === 'ArrowRight') index = (index + 1) % names.length;
    else if (event.key === 'ArrowLeft') index = (index + names.length - 1) % names.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = names.length - 1;
    else return;
    event.preventDefault(); showPanel(names[index], true);
  });
}
$('goPrompt').addEventListener('click', () => showPanel('prompt'));
$('targetSelect').addEventListener('change', () => { selectedTabId = Number($('targetSelect').value) || null; });
$('start').addEventListener('click', async () => {
  if (!canEdit()) return;
  draftConfig = gatherConfig();
  try {
    if (draftConfig.keepAwake) {
      const granted = await chrome.permissions.request({ permissions: ['power'] });
      if (!granted) { draftConfig.keepAwake = false; $('keepAwake').checked = false; }
    }
    draftConfig = readConfig(draftConfig);
    await persistDraftNow();
  } catch (error) { tell(safeFailure(error, '本机保存失败，尚未启动。'), true); return; }
  act('START', { config: clone(draftConfig), ...selectedTarget() });
});
$('pause').addEventListener('click', () => act('PAUSE'));
$('resume').addEventListener('click', () => act('RESUME'));
$('check').addEventListener('click', () => act('CHECK_PAGE', selectedTarget()));
$('sendNow').addEventListener('click', () => act('SEND_NOW'));
for (const id of configFields) $(id).addEventListener('input', onConfigurationInput);
for (const button of document.querySelectorAll('[data-interval]')) button.addEventListener('click', () => { if (canEdit()) { $('interval').value = button.dataset.interval; onConfigurationInput(); } });
$('togglePrompt').addEventListener('click', () => {
  if (!loaded || importing) return;
  if (revealed) hidePrompt();
  else { revealed = true; renderPromptMeta(displayedConfig()); if (!latestJob?.enabled) $('prompt').focus(); }
});
$('prompt').addEventListener('input', () => {
  if (!canEdit() || !revealed) return;
  draftConfig.prompt = $('prompt').value; draftConfig.promptSource = 'manual'; saveDraft(); renderPromptMeta(draftConfig);
});
$('importPrompt').addEventListener('click', () => $('promptFile').click());
$('promptFile').addEventListener('change', event => importFiles(event.target.files));
$('importQueue').addEventListener('click', () => $('queueFiles').click());
$('queueFiles').addEventListener('change', event => importFiles(event.target.files, true));
$('dropZone').addEventListener('click', () => { if (canEdit()) $('promptFile').click(); });
$('dropZone').addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); if (canEdit()) $('promptFile').click(); } });
$('dropZone').addEventListener('dragover', event => { event.preventDefault(); if (canEdit()) $('dropZone').classList.add('dragging'); });
$('dropZone').addEventListener('dragleave', () => $('dropZone').classList.remove('dragging'));
$('dropZone').addEventListener('drop', event => { event.preventDefault(); $('dropZone').classList.remove('dragging'); importFiles(event.dataTransfer.files); });
$('addToQueue').addEventListener('click', () => {
  if (!canEdit()) return;
  if (!draftConfig.prompt?.trim()) { tell('请先输入或导入一条提示词。', true); return; }
  if (draftConfig.queue.length >= 50) { tell('队列最多 50 条。', true); return; }
  const next = clone(draftConfig);
  next.queue.push({ name: `提示词 ${next.queue.length + 1}`, text: next.prompt });
  try { draftConfig = readConfig(next, { allowEmpty: true }); } catch (error) { tell(safeFailure(error), true); return; }
  saveDraft(); paint(latestJob); tell('已加入队列。可在“任务”中选择队列发送模式。');
});
$('saveQueueItem').addEventListener('click', () => {
  if (!canEdit() || queueEditing == null) return;
  const text = $('queueText').value;
  if (!text.trim() || text.length > (MAX_PROMPT_CHARS || 100000)) { tell('队列提示词不能为空，且不能超过 10 万字符。', true); return; }
  const next = clone(draftConfig);
  next.queue[queueEditing] = { name: $('queueName').value.trim() || `提示词 ${queueEditing + 1}`, text };
  try { draftConfig = readConfig(next, { allowEmpty: true }); } catch (error) { tell(safeFailure(error), true); return; }
  closeQueueEditor(); saveDraft(); queueSignature = ''; paint(latestJob); tell('队列项已更新，正文已隐藏。');
});
$('cancelQueueEdit').addEventListener('click', closeQueueEditor);
$('keepAwake').addEventListener('change', async () => {
  if (!canEdit()) return;
  if ($('keepAwake').checked) {
    try {
      // Request directly from the user's gesture, before any unrelated await.
      const granted = await chrome.permissions.request({ permissions: ['power'] });
      if (!granted) { $('keepAwake').checked = false; tell('未授予防休眠权限；其他功能仍可使用。'); }
    } catch { $('keepAwake').checked = false; tell('无法申请防休眠权限，请检查浏览器扩展设置。', true); }
  }
  onConfigurationInput();
});
$('theme').addEventListener('change', () => { const theme = $('theme').value; applyTheme(theme); chrome.storage.local.set({ uiTheme: theme }).catch(() => tell('主题保存失败。', true)); });
$('expand').addEventListener('click', async () => {
  try {
    await persistDraftNow();
    let tabId = selectedTarget().tabId || latestJob?.tabId;
    if (!tabId && chrome.tabs?.query) tabId = (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    const url = new URL(chrome.runtime.getURL('popup.html')); url.searchParams.set('view', 'full');
    if (Number.isInteger(tabId)) url.searchParams.set('targetTabId', String(tabId));
    await chrome.tabs.create({ url: url.href });
  } catch { tell('无法打开完整控制台。', true); }
});
$('saveTemplate').addEventListener('click', async () => {
  if (!canEdit()) return;
  const name = $('templateName').value.trim();
  if (!name) { tell('请先填写模板名称。', true); return; }
  if (!draftConfig.prompt?.trim() && !draftConfig.queue.length) { tell('当前还没有可保存的提示词。', true); return; }
  if (templates.length >= 30) { tell('最多保存 30 个模板，请先删除不需要的模板。', true); return; }
  templates.push({ id: crypto.randomUUID(), name, prompt: draftConfig.prompt, queue: clone(draftConfig.queue), mode: draftConfig.mode });
  try { await chrome.storage.local.set({ templates }); renderTemplates(); $('templateName').value = ''; tell('模板已保存在本机。'); }
  catch { templates.pop(); tell('模板保存失败，请检查本机存储空间。', true); }
});
$('loadTemplate').addEventListener('click', () => {
  if (!canEdit()) return;
  const template = templates.find(item => item.id === $('templateSelect').value);
  if (!template) { tell('请先选择模板。', true); return; }
  draftConfig.prompt = template.prompt; draftConfig.queue = clone(template.queue); draftConfig.mode = template.mode; draftConfig.promptSource = 'template';
  hidePrompt(); closeQueueEditor(); saveDraft(); queueSignature = ''; paint(latestJob); tell('模板已载入，正文已隐藏；尚未开始发送。');
});
$('deleteTemplate').addEventListener('click', async () => {
  if (!canEdit()) return;
  const id = $('templateSelect').value;
  if (!templates.some(item => item.id === id)) { tell('请先选择模板。', true); return; }
  const remaining = templates.filter(item => item.id !== id);
  try { await chrome.storage.local.set({ templates: remaining }); templates = remaining; renderTemplates(); tell('所选模板已删除。当前提示词保持不变。'); }
  catch { tell('模板未能删除。', true); }
});
$('exportConfig').addEventListener('click', () => {
  const includesPrompt = $('includeSecrets').checked;
  downloadJson('agent-continue-settings.json', { format: 'agent-continue-settings', version: 1, includesPrompt, config: exportableConfig(displayedConfig(), includesPrompt) });
  $('includeSecrets').checked = false;
  tell(includesPrompt ? '已导出包含正文的配置，请自行妥善保存。' : '已导出发送设置；文件不包含提示词正文。');
});
$('importConfig').addEventListener('click', () => { if (canEdit()) $('configFile').click(); });
$('configFile').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!canEdit() || !file) return;
  const importEpoch = contentEpoch;
  const originalDraft = clone(draftConfig);
  importing = true; hidePrompt(); closeQueueEditor(); paint(latestJob);
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('配置文件不能超过 10 MB。');
    let value; try { value = JSON.parse(await file.text()); } catch { throw new Error('配置文件不是有效的 JSON。'); }
    if (importEpoch !== contentEpoch) throw new Error('导入已取消。');
    const next = checkedImport(value);
    if (latestJob?.enabled) throw new Error('任务已经启动，请暂停后再导入配置。');
    draftConfig = next; await persistDraftNow(); queueSignature = '';
    tell('配置已导入，正文已隐藏。未开始发送；请检查设置后绑定。');
  } catch (error) {
    if (importEpoch === contentEpoch) { draftConfig = originalDraft; tell(safeFailure(error, '配置导入失败。'), true); }
  } finally { importing = false; $('configFile').value = ''; paint(latestJob); }
});
$('refreshLogs').addEventListener('click', refresh);
$('clearLogs').addEventListener('click', () => act('CLEAR_LOGS'));
$('exportLogs').addEventListener('click', () => {
  downloadJson('agent-continue-activity.json', { format: 'agent-continue-activity', logs: logs.map(({ at, event, message }) => ({ at, event, message })) });
  tell('已导出不含提示词的运行日志。');
});
$('clearData').addEventListener('click', () => $('clearDialog').showModal());
$('cancelClear').addEventListener('click', () => $('clearDialog').close());
$('confirmClear').addEventListener('click', () => { $('clearDialog').close(); clearTimeout(saveTimer); act('CLEAR_DATA'); });
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'session' || area === 'local') && changes.job) paint(changes.job.newValue || null);
  if (area === 'local' && changes.logs) { logs = Array.isArray(changes.logs.newValue) ? changes.logs.newValue : []; renderLogs(); }
});
window.addEventListener('pagehide', () => {
  if (loaded && !latestJob?.enabled && !importing) {
    clearTimeout(saveTimer);
    try { chrome.storage.local.set({ config: readConfig(clone(draftConfig), { allowEmpty: true }) }).catch(() => undefined); } catch { /* Keep last valid draft. */ }
  }
  hidePrompt(); closeQueueEditor(); clearInterval(countdownTimer);
});
const countdownTimer = setInterval(renderCountdown, 1000);
paint(null);
(async () => {
  try {
    const local = await chrome.storage.local.get(['templates', 'uiTheme']);
    templates = Array.isArray(local.templates) ? local.templates.filter(item => typeof item?.id === 'string' && typeof item.name === 'string' && typeof item.prompt === 'string' && Array.isArray(item.queue)).slice(0, 30) : [];
    const theme = ['system', 'light', 'dark'].includes(local.uiTheme) ? local.uiTheme : 'system';
    $('theme').value = theme; applyTheme(theme); renderTemplates();
  } catch { tell('部分本机偏好未能载入。', true); }
  await refresh();
})();
