// Agent Continue Content Script
// Keeps the chat tab active against background discarding/freezing in Chrome/Edge,
// reports dialog exceptions, and performs zero-lag idle observation of routine tool approval & takeover requests.

(() => {
  const runtimeId = typeof chrome !== 'undefined' && chrome.runtime?.id ? chrome.runtime.id : 'default';
  if (globalThis.__agentContinueContentRuntimeId === runtimeId) return;
  globalThis.__agentContinueContentRuntimeId = runtimeId;

  const classifyDialogContext = globalThis.__agentContinueClassifyDialog ?? (() => ({ safe: true, kind: 'none', evidence: [], confidence: 1.0 }));
  const scheduleTimer = globalThis.setTimeout.bind(globalThis);
  const scheduleIdle = typeof globalThis.requestIdleCallback === 'function'
    ? (fn, opts) => globalThis.requestIdleCallback(fn, opts)
    : fn => scheduleTimer(fn, 0);

  let keepalivePort = null;

  function connectKeepalive() {
    if (keepalivePort) return;
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
    try {
      keepalivePort = chrome.runtime.connect({ name: 'agent-continue-keepalive' });
      keepalivePort.onDisconnect.addListener(() => {
        keepalivePort = null;
        if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
          scheduleTimer(connectKeepalive, 3000);
        }
      });
    } catch {
      if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
        scheduleTimer(connectKeepalive, 5000);
      }
    }
  }

  connectKeepalive();

  let lastScrollAt = 0;
  try {
    const markScrollActive = () => { lastScrollAt = Date.now(); };
    window.addEventListener('scroll', markScrollActive, { passive: true, capture: true });
    window.addEventListener('wheel', markScrollActive, { passive: true, capture: true });
  } catch {}

  const authOrLoginCardPattern = /\b(?:sign\s*in|log\s*in|login|oauth|re-?authorize|authorize\s+(?:app|with)|connect\s+(?:account|your)|link\s+account|password|2fa)\b|登录|授权登录|同意登录|连接账号|关联账号|绑定账号|密码/i;
  const toolPromptPattern = /\b(?:always\s+allow|allow\s+once|allow|allow\s+this\s+time|approve|always\s+approve)\b|始终允许|总是允许|允许一次|允许/i;
  const closedSignInCardPattern = /\bsign[\s-]?in\s+request\s+(?:closed|completed|canceled|cancelled|dismissed|done)\b|登录请求\s*(?:已关闭|已完成|已取消|已结束)/i;
  const stripClosedSignInLines = value => String(value ?? '').split(/\r?\n/).filter(line => !closedSignInCardPattern.test(line)).join('\n');
  const takeoverRequestPattern = /把控制权交回|交回控制权|归还控制权|请.*完成(?:GitHub|OAuth|页面|登录|授权).*交回|请.*手动登录|请.*接管.*登录|完成授权并|请回复.*授权|接管浏览器|请求接管|需要(?:你|您)?接管|请(?:你|您)?(?:先)?(?:接管|登录|授权)|登录请求(?!\s*(?:已关闭|已完成|已取消|已结束))|请先完成.{0,12}(?:登录|授权)|需要(?:你|您)?手动完成.{0,12}(?:登录|授权)|\b(?:give|hand)\s+(?:me\s+)?control\s+back\b|\bhand\s+back\s+control\b|\breturn\s+(?:browser\s+)?control\b|\btake\s+over\s+(?:the\s+)?browser\b|\btake\s+over\s+and\s+(?:sign\s+in|log\s+in|authenticate)\b|\bplease\s+(?:take\s+over|sign\s+in|log\s+in)\b|\b(?:sign\s+in|log\s+in)\s+to\s+[a-z0-9.-]+\b|\bsign[\s-]?in\s+request\b(?!\s*(?:closed|completed|canceled|cancelled|dismissed|done))|\byour\s+dot\s+(?:needs|wants)\s+you\s+to\s+(?:sign\s+in|log\s+in|take\s+over)\b|\bcomplete\s+(?:the\s+)?(?:sign[\s-]?in|log[\s-]?in|login|authentication|authorization).*(?:control|continue|proceed)\b/i;
  const signInCardTextPattern = /\b(?:sign\s*in|log\s*in)\s+to\s+[a-z0-9.-]+\b|\bsign[\s-]?in\s+request\b(?!\s*(?:closed|completed|canceled|cancelled|dismissed|done))|\b(?:accounts\.google\.com|login\.microsoftonline\.com|github\.com|appleid\.apple\.com)\b|登录请求(?!\s*(?:已关闭|已完成|已取消|已结束))|接管浏览器|请求接管/i;
  const signInButtonPattern = /^(?:sign\s*in|log\s*in|login|authorize|re-?authorize|connect\s+account|take\s+over|give\s+control\s+back|hand\s+(?:control\s+)?back|return\s+control|登录|去登录|授权登录|同意并登录|接管|交回控制权|归还控制权)$/i;
  const captchaPattern = /\b(?:captcha|recaptcha|hcaptcha|turnstile|verify\s+you\s+are\s+human|one-time\s+(?:code|password)|2fa\s+code|verification\s+code|enter\s+(?:your\s+)?password)\b|人机验证|图形验证码|短信验证码|邮箱验证码|输入密码|动态口令/i;
  const busyControlSelector = 'button[data-testid="stop-button"], button[aria-label*="Stop" i], button[aria-label*="停止" i], .typing-indicator';
  const cardTokens = new WeakMap();

  function hasUnansweredRoutineToolCard() {
    if (!document.body) return false;
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]')];
    const recentTurns = [...document.querySelectorAll('article.message-row:not(.self), [data-message-author-role="assistant"], [data-chatgpt-search-unit-key$=":assistant"]')].slice(-2);
    const roots = [...dialogs, ...recentTurns];
    const controlSel = 'button, [role="button"], [role="option"], [role="radio"]';
    for (let r = 0; r < roots.length; r++) {
      const root = roots[r];
      if (!root?.isConnected || root.hasAttribute('hidden') || root.getAttribute('aria-hidden') === 'true') continue;
      let buttons;
      try { buttons = root.querySelectorAll(controlSel); } catch { continue; }
      if (!buttons.length) continue;
      let sawAllow = false;
      let sawDeny = false;
      let sawCompleted = false;
      let sawAuth = false;
      for (let i = 0; i < buttons.length; i++) {
        const el = buttons[i];
        // O(1) fast rejection before touching text or attributes heavily.
        if (el.childElementCount > 4) continue;
        const txt = el.textContent?.trim();
        if (!txt || txt.length > 80) continue;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
        if (['aria-checked', 'aria-pressed', 'aria-selected'].some(a => el.getAttribute(a) === 'true')
            || ['checked', 'selected', 'active'].includes(el.getAttribute('data-state'))
            || /[✓✔☑]/.test(txt)) {
          sawCompleted = true;
          continue;
        }
        const core = txt.replace(/[\s✓✔☑→›↗]+$/g, '').replace(/^(?:\(?[A-D1-4]\)?[\s.:\-]+|[A-D1-4]\s+)/i, '').trim();
        if (authOrLoginCardPattern.test(core)) { sawAuth = true; break; }
        if (/^(?:deny|decline|reject|don't allow|do not allow|never allow|cancel|拒绝|不允许|取消|驳回)$/i.test(core)) {
          sawDeny = true;
        } else if (/^(?:always\s+(?:allow|approve|permit|accept)|allow\s+(?:once|this\s+time)|allow|approve|始终允许|总是允许|允许一次|本次允许|允许|批准)$/i.test(core)) {
          sawAllow = true;
        }
      }
      if (!sawAuth && !sawCompleted && sawAllow && (sawDeny || toolPromptPattern.test(root.textContent?.slice(0, 600) || ''))) {
        return true;
      }
    }
    return false;
  }

  function findDotSignInCardToken() {
    if (!document.body) return null;
    const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]');
    for (const dlg of dialogs) {
      if (!dlg?.isConnected || dlg.hasAttribute('hidden') || dlg.getAttribute('aria-hidden') === 'true') continue;
      const dlgText = stripClosedSignInLines(dlg.textContent || '');
      if (dlgText && dlgText.length <= 2000 && takeoverRequestPattern.test(dlgText) && !captchaPattern.test(dlgText)) {
        let token = cardTokens.get(dlg);
        if (!token) {
          token = 'dialog:' + dlgText.replace(/\s+/g, ' ').trim().slice(0, 120);
          cardTokens.set(dlg, token);
        }
        return token;
      }
    }
    const userTurns = document.querySelectorAll('article.message-row.self, [data-message-author-role="user"]');
    const lastUserTurn = userTurns.length ? userTurns[userTurns.length - 1] : null;
    const userCount = userTurns.length;
    const controlBtns = document.querySelectorAll('button, [role="button"]');
    for (let i = 0; i < controlBtns.length; i++) {
      const btn = controlBtns[i];
      if (!btn?.isConnected || btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.childElementCount > 4) continue;
      const txt = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt || txt.length > 48) continue;
      if (/^(?:give\s+control\s+back|hand\s+(?:control\s+)?back|return\s+control|交回控制权|归还控制权)$/i.test(txt)) {
        return 'handover:' + txt;
      }
      if (!signInButtonPattern.test(txt)) continue;
      let curr = btn.parentElement;
      for (let depth = 0; depth < 8 && curr && curr !== document.body && curr !== document.documentElement; depth++, curr = curr.parentElement) {
        if (curr.hasAttribute('hidden') || curr.getAttribute('aria-hidden') === 'true') break;
        const cardText = stripClosedSignInLines(curr.textContent || '');
        if (!cardText || cardText.length > 1500) break;
        if (curr.querySelectorAll('article.message-row, [data-message-author-role], [role="textbox"]').length > 1) break;
        if (closedSignInCardPattern.test(curr.textContent || '')) break;
        if (signInCardTextPattern.test(cardText) && !captchaPattern.test(cardText)) {
          if (lastUserTurn && (curr.compareDocumentPosition(lastUserTurn) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
          let token = cardTokens.get(curr);
          if (!token) {
            token = `card:${userCount}:` + cardText.replace(/\s+/g, ' ').trim().slice(0, 120);
            cardTokens.set(curr, token);
          }
          return token;
        }
      }
    }
    return null;
  }

  function observeIdleTakeoverPrompt() {
    if (!document.body) return null;
    const cardToken = findDotSignInCardToken();
    if (cardToken) return cardToken;
    if (document.querySelector(busyControlSelector)) return null;
    const turns = document.querySelectorAll('article.message-row:not(.self), [data-message-author-role="assistant"], [data-chatgpt-search-unit-key$=":assistant"]');
    if (!turns.length) return null;
    const last = turns[turns.length - 1];
    const body = last.querySelector?.('.message-body') || last;
    const text = stripClosedSignInLines(body.textContent || '');
    if (!text || text.length > 4000 || !takeoverRequestPattern.test(text) || captchaPattern.test(text)) return null;
    return body.getAttribute?.('data-message-id') || last.getAttribute?.('data-message-id')
      || body.getAttribute?.('data-testid') || text.replace(/\s+/g, ' ').trim().slice(-120);
  }

  let scanTimer = null;
  let lastScanAt = 0;
  let lastKind = null;
  let lastRoutineApprovalAt = 0;
  let lastTakeoverAt = 0;
  let lastTakeoverToken = null;

  function scheduleDialogCheck(delay = 500) {
    if (scanTimer !== null || typeof chrome === 'undefined' || !chrome.runtime?.id) return;
    const waitMs = Math.max(delay, lastScanAt + 2000 - Date.now());
    scanTimer = scheduleTimer(() => {
      scanTimer = null;
      const sinceScroll = Date.now() - lastScrollAt;
      if (sinceScroll < 450) {
        scheduleDialogCheck(450 - sinceScroll + 50);
        return;
      }
      scheduleIdle(() => {
        if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
        const afterIdleScroll = Date.now() - lastScrollAt;
        if (afterIdleScroll < 450) {
          scheduleDialogCheck(450 - afterIdleScroll + 50);
          return;
        }
        lastScanAt = Date.now();
        const context = classifyDialogContext();
        if (context.recheckAfterMs) scheduleDialogCheck(context.recheckAfterMs);
        const kind = context.safe ? null : context.kind;
        if (kind !== lastKind) {
          lastKind = kind;
          if (kind) {
            try { Promise.resolve(chrome.runtime.sendMessage({ type: 'DIALOG_EXCEPTION', kind })).catch(() => {}); }
            catch { /* Extension reloaded or context invalidated. */ }
          }
        }
        if (context.safe && Date.now() - lastRoutineApprovalAt >= 2500 && hasUnansweredRoutineToolCard()) {
          lastRoutineApprovalAt = Date.now();
          try { Promise.resolve(chrome.runtime.sendMessage({ type: 'ROUTINE_APPROVAL_OBSERVED' })).catch(() => {}); }
          catch { /* Extension reloaded or context invalidated. */ }
        } else if (context.safe && Date.now() - lastTakeoverAt >= 2500) {
          const takeoverToken = observeIdleTakeoverPrompt();
          if (takeoverToken && takeoverToken !== lastTakeoverToken) {
            lastTakeoverToken = takeoverToken;
            lastTakeoverAt = Date.now();
            try { Promise.resolve(chrome.runtime.sendMessage({ type: 'TAKEOVER_PROMPT_OBSERVED', assistantToken: takeoverToken })).catch(() => {}); }
            catch { /* Extension reloaded or context invalidated. */ }
          }
        }
      }, { timeout: 800 });
    }, waitMs);
  }

  chrome.runtime.onMessage?.addListener?.(message => {
    if (message?.type === 'SCAN_DIALOG_CONTEXT') {
      if (message.reset === true) lastKind = null;
      scheduleDialogCheck();
    }
    return false;
  });

  if (typeof MutationObserver !== 'undefined' && document.body) {
    new MutationObserver(() => scheduleDialogCheck()).observe(document.body, { childList: true, subtree: true });
  }
  scheduleDialogCheck();
})();
