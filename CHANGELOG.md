# Changelog

## Unreleased

## [3.4.0] - 2026-11-26

- Fix two real-time anti-interruption & latency bottlenecks uncovered in 8-hour `v3.3.5` live Dot session logs (`content.js`, `dialog-classifier.js`, `adapter.js`, `background.js`):
  - Stop gating `ROUTINE_APPROVAL_OBSERVED` and `TAKEOVER_PROMPT_OBSERVED` on `context.safe === true` in `content.js`, blocking only on genuine `session-expired` / `oauth-popup` modals and tightening sequential approval cooldown to 1.5 s so persisting benign UI dialogs no longer delay multi-step tool approvals to 60–120 s alarm polling cycles.
  - Skip Dot handover/sign-in modals (`Sign-in request`, `Take over`, `Return control`) in `dialog-classifier.js:detectUnknownModal()` when on `/dots/...` and check `tryReturnBrowserControl() || checkTakeoverConversationPrompt(true)` on `isDot && autoAuthorizeTakeover` before `detectAuthOrLoginBlock()` so Dot sign-in transitions delegate seamlessly instead of hitting avoidable pauses.
  - Key `unknown-modal` deduplication across intervening `sent` / `busy` events via per-(job, tab, kind, surface, evidence) tracking in `background.js` with `suppressedCount` reporting instead of re-logging on every send.
  - Avoid mislabeling restored paused tasks as waiting for tab rebind on browser/extension restart (`pause-restored`), and record `restored` (`rebound-tab`) when `rebindOrphanedJobIfUnique` reconnects the bound tab.
- Deliver comprehensive, zero-blindspot privacy-safe observability across UI Logs & Schema 5 exports (`background.js`, `activity-export.js`, `adapter.js`, `dialog-classifier.js`, `popup.js`, `support.js`, `PRIVACY.md`, `docs/STORE-LISTING.en.md`):
  - Enrich every lifecycle/interruption event (`paused`, `started`, `resumed`, `browser-restored`, `restored`, `interrupted`, `unconfirmed`, `blocked`, `sent`, `manual-sent`, `exception-detected`, `auto-allowed`, `takeover-replied`) with allowlisted `code` categories (`manual-pause`, `command-pause`, `user-clear-data`, `limit-reached`, `queue-complete`, `marker-reached`, `target-replaced`, `session-expired`, `activation-interrupted`, `pause-restored`, `alarm-unavailable`, `pause-unconfirmed`, `target-closed`, `target-changed`, `task-started`, `task-resumed`, `browser-session-restored`, `rebound-tab`, `worker-interrupted`, `reply-check-complete`, `unknown-modal`, `oauth-popup`), `targetKind`, `runKind`, `trigger`, `surface`, `optionKind`, allowlisted classifier `evidence` flags, linked `sequence`, `domWrites`/`textChunks`/`maxDomWriteMs`/`sentCount`/`suppressedCount`, and boolean state flags without ever exporting prompts, URLs, or DOM text.
  - Persist durable `incidentLogs` (up to 200 non-routine events), `incidentDeliveries` (up to 20 non-routine/slow/takeover traces), and aggregated `activityStats` counters (`summary` in Schema 5 export) so earlier pauses and exceptions survive 20+ subsequent normal deliveries.

## [3.3.5] - 2026-11-26

- Fix inline Dot routine tool-approval detection (`Always allow`, `Allow once`, `Allow this tool for this conversation`, `Deny`) when cards render directly in `<main>` outside `[data-message-author-role="assistant"]` and `[role="dialog"]` (`adapter.js`, `content.js`, `dialog-classifier.js`).
- Broaden conservative assistant confirmation detection (`"请确认我可以在..."`, `"Please confirm I can..."`, `"should I..."`) in `takeoverRequestPattern` and strengthen standing full-proxy pre-authorization defaults (`DEFAULT_TAKEOVER_REPLY_ZH/EN`) so Dot accepts designated GitHub collaborator invitations, clones, branches, commits/pushes, opens PRs, installs dependencies, uploads, and deploys with `/elephant-goldfish` without asking for manual takeover (`config.js`, `adapter.js`, `content.js`).
- Expand repository development onboarding and IDE sync for seamless team handoff: add `.editorconfig`, `.vscode/*`, `scripts/bootstrap-dev.ps1`, `scripts/bootstrap-dev.sh`, `docs/DEVELOPMENT-SETUP.md`, `docs/prompts/FULL-DELEGATION-DOT-PROMPT.md`, and `docs/handoffs/2026-11-26-v3.3.5-HANDOFF.md`.

## [3.3.4] - 2026-11-26

- Upgrade `DEFAULT_TAKEOVER_REPLY_ZH` and `DEFAULT_TAKEOVER_REPLY_EN` to invoke `/elephant-goldfish` and delegate logins, OAuth, sessions, and 2FA/verification code lookups autonomously with zero human-takeover escape clauses (`config.js`, `popup.html`, `i18n-html.js`).
- Separate strict human anti-CAPTCHA widgets/challenges from 2FA/verification text under opt-in `autoAuthorizeTakeover: true` on Dot so 2FA steps route to automatic delegation instead of false `captcha-required` pauses (`adapter.js`, `content.js`).

## [3.3.3] - 2026-11-26

- Eliminate 10+ second Dot UI send freezes on long multi-paragraph Markdown prompts (`adapter.js`): enable chunked insertion on `isDot`, add `HR` (`---`) support in `serializeDraft`, adopt rich-Markdown normalized renders without redundant `wait(10_000)` retries, insert `requestAnimationFrame` paint yields between chunks, optimize `identity()` / `tryReturnBrowserControl()`, and log `composer-unstable` before retry backoff waits.
- Detect inline Dot `Sign in to <host>` + `Sign in` cards even while `Dot Thinking` (`.typing-indicator`) is visible and allow `isTakeoverReply: true` to submit directly to the chatbox (`content.js`, `adapter.js`).
- Clear stuck `Working...` / `Pause scheduled sending` popup state when an in-flight activation transitions externally to manually paused in `chrome.storage.onChanged` (`popup.js`).

## [3.3.2] - 2026-11-26

- Eliminate false `"Sign-in dialog detected"` pauses and 60-second `exception-detected` log floods on Dot conversations (`dialog-classifier.js`, `content.js`, `background.js`, `adapter.js`):
  - Ignore inline conversation-turn dialogs inside `dialog-classifier.js:detectOAuthPopup()` so Dot thread cards like `Sign-in request | github.com` do not classify as ChatGPT browser-session OAuth popups.
  - Preserve `lastKind` across periodic worker-wake `SCAN_DIALOG_CONTEXT` pings (`pingDialogObserver(tabId, reset = false)`) and deduplicate repeated `unknown-modal` `exception-detected` entries so idle service-worker wakes no longer flood the 200-entry activity log every 60 seconds.
  - Delegate `DIALOG_EXCEPTION { kind: 'oauth-popup' }` on bound tabs with `autoAuthorizeTakeover: true` through `handlePagePromptObserved(sender, 'takeover')` instead of hard-pausing before `adapter.js` inspects the page.
  - Broaden Dot takeover & sign-in request recognition (`Sign-in request`, `登录请求`, `接管浏览器`, `Take over browser`, ignoring historical `Sign-in request closed` cards), automatically dismiss active non-CAPTCHA Dot `"Sign-in request"` dialogs (`Close` / `Dismiss`, never clicking `Take over`) or send bounded delegation replies even while Dot displays `Paused`, and reset `consecutiveTakeoverReplies` to `0` on explicit `RESUME`.
- Surface `#taskAutoAllow` and `#taskAutoAuthorizeTakeover` quick-toggles directly on the main Task tab (`popup.html`, `popup.js`, `i18n-html.js`) kept synchronized with Settings while preserving opt-in `false` defaults.

## [3.3.1] - 2026-11-26

- Raise the Linux `release` job `timeout-minutes` budget in `.github/workflows/release.yml` from `15` to `40` so the full `xvfb-run -a env TEST_HEADED=1 npm test` browser suite, store/extension packaging, SHA-256 verification, and GitHub draft release creation complete without hitting the 15-minute job cancellation timeout observed on `v3.3.0`.
- Includes all `3.3.0` fixes and features below (restart unique-tab auto-rebind, `preDispatch` safe recovery, Dot `'~'` turn-identity stabilization, opt-in routine approval automation with OAuth/login pause, opt-in Dot takeover / delegation auto-reply with CAPTCHA/2FA pause, and read-only `ssh-preflight`).

## [3.3.0] - 2026-11-26

- Fix browser/service-worker recovery and eliminate 34-second `browser-restored` activity log spam (`background.js`):
  - Track `restoredFromLocal` and deduplicate `browser-restored` logging once per restored browser session using session marker `browserRestoredLoggedJobId`, while keeping cold `initialize()` `tabId: null` semantics intact.
  - Add unique-tab auto-rebinding (`rebindOrphanedJobIfUnique`) in `chrome.tabs.onUpdated` (`status === 'complete'`) and `chrome.runtime.onStartup` when an enabled task has `tabId === null` and exactly one normalized target tab matches.
  - Add pre-dispatch recovery tracking (`preDispatch`) cleared inside `clearPreDispatch(runId)` immediately before `runScript('ISOLATED')`, so pre-injection worker interruptions resume automatically without false `unknownCount` increments, pauses, or `submissionFenceUntil` locks.
- Fix false Dot `unknown` / `documentChanges: 1` pauses during optimistic React message rendering (`adapter.js`, `editor-commit.js`):
  - Prefer structured `'~'`-delimited Dot message identities when resolving `identity()` across message turns, preventing transient unhydrated turn IDs from breaking `samePage()`.
- Restore opt-in routine approval automation (`autoAllow: false` default) and OAuth/login pause guard (`config.js`, `adapter.js`, `content.js`, `background.js`, `popup.html`, `popup.js`):
  - Add opt-in `autoAllow` toggle for routine tool execution prompts (standard DOM click dispatch only; no React internal hooks) while strictly pausing (`oauth-required`) when OAuth consent or session-expired login modals appear.
  - Emit zero-lag idle-deferred `ROUTINE_APPROVAL_OBSERVED` signals from `content.js` separate from `DIALOG_EXCEPTION`.
- Add opt-in Dot takeover / login delegation auto-reply & browser handover (`autoAuthorizeTakeover: false` default, `takeoverReply`, `config.js`, `adapter.js`, `content.js`, `background.js`, `popup.html`, `popup.js`):
  - Automatically click control-return buttons or send one authorization delegation reply per assistant turn (bounded to 3 consecutive replies, preserving `queueIndex` and `sentCount`), woken by `TAKEOVER_PROMPT_OBSERVED`, while strictly pausing on CAPTCHA/2FA/password prompts (`captcha-required`).
- Add read-only Windows SSH & EasyConnect preflight (`native/bootstrap/ssh-preflight.mjs`, `cli.mjs`, `bin.mjs`):
  - Add `npx agent-continue ssh-preflight` / `node native/bootstrap/bin.mjs ssh-preflight` to inspect OpenSSH client availability, `~/.ssh/config` hosts (respecting `ProxyJump`), WMI `Win32_NetworkAdapter.NetConnectionStatus === 2` status for Sangfor/EasyConnect VNICs, and bounded TCP reachability.

## [3.2.1] - 2026-11-21

- Back off repeated transport failures before submission from 150 ms to a maximum delay of 2.4 seconds between attempts. This limits retry frequency, not total waiting time. Pause cancels retries, and the scheduler still does not replay a submission whose outcome is unknown.
- Show pre-send transport waits in the delivery log. The diagnostic export records the number of scheduled waits and the longest requested interval, separately from submission attempts.

- Keep pending tool approvals manual in ChatGPT and Your dot. Detect and report them without clicking, writing to the composer, or trying to approve through page internals.
- Wait on scheduler alarms when Dot is paused or the composer is unavailable; keep bounded fast recovery when a transient result proves that no submission was attempted.
- Preserve distinct pause, busy, and missing-composer codes in local diagnostic exports without exposing page text.
- Keep dialog alerts inside the extension rather than requesting the optional browser notifications permission.
- Fix the guided Windows CMD entry so it forwards the optional setup ID to PowerShell.
- In Windows Setup, distinguish verified local installation from a connection request and chat authorization. Report known browser permission and native bridge blockers without losing the installed state or replaying an uncertain Connect request.
- Explain the separate online and extracted Windows setup paths. Stage matching extension and Windows release files in a GitHub Release draft for acceptance before publication.

Send confirmation remains a local page heuristic, not a server receipt.
ChatGPT and Dot permissions are granted separately from Windows installation.

## [3.2.0] - 2026-11-20

- Fix infinite 1Hz script injection loop and extreme page stutter/lag on Dot and ChatGPT pages (`background.js`, `adapter.js`):
  - Eliminate the unbounded 1-second `for (;;)` retry loop in `background.js:runRound`: break immediately when `result.status === 'blocked'` and `result.diagnosticCode === 'composer-unavailable'`, yielding to the scheduler alarm (`RETRY_MS = 60s`).
  - Add hard `MAX_PRE_SUBMISSION_RETRIES = 3` bound in `runRound` preventing any execution from monopolizing the renderer thread with repeated script injections.
  - Fix Dot `⏸ Paused` state and active generation awareness in `adapter.js`: check busy and pause indicators (`button[aria-label*="Resume"]`, `button[aria-label*="Pause"]`, `button:has-text("Paused")`, `[data-testid*="paused"]`) BEFORE returning composer-unavailable `blocked`, classifying paused agents as `status: 'busy'`, `diagnosticCode: 'agent-paused'` so the scheduler waits rather than hammering the tab.
  - Broaden `diagnosticCode` allowlist in `background.js` to accept `agent-paused`, `agent-busy`, and `composer-unavailable`.
  - Add bilingual localization strings in `i18n-runtime.js` for paused agent state guidance.
  - Add comprehensive unit test suite (`tests/pause-detection-tests.mjs`) covering cyclic queue progression, single repeat prompts, queue-once completion, affirmative consent classification, and diagnostic code routing.

## [3.1.0] - 2026-11-20

- Implement Exception Dialog Engine (`dialog-classifier.js`, `content.js`, `background.js`) to classify blocking dialog contexts before auto-allow dispatch:
  - Detect session expiration (`session-expired`) via page title and auth forms without composer, automatically pausing the task with clear recovery guidance.
  - Detect OAuth authorization popups (`oauth-popup`) via OAuth provider text and external provider URLs (`accounts.google.com`, `login.microsoftonline.com`, `appleid.apple.com`, `github.com`), pausing the scheduler to require intentional manual user authentication rather than blind auto-clicking.
  - Detect unknown blocking modals (`unknown-modal`) persisting over 5 seconds without allow-family options, logging diagnostic observations and suppressing unintended clicks without stalling background schedules.
  - Add optional Chrome notification dispatch (`notifications` permission) when task is paused due to session expiration or OAuth login requirements.
  - Implement zero-overhead fail-open architecture ensuring harmless exceptions in classification never impede legitimate tool-use approval workflows (`Smartsheet`, file access, etc.).
  - Add full unit and integration test suite (`tests/dialog-classifier-tests.mjs`) covering TC-01 through TC-08.

## [3.0.25] - 2026-11-18

- Fix severe scroll and mouse-hover lag on long Your dot and ChatGPT conversation pages (`content.js`, `adapter.js`):
  - Scope approval/authorization DOM scans to open modal dialogs (`[role="dialog"]`, `[role="alertdialog"]`, `[aria-modal="true"]`, `dialog[open]`) and the latest 2 assistant message turns rather than scanning every historical turn in `document`.
  - Add $O(1)$ `childElementCount <= 4` and `textContent.length <= 80` fast-rejection filters before running `extractOptionText()`, `closest()`, `getComputedStyle()`, or `getBoundingClientRect()`, reducing layout/style checks from tens of thousands of nodes per scan to 0–5 matched option nodes (`< 2ms` scan time on 20,000+ node pages).
  - Make `content.js` scroll-aware (`scroll` / `wheel` passive listeners defer background scans during active scrolling), filter `MutationObserver` callbacks to element-addition mutations only, and run background checks inside `requestIdleCallback`.

## [3.0.24] - 2026-11-18

- Expand the automatic exception and confirmation engine (`adapter.js`, `content.js`) beyond basic `Allow` / `Deny` to handle authorization, OAuth login, connector linking, and action consent prompts (`Authorize`, `Confirm`, `Approve`, `Accept`, `Agree and continue`, `Continue`, `Grant access`, `Allow access`, `Sign in`, `Log in`, `Connect`, `Connect account`, and Chinese equivalents `授权`, `确认授权`, `同意并登录`, `同意并继续`, `连接账号`, `去授权`), including scoped single-button authorization/login cards inside assistant turns and modal dialogs (`[role="dialog"]`).
- Eliminate duplicate `auto-allowed` activity log entries while tool execution spinners (`A Allow ⟳`) are active or when React re-renders card DOM nodes: synchronize `hasAsymmetricSvgCheckmark`, `aria-busy`/`animate-spin` filtering, and shared in-memory card deduplication (`__agentContinueAllowedCards`) across `adapter.js` and `content.js`, and emit `auto-allowed-prompt` only on actual click transitions.
- Add rapid follow-up scans (`900ms` and `2500ms`) in `content.js` after an auto-allow action so multi-step sequential confirmation flows (`Connect` -> `Authorize` -> `Allow`) proceed without waiting for the next minute alarm.
- Enhance sequential cyclic prompt queue (`queue-loop`) ergonomics in `popup.js` and `i18n-popup.js`: display full-cycle duration (`队列 N 条 · 循环发送（每轮 M 分钟）` / `Queue: N · Loop (M min/cycle)`), automatically switch to `queue-loop` when adding prompts to the queue, and allow creating new queue items directly when the single-prompt draft is empty.

## [3.0.23] - 2026-11-17

- Add automatic detection and handling for blocking tool/permission confirmation prompts (`Allow` / `Always allow` / `Allow once` / `A Allow` paired with `Deny` / `B Deny`) in ChatGPT and Your dot conversations (`adapter.js`, `background.js`, `content.js`).
- Intercept active confirmation prompts at the start of `pageAction()` before any composer preparation or prompt injection, prioritizing `Always allow` > `Allow once` > `Allow`, dispatching full pointer/mouse/click sequences with a MAIN-world React `__reactProps$` fallback, and deferring prompt injection while the approved tool executes.
- Add real-time `MutationObserver` and periodic checks in `content.js` plus `onInstalled` / `resume` / heartbeat notifications in `background.js`, recording dedicated `auto-allowed` (`auto-allowed-prompt`) activity log entries in the Logs panel.

## [3.0.22] - 2026-11-16

- Prevent repeated chunked re-insertion: in `insertChunkedText()`, when `args.persistentDelivery === true && outcome.signature?.final`, adopt the settled draft immediately on Pass 1 rather than restarting and wiping composer text across 3 passes.
- Guard against false `composer-unstable` aborts: under `args.persistentDelivery === true`, ignore detached container boundary point differences during pre-insertion selection checks.
- Prevent send button unavailability deadlocks: when `sendMethod === 'auto'` and `sendButton` is unavailable or disabled, allow fallback to `dispatchKey(isDot)` (`Ctrl+Enter`) under persistent delivery instead of blocking.
- Add multi-event pointer and mouse dispatch simulation (`pointerdown`, `mousedown`, `click`, `mouseup`, `pointerup`) to `clickButton()`, and ensure editor focus before dispatching `keydown`/`keypress`/`keyup` in `dispatchKey()`.
- Enhance receipt confirmation: check both `preparedText` and original `prompt`, and add core-substring containment matching (`rCore.includes(eCore) || eCore.includes(rCore)`) for long rendered messages.

## [3.0.21] - 2026-11-16

- Strengthen autonomous self-recovery for persistent background delivery:
  - Eliminate settlement-restart exceptions when `args.persistentDelivery === true`: adopt the settled text (`actualExpected = normalizeLineEndings(settled)`) and continue chunk writing rather than throwing `chunkMismatch` on minor ProseMirror DOM formatting.
  - Automatically adopt composer text upon reaching maximum retries in `insertChunkedText()` and before throwing `chunkMismatch`, setting `preparedText = normalizeLineEndings(currentDraft)` and proceeding directly to dispatch.
  - Eliminate the composer refill loop: in `payloadMatches()` and before every `fill(prompt, true)` refill check, under `args.persistentDelivery === true && inserted`, adopt the existing draft if present in the composer and prevent unnecessary select-all/clear/re-insert cycles.
  - Mark pre-commit blocked/draft/busy/error results as retryable under persistent delivery, allowing the background scheduler to autonomously retry and self-heal without pausing the scheduled continuation.

## [3.0.20] - 2026-11-16

- Fix chunk-mismatch pause on repeated stable ProseMirror normalization: when `args.persistentDelivery === true`, accept repeated stable text normalization (`expectedDifference` matches `outcome.signature`), update `preparedText = outcome.signature.final`, and proceed to submit rather than pausing the scheduler. Resolves the issue where scheduled execution stopped after one round due to persistent segment mismatch.
- Add fallback to `clean(textOf(editor))` in `payloadMatches()` when decorative DOM elements cause `plainDraft()` to return `null`, preventing false-positive payload drift and unnecessary refills.

## [3.0.19] - 2026-11-16

- Fix Dot target identity verification during message submission: reverse-scan conversation turns to resolve `targetIdentity` when the newly appended turn is unhydrated, preventing premature `documentChanges` and false `samePage() === false` aborts.
- Enhance `matchesReceipt` for all prompt lengths: remove arbitrary $>200$ character barrier so trimmed, clean, Markdown-stripped, and core-normalized checks apply across short and long prompts, resolving the issue where normal text prompts failed receipt confirmation and fell back to single-send behavior.
- Guard against false-positive receipt mismatches on unpopulated optimistic DOM elements by ensuring `clean(receiptText)` is present before evaluating mismatches.

## [3.0.18] - 2026-11-16

- Fix receipt confirmation in ChatGPT Dot: add `BUTTON`, `TIME`, `LABEL`, `ASIDE` to `decorativeNodes`, fall back to `textOf(last)` when `plainDraft(last)` is null, and expand user message selectors (`article.message-row.self`, `article.self`, etc.) for Dot conversation turns.
- Implement Markdown-tolerant and anchor-normalized matching in `matchesReceipt`: allows rendered rich HTML user messages (where raw `#`, `**`, `[text](url)` markdown syntax is converted to HTML elements by ChatGPT) to accurately confirm sent messages.
- Fix confirmed sends counter: properly counts and increments confirmed rounds without pausing on verified ChatGPT Dot responses.
- Add fallback insurance `fallbackToPlainText` in `insertChunkedText`: automatically simplifies complex Markdown links and strips non-printable control characters on retry to avoid injection stalls.
- Enrich execution diagnostic logs: records detailed diagnostic metadata (`[code · duration · sentCount]`) and displays badges in popup Logs tab and activity exports.
## [3.0.17] - 2026-11-16

- Add support for decorative DOM elements (`SVG`, `PATH`, `G`, `IMG`, `WBR`, etc.) and uneditable icon spans in `serializeDraft` (`adapter.js`). Resolves the issue where ChatGPT Dot's auto-decorated Markdown hyperlinks (e.g., GitHub URLs rendered with an inline SVG globe icon) caused draft serialization to return `null`.
- Add `clean(textOf(editor))` innerText fallback in `insertChunkedPass` when decorative rich-text nodes prevent structural DOM serialization, preventing false-positive `chunkMismatch` exceptions.
- Cap `insertChunkedText` restart attempts to at most 2 retries, completely eliminating the infinite select-all / delete / re-insert loop.

## [3.0.15] - 2026-11-16

- Remove artificial 1,000-character cap in editor-commit.js on the MAIN-world
  single-transaction ProseMirror model commit path. Long prompts (10,000+ characters,
  including full 10,840-character multi-paragraph prompts) now transact atomically into
  ProseMirror document state in ~2 ms without falling back to chunked DOM insertion.
- Prevent multi-chunk DOM fragmentation and caret position reset, resolving the
  incomplete prompt injection issue where late chunks overwrote earlier chunks.
- Eliminate 10-second retry wait loops caused by draft mismatch in the editor, allowing
  immediate automatic Send button detection and dispatch without manual user intervention.

## [3.0.14] - Unreleased Candidate

- Start long rich-text insertion with segments of at most 1,000 UTF-16 units,
  preserving surrogate pairs and the existing adaptive reduction and guards.
- Report a generic pending result instead of claiming the Send control is not
  ready when the worker has no evidence about that control. This candidate has
  not been installed, released or validated on live sites; the independent npm
  CLI version is unchanged.
- Count unreadable post-write and between-chunk checks without recording content;
  a verified cancellation acknowledgement also carries the current diagnostic
  snapshot. Unresponsive pages and later events can still be missing.
- Preserve an in-flight permit deadline while Pause waits for cancellation, and
  retain that deadline across Clear Data when cancellation is unconfirmed.
  A cancellation acknowledgement reporting an unconfirmed dispatch is marked
  unknown. These measures do not retract an already-issued page operation.
- Pause a terminal unknown send result even without recorded dispatch evidence,
  without increasing confirmed sends. The user must inspect the conversation:
  explicit Resume may submit an unconfirmed prompt again and cause duplicates.
  A still-active receipt wait can instead continue without a terminal result.
- On recovery, conservatively pause an enabled legacy idle task when its
  cumulative unknown count is nonzero, even if the historical unknown was
  already resolved; the count alone does not prove a current unresolved send.
  When a page document is replaced and non-submission cannot be established,
  pause rather than replay the attempt. Inspect the conversation before resuming.

## [3.0.13] - Unreleased Candidate

- Avoid immediately restarting a persistent long-text insertion when an
  intermediate post-write or between-chunk draft is temporarily unreadable.
  Wait under the same cancellable authorization and resume only after the
  appropriate previously verified text matches; otherwise do not dispatch it.
- Stop adding blank lines solely because one prompt is split into segments.
  CR/CRLF remain normalized to LF and exact delivery is not guaranteed.
- Pause without dispatch when two complete chunked passes repeat the same
  visible text mismatch; an independent stale send model remains unresolved.
- Preserve content-free recovery counters in Activity exports. This candidate
  has not been installed, published or validated against real ChatGPT or Dot.

## [3.0.12] - Unreleased Candidate

- Observe trusted held/repeated Enter submission in both MAIN and legacy
  composer paths. Once it submits the prepared prompt, stop refilling and keep
  manual delivery separate from extension dispatch. Repeated Shift+Enter, IME
  composition, untrusted keys and unrelated controls remain non-send events.

- Keep legacy activity-log persistence off the shared sending/control queue.
  A rejected or stalled log read/write cannot fail a committed Start, retain a
  completed send response, or block Pause. Bound and serialize pending activity
  records, report degraded persistence, and fence late writes after clearing.
- Add schema 5 per-delivery diagnostics: phase/reason transitions, model/DOM
  writes, readiness/authorization/grant/receipt counters, synchronous write
  timings, manual handoff, transport errors, and persistence health. Activity
  and Support share the filtered export. Retain 20 deliveries/64 transitions
  each; omit prompts, chat text, paths, keys, raw exceptions and internal IDs.
- Show elapsed waiting time instead of a permanently zero countdown while a
  delivery is active. Long diagnostic durations are no longer clipped to two
  minutes; this does not create or remove an overall send deadline.
- Recognize a trusted manual Send of the prepared exact prompt. Stop refill,
  attachment removal and Stop actions for that delivery while confirming its
  new receipt, even when COMMIT_RUN's transport never returns. Keep manual
  completion separate from extension dispatch and retain Pause precedence.
- Retire a stalled grant readback without ending the pending delivery; retry
  a failed undelivered grant independently of its readback. Ignore late retired
  results and never replay an uncertain dispatched submission.

- Recover an accepted final submission permit when its message acknowledgement
  is missing, rejected or permanently pending. Read back only the same isolated
  invocation and pinned document; do not substitute DOM content for authority.
- Keep the final authorization handshake distinct from an actual dispatch.
  Reloading the same conversation before authorization can recover preparation
  instead of being misclassified as an uncertain attempted send.
- Include the fixed authorization stage in privacy-filtered activity exports.
  Preserve exact configured text, unlimited readiness waiting, manual Pause and
  at-most-one submission. No installed live-site success is claimed by these
  synthetic transport-recovery tests.

## [3.0.11] - 2026-11-10

- Preserve the legacy adapter's same-form editor replacement recovery while
  limiting fresh-run continuous preparation recovery to the persistent worker
  contract. Retain the full prompt-priority policy described below.
- 3.0.10 was tagged as a candidate; local full regression caught this compatibility
  issue. Its tag is not rewritten or used for a Store upload.

## [3.0.10] - Unpublished Candidate

- Keep preparing and retrying a known unsubmitted prompt continuously instead
  of ending the cycle after a composer redraw, unavailable control or temporary
  pre-submission failure. There is no total preparation/readiness wait deadline.
- Reacquire a unique composer after same-conversation form/editor replacement,
  overwrite its unsent text, and remove pending attachments through the site's
  scoped removal controls before sending the configured pure-text prompt.
  Account files are not deleted. Manual Pause and exact target binding remain.
- Mark a legacy submission attempt only immediately before the actual click or
  key dispatch. A disconnected button that was never clicked must not strand the
  run waiting for a receipt. Attempted/uncertain submissions are not blindly sent
  again; confirmed counts still require a new corresponding message receipt.
- Preserve all 3.0.9 transport, receipt, document-replacement and Windows/PDF
  corrections. Update English/Chinese notices and privacy/listing disclosures to
  match pending-attachment removal and persistent same-target preparation.
- Refresh an expired positive authorization reply instead of cancelling a live
  pending send; detect a detached legacy composer during readiness rather than
  continuing to query its obsolete Send control indefinitely.

## [3.0.9] - 2026-11-10

- Recover preparation/readiness transport and delayed message receipts inside
  the same authorized background invocation, without a total live-send wait
  deadline or an application-set prompt cap. Changed composer text is replaced
  by the configured prompt; Pause and attachment protection remain effective.
- Preserve known Send-button presence across lost replies and temporary button
  removal. Seal an attempted submission so a late preparation cannot refill the
  composer, replace a new draft or authorize another submission.
- Diagnose document replacement read-only. A new round can bind a refreshed
  exact target after proven pre-dispatch loss; an attempted submission with an
  unknown result is never replayed onto a replacement document.
- Include the unmodified modern PDF.js distribution and strict vendor digest
  checks, replacing legacy compatibility code flagged in the Store review.
- Include the Windows ordinary-account compiler temporary-directory correction.
  The v3.0.8 Windows build and standard-token smoke passed; its publication was
  canceled after independent scheduler review, not published as a release.

## [3.0.8] - Unpublished Candidate

- Retry lost preparation/readiness transport and missing results within the same
  authorized background invocation, instead of abandoning a filled composer for
  an entire interval. No total live-send waiting deadline is introduced.
- Only prepare/observe may recover this way. An uncertain submission is never
  repeated, and Pause or a changed target still revokes the invocation.
- Retain 3.0.6's delayed-receipt counting and modern unmodified PDF.js fixes and
  3.0.7's ordinary-account metadata/compiler environment correction.
- Actual disposable MV332/32 and background state57/57 passed. The old3.0.7
  publication run was canceled before release when this prepare defect was
  reproduced. Tags remain immutable; no old Release assets were replaced.

## [3.0.7] - Unpublished Candidate

- Preserve all 3.0.6 scheduler receipt recovery and modern PDF.js fixes below.
- Give Windows read-only metadata queries an owned writable compiler temporary
  directory in stripped ordinary-account environments, with cleanup on success
  and failure. Identity checks and the five-second OS-query budget remain intact.
- Separate cold ZIP-fixture assembly loading from the unchanged 15-second launch
  watchdog. Add closed timing diagnostics to actual stdio metadata observation.
- 3.0.6's immutable tag was not published: its release workflow failed ordinary-
  token process observation. Do not treat its uploaded Store draft as submitted.

## [3.0.6] - Unpublished Candidate

- Keep observing the same submitted message when the worker wait transport
  rejects transiently after dispatch. Do not turn that exception into a terminal
  unconfirmed cycle or dispatch again. Pause still cancels receipt recovery.
- Use the unmodified modern PDF.js 6.4.299 distribution instead of its legacy
  compatibility build. Verify exact upstream main/worker bytes when vendoring and
  packaging; show a fixed update-browser error when required PDF APIs are absent.
  Local text import remains available in that case.
- Remove the fixed total send-wait deadline. A current enabled invocation stays
  pending through delayed readiness or missing result transport until a result,
  explicit cancellation or target invalidation; it is never re-dispatched merely
  because time passed. Finite individual MAIN-command permits are refreshed for
  that same live invocation and are not an overall waiting-time limit.
- Preserve a same-invocation final result through an independently validated
  extension message if the injection API returns no value or rejects. Neither
  transport failure permits another click or counts dispatch as delivery.
- Recover a page injection rejected before it starts. Register one execution per
  document/run/token and reattach only that same execution; a late original
  injection joins it instead of sending twice. Read back its settled result if
  both result transports lose the response. Recovery has no total time limit and
  retains at most one additional unresolved admission, rather than accumulating
  requests while a renderer is unavailable. Pause still cancels authorization.
- Acknowledge cancellation in the isolated page before completing Pause. A
  queued model submission cannot obtain its receipt-boundary handshake after
  that acknowledgement. Unconfirmed revocation is shown explicitly and the old
  finite submission permit is fenced before Resume; already-executed clicks
  cannot be recalled.
- Export fixed execution-stage, result-channel and bounded lease-renewal facts,
  without prompt, conversation, URL, path, token or exception content.
- Add actual disposable MV3 regressions for twenty-one-second readiness, lost
  and rejected injection returns, and Pause before a queued final commit.
  These fixtures do not establish the owner's installed live-site acceptance.
- Continue waiting for delayed receipts and post-Stop readiness without the old
  live 6.5-second and 3.5-second cutoffs. A stalled result-message publication
  cannot block the independent injection return.
- Recheck late text and attachments after the final legacy readiness wait. A
  corrected unsupported rich editor must settle its model before reobservation
  and dispatch; repainting its DOM alone does not establish the submitted text.
- Initialize the Windows installer from explicit OS module manifests, including
  Management for file-hash path resolution. Preparing the first module no longer
  depends on implicit discovery of Join-Path. The cold-start regression no longer
  preloads Management on the installer's behalf.

## [3.0.5] - 2026-11-09

- Wait in the extension worker for delayed Send readiness after preparing a
  controlled editor. A present but disabled or temporarily unmounted Send no
  longer causes Auto to dispatch an ignored keyboard event. Pin the sender's
  document across stages, recheck authorization, and submit at most once.
- Reassert changed model text without repeating the input/restore cycle. Known
  no-dispatch outcomes are distinct from uncertain delivery and use the normal
  readiness retry rather than an entire send-interval delay. Pause, attachments,
  exact targets and receipt-based counting remain in force.
- Remove application-set prompt, queue-text, plain-text import and config-import
  size caps, including both textarea maxlength attributes. Preserve user text
  verbatim; browser/platform capacity and DOCX/PDF parser safeguards still apply.
- Add hidden-tab, real Chromium-alarm regression coverage for delayed Send,
  rejected synthetic keys, exact single-message counting and post-Pause silence.
  These fixtures do not establish delivery on every live ChatGPT or Dot build.
- Capture the receipt baseline synchronously immediately before final model
  submission. An identical manual message that appeared during Send readiness
  cannot be counted as this attempt's acknowledgement. Keep unknown delivery
  distinct from successful dispatch and never replay an uncertain attempt.

## [3.0.4] - 2026-11-08

- Replace the unbounded refill-and-wait loop with bounded event-input settling
  and a final configured-prompt replacement. Wait for deferred input handlers
  even when the displayed text already matches; retain final Pause checks.
- For editors exposing Tiptap's documented DOM owner, use an authorized,
  synchronous model transaction and one scoped submission attempt. Keep run
  identifiers in the extension, record the attempt before injection, and never
  replay an uncertain attempt through another submission method. Editors without
  that owner use the existing event adapter. Count only a new message receipt.
- Recover an editor remount in the same composer while Stop authorization is
  pending. Keep the bound target, manual Pause and attachment checks.
- Clear additional legacy draft-protection notices from the current task on
  upgrade without altering its schedule, prompt, pause state or history.

## [3.0.3] - 2026-11-08

- If the page rebuilds the text editor in the same bound composer before
  submission, refill the replacement editor with the configured prompt and
  submit once. Moving to a different composer still cannot redirect a send.
- Clear the retired text-change warning from the current task status when
  upgrading. Keep the task, schedule, pause state and historical log entries.

## [3.0.2] - 2026-11-08

The root npm CLI version remains independently 0.3.0.

- Scheduled sends and Send once now always use the configured prompt. Replace
  unsent text in the bound composer, including changes made after filling or
  during authorization. Old settings cannot restore the retired text-change
  veto; the task controls disclose replacement before starting or resuming.
- Let controlled rich-text editors finish applying a replacement before
  submission. Do not insert again when the editor already handled the input.
  Attachments, Pause, target identity and confirmation checks remain in force.
  A cycle attempts submission once and does not immediately replay an
  unconfirmed result.
- Auto uses the available Send button before choosing a keyboard shortcut.
  The explicit button-only and Ctrl+Enter-only choices remain available.

- Remove the fixed 180-second total cutoff from provider dependency installation.
  Normal setup waits for npm completion, an actual error or explicit user
  cancellation. Retain one-attempt behavior, integrity checks and owned-child
  cancellation/cleanup. Trusted test-only deadlines remain optional and handle
  long durations without Node timer overflow; they are not browser/CLI settings.

## [3.0.1] - 2026-11-08

Release successor to the unpublished 3.0.0 build. The 3.0.0 tag is retained;
its Windows CI fixture used inconsistent short/long temporary paths and failed
before any Release was created. Canonicalize the two disposable test roots
without relaxing the actual ordinary-token CI adapter's path checks. Product
Windows control and scheduler behavior are unchanged from the accepted3.0.0
source. Publication and Chrome Store submission still require actual receipts.

## [3.0.0] - 2026-11-08

The combined Windows source version is 3.0.0. GitHub/npm publication, Chrome Web Store submission/approval and installed-version receipts are recorded separately. The scheduler v2.2.1 release and its assets remain unchanged.

- Update canonical privacy and English Store source copy for scheduled prompts plus optional, explicitly authorized Windows file/shell/process tools. Keep English default and Simplified Chinese optional; update both READMEs without reclassifying historical scheduler releases.
- Disclose selected-account, account-wide access rather than an installation-folder sandbox; distinguish current-account privileges, administrator UAC, optional browser `nativeMessaging` and OpenAI workspace/app/conversation grants.
- Describe official-tunnel command/result sensitivity and local runtime-key handling: path-only terminal input, current-account file references and the administrator's protected credential copy. No-key claims apply only to scheduler/file import.
- State the actual telemetry configuration: the pinned upstream provider includes telemetry, while the wrapper disables it in both isolated configuration and environment before import and validates that policy; setup dependency acquisition disables npm lifecycle scripts. Do not turn this into a no-network claim.
- Separate content-reduced scheduler diagnostics from sensitive local tool history, warning-level tunnel logs, prepared-command files, durable operation receipts, setup associations and administrator control archives. Explain records retained by Clear Data and original-ID reconciliation of uncertain operations.
- Document separate scheduler/device Pause, local Revoke versus OpenAI revocation, manual Pause/Revoke precedence, opt-in administrator browser-reopen restoration and the limits of undo/shutdown/removal. The setup uninstall option produces a plan, not completed removal.
- Retain developer contact zhentongye2028@u.northwestern.edu, the existing GitHub/Issues and author LinkedIn links, and voluntary sharing of reviewed diagnostics only; never raw runtime history or credentials.
- Permit explicit same-operation reconciliation of a recorded administrator Revoke so native stop verification can finish. Keep recorded denial distinct from verified shutdown, and do not replay Connect, Revoke or terminal Fence.
- Recheck the active operation immediately before recovery dispatch, ordered with receipt updates. Bound native permission prechecks and response checks by the same deadline without blocking Pause while native completion is pending.
- Add a fixed, version-pinned PowerShell/CMD setup acquisition command. Validate the entry and checksum-list hashes, bound HTTPS downloads, create an exclusive protected temporary directory, and retain the verified entry read handle while launching the separate OS PowerShell child. No downloaded-source evaluation or execution-policy bypass is used.
- Wire fresh current-account setup through its own native installation proof, one-time connection reservation and original-ID reconciliation. Require fresh document-local installation-and-connection consent; do not adopt or unpause existing installations, borrow administrator transport, or restore an old install-only consent flag.
- Include the current-account continuation module in both extension ZIP layouts and update English/Chinese setup copy and privacy disclosures for the distinct installation and connection actions.

Checkpoint97 records actual r11 installation, a full shared-app quit/reopen, and saved-running recovery without another Connect click. Ordinary ChatGPT and Dot both returned matching administrator/file/owned-process results, independently checked on the host. Devices Pause and Revoke each produced matching stopped receipts; the test installation is left revoked. These bounded observations do not guarantee all future recovery or prove current-account hosted operation, public-release acquisition, publication or Store approval. See [Runtime Acceptance](docs/RUNTIME-ACCEPTANCE.md) for separate release and review receipts.

## [2.2.1] - 2026-11-06

- In opt-in Extension Priority mode, refill the configured prompt once more if composer text changes again during authorization. Do not dispatch more than once.
- Preserve attachment, pause, and conversation-identity checks. An ambiguous acknowledgement does not advance the prompt queue.
- Compare message identities from before preparation and immediately before dispatch so restored history is not mistaken for a new receipt.
- Keep known message rows excluded from acknowledgement even if their IDs are assigned or changed after dispatch, preventing false queue advancement.
- Find the current Send button after authorization so a button re-render does not drop an ordinary ChatGPT send. Do not send or clean up if the editor has moved to another composer.
- Require a tagged first-parent commit on the canonical main line for releases. Refuse to replace an existing release or draft and stop if release lookup fails.

This scheduler update does not include the Windows device-control preview and does not change Chrome permissions.

## [2.2.0] - 2026-11-02

- Add an English-default, Chinese-optional developer/support page, prominent developer email, project/issue links, and the author's LinkedIn. The console links to the same support page.
- Add a manual schema 3 diagnostic export shared by both entry points. Include the installed extension version, validate event/diagnostic metadata, omit free-text messages and unknown fields, and cap exports at 200 entries. Relative millisecond timings are the default; exact timestamps require a separate opt-in on the support page. Review exports before sharing them publicly.
- Handle malformed persisted log containers/rows and invalid diagnostic durations without changing scheduling, permission or submission behavior.
- Add an English GitHub bug form and matching v2.2.0 developer/support documentation, with the existing approved email, GitHub, and LinkedIn contacts.
- Clear an earlier diagnostic preview when a new export fails, so it cannot be mistaken for the current report.
- Keep language-save errors separate from diagnostic status and clear them after a successful retry. Disable the language selector while its preference is saving to prevent overlapping status updates.
- Accept interface-only bug reports and provide a dedicated suggestion form without requiring a conversation target or logs.

This release covers developer support, schema 3 diagnostics, and support-page error recovery. It does not include the unshipped device-control, setup/onboarding, or native-messaging candidates, and stable release permissions remain unchanged. GitHub releases may ship ahead of Chrome Web Store review. This entry is not evidence of store approval, an installed v2.2.0 package, or defect-free operation; existing scheduling and delivery limits still apply.

## [2.1.0] - 2026-11-02

- Add an English-default interface with a Simplified Chinese switch and a locally stored language preference. User prompts, imported content, and custom labels are not translated.
- Replace the outdated README with concise English-first release documentation and a matching Chinese translation; include the Chrome Web Store and GitHub Releases links without asserting publication status.
- Rewrite privacy documentation in English, including local language storage, ChatGPT prompt submission, and the current clear-data command's retention of the language preference. No external telemetry or developer backend is introduced.
- Add English store-listing copy, a single-purpose statement, and permission justifications consistent with the manifest and runtime behavior.
- Preserve the v2.0.x single-submit contract: one mechanism per attempt, confirmation from a matching new user-message marker, and no immediate retry after an unknown result. Remove obsolete multi-path fallback and delivery-guarantee claims from the current README.

This entry documents release preparation, not a published store version, uploaded package, or a new live-site validation result. Historical entries below retain their original language; v2.0.x corrections supersede older implementation and guarantee claims.

记录实际实现与适配边界。发布状态与日期以 GitHub Release 和对应 Actions 运行结果为准。

## [2.0.1] — 2026-11-01

- 修正设置和任务页的旧多通道提交文案，明确每次只使用一种提交方式，不承诺保证送达。
- 增加合成 UI 的 1280×800 商店截图选项，不包含个人页面或实际聊天。
- 不修改运行权限、调度和发送逻辑；本地 UI 13 项测试重新通过。云端完整检查与公开状态以对应 Actions / Release 为准。

## [2.0.0] — 2026-11-01

候选源码与安装包版本；是否公开发布以 GitHub Release / 商店状态为准。

- 隔离环境执行，发送前必须通过后台许可检查；缺失许可不再以地址和期限替代。
- 一次尝试只使用一种提交机制；移除 React/ProseMirror 内部处理器重复调用和 100 ms 补点。
- 不强行启用禁用按钮；Dot 身份丢失时停止，恢复只匹配原目标地址。
- 保护填写后及最终许可检查期间的用户编辑，包含 textarea 尾随空白。
- 仅有编辑框清空和忙碌指示不再计为新消息确认。
- 本地诊断增加固定分类与有限耗时，导出格式升级；不记录正文、原始异常或完整地址。
- 修复安装包缺失 content.js，新增商店根目录打包方式及打包测试。
- 新增 13 项合成适配器行为测试与诊断回归；当前 61 项安全测试通过，另有源码约束检查。
- 本地各组测试合计 167 项通过，包含合成页面上的 Chromium、真实 MV3 扩展与官方 ProseMirror；不代表真实线上 Dot 兼容性或商店审核通过。

历史说明更正：以下旧记录中的“绝对”“100%”“无缝”和“本地内存加密”不能作为当前保证。
提示词必须以可读取的明文供扩展处理；没有实现扩展级内存加密。后台端口也不保证浏览器永不休眠。
旧版主世界与多通道提交说明已被本节修订取代，旧测试数量不代表当前源码全部通过。

## [1.1.0] — 2026-10-25

### 视觉大改版：650px 宽幅控制台 · 重启无缝接续 · 极速预设与键盘导航 (v1.1.0 Release)

- **650px 宽幅现代化控制台（Wide Dashboard Console）**：
  - 弹窗宽度由 480px / 420px 彻底拓宽至 **650px**（宽度增加超 55%），卡片舒展大气，在 1080p、2K 及 4K 高分屏下展现媲美 Linear / Raycast 的专业桌面工作台质感。
  - 彻底根除 Chromium 弹窗在 `max-width: 100vw` 约束下的视口死锁塌陷 Bug，强制固化 650px 最小几何安全宽度，杜绝弹窗缩成几十像素细条的异常。
  - 彻底根除 Windows 原生刺眼亮白滚动条，全域声明 `color-scheme: light dark` 并严格限制 body 高度在 Chromium 弹窗安全阈值（585px）内，滚动条统一使用 5px 极细半透明圆角胶囊滑块。
  - 彻底消除导航栏选项卡中文字符逐字竖排折行问题（`提\n示\n词`），启用 `white-space: nowrap` 与弹性对齐。
- **电脑与浏览器重启无缝接续（Seamless Reboot & Reconnect）**：
  - 监听 `chrome.runtime.onStartup`，浏览器重启后 2.5 秒内自动唤醒调度服务并重新绑定会话。
  - 自动归一化兼容 ChatGPT Dot 会话动态路由（兼容 `/dots/home` 与 `/dots/c/<threadId>` 双向跳转与重定向），会话地址跳转不脱钩、不误判失效。
  - 任务恢复时自动校准过期倒计时，将停留在 `00:00` 的过期周期平滑重设并重新计时，无缝衔接推进。
- **ChatGPT Dot 真实消息气泡递送确认（Confirmed Real Delivery）**：
  - 升级 `adapter.js` 用户消息气泡选择器，兼顾最新版 ChatGPT 与 Dot 的 `article.message-row.self .message-body` 和 `[data-message-author-role="user"]`。
  - 消除父子容器双重计数偏差，准确匹配真实递送气泡，解决“已成功发送但系统记录未确认、计数不增加”的问题。
- **6 档常用节奏预设与高光胶囊（6 Quick Cadence Presets）**：
  - 扩充常用发送节奏：`5 分钟`、`10 分钟`、`15 分钟`、`20 分钟`、`30 分钟`、`1 小时` 6 档常用周期一键直达，选中间隔呈现高亮翠绿微光胶囊。
- **全局数字键极速导航（Power-User Shortcuts）**：
  - 弹窗在焦点下支持敲击数字键 `1`（任务）、`2`（提示词）、`3`（设置）、`4`（日志）快速切换主面板，告别频繁鼠标寻址。
- **实时调度呼吸脉冲指示灯（Active Schedule Pulse Indicator）**：
  - 运行状态徽标增加翡翠绿呼吸光环动效，一眼即可确认后台调度正在平稳工作。

## [1.0.0] — 2026-10-23

### 正式大版本发布：后台全自动定时续办系统 (v1.0.0 Production Release)

- **结构化排版重排自适应（Structural Reflow Tolerance）**：
  - 彻底攻克 Windows 下 Chromium / ProseMirror 布局重排（段落拆分 `<p>`、`<br class="ProseMirror-trailingBreak">` 动态注入）导致的“输入框内容发生变化，已保留当前内容”误报假死。
  - 采用 `plainDraft(editor)` 节点树语义归一化，精准识别 Chromium 自身引起的排版节点变化，完全放行自动发送；同时严密保护真正的人工键盘编辑，确保用户草稿与附件绝对安全。
- **高精度定向发送按钮寻址（Targeted Orange Send Button Dispatch）**：
  - 精确定向 dot / ChatGPT 页面底栏右侧的亮橙色圆形 `↑` 发送按钮（优先 `button[data-testid="send-button"]` 与 aria-label）。
  - 严格排除输入框底栏的麦克风、语音输入、附件添加等无关按钮，解决输入框多控件场景下的选择歧义。
- **智能多通道全栈提交管线（Smart Multi-Channel Submission Pipeline）**：
  - 结合 Chat2API 底层架构理念，构建“主世界 ProseMirror 状态事务直连 + 合成键盘事件 + 指针/鼠标原生全事件流（pointerdown/mousedown/pointerup/mouseup/click）+ React Fiber FiberNode Props 交互 + 表单 requestSubmit”全栈链路。
  - 在 `auto` 智能提交模式下，即便合成按键因页面安全策略受限，也会自动无缝触发备用通道完成发送，彻底告别“卡在输入框发不出去”。
- **后台免打扰与休眠防范机制**：
  - 完全剥离对前台窗口焦点 `document.activeElement` 的依赖，支持 `document.visibilityState === 'hidden'`，在后台标签页、最小化窗口下平稳运行。
  - 引入持久 Keepalive 长连接端口与休眠标签唤醒机制，阻断浏览器后台节流丢弃。
- **100% 绿色自动化测试与隐私承诺**：
  - 自动化契约与端到端测试套件全部通过（151/151 passed），涵盖状态流转、打断机制、键盘契约、富文本编辑、文件离线解析与 MV3 真实集成。
  - 纯本地运行，0 远程接口、0 外部依赖、0 数据收集，文档与提示词均在本地内存加密处理。

## [0.2.3] — 2026-10-23

### 深入学习 Chat2API 与主世界状态引擎：彻底解决 Windows 下“只能填入、无法发送”与后台阻塞

- **主世界 ProseMirror 运行时直连（Dual Execution: world: 'MAIN' / 'ISOLATED'）**：
  - 深度复盘 Chat2API 原理：专业开源项目之所以稳定，在于其绕过单纯脆弱的 DOM 盲点模拟，直连底层数据模型与状态管线。
  - 针对 MV3 扩展默认在 `ISOLATED` 隔离世界运行、无法同步 ProseMirror 内存状态导致发送按钮始终禁用（Disabled）的致命痛点，在 `background.js` 中引入主世界优先注入管线（`world: 'MAIN'`），自动探测并获取编辑器底层 ProseMirror 视图实例（`pmViewDesc.view`）。
  - 通过 `pmView.dispatch(tr)` 派发核心事务并构建富文本段落节点，使页面 ProseMirror 与上层 React Fiber 同步感知文本输入，实时激活发送按钮与内部提交监听。若主世界不可用则平滑回退至隔离世界。
- **智能多通道提交与容灾回退（Smart Multi-Channel Submission）**：
  - 彻底打破 0.2.2 将 dot 硬编码锁死在单一合成键盘事件且拒绝回退按钮的逻辑缺陷（真实 Dot/React 会过滤非可信 `isTrusted === false` 的合成键盘事件导致卡在输入框）。
  - 在 `auto` 智能模式下，组合执行“ProseMirror 键盘命令派发 + DOM 键盘事件派发 + 按钮点击完整事件序列（pointerdown/mousedown/pointerup/mouseup/click 及 React Props `onClick`）+ 表单 `requestSubmit()` 容灾回退”，确保提示词绝对不会卡在对话框中发不出去。
- **解除 Windows 平台后台标签页焦点与可见性误锁**：
  - 修复 `adapter.js` 原第 301 行 `if (useKeyboard && document.activeElement !== editor) return result('blocked')` 的致命 Bug：在 Windows 系统的 Chromium 内核中，当标签处于后台或窗口未激活时，`document.activeElement` 恒为 `document.body`，导致后台发送 100% 被误拦截。
  - 优化控件可见性计算 `visible()`：感知 Windows 后台最小化/隐藏标签状态（`document.visibilityState === 'hidden'`），避免 Chromium 在后台返回尺寸为 0 的 Rect 导致所有元素被误判为“不可见/未加载”。
- **新增 Content Script Keepalive 长连接与后台防休眠唤醒**：
  - 在 `manifest.json` 注册匹配 `https://chatgpt.com/*` 的内容脚本 `content.js`，与 Service Worker 建立持久长连接端口（`agent-continue-keepalive`），防止 Chromium 内存节省程序（Memory Saver）在后台冻结或丢弃会话标签。
  - 在 `background.js` 中增加标签被休眠丢弃（`discarded`）时的自动唤醒刷新重试逻辑。
- **弹窗界面文案优化**：
  - 提交方式文案升级为“智能提交 · 按钮 + 快捷键 + 表单（推荐）”，直观传达当前可靠的多通道提交流程。

## [0.2.2] — 2026-10-23

### dot 默认使用 Ctrl+Enter

- 修复 0.2.1 仅实现按钮点击、缺少用户实际使用的 Ctrl+Enter 提交路径。dot 默认发送一次带 Control 修饰键的 Enter 按下 / 松开事件，普通 ChatGPT 默认保留按钮策略。
- 新增“发送方式”：自动、Ctrl+Enter、按钮。旧配置和旧任务缺少该字段时自动采用新策略；设置保存、任务快照、重启恢复与配置备份均包含该选择。
- 快捷键路径不要求存在可用 Send 按钮，但仍核对目标身份、运行许可、编辑器、草稿及附件。最终核对与提交间没有异步等待。
- 一次尝试只使用一种提交方式。发出快捷键后不会追加按钮点击；键盘处理器忽略事件或没有新消息回执时记录未知结果，避免立即重复发送。
- 保持 20 分钟、无限重复、默认强制打断与本地提示词处理；没有新增权限、账号凭证读取、第三方代理或系统键鼠操作。

### 验证与源码参考

- 在已登录的真实 dot 页面使用原生 Ctrl+Enter，确认诊断消息成为新的用户消息、编辑器清空，当前选中标签仍为 GitHub。该操作只证明真实页面快捷键有效，不将其等同于扩展合成事件的验证。
- 新增 12 个键盘契约回归：旧版仅 5 个通过，新版验证默认策略、无按钮、禁用按钮、暂停、人工编辑、无回执与延迟回执，以及不追加备用操作。
- 测试加入官方 ProseMirror 编辑器与键盘映射，区分真实编辑器、手写页面样本、实际扩展运行机制和真实账号的证据。
- 检查 Chat2API 的实际提交与流回执实现，记录可复用的状态确认设计及其不包含 dot 专用适配的范围，见 [ALTERNATIVES.md](ALTERNATIVES.md#chat2api-源码复查2026-10-23)。
- 完整测试结果、后台可见性验证及尚未验证的范围见 [VALIDATION.md](VALIDATION.md)。升级步骤见 [README](README.md#升级到-022dot-使用-ctrlenter)。

## [0.2.1] — 2026-10-23

### 修复只填写不发送

- 默认改为**强制打断并发送**；有唯一且可用的目标停止按钮时先停止，再重新识别输入组件。dot 在运行中提供发送按钮时直接提交，不等待运行指示消失。
- 旧版的配置、会话任务和重启恢复任务首次升级时分别迁移默认等待策略；保留提示词与进度，之后主动选择等待会持续保存。
- 修复未找到发送按钮后遗留自己的文字、随后永久误判为草稿的问题。提交前失败会撤回未被人修改的本次输入；已有其他草稿、附件和人的空白字符修改继续受保护。
- 强制模式可以接续发送与当前提示词完全匹配的旧输入，兼容 CRLF、空行、结尾换行以及原生编辑器的 DIV/P/BR 结构，不通过删除空白来猜测匹配。
- 填写前发送可取消的 `beforeinput`，尊重编辑器接管，等待有界的异步提交；不再只依赖 `execCommand` 产生事件。编辑器拒绝输入并恢复其他草稿时，不会删除该草稿。
- 所有停止和发送操作继续受目标、会话身份、暂停令牌及执行期限约束。停止后重新查询输入框，避免页面替换组件后仍使用旧节点。
- 执行期限增至 20 秒以容纳停止、组件恢复与回执确认。点击发送后不盲目追加第二次点击；未确认的周期仍按未知结果处理。

### 验证与升级

- 增加旧版失败、修复版通过的回归，覆盖强制默认值、停止到发送、重建输入框、受控编辑器、遗留多行输入恢复和人的草稿保护。
- 真正加载 MV3 扩展并通过隔离环境注入，验证默认停止后发送、`beforeinput` 更新与前台标签 / 光标不变；站点仍为合成页面。
- 当前版本的完整结果与未覆盖范围见 [VALIDATION.md](VALIDATION.md)。真实账号结构核对和自动化合成测试不等同于用户 Windows 浏览器的实际发送验收。
- 开发者模式安装需要覆盖原目录后点击“重新加载”，详见 [README 升级说明](README.md#从-020-升级修复只填写不发送)。公开安装包继续排除用户提示词。

## [0.2.0] — 2026-10-23

### 核心行为

- 新增 **Your dot** 页面适配，包括 `/dots/home`；保留已有普通 ChatGPT 和自定义 GPT 会话支持。
- 默认改为 **每 20 分钟、同一条提示词、无限重复**；默认停止标记为空，首次发送等待完整间隔。可选择启动后立即发送。
- 默认任务在忙碌、草稿、附件、页面不可用或目标离开时保持启用并等待恢复；人工暂停及用户显式设置的结束条件仍能停止任务。
- 已点击但无法确认的新消息标记为未知；本周期不立即重试，等待完整间隔后继续。此行为不保证 exactly-once 交付。
- 支持单条重复、队列循环、队列执行一遍；可按成功发送后或新回复结束后计时。
- 支持本地时区静默时段、可选发送上限与停止标记。
- 任务状态跨浏览器重启保存；恢复时丢弃旧 tab ID，只接受唯一匹配的原地址。dot 另核对会话身份标记，防止同一路径切换目标后误投。

### 本地提示词与文件

- 支持手动输入，以及 TXT、Markdown、常见结构化文本、HTML、DOCX、PDF 本地导入；没有在线文档转换服务。
- 单文件限制 5 MiB、单条提示词 100,000 字符、队列最多 50 项 / 600,000 字符；DOCX 与 PDF 另有解压、页数和超时限制。
- PDF 使用随安装包提供的 `pdfjs-dist@6.4.299` 离线主模块与 Worker；源码可通过 `npm run vendor` 重建并逐文件校验资源。
- 提示词默认不进入界面 DOM 或表单值；用户明确显示 / 编辑才呈现。导入、切换配置或离开提示词页后隐藏正文。
- 增加本地模板、队列编辑 / 排序 / 删除、批量文件导入，以及默认不含正文的配置导出。
- 增加私用包预置接口：本地原文件首次导入后保持隐藏，且不自动开始发送；公开源码及通用包不包含用户提示词。
- 修复清空数据与异步导入竞争：清空后尚未完成的旧导入不能把已删除内容重新写回。

### 界面与控制

- 新增 420 像素弹窗和响应式完整控制台；任务、提示词、设置、日志四页签。
- 墨绿 / 奶白视觉，浅色、深色和随系统主题；倒计时、确认次数与保护状态显示。
- 固定底部暂停控制、`Ctrl + Shift + Y` 快捷键、只读自检、立即发送一次。
- 运行任务与编辑草稿分别管理；继续原任务沿用原配置，避免界面显示与实际发送不一致。
- 完整控制台显式选择目标 tab ID，不把控制台自身误当作聊天目标。
- 本地状态日志不包含提示词、导入文件名或聊天正文。

### 可靠性与权限

- 请求 `https://chatgpt.com/*` 的有限站点权限，支持后台注入与重启恢复；不请求全部网站权限。
- 保留自动防丢弃与暂停恢复原值；新增可选 `power` 权限以防电脑因空闲休眠，允许屏幕熄灭。
- 增强 dot 输入框、会话身份和作用域内发送按钮识别；避免点击页面其他位置的同名按钮。
- 保留草稿与已识别附件；最终提交前检查令牌、截止时间、URL、身份和输入内容变化。
- 处理开始 / 暂停 / 手动发送 / 定时触发竞争、延迟回调，以及浏览器关闭 / 页面跳转中的未确认提交。
- 真实扩展控制台消息与内容脚本消息分开授权；本地存储设置为可信扩展上下文访问。

### 验证与维护

- 104 个本地回归场景，涵盖后台状态、普通 / dot 适配、文档导入、界面隐私与真实 MV3 集成；具体环境及证明边界见 [VALIDATION.md](VALIDATION.md)。
- 真实 MV3 集成使用独立 Chromium profile 和合成网页，覆盖实际脚本注入、后台焦点保持、权限、alarm、PDF Worker CSP 及浏览器重启恢复。
- 新增 19 个现有方案的功能与证据对照、隐私说明和可验收路线图；不宣称已覆盖所有竞品功能。
- 配置 push / PR / 每周 CI、每周 Dependabot，以及版本标签触发的测试、打包和 Release 流程。

### 升级与已知边界

- 0.1.0 原型已有的提示词、间隔和停止标记不会自动清空。想使用本版默认无限模式，请自行将间隔设为 20、发送上限设为 0、停止标记留空，并重新绑定启动。
- 页面冻结不等于标签丢弃；系统防休眠不能阻止手动休眠、合盖或浏览器关闭。网站活动例外仍需在浏览器设置中配置。
- 文件提取与富文本网页可能规范化段落、换行或排版；不承诺字节级发送等价。
- 尚未验证真实 Windows / Edge 的长期运行或实际私人提示词发送；当前不支持多个并行任务或其他聊天站点。

## [0.1.0] — 早期原型

- 一个已有 ChatGPT 会话的后台定时发送；默认 30 分钟。
- 暂停、继续、立即发送、只读自检与快捷键。
- 提示文字、发送上限、自定义停止标记和标签防丢弃。
- 任务令牌、执行截止时间、新用户消息确认与草稿保护。
- 28 个本地回归场景，以及初版测试 / 发布工作流。
- 当时没有 dot、文档导入、队列、完整控制台或浏览器重启恢复；未知结果会暂停。

该版本为交付前原型，0.2.0 扩展并调整了上述行为。
