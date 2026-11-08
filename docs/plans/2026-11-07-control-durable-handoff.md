# Kernel Admission To Durable Control Handoff

## Problem

Archive-bound peer loading and the control transaction exist separately. A long
audit must not require the medium launcher to remain alive after a proven
handoff, but neither a runas request nor a serialized PID record is that proof.
Integrate the actual kernel witness with durable transaction admission and a
bounded public acknowledgement, retaining original operation identity.

## Technical Plan

Parent owns stager changes and behavioral tests. An independent read-only reviewer
checks design/code/tests. This is a bounded autonomous EGM-style adaptation, not
full source adoption/certification. No installed D940/local scheduler/browser,
production VPN/MCP/IDE/research, UAC/task/registry/tunnel or key action.

Internal entry Invoke-AdministratorControlKernelOperation consumes a held already
sealed/enrolled archive, fixed bundle/digest/origin/SID and original ID/control/
mode/target plus actual medium PID/UTC ticks/session claims. Its trusted binding,
audit, startup and Task callbacks come from future fixed stager dispatch, NEVER
from a browser. Verify binding before digest-bound compile/kernel acquisition;
use existing ReadSource/GetPeerType/OpenKernelSession, not record-shaped proof.
Then dispatch mode control to Invoke-AdministratorControlOperation, or mode
fence/reconcile to Invoke-AdministratorControlRecovery (new FenceOnly switch).

Add an optional internal Handoff callback to both transactions, default absent
for unchanged callers. Call it exactly once under the original execution lease
and control guard after validated reservation+reserved receipt (new control), or
after checked prior reservation/tombstone (duplicate/readback). Exact OS sharing
violations 32/33, only when the new Handoff callback is present, use a guard-bound
busy readback path: validate original evidence/target and publish the new peer
handoff without acquiring/replacing the original execution lease or mutating
intent, phases, result or task. Missing/corrupt/colliding original evidence refuses.
Other errors propagate. For recovery, validate record/tombstone consistency;
when no original exists, publish the original-ID tombstone and fenced receipt
BEFORE handoff, so an ACK failure cannot admit a late original. Otherwise handoff
precedes recovery authority reduction.
FenceOnly returns Fence-AdministratorControlOperation; it must never invoke
RunnerExited, recover/pause an admitted original, audit or Task.Run.

Handoff callback rechecks the held peer Alive, persists an immutable PRIVATE
control-peer record containing the new actual runner/session pair, rechecks Alive,
then persists/readbacks a PUBLIC control-handoff acknowledgement. Only then mark
handoff complete and dispose original medium-chain witness. The long audit and
later binding checks must no longer depend on medium liveness. The original
per-operation reservation runner/session must not be overwritten on duplicate,
Fence or Reconcile. The existing kernel execution lease remains through work.
Failure before public ACK disposes the witness and must not audit/launch/change
intent. Failure after private-only publication leaves original-ID recoverable
evidence, not authorization to replay. A public ACK proves handoff, not a
successful control effect or Ready runtime.

Admission linearizes at the final held-kernel liveness sample before public
publication. It is not an atomic assertion that a process is alive at filesystem
visibility. No later sample rejects a medium that legitimately exits after seeing
ACK. Protected binding remains checked after handoff: the integrated entry's
trusted verifier must return exactly boolean true, initially and at every later
guarded verification; false/null/other output refuses, as does a thrown error.

## Data And Interfaces

Get-AdministratorControlHandoffId(Digest,Id,Control,Mode,MediumPid,MediumStarted,
SessionId,Sid,HighPid,HighStarted) returns first32 lowercase SHA256 hex of exact ASCII fields joined
with |. All fields are canonical bounded identifiers; no normalization. Its
identity is derived from original request and actual medium AND high process identity,
not wall-clock freshness. This is correlation, not a secret or grant.
Replacement high processes get independent peer sidecars even for the same medium
request; original operation ID/reservation remains unchanged. Future medium ACK
discovery must validate the actual high attempt, not guess an ID from only medium
metadata. That CLI/waiter integration is not implemented by this source change.

Private file control-<handoffId>.peer.json and public file
control-<handoffId>.handoff.json reuse existing immutable bounded writer and
selected-SID ACL contracts. They do not collide with original reservation/lease
suffixes. Private row ordered fields: version=1,kind=control-peer,bundleSha256,
userSid,origin,operationId,control,mode,handoffId,runnerIdentity,sessionEvidence.
Public row ordered fields: version=1,kind=control-handoff,bundleSha256,
operationId,control,mode,handoffId,state=validated. Neither public PID/SID nor
credentials/paths/account/tunnel data. Both UTF8 compact JSON plus LF, <=2048.

Get-AdministratorControlHandoffBytes validates canonical pair via the existing
closed reservation serializer in a discarded neutral revoke/null-target shape;
it never publishes a fabricated reservation. Persist only the actual control/
mode peer record. Publish-AdministratorControlHandoff requires a trusted peer
liveness callback returning exactly boolean true before private and public
writes. Return handoffId only after immutable readback. A separate read-only
Read-AdministratorControlHandoff validates expected exact public bytes for a
known handoff ID, returning false for absent/corrupt/mismatch/unreadable evidence.
It is not operation-result readback or permission to retry.

## Alternatives And Acceptance

Do not add public support/actions while sealed CLI binding/detached medium loop
and all real acceptance remain incomplete. Do not mutate accepted D940, use a
new operation ID after uncertainty, require the old medium forever, fake a high
pair, skip full audit, or call legacy Connect recursively under the guard.

Tests AST-extract only definitions. Use scratch files with explicitly stubbed
ACLs and test-only typed witness/callback seams, never full stager dispatch or
real tasks/UAC. Cover canonical peer IDs/private/public bytes, identity/type
refusals, private-before-public order and partial publication, dead-before/
between checks, duplicate collision, same-ID readback, admission callback before
audit/intent/task, duplicate/tombstone without replay, FenceOnly no recovery,
callback failure stopping effects, and detached continuation after witness
disposal. Existing store/operation/peer/observation regressions must remain green.
Record actual execution separately from static review and positive OS high-pair/
protected ACL/installed/public endpoint acceptance (all still unproved).
