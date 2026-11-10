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
    counters: Object.fromEntries(['pageAdmissions', 'modelWrites', 'domWrites', 'fillCalls', 'readinessChecks',
      'authorizationChecks', 'grantRequests', 'grantReadbacks', 'retiredReadbacks', 'dispatchAttempts',
      'receiptChecks', 'manualIntents', 'attachmentsRemoved', 'transportErrors', 'leaseRenewals', 'documentChanges'].map(name => [name, name === 'pageAdmissions' ? 1 : 0])),
    timings: { modelWriteMs: 0, domWriteMs: 0, maxModelWriteMs: 0, maxDomWriteMs: 0, elapsedMs: 0, stageElapsedMs: 0 },
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
    sendResponse({ revoked: true, runId: args.runId, resultToken: args.resultToken });
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
  const clean = value => String(value ?? '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/\n{2,}/g, '\n').trim();
  const textOf = element => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? element.value : (element.innerText ?? element.textContent ?? '');

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

  // Auto prefers the scoped Send button. Without one, Dot uses Ctrl+Enter
  // and ordinary ChatGPT uses Enter. No second method follows a dispatch.
  const sendMethod = args.sendMethod || 'auto';
  const useKeyboardOnly = sendMethod === 'ctrl-enter';

  const stopSelector = 'button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"], button[aria-label="Stop response"], button[aria-label="停止生成"], button[aria-label="停止输出"], button[aria-label="停止流式传输"], button[aria-label*="Stop" i], button[aria-label*="停止" i]';
  const busySelector = '.typing-indicator, ' + stopSelector;
  const sendSelector = 'button[data-testid="send-button"], button[data-testid="composer-submit-button"], button[data-testid="fruitjuice-send-button"], button[data-testid*="send" i], button[data-testid*="submit" i], button[aria-label="Send prompt"], button[aria-label="Send message"], button[aria-label="发送提示"], button[aria-label="发送消息"], button[aria-label="Send"], button[aria-label="发送"], button[aria-label*="Send" i], button[aria-label*="发送" i], button[type="submit"]';
  const modernSelector = role => `[data-chatgpt-search-unit-key$=":${role}"][data-chatgpt-search-message-ids]`;
  const userSelector = isDot
    ? '[data-message-author-role="user"], article.message-row.self .message-body'
    : `[data-message-author-role="user"], ${modernSelector('user')}`;
  const assistantSelector = isDot
    ? '[data-message-author-role="assistant"], article.message-row:not(.self) .message-body'
    : `[data-message-author-role="assistant"], ${modernSelector('assistant')}`;

  const modernMessageKey = element => element?.getAttribute('data-chatgpt-search-message-ids')?.trim().split(/\s+/)[0] || null;
  const messageKey = element => element?.getAttribute('data-message-id') || element?.closest('[data-message-id]')?.getAttribute('data-message-id') || modernMessageKey(element) || element?.getAttribute('data-testid') || element?.id || null;
  const messageNodes = role => [...new Set([...document.querySelectorAll(role === 'user' ? userSelector : assistantSelector)]
    .map(node => !isDot && node.closest?.(modernSelector(role)) || node))];

  const identity = () => {
    if (!isDot) return null;
    const row = [...document.querySelectorAll('article.message-row, [data-message-author-role], article[data-testid^="conversation-turn-"]')].at(-1);
    const key = messageKey(row?.querySelector('.message-body') || row);
    if (!key) return null;
    const parts = key.split('~');
    return parts.length >= 3 ? parts.slice(0, 2).join('~') : key;
  };

  const assistantState = () => {
    const messages = messageNodes('assistant');
    return { assistantToken: messageKey(messages.at(-1)), assistantCount: messages.length };
  };

  let beforeAssistant = null;
  const result = (status, message, diagnosticCode) => {
    metrics.reason = resultReason(status);
    return { status, message,
    ...(args.persistentDelivery === true && !submitted && !manualPending && ['blocked', 'draft', 'busy', 'error'].includes(status)
      ? { retryable: true } : {}),
    ...(diagnosticCode ? { diagnosticCode } : {}), identity: identity(),
    ...(['sent', 'manual-sent'].includes(status) ? beforeAssistant : assistantState()) };
  };
  const samePage = () => {
    const curUrl = normalizeUrl(location.href);
    const expUrl = args.expectedUrl;
    const isCurDot = new URL(location.href).pathname.startsWith('/dots/');
    const isExpDot = expUrl.includes('/dots/');
    const urlMatch = curUrl === expUrl || (isExpDot && isCurDot);
    if (!urlMatch) { if (pageMatched) metrics.counters.documentChanges++; pageMatched = false; return false; }
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
    metrics.observations.busy = visibleMatches(busySelector).length > 0;
    return !forceInterrupt && metrics.observations.busy;
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

  const initial = findComposer();
  if (!initial) return result('blocked', '未识别到唯一输入框。页面可能尚未加载、已退出登录，或界面结构已变化。');
  let { editor, composer } = initial;
  metrics.observations.composerPresent = true;
  metrics.observations.hidden = document.visibilityState === 'hidden';
  const sameComposer = () => {
    const current = findComposer();
    metrics.observations.composerPresent = !!current;
    return current?.editor === editor && current.composer === composer;
  };
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
  const inlineFormatting = new Set(['A', 'B', 'CODE', 'DEL', 'EM', 'I', 'MARK', 'S', 'SMALL', 'STRONG', 'SUB', 'SUP', 'U']);
  const plainDraft = (node, allowFormatting = false) => {
    if (node.nodeType === Node.TEXT_NODE) return node.data;
    if (node.nodeType !== Node.ELEMENT_NODE || node.getAttribute('contenteditable') === 'false') return null;
    if (node.tagName === 'BR') return '\n';
    if (node !== editor && !['DIV', 'P', 'SPAN'].includes(node.tagName) && !(allowFormatting && inlineFormatting.has(node.tagName))) return null;
    const children = [...node.childNodes];
    if (node === editor && children.length === 1 && children[0].nodeName === 'BR') return '';
    if (node !== editor && ['DIV', 'P'].includes(node.tagName) && children.length === 1 && children[0].nodeName === 'BR') return '';
    let value = '';
    let previousBlock = false;
    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      const block = ['DIV', 'P'].includes(child.nodeName);
      const part = plainDraft(child, allowFormatting);
      if (part === null) return null;
      if (index > 0 && (block || previousBlock)) value += '\n';
      value += part;
      previousBlock = block;
    }
    return value;
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

  if (busy()) return result('busy', 'Agent 仍在运行，稍后再次检查。');
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
      return normalizeLineEndings(editor.value) === normalizeLineEndings(prompt);
    }
    const current = plainDraft(editor, true);
    return current !== null && normalizeRenderedPayload(current) === normalizeRenderedPayload(prompt);
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
      const button = target?.closest?.(sendSelector);
      submitting = !!button && composer.contains(button) && !button.matches?.(stopSelector);
    } else if (event.type === 'submit') {
      submitting = target === composer || (composer.contains(target) && target?.matches?.('form'));
    } else if (event.type === 'keydown') {
      submitting = (target === editor || editor.contains(target)) && event.key === 'Enter'
        && !event.shiftKey && !event.altKey && !event.isComposing && event.keyCode !== 229 && !event.repeat && !event.defaultPrevented
        && (!isDot || event.ctrlKey === true || event.metaKey === true);
    }
    if (!submitting || !samePage() || !sameComposer() || !payloadMatches()) return;
    // Capture before the site's trusted handler clears or remounts the composer.
    rememberVisibleHistory();
    beforeAssistant = assistantState();
    latchManual(true);
  };

  const fill = (value, forceReplacement = false) => {
    mutable();
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
    return replaceAfter(() => {
      if (!mayWrite()) return false;
      // A beforeinput handler may move the caret. Replace, never append.
      if (forceReplacement) selectContents();
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
      return forceReplacement || clean(textOf(editor)) === clean(value);
    });
  };

  const clearOwnDraft = async () => {
    if (!manualPending && !submitted && inserted && sameComposer() && samePage() && draftUnchanged(insertedDraftSnapshot)) {
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
      if (last && (!modernReceipt || modernMessageKey(last)) && !beforeMessages.has(last)
        && (!lastKey || !beforeKeys.has(lastKey)) && (!manualPending || lastKey) && clean(textOf(last)) === clean(prompt)) {
        if (manualPending) return result('manual-sent', '已确认手动提交本轮提示词。');
        return result('sent', useKeyboardOnly ? '已通过 Ctrl+Enter 提交，并在会话中确认新消息。' : '已确认发送并在会话中确认新消息。');
      }
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
    if (busy()) return result('busy', 'Agent 仍在运行。');
    if (hasAttachment() && args.persistentDelivery === true && !await detachAttachments())
      return result('blocked', '发送控件当前不可用，稍后自动检查。', 'commit-not-dispatched');
    if (hasAttachment()) return protectedDraft('输入框有附件，本次不提交。');

    const interruptedResult = await interrupt();
    if (interruptedResult) return interruptedResult;

    if (!samePage() || !withinDeadline() || !keepComposer() || !editable()) return result('blocked', '输入框当前不可用，稍后重试。');
    if (hasAttachment()) return protectedDraft('输入框有附件，本次不提交。');

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
        event.preventDefault();
      };
      document.addEventListener(receiptEvent, captureReceiptBoundary, true);
      let commit;
      let committing = true;
      const observeLease = async () => {
        // Read the same invocation's current command permit while COMMIT_RUN is
        // pending. This observation does not prove MAIN progress or a submission.
        while (committing && !revoked && samePage()) {
          try { await wait(180, false); }
          catch {
            if (!committing || revoked || !samePage()) return;
            try {
              metrics.counters.authorizationChecks++;
              const reply = await chrome.runtime.sendMessage({ type: 'CHECK_RUN', runId: args.runId });
              if (reply?.ok === true && reply.allowed === false) { revoked = true; return; }
              if (reply?.allowed === true) grantedDeadline(reply.runDeadline);
            } catch { metrics.counters.transportErrors++; /* A recoverable transport error is not a permanent run veto. */ }
            await new Promise(resolve => setTimeout(resolve, 180));
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
    inserted = accepted;
    if (accepted && sameComposer()) needsRefill = false;
    insertedDraftSnapshot = snapshotDraft();
    // Even matching DOM may precede a controlled input's model commit.
    await wait(180);

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
    if (needsRefill || !payloadMatches()) {
      if (!editable()) return result('blocked', '输入框当前不可用，稍后重试。');
      const filledEditor = editor;
      const filled = await fill(prompt, true);
      if (!samePage() || !keepComposer()) return result('blocked', '提交前页面已变化。');
      if (editor === filledEditor) {
        if (!filled) return result('blocked', '输入框当前不可用，稍后重试。');
        needsRefill = false;
      }
      inserted = !needsRefill && payloadMatches();
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
    if (needsRefill || !payloadMatches()) {
      const filled = await fill(prompt, true);
      if (!filled) return result('blocked', '输入框当前不可用，稍后重试。');
      await wait(180);
    }
    if (needsRefill || !payloadMatches()) {
      const filled = await fill(prompt, true);
      if (!filled) return result('blocked', '输入框当前不可用，稍后重试。');
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
    if (!payloadMatches()) {
      const finalFill = fill(prompt, true);
      // Await only an actual asynchronous beforeinput handler. Awaiting a
      // boolean would let a page microtask undo a synchronous replacement.
      const accepted = finalFill && typeof finalFill.then === 'function' ? await finalFill : finalFill;
      if (!accepted) return result('blocked', '输入框当前不可用，稍后重试。');
      if (!samePage() || !withinDeadline() || !sameComposer() || !editable()) return result('blocked', '提交前页面已变化。');
      if (hasAttachment()) return protectedDraft('提交前检测到附件，已保留输入框内容。');
      if (busy() || lateStop()) return result('busy', 'Agent 仍在运行。');
    }
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
      if (needsRefill || !payloadMatches()) {
        if (!await fill(prompt, true)) return result('blocked', '输入框当前不可用，稍后重试。');
        needsRefill = false;
      }
      await wait(150);
      if (!samePage() || !keepComposer()) return result('blocked', '提交前页面已变化。');
      if (!withinDeadline()) return result('cancelled', '已暂停，本次未提交。');
      if (hasAttachment()) return protectedDraft('提交前检测到附件，已保留输入框内容。');
      if (!editable()) return result('blocked', '输入框当前不可用，稍后重试。');
      if (busy() || lateStop()) return result('busy', 'Agent 仍在运行。');
      if (needsRefill || !payloadMatches()) {
        const correction = fill(prompt, true);
        const accepted = correction && typeof correction.then === 'function' ? await correction : correction;
        if (!accepted) return result('blocked', '输入框当前不可用，稍后重试。');
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
    if (!useKeyboardOnly && (observedSend || sendMethod === 'button') && !sendButton) return result('blocked', '发送按钮已不可用。');

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
        btn.click();
        return true;
      } catch { return false; }
    };

    const dispatchKey = withCtrl => {
      mutable();
      try {
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
    metrics.reason = resultReason(actionResult.status);
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
