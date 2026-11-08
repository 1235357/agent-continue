// Browser-safe view model for the `status --json` envelope produced by
// registration-status.mjs. Pure formatting and strict validation only: this
// module executes nothing, imports no writer or execution module and never
// contacts the registry. A bridge may feed it the command output; a missing or
// failed bridge renders an explicit unknown state instead of a blank page.
export const STATUS_FORMAT = 'agent-continue-registration-status';
export const STATUS_VIEW_FORMAT = 'agent-continue-registration-status-view';
export const REGISTERED_STATES = Object.freeze(['not-registered', 'registered',
  'drift', 'error', 'unknown']);
export const BINDING_STATES = Object.freeze(['present', 'missing', 'invalid']);
const STATUS_FIELDS = ['format', 'version', 'root', 'installed', 'binding',
  'registered', 'hostStartable', 'failed', 'counts'];
const COUNT_FIELDS = ['pass', 'fail', 'skip'];
const UNKNOWN_REASONS = ['fetch-failed', 'timeout', 'exit-nonzero', 'invalid-output'];
const LANGUAGES = ['zh_CN', 'en'];
const ROW_IDS = ['install-root', 'installed', 'binding', 'registered', 'host-startable'];
const LABELS = {
  zh_CN: { 'install-root': '安装根', installed: '已安装', binding: '绑定文件',
    registered: '注册状态', 'host-startable': '主机可启动' },
  en: { 'install-root': 'install root', installed: 'installed', binding: 'binding',
    registered: 'registered', 'host-startable': 'host startable' },
};
const YES_NO = { zh_CN: ['否', '是'], en: ['no', 'yes'] };
const BINDING_VALUE = {
  zh_CN: { present: '存在', missing: '缺失', invalid: '无效' },
  en: { present: 'present', missing: 'missing', invalid: 'invalid' },
};
const BINDING_DETAIL = {
  zh_CN: { present: '绑定文件存在，可由本机主机读取。',
    missing: '绑定文件缺失，主机无法确认扩展标识。',
    invalid: '绑定文件无效或不可读，主机不能安全启动。' },
  en: { present: 'The binding file exists and is readable by the local host.',
    missing: 'The binding file is missing, so the host cannot identify the extension.',
    invalid: 'The binding file is invalid or unreadable, so the host cannot start safely.' },
};
const INSTALLED_DETAIL = {
  zh_CN: [ '安装目录、布局、清单或绑定检查未通过。', '安装目录、布局、清单与绑定检查通过；这不是安装授权。' ],
  en: [ 'Install-root, layout, manifest or binding checks did not all pass.',
    'Install-root, layout, manifest and binding checks passed; this is not an install approval.' ],
};
const HOST_DETAIL = {
  zh_CN: [ '主机脚本缺失或语法无法解析，无法启动。', '主机脚本存在且语法可解析；这不代表已启动。' ],
  en: [ 'The host script is missing or does not parse, so it cannot start.',
    'The host script exists and parses; this does not mean it was started.' ],
};
const REGISTERED_COPY = {
  zh_CN: {
    'not-registered': { value: '未注册', detail: '没有任何注册表键指向本机主机清单，浏览器发现不到该主机。' },
    registered: { value: '已注册', detail: '当前用户的两个注册表视图都指向同一清单；这只影响浏览器发现，不代表本机与浏览器已经完成握手，也不代表聊天获得工具授权。' },
    drift: { value: '注册值漂移', detail: '注册表里存在的值与当前用户的两个视图不一致，需要人工核对。' },
    error: { value: '查询出错', detail: '注册表查询出错，当前无法确认注册状态。' },
    unknown: { value: '未知', detail: '注册表视图无法查询，当前无法确认是否已注册。' },
  },
  en: {
    'not-registered': { value: 'not registered', detail: 'No registry key points at the native host manifest, so the browser cannot discover it.' },
    registered: { value: 'registered', detail: 'Both current-user registry views point at the same manifest; this affects browser discovery only and does not prove a completed handshake or tool authorization in chat.' },
    drift: { value: 'value drift', detail: 'An existing registry value disagrees with the two current-user views and needs manual review.' },
    error: { value: 'query error', detail: 'A registry query failed, so registration cannot be confirmed either way.' },
    unknown: { value: 'unknown', detail: 'The registry views could not be queried, so registration cannot be confirmed.' },
  },
};
const NOTE = {
  zh_CN: '这些是只读检查结果，不代表注册成功、隧道就绪或聊天已获工具授权。',
  en: 'These are read-only check results; they are not proof of successful registration, a ready tunnel or chat tool authorization.',
};
const UNKNOWN_HEADING = { zh_CN: '状态未知', en: 'Status unknown' };
const UNKNOWN_DETAIL = {
  zh_CN: { 'fetch-failed': '无法获取本机状态报告。', timeout: '读取本机状态报告超时。',
    'exit-nonzero': '状态命令以非零退出结束。', 'invalid-output': '状态报告格式无效，已拒绝渲染。' },
  en: { 'fetch-failed': 'The local status report could not be fetched.',
    timeout: 'Reading the local status report timed out.',
    'exit-nonzero': 'The status command exited non-zero.',
    'invalid-output': 'The status report was malformed and was rejected.' },
};
const fail = code => { throw new Error(code); };

function plain(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === null || Object.getPrototypeOf(Object.getPrototypeOf(value)) === null) &&
    Reflect.ownKeys(value).length === keys.length &&
    Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key) &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value') &&
      Object.getOwnPropertyDescriptor(value, key).enumerable);
}

function language(options) {
  if (options === undefined) return 'zh_CN';
  if (!plain(options, ['language']) || !LANGUAGES.includes(options.language)) fail('invalid_status_input');
  return options.language;
}

const isCount = value => Number.isInteger(value) && value >= 0;

function parseStatus(value) {
  if (!plain(value, STATUS_FIELDS) || value.format !== STATUS_FORMAT || value.version !== 1
    || typeof value.root !== 'string' || value.root.length === 0 || /[\x00-\x1f\x7f]/.test(value.root)
    || typeof value.installed !== 'boolean' || typeof value.hostStartable !== 'boolean'
    || !BINDING_STATES.includes(value.binding) || !REGISTERED_STATES.includes(value.registered)
    || !isCount(value.failed) || !plain(value.counts, COUNT_FIELDS)
    || !COUNT_FIELDS.every(key => isCount(value.counts[key]))) fail('invalid_status_input');
  return value;
}

const line = row => row.label + ': ' + row.value + (row.detail ? ' — ' + row.detail : '');

function compose(lang, rows, counts, failed, unknown, reason) {
  const note = 'note: ' + NOTE[lang];
  const heading = unknown ? UNKNOWN_HEADING[lang] + ': ' + UNKNOWN_DETAIL[lang][reason] + '\n' : '';
  return Object.freeze({
    format: STATUS_VIEW_FORMAT, version: 1, language: lang, unknown, reason: unknown ? reason : null,
    rows: Object.freeze(rows.map(row => Object.freeze(row))),
    counts: Object.freeze({ ...counts }), failed,
    note, text: heading + rows.map(line).join('\n') + '\n' + note + '\n',
  });
}

export function buildStatusView(value, options) {
  const lang = language(options);
  const status = parseStatus(value);
  const registered = REGISTERED_COPY[lang][status.registered];
  const rows = [
    { id: 'install-root', label: LABELS[lang]['install-root'], value: status.root,
      detail: '', tone: 'info' },
    { id: 'installed', label: LABELS[lang].installed, value: YES_NO[lang][Number(status.installed)],
      detail: INSTALLED_DETAIL[lang][Number(status.installed)], tone: status.installed ? 'ok' : 'warn' },
    { id: 'binding', label: LABELS[lang].binding, value: BINDING_VALUE[lang][status.binding],
      detail: BINDING_DETAIL[lang][status.binding], tone: status.binding === 'present' ? 'ok' : 'warn' },
    { id: 'registered', label: LABELS[lang].registered, value: registered.value,
      detail: registered.detail, tone: status.registered === 'registered' ? 'ok' : 'warn' },
    { id: 'host-startable', label: LABELS[lang]['host-startable'], value: YES_NO[lang][Number(status.hostStartable)],
      detail: HOST_DETAIL[lang][Number(status.hostStartable)], tone: status.hostStartable ? 'ok' : 'warn' },
  ];
  return compose(lang, rows, status.counts, status.failed, false, null);
}

export function buildUnknownStatusView(reason, options) {
  if (!UNKNOWN_REASONS.includes(reason)) fail('invalid_unknown_reason');
  const lang = language(options);
  const rows = ROW_IDS.map(id => ({ id, label: LABELS[lang][id], value: lang === 'zh_CN' ? '未知' : 'unknown',
    detail: '', tone: 'unknown' }));
  return compose(lang, rows, { pass: 0, fail: 0, skip: 0 }, 0, true, reason);
}

function resolveOptions(options) {
  if (options === undefined) return { language: 'zh_CN', timeoutMs: 1500 };
  if (!plain(options, Object.keys(options)) || !Object.keys(options).every(key => ['language', 'timeoutMs'].includes(key))
    || (options.language !== undefined && !LANGUAGES.includes(options.language))
    || (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) ||
      options.timeoutMs < 1 || options.timeoutMs > 60000))) fail('invalid_status_input');
  return { language: options.language ?? 'zh_CN', timeoutMs: options.timeoutMs ?? 1500 };
}

// The fetcher is the only data source and receives a read-only argument
// object. Anything other than `{exitCode: 0, stdout: <status JSON>}` renders
// the unknown state; nothing is cleared, and no success is assumed.
export async function resolveStatusView(fetcher, options) {
  const config = resolveOptions(options);
  if (typeof fetcher !== 'function') return buildUnknownStatusView('fetch-failed', { language: config.language });
  let timer;
  const limit = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('status_timeout')), config.timeoutMs);
  });
  try {
    const result = await Promise.race([Promise.resolve().then(() => fetcher({ timeoutMs: config.timeoutMs })), limit]);
    if (!plain(result, ['exitCode', 'stdout']) || !Number.isInteger(result.exitCode)
      || typeof result.stdout !== 'string') return buildUnknownStatusView('invalid-output', { language: config.language });
    if (result.exitCode !== 0) return buildUnknownStatusView('exit-nonzero', { language: config.language });
    let parsed;
    try { parsed = JSON.parse(result.stdout); } catch { return buildUnknownStatusView('invalid-output', { language: config.language }); }
    return buildStatusView(parsed, { language: config.language });
  } catch (error) {
    const reason = error instanceof Error && error.message === 'status_timeout' ? 'timeout' : 'fetch-failed';
    return buildUnknownStatusView(reason, { language: config.language });
  } finally { clearTimeout(timer); }
}
