import { createTranslator } from './i18n.js';
import runtimeCatalog from './i18n-runtime.js';

const t = createTranslator(runtimeCatalog);

// Extension-context boundary: pageAction must remain closure-free when injected.
export function translatePageResult(value) {
  if (!value || typeof value !== 'object') return value;
  return { ...value, message: typeof value.message === 'string' && Object.hasOwn(runtimeCatalog, value.message) ? t(value.message) : value.message };
}

// This function is injected into one explicitly selected tab.
// Executed in ISOLATED world with authoritative background permission checks.
export async function pageAction(args) {
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
  const result = (status, message, diagnosticCode) => ({ status, message,
    ...(diagnosticCode ? { diagnosticCode } : {}), identity: identity(),
    ...(status === 'sent' ? beforeAssistant : assistantState()) });
  const samePage = () => {
    const curUrl = normalizeUrl(location.href);
    const expUrl = args.expectedUrl;
    const isCurDot = new URL(location.href).pathname.startsWith('/dots/');
    const isExpDot = expUrl.includes('/dots/');
    const urlMatch = curUrl === expUrl || (isExpDot && isCurDot);
    if (!urlMatch) return false;
    if (args.targetIdentity) {
      const currentId = identity();
      if (!currentId || currentId !== args.targetIdentity) return false;
    }
    return true;
  };
  const withinDeadline = () => Number.isFinite(args.runDeadline) && Date.now() < args.runDeadline;
  const forceInterrupt = args.waitForIdle !== true;
  const busy = () => !forceInterrupt && visibleMatches(busySelector).length > 0;
  const enabled = button => !!button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  const wait = async ms => {
    // Hidden-page timers can be clamped beyond the round deadline. New workers
    // own the clock; older workers retain the previous adapter contract.
    if (args.extensionClock === true) {
      const reply = await chrome.runtime.sendMessage({ type: 'WAIT_RUN', runId: args.runId, delayMs: ms });
      if (reply?.ok !== true || reply.allowed !== true || !samePage() || !withinDeadline()) {
        throw new Error('run-wait-cancelled');
      }
      return;
    }
    await new Promise(resolve => setTimeout(resolve, ms));
  };

  const stillAllowed = async () => {
    if (!samePage() || !withinDeadline()) return false;
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        const reply = await chrome.runtime.sendMessage({ type: 'CHECK_RUN', runId: args.runId });
        return reply?.ok === true && reply.allowed === true && samePage() && withinDeadline();
      } catch {
        return false;
      }
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
  const sameComposer = () => {
    const current = findComposer();
    return current?.editor === editor && current.composer === composer;
  };
  if (isDot && !identity()) return result('blocked', '等待 dot 会话历史加载，暂时无法核对目标身份。');

  // Guard drafts containing attachments/chips as well as plain text.
  const hasAttachment = () => !!composer && [...composer.querySelectorAll('[data-testid*="attachment"], [data-file-id], button[aria-label^="Remove file"], button[aria-label^="Remove attachment"], button[aria-label^="移除文件"], button[aria-label^="删除附件"]')].some(visible);
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
  if (hasAttachment()) return protectedDraft('输入框有附件，本次不提交。');

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
  let submitted = false;
  let interrupted = false;
  let needsRefill = false;

  // React can remount the editor while preserving the same composer. Never
  // follow an editor into another form or switch to a different composer.
  const keepComposer = () => {
    if (sameComposer()) return true;
    const next = findComposer();
    if (editor.isConnected || !next || next.composer !== composer) return false;
    editor = next.editor;
    inserted = false;
    insertedDraftSnapshot = null;
    needsRefill = true;
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

  const fill = (value, forceReplacement = false) => {
    if (!sameComposer()) return false;
    editor.focus({ preventScroll: true });
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
        dispatch(tr);
        try {
          editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        } catch {}
        if (forceReplacement) return true;
        return wait(50).then(() => clean(textOf(editor)) === clean(value));
      } catch {}
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
    const mayWrite = () => sameComposer() && (!forceReplacement || (samePage() && withinDeadline() && !hasAttachment() && editable()));
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
        setter.call(editor, value);
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
        if (!document.execCommand(value ? 'insertText' : 'delete', false, value)) {
          if (!value) {
            editor.innerHTML = '<p><br></p>';
          } else {
            const lines = value.split(/\r?\n/);
            editor.innerHTML = lines.map(line => `<p>${line ? line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '<br>'}</p>`).join('');
          }
        }
        if (!inputObserved) editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType, data: value || null }));
      } finally { editor.removeEventListener('input', observeInput, { capture: true }); }
      return forceReplacement || clean(textOf(editor)) === clean(value);
    });
  };

  const clearOwnDraft = async () => {
    if (!submitted && inserted && sameComposer() && samePage() && draftUnchanged(insertedDraftSnapshot)) {
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
    if (!forceInterrupt) return null;
    const stops = [...new Set(visibleMatches(stopSelector, composer))];
    if (!stops.length) return null;
    if (interrupted || stops.length !== 1 || !enabled(stops[0])) return result('blocked', '当前停止控件不可用或不唯一，稍后重试。');
    if (!await stillAllowed()) return result('cancelled', '已暂停，未打断 Agent。');
    if (!keepComposer() || !stops[0].isConnected || !composer.contains(stops[0])) return result('blocked', '页面已变化。');
    if (hasAttachment()) return protectedDraft('输入框有附件，本次不提交。');
    if (!samePage() || !withinDeadline() || !enabled(stops[0])) return result('cancelled', '打断许可已失效。');

    stops[0].click();
    interrupted = true;
    const stopDeadline = Math.min(Date.now() + 3500, args.runDeadline);
    while (Date.now() < stopDeadline) {
      if (!await stillAllowed()) return result('cancelled', '已暂停，不再继续发送。');
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
    const confirmDeadline = Math.min(Date.now() + 6500, args.runDeadline);
    while (Date.now() < confirmDeadline) {
      if (!samePage()) return result('unknown', '提交后会话地址变化，无法确认结果；请检查后再继续。');
      const messages = messageNodes('user');
      const last = messages.at(-1);
      const lastKey = messageKey(last);
      const modernReceipt = !isDot && last?.getAttribute('data-chatgpt-search-unit-key')?.endsWith(':user');
      if (last && (!modernReceipt || modernMessageKey(last)) && !beforeMessages.has(last)
        && (!lastKey || !beforeKeys.has(lastKey)) && clean(textOf(last)) === clean(prompt)) {
        return result('sent', useKeyboardOnly ? '已通过 Ctrl+Enter 提交，并在会话中确认新消息。' : '已确认发送并在会话中确认新消息。');
      }
      await wait(180);
    }
    return result('unknown', useKeyboardOnly ? '已发送 Ctrl+Enter，但未确认新消息；本周期不追加点击或重复按键。' : '已点击发送，但未确认新消息；本周期不立即重试。');
  };

  try {
    if (!samePage() || !sameComposer()) return result('blocked', '页面已变化。');
    if (busy()) return result('busy', 'Agent 仍在运行。');
    if (hasAttachment()) return protectedDraft('输入框有附件，本次不提交。');

    const interruptedResult = await interrupt();
    if (interruptedResult) return interruptedResult;

    if (!samePage() || !withinDeadline() || !keepComposer() || !editable()) return result('blocked', '输入框当前不可用，稍后重试。');
    if (hasAttachment()) return protectedDraft('输入框有附件，本次不提交。');

    if (args.modelCommit === true) {
      beforeAssistant = assistantState();
      rememberVisibleHistory();
      const commit = await chrome.runtime.sendMessage({ type: 'COMMIT_RUN', runId: args.runId });
      if (commit?.ok === true && commit.supported === true && commit.dispatched === true) {
        submitted = true;
        return await confirmSubmission();
      }
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
    inserted = accepted;
    if (accepted && sameComposer()) needsRefill = false;
    insertedDraftSnapshot = snapshotDraft();
    // Even matching DOM may precede a controlled input's model commit.
    await wait(180);

    const findSendButton = (root = composer) => {
      const scope = root;
      if (!scope) return null;
      const usable = btn => visible(btn) && enabled(btn) && !btn.matches?.(stopSelector);
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
    while (Date.now() < buttonDeadline) {
      if (!await stillAllowed()) {
        await clearOwnDraft();
        return result('cancelled', '已暂停，本次未提交。');
      }
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
    const currentButton = useKeyboardOnly ? null : findSendButton(composer);
    const sendButton = currentButton?.isConnected && composer.contains(currentButton) ? currentButton : null;
    if (sendMethod === 'button' && !sendButton) return result('blocked', '发送按钮已不可用。');

    beforeAssistant = assistantState();
    rememberVisibleHistory();
    submitted = true;

    const clickButton = btn => {
      if (!btn) return false;
      try {
        if (!btn.isConnected || !composer.contains(btn) || !enabled(btn)) return false;
        btn.click();
        return true;
      } catch { return false; }
    };

    const dispatchKey = withCtrl => {
      try {
        const keyOpts = {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          ctrlKey: withCtrl, metaKey: false, altKey: false, shiftKey: false,
          bubbles: true, cancelable: true, composed: true, view: window
        };
        const downEvent = new KeyboardEvent('keydown', keyOpts);
        editor.dispatchEvent(downEvent);
        editor.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
        return true;
      } catch { return false; }
    };

    if (sendButton) {
      clickButton(sendButton);
    } else {
      dispatchKey(useKeyboardOnly || isDot);
    }

    return await confirmSubmission();
  } catch (error) {
    return result(submitted ? 'unknown' : 'error', '页面操作未完成，未记录页面内容。');
  } finally {
    await clearOwnDraft();
    if (document.activeElement === editor && previousFocus && previousFocus !== editor && previousFocus.isConnected) {
      try { previousFocus.focus({ preventScroll: true }); } catch {}
    }
  }
}
