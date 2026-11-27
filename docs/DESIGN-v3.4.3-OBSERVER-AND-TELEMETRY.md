# Design Document — v3.4.3 Observer Reliability & Incident Telemetry Integrity

## 1. The Problem

Live `v3.4.2` production telemetry (`agent-continue-activity_(21).json`, spanning 54 consecutive unattended sends over 9h 11m with zero pauses or interval drift) exposed three concrete runtime and observability bugs:

1. **`incidentDeliveries` corruption and real-incident eviction (`background.js`)**: `isIncidentTrace(trace)` returns `true` whenever `trace.state !== 'sent'`, which matches in-flight `state === 'running'` intermediate snapshots (specifically hitting `stage: 'dispatch', reason: 'unsupported-view'` on every Dot send during the normal Tiptap-to-adapter handoff). Once a delivery completes cleanly (`state: 'sent', reason: 'receipt-confirmed'`), `freshIncidents` becomes empty so `incidentDeliveries` is never updated or pruned, leaving up to 20 frozen `'running'` records of healthy deliveries that evict genuine incidents (such as `takeover-replied`). Existing live browser installations upgraded from `v3.4.2` already hold stale `'running'` records in `chrome.storage.local.incidentDeliveries`.
2. **Spurious `unknown-modal` alerts immediately after `started` (`dialog-classifier.js`, `content.js`)**: Three `unknown-modal` events occurred `1.74s–2.63s` after `started` despite the 5,000 ms dwell rule because (a) `SCAN_DIALOG_CONTEXT { reset: true }` resets `lastKind` in `content.js` without clearing pre-existing timestamps in `firstSeenMap`, and (b) `detectUnknownModal` and `detectOAuthPopup` omit ancestor and element visibility/non-blocking checks for `opacity: 0`, `visibility: collapse`, `pointer-events: none`, `[inert]`/`[hidden]`/`[aria-hidden="true"]`, closed state (`data-state="closed"`, `data-open="false"`), navigation/sidebar containers, zero-sized portals (`width < 2 || height < 2`), and completely empty non-interactive `[role="dialog"]` shells.
3. **Zero-lag takeover observer misses, observer-adapter split-brain, and misattributed trigger (`content.js`, `adapter.js`, `background.js`)**: Live `takeover-needed` turns were caught only at the 10-minute `round` poll rather than by `content.js` `observeIdleTakeoverPrompt()` because (a) `document.querySelector(busyControlSelector)` matches hidden/overlay/sidebar `.typing-indicator` or Dot's persistent `Dot Thinking` indicator even when no Stop button exists and the main composer displays its Send button (often disabled while the composer is empty), (b) `text.length > 4000` silently drops longer Dot turns ending in confirmation requests, (c) neither `content.js` nor `adapter.js` enforces trailing user-turn dominance cleanly, (d) `content.js` latches `lastTakeoverToken` prematurely before acceptance and relies on a cached `classifyDialogContext` closure, (e) `MutationObserver` ignores `characterData`, `'inert'`, `'open'`, `'data-open'`, and visibility/disabled attributes, (f) under `waitForIdle: true` or `scheduleMode: 'after-reply'` (`checkReplyTurn`), `adapter.js` `checkTakeoverConversationPrompt(false)` still lets `.typing-indicator` mask conversational takeover turns into `'agent-busy'`, and (g) `finishRoundLocked()` hardcodes `trigger: 'round'` on `takeover-replied` even when triggered by `TAKEOVER_PROMPT_OBSERVED` (`'observer'`).

---

## 2. The Technical Plan

The design keeps all existing Schema 5 fields (`activity-export.js`, `delivery-diagnostics.js`) and existing `storage.local.get('deliveryDiagnostics')` single-string test hooks intact across four coordinated modules:

```text
[DOM / Page]
  |-- Dialogs --> dialog-classifier.js: isVisibleBlockingDialog() (ancestor + style + rect)
  |                 +-- __agentContinueResetDialogTimers() clears DOM keys on START/RESUME
  |-- Takeover --> content.js: MutationObserver (+characterData, +inert/open/data-open/style/class)
  |                 +-- dynamic __agentContinueClassifyDialog lookup
  |                 +-- isIdleForTakeover() (no visible Stop; .typing-indicator ok if composer Send present)
  |                 +-- non-overlay/fixed portal filtering + lastUserTurn order + 32,768-char tail
  |                 +-- emits TAKEOVER_PROMPT_OBSERVED (latch token only when not transient-rejected)
[Service Worker & Verification]
  |-- background.js: handlePagePromptObserved() -> { ok: false, transient: true } when phase==='sending'
  |                 + probe(..., detectTakeover: true) -> adapter.js checkTakeoverConversationPrompt()
  |                 + runTakeoverReplyRound(..., trigger) propagates pendingTakeoverTrigger
  |-- adapter.js: ancestor visibility in visible(); checkTakeoverConversationPrompt() Dot parity + user-turn guard
  |-- persistDeliveryTrace(): separate get('deliveryDiagnostics'); exclude state==='running' from
                    isIncidentTrace(); independent incidentDiscardPrevious flag; !incIds retention
```

### Component Contracts
1. **Incident Telemetry Filter & Pruner (`background.js`)**:
   - `isIncidentTrace(trace)` returns `false` when `!trace || typeof trace !== 'object' || trace.state === 'running'`. Settled failure/degraded/interrupted/takeover/manual/counter traces (`trace.state !== 'sent'`, `trace.reason === 'takeover-replied'`, or positive incident counters) continue to return `true`. (Note: `activity-export.js` and `tests/delivery-diagnostics-tests.mjs:476` intentionally pass through supplied `state: 'running'` objects when explicitly passed to `buildActivityExport`; therefore `activity-export.js` is unchanged, and live/legacy storage cleanup happens in `persistDeliveryTrace()`.)
   - Module-scoped flags: `let incidentDeliveriesCleaned = false;` and `let incidentDiscardPrevious = false;` declared alongside `diagnosticDiscardPrevious` (outside the `readSource` / `writerSource` extraction ranges in `tests/background-state-tests.mjs:13-14`).
   - In `clearDeliveryDiagnostics()`: set `diagnosticDiscardPrevious = true; incidentDiscardPrevious = true; incidentDeliveriesCleaned = false;`. Inside `diagnosticClearBarrier`'s `.then`: if `epoch === diagnosticEpoch`, reset `diagnosticDiscardPrevious = false; incidentDiscardPrevious = false;`.
   - `persistDeliveryTrace()` preserves `readUntilInvalidated(() => chrome.storage.local.get('deliveryDiagnostics'), signal)` as an unchanged single-string lookup so existing mock-storage tests remain compatible.
   - `persistDeliveryTrace()` reads `chrome.storage.local.get('incidentDeliveries')` when `currentEpoch === diagnosticEpoch` and any of: `freshIncidents.length > 0 || !incidentDeliveriesCleaned || incidentDiscardPrevious`.
   - Exact read/reconcile/write semantics when reading `incidentDeliveries`:
     1. **Stale epoch guard**: `if (incResult.invalidated || currentEpoch !== diagnosticEpoch) continue;` (aborts the entire write-loop iteration cleanly before `chrome.storage.local.set`, matching `result.invalidated` handling).
     2. **Same-epoch storage error**: if `incResult.error`, treat incident persistence as supplemental/non-fatal—omit `incidentUpdate`, leave `incidentDeliveriesCleaned` and `incidentDiscardPrevious` untouched (do NOT clear `incidentDiscardPrevious` even when `await write` clears `diagnosticDiscardPrevious = false`), and continue writing `deliveryDiagnostics` and `diagnosticsHealth`.
     3. **Same-epoch clean read, `incidentDiscardPrevious === true`** (e.g., a prior `CLEAR_LOGS` `remove()` failed in this epoch): discard prior storage entries (`keptInc = []`), compute `nextInc = [...freshIncidents].sort((a, b) => a.sequence - b.sequence).slice(-20)`, and set `incidentUpdate = { incidentDeliveries: nextInc }` whenever `incResult.value?.incidentDeliveries !== undefined || freshIncidents.length > 0`.
     4. **Same-epoch clean read, `!incidentDiscardPrevious`**: inspect `rawPrevInc = incResult.value?.incidentDeliveries`. Sanitize `(Array.isArray(rawPrevInc) ? rawPrevInc : []).map(sanitizeDeliveryDiagnostics).filter(Boolean)`, keep only `item => item.state !== 'running' && isIncidentTrace(item) && !incIds.has(item.sequence)` (`incIds` = sequences in `freshIncidents` ONLY, preventing `newDeliveryTrace()` sequence reset collisions from deleting settled historical incidents), and compute `nextInc = [...keptInc, ...freshIncidents].sort((a, b) => a.sequence - a.sequence).slice(-20)`. Compute `rawChanged = rawPrevInc !== undefined && (!Array.isArray(rawPrevInc) || JSON.stringify(nextInc) !== JSON.stringify(rawPrevInc))`. Include `incidentUpdate = { incidentDeliveries: nextInc }` iff `freshIncidents.length > 0 || rawChanged`.
   - **Commit ordering**:
     - If `!incResult.error` and `incidentUpdate` omits `incidentDeliveries` (`rawPrevInc === undefined && nextInc.length === 0`, or identical clean array), set `incidentDeliveriesCleaned = true; incidentDiscardPrevious = false;` when `currentEpoch === diagnosticEpoch`.
     - If `incidentUpdate` includes `incidentDeliveries`, update `incidentDeliveriesCleaned = true; incidentDiscardPrevious = false;` **only after `await write` resolves** and while `currentEpoch === diagnosticEpoch`. (Separately, `diagnosticDiscardPrevious = false` still updates after `await write` resolves as before.)
2. **Dialog Visibility & Dwell Reset (`dialog-classifier.js`, `content.js`)**:
   - Extract shared helper `isVisibleBlockingDialog(dialog)` in `dialog-classifier.js` and apply in both `detectOAuthPopup()` and `detectUnknownModal()`.
   - `isVisibleBlockingDialog(dialog)` returns `false` if:
     - `!dialog || dialog.isConnected === false` (`undefined` remains allowed for `FakeElement` test doubles).
     - `dialog.hasAttribute?.('hidden') || dialog.hasAttribute?.('inert') || dialog.getAttribute?.('aria-hidden') === 'true'`.
     - `dialog.getAttribute?.('data-state') === 'closed' || dialog.getAttribute?.('data-open') === 'false'`.
     - `dialog.closest?.('[hidden], [inert], [aria-hidden="true"], nav, aside, header, footer, [role="navigation"], [data-testid*="sidebar"]')` is non-null.
     - Assistant-turn ancestor check (`article.message-row, [data-message-author-role="assistant"], [data-chatgpt-search-unit-key$=":assistant"]`, retained in both functions).
     - Ancestor & element computed-style walk (`for (let node = dialog; node; node = node.parentElement)`): inside local `try/catch`, if `st.display === 'none' || st.visibility === 'hidden' || st.visibility === 'collapse' || st.opacity === '0' || st.pointerEvents === 'none'` -> return `false` (`undefined` fields in minimal mocks are ignored safely).
     - Bounding-rect check when `(typeof document === 'undefined' || document.visibilityState !== 'hidden')` and `typeof dialog.getBoundingClientRect === 'function'`: inside local `try/catch`, if `rect && (rect.width < 2 || rect.height < 2)` -> return `false`.
   - In `detectUnknownModal()`, also skip empty non-interactive shells (`!String(dialog.textContent || '').trim() && !dialog.querySelector?.('button, [role="button"], input, a, iframe')`).
   - Add `resetDialogTimers()` in `dialog-classifier.js`, exposed as `globalThis.__agentContinueResetDialogTimers`: guard `if (typeof document === 'undefined' || !document.querySelectorAll) return;`, query `[role="dialog"], [role="alertdialog"]`, and delete each node from existing `firstSeenMap` `WeakMap` without replacing `globalThis.__agentContinueFirstSeenMap`.
   - Update `classifyDialogContext(options)` to call `if (options?.reset === true) resetDialogTimers();` first and then fall through normally to `detectSessionExpired()`, `detectOAuthPopup()`, and `detectUnknownModal()`.
   - In `content.js`: resolve dialog classifier dynamically (`const runClassifyDialogContext = options => (globalThis.__agentContinueClassifyDialog ?? (() => ({ safe: true, kind: 'none', evidence: [], confidence: 1.0 })))(options);`) instead of caching a stale closure across same-world re-injections; on `SCAN_DIALOG_CONTEXT` with `message.reset === true`, set `lastKind = null; lastTakeoverToken = null;` and call `globalThis.__agentContinueResetDialogTimers?.()`.
3. **Zero-Lag Takeover Observer, Adapter Parity, & Trigger Attribution (`content.js`, `adapter.js`, `background.js`)**:
   - In `content.js`:
     - Hoist `overlaySelector = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]'` to IIFE scope.
     - Add `hasFixedAncestor(el)` (walking `el?.parentElement` up to `body`/`documentElement` checking `getComputedStyle(node).position === 'fixed'` inside `try/catch`) and secondary fixed-portal detection matching `adapter.js` (`composerEditorSelector = '#prompt-textarea, [data-composer-markdown], [data-composer-input] [contenteditable="true"], [role="textbox"][contenteditable="true"]'`; if more than 1 visible editor exists on page and a non-dialog `fixed` ancestor holds a non-main editor, elements inside that `fixed` subtree are treated as overlay-scoped; elements inside `[role="dialog"]` etc. are still handled directly by `overlaySelector`).
     - Define `isVisibleNonOverlay(el, { allowOverlay = false } = {})`:
       - Guard `if (!el || el.isConnected === false) return false;`.
       - Reject if `el.closest?.('[hidden], [inert], [aria-hidden="true"], nav, header, aside, footer, [role="navigation"], [data-testid*="sidebar"]')` or (`!allowOverlay && isOverlayElement(el)`).
       - Walk `for (let node = el; node; node = node.parentElement)` with local `try/catch`: reject if `getComputedStyle(node)` has `display === 'none' || visibility === 'hidden' || visibility === 'collapse' || opacity === '0'`.
       - If `(typeof document === 'undefined' || document.visibilityState !== 'hidden') && typeof el.getBoundingClientRect === 'function'`: inside local `try/catch`, require `(rect.width > 0 && rect.height > 0) || Boolean(el.getClientRects?.().length)`.
     - Apply `isVisibleNonOverlay(btn)` / `isVisibleNonOverlay(dlg, { allowOverlay: true })` filtering inside `findDotSignInCardToken()` (`userTurns`, `dialogs`, `controlBtns`, `curr`) and skip `position: fixed` non-main portal userTurns/cards consistently with `isOverlayElement`.
     - Replace `document.querySelector(busyControlSelector)` in `observeIdleTakeoverPrompt()` with `isIdleForTakeover()`:
       - `stopControlSelector = 'button[data-testid="stop-button"], button[aria-label*="Stop" i], button[aria-label*="停止" i]'`
       - `typingIndicatorSelector = '.typing-indicator'`
       - `sendControlSelector = 'button[data-testid="send-button"], button[data-testid="composer-submit-button"], button[data-testid="fruitjuice-send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"], button[aria-label="Send"], button[aria-label="发送提示"], button[aria-label="发送消息"], button[aria-label="发送"], button[type="submit"]'`
       - `composerContainerSelector = '[data-composer-root], [data-composer-body], [data-composer-footer-responsive], form'`
       - `composerEditorSelector = '[data-composer-markdown], [data-composer-input] [contenteditable="true"], #prompt-textarea, [role="textbox"][contenteditable="true"], textarea'`
       - Return `false` (busy) if any match of `stopControlSelector` passes `isVisibleNonOverlay`.
       - Check if any match of `typingIndicatorSelector` passes `isVisibleNonOverlay`. If so, require at least one visible non-overlay Send button (`sendControlSelector`) whose closest `composerContainerSelector` container exists, is not overlay-scoped, and contains a visible non-overlay editor (`composerEditorSelector`) — allowing either an enabled OR empty-composer-`disabled` Send button (`isVisibleNonOverlay(btn)`), because live Dot keeps its bottom Send button visible (`disabled` until input) with `Dot Thinking` when waiting on authorization, whereas active pre-token thinking without an idle composer lacks a visible composer Send control (or shows `stopControlSelector`).
     - In `observeIdleTakeoverPrompt()`:
       - Query assistant turns filtered by `isVisibleNonOverlay` (`turns`).
       - Enforce trailing user-turn dominance: query non-overlay visible user turns (`article.message-row.self, [data-message-author-role="user"], article.self, [data-chatgpt-search-unit-key$=":user"]`), take `lastUserTurn = userTurns.at(-1)`. If `lastUserTurn && typeof last.compareDocumentPosition === 'function' && typeof Node !== 'undefined' && (last.compareDocumentPosition(lastUserTurn) & Node.DOCUMENT_POSITION_FOLLOWING)`, return `null`.
       - Replace the `4000`-char ceiling with `const boundedText = text.length > 32768 ? text.slice(-32768) : text;` and require `takeoverRequestPattern.test(boundedText) && !captchaPattern.test(boundedText)`.
     - Latching rule on `TAKEOVER_PROMPT_OBSERVED`: send `chrome.runtime.sendMessage({ type: 'TAKEOVER_PROMPT_OBSERVED', assistantToken: takeoverToken })` and only latch `lastTakeoverToken = takeoverToken` when `reply?.transient !== true` (`lastTakeoverAt` continues bounding cadence >= 1,500 ms so if `background.js` rejects transiently due to `phase === 'sending'`, the observer can re-fire once `phase` returns to `'idle'`, while permanent rejections such as disabled/cap >= 3/off stay latched until reset).
     - Update `MutationObserver` in `content.js` to `{ childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'inert', 'open', 'aria-hidden', 'disabled', 'aria-disabled', 'data-state', 'data-open', 'class', 'style'] }` and skip scheduling when `Array.isArray(records) && records.length > 0 && records.every(r => { const n = r?.target?.nodeType === 3 ? r.target.parentElement : r?.target; return Boolean(n?.closest?.('[contenteditable="true"], textarea, #prompt-textarea')); })`.
   - In `adapter.js`:
     - Update `visible(element)` (`L166-174`) to walk `for (let node = element; node; node = node.parentElement)` checking `style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0'` inside `try/catch` (matching `editor-commit.js` so background-tab hidden wrappers are never mistaken for visible controls).
     - Update `checkTakeoverConversationPrompt(allowWhenPaused)` (`L593-627`):
       - Before returning an assistant-turn takeover (`L608-625`), enforce user-turn dominance: take `const lastUser = messageNodes('user').at(-1);`, if `lastUser && typeof last.compareDocumentPosition === 'function' && typeof Node !== 'undefined' && (last.compareDocumentPosition(lastUser) & Node.DOCUMENT_POSITION_FOLLOWING)` -> return `null`.
       - On Dot (`isDot`) when `!allowWhenPaused`: compute `const composerBinding = findComposer(); const hasDotSendControl = Boolean(composerBinding && visibleMatches(sendSelector, composerBinding.composer).length > 0);`. If `!activeStop && !isDotPaused() && hasDotSendControl`, do not let `.typing-indicator` in `busy()` suppress checking `last` for `takeoverRequestPattern` (leaving `busy()` itself at `L1106` completely unchanged so non-takeover `waitForIdle: true` sends keep waiting cleanly!).
   - In `background.js`:
     - In `handlePagePromptObserved(sender, mode)`: return `{ ok: false, transient: true }` specifically when `job?.enabled && job.phase !== 'idle'` (vs `{ ok: false }` when disabled, unbound, opt-out, or cap >= 3).
     - Add `trigger = 'round'` as 5th parameter of `runTakeoverReplyRound(assistantToken, expectedJobId = null, expectedIntentVersion = null, assistantLang = null, trigger = 'round')`; record `pendingTakeoverTrigger: trigger === 'observer' ? 'observer' : 'round'` on the claimed `snapshot`.
     - Pass `'observer'` from `handlePagePromptObserved()`; pass `'round'` from `start()` and `runRound()`.
     - In `finishRoundLocked()`: read `const takeoverTrigger = current.pendingTakeoverTrigger === 'observer' ? 'observer' : 'round';` for `'takeover-replied'` (and propagate `current.runKind === 'takeover-reply' ? takeoverTrigger : 'round'` safely or on `'takeover-replied'`), and clear `pendingTakeoverTrigger: undefined` alongside `pendingTakeoverToken: undefined` and `pendingTakeoverLanguage: undefined` in `finishRoundLocked()`, `makePaused()` (`pauseLocked`), `handlePagePromptObserved()` (`cleared`), and all three `phase === 'sending'` recovery branches in `initialize()`.

---

## 3. Alternatives Considered

- **Combine `get('deliveryDiagnostics')` and `get('incidentDeliveries')` into a single array `.get([...])` call**: Rejected because existing regression tests in `tests/background-v2-tests.mjs` (`L2570`, `L4666`, `L4683`) intercept `chrome.storage.local.get` checking `key === 'deliveryDiagnostics'` as an exact string.
- **Keep `!ids.has(item.sequence)` (`fresh` all traces) instead of `!incIds.has(item.sequence)` (`freshIncidents` only)**: Rejected because `newDeliveryTrace()` determines `diagnosticSequence` solely from `deliveryDiagnostics`; if `deliveryDiagnostics` is missing/empty/smaller while `incidentDeliveries` retains old incidents, matching `'running'`/`'sent'` sequences against `ids` would delete genuine settled incidents on collision.
- **Reuse `diagnosticDiscardPrevious` for `incidentDeliveries`**: Rejected because a transient `incResult.error` in the same epoch after a failed `CLEAR_LOGS` removal would allow `diagnosticDiscardPrevious = false` on `deliveryDiagnostics` write completion, dropping discard protection and resurrecting pre-Clear incidents on the next flush.
- **Ignore `aria-modal !== "true"` dialogs unconditionally**: Rejected because `TC-05` in `tests/dialog-classifier-tests.mjs` and real non-ARIA-modal blocking popups use `role="dialog"` without `aria-modal="true"`.
- **Gate `.typing-indicator` bypass solely on `!btn.disabled` Send buttons**: Rejected because Dot conversations awaiting user action while the composer is empty render a disabled/muted Send button (without Stop) alongside `Dot Thinking`. Requiring a visible composer-scoped Send button (`composer` containing a visible editor) with absent Stop controls covers both empty-draft and populated-draft takeover prompts while still holding back when no composer Send button is rendered.
- **Re-instantiate `firstSeenMap = new WeakMap()` on reset**: Rejected because `tests/dialog-classifier-tests.mjs` inspects `globalThis.__agentContinueFirstSeenMap`; deleting active DOM keys preserves reference identity.

---

## 4. Detailed Implementation

### Files to Modify
1. `background.js`
   - Update `isIncidentTrace(trace)` (`state === 'running'` -> `false`), add `incidentDeliveriesCleaned` and `incidentDiscardPrevious`, reset in `clearDeliveryDiagnostics()`, and implement epoch-safe non-colliding reconciliation in `persistDeliveryTrace()`.
   - Return `{ ok: false, transient: true }` in `handlePagePromptObserved()` when `job?.enabled && job.phase !== 'idle'`, propagate `pendingTakeoverTrigger` through `runTakeoverReplyRound()` and `finishRoundLocked()`, and clear `pendingTakeover*` across `finishRoundLocked()`, `makePaused()`, `handlePagePromptObserved()`, and `initialize()`.
2. `dialog-classifier.js`
   - Implement shared ancestor-aware `isVisibleBlockingDialog(dialog)` across `detectOAuthPopup()` and `detectUnknownModal()`, skip empty non-interactive shells in `detectUnknownModal()`, export `__agentContinueResetDialogTimers`, and support `classifyDialogContext({ reset: true })` fall-through.
3. `content.js`
   - Dynamic `__agentContinueClassifyDialog` lookup, `SCAN_DIALOG_CONTEXT { reset: true }` clearing `lastKind`, `lastTakeoverToken`, and `__agentContinueResetDialogTimers?.()`, ancestor-aware `isVisibleNonOverlay`, `hasFixedAncestor` portal scoping, composer-editor-verified `isIdleForTakeover()`, `findDotSignInCardToken()` visibility & overlay parity, `[data-chatgpt-search-unit-key$=":user"]` + `lastUserTurn` dominance check, 32,768-char bounded tail, transient-rejection retry for `lastTakeoverToken`, and extended `MutationObserver` (`characterData`, `inert`, `open`, `data-open`, etc.) filtering pure composer edits.
4. `adapter.js`
   - Walk `parentElement` styles in `visible(element)`; enforce trailing user-turn dominance in `checkTakeoverConversationPrompt()`; allow Dot conversational takeover detection when `!activeStop && !isDotPaused() && hasMainComposerSendControl()` even if `waitForIdle: true` and `.typing-indicator` is present (preserving non-takeover `agent-busy` waits).
5. Release & Docs (after code tests pass):
   - `manifest.json`: bump `"version"` from `"3.4.2"` to `"3.4.3"`. Keep `package.json` and `package-lock.json` at npm CLI `"0.3.0"`.
   - `docs/STORE-LISTING.en.md`: update both `3.4.2` occurrences on line 3 (`**3.4.2**` and `3.4.2`) to `3.4.3`.
   - `CHANGELOG.md`, `README.md`, `README.zh-CN.md`: document `v3.4.3` and link this design doc using the full `https://github.com/1235357/agent-continue/blob/main/docs/DESIGN-v3.4.3-OBSERVER-AND-TELEMETRY.md` URL (required by `tests/public-documentation-tests.mjs:137-157`).
6. Unit & Integration Tests:
   - `tests/dialog-classifier-tests.mjs`: update `getComputedStyle` mock (`opacity`, `pointerEvents`), tokenize `FakeElement.matches()` / `querySelectorAll()` for exact tag/attribute tokens (`button`, `[role="button"]`, `input`, `a`, `iframe`, `[inert]`, `[hidden]`, `[aria-hidden="true"]`, `nav`, `aside`, `header`, `footer`, `[role="navigation"]`, `[data-testid*="sidebar"]`, `[role="alertdialog"]`), and add tests covering `opacity: 0`, hidden/opacity:0 ancestors under `document.visibilityState === 'hidden'`, `visibility: collapse`, `pointer-events: none`, `[inert]`, `data-state="closed"`, `data-open="false"`, `isConnected === false`, sidebar ancestor, zero-rect portal (visible vs `visibilityState === 'hidden'`), empty `[role="dialog"]`, `detectOAuthPopup()` hidden-ancestor filtering, and `__agentContinueResetDialogTimers()` / `classifyDialogContext({ reset: true })`.
   - `tests/auto-allow-optin-tests.mjs`: use isolated `browser.newContext()` / `newPage()` blocks and `>= 1400 ms` settle for observer tests (`requestIdleCallback` budget), covering: (a) >4,500-char takeover turn firing `TAKEOVER_PROMPT_OBSERVED`, (b) `.typing-indicator` + visible composer-scoped Send button (both enabled and empty-composer `disabled`) firing without Stop button, (c) `adapter.js` `pageAction` under `waitForIdle: true` detecting `takeover-needed` alongside `.typing-indicator` + composer Send (while still returning `agent-busy` without takeover prompt), (d) negative assertions for `stop-button`, unscoped non-editor `<form><button type="submit">`, trailing `userTurn`, `.typing-indicator` without composer Send, `SCAN_DIALOG_CONTEXT { reset: true }` resetting tokens/timers, and `MutationObserver` `characterData`/attribute triggers ignoring composer-internal edits, plus (e) background tests for transient rejection retry (`phase === 'sending'`), `trigger: 'observer'` on `TAKEOVER_PROMPT_OBSERVED`, and `trigger: 'round'` on fresh `SEND_NOW` (with zero `dispatchAttempts`/`manualIntents`).
   - `tests/background-state-tests.mjs`: add tests wrapping `h.chrome.storage.local.remove` / `get` directly covering: intermediate `'running'` / `'unsupported-view'` flushes (`terminalRetryable: true` / deferred progress) excluded from `incidentDeliveries`, pruning legacy pre-existing `'running'` and corrupt `[null, {}]` entries cleanly, preserving historical settled incidents when `deliveryDiagnostics` sequence resets (`!incIds`), stale-epoch `incResult` abort, and failed `CLEAR_LOGS` `remove` + `incResult.error` keeping `incidentDiscardPrevious` intact without resurrecting pre-Clear incidents.

### Error Handling & Edge Cases
- **Lightweight test doubles**: check `!el || el.isConnected === false` and guard `typeof document !== 'undefined'`, `typeof el.getBoundingClientRect === 'function'`, and `typeof el.compareDocumentPosition === 'function'` inside local `try/catch` blocks.
- **Hidden tabs on Windows**: ancestor style walk (`display: none`, `visibility: hidden/collapse`, `opacity: 0`) always applies even when `document.visibilityState === 'hidden'`; minimum bounding-rect size checks are gated on `document.visibilityState !== 'hidden'`.
- **Clear & storage-error concurrency**: `incResult.invalidated || currentEpoch !== diagnosticEpoch` aborts the persistence pass cleanly; `incResult.error` in the same epoch preserves `incidentDiscardPrevious` and leaves `incidentDeliveriesCleaned = false` for retry without blocking `deliveryDiagnostics`.

### Acceptance Cases & Verification Commands
All existing and new tests must pass with 0 failures and 0 skips via:
- `npm test`
- `python scripts/check_release_source.py v3.4.3` (after commit/tag/push to `origin/main`)

### Harmless Implementation Freedoms
- Exact helper function names inside module/IIFE scopes (`isVisibleBlockingDialog`, `isVisibleNonOverlay`, `isIdleForTakeover`, `composerHasEditor`).
- Comparison method (`JSON.stringify` vs structural equality) for `rawChanged` in `persistDeliveryTrace()`.
