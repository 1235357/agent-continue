# Consented Windows Installation Handoff

## Problem

The consented command currently installs an administrator browser owner but
stops paused. The owner wants the extension to continue configuration/connection
without asking them to compose commands, inspect digests or search for Connect.
An old installation, an old success receipt or a later manual pause must not be
mistaken for consent to start this installation.

## Technical Plan

One Setup-copy gesture explicitly covers the chosen administrator scope and
automatic connection after running the command. It creates a fresh32-hex setup
ID, includes it in the command, and requests nativeMessaging in that user gesture.
Copying does not execute the command, elevate Windows or grant a ChatGPT tool.
The page observes setup with bounded read-only checks while consent/scope/page
remain current. No new service, task or background startup loop is added.

InstallBrowserOwner accepts optional BrowserSetupId only for this combined
action. After successful protected enrollment, it writes a selected-SID-readable,
sealed setup receipt with the exact setup ID, bundle digest, extension origin and
current control target. No credentials enter that receipt. The helper and parent
entry propagate this identifier as data, not executable syntax.

The native host accepts one new read-only setup-status request. Its reply is
installed only for an exact setup ID/origin/bundle match and an unchanged current
control target. Otherwise reply unconfirmed with null bundle/target; no startup,
pause, mutation or fallback is performed. Medium observation checks the sealed
commit/receipt ACL and bounded bytes, not private credentials. A later Pause/Revoke
changes the target/projection and invalidates automatic startup eligibility.

The revised design keeps Setup open; it does not transfer startup authority
through another page, a URL or a session-store ticket. A worker-owned intent is
bound to the exact initiating tab/document, its original cancellation permit and
a bounded monotonic lifetime. The page observes installation, then requests one
continuation. Permission loss, navigation, close, manual Pause/Revoke or a worker
restart cannot implicitly recreate that intent. A restarted worker can read the
original operation, not silently resume a copied command.

After an exact readback and verified installation-wide stop capability, the
worker submits through the EXISTING administrator-control journal. Setup ID and
operation ID are committed together before transport dispatch, with exact
readback. It uses the receipt's original target, never a refreshed target.
Duplicate/archived associations return that original operation without another
dispatch. Unknown persistence or submission is not a successful connection.
The page can show Devices after admission, without transferring new authority.
Denied browser permission needs a new explicit user gesture; page load never
requests permission. The combined automatic-connection disclosure must precede
the copy gesture; old install-only consent remains install-only.

## Alternatives

- Do not start an administrator owner directly from a medium installer or forge
  browser-parent evidence. Existing browser-owned startup remains authoritative.
- Do not use URL flags, timer expiry, an old receipt, or generic Ready as consent.
- A manual Finish/Connect button remains a fallback if the page was closed,
  permission denied or automatic checks could not prove the exact installation.
- Existing/partial installations are not overwritten. Reuse/adoption is a
  separate verified operation, not a blind repeat of InstallBrowserOwner.

## Implementation And Acceptance

### Current Checkpoint58

The worker/page now import setup-controller.js/setup-client.js and wire the
installation-wide Pause provider. The initiating trusted Copy can request browser
permission, copy an exact setup-ID command, observe a sealed installed receipt,
prepare an observer-only acknowledged port and request one admitted Connect.
Human approval uses the original15-minute deadline, not the5-second IPC budget;
Connect waits at most120seconds within that deadline. Close/withdrawal/permission
loss invalidate pending steps; unknown submitted work is never replayed.
Both stop capacity and observer admission must succeed. Exact setup association,
installation marker and journal reservation share one write/readback.

Source/module and rendered UI regressions passed, including slow approval,
A/B/A original Pause ID preservation and observer disconnection at the final
permission await. This is not live combined-installer acceptance. The reviewed
runas path may ask Windows separately for installation and connection; a new
fixed-control broker is future optional hardening, not this delivery gate.

The reconciliation below is historical checkpoint57 context. Its "not wired"
statements are superseded by this source checkpoint, not by a claimed deployment.

### Review Reconciliation: Not Ready For Automatic Dispatch

Independent source review identified the requirements below. Read-only receipt,
worker admission and source fixtures are implemented, but are not yet connected
to the live automatic startup UI.

1. DONE in source/tests: capture and publish the setup target under the SAME enrollment owner-control
   gate. Never sample/rebase it after another Pause may have committed. An
   enrollment-A / Pause-B / receipt-B interleaving must be rejected.
2. IN PROGRESS: Pause/Revoke intent must synchronously invalidate pending startup preparation
   at the worker, before any await, including across tabs. The newly implemented
   startup epoch covers only work before native transport dispatch. It does NOT
   stop already-dispatched high work. Review reproduced an actual interleaving:
   targeted Pause samples A:idle, Connect commits revision C, and delayed Pause
   returns superseded without saving paused intent. Existing targeted semantics
   must stay intact; add a separately authenticated installation-wide stop and
   durable receipt, then connect the button/automatic flow to that contract.
3. DONE in source/tests: a worker-owned durable setupId-to-operationId association must be committed
   with admission before transport dispatch. A lost reply, late publisher or
   restarted page must not create another operation. Session locks alone do not
   establish this property.
4. Worker source/tests bind continuation to the initiating tab/document and
   cancel on navigation/close. The cross-page ticket design is superseded.
   The live bilingual consent/copy/poll integration remains pending. A default
   false stop-support gate prevents accidental automatic dispatch during wiring.

The source-only observation module and setup-controller.js are tested, but no
runtime page/worker imports setup-controller.js yet. Its default stop-support
gate is false. Legacy experimental session-ticket helpers are unused and must
not be treated as connection authority or adopted by the revised UI.
These boundaries are intentional, not completion of the automatic flow.

Native worker owns helper/parent/stager/native-host changes and native tests.
Main owns same-document Setup continuation, cancellation and UI tests.
Release/package allowlists must explicitly include any new shared UI module.
No production installation or connection is part of source fixture tests.

Required tests: matching successful receipt; stale ID/origin/bundle/target;
malformed/oversize/redirected receipt; permission denial; scope change; copied
command race; elapsed deadline; page close; consumed/stale handoff; manual Pause/
Revoke before support or dispatch; one admitted control and durable unknown-state
readback without replay; both languages and standard-account path unchanged.
Then build the complete runtime closure and run an actual fresh-install trial
under a new exact candidate, followed by ordinary ChatGPT and Dot live acceptance.
Public Release/Store submission remain separate mandatory gates.

This is an autonomous, scoped adaptation of the requested review-driven workflow,
not a claim of full EGM-source adoption or host-enforced completion certification.
