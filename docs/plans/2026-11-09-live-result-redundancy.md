# Live Result Redundancy

## Problem

The owner's current3.0.5 export records no-valid-result after18748ms and
execution-timeout after20003ms, with text stranded in the composer. The known
unpacked runtime matches source. Local fixture passes do not override this
live failure. One observed timeout matches the20s outer watchdog; it does not
prove why the other injection returned no usable result. Do not blame a stale
version, infer successful service submission, or replay an uncertain operation.

## Technical Plan

Keep exact run/target/Pause admission and one durable model-attempt reservation.
The latest owner instruction removes any overall send-wait limit, including an
inactivity cutoff. Keep one current enabled invocation waiting through renderer
or result-transport delays until a result, cancellation or target invalidation.
Worker-owned checks refresh finite individual MAIN-command permits for that same
live invocation; a pending context and the current enabled job must both exist.
Old recovery files, replaced runs, paused jobs and wrong targets/documents cannot
revive a permit. Propagate the permit to the isolated adapter and every MAIN
phase. A stale MAIN permit can repeat the same phase/reservation only when the
result explicitly proves dispatched:false and code:expired. Unknown execution
never permits a replay. Read-only probes retain a finite watchdog, not a send
wait limit. Waiting and permit refreshes do not prove page/model progress.

Add an independent completion message from the injected isolated function to the
worker. It carries the same run ID and structured adapter result, not prompts or
history. Validate the extension sender, top frame, exact bound URL, current run
and a per-invocation UUID token. Accept the first valid result from either the
message or injection return, clean up both paths, and ignore late/duplicate
results. A missing or rejected injection return waits for that same operation's
result or cancellation; it never authorizes a second submit. The independent channel
only preserves a result; sent still requires the adapter's matching DOM receipt.

## Alternatives

- A larger fixed total timeout leaves the same cutoff and missing-result gap.
- Reclicking after an unknown result can duplicate a submission.
- Native trusted input, debugger permission, foreground activation and profile
  editing are outside this fix and do not establish background correctness.
- Unbounded authorized waiting cannot prove page progress or successful delivery.

## Detailed Implementation And Acceptance

Update background.js's current-run lease, executePage result handoff and dispatch,
and wrap adapter.js's closure-free implementation with result publication. Keep
probe behavior, configured prompt, no cap, docs/privacy boundaries and all
existing dispatch safeguards. The helper is not a privileged process grant.

First reproduce a scoped Send activating after21s under an actual disposable
MV3 extension. Require one button submission/count1, no keyboard or foreground
change. Then discard only the final executeScript result in that same local
fixture and require the real runtime message to preserve count1 without another
click. Wrong sender/token/run and a stale result after Pause cannot settle the
current round. A silent same invocation remains pending past twenty seconds,
logs its wait once, and stops on Pause without replay. A queued MAIN permit that
expires before execution must refresh after explicit no-dispatch and submit once.
Pause must acknowledge the page-side irreversible revocation before a queued
final commit is released; the helper then cannot complete the dispatch handshake.
If that acknowledgement is unavailable, show uncertainty and fence the old finite
permit rather than claiming it stopped. Run worker, helper, adapter, capacity and full browser
regressions and inspect the rebuilt candidate, not only source.

Independent review additionally reproduced a one-off observer-transport failure
leaving the isolated cached permit stale, and a legacy final correction turning
a known temporarily disabled Send into keyboard fallback. Require a fresh,
token/document-bound page permit acknowledgement immediately before MAIN commit;
retry only that pre-dispatch handshake if its transport fails. An observer may
recover a transport failure but explicit denial/revocation must stop it. Retain
known Send presence through the final correction and its later readiness wait.
Do not mark submitted before that wait or fall back to keyboard from a known
Send. Add actual MV3 fault-injection cases for both independent findings.

Remove the live adapter's old6.5s receipt and3.5s post-Stop cutoffs under the
worker-owned unlimited-readiness contract. Keep direct older-adapter contracts
bounded. Result-message publication must not hold the independent injection
return open. A final-readiness mutation is rechecked before selecting Send.
Actual official-ProseMirror fault injection additionally reproduced a DOM/model
race: immediate clicking after an isolated DOM correction submitted the old
model text. After that correction, wait for framework settling then reobserve
the same authorized attempt; do not click from DOM equality alone. Text changes
restore the configured prompt; late attachments cause no submission.

This adds a regression and cancellation handshake for the queued final-IPC Pause
boundary. It does not close queue-once uncertainty policy, exact-whitespace DOM receipt limits,
installed live-site acceptance, native CI failure, or Store/Release gates. Keep
them explicit; do not upgrade candidate tests into claims about the owner's tab.
