# New Candidate Protected Local Acceptance

Checkpoint35, 2026-11-07 13:45 UTC. Full original native goal active and unchanged.
The candidate is now actually installed and locally token-probed. This supersedes
checkpoint34's uninstalled statement only; it does not establish a browser grant,
enrollment, live tunnel, new owner controls, recovery/revoke or release.

## Task And Preconditions

Use the owner-authorized new79958886 candidate once through Windows native RunAs.
Do not overwrite existing registration, install a scheduled task or connect any
tunnel. Actual caller: medium, expected same account SID, current session1.
Read-only helper Inspect initially returned candidateFootprint=not-observed and
browserRegistration=other-or-conflicting-registration. Existing D940 task was
Ready. Private old state enumeration was denied; no elevation or retry was used
to read it, and Ready alone was not promoted to paused/drained proof.

Frozen inputs:

- Runtime ZIP79958886ee7a4b87bd93faa5c691097b032efdf82d29fded8c7566043c4a93e3.
- Stager65676c7174be99cfd152d538938018253129c9616fe465a900da42c0d5c76c49.
- Helper98432b807f588262888b18ef9b6a65e95f5b9161f537c8a1c70b593764814a51.

## Executed Operation

System32 PowerShell5.1 ran Invoke-WindowsAdministratorAcceptance.ps1 once with
Action=Start, the new archive/pins and consent
accept-one-native-administrator-acceptance. The helper's existing native RunAs
path requested UAC. No UI input, authentication-dialog automation, consent
bypass or security-setting change was performed.

Parent exec66672 remained observable until its actual terminal exit0. The
elevated worker PID154996/start13:38:39.8304072Z was also inspected by process
metadata only, without command lines. File-copy observations6802,14897,22640 and
24328 showed progress; no count or silence was treated as acceptance, and no
operation was killed, retried or replayed.

Actual observed helper stdout:

```json
{"status":"administrator-child-verified","uacRequested":true,"administratorChildVerified":true,"tunnelStarted":false,"registrationChanged":false}
```

This helper compares the child exit with its fresh random witness. The reviewed
AcceptLocal path can emit that witness only after protected copy/full verification,
fresh initially paused state, the local command-child probe and clean completion.
The probe goes through the actual packaged MCP provider into PowerShell. It
checks same-account SID, enabled Administrator role, TokenElevation and High
integrity on that actual PowerShell command process, not just its Node parent.
The hidden stager's full JSON stdout was not redirected/captured; do not invent
that raw receipt or list it as independently read back.

## Independent Installed Readback

New protected directory:

`C:\Program Files\AgentContinueAdmin\79958886ee7a4b87bd93faa5`

Ordinary-token readback after completion observed24328 payload files, all29
first-party source hashes matching the prior ZIP inventory, exact official Node
executable hash and actual `node --version` output v22.23.4. Root owner is
BUILTIN\Administrators and its ACL is protected. This readback did not independently
repeat every installed-file ACL/hash; the reviewed high acceptance path performed
the complete verification before its witnessed success.

State directory is present. No candidate .browser enrollment directory, .secrets
vault or new scheduled task was observed. Existing task remained Ready, and
read-only Inspect still reported the other/conflicting existing registration.
No registration changed. This is not authorization to replace the old registration.

Completed .probe-GUID directories remaining:0. Worker154996 and parent165628 were
absent after the parent execution had terminal exit0. The candidate .stage and
.state.stage files remain, as designed: finally closes reservation handles but
does not delete marker files. Their existence does not mean a process is active
and is not grounds for cleanup or Start replay.

## Review And Recovery Limits

One fresh scoped sidecar read the exact source routing and side effects; it did
not execute the install or inspect production. It confirmed the existing
registration does not block this local-only branch, and that hosted key/binding,
task, enrollment and tunnel paths are not entered by AcceptLocal.

It also identified a current limitation: helper Start/AcceptLocal has no durable
operation-ID result. The operation-ID mechanism belongs to VerifyLocal/ProbeLocal,
which is another real probe, not a read-only status query. On future lost results,
footprint alone is insufficient; never invoke VerifyLocal or Start as blind
recovery. The retained live parent result avoided that uncertainty here.

The descriptive local-acceptance-result.json under the artifact directory records
observations only, not a protected authorization/recovery receipt. Full frozen
build evidence remains in control-candidate-build-results.md.

## Next Delivery Gates

1. DONE: actual protected install and one-time native administrator command-child
   acceptance for this new candidate.
2. OPEN: fresh guarded hosted binding and browser enrollment/maintenance plan
   which preserves the other registration and Pause/unknown-operation boundaries.
3. OPEN: positive new browser-managed Connect/Resume/Revoke, same-generation
   readback, browser close/reopen/transient recovery and revocation refusal.
4. OPEN: ordinary ChatGPT then Dot hosted command/file/owned-process acceptance
   against this candidate, plus actual local original-send acceptance under user
   control; previous D940 and synthetic passes are not substitutes.
5. OPEN: coordinated main/GitHub/Store release gates and later full-goal platforms
   and research loop.

Original scheduler task/Pause, local loaded extension, VPN/MCP/IDE/research and
Process Lasso unchanged. No key read/copy, browser input, tunnel connection,
registration/task creation, main commit/push/tag/Release/Store/npm publication.
