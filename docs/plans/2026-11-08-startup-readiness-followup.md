# Devices Startup Readiness Follow-Up

## Problem

After a consented Connect, the worker observes the original control receipt and
updates its journal. Devices consumes that progress, but the top administrator
readiness is only set by a separate manual status click. A launch-requested
receipt is not readiness; leaving the page unobserved forever is also not the
intended single-workflow experience. This is a source-level UX gap, not proof
that every earlier user screenshot exercised it.

## Technical Plan

Only a new Connect/resume-saved confirmed in this canonical Devices page may
arm a volatile watcher. Bind it to the exact persisted operation identity,
target, creation time, permission revision, Pause-storage revision and page
URL. Merely opening/reloading a page, loading historic receipts, native grants,
alarms or manual receipt queries must not arm it. It never sends a mutation.

Follow the worker's journal until that exact request reaches launch-requested.
Then query the existing read-only administrator-status API. Check permission
before and after each query under its existing five-second deadline. Publish
only a validated current observation, explicitly separate from chat grants.
If not ready, allow at most five reads with three-second spacing while this
page and operation remain current. This budget only stops UI observation; it
never cancels, restarts or limits the native process or a user's command.

## Alternatives

- Requiring a second manual status click preserves the current confusing UX.
- Treating launch-requested as ready fabricates evidence and is rejected.
- New native/status wire protocols or resident polling services are unnecessary.
- Replaying Connect to obtain a success result risks duplicate execution and
  is prohibited.

## Detailed Implementation And Acceptance

Keep the change in devices.js and its existing synthetic UI test suite. Reuse
the current status read and observation validators. Automatic reads must not
lock Pause/Revoke/manual status, clear a newer observation, change selection,
refresh a platform grant, or persist intent. Manual status or another user
control cancels the watcher. Pause, Revoke, permission invalidation, changed
operation identity, account/target switch, page departure and disposal stop it;
late replies cannot render readiness after those boundaries.

Tests must first reproduce that a new confirmed startup's journal progression
does not automatically read ready. Cover both startup kinds, historic-page
non-activation, mismatched and malformed records, permission loss, denial
controls, late replies, finite retry exhaustion, one control dispatch and no
storage writes by the UI. Mocked tests prove this contract, not installed IAB
or hosted/lifecycle acceptance. No live native control, browser reload, runtime
replacement, production change or release replacement is part of this patch.

## Review Findings And Readback Separation

An earlier manual status reply must also be invalidated by a confirmed control
or a Pause/Revoke observed from another Devices page. Use a status-read epoch
plus the existing Pause-storage revision; only new or changed Revoke records
advance the denial epoch. Ordinary startup progress must not invalidate a
manual status read. These cross-page fixtures first reproduced three failures.
Also clear an already-published observation on external Pause, without inferring
that the runtime has stopped; this separately reproduced cached-value case is
not the same as rejecting a pending response.

The worker has a separate readback gap: revocation-recorded is terminal for
admission, but an eventual stopped receipt may refine it. Keep admission and
archive semantics unchanged while allowing read-only follow-up within the
existing ten-minute window from the original createdAt. An explicit same-ID
Revoke reconciliation gets one subsequent read, even for an aged record; it
does not restart the monitor window. Wait out an older in-flight identity read
before that fresh query, and recheck permission/disposal epoch after journal
read. Observation never writes a native stopped receipt; native completion or
explicit reconciliation must establish that evidence independently.
