# Fixed Sealed Control Entry Results

Checkpoint: 2026-11-07 12:51 UTC. Source only; full original goal remains active.

## Scope

Three medium request routes and five high fixed routes are implemented in
Stage-WindowsAdministratorBundle.ps1. Closed canonical envelopes reject extra,
duplicate, case-variant and mismatched fields before preflight. Connect/Resume
alone accept a snapshot target; absent targets remain CLR null. The medium
captures actual self PID/start/session/SID and retains its handle through a
maximum15second correlated ACK wait. Returned child PID/start, not launch time,
binds the ACK. Only actual Win32 Start cancellation1223 is cancelled; all other
unproved results retain the same original ID as unconfirmed. No kill or replay.

High reconstructs the selected installation from fixed system/ProgramFiles paths,
protected owner identity, committed enrollment and pinned public/private metadata.
It holds the archive against writes and uses trusted binding, complete-audit,
startup and existing-task callbacks. Revoke/Fence/Reconcile do not start tasks.
The existing C# kernel witness independently validates the actual process chain.
These new paths are not built, enrolled, installed, advertised or published.

## Reproduced Findings

1. P1: early high audit called real Copy-Or-Hash with legacy global SHA absent.
   Real ZIP/full-verifier fixture failed with a null-valued method expression.
   High endpoint now owns its SHA256 instance before callbacks and disposes it
   and its archive handle in finally. Test global SHA remains null throughout.
2. P2: ACK could arrive after first read but before child exit/deadline check.
   Two waiter race vectors failed before the fix. Exit and deadline now finish
   with one final exact ACK read, never restart or kill the child.
3. P3 fixture oracle: waiter catches callback exceptions, so a throwing fake
   reader did not prove it was never called. An outside-catch counter now proves
   invalid child metadata causes zero reader calls; re-review closed the note.

Initial fixture-only corrections: explicit script-scoped binding/caller avoids
PowerShell dynamic-scope shadowing; raw fractional-version JSON is used because
ConvertTo-Json normalized a proposed1.0 sentinel to1. Neither was a source fix.

## Executed Verification

- Actual canonical System32 Windows PowerShell5.1 Desktop x64.
- Entry:75cases/646checks PASS, including actual current medium self metadata.
- Real ZIP/full layout/hash verifier:3cases/56checks PASS. Same-length tamper and
  extra archive member rejected before task effects; own SHA disposed on exit.
- Updated read-only observation/dispatch guard:416cases/7089assertions PASS.
- `npm.cmd run test:admin-control-ledger`:15/15 PASS, exit0,60.2157seconds.
- `npm.cmd run test:admin-controls`:80/80 PASS,174.383milliseconds.
- No skips or cancellations in the final combined ledger run.

Tests AST-import definitions only, not public stager CLI/install dispatch. Entry
substitutions: process-start-and-wait-handles; owner-identity-and-acl;
registry-and-enrollment-oracle; scheduler-task-and-startup; kernel-admission;
orchestration-full-verifier; orchestration-sealed-binding. Positive High is a
stub. Actual archive sharing exclusion and actual medium self capture are real.
The separate audit runs real Get-Layout/Verify-SealedBundle/Copy-Or-Hash but uses
scratch ACL/owner/binding/kernel/task seams. None proves UAC, protected runtime,
positive native high pair, browser permission or hosted control effects.

One independent read-only scoped reviewer mapped argv/native identity contract,
found P1/P2, and statically re-reviewed fixes and the corrected P3 oracle. No
independent test execution, complete product review or security certificate.

## Frozen Inputs (SHA-256)

| File | SHA-256 |
| --- | --- |
| scripts/Stage-WindowsAdministratorBundle.ps1 | c829777775cde5fdbdeff430d0eb68f7df3a9326c53824cd3f610bbfdfde4ffe |
| native/desktop-commander/windows-browser-peer.cs | 50bd9fca004b21484ccd498acc3f770354d25a20a565fa1e4a92b27eb595f7c8 |
| native/desktop-commander/windows-admin-browser-host.mjs | 064472cc6722c78eb84202b33e57ac829a4daa26d762768f1c1483e547f21eb5 |
| tests/windows-admin-control-entry-tests.ps1 | 154d89586d8cffcf4b2fc90a4e310cfc8ed1d390bb8346d51cc662a27b680bb8 |
| tests/windows-admin-control-entry-audit-tests.ps1 | 450ac8f7df612236c45f3c779647fdfdf4e92cac5965511afeef77af2a671d89 |
| tests/windows-admin-control-observation-tests.ps1 | 9ecee0d81cf175e5df9bbb246c072ba103b60f0267e9f3d050e7b6fb614ff9e0 |
| tests/windows-admin-control-ledger-tests.mjs | 7f83e203df7f7f5546e6fcc768bc2e1a2871b96768ba04dd3180c3a917b157ff |

Native-host JavaScript change in this slice is a comment only. It no longer
describes the source handoff as future; it does not change installed behavior.
The stager is259542bytes, below its512KB bound. Existing prior handoff
fixture45/454 remains mandatory in the wrapper along with the new coverage floors.

## Delivery Boundary And Next Gate

CheckBrowserHostedOwnerControl capability/eligibility projection is still absent.
Next: complete that closed public contract, then rebuild/enroll a new candidate
with new archive/stager pins and perform real new high lifecycle/recovery/revoke
and browser/hosted acceptance. Never replay settled D940 or repurpose its proofs.
No new tag, Release, Store submission, npm publication, commit or push this slice.
Main stays592f8d6aaa8b579a546a1b3da5607e5a11731732. Native WIP is not release-ready.

Actual loaded scheduler hashes were reverified unchanged: popup12711009,
background66c90c0c, adapter67999cf0. Earlier synthetic scheduler tests were not
rerun this slice. Preserve last-observed original manual Pause. No real original
scheduled send or successful final UI reload is inferred. No browser/desktop,
UAC, credential, task/service/registry/tunnel, production VPN/MCP/IDE/research or
Process Lasso changes. Browser policy stop remains honored.
