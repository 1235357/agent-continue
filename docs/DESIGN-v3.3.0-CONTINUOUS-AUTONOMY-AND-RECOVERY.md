# Design: Continuous Autonomy, Real-Time Recovery, and Windows-SSH Workflow — Agent Continue v3.3.0

**Status:** REVISED (reconciled after Comprehension, Implementation Readiness, and Criticism three-reviewer pass)  
**Date:** 2026-11-26  
**Author:** Zhentong Ye  
**Baseline:** `v3.2.1` (`f0dfc7f` + 2026-11-23 working tree checkpoint in `d:\Desktop\Northwestern University MSCS\[Develop]\agent-continue-repo`)

---

## Concepts Brief

**Observed Evidence (Logs, Code, Host Diagnostics):**
1. **Production failure trace (`extensionVersion: "3.2.1"`, screenshot + exported JSON activity logs):**
   - `logs`: Repeated `"event": "browser-restored"` every `~34,000 ms` across all 200 log entries (`elapsedMs: 6581539, 6615539, 6649539 ... 12355541` and `37962542 ... 38628208`).
   - `deliveries` sequences `#812`–`#829`: `"state": "blocked", "stage": "page", "reason": "approval-required", "hidden": true, "composerPresent": true, "busy": true`. Commit `8344a5e` replaced auto-clicking with passive `approvalWait()`, stalling unattended MCP tool runs for 34+ minutes.
   - `deliveries` sequences `#830` & `#831`: `"state": "unknown", "stage": "dispatch", "method": "button", "reason": "unknown"`, `domWrites: 2, textChunks: 2, fillCalls: 1, readinessChecks: 2, authorizationChecks: 14, dispatchAttempts: 1, receiptChecks: 1, documentChanges: 1`, `maxDomWriteMs: 165.8 / 136.7`, `history: [0ms page/starting, 24-30ms prepare/starting, 27-35ms prepare/unsupported-view, 34-44ms dispatch/unsupported-view, 654-656ms receipt/unknown, 654-656ms dispatch/unknown]`.
   - Visual screenshot (`chatgpt.com/dots/0319a868-4fdb-47fe-9ab9-e775413db4bb~6acb307ff27c81979526020ddbc47fa3`): the orange user bubble and Dot's assistant response WERE actually submitted, while Agent Continue transitioned to `Paused` (`unconfirmed`).
2. **Existing Safety, Packaging & Test Invariants Preserved Verbatim:**
   - `tests/release-safety-source-tests.mjs:10-16`:
     - `editor-commit.js` MUST remain self-contained (zero `chrome.runtime`, `runId`, `__reactProps$`, or `fetch(`).
     - `adapter.js` MUST NOT contain `__reactProps$`, `__reactEventHandlers$`, `someProp('handleKeyDown'`, or `await wait(100)`, MUST keep `await wait(60)` strictly after any snapshot marker, and MUST keep verbatim inside `samePage()`:
       `if (!currentId || currentId !== args.targetIdentity) { if (pageMatched) metrics.counters.documentChanges++; pageMatched = false; return false; }`
     - `background.js` MUST NOT invoke `runScript('MAIN')` or broadly filter `/dots/` tabs without exact URL normalization.
   - `tests/sending-restart-fence-tests.mjs:13-132` & `tests/legacy-unknown-storage-restart-tests.mjs:28-130`:
     - Restarts after `chrome.scripting.executeScript` has been reached (`preDispatch !== true`, `phase === 'sending'`, `runKind === 'send'`) MUST still pause (`enabled: false`) and enforce `submissionFenceUntil >= deadline`.
     - Restarts during `runKind === 'reply-check'` MUST retain `enabled: true`, `awaitingReply: true`, and no fence.
     - Cold `initialize()` (`background.js:1888-1978`) MUST leave `job.tabId === null` when restored from `local.resumeJob` (`tests/background-v2-tests.mjs:2096` and `tests/mv3-integration-tests.mjs:537-547`).
   - `tests/approval-boundary-tests.mjs`:
     - Default `pageAction(args)` calls without `autoAllow: true` MUST leave `#opt-allow`/`#always` unclicked and return `diagnosticCode: 'approval-required'`.
     - Legacy IPC `AUTO_ALLOW_CLICK` and `APPROVAL_PROMPT_OBSERVED` MUST remain rejected (`{ ok: false }`) and trigger zero script injections (`L239-247`).
   - `tests/i18n-tests.mjs`, `tests/support-tests.mjs:365-385`, `tests/public-documentation-tests.mjs:137-157`, `tests/setup-ui-tests.mjs:1833-1860`, and `native/bootstrap/packed.test.mjs:18-24, 222-223, 274-285`.
3. **Windows Host, Local Install, and EasyConnect State (Verified on Local Machine):**
   - Chrome `Default` profile loads unpacked extension `kpjgmkakklpdhjmbfahlkffgkcphebkc` directly from `d:\Desktop\Northwestern University MSCS\[Develop]\agent-continue-repo`.
   - `EasyConnect.exe`, `SangforCSClient.exe`, and `ECAgent.exe` are running; `https://easyconnect.wku.edu.cn:443` is TCP-reachable; WinINET `ProxyEnable` is `0`; `Sangfor SSL VNIC` (`Ethernet 6`) is **Disconnected** after `LOGOUT_TIMEOUT` in `EasyConnect.exe.log` (returned to `"欢迎访问"` sign-in UI), causing SSH TCP `:22` timeouts to WKU hosts.
   - No `computer-use` MCP server is registered and `run_command` executes outside the interactive `WinSta0` desktop (`CopyFromScreen` / `EnumWindows` cannot inspect or drive desktop windows).

---

## 1. Problem Statement

### 1.1 Immediate `unknown` Pause (`documentChanges: 1`) After Successful Dot Send (`#830`, `#831`)
In the 2026-11-23 working tree, `adapter.js:200-212` inspects rows backward and returns on the very first element producing a truthy `messageKey` (`adapter.js:189`, which falls back to `data-testid` / `id`), and `editor-commit.js:42-50` inspects only `[...document.querySelectorAll(...)].at(-1)` (without an `isDot` guard, loop, or `modernMessageKey`). When live Dot clicks Send, React optimistically mounts a new turn element at the end of `rows` carrying a temporary client ID or `data-testid="conversation-turn-..."` without `'~'` before server persistence hydrates `data-message-id="acct~dot~Msg~..."`. Both `identity()` implementations immediately adopt that transient unstructured key, breaking `samePage()` at `receiptChecks === 1` (`documentChanges: 1`) -> `confirmSubmission()` returns `unknown` -> `finishRoundLocked()` hard-pauses the scheduler (`enabled: false`).

### 1.2 34-Second `browser-restored` Log Flood, Deadlock/Test Constraints & Pre-Dispatch Recovery (`background.js`)
In `background.js:1888-1978` (`initialize()`):
- Line `1934` checks `if (job && !job.tabId && recovery && !recoverPause)` on **every** SW wake (roughly every 34s) whenever `job.tabId === null`, even when `job` already came from `chrome.storage.session` (`sessionJob` already existed). Each wake resets `job.nextAt` and appends `'browser-restored'` (`L1939`), exhausting the 200-entry log buffer.
- `chrome.tabs.onUpdated` (`L2236`) returns immediately if `!changeInfo.url`, and `L2239` returns if `job.tabId !== tabId`. Thus when Chrome restores tabs after reopening (`status: 'complete'` after `initialize()`), `job.tabId` remains `null` until the 1-minute alarm fires.
- If a crash kills the SW inside `runRound()` (`L1764`) **before** `executePage()` has ever invoked `chrome.scripting.executeScript` (zero dispatch possibility), `L1941-1955` unconditionally pauses the job (`enabled: false`) and applies `submissionFenceUntil`.

### 1.3 Stalled Unattended Loops & OAuth Guard Gaps (`#812`–`#829`)
Commit `8344a5e` stripped all auto-allow capability, causing tool permission prompts (`#812–#829`) to stall indefinitely even when the user wants unattended Dot execution. Conversely, naive re-enablement of old `classifyOptionText` would auto-click `'authorize'`, `'sign in'`, `'log in'`, `'connect account'`, or inline assistant OAuth cards (`dialog-classifier.js:104-145` only scanned `[role="dialog"]` for 5 named providers). We must expose an explicit opt-in `autoAllow: false` setting while blocking OAuth/login/unknown-modal interactions cleanly across `adapter.js`, `content.js`, `background.js`, `activity-export.js`, `delivery-diagnostics.js`, `i18n-*.js`, `PRIVACY.md`, and `docs/STORE-LISTING.en.md`.

### 1.4 Windows Direct Tunnel, `DesktopCommanderMCP`, SSH & EasyConnect Preflight
Users on Windows need an integrated, portable, read-only `ssh-preflight` check across `~/.ssh/config`, OpenSSH (`ssh.exe`), and EasyConnect/Sangfor VNIC status, wired properly through all `native/bootstrap` packaging manifests (`package.json`, `native/bootstrap/package.json`, `payload-layout.mjs`, `packed.test.mjs`), `bin.mjs`, and `cli.mjs`, plus UAC-compliant Administrator retry documentation (`-Administrator -Apply -Consent accept-administrator-browser-installation -PromptForConnection -ExtensionId '<extensionId>'`).

---

## 2. Technical Plan

### 2.1 Fix A — Stop `browser-restored` Flood, Auto-Rebind on Tab Restore/Startup, & Recover Pre-Dispatch Crashes (`background.js`)
1. **True Session-Loss Restoration Only (`initialize()`, `background.js:1888-1978`):**
   - Capture `const hadSessionJob = Boolean(await getJob());` BEFORE consulting `recovery` (`resumeJob`).
   - Compute `const restoredFromLocal = !hadSessionJob && Boolean(recovery);` (if an earlier retry failed during `setJob` after writing `session.job`, also treat `job?.restoredPending === true` as needing completion).
   - Remove the premature `L1934-1940` block before `L1941`. Place restoration logging **after** `phase === 'sending'` recovery (`L1941-1955`), `activationRun` (`L1956-1964`), `recoverPause` (`L1965-1968`), `setJob(job)`, AND `syncAlarm(job)` (`L1971`).
   - Only when `job && !job.tabId && !recoverPause && (restoredFromLocal || job.restoredPending === true)`:
     - Update `nextAt = Math.max(job.nextAt || 0, Date.now() + 3000)` cleanly BEFORE `setJob` if `job.enabled` and `(!job.nextAt || job.nextAt <= Date.now())`, set `statusText = t('已从重启中恢复；正在连接目标页面并继续推进…')` if `job.enabled`, clear `restoredPending` via `delete job.restoredPending`, persist `setJob` + `syncAlarm`, and **only then** call `await recordActivityEvent('browser-restored', t('已恢复任务设置；等待唯一匹配的原目标页面。'))`.
   - **Never** modify `job.tabId` inside `initialize()` — cold `initialize()` (`GET_STATE`) MUST keep `job.tabId === null` to preserve `tests/background-v2-tests.mjs:2096` and `tests/mv3-integration-tests.mjs:537-547`.
2. **Pre-Dispatch Crash Recovery (`preDispatch`) Without Weakening Post-Injection Restart Fences:**
   - In `runRound()` (`L1764`), set `preDispatch: runKind === 'send'`.
   - In `runRound()` retry renewal (`L1828`), reset `preDispatch: !delivery.mainCommitAdmitted`.
   - Define `async function clearPreDispatch(runId)` using `transact()`: verify `current?.enabled && current.phase === 'sending' && current.runId === runId && current.runKind === 'send'`. If `current.preDispatch !== true`, return `true`. Otherwise persist `await setJob({ ...current, preDispatch: false })` and return `true`; if cancelled/disabled/runId-changed, return `false`.
   - In `executePage()` (`L791-812` & `L862`): ONLY when `args.mode === 'send' && args.runId`, call `const cleared = await clearPreDispatch(args.runId)` right before the first `runScript('ISOLATED')` inside `runner()` (and inside a try/catch BEFORE `runScript` at `L862` if fallback re-injection fires). If `clearPreDispatch` throws a storage error BEFORE `executeScript` runs, return `{ status: 'blocked', retryable: true, diagnosticCode: 'pre-dispatch-storage', message: t('后台状态暂未保存，稍后重试。') }` cleanly instead of falling into `'unknown'` (`execution-exception`)! If `!cleared`, return `{ status: 'cancelled' }`.
   - In `finishRoundLocked()` (`L1621-1635`) and `pauseLocked()` (`L581`), clear `preDispatch: undefined`. Handle `result.status === 'cancelled'` cleanly in `finishRoundLocked` (before `L1715`: return `{ ok: true, job: { ...current, phase: 'idle', runKind: null, runDeadline: null, preDispatch: undefined, nextAt: now + RETRY_MS, statusText: t('本轮检查已取消，保持任务启用。') } }`) so a cancelled pre-dispatch check does not increment `unknownCount` or pause an enabled job.
   - In `initialize()` (`L1941-1955`):
     - If `job?.phase === 'sending' && job.runKind === 'send' && job.preDispatch === true`: recover to `{ ...job, phase: 'idle', runKind: null, preDispatch: undefined, runId: token(), runDeadline: null, nextAt: Date.now() + 3000, statusText: t('发送准备前后台中断，已自动恢复等待检查。'), needsAttention: false }` WITHOUT incrementing `unknownCount`, WITHOUT setting `enabled: false`, and WITHOUT adding `saved.runDeadline` to `submissionFenceUntil` at `L1952` (`saved?.phase === 'sending' && saved.runKind !== 'reply-check' && saved.preDispatch !== true ? saved.runDeadline : null`).
     - If `job?.phase === 'approval-check'`: recover identically to `{ ...job, phase: 'idle', runKind: null, runId: token(), runDeadline: null, nextAt: Math.max(job.nextAt || 0, Date.now() + 3000) }` with `enabled: job.enabled` and zero fence.
     - Otherwise (`preDispatch !== true` post-injection send), retain exact `enabled: false` + `submissionFenceUntil` logic (`tests/sending-restart-fence-tests.mjs`).
3. **Orphaned Tab Auto-Rebind in `chrome.tabs.onUpdated` (`L2235-2253`) & `chrome.runtime.onStartup` (`L2254-2272`):**
   - Extract `async function rebindOrphanedJobIfUnique(version, expectedTabId = null)` that FIRST reads `const candidate = await transact(getJob)` (exiting immediately if `!candidate?.enabled || candidate.phase !== 'idle' || Number.isInteger(candidate.tabId) || version !== intentVersion`), THEN queries `chrome.tabs.query({ url: 'https://chatgpt.com/*' })` **outside** `transact()` (zero deadlock!), filters `validateTarget(t.url) && normalizeUrl(t.url) === candidate.url && (!t.pendingUrl || normalizeUrl(t.pendingUrl) === candidate.url) && !t.discarded && !t.frozen`, verifies `matches.length === 1` (and `expectedTabId === null || matches[0].id === expectedTabId`) and `(matches[0].status === 'complete' || expectedTabId === null && matches[0].status === 'complete')`, THEN enters `transact()` to re-verify `job?.enabled && job.phase === 'idle' && !Number.isInteger(job.tabId) && job.id === candidate.id && version === intentVersion`, runs `protectFromDiscard(tab, job.preventDiscard)`, persists `await setJob(rebound)`, calls `syncAlarm(rebound)`, `updateBadge(rebound)`, `pingDialogObserver(tab.id)`, and returns `{ rebound }`.
   - In `chrome.tabs.onUpdated` (`L2235`):
     Replace `if (!changeInfo.url) return;` with:
     ```js
     if (!changeInfo.url && changeInfo.status !== 'complete') return;
     if (tab?.url && !tab.url.startsWith('https://chatgpt.com/')) return;
     const version = intentVersion;
     ```
     Inside `.then(...)`: first check orphaned rebind via `rebindOrphanedJobIfUnique(version, changeInfo.status === 'complete' ? tabId : -1)` when `changeInfo.status === 'complete'`; if rebound and `rebound.nextAt <= Date.now()` and `version === intentVersion`, schedule `setTimeout(() => { if (version === intentVersion) runRound(false, rebound.id, version).catch(() => undefined); }, 500)`. For existing bound tabs (`job.tabId === tabId` + `changeInfo.url`), preserve the existing navigation-away logic cleanly.
   - In `chrome.runtime.onStartup` (`L2254`): call `await rebindOrphanedJobIfUnique(version)` before the existing 2500 ms `runRound` timer so both complete tabs and loading tabs coordinate without double-runs.

### 2.2 Fix B — Structured `'~'`-Aware `identity()` in `adapter.js` & `editor-commit.js`
1. **Update `adapter.js:200-212` (keeping `L189` and `samePage()` `L231` intact for `tests/release-safety-source-tests.mjs:14`):**
   ```js
   const identity = () => {
     if (!isDot) return null;
     const rows = [...document.querySelectorAll('article.message-row, [data-message-author-role], article[data-testid^="conversation-turn-"]')];
     let fallbackIdentity = null;
     for (let i = rows.length - 1; i >= 0; i--) {
       const row = rows[i];
       const target = row?.querySelector?.('.message-body') || row;
       const explicit = target?.getAttribute?.('data-message-id')
         || target?.closest?.('[data-message-id]')?.getAttribute?.('data-message-id')
         || modernMessageKey(target);
       if (explicit) {
         if (explicit.includes('~')) {
           const parts = explicit.split('~');
           return parts.length >= 3 ? parts.slice(0, 2).join('~') : explicit;
         }
         fallbackIdentity ??= explicit;
         continue;
       }
       const fb = target?.getAttribute?.('data-testid') || target?.id || null;
       if (fb) fallbackIdentity ??= fb;
     }
     return fallbackIdentity;
   };
   ```
   *(Notice: NO `!args.targetIdentity` shortcut — both `START`/`probe()` (`targetIdentity: null`) and `send`/`confirmSubmission` (`targetIdentity: 'acct~dot'`) skip unhydrated non-`'~'` optimistic rows when a structured `'~'` Dot row exists above, immediately block `'acct~other~Msg~new'`, and return `fallbackIdentity` if NO `'~'` rows exist.)*
2. **Update `editor-commit.js:42-50` identically (self-contained, zero free variables, optional-chained for minimal unit mocks in `tests/editor-commit-tests.mjs:156, 394`):**
   Keep `if (!isDot)` optional only for `adapter.js`; in `editor-commit.js:42-50` keep returning `'~'`-split IDs first across `rows` (scanning backward from `rows.length - 1` down to `0`, checking `target?.getAttribute?.('data-message-id') || row?.getAttribute?.('data-message-id') || target?.closest?.('[data-message-id]')?.getAttribute?.('data-message-id') || target?.getAttribute?.('data-chatgpt-search-message-ids')?.trim()?.split?.(/\s+/)?.[0]`, returning immediately if `.includes('~')`, otherwise falling back to `fallbackIdentity` across `explicit` -> `data-testid` -> `id`). Leaves `editor-commit.js:51-58` and all `editor-commit-tests.mjs` (`L369-371, L440-458`) passing.

### 2.3 Fix C — Explicit Opt-In `autoAllow` + OAuth/Session Guard + Zero-Lag Observer
1. **Configuration & UI Wiring (`config.js`, `popup.html`, `popup.js`, `i18n-html.js`, `i18n-popup.js`, `i18n-runtime.js`):**
   - `config.js`: Add `autoAllow: false` to `DEFAULT_CONFIG` and `'autoAllow'` to `readConfig()` boolean keys (`['preventDiscard', 'keepAwake', 'waitForIdle', 'startImmediately', 'extensionPriority', 'autoAllow']`).
   - `popup.html`: Under `持续运行` (`panel-settings`, right after `#waitForIdle`), add `<label class="check-line"><input id="autoAllow" type="checkbox"><span>自动点击常规工具授权（Allow / Always allow）</span></label><p class="helper">默认关闭。开启后将自动点击已绑定会话的常规工具允许按钮，遇到登录过期或第三方 OAuth 授权弹窗时仍自动暂停并提示手动处理。</p>`.
   - `i18n-html.js`: Add exact English translations for both static text nodes above (`"Auto-allow routine tool confirmations (Allow / Always allow)"`, etc.).
   - `popup.js`: Add `'autoAllow'` to `configFields` (`L80-81`), `gatherConfig()` (`L152-167`), `paint(job)` (`L416-417` + `configHint` summary at `L433-439`), `exportableConfig()` (`L680-686`), and `checkedImport()` (`L687-698`), plus `'browser-restored': t('已恢复任务')` in `eventLabels()`. Update `i18n-popup.js` with any missing entries (including `'exception-detected'` string and `'已恢复任务'` / `autoAllow` hint — zero CJK chars in English catalog values).
2. **`adapter.js` (`pageAction(args)`):**
   - Preserve `approvalWait()` 100% unchanged whenever `args.autoAllow !== true`.
   - At `adapter.js:221-224` (`result()`), include `'auto-allowed-prompt'` and `'oauth-required'` in `metrics.reason`, and set `retryable: false` for BOTH:
     `&& !['approval-required', 'auto-allowed-prompt', 'oauth-required'].includes(diagnosticCode)`!
   - At `adapter.js:1847`, preserve specific diagnostic reasons instead of unconditionally overwriting with `resultReason(actionResult.status)`:
     `metrics.reason = ['approval-required', 'auto-allowed-prompt', 'oauth-required', 'agent-paused', 'agent-busy'].includes(actionResult.diagnosticCode) ? actionResult.diagnosticCode : resultReason(actionResult.status);`
   - When `args.autoAllow === true`:
     - Before returning `composer-unavailable` (`L305-312`) or missing `identity()` (`L321`), AND before `approvalWait()`/`checkAndHandleApprovalPrompt()`:
       Run inline self-contained session-expired & OAuth/login check (plus `globalThis.__agentContinueClassifyDialog?.()` if present in extension isolated world): detect OAuth hosts, sign-in dialogs, inline assistant OAuth cards (`sign in to`, `log in`, `connect account`, `authorize app`, `oauth`, `reauthorize`, `授权登录`, `去登录`, `重新登录`, `连接账号`, `关联账号`, `绑定账号`), session expiry forms, OR non-safe classifier outcomes (`oauth-popup`, `session-expired`, `unknown-modal`). If detected, return `result('blocked', '检测到需要手动登录或 OAuth 授权的弹窗，已暂停等待处理。', 'oauth-required')` WITHOUT clicking anything!
     - Refactor `findApprovalPrompt()` (`L462-620`) so `findApprovalPrompt(returnDetails = false)` returns boolean (default `false`, preserving callers) or `{ state, target, groupContainer, cardKey }` when `true`. Scoped roots `[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]` + last 2 assistant turns remain untouched.
     - In `checkAndHandleApprovalPrompt()` (invoked ONLY when `args.autoAllow === true`):
       - Reject if OAuth/session-expired check tripped -> return `oauth-required`.
       - Find best option via `findApprovalPrompt(true)`. Note: ONLY consider candidates whose chosen `target.info.kind` is `'always-allow'`, `'allow-once'`, or high-confidence tool `'allow'` (explicitly excluding any option whose core text matches sign-in / login / OAuth / authorize-account / connect-account patterns — those trigger `'oauth-required'` instead!). Also skip if `[role="dialog"]` / `groupContainer` has `unknown-modal` / ambiguous non-tool confirm.
       - Persist per-card cooldown (`4000 ms`) on BOTH `globalThis.__agentContinueAllowedCards` `WeakMap` (`cardKey` / `groupContainer`) AND `data-agent-continue-allowed` attribute ONLY when `args.autoAllow === true`. If recently clicked (`< 4000 ms`), return `result('busy', '已自动确认常规工具权限，继续等待运行。', 'auto-allowed-prompt')`.
       - Dispatch pure synchronous DOM click sequence (`pointerover`, `mouseover`, `pointerdown`, `mousedown`, `pointerup`, `mouseup`, `el.click()`) on `target.pillEl` (and interactive `target.leafEl` if non-button), with **ZERO `__reactProps$` / `__reactEventHandlers$` references** and **ZERO `await wait(60)` / `await wait(100)` calls** (preserving `release-safety-source-tests.mjs:11,13,15` and zero 60s hidden-tab timer clamp!).
       - Return `result('busy', '已自动确认常规工具权限，继续等待运行。', 'auto-allowed-prompt')`.
3. **Zero-Lag `content.js` Routine Approval Observer:**
   - Implement the 4-tier zero-lag pattern cleanly inside `content.js`:
     - Passive `scroll` and `wheel` capture listeners updating `lastScrollAt`.
     - Scoped check (`[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]` + last 2 assistant turns) with $O(1)$ guards (`childElementCount > 4 || textContent.length > 80`).
     - Idle scheduling (`requestIdleCallback` with `{ timeout: 800 }` + scroll-deferral re-scheduling if scrolled within 450 ms, never dropping pending checks via `scanTimer` collision!).
     - Separate `lastRoutineApprovalAt` cooldown (`>= 2500 ms`) independent of `lastKind` (`DIALOG_EXCEPTION`). Sends `{ type: 'ROUTINE_APPROVAL_OBSERVED' }` ONLY when `classifyDialogContext().safe === true` and an unanswered non-auth tool confirmation pill is detected.
4. **Background Routing, Claim Concurrency Guard & Diagnostics (`background.js`, `activity-export.js`, `delivery-diagnostics.js`, `i18n-runtime.js`):**
   - `background.js:2059`: add `'ROUTINE_APPROVAL_OBSERVED'` to the `sender.tab` allowlist (leaving `'AUTO_ALLOW_CLICK'` and `'APPROVAL_PROMPT_OBSERVED'` rejected).
   - `handleRoutineApprovalObserved(sender)`:
     - Require `sender.id === chrome.runtime.id && sender.frameId === 0 && Number.isInteger(sender.tab?.id) && typeof sender.url === 'string' && typeof sender.tab.url === 'string'`.
     - Inside `transact()`: check `job?.enabled && job.autoAllow === true && job.phase === 'idle' && job.tabId === sender.tab.id && normalizeUrl(sender.url) === job.url && normalizeUrl(sender.tab.url) === job.url`, throttle `now - lastRoutineApprovalProbeAt >= 2000`. Claim `{ ...job, phase: 'approval-check', runKind: 'approval-check', runId: token(), runDeadline: Date.now() + EXECUTION_MS }` via `await setJob(claimed)` and return `{ tabId, url, autoAllow, targetIdentity, ... }`.
     - Outside `transact()` (zero `stateQueue` blocking!): invoke `probe({ id: sender.tab.id, url: claimed.url }, claimed, claimed.targetIdentity)` (`probe` accepts an explicit `allowAutoClick = false` arg so `CHECK_PAGE` keeps `autoAllow: false` while `handleRoutineApprovalObserved` passes `true`!).
     - Finalize inside `transact()` verifying `current?.enabled && current.phase === 'approval-check' && current.runId === claimed.runId && version === intentVersion`: restore `phase: 'idle', runKind: null, runDeadline: null`; if `result.diagnosticCode === 'auto-allowed-prompt'`, record `'auto-allowed'` + update `nextAt = Date.now() + RETRY_MS`, `statusText`; if `result.diagnosticCode === 'oauth-required'`, call `pauseLocked(..., 'paused', { code: 'oauth-required' })`. NEVER invoke `runRound()` or submit prompts from `ROUTINE_APPROVAL_OBSERVED`.
   - `runRound()` (`L1791`, `L1796`, `L1801`, `L1855-1856`):
     - Pass `autoAllow: snapshot.autoAllow === true` to both `executePage` (`mode: 'send'`) and `after-reply` `probe()` (`L1791`, pausing cleanly on `'oauth-required'` too).
     - Break outer retry loop (`L1800-1801`) on `'auto-allowed-prompt'` and `'oauth-required'`.
   - `executePage()` (`L929-941`), `logEvent()` (`L432`), `activity-export.js:10`, `delivery-diagnostics.js:13`: add `'oauth-required'` (`blocked`) and `'auto-allowed-prompt'` (`busy`) to all allowlists.
   - `finishRoundLocked()` (`L1696-1713`):
     - `result.status === 'busy' && result.diagnosticCode === 'auto-allowed-prompt'`: `job.nextAt = now + RETRY_MS; job.needsAttention = false; job.statusText = t('已自动确认常规工具权限，继续等待运行。');` and log `'auto-allowed'` (throttled when `current.lastDiagnosticCode !== 'auto-allowed-prompt'` or per attempt).
     - `result.status === 'blocked' && result.diagnosticCode === 'oauth-required'`: `return { ok: true, job: await pauseLocked(job, t('检测到需要手动登录或 OAuth 授权的弹窗，已暂停等待处理。'), 'paused', { code: 'oauth-required', durationMs: now - snapshot.lastRunAt, ...result.executionDiagnostic }) };`
   - Update `i18n-runtime.js` with every new runtime string, update `manifest.json` (`3.3.0`), `PRIVACY.md` (`L76` opt-in disclosure), `docs/STORE-LISTING.en.md` (`L3` `**3.3.0**`, `L23` accurate opt-in description staying `<= 4000` chars), `README.md` / `README.zh-CN.md` (`L7` `3.3.0`, external GitHub links per `tests/public-documentation-tests.mjs:137-157`), and `CHANGELOG.md`.

### 2.4 Fix D — Portable Windows SSH Preflight (`native/bootstrap/ssh-preflight.mjs`) & UAC-Gated Docs
1. **Preflight Implementation (`native/bootstrap/ssh-preflight.mjs`):**
   - Read-only CLI `node native/bootstrap/bin.mjs ssh-preflight [--json] [--timeout-ms <ms>]` (and `npx agent-continue ssh-preflight`):
     - Locate `ssh.exe` (`C:\Windows\System32\OpenSSH\ssh.exe` or `PATH` lookup).
     - Safely parse `~/.ssh/config` (`lstatSync` symlink + size <= 256 KiB guard): collect non-wildcard (`!host.includes('*') && !host.includes('?')`) hosts, `HostName`, `Port`, `User`, and note `ProxyJump`/`ProxyCommand` (never touching keys or `IdentityFile` files). Report `~/.ssh/known_hosts` existence.
     - On `win32`, inspect EasyConnect/Sangfor processes (`Get-Process`) and Sangfor/EasyConnect network adapters via numeric WMI/`Get-NetAdapter` (`NetConnectionStatus` / `Status` integer `2 === Connected`, never English-only string comparisons!), plus best-effort optional read of recent status keywords (`LOGOUT_TIMEOUT`, `User not login`) in `%LOCALAPPDATA%/Sangfor` / EasyConnect logs when present — with zero hardcoded institutional hostnames or private IPs.
     - Probe direct (non-proxied) SSH hosts with bounded `Promise.race` + `socket.destroy()` under `--timeout-ms` (default 1200 ms), emitting clean JSON or human-readable output + exitCode `0` (all checked direct targets reachable) or `1` (actionable blocker found, e.g., EasyConnect VNIC disconnected).
2. **Packaging & CLI Wiring:**
   - Add `'ssh-preflight.mjs'` across all 4 bootstrap file closures: `package.json` (`"files"`), `native/bootstrap/package.json` (`"files"`), `native/bootstrap/payload-layout.mjs` (`PACKAGE_FILES`), and `native/bootstrap/packed.test.mjs` (`packageFiles`) — keeping `RUNTIME_FILES` at 21.
   - Update `native/bootstrap/bin.mjs` (`help` command list, error `codes` if needed, human vs `--json` output branch alongside `'status'`/`'verify'`) and `cli.mjs` (`run` subcommand allowlist `L168` + text/exitCode output handler `L177-187`).
3. **Documentation Updates (`docs/WINDOWS-DIRECT-TUNNEL-SSH-ARCHITECTURE.md`):**
   - Document ChatGPT / Dot -> Official OpenAI Tunnel (`openai/tunnel-client`) -> Local Windows MCP (`@wonderwhy-er/desktop-commander`, `DESKTOP_COMMANDER_DISABLE_TELEMETRY=1`) -> Windows OpenSSH (`ssh.exe` + `~/.ssh/config`) -> Linux GPU/Research servers (`ssh-preflight` diagnostics + EasyConnect VPN awareness).
   - Document compliant UAC-gated Administrator retry command verbatim from `native/bootstrap/install.ps1:15`:
     `.\install.ps1 -Administrator -Apply -Consent accept-administrator-browser-installation -PromptForConnection -ExtensionId '<extensionId>'`.

### 2.5 Fix E — Opt-In Takeover / Login Delegation Auto-Reply (`autoAuthorizeTakeover`) & CAPTCHA/2FA Guard
Observed live Dot failure (`media_1795677585864_e651d91c.jpg`): Dot pauses its turn with an active `Send a message` composer and an assistant turn asking the user to complete authorization/login or hand back control (e.g., `"请...完成授权，然后把控制权交回我"` / `"complete authentication"` / `"hand control back"`), even when `Your dot's browser` already shows `Authenticated` + `Your dot has control [Take over]`.
1. **Opt-In Configuration (`config.js`, `popup.html`, `popup.js`, `i18n-*.js`):**
   - Add `autoAuthorizeTakeover: false` (boolean) and `takeoverReply: ''` (string, `<= 4000` chars, no NUL/lone surrogates) to `DEFAULT_CONFIG` and `readConfig()`. `DEFAULT_CONFIG.autoAuthorizeTakeover` stays `false`.
   - Expose `#autoAuthorizeTakeover` checkbox + optional `#takeoverReply` input under Settings (`panel-settings`), omitting `takeoverReply` from default backup exports unless `includeSecrets` is checked.
   - When `takeoverReply.trim()` is empty, `resolvedTakeoverPrompt(config)` supplies a clear honest delegation text telling Dot: explicit authorization is granted to proceed autonomously if control/session is already active, and to pause cleanly stating the exact step ONLY if human credentials, 2FA, or CAPTCHA verification are strictly required.
2. **CAPTCHA/2FA Safety Gate (`captcha-required`) & Control Hand-Back (`adapter.js`, `content.js`, `background.js`):**
   - Never solve/bypass CAPTCHAs or invent passwords/OTP codes. If reCAPTCHA/hCaptcha/Turnstile elements (`iframe[src*="recaptcha"]`, `iframe[src*="hcaptcha"]`, `challenges.cloudflare.com`, `.cf-turnstile`, `.g-recaptcha`) or explicit CAPTCHA/2FA/password prompts (`captcha|turnstile|人机验证|动态验证码|otp|2fa code|enter your password`) are detected when `autoAuthorizeTakeover === true`, return `result('blocked', ..., 'captcha-required')` and call `pauseLocked(..., 'paused', { code: 'captcha-required' })`.
   - If Dot renders a browser handover control (`Give control back`, `Hand control back`, `Hand back control`, `Return control`, `交回控制权`, `归还控制权`) and no CAPTCHA/auth blocker is present (`args.autoAuthorizeTakeover === true`), click it via synchronous DOM dispatch with WeakMap 4s cooldown and return `'auto-allowed-prompt'` (NEVER clicking `"Take over"`).
   - If Dot's latest assistant turn (`lastAssistant` with `assistantToken`) matches `takeoverRequestPattern` and `assistantToken !== args.lastTakeoverToken`:
     - During regular `mode === 'send'` (`args.isTakeoverReply !== true`), return `{ status: 'busy', retryable: false, diagnosticCode: 'takeover-needed', takeoverAssistantToken: assistantToken }` so `background.js` executes a dedicated `runKind: 'takeover-reply'` round using the takeover delegation prompt **without** skipping the user's queued task prompt (`queueIndex` preserved!) and bounded by `maxTakeoverConsecutive = 3` + `lastTakeoverToken` dedupe.
     - During idle observation in `content.js` (`!busy()` + safe context + `lastAssistant` matches `takeoverRequestPattern`), emit `{ type: 'TAKEOVER_PROMPT_OBSERVED', assistantToken }` (throttled `>= 5000 ms`, deduplicated per `assistantToken`) so `background.js` responds within seconds rather than waiting for a 20-minute interval alarm!
   - Add `'takeover-replied'` and `'captcha-required'` (and internal `'takeover-needed'`) to `activity-export.js`, `delivery-diagnostics.js`, `background.js:432,929-941,1855-1856,2059`, `i18n-runtime.js`, `i18n-popup.js`, `PRIVACY.md`, and `docs/STORE-LISTING.en.md`.

---

## 3. Alternatives Considered & Trade-offs
*(Preserved and refined from rev 1: opt-in `autoAllow: false` default avoids breaking Store/safety policies; synchronous DOM clicks avoid `__reactProps$` and hidden-tab `setTimeout` clamps; `preDispatch` safely fences post-injection restarts while recovering pre-injection crashes; dynamic `~/.ssh/config` + numeric WMI status avoids privacy leaks and Windows locale fragility.)*

---

## 4. Detailed Implementation & Verification Matrix

| Gate | Command / Check | Pass Criterion |
|---|---|---|
| Core & Syntax | `npm run check` (plus `node --check content.js`) | Exit 0, 0 failures |
| Safety & Recovery | `npm run test:safety` (with new `preDispatch` / `browser-restored` / `tabs.onUpdated` scenarios) | Exit 0, 0 failures |
| Approval Boundary & Opt-In | `node --test tests/approval-boundary-tests.mjs tests/auto-allow-optin-tests.mjs` | Default `autoAllow: false` passive; opt-in clicks Allow once and pauses on OAuth |
| Support & Store Docs | `npm run test:support` | Exit 0 (`STORE-LISTING.en.md` `**3.3.0**`, `<= 4000` chars, valid URLs) |
| Dot Adapter & Editor Commit | `node tests/dot-adapter-tests.mjs && node tests/editor-commit-tests.mjs && node tests/editor-commit-browser-tests.mjs` | Optimistic non-`~` rows confirm `sent`; `'acct~other~Msg~new'` blocks |
| MV3 & UI Playwright | `node tests/ui-v2-tests.mjs && node tests/mv3-integration-tests.mjs` | All checks pass; `#autoAllow` persisted & excluded/included cleanly |
| Windows & SSH Preflight | `npm run test:setup && npm run test:devices && npm --prefix native/bootstrap test && node --test native/bootstrap/ssh-preflight.test.mjs` | All packaging closures, CLI checks, and preflight tests pass |
