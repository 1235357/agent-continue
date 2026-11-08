# Control Regression Results

## Scope

Bounded internal source repair, not an installed runtime or public release.
Design: `2026-11-07-control-operation-regression.md`. The local scheduler repair
and its preserved manual Pause are independent. No browser input, extension
update, process start/stop, production VPN/MCP/IDE/research/Process Lasso change,
stager dispatch, credentials, task registration or connection was used here.

## Reproduced Defects And Decisions

1. PS5.1 operation baseline21/28: seven Revoke cases incorrectly inspected a
   forbidden launch phase. Keep the phase serializer closed; scan applicable
   phases and refuse an existing forbidden launch artifact before effects.
2. PS7 operation baseline0/28: JSON version1 is Int64 rather than PS5.1 Int32.
   Accept only these two signed integer representations and exact version1;
   preserve canonical full-byte readback. Six writer fixture hashes agree.
3. Runner readback contradicted the reservation serializer's PID representation
   and19-digit DateTime tick bounds. Align those checks without numeric string
   coercion, validating before the process-ID cast/lookup. Only the test's own
   process is inspected; no process is created or stopped.
4. Independent static reviewer Aquinas found two existing scalar-identity
   holes: collection-valued session SID, and terminal format/generation/digest.
   PowerShell collection/coercive comparison could accept malformed values.
   Added tests first: identity failed;15/86 terminal/runner cases failed before
   the fix. Require scalar strings and Ordinal equality, then rerun. This is not
   evidence of a production exploit. Arrays, bools and leading BOM are covered.

The first review found no other blocker in its frozen scope, but that verdict
was blocked by the two concrete findings. The revised design/implementation
and expanded runner fixture received a fresh static final review from Newton.
No actionable blocker was found within the declared scope, and all six frozen
inputs matched before/after. The reviewer parsed all five PowerShell files but
did not run tests; the executed shell results below are the parent's separate
evidence. This is not a whole-product or protected-runtime certificate.

## Current Executed Checks

Run from the repository root. Each PowerShell test parses the stager AST and
loads selected function definitions only; it never dot-sources dispatch. Store,
operation and ledger fixtures replace ACL/OS callbacks and use disposable
temporary roots with containment and reparse checks before recursive cleanup.

| Test | Windows PowerShell5.1 | PowerShell7 | Scope |
| --- | --- | --- | --- |
| `tests/windows-admin-control-operation-tests.ps1` |29 cases,943 checks|29 cases,943 checks|scratch transactions|
| `tests/windows-admin-control-store-tests.ps1` |266 checks|266 checks|scratch canonical records|
| `tests/windows-admin-control-identity-tests.ps1` |75 checks|75 checks|closed serializers|
| `tests/windows-admin-control-runner-tests.ps1` |86 cases,528 checks|86 cases,528 checks|self-process and stub terminals|

Commands: `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy
Bypass -File <test>` and `pwsh.exe -NoLogo -NoProfile -NonInteractive -File <test>`.
All returned exit0 for the final current inputs shown above.

Additional executed checks: PS5.1 control-ledger6144 read combinations,363
publication cases,45115 assertions; Node control protocol17; control/parity/UI63;
scheduler timeout/timing-i18n8. Ledger/Node tests preceded the final strict
scalar-identity edit, which does not change their extracted/called functions;
their results are adjacent regression evidence, not a rerun of all sources.
Counts overlap and must not be summed into a whole-product coverage claim.

## Frozen Final Review Inputs

| File | SHA-256 |
| --- | --- |
| `scripts/Stage-WindowsAdministratorBundle.ps1` |`5a38dd292d86323e2c6c4dd70b70aef7fb94e3c44db39303e61d9aee83b87655`|
| `tests/windows-admin-control-operation-tests.ps1` |`a929e11bff599974d80ff9f33d654bcb0d8179ce437c368e8d20ca56b725cc40`|
| `tests/windows-admin-control-store-tests.ps1` |`12c11765f608f48c349926cd19d6eac4725597f642c3a41335bd6f4276cd3e11`|
| `tests/windows-admin-control-identity-tests.ps1` |`af543d47cc80e3656fbb0fb411b4f1fae9a96a2666cb882a62adb8508b2ffe2e`|
| `tests/windows-admin-control-runner-tests.ps1` |`eaea8adca97811b8f6890c08f67a272d98dbe5be0860e60bbbc84365cecb0ad1`|
| `docs/plans/2026-11-07-control-operation-regression.md` |`6a20cabcdd7f20aeba5427ed73a715c6f6c17c7b5f7fef616c6e01aed5a13bfa`|

## Open Delivery Gates

No public high-side endpoint wiring, exact OS-peer admission, detached handoff,
actual recovery/revocation, new browser lifecycle, candidate installation or
new-release acceptance is established by these tests. The actual production
stager still requires Windows Desktop/64bit. Do not claim full PS7 runtime
compatibility, deploy this mixed native WIP, or reuse an old bundle/stager
digest pair. Original D940 stays settled/paused. Full original goal active;
source work, installation, publication and actual delivery remain separate.
