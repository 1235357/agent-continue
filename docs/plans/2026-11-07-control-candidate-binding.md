# Actual Candidate Binding And Registration Mismatch

Checkpoint37, 2026-11-07 14:37 UTC. Full original native goal remains active;
objective body unchanged. This increment changes protected installation state,
not the user's loaded extension or any production connection.

## Current-State Diagnosis

Read-only Inspect of installed79958886 returns existing-artifact and
other-or-conflicting-registration, callerElevated=false. Four registry views
were inspected without changes:

- Administrator host:only HKLM/Registry64 exists, pointing at the oldD940
  `.browser/host.json`.
- Its actual public manifest permits only
  chrome-extension://ibhdcljfbjhohmaekibjnpanejbfmmam/.
- The user-provided local preview ID is dcahjbghpncachlghgemfgpeggibgmbd, so that
  manifest does not authorize this local ID.
- Standard host com.agentcontinue.device_wake is absent in both hives/views.
- Old task is Ready/state3, instances0, lastResult0. These task values alone do
  not establish private Pause or lease state.

This is a concrete native-device deployment mismatch. It is not proof that this
registration issue caused a scheduler send failure. Current live Chrome state
and original delivery remain unobserved; actual prior local directory retains
older device code and no admin-control.js. Do not copy one new module into it.

## One Actual Binding Operation

Frozen runtime ZIP79958886ee7a4b87bd93faa5c691097b032efdf82d29fded8c7566043c4a93e3,
stager65676c7174be99cfd152d538938018253129c9616fe465a900da42c0d5c76c49,
and already installed root79958886 were used. The maintenance-only helper
`.artifacts/windows-control-candidate-20261107/Bind-Candidate.ps1` fixes:

- Operation ID:ddbf6da0823d40c4a4dedc9fbac4d439.
- Action:BindHosted, not Start/Connect or a new first acceptance.
- Existing dedicated tunnel:tunnel_6aeec565ffe08191935f53e3bc60d05d.
- Runtime key file:the owner-explicitly supplied MCP-Windows-RuntimeKey.txt.
  Its content was consumed by the elevated stager only, not printed or read
  into chat. It was written into the candidate's Admin/SYSTEM-protected vault;
  this is ACL protection, not an assertion of at-rest encryption.

The initial preflight found a real PS5.1 dependency omission in the new helper:
with module autoload disabled, JSON cmdlets were not loaded. No Start had run.
Explicit system-path Utility imports were added in parent and worker. Plan now
builds and parses the8387-character encoded invocation without elevation/key
content access. A harmless separate exit test confirmed scriptblock exit0
propagates instead of falling through to the worker's error exit42.

Final helper SHA-256:
6c003cf2991ced34049d6dac7a64b4078eaef1944ba4faf01304df048c7fd987.

Actual System32 PS5.1 helper Start ran once. Parent exec81568 reported elevated
child1372/start2026-11-07T14:25:19.1971265Z and remained live during full sealed
verification. It was polled through the same handle until terminal exit0:

```json
{"status":"binding-child-exit-success","operationId":"ddbf6da0823d40c4a4dedc9fbac4d439","childExitCode":0,"tunnelStarted":false,"registrationChanged":false}
```

No timeout or silence was treated as terminal; there was no restart, kill or
binding replay. The BindHosted branch performs another real packaged-provider
administrator command-child probe in temporary probe state before binding;
it is not a read-only operation. It does not authorize an owner, enroll a
browser, register a task or connect a tunnel. Hidden child stdout was not
captured; the following separate protected readback supplies durable evidence.

## Protected Receipt And Live-State Readback

Maintenance helper Read-Binding.ps1 SHA-256
b72b8ea4e1497298e30867af2937cda39dd17af71b7ec42c2e2406bad257d059
was Plan-checked in SystemPS5.1, with a parsed26703-character encoded worker.
It extracts only four named function definitions from hash-verified frozen
stager bytes. It runs no Bind/Connect, checks same SID/admin and sealed ACLs,
reads this exact protected started/result receipt and nonsecret profile/lifecycle,
and checks runtime.key ACL/length without reading its content.

One native RunAs Start completed exit0. It published a bounded nonsecret
projection in an Administrators-owned, selected-SID-read-only sibling directory:

C:\Program Files\AgentContinueAdmin\binding-ddbf6da0823d40c4a4dedc9fbac4d439.readback\observation.json

Parent then independently ran Inspect, which re-read that protected projection
without another UAC or binding replay. Observation time remains the original
readback time, not the later Inspect time:

```json
{"operationId":"ddbf6da0823d40c4a4dedc9fbac4d439","bundleSha256":"79958886ee7a4b87bd93faa5c691097b032efdf82d29fded8c7566043c4a93e3","bindingReceiptVerified":true,"profileHashVerified":true,"administratorChildVerified":true,"newPaused":true,"tunnelStarted":false,"registrationChanged":false,"keyContentRead":false,"oldObservation":"observed","oldPaused":true,"oldLeasesClear":true,"oldRevoked":false,"oldTaskInstances":0,"observedAt":"2026-11-07T14:34:40.4469512Z"}
```

Receipt verification required exact operation/digest/action, complete/24328,
all file/state/launch/command-child/binding/hosted-plan flags true, and false
activation/registration/tunnel flags. The new profile hash matches its sealed
binding, selected SID, official API origin and exact dedicated tunnel. New
intent is still paused. OldD940 private Pause/three-lease absence and task
instances were actually read, not inferred from its earlier Ready label.

The projection is a point-in-time observation, not authority to skip future
guarded admission. In particular tunnelStarted=false is the checked Bind
operation's effect flag, not a global current-connectivity assertion.

Ordinary file metadata independently shows new.secrets plus both receipt files
present, and new.browser absent. Registry was subsequently re-read and oldD940
manifest remained unchanged; the only task remained oldD940/state3. Local popup,
background and adapter hashes remain12711009/66c90c0c/67999cf0.

## Review And Remaining Critical Path

First sidecar review was stopped while running, without a verdict; do not count
it as approval. A fresh bounded source review of the final Bind helper found no
concrete blocker, with explicitly limited stager ranges. Parent inspected key
reader/vault write/launch paths and actual exit behavior. Another fresh static
review found no blocker in the readback helper, but did not execute it. These
are scoped code checks, not full EGM adoption, security certification or actual
browser acceptance. Runtime observations above belong to the parent execution.

IAB bootstrap remains without an agent/browser control handle and its installed
skill entry directory is empty. No private API or alternate-browser workaround
was used. User-visible restoration still requires a coordinated frontend/native
registration cutover to the intended local ID, native authorization/enrollment,
actual GUI Connect/Pause/Revoke/reopen tests and ordinary ChatGPT/Dot calls.
The supplied historical activity exports cannot replace current-page evidence.

Never rerun Bind-Candidate Start, AcceptLocal or an unknown operation. Existing
binding now makes first-binding replay invalid. Read-Binding Inspect is read-only;
its Start is a one-time projection publication and refuses an existing report.
Do not remove the projection/receipt/vault to force a retry. Native lifecycle
and registration actions must recheck actual old Pause/leases under their guards.

No loaded-extension update/reload, scheduler Pause clearance, owner authorization,
registration/task/tunnel switch, production VPN/MCP/IDE/research change, or new
public release occurred. Main remains592f8d6aaa8b579a546a1b3da5607e5a11731732.
