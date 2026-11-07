# Scheduler Timer Recovery

## Problem

The owner reports the actual local scheduler unusable. Chrome loaded an old
unpacked preview alongside the Store installation. Its fresh export includes
30 execution-exception observations around the 20-second watchdog. Actual
paused-only probes find a 1 ms authorization response but 991 ms and 1001 ms
page waits requested as 60 ms and 180 ms. This proves current timing dilation,
not the cause or submission outcome of every historical observation.

## Technical Plan

Keep device control and scheduler separate. Use the existing extension worker
for bounded 50/60/150/180 ms waits, validating run/tab/frame/URL/deadline before
and after each wait without holding the state queue. Never replay submission.
Keep manual Pause authoritative; restoring an enabled extension is not permission
to resume a paused research job. Preserve the same extension ID and its storage.

Improve diagnosis with distinct internal watchdog versus generic API rejection,
and fixed timing-probe metadata in the existing bounded local log. Diagnostic
execution is explicit, paused-only, non-sending and resolves only the unique
original URL. It cannot read prompt/DOM content, export raw exceptions, activate
the research tab, clear Pause or connect a device. English remains the default;
Chinese translates interface text only. Existing activity exports remain readable.

## Alternatives

- Extending the 20-second deadline hides stalls and makes cancellation slower.
- Activating the research tab would interrupt foreground work.
- Changing Chrome sleep/privacy policies is broader than this defect.
- Blind retries cannot distinguish missing acknowledgement from a completed send.
- A new system monitor/service is unnecessary; no new external process is needed.

## Implementation And Acceptance

Adapter and worker changes are in adapter.js/background.js; UI remains in
popup.html/popup.js and existing translation catalogs; bounded exports use
activity-export.js. Test the exact loaded preview as well as current source.
Exercise severe page-timer clamping, delayed receipts, cancellation during a
worker wait, wrong sender/run/deadline, no-send diagnostics after reload, invalid
metadata, export redaction, bilingual rendering and absence of mutation replay.

The initial local repair passes 38 adapter,38 background-v2,34 background-state,
19 support,15 UI and13 real MV3 cases. The exact preview MV3 includes 60-second
isolated page timers and a 500 ms delayed receipt. Independent scoped review
found no actionable issue, not whole-product certification. Actual production
delivery after this repair is unverified because the original task is manually
paused; owner resumption choice is pending. Do not resume it implicitly.

Prepare a scheduler-only commit on the unique main branch. Preserve unrelated
Windows administrator WIP unstaged. Verify exact staged bytes and its package
without importing native-device code or permissions. A source push is distinct
from Release publication, Store submission and Store approval. No public version
claim should imply the unfinished Windows administrator lifecycle is delivered.

## Follow-Up Verification

The scheduler-only index snapshot passed the complete public `npm test` suite:
background-state35, background-v2 39, adapter38, timeout3, timing-i18n5,
existing-i18n4, support20, ordinary-adapter16, Dot-adapter48, Dot-keyboard12,
file-import16, UI17, real MV3 synthetic integration11 and ProseMirror5, plus
the source-guard check. Native preview-only tests are intentionally excluded.
Six public packaging tests passed after rebuilding the pinned offline PDF.js
assets; both archive layouts build. These artifacts retain the public2.2.1
base version for verification only; they are NOT a new Release or Store upload.

Independent review reproduced stale log restoration and lost concurrent
diagnostic appends. Both regression tests failed before serializing only the
append through the existing state queue, then passed. Probe waits remain outside
the queue. Actual popup-handler browser tests also reproduced raw API-error
display; the diagnostic now suppresses transport exceptions, clears stale
measurements and permits retry. Both English and Chinese handler cases pass
without START/RESUME/SEND or task/config mutations.

The same installed preview receives only these eight scheduler/runtime-UI files;
its previous native imports and dispatch are preserved, not replaced by current
unreleased administrator-control source. Refined installed background SHA-256:
66c90c0c869ffc2f9caa8c20ee4ef8cf8ced0944253291e24fea83d31d79e4d8.
Its adapter is unchanged from the initial repair. Exact-preview background-v2
40 and real MV3 integration13 pass in disposable fixtures. Manual Pause is still
retained; actual post-repair production message delivery is not yet established.
