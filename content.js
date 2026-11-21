// Agent Continue Content Script
// Keeps the chat tab active and protected against background tab discarding/freezing in Chrome / Edge,
// and reports known dialog exceptions without interacting with the page.

(() => {
  const runtimeId = typeof chrome !== 'undefined' && chrome.runtime?.id ? chrome.runtime.id : 'default';
  if (globalThis.__agentContinueContentRuntimeId === runtimeId) return;
  globalThis.__agentContinueContentRuntimeId = runtimeId;

  const classifyDialogContext = globalThis.__agentContinueClassifyDialog ?? (() => ({ safe: true, kind: 'none', evidence: [], confidence: 1.0 }));
  const schedulePageObservation = globalThis.setTimeout.bind(globalThis);

  let keepalivePort = null;

  function connectKeepalive() {
    if (keepalivePort) return;
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
    try {
      keepalivePort = chrome.runtime.connect({ name: 'agent-continue-keepalive' });
      keepalivePort.onDisconnect.addListener(() => {
        keepalivePort = null;
        if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
          setTimeout(connectKeepalive, 3000);
        }
      });
    } catch {
      if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
        setTimeout(connectKeepalive, 5000);
      }
    }
  }

  connectKeepalive();

  let scanTimer = null;
  let lastScanAt = 0;
  let lastKind = null;
  function scheduleDialogCheck(delay = 500) {
    if (scanTimer !== null || typeof chrome === 'undefined' || !chrome.runtime?.id) return;
    scanTimer = schedulePageObservation(() => {
      scanTimer = null;
      lastScanAt = Date.now();
      if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
      const context = classifyDialogContext();
      if (context.recheckAfterMs) scheduleDialogCheck(context.recheckAfterMs);
      const kind = context.safe ? null : context.kind;
      if (kind === lastKind) return;
      lastKind = kind;
      if (kind) {
        try { Promise.resolve(chrome.runtime.sendMessage({ type: 'DIALOG_EXCEPTION', kind })).catch(() => {}); }
        catch { /* The extension may have been reloaded. */ }
      }
    }, Math.max(delay, lastScanAt + 2000 - Date.now()));
  }

  chrome.runtime.onMessage?.addListener?.(message => {
    if (message?.type === 'SCAN_DIALOG_CONTEXT') {
      lastKind = null;
      scheduleDialogCheck();
    }
    return false;
  });

  if (typeof MutationObserver !== 'undefined' && document.body) {
    new MutationObserver(() => scheduleDialogCheck()).observe(document.body, { childList: true, subtree: true });
  }
  scheduleDialogCheck();
})();
