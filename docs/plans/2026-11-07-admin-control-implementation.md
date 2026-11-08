# Administrator Control Implementation Checkpoint

## Problem

The accepted immutable D940 runtime proves ordinary ChatGPT high-token operations
and browser close/reopen/Pause, but not the new browser Connect/Resume/Revoke flow.
Next-source GUI cannot become a delivered feature while its high-side fixed
actions are absent. Unknown operations must not cause repeated mutations.

## Plan And Current Status

1. DONE: closed browser worker messages, persisted original operation identity,
   exact sender checks, same-ID readback, startup serialization and Revoke priority.
2. DONE: action-specific Devices confirmations, progress/receipt display,
   operation selection, archived-ID readback and permission-aware polling.
3. DONE: additive fixed-action native protocol, legacy-unconfirmed behavior,
   packaged worker, parser parity and bounded independent source review.
4. PARTIAL: closed receipt/reservation/tombstone/phase/progress helpers and exclusive
   execution FileStream lease implemented and scratch-tested. High-side action
   routing, actual sealed ACL/session evidence and protected acceptance remain TODO.
5. TODO: detached medium/high handoff, no child-kill on response timeout, exit and
   incomplete-handoff settlement without replay. Response-only timeout is partial.
6. TODO: Connect after target recheck, saved-running-only Resume, installation-wide
   Revoke before stop, same-ID Fence/Reconcile with no Task.Run replay.
7. TODO: same-browser transient-port recovery, distinct-generation/readiness proof,
   optional nativeMessaging prompt and actual new-candidate lifecycle acceptance.
8. PARTIAL: owner-approved actual Dot D940 command/file/owned-process acceptance
   passed with native witnesses and same-ID receipts; ordinary ChatGPT D940 had
   already passed. New high-control candidate/lifecycle/Store permission acceptance
   and truthful GitHub/Store Windows release progression remain TODO.

## Alternatives And Constraints

Do not mutate the D940 installed subject or replace its accepted bytes. Do not
downgrade to the ordinary account, create a project relay, replay settled or
unknown actions, or clear Pause/Revoke because the browser reconnects. Do not
equate browser client storage with protected receipts. Keep full verification;
show progress before optimizing its cost. Production VPN/MCP/IDE/research untouched.

## Implementation And Acceptance

Design input: `docs/WINDOWS-ADMIN-CONTROL-COMPLETION-DESIGN.md` (unchanged frozen
design; partial source implementation does not certify its whole acceptance).
Current files: `admin-control.js`, `devices.html`, `devices.js`, `background.js`,
`native/desktop-commander/windows-admin-browser-host.mjs`, focused test files and
canonical `scripts/package.py`. Continue at
`scripts/Stage-WindowsAdministratorBundle.ps1` without enabling unimplemented
support. The high-side action names and envelopes are fixed by the native source.

08:46 UTC source additions: `test:admin-control-ledger` runs four PS5.1 scratch
fixtures (ledger, identity, store, verification progress), all passed. The full
verifier callback preserves every hash and closure check. Do not equate this with
new installed high-side actions or display completion. D940 G3 is intentionally
paused and cleanly drained after the actual Dot test. The stored Dot-scope question
is resolved and must not be asked again without a material scope change.

Bounded store review caught a PS5.1 test-array coverage error; reproduced then
fixed. Final identity67/store44 include fence-interruption, stored identity
collision and atomic replacement-failure cases. This is not implementation of the
still-missing action endpoints or exact OS peer evidence. No replay of D940 tests
is needed to complete those next-source tasks.

Latest bounded tests: 80 new-control tests; 77 legacy/protocol regressions; 34
background-state; 33 background-v2; 16 device dialog/source; 34 headless Chromium
simulated checks; 11 package unit tests. These suites overlap. No new protected
high-control, optional-permission, account-browser or Windows release proof.

Local preview SHA256:
`f6f0b481cf6a2f01fcfe18e0d0be3a5baa03092bee40cf98addd301b46148e05`.
See `docs/RUNTIME-ACCEPTANCE.md` 08:11 UTC for exact test and artifact boundaries.

## Control Transaction Slice

Problem: the new stores do not yet execute the guarded Connect/Resume/Revoke
transaction. Implement it in the existing stager, without activating a partial
public capability or modifying the accepted installed candidate.

Technical plan: `Invoke-AdministratorControlOperation` takes fixed derived bundle
identity, original operation/target, validated runner/session evidence and trusted
binding/audit/startup/task callbacks. It holds an exclusive per-operation lease,
reserves under the existing global control guard before a long audit, releases
the guard for audit and task RPC, and rechecks original target and deny markers
before effects. Connect may write running intent; Resume never writes lifecycle.
Revoke skips the long full audit, records the deny marker before paused intent,
and publishes only verified revocation/stop facts. A separate same-ID recovery
path acquires the kernel lease and verifies the original runner has exited; it
may only fence/reduce authority, never replay Task.Run.

Alternatives: do not reuse legacy Connect recursively under its guard, infer
success from an absent file/PID, mint a new ID after timeout, hold the global guard
across full verification, or advertise support before exact OS peer/handoff and
endpoint wiring are complete. The callback boundary is an internal test seam,
not permission for an untrusted browser to supply code or paths.

Implementation: parent owns stager functions and integration; disjoint sidecar
owns `tests/windows-admin-control-operation-tests.ps1`. Scratch tests must cover
duplicate/stale/denied/raced requests, write-ahead ordering, guard release at RPC,
Resume no-write, Revoke priority and durable recoverable interruption. Later
public routing must first verify the actual medium/high OS pair; shape-only
session serializers are not that proof. Existing D940 remains untouched/paused.
