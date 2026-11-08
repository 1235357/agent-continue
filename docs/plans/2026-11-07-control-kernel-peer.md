# Kernel-Bound Administrator Control Peer

## Problem

The existing control reservation serializes a medium/high session pair but does
not prove it. The new public mutation routes must not accept browser-supplied
PID/session/SID claims as authority. Reuse the native process-handle reader and
the existing Chrome/CMD/sealed-Node ancestry policy instead of a WMI lookup or
unbound process/session number. Preserve the independent scheduler and immutable
installed D940. This is next-source work, not installation authorization.

## Technical Plan

Add two APIs to AgentContinue.WindowsBrowserPeer in windows-browser-peer.cs:

- CaptureControlCallerIdentity(): selected current medium PowerShell process,
  no thread impersonation, positive matching process/token session, actual SID,
  integrity8192, not elevated, no enabled administrator membership. Return a
  disposable handle-backed ControlCallerIdentity with ProcessId(uint),
  Started(string canonical DateTime UTC ticks), SessionId(int), UserSid(string),
  Alive(bool). This is identity data, not an authorized operation or sealed entry.
- OpenControlSession(bundle,digest,origin,id,control,mode,target,callerPid,
  callerStarted,expectedSession,expectedSid): verify current high PowerShell
  command runner and the held original medium process plus native host ancestry.
  Return disposable ControlSession containing MediumPid/MediumStarted,
  HighPid/HighStarted,SessionId,UserSid and Alive. It never starts a process or
  writes evidence. The later stager must publish/pin this evidence before ACK;
  detached handoff is NOT implemented by this primitive.

Both use only local kernel process/token APIs. Reuse NativeProcess, augmenting
it with actual TokenElevation and enabled Administrators membership readback.
Retain checks for process TokenSessionId equality. Convert GetProcessTimes
FILETIME to DateTime.FromFileTimeUtc(...).Ticks before public serialization;
the private ancestry ordering remains in its existing FILETIME unit.

OpenControlSession requires x64, no thread impersonation, exact lowercase64hex
digest and32hex ID, canonical bundle with basename digest-prefix24, exact origin,
selected local/Azure-user SID, positive expected session and bounded canonical
caller ticks. Mode is control/fence/reconcile. Control is connect/resume-saved/
revoke. Target is revision:generation-or-idle for connect/resume in control mode;
target is null for revoke/fence/reconcile. No Unicode normalization or linguistic
comparison of identity values is allowed.

Hold current high and original medium native handles. Both SID and kernel/token
session must match expected values; medium must predate high, PID must differ,
high must be elevated enabled administrator at integrity12288, medium must be
unelevated non-administrator at integrity8192. Require actual System32 PS5.1
images. Validate both exact argv vectors, not just path basenames. Verify medium
parent is sealed bundle Node with existing native-host argv/origin, then System32
CMD and chrome.exe, all same SID/session, alive and strictly older than child.
Keep all handles until caller disposes the witness; liveness is not reconnection
or authorization to replay. This reuses the existing chrome.exe basename policy,
not a new assertion of Authenticode/signed-browser identity.

Medium argv is the existing native host vector: PowerShellImage,-NoLogo,
-NoProfile,-NonInteractive,-File,<bundle>.browser/stager.ps1,-Action,<request>,
-Archive,<bundle>.browser/bundle.zip,-ExpectedSha256,digest,-ControlKind,control,
-ControlOperationId,id, followed by -BrowserControlTarget,target only for control
connect/resume. Request is RequestBrowserHostedOwnerControl, or its Fence/
Reconcile suffix. High argv uses fixed ConnectBrowserHostedOwner/
ResumeBrowserHostedOwner/RevokeBrowserHostedOwner/FenceBrowserHostedOwnerControl/
ReconcileBrowserHostedOwnerControl, the same base vector through operation ID,
then -ExpectedUserSid,sid,-Consent,<fixed mode/control literal>,-ControlCallerPid,
pid,-ControlCallerCreated,ticks,-ExpectedSessionId,session, then optional target.
These conventions are a future internal stager contract, not browser payload.

## Alternatives

Do not treat serializer passes or GetCurrentProcess.SessionId alone as proof;
accept another positive interactive session; query PID repeatedly without held
handles; enable partial mutation routes; load new code into accepted D940; use
the production admin MCP as an acceptance shortcut; or add a service/EXE/relay.
Reusing the existing handle reader avoids another native identity implementation.

## Implementation And Acceptance

Parent owns windows-browser-peer.cs and integration/design. A disjoint worker
owns tests/windows-admin-control-peer-tests.ps1 and can add its wrapper later if
explicitly assigned. Tests compile source under hidden PS5.1, read only the test
process's kernel identity, exercise private pure argv/claim policy methods by
reflection, and prove malformed claims fail before handle access. Reflection
fixtures are policy tests, not real high-pair admission. No tasks, UAC, browser,
tunnel, credentials or production process mutation. Re-run the existing native
peer fixture and protocol suites to catch lifetime regressions. Fresh independent
code review follows red/green tests and a frozen source hash. Real high+medium
Chrome-chain admission and protected handoff remain explicitly unverified until
the new stager routes and disposable authorized candidate are implemented.

This task uses a bounded autonomous EGM-style design/test/review adaptation;
complete source adoption or its local completion-adapter certification is not
claimed. It advances the full original active goal, not a replacement objective.
