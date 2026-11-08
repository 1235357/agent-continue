# Agent Continue Development Handoff

## Current Delivery Checkpoint (2026-11-08 UTC)

### Final Source Passed; Native Timeout Boundaries Located (Checkpoint80)

Unique main0d1ef2e8405bb8c038aa48f21dec002fad36aba6 was pushed and read back.
Parent final npm test exited0 on that source. Actual Extension checks101,
run42484414122, completed successfully in4m49s. No installed preview changed.

Actual native44 Windows job128743054982, run42484414150, failed in6m17s.
Protected bundle/ACL passed again in34s. Both corrected token-aware fixtures
passed: typed projection1.984s and fixed sealed entry/ACK4.274s. Step17 completed
22/25 tests with three failures at two timeout boundaries, not new identity
failures. Ledger diagnostic output proves all6,144 read combinations completed,
then evidence guards completed; the last stored publication marker was
publication-connect count99 before the60s child timeout. This is a progress
lower bound, not the exact stalled operation or proof of an implementation bug.

Both observation semantic tests failed their new external completion check:
duration3229/3225ms, killed=true, SIGTERM, phases=[entry], before source-parsed.
This proves fixture startup/source extraction did not finish inside the3,200ms
executor budget; the negative fixture no longer false-passes merely because an
executor failure became wire-level unconfirmed. Production cold installed
latency remains unmeasured by these source-extraction fixtures. No budget was
increased and no same-source rerun was requested. Evidence:
.artifacts/ordinary-chat-acceptance-20261108/native44-control-failure-diagnostics.txt
and native44-terminal-failure.png in the same directory. Later native steps were
skipped; the whole native workflow is not passed.

Next source work must distinguish fixture preparation from measured semantic
execution and investigate the exhaustive batch's cost without deleting cases or
relaxing product identity/deadline guards. The entry-bootstrap implementation
design is recorded, not implemented, in the one-action setup plan. Fresh Current
account guided setup's early adjacent-payload rejection also needs the exact
stamped-release exception. Current-account automatic connection, published asset
availability, exact-installation reauthorization, live whole-browser recovery,
GitHub3.0.0 Release and Store review submission remain open. Store readback still
shows Draft3.0.0 and Published2.1.0. Passwords/keys and production systems remain
untouched; the full goal remains active.

### ACL Gate Passed; Later Control Fixtures Classified (Checkpoint79)

Native43 run42481716562, attempt2 Windows job128736015717, finished failed in
6m36s on18fd15a. The protected bundle/ACL step passed in35s: settled-history
readback, fresh immutable paused state and clean Node import fencing all emitted
PASS. This establishes the token-default-owner fixture correction and supersedes
checkpoint78's pending ACL result. The earlier uninstall negative case also
passed without changing its8-second child budget. It does not establish that
the whole native workflow passed.

The later control-ledger step has four failures: a60-second scratch matrix
timeout, two actual-medium-token assumptions on an elevated runner, and an
observation helper returning unconfirmed around its3,200ms executor deadline.
Saved raw failure section:
.artifacts/ordinary-chat-acceptance-20261108/native43-attempt2-control-failures.txt.
Read-only source review traced the two identity cases to deliberate production
refusal of elevated/admin callers before medium capture. Tests must classify the
actual token and assert the corresponding positive capture or exact refusal,
without claiming unavailable medium evidence. The two timeouts still need fixed
phase/completion diagnostics; do not raise budgets, skip cases or weaken guards.

The Devices default-summary work is presentation-only. Independent review found
that old terminal history could mask a newer unconfirmed attempt, and unmapped
terminal states could show a blank or stale summary. Both were reproduced and
corrected.65 rendered checks passed across English/Chinese and1100px/320px;
the parent inspected actual fixture screenshots. Exact IDs and detailed progress
remain in closed Advanced; a transient attempt cannot overwrite a newer journal
snapshot. Parent71 packaging/site/release tests passed48.965s; nine pure token
summary/diagnostic checks and four PS5.1 parse-only checks passed. Independent
diagnostic review found no actionable issues and checked six additional mocked
executor failures. These are not native fixture executions. The parent reran
the full npm test command on the final0d1ef2e source and observed exit0, including
Devices65/65, Setup63/63, Dot adapter48/48, Dot keyboard12/12, MV313/13 and
official ProseMirror5/5. These fixtures do not establish installed hosted
lifecycle acceptance. Native44 run42484414150 and Extension checks101
run42484414122 were actually In progress on pushed/read-back0d1ef2e; their
terminal results remain separate evidence.

Token-aware fixtures now distinguish the C# peer's valid-SID capture contract
from the narrower PS caller helper, preserving exact refusal and lifetime checks.
The3,200ms observation helper must actually complete before either positive or
negative semantic assertions can pass; fixed markers expose swallowed executor
failure. Ledger timeouts retain only bounded whitelisted phases/counts, without
raw paths or errors. Original budgets, matrices and production code are intact.
No installed preview or runtime has changed; the exact test installation remains revoked pending the
existing unanswered same-installation reauthorization. In-app Store readback
still shows Draft3.0.0 and Published2.1.0. No password/key file was read, no
3.0.0 Release was published and no Store review submission was made.

### Inherited Fixture Owner Cause Identified (Checkpoint78)

Native42 run42481191782 on c819ac1 proves state creation completed. Its actual
failure is Assert-InheritedPrivateAcl line8, called by Read-PriorReadOnlyWindow
line27. The inherited receipt directory has three expected role/mask entries
with inherited flags and an unprotected DACL, but its actual owner is
Administrators while the fixture expected the current user. Explicitly sealed
directories still match. Evidence:
.artifacts/ordinary-chat-acceptance-20261108/native42-acl-owner-diagnostic.txt.

Corrected only the fixture's owner substitution to WindowsIdentity.Owner, the
token's default owner for new objects, instead of WindowsIdentity.User. A missing
owner is an error, not a skip. Microsoft's definition is documented at
https://learn.microsoft.com/en-us/dotnet/api/system.security.principal.windowsidentity.owner.
Production ACL assertions and installed state are unchanged. The hosted rerun
must establish the correction and any later failure; native42 remains a failure.
The latest71 package/site/release checks passed in49.480s on c819ac1. Release,
Store review submission and the remaining real lifecycle/one-action gates remain
open; the current test installation is still revoked.

Native43 run42481716562 first attempt stopped earlier in the uninstall-result
negative test: expected exit1, observed null, with an8-second child timeout.
It did not reach the owner correction. One rerun of only that failed Windows
job was requested on the same18fd15a commit; attempt2 was actually In progress.
No timeout or assertion was relaxed. Do not record the ACL correction or full
native suite as cloud-passed until that rerun provides evidence.

### Cloud ACL Diagnostics Follow-up (Checkpoint77)

Native40, run42479430126 on531149c, failed the same protected-state fixture
assertion after the stop-receipt assertion. The raw log emitted no ACL diagnostic;
this is not an ACL-root-cause result. The diagnostic helper had a reproduced
short/long-parent comparison defect: two equivalent path cases failed before
the correction. The corrected helper passed8/8 pure path/scope cases independently
in Windows PowerShell5.1 and PowerShell7. It now emits bounded fixed status/phase
markers even when collection skips or fails, while preserving the original
assertion. No product ACL, installed runtime or registration changed. Its next
cloud run is still needed to identify the actual permission difference.

Follow-up native41 run42480333204 on24dd3b3 passed the8-case path regression,
then failed after the same stop assertion with no collection-start marker. Thus
the earlier creation-only attribution is not established. Collection now runs
from the outer test failure handler, including later history/state assertions;
only whitelisted function names and integer line numbers are added to its stack
output. Fixed phase markers separate completed state creation from later reads.
The original error and cleanup remain intact. Fourteen worker pure checks and
the parent's separate path/frame-redaction checks passed; this is not an actual
ACL filesystem result. The next hosted result is required before any SID or ACL
policy change. Three remaining one-action UX gaps are recorded in the setup plan.

The installation remains revoked pending the unanswered same-installation
reauthorization question. Actual whole-browser reopen recovery, remaining hosted
acceptance, GitHub3.0.0 Release and Store review submission remain open. The r17
Store3.0.0 upload is a draft, not a review receipt or published version.

### Final Source Regression And Store Draft Refresh (Checkpoint76)

Main fbd8d58247e416da54a63042769e5961980fbc2f was pushed and read back.
The final source passed the complete npm test command, including the last
native-call deadline adjustment. Extension checks93, run42477125044, succeeded
in4m45s. This supersedes checkpoint75's earlier full-regression qualification.
The administrator-control regression remains401/401; local browser fixtures
are not actual hosted whole-browser lifecycle acceptance.

The Store draft now contains the r17 3.0.0 package, SHA256
d5d62b994e2029e66f686195064d5025be1378251be4b192577ff3fa8fd5e95e.
The public and Store packages passed their distribution-pair check. All247
installed r17 members matched; r16 to r17 changed CHANGELOG.md only, not code.
The actual Package page shows Draft3.0.0 and Published2.1.0. No review submission
or3.0.0 GitHub Release is established. Proof:
.artifacts/ordinary-chat-acceptance-20261108/store-r17-package-draft.png.

Experimental native38, run42477124953, failed its negative tampered-stager case
at fixture_cleanup_scope after reaching the expected payload rejection. This
is separate from the successful formal delivery7 build. A test-only directory
alias correction passed parent29/29 cases in31.40s, zero failures or skips.
Two original-guard regressions failed before the correction; independent review
also found an extended-UNC prefix bug, reproduced red and then fixed. Actual
cleanup is checked only after canonical containment, strict naming and ancestry
reparse rejection. No product guard or15s/20s timeout was relaxed. The precise
CI38 short-name cause is still unconfirmed until hosted rerun; the local volume
does not allocate8.3 aliases, so extended-path aliases reproduce the failure class.

The fixture correction was pushed as99d73d089e069afe47d579f0cb4daf6b2fc6392b.
Native workflow push/PR filters omitted that exact test file, so it did not
automatically rerun. Added the precise file to both filters; the new contract
failed for both events before the fix, and the release-workflow suite passed
21/21 afterward. Hosted native rerun remains a separate pending receipt.

Follow-up readback: pushed main2f502b4322cefca02bd33da6e4334ffaedcad7ba
triggered native39 run42478533593. Its Windows offline suite passed29/29 in
14.006s, including real8.3 parent/leaf aliases and the formerly failing negative
case. The next protected-bundle fixture failed with sealed_acl after the
"stop is private, idempotent" assertion. The compound guard also checks owner
and protection, so do not claim an ACE-count cause from that line alone. No
product ACL was weakened or changed. Actual full log excerpt is preserved in
.artifacts/ordinary-chat-acceptance-20261108/native39-bundle-failure.txt.
The latest combined Python package/site/release regression passed71/71 in51.536s.
Native39 as a whole is NOT a pass; the later steps were not reached.

The protected-bundle test now includes failure-only bounded ACL diagnostics
around that specific state-creation call. It reports at most16 scratch-relative
directories and16 ACE roles/masks per descriptor, not raw SIDs, ACL strings,
private paths or errors; it rejects reparse entries and rethrows the original
assertion. Static review and PowerShell syntax checks passed. No behavioral
result is established: the local disposable probe was rejected by the tool's
process-launch policy before execution and was not retried through another
route. No probe fixture/job remains. This diagnostic is not a product fix and
does not authorize restoration of the separately revoked hosted test runtime.

The r8 test installation remains revoked with its original Revoke stopped.
Reauthorization has been requested but not received; do not reconnect or infer
new authority from old grants. Current-account hosted operation, actual browser
exit/reopen restoration and final Dot write/owned-process proof remain open.

### Verified Recorded Revoke Completion And Delivery Build (Checkpoint75)

The installed IAB candidate was updated to r16, with247/247 package members
hash-verified at the existing observer-reattachment installation path. Browser
storage, permissions and native registration were not changed. The temporary
scheduler still shows one confirmed send and is paused at its one-send limit.

The original Revoke ee5180ab1aa742b5a30eb02d584ef528 was reconciled exactly once
through the actual Devices UI. Independent protected observation and the manual
GUI receipt read now both report stopped. The Recover/Fence buttons are disabled
after that terminal readback. This supersedes checkpoint74's pending shutdown
evidence; it does not reauthorize the revoked installation or reconnect it.
Proof: .artifacts/ordinary-chat-acceptance-20261108/r16-revoke-stopped.png.

Independent review caught a stale-journal dispatch race and a pre-existing
native-call deadline gap. The final guard checks the active record in the short
journal queue but releases the queue before native completion. The same deadline
now covers native precheck, dispatch, response and postcheck; late completion
cannot dispatch or publish a result. Earlier caller admission remains outside
that native-call budget. Parent administrator-control regression401/401 passed;
independent worker130/130 and two shared-budget probes passed. Full npm test
passed before this final deadline adjustment;70 packaging/site/release tests
also passed. These local tests do not replace live lifecycle acceptance.

Formal Verify Windows Delivery7 run42476011608 on bbe383b succeeded in6m53s;
Extension checks92 run42475982637 also succeeded. The delivery workflow verifies
the six combined sidecars and ordinary-token build/smoke receipts, not hosted
installation or publication. The local combined setup build passed its closure
and Plan checks, using the unchanged7e174a runtime. It did not install anything.

The personal Store remains authenticated. Draft3.0.0 still contains r14;
published2.1.0 is unchanged. No3.0.0 tag, Release or review submission exists.
Remaining live gates are current-account hosted operation, whole-browser
saved-running/Pause/Revoke restoration and final Dot write/owned-process proof,
followed by matching final artifacts and actual publication/submission receipts.
Reauthorization of the now-revoked test installation was requested separately;
do not infer it from the old consent or replay the settled Revoke.

### Recorded Revoke Recovery And Reproducible Runtime (Checkpoint74)

Actual IAB r14 Revoke operation ee5180ab1aa742b5a30eb02d584ef528 reached
protected revocation-recorded, with ownerState revoked and the previous owned
broker98000/root61188 absent. Manual GUI receipt read returned the same recorded
state. This is denial evidence, not a stopped receipt. The GUI incorrectly
disabled Recover because it shared the startup-slot terminal classification.
The coordinator and UI now allow explicit same-ID reconciliation only for an
active-journal recorded Revoke. Fence, archived references, other terminal
states, permission checks, exact identity and startup denial remain unchanged.
The four new red cases failed before the fix; parent scoped regression376/376
and full npm test passed. Independent review and live reload/reconciliation are
being checked; no stopped or completed-revocation claim is made yet.

A new ordinary-token offline runtime build completed with24328 members and
107068948 bytes. SHA2567e174a6571003b45ceca557fb01dc4a62f3d1324cb33f012cb273c37154c7fb2
exactly matches the installed r8 bundle. No installation, registration, new
authorization or tunnel was performed by this rebuild. Output lives in
.artifacts/windows-release-verification-20261108-c74/.

Extension CI91 passed on c0cc4ad. Native CI37 run42474404114 passed its recovery,
Verify and Uninstall steps, then Windows offline-payload fixtures timed out.
The fixture-only bootstrap now explicitly imports complete modules, restores
the original autoload preference, emits phase diagnostics and remains bounded
by the same15s child/20s case deadlines. Parent26/26 passed in29.48s, zero skips;
the hosted cause/cure remains unverified. No product timeout or gate was relaxed.
Store remains draft3.0.0 r14, published2.1.0 unchanged; no3.0.0 Release or review
submission. The personal Store login is already authenticated; passwords were
not accessed. Preserve the original Revoke ID and do not repeat it.

### Dot Read-Only Administrator Proof And Hosted Path Alias (Checkpoint73)

The independent, read-only Dot token check returned PID87952 and JSON marker
AC_DOT_READONLY_TOKEN_20261108_72 with administrator=true. Dot reported that
process finished but no exit code was provided. This supersedes checkpoint72's
pending Dot administrator observation, not the refused dot-admin-probe.ps1.
That write/child-process script was not retried and its output remains absent.
Proof: .artifacts/ordinary-chat-acceptance-20261108/dot-readonly-admin-result.png.

Native run42473888039 on73a8610 passed Ubuntu and macOS; Windows passed its
module bootstrap execution and12 diagnostic cases but failed the bootstrap
test's exact path-string comparison. The actual FileInfo.FullName expanded
RUNNER~1 to runneradmin while the expected Node temporary root retained8.3 form.
The test now compares both existing paths through native realpath; all remaining
module/hash/JSON/discovery assertions and time budgets are unchanged. This is
a test-only alias correction, not a product authorization change or evidence
that all later Windows delivery steps passed. Store draft3.0.0 remains r14 and
unsubmitted; main-only source sync continues. Password files were not accessed.

### Verified Reconnect And Public Store Links (Checkpoint72)

The existing GUI Connect operation c67639ecdc56411db5406001622ce640 was NOT
replayed. It reached r8 generation8fefb168004148bb8a78b6742ff3fae7. Protected
owner-status and independent ObserveHostedOwner returned ready; the actual
Devices Check administrator status also showed the last check ready. This
supersedes checkpoint71's pending readiness, not its operation history. Saved
progress still says waiting-owner; that historical progress is not current status.
Proof: .artifacts/ordinary-chat-acceptance-20261108/r14-admin-ready.png.

Public documentation source8fcdcc2 was pushed to main. The GitHub Pages source
was explicitly set to Actions; Pages run42473012368 succeeded and reported
https://1235357.github.io/agent-continue/. Both the homepage and complete
privacy.html rendered in IAB. Generator11/11 tests passed. The Store homepage,
support and privacy URLs were updated and saved; Submit for review became
enabled, removing the former URL-timeout blocker. r14 ZIP upload completed and
the Package page returned draft3.0.0; public2.1.0 stayed unchanged. This is not
review submission or a CRX-content readback.
The authenticated personal Store session was used; no password file was read.

Dot returned the exact disposable Read File marker through the selected app.
It reported Start Process rejected by its safety review because it considered
the operation a repeat. The dedicated dot-roundtrip-5b2063ae.txt does not exist.
No second process start or alternate-ID replay was attempted. Therefore this
continuation establishes Dot file-read only, not a new Dot administrator run.
The earlier D940 proof remains historical and is not a final-artifact substitute.

Native CI35 now passes Utility import but other cases stall after bootstrap-start
or before their first body milestone. Implicit Management discovery is a suspect,
not an established underlying cause. Test-only bootstrap explicitly
imports the complete real Management and Utility manifests, briefly disables
autoload only for those imports, then restores the original preference. It adds
phase milestones and a strengthened regression. Parent recovery38/38 passed,
zero skips. Independent review found no actionable defect, passed the bootstrap
and one diagnostic test, and passed10 separate success/import-failure restoration
probes. Its recommendation to commit broader restoration regression coverage is
non-blocking and remains open. The hosted cause/cure is not yet proven. The37 product cases and
15s/20s limits are unchanged. New-runtime Revoke, full browser reopen, final
current-account/Dot lifecycle and delivery-build gates remain open. No3.0.0
Release or Store review submission is claimed.

### Current Binding Upgrade And Live Pause (Checkpoint71)

Main6bcbb23 was pushed. IAB r13 reload and same-popup Devices navigation were
actually verified, superseding the pending-install statement below. Read-only
DevTools Application storage then showed the saved setup installation still
pointed at ec7 while the registered native host pointed at r8/7e174a. No storage
was cleared or edited. This was a second upgrade case, not the unassociated
legacy-LAST case tested at checkpoint70.

The repair probes the current correlated binding before using stale setup
metadata. A different binding requires verified stop support; original Pause IDs
remain routed to their original installations. A missing binding read can still
deny the saved installation through its exact native-validated bundle, without a
legacy-protocol downgrade. The two upgrade regressions failed before the patch;
the five-suite run then passed544 tests. Fresh independent review passed356
repository tests plus53 separate in-memory fault checks with no actionable finding.

Scratch r14 was copied247/247 and explicitly reloaded in IAB only. Store ZIP
SHA256:d84a1f87eb59555540f58206a57c9d13aa5e613cfc9ed87a0f1a13162eec3c8d.
One GUI Pause produced operation7f53192a5ef04ae28cf667c71091524a. Its protected
receipt and independent native readback both returned stopped; current owner
projection was paused and its previous broker/root PIDs were absent. The GUI
also showed the operation-specific verified-not-running message. This is not
a current connectivity claim, full browser reopen proof, or release approval.
The subsequent GUI Connect is being checked; do not blindly replay it.

Windows recovery fixture now avoids implicit Management discovery caused by
Join-Path before Import-Module, retaining the same Utility manifest. A new
pre-import milestone and discovery-disabled regression distinguish those phases.
Local recovery38/38 and all three existing selectors passed. The hosted hang
was not reproduced locally; this is not a claimed CI cure. No timeout/security
policy was relaxed. No3.0.0 Release or Store review submission yet.

### Live Ordinary-Chat Acceptance And Upgrade Pause Repair (Checkpoint70)

Follow-up: both independent Pause findings below were repaired. Parent's five-suite
run passed537 tests; a fresh follow-up review independently passed354 repository
tests and57 additional in-memory fault/compatibility checks with no remaining
actionable finding in that scope. Live Pause acceptance is still required.
Popup setup/device navigation now stays in the toolbar popup after saving the
draft; full-view/Expand behavior is retained. The12-case navigation matrix and
34 UI checks passed with mocked extension APIs, not yet installed-IAB acceptance.
The new scratch r13 was copied247/247; it has not been reloaded at this note.
Store SHA256:7e2414f8e37245af555df327a0f46b387f6a48e79f57ed39cc4da95d6612eca9.
Native CI34 showed macOS success, Ubuntu failure and a Windows step timeout.
The Windows raw log shows every observed recovery child entered, then timed out
before utility-imported at15seconds. This identifies the explicit module-import
boundary, not a proven underlying cause. Do not increase timeouts blindly.

This section supersedes the in-progress readiness statements below, not their
historical receipts. Canonical main was pushed through1746f03; no3.0.0 Release
or Store review submission has occurred. The full product regression exited0.

After r10 reload, saved-running restoration created owner generation
f32647664aea458eb0a1655034aa7bd9. Public owner status and an independent native
status request both returned ready. Reload resets browser session storage;
this was NOT a full browser exit/reopen test. Do not replay the failed97d46
Connect or its exited a8a782 owner generation.

The existing ordinary ChatGPT acceptance conversation actually called Read File
and returned the exact disposable marker. It then ran admin-probe.ps1 through
Start Process, returning administrator=true, roundtrip=true and an owned child
started/stopped result. Parent independently matched the result-file SHA256
f600ac27d2bda9d505e2a6a47e6b7a3af8c9cfd78953e32ea851c412f1243c22.
The script waited for its child exit and the browser reported process50100
finished. Proof: .artifacts/ordinary-chat-acceptance-20261108/read-file-result.png
and administrator-result.png. These bounded results do not prove all lifecycle
controls or universal reliability. Do not rerun admin-probe: its result exists
and its explicit no-replay guard must remain intact.

Actual GUI Pause did NOT send a new native request: the old ec7 unassociated
LAST record00b11992c1a04b0f9fe4180f1861a90d blocked the new installation path.
The r8 runtime therefore remained running; do not claim it paused. The extension
repair and fault regressions are in progress. An independent review reproduced
capability-error fallback and fresh-archive conflict defects despite291 related
tests passing; those findings remain release blockers until repaired/reviewed.
Scratch r12 was byte-matched247/247 and reloaded only in IAB; it is NOT a final
release candidate. External Chrome, production VPN/MCP/IDE/research stayed intact.

Manual Verify Windows delivery6 on1746f03 failed after three official archive
HTTP504 responses (11.8/14.3/18.8seconds), before building any delivery artifacts.
Do not classify the bounded downloader as successful acquisition. The Store
still holds old r9 ZIP draft3.0.0; published remains2.1.0. Its saved remote-code
answer now truthfully discloses the optional cross-origin loopback iframe's
local JavaScript outside the extension ZIP. Store submission validation also
reports both Homepage and Privacy policy GitHub links unreachable by timeout.
Final package, screenshots, current lifecycle/Dot tests and external receipts
are still required; do not silently waive them or weaken protection.

### Final Candidate Installation And Store Draft (Checkpoint69 In Progress)

Latest diagnosis: the one r8 Connect below did NOT reach Ready. Its exact owner
generation a8a78288c4c14c79a976078530050e4d exited1, with a protected terminal
receipt proving root exit and inner-lease cleanup. Read-only installed Node
authorization verification returned true. The browser witness pipe was absent;
after a scoped IAB preview reload it was present. Do not claim a proven hosted
connection or replay97d46acf570947599473f21a577f46c4.

Source regression reproduced a distinct startup defect: manual Connect and
resume-saved did not prepare the browser observer after a pre-install missing
host. The extension-only fix now waits for a correlated observe-only attachment
before reserving an operation; Pause/Revoke/permission loss cancel the await.
Revoke and receipt reads do not require the observer. Related188/188 tests and
the new actual-two-module11/11 integration tests passed. An independent review
found no actionable issue within that scope. This is not native/hosted acceptance.
The exact247-file r10 preview was installed/reloaded in IAB; its Store ZIP hash
is d41487c8da0cd13eea595289a2d233787b6a1579b3e20f68c63e33b0b8eeab7e.
The Store still holds r9 until replacement; the runtime remains unchanged r8.

Store data-usage draft now includes personally identifiable information,
authentication information, personal communications, web history, user activity
and website content. No new review submission or policy certification receipt
is claimed. Actual current-account/admin lifecycle and final hosted calls remain
required. In particular, broad FAQ at-rest encryption language needs reconciliation
with explicitly documented plaintext browser storage/protected runtime files;
do not conceal that boundary or assert legal/compliance approval.

Canonical main now includes14f1c0d, actually committed/pushed after independent
review and parent recovery37/37pass in43.2s. The test-only change replaces62 cold
PowerShell launches with37, one per case, preserving15s child/20s case/3min step
limits and cache path/length/timestamp/SHA256 readback. The three CI selectors
cover12/13/12 distinct cases. This does not yet resolve the hosted first-child
15s timeout; new milestone diagnostics must establish that separately.

Final parent complete product regression and package107/107 passed. A separate
artifact audit matched extension-r9 and closure-r8 to the be67563 product source:
247 extension files,50 setup files,24328 administrator entries and matching
sidecars/dependencies. Later14f1c0d changes tests only, not these product bytes.
Store ZIP SHA256 is474dd9d2a62d5780df06cec3da2fb700215905c101abd4a20653fae86c9f109e.
Administrator ZIP SHA256 is7e174a6571003b45ceca557fb01dc4a62f3d1324cb33f012cb273c37154c7fb2.

Actual IAB extension hjnopijiekcbgiljjfiekeiepkebhido was mechanically updated
to exactly247 r9 files and reloaded as3.0.0; original path/ID/permission/storage
were retained. The previous candidate folder is preserved locally. External
Chrome's original scheduler was not reloaded, rebound or resumed.

Old dedicated ec7 administrator runtime was paused with exact stopped receipt
00b11992c1a04b0f9fe4180f1861a90d, then revoked with exact stopped receipt
af21ebc5e3fa45fd929574eb308a38d4. Unenroll exited0; independent readback found
the old administrator_owner HKLM registration absent and no AgentContinue task.
Old files/credentials/evidence were retained. Do not replay either operation.

New r8 installation3f65db52f84b4a4997d4b6038e58ea3b completed with protected
receipt: all24328 files/ACLs, state, clean launch plan, real administrator child,
binding and browser enrollment verified. It finished ready-to-connect, not
connected. Root is C:\Program Files\AgentContinueAdmin\7e174a6571003b45ceca557f.
One subsequent GUI Connect was admitted as97d46acf570947599473f21a577f46c4;
its saved intent and launch-requested receipts exist. Current phase is waiting
for runtime, not yet verified Ready. Never reissue that Connect blindly.

Authenticated Google Store actually accepted the exact r9 ZIP: draft3.0.0 with
optional nativeMessaging; published version remains2.1.0. Canonical full English
description, developer/support links and native/storage/single-purpose draft
disclosures were saved. This is draft preparation, NOT review submission or
publication. Final screenshots/data categories/certification remain to reconcile.
Proof: .artifacts/windows-one-command-setup-20261108/checkpoint69-store-draft-3.0.0.png.

CI for be67563 is not all green. Extension83(run42464684301) succeeded.
Manual delivery5(run42464737554) failed twice while downloading the official
pinned tunnel archive with HTTP504, before building. Native31(run42464684180)
failed Windows's first15s recovery child and macOS's live client acquisition;
Ubuntu passed. Preserve pins and timeouts; bounded CI-download repair is being
reviewed separately. No new GitHub Release/tag or Store review was submitted.
Goal remains active. Password file remains unread; production VPN/MCP/IDE and
research work were not changed. The ordinary acceptance host is still the old
protocol and must not be reconnected to the administrator-owned tunnel.

### Current Control Integration (Checkpoint68 In Progress)

Canonical remote main is512bd875, actually verified in IAB. Windows delivery4
(42462329376) succeeded5m59s and Extension checks82(42462309737) succeeded4m32s.
Native checks30(42462309731) still timed out at the Windows read-only recovery
step after3minutes; Ubuntu/macOS passed. Do not claim every CI job is green.

The page/controller, worker and native slices are now source-integrated. Pause
uses an authenticated same-owner attach rather than waiting behind Reconnect;
primary and priority Pause retain separate durable records. A full product run
passed, including13 MV3 and5 official ProseMirror scenarios. Native full suite
passed269 with4 existing platform skips. Independent critique then reproduced
two narrower retirement/late-exit defects; their repairs passed133 parent-run
controller/worker/source cases and23 focused native cases. A second final full
product run is in progress. Counts overlap, and none establishes installed-host
acceptance. The legacy graceful-close test now disconnects its exact client
before shutdown and asserts Status remains reachable/new Reconnect is denied.

Windows recovery35/35 passed locally with asynchronous child diagnostics and
the original15s child/20s case limits. CI now splits all35 distinct cases into
10/13/12 positive-prefix groups, each retaining the3-minute step limit; hosted
verification of this source is still required. The actual Windows-only slowdown
was not identified by the old buffered log. No production defect is inferred.

Official Node22.23.4 ZIP was downloaded through IAB and matched the pinned digest.
Local closure-r7 built/Plan passed but predates the final late-exit repair; it is
superseded, not a release input. closure-r8 rebuild is in progress. Extension-r9
contains the final worker repair and is a candidate only. An attempted npm
package run without the required combined-closure environment failed exactly at
that prerequisite; rerun with the new original build receipt, not a bypass.

IAB native UI verified installed2.2.1 preview IDhjnopijiekcbgiljjfiekeiepkebhido;
no preview reload or native cutover occurred. External Chrome and production
VPN/MCP/research remain untouched. Final installed lifecycle/Revoke, exact new
artifacts, Release and Store submission are still open. Google password file
remains unread and unnecessary; authenticated Store is Published-public2.1.0.

### Previous Hosted Results (Checkpoint67 Historical)

Remote main matches7a734ba. Full local product regression passed, but actual
hosted verification is not green: manual run42460884036 passed ordinary-token
build/smoke then failed the combined setup Plan. Preserve that Plan requirement
and recover its bounded failure phase before selecting a correction. Automatic
native run42460845490 passed Ubuntu core/macOS bootstrap; its Windows read-only
installer step timed out. The locally reproduced digest-less fixture failures
were repaired with real synthetic-entry hashes, not an unverified-payload flag.
The34 original cases and a separate tampered-entry negative case passed locally.

Extension run42460844687 still fails Linux fallback-font administrator layout
(Copy bottom612.34375 in320x600); the original viewport assertion stays intact.
Independent wake review found inherited false-negative terminal reconciliation
and missing blocked-by-local-control recognition; narrow fixes are in progress.
Unknown no-reply mutation availability remains a separate open issue. All latest
work is source/fixture-only. Do not reinstall/replay settled acceptance operations
or advertise a new Release/Store submission. The authenticated password file is
still unread and unnecessary.

The narrow fixes now pass202 parent-run wake/device/Pause cases (46 wake), and
the wider-font compact layout passes63 render cases. Full UAC risk text remains;
the selected Administrator label is concise to avoid truncation. The Plan wrapper
also now retains bounded failure phases and safely normalizes Archive aliases;
its17 tests pass15 with two unavailable TEMP-alias cases skipped. A real existing
alias demonstrated the preserved archive rejection, but Run3's lost phase cannot
be reconstructed as fact. No-reply control progress still requires the proposed
separate existing-owner channel; see the dated design, not a completed feature.

### Hosted Verification Follow-Up (Checkpoint66 In Progress)

Canonical main was actually pushed through41d79c4; no version tag, GitHub Release,
npm publication or Store submission exists for this candidate. The Store account
is authenticated; do not read its password file or repeat sign-in unnecessarily.

Hosted Windows run42459799286 passed the formerly incorrect initial-output check
then found a later test race between provider start admission and the child's
file effect. Same-PID bounded readback now precedes the race-effect assertion;
no start is replayed. Local pinned stdio passed67 RPC replies/0 protocol errors.
The next hosted run remains required. Other actual CI failures are documented in
RUNTIME-ACCEPTANCE.md; do not assume main is green from local tests alone.

The compact setup repair retains the original first-viewport assertion and adds
a fallback-font repro of the exact619.0625px failure. Parent rendered rerun passed
56/56. Complete disclosure, consent and Copy now fit320x600 for both Windows
scopes, with Advanced closed. No viewport-scaled font size or hidden disclosure.
The Windows wake fixture dependency repair passed30/30 and local native tests
passed269 with four existing platform skips. Darwin short-socket test setup keeps
canonical-path/inode cleanup; Windows device-setup passed58 with two Linux skips.

The five scoped browser-wake findings now have regression repairs (196 focused
checks, including40 wake cases). An unresolved no-reply mutation still retains
its slot/fence indefinitely, blocking generic status/Pause. This is a known
availability limitation, not evidence that manual control is fully accepted.
Do not erase its journal, regrant permission or replay the mutation to bypass it.
Ordinary/protected closure tests now prove the exact guarded sidecar split and
packed-host administrator refusal. Legacy EXE sources must stay excluded from
the command-only package; the old inclusion assertion was corrected accordingly.

Do not publish until remaining browser-control, final artifact and
lifecycle/revocation gates are resolved. All current changes are bounded source
or disposable-fixture work; installed production connections were not changed.

### Real Current-Account Setup And Repeat-Command Repair (Checkpoint65)

Independent browser-wake critique identified additional unresolved-operation and
timeout cleanup defects after the nominal real reattachment succeeded. A rejected
later mutation can incorrectly retire an earlier browser-side uncertainty fence;
read-only timeout/local disconnect/cancelled owner-write cleanup can latch the
port or owner; a matching terminal status does not retire its uncertainty. Native
operation guards separately reject conflicting unresolved operations, so this is
not evidence of an actual downstream Pause bypass. Focused regression repairs are
in progress. This source checkpoint is explicitly unreleased; do not tag, upload
or advertise it as final while those findings and the lifecycle gates are open.

The installed IAB candidate now also passed real post-install bridge recovery.
The extension worker had started before the native host existed; its consumed
initial attachment attempt previously left later Devices status requests unable
to find the newly installed bridge. An explicitly authorized read-only status
request may now await the pending handshake or reattach to the exact wake host.
Owner/mutation fences and the automatic recovery budget remain enforced; a status
request cannot replay a mutation or clear Pause. The focused browser-wake suite
passed22/22 and related source fixtures144/144 (overlapping counts).

Only browser-wake.js was backed up, copied and hash-checked into the existing IAB
acceptance preview before its scoped reload. Actual Current account status then
reported Browser permission=Granted, Standard bridge=Bridge reachable, Standard
MCP=Disconnected and Pause=Paused. This proves native launch and bounded state
readback, not a tunnel connection or a chat grant. The scheduler remains paused
at its one-send limit. Do not connect this current-account target to the same
test tunnel while the dedicated administrator binding is in use.

Store authentication was completed by the owner and reacquired in the built-in
browser. The actual dashboard reports Published-public version2.1.0 and draft
version2.1.0; GitHub scheduler2.2.1 is not proof of Store publication. No password
file was read. Extension-r7 supersedes r6 after the browser-wake repair; setup
closure-r6 remains valid because that repair changes only the extension worker.

The default experience remains one selected account, one consented command and
automatic orchestration; Windows elevation and platform tool approval are not
silently replaced by application consent. Advanced diagnostics stay collapsed.

A fresh dedicated current-account installation actually completed with exit0:
configured=true, registered=true, connected=false. The exact IAB extension origin
was registered under the separate current-user device_wake host. No existing
ordinary installation, administrator connection, production VPN or research task
was replaced. Browser launch, connection and chat authorization are separate from
this installation receipt and were not claimed.

Repeating the real packaged command initially returned existing-unconfirmed:
the adoption inspector required an extracted bin.mjs although the public release
ships an adjacent setup ZIP. This was a packaging-path defect, missed by the
earlier extracted-function fixtures. The inspector now takes a digest-verified
local ZIP snapshot, validates and extracts it only into guarded temporary space,
and executes only the read-only inspection command. It never downloads source,
provisions Node, changes registration, reads connection credentials, starts a
tunnel or clears Pause/Revoke. A bad declared archive cannot fall back to an
unverified entry point.

The real parent-dispatch regression passed4/4 (matched, tampered, missing and
failed-child cases), with unchanged lifecycle files and empty scratch afterward.
The existing offline suite passed22/22 and extracted PowerShell boundaries34/34.
Rebuilt closure-r6 then inspected the actual new installation successfully:
existing-matched, registration=matched, mutationPerformed=false, runtime=not-
observed, chatAuthorizationVerified=false. The first failed installer invocation
used a relative request pathname under PS5.1 startup; it failed before destination
creation. The successful fresh invocation used an absolute request pathname.

Independent public-source review covered307 prospective changed/untracked files:
no confirmed real credential/private key or missing required source. Operational
checkpoint identifiers and owner-local paths are metadata, not authentication.
The review is not full behavioral/security certification. New manual verification
workflow and CI adapter changes were subsequently reviewed separately; workflow
contracts25/25 and full CI runner source/benign-fixture20/20 passed. A real hosted
Windows run is still required. The workflow cannot publish/tag/release and keeps
the existing ordinary-token builder/smoke protections.

Local r6 setup and paired extension packages are built, not yet published.
Checkpoint65 logs/receipts are under .artifacts/windows-one-command-setup-20261108.
Do not replay settled Connect/Bind operations. Whole-browser administrator saved-
running restore, final Revoke, hosted CI and actual Release/Store receipts remain
delivery gates. The full native goal remains active.

### One Selected Account And Existing Installation (Checkpoint64)

The owner requires one practical consented setup command, not a sequence of
hashes, receipt IDs and manual repair commands. Browser-managed Devices now
shows an accessible Current account / Administrator selector and only the
selected account's controls. Switching is presentation-only. Primary Revoke
can make its bounded read-only capability check before the unchanged explicit
confirmation; it no longer requires discovering Advanced first. Diagnostics
remain closed by default. The three Devices assets were backed up, copied and
hash-checked into the existing IAB candidate, without reloading its worker or
starting/stopping the tunnel. Actual native UI switching was observed both ways.

The exact existing ec7 administrator bundle, sealed stager, public bridge,
registry and task were inspected with the new read-only installer route. The
complete installed file inventory passed and returned existing-matched / open-
devices, with mutationPerformed=false, installed=false and registrationChanged=
false. Private tunnel/credential binding is deliberately not inspected; connection
and chat authorization are not inferred. No fresh setup receipt or Connect ID
was allocated. Never replay the already-settled checkpoint63 Connect.

The existing Dot conversation also completed the bounded checkpoint64 test on
this same runtime. Independent readback matched the v2 administrator witness
(TokenElevation=1, high integrity), temporary file and owned-process witness.
The original four operation IDs have provider-result receipts; list_sessions
reported no active sessions. This is actual bounded Dot execution, not proof of
arbitrary reliability, future model progress, or browser-reopen recovery.

CI now has a source-level disposable hosted-runner ordinary-token adapter, with
unchanged builder/smoke guards. Its account/logon/ACL closure has NOT been tested
on an actual hosted runner. Broader source review found disclosure/link/retired-
launcher documentation inconsistencies being corrected; historical operational
checkpoint metadata must be reviewed before the public repository push.

The selected-account browser fixtures were updated and the full product run
exited0, including40/40 rendered Devices checks,24/24 UI checks,13/13 actual MV3
fixture scenarios and5/5 official ProseMirror cases. These nested suites are not
a unique aggregate count and their synthetic browser restart is not the real
administrator-runtime reopen gate. The public-package suite also exited0 with
96/96 cases and no skips, including actual npm pack/extraction and disposable
offline installation. An earlier invocation missing the original combined-build
environment failed closed; it was rerun with the exact r4 inputs, not skipped.

Current-account adoption additionally passed7 JS cases and34 PowerShell fixture
checks. It preserves existing lifecycle/Pause/Revoke files, never starts a
connection and refuses partial/incompatible/denied/unconfirmed installations.
This is source/fixture evidence, not a fresh owner-PC current-account install.

The stale installer recovery-command dependency is fixed: it now contains exact
read-only receipt reader/validator snapshots and only public operation/hash/SID
identifiers. It derives the protected receipt location and verifies the current
SID; it does not depend on temporary setup files, read a key, request UAC or
replay installation. The focused recovery suite passed362 checks, including
actual absent-receipt PowerShell observation and in-memory successful-reader
fixtures. The updated complete Windows guided-install suite also exited0. Its
new test is part of the default Windows guided test command, not a manual-only
extra. The self-contained command is11786 characters, not an application binary.

Closure-r5, paired extension-r5 and npm-r5 are rebuilt after this fix; r4 remains
historical. Final integrated npm test exited0. The updated exact-r5 public-package
suite passed103/103 with no skips, including current-account adoption and actual
pack/extraction/disposable offline installation. Extension packaging32/32 and
CI adapter source/benign-process35/35 also passed. These are overlapping bounded
suites, not a total unique test count or hosted CI acceptance. npm0.3.0
and extension3.0.0 are independently versioned local candidates, not public
installation routes. The installed IAB preview retains its2.2.1 identity. Fresh
install, actual hosted CI, whole-browser administrator reopen, installation-wide
Revoke and actual GitHub/Store delivery remain separate gates. No Git/npm/Store
write occurred.

Retained final checkpoint64 evidence:
- .artifacts/windows-public-3.0.0-extension-r5/ (GitHub and flat Store ZIPs)
- .artifacts/windows-public-3.0.0-closure-r5/ (six pinned Windows assets)
- .artifacts/windows-public-3.0.0-npm-r5/agent-continue-0.3.0.tgz
- .artifacts/windows-one-command-setup-20261108/checkpoint64-public-build-receipt-r5.json
- .artifacts/windows-one-command-setup-20261108/checkpoint64-full-regression-final.log
- .artifacts/windows-one-command-setup-20261108/checkpoint64-guided-install-final.log
- .artifacts/windows-one-command-setup-20261108/checkpoint64-npm-package-final.log

The native release goal was reread and remains active. Its body was not replaced
or silently shortened to this UI milestone. All checkpoint64 workers and required
test processes completed; no resident monitor was added.

### Popup Routing Fixed And Connection Restored (Checkpoint63)

Checkpoint63 closeout: final combined closure is now closure-r3, not the earlier
candidate/r2. npm archive was actually packed, extracted, installed offline only
inside a disposable test directory, and its six assets validated against the
original builder receipt;74/74 package tests passed. The new windows CLI route
was discovered and rejected redirected/noninteractive input without launching a
real installation. Its installerExited receipt is not an installed/connected/chat
grant receipt. Separate offline helpers22/22, UI/Pause/layout188/188, setup Python
38/38, release-pin13/13, workflow19/19 and packaging32/32 passed. The full product
suite passed before the last narrow UI-text/layout changes; those changes passed
the188-case suite afterward. Do not sum nested suites into a unique test count.

Two independent-review defects were fixed: the ordinary-account installer can
verify/extract adjacent setup ZIP without pre-extracted bin.mjs, and the admin
handoff passes original verified adjacent runtime/stager paths instead of losing
them and falling back to a download. Invalid declared-local closure fails closed.
Release CI carries the original builder receipt for public npm preparation. The
general native CI explicitly excludes only the unpublished public-tarball case;
release CI retains that exact case. CI itself was not run; ordinary-token Windows
runner compatibility remains an unresolved release gate, not a passing claim.

Default UI keeps diagnostics closed, progress visible and clearly historical;
Reconcile last Pause is now Advanced-only. Final devices.html/devices.js were
copied with backup/hash readback into the existing IAB candidate, no worker or
native restart. Actual reopened Setup again showed scope/unchecked consent/Copy,
with advanced sections closed and correct unreleased status. No new consent or
connection was issued in this final UI inspection.

Retained artifacts:
- .artifacts/windows-public-3.0.0-closure-r3/ (six installer assets)
- .artifacts/windows-public-3.0.0-extension-r3/ (paired GitHub/Store ZIPs)
- .artifacts/windows-public-3.0.0-npm-candidate/agent-continue-0.3.0.tgz
- .artifacts/windows-one-command-setup-20261108/checkpoint63-npm-package-r3.log
- .artifacts/windows-one-command-setup-20261108/checkpoint63-public-build-receipt-r3.json
- .artifacts/windows-one-command-setup-20261108/checkpoint63-product-regression.log
- .artifacts/windows-one-command-setup-20261108/checkpoint63-simple-ui-r2.log

No public npm/GitHub/Store publication occurred. Full fresh-install/adoption,
final-artifact browser-reopen/Revoke/Dot and release/submission remain open.

This checkpoint supersedes checkpoint60/60c's current STOPPED state. The dedicated
ec7 runtime is now READY after the single GUI Connect operation
c010c64c39884c57b2921846cbc810c5, generation3d004b69ac0c49ec88b2b5e0d766c459.
Broker92892/root95168 were independently read with matching start times. The
ordinary IAB acceptance chat6aeff83f-f4d8-83e9-afa5-9e2fdf4b754f then performed
a NEW actual read_file call and returned the original web60 nonce after once-only
platform approval. This proves recovery of ordinary-web reading, not all lifecycle
or Dot gates. No active sessions were reported by the dedicated runtime afterward.

Root cause: Chrome omits both frameId and tab on extension-popup MessageSender;
admin-control erroneously demanded frameId0. The shared exact-Devices sender
predicate now accepts that popup shape while rejecting foreign IDs/URLs, child
frames, incognito and tab-backed messages without frame metadata. Actual IAB
candidate was reloaded with ONLY admin-browser.js/admin-control.js changes and
backups. The scheduler stayed Paused with1 confirmed send/limit1. The standalone
Devices route and embedded-document denial have additional synthetic regressions.

Default product flow remains scope/consent/one command, with expert details closed.
Primary administrator progress was moved outside Advanced and later installed
as described in the closeout above. Full npm product regression exited0; separate
setup Python suite38/38, workflow18/18 and npm/CLI/snapshot88/88 checks passed at
their recorded snapshots. These are not long-term reliability or hosted Dot proof.

Public extension identity is now3.0.0 in SOURCE ONLY. A complete six-asset Windows
closure was built locally under .artifacts/windows-public-3.0.0-closure-candidate;
not installed or published. npm source now has a consented account-scoped windows
command and explicit verified-closure preparation, never a legacy custom-EXE
fallback. The adjacent ZIP integration and actual tarball checks subsequently
passed as recorded above. Do not advertise a runnable public npx yet.

No Git mutation/push/tag/Release/Store submission occurred. Installed IAB extension
remains2.2.1 Windows preview; it is not the source3.0.0 public product. Production
VPN/MCP/IDE/research and the external Chrome original scheduler remain unchanged.

### Ordinary Web Control And Usable Device Entry (Checkpoint60)

The ordinary IAB ChatGPT conversation from checkpoint59 now actually executed
administrator PowerShell, a temporary file write/read and stopping only its
own PID/start-time-checked child through the dedicated D940 plugin. Exact
operation9f1164c2-c707-4a20-ae02-f50673dc91c5 returned administrator=true,
fileRoundtrip=true, ownedChildStopped=true and the NEW ec7 runtime parent path.
Independent hosted read_file returned the same generated web60 nonce. This
supersedes the checkpoint59 ordinary-web READ-ONLY evidence boundary, not Dot
or lifecycle/publication gates. Actual browser approval was once, not Always.

Actual embedded-browser navigation blocked both the old Manage devices anchor
and new-tab console creation. Popup now has Set up Windows/Open device controls
and a fixed-destination same-document fallback. Four interface files plus the
320px-minimum devices stylesheet were copied/read back only in IAB's existing
development instance; reopening visibly loaded them. Device controls actually
opened in the popup and the collapsed173px layout became usable349px. No worker
reload, backend replacement, new permission or scheduler restart was used.
24/24 popup and40/40 Devices UI fixture checks passed; these are not OS tests.

Actual GUI Pause on ec7 produced NEW operation5ff4cb5636e947a7bc06518e198ccd91
and a sealed stopped receipt; original broker70620/root77324 exited. Current
dedicated acceptance runtime is STOPPED, not Ready. An early unknown UI message
was feedback lag; the suspicion that an old-installation record blocked this
Pause was disproved. Do not replay Pause. Old records/backups remain intact.

Independent release review identified public packaging/version, administrator
asset/npm closure and canonical disclosure gaps. Installer source integrity
bypass is fixed,147/147 PS5.1 and PS7 fixture checks; prior unsafe expectations
were corrected and13/13 release-pin Python methods passed. This source installer
fix is NOT deployed. No Git mutation, Release or Store submission. All exact
evidence/limits are in .artifacts/windows-one-command-setup-20261108/checkpoint60-live.
The native release goal remains active. Default UX remains consent/account scope
and one practical command, not an operation-ID console; explicit OS/platform
approval, Pause/Revoke and selected-account boundaries must not be weakened.

Checkpoint60c UI follow-through: the actual installed popup Settings now reaches
both Setup and browser-managed Devices through the fixed-destination fallback.
Actual Setup shows Current account/Administrator scope, a short access disclosure,
unchecked consent and Copy PowerShell command; advanced inputs stay collapsed.
Opening the page did not install or connect anything. The page still correctly
labels the source candidate as unreleased; no public npx install is claimed.

The exact latest Pause receipt was manually read once through the updated IAB
page and visibly reported the managed runtime was not running at verification.
This is historical stop evidence, not fresh readiness; no Pause replay or new
Connect. Original70620/77324 remained absent. Devices.js and the latest Setup.js
were copied/read back with backup checkpoint60c-loaded-ui/before.zip; no worker
reload or native runtime change. New bounded Pause followup is installed source,
but was not exercised by a NEW real OS Pause in this checkpoint.106 focused cases,
40 rendered Devices checks and55 rendered Setup checks pass. Final complete
`npm test` exited0, including popup24/24, isolated MV3 integration13/13 and
official ProseMirror MV3 scenarios5/5. Its full log is checkpoint60-product-final-r3.log.
Earlier failed runs remain; obsolete navigation/completion assumptions were fixed,
not hidden. Candidate241-member preview AF76B941F1D59450C56ABF8DE21CEE32C987C561662D9A224C1F9CCABC92E54B
is local only, not public scheduler v2.2.1 or a Store upload.

### Combined Setup And Ordinary Web Proof (Checkpoint59)

The exact IAB development extension hjnopijiekcbgiljjfiekeiepkebhido was updated
in its existing observer-reattachment loaded directory and visibly reloaded.
Its source-only backup and241-member preview are under checkpoint59-extension
and checkpoint59b-extension. Preview SHA256:
274b3429fa9cc39fc44e0dde989137418c28804db138251b6170f7cfdf4f794d.
Normalized devices.js/setup.js/setup-client.js match source. No external Chrome
task, production VPN/MCP/IDE/research connection was changed.

The prior dedicated70a97761 acceptance connection had no active terminal sessions.
Its own GUI Pause produced exact stopped receipt b83eaeb0a3464cbb8862565b82a1cb57;
the verified old broker/root processes exited. Pinned RevokeHostedOwner and
UnenrollBrowserOwner then completed with exit0 and protected readback. Old
revocations and backups remain. Do not reuse old Ready or replay retirement.

Fresh-machine P1 fixed: a missing parent directory raises DirectoryNotFoundException,
not FileNotFoundException. Test-AdministratorOwnerAbsent now accepts both absent
cases while all access/security/other IO errors remain denied. Extracted-function
scratch/stub regression was red2fail, then12/12 pass; no real registry test there.

GUI Pause now invalidates stale administrator Ready and performs at most one
read-only receipt lookup for the latest stored exact operation ID. It never
replays Pause or infers connection state from historical evidence.57/57 module
and40/40 rendered checks passed after updating obsolete stale-Ready assertions.

Actual consent-first administrator Copy succeeded in IAB, with setup ID
b38514a8c6c3b93eba4af02a90a1ce0e. The copied PromptForConnection command was run
in a real PTY using checkpoint59-installation-candidate/unpacked-setup. Only the
existing dedicated acceptance tunnel ID and authorized runtime-key FILE PATH
were entered; no key contents were read into the model or browser.

Original installation operation:3a7b8d823bcf4bceb953056dbe862128.
The real PTY installer exited0. Its protected exact-ID receipt is ok:true,
phase:complete,24328files, protectedFilesVerified/administratorStateVerified/
administratorChildVerified/hostedBindingPrepared/browserEnrollmentCommitted/
hostedOwnerAuthorized/readyToConnect all true. It did not start the tunnel.
The unchanged initiating IAB page then automatically requested one Connect:
operation a834a3005f1446bdb9915b7505fd80be, handoff69abcb319a6c4b5d8450045bcee55721.
The sealed control handoff is validated and progress reports verifying-full
against24328files. No manual Devices Connect was used. This is genuine combined
installation-and-admission evidence, not Ready or a new hosted tool result.
Never repeat Apply or Connect after uncertainty; read the original operation.
The new protected owner subsequently reported ready, generation
94a3b049f41f4b38befdf9dfcb5e6e83, broker70620/root77324 with current matching
start times. The actual dedicated hosted MCP command acb58a17-cfb7-456a-903f-
6701368950ce verified Administrator membership, one temporary file write/read
and stopping only its own PID/start-time-checked child. Its parent executable
was the NEW ec7eb4e2 runtime/node.exe, not old70a. The process exited; a final
list_sessions returned no active sessions. The acceptance runtime remains Ready
and connected, not paused or revoked. This is not an independent research task.

A NEW ordinary ChatGPT IAB conversation selected the existing dedicated D940
acceptance plugin, showed its Read File approval, and after the one-read approval
displayed the actual app preview/tool output. The request did not include the
expected contents. Returned nonce checkpoint59-8a3a544ee2a74fc2af51608586a547a7
matched the locally generated temporary file. This proves this candidate's
ordinary-web read roundtrip; administrator command/process proof above was
through this Codex chat's hosted MCP, not that new ordinary-web conversation.
No new Dot request or new-runtime reopen/Pause/Revoke test occurred here.

Real setup timings expose a remaining UX/performance cost: protected installation
started04:05:08Z and completed04:11:13Z; automatic Connect was admitted04:11:36Z,
with full24328-file verification before owner startup. Do not market it as instant.
No verification, certificate check or endpoint protection was weakened.

Post-trial display-only source patch fixes Target device installation remaining
Not checked yet after exact proof: connecting/requested now say installation
verified, readiness unconfirmed, with separate chat authorization. Red reproduced;
55/55 rendered checks passed, preserving the prior47. It adds no IPC or authority.
This LAST display patch is NOT installed: IAB still has274b3429 preview. The new
241-member checkpoint59c-extension preview is209ca68b0e9e159b474cff9c1c6e035dd9d4954082c1e10a6f8ba76741eede25.
Do not reload an active connection blindly. Final lifecycle/browser acceptance,
fresh versioning and publication gates remain open; public schedulerv2.2.1 is
not this Windows preview. Existing-install adoption and current-account flow
must not be inferred from the fresh administrator path.

Fresh full npm test exited0 after the Pause UX/test correction: control230,
browser66, setup92 module cases;47 Setup/40 Devices rendered checks,13 MV3
integration,5 official ProseMirror MV3 cases. Log: checkpoint59-full-product.log.
These isolated tests do not replace the above actual IAB/Windows evidence.

Exact pins: setup ZIP02fede0b4a8feab4b88defd64f638d0c10c355cd2132d056e71fd1a21772a2fc;
runtimeec7eb4e2cd19f3ebcc17639471d8af6d1130f97e9a43edf2c170f00fa2d4c343;
stager59b3524d9119199ee86b2f90fc291d7d22a0f7ea45acbc293a6b109e21591250.
The older862a7c87 stager is superseded for this candidate. No Git mutation,
Release or Store submission; native release goal remains active.

### Consent-First Setup And Automatic Continuation (Checkpoint58)

The owner again rejected the diagnostic-console experience. The Windows Setup
default now exposes an account-scope selector, concise capability/risk disclosure,
consent and one primary PowerShell-copy action. The result and existing-device
link stay visible. Keys, manual connection preparation, alternative platforms,
CMD and diagnostic details are collapsed, not deleted. English remains default;
Chinese is supported. Both scopes fit the tested320x600 first viewport without
overlap. This is one practical command, NOT a literal one-UAC promise: Windows
may approve installation and connection separately. Reuse checked runas now;
the proposed fixed-control broker is a future option, not a release prerequisite.

The same-document coordinator is now imported by the real background worker and
Setup page. setup-client.js binds a fresh trusted Copy gesture and administrator
consent to one random setup ID; after exact installed receipt, current permission,
installation-wide stop support and acknowledged browser observer, it requests
one connection. The setup association, journal reservation and installation
marker are committed/read back atomically before native dispatch. Old workers
without the explicit automaticConnect capability receive manual fallback, not
an invented automatic success. No persistent ticket resumes this page's intent.

Pause/Revoke invalidate preparation before awaits. A known setup installation
uses the new authenticated installation-wide Pause without sampling a changing
target. Active original-ID associations are bounded and settled records archived;
unknown A, switch to B, return to A reselects A's original ID without dispatching
A2. A full index denies new automatic continuation. Only legacy installations
may use the legacy targeted protocol. Missing stop/observer support denies.

An initial absent native host no longer permanently seals the observer: only an
admitted setup can attach an observer-only wake:false port and await its exact
acknowledgment. Permission/revision/port/admission are checked again after the
last await, so a disconnected observer cannot admit Connect. Human browser
approval waits within the original15-minute setup deadline, not the5-second IPC
budget. Connect response wait is separately bounded at120seconds and by that
same deadline; timeout never kills, cancels or replays a submitted operation.
Requested remains distinct from Ready. Page close/withdrawal cancels pending
steps; already-submitted work may still need its original receipt readback.

Verification: full npm product run exited0 (Setup47, Devices40, MV3integration13,
ProseMirror5; control230, browser66 and setup90 module cases in that run).
The final browser-approval-wait regression was genuinely red, then24/24 client
cases passed after the fix. The fresh complete Setup rerun exited0:92 module
cases,47 rendered checks and1 isolated extension-loopback case, recorded in
setup-checkpoint58-final.log. Package13/13 passed. Source review's two latest
findings (A/B/A replay and observer disconnect during permission await) were
reproduced red and fixed;71 scoped cases passed. Review is not OS certification.

Local extension preview:
.artifacts/windows-one-command-setup-20261108/checkpoint58-extension/
agent-continue-2.2.1-windows-device-preview.zip.
SHA256519719bac414da46ff326301a0dfa0d99c342ca3709b9e172d743c6853d36d6f.
241 members; AgentContinue/ directory, NOT Store-root layout. Required new modules
and page/worker bytes match normalized source. Privacy is the Windows candidate
notice. Native files were unchanged in this checkpoint: the separate checkpoint57
ec7eb4e2 runtime and0d922e53 setup assets remain local candidates, not a new
installed runtime. Do not mix these with the existing70a97761 acceptance install
or replace the already public scheduler-only v2.2.1 with this version label.

No install, UAC, registry, grant, runtime, production VPN/MCP/IDE/research or
external Chrome task was changed. No commit/push/Release/Store submission occurred;
the dirty main worktree was preserved. IAB inventory was read only. The newly
wired combined installer still requires exact fresh/existing-install, actual
browser reopen/Pause/Revoke and matching hosted ordinary ChatGPT/Dot acceptance.
Historical70a/D940 hosted successes do not certify this combined installer.
Then finalize version/assets/CI/privacy and verify GitHub and Store receipts.
The native release goal remains active; this checkpoint does not complete it.

### Historical Checkpoint57

### One-Command Admission And Reliable Pause Source (Checkpoint57)

2026-11-08 03:07 UTC. Owner requirement is still one informed setup decision
followed by automated configuration/connection, with mandatory OS/platform
authorization, not a diagnostic console. Native release goal remains active.
Canonical branch is main, HEAD592f8d6; no commit/push/Release/Store submission
occurred. Existing dirty files were preserved and never blanket-staged.

Native helper/parent/CMD now carry an optional strict32-hex BrowserSetupId through
fresh InstallBrowserOwner. Enrollment captures its original paused target and
publishes a sealed selected-SID-readable receipt under the SAME owner-control
gate. Read-only setup-status validates exact origin/SID/bundle/commit and repeated
paused public projections before returning installed. Those public observations
are advisory: high startup must still recheck private denial and original target.
Tests:589 scratch receipt checks,26 installer-input checks,5 native transport cases.

Admin controls now have internal captureStartupPermit and connectFromSetup.
The permit captures startup AND permission-transport epochs. Setup association
windowsAdministratorSetupAdmissionV1:<setupId> and the original control journal
reservation share one local.set and exact readback before native dispatch.
Duplicate/restarted/archived associations retain the original operation; uncertain
writes return its attempted ID without claiming durability or submission.
The source-only setup-controller binds to the initiating Setup tab/document,
cancels on navigation/close/permission/intent changes, and never implicitly
resumes after worker replacement. Its stop-support gate defaults false.
No runtime page or background worker imports this coordinator yet. Joint modules
and fixtures17/17 passed; combined admission/control tests124/124 passed.
Independent bounded source/mock review found no actionable issue, not a native
or browser certification. Experimental cross-page ticket helpers remain unused;
the selected architecture is SAME-document continuation, not a URL/session ticket.

Independent review reproduced a real native race: targeted Pause samples A:idle,
Connect commits C, delayed Pause reports superseded without saving paused intent.
New separate pause-installation support/request/status actions authenticate the
fixed installation/origin and recheck binding under the owner-control gate, then
use durably receipted untargeted Pause. Legacy targeted semantics remain intact.
The mutator has a response-wait deadline, NOT execFile kill/abort/retry. Requested
is only a launch acknowledgement; pause-recorded and stopped remain distinct.
Actual AST-extracted fixture now covers A->C->Pause->paused/task-denied, active
settlement, duplicates, revocation and foreign identities. Native Pause9 tests,
including133 PowerShell fixture checks, passed. Updated exact closed-action list
after its genuine red failure; ledger16/16 and control suite213/213 passed.

Full npm product run exited0 (Setup44, Devices40, MV3integration13,
ProseMirror5), and new targeted suites were rerun after native source freeze.
Package13, release-builder21, installer-pin13, workflow-contract17 and native
release46 passed. Two old native-release assertions were aligned with existing
strict source behavior; binary/unsafe-archive/pin refusal checks were retained.

Latest LOCAL candidate:
.artifacts/windows-one-command-setup-20261108/installation-pause-local-candidate/.
Setup ZIP0d922e53ba8220cd322cbdf4e801f14abd61f9ccd8a41bc95dee8d50ed3a86ce.
Runtime ZIPec7eb4e2cd19f3ebcc17639471d8af6d1130f97e9a43edf2c170f00fa2d4c343.
Source stager862a7c87; native host2bd64cb6. Complete runtime24328files/107067314bytes;
50-member setup ZIP has separate pinned runtime/helper/stager sidecars. Data-only
Plan and extracted actual-core smoke passed:28tools,67RPCreplies, no protocol
errors/network/browser attempts, standard token, owned file/process roundtrip.
This is NOT admin-install/UAC/hosted/browser-lifecycle acceptance. Intermediate
cc601fa4 and checkpoint56 artifacts do not validate the new Pause source.
Candidate2.2.1 label MUST NOT overwrite published scheduler-only v2.2.1.

Windows candidate privacy and English Store-listing DRAFTS now distinguish
ordinary/admin permissions, credentials, OpenAI data flow, local journals and
revocation/uninstall limits. Stable public PRIVACY/listing were not overwritten.
Candidate release workflow transports/verifies the Windows sidecars, but hosted
windows-latest ordinary-token compatibility is unproven; its preflight must fail
closed on an elevated runner. No hosted CI run or release proof is claimed.

Remaining concrete gaps: current Connect/Pause launch plans independently use
runas, so install's one UAC is NOT the whole flow's count. See the fixed-control
delegation plan: installation must explicitly authorize only sealed fixed
controls, with authenticated IPC and no arbitrary task-argument execution, extra
resident watchdog or UAC bypass. Then wire reliable Pause and same-document
consent/copy/poll/Connect, remove obsolete experimental handoff helpers, accept
fresh/existing installation and actual reopen/Revoke, update version/artifacts,
publish GitHub and verify Store submission. No new optional feature branch.

No live UI/native registration/runtime was updated here. Read-only70a97761
public projection still said Ready/generatione1e569ef/broker68384/root72324;
that projection is not a new live-tool health proof. VPN/MCP/IDE/research,
Process Lasso and external Chrome original task were untouched. Do not replay
settled operation IDs or mix new source pins into that existing installation.

### One-Command Administrator Setup And Scope UI (Checkpoint56)

2026-11-08 UTC. This advances, but does not complete, the active Windows release
goal. The owner requirement remains consent followed by automated configuration
and connection, not simply fewer visible diagnostic controls.

The Windows Setup page now has one account-scope selection (Current account or
Administrator), one scope-specific consent and one primary PowerShell-copy
action. Scope changes clear consent, copied feedback and stale detection. Late
clipboard callbacks and saved-consent reads cannot overwrite a newer choice.
The saved-consent race was reproduced in a rendered browser test before its fix.
English/Chinese, desktop/320px and delayed-state tests: Setup44/44 passed.

`install.ps1 -Administrator` and `install.cmd guided-administrator` now delegate
to a checked, in-memory helper snapshot. The helper verifies immutable release
pins, prepares the reviewed bundle and requests one Windows elevation. New stager
action InstallBrowserOwner coordinates fresh staging, full closure/ACL checks,
actual administrator-child probing, binding, owner authorization and bridge
registration. It leaves the connection paused/ready-to-connect; it does NOT
start the tunnel or authorize a chat. Existing-install upgrade/adoption and the
browser-owned connection handoff still need live acceptance. No new Apply/UAC,
registration or connection operation was performed at this checkpoint.

Review corrections: public helper hash is embedded in the verified parent;
neither the parent nor worker reopens an unchecked helper for execution. The
administrator helper uses no mutable SHA256SUMS fallback for release pins.
Apply rejects supplied operation IDs; exact Observe is read-only and historical,
not current readiness. Private/public receipt failures retain unknown outcomes
and exact readback IDs. Recovery prints a quoted absolute helper path and both
digests before UAC. The complete bundle closure is checked before staging.

The optional setup builder emits the administrator bundle separately, with
checked helper/stager sidecars and a parent->helper->bundle/stager pin chain.
The source setup ZIP has50 members and no EXE/MSI or embedded ZIP. Official
Node/tunnel executables and the pinned upstream search executable remain only
in the separate runtime bundle; no custom installer executable was added.
The local candidate still derives version2.2.1 from current manifest and MUST
NOT replace the already published scheduler-only v2.2.1 release.

Final local candidate:
`.artifacts/windows-one-command-setup-20261108/local-candidate-2.2.1-2ac7a5336a0c43f4b12ccb0b4d7edcce/`.
Source setup ZIP SHA256:
99d88d8432419a71ee1fcff33d407ea61b9b34a1b085dcfbbbae571794535348.
Full artifact pins and bounded verification are in the parent artifact README.

Verification: final `npm test` exit0; Setup44/44, MV3 integration13/13,
ProseMirror5/5. Windows guided installer, administrator bundle/enrollment and
acceptance/elevation suites passed. Setup release21/21, installer-pin13/13,
preview-kit5/5, install-plan18/18 passed. These include disposable Windows
ACL/token fixtures, not a new live installation of the combined action.

Only setup.html/setup.js/setup.css were backed up and copied into existing IAB
preview hjnopijiekcbgiljjfiekeiepkebhido. Actual native UI showed both account
choices, scope-specific UAC disclosure, unchecked consent and disabled Copy.
Only the page was opened; no extension-wide reload, new grant or Connect.
Installed setup.js SHA256:
ed262eb566594d2874c34668b9bc19a141ead7f64640d3bcad168294e2b920c8.
Protected runtime70a97761 read-only status remained Ready, generatione1e569ef,
broker68384/root72324. Installed stager4d520da1 is NOT new source stager6f5d273c.
Production VPN/MCP/IDE/research and the external Chrome original task were not
changed. No commit/push, new GitHub Release or Store submission this checkpoint.

Remaining: live combined fresh installation and existing-install behavior,
automatic browser handoff/connection, saved-running full browser reopen and
Revoke, matching public version/build workflow, privacy/Store permission path,
then real GitHub Release and verified Store submission. Do not report source
tests or read-only Plan as a delivered one-click installation.

### Simplified UI Installed And Full Regression Green (Checkpoint55)

2026-11-08 UTC. The exact final working tree passed `npm test` with exit0.
Rendered Devices40/40, Setup37/37, MV3 integration13/13 and official ProseMirror
5/5 passed, along with all preceding scheduler, adapter, document-import and
localization suites. The new bounded UI regression subset is111/111. Package
documentation allowlist tests13/13 passed independently. The stale install-plan
source assertion was aligned with the existing stricter release-tag guard;
install-plan18/18 passed, without changing installer logic.

Windows-first Setup now puts risk, consent and the recommended command first.
Advanced JSON/manual/platform material is collapsed. Guided Connect requests an
absent browser permission only from the consented click, then automatically
checks support before the existing explicit administrator confirmation. A late
Revoke/Pause, consent withdrawal or expired permission refresh cannot revive the
flow. Refresh has a5s deadline and remains Unknown until an explicit fresh read;
standard and prepared actions also inherit that unverified-permission gate.

Only six UI files were copied into the existing IAB preview; backup retained.
Installed/source devices.js SHA256:
721c05253fff61a2c914e906d510efc08ca6c6ac1f83fb3c15de904e94e0932b.
Actual IAB Setup first viewport and Devices layout were visually checked. A live
read-only administrator status returned Ready and released its button. Protected
generation e1e569ef and broker68384/root72324 remained unchanged. No native
replacement, new grant, startup request or production change occurred.

Preview ZIP is under `.artifacts/windows-simple-setup-20261108/`, SHA256
9b836f06597e46d64cb3406ff1a45425eee1a3db9a02d98287aa1663ae2fd069.
All six page members match normalized source; installed files match exact source
bytes. This is NOT a new public version, GitHub Release or Store submission.
The native release goal remains active; public installer closure, lifecycle/
revocation and matching public privacy/package/release gates remain open.

### Active Release Goal And Simplified Windows Flow (Checkpoint54)

The owner explicitly requested and authorized a new activated release goal.
It is active; checkpoint53's null-goal statement is historical, not current.
Latest UX requirement: informed consent followed by one recommended setup path
and automatic prerequisites, not a diagnostic console. The concrete plan and
remaining gates are in `docs/plans/2026-11-08-one-action-windows-setup.md`.

New source work groups receipt IDs, digests, support tables and manual recovery
under closed Advanced diagnostics. Guided Connect performs the read-only support
checks before showing the existing informed-consent dialog. It never writes
before confirmation, replays unresolved IDs or overrides a later Pause. Exact
latest stored Pause receipt feedback now supersedes stale request wording.
Scoped source regressions:101/101 passed. The old browser-fixture clicks must
open Advanced first; initial full device run found that expected test mismatch.
Do not deploy until the updated browser regression passes.

Dot live acceptance on the same70a97761 protected runtime completed. The original
start_process session15884 was independently read through MCP: exit0, runtime1.07s,
administrator=true, AC_DOT_ADMIN_20261108_E57C, fileReadMatches=true and owned
child61324 exited. Separate read_file returned that marker from the new protected
temporary file. No command replay or production changes. This is actual bounded
Dot capability evidence, not full lifecycle/release acceptance.

Public release is still blocked: the stable packager rejects native permissions,
the public setup payload does not include the administrator closure, and public
privacy/Store disclosures do not describe this feature. Source/UI progress must
not be relabeled as a released one-click installer. No new Release or Store
submission has occurred at this checkpoint.

### Manual Recovery And Hosted Re-read Passed (Checkpoint53)

Supersedes52's pending restoration. Explicit Connect22d6bb2b39c14da59c0afa6f85001f39
completed full verification, intent-saved/launch-requested, then new protected Ready:
generatione1e569efc6bb46ed95c3adce813995cb, broker68384/root72324. No old operation
was replayed. At the same ordinary chat6aefc1c9-3f9c-83e9-8d30-58f10f115e7d,
one new scoped Read File approval returned the original fixed probe in an actual
File Preview iframe after recovery. This closes the bounded manual Pause ->
explicit Connect -> hosted read cycle. Current test runtime is connected/Ready.

The live check did not exercise automatic resume-saved (paused intent is correctly
ineligible), complete browser/OS exit-reopen recovery or Revoke. No Dot call this
turn. Those gates, clearer stale pause feedback, full current product/package
regression and public GitHub/Store release remain open. Test scheduler stays
paused at its one-send limit; external Chrome original task unchanged. No
production VPN/MCP/IDE/research or Process Lasso changes, and no new services or
monitoring tasks. Source/main working tree updated; not committed/pushed/released
in this turn. Native goal remains null, not silently recreated.

### Bounded Status Query And Actual Pause (Checkpoint52)

The old status query eventually reported Ready; it was a long unbounded stall,
not proof of permanently broken messaging. The handler now covers both permission
reads and the single status query with one5s deadline, clears busy, discards late
results and respects permission/route revisions. No mutation retry is added.
TDD:10 of19 new cases failed before the fix;19/19 then passed. Scoped106/106;
independent review59/59 plus9 extra race probes, no concrete findings. npm check,
test:safety35+57+38/source guards and test:devices66+36+106+61 passed. These source
fixtures do not replace live lifecycle proof.

Only installed IAB preview devices.js was backed up and replaced, then the normal
Devices page Reload was used. New installed/sourceSHA:
5e514418737b7cbee529c259ec9d355d41136a75c359e2c0106a1a91a020cf0a.
Live status query completed and re-enabled its button with readiness-not-observed
while actually paused; no new native permission or task changes.

Actual GUI Pause07b400acd5064b69ac671893e8f15d65 completed at00:35:13Z:
protected pause-recorded/stopped receipts; old broker41336/root40896 absent.
Normal Check pause receipt displayed stopped-at-verification wording. A subsequent
read-only D940 file call timed out/UNAVAILABLE; not a new unrelated network-fault
diagnosis. Page reload did not resume it. Reconcile last Pause was opened then
cancelled; no fence was submitted. Historical requested wording is still misleading
beside a separately read stopped receipt and needs clearer UX.

Manual recovery intentionally uses explicit Connect (can clear local pause).
Resume-saved is ineligible for paused intent and must not silently clear it.
One new Connect22d6bb2b39c14da59c0afa6f85001f39 targeted
07b400acd5064b69ac671893e8f15d65:idle at00:39:16Z. It is reserved and full-file
verification is advancing; restoration is NOT yet verified in this checkpoint.
Do not replay it. Remaining public/lifecycle gates from51 remain open.

### Actual IAB Administrator Control And Ordinary Chat (Checkpoint51)

At 2026-11-08 00:34Z the new browser-managed Connect8c1fbb7af6bc44c18524c4522e1f1e96
has progressed beyond50: durable intent-saved/launch-requested and protected
owner-status state=ready, generation7441760da6744382ab5948e34b17e777,
broker41336/root40896. This was one new Connect, not replay of retired IDs.
Current IAB origin remains hjnopijiekcbgiljjfiekeiepkebhido; runtime70a97761,
installed stager4d520da1. The Devices status query still hangs; backend Ready
does not establish that its frontend status control works.

Fresh ordinary ChatGPT chat:
https://chatgpt.com/c/6aefc1c9-3f9c-83e9-8d30-58f10f115e7d
Selected only existing AgentContinue Windows D940 Chat. Actual Read File iframe
returned AGENTCONTINUE_WINDOWS_READ_PROBE_20261107, matching the local probe.
After scoped Allow once, one start_process executed the disposable PowerShell
test. Original process44620 output was independently retrieved via the same
MCP read_process_output: exit0, runtime0.98s, administrator=true,
fileReadMatches=true, markerAC_IAB_ADMIN_20261108_B6AF, ownedPid55148,
ownedProcessExited=true. Separate MCP read_file returned that exact marker from
the protected runtime temp test file. The successful bounded operation is real;
not merely the assistant's PASS wording. No repeat of the write/process test.

Open: fix/check actual Devices status query; current-IAB Pause/saved reconnect/
browser reopen/Revoke lifecycle, public packaging/release/Store gates. No Dot
test this checkpoint, no production VPN/MCP/IDE/research or external scheduler
change, and no public release. Owner-cleared native goal remains null.

### Actual System-Directory Launch-Plan Bug And Hotfix (Checkpoint50)

After49, actual support returned Connect eligible/paused. One new70a Connect
72e005ec2ed1439d853a220c10865ba9 targeted5078754e637a4eb2a398ded1e88c929d:idle,
returned unconfirmed and had no public native progress. Do not replay it.
Read-only pinned-function inspection passed binding and actual medium caller,
then failed New-AdministratorControlEndpointLaunchPlan with owner_control_launch_plan.
Its case-sensitive System-directory regex rejected the actual OS directory's
casing although the existing anchor and native adapter accept that Windows path.
This is an independently reproduced sufficient startup blocker, not a claim
that all possible later failures are explained. No diagnostic child was started.

TDD regression:76cases646checks RED only for actual OS/casing; one-line -cnotmatch
to -notmatch fix then76cases660checks GREEN. Four valid paths including actual OS
accepted; six malformed/other paths refused. Separate audit3cases56checks and
Node87/87 tests passed. Independent one-line comparison found no other stager
change against65676c71. New stager pin:
4d520da17c02ae10ec9d473808f0baaa3286eaa94122a3f2cc45ec7d45bc8866.

At2026-11-08T00:17:04Z exact-test hotfix completed exit0. It held the enrollment
reservation, exact72 execution and owner guards; checked pause/no leases/task idle;
officially fenced72; backed up the two public files; set pending to close admission;
atomically replaced sealed stager.ps1 and pause-launch.json; verified bytes/ACL/hash;
removed only its own verified pending marker. Registry/tasks/auth/runtime ZIP and
credentials were unchanged. Report pendingMarkerRetained=false, registryChanged=false,
tasksChanged=false, tunnelStarted=false, keyContentRead=false:
C:/Program Files/AgentContinueAdmin/iab-stager-system-case-20261108.readback/.
The earlier proposed Unenroll/Enroll helper was rejected by review and NEVER ran;
it had incompatible deny preconditions. Only the replacement two-file helper ran.
Helper9cc25cca was reviewed; Start is settled/no-replay. Actual normal Devices
receipt read ingested72 as fenced. Post-update read-only binding/caller/launch-plan
inspection now completes successfully with zero child/tunnel start.

Current runtime remains70a97761 with same tunnel/origin; installed stager is now4d52,
not6567. Current source preview devices.js remains480ebcbb. Positive browser-managed
high pair, hosted file/command/process and lifecycle acceptance remain open here.

### Retired Operation Settled Through Actual Browser Readback (Checkpoint49)

At 2026-11-08T00:00:31Z, targeted maintenance fenced retired799 Connect
4ba7255bfd974a948963f5072aace44b using the pinned official primitive under its
exclusive execution handle and both owner-control guards. Retired denial,
pause, absent leases/task activity, empty original history and exact native
registration were checked before mutation. No Connect was replayed.
The normal Devices Read this operation receipt action then displayed the original
ID as fenced, retaining the original target and unconfirmed submission outcome.
The global unresolved-startup warning disappeared; no Chrome storage editing.
At 00:03:31Z the bounded temporary manifest window ended: result ok=true,
currentRegistrationRestored=true, tunnelStarted=false, keyContentRead=false.
Authoritative report: C:/Program Files/AgentContinueAdmin/
iab-retired-control-20261107-4ba7255.readback/result.json.

The maintenance helper is test-identity-specific, not a public upgrade feature:
.artifacts/windows-iab-package-candidate-20261107/Settle-Retired-Iab-Control.ps1,
reviewed hash b270f419ca1f18fbf70ed046a52483d7af96357b959cc55ced449d4312f86389.
Start is settled; never replay. Exact-ID Reconcile only completes an already
validated fence, never a startup. Arbitrary concurrent administrator registry
writers and process-kill/OS-crash restoration remain explicit limitations.
Independent review found no remaining concrete blocker under the targeted
no-concurrent-installer maintenance constraint. Scratch official store266 checks
and observation417 cases/7093 assertions passed; these are not full live proof.

Devices was reopened by Computer Use through normal extension navigation.
The permission-support check now has a deadline around permission queries as well
as messaging. Focused40/40 and related153/153 tests passed. Installed test
devices.js SHA480ebcbb96f4687a00a0c76f2bc42756642f16d234d3e9a247f89f7a912b882c
replaces the older2ec4f96d preview member; that ZIP no longer describes all
installed bytes. Only this IAB candidate was actually reloaded in its extension
manager. The temporary test still has one confirmed send and remains paused.
No external Chrome scheduler or production VPN/MCP/IDE/research changes.

New70a support/Connect/high peer/hosted/lifecycle acceptance still pending at
this checkpoint. Do not turn fenced into historical execution proof. Native goal
remains null; the owner-cleared goal was not recreated. No public release claim.

### Installed And Enrolled IAB Candidate; Retired Operation Gate (Checkpoint48)

Supersedes47's not-installed/enrolled wording and old native-goal status. The
owner cleared the native goal; fresh get_goal returns null. Do not silently
recreate it. The Windows-first product objective and production boundaries remain.

Actual system-PS5.1 local acceptance for runtime70a97761 completed exit0 with
administrator-child-verified. Installed root:
C:/Program Files/AgentContinueAdmin/70a97761c02a2f2bbc20f408.
Protected owner/ACL, peer f11ea607 and bundled Node hash matched. BindHosted
operation9e94bd6184d943f1bb446759b56b65a2 completed once. Protected readback at
22:18:42Z verified its exact digest, profile, real elevated command child, pause
and no activation. Neither helper Start may be replayed.

Test-only cutover completed exit0 at22:24:20Z: old799 Revoke/Unenroll, then new70a
Authorize/Enroll; all four per-step results passed. Exact recipient remains
hjnopijiekcbgiljjfiekeiepkebhido, dedicated tunnel6aeec565ffe08191935f53e3bc60d05d.
New paused, no tunnel start. Receipt directory:
C:/Program Files/AgentContinueAdmin/iab-package-cutover-20261107-2215.readback/.
Independent reviewer closed the original pre-reservation race after the helper
held the old unknown operation's exclusive execution handle through the entire
transaction. Scratch handle tests pass with ACL stubs; those are not live ACL or
hosted-control acceptance. The helper's unbounded child wait is fail-closed but
remains a liveness limitation. Cutover Start is settled; never repeat it.

The installed IAB preview's three differing page files were backed up under
.artifacts/windows-iab-package-candidate-20261107/preview-before-update-20261107-222323
and replaced from pinned2ec4f96d ZIP. All237 installed entries now match. No
manifest, Chrome storage, prompt, interval, task state or operation record change.
Actual extension manager showed Reloaded for only the IAB preview. Subsequent
process metadata shows new70a Node65764; old799 Node62144 is absent. This is host
replacement, NOT a ready tunnel or positive administrator peer/control proof.
The original Devices page closed during reload; a factual reopen request is
pending. No forbidden extension-URL navigation or alternative bypass was used.

Important remaining gate: both devices.js and admin-control.js intentionally
block all startup while ANY recorded control is unresolved, including a retired
bundle. Original799 operation4ba7255bfd974a948963f5072aace44b is still retained and
unconfirmed. Before extension reload, support was eligible but Connect disabled;
no new Connect was submitted. A surviving old native observer was also observed,
but that alone does not prove it caused the support response or global gate.
Do not erase history, weaken the gate or blindly retry. Bounded read-only review
is checking supported terminalization and same-ID receipt ingestion for a
provably revoked retired installation. Product-level upgrade recovery is open.
Independent source review confirmed Observe requires active exact old manifest
registration; new70a cannot read old799's receipt through its own native adapter.
Feasibility and remaining implementation gates are in
docs/plans/2026-11-07-retired-control-receipt-recovery.md. No fence or temporary
registration restoration was executed, and no receipt is relabeled terminal.

Current scoped Node tests143/143 pass. Ordinary ChatGPT must next prove the new
browser-managed high pair, actual command/file/process calls and Pause/Revoke/
reopen recovery. Historical D940 and scheduler receipts do not close those gates.
No Dot, external original scheduler, production VPN/MCP/IDE/research or Process
Lasso change. No commit/push, Release, npm publication or Store submission here.

### Granted Permission; Packaged Codex Peer Fix Built (Checkpoint47)

Supersedes46's live-permission gap. User's full screenshot and fresh native AX
both show Browser permission Granted. The existing user-opened Devices page was
operated after returning to this chat/Settings; no new extension-scheme
navigation or URL-policy bypass occurred. Standard host Unknown is separate from
administrator support. Actual read-only administrator support returned supported,
connect eligible, saved intent paused. Exactly one reviewed Connect was confirmed:
operation4ba7255bfd974a948963f5072aace44b, digest79958886, target
04bc381d65924d2b85e4b93c2bc9a726:idle. Submission and same-ID receipt remain
unconfirmed/no verified progress. Never replay this operation or clear its record.

Protected metadata-only readback at21:45:16Z found paused intent, all three leases
absent, zero test-task instances, and no private records matching that operation.
Receipt: C:/Program Files/AgentContinueAdmin/control-4ba7255-20261107-1546.readback/.
The readback helper's Start is settled; Inspect rereads this timestamp, not now.
UAC policy is currently silent elevation (ConsentPromptBehaviorAdmin=0), observed
only. Absence of an onscreen prompt does NOT prove no high process started.

Concrete compatibility defect: both kernel peer admission paths required a final
chrome.exe ancestor, while the actual enrolled Node -> system cmd ancestry ends
in Codex ChatGPT.exe. Windows AppModel independently returned exact family
OpenAI.Codex_2p2nqsd0c76g0 and its registered package root. This proves an
unsupported legitimate ancestor, not the unique cause of every unconfirmed exit.
Read-only Verify -> real medium caller -> launch-plan construction passed with
the real binding and a deliberately inert Start, including the host's clean env.

New source uses the held process handle's OS package family/full name and the
registered package root/app/ChatGPT.exe in BOTH peer checks. No filename-only
ChatGPT allowlist. All existing token/session/argument/ancestry/liveness checks
and legacy Chrome branch retained. OS package identity is not independent
publisher-signature, file-integrity or benign-code attestation. Independent
design review found no blocker. Code review found a test-only Chrome false
positive; an independent held-image branch guard fixed it and scoped re-review
closed it. Package identity24 cases pass with actual IAB process identity;
negative own-PowerShell PID refuses. Peer191/10122, projection66/215, entry75/646,
native transport430 assertions and combined control/ledger/observation33/33 pass.
These are not a positive high-pair or hosted administrator-control proof.

Built/independently read back, NOT installed/enrolled/connected/published:
.artifacts/windows-iab-package-candidate-20261107/
runtime ZIP70a97761c02a2f2bbc20f408aec150afd495f10f66ace967e3859b7807a7cde6;
24328 streams read,287191479 uncompressed bytes,29 source files match.
stager65676c71 unchanged; preview2ec4f96d byte-identical to46. Actual installed
79958886 and preview589f8792 remain unchanged. Next: disposition of old unknown
operation through supported maintenance/no replay, fresh controlled upgrade,
ordinary ChatGPT hosted command/file/process and lifecycle/revoke acceptance.
No Dot, production VPN/MCP/IDE/research, original scheduler or Process Lasso change.
Original goal remains incomplete; API still reports historical blocked, objective
retained. No new goal, commit/push, Release, npm or Store submission this slice.

### Permission Readback Repair; Live Boundary Still Open (Checkpoint46)

The user reports completing the nativeMessaging prompt and supplied the exact
IAB Devices page with riskConsent checked. This supersedes the pending-user-reply
wording in45, but is not a fresh observed permission result: the supplied image
does not show Browser permission. CUA returns a cached Devices accessibility tree
while its screenshot shows another current chat. Do not click stale AX indexes or
interpret cached Not granted as a current denial. The task-tab inventory exposes
only the ordinary acceptance chat, not Devices. The earlier URL-policy refusal
still forbids automatic extension-scheme navigation or alternate-surface/CLI
activation to evade it. A single factual question asks for the top permission
label, not another authorization or reinstall.

Read-only HKLM64 and host.json inspection now verifies the administrator_owner
registration points to79958886.browser/wake.cmd and its only allowed origin is
hjnopijiekcbgiljjfiekeiepkebhido. Registration is not successful native launch or
hosted command acceptance. No Connect, key read, registry write or maintenance
replay was performed in this slice. Last protected paused/clear proof remains45.

Two actual source defects were reproduced RED before fixing: an old asynchronous
permission read and a late permission-request reply could overwrite a newer
permission observation. device-control.js now fences those replies by revision.
Fresh independent review found two further P2 gaps; both were reproduced RED,
fixed and re-reviewed closed: late device observations now bind to permission
value-transition epochs, preserving unresolved operation IDs for fresh status
reconciliation; same-grant manual permission rechecks preserve installation-wide
Revoke while clearing startup support. Permission-loss events still clear it.
Scoped review is not whole-product certification or a live bridge test.
devices.html/js adds an adjacent permission outcome/disabled-reason message,
distinct granted button label, and an explicit read-only permission recheck.
The recheck invalidates stale administrator support/review state and never sends
native messages, connects a tunnel, clears pause or replays an operation.
These defects are not established as the unique cause of the user's live issue.

Candidate only, not installed/reloaded/published:
`.artifacts/permission-diagnostics-reviewed-20261107/agent-continue-2.2.1-windows-device-preview.zip`
SHA256 `2ec4f96daf5e437d4432829eb67a3e8341499b4700bfd072c7a6b39047ca001c`.
Provisional5c5cca6e is superseded.237 members, three changed packaged sources
match canonical text, no EXE/MSI/DLL/key files. Final scoped controller/admin
tests103/103 pass. Final reviewed-source full npm test completed exit0, including
device UI36/36, scheduler UI22/22, MV3 integration13/13 and ProseMirror MV3 5/5.
Log: `%TEMP%/agentcontinue-permission-final-regression-20261107.log`.
Installed preview589f8792 and ended temporary scheduler task are unchanged.
Original goal objective remains retained; native API status is still blocked.

### Native Test Cutover Completed; UI Policy Handoff (Checkpoint45)

User's two exact approvals were executed. Checkpoint44's real installed receipt
and one-send-limit acceptance remains valid. The completed temporary scheduler
task is paused; no original external task or Dot was changed.

Test-only cutover actually completed at21:05:16.1799056Z, parent exit0. Fresh
high-side preflight at21:01:43 verified old paused/three leases clear/zero task
instances/activation digest-SID-profile consistency and new paused/authorization
fully absent. Supported old RevokeHostedOwner and UnenrollBrowserOwner both
returned exit0; revocation preserved. New799 AuthorizeHostedOwner verified24328
protected files, then EnrollBrowserOwner returned browserEnrollmentCommitted=true,
activated=false, tunnelStarted=false. Exact native host origin and HKLM64 manifest
readback match IAB hjnopijiekcbgiljjfiekeiepkebhido. New private intent/leases were
rechecked paused/clear after enrollment. No Bind, AcceptLocal or Connect replay.

Protected step receipts and final result:
`C:/Program Files/AgentContinueAdmin/iab-cutover-20261107-2059.readback/`.
Single-use helper ` .artifacts/windows-control-candidate-20261107/Switch-Iab-TestOwner-20261107.ps1`
must NOT rerun Start. Inspect rereads final timestamp only. Its initial independent
review found hash/parse TOCTOU; main changed primitive import to a held, hashed
snapshot and scoped re-review closed that finding before execution. This is not
a whole-product security certification. Exact frozen old/new stagers unchanged.

Actual next boundary: IAB Browser Use explicitly rejected automatic navigation
to chrome-extension: with a URL-security-policy refusal that forbids alternate
surfaces/workarounds. STOP automated extension navigation/grant/Connect; do not
use raw CDP, registry consent edits, desktop UI or CLI activation to evade this.
An asynchronous user handoff asks them to use the existing Devices page, select
Browser-managed Windows, riskConsent/Allow local bridge access/browser Allow.
No permission grant or administrator connection has been observed. Do not claim
browser-managed hosted command/file/process/lifecycle acceptance or publication.
Native goal remains existing blocked API status, full objective retained.

### Installed Receipt Repair Accepted (Checkpoint44)

User explicitly approved both exact preview update/reload and the test-only native
cutover/admin grant for IAB origin hjnopijiekcbgiljjfiekeiepkebhido. The pending
consent wording in43 is superseded. The237 preview members were checked against
ZIP589f8792bf363314f1b443106b2869bde508a796dc8992b099f5e04cd8297b99,
backed up under `.artifacts/iab-before-receipt-repair-20261107-144714`, copied into
the existing observer-reattachment path, and individually hash-verified. CUA
observed Reloaded; the same extension ID/settings and paused temporary task survived.

Actual ordinary Chat6aef44e1-9c80-83ea-b530-c6eed07b1f1e: explicitly resumed the
temporary159-character no-tools test, interval20minutes/maxSends1, then clicked
Send once now exactly once. It replaced a new disposable text draft, sent the
configured prompt and received the fixed marker. Modern DOM user/assistant counts
each increased exactly1 (3->4). Installed console now shows1 confirmed send,
"Confirmed 1 sends, reaching your configured limit", Paused and Timer not started.
This is real installed receipt/one-limit acceptance, not long-running reliability,
Dot or Windows command/file/process acceptance. Original external Chrome task untouched.

Fresh protected readback20:50:31.1293586Z verifies old D940 paused, all three leases
clear, revoked=false and taskInstances0; new799 binding/profile verified and paused.
No key bytes read or Bind replay. Reader is a new single-use report, not a refresh
of the old14:34 report. Test-only cutover helper Plan passed; its independent review
and actual cutover remain pending at this checkpoint write. NativeMessaging still
ungranted, no registration or runtime activation changes yet. Preserve the ended
temporary scheduler task; next work is the separately authorized native control.

### Reviewed Receipt Candidate (Checkpoint43)

Receipt reviewer found empty-ID and nested modern/legacy historical-clone false
positives in provisional6b3f976a. Main reproduced3 failures (19/22), then required
nonempty modern IDs and normalized descendants to their same-role modern unit.
Current22/22 ordinary adapter cases pass, including repeated identical ID tokens.
Reviewer also independently ran38/38 VM cases before these final corrections;
main reran38/38 after them. This is bounded review plus regression, not an
independent final-code certification or live-page repair verification.

Current frozen preview is now
`.artifacts/receipt-repair-reviewed-20261107/agent-continue-2.2.1-windows-device-preview.zip`,
SHA256589f8792bf363314f1b443106b2869bde508a796dc8992b099f5e04cd8297b99.
Two builds match exactly.237 unpacked members; packaged background57/57 and
normalized packed background/adapter source checks pass. Supersedes provisional
6b3f976a for any proposed update. Source57/57 includes the final Resume/Pause
discard-restoration ownership fix reproduced by fresh review. Complete npm test
on final source finished with exit0, including ordinary22/22, Dot48/48,
keyboard12/12, UI22/22, MV3 integration13/13 and ProseMirror MV3 5/5.
These are fixture/browser regressions, not a live hosted control acceptance.
Final log: %TEMP%/agentcontinue-final-regression-20261107.log. Frozen installed77bccd3b is
still unchanged, temporary task paused. Exact local-preview update/reload and
ordinary confirmation/limit re-test were requested at action time, no reply yet.
Native/admin cutover confirmation is a distinct pending request. No mutation of
native enrollment, existing binding, runtime, production or public publication.

### IAB Installed; Actual Send Exposed Receipt Mismatch (Checkpoint42)

User completed installation. Native CUA verified enabled2.2.1 Windows device
preview, ID hjnopijiekcbgiljjfiekeiepkebhido, exact frozen source
`.artifacts/observer-reattachment-20261107/unpacked/AgentContinue`. Its full console
and Devices page open. This supersedes checkpoint40's pending-install blocker.
Native AX can lag navigation and expose offscreen stale geometry; fresh screenshot
plus a subsequent AX observation resolved this without private APIs or browser reset.

Actual independent IAB task: selected ordinary acceptance Chat, used a fixed
159-character nonsensitive no-tools prompt,20-minute interval,maxSends1 and explicit
Extension priority. Placed a disposable text-only draft in that exact Chat.
One explicit Send once now replaced that text, submitted the configured prompt,
and ChatGPT returned AGENTCONTINUE_INSTALLED_SEND_OK_20261107. However the installed
preview reported unconfirmed/0 and stayed enabled. Main immediately clicked Pause
and read back Paused/Timer not started. Do NOT resume this temporary task or count
the send as an automatically confirmed/limited success. Original external Chrome
task was not modified; its earlier authorized Resume is still not executed.

Read-only actual DOM diagnosis: no article or data-message-author-role nodes;
modern user/assistant bodies instead have data-chatgpt-search-unit-key suffixes
:user/:assistant and data-chatgpt-search-message-ids. Source adapter now supports
these exact role-and-ID-qualified units and uses the first message-ID token for
history comparison. Synthetic real-DOM tests RED16/18 then GREEN18/18; include
reused historical-ID rejection. No real prompt/chat body copied into diagnostics.

Scheduler source fixes were RED/GREEN tested with alarm failures/readback,
already-running repair, in-flight authorization, completion interleavings,
startup recovery, partial local persistence, and resource cleanup.57/57 background
scenarios pass. Fresh reviewers found completion reactivation and lost cleanup
ownership; main reproduced and fixed both. If paused persistence fails, stale
running resumeJob is removed and checked absent; current-session task survives.
Total storage outage is not claimed recoverable. General claim/log finalization,
unknown queue reconciliation and after-reply token collision remain review work.

Frozen candidate `.artifacts/receipt-repair-20261107/agent-continue-2.2.1-windows-device-preview.zip`
SHA2566b3f976a64ea81619fc106dbbb4204fccf9a5d6007d63ad4d7759ef2fc082c90.
Packed background/adapter bytes equal normalized current source. Not installed,
not a final version bump, Release, Store package or publication. Complete npm test
was started after final code changes; record its final exit separately, not a
partial output. Dedicated receipt review is still pending at this note's write.

Windows control remains separate: actual IAB nativeMessaging Not granted;
device registration/connection not checked and pause Unknown. Read-only pinned
Inspect returned existing-artifact and other-or-conflicting-registration, no UAC,
registration change, child probe or tunnel start. Old D940 namespace still needs
guarded coordinated retirement before799 enrollment under actual IAB ID. No Bind,
AcceptLocal or uncertain operation was replayed. Exact-origin native/admin grant
and guarded acceptance cutover were requested at action time; no reply yet.

Native goal API still reports blocked from checkpoint40 and has no resume-status
setter; latest user instruction resumes work, but do not claim an API active
transition or create a replacement goal. Full objective retained, not complete.
No production VPN/MCP/IDE/research change, Git commit/push or public publication.

### Installation Consent Impasse (2026-11-07 15:54 UTC)

Checkpoint40: fresh native AX still shows the exact candidate path in the
unconfirmed Load-unpacked picker. No affirmative response to the existing
action-time confirmation arrived. This condition spans the user-triggered
installation turn and two subsequent goal continuations; previous continuation
was no progress, not a verified live-process wait. User's latest ordering is
install first, so no source development substitutes for that requested action.
Goal blocked after the repeated-blocker audit, full objective retained, not
complete or user-paused. Do not repeat the same question or treat automatic
goal messages as install consent. Keep all checkpoint39 non-delivery boundaries;
no final Select Folder, new permissions, task resume or production changes.

### IAB Recovered; Ordinary Chat Tested; Install Prepared (2026-11-07 15:48 UTC)

Checkpoint39 supersedes38's global browser-access blocker: the newly provided
unified cua_repl IAB API actually works. No Work-setting change was made. A new
ordinary Chat (not Dot) was created at
https://chatgpt.com/c/6aef44e1-9c80-83ea-b530-c6eed07b1f1e . It returned the fixed
readiness marker. An explicitly scoped read_file request through the existing
D940 custom App reached a one-time Read File approval card, accepted once for
the disposable probe.txt only. The page then reported McpServerError: Session
terminated, NOT a successful file read. No runtime reconnect, shell, file write
through MCP or task start followed. The local probe file was created separately
with apply_patch; never count its local existence as hosted readback.

Latest user priority is installing the extension inside IAB before further code
changes. Native app settings are accessible via unified CUA; external Chrome
URL-validation stop is a different limitation, not an IAB outage. A minimized
app was raised through its documented launch entry. Settings > Browser >
Extensions actually contains no AgentContinue. Developer mode was already on;
we did not toggle it. Load unpacked opens a native directory picker. Exact frozen
candidate77bccd3b has237/237 byte-identical unpacked members. Display version is
2.2.1 Windows device preview; external local2.2.2 is a different timer-repair
preview, not proof of newer complete Windows features.

The picker Folder field was set via documented native setValue to
.artifacts/observer-reattachment-20261107/unpacked/AgentContinue. Final Select
Folder was NOT pressed. An action-time confirmation is pending for loading local
code with chatgpt.com access; no nativeMessaging/admin grant or automatic task is
included. CUA element click first lacked geometry; coordinate/AX click over the
owned picker failed target-window guards; setValue succeeded. Do not bypass those
guards or claim an installation. Existing CUA codexSettings handle can be reused,
but reacquire fresh UI indices. Installation is the next user-directed action.

Original scheduler Resume is already explicitly authorized (same prompt/interval),
but not executed. Do not silently bind its task into the newly installed IAB
profile. Old D940 task freshly Ready/instances0; new candidate.browser absent.
Four fresh bounded source-review findings remain unimplemented/unreproduced:
partial storage/log failures can strand sending; Resume alarm failure can leave
enabled without a timer; unknown queue entries can repeat; reused response tokens
can defeat after-reply count growth. Details in the checkpoint39 plan. Reviewer
ran no tests/edits; closed. Main source unchanged in39. Goal active, not complete;
no production/VPN/IDE/research/registration/tunnel or publication change.

### Browser Bootstrap Correction And Explicit Settings Block (2026-11-07 14:48 UTC)

Checkpoint38 supersedes the unexplained missing-agent diagnosis in36/37, not
their deployment evidence. The trusted setupBrowserRuntime call returns the
documented Agent object; it did not inject an `agent` variable into this REPL.
Capturing that return and invoking its documented browsers.list() produced the
explicit platform error: `Local browser use is disabled in Work settings`.
No runtime source inspection, private API, external browser, settings bypass,
REPL reset or desktop fallback was used. Undefined globals alone were not proof
that the installed browser plugin could not work; that prior inference was wrong.

Actual local scheduler delivery and current GUI state remain unverified. The
old administrator registration's foreign extension origin is a separate device
deployment defect, not a proven scheduler-send cause. No registration cutover,
owner authorization, connection, original-task resume, credential access or
source deployment occurred in38. Settled Bind/AcceptLocal operations must not
be replayed. Next actual frontend acceptance requires the user to enable local
browser use in Codex Work settings; existing project consent is not that setting.
Goal is blocked on that capability after repeated browser-access failures, not
complete or user-paused. Full objective is retained. No public release changes.

### Actual New Binding And Local-Origin Mismatch (2026-11-07 14:37 UTC)

Checkpoint37 supersedes35/36's unbound new-candidate statement only. One fixed-ID
BindHosted for79958886 completed via native RunAs, parent81568 terminalexit0;
actual child1372/start14:25:19.1971265Z, no replay/kill. A separate high readback
then verified protected same-ID receipt, profile hash, selected SID/tunnel,
actual command-child flag and still-paused new intent. OldD940 actually observed
at14:34:40.4469512Z:pausedtrue/threeleasesclear/notrevoked/taskinstances0. Inspect
reuses the protected projection; it is not a new observation or admission.

Actual Chrome administrator registration still permits only old ibhd testID,
not local dcah ID; standard device_wake registration absent in all four views.
That is a native-device deployment mismatch, not proof of scheduler-send cause.
Old registration/task and loaded local extension preserved. New.secrets and
same-ID started/result files present; new.browser absent. No new authorization,
enrollment, owner start or network connection. Dedicated user-supplied key file
consumed by high stager only; no key printed/chat read. Readback did metadata
only on runtime.key. Bind helper's JSON-module dependency was fixed before Start.

IAB still has no usable control handle; no private/external-browser workaround.
Actual frontend/registration cutover and GUI/hosted lifecycle delivery remain
critical path. Do not replay Bind/AcceptLocal or delete artifacts. Full goal active,
main592f8d6 unchanged, no production or release changes. Exact receipts/pins:
docs/plans/2026-11-07-control-candidate-binding.md.

### Bounded Observer Recovery, Not Live Chrome Restoration (2026-11-07 UTC)

Checkpoint36: reproduced six failing recovery cases and fixed the latched
acknowledged-port loss in admin-browser.js. Three replacement observers at1/5/15s,
fresh IDs/wake:false, no startup/control replay; permission removal and malformed
ACKs stop recovery. Final61 browser/protocol tests pass, plus device/scheduler
regressions. The actual prior local-preview bytes pass background40/UI22/
ordinary16/Dot48 synthetic cases. New preview77bccd3b is reproducible and passes
13 real-MV3 synthetic scenarios. These are NOT current-user sends or new native
runtime recovery. Independent scoped review found no code blocker, not a full
product certificate; review's temporary unsealed PS fixture deviation is recorded.

Actual prior local directory still has older device code and no admin-control.js;
do not copy one new import into it alone or label it current/new acceptance.
Existing IAB runtime has no agent/browser handle after documented setup; no
private API or external-browser workaround. Current browser state not observed,
historical manual Pause preserved. Native79958886/stager65676c71 and loaded
scheduler hashes unchanged. Old frozen-preview/live-source comparison is now
stale by design, not reason to overwrite historical artifacts. No key, native
registration/task/tunnel, production or publication change. Full goal active.
Next critical path is actual browser/control deployment and hosted lifecycle
acceptance, not another synthetic-only claim of restoration. Exact evidence:
docs/plans/2026-11-07-observer-reattachment-results.md.

### New Candidate Actually Installed And High-Child Verified (2026-11-07 13:45 UTC)

Checkpoint35 supersedes checkpoint34's uninstalled statement only. One authorized
helper Start through native RunAs/UAC completed parent exec66672 exit0 with actual
status=administrator-child-verified, uacRequested=true, administratorChildVerified
=true, tunnelStarted=false and registrationChanged=false. Reviewed AcceptLocal
goes through the packaged provider into a real PowerShell command-child and checks
same SID, enabled admin role, TokenElevation and High integrity. This is supporting
one-time native evidence, not browser-managed owner/lifecycle or hosted acceptance.

New root C:\Program Files\AgentContinueAdmin\79958886ee7a4b87bd93faa5 has24328 files;
independent ordinary readback matches29 first-party source hashes and official
Node pin/version22.23.4; root owner Administrators/protected ACL. State present,
no candidate .browser/.secrets or new task observed; old D940 task still Ready.
Worker154996 and parent165628 ended, completed probe directories0; marker files
remain intentionally. No retries, kills, cleanup or D940 replay. Full hidden stager
stdout was not captured; helper success uses its fresh random exit witness.

Start has no durable operation-ID receipt; VerifyLocal is another actual probe,
not lost-result readback. Keep descriptive local-acceptance-result.json separate
from protected authority. New browser binding/enrollment, controls, recovery/revoke,
hosted and full release remain open. Original scheduler Pause/extension and
production untouched. No key/browser/registration/task/tunnel/publication action.
Full native goal active/body unchanged. Exact evidence:
docs/plans/2026-11-07-control-candidate-local-acceptance.md.

### Coordinated Candidate Actually Built (2026-11-07 13:33 UTC)

Checkpoint34 supersedes only the previous unbuilt-source statement. New runtime
79958886, previewf65f7886 and frozen stager65676c71 are together in
.artifacts/windows-control-candidate-20261107/. The107065439-byte runtime ZIP has
24328 members. Independent parent readback streamed all members to EOF, recorded
lengths/SHA-256 (287188846 uncompressed bytes), compared29 exact first-party sources,
38 fixed members, official executable pins and actual build-evidence bytes.
Eight critical preview files also match source with packager LF normalization.
Actual frozen SystemPS5.1 Plan passes with all install/activation flags false.

Actual unpacked candidate passes synthetic background40/UI22/ordinary16/Dot48/
deviceUI34, including explicit priority changed-text one-send. None are real
ChatGPT/Dot traffic or installed browser/native lifecycle proof. Preview2.2.1 is
developer metadata, not a new stable release or instruction to downgrade the
patched local2.2.2. Runtime ZIP, preview and stager must remain coordinated;
do not install only one into older enrollment or reuse D940's settled pins.

Original manual Pause and loaded scheduler bytes remain unchanged. Prior real
no-send console recovery is documented, but actual original delivery is still
unverified. New protected install/enrollment, positive high/CLI/browser controls,
recovery/revoke/hosted and release gates remain open. No desktop/browser input,
UAC/install/key/registry/task/tunnel/production/publication action; main592f8d6
unchanged. Full native goal active/body unchanged. Detailed recipes, hashes,
review and limits: docs/plans/2026-11-07-control-candidate-build-results.md.

### Capability Projection And Cross-Layer Deadline Fix (2026-11-07 UTC)

Source stager65676c71 now implements exact read-only CheckBrowserHostedOwnerControl
with sealed medium preflight and a bounded canonical last-published saved-intent
projection. Existing elevated publisher refreshes it under the same guard; no
medium secret access/UAC/task/writes. Mixed/missing state denies startup while
sealed-binding Revoke remains available. Connect=paused+idle, resume=saved-running+
idle; protected high live target/deny still decides authority, not public state.

Reviewer-found4.5/5second outer deadline bug reproduced/fixed across native20s,
worker25s/page30s. Reviewer-found exact inherited-private lifecycle ACL mismatch
reproduced/fixed using the existing exact validator under sealed parents. Test
oracles now prove create versus replace and actual legacy publication failure
after deny/readback under a real exclusive scratch guard. Final scoped static
review closed findings, not independent execution or whole-product certification.

Parent actualPS5.1 support113/267 plus24 PS-to-both-JS wire projections pass;
observation417/7093, control83/83, device logic62/62 and synthetic browser UI34/34
pass. Final refined ledger16/16 exit0 in64.064seconds and npm check/catalog4 pass;
frozen inputs/readback in control-support-projection-results.md.
Loaded scheduler exact files freshly pass background40/UI22/ordinary16/Dot48 in
isolated synthetic fixtures, including priority overwrite/one-send. No original
chat send or current actual Chrome state proof. Original manual Pause preserved.

This supersedes only missing source capability projection. Full native goal
active/body unchanged; new candidate build/enrollment, actual high/CLI/browser
recovery/revoke/hosted and release remain open. D940 and main592f8d6 unchanged;
no installed/UAC/key/task/registry/tunnel/production/publication action. Details:
docs/plans/2026-11-07-control-support-projection-results.md. Checkpoint33.

### Fixed Sealed Entry And Medium ACK Waiter (2026-11-07 12:51 UTC)

Source stagerc8297777 adds eight fixed medium/high control actions, strict closed
entry validation, exact native argv, selected-medium process capture, a bounded
ACK waiter and sealed high-side binding/audit/task callbacks. Revoke, Fence and
Reconcile do not call startup or task callbacks. Actual process-start identity,
not launch wall time, correlates the ACK; uncertain results keep the original ID
without replay, timeout kill or cancellation inference. No support advertisement
or CheckBrowserHostedOwnerControl capability projection was added.

Independent scoped review exposed two reproduced defects: the early high audit
had no owned SHA256 instance, and child exit/deadline could race an ACK read.
Both have RED/GREEN regressions. The high callback now owns/disposes its hash;
the waiter performs final readback on exit/deadline. A swallowed test-callback
exception oracle was also replaced with an outside-catch counter and re-reviewed.

Parent actual SystemPS5.1 entry75cases/646checks and real ZIP/full-verifier audit
3cases/56checks pass. Updated observation416cases/7089assertions passes. Final
full control-ledger suite15/15 exit0 in60.216seconds, and Node control/UI/protocol
80/80 pass. Actual medium self metadata, exclusive archive handles and real full
hash verification are exercised; positive High, owner/ACL/binding/registry/task
and kernel admission still use explicitly named fixture seams. Scoped static
re-review closed the reported issues; no independent test execution or actual
new high/protected-runtime/browser acceptance is claimed.

Frozen hashes, RED/GREEN evidence and limits:
docs/plans/2026-11-07-control-sealed-entry-results.md.
This supersedes only previous missing fixed-source-entry/waiter statements.
Public capability projection, rebuilt/enrolled candidate, real new lifecycle/
revoke/recovery and release gates remain open. D940 is immutable and untouched.

Installed scheduler popup12711009/background66c90c0c/adapter67999cf0 hashes were
rechecked unchanged; its previous synthetic test results were NOT rerun in this
slice. Original manual Pause remains authoritative; actual original delivery
and final UI reload remain unverified. No browser/desktop input, build/install,
UAC, key, task/service/registry/tunnel, production or publication action. Main
592f8d6 unchanged. Full original native goal active, body unchanged; checkpoint32.

### Durable Control Handoff Source And Core Regression (2026-11-07 UTC)

Current source stageraa39d11f integrates the held kernel witness with original-ID
transaction admission, immutable private peer/public handoff ACK and detached
long audit. Replacement high attempts have separate sidecar IDs; actual original
execution-lock sharing violations use guarded readback only, never replay. For
missing originals, Fence/Reconcile persists original-ID denial before ACK. Final
held-liveness sampling is the admission point; subsequent binding still requires
exact boolean true. Original runner/session records remain immutable.

Parent handoff fixture45cases/454assertions passes on actual SystemPS5.1. Actual
file exclusion/immutable record code runs with explicitly disclosed scratch
owner/ACL/lifecycle/task and acquisition substitutions, NOT positive High-pair,
protected-runtime or installed-route proof. Initial combined13/13 and Node
control/UI/protocol80/80 pass. Final refined combined13/13 exit0,53.839seconds,
with mandatory45/454 and all nine substitution categories, no skips/cancellations.
Independent frozen static re-review found no confirmed scoped implementation
defect; final delta re-review closed all three test/provenance follow-ups and found
no new actionable scoped finding. No independent test execution claim.
Exact evidence/hashes: docs/plans/2026-11-07-control-durable-handoff-results.md.

Exact installed scheduler unchanged and rechecked: UI22/22, background40/40,
ordinary adapter16/16 pass in disposable synthetic fixtures. Original Pause and
main592f8d6 remain unchanged; no real original send or successful final UI reload
is inferred. No browser/desktop input, candidate build/install, UAC, credentials,
task/registry/tunnel, production or publication action in this slice.

Full native goal remains active, NOT complete. New internal handoff is implemented
in source, but fixed sealed public actions, medium ACK waiter, actual new
high/protected admission and new-candidate lifecycle/revoke/release remain open.
This checkpoint supersedes the previous source-handoff-missing statement only,
not those delivery gates or settled D940 restrictions. Do not reuse old digest pairs.

### Archive-Bound Kernel Peer Loader And Null Target Fix (2026-11-07 11:48 UTC)

New source-only stager functions Read-AdministratorControlPeerSource,
Get-AdministratorControlPeerType and Open-AdministratorControlKernelSession now
bind the exact C# bytes to the whole held archive digest, compile under the
checked private directory, and project a held actual typed kernel witness into
strict Int32 PID/UTC-tick-string runner/session records. No public action/support
is enabled. Later entry must hold the witness through durable original-ID handoff;
detached audit must NOT depend on the medium staying alive after that ACK.

Two defects reproduced/fixed: relative compiler directory changed interpretation
after CWD switch (review P2, sentinel RED/GREEN, statically re-reviewed closed);
PS5.1 direct method binding turned null targets into empty strings (7 projection
case failures, fixed exact MethodInfo.Invoke(object[]) preserving null).
Current stager25238a11; unchanged peer50bd9fca. Parent archive/compiler37cases/
133assertions and typed projection66cases/215assertions pass; combined existing+
new control-ledger/observation suite12/12 exit0. Tests explicitly use compiler ACL
stub/fake typed peer for positives, and actual medium refusal, NOT high-pair or
protected-runtime acceptance. Both full fixture and native hashes checked by
wrapper. Initial worker only produced a skeleton; parent completed both suites.
Further test-review P2s closed: canonical SpecialFolder bundle independent of
optional environment; native request policy proved before exact admission
refusal; unexpected witness disposed; mandatory13compilerCases/six categories
and37/133 wrapper floors. Final refined combined12/12 passes; independent static
re-review found no new actionable scoped issue (no independent execution claim).
Exact hashes/limits:
docs/plans/2026-11-07-control-peer-stager-binding-results.md.

The full original native goal remains active. Fixed public mutation actions,
sealed entry/enrollment binding, actual medium/high UAC and protected handoff,
recovery/revocation/new-candidate browser acceptance and release remain open.
New source unbuilt/uninstalled/unpublished; no old stager/archive digest reuse.
Local source/installed popup12711009 and main592f8d6 unchanged; original Pause
preserved, no actual scheduled send. No browser input, UAC, key, task/service,
registry, tunnel or production network/MCP/IDE/research/ProcessLasso changes.

### Local Target Recovery Pushed; Kernel Peer Source Verified (2026-11-07 11:18 UTC)

The local-scheduler complaint remains the immediate user-facing priority.
Actual no-send Check reproduced a blank/stale selector despite the original dot
being present. Fixed inherited selection by unique normalized saved URL, not
old/reused tab ID or title, and fixed popup expansion's saved-ID fallback.
Missing/duplicate matches require explicit choice; no active-page fallback.
Only the installed popup.js was backed up and patched. After the first UI-only
reload, the real selector chose the original dot and Check returned Composer
detected without entering/sending. Last observed original task remains manually
paused,20minutes,prompt4728characters,count0. No original prompt submission.
Computer Use later ended because it could not determine the browser URL safely;
no successful final UI reload is claimed and no workaround was attempted.

Source and exact installed UI suites each pass22/22; installed background40/40.
New selector cases were RED before correction; fresh independent static review
caught and then closed the expansion-entry omission. The exact three-file index
snapshot then passed the complete public npm test suite, including MV3 11/11
and ProseMirror5/5, plus package6/6. Its first full run failed because generated
PDF.js assets were missing; the pinned188 assets were generated by the normal
vendor command before the full successful rerun. No production browser used.

Only popup.js,tests/ui-v2-tests.mjs and the public incident record were committed:
592f8d6aaa8b579a546a1b3da5607e5a11731732, pushed to the unique main and read back
from origin. This does not publish a Release or submit/approve a Store update.
GitHub Extension checks run42367662638 completed successfully at11:21:33UTC
for this exact SHA, independently read back through the public Actions API.
Its headed full npm test, package generation and artifact upload all succeeded.
This is CI/synthetic-browser evidence, not an original-task send or publication.
Installed popup SHA25612711009d2c3a852d30c5196ebde693243bd21150b9fb9a6bc1adf6c759b0b9b;
background66c90c0c/adapter67999cf0 unchanged. Original Pause still authoritative.

Separate unbuilt/uninstalled native source now exposes CaptureControlCallerIdentity
and OpenControlSession, using held kernel process/primary-token identities,
same selected SID/session, fixed argv and held Chrome/CMD/Node ancestry. Existing
native430 and focused JS12/12 passed; new actual-medium/policy fixture191cases/
10122assertions/22vectors and combined control suite10/10 pass. Test review's
self-derived-token false-pass risk was fixed with an independent self-token oracle
and re-reviewed. No actual new High-pair/UAC/protected-handoff proof. This native
WIP is NOT part of the three-file public commit. Frozen C#50bd9fca and fixture
d7ad1c4b are recorded in control-kernel-peer-results.md.

Next Windows gate: sealed PS entry/asset binding and actual medium/high detached
handoff; then fixed Connect/Resume/Revoke/Fence/Reconcile dispatch and real new
candidate recovery/revocation acceptance. Never advertise unsupported controls,
replay settled D940, install with old digest pairs or infer delivery from tests.
Full original native goal remains active; body unchanged by status-only goal API.
No production VPN/MCP/IDE/research/ProcessLasso mutation, new UAC/service/task/
tunnel/credential read/install or new Release/Store/npm publication this turn.

### Basic Console Recheck And Read-Only Status Wiring (2026-11-07 10:39 UTC)

The original user's local-scheduler complaint remains the immediate priority.
Fresh read-only Computer Use reached the existing dcah console Settings and
task controls: manually Paused, Resume available. No click or original send.
Installed2.2.2 background66c90c0c/adapter67999cf0 still match the recovered
preview; exact installed background-v2 tests40/40 pass again. Do not clear the
original Pause or claim actual production delivery from these checks.

Source now accepts the fixed ObserveHostedOwnerControl request and projects
only original-ID public receipt/progress after the enrolled selected-medium
sealed preflight. This supersedes old wording that all five control routes are
absent, but adds NO capability advertisement or new mutation route. Initial
linguistic action/key failures and a reviewer-found case-variant early-routing
omission were reproduced before correction. Final observation400/6897 passes
in5.1/7; combined control ledger/native-bridge9/9 and control/UI/protocol80/80
pass. The CI suite is configured locally, not pushed or run on GitHub here.
Fresh focused static re-review found no remaining actionable scoped issue.

Current unbuilt/uninstalled stager source3477336811416167a8c4bafc8957d77f894b1f6e7b48d5828ace62fc88e8718e
supersedes earlier source hashes only. Do not deploy using old digest pairs.
Exact OS-peer admission, detached handoff, new Connect/Resume/Revoke/Fence/
Recovery dispatch, actual new runtime recovery and release acceptance remain
open. D940/production state and full original active goal remain unchanged.
No new task, service, install, tunnel, credential read, commit/push/Release,
Store/npm or production VPN/MCP/IDE/research/Process Lasso change.
Evidence: docs/plans/2026-11-07-control-status-endpoint-results.md.

### Final Bounded Control Review (2026-11-07 10:12 UTC)

Newton's fresh static review found no actionable blocker in the revised frozen
control-regression scope, including the new runner fixture; all six file hashes
matched before/after. This supersedes review-pending wording below, not the open
delivery gates. Parent independently executed the recorded two-shell tests.
Final source hash5a38dd29 remains unbuilt/uninstalled; no new commit/push/Release,
Store/npm action or installed scheduler/production change this turn. Original
manual Pause remains authoritative. Complete evidence and limitations:
docs/plans/2026-11-07-control-operation-regression-results.md.

### Control Review Corrections (2026-11-07 10:09 UTC)

Supersedes the preliminary source hash/counts below. Independent review found
collection/coercive identity holes in session SID and terminal identity. Added
failure tests before requiring scalar strings with Ordinal equality. Current
both-shell results: operation29/943,store266,identity75,runner86/528. Stager
SHA2565a38dd292d86323e2c6c4dd70b70aef7fb94e3c44db39303e61d9aee83b87655.
Fresh final review pending. Exact input hashes, commands, rejected alternatives,
review decisions and limits: docs/plans/2026-11-07-control-operation-regression-results.md.
No production, installed extension, saved Pause, candidate or publication change.

### Source-Only Control Regression Repair (2026-11-07 10:04 UTC)

This supersedes checkpoint22's RED source-operation counts, not its observed
local scheduler incident or production boundaries. The original full goal
remains active. Actual installed scheduler background/adapter hashes still match
the 09:47 recovered preview; no browser input, extension update, saved-task
resumption, installed high-side mutation or production connection change here.

Reproduced the internal operation fixture before changes: Windows PowerShell5.1
21/28 (seven Revoke failures); PowerShell7 0/28. The operation's pre-effect scan
was asking Revoke to read its forbidden launch phase. Keep that serializer
closed, scan legal phases, and explicitly reject a preexisting forbidden file.
Added the corresponding no-effects refusal test. Both shells now pass29 cases
and943 checks, retaining same-ID no-replay, write-ahead effects and Pause priority.

Three control JSON readers now accept only Int32 or Int64 version1, matching
their serializers and both parser representations. Canonical full-byte equality
still rejects coercions, duplicate fields, BOM, CRLF and changed formatting.
Expanded scratch store tests pass256 checks in both shells with six identical
canonical hashes. Identity67 passes in each. Focused runner PID/tick and terminal
version tests now pass62 cases/288 checks in both shells. They read only the test
process's own identity and in-memory stub completion records; no process is
started or stopped. Canonical tick strings retain the serializer's DateTime
bound, and terminal versions reject bool/string/fraction coercion.

Additional current checks: PS5.1 ledger6144 read combinations,363 publication
orders,45115 assertions; Node protocol17 and control/parity/UI63; scheduler
watchdog/timing-i18n8. Counts overlap and are not a full-product certificate.
Tests extract AST functions only, stub ACL/OS callbacks and write only disposable
temporary files; no stager dispatch, protected ACL or new OS-peer proof.

The public high-side actions are still absent from the stager dispatch. Exact
OS-peer admission, detached handoff, real recovery/revocation and new-release
acceptance remain unfinished. The actual Desktop/64bit production gate stays
unchanged; these parser tests do NOT make PS7 a supported stager host. Do not
build/install/publish this mixed native WIP as delivered, rerun settled D940
operations, or clear the owner's original scheduler Pause. Stager source SHA256
495442350d074aeb1df60bdc9449835382f099989e59a20da3e439dc8f61a837 is NOT a
verified installed candidate. Do not reuse an old bundle/stager digest pair to
deploy it. Independent code review remains pending at this checkpoint.

### Post-Reload Actual Console And Remote Main Readback (2026-11-07 09:47 UTC)

This supersedes the previous follow-up's unpushed and post-reload-unobserved
wording. Main0e6b37e6f19796a1acfb6123fb68aaf968c81da8 was pushed and read back
using git ls-remote. No Release/tag/Store submission was performed.

Fresh Computer Use selection/readback now works for the local extension pages;
the prior turn's stop was not treated as permission to bypass anything. Actual
post-reload dcah console is usable and still manualPaused,20minutes,4728chars.
Ran its explicit no-send timing diagnostic: authorization1ms,oktrue,allowedfalse;
hidden page first1057ms,total2058ms. Its own Export produced
D:/Downloads/agent-continue-activity (2).json, schema4,extensionVersion2.2.2,
71 entries including exactly2 new timing-probe records with typed metadata.
Actual Settings visual readback shows extension-priority CHECKED. No setting
was changed. No prompt read/submission or resumption. Keep original Pause until
owner chooses otherwise. Public bounded incident record:
docs/incidents/2026-11-07-local-scheduler.md.

IAB bootstrap documentation is incomplete in installed Browser26.1103.32239:
registered skills directory empty; docs refer to a missing Bootstrap block.
Trusted JS setup attempt left agent undefined. A read-only sidecar independently
confirmed missing docs without inspecting runtime-private implementation. This
is NOT proof that IAB itself is unavailable. No external-browser website
navigation, guessed/private-runtime workaround or security change was used.

### Scheduler Refinement And Local Main Commit (2026-11-07)

Scheduler-only source is committed on the existing main as `0e6b37e`; this turn
has NOT pushed it, created a Release or submitted a Store version. The complete
public npm test suite passed on an exact index snapshot, plus six packaging
tests and both archive layouts after regenerating pinned PDF.js assets.
See docs/plans/2026-11-07-scheduler-timer-recovery.md for individual counts.
Unrelated native/admin WIP remains unstaged and must not be reset or published.

Independent review found and reproduced concurrent diagnostic-log loss and
cleared-history resurrection. Two red-to-green tests now cover queue-serialized
appends, with probes outside the queue. Actual UI handler tests cover English,
Chinese, disabled in-flight controls, transport-error redaction and retry with
no task/config mutation. Diagnostic exports are now schema4 and distinguish
execution-timeout from API rejection without raw exceptions or content.

Eight bounded scheduler/UI files were backed up under
.artifacts/local-extension-recovery-20261107/refinement-v4 and copied to the SAME
installed dcah preview. Previous native imports/dispatch are preserved verbatim;
unfinished admin-control source was explicitly excluded. Installed background
SHA256 is 66c90c0c869ffc2f9caa8c20ee4ef8cf8ced0944253291e24fea83d31d79e4d8;
adapter SHA256 remains67999cf08f15579cbeddf018fad792330ea85e6575e1891887b7426f3050d871.
Exact-preview disposable tests pass background-v2 40 and realMV3 13. Chrome
extension-only Reload was issued successfully after refreshed geometry. The
last real console observation BEFORE that reload retained Manual Pause,
20minutes,4728-character prompt and successful no-send composer check.

During subsequent navigation back to the console, Computer Use stopped because
it could not determine the current browser URL confidently enough to enforce
policy. Stop app input; do not bypass through UIA/CDP/other browser automation.
Post-reload real diagnostic/export4 verification therefore remains unobserved.
No production prompt sent, no saved Pause cleared. Owner resumption choice is
still pending. No production VPN/MCP/IDE/research/Process Lasso changes.

### Local Scheduler Incident Takes Priority (2026-11-07 09:21 UTC)

The owner reports the actual local extension unusable. Stop expanding the
administrator feature until the local scheduler incident is resolved. This is
separate from the successful D940 hosted acceptance and its final test-only Pause.

Actual Chrome UI had BOTH enabled: unpacked `dcahjbghpncachlghgemfgpeggibgmbd`
2.2.0 and Store `jpioilmpbolfokedaefmbfbjeaahfdkl` 2.1.0. Preview Loaded from is
`dist/windows-admin-browser-acceptance-20261106-e8a56275/unpacked/AgentContinue`,
not the current root source. The preview did not contain later main adapter fixes.
Both tasks were manually paused before remediation; do not infer permission to
clear that pause from a code fix. Store duplicate is now DISABLED, not removed;
its data was not cleared. The same preview ID is enabled and reloaded as
`2.2.2 Local timer repair (Windows preview)`. This is a local hotpatch, NOT a
GitHub Release or Store upload. Original candidate ZIP was not changed. The old
unpacked directory must no longer be described as byte-identical to that ZIP.

Exported current preview logs through its own UI into
`D:/Downloads/agent-continue-activity (1).json`: 64 events, including 30
`unconfirmed/execution-exception` at 20,001-20,006 ms and 18
`unconfirmed/adapter-result`. These are not 48 proven dispatches or failures.
The original older Downloads export is stale. Actual no-send CHECK_PAGE worked.
New paused-only Diagnostics button measured the original hidden Dot target:
authorization 1 ms, ok=true/allowed=false; requested page timers 60+180 ms took
991+1001 ms (1992 ms total), hidden=true. This proves current timer dilation;
it does not prove the cause of every historical 20-second watchdog expiry.

The repair sends bounded WAIT_RUN clock requests to the extension worker rather
than using hidden-page timers. Each 50/60/150/180 ms delay checks exact run/tab/
frame/deadline authorization before and after; no state queue is held while
waiting. Pause/replacement wins, no second submission attempt is introduced.
The diagnostic itself neither fills nor submits, changes no job state, and
returns only bounded timing/boolean metadata. It resolves the unique saved URL
after reload without changing the paused task. No raw exception/DOM/text/URL is
returned. Existing main adapter fixes were copied; no admin-control WIP imported.

Current tests: adapter38, background-v2 38, background-state34, support19,
UI-v2 15; real MV3 source and exact patched preview13 each. The new MV3 fixture
forces every isolated-world page timer to >=60 seconds, confirms one configured
message using zero adapter page timer calls. Synthetic fixture evidence is not
a real production Dot send. Actual Chrome confirms 2.2.2 enabled, Store2.1 off;
4728-character prompt survived reload. Original task is still manually paused;
an explicit owner choice to resume the original prompt/interval was requested.
No actual production prompt has been dispatched by this repair at this checkpoint.
Backups and the exported pre-repair log are under
`.artifacts/local-extension-recovery-20261107/`. No Chrome restart/profile reset,
credentials access, VPN/MCP/IDE/research or Process Lasso change.

The unrelated next-source high-control transaction WIP added this turn is NOT
deployable: sidecar `windows-admin-control-operation-tests.ps1` returned PS5.1
21/28 (7 Revoke cases hit invalid `launch-attempted` phase lookup), PS7 0/28
(additional strict JSON-number representation rejection). Those expectations were
not weakened. Existing primitive fixture passes below do not cover this new WIP.

### Dot D940 Accepted And High-Control Store Source (2026-11-07 08:46 UTC)

Supersedes earlier Dot-scope-pending wording only. The owner explicitly approved
one temporary acceptance request in the existing Dot research main. Actual IAB
Dot execution used the same D940 custom MCP App and browser-managed G3
`bd8b8bf41c284307b892bf0d5bf48544`: command-child PID175032, elevated token1,
High-integrity SID, selected account and random marker matched the independent
protected witness and exact provider history. A dedicated file-tool write/read
matched its native file. Owned process PID106996/startTicks639296373977467813
matched its witness; Dot requested stop and observed no active session; native
readback found the process absent. All four operation receipts say provider result.
Numeric hosted command/process exit codes are NOT separately verified.

Final actual Devices Pause operation `f60a9161dfdb4ef79e4a2e45fb7701d4` has protected
stopped receipt. Saved paused=true; G3 root exited0, Job drained, inner leases
clear and all three lease paths absent; task instances0, broker/root absent.
The offline actual-browser harness exited0 and removed only its temporary Chromium
registration. No production VPN/MCP/IDE/research or Process Lasso changes.
Local detailed evidence and IAB screenshot are in the original chat visualization
directory as `D940-Dot-Acceptance-20261107.json` and its PNG counterpart.

Next-source stager now contains closed/canonical reservation, targetless fence,
write-ahead phase, immutable receipt, exclusive FileStream execution lease and
bounded progress store helpers. These are NOT yet wired to the five public fixed
actions, nor proof of actual OS peer identity: serializers validate supplied
shapes, not kernel process/session identity. Action integration, detached handoff,
OS identity verification and recovery remain critical. Full bundle verification
now has an optional 64-file progress callback without skipping full hashes or
closure checks; it is not yet connected to actual GUI progress.

Current focused runs: 80/80 existing new-control tests and 4/4 new PS5.1 fixture
runners. The fixtures cover 6144 read-state combinations, 363 publication orders,
63 identity assertions, 31 store checks and 130-file verification progress with
content/closure tampering refusal. They run in scratch paths with ACL stubs and
are not protected high-control acceptance. Independent review of this new store
slice subsequently completed: it found an invalid-origin test array collapsing
four cases into one under PS5.1. A new count assertion reproduced the failure;
parenthesized cases fixed it (identity now67). Additional interruption/collision/
atomic-progress-failure tests passed (store now44). The reviewer found no other
confirmed implementation issue in the bounded inspected primitives; that is not
whole-product certification, concurrent first-create/crash proof or high-side
action acceptance. The reviewer did not inspect Verify-SealedBundle progress or
Dot native artifacts. Existing BrowserPauseFixturesOnly also passed. No Windows
release, Store submission or npm publication.
Full native goal active; objective body unchanged by status-only API.

### Administrator Control Source Slice (2026-11-07 08:11 UTC)

The next-source browser GUI, worker journal and additive native bridge protocol
are now implemented, not merely designed. `admin-control.js` is packaged explicitly;
Devices offers separate administrator Connect, saved-running-only Reconnect and
installation-scoped Revoke confirmations, plus original-operation receipt,
progress, Fence and Recover controls. The worker persists a closed operation
identity before dispatch, preserves unknown requests across worker restarts and
Clear Data, and only polls the same receipt. It does not automatically retry a
mutation or let an unresolved operation start a second connection. Revoke is not
blocked on a fresh capability RPC. Terminal records can be archived with verified
readback before eviction; unresolved records are never evicted to make capacity.

Independent bounded code review found four issues, all reproduced before fixes:
permission-epoch dispatch after revoke/regrant, a lost readback poll on regrant,
fresh-support coupling of Revoke, and saturated journals blocking Revoke. Follow-up
review found a fifth: an interrupted archive commit could block capacity after a
legitimate revoked-to-stopped refinement. Its failing test now passes with safe,
identity-preserving archive reconciliation. The last follow-up found no new
blocker in the inspected archive helpers/test tail, NOT in all product layers.
Complete EGM source adoption/cold-review/completion certification is not claimed.

Current checks: `npm run test:admin-controls` 80/80; existing admin/browser-wake
plus native protocol regression 77/77 (including a PS5.1 unsealed scratch fixture);
background-state 34/34; background-v2 33/33; device dialog/integration-source 16/16;
headless Chromium simulated UI 34/34 checks at 1100px and 390px; Python package
unit tests 11/11. These runs are separate overlapping suites, not an aggregate
unique-test count. No new Windows high-component or account-browser acceptance.

Local source preview only:
`dist/windows-20261107-admin-control-ui/agent-continue-2.2.1-windows-device-preview.zip`
SHA256 `f6f0b481cf6a2f01fcfe18e0d0be3a5baa03092bee40cf98addd301b46148e05`,
237 members. Critical entries match current source AFTER canonical packager LF
normalization, not raw CRLF byte equality. The archive has no EXE/MSI/CLIXML/.env
members in the exact member-name scan. This is not a new immutable administrator
runtime bundle, public Release, installed extension update or Store submission.

Critical remaining implementation: `Stage-WindowsAdministratorBundle.ps1` does
NOT yet implement Check/Request/Observe/Fence/ReconcileBrowserHostedOwnerControl.
The native bridge calls fixed future actions and fails unconfirmed for legacy
stagers; GUI actions cannot claim capability or fall back to ordinary wake. Its
write adapter no longer kills a child at the response deadline, but detached
medium/high handoff, protected receipts/progress, verified peer/session binding,
startup leases/tombstones and high-side Revoke are still required. Pipe lifetime,
maxBuffer and OS failure are not yet solved by the response-only timeout.

Current installed D940 remains the immutable, intentionally paused prior
acceptance subject. It was not restarted or changed during this source slice.
Dot scope question remains pending; do not post to the existing research main.
Same-browser transient-port recovery and Store optional-permission acceptance
also remain open. Original full goal stays active; the status-only API did not
rewrite its objective. No production VPN/MCP/IDE/research or Process Lasso change.

### Current Stop And Remaining Product Work (2026-11-07 07:41 UTC)

Actual browser-managed ordinary ChatGPT acceptance now includes administrator
command/file/owned-process operations, a distinct Ready generation after browser
close/reopen, actual Devices UI Pause, and pause surviving another browser reopen.
A single hosted read_file after Pause returned Session terminated without file
content; no reconnect, retry or alternate plugin was requested. This is one
observed refusal, not an exhaustive authorization proof. The final protected
readback at07:40:55 UTC still showed paused=true, no controller/operation lease,
zero task instances, and a drained G2 exit0 terminal. Temporary Chromium test
registration was removed. The candidate is intentionally left paused.

Dot remains unaccepted: current UI exposes the existing research main thread,
not a separate test conversation. No Dot message, Pause or Restart was sent.
The pending scope question is whether a clearly marked temporary test may use
that existing thread. Do not silently substitute ordinary Work mode for Dot.

Next product source work is explicitly separate from accepted D940 bytes:
administrator Connect/Reconnect/Revoke GUI, durable result reconciliation and
same-session binding. Same-browser transient-port runtime recovery remains open.
See WINDOWS-ADMIN-CONTROL-COMPLETION-DESIGN.md, a design-only artifact reviewed
against source, not implemented or runtime-accepted. Preserve full verification
and first make its minutes-long progress observable; bounded-loader optimization
is separate, not a completion prerequisite. No Windows release/Store claim.

### Approved D940 Endpoint And High Component Proof (2026-11-07)

Supersedes pending-approval/form-only wording below: the owner confirmed creation,
connection and both-entry administrator acceptance. IAB created exactly one new
`AgentContinue Windows D940 Acceptance` tunnel,
`tunnel_6aeec565ffe08191935f53e3bc60d05d`, in the verified personal workspace.
Existing tunnels and the old pending request were untouched. Protected BindHosted
receipt `9d0cd2b4a2064970b72b91ff6218849f` completed at06:41 UTC with
administratorChildVerified=true, hostedBindingPrepared=true and no activation.
At06:59 UTC, the interactive AuthorizeAndEnroll receipt completed both operations
for isolated acceptance origin `ibhdcljfbjhohmaekibjnpanejbfmmam` in session1.
Actual ordinary ChatGPT high command, native file-tool roundtrip and owned-process
start/list/stop now passed on this browser-managed candidate. See current section
below and `dist/windows-20261107-browser-lifetime/hosted-chat-observation.json`.

Final real high-component fixture passed 2/2 (exec39477 exit0). Genuine high broker,
production WindowsOwnerJob and native peer verification: two browser starts gave
distinct generations, each with selected-SID/admin/High command-child proof; both
roots exited0, Job.ActiveCount reached0, unrelated inert process survived.
Temporary registry/protected fixture directories removed; user-temp evidence kept.
Fixture controller/inert root is NOT production owner/journal, Scheduler Queue or
hosted transport. Product gates remain. Reviewers exhausted quota, not review PASS.
Fixture directory-inheritance, PATHEXT and ACL-observer corrections were retested;
no production source change for these corrections.

Old acceptance `1c42e8b5` was reobserved paused, with a drained exit0 generation,
no leases and no Scheduler instance. Its normal RevokeHostedOwner and
UnenrollBrowserOwner then completed: revocation preserved and registration removed.
The production endpoints were not modified. Chrome administrator_owner now points
to the D940 protected manifest and sole isolated origin above. Never replay the
old uncertain operation or D940 AcceptLocal.

The private portable plugin `plugins_6aeec7a2a98481919119ed081caafd50` was created,
but its default link opens Codex, not an ordinary ChatGPT conversation. The actual
official ChatGPT custom-MCP App was then created and connected against the same
tunnel: `plugin_asdk_app_6aeecf5622f88191a6b2a3a2c28c4009`, display name
`AgentContinue Windows D940 Chat`. This separate App is discovered by the ordinary
ChatGPT conversation; do not confuse the two plugin records or recreate them.

Actual product browser harness `tests/windows-d940-browser-acceptance.mjs` uses
unchanged candidate JS with only an isolated key and developer-load required
nativeMessaging in the test manifest. Its offline browser is not an account
browser. It does not prove the Store/optional-permission prompt. The first helper
Connect failed before mutation because it used pre-enrollment paths; ConnectEnrolled
uses the pinned sealed browser stager/archive instead. Its completed receipt is
ok/runningIntentSaved=true/launchRequest=requested. Do not repeat it.

### Actual Ordinary ChatGPT Acceptance (2026-11-07 07:21 UTC)

Conversation: https://chatgpt.com/c/6aeecff9-c8bc-83ea-a062-3ffe82555d98 .
Ready generation `d54733f1711c4d34ae8918dfb72cf421` was independently read from
the protected candidate. The conversation actually executed exact PowerShell
operation `79e2f211-77f2-44a3-8cd9-625d8764fc64`, PID165764. A command-child
TokenElevation=1 / High Integrity SID witness and unpredictable marker matched
the browser response. Native mutation receipt reports provider-reported-result.
Numeric process exit code was not independently returned; do not invent exit0.

The actual write_file/read_file tools roundtripped a dedicated Temp file; native
readback matched its random marker and mutation receipt. An exact owned process
was then started as PID174768, creationticks639296327457382247, independently
matched by image/creation identity, listed on the web, stopped with operation
`2e2728b3-bf65-4f01-a5b7-7a6b823d67b0`, then absent from web sessions and OS exact
identity. Only the disposable process was requested for termination.

At07:24:55 the isolated test browser was closed. Real product G1 terminal confirms
root exit0, Job drained and all inner leases clear; paused intent remained false.
At07:25:23 the same profile was reopened with Restore enabled. The real demand
path produced distinct G2 `7e4a982213184032819c6424740ab58d`, independently Ready.
Ordinary ChatGPT then executed fresh exact operation
`2930501b-5a78-4b29-a246-4938825bb78d`; PID139768 and its unpredictable High-token
marker matched native witness/receipt. This is real restored execution, not only
a Ready projection. Numeric command exit status was not independently returned.

Actual Devices UI Pause `0aa26b4a01fb46dbbd8e3ec5eaf36a57` returned protected
stopped; G2 root exited0, Job drained, inner leases clear. Reopening with Restore
still enabled preserved paused=true, zero owner/controller/operation leases and
zero task instances. The real UI read back the same stopped receipt. The
startup task was requested and exited0 after honoring pause; do not claim no
startup request occurred. At07:33:30 both acceptance browser sessions had closed
and exact temporary HKCU Chromium registration removal was read back.
Leave D940 paused; don't unpause while Dot scope clarification is pending.

Dot UI exposes the existing research main conversation, with only Rename/Pause/
Restart in its menu; no independent new-Dot action was found. No prompt was sent,
and no Pause/Restart clicked. A scope clarification asks whether a marked temporary
acceptance request may be sent to this existing Dot. Do not interpret ordinary
Work mode or the ordinary ChatGPT result as Dot proof.

Known current source gaps: initial administrator Connect/reconnect lacks a GUI
route; native-port loss is latched rather than automatically recovering; removing
browser permission is not durable owner revocation. These are product blockers,
not waived by backend component tests. A bounded follow-up design is in progress.

Windows comes first: Node-first setup, official OpenAI tunnel, no custom EXE
installer or project relay. AgentContinue is the device control surface, while
both ordinary ChatGPT and Dot must execute through the selected Windows OS
identity. Treat setup/registration, conversation permission, an elevated
operation, browser-only recovery, and public release as distinct checks.

The initial scheduler fixes `014d435` and `80a14cc` are now included in the
scheduler-only `2.2.1` source on canonical main at
`753d9da18a59fe206e78e7bfd8521e462c3043aa`. Annotated tag `v2.2.1`
resolves to that exact commit; both were pushed non-force and read back.
The [extension priority instructions](COMPOSER-PRIORITY.md) explain the explicit
text-overwrite setting. Release run `42333761693` completed successfully and
GitHub visibly published `v2.2.1` as Latest. Downloaded public assets passed
SHA-256, exact tagged-blob and pinned-vendor readback, not only local packaging.
The 232 payload members match between GitHub and Store packages: 44 tagged files
and 188 pinned PDF.js assets. Published ZIP SHA-256:
`ae703911e2e6ada552744cc5da408937d9ea1f65e26cd85489d0b7e4f8a6afbd`;
Store ZIP: `f4ab606b8661d417cdb89be54c164f352774438d859627a4bcad2523ac7b9047`.
Verified downloads are under `dist/published-v2.2.1/`; local Windows builds have
different checkout line-ending hashes and are not the uploaded public assets.

Local full browser regression passed, including 48 Dot adapter cases, 16 ordinary
composer cases, 10 real MV3 integration cases and five official ProseMirror cases.
The release-adapter suite now has 36 passing cases. Independent review caught
false confirmation when a historical row gains/changes its key; eight red/green
VM cases and two Chromium cases now reject that condition. Recycled nodes remain
unknown; remounting history with both a fresh node and unseen key is a documented
DOM-only limitation, not solved by this patch. No exactly-once claim is made.

The release uses 15 narrowly staged files, with bilingual current documentation,
privacy disclosure, matching stable metadata and unchanged Chrome permissions.
All unrelated Windows/native WIP remains local. Use the downloaded and verified
published Store ZIP for Store upload. The in-app Chrome Web Store
dashboard currently requires personal Google account reauthentication at
"Verify it's you". There is no new Store submission or approval at this checkpoint.
Do not replace existing release assets or move the published tag to address a
future issue; prepare a new patch version. The large Windows goal remains active.

### Browser Lifetime Source Implementation (2026-11-07 05:30 UTC)

This supersedes the 04:48 statement that the lifetime mechanism is unimplemented:
candidate source now retains an administrator native port and a real Windows
local lifetime channel. It is NOT yet a deployed/hosted administrator feature.
No installed b7 bytes, native registration, production tunnel, VPN, IDE or research
task was changed. The stable scheduler GitHub release above remains separate.

The medium helper is PowerShell 5.1 loading adjacent pinned C# source in memory,
not a custom EXE/MSI. Pipe creation has an explicit protected DACL, Network SID
deny, reject-remote-clients and first-instance protection. High-side liveness
verification uses the connected server PID, held process handles, token SID and
session, native argv and PS -> Node -> CMD -> Chrome ancestry. This is a liveness
channel, not another command endpoint or OS authorization. Same-account arbitrary
code/injection isolation is not claimed.

Root and each provider require a separate retained witness before admission.
Generation is pinned once; losing it latches denial and cannot borrow G2. Browser
metadata, commit and directory identities are pinned across async acquisition and
subsequent checks; disappearing enrollment cannot downgrade to maintenance.
Shutdown begins witness closure before slow controller/SDK disposal and observes
both cleanup attempts. Failed cleanup remains unconfirmed. No protected marker
or environment variable alone authorizes commands. Explicit Pause/Revoke and
unsettled journals still win; no old unknown operation has been replayed.

Independent review reproduced and drove fixes for post-READY partial-byte
acceptance, journal acquisition after shutdown, delayed provider-channel closure,
premature successful host exit and enrollment-loss downgrade. The first native
provider limit was a cumulative quota; a real-pipe red/green test changed it to
16 concurrent slots reclaimed only on confirmed provider EOF. The same owner now
passes 32 sequential connections followed by 16 concurrent connections.

New source demand policy is Queue instead of IgnoreNew. It deliberately coalesces
accepted *installation startup demands*, not session-bound commands. A queued
demand can use a currently verified browser only while saved-running intent and
activation remain authorized and old leases settle. A disarmed observer creates
no demand. Restore-off does not cancel already accepted startup; explicit Pause
does. English/Chinese device disclosure states this distinction. Expired-session
correlation was not proved and is no longer claimed. Worker replacement stops its
generation without Pause and does not automatically create a new demand in that
same browser session. Full rapid-reopen/high-Job acceptance remains open.

Observed local checks include actual PS5.1 compilation and 430 native assertions
(server/ACL/framing/negative clients/concurrent-slot reuse), current owner/cleanup
unit regressions, real ordinary pinned-core stdio file/process roundtrip with
zero network/browser attempts, the existing real Chromium injected-state Pause
fixture, and existing real inert Job containment tests. These are different
scopes; they do not replace a sealed elevated Chrome lifetime test or ordinary
ChatGPT/Dot hosted calls. The final focused JS run passed 97 tests, zero
skips/failures. A NEW actual Chromium/native-PS fixture passed both cases with
four distinct generations, four real Owner/Provider pairs, wake flags
false/true/true/false and four observed root exits. It used the production native
peer verifier without injection, but an unsealed disposable medium-token fixture,
not the protected high root/Job. Scratch-bound processes, the random HKCU host and
disposable files were verified absent after cleanup; no unrelated process was
signalled. Initial permission grant now attaches one wake=false observer when no
port was attempted at startup; grant cannot retry a disconnected/failed port or
authorize a racing wake. That grant behavior is unit-tested; a real Chrome
optional-permission prompt remains unobserved. CI source now includes the focused
tests and an explicitly conditional medium-token native fixture, with NOT
OBSERVED on an unsuitable runner; no remote CI run or high acceptance is claimed.

The earlier b7 archive and companion stager pins remain unchanged. Current source
stager bytes are a NEW candidate (including Queue policy); never use the new
source to reinterpret b7's old proof or operate its old enrollment. This 05:30
source checkpoint preceded the local package below; no Release/Store upload is
claimed. The goal is active;
native objective body was not rewritten by the status-only API. Updated external
checkpoint and append-only memory notes carry the source progress.

### D940 Native Administrator Acceptance (2026-11-07 06:04 UTC)

The NEW d940 candidate has now completed its first native AcceptLocal invocation,
not a replay of B7 or a second attempt. Launcher session60420 returned exit0 and
`status=administrator-child-verified`, `uacRequested=true`,
`administratorChildVerified=true`, `tunnelStarted=false`,
`registrationChanged=false`. Terminal output was observed at06:01:29UTC.
The hash-pinned stager's success witness follows its actual command-child native
SID/elevation/integrity/nonce/PID/exit/cleanup checks, not just the parent token.

Correct derived installation path is
`C:\Program Files\AgentContinueAdmin\d94052eccd6d90bb08f6de78`:
use digest.Substring(0,24), never a manually truncated literal with an extra byte.
Six critical installed source hashes and official Node hash independently match
the candidate; their owner is Administrators and their DACL is protected. The
root ACL is observed; medium-token private-state ACL read is AccessDenied, NOT
a readback of that private ACL. No secret vault or browser enrollment is present.
Inspection reports the existing OTHER browser registration, which was untouched.

Do NOT rerun first AcceptLocal. A later process reused worker PID180816 with a
different creation time; it is not this installer and must not be signalled.
`dist/windows-20261107-browser-lifetime/local-administrator-observation.json`
contains the bounded terminal/readback evidence. Two fresh review attempts
returned quota errors before producing reports; no new independent-review pass.

Still open: real protected high-root/Job browser lifetime and rapid-reopen Queue
handoff, then fresh ordinary ChatGPT command/file/process receipts and Dot. IAB
now holds a NEW prepared `AgentContinue Windows D940 Acceptance` form with the
same verified personal organization/workspace, not submitted. Specific combined
endpoint/configuration/high-tool acceptance confirmation has been requested;
do not bypass it via API or reuse old pending requests. No hosted Ready or
Windows delivery/public-release claim. Production VPN/MCP/IDE/research untouched.

### Browser Lifetime Candidate Readback (2026-11-07 05:48 UTC)

Built a NEW, unpublished runtime candidate using the canonical offline builder:
`dist/windows-20261107-browser-lifetime/agent-continue-windows-admin-x64-browser-lifetime-source.zip`.
SHA-256 `d94052eccd6d90bb08f6de78cdf97dee3d50cad4c4d88f5fcacae2b6d15bde5f`,
107059994 bytes, 24328 members. Pinned companion stager in the same directory:
SHA-256 `c74842d8c99da6e8c2fa0be05e49bfeffec26a8dd8515ddec8c7cb834f1fb671`.
Do not substitute either pin into the old B7 acceptance/enrollment commands.

Canonical Plan passed with protectedFilesVerified=false, activated=false and no
registration change. Six critical archive source entries, including all three
new native-session helper sources and the final host cleanup, were independently
SHA-256 matched to current source. The only executable archive entries are the
locked third-party ripgrep, official Node and official tunnel runtime; there is
no custom EXE/MSI installer.

The actual extracted-candidate smoke passed AFTER the final cleanup refactor:
28 tools, 67 RPC replies, 0 protocol errors/network/browser attempts/stderr bytes,
owned file write/read and managed/prepared harmless process checks, standard
Windows token and stdin-close exit0. This advances the earlier pre-refactor
source-only stdio evidence; it still does not prove administrator browser/Job,
Queue or ordinary ChatGPT/Dot hosted acceptance. `observed-results.json` in the
candidate directory records these scopes. No existing installation, credentials,
registration or production runtime was replaced; no public release/upload.

### Latest Windows Local Acceptance (2026-11-07 03:56 UTC)

The b7c53d97 administrator candidate is now installed and a fresh, actual
selected-account local probe passed. `VerifyLocal` returned
`administratorChildVerified=true`, `uacRequested=true`, no tunnel and no
registration change. Its stable receipt ID is
`21c8f129ef484ea58ecd4a7830ca96f5`; the protected started/result pair was observed.
The exact pinned stager verifies the command child's SID, administrator role,
elevation, integrity, nonce/PID and completed process before success, then closes
the provider, cleans the probe and rechecks the paused state.

This does not retroactively confirm the first `AcceptLocal`: its five-minute
parent observation expired while the real worker was still verifying the bundle.
The first worker later exited and persistent state appeared. It was not killed,
deleted or rerun. The launcher now waits up to fifteen minutes after launch and
offers explicit `VerifyLocal` for an existing installation, with a caller-retained
receipt ID. That action authorizes a new bounded local probe; it is not a readback
or replay of an unknown probe. Seven focused launcher tests passed, with two new
red/green cases and an independent static review. The stager pin remains unchanged.

### Installer Recovery and Browser Lifetime Gate (2026-11-07 04:48 UTC)

The endpoint confirmation is not the only remaining Windows gate. A fresh audit
of current code confirms the administrator owner is browser-triggered but not
browser-lifetime-owned: one-shot wake starts an independent Scheduler task.
The same healthy generation can survive Chrome exit. Standard-account retained
port tests do not prove administrator browser-close settlement or new-generation
recovery. Preserve b7's valid local proof, but do not call this requirement done.
The implementation/acceptance contract is in
`docs/plans/2026-11-07-administrator-browser-lifetime.md`; the lifetime mechanism
itself remains unimplemented. This corrects the prior next-step implication that
only a new endpoint and hosted approvals remained.

Independent installer review found real usability defects. The source now has
an explicit read-only `browser-install-status` command and PowerShell
`-DeviceAction browser-installer-status`, with bilingual primary-route guidance.
It separately reports configuration, exact bridge files, all four registry
hive/views, incomplete coverage and interpreter mismatch; it never starts or
retries installation. The standalone `installer-status` is unchanged. Known
bounded browser-registration errors are preserved, while Verify/Uninstall can
reuse validated portable Node without provisioning. Explicit NodePath stays
strict. Review-driven closing binding/profile checks and unknown-interpreter
handling have red/green regression coverage; the final bounded review closed
those findings. This is not formal EGM or hosted acceptance certification.

Current local checks: 19 wake-registration tests, 34 PowerShell recovery tests,
27 synthetic Setup UI checks, five preview-kit tests, plus one real disposable
Chromium/native-framing test passed. Official portable Node 22.23.4 was downloaded
and verified in a named temporary fixture; reuse/tamper/refusal checks passed.
That fixture remains after the parent cleanup command was rejected before
execution; no alternate deletion was attempted. No system Node was replaced.
The complete local npm package suite also passed 11/11 after replacing a stale
17-file count with an explicit assertion of the 21 declared runtime members.
It actually packed and offline-installed the tarball and ran its CLI, not npm
publication or a full device installation.

New immutable local kit: `dist/windows-20261107-installer-recovery/`, ZIP SHA-256
`5c36a43f1c0a1106149fe7c1eb6a2f96055cc55f61eecfb22ec06bd2937ca6d0`.
286 members, no EXE/MSI, verified archive/checksums. Compared with c00c80d9, only
Setup HTML/JS, the guide, bootstrap bin, wake registration, PowerShell wrapper and
their checksum lists changed. No installed extension was replaced/reloaded, no
new tunnel created/bound, no enrollment cutover, and no Windows release or Store
submission. The earlier c00c80d9 package is retained, not silently relabeled.

Open installer limits remain: restricted CMD-safe ASCII paths, version-only Node
selection (npm/architecture capability check incomplete), and no complete
ownership-checked browser-managed removal. The guide discloses these rather than
claiming a universal one-command installation. Native-runtime CI now includes
the recovery tests, but no new remote workflow run is claimed.

### Current Cutover and Browser Package (2026-11-07 04:15 UTC)

The old owner's protected state has now been independently reconciled through
the existing authorized owner PowerShell channel, used read-only without changing
that production connection. Selected SID and native administrator role matched.
Fresh readback found persisted pause, no outer/inner leases, zero demand-task
instances and the matching fce5367c Job terminal: drained, root exit observed 0,
inner leases clear. The pending d53ca6b5 operation is not recorded beneath its
verified state directory. A missing receipt-directory initially produced a
conservative false from a file-only absence helper; typed readback resolved that
ambiguity. Do not misreport it as execution. The old approval was not clicked.

The new b7 protected ProbeLocal started/result pair was also independently read
under its sealed ACLs. Identity matched; complete/ok, files, state, clean launch
and administrator child are true, diagnostic none; persisted pause remains true,
secret vault absent, no tunnel or registration change. This does not replace
hosted browser acceptance with a call through the existing production channel.

The owner-loaded unpacked preview still contains older frontend bytes. A new
local `2.2.1 Windows device preview` kit includes current device controls and the
exact published 2.2.1 scheduler adapter. Its source/bridge compatibility review
found no material mismatch with b7; 98 targeted tests and five kit tests passed.
Current kit is `dist/windows-20261107-preview-delivery-reviewed/`, ZIP SHA-256
`c00c80d975403f30cd2a36f77e6a6afc9c0c7964c70756271a704d5ac6b31cbf`.
It has 286 members and no EXE/MSI. The earlier `34e1d669` kit is preserved;
only START-HERE and the outer checksum list changed in the current kit.
No installed extension was replaced or reloaded. Loading a new unpacked path
can change its origin: obtain the actual displayed ID before enrollment.

Complete-kit delivery is required: standalone install.ps1 would seek Windows
assets absent from the scheduler-only v2.2.1 release. The guide now states this,
ordinary-account versus unfinished administrator setup, historical-test limits,
private tunnel versus public extension distribution, and the official 120-second
request deadline. These are not claims of hosted acceptance or Windows release.

An owner-only `AgentContinue Windows B7 Acceptance` tunnel form is prepared in
IAB with the same verified organization/workspace; Create has not been pressed.
The specific creation/binding/connection and test-chat scope confirmation is
pending. Do not assume that confirmation or use a different channel to bypass it.
No new binding or singleton cutover yet. Next is that private endpoint, protected
binding, deliberate old browser enrollment retirement, actual origin readback,
then ordinary ChatGPT before Dot file/shell/process, reopen, pause and revocation.
Keep the goal active; do not rerun first acceptance or replay old approval.

The [packaged provider A/B checkpoint](RUNTIME-ACCEPTANCE.md#windows-failed-owner-inspection-and-packaged-provider-ab-2026-11-06)
records failed preview `928f47d9` and replacement `1c42e8b5` passing the
same offline slash-form initialize that the old ZIP failed. The replacement
is protected-staged and its local elevated child and paused dedicated
binding were verified. `928f47d9` was revoked and its enrollment retired;
independent readback found its registry, task folder and reservation
absent, with all six original evidence hashes unchanged. Do not clear
those files or reconnect either retired digest (`e8a56275`, `928f47d9`).
The exact Chrome preview origin is now registered to `1c42e8b5`; readback
found one enabled demand task, zero instances, and persistent pause.
The [first live Ready and protected pause](RUNTIME-ACCEPTANCE.md#first-live-ready-and-protected-pause-on-1c42e8b5-2026-11-06)
are now verified for this registration. The ordinary ChatGPT test hit
the single-use approval card with no command admission. The same
generation was drained with exit 0 and released its leases; the
candidate is paused again. No browser reopen or new command receipt yet.
The [protected recovery stage and native Job regression](RUNTIME-ACCEPTANCE.md#protected-recovery-staging-and-native-job-regression-2026-11-07-utc)
verified `849fc3ed` on disk without preparing its state, binding it,
registering it, or activating it. The actual Windows Job broker recovered
from a simulated post-Ready transport exit in a disposable test: two
distinct Ready generations, drained Jobs, no residual leases or operation
replay, and saved pause still denied wake. Chrome reopen is a separate
unverified step.

The [next protected-child and device-page checkpoint](RUNTIME-ACCEPTANCE.md#protected-recovery-child-and-separate-browser-controls-2026-11-07-utc)
subsequently prepared the paused state and verified the installed
administrator child on `849fc3ed`. No tunnel binding, browser registration
or activation was made. Devices now labels the standard and administrator
controls separately; standard pause does not shut down the administrator
owner. The [Pause receipt checkpoint](RUNTIME-ACCEPTANCE.md#administrator-pause-operation-receipts-2026-11-07-utc)
adds durable local operation IDs, exact Job settlement, and a read-only
Devices lookup. No installed runtime or Chrome grant changed. The new
Windows browser ZIP is an unpublished preview, not a cutover.

The [browser-requested administrator Pause candidate](RUNTIME-ACCEPTANCE.md#browser-requested-administrator-pause-candidate-2026-11-07-utc)
adds a separate Devices button, one persisted operation ID, and fixed local
Windows authorization. The actual medium-token preflight uncovered and fixed
a native `TokenElevation` buffer-length error. Both candidates were rebuilt
without changing the preview manifest, then verified offline; neither was
installed. This earlier candidate is superseded by the
[browser Pause target and reconciliation checkpoint](RUNTIME-ACCEPTANCE.md#browser-pause-target-and-reconciliation-2026-11-07-utc).

The [live cutover preflight](RUNTIME-ACCEPTANCE.md#live-cutover-preflight-for-the-pause-fence-candidate-2026-11-07-utc)
verified the three artifact pins and the administrator ZIP layout. The shell
was not elevated, the new `f443794a` first-stage paths were not observed, and
the live preview host still points to `1c42e8b5`. The old one-time web
approval remains pending and is not an acceptance result. The next step
is local acceptance under a real elevated owner token; it does not start
a tunnel or change Chrome registration.
The new candidate closes the delayed-generation and lost-request paths in
source and disposable tests. It has not been staged or enrolled. Next use
the reviewed candidate and its exact companion stager to exercise real
Windows cancellation, consent and receipt readback against the test owner.
A native launch is not a stopped receipt. Keep the pending ordinary ChatGPT
operation unchanged and check its receipt before another submission.

For the next hosted administrator command, use the
[v2 child-token probe](RUNTIME-ACCEPTANCE.md#hosted-command-child-token-witness-v2-2026-11-07-utc).
It requires the real PowerShell child's token elevation, High integrity
and enabled role, with PID and marker readback. The standard-child denial
and same-ID replay fence passed through the real pinned provider offline;
this is not a positive elevated or web acceptance result.

Use the [stdio sequential-request candidate](RUNTIME-ACCEPTANCE.md#sequential-windows-tool-requests-under-stdout-backpressure-2026-11-07-utc)
`b7c53d97` for the next Windows administrator local acceptance. It replaces
`245adc3e` for new tests, not the currently registered owner. It preserves
the SDK handler Pause/Revoke checks and fixes sequential wire-ID reuse in
both ordinary and administrator modes. All 59 targeted Windows tests and
the extracted-bundle offline smoke passed. The preview and stager bytes
are unchanged. Inspect still found an ordinary caller, no candidate
footprint and Chrome registered to `1c42e8b5`. The next action is the pinned
native `AcceptLocal` probe for the selected Windows account, then live
ordinary ChatGPT before Dot. Do not repeat the previous pending web operation.

Release automation's provenance and create-only checks are now on main and
passed during the actual `v2.2.1` GitHub release.
It requires a full checkout of the exact version tag, whose commit must lie
on the first-parent line of `origin/main`. A merged side-branch commit does
not qualify as a release source. A paginated authenticated listing must
confirm there is no existing draft or published release; an API failure
stops without a write. No automatic upload overwrite or draft promotion
remains. Seven source/workflow tests and eleven package tests passed. The
current Windows preview was refused as a stable Store package.

This is a workflow check and successful release run, not a repository tag ruleset.
Before public device delivery, explicitly review the approved runtime and
documentation payload rather than relying only on manifest permissions,
and verify the exact uploaded installer on Windows. The release builder now
stamps its PowerShell entry with the manifest version's download path before
computing inner and outer checksums. The source checkout keeps the latest
default, and explicit payload overrides remain deliberate development
options. A stamped script also refuses unchecked adjacent payloads when
the checksum list is absent, unless explicitly overridden.
Five pin/default tests, the two extracted-setup tests on Windows,
and seven release-source tests passed. Generated local setup candidate
`9db0e3f1` in `dist/setup-20261107-stamped-closure/` replaces `1991b444`,
contains 48 entries and no custom EXE/MSI; its standalone script is
`90c930b8`. This candidate follows the current unshipped 2.2.0
manifest and must not replace the existing public version. Keep the live
administrator acceptance gate above. No tag, push, GitHub Release,
Chrome Web Store submission, or device mutation was made here.

Start with the [live preview enrollment checkpoint](RUNTIME-ACCEPTANCE.md#windows-preview-identity-and-live-enrollment-diagnosis-2026-11-06)
and the [hosted acceptance record](RUNTIME-ACCEPTANCE.md#windows-protected-product-owner-checkpoint-2026-11-06-utc).
The [protected Connect and Pause candidate](RUNTIME-ACCEPTANCE.md#windows-protected-connect-and-pause-candidate-2026-11-06-utc)
wires the explicit elevated stager actions to protected state. Enrollment
leaves the owner paused; browser wake can restore saved running intent but
cannot set it. The [live Scheduler witness and candidate staging](RUNTIME-ACCEPTANCE.md#windows-live-scheduler-demand-witness-2026-11-06-utc)
now verify actual Scheduler demand from a medium token, a same-SID elevated
action, and protected staging plus the candidate's local elevated child.
The [paused acceptance binding](RUNTIME-ACCEPTANCE.md#windows-paused-acceptance-binding-and-browser-preview-2026-11-06-utc)
is now verified for the same digest. The 2.2.0 test preview's exact ID is
enrolled on Windows and the registration was independently read back.
The candidate remains paused. A live Chrome check received a valid
administrator bridge response with runtime readiness unobserved. Hosted
administrator tools have not run from this installation. It has not
been published.
Dual-surface protected reads and a local elevated-child receipt are verified
separately. A later [ordinary ChatGPT hosted administrator proof](RUNTIME-ACCEPTANCE.md#ordinary-chatgpt-live-administrator-proof-2026-11-06)
was admitted and correlated to the selected Windows account, a high-integrity
administrator child, and a disposable file write/read marker. It used the
bounded maintainer window, not the enrolled preview's browser-managed owner.
Dot administrator execution and the full hosted lifecycle remain unverified.
The new owner bundle and grant are candidate-only. The [revocation candidate](RUNTIME-ACCEPTANCE.md#windows-administrator-revocation-candidate-2026-11-06-utc)
adds a local deny marker, a per-call guard, and an owned stop attempt. The
[managed owner Job](RUNTIME-ACCEPTANCE.md#windows-managed-owner-job-checkpoint-2026-11-06-utc)
now has real Windows descendant-shutdown evidence and a fixed maintainer
entry. Generation-bound readiness passed a local Job fixture. A separate
administrator bridge now has a real Chromium reopen and readback test against
a disposable, non-elevating native host. The protected create-only enrollment
and fixed demand launcher are implemented and packaged. Real COM definition,
Windows AccessCheck and a clean PowerShell child passed. Real elevated
registration and Scheduler Run passed for a disposable inert task. The
preview's actual Chrome host and demand task were registered. Its first
live Connect saved intent and requested the task, but the task exited before
readiness. See the [fixed Windows demand candidate](RUNTIME-ACCEPTANCE.md#browser-managed-launch-failure-and-demand-fix-2026-11-06)
for the clean-environment failure and corrected artifact.

Next:

1. Preserve the paused `1c42e8b5` registration and the original pending
   ordinary ChatGPT operation. Recheck the exact receipt before any
   authorized retry, require a fresh Ready generation before approval, and
   never approve or replay an operation with unknown execution status.
2. In ordinary ChatGPT first and Dot separately, capture matching local receipts
   for elevated PowerShell (actual command-child token), file write/readback,
   and managed process start/query/stop through the official tunnel.
3. Move the staged recovery candidate to live browser testing only via a
   deliberate protected cutover. Prove the old generation is gone before
   reopening a disposable Chrome profile, then require a distinct Ready
   generation without Connect. Verify persisted pause, live revocation and
   rejection after revocation. Do not edit sealed files or replace the Store
   extension during acceptance.
4. Complete the browser-initiated, native-consent Pause described in
   [the control design](DEVICE-CONTROL.md#administrator-browser-pause-design).
   The local tracked action and browser receipt lookup already exist in
   source; the extension cannot yet start the administrator Pause. Keep
   explicit administrator reconnect and revocation distinct from wake,
   ordinary-device pause, and browser-permission removal.

Deliver from a single canonical `main` after real Windows acceptance. Use the
same version for GitHub Release and Chrome Web Store; review submission and
public availability are different states. Keep English the default, retain
Simplified Chinese, and keep the public listing in English with developer
contact, GitHub Issues guidance for redacted logs, and the author's LinkedIn.
Linux (direct from each research host, not through Windows), macOS, and the
research feedback loop follow Windows. For the latter, use durable run IDs,
bounded resources and checkpoints, and verify a real failure-to-fix-to-rerun
handoff between a CLI executor and ordinary ChatGPT or Dot.

## Windows command-only delivery (current)

The owner replaced the signed project launcher requirement with a Node-first
command install. The verified upstream models are
[Desktop Commander remote launchers](https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/main/scripts/remote/README.md)
and [OpenAI Secure MCP Tunnel](https://github.com/openai/tunnel-client). We
reuse their separation of terminal bootstrap, runtime, and ChatGPT grants
without using Desktop Commander's hosted remote relay or piping a mutable
download directly into a shell.

The extension guides the user through exporting the request, informed consent,
and choosing Node, PowerShell, or CMD. Existing Node is preferred; PowerShell
can provision a pinned, hash-checked portable Node ZIP when necessary. The
default npm/ZIP package never includes a project EXE and does not compile or
register a Chrome host. Node runs the installation directly. The advanced CMD
entry forwards to installed Node, and the guided CMD and PowerShell entries
share the same interactive consent and portable-Node bootstrap. A tunnel/key-file pair
requests one official-tunnel connection; no pair stages without starting.
Command status, pause, and reconnect use authenticated local IPC. PowerShell
can reuse the verified portable cache without downloading on control calls.

The Windows plan and browser now generate the same commands from the
validated extension ID. Neither recommends downloading and executing a script
from a mutable latest-release URL or bypassing PowerShell policy. The native
registration and login options described by the engineering plan are not
performed by these commands. Local macOS and Linux install buttons no longer
advertise an unpublished npm package; the separately labeled Linux server
source handoff remains available.

Use the Windows extension preview and setup ZIP from the same candidate. The
setup ZIP now uses fixed member order, timestamps and modes, and hashes the
exact payload bytes it writes. Rebuilding from identical staged inputs with
the same compression toolchain yields the same digest; this does not establish
GitHub provenance, Chrome approval, or a hosted account grant.

The paired distribution is now one `agent-continue-windows-preview-kit.zip`
plus an external `.zip.sha256` file. It contains the already-unpacked
`AgentContinue/` and `WindowsSetup/` directories, a bilingual
`START-HERE.md`, and a manifest of member hashes. Build it with
`python scripts/build-windows-preview-kit.py --output dist/windows-preview-kit`.
The Windows native workflow prepares the reviewed vendor resources, checks
the kit, and runs the packaged Chromium fixture against those exact ZIP
bytes before uploading the pair as a main-branch Actions artifact. This is
not a GitHub Release or Store package; remote CI upload is not yet observed.

On Windows x64, the extracted command package passed a PowerShell 5.1 run
with only an incompatible Node on the child process PATH. It downloaded and
verified the official portable Node, then staged the local manager without a
tunnel or native registration. The regressions also cover refusal without
consent, checksum failure before provisioning, and removal of failed download
staging files. The network-backed check is enabled with
`AGENT_CONTINUE_TEST_PORTABLE_INSTALL=1` in `tests/setup-release-tests.py`.

The Windows packaged-manager regression stages the actual provider and the
hash-pinned official v0.0.19 client from the command package, then exercises
the shipped `manager-control` command over the owner's local named pipe. With
a synthetic key and a loopback-only mock control plane, it verifies a file
write/read round trip, confirms no polling while paused, repeats the round
trip after reconnect, and confirms the owned MCP child exits on pause. The
fixture overrides the control plane only in its injected test spawn and
checks the installed profile remains unchanged. The Windows CI job runs this
fixture without a platform key. A separate guided-installer fixture now covers
the automatic owner start from the extracted PowerShell package and its first
connection, pause, and retry against a simulated control plane. Neither fixture
verifies hosted OpenAI authentication, Chrome native messaging installation,
or ChatGPT/Dot authorization. See [acceptance evidence](RUNTIME-ACCEPTANCE.md#windows-hosted-acceptance).

The original Microsoft review and signing sections below are historical.
Native Chrome control of already registered installations is separate.
Command delivery still needs acceptance using an actual scoped tunnel and one
matched benign call each in ordinary ChatGPT and Dot. No production changes
or release occurred in this checkpoint.

## Windows browser setup readback

The setup page now shares the Devices response decoder. One explicit Windows
check, after a fresh Chrome permission read, sends one status request. A
matching response is required to display registration and local runtime
readiness. A failure clears the previous observation; only Chrome's explicit
host-not-found response reports an undetected host. Permission changes or
switching the install platform discard any in-flight result. The check never
requests permission or sends a lifecycle command; Devices remains the route
for permission, pause and reconnect. The top-level chat authorization remains
unverified.

Browser fixture coverage reproduces the original wrong-ID acceptance and
tests valid, unrelated, rejected, host-absent and transport responses, plus
revocation during a pending request. This verifies the readback logic, not a
native installation or a tool call. See RUNTIME-ACCEPTANCE.md for the actual
Microsoft case and signing gates.

## Installer reconnect recovery

The bootstrap now reserves a single installer reconnect ID in the verified
installation's private state before sending the reconnect. It creates the
receipt exclusively, flushes it, and checks it before dispatch. A separate CLI
process, including a retry after lost output, reuses the receipt only for a
status query. It does not replay reconnect or start a replacement owner on that
path. Malformed or partial records are retained and refuse rather than permit
a new ID. This is a process-interruption recovery mechanism, not a guarantee
against power loss, external state edits, or all possible filesystem failures.

`manager-status --install-dir <same-root>` queries the original ID using existing
authenticated IPC. Its response separates current connection/pause from the
operation's journal status. Windows PowerShell and npm preserve the original
ID and bounded status on a structured nonzero result. If even the outer
process output is lost, use the status command against the same root rather
than reinstalling. Normal user-initiated reconnect and pause through Devices
are unchanged.

The real local IPC test uses a synthetic controller, simulates loss of the
first reconnect reply, races independent CLI invocations and observes one
dispatch. It then queries the original ID, checks that a later manual pause
is preserved, and verifies that an absent owner is not replaced. This does
not establish a signed installation, authenticated OpenAI tunnel, browser
native messaging, or ChatGPT/Dot tool acceptance. No production service or
host was changed, and this code is not a public release.

## Current Microsoft and offline-recovery update (November 4, 23:19 Chicago)

The existing Microsoft case now has analyst comments reporting no positive
scan result or telemetry indicators for the submitted sample, and an intended
closure with no further action. Readback was still overall `In progress`,
complete-EXE final determination `Pending`, current Cloud/Client detection
`No malware detected` (client definition `1.463.132.0`); extracted subentries
were mixed. Do not claim final EXE determination, a resolved old-wrapper false
positive, trusted signing or runtime acceptance. No second submission/Rescan,
diagnostic-CAB upload, protection change or EXE execution was performed.
See the in-place RUNTIME-ACCEPTANCE.md update and ignored local analyst evidence.

Confirmed installer defect: a standalone `install.ps1 -Uninstall` could invoke
Node and make a payload download even though the command is a dry-run check.
An actual Windows fixture reproduced one request to its local refusal server.
The current source requires adjacent local `bin.mjs` and payload verification
before Node resolution, returning `uninstall_inspection_unavailable` when the
local inspection bundle is missing. It rejects mixed uninstall/verify/mutation
modes before effects. It does not fetch a replacement, install Node or remove
files. Local complete-package inspection still follows the existing dry-run
contract; this is not an implemented automatic uninstaller.

The first root npm/package/installer checks passed 6/6, including the new standalone
offline fixture with both installed and missing Node and the existing partial
installation preservation check. That fixture's request counter is zero after
the fix, its private temp/toolchain directories remain empty, and the partial
install sentinel is unchanged. A separate read-only review of owner teardown
found no safe automatic removal contract yet: owner.close drains device-control
handlers, not arbitrary MCP tool work, can cut replies after durable mutation,
and channel disappearance or resolved close is not proof that all work/fences
were cleanly released. Do not use force-kill/stale-lock deletion as uninstall.
Future execution needs an install/generation-bound passive shutdown handshake,
unsettled-journal refusal, workload settlement evidence and verified completion
before registration/files are removed. No production process was inspected or
stopped to obtain this source finding.

The follow-up cold review identified and closed related response/digest defects.
The release checksum list must cover the exact adjacent `bin.mjs` that Node will
execute; case-folded path spelling alone is insufficient on a case-sensitive
directory. Equivalent normal `bin.mjs`, `.\bin.mjs`, `./bin.mjs` and `BIN.MJS`
spellings remain covered for both normal planning and uninstall. The missing
inspection diagnostic now precedes install-root defaults and architecture checks.
Before reporting a successful dry-run, the wrapper verifies the bounded JSON's
exact field names/case, scalar types, matching root/paths, ordered actions and
conservative pending states. Banners, false success output, wrong targets,
arrays and wrong-case keys do not become `ok:true` receipts.

Fresh final root package/installer checks pass 9/9, no skips/failures; extracted
source ZIP checks 2/2; signed-release entry/refusal plus signing/parser/cleanup
checks 8/8. The broader native-release suite passed 46/46 earlier in this turn,
before the final shared-checksum corrections; do not call that an unchanged-byte
final rerun. The case-sensitive-name regression models distinct hash observations
in an owned script copy, not actual NTFS policy changes. Actual PS5.1 fixtures
cover no-launch sentinel, loopback zero-acquisition, partial data preservation
and valid/invalid replies. Bounded current-byte independent re-review found no
remaining P1/P2 blocker in the corrected scope; not a full-product safety claim.

Then-outstanding installer recovery gap: start-manager created an inline reconnect
UUID and loses it in an unconfirmed result. The current code sends at most one
reconnect per invocation and does not auto-replay it, but a caller cannot query
that same operation from its generic failure receipt. Preserve the ID durably
before sending and surface it for reconciliation in a future coherent change;
do not restart/reclaim the owner or regenerate a command merely after timeout.
The installer recovery update above supersedes this source gap.
These changes remain source-only and do not alter the submitted EXE/runtime pins.
No source push, release, store submission or installed-runtime change occurred.

## Microsoft submission receipt (November 4, 22:37 Chicago)

The scoped personal-account login and explicitly approved sample submission
succeeded in the in-app browser. Microsoft Security Intelligence case
[`69df7c33-0f86-475c-a549-232aeba1eb56`](https://www.microsoft.com/en-us/wdsi/submission/69df7c33-0f86-475c-a549-232aeba1eb56)
is `Submitted`; the portal time is `Nov 4, 2026 10:36:02 PM`. Final determination
and Cloud/Client detection were `Pending`, with no analyst comments. Continue
with this case; do not create a duplicate or treat its receipt as clearance.

The single sample is `native-launcher-unsigned.exe`, 23,552 bytes, product
`Agent Continue`, file version `0.3.0.0`, `NotSigned`, local SHA-256
`5d055415dcefe59e37f57952bd447807a934d171cb8662b692d9d9cde0782734`.
One cold-reviewed maintainer compile succeeded; temporary cleanup completed.
The EXE was never run, installed, registered or signed. The targeted scan has
matching start/end events and no fresh detection in that observation, not a
vendor determination. The reviewed submission statement explicitly separates
this new hash from prior detections of different wrappers. Remote sample SHA
was not visible, so do not claim remote byte equality. Only the EXE and developer
statement were submitted; no credentials, chat, device logs or project bundle.

Evidence remains local in ignored `.artifacts/windows-security-review-9b7fc877b0344a2aa91286ffffe7a332/`.
Keep `review-evidence.json` as the pre-upload historical snapshot; use
`microsoft-submission-receipt.json` for the later submission state. No signing
identity has been obtained/enrolled and no signing application accepted.
The bootstrap README now documents a source-reviewed, explicitly untested
manual uninstall sequence; an automatic uninstaller is still not implemented.
This checkpoint does not change production VPN/MCP/IDE/research or relax
protection. It is not a GitHub commit/push, npm/store publication or release.
The existing Windows-first goal remains active with its original objective.

## Local installer integration checkpoint (November 4)

Latest local regression receipts: native-release policy/preparer/snapshot suite
46/46; actual root npm tarball and Windows failure/recovery suite 5/5; freshly
built/extracted source installer ZIP suite 2/2; combined
setup/profile/install-plan suite 85 pass and one genuine-Linux-only skip; combined
bootstrap/packed/release/signing suite 56 pass and one opt-in real-provider skip
(before the final packaging-review corrections). The full root npm test command
also exited zero after those corrections, including synthetic UI 15/15, actual
isolated MV3 extension fixtures 11/11 and ProseMirror MV3 fixtures 5/5. These are
not real account, production extension, valid project signature or ChatGPT/Dot
tool-call acceptance. No commit, push, store submission or release was performed.

Current trust/profile corrections: the preparer loads only its adjacent canonical
native-publishers.json, verifies a SHA-256 literal in code, and requires candidate
signer membership plus a valid timestamped Authenticode signature. The trusted
list is deliberately empty: no project signing identity has been obtained or
enrolled. The candidate release policy cannot authorize its own signer. Source
packaging checks the independent source policy and its own matching fixed digest,
but does not verify Authenticode. This closes a second-review finding: previously
an edited source policy could produce a package that the unchanged preparer
would reject. An isolated unchanged-packager fixture reproduced that gap before
the fix and now rejects substituted policy bytes even with no release assets.
The old per-user builder and C# source are excluded from npm/ZIP delivery; they
remain repository sources only. No signing-key material is packaged.

Root npm packaging now includes only generated packaged-native-release bytes
copied from the completed validated build stage; it no longer includes the live
original native-release directory. Stale or unexpected generated entries refuse
without deletion, including an old release when the current stage has none.
Source ZIP packaging continues to archive its private validated stage. This
addresses the reviewed original-input race, not an attacker changing generated
output or arbitrary source files after prepack. Keep release workspaces and
generated directories maintainer-owned. Installer selection prefers the fixed
generated entry when present and refuses invalid entries rather than silently
falling back to a source release. No caller/environment path override was added.

The Windows tunnel setup now writes a strict v2 profile binding marked
hostRuntime=install-private. Both the external setup interpreter and the private
owner regenerate the same fixed INSTALL/runtime/node.exe command. This resolves
the reviewed path mismatch that would otherwise fail after native registration.
Legacy v1 bindings are unchanged. The fixture checks before/after an inert private
Node file appears, not a real signed launcher or authenticated tunnel. Independent
bounded source re-review found the original mismatch resolved; it is not runtime
acceptance. The packed CLI help test was also updated for start-manager, whose
source command already existed; the actual local tarball check then passed.

SignPath application and terms were inspected read-only in the in-app browser.
No form fields, legal consent, CAPTCHA or application were submitted. Their
requirements include a maintained OSS release in the form to be signed,
reputation/provenance, uninstall instructions, team MFA and release approvals.
At that earlier checkpoint the new native artifact was not built/released;
the later one-EXE review build above supersedes only its build status.
Automatic uninstall is still dry-run, with manual instructions now documented;
do not claim the project has been accepted or add a sponsorship badge. Microsoft
developer review and identity-validated signing remain legitimate alternatives,
not permissions to restore quarantine or disable protection.

Latest source migration: Windows InstallLocal/PrepareNative no longer invokes the
per-user C# builder. It preflights the vendor release before Node provisioning or
provider/state creation, consumes Prepare-ReleaseNative.ps1, stages the fixed
private runtime and then uses that Node for registration/start. Missing assets
stop with native_release_unavailable; no compile/protection bypass fallback.
The npm CLI no longer forces its own Node as the release-pinned runtime.
PACKAGE_FILES, npm files and setup ZIP include the consumer. Optional native
assets are snapshotted only from the two declared files per architecture; stale
payload/binary pins, duplicate/unknown policy fields and extra/linked files reject.
These are local source changes, not a signed release, deployed installation or
browser/tunnel acceptance. See RUNTIME-ACCEPTANCE.md for the exact policy contract.

Latest independent-review corrections: the reusable binding selects strict UTF-8
instead of the framework's auto-detect overload; the maintainer builder rejects
non-fixed output drives before compiling, attempts all cleanup steps, and emits
one final failure receipt if cleanup is incomplete. Actual PS5.1 parser tests,
inert-file cleanup tests, injected plan-cleanup failure, read-only release plan
and signing refusal suite pass 6/6. This is not C# executable/signature acceptance.

Extracted setup ZIP correction: embed the payload-only SHA256SUMS.txt rather than
leaving hashes only outside the archive. Actual extracted PS5.1 plan checks all
41 payload files, rejects tampered runtime bytes, and creates no install root
(setup-release suite 2/2). Explicit PSHOME Utility/Archive imports address the
PS7-parent module-path mismatch. Included hashes are not publisher authentication.

Manager observation deadline correction: sendDeviceRequest accepts a bounded
whole-request timeout and start-manager passes its remaining 10-second status
budget. A silent test endpoint closes only the caller's socket on expiry,
retaining the descriptor and server. Fixture startup verifies deadline use,
single owner, explicit synthetic readiness and unknown pause refusal. Combined
device-setup/device-owner suite: 79 tests, 78 pass, one genuine-Linux-only skip.
Root npm package suite: 5/5. Explicit reconnect/download/provider work is not
covered by this status deadline. No production process/registration was changed.

Signing remediation: user authorized legitimate signing avenues. No usable local
code-signing certificate was found. Added maintainer-only Sign-WindowsRelease.ps1
with read-only default, expected input hash, explicit accept-sign, create-only
signed copy, explicit CurrentUser certificate/timestamp and Authenticode readback.
At that source-only checkpoint no certificate/trust changes, private-key exports,
generated launcher build/run, sample upload or project signing occurred. The
later review-only build and sample submission above supersede those two facts,
not the execution/signing/protection limits. The initial PS5.1 plan/refusal checks passed;
11 generated-EXE tests stay skipped. See RUNTIME-ACCEPTANCE.md for reviewed
Microsoft submission/Artifact Signing and SignPath requirements. Also corrected
the false PE-only/signing-only claims after actual Chromium source inspection.
Reusable launcher source candidate now added: ReleaseLauncherBinding.cs plus
maintainer Build-ReleaseNativeLauncher.ps1 with read-only default. Fixed relative
Node/host paths, strict framework JSON binding/manifest checks and 17 payload
pins replace compiled user paths/extension identity. No C# compile, EXE run,
signature or deployment yet; the earlier 4/4 source/PS5.1 plan tests were not
executable acceptance. InstallLocal has since moved to the vendor consumer above.
See RUNTIME-ACCEPTANCE.md for remaining ACL/race/dependency/architecture scope.

Recovery/error propagation correction: InstallLocal rejects any existing root
before Node provisioning; partial roots are retained. PowerShell preserves a
closed set of bootstrap errors and redacts unknown exception messages; CLI
retains actionable native/client/npm errors and bounded numeric exit fallbacks.
Timeout/termination still takes precedence as local_install_unconfirmed.
Uninstall remains dry-run: directoryPresent and installationComplete are separate,
registrationObservation is explicit, autostartObservation is not-inspected and
inspectionComplete is false. Unknown registry/autostart steps stay pending;
status process failure refuses with uninstall_inspection_failed rather than
claiming an absent root. No cleanup/registration/process changes were executed.
Independent read-only review identified these recovery defects; implemented
cases passed actual PowerShell 5.1 fixture runs. Root package suite passed 5/5,
pure PowerShell classifiers 20/20, install-plan tests 17/17, bilingual setup UI
20/20 (synthetic browser, not an installed extension or real ChatGPT/Dot).

Manager receipt correction: unknown/null pause state now refuses with
manager_start_unconfirmed instead of being coerced to paused=false. A real-owner
IPC test with a deliberately unobservable synthetic controller verifies default
and explicit-connect refusal, retained channel metadata and one owned process.
That regression and both existing startup/readiness scenarios passed (3/3).

Explicit post-install connection: start-manager accepts --connect true|false;
only InstallLocal with a full tunnel/key-file pair requests true. Key-free
manager startup preserves pause. Reconnect is dispatched once after authenticated
status; only a ready response returns connected=true. An accepted operation with
non-ready state returns manager_start_unconfirmed, with no retry/new owner/lease
cleanup. Concurrent requests with different connection intent refuse to coalesce.
Actual manager fixture tested unconfigured connect rejection, retained paused
state and one owner. Positive readiness now passes through a real spawned owner
and authenticated IPC using a synthetic lifecycle controller (no keys or network).
The five focused manager tests passed, including concurrent startup and refusal
to replace invalid channel metadata. This is not real tunnel acceptance; full native
path remains blocked. Outer installer receipt derives connected from the manager
instead of a constant; this is runtime readiness, not ChatGPT tool authorization.

Windows InstallLocal accepts an optional complete TunnelId/RuntimeKeyFile pair,
also forwarded by root install-local. Partial pairs reject before acquisition.
A pair selects existing setupDevice rather than key-free setupManager, sharing
native preparation/registration/start. Ordinary ManagerOnly rejects tunnel inputs.
Keys remain local file references, not raw argv. Plan checks17/17 and root package
tests4/4 passed; no real key pair/full native installation was exercised. Launcher
classification remains unresolved. No browser key entry, account grant or auto
resume is implied; connected remains false pending independent verification.

Fresh Windows PowerShell5.1 first-install acceptance passed from an empty fixture
ac-node-provision-484d762c93a54477a742cd983039ed0f: actual official download,
archive validation, extraction, Node22.23.4 execution, offline full-tree reuse,
same-length npm corruption rejection and restored-tree verification. The Windows
CI workflow now runs this helper-only acceptance with a five-minute job-step
limit, no native launcher/registration/tunnel. Local result is verified; the
edited remote workflow has not been pushed or observed running on GitHub.

Windows manager startup consolidation: same-process calls for one canonical
install root now join the same pending start and release that reservation on
success or failure. Real process fixture submitted concurrent startup requests,
received equal authenticated paused receipts, then reused the owner; spawn count
remained one. This is NOT cross-process installer serialization: separate CLI
processes still rely on the installed owner's exclusive channel/controller
leases to refuse duplicate ownership. Startup environment strips inherited Node
preload/runtime injection variables and ambient tunnel/OpenAI keys while keeping
ordinary HOME/PATH/proxy settings; source review is not independent approval.
The attempted independent reviewer returned an out-of-credits error, no review.

Windows InstallLocal source now follows successful native registration with
consent-gated start-manager. It revalidates the provider stage, loads the exact
installed binding, reuses an existing authenticated IPC owner, or starts one
detached fixed Node entry with windowsHide=true and shell=false. It waits for an
authenticated status response; timeout is manager_start_unconfirmed, not proof
of exit, and never triggers replacement or lease deletion. Startup preserves
pause and does not infer a connected tunnel. The integrated native-registration
path remains unexecuted because launcher security classification is unresolved.
Direct helper fixture acceptance did start a real owned manager, confirm paused
IPC status and reuse exactly one process; missing consent/extra fields refused
before filesystem access. Test-owned process exited before fixture cleanup.
No production owner, native registration, tunnel or autostart was changed.

Portable Windows Node full-tree closure now supersedes the npm-presence-only
limitation below. Retain the official ZIP under AgentContinueToolchain and check
its fixed release SHA256 on every reuse; compare all archive file lengths and
SHA256 digests with the installed tree, reject extra files/reparse points, then
execute the verified Node version check. Cached ZIP corruption stops reuse,
not an overwrite or silent repair. New helper-only acceptance script
tests/portable-node-acceptance.ps1 ran under Windows PowerShell5.1 against the
owned official x64 fixture: offline reuse passed, a same-length one-byte npm
CLI mutation was rejected before reuse, original bytes were restored in finally,
and the restored full tree passed again. No native registration or tunnel ran.
The cached ZIP costs about30MiB and avoids repeat downloads. Concurrent mutable
same-user tampering is not excluded by these checks; no protected ACL claim.

Portable Windows Node reuse: source now verifies the official per-architecture
node.exe SHA256 before first execution and on reuse, rejects redirected Node/npm
CLI paths and existing executable/version mismatch, and leaves invalid installs
untouched. Windows PowerShell Desktop5.1.26100.9818 helper-only test reused the
prior official x64 fixture twice with Invoke-WebRequest stubbed to fail; both
returned Node22.23.4 without downloading. This supersedes the prior
destination-always-refused note below. Reuse checks npm CLI presence/path only,
not the integrity of the entire npm dependency tree; no protected-install or
all-architecture claim. No native launcher, registration or tunnel execution.

Windows-first continuation: InstallLocal now provisions official portable
Node22.23.4 only after accept-install, when no explicit NodePath was supplied
and discovery found no Node or an old version. The three Windows ZIP SHA256
pins came from the Node official release manifest inspected in IAB. Download
and ZIP digest/path checks precede execution; exact version and npm CLI presence
are checked, then a create-only Directory.Move publishes under current-user
LOCALAPPDATA/AgentContinueToolchain. No global PATH, system Node or elevation
change. Explicit NodePath failures and read-only modes do not provision.
Real x64 helper-only acceptance downloaded and verified the official ZIP,
extracted it and executed Node --version=22.23.4 in temporary LOCALAPPDATA:
C:/Users/zye12/AppData/Local/Temp/ac-node-provision-87d3e60f26d64f22b98cab552c70a156.
No native EXE, registration, manager or tunnel ran. Root package tests4/4 and
PowerShell parse passed. Existing managed destination is currently refused,
not overwritten; reuse/upgrade and 5.1/ARM64/x86 acceptance still require work.

Subsequent real Linux fixture closure supersedes the dependency-timeout status
below: bounded npm ci --ignore-scripts retry succeeded on .15; the complete
four-file lifecycle/owner/server/supervision selection passed90/90 with zero
skips. The same current source then passed90/90 on .18 (system Node22.23.1).
.15 uses the independently installed Node22.23.4, not its unchanged system Node20.
No production service, login hook, real key or authenticated tunnel was used.
Retained .18 test workspace: /tmp/ac-runtime-linux-yzt.LqUQur. The corrected
source-only test archive .artifacts/linux-runtime-tests-20261104-02.tar.gz has
SHA256 01fdf9c7365248ac325cc3c9bf4b7d10dac3513cb92ac06d5da93853278ac3ec;
it includes the root browser-control module and locked provider dependency
metadata omitted from the first archive. npm emitted upstream deprecation
warnings; no audit/upgrade or security clearance is implied by successful ci.

Actual .15 Linux candidate fixture run (Node22.23.4, zye): owner and tunnel
supervision tests passed37/37 after fixing a Unix-only startup failure. Login
recovery runs before listen, so its ownership recheck must use owned(false)
until the socket exists; the post-listen full socket identity check remains.
The first broader run was NOT green: omitted device-control.js/root module
metadata and absent pinned provider caused failures. Root source dependencies
were supplied, but npm ci --ignore-scripts failed EIDLETIMEOUT against
registry.npmjs.org. Provider-dependent lifecycle/server coverage remains
unverified on this host, not a successful install. Test workspace retained at
/tmp/ac-runtime-linux-zye.4KIyou; only source, synthetic fixtures and incomplete
dependency/cache staging, no runtime keys or real tunnel activation. Do not
mistake these loopback/IPC tests for authenticated ChatGPT/Dot acceptance.

Read-only live Linux preflight: zye-15/GauravGupta (zye, x86_64) has default
/usr/bin/node v20.20.2, below the root CLI's declared minimum 22.13.0;
yzt-18/GuanchaoTong (yzt, x86_64) has v22.23.1. CLI dispatch now enforces the
minimum explicitly rather than relying on npm engine warnings. No system Node
upgrade was attempted. df reports .15 /home 100% with approximately 24 GiB free,
while / has 711 GiB and /tmp 2.6 TiB free; .18 / has 77 GiB and /tmp 1.1 TiB free.
Do not stage large provider caches in .15 /home or infer readiness from SSH
reachability. This preflight read no keys, changed no services and installed no
candidate. Plan per-user verified Node selection before .15 candidate execution.

Independent lifecycle follow-up found and corrected two additional races:
async launch preparation now revalidates ownership, generation and disposal
before publishing resume intent or spawning; login recovery finishes before
opening IPC admission. A deterministic deferred-launch regression first failed
(one child spawned after pause), then passed with zero children and persisted
paused=true. Previous fixes preserve the live monitor generation on reconnect
and avoid duplicate login reconnect during persisted recovery. Fresh combined
lifecycle/owner/server/supervision regression: 89 total, 86 pass, 3 platform
skips, zero failures. These are owned fixtures, not deployed server login or
authenticated ChatGPT/Dot acceptance. Install-plan tests: 17/17 after rejecting
root paths inconsistent with the selected platform. No production switch made.

Fresh default regression after precheck and setup-guidance changes: root npm test
exited 0, including 11/11 MV3 fixture integration and 5/5 ProseMirror fixture
scenarios. Bootstrap npm test now includes registry-win.test.mjs and the runtime
precheck suite by default: 240 total, 225 pass, 15 explicit skips, zero failures.
Skipped executable/security/platform/cache acceptance remains unproven. No live
Chrome installation, authenticated tunnel or production registration follows from
these fixture results. Tunnel supervision separately passed 14/14, including an
actual loopback 302 readiness endpoint that was not followed or reported ready.

Read-only Defender revalidation (November 4): Get-MpThreatDetection matched the
owned temporary native launcher on November 3 at 11:08:14 local time and two
owned enrollment import probes at 13:02:26 and 13:03:21. All three report
ActionSuccess=true and ThreatStatusID=4. Get-MpThreat identifies IDs 251873 and
2147940952 as Program:Win32/Contebrew.A!ml and Trojan:Win32/SuspExec.SE;
both currently report IsActive=false and DidThreatExecute=false. These are
provider-reported fields, not a false-positive determination, a complete host
security audit, or permission to execute/distribute the candidate. No restored
file, exclusion, disabled protection or probe replay was used. Setup guidance
now discloses the unresolved launcher release gate in English and Chinese.

Latest local checks: root npm package tests 3/3; setup UI synthetic checks 20/20;
registry/precheck tests 16/16; setup release tests 2/2. Precheck shares structured
registry reads, rejects invalid channel filesystem entries, and explicitly does
not infer owner liveness or tunnel connectivity from channel-file existence.
The source ZIP in .artifacts/setup-candidate-20261104-precheck-fixed predates
the subsequent setup-page warning; it is not a final release or live install.
Next executable acceptance requires legitimate security classification and
release remediation first. Keep both blocked test opt-ins unset.

Independent review follow-up: registration approval/consent now bind both exact
origin and manifest SHA-256, and revalidation rejects changed manifest bytes.
All Windows Apply branches preflight the request identity and recheck setup
receipts. Registry reads use a hidden Windows PowerShell/.NET query with closed
JSON results instead of interpreting localized reg.exe errors; query failures
throw rather than authorizing overwrite. Combined registration/status/guidance,
registry adapter and actual root npm package regression passed 50/50 locally.
The real registry test was read-only against an absent fixture key; no production
native registration or authenticated tunnel was exercised. These changes still
need independent re-review and real browser acceptance before completion claims.

Server CLI now rejects the experimental `resume-login` and `serve-login`
verbs: a caller-supplied ID or CLI mode does not prove an interactive SSH
login and must not override a persistent pause. The supported server verbs
are `serve` and `request`; an explicit reconnect remains available. A later
login hook needs verified OS evidence and must resume only an eligible
temporary pause, not a persistent pause. No SSH hook was installed.

Server requests now return a nonzero process exit for an authenticated
`ok:false` receipt. The SSH adapter already treats nonzero/unknown exits as
unavailable, never success or automatic replay. Its regression plus operation
journal tests passed 33/33 locally. Tunnel supervision is now included in the
runtime's default npm test command rather than relying on manual execution.

The legacy desktop owner has an explicit `--resume-on-login` CLI mode, backed
by `startDeviceOwner(..., {resumeOnLogin:true})`. The server API refuses this
option.
Normal startup preserves a paused intent; a persisted unpaused intent already
triggers lifecycle restart recovery. Status without an owner starts nothing.
The explicit login mode may clear a paused intent. The explicit mode
calls the existing reconnect once after ownership and IPC are established; a
failure follows normal owner cleanup. Its controller test passes, but no OS
login hook has been installed and no real login recovery is claimed. Never add
the flag to generic status probes or ordinary browser-native launches.

Windows `install.ps1 -InstallLocal -Consent accept-install -SetupRequest <file>`
now combines key-free manager preparation, GUI native-launcher compilation and
explicit HKCU registration. It derives the actual extension ID from a closed
Windows request. The lower-level ManagerOnly/PrepareNative/RegisterNative modes
remain available for diagnosis. This source path has not been registered against
the owner's candidate Chrome extension or authenticated in ChatGPT/Dot.

`scripts/build-setup-release.py` produces a standalone ZIP and matching SHA list;
`tests/setup-release-tests.py` verifies extracted contents and CLI behavior. Both
ZIP and bootstrap npm closures now include installer entries and registration
dependencies, including install-plan.mjs. The release workflow is wired to upload
these assets, but these local changes have not been pushed or remotely executed.
The setup page exposes the reviewed Windows source command only after consent;
its ordinary generated command is correctly labeled read-only preflight.

Do not present local package/test success as registration, tunnel authentication,
OS elevation, login recovery, or a real ChatGPT/Dot tool-call receipt. The real
candidate extension ID/version/load directory remains needed for browser binding.

Current continuation: November 4, 2026, Asia/Shanghai. The owner's latest direct
instruction resumes AgentContinue research/design and development. The earlier
usage-limit pause below describes the sealed handoff checkpoint, not a current
blanket prohibition. This does not resume unrelated projects or authorize
production installation, credential changes, new resident services or elevation.

Historical handoff checkpoint: November 3, 2026, America/Chicago. Development was
paused while existing work was synchronized and packaged. The sealed VERIFIED
archives retain that original snapshot and must not be rewritten.

Current work includes source/test operation receipts and a real local IPC/native
message bridge, not a deployed or registered native host. See
[the integration design and current evidence](DEVICE-CONTROL.md#active-sourcetest-slice--owner-goal-continue)
before continuing installation integration. The owner explicitly requested
`/goal continue`; the original goal now reads active and source/test integration
continues under that architecture. The already requested Windows interactive-login
/ Linux interactive-SSH resume behavior is retained, not reopened as an unanswered
requirement. Native registration, production activation and new resident services
are not implied.

### One-click install implementation — 2026-11-04 (round 2, uncommitted)

HEAD stays `550a8a3`; nothing committed or pushed. What changed this round:

- New `native/bootstrap/install-plan.mjs` (pure planner: no fs, no registry, no
  network) + `install-plan.test.mjs` (14 tests). One plan drives the setup page,
  the PowerShell script and the CLI, so step order/copy cannot drift. Windows
  plan = `preflight → verify-payload → stage → write-manifest → register-hkcu →
  autostart → verify`, all under HKCU, `elevation:false`.
- New `native/bootstrap/install.ps1`: read-only plan by default; `-Verify`,
  `-Uninstall` (dry-run only), `-Apply` (needs `-Consent accept-install` plus
  setup-request/tunnel-id/key-file); script-level `try/finally` restores PATH +
  TLS, trap maps failures to `agent_continue_install_failed`; `Get-FileHash`
  against `SHA256SUMS.txt`; no `-Verb RunAs`, no `reg add`, no `HKLM`. When the
  `irm` one-liner has no `bin.mjs` beside it, `Resolve-Payload` fetches
  `agent-continue-setup.zip` + `SHA256SUMS.txt` into `$script:acTemp`, digest-
  checks the archive, expands it, and `finally` deletes the directory.
- `native/bootstrap/install.cmd` forwards every argument to `install.ps1` and
  preserves the exit code (no elevation, no registry write).
- `cli.mjs` is the npm `bin` (`npx agent-continue setup`): prints the read-only
  plan and the per-OS command; every other subcommand delegates to `bin.mjs`.
  `bin.mjs` gained `install-plan` and `uninstall` (uninstall is always
  `dryRun:true`).
- `setup.js`/`setup.html`: install panel with an OS switch that is independent
  of the setup target (so switching OS no longer rewrites an open review),
  command + copy (clipboard, then `execCommand` fallback), an explicit consent
  checkbox persisted to `chrome.storage.local`, "I ran it — check now" detection
  (tester bridge → one native frame, 3 × 2 s), and a management panel showing
  registered / host startable / connection. `connectNative` is only attempted
  after `permissions.contains({permissions:['nativeMessaging']})`; a missing
  permission reports `unknown`, never `host-missing`.
- POSIX entries now point at `npx --yes agent-continue@latest setup` instead of a
  non-existent `install.sh` asset.

Verification (commands run in this round, all local, no install, no registry):

- `node native/bootstrap/install-plan.test.mjs` → 14 pass / 0 fail.
- `[Parser]::ParseFile` on `install.ps1` → `parseErrors=0`.
- `powershell -File install.ps1 -ExtensionId <32 a's>` → `action:plan`,
  `elevation:"none"`, `node:"24.16.0"`, `payloadChecked:0` (no local
  `SHA256SUMS.txt` yet), `%TEMP%` gained no directory.
- `powershell -File install.ps1 -Uninstall` → `action:uninstall`,
  `dryRun:true`, `owned:false`, `unregister.state:satisfied`.
- `powershell -File install.ps1 -Verify` → `action:verify`,
  `format:agent-continue-registration-status`, `installed:false`,
  `registered:unknown`, `hostStartable:false` (no ExtensionId required).
- `node cli.mjs setup --extension-id …` → `ok:true, dryRun:true` + Windows
  one-liner in `command`.
- `npm run check` → 4/4; `npm run test:setup` → Node 16/16, Setup UI 19/19.

Payload integrity rule: a source checkout has no `SHA256SUMS.txt`, so `-Apply`
only demands digests when `$script:acRemote` is true (the payload was downloaded
by the `irm` entry). `-AllowUnverifiedPayload` stays an explicit opt-out.

Single next action: attach the release assets (`install.ps1`, `install.cmd`,
`SHA256SUMS.txt`, `agent-continue-setup.zip`) so `payloadChecked` becomes non-zero
and the `irm` one-liner can verify itself; then run the fake-registry rehearsal
for `register-hkcu` before any real HKCU write is requested.

### Script launcher, release assets, npm — 2026-11-04 (round 3, uncommitted)

**1. Superseded launcher inference, corrected November 4.**
The earlier Node `execFile` observation did not establish Chrome behavior.
Current Chromium `chrome/browser/extensions/api/messaging/launch_context_win.cc`
(observed blob `bde1be53e4cc246c55c7a036ad6c84edb520fe0a`) retains
`LaunchNativeHostViaCmd` for non-EXE hosts as well as direct EXE launch. Therefore
the earlier PE-only conclusion and "signing is the only way to clear Defender"
claim were incorrect. The current builder still produces a GUI PE by its own
contract, not a Chrome restriction. No replacement wrapper was built or executed
to evade detection. Authenticode establishes publisher/integrity; classification
and actual browser/transport acceptance remain separate. Generated-EXE tests
remain opt-in and were not run during this correction.

**2. Real HKCU write: stopped before writing — no real extension ID exists.**
`manifest.json` has no `key`, no `*.pem`/`*.crx` exists, and no binding artifact
records a `chrome-extension://<32 a-p>` value (grep over `*.json`/`docs/*.md`
returned zero). Per the explicit rule ("没有真实 ID 就先停下来说明"), no
registry write was attempted. Read-only pre-state on this machine:
`reg query HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control /ve /reg:64`
→ `exit=1` (key or value not found); the same `/reg:32` → `exit=1`. Nothing to
overwrite and nothing written.

**3. Release assets + real remote self-check.**
Historical only: the remote shell invocation below is not a supported
installation instruction. Use the command-only ZIP flow at the top.

`dist/payload` (12-file closure from `bin.mjs`) was flattened to `dist/flat`,
hashed into `dist/SHA256SUMS.txt` (13 lines: 12 files + the archive) and zipped
into `agent-continue-setup.zip` (36,035 B, sha256 `c4ad9990f327a779…`). Served
from `http://127.0.0.1:8731`, then run exactly as the remote entry:
`$env:AGENT_CONTINUE_PAYLOAD_BASE=…; $env:AGENT_CONTINUE_EXTENSION_ID=…; irm …/install.ps1 | iex`
→ `{"action":"plan","payloadChecked":12,"node":"24.16.0","elevation":"none","ok":true}`,
`%TEMP%` `agent-continue-*` directories: 4 before, 4 after (download+verify+expand
then `finally` cleanup). Two defects were found by this run and fixed:
`$PSScriptRoot` is empty under `irm | iex` (now treated as "no local payload"),
and the separate `SHA256SUMS.txt` download was not visible to `Assert-Payload`
(now copied into the expanded payload root). `AGENT_CONTINUE_EXTENSION_ID` is the
documented env fallback because `iex` cannot pass parameters.

**4. npm publish: blocked at authentication.**
`npm whoami` → `npm error code ENEEDAUTH` ("This command requires you to be
logged in", log `2026-11-04T04_33_57_014Z-debug-0.log`). No account was created
and nothing was published. `npm view agent-continue version` → `E404`, so the
unscoped name `agent-continue` is currently free (informational only; this is not
a reservation).

Verification for this round: `install-plan.test.mjs` 14 pass / 0 fail;
`native-launcher.test.mjs` 4 pass / 11 explicit skip / 0 fail;
`install.ps1` `ParseFile` parseErrors=0; `npm run check` 4 pass / 0 fail.

Single next action: log in to npm (`npm login`) and re-run
`npm publish --access public` from the repo root; the registry write stays
blocked until a real extension ID is supplied (a `key` in `manifest.json` or an
exported `chrome-extension://…` binding).

### Registration Rehearsal Doc (document only, nothing executed) — 2026-11-04

- HEAD remains `550a8a3`. Uncommitted this round: only the new
  [REGISTRATION-REHEARSAL.md](REGISTRATION-REHEARSAL.md). No source, test, config
  or registry change; no `reg add`, no `reg delete`, no host start, no Chrome
  profile touched.
- The doc states the non-goals (no install, no resident service, no existing
  configuration change); the implemented consent model (two approvals from
  distinct issuers bound to `keyPath`/`regSzValue`/`hive`/`view`, 120 s default,
  consent bound to the same four fields at 300 s with exact echo, `execute`
  defaulting to false, revocation by discarding or expiring); the exact HKCU
  key path and default `REG_SZ` value with an `<INSTALL_ROOT>` placeholder for
  both the 32- and 64-bit views; the literal `reg add` and `reg delete` forms;
  post-write `status --json` / `verify` expectations and exit codes with "any
  FAIL means roll back first"; and failure attribution for enterprise policy,
  Defender/EDR and origin mismatch, each with an explicit no-bypass rule.
- Stated limitation: the repository ships a read-only registry adapter but no
  write adapter, so the rehearsal is either the operator running those two
  commands or a newly reviewed adapter. The document is not evidence of
  registration, origin recognition or tunnel readiness.
- Next action, and only this: wait for the owner's explicit authorization for a
  real write; only after that authorization exercise the `registration-execution`
  two-approval path (`execute: true`, two distinct issuers, fresh consent). Until
  that authorization arrives, change no code.

### `bin.mjs status` / `verify` (implemented, temp fixture executed) — 2026-11-04

- HEAD remains `550a8a3`. Uncommitted this round: new
  [registration-status.mjs](../native/bootstrap/registration-status.mjs) and
  [registration-status.test.mjs](../native/bootstrap/registration-status.test.mjs), the
  `status`/`verify` dispatch in [bin.mjs](../native/bootstrap/bin.mjs), optional `kind`
  labels plus the missing-binding message in
  [runtime-precheck.mjs](../native/desktop-commander/runtime-precheck.mjs), the test list
  in `native/bootstrap/package.json`, §10 of [RUNTIME-ACCEPTANCE.md](RUNTIME-ACCEPTANCE.md),
  and this entry. No `reg add`, no install, no host/owner start, no commit/push.
- `status --install-dir <root> [--json] [--reference <abs-path>]` prints five facts and exits 0
  even when nothing is registered: `installed`, `binding` (`present|missing|invalid`), `registered`
  (`not-registered|registered|drift|error|unknown`), `host startable`, check counts.
  `verify --install-dir <root> [--json] [--reference <abs-path>]` prints the full PASS/FAIL/SKIP
  checklist and exits 1 only when a check is FAIL; SKIP never fails. Both reject duplicates,
  relative paths and unknown flags with `invalid_arguments`.
  *(Updated 2026-11-04: `partial` removed — only the two HKCU views decide `registered` and
  HKLM is `not-applicable`; `--reference` points at a payload manifest file, never a directory.
  See the newest breakpoint at the end of this file.)*
- Registry state is derived from the optional `kind` now attached to the four registry
  checks (`absent|match|drift|error`), not from parsing prose. Coverage stays read-only and
  the output carries no channel secret, MAC, nonce or 64-hex material (asserted in tests).
- `bin.mjs` imports `registration-status.mjs` lazily inside the two branches. This keeps the
  packed 29-file tarball closure unchanged (`packed.test.mjs` passes); the consequence is
  that `status`/`verify` run from the source tree only until `registration-status.mjs`,
  `runtime-precheck.mjs` and its bootstrap imports join the payload/package closure — same
  open packaging debt as the other registration modules, not a claim that they ship.
- Tests: 5 new tests / 5 pass / 0 fail with four fixtures (unregistered, registered and
  equal, value drift, missing binding) covering text, `--json`, and exit codes for both
  commands, plus argument rejection. Regression: `runtime-precheck.test.mjs` 5/5.
  `native/bootstrap` suite 211 tests / 196 pass / 15 skip / 0 fail (previous 206/191/15/0);
  `native/desktop-commander` suite 156 / 152 / 4 / 0.
- Real run against a temp install root built from repo sources (Node v24.16.0):
  `node bin.mjs status --install-dir C:\Users\zye12\AppData\Local\Temp\ac-status-install-<id>`
  printed `installed: yes`, `binding: present`, `registered: not-registered`,
  `host startable: yes`, exit 0; `status --json` matched; `verify` printed
  `VERIFY RESULT pass=13 fail=0 skip=0`, exit 0; `verify` on an absent root exited 1
  (one FAIL). Registry access was only read-only `reg query`; the temp root and fixture
  script were removed.
- Iterations that failed and were corrected: an eager top-level import made every packed
  command exit 1 (packed closure), so the import became lazy; three test expectations
  wrongly assumed `skip=0` while `runtime_files` is SKIP under a null reference directory.
  No production behaviour changed for the latter.
- Not proven: Chrome origin recognition, OS registration, installation, tunnel readiness,
  MCP tool or chat authorization. `status`/`verify` passing means only that the recognised
  layout is coherent and probed keys are absent or equal to the manifest path.
- Superseded next action (done in the entry below): have `setup.js` request `status --json`
  for the real install root and render those five facts on the install page instead of the
  static preview, with the same non-claims and no registry write.

### Install Page Renders `status --json` (implemented, RED→GREEN) — 2026-11-04

- HEAD remains `550a8a3`. Uncommitted this round: new
  [registration-status-view.mjs](../native/bootstrap/registration-status-view.mjs) and
  [registration-status-view.test.mjs](../native/bootstrap/registration-status-view.test.mjs);
  [setup.js](../setup.js) now awaits `resolveStatusView(globalThis.agentContinueRegistrationStatus, ...)`
  and writes the returned text into `#firstInstallPreview`; [setup.html](../setup.html) note
  reworded to "read-only status"; `tests/setup-ui-tests.mjs` whitelists the new module;
  `tests/setup-handoff-source-tests.mjs` injects the real `resolveStatusView` into its VM;
  `native/bootstrap/package.json` test list. No `reg add`, no install, no host/owner start,
  no commit/push.
- RED: `node --test native/bootstrap/registration-status-view.test.mjs` -> 1 file failed,
  0 pass (module absent). GREEN: same command -> 7/7 pass. Full bootstrap `npm.cmd test` ->
  `tests 218, pass 203, fail 0, skip 15` (was 211/196/15/0). `node tests/setup-ui-tests.mjs`
  -> 19/19. `node --test tests/setup-handoff-source-tests.mjs tests/setup-model-tests.mjs`
  plus the view test -> 23/23.
- Five facts rendered: install root, installed, binding (`present|missing|invalid`),
  registered (`not-registered|registered|drift|error|unknown` each with its own wording;
  `partial` removed 2026-11-04 because per-user registration is decided by HKCU only),
  host startable. Missing, extra or mistyped fields raise `invalid_status_input`
  (no silent widening). A missing bridge, thrown bridge, timeout, non-zero exit or malformed
  JSON renders the explicit `状态未知` view with all five rows `未知`; the old
  `catch { hidden = true }` clearing path is gone.
- The page never spawns or writes: no `execute:true`, no `reg add`, no `child_process`, no
  `spawn(` in the view module or `setup.js` (source scan); the bridge receives exactly
  `{timeoutMs}` and is called once. `registered` wording says discovery only, never a live
  tunnel or chat authorization.
- Regression found and fixed: `tests/setup-ui-tests.mjs` never whitelisted
  `native/bootstrap/registration-guidance.mjs`, so the page module had been aborting since
  the round-8 import; this round drops that import and whitelists the new module (19/19 for
  the first time since then). A cross-realm `Object.prototype` identity check also rejected
  VM-created option objects; replaced with a two-level prototype test.
- Not proven: Chrome origin recognition, OS registration, installation, tunnel readiness,
  MCP tool or chat authorization. A green page shows only a read-only five-fact report.
- Next action, and only this: add `registration-status.mjs`, `registration-status-view.mjs`,
  `registration-guidance.mjs` and `registration-render.mjs` to the bootstrap `files` closure
  and add a packed test that imports them from the tarball, removing the "source tree only"
  debt. (Done in the entry below.)

### Packed Tarball Carries the Registration Modules (implemented, RED→GREEN) — 2026-11-04

- HEAD remains `550a8a3`. Uncommitted this round: [payload-layout.mjs](../native/bootstrap/payload-layout.mjs)
  `PACKAGE_FILES` 11 -> 17 and [package.json](../native/bootstrap/package.json) `files` now carry
  `registration-guidance.mjs`, `registration-plan.mjs`, `registration-render.mjs`,
  `registration-status.mjs`, `registration-status-view.mjs`, `runtime-precheck.mjs`;
  [packed.test.mjs](../native/bootstrap/packed.test.mjs) expected closure 29 -> 35 plus a new
  packed test; `runtime-precheck.mjs` moved from `native/desktop-commander/` to
  `native/bootstrap/` with its two imports rewritten (`registration-status.mjs` and the two
  desktop consumers updated). The closure is six modules, not four: `registration-status.mjs`
  imports `runtime-precheck.mjs`, which imports `registration-plan.mjs`; without them the
  packed import fails.
- RED: `node --test --test-name-pattern='packed tarball carries' packed.test.mjs` ->
  `packed_package_files_mismatch` (expected 35, built 29). GREEN: same command -> 1/1, with
  `packedRegistrationModules:4, packedStatusExit:0, packedVerifyExit:0, packedBinStatusExit:0,
  packedBinVerifyExit:1, registryWrites:0`. Full `node --test packed.test.mjs` -> 7 tests,
  6 pass, 1 opt-in skip, 0 fail.
- The new packed test imports all four modules from the installed tree, asserts exact export
  sets, then runs `status --json`/`verify --json` through the packed module with an injected
  fake registry (four views queried, all absent) and a minimal canonical binding/manifest
  fixture; `verify` exits 0 only because runtime/syntax checks are stubbed, and the packed
  `bin.mjs` still exits 1 on `verify` for that root because real runtime files are absent.
  No `reg add`, no install into the user profile, no host start.
- Full bootstrap `npm.cmd test` -> `tests 219, pass 204, fail 0, skip 15` (was 218/203/15/0).
  Desktop `node --test native/desktop-commander/runtime-precheck.test.mjs` -> 5/5 after the move.
- Real `npm pack --json --ignore-scripts` on the source tree -> `entryCount 17`, `size 39628`
  and it lists all six new modules; the `payload/` directory and `payload-manifest.json` are
  generated by `build-package.mjs` before packing, which is why the source-tree pack has 17
  entries while the staged closure the packed test validates has 35. The produced `.tgz`
  was deleted; nothing was published.
- Not proven: registration, Chrome origin recognition, tunnel readiness, chat authorization.
  A packed tarball proves file closure and read-only command wiring only.
- Next action, and only this: write `docs/REGISTRATION-REHEARSAL.md`, a doc-only minimal
  rehearsal checklist that names the exact user consent step, the exact `HKCU` key path and
  `REG_SZ` value to be shown before any write, the rollback command and the post-write
  read-only status/verify commands. No registry write, no host start.

### Read-Only Install Pre-Check (implemented, temp fixture executed) — 2026-11-04

- HEAD remains `550a8a3`. Uncommitted this round: new
  [runtime-precheck.mjs](../native/desktop-commander/runtime-precheck.mjs) and
  [runtime-precheck.test.mjs](../native/desktop-commander/runtime-precheck.test.mjs),
  the `--precheck <install root>` branch in
  [runtime-acceptance.mjs](../native/desktop-commander/runtime-acceptance.mjs), the test
  list in `native/desktop-commander/package.json`, the §9/§10 update in
  [RUNTIME-ACCEPTANCE.md](RUNTIME-ACCEPTANCE.md), and this entry. No `reg add`, no
  installation, no resident service, no commit/push.
- New module: `precheckInstall({ root, registry, reference, verifySyntax })` returns an ordered
  `PASS/FAIL/SKIP + reason` checklist for install root and layout, install-root payload-manifest
  hashes, host/owner `node --check` parse, canonical binding, binding↔state directory match,
  channel presence/shape, five-field manifest, and the four `HKCU|HKLM` × `32|64` registry views.
  *(Updated 2026-11-04: `reference` is an absolute manifest path, `referenceDir`/`expectedFiles`
  were removed; HKLM is `SKIP/not-applicable` in per-user mode.)* The registry reader is injected;
  `createRegQueryRegistry()` is the CLI adapter and treats a non-zero `reg query` as
  "not registered" (`null`), never as an error.
- Registry semantics as instructed: absent HKCU key → `PASS ... not registered (normal pre-registration state)`;
  present and byte-equal to the manifest path → `PASS`; present but different → `FAIL ...
  value drift`; HKLM is always `SKIP/not-applicable` (residual values are informational);
  manifest or binding unusable → `SKIP` for the HKCU entries.
- Tests (`node --test runtime-precheck.test.mjs`, fake registry only, no real key touched):
  5 tests, 5 pass, 0 fail. Fixtures cover not-registered, registered-and-consistent,
  value-drift, manifest missing `type`, and invalid binding plus a reference-hash mismatch.
  There was no RED capture: module and tests landed together, so the first run was green.
  Full `native/desktop-commander` suite: 156 tests / 152 pass / 4 skip / 0 fail, i.e. the
  prior test list plus these 5 tests. `native/bootstrap` suite unchanged: 206 / 191 / 15 / 0.
- Real CLI run against a temp install root built from repo sources (Node v24.16.0):
  `node runtime-acceptance.mjs --precheck C:\Users\zye12\AppData\Local\Temp\ac-precheck-install-0mWn91`
  printed `PRECHECK RESULT pass=13 fail=0 skip=0`, with all four registry lines
  `PASS ... not registered` from read-only `reg query`, exit 0; the temp root was removed
  after the run. The handshake regression still prints `RESULT pass=12 fail=0` and removes
  its scratch directory.
- `--precheck` without a path exits 1 with
  `ABORT --precheck requires an install root path scratch=<none>` and creates nothing.
- Not proven: Chrome origin recognition, OS registration, installation, tunnel readiness,
  MCP tool or chat authorization. A pre-check pass only means the recognised layout is
  coherent and the probed keys are absent or equal to the manifest path.
- Next action, and only this: add `verify`/`status` subcommands to
  `native/bootstrap/bin.mjs` that call the same read-only `precheckInstall`, so the
  extension and the owner can request a self-check without spawning a host or writing a
  key; keep "not registered" a normal PASS and keep the non-claims above.

### Runtime Acceptance Probe (executed, temp-only) — 2026-11-04

- HEAD remains `550a8a3`; uncommitted: new
  [runtime-acceptance.mjs](../native/desktop-commander/runtime-acceptance.mjs), the
  §5/§6/§10 correction in [RUNTIME-ACCEPTANCE.md](RUNTIME-ACCEPTANCE.md), and this entry.
  No registry write or query, no installation, no resident service, no commit/push, and
  no use of the real `device-native-binding.json` or real state root.
- Real command: `Set-Location '<repo>\native\desktop-commander'; node runtime-acceptance.mjs`
  (Node v24.16.0). It printed `scratch=C:\Users\zye12\AppData\Local\Temp\ac-runtime-acceptance-aBqWcZ`
  before work and removed it at the end. Observed: `owner_mac_recomputed` (both
  `device-request-v1` and `device-response-v1` recomputed, `ok=true`),
  `host_handshake` exit 0 with exactly one frame and `id`/`action` echo,
  `channel_bytes_unchanged`, `binding_bytes_unchanged`, three refusals
  (`wrong_origin`, `extra_argument`, `oversized_frame`) each exit 1 +
  `device_bridge_unavailable` + empty stdout, `owner_clean_exit code=0`,
  `channel_removed_on_close`, `no_transient_files_left`, and
  `RESULT pass=12 fail=0` with exit 0. The copied host is byte-identical
  (`host_copy_sha256=7963e3a6ec66113c0638a1da4873ae0fa0e83543871eb43708ddb9cbce1dd5e5`).
- Contract correction found by the run: the host writes only the inner `response`
  (`version`/`id`/`action`/`ok`, plus `state`) to stdout, never the owner's F3 wrapper
  or its `mac`. A reply MAC can only be recomputed in a direct owner probe that reads
  the challenge, which the script does before the host run. §5 previously said the host
  writes F3 and has been corrected; no product code was changed for this.
- Earlier iterations aborted for a fixture reason, not a product defect: the temp copy
  omitted `tunnel-pins.json`, so `profile.mjs` failed at import and the owner collapsed
  to `device_owner_unavailable`; fixed by copying every sibling `.json`. Two aborted runs
  left fixture processes and temp directories, which were stopped and removed.
- Not proven by this run: Chrome origin recognition, OS registration, installation,
  tunnel readiness, MCP tool authorization or chat authorization. A pass is only a
  host↔owner single-frame handshake inside a temporary directory.
- Next action, and only this: add a `--precheck <install root>` read-only mode to the
  same script, evaluating §1/§8 of RUNTIME-ACCEPTANCE.md against a real install root
  (hashes, binding/channel/manifest shape, registry key absence via `reg query`) and
  printing PASS/FAIL with no write, no install, no host start and no resident process.

### Runtime Acceptance Pre-Check (documentation only) — 2026-11-04

- HEAD remains `550a8a3`; uncommitted this round: new
  [RUNTIME-ACCEPTANCE.md](RUNTIME-ACCEPTANCE.md) plus this handoff entry. No source,
  test, package, manifest, registry or process change; no `reg add`, `reg query`,
  host start, owner start or commit/push.
- The checklist was derived read-only from `native/desktop-commander/device-native-host.mjs`
  (argument rule, binding-derived origin, single-frame then exit, sanitized
  `device_bridge_unavailable` + exit 1), `device-owner.mjs` (binding reader, channel
  record, 15 s/5 s frame deadlines, 4096-byte cap, challenge/request/reply shapes,
  `device-request-v1` / `device-response-v1` HMAC inputs, clean close), `device-operations.mjs`
  (`status|reconnect|disconnect-and-pause`, request id regex, owner-created lease/journal),
  and `Build-NativeLauncher.ps1` (exact five-field manifest).
- It documents, for a future run: exact launch forms `node device-owner.mjs` (zero extra
  args) and `node device-native-host.mjs chrome-extension://<id>/ [--parent-window=<1-20
  digits>]` (Windows only), the one-frame lifecycle, the origin equality rule, the
  objective pass criteria (exit 0 + one complete frame + recomputed MAC + unchanged
  channel/binding), the "started but not handshaken" case, the no-install evidence, and
  a read-only command list (`Get-*`, `Test-Path`, `reg query`, `node -v`) with no
  `Start-Process` and no host launch.
- This is not acceptance. Nothing was run, so there is no runtime evidence yet; the
  checklist cannot be quoted as a registered host, a live handshake or a working tunnel.
- Next action, and only this: turn RUNTIME-ACCEPTANCE.md §2–§6 into one minimal
  executable acceptance script — temporary owned owner fixture plus the real
  `device-native-host.mjs` in an `os.tmpdir()` state root, one `status` frame, exact
  reply/MAC assertion, unchanged channel/binding, clean owner stop — with no registry
  write and the Windows-only `--parent-window` case skipped elsewhere.

### First-Install Guidance Display Model (RED→GREEN) — 2026-11-04

- HEAD remains `550a8a3`; uncommitted this round: new
  `native/bootstrap/registration-guidance.mjs`, new
  `native/bootstrap/registration-guidance.test.mjs`, one more filename in the
  bootstrap `package.json` test list, a read-only preview block in `setup.html`,
  its import plus `renderFirstInstallGuidance()` in `setup.js`, one i18n catalog
  entry, and this handoff. No `reg add`, no registry contact, no host start, no
  commit/push.
- RED: `node --test --test-concurrency=1 registration-guidance.test.mjs` -> the
  module was absent: 1 test file failed, 0 pass, exit 1.
- GREEN: same command -> 6 / 6 pass. Registration files together (plan, writer,
  execution, render, guidance) -> 30 / 30 pass. Full `npm.cmd test` -> tests 206 /
  pass 191 / fail 0 / skipped 15 (baseline 200 / 185 / 0 / 15).
- `buildFirstInstallGuidance({display, registrationStatus})` accepts only
  `registrationStatus === 'not-registered'` plus the exact ten-key dry-run
  display. It re-derives the key path and the nine `reg.exe` arguments from
  hive/view/`REG_SZ` and requires `display.text` to byte-match the seven-line
  preview, so an executed result, a tampered banner/key/argument, a missing
  field, an extra key or a second top-level key all throw
  `invalid_guidance_input` instead of degrading the block.
- `buildPendingFirstInstallGuidance({hive, view})` covers the page before any
  reviewed plan exists: it derives the deterministic key path from the fixed host
  name, uses the literal placeholder
  `<absolute manifest path supplied by the reviewed installer>` as `REG_SZ`,
  marks `valueKind:'placeholder'`, and refuses non-canonical hive/view or extra
  keys.
- Output is a frozen `{format,version,valueKind,status,statusLabel,hostName,hive,
  view,keyPath,regSzValue,command,text}` with `status:'not-registered'` and
  `Registration status: not registered. Nothing has been written.`
- No-execution evidence: the guidance module has no imports and no
  `child_process`/`spawn`/`execFile`/`require`/writer/execution reference; the
  test builds its display through a counting registry and asserts
  `get`/`set`/`remove` stay 0 before and after building guidance; the page calls
  only `buildPendingFirstInstallGuidance` with a literal scope.
- UI wiring: `setup.html` adds `#firstInstallGuidance`/`#firstInstallPreview`
  inside the existing Windows handoff section, and `setup.js` renders the model's
  `text` there once at load; a refusal empties the block and leaves it hidden
  rather than showing partial data. The execute path, request export and
  permission flow are untouched.
- Packaging unchanged: the five registration modules stay outside `package.json`
  `files`, so the packed tarball closure is untouched.
- Claim boundary: this is a display block only. Nothing was executed, the
  registry has no key for this host, no native host was started, and there is
  still no installed Chrome origin or verified tunnel.
- Next action, and only this: prepare the runtime-acceptance pre-check, with no
  registry write — a minimal checklist for actually starting the host: the exact
  `native/desktop-commander/device-native-host.mjs` launch command, the
  origin/`--parent-window` arguments, the expected one-frame
  challenge/request/reply sequence, what a pass looks like versus a
  `device_bridge_unavailable` failure, and how to show the host exits without
  installing anything. Document it; do not run it.

### First-Install Preview Renderer (RED→GREEN) — 2026-11-04

- HEAD remains `550a8a3`; uncommitted this round: new
  `native/bootstrap/registration-render.mjs`, new
  `native/bootstrap/registration-render.test.mjs`, one more filename in the
  bootstrap `package.json` test list, a preview section in `SETUP-DESIGN.md`, one
  README paragraph, and this handoff. No `reg add`, no real registry contact, no
  host launch, no commit/push.
- RED: `node --test --test-concurrency=1 registration-render.test.mjs` -> the
  file failed at import (module absent): 1 test file failed, 0 pass, exit 1.
- Implemented renderer `renderRegistrationDisplay(dryRun)`:
  - accepts only the exact seven-key dry-run record (`mode`, `hostName`, `hive`,
    `view`, `keyPath`, `regSzValue`, `command`) held as plain own data
    properties; missing keys, extra keys, symbol keys, accessors, arrays, `null`,
    primitives, class instances and `mode:'executed'` are `invalid_dry_run`;
  - requires `regSzValue` to be a non-empty absolute Windows path with no
    control characters, no edge whitespace and at most 32767 characters, plus
    hive HKCU/HKLM, view `'32'`/`'64'`, `command.executable` exactly `reg.exe`
    and `command.args` exactly a 9-string array;
  - re-derives rather than trusting: key path must equal
    `hive + '\Software\Google\Chrome\NativeMessagingHosts\' + hostName` and args
    must equal `['add', keyPath, '/ve', '/t', 'REG_SZ', '/d', regSzValue,
    '/f', '/reg:' + view]`; any drift is `invalid_dry_run_binding`;
  - returns a frozen `{format,version,mode,hostName,hive,view,keyPath,regSzValue,
    command,text}`; the seven-line `text` carries the preview banner, host, hive,
    `32-bit`/`64-bit` view, key path, `REG_SZ` value and the full `reg.exe`
    command line, and contains no approval, consent, issuer or expiry material.
- GREEN: same command -> 6 / 6 pass / 0 fail. The four registration files
  together -> 24 / 24 pass / 0 fail. Full `npm.cmd test` -> tests 200 / pass 185 /
  fail 0 / skipped 15 (baseline 194 / 179 / 0 / 15). Skips are the unchanged
  explicit opt-in/platform cases.
- Display wiring is documentation only: the new `SETUP-DESIGN.md` preview
  section and one `README.md` paragraph. No `setup.html`/UI wiring and no change
  to the `execute` path. Nothing was executed, no registry key exists, no host
  started and no tunnel is connected.
- Packaging note unchanged: the four registration modules stay outside
  `package.json` `files`, so the packed tarball closure is untouched.
- Next action, and only this: wire the renderer output into the first-install
  guidance in `setup.html`/`setup.js` as read-only display (show the exact key,
  `REG_SZ` value, hive, view and command and take no execute path), RED-first for
  the display model/formatting function. It must not call `runRegistration` with
  `execute:true`, execute `reg add`, touch the real registry or claim
  registration.

### Two-Person Dry-Run Execution Shell (RED→GREEN) — 2026-11-04

- HEAD remains `550a8a3`; uncommitted this round: new
  `native/bootstrap/registration-execution.mjs`, new
  `native/bootstrap/registration-execution.test.mjs`, one more filename in the
  bootstrap `package.json` test list, and this handoff. No `reg add`, no real
  registry contact, no host launch, no commit/push.
- RED: `node --test registration-execution.test.mjs` -> the file failed at
  import (module absent), exit 1. One fixture defect was corrected before the
  GREEN run: the last expired-grant case had called the shell before that
  approval's `expiresAt`, so the call time moved past it.
- Implemented shell:
  - Approvals come from `issueRegistrationApproval`, tracked in a module-private
    `WeakMap`; missing, forged (spread copy), expired, or two grants from the
    same `issuerId` are rejected (`invalid_approval`, `expired_approval`,
    `duplicate_approver`).
  - Both grants must match the plan byte-for-byte on `keyPath`, `regSzValue`,
    `hive` and `view` (`approval_mismatch`); the plan itself is re-derived
    through `registrationPlan` (`invalid_plan`).
  - `execute` must be a boolean. Default and `false` return a frozen dry-run
    object containing only `mode`, `hostName`, `hive`, `view`, `keyPath`,
    `regSzValue` and `{executable:'reg.exe', args:plan.addArgs}`. The registry is
    not read or written: `get` and `set` call counts are both 0, and the
    serialized result contains no issuer ID, consent/approval text or expiry.
  - `execute:true` with two valid distinct grants issues a fresh writer consent
    and delegates to `writeRegistration`, so read-before-write
    (`already-present` / `registration_conflict`), byte read-back, and rollback
    on mismatch all still apply; echo drift remains `echo_mismatch`.
- GREEN: same command -> tests 6 / pass 6 / fail 0 / skip 0. The three
  registration files together -> 18 / 18 pass / 0 fail. Full `npm.cmd test` ->
  tests 194 / pass 179 / fail 0 / skipped 15 (baseline 188 / 173 / 0 / 15).
  Skips are the unchanged explicit opt-in/platform cases. This is fake-registry
  dry-run evidence only: nothing is registered, no installed origin exists and
  no tunnel is connected.
- Packaging note unchanged: the three registration modules are not in
  `package.json` `files`; the packed tarball closure is untouched. Wiring real
  execution later must add them and update the packed closure expectations.
- Next action, and only this: surface the dry-run result in the installer's
  display text. RED-first for a pure renderer that turns a dry-run result into
  the exact key path, `REG_SZ` value, hive, view and command shown to the user,
  refusing any missing or extra field, then use that renderer in the SETUP/
  README guidance. It must not execute `reg add`, touch the real registry or
  claim registration; real execution still needs separate explicit user
  authorization and independent review.

### Gated Registration Writer on a Fake Registry (RED→GREEN) — 2026-11-04

- HEAD remains `550a8a3`; uncommitted this round: new
  `native/bootstrap/registration-writer.mjs`, new
  `native/bootstrap/registration-writer.test.mjs`, one more filename in the
  bootstrap `package.json` test list, and this handoff. No real registry was
  read or written, `reg add` was never executed, no host was launched and
  nothing was committed or pushed.
- RED: `node --test registration-writer.test.mjs` in `native/bootstrap` ->
  tests 1 / pass 0 / fail 1 / skip 0, exit 1, failing at import because the
  module did not exist. Three test-fixture defects were corrected before the
  GREEN run (the idempotent fixture had built a second plan with a different
  manifest path; a bogus `\32`-to-`\64` string swap did not express a view
  change, so view drift is now exercised through consent binding; the forged
  plan was internally consistent and was replaced by a mismatched key path).
  Those were test corrections, not source fixes.
- Implemented writer behaviour, all with an injected in-memory registry and zero
  registry APIs or `child_process`:
  - Consent must be an object returned by `issueRegistrationConsent` (tracked in
    a module-private `WeakMap`), so missing and hand-built forged objects are
    rejected as `invalid_consent`; an expired `expiresAt` is `expired_consent`.
  - Consent is bound to key path, `REG_SZ` value, hive and view; any plan drift
    is `consent_mismatch`.
  - The supplied plan is re-derived through `registrationPlan` and must match
    every field, otherwise `invalid_plan`.
  - The caller must echo exactly the two keys `{keyPath, regSzValue}` with
    byte-identical strings; extra keys, missing keys, an appended space, a
    truncated path, a different hive or a different value are `echo_mismatch`.
  - Read-before-write: an existing identical value returns
    `{status:'already-present'}` without calling `set`; an existing different
    value fails `registration_conflict` and is never overwritten.
  - After writing, the default value is read back and compared byte-for-byte; a
    mismatch fails `registration_readback_mismatch` and removes the fake entry
    so the fake registry returns to its prior absent state. A throwing `set` or
    `get` also rolls back and fails explicitly.
- GREEN: same command -> tests 7 / pass 7 / fail 0 / skip 0. Both registration
  files together -> 12 / 12 pass / 0 fail. Full `npm.cmd test` ->
  tests 188 / pass 173 / fail 0 / skipped 15 (baseline before this round:
  181 / 166 / 0 / 15). Skips are the pre-existing explicit opt-in/platform
  cases. This is fake-registry evidence only; it is not "registered", not an
  installed origin, and not tunnel acceptance.
- Packaging note unchanged: neither `registration-plan.mjs` nor
  `registration-writer.mjs` is in `package.json` `files`, so the packed tarball
  closure is untouched. Wiring real execution later must add both and update the
  packed closure expectations in the same change.
- Next action, and only this: a two-person authorization shell around real
  execution, dry-run by default. RED-first for a shell that requires two
  distinct consent grants (requester and approver) whose plans agree byte-for-byte
  and whose approvals are unexpired, emits the exact command/data it would run
  without invoking it by default, and only switches to execution when a separate
  explicit flag and both grants are present. Tests must still use the in-memory
  fake; `reg add`, real registry contact and host launch remain prohibited until
  separate explicit user authorization plus independent review.

### Pure Registration Planner (RED→GREEN) — 2026-11-04

- HEAD remains `550a8a3`; uncommitted this round: new
  `native/bootstrap/registration-plan.mjs`, new
  `native/bootstrap/registration-plan.test.mjs`, and one added filename in the
  bootstrap `package.json` test list. No registry was read or written, no host
  was launched, and nothing was committed or pushed.
- RED (first run, before any implementation): `node --test
  registration-plan.test.mjs` in `native/bootstrap` -> tests 1 / pass 0 / fail 1
  / skip 0, failing at import because neither `device-setup.mjs` nor the new
  module exported `registrationPlan`. An initial Edit into `device-setup.mjs`
  was rejected twice for a non-unique two-line anchor; per the constraint the
  implementation moved to a new module instead of rewriting that large file.
- Implementation: a pure planner that validates inputs and returns frozen data
  only (no `reg add`, no `child_process`, no registry access, no file writes; the
  only filesystem touch is `statSync` on the supplied manifest path):
  - `keyPath` is exactly `<HKCU|HKLM>\Software\Google\Chrome\
    NativeMessagingHosts\com.agentcontinue.device_control`.
  - `regSzValue` is the caller's absolute manifest path, verified to exist and
    be a regular file.
  - `addArgs` = `['add', keyPath, '/ve', '/t', 'REG_SZ', '/d', path, '/f',
    '/reg:<32|64>']`; `queryArgs` = `['query', keyPath, '/ve', '/reg:<32|64>']`.
  - Rejects, case-sensitively and character-for-character, any name other than
    `com.agentcontinue.device_control` (uppercase, extra character, leading or
    trailing space, shortened form, doubled dot, empty); rejects relative,
    missing, directory and non-string manifest paths; rejects wildcard,
    missing-trailing-slash, uppercase-ID, out-of-range-ID, non-`chrome-extension`
    and absent origins; rejects unknown hives and views.
- GREEN: same command -> tests 5 / pass 5 / fail 0 / skip 0. Full
  `npm.cmd test` in `native/bootstrap` -> tests 181 / pass 166 / fail 0 /
  skipped 15 (baseline before this round: 176 / 161 / 0 / 15). All skips are
  the pre-existing explicit opt-in/platform ones. This is planner evidence only,
  not "registered successfully" and not installed-origin/tunnel acceptance.
- Packaging note: `registration-plan.mjs` is intentionally NOT yet in the
  `package.json` `files` list, so the packed tarball byte closure is unchanged.
  Wiring the installer later must add it to `files` and update the packed
  closure expectations in the same change.
- Next action, and only this: design the writer's authorization gate plus
  read-back verification, still without any real write. RED-first for a writer
  interface that requires an explicit consent token, echoes the exact key path
  and `REG_SZ` value from `registrationPlan`, refuses any drift or duplicate
  target, and verifies a fake registry's default value byte-for-byte after a
  simulated write. Tests must use an in-memory fake only; `reg add` and contact
  with the real registry remain prohibited until separate explicit authorization
  and independent review.

### Windows Native-Host Installation Audit — 2026-11-04

- HEAD remains `550a8a3`; read-only round. No registry key was read or written for
  production, no host was launched, and no source/test file changed. Official
  reference fetched from `developer.chrome.com/docs/extensions/develop/concepts/
  native-messaging` (Chinese mirror copy) and compared with the generated manifest.
- Official requirements [doc-confirmed]:
  - Valid JSON with `name`, `description`, `path`, `type`, `allowed_origins`.
  - `name` may contain only lowercase alphanumerics, underscores and dots; it
    cannot start/end with a dot and cannot contain consecutive dots.
  - `type` has exactly one legal value, `stdio`.
  - `allowed_origins` values cannot contain wildcards.
  - Windows manifest may live anywhere; the installer must create
    `HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\<name>` or
    `HKLM\SOFTWARE\Google\Chrome\NativeMessagingHosts\<name>` with the default
    `REG_SZ` value set to the full manifest path. Chrome queries the 32-bit
    registry view first, then the 64-bit view.
  - The host's first argv is the caller origin, normally
    `chrome-extension://<extension-id>/`.
- Generated manifest, confirmed by [Build-NativeLauncher.ps1](file:///d:/Desktop/Northwestern%20University%20MSCS/%5BDevelop%5D/agent-continue-repo/native/bootstrap/Build-NativeLauncher.ps1#L137-L151)
  and its assertion in [native-launcher.test.mjs](file:///d:/Desktop/Northwestern%20University%20MSCS/%5BDevelop%5D/agent-continue-repo/native/bootstrap/native-launcher.test.mjs#L219-L220):
  exactly `{name:com.agentcontinue.device_control, description, path:<absolute
  output>, type:stdio, allowed_origins:[chrome-extension://<a-p32>/]}`, UTF-8
  no BOM, compact, trailing LF, byte read-back. Every field satisfies the doc;
  `name` passes the charset rule; the single exact origin has no wildcard.
- Name equality, confirmed string-identical in all five places: extension
  `HOST` in `device-control.js`, `setup-model.js`, the manifest `name`, the
  launcher receipt `nativeHost`, and the `device-setup.mjs` validation. No case,
  dot or underscore mismatch; this also matches the prior correction away from
  the shorter `com.agentcontinue.device`.
- Registration checklist (requirement / generated today / missing / how to verify):
  1. Manifest with the five required fields — generated — none — parse the
     emitted JSON and deep-equal the doc shape; already asserted in the launcher test.
  2. Exact, wildcard-free `chrome-extension://<id>/` origin — generated — none —
     regex the single entry, reject `*` and missing trailing slash.
  3. Absolute, existing, non-reparse `path` — generated (`Assert-LocalPath` on a
     fixed local drive, `.exe`, `Assert-GuiPE`, hash read-back) — none. [inferred]
     Absolute is stricter than the Windows-relative allowance and avoids cwd
     dependence; this is a design choice, not a doc demand.
  4. Registry key `...\NativeMessagingHosts\com.agentcontinue.device_control` —
     **not generated anywhere** ([grep](file:///d:/Desktop/Northwestern%20University%20MSCS/%5BDevelop%5D/agent-continue-repo/native/bootstrap/SETUP-DESIGN.md#L205-L205)
     finds only the design note, no `reg add`/HKCU/HKLM code) — missing — after
     any future authorized write, read the key's default value back and compare
     it byte-for-byte with the manifest path.
  5. Default `REG_SZ` = full manifest path — missing with 4; the receipt currently
     reports `registered:false` and `activated:false`, which is honest.
  6. 32-bit-view-first lookup — missing; writing only the 64-bit view is still
     found through Chrome's 64-bit fallback, but writing the 32-bit view (or both)
     avoids depending on that fallback. [inferred, not a doc violation]
  7. HKCU vs HKLM — no preference in the doc; HKCU is per-user and avoids
     elevation, while HKLM needs administrator rights. [inferred policy choice,
     not a contract requirement]
  8. User-consent gate before any registry write, plus uninstall/rollback — absent.
  9. Chrome-side acceptance (origin listed, host launchable) — unverified; cannot
     be claimed from source alone, and the Windows EXE gate stays unset.
- Verdict: the generated manifest has no confirmed contract error and the names
  match exactly, so no source change is made. The real gap is the entirely
  unimplemented installer path (items 4-6 and 8), which is a gap list, not a bug.
- Next action, and only this: write the first RED for a pure registration planner
  (no registry access) that derives the exact key path for a given name and view,
  rejects a name that differs from `com.agentcontinue.device_control` in any
  character, rejects relative/non-existent manifest paths and wildcard origins,
  and returns the `REG_SZ` value to write. Do not execute `reg add`, do not
  launch the host, and require separate explicit authorization plus independent
  review before any real registry write.

### Devices ↔ Native Bridge Contract Audit — 2026-11-04

- HEAD remains `550a8a3`; this round is read-only. No repository source or test
  file changed, nothing was installed or launched, and no commit/push occurred.
  Findings are code-reading evidence, not runtime or installed-origin acceptance.
- Confirmed consistent by reading both sides:
  - Request: extension sends exactly `{version:1,id,action}`; the owner validates
    the same three keys, version, ID charset and action set through
    `validateDeviceRequest`.
  - Response envelope: `{version,id,action,ok[,state]}`; an `ok:false` reply must
    carry no `state` on either side (`device-control.js` decode vs owner
    `responseValid`).
  - State: `{paused:boolean|null, connection:ready|disconnected|unknown,
    operation?:{id,action,status}}` with the same key sets on both sides; the
    status set and the terminal pair `settled|not-executed` are identical.
  - IPC framing/MAC: 4-byte little-endian length + UTF-8 JSON, ≤4096 bytes,
    exactly one frame and no trailing bytes; challenge `{version:1,nonce}`,
    request `{version:1,origin,request,mac}`, reply `{version:1,response,mac}`;
    MAC domains `device-request-v1` / `device-response-v1` over
    `[domain,nonce,origin,request(,response)]`. The native host imports the
    owner's `readFrame`/`writeFrame`/`sendDeviceRequest`, so both ends execute
    the same implementation.
  - Origin: `chrome-extension://<32-char-id>/` derived from the private binding;
    the launcher manifest derives `allowed_origins` the same way; the only extra
    argv accepted is the documented Windows `--parent-window=<digits>`.
  - Lifecycle observation `{paused,runtime,ready,chatAuthorization}` is reduced by
    the operations layer to `paused`/`connection`; `chatAuthorization` is never
    emitted, matching the extension's closed state.
  - Target/v2: `device-ssh` re-validates exactly `{version:2,target,id,action}` and
    returns `{...v1 response, version:2, target}`; the extension requires exactly
    those extras.

- Discrepancies, none a confirmed defect:
  1. Extension `decodeResponse` accepts an `operation.id` that differs from the
     request ID and, for mutations, an operation whose action differs; the owner
     requires both to match. [read-code] Impact: the owner never emits such a
     frame, and `observe()` independently checks the pending ID/action and marks
     mismatched mutations `unconfirmed`, so this is defense-in-depth, not a
     handshake failure or silent acceptance.
  2. `docs/DEVICE-CONTROL.md` requires the future closed state
     `{paused,pauseMode,loginRecoveryAvailable,connection,operation?}`, while the
     current contract is `{paused,connection[,operation]}`. [read-code] This is
     the planned V2 increment, not a v1 disagreement; all current sides agree.
  3. `frameLimit` 4096 is stricter than Chrome's native-messaging limit.
     [read-code] Current payloads are far smaller; an oversized future message
     would surface as host exit-1 then `transport`, not silent success. Latent
     cap, not a defect.
  4. The native host collapses every failure (bad origin, changed binding, frame
     timeout, IPC rejection) into stderr `device_bridge_unavailable` + exit 1;
     the extension maps unknown host errors to `transport`. [read-code] No
     silent success, but reason granularity is lost. Style/observability only.
- Verdict: no confirmed real defect in this contract slice, so no source change.
  Do not add cross-field checks merely to manufacture a RED while the owner stays
  authoritative.

- Next action, and only this: read-only audit of the installation chain. Compare
  the launcher-generated host manifest `{name,type,path,allowed_origins}` with
  Chrome's actual lookup locations (HKCU/HKLM manifest path, 32-bit view first)
  and the extension's `HOST='com.agentcontinue.device_control'`; produce a
  registration checklist. No registry write, no host launch, and no claim that an
  installed Chrome origin or tunnel works.

### Awaited-Status Journal Replacement: Claim Not Established — 2026-11-04

- HEAD remains `550a8a3`. This round changed no repository source or test file;
  only this handoff and project memory were updated, and nothing was committed.
- Claim under test: "a journal replaced while a status query is awaiting can still
  return an old receipt". A disposable probe outside the repository imported the
  real `device-operations.mjs` with a real `prepareState` fixture, settled one
  receipt, blocked inside `controller.status`, mutated the journal, released, and
  recorded the reply. Command: `node %TEMP%\aco-status-fence-probe.mjs`; all six
  fixtures were removed afterwards.
- Observed variants and replies (6/6 executed, 0 fixture leaks):
  - different bytes rewritten in the same inode -> `ok:false`, no operation.
  - unlink plus recreate with identical bytes (new inode) -> `ok:false`.
  - identical-byte rewrite in the same inode -> `ok:true`, `settled`.
  - different bytes then restored before release -> `ok:true`, `settled`.
  - rename away and back (same inode, same bytes) -> `ok:true`, `settled`.
  - transient second hardlink created and removed -> `ok:true`, `settled`.
- Conclusion: the defect is NOT established and no repository code change is
  warranted. Every replacement that leaves the journal different from the
  owner's post-await snapshot is rejected; the four `settled` replies all ended
  with byte- and inode-identical durable state, so the returned receipt matched
  the journal exactly rather than being stale. The existing post-await
  `journalOwned()` identity+bytes check plus the retained lease fence already
  cover this claim. A replacement occurring strictly between the final
  synchronous check and response construction is an inherent check-then-return
  window that no test can deterministically trigger through the awaited query,
  and `close()` still retains the fence if the journal differs. Do not add
  mtime/ctime or byte-identical-rewrite rejection merely to manufacture a RED.
- Next action, and only this: prerequisite audit for native messaging / IPC to
  Devices, still read-only. Compare field-by-field the closed request/state/
  operation contract in `device-control.js`, the frame/MAC/origin checks in
  `device-native-host.mjs`, the IPC response/validator in `device-owner.mjs`, and
  the lifecycle observation shape; record the exact discrepancy list before any
  code change. This is not installed-host, Chrome-origin or tunnel acceptance.

### Known-Unsent Receipt Survives Owner Close — 2026-11-04

- HEAD is still `550a8a3`. This round adds only uncommitted edits to
  `native/desktop-commander/device-operations.mjs` and its adjacent
  `device-operations.test.mjs`; nothing was committed or pushed.
- Gap fixed: after a pre-effect admission write/fsync failure the living owner
  knew the mutation never ran, but `close()` dropped that in-memory knowledge.
  A reopen then mapped the retained `in-progress` row to `unknown`, so no
  `not-executed` receipt was queryable. RED: `node --test device-operations.test.mjs`
  gave 21 total / 20 pass / 1 fail / 0 skip, actual `unknown` versus expected
  `not-executed` for the same operation ID.
- Fix: `close()` now revalidates the journal, settles each known-unsent ID through
  the existing same-owner recovery rules (write `in-progress` only when absent,
  then `not-executed`), rechecks the journal, and only then releases the lease.
  If that settlement cannot be persisted, close still proceeds and a reopen
  honestly reports `unknown`; the effect is never replayed. GREEN: the same
  command gave 21 / 21 pass / 0 fail / 0 skip. Full `npm.cmd test` in
  `native/desktop-commander` gave 151 total / 147 pass / 4 explicit platform
  skips / 0 fail (baseline before the change: 150 / 146 / 4 / 0).
- Not covered here: no IPC/Devices change, installed host, registration, service,
  credential, SSH, tunnel or deployment. This is source/fixture evidence only and
  does not mean the tunnel is connected.
- Next action, and only this: before changing code, write a RED for the remaining
  closed-loop claim that "a journal replaced during an awaiting status query can
  still return an old receipt". The existing content-replacement and
  identical-byte inode-replacement cases already return `ok:false` and retain the
  owner fence, so reproduce the actually uncovered variant first; do not assume
  the claim is true and do not reopen already-finished receipt/IPC work.

### Resumed interruption checkpoint — 2026-11-04

- Progress: the source already contains known-unsent admission recovery, post-await journal checks, and the local IPC/native-message bridge; preserve these rather than reimplementing them.
- Last observed evidence before interruption: the operation test file executed 15 tests, 15 passed, 0 failed, 0 skipped; this is not a fresh installed-host or tunnel acceptance.
- Correction: removed the interrupted-round paragraph asserting that awaited-status replacement still returns an old receipt: that assertion was not established by a failing test. Current source already rechecks journal identity/bytes after the await; test any stronger claim before changing it.
- RED evidence: operation suite 16 total / 15 pass / 1 expected fail / 0 skip; recovered admission-fsync failure returned `settled` instead of requested `not-executed`. Existing awaited-content-mutation and new identical-byte inode-replacement tests both reject old receipts. No journal-replacement bug was newly reproduced.
- Operation GREEN: 17 total / 17 pass / 0 fail / 0 skip after recording `not-executed` as a distinct durable terminal result for same-owner known-unsent recovery. No-write and fsync-failure cases are covered; reopen/duplicate IDs do not replay the effect.
- IPC/UI RED-to-GREEN: the closed IPC validator initially rejected `not-executed`, and the UI initially rendered an empty operation label. Both now recognize the distinct terminal result; Devices clears only the matching pending ID/action, with no automatic mutation.
- Fresh regression: native 111 total / 110 pass / 1 Linux-only skip / 0 fail (18 IPC cases included); Devices 58/58 Node tests and 12/12 synthetic UI checks. A real spawned owner/bridge fixture proves fsync-failure recovery through the existing sendNativeMessage adapter, page reload and duplicate-ID non-replay. This substitutes the Chrome transport and is not installed-Chrome acceptance.
- Independent review found an Important repeated-recovery failure: removing the same-owner `notApplied` marker before the final poison-clearing fsync can strand a live owner after a `not-executed` query. Three staged recovery-fsync tests reproduced RED at step 3 (2 passed / 1 failed); the marker is now deleted only after the final durability check succeeds. Post-fix operations20/20 + IPC18/18 pass (38 total, no skip/fail); fresh independent reviewer reread the patch and reran all three recovery-failure cases (3/3), finding no remaining Critical/Important in this closure. This is source/fixture evidence, not a crash-proof or production-install certification.
- Next: proceed with the approved source-only Windows launcher/manifest adapter; the precise file/test contract is saved in `native/bootstrap/SETUP-DESIGN.md` under Windows Native Launcher Increment. Chrome documentation was freshly read in the in-app browser: executable path/stdio/exact allowed origin, HKCU or HKLM default manifest-path value, 32-bit view queried first, optional decimal parent-window argument, one host per sendNativeMessage. No registry entry was written.
- Initial launcher checkpoint (superseded by the results below): source files/tests were not yet implemented; the existing caller and setup producer use `com.agentcontinue.device_control`. Corrected the draft's shorter `com.agentcontinue.device` manifest/registry name before implementation; do not change the existing protocol to match that typo. Next: first failing launcher tests, then source-only compiler/manifest adapter, then packing and independent review.
- Launcher RED: exact-cwd `node --test native-launcher.test.mjs` executed 13 tests: 0 pass, 2 expected failures (missing compiler/transport and package allowlists), 11 explicit missing-source skips, exit 1. Tests are saved as uncommitted source only, with all generated files/processes confined to disposable temporary fixtures. Next: implement the bounded GUI transport/compiler, then rerun execution cases.
- Launcher intermediate run: 13 total, 11 pass, 2 fail, 0 skip. GUI PE/hash/manifest, binary/open-stdin transport, origin/environment/bounds/path tests and staged bridge→explicit owner passed. Expected allowlist failure remains; wall-clock lifetime test reported 35,950ms vs <35,000ms. Timestamp instrumentation is being added to distinguish pre-child process startup from the 30-second child budget; no timeout-success claim yet.
- Lifetime investigation: an instrumented isolated rerun passed with 30,766ms launcher wall clock, 760ms before the fixture received input, 30,006ms afterward, and no natural child exit. The failed total-wall-clock threshold included variable CLR/child startup. Keep the implementation's 30s post-spawn child budget; test that boundary independently from the outer 40s fixture bound, and record the startup overhead rather than claim a strict 30s OS-launch SLA.
- Packing RED: the actual-local-tarball test failed `package_file_closure_mismatch` against the expanded two-source expectation before changing either allowlist. Only `Build-NativeLauncher.ps1` and `NativeLauncher.cs` are now added to bootstrap package allowlists; the runtime payload remains 15 files. The launcher test is added only to the development test script, which the builder removes from packed metadata. Next: complete fresh launcher/packed regression and review.
- Combined launcher/packed checkpoint: 18 total / 16 pass / 1 fail / 1 explicit real-cache skip, exit 1. The real local tarball/install byte closure passed with 26 package files / 15 runtime files, and packaged compiler→staged bridge→explicit fixture owner passed. Lifetime execution instead hit synchronous Windows `spawn UNKNOWN` (errno -4094) before process creation; the earlier isolated lifetime pass remains historical, not a substitute for this failure. No automatic retry/security-setting workaround was added. Independent source review is in progress; isolate launch evidence next.
- Launch blocker confirmed: read-only Defender Operational events 1116/1117 match the owned `ac-native-launcher-` generated EXE and record `Program:Win32/Contebrew.A!ml` / `Quarantine`. Do not label this a proven false positive, repeat compiled-EXE launches, change code merely to evade detection, restore quarantine, add exclusions or disable protection. A subsequent isolated deadline probe (already started before this classification) passed at launcher30,754ms / pre-input755ms / after-input29,999ms; it does not invalidate quarantine or establish distributable acceptance. Stop runtime EXE acceptance pending classification and legitimate release/signing/remediation. Continue read-only review and non-launcher regressions.
- Fresh unaffected regressions: native 114 total / 113 pass / 1 Linux-only skip / 0 fail, including operations20 and IPC18; actual pinned MCP fixture initialized/listed25 tools and performed owned file/harmless process work without network attempts. Devices58/58 Node +12/12 synthetic UI checks passed. None proves official tunnel authentication or installed Chrome.
- Independent launcher review found one Important static defect: `Math.Min(30s, elapsed+2s)` clipped the independent post-exit drain for a near-deadline child. A source-invariant test reproduced RED (1 fail, no EXE execution); the deadline is now `elapsed+DrainMs`. Runtime boundary verification of these changed C# bytes is deliberately blocked by the Defender finding, not claimed green. Reviewer had run13/13 before the stop notification (its intended lifetime filter did not exclude that case); those old bytes do not certify the corrected source or negate quarantine.
- Final bounded-source checkpoint: full bootstrap `npm test` with Windows launcher opt-in unset executed143 total /129 pass /14 explicit skips /0 fail. Eleven skipped cases are compiler/EXE acceptance blocked by Defender; the other three are Linux-only remote setup, absent six-archive directory and absent real-provider cache. The three current launcher source checks and actual local npm tarball/install26-file byte closure passed. This green default suite does not replace the failed executable run or certify the corrected C# binary.
- Fresh independent follow-up read the corrected running/drain loops and default gate, then ran only the opt-in-unset launcher suite:14 total /3 pass /11 explicit skips /0 fail. It confirms the Important drain defect resolved at source level; near-deadline runtime behavior and Defender classification remain unverified. No reviewer is still running. Whitespace diff check passed with existing CRLF notices.
- Next: legitimate Defender classification/release remediation before any compiled-EXE acceptance. Keep `AGENT_CONTINUE_WINDOWS_LAUNCHER` unset and do not ship/install this EXE candidate meanwhile. Later separate source/deployment work remains for first-install Node/bootstrap registration, protected OS identity, production owner startup, Linux/macOS wrappers, official account/tool grants, installed Chrome and actual login recovery. Original full-device/direct-official-tunnel goal remains active; this checkpoint is not its completion.
- Boundary: no commit, push, release, registry write, production activation, new credential/service, ChatGPT/Dot tool grant, or real login-recovery acceptance occurred in this continuation.

### Source integration checkpoint —2026-11-03

- Durable operation receipts and exact pending-ID recovery are implemented in the
  source candidate. The new explicitly started `device-owner.mjs` retains one
  controller across short-lived `device-native-host.mjs` processes. Authenticated
  local IPC, fixed adjacent origin binding and bounded native frames are present;
  no HTTP/tool relay or automatic runtime start from browser status was added.
- Real owner/bridge processes and the existing Devices controller now pass lost-
  response/reload recovery without another mutation. A finite owned readiness
  child verified actual lifecycle start/stop across bridges; it was not a live
  official tunnel. Independent review found and reproduced a shutdown-ordering
  bug; the minimal fix stops the owned controller before validating IPC cleanup
  and keeps altered-channel fences. A separate open-stdin test caught a bridge
  lifetime bug, corrected by closing only the bridge input after its response.
- Current native package:108 total,107 pass,1 Linux-only skip,0 fail;17 IPC tests
  are included with0 skips. Current bootstrap:122 total,120 pass,0 fail,2 explicit
  opt-in skips (six official archives and real offline-provider cache absent).
  Devices57 Node tests plus11 synthetic UI checks, extension check and safety
  suites also passed. Do not promote the skipped historical real-asset/provider
  cases into fresh acceptance.
- Bootstrap runtime closure grew from12 to15 source/pin/lock files and its actual
  npm tarball installed-byte test covers the new modules. Binding, channel secret
  and journals are not packaged. Source inclusion is not installation/registration.
- No new commit, push, release, registry entry, credential, login hook, service,
  production activation or system/IDE/research change was made. Existing UI WIP
  and sealed archives remain.
- Subsequent setup-binding increment now generates the fixed private adjacent
  binding for local targets from the validated request, never for remote Linux.
  Identity/bytes/key exclusion are rechecked after final asynchronous verification
  and immediately before receipt commitment. Five RED-to-GREEN binding tests and
  one actual configured-package/native-bridge fixture passed; independent static
  review found no important increment defect. No registration/activation/grant
  flags were promoted. Latest bootstrap result supersedes the above checkpoint:
  129 total,126 pass,0 fail,3 explicit skips (Linux-only remote setup on Windows,
  absent six-archive directory,absent real offline-provider cache).
- Next is source-only platform first-install wrappers/registration, followed by
  installed Chrome,direct Linux,real ordinary-ChatGPT/Dot tool grants and actual
  login-recovery acceptance. The completed source IPC and binding are not those
  live deployment outcomes.

### Next active goal continuation — 2026-11-04

- Scope selection: reviewed current Devices/Setup/owner source and approved architecture; remote Linux setup already prepares profile/state but intentionally no Chrome binding, while the only owner CLI requires that binding. Preserve completed receipts/IPC and close this deployment gap instead of repeating it.
- Selected source increment: shared owner core with native unchanged and binding-free same-account server wrappers, plus foreground `device-server.mjs serve --state-dir ABS` / narrow correlated `request` CLI. Exact contract is in `DEVICE-CONTROL.md` under Direct Server Owner Entry Increment. Initial design-only status is superseded by the implementation/test checkpoints below; no service, login hook or production connection will be installed.
- Fresh external evidence: in-app Chrome native-messaging page confirms separate Linux/macOS manifest locations and one host per sendNativeMessage. Visible official onboarding screenshot confirms provisioned tunnel ID, runtime key Read+Use and separate admin key; this is current-doc evidence, not pinned-version authentication acceptance.
- Linux execution environment check: `wsl.exe --list --quiet` exited1 and reported WSL not installed. Do not install it implicitly or call Windows named-pipe fixtures Linux validation.
- Windows generated EXE quarantine remains unresolved. Keep its opt-in unset; the next Node/server source work is not remediation or acceptance of that binary. Original browser-control-center/direct-official-tunnel/multi-platform/login-recovery goal remains active.
- Resumed checkpoint: current source/contract and HEAD550a8a3 with existing WIP rechecked. Completed receipts/IPC are retained. No EXE execution or production effects.
- Server-entry RED: exact-cwd `node --test device-server.test.mjs` executed13 total /0 pass /1 expected missing-API/CLI failure /12 explicit unavailable-source skips, exit1. The new test contract covers private root identity, independent requests, one shared owner, closed CLI, native/server separation, stale descriptors, finite-child lifecycle and shutdown; runtime cases had not run at that RED checkpoint.
- Server-entry GREEN: shared owner body now backs unchanged native binding and validated same-account server identity; the strict foreground serve/request entry emits bounded metadata only. Fresh exact-cwd operations+owner+server run51 total /49 pass /2 explicit Unix-only skips /0 fail. Independent request processes prove retained-ID non-replay, pause, no owner-on-status and native/server origin separation; a real finite owned child proves lifecycle start/stop without official authentication. The Windows signal-event fixture exercises handler cleanup, not real Unix signal delivery.
- Package inclusion RED: corrected the first name filter (`actual local tarball` matched no cases; its file-only green is not acceptance). Exact `actual local npm tarball` selected1 test and failed `synchronous_builder_result_mismatch` because production still builds15 runtime files while the test now requires16. No npm tarball/install ran at this RED boundary.
- Package inclusion GREEN: added only `device-server.mjs` to the runtime allowlist and updated fixed-count/test-script expectations. The actual local npm tarball was built and installed into a disposable prefix:1/1 passed,27 package files/16 runtime files, exact installed bytes and bin metadata/help/version/refusal verified; registryPublication:false. First source review subsequently completed below; no EXE gate enabled.
- Fresh unaffected regression: full native127 total/124 pass/3 explicit Unix/Linux-only skips/0 fail; includes actual pinned MCP25-tool initialization, owned file roundtrip and harmless process with0 network/browser attempts. Devices58/58 Node +12/12 synthetic UI, extension check4/4 passed. These are Windows/source fixtures, not Linux sockets/signals/login, installed Chrome or official platform authentication.
- Complete default-bootstrap regression passed143 total/129 pass/14 explicit skips/0 fail with EXE opt-in absent. The same11 Defender-blocked executable cases plus3 preexisting platform/assets/cache cases remain unexecuted; actual27-file tarball and16-runtime byte closure is included, not a registry publication.
- Independent read-only reviewer reran the bounded51-case suite (49 pass,2 Unix skips), found0 Critical/Important, and noted missing startup-shutdown/concurrent-start/in-flight-root-replacement coverage. Reviewed SHA256 owner5d2e0629d0a4a0da131246a80f90b9e9328edfc73b5e1c4939bf2b2f3a725eda; server54ef92745cebd93d67349c2e9c2dcf7b27af75e1aa9f4d1baf98222598b52266; tests1a4dde5b5cd11aa2eacde9534dc4720e9fafc1062ea1ce85b2611653be3bd2e8. Reviewer is finished. Added three focused boundary tests; concurrent foreground startup passed, but the combined probe then hung before the root-replacement case reported and was explicitly stopped at60s. Diagnosis isolated Windows EPERM renaming the state root while the journal is open; the fixture initially failed to release its held controller on that setup error, hanging teardown. Cleanup now releases/restores in finally, exposing the real EPERM rather than hanging. Mark the live-root-rename case explicitly Unix-only, not bypassing open-handle behavior; pre-open replaced-root validation remains covered on Windows. The initial startup-signal probe failed at the12s watchdog, but that was ambiguous: its unfiltered fixture `once(message)` consumed stop and never saw continue. Corrected that fixture before restoring the original CLI and retrying; no production fix is justified by the initial watchdog alone. The first watchdog alone was not valid proof of lost stop intent. After correcting the fixture listener, restored original CLI reproduced genuine RED in100ms: advertisedListening:true after the acknowledged stop, failed clean-exit assertion. Minimal fix now registers serve signal handlers before async imports, retains stop intent and closes a subsequently created owner without emitting listening. Fresh operations+owner+server GREEN:54 total/51 pass/3 explicit Unix-only skips/0 fail; startup signal returns code0/signal:null/advertisedListening:false and disposes the owned channel/journal lease. Live root replacement remains skipped on Windows for the observed EPERM, not validated by another platform. Final affected regressions then passed native130 total/126 pass/4 explicit Unix/Linux skips/0 fail and bootstrap143 total/129 pass/14 explicit skips/0 fail including actual27/16 local-tarball bytes for the changed server source. Devices58+12 synthetic UI and check4 remain the unchanged-caller results above. The first follow-up invocation failed before execution because its resume ID was unavailable; replacement independent reviewer has now completed actual54-case rerun (51pass/3explicitUnixSkip/0fail), confirmed the startup test is not a false positive and found0Critical/Important. Minor coverage not claimed: SIGINT/repeated signals and stop during the outer dependency import. Final reviewed SHA256 owner5d2e0629d0a4a0da131246a80f90b9e9328edfc73b5e1c4939bf2b2f3a725eda; serverb477385f7173300113d852f1e4f8c2ac58f07582fd2898803108e04102312f8b; testsb41456aae6effb13181ba88cf32f36cd26abbdd1fba208ee560f1de239fc3f4d; payload-layout0766a4b1a7460bd99d53f43f6b999b56e520e6c3575771ede0869c041c5794dd. Reviewer did not rerun pack; the principal's fullbootstrap run above did. No production effect or EXE test occurred; no reviewer remains running.
- Current next action after this source milestone: retain exact unresolved Windows classification/EXE gate; continue the browser control-center's authorized SSH management adapter/first-use deployment path and real cross-platform/login/platform acceptance, rather than repeating completed receipt/IPC/server-entry code. Live Linux execution requires an available explicitly scoped host/runtime; WSL is absent here. Source/tarball fixtures are not an installed Chrome origin or a connected official ChatGPT/Dot tool.
- New continuation checkpoint: goal6ae9e8a9ea64c4b1ecd6e0ec confirmed active; HEAD550a8a3/WIP and completed server milestone rechecked. Last verified full results remain native130/126pass/4UnixSkip and bootstrap143/129pass/14explicitSkip; they have not been freshly rerun in this increment.
- Selected source-only slice: trusted local SSH target metadata → existing native bridge/server request → target-isolated Devices receipts. Initial read-only inventory found no canonical SSH registry/adapter; the five-field setup export is not that registry. This design-only observation is superseded by the source implementation below, not by a real enrollment/deployment.

### Authorized SSH wiring checkpoint — 2026-11-04

- Progress: private enrolled descriptor/known-hosts hash yields an immutable target ID; native v2 transports only target/id/action to one fixed noninteractive SSH request. Existing native/server v1 remains unchanged. Devices target-scoped locks, revisions and pending IDs plus fixed `?target=` selection are connected; invalid selection cannot fall back to the local device. No owner autostart/tool relay, production SSH, new credentials, system registration/service, EXE probe or publication.
- Last verified bounded evidence:12/12 SSH source/Node process fixtures,60/60 Devices Node,13/13 synthetic UI; actual npm local tarball/install28 package/17 runtime bytes passed. This is not actual OpenSSH/Linux/installed Chrome/official tunnel acceptance.
- First independent reviewer found known-hosts paths permit OpenSSH `%h`/`${HOME}` expansion that escapes literal-byte/hash binding; RED reproduced missing rejection for `%h keys`, then the local enrollment reader rejects expansion/control/quote characters. Full second read-only review found no verified runtime Critical/Important in its scope; it did find two regression wiring issues during active edits: default test omitted SSH, and native-launcher source closure still expected16 runtime files. Both have separate RED evidence, were corrected, and passed the fresh full reruns below.
- Fresh complete regression after both gate fixes: native142 total/138 pass/4 explicit Unix/Linux skips/0 fail; bootstrap143 total/129 pass/14 explicit skips/0 fail, including actual28-file npm tarball/install with17 runtime files (11 EXE tests remain Defender-blocked, plus3 existing platform/assets/cache skips). Devices60/60 Node+13/13 synthetic UI, extensioncheck4/4, gitdiff--check0 (CRLF warnings only). Fixture process scan found0 matching owned temporary Node processes. AGENT_CONTINUE_WINDOWS_LAUNCHER is unset; no generated-EXE invocation.
- Final fresh independent follow-up: SSH12/12 and default launcher14 total/3 pass/11 Defender-blocked skips/0 fail; no remaining Critical/Important in that scope. Rechecked the test inclusion,17-file runtime closure and `%h`/`${HOME}` rejection. The review bound the owner/SSH/native-host/package/payload path/hash vector by combinedSHA2567656fb147133cd730f4e8b411de2722091609bbc4b2731ddadd4a0be74e08e3d; no source file changed during review. One earlier follow-up resume ID was unavailable, so a fresh independent reviewer performed this closure instead.
- Next: trusted target enrollment/first-use installation, then real SSH/agent/host-key/login/platform acceptance, keeping those evidence levels separate. UI first-use enrollment/installer remains unreleased; no copied EXE or fake OpenSSH wrapper was manufactured to claim integration. Preserve temporary-pause versus persistent-disconnect/revocation semantics; automated SSH management is not interactive SSH login. Full goal remains active, source uncommitted, production unchanged.
- New goal continuation checkpoint (scope-only; superseded by the increment below): preserve the completed SSH wiring/review above and inspect the trusted local enrollment producer/device-selection link. Its last evidence was the142/138+4 native,143/129+14 bootstrap,60Node+13syntheticUI,28package/17runtime result above, not a live deployment.

### Trusted SSH enrollment checkpoint — 2026-11-04

- `device-enrollment.mjs` and the closed `enroll-ssh` CLI now create only a first
  adjacent registry from the staged local manager's fixed binding plus trusted
  OS/remote paths and an independently checked known-hosts digest. It returns an
  opaque Devices selection link and false authentication/registration/tool-
  authorization/activation flags. Initial RED:3 failures +12 missing-API skips;
  initial GREEN15/15. Actual local npm tarball/install and installed CLI2/2 with
  29 package/17 runtime files. Five-field Setup remains unchanged; bilingual
  optional remote-management guidance added. This does not implement the missing
  remote-only manager first installer or prove real SSH/connected tools.
- New probe blocker: the supplemental fresh-import test first failed by blocking
  Node24 ESM loader `realpathSync`. After correcting loader/application
  distinction, Windows child launch failed (status null, then `EPERM`). Read-only
  Defender Operational1116/1117 events identify the exact owned Node
  `--input-type=module -e` probe as `Trojan:Win32/SuspExec.SE`, action Remove.
  Stop this probe; do not label false positive, rerun/re-encode/move to evade
  detection, restore, exclude or disable protection. Keep
  `AGENT_CONTINUE_IMPORT_EFFECT_PROBE` unset. The Windows import-runtime check is
  now an explicit blocked skip, not a pass. This is separate from the EXE
  quarantine. Production enrollment bytes remained unchanged; unaffected source
  and fixture checks may continue.
- Supplemental publication-failure branches all passed (unlink, extra hard link,
  same-byte inode replacement, invalid readback), with no false success or record
  repair. Independent spec/quality reads found no confirmed production Critical/
  Important; their runs predate the final probe gate and do not certify import.
  Final regression completed: bootstrap161 total/146 pass/15 explicit skips/0
  fail (11 EXE,1 import probe,3 existing platform/assets/cache), actual29-package/
  17-runtime tarball+installedCLI; native142/138pass/4 Unix/Linux skips; Devices60
  Node+13 syntheticUI; Setup15 Node+19 syntheticUI; check4 all pass. Final independent
  reviewer confirmed skip-before-spawn and reran enrollment17 (16pass/1blockedskip)
  plus source/VM9/9, no confirmed C/I. Reviewed production enrollment SHA256
  ca9cfafe036f1183ae758eb6d78483972f3a81b84ad62389146664e09282d55f;
  current11-source/test/config path/hash vectorSHA256
  2A140756C74FAE3C502414727155903B0ECE7048AC1E08A8430266A246A2C094
  (sorted relativepath SPACE uppercaseSHA256, LF join, no terminal newline).
  In-app browser actually verified English→Chinese guide, Linux-server-only
  visibility, fixed manual link, no new inputs and empty simulated native calls
  on the owned loopback page. A first child-with-parent fixture exited; bounded
  Shell-owned server worked, was stopped; temporary tabs closed and final owned
  fixture-process scan0. This is not installed-extension/live-device evidence.
- This checkpoint's manager-only next-action pointer is superseded by the
  manager-only increment below. Keep protected launcher/registration and actual
  platform gates separate; do not replay either Defender probe or the completed
  enrollment adapter. No production SSH, credentials, registry/service/elevation,
  generated EXE, commit or publication occurred in that increment.


### Key-Free Local Manager Preparation — 2026-11-04

- `device-setup.mjs` now exports `setupManager`; closed `setup-manager` accepts
  only a new local install destination, full-account consent, a canonical local-
  platform five-field browser request and optional provider offline cache. It
  rejects linux-server requests as local managers. It stages the pinned provider
  once, prepares private state, and writes an exact extension binding accepted by
  the actual installed reader. No irrelevant local runtime key, client download,
  local tunnel profile, owner, SSH, service or browser grant is required/started.
  Native registration/protected first installation is still a separate gate.
- The final create-only `manager-receipt.json` says prepared and
  localTunnelConfigured:false, with authentication/registration/authorization/
  activation/protection/dependency verification false. Partial targets are not
  repaired. Retained identities, request/binding bytes and the final synchronous
  commit boundary prevent the covered stale-success cases; this is not Windows
  protected ACL verification or proof against an arbitrary same-account adversary.
- TDD first observed missing API/help2fail+12missingAPI skips and guide1fail9pass.
  Manager fixtures found two additional failures: awaited `verifyProviderStage`
  did not recheck payload/receipt, and a pending receipt could be replaced with
  identical bytes before its first identity snapshot. Added post-import payload/
  lock/receipt verification and retained an opened receipt fd before writing.
  Separate post-import RED1→GREEN1; manager14/14 and guide10/10 then passed.
- Independent quality review confirmed non-enumerable signal/offlineCache/trusted
  data fields passed schema validation but were dropped by object spread. Two
  normal test-runner cases reproduced RED2, then GREEN2 after copying all already-
  validated own data properties. Null-prototype/non-enumerable offline acquisition
  and pre-abort-before-I/O are covered. Final await also covers install/app/state
  directory same-byte replacements (7 mutation branches), not just changed bytes.
- Actual local npm pack/install now invokes installed `setup-manager`, then
  installed `enroll-ssh`, then the actual packaged binding/target readers. Provider
  acquisition in this chain is a disposable copier of pinned genuine provider
  bytes, not a live npm-registry acquisition or a real SSH invocation. Closure
  remains29 package/17 runtime files. Five-field export and fixed manual Devices
  link are unchanged; bilingual guide now distinguishes the two request targets
  and key-free manager preparation. Setup16 Node+19 syntheticUI, native142 total/
  138pass/4UnixLinuxSkip, Devices60 Node+13 syntheticUI and check4 freshly passed.
- In-app loopback UI actually selected Linux server, showed both source commands,
  switched English→Chinese, confirmed no new fields/authority calls and the fixed
  manual link; selecting Windows hid the guide with zero simulated authority
  calls. The temporary tab closed and the bounded owned server stopped; final
  owned-process scan0. This is not installed-Chrome evidence.
- Fresh post-fix full bootstrap passed176 total/161 pass/15 explicit skips/0fail
  (11 blocked EXE,1 blocked import probe,3 existing platform/assets/cache cases),
  including the actual29/17 installed-package chain. Spec review found no confirmed
  C/I; a fresh final independent reader checked the non-enumerable correction and
  reran the exact two ordinary test-runner cases:2pass/0fail, no remaining confirmed
  C/I in scope. One completed-reviewer resume ID was unavailable; the fresh reader
  replaced that follow-up without manufacturing a successful resume. Both Defender
  opt-ins remain unset; no blocked EXE/import probe retry, real credentials,
  registry/service/elevation, production SSH, commit or publication.
- Verified source/test byte vector (sorted relative path + SPACE + uppercase
  SHA256, LF separators, no final newline):
  CA30DA62DC4D9F9CAE84238305A8A32F8B986B4C5B01CC68565D3BE595679052.
  The11 paths are native/bootstrap/{bin.mjs,bootstrap.mjs,bootstrap.test.mjs,
  device-enrollment.test.mjs,device-setup.mjs,device-setup.test.mjs,packed.test.mjs},
  setup.html,setup.js,tests/{setup-handoff-source-tests.mjs,setup-ui-tests.mjs}.
  setupManager producer file SHA256:
  B1BA509F12EC7F00BC6AEE1F48AC1662516BF225D878E00E5607C6D216F6DCB7.
  Main defect reproduction/final evidence used ordinary test-runner files. The
  initial quality reviewer separately used a command-line import for the
  non-enumerable diagnosis; it was not the blocked fresh-import effects probe,
  and no new security detection was reported. Further --input-type probes were
  prohibited; original blocked probes remain unexecuted in this increment.
- Next full-goal work remains protected native installation/registration and
  first-owner/startup integration, actual OpenSSH/agent/host-key/server acceptance,
  Linux/macOS validation, official ChatGPT/Dot grants/representative tools and
  real interactive-login recovery. Preserve direct server→official OpenAI MCP
  data and separate optional SSH lifecycle control; no developer relay. Do not
  repeat the completed manager/enrollment/IPC/server/SSH source adapters.

### Runtime Shutdown Preserves User Intent — 2026-11-04

- Actual product source audit identified that ordinary owner `dispose` invoked
  `pause`, thereby replacing the user's running intent with manual pause. This
  would defeat later login/startup recovery. The bounded source correction is now
  implemented in existing lifecycle.mjs: explicit pause persists first; shutdown
  stops only its owned runtime via a shared no-persist stop and releases only
  after confirmed parent/core exit. Reopen preserves intent but never autostarts.
  Missing intent remains missing and defaults paused; old v1 true stays paused.
- Both dispose and shared stop reserve their promises before invoking reentrant
  observers, cancellation listeners or child signaling. A newer explicit pause
  still persists while sharing the existing stop, without extending its deadline
  or sending a second signal. Stop uncertainty retains lease/ownership and fixed
  errors; no invented disconnect, replay or new child. Native envelopes/UI/journal
  schemas and the29/17 package/runtime closure are unchanged.
- Sequential fresh contract comprehension and criticism/readiness reviews operated
  on the written source contract. Criticism added explicit timeout-budget and
  accepted-suite coverage. TDD observed6 corrected dispose cases RED plus1 actual
  default-controller server shutdown RED, then GREEN. Additional shared-budget/
  confirmed-observer coverage passed; a synchronous signal callback reentering
  pause exposed2signals vs1, RED, then GREEN after pre-reserving shared stop.
  An initial test referenced a nonexistent fixture counter; it was corrected to
  the existing pauseAtSignal evidence before asserting the actual2vs1 defect.
- Fresh final native150 total/146pass/4UnixLinuxSkip/0fail; lifecycle33 pass and
  lifecycle+server49 total/46pass/3platformSkip. Devices60 Node+13syntheticUI and
  check4 passed. Final full bootstrap176total/161pass/15explicitSkip/0fail also
  passed against the current lifecycle bytes, including actual29/17 npm tarball
  and installed manager/enrollment consumers. Its skips remain11blockedEXE,
  1blockedimportprobe,3existingplatform/assets/cache. Earlier149/145 and interim
  bootstrap results are historical, not the final-byte proof. Fresh final
  independent read-only review found no confirmed C/I in scope and actually ran
  the49-case lifecycle/server suite once:46pass/0fail/3Windows platform skips.
  Its first PowerShell wrapper had a quote-parse failure and did not start tests;
  corrected ordinary test-runner execution succeeded. Neither opt-in was set.
- Current fourteen-source/test vector combines the manager11-path vector with
  native/desktop-commander/{lifecycle.mjs,lifecycle.test.mjs,device-server.test.mjs}
  using the same sortedpath SPACE uppercasehash LF/no-final-newline recipe:
  ED19B8376C76C066119614EEE9E2E915B9435D39948E453EABF143F71A35CD67.
  lifecycle.mjs SHA256:
  B40C1AA6BC4C99BEE477D9C8FF44374D54795EDC3998B8478A8A8EFC098779E5.
- This is only the shutdown prerequisite. Product lifecycle still uses v1 bool;
  temporary pause vs stay-disconnected, real Windows token/session login and real
  interactive Linux SSH login sources, deduplication, startup/registration and
  actual official ChatGPT/Dot authorization/recovery remain missing. Do not treat
  saved running intent as startup permission, classify noninteractive management
  SSH as login, add browser-reported login or auto-resume manual pause. No real
  SSH, credentials, registration, service, elevation, blocked-probe rerun or commit.

## Read This First

This is one project with two distinct capabilities: an existing prompt scheduler
and an unfinished direct-device integration. Do not confuse a scheduled prompt,
a running process, a configured profile, or a successful local fixture with
successful model inference, completed research, or a connected authorized device.

The last browser-verified stable GitHub release is **v2.2.0** at the handoff
checkpoint. The owner's two newly supplied screenshots on November3 show the
Chrome Web Store item's **Published · public** state and both Draft/Published
version **2.1.0**, for item `jpioilmpbolfokedaefmbfbjeaahfdkl`. This supersedes
the earlier2.1.0 Pending review/public2.0.1 action pointer. It is user-supplied
screenshot evidence, not a fresh automated dashboard readback or proof of2.2.0
store publication/native support. No store package was uploaded or changed by
this continuation; GitHub development/releases need not wait for store parity.

The newly verified device-bootstrap package is **private 0.3.0**, not extension
v0.3.0 and not an npm publication. No stable extension tag, store upload, production
activation, native registration, new OS privilege, or startup policy is implied.

The companion handoff archive preserves the complete project working-source
snapshot, including unshipped Devices/Setup candidates; a Git bundle of main and
tags; the remaining tracked-file patch; file inventories and checksums; and this
document. The local full archive additionally includes legacy prototype source
and public offline assets where available. It deliberately excludes credentials,
browser profiles, private prompts, research files, production state and npm caches.
Those are not needed to reproduce source development and must not be published.

## Product Intent And Decisions

The owner wants a free, open-source, English-default extension with optional
Simplified Chinese, one canonical `main`, and prominent developer/support links.
User prompts, imported files, labels and conversation titles stay untranslated.
GitHub may lead store review; package, CI, Release, store submission and public
availability are separate evidence levels.

The expanded goal is straightforward onboarding to full file, shell and process
access under the actual selected OS identity, including explicitly authorized
administrator/root use. It supports both ordinary ChatGPT and Your dot. It is
**not** a status-only service, VM, container, product directory sandbox or command
allowlist. One complete informed consent should describe the workflow; internal
validation receipts are not repeated mandatory approval dialogs. Real OS and
platform grants still have to exist; a browser checkbox cannot manufacture them.

The data path must be direct:

```text
Prompt scheduling: extension -> selected ChatGPT/Dot composer

Device control plane: extension -> installed native coordinator -> OS lifecycle

Device tool data path:
ChatGPT / Dot <-> official OpenAI tunnel <-> target device <-> MCP stdio core
```

No Vercel/developer command relay and no permanent Windows relay for remote
Linux. Windows may be an initial SSH deployment entrance, not a runtime dependency
for the server. Existing private production MCP deployments are predecessors,
not proof that the reusable Agent Continue product is deployed.

## History And Why The Design Changed

| Stage | Motivation, implementation and correction |
| --- | --- |
| Early 0.1 prototype | Repeat a custom prompt in one existing chat; start/pause/check, token/deadline and draft protection. Historical unknown delivery could pause the task. |
| 0.2.0, October 23 | Dot support, default 20-minute unlimited repetition, queue/file import, local console, restart recovery and bounded offline PDF resources. Unknown submission became a retained unknown cycle, not immediate replay. |
| 0.2.1 | Real reports of text filled but not submitted motivated stop/reidentify/fill/send and preservation of unrelated drafts/attachments. |
| 0.2.2 | Dot Ctrl+Enter versus ordinary ChatGPT button handling; single-mechanism keyboard contract. Native keyboard acceptance is not synthetic-event acceptance. |
| 0.2.3 / 1.0 / 1.1 | Experiments added MAIN-world/editor internals and multi-path fallback; UI widened to 650px, restart/route and message markers improved. Some historical release claims overstate guarantees and are superseded below. |
| 2.0.0, November 1 | Source and exported activity review exposed ambiguous `unconfirmed` logs and duplicate-submit risk. Returned to one permitted mechanism per attempt; removed internal React/ProseMirror replay and immediate fallback. Unknown is neither confirmed success nor definite failure. |
| 2.0.1 | Corrected outdated multi-path UI claims and generated synthetic English store assets. Fixed store packaging: root manifest and missing content.js. |
| 2.1.0, November 2 | English default/Chinese switch, docs/privacy/store copy, user text preserved, canonical main. Store submission and automatic-after-approval setting were observed separately from GitHub release. |
| 2.2.0, November 2 | Developer support, email/GitHub/LinkedIn, optional reviewed diagnostics, schema 3 export, malformed-log recovery and separate language/export errors. Native candidate excluded. |
| Private MCP predecessor | Hosted Desktop Commander Remote established the use case. The owner required private official-tunnel direct Linux/Windows operation, manual pause/revoke and no focus stealing. Private privileged prototypes and source-stage tests were not a distributable first-install product. |
| Reusable native core | Reused pinned open-source DesktopCommanderMCP 0.3.1, not its commercial hosted `remote` launcher. Added consented full-account configuration, telemetry-off before import, fixed stdio path, owned lifecycle and profile verification. |
| Bootstrap 0.1 / 0.2 | Added locked acquisition without install hooks, then six-platform pinned OpenAI runtime-only v0.0.19 acquisition. Fixed Windows npm prerequisites, bin CRLF rewrite, unconfirmed child exit, case aliases and inflater ownership/cancellation. |
| Bootstrap 0.3, this checkpoint | Browser's five-field request now composes acquisition, state and official profile in one consented setup command. Final receipt says configured, never authenticated/activated. Actual packed-installed-bin preparation passed locally. |

This reconstruction uses the current source, Git history, changelog, reviewed
notes and the owner's instructions. It is not an export of every personal chat.
`git-log.txt` and `history.bundle` preserve the available canonical code history.
The first handoff assembly exposed a shallow-clone problem: verification inside
the original shallow repository passed, but a clean offline clone lacked a
parent commit. Complete origin history was fetched, and the handoff builder now
refuses shallow sources and actually clones/checks out its bundle in a separate
directory, then checks that the pending patch applies. Use the verified handoff,
not the superseded initial archive. No production runtime was involved.

## Scheduler Contracts To Preserve

1. One submission mechanism per attempt; no forced-enable button, immediate
   fallback click, internal event-handler replay or claim of exactly-once delivery.
2. Require a current background permit and matching target/conversation identity.
   Preserve drafts, user whitespace edits and detected attachments.
3. Only a matching new user-message marker confirms submission. Empty composer,
   busy spinner, process lifetime or CPU activity alone are insufficient.
4. Unknown does not increment confirmed count. Wait the full normal interval;
   another interval can still duplicate a previously accepted unknown message.
5. Pause cannot retract an already dispatched submission. Missing target recovery
   must not create or select another chat silently.
6. Do not activate user tabs, use system clipboard, add telemetry, or infer uptime
   from keepalive. Background freezing and website changes remain real limits.
7. Keep support diagnostics local/manual, bounded to 200 allowlisted records.
   Schema 3 omits stored free text and unknown fields, includes extension version,
   defaults to relative timings and requires opt-in for exact timestamps.

Earlier claims of absolute delivery, no possible focus change, in-memory
encryption or permanent browser compatibility are not current guarantees.
See [Validation](../VALIDATION.md), [Privacy](../PRIVACY.md), and the changelog.

## Current Source Map

| Location | Responsibility and status |
| --- | --- |
| background.js / config.js | Scheduler state, permits, alarms, persistence and recovery |
| adapter.js / content.js | Page checks and single submission path; not native command transport |
| popup.* / i18n* / static-locale.js | Console, English default, Chinese preference |
| support* / activity-export.js | Developer contacts and minimized diagnostic export |
| scripts/package.py | Explicit extension file allowlist; official stable artifacts come from their tag |
| device-control.js / devices.* | Unshipped separate device control page/protocol, optional nativeMessaging |
| setup-model.js | Pure canonical browser request producer; now adopted by verified bootstrap tests |
| setup.* | Unshipped browser guide, target review and explicit local request download |
| native/desktop-commander/ | Pinned provider launcher, profile, consent/state and owned lifecycle source |
| native/bootstrap/ | Private dependency-free package builder, acquisition and setup0.3.0 |
| native/bootstrap/*DESIGN.md | Acquisition/client/setup contracts and bounded failure semantics |
| .github/workflows/ | Extension CI, native platform checks, vMAJOR.MINOR.PATCH tag release pipeline |

Read [native architecture](../native/README.md),
[bootstrap usage](../native/bootstrap/README.md),
[setup design](../native/bootstrap/SETUP-DESIGN.md) and
[device candidate](DEVICE-CONTROL.md) before working on the native integration.
The latter includes historical private-prototype checkpoints; current standalone
bootstrap details supersede its older upstream-pin and consumer descriptions.

## What The Pending Browser Candidate Actually Does

Devices and Setup are independent of scheduler start/pause. Opening either page,
selecting a chat or exporting a request grants no ChatGPT tool access. The
candidate native-messaging envelope uses version/id/action and correlated state
and mutation receipts; do not substitute a generic health response for a matching
completed operation. Status, disconnect-and-pause and reconnect are control-plane
actions, not restrictions on the eventual MCP tools.

The setup request is exact UTF-8/LF pretty JSON with ordered fields:

```json
{
  "format": "agent-continue-device-setup",
  "version": 1,
  "target": "windows",
  "extensionId": "jpioilmpbolfokedaefmbfbjeaahfdkl",
  "nativeHost": "com.agentcontinue.device_control"
}
```

Other targets are macos, linux and linux-server; server nativeHost is null. The
actual installed extension ID must be used. The request contains no shell command,
path, account, credential or approval flag and is not an authentication token.
A browser extension cannot install its own first native host. Never claim that
the current guide has completed native registration or actual platform grants.

The pending Devices UI still uses per-mutation dialogs and a persisted uncertain
operation journal. This predates the owner's later preference for one complete
onboarding consent. Reconcile that experience in the resumed development; do not
silently weaken request/identity matching or clear an uncertain dispatched action.
The existing private legacy native protocol and browser candidate protocol are
not drop-in compatible. A matching settled receipt is not necessarily success.
These pending UI sources have not received a fresh full browser-suite rerun at
this handoff checkpoint; preserving them is not releasing or certifying them.

## Latest Verified Native Increment

The private package is built from `native/bootstrap/build-package.mjs`, packed
with npm locally and installed into a review/test prefix. It has no lifecycle
scripts or direct dependencies; the runtime payload supplies a pinned lockfile.
Exact packed closure: **21 files**, including **12 runtime payload files**.

```sh
agent-continue-device setup --install-dir "<new-absolute-directory>" --consent full-account --setup-request "<browser-request.json>" --tunnel-id "<complete-official-id>" --runtime-key-file "<existing-device-local-key-file>"
```

This is an installed local private-package command, **not an advertised npm
registry npx command**. Node22.12+ and a trusted existing npm are prerequisites.
The command stages provider0.3.1 and official runtime0.0.19, prepares INSTALL/state
and a fixed official profile. Key metadata/reference only; no key copy. Key/input/
cache/source/toolchain collisions reject before content acquisition. Existing
destinations and partial installations are never silently repaired or replaced.

Final create-only compact setup-receipt.json reports configured=true. Activation,
authentication, native registration, chat authorization, protected installation
and native dependency usability remain false/unverified. Extension ID is retained
for future binding, not registered. No actual runtime/service/task is started.

Provider npm has a finite180s budget and disabled hooks/config inheritance. Client
acquisition has a cooperative60s budget, fixed official HTTPS/pins and a finite
worker owning decompression resources. Cancellation before receipt commit fails;
successful create-only link wins over later cancellation/temporary cleanup errors.
An unknown child exit retains files and ownership uncertainty, never a false stop.

macOS ZIP hash/profile preparation does not establish Gatekeeper approval. The
[official v0.0.19 README](https://github.com/openai/tunnel-client/blob/v0.0.19/README.md)
supports Homebrew for production. Do not bypass notarization/Gatekeeper checks.

## Bugs Found, Reproduced And Fixed

| Failure | Consequence / correction |
| --- | --- |
| Combined unconfirmed log category | Could not distinguish failure from accepted-but-unobserved submission. Added bounded classifications/timing; do not reinterpret176 rows as176 sends/failures. |
| Multi-path submit replay | Potential duplicates. One mechanism and no immediate fallback in2.0.x. |
| Store archive layout/content omission | Root manifest/content.js fixed and archive tests added. |
| DevTools copy() inside asynchronous callback | Console helper unavailable there; manual minimized export evolved into supported diagnostics UI. |
| Windows npm missing environment / notifier | Preserved required SystemRoot/ComSpec/PATH, disabled update notifier, retained typed exit diagnostics. |
| npm bin hashbang CRLF rewriting | Builder canonicalizes the hashbang before packing. |
| Hidden unzipper inflater resources | Owned finite worker with awaited termination, genuine-deflate cancellation regression. |
| macOS/case aliases and unknown nested exit | Physical dev/inode ancestry checks; no unsafe fixture deletion merely because outer CLI closed. |
| Key aliases request/archive/cache | Metadata-first exclusions before content reads; not runtime directory restrictions. |
| npm metadata symlink to key | Actual RED read attempt, then metadata redirects/nonregular files rejected before contents. |
| Key renamed onto request | Actual RED retained-fd key read, then saved key dev/inode excluded before read. |
| Profile removed during final await | Actual RED false configured success, then reinspection after final async verification. |
| Pretty versus compact final receipt | Exact byte regression retained; compact receipt fixed without changing request encoding. |

These checks are not a privileged, race-free filesystem attestation. Other
same-user mutations and unexercised dependency/platform behavior remain risks.

## Evidence At The Pause

| Evidence | Observed result and limit |
| --- | --- |
| Final local bootstrap+producer suite |122/122pass,0fail/0skip,131.34s; includes28 setup tests and6 pure producer tests |
| Actual packaged installed setup | Real browser producer; fake opaque key; official Windows ZIP;274 pinned provider files; profile inspection;25 MCP tools and owned-file roundtrip; no real account activation |
| Six official ZIPs | All six extracted/byte-verified without executing those clients; not six-architecture execution |
| Native runtime regression |75pass/1platformskip/0fail,17.17s; fixture evidence, not production/root acceptance |
| Three new code-review regressions | RED3/3fail then GREEN3/3pass, zero skips; final suite above supersedes earlier partial counts |
| Previous081072d native CI |41586868991 succeeded: Windows, Linux and macOS acquisition/MCP fixtures; applies to that exact earlier commit, not setup0.3 |
| Previous081072d extension CI |41586869010 succeeded; does not certify new candidate/native work |
| Private legacy source stage | Historical narrow CF9 Stage+Verify and per-host ordinary-user94/94 Linux tests; not reusable root installation or current production health |

The package metadata/manifest JSON records the actual handoff commit and remaining
working-tree files. A source push may trigger new CI; inspect the exact commit's
run. Never promote the earlier green run to proof about a newer revision. Tests
and review are bounded evidence, not a formal EGM certification or a correctness vote.

## Reproduce Without Touching Production

```sh
npm ci --ignore-scripts
npm run vendor
npm run check
cd native/desktop-commander
npm ci --ignore-scripts --no-audit --no-fund
npm test
cd ../bootstrap
npm test
```

The full browser suite also needs Playwright Chromium and an appropriate headed
fixture environment, documented in tests/README.md and CI. Do not attach tests
to the owner's signed-in browser profile. Runtime capabilities themselves are
not sandboxed; disposable fixtures avoid operating on unrelated real data.

For genuine provider/setup acceptance, explicitly select an ordinary writable,
populated npm cache with AGENT_CONTINUE_REAL_CACHE and either
AGENT_CONTINUE_OFFICIAL_CLIENT=1 or AGENT_CONTINUE_OFFICIAL_ARCHIVE. Optional
AGENT_CONTINUE_OFFICIAL_ASSET_DIR enables all-six ZIP checks. Missing opt-ins
produce explicit skips. Never substitute real keys for the fake fixture key.

Clone history.bundle to recover committed main offline, or inspect source/ for
the complete working-source snapshot. Apply pending-tracked.patch only to its
recorded handoff commit; overlay the explicitly listed untracked candidate
files from source/. Do not execute the entire pending browser snapshot as a
stable release. Preserve the baseline and review it first.

## Remaining Work, Not Started By This Handoff

1. Reconcile pending browser/native protocols with one standalone lifecycle owner.
2. Finish first native-host installation and exact extension-origin registration.
   Current guide/metadata is not installation; never use old private paths as product defaults.
3. Provision/bind the actual official tunnel/runtime key on each target, then
   perform real ordinary ChatGPT and Dot tool authorization and matched device-call acceptance.
4. Complete protected/elevated installer and actual Windows/Linux/macOS acceptance.
   Standard-user fixtures are not administrator/root evidence.
5. Implement policy-correct autostart and real interactive-login recovery without
   clearing pauses during automated SSH monitoring or causing foreground windows.
6. Prove update staging, single-owner switch, active-work drain, rollback and revocation.
   Never blindly restart research or overlap owners of one stdio tunnel.
7. Review privacy/store permission disclosures before shipping nativeMessaging;
   keep native candidate out of stable2.2 and do not republish2.2 bytes under its tag.
8. Consider npm publication/signing/installers only after explicit release validation.

These remain incomplete requirements, not evidence of implemented or deployed
features. The latest direct instruction has resumed the project; design approval
and actual OS/platform prerequisites still apply before the relevant effects.

## Operational Boundaries And Contacts

No VPN reconnect, manual-pause clearing, route/DNS changes, SSH/research/IDE
restarts, credential reuse or public administrator shell is authorized by a
handoff document. Preserve the owner's deliberately selected Process Lasso settings.
Use the in-app browser for web operations. Keys stay on their intended devices
and never enter Git, browser storage, logs, issue attachments or this ZIP.

Owner/developer: Zhentong Ye; zhentongye2028@u.northwestern.edu.
[GitHub](https://github.com/1235357/agent-continue) /
[Issues](https://github.com/1235357/agent-continue/issues/new/choose) /
[LinkedIn](https://www.linkedin.com/in/tony-zhentong-ye/).
The owner has now resumed AgentContinue work; do not ask again whether the old
handoff pause is lifted. Obtain the next design decision before changed-behavior
implementation. Production actions still need their concrete device, identity,
operation and OS/platform prerequisites; this document grants none.

## Breakpoint 2026-11-04: Developer-Owned Extension Identity And Authorized HKCU Write

State: two per-user registry writes happened for real, with explicit owner
authorization; everything else in this section is read-only. No commit, no push,
no publish, no install, no host built, no tunnel, no MCP.

Identity. `native/dev-identity.mjs` generated an RSA-2048 pair once and reused it
afterwards. Private key: `native/dev/extension-key.pem`, covered by
`.gitignore:23:native/dev/` (verified with `git check-ignore -v`), never packed,
never logged. `manifest.json` now carries `key` = base64 DER/SPKI, 392 chars.
Derivation: `sha256(DER)` = `af96ca0aabf379c1507ba556a2f741a2985b118308ed2d1b2a0792b23230e519`,
first 16 bytes `af96ca0aabf379c1507ba556a2f741a2`, each nibble `0..f -> a..p`,
giving extension id `kpjgmkakklpdhjmbfahlkffgkcphebkc`.

Chrome confirmed that id itself. Chrome 156.0.8078.74, throwaway profile,
`--load-extension=<repo>`, CDP `Extensions.loadUnpacked` -> `{"id":"kpjgmkakklpdhjmbfahlkffgkcphebkc"}`.
No hand calculation was needed for this line of evidence.

Registration execution. `native/bootstrap/registry-win.mjs` is the real adapter
(`reg.exe query|add|delete` with `/reg:32|64`). Two identical dry runs printed
`keyPath=HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control`
and `regSzValue=C:\Users\zye12\AppData\Local\AgentContinue\native-host.json`.
Pre-state: both views exit 1 (absent). Writes: `--view 64` -> `{"status":"written"}`
exit 0; `--view 32` -> `{"status":"already-present"}` exit 0, because
`HKCU\Software` is not WOW64-redirected on this machine, so both views are one
physical key. Readback, both views: `(Default) REG_SZ C:\Users\zye12\AppData\Local\AgentContinue\native-host.json`, exit 0.

Origin acceptance, measured not assumed. A throwaway extension reusing the same
`key` with `permissions:["nativeMessaging"]` called `connectNative` once:
path pointing at the not-yet-existing `native-launcher.exe` ->
`Specified native messaging host not found.`; path temporarily switched to an
existing PE (`C:\Windows\System32\cmd.exe`) -> `Error when communicating with the
native messaging host.` The message never was `... is forbidden.`, so Chrome
found the registry value, parsed the manifest and accepted
`chrome-extension://kpjgmkakklpdhjmbfahlkffgkcphebkc/`. The manifest file was
restored byte-for-byte (sha256 `3a82df26...cffa8`) and every probe artifact was
deleted. Also fixed: that manifest had been written with a UTF-8 BOM, now plain
UTF-8, content unchanged.

Two defects this round exposed, neither fixed:

1. `install-plan.mjs` puts the manifest at `<root>\native-host.json` and the
   launcher at `<root>\bin\native-launcher.exe`, while `runtime-precheck.mjs`
   reads `<root>\app\native-host.json` (and the packed fixture at
   `packed.test.mjs:826` also uses `app\`). The registered value therefore
   cannot ever satisfy `status`/`verify` as written.
2. Chrome 156 reports a missing host binary as `not found`, not
   `failed to start`, so a registered manifest with an unbuilt launcher is
   indistinguishable from no registration by message alone.

`status --json` now: `installed:false, binding:"missing", registered:"unknown",
hostStartable:false, failed:6, counts{pass:2,fail:6,skip:5}`, exit 0.
`verify`: `VERIFY RESULT pass=2 fail=6 skip=5`, exit 1. Those numbers describe
"value present, install not staged", not a failed write.

Not proven: a real host handshake, `registered` in `status`, and any Chrome
acceptance of a launcher that does not exist. Next single action: decide and then
implement one manifest location for both planner and precheck, build and sign
`native-launcher.exe` at the planned path, rerun `status`/`verify` and one
`connectNative` frame. Rollback if this ever needs to be undone: the two
`reg delete ... /ve /f /reg:64|32` commands, then `reg query` must return exit 1.

## Breakpoint 2026-11-04 (2): Layout Closed, Launcher Built, Handshake Proven

That "next single action" is now done except signing, which the owner has not
decided on. No commit, no push, no publish, no Microsoft submission, no
certificate, no autostart, no tunnel.

Layout, one shape everywhere: `<root>\native-host.json` (manifest, named by the
registry value), `<root>\native-launcher.exe` (the manifest `path`), `<root>\app\`
(pinned runtime). Chosen because the already-written `REG_SZ` points at the root
manifest and because `native-launcher.test.mjs:232` already asserts root paths;
`install-plan.mjs` (`bin\native-launcher.exe`) and `runtime-precheck.mjs`
(`app\native-host.json`) were the two outliers. No registry rewrite was needed:
both views still read `C:\Users\zye12\AppData\Local\AgentContinue\native-host.json`,
exit 0.

Changed: `install-plan.mjs:50`, `runtime-precheck.mjs:163`, `packed.test.mjs:826`,
`packed.test.mjs:334` (help contract now lists `register/status/verify`),
`registration-status.test.mjs` and `runtime-precheck.test.mjs` fixtures,
`docs/INSTALL-DESIGN.md`, `docs/RUNTIME-ACCEPTANCE.md`, `docs/REGISTRATION-REHEARSAL.md`.
Green: `install-plan.test.mjs`, `registration-status.test.mjs`,
`runtime-precheck.test.mjs`.

Built for real, unsigned, at the registered location:
`Build-NativeLauncher.ps1 -OutputPath <root>\native-launcher.exe -ManifestPath
<root>\native-host.json -NodePath "C:\Program Files\nodejs\node.exe"
-HostScriptPath <root>\app\device-native-host.mjs -ExtensionId
kpjgmkakklpdhjmbfahlkffgkcphebkc` -> exit 0, launcher sha256
`63dedd679281ccf9a1f1540d611610a5e8a7b6aa1686a55938ac66a4d5dc0f90`, 15872 bytes;
manifest sha256 `e1e3b84726a0c61cad2dbd5e3b28dd9fa40a805d962436857c2619c441451799`,
origin `chrome-extension://kpjgmkakklpdhjmbfahlkffgkcphebkc/`.

Defender, this build, this machine: `Get-MpThreatDetection` 0 detections in the
last hour, no 1116/1117 events, file present. Fact only; deciding signing versus
appeal is the owner's call and neither is done.

End to end, two paths, one frame each. Process level:
`<root>\native-launcher.exe chrome-extension://<id>/` + one length-prefixed frame
-> exit 0, exactly 1 frame, id and action echoed, `ok:true`,
`state{connection:"disconnected", paused:true}`. Chrome 156.0.8078.74 with a
throwaway profile: `Extensions.loadUnpacked` -> `kpjgmkakklpdhjmbfahlkffgkcphebkc`,
`sendNativeMessage` -> same response, `lastError=null`.

Wire format matters: frames are a 4-byte little-endian length prefix plus JSON.
A newline-delimited probe yields `device_bridge_unavailable` because the host's
catch swallows `invalid_device_frame`. Any future manual probe must prefix.

`status --json`: `installed:false, binding:"present", registered:"partial",
hostStartable:true, failed:1, counts{pass:12,fail:1,skip:0}`, exit 0. `verify`:
`pass=12 fail=1 skip=0`, exit 1, the single FAIL being
`runtime_files: hash mismatch: package.json`.

Two new wiring defects found and deliberately not fixed, both needing a product
decision first:

1. `runtime_files` compares `app\` against the directory precheck lives in
   (`native/bootstrap`), but the staged files come from
   `native/desktop-commander`. Proven: `app\package.json` hashes equal to the
   provider's, not to bootstrap's, and it is the only mismatch. A real install
   needs a reference argument that points at the verified provider copy; the CLI
   has none.
2. `registered:"partial"` is structural: precheck counts HKCU/32, HKCU/64, HKLM/32,
   HKLM/64, while a per-user install only writes HKCU (and on this machine both
   views are one physical key). HKLM will never be present, so `registered` can
   never turn `registered` unless HKLM-absent is redefined as normal.

Still not proven: the real `optional_permissions` grant (the Chrome probe moved
`nativeMessaging` to `permissions` because headless cannot prompt, same key,
same id, same `device-control.js`); a real lifecycle controller and tunnel
(`state` came from a stub `{paused:true, ready:false, runtime:'stopped'}`);
signing; other machines and later Defender scans.

Next single action: decide the `runtime_files` reference and HKLM semantics, then
rerun `verify` until it can legitimately reach 0 failures; signing stays blocked
on the owner's decision, not on evidence.

## Breakpoint 2026-11-04 (3): Reference Closed, verify at 0 fail, Real Owner Frame

That decision is now made and implemented. No commit, no push, no publish, no
Microsoft submission, no certificate, no registry rewrite, no autostart, no tunnel.

`runtime_files` truth is the install root's own payload manifest:

1. Staging now writes `<root>\payload-manifest.json`, a byte copy of the package
   root's `payload-manifest.json` (`bootstrap.mjs`, `CreateNew`, mode 0600).
2. `precheckInstall` reads that file by default; `options.reference` is an
   absolute path to another payload manifest (`readPayloadManifest`), never a
   directory. Missing or malformed manifest is `FAIL payload manifest: ...`,
   not a guessed reference.
3. Comparison checks both byte length and sha256 per entry and names every
   failing file with expected/actual values. This explains the old single
   `package.json` mismatch: the old default reference directory only contained
   that one name, so the comparison set was wrong, not the staged bytes.
4. `status`/`verify` accept `--reference <abs-path>`; relative values raise
   `invalid_arguments`.
5. Negative proof kept: tampering `app\device-native-host.mjs` (and a same-length
   rewrite of `device-owner.mjs`) fails with the file name and both digests.

HKLM is per-user design, not a defect: `registry:HKLM/32|64` are always
`SKIP/not-applicable`; a residual value only adds an informational note; neither
can fail verify nor count as a pass. `registered` is decided by HKCU/32 and
HKCU/64 only and is limited to `registered | not-registered | drift | error |
unknown`; `partial` was deleted from code, status view copy and tests.

Real install root (17 app files byte-identical to `native/desktop-commander`,
manifest sha256 `a0e3e5b56cf37409fab9ba57b24a5b828a597cab7455e93f6c1dd41464dcb58f`):
`status --json` -> `installed:true, binding:"present", registered:"registered",
hostStartable:true, failed:0, counts{pass:11,fail:0,skip:2}`, exit 0; `verify` ->
`VERIFY RESULT pass=11 fail=0 skip=2`, exit 0. First legitimate 0-fail run.

Real owner lifecycle, one `status` frame (`runtime-acceptance.mjs`, temp-dir
isolation, real `startDeviceOwner`, real host, real IPC + HMAC):

- default intent -> `state{"paused":true,"connection":"disconnected"}`, 12/12 pass
- `--resume` (real `lifecycle.json` `paused:false`) ->
  `state{"paused":false,"connection":"disconnected"}`, 12/12 pass

The changing `paused` value proves the reply comes from the controller and its
intent file (`lifecycle.mjs:30` defaults to paused when the file is absent), not
from a stub constant. `connection:"disconnected"` is genuine: acceptance starts
no tunnel, so runtime stays `stopped`.

Tests: `runtime-precheck.test.mjs` 11/11, `registration-status.test.mjs` 6/6,
`registration-status-view.test.mjs` 7/7, `bootstrap.test.mjs` 26/26,
`install-plan.test.mjs` 14/14, `packed.test.mjs` tests 7 / pass 6 / fail 0 /
skipped 1 (the `AGENT_CONTINUE_REAL_CACHE` opt-in).

Still not proven: `connection:"ready"` (needs a real tunnel and lifecycle start),
the real `optional_permissions` grant, signing or appeal, other machines and
later Defender scans.

Next single action: start the real lifecycle controller with a real tunnel in the
same temp-dir isolation and capture one `status` frame with
`connection:"ready"`; everything else on the list stays blocked on the owner's
decision or external machines.

## Breakpoint 2026-11-04 (4): npm Package Ready to Publish (No Publish, No Login)

The tunnel credential work is still exploratory, so this round only made the npm
CLI publishable. No commit, no push, no `npm publish`, no registry write, no
global install, no runtime-semantics change (precheck/registry untouched).

Root `package.json` is now the npm CLI package, not "private":

- name `agent-continue`, version `0.3.0` (first 0.x release), license MIT,
  description rewritten for the CLI, `bin` `agent-continue` → `cli.mjs`,
  `engines` Node `>=22.13.0`, repository/homepage/bugs to
  `github.com/1235357/agent-continue`, keywords, and a 17-entry exact `files`
  allowlist (cli + the 16 bootstrap modules the exposed commands import).

Version decoupling (the one non-obvious change): `manifest.json` remains the
extension release version (2.2.0) while `package.json` carries the npm version.
`scripts/package.py` now validates manifest semver and package.json == both
`package-lock.json` versions; `.github/workflows/release.yml` validates the tag
against `manifest.json` only and still requires package.json == lock. The
extension ZIP name therefore does not move. `validate_release` returns `2.2.0`,
`tests/test_package.py` 6/6 OK.

Publish gate: `prepublishOnly` = `npm run check` + the four key suites
(install-plan 14, registration-status 6, runtime-precheck 11, status-view 7).

`npm pack --dry-run`: name `agent-continue@0.3.0`, **21 files**, 44,746 B packed,
164,044 B unpacked. Entries are `LICENSE`, `README.md`, `README.zh-CN.md`,
`cli.mjs`, 16 `native/bootstrap/*.mjs`, `package.json`. Excluded by construction:
`native/dev/` (dev extension key), `dist/` and release ZIPs, tests, all
`native/*/*.test.mjs`, `node_modules`, `.artifacts`, logs and temp files.

Tarball smoke test (packed to `%TEMP%`, extracted, then run): `cli.mjs --help`
exit 0, `version` → `{"ok":true,"version":"0.3.0"}`, `setup --extension-id …`
prints the plan plus the one-line `command`, `status --json` exit 0 on a scratch
root. `install-plan` without arguments returns `invalid_arguments` by design.

npm homepage README now opens with a three-step CLI quick start that states the
first run needs exactly one pasted PowerShell line:

1. `npx agent-continue@0.3.0 setup --extension-id <id>` (read-only; prints `command`)
2. paste that single line into PowerShell once
3. `npx agent-continue@0.3.0 status --json` (expect `installed: true`, `registered: registered`)

Limits: the npm tarball is plan/status/verify/uninstall only; local
`stage`/`setup --setup-request` needs the release payload, which ships through the
installer, not npm. Nothing has been published or logged in.

Exact publish commands (owner-only, after `npm login`):

```sh
cd "<repo>"
npm publish --access public --dry-run   # optional final rehearsal
npm publish --access public
```

Next single action: the owner runs `npm login` and `npm publish` (or a dry-run
publish) when they are ready; the package itself needs no further work.

## Breakpoint 2026-11-04 (5): Owned Tunnel Supervision (Stub-Verified, No Credentials)

The real tunnel credentials still wait on a platform.login, so this round only
wired the half that needs none of them: `tunnel-client` is now owned by
`native/desktop-commander/lifecycle.mjs`. No commit, no push, no registry write,
no network call, no global install, and no change to precheck/registry semantics.

Launch resolution: `resolveTunnelLaunch(root, options)` keeps the local key-file
binding as the first choice and falls back to the current-user environment
(`CONTROL_PLANE_TUNNEL_ID`, `CONTROL_PLANE_API_KEY`, plus the non-secret client
path `AGENT_CONTINUE_TUNNEL_CLIENT`). The key is passed as the tunnel-client
argument `env:CONTROL_PLANE_API_KEY` plus that single child environment entry; it
is not persisted, not in any receipt, not in any status snapshot and not in git.
Missing or partial credentials yield `configured:false` with
`tunnel_not_configured` / `tunnel_credentials_incomplete`, and `reconnect`
rejects before clearing the persisted pause, so "not configured" is explicit
rather than a silent failure or a fake ready.

State machine: spawn → readiness poll on the `--health.url-file` loopback
`/readyz` (HTTP 200, no credentials in the URL) → `ready`. Only that probe makes
`connection` `"ready"` in the `status` frame; the frame derives it from the
controller snapshot, never from a constant. An exit after readiness restarts the
child up to `maxRestarts` (default 2, `restartBackoffMs` 200 ms) and exposes the
count as `restarts`. A start that exits before readiness fails once with
`tunnel_start_failed` and is not retried. Pause/dispose bump the generation and
SIGTERM-confirm the captured child, so no restart can be orphaned.

Tests (all stub-driven, real child processes, loopback only):
`tunnel-supervision.test.mjs` 7/7 (unconfigured rejection with no spawn and
`configured:false`; env launch with the secret confined to the child env and no
file on disk containing it; ready stub → frame `connection:"ready"`; silent stub
→ `unknown`; pre-ready exit → `tunnel_start_failed`; kill → restart count 1 then
2 then cap at 3 launches → `failed`; pause → one child, no restart, lease
released). `lifecycle.test.mjs` 33/33, `device-owner.test.mjs` 18/18. The old
"unexpected exit never reconnects" expectation was rewritten as
`maxRestarts: 0` — the restart policy is now intentional product behavior.

Docs: `docs/RUNTIME-ACCEPTANCE.md` §11 records the operator sequence (set the
three user env vars, restart Chrome, press Reconnect, expect `paused:false`,
`runtime:"running"`, `connection:"ready"` from the `/readyz` probe) and the
recovery boundary: the persisted intent + restart policy cover a crash of a
ready child, but there is no autostart when the owner opens with `paused:false`
and no detection of a live-but-deauthorized client.

Next single action: when the owner has the real tunnel ID/key, run the sequence
in RUNTIME-ACCEPTANCE §11 against a real tunnel and capture one receipt with
`connection:"ready"` plus one forced-kill restart; nothing else on the tunnel
list can be proven without those credentials.

## Windows-first delivery checkpoint (2026-11-06 UTC)

The preceding stub-only and missing-credentials notes are historical. Both
ordinary ChatGPT and Dot have now read distinct synthetic files from the
protected Windows candidate via the official hosted tunnel. Verify evidence
and boundaries under [Live Windows read receipts](RUNTIME-ACCEPTANCE.md#live-windows-read-receipts-2026-11-06-utc).
The acceptance connection was stopped and persisted pause was confirmed.
Separate local evidence confirms a high-integrity PowerShell child, but it
does not verify that a web-triggered command ran as administrator.

1. Finish one Windows path from consented Node-first setup to an explicitly
   selected full-account web grant. Use the official tunnel without a
   developer relay or custom EXE installer. Keep scheduled continuation
   separate from device access. The selected OS identity is the execution
   boundary; do not carry a temporary test allowlist into the product.
2. On ordinary ChatGPT and Dot separately, verify file write/readback,
   PowerShell exit and the actual child's Windows token, and managed process
   start/status/stop. Correlate stable operation IDs with durable results;
   do not replay a command when its outcome is unknown.
3. From the extension alone, verify browser reopen restores saved-running
   intent, explicit pause survives reopen, and revoked access cannot execute.
   Avoid custom watchdogs and leave production VPN, MCP, IDE and research
   workloads untouched during acceptance.
4. Sync the verified Windows release on canonical `main`, publish matching
   GitHub and Chrome Web Store artifacts, and report submission and approval
   separately. Only then move the release priority back to Linux/macOS and
   the research feedback loop. Do not report the overall goal complete yet.
