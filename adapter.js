// This function is injected into one explicitly selected tab, in the isolated world.
// Keep it self-contained: chrome.scripting serializes the function body.
export async function pageAction(args) {
  const normalizeUrl = value => {
    const u = new URL(value);
    return u.origin + u.pathname.replace(/\/+$/, '');
  };
  // Rich-text paragraph boundaries can expose two newlines in innerText for
  // one logical line break. Normalize only comparisons; insertion uses the
  // original prompt verbatim.
  const clean = value => String(value ?? '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/\n{2,}/g, '\n').trim();
  const textOf = element => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? element.value : (element.innerText ?? element.textContent ?? '');
  const visible = element => !!element && element.isConnected && element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
  const visibleMatches = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible);
  const isDot = new URL(args.expectedUrl).pathname.startsWith('/dots/');
  const stopSelector = 'button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"], button[aria-label="Stop response"], button[aria-label="停止生成"], button[aria-label="停止输出"], button[aria-label="停止流式传输"]';
  const busySelector = '.typing-indicator, ' + stopSelector;
  const sendSelector = 'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"], button[aria-label="发送提示"], button[aria-label="发送消息"], button[aria-label="Send"], button[aria-label="发送"]';
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
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'CHECK_RUN', runId: args.runId });
      return reply?.ok === true && reply.allowed === true && samePage() && withinDeadline();
    } catch { return false; }
  };

  if (!samePage()) return result('blocked', '目标会话地址已改变，已停止发送。');
  const editorSelector = isDot
    ? '[data-composer-input] [contenteditable="true"][role="textbox"][aria-label="Message"], [contenteditable="true"][role="textbox"][data-composer-markdown]'
    : '#prompt-textarea, form[data-chatgpt-composer] .ProseMirror[contenteditable="true"]';
  const findComposer = () => {
    const editors = [...new Set(visibleMatches(editorSelector))];
    if (editors.length !== 1) return null;
    const editor = editors[0];
    return { editor, composer: editor.closest('[data-composer-root]') || editor.closest('form') || editor.closest('[data-composer-body]') || editor.closest('[data-composer-footer-responsive]') || editor.parentElement };
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
    // Prefer structure when available: innerText alone can turn two real line
    // breaks into three and falsely match a different configured prompt.
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
  let clicked = false;
  let interrupted = false;

  const fill = async value => {
    // This focuses a DOM element in the target document only. It never activates
    // a browser tab/window and never reads/writes the user's system clipboard.
    editor.focus({ preventScroll: true });
    const inputType = value ? 'insertText' : 'deleteContentBackward';
    const beforeText = textOf(editor);
    const target = editor;
    const handledInput = async () => {
      if (clean(textOf(target)) === clean(value)) return true;
      // Some controlled editors commit their cancelled beforeinput on a later
      // tick. Never issue a second insertion while that commit is pending.
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
          // A rejected edit may restore another draft. It belongs to the user,
          // even when it appeared while our event was being handled.
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
      // Native editing commands produce the input events used by rich-text
      // editors. Avoid a blind textContent assignment that can bypass their state.
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
      // execCommand does not consistently emit beforeinput. Let a controlled
      // editor update its model first; a cancelled event means it owns editing.
      // No Clipboard API or HTML insertion is involved.
      if (!editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, composed: true, cancelable: true, inputType, data: value || null }))) return handledInput();
      if (!editor.isConnected || document.activeElement !== editor || !selection.anchorNode || !editor.contains(selection.anchorNode)) return false;
      let inputObserved = false;
      const observeInput = () => { inputObserved = true; };
      editor.addEventListener('input', observeInput, { capture: true });
      try {
        if (!document.execCommand(value ? 'insertText' : 'delete', false, value)) return false;
        if (!inputObserved) editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType, data: value || null }));
      } finally { editor.removeEventListener('input', observeInput, { capture: true }); }
    }
    return clean(textOf(editor)) === clean(value);
  };

  const clearOwnDraft = async () => {
    if (!clicked && inserted && editor.isConnected && textOf(editor) === insertedTextSnapshot && !hasAttachment()) {
      const focusAtCleanup = document.activeElement;
      try { await fill(''); } catch { /* Leave text for inspection if the editor rejects clearing. */ }
      finally {
        if (document.activeElement === editor && focusAtCleanup && focusAtCleanup !== editor && focusAtCleanup.isConnected) {
          try { focusAtCleanup.focus({ preventScroll: true }); } catch { /* No window activation. */ }
        }
      }
    }
  };

  const interrupt = async () => {
    if (!forceInterrupt) return null;
    const stops = [...new Set(visibleMatches(stopSelector, composer))];
    if (!stops.length) return null; // Dot can accept Send while working.
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
    // Recheck after the asynchronous permission query so existing drafts survive.
    if (!samePage() || !editor.isConnected) return result('blocked', '页面已变化。');
    if (busy()) return result('busy', 'Agent 仍在运行。');
    if (draftPresent()) return result('draft', '检测到新草稿或附件，本次跳过。');
    const interruptedResult = await interrupt();
    if (interruptedResult) return interruptedResult;
    if (!samePage() || !withinDeadline() || !editor.isConnected || !editable()) return result('blocked', '输入框当前不可用，稍后重试。');
    if (draftPresent()) return result('draft', '检测到新草稿或附件，本次跳过。');
    const accepted = await fill(prompt);
    inserted = accepted;
    insertedTextSnapshot = textOf(editor);
    if (!accepted) return result('blocked', '输入框未接受完整填写，未点击发送；稍后重试。');

    let sendButton = null;
    const buttonDeadline = Math.min(Date.now() + 3200, args.runDeadline);
    while (Date.now() < buttonDeadline) {
      if (!await stillAllowed()) {
        await clearOwnDraft();
        return result('cancelled', '已暂停，本次未点击发送。');
      }
      if (busy()) {
        await clearOwnDraft();
        return result('busy', '检测到正在运行，本次未点击发送。');
      }
      if (!editor.isConnected || textOf(editor) !== insertedTextSnapshot || hasAttachment()) return result('blocked', '输入框内容发生变化，已保留当前内容。');
      // A new run can start while the composer is being filled. Stop once, then
      // reacquire a possibly replaced editor and synchronize its model again.
      if (forceInterrupt && visibleMatches(stopSelector, composer).length) {
        await clearOwnDraft();
        inserted = false;
        const interruption = await interrupt();
        if (interruption) return interruption;
        const refilled = await fill(prompt);
        inserted = refilled;
        insertedTextSnapshot = textOf(editor);
        if (!refilled) return result('blocked', '打断后输入框未接受完整填写，稍后重试。');
      }
      const buttons = [...new Set(visibleMatches(sendSelector, composer))];
      if (buttons.length === 1 && enabled(buttons[0])) {
        sendButton = buttons[0];
        break;
      }
      await wait(150);
    }
    if (!sendButton) return result('blocked', '未找到唯一且可用的发送按钮；本轮未提交，稍后重试。');
    if (!await stillAllowed()) {
      await clearOwnDraft();
      return result('cancelled', '已暂停，本次未点击发送。');
    }
    // No await between the final DOM checks and the click. A click already
    // dispatched before a pause cannot be withdrawn.
    if (!withinDeadline()) {
      await clearOwnDraft();
      return result('cancelled', '本次发送许可已过期，未点击发送。');
    }
    if (!samePage() || !editor.isConnected || !sendButton.isConnected) return result('blocked', '提交前页面已变化。');
    if (busy()) { await clearOwnDraft(); return result('busy', 'Agent 仍在运行。'); }
    if (textOf(editor) !== insertedTextSnapshot) return result('blocked', '输入框内容发生变化，已保留当前内容。');
    if (hasAttachment()) return result('blocked', '提交前检测到附件，已保留输入框内容。');
    if (forceInterrupt && visibleMatches(stopSelector, composer).length) return result('blocked', '提交前 Agent 状态变化，稍后重新打断并发送。');
    if (!enabled(sendButton)) return result('blocked', '发送按钮已不可用。');
    beforeAssistant = assistantState();
    sendButton.click();
    clicked = true;

    // A cleared editor alone is not proof of submission. Require a newly
    // rendered user message containing exactly the requested prompt.
    const confirmDeadline = Math.min(Date.now() + 6500, args.runDeadline);
    while (Date.now() < confirmDeadline) {
      if (!samePage()) return result('unknown', '点击后会话地址变化，无法确认提交结果；请检查后再继续。');
      const messages = [...document.querySelectorAll(userSelector)];
      const last = messages.at(-1);
      if (last && (messageKey(last) ? !beforeKeys.has(messageKey(last)) : !beforeMessages.has(last)) && clean(textOf(last)) === clean(prompt)) {
        return result('sent', '已在会话中看到新发送的消息。');
      }
      await wait(180);
    }
    return result('unknown', '已点击发送，但未确认新消息；本周期不立即重试。');
  } catch (error) {
    return result(clicked ? 'unknown' : 'error', '页面操作未完成，未记录页面内容。');
  } finally {
    // A failed pre-click attempt must not turn its own text into a permanent
    // human-draft lock. Never clear a submitted draft or a subsequent user edit.
    await clearOwnDraft();
    // Do not call window.focus(), tabs.update({active:true}), or Clipboard APIs.
    // Respect a user who moved focus while we were waiting for confirmation.
    if (document.activeElement === editor && previousFocus && previousFocus !== editor && previousFocus.isConnected) {
      try { previousFocus.focus({ preventScroll: true }); } catch { /* No window activation. */ }
    }
  }
}
