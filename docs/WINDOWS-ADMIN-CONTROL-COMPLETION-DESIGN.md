# Windows Administrator Control Completion Design

Status: design-only next-source proposal, 2026-11-07. The sidecar may write only
this document. No implementation, test execution, installation, enrollment,
account, credential, browser, tunnel, task, VPN/MCP or research operation is
authorized by this document. EGM's problem/plan/alternatives/implementation
structure and evidence separation are used; complete EGM source adoption,
readiness/completion certification and cold review are NOT claimed. This revision
reconciles five findings from the separate subagent Cicero, relayed by the parent;
the accepted-findings ledger is in section 4. Acceptance of a finding is not
implementation acceptance.

## 1. Problem

### Scope and evidence boundary

Complete the browser-facing administrator lifecycle without merging it with the
standard-account device host or the prompt scheduler. Deliver an actual initial
Connect, deliberate reconnect, bounded transient observer reattachment, and
durable owner Revoke. Preserve protected Pause/Revoke, unknown-operation fencing,
the current native browser witness and Job containment requirements.

D940 is an immutable acceptance subject, not the target of these changes.
`docs/DEVELOPMENT-HANDOFF.md:136` records D940's local high-child acceptance;
the archive identity recorded there is
`d94052eccd6d90bb08f6de78cdf97dee3d50cad4c4d88f5fcacae2b6d15bde5f`.
The inspected source stager hashes to
`c74842d8c99da6e8c2fa0be05e49bfeffec26a8dd8515ddec8c7cb834f1fb671`.
These are source/document observations, not a sidecar read of installed files.
The parent owns D940 hosted acceptance. Any D940 accepted high-backend results
remain limited to the exact candidate, surface and receipts the parent observes;
they do not accept the new browser controls proposed here. No D940 mutation,
AcceptLocal replay, binding/enrollment migration or hosted acceptance is performed
or requested by this sidecar.

Parent-reported D940 progress at this revision: through the actual browser-managed
hosted ordinary ChatGPT surface, the parent observed a High command, a file-tools
roundtrip, and own-process start/list/stop matching native receipts. The parent
then closed the isolated test browser and observed G1 root exit 0, Job drained
and leases clear WITHOUT changing saved running intent to paused. The parent
reopened the same isolated profile with Restore enabled. In the parent's final
update, G2 `7e4a982213184032819c6424740ab58d` reached Ready after reopen; a fresh
ordinary ChatGPT High command, PID `139768`, matched its native witness.

The parent then used the actual Devices UI Pause operation
`0aa26b4a01fb46dbbd8e3ec5eaf36a57`, which returned protected `stopped`.
G2 exited 0, its Job drained and leases cleared. Reopening with `Restore=true`
preserved paused intent, with zero owner leases/task instances; actual UI receipt
readback agreed. Both temporary offline browser harness sessions were stopped
and Chromium key cleanup was confirmed by the parent. Dot scope remains pending:
the UI has only the existing research main; that is not a disposable Dot
acceptance target and this update does not authorize using or modifying it.

These are the parent's observations, not a sidecar inspection of native receipts
or a sidecar runtime action. G1 hosted work/shutdown and G2 reopen/High-command/
UI-Pause/pause-preservation are reported observed. Dot acceptance remains open.
Full-browser reopen Restore is a different acceptance case from transient port
loss while the extension runs, and neither accepts the next-source controls.

Parent-reported performance/operation facts, not independently reproduced here:
the first helper preflight safely rejected `control-stager` plus the original
archive; the corrected `ConnectEnrolled` helper launched Connect once. Installed
Connect requires the exact enrolled `.browser/stager.ps1` and
`.browser/bundle.zip`. Authorize/Enroll/Connect can rehash 24,328 files and take
several minutes. A launched helper is not a completed Connect or Ready receipt.

### Current source observations

Source base for the following locators is
`D:\Desktop\Northwestern University MSCS\[Develop]\agent-continue-repo`.
Line numbers describe the inspected working-tree checkpoint, not future bytes.

| Source locator | Observed behavior / design consequence |
| --- | --- |
| `admin-browser.js:144`, `:182` | One startup-wake budget; grant attaches an observer with `wake:false`; the attachment promise and seal survive port loss. |
| `background.js:408`; `browser-wake.js:1`, `:73` | Standard reconnect/recovery and administrator messages route separately. Standard recovery cannot repair the administrator owner. |
| `admin-browser.js:85`, `:127`, `:198` | Pause persists its ID before dispatch, reads receipts, offers fencing, and validates the own-extension Devices sender. Reuse these boundaries. |
| `native/desktop-commander/windows-admin-browser-host.mjs:36`, `:121` | Closed native protocol; no Connect/Revoke; legacy start throws; `session` retains a witness and optionally schedules a startup demand. |
| `native/desktop-commander/windows-admin-browser-session.mjs:33`; `windows-admin-owner.mjs:269` in the same directory | Peer acquisition is bounded; witness loss fences admission and closes the high owner. No seamless survival of its processes is promised. |
| `scripts/Stage-WindowsAdministratorBundle.ps1:630`, `:2643`, `:2818` | Connect snapshots the control revision, checks paused intent/leases, saves running intent, then requests the bound task. It has no browser operation-ID journal. |
| Same stager `:1326`, `:1365`, `:1380` | Pause validates enrolled paths, identity, registry/commit, held stager/archive hashes and target, then requests a hidden `runas` child. This is the narrow launcher model to reuse. |
| Same stager `:1707`, `:1848`, `:1890`, `:1932` | Pause has durable reservation/projection/fence; Revoke writes the protected `owner-revoked` marker but has no per-request receipt. |
| Same stager `:2427`, `:2720`, `:2765` | General mutation path opens the archive/layout and verifies the entire sealed tree before later actions. A new UI timeout cannot make this work bounded. |
| `docs/plans/2026-11-07-administrator-browser-lifetime.md:233` | Queue policy is installation-wide coalescing, not proof of session-correlated startup. Preserve this distinction. |

The currently inspected behavior matches the sidecar findings. These observations
are not an installed-byte comparison. The gaps are missing control capabilities
and recovery policy, not permission to relax the existing safety checks.

### Required behavior and non-goals

1. A fresh preview can attach an observer after native permission grant, then
   explicitly request initial administrator Connect through actual Windows UAC.
2. Transient port loss permits bounded observer reattachment without any saved
   intent change, task launch, tool replay or implicit first connection.
3. Explicit Reconnect resumes only an already saved-running, still-authorized
   installation. A paused installation requires a separately confirmed Connect;
   a revoked installation refuses both.
4. Pause and Revoke supersede pending Connect. Revocation and confirmed process
   shutdown are distinct observations. All new mutations have durable IDs.
5. First usable completion RETAINS slow full verification, with a detached high
   operation and stable receipted pending/progress. A bounded loader fast path is
   a separately reviewed future optimization, not a completion prerequisite.

The owner's desired PRODUCT behavior additionally includes authorized
saved-running runtime recovery while the extension is running, including after
transient native-port loss, without clearing saved Pause/Revoke or replaying tool
operations. Observer reattachment alone does not meet that goal. This first
milestone may deliver the manual control/recovery workflow below while leaving
automatic high-runtime restart after port loss DEFERRED AS A PRODUCT GAP. It is
not a claim that the requested automatic reconnect UX has been achieved.

Non-goals: transparent migration of D940, silently authorizing a new installation,
uninterrupted high-process survival across witness loss, replay of tool calls,
new relay/EXE, Store/release publication, or changing conversation tool grants.

## 2. Technical Plan

### UI, authority and state separation

Keep the administrator section distinct in `devices.html` / `devices.js`:
Connect, Reconnect, Pause, Revoke, Check status, and operation-receipt readback.
Use explicit confirmation dialogs for Connect and Revoke. Reconnect explains
saved-running-only behavior; it never offers an automatic fall-through to
Connect. A permission grant permits native transport, not native authorization.
Restore remains a preference, not current readiness or permission to unpause.

UX must distinguish observer transport from runtime availability. After a port
reattaches, show `Observer attached; administrator runtime state unknown` until
fresh native observation establishes more. If shutdown is actually verified,
show `Administrator runtime stopped; Reconnect required`. Neither a session ACK
nor `wake:false` reattachment may emit a runtime `Recovered`/`Connected` success.
After manual Reconnect, show `Restart requested; waiting for runtime` until a
fresh current-generation Ready observation. Hosted tool success still requires
its own per-surface evidence; even Ready alone is not such a receipt.

Separate three state machines:

| State | Authority | Allowed transition |
| --- | --- | --- |
| Observer `detached/attaching/attached/reattaching/permission-absent/blocked` | Current retained native port plus permission epoch | Reattach only; never write native lifecycle. Attached does not mean runtime recovered. |
| Owner `unobserved/paused/running/revoked` | Fresh, narrowly projected protected-native observation | Only high control actions change intent/authorization. Existing `status` Ready is insufficient to infer all four states; add the projection below. |
| Operation `pending/submission-observed/protected-state-observed/unknown/terminal` | Browser durable record plus separately validated native receipt | Read the same ID after uncertainty; never infer effect from a UI timeout. |

Add a read-only `control-support` projection for the installed candidate: pinned
bundle digest, action capability and, when observable, native control revision,
generation and owner state. Connect/Resume eligibility needs a fresh native
target. Revoke eligibility needs verified installation identity and the narrow
deny capability, NOT a fresh target, Ready owner, known generation, settled
leases or readable liveness projection. Thus Revoke can be eligible while
`ownerState=unobserved`. The high child rechecks the appropriate protected
identity/state under the control guard. Missing identity evidence remains a
failure, not permission to operate a guessed installation. Do not expose keys,
profiles or account data in medium-readable projections.

### Additive closed protocol

Keep the existing host name `com.agentcontinue.administrator_owner`, origin
validation, native framing, and exact version-1 `session`, `status`,
`pause-support`, `pause`, `pause-status`, `pause-reconcile` messages unchanged.
The retained port remains lifetime-only: no command is posted after its one
correlated session acknowledgement. Send new controls as separate one-shot
native messages; do not weaken `extraInput` rejection on the witness channel.

The following names and fields are NEW candidate contracts, not D940 features.
All objects are closed; reject extra keys, wrong versions, malformed IDs,
nonfinite values, trailing data and unknown enums before dispatch.

Common types: `id` is a per-transport UUID; `operationId` is 32 lowercase hex
characters generated once per user mutation; `bundleSha256` is 64 lowercase hex;
`control` is exactly `connect`, `resume-saved` or `revoke`; Connect/Resume `target`
uses the existing `controlRevision:generation-or-idle` representation. Revoke
has NO target field. Do not confuse a
transport ID, browser port ID, owner generation and durable operation ID.

| New native action | Exact request keys in addition to `version,action,id` | Reply fields in addition to `version,action,id` |
| --- | --- | --- |
| `control-support` | `control` | `control,state,bundleSha256,target,ownerState,eligible`; supported has a valid digest, with valid target for eligible Connect/Resume and null target for Revoke; unconfirmed has null digest/target and eligible=false. |
| `control` with Connect/Resume | `bundleSha256,operationId,control,target` | `bundleSha256,operationId,control,outcome`; outcome is `requested/cancelled/unconfirmed`. |
| `control` with Revoke | `bundleSha256,operationId,control` | Same submission reply; reject a supplied target rather than silently trusting or ignoring it. |
| `control-status` | `bundleSha256,operationId,control` | `bundleSha256,operationId,control,state,progress`; state is one of the protected states below or `unconfirmed`; progress is null or the closed object below. |
| `control-fence` | `bundleSha256,operationId,control` | Same submission reply as `control`; no target supplied or invented; use the distinct tombstone contract below. |
| `control-reconcile` | `bundleSha256,operationId,control` | Same submission reply; explicit UAC recovery of this ID, never a replay of its startup/task request. |

`ownerState` is exactly `unobserved/paused/running/revoked`; `eligible` is a
boolean for this specific control, not an authorization token. Revoke can have
`state=supported,ownerState=unobserved,eligible=true,target=null` after installation
identity checks. Supported protocol with an ineligible action is different from
a missing/legacy native capability.
The UI can therefore distinguish a paused owner from unavailable evidence without
inferring either from the absence of Ready.

`progress` has exactly `phase,verifiedFiles,totalFiles`. Phase is
`verifying-full/verifying-control/waiting-owner/waiting-stop/settled`; counts are
both null unless a real full-audit enumeration reports safe integers satisfying
`0 <= verifiedFiles <= totalFiles`. Total comes from that candidate's validated
manifest, not a hardcoded D940 count. A high child atomically publishes a protected
`.status/control-<id>.progress.json` binding the same digest/action/ID to this
object. The native reader validates the file's identity, ACL, schema and bounds;
missing or stale progress never changes receipt state or permits another write.

Unknown or mismatched bundle identity fails closed; never silently read an old
operation from a newly enrolled candidate. A legacy host rejects the additive
actions; the UI then disables them and does not substitute legacy wake or the
standard host. Add explicit capability handling; the extension version alone is
not installed-native capability evidence.

New extension message types are `WINDOWS_ADMINISTRATOR_CONTROL_SUPPORT_V1`,
`WINDOWS_ADMINISTRATOR_CONTROL_V1`,
`WINDOWS_ADMINISTRATOR_CONTROL_STATUS_V1`,
`WINDOWS_ADMINISTRATOR_CONTROL_FENCE_V1`, and
`WINDOWS_ADMINISTRATOR_CONTROL_RECONCILE_V1`. Strip the native correlation header at
the extension boundary; their remaining fields match the corresponding request.
The worker generates native `id`, validates every reply and routes only these
allowlisted types in `background.js`. No message carries paths, script text,
PowerShell arguments, SID, tunnel ID or a host name chosen by the page.

For all new handlers, including reconciliation, require `sender.id === runtime.id`,
`sender.frameId === 0`, exact `runtime.getURL('devices.html?mode=browser-managed')`
after removal of a fragment only, and non-incognito context/tab. Reject alternate
queries, subframes, content scripts, remote pages, missing sender frame evidence
and foreign extensions. Validate native permission and the current permission
epoch before dispatch and after awaits. A page confirmation is not UAC proof.

### Reuse of protected stager and real UAC

Reuse the sealed enrolled stager and archive only. Resolve paths from the
protected binding; never use a copied control-stager, original download archive,
browser-provided path or current-directory lookup. Reuse the Pause preflight's
anchor/NTFS, selected medium token/session, commit, no-pending-enrollment,
registration, held asset, hash and ACL validation. Separate those identity/asset
checks from Pause's fresh-generation projection: only Connect/Resume need that
projection. Revoke goes directly to the verified installation's protected deny
action even when liveness is uncertain. Its helper names need not be renamed
merely to broaden their internal reuse.

Add these fixed stager adapters in the NEXT candidate:

| Proposed action | Reused mechanism / required addition |
| --- | --- |
| `CheckBrowserHostedOwnerControl` | Reuse bound-asset checks for every action; use Pause's fresh target projection only for Connect/Resume. Revoke needs installation identity, not generation/liveness. Emit capability/eligibility, not a grant. |
| `RequestBrowserHostedOwnerControl` | Existing hidden `ProcessStartInfo`, `UseShellExecute=true`, `Verb=runas`; select only a fixed high action from `control`. |
| `ConnectBrowserHostedOwner` | Reuse `ConnectHostedOwner`, `Invoke-AdministratorOwnerConnectCheck`, guarded intent write and bound Scheduler task; add ID and original UI target to its guarded transaction. |
| `ResumeBrowserHostedOwner` | Same bound task/lease/authorization checks, but require existing `paused=false`; never call the code that changes paused intent to running. |
| `RevokeBrowserHostedOwner` | Reuse `Request-AdministratorOwnerRevocation` / `Write-HostedWindowSignal` marker semantics, adding ID/receipt and guarded Pause intent. |
| `ObserveHostedOwnerControl` | Read only protected per-operation projections for the expected digest and selected SID. |
| `RequestBrowserHostedOwnerControlFence`, `FenceBrowserHostedOwnerControl` | Reuse Pause's UAC fence pattern; consume a never-admitted ID without replaying its mutation. |
| `RequestBrowserHostedOwnerControlReconcile`, `ReconcileBrowserHostedOwnerControl` | Explicit medium-to-high recovery of the same operation ID; inspect its execution lease/phases and settle by readback or authority reduction, never `Task.Run`. |

Use new strict parameters `ControlOperationId`, `ControlKind` and
`BrowserControlTarget`; the target is REQUIRED for Connect/Resume and FORBIDDEN
for Revoke/Fence/Reconcile. Retain Pause's existing parameters/protocol. Derive
`BrowserExtensionId` from the sealed enrolled origin for Connect; never accept it
from the page. Reject unused/conflicting parameters for every action. Keep
existing consent literals for legacy actions; give new high adapters fixed
`connect-browser-administrator-owner`, `resume-browser-administrator-owner`,
`revoke-browser-administrator-owner`, `fence-browser-administrator-control` and
`reconcile-browser-administrator-control` literals. These are routing constants,
not authorization evidence.

Bind the SAME interactive Windows session across each medium-preflight/high-child
pair. The trusted medium helper captures its kernel process PID, creation
identity, selected TokenUser SID, process SessionId and TokenSessionId; the two
session IDs must agree and be positive. It passes fixed internal parameters
`ControlCallerPid`, `ControlCallerCreated` and `ExpectedSessionId`, never fields
accepted from a browser page. The high child opens/holds that exact medium process
identity, verifies the expected sealed preflight image/entry and native-origin
chain, and reads its actual token/session. Require both processes' kernel session
IDs and TokenSessionId to equal `ExpectedSessionId`, and both TokenUser SIDs to
equal the selected SID. Another positive interactive session is NOT sufficient.

Also require the actual command child's enabled Administrators membership, high
integrity and TokenElevation, reusing `Assert-AdministratorBrowserIdentity` plus
the native acceptance token check. A command-line session number, membership or
`runas` request is not proof. The medium helper remains alive until the high
child publishes its validated started/identity record; only then may the long
audit continue detached. Validate and pin identity before that acknowledgement.
After the handoff, preserve the validated pair's IDs in the protected operation
evidence rather than depending on a still-running medium process. Recovery is a
new explicit UAC pair bound to its own current session; it preserves the original
operation's session evidence and checks the original runner's exact identity.
Each recovery invocation has separate identity evidence under its transport ID;
it cannot replace the original reservation's runner/session evidence.

Use the sealed sanitized launch environment/fixed image and pinned handles/bytes;
deny reparse/hard-link/path replacement. UAC cancel (1223) is a submission outcome,
not protected proof of non-admission. Do not automatically re-prompt after a
timeout, process loss or browser restart.

### Durable operations and precedence

Before dispatch, store each new browser record under
`windowsAdministratorControlJournalV1`, indexed by bundle digest and operation
ID, with exact `control,target` (target is null for Revoke) and submission state
`unconfirmed`. Serialize
updates, coordinate multiple Devices tabs, and preserve unresolved records across
worker replacement, permission removal, Restore changes and Clear Data. Refuse
new Connect/Reconnect if journal persistence fails or an earlier startup mutation
is unresolved, but keep Read Receipt and Recover Operation available. Recover
uses `control-reconcile` below, not a retry of `control`. A bounded journal must
refuse new admission rather than evict
unresolved records. Pause/Revoke remain available to reduce authority even when
Connect is pending; preserve both IDs rather than overwriting the earlier one.

Under the existing `owner-control.guard`, reserve each ID BEFORE any intent or
authorization change. New `.secrets/control-<id>.reserved.json` records are closed
objects with `version,kind,bundleSha256,userSid,origin,operationId,control,target,
observedGeneration,runnerIdentity,sessionEvidence`; `kind=reservation`, target
is null for Revoke and observedGeneration may be null when liveness is unknown.
Runner identity includes the verified high PID/creation identity; session evidence
binds the validated medium/high pair above. Reuse sealed create-new/flush/atomic publication
patterns, no overwrite. Reject a collision with any existing Pause/control
reservation or mismatched action. Duplicate submission of the same ID returns
readback only, never another intent write, UAC-generated effect or task request.
Use the same `owner-control.guard` for the cross-action namespace check; do not
introduce a second lock with competing acquisition order.

Publish selected-SID read-only `.status/control-<id>.<state>.json` with exactly
`version,bundleSha256,operationId,control,state`. States are `reserved`,
`intent-saved`, `launch-requested`, `launch-unconfirmed`, `revocation-recorded`,
`stopped`, `superseded`, `rejected`, `fenced`, `abandoned`, `recovered-paused`.
Validate legal state combinations;
partial, corrupt, contradictory or inaccessible evidence reads as `unconfirmed`.
Historical control receipts never substitute for fresh owner readiness/token
observations. Native private reservation metadata is not exposed by status.

Connect compares the ORIGINAL UI target with live revision/generation after
expensive verification and immediately before changing intent. Do not resnapshot
after UAC and turn a stale Connect into fresh authority. Extend the current
`Request-AdministratorOwnerConnect` transaction rather than taking its guard and
recursively calling it. Save the operation ID as the control revision; release
the guard before the Scheduler RPC. Recheck authorization/revision before that
RPC; the demand task still independently checks current Pause/Revoke and leases.
`resume-saved` does not write `lifecycle.json`; it requires saved-running intent,
settled old owner/inner leases, valid activation and current observer.

Revoke is installation-scoped, not generation-scoped: a newer owner generation
must not make an explicitly requested Revoke harmlessly disappear as stale.
Do not require fresh control-support, a target, known generation, Ready,
lease settlement or a live owner before requesting the deny marker. Verify the
enrolled candidate, selected SID, caller/high session pair and protected paths;
reserve ID, change the control revision,
create/read back the protected zero-byte `owner-revoked` marker FIRST, then write
paused intent as defense in depth. Preserve the marker if later work fails.
Factor an under-guard revocation helper to avoid recursively acquiring the guard
inside the existing revocation helper. A queued Connect must not clear this
marker; reauthorization is a separate local setup process outside this design.

`revocation-recorded` means future admission is denied, not that processes exited.
Publish `stopped` only after observing the recorded generation's Job drain/root
exit and inner-lease release, or proving it was idle at reservation and remained
unable to start. Extend the existing Job-finalization/readback path, not a blind
PID kill or a claim from writing a marker. Stop uncertainty retains ownership
and blocks startup; retain evidence for operator repair. Unknown liveness may be
recorded as null and never blocks the deny marker. It cannot be converted to
`idle`/`stopped` without independent protected Job/root/lease settlement evidence.

### Targetless fence contract

For an ID with no reservation, the high fence atomically creates
`.secrets/control-<id>.tombstone.json` under `owner-control.guard`. This is a
DIFFERENT closed schema from a normal reservation, with exactly
`version,kind,bundleSha256,userSid,origin,operationId,control,targetKnowledge,target`;
`kind=control-tombstone`, `targetKnowledge=unknown`, `target=null`. It claims no
original target, generation, child execution or lack of prior effect. Never
substitute the current revision/generation for the unknown original target.
Publish the public `fenced` receipt only after protected tombstone readback.
All admissions test this namespace first and reject the ID regardless of the
delayed request's target/action. The tombstone cannot be parsed as a reservation.

If a reservation already exists, Fence reports its current state without
inventing a tombstone or a no-effect verdict; Recover Operation handles it below.
Neither Fence nor a Restore toggle cancels an already accepted startup demand.

### Reserved-operation recovery and terminal unlock

Recovery actor: a fresh, explicitly requested high invocation of
`ReconcileBrowserHostedOwnerControl`, launched only through
`RequestBrowserHostedOwnerControlReconcile` / `control-reconcile`. It is the
sealed enrolled stager, not a new service, task or installer. Normal status reads
stay read-only; the UI never opens UAC automatically. Its response is submission
only; the UI reads the SAME operation ID until the protected terminal receipt.

Before reservation the original high runner acquires a per-operation execution
lease on `.secrets/control-<id>.execution.lock`, held by a native exclusive file
handle through audit, commit, task RPC and final receipt. File existence is not
ownership. Recovery can act only after acquiring that same kernel lease and
confirming the recorded runner PID/creation identity has exited; an active runner
returns pending/busy without takeover. Use short `owner-control.guard` sections
for state changes, never hold that global guard through full audit or a task RPC.
Pause/Revoke does not wait for a pending Connect's per-operation lease.

Write/flush private phase records BEFORE the respective effect:
`intent-write-started` before any control-revision/lifecycle change and
`launch-attempted` before any `Task.Run` RPC. Record the observed RPC result if it
returns, but never claim that an absent result means no task was accepted.
Phase records have exactly `version,bundleSha256,operationId,control,phase,revision`;
phase is `intent-write-started`, `launch-attempted` or `recovery-pause-started`.
Revision is null for normal phases; recovery allocates/persists its 32-hex
revision before its first Pause write, so another recovery actor can finish that
same partial reduction without minting new launch authority.
Keep original effects/unknown launch evidence when publishing a recovery result.
All delayed/duplicate original runners recheck reservation/terminal/tombstone
under the guard before effects and never resume a consumed operation ID.

| Interruption boundary, after original runner exit | Recovery action for the same ID | Terminal receipt / unlock rule |
| --- | --- | --- |
| Browser pending; no native reservation | Create the targetless tombstone above under the guard. A delayed UAC child cannot reserve it later. | `fenced`; release the browser pending slot. No invented original target. |
| Reserved or auditing; no intent-write/launch-attempted phase | Preserve reservation, mark operation consumed; do not resume audit or launch. | `abandoned`; browser pending slot releases; current native eligibility still decides any NEW user command. |
| Intent-write-started or intent-saved; no launch-attempted | If current revision is this ID, or still its original revision with no intervening control, reduce to paused intent and advance the revision under the guard. If newer control owns it, leave that state untouched. | `recovered-paused` or `superseded`; release browser slot, but never claim owner stopped from intent alone. |
| Launch-attempted; RPC result missing or launch-unconfirmed | NEVER call Task.Run again. With the same ownership check, pause/fence startup authority and advance revision; otherwise preserve newer control. Retain launch outcome as unknown. | `recovered-paused` or `superseded`; new Connect needs fresh user consent/ID and settled native owner/leases. |
| Task acceptance already recorded, final UI reply lost | Return the protected `launch-requested` receipt; read readiness independently. Recovery need not request another launch. | `launch-requested` releases browser operation slot, not native lease/admission guards. If the user instead requests cancellation, use Pause. |
| Revoke reserved, marker write/result interrupted | Revalidate stable installation identity and complete/read back the SAME idempotent deny marker without generation/liveness prerequisites; do not launch anything. Preserve marker even if later pause/receipt work fails. | `revocation-recorded` releases the browser operation slot and permanently denies Connect/Resume; `stopped` remains independent process evidence. |
| Protected evidence corrupt, inaccessible, conflicting, or runner exit unproved | Leave authority fail-closed and report the exact failed invariant. Read Receipt, explicit Pause/Revoke and native diagnostic recovery remain available. | Not a fabricated terminal success. Environmental damage/live ownership is distinct from an ordinary reserved-operation crash. |

Recovery itself uses the same execution lease and write-ahead phase/receipt rules.
If it crashes, another explicit reconciliation of the SAME ID repeats only
idempotent deny/readback/terminal publication, never audit or Task.Run. For
Connect/Resume recovery, its recorded recovery revision permits completion of
its own interrupted Pause but must not overwrite a newer explicit control; a
newer revision yields `superseded` and remains untouched. Revoke recovery is the
explicitly reconfirmed installation-wide deny action, so newer generation/revision
does not suppress its marker. Neither recovery case clears an existing Revoke.

Browser startup-mutation mutex releases on validated `fenced`, `abandoned`,
`recovered-paused`, `superseded`, `rejected`, `launch-requested`,
`revocation-recorded` or `stopped`. A transport/UAC outcome alone cannot release
it. Release archives the unresolved historical launch result; it does not delete
the ID or override current Pause/Revoke, unknown Job ownership or lease checks.
Thus an ordinary runner crash has an explicit finite route out of browser
pending, without pretending an ambiguous RPC never happened. Existing Queue
coalescing still applies to an already accepted demand; recovered Pause suppresses
it while paused, and no old tool operation transfers to a later generation.

### Observer reattachment and the automatic runtime recovery gap

Replace the current attachment latch with a worker-local single-flight attempt
plus permission epoch. Persist recovery budget in `storage.session` so worker
replacement cannot reset it: at most three automatic observer reattachments per
browser session, with successive delays of 1 second, 5 seconds and one 30-second
alarm. Each native peer acquisition
retains the existing 20-second bound; new attempts never overlap. A synchronous
connect failure or unconfirmed attachment consumes its attempt. Extra/malformed
messages are protocol failure, not transient transport loss: block automatic
recovery and require explicit diagnosis. A successful attachment changes observer
state but never resets the automatic budget, preventing attach/drop retry loops.
A manual reattach permits one observer attempt per deliberate user command; it
does not reset automatic/startup budgets and cannot dispatch a mutation.

Every recovery attachment sends existing `session,wake:false`, including after
worker replacement or permission regrant. Persist the recovery decision before
connecting. Preserve `SESSION_WAKE`; never delete it to obtain another wake.
Permission removal cancels recovery alarms, invalidates awaits and closes the
port synchronously; regrant may attach an observer but cannot reconnect high
authority. Pause/Revoke interrupts cancel pending observer timers; later explicit
status checking may attach an observer to a paused/revoked installation.

A detached high witness still closes its owner/provider immediately. If that
owner has stopped, observer reattachment alone does NOT restart it; the owner
must explicitly select Reconnect, which uses the new receipted `resume-saved`
UAC path. If native intent is paused, require separately confirmed Connect.
This is a known gap against the owner's desired automatic saved-running runtime
recovery while the extension runs. First-milestone observer reattachment and
manual Reconnect do not close it. Automatic high-runtime restart after port loss
remains deferred; describe this limitation in status/acceptance reports instead
of calling the runtime recovered. Any later automatic path must independently
honor protected saved-running authorization, Pause/Revoke, current witness,
settled ownership and unknown-operation/no-replay constraints; it needs its own
design and acceptance, not a relabeling of the observer-only behavior.

Keep the existing once-per-fresh-browser Restore demand and installation-wide
Queue coalescing semantics. A permission grant, manual observer reattach or
recovery alarm never creates that demand. A lost startup reply never resets its
persisted attempt. A fresh browser's authorized Restore is a new bounded startup
demand, not replay of a tool operation or proof the prior demand completed.
Native running intent, Revoke, current witness, operation recovery and leases are
still checked. Old providers cannot attach to a new generation. Existing queued
demands may complete against a current verified observer, as already documented;
this design makes no expired-session correlation claim.

### Verification cost and usable feedback

Separate FULL INSTALL/AUDIT from CONTROL ADMISSION. Stage/AcceptLocal,
Authorize/Enroll, deliberate Verify and evidence migration retain complete archive
hash, member/layout/closure, all-file content and all-directory/file ACL checks.
Never skip these because an operation exceeded an interactive timeout.

FIRST COMPLETION retains the existing slow full verification for Connect/Resume
and the demand/owner launch path. The new high control runner validates its
selected-account/session identity and sealed enrolled entry, reserves the ID,
publishes its started/pending receipt, then performs the full audit while holding
only its per-operation execution lease. It reports real progress and commits
under the short control guard only after verification and target recheck. The
browser/native UI wait detaches from this runner; its timeout must not kill the
runner, erase its record or cause another UAC/Connect. No loader, new service,
daemon or fast-verification scheme is required for first usable completion.
Pause and installation-scoped Revoke retain their narrow existing protected
deny-path checks and must not wait behind a Connect's full-tree scan merely to
reduce authority. No weakening of those checks is proposed.

The current `StartHostedOwner` may repeat full verification. Accept that measured
latency in this completion and show `waiting for runtime`, not a false Ready.
This design changes neither D940 performance nor its verification contract and
adds no `SkipVerify` switch. It makes a slow operation observable and recoverable,
not fast by assumption.

FUTURE OPTIMIZATION, explicitly outside the completion gate: a separately scoped
bounded launch/load verifier may later replace full scans only after a new design,
review and equivalent native handle/ACL/content/dependency-closure tests. It must
cover both control and demand/owner execution, retain pinned handles or execute
verified captured bytes, and validate every executed/imported image on use. A
writable marker, timestamp, receipt pathname or merely existing `enrolled.json`
can never authorize skipping verification. A previous full audit is not proof
today's whole tree is unchanged. If that optimization cannot establish equivalent
security, leave it unimplemented; it does NOT block the slow, receipted completion.

UI feedback is immediate (<250 ms target) after durable browser persistence:
`Awaiting Windows authorization`, `Verifying installed runtime`, `Request
recorded; waiting for runtime`, `Ready last observed`, or `Outcome unknown;
checking this operation`. Show elapsed time and operation ID. Show a count only
when native progress actually reports verified/total members. Never fake a
percentage or equate native attachment, helper launch, Scheduler acceptance,
recorded intent, revocation marker or historical receipt with readiness/shutdown.

Target status/started-receipt feedback p95 <=5 seconds excluding human UAC and
full verification; this is a measured usability target, NOT a full-operation
deadline or release requirement for a fast path. Keep each status read bounded
(5 seconds), observer acquisition at 20 seconds, and initial submission UI wait
at 30 seconds. That UI deadline must not inherit the current one-shot adapter's
short child-kill timeout for a new long-running control. Retain the medium helper
through validated high handoff; after that, the detached high runner owns the
stable operation. Expiration ends only the UI wait, not either pending UAC/handoff
or the admitted high child. Poll read-only receipt/status at 2 seconds for
30 seconds, then 5 seconds
through 10 minutes; after that stop polling with explicit unknown/pending state
and manual readback, never restart the operation. Long full verification may
continue and publish protected progress for the same ID. Background alarm-based
readback must survive worker replacement and must not send mutations. Time budgets
never cause deletion of reservations, lease takeover, another UAC prompt or a
new operation ID. Pause/Revoke remains available while Connect is verifying.

## 3. Alternatives

| Alternative | Decision and reason |
| --- | --- |
| Route administrator Connect through standard `browser-wake.js` reconnect | Reject: wrong host, authority and journal; cannot silently upgrade standard permission. |
| Clear the existing wake latch after any port disconnect | Reject: can manufacture startup demand after Pause, lost replies or permission changes. |
| Automatic high restart on transient port loss | Desired product behavior, DEFERRED GAP in this milestone. Automatic observer attachment is not runtime recovery; explicit saved-only Reconnect remains necessary after owner shutdown. No automatic reconnect completion claim is permitted. |
| Treat permission removal as durable owner Revoke | Reject: native permission withdrawal fences a browser port; protected owner revocation is a separate durable action. Do not request new native access to revoke after permission is gone; offer the local native path. |
| Keep local-only Connect/Revoke permanently | Safe present fallback, but does not complete the requested browser workflow. New controls must be capability-gated rather than pretended to exist on D940. |
| Reuse Pause's wire enums/files for all new controls | Reject: conflates historical receipts, action identity and existing parsers. Reuse helpers and invariants with additive closed contracts instead. |
| Retain full verification with detached receipted operation/progress | CHOSEN for first completion. It preserves current security and makes several-minute control/launch verification usable without retrying writes. |
| Require a new bounded loader before usable controls | Reject as a completion gate. Equivalent-security fast verification is a separately reviewed future optimization. |
| Trust a writable audit marker to skip full verification | Reject: neither a marker nor prior test success authenticates current executed bytes/ACLs. |
| Modify or silently promote D940 after its acceptance | Reject: next-source bytes need new immutable hashes and their own evidence chain. |

## 4. Detailed Implementation

### Ownership and sequencing for a future authorized implementation

This section lists future work, not changes made by this sidecar.

1. Freeze a new source/extension/runtime/stager manifest for the slow,
   detached-receipted completion. Preserve D940 as an unchanged acceptance
   baseline. No bounded-loader optimization is required for this milestone.
   Record actual review limitations; do not manufacture a cold-review PASS.
2. Add strict protocol parsers and native capability/status adapters, then the
   protected reservation/tombstone/projection reader, per-operation execution
   lease, explicit reconciliation action and action-specific high transactions
   in `scripts/Stage-WindowsAdministratorBundle.ps1`. Retain full verification;
   bind the exact medium/high interactive session before detached handoff.
3. Extend `native/desktop-commander/windows-admin-browser-host.mjs` to translate
   only the new fixed actions. Reuse the sealed Pause launcher pattern and native
   framing. Keep its retained session lifetime channel unchanged.
4. Implement worker control persistence/single-flight/precedence and bounded
   observer recovery in `admin-browser.js`; add only explicit administrator
   routing to `background.js`. Keep `browser-wake.js` standard-only. Retain
   incomplete Pause records and new control journals on Clear Data.
5. Add Devices action-specific dialogs, capability/eligibility, elapsed/progress
   and independent receipt/readiness/shutdown readback. Extend both locale
   catalogs without conflating scheduler or standard controls.
6. Add focused regressions, then isolated native high-child and Job acceptance,
   then separately authorized hosted acceptance on each supported surface.
   Integrate shared stager/protocol ownership centrally; tests/fixtures must not
   overwrite production host registration or operate D940.

### Runnable regression cases

The following existing commands are inspected entry points, NOT executed here.
Run only in a separately authorized disposable test workspace. Even Node tests
can create temporary files or subprocesses; browser/PowerShell suites have wider
effects. Do not install dependencies implicitly or treat a skipped Windows case
as proof. Extend the named suites for this design before claiming coverage.

```powershell
Set-Location -LiteralPath 'D:\Desktop\Northwestern University MSCS\[Develop]\agent-continue-repo'
node --test tests/admin-browser-tests.mjs tests/browser-wake-tests.mjs tests/windows-admin-session-dispatch-tests.mjs
node --test native/desktop-commander/windows-admin-browser-session.test.mjs native/desktop-commander/windows-admin-owner.test.mjs tests/windows-admin-intent-tests.mjs tests/windows-admin-demand-tests.mjs tests/windows-admin-host-cleanup-tests.mjs
node --test tests/device-control-tests.mjs tests/device-dialog-tests.mjs tests/device-integration-source-tests.mjs
```

The first command includes existing Windows-specific adapter tests; inspect their
temporary-path/side-effect scope before authorizing a run. The following real
browser/native suites create fixture processes and temporary registration; they
are NOT part of this sidecar's permission and must run only in an isolated Windows
test account/profile after confirming their host names/registry scope.

```powershell
node --test tests/windows-admin-session-chromium-tests.mjs tests/windows-admin-browser-chromium-tests.mjs
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -File tests/windows-admin-enrollment-tests.ps1
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -File tests/windows-browser-peer-tests.ps1
```

Required additions, with deterministic barriers/fake clocks where appropriate:

| Case | Pass condition |
| --- | --- |
| T01 Fresh permission grant | One observer, zero high launch; explicit Connect persists ID before native dispatch and requests exactly one UAC child. |
| T02 Sender/protocol matrix | Reject foreign/missing sender ID/frame, iframe/incognito, wrong query/page, extra fields, wrong digest, wrong action/ID and forged replies; zero native effects. |
| T03 Connect/Pause race | Delay UAC/full verification, commit Pause, resume Connect; original target is superseded, paused intent remains and no replacement Connect is auto-issued. |
| T04 Lost Connect reply | Worker/runner dies before/after each reservation/intent/task boundary; reload reads the same ID and offers explicit recovery; no Task.Run replay or mutation from timeout. |
| T05 Resume-saved | Saved-running + settled leases may request task once; paused/revoked/unsettled states reject without changing lifecycle. |
| T06 Observer port reattachment | Disconnect acknowledged/unacknowledged ports; attempts are bounded/persisted, never overlap, always wake=false; worker restart does not reset budget or startup attempt. Observer ACK alone must never produce a runtime recovered/success label. |
| T07 Pause/Revoke recovery race | Loss/regrant/recovery alarms racing Pause/Revoke cannot clear protected intent/marker, reset startup budget or publish stale Ready. |
| T08 Durable Revoke | No target/fresh generation required: with uncertain liveness, stale/missing owner projection or active leases, verify installation identity and record deny marker. Crash/recovery keeps same ID; stopped requires separate settlement evidence. |
| T09 Unknown/fence | No original target is known: persist the separate target=null,targetKnowledge=unknown tombstone and fenced receipt; a delayed request with ANY target cannot mutate. Reject parsing it as a normal reservation. |
| T10 Cross-action/upgrade | Same ID with changed action/target/digest, Pause namespace collision, journal corruption and candidate switch all fail closed. |
| T11 UAC identity/cancel | Test 1223, another SID, medium/filtered admin, session 0, SAME SID but a DIFFERENT positive interactive session, changed medium PID/creation identity, wrong image and missing TokenElevation; none produces accepted high-child effect evidence. |
| T12 Existing-verifier tampering | Under the retained full verifier, swap stager/archive/image, add aliases/hard links or change ACL/closure; deny high launch. No new fast loader is needed to pass this milestone. |
| T13 Slow verification | Fake a 5-minute audit and lost progress replies; UI remains pending with same ID, status reads bounded, no repeated UAC/launch, Pause/Revoke available. |
| T14 Bound path enforcement | Reject original archive/copied control-stager before effect; accept only exact enrolled paths and pins in the new disposable candidate. |
| T15 Queue B/C | Preserve documented installation coalescing; old provider cannot adopt new generation; Pause/Revoke suppress queued demand. No tool call replay. |
| T16 Stop/ownership unknown | Failed Job drain or inaccessible lease retains ownership and blocks startup; neither marker creation nor absent Ready is called stopped. |
| T17 Recovery matrix | Kill the original runner at EVERY table boundary, acquire the released kernel execution lease, reconcile SAME ID to the specified terminal receipt and release browser pending; count Task.Run and require zero recovery calls. New commands still need native eligibility. |
| T18 Interrupted recovery | Kill recovery before/after its deny/receipt write, reconcile again with same ID, and finish idempotent publication. Startup recovery preserves newer control; reconfirmed Revoke still denies across revision changes. A still-live original runner cannot be taken over. |
| T19 Runtime-recovery UX boundary | After verified owner shutdown, attach observer only: UI continues to report stopped/unknown runtime and manual Reconnect requirement, not recovered. A runtime success state needs fresh current-generation Ready; pending full-browser Restore/G2 is not a port-loss recovery PASS. |

Future fast-path tampering/dependency-load tests belong to the separate
optimization review. Their absence is not a failure of the first slow-verification
completion; missing T01-T19 behavior or native evidence still is. Passing observer
tests does not close the deferred automatic-runtime-recovery product gap.

### Native and hosted acceptance runbook

These are executable acceptance procedures for the future implementation, not
instructions to run against D940 now. Native UI cases require a separate loaded
preview and Windows authorization by the owner; no external browser automation
is authorized by this document. Existing Chromium fixtures prove only their
fixture scope; they cannot replace protected-high or hosted evidence.

1. In an isolated Windows acceptance environment, build a NEW immutable runtime
   archive, companion stager and extension preview using the existing canonical
   builder/packager; record full hashes and manifest. Full Stage/AcceptLocal and
   enrollment use their actual new candidate pins and exact consent gates once,
   not D940 receipts. Read back installation/archive/extension identity before
   any mutation; unknown setup writes stop for receipt inspection.
2. With native intent paused and no owner, load that preview, grant permission,
   verify observer-only behavior, then click Connect and approve actual UAC.
   Read the same operation's protected high-child token/identity receipt. Require
   selected SID, enabled Administrators, TokenElevation, high integrity and
   exact medium-preflight/high-child session equality and expected image. A
   different positive session of the same SID must fail. Independently observe
   owner generation and Ready after the full audit; several minutes is permitted.
3. While the owner is live, terminate only the explicitly identified disposable
   fixture native port/process by PID plus creation/image identity. Require old
   provider denial and Job/root settlement; observe bounded wake=false reconnect.
   That observation is transport reattachment only: require stopped/unknown
   runtime feedback, not a recovered label. Click Reconnect; verify native
   saved-running-only admission and fresh Ready for a new owner generation.
   Never replay an in-flight tool command. Repeat with paused and revoked states
   and require no restart. Record automatic runtime recovery after port loss as
   deferred, not passed by this manual case.
4. Pause through the UI, read `pause-recorded` then real `stopped`; reopen the
   test browser with Restore enabled and require no unpause. Test delayed UAC
   Connect against a newer Pause and the B/C Queue scenario. Leave unknown
   shutdown owned rather than cleaning up evidence to get a pass.
5. Revoke through the UI during idle, startup, unknown-liveness and active
   disposable work without supplying or refreshing a generation target. Read
   `revocation-recorded` and verify current admissions fail; read `stopped` only
   after actual Job/root/lease evidence. Reopen/regrant/attempt Reconnect and
   require durable denial. Permission removal alone must be reported as a
   browser fence, not this durable Revoke.
6. In that environment only, authorize hosted tests separately: ordinary ChatGPT
   and Dot each perform command/file/process operations restricted to disposable
   paths/processes, with actual tool-call and high-child evidence. Repeat lost
   port, Pause/Revoke and unknown-outcome checks per surface. Local acceptance,
   fixture liveness and a connected tunnel do not substitute for these receipts.
7. Interrupt the original high control runner and then its explicit recovery at
   each reserved-operation boundary. Verify protected phase/terminal receipts,
   same-ID browser unlock and no recovery Task.Run. Also test an unreserved
   pending ID whose original target is unavailable: fence must consume it with
   the distinct unknown-target tombstone, not a fabricated current target.
8. Record elapsed verification/admission/drain phases and p50/p95 over repeated
   NEW authorized operations, not retries of unknown ones. Require no writes to
   unrelated tasks, accounts, keys, host registration, production VPN/MCP/IDE or
   research. Check exact owned-fixture cleanup without broad process killing.

### Immutable-candidate evidence migration and remaining blockers

Never mutate an accepted D940 package, its `.browser` assets or receipts. Future
implementation creates a new digest-derived installation and a separately pinned
preview/stager. Evidence records need candidate digest, stager digest, extension
digest/actual origin, source snapshot, test input hashes, operation IDs,
surface, times and observed scope. Preserve D940 evidence unchanged as historical
high-backend evidence; carry forward only explicitly unchanged source/test
observations, never installed acceptance or authorization by implication.

A future cutover needs a separately authorized plan: reconcile old unknown
operations, obtain protected Pause/Revoke and exact Job/lease settlement, preserve
receipts, and verify ownership before any registration change. The global host
name is shared, so an isolated acceptance environment is mandatory while the
parent is using D940. Do not borrow its keys/binding/activation, overwrite its
host, or copy running intent/unknown operation IDs into a new installation.
New native enrollment and selected-account authorization remain explicit; schema
upgrade must not silently authorize a new digest. Old browser records stay
digest-scoped readback/history, not new-candidate commands.

First-completion blockers: additive control/journal/native projection and recovery
implementation/review; exact medium/high session binding; detached stable
pending/progress with the existing full verifier; actual high-child plus Job
acceptance for the new controls; safe isolated candidate enrollment; and
per-surface hosted evidence. Bounded launch/load optimization is explicitly
DEFERRED and is not one of these blockers. Until first-completion work closes,
report this as a design, not delivered control functionality. No
full EGM source-completion, independent/cold review, production readiness, D940
hosted result or next-source acceptance is certified by this document.

Separate desired-product gap: automatic authorized saved-running runtime recovery
after transient port loss while the extension runs remains DEFERRED. Completing
the first manual-control/observer milestone does not complete that product goal.
D940's parent-reported G1 hosted proof/shutdown and G2 browser-reopen Ready,
fresh High command, UI Pause and pause-preserving reopen are separate evidence
and do not close this gap. Dot scope/acceptance also remains pending.

### Accepted-findings reconciliation ledger

The parent relayed these findings from the separate subagent Cicero. All five
are accepted for this document revision. This attribution records the parent's
report of review provenance, not sidecar verification of reviewer identity or
context isolation. The ledger records design changes and required future
evidence, not executed tests, implementation closure or certification.

| ID | Accepted finding | Reconciled design decision | Required verification |
| --- | --- | --- | --- |
| R1 | Revoke cannot depend on a fresh generation target. | Separate targetless Revoke request; installation identity/session validation only for deny admission, including unknown liveness/active leases. Marker and stopped remain distinct. | T08 plus native runbook step 5. |
| R2 | Reserved crashes need an actor, interface and terminal unlock at every boundary. | Explicit high `control-reconcile` actor, exclusive execution lease, write-ahead phases and recovery matrix. Settle by readback/abandonment/authority reduction, never Task.Run replay; terminal receipts release browser pending without bypassing native guards. | T04, T17, T18 plus native step 7. |
| R3 | Targetless Fence must not invent an original target. | Separate closed `control-tombstone` schema with `targetKnowledge=unknown,target=null`; consume ID across all delayed request targets/actions, never parse as reservation. | T09, T10 and native step 7. |
| R4 | A bounded loader must not gate usable completion. | First milestone retains full verification and detached stable receipted pending/progress. Fast launch/load verification is a separately reviewed future optimization, removed from first-completion sequencing/blockers. | T12, T13 and native timing observations; no fast-path PASS claimed. |
| R5 | Positive session numbers do not bind the same interactive Windows session. | Kernel-verified medium PID/creation/token/session handoff; exact equality with high child and selected SID before acknowledgement, with original/recovery evidence kept separately. | T11 plus native step 2's same-SID/different-positive-session refusal. |

The subsequent D940 G1/G2 final progress update and automatic-runtime-recovery scope
clarification came from the parent, separately from Cicero's R1-R5 findings.
They are recorded above as parent-reported evidence and an explicit remaining
product gap, not added to Cicero's review or promoted into a new review verdict.
