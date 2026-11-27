import { createTranslator } from './i18n.js';
import runtimeCatalog from './i18n-runtime.js';

const t = createTranslator(runtimeCatalog);

// Extension-context boundary: pageAction must remain closure-free when injected.
export function translatePageResult(value) {
  if (!value || typeof value !== 'object') return value;
  return { ...value, message: typeof value.message === 'string' && Object.hasOwn(runtimeCatalog, value.message) ? t(value.message) : value.message };
}

// Read only the extension's isolated-world invocation, never the page composer.
export function pageInvocationState({ runId, resultToken }) {
  const entry = globalThis.__agentContinuePageInvocationsV1?.get(resultToken);
  if (!entry || entry.runId !== runId) return { state: 'absent' };
  if (entry.state === 'settled') return { state: 'settled', result: entry.result };
  const metrics = entry.metrics;
  return { state: 'running', ...(Number.isFinite(entry.grantedDeadline) ? { grantedDeadline: entry.grantedDeadline } : {}),
    ...(metrics ? { diagnosticProgress: { stage: metrics.stage, reason: metrics.reason, method: metrics.method,
      counters: { ...metrics.counters }, timings: { ...metrics.timings, elapsedMs: Math.max(0, Date.now() - entry.startedAt),
        stageElapsedMs: Math.max(0, Date.now() - entry.stageStartedAt) },
      observations: { ...metrics.observations } } } : {}) };
}

// This function is injected into one explicitly selected tab.
// Executed in ISOLATED world with authoritative background permission checks.
export async function pageAction(args) {
  const cancellable = args.mode === 'send' && typeof args.resultToken === 'string';
  let invocation, completeInvocation;
  if (cancellable) {
    const invocations = globalThis.__agentContinuePageInvocationsV1 ??= new Map();
    const previous = invocations.get(args.resultToken);
    if (previous) return previous.runId === args.runId ? previous.promise : { status: 'cancelled' };
    // Reserve synchronously before the first await: concurrent or late injection
    // requests must join this exact execution, never run another submission.
    const promise = new Promise(resolve => { completeInvocation = resolve; });
    invocation = { runId: args.runId, state: 'running', promise };
    invocations.set(args.resultToken, invocation);
    for (const [key, entry] of invocations) {
      if (invocations.size <= 8) break;
      if (key !== args.resultToken && entry.state === 'settled') invocations.delete(key);
    }
  }
  const startedAt = Date.now();
  let stageStartedAt = startedAt;
  const metrics = {
    stage: 'page', reason: 'starting', method: 'none',
    counters: Object.fromEntries(['pageAdmissions', 'modelWrites', 'domWrites', 'textChunks', 'slowChunks', 'rejectedChunks', 'chunkRestarts', 'prefixRewriteRestarts', 'chunkSettlementRestarts', 'chunkUnserializableChecks', 'chunkUnserializableRestarts', 'chunkUnserializableRecoveries', 'chunkDifferences', 'insertedBlankSeparators', 'fillCalls', 'readinessChecks',
      'authorizationChecks', 'grantRequests', 'grantReadbacks', 'retiredReadbacks', 'dispatchAttempts',
      'receiptChecks', 'manualIntents', 'attachmentsRemoved', 'transportErrors', 'leaseRenewals', 'documentChanges', 'emptyComposerRecoveries'].map(name => [name, name === 'pageAdmissions' ? 1 : 0])),
    timings: { modelWriteMs: 0, domWriteMs: 0, maxModelWriteMs: 0, maxDomWriteMs: 0, serializationMs: 0, maxSerializationMs: 0, elapsedMs: 0, stageElapsedMs: 0 },
    observations: { hidden: false, sendPresent: false, sendEnabled: false, composerPresent: false, busy: false, manualPending: false },
  };
  if (invocation) Object.assign(invocation, { metrics, startedAt, stageStartedAt });
  const progress = (stage, reason) => {
    if (metrics.stage !== stage) { stageStartedAt = Date.now(); if (invocation) invocation.stageStartedAt = stageStartedAt; }
    metrics.stage = stage; metrics.reason = reason;
  };
  const diagnosticProgress = () => ({ stage: metrics.stage, reason: metrics.reason, method: metrics.method,
    counters: { ...metrics.counters }, timings: { ...metrics.timings, elapsedMs: Math.max(0, Date.now() - startedAt),
      stageElapsedMs: Math.max(0, Date.now() - stageStartedAt) },
    observations: { ...metrics.observations } });
  const resultReason = status => ({ sent: 'receipt-confirmed', 'manual-sent': 'manual-receipt-confirmed', cancelled: 'cancelled',
    busy: 'busy', ready: 'ready', done: 'ready', draft: 'attachments', blocked: 'composer-unavailable', error: 'commit-error', unknown: 'unknown' })[status];
  const grantedDeadline = deadline => {
    if (!Number.isFinite(deadline)) return;
    if (deadline > args.runDeadline) metrics.counters.leaseRenewals++;
    args.runDeadline = deadline;
  };
  let revoked = false;
  let removeManualListeners = () => {};
  const cancel = (message, sender, sendResponse) => {
    if (!['CANCEL_RUN', 'GRANT_RUN'].includes(message?.type) || message.runId !== args.runId || message.resultToken !== args.resultToken
      || sender.id !== chrome.runtime.id) return false;
    if (message.type === 'GRANT_RUN') {
      if (revoked || !Number.isFinite(message.runDeadline)) return false;
      metrics.counters.grantRequests++;
      grantedDeadline(message.runDeadline);
      if (invocation) invocation.grantedDeadline = message.runDeadline;
      sendResponse({ granted: true, runId: args.runId, resultToken: args.resultToken, runDeadline: args.runDeadline });
      return false;
    }
    revoked = true;
    if (invocation) delete invocation.grantedDeadline;
    sendResponse({ revoked: true, runId: args.runId, resultToken: args.resultToken, diagnosticProgress: diagnosticProgress() });
    return false;
  };
  if (cancellable) chrome.runtime.onMessage.addListener(cancel);
  const action = async () => {
  let submitted = false;
  let manualPending = false;
  let extensionBoundary = false;
  let preparationStarted = false;
  let pageMatched = false;
  const manualHandoff = {};
  let resolveManualTakeover;
  const manualTakeover = new Promise(resolve => { resolveManualTakeover = resolve; });
  const mutable = () => { if (manualPending) throw manualHandoff; };
  const write = (counter, callback) => {
    mutable();
    const clock = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
    const start = clock();
    metrics.counters[counter]++;
    try { return callback(); }
    finally {
      const elapsed = Math.max(0, clock() - start);
      const model = counter === 'modelWrites';
      metrics.timings[model ? 'modelWriteMs' : 'domWriteMs'] += elapsed;
      const maximum = model ? 'maxModelWriteMs' : 'maxDomWriteMs';
      metrics.timings[maximum] = Math.max(metrics.timings[maximum], elapsed);
    }
  };
  let observeManual = () => {};
  const onManualEvent = event => observeManual(event);
  if (args.mode === 'send') {
    removeManualListeners = () => {
      for (const type of ['click', 'keydown', 'submit']) {
        try { document.removeEventListener(type, onManualEvent, true); } catch { /* Setup may have failed before a document was available. */ }
      }
    };
    for (const type of ['click', 'keydown', 'submit']) document.addEventListener(type, onManualEvent, true);
  }
  const normalizeUrl = value => {
    try {
      const u = new URL(value);
      return u.origin + u.pathname.replace(/\/+$/, '');
    } catch { return ''; }
  };

  // Rich-text paragraph boundaries can expose two newlines in innerText for
  // one logical line break. Normalize only comparisons; insertion uses the
  // original prompt verbatim.
  const stripMarkdown = str => String(str ?? '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/^[\s]*>\s*/gm, '');

  const clean = value => String(value ?? '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/\n{2,}/g, '\n').trim();
  const textOf = element => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? element.value : (element.innerText ?? element.textContent ?? '');
  const yieldFrame = () => {
    if (document.visibilityState !== 'visible' || typeof requestAnimationFrame !== 'function') return Promise.resolve();
    return new Promise(resolve => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      const timer = setTimeout(done, 32);
      try {
        requestAnimationFrame(() => { clearTimeout(timer); done(); });
      } catch {
        clearTimeout(timer);
        done();
      }
    });
  };

  // In background tabs or minimized windows on Windows, getClientRects() may return empty rects
  // even though the element is connected and visible. Check display/visibility and visibilityState.
  const visible = element => {
    if (!element || !element.isConnected) return false;
    try {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    } catch { return false; }
    if (document.visibilityState === 'hidden') return true;
    return element.getClientRects().length > 0 || element.offsetWidth > 0 || element.offsetHeight > 0;
  };

  const visibleMatches = (selector, root = document) => {
    try {
      return [...root.querySelectorAll(selector)].filter(visible);
    } catch { return []; }
  };

  const isDot = new URL(args.expectedUrl).pathname.startsWith('/dots/');
  const expectedUrl = normalizeUrl(args.expectedUrl);

  // Auto prefers the scoped Send button. Without one, Dot uses Ctrl+Enter
  // and ordinary ChatGPT uses Enter. No second method follows a dispatch.
  const sendMethod = args.sendMethod || 'auto';
  const useKeyboardOnly = sendMethod === 'ctrl-enter';

  const stopSelector = 'button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"], button[aria-label="Stop response"], button[aria-label="停止生成"], button[aria-label="停止输出"], button[aria-label="停止流式传输"], button[aria-label*="Stop" i], button[aria-label*="停止" i]';
  const pauseSelector = 'button[aria-label*="Resume" i], button[aria-label*="Pause" i], button[aria-label*="继续" i], button[aria-label*="暂停" i], [data-testid*="resume" i], [data-testid*="pause" i], [data-testid*="paused" i]';
  const busySelector = '.typing-indicator, ' + stopSelector;
  const isDotPaused = () => {
    if (!isDot) return false;
    try {
      const pills = [...document.querySelectorAll('[data-testid*="pause" i], [data-testid*="resume" i], button[aria-label*="Resume" i], button[aria-label*="Pause" i]')];
      for (const el of pills) {
        const text = el.textContent?.trim();
        if ((text === '⏸ Paused' || text === 'Paused' || text === '暂停' || text === '已暂停' || (typeof text === 'string' && text.startsWith('⏸'))) && visible(el)) {
          return true;
        }
      }
      return false;
    } catch { return false; }
  };
  const sendSelector = 'button[data-testid="send-button"], button[data-testid="composer-submit-button"], button[data-testid="fruitjuice-send-button"], button[data-testid*="send" i], button[data-testid*="submit" i], button[aria-label="Send prompt"], button[aria-label="Send message"], button[aria-label="发送提示"], button[aria-label="发送消息"], button[aria-label="Send"], button[aria-label="发送"], button[aria-label*="Send" i], button[aria-label*="发送" i], button[type="submit"]';
  const modernSelector = role => `[data-chatgpt-search-unit-key$=":${role}"][data-chatgpt-search-message-ids]`;
  const userSelector = isDot
    ? '[data-message-author-role="user"], article.message-row.self .message-body, article.message-row.self, article.self .message-body, article.self, [data-testid^="conversation-turn-"]:has([data-message-author-role="user"])'
    : `[data-message-author-role="user"], ${modernSelector('user')}`;
  const assistantSelector = isDot
    ? '[data-message-author-role="assistant"], article.message-row:not(.self) .message-body'
    : `[data-message-author-role="assistant"], ${modernSelector('assistant')}`;

  const modernMessageKey = element => element?.getAttribute('data-chatgpt-search-message-ids')?.trim().split(/\s+/)[0] || null;
  const messageKey = element => element?.getAttribute('data-message-id') || element?.closest('[data-message-id]')?.getAttribute('data-message-id') || modernMessageKey(element) || element?.getAttribute('data-testid') || element?.id || null;
  const messageNodes = role => {
    const raw = [...document.querySelectorAll(role === 'user' ? userSelector : assistantSelector)];
    const nodes = [];
    for (const el of raw) {
      const target = isDot ? (el.querySelector?.('.message-body') || el) : (el.closest?.(modernSelector(role)) || el);
      if (!nodes.includes(target)) nodes.push(target);
    }
    return nodes;
  };

  const identity = () => {
    if (!isDot) return null;
    const rows = document.querySelectorAll('article.message-row, [data-message-author-role], article[data-testid^="conversation-turn-"]');
    let fallbackIdentity = null;
    // Prefer trailing structured '~' Dot IDs so unhydrated optimistic turn nodes
    // appended right after Send do not mask the bound conversation identity, while
    // genuine conversation switches ('acct~other~...') block immediately.
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      const target = row?.querySelector?.('.message-body') || row;
      const explicit = target?.getAttribute?.('data-message-id')
        || target?.closest?.('[data-message-id]')?.getAttribute?.('data-message-id')
        || modernMessageKey(target);
      if (explicit) {
        if (explicit.includes('~')) {
          const parts = explicit.split('~');
          return parts.length >= 3 ? parts.slice(0, 2).join('~') : explicit;
        }
        fallbackIdentity ??= explicit;
        continue;
      }
      const fallback = target?.getAttribute?.('data-testid') || target?.id || null;
      if (fallback) fallbackIdentity ??= fallback;
    }
    return fallbackIdentity;
  };

  const assistantState = () => {
    const messages = messageNodes('assistant');
    return { assistantToken: messageKey(messages.at(-1)), assistantCount: messages.length };
  };

  let beforeAssistant = null;
  const result = (status, message, diagnosticCode, meta = null) => {
    metrics.reason = ['approval-required', 'auto-allowed-prompt', 'oauth-required', 'captcha-required', 'takeover-needed', 'agent-paused', 'agent-busy'].includes(diagnosticCode)
      ? diagnosticCode : resultReason(status);
    return { status, message,
    ...(args.persistentDelivery === true && !submitted && !manualPending && ['blocked', 'draft', 'busy', 'error'].includes(status)
      && !['approval-required', 'auto-allowed-prompt', 'oauth-required', 'captcha-required', 'takeover-needed'].includes(diagnosticCode)
      ? { retryable: true } : {}),
    ...(diagnosticCode ? { diagnosticCode } : {}),
    ...(meta && typeof meta === 'object' ? meta : {}),
    identity: identity(),
    ...(['sent', 'manual-sent'].includes(status) ? beforeAssistant : assistantState()) };
  };
  const samePage = () => {
    if (normalizeUrl(location.href) !== expectedUrl) { if (pageMatched) metrics.counters.documentChanges++; pageMatched = false; return false; }
    if (args.targetIdentity) {
      const currentId = identity();
      if (!currentId || currentId !== args.targetIdentity) { if (pageMatched) metrics.counters.documentChanges++; pageMatched = false; return false; }
    }
    pageMatched = true;
    return true;
  };
  const withinDeadline = () => !revoked && Number.isFinite(args.runDeadline) && Date.now() < args.runDeadline;
  const forceInterrupt = args.waitForIdle !== true;
  const busy = () => {
    const paused = isDotPaused();
    const streaming = visibleMatches(busySelector).length > 0;
    const activeStop = visibleMatches(stopSelector).length > 0;
    const anyPauseControl = visibleMatches(pauseSelector).length > 0;
    metrics.observations.busy = paused || streaming || anyPauseControl;
    if (args.isTakeoverReply === true && isDot && !activeStop) return false;
    if (args.isTakeoverReply === true && paused && !streaming) return false;
    return paused || (!forceInterrupt && metrics.observations.busy);
  };
  const enabled = button => !!button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  const wait = async (ms, renew = true) => {
    // Hidden-page timers can be clamped beyond the round deadline. New workers
    // own the clock; older workers retain the previous adapter contract.
    if (args.extensionClock === true) {
      let reply;
      try { reply = await chrome.runtime.sendMessage({ type: 'WAIT_RUN', runId: args.runId, delayMs: ms, ...(!renew ? { renew: false } : {}) }); }
      catch (error) { metrics.counters.transportErrors++; throw error; }
      if (reply?.allowed === true) grantedDeadline(reply.runDeadline);
      if (reply?.ok === true && reply.allowed === false) revoked = true;
      if (reply?.ok !== true || reply.allowed !== true || !samePage() || !withinDeadline()) {
        throw new Error('run-wait-cancelled');
      }
      return;
    }
    await new Promise(resolve => setTimeout(resolve, ms));
  };

  const stillAllowed = async () => {
    while (samePage() && !revoked && (args.resultToken || withinDeadline())) {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return false;
      try {
        metrics.counters.authorizationChecks++;
        const reply = await chrome.runtime.sendMessage({ type: 'CHECK_RUN', runId: args.runId });
        if (reply?.allowed === true) grantedDeadline(reply.runDeadline);
        if (reply?.ok === true && reply.allowed === false) { revoked = true; return false; }
        if (reply?.ok === true && reply.allowed === true) {
          if (!samePage() || revoked) return false;
          if (withinDeadline()) return true;
          // A delayed positive reply is not a Pause. Ask for a fresh permit;
          // never dispatch with the expired one or cancel a live pending send.
        }
      } catch { metrics.counters.transportErrors++; /* A transport rejection is not an explicit Pause or revocation. */ }
      if (args.persistentDelivery !== true || args.unlimitedReadiness !== true) return false;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    return false;
  };

  if (!samePage()) return result('blocked', '目标会话地址已改变，已停止发送。');
  if (!['ctrl-enter', 'button', 'auto'].includes(sendMethod)) return result('blocked', '发送方式无效，请重新选择。');

  const editorSelector = isDot
    ? '[data-composer-input] [contenteditable="true"][role="textbox"][aria-label="Message"], [contenteditable="true"][role="textbox"][data-composer-markdown], [data-composer-input] [contenteditable="true"], [data-composer-markdown][contenteditable="true"]'
    : '#prompt-textarea, form[data-chatgpt-composer] .ProseMirror[contenteditable="true"], .ProseMirror[contenteditable="true"]';

  const findComposer = () => {
    const editors = [...new Set(visibleMatches(editorSelector))];
    if (editors.length !== 1) return null;
    const editor = editors[0];
    return {
      editor,
      composer: editor.closest('[data-composer-root]') || editor.closest('form') || editor.closest('[data-composer-body]') || editor.closest('[data-composer-footer-responsive]') || editor.parentElement
    };
  };

  const closedSignInCardPattern = /\bsign[\s-]?in\s+request\s+(?:closed|completed|canceled|cancelled|dismissed|done)\b|登录请求\s*(?:已关闭|已完成|已取消|已结束)/i;
  const stripClosedSignInLines = value => String(value ?? '').split(/\r?\n/).filter(line => !closedSignInCardPattern.test(line)).join('\n');
  const takeoverRequestPattern = /把控制权交回|交回控制权|归还控制权|请.*完成(?:GitHub|OAuth|页面|登录|授权|两步验证|2FA|验证).*交回|请.*手动登录|请.*接管.*登录|完成授权并|请回复.*授权|接管浏览器|请求接管|需要(?:你|您)?接管|请(?:你|您)?(?:先|帮忙)?(?:接管|登录|授权)|请确认我(?:可以|是否|能否)|请确认(?:后|能否|是否可)|请确认.*(?:接受|继续|执行|提交|推送|安装|配置|运行|操作|处理|clone|PR)|需要(?:你|您)?确认(?:我)?(?:可以|是否|能否)|是否(?:允许|同意|需要)我|请.{0,12}(?:提供|输入|完成).{0,12}(?:两步验证|2FA|验证码|口令)|需要(?:你|您)?.{0,12}(?:提供|输入|完成|确认).{0,12}(?:两步验证|2FA|验证码|口令)|登录请求(?!\s*(?:已关闭|已完成|已取消|已结束))|请先完成.{0,16}(?:登录|授权|验证|2FA)|需要(?:你|您)?手动完成.{0,16}(?:登录|授权|验证|2FA)|\b(?:give|hand)\s+(?:me\s+)?control\s+back\b|\bhand\s+back\s+control\b|\breturn\s+(?:browser\s+)?control\b|\btake\s+over\s+(?:the\s+)?browser\b|\btake\s+over\s+and\s+(?:sign\s+in|log\s+in|authenticate|verify)\b|\b(?:please\s+confirm|confirm)\s+(?:that\s+)?(?:I\s+can|I\s+may|I\s+should|whether\s+I|if\s+I|before\s+I|to\s+proceed)\b|\b(?:should|shall|may)\s+I\s+(?:proceed|continue|accept|push|open|create|submit|install|run|clone|merge)\b|\bawaiting\s+your\s+(?:confirmation|approval|go-ahead)\b|\b(?:please|could\s+you|need\s+you\s+to)\s+(?:[\w'-]+\s+){0,4}(?:take\s+over|sign\s+in|log\s+in|2fa|two-factor|verification\s+code|one-time\s+code)\b|\b(?:sign\s+in|log\s+in)\s+to\s+[a-z0-9.-]+\b|\bsign[\s-]?in\s+request\b(?!\s*(?:closed|completed|canceled|cancelled|dismissed|done))|\byour\s+dot\s+(?:needs|wants)\s+you\s+to\s+(?:sign\s+in|log\s+in|take\s+over|verify)\b|\bcomplete\s+(?:the\s+)?(?:sign[\s-]?in|log[\s-]?in|login|authentication|authorization|2fa|two-factor).*(?:control|continue|proceed)\b/i;
  const dotSignInModalPattern = /\bsign[\s-]?in\s+request\b(?!\s*(?:closed|completed|canceled|cancelled|dismissed|done))|\btake\s+over\s+(?:the\s+)?browser\b|登录请求(?!\s*(?:已关闭|已完成|已取消|已结束))|接管浏览器|请求接管/i;
  const dotInlineCardTextPattern = /\b(?:sign\s*in|log\s*in)\s+to\s+[a-z0-9.-]+\b|\bsign[\s-]?in\s+request\b(?!\s*(?:closed|completed|canceled|cancelled|dismissed|done))|\b(?:accounts\.google\.com|login\.microsoftonline\.com|github\.com|appleid\.apple\.com)\b|登录请求(?!\s*(?:已关闭|已完成|已取消|已结束))|接管浏览器|请求接管/i;
  const dotInlineAuthButtonPattern = /^(?:sign\s*in|log\s*in|login|authorize|re-?authorize|connect\s+account|take\s+over|登录|去登录|授权登录|同意并登录|接管)$/i;
  const dotCardTokenMap = (globalThis.__agentContinueCardTokens ??= new WeakMap());
  const strictCaptchaPattern = /\b(?:captcha|recaptcha|hcaptcha|turnstile|altcha|verify\s+you\s+are\s+human)\b|人机验证|图形验证码/i;
  const captchaOr2FAPattern = /\b(?:captcha|recaptcha|hcaptcha|turnstile|altcha|verify\s+you\s+are\s+human|one-time\s+(?:code|password)|2fa\s+code|verification\s+code|enter\s+(?:your\s+)?password)\b|人机验证|图形验证码|短信验证码|邮箱验证码|输入密码|动态口令/i;

  const detectCaptchaOr2FABlock = () => {
    if (document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], .cf-turnstile, .g-recaptcha')) {
      return true;
    }
    const last = [...document.querySelectorAll(assistantSelector)].at(-1);
    const txt = last ? textOf(last) : '';
    const pattern = (isDot && args.autoAuthorizeTakeover === true) ? strictCaptchaPattern : captchaOr2FAPattern;
    return Boolean(txt && pattern.test(txt));
  };

  const authTextPattern = /\b(?:sign\s*in(?:\s+with|\s+to)?|log\s*in(?:\s+with|\s+to)?|login|oauth|re-?authorize|authorize\s+(?:app|with|account)|connect\s+(?:your\s+)?account|link\s+account|session\s+expired|continue\s+with\s+(?:google|microsoft|apple|github|facebook)|password|2fa|two-factor)\b|使用\s*(?:Google|Apple|Microsoft|GitHub)\s*登录|(?:通过|使用)\s*.+\s*账号登录|会话已过期|重新登录|授权登录|同意登录|同意并登录|去登录|连接账号|关联账号|绑定账号/i;

  const detectSessionExpiredOrOffSite = () => {
    const title = String(document.title || '');
    const pathname = String(location.pathname || '');
    const hostname = String(location.hostname || '');
    if (/(?:accounts\.google\.com|login\.microsoftonline\.com|github\.com|appleid\.apple\.com)$/i.test(hostname)) return 'oauth-popup';
    const hasLoginSignals = /sign\s+in|session\s+expired|log\s*in|your\s+session|登录|会话已过期|重新登录/i.test(title)
      || /^\/(?:auth\/|login|signin)/i.test(pathname);
    const loginForm = document.querySelector('[data-testid="login-button"], form[action*="login"]');
    if ((hasLoginSignals && loginForm) || (loginForm && !findComposer())) return 'session-expired';
    return null;
  };

  const detectAuthOrLoginBlock = () => {
    const offSiteOrExpired = detectSessionExpiredOrOffSite();
    if (offSiteOrExpired) return offSiteOrExpired;
    if (isDot && args.autoAuthorizeTakeover === true) {
      return null;
    }
    try {
      const classified = globalThis.__agentContinueClassifyDialog?.();
      if (classified && classified.safe === false) return classified.kind || 'oauth-popup';
    } catch {}
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]')];
    for (const dlg of dialogs) {
      if (!visible(dlg)) continue;
      if (dlg.closest?.('article.message-row, [data-message-author-role="assistant"], [data-chatgpt-search-unit-key$=":assistant"]')) continue;
      if (dlg.querySelector('a[href*="accounts.google.com"], a[href*="login.microsoftonline.com"], a[href*="github.com/login/oauth"], a[href*="appleid.apple.com"], button[data-href*="accounts.google.com"], button[data-href*="login.microsoftonline.com"]')) {
        return 'oauth-popup';
      }
      if (authTextPattern.test(dlg.textContent || '')) return 'oauth-popup';
    }
    return null;
  };

  const clickTargetDom = el => {
    if (!el || !el.isConnected) return;
    try { el.focus?.({ preventScroll: true }); } catch {}
    const mouseInit = { bubbles: true, composed: true, cancelable: true, view: window, button: 0, buttons: 1 };
    const pointerInit = { ...mouseInit, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    try { el.dispatchEvent(new PointerEvent('pointerover', pointerInit)); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseover', mouseInit)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerdown', pointerInit)); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', mouseInit)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', { ...pointerInit, buttons: 0 })); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', { ...mouseInit, buttons: 0 })); } catch {}
    try { el.click(); } catch {}
  };

  const findDotSignInCard = () => {
    if (!isDot) return null;
    const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]');
    for (const dlg of dialogs) {
      if (!visible(dlg)) continue;
      const raw = (dlg.innerText ?? dlg.textContent ?? '').trim();
      const dlgText = stripClosedSignInLines(raw);
      if (!dlgText || !dotSignInModalPattern.test(dlgText) || captchaOr2FAPattern.test(dlgText)) continue;
      let token = dotCardTokenMap.get(dlg);
      if (!token) {
        token = 'card:' + clean(dlgText).slice(0, 120);
        dotCardTokenMap.set(dlg, token);
      }
      return { el: dlg, text: dlgText, token, surface: 'modal' };
    }
    const userTurns = document.querySelectorAll(userSelector);
    const lastUserTurn = userTurns.length ? userTurns[userTurns.length - 1] : null;
    const userCount = userTurns.length;
    const btns = document.querySelectorAll('button, [role="button"]');
    for (let i = 0; i < btns.length; i++) {
      const btn = btns[i];
      if (!btn?.isConnected || btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
      const txt = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt || txt.length > 48 || !dotInlineAuthButtonPattern.test(txt) || !visible(btn)) continue;
      let curr = btn.parentElement;
      for (let depth = 0; depth < 8 && curr && curr !== document.body && curr !== document.documentElement; depth++, curr = curr.parentElement) {
        if (!visible(curr)) break;
        const raw = (curr.innerText ?? curr.textContent ?? '').trim();
        const cardText = stripClosedSignInLines(raw);
        if (!cardText || cardText.length > 1500) break;
        if (curr.querySelectorAll('article.message-row, [data-message-author-role], [role="textbox"]').length > 1) break;
        if (closedSignInCardPattern.test(raw)) break;
        if (dotInlineCardTextPattern.test(cardText) && !captchaOr2FAPattern.test(cardText)) {
          if (lastUserTurn && (curr.compareDocumentPosition(lastUserTurn) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
          let token = dotCardTokenMap.get(curr);
          if (!token) {
            token = `card:${userCount}:` + clean(cardText).slice(0, 120);
            dotCardTokenMap.set(curr, token);
          }
          return { el: curr, text: cardText, token, surface: 'inline-card' };
        }
      }
    }
    return null;
  };

  const tryReturnBrowserControl = () => {
    if (args.autoAuthorizeTakeover !== true) return null;
    if (detectCaptchaOr2FABlock()) {
      metrics.observations.busy = true;
      return result('blocked', '检测到需要人工完成人机验证或密码/验证码，已暂停等待处理。', 'captcha-required', { surface: 'modal', evidenceFlags: ['captcha-widget'] });
    }
    const handbackPattern = /^(?:give\s+control\s+back|hand\s+(?:control\s+)?back|return\s+control|交回控制权|归还控制权)$/i;
    const controlButtons = [];
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      const txt = (el.textContent || '').trim();
      if (!txt || txt.length > 48 || !handbackPattern.test(txt)) continue;
      if (visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true') controlButtons.push(el);
    }
    if (controlButtons.length === 1) {
      const btn = controlButtons[0];
      const btnTxt = (btn.textContent || '').trim();
      const optionKind = /return|归还/i.test(btnTxt) ? 'return-control' : 'give-control-back';
      const nowMs = Date.now();
      const cardMap = (globalThis.__agentContinueAllowedCards ??= new WeakMap());
      const lastClickedAt = Math.max(cardMap.get(btn) || 0, Number(btn.getAttribute('data-agent-continue-allowed') || 0));
      if (lastClickedAt > 0 && nowMs - lastClickedAt < 4000) {
        metrics.observations.busy = true;
        return result('busy', '已自动归还控制权并继续等待 Dot 推进。', 'auto-allowed-prompt', { surface: 'page', optionKind });
      }
      cardMap.set(btn, nowMs);
      try { btn.setAttribute('data-agent-continue-allowed', String(nowMs)); } catch {}
      clickTargetDom(btn);
      metrics.observations.busy = true;
      return result('busy', '已自动归还控制权并继续等待 Dot 推进。', 'auto-allowed-prompt', { surface: 'page', optionKind });
    }
    if (!isDot) return null;
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]')];
    for (const dlg of dialogs) {
      if (!visible(dlg)) continue;
      const dlgText = stripClosedSignInLines((dlg.innerText ?? dlg.textContent ?? '').trim());
      if (!dlgText || !dotSignInModalPattern.test(dlgText) || captchaOr2FAPattern.test(dlgText)) continue;
      const dismissBtns = [...dlg.querySelectorAll('button, [role="button"]')].filter(el => {
        if (!visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
        const label = (el.getAttribute('aria-label') || '').trim();
        if (/take\s+over|接管/i.test(txt) || /take\s+over|接管/i.test(label)) return false;
        return /^(?:close|dismiss|cancel|not\s+now|skip|关闭|取消|忽略|暂不|×|✕)$/i.test(txt)
          || /^(?:close|dismiss|cancel|关闭|取消)\b/i.test(label);
      });
      if (dismissBtns.length !== 1) continue;
      const btn = dismissBtns[0];
      const nowMs = Date.now();
      const cardMap = (globalThis.__agentContinueAllowedCards ??= new WeakMap());
      const lastClickedAt = Math.max(cardMap.get(dlg) || 0, Number(dlg.getAttribute('data-agent-continue-allowed') || 0));
      if (lastClickedAt > 0 && nowMs - lastClickedAt < 4000) {
        metrics.observations.busy = true;
        return result('busy', '已自动处理 Dot 登录接管请求，继续等待推进。', 'auto-allowed-prompt', { surface: 'modal', optionKind: 'close', evidenceFlags: ['role-dialog', 'sign-in-card', 'close-button'] });
      }
      cardMap.set(dlg, nowMs);
      try { dlg.setAttribute('data-agent-continue-allowed', String(nowMs)); } catch {}
      clickTargetDom(btn);
      metrics.observations.busy = true;
      return result('busy', '已自动处理 Dot 登录接管请求，继续等待推进。', 'auto-allowed-prompt', { surface: 'modal', optionKind: 'close', evidenceFlags: ['role-dialog', 'sign-in-card', 'close-button'] });
    }
    return null;
  };

  function checkTakeoverConversationPrompt(allowWhenPaused = false) {
    if (args.autoAuthorizeTakeover !== true || (args.mode !== 'send' && args.detectTakeover !== true) || args.isTakeoverReply === true) return null;
    if (detectCaptchaOr2FABlock()) {
      metrics.observations.busy = true;
      return result('blocked', '检测到需要人工完成人机验证或密码/验证码，已暂停等待处理。', 'captcha-required', { surface: 'modal', evidenceFlags: ['captcha-widget'] });
    }
    const card = findDotSignInCard();
    if (card && card.token && card.token !== args.lastTakeoverToken) {
      metrics.observations.busy = true;
      return {
        ...result('busy', '检测到 Dot 请求接管或登录授权确认，准备自动发送授权回复。', 'takeover-needed', {
          surface: card.surface || 'inline-card',
          evidenceFlags: card.surface === 'modal' ? ['role-dialog', 'sign-in-card'] : ['sign-in-card'],
        }),
        takeoverAssistantToken: card.token,
      };
    }
    const activeStop = visibleMatches(stopSelector).length > 0;
    const streamingBusy = visibleMatches(busySelector).length > 0;
    if (allowWhenPaused ? (isDot ? activeStop : streamingBusy) : busy()) return null;
    const last = [...document.querySelectorAll(assistantSelector)].at(-1);
    if (last) {
      const bodyText = stripClosedSignInLines(textOf(last));
      if (bodyText && takeoverRequestPattern.test(bodyText)) {
        const assistantToken = messageKey(last) || clean(bodyText).slice(-120);
        if (assistantToken && assistantToken !== args.lastTakeoverToken) {
          metrics.observations.busy = true;
          return {
            ...result('busy', '检测到 Dot 请求接管或登录授权确认，准备自动发送授权回复。', 'takeover-needed', {
              surface: 'assistant-turn',
              evidenceFlags: ['takeover-phrase'],
            }),
            takeoverAssistantToken: assistantToken,
          };
        }
      }
    }
    return null;
  }

  const pausedResult = () => result('busy', 'Agent 处于暂停状态，等待继续或完成后发送。', 'agent-paused', { surface: 'page', evidenceFlags: ['dot-paused-badge'] });
  if (isDotPaused() && args.isTakeoverReply !== true) {
    const handover = tryReturnBrowserControl();
    if (handover) return handover;
    const takeover = checkTakeoverConversationPrompt(true);
    if (takeover) return takeover;
    metrics.observations.busy = true;
    return pausedResult();
  }
  const initial = findComposer();
  if (!initial) {
    if (args.autoAuthorizeTakeover === true) {
      const handover = tryReturnBrowserControl();
      if (handover) return handover;
      const takeover = checkTakeoverConversationPrompt(true);
      if (takeover) return takeover;
    }
    if (args.autoAllow === true && detectAuthOrLoginBlock()) {
      metrics.observations.busy = true;
      return result('blocked', '检测到需要手动登录或 OAuth 授权的弹窗，已暂停等待处理。', 'oauth-required', { surface: 'modal', evidenceFlags: ['oauth-text', 'no-composer'] });
    }
    if (visibleMatches(busySelector).length > 0 || visibleMatches(pauseSelector).length > 0) {
      metrics.observations.busy = true;
      return result('busy', 'Agent 仍在运行，稍后再次检查。', 'agent-busy', { surface: 'page', evidenceFlags: ['assistant-busy'] });
    }
    return result('blocked', '未识别到唯一输入框。页面可能尚未加载、已退出登录，或界面结构已变化。', 'composer-unavailable', { surface: 'page', evidenceFlags: ['no-composer'] });
  }
  let { editor, composer } = initial;
  metrics.observations.composerPresent = true;
  metrics.observations.hidden = document.visibilityState === 'hidden';
  const sameComposer = () => {
    const current = findComposer();
    metrics.observations.composerPresent = !!current;
    return current?.editor === editor && current.composer === composer;
  };
  if (args.autoAllow === true && detectAuthOrLoginBlock()) {
    if (isDot && args.autoAuthorizeTakeover === true && detectSessionExpiredOrOffSite() !== 'session-expired') {
      const handover = tryReturnBrowserControl();
      if (handover) return handover;
      const takeover = checkTakeoverConversationPrompt(true);
      if (takeover) return takeover;
    }
    metrics.observations.busy = true;
    return result('blocked', '检测到需要手动登录或 OAuth 授权的弹窗，已暂停等待处理。', 'oauth-required', { surface: 'modal', evidenceFlags: ['oauth-text', 'composer-present'] });
  }
  if (isDot && !identity()) return result('blocked', '等待 dot 会话历史加载，暂时无法核对目标身份。');

  // Guard drafts containing attachments/chips as well as plain text.
  const removeAttachmentSelector = 'button[aria-label^="Remove file"], button[aria-label^="Remove attachment"], button[aria-label^="移除文件"], button[aria-label^="删除附件"], button[data-testid*="remove-file"], button[data-testid*="remove-attachment"], [data-file-id] button[aria-label="Remove"], [data-testid*="attachment"] button[aria-label="Remove"]';
  const hasAttachment = () => !!composer && ([...composer.querySelectorAll('[data-testid*="attachment"], [data-file-id], ' + removeAttachmentSelector)].some(visible)
    || [...composer.querySelectorAll('input[type="file"]')].some(input => input.files?.length));
  const prompt = String(args.prompt ?? '');
  const normalizeLineEndings = value => value.replace(/\r\n?/g, '\n');

  // Native contenteditable insertion represents line breaks as DIV/P blocks.
  // innerText adds an extra newline for an empty final block. Reconstruct only
  // these plain editing structures; never trim/collapse a human's whitespace.
  const inlineFormatting = new Set(['A', 'B', 'CODE', 'DEL', 'EM', 'FONT', 'I', 'MARK', 'S', 'SMALL', 'STRONG', 'SUB', 'SUP', 'U']);
  const markdownBlocks = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE']);
  const decorativeNodes = new Set(['SVG', 'PATH', 'G', 'CIRCLE', 'RECT', 'LINE', 'POLYGON', 'POLYLINE', 'USE', 'IMG', 'WBR', 'BUTTON', 'TIME', 'LABEL', 'ASIDE']);
  const serializeDraft = (node, allowFormatting = false, root = editor) => {
    if (node.nodeType === Node.TEXT_NODE) return node.data;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (decorativeNodes.has(node.tagName)) return '';
    if (node.getAttribute('contenteditable') === 'false') {
      if (node === root) return null;
      const text = node.innerText ?? node.textContent ?? '';
      if (!text.trim()) return '';
      return text;
    }
    if (node.tagName === 'BR') return '\n';
    if (allowFormatting && node.tagName === 'HR') return '---';
    if (node !== root && !['DIV', 'P', 'SPAN'].includes(node.tagName) && !(allowFormatting && (inlineFormatting.has(node.tagName) || markdownBlocks.has(node.tagName)))) return null;
    const children = [...node.childNodes];
    if (node === root && children.length === 1 && children[0].nodeName === 'BR') return '';
    if (node !== root && (['DIV', 'P'].includes(node.tagName) || (allowFormatting && markdownBlocks.has(node.tagName))) && children.length === 1 && children[0].nodeName === 'BR') return '';
    let value = '';
    let previousBlock = false;
    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      const block = ['DIV', 'P'].includes(child.nodeName) || (allowFormatting && (child.nodeName === 'HR' || (markdownBlocks.has(child.nodeName) && !['UL', 'OL'].includes(child.nodeName))));
      const part = serializeDraft(child, allowFormatting, root);
      if (part === null) return null;
      if (index > 0 && (block || previousBlock)) value += '\n';
      value += part;
      previousBlock = block;
    }
    return value;
  };
  const plainDraft = (node, allowFormatting = false, root = editor) => {
    const clock = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
    const start = clock();
    try { return serializeDraft(node, allowFormatting, root); }
    finally {
      const elapsed = Math.max(0, clock() - start);
      metrics.timings.serializationMs += elapsed;
      metrics.timings.maxSerializationMs = Math.max(metrics.timings.maxSerializationMs, elapsed);
    }
  };
  // Rendered innerText may change when the same plain content is rewrapped
  // by the page. Compare exact logical text, including whitespace. For rich
  // content we cannot serialize, require the exact markup and visible text.
  const snapshotDraft = () => {
    if (editor instanceof HTMLTextAreaElement) return { plain: editor.value };
    const plain = plainDraft(editor);
    return plain === null ? { plain, markup: editor.innerHTML, rendered: textOf(editor) } : { plain };
  };
  const draftUnchanged = snapshot => {
    if (!snapshot || !editor.isConnected || hasAttachment()) return false;
    const current = snapshotDraft();
    return current.plain === snapshot.plain && (current.plain !== null ||
      (current.markup === snapshot.markup && current.rendered === snapshot.rendered));
  };
  const protectedDraft = message => result('draft', message, 'existing-draft');

  const editable = () => !editor.disabled && !editor.readOnly && (editor.isContentEditable || editor instanceof HTMLTextAreaElement);

  function extractOptionText(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.data || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (['SVG', 'PATH', 'G', 'CIRCLE', 'RECT', 'LINE', 'POLYGON', 'POLYLINE', 'USE', 'IMG', 'SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.tagName)) return '';
    if (node.hasAttribute('hidden')) return '';
    const parts = [];
    for (const child of node.childNodes) {
      const piece = extractOptionText(child).trim();
      if (piece) parts.push(piece);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  const classifyOptionText = rawInput => {
    const raw = String(rawInput ?? '').replace(/[\s✓✔☑→›↗]+$/g, '').trim();
    if (!raw || raw.length > 56) return null;
    const hasLetterBadge = /^(?:\(?[A-D]\)?[\s.:\-]+|[A-D]\s+|[A-D](?=[A-Z\u4e00-\u9fa5]))/.test(raw);
    const badgeNormalized = raw.replace(/^([A-D1-4])(?=[A-Z\u4e00-\u9fa5])/, '$1 ');
    const core = badgeNormalized.replace(/^(?:\(?[A-D1-4]\)?[\s.:\-]+|[A-D1-4]\s+)/i, '').trim().toLowerCase();
    const hasBadge = core.length < badgeNormalized.trim().length;
    if (!core) return null;
    if ([
      'deny', 'decline', 'reject', "don't allow", 'do not allow', 'never allow', 'cancel',
      'dismiss', 'skip', 'not now', 'no', 'no, thanks', 'disagree', 'block', 'abort',
      '拒绝', '不允许', '取消', '驳回', '跳过', '暂不', '稍后', '不用了', '否', '不同意', '阻止', '忽略',
    ].includes(core)) {
      return { kind: 'deny', priority: 0, raw, core, hasBadge, hasLetterBadge, highConfidence: false };
    }
    if (/\b(?:don't|do\s+not|never|not\s+now|no\b|cancel|deny|decline|reject|dismiss|skip|disagree|disconnect|unlink|revoke|remove|delete|sign\s*out|log\s*out|block|abort)\b|不要|不允许|拒绝|取消|驳回|跳过|暂不|稍后|不用|不同意|断开|解除|撤销|退出|注销|删除|阻止|忽略/i.test(core)) {
      return null;
    }
    if ([
      'always allow', 'allow always', 'always approve', 'always permit', 'allow all',
      'always accept', 'trust always', 'always continue',
      '始终允许', '总是允许', '一直允许', '全部允许', '始终同意', '始终批准', '始终授权',
    ].includes(core) || /^(?:always\s+(?:allow|approve|permit|accept|continue)|始终允许|总是允许|一直允许)\b/i.test(core)) {
      return { kind: 'always-allow', priority: 3, raw, core, hasBadge, hasLetterBadge, highConfidence: true };
    }
    if ([
      'allow this tool for this conversation', 'allow for this conversation', 'allow tool for this conversation', 'allow for conversation',
      '本会话允许此工具', '此对话允许此工具',
    ].includes(core) || /^allow\s+(?:this\s+tool\s+)?for\s+(?:this\s+)?conversation\b/i.test(core)) {
      return { kind: 'always-allow', priority: 2, raw, core, hasBadge, hasLetterBadge, highConfidence: true };
    }
    if ([
      'allow once', 'allow this time', 'approve once', 'just once', 'only this time', 'permit once',
      '允许一次', '仅允许一次', '本次允许', '仅此一次', '这次允许',
    ].includes(core) || /^(?:allow\s+once|allow\s+this\s+time|approve\s+once|允许一次|仅允许一次|本次允许)\b/i.test(core)) {
      return { kind: 'allow-once', priority: 2, raw, core, hasBadge, hasLetterBadge, highConfidence: true };
    }
    if ([
      'allow', 'allow access', 'grant access', 'grant permission',
      'authorize', 'authorize access', 'authorize app', 'reauthorize', 're-authorize',
      'agree and continue', 'accept and continue', 'confirm and continue',
      'yes, allow', 'yes, continue', 'yes, confirm', 'yes, approve', 'yes, authorize',
      'connect account', 'link account',
      '允许', '允许访问', '授予权限', '授权', '确认授权', '同意授权', '授权并继续', '去授权', '重新授权',
      '确认允许', '同意并继续', '确认并继续', '授权登录', '同意登录', '同意并登录', '去登录', '重新登录',
      '连接账号', '关联账号', '绑定账号',
    ].includes(core)
      || /^(?:allow\s+access|grant\s+access|authorize|re-?authorize|sign\s+in\s+(?:to|with)|log\s*in\s+(?:to|with)|connect\s+(?:to|with)|continue\s+with)\s+\S+/i.test(core)
      || /^(?:允许访问|授权给?|连接(?:到|至)|使用\s*.+\s*登录|通过\s*.+\s*登录|登录(?:到))\s*\S+/.test(core)) {
      return { kind: 'allow', priority: 1, raw, core, hasBadge, hasLetterBadge, highConfidence: true };
    }
    if ([
      'approve', 'confirm', 'accept', 'agree', 'i agree', 'continue', 'proceed', 'yes',
      'sign in', 'log in', 'login', 'connect', 'reconnect', 'enable', 'turn on', 'run', 'execute',
      '批准', '确认', '接受', '同意', '我同意', '继续', '是', '是的', '确定',
      '登录', '连接', '重新连接', '启用', '开启', '运行', '执行',
    ].includes(core)) {
      return { kind: 'allow', priority: 1, raw, core, hasBadge, hasLetterBadge, highConfidence: hasLetterBadge };
    }
    return null;
  };

  const findApprovalPrompt = (returnDetails = false) => {
    const selector = 'button, [role="button"], [role="option"], [role="radio"], [role="menuitem"], label, li, a, div, span';
    const excludedSelector = '[data-message-author-role="user"], article.message-row.self, article.self, pre, code, nav, header, aside, footer, [role="navigation"], [role="banner"], [data-testid*="sidebar"]';
    const rawMatched = [];
    const seenVisited = new Set();
    const scanRoot = root => {
      let nodes = [];
      try { nodes = root.querySelectorAll(selector); } catch { return; }
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (seenVisited.has(el)) continue;
        seenVisited.add(el);
        if (el.shadowRoot) scanRoot(el.shadowRoot);
        if (el.childElementCount > 4) continue;
        const rawTC = el.textContent;
        if (!rawTC || rawTC.length > 80) continue;
        const info = classifyOptionText(extractOptionText(el));
        if (!info) continue;
        if (editor && (el === editor || editor.contains(el))) continue;
        if (composer && (el === composer || composer.contains(el))) continue;
        if (el.closest?.(excludedSelector)) continue;
        if (el.tagName === 'A' && el.hasAttribute('href') && !el.matches?.('[role="button"]') && !/oauth|authorize|connect|login|signin|auth/i.test(el.getAttribute('href') || '')) continue;
        if (!visible(el)) continue;
        rawMatched.push({ el, info });
      }
    };
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]')];
    const recentAssistantTurns = [...document.querySelectorAll('article.message-row:not(.self), [data-message-author-role="assistant"], [data-chatgpt-search-unit-key$=":assistant"]')].slice(-2);
    const roots = [...dialogs, ...recentAssistantTurns];
    if (isDot) {
      const feedNode = recentAssistantTurns.at(-1)?.parentElement?.closest?.('main')
        || recentAssistantTurns.at(-1)?.parentElement
        || null;
      const candidateButtons = feedNode
        ? feedNode.querySelectorAll('button, [role="button"], [role="option"], [role="radio"]')
        : (args.autoAllow === true || args.autoAuthorizeTakeover === true
          ? document.querySelectorAll('button, [role="button"], [role="option"], [role="radio"]')
          : []);
      for (const el of candidateButtons) {
        if (!el?.isConnected || el.childElementCount > 4) continue;
        const txt = el.textContent?.trim();
        if (!txt || txt.length > 40 || !/^(?:deny|decline|reject|don't allow|do not allow|never allow|拒绝|不允许|驳回)$/i.test(txt)) continue;
        if (el.closest?.(excludedSelector) || !visible(el)) continue;
        let curr = el.parentElement;
        for (let depth = 0; depth < 6 && curr && curr !== document.body && curr !== document.documentElement; depth++, curr = curr.parentElement) {
          if (curr.closest?.(excludedSelector)) break;
          if ((curr.textContent || '').length > 1500) break;
          if (curr.querySelectorAll('article.message-row, [data-message-author-role]').length > 1) break;
          if (!roots.includes(curr) && !roots.some(r => r.contains(curr)) && curr.querySelectorAll('button, [role="button"], [role="option"], [role="radio"]').length >= 2) {
            roots.push(curr);
            break;
          }
        }
      }
    }
    for (const root of roots) scanRoot(root);
    if (!rawMatched.length) return returnDetails ? null : false;

    // Collapse nested parent-child chains that represent a single option pill/button.
    const leafItems = rawMatched.filter(item =>
      !rawMatched.some(other => other.el !== item.el && item.el.contains(other.el) && other.info.kind === item.info.kind)
    );
    const semanticSelector = 'button, [role="button"], [role="option"], [role="radio"], [role="menuitem"], a, label, input[type="button"], input[type="submit"]';
    const options = [];
    const seenPills = new Set();
    for (const leaf of leafItems) {
      const chain = rawMatched
        .filter(item => item.info.kind === leaf.info.kind && (item.el === leaf.el || item.el.contains(leaf.el)))
        .sort((a, b) => (a.el === b.el ? 0 : a.el.contains(b.el) ? -1 : 1)); // outermost to innermost
      let pill = [...chain].reverse().find(item => item.el.matches?.(semanticSelector));
      let isInteractive = Boolean(pill);
      if (!pill) {
        pill = [...chain].reverse().find(item => item.info.hasBadge || item.el.children?.length >= 2);
        if (pill && pill.info?.hasLetterBadge) isInteractive = true;
      }
      if (!pill) {
        const pointerPill = [...chain].reverse().find(item => {
          try { return item.el.tabIndex >= 0 || getComputedStyle(item.el).cursor === 'pointer'; }
          catch { return false; }
        });
        if (pointerPill) {
          pill = pointerPill;
          isInteractive = true;
        } else {
          pill = chain[0];
        }
      }
      if (!isInteractive) {
        try {
          if (pill.info.hasLetterBadge || pill.el.tabIndex >= 0 || getComputedStyle(pill.el).cursor === 'pointer') {
            isInteractive = true;
          }
        } catch {}
      }
      if (seenPills.has(pill.el)) continue;
      seenPills.add(pill.el);
      options.push({ pillEl: pill.el, leafEl: leaf.el, info: pill.info, isInteractive });
    }

    const allowOptions = options.filter(o => o.info.priority > 0);
    const denyOptions = options.filter(o => o.info.kind === 'deny');
    if (!allowOptions.length) return returnDetails ? null : false;

    const approvalPromptPattern = /allow\s+chatgpt\s+to\b|wants\s+to\s+(?:use|call|run|access|search|read|write|execute|connect|open|view|edit|send|create|update|delete)\b|permission\s+to\s+(?:use|run|access|connect|read|write)|authorize\s+.+\s+to\b|requires?\s+(?:authorization|authentication|permission|sign[\s-]?in|log[\s-]?in)|(?:connect|link|sign\s+in\s+to|log\s+in\s+to|authorize)\s+(?:your\s+)?[a-z0-9_.\s-]{1,40}\s*(?:account|workspace|integration|connector|app)?|to\s+continue,?\s+(?:please\s+)?(?:sign\s+in|log\s+in|connect|authorize|allow|confirm)|confirm\s+(?:this\s+)?(?:action|request|tool|operation)|是否允许\s*chatgpt|允许\s*chatgpt\s*(?:使用|访问|调用|搜索|读取|执行|连接|查看|修改)|(?:需要|请求|请先?)\s*(?:授权|登录|连接|确认权限|允许访问)|(?:连接|关联|绑定|登录|授权)\s*(?:你的|您的)?\s*[^\s，。！？]{1,30}\s*(?:账号|账户|工作区|应用|服务)?/i;
    const assistantOrDialogSelector = 'article.message-row:not(.self), [data-message-author-role="assistant"], [data-chatgpt-search-unit-key$=":assistant"], [role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]';
    const findLCA = (a, b) => {
      for (let curr = a; curr && curr !== document.body && curr !== document.documentElement && curr.tagName !== 'MAIN'; curr = curr.parentElement) {
        if (curr.contains(b)) return curr;
      }
      return null;
    };

    for (const allowOpt of [...allowOptions].reverse()) {
      let groupContainer = null;
      let pairedDeny = null;
      for (const denyOpt of denyOptions) {
        if (denyOpt.pillEl === allowOpt.pillEl) continue;
        const lca = findLCA(allowOpt.pillEl, denyOpt.pillEl);
        if (!lca || lca.querySelectorAll('article.message-row, [data-message-author-role]').length > 1) continue;
        if (!groupContainer || groupContainer.contains(lca)) {
          groupContainer = lca;
          pairedDeny = denyOpt;
        }
      }
      if (groupContainer && pairedDeny) {
        const stolenFromTighterCard = allowOptions.some(otherAllow => {
          if (otherAllow === allowOpt) return false;
          const otherLca = findLCA(otherAllow.pillEl, pairedDeny.pillEl);
          return Boolean(otherLca && otherLca !== groupContainer && groupContainer.contains(otherLca));
        });
        if (stolenFromTighterCard) {
          groupContainer = null;
          pairedDeny = null;
        }
      }
      if (!groupContainer) {
        if (!allowOpt.isInteractive || !allowOpt.pillEl.closest?.(assistantOrDialogSelector)) continue;
        let curr = allowOpt.pillEl.parentElement;
        for (let depth = 0; depth < 12 && curr && curr !== document.body && curr !== document.documentElement && curr.tagName !== 'MAIN'; depth++, curr = curr.parentElement) {
          if (curr.querySelectorAll('article.message-row, [data-message-author-role]').length > 1) break;
          const currText = extractOptionText(curr);
          if (currText.length <= 1200 && approvalPromptPattern.test(currText)) {
            groupContainer = curr;
            break;
          }
          if (allowOpt.info.highConfidence && currText.length <= 1200 && (
            curr.matches?.(assistantOrDialogSelector)
            || curr.parentElement?.matches?.(assistantOrDialogSelector)
          )) {
            groupContainer = curr;
            break;
          }
        }
      }
      if (!groupContainer) continue;

      const groupAllows = allowOptions.filter(o => groupContainer.contains(o.pillEl)).sort((a, b) => b.info.priority - a.info.priority);
      const groupDenies = denyOptions.filter(o => groupContainer.contains(o.pillEl));
      const groupAll = [...groupAllows, ...groupDenies];

      const isOptionCompleted = opt => {
        const el = opt.pillEl;
        if (!el || !el.isConnected) return true;
        if (['aria-checked', 'aria-pressed', 'aria-selected'].some(attr => el.getAttribute(attr) === 'true')) return true;
        if (['checked', 'selected', 'active'].includes(el.getAttribute('data-state')) || el.getAttribute('data-selected') === 'true') return true;
        if (/[✓✔☑]/.test(el.textContent || '')) return true;
        return false;
      };
      if (groupAll.some(isOptionCompleted)) continue;

      const isOptionDisabledOrBusy = opt => {
        const el = opt.pillEl;
        if (!el || !el.isConnected || el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('[inert], [aria-disabled="true"]')) return true;
        if (el.getAttribute('aria-busy') === 'true' || el.getAttribute('data-loading') === 'true' || el.querySelector?.('.animate-spin')) return true;
        return false;
      };
      const hasAsymmetricSvgCheckmark = groupAllows.length > 0 && groupDenies.length > 0 && (
        (groupAllows.some(o => o.pillEl.querySelectorAll('svg').length > 0) && groupDenies.every(o => o.pillEl.querySelectorAll('svg').length === 0))
        || (groupDenies.some(o => o.pillEl.querySelectorAll('svg').length > 0) && groupAllows.every(o => o.pillEl.querySelectorAll('svg').length === 0))
      );

      if (groupAll.some(isOptionDisabledOrBusy) || hasAsymmetricSvgCheckmark) continue;
      const standaloneDotPair = isDot && Boolean(pairedDeny)
        && !groupContainer.closest?.(excludedSelector)
        && groupContainer.querySelectorAll('article.message-row, [data-message-author-role]').length <= 1
        && extractOptionText(groupContainer).length <= 1200;
      if (groupContainer.closest?.(assistantOrDialogSelector) || standaloneDotPair) {
        if (!returnDetails) return true;
        return { groupAllows, groupDenies, groupContainer };
      }
    }
    return returnDetails ? null : false;
  };

  const approvalWait = () => {
    const details = findApprovalPrompt(true);
    if (!details) return null;
    const container = details.groupContainer;
    const surface = container?.matches?.('[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog') ? 'modal'
      : container?.matches?.('article, [data-message-author-role]') ? 'assistant-turn' : 'inline-card';
    metrics.observations.busy = true;
    return result('busy', '目标页面请求权限确认；请在页面中决定。', 'approval-required', { surface, evidenceFlags: ['approval-card'] });
  };

  const checkAndHandleApprovalPrompt = () => {
    if (args.isTakeoverReply === true) {
      if (detectCaptchaOr2FABlock()) {
        metrics.observations.busy = true;
        return result('blocked', '检测到需要人工完成人机验证或密码/验证码，已暂停等待处理。', 'captcha-required', { surface: 'modal', evidenceFlags: ['captcha-widget'] });
      }
      return null;
    }
    if (args.autoAllow !== true) {
      const handover = tryReturnBrowserControl();
      if (handover) return handover;
      return approvalWait();
    }
    if (detectAuthOrLoginBlock()) {
      metrics.observations.busy = true;
      return result('blocked', '检测到需要手动登录或 OAuth 授权的弹窗，已暂停等待处理。', 'oauth-required', { surface: 'modal', evidenceFlags: ['oauth-text'] });
    }
    const found = findApprovalPrompt(true);
    if (!found) return tryReturnBrowserControl();
    const { groupAllows, groupDenies, groupContainer } = found;
    const target = groupAllows[0];
    const containerText = extractOptionText(groupContainer);
    const targetCore = target?.info?.core || '';
    const isAuthOption = /^(?:authorize|re-?authorize|sign\s+in|log\s*in|login|connect\s+account|link\s+account|connect|reconnect|授权登录|同意登录|同意并登录|去登录|重新登录|连接账号|关联账号|绑定账号)\b/i.test(targetCore);
    if (isAuthOption || authTextPattern.test(containerText)) {
      if (isDot && args.autoAuthorizeTakeover === true) {
        if (!isAuthOption) {
          // Non-auth routine Allow button inside a Dot card mentioning login/account context.
        } else {
          return tryReturnBrowserControl() || checkTakeoverConversationPrompt(true);
        }
      } else {
        metrics.observations.busy = true;
        return result('blocked', '检测到需要手动登录或 OAuth 授权的弹窗，已暂停等待处理。', 'oauth-required', { surface: 'inline-card', evidenceFlags: ['oauth-text'] });
      }
    }
    const isRoutineKind = ['always-allow', 'allow-once'].includes(target.info.kind)
      || (target.info.kind === 'allow' && (target.info.highConfidence || groupDenies.length > 0));
    const surface = groupContainer?.matches?.('[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog') ? 'modal'
      : groupContainer?.matches?.('article, [data-message-author-role]') ? 'assistant-turn' : 'inline-card';
    const optionKind = /^allow\s+(?:this\s+tool\s+)?for\s+(?:this\s+)?conversation\b|本会话允许此工具|此对话允许此工具/i.test(targetCore)
      ? 'allow-conversation' : (['always-allow', 'allow-once', 'allow', 'authorize', 'confirm', 'sign-in'].includes(target.info.kind) ? target.info.kind : 'other');
    if (!isRoutineKind) {
      metrics.observations.busy = true;
      return result('busy', '目标页面请求权限确认；请在页面中决定。', 'approval-required', { surface, optionKind, evidenceFlags: ['approval-card'] });
    }
    const nowMs = Date.now();
    const cardMap = (globalThis.__agentContinueAllowedCards ??= new WeakMap());
    const lastClickedAt = Math.max(
      cardMap.get(groupContainer) || 0,
      Number(groupContainer.getAttribute('data-agent-continue-allowed') || 0),
      Number(target.pillEl.getAttribute('data-agent-continue-allowed') || 0),
    );
    if (lastClickedAt > 0 && nowMs - lastClickedAt < 4000) {
      metrics.observations.busy = true;
      return result('busy', '已自动确认常规工具权限，继续等待运行。', 'auto-allowed-prompt', { surface, optionKind, evidenceFlags: ['approval-card', 'allow-options'] });
    }
    cardMap.set(groupContainer, nowMs);
    const nowStr = String(nowMs);
    try {
      groupContainer.setAttribute('data-agent-continue-allowed', nowStr);
      target.pillEl.setAttribute('data-agent-continue-allowed', nowStr);
    } catch {}
    clickTargetDom(target.pillEl);
    if (target.leafEl && target.leafEl !== target.pillEl && target.pillEl.tagName !== 'BUTTON') {
      try { target.leafEl.click(); } catch {}
    }
    metrics.observations.busy = true;
    return result('busy', '已自动确认常规工具权限，继续等待运行。', 'auto-allowed-prompt', { surface, optionKind, evidenceFlags: ['approval-card', 'allow-options'] });
  };

  const initialApprovalOutcome = checkAndHandleApprovalPrompt();
  if (initialApprovalOutcome) return initialApprovalOutcome;
  const initialTakeoverOutcome = checkTakeoverConversationPrompt();
  if (initialTakeoverOutcome) return initialTakeoverOutcome;

  if (busy()) return isDotPaused() ? pausedResult() : result('busy', 'Agent 仍在运行，稍后再次检查。', 'agent-busy');
  if (!editable() && !(forceInterrupt && visibleMatches(stopSelector, composer).length === 1)) {
    return result('blocked', '输入框当前不可编辑。');
  }
  if (hasAttachment() && (args.persistentDelivery !== true || args.mode !== 'send')) return protectedDraft('输入框有附件，本次不提交。');

  const lastAssistant = [...document.querySelectorAll(assistantSelector)].at(-1);
  if (lastAssistant && args.stopMarkers?.length) {
    const lines = textOf(lastAssistant).split(/\r?\n/).map(line => line.trim());
    const terminal = (args.stopMarkers || []).find(marker => lines.includes(marker));
    if (terminal) return result('done', '最近一条回复命中你设置的停止标记。');
  }

  if (args.mode === 'check') {
    return result('ready', '已识别输入框；发送按钮可能在输入文字后出现。自检未填写或发送消息。');
  }
  if (args.mode !== 'send' || !clean(args.prompt)) return result('blocked', '没有可发送的文字。');
  const beforeMessages = new Set();
  const beforeKeys = new Set();
  const rememberVisibleHistory = () => {
    for (const node of messageNodes('user')) {
      beforeMessages.add(node);
      const key = messageKey(node);
      if (key) beforeKeys.add(key);
    }
  };
  // A virtualized history row can disappear while the composer is prepared.
  rememberVisibleHistory();
  if (!await stillAllowed()) return result('cancelled', '本次执行已取消。');

  beforeAssistant = assistantState();
  const previousFocus = document.activeElement;
  let inserted = false;
  let insertedDraftSnapshot = null;
  let interrupted = false;
  let needsRefill = false;
  let payloadWriteAttempts = 0;
  let preparedText = normalizeLineEndings(prompt);
  const unstableComposer = {};
  const unconfirmedChunk = {};
  const chunkAttachment = {};
  const chunkMismatch = {};
  const humanEditedDuringSelection = {};
  const unconfirmedPaste = {};
  const unconfirmedPasteAttachment = {};

  // Reacquire a uniquely scoped editor after same-conversation framework
  // remounts. This never follows a different target or an attempted submission.
  const keepComposer = () => {
    mutable();
    if (sameComposer()) return true;
    const next = findComposer();
    if (!next || !samePage() || submitted) return false;
    if (args.persistentDelivery !== true && (editor.isConnected || next.composer !== composer)) return false;
    if (!next.composer || [document.body, document.documentElement, next.editor].includes(next.composer)) return false;
    editor = next.editor;
    composer = next.composer;
    metrics.counters.documentChanges++;
    metrics.observations.composerPresent = true;
    inserted = false;
    insertedDraftSnapshot = null;
    needsRefill = true;
    return true;
  };

  const detachAttachments = async () => {
    mutable();
    progress('prepare', 'attachments');
    const removals = new Set();
    const countRemoved = () => {
      for (const button of removals) {
        if (!button.isConnected || !composer.contains(button)) { metrics.counters.attachmentsRemoved++; removals.delete(button); }
      }
    };
    while (hasAttachment()) {
      if (!await stillAllowed() || !keepComposer()) return false;
      // Use the site's own removal controls, never delete account files or
      // remove rendered chips behind the framework's upload state.
      for (const button of visibleMatches(removeAttachmentSelector, composer)) {
        mutable();
        if (!samePage() || revoked || !sameComposer()) return false;
        if (enabled(button) && button.isConnected && composer.contains(button)) { removals.add(button); button.click(); }
      }
      for (const input of composer.querySelectorAll('input[type="file"]')) {
        mutable();
        if (!samePage() || revoked || !sameComposer()) return false;
        if (input.files?.length) {
          input.value = '';
          metrics.counters.attachmentsRemoved++;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      countRemoved();
      if (!hasAttachment()) return true;
      await wait(150);
      countRemoved();
    }
    return true;
  };

  // Helper to locate ProseMirror EditorView if running in MAIN world
  const getProseMirrorView = targetEl => {
    let curr = targetEl;
    while (curr && curr !== document.body) {
      if (curr.pmViewDesc?.view) return curr.pmViewDesc.view;
      curr = curr.parentElement;
    }
    if (targetEl.parentElement) {
      const pm = targetEl.parentElement.querySelector('.ProseMirror');
      if (pm?.pmViewDesc?.view) return pm.pmViewDesc.view;
    }
    return null;
  };

  const normalizeRenderedPayload = value => normalizeLineEndings(value).replace(/\u00a0/g, ' ');
  const payloadMatches = () => {
    if (editor instanceof HTMLTextAreaElement) {
      return normalizeLineEndings(editor.value) === preparedText;
    }
    const current = plainDraft(editor, true);
    if (current !== null) {
      if (normalizeRenderedPayload(current) === normalizeRenderedPayload(preparedText)) return true;
      if (args.persistentDelivery === true && inserted && current.trim()) {
        preparedText = normalizeLineEndings(current);
        return true;
      }
      return false;
    }
    const fallback = textOf(editor);
    if (fallback && clean(fallback) === clean(preparedText)) return true;
    if (args.persistentDelivery === true && inserted && fallback && fallback.trim()) {
      preparedText = normalizeLineEndings(fallback);
      return true;
    }
    return false;
  };

  const latchManual = notify => {
    if (manualPending) return;
    manualPending = true;
    if (invocation) invocation.manualPending = true;
    metrics.observations.manualPending = true;
    metrics.counters.manualIntents++;
    progress('receipt', 'manual-submission');
    resolveManualTakeover(manualHandoff);
    if (notify) {
      try {
        Promise.resolve(chrome.runtime.sendMessage({ type: 'MANUAL_SUBMISSION', runId: args.runId, resultToken: args.resultToken }))
          .catch(() => { metrics.counters.transportErrors++; });
      } catch { metrics.counters.transportErrors++; }
    }
  };
  observeManual = event => {
    if (event.isTrusted !== true || revoked || manualPending || submitted || extensionBoundary || !preparationStarted) return;
    if (!samePage() || !keepComposer()) return;
    // A synthetic extension click can still cause a browser-trusted form submit.
    if (event.type === 'submit' && (submitted || extensionBoundary)) return;
    const target = event.target;
    let submitting = false;
    if (event.type === 'click') {
      const button = target?.closest?.('button[data-testid="send-button"], button[data-testid="composer-submit-button"], button[data-testid="fruitjuice-send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"], button[aria-label="Send"], button[aria-label="发送提示"], button[aria-label="发送消息"], button[aria-label="发送"], button[type="submit"]');
      submitting = !!button && composer.contains(button) && !button.matches?.(stopSelector);
    } else if (event.type === 'submit') {
      submitting = target === composer || (composer.contains(target) && target?.matches?.('form'));
    } else if (event.type === 'keydown') {
      submitting = (target === editor || editor.contains(target)) && event.key === 'Enter'
        && !event.shiftKey && !event.altKey && !event.isComposing && event.keyCode !== 229 && !event.defaultPrevented
        && (!isDot || event.ctrlKey === true || event.metaKey === true);
    }
    if (!submitting || !samePage() || !sameComposer()) return;
    // Capture before the site's trusted handler clears or remounts the composer.
    rememberVisibleHistory();
    beforeAssistant = assistantState();
    latchManual(true);
  };

  const finiteLegacyTextarea = () => args.persistentDelivery !== true && args.unlimitedReadiness !== true
    && editor instanceof HTMLTextAreaElement;
  const fill = async (value, forceReplacement = false) => {
    mutable();
    if (value && payloadWriteAttempts >= 2 && !finiteLegacyTextarea()) {
      if (args.persistentDelivery !== true || args.unlimitedReadiness !== true) throw unstableComposer;
      progress('readiness', 'composer-unstable');
      await wait(10_000);
      mutable();
      if (!await stillAllowed() || !samePage() || !keepComposer() || !editable() || hasAttachment() || busy()) return false;
      if (!needsRefill && payloadMatches()) return true;
    }
    return fillNow(value, forceReplacement);
  };
  const fillNow = (value, forceReplacement) => {
    mutable();
    // Initial fill, three settling corrections, and one final synchronous correction.
    if (value && finiteLegacyTextarea() && payloadWriteAttempts >= 5) throw unstableComposer;
    if (value) payloadWriteAttempts++;
    metrics.counters.fillCalls++;
    progress('prepare', 'starting');
    preparationStarted = true;
    if (!sameComposer()) return false;
    editor.focus({ preventScroll: true });
    mutable();
    if (!sameComposer()) return false;

    // 1. Direct ProseMirror Runtime insertion (Available when running in world: 'MAIN')
    // This updates ProseMirror state synchronously, updating React state and enabling Send button.
    const pmView = getProseMirrorView(editor);
    if (pmView) {
      try {
        const { state, dispatch } = pmView;
        const schema = state.schema;
        const tr = state.tr;
        tr.delete(0, state.doc.content.size);
        if (value) {
          const lines = value.split(/\r?\n/);
          if (schema.nodes.paragraph) {
            const paragraphs = lines.map(line =>
              line ? schema.nodes.paragraph.create(null, schema.text(line)) : schema.nodes.paragraph.create()
            );
            tr.replaceWith(0, tr.doc.content.size, paragraphs);
          } else {
            tr.insertText(value);
          }
        }
        write('modelWrites', () => dispatch(tr));
        try {
          editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        } catch {}
        if (forceReplacement) return true;
        return wait(50).then(() => clean(textOf(editor)) === clean(value));
      } catch (error) { if (error === manualHandoff) throw error; }
    }

    const inputType = value ? 'insertText' : 'deleteContentBackward';
    const beforeText = textOf(editor);
    const target = editor;
    const handledInput = async () => {
      if (clean(textOf(target)) === clean(value)) return true;
      let humanEdited = false;
      const observeHuman = event => { if (event.isTrusted) humanEdited = true; };
      target.addEventListener('beforeinput', observeHuman, { capture: true });
      target.addEventListener('keydown', observeHuman, { capture: true });
      target.addEventListener('paste', observeHuman, { capture: true });
      try {
        const deadline = Date.now() + 900;
        while (Date.now() < deadline) {
          mutable();
          if (humanEdited || !sameComposer() || !samePage()) return false;
          const current = textOf(target);
          if (clean(current) === clean(value)) return true;
          if (current !== beforeText) return false;
          await wait(50);
        }
        return false;
      } finally {
        target.removeEventListener('beforeinput', observeHuman, { capture: true });
        target.removeEventListener('keydown', observeHuman, { capture: true });
        target.removeEventListener('paste', observeHuman, { capture: true });
      }
    };

    const beforeInput = () => editor.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true, composed: true, cancelable: true, inputType, data: value || null
    }));
    const mayWrite = () => { mutable(); return sameComposer() && (!forceReplacement || (samePage() && withinDeadline() && !hasAttachment() && editable())); };
    const replaceAfter = replace => {
      if (beforeInput()) return replace();
      return handledInput().then(handled => handled || (forceReplacement && replace()));
    };
    let chunkSize = 1000;
    const insertChunkedPass = async () => {
      if (!mayWrite()) return false;
      selectContents();
      let previousPlainText = plainDraft(editor, true);
      let humanEdited = false;
      const observeHuman = event => { if (event.isTrusted) humanEdited = true; };
      for (const type of ['beforeinput', 'keydown', 'paste']) editor.addEventListener(type, observeHuman, true);
      try {
        document.dispatchEvent(new Event('selectionchange'));
        if (!mayWrite()) return false;
        await wait(50);
      } finally {
        for (const type of ['beforeinput', 'keydown', 'paste']) editor.removeEventListener(type, observeHuman, true);
      }
      if (!mayWrite()) return false;
      if (humanEdited) throw humanEditedDuringSelection;
      const currentPlainText = plainDraft(editor, true);
      if (currentPlainText !== previousPlainText) {
        previousPlainText = currentPlainText;
        selectContents();
        document.dispatchEvent(new Event('selectionchange'));
        if (!mayWrite()) return false;
      }
      if (previousPlainText !== '') {
        const expectedRange = document.createRange();
        expectedRange.selectNodeContents(editor);
        if (selection.rangeCount !== 1) {
          if (args.persistentDelivery !== true) throw unstableComposer;
        } else {
          const selectedRange = selection.getRangeAt(0);
          const container = editor.ownerDocument.createElement('div');
          container.append(selectedRange.cloneContents());
          if (plainDraft(container, true, container) !== previousPlainText
            || selectedRange.compareBoundaryPoints(Range.START_TO_START, expectedRange) < 0
            || selectedRange.compareBoundaryPoints(Range.END_TO_END, expectedRange) > 0) {
            if (args.persistentDelivery !== true) throw unstableComposer;
          }
        }
      }
      const logicalValue = normalizeLineEndings(value);
      let offset = 0;
      let actualExpected = '';
      let expectedPrepared = '';
      let differences = [];
      const readChunkDraft = () => {
        const draft = plainDraft(editor, true);
        if (draft === null) metrics.counters.chunkUnserializableChecks++;
        return draft;
      };
      while (offset < logicalValue.length) {
        mutable();
        if (revoked || !samePage() || !sameComposer() || !withinDeadline() || !editable()) return false;
        if (hasAttachment()) throw chunkAttachment;
        let end = Math.min(offset + chunkSize, logicalValue.length);
        if (end < logicalValue.length) {
          const minimum = offset + Math.floor(chunkSize / 2);
          const paragraph = logicalValue.lastIndexOf('\n\n', end - 2);
          const line = logicalValue.lastIndexOf('\n', end - 1);
          if (paragraph >= minimum) end = paragraph + 2;
          else if (line >= minimum) end = line + 1;
        }
        const prior = logicalValue.charCodeAt(end - 1);
        const next = logicalValue.charCodeAt(end);
        if (end < logicalValue.length && prior >= 0xd800 && prior <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
          end = end - 1 > offset ? end - 1 : end + 1;
        const chunk = logicalValue.slice(offset, end);
        let inputObserved = false;
        const observeInput = () => { inputObserved = true; };
        editor.addEventListener('input', observeInput, { capture: true });
        let accepted;
        const chunkStarted = performance.now();
        // Selection settling can collapse or narrow the initial replacement.
        // Reassert it synchronously; later chunks keep their verified caret.
        if (offset === 0 && args.persistentDelivery === true) selectContents();
        try { accepted = write('domWrites', () => document.execCommand('insertText', false, chunk)); }
        finally { editor.removeEventListener('input', observeInput, { capture: true }); }
        const chunkElapsed = performance.now() - chunkStarted;
        if (!accepted || !inputObserved) { metrics.counters.rejectedChunks++; throw unconfirmedChunk; }
        metrics.counters.textChunks++;
        offset = end;
        expectedPrepared += chunk;
        const expected = expectedPrepared;
        let actual = readChunkDraft();
        if (actual === null) {
          if (args.persistentDelivery !== true || args.unlimitedReadiness !== true) {
            metrics.counters.chunkUnserializableRestarts++;
            throw chunkMismatch;
          }
          let actualChecks = 0;
          while (actual === null) {
            if (++actualChecks > 20) {
              actual = clean(textOf(editor));
              break;
            }
            await wait(50);
            mutable();
            if (revoked || !samePage() || !sameComposer() || !withinDeadline() || !editable()) return false;
            if (hasAttachment()) throw chunkAttachment;
            actual = readChunkDraft();
          }
          if (normalizeLineEndings(actual) === expected) {
            metrics.counters.chunkUnserializableRecoveries++;
          } else {
            metrics.counters.chunkSettlementRestarts++;
            if (args.persistentDelivery === true && actual && actual.trim()) {
              actualExpected = normalizeLineEndings(actual);
            } else {
              throw chunkMismatch;
            }
          }
        }
        const logicalActual = normalizeLineEndings(actual);
        if (actualExpected && !logicalActual.startsWith(actualExpected)) {
          metrics.counters.prefixRewriteRestarts++;
          if (args.persistentDelivery === true && logicalActual && logicalActual.trim()) {
            actualExpected = logicalActual;
          } else {
            throw chunkMismatch;
          }
        }
        const different = logicalActual !== expected;
        if (different) {
          metrics.counters.chunkDifferences++;
          differences.push({ offset: end, actual: logicalActual.slice(actualExpected.length) });
        }
        actualExpected = logicalActual;
        if (chunkElapsed >= 2000) {
          metrics.counters.slowChunks++;
          chunkSize = Math.min(chunkSize, Math.max(64, Math.floor(chunkSize / 4)));
        } else if (chunkElapsed >= 500) {
          chunkSize = Math.min(chunkSize, Math.max(128, Math.floor(chunkSize / 2)));
        }
        if (offset < logicalValue.length) {
          await wait(50);
          await yieldFrame();
          mutable();
          let settled = readChunkDraft();
          if (settled === null) {
            if (args.persistentDelivery !== true || args.unlimitedReadiness !== true) {
              metrics.counters.chunkUnserializableRestarts++;
              throw chunkMismatch;
            }
            let settledChecks = 0;
            while (settled === null) {
              if (++settledChecks > 20) {
                settled = clean(textOf(editor));
                break;
              }
              await wait(50);
              mutable();
              if (revoked || !samePage() || !sameComposer() || !withinDeadline() || !editable()) return false;
              if (hasAttachment()) throw chunkAttachment;
              settled = readChunkDraft();
            }
            if (normalizeLineEndings(settled) === actualExpected) metrics.counters.chunkUnserializableRecoveries++;
          }
          if (normalizeLineEndings(settled) !== actualExpected) {
            metrics.counters.chunkSettlementRestarts++;
            if (args.persistentDelivery === true && settled && settled.trim()) {
              actualExpected = normalizeLineEndings(settled);
            } else {
              throw chunkMismatch;
            }
          }
          const endRange = document.createRange();
          let lastLeaf = editor;
          while (lastLeaf.lastChild) {
            lastLeaf = lastLeaf.lastChild;
          }
          if (lastLeaf.nodeType === Node.TEXT_NODE) {
            endRange.setStart(lastLeaf, lastLeaf.nodeValue.length);
            endRange.setEnd(lastLeaf, lastLeaf.nodeValue.length);
          } else {
            endRange.selectNodeContents(lastLeaf);
            endRange.collapse(false);
          }
          selection.removeAllRanges();
          selection.addRange(endRange);
        } else if (different) {
          await wait(50);
          mutable();
          if (!samePage() || !sameComposer() || !withinDeadline() || !editable()) return false;
          if (hasAttachment()) throw chunkAttachment;
          let diffChecks = 0;
          let settled = readChunkDraft();
          while (settled === null && ++diffChecks <= 20) {
            await wait(50);
            mutable();
            if (!samePage() || !sameComposer() || !withinDeadline() || !editable()) return false;
            if (hasAttachment()) throw chunkAttachment;
            settled = readChunkDraft();
          }
          if (settled === null) settled = clean(textOf(editor));
          const settledText = normalizeLineEndings(settled);
          if (settledText === expected) {
            differences.pop();
            actualExpected = settledText;
          } else if (settledText !== logicalActual) {
            metrics.counters.chunkSettlementRestarts++;
            if (args.persistentDelivery === true && settledText && settledText.trim()) {
              actualExpected = settledText;
            } else {
              throw chunkMismatch;
            }
          }
        }
      }
      if (!differences.length && actualExpected === expectedPrepared) {
        preparedText = expectedPrepared;
        return { status: 'exact' };
      }
      if (!actualExpected || !actualExpected.trim()) {
        const fallback = clean(textOf(editor));
        if (args.persistentDelivery === true && fallback && fallback.trim()) {
          actualExpected = normalizeLineEndings(fallback);
        } else {
          throw chunkMismatch;
        }
      }
      return { status: 'different', signature: { items: differences, final: actualExpected } };
    };
    const fallbackToPlainText = text => String(text ?? '')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

    const insertChunkedText = async () => {
      let expectedDifference = null;
      let restartCount = 0;
      while (true) {
        if (restartCount === 1) {
          const fallback = fallbackToPlainText(value);
          if (fallback !== value) {
            value = fallback;
            preparedText = normalizeLineEndings(value);
          }
        }
        try {
          const outcome = await insertChunkedPass();
          if (outcome === false) return false;
          if (outcome.status === 'exact') return true;
          if (outcome.status === 'different') {
            if (args.persistentDelivery === true && outcome.signature?.final) {
              preparedText = outcome.signature.final;
              return true;
            }
            if (expectedDifference && expectedDifference.items.length === outcome.signature.items.length
                && expectedDifference.final === outcome.signature.final
                && expectedDifference.items.every((item, index) => item.offset === outcome.signature.items[index].offset
                  && item.actual === outcome.signature.items[index].actual)) {
              if (args.persistentDelivery === true) {
                preparedText = outcome.signature.final;
                return true;
              }
              return 'mismatch';
            }
            expectedDifference = outcome.signature;
            if (++restartCount > 2) {
              if (args.persistentDelivery === true && outcome.signature && outcome.signature.final) {
                preparedText = outcome.signature.final;
                return true;
              }
              return 'mismatch';
            }
            metrics.counters.chunkRestarts++;
            await wait(150);
            if (!await stillAllowed() || !samePage() || !keepComposer() || !editable()) return false;
            continue;
          }
          throw chunkMismatch;
        }
        catch (error) {
          if (![chunkMismatch, unconfirmedChunk].includes(error) || args.persistentDelivery !== true || args.unlimitedReadiness !== true) throw error;
          if (++restartCount > 2) {
            if (args.persistentDelivery === true) {
              const currentDraft = readChunkDraft() ?? clean(textOf(editor));
              if (currentDraft && currentDraft.trim()) {
                preparedText = normalizeLineEndings(currentDraft);
                return true;
              }
            }
            return 'mismatch';
          }
          metrics.counters.chunkRestarts++;
          chunkSize = Math.max(1, Math.floor(chunkSize / 2));
          expectedDifference = null;
          await wait(150);
          if (!await stillAllowed() || !samePage() || !keepComposer() || !editable()) return false;
        }
      }
    };

    if (editor instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!setter) return false;
      editor.setSelectionRange(0, editor.value.length);
      return replaceAfter(() => {
        if (!mayWrite()) return false;
        write('domWrites', () => setter.call(editor, value));
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType, data: value || null }));
        return forceReplacement || clean(textOf(editor)) === clean(value);
      });
    }

    const selection = window.getSelection();
    const range = document.createRange();
    const selectContents = () => {
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
    };
    selectContents();
    const logicalValue = normalizeLineEndings(value);
    const manyLines = (logicalValue.match(/\n/g) || []).length >= 100;
    if (value && (editor.classList.contains('ProseMirror') || isDot) && (value.length > 1000 || manyLines)) {
      return insertChunkedText().then(chunked => {
        if (chunked === 'mismatch') {
          if (args.persistentDelivery === true) {
            const currentDraft = plainDraft(editor, true) ?? clean(textOf(editor));
            if (currentDraft && currentDraft.trim()) {
              preparedText = normalizeLineEndings(currentDraft);
              return true;
            }
          }
          throw chunkMismatch;
        }
        return chunked;
      });
    }
    return replaceAfter(() => {
      if (!mayWrite()) return false;
      // A beforeinput handler may move the caret. Replace, never append.
      selectContents();
      if (!selection.anchorNode || !editor.contains(selection.anchorNode)) return false;
      let inputObserved = false;
      const observeInput = () => { inputObserved = true; };
      editor.addEventListener('input', observeInput, { capture: true });
      try {
        write('domWrites', () => { if (!document.execCommand(value ? 'insertText' : 'delete', false, value)) {
          if (!value) {
            editor.innerHTML = '<p><br></p>';
          } else {
            const lines = value.split(/\r?\n/);
            editor.innerHTML = lines.map(line => `<p>${line ? line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '<br>'}</p>`).join('');
          }
        } });
        if (!inputObserved) editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType, data: value || null }));
      } finally { editor.removeEventListener('input', observeInput, { capture: true }); }
      if (forceReplacement || clean(textOf(editor)) === clean(value)) return true;
      if (args.persistentDelivery === true && value && inputObserved) {
        const rendered = plainDraft(editor, true) ?? textOf(editor);
        const strippedRendered = rendered ? clean(stripMarkdown(normalizeLineEndings(rendered))) : '';
        const strippedExpected = clean(stripMarkdown(normalizeLineEndings(value)));
        if (strippedRendered && strippedRendered === strippedExpected) {
          preparedText = normalizeLineEndings(rendered);
          return true;
        }
      }
      return false;
    });
  };

  const clearOwnDraft = async () => {
    if (!manualPending && !submitted && inserted && metrics.timings.maxDomWriteMs < 2000 && sameComposer() && samePage() && draftUnchanged(insertedDraftSnapshot)) {
      const focusAtCleanup = document.activeElement;
      try { await fill(''); } catch {}
      finally {
        if (document.activeElement === editor && focusAtCleanup && focusAtCleanup !== editor && focusAtCleanup.isConnected) {
          try { focusAtCleanup.focus({ preventScroll: true }); } catch {}
        }
      }
    }
  };

  const interrupt = async () => {
    mutable();
    if (!forceInterrupt) return null;
    const stops = [...new Set(visibleMatches(stopSelector, composer))];
    if (!stops.length) return null;
    if (interrupted || stops.length !== 1 || !enabled(stops[0])) return result('blocked', '当前停止控件不可用或不唯一，稍后重试。');
    if (!await stillAllowed()) return result('cancelled', '已暂停，未打断 Agent。');
    mutable();
    if (!keepComposer() || !stops[0].isConnected || !composer.contains(stops[0])) return result('blocked', '页面已变化。');
    if (hasAttachment()) return protectedDraft('输入框有附件，本次不提交。');
    if (!samePage() || !withinDeadline() || !enabled(stops[0])) return result('cancelled', '打断许可已失效。');

    stops[0].click();
    interrupted = true;
    const stopDeadline = Math.min(Date.now() + 3500, args.runDeadline);
    while (args.unlimitedReadiness === true || Date.now() < stopDeadline) {
      if (!await stillAllowed()) return result('cancelled', '已暂停，不再继续发送。');
      mutable();
      const next = findComposer();
      if (next) {
        ({ editor, composer } = next);
        if (hasAttachment()) return protectedDraft('输入框有附件，本次不提交。');
        if (editable() && !visibleMatches(stopSelector, composer).length) return null;
      }
      await wait(150);
    }
    return result('blocked', '已请求停止，输入框尚未恢复发送状态；稍后重试。');
  };

  const coreNormalized = str => String(str ?? '').replace(/[\s\r\n\t\u00a0#*_`~\[\]()\-+=>【】]/g, '');

  const hasBlankLineDiff = (a, b) => {
    const aSingle = a.replace(/\n{2,}/g, '\n');
    const bSingle = b.replace(/\n{2,}/g, '\n');
    return aSingle === bSingle && a !== b;
  };

  const matchesReceipt = (receipt, expected) => {
    if (!receipt || !expected) return false;
    const rNorm = normalizeLineEndings(receipt);
    const eNorm = normalizeLineEndings(expected);
    if (rNorm === eNorm) return true;
    if (rNorm.trim() === eNorm.trim()) return true;
    if (expected.length < 50 && hasBlankLineDiff(rNorm, eNorm)) return false;
    if (clean(rNorm) === clean(eNorm)) return true;
    const rStripped = clean(stripMarkdown(rNorm));
    const eStripped = clean(stripMarkdown(eNorm));
    if (rStripped === eStripped && rStripped.length > 0) return true;
    const rCore = coreNormalized(rNorm);
    const eCore = coreNormalized(eNorm);
    if (rCore.length > 0 && rCore === eCore) return true;
    if (rCore.length >= 20 && (rCore.includes(eCore) || eCore.includes(rCore))) return true;
    if (eCore.length >= 80 && rCore.length >= 60) {
      const sampleLen = Math.min(50, Math.floor(eCore.length * 0.15));
      const eHead = eCore.slice(0, sampleLen);
      const eTail = eCore.slice(-sampleLen);
      if (rCore.includes(eHead) && rCore.includes(eTail) && Math.abs(rCore.length - eCore.length) < Math.max(100, eCore.length * 0.3)) {
        return true;
      }
    }
    return false;
  };

  const confirmSubmission = async () => {
    progress('receipt', manualPending ? 'manual-submission' : 'awaiting-receipt');
    const confirmDeadline = Math.min(Date.now() + 6500, args.runDeadline);
    while (args.unlimitedReadiness === true || Date.now() < confirmDeadline) {
      metrics.counters.receiptChecks++;
      if (revoked) return result('cancelled', '已暂停，本次未提交。');
      if (!samePage()) return result('unknown', '提交后会话地址变化，无法确认结果；请检查后再继续。');
      if (manualPending && !await stillAllowed()) return result('cancelled', '本次执行已取消。');
      const messages = messageNodes('user');
      const last = messages.at(-1);
      const lastKey = messageKey(last);
      const modernReceipt = !isDot && last?.getAttribute('data-chatgpt-search-unit-key')?.endsWith(':user');
      let receiptText = last ? plainDraft(last, true, last) : null;
      if (receiptText === null && last) {
        receiptText = textOf(last);
      }
      const newReceipt = last && (!modernReceipt || modernMessageKey(last)) && !beforeMessages.has(last)
        && (!lastKey || !beforeKeys.has(lastKey)) && (!manualPending || lastKey);
      const expectedText = manualPending ? prompt : preparedText;
      const matched = matchesReceipt(receiptText, expectedText) || matchesReceipt(receiptText, prompt);

      if (newReceipt && receiptText !== null && matched) {
        metrics.observations.receiptFound = true;
        metrics.observations.receiptNew = true;
        metrics.observations.receiptMatched = true;
        if (manualPending) return result('manual-sent', '已确认手动提交本轮提示词。');
        return result('sent', useKeyboardOnly ? '已通过 Ctrl+Enter 提交，并在会话中确认新消息。' : '已确认发送并在会话中确认新消息。');
      }
      if (newReceipt && receiptText !== null && clean(receiptText) && !matched && normalizeRenderedPayload(receiptText) === normalizeRenderedPayload(expectedText)) {
        return result('unknown', '消息回执与提示词存在无法确认的空格差异；已暂停，请检查会话。', 'receipt-ambiguous');
      }
      if (manualPending && newReceipt && receiptText !== null && clean(receiptText) && !matched) return result('unknown', '手动提交内容与本轮提示词不同；请检查会话。');
      if (submitted && newReceipt && receiptText !== null && clean(receiptText) && !matched) return result('unknown', '新消息与配置的提示词不同；已暂停，请检查会话后再继续。', 'receipt-mismatch');
      try {
        await wait(180);
      } catch (error) {
        if (args.unlimitedReadiness !== true) throw error;
        if (revoked) return result('cancelled', '已暂停，本次未提交。');
        // Submission already happened. A temporary wait transport failure is
        // not evidence of failure and must not strand its receipt or resend.
        try {
          metrics.counters.authorizationChecks++;
          const checked = await chrome.runtime.sendMessage({ type: 'CHECK_RUN', runId: args.runId });
          if (checked?.ok === true && checked.allowed === false) return result('cancelled', '本次执行已取消。');
          if (checked?.allowed === true) grantedDeadline(checked.runDeadline);
        } catch { metrics.counters.transportErrors++; /* Keep observing this receipt; Pause revocation still wins. */ }
        await new Promise(resolve => setTimeout(resolve, 180));
      }
    }
    return result('unknown', manualPending ? '手动提交结果未确认，本周期不重复发送。' : useKeyboardOnly ? '已发送 Ctrl+Enter，但未确认新消息；本周期不追加点击或重复按键。' : '已点击发送，但未确认新消息；本周期不立即重试。');
  };

  try {
    if (!samePage() || !keepComposer()) return result('blocked', '页面已变化。');
    const beforeInterruptApproval = checkAndHandleApprovalPrompt();
    if (beforeInterruptApproval) return beforeInterruptApproval;
    if (busy()) return isDotPaused() ? pausedResult() : result('busy', 'Agent 仍在运行。', 'agent-busy');
    if (hasAttachment() && args.persistentDelivery === true && !await detachAttachments())
      return result('blocked', '发送控件当前不可用，稍后自动检查。', 'commit-not-dispatched');
    if (hasAttachment()) return protectedDraft('输入框有附件，本次不提交。');

    const interruptedResult = await interrupt();
    if (interruptedResult) return interruptedResult;

    if (!samePage() || !withinDeadline() || !keepComposer() || !editable()) return result('blocked', '输入框当前不可用，稍后重试。');
    if (hasAttachment()) return protectedDraft('输入框有附件，本次不提交。');

    const preCommitApprovalOutcome = checkAndHandleApprovalPrompt();
    if (preCommitApprovalOutcome) return preCommitApprovalOutcome;

    if (args.modelCommit === true) {
      preparationStarted = true;
      progress('prepare', 'starting');
      beforeAssistant = assistantState();
      rememberVisibleHistory();
      const receiptBoundaryToken = crypto.randomUUID();
      const receiptEvent = 'agent-continue-receipt-' + receiptBoundaryToken;
      let receiptBoundarySeen = false;
      const captureReceiptBoundary = event => {
        if (manualPending || !samePage() || !withinDeadline() || !keepComposer() || event.target !== editor) return;
        // Union with earlier history: virtualized rows must not become new receipts.
        rememberVisibleHistory();
        beforeAssistant = assistantState();
        receiptBoundarySeen = true;
        extensionBoundary = true;
        // Bind adopted content only at the validated synchronous dispatch boundary.
        if (args.persistentDelivery === true) {
          const current = plainDraft(editor, true) ?? textOf(editor);
          if (current && current.trim()) preparedText = normalizeLineEndings(current);
        }
        event.preventDefault();
      };
      document.addEventListener(receiptEvent, captureReceiptBoundary, true);
      let commit;
      let committing = true;
      const observeLease = async () => {
        const observationInterval = 1_000;
        // Read the same invocation's current command permit while COMMIT_RUN is
        // pending. This observation does not prove MAIN progress or a submission.
        while (committing && !revoked && samePage()) {
          try { await wait(observationInterval, false); }
          catch {
            if (!committing || revoked || !samePage()) return;
            try {
              metrics.counters.authorizationChecks++;
              const reply = await chrome.runtime.sendMessage({ type: 'CHECK_RUN', runId: args.runId });
              if (reply?.ok === true && reply.allowed === false) { revoked = true; return; }
              if (reply?.allowed === true) grantedDeadline(reply.runDeadline);
            } catch { metrics.counters.transportErrors++; /* A recoverable transport error is not a permanent run veto. */ }
            await new Promise(resolve => setTimeout(resolve, observationInterval));
          }
        }
      };
      try {
        if (args.extensionClock === true) observeLease().catch(() => undefined);
        // A lost worker reply must not hold a trusted manual receipt hostage.
        // The losing command remains observed by the race; never replay it.
        commit = await Promise.race([
          chrome.runtime.sendMessage({ type: 'COMMIT_RUN', runId: args.runId, receiptBoundaryToken }),
          manualTakeover,
        ]);
      } catch {
        metrics.counters.transportErrors++;
        if (manualPending && !extensionBoundary) return await confirmSubmission();
        submitted = true;
        return result('unknown', '页面未返回可确认的结果。');
      } finally {
        committing = false;
        document.removeEventListener(receiptEvent, captureReceiptBoundary, true);
      }
      if (commit === manualHandoff) return await confirmSubmission();
      if (commit?.ok === true && commit.supported === true && commit.dispatched === false && commit.manualSubmission === true) {
        latchManual(false);
        return await confirmSubmission();
      }
      if (commit?.ok === true && commit.supported === true && commit.dispatched === true) {
        submitted = true;
        metrics.counters.dispatchAttempts++;
        if (manualPending) return await confirmSubmission();
        if (!receiptBoundarySeen) return result('unknown', '页面未返回可确认的结果。');
        return await confirmSubmission();
      }
      mutable();
      if (!(commit?.ok === true && commit.supported === false && commit.dispatched === false)) {
        if (commit?.code === 'cancelled') return result('cancelled', '本次执行已取消。');
        if (commit?.code === 'not-dispatched' && commit.dispatched === false) {
          // Known no-attempt is not an uncertain send. Let the normal readiness
          // retry run, rather than strand a filled composer for a full interval.
          if (commit.reason === 'attachments') return protectedDraft('输入框有附件，本次不提交。');
          if (commit.reason === 'composer-unstable') return result('blocked', '输入框内容反复变化；稍后再次检查。', 'composer-unstable');
          if (['waiting-send', 'busy'].includes(commit.reason)) return result('busy', '发送控件尚未就绪，稍后自动检查。', 'send-not-ready');
          return result('blocked', '发送控件当前不可用，稍后自动检查。', 'commit-not-dispatched');
        }
        // No second method follows an uncertain or attempted model commit.
        submitted = true;
        return result('unknown', '页面未返回可确认的结果。');
      }
    }

    const accepted = await fill(prompt);
    mutable();
    progress('readiness', 'prepared');
    const readyPayload = () => payloadMatches();
    inserted = Boolean(accepted);
    if (accepted && sameComposer()) needsRefill = false;
    insertedDraftSnapshot = snapshotDraft();
    // Even matching DOM may precede a controlled input's model commit.
    await wait(180);
    mutable();

    const findSendButton = (root = composer) => {
      metrics.counters.readinessChecks++;
      metrics.observations.sendPresent = false;
      metrics.observations.sendEnabled = false;
      const scope = root;
      if (!scope) return null;
      const usable = btn => {
        if (!visible(btn) || btn.matches?.(stopSelector)) return false;
        metrics.observations.sendPresent = true;
        if (!enabled(btn)) return false;
        metrics.observations.sendEnabled = true;
        return true;
      };
      const firstUsable = selector => {
        const first = scope.querySelector(selector);
        return usable(first) ? first : [...scope.querySelectorAll(selector)].find(usable);
      };
      const testIds = ['send-button', 'composer-submit-button', 'fruitjuice-send-button'];
      for (const tid of testIds) {
        const btn = firstUsable(`button[data-testid="${tid}"]`);
        if (btn) return btn;
      }
      const ariaLabels = [
        'button[aria-label="Send prompt"]',
        'button[aria-label="Send message"]',
        'button[aria-label="Send"]',
        'button[aria-label="发送提示"]',
        'button[aria-label="发送消息"]',
        'button[aria-label="发送"]'
      ];
      for (const sel of ariaLabels) {
        const btn = firstUsable(sel);
        if (btn) return btn;
      }
      const matches = [...scope.querySelectorAll(sendSelector)].filter(usable);
      if (matches.length > 0) {
        const preferred = matches.find(b => {
          const tid = (b.getAttribute('data-testid') || '').toLowerCase();
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          return tid.includes('send') || aria.includes('send') || aria.includes('发送');
        });
        return preferred || matches[matches.length - 1];
      }
      return null;
    };

    const buttonDeadline = Math.min(Date.now() + 3200, args.runDeadline);
    let observedSend = visibleMatches(sendSelector, composer).length > 0;
    while (args.unlimitedReadiness === true || Date.now() < buttonDeadline) {
      mutable();
      progress('readiness', 'waiting-send');
      if (!await stillAllowed()) {
        await clearOwnDraft();
        return result('cancelled', '已暂停，本次未提交。');
      }
      mutable();
      if (args.persistentDelivery === true && !sameComposer()) return result('blocked', '发送控件当前不可用，稍后自动检查。', 'commit-not-dispatched');
      if (hasAttachment()) return protectedDraft('提交前检测到附件，已保留输入框内容。');
      if (busy()) {
        await clearOwnDraft();
        return result('busy', '检测到正在运行，本次未提交。');
      }
      if (forceInterrupt && visibleMatches(stopSelector, composer).length) {
        await clearOwnDraft();
        inserted = false;
        const interruption = await interrupt();
        if (interruption) return interruption;
        if (hasAttachment()) return protectedDraft('提交前检测到附件，已保留输入框内容。');
        const refilled = await fill(prompt);
        inserted = refilled;
        insertedDraftSnapshot = snapshotDraft();
        await wait(60);
      }

      if (findSendButton(composer)) {
        break;
      }
      if (useKeyboardOnly) {
        break;
      }
      observedSend ||= visibleMatches(sendSelector, composer).length > 0;
      // A framework clear can leave the known Send disabled indefinitely.
      // Recover the empty pre-submit draft here, not after the readiness wait.
      if (args.persistentDelivery === true && args.unlimitedReadiness === true
        && payloadWriteAttempts > 0 && editable()
        && !(editor instanceof HTMLTextAreaElement ? editor.value : editor.textContent).trim()) {
        inserted = Boolean(await fill(prompt, true));
        metrics.counters.emptyComposerRecoveries++;
        progress('prepare', 'empty-composer');
        insertedDraftSnapshot = inserted ? snapshotDraft() : null;
        await wait(180);
        continue;
      }
      if (args.unlimitedReadiness === true && sendMethod === 'auto' && !observedSend) {
        // Auto can use its documented keyboard method only if no Send control
        // exists, not as a timeout fallback from a known disabled control.
        await wait(150);
        observedSend = visibleMatches(sendSelector, composer).length > 0;
        if (!observedSend) break;
      }
      await wait(150);
    }

    if (!await stillAllowed()) {
      await clearOwnDraft();
      return result('cancelled', '已暂停，本次未提交。');
    }
    if (!withinDeadline()) {
      await clearOwnDraft();
      return result('cancelled', '本次发送许可已过期，未提交。');
    }

    if (!samePage() || !keepComposer()) return result('blocked', '提交前页面已变化。');
    if (busy()) { await clearOwnDraft(); return result('busy', 'Agent 仍在运行。'); }
    if (hasAttachment()) return protectedDraft('提交前检测到附件，已保留输入框内容。');
    const lateStop = () => forceInterrupt && visibleMatches(stopSelector, composer).length
      ? result('blocked', '提交前 Agent 状态变化，稍后重新打断并发送。') : null;
    const stopped = lateStop();
    if (stopped) return stopped;
    if (args.persistentDelivery === true && inserted && (needsRefill || !readyPayload())) {
      const currentDraft = plainDraft(editor, true) ?? clean(textOf(editor));
      if (currentDraft && currentDraft.trim()) {
        preparedText = normalizeLineEndings(currentDraft);
        needsRefill = false;
      }
    }
    if (needsRefill || !readyPayload()) {
      if (!editable()) return result('blocked', '输入框当前不可用，稍后重试。');
      const filledEditor = editor;
      const filled = await fill(prompt, true);
      if (!samePage() || !keepComposer()) return result('blocked', '提交前页面已变化。');
      if (editor === filledEditor) {
        if (!filled) return result('blocked', '输入框当前不可用，稍后重试。');
        needsRefill = false;
      }
      inserted = !needsRefill && Boolean(filled);
      insertedDraftSnapshot = inserted ? snapshotDraft() : null;
      // Give the page's controlled input one chance to settle. Waiting again
      // after every rewrite lets a recurring page restore starve submission.
      await wait(180);
    }
    if (!samePage() || !withinDeadline() || !keepComposer()) return result('blocked', '提交前页面已变化。');
    if (!editable()) return result('blocked', '输入框当前不可用，稍后重试。');
    if (busy()) return result('busy', 'Agent 仍在运行。');
    if (hasAttachment()) return protectedDraft('提交前检测到附件，已保留输入框内容。');
    const stopBeforeCommit = lateStop();
    if (stopBeforeCommit) return stopBeforeCommit;

    // An eventful correction must finish before dispatch: DOM equality alone
    // cannot prove that an asynchronous controlled-input model has updated.
    if (args.persistentDelivery === true && inserted && (needsRefill || !readyPayload())) {
      const currentDraft = plainDraft(editor, true) ?? clean(textOf(editor));
      if (currentDraft && currentDraft.trim()) {
        preparedText = normalizeLineEndings(currentDraft);
        needsRefill = false;
      }
    }
    if (needsRefill || !readyPayload()) {
      const filled = await fill(prompt, true);
      if (!filled) return result('blocked', '输入框当前不可用，稍后重试。');
      insertedDraftSnapshot = snapshotDraft();
      await wait(180);
    }
    if (args.persistentDelivery === true && inserted && (needsRefill || !readyPayload())) {
      const currentDraft = plainDraft(editor, true) ?? clean(textOf(editor));
      if (currentDraft && currentDraft.trim()) {
        preparedText = normalizeLineEndings(currentDraft);
        needsRefill = false;
      }
    }
    if (needsRefill || !readyPayload()) {
      const filled = await fill(prompt, true);
      if (!filled) return result('blocked', '输入框当前不可用，稍后重试。');
      insertedDraftSnapshot = snapshotDraft();
      await wait(180);
    }
    if (args.extensionClock !== true && !await stillAllowed()) {
      return result('cancelled', '本次执行已取消。');
    }
    if (!samePage() || !withinDeadline() || !sameComposer()) return result('blocked', '提交前页面已变化。');
    if (!editable()) return result('blocked', '输入框当前不可用，稍后重试。');
    if (busy()) return result('busy', 'Agent 仍在运行。');
    if (hasAttachment()) return protectedDraft('提交前检测到附件，已保留输入框内容。');
    const stopAfterFill = lateStop();
    if (stopAfterFill) return stopAfterFill;
    // Never silently repaint a rich editor while its submission model differs.
    // Standard synchronous input handlers receive the final replacement too.
    if (!readyPayload()) {
      const correction = finiteLegacyTextarea() ? fillNow(prompt, true) : fill(prompt, true);
      const synchronousCorrection = !correction || typeof correction.then !== 'function';
      const accepted = synchronousCorrection ? correction : await correction;
      if (!accepted) return result('blocked', '输入框当前不可用，稍后重试。');
      if (synchronousCorrection) mutable();
      insertedDraftSnapshot = snapshotDraft();
      if (!synchronousCorrection) {
        await wait(180);
        if (!await stillAllowed()) return result('cancelled', '已暂停，本次未提交。');
      }
      if (!samePage() || !withinDeadline() || !sameComposer() || !editable()) return result('blocked', '提交前页面已变化。');
      if (hasAttachment()) return protectedDraft('提交前检测到附件，已保留输入框内容。');
      if (busy() || lateStop()) return result('busy', 'Agent 仍在运行。');
    }
    if (!readyPayload()) return result('blocked', '输入框内容尚未稳定，稍后自动检查。', 'commit-not-dispatched');
    inserted = true;
    insertedDraftSnapshot = snapshotDraft();
    // The page can replace controls while the final authorization is pending.
    let currentButton = useKeyboardOnly ? null : findSendButton(composer);
    let sendButton = currentButton?.isConnected && composer.contains(currentButton) ? currentButton : null;
    observedSend ||= visibleMatches(sendSelector, composer).length > 0;
    while (!useKeyboardOnly && (observedSend || sendMethod === 'button') && !sendButton
      && (args.unlimitedReadiness === true || Date.now() < buttonDeadline)) {
      mutable();
      progress('readiness', 'waiting-send');
      if (!await stillAllowed()) return result('cancelled', '已暂停，本次未提交。');
      if (!samePage() || !keepComposer() || !editable()) return result('blocked', '提交前页面已变化。');
      if (hasAttachment()) return protectedDraft('提交前检测到附件，已保留输入框内容。');
      if (busy() || lateStop()) return result('busy', 'Agent 仍在运行。');
      if (args.persistentDelivery === true && inserted && (needsRefill || !readyPayload())) {
      const currentDraft = plainDraft(editor, true) ?? clean(textOf(editor));
      if (currentDraft && currentDraft.trim()) {
        preparedText = normalizeLineEndings(currentDraft);
        needsRefill = false;
      }
    }
    if (needsRefill || !readyPayload()) {
        const filled = await fill(prompt, true);
        if (!filled) return result('blocked', '输入框当前不可用，稍后重试。');
        insertedDraftSnapshot = snapshotDraft();
        needsRefill = false;
      }
      await wait(150);
      if (!samePage() || !keepComposer()) return result('blocked', '提交前页面已变化。');
      if (!withinDeadline()) return result('cancelled', '已暂停，本次未提交。');
      if (hasAttachment()) return protectedDraft('提交前检测到附件，已保留输入框内容。');
      if (!editable()) return result('blocked', '输入框当前不可用，稍后重试。');
      if (busy() || lateStop()) return result('busy', 'Agent 仍在运行。');
      if (args.persistentDelivery === true && inserted && (needsRefill || !readyPayload())) {
      const currentDraft = plainDraft(editor, true) ?? clean(textOf(editor));
      if (currentDraft && currentDraft.trim()) {
        preparedText = normalizeLineEndings(currentDraft);
        needsRefill = false;
      }
    }
    if (needsRefill || !readyPayload()) {
        const accepted = await fill(prompt, true);
        if (!accepted) return result('blocked', '输入框当前不可用，稍后重试。');
        insertedDraftSnapshot = snapshotDraft();
        needsRefill = false;
        if (!samePage() || !withinDeadline() || !keepComposer() || !editable()) return result('blocked', '提交前页面已变化。');
        if (hasAttachment()) return protectedDraft('提交前检测到附件，已保留输入框内容。');
        if (busy() || lateStop()) return result('busy', 'Agent 仍在运行。');
        // Unsupported rich editors can apply DOM input to their model after
        // this stack. Reobserve rather than clicking with only a DOM repaint.
        await wait(180);
        continue;
      }
      currentButton = findSendButton(composer);
      sendButton = currentButton?.isConnected && composer.contains(currentButton) ? currentButton : null;
    }
    if (!useKeyboardOnly && sendMethod === 'button' && !sendButton) return result('blocked', '发送按钮已不可用。');
    if (!useKeyboardOnly && observedSend && !sendButton && args.persistentDelivery !== true && !isDot) return result('blocked', '发送按钮已不可用。');
    if (!readyPayload()) return result('blocked', '输入框内容尚未稳定，稍后自动检查。', 'commit-not-dispatched');

    beforeAssistant = assistantState();
    mutable();
    rememberVisibleHistory();

    const clickButton = btn => {
      mutable();
      if (!btn) return false;
      try {
        if (!btn.isConnected || !composer.contains(btn) || !enabled(btn)) return false;
        submitted = true;
        progress('dispatch', 'dispatched');
        metrics.counters.dispatchAttempts++;
        try { btn.focus({ preventScroll: true }); } catch {}
        try { btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, cancelable: true })); } catch {}
        try { btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true, cancelable: true })); } catch {}
        btn.click();
        try { btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true, cancelable: true })); } catch {}
        try { btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, cancelable: true })); } catch {}
        return true;
      } catch { return false; }
    };

    const dispatchKey = withCtrl => {
      mutable();
      try {
        try { editor.focus({ preventScroll: true }); } catch {}
        const keyOpts = {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          ctrlKey: withCtrl, metaKey: false, altKey: false, shiftKey: false,
          bubbles: true, cancelable: true, composed: true, view: window
        };
        const downEvent = new KeyboardEvent('keydown', keyOpts);
        submitted = true;
        progress('dispatch', 'dispatched');
        metrics.counters.dispatchAttempts++;
        editor.dispatchEvent(downEvent);
        try { editor.dispatchEvent(new KeyboardEvent('keypress', keyOpts)); } catch {}
        editor.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
        return true;
      } catch { return false; }
    };

    if (sendButton) {
      metrics.method = 'button';
      clickButton(sendButton);
    } else {
      metrics.method = useKeyboardOnly || isDot ? 'ctrl-enter' : 'enter';
      dispatchKey(useKeyboardOnly || isDot);
    }

    if (!submitted) return result('blocked', '发送控件当前不可用，稍后自动检查。', 'commit-not-dispatched');

    return await confirmSubmission();
  } catch (error) {
    if (manualPending) {
      if (revoked) return result('cancelled', '本次执行已取消。');
      return await confirmSubmission();
    }
    if (revoked && metrics.timings.maxDomWriteMs >= 2000) return result(submitted ? 'unknown' : 'cancelled', '本次执行已取消。');
    if (error === unstableComposer && metrics.timings.maxDomWriteMs >= 2000) return result('blocked', '输入框写入耗时过长；已暂停，请检查页面后再继续。', 'composer-slow-write');
    if (error === unconfirmedChunk) return result('blocked', '分段文字写入未被页面接受；已暂停且未点击发送，请检查输入框。', 'chunk-unconfirmed');
    if (error === chunkAttachment) return result('blocked', '分段输入时页面出现附件；已暂停并保留附件，未点击发送。', 'chunk-attachment');
    if (error === chunkMismatch) return result('blocked', '分段文字与原文不一致；已暂停且未点击发送，请检查输入框。', 'chunk-mismatch');
    if (error === unstableComposer) return result('blocked', '输入框内容反复变化；稍后再次检查。', 'composer-unstable');
    if (error === humanEditedDuringSelection) return result('blocked', '输入框内容反复变化；稍后再次检查。', 'composer-unstable');
    if (error === unconfirmedPasteAttachment) return result('unknown', '粘贴后页面出现附件；内容尚未确认，已暂停并保留附件，请检查会话。', 'paste-attachment-unconfirmed');
    if (error === unconfirmedPaste) return result('unknown', '粘贴结果未确认；已暂停，请检查输入框和会话后再继续。', 'paste-unconfirmed');
    return result(submitted ? 'unknown' : 'error', '页面操作未完成，未记录页面内容。');
  } finally {
    await clearOwnDraft();
    if (!manualPending && document.activeElement === editor && previousFocus && previousFocus !== editor && previousFocus.isConnected) {
      try { previousFocus.focus({ preventScroll: true }); } catch {}
    }
  }
  };
  try {
    const actionResult = await action();
    metrics.reason = ['approval-required', 'auto-allowed-prompt', 'oauth-required', 'captcha-required', 'takeover-needed', 'agent-paused', 'agent-busy'].includes(actionResult.diagnosticCode)
      ? actionResult.diagnosticCode : resultReason(actionResult.status);
    const value = { ...actionResult, diagnosticProgress: diagnosticProgress() };
    if (invocation) {
      invocation.result = value;
      invocation.state = 'settled';
      completeInvocation(value);
    }
    if (cancellable) {
      try {
        // Do not make the injection return wait for this channel's response.
        // Either transport must be able to finish independently of the other.
        Promise.resolve(chrome.runtime.sendMessage({ type: 'PAGE_RESULT', runId: args.runId, resultToken: args.resultToken, result: value })).catch(() => { metrics.counters.transportErrors++; });
      } catch { metrics.counters.transportErrors++; /* The ordinary injection return remains an independent result channel. */ }
    }
    return value;
  } catch (error) {
    if (!invocation) throw error;
    metrics.reason = 'unknown';
    const value = { status: 'unknown', message: '页面操作未完成，未记录页面内容。', diagnosticProgress: diagnosticProgress() };
    invocation.result = value;
    invocation.state = 'settled';
    completeInvocation(value);
    return value;
  } finally {
    removeManualListeners();
    if (cancellable) chrome.runtime.onMessage.removeListener(cancel);
  }
}
