// Candidate only. The caller authorizes immediately before MAIN-world injection
// and owns integration, receipts, and cross-call deduplication. No async gap is
// permitted between the model transaction and the single submission attempt.
// Args: { expectedUrl, targetIdentity?, prompt, sendMethod?, deadline, phase? }.
// prepare writes without submitting; observe is read-only; commit is atomic.
// deadline is an absolute Date.now() deadline, not a runtime permission check.
export function editorCommit(args) {
  let supported = false;
  let dispatched = false;
  let method = null;
  const result = (code, extra = {}) => ({ supported, dispatched, method, code, ...extra });

  try {
    if (!args || typeof args.expectedUrl !== 'string' || typeof args.prompt !== 'string'
        || !Number.isFinite(args.deadline)
        || (args.targetIdentity != null && (typeof args.targetIdentity !== 'string' || !args.targetIdentity))) {
      return result('invalid-arguments');
    }
    const sendMethod = args.sendMethod ?? 'auto';
    if (!['auto', 'button', 'ctrl-enter'].includes(sendMethod)) return result('invalid-method');
    const phase = args.phase ?? 'commit';
    if (!['prepare', 'observe', 'commit'].includes(phase)) return result('invalid-phase');
    if (args.receiptBoundaryToken != null && (typeof args.receiptBoundaryToken !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(args.receiptBoundaryToken))) {
      return result('invalid-arguments');
    }
    const prompt = args.prompt.replace(/\r\n?/g, '\n');
    if (!prompt.trim()) return result('empty-payload');
    const expected = new URL(args.expectedUrl);
    if (!['https:', 'http:'].includes(expected.protocol)) return result('invalid-url');
    const isDot = expected.pathname.startsWith('/dots/');
    const normalizeUrl = url => url.origin + url.pathname.replace(/\/+$/, '');
    const identity = () => {
      const row = [...document.querySelectorAll('article.message-row, [data-message-author-role], article[data-testid^="conversation-turn-"]')].at(-1);
      const node = row?.querySelector?.('.message-body') || row;
      const key = node?.getAttribute('data-message-id') || node?.closest?.('[data-message-id]')?.getAttribute('data-message-id')
        || node?.getAttribute('data-testid') || node?.id;
      if (!key) return null;
      const parts = key.split('~');
      return parts.length >= 3 ? parts.slice(0, 2).join('~') : key;
    };
    const boundIdentity = isDot ? (args.targetIdentity ?? identity()) : null;
    const pageGuard = () => {
      if (Date.now() >= args.deadline) return 'expired';
      const current = new URL(location.href);
      if (current.origin !== expected.origin) return 'page-mismatch';
      const sameDotSurface = isDot && current.pathname.startsWith('/dots/');
      if (normalizeUrl(current) !== normalizeUrl(expected) && !sameDotSurface) return 'page-mismatch';
      if ((isDot && (!boundIdentity || identity() !== boundIdentity))
          || (!isDot && args.targetIdentity != null)) return 'target-mismatch';
      return null;
    };
    const initialPageFailure = pageGuard();
    if (initialPageFailure) return result(initialPageFailure);

    const visible = element => {
      if (!element?.isConnected || element.closest('[hidden], [inert]')) return false;
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden'
            || style.visibility === 'collapse' || style.opacity === '0') return false;
      }
      return document.visibilityState === 'hidden' || element.getClientRects().length > 0
        || element.offsetWidth > 0 || element.offsetHeight > 0;
    };
    const editorSelector = isDot
      ? '[data-composer-input] [contenteditable="true"][role="textbox"][aria-label="Message"], [contenteditable="true"][role="textbox"][data-composer-markdown], [data-composer-input] [contenteditable="true"], [data-composer-markdown][contenteditable="true"]'
      : '#prompt-textarea, form[data-chatgpt-composer] .ProseMirror[contenteditable="true"], .ProseMirror[contenteditable="true"]';
    const findComposer = () => {
      const editors = [...new Set([...document.querySelectorAll(editorSelector)].filter(visible))];
      if (editors.length !== 1) return null;
      const editor = editors[0];
      const composer = editor.closest('[data-composer-root]') || editor.closest('form')
        || editor.closest('[data-composer-body]') || editor.closest('[data-composer-footer-responsive]')
        || editor.parentElement;
      if (!composer || composer === document.body || composer === document.documentElement
          || composer === editor || !composer.contains(editor) || !visible(composer)) return null;
      return { editor, composer };
    };
    const binding = findComposer();
    if (!binding) return result('composer-unavailable');
    const { editor, composer } = binding;
    // Tiptap's Editor.createView stores its owner at view.dom.editor. Vanilla
    // ProseMirror has no such public owner link and uses the event adapter.
    // https://github.com/ueberdosis/tiptap/blob/main/packages/core/src/Editor.ts
    const owner = editor.editor;
    const view = owner?.view;
    if (!view || view.dom !== editor || view.isDestroyed || typeof view.dispatch !== 'function'
        || typeof view.state?.schema?.nodes?.paragraph?.create !== 'function'
        || typeof view.state.schema.text !== 'function' || typeof editor.focus !== 'function') {
      return result('unsupported-view');
    }
    const stopSelector = 'button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"], button[aria-label="Stop response"], button[aria-label="\u505c\u6b62\u751f\u6210"], button[aria-label="\u505c\u6b62\u8f93\u51fa"], button[aria-label="\u505c\u6b62\u6d41\u5f0f\u4f20\u8f93"], button[aria-label*="Stop" i], button[aria-label*="\u505c\u6b62" i]';
    const attachmentSelector = '[data-testid*="attachment"], [data-file-id], button[aria-label^="Remove file"], button[aria-label^="Remove attachment"], button[aria-label^="\u79fb\u9664\u6587\u4ef6"], button[aria-label^="\u5220\u9664\u9644\u4ef6"]';
    const guard = () => {
      const pageFailure = pageGuard();
      if (pageFailure) return pageFailure;
      const current = findComposer();
      if (current?.editor !== editor || current.composer !== composer) return 'composer-changed';
      if (editor.editor !== owner || owner.view !== view || view.dom !== editor || view.isDestroyed) return 'view-changed';
      if (!editor.isContentEditable || editor.disabled || editor.readOnly || view.editable !== true
          || editor.closest('[aria-disabled="true"], [inert]')) return 'not-editable';
      if ([...composer.querySelectorAll(attachmentSelector)].some(visible)
          || [...composer.querySelectorAll('input[type="file"]')].some(input => input.files?.length)) {
        return 'attachments';
      }
      if ([...composer.querySelectorAll(stopSelector)].some(visible)) return 'busy';
      return null;
    };
    const initialFailure = guard();
    if (initialFailure) return result(initialFailure);
    // A present but disabled Send is not permission to fall back to a keyboard
    // event. Controlled frameworks may enable it in their next render.
    const sendSelector = 'button[data-testid="send-button"], button[data-testid="composer-submit-button"], button[data-testid="fruitjuice-send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"], button[aria-label="Send"], button[aria-label="\u53d1\u9001\u63d0\u793a"], button[aria-label="\u53d1\u9001\u6d88\u606f"], button[aria-label="\u53d1\u9001"]';
    const sendControls = () => [...new Set([...composer.querySelectorAll(sendSelector)]
      .filter(button => composer.contains(button) && visible(button)))];
    const enabledSend = button => !button.disabled && button.getAttribute('aria-disabled') !== 'true'
      && !button.closest('[aria-disabled="true"], [inert]');
    const readiness = () => {
      if (sendMethod === 'ctrl-enter') return 'ready';
      const controls = sendControls();
      const sends = controls.filter(enabledSend);
      if (sends.length > 1) return 'send-ambiguous';
      if (sends.length === 1) return 'ready';
      if (controls.length) return 'waiting-send';
      return args.requireButton === true || initiallyHasSend ? 'waiting-send' : sendMethod === 'button' ? 'send-unavailable' : 'ready';
    };
    const initiallyHasSend = sendControls().length > 0;
    if (phase === 'observe') {
      supported = true;
      return result(readiness(), { hasSend: initiallyHasSend });
    }
    const logicalText = doc => doc.textBetween(0, doc.content.size, '\n', '\n');
    const prepare = state => {
      const paragraphs = prompt.split('\n').map(line =>
        state.schema.nodes.paragraph.create(null, line ? state.schema.text(line) : undefined));
      const transaction = state.tr.replaceWith(0, state.doc.content.size, paragraphs);
      transaction.doc.check();
      if (logicalText(transaction.doc) !== prompt) throw new Error('unsupported-document');
      return transaction;
    };
    let failure;
    // After preparation, don't restart the framework's delayed activation by
    // redundantly dispatching the same model. Changed text is still replaced.
    if (args.phase !== 'commit' || logicalText(view.state.doc) !== prompt) {
      const state = view.state;
      let transaction = prepare(state);
      supported = true;
      if (view.state !== state) transaction = prepare(view.state);
      failure = guard();
      if (failure) return result(failure);
      view.dispatch(transaction);
      failure = guard();
      if (failure) return result(failure);
      if (args.phase !== 'commit') {
        editor.focus({ preventScroll: true });
        failure = guard();
        if (failure) return result(failure);
        for (const type of ['input', 'change']) {
          editor.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
          failure = guard();
          if (failure) return result(failure);
        }
      }
    }
    supported = true;

    // Page-controlled content changes do not veto the send. Reassert once from
    // the current public model, without another event/settling cycle or a loop.
    if (logicalText(view.state.doc) !== prompt) {
      const correction = prepare(view.state);
      failure = guard();
      if (failure) return result(failure);
      view.dispatch(correction);
    }
    const committedGuard = () => guard()
      || (logicalText(view.state.doc) !== prompt ? 'model-not-synchronous' : null);
    failure = committedGuard();
    if (failure) return result(failure);
    if (phase === 'prepare') return result('prepared', { hasSend: initiallyHasSend || sendControls().length > 0 });

    // Exact known Send identifiers only, never a page-wide or generic control.
    const ready = readiness();
    if (ready !== 'ready') return result(ready);
    if (args.receiptBoundaryToken) {
      // The isolated adapter snapshots history synchronously, after all model
      // corrections and without another worker/message round trip before send.
      const boundary = new Event('agent-continue-receipt-' + args.receiptBoundaryToken,
        { bubbles: true, cancelable: true });
      if (editor.dispatchEvent(boundary)) return result('receipt-unavailable');
      const currentReady = readiness();
      if (currentReady !== 'ready') return result(currentReady);
    }
    const sends = sendMethod === 'ctrl-enter' ? [] : sendControls().filter(enabledSend);
    failure = committedGuard();
    if (failure) return result(failure);
    if (sends.length === 1) {
      method = 'button';
      dispatched = true;
      sends[0].click();
    } else {
      const ctrlKey = sendMethod === 'ctrl-enter' || isDot;
      const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        ctrlKey, metaKey: false, altKey: false, shiftKey: false,
        bubbles: true, cancelable: true, composed: true, view: window };
      const down = new KeyboardEvent('keydown', init);
      const up = new KeyboardEvent('keyup', init);
      failure = committedGuard();
      if (failure) return result(failure);
      method = ctrlKey ? 'ctrl-enter' : 'enter';
      dispatched = true;
      editor.dispatchEvent(down);
      editor.dispatchEvent(up);
    }
    return result('dispatched');
  } catch {
    // Once dispatch was attempted, even an exception must never invite fallback.
    return result(dispatched ? 'dispatch-error' : supported ? 'commit-error' : 'unsupported-view');
  }
}
