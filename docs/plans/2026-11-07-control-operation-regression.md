# Windows Control Operation Regression

## Problem

The new source-only operation engine fails seven of28 scratch cases in Windows
PowerShell5.1. Its pre-effect phase scan asks a Revoke operation for a forbidden
launch-attempted phase; the closed serializer correctly refuses that request.
PowerShell7 additionally rejects its own parsed version1 records because the
reader expects Int32 but its JSON parser returns Int64. This does not imply the
installed D940 runtime failed, or that PowerShell7 is a supported stager host.

## Technical Plan

Keep the action/phase serializer closed: Revoke must never serialize or publish
launch-attempted. Scan only applicable phase names and refuse a preexisting
forbidden launch artifact for a fresh Revoke operation before lifecycle/task
effects. Keep reservation identity, write-ahead phases, Pause/Revoke priority,
exclusive execution leases and same-ID readback without replay unchanged.

Within the control-record readers only, accept the two signed CLR integer types
already supported by the corresponding field serializers. Version must still be
exactly1 and the complete canonical bytes must still match. Do not coerce text,
booleans, floats or decimals. Review runner PID readback separately. Keep actual
Windows Desktop/64bit/UAC/OS-peer dispatch gates unchanged.

Independent source review identified two additional existing schema holes in
the same validation boundary: collection-valued session SID and terminal
format/generation/digest can pass PowerShell collection/coercive comparisons.
Require each to be a scalar string and compare with Ordinal equality. Do not
normalize BOM, invisible characters, case, arrays or booleans into an identity.
Add rejection tests before the fix, including canonical reservation readback
and stub terminal publication; this does not prove a production exploit.

## Alternatives

- Allowing a launch phase for Revoke would weaken the contract to hide the bug.
- Treating every numeric-looking value as an integer would accept coercions.
- Casting parsed objects before canonical verification could hide bad inputs.
- Running the stager's installation/dispatch body would affect installed state.

## Implementation And Acceptance

Parent owns the existing stager and focused scratch tests. A read-only sidecar
reviews the integer boundary without production access. Tests extract function
definitions through the PowerShell AST and replace ACL/OS callbacks with
scratch-scoped fixtures; they do not execute stager dispatch or contact a device.
Scratch cleanup must verify the temporary absolute root and reject reparse
points. Existing red28-case operation suites are the baseline. Add forbidden
phase and malformed integer/canonical-record cases, run applicable identity,
store and operation suites under5.1 and7, and review source independently.
Include focused read-only self-process runner checks and in-memory terminal
evidence with a scratch gate. Cover numeric, collection and identity-spelling
refusals without creating/stopping a process or executing a task.

No candidate bundle build, install, enrollment, connection, key read, pause clear,
task registration, production change or publication is authorized by this test
result. Existing local scheduler remains patched and the owner's task stays
manually paused. Full Windows action routing/handoff/lifecycle acceptance still
requires separate work; scratch passes are not a completed release.
