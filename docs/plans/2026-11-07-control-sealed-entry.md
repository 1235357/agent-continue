# Sealed Control Entry And Medium Waiter

## Execution Status (2026-11-07 12:51 UTC)

Source implementation and scoped regressions completed, not installed acceptance.
Review found missing early-entry SHA ownership and an ACK exit/deadline race;
both reproduced RED and fixed GREEN. Final entry75/646, real full-verifier3/56,
observation416/7089 and combined ledger15/15 pass on actual SystemPS5.1; existing
Node controls80/80 pass. Positive high/owner/ACL/task/kernel seams are explicitly
disclosed. Support projection and real new-candidate lifecycle remain next.
See 2026-11-07-control-sealed-entry-results.md for frozen inputs and exact scope.
The Problem and Technical Plan below describe the pre-implementation checkpoint.

## Problem

Internal typed admission, original-ID transactions and durable handoff now exist.
The eight fixed medium/high action names and caller parameters are still absent
from the stager entry. Browser controls cannot use that code. A fire-and-forget
Pause launcher is insufficient: high admission requires the actual medium and
Chrome/Node ancestors alive through ACK. Never replay a settled D940 operation
or change the owner's live scheduler/Pause/production connection for this work.

## Technical Plan

Parent owns stager implementation and AST/scratch tests. Sidecar independently
maps current native argv contract and reviews bounded changes. This is an
autonomous EGM-style adaptation, not complete source-reading certification.
No installed state, UAC/task/registry/key/tunnel/network or desktop input actions.

Add the three RequestBrowserHostedOwnerControl[|Fence|Reconcile] actions and
ConnectBrowserHostedOwner, ResumeBrowserHostedOwner, RevokeBrowserHostedOwner,
FenceBrowserHostedOwnerControl, ReconcileBrowserHostedOwnerControl. Bind
BrowserControlTarget as an optional string but NORMALIZE ABSENCE TO CLR NULL;
reject a present target on revoke/fence/reconcile, even empty. Add bounded high
caller PID, canonical UTC .NET creation ticks and positive interactive session.
Validate exact canonical action/kind/parameter sets/consent before any preflight
or effect. These actions get a distinct early dispatch before the observation
guard; all new parameters on legacy/observation actions still fail closed.

Medium reuses the existing sealed Pause preflight (actual medium token/session,
NTFS/system anchors, enrollment/registry/stager/archive pins). Capture its actual
current Process handle/UTC start/session/SID; high independently verifies those
claims and exact argv/ancestry with the existing C# witness. Construct system
PowerShell runas/Hidden/System32 launch in exactly C# ControlArguments order.
Keep medium and the returned child handle until a maximum15second ACK wait ends.
Derive ACK identity from medium AND actual returned child's PID/start, not the
launch timestamp or a browser-supplied identity. Read exact protected public ACK
before checking child exit. No kill/abort/retry. Only exact verified ACK returns
requested; only actual Start Win32 cancellation1223 returns cancelled. All other
outcomes remain original-ID unconfirmed. Dispose handles without killing children.

High derives the selected installation solely from canonical System/ProgramFiles,
sealed stager/archive paths, committed enrollment, pinned stager bytes, closed
public binding and private demand metadata. No browser-supplied root, origin,
tunnel ID, key or callback. Reconstruct the existing enrollment plan, verify its
exact assets and registration, and keep an archive read handle denying writes.
Invoke existing kernel operation; trusted callbacks recheck protected binding,
run complete Get-Layout/Verify-SealedBundle with progress after handoff, inspect
the fixed existing Scheduler task and owner activation under guard before startup,
then call that task once outside guard. Revoke/Fence/Reconcile do not call startup
or task callbacks. Do not recursively call legacy Connect or create tasks.

## Alternatives

Do not replace native argv validation, synthesize a high token, compile user
provided source, use raw FILETIME as UTC ticks, acknowledge Process.Start alone,
kill on browser response timeout, or mint a new operation after uncertainty.
Support/eligibility projection remains a separate incomplete gate; do not add
CheckBrowserHostedOwnerControl or advertise usable installed controls in this
slice. These fixed source actions require a rebuilt/enrolled candidate before
real acceptance; no old digest pair reuse or production hot patch.

## Detailed Implementation And Acceptance

Internal functions: Get-AdministratorControlEndpointRoute, strict parameter
validator, fixed high launch plan, actual caller capture, bounded ACK waiter,
medium request orchestration, sealed high binding/readback, high orchestration.
Top dispatch invokes only fixed trusted callbacks, loads the system Utility
module under Desktop x64, and returns closed submission/receipt or sanitized
input/preflight failure. No arbitrary backend error/path output.

Tests first fail on absent APIs. AST imports definitions only. Pure envelope
matrix checks all routes, target absence/null, key case/duplicates/unknown keys,
PID/ticks/session/SID/consent and legacy refusal; launch vectors match native
argv exactly. Scratch/fake process waiter tests ACK-before-exit, wrong metadata,
timeout, partial/corrupt ACK and disposal without kill/retry. Medium orchestration
tests preflight/capture/start/wait order, cancellation1223 versus unrelated error,
one launch and original-ID response. High orchestration uses explicitly declared
binding/OS/task/verification/kernel seams and asserts held stream ownership,
complete-audit/progress binding, selected origin/SID, and task separation. Existing
observation guards adapt only to the eight intentional actions, retaining all
old key/case/dispatch assertions. Full control/peer/scheduler regressions follow.
No stub or source test substitutes for actual high/protected/browser acceptance.
