// This function is injected into one explicitly selected tab.
// Supports both MAIN and ISOLATED execution worlds:
// - In MAIN world: accesses ProseMirror runtime (pmViewDesc), React Fiber props, and page event listeners.
// - In ISOLATED world: falls back to DOM/execCommand and synthetic events.
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

  // Dot's actual composer submits with Send button or Ctrl+Enter.
  // When sendMethod is auto (default):
  // - on dot: tries keyboard first, and immediately falls back to Send button if unhandled
  // - on normal ChatGPT: prefers Send button
  const sendMethod = args.sendMethod || 'auto';
  const useKeyboardOnly = sendMethod === 'ctrl-enter';

  const stopSelector = 'button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"], button[aria-label="Stop response"], button[aria-label="停止生成"], button[aria-label="停止输出"], button[aria-label="停止流式传输"], button[aria-label*="Stop" i], button[aria-label*="停止" i]';
  const busySelector = '.typing-indicator, ' + stopSelector;
  const sendSelector = 'button[data-testid="send-button"], button[data-testid="composer-submit-button"], button[data-testid="fruitjuice-send-button"], button[data-testid*="send" i], button[data-testid*="submit" i], button[aria-label="Send prompt"], button[aria-label="Send message"], button[aria-label="发送提示"], button[aria-label="发送消息"], button[aria-label="Send"], button[aria-label="发送"], button[aria-label*="Send" i], button[aria-label*="发送" i], button[type="submit"]';
  const userSelector = isDot ? 'article.message-row.self .message-body' : '[data-message-author-role="user"]';
  const assistantSelector = isDot ? 'article.message-row:not(.self) .message-body' : '[data-message-author-role="assistant"]';

  const messageKey = element => element?.getAttribute('data-message-id') || element?.closest('[data-message-id]')?.getAttribute('data-message-id') || element?.id || null;

  const identity = () => {
    if (!isDot) return null;
    const row = [...document.querySelectorAll('article.message-row')].at(-1);
    const parts = messageKey(row?.querySelector('.message-body') || row)?.split('~') || [];
    return parts.length >= 3 ? parts.slice(0, 2).join('~') : null;
  };

  const assistantState = () => {
    const messages = [...document.querySelectorAll(assistantSelector)];
    return { assistantToken: messageKey(messages.at(-1)), assistantCount: messages.length };
  };

  let beforeAssistant = null;
  const result = (status, message) => ({ status, message, identity: identity(), ...(status === 'sent' ? beforeAssistant : assistantState()) });
  const samePage = () => normalizeUrl(location.href) === args.expectedUrl && (!args.targetIdentity || identity() === args.targetIdentity);
  const withinDeadline = () => Number.isFinite(args.runDeadline) && Date.now() < args.runDeadline;
  const forceInterrupt = args.waitForIdle !== true;
  const busy = () => !forceInterrupt && visibleMatches(busySelector).length > 0;
  const enabled = button => !!button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  const stillAllowed = async () => {
    if (!samePage() || !withinDeadline()) return false;
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        const reply = await chrome.runtime.sendMessage({ type: 'CHECK_RUN', runId: args.runId });
        return reply?.ok === true && reply.allowed === true && samePage() && withinDeadline();
      } catch {
        // In MAIN world, chrome.runtime.sendMessage is unavailable; rely on runDeadline & samePage.
      }
    }
    return samePage() && withinDeadline();
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
  if (isDot && !identity()) return result('blocked', '等待 dot 会话历史加载，暂时无法核对目标身份。');

  // Guard drafts containing attachments/chips as well as plain text.
  const hasAttachment = () => !!composer && [...composer.querySelectorAll('[data-testid*="attachment"], [data-file-id], button[aria-label^="Remove file"], button[aria-label^="Remove attachment"], button[aria-label^="移除文件"], button[aria-label^="删除附件"]')].some(visible);
  const prompt = String(args.prompt ?? '');
  const normalizeLineEndings = value => value.replace(/\r\n?/g, '\n');

  // Native contenteditable insertion represents line breaks as DIV/P blocks.
  // innerText adds an extra newline for an empty final block. Reconstruct only
  // these plain editing structures; never trim/collapse a human's whitespace.
  const plainDraft = node => {
    if (node.nodeType === Node.TEXT_NODE) return node.data;
    if (node.nodeType !== Node.ELEMENT_NODE || node.getAttribute('contenteditable') === 'false') return null;
    if (node.tagName === 'BR') return '\n';
    if (node !== editor && !['DIV', 'P', 'SPAN'].includes(node.tagName)) return null;
    const children = [...node.childNodes];
    if (node !== editor && ['DIV', 'P'].includes(node.tagName) && children.length === 1 && children[0].nodeName === 'BR') return '';
    let value = '';
    let previousBlock = false;
    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      const block = ['DIV', 'P'].includes(child.nodeName);
      const part = plainDraft(child);
      if (part === null) return null;
      if (index > 0 && (block || previousBlock)) value += '\n';
      value += part;
      previousBlock = block;
    }
    return value;
  };

  // Only force-mode sends may adopt an exact matching, attachment-free draft.
  // This recovers a v0.2.0 insertion without treating whitespace edits as ours.
  const matchingDraft = () => {
    if (args.mode !== 'send' || !forceInterrupt || !prompt || hasAttachment()) return false;
    const expected = normalizeLineEndings(prompt);
    const structured = editor instanceof HTMLTextAreaElement ? null : plainDraft(editor);
    return normalizeLineEndings(structured ?? textOf(editor)) === expected;
  };

  const draftPresent = () => hasAttachment() || (!!clean(textOf(editor)) && !matchingDraft());
  const editable = () => !editor.disabled && !editor.readOnly && (editor.isContentEditable || editor instanceof HTMLTextAreaElement);

  if (busy()) return result('busy', 'Agent 仍在运行，稍后再次检查。');
  if (!editable() && !(forceInterrupt && visibleMatches(stopSelector, composer).length === 1)) {
    return result('blocked', '输入框当前不可编辑。');
  }
  if (draftPresent()) return result('draft', '输入框已有草稿或附件，本次跳过。');

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
  if (!await stillAllowed()) return result('cancelled', '本次执行已取消。');

  const beforeMessages = new Set(document.querySelectorAll(userSelector));
  const beforeKeys = new Set([...beforeMessages].map(messageKey).filter(Boolean));
  beforeAssistant = assistantState();
  const previousFocus = document.activeElement;
  let inserted = false;
  let insertedTextSnapshot = null;
  let submitted = false;
  let interrupted = false;

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

  const fill = async value => {
    editor.focus({ preventScroll: true });

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
        await wait(50);
        return clean(textOf(editor)) === clean(value);
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
          if (humanEdited || !target.isConnected || !samePage()) return false;
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

    if (editor instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!setter) return false;
      editor.setSelectionRange(0, editor.value.length);
      if (!editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, composed: true, cancelable: true, inputType, data: value || null }))) return handledInput();
      setter.call(editor, value);
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType, data: value || null }));
    } else {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
      if (!editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, composed: true, cancelable: true, inputType, data: value || null }))) return handledInput();
      if (!editor.isConnected || !selection.anchorNode || !editor.contains(selection.anchorNode)) return false;
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
    }
    return clean(textOf(editor)) === clean(value);
  };

  const clearOwnDraft = async () => {
    if (!submitted && inserted && editor.isConnected && textOf(editor) === insertedTextSnapshot && !hasAttachment()) {
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
    if (!editor.isConnected || !stops[0].isConnected || !composer.contains(stops[0]) || draftPresent()) return result('blocked', '打断前输入框发生变化，已保留当前内容。');
    if (!samePage() || !withinDeadline() || !enabled(stops[0])) return result('cancelled', '打断许可已失效。');

    stops[0].click();
    interrupted = true;
    const stopDeadline = Math.min(Date.now() + 3500, args.runDeadline);
    while (Date.now() < stopDeadline) {
      if (!await stillAllowed()) return result('cancelled', '已暂停，不再继续发送。');
      const next = findComposer();
      if (next) {
        ({ editor, composer } = next);
        if (draftPresent()) return result('draft', '打断后检测到其他草稿或附件，已保留。');
        if (editable() && !visibleMatches(stopSelector, composer).length) return null;
      }
      await wait(150);
    }
    return result('blocked', '已请求停止，输入框尚未恢复发送状态；稍后重试。');
  };

  try {
    if (!samePage() || !editor.isConnected) return result('blocked', '页面已变化。');
    if (busy()) return result('busy', 'Agent 仍在运行。');
    if (draftPresent()) return result('draft', '检测到新草稿或附件，本次跳过。');

    const interruptedResult = await interrupt();
    if (interruptedResult) return interruptedResult;

    if (!samePage() || !withinDeadline() || !editor.isConnected || !editable()) return result('blocked', '输入框当前不可用，稍后重试。');
    if (draftPresent()) return result('draft', '检测到新草稿或附件，本次跳过。');

    const accepted = await fill(prompt);
    inserted = accepted;
    await wait(60);
    insertedTextSnapshot = textOf(editor);
    let insertedDraftSnapshot = plainDraft(editor);
    if (!accepted) return result('blocked', '输入框未接受完整填写，未点击发送；稍后重试。');

    const findSendButton = (root = composer) => {
      const scope = root;
      if (!scope) return null;
      const testIds = ['send-button', 'composer-submit-button', 'fruitjuice-send-button'];
      for (const tid of testIds) {
        const btn = scope.querySelector(`button[data-testid="${tid}"]`);
        if (btn && visible(btn)) return btn;
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
        const btn = scope.querySelector(sel);
        if (btn && visible(btn)) return btn;
      }
      const matches = [...scope.querySelectorAll(sendSelector)].filter(b => visible(b) && !b.matches(stopSelector));
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

    const isHumanDraft = () => {
      if (!editor.isConnected || hasAttachment()) return true;
      const currentText = textOf(editor);
      if (currentText === insertedTextSnapshot) return false;
      const currentStructured = plainDraft(editor);
      if (currentStructured !== null && insertedDraftSnapshot !== null && currentStructured === insertedDraftSnapshot) {
        return false;
      }
      return true;
    };

    let sendButton = null;
    const buttonDeadline = Math.min(Date.now() + 3200, args.runDeadline);
    while (Date.now() < buttonDeadline) {
      if (!await stillAllowed()) {
        await clearOwnDraft();
        return result('cancelled', '已暂停，本次未提交。');
      }
      if (busy()) {
        await clearOwnDraft();
        return result('busy', '检测到正在运行，本次未提交。');
      }
      if (isHumanDraft()) {
        return result('blocked', '输入框内容发生变化，已保留当前内容。');
      }
      if (forceInterrupt && visibleMatches(stopSelector, composer).length) {
        await clearOwnDraft();
        inserted = false;
        const interruption = await interrupt();
        if (interruption) return interruption;
        const refilled = await fill(prompt);
        inserted = refilled;
        await wait(60);
        insertedTextSnapshot = textOf(editor);
        insertedDraftSnapshot = plainDraft(editor);
        if (!refilled) return result('blocked', '打断后输入框未接受完整填写，稍后重试。');
      }

      sendButton = findSendButton(composer);
      if (sendButton && enabled(sendButton)) {
        break;
      }
      if (useKeyboardOnly) {
        break;
      }
      await wait(150);
    }

    if (sendMethod === 'button' && !sendButton) return result('blocked', '未找到可用发送按钮；本轮未提交，稍后重试。');
    if (!await stillAllowed()) {
      await clearOwnDraft();
      return result('cancelled', '已暂停，本次未提交。');
    }
    if (!withinDeadline()) {
      await clearOwnDraft();
      return result('cancelled', '本次发送许可已过期，未提交。');
    }

    if (!samePage() || !editor.isConnected || (sendMethod === 'button' && !sendButton.isConnected)) return result('blocked', '提交前页面已变化。');
    if (busy()) { await clearOwnDraft(); return result('busy', 'Agent 仍在运行。'); }
    if (isHumanDraft()) return result('blocked', '输入框内容发生变化，已保留当前内容。');
    if (hasAttachment()) return result('blocked', '提交前检测到附件，已保留输入框内容。');
    if (forceInterrupt && visibleMatches(stopSelector, composer).length) return result('blocked', '提交前 Agent 状态变化，稍后重新打断并发送。');
    if (sendMethod === 'button' && !enabled(sendButton)) return result('blocked', '发送按钮已不可用。');

    beforeAssistant = assistantState();
    submitted = true;

    const clickButton = btn => {
      if (!btn) return false;
      try {
        btn.disabled = false;
        btn.removeAttribute('disabled');
        btn.removeAttribute('aria-disabled');
        const opts = { bubbles: true, cancelable: true, composed: true, view: window };
        btn.dispatchEvent(new PointerEvent('pointerdown', opts));
        btn.dispatchEvent(new MouseEvent('mousedown', opts));
        btn.dispatchEvent(new PointerEvent('pointerup', opts));
        btn.dispatchEvent(new MouseEvent('mouseup', opts));
        btn.click();
        try {
          const propKey = Object.keys(btn).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$'));
          if (propKey && btn[propKey]?.onClick) {
            btn[propKey].onClick(new MouseEvent('click', opts));
          }
        } catch {}
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
        const pmView = getProseMirrorView(editor);
        if (pmView) {
          try { pmView.someProp('handleKeyDown', f => f(pmView, downEvent)); } catch {}
        }
        editor.dispatchEvent(downEvent);
        editor.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
        return true;
      } catch { return false; }
    };

    if (sendMethod === 'button') {
      clickButton(sendButton);
    } else if (sendMethod === 'ctrl-enter') {
      dispatchKey(true);
    } else {
      // 'auto' mode:
      if (isDot) {
        dispatchKey(true);
        await wait(100);
        // If synthetic key was ignored (editor not cleared on real page), click Send button!
        if (clean(textOf(editor)) === clean(prompt) || clean(textOf(editor)) !== '') {
          const targetBtn = sendButton || findSendButton(composer) || findSendButton(document);
          if (targetBtn) {
            clickButton(targetBtn);
          }
        }
      } else {
        const targetBtn = sendButton || findSendButton(composer) || findSendButton(document);
        if (targetBtn) clickButton(targetBtn);
        else dispatchKey(false);
      }
    }

    const confirmDeadline = Math.min(Date.now() + 6500, args.runDeadline);
    while (Date.now() < confirmDeadline) {
      if (!samePage()) return result('unknown', '提交后会话地址变化，无法确认结果；请检查后再继续。');
      const messages = [...document.querySelectorAll(userSelector)];
      const last = messages.at(-1);
      if (last && (messageKey(last) ? !beforeKeys.has(messageKey(last)) : !beforeMessages.has(last)) && clean(textOf(last)) === clean(prompt)) {
        return result('sent', useKeyboardOnly ? '已通过 Ctrl+Enter 提交，并在会话中确认新消息。' : '已确认发送并在会话中确认新消息。');
      }
      if (clean(textOf(editor)) === '' && visibleMatches(busySelector).length > 0) {
        return result('sent', useKeyboardOnly ? '已通过 Ctrl+Enter 提交，并在会话中确认新消息。' : '已确认发送并在会话中确认新消息。');
      }
      await wait(180);
    }

    return result('unknown', useKeyboardOnly ? '已发送 Ctrl+Enter，但未确认新消息；本周期不追加点击或重复按键。' : '已点击发送，但未确认新消息；本周期不立即重试。');
  } catch (error) {
    return result(submitted ? 'unknown' : 'error', '页面操作未完成，未记录页面内容。');
  } finally {
    await clearOwnDraft();
    if (document.activeElement === editor && previousFocus && previousFocus !== editor && previousFocus.isConnected) {
      try { previousFocus.focus({ preventScroll: true }); } catch {}
    }
  }
}
