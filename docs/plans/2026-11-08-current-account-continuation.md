# Current Account Fresh-Install Continuation

## Problem

At dac48d6 the Setup client/controller already distinguish current-account
consent, setup identity and extension identity. The native installer still
rejects BrowserSetupId outside Administrator, the actual device_wake host does
not implement the scoped proof action, and background.js supplies no current
account adapter. Injected tests do not establish a working continuation.

The required source flow is one fresh installation, a correlated read-only
installation proof, and at most one admitted reconnect from the unchanged
consenting Setup document. Existing-install recognition remains read-only and
must not create a setup receipt or unpause an existing installation. A request,
an operation receipt and observed readiness are distinct evidence.

## Technical Plan

Reuse the current-account state root, native binding, browser owner and existing
device-operations reconnect journal. Do not change administrator admission,
entry acquisition, payload resolution, credentials or platform approvals.

After a successful fresh guided BrowserManaged install, install.ps1 verifies the
installed provider stage and exact installed native binding, then calls the
installed device-operations module to create browser-setup.json with create-new
semantics. The canonical record binds setupId, current-account scope, exact
extension ID and the SHA-256 of canonical native-binding bytes, plus a 900000 ms
publication lifetime. File reads are bounded and identity checked; malformed,
linked, expired, changed or absent records fail closed. No ACL acceptance is
claimed by these source checks.

The publisher record is closed: format=agent-continue-current-account-setup,
version=1, action=reconnect, setupId, scope=current-account, extensionId,
bindingSha256, createdAt and expiresAt. Binding bytes are JSON.stringify of
{format:agent-continue-native-binding,version:1,extensionId,stateRoot} plus LF,
using the exact retained native binding's stateRoot. Native scope authority is
the current-account installer/host path, not a caller-selected elevation mode:
the writer and host have no administrator dispatcher or elevation action.
This does not independently attest to a Windows token's integrity level.

Freshness means lifecycle.json is absent and device-operations.jsonl is either
absent or exactly the existing version-1 header with zero operation rows. A
new owner's device-channel.json, controller lease and operation lease are
allowed preparation; they are not permission to reconnect. The installer
publishes only after its original fresh-install branch succeeds, never after
the earlier existing-install return. Proof and final native admission repeat
the freshness checks. A settled operation, including Pause, is not fresh.
Missing runtime markers do not establish historical freshness. The unchanged
Test-ExistingBrowserInstall treats any root attributes, file, partial directory,
denied read or unknown error as existing; only OS not-found outcomes enter the
fresh branch. Existing recognition and registry/bundle conflict guards remain
in force. Only that branch's verified browser-managed install-local result can
call the publisher, which is not a browser action.

The actual native host is device-native-host.mjs. Its read-only
current-account-setup-status action validates the native origin and closed
request before reading the setup record; it never starts an owner. A setup-only
frame on the existing browser-owned long port carries the original reconnect
operation ID and the exact setup tuple. It is not a new generic control action.

Native consumption creates browser-setup-consumed.json once, before any effect.
The existing openDeviceOperations constructor registers a private in-process
lease witness only after acquiring its create-new operation lease and validating
the retained journal. Scoped dispatch requires this exact witness, which checks
root/lease/journal identity and zero operations before and after consumption.
Generic requests from other processes reach this same owner through existing
authenticated IPC; a second operation owner cannot acquire the lease. No await
separates these checks, consumption, permit use and the standard journal append.
The consumed record is closed: format=agent-continue-current-account-setup-consumed,
version=1, action=reconnect, setupId, scope=current-account, extensionId,
bindingSha256 and operationId (a lowercase UUIDv4). A module-local map contains
only the currently executing synchronous setup dispatch, keyed by exact root
and storing this full consumed record. The host calls the scoped dispatch
helper, which validates the full setup frame, creates and rereads consumption,
sets the permit, and invokes owner.request({version:1,id:operationId,action:reconnect})
without an intervening await. operations.handle checks and consumes this exact
root/ID/record permit before its existing journal append. Its outer finally
deletes the permit even on synchronous failure or a callback that delays
dispatch. Status never consumes it; unrelated IDs cannot use it. No new setup
fields pass through generic device request validation. The existing owner calls
its operation handler before its first await, so the permit cannot survive as
restart authority. A crash or
uncertain write retains the reservation and permits only original-ID observation,
never another reconnect. Duplicates query the original status; missing journal
evidence is unconfirmed. An operation-ID collision is rejected by freshness,
not adopted. Partial/malformed reservations or disagreement with the journal
deny startup without repair. Generic reconnect, canRestoreSavedIntent and the
read-only deviceOperationRecoverySettled helper all consult this reservation;
only an exact terminal reconnect row resolves it for explicit control. This reservation never adds
a new Pause rejection. Existing journal poison/full/ownership failures can still
reject Pause admission, so an independent Pause lane is not a confirmed-stop
guarantee and errors must remain visible.

Automatic saved-intent restoration additionally requires browser-setup-success.json,
a create-new canonical record with format=agent-continue-current-account-setup-success,
version=1, action=reconnect, the same setup/scope/extension/binding/operation tuple
and outcome=ready. Only the first dispatch can publish it, after a correlated
settled reconnect response observes paused=false and connection=ready. A settled
failed/stopped result, not-executed result, unknown/in-progress/unknown-running
result, malformed receipt or missing success record cannot authorize restoration.
Original-ID status remains available; an explicitly consented later control is
not an automatic retry. A saved-running lifecycle intent is still separately
required, so success history never overrides an explicit Pause.

The irreversible reconnect-admission point is the existing operation journal's
in-progress row write and fsync before controller.reconnect is invoked. The
earlier consumed record reserves an attempt, not a successful admission. Worker
consent withdrawal cancels preparation through the final send callback. A frame
already sent may reach native admission before cancellation is observed; it is
not retractable and remains subject to its original receipt and explicit Pause.
Native permission loss closes the owned pipe; native binding revocation denies
subsequent binding checks. Current-account control has no separate native Revoke
transition. No instantaneous cancellation after admission or rollback is claimed.

Create-new, fsync and identity readback are source/process-crash consistency
checks when the acknowledged filesystem data survives. Tests do not establish
Windows OS power-loss persistence, directory metadata durability or crash-proof
storage hardware. Missing or inconsistent retained records fail closed without
repair or replay; Windows deployment/ACL/power-loss acceptance remains separate.

The proof request is exactly {version:1,id,action:current-account-setup-status,
scope:current-account,extensionId,setupId}; its response adds only state and
bindingSha256. Installed uses the exact digest; unconfirmed uses null. The
connect frame is exactly {version:1,id,action:current-account-setup-connect,
setupId,scope:current-account,extensionId,bindingSha256}, with id a lowercase
UUIDv4. The host returns the existing correlated standard reconnect envelope.
createdAt/expiresAt are safe nonnegative integer Unix milliseconds; new admission
requires createdAt <= now < expiresAt and expiresAt-createdAt=900000. Publication
and consumed records use canonical JSON plus LF, lowercase hex digests, a
32-character lowercase-hex setup ID and the exact 32-character extension ID.
Expiry blocks new admission but never the exact consumed operation's read-only
status: duplicates validate the retained consumed tuple and query that ID,
without refreshing consent or creating another reconnect.

The new current-account-setup.js adapter reserves and verifies its original
operation record in extension local storage before transport. Reservation and
readback are serialized by a per-setup browser Web Lock, also used by restarted
adapter instances; no lock is treated as native authority. It consumes that
attempt on every uncertain return and never replaces an ID. browser-wake.js
must provide a narrow internal setup send hook using the existing owner,
mutation fence and independent Pause/status lanes. Permission withdrawal and
Pause invalidate preparation synchronously; the final transport checks the
initiating-document admission callback. Background injects this real adapter.

## Alternatives

- Do not remove the administrator guard or feed current-account data into
  administrator control, targets or bundle identity.
- Do not invoke a generic reconnect after observing only registration or a
  matching path. Only the fresh, unconsumed, exact native receipt is eligible.
- Do not start a separate one-shot native owner: it would compete with the
  existing browser owner and lose the established lifecycle/Pause machinery.
- Do not replay a failed install, receipt write, port send or reconnect. Retain
  the original record and report uncertainty without inferring readiness.
- Do not add a general queue, new installer framework, automatic retry service,
  credential transport or new permission bypass.

## Detailed Implementation And Acceptance

1. Add the bounded receipt publisher/reader and scoped consume/dispatch helper
   to device-operations.mjs with focused scratch/mock tests. Any previous
   lifecycle marker or journal mutation, even a settled Pause, fences automatic
   fresh continuation. Existing standard device request validation stays closed.
2. Extend device-native-host.mjs and its focused stream tests for correlated
   setup-status and setup-only long-port frames, validating origin, setup,
   extension, binding, operation ID and exact field sets before dispatch.
3. Add only a BrowserSetupId current-account admission branch and post-success
   publication helper to install.ps1. Keep the existing administrator branch
   intact. Existing-install return precedes publication. The helper uses fixed
   JavaScript source and argument data, verifies installed code before import,
   publishes proof only and never connects. Test with source/parser/mocks only.
4. Add current-account-setup.js, background injection and the narrow extension
   wake hook. Test reservation readback failures, unknown replies, concurrent and
   restarted callers, same-ID recovery, permission cycling, Pause and late results.
   Keep the operation's requested/unconfirmed result distinct from readiness.
5. Route Current account through createSetupClient only after real worker wiring
   exists. Require fresh connectionConsent, not the old persisted install-only
   boolean. Retain existing administrator behavior, closed Advanced and truthful
   pending/unknown feedback. Test the actual page source without live browsing.

The permitted write set is this plan; device-operations.mjs and its tests;
the actual native wake transport and focused tests; install.ps1 and relevant
current-account protocol/installer tests; current-account-setup.js and focused
tests; background.js and source integration tests; and setup.js/setup.html plus
client/UI source tests. The extension-side browser-wake.js hook is required and
was explicitly authorized by the parent before editing. device-owner.mjs,
bootstrap bin.mjs, setup-entry.js, packaging/workflows and main handoff/runtime
documents remain read-only. The parent owns adding the adapter to the fixed
package allowlist and live CI/browser acceptance.

RED must demonstrate each missing behavior before implementation. GREEN must
cover fresh success through the real modules with fake platform dependencies,
no existing adoption, malformed identity, Pause/permission/consent cancellation,
durable write uncertainty and no replay after restart. Run focused regressions,
syntax/parser checks and diff review. Do not execute native entrypoints, install,
register, connect a real runtime, change ACL/services/VPN, use credentials, browse,
commit or publish. Stop at a coherent tested source checkpoint and report exact
changed files, tests, remaining integration obligations and evidence limitations.
