# Durable Control Handoff Results

## Scope

Source-only continuation of the full original active Windows-first goal. This
slice joins archive-bound typed kernel admission to the existing original-ID
control transaction. It does not enable public mutation/support actions, build
or install a candidate, or establish real high-pair/protected handoff acceptance.
The fixed sealed CLI dispatch and medium waiter still need integration before
new-candidate UAC, browser recovery/revocation and hosted lifecycle acceptance.

The local scheduler remains a separate delivery surface. Its installed popup,
background and adapter were not changed. Original manual Pause is preserved;
no original conversation prompt was read or submitted. No browser/desktop input,
new UAC/task/service/registry/key/tunnel, production VPN/MCP/IDE/research or
Process Lasso action. No commit/push/tag/Release/Store/npm action in this slice.

## Implementation And Review

1. Added bounded private peer sidecar and public validated-handoff ACK serializers,
   immutable publication/readback and a correlation ID bound to original request,
   actual medium AND high PID/start pairs, session and selected SID. ACK is not
   permission, operation completion, Task.Run success or runtime Ready.
2. Existing transaction reserves the original ID and publishes reserved evidence
   before handoff under its execution lease and short control guard. The new
   kernel entry holds the actual typed witness through final liveness sampling
   and durable handoff, then disposes it before long audit. Later protected
   binding checks remain mandatory and require exact boolean true. Metadata alone
   is not peer admission; no fabricated original reservation is persisted.
3. Reviewer Zeno identified five design gaps. Parent addressed replacement-high
   sidecar collisions; exact sharing-violation busy readback; missing-original
   fencing before ACK; liveness linearization; explicit verifier success contract.
   Busy duplicates/Fence/Reconcile validate original evidence under the guard,
   never replace its runner or replay effects. Missing-original Fence persists
   tombstone and fenced receipt before ACK, including ACK failure. Final kernel
   liveness sample before ACK visibility is the admission point; no impossible
   atomic process-liveness/filesystem guarantee is claimed.
4. Zeno's frozen source/fixture re-review found no confirmed implementation defect
   in the inspected scope, no actual dynamic-scope recursion or improper busy
   effect admission. This was static review, NOT independent test execution,
   high-pair acceptance or whole-product certification. Three follow-up test
   notes were then implemented: integrated busy entry with replacement pair,
   full scratch-substitution disclosure and mandatory final coverage floors.
   Final delta static re-review closed all three and found no new actionable
   scoped finding. Reviewed final fixturebc18f6ef and wrapper16f9224f.

## Executed Evidence

Parent ran actual System32 Windows PowerShell 5.1 with AST-extracted definitions,
never the installation/dispatch body:

```powershell
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -File tests\windows-admin-control-handoff-tests.ps1
npm.cmd run test:admin-control-ledger
npm.cmd run test:admin-controls
```

Handoff fixture progressed from40 cases/346 checks to42/406 and finally45/454,
each exit0. It covers private-before-public ordering; absent/corrupt/mismatched
ACK; initial/between-samples peer death; private/public collision; replacement
high pair after partial/completed publication; guard+execution-lease ownership;
handoff failure without audit/intent/task; duplicate completed readback; active
original busy control/Fence/Reconcile; missing-original fencing before ACK;
failed-ACK late-original refusal; exact binding success; later binding failure;
witness disposal and detached audit; no fake reservation or startup for recovery.

The initial combined ledger/observation wrapper passed13/13, exit0,54.471seconds.
The final45/454 fixture and exact nine substitution-category floors were then
added to the wrapper; final refined full rerun passed13/13, exit0,53.839seconds,
no failures/skips/cancellations. Node control/UI/protocol suite passed80/80, exit0.

Scratch tests use real exclusive file handles for original execution exclusion
and real immutable handoff/store code. They explicitly substitute: ACL/file
creation, owner identity, guard/revision, generation/lease state, lifecycle
intent, projection update, revocation completion, task/audit callbacks, and
source/compiler/peer acquisition. Positive witnesses and high pairs are fake;
no actual high or protected ACL proof is implied. The separate existing archive,
native peer and typed-projection fixtures retain their own narrower evidence.

The exact installed unpacked extension files were also exercised with
EXTENSION_ROOT pointing at the existing e8a56275 unpacked directory: headless
synthetic UI22/22, background40/40 and ordinary adapter16/16 passed. These runs
created disposable local browser fixtures, not a real profile or live ChatGPT
session. They do not clear Pause, prove original-task delivery, or establish
that final production UI reload succeeded after the earlier policy stop.

## Frozen Inputs

```text
scripts/Stage-WindowsAdministratorBundle.ps1
aa39d11f4ad329abeafa731f43dce6e9b57a2591a01dfb6c18623db9c4d07070
tests/windows-admin-control-handoff-tests.ps1
bc18f6eff2f7fa4933a5f69ef38257c4086de3bb0f2cb4d127fab84fab454b68
tests/windows-admin-control-ledger-tests.mjs
16f9224f9486e7943e4477514df5131b951f556ca372c287915f09317202123c
native/desktop-commander/windows-browser-peer.cs (unchanged)
50bd9fca004b21484ccd498acc3f770354d25a20a565fa1e4a92b27eb595f7c8
installed popup.js (unchanged)
12711009d2c3a852d30c5196ebde693243bd21150b9fb9a6bc1adf6c759b0b9b
installed background.js (unchanged)
66c90c0c869ffc2f9caa8c20ee4ef8cf8ced0944253291e24fea83d31d79e4d8
installed adapter.js (unchanged)
67999cf08f15579cbeddf018fad792330ea85e6575e1891887b7426f3050d871
```

Never deploy this unbuilt source using an earlier archive/stager pin pair.
Do not replay settled paused D940, claim new installed controls, or mark the full
goal completed from these tests. Continue fixed sealed entry/waiter integration,
then real new-candidate lifecycle acceptance, before publication.
