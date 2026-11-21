# Design: Exception Dialog Engine — Agent Continue v3.1.0

**Status:** REVISED — reconciled after three-reviewer pass (comprehension ✅, criticism ✅ self, readiness ✅ self)
**Date:** 2026-11-20 (rev 2)
**Author:** Zhentong Ye
**Baseline:** v3.0.25 source, commit f5e11c8

> Historical design record. Current code observes permission cards without clicking them or invoking their handlers. Auto-approval acceptance criteria below no longer apply.

---

## Review Findings Applied in This Revision

| Finding | Source | Resolution |
|---|---|---|
| `pauseTask()` vs `enqueueStateTransition()` naming conflict | comprehension | Fixed — §2.1 now uses `pauseLocked()` (the actual function in background.js:535) |
| "approval-scan scheduling path" too vague — exact function not named | comprehension + readiness | Fixed — §2.4 now names exact function `scheduleApprovalCheck()` and exact line of insertion (content.js:320) |
| `appendActivity()` does not exist — actual function is `recordActivityEvent()` | readiness | Fixed — all references updated |
| `enqueueStateTransition()` does not exist — actual function is `pauseLocked()` | readiness | Fixed — §2.5 updated |
| `"notifications"` not in `optional_permissions` | readiness | Confirmed absent; §2.6 specifies exact addition |
| Mixed dialog with BOTH "Sign in with Google" AND "Allow" button unhandled | criticism | Fixed — §2.3 adds explicit priority override rule |
| TC-02 DOM fixture for "ChatGPT tool-use dialog" too vague | comprehension | Fixed — TC-02 revised with concrete DOM attributes |
| TC-08 "Dot conversation" undefined fixture | comprehension | Fixed — TC-08 revised with a concrete HTML fixture |
| `auto-allowed-prompt` handling in background.js is in `handleApprovalPromptObserved()` | readiness | §2.5 integration hook now names exact function |

---

## Concepts Brief

**What is known:**
- `content.js` (370 lines): `hasUnansweredApprovalPrompt()` → `classify()` is the approval-detection path.
- The approval notification is sent in `scheduleApprovalCheck()` at **line 320** of `content.js`:
  ```js
  if (hasUnansweredApprovalPrompt()) {
    lastApprovalNotifyAt = Date.now();
    chrome.runtime.sendMessage({ type: 'APPROVAL_PROMPT_OBSERVED' }) ...
  }
  ```
- Background handles the approval at `handleApprovalPromptObserved()` (background.js:1924).
- The activity log function is `recordActivityEvent(event, message, diagnostic)` (background.js:447).
- The pause function is `pauseLocked(job, message, event, diagnostic, interruptedTarget)` (background.js:535), called via `transact()`.
- `manifest.json` `optional_permissions` currently: `["power", "nativeMessaging"]` — `"notifications"` is **absent**.
- Real usage log shows `auto-allowed` fires in bursts (4× within 200ms) during Smartsheet search sessions — this is the **critical high-frequency path** that must not be broken.

**What was decided:**
- Insert new `classifyDialogContext()` call at **line 320 of content.js**, wrapping the existing `hasUnansweredApprovalPrompt()` check.
- The new call runs **before** the existing approval signal — if unsafe, it sends a `dialog-exception` message instead, and returns early without sending `APPROVAL_PROMPT_OBSERVED`.
- Do NOT modify `classify()`, `hasUnansweredApprovalPrompt()`, or `handleApprovalPromptObserved()`.
- Use `recordActivityEvent()` (not `appendActivity`) for logging.
- Use `pauseLocked()` (not `enqueueStateTransition` / `pauseTask`) for pausing.
- Priority order among exception kinds: `session-expired` > `oauth-popup` > `unknown-modal`.

---

## 1. Problem Statement

### 1.1 Current Behavior

`scheduleApprovalCheck()` in `content.js` calls `hasUnansweredApprovalPrompt()`. If true, sends `APPROVAL_PROMPT_OBSERVED` to background. Background calls `handleApprovalPromptObserved()` which runs `probe()` → auto-clicks the Allow button via `adapter.js`.

**Gap:** The classifier treats all "allow" buttons equally. It cannot distinguish:

| Scenario | Current behavior | Correct behavior |
|---|---|---|
| ChatGPT tool-use "Allow" (e.g., Smartsheet search) | ✅ Auto-click | ✅ Auto-click |
| "Sign in with Google" OAuth popup inside a dialog | ⚠️ Auto-click ← **BUG** | ⏸ Pause + notify user |
| Session expired page (no composer, login form visible) | ⬜ Not detected | ⏸ Auto-pause |
| Unknown blocking modal (no allow-family buttons) | ⬜ Not detected | 📋 Log + notify, do NOT click |

### 1.2 Failure Modes

1. **OAuth Auto-Click Risk**: Extension silently clicks "Authorize with Google" in an unexpected popup, granting access to an unintended OAuth scope without user awareness.
2. **Session Expiry Silent Loop**: ChatGPT session expires. Extension keeps dispatching prompts, all return `unknown` result, timer keeps running, user is unaware for potentially hours.
3. **Unknown Modal Interference**: A system-level dialog (cookie consent, browser extension update) appears. Extension tries to auto-click it with unpredictable consequences.

### 1.3 Constraints

- Must NOT break existing auto-allow for simple tool-use prompts (Smartsheet, file access, etc.).
- Must NOT introduce synchronous `getComputedStyle` or `getBoundingClientRect` on non-root elements (v3.0.25 performance fix).
- Must work in both `chatgpt.com/*` and `chatgpt.com/dots/*` URL contexts.
- Chrome MV3 (Manifest Version 3): no persistent background pages; all state via `chrome.storage.session`.
- `"notifications"` permission: not in `optional_permissions` → must be added; request lazily via `chrome.permissions.request` only when needed.

### 1.4 Pass/Fail Criteria

| # | Criterion | Measurement |
|---|---|---|
| P1 | Simple tool-use "Allow" still auto-clicked | Existing `auto-allowed` events appear in activity log |
| P2 | OAuth dialog → pause + Chrome notification fired | `paused` + `exception-detected` with `kind: 'oauth-popup'` in log |
| P3 | Session-expired page → auto-pause within 3s | `paused` + `exception-detected` with `kind: 'session-expired'` in log |
| P4 | Unknown modal → log entry, no auto-click, no pause | `exception-detected` with `kind: 'unknown-modal'` in log; no `auto-allowed` |
| P5 | No `getComputedStyle`/`getBoundingClientRect` on non-root elements | Code review confirms |
| P6 | No regression in delivery timing | `timings.domWriteMs` ≤ 10ms average across 10 deliveries |

---

## 2. Technical Plan

### 2.1 Architecture Overview

```
content.js — scheduleApprovalCheck() [line 305–335]
  │
  ├── runIdle(() => {
  │     [NEW] const ctx = classifyDialogContext();     // ← new call added here
  │     if (!ctx.safe) {
  │       chrome.runtime.sendMessage({ type: 'DIALOG_EXCEPTION', ...ctx });
  │       return;                                       // ← early return, skip APPROVAL_PROMPT_OBSERVED
  │     }
  │     [EXISTING] if (hasUnansweredApprovalPrompt()) {
  │       chrome.runtime.sendMessage({ type: 'APPROVAL_PROMPT_OBSERVED' });
  │     }
  │   });
  │
  └── [NEW] dialog-classifier.js (ES module, imported by content.js)
        detectSessionExpired()   → DialogContext | null
        detectOAuthPopup()       → DialogContext | null
        detectUnknownModal()     → DialogContext | null
        classifyDialogContext()  → DialogContext


background.js — dispatch() [line 1958] → new case in switch/if chain
  │
  ├── [EXISTING] 'APPROVAL_PROMPT_OBSERVED' → handleApprovalPromptObserved() [line 1924]
  │     (unchanged)
  │
  └── [NEW] 'DIALOG_EXCEPTION' → handleDialogException(kind, evidence, confidence, sender)
        ├── recordActivityEvent('exception-detected', ..., { kind, evidence, confidence })
        ├── if kind ∈ {session-expired, oauth-popup}:
        │     transact(async () => { await pauseLocked(job, message, 'paused', {kind}); })
        └── maybeFireNotification(kind)
```

### 2.2 New File: `dialog-classifier.js`

```js
/**
 * @typedef {Object} DialogContext
 * @property {boolean} safe
 *   true → proceed with existing approval path; false → halt and emit DIALOG_EXCEPTION
 * @property {'none'|'session-expired'|'oauth-popup'|'unknown-modal'} kind
 * @property {string[]} evidence   Human-readable explanation strings (allowlisted, no user content)
 * @property {number} confidence   0.0–1.0
 */

/** @returns {DialogContext} */
export function classifyDialogContext() { ... }
```

Module-level state: `const firstSeenMap = new WeakMap();` (for unknown-modal 5s tracking).

### 2.3 Detection Logic per ExceptionKind

**Priority order: session-expired first, then oauth-popup, then unknown-modal.**

#### `session-expired` (highest priority)

Trigger: **ANY** of:
1. `document.title` matches `/sign\s+in|session\s+expired|log\s+in|your\s+session/i` (English)
2. `document.title` matches `/登录|会话已过期|重新登录/`
3. `window.location.pathname` matches `/^\/auth\/|\/login|\/signin/`
4. `document.querySelector('[data-testid="login-button"], form[action*="login"]')` exists **AND** `document.getElementById('prompt-textarea')` is null

Confidence: 0.9 if 2+ conditions; 0.6 if 1 condition.
**Fail-low rule**: if only 1 condition matches (confidence 0.6), downgrade to `unknown-modal` level instead — do NOT pause.

Action: `{ safe: false, kind: 'session-expired' }` → pause + notify.

#### `oauth-popup` (second priority)

Trigger: **ANY** of:
1. A `[role="dialog"]` or `[aria-modal="true"]` exists, is visible, and its `textContent` matches `/sign\s*in\s+with\s+(google|microsoft|apple|github|facebook)/i`
2. Inside any such dialog, a visible `<a>` element whose `href` contains `accounts.google.com`, `login.microsoftonline.com`, `github.com/login/oauth`, or `appleid.apple.com`
3. `window.location.hostname` is one of the above OAuth domains (tab navigated away from chatgpt.com)

**Mixed-dialog override**: If the same dialog matches BOTH oauth-popup AND contains allow-family buttons, oauth-popup takes precedence. The existing `hasUnansweredApprovalPrompt()` is NOT called; instead, the exception is emitted.

Confidence: 0.95 for condition 3; 0.8 for conditions 1–2.
Action: `{ safe: false, kind: 'oauth-popup' }` → pause + notify.

#### `unknown-modal` (lowest priority, fallback)

Trigger: **ALL** of:
1. `document.querySelector('[role="dialog"], [role="alertdialog"]')` exists
2. The dialog root's `getComputedStyle(dialogEl).display !== 'none'` (single call on root only)
3. The dialog contains NO button whose text `classify()` would score as allow-family (use a local `classifyButtonText(text)` helper mirroring the same list from content.js, **without** importing `hasUnansweredApprovalPrompt()`)
4. The dialog has been present for > 5000ms per `firstSeenMap` timestamps
5. `hasUnansweredApprovalPrompt()` returned false (this check runs only as a fallback because conditions 1–4 already screened for it)

Action: `{ safe: false, kind: 'unknown-modal' }` → log + notify only, task continues.

### 2.4 Changes to `content.js`

**Exact insertion point:** Inside `scheduleApprovalCheck()`, inside `runIdle(()=>{...})`, wrapping lines 320–332.

**Before (lines 318–334 of content.js v3.0.25):**
```js
runIdle(() => {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
  if (hasUnansweredApprovalPrompt()) {
    lastApprovalNotifyAt = Date.now();
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
});
```

**After:**
```js
runIdle(() => {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
  // [NEW v3.1.0] classify dialog context BEFORE the approval check
  const ctx = classifyDialogContext();
  if (!ctx.safe) {
    Promise.resolve(chrome.runtime.sendMessage({
      type: 'DIALOG_EXCEPTION', kind: ctx.kind, evidence: ctx.evidence, confidence: ctx.confidence,
    })).catch(() => {});
    return; // do NOT send APPROVAL_PROMPT_OBSERVED
  }
  // [EXISTING — unchanged]
  if (hasUnansweredApprovalPrompt()) {
    lastApprovalNotifyAt = Date.now();
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
});
```

**Add import at top of content.js:**
```js
import { classifyDialogContext } from './dialog-classifier.js';
```

> ⚠️ Note: `content.js` is an IIFE (`(() => { ... })()`), not an ES module. The `import` statement cannot be used directly. Instead, `dialog-classifier.js` must be added as a **separate content script** in `manifest.json`, loaded before `content.js`, and exposed via `globalThis.__agentContinueClassifyDialog = classifyDialogContext`. See §2.6 for manifest changes.

**Revised integration (no ES module import):**
```js
// In content.js, replace import with:
const classifyDialogContext = globalThis.__agentContinueClassifyDialog ?? (() => ({ safe: true, kind: 'none', evidence: [], confidence: 1.0 }));
```

**Estimated delta:** +6 lines in `runIdle` block.

### 2.5 Changes to `background.js`

**Exact location:** In `dispatch()` function (line 1958), in the existing message-type routing chain (the large if/else-if chain starting at line ~1963), add before the final `default:`:

```js
if (message?.type === 'DIALOG_EXCEPTION') {
  return handleDialogException(message, sender);
}
```

**New async function `handleDialogException(message, sender)`** (add near `handleApprovalPromptObserved` at line ~1924):

```js
async function handleDialogException(message, sender) {
  if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id)) return { ok: false };
  const { kind, evidence, confidence } = message;
  const safeEvidence = Array.isArray(evidence)
    ? evidence.filter(e => typeof e === 'string').slice(0, 8).map(e => e.slice(0, 120))
    : [];
  await recordActivityEvent('exception-detected',
    kind === 'session-expired' ? t('检测到会话过期，任务已暂停。') :
    kind === 'oauth-popup'     ? t('检测到登录授权弹窗，任务已暂停。') :
                                 t('检测到未知对话框，自动点击已停止。'),
    { code: 'exception-detected', kind, evidence: safeEvidence, confidence });

  if (kind === 'session-expired' || kind === 'oauth-popup') {
    await transact(async () => {
      const job = await getJob();
      if (!job?.enabled) return;
      await pauseLocked(job,
        kind === 'session-expired' ? t('检测到会话过期，请重新登录后再继续。') : t('检测到登录授权弹窗，请手动完成后再继续。'),
        'paused', { code: `exception-detected-${kind}` });
    });
  }
  void maybeFireNotification(kind);
  return { ok: true };
}
```

**New async function `maybeFireNotification(kind)`:**

```js
async function maybeFireNotification(kind) {
  try {
    if (!(await chrome.permissions.contains({ permissions: ['notifications'] }))) return;
    const MSGS = {
      'session-expired': ['Agent Continue — Action needed',
        'Session expired. Please sign in again, then resume the task.'],
      'oauth-popup':     ['Agent Continue — Paused',
        'A sign-in dialog was detected. Please complete it manually, then resume.'],
      'unknown-modal':   ['Agent Continue — Notice',
        'An unrecognized dialog is blocking auto-allow. The scheduler continues but cannot click it.'],
    };
    const [title, message] = MSGS[kind] ?? ['Agent Continue', `Exception: ${kind}`];
    chrome.notifications.create(
      `agent-continue-ex-${Date.now()}`,
      { type: 'basic', iconUrl: 'icons/icon-48.png', title, message }
    );
  } catch { /* notifications not supported or not granted — silently ignore */ }
}
```

**Estimated delta:** +5 lines (dispatch routing) + 30 lines (handleDialogException) + 15 lines (maybeFireNotification) = **+50 lines**.

### 2.6 Changes to `manifest.json`

**Two changes:**

1. Add `"notifications"` to `optional_permissions`:
```json
"optional_permissions": ["power", "nativeMessaging", "notifications"]
```

2. Add `dialog-classifier.js` as a content script loaded **before** `content.js`:
```json
"content_scripts": [
  {
    "matches": ["https://chatgpt.com/*"],
    "js": ["dialog-classifier.js", "content.js"],
    "run_at": "document_idle"
  }
]
```
> `dialog-classifier.js` must set `globalThis.__agentContinueClassifyDialog = classifyDialogContext` at module bottom for `content.js` to pick it up.

### 2.7 Activity Log Schema Extension (v5-compatible)

New event type (no breaking changes to existing schema):
```json
{
  "elapsedMs": 123456,
  "event": "exception-detected",
  "diagnostic": {
    "code": "exception-detected",
    "kind": "session-expired",
    "confidence": 0.9,
    "evidence": ["document.title contains 'Sign in'", "#prompt-textarea absent"]
  }
}
```

Evidence strings are allowlisted text (never user message content); max 8 strings, max 120 chars each.

---

## 3. Alternatives Considered

| Alternative | Verdict |
|---|---|
| Blocklist-based URL matching only | Rejected — misses in-page OAuth widgets and session-expiry |
| Extend existing `classify()` with "danger" kind | Rejected — `classify()` only sees button text, not URL/page-title context |
| MutationObserver on ChatGPT data-testid attributes | Rejected as primary — too brittle against UI updates |
| Always pause on ANY dialog | Rejected — tool-use prompts appear constantly; would break core functionality |
| Make content.js an ES module | Rejected — requires restructuring the existing IIFE; too large a change for v3.1.0 |

---

## 4. Detailed Implementation Plan

### 4.1 New File: `dialog-classifier.js`

| Attribute | Value |
|---|---|
| Location | `dialog-classifier.js` (repo root) |
| Form | Regular script (NOT ES module) — sets `globalThis.__agentContinueClassifyDialog` |
| Imports | None |
| Estimated size | 130–160 lines |
| Module-level state | `const firstSeenMap = new WeakMap();` at top of IIFE |

Internal function order:
1. `function classifyButtonText(text)` — local allow-family classifier (mirrors content.js `classify()` wordlist)
2. `function detectSessionExpired()` → `DialogContext | null`
3. `function detectOAuthPopup()` → `DialogContext | null`
4. `function detectUnknownModal()` → `DialogContext | null`
5. `function classifyDialogContext()` → calls 2→3→4, returns first non-null, or `{ safe: true, kind: 'none', evidence: [], confidence: 1.0 }`
6. All wrapped in try/catch; on exception → return `{ safe: true, kind: 'none', evidence: ['classifier-error'], confidence: 0 }` (fail-open)
7. Final line: `globalThis.__agentContinueClassifyDialog = classifyDialogContext;`

### 4.2 Modified: `content.js`

| Change | Location | Lines |
|---|---|---|
| Const alias for classifier | Line ~5 (top of IIFE) | +1 |
| Call `classifyDialogContext()` + early return if unsafe | Lines 318–334 (inside `runIdle`) | +6 |
| **Total delta** | | **+7 lines** |

### 4.3 Modified: `background.js`

| Change | Location | Lines |
|---|---|---|
| `'DIALOG_EXCEPTION'` routing in `dispatch()` | Line ~1963 area | +3 |
| `handleDialogException()` function | Near line 1924 | +30 |
| `maybeFireNotification()` function | Same vicinity | +15 |
| **Total delta** | | **+48 lines** |

### 4.4 Modified: `manifest.json`

| Change | Specification |
|---|---|
| Add `"notifications"` to `optional_permissions` | 1 token |
| Add `"dialog-classifier.js"` as first content script | 1 line before `"content.js"` |

### 4.5 Runnable Acceptance Cases (Revised)

```
TC-01  Normal chat, no dialog
       Fixture: chatgpt.com page, body has #prompt-textarea, no [role="dialog"]
       When:   classifyDialogContext() called
       Then:   returns { safe: true, kind: 'none' }
       Perf:   completes in < 2ms (measured with performance.now())

TC-02  Simple ChatGPT tool-use Allow dialog
       Fixture: DOM contains [role="dialog"] with:
                - parent has data-message-author-role="assistant"
                - inner button text: "Allow"
                - no href containing accounts.google.com or similar
                - window.location.hostname = "chatgpt.com"
       When:   full approval path runs (scheduleApprovalCheck called)
       Then:   classifyDialogContext() → { safe: true }
               AND APPROVAL_PROMPT_OBSERVED is sent (not DIALOG_EXCEPTION)
               AND existing auto-allowed appears in activity log

TC-03  Session expired page
       Fixture: document.title = "Sign in to ChatGPT — ChatGPT"
                document.getElementById('prompt-textarea') = null
                document.querySelector('form[action*="login"]') = <form>
       When:   classifyDialogContext() called
       Then:   { safe: false, kind: 'session-expired', confidence >= 0.9 }
               AND recordActivityEvent called with event='exception-detected', kind='session-expired'
               AND pauseLocked called (task transitions to paused) within 3s

TC-04  OAuth dialog — "Sign in with Google"
       Fixture: DOM contains [role="dialog"][aria-modal="true"]
                dialog.textContent includes "Sign in with Google"
                window.location.hostname = "chatgpt.com"
       When:   classifyDialogContext() called
       Then:   { safe: false, kind: 'oauth-popup', confidence >= 0.8 }
               AND DIALOG_EXCEPTION sent (not APPROVAL_PROMPT_OBSERVED)
               AND pauseLocked called

TC-04b Mixed dialog: "Sign in with Google" AND "Allow" button in same dialog
       Fixture: same as TC-04 but dialog also has button text "Allow"
       When:   classifyDialogContext() called
       Then:   { safe: false, kind: 'oauth-popup' }  ← oauth takes priority
               AND auto-allow does NOT fire

TC-05  Unknown modal (cookie consent)
       Fixture: [role="dialog"] present, visible (display != 'none')
                dialog.textContent = "We use cookies. Accept?"
                No allow-family button text matches
                firstSeenMap records > 5000ms ago
       When:   classifyDialogContext() called
       Then:   { safe: false, kind: 'unknown-modal' }
               AND recordActivityEvent called with event='exception-detected', kind='unknown-modal'
               AND pauseLocked NOT called (task continues)
               AND APPROVAL_PROMPT_OBSERVED NOT sent

TC-06  Chrome notification fires when permission granted
       Fixture: chrome.permissions.contains mock returns true for 'notifications'
                kind = 'session-expired'
       When:   maybeFireNotification('session-expired') runs
       Then:   chrome.notifications.create called with
               title = 'Agent Continue — Action needed'
               message = 'Session expired. Please sign in again, then resume the task.'

TC-07  Chrome notification silently skipped when permission not granted
       Fixture: chrome.permissions.contains mock returns false for 'notifications'
       When:   maybeFireNotification('session-expired') runs
       Then:   no error thrown, chrome.notifications.create NOT called

TC-08  No performance regression
       Fixture: Static HTML page containing 50 assistant message articles,
                each with ~200 words of text. No dialog elements present.
                (This is a constructable in-memory DOM fixture — no "Dot conversation" needed.)
       When:   classifyDialogContext() called 100 times in rapid succession
       Then:   mean call duration < 2ms per call (p99 < 5ms)
               AND no getComputedStyle called (verify with performance observer or spy)
```

### 4.6 Stop Conditions

- `classifyDialogContext()` exception → catch all → return `{ safe: true, kind: 'none', evidence: ['classifier-error'] }` (fail-open)
- `chrome.notifications.create` throws → catch silently
- `pauseLocked()` throws inside `transact()` → `transact()` handles rollback; log via `recordActivityEvent('exception-detected', ...)` before the pause attempt

### 4.7 Permitted Implementation Freedoms

**MAY:**
- Choose exact regex patterns for each detection as long as the named TC passes
- Use `requestIdleCallback` for `unknown-modal` 5-second clock advancement
- Add `performance.mark` calls for TC-08 timing verification

**MUST NOT:**
- Add synchronous `getComputedStyle` calls on non-dialog-root elements
- Add `getBoundingClientRect` anywhere in new code
- Modify `classify()`, `hasUnansweredApprovalPrompt()`, or `handleApprovalPromptObserved()`
- Change existing activity log entry shapes
- Request `notifications` permission automatically — only use it if already granted (TC-07)
- Access user message content in `evidence` strings

---

## 5. Files to Create / Modify

| File | Action | Description |
|---|---|---|
| `dialog-classifier.js` | CREATE | ~145 lines, sets `globalThis.__agentContinueClassifyDialog` |
| `content.js` | MODIFY | +7 lines (alias + early-return block in `runIdle`) |
| `background.js` | MODIFY | +48 lines (dispatch case + 2 new functions) |
| `manifest.json` | MODIFY | Add `"notifications"` + add `"dialog-classifier.js"` as content script |
| `CHANGELOG.md` | MODIFY | Add v3.1.0 entry |
| `tests/dialog-classifier-tests.mjs` | CREATE | TC-01 through TC-08 (8 test cases) |

---

## 6. Out of Scope for v3.1.0

- Automatic re-login (the extension will never fill login forms)
- CAPTCHA detection or solving (explicitly prohibited)
- Multi-tab exception detection
- Persistent notification history
- Making `content.js` an ES module

---

*Design revision 2 — ready for implementation pending final main-agent review.*
