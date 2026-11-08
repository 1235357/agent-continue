# Native Fixture Preparation And Semantic Deadlines

## Problem

Native run44 completed the ledger's6144 read combinations and three evidence
groups before its60-second child timeout. Its last publication marker was99;
this is a lower bound, not an identified blocked production operation. Both
observation children exceeded3200ms after entry and before source-parsed.
Startup, initial command discovery and full-source AST parsing were mixed into
the semantic-helper budget. The current negative checks correctly fail when the
child fails; do not restore the former timeout-as-negative-pass behavior.

## Technical Plan

Prepare the existing seven allowlisted observation functions from the current
stager AST once, before the semantic-call deadline. Preparation has its own10s
bound inside each unchanged30s top-level test. Reject missing/duplicate functions,
parse errors, stale source hashes and mismatching extraction manifests. Never
dot-source the full stager. Each semantic child still gets3200ms, uses the exact
extracted function bodies and keeps the virtual receipt seam unchanged.

Partition the ledger's existing contiguous work into read and publication
batches, each in a new child with independent scratch/counters/substitutions and
the same60s child/65s test budget. The CI step remains four minutes. This permits
two bounded ledger children, not a single child extended to120s.

## Alternatives

- Do not raise production or fixture deadlines without measurement.
- Do not cut the adversarial matrix, mock disk snapshots or cache away reparse,
  exclusive-file and cleanup guards.
- Prepared helper semantics do not establish cold installed-stager latency.
  A real installation's startup remains a separate acceptance obligation.

## Detailed Implementation And Acceptance

Only tests/windows-admin-control-observation-bridge-tests.mjs, its.ps1 fixture,
tests/windows-admin-control-ledger-tests.mjs and its.ps1 fixture may change.
No production, workflow, token policy or installed runtime changes are needed.

The read batch must retain33 canonical pairs,6144 disk-backed Gray-code cases
and three evidence-control groups. The publication batch must retain363
append/duplicate/reversal cases,66 damaged-history refusals, selected-SID checks,
invalid-input pre-storage guards, execution leases and the durable-flush source
assertion. Assert exact batch identities and completed groups; a pure partition
test must demonstrate disjoint ownership and unchanged aggregate coverage.

All three positive controls and five negative modes remain. Semantic child
success and completion phases are asserted outside the native transport catch.
Prepared children report prepared-source-loaded, not source-parsed. Preparation
failure, stale/missing manifests, truncated execution and incomplete coverage
must fail independently of the expected unknown wire response.

An independent engineering source review proposed this bounded organization;
parent accepted its scope before implementation. This is not a formal EGM cold
completion verdict. Local verification is limited to pure/source/parser checks;
the normal hosted Windows pipeline must establish actual native completion.
No previously denied local ACL probe is retried through another tool or shell.
