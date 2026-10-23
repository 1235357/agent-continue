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
  const busySelector = '.typing-indicator, button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"], button[aria-label="Stop response"], button[aria-label="停止生成"], button[aria-label="停止输出"], button[aria-label="停止流式传输"]';
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
  const busy = () => args.waitForIdle !== false && visibleMatches(busySelector).length > 0;
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
  const editors = [...new Set(visibleMatches(editorSelector))];
  if (editors.length !== 1) return result('blocked', '未识别到唯一输入框。页面可能尚未加载、已退出登录，或界面结构已变化。');
  const editor = editors[0];
  if (isDot && !identity()) return result('blocked', '等待 dot 会话历史加载，暂时无法核对目标身份。');
  // Guard drafts containing attachments/chips as well as plain text.
  const composer = editor.closest('[data-composer-root]') || editor.closest('form') || editor.closest('[data-composer-body]') || editor.closest('[data-composer-footer-responsive]') || editor.parentElement;
  const hasAttachment = () => !!composer && [...composer.querySelectorAll('[data-testid*="attachment"], [data-file-id], button[aria-label^="Remove file"], button[aria-label^="Remove attachment"], button[aria-label^="移除文件"], button[aria-label^="删除附件"]')].some(visible);
  const draftPresent = () => !!clean(textOf(editor)) || hasAttachment();
  if (busy()) return result('busy', 'Agent 仍在运行，稍后再次检查。');
  if (editor.disabled || editor.readOnly || (!editor.isContentEditable && !(editor instanceof HTMLTextAreaElement))) {
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

  const prompt = String(args.prompt);
  const beforeMessages = new Set(document.querySelectorAll(userSelector));
  const beforeKeys = new Set([...beforeMessages].map(messageKey).filter(Boolean));
  beforeAssistant = assistantState();
  const previousFocus = document.activeElement;
  let inserted = false;
  let insertedTextSnapshot = null;
  let clicked = false;

  const fill = value => {
    // This focuses a DOM element in the target document only. It never activates
    // a browser tab/window and never reads/writes the user's system clipboard.
    editor.focus({ preventScroll: true });
    if (editor instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!setter) return false;
      setter.call(editor, value);
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    } else {
      // Native editing commands produce the input events used by rich-text
      // editors. Avoid a blind textContent assignment that can bypass their state.
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
      if (!document.execCommand('insertText', false, value)) return false;
    }
    return clean(textOf(editor)) === clean(value);
  };

  const clearOwnDraft = () => {
    if (!clicked && inserted && editor.isConnected && textOf(editor) === insertedTextSnapshot) {
      try { fill(''); } catch { /* Leave text for inspection if the editor rejects clearing. */ }
    }
  };

  try {
    // Recheck after the asynchronous permission query so existing drafts survive.
    if (!samePage() || !editor.isConnected) return result('blocked', '页面已变化。');
    if (busy()) return result('busy', 'Agent 仍在运行。');
    if (draftPresent()) return result('draft', '检测到新草稿或附件，本次跳过。');
    if (!fill(prompt)) return result('blocked', '该输入框未接受后台填写，请检查页面。');
    inserted = true;
    insertedTextSnapshot = textOf(editor);

    let sendButton = null;
    const buttonDeadline = Date.now() + 2200;
    while (Date.now() < buttonDeadline) {
      if (!await stillAllowed()) {
        clearOwnDraft();
        return result('cancelled', '已暂停，本次未点击发送。');
      }
      if (busy()) {
        clearOwnDraft();
        return result('busy', '检测到正在运行，本次未点击发送。');
      }
      const buttons = [...new Set(visibleMatches(sendSelector, composer))];
      if (buttons.length === 1 && !buttons[0].disabled && buttons[0].getAttribute('aria-disabled') !== 'true') {
        sendButton = buttons[0];
        break;
      }
      await wait(150);
    }
    if (!sendButton) return result('blocked', '未找到唯一且可用的发送按钮；文字保留在输入框，请检查。');
    if (!await stillAllowed()) {
      clearOwnDraft();
      return result('cancelled', '已暂停，本次未点击发送。');
    }
    // No await between the final DOM checks and the click. A click already
    // dispatched before a pause cannot be withdrawn.
    if (!withinDeadline()) {
      clearOwnDraft();
      return result('cancelled', '本次发送许可已过期，未点击发送。');
    }
    if (!samePage() || !editor.isConnected || !sendButton.isConnected) return result('blocked', '提交前页面已变化。');
    if (busy()) { clearOwnDraft(); return result('busy', 'Agent 仍在运行。'); }
    if (textOf(editor) !== insertedTextSnapshot) return result('blocked', '输入框内容发生变化，已保留当前内容。');
    if (hasAttachment()) return result('blocked', '提交前检测到附件，已保留输入框内容。');
    if (sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') return result('blocked', '发送按钮已不可用。');
    sendButton.click();
    clicked = true;

    // A cleared editor alone is not proof of submission. Require a newly
    // rendered user message containing exactly the requested prompt.
    const confirmDeadline = Date.now() + 6500;
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
    // Do not call window.focus(), tabs.update({active:true}), or Clipboard APIs.
    // Respect a user who moved focus while we were waiting for confirmation.
    if (document.activeElement === editor && previousFocus && previousFocus !== editor && previousFocus.isConnected) {
      try { previousFocus.focus({ preventScroll: true }); } catch { /* No window activation. */ }
    }
  }
}
