# Design: Stability, Pause-Awareness, and Anti-Thrashing Engine — Agent Continue v3.2.0

**Status:** PROPOSED — Elephant-Goldfish Design Phase  
**Date:** 2026-11-20  
**Author:** Zhentong Ye  
**Baseline:** v3.1.0 source, commit d4a75e5  

---

## Concepts Brief

**What is known:**
1. **The 73:48 Hang & Extreme Page Stutter Bug:**
   - In user testing on Dot (`chatgpt.com/dots/...`), the user encountered an orange paused state (`⏸ Paused`).
   - The Agent Continue popup displayed `BACKGROUND Checking / sending 73:48`, "Still waiting for the target page or submission result. No fixed wait limit; you can pause at any time".
   - The user reported: "整个dot对话页面变得【极其卡顿】：不论是鼠标滑动，上下滚轮滚动，整个dot页面都做不到即时反馈、有很大的延迟！看起来就像卡死了一样！但我电脑的内存依旧有余量哦？"
   - Analysis of the user's exported diagnostics log (`media_1795206007598_57fbe754.json` / activity log 16) revealed:
     - `sequence: 253`: `state: "running"`, `stage: "page"`, `reason: "composer-unavailable"`.
     - `counters.pageAdmissions`: **4,394 consecutive injections** over 4,576,332 ms (~76.2 minutes).
     - Every ~1,000 ms, `background.js` injected and evaluated `pageAction` via `chrome.scripting.executeScript`.
     - In `adapter.js:361`, `findComposer()` returned `null` because Dot's composer was hidden/unmounted while Dot was paused.
     - `adapter.js` returned `{ status: 'blocked', retryable: true, message: '未识别到唯一输入框。页面可能尚未加载、已退出登录，或界面结构已变化。' }`.
     - In `background.js:1678`, the `for (;;)` loop in `runRound` checked `if (snapshot.runKind !== 'send' || result?.retryable !== true || !await runStillCurrent(snapshot)) break;`.
     - Because `result.retryable === true`, the loop NEVER broke! It waited 1,000 ms (`await new Promise(resolve => setTimeout(resolve, 1000));`) and re-injected `executeScript` indefinitely.
     - Injecting `executeScript` every 1,000 ms into Chrome's renderer process continuously choked the renderer thread, starved UI event processing (wheel, pointer, layout), and created extreme page lag.

2. **Dot Paused State (`⏸ Paused`):**
   - In Dot (and ChatGPT agent mode), long-running tasks or tool executions can enter a paused state, rendered as `⏸ Paused` (or a pill/button with `Paused` / `Resume` / `继续` / `暂停`).
   - `adapter.js` only checked `busy()` at line 828, which is **after** `findComposer()` at line 360.
   - `busySelector` only matched `.typing-indicator` and stop buttons (`button[data-testid="stop-button"]`, `button[aria-label*="Stop"]`). It did NOT match pause/resume indicators.

3. **Sequential / Cyclic Queue (Requirement 1):**
   - `config.js` and `background.js` already implement `mode: 'queue-loop'`. When configured with $N$ prompts and interval $T$, it cycles sequentially through prompt 1, 2, ..., $N$, and loops back.
   - Must be verified to ensure seamless, jitter-free execution without state drift.

4. **Exception Handling & Auto-Allow (Requirement 2):**
   - In v3.1.0, `dialog-classifier.js` was introduced to distinguish session expiration and OAuth logins from routine allow dialogs.
   - This must be extended to recognize affirmative consent/confirmation buttons ("Authorize", "Consent", "Confirm", "I agree", "授权", "同意", "确认", "继续") and handle multi-modal anomalies.

5. **Windows Direct Tunnel & SSH Architecture (Requirement 4):**
   - Direct connection following OpenAI's `tunnel-client` and `DesktopCommanderMCP` patterns.
   - User-informed consent before any command is generated.
   - One-click PowerShell command bundling portable Node.js with automated administrator elevation retry if local permissions fail.
   - Windows-to-Linux SSH forwarding for academic server management.

---

## 1. Problem Statement

### 1.1 Unbounded 1-Second Script Injection Loop
When `adapter.js` fails to find an editor, it returns:
```javascript
result('blocked', '未识别到唯一输入框。页面可能尚未加载、已退出登录，或界面结构已变化。');
```
Because `args.persistentDelivery === true`, line 279 attaches `{ retryable: true }`.
In `background.js:1678`:
```javascript
for (;;) {
  result = await executePage(...);
  if (snapshot.runKind !== 'send' || result?.retryable !== true || !await runStillCurrent(snapshot)) break;
  ...
  await new Promise(resolve => setTimeout(resolve, 1000));
  const renewed = await transact(...);
}
```
If `result.status === 'blocked'` due to missing composer, `for (;;)` loops every 1,000 ms forever. This turns a transient check into an infinite 1Hz CPU and IPC thrashing loop.

### 1.2 Premature Composer Failure on Busy / Paused Pages
In `adapter.js`:
- Line 360 calls `findComposer()`. If composer is absent (because the page is generating or paused), it immediately returns `status: 'blocked'`.
- Line 828 `if (busy()) return result('busy', 'Agent 仍在运行，稍后再次检查。');` is never reached.
- Furthermore, `busySelector` does not include Dot's `⏸ Paused` state or `Resume` buttons.

---

## 2. Technical Plan

### 2.1 Defense 1: Bounded Retry & Anti-Thrashing in `background.js`
1. **Break on Missing Composer:**
   If `result.status === 'blocked'` and `result.diagnosticCode === 'composer-unavailable'` (or composer was missing), DO NOT tight-loop in `for (;;)`. Immediately `break;`.
   The scheduler will set `job.nextAt = now + RETRY_MS` (60 seconds) and check again via the background alarm. This completely stops the 1Hz injection loop.
2. **Maximum Pre-Submission Retry Bound:**
   Add `let sendAttemptCount = 0; const MAX_PRE_SUBMISSION_RETRIES = 3;` in `runRound`'s `for (;;)` loop.
   If `sendAttemptCount >= MAX_PRE_SUBMISSION_RETRIES`, break the loop and yield back to the scheduler. No execution may monopolize the renderer thread for more than 3 consecutive 1-second attempts.

### 2.2 Defense 2: Prioritize Busy / Paused Agent Detection in `adapter.js`
1. **Expand `busySelector` and Pause Detection:**
   Define `pauseSelector`:
   ```javascript
   const pauseSelector = 'button[aria-label*="Resume" i], button[aria-label*="Pause" i], button[aria-label*="继续" i], button[aria-label*="暂停" i], [data-testid*="resume" i], [data-testid*="pause" i], [data-testid*="paused" i]';
   ```
   Add text/DOM heuristics for Dot's black pill `⏸ Paused` / `Paused`:
   ```javascript
   const isDotPaused = () => {
     if (!isDot) return false;
     const pills = [...document.querySelectorAll('button, div, span')].filter(el => {
       const text = el.textContent?.trim();
       return text === '⏸ Paused' || text === 'Paused' || text === '暂停' || text === '已暂停';
     });
     return pills.some(visible);
   };
   ```
2. **Check Busy / Paused BEFORE declaring composer missing:**
   In `adapter.js`, before line 361 exits on `!initial`:
   Check if `busy()` or `isDotPaused()` is true.
   If true:
   Return `result('busy', 'Agent 仍在运行或处于暂停中，稍后再次检查。', isDotPaused() ? 'agent-paused' : 'agent-busy')`.
   When returning `busy`, the scheduler waits for `RETRY_MS` (60s) or reply completion. It does NOT tight-loop!

### 2.3 Defense 3: Expand Auto-Allow & Affirmative Consent
In `dialog-classifier.js`:
- Add `affirmative-consent` classification: Detects modals containing tool execution confirmation or workflow consent buttons ("Allow", "Authorize", "Confirm", "I agree", "允许", "授权", "确认", "继续") without login/password credentials.
- Auto-click safe affirmative actions while routing credential/login prompts to user notification.

### 2.4 Defense 4: Windows Direct Tunnel & Elevated Retry Architecture
In `setup.html` / `setup.js` / `native/bootstrap/install.ps1`:
- Retain strict informed consent checkbox (`#accept-consent`).
- Provide one-click PowerShell execution using portable Node.js.
- Include automatic error-recovery guidance: if non-administrator execution encounters firewall/service port restrictions, provide an elevated fallback command (`Start-Process powershell -Verb RunAs ...`).

---

## 3. Detailed Implementation Plan & Files

| Component | Target File | Specific Change |
|---|---|---|
| Background Scheduler | `background.js` | In `runRound`, break `for (;;)` loop on `composer-unavailable` and enforce `MAX_PRE_SUBMISSION_RETRIES = 3`. |
| Page Adapter | `adapter.js` | Broaden `pauseSelector` and `isDotPaused()`; evaluate busy/paused state BEFORE returning missing composer `blocked`. |
| Exception Classifier | `dialog-classifier.js` | Add affirmative consent recognition for tool/workflow execution. |
| Test Suite | `tests/pause-detection-tests.mjs` | Unit test cases for pause detection, busy priority over composer, and anti-thrashing retry bounds. |
| Manifest & Versions | `manifest.json`, `package.py` | Version bump to `3.2.0`. |
| Documentation | `CHANGELOG.md`, `README.md`, `README.zh-CN.md` | Document stability engine, pause-awareness, and anti-thrashing fixes. |

---

## 4. Acceptance Criteria & Test Cases

- **TC-PAUSE-01 (Dot Paused Recognition):** When Dot renders `⏸ Paused`, `pageAction` returns `status: 'busy'`, `diagnosticCode: 'agent-paused'`.
- **TC-PAUSE-02 (Anti-Thrashing Bounded Retry):** When `findComposer()` fails, `for (;;)` loop in `background.js` does NOT execute more than 1 injection, breaking immediately and scheduling `RETRY_MS`.
- **TC-PAUSE-03 (Cyclic Prompt Queue):** Configured with 3 prompts at 20-min intervals, verify that prompt 1, 2, 3 cycle indefinitely without drift.
- **TC-PAUSE-04 (Safe Auto-Allow vs Exception):** Routine tool confirmation is auto-allowed; session expiry / OAuth login triggers pause and notification.
