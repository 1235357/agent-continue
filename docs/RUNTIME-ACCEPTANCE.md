# Runtime Acceptance Pre-Check (read-only)

## Cloud ACL Diagnostic Recovery (Checkpoint77)

- Native40 run42479430126 on531149c failed at the same state ACL assertion.
  There were no diagnostic lines in the actual raw log. Evidence:
  .artifacts/ordinary-chat-acceptance-20261108/native40-bundle-failure.txt.
- Reproduced a diagnostic-only path comparison defect: equivalent Windows
  short/long parents could silently skip collection. Two cases failed under
  the old guard; the corrected8-case path/scope suite passed independently in
  PowerShell5.1 and7. No local ACL-creation probe was executed or retried.
- Added fixed bounded start/skip/failure-phase markers. The original sealed_acl
  assertion still fails closed; no runtime ACL or production state changed.
  Actual ACL mismatch and the hosted result of this correction remain pending.
- Full goal remains active. The exact test installation remains revoked;
  same-installation reauthorization is unanswered. No3.0.0 Release or Store
  review receipt is established by the existing r17 draft upload.

## Final Source Regression And r17 Store Draft (Checkpoint76)

- Pushed/read-back main fbd8d58247e416da54a63042769e5961980fbc2f passed the full
  npm test command after the final native-call deadline fix. Extension checks93
  run42477125044 succeeded in4m45s. Administrator-control401/401 and the70 Python
  packaging/site/release tests also passed; synthetic browser-restart coverage
  does not establish live hosted recovery.
- Refreshed Store draft3.0.0 to r17, Store ZIP SHA256
  d5d62b994e2029e66f686195064d5025be1378251be4b192577ff3fa8fd5e95e.
  The public/Store pair check and all247 installed-member hashes passed. The
  sole r16-to-r17 member change was CHANGELOG.md. Actual Package page confirms
  Draft3.0.0 and Published2.1.0, not review submission or new publication.
  Proof: .artifacts/ordinary-chat-acceptance-20261108/store-r17-package-draft.png.
- Experimental native38 run42477124953 reached the expected tampered-stager
  rejection, then failed the fixture_cleanup_scope check. Its test-only alias
  correction passed parent29/29 in31.40s, zero failures/skips, including a red/green
  extended-UNC normalization regression found during independent review. Exact
  CI38 short-name causality remains unconfirmed: the local volume returns long
  names, while extended-path aliases deterministically reproduce the old guard
  failure. Containment/naming/reparse checks and15s/20s budgets remain intact.
  Formal delivery7 remains a separate successful build.
- Fixture correction99d73d0 was pushed and read back. Its native workflow had
  omitted this file from both push and PR filters; exact matching is now added.
  The new contract failed both event subtests before correction; the complete
  release-workflow suite passed21/21. A new hosted native pass is not yet proven.
- Native39 run42478533593 actually triggered on pushed/read-back main2f502b4.
  Its Windows offline file passed29/29 in14.006s, with real8.3 aliases observed.
  The next protected-bundle fixture failed sealed_acl after the stop-receipt
  assertions. This compound check includes owner/protection/count, so its exact
  cause is not yet established. No product ACL change. The full error excerpt
  is native39-bundle-failure.txt in the local acceptance artifact directory.
  The latest combined Python regression passed71/71 in51.536s. The native
  workflow remains failed, not fully accepted; subsequent steps were skipped.
- Failure-only ACL diagnostics in the protected-bundle test have static/syntax
  checks only, no behavioral result. They cap scratch-relative descriptors and
  omit actual SIDs/raw ACLs/private paths, then rethrow the original assertion.
  A local disposable reproduction request was blocked before process launch by
  tool policy, not by Windows ACL/UAC; no alternate route was used and no fixture
  or job remains. Do not call this a confirmed root cause or product ACL fix.
- Actual Revoke ee5180ab1aa742b5a30eb02d584ef528 remains stopped and the test
  installation revoked. Reauthorization request is unanswered. Preserve this
  state; current-account hosted calls, whole-browser restoration and final Dot
  write/owned-child acceptance are still pending, as are Release/review receipts.

## Actual r16 Revoke Completion And Verified Delivery Build (Checkpoint75)

- Existing IAB installation updated from the r16 public extension ZIP:
  SHA25601302525ee49ad4198206ac2d87b97ca256073cb1e59940e3961161a6444c24d;
  paired Store ZIP2e90dc85aeb1191f07549c16ccf5dc2b0cf102b77f2f209951114daa83a9ce19.
  All247 installed files matched. No storage, permission, registration, production
  connection or external Chrome original-task changes were made.
- Exactly one explicit same-ID reconcile of Revoke
  ee5180ab1aa742b5a30eb02d584ef528 completed. Independent protected observation
  returned stopped; actual GUI Read this operation receipt also displayed
  verified shutdown and disabled recovery/fencing. Proof:
  .artifacts/ordinary-chat-acceptance-20261108/r16-revoke-stopped.png.
  The installation remains revoked; no new Connect or authorization was issued.
- Independent review found and fixed the final dispatch/journal race and the
  native precheck deadline gap. Parent npm run test:admin-controls401/401 passed;
  independent130/130 and two shared-budget probes passed. Full npm test passed
  before the last deadline adjustment;70 packaging/site/release tests passed.
  Caller receipt admission is explicitly separate from the native-call budget.
- Actual Verify Windows Delivery7 run42476011608 on bbe383b succeeded6m53s,
  with two reported artifacts. Extension checks92 run42475982637 succeeded.
  These are build/test receipts, not an installed hosted browser lifecycle or
  publication. Local combined setup closure and Plan passed with unchanged r8
  runtime7e174a. No reinstall was performed.
- Store draft3.0.0 remains r14 and unsubmitted; published2.1.0 is unchanged.
  Current-account hosted operation, whole-browser saved-running/Pause/Revoke,
  final Dot write/owned-process proof and publication receipts remain open.
  Do not repeat settled Revoke; test reauthorization needs its separate consent.

## Recorded Revoke Recovery In Progress (Checkpoint74)

- Actual IAB r14 Revoke ID ee5180ab1aa742b5a30eb02d584ef528: protected
  revocation-recorded and ownerState revoked. Previous broker98000/root61188
  absent. Manual GUI read returned recorded, NOT stopped. Screenshot:
  .artifacts/ordinary-chat-acceptance-20261108/r14-revoke-recorded-recovery-disabled.png.
- Identified and patched a frontend/coordinator mismatch: recorded Revoke was
  terminal for freeing a slot and also blocked its permitted same-ID recovery.
  Only active-journal Revoke reconciliation is newly admitted; no startup,
  control replay, archived recovery or terminal Fence is added. Four red cases;
  parent scoped synthetic regression376/376 and full npm test passed. Live
  refinement still pending.
- Offline ordinary-token runtime rebuild:24328 files,107068948 bytes, exact
  installed r8 SHA2567e174a6571003b45ceca557fb01dc4a62f3d1324cb33f012cb273c37154c7fb2.
  Plan passed; no state, enrollment, registration or tunnel mutation.
- Extension CI91 passed. Native CI37 passed the previously blocked recovery
  steps but later timed out in Windows offline-payload tests. Their fixture-only
  bootstrap/diagnostics change passed parent26/26 in29.48s, zero skips; this is
  not a demonstrated hosted cure. All15s child/20s case budgets are retained.
- Store draft3.0.0 r14 remains unsubmitted; public2.1.0 unchanged. Current-account,
  browser-reopen, final-artifact and release gates remain separate and open.

## Dot Token Result And Hosted Alias Correction (Checkpoint73)

- Dot's new, independent read-only token command returned PID87952 and marker
  AC_DOT_READONLY_TOKEN_20261108_72 with administrator=true. The response says
  finished, without an exit code. Proof: dot-readonly-admin-result.png under
  .artifacts/ordinary-chat-acceptance-20261108/. This does not establish the
  refused file-write/owned-child script, which was not retried.
- Native run42473888039: Ubuntu and macOS succeeded. Windows bootstrap executed
  successfully and12 diagnostic cases passed; the one failure was exact8.3
  versus expanded temporary-path spelling. Native realpath now compares the
  same existing fixture file; module/hash/JSON/discovery and time limits remain.
  Later Windows steps were skipped after failure, not accepted by inference.
- r14 remains draft3.0.0; no GitHub3.0.0 Release or Store review receipt yet.

## Reconnect Readback, Dot Read And Store URL Repair (Checkpoint72)

- One existing GUI Connect c67639ecdc56411db5406001622ce640 reached generation
  8fefb168004148bb8a78b6742ff3fae7 ready. Protected metadata, independent native
  observation and the actual Devices status check agreed. No duplicate Connect.
  Historical saved progress remains waiting-owner and must not be called the
  current connection state. Proof: r14-admin-ready.png in the ordinary-chat
  acceptance artifact directory.
- GitHub Pages run42473012368 on8fcdcc2 succeeded. Actual IAB homepage/privacy
  rendered at https://1235357.github.io/agent-continue/. The complete canonical
  privacy document is included, not a shortened policy. Store links were saved
  and Submit for review is enabled. r14 upload completed and Package shows
  draft3.0.0/public2.1.0. No downloaded CRX-content comparison is claimed.
  This is a validation gate, not submission.
- Dot Read File returned the existing exact disposable marker. Dot reported
  Start Process refused as a perceived repeated request; the dedicated output
  is absent. Do not claim a new Dot administrator/file-write/process proof or
  blindly retry that request. Prior D940 acceptance is a distinct checkpoint.
- Parent changed-fixture recovery suite38/38, zero skips,44.38seconds. Bootstrap
  module test1/1 passed with real Utility/Management manifests and restored
  autoload preference. Independent review found no actionable defect, passed two
  focused tests and10 separate restoration probes; broader committed preference
  transition coverage is a non-blocking recommendation. No product assertion,
  timeout or security weakening. Hosted
  CI35 underlying hang is not locally reproduced or established fixed yet.
- No final3.0.0 Release/review receipt. Production VPN/MCP/IDE/research and the
  external Chrome original scheduler were not changed.

## Installed r14 Upgrade Pause (Checkpoint71)

- r13 same-popup Devices navigation and its exact reload were verified live.
- Application storage readback identified stale saved setup ec7 versus current
  registered7e174a. No runtime/credential/storage deletion was used to repair it.
- r14 copied247/247, reloaded only the IAB candidate; Store ZIP SHA256
  d84a1f87eb59555540f58206a57c9d13aa5e613cfc9ed87a0f1a13162eec3c8d.
- GUI Pause operation7f53192a5ef04ae28cf667c71091524a returned protected and
  independent native stopped receipts. Owner projection paused; old broker/root
  PIDs absent. GUI showed operation-specific verified-not-running feedback.
- Current-binding repair: red/green upgrade regressions and five-suite544/544.
  Independent review passed356 repository and53 separate fault checks with no
  actionable finding. Subsequent GUI Connect not yet established.
- Recovery fixture38/38 local, three CI selectors passed locally. New milestone
  distinguishes pre-import discovery from actual Utility import; hosted CI still
  needs a fresh run. No security checks/timeouts weakened. No release/submission.

## Actual Ordinary Hosted Tools And Remaining Controls (Checkpoint70)

- Follow-up Pause repair: parent five-suite537/537 passed; independent review
  passed354 repository tests plus57 separate fault checks and reported no remaining
  actionable finding in that scope. This is not a live Pause/stopped receipt.
- Popup setup/device entrypoints now navigate the same popup after draft save;
  full-view/Expand unchanged. Mocked UI34/34 plus source4/4 passed. Scratch r13
  copied247/247 but not yet reloaded. Store SHA256:
  7e2414f8e37245af555df327a0f46b387f6a48e79f57ed39cc4da95d6612eca9.
- Native CI34: macOS succeeded; Ubuntu failed; Windows recovery step timed out.
  All observed Windows children logged entry then reached15s without the
  utility-imported milestone. Underlying import delay is not yet explained.

- r8 generation f32647664aea458eb0a1655034aa7bd9 reached ready after scoped
  r10 extension reload with saved-running intent. Public and native readbacks
  agreed. Extension reload is not an entire browser close/reopen acceptance.
- Ordinary ChatGPT actually returned disposable read marker
  AGENTCONTINUE_R8_R10_READ_ACCEPTANCE_20261108_8d5a73b1, then executed the
  fixed administrator probe through the existing D940 plugin. Tool output:
  administrator=true, roundtrip=true, ownedChildStarted=true, ownedChildStopped=true;
  process50100 finished and child88632 was waited/reaped. Parent matched the
  disposable output SHA256 independently; no unrelated task was stopped.
  Screenshots: .artifacts/ordinary-chat-acceptance-20261108/read-file-result.png
  and administrator-result.png. Existing result-file guard prohibits replay.
- GUI Pause was blocked by an unassociated legacy ec7 LAST record before native
  dispatch. No r8 stopped receipt is established. Extension-only upgrade repair
  remains under review:291 tests passed, but an independent fault reproduction
  exposed capability-error fallback and fresh legacy-archive conflict defects.
  Do not ship scratch r12 or claim these controls passed until fixed and retested.
- Full product regression exited0 before that review follow-up. Main1746f03 is
  pushed. Manual delivery6 failed three official download attempts with HTTP504,
  before delivery artifacts. No successful CI acquisition/build is claimed.
- Authenticated Store draft3.0.0 still contains r9 ZIP; public2.1.0 unchanged.
  Remote-code draft now discloses the optional local sandbox relay. Submission
  validation reports Homepage and Privacy policy URLs unreachable by timeout.
  No3.0.0 GitHub Release or Store submission receipt exists.

## Installed Final Candidate And Draft Upload (Checkpoint69 In Progress)

- The actual r8 owner generation a8a78288c4c14c79a976078530050e4d exited1.
  Protected terminal evidence shows rootExitObserved=true/jobDrained=true/
  innerLeasesClear=true/tunnelReady=unobserved. A separate read-only installed
  Node authorization probe returned authorizationValid=true. The browser witness
  named pipe was absent before preview reload and present afterward. This locates
  an integration boundary; it does not alone prove the entire exit cause.
- Manual startup observer preparation was missing in the source and reproduced
  red before repair. Explicit Connect/resume-saved now await an exact attachment
  before journal reservation; observer requests remain wake:false. Cancellation,
  Revoke and receipt independence were tested. Parent related188/188 and actual
  module integration11/11 passed; independent source review found no issue.
- r10 IAB preview247/247 bytes verified and reloaded, ID/storage/permission
  retained; native r8 unchanged. Its Store ZIP SHA256 is
  d41487c8da0cd13eea595289a2d233787b6a1579b3e20f68c63e33b0b8eeab7e.
  Old97d46acf570947599473f21a577f46c4 remains a historical launch-requested
  operation, not Ready, and is not to be replayed.
- IAB exact existing extension IDhjnopijiekcbgiljjfiekeiepkebhido reloaded3.0.0
  from r9 with247/247 file readback, no replacement of browser storage or external
  Chrome original task. Browser permission remains Granted.
- Old ec7 GUI Pause00b11992c1a04b0f9fe4180f1861a90d and GUI Revoke
  af21ebc5e3fa45fd929574eb308a38d4 each have exact protected stopped receipts.
  Old Unenroll exit0 was independently checked against absent HKLM owner
  registration and absent AgentContinue scheduled task. Files remain preserved.
- Fresh r8 installer operation3f65db52f84b4a4997d4b6038e58ea3b returned
  installed-ready-to-connect. Protected result verified24328 files, ACLs,
  administrator state, clean launch plan, administrator child, binding and
  enrollment; activated=false/tunnelStarted=false. Bundle root suffix uses the
  FIRST24 hash characters:7e174a6571003b45ceca557f, not25 characters.
- One GUI Connect97d46acf570947599473f21a577f46c4 passed full verification and
  recorded intent-saved/launch-requested. Read its exact receipt/current owner;
  waiting-owner does not establish readiness, hosted tool success or failure.
- Final product exit0 and package107/107pass. Independent artifact audit found
  no actionable mismatch in exact r9/r8 closure. Parent recovery37/37pass43.2s;
  independent fixture review found no weakened checks. Commit14f1c0d changes
  tests only. First hosted15s child remains unresolved pending new CI evidence.
- Google Store draft is now3.0.0, nativeMessaging listed, published remains2.1.0.
  Full English description and revised native/storage/single-purpose draft
  justifications were saved. No review submitted and no new GitHub release.
  Screenshot: .artifacts/windows-one-command-setup-20261108/
  checkpoint69-store-draft-3.0.0.png.
- be67563 CI: Extension83success; manual delivery5attempts1/2failed official
  archive downloadHTTP504 before build; Native31Windows recovery childSIGTERM
  and macOS client_acquisition_failed, Ubuntu corepass. Do not treat a transient
  acquisition diagnosis as proven for both failures or waive release guards.

Production VPN/MCP/IDE/research/external Chrome task unchanged. Ordinary local
host remains old protocol, no reconnect into the administrator-owned tunnel.
Final candidate hosted calls, saved-running reopen, Pause/Revoke and publication
gates remain active. Never replay settled or uncertain operation IDs above.

## Browser Control Integration And Actual CI (Checkpoint68 In Progress)

Actual main512bd875 verification was read in the authenticated IAB:
- Verify Windows delivery4, run42462329376, Success5m59s, two artifacts.
- Extension checks82, run42462309737, Success4m32s.
- Native checks30, run42462309731, Failure4m53s: Windows read-only recovery
  step hit its3-minute deadline. Ubuntu core and macOS bootstrap passed. The
  timeout is not a proven product-install failure and is still being diagnosed;
  no timeout was raised or case skipped to declare success.

Screenshot: .artifacts/windows-one-command-setup-20261108/
checkpoint68-windows-delivery-success.jpg. Artifact download was attempted, but
its browser download event did not complete; local artifact bytes are not yet
claimed as downloaded/verified. The known raw-log/fixture Plan failure is now
resolved in that hosted delivery run, not just locally.

Parent full npm test completed exit0 before the new progress implementation,
including13/13 MV3 and5/5 official ProseMirror scenarios. The new page-control
slice first failed five regression cases, then passed59/59 controller cases.
It records priority Pause separately, retains exact owner and mutation IDs,
does not hold the cross-page lock over transport, and permits explicit Pause
while a Reconnect/status call is waiting. The new rendered case first failed
on the disabled Pause button; the repaired UI then passed41/41 synthetic checks.
Related controller/dialog/account/admin/Pause fixture regression passed280/280
before four further controller cases were added. These counts overlap.

Source integration follow-up: parent ran149 page/worker/native focused cases,
full product npm test exit0 (including13 MV3 and5 official ProseMirror scenarios),
and full native npm test269pass/0fail/4 existing platform skips. Full native first
exposed a legacy close-test deadlock: it expected the server to kill its client
before draining. The test now explicitly disconnects its exact admitted client,
waits for quiescence admission, checks Status/rejection of new Reconnect, releases
in finally, and verifies exact receipt/fence cleanup. It passed individually and
in the full native rerun; no source safety check was removed for that test.

Independent read-only critique then reproduced two actual P2s: a priority Pause
retirement committing before a rejected storage promise left a stale live fence;
and positive late exit during quiescence was mislabeled failed with saved-running
intent. Both were reproduced red before repair. Exact terminal readback now
reconciles only the matching live/durable record; foreign records/generic errors
cannot clear it. Positively verified captured-process exit reports stopped only
during quiescence; arbitrary failed or unconfirmed exit cannot release ownership.
Parent latest133 controller/worker/source and23 focused native tests pass. The
bounded worker fix was independently reviewed with no remaining P1/P2 finding.
A final complete product rerun is in progress; these counts overlap.

Parent Windows recovery rerun35/35passed in68.7s. The fixture now uses async
execFile and fixed case/phase timing diagnostics; child15s and case20s bounds
remain. CI runs all35 cases in disjoint10/13/12 positive-prefix groups, each with
the original3-minute step limit. This addresses confirmed event-loop/reporting
blocking, not an invented diagnosis of the hosted-specific PowerShell slowdown.
New hosted CI is still required. Manual verification workflow contracts25/25pass.

Official Node ZIP downloaded through IAB matched CBC74B5E0982C9DBB41525FD8FB5DCD3
2FBEE237863F7829072F4639A1CE5F20. Local closure-r7 built/Plan passed but is superseded
because its payload predates the final native repair; closure-r8 rebuild is in
progress. Extension-r9 is a newly packaged source candidate only. The npm suite
attempt lacking combined-release environment failed its required tarball gate;
repeat against the exact new six-file closure and original builder receipt.

Native IAB UI confirmed installed preview2.2.1 and IDhjnopijiekcbgiljjfiekeiepkebhido.
No reload, registration, protected cutover or live command occurred. Installed
candidate adoption, browser reopen/revocation, final artifacts and Release/Store
review receipts remain unverified. Production connections and external task
remain unchanged. Store is authenticated and the supplied password file unread.

## Hosted Readback And Receipt Follow-Up (Checkpoint67 Historical)

Canonical main was pushed and read back as7a734ba25211f479f4144c419518e672a593cbea.
The parent complete product test exited0, including13 MV3 integration scenarios
and5 official ProseMirror scenarios. This does not make the hosted checks green.

Actual manual Windows verification run42460884036 passed the ordinary-token
build and smoke, then failed the combined setup stager Plan after3m21s. No
sidecars were uploaded. The sanitized builder error did not preserve the Plan
phase, so its underlying cause is still under investigation; it must not be
described as another process-output failure or waived by skipping Plan.

Automatic native run42460845490 passed Ubuntu core and macOS bootstrap. Windows
core passed its initial native tests, but the read-only installer recovery step
was cancelled at the workflow's three-minute limit. A separate local reproduction
completed34 cases in62 seconds:17 passed and17 failed because synthetic bin.mjs
fixtures had no digest list. Adding real SHA256SUMS entries made the same34 cases
pass in61 seconds. A new changed-entry negative case also passed separately,
proving the fixture repair does not bypass payload verification. No installer
integrity assertion was relaxed. A fresh hosted Windows run remains required.

Automatic extension run42460844687 exposed additional Linux font-width variation:
the administrator Copy bottom was612.34375px in a320x600 viewport, despite the
earlier Windows render pass. Another compact-layout correction is in progress;
do not describe checkpoint66 as cross-platform visual acceptance.

An independent40-case wake review reproduced two additional inherited defects:
an undifferentiated negative reply could prematurely retire its mutation fence,
and a legitimate blocked-by-local-control prepared receipt was not recognized.
Narrow regression fixes are in progress. The separate no-reply availability
limitation remains unresolved. No candidate worker or protected runtime was
reloaded during this follow-up; no Release or Store submission was made.

Checkpoint67 source follow-up: the parent reran202 focused wake/device/Pause
checks, including46 wake cases, with no failures or skips. Generic ok:false now
retains its exact fence; blocked-by-local-control is recognized only for the
proper prepared reference. The new compact layout passed63 rendered checks with
an actually loaded105-percent wider fallback face; the parent visually inspected
the administrator320x600 fixture. The selected Administrator label was shortened
after that inspection to avoid native-select truncation; full UAC disclosure
remains below it. This is not installed or hosted Linux UI acceptance.

The Plan wrapper now preserves bounded phase/exit/stderr-presence diagnostics and
canonicalizes the Archive path only after redirect/type checks. A real existing
8.3 alias was rejected at input by the unchanged stager; its canonical equivalent
reached the intended archive/hash rejection. The fixed wrapper now reaches the
same archive rejection through that alias. Native inert-ZIP LF/CRLF checks passed;
the17-case Plan suite passed15 with two TEMP-alias cases skipped. This proves a
local short-path defect, not that Run3 used an alias. Its underlying phase was
lost in the old log and remains unproved until another hosted run.

The separate control-progress design is proposed in the dated plan. It is not
implemented or accepted by these narrow repairs, and cannot be a release waiver.

## Main Synchronization And Hosted CI Repairs (Checkpoint66 In Progress)

2026-11-08 UTC. Canonical main now includes41d79c4407c9b9b678bc2f8e1c77e3da131372f9,
following the earlier310-file source checkpoint. This is source synchronization,
not a Release or Store submission. The authenticated personal Store session is
available; the owner-supplied password file remains unread.

Actual hosted Verify Windows delivery run42459799286 failed after5m28s. The
previous initial-process-output assertion was passed. A later prepared-process
revocation race incorrectly compared the admitted start reply to an immediate
file-existence check before the child finished. The test now observes only the
same returned PID and requires AC_PREPARED_OK before checking the winning effect;
it never repeats a start. Local pinned stdio again passed1/1:67 RPC replies,
0 protocol errors, no network/browser attempts and clean stdin-close exit.
The whole smoke has a180-second ceiling; individual observations stay bounded.
This is not a successful hosted rerun or proof of a production runtime change.

Actual Linux Extension checks exposed a320x600 fallback-font layout failure.
A new Windows Chromium fixture reproduced the exact619.0625px Copy bottom before
the CSS fix. Mobile-only flexible brand, narrower language selector and reduced
gaps preserve complete risk/consent, full control targets and closed Advanced.
The original assertion was not relaxed. Parent rerun passed56/56 rendered checks;
the fallback-font Copy bottoms are549.28125px current-account and568.78125px
administrator in a600px viewport. Actual hosted Linux rerun is still required.

Experimental native CI separately exposed an incomplete Windows wake-test
dependency closure; adding the actual prepared-process and receipt modules to
that disposable test made its real CLI path pass30/30 locally. No production
origin/frame/ACL/pause guard was changed. Native local npm test passed269/0fail
with four existing platform-specific skips, not a no-skip release acceptance.
macOS fixture sockets exceeded sockaddr_un's path budget in its long default
temporary directory. That fixture now uses canonical /tmp on Darwin, retains
inode/path cleanup guards, and asserts its socket path is shorter than104 bytes.
Windows device-setup rerun passed58 with two existing Linux-only skips. This is
not a new macOS support claim. Ordinary/protected package closure and exact CLI
discovery regressions are being reconciled separately.

The browser-wake repair now passes196 focused tests, including40 wake cases:
operation-identity fences, exact terminal reconciliation, read-only timeout
teardown, realistic local disconnect, cancelled OWNER write and concurrent
handshake success. A no-reply mutation still deliberately retains its command
slot and durable fence; if its reply never arrives, status/new generic GUI Pause
remain unavailable. Restart/regrant do not authorize bypass. This availability
gap is unresolved, not a verified manual-control success or a release waiver.
The ordinary/protected closure regression now models its single exact guarded
sidecar edge, rejects six changed-import/guard cases, and actually verifies the
ordinary packed host refuses the administrator flag without state/network/child
effects. Exact help discovery includes browser-install-status. The local broad
bootstrap run exposed one additional obsolete test demanding legacy EXE sources
and17 runtime files. Its assertion now requires their exclusion from the ordinary
package and the actual21-file closure; no EXE is compiled or installed. Eleven
pre-existing generated-launcher opt-ins remain skipped, not counted as coverage.
The reviewer's scratch-cleanup ordering finding was also fixed before integration.

Final artifact rebuild, exact lifecycle and Revoke acceptance, GitHub Release
and Store submission remain open. Keep the
goal active. Production VPN/MCP/IDE/research and external Chrome tasks were not
changed. Do not promote a failed hosted run or a fixture pass to delivery proof.

## Current-Account Fresh Setup And Archive-Only Adoption (Checkpoint65)

The310-file unreleased source checkpoint was committed and actually pushed to
canonical main as d4515269cb6ac7a29b10701989d49894554c549b. Remote readback matched.
The complete product regression exited0 before the subsequent independent
browser-wake critique; packaging32/32, release-source7/7 and documentation/support
33/33 also passed. These passes do not dismiss that critique's newly reproduced
uncertainty/timeout cleanup defects; repairs remain required before final release.
The built-in browser dispatched Verify Windows delivery run42459001181 on main.
This is a real hosted verification attempt, not a passing build or publication.

That attempt failed its stdio smoke assertion after successful isolated ordinary
account creation/logon, protected source staging and package build. Its original
log reports a valid started process/PID whose output had not arrived; the smoke
incorrectly required the marker in start_process's initial output. Test-only
observation now reads only that returned PID with bounded time/read count/output,
never repeats Start, and requires the complete expected marker. Ten focused
observer cases and the actual pinned-provider stdio roundtrip passed locally:
standard token,67 RPC replies,0 protocol errors and clean stdin-close exit. The
upcoming hosted rerun is still required; no guards were relaxed or checks skipped.

Linux Extension checks run42458974844 separately found a320x600 layout overflow:
the primary copy action's bottom was619px. The Windows fixture passed locally,
so this is a real cross-platform presentation gap, not a reason to weaken that
first-viewport assertion. A scoped responsive-spacing repair is in progress.

Actual IAB verification after the scoped acceptance-extension reload returned
Granted / Bridge reachable / Disconnected / Paused for Current account. This
closes the first-install native-attachment gap, not cloud connection or chat
authorization. The initial worker attempt preceded native installation; the
corrected explicit read-only status path can await/reacquire the exact host while
retaining owner/mutation fences and bounded timeouts. Browser-wake22/22 and
related source fixtures144/144 passed; these are overlapping suite counts.
Only the acceptance preview's browser-wake.js changed and its backup/digest were
checked. Its scheduler remained Paused1/1. External Chrome and production state
were not changed. Current-account Connect was deliberately not issued because
the dedicated administrator test already owns the same hosted tunnel binding.

The owner completed Store login. The authenticated dashboard currently shows
published-public2.1.0 and draft2.1.0; no3.0.0 upload or review submission is claimed.
The password file supplied by the owner was not read.

2026-11-08 UTC. Real dedicated owner-PC current-account setup completed exit0,
configured=true/registered=true/connected=false. Only the exact IAB origin's
separate device_wake registration was written. Existing ordinary installation
and protected administrator/production connections were preserved. No browser-
launch or chat-authorization success is inferred from installation.

The first repeat-command observation failed closed with inspection-unavailable:
public sidecars have an adjacent ZIP, not extracted bin.mjs. Source now uses a
local checked ZIP snapshot and guarded temporary extraction for this read-only
path. Actual parent-dispatch fixtures passed4/4, offline acquisition22/22,
and extracted current-adoption boundaries34 checks. Bad/missing source and failed
child execution never become a matched installation or a repair/reconnect.
Rebuilt closure-r6 then returned existing-matched against the real fresh target,
registration=matched, mutationPerformed=false, runtime=not-observed and
chatAuthorizationVerified=false. No credentials or lifecycle state were changed
by adoption. The preflight relative-path failure and successful absolute-path
fresh installation are retained separately; no unknown operation was replayed.

Independent source review is complete within its documented scope. New manual
hosted-verification workflow contracts25/25 and CI runner fixtures20/20 passed;
these do not prove hosted account creation/logon/ACL execution. The workflow is
verification-only and preserves build/smoke token guards. Source synchronization,
Release and Store submission must each be evidenced independently.

## Dot Execution And Simplified Devices (Checkpoint64)

2026-11-08 UTC. Dedicated Windows acceptance only. The single existing Dot test
request completed using the approved Windows plugin and unchanged ec7 runtime.
Its visible response reported administrator probe exit0, a temporary-file write
and independent read, and creation/termination of only its owned test process.
Independent MCP/local readback matched the protected v2 probe's actual selected
SID, TokenElevation=1, high-integrity label and unpredictable browser-reported
marker. The owned-process witness and temporary-file body matched; the four
original operation receipts returned provider-reported-result, and the final
session inventory was empty. No retry/new operation ID, production process,
research service or credential was used for the cross-check.

The candidate Devices page's three assets were updated with backup/hash readback
only, without an extension-worker or native restart. Native IAB UI showed an
Administrator default from saved Restore intent; selecting Current account hid
administrator controls, selecting Administrator hid current controls. Advanced
remained collapsed. Selecting an account did not issue Connect or alter Pause.

The new administrator -InspectExisting route actually verified the existing
installed bundle's complete inventory and public enrollment/registry/task against
externally supplied bundle/stager pins. It returned existing-matched/open-devices,
mutationPerformed=false, installed=false and registrationChanged=false. It neither
reads private demand/credential binding nor claims current connection or chat
authorization. A focused diagnostic that skipped inventory was used during
debugging, then superseded by this successful full unmodified check.

Four invalid-input cases and the real installer dispatcher with inert matched/
unconfirmed classifier fixtures passed. These do not constitute a new installation.
The selected-account UI is now part of the browser fixtures: the full product
run exited0. Rendered Devices40/40, UI24/24, MV3 fixtures13/13 and official
ProseMirror5/5 passed within that run; do not add nested suite totals. MV3's
synthetic scheduler restart is not proof of actual administrator-runtime reopen.
The public package run passed96/96 with no skips, using the original closure-r4
build receipt and actual npm pack/extraction/disposable offline installation.
Current-account adoption separately passed7 JS and34 PowerShell fixture checks.
No fixture created an owner-PC account, installed a runtime or mutated registry.

Installer recovery no longer calls a removed temporary payload. Its ordinary
PowerShell observer contains the exact existing read-only receipt functions and
public operation/hash/SID identity only; it verifies the caller SID and derives
the protected receipt path. Actual absent-receipt observation plus in-memory
successful/invalid-reader fixtures passed362 checks. The complete updated Windows
guided-install command exited0; no installed-state mutation was performed by
these tests. CI adapter source/benign-subprocess tests also passed35/35, not an
actual hosted account/logon/ACL run.

Combined closure-r5, paired extension-r5 and npm-r5 are built after recovery repair.
Final integrated npm test exited0. The exact-r5 package suite passed103/103 with
no skips, extension packaging32/32, and the updated guided-install command exited0.
Do not aggregate overlapping counts. r4 artifacts remain historical. No candidate is published.
Whole-browser administrator reopen, current Revoke, fresh install, hosted CI
closure and GitHub/Store delivery are not established by this checkpoint.

## Recovered Popup Connect And Ordinary Web Read (Checkpoint63)

2026-11-08 UTC. Dedicated acceptance only; production unchanged. The exact popup
sender bug is fixed and deployed in the existing hjnopijiekcbgiljjfiekeiepkebhido
IAB candidate. Chrome's official MessageSender reference says frameId is optional
and set only when tab is present. A real extension popup was rejected despite a
successful native read-only capability check. The corrected shared predicate
retains exact extension-ID/Devices-URL/top-frame/incognito checks; no new permission.

GUI Connectc010c64c39884c57b2921846cbc810c5 was issued once, not replayed while
verifying24328 files. The protected owner-status readback reported ready,
generation3d004b69ac0c49ec88b2b5e0d766c459, broker92892/root95168. Actual popup
status also visibly reported Ready and explicitly did not claim chat access.

Ordinary web chat6aeff83f-f4d8-83e9-afa5-9e2fdf4b754f performed a NEW read_file
after its Read File approval was allowed once. The visible tool iframe returned
web60-09afea4d88f64f1eb1b9a0825bc8e026 from the existing dedicated temp file.
No command/file mutation, new runtime key, platform-wide grant or production work.
Dedicated list_sessions afterward reported No active sessions. The ec7 acceptance
connection is NOW READY; older checkpoint60 STOPPED entries below are historical.

Supplemental regression:129 admin-browser/UI tests passed, including omitted
popup metadata Status/Pause/exact receipt and embedded Devices denial. Public
packaging/setup/CLI changes remain SOURCE-only, pending complete artifact and
lifecycle/Dot/publication gates. No GitHub/Store submission is claimed.

Checkpoint63 closeout: actual public candidate tarball checks passed74/74,
including six-file hash readback and disposable offline npm installation/CLI
discovery; no actual new Windows install or tunnel was started. Adjacent setup
ZIP and administrator-sidecar forwarding helpers passed22/22 offline fixture
tests. Latest UI historical-state copy and Advanced-only Pause reconciliation
passed188/188 narrow cases, then were copied/read back only into the existing
IAB candidate. Actual reopened Setup displayed scope, short risk disclosure,
unchecked consent, Copy command and closed advanced sections. No install/copy/
permission/connection action was submitted in that final inspection. Native
worker, runtime generation and production tasks were not restarted.

Final local artifacts are closure-r3, extension-r3 and npm-candidate under
.artifacts/windows-public-3.0.0-*. They are not public releases or submitted Store
packages. General CI source checks are distinct from the release job's required
original-receipt public-tarball gate. CI runner compatibility, complete final
fresh-install/adoption, reopen/Revoke/Dot and publication gates remain open.

## Ordinary Web Administrator Execution And GUI Stop (Checkpoint60)

2026-11-08 UTC. Authorized dedicated acceptance mutations; production unchanged.
Ordinary IAB conversation6aeff83f-f4d8-83e9-afa5-9e2fdf4b754f selected D940,
approved the actual start_process once, and received real administrator=true,
fileRoundtrip=true, ownedChildStopped=true. Operation9f1164c2-c707-4a20-ae02-
f50673dc91c5; parent NEW ec7 protected runtime/node.exe. Independent read_file
matched the generated web60 nonce. This is ordinary-web command/file/owned-child
proof, not just a model reply or the earlier Codex-hosted test. No Dot request.

The installed IAB popup now actually opens device controls using a same-document
fallback after new extension-tab creation is rejected. New setup/control buttons
and320px-minimum layout visibly loaded by reopening the popup; no worker/native
reload. Only interface files changed. Popup24/24 and Devices40/40 fixture checks
passed separately; they do not prove OS/platform approval.

Actual GUI Pause was explicitly confirmed once after no active sessions.
New exact ec7 operation5ff4cb5636e947a7bc06518e198ccd91 produced stopped receipt;
original broker70620/root77324 were absent. Acceptance runtime is STOPPED.
The early unverified UI was feedback lag, not a failed or old-record-blocked
Pause. Retain the receipt and never replay. Reconnect/reopen/Revoke/Dot/final
artifact/current-account/adoption and public release/submission gates stay open.
Source-only installer integrity147/147 PS5.1 and PS7 fixture checks plus13/13
updated Python release-pin methods passed; not installed. Full evidence and
backup-provenance correction: checkpoint60-live/README.md. Native goal active.

Checkpoint60c: actual Settings -> Setup fallback navigation accepted; account
scope/short disclosure/unchecked consent/Copy are primary and advanced controls
closed. Actual Setup -> Already installed? Open Devices also navigated locally.
Only Devices.js/Setup.js were further updated with backup/readback. A manual
read of stored exact Pause5ff4cb5636e947a7bc06518e198ccd91 visibly returned stopped
evidence; no mutation/replay/connection. The bounded automatic followup has106
synthetic cases, not a new actual Pause result. Rendered Devices40/40 and Setup
55/55 passed. The existing acceptance runtime stayed stopped, original PIDs absent.
The final complete `npm test` process exited0, including popup24/24, isolated
MV3 integration13/13 and official ProseMirror5/5. Retained full log:
.artifacts/windows-one-command-setup-20261108/checkpoint60-product-final-r3.log.
This does not establish authenticated Dot, final-artifact lifecycle or publication.

## Actual Consent-First Administrator Setup (Checkpoint59)

2026-11-08 UTC. This checkpoint includes authorized local mutations, unlike the
historical read-only/pre-check sections below. Only the dedicated acceptance
installation/IAB development extension changed, not production VPN/MCP/IDE/
research or the original external Chrome task. Native release goal stays active.

1. Old70a dedicated acceptance: no active terminal sessions; GUI Pause operation
   b83eaeb0a3464cbb8862565b82a1cb57 produced sealed stopped receipt. Old exact
   broker/root exited. Pinned RevokeHostedOwner and UnenrollBrowserOwner exit0
   readback retained revocation and removed only its registration. No blind kill.
2. Fresh-parent P1: DirectoryNotFoundException had incorrectly meant collision.
   Production fix recognizes both missing-parent/missing-leaf exceptions; access,
   security and other IO errors stay denied. Real red2fail -> green12/12 scratch/
   extracted-function checks. This unit fixture itself did not install anything.
3. IAB hjnopijiekcbgiljjfiekeiepkebhido reloaded241-member274b3429 preview in its
   SAME observer-reattachment loaded directory. Exact source-only backup retained.
   No browser private state was copied. Normalized product bytes were read back.
4. Actual administrator consent/Copy succeeded. Same-document setup ID:
   b38514a8c6c3b93eba4af02a90a1ce0e. The exact command ran in a real PTY; only
   dedicated tunnel ID and authorized key FILE PATH entered. No key contents
   were sent to the extension, model or chat.
5. Original installation3a7b8d823bcf4bceb953056dbe862128 exited0 with sealed
   complete receipt:24328 protected files, administrator child/state/binding and
   enrollment verified, readyToConnect true, tunnelStarted false. Install began
  04:05:08Z, complete04:11:13Z. No Apply replay.
6. The STILL-OPEN original Setup page automatically requested Connect
   a834a3005f1446bdb9915b7505fd80be, validated handoff69abcb319a6c4b5d8450045bcee55721,
   with no manual Devices Connect. Full-file verification progress was read,
   never mistaken for Ready. New owner later reported ready, generation
  94a3b049f41f4b38befdf9dfcb5e6e83, actual broker70620/root77324 with matching
   start times. Snapshot copied to checkpoint59-live/owner-status-ready.json.
7. Hosted MCP operationacb58a17-cfb7-456a-903f-6701368950ce returned administrator
   true, temporary file roundtrip true and owned child stopped true. Parent
   executable is NEW ec7eb4e2 runtime/node.exe. Command process exited; final
   list_sessions returned no active sessions. This was through the current
   Codex-hosted MCP tools, not ordinary-web PowerShell acceptance.
8. New ordinary ChatGPT IAB chat selected the dedicated D940 plugin, displayed
   Read File approval, then its actual app preview returned the temporary nonce
   checkpoint59-8a3a544ee2a74fc2af51608586a547a7. Request supplied no expected
   contents. Native result matched. Ordinary WEB read_file passed; no new Dot
   invocation or WEB command/process test is claimed.

The new dedicated runtime remains connected/Ready. Do not replay old installation,
retirement or Connect. New-runtime GUI Pause/Revoke, actual reopen restoration,
current-account and existing-install adoption remain separate acceptance gates.
Native CUA navigation from Setup to Devices did not visibly complete in this
trial; no new GUI lifecycle success is claimed. Ordinary IAB browser-tool control
worked. Do not infer a common browser policy root cause from this difference.

Full npm test exited0 before the last display-only patch: control230/browser66/
setup92 module cases;47 Setup/40 Devices rendered checks,13 MV3integration and5
ProseMirror scenarios. New Pause-feedback57 cases pass. Source-only last patch
honestly displays installation verified/readiness unconfirmed in connecting/
requested; red reproduced, rendered55/55 green. It is NOT installed. Local
checkpoint59c preview209ca68b is rebuilt, not reloaded or a Store ZIP. The live
installed preview is274b3429. Separate exact installer pins are in the handoff.

No commit, push, Release or Store submission. Public schedulerv2.2.1 must not be
overwritten with this local Windows version label. Ready and bounded tools do
not establish restart reliability, no-bug operation or final product delivery.

## Consented Setup Continuation Source And Rendered UI (Checkpoint58)

2026-11-08 UTC. The real worker/page now import the same-document setup
coordinator/client and installation-wide Pause provider. This supersedes the
checkpoint57 statement that no runtime source imports them; it does NOT mean the
new candidate has been installed. The latest IAB candidate/protected70a runtime
was not changed in this checkpoint.

The default Windows page exposes scope, risk, consent and Copy; manual keys,
connection steps, alternative commands and diagnostics are closed disclosures.
Rendered Playwright47/47 passed across English/Chinese, light/dark, desktop and
320x600. Desktop/mobile screenshots were visually inspected. These are isolated
fixtures, not live IAB installation or a new ChatGPT/Dot tool invocation.

Full npm product exit0: control230, browser66, setup90 module cases, Setup47,
Devices40, MV3integration13, ProseMirror5; source/mock and browser fixture scope.
After that run's setup phase, final approval-wait regression reproduced the
5-second human-approval timeout and was fixed; client24/24 passed. Final Setup
rerun exited0 with92 module cases,47 rendered checks and1 isolated extension-
loopback case (setup-checkpoint58-final.log). Package13/13 passed. Separate71-case
red/green source regression closes A/B/A original-ID replay and stale acknowledged
observer admission. Unknown Connect uses the original ID, not kill or replay.

Preview archive has241 members under AgentContinue/, not Store root layout:
SHA256519719bac414da46ff326301a0dfa0d99c342ca3709b9e172d743c6853d36d6f.
New setup/client/controller/pause modules and page/worker match normalized source.
It is a LOCAL2.2.1 Windows preview, not a replacement for public scheduler2.2.1.
Native runtime/source pins remain checkpoint57; no new OS activation occurred.

One command is not one UAC. The checked runas route may ask Windows separately
for installation and connection; a new broker is not a release prerequisite.
Mandatory chat authorization is also separate. Required next: exact combined
fresh/existing-install trial, installed-browser permission/clipboard/observer
behavior, actual reopen/Pause/Revoke and corresponding hosted tool readbacks,
then unique new release version and actual GitHub/Store submission receipts.
No production connection, external scheduler or account credential was changed.
Native goal remains active. Historical proofs below are not silently upgraded.

## Setup Admission And Installation Pause Candidate (Checkpoint57)

2026-11-08 03:07 UTC. Source-only setup receipts are sealed under enrollment's
original gate; fast setup-status remains advisory and never starts a process.
589 receipt fixture checks,26 installer-input checks and5 transport cases passed.
Same-document setup coordinator plus actual control-journal modules passed17
fixture cases; combined admission/control cases124 passed. Default stop support
denies, and the coordinator is NOT wired into the live extension.

Review reproduced an actual legacy targeted-Pause race, not a VPN/SSH issue:
sample A:idle -> Connect commits C -> delayed targeted Pause is superseded.
New authenticated installation-wide Pause source fixes that fixture while
retaining legacy targeted semantics. New suite9/9 includes133 PowerShell checks
and actual extracted Connect/Pause/settlement functions with substituted effects.
No production intent or process was used. Mutator timeout does not kill/abort a
child or retry. Requested, pause-recorded and stopped are separate outcomes.
Closed action list regression was red, then fixed; ledger16/16, control213/213.

Complete npm product run exited0; latest targeted source suites passed after
native freeze. Package13, release21, pin13, workflow17 and native-release46
passed separately. Source/mock review is not installed-runtime acceptance.

Latest local complete runtime ZIPec7eb4e2cd19f3ebcc17639471d8af6d1130f97e9a43edf2c170f00fa2d4c343;
setup ZIP0d922e53ba8220cd322cbdf4e801f14abd61f9ccd8a41bc95dee8d50ed3a86ce.
Native host2bd64cb6; stager862a7c87. Plan and extracted-runtime smoke passed:
28tools,67RPCreplies, zero protocol errors/network/browser attempts, actual
owned-file/process roundtrip and standard token. No activation occurred.
Artifact directory: windows-one-command-setup-20261108/installation-pause-local-candidate.
Do not install intermediate cc601 or replace public scheduler-only v2.2.1.

No new UAC, protected installation, registration, permission, Connect/Pause/Revoke
or hosted ChatGPT/Dot call was made here. Existing70a97761 public projection read
Ready/e1e569ef/68384/72324, not a new execution receipt. Existing live GUI stayed
unchanged. Native goal remains active; no commit/push/Release/Store submission.

The whole one-command flow still lacks fixed-control delegation, combined UI
activation, fresh/existing-install and exact final browser lifecycle acceptance.
Current Connect/Pause use their own runas; do not misreport install's one-UAC
count as the total. Windows hosted-runner token compatibility is also unproven.

## One-Command Setup Source And Actual Scope UI (Checkpoint56)

2026-11-08 UTC. New InstallBrowserOwner and the Node/PowerShell/CMD command
orchestration were tested without applying a fresh installation. One consent
coordinates protected setup through one UAC; final state is paused and eligible
for a later browser-owned Connect, not an automatically started tunnel.

Final `npm test` exited0, including Setup44/44, Devices40/40, MV3 integration
13/13 and ProseMirror5/5. Windows guided-install, bundle/enrollment and
acceptance/elevation tests passed. The release builder passed21 tests and the
installer pin suite13. Read-only Plan accepted the exact separate runtime ZIP.
No real combined-action installation/UAC or hosted command was executed here.

The existing IAB preview received only setup.html/setup.js/setup.css, with
backups and exact hash readback. Native computer use opened Installation guide
and visually verified the new Setup first viewport. Changing Current account
to Administrator displayed the explicit one-UAC disclosure; consent stayed
unchecked and Copy stayed disabled. No permission, install or Connect was
requested. Source/installed setup.js:
ed262eb566594d2874c34668b9bc19a141ead7f64640d3bcad168294e2b920c8.

The public setup pin chain now exists in a LOCAL candidate only. Setup ZIP:
99d88d8432419a71ee1fcff33d407ea61b9b34a1b085dcfbbbae571794535348.
It reuses acceptance runtime bundle70a97761 but NEW stager6f5d273c; installed
stager remains4d520da1. Do not mix those pins or replay old operations.
The candidate's2.2.1 label is not a new release and must not overwrite the public
scheduler-only v2.2.1. Live combined installation, automatic connection handoff,
full browser reopen/Revoke and matching public release/Store gates stay open.

## Dot Command, File And Owned Process Readback (Checkpoint54)

2026-11-08 UTC. Existing owner-approved Dot test surface selected the original
AgentContinue Windows D940 Chat plugin, using protected70a97761 runtime. One
bounded PowerShell invocation wrote a unique temporary probe, checked its actual
administrator token and started/stopped only its own temporary child.

After Dot supplied the original terminal PID, independent MCP
read_process_output(pid15884,offset=-5,length5) returned the original JSON:
administrator=true; marker=AC_DOT_ADMIN_20261108_E57C; fileReadMatches=true;
ownedPid61324; ownedProcessExited=true; exit0; runtime1.07s. Separate MCP read_file
returned the unique marker from the protected temporary probe. No new command
was run to reconstruct or replace that output.

The prior ordinary ChatGPT acceptance remains checkpoint53. Both bounded tool
surfaces now have actual command/file/owned-process evidence for this runtime.
Full browser/OS reopen recovery, saved-running restore, Revoke and exact final
public artifact/Store acceptance remain open. These results do not prove the
new UI was installed or that the public one-command administrator package exists.

## Actual Manual Pause-Recovery Cycle Passed (Checkpoint53)

Connect22d6bb2b39c14da59c0afa6f85001f39 reached new protected Ready after52:
generatione1e569efc6bb46ed95c3adce813995cb, broker68384/root72324. Same ordinary
chat6aefc1c9-3f9c-83e9-8d30-58f10f115e7d, one post-reconnect read_file and scoped
Allow once produced an actual File Preview iframe containing
AGENTCONTINUE_WINDOWS_READ_PROBE_20261107. No command/write/process replay.
Thus bounded actual admin command/file/owned process, manual Pause/stopped, then
explicit Connect/hosted read passed. Test connection left Ready, no production
network or workload changes. Full browser reopen, auto-restore, Revoke, new Dot
and public release/Store are NOT established. Source tests remain separately
bounded from this live evidence. The IAB test scheduler remains paused at limit.

## Live Pause And Bounded Status Read (Checkpoint52)

New status-only handler adds one5s whole-flow deadline, not a retry. TDD19new
cases;106related; independent59UItests+9raceprobes passed. Installed IAB member
devices.js5e514418737b7cbee529c259ec9d355d41136a75c359e2c0106a1a91a020cf0a,
backup retained; normal page Reload only. Live query returned unobserved and
released the busy button while native runtime was paused. Source review found no
concrete defect; real exact deadline/throttling boundaries remain unmeasured.

Actual GUI Pause07b400acd5064b69ac671893e8f15d65: protected stopped receipt
00:35:13Z, prior broker41336/root40896 gone. Devices Check pause receipt showed
runtime-not-running-at-verification. Read-only D940 probe then UNAVAILABLE timeout.
No Pause replay; page reload did not restart. Reconcile dialog cancelled/no fence.
Explicit Connect22d6bb2b39c14da59c0afa6f85001f39 admitted00:39:16Z and verified
files advance. This is pending manual recovery, not successful saved reconnect,
browser-reopen recovery or new hosted proof. Do not replay.

## IAB Ordinary Chat Administrator Acceptance (Checkpoint51)

2026-11-08 00:34Z: actual browser Connect8c1fbb7af6bc44c18524c4522e1f1e96
reached protected state=ready after intent-saved/launch-requested. Generation
7441760da6744382ab5948e34b17e777, broker41336/root40896, runtime70a97761,
installed stager4d520da1, same IAB origin and D940 tunnel. No Connect replay.
The Devices status query remains a separate frontend stall, not proof of offline.

Fresh ordinary ChatGPT chat6aefc1c9-3f9c-83e9-8d30-58f10f115e7d selected the
existing D940 plugin. One approved read_file returned the fixed local probe in
an actual File Preview iframe. One separately scoped Allow once approved a
PowerShell admin/file/owned-process test. Its process44620 original output was
retrieved independently with MCP read_process_output: completed exit0 in0.98s,
administrator=true, fileReadMatches=true, ownedPid55148, ownedProcessExited=true.
Separate MCP read_file corroborated AC_IAB_ADMIN_20261108_B6AF at
C:/Program Files/AgentContinueAdmin/70a97761c02a2f2bbc20f408.state/temp/
AgentContinue-IAB-E2E-20261108-0030-b6af/probe.txt.
This is bounded live ordinary-chat administrator execution, not generic ongoing
reliability, complete GUI lifecycle, Dot acceptance or publication. No test replay.

## System Path Casing Hotfix Actually Installed (Checkpoint50)

One70aConnect72e005ec2ed1439d853a220c10865ba9 returned unconfirmed. Pinned read-only
binding/caller checks passed; launch-plan construction failed because -cnotmatch
rejected actual Windows System directory casing. TDD reproduced this; one-line
-notmatch correction passed76cases660checks, including actual OS path and invalid
path refusals. Source audit3cases56checks and Node87/87 also passed. These are not
positive hosted high-pair proof.

Exact-test maintenance at2026-11-08T00:17:04Z fenced72 and atomically replaced only
the sealed stager and its public pause metadata pin under enrollment/execution/
owner exclusion and a pending-admission marker. Backups retained in protected
iab-stager-system-case-20261108.readback. Exit0; pending absent; no registry, task,
authorization, runtime ZIP, key-content or tunnel changes. Actual normal browser
receipt read then showed72 fenced. Updated stagerSHA4d520da17c02ae10ec9d473808f0baaa3286eaa94122a3f2cc45ec7d45bc8866.
The prior Unenroll/Enroll helper design did NOT execute. Helper Start is settled.
Post-update actual read-only binding/caller/plan now passes; no child launched.
New hosted/control/lifecycle acceptance is still pending; no publication claimed.

## Actual Retired-ID Fence And Browser Ingestion (Checkpoint49)

2026-11-08T00:00:31Z targeted high maintenance used official same-ID fencing
for retired799 Connect4ba7255bfd974a948963f5072aace44b. Exclusive operation and
both owner guards retained; retired deny/pause/idle and original no-history
checks passed. Exact-ID tombstone and public fenced receipt read back. A bounded
old-manifest registration window let the normal IAB Devices receipt reader
ingest fenced into its existing journal. Actual screenshot showed original
target/outcome preserved and future-admission-fenced wording, not startup success.
The unresolved global-startup warning disappeared. No direct storage mutation.

At00:03:31Z maintenance completed exit0: currentRegistrationRestored=true,
tunnelStarted=false, keyContentRead=false. Report:
C:/Program Files/AgentContinueAdmin/iab-retired-control-20261107-4ba7255.readback/.
The helper Start is settled/no-replay. Recovery helper is exact-test maintenance,
not released upgrade support; arbitrary other-admin registry writes or process
kill/OS crash remain limitations. Source review and PS5.1 parsing passed;
scratch store266 checks and observation417cases7093assertions are not live proof.

Source permission-query deadline fix passed40 focused and153 related tests.
Only IAB preview devices.js updated to480ebcbb and actual extension manager
Reload used. Original2ec4f96dZIP remains unchanged and no longer matches this
one installed member. Temporary scheduler remains paused/one confirmed send.
New70a positive control/hosted/lifecycle checks remain open; no publication.

## Actual IAB Installation And Enrolled Cutover (Checkpoint48)

Supersedes47 installation/enrollment and goal-status claims, not historical test
evidence. Fresh native get_goal is null after owner clearing; no replacement.
Runtime70a97761 actual local acceptance returned administrator-child-verified,
not merely an elevated parent. Protected root, peer and official Node pins match.
BindHosted9e94bd6184d943f1bb446759b56b65a2 completed once and sealed22:18:42Z
readback verified digest/profile/child/pause. No activation or key-content read.

Cutover at22:24:20Z completed all four supported actions, each exit0:
old799 RevokeHostedOwner, UnenrollBrowserOwner; new70a AuthorizeHostedOwner,
EnrollBrowserOwner. Exact IAB origin and HKLM64 host.json readback passed.
Report: C:/Program Files/AgentContinueAdmin/iab-package-cutover-20261107-2215.readback/result.json.
Both the old unknown execution exclusion and original browser journal were
retained, not deleted. Scoped independent re-review closed the handle-acquisition
race. No new tunnel activation. These one-shot Starts are settled/no-replay.

Only device-control.js/devices.html/devices.js differed in the preview; backup
preview-before-update-20261107-222323 retained. All237 entries now match pinned
preview2ec4f96d. Actual IAB extension manager showed Reloaded, samehjnop ID,
no new permissions. Old799 observer absent afterward; new70a Node observed.
No source of administrator success is inferred from the medium Node process.

Before reload, read-only status was unobserved; control support eligible/paused,
but Connect remained disabled. No new Connect record or dispatch occurred.
Source inspection confirms a global unresolved-operation startup gate in BOTH
page and worker, not a per-bundle gate. Retired799/4ba7255 still unconfirmed.
Do not clear its ledger or simply allow new startup by changing the filter.
Supported retired-ID settlement/readback is under bounded independent review.
That review confirmed the old observation path requires its active manifest;
the new host cannot read the old digest. See retired-control-receipt-recovery
plan for the unimplemented recovery route. No same-ID fence or registration
swap/readback/restore was performed, and the old outcome remains unconfirmed.
The old observer's survival is evidence, not a uniquely established cause of
the gate or response. The Devices tab closed during reload; owner reopen prompt
sent, no extension-URL bypass. Ordinary ChatGPT new-runtime hosted operations,
positive high peer, lifecycle/recovery and release acceptance remain open.

Re-run scoped device/dialog/admin-UI/controller/protocol tests:143/143 pass.
No Dot, production/network/research/original-scheduler changes or publication.

## Actual Granted Permission And IAB Package Admission (Checkpoint47)

Fresh full user image and live AX: permission Granted. Read-only native admin
support: supported/connect eligible/saved intent paused. One explicit browser
Connect for operation4ba7255bfd974a948963f5072aace44b returned unconfirmed; its
same-ID manual receipt read returned no native receipt/progress. No replay.
Protected21:45:16Z observation: paused, three leases absent, zero task instances,
no private record for this ID. Metadata-only report:
C:/Program Files/AgentContinueAdmin/control-4ba7255-20261107-1546.readback/observation.json.
No credentials read, activation or state mutation by that diagnostic. The report
is timestamped evidence, not continuous current health. Silent UAC policy means
no visible prompt does not establish whether elevation occurred.

Actual enrolled host process ancestry ends in packaged Codex ChatGPT.exe, not
chrome.exe. The old C# source rejects that ancestor in both control and session
admission. Windows AppModel family/full-name/registered-root query passed for the
same current IAB process. This compatibility defect is established; the precise
exception causing the instant unconfirmed response was not captured.

RED missing-package-policy test -> source fix ->24 GREEN cases, plus actual IAB
identity and expected-negative own-PowerShell PID. No control calls in those
tests. Both runtime ancestry sites use the same held-handle package check. Code
review's optional-PID Chrome false positive was fixed and scoped re-review closed.
Peer191 cases10122 assertions; projection66/215; entry75/646; native transport430
assertions; combined Node protocol/ledger/observation33/33 all pass. Synthetic
or scratch/medium proof remains distinct from actual elevated admission.

New candidate .artifacts/windows-iab-package-candidate-20261107/:
- runtime SHA25670a97761c02a2f2bbc20f408aec150afd495f10f66ace967e3859b7807a7cde6
- peer source SHA256f11ea6072549c86a5bdeebc33817b4e0281e41cfb09ef3458d82eeb00945cf66
- stager SHA25665676c7174be99cfd152d538938018253129c9616fe465a900da42c0d5c76c49
- preview SHA2562ec4f96daf5e437d4432829eb67a3e8341499b4700bfd072c7a6b39047ca001c

Independent verifier read all24328 streams/287191479 uncompressed bytes, matched
29 first-party sources and official executable pins, then Plan exit0. No protected
install, registry change or tunnel start. Installed799/589 remain unchanged.
Still open: controlled upgrade, unknown-ID disposition, positive new high pair,
ordinary ChatGPT hosted operation, browser lifecycle/recovery/revocation, and
release/submission. Existing historical D940 proof does not close these gates.

## Permission Diagnostics And Current Evidence (Checkpoint46)

User reports manual nativeMessaging Allow, with riskConsent screenshot. Actual
current Browser permission is not independently observed: CUA AX is inconsistent
with its screenshot, and the screenshot supplied by the user omits the top label.
Do not repeat permission prompts, click stale indexes or bypass the earlier URL
policy via desktop/CDP/CLI navigation/activation. Factual top-label readback asked.
Read-only native registration and manifest agree on new799 wake.cmd and the exact
hjnop IAB origin. No native launch or Connect was attempted in this slice; last
protected paused/lease-clear readback remains checkpoint45, not a fresh sample.

Two stale-permission regressions failed first and now pass after revision fencing.
The adjacent permission result/reason and read-only recheck passed synthetic UI
tests, including manual-grant-without-event and revocation-without-event cases.
No native, administrator, standard, scheduler or storage mutation occurred in
those recheck cases. Device suite exit0, UI36/36 and npm check pass. Independent
review's late-device permission-epoch and cached-Revoke findings were reproduced
RED, fixed and scoped re-review closed. Final controller/admin103/103 pass;
final reviewed-source full npm test completed exit0, including device UI36/36,
scheduler UI22/22, MV3 integration13/13, ProseMirror MV3 5/5. Log:
`%TEMP%/agentcontinue-permission-final-regression-20261107.log`. Not live remediation.

Preview-only archive SHA256
`2ec4f96daf5e437d4432829eb67a3e8341499b4700bfd072c7a6b39047ca001c`,
`.artifacts/permission-diagnostics-reviewed-20261107/agent-continue-2.2.1-windows-device-preview.zip`.
Provisional5c5cca6e is superseded;237 members and three changed packaged source
texts checked, no EXE/MSI/DLL/key files.
Not deployed, reloaded, pushed or published. Installed589f8792 unchanged. Ordinary
Chat controlled elevated command/file/process and browser lifecycle remain open
for new799; historical D940 and scheduler acceptance do not close these gates.

## Native Test Cutover And Policy Stop (Checkpoint45)

Actual parent exit0, final protected result21:05:16.1799056Z. High preflight
confirmed old paused/no leases/no instances and new authorization wholly absent.
Supported old Revoke/Unenroll and new Authorize/Enroll each exit0. New79924328
protected files verified; exact current IAB origin hjnopijiekcbgiljjfiekeiepkebhido
and HKLM64 manifest read back. New remains paused/leases clear, activated=false,
tunnelStarted=false. No key bytes, Bind/AcceptLocal/Connect replay or production
change. Evidence `C:/Program Files/AgentContinueAdmin/iab-cutover-20261107-2059.readback`.

Maintenance helper import TOCTOU was fixed with held-hash-snapshot import and
scoped independent re-review before execution. Plan and actual Start succeeded;
do not replay this single-use Start. Inspect is historical readback, not refresh.

Browser Use then explicitly refused chrome-extension: navigation under URL policy,
including alternate-surface/workaround prohibition. No browser/native permission
or Connect was performed. User handoff pending for existing Devices page's risk
checkbox, Allow local bridge access and browser Allow. Do not route around policy
with desktop/CDP/CLI activation or claim browser-managed hosted acceptance passed.
The separate scheduler real-page one-confirmed-send/automatic-limit-Pause passed.

## Installed Receipt And One-Send Limit (Checkpoint44)

The user approved exact589f8792 preview update/reload and the distinct test-only
native cutover/admin grant. All237 source members verified against the pinned ZIP;
old loaded source backed up, same path updated, UI Reloaded observed. IAB origin
hjnopijiekcbgiljjfiekeiepkebhido and settings preserved. The paused temporary task
was explicitly resumed for this acceptance, not blindly replayed.

One Send once now replaced a known disposable draft with the saved159-character
no-tools prompt. Actual ordinary Chat displayed the new configured prompt and
fixed reply. Modern DOM counts each3->4. Installed console read1 confirmed send,
configured limit reached, Paused, Timer not started; Send once now disabled.
This closes this bounded installed receipt/one-limit defect, not all scheduler,
long-running/Dot or Windows-control gates. No original external task mutation.

New high-side readback20:50:31.1293586Z reports old paused/three leases clear/
zero task instances/revoked=false and new binding/profile verified/paused. Key
bytes not read. Actual native cutover not yet performed at this write; browser
permission remains ungranted. Do not reuse an old sealed timestamp as fresh state.

## Reviewed Receipt Candidate (Checkpoint43)

Final source ordinary22/22, background57/57 and VM adapter38/38 pass. New tests
reproduced empty/whitespace message-ID and nested historical-clone false positives
before correction. Same-role logical-unit normalization removes duplicate assistant
counts; modern receipts require a nonempty ID. Historical nonempty ID remains
excluded. These tests are synthetic, not actual live candidate revalidation.

Frozen preview589f8792bf363314f1b443106b2869bde508a796dc8992b099f5e04cd8297b99,
237members, reproducible across two builds; packed background57/57 and normalized
source checks pass. This supersedes provisional6b3f976a. Installed preview remains
77bccd3b, temporary ordinary task remains paused, new UI reload not performed.
Final full npm test completed with exit0. Ordinary22/22, Dot48/48, keyboard12/12,
UI22/22, MV3 integration13/13 and ProseMirror MV3 5/5 passed in the complete run.
Log: %TEMP%/agentcontinue-final-regression-20261107.log. These are synthetic and
browser-fixture regressions; actual installed repaired-receipt/limit acceptance
still awaits the exact candidate update/reload. No native grant/cutover.

## Actual IAB Send And New Receipt Structure (Checkpoint42, 2026-11-07)

The user-installed full preview is enabled2.2.1, actual IAB ID
hjnopijiekcbgiljjfiekeiepkebhido, frozen observer-reattachment source directory.
Console opens, original IAB task initially Not started. A separate temporary
ordinary Chat test was bound with one-send limit, explicit Extension priority,
fixed no-tools prompt and20-minute interval. One Send once now replaced a known
disposable draft and produced both the configured user message and fixed assistant
marker on the actual page. Installed worker nevertheless reported unconfirmed/0.
Manual Pause then visibly stopped this temporary task. No repeat/retry was sent.
This proves one real text submission/replacement, NOT correct installed receipt
accounting, the limit gate, long-running reliability or Windows tool execution.

Read-only UI DOM inspection found zero old-role/article nodes and observed modern
role-qualified search-unit bodies with stable message IDs. Source fallback and
new browser-fixture tests reproduce and repair this compatibility issue:
RED16/18 -> GREEN18/18 ordinary adapter cases. Scheduler fault/completion/resource
regressions now57/57 pass. Review-driven fixes and bounded remaining issues are
in the current handoff and docs/plans/2026-11-07-iab-install-and-scheduler-review.md.

New frozen preview ZIP6b3f976a64ea81619fc106dbbb4204fccf9a5d6007d63ad4d7759ef2fc082c90
is not installed; no current browser re-test of the fix is claimed. Native control
permission remains Not granted. Pinned no-UAC Inspect still reports another native
registration. Neither existing binding nor any Start/Connect/authorization was
replayed. Ordinary Chat's earlier D940 ReadFile Session terminated remains its
own failed tool observation, unrelated to the successful no-tools text round.

## Ordinary Chat And IAB Install Preparation (2026-11-07 15:48 UTC)

Checkpoint39: unified CUA successfully created ordinary Chat6aef44e1-9c80-83ea-
b530-c6eed07b1f1e and observed its actual readiness reply. Existing D940 App Read
File was approved once for the separately created disposable probe; the page
reported Session terminated, NOT a file result. No device activation/retry.

Native IAB Extensions settings showed no AgentContinue. The237 unpacked files
match frozen ZIP77bccd3b exactly. Local Load unpacked directory is filled, but
Select Folder is pending action-time consent and has NOT been activated.
Candidate display2.2.1 Windows device preview, not Store publication or local2.2.2
timer-only repair. No nativeMessaging/admin permission or task/tunnel start.
Unified IAB success supersedes38's unavailable-IAB statement; old native Chrome
URL-validation and picker coordinate-guard errors are distinct. No security
setting was changed or bypassed. Source review found four conditional scheduler
risks, not reproduced current incidents; no source edits/tests this slice.
Original Resume consent retained, not executed. See handoff/checkpoint39 plan.

## Explicit Browser Settings Denial (2026-11-07 14:48 UTC)

Checkpoint38: capturing the trusted setupBrowserRuntime return recovered the
documented Agent reference. Its browsers.list() call returned exactly:
`Local browser use is disabled in Work settings`. This corrects the earlier
missing-global diagnosis; no successful browser listing, UI recovery or send
follows. No private/runtime-source/desktop/external-browser bypass was attempted.
Current local GUI and delivery are not accepted. Old-origin native mismatch
remains separate from scheduler delivery. No actual local task resumed, no
native cutover or settled-operation replay; production and credentials untouched.
Full goal blocked pending user enabling the browser capability, not completed.

## Actual Binding, Still No New Browser Delivery (2026-11-07 14:37 UTC)

Checkpoint37: fixed BindHosted operationddbf6da0823d40c4a4dedc9fbac4d439 on new
79958886 ran once through native RunAs, parent81568 exit0; no retry/kill. Separate
protected readback14:34:40.4469512Z verifies exact receipt/action/digest, all
file/state/launch/command-child/binding/hosted-plan flags, same-SID profile hash
and official dedicated tunnel. New intent paused. OldD940 privately observed
paused/leasesclear/notrevoked/taskinstances0; not inferred from Ready. Readback
projection is Admin-owned, selected-SID read-only; later Inspect rereads it.

Current registration is still oldD940/ibhd testorigin, not localdcah; standard
device_wake registration absent. Both verified without mutation. Newvault/receipts
present, no newbrowserenrollment/task/owner/network connection. Key read only by
authorized binding stager, not chat; readback checks key ACL/length, not content.
Two fresh bounded source reviews found no concrete blockers; first cancelled
review has no verdict. These do not replace actual browser/hosted acceptance.

No liveChrome reload, originalPause clearance, existing registration/task/tunnel
or production change. IAB control handle unavailable; no unsafe workaround.
Never replay this Bind/AcceptLocal or erase evidence. Full goal active and new
release pending. Exact pins/commands/receipt and next coordinated cutover gate:
docs/plans/2026-11-07-control-candidate-binding.md.

## Observer Reattachment Candidate, Not Live Restoration (2026-11-07 UTC)

Checkpoint36: six new recovery assertion failures reproduced, then bounded
observer-only reconnect implemented. Final browser/protocol suite61/61; device
logic62/UI34/control83, scheduler safety35+40+38 and syntax/i18n pass. Exact prior
local preview passes synthetic background40/UI22/ordinary16/Dot48 without edits.
New developer preview77bccd3b (2527075 bytes/237 members) built twice identically,
nine critical files compared;13/13 actual MV3 synthetic scenarios pass, native
permission ungranted. No real user message, hosted call, native reconnect or
running-Chrome state is established. Fresh scoped review and its temporary PS
fixture boundary deviation are documented, not whole-product certification.

Actual old local directory has no admin-control.js. IAB setup yields no available
agent/browser handle; no unsafe workaround or desktop input. Native79958886,
stager65676c71 and loaded scheduler hashes retained. No Pause clearance, credentials,
registration/task/tunnel or production changes. Full goal active; actual browser
deployment, saved-running runtime recovery, controls/revoke/hosted and release
remain open. Do not replay settled D940/new AcceptLocal or unknown operations.
Evidence:docs/plans/2026-11-07-observer-reattachment-results.md.

## Actual New Protected Local Acceptance (2026-11-07 13:45 UTC)

Checkpoint35: one helper Start for candidate79958886 completed through native
RunAs/UAC; exec66672 actual exit0 and observed helper summary
administrator-child-verified/uacRequested=true/administratorChildVerified=true,
tunnelStarted=false/registrationChanged=false. This follows full protected
copy/verify, initially paused state and actual provider-started PowerShell
command-child SID/admin role/TokenElevation/High checks in the reviewed source.
Full hidden stager JSON was not captured; helper verifies its fresh exit witness.

Ordinary installed readback:24328 files,29 first-party hashes match ZIP, official
node.exe pin/version22.23.4, root owner Administrators/protected ACL. Candidate
state present, browser enrollment/secrets absent, no new task; old task Ready.
Worker/parent exited and completed probe directories absent. Stage markers remain
by design, not evidence of a live operation. No kills/replay/marker removal.

This is NOT new browser-managed control/recovery/revoke or hosted acceptance.
Start has no durable operation-ID result; VerifyLocal cannot be used as status.
Independent source review only, not independent installation execution. No key,
registration/task/tunnel/browser input or production change. Original scheduler
Pause preserved; full goal active, publication still pending. Exact command,
scope, recovery limits and local descriptive receipt:
docs/plans/2026-11-07-control-candidate-local-acceptance.md.

## New Candidate Build, Not Installed Restoration (2026-11-07 13:33 UTC)

Checkpoint34: actual coordinated runtime ZIP79958886 (107065439 bytes), developer
previewf65f7886 and external frozen stager65676c71 built in
.artifacts/windows-control-candidate-20261107/. All24328 runtime members streamed
and hashed (287188846 uncompressed bytes);29 first-party sources,38 fixed members,
official Node/tunnel pins, actual build-evidence bytes and8 critical preview files
independently compared. Frozen SystemPS5.1 Plan exit0, complete/not-run, all
verification/binding/activation/registration/tunnel booleans false. Plan alone is
not complete administrator-member or installed-file verification.

Exact unpacked candidate synthetic suites pass background40/UI22/ordinary16/
Dot48/deviceUI34. Explicit extension priority changed-text one-send covered;
Pause/attachment/conversation boundaries retained. No real chat traffic or native
host call. Sensitive-name and archive checks are not full supply-chain/security
certification. Independent sidecar reviewed source/recipe only, not execution.

Original manual Pause and loaded scheduler bytes retained. Current Chrome UI and
original real send not checked in this slice. Protected new installation/enrollment,
positive high/public controls, recovery/revoke and both hosted surfaces still open;
no D940 replay, install/UAC/key/registry/task/tunnel/browser input or production
change. No commit/push/Release/Store/npm. Full original native goal active. Exact
commands, hashes, packaged test evidence and limits:
docs/plans/2026-11-07-control-candidate-build-results.md.

## Capability Projection Source, Not Installed Control (2026-11-07 UTC)

Stager65676c71 adds the exact read-only support entry and canonical public saved
intent. Medium never reads private lifecycle/keys, starts UAC/tasks or repairs
state. Advisory row inconsistencies deny startup, not sealed-binding Revoke.
High live revision/generation/deny remains authority. Last-published running is
not a Ready process/tunnel. Existing guarded publisher and legacy denial refresh
the row; optional publication failure preserves denial.

Reproduced/fixed outer capability timeout mismatch and exact inherited-private
lifecycle ACL incompatibility. Parent actualPS5.1 support113/267,24 cross-decoder
wire vectors and observation417/7093 pass. Nodecontrols83/83, devicelogic62/62,
synthetic browser UI34/34 and existing Pause5groups pass. Final refined ledger
16/16 exit0,64.064seconds and npm check/catalog4 pass. Exact frozen hashes:
docs/plans/2026-11-07-control-support-projection-results.md.
Independent scoped static re-review closed source/test findings, no independent
execution. ACL/owner observations remain declared fixtures, not positive High
or protected installed/full CLI/browser/hosted acceptance.

Exact loaded scheduler fixtures freshly pass40background/22UI/16ordinary/48Dot;
priority changed-text one-send is tested without any real chat traffic. Original
manual Pause, loaded popup/background/adapter hashes and main592f8d6 unchanged.
No actual originalsend/finalUIstate proof. No browser/desktop input, build/install,
UAC/key/task/registry/tunnel/production/publication action. Full goal active;
new candidate rebuild/enrollment, high/lifecycle/revoke and release gates remain.

## Fixed Entry Source And Real Hash Regression (2026-11-07 12:51 UTC)

Stagerc8297777 implements the eight fixed sealed control actions and keeps the
selected medium caller alive through bounded, correlated public ACK readback.
High derives its owner/enrollment/bindings from protected fixed assets, holds the
archive against writes, and delegates to the existing kernel operation. Trusted
audit owns its SHA256 instance; actual complete ZIP/hash audit is independently
exercised. Exit/deadline waiter races now receive one final ACK read. No kill,
automatic replay, new operation ID, task creation or legacy Connect recursion.

Actual SystemPS5.1: entry75cases/646checks, real full ZIP verifier3cases/56checks,
observation416cases/7089assertions PASS. Full ledger15/15 exit0,60.216seconds;
existing Node control/UI/protocol80/80 PASS. Two reviewer-found implementation
defects reproduced RED then GREEN; the test callback exception oracle was also
corrected. Bounded final static re-review closed those findings, not independent
execution or whole-product security certification. Entry tests use declared
owner/OS/kernel/task/binding substitutions; full-verifier tests use scratch ACL/
owner/kernel/task seams. No new positive high/native/protected/browser proof.

CheckBrowserHostedOwnerControl/support projection remains absent, so no claim
that new installed GUI controls work. This source is unbuilt/uninstalled and must
not reuse old archive/stager pins. Real new-candidate recovery/revoke, browser
and hosted acceptance and release remain outstanding. Settled D940 not replayed.
Exact hashes and scope: docs/plans/2026-11-07-control-sealed-entry-results.md.

Installed popup12711009/background66c90c0c/adapter67999cf0 hashes unchanged; only
hash readback was fresh this slice, not earlier UI22/background40/adapter16 runs.
No original task send, Pause clearing or browser/desktop action. No build/install,
UAC/key/task/service/registry/tunnel/production/publication change. Main592f8d6
unchanged. Full original goal active and native objective body unchanged.

## Durable Handoff Source, Not Installed Acceptance (2026-11-07 UTC)

Stageraa39d11f now connects typed peer admission to the original-ID transaction
and immutable private/public handoff. Exact sharing violations use readback-only
busy admission, replacement high pairs have distinct sidecars, missing originals
are fenced before ACK, and protected binding remains mandatory after medium
witness disposal. New public mutation support/routes and medium waiter are still
absent; no positive new high-pair/protected/installed/hosted acceptance claimed.

Parent actualPS5.1 handoff45/454 passes with explicit nine scratch-substitution
categories. Actual exclusive file handles and immutable publication, fake positive
peer/high acquisition and owner/lifecycle/task/ACL seams. Initial combined13/13,
control/UI/protocol80/80 pass. Final refined combined13/13 passes, exit0,
53.839seconds, mandatory45/454 and all nine categories, no skips/cancellations. Bounded
independent static re-review found no confirmed scoped source defect; three test
notes addressed and final delta re-review closed all three with no new scoped
actionable finding, not independent test execution. Exact frozen source/fixture
hashes and scope: docs/plans/2026-11-07-control-durable-handoff-results.md.

Unchanged exact installed scheduler files pass headless synthetic UI22/22,
background40/40, ordinary adapter16/16. No actual original send, manual Pause
clearing, browser/desktop input or production mutation. D940 untouched; no new
build/install/UAC/key/task/registry/tunnel or publication. Full goal active.

## Source Peer Binding And Null-Target Regression (2026-11-07 11:48 UTC)

Stager25238a11 adds archive-digest-bound source load, private-compiler-directory
contract and typed witness projection. Fixed reviewer-found relative compiler
directory/CWD issue and actual PS5.1 null-to-empty static-call conversion; exact
MethodInfo invocation retains null for Revoke/Fence/Reconcile. Parent archive/
compiler fixture37/133, projection66/215 and combined control-ledger/observation
12/12 pass on actual PS5.1. Test positives use compiler ACL stub/fake typed peer;
actual current medium refuses high admission. Not protected ACL, positive High
pair, full stager entry, durable ACK or installed/public mutation-route proof.
Final static re-review closed both test-evidence P2s: policy validation precedes
exact actual-medium refusal, and wrapper requires all13compilerCases/six coverage
categories. Refined full combined12/12 rerun passed, not independent execution.
Exact inputs/hashes and initial test-harness
parameter-extraction correction in control-peer-stager-binding-results.md.
No installed change, D940 replay, original scheduler Pause clearing, browser
input, production mutation, UAC, new service/task/tunnel, key read or publication.
Full original goal active; public routes/detached lifecycle/real acceptance open.

## Local Console Repair And Publication Boundary (2026-11-07 11:18 UTC)

The actual installed preview's inherited target selector was repaired after a
real no-send Check returned an unsupported-page error while the original dot
remained open. After UI-only reload, the selector chose the original dot and
the actual Check returned Composer detected, explicitly without entering or
sending. The final installed popup also includes the independently reviewed
popup-expansion fix. Source/installed UI22/22 and unchanged background40/40 pass;
actual original-task scheduled delivery remains UNVERIFIED under preserved
manual Pause. Last observed interval20min,prompt4728characters,count0 unchanged.
Computer Use ended on browser-URL policy uncertainty during final UI reload;
no further desktop action or successful final reload is claimed.

Only the three-file scheduler repair is public main592f8d6aaa8b579a546a1b3da5607e5a11731732,
pushed and independently read back from origin. Exact index snapshot passed full
public npm test and package6/6 after normal pinned PDF.js generation. Headless/
synthetic extension evidence is not an actual original-conversation send.
GitHub Extension checks42367662638 completed successfully at11:21:33UTC for
the exact main SHA, read back via the public Actions API. Headed full npm test,
package generation and artifact upload passed; not a real production-task send.
No new tag, Release, Store submission/approval or npm publication.

Separate native peer source has actual-medium self identity and policy evidence:
PS5.1 fixture191cases/10122assertions/22vectors, existing native430, JS12/12 and
combined control10/10. Independent static review's test-oracle P2 is closed.
This does NOT prove an actual new High pair, sealed stager entry, detached
handoff, protected operation or new hosted lifecycle. Those new APIs are not
called by stager routes yet and remain unpublished/uninstalled. D940 untouched.
Evidence: docs/plans/2026-11-07-control-kernel-peer-results.md and current handoff.

## Local Console Recheck And Source Status Endpoint (2026-11-07 10:39 UTC)

Fresh read-only Computer Use sees the existing dcah console with manual Pause
and Resume available. No input, configuration mutation or prompt submission.
Installed background66c90c0c/adapter67999cf0 unchanged; exact installed
background-v2 tests40/40 pass again. Prior real no-send diagnostic/export remain
historical evidence. Actual original-task delivery remains unverified under
the owner's preserved Pause; no repair is permission to resume it.

New source-only ObserveHostedOwnerControl routing and closed public projection
are implemented. Red-to-green tests cover linguistic action/key comparisons
and a case-variant request with both new parameters omitted. Observation400
cases/6897assertions passes in5.1/7; combined ledger/native-bridge9/9 and
control/UI/protocol80/80 pass. Final independent static re-review found no
remaining actionable scoped issue, not independent runtime test evidence.
No full stager, protected verification, OS-peer admission or new browser/hosted
acceptance was executed. Mutation support remains unavailable.

Current source3477336811416167a8c4bafc8957d77f894b1f6e7b48d5828ace62fc88e8718e
is unbuilt/uninstalled. No D940 replay, task/service/tunnel install, UAC,
credential read, saved Pause change or new publication. Existing main5468a72
was read back from origin; native WIP remains unpublished. Full goal active,
with new lifecycle/recovery/revocation and release gates still open.
Exact inputs and limits: docs/plans/2026-11-07-control-status-endpoint-results.md.

## Final Bounded Control Review (2026-11-07 10:12 UTC)

Fresh static review of the frozen revised design/source/four fixtures found no
actionable scoped blocker, with all six hashes unchanged. Parent executed
operation29/943,store266,identity75,runner86/528 in both shells. This supersedes
pending-review wording, not the remaining protected-runtime/public action/OSpeer
and release gates. No stager dispatch or installed feature change occurred.
See docs/plans/2026-11-07-control-operation-regression-results.md.

## Control Review Corrections (2026-11-07 10:09 UTC)

Source-only, not new runtime acceptance. After independent review and red/green
scalar-identity tests, both shells pass operation29/943,store266,identity75 and
runner86/528. Current source stager5a38dd292d86323e2c6c4dd70b70aef7fb94e3c44db39303e61d9aee83b87655
supersedes49544235 below; no bundle built, installed or connected. Fresh final
review pending. See docs/plans/2026-11-07-control-operation-regression-results.md.
Actual scheduler, manual Pause, D940 and all production connections untouched.

## Source-Only Control Regression (2026-11-07 10:04 UTC)

No installed runtime acceptance was performed. Existing actual scheduler
background66c90c0c/adapter67999cf0 hashes remain unchanged and original manual
Pause remains authoritative. See DEVELOPMENT-HANDOFF's current repair section.

Internal scratch operation5.1 baseline21/28 and7 baseline0/28 were reproduced.
After action-specific phase scanning and typed canonical JSON readback fixes,
both pass29 cases/943 checks, store256 and identity67. Six canonical store
fixture hashes agree across shells; neither floating/string/bool version
coercion nor a forbidden Revoke launch phase is permitted. PS5.1 ledger6144
read combinations/363 publication cases/45115 assertions, Node protocol17 and
control/parity/UI63 also pass; scheduler timeout/timing-i18n8 pass unchanged.
Focused self-process/stub-terminal suite62 cases/288 checks passes in each
shell: Int32/Int64 PID readback, canonical bounded tick strings and strict
terminal version types. It neither launches nor stops a process.

Scope: extracted functions, scratch data and ACL/OS stubs; no actual lifecycle
command, installation, enrollment, connection, key read, task registration or
new high-token/OS-peer assertion. Public control action routing and detached
handoff remain missing. Keep production Desktop/64bit gate and saved Pause.
No Release/tag/Store/npm publication or production VPN/MCP/IDE/research/Process
Lasso change. Independent review is still pending at this checkpoint. New
source stager495442350d074aeb1df60bdc9449835382f099989e59a20da3e439dc8f61a837
is not a built or accepted candidate. Full original native goal active; its body is not rewritten by
the status-only goal API.

## Post-Reload Actual Local Scheduler: 2026-11-07 09:47 UTC

Current actual dcah console readback supersedes prior post-reload uncertainty:
manualPause preserved,20minutes,4728characters; Settings extensionPriority visibly
checked. Own no-send diagnostic returned authorization1ms/oktrue/allowedfalse,
hidden page first1057ms,total2058ms. Own Export generated
D:/Downloads/agent-continue-activity (2).json: schema4,extensionVersion2.2.2,
71 entries including2 typed timing probes. No prompt content read, setting
changed, Pause cleared or production message sent. These are actual UI/runtime
observations, not just source tests, but do not establish production delivery.
Main0e6b37e pushed and remote main readback matched; no new Release/Store action.
See docs/incidents/2026-11-07-local-scheduler.md for bounded public evidence.

## Local Scheduler Follow-Up: 2026-11-07

Exact public scheduler index passed full npm test; public packaging6 passed and
both archive layouts built. Existing main local commit0e6b37e contains only the
scheduler recovery/diagnostic slice, not the native administrator WIP. No push,
Release or Store submission in this follow-up. The verification archives retain
base version2.2.1 and must not be presented as a new published release.

Eight backed-up scheduler/UI files were deployed to the same loaded dcah preview,
preserving old native imports/dispatch. New installed background SHA256:
66c90c0c869ffc2f9caa8c20ee4ef8cf8ced0944253291e24fea83d31d79e4d8.
Exact preview disposable background40/MV3 13 pass. Last actual console before
targeted extension Reload showed manualPause,20minutes,4728characters and the
successful no-send check. Reload was issued; navigation back stopped Computer
Use on browser-URL policy-confidence failure. No further app input or bypass.
Post-reload real diagnostic/export4 not observed; no production prompt sent.
Original manualPause remains authoritative. Scope and limits are in the plan
and DEVELOPMENT-HANDOFF latest section, not a full recovered-delivery claim.

## Emergency Local Scheduler Repair: 2026-11-07 09:21 UTC

This incident is separate from the D940 administrator acceptance below. Actual
Chrome had unpacked 2.2.0 dcahjbghpncachlghgemfgpeggibgmbd and Store2.1.0
jpioilmpbolfokedaefmbfbjeaahfdkl enabled simultaneously. Source path was the
old e8a56275 unpacked candidate. Exported current log64 has30 20-second
execution-exception watchdogs and18 adapter-result uncertainties; no individual
dispatch outcome follows from those counts.

Read-only real target probes while paused: CHECK_PAGE recognized the composer;
isolated CHECK_RUN returned ok=true/allowed=false in1ms. Hidden-page requested
60ms+180ms timers measured991ms+1001ms. No prompt, chat body, DOM content, URL,
credential or raw exception was collected by these probes. Timer dilation is
observed, but not a complete retrospective cause attribution.

Actual local preview has been patched and reloaded as2.2.2 Local timer repair
(Windows preview), same extension ID and storage. Store duplicate disabled,
not removed; no data cleared. Adapter SHA256
67999cf08f15579cbeddf018fad792330ea85e6575e1891887b7426f3050d871;
patched background SHA256
923e6104b65aa82c670f25f757f498b75517b115332bcbc1c0eadf4e91363a82.
Backup at .artifacts/local-extension-recovery-20261107; original candidate ZIP
and immutable D940 were not modified. The unpacked e8 directory is now a local
repair deployment and no longer equals that original archive.

Worker-owned WAIT_RUN permits only50/60/150/180ms, validates run/tab/frame/URL/
deadline both sides of the wait, and does not retain the state queue. No extra
submission attempt/fallback is introduced. The non-sending Diagnostics control
requires a paused bound job and returns bounded metadata only.

Source and exact loaded preview: background-v2 38/38; adapter38/38;
background-state34/34; support19/19; UI15/15; real MV3 13/13. Follow-up exact
preview MV3 also passed a500ms delayed receipt with all isolated page timers
forced to >=60s; one configured message confirmed, zero adapter page timers.
Independent bounded source review found no actionable finding, not a complete
product certification. Worker suspension, renderer freezing and real production
Dot receipt under the repaired code remain unverified. The original manual
Pause is retained; resumption choice requested, no production prompt dispatched.
No VPN, production MCP, IDE, research, Process Lasso or browser profile changes.
No Release, npm publish or Store submission occurred in this incident response.

Current direction: [Windows command-only delivery](DEVELOPMENT-HANDOFF.md#windows-command-only-delivery-current).
The owner no longer requires or permits a custom EXE installer or launcher for
the default path. The following publisher/signature evidence is retained for
historical and existing-bridge diagnostics, not as a gate for Node installation.
The official portable Node and tunnel client remain separate dependencies.

## Windows hosted acceptance

### Live Windows pilot, 2026-11-05

The exact reviewed Windows preview kit (SHA-256
`b095004324f660a69f326059eceeb3b7030911c1d7d15e9563c6c2928c419a58`)
loaded its unpacked extension in isolated Chromium. Its command-only setup
started a separate per-user manager using the official tunnel client, the
dedicated acceptance tunnel, and the owner's explicitly selected local
runtime-key file. No key was copied into the installation. The manager's
durable installer operation read back as settled and ready.

- Ordinary ChatGPT: the owner approved the low-risk tools; the named app's
  `Read File` result visibly returned the disposable challenge, which matched
  the local digest. The assistant's plain "Success" was not the evidence.
- Dot: the same private app was selectable by mention. Its separate exact test
  path appeared once in the Windows acceptance runtime's `read_file` history;
  the recorded result matched the independent Dot challenge digest. Dot did
  not expose the same inline tool card in this test.
- Automatic recovery: after terminating only the verified test tunnel process,
  the same owner started one replacement and returned ready in 3.8 seconds.
  A separate direct app tool call then launched PowerShell and returned the
  expected test marker. This last call verifies terminal transport through
  the app, not browser approval for commands in both ChatGPT surfaces.
- Explicit manual pause disconnected the test tunnel and it did not restart
  during the follow-up check. This did not test boot, logout/login, elevation
  or persistent permission grants.

The first maintainer launcher stayed open after the durable operation settled.
The revised wrapper bounds process/pipe waits and records unconfirmed instead
of rerunning the installer. The live rerun returned a bounded unconfirmed
wrapper receipt; a separate read-only installer-status call confirmed that
run's own operation had settled. Both test installs were paused afterward.
This is evidence for live Windows tools on the tested preview kit, not a
stable Store package or a completed release.

### Browser-driven Windows startup fixture

Opening a fresh Chromium process with the same disposable profile woke an
unpacked fixture extension without navigating to an extension page or running
a terminal command. A temporary current-user registration allowed only that
extension ID to launch a hidden CMD script and its bound Node executable.
The generated CMD passes only Chrome's extension-origin argument and
ignores the optional parent window argument.
No custom installer or executable was built.

The fixture uses the same browser wake module imported by the extension
background worker and the same Native Messaging handshake used by the
Windows host's `--browser-wake` mode. Its randomized host name and synthetic
tunnel are test-only. The port started the real AgentContinue owner and
controller, using the real named pipe and leases. With a simulated tunnel
child, a saved running state led to exactly one launch; a saved manual pause
or an unfinished pause receipt led to zero launches. Closing Chromium
released the fixture owner and host, and cleanup removed only the randomized
test registration. All three variants passed locally. The fixture uses both
worker initialization and `onStartup`
because the unpacked test load did not reliably deliver the latter alone.

The owner now opens and verifies its operation journal before considering
saved-running startup or legacy login recovery. After opening the IPC
endpoint, it rechecks ownership, the journal, and saved pause intent before
starting the tunnel. Unfinished receipts are preserved as unknown and are
not replayed. A malformed journal fails owner startup without resolving a
tunnel launch.

The extension source attempts the separate `com.agentcontinue.device_wake`
host on Windows only after the optional Native Messaging permission has
been granted. It never requests permission in the background. Its wake
frame accepts no configuration, credential, shell input or reconnect
operation. After acknowledgement, the exact **Browser-managed Windows**
Devices page can send only status, reconnect or disconnect-and-pause over
that same owner port. Mutations require the owner ID from a prior status
read. A missing or changed owner never routes to the older native bridge.
The browser-managed operation record is separate from the standalone and
remote-device records. Acknowledgement proves local owner admission, not
tunnel readiness or chat authorization. Revoking the browser permission
closes its port. An unavailable host is attempted only once per browser
session unless the user grants the permission again.

The Windows source installer has an explicit `-BrowserManaged` candidate
mode. It stages the pinned device and registers only the new wake host
without starting a detached manager, opening a browser, or activating the
tunnel. The default command-only and signed-host routes are unchanged.
The fixture uses the installer's generated CMD wrapper under a randomized
Chromium registration; the real create-only writer is tested independently
against a disposable HKCU fixture key. No production host was registered.
The Chromium fixture also uses the real Devices page to check status,
connect, close the browser, reopen without an intervening command, and
pause the recovered device. The hosted tunnel in this fixture is simulated.
Port loss after admission is tested independently: the same owner drains
the mutation, and only the retained operation ID can reconcile its receipt.
The existing manager can recover a failed tunnel while the owner survives,
but a forced owner crash can leave leases and a live tunnel child. Require
positive old-process-tree termination before removing any stale ownership
record; an unreachable pipe is not enough. The synthetic fixture does not
establish upstream reachability, forced owner recovery or production installation.

### Browser-driven Windows recovery with the official tunnel, 2026-11-05

The r5 Windows preview ZIP was verified, then its packaged Devices page,
wake module and actual Windows setup payload were used in a disposable
Chromium profile. The fixture replaces the worker entry point and Chrome
registry host name only for isolation. Setup configured the official pinned
client with a dedicated test tunnel and did not start a detached manager.
The approved existing local key file was used by the installer; no key was
included in the package, commands, test output, or Chromium environment.

Devices connected the test tunnel. A full browser exit released the owner
and all three ownership files. Reopening the browser alone, without opening
Devices or issuing a reconnect command, produced a new owner and the official
client returned `Ready`. Devices then disconnected and paused it; the next
browser launch reported `Paused / Disconnected`. Cleanup removed the random
fixture registration and temporary test installation after ownership release.
Two existing test managers were checked with their own package and left paused.

The related local tests reproduce a slow start that reaches readiness after
the initial deadline and a stale success arriving after the child becomes
unknown. Background observation notices the former without a status request,
rejects the latter, and preserves manual pause, confirmed process ownership
and the existing restart cap. All 100 focused tests and the separate official
tunnel test passed. This run did not send a new ChatGPT or Dot tool call
after recovery, simulate a real network outage, or test forced browser/host
termination. It did not modify production connections or publish a release.

#### Recovery while the browser stays open

Set `AC_HOSTED_INJECT_TUNNEL_EXIT=true` in the dedicated hosted fixture.
After browser-only startup reaches Ready, the
fixture holds a Windows process handle for the single client matching its
disposable installation's exact executable path, terminates only that
client, and confirms its exit. It then observes a fresh successful readiness
record before querying Devices state. A single different process identity
and the unchanged browser-owner channel corroborate recovery. No reconnect
request, page navigation or manual terminal is used after fault injection.

Both verified archives passed: r6 in 3.18 s and r7-recovery in 2.45 s
(fixture observation times including injection overhead; one run each,
not a speed comparison). Both also passed clean browser reopen and
explicit pause across reopen. An earlier harness timed out because it
expected the controller's internal restart counter in the Devices response;
that counter is not part of the response and that run did not establish
failure to reconnect.

Separately, a regression test reproduced a real code defect: when the
launcher had exited but the first check still found its old stdio provider
alive, r6 abandoned automatic replacement. r7 waits within the existing
five-second production stop budget for positive exit evidence, then starts
one replacement only if the same unpaused owner still owns the attempt.
The regression also verifies that pause wins during this wait. The 99
focused browser-wake, owner, lifecycle and supervision tests passed.

r7-recovery preview ZIP SHA-256:
`c5914e1ff0ee5a9a13f9d752c9c6063db20a60d3af16eb1618519d870a7aa256`.
This evidence covers the disposable profile and dedicated real tunnel, not
a full native-owner crash, an extended upstream outage, production, or a
new hosted ChatGPT/Dot call. It does not require a ChatGPT page to be open
but does require the one-time local runtime setup and browser permission.

The opt-in rehearsal is in `tests/windows-browser-native-startup-tests.mjs`.
Use a verified unpacked kit's `WindowsSetup` directory (`AC_HOSTED_SETUP`),
a dedicated test tunnel (`AC_HOSTED_TUNNEL_ID`) with no other connected owner,
a local runtime-key file path (`AC_HOSTED_KEY_FILE`), and the pinned official
archive and npm cache (`AC_HOSTED_TUNNEL_ARCHIVE`, `AC_HOSTED_NPM_CACHE`).
Set `AC_HOSTED_BROWSER_ACCEPTANCE=accept-dedicated-test-tunnel` for that run
only. With no opt-in, the test uses the offline synthetic scenarios.

#### Ordinary ChatGPT after a tunnel process failure, 2026-11-05

The verified r7-recovery package opened its web-probe window only after
terminating the exact dedicated test client, observing its unique successor
reach Ready (3.06 s), and confirming that the browser owner had not changed.
The existing ordinary ChatGPT acceptance chat sent one request to read one
fresh disposable file through the private Windows acceptance app. Its new
reply contained the exact random line, and the independent digest comparison
matched. The isolated provider log recorded three successful reads of the
exact path in that window: one tagged UI, two unattributed. This establishes
that the read path works after tunnel-child recovery; the single-read
condition failed. The log does not identify the other callers and says
nothing about duplicate writes or commands.

The Dot main conversation had ongoing work and no separate test conversation
was available in this run. No prompt was sent there. This was not a
failed Dot call. No production runtime, grant, or published release changed.
After the test, the fixture paused, reopened to verify pause, and removed
its registration and runtime.

For a one-surface rehearsal, set `AC_HOSTED_WEB_SURFACES=chatgpt` or
`dot`; omit it or set `both` for both. When combined with failure injection,
wait for `browser-recovered-ready`, not `browser-reopened-ready`, before
sending a probe. The final per-surface receipt reports the read path and
single-read evidence separately and marks an unrequested zero-count
surface as `not-tested`. A passing runtime test is not a passing result
for every hosted surface.

#### Ordinary ChatGPT after browser recovery, 2026-11-05

With the same verified r5 ZIP, the disposable browser owner exposed a
bounded web acceptance window only after a full browser restart and a new
owner returned `Ready`. The ordinary ChatGPT acceptance conversation invoked
the named private app on a fresh disposable file. A first attempt produced
a generic success response but the preview reported it could not render;
that response was not counted. A second fresh probe returned the exact
unknown random test line in the chat. The local verifier matched its digest.
This proves the ordinary ChatGPT-to-Windows read path after browser recovery.

The isolated Desktop Commander runtime recorded **three** `read_file`
invocations for the second probe's exact path within the post-reopen window.
Two entries inspected while the window was open both contained the expected
result, with no UI/model origin field. The final count disproves the requested
single-read contract. It does not identify whether the model, UI, or transport
initiated the additional reads. Do not infer at-most-once execution for shell
or write calls, and do not test those against production. Dot showed active
research; no test prompt was sent there. Both browser runs paused the test
tunnel, reopened to verify pause, and cleaned up the disposable owner.

The fixture accepts `AC_HOSTED_WEB_WINDOW_SECONDS` (1 to 180) with the
dedicated-tunnel opt-in and `AC_HOSTED_WEB_PROBES` pointing to a directory
created by `node scripts/hosted-read-acceptance.mjs prepare`. It emits a
`browser-reopened-ready` receipt before accepting external web probes. An
empty `finish-web-window` file at the exact returned path ends that test
window early. The fixture reports per-surface call and marker-match counts
from its own provider log before cleanup. A content match and an exactly-once
pass are separate; paths, raw tool outputs and markers are not exported in
the final receipt.

#### Repeated reads and replay control, 2026-11-05

After another browser-only recovery using r5, one ordinary ChatGPT message
requested two fresh probes with the same private app. Both independently
generated markers matched the reply and the local tool receipts:

| Tool | Exact local calls | Marker matches | Recorded origins |
| --- | ---: | ---: | --- |
| `read_file` (file preview) | 2 | 2 | 1 `ui`, 1 unattributed |
| `read_multiple_files` with one path (no file preview) | 2 | 2 | 2 unattributed |

The pinned Desktop Commander 0.3.1 widget sends its own `read_file` request
with `origin: 'ui'`; one such request was observed. The no-preview control
also repeated, so suppressing the preview would not be a complete fix.
These completion records do not attribute the two untagged control calls
to a model, platform host, retry, or other upstream caller. The verifier now
distinguishes the two tools, reports origin counters, and refuses a single-read
pass if a different read tool also touched the same probe. Reproduce with
`prepare --comparison` and `AC_HOSTED_WEB_COMPARISON=true` in the hosted fixture.

In a separate loopback-only test with the pinned official Windows client
v0.0.19 and a fake control plane, the exact same outer request ID and inner
JSON-RPC ID were delivered twice after the first response. The provider
appended the disposable line twice. This establishes a replay exposure in
that client/provider combination; it does not prove a redelivery happened
in the real ChatGPT test. Do not rely on request IDs alone to prevent a
mutation from being repeated. The next mitigation should enforce a stable
operation identity at the execution boundary and preserve unknown outcomes;
it must not conflate separate user operations that share the same arguments.

Dot was still active and no prompt was sent. The hosted test verified pause
after another browser open and removed its temporary registration/owner.
No production connection, grant, native release or store listing changed.

#### Queryable mutation receipts, 2026-11-05

The r8 Windows candidate adds `agent_continue_operation_status` as a
read-only MCP tool. It accepts the same optional UUIDv4 supplied when calling
a supported mutation. The state directory stores a hash of that ID and one
fixed response classification, never the arguments, paths, command, or
tool output. The provider records its result/error classification before
forwarding the response. A duplicate delivery with the same ID still does
not execute, even if the JSON-RPC ID changes or the provider restarts.
Operations without an ID retain the upstream behavior.

The states are `not-recorded`, `admitted-outcome-unconfirmed`,
`provider-reported-result`, `provider-reported-error`, and
`receipt-unavailable`. None prove that the intended filesystem, process, or
external effect occurred or did not occur. In particular a provider error
can follow a partial effect, and a missing receipt does not authorize
retrying with a fresh ID. This is installation-local recovery metadata,
not an immutable audit log or a cross-device exactly-once guarantee.

The pinned real STDIO provider verified read-only lookup, append deduplication
and result/error/unknown retention after a clean restart. A deliberately
corrupted receipt could not be read as valid or replayed. The official
Windows v0.0.19 client also carried the duplicate rejection and status
lookup against a loopback control plane. The native suite passed 203 tests
with 4 skipped; all four official-client loopback cases passed.

The verified r8 preview ZIP (SHA-256
`343d88d4f9337b6e0104510fef831022502d342dfd982c486f2aee0d380bd90a`)
reopened successfully on the dedicated hosted test tunnel. After refreshing
only that test app's tool catalog, the ordinary ChatGPT acceptance chat
showed a receipt-tool activity and returned the matching
`provider-reported-error` for a seeded disposable record whose status was
not in the prompt. This verifies real hosted discovery and readback, not
a hosted write. No write or shell command was requested from the webpage.
Dot, hosted forwarding of the UUID on actual mutations, and hosted replay
were unverified at that checkpoint. The test tunnel was paused and the temporary runtime
was removed; no production connection, grant, or public release changed.

#### Hosted Windows append and same-ID replay, 2026-11-05

Using the same exact r8 archive, a dedicated Chromium profile reopened
the hosted acceptance tunnel. The test then terminated only the disposable
client and observed one replacement return Ready in 2.71 s under the same
browser owner. The write window opened only after that recovery.

In the ordinary ChatGPT acceptance conversation, `write_file` appended
one random line to the preexisting disposable file using a fresh UUID.
A second message requested the identical append using the same UUID.
The webpage returned JSON-RPC error `-32070` for that delivery. After
pausing the tunnel, the fixture independently confirmed unchanged file
identity, exactly one appended line, one matching `write_file` in the
provider history, and a `provider-reported-result` receipt for the UUID
that had no record before the test. This proves hosted UUID forwarding
and duplicate rejection in this one explicitly keyed case. It does not
show automatic UUID selection, unkeyed safety, Dot behavior, or web shell
execution. No grant, production connection, or public release changed.

To reproduce, use the dedicated hosted opt-in plus
`AC_HOSTED_WEB_APPEND=accept-one-disposable-append`,
`AC_HOSTED_INJECT_TUNNEL_EXIT=true`, and a bounded
`AC_HOSTED_WEB_WINDOW_SECONDS`. Do not combine it with read probes.
The runner emits one exact disposable request only after recovery; the
operator may send that request once and replay the identical request once
in the named acceptance chat. Compare the displayed duplicate error
with the final redacted `web-append-receipt`. That local report deliberately
does not claim a replay was attempted merely because it saw one write.
All 11 verifier tests passed. The real fixture paused, reopened to confirm
pause, and removed the test runtime and randomized registration.

#### Hosted PowerShell and actual operation receipt, 2026-11-05

The exact r8 preview recovered the dedicated hosted test tunnel in 2.94 s
after only its test client was terminated. The ordinary ChatGPT acceptance
chat called `start_process` with the fixture's one fixed PowerShell
`Write-Output` expression, exact Windows shell path, and a fresh operation
ID. The webpage returned the synthetic line and reported the process
finished. The isolated provider history independently confirmed one
exact command, the matching output, the finished status, and an admitted
provider-result receipt. A second webpage message used the read-only
`agent_continue_operation_status` tool on that real operation and returned
`provider-reported-result`; no second shell invocation appeared.

Use `AC_HOSTED_WEB_SHELL=accept-one-output-only-process` with the dedicated
hosted opt-in, a bounded web window, and optional failure injection.
Do not combine it with append or read probes. The final
`web-shell-receipt` uses the local history, not the assistant's message,
and does not print the command, process ID or output. All 12 verifier
tests passed. The fixture paused, reopened to verify pause and removed
its runtime and registration. No system change, elevation, shell replay,
Dot, production grants, or publication was tested or performed here.

The r9 documentation revision ZIP has SHA-256
`0fed3d02258c62b4a531e5920afce7b4f229c4d48f8d6f36c56f05af64cc400f`.
It passed archive verification. Comparing all 281 entry hashes against
tested r8 showed differences only in `START-HERE.md`,
`AgentContinue/PRIVACY.md` and `SHA256SUMS.txt`. The code, Windows setup
payload, and dependencies are byte-identical. The updated guidance
distinguishes local readiness from per-conversation grants and discloses
local runtime tool history separately from redacted extension diagnostics.

#### Browser-managed onboarding and recovery regression, 2026-11-05

The Windows Setup page now recommends the browser-managed PowerShell and
CMD flows. Existing installations can open Devices without accepting a
new install. Standalone setup and temporary pairing remain a separate
fallback. The browser fixture checks command copy, consent, extension ID,
and the absence of native side effects from Setup. A real Windows
Chromium run with a temporary profile and uniquely named fixture
registration verifies browser close/reopen for enabled intent, explicit
pause, and an unfinished pause receipt. The lifecycle suite separately
exercises unexpected child exit and a manual pause during recovery.
The current run did not touch the production registration or tunnel and
does not add evidence of hosted Dot access.

#### Dot after browser-only recovery, 2026-11-05

The exact r10-onboarding preview ZIP (SHA-256
`ec07b202efeff6b3a03bcb01a8e8b78b2472d10793966bccc9939753cec15d27`)
was verified and staged using the same dedicated acceptance tunnel and
previously approved runtime-key file. Both older acceptance installations
were paused and no acceptance tunnel client was running before the test.
After first connection, the disposable Chromium profile was closed and
reopened. It acquired a new owner and reached Ready on the official
tunnel without a second Reconnect.

In the in-app browser, Dot's mention picker offered the private
AgentContinue Windows Acceptance app. One request named that app and
one freshly generated, non-sensitive test file. Dot replied with a short
success message. Independently, the fixture recorded exactly one
`read_file` for that path, zero alternate reads of it, and one result
matching the local challenge digest. The provider did not label the
origin, so no UI/model attribution was inferred. No approval setting
was changed. The ordinary ChatGPT surface was not exercised in this run.

The isolated runtime then disconnected and stayed paused on another
browser reopen. The fixture removed its test registration and runtime;
the pre-existing non-fixture tunnel process remained present. This is
one real Dot file-read result after Windows browser recovery, not a
Dot shell or write result, Linux/macOS acceptance, or release evidence.

#### Dot PowerShell transport and exact-request mismatch, 2026-11-05

The same r10 preview kit recovered the dedicated Windows test tunnel
after the isolated browser reopened. One Dot request selected the private
acceptance app and asked it to run a fixed output-only PowerShell expression
with a fresh operation ID. The reply displayed the expected synthetic output
and reported the process had finished. The isolated provider history
recorded one `start_process`, and the local operation journal recorded
`provider-reported-result` for that ID. A follow-up read-only status request
showed the same state in Dot; the final provider count remained one.

**Exact-request acceptance did not pass.** The independent comparison
found a command-string mismatch (`matchingFinishedCalls=0`). The observed
output and completed receipt establish terminal transport and one invocation
in the test window, not byte-for-byte command forwarding, a numeric exit
code, or where the command changed. The harness previously printed
`verified:false` but exited successfully because the browser lifecycle
completed. It now prints redacted counts for the command, shell, timeout,
and output from the same started/finished process. An exact mismatch fails
the shell test after the disconnect, pause, and reopen checks; fixture
cleanup still runs. This change affects the test harness, not the preview
runtime or its permissions.

The fixture disconnected, preserved pause after reopening, and removed
its registration and runtime. The pre-existing non-test tunnel process
remained present. No production grants or connection settings changed.

#### Dot exact-argument retest, 2026-11-05

Two separate rehearsals used the same dedicated tunnel and r10 runtime after
browser-only recovery. With inline JSON and a Windows backslash path, Dot
reported invalid escapes and did not dispatch the tool. The rendered message
was independently parsed and all four fields matched the requested JSON;
this does not establish what the model received internally. The local receipt
was absent and provider start count was zero. The fixed harness correctly
returned a failing exit code after verifying pause persistence.

The probe now sends the verified absolute Windows PowerShell path with forward
slashes. The pinned Desktop Commander stdio integration test executed that
path successfully. A second live Dot request supplied each field separately.
Dot displayed the expected marker and finished state; the local verifier
observed one start, a provider-result receipt, an exact shell path and timeout,
but no exact command match and no combined marker/finish match. Therefore the
strict live gate still failed. No inference is made about why the command
changed or whether a numeric exit code was available.

The pinned upstream strips start-process structured status before logging or
returning it. The local verifier now reports marker and same-PID finish counts
separately from the exposed provider response text, keeping raw content and
PIDs out of diagnostics. This is not a runtime or permissions change.
Both fixtures cleaned up; the pre-existing non-test tunnel remained running.

#### Exact process request with local digest, 2026-11-05

The r11 candidate adds a distinct `agent_continue_start_process_exact`
tool. Its command, absolute shell path, timeout, UUIDv4 operation ID, and
independently computed SHA-256 are all required. The digest covers the
UTF-8 bytes of `JSON.stringify([command, shell, timeout_ms])`. The host
rejects a malformed or changed request before durable admission or
dispatch. Once checked, it dispatches through the existing replay-fenced
`start_process`; the provider does not receive the guard fields.

The real pinned Desktop Commander stdio tests verified missing and extra
fields, changed command/shell/timeout, no rejected-call receipt or file
effect, one successful process, and replay rejection after host restart.
The pinned official Windows tunnel client v0.0.19 also carried discovery,
mismatch, not-recorded status, one valid process, replay rejection, and
the final provider-result receipt through a loopback fake control plane.
Native suite: 203 passed, four platform skips, zero failed. Pinned client
suite: five passed, zero failed.

The r11 preview ZIP SHA-256 is
`f3d89fd8daaee26d53bdbeef64b57712093e070921bc57a22d63668e5d94583f`.
All 281 entries passed the archive verifier and its host matches the
tested source. Compared with r10, the changes are the host, start guide,
and package integrity records. This is not a hosted Dot result. A digest
is a caller-supplied integrity precondition, not authentication, consent,
elevation, or a restriction on the original `start_process` tool.

#### Prove exact-tool admission separately from process output, 2026-11-05

The r12 host now marks a durably admitted exact process separately.
`agent_continue_operation_status` exposes `requestKind: exact-process`
alongside the status for such an operation. Existing receipts keep their
original format and status. Invalid receipts never produce that marker.
The original r12 web probe opt-in (superseded below)
`AC_HOSTED_WEB_SHELL=accept-one-exact-output-only-process`
generates the tool name, operation ID, and digest locally. It requires the
exact admission marker as well as one provider start, exact arguments,
and matching finished output. A perfect legacy `start_process` result
with a legacy receipt fails this probe. No rejection is claimed from a
missing receipt alone.

The hosted verifier, pinned Desktop Commander stdio test, and official
Windows tunnel-client loopback tests passed (20 total). The r12 ZIP passed
integrity verification, SHA-256
`43d92fa037096be70a8f479440fa878558eb0a9a871a7f95a215f52506ac502d`.
The private test app's management page exposes Refresh tools; its existing
approval policy was observed but not changed. The new tool was not exercised
by Dot or ordinary ChatGPT in this run. A separately confirmed test-app
catalog refresh and an actual guarded tool call remain necessary.

#### Cold install of the exact r12 ZIP, 2026-11-05

The guided PowerShell/Chromium rehearsal first stopped in Setup because
its test driver targeted the older, always-visible standalone control.
The driver now opens the current **Standalone manager and advanced
commands** section before pairing. It also runs the exact-shell scenario
through the installed payload, instead of covering that scenario only
against the source host.

The unchanged r12 ZIP passed from a disposable extraction and Chromium
profile. The fixture reached the actual bundled manager and pinned
Windows tunnel client, paired temporarily, verified the local file
roundtrip and the exact shell success, mismatch, replay, and receipt
cases, then verified pause/reconnect. The pairing origin and ticket
did not remain in extension or page storage. The test used a
loopback-only mock control plane and a synthetic credential. This is
the standalone fallback's browser pairing path, not the primary
browser-managed native registration or a live ChatGPT/Dot call.

The hosted launcher preflight accepted this exact ZIP without opening
an API key or staging a run. Its ten cases and five ZIP verifier tests
passed. No archive, production connection, or cloud catalog changed.

#### Cold install through the primary REGISTER path, 2026-11-05

The unchanged r12 ZIP also passed an actual ConPTY PowerShell
`-BrowserManaged` guided installation. It verified the extension ID
derived from the disposable manifest key at the first prompt, supplied a synthetic key file path,
and typed `REGISTER`. The test preload intercepted only the generated
registry adapter calls, without invoking Windows registry writes. The
fixture captured a single create-only 32-bit HKCU write to the expected
manifest and read it back. The exact installed manifest allowed one
extension origin; the CMD launcher forwarded only Chrome's first
argument. The installation receipt was configured, not connected, with
no manager or tunnel process, no controller lease, and no poll request.

Before/after readbacks of the fixed production host across HKCU/HKLM and
32/64-bit views matched. Both guided paths are now in the same Windows
CI test step; that exact local invocation passed both cases. The
separate browser-wake registration and Windows Chromium startup suite
passed nine tests, including persistent running intent, explicit pause,
and an unfinished pause receipt. Registry capture is not proof of a
real fixed-host registration, a Cloud catalog refresh, or Dot execution
of the exact process tool.

#### Browser reopen through the shipped background entry point, 2026-11-05

The Windows Chromium running-intent test now uses the actual extension
`background.js` and its imports. A disposable manifest grants the fixture
permission and changes the extension ID; the native destination is remapped
to a unique HKCU Chromium test host. The CMD bridge, OS process, owner fences,
and device message routing are real. The tunnel and its health are synthetic.

With running intent already saved, launching and then reopening Chromium
starts one child per owner without a Devices page, ChatGPT tab, manual
command, or status request. The first owner and all its fences are gone
before reopen. Only after the second owner reports Ready does the test open
Devices and verify its status through the real worker. The companion cases
keep an explicitly paused device and an unfinished pause operation offline.
All 12 wake and Windows Chromium tests passed.

Browser-only describes the user's action after one-time local setup and
permission, not the absence of a local runtime. The separate earlier hosted
test covers exit of the tunnel child; neither run establishes unattended
recovery of the native host itself after a broken native-messaging port. No
hosted test was rerun here, and no production connection was used.

#### Native port loss with the browser still open, 2026-11-05

After a valid wake acknowledgement, an unexpected native port disconnect
can schedule one new wake per browser session. This uses a one-shot Chrome
alarm and the existing alarms permission. The retry identity and spent
budget live in session storage; an alarm from a prior browser session
cannot authorize a wake. No commands are resent. Revoked permission, an
unacknowledged port, and an unresolved mutation do not cause a retry.
The normal native ownership, journal, and saved-pause checks still run.

In the disposable Windows Chromium profile, the fixture PID closed its
pipe, released all ownership fences, and exited. Without navigating,
reopening the browser, or requesting a device action, the product worker
started a distinct owner and its single synthetic tunnel in 30.3 s. The
Devices page subsequently reported Ready. This is a controlled port loss,
not forced termination of a native host with a live official tunnel. Native
regressions still confirm that retained fences and unknown exit prevent
automatic takeover. No production process, cloud tool catalog, or user
authorization changed.

The r13 native-recovery Windows preview ZIP passed archive integrity checks.
Its nine relevant JavaScript sources match the tested worktree after line
ending normalization. SHA-256:
`9bcc69646b490cc8f86a8deb00f69ad45830e053f27191867895f3e7cf0dbe4e`.
This is an unpacked preview candidate, not a Store submission or release.

#### Real Windows r13 acceptance in both web surfaces, 2026-11-05

Revalidated the r13 archive and ran two isolated Chromium profiles against
the dedicated official acceptance tunnel. In the first, the browser
reopened and the tunnel reached Ready. Refresh tools on the existing private
test app returned an update error without an exposed cause. Dot reported
that `agent_continue_start_process_exact` was unavailable. The independent
fixture recorded zero provider starts and no operation receipt. The pinned
local stdio regression still lists the tool and verifies guarded execution.
This establishes the discrepancy, not a cause for the web catalogue failure.

In the second run, the dedicated official tunnel child exited, the owner
remained the same, and one replacement reached Ready after about 2.9 s.
Fresh disposable file reads from real Dot and ordinary ChatGPT then matched
their independent local fixture digests. Dot made one exact read. Ordinary
ChatGPT produced three matching reads: one tagged UI and two unattributed.
There were no alternate reads of those fixture paths. Do not attribute all
three to the model. The hosted test owner was paused and its registration
and run state were removed; no production policy was modified.

The harness now fails after cleanup when hosted read receipts are missing,
wrong or repeated. The default `single` gate is for acceptance; setting
`AC_HOSTED_READ_GATE=transport` allows repeated matching reads for diagnosis
only and does not satisfy single-invocation acceptance. For this run, both
read paths were verified but ordinary ChatGPT failed the single-read gate.
The protected exact Dot command also remains unverified.

GitHub still listed `v2.2.0` as Latest and the Chrome Web Store dashboard
requested Google reauthentication. r13 is an unpacked preview, not a
Store archive. No version was uploaded, tagged, or submitted in this run.

#### Windows tool discovery and token attribution, 2026-11-05

In a separate run, an instrumented copy derived from the r13 setup reopened
Chromium and reached Ready on the existing dedicated acceptance tunnel. In the
in-app browser, Refresh tools on the same private app returned a generic
update error. The host recorded zero `initialize` requests, zero `tools/list`
requests and zero list responses before the test was paused and cleaned up.
Only fixed event labels were counted; no arguments, schemas, request IDs or
keys were retained. This diagnostic modified the disposable host only and is
not a byte-exact product test.

An independent local positive control using the same instrumentation and
real pinned MCP provider recorded one initialize, one list request and one
successful stdio reply containing the exact process tool. It does not test
cloud ingestion. The observed web refresh failed before discovery was seen at
the instrumented host. The data does not identify whether app routing, the
tunnel association, the hosted queue or another upstream check caused it.

The local real stdio test also ran a read-only Windows token probe through
the exact process tool. It agreed with a directly launched PowerShell:
`standard`, not an effective Administrators token. Files and process control
worked under that identity. Neither an app grant nor an administrative install
step proves the runtime child has an elevated token.

The next discovery comparison should use the documented private app creation
route with a dedicated fixed-output canary and an independent discovery
trace, leaving the existing app and its permissions unchanged. A successful
new binding does not prove that refresh of the old binding is fixed. For
release, both ordinary ChatGPT and Dot must discover the intended capability
and return independently verifiable file, shell and process results from the
same candidate. An administrator mode must separately show the effective
token from the actual tool child, not from the installer or the browser.

#### Fresh private Windows canary, 2026-11-05

A separate official tunnel was created in the same personal workspace and
kept canary-only. Its disposable Node stdio host exposed one read-only tool
with no arguments, filesystem capability or shell. Local negative checks
rejected both file and process tool names, and rejected extra arguments.
Do not repoint this tunnel or its private app at a command-capable host.

Creating the new private ChatGPT app observed two initialize calls and
one list request and matching response at the Windows host. The app was
installed. A Pro test turn outlasted the first web window; it had no
observed invocation and was stopped. In a separate fresh test window,
ordinary ChatGPT used an explicit one-time tool approval. The returned
synthetic marker's SHA-256 matched the digest generated independently on
Windows and the host recorded exactly one successful tool response.
In a later dedicated run, Dot's app picker showed the canary after reloading
the Dot surface. Dot selected the canary app and returned a fresh marker not
included in the prompt. The independently captured browser digest matched the
Windows digest; the invocation gate passed with two initialize calls, one
successful canary response and zero denied calls. No new list request was
observed during this invocation, so do not infer that Dot re-enumerates tools
before every call.

A separate Refresh tools action on the same new canary app reached the live
Windows host (two initialize calls, one list request, one successful list
response, no tool invocation). The button returned to idle with no visible
error. This contrasts with the old acceptance app's failed refresh with no
requests at its instrumented host. It rules out a universal refresh failure
on this account, not a particular defect in the old binding: app, tunnel,
catalog and app permission setting differ between the cases.

The local fixtures closed and were cleaned up. The isolated cloud app and
tunnel remain for test reuse with no active canary runtime. Production
connections, app permissions and research jobs were not changed. Both chat
surfaces have verified read-only round trips, not full Windows acceptance.
The exact process tool and admin token must be verified on a separately
authorized Windows acceptance binding. Do not expose real commands through
the canary.

#### Windows command-child and browser receipt gate, 2026-11-05

Use `AC_HOSTED_WEB_SHELL=accept-one-exact-token-attested-process` on the
dedicated Windows acceptance binding. The browser harness currently tests a
standard-account runtime; it does not elevate. Run it separately for
ordinary ChatGPT and Dot so each surface has its own operation ID and fixture.
Submit only the emitted tool request. After that surface returns the exact
`AC_WEB_SHELL_<hex>` line, hash the observed line as UTF-8 without its newline
and put the lowercase SHA-256 in the emitted `shellProofFile`. Never derive
that evidence from local logs or the proof file. End the window normally
and check the final `web-shell-receipt` plus persisted pause.

The fixed test command is allowed to create one file in its disposable
work directory. The actual PowerShell child generates the random challenge
at runtime, measures effective Administrators membership, and create-only
writes its PID, token class, and challenge. The verifier requires matching
start/finish PID, exact arguments, the exact-tool admission and provider
result, the child file, the requested token, and the browser digest. It
reports classifications, not the raw challenge, command, or child PID.
This is controlled test evidence, not a proof against a compromised local
account or an authorization mechanism.

The pinned provider writes history in one-second batches; the test must not
stop it immediately after a result. A real local stdio run verified the
child file, exact request, returned challenge, standard token, and duplicate
rejection. Negative tests reject missing proof, PID or output mismatch,
wrong token, and absent or incorrect browser digest. The local test uses its
own returned MCP result, not a web chat: actual end-to-end acceptance from
both web surfaces and a separately authorized elevated runtime remain open.

#### Hosted exact PowerShell: ChatGPT passed, Dot changed one field

The dedicated r13-derived Windows fixture ran the pinned official client
directly with its test lifecycle controller. It did not launch a second
browser or register a native host. The temporary stdio host advertised the
real tool catalog but forwarded only one preselected command request; all
other tool calls were denied before provider execution. The existing private
Windows acceptance app was used without changing its permission policy.
Refresh tools reached the host and returned a list containing the exact tool.

The first ordinary ChatGPT approval card flagged the Base64-encoded proof
path; the expired request was declined without execution. The fixture now
uses a readable filename inside its existing working directory. In the
second run the approval card described the expected one-time action, with
no opaque-payload warning. Ordinary ChatGPT returned a fresh marker. The
browser digest matched the proof file; exactly one request passed the
fixture gate, one exact operation was admitted, and one PowerShell child
started and finished with the matching PID and a standard token. The local
fixture returned verified and persisted pause before deleting its state.

Dot used the same private app in independent runs with fresh operation IDs.
It reached the test host but received a rejection and started no process.
The repeat with field-level counters observed one call to the exact tool;
only `command` differed. Shell path, timeout, operation ID, and digest
matched. The audit logs only field names, not transmitted values; it does
not identify whether the model or an intermediate layer altered the
command. The original digest was not recomputed to accommodate the change.

`tests/hosted-windows-exact-acceptance.mjs` reproduces the non-browser
fixture with the same verified kit, official-client archive, local cache
and dedicated tunnel inputs as the browser-owned test. Use only a
preauthorized test binding. Actual chat actions and reply capture stay in
the in-app browser. Fixture success is not production authorization or
complete Windows acceptance. A candidate product design should prepare
exact commands on the device and submit a durable ID for the reviewed
bytes, rather than requiring a second model-generated command string.

#### Prepared PowerShell passed on both web surfaces

The r14 Windows preview kit passed archive verification (SHA-256
`ed1592dc4a8e53af1e3acae5dce3ec35727a5d3a63f11f4e75418f5603752fec`).
On the dedicated Windows test binding, the fixture used the kit's installed
local staging CLI to prepare its fixed command before connecting. The guard
allowed only the emitted UUID and digest, not raw commands or other tools.
The refresh trace recorded a successful tool list containing the prepared
tool. It did not change the plugin's approval policy.

Ordinary ChatGPT used explicit one-time approval and returned the fresh
PowerShell challenge. Dot's first attempt reported an automatic approval
review deadline; the fixture saw no invocation in that window. A second
Dot run used a fresh isolated state and fresh UUID, not a replay. It
returned a different challenge. In both successful runs the native verifier
observed one prepared admission, one finished PowerShell child with matching
PID, the standard token, and the matching browser digest. The ordinary
ChatGPT run also received one unrelated request that the fixture denied;
its caller was not established. The successful Dot run had no denials.
Every fixture confirmed persistent pause and removed its temporary state.

Reproduce by setting `AC_HOSTED_PREPARED_PROCESS=accept-prepared-preview`
for the existing standalone hosted shell fixture, using a verified kit
containing `prepared-process.mjs` and the same dedicated test binding.
Local regressions rejected expired, tampered, mismatched and duplicate
requests across host restart; actual npm pack/install verified that the
CLI was included. This tests exact prepared execution under the standard
account, not elevated execution, arbitrary process management from both
surfaces, the browser review UI, Linux/macOS, or a published release.

#### Local owner revocation verified from both web surfaces

The r15 Windows preview kit passed archive verification (SHA-256
`aa66b7f40720aee85f5b843e76df7a56b32cc5acfeaf33528d687d6cf5c0dad4`).
In two independent standard-account fixtures, the packaged CLI staged and
revoked the disposable operation before opening the dedicated official
tunnel. Each browser surface then sent its original UUID and digest once.
Ordinary ChatGPT used one-time approval and displayed the exact device
rejection inside a platform error wrapper; Dot displayed JSON-RPC
`-32074` and the same rejection. Each native run recorded a single
prepared request, a single owner-revoked rejection, the persistent
`owner-revoked` receipt, zero provider shell calls, and no child proof file.
Both fixtures confirmed pause and cleaned up. Approval policy was unchanged.

Use `AC_HOSTED_PREPARED_PROCESS=accept-revoked-preview` with the verified
kit and preauthorized Windows test binding. Enter the digest of the exact
error sentence or code observed in the browser into the fixture's
`shellProofFile`. The outer `verified` is the negative acceptance gate;
inner `proof.verified` must not be interpreted as a successful shell run.
The local pinned stdio test also verified the execution-first outcome,
competing CLI and MCP claims, repeat revocation, and no resurrection on
host restart. This is per-operation withdrawal before admission, not
termination of an admitted process, device/plugin grant revocation, or a
browser-native control for issuing withdrawal.

The [official Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
distinguishes Platform runtime access (Tunnels Read and Use) from adding and
using a ChatGPT custom app. The tunnel is suitable for private workspace apps,
not public ChatGPT app submission. Publishing the Chrome extension or its
source does not distribute a hosted tunnel or grant access to a user's device.
Do not add a project relay to satisfy private acceptance.

The Windows x64 local suite passed all four modes with the official pinned
v0.0.19 client. Its packaged mode used the shipped manager CLI and owner IPC
against a loopback-only simulated control plane. The same one-time connect
handler used by `install-local` recorded a settled operation. The packaged
PowerShell wrapper read the same operation before and after pause, and a
repeated installer connect did not resume polling. The fixture stages and
starts the owner separately; it does not prove detached start inside the
combined `install-local` command or authentication against OpenAI. The matching
Windows CI steps have not run on GitHub at this checkpoint.

The command-only Windows bundle now also offers a temporary local browser
control page. It is explicitly started from the terminal after setup, requires
a running owner and a fresh local pairing code, and expires after 15 minutes.
It does not need an EXE installer, Chrome native registration, or an added
extension permission. It forwards only status, pause and reconnect to the
verified owner. The hosted MCP tool path is unchanged. The final extracted ZIP
was started with `install.ps1 -DeviceAction browser` in Windows PowerShell 5.1.
The in-app browser rendered disconnected, ready and paused against a real
Windows named-pipe owner with a simulated controller. Separately the packaged
fixture drove the official client through this HTTP-to-IPC path against a
loopback control plane, including a second MCP file round trip after reconnect.
Neither check verifies hosted authentication or a Chrome Store build.

The command package also passed the network-backed Windows x64 fallback test
under Windows PowerShell 5.1. The fixture exposed only Node 20 on the child
process PATH. The consented install downloaded and verified the official Node
ZIP and staged a command-only manager in an isolated user-data directory;
native registration, tunnel connection and chat authorization remained false.
The x64, ARM64 and x86 ZIP and runtime hashes match the official release list;
only the x64 fallback was executed in this test.

The follow-up x64 run repeated the extracted-package test with a broken
Node shim that exits nonzero. PowerShell downloaded the verified portable
Node ZIP and staged the same command-only manager. Focused PowerShell 5.1
tests also verified skipping a broken PATH candidate in favor of a valid one,
refusing a broken explicit `-NodePath`, not writing through a directory
junction, and reusing a verified cache without a download. The English and
Chinese setup page and the interactive terminal disclose the download before
consent; declining at that prompt leaves the install and cache absent.
These are isolated local tests; no tunnel, native registration, or hosted
tool invocation was performed by the provisioning test.

An installed unpacked extension in an isolated Chromium profile authenticated
the loopback management panel, requested status, reconnected and paused using a
simulated owner. A wrong extension identity and a forged loopback reply did not
unlock controls. A separate owner IPC test confirms that a pinned browser
session cannot follow a replacement owner under the same device binding.
Neither test grants a ChatGPT conversation access.

The extracted Windows command candidate also has an interactive guided entry.
ConPTY fixtures verify real Windows PowerShell and PowerShell 7 prompts, blank
and declined answers, invalid input, request mismatch and a masked key-file
path. The accepted fixture stops at an intentionally missing explicit Node
path after local validation; it does not download or connect. Separate CLI
checks reject redirected input and an extension ID changed across the
PowerShell-to-Node handoff without creating an installation.

A separate Windows x64 guided end-to-end fixture goes beyond preflight. It
builds and extracts the distribution ZIP, drives the real PowerShell 5.1
prompt, and lets `install-local` spawn its detached owner without prestarting
one. It uses a synthetic key and the hash-pinned official Windows executable
with a loopback-only simulated control plane. A test-only preload outside the
ZIP supplies the pinned archive and an offline npm cache. The fixture observes
one owner, one tunnel, a settled installer operation, and a correlated MCP file
write/read. Pause stops the provider; readback and retry keep polling stopped.
The fixture owner releases its channel and exits. This covers automatic start
from the guided command, not OpenAI authentication, ChatGPT/Dot grants, or the
Chrome Store build. The Windows CI job is configured to run it; no remote job
result is claimed at this checkpoint.

The same terminal can hand off to browser controls after the confirmed install
receipt. The paired ConPTY case chooses `PAIR`, checks the signed status reply
from the temporary loopback listener, presses Enter and verifies that the
listener is closed while the tunnel is still ready. Only the subsequent
explicit pause stops the provider. The unpaired case leaves the prompt blank
and checks that installation still succeeds without browser output. A separate
unpacked Chromium test exercises the extension panel; neither test establishes
real ChatGPT or Dot authorization.

The combined Windows browser-to-device fixture builds the Store-shaped ZIP
into a temporary directory and loads the unpacked extension in isolated
Chromium. Only the fixture copy gets a development manifest key, and the
installer request uses the ID Chromium actually loads. After the guided
installation's MCP file round trip, the real extension checks signed status,
pauses and reconnects the same installed manager. The fixture observes the
original client/provider exit and a single replacement tunnel; a page reload
does not restore pairing. The control session closes without disconnecting the
replacement, which the fixture then explicitly pauses. This is an automated
local acceptance test, not Store review or a live OpenAI/ChatGPT/Dot check.

The same packaged workflow also passed through the guided CMD entry. A
real ConPTY launched the extracted `install.cmd guided EXTENSION_ID` and
completed the four PowerShell prompts without pairing. With an existing Node
in the fixture PATH, the official client and provider performed a correlated
file write/read against the simulated loopback control plane. The test
verified pause and no replay. This run did not redownload Node; portable
Node provisioning is verified separately above. No hosted authorization was
performed.

The cold Windows x64 CMD variant now verifies those steps together. The
extracted package starts with only an incompatible Node shim on the fixture
PATH and no local Node cache. After `CONNECT`, it downloads the official
[Node.js portable ZIP](https://nodejs.org/dist/v22.23.4/SHASUMS256.txt),
checks the ZIP and Node binary against the official SHA-256 values, and
uses that exact binary for the provider and installer status. The verified
official tunnel client completes correlated MCP write, read and
`start_process` calls against the loopback-only simulated control plane.
The PowerShell output contains a marker that does not appear verbatim in the
command. A deliberately stale `npm_execpath` does not override npm bundled
with the portable runtime. Pause stops the provider, and retry does not
resume polling. A synthetic key and offline npm cache are used,
with no Chrome native registration or real ChatGPT grant. This variant
passed locally and is now enabled in the Windows CI workflow; no remote
CI run is claimed here.

The same cold CMD fixture now closes the owner after a manual pause, then
switches PATH to a different compatible Node. An explicit incompatible
`-NodePath` is refused before spawn. Default start also refuses with the
portable archive absent and does not download it. With the cache restored,
the Windows wrapper recognizes the exact pre-spawn profile refusal and
starts one owner using the original verified portable runtime. The original
profile, binding, pause intent and installer operation receipt remain byte
identical, and no poll occurs while paused. Explicit reconnect starts the
official client and provider under the bound runtime; a second manual pause
stops them. This verifies application-level restart under PATH drift, not an
operating-system reboot, unattended login startup, or a hosted chat grant.

On 2026-11-05, the three Windows x64 ConPTY cases passed again: guided
PowerShell with pairing, guided CMD with a cold portable Node download and
restart under PATH drift, and guided PowerShell with the unpacked Windows
device preview loaded in isolated Chromium. The last case now builds
`scripts/package.py --windows-preview`, reads `AgentContinue/manifest.json`
from that archive, and confirms the package has no pinned development key
before adding a fixture key. It verifies local signed status, pause,
reconnect, and that the browser does not restore pairing on reload. The setup bundle is separate
from the extension archive. No production install, native registration,
real hosted chat grant, npm publication, or Store submission occurred.

The reviewed ZIP pair was regenerated after unifying the browser and CLI
guided commands, removing mutable remote shell suggestions, and making
identical staged setup payloads produce byte-identical archives. One cold
CMD run had previously reached pause but retained the controller and IPC
leases after the fixture owner exited. A focused test reproduced the loss
of an already-confirmed exit when a later process query failed. Exit
confirmation is now kept only for the captured run; an unconfirmed or new
run cannot use it. The subsequent three-case x64 loopback matrix passed,
including clean shutdown; the isolated local suite does not establish
real ChatGPT or Dot authorization.

The Windows extension panel now retains a pending operation's random ID
in browser session memory before dispatch. A same-profile re-pair sends a
read-only status for that exact ID, not a second mutation. The Chromium test
reproduces a lost result, re-pairs on a fresh loopback listener, verifies
that generic and busy status keep the slot, and unlocks only on a matching
terminal receipt. The test also verifies simultaneous tabs do not queue
another mutation and that a malformed session record disables mutations.
Neither the pairing address nor code is stored. This does not survive a
browser restart or extension reload; use the original device's read-only
operation status as needed. The packaged x64 Chromium mock roundtrip passed.

The final one-download Windows preview kit was also verified and extracted
by the x64 Chromium fixture. The fixture hashes the exact supplied ZIP,
validates its internal checksums, and uses the two directories from that
copy for the guided install and browser controls. It adds a test-only key
to the extracted manifest, never to the kit. The local official-client
loopback run passed; no hosted acceptance or remote CI artifact was observed.

The current guided preview no longer asks for a setup JSON. The terminal
displays the extension ID, accepts the tunnel ID and masked key-file path,
and waits for `CONNECT`. PowerShell and cold CMD ran without a request file;
the setup receipt's extension ID and request digest matched the canonical
browser-generated request. The same combined kit passed the isolated Chromium
pairing, pause and reconnect fixture. Advanced commands and the maintainer
hosted acceptance launcher still support the file-backed request.

The packaged pairing flow now prints one `ACPAIR1` ticket in the interactive
terminal. The machine receipt remains a token-free loopback URL and lifetime.
The Windows x64 ConPTY-to-Chromium fixture passed using the exact ticket from
the console, then observed pause and reconnect through signed loopback calls.
The extension fixture also rejected malformed tickets before navigation and
recovered a pending operation by status, without sending a second mutation.
These are local transport results, not hosted ChatGPT or Dot authorization.

A separate `AgentContinue Windows Acceptance` tunnel was created in the
personal Platform organization with the corresponding ChatGPT workspace
association. Existing tunnels and plugins were not changed. The restricted
one-day runtime-key form was prepared but not submitted. This is a private
test target, not a public ChatGPT plugin or an acceptance result.
ChatGPT's custom MCP dialog lists the test tunnel under the expected account.
The matching name and tunnel were selected in the unsaved form; no plugin
was created and no conversation was granted access.

### Reproducible Windows launch

Use the maintainer-only `scripts/Invoke-WindowsHostedAcceptance.ps1` with the
same reviewed Windows preview kit users receive, its independently recorded SHA-256, the
dedicated acceptance tunnel ID, and the ID of the extension actually under
test. This is not a replacement for the extension's onboarding command.
The default plan does not extract, install, open the runtime key, contact the
tunnel, or create a run directory. It reports `archiveLayout` and the digest
of the entire archive. Load the extension from the same verified ZIP before
providing its Chrome ID; the launcher cannot infer which extension Chrome loaded.

```powershell
$run = @{
    Archive = '<absolute path to the reviewed agent-continue-windows-preview-kit.zip>'
    ExpectedSha256 = '<independently recorded ZIP SHA-256>'
    TunnelId = '<dedicated acceptance tunnel ID>'
    ExtensionId = '<ID of the exact Chrome extension under test>'
    RunId = 'windows-pilot'
}
& .\scripts\Invoke-WindowsHostedAcceptance.ps1 @run
```

The default key file is
`%LOCALAPPDATA%\AgentContinue-Acceptance-RuntimeKey.txt`. An owner may also
explicitly supply `-RuntimeKeyFile` with the path to an existing key that is
authorized for the dedicated acceptance tunnel. Use a separate tunnel from
production. Never enter the literal key on the command line or save it in the
repository. Readiness means metadata is present, not that OpenAI accepted the key.
Once the plan is ready, authorize this specific test:

```powershell
& .\scripts\Invoke-WindowsHostedAcceptance.ps1 @run -Action Start -Consent accept-private-hosted-test
```

The launcher holds the reviewed archive open from hash verification through
extraction, stages only the kit's `WindowsSetup/` subtree, and leaves the
extension and guide untouched. A standalone `agent-continue-setup.zip`
remains accepted for diagnostics, but it cannot establish that the combined
kit was used. The launcher stages one run under
`%LOCALAPPDATA%\AgentContinueHostedAcceptance\run-<RunId>`, and uses the
shipped command installer with a fresh manager directory. A second invocation
with the same run ID cannot reinstall or reconnect, even after a partial start.
The sanitized `receipt.json` and original manager directory are the recovery
references. After a lost or ambiguous result, use the extracted `install.ps1
-DeviceAction installer-status -InstallDir <runRoot>\manager` before
considering any new run. After both surface tests, explicitly pause this test
manager using that same extracted installer and root, and read back its status.

Local Windows PowerShell fixtures verify no install writes in Plan or refused
Start, exact request and installer bindings, no repeat start, a sanitized
settled receipt, and retention of an unconfirmed operation ID without copying
or echoing the synthetic key. Plan also verified the current real command
ZIP's hash without creating a directory; the dedicated runtime key was
absent. The Windows CI step is configured but not yet observed remotely.

[Chrome's native messaging rules](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging#native-messaging-host-location)
require a separately registered host on Windows before Chrome can launch it.
This command-only path deliberately does not register a host. The extension
guides initial setup and uses authenticated loopback controls after a user
starts the installer; it cannot launch the first PowerShell command by itself
on a clean device.

### Verify both ChatGPT surfaces

The bilingual Setup guide now links directly to the official ChatGPT Plugins
page and lists separate device, workspace-plugin, and conversation checks.
The Windows Devices guide leads to command-only setup and temporary pairing;
it does not require native messaging. The guide does not open links on its
own, store a key, send a prompt, grant permissions, or infer hosted success
from local readiness. An absent Dot plugin is an unverified surface, not
an instruction to reinstall the Windows device.

1. Save the new restricted runtime key outside the repository on the Windows
   host. Keep the literal secret out of chat, logs, screenshots and arguments;
   pass only the file path. Use a new installation directory and the exact
   acceptance tunnel ID. Do not use any key from a production device.
2. Run the command package, record the local start receipt and confirm the
   official client is ready and polling. A ready receipt does not certify
   ChatGPT tool access. Follow the [official tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
   to bind a private custom MCP server in the matching workspace.
   If the installer response was lost, use `install.ps1 -DeviceAction
   installer-status -InstallDir <original-root>` to read the saved operation.
   This does not restart or reconnect the device.
3. In the source checkout, run `node scripts/hosted-read-acceptance.mjs prepare`
   once. It creates distinct disposable local files for ordinary ChatGPT and
   Dot; the two prompts contain file paths but no expected contents. Use a new
   chat on each surface and the named private test app. Approve only the
   intended `read_file` call. Do not paste the expected marker, tool grants,
   runtime key, or unrelated files into the chat.
4. Check the actual tool record (the named app, `read_file` and that surface's
   exact file path) and compare its returned text using
   `node scripts/hosted-read-acceptance.mjs compare <runDir> <chatgpt|dot>`
   with the tool result on standard input. The comparison verifies marker
   bytes only. A model reply, a matching marker without an observable call,
   and success on just one surface are not end-to-end acceptance. Record each
   surface separately. Pause the test owner afterwards and verify status.

## Signing eligibility and Microsoft readback (November 5, Chicago)

In-app browser readback of the existing Microsoft submission again showed
overall `In progress`, whole-EXE determination `Pending`, and no current
Cloud/Client detection. The analyst comment still describes intended closure,
not a final determination. Do not resubmit the same sample or transmit
diagnostic logs merely because the conditional directions appear on the page.

[SignPath Foundation's terms](https://signpath.org/terms) require a released
artifact in the form to be signed, verifiable build provenance, and
uninstallation instructions or facilities. The
[application](https://signpath.org/apply) asks for project reputation evidence
and agreement to its conduct rules. The currently visible
[stable GitHub release](https://github.com/1235357/agent-continue/releases/tag/v2.2.0)
explicitly excludes the native candidate; the November 3 pre-release is a
source handoff. Neither is evidence of a released Windows launcher. No
application or data was sent, no signing provider was claimed, and no
unsigned executable was published to satisfy eligibility. Do not pin a
publisher until a real signing identity and a valid signed artifact exist.

## Microsoft analyst update (November 4, 23:19 Chicago)

A normal reload of the same submission returned new analyst comments: the
submitted sample had no scanner-positive result and no telemetry indicators,
and Microsoft intended to close the case without further action. The page
still showed overall `In progress` and the complete EXE's final determination
as `Pending`; current Cloud/Client detection text was `No malware detected`
with client definition `1.463.132.0`. Extracted entries had mixed `Pending` and
`Not malware` determinations. Do not collapse those fields into a final EXE
clearance or treat the page's generic protection-icon labels as detections.

This changes the prior pending-only checkpoint, not the submitted bytes or the
project's signing status. No Rescan was requested, no new sample was uploaded,
and no diagnostic CAB was collected or transmitted. The analyst's conditional
diagnostic instructions are not permission or a reason to reproduce an old
detection by executing a quarantined build. The local audit directory now also
contains `microsoft-analyst-update.jpg` and `microsoft-analyst-update.json`.
The portal still did not expose a remote sample hash in the inspected view.
No native executable or production service was started for this observation.

## Microsoft developer submission (November 4, 22:37 Chicago checkpoint)

The owner explicitly approved the scoped Microsoft-Corporation GitHub login,
the current verification step, and submission of the one reviewed executable.
Microsoft Security Intelligence returned an actual submission receipt:

- Submission: `69df7c33-0f86-475c-a549-232aeba1eb56`.
- [Submission details](https://www.microsoft.com/en-us/wdsi/submission/69df7c33-0f86-475c-a549-232aeba1eb56).
- Portal submission time: `Nov 4, 2026 10:36:02 PM`; status `Submitted`.
- Final determination and current Cloud/Client detections were `Pending`;
  no analyst comments were present. Do not submit the same case again.

One independently reviewed maintainer compile produced
`native-launcher-unsigned.exe`, 23,552 bytes, product `Agent Continue`, file
version `0.3.0.0`, Authenticode `NotSigned`, local SHA-256
`5d055415dcefe59e37f57952bd447807a934d171cb8662b692d9d9cde0782734`.
The executable was not run, installed, registered or signed. The build receipt
reported 17 runtime pins and completed temporary cleanup. A targeted Defender
scan recorded matching start/end events for scan
`18C04616-FF96-4461-91DD-680FE50E7BDB`; no fresh detection was observed in that
bounded check. This is not an analyst determination, an old-detection false
positive finding, or a safety guarantee.

Only that EXE and its reviewed developer statement were submitted. No runtime
keys, credentials, chat content, device logs or complete project directory were
uploaded. The statement explicitly distinguishes this new hash, which was not
claimed detected, from historical detections of different development builds.
The closest available benign/incorrect-detection category was used with that
disclosure. The portal displayed a default removal date of November 4, 2031.
The receipt confirms the case and filename; a remote sample hash was not exposed
at this checkpoint, so server-side byte/hash equality remains unverified.

Local evidence is retained under the ignored
`.artifacts/windows-security-review-9b7fc877b0344a2aa91286ffffe7a332/` directory:
`microsoft-submitted.jpg`, `microsoft-submission-receipt.json` and
`submitted-developer-statement.txt`. The earlier `review-evidence.json` is a
pre-submission snapshot and intentionally still records
`submittedToMicrosoft: false`; the separate receipt supersedes that status.
Audit artifacts are not public release assets. No certificate was obtained or
enrolled, no SignPath application was submitted, and the publisher list remains
empty. Native installation, Chrome messaging, authenticated tunnel and ordinary
ChatGPT/Dot acceptance are still outstanding. Production VPN/MCP/research
processes and endpoint protection were not changed.

Post-recording verification: `node --test tests/windows-signing-tests.mjs`
passed 6/6 on Windows with no skips; these are source, read-only plan, parser,
cleanup and refusal checks, not launcher execution or signing success.
The separate submission receipt's local hash matched the retained EXE, the
pre-submission JSON remained unchanged, `.artifacts/` was confirmed ignored,
and `git diff --check` exited zero (line-ending warnings only).

## Windows release security and signing (November 4 correction)

The owner explicitly authorized legitimate signing and remediation research.
Read-only certificate inspection found no code-signing certificate with a private
key in CurrentUser/My or LocalMachine/My. The installed Node binary has a valid
OpenJS Foundation signature; that is not our signing certificate or a private key
we can reuse. Historical Defender records for IDs 251873 and 2147940952 remain
present with successful actions; they do not prove a current false positive.

Two earlier claims were incorrect: Chrome does not universally require a PE
native host, and signing is not the only possible path to a Defender resolution.
The [Chrome documentation](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
requires a registered native component and explicit extension origins. Current
[Chromium Windows source](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/extensions/api/messaging/launch_context_win.cc)
retains direct EXE and non-EXE-through-CMD branches (observed blob
`bde1be53e4cc246c55c7a036ad6c84edb520fe0a`). A Node execFile test cannot
establish browser behavior. We did not build or execute another wrapper to evade
the detection and did not change endpoint protection or trust stores.

Maintainer tool: `scripts/Sign-WindowsRelease.ps1` defaults to a read-only plan:

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -File .\scripts\Sign-WindowsRelease.ps1 -FilePath "C:\release\native-launcher.exe" -ExpectedSha256 "REVIEWED_64_LOWERCASE_HEX_SHA256"
```

Explicit signing also requires `-Sign -Consent accept-sign -OutputPath` (a new
file), an existing CurrentUser code-signing `-CertificateThumbprint`, and the
issuer's `-TimestampServer`. The source is retained open read-only and never
signed in place. A signed-copy receipt requires a locally valid Authenticode
readback, matching signer and timestamp. The tool does not build, execute or
register artifacts, create certificates, install trust roots, export keys, or
change security settings. Private certificate material must never be committed.
Use a maintainer-owned release directory without untrusted concurrent writers;
pathname checks are not a defense against a compromised same-user maintainer.
If signing fails after output creation, retain the output for diagnosis, do not
release it. `classificationVerified` and `runtimeVerified` always remain false.

Actual PS5.1 tests covered plan, consent/certificate/hash refusal, no output and
unchanged source. A plan on the already-installed signed Node binary reported
localSignatureValid=true, artifactChanged=false. No project binary was signed;
successful signing/timestamping and signature portability remain unverified.
The OS Security module is imported from PSHOME explicitly so a Node parent's
PSModulePath cannot break its discovery. The script is maintainer tooling, not
part of the user npm payload or an additional onboarding step.

Legitimate channels reviewed in the in-app browser:

- [Microsoft developer submissions](https://learn.microsoft.com/en-us/defender-xdr/submission-guide):
  submit as software developer and wait for a determination. The initial
  source-only checkpoint uploaded no sample; the later one-EXE submission above
  supersedes that status. Source, device logs and quarantined files were not
  uploaded. Submission is not approval.
- [Microsoft Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart):
  requires Azure resources and identity validation; individual public-trust
  eligibility includes US/Canada location and matching individual billing/ID.
  No billing resource or identity request was created, and no eligibility was
  assumed from being a student in the US.
- [SignPath Foundation](https://signpath.org/terms): a free OSS avenue, subject to
  release/reputation review, uninstall documentation, code/build provenance,
  signing roles/MFA and approval. No application or terms were submitted; do not
  add a "provided by SignPath" badge before acceptance. Its certificate is not
  ours to re-sign upstream binaries with.
- [Authenticode cmdlet](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/set-authenticodesignature?view=powershell-5.1):
  certificate, SHA-256 and timestamping are explicit. A local valid signature is
  not a malware determination or proof that other users trust the certificate.

Distribution architecture remains unfinished. InstallLocal now delegates native
preparation to a signed-vendor-release consumer, not the old per-install compiler.
The maintainer source candidate and installer contract are:

- `native/bootstrap/ReleaseLauncherBinding.cs` uses the existing transport with
  fixed install-relative `runtime/node.exe` and `app/device-native-host.mjs`,
  the existing four-field binding, five-field manifest and exactly one origin.
  Framework bounded JSON parsing rejects duplicate/unknown binding fields.
  The reader now selects strict UTF-8 explicitly; the no-encoding overload would
  auto-detect UTF-16 and disagree with the Node binding consumer. An actual
  PS5.1/framework fixture accepts non-ASCII UTF-8 and rejects UTF-16 LE/BE and
  malformed UTF-8. This fixture does not compile or run the launcher.
  It retains read handles for Node, 17 release-pinned runtime files and local
  identity records; neither PATH nor browser arguments select programs/scripts.
- `scripts/Build-ReleaseNativeLauncher.ps1` defaults to a read-only plan verifying
  source hashes, Node's operator-specified SHA-256 and payload manifest. Explicit
  compile requires `accept-build` and creates one unsigned release executable,
  without per-install paths/identity or a manifest. No compiler was invoked in
  the earlier source-only checkpoint. Do not execute or deploy while the detection
  gate is unresolved. A separately reviewed, one-time maintainer compile may
  produce an unsigned artifact solely for legitimate issuer/Microsoft review.
  It must not become an installation workaround: if protection blocks it, stop,
  retain the refusal evidence, and do not restore, exempt, rename or rebuild to
  avoid detection. Compilation alone is not classification or runtime acceptance.
- The builder rejects non-fixed output drives before compilation and emits its
  only JSON receipt after all temporary cleanup attempts. Cleanup failure is
  `release_launcher_cleanup_failed`, not a preceding success plus error exit.
  Tests use an inert locked text file and an injected read-only-plan cleanup
  failure, not a generated binary or the signing service.
- Signing/parser/cleanup tests now pass 6/6: source assertions, actual PS5.1 release
  plan, framework parser, cleanup failures and signing plan/refusals. They do not prove C# compilation,
  path-race resistance, signature/timestamp success, real Chrome or MCP use.

Do not ship a signing key or require users to get certificates. The reusable
candidate now has one unsigned review build, but is not signed or deployed.
The source installation path now
selects the matching release and fixed Node before registration, but real signed
artifact preparation and rollback behavior still need acceptance.
Pins currently cover the wrapper payload, not all provider node_modules. Parent
directory race/ACL hardening and framework/parser/binary-IPC compatibility still
need executable acceptance. Do not claim protection from a compromised same-user
maintainer or administrator.

### Vendor-release installer contract

`Prepare-ReleaseNative.ps1` is the user-package consumer, not a compiler or
signing-key holder. Its release files are fixed at
`native-release/<x64|arm64>/release.json` and `native-launcher.exe`. The compact
UTF-8 policy has exactly these fields: format, version, releaseVersion, arch,
nodeVersion, nodeSha256, launcherSha256, signerThumbprint and
payloadManifestSha256. The format is `agent-continue-windows-native-release`,
version is 1, Node is pinned to 22.23.4, and hashes bind the exact 17-file wrapper
payload manifest. Policy bytes come from the maintainer's reviewed package;
an adjacent editable JSON file alone is not an independent trust anchor.

The separate native-publishers.json has exactly format/version/thumbprints and
canonical UTF-8/LF bytes. The preparer reads only its own adjacent file and pins
its SHA-256 as a code literal; there is no command-line or environment override.
Candidate signerThumbprint must be in that reviewed source list before launcher
acceptance. The current list is empty, intentionally: no project certificate or
Foundation acceptance exists. A source maintainer must enroll an actual reviewed
publisher and update the corresponding code pin before preparing a signed release.
This does not protect against a compromised maintainer or an edited whole package.

Source packaging snapshots only those two files for supported architectures,
rejects stale payload/binary hashes, unexpected files, duplicate policy fields
and linked release files. Its default trusted publisher policy must also match
the fixed digest in the packager, even if release assets are absent. This is
separate from the preparer's matching digest and prevents a substituted source
policy from producing an unusable package. Packaging does not run the binary or verify its
Authenticode signature. The Windows preparer performs that independent local
signature/pinned-signer/product/version check before creating native outputs.
The local signature check also requires a timestamp certificate. Pure package
fixtures with inert bytes and a test publisher list do not exercise this check.
The production package builder has no candidate-controlled publisher override.
An unrelated signed Node executable is not an Agent Continue launcher.

InstallLocal's preflight precedes Node download and provider/state creation.
Missing releases produce `native_release_unavailable` without a compiler fallback.
With a reviewed release, the installer selects the release-pinned Node, creates
private `runtime/node.exe`, then uses it for registration and owner startup.
The npm CLI no longer forces its current Node executable as that pinned runtime.
Existing destinations and partial native outputs remain refusal conditions.
No signature service, endpoint determination, actual signed vendor artifact,
installation, native registration or real ChatGPT/Dot call is implied by this
source wiring. The legacy builder remains source tooling, not an install fallback.
Both the old builder and NativeLauncher.cs are excluded from user npm/ZIP payloads.

Root npm includes packaged-native-release, generated only by copying the completed
validated build stage, not the original mutable native-release input directory.
Source ZIP still archives its private stage. Unexpected/stale generated contents
stop packaging without cleanup or silent reuse. The installer uses the fixed
packaged entry if present, even if invalid, and otherwise the source/ZIP entry;
it does not accept a release-path override. Snapshot tests use inert files, not
signed executables. Maintainer-owned generated outputs can still be modified by
the same user after prepack; this is not an atomic authenticated tarball builder
or a defense against a compromised build host.

Windows setup profiles use strict v2 bindings with hostRuntime=install-private
and the fixed INSTALL/runtime/node.exe path. The layout is checked against the
installed app/host and state directories; callers cannot supply an arbitrary
replacement interpreter through this flag. The external bootstrap interpreter
and subsequent private owner therefore regenerate equal profile bytes. Legacy
v1 semantics remain unchanged. A real setup fixture plus an inert private-node
file verified this transition; it did not execute a private runtime or authenticate
a tunnel. Profile byte stability is not proof of connected ChatGPT/Dot tools.

## Extracted installer and startup correction (November 4)

The setup ZIP now embeds its payload-only SHA256SUMS.txt. Previously the extracted
installer returned payloadChecked=0 because only the external release list
existed. The external list additionally checks the ZIP; neither list hashes
itself. Actual PS5.1 extracted-package planning checks all 41 payload files,
creates no install directory and rejects a modified runtime payload. It imports
the OS Utility/Archive modules explicitly from PSHOME so inherited PS7 module
search paths do not break hash checking or extraction. These are integrity
checks against the included list, not an independent publisher signature.

Manager startup observations now pass the remaining 10-second budget into a
whole-IPC deadline, spanning connection, challenge, write and reply. The deadline
does not restart for each frame. Expiry closes only the caller socket; it does
not delete channel records, terminate an owner or replay a command. A silent
test endpoint verifies bounded exit, retained metadata and a still-listening
server. A genuine spawned fixture owner verifies deadline propagation, reuse,
explicit synthetic readiness and unknown-pause refusal. The explicit reconnect
operation retains its existing separate behavior; this is not a 10-second
guarantee for downloads, provider verification or authenticated tunnel startup.
All fixture processes are test-owned. No production manager, VPN, IDE, research
task, registry entry or user tunnel was started/stopped by these checks.

## Upstream review, 2026-11-04

The current upstream README was inspected in the in-app browser:
https://github.com/openai/tunnel-client . This review is not device acceptance.

- macOS installation must use the supported official Homebrew tap. Downloaded ZIPs
  are not currently notarized; do not suggest Gatekeeper bypasses as onboarding.
- The full client offers `runtimes connect/status/stop` and profile management.
  Evaluate reusing those before adding another supervisor. Our pinned runtime-only
  artifact exposes `run`, not those management commands; do not switch blindly.
- Stdio requires one active runtime per tunnel ID, including maintenance windows.
- Readiness is distinct from ChatGPT discovery and an actual authorized tool call.
  Interrupted calls must not be silently replayed.
- Fresh upstream features are not proof they exist in our pinned release. Verify
  exact-version binary help and behavior before changing flags or lifecycle policy.

Prepared 2026-11-04. The numbered manual/native pre-check below is still an
unexecuted acceptance plan. The earlier sections separately record actual
isolated fixture tests, including owned process startup and read-only package
status checks; they do not establish this installed-browser acceptance. No
production owner or registry value was changed. A "pass" below becomes evidence
only after its exact listed observation exists.

Scope: one local Windows bridge handshake, one request frame, one reply frame.
Out of scope: Chrome launch, OS registration, protected installation, official
tunnel, MCP tool calls, chat authorization, Linux/macOS wrappers, SSH routing.

## 1. Preconditions in the installed layout

| Path | Expected |
| --- | --- |
| `INSTALL/app/device-native-host.mjs` | host script; reads the binding from its own directory |
| `INSTALL/app/device-native-binding.json` | private create-only record, canonical `JSON.stringify(value)+'\n'`, ≤16384 bytes, one link, no symlink, exactly `format`/`version`/`extensionId`/`stateRoot`; `format:"agent-continue-native-binding"`, `version:1`, `extensionId` matches `^[a-p]{32}$`, `stateRoot` absolute and private |
| `INSTALL/state` | private state root; must be the same resolved directory the binding names |
| `INSTALL/state/device-channel.json` | exists only while an owner runs; exactly `format`/`version`/`extensionId`/`endpoint`/`secret`; `endpoint` on Windows is `\\.\pipe\agentcontinue-device-<32 hex>`; `secret` is 64 lowercase hex |
| `INSTALL/state/device-operations.jsonl` | created by the owner at start (header line) and retained after close; a mutating action appends rows |
| `INSTALL/state/device-operations.lease` | created by the owner at start, removed on clean close |
| `INSTALL/native-launcher.exe`, `INSTALL/native-host.json` | optional compiled launcher and the five-field manifest; not required for a manual host run |

Manifest contents, when present: exactly `name`/`description`/`path`/`type`/`allowed_origins`
with `name:"com.agentcontinue.device_control"`, `description:"Agent Continue device lifecycle bridge"`,
`path` = absolute launcher path, `type:"stdio"`, `allowed_origins:["chrome-extension://<id>/"]`.
Registration, if it ever exists, stores the manifest path as a `REG_SZ` default value under
`HKCU|HKLM\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control`,
32-bit view first, then 64-bit. Registration affects discovery only; it is not required
for the manual run below and absence of that key is the expected pre-registration state.

## 2. Exact launch shape

Two processes are involved. The owner must already be running; the host never starts one.

Owner, foreground, zero extra arguments (the binding is resolved beside the script, not
from the current directory):

```text
node device-owner.mjs
```

- Any extra argument fails with `invalid_device_owner_arguments`; a missing/invalid
  binding or state root fails with `device_owner_unavailable`; both exit 1.
- On success it holds the channel file and the operation lease until `SIGTERM`/`SIGINT`,
  then closes cleanly. Setup never starts it; starting it is always an explicit step.

Host, as Chrome would spawn it (Windows):

```text
node device-native-host.mjs chrome-extension://<id>/ [--parent-window=<1-20 digits>]
```

Host, non-Windows: one argument only.

Argument rule enforced before any read:

- exactly one argument, the binding origin, or
- on Windows only, exactly two arguments where the second matches `^--parent-window=\d{1,20}$`
  (that value is not forwarded anywhere and has no other range check).

Anything else — missing origin, trailing-slash removed, uppercase, a different extension
id, a second argument on non-Windows, `--parent-window=` empty or non-ASCII digits,
21 digits, or a third argument — raises `invalid_device_origin`, prints
`device_bridge_unavailable` to stderr and exits 1.

Lifecycle: read exactly one frame from stdin, optionally route it, re-check the binding,
write exactly one frame to stdout, destroy stdin in `finally`, exit. There is no loop,
no resident process, no service, no login hook and no registry access in the host.
Exit code 0 means one reply frame was written; exit code 1 means the single sanitized
token above was printed and stdout stayed empty.

## 3. Origin expectation

The accepted origin is derived from the binding, not from the argument list:
`'chrome-extension://' + binding.extensionId + '/'`, with the mandatory trailing slash.
The host compares `args[0]` byte-for-byte with that value, so any drift fails before the
frame is read. The owner repeats the check on the frame's `origin` field and fails the
socket with `invalid_device_authentication`.

Failure comparison for `device_bridge_unavailable` (exit 1, stderr, empty stdout):

| Cause | Host-visible result | Distinguishable from stderr? |
| --- | --- | --- |
| wrong origin or argument count | same token | no |
| binding missing, non-canonical, changed, symlinked or redirected | same token | no |
| owner not running / channel file absent or stale | same token | no |
| challenge malformed, nonce not 64 hex, or socket error | same token | no |
| request MAC wrong or response MAC wrong | same token | no |
| frame over 4096 bytes, truncated length, non-JSON, or 15 s timeout | same token | no |
| unsupported (non-little-endian) platform | same token | no |

The token is deliberately one code for every internal failure, so it never distinguishes
a stage. Only the frame evidence in §5 distinguishes "launched but not handshaken" from
"handshaken".

## 4. Frame format and bounds

- 4-byte unsigned little-endian length prefix, then a UTF-8 JSON body; no trailing newline.
- Body length 1–4096 bytes; buffered stdin may not exceed 4100 bytes; the total read must
  equal length + 4 exactly. Reply frames obey the same 4096-byte cap.
- Host stdin deadline: 15 s. Host socket deadline for challenge and for reply: 15 s.
  Owner socket deadline for the request: 5 s.
- Host refuses to run on a big-endian platform (`unsupported_device_byte_order`).

## 5. Single-frame sequence (version 1, local path)

F1, owner → host, challenge — 2 keys exact, no MAC:

```json
{"version":1,"nonce":"<64 lowercase hex>"}
```

F2, host → owner, request — 4 keys exact:

```json
{"version":1,"origin":"chrome-extension://<id>/","request":{"version":1,"id":"<id>","action":"<action>"},"mac":"<64 hex>"}
```

- `id` matches `^[a-zA-Z0-9_-]{1,64}$`; `action` is one of
  `status`, `reconnect`, `disconnect-and-pause`.
- Request MAC domain: `device-request-v1`; input is
  `JSON.stringify(['device-request-v1', nonce, origin, request])`, HMAC-SHA256 keyed by
  the channel `secret` bytes, encoded as 64 hex.

F3, owner → host, reply — 3 keys exact:

```json
{"version":1,"response":{...},"mac":"<64 hex>"}
```

- Reply MAC domain: `device-response-v1`; input is
  `JSON.stringify(['device-response-v1', nonce, origin, request, response])`.
- `response` is exactly `version`/`id`/`action`/`ok`, echoing the request id and action.
  With `ok:true` it also carries `state` with exactly `paused`/`connection` (plus
  `operation` when the action is not `status`); `paused` is boolean or null; `connection`
  is `ready|disconnected|unknown`; `operation.status` is
  `in-progress|unknown-running|settled|not-executed|unknown`.
- The host then calls `binding.assertCurrent()` and writes only the inner `response`
  object to stdout (exactly `version`/`id`/`action`/`ok`, plus `state` when `ok`), then
  exits. The F3 wrapper and its `mac` never reach stdout: the nonce stays inside the
  owner↔host exchange, so an outside observer cannot recompute the reply MAC from the
  host output alone. `runtime-acceptance.mjs` therefore reads the challenge directly
  from the owner on the same channel and recomputes both MACs there.

Version 2 requests take a different route: `{version:2,target,id,action}` plus
`device-ssh-targets.json` (verified `known_hosts` digest, absolute executable, remote
`node`/`entry`/`stateRoot`). They are excluded from this local acceptance: without that
file the host fails with the same token.

Use `action:"status"` for the smoke probe. It reads observed state and does not append
to the operation journal; `reconnect` and `disconnect-and-pause` both mutate durable
state and must not be used to test a bridge.

## 6. Objective pass/fail criteria

Handshake pass (all required):

1. Host exit code 0, stderr empty.
2. stdout contains exactly one complete frame: prefix equals body length, total ≤4100,
   body ≤4096, strict JSON, `version:1`, `id` and `action` equal the sent request.
3. A direct owner probe on the same channel reads F1, and both the request MAC
   (`device-request-v1`) and the reply MAC (`device-response-v1`) recompute to the byte;
   the host's stdout carries no `mac`, because the nonce never leaves owner↔host.
4. `device-channel.json` bytes and identity are unchanged across the run and the binding
   file hash is unchanged (the host writes neither).
5. The owner still holds the lease and exits cleanly on signal afterwards.

`ok:false` with a valid MAC is a completed handshake with a rejected action; it proves
authentication and routing but not the requested effect. Record it separately.

Started but not handshaken:

- exit 1 with `device_bridge_unavailable`: Node started and the script parsed, but the
  binding, channel, challenge, authentication or framing failed. This is not acceptance
  and not a diagnosis; stderr cannot tell the stages apart.
- exit 0 with any other stdout shape: framing/echo failure; treat as fail.

Not launched: no process, or a non-Node error (missing binary, permission denied).
Distinguish these only with the read-only pre-checks in §7.

## 7. Showing that nothing was installed

1. Registry, read-only. Query both views before and after; expected result is
   "not found" unless an earlier approved registration exists, and this increment writes
   nothing either way.
2. Install directory: file names, lengths and SHA-256 hashes before/after must be identical.
3. State directory: the only permitted delta is the transient channel file while the owner
   runs, the lease file while it runs, and the owner-created journal whose content is only
   its header unless a mutating action ran. Any other new file is a failure.
4. Processes: after both exit, no `node.exe` whose command line contains
   `device-native-host` or `device-owner`; the channel file is gone.
5. Static evidence: the host source imports only its local modules and has no
   `child_process`, registry, service or `require` reference; the sanitized token contains
   no path, id or key material.

## 8. Copy-paste read-only inspection commands (no side effects)

Set the install root once. Replace the placeholder with the real absolute path; the
commands only read files, read the registry and list processes. Both packages
(`native/bootstrap`, `native/desktop-commander`) declare Node >=22.12.0, so check the
version first:

```powershell
$Install = '<absolute INSTALL directory>'
node -v
Get-ChildItem -LiteralPath "$Install\app" | Select-Object Name,Length
Get-FileHash -LiteralPath "$Install\app\device-native-binding.json" -Algorithm SHA256
$b = Get-Content -LiteralPath "$Install\app\device-native-binding.json" -Raw | ConvertFrom-Json
$b.PSObject.Properties.Name
$b.format; $b.version; $b.extensionId
Get-ChildItem -LiteralPath "$Install\state" -Force | Select-Object Name,Length
Test-Path -LiteralPath "$Install\state\device-channel.json"
reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control" /ve /reg:32
reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control" /ve /reg:64
reg query "HKLM\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control" /ve /reg:32
reg query "HKLM\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control" /ve /reg:64
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'device-native-host|device-owner' } |
  Select-Object ProcessId,CommandLine
```

These are safe to run manually: `Get-*`, `Test-Path` and `reg query` do not write,
do not start processes and do not alter the binding, channel or journal. `node -v` is
the only spawned process and prints its version. No `reg add`, no `Start-Process`, no
host launch is part of this list; the launch in §2 belongs to the next executable step.

An absent registry key makes `reg query` print an error and return non-zero. That is the
expected pre-registration result, not a registry fault.

## 9. Explicit non-claims

- §1–§8 are a checklist, not acceptance. The only executed handshake evidence is the
  temp-only probe in §10; `--precheck` is read-only layout/registry evidence and proves
  neither registration nor a tunnel.
- A manual host handshake would not prove Chrome registration, installation, tunnel
  readiness, MCP tool authorization or chat authorization.
- `device_bridge_unavailable` is one sanitized failure token for many internal causes.
- Windows evidence here is not Linux/macOS evidence; SSH routing and login recovery
  remain separate unimplemented requirements.

## 10. Implemented probe and next action

`native/desktop-commander/runtime-acceptance.mjs` implements §2–§6 without any registry
write: a temp directory with a byte-identical copy of the runtime sources, a temp
binding and state root, a real owner started through a temp entry, one `status` frame
from the real host, the three refusal cases, unchanged channel/binding evidence, a
clean owner close and default temp cleanup. Run it from the module directory:

```text
node runtime-acceptance.mjs [--keep] [--resume]
```

A pass prints `RESULT pass=<n> fail=0` and exits 0, plus `host_status_reply=<json>` so the
real controller's `paused`/`connection` receipt is visible. `--keep` retains the printed temp
directory for manual review; `--resume` writes `lifecycle.json` `paused:false` before the owner
starts, which proves the reply follows the real intent file instead of a constant (the default
intent is paused). The windows-only `--parent-window=...` argument is used on Windows and
omitted elsewhere.

The read-only pre-check is implemented in `native/desktop-commander/runtime-precheck.mjs`;
`node runtime-acceptance.mjs --precheck '<absolute INSTALL root>'` evaluates §1 and §8
one PASS/FAIL/SKIP line per check: install-root payload-manifest hashes (byte length and
sha256, default `<root>\payload-manifest.json`; a file path, never a directory), host/owner
`node --check`, canonical
binding, install state root, channel presence/shape, five-field manifest and the four
registry views. It writes, installs and starts nothing; a missing key is reported as
`PASS ... not registered (normal pre-registration state)`, never as a failure.

A `--precheck` pass is not registration, not a live tunnel and not chat authorization.
`native/bootstrap/bin.mjs status|verify --install-dir '<absolute INSTALL root>' [--json]`
now wraps the same pre-check through `native/bootstrap/registration-status.mjs`; `status`
prints a five-line summary and exits 0 even when nothing is registered, `verify` prints the
full checklist and exits 1 only on FAIL (SKIP is never a failure). Both are read-only.
`setup.js` now renders those five facts through
`native/bootstrap/registration-status-view.mjs`, showing an explicit unknown state when the
bridge is absent, fails, times out or returns a non-zero/malformed result.
The bootstrap tarball now carries `registration-guidance.mjs`, `registration-plan.mjs`,
`registration-render.mjs`, `registration-status.mjs`, `registration-status-view.mjs` and
`runtime-precheck.mjs`, and a packed test imports them from the installed tree.
The rehearsal checklist now exists as `docs/REGISTRATION-REHEARSAL.md` (document only; nothing
executed). Next unique action: wait for the owner's explicit authorization for a real write,
then exercise the `registration-execution` two-approval path with `execute: true`; no code
changes and no registry writes before that authorization.

## 11. Owned tunnel supervision (no credentials required to test)

`native/desktop-commander/lifecycle.mjs` now owns the tunnel child end to end:

- **Credentials** are resolved by `resolveTunnelLaunch(root, options)`. A local key-file
  binding (`tunnel.yaml` + `runtime.key`) wins; otherwise the current-user environment
  supplies `CONTROL_PLANE_TUNNEL_ID`, `CONTROL_PLANE_API_KEY` and the non-secret client path
  `AGENT_CONTINUE_TUNNEL_CLIENT`. The API key is passed to the child only as
  `--control-plane.api-key env:CONTROL_PLANE_API_KEY` plus that one child env entry. It is
  never persisted, never returned in a status receipt and never written to a log; nothing
  about it is echoed back (only `configured: true|false` and the source).
- **Missing or partial credentials** return `configured:false` with
  `tunnel_not_configured` / `tunnel_credentials_incomplete`; `reconnect` rejects with that
  code before writing intent, so a paused owner stays paused instead of pretending to be
  ready. `status` adds `configured:false` in that case.
- **Readiness** is real: the child receives `--health.url-file`; the owner polls that file,
  accepts only loopback `http(s)://127.0.0.1|localhost` addresses without credentials and
  requires `/readyz` HTTP 200. `ready` (and therefore `connection:"ready"`) is impossible
  without a successful probe.
- **Crash policy**: an exit after readiness restarts the child up to `maxRestarts`
  (default 2) with `restartBackoffMs` (default 200 ms) and records the count in `status`
  as `restarts`. A start that exits before readiness fails once with `tunnel_start_failed`
  and is not retried. A pause/stop/dispose increments the generation, so it can never
  leave a restart behind.
- **Clean stop**: `pause`/`dispose` send SIGTERM, confirm the captured child core exited
  (reused-PID safe) and report `runtime:"stopped"` with `ready:false`; the fixture test
  asserts exactly one child and no restart afterwards.

Stub-only verification (no network, no tunnel-client, no registry):

```text
node native/desktop-commander/tunnel-supervision.test.mjs   # 7/7 pass
node native/desktop-commander/lifecycle.test.mjs            # 33/33 pass
```

The stubs are real child processes started from `process.execPath` with a Node script: one
serves `/readyz` and writes the loopback health URL, one stays alive without ever becoming
ready, one exits before readiness, and one is killed externally to exercise the restart cap.

### Operator sequence when the real tunnel ID and key exist

1. Put the credentials in the environment of the process that Chrome launches (user-level
   environment variables, then restart Chrome), or keep using the local key-file path:

   ```powershell
   [Environment]::SetEnvironmentVariable('CONTROL_PLANE_TUNNEL_ID', 'tunnel_...', 'User')
   [Environment]::SetEnvironmentVariable('CONTROL_PLANE_API_KEY', '<key>', 'User')
   [Environment]::SetEnvironmentVariable('AGENT_CONTINUE_TUNNEL_CLIENT', 'C:\path\to\tunnel-client.exe', 'User')
   ```

   Do not paste the key into a repository file, issue text or a log.

2. In the extension's Devices page choose **Reconnect**. Expected receipt:
   `paused:false`, `runtime:"running"`, `connection:"ready"`; the `ready` criterion is the
   `/readyz` 200 probe on the loopback health URL within `readyTimeoutMs` (10 s).
3. `status` afterwards must keep `connection:"ready"` while the child lives. Killing the
   child externally must show `restarts` increasing, then either ready again or
   `runtime:"failed"` once the cap is reached.
4. `Pause` must report `runtime:"stopped"`, `paused:true`, `connection:"disconnected"`,
   with no tunnel child left running.

### Recovery after a platform re-login: what exists and what is missing

Guaranteed today: the persisted `lifecycle.json` intent plus the restart policy. If the
child dies after having been ready, it is relaunched with the same credentials, so a
credential that is still valid reconnects without user action. Pausing persists
`paused:true`; resuming persists `paused:false` only after a launch record is resolved, so
an unconfigured owner cannot silently flip to "running".

Missing, and therefore not claimed:

- Ordinary owner startup preserves `paused:true`; with persisted `paused:false`
  the existing lifecycle starts recovery automatically (covered by supervision
  fixture tests). This is restart recovery, not proof of an OS login hook or
  authorization refresh. An explicit
  `device-owner.mjs --resume-on-login` source entry now calls reconnect once;
  no OS login hook has been deployed or verified. Controller-fixture tests cover
  clearing of a paused state and cleanup after failure, not real login authentication.
- No authentication-failure detection: a live client that lost platform authorization is
  not restarted, because only a process exit triggers the policy. `connection` then stays
  `ready` while requests fail upstream.
- No proof that a relaunched client actually re-authenticates after the owner logs back in;
  that needs the real tunnel ID and key.

### Prepared-command control in Devices (2026-11-06 UTC)

The current source candidate adds UUID/digest inspection and explicit
revocation to the browser-managed Windows Devices page. The framed native
fixture exercised a real staged record and durable receipt: wrong digest and
extra command fields failed, duplicate revoke returned the same receipt, and
an earlier admission remained admitted. Worker/UI tests refused ordinary
webpages, subframes, old owner instances, and stale or duplicate confirmation.
The in-app browser's loopback fixture showed that Cancel sends nothing and
Confirm sends exactly one revoke, then displays the returned receipt.

The focused Node run passed 82 tests (one opt-in installed-provider test
skipped), including actual local npm tarball installation and the pinned
Windows standard-token stdio core. This adds local browser and native
protocol evidence to the separate r15 hosted revocation results. This exact
Devices source was not installed into real Chrome or connected to a hosted
test tunnel in this run. No production configuration or release changed.

### Windows execution-token evidence v2 (2026-11-06 UTC)

The exact/prepared PowerShell probe reads the primary token of the executing
process with `OpenProcessToken(TOKEN_QUERY)`, rejects thread impersonation,
and checks the token user, Windows elevation flag, integrity label and enabled
Administrators membership. The verifier requires the selected account SID
(the current Windows account by default, or an explicit expected SID), the
same child PID in the tool transcript and receipt, and the run nonce.
Administrator acceptance requires an elevated, high-integrity token with
enabled Administrators membership for that account. SYSTEM, another account,
an unraised administrator, and old role-only receipts cannot pass. The local
receipt contains the SID; the structured acceptance result and browser
challenge output do not return it. The receipt is test evidence, not a
security credential or attestation against a compromised local account.

The real pinned Windows stdio core passed the standard-user probe, then
returned a valid result and challenge for a second call that the verifier
correctly rejected as `token-mismatch` when administrator was expected.
Forty-two focused tests passed, including injected alternate SID, denied
elevation, wrong integrity, PID, nonce and browser challenge. The launcher
fixture suite also passed its eight local stub cases; the opt-in fresh-kit
launcher check was not run. This run did not start an elevated worker, grant
browser permissions, invoke ChatGPT/Dot, or use a production tunnel.

For administrator deployment, keep Chrome, the extension, and the ordinary
transport separate from an explicitly authorized, protected execution owner.
Do not use the current user-writable preview as a privileged bootstrap. First
verify the protected source/dependencies and ownership for that runtime and
prove positive child evidence with the selected SID, then repeat through both
hosted surfaces with an independently checked challenge. An administrator
wrapper process, UAC prompt, or online status is not the child evidence.

### Local Windows RunAs probe (2026-11-06 UTC)

`scripts/Test-WindowsNativeElevation.ps1` is an opt-in operator test, not a
product installer. From ordinary Windows PowerShell, run:

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -File .\scripts\Test-WindowsNativeElevation.ps1 -Action Start -Consent accept-local-admin-probe
```

Read the script before approving the Windows UAC prompt for Windows PowerShell.
The elevation path passes a fixed command in memory to system PowerShell,
which starts a separate PowerShell child. The child checks its account against
the original caller, its enabled Administrators membership and the kernel
integrity label reported by the Windows identity utility. A different
administrator account is rejected, as is a low, medium, or SYSTEM integrity
label for the elevated case. The elevated launcher relays the child exit code
through the returned process handle; the caller requires a per-run positive
witness. Neither the launcher nor the child imports repository code, writes a
proof file, installs a service, reads credentials or starts a tunnel. An
already-elevated shell can use `-Action Probe` without requesting elevation;
that checks inherited rights, not the RunAs path.

The current machine returned `standard-child` for the actual non-elevated
child. The default Plan and four refusal cases did not request UAC. The
focused launcher and v2 hosted-acceptance/stdio run passed 20 tests. Positive
interactive RunAs and live hosted administrator calls were not performed.
The RunAs probe is a local check of identity and effective privilege, not the
v2 hosted token evidence, a protected worker deployment, or remote access.

### Managed process lifecycle over Windows stdio (2026-11-06 UTC)

The real pinned provider (0.3.1), launched with a disposable state directory,
completed an owned process lifecycle under the ordinary Windows account:
start a finite PowerShell child through the exact MCP tool, read its create-only
PID witness, find that PID in `list_sessions`, stop the session with
`force_terminate`, then confirm independently that the original process
generation exited before its natural deadline and was no longer listed.
The OS observation matched the provider's direct parent PID, expected
PowerShell executable and creation time before dispatching the stop. It did
not read command lines or enumerate unrelated user sessions through MCP.
The text-only session listing was validated explicitly; an unknown response
is not an empty session list. The stop receipt survived the provider restart,
and the same operation UUID was rejected before a second dispatch.

The focused process, native Windows child, and catalog suites passed 17 tests
with one Linux-only test skipped on Windows. This was local stdio with browser
and outbound network calls blocked, not a new test through an official
tunnel. The test checks one owned process, not all descendants or arbitrary
system PID termination. Ordinary ChatGPT and Dot still each need the live
file-write and process-management scenarios. Positive interactive UAC and
administrator hosted execution remain separate gates.

### Hosted Dot append and independent readback (2026-11-06 UTC)

The dedicated official Windows test tunnel carried a real Dot file mutation
and a subsequent read. The disposable r15 runtime forwarded exactly one
approved append and one subsequent read of that same file, with no rejected
or unrelated tool requests. The admission record reported a provider result;
the retained file identity and bytes proved exactly one append. Dot returned
both lines, including the original random line not given to the model. The
browser-observed bytes matched an independent digest, and the local provider
history verified the same read occurred after the write. The test runtime
paused, reopened to confirm persisted pause, released, and was removed.
No production binding or approval policy was changed.

Repeat with the verified r15 kit and its dedicated test inputs using
`AC_HOSTED_APPEND_READBACK=accept-disposable-append-readback` and
`node tests/hosted-windows-exact-acceptance.mjs` (do not set
`AC_HOSTED_PREPARED_PROCESS` for this run). This fixture only accepts the
emitted write shape and the emitted read shape; unrelated, repeated or
out-of-order tool calls are rejected. The independent browser proof is
SHA-256 of the two returned markers joined by one LF, without a final LF.
The original marker is deliberately not emitted with the requests.

Twenty-one local focused tests passed, including the fixture denying a wrong
path, a pre-write read and duplicate calls against the real pinned stdio core.
With the previous ordinary ChatGPT hosted write and read evidence, both web
surfaces now have positive Windows file-operation evidence. This does not
prove hosted process management or elevated execution, and is not a release.

### Hosted Windows managed process lifecycle (2026-11-06 UTC)

Both ordinary ChatGPT and Dot exercised the same isolated, standard-account
r15 runtime over the dedicated official Windows test tunnel. Each started one
prepared finite PowerShell child, listed its session, requested termination
for that PID, and listed sessions again. Windows independently observed the
expected executable, direct parent and original process birth time, then
verified that same process had exited before its natural deadline. Both
conversations returned the device-generated random marker, a termination
result and the final empty listing. These runs never targeted an arbitrary or
pre-existing process.

Ordinary ChatGPT passed the strict fixture: all eight lifecycle events
appeared exactly once, there were no denied process calls, the durable stop
receipt was `provider-reported-result`, and the browser marker SHA-256 matched
the independent device proof. The fixture exited 0. Dot had the same verified
device event chain and visible final result, but its browser digest was not
recorded before the original proof deadline. Its strict fixture returned
unverified. Both runs verified persisted pause and released the test device.

Repeat with `AC_HOSTED_MANAGED_PROCESS=accept-owned-process-lifecycle` and
`node tests/hosted-windows-exact-acceptance.mjs`, using the dedicated private
test app and the same kit prerequisites as the append test. Do not combine
managed, prepared-process or append modes. Send only the emitted start
request and stop operation ID; the stop PID must come from the returned
process and its listing. Hash only the actual marker returned by the web UI.
When the local sequence is complete but browser proof is missing at teardown,
the fixture now pauses and releases the tunnel before waiting up to 60 more
seconds for the local proof file. That extra wait does not extend remote
access. The ordinary run did not need the extra window.

The four focused local suites passed 26 tests, including refusal of a
reused PID, termination near natural expiry, and a process still alive after
the provider reported a result. This evidence establishes standard-account
managed process control for the stated scenario. It does not establish
administrator execution, arbitrary PID access, the research loop, or release
readiness.

### Windows research successor admission (2026-11-06 UTC)

Before the fix, two independent CLI invocations could run distinct successor
IDs for the same failed report. The runner now persists the successor claim
before execution under the project fence. The exact child ID can read back
its result across invocations; a replacement ID is denied without starting a
process. Tests exercise both pre-claim ledger compatibility and a claim
present without a child admission.

The Windows fixture uses separate CLI processes to launch real PowerShell:
the first exits 17 and saves its error output, a digest-bound corrected plan
exits 0 with a verified output marker, and duplicate submission returns the
same result. A synthetic control-plane credential is excluded from the
PowerShell environment. This checks local evidence and dispatch, not a model
review or a live browser-to-research handoff.

The no-elevation Windows probe reported `standard-child`. The product
administrator execution owner has not been deployed or accepted. This run
did not ask for UAC or start an official tunnel. A separate strict Dot rerun
was deferred because that conversation was handling unrelated work.

### Windows Administrator Bundle Stage Gate (2026-11-06 UTC)

Added a local Plan/Stage/Verify boundary for a hash-approved ZIP, independent
of the ordinary browser-managed installation. The fixed Program Files anchor
is checked for redirection and unsafe effective write/delete permissions.
Bundle directories and files are created with explicit ownership/DACLs at
creation rather than sealed after copying. Readback compares every expected
file with the corresponding bytes in the held archive and rejects unlisted
entries, redirected paths and any DACL deviation.

The Windows PowerShell 5.1 tests checked the real Program Files anchor,
malformed archive members, mismatched hash, and refusal to stage with a
standard token. The native NTFS fixture substituted its own user as owner
and verified create-time ACLs, exact bytes, and rejection of modified bytes,
an extra ACL entry, and an unlisted file. It did not claim privileged owner
behavior, copy a runtime into Program Files, read a key, or request UAC.
Neither the stage verifier nor its test establishes trusted publisher
provenance, administrator execution, browser authorization or release.

### Windows Administrator Candidate Build and Standard-Token Smoke (2026-11-06 UTC)

Built the x64 candidate at `dist/agent-continue-windows-admin-x64-candidate.zip`
(local ignored artifact, 107,025,221 bytes, 24,320 files). Its read-back SHA-256
was `70d52cee99d90858443b27ea713d6eed8621dfbcff53261b0216abe0fa91528d`.
The build used the official Node 22.23.4 ZIP and matching executable checksum,
an isolated copy of the npm cache replayed with the checked lock and with
install scripts disabled, Desktop Commander 0.3.1, and the exact official
Windows runtime-only tunnel client v0.0.19 archive, executable and SPDX pins.
The archive contains licenses and build evidence, but not device state,
credentials, logs, or npm caches. Native `Plan` passed the complete inventory;
the builder refused a wrong Node hash and an attempt to overwrite the ZIP.

Reopened that exact ZIP, extracted to disposable storage, verified the bundled
Node executable hash/version, and ran the real local stdio suite against the
extracted app and Node. The result recorded 28 tools, 64 RPC replies, zero
protocol errors or network attempts, real disposable file read/write,
PowerShell, prepared-process revocation and owned-process management, a
`standard` Windows child token, and exit 0 on stdin close. The wrapper refuses
a zero-test run even when the test runner exits 0. Scratch directories were
removed. The 19 native stage-plan/ACL regression cases and the default stdio
test also passed.

This evidence does not cover signed release provenance, an Administrators-owned
install, elevated startup, a live tunnel from this candidate, or ChatGPT/Dot
administrator calls. No UAC, Program Files writes, key copy or publication
was performed. The local artifact is not a production release.

### Windows Administrator State and Clean Launch Plan (2026-11-06 UTC)

The state preparer binds a new, private, initially paused state to the exact
installed candidate digest and the selected native Windows account. It is
create-only and never accepts keys or enables the tunnel. Both preparation
and fresh verification check the protected bundle again. The directories
protect inherited state from ordinary Users and limit the implicit rights of
the file owner. The launcher plan sets a small explicit environment and
uses Node's module resolution hook to reject file loads outside the sealed
application. It does not sandbox commands after a legitimate tool grant.

Twenty-five Windows checks with the pinned official Node executable verified
the refusal paths, digest-bound and paused state, private inheritance, and
real rejection of an ancestor CommonJS dependency and an external ES
module. The temporary fixture uses ordinary-user ownership to exercise the
creation and readback primitives; it is not an elevated deployment. The
local bundle smoke also exercised the clean launch against the actual
packaged MCP provider using disposable state and a benign PowerShell child.
It discovered 28 tools and the child matched the selected SID without
thread impersonation, under a standard token. The full extracted stdio
suite recorded 64 replies with no protocol errors; 17 evidence regression
tests also passed.
No credentials, tunnel, UAC, production registration or runtime activation
was used. The existing fixture retries a stable read when the provider
flushes its history concurrently; it never repeats the operation.

### Local administrator child-token gate

The maintainer-only `ProbeLocal` stager action accepts the same trusted ZIP
digest and selected SID as `PrepareState`. It first verifies the sealed
installation and pristine paused state, then starts the packaged MCP provider
once with separate private scratch state. It submits one fixed local stdio
PowerShell probe. The actual child checks its noninteractive, no-profile
startup flags, rejects impersonation, and reads its process token for the
selected SID, enabled Administrators membership, elevation bit and integrity
RID. The caller validates the pinned provider's start PID, corroborating it
against structured output when present, then reads that process's output
through the same provider. Only an ordered fresh marker and an observed zero
exit code count as proof. The first response from `start_process` is not a
completion receipt. The probe does not take user command text, attach a
tunnel, read credentials, register a browser host, or persist activation.

Use the verified stager from a trusted local path in native 64-bit Windows
PowerShell after the selected account has approved Windows elevation. Obtain
the intended SID independently from that account, not from an arbitrary
elevated prompt.

For a first install, one action holds the archive, verifies the selected
elevated identity, stages the reviewed payload, creates private paused state,
and runs the fixed probe:

```powershell
& $trustedStager -Action AcceptLocal -Archive $archive -ExpectedSha256 $sha -ExpectedUserSid $selectedSid -Consent accept-administrator-first-local-acceptance
```

This action refuses an existing bundle, state or partial reservation. It
never uses an existing connection or turns on automatic startup. Do not
delete reservation files or repeat the action after a partial failure.
Keep the phase receipt and verify what was written before choosing a
diagnostic action.

From the selected owner's standard Windows PowerShell session, the reviewed
`Invoke-WindowsAdministratorAcceptance.ps1` is an alternative one-command
entry. Its default Plan checks the two independent SHA-256 pins only.
`Start` requires the explicit `accept-one-native-administrator-acceptance`
consent value and requests Windows UAC once. It does not choose or approve
the UAC action for the owner. The resulting hidden, no-profile PowerShell
process rejects account substitution, rechecks the exact stager bytes before
invoking them, and uses the selected SID for `AcceptLocal`. Supply pins from
the reviewed artifacts, not from values supplied by a webpage or computed
from arbitrary downloaded inputs. An ordinary zero exit is not acceptance;
the caller requires the randomized witness from the same native process
after a successful actual child probe. A timeout is not a cancellation.
Preserve partial state and do not retry automatically.

The Windows regressions for this entry exercise real read-only preflight,
wrong pins, refusal without consent, and a native generated child command
that refuses an account mismatch before reading inputs. Those tests do not
request UAC or exercise a successful elevated installation.

For maintenance, the split operations are still available. Stage only if
the protected bundle does not already exist; otherwise Verify it.
PrepareState is create-only; use VerifyState if existing state is still
pristine:

```powershell
& $trustedStager -Action Stage -Archive $archive -ExpectedSha256 $sha -Consent accept-administrator-bundle-stage
& $trustedStager -Action PrepareState -Archive $archive -ExpectedSha256 $sha -ExpectedUserSid $selectedSid -Consent accept-administrator-state-preparation
& $trustedStager -Action ProbeLocal -Archive $archive -ExpectedSha256 $sha -ExpectedUserSid $selectedSid -Consent accept-administrator-local-probe
```

Check each receipt before proceeding. Positive local evidence requires
`administratorChildVerified: true`; a ZIP plan, a staging receipt or an
elevated terminal alone is not enough. Successful probe scratch is removed
after correlated shell completion and provider exit. Failed or uncertain
scratch remains protected for diagnosis; do not replay automatically.
An actual administrator ProbeLocal run and real hosted calls through the
selected ordinary ChatGPT and Dot conversations remain separate gates.

For long verification runs, `ProbeLocal -ProbeReceiptId <32 lowercase hex
characters>` stores a protected, create-only start receipt and atomically
publishes a separate result, both bound to the exact bundle SHA-256. A caller
timeout is not a result. Check the result for that same ID; a start receipt
alone is not permission to repeat the probe or activate the tunnel.

The exact candidate digest above passed the shared probe with a real
standard-token PowerShell child, and the same provider rejected that child
when the probe required an administrator token. The child also confirmed
the expected startup flags. Native regressions covered missing consent,
SYSTEM, standard-token refusal, wrong nonce, wrong PID and out-of-order
evidence. Seventeen hosted evidence regression tests passed; they are
not new hosted calls. There was no UAC, protected installation, tunnel
attachment, or production change in this run.

### Official client with the sealed Windows profile

The source renderer `createSealedWindowsProfileDocument` emits one fixed
stdio target: the bundle's Node, disabled global module lookup, the prepared
import fence, the bundled host, and the digest-specific state directory.
The profile references a key in the separate `.secrets` sibling without
reading or writing it. The existing ordinary profile does not opt into
this path. Rendering is not a verified installation, key enrollment, or a
browser grant. An elevated owner still has to supply the verified clean
environment and authorize any live launch.

`Test-WindowsAdministratorBundleSmoke.ps1 -ExerciseTunnelProfile` exercised
the exact reviewed candidate with the real v0.0.19 runtime-only client,
portable Node, provider and stager-generated clean environment. The fixture
used a dummy key and overrode only the control plane endpoint to a private
IPv4 loopback server. The official client reached readiness, forwarded ten
correlated MCP responses including file write/read and the exact PowerShell
tool, rejected mismatched/replayed dispatches, and shut down with verified
packaged provider exit. The standard-token direct stdio companion also
passed 64 responses. See the [official client guidance](https://github.com/openai/tunnel-client#for-codex--copilot)
for the one-active-runtime-per-tunnel stdio constraint.

The candidate archive and native UAC stager were not replaced. This uses a
source-rendered profile against the extracted candidate. It does not attach
any real OpenAI tunnel, change native registration, or verify an elevated
tool process, hosted ChatGPT/Dot authorization, reconnect, or release.

The loopback follow-up confirmed 16 correlated replies across two starts (10
before pause, 6 after explicit reconnect), no polls while paused, clean exit
of the packaged provider, and rejection of the original exact-process UUID
after reconnect. This is transport and local pause/replay evidence only.

### Prepare the protected hosted binding

After the local administrator probe passes, the elected Windows owner can
run the reviewed stager's `BindHosted` action in an interactive elevated
Windows PowerShell. Specify the known isolated tunnel ID, not the ID of an
already-running runtime. Do not pass a key on the command line:

```powershell
& $trustedStager -Action BindHosted -Archive $archive -ExpectedSha256 $sha -ExpectedUserSid $selectedSid -HostedTunnelId $isolatedTunnelId -Consent accept-administrator-hosted-binding
```

The action repeats archive/ACL, paused-state and actual administrator child
checks before offering a masked local runtime-key prompt. The key goes only
into the private `.secrets/runtime.key` sibling. The official profile
references that file; the binding receipt contains a profile digest, not a
key or a key digest. The stager rereads the profile/receipt bytes, checks
the key file's metadata and ACL without reading its contents, and rejects
additional entries. An incomplete vault is not overwritten or silently
recovered. Authorized code with this same Windows administrator identity is
not isolated from the file by these ACLs.

`hostedBindingPrepared: true` means protected local preparation only.
The state stays paused, and the binding receipt records
`activationAuthorized: false`. No credential validation against OpenAI,
runtime start, conversation grant, service, or browser registration is
performed. The runtime-owner launch and both hosted-surface probes remain
separate steps.

`VerifyHosted` is a readback-only check after `BindHosted`: it verifies the
same selected identity, archive, paused state, binding and clean launch plan
without starting a runtime or rereading the credential contents.

When the owner has already supplied a local key file, `BindHosted` also
accepts `-RuntimeKeyFile <absolute local path> -OperationReceiptId <32 lowercase hex characters>`.
It reads one key after the child-token gate, accepts a UTF-8 BOM and one final
newline, clears the temporary byte buffer, and never puts key contents in
arguments, environment variables, stdout, or receipts. Both credential input
routes validate the protected launch plan after binding and leave it paused.
The `-ProbeReceiptId` spelling remains an alias for the durable operation ID.

### Actual Windows administrator child receipt (2026-11-06 UTC)

The owner's original `AcceptLocal` reached `probe_child`, but did not prove
an administrator child. Separate live Windows verification confirmed all
24,320 protected files, the pristine paused state, and the clean launch plan
for the unchanged candidate SHA-256 `70d52cee99d90858443b27ea713d6eed8621dfbcff53261b0216abe0fa91528d`.
A remote request timeout did not establish a probe result.

The installed provider supplied a text PID but no structured PID in its
observed start response. The fix supports that fixed-format header and then
reads the same process's completed output; it never repeats the command.
The selected host's administrator PowerShell reported the `gb2312` console
encoding. With code page 936, the installed ordinary-token rehearsal failed
to confirm the result without explicit UTF-8 and passed with UTF-8. The
administrator rehearsal before that encoding fix recorded `probe_process_incomplete`.

After the UTF-8 fix, the actual selected administrator's sealed provider
launched system PowerShell, and the fixed child verified its selected SID,
enabled Administrators membership, elevation bit, and high integrity. The
provider returned its nonce/PID and exit code 0. This focused recheck reused
the independently verified installed bytes; it did not redo the full ZIP hash
and file traversal in that same invocation. The digest-bound protected
result read back with `administratorChildVerified: true`. The state remained
paused, no candidate provider was still running, and no hosted vault existed.
The candidate has not connected to OpenAI in administrator mode. Both browser
surfaces, browser-only wake/recovery with that profile, and release are open.

### Protected hosted binding and timed acceptance window (2026-11-06 UTC)

On the selected Windows administrator account, `BindHosted` for the existing
private AgentContinue Windows Acceptance tunnel verified the 24,320 sealed
files and passed a new real PowerShell child-token probe in the same action.
The durable receipt recorded both `hostedBindingPrepared: true` and
`hostedLaunchPlanVerified: true`. An independent readback found the expected
three protected vault entries, exact test tunnel and OpenAI endpoint, paused
intent, no activation, and no candidate tunnel process. The owner-provided
key was copied locally into the protected vault; its contents were not read
back or sent to the browser. Authentication remains untested.

The source-side bounded acceptance runner was exercised with the exact
packaged Windows client and provider over loopback. There were 16 correlated
MCP replies over two starts. The second start used the acceptance window,
confirmed readiness, rejected the prior operation ID, and stopped on the
operator signal. The controller persisted pause, observed the original
provider exit, and released its lease. Four additional tests exercised
expiry, refusal to take over a running owner, and retaining an uncertain stop.
The live administrator runtime has not used this window yet. Do not silently
upgrade existing standard-account browser grants to the administrator role.
The live test must identify the authorized chat and distinguish tool discovery
from actual file/command/process execution and browser-controlled recovery.

### Executable Windows hosted acceptance window (2026-11-06 UTC)

The maintainer stager now exposes `RunHostedWindow` and `StopHostedWindow`.
Run is limited to the selected elevated user, the verified protected bundle
and fresh paused state, the exact existing vault/tunnel profile, a digest-pinned
window helper and an explicit 15–900 second duration. It uses the pinned Node
and existing controller in memory, without installing a service or registering
a browser host. It does not write another copy of the key. Do not point an
existing standard-account app grant at the administrator runtime as a shortcut.

From an already elevated selected-account PowerShell, and only for an
explicitly authorized private administrator test:

```powershell
$run = [Guid]::NewGuid().ToString('N')
& $trustedStager -Action RunHostedWindow -Archive $archive -ExpectedSha256 $sha -ExpectedUserSid $selectedSid -HostedTunnelId $isolatedTunnelId -OperationReceiptId $run -HostedWindowSource $reviewedWindowSource -HostedWindowSeconds 300 -Consent accept-administrator-hosted-window
```

From another elevated shell, the same receipt ID can request a stop without
rehashing the archive or reading the credential:

```powershell
& $trustedStager -Action StopHostedWindow -Archive $archive -ExpectedSha256 $sha -ExpectedUserSid $selectedSid -OperationReceiptId $run -Consent stop-administrator-hosted-window
```

The protected `.ready` marker means the client reported readiness, not that a
chat invoked any tool. The stop acknowledgement is not an exit receipt. Only
the final result for the same ID with `hostedWindowStoppedConfirmed: true`
confirms that pause was persisted, the owned provider was observed stopped,
and the controller released its lease. A stop also interrupts readiness
waiting; a late ready result does not reopen the window. An unconfirmed stop
does not authorize restarting or clearing ownership. This is a first-use
maintenance window, not browser-only restart of an already-used state tree.

The Windows loopback fixture exercises the real PowerShell entry helpers and
exact packaged tunnel client/provider, including the second provider's
independent exit readback and operation-ID replay refusal. It uses synthetic
credentials and a private loopback endpoint. The actual protected candidate
was read back still paused, with zero candidate tunnel clients. The existing
ChatGPT acceptance app was observed set to allow low-risk operations only;
no browser grant or live administrator connection was changed.

### Exact operation admission for private Windows web acceptance

`RunHostedWindow` accepts a proof-only variant with `-HostedAdmissionSource`,
`-HostedAcceptancePlan`, `-HostedAcceptancePlanSha256`, and the separate
`accept-administrator-hosted-proof-only` consent value. The protected owner
validates the exact plan digest and the pinned admission source, then renders
a private operation-specific `.yaml` profile, plan, and Node entry. This
does not replace the existing full-account profile or copy the runtime key.

This endpoint lists only the tools present in the owner-reviewed plan. It
checks the exact argument shape and order and records admission before
forwarding to the real packaged provider. An admitted operation is never
replayed, including when its outcome is unknown. The proof endpoint is local
to the device behind the same official outbound tunnel; it is not a new
network relay or a substitute for the full-account product acceptance.

Rehearsal: `Test-WindowsAdministratorBundleSmoke.ps1` with both
`-ExerciseHostedAdmission` and `-ExerciseTunnelProfile` verifies real file
read/write and the actual standard-token PowerShell child over stdio, then
runs the guarded profile with the official client over loopback. The latter
admits only the requested read, rejects the prior shell and repeat read,
and confirms process exit. The pinned client requires the `.yaml` filename
extension even for a profile rendered as JSON-compatible YAML.

#### Live Windows read receipts (2026-11-06 UTC)

The private hosted proof ran once on the protected Windows candidate
(`02c0f0fde3214d5c95d8ba8d69d83ae0`). Ordinary ChatGPT and Dot each
returned the previously undisclosed random marker from its own disposable
file. Each marker matched its local manifest digest, and each exact request
has a protected `.provider-replied` receipt. No browser permission changed.
The same operation's terminal receipt confirmed stop; a separate readback
found persisted pause and zero candidate tunnel clients.

This proves hosted file reads from both surfaces, not a full-account grant.
The previous high-integrity PowerShell child receipt was local; this hosted
run performed no shell or process mutation and does not prove the token of a
web-triggered command. The live test used an elevated maintainer window, not
extension-only wake, reconnect, or revocation. Do not use the proof-only
admission plan as the product's device access policy.

#### Reuse the protected install after the read-only proof

The first guarded run changed the protected state: the provider rewrote its
configuration with a local usage-statistics object, inherited the private
ACLs on generated files, and left logs and the per-step receipts. Applying
the pristine-state check again refused the real, cleanly paused install.

Supply `-AfterReadOnlyWindow <prior-window-receipt-id>` to `VerifyHosted`
for readback, or to a guarded `RunHostedWindow` with a fresh window ID and
new proof plan. This is not valid for unrestricted activation. It verifies
the prior bundle-bound terminal stop, pairs each prior read admission with
its provider reply, retains those artifacts, and admits only the recognized
private generated files. It refuses an unresolved step, changed fixed
provider settings, unrecognized state, or a leftover controller lease.

The updated state check passed against the actual paused Windows install
with both protected read receipts. No second window was opened for this
check. The next acceptance run still needs its own full-account authorization
test and independent web-triggered PowerShell child-token evidence. Do not
use this maintainer-only entry as the product's browser wake implementation.

#### Hosted Windows administrator command proof

`node scripts/prepare-hosted-administrator-probe.mjs` creates a separate
exact operation for ordinary ChatGPT and Dot, in that order. The reviewed
command uses system PowerShell and reads that child's own token elevation
and integrity. It also requires enabled Administrators membership, creates a
uniquely named proof file in protected work, and returns a fresh challenge
read back from that file. Start the guarded
window with the emitted plan hash and the prior read-only window ID.
Submit the first surface only when the candidate is ready. Submit the
second only once the first has a confirmed provider reply; never retry an
admitted operation. Approve only this individual acceptance call.

Use `Read-HostedAdministratorProbe.ps1` with the exact window and step IDs
and the marker observed on that browser surface. Its readback correlates
both protected receipts, the selected account, browser marker, and provider
PID; it does not expose the local SID, proof text, or prior history. The v2
proof distinguishes actual token elevation from the older role-and-integrity
witness. A legacy proof can still match its recorded account and marker, but
never sets `childTokenElevationVerified`. The guarded endpoint
does not provide same-PID `read_process_output`; a terminal-looking start
reply is not independent evidence of exit code zero or managed process
control. Leave the temporary runtime paused after the attempt.

The real protected reentry window `c5af614759884f51d55dab759ed22676`
verified all 24,320 bundle files and reached tunnel readiness. The ordinary
ChatGPT surface reached the one-time approval card, but the local controller
recorded zero admissions and zero replies before stop. The stale request was
dismissed after shutdown. Dot's draft was not sent. Terminal readback
confirmed a persisted pause, no controller lease, and no candidate client.
This is live evidence of a successful protected restart and web approval
boundary, not an executed administrator command or a production integration.

For the next run, pass both the original `-AfterReadOnlyWindow` and the
closed `-AfterUnusedWindow` ID above. The latter requires a valid stopped
receipt and an empty guarded receipt directory; a single admission causes
refusal. This path was verified against the actual paused state without
starting another client. Do not open another short window solely to poll a
stale approval; coordinate the one-time approval with the live session.

### Windows protected product owner checkpoint (2026-11-06 UTC)

The Windows-first delivery goal remains active. The extension manages consent,
device state, and wake. The selected Windows account runs the MCP operations
over the official OpenAI tunnel, without an AgentContinue relay. A local token
receipt and a hosted read receipt do not establish a hosted administrator
command. Prior standard-token write and process receipts do not close this gap.

- The new `native/desktop-commander/windows-admin-owner.mjs` entry is packaged
  separately from the guarded proof. It requires an exact bundle digest,
  selected Windows SID, protected profile fingerprint, official endpoint, and
  a separate full-account grant. It resumes only previously saved running
  intent, refuses paused or unresolved device-control state, and will not take
  over an existing controller lease. It accepts no browser command payload.
- The stager's `AuthorizeHostedOwner` action creates and reads back a protected,
  create-only grant for that bundle. It does not start a runtime, clear pause,
  register a host, or create an operating-system task. The old proof-only
  binding is not reused as product consent.
- The focused Node suite passed five tests including an actual Windows
  controller child with a loopback transport. The Windows PowerShell stager
  regression also passed, including consent/identity refusals, sealed grant
  creation, and preserved pause. Neither test reaches ChatGPT or Dot.
- The new local `dist/agent-continue-windows-admin-x64-owner-candidate.zip`
  has SHA-256
  `7a7facba21393adf0dd3acb236ce9d525d96ce9436f49a41137f4eaff334b1c5`.
  The build inventoried 24,321 payload files and passed the stager's Plan.
  The new digest was not staged, enrolled, authorized, or connected.

Next, wire the protected entry to a fixed Windows on-demand launch from Chrome
after first setup, including an explicit first connection and revocation of a
live owner. Use the existing protected launch checks; a browser wake must not
carry credentials, launch arguments, or shell input. Test actual elevated file
write/readback, PowerShell token and exit status, and owned-process control
independently from ordinary ChatGPT and Dot. Then verify browser-only recovery
of a previously running device, persistent pause, live revocation, and no
automatic replay of an operation with an unknown outcome. Keep production VPN,
MCP, and research tasks unchanged. No GitHub release or Chrome Store submission
was made for this candidate.

### Windows administrator revocation candidate (2026-11-06 UTC)

The product candidate now uses a separate digest-bound `owner-tunnel.yaml`
that starts the provider with `--administrator-owner`. The guarded proof
profile is unchanged. The protected launch plan has a fixed entry, no
browser-supplied parameters, and a clean environment; it has not been
registered or launched by Chrome.

`RevokeHostedOwner` checks the installed bundle and the selected SID in the
sealed identity record. It creates the private `owner-revoked` marker without
stopping or replacing unrelated processes, touching credentials, or requiring
fresh paused state. Repeating the request is idempotent. The command reports
marker publication, not confirmed shutdown.

The guarded provider checks authorization and durable pause before handing
each tool request to the provider or reserving its operation ID. A denied
request does not steal the response for an already admitted request using
the same RPC ID. The owner observes revocation during startup and runtime
and requests a stop of its retained launcher; restart is denied while the
marker exists. Even when provider identity could not be observed or saved
intent is corrupt, shutdown signals the retained child but does not release
ownership without reliable stop and state evidence. This does not undo an
already admitted command or prove that every descendant of an elevated
process exited.

The focused Windows Node run passed 74 tests, including real standard-token
provider stdio, a denied post-revocation call with no reservation, and stopping
an owned loopback fixture child before and after readiness. Windows PowerShell
stager regressions passed, including revoke readback while a lease exists.
The local `dist/agent-continue-windows-admin-x64-revocation-candidate.zip`
passed the stager Plan and independent readback of the three changed runtime
entries. Its SHA-256 is
`8b2a99395b0e74d91c2af3468adfda7c113fa0ba5d6f23aae57bfb609b294915`.
It supersedes the previous owner candidate for further development only; it
has not been staged, installed, activated, or published.

Before enabling Chrome wake for administrators, implement and verify a
Windows-owned shutdown boundary for the managed process tree. Test the fixed
Chrome trigger, first connect separately from wake, and actual hosted
post-revocation denial. Keep previously admitted unknown results in the
operation journal. The prior protected acceptance remains paused; neither
live administrator operation from the web nor release is claimed here.

### Windows managed owner job checkpoint (2026-11-06 UTC)

`StartHostedOwner` is a fixed, elevated maintainer entry for restoring a
previously running, explicitly authorized device. It verifies the sealed
bundle, Windows SID, immutable state, exact hosted profiles and grant, and
local running intent. It accepts no browser-supplied executable, shell
command, or process ID. This is not first connect, registration, or proof of
readiness. The old guarded hosted proof remains separate.

The supervisor compiles `app/windows-owner-job.cs` from the already
hash-verified archive stream in a protected compiler temp directory. It
atomically assigns the fixed Node root to a private Job at process creation,
verifies membership before resuming, and does not enable breakaway or inherit
the job handle. The supervisor checks pause and revocation, gives the owner a
bounded graceful stop, and drains the Job if members remain. The terminal
receipt separates root exit, zero active Job members, inner-lease state, and
unobserved tunnel readiness. The create-only outer fence is removed only
after a matching terminal receipt and verified settlement; abrupt loss of the
supervisor leaves the fence, even when Windows closes and kills the Job.
Do not reclaim it from an absent PID or pipe alone.

This covers managed Job members, including normal Windows process creation by
tools. It is not an administrator sandbox and does not undo prior operations
or terminate unrelated research jobs and externally launched service/WMI
processes. See [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
and [process creation attributes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute).

The actual Windows test used retained handles to verify a fixture root, child,
and grandchild all exited on requested drain, unexpected root exit, and
abrupt broker loss. An outside fixture stayed alive. Disposable PowerShell
tests covered clean-environment compilation from archive bytes, refusal with
an ordinary token or paused intent, a duplicate outer fence, and preserved
ownership when terminal receipt publication fails or inner leases remain.
Node regressions included closing a live owner on durable pause without
changing that intent. This does not establish an installed elevated owner,
official-tunnel readiness, or browser/platform grants.

The Windows Node regression run passed 75 tests. The local
`dist/agent-continue-windows-admin-x64-job-candidate.zip` has SHA-256
`1a1c63627e78855b5617d40226f599a3f84e0b4a0634363e1d80508505ff8a59`.
Its 24,322 payload entries passed Plan, and independent ZIP readback matched
the Job source and administrator owner bytes to this worktree. It was not
staged, activated, or published. CI configuration now includes the Windows
descendant fixture; no remote CI run is implied.

Next: install no launcher until its fixed Chrome-to-Windows trigger and
read-only generation-bound readiness are designed and tested. Initial
connection must remain a separate explicit operation. Then validate browser
reopen, real elevated commands and process control from ordinary ChatGPT and
Dot, and hosted denial after revoke. Do not reopen an unattended approval
window or present this checkpoint as a public release.

### Windows administrator owner readiness observation (2026-11-06 UTC)

A start receipt, a running-intent marker and a process lease are not tunnel
readiness. The managed Windows owner now samples the local controller and
publishes a private observation with the current random launch generation,
root PID, increasing sequence and boot-relative time. The supervisor accepts
only a fresh sample from the retained Job root. A status record outside the
private vault is writable by Administrators and SYSTEM and readable by the
enrolled SID. It uses the sample's age, not the time it was copied.

The fixed, read-only stager action ObserveHostedOwner returns only state and
generation. Ready requires a fresh sample for the exact bundle, a live
supervisor and root with matching Windows creation times, and a positive local
readiness observation. Missing, expired or mismatched evidence returns
unobserved. The read path does not launch anything, accept a command, or
return credentials or an endpoint. Pause, revocation and stopping invalidate
readiness; a terminal receipt is still not a live health result.

The focused Windows Node run passed 76 tests. The PowerShell regressions
verified the real Windows Job observation path, revocation, generation and
PID mismatch, stale samples, and live process-identity checks. This is local
fixture evidence, not an installed elevated owner or an official hosted call.

The local observation candidate ZIP is
dist/agent-continue-windows-admin-x64-observation-candidate.zip.
SHA-256: b78cd6fe533c4dd52ac099389c9fb3b07e26ff9710a2d8b3001a968850c30487.
The stager Plan passed with 24,322 payload files. Independent archive
readback matched both administrator owner and Windows Job source files.
The candidate has not been staged, installed, activated or published.

Open: register and test the exact Chrome sender and fixed demand trigger,
test a normal browser token reading the installed elevated owner's status,
and verify browser-only restore after enrollment without overriding pause.
Ordinary ChatGPT and Dot must still separately execute and receive matching
administrator receipts over the official tunnel, and demonstrate denial after
revocation. Do not repeat an unattended approval window or replay an operation
whose outcome is unknown. GitHub and Chrome Web Store release remain gated on
Windows end-to-end acceptance.

### Windows administrator browser bridge (2026-11-06 UTC)

The extension's separate administrator transport targets only
com.agentcontinue.administrator_owner. It permits one wake request per
browser session after local opt-in and browser permission; enabling the
preference does not itself connect. Worker initialization also checks the
session guard because unpacked Chromium did not reliably deliver the startup
event alone. No automatic retry follows a lost wake acknowledgment. The
exact Devices browser-managed page can read status but cannot ask the service
worker to start an owner or pass host arguments. The page calls the two
concepts by different names: browser recovery preference and last local
readiness observation. Neither is a platform conversation grant.

The standard-token Node bridge accepts one framed wake or status request for
the exact enrolled extension origin. Wake targets one digest-derived task
path and returns only requested or unconfirmed. Status invokes the fixed
ObserveHostedOwner stager action and returns only the bounded observation.
The binding, stager and eventual task inputs must be written by protected
Windows enrollment. The browser sends no paths, SIDs, tunnel identifiers,
credentials or command strings. The task scheduler's submission receipt is
not an execution receipt. See the [Chrome Native Messaging guide](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
and [Windows demand-start contract](https://learn.microsoft.com/en-us/windows/win32/taskschd/registeredtask-run).

Automatic saved-running startup and replacement no longer republish a
running lifecycle record, which could overwrite concurrent manual pause.
Explicit Reconnect and separately authorized login recovery still own their
intent changes. Tests cover a successful restore preserving the existing file
and a durable pause published during asynchronous startup preventing launch.

An isolated real Windows Chromium profile reopened with no intervening
extension page, started one disposable Native Messaging host and later
read a separate status result. Status alone did not wake it; the ordinary
Devices URL could not request administrator status. The random fixture
registry entry and profile were removed. The wake and ready callbacks were
simulated, not scheduler or tunnel actions. Separately, the real Windows
PowerShell status adapter ran without elevation and returned unobserved for
an absent bundle. Devices browser checks covered the status and opt-in UI,
English/Chinese controls, and mobile layout. Existing ordinary-token
Chromium startup scenarios for paused, running and unfinished intent passed.

Next enrollment must register the exact origin and a single fixed action
under an administrator-owned Task Scheduler folder/task. Use the selected
account's interactive token at HighestAvailable, no scheduled triggers,
no injected task parameters, and IgnoreNew. Verify effective read/execute
without write/replace/delete from a real medium token. Other processes
running as the same SID may invoke the fixed task; the task ACL does not
authenticate Chrome. First Connect and durable Pause/Revoke are separate
local actions. Task Stop alone is not Pause. Then verify browser reopen and
normal-token status against the installed elevated owner, followed by
ordinary ChatGPT and Dot administrator receipts and live revocation.
No product registration, elevated task, new live tunnel or release was made.

### Windows protected browser enrollment candidate (2026-11-06 UTC)

EnrollBrowserOwner is a separate Windows stager action. It requires specific
enrollment consent, the exact extension ID, a selected high-integrity
interactive administrator SID, a preauthorized but paused owner with no
outstanding owner lease, and pinned archive and stager hashes. Its browser
assets are sealed to the selected SID for read/execute, with the demand
configuration private to Administrators/SYSTEM. It stages exact stager
bytes and verifies the copied archive and task definition before publishing.

The fixed demand-only task uses that user's InteractiveToken at
HighestAvailable, no triggers, and IgnoreNew. Its sole action is Windows
cmd with AutoRun disabled and a fixed sealed batch file. That file clears
Node startup inputs and launches the pinned Node demand entry. Node launches
system PowerShell with an explicit minimal environment, without inheriting
CLR startup hooks or PowerShell settings. No project-built EXE or background
poller is installed by this design. There is no browser-supplied task action.

The transaction uses a protected machine reservation, verifies the folder
and task ACLs, creates only the HKLM native host registration, refuses a
visible selected-user override in either registry view, and publishes the
sealed commit last. Both the browser bridge and task-triggered owner require
that commit. Registration does not start the task or write running intent.
A partial or unconfirmed publication retains its reservation and must be
reconciled by an administrator; it never blindly overwrites or deletes
existing artifacts. An HKCU shadow added later is not prevented by the
installer. The task's authorization is the Windows SID, not a claim that
only Chrome can invoke it. Task Stop is not durable Pause.

Real Windows tests constructed and read the intended task definition via
Task Scheduler COM without registering it. AccessCheck with the actual
medium token allowed read/execute and refused write/delete/ACL/owner changes
against the proposed task and registry descriptors. This does not prove
the effective ACL of a registered object or Scheduler's Run behavior.
The fixed Node launch also started a disposable real PowerShell child with
the minimal environment. Nine focused Node tests, the Windows enrollment
checks, and the existing Windows stager regressions passed.

Candidate: dist/agent-continue-windows-admin-x64-enrollment-candidate.zip
(24,324 payload files). SHA-256:
c862ca92c02d1e984622e6d289588f4561f125fd5648f095374e63edd1c52ae9.
The stager's current source SHA-256 is
33f80f4ac86df9519d28cc8581e7f998c3108897b956574fa419468136286784.
Plan passed and independent ZIP readback matched both the browser host and
demand entry to the worktree. This candidate was not installed or published.

Open: run a disposable, pinned same-SID elevated enrollment with a benign
task witness; verify task/registry readback, demand from a genuine medium
token, mutation denial, actual high-integrity child SID, and cleanup.
Then complete the separate first Connect and browser-only restore against
the installed owner. Live pause/revocation and the two hosted administrator
operation receipts still gate same-version publication. No production
registry, scheduler, VPN, tunnel, or research environment was changed.

### Windows first Connect and Pause checkpoint (2026-11-06 UTC)

The existing enrollment ZIP and stager hashes above were rechecked before
editing the intent code. The candidate was not rebuilt or installed.
The Node state writer in native/desktop-commander/windows-admin-intent.mjs
uses a flushed replacement and checks intent identity before commit.
Connect refuses revoked or changed authorization, unknown receipts, and
existing ownership leases. Pause is independent of the operation journal
and never edits it. The narrow test started red with ERR_MODULE_NOT_FOUND;
92 tests passed after implementation across the intent, journal, lifecycle,
administrator owner, browser bridge and demand suites on this Windows host.
CI now includes the intent suite. This is source-level evidence only: the
elevated caller, protected serialization and package wiring remain open.

The fixed wake only restores saved running intent. It cannot connect a
newly enrolled, paused owner. Explicit first Connect and Pause belong to
the existing elevated local stager, not to the same-SID medium-token
wake task. Serialize the final intent update, revocation, and admission
check; an earlier Connect must not overwrite a newer Pause. Pause must
still deny new work when the journal is unknown or a Job is live. A
committed pause does not establish that an in-flight action or Job exited.
Do not clear a lease on a timeout or replay an operation whose outcome
has not been resolved. Browser-only restore and both hosted administrator
receipts still gate release.

### Windows protected Connect and Pause candidate (2026-11-06 UTC)

The sealed stager now exposes explicit `ConnectHostedOwner` and
`PauseHostedOwner` actions with separate consent and a matching elevated
interactive SID. Connect verifies the sealed bundle, enrollment, task and
binding. Its fixed, bounded Node child checks authorization, leases and the
operation journal without writing state. The stager then records running
intent and requests the fixed demand task once. The receipt distinguishes
durable intent, launch request, and tunnel readiness; a lost Scheduler
response is unconfirmed and is not retried by that operation.

Pause advances a protected revision even if already paused, and replaces
the intent file atomically without editing the journal or claiming a running
Job has stopped. The final admission lock is shared with Pause, Revoke and
the fixed wake launcher, so a stale Connect cannot overwrite a newer Pause.
Connect only transitions exact paused intent, consumes its revision before
commit, and releases the lock before calling Scheduler. The demand task
rechecks intent, even if a delayed request arrives after Pause. Polling
reads allow NTFS replacement; sharing errors on replace have a bounded retry.
Browser wake does not grant authority or publish running intent.

Local validation: 21 focused Node tests and the Windows stager suite passed.
Windows fixtures exercised bounded lock contention, Pause with a live
reader, stale and duplicate Connect rejection, and an unconfirmed Scheduler
response after lock release. They did not perform a real elevated
registration or request an actual Scheduler Run. Independent ZIP readback matched the
intent, owner, browser host, demand and operation modules to their sources.

Candidate: `dist/agent-continue-windows-admin-x64-connect-pause-candidate.zip`
(24,325 payload files; SHA-256
`e8a56275fac2f9fe4be08a67cd46f49d4856662a159fad5ed7105846ad44d6ab`).
The final external stager passed Plan against these exact ZIP bytes. Its
SHA-256 is `ac03294e26622c957e4bebc29d6136aa8b437eda31a6d59568050a6f974204a0`.
This package was not installed or published. Next: run the disposable
same-SID high/medium-token task witness, then verify browser-only restore,
pause and revoke against the installed owner. Both ordinary ChatGPT and
Dot still need real elevated command receipts before Windows delivery.

### Windows live Scheduler demand witness (2026-11-06 UTC)

`scripts/Test-WindowsAdministratorDemandWitness.ps1` pins the external
stager and reuses its task-definition and ACL readback functions. Plan,
wrong-digest refusal, and missing-consent refusal were checked without
registration. Start uses native Windows elevation for a unique inert
task folder; no product registry key, fixed product task, network
endpoint, or key is used.

On real Windows, the registered folder and enabled task passed the pinned
ACL and definition checks. The first attempt showed that the existing COM
task object is not reliable for immediate post-enable readback; reopening
the registered task succeeded, as the production stager already does.
The genuine medium token could not disable the task. The same fixed
`System32\schtasks.exe /Run /TN ...` request used by the browser bridge
started the disposable `cmd.exe /D /S /C` action. Scheduler recorded the
fresh challenge exit code from PowerShell only after its child verified
the selected SID, matching interactive session, and high integrity with
Administrators enabled. This is task-level correlation, not independent
attribution to an individual Scheduler RPC instance. The elevated worker
disabled the exact task, checked its instances had drained, deleted the
task and folder, and the medium caller independently confirmed the folder
was absent. This is OS execution evidence, not Chrome wake or hosted
command acceptance.

Microsoft documents the separate execution and modification requirements
in [Security Contexts for Tasks](https://learn.microsoft.com/en-us/windows/win32/taskschd/security-contexts-for-running-tasks).

**Candidate staging:** the real native-elevation probe first verified a
same-account elevated child without registration. The separate pinned
`Invoke-WindowsAdministratorAcceptance.ps1 -Action Start` then accepted
the 24,325-entry connect/pause ZIP and final external stager hashes above.
The elevated child returned the exact acceptance exit witness only after
protected bundle and initial state verification, the local administrator
tool-child check, and probe cleanup. Independent readback observed the
candidate bundle and state, no vault, browser bridge or Chrome host, no
candidate product task, and no leftover visible witness folder. No runtime
key was accessed or copied and no tunnel was started. This replaces the
earlier not-staged checkpoint for this digest only; the release remains gated
on installed Chrome, browser-only recovery and both real web surfaces.

### Windows paused acceptance binding and browser preview (2026-11-06 UTC)

The authenticated OpenAI Platform tunnel inventory identified the dedicated
`AgentContinue Windows Acceptance` entry separately from the production
research endpoints. On the selected Windows account, the pinned external
stager and e8a56275 bundle completed `BindHosted` with the previously
owner-designated local key file. A separate elevated, read-only check matched
the finished receipt to the same bundle and operation; verified the exact
paused intent, official endpoint and dedicated tunnel ID; and confirmed
the runtime configuration only references the protected credential file.
It did not read or emit the key. No administrator activation grant, task,
browser registration, conversation grant, or tunnel connection was created.
The binding is local preparation, not cloud authentication.

The separate Chrome preview is
`dist/windows-admin-browser-acceptance-20261106-e8a56275/agent-continue-2.2.0-windows-device-preview.zip`,
SHA-256 `af5738552110016454cf8501b2115f15fe1796add5ea21776a32ac6f656fe8a4`.
It contains 236 entries, with the browser bridge, Devices code and background
worker matching source after the packager's CRLF normalization. It was
extracted under `unpacked/AgentContinue` adjacent to the ZIP. This preview
deliberately has no fixed manifest key; use only the ID actually displayed
by Chrome for the extracted package, not the development or Store ID.

The in-app browser rejected the Chrome management URL. No alternate
browser surface was used to bypass that restriction. The owner was asked to
load the verified unpacked candidate in an isolated Chrome test profile.
The canonical administrator native-host name was absent in both user and
machine registry views, and the Scheduler folder was absent. Those names
are machine-wide despite the test profile; recheck them and define safe
de-enrollment before registration. Enrollment, browser recovery, real
hosted commands from both surfaces and publication remain unverified.

### Windows machine-wide browser unenrollment candidate (2026-11-06 UTC)

New enrollment records the exact digest, selected SID and Chrome origin
binding in its protected machine-wide reservation before publishing any
registration. An empty reservation from a legacy or incomplete setup is not
ownership evidence. The explicitly elevated `UnenrollBrowserOwner` action
requires the same binding, an exact committed bridge, the durable revoke
marker, and no owner or operation leases. It disables and rereads the exact
task; a live instance prevents deletion. Foreign or unrecognized tasks,
subfolders, registry values or keys cause refusal. It deletes only the
matching HKLM64 leaf, rechecks both registry views, deletes the exact task
and its empty folder, and releases the bound reservation last. It keeps
the revoked bridge, durable denial, credential store, and evidence files.
An unconfirmed change is not reported as success. A retry can recheck the
same committed, revoked enrollment after a partially completed removal;
it cannot remove an uncommitted enrollment or an unrelated reservation.

The exact stager at this checkpoint has SHA-256
`f13a23de4018c64d270caeeaa883f5bc9660ee9ecb7b61514a6d187b15f0a87f`.
The previously staged ZIP, paused binding and unpacked Chrome preview are
unchanged. Windows stager and enrollment regressions cover separate consent,
medium-token refusal, origin-bound ownership, refusal of foreign or live
tasks, and retry after an unconfirmed host removal. A real disposable
Scheduler task again executed a same-SID high-integrity PowerShell action
and was removed by the production task-cleanup function. The native registry
callback was a no-op in that live witness; actual Chrome registration and
removal of the canonical HKLM key remain untested. No production task,
registry key, tunnel, release or browser profile was changed.

### Windows interrupted browser enrollment recovery (2026-11-06 UTC)

Enrollment now checks for known Scheduler and Chrome namespace collisions
before reserving the machine-wide name, then rechecks after reservation.
After all sealed bridge assets are ready, it records `enrollment.pending`
before publishing any OS endpoints. Only verified task and registry
readback can advance it to `enrolled.json`. The final rename shares the
local revoke lock; revocation that wins that lock preserves pending and
prevents publication. Browser wake, Connect, and Pause still require a
committed enrollment.

Only the explicit elevated, revoked teardown can use a lone matching
pending marker, with the existing origin-bound reservation and exact
artifact checks. It does not delete an ambiguous empty Scheduler folder
from pending enrollment or an incomplete registry leaf without the exact
manifest value. Failure before bridge preparation, collision, or ambiguous
ownership stays for manual reconciliation. No product task, registry
entry, browser session or tunnel was started to run these tests.

Final external stager SHA-256:
`229e1d5fec7c5a93c9a4c58901beaa5041ee3fbd47b5ec71cef5c71c8fb43fb0`.
Its Plan reverified the existing ZIP. Windows regressions exercise the
exact pending marker on NTFS, reject it for wake, reject a different
digest, give revoke priority over commit, and refuse an ambiguous empty
folder. The staged ZIP and the unpacked Chrome preview remain unchanged.
The exact owner-loaded Chrome test ID and live browser/hosted acceptance
are still outstanding.

### Windows preview identity and live enrollment diagnosis (2026-11-06)

The owner supplied the Chrome details and extension ID
`dcahjbghpncachlghgemfgpeggibgmbd` for the 2.2.0 Windows preview,
distinct from the Store extension. All 236 unpacked files were independently
matched to the preview ZIP. The initial elevated attempt prepared the
local owner grant but stopped in enrollment preflight while the device
remained paused. Registry and Scheduler publication had not begun.

The failure was reproduced on Windows PowerShell 5.1: the cryptographic
provider rejects a one-shot hash on the SHA-256 instance after streaming
bundle verification finalizes it. The stager now hashes its sealed source
snapshot with a fresh SHA-256 instance and preserves the hash mismatch
refusal. The focused Windows test, including the finalized-hash fixture,
and the pinned ZIP/stager Plan passed. The revised stager SHA-256 is
`387280871c5f384c682cc953a13fddefa7b4721c5d972a4219dae3253f9f5cf7`.

The intermediate diagnostic receipt confirmed `browser_hash_refused`
before publication. With the corrected stager, the exact paused enrollment
finished with `phase=complete`, `registered=true`, and
`tunnelStarted=false`. Independent OS readback confirmed the matching
committed marker (no pending marker), the single exact preview origin in
the HKLM Chrome host manifest, and the protected stager hash. The enabled
Scheduler task has the selected interactive SID, HighestAvailable,
one fixed command action, no triggers, and no active instances. This was
test-candidate registration only; the Store extension was not modified.

Next: use the owner-loaded preview to grant its optional local native
messaging permission and run Check administrator status while the test
tunnel remains paused. A valid unobserved response proves the browser
round trip, not runtime readiness, hosted command execution, or recovery.

### Live Chrome administrator status and scheduler priority (2026-11-06)

The owner-loaded 2.2.0 preview showed its optional browser permission as
Granted. Its Check administrator status action returned "Local runtime
readiness was not observed." The separate, upper device bridge status
remained Unknown; it checks the general device bridge, not the administrator
host. This proves a valid response from the installed administrator
bridge, not that the runtime was ready. The test tunnel was not started and
the browser restore option was not changed.

The same preview's affected Dot scheduler was running with Extension
Priority off. It was paused, the explicit text-overwrite option was
enabled, and the existing prompt configuration was rebound to the same
Dot target with the 20-minute interval preserved. The immediate-send
option was disabled for this start. The running UI showed the option
checked and the first-check countdown; no real scheduled send was
observed during setup. Browser administrator acceptance and scheduler
delivery remain separate.

The scheduler source used for the focused tests matched the unpacked
preview after line-ending normalization. Background state passed 34/34,
the Dot adapter passed 42/42, and isolated Chromium MV3 passed 12/12
after the fixture located the renamed Windows setup link. The MV3
priority case checked a single submission of the configured payload
after replacing unsent text. It did not submit a real hosted message.

### Scheduler reauthorization and ordinary-chat proof preparation (2026-11-06)

The live preview showed an unconfirmed cycle. The active Dot page contained
repeated configured text, but there was no per-cycle correlation; this is
neither a count of failed sends nor a reason to replay a submission.

The opt-in scheduler now tolerates one additional text change during
reauthorization, with a bounded refill and a new authorization check before
one dispatch. Dot receipt matching snapshots history immediately before
dispatch and can confirm a keyed matching message after the old history
tail even when another user message follows it. Older history and cloned
rows cannot supply that receipt. Regressions reproduced the missed receipt
before the change; safety checks (66 background and 25 adapter), Dot
Chromium (44), and MV3 Chromium (12) passed afterward. These changes were
not loaded into the owner's Chrome preview.

The ordinary ChatGPT test chat was re-opened in the in-app browser. Its
historical exact-command attempt showed an authorization refusal. Do not
reuse that operation. The plan generator now accepts `chatgpt` or `dot`
for an isolated one-step proof; no argument preserves the two-step plan.
Single-surface and default manifests were generated and checked byte for
byte against their reported hashes. The first new live test should allow
only the ordinary-chat child-token and disposable marker proof. It still
needs the exact one-time web approval while the guarded endpoint is ready;
the new plan was not submitted or started in this turn.

### Ordinary ChatGPT live administrator proof (2026-11-06)

The owner requested batch acceptance and explicitly authorized interaction
with the approval card. A new two-surface guarded window
(`4ee61dee7abb583c91ae1b8437df6da8`) verified 24,320 protected files and
reached readiness on the dedicated official tunnel. The ordinary ChatGPT
test chat used the private acceptance app and the current call was approved
without a persistent grant. This was not a replay of the refused request.

The browser's random `AC_ADMIN` marker matched the independently read local
proof. Guarded admission, provider reply, exact result, selected account,
provider PID and provider-reported completion all matched. The exact command
checks Administrator role and High integrity before creating and reading its
disposable file. It does not independently read the token elevation bit or
the final process exit code, or exercise termination of a live elevated
process. The Dot page did not expose a separate test conversation in the
observed controls; no command was sent to the user's existing Dot. Its
admission and reply receipts were both absent.

The explicit stop and independent terminal readback confirmed pause,
controller release, zero candidate tunnel clients, and no registration change.
The full `npm test` suite passed; 14 targeted native/intent tests passed and
one fixture needing a separate disposable extracted bundle was skipped. The
real Chromium native-host reopen check is fixture-level, not recovery of the
hosted administrator endpoint. The live browser-managed owner, hosted elevated
process control, Dot administrator proof and live recovery/revocation remain
release gates. No production connection, active Dot task or release changed.

### Browser-managed launch failure and demand fix (2026-11-06)

The exact installed e8a56275 test candidate was enrolled, authorized, and
paused. Its dedicated tunnel and exact preview origin were independently
matched. An explicit Connect saved running intent and requested the real
Scheduler task. The task returned exit 2, with no Ready or owner lease.
The identical clean-environment launch outside Scheduler reported
`phase=identity` and never started the tunnel. The prepared ChatGPT request
was not sent and its test draft was removed. A protected pause and readback
confirmed persisted pause, no lease and zero candidate tunnel clients.

An elevated Windows PowerShell 5.1 A/B replay of the exact protected
identity functions found `browser_integrity` without `PATHEXT`; with only
`PATHEXT=.EXE` added, the same SID, role, session and integrity checks passed.
The native demand launcher now sets that fixed value without importing the
caller's environment. The actual PowerShell `whoami /user` regression failed
before the patch and passed after it. The four targeted Node suites passed
22/22, including local owner pause/revoke and a Chromium bridge fixture.
These are not hosted elevated process or browser-managed recovery receipts.

The corrected Windows candidate is `dist/agent-continue-windows-admin-x64-demand-pathext-candidate.zip`
(`928f47d906e2d0c344aff11f038fc48a5c4f8aabfad5a96bb4331ca5c4fb4c1b`).
Its 24,325 members passed the exact archive Plan and per-member comparison
with the pinned predecessor; only `app/windows-admin-demand.mjs` changed.
An elevated side-by-side Stage completed with `protectedFilesVerified=true`.
The installed demand module independently matched the source hash; no new
state, credential binding, browser registration, activation or tunnel was
created. The old browser enrollment is unchanged and remains paused.
Do not patch the installed version in place. A ready status after Chrome
reopen can report the old live Job, so it cannot by itself pass recovery.

For the separate scheduler-only 2.2.1 candidate, the prior broadened receipt
search falsely confirmed a same-text row from another client. Real Chromium
reproduced the false confirmation. The revised adapter snapshots the message
baseline immediately before dispatch and leaves a buried same-text row
unconfirmed. Bounded opt-in refills still work. The clean main-derived build
passed the full npm suite (Dot 45/45, MV3 10/10) and six package tests. The
GitHub and Store ZIPs have 232 identical payload members after path-prefix
normalization, with no Windows preview or added permission. Not published.

### Paused Windows preview cutover (2026-11-06)

The replacement digest `928f47d9` passed protected state preparation,
the selected user's local elevated PowerShell child probe, dedicated hosted
binding and local owner authorization. This preparation did not start the
tunnel or publish browser registration.

The cutover checked both candidates paused, zero candidate processes or
ownership leases, an idle exact old scheduled task, and no pending old
provider admissions. It retained the old sealed deny marker, removed only
the old preview's registration and scheduled task, then enrolled the new
digest in the same exact unpacked preview origin. Readback verified the
protected archive and stager hashes, matching commit and reservation,
Chrome HKLM64 registration without a user shadow, one demand-only
interactive highest-available task, and persisted pause. No Store or
production registration was changed. The old digest cannot be re-enabled
in place; do not rerun migration or clear its deny marker.

From the ordinary Windows user token, the installed native host returned
`unobserved`, accepted a test wake request, and returned `unobserved`
again. Independent Task Scheduler readback showed a new invocation with
exit 0 and no remaining task instance. The wake was a native protocol
probe, not a Chrome reopen, not a tool call, and not proof of tunnel
readiness. The focused run passed 19/19 tests including real Chromium
fixture reopen, clean Windows demand, and managed process identity gates.

### Scheduler 2.2.1 composer re-render regression (2026-11-06)

A synthetic ordinary-ChatGPT fixture replaced the current Send control
while the final authorization response was pending. The old Auto path
returned unknown without submitting, and the old Button path blocked.
The adapter now resolves Send within the same verified composer immediately
before dispatch. It never falls back after an attempted dispatch, and
explicit keyboard, pause, attachment, and conversation routing remain
separate. Both new synthetic and real Chromium cases confirmed exactly
one configured message. The full scheduler suite, the expanded Chromium
adapter suite (15/15), and six package tests passed. Both regenerated ZIPs
contain the same 232 member bytes after prefix normalization, and their
adapter matches the source after standard LF normalization. No upload,
release tag or Store review was performed.

### Browser-managed provider startup and path regression (2026-11-06)

An explicit Connect on registered preview `928f47d9` saved running intent
and requested the real scheduled task. It reached the Windows owner Job,
unlike the earlier pre-owner failure, but did not publish a Ready
generation. The tunnel log reports a local stdio provider `exit status 1`;
no new tool request was submitted and no provider-operation journal was
created. The broker's terminal receipt verified root exit code 1 and Job
drain, but not inner lease release. Pause was persisted and an elevated
process metadata readback found zero executables from the candidate. The
owner, controller and operation leases remain as evidence and fail-closed
fences. Do not remove them, reconnect, or attempt another enrollment on
the assumption that a missing PID proves a settled operation.

The sealed profile spells Windows argv paths with forward slashes. The
administrator admission had required an exact native-spelled path before
checking the grant, so the valid provider state was rejected. A Windows
regression reproduced this refusal. The source fix translates separators
only at provider admission and preserves absolute-drive, canonical path,
identity, pinned grant, lifecycle and revocation checks. The new tests
admit the exact forward-slash path, reject traversal, mixed separators and
UNC, and prove a deny marker still wins. Focused Windows owner, demand,
intent and managed-process tests passed 27/27. The installed bundle was
not modified or rerun with this patch. The log lacks a detailed provider
error, so treat the path failure as a reproduced defect, not proof that
it is the only remaining live failure.

Before another live run, implement and exercise protected failed-generation
reconciliation with terminal receipt, exact file identity and operation
journal checks. Then test provider initialization from the exact packaged
profile without production access, and repeat ordinary ChatGPT before Dot.
Neither hosted process control nor browser reopen recovery is accepted.

### Windows failed-owner inspection and packaged provider A/B (2026-11-06)

The failed browser preview `928f47d9` remained paused. Its exact outer lease
and terminal receipt bound the digest and generation to a nonzero observed
root exit, a drained Job, and no Ready observation. The two inner leases
and the header-only device journal are current protected observations, not
historically attested to the generation by the legacy terminal receipt.
No provider-operation journal was found. The inspection held the six
files exclusively, rejected reparse points and hard links, and did not
revoke, retire, reconnect, or clear any lease. Compiler scratch is outside
the failed bundle's state and vault.

The retirement path requires separate sealed revocation. Before removing
any endpoint, it writes a protected intent bound to the digest, SID, and
failed generation. An interrupted retry may accept an empty or missing
task folder only with that exact intent and no remaining host registration.
The simulated interruption between task deletion and folder deletion passed;
the unbound empty-folder case refused. Windows PowerShell 5.1 enrollment
and evidence tests also passed, including wrong generation, active handle,
unexpected Ready observation, operation history and hard-link refusal.
Live retirement is not yet exercised.

The replacement ZIP
`agent-continue-windows-admin-x64-provider-path-candidate.zip`, SHA-256
`1c42e8b5c7f4fff4cddc7690ac5dda2006910bc706c3c1504f0cbd39b898f641`,
passed Plan and a real Windows protected stage (24,325 files). Its
packaged provider passed the isolated, high-integrity stdio handshake with
the exact slash-form owner command: `desktop-commander` 0.3.1, MCP
`2025-11-25`, exit 0 after closing stdin. The old `928f47d9` ZIP failed the
same fixture at initialize (exit 1). The fixture materialized no tunnel
client, created no key, and issued no tool request. This proves the
packaged startup regression, not a successful hosted connection or
browser-managed administrator command. No GitHub Release or Store
submission was performed.

The current recovery stager also passed a fresh inspection of the actual
`928f47d9` enrollment. The replacement's protected state and clean
launch plan were read back separately: `paused:true`, no browser
registration, no tunnel, and no hosted binding at that checkpoint.

`BindHosted` operation `4ea4735f540d456191385969a154fd4e` then completed
with a protected matching start/result pair, an administrator child,
and verified hosted binding and launch plan. The replacement remained
paused and unregistered with no tunnel or owner grant at that checkpoint.
The old digest was then revoked and retired. A separate readback found no
matching native host registry entry in either registry view or hive, no
task folder, no global reservation, zero candidate processes, and the
revocation marker present. The six original evidence files had identical
SHA-256 values before and after. Do not replay binding or retirement.

The replacement was then authorized and enrolled against the exact
preview extension origin. Independent readback matched the new native
manifest, sole permitted Chrome origin, protected enrollment commit and
single enabled demand task. It found zero running instances, persistent
pause, no owner Job lease and the old deny marker still present. No
tunnel started and no hosted tools were invoked. Next: one explicit
preview Connect, a fresh Ready generation, ordinary ChatGPT and then Dot
command/file/process receipts, and reopen/pause/revocation checks.

### First live Ready and protected pause on 1c42e8b5 (2026-11-06)

One explicit Connect via the registered candidate's protected action
saved running intent and dispatched the real demand task. A fresh,
verified `ready` observation named generation
`fce5367c3a14450c9cba233c84a98017`, with one running task instance.
This was not a Chrome reopen or an extension-button test. The dedicated
private app also returned `not-recorded` from the hosted read-only
operation-status tool for the new test UUID.

The ordinary ChatGPT acceptance chat displayed a one-time approval
card for the fixed PowerShell token/file/process probe
(`d53ca6b5-3572-4d90-81d9-7f47f144bcab`). The approval was not granted.
The exact local admission file and proof marker were absent. Do not
count that request as execution or reuse it without checking the original
approval and exact receipt. The direct hosted status read is not a tool
execution from ordinary ChatGPT or Dot.

The test endpoint was paused using its protected action while waiting.
The same generation's terminal record showed observed root exit 0,
Job drain and inner leases clear; independent readback found the outer
lease absent, persisted pause, zero scheduled task instances, and zero
candidate processes. This proves live connection and deliberate pause
for the isolated candidate, not hosted administrator command, standalone
file or process-tool control, automatic reopen, or live revocation.
No production connection or release was changed.

After the verified pause, an actual Scheduler demand invocation exited 0
with persisted pause unchanged, no new terminal generation, no owner
lease and zero candidate processes. This is a demand-task negative test,
not a Chrome reopen test.

The separate source fix for a post-Ready transport exit keeps the owner
alive for disposal and releases its own leases only after positive
captured-process exit evidence. It never retries, writes running intent,
or clears an unknown lease. Windows Node 22.23.4 passed 86/86 owner,
lifecycle and device-operation tests, including last-handle exit,
unknown exit, failed health stop, and concurrent Pause/Revoke. The
installed candidate was not modified; live browser recovery is still
unverified.

Offline recovery candidate
`agent-continue-windows-admin-x64-terminal-cleanup-candidate.zip`
passed Plan: SHA-256
`849fc3eda6de09411e1e705e554679f0896d02023bdd54e0571c5e6609b96505`.
Independent comparison of all 24,325 members against `1c42e8b5` found
only the owner module and generated build evidence changed. See the next
checkpoint for its subsequent protected stage.

The independent scheduler safety suite passed 34/34 initial background,
32/32 background v2, 27/27 adapter and the release source guards.
The suite checks extension-priority refills, a replaced Send button,
pause, attachments, identity, and unknown-result behavior. These tests
are not a new Chrome Web Store submission or a live Dot send receipt.

### Protected recovery staging and native Job regression (2026-11-07 UTC)

Candidate `849fc3ed` passed a real Windows protected stage: 24,325 files
verified, installed owner hash matched, and no state, hosted binding, or
browser registration was created for this candidate. It was not activated.
The stage preflight independently read back the existing `1c42e8b5`
registration, one idle demand task, persisted pause, no owner lease,
and no admission for the pending ChatGPT operation. The same approval card
was still pending in the acceptance chat; it was not approved or replayed.

The Windows PowerShell 5.1 bundle suite passed a new disposable regression
using the real owner, process identity checks, and Windows Job broker,
with a loopback-only simulated transport. After the broker observed Ready,
the fixture's provider and launcher exited. The owner exited naturally;
the protected terminal receipt showed exit 0, Job drain, and inner
leases clear. The outer lease was also gone. A second explicit broker
invocation using unchanged saved running intent yielded a distinct Ready
generation and process identity; both runs left the historical operation
journal unchanged. With saved pause the broker did not create the owner.
The separate native Job suite passed revoke, root-exit, and broker-loss
containment while leaving an unrelated process alive.

This verifies post-Ready cleanup and relaunch at the Windows broker boundary,
not a Chrome reopen, automatic hosted reconnection, or a command from either
web surface. The next live acceptance still requires a fresh Ready generation,
the exact ordinary ChatGPT approval and matching protected receipt, then Dot,
real Chrome reopen, and live revocation. No production endpoint changed and
no release or Store submission was made.

### Protected recovery child and separate browser controls (2026-11-07 UTC)

For the already staged `849fc3ed` ZIP, the pinned Windows PowerShell 5.1
stager ran `PrepareState` and then `ProbeLocal` under the selected
administrator account. Both reverified the 24,325 installed files,
the fresh paused state, and the clean launch plan. The second action also
verified the real local administrator command child. Independent wrapper
readback found no hosted vault, browser registration or owner-status
directory for this candidate; no binding or tunnel was started. This is
local installed-child evidence, not a web command or a Chrome wake.

The Devices UI now identifies standard MCP status, pause and reconnect
separately from administrator readiness and restore preference. A Chromium
page fixture shows that a settled standard pause leaves the independently
reported administrator Ready observation unchanged. The native administrator
bridge is still wake/status only; do not treat the standard pause or
Chrome permission removal as revocation of the administrator endpoint.
The device suite passed 62/62 unit/source checks and 17/17 page checks.
The seven administrator-bridge checks also passed, including a real Chromium
reopen against a disposable non-elevating native host with synthetic readiness.

The unpublished, unpacked browser preview is
`dist/windows-20261107-bridge-scope-preview/agent-continue-2.2.0-windows-device-preview.zip`
(236 entries, SHA-256
`a5a002351e87fb92161fd483f048cbb5de5470c02e388daf8206879e20cb52c5`).
The archive's Devices files match the worktree after the documented LF
normalization; permissions, website injection and external connectivity
declarations match the installed preview manifest. This ZIP was not installed.
The original ordinary ChatGPT approval was rechecked and remains pending.

### Administrator Pause operation receipts (2026-11-07 UTC)

The protected stager can now bind local Pause to a caller-provided operation
ID. It reserves the ID before saving intent; a duplicate is readback only.
The sealed owner-readable view distinguishes no verified receipt,
pause-recorded, and stopped. For an active Job, the broker only publishes
stopped after observing the matching generation drain, recording its terminal
evidence, and releasing its lease. The no-owner case is checked under the
control guard. Receipts describe that operation, not current readiness.

The Windows bundle fixture covered idle Pause, duplicate after a newer
running revision, interrupted reservation, tampered or foreign receipts, and
a real disposable Windows Job with a root, child, and grandchild. An active
Job returned pause-recorded; stopped required observed root exit, Job drain,
all test processes gone, and the exact generation's receipt. A different
generation could not complete the operation. The Devices page and Windows
Chromium native messaging fixture covered exact-ID lookup, mismatched
response refusal, scope separation, and no mutation on lookup. Chromium
used synthetic receipts; it did not control the enrolled endpoint.

The rebuilt, uninstalled browser preview is
`dist/windows-20261107-pause-receipt-preview/agent-continue-2.2.0-windows-device-preview.zip`
(236 entries, SHA-256
`c862f942f33a221f82fcfa71de5f670991e1cac188d325bb0aaf384caa0b59a8`).
The manifest and member names are byte-identical to the previous preview;
the four packaged browser sources match the tested worktree. No change to
installed bundles, hosted grants, live approval, or public release. The
Devices page can read a local Pause receipt but does not request UAC or
start Pause; that browser action and the live hosted acceptance remain open.

### Browser-requested administrator Pause candidate (2026-11-07 UTC)

The Devices preview now has a separate, explicitly confirmed administrator
Pause action. The worker verifies native support before recording an ID. A
lost response, worker restart, or second Devices tab cannot resend that ID;
readback distinguishes Windows cancellation, launch requested, durable pause,
and verified historical shutdown. An unresolved operation is not cleared
automatically. Standard MCP and prompt schedules are not controlled by it.

The local broker checks the real ordinary interactive token, exact active
registry binding, protected paths/ACLs, and sealed archive/stager hashes.
It uses only the fixed native PowerShell `runas` action; no general-purpose
elevation, browser permission expansion or Scheduler action was added. A
real token witness first returned Windows error 122 for `TokenElevation`
with the oversized buffer argument. With the exact four-byte argument and a
size-probed integrity buffer, the same Windows 5.1 witness passed. Independent
review also exposed a Job teardown race. The regression held the control
guard while observing the real Job terminal evidence: the old stager removed
the lease early. The corrected stager keeps the lease until it owns the
control guard, then releases it and publishes the matching receipt under
that same guard.

Verified: 88 Windows bundle checks, 5 enrollment checks, 19 Node 22.23.4
bridge/native checks including actual Windows Chromium restart and an
unsealed-stager refusal, and 62 device unit/source plus 23 Chromium UI checks.
The administrator ZIP also passed the offline real provider smoke and prepared
ordinary-child file/command/process test. That smoke observed no network
attempt and did not verify an administrator child or a hosted connection.

All three uninstalled artifacts are under
`dist/windows-20261107-browser-pause-preview/`:

- `agent-continue-2.2.0-windows-device-preview.zip`: 236 members, manifest and
  member list unchanged from the prior preview; SHA-256
  `a172b40918f94f12630143d305cf4fed66ffdd2d6f7c2ee7e1be051c4d2cc775`.
- `agent-continue-windows-admin-x64-browser-pause-candidate.zip`: 24,325
  files, official Node 22.23.4, tunnel client v0.0.19 and provider 0.3.1;
  SHA-256 `5bd96749cb3ce53d5e6f4dab08433c6ee2b05871f677f86e72ca4d9cf73e5649`.
- `Stage-WindowsAdministratorBundle.ps1`: exact tested source copy;
  SHA-256 `6afb879d8f10bd9ad1958305018095c4e309e65cc2add58ac6556c5df86082ef`.
  This exact copy returned a read-only `Plan` success for the administrator ZIP.

No UAC prompt was opened, no protected staging, binding or Chrome registration
was changed, and no hosted operation was reissued. Two review findings remain
release-blocking: a lost request needs a protected reconciliation path, and
delayed Windows approval must be rejected if the protected control revision or
target generation changed. After closing both, verify real UAC cancellation
and approved drain, manual pause on Chrome reopen and revocation; then correlate
ordinary ChatGPT and Dot administrator file, shell and process results with
local protected receipts.

### Browser Pause target and reconciliation (2026-11-07 UTC)

The browser Pause now forwards the exact target captured at preflight. The
elevated child rechecks the active registration and compares the control
revision and generation under the protected owner guard. An older request
records `superseded` without changing intent. An actual Job start advances the
control revision, including a start between two idle observations. A stale
rejection refreshes the projection; enrollment requires the initial projection
to read back before commit. The fixed local repair can restore missing
readback without changing the connection.

The Devices page can explicitly reconcile its latest unconfirmed ID using
a separate native Windows authorization. The fence is recorded under the
same guard and prevents subsequent execution of that ID. It neither changes
pause intent nor asserts that an earlier execution did not happen. New
reservations are flushed before atomic publication; sealed legacy partial
reservations still block replay and can be fenced. A verified `pause-recorded`
already consumes its ID and permits another explicitly confirmed Pause
without asserting the earlier Job stopped.

Verified: 94 Windows PowerShell 5.1 checks, 27 pinned Node 22.23.4 bridge
checks (including disposable Windows Chromium tabs and reopen), and the
full extension test command. Devices passed 62 unit/source and 32 isolated
page checks. The final administrator archive passed read-only Plan and an
offline extracted-provider smoke, including ordinary file and process effects
and rejection of an ordinary token as administrator. The preview manifest and
236 member names match the previous preview; the packaged browser sources
and administrator native host match the tested source.

Candidate artifacts, under `dist/windows-20261107-pause-fence-preview/`:

- Browser ZIP: `155c125a58e47264c4da1eabd6e1b903ffc47624c4e32471f65993ad8e9db7cf`.
- Administrator ZIP (24,325 entries):
  `f443794ab9313de579450c65dbbd6e21172e7ccf861accfc134bf253d0eb6eae`.
- Companion stager: `cf042ce65f5c10411e18c5d93998e27c97c84b15d696043475b9573d55fcc416`.

No UAC prompt, staging, enrollment, binding, real web approval, or release
was performed. Actual Windows consent and cancelled/approved outcomes in an
enrolled Chrome profile, browser-driven Job shutdown/recovery/revocation,
and matched hosted administrator file, shell and process receipts from
ordinary ChatGPT and Dot remain separate gates. Do not replay the pending
ordinary ChatGPT test operation.

### Live cutover preflight for the pause-fence candidate (2026-11-07 UTC)

`Invoke-WindowsAdministratorAcceptance.ps1 -Action Inspect` verifies both
artifact pins before reading the caller token, the digest-specific first-stage
paths, and the four Chrome native host registry views. It does not request
UAC or verify the old owner's intent. An unreadable view is unknown; an
existing registration is not a health signal. The sealed stager's own
`Plan` remains the separate archive-layout check.

On the owner Windows machine the three published-in-this-log candidate
hashes matched. `Inspect` reported `callerElevated=false`,
`candidateFootprint=not-observed`, and
`browserRegistration=other-or-conflicting-registration`. Independent
readback confirmed the sole HKLM 64-bit binding is the older `1c42e8b5`
test owner for the preview extension, with its demand task Ready (not
Running). The older browser status projection read `unobserved`; the
authoritative protected intent was not readable from this token. The IAB
still showed the earlier ordinary ChatGPT one-time approval pending. It
was not approved, replayed, or treated as the new candidate's result.

The exact companion stager returned read-only Plan success for all
24,325 archive members with no installation, activation, registration,
or tunnel change. Five Windows PowerShell 5.1 launcher tests passed.
Next: use a real elevated selected-account Windows session for local
acceptance of the new digest (stage, paused state, actual command-child
token). Do not switch the singleton native registration until the old
test owner and pending web request have been reconciled independently.

### Hosted command-child token witness v2 (2026-11-07 UTC)

The fresh exact probe queries Windows `TokenElevation` and
`TokenIntegrityLevel` in the command child, rejects impersonation, and
requires an enabled Administrators role. Only a High-integrity elevated
child can write the versioned proof with a new random marker. The protected
reader requires the selected SID and correlates the proof PID with the
provider response; earlier receipt formats cannot pass the elevation field.
Final process exit and managed stop still require separate evidence.

Three local tests passed, including the pinned Desktop Commander 0.3.1
provider over stdio with zero network/browser attempts. On this Windows
machine a standard child completed the token query, returned
`AC_ADMIN_PROBE_REQUIRES_ELEVATION`, and did not create a proof. The same
operation ID was rejected on replay. Reader regressions reject a changed
SID, missing elevation bit and Medium integrity. No elevated or hosted
positive result was exercised in this checkpoint; the harness and CI
changed, not the candidate packages or the installed registration. Live
`Inspect` still reports a standard caller, no observed first-stage
footprint for `f443794a`, and another Chrome registration.

### Scheduler composer and history guards on main (2026-11-07 UTC)

Independent review found two real races in the scheduler candidate: a
relocated editor could leave the old Send clickable, and a previously
seen same-text row could disappear during preparation and reappear as a
false receipt. Chromium regressions reproduced both before the fix. The
adapter now checks that the same unique editor still belongs to the same
composer before editing or submitting; it retains message identities
from both before preparation and immediately before dispatch.

The independent scheduler worktree passed the full `npm test` command:
16 ordinary composer cases, 46 Dot adapter cases, and 10 MV3 integration
cases among the passing suites. Both regenerated 2.2.1 ZIPs reproducibly
contain the same 232 members after removing the GitHub root prefix. No
new permission, device runtime, or user activity was included.

- GitHub-layout candidate SHA-256:
  `7d46a3cf0341881f44eb13f8a3437a7711b71a4fca90b7d90d91b1bc60953715`.
- Store-layout candidate SHA-256:
  `8669744f64fcef84dcb8c31dfe2d125916d2776c96109719210e7f20194ccafd`.

Source-only commit `80a14cc9369c053a9d5968e5d7686cc1b65fc1e3`
was independently read back from GitHub `refs/heads/main`. Only the five
scheduler and test paths changed. No tag, Release, or Store review was
submitted, and these fixture results do not assert a send in an owner's
signed-in chat. No administrator state or old web approval changed.

### Administrator Pause/Revoke admission recheck (2026-11-07 UTC)

Previously the protected provider checked admission before the synchronous
operation-ID reservation. If Pause or Revoke became durable while the receipt
was being written, the transport could still hand the request to the SDK.
The provider now rechecks local control after that work, before handoff.
On denial it returns `-32075`; an existing operation reservation is settled
as `blocked-by-local-control` when possible, never released for replay. Local
acceptance readback distinguishes this from an unknown or provider result.
After Pause or Revoke, use protected local evidence rather than assuming the
remote receipt tool is still admitted.

This is a transport admission boundary, not an atomic cancellation of a
request already handed to the SDK. SDK-queued work, OS Job shutdown, and the
effect of an already admitted command remain separate observations.
Windows regression tests first reproduced both failures and then verified
no dispatch and durable readback. The source run passed 25 owner, stdio and
command-token cases plus 17 hosted-readback cases.

The new uninstalled administrator archive is
`dist/windows-20261107-admission-recheck/agent-continue-windows-admin-x64-admission-recheck-candidate.zip`,
SHA-256 `1e82aa017c72dfbbc56c29292b94e958a672ed59bbe9de6db952148762302f4f`.
The exact companion stager in that directory remains
`cf042ce65f5c10411e18c5d93998e27c97c84b15d696043475b9573d55fcc416`.
Reuse the prior browser preview `155c125a58e47264c4da1eabd6e1b903ffc47624c4e32471f65993ad8e9db7cf`
under `dist/windows-20261107-pause-fence-preview/`. Across 24,325 ZIP entries
only the host, operation receipt module and build evidence bytes differ from
`f443794a`. Read-only Plan and extracted-bundle Windows smoke passed with
Node 22.23.4 and the real pinned provider, including guarded exact file and
PowerShell calls under an ordinary token, no network attempts and no tunnel.

Live Inspect still reported a standard caller, no new candidate footprint,
and the existing other Chrome registration. The next local acceptance uses
this new digest, the matching stager, and a real elevated selected-account
session. No UAC, installation, enrollment, live remote invocation or release
occurred. Leave the old web approval alone.

### Administrator SDK handler admission and cancellation (2026-11-07 UTC)

The previous check ended at transport handoff. The pinned MCP SDK 1.32.2
queues the registered tool handler after that handoff. The protected
administrator host now checks durable Pause/Revoke again just before entry
to that handler, and matches the actual queued request object rather than
letting a reused RPC ID confer admission. A denied reserved call is recorded
as `blocked-by-local-control` when possible. Malformed and unmatched
cancellation notifications cannot free a live RPC slot or affect a later
request; a valid cancellation aborts only the matched controller.

Six pinned SDK regressions cover Pause, Revoke, already-entered handler
completion, valid cancellation with reused numeric RPC ID 0, malformed
cancellation, and cancellation preceding a later request. All 52 targeted
source tests passed. This is not an atomic cutoff for Windows effects
once a handler starts. Stdout backpressure and sequential wire-ID reuse
remain a separate availability test; the exact-process digest checks
provider inputs and is not proof of the final child token or command effect.

The next local acceptance archive is
`dist/windows-20261107-handler-fence/agent-continue-windows-admin-x64-handler-fence-final.zip`,
SHA-256 `245adc3e9fffcf6d4c004dfee9016198c82c450780105ca15b45416194d227d1`.
Its companion `Stage-WindowsAdministratorBundle.ps1` is pinned to
`cf042ce65f5c10411e18c5d93998e27c97c84b15d696043475b9573d55fcc416`.
Keep the same browser preview
`155c125a58e47264c4da1eabd6e1b903ffc47624c4e32471f65993ad8e9db7cf`.
The ZIP passed Plan, and member verification against `1e82aa01` confirmed
24,325 entries in both archives, with only `app/host.mjs` and build evidence
changed. The packaged host matches the current source. The extracted ZIP
passed the pinned provider smoke with file write/read, a harmless PowerShell
command, managed process lifecycle and replay denials. The ordinary token
was observed and correctly rejected as administrator. No tunnel started.

Live read-only Inspect reported a non-elevated caller, no observed footprint
for the new digest, and another Chrome registration. HKLM readback matches
the earlier `1c42e8b5` preview. Next run only `AcceptLocal` for
`245adc3e`, with the verified companion stager and the independently
confirmed selected account SID, in a genuinely elevated Windows PowerShell
session. Use consent value `accept-administrator-first-local-acceptance`.
This step does not register the browser or start the tunnel. After positive
child-token readback, use a dedicated browser binding and verify ordinary
ChatGPT first, then Dot, for file, command, owned process lifecycle and
reopen/pause/revoke. Leave the previous pending web operation alone; if its
outcome must be recovered, read its durable receipt before taking action.
No protected staging, UAC, enrollment, hosted operation or release occurred
in this checkpoint.

### Sequential Windows tool requests under stdout backpressure (2026-11-07 UTC)

With the real pinned SDK and a held Writable callback, a reply was already
visible before its stream-wide drain promise settled. A subsequent request
reusing the same wire ID was silently dropped. Releasing the ID alone
exposed a second failure in standard mode: a cancellation queued ahead of
the successor could suppress the successor's reply.

Both runtime modes now match cancellation synchronously to the current
registered request and release a reply's wire slot after the synchronous
enqueue, not after stream drain. The 4,096 admission budget still includes
outstanding replies. An overlapping duplicate does not enter; an admitted
request retains its durable receipt if delivery is uncertain. A cancellation
that arrives after a successor is already admitted and uses the identical
wire ID has no separate identity in this protocol. This change does not
equate a queued response with delivery or a provider receipt with OS effects.

Both held-drain tests first exposed the failure and now verify successor
handler entry, reply, independent receipt, and retention of the successor's
controller when the old reply drains. The targeted Windows set passed
59 tests, including five native-launcher refusal/read-only tests.

New offline-verified acceptance bundle:
`dist/windows-20261107-stdio-reuse/agent-continue-windows-admin-x64-stdio-reuse-reviewed.zip`,
SHA-256 `b7c53d972dfe4c9bf67b506f44e8fb59c15923aa058f8d62bcf8a867f404f3c6`. Compared with `245adc3e`, only `app/host.mjs` and
`app/agent-continue-build-evidence.json` changed across 24,325 entries.
Plan and extracted-package smoke passed with the standard token, including
file, PowerShell and owned-process checks. This does not verify elevation,
a Chrome grant or a hosted invocation. The browser preview is unchanged.
Inspect found a non-elevated caller, no observed footprint for this digest
and the prior `1c42e8b5` registration.

From the repository root in the selected account's standard Windows
PowerShell, the following requests one native UAC confirmation when that
owner can respond. It does not attach a tunnel or change Chrome registration.
An already-elevated session should instead use the verified companion stager
with `AcceptLocal` and the independently verified SID, as described above.

```powershell
$archive = Join-Path (Get-Location).Path 'dist\windows-20261107-stdio-reuse\agent-continue-windows-admin-x64-stdio-reuse-reviewed.zip'
powershell.exe -NoLogo -NoProfile -NonInteractive -File scripts/Invoke-WindowsAdministratorAcceptance.ps1 -Action Start -Archive $archive -ExpectedSha256 'b7c53d972dfe4c9bf67b506f44e8fb59c15923aa058f8d62bcf8a867f404f3c6' -ExpectedStagerSha256 'cf042ce65f5c10411e18c5d93998e27c97c84b15d696043475b9573d55fcc416' -Consent 'accept-one-native-administrator-acceptance'
```

Only the verified selected-account administrator child advances the gate.
Preserve partial state after any unknown outcome and read it back before
choosing a recovery action. Next comes browser binding and real ordinary
ChatGPT followed by Dot. No UAC, installation, switch, hosted operation or
release occurred in this checkpoint.

### Version-pinned source installer candidate (2026-11-07 UTC)

The setup release builder previously copied a standalone PowerShell entry
whose default was `releases/latest/download`. Its generated entry now
records the extension manifest tag, before inner and outer checksums are
computed. The ZIP's copy and standalone copy are byte-identical. Default
selection of a versioned script no longer depends on the next latest
release. A raw source checkout remains unpinned and the documented explicit
payload override still wins; this is not an authenticity guarantee for
overridden sources or downloaded bytes.

The five pin/default regressions cover an exact byte-only stamp,
missing/repeated markers, invalid versions including script injection,
actual Windows PowerShell resolver results, and a stamped installer beside
an unchecked local payload. That last case first returned an unchecked
success and now refuses before Node execution. Unstamped development and
the explicit unverified override remain separate choices. Two extracted setup
delivery tests passed on Windows, including repeated-build byte equality,
inner/outer hashes, CLI/CMD checks and noninteractive consent refusals.
The create-only release workflow source test was updated to the new
non-overwriting publication path. Seven release-source checks also passed.

Local candidate `dist/setup-20261107-stamped-closure/agent-continue-setup.zip`
has SHA-256 `9db0e3f1acb2a8e31e7bb16edd8433762730fb19b97b6fa7d34523777d0330ff`.
Standalone `install.ps1` has SHA-256
`90c930b80a72d56e50fbd1604a37ae4061a51799ea5f7266aa6f150c1a41c561`.
This supersedes the earlier local pin-only archive `1991b444`.
Direct readback checked all 48 ZIP members against the outer list, the
two installer copies, absence of EXE/MSI and the actual packaged resolver
default `v2.2.0`. The resolver alone was evaluated, not the installation
body. The version follows this worktree's manifest; it is not permission
to overwrite the existing public 2.2.0 release.

The main validation did not execute installation or contact the network.
The read-only review worker disclosed an accidental failed request to the
reserved test hostname `invalid.example.test`: resolution failed and no
payload was downloaded or installed. Its remaining temporary tree
`agent-continue-7f06d892e6024caa9d830a470546a699` was observed to contain
one empty payload directory; cleanup was denied by tool policy and was not
retried through another mechanism. No production configuration changed.
The separate administrator acceptance candidate remains
`b7c53d97`; next verify selected-account native AcceptLocal, then ordinary
ChatGPT, Dot, browser reopen and local pause/revocation with actual receipts.

## Scheduler 2.2.1 Published and Assets Verified (2026-11-07 UTC)

Canonical main received `753d9da18a59fe206e78e7bfd8521e462c3043aa`
with 15 narrowly staged scheduler, test, version, documentation and release-guard
files. Every staged blob was compared with the tested scheduler tree before
commit. All pre-existing Windows/native work was preserved outside that commit.
Annotated tag `v2.2.1` was pushed once and resolves to this exact main commit.

Two independent focused reviews were completed. The first reproduced a false
receipt when the same historical row gained or changed its key; eight focused
VM cases first failed and then passed with the predicate fix. Two Chromium Dot
cases and one explicit conservative recycled-node case were added. The second
review found no confirmed blocker introduced by the scoped patch, while recording
the residual new-node/new-key history ambiguity, conservative false negatives,
and external tag-mutation risk. These are not solved by a passing local suite.

Fresh local full `npm test` passed, including 48 Dot adapter, 16 ordinary adapter,
12 Dot keyboard, 16 import, 15 UI, 10 MV3 and five official ProseMirror scenarios.
The final test-only addition passed the 36-case release-adapter suite. Seven
release-source/publication tests and six deterministic packaging tests passed.
All browser scenarios use synthetic content, not the signed-in user's Dot work.

GitHub run https://github.com/1235357/agent-continue/actions/runs/42333761693
completed successfully: canonical first-parent source verification, create-only
release guard tests, full headed Chromium suite, packaging, checksums, publication.
The in-app browser observed https://github.com/1235357/agent-continue/releases/tag/v2.2.1
as Latest, with commit `753d9da` and both ZIP assets plus SHA256SUMS.

The in-app download API timed out. Public assets were then downloaded from the
observed GitHub links without credentials and checked against published SHA256SUMS:

- `agent-continue-2.2.1.zip`:
  `ae703911e2e6ada552744cc5da408937d9ea1f65e26cd85489d0b7e4f8a6afbd`.
- `agent-continue-2.2.1-store.zip`:
  `f4ab606b8661d417cdb89be54c164f352774438d859627a4bcad2523ac7b9047`.

Both archives contain the same 232 payload files. All 44 project files match raw
tagged Git blobs exactly; all 188 PDF.js resource bytes match the tagged pinned
SOURCE manifest. The stable manifest remains activeTab/scripting/storage/alarms
with optional power and chatgpt.com host access. No nativeMessaging, device code,
custom EXE/MSI, runtime credentials or uploaded activity logs are in the assets.
The verified public downloads are under `dist/published-v2.2.1/`.

Store navigation in the in-app browser reached Google's "Verify it's you" for
the existing personal publisher account. No new Store package was uploaded,
review submitted or approval claimed. Successful GitHub release is not Store
publication or installed-browser acceptance. The release creates no local
service/task, does not reload the working extension, and does not change VPN,
production MCP, IDE, Process Lasso or research jobs.

A fresh Windows identity check still found selected user zye12 with a standard
token. Read-only pinned b7c53d97 Inspect returned callerElevated=false,
candidateFootprint=not-observed and other-or-conflicting-registration. It
requested no UAC, changed no registration and started no tunnel. The existing
pending web approval was not clicked or replayed. Native goal remains active.
The desktop goal-editor navigation did not verify the correct target chat;
no unrelated goal was edited. Latest checkpoint is preserved in the goal draft
and memory instead of falsely claiming a native objective-body mutation.

## Actual b7 Local Elevation and Slow-Verification Recovery (2026-11-07 UTC)

One `Invoke-WindowsAdministratorAcceptance.ps1 -Action Start` was executed for
the pinned b7c53d97 ZIP and cf042ce6 companion. The native worker started at
03:39:30 UTC. Copying 24,325 files took until approximately 03:43:02, followed by
sealed-file verification. The old launcher's 300,000 ms wait expired and returned
`outcome-unconfirmed`, not success. Persistent state appeared at 03:45:57 and
the exact observed worker PID 179632 was subsequently observed exited. Its exit
code was unavailable to the independent observer. Do not retrospectively label
that first acceptance successful or repeat its create-only action.

The launcher was changed without modifying the stager or ZIP pins:

- `Wait-AcceptanceChild` observes for 900,000 ms after native launch. A timeout,
  absent child or unavailable exit code remains unconfirmed; no kill or retry.
- `VerifyLocal` requires its own exact consent and a retained 32-hex receipt ID.
  The same-account native worker rechecks the stager bytes, selects `ProbeLocal`,
  and never selects `AcceptLocal` or recreates persistent installation/state.
- The pinned stager creates the protected started receipt before the new probe;
  same-ID collision refuses execution. `VerifyLocal` is a fresh diagnostic action,
  not an API for reading a previous unknown result. Keep the ID on uncertainty.
- Wrong consent, unexpected receipt parameters, source/archive hash mismatch,
  malformed receipt IDs, wrong SID and worker-size limits remain refusal paths.

The two new focused regressions failed before implementation and passed after it.
Seven launcher tests passed on Windows PowerShell 5.1, including both generated
worker modes refusing account mismatch and malformed probe identity. Wait tests
are mocks, not native elevation. An independent static review found no confirmed
material blocker in the scoped launcher and pinned ProbeLocal contract; it did
not execute installation or prove hosted behavior. Tests do not cover every
receipt-collision/publication failure. Actual candidate command length was
10,643 characters, within its 18,000-character bound.

The fresh native `VerifyLocal` then ran exactly once with receipt ID
`21c8f129ef484ea58ecd4a7830ca96f5`. Started receipt timestamp:
03:52:08.888 UTC; completed receipt timestamp: 03:55:43.828 UTC. The parent
observed its own native child complete and returned exit 0 with:

```json
{"status":"administrator-child-verified","uacRequested":true,"administratorChildVerified":true,"tunnelStarted":false,"registrationChanged":false,"probeReceiptId":"21c8f129ef484ea58ecd4a7830ca96f5"}
```

For this exact hash-checked stager path, success requires sealed bundle/state
verification, an actual PowerShell command-child token with selected SID,
enabled administrator role, elevation and High-integrity-range verification;
nonce/PID-bound output, exit-zero completion, provider shutdown, probe cleanup,
and post-probe state verification. Receipt publication failure cannot return
success. The protected started/result files were observed by metadata; their
private JSON contents were not read by the standard-token parent. This is a
new real local administrator proof, not a retroactive first-attempt receipt.

Unchanged ZIP SHA-256:
`b7c53d972dfe4c9bf67b506f44e8fb59c15923aa058f8d62bcf8a867f404f3c6`.
Unchanged stager:
`cf042ce65f5c10411e18c5d93998e27c97c84b15d696043475b9573d55fcc416`.
Updated launcher:
`98432b807f588262888b18ef9b6a65e95f5b9161f537c8a1c70b593764814a51`.

No new tunnel binding, browser enrollment, service/task, hosted call or public
Windows release was made. The sole existing Chrome origin remains the preview
`dcahjbghpncachlghgemfgpeggibgmbd` registered to 1c42e8b5. Its read-only
`ObserveHostedOwner` returned `unobserved`, which does not settle old protected
intent or leases. The earlier pending web approval was not clicked or replayed.
IAB attachment of that old tab timed out; a fresh ordinary ChatGPT page opened
and was retained, with no test prompt submitted. Do not describe the old-tab
timeout as all browser use being unavailable.

Next: protected binding, old-operation/owner reconciliation, deliberate browser
cutover, then ordinary ChatGPT before Dot file/shell/process receipts and
browser lifecycle/pause/revocation. Keep the goal active. No production VPN,
MCP, IDE, Process Lasso or research work changed. The available goal API remains
status-only: update the checkpoint draft, not a claim of native-body mutation.

## Protected Cutover Readback and Current Preview Kit (2026-11-07 04:15 UTC)

The existing Private Research MCP owner PowerShell channel was used for bounded
read-only diagnostics, not as the new candidate's hosted acceptance. Its process
reported the selected SID matched and native administrator role enabled. No
service configuration, connection lifecycle, research task or VPN was changed.
The current companion stager bytes were pinned to cf042ce6 before extracting
only function definitions for its ACL/identity checks. A first diagnostic failed
because module autoloading was disabled and ConvertFrom-Json unavailable; it
made no mutation. The corrected diagnostic explicitly imported the system
PowerShell Utility module and completed.

Fresh protected readback of the old 1c42e8b5 owner showed:

- Exact protected owner identity verified; persisted pause true.
- Outer Job lease absent and controller/device-operation leases clear.
- Matching fce5367c3a14450c9cba233c84a98017 terminal record: Job drained,
  root exit observed, exit code 0, inner leases clear.
- Exact demand task has zero instances.
- Original pending operation d53ca6b5-3572-4d90-81d9-7f47f144bcab is not recorded
  beneath the verified state directory. The receipt directory itself is absent.

The file-only absence helper initially returned false for that missing parent
directory. That false is not evidence of admission. A bounded typed readback
distinguished FileNotFound/DirectoryNotFound beneath the sealed state from
unavailable access and resolved it to not-recorded. The old web approval was not
granted, cancelled or replayed. These checks settle local old-owner state; they
do not prevent a future approval from enqueueing old work. An independent tunnel
is prepared to keep that old request away from the replacement runtime.

The b7c53d97 ProbeLocal receipt pair 21c8f129ef484ea58ecd4a7830ca96f5 was
independently read under its sealed private ACLs, with exact action/ID/digest
matching. Its result is complete/ok; protectedFilesVerified,
administratorStateVerified, cleanLaunchPlanVerified and administratorChildVerified
are true, diagnostic none. Persistent pause is true; secret vault absent; no
tunnel started or registration changed. This strengthens the previous native
parent-exit evidence without rerunning the probe or first installation.

Official Platform inventory in IAB matched the old acceptance tunnel and the
existing personal organization/workspace. A new `AgentContinue Windows B7
Acceptance` form was prepared with those same associations, but not submitted.
A specific action-time confirmation for creation, binding, connection and the
new ordinary ChatGPT/Dot test scope remains pending. No key was read or created
for this preparation, and no old tunnel or app was changed. Keep this gate;
do not treat the unsubmitted form as an endpoint or substitute another API.

The supplied owner-loaded preview path still has older adapter/admin-browser/
devices bytes. Current source was packaged as `2.2.1 Windows device preview`
without its embedded extension key, with optional nativeMessaging unchanged.
Targeted admin-browser/browser-wake/device-control/dialog/UI tests passed:
98 Node tests, including synthetic UI checks; five preview-kit tests also
passed. These are not installed-browser or hosted acceptance. An independent
read-only review compared seven selected native members byte-for-byte with b7
and checked browser request/acknowledgement/receipt contracts, finding no material
compatibility blocker. It also confirmed the complete local setup payload works
as the delivery route; isolated install.ps1 would request unpublished Windows
assets from the scheduler-only v2.2.1 release.

The guide now explains complete-kit delivery, ordinary-account versus unfinished
administrator setup, and historical test limits. The official tunnel guide was
read live in IAB: private tunnels are not public ChatGPT plugin distribution,
workspace and Platform associations are separate, and the hosted deadline is
120 seconds including queue time. Long process lifetime is separate from request
response lifetime; follow the same PID/operation after timeout rather than replay.
Source: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels

Latest local artifact:
`dist/windows-20261107-preview-delivery-reviewed/agent-continue-windows-preview-kit.zip`
SHA-256 `c00c80d975403f30cd2a36f77e6a6afc9c0c7964c70756271a704d5ac6b31cbf`.
286 members, no EXE/MSI. It was verified and extracted into its own `unpacked/`.
The predecessor 34e1d669 ZIP is preserved. Member names are identical; only
START-HERE.md and SHA256SUMS.txt changed after the reviewed/tested build.
Its adapter bytes equal the published v2.2.1 Store package. No Chrome extension
was replaced/reloaded, bridge enrolled, candidate connected, release pushed,
Store package submitted or Windows delivery claimed in this checkpoint.

The goal remains active. Next is the unsubmitted private endpoint confirmation,
protected binding and intentional singleton cutover, then ordinary ChatGPT first,
Dot, browser reopen/new generation, pause and revoke. Reacquire the actual origin
after any unpacked path change. The owner does not need to copy another command
merely for these already-completed readbacks. No new services or tasks were added.

## Installer Recovery and Actual Browser-Lifetime Gap (2026-11-07 04:48 UTC)

This continuation made source changes and obtained new local observations; it
was not a verified wait for a pending cloud action. IAB re-read the existing
unsubmitted B7 form. Create was not clicked and its action-time scope question
remains unanswered. Do not bypass that gate or treat the form as a tunnel.

Independent static installer audit identified: missing browser-managed install
readback; path restrictions discovered after configuration; version-only Node
selection; collapsed registration diagnostics; failure to reuse portable Node
for Verify/Uninstall; and missing browser-managed removal. Three recovery issues
were addressed, not all six. Remaining path/npm/architecture/removal limits are
explicit in the quick-start guide. Do not claim universal one-command setup.

### Read-Only Recovery Implementation

`browser-install-status --install-dir PATH` is a new closed bootstrap/npm command;
PowerShell maps `-DeviceAction browser-installer-status` to that exact vector.
It rejects operation IDs, consent and mutating flags. The primary browser-managed
UI now offers this inspection separately from standalone `installer-status`.
The latter still observes its original first-connect operation; no receipt is
invented for browser-managed registration.

The inspector verifies the existing provider and native binding, checks the
fixed wrapper/manifest bytes and reads all four HKCU/HKLM 32/64 registry slots
twice. Missing, matched, conflicting and unreadable/changing states stay distinct.
`registryComplete` preserves incomplete coverage even alongside a known conflict.
A matching pointer alone is not registration verification. It does not execute
an interpreter inferred from a wrapper. Different inspecting Node reports
`mismatch/not-verified`; missing interpreter evidence reports `not-recorded`
rather than turning an uncertain profile into a corruption verdict. Boundaries
are rechecked after the last bundle and profile reads. No readiness, live pause
or chat grant is inferred.

Independent review reproduced ordering and interpreter false claims in the first
implementation. Each was given a failing regression before correction. The final
bounded re-review closed the reported issues and independently ran four no-write
in-memory checks. It did not establish live installer or hosted acceptance.

PowerShell now preserves six exact bounded diagnostics (five `browser_wake_*`
codes plus `manager_operation_not_recorded`) without exposing arbitrary errors.
Verify/Uninstall may reuse an already validated portable Node, but cannot download
or provision one; an explicit NodePath remains strict. The worker observed
16 failures before its two fixes and 32 passes afterward. The integrated alias
adds two cases; the parent observed all 34 pass on Windows PowerShell 5.1.

Other current checks: wake registration/inspection 19 passed; Setup UI 27 passed
with English/Chinese and desktop/mobile cases; preview-kit tests five passed.
One temporary real Chromium/native-framing test passed, including cross-tab Pause
and restart readback. Its backend is synthetic, so it is not administrator-owner
lifetime or real Chrome-owner acceptance. A separate real official portable Node
22.23.4 download verified pins, reuse, broken-candidate selection, corrupt-file
refusal and restoration. No system Node, registry or tunnel was changed by that
Node fixture. The named fixture remains after its parent cleanup command was
rejected before execution; no alternate removal was attempted. The separate
observation JSON is `dist/windows-20261107-setup-checks/observed-results.json`.

The actual npm tarball test initially found a stale fixture assertion (17 payload
members versus 21 current declared runtime files). The revised assertion checks
the explicit complete member set, not just a relaxed count; its focused pack,
offline installation and runnable CLI test passed. No npm publication occurred.
The subsequent full `tests/npm-package-tests.mjs` rerun passed 11/11, exit zero
in 71.5 seconds. That is a local tarball/fixture check, not registry publication.

### Corrected Administrator Recovery Gate

A fresh current-code audit confirms that the administrator path is one-shot
browser wake followed by an independently held high Scheduler/Job owner. It does
not monitor Chrome exit. A healthy generation may survive closure and still be
the generation observed after reopen. Neither a fresh timestamp nor a wake
acknowledgement establishes the required new generation. The standard-account
retained-port path and the administrator transport-exit recovery fixture do not
close this different gate.

`docs/plans/2026-11-07-administrator-browser-lifetime.md` records required retained
session ownership, authenticated high-side liveness, pre-admission checks,
graceful disposal without persistent pause, real Job/lease settlement, no overlap,
and observed G2 != G1 after actual fixture-browser exit/reopen. This mechanism is
not implemented or accepted. It is a substantive next coding gate in addition
to the pending test-endpoint scope, not a reason to declare b7 delivered. The
existing b7 ZIP and companion stager were rehashed and are unchanged.

### Local Candidate Only

New kit `dist/windows-20261107-installer-recovery/agent-continue-windows-preview-kit.zip`
SHA-256 `5c36a43f1c0a1106149fe7c1eb6a2f96055cc55f61eecfb22ec06bd2937ca6d0`.
286 members; no EXE/MSI; archive integrity verified. Against c00c80d9 the member
set is unchanged and only eight members differ: Setup HTML/JS, START-HERE,
bootstrap bin, wake-registration module, PowerShell wrapper and the two checksum
lists. Older candidates are retained. The adapter/admin application bytes are
unchanged; no installed extension was updated or origin assumed from a new path.

No new endpoint, key, binding, owner enrollment, live connection, service/task,
Windows GitHub Release or Store submission was created in this continuation.
The native goal remains active. Native-body mutation is not claimed by updating
the external checkpoint. GitHub scheduler v2.2.1 and its existing Store gate
remain separate from unfinished Windows delivery.

## 2026-11-07 05:37 UTC: Browser-Lifetime Source And Actual Medium Peer Chain

The previous turn is classified as progress (installer recovery changes plus a
current-source lifetime finding), not a verified wait or no-progress turn. This
continuation implemented the missing candidate lifetime channel and tests.
The active goal and full Windows/ChatGPT/Dot/admin/other-platform scope are not
redefined by the narrower observations below. No completion/blocked claim.

### Implemented Source

- Retained administrator connectNative session replaces startup's one-shot wake.
  Status/Pause stay one-shot and separate. Exact attached acknowledgement is not
  readiness. Permission loss/invalid reply/disconnect cannot retry a wake.
- A grant following permission-less startup may attach exactly one wake=false
  observer. Permission racing startup cannot authorize restoration. No first
  connection, pause clearing or operation replay is inferred from grant.
- New PS5.1/C# local pipe: explicit protected DACL, Network deny, reject remote
  clients, FirstPipeInstance, bounded framing and native retained peer process
  identity/argv/ancestry. No command/credential protocol or custom EXE installer.
- Root and each provider separately hold a generation-pinned witness. Browser
  binding/directory/commit loss cannot downgrade to maintenance. Admission latches
  denial on observed witness/enrollment loss, including queued SDK handlers.
- Start native witness closure before potentially slow controller/SDK disposal;
  join cleanup and retain failure as unconfirmed. Host's outer 9s bound exits 1,
  not a false zero, if cleanup fails. Normal command cancellation after handler
  entry is still not promised atomic.
- Six review-driven race/parser/cleanup/binding cases were reproduced before
  correction. Independent bounded source reviews closed their respective findings;
  not formal full EGM certification or native high-side acceptance.
- Queue is the new source demand policy. This deliberately coalesces installation
  startup intent against a *currently verified* browser, not a session-correlated
  command. Restore-off does not cancel an accepted startup; Pause/Revoke do.
  Existing lease/journal/authorization checks remain. No task was registered or
  changed on this computer. Rapid reopen in the actual high Job is unobserved.
- Changed lifetime-source dependencies are enumerated by the administrator bundle
  builder and enrollment preflight. No new immutable shipping bundle was built
  or installed, and b7's original archive/stager SHA-256 remain unchanged.

### Observed Checks In This Continuation

1. `node --test tests/admin-browser-tests.mjs
   tests/windows-admin-session-dispatch-tests.mjs
   tests/windows-admin-host-cleanup-tests.mjs
   native/desktop-commander/windows-admin-browser-session.test.mjs
   native/desktop-commander/windows-admin-owner.test.mjs`: final 97 passed, no
   failed/skipped tests, exit 0. New races include READY plus partial junk,
   shutdown during initial status, slow disposal, enrollment disappearance during
   acquisition, and same-byte binding/commit replacement followed by restoration.
2. `powershell.exe -NoLogo -NoProfile -NonInteractive -File
   tests/windows-browser-peer-tests.ps1`: actual PS5.1 compilation and 430
   assertions, exit 0. Actual server pipe/ACL, bad frames, duplicate-instance
   refusal, wrong native client peer/image/argv, cancellation and slot reuse.
   Same owner supports 32 sequential providers, then 16 concurrent and confirmed
   EOF replacement. Sixteen is a concurrent bound, not a lifetime quota.
3. `node --test tests/windows-admin-session-chromium-tests.mjs`: 2 passed, no
   skips, exit 0 in 37.18s. Actual temporary Chromium -> CMD -> copied Node ->
   production PS native verifier, real Owner/Provider peers, no injected verifier.
   Four distinct generations and four root exits, all exit 0, wake flags
   `[false,true,true,false]`; the last pair follows actual worker replacement.
   Scope is medium S-1-16-8192, unsealed fixture with inert synthetic roots. The
   fixture intentionally creates liveness peers for observer attachment too; it
   does NOT prove production wake=false task suppression, elevated Job ownership,
   Queue handoff, durable high state, hosted model success or admin commands.
   Actual generation samples:
   `09de70023fc12274b4afa46df862a8ab`, `ed9dbce99e365f88824cac4a801d4650`,
   `e9a4d112807a06d0988b297b2dbf5160`, `a279fb7ad90d484b4186cc858b39e607`.
   Cleanup verified zero scratch-bound processes, random HKCU host and disposable
   files removed, no other process signalled, no emergency cleanup in this run.
4. Existing `tests/windows-admin-browser-chromium-tests.mjs` passed its actual
   browser test after adapting its injected fixed-state session fixture. It
   remains a Pause/reconcile routing test, not lifetime/high evidence.
5. Existing real inert Job containment suite passed revoke, root-exit and broker
   loss, with all three owned members gone and an unrelated fixture left alive.
   The unregistered real Scheduler COM definition test passed new Queue-policy
   assertion and rejects IgnoreNew. Neither registered a task nor proves a real
   browser-to-high-Job handoff.
6. Ordinary pinned-core stdio test passed actual owned file roundtrip, harmless
   and managed process operations, 28 tools/67 RPC replies, 0 protocol errors,
   0 host network attempts, 0 direct browser attempts, standard token, exit 0.
   It preceded the last cleanup-only refactor; no high/hosted claim.
7. Adjacent demand/intent/supervision/elevation-probe suites: 30 passed. Device UI:
   32 synthetic checks passed; 16 source/dialog checks passed. No installed
   extension UI or real initial optional-permission prompt was verified.

CI source includes new focused tests and a medium-token native fixture that
explicitly reports NOT OBSERVED on unsuitable runners. No remote CI run claimed.
No production VPN/MCP/IDE/research/Process Lasso or endpoint-security changes.
No new endpoint/key/binding/owner enrollment/service/task, public push, Windows
Release, npm publish or Chrome Web Store submission. The pending private endpoint
scope confirmation remains unanswered and is not bypassed through another API.

Next: protected high-root/Job lifetime and rapid-reopen/Queue acceptance with a
fresh reviewed candidate, then ordinary ChatGPT command/file/process receipts,
then Dot equivalents and pause/revoke/recovery. Do not replay old AcceptLocal or
old d53 unknown operation. Keep original b7 proof historical. Full goal active.

## 2026-11-07 05:48 UTC: New Lifetime Bundle And Extracted Smoke

The canonical offline builder finished with ok=true, 24328 files, 107059994 bytes,
stagerPlan=true, protectedFilesVerified=false and activated=false. New archive:
`dist/windows-20261107-browser-lifetime/agent-continue-windows-admin-x64-browser-lifetime-source.zip`.
SHA-256 `d94052eccd6d90bb08f6de78cdf97dee3d50cad4c4d88f5fcacae2b6d15bde5f`.
Immutable copied companion stager SHA-256
`c74842d8c99da6e8c2fa0be05e49bfeffec26a8dd8515ddec8c7cb834f1fb671`.
Prior B7 archive and stager remain intact; never operate their old enrollment with
this new source companion.

Independent ZIP readback compared six critical runtime sources against the
current working tree: owner, browser host, session JS, peer C#, peer PS and host.
All SHA-256 values matched. Exactly three executable archive entries: locked npm
ripgrep, official Node and official OpenAI tunnel runtime. No custom EXE/MSI.

`Test-WindowsAdministratorBundleSmoke.ps1` then completed exit0 against this exact
ZIP/digest. Its extracted runtime returned: 28 tools, 67 RPC replies,
protocolErrors=0, hostNetworkAttempts=0, directBrowserAttempts=0, stderrBytes=0,
fileRoundtrip=true, harmlessProcess=true, preparedProcess=true,
preparedRevocation=true, managedProcessVerified=true, windowsToken=standard,
extractedBundle=true and stdinCloseExit=0. One test passed, none skipped/failed,
24.43 seconds test-run duration. This is AFTER the final host cleanup refactor.
The script's bounded owned fixture cleanup returned without error.

This is a new local runtime PACKAGE proof, not a deployed/elevated lifetime,
registered Scheduler handoff, browser permission grant, ordinary ChatGPT/Dot
hosted result or public publication. No tunnel opened or installed source,
registration, key, production service/task or research process changed.
Local machine-readable record: `dist/windows-20261107-browser-lifetime/observed-results.json`.

## 2026-11-07 06:04 UTC: D940 First Native Administrator Acceptance Completed

Started `Invoke-WindowsAdministratorAcceptance.ps1 -Action Start` ONCE against
the new d94052ec archive and c74842d8 companion; neither is the old B7 operation.
The same exec session60420 was polled until exit0, never restarted on delay.
At06:01:29UTC it returned the exact bounded receipt:
`{"status":"administrator-child-verified","uacRequested":true,"administratorChildVerified":true,"tunnelStarted":false,"registrationChanged":false}`.
The pinned worker/stager exit-witness path only reports this after native
command-child token/SID/integrity/nonce/PID, successful exit and probe cleanup.
No full child-console JSON was captured; do not invent missing console fields.

Independent medium readback at06:04:41UTC: derived protected root
`C:\Program Files\AgentContinueAdmin\d94052eccd6d90bb08f6de78` exists;
six critical source hashes and official Node hash match the archived bytes,
owners Administrators, protected file DACLs. Root DACL independently read back.
Private state directory exists but its ACL read is UnauthorizedAccessException
from medium, not a successful private ACL observation. Vault and browser
enrollment not present. Fresh read-only Inspect reports existing-artifact and
other-or-conflicting-registration; no old registration was changed.

Observation corrections: earlier manually typed root prefix had25 rather than24
hex characters, so its not-observed result did not describe the real target.
Later PID180816 has a different StartTime; PID reuse is not installer liveness
and no signal was sent. First-acceptance reservation markers remain; do not delete
them or replay AcceptLocal. No exec session needed for this operation is running.

Two parallel reviewer calls failed before any report because of usage quota.
This continuation makes no new independent-review claim. Browser lifetime,
high Job/Queue integration, ordinary ChatGPT/Dot hosted results and publication
remain unverified. IAB D940-only form is prepared, not submitted; current specific
creation/configuration/connection/high-tool scope question is pending.
Local evidence: `dist/windows-20261107-browser-lifetime/local-administrator-observation.json`.

## 2026-11-07 07:06 UTC: D940 Binding And Browser Enrollment

The owner approved creation, connection and both ordinary ChatGPT / Dot high
acceptance. IAB created only tunnel `tunnel_6aeec565ffe08191935f53e3bc60d05d`.
The protected BindHosted result `9d0cd2b4a2064970b72b91ff6218849f` completed
with all24328 files verified, administratorChildVerified=true,
hostedBindingPrepared=true and activated=false. The user-designated runtime key
was read locally by the stager, not printed or copied into a web form.

Old local acceptance1c42e8b5 was read back paused and quiescent: generation
fce5367c3a14450c9cba233c84a98017 drained, root exit0, inner leases clear,
zero task instances. The interactive RetireCleanOld receipt then confirmed
normal owner revocation and browser unenrollment. No old uncertain request was
replayed and no production endpoint, VPN, IDE or research task was changed.

Interactive AuthorizeAndEnroll completed in Windows session1: hosted owner
authorized, D940 browser registration committed for isolated origin
`ibhdcljfbjhohmaekibjnpanejbfmmam`. Both actions exited0. They did not connect.
The portable private plugin `plugins_6aeec7a2a98481919119ed081caafd50` was created,
but its default link opens Codex and it was absent from ordinary ChatGPT's App
picker. This is not a ChatGPT-discovery proof. The official custom-MCP form for
the same tunnel has been prepared but not submitted while runtime is not ready.

Manual offline test harness uses the exact full candidate JS and protected native
host; its test manifest alone adds an isolated public key and declares native
messaging at developer installation. It is not an optional-permission or Store
build test. An initial test-only route blocked extension scripts; allowing only
the exact test extension origin fixed that harness issue. Network destinations
remain blocked in the offline browser. Temporary HKCU Chromium registration was
read back removed after the failed launch and was recreated only for the live
test run. No ordinary browser profile or account is used by the harness.

The first Connect helper attempt exited2 at browser_enrollment_commit with
browser_enrollment_launch, files0 and no activation: pre-enrollment paths were
wrong for an enrolled connection. The corrected helper has a distinct
ConnectEnrolled receipt and uses the pinned `.browser/stager.ps1` and bundle.zip.
It is running once; no completed connection or hosted operation is claimed here.
Read this operation's receipt before any further connection attempt.

Independent static review found real product gaps: no administrator Connect /
Reconnect GUI route, a latched native-port failure, and browser-permission removal
not constituting durable owner revocation. These remain blockers even if hosted
backend acceptance later passes. Full goal stays active; native body was not
rewritten, and no Windows GitHub/Store/npm release was made.

## 2026-11-07 07:34 UTC: Real Browser-Managed Ordinary ChatGPT And Lifecycle

The corrected ConnectEnrolled receipt completed once with saved-running intent
and a requested task. Full Connect verification took about3.5 minutes, followed
by roughly4 minutes of demand-path verification. No operation was reissued due
to that latency. Protected owner became Ready as G1
`d54733f1711c4d34ae8918dfb72cf421`.

Using the official custom-MCP Tunnel form in IAB created/connected actual ChatGPT
App `plugin_asdk_app_6aeecf5622f88191a6b2a3a2c28c4009`, display name
AgentContinue Windows D940 Chat. Its ordinary acceptance conversation is
https://chatgpt.com/c/6aeecff9-c8bc-83ea-a062-3ffe82555d98 . The owner-approved
test-conversation permission was selected, not a global Always Allow. The
portable plugin record is separate; neither was recreated or publicly listed.

Actual hosted results, with no provider instrumentation or maintenance-window
substitute in this run:

1. Exact command operation79e2f211-77f2-44a3-8cd9-625d8764fc64: PID165764, actual
   command-child TokenElevation1/High Integrity S-1-16-12288/selected SID witness.
   Browser marker AC_ADMIN_7245e05d50f04b3ebd318dcca3317a73 matched protected
   proof. Durable receipt admitted-exact/provider-reported-result.
2. write_file operation6fee6d95-7cdc-42ce-8f29-e801425cd39e and read_file roundtrip
   a uniquely named Temp text file. Browser content, actual local bytes and
   provider-reported-result receipt match. No other file operation requested.
3. Exact start38bf947d-7336-475d-b2ae-223b91486777 created PID174768. Native
   witness/image/startTicks639296327457382247 matched, with admin=true. Actual
   browser list_sessions found it. Stop2e2728b3-bf65-4f01-a5b7-7a6b823d67b0
   targeted only that session; browser listed No active sessions afterward,
   independent OS readback found no same process identity, receipt reported
   provider result. Numeric process exit codes were not independently returned.

Browser G1 close at07:24:55 caused actual owner terminal root exit0, JobDrained
true, inner leases clear; saved-running intent remained. Same test profile
reopened07:25:23 with Restore=true; actual Scheduler path created distinct G2
`7e4a982213184032819c6424740ab58d`, independently Ready. Fresh ordinary command
2930501b-5a78-4b29-a246-4938825bb78d ran PID139768 in G2. Marker
AC_ADMIN_3254eb9c19684fd7be90ee1f102f6408 matched the actual High-token proof and
durable result receipt. PID139768 had been used by an earlier exited helper;
this new command is distinguished by the new operation/witness, not PID alone.

Actual Devices UI Pause0aa26b4a01fb46dbbd8e3ec5eaf36a57 was sent once. Native
readback is stopped; G2 terminal authorization-stopped/root exit0/JobDrainedtrue/
innerLeasesCleartrue. New browser open07:32:05 retained Restore=true but left
paused=true and no owner/controller/operation leases. Startup task was requested
and returned0 without launching another owner. Actual UI Check pause receipt
returned the same historical stopped result; it did not pretend to be current
connection status. Both live harness sessions exited0; temporary Chromium key
removal read back at07:31:51 and07:33:30. Candidate remains manually paused.

An observer readback command accidentally serialized PowerShell's decorated
Get-Content string into excessive metadata, exceeding the existing MCP output
bound. That READ returned unknown_outcome, not a device mutation failure. A
separate bounded [IO.File]::ReadAllText readback confirmed G2 proof, receipt and
Pause terminal. No mutation was replayed in response to that observer error.

Dot has only the existing research main conversation in current UI. The menu
offers Rename/Pause/Restart, not an independent new-Dot conversation. No message
sent and no Pause/Restart clicked there. A scope clarification asks permission
for a clearly marked temporary request in that existing Dot; no Dot acceptance
is claimed. Work mode is not silently relabeled Dot.

Evidence: dist/windows-20261107-browser-lifetime/hosted-chat-observation.json;
offline browser plan/browser-observations.jsonl and final devices-latest.png in
%LOCALAPPDATA%/AgentContinueD940BrowserAcceptance/d940-20261107. Test manifest
differences and missing optional-permission/Store proof remain explicit. Admin
Connect/Reconnect/Revoke GUI completion and transient-port recovery remain open.
Full goal active, original objective body unchanged, no Windows public release,
Store submission, npm publication or production VPN/MCP/IDE/research changes.

## 2026-11-07 07:41 UTC: Paused Hosted Read And Final Settlement

The ordinary acceptance conversation completed its one requested read_file while
the candidate was manually paused. Actual visible final error:
`INVALID_ARGUMENT: Error code: INVALID_ARGUMENT; Error: McpServerError: Session terminated`.
No file content was returned, and no reconnect, retry, alternative plugin or
device-setting change was requested. The response took about four minutes;
this is a real offline-response UX delay, not evidence of a successful read.
One failed read is not an exhaustive proof of every denial or revocation path.

Final protected readback at07:40:55.688 UTC: lifecycle paused=true,
controller/device-operation leases absent, task state3/zero instances/lastResult0;
G2 terminal authorization-stopped/rootExitCode0/JobDrainedtrue/innerLeasesCleartrue.
Temporary Chromium native-host registration was absent. Test browser sessions
are closed and no test process remains. No UI Revoke acceptance was performed.

Screenshot: AgentContinue-D940-Chat-Paused-Access-20261107.jpg under the current
thread visualizations directory. Ordinary acceptance tab retained as deliverable;
existing Dot tab retained for handoff, untouched. Dot scope clarification remains
unanswered. No new whole-goal completion, public Windows release or Store submit.

## 2026-11-07 08:11 UTC: Administrator Control Source And Simulated GUI

This section records SOURCE progress, not a new installed administrator runtime
or hosted acceptance. Exact D940 runtime and its final paused state were left
untouched. No new account-browser action, protected staging or UAC was performed.

Implemented root `admin-control.js`, Devices controls and fixed additive native
actions `control-support`, `control`, `control-status`, `control-fence` and
`control-reconcile`. Connect/Resume carry one reviewed target; Revoke is scoped to
the installed bundle and has no target. Status/Fence/Reconcile retain original
bundle/operation/kind and cannot accept a replacement target. Own extension,
top-level exact Devices sender only. Browser storage is a durable CLIENT journal,
not a protected native receipt or proof of execution. Polls are read-only; unknown
mutations are never replayed. Permission removal cancels polling, not journal
history. Clear Data preserves unresolved operations and Pause evidence.

Review/test reconciliation:

1. Permission epoch is checked immediately before native dispatch and after await.
2. Regrant during an old readback pass schedules a new epoch pass after settlement.
3. Revoke no longer needs a successful fresh support RPC at submission.
4. A full 256-entry active journal archives only validated terminal entries,
   reads the archive back, then evicts. Unresolved entries are not evicted.
5. Interrupted archive commit is resumable after valid state refinement, without
   overwriting a conflicting action/target/identity or treating absence as failure.

Each issue was first reproduced in a failing test. Independent final focused
follow-up found no new blocker in the inspected archive helpers/test tail, not a
whole-product or high-side security certification. Browser/native parser parity
matrices also reject cross-action states and progress counts outside verification.

Observed completed runs (overlapping, not unique counts):

| Command or scope | Result | Boundary |
| --- | --- | --- |
| npm run test:admin-controls | 80 passed, 0 failed, 0 skipped | 25 worker, 3 parser parity, 35 simulated UI, 17 native protocol |
| admin-browser + browser-wake + native protocol | 77 passed | Real PS5.1 unsealed scratch fixture, not protected high acceptance |
| node tests/background-state-tests.mjs | 34/34 | Scheduler regression |
| node tests/background-v2-tests.mjs | 33/33 | Includes Clear Data preserving unresolved control/Pause |
| device dialog + integration-source | 16/16 | Synthetic and source checks |
| headless Chromium device-ui-tests.mjs | 34/34 checks | Simulated controls, 1100/390px, no account/network/native calls |
| python -m unittest discover -s tests -p test_package.py | 11 passed | Offline packaging tests |
| node --check devices.js | exit0 | Syntax only |

Screenshots: `dist/windows-20261107-admin-control-ui/screenshots/` includes
`windows-admin-control-next-source-1100.png` and the 390px counterpart. The page
states SIMULATED. Parent visually viewed 1100px; both widths passed geometry
assertions. These images are not installed-browser or hosted result evidence.

Final reviewed worker raw SHA256
`0ce26b8ba682a6d1112e8a77fa5210ebbd730959a5158598b329da75753e4c98`;
worker-test raw SHA256
`68f024ee44ed9646cbbc6bfe6506d015d1fa18ea34811c8896e9f46894ebea0b`.
Canonical offline preview
`dist/windows-20261107-admin-control-ui/agent-continue-2.2.1-windows-device-preview.zip`
SHA256 `f6f0b481cf6a2f01fcfe18e0d0be3a5baa03092bee40cf98addd301b46148e05`,
237 members. Five critical source entries match after canonical LF normalization;
an initial raw CRLF-byte comparison was diagnosed, NOT hidden as a passing raw
comparison. No EXE/MSI/CLIXML/.env member names in the exact archive scan.

Remaining blocker is concrete high-side implementation: the source stager lacks
the five new fixed actions. Legacy capability therefore stays unconfirmed and
new controls stay unavailable rather than invoking ordinary wake. New native
write dispatch uses a response-only deadline, not a child-killing timeout; this
does NOT yet guarantee detached handoff or survival of native-host/pipe/OS failure.
Protected write-ahead receipts, progress, exact medium/high session binding,
execution leases, tombstones and recovery still need implementation and actual
new-candidate acceptance. Same-browser port recovery, UI Revoke denial and Store
optional-permission path remain open. No broad npm test/full-suite claim, new
Windows Release/Store/npm publication or production change. Full goal active.

## 2026-11-07 08:46 UTC - Actual Dot D940 G3 And Source Control Store

Owner scope: the user explicitly approved a marked temporary acceptance request
in the existing Dot main. Dot was not paused/restarted and its research task was
not modified. The test request used only the selected D940 app and disposable
paths/owned processes. Initial catalog-only response was NOT execution evidence;
the subsequent actual response is matched below to independent native readback.

### Connection And Actual Execution

Existing immutable D940 root, stager pin and official tunnel binding were kept.
The first helper operation `77cb1c08079c4aa5b1bbdb8eb2b7557e` failed before invoking
the stager because a PowerShell array-concatenation expression combined paths.
Its terminal result was preserved, not retried. After fixing the helper, distinct
operation `186ffaf58b134d65ba3990fb65a49720f` completed once in interactive session1:
runningIntentSaved=true, launch requested. This alone was not Ready evidence.
Actual matching PID/start observations then proved G3
`bd8b8bf41c284307b892bf0d5bf48544` Ready, broker170732/root159948.

| Test | Operation and actual evidence | Scope |
| --- | --- | --- |
| High-token command | `4040b147-8980-4310-9681-5ece26af4770`; child175032; `AC_ADMIN_370928182cd546a4ac21f505b969f4ad` matched IAB reply, protected v2 witness and one exact provider-history row | Child TokenElevation1, High-integrity SID and selected Windows account; provider reported finished, not a separately verified numeric exit code |
| File tool write/read | `bc0647e8-116c-409b-b00b-84940bc837bc`; `AC_D940_DOT_FILE_4186816a9d97490b8a1c61ba0b32e018` matched Dot and independently read native file | One disposable file; not general filesystem safety certification |
| Owned process start | `b15c5624-352b-482a-bb1d-590e062cf317`; PID106996/startTicks639296373977467813; witness marker matched Dot session | Self-created bounded five-minute test, not an existing research process |
| Owned process stop | `7343c9fd-be41-4e67-ad40-7b8e37adf357`; Dot reported no active session after force_terminate; native PID absent | No unrelated process signalled |

All four exact operation files contain admitted + provider-reported-result;
command/process admission is `admitted-exact`. No blind mutation retry, alternate
operation ID to repeat an unknown operation, or parent-tool substitution for Dot.
IAB screenshot `D940-Dot-Acceptance-20261107.png` and narrowed evidence JSON saved
in this original chat's visualization directory. No credentials were captured.

### Clean Pause And Teardown

Actual test Devices UI requested Pause once; original operation
`f60a9161dfdb4ef79e4a2e45fb7701d4` read back protected stopped. Final native
observations: saved paused=true, revoked=false, G3 terminal outcome
authorization-stopped, Job drained=true, rootExitObserved=true/rootExitCode0,
innerLeasesClear=true, owner-job/controller/device-operations leases all absent,
Scheduler instances0 and broker/root absent. Test harness session83901 exited0;
temporary HKCU Chromium native-host registration was removed after exact target
readback. No production VPN/MCP/IDE/research changes.

Two initial native observer queries used the wrong intent-file path / an array
concatenation expression. Their null/incomplete projections were NOT used as
pause/lease evidence. Corrected read-only queries explicitly read lifecycle.json
and all three separate lease paths; they did not replay connection or Pause.

### Source Progress, Not New Runtime Acceptance

Stager source now includes closed canonical reservation/targetless tombstone,
write-ahead phases, immutable action-specific receipt state machine, exclusive
FileStream execution lease, and atomic bounded progress readback. Browser
operation identity must still be backed by OS peer/session evidence during future
action wiring; the serializers cannot prove that evidence themselves. The five
new public high-control actions and detached launch/reconcile remain unimplemented.

`npm run test:admin-controls`: 80/80. `npm run test:admin-control-ledger`: 4/4
fixture runners, 0 skipped: exhaustive6144 read combinations, 363 publication
orders, identity63, store31, and 130-file verifier with progress0/64/128/130.
The verifier test first failed missing progress then passed after adding the
optional callback; full hash count260 and refusal of content/closure tampering
remain asserted. Scratch ACL stubs are not protected installed-ACL proof. Hook is
not yet wired to actual GUI progress. Broad full-suite, optional-permission,
transient-port recovery and Windows release acceptance are not claimed.

08:52 UTC bounded independent review follow-up: the invalid-origin array in the
identity fixture evaluated to one combined string under PS5.1. Parent first added
an explicit count assertion and observed `origin_case_count` failure, then fixed
the parentheses. Final identity67 assertions passed. Added store cases preserve
targetless fencing across a tombstone/public-receipt interruption, reject stored
digest/SID/origin collisions without changing bytes, reject numeric-to-null
progress regression, and preserve previous valid counters when an open read
handle blocks atomic replacement; store44 passed. Reviewer found no other
confirmed implementation issue in its bounded primitive inspection, but did not
run the file-creating ledger/store fixtures or inspect actual Dot artifacts. Parent
ran those fixtures. Actual simultaneous first-create race/crash durability and
installed ACL/OS peer acceptance are not claimed. Five existing PS5.1 browser
Pause fixture groups passed after the source edits. All review agents closed.
