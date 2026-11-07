# Local Scheduler Recovery: 2026-11-07

## Incident And Scope

The installed unpacked Windows preview still used an older scheduler while a
second Store installation was enabled. Repairing repository source alone did
not update that installed preview. The two existing tasks were manually paused
before remediation. Recovery must not interpret a code update as permission to
resume them, submit a prompt or enable device control.

Fresh history contained 30 execution exceptions near a 20-second watchdog and
18 unconfirmed adapter results. These counts do not establish dispatch counts,
successful messages, network failures or a single cause for all historical
observations. A no-send probe did establish current hidden-page timer dilation.

## Repair And Verification

The adapter now uses bounded, authorized extension-worker waits instead of
hidden-page timers for the updated send contract. Run, sender tab, top frame,
URL and deadline are checked before and after each wait. The state queue is not
held while waiting; Pause and replacement still cancel dispatch. A missing
receipt never triggers a second submission method in the same round.

The same installed preview was updated with backups and without changing its ID
or storage. The duplicate Store instance was disabled, not removed. Eight
scheduler/UI files were refined without importing unfinished administrator code.
The locally patched preview reports 2.2.2; this is not a Store or GitHub Release.

The exact scheduler-only main snapshot passed the full public npm suite and six
packaging tests. The exact installed-preview bytes passed 40 background cases
and 13 real MV3 synthetic integration cases in disposable browser fixtures.
Those include 60-second page-timer clamping, a delayed receipt, one submission,
and preserved foreground focus. They are not production conversation sends.

The post-reload real extension console and diagnostic were read on November7:

- The original task remains manually paused, with a 20-minute interval and its
  original prompt length unchanged; no prompt content was read for this check.
- The extension-priority overwrite option is visibly enabled; it was not changed.
- Authorization round trip: 1ms, ok=true, allowed=false under Pause.
- Requested hidden-page waits60ms and180ms: first1057ms, total2058ms, hidden=true.
- The extension's own Export action produced schema4, extensionVersion2.2.2,
  71 bounded entries and both timing-probe records. No prompt or message was sent.

The local source repair commit0e6b37e6f19796a1acfb6123fb68aaf968c81da8 was pushed
to the unique GitHub main branch and independently read back from the remote.
No new Release, Store submission or approval follows from that push.

## Remaining Boundary

Actual post-repair production delivery is still unverified because the original
manual Pause has not been cleared. Do not infer failure from that intentional
Pause, or silently resume it to obtain an acceptance result. Worker suspension,
renderer freezing, platform unavailability and future page changes are separate
failure modes; these tests do not prove permanent or universal delivery.
