# Cold Shell Tunnel Readback

## Problem

Actual Windows job 128981500826 in native CI 42562410523 failed at
tunnel.test.mjs:655. A successful start_process reply contained a PID and
explicitly said the process was running, but the test asserted that its first
output already contained AC_COLD_SHELL_OK. Acknowledging process creation is
not equivalent to observing its output. Extension CI passed independently.

## Technical Plan

Use the existing test-only observeTestProcessOutput helper for the cold CMD
provisioning scenario as already used by the exact-shell scenario. Correlate
each appended read_process_output request and response through the actual
loopback control-plane queue. Only the PID returned by the original start may
be read; never repeat start_process. Keep the helper's existing finite read
budget, malformed-result rejection and request identities.

Hold the cold command behind a fixture-owned file gate until its start reply
has arrived. Release the gate and read its subsequent output, then assert the
full marker, released phase and at least one correlated output read. Preserve
the existing installer, Node hash, pause, owner cleanup and command-count checks.
The gate's deadline and read budget are test-only, not user command limits.

## Alternatives

- Longer initial wait is timing-dependent and does not test asynchronous output.
- Replaying the process would duplicate effects and is prohibited.
- Accepting running/PID alone weakens the actual tool-execution assertion.
- Changing production shell/process code is not justified by this CI evidence.

## Detailed Implementation And Acceptance

Limit edits to native/desktop-commander/tunnel.test.mjs and its existing
test-process-output.test.mjs tests. Cover the actual empty-initial-output reply
and same-PID observation. Run existing output-helper tests, syntax, then the
real Windows guided cold CMD fixture using pinned local official client assets
and synthetic credentials against loopback only. It must still install in a
new temporary home, verify the provisioned Node, assert real file/command
results and verify Pause. No credentials, live tunnels, browser grants,
registry, services or production installations are involved. Full hosted CI
must subsequently confirm the changed test under the actual runner.
