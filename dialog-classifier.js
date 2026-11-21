// Agent Continue Dialog Classifier (v3.1.0)
// Classifies dialog contexts in ChatGPT and Dot pages to detect:
// 1. Session expiry (requires re-login; auto-pauses task)
// 2. OAuth sign-in popups (requires manual user authentication; pauses task and notifies)
// 3. Unknown blocking modals (logs a diagnostic without pausing)
//
// Designed according to docs/DESIGN-v3.1.0-EXCEPTION-DIALOG-ENGINE.md
// Fail-open: any internal error returns { safe: true, kind: 'none' } so normal flow is never bricked.

(() => {
  const firstSeenMap = new WeakMap();

  function classifyButtonText(rawInput) {
    const raw = String(rawInput ?? '').replace(/[\s✓✔☑→›↗]+$/g, '').trim();
    if (!raw || raw.length > 56) return null;
    const badgeNormalized = raw.replace(/^([A-D1-4])(?=[A-Z\u4e00-\u9fa5])/, '$1 ');
    const core = badgeNormalized.replace(/^(?:\(?[A-D1-4]\)?[\s.:\-]+|[A-D1-4]\s+)/i, '').trim().toLowerCase();
    if (!core) return null;

    if ([
      'deny', 'decline', 'reject', "don't allow", 'do not allow', 'never allow', 'cancel',
      'dismiss', 'skip', 'not now', 'no', 'no, thanks', 'disagree', 'block', 'abort',
      '拒绝', '不允许', '取消', '驳回', '跳过', '暂不', '稍后', '不用了', '否', '不同意', '阻止', '忽略',
    ].includes(core)) {
      return { kind: 'deny' };
    }
    if (/\b(?:don't|do\s+not|never|not\s+now|no\b|cancel|deny|decline|reject|dismiss|skip|disagree|disconnect|unlink|revoke|remove|delete|sign\s*out|log\s*out|block|abort)\b|不要|不允许|拒绝|取消|驳回|跳过|暂不|稍后|不用|不同意|断开|解除|撤销|退出|注销|删除|阻止|忽略/i.test(core)) {
      return null;
    }
    if ([
      'always allow', 'allow always', 'always approve', 'always permit', 'allow all',
      'always accept', 'trust always', 'always continue',
      '始终允许', '总是允许', '一直允许', '全部允许', '始终同意', '始终批准', '始终授权',
    ].includes(core) || /^(?:always\s+(?:allow|approve|permit|accept|continue)|始终允许|总是允许|一直允许)\b/i.test(core)) {
      return { kind: 'always-allow' };
    }
    if ([
      'allow once', 'allow this time', 'approve once', 'just once', 'only this time', 'permit once',
      '允许一次', '仅允许一次', '本次允许', '仅此一次', '这次允许',
    ].includes(core) || /^(?:allow\s+once|allow\s+this\s+time|approve\s+once|允许一次|仅允许一次|本次允许)\b/i.test(core)) {
      return { kind: 'allow-once' };
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
      return { kind: 'allow' };
    }
    if ([
      'approve', 'confirm', 'accept', 'agree', 'i agree', 'continue', 'proceed', 'yes',
      'sign in', 'log in', 'login', 'connect', 'reconnect', 'enable', 'turn on', 'run', 'execute',
      '批准', '确认', '接受', '同意', '我同意', '继续', '是', '是的', '确定',
      '登录', '连接', '重新连接', '启用', '开启', '运行', '执行',
    ].includes(core)) {
      return { kind: 'allow' };
    }
    return null;
  }

  function detectSessionExpired() {
    const evidence = [];
    const title = typeof document !== 'undefined' ? document.title || '' : '';
    const pathname = typeof window !== 'undefined' && window.location ? window.location.pathname || '' : '';

    if (/sign\s+in|session\s+expired|log\s+in|your\s+session/i.test(title)) {
      evidence.push('title-matches-session-expired');
    }
    if (/登录|会话已过期|重新登录/.test(title)) {
      evidence.push('title-matches-chinese-login');
    }
    if (/^\/(?:auth\/|login|signin)/i.test(pathname)) {
      evidence.push('pathname-matches-auth');
    }

    const loginEl = typeof document !== 'undefined'
      ? document.querySelector?.('[data-testid="login-button"], form[action*="login"]')
      : null;
    const composerEl = typeof document !== 'undefined'
      ? document.getElementById?.('prompt-textarea')
      : null;

    if (loginEl && !composerEl) {
      evidence.push('login-form-without-composer');
    }

    if (evidence.length >= 2) {
      return { safe: false, kind: 'session-expired', evidence, confidence: 0.9 };
    }
    if (evidence.length === 1) {
      // Fail-low rule: 1 weak signal downgrades to unknown-modal level to avoid false pauses
      return { safe: false, kind: 'unknown-modal', evidence, confidence: 0.6 };
    }
    return null;
  }

  function detectOAuthPopup() {
    const evidence = [];
    const hostname = typeof window !== 'undefined' && window.location ? window.location.hostname || '' : '';

    if (/(?:accounts\.google\.com|login\.microsoftonline\.com|github\.com|appleid\.apple\.com)$/i.test(hostname)) {
      evidence.push(`navigated-to-oauth-host:${hostname}`);
      return { safe: false, kind: 'oauth-popup', evidence, confidence: 0.95 };
    }

    if (typeof document === 'undefined' || !document.querySelectorAll) return null;

    const dialogs = [
      ...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]')
    ];

    for (const dialog of dialogs) {
      if (dialog.hasAttribute('hidden') || dialog.getAttribute('aria-hidden') === 'true') continue;
      try {
        const st = getComputedStyle(dialog);
        if (st.display === 'none' || st.visibility === 'hidden') continue;
      } catch {}

      const text = dialog.textContent || '';
      if (/sign\s*in\s+with\s+(?:google|microsoft|apple|github|facebook)/i.test(text)
          || /使用\s*(?:Google|Apple|Microsoft|GitHub)\s*登录/i.test(text)
          || /(?:通过|使用)\s*.+\s*账号登录/i.test(text)) {
        evidence.push('dialog-contains-oauth-provider-text');
        return { safe: false, kind: 'oauth-popup', evidence, confidence: 0.85 };
      }

      const oauthLink = dialog.querySelector?.(
        'a[href*="accounts.google.com"], a[href*="login.microsoftonline.com"], a[href*="github.com/login/oauth"], a[href*="appleid.apple.com"], ' +
        'button[data-href*="accounts.google.com"], button[data-href*="login.microsoftonline.com"]'
      );
      if (oauthLink) {
        evidence.push('dialog-contains-oauth-link');
        return { safe: false, kind: 'oauth-popup', evidence, confidence: 0.9 };
      }
    }

    return null;
  }

  function detectUnknownModal() {
    if (typeof document === 'undefined' || !document.querySelectorAll) return null;

    const dialogs = [
      ...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')
    ];
    const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    let recheckAfterMs = Infinity;

    for (const dialog of dialogs) {
      if (dialog.hasAttribute('hidden') || dialog.getAttribute('aria-hidden') === 'true') continue;
      try {
        const st = getComputedStyle(dialog);
        if (st.display === 'none' || st.visibility === 'hidden') continue;
      } catch {}

      // If dialog has ChatGPT tool-use context or assistant turn ancestor, not an unknown modal
      if (dialog.closest?.('article.message-row, [data-message-author-role="assistant"]')) continue;

      // Check if dialog contains an allow-family option button
      const buttons = dialog.querySelectorAll?.('button, [role="button"], [role="option"], [role="radio"], a, label');
      let hasAllowButton = false;
      if (buttons) {
        for (let i = 0; i < buttons.length; i++) {
          const btnInfo = classifyButtonText(buttons[i].textContent);
          if (btnInfo && btnInfo.kind !== 'deny') {
            hasAllowButton = true;
            break;
          }
        }
      }
      if (hasAllowButton) continue;

      const firstSeen = firstSeenMap.get(dialog) ?? now;
      firstSeenMap.set(dialog, firstSeen);
      const remaining = Math.ceil(5000 - (now - firstSeen));
      if (remaining <= 0) {
        return {
          safe: false,
          kind: 'unknown-modal',
          evidence: ['unrecognized-modal-persisted-over-5s'],
          confidence: 0.7,
        };
      }
      recheckAfterMs = Math.min(recheckAfterMs, remaining);
    }

    return Number.isFinite(recheckAfterMs)
      ? { safe: true, kind: 'none', evidence: [], confidence: 1.0, recheckAfterMs }
      : null;
  }

  function classifyDialogContext() {
    try {
      const sessionCtx = detectSessionExpired();
      if (sessionCtx) return sessionCtx;

      const oauthCtx = detectOAuthPopup();
      if (oauthCtx) return oauthCtx;

      const unknownCtx = detectUnknownModal();
      if (unknownCtx) return unknownCtx;

      return { safe: true, kind: 'none', evidence: [], confidence: 1.0 };
    } catch {
      return { safe: true, kind: 'none', evidence: ['classifier-error'], confidence: 0 };
    }
  }

  globalThis.__agentContinueClassifyDialog = classifyDialogContext;
  globalThis.__agentContinueFirstSeenMap = firstSeenMap;
  globalThis.__agentContinueClassifyButtonText = classifyButtonText;
})();
