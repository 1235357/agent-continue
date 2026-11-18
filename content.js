// Agent Continue Content Script
// Keeps the chat tab active and protected against background tab discarding/freezing in Chrome / Edge,
// and observes blocking tool/permission/authorization/login confirmation prompts in real time.

(() => {
  const runtimeId = typeof chrome !== 'undefined' && chrome.runtime?.id ? chrome.runtime.id : 'default';
  if (globalThis.__agentContinueContentRuntimeId === runtimeId) return;
  globalThis.__agentContinueContentRuntimeId = runtimeId;

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

  // Real-time observer for tool/permission/authorization/login confirmation prompts.
  let approvalScanScheduled = false;
  let lastApprovalNotifyAt = 0;

  function hasUnansweredApprovalPrompt() {
    try {
      const visible = el => {
        if (!el || !el.isConnected || el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;
        try {
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        } catch {}
        return true;
      };
      const extractText = node => {
        if (!node) return '';
        if (node.nodeType === Node.TEXT_NODE) return node.data || '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        if (['SVG', 'PATH', 'G', 'CIRCLE', 'RECT', 'LINE', 'POLYGON', 'POLYLINE', 'USE', 'IMG', 'SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.tagName)) return '';
        if (node.hasAttribute('hidden')) return '';
        const parts = [];
        for (const child of node.childNodes) {
          const piece = extractText(child).trim();
          if (piece) parts.push(piece);
        }
        return parts.join(' ').replace(/\s+/g, ' ').trim();
      };
      const classify = rawInput => {
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

      const selector = 'button, [role="button"], [role="option"], [role="radio"], [role="menuitem"], label, li, a, div, span';
      const excludedSelector = '#prompt-textarea, .ProseMirror, [contenteditable="true"], [data-message-author-role="user"], article.message-row.self, article.self, pre, code, nav, header, aside, footer, [role="navigation"], [role="banner"], [data-testid*="sidebar"]';
      const rawMatched = [];
      const scan = root => {
        let nodes = [];
        try { nodes = [...root.querySelectorAll(selector)]; } catch { return; }
        for (const el of nodes) {
          if (el.shadowRoot) scan(el.shadowRoot);
          if (!visible(el) || el.closest?.(excludedSelector)) continue;
          if (el.tagName === 'A' && el.hasAttribute('href') && !el.matches?.('[role="button"]') && !/oauth|authorize|connect|login|signin|auth/i.test(el.getAttribute('href') || '')) continue;
          const info = classify(extractText(el));
          if (info) rawMatched.push({ el, info });
        }
      };
      scan(document);
      if (!rawMatched.length) return false;

      const leafItems = rawMatched.filter(item =>
        !rawMatched.some(other => other.el !== item.el && item.el.contains(other.el) && other.info.kind === item.info.kind)
      );
      const semanticSelector = 'button, [role="button"], [role="option"], [role="radio"], [role="menuitem"], a, label, input[type="button"], input[type="submit"]';
      const options = [];
      const seenPills = new Set();
      for (const leaf of leafItems) {
        const chain = rawMatched
          .filter(item => item.info.kind === leaf.info.kind && (item.el === leaf.el || item.el.contains(leaf.el)))
          .sort((a, b) => (a.el === b.el ? 0 : a.el.contains(b.el) ? -1 : 1));
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
      if (!allowOptions.length) return false;

      const findLCA = (a, b) => {
        for (let curr = a; curr && curr !== document.body && curr !== document.documentElement && curr.tagName !== 'MAIN'; curr = curr.parentElement) {
          if (curr.contains(b)) return curr;
        }
        return null;
      };
      const promptPattern = /allow\s+chatgpt\s+to\b|wants\s+to\s+(?:use|call|run|access|search|read|write|execute|connect|open|view|edit|send|create|update|delete)\b|permission\s+to\s+(?:use|run|access|connect|read|write)|authorize\s+.+\s+to\b|requires?\s+(?:authorization|authentication|permission|sign[\s-]?in|log[\s-]?in)|(?:connect|link|sign\s+in\s+to|log\s+in\s+to|authorize)\s+(?:your\s+)?[a-z0-9_.\s-]{1,40}\s*(?:account|workspace|integration|connector|app)?|to\s+continue,?\s+(?:please\s+)?(?:sign\s+in|log\s+in|connect|authorize|allow|confirm)|confirm\s+(?:this\s+)?(?:action|request|tool|operation)|是否允许\s*chatgpt|允许\s*chatgpt\s*(?:使用|访问|调用|搜索|读取|执行|连接|查看|修改)|(?:需要|请求|请先?)\s*(?:授权|登录|连接|确认权限|允许访问)|(?:连接|关联|绑定|登录|授权)\s*(?:你的|您的)?\s*[^\s，。！？]{1,30}\s*(?:账号|账户|工作区|应用|服务)?/i;
      const assistantOrDialogSelector = 'article.message-row:not(.self), [data-message-author-role="assistant"], [data-chatgpt-search-unit-key$=":assistant"], [role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]';
      const allowedCardMap = globalThis.__agentContinueAllowedCards instanceof Map ? globalThis.__agentContinueAllowedCards : null;

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
          for (let d = 0; d < 12 && curr && curr !== document.body && curr !== document.documentElement && curr.tagName !== 'MAIN'; d++, curr = curr.parentElement) {
            if (curr.querySelectorAll('article.message-row, [data-message-author-role]').length > 1) break;
            const currText = extractText(curr);
            if (currText.length <= 1200 && promptPattern.test(currText)) {
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

        const groupAllows = allowOptions.filter(o => groupContainer.contains(o.pillEl));
        const groupDenies = denyOptions.filter(o => groupContainer.contains(o.pillEl));
        const groupAll = [...groupAllows, ...groupDenies];

        const isOptionSkipped = opt => {
          const el = opt.pillEl;
          if (!el || !el.isConnected || el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('[inert], [aria-disabled="true"]')) return true;
          if (['aria-checked', 'aria-pressed', 'aria-selected'].some(attr => el.getAttribute(attr) === 'true')) return true;
          if (['checked', 'selected', 'active'].includes(el.getAttribute('data-state')) || el.getAttribute('data-selected') === 'true') return true;
          if (el.getAttribute('aria-busy') === 'true' || el.getAttribute('data-loading') === 'true' || el.querySelector?.('.animate-spin')) return true;
          if (/[✓✔☑]/.test(el.textContent || '')) return true;
          return false;
        };
        const hasAsymmetricSvgCheckmark = groupAllows.length > 0 && groupDenies.length > 0 && (
          (groupAllows.some(o => o.pillEl.querySelectorAll('svg').length > 0) && groupDenies.every(o => o.pillEl.querySelectorAll('svg').length === 0))
          || (groupDenies.some(o => o.pillEl.querySelectorAll('svg').length > 0) && groupAllows.every(o => o.pillEl.querySelectorAll('svg').length === 0))
        );
        if (groupAll.some(isOptionSkipped) || hasAsymmetricSvgCheckmark) continue;

        const domStamp = Number(
          groupContainer.getAttribute('data-agent-continue-allowed')
          || groupAllows[0]?.pillEl.getAttribute('data-agent-continue-allowed')
          || 0
        );
        if (domStamp > 0 && Date.now() - domStamp < 25_000) continue;

        if (allowedCardMap) {
          let cardRoot = groupContainer;
          const baseBtns = groupContainer.querySelectorAll('button, [role="button"], [role="option"], [role="radio"]').length;
          for (let d = 0; d < 4 && cardRoot?.parentElement && cardRoot.parentElement !== document.body && cardRoot.parentElement.tagName !== 'MAIN'; d++) {
            const parent = cardRoot.parentElement;
            if (parent.querySelectorAll('article.message-row, [data-message-author-role]').length > 1) break;
            const parentBtns = parent.querySelectorAll('button, [role="button"], [role="option"], [role="radio"]').length;
            if (baseBtns > 0 && parentBtns > baseBtns) break;
            cardRoot = parent;
          }
          const cardKey = `${allowOptions.indexOf(allowOpt)}:${extractText(cardRoot).replace(/\s+/g, ' ').trim().slice(0, 160) || 'approval-card'}`;
          const memStamp = Number(allowedCardMap.get(cardKey) || 0);
          if (memStamp > 0 && Date.now() - memStamp < 3000) continue;
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  function scheduleApprovalCheck(delayMs = 200, force = false) {
    if (approvalScanScheduled && delayMs > 0 && !force) return;
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
    approvalScanScheduled = true;
    setTimeout(() => {
      approvalScanScheduled = false;
      if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
      const now = Date.now();
      if (!force && delayMs > 0 && now - lastApprovalNotifyAt < 1200) return;
      if (hasUnansweredApprovalPrompt()) {
        lastApprovalNotifyAt = now;
        try {
          Promise.resolve(chrome.runtime.sendMessage({ type: 'APPROVAL_PROMPT_OBSERVED' }))
            .then(res => {
              if (res?.autoAllowed) {
                scheduleApprovalCheck(900, true);
                scheduleApprovalCheck(2500, true);
              }
            })
            .catch(() => {});
        } catch {}
      }
    }, delayMs);
  }

  try {
    chrome.runtime.onMessage?.addListener?.(message => {
      if (message?.type === 'SCAN_APPROVAL_PROMPT') {
        lastApprovalNotifyAt = 0;
        scheduleApprovalCheck(0, true);
      }
      return false;
    });
  } catch {}

  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(() => scheduleApprovalCheck());
    const attachObserver = () => {
      if (!document.body) {
        setTimeout(attachObserver, 200);
        return;
      }
      observer.observe(document.body, { childList: true, subtree: true });
      scheduleApprovalCheck(250);
    };
    attachObserver();
  }
  setInterval(() => scheduleApprovalCheck(0), 2500);
})();
