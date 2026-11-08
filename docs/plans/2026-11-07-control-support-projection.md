# Read-Only Control Capability And Saved-Intent Projection

## Execution Checkpoint

Implemented in source stager65676c71, not built/installed. Deadline mismatch and
exact inherited-private lifecycle ACL rejection reproduced RED/fixed GREEN.
Support113/267 plus24 wire vectors, observation417/7093, controls83/83,
devicelogic62/62 and synthetic browser34/34 pass. Scoped independent static
re-review closed source/test findings. See control-support-projection-results.md
for final ledger readback, full hashes, explicit fixture substitutions and limits.

## Problem

The new fixed sealed control routes exist in source, but the native host already
calls CheckBrowserHostedOwnerControl and no such stager entry exists. Installed
legacy candidates must stay unconfirmed; source tests do not enable real GUI
controls. The medium caller cannot read protected owner intent or revocation.

## Technical Plan

Add one exact read-only action accepting only Action/Archive/ExpectedSha256/
ControlKind. Reuse sealed medium preflight and selected SID. A capability result
is not authorization, live readiness, startup eligibility proof or an operation.
No UAC, task, credential read, process start, repair or write in this query.

Under the existing elevated control gate, augment pause-target publication with
an atomic canonical control-owner.json containing only version, bundleSha256,
target and ownerState. Revocation presence wins; otherwise exact saved lifecycle
intent maps to paused/running, malformed intent to unobserved. Running means
saved-running intent, not a live process or tunnel. Existing start/settlement/
pause/connect/recovery hooks refresh the projection. Legacy revocation also
refreshes it while its gate exists, without undoing denial if publication fails.

Medium reads target before and after the bounded public document and requires
the same exact target in all three. Missing, malformed or mixed rows produce
unobserved state and no startup target. After sealed preflight, Revoke remains
available even without a state row. Connect is offered only paused plus idle;
resume-saved only running plus idle. Active generations never offer new startup.
High still revalidates actual live target and private denial under its guard;
public projection is an advisory observation and cannot grant or override access.

## Alternatives

Do not read secrets from medium, infer saved intent from a stale pause receipt,
call repair from a status query, poll with UAC or make unsupported legacy builds
look supported. Keep the existing pause-target wire format intact. Separate
atomic files cannot be made an authorization transaction: target readback detects
mixing, while protected high admission remains the security boundary.
If a publication fails, the row is only the last published advisory snapshot;
no freshness guarantee or new permission follows. Legacy revocation remains
durable before refresh and cannot be rolled back by a projection failure.

## Implementation And Tests

Parent owns source and scratch tests. Independent read-only sidecar critiques
the projection/eligibility contract concurrently, an autonomous EGM adaptation.
No installed mutation or browser action. Test absent API RED before source edits.
Cover closed envelopes, digest/SID/root validation, exact public bytes, owner-state
matrix, active/idle targets, mixed readback, malformed/corrupt/extra fields,
revocation with missing projection, no-effect call graph and real scratch atomic
publication. Tests must disclose ACL/identity/registry/OS seams. Preserve old
observation guard except intentional new read-only action. Native support query
gets a20second read-only budget for existing whole-archive preflight, worker25s
and page30s with outer headroom (including pre-submit recheck); mutating
requests keep no-kill/no-replay behavior. Retest full ledger and control suites.
Real new-candidate build/enrollment/high/browser lifecycle remains separate.
