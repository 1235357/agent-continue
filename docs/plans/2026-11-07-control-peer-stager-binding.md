# Control Peer To Stager Binding

## Problem

The next-source C# kernel peer API exists but the PowerShell stager has no
archive-bound loader or typed projection into its existing operation store.
Do not pass an adjacent mutable C# file or browser-supplied PID record as a
validated session. This slice belongs to the full Windows control goal; it does
not replace detached handoff, public actions or real lifecycle acceptance.

## Technical Plan

Parent edits only Stage-WindowsAdministratorBundle.ps1 and this design/results.
Parent owns tests/windows-admin-control-peer-binding-tests.ps1 for archive/compiler
behavior and tests/windows-admin-control-peer-projection-tests.ps1 for typed
witness behavior. The initially delegated archive fixture remained a presence-only
skeleton; that worker was closed and parent completed the behavioral tests.
A separate read-only reviewer audits the implementation and test artifacts.
No public action or support flag is enabled by this slice. No installed D940,
local scheduler, browser, registry, task, UAC, tunnel or credentials are touched.

Three internal functions are the contract:

1. Read-AdministratorControlPeerSource([IO.Stream] Archive,[string] Digest):
   require readable seekable non-writable stream and lowercase64hex digest.
   Bound archive to totalLimit and entry count to manifestLimit. Hash the entire
   held stream from offset0 and require exact digest before opening its ZIP.
   Leave caller stream open and restore its position even after refusal.
   Require exactly one case-insensitive match for app/windows-browser-peer.cs,
   whose name is the exact case, and length1..65536. Reject directory/symlink
   attributes. Read exactly the declared bytes, require EOF, strict UTF8 and no
   NUL. Return exact byte[] (unary-comma), without normalization or compilation.
   This proves bytes/digest only, NOT archive ACL, enrollment or OS identity;
   later callers must hold their already verified sealed archive handle.
2. Get-AdministratorControlPeerType([byte[]] Source,[string] CompilerTemp):
   require nonempty bounded strict UTF8 no NUL. Require a fully qualified
   canonical local-drive compiler directory before checking its private sealed
   ACL using Assert-SealedAcl(CompilerTemp,true,true). Reject relative,
   drive-relative and UNC paths; a later CWD change must not reinterpret the
   path that was ACL-checked. Compile
   in memory with framework CodeDom, temp/TMP confined to that directory and
   working directory System32, restoring previous environment/CWD in finally.
   Return AgentContinue.WindowsBrowserPeer from the compiled assembly; no
   global Add-Type reuse. Never run shell, enable support or write receipts.
   Compilation may use framework csc/temp files, not a distributed project EXE.
3. Open-AdministratorControlKernelSession([Type] PeerType,[string] BundleRoot,
   [string] Digest,[string] Origin,[string] Id,[string] Control,[string] Mode,
   untyped nullable Target,[uint32] CallerPid,[string] CallerStarted,
   [int] SessionId,[string] Sid): call exact peer OpenControlSession, and require
   returned actual nested ControlSession, alive. Project kernel uint32 PIDs to
   bounded positive Int32 for the existing strict JSON serializer, preserving
   DateTime UTC tick strings, selected SID and session. Return hashtable with
   Witness (caller owns IDisposable lifetime), Runner {pid,started}, Session
   {mediumPid,mediumStarted,highPid,highStarted,sessionId,userSid}. Validate
   projection with Get-AdministratorControlReservationBytes using original ID
   and target (mode control only; fence/reconcile need only the same typed pair
   shape and must not create a reservation). Target must be null or a string,
   preserving null rather than coercing it to the empty string. PS5.1 direct
   static invocation does coerce null strings, so invoke the exact public static
   signature via MethodInfo and object[] instead. Validate pair
   scalars for every mode before any serialization. Recheck witness.Alive before return.
   On any error after witness acquisition dispose it; never dispose on success.
   Production PeerType must come from function2 applied to function1 output.
   The type parameter is an internal test seam, not an external authority input.

## Alternatives

Do not publish current partial controls, compile user paths in a high child,
use remembered source hashes in place of current archive bytes, turn all proof
fields into strings, accept shape-only objects, or alter accepted D940. Holding
the actual witness remains required after projection; a serialized record alone
does not grant authority. At later integration, hold it through publication of
the protected original runner/session reservation and the handoff ACK. The long
audit after that durable handoff must not depend on the medium process staying
alive; retain the original IDs and the high runner's operation lease instead,
as required by the completion design. This slice does not implement that ACK.
Lower/upper-case and invisible differences are not
normalized. Full bundle closure and task checks remain mandatory at integration.

## Implementation And Acceptance

AST-extract functions for scratch tests; never invoke full stager dispatch.
Start RED on missing functions. Build tiny in-memory ZIP fixtures, not runtime
payloads or credentials. Exercise position restoration, wrong digest, malformed
ZIP, absent/duplicate/case-mismatched/oversized/NUL/invalid-UTF8 sources,
read-only stream requirement and actual byte equality. Compile actual current
C# using a scratch compiler directory with ACL check explicitly stubbed; record
that this is NOT protected compilation acceptance. Positive high pair cannot
be proved from a medium test process: actual peer call must refuse it without
UAC. A separate fixture-only fake typed peer may test disposal and projection,
explicitly not OS proof. Preserve existing peer/ledger/observation regressions.

Fresh independent code review follows executed tests; record exact hashes and
whether high admission, actual protected ACL and installed/public routes were
observed. This is a bounded autonomous EGM-style adaptation, not complete source
adoption or completion-adapter certification.
