# Checkpoint41: IAB installed; scheduler alarm repair

## Checkpoint42 results and remaining work

Actual IAB send test delivered configured fixed text and received fixed reply,
but installed preview counted0/unconfirmed. Main paused the temporary test;
no retry, no native tools and no Dot call. Read-only DOM showed zero legacy
message-role/article nodes. Modern bodies use role-suffixed search-unit-key and
search-message-ids. Adapter fallback is restricted to those two attributes;
new and reused-ID cases were RED16/18, then GREEN18/18 in Chromium fixtures.
This is a compatibility fix, not a claim of installed-code acceptance.

Alarm tests initially41/47, then47/47. Fresh review identified additional
completion, startup, persistence and cleanup risks. Main reproduced those
failures before patching. Current scheduler57/57 includes actual synthetic
in-flight authorization and completion interleavings. Final cleanup ownership
reproduction56/57 was repaired to57/57. Pause clears sending authority before
housekeeping; cleanup failure retains ownership. Failed paused persistence
invalidates stale running recovery (session state remains); total storage
outage is not claimed recoverable. Shared setJob/restoreDiscard semantics
therefore affect more than Resume and require full regression.

New candidate6b3f976a64ea81619fc106dbbb4204fccf9a5d6007d63ad4d7759ef2fc082c90
contains exact normalized source; installed frozen77bccd3b is untouched.
Remaining: final receipt review/full npm exit, consented coordinated preview
update and live confirmation/limit retest. Native grant/cutover is separate.
General sending claim/log persistence, unknown queue semantics and reused
after-reply token issues are not resolved by these scoped patches.

## Current installation readback

2026-11-07: User reported completing installation. Native CUA subsequently
observed IAB Extensions Details: enabled, version2.2.1 Windows device preview,
ID hjnopijiekcbgiljjfiekeiepkebhido, loaded from exactly
`.artifacts/observer-reattachment-20261107/unpacked/AgentContinue`.
This supersedes the earlier pending-install blocker, not the separate native
registration, command-child, lifecycle, or hosted-tool acceptance gates.
No optional permission, native enrollment, task, or tunnel was changed.

## Problem

Resume can persist enabled before alarm creation fails, and its already-enabled
early return cannot repair a missing alarm. An API success with no alarm or a
one-shot alarm must not be represented as a functioning periodic scheduler.
This is a source-level hypothesis until reproduced below, not an attribution
of the user's earlier incident. Installed candidate bytes remain immutable.

## Technical plan

Keep Resume in the existing serialized state queue. An already-enabled Resume
must repair and read back the periodic heartbeat without replacing the active
run ID, deadline, due time, prompt, or progress. A paused Resume retains the
original configuration and schedules the normal full interval, not a send-now.
If alarm creation/readback fails, revoke sending through the existing paused
state before returning failure. Explicit Pause remains the cancellation
authority. No immediate send or cross-world retry is introduced.

## Alternatives

Repeatedly starting a new task would discard the original task identity and
queue progress. Reporting success solely because alarms.create resolved cannot
detect an absent or invalid alarm. Adding a permanent watchdog is unnecessary;
use the existing heartbeat and explicit Resume repair instead.

## Detailed implementation and acceptance

Scope: background.js syncAlarm/resume and synthetic background-v2-tests.mjs.
Inject rejected alarm get/create and successful create with absent readback.
Prove RED first, then repair. Prove existing-running repair keeps run/deadline
and does not dispatch immediately; a real synthetic onAlarm event dispatches
exactly one round after repair. Failed Resume must leave both saved/session
state paused with no new send. Concurrent Pause must still win. Run scheduler,
adapter, and MV3 regressions. Synthetic pass is not real ChatGPT delivery.

The independent native-integration reviewer has a disjoint read-only scope.
This is a bounded engineering adaptation of fresh review plus RED/GREEN, not
complete EGM source-learning or product-wide certification.

# Historical checkpoint39

## Authoritative current observations

Unified CUA IAB created ordinary Chat
https://chatgpt.com/c/6aef44e1-9c80-83ea-b530-c6eed07b1f1e . Actual reply was
AGENTCONTINUE_CHAT_READY_20261107. Selected custom App is exactly
plugin_asdk_app_6aeecf5622f88191a6b2a3a2c28c4009, not its portable plugin.
One-time Read File approval was used for the disposable probe at
.artifacts/ordinary-chat-acceptance-20261107/probe.txt. Page response reports
INVALID_ARGUMENT / McpServerError: Session terminated. This is page-observed
failure, not an independently matched provider receipt or proof of its cause.
No hosted file read succeeded, no command ran, and no connection was restored.

Native read-only COM observation: oldD940 owner task Ready/state3, instances0,
lastResult0, lastRun2026-11-07T02:26:35. These values do NOT establish current
private Pause or old lease state. New79958886 browser directory absent;
installed/state/secrets directories present. No settled operation was replayed.

## User-directed installation first

Actual native app IAB extension-settings document chrome://extensions/ has
AutoGLM and IDM disabled, no AgentContinue. Developer mode already on. Source
installation candidate:

`.artifacts/observer-reattachment-20261107/unpacked/AgentContinue`

ZIP SHA25677bccd3bb1070c708dcba2cfcc70d89d68f0befff5f29cdbd70072d6aafe6af3;
all237 unpacked file hashes match. Display version2.2.1 Windows device preview,
defaultlocale en, standardactiveTab/scripting/storage/alarms and chatgpt.com host
access. Optional power/nativeMessaging are separate. No manifest key, so read
actual installed ID after loading; do not assume dcah/ibhd/Store identity.
The external2.2.2 Local timer repair label describes another patched directory.

Load unpacked opened the directory picker. Folder field contains the candidate
absolute path. Select Folder NOT clicked; explicit action-time local-code/site-
access confirmation pending. No installation, native grant, automatic scheduler
or connection follows from preparation. Original external task Resume already
authorized with unchanged prompt/20minutes, but not executed; do not recreate it
silently in a different browser profile.

## Computer-use diagnostics

- Old runtime needed capture of setupBrowserRuntime return; missing global was
  an agent bootstrap oversight, not browser absence.
- Old browser API separately returned Work-settings denial.
- New unified CUA IAB navigation, ordinary Chat input/send and response work;
  no Work setting changed. The old denial is not current global capability.
- Native external Chrome getApp previously stopped on URL-policy uncertainty;
  that is not evidence IAB settings or browser itself is unavailable.
- Native ChatGPT app was minimized; documented launch entry restored it.
- Embedded extension controls had unavailable AX click geometry. Screenshot
  coordinate Load unpacked succeeded and the picker appeared asynchronously.
- Owned-picker AX/coordinate clicks failed target-window guards despite fresh
  screenshot regions. Native setValue filled Folder correctly. Dialog Raise
  succeeded; one Tab yielded no observed focus change. Do not bypass guards,
  invent window IDs, guess unsupported APIs or repeat blind clicks.

## Bounded independent source review (not yet reproduced/fixed)

Fresh no-history reviewer01a1b6a8-485f-7511-bac0-360f54659fcb read only the nine
assigned scheduler/config/test files, made no edits, ran no tests or helpers,
and was closed. No product-wide or complete EGM-method certification claimed.

1. background.js setJob/runRound: session claim can succeed before persistent
   write rejects outside dispatch try. Later ticks ignore non-idle phase even
   after deadline. Logging failure before finishRound state commit can likewise
   strand sending. Reproduce injected local-write/log failures and deadline
   recovery before patching. Preserve Pause cancellation and unknown-send safety.
2. resume persists enabled before syncAlarm and already-enabled Resume returns
   before alarm repair. Reproduce absent alarm/create failure, then explicit
   second Resume; require no false enabled/scheduled success and unchanged task.
3. Unknown queue result retains queueIndex, allowing the same accepted-but-
   unconfirmed item next cycle, including queue-once. Repeat cadence is distinct.
   Need explicit durable queue reconciliation semantics, not blind replay or a
   claim of exactly-once delivery from a click-count assertion.
4. after-reply chooses nonempty token equality over increased assistantCount;
   reused data-testid/id fallback can wait forever. Reproduce unchanged token
   plus increased count before changing completion detection.

Existing fixtures cover successful storage/alarms, not these fault injections.
No current-user incident cause is established by static review. Latest user
instruction pauses source work until IAB extension installation is handled.

## Next actions and unchanged boundaries

Resolve pending installation consent, finish through supported UI, verify actual
ID/version/enabled state and open its control page. Do not auto-enable optional
nativeMessaging, bind the original external task here, or start a tunnel. Keep
the ordinary Chat for subsequent independent runtime acceptance, not Dot.
Then reproduce/fix reviewed scheduler defects with RED/GREEN tests and resume
coordinated native/frontend lifecycle work. Full goal active, not complete;
no GitHub commit/push/Release/Store/npm or production changes this checkpoint.
