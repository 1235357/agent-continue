# Precommit Document Replacement Recovery

## Problem

An actual isolated MV3 browser regression reproduces a same-URL reload while a
MAIN prepare result is held. Preparation wrote the old composer but cannot
submit; no MAIN commit was admitted. The current background unconditionally
returns unknown on a changed document ID, so the same Send now pauses without
preparing the new document. This contradicts the required autonomous pre-submit
recovery. Missing generic page results still cannot establish non-submission.

## Technical Plan

Keep the exact bound tab/URL and current job authorization. A replacement may
be retried only while the background exclusively owns MAIN preparation/readiness,
before any MAIN commit has ever been admitted for that pending invocation, and
without observed manual intent, confirmed receipt, known dispatch or uncertain
commit. Unsupported-view fallback ends this exclusive proof. No legacy event
adapter or unclassified invocation is eligible.

On eligible replacement, synchronously retire that pending invocation before
resolving a fixed known-pre-submit retryable result. checkRun must deny its old
permit, and invoke must check retirement immediately before any MAIN admission.
Keep retired pending entries until the logical delivery round finishes, not
merely until a successor run-ID write. All invocations in that round share an
in-memory delivery object with the originating intent epoch, active accounting
run ID, retained pending entries, and monotonic MAIN-commit-admitted flag.
Authorization retirement and evidence lifetime are separate. A pending entry
always validates incoming evidence against its original run/token/document;
accounting may follow its delivery's active run ID. No linkage spans independent
rounds or changed target URLs.

The retry transaction validates the original intent epoch, pending stop intents,
failed stop epoch, current job/run/target and all retained manual/receipt evidence
before writing a successor. It links the accounting run ID synchronously before
the first storage await, rechecks those same guards after setJob and updateBadge,
and returns the written successor even when admission is cancelled. The caller
then finalizes against that written snapshot, without executing its page action.
Queued receipt/manual accounting can therefore still find the written current
run. A storage exception must finish as unknown, never re-admit; normal existing
storage failure handling remains in force.

Every successor page admission and MAIN phase checks this delivery guard again.
CHECK_RUN also denies an epoch-changed or retired permit. Retained old evidence
arriving during successor prepare blocks its commit. Until any successor MAIN
commit was issued, a valid old receipt can finalize the same logical round using
the active snapshot, without another send. If it arrives only after a successor
MAIN commit was admitted, stop as unknown rather than asserting either exact
once delivery or two successes. An observed old manual intent sets the active
job's manual-pending flag and blocks further admission; its receipt may settle
normally when no successor MAIN commit has been issued. Round-final cleanup
removes every retained entry and timer; no retired authority is restored.

Grant acknowledgement wait is eligible: the eligibility criterion is exclusive
MAIN ownership and no MAIN commit ever admitted, not the literal stage label.
Unsupported-view fallback permanently ends exclusive ownership. MAIN commit
admission sets both invocation and delivery monotonic markers synchronously
immediately before executeScript, without any intervening await. An attempted,
queued or uncertain commit remains unknown with no automatic replay, even after
an eventual explicit no-dispatch response and a document replacement.

The fresh run gets a fresh result/receipt token and new pinned document ID.

This is evidence of no extension dispatch while the exclusive model stage is
owned, not a universal guarantee that a website/user could not submit outside
the observed event channels. Preserve manual observation and unknown fences;
do not claim server exactly-once or full original-payload fidelity.

## Alternatives

- Keeping every replacement unknown preserves the current recovery bug.
- Retrying every changed document can duplicate an already admitted commit.
- Using zero sampled counters alone is insufficient; exclusive background-owned
  model phases and a monotonic commit-admitted marker are required.
- Changing browser/native transport, user prompts, target identity, or overall
  wait limits is unrelated and excluded.

## Implementation And Acceptance

Scope: background.js, focused background-state regressions, and the existing
same-URL prepare-reload ProseMirror scenario. No native/runtime/package version
or permissions change. Development and review are owner-authorized autonomous
adaptations, not human design signoff or complete EGM-source certification.

1. First reproduce the existing real browser case (done: zero submits, unknown).
2. Add a deterministic unit regression for replacement during a held prepare;
   assert same job, fresh run/token/document, exactly one new commit and denial
   of the retired run while the new run has not yet been admitted.
3. Add/control replacement with manual intent, fallback, and commit admission;
   all remain unknown/no automatic admission. Existing Pause/target/recovery
   tests must retain their assertions.
   Include receipt/manual/Pause arriving during retry sleep and during successor
   session/local storage writes; keep the old prepare response unresolved until
   the successor has completed. Include grant wait and a queued commit followed
   by an explicit no-dispatch reply. No discarded test assertions are substitutes
   for these phase-bound cases.
4. Re-run the focused browser case, background suites and full safety command.
   Then continue the unfiltered browser suite; report downstream failures rather
   than treating an early pass as complete.
5. Obtain independent code review of the retirement/accounting race. Preserve
   exact hashes/test commands and do not publish a new release without required
   actual installed browser-managed Windows acceptance.

## Accounting Review Addendum

The independent committed-source review found two missing orderings: a retired
receipt arriving during successor receipt persistence, and an immediate explicit
no-dispatch result after MAIN commit admission but before the replacement probe.

Keep MAIN commit admission monotonic on the logical delivery, not only on a
pending invocation. Internal no-dispatch correction may keep its reservation;
an outer retry must not obtain authority on another document after that marker
is set. A same-document explicit no-dispatch reply can recover a late removable
attachment: retain the admitted document ID, require matching current top-frame
readback before retry, and pin every successor injection to that document.
Replacement after the readback cannot redirect the pinned successor. Missing
document identity or uncertain/attempted dispatch must stop as unknown.

Receipt finalization retains its original sending snapshot as the accounting
baseline. Recheck shared replacement ambiguity after awaited activity/storage,
alarm and badge work before declaring that finalization complete. If ambiguity
arrives during any of these awaits, persist an unknown paused snapshot derived
from the original baseline, not from the provisionally incremented idle count.
The partial-receipt persistence retry must use that same baseline. This changes
accounting of uncertain submissions, not the preparation wait deadline or the
user's accepted prepared-text adoption policy.

Acceptance adds both held session/local writes plus the early page-result path.
Each must keep unknown counts bounded, avoid a false confirmed count, preserve
the original ordinal and deny a successor commit after admitted old authority.
