# Administrator Control Status Endpoint

## Problem

The Node native host already requests the fixed ObserveHostedOwnerControl action,
but the source stager does not accept that action or its two identity parameters.
Thus a persisted browser operation has no public native readback route even
though the internal protected-receipt reader exists. This blocks the planned
same-ID recovery flow. It is not evidence of a failed installed D940 operation.

## Technical Plan

Add the read-only action and ControlKind/ControlOperationId parameters. Only this
new action may bind them in this slice. Accept exactly Action,Archive,
ExpectedSha256,ControlKind,ControlOperationId with closed kind and lowercase
digest/ID; reject unused/conflicting/omitted parameters before storage work.

Read-AdministratorBrowserControlStatus(Digest,Id,Control,BoundParameters,Verify)
validates the request first. Verify is a trusted internal callback, not a browser
field. The actual dispatcher uses the existing enrolled Pause preflight: exact
sealed stager/archive paths, anchors, medium selected identity, enrollment commit,
registry and held file hashes. Derive selected SID and root from that callback,
never from browser-supplied SID/path. Import the existing fully qualified system
Utility module before JSON parsing/output, as the current observation path does.

Read only Root.status through Read-AdministratorControlReceipt. Return exactly
bundleSha256,operationId,control,state,progress, binding the original request.
Validate the closed receipt and progress types/ranges with existing serializers;
return unconfirmed/null progress on missing, corrupt, inaccessible, mismatched
or malformed evidence. Do not return paths, raw exceptions or private records.
Known protected receipt states are not live owner Ready or hosted tool success.

Keep CheckBrowserHostedOwnerControl and all new mutating actions unavailable.
Do not advertise support, enable controls, introduce UAC, call task APIs, fence,
recover, write intent, or replay any command from a status read. Existing Pause
and standard observation paths retain their behavior and parameter contracts.

## Alternatives

- UI timeouts are not proof of admission or non-admission and cannot unlock by
  inventing a new operation ID or retrying a mutation.
- Reading private reservation/runner/session metadata into the medium response
  would exceed the documented public projection.
- Enabling Supported while mutation/session/handoff endpoints are unfinished
  would falsely advertise an unusable capability.
- Installing this incomplete stager into accepted D940 would invalidate its
  immutable acceptance and is outside this source slice.

## Implementation And Acceptance

Parent owns stager helpers/parameters/dispatch and integration. A disjoint worker
owns tests/windows-admin-control-observation-tests.ps1. Tests extract definitions
through AST only, stub verification/receipt callbacks or use scratch public
records, and refuse any effect. Validate exact parameters before callbacks;
valid/fenced/terminal/unknown states for each kind; request/receipt mismatch;
malformed progress/version-like types/extra fields; permission/corruption failure;
and unchanged read-only source data. Validate temp containment/reparse before any
recursive cleanup. Include a source AST assertion that the fixed native action
reaches this helper before archive/staging dispatch, and that mutation capability
is not enabled by this slice. Run5.1/7 helper fixtures and existing native protocol
and relevant regression tests. Review the exact frozen changed source independently.

Parent also owns the fixed tests/windows-admin-control-observation-bridge.ps1
and its Node bridge test. That fixture extracts only pure/read helper definitions,
substitutes an in-memory selected-SID receipt and tests actual JSON/framing across
the existing native adapter and a hidden PS5.1 child. It never runs the requested
installed stager path or reads any protected bundle. Such a fixture is a contract
test, not browser authorization or protected-state acceptance.

This is necessary wiring toward the full goal, not its narrowed completion.
Exact medium/high OS-peer admission, detached handoff, Connect/Resume/Revoke,
same-ID fenced/recovery actors, automatic saved-running runtime recovery and new
candidate/ChatGPT/Dot/release acceptance remain open. Original manual scheduler
Pause and all installed production/D940 state remain untouched.
