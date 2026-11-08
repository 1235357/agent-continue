# Administrator Browser Lifetime: Unimplemented Gate

## Problem

Current code uses `sendNativeMessage` for an administrator wake. The native host
runs the independent Scheduler demand task and exits. The protected supervisor
owns the Job handle; it observes root exit, saved-running intent and revocation,
not the browser's exit. Therefore a healthy generation can survive Chrome exit.
Reopening and observing that same generation does not meet the active goal's
new-generation recovery requirement.

The standard-account owner already uses a retained native port and disposes on
EOF. That implementation and its tests must not be cited as administrator proof.
The current administrator Chromium fixture returns a fixed synthetic generation;
it tests dispatch/Pause, not browser-driven lifetime settlement. Transport-exit
recovery in the Job fixture is a different observation.

## Required Technical Contract

1. Retain an explicit administrator browser-session connection separate from
   one-shot status and Pause messages. Define service-worker replacement versus
   full browser-session exit; a replaced worker is not automatically a user pause.
2. Carry narrow authenticated liveness across the medium-to-high boundary through
   the sealed installation. The candidate design should evaluate Windows-local
   identity-checked IPC, with account/session, peer-process identity, generation,
   framing/size/deadline limits and stale-session refusal. An untrusted file,
   timestamp, PID alone or a browser boolean cannot authorize a high launch.
3. The high supervisor must require a current session before owner admission and
   monitor lifetime loss while running. Readiness must be withdrawn on loss.
   Request graceful disposal without setting persistent pause. Preserve explicit
   Pause/Revoke and unresolved-operation checks before every admission.
4. Only observed root exit, Job drain, released owned leases and the matching
   terminal record permit replacement. Never remove a lease to manufacture that
   state. A request timeout or a killed Job with stale inner leases is not clean
   settlement. A second session must not produce overlapping high owners.
5. Browser reopen may restore previously authorized saved-running intent only
   after settlement, and must expose a distinct, freshly verified generation.
   Paused/revoked installations must not wake even with a retained port or an
   already queued demand request.

## Alternatives And Boundaries

Merely adding another wake on reopen preserves the defect. A polling watcher,
clock-based timeout or broad PID scan adds ambiguity rather than browser ownership.
Silently pausing on browser exit would prevent the requested automatic restore.
Changing the goal to accept the same surviving generation is not a fix.

Retained native-port transport plus a narrowly authenticated high-owner lifetime
channel is a design direction, not an implemented or independently accepted IPC
protocol. Freeze its exact ownership, peer validation, disconnect, reconnect and
cleanup contracts before implementation. No public listener, arbitrary high-side
command endpoint, new general monitoring service or custom installer is allowed.

## Implementation And Acceptance Gate

Relevant boundaries: `admin-browser.js`, `windows-admin-browser-host.mjs`,
`windows-admin-demand.mjs`, `windows-admin-owner.mjs`, `windows-owner-job.cs` and
the protected stager's enrollment/supervisor. Any changed protected bytes require
a new candidate digest; b7's existing proof must remain historical and unchanged.

Use a disposable Windows browser profile and inert child, without hosted keys:
start `G1`, observe its exact root identity; close the actual fixture browser,
verify its process exit and `G1` settlement; reopen without Connect and require
exactly one fresh `G2 != G1`. Separately test worker replacement, duplicate tabs,
disconnect during startup, pipe/peer spoofing, malformed/oversized frames,
Pause/Revoke races, stale or replayed sessions and unconfirmed cleanup. A unit
state-machine pass is not the real browser/Job test. Only then proceed to hosted
ordinary ChatGPT and Dot acceptance under the separately confirmed test scope.

Status: current-source audit completed; lifetime implementation and its actual
browser/Job acceptance remain open. Existing local elevation, transport-exit
recovery and Pause evidence are not invalidated, but none closes this gate.

## Revision 1: Root-Owned Local Lifetime Witness

Problem: a Scheduler root may exist without a browser, but no provider or remote
command may be admitted in that condition. The high root, rather than a new
background service, will own the lifetime witness. This revises item 3 above:
the Job supervisor still owns settlement; the high Node root requires a verified
browser session before launching a provider and disposes on loss.

Technical plan:
- The extension retains one `connectNative` port. Its initial exact request is
  `{version:1,action:"session",id,wake:boolean}`. Merely attaching with wake=false
  does not alter intent or launch a task. Wake=true is sent only for opted-in
  browser-start restoration. Permission removal disconnects the port. No timer
  retry or one-shot wake fallback follows a lost/unknown session.
- The sealed medium host creates the local named pipe
  `\\.\pipe\AgentContinue.AdminBrowser.<bundle-sha256>` before demand start. A
  duplicate server fails closed. It accepts one high witness for this lifetime;
  stdin end/close/error destroys it. The wire is one bounded ASCII line each way:
  `ACB1 <generation-32-hex>\n`, echoed exactly, then no further payload. EOF is
  terminal, not an authorization token. Extra bytes, non-ASCII, oversize and a
  5-second handshake timeout fail closed. No credentials or commands cross it.
- The high root spawns a protected PowerShell 5.1 helper within its existing Job.
  It compiles the pinned C# source in memory and connects locally with anonymous
  impersonation level (a counterfeit medium server must not impersonate high).
  Before writing, GetNamedPipeServerProcessId plus retained native process/token
  handles verify the exact sealed Node image, selected SID and interactive
  session, and exact argv [Node, sealed host entry, enrolled origin]. The parent
  chain must be Node -> cmd.exe -> chrome.exe, all same SID/session, alive and
  older than the child. Native command-line parsing and process creation times
  are checked. Chrome's process handle is retained as well as the pipe handle.
  A same-account attacker already able to run/inject arbitrary code as the
  enrolled owner is not isolated by this protocol; this is not a new remote
  authorization or a substitute for the sealed activation/OS token checks.
- Helper stdout is only READY then CLOSED. The Node wrapper waits for READY
  before opening the controller/provider. On helper error, EOF or nonzero exit,
  admission is withdrawn, a per-generation protected stop marker is written,
  readiness becomes false and controller.dispose is requested without pause.
  Actual MCP admission checks the generation's stop marker. A browser-required
  owner cannot use the legacy maintenance path merely because binding is absent.
- Existing outer Job lease, observed root exit, drained Job and inner-lease
  checks remain the only settlement authority. A timed-out/failed shutdown leaves
  the lease and is not restartable. The next real browser startup may create G2
  only after those existing checks pass; old ports/sessions never migrate to G2.

Alternatives: high pipe server would require an additional inbound control
surface; inherited cross-integrity handles require another native launcher.
The reverse local liveness pipe keeps the existing Node/PowerShell installation,
does not forward commands, needs no listener outside Windows local pipes and no
new service/task. Polling timestamps, tab counts and PID existence are rejected.

Detailed implementation and acceptance:
- `admin-browser.js` and its tests own the retained port (separate worker scope).
- `windows-admin-browser-session.mjs` owns framing/server and helper wrapper;
  `windows-browser-peer.cs` owns native verification; a fixed PowerShell runner
  loads it. No inferred untrusted path is executed. Builder/stager enumerate the
  new pinned files. `windows-admin-owner.mjs` handles admission/disposal.
- First add red tests for no-provider-before-READY, stream EOF preserving running
  intent, duplicate port refusal, bad frames, helper loss and stale generation.
  Then actual local pipe/peer tests and temporary Chromium/Job lifecycle. A
  fixture may inject a peer verifier but cannot certify native identity/admin.
- No live host registration, sealed b7 mutation or tunnel creation in this source
  phase. Production and the pending private endpoint question remain untouched.
  Revision 1 is a review input, not a completed implementation or acceptance.

## Revision 2: Bounded Transport Implementation Contract

Two independent reviews rejected Revision 1 as a complete implementation plan.
Their root/provider, rapid-reopen and native-policy findings are not waived.
The following exact transport slice can be implemented independently; integrating
it into elevated admission requires the remaining integration gates below.

1. A single retained native port is attached once per worker while Windows native
   permission exists. Initial `session` request has exactly version,action,id,wake.
   The session-wide attempted flag determines wake=true only for the first opted-in
   startup; subsequent worker instances attach wake=false. No disconnect retry.
   Worker loss deliberately ends its generation without persistent pause; it does
   not silently authorize another launch in the same browser session. Explicit
   permission removal closes the port. This availability limit must be disclosed.
2. Native serveAdministratorBrowser dispatches `session` to an injected session
   action and keeps stdin until that action settles. Status/Pause stay one-shot.
   The production session action will not fall back to legacy one-shot wake if
   the transport/helper is unavailable. Closing native stdin always closes the
   session action. Browser session replies are correlation acknowledgments only,
   never ready/admin observations. No arbitrary fields/commands are forwarded.
3. The local transport is implemented by protected source loaded in PowerShell
   5.1, compiled in memory. No custom executable is generated/distributed. Server
   uses a Windows named pipe with FirstPipeInstance, byte mode, bounded instances,
   explicit DACL: current owner + SYSTEM + Administrators; deny Network SID. It
   never impersonates a client. Node is only its parent/controller via stdio.
4. Fixed server launch vector: System32 WindowsPowerShell/v1.0/powershell.exe,
   `-NoLogo -NoProfile -NonInteractive -File <bundle>/app/windows-browser-peer.ps1
   -Role Server -Bundle <bundle> -Origin <enrolled-origin>`. No path lookup or
   environment-derived command. Server own SID/session are OS-derived.
5. Client connects to `.` with anonymous impersonation. Verify server pipe PID
   and held process image/token/session/start times plus exact native argv vector
   above, parent Node exact sealed executable/host entry/origin (optional exact
   `--parent-window=digits` remains accepted), parent cmd System32, parent chrome
   named chrome.exe, alive and older than their children. No same-account arbitrary
   code/injection isolation claim. Host/entry bytes must already be sealed by the
   stager; path/argv inspection alone does not establish high authorization.
6. Wire: ASCII `ACB1 owner <g>\n` establishes one immutable g; additional clients
   use `ACB1 provider <g>\n`, at most 16. Echo exactly; subsequent byte or EOF is
   terminal. Invalid/oversized/non-ASCII/extra initial frame or first provider
   consumes/fails the session (safe denial, not retry). Owner EOF closes every
   provider. Each read/handshake <=5 seconds, <=96 bytes. No secrets/commands.
7. Helper stdout has only LISTENING for server, READY then CLOSED for client.
   JS bounds entire acquisition including compilation/connect to 20 seconds,
   retains streams/process, and latches non-live synchronously on unexpected
   output, EOF/error or any exit. close() ends stdin, waits for observed exit
   <=3 seconds, then terminates this exact owned helper and observes <=3 seconds;
   uncertain cleanup rejects. All early failures join/close before returning.
8. Primitive acceptance: actual PS5.1 compilation, explicit pipe DACL/readback,
   duplicate refusal, malformed/oversize/unknown role, fixed generation, owner EOF
   fanout, wrong native server image/argv/SID/session refusal, helper pre/post READY
   loss and bounded cleanup. Chromium fixture proves retained-port/EOF only until
   real sealed high-side/Job checks run. Production binding/keys are not used.

Remaining integration gates, not satisfied by this slice:
- Each real provider needs its own retained verified witness, pinned once to the
  root's generation, and synchronous isLive at transport AND handler admission.
  Environment carries a candidate g but is not proof: the live owner-bound pipe
  must confirm it. No discovering G2's current generation on old calls. Loss
  latches denial even if protected marker publication fails.
- Queue (rather than IgnoreNew) is the intended demand-task handoff: a new live
  browser session issues at most one queued startup. Scheduler serializes roots;
  root checks old outer/inner settlement and current session before any provider.
  A queued task for a browser that has since exited must never launch a provider.
  Rapid reopen/old unconfirmed cleanup still need real Job tests before changing
  the enrollment policy. The transport slice does not yet change that policy.
- Any .browser directory mandates browser proof; malformed/missing binding cannot
  downgrade to maintenance. All root early returns/controller failures dispose
  owned witnesses; no provider before READY. High/native acceptance remains open.

### Integration Resolution For Revision 2

Provider admission is now specified as a separate held native witness in EACH
provider, acquired before MCP transport setup. Root supplies a candidate g through
the sanitized environment, but the native local server must echo that same g on
a provider channel while the owner channel is live. Each provider pins this
witness once; it never reopens it or discovers a later generation. isLive failure
latches denial in transport and SDK-handler admission. A protected stop marker is
optional diagnostics only and is not used as the authorization mechanism. Root
close starts native-witness disposal before slow controller cleanup, then joins
both cleanup attempts even when either rejects. The journal is finalized in the
outer cleanup path; helper loss during construction/startup cannot leave
provider admission enabled.

Demand enrollment will use Windows Queue (MultipleInstances=1), not IgnoreNew.
A single native session issues at most one task.Run request after LISTENING.
Queued execution is one correlated startup, not replay of a remote tool/control
operation. The new session remains open while waiting. Native server binding may
wait at most five seconds for an old pipe instance to disappear, while browser
stdin is still open. This retries only a kernel pipe creation that failed without
creating a server; it never dispatches a task twice. An active duplicate continues
to fail closed. Entire acquisition is still bounded at 20 seconds. A queued root
cannot launch a provider without its currently live native session and cannot
override the existing outer/inner lease, pending-operation, pause or revoke checks.
Actual rapid-reopen Job acceptance remains required before deployment.

### Queue Policy Decision: Installation-Wide Coalescing

The preceding claim that Queue alone correlates a request to an expired browser
session is withdrawn. Review demonstrated B queues/exits, C attaches wake=false,
then B's queued task can observe C. This candidate deliberately uses
installation-wide coalescing instead, not a session-bound command queue. The
earlier expired-session prohibition above is superseded by this precise rule:
a previously accepted startup demand may finish against the *currently verified*
browser witness, but only while the installation's protected running intent and
activation still authorize it and the previous owner has settled. A disarmed
observer does not itself create a demand. Disabling restore neither cancels an
already accepted startup nor writes Pause. Disconnect/Pause and Revoke cancel the
protected permission to launch and win over any queued demand. No tool operation
is replayed, transferred or retried. If no browser witness exists when a queued
root runs, it may not launch a provider. An earlier generation's provider cannot
attach to a new witness/generation. Reopen and duplicate-queued-start fixtures
must include the B/C sequence and describe coalescing rather than correlation.
This policy changes unpublished source only; actual OS/Job and UI-disclosure
acceptance remain required, not waived by this decision.
