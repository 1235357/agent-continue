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

## Follow-Up: Saved Target Selection

A real no-send Check exposed a separate local-console defect: the saved task
still named the original dot, but the selector was blank after a tab-ID change.
The original page was present in the target menu. Check returned an unsupported
page error instead of checking the saved conversation. This observation does
not prove a production send failed or identify every earlier failure.

The full console now resolves an inherited choice only by the unique normalized
saved URL. It never trusts an old/reused tab ID or a title match. Missing or
duplicate original pages leave the choice empty and require explicit selection;
Check does not fall back to the active page. Manual selections remain manual.
The popup-to-full-console entry also preserves this distinction instead of
passing an inherited saved-job ID as if it were an explicit choice.

Two new regression failures were reproduced before fixes: reused ID41 was
selected instead of the exact original URL at99, and popup expansion carried
inherited ID41. The expanded suite passes22/22 for source and the exact installed
preview. The unchanged installed background still passes40/40. A fresh focused
static review found and closed the expansion-entry omission; it did not execute
these tests independently.

Only the installed popup.js was backed up and patched. A local-console-only
reload selected the original dot without manual rebinding; actual no-send Check
then returned "Composer detected" and explicitly stated that it did not enter
or send a message. The saved task remains manually paused,20minutes, with its
original4728-character prompt and confirmed count unchanged. The prompt was
neither changed nor submitted. This is local control/probe recovery,
not an actual scheduled-send or administrator-runtime acceptance.

## Delivery Still Unverified

### Explicit Resume Consent, Not Yet Executed (2026-11-07)

The user answered the original-task question: resume the original task while
retaining its original prompt and interval. This supersedes the requirement to
obtain resume consent for that scheduler task only; it does not authorize VPN
resume, native-owner connection or a different conversation binding. Historical
saved metadata was4728 characters/20minutes; current values still need readback.

A fresh call through the existing trusted browser Agent again returned
`Local browser use is disabled in Work settings`. No actual scheduler state
change or send was performed. Do not claim resumed or ask the same consent
question again. Once browser access is enabled, verify the original task and
unchanged settings, use its actual Resume action once, then read back running
state and next scheduled time. Do not substitute Send once now or rewrite the
saved prompt. Previous manual-Pause observations below are historical, not a
statement that the user still wants Pause.

Actual post-repair production delivery is still unverified because the original
manual Pause has not been cleared. Do not infer failure from that intentional
Pause, or silently resume it to obtain an acceptance result. Worker suspension,
renderer freezing, platform unavailability and future page changes are separate
failure modes; these tests do not prove permanent or universal delivery.
