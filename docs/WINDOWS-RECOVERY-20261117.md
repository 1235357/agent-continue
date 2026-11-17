# Windows First-Install and Recovery Checkpoint

## Latest Verified Evidence

- Exact source `d640fe84ce6173f7effe4519b4d5b1bb804250fb`: the complete hosted
  [Extension checks](https://github.com/1235357/agent-continue/actions/runs/44163347836)
  passed, including headed `npm test` and the packaging checks. This is a
  cloud pass, not a final exit for the earlier interrupted local invocation.
- The same source passed the manual
  [Verify Windows delivery](https://github.com/1235357/agent-continue/actions/runs/44164261660)
  run on a disposable Windows runner. Artifact archives `14364034071` and
  `14363899124` matched GitHub's SHA-256 metadata; all six downloaded files
  matched the setup receipt, and the administrator ZIP also matched the
  ordinary-token smoke receipt. The source receipt identifies the exact commit
  and run. Rebuilding
  the setup closure from canonical Git-LF source with that administrator ZIP
  reproduced all six hashes. Administrator ZIP SHA-256:
  `cbfa40e863430a442474bb7ee1e1d401af907bf189b07b8d84674450602a365a`.
  Local evidence: `.artifacts/windows-recovery-d640fe8-ci-44164261660/`.
- This candidate still reports version 3.0.22. Its six build assets have not
  been published to `v3.0.22`; a local build receipt is not proof that their
  release URLs resolve. Do not replace the old public artifacts or point the
  installed extension to unverified URLs. The offline development preview has
  no generated public setup entry and is not a Store upload. Canonical-source
  npm packaging checks passed 11/11, including packing and inspecting the
  actual tarball against the verified six-file input; no publishing occurred.
- The official Chrome controller is now discoverable for the existing Chrome
  profile, superseding the earlier missing-transport observation. It lists the
  existing Extensions tab but returns `Chrome internal tab ... cannot be
  claimed` for it. No Reload, additional authorization, install, or restart
  was performed. An existing HTTPS session or a Chrome inventory entry does
  not prove access to `chrome://extensions/` or `chrome-extension://`.

## Current Delivery Checklist

- Complete: source fixes through `e5b1dd3647c587f05c2f5b398bf3e37628108a60`
  and precommit recovery `41b5440b46982cc516a69a3a45e9c60174b0756c` are
  pushed on the existing sole `main`; late-accounting and outer-retry recovery
  fixes follow in `37edbb25a70cbb5af541ffbf561ac2e5a3451e8a`.
  Same-document proven-no-dispatch recovery is pinned by `11b4207`.
  Empty draft/initial selection/diagnostic recovery is committed in `cb839d7`;
  canonical Windows test paths in `666b006`. These source commits are pushed.
  Extension version remains 3.0.22.
- Complete: canonical Git-LF administrator bundle and matching six-asset
  Windows setup closure rebuilt, verified, and kept in local candidate paths.
- Complete: matching GitHub/Store extension pair and npm CLI archive built;
  actual clean-source npm package tests passed 115/115, zero skips.
- Complete: temporary real native IPC probe passed 12 checks and removed its
  own scratch state. This does not establish installed browser registration.
- Complete: extracted bundle's actual provider/file/PowerShell/owned-process
  smoke and prepared-launch checks, without registration or tunnel activation.
- Complete: independent GitHub Windows verification run 44054690766 on the
  exact `e5b1dd3` source. Its downloaded six-asset closure was reverified.
- Complete: same-conversation precommit document recovery and directed
  regression tests. Default ProseMirror expectation reconciliation passed in
  two same-source partitions, 66/66 and 135/135. Do not infer a full npm command
  pass: its process was interrupted before a final exit result.
- Complete: read-only Chrome Default profile metadata maps development ID
  `kpjgmkakklpdhjmbfahlkffgkcphebkc` to this exact repository folder.
- Pending: observed Reload, current-build ordinary ChatGPT then Dot and
  Pause/Revoke/full reopen acceptance.
- Pending: a new version/tag/Release, only after the required actual acceptance.

Fresh live Store readback later on 2026-11-17: the new item
`jgjoeiidbnpmgbbhhmphicehbcdgbhga` 3.0.22 is now **Published - public**; the
original `jpioilmpbolfokedaefmbfbjeaahfdkl` 3.0.20 is also **Published - public**.
The public 3.0.22 page is accessible and shows Add to Chrome, version 3.0.22,
updated November 17, 2026, and the approved GitHub and LinkedIn profile links.
This supersedes the earlier pending-review observation. No Store revision,
developer agreement, payment or extension installation was changed.
Public URL: https://chromewebstore.google.com/detail/agent-continue-background/jgjoeiidbnpmgbbhhmphicehbcdgbhga
The earlier pending-status screenshot remains historical:
`.artifacts/windows-recovery-store-status-20261117.png`.

The in-app browser was used to read the authenticated Store page. Before the
latest Chrome connection was detected, a Chrome selection returned
`Browser is not available: chrome`. Earlier Default-profile file observations
are historical and did not cover other profiles. The active limitation is
the controller's readback above, not an unavailable browser or missing user
consent. No native-host repair or alternate-channel bypass was attempted.

## Problem

The user reactivated the full Windows-first goal after the 3.0.22 Store
submission. Linux/macOS are deferred, not removed from the full objective.
Continue ordinary ChatGPT before Dot. Preserve the submitted Store revision,
production VPN/MCP/IDE/research, and the separately scoped scheduler behavior.
The owner explicitly accepts changed prepared text and heuristic receipts;
strict whole-payload matching is not a new release gate.

## Next Exact Actions

1. Observe Reload of the existing unpacked development extension
   `kpjgmkakklpdhjmbfahlkffgkcphebkc` from its configured repository directory.
   The Chrome connection is present, but the management tab cannot be claimed.
   The owner can use the card's Reload icon when that extension has no active
   send; do not switch to a different browser-control channel, reinstall, or
   reload the Store item. Recheck the exact loaded instance before live tests.
2. Reinspect standard and administrator hosts independently. A later Node
   process exists in the old protected runtime directory; do not infer quiescence
   from earlier missing/unobserved receipts or overwrite its binding blindly.
3. Complete a named current candidate's consent/bootstrap/connection flow,
   then ordinary ChatGPT file, PowerShell and owned-process effect readback.
   Installation, Ready and local fixture sends are not those readbacks.
4. Repeat the same installation's hosted checks in Dot, then installed
   Pause/Revoke/reopen recovery. Preserve production VPN/MCP/research and the
   separately configured external scheduler.
5. Only after that required acceptance, version and publish a new matching
   Windows setup/admin/extension/npm closure and submit the Store update.
   Existing public 3.0.22 is already published; it is not these source fixes.

Read-only Windows inventory on 2026-11-17 found:

- Standard `com.agentcontinue.device_wake`: both HKCU registry views point to
  a missing manifest under the old Current-20261108 acceptance installation.
  Both HKLM views are absent. Browser permission cannot repair this pointer.
- Administrator `com.agentcontinue.administrator_owner`: HKCU and HKLM32 are
  absent; HKLM64 points to the existing protected `ef4529bc...` manifest and
  `wake.cmd`. Its allowed origin is the existing `hjnop...` test extension,
  not the newly submitted Store ID. This is separate from the standard host.
- Its old November 8 Ready snapshot is not current evidence. The recorded
  process identities are not present. The supported read-only
  `ObserveHostedOwner` command returned `state: unobserved`, not a current
  Ready, Paused, Revoked, failed-task or tool-success result.
- A later process-metadata read on the same day observed Node running from
  the old protected `ef4529bc...` directory (PID 100832 at that observation).
  This supersedes any blanket old-runtime-absent assumption, but does not
  establish owner identity, current authorization, tunnel readiness or active
  call quiescence. Never use the earlier unobserved snapshot to retarget it.
- The in-app browser works for HTTPS. The ChatGPT Plugins page lists the
  existing private Windows acceptance plugins. No new chat grant, native
  activation, registration change or tunnel reconnect was performed.

## Technical Plan

1. Keep legacy `com.agentcontinue.device_control` status separate from browser
   wake and administrator status. A response from one host must not establish
   installation/readiness of another. Granted browser permission remains
   Granted after a missing-host observation; do not ask for that permission
   again to repair an unrelated local installation.
2. Add read-only stale-registration classification to the current-account
   installer inspection. Definite missing targets, denied access, reparse
   targets, changing pointers and cross-view disagreements are different
   observations. Ordinary installation still must not overwrite a foreign or
   ambiguous registration.
3. Subsequent repair must name the exact previous pointer, verified new host,
   extension origin and artifact identity; obtain specific consent and verify
   previous-instance quiescence. A missing manifest is not proof that its
   previous runtime has no active calls. Do not use unconditional overwrite or
   erase leases to force progress.
4. Freeze and test the actual Windows package and then exercise the browser
   flow in an independent ordinary ChatGPT acceptance conversation. Verify
   local file/PowerShell/owned-process effects independently. Follow with Dot
   and the exact same installation's Pause/Revoke/reopen cases. UI fixtures,
   registration, permission and Ready are not substitutes for those effects.

## Alternatives and Boundaries

Chrome's native-messaging contract requires an OS-installed manifest/host.
Without an existing trusted helper, a browser permission alone is not a first
native installer. Use one reviewed PowerShell/CMD/Node bootstrap for initial
installation, then expose ordinary connection/lifecycle actions in the plugin.
Do not claim zero OS/OpenAI approval steps or bypass their security controls.

The official OpenAI tunnel remains the only hosted tool transport; local
Native Messaging is the control plane, not a developer relay for file/command
traffic. Do not start another stdio client on an already active tunnel.

The inspected npm name returned 404, and the wrapper's pinned v3.0.12 public
release lookup returned 404. This is not proof that every extracted local
PowerShell bundle is unusable. Assess the direct-bundle route separately from
the npm wrapper and publish only a verified artifact closure.

## Implementation and Acceptance

Separate write scopes: Setup UI/state regressions, and native registration
inspection with isolated registry/filesystem tests. Preserve the unrelated
popup Clear/late-reply WIP. Do not silently replace a shared runtime, rebind an
unknown operation or change the current production connection choice.

Required negative tests include wrong-host status contamination, Granted
without a reachable host, intact foreign manifests, permission denial,
reparse targets, cross-view disagreement and changing registry pointers.
Inspection must perform zero writes, starts, reconnects and permission requests.

The user subsequently selected the Chrome browser-control extension explicitly.
Its connected Chrome surface (browser 3) was actually discovered and the HTTPS
ChatGPT for Chrome installation page was read successfully. Extension pages
are legitimate user-operated pages; a tool restriction is not a legality claim.
The prior explicit extension-protocol denial must still not be bypassed through
another channel. No extension reload or native control click is claimed here.
The owner's new Chrome screenshot shows development extension 3.0.22 with an
origin different from the old `hjnop...` acceptance installation. Do not silently
reuse the old privileged binding for this new origin. The owner says this
extension is loaded from a local development folder; updating an installed
development candidate ordinarily needs its Reload control, not reinstallation.
Subsequent structured Chrome Default Secure Preferences readback maps
`kpjgmkakklpdhjmbfahlkffgkcphebkc` to
`D:\Desktop\Northwestern University MSCS\[Develop]\agent-continue-repo`.
This establishes the configured development folder, not current enabled state,
running code identity, a Reload event, or privileged native-host authorization.

Local browser fixtures verify rendering/client behavior, not installed extension
controls or Windows installation. The new regression tests deliberately simulate
an absent current-account worker response and separate administrator receipts;
they do not claim an actual host probe or successful hosted tool invocation.

## Fresh Validation

- Native registration inspection: 42/42 passed on Windows, no skips. A second
  independent reviewer run also passed 42/42. New deterministic registry-read-5
  tests first failed on the old ordering, then passed after final filesystem
  checks moved after the second registry snapshot. Owned deletion, replacement,
  denied access and a foreign missing target appearing all invalidate stale proof.
- Related setup/client/controller/account suites: 335/335 passed.
- Full synthetic Setup browser suite: 78/78 passed; focused bridge isolation
  subset: 12/12. Both languages, narrow/desktop layouts, selected-account proof,
  legacy diagnostics and correct account links are covered. Screenshots were
  inspected; these are not live native acceptance results.
- `npm run check`: 128 editor/prompt tests and 11 locale tests passed, syntax
  checks passed. Earlier native-release fixture group: 53/53 passed.
- Full popup UI regression: 70/70 passed, including late save success, conflict
  and rejection after Clear, and subsequent same-generation edits.
- `npm run test:package`: 114/115 passed; root npm tarball prepack failed with
  `combined_release_directory_required`. Do not bypass the verified asset-closure
  gate, publish a source-only npm package, or claim the release package passed.
- Two independent read-only reviewers closed their earlier ordering/coverage
  findings after the corrections. Neither changed production state.

These changes remain a source candidate on `main`, not a new published binary or
proof of installed origin, current connection readiness, or full Windows goal
completion. The submitted 3.0.22 Store package and public Release assets remain
unchanged. The full goal is active, not paused or complete.

Source commits pushed to the existing public `main`:

- `66526b8`: native registration classification and final evidence ordering.
- `442da4b`: scoped Setup diagnostics, account links and browser/VM regressions.
- `690528a`: popup generation/feedback fencing after Clear.

No branch, tag, replacement Release asset, new Store upload or native
registration was created. Local recovery/continuation notes remain separate
from these eight committed implementation/test files.

## Next Packaging Contract

### Problem

Direct ZIP readback of local `dist/agent-continue-3.0.22-store.zip` found
`SETUP_ENTRY_RELEASE = null`. This does not identify the remote publishing path.
The Python packager currently permits `--windows-release` without the combined
setup inputs, so a nominal Windows release can lack the pinned one-command
installation entry. This contradicts the integrated Windows delivery goal.

### Technical Plan

Require both combined setup arguments for formal Windows release packaging.
Validate the original matching builder receipt and all six assets before any
output creation/replacement. Project the verified descriptor into both extension
archives from one snapshot. Leave the source checkout descriptor unchanged.
Keep preview and legacy scheduler-only modes distinct and usable without a
public Windows closure. The release workflow already passes both closure inputs;
strengthen its regression test rather than change its production dependency graph.

### Alternatives

Do not bypass the npm closure gate, invent installer URLs in source, silently
reuse old generated metadata, or overwrite existing public v3.0.22 artifacts.
Publishing npm is optional to the initial PowerShell route, not proof that the
browser-to-Windows lifecycle works.

### Implementation and Acceptance

Scoped files: `scripts/package.py`, `tests/test_package.py`, and
`tests/test_windows_release_workflow.py`. Negative cases: no closure, only either
argument, invalid/incorrect-version receipt, tampered assets, unchanged existing
outputs on refusal. Positive cases: matching closure yields non-null descriptor
with matching tag/entry/SHA256SUMS pins in both archives; preview needs no closure.
Preserve allowlists, private-input exclusion, source revision, distribution pair,
version, publisher/signer and scheduler tests. Review and run focused tests, then
rebuild from exact committed source using actual verified local assets.

A real six-asset candidate was built from `690528a` and independently read back;
administrator stager Plan succeeded, installed/published flags remain false.
In a clean source export with that closure, `npm run test:package` passed
115/115. The prior 114/115 run remains an accurate observation of the checkout
without the required inputs, not a reason to weaken the gate.

Fresh clean-export validation also passed native-release fixtures 53/53 and
setup entry/command/hosted-read acceptance fixtures 49/49. The matching extension
pair was built into `.artifacts/windows-recovery-690528a-extension`; direct ZIP
readback confirmed the non-null descriptor tag and both hashes equal the original
combined build receipt. These local unpublished artifacts still carry 3.0.22 for
source-candidate testing; they must not replace already published same-version
assets or be represented as a remotely downloadable installer closure.

An actual in-app browser read of public GitHub v3.0.22 confirmed four uploaded
assets (Store, standard, preview, preview kit), plus GitHub's two automatic source
archives. The six combined Windows installer assets were absent from that page.
The Store ZIP digest visible there was `050f476e...e2cd01`, matching the earlier
local package, not the new unpublished candidate.

## Latest Owner Diagnostic Export

Read only structured diagnostics from owner-provided
`D:/Downloads/agent-continue-activity (14).json` (extension 3.0.22, last modified
2026-11-17 02:46 UTC), without conversation text or credentials. It retains 94
events and 20 delivery records. The export reports zero omitted records and zero
diagnostic write failures, but historical per-delivery histories do contain
nonzero `droppedHistory`; total export coverage is not unlimited stage history.

The latest retained delivery, sequence 30, reports `sent`, one dispatch attempt
and one receipt check while hidden. Events include 11 `sent` entries. Earlier
retained sequence 19/21 records report `chunk-mismatch` with zero dispatches;
other old records have long waits and many authorization checks. Do not erase
these earlier failures or infer the currently running page from a historical
`running` snapshot. Local heuristic `sent` is neither full-payload verification
nor model/research-task completion. This export no longer supports a blanket
claim that no submission was ever observed.

Fresh `npm run test:safety` still fails 11/214 release-adapter cases after its
earlier background groups pass. Some assertions concern now-permitted whitespace
receipt normalization; others exercise legacy non-persistent rewrite paths.
Independent diagnosis is in progress. Do not label the complete source suite
green, restore strict fidelity against the owner's policy, or skip these tests.

## Sending Alignment Follow-On

Independent inert diagnosis split the eleven failures into six obsolete
NBSP/space receipt assertions and five real finite-legacy correction regressions.
Keep the latter's configured-text/one-click expectations and repair the bounded
synchronous correction sequence; do not simply expect `blocked`. Keep all Pause,
identity, manual takeover, historical receipt and uncertain-dispatch fences.

A separate supported-MAIN gap was observed: repeated nonempty controlled-model
restoration can cause repeated correction/backoff instead of the owner's accepted
prepared-text adoption. Proposed implementation must:

1. Explicitly carry persistent-delivery intent into MAIN; keep finite legacy
   behavior distinct rather than globally change fixture defaults.
2. After a proven preparation on the same bound editor/view, adopt current
   nonempty model text instead of restarting that write. Do not treat an ignored
   initial transaction as proof of preparation or adopt an untouched initial draft.
3. At the existing synchronous isolated receipt-boundary event, capture the
   actually prepared text for this invocation without adding a dispatch route,
   logging content, or returning prompt text through status metadata.
4. Preserve final authorization, target/editor/view/attachment checks, manual
   takeover and exactly one attempt. Changed identity or expired permission is
   not a content-normalization case. Unknown dispatch remains non-replayable.
5. Verify both surfaces, repeated prepare/observe/commit, delayed restoration,
   ignored writes, empty restoration, missing boundary and post-boundary mutation;
   confirm that the adopted receipt counts once and manual Send prevents refill.

The follow-on is now implemented as a source candidate, separately from the
packaging results. Persistent intent reaches MAIN explicitly; same-binding
preparation adopts changed nonempty text, and the existing isolated boundary
captures that prepared payload without publishing its text in diagnostics.
Finite legacy textarea correction is bounded but no longer interrupted by the
two-write cap before its last synchronous correction. NBSP receipt tests now
assert the already-authorized normalization behavior with no replay.

Independent review found that a new EditorState identity alone was inadequate
proof: a metadata-only transaction could preserve the untouched old document.
The correction additionally requires matching configured text or a changed
logical payload during the write before granting adoption eligibility. New
ordinary/Dot regressions cover unchanged old text in a replacement state. A fresh
independent probe using real ProseMirror metadata-only states confirmed that
prepare/repeat/commit make two bounded attempts and zero clicks after the fix.

Fresh evidence: editor/invocation/Pause suites 145/145, release-adapter 84/84,
full safety command exit 0 (including background groups and final 217/217), and
local real-ProseMirror browser scenarios 14/14 after the evidence reconciliation
below. Devices command rerun passed all groups including final 79/79; Setup
command passed, including UI78/78 and its isolated real-extension loopback test.
The first full npm command stopped on a 3200ms PowerShell fixture timeout; its
isolated rerun and whole Devices rerun passed without timeout changes. This is
not a claim that one uninterrupted complete npm run passed.

Additional broad browser runs currently report Dot76/81, MV3 stopped at an old
repeated-restoration count assertion, and keyboard suite stopped at an unexpected
`keypress` in its expected event sequence. Preserve these failures and classify
them against the unchanged baseline and accepted policy; do not claim all tests
green or a live-site/browser-managed Windows acceptance. All current changes
remain undeployed until separately observed Reload and runtime acceptance.

Independent bounded classification later reproduced all seven assertions on
clean `690528a`: five Dot failures, MV3 restoration count, and the first keyboard
event sequence. The opaque-DOM zero-attempt expectations and forced refill-count
expectations are stale relative to readable-text fallback/prepared-text adoption;
keyboard fallback already emits keypress in published 3.0.22. The 500ms private
model fixture is a real counterexample that returns unknown/receipt-mismatch
after one stale attempt, not exact successful delivery. Restoration callbacks
gated to CHECK_RUN number 3 did not run their supposed additional WAIT boundaries
(actual restoration count zero); downstream assertions never ran. Reconcile
these tests explicitly in the next step, keeping the counterexample and no-replay
invariants, rather than label whole suites passed from partial execution.

Commits `404efed` (formal setup closure requirement) and `e5b1dd3` (MAIN adoption,
legacy correction and bounded receipt semantics tests) are pushed on existing
`main`. No new version/tag/Release or Store revision was published.

## Source-Byte Rebuild Boundary

A new `git archive` export under this Windows checkout's `core.autocrlf=true`
produced CRLF native source bytes, unlike the Git objects and prior package's LF
runtime. Exporting with process-local `git -c core.autocrlf=false archive` matched
the Git object bytes. No global/local Git configuration was changed.

The earlier administrator ZIP also stores CRLF project LICENSE bytes while the
Git object is LF. Thus the strict combined builder correctly refused reuse from
the canonical LF export (`administrator_bundle_source_or_runtime_mismatch`).
The working-tree 690528a build remains a real internally verified observation,
but is not evidence of reproducibility from the canonical Git byte snapshot.
Do not normalize away source hashes inside verification or alter old binaries.
Rebuild the administrator ZIP using original pinned inputs and the LF source.

The original Node22.23.4 archive and OpenAI v0.0.19 runtime archive were found in
the named previous build-input directories and their SHA-256 pins matched. The
global npm cache now exceeds the builder's bounded cache inventory limit; its
first rebuild attempt returned `cache_limit`, with scratch cleanup and no output.
A dedicated prior build cache (42 MB) is instead used for the fresh offline
administrator rebuild. No provider/tunnel version was upgraded and no system
installation, registry write or actual tunnel activation is part of this build.

### Canonical Rebuild Result

The previously running administrator build finished successfully; its old
process handle is now missing and its terminal receipt is `ok: true`,
`stagerPlan: true`, `protectedFilesVerified: false`, `activated: false`.
The rebuilt archive has 24,328 files and 107,072,518 bytes. Exact pins:

- Administrator ZIP: `46bbfbdb813f809d3a232ede6f792755156cb61112c48e8611cabbb20cc76002`.
- Setup ZIP: `9eebd22ce65cfe1ccb80b2b243620731d1dfb0519f767b71f503afd157391735`.
- Entry install.ps1: `afc8dfa022e4edf2926f8e0c43ad531fd971911729b5fb25f7dfd328db34289e`.
- SHA256SUMS.txt: `172c7c8bd928c3cf8d9ea6e6d611f7db2cefb9093da34e84e4bab3a733f0721f`.

Use `.artifacts/windows-recovery-e5b1dd3-lf-source` and the matching
`windows-recovery-e5b1dd3-lf-final-combined`, `-lf-final-build.json`, and
`-lf-final-extension` paths, not the earlier CRLF/provisional exports.
The actual combined builder verifies source/runtime equivalence and emits one
complete six-asset receipt with `installed: false`, `published: false`.
Both extension ZIPs were built with that exact directory/receipt. The root
source setup descriptor remains null; only packaged copies receive the pins.

The npm preparation CLI requires absolute paths. An initial relative-path call
returned `invalid_combined_release_receipt` before staging; retrying with the
same canonical absolute directory and receipt succeeded. Clean source
`npm run test:package` then passed 115/115, no skips, including an actual npm
tarball test. A separately built `agent-continue-0.3.0.tgz` embeds all six
Windows assets and release metadata (57 files, about 103 MB compressed).
These are same-version local build observations, not permission or evidence to
replace existing remote v3.0.22 binaries or advertise its currently absent
Windows download assets as working. A new release still needs a new version.

The clean-LF native runtime IPC test returned 12 pass / 0 fail, default paused
and disconnected, rejected a wrong origin/extra argument/oversized frame,
verified unchanged binding/channel bytes, clean owner exit, and scratch removal.
This is one temporary real native host/owner handshake, not installed Chrome,
official hosted transport, administrator elevation, or ChatGPT tool evidence.

### Actual Extracted Windows Provider Result

The exact rebuilt administrator archive was extracted into a newly owned
temporary smoke directory, without protected installation or host registration.
Its pinned portable Node/provider returned 28 tools and 67 JSON-RPC replies,
zero protocol errors, zero direct browser/network attempts, real file roundtrip,
harmless/managed/prepared process checks and prepared revocation. The observed
child token was standard, and provider stdin close exited cleanly with code 0.

The prepared-launch fixture matched the selected account, verified shell startup
flags, and rejected the same standard token when administrator was expected.
The admission fixture passed 3/3, including real Windows file/PowerShell calls,
independent standard-token proof, denied an outside test write, and denied replay.
`liveHosted` is false. No ExerciseTunnelProfile, actual tunnel, real browser
registration or existing installed runtime was used.

The first invocation used `pwsh` 7 and failed after its successful provider test:
the dot-sourced ACL fixture uses the .NET Framework two-argument Directory
CreateDirectory overload, which PowerShell 7's .NET does not expose. Production
staging and the existing CI smoke adapter explicitly invoke Windows PowerShell
5.1. Rerunning the same archive and unchanged fixture through `powershell.exe`
passed all requested checks, exit 0. No code guard, timeout or access policy was
weakened. Preserve both logs, and use the explicit Windows PowerShell executable
for this developer-only smoke entry. The two fresh smoke directories were
removed; unrelated historical November 6 scratch directories were not touched.

Receipts: `.artifacts/windows-recovery-e5b1dd3-lf-final-smoke.log` (initial
PowerShell 7 failure), `-lf-final-smoke-ps51.log` (complete exit 0), and
`-lf-final-ipc.log` (12/12, scratch removed).

### Reconciled Dispatch Evidence

The existing real-ProseMirror browser fixture includes a second private
JavaScript closure that retains stale submission text for 500 ms even though
the public model and enabled Send control have updated. Both clean baseline
`690528a` and the new candidate dispatch once with that stale external value.
This is not introduced by the candidate; the old test demanded an unobservable
universal hidden-framework synchronization guarantee from a public-model helper.

The owner explicitly prioritizes continued dispatch and accepts prepared-text
adoption/heuristic receipts. Reconcile this fixture as a characterization of
attempt-only evidence: assert the public model and actually observed private
submission remain distinct, one attempted dispatch, no extra method, and no
receipt/success claim in the MAIN helper result. Keep the stale-value observation
visible in the test rather than hide it, skip it, or claim a fixed delay solves
arbitrary private-state synchronization. The isolated adapter must still require
a new correlated receipt for its separately scoped local confirmation. Actual
ChatGPT/Dot acceptance is still required before a new release.

### Independent Windows CI

[Verify Windows delivery, run 44054690766](https://github.com/1235357/agent-continue/actions/runs/44054690766)
succeeded in 5m49s on `e5b1dd3`. Downloaded receipt/sidecar artifacts passed
the actual combined-release and administrator-bundle verifiers against the
canonical Git-LF source. CI administrator SHA-256:
`cbfa40e863430a442474bb7ee1e1d401af907bf189b07b8d84674450602a365a`.
The CI archive has 24,352 members; the local archive has 24,328. Their
common files are identical except the installed npm lock. CI also contains
the already lock-pinned optional packages `@emnapi/runtime@1.11.3` and
`@img/sharp-wasm32@0.35.5`. Do not mix CI and local asset pins or call
their byte identity reproducible. Neither artifact was installed or published.

Separate extension CI and experimental Windows CI failed before the local
test reconciliation. The local Windows launcher suite now passes 8/8,
including a forced path-alias fixture; a cloud rerun is still necessary.
Local Dot adapter tests passed 81/81 and focused public/support tests
70/70. See prior notes for outputs. No public release was replaced.

### Same-Conversation Send Recovery

The old worker treated every replaced document as potentially submitted,
even with a held MAIN prepare and no commit. This paused the only active
delivery. The local candidate retires that old permit, keeps the original
prompt/ordinal and target, and prepares the replacement document with fresh
run/receipt tokens. This also covers replacement while awaiting the browser
grant, before MAIN commit admission. Evidence from the retired document remains
scoped to the same round; observed manual intent, a receipt, or Pause stops
automatic replay. If an old receipt conflicts with an admitted successor
dispatch before receipt accounting, the round is classified as uncertain.

Both targeted real MV3 ProseMirror fixtures passed (prepare and grant), 2/2 on
the final production source. The expanded background state harness passed
99/99, including late evidence during retry sleep, successor storage write,
prepare and commit. The full safety command passed (96 state scenarios before
the last three coverage-only cases, 355 background v2, 217 Node test cases and
source guards). The unfiltered browser fixture run passed 57 cases including
the previous reload failure and
continued to a separate stale assertion that requires repeated refilling
after a nonempty page rewrite. The canonical `e5b1dd3` baseline reproduces that
failure with one observed click, one submission, and one confirmed count.
Do not report the full suite green or change the owner-approved adoption
policy to make that old test pass.

Evidence logs: `.artifacts/windows-recovery-precommit-red.log`,
`windows-recovery-precommit-pm-prepare.log`, `-pm-grant.log`,
`-prosemirror.log`, and `windows-recovery-pm-restoration-baseline.log`.
Separate latest-source logs use `-pm-final.log`, `-safety-final.log` and
`-background-final.log`. The independent first design review identified
late-evidence and Pause races; they are covered by the revised contract
and deterministic tests. Fresh follow-up reviewers could not start because
of workspace credits; do not claim final independent code signoff.

### Empty Readiness And Initial Selection

A new isolated legacy fixture proves an actual pre-submit starvation path:
after the site clears the prepared model, its known Send stays disabled and the
old loop never reaches its later refill code. The local candidate refills an
empty composer from within readiness using existing authorization and the
existing write backoff, with no total waiting deadline. Finite clears recover
to one exact send; continuous clears remain cancellable through Pause.

A separate fixture proves collapsed or partial selection can append an old
draft to the long prompt. The first persistent chunk now synchronously
reasserts full selection just before the first write; two directed browser
cases verify exact replacement and one submission. Other chunks keep their
verified caret. No foreground switch, native input or new permission.

The production additions received an independent static review with no
actionable finding. Reviewed adapter SHA-256:
`cb3c83463e571cec88d63ed8b2e2b20c7b4ebb7ad7434556985df4cb0a386283`.
The reviewer did not execute runtime acceptance or audit the entire sender.
The new fixed diagnostic `emptyComposerRecoveries` counts completed recovery
calls (including false), not successful refills or confirmed sends.

The post-write transient-unreadable regression also exposed a missing diagnostic
increment: exact recovery was counted between chunks but not immediately after
a write. The working candidate adds the same recovery count on that post-write
path. Existing fixed export fields and payload redaction are unchanged; this
does not turn a recovery count into proof of a successful submit. This later
diagnostic-only addition was not in the independently reviewed adapter hash
above. Final-source browser checks cover it, but it has not received another
independent review.

### Latest Owner Log

The attached `D:\Downloads\agent-continue-activity (14).json` is 3.0.22,
121,359 bytes, last modified 2026-11-17T02:46:01Z. It retains 94 activity
records and 20 deliveries: 11 locally confirmed sent, 3 unknown, 3 cancelled,
2 blocked and 1 stored running-state record. Persistence reports zero write
failures. Individual DOM writes reach 11.189 seconds; two blocked deliveries
record 244 writes each and chunk mismatch. Later locally confirmed deliveries
take roughly 22-37 seconds. This contradicts a blanket no-send account of the
whole log, but does not prove complete prompt delivery or model success.

An old running-state entry outlives later completed sequences. Export v5
`coverage.deliveries.activeSnapshots` counts retained running-state records,
not a live worker observation. Do not call it a current active task. The shared
3.0.22 version also cannot pin multiple local development revisions; precise
sender-build provenance remains a diagnostic follow-up.

### Accounting Review Follow-up

An independent review of committed `41b5440` reproduced two remaining races:
retired manual receipts arriving during successor session/local finalization
writes, and an immediate retryable no-dispatch result after MAIN commit
admission but before the replacement detector. The first could retain a false
confirmed count and advance a queue; the second could admit MAIN commits on
both documents. These are local control-flow counterexamples, not observed
duplicate hosted submissions.

The working candidate retains the original sending snapshot while accounting,
reconciles shared ambiguity across awaited persistence/alarm/badge work, and
uses that baseline for partial-receipt retry. Its logical-delivery MAIN marker
also prevents moving admitted commit authority to another document. A later
full-browser regression narrowed the initial overbroad outer-retry stop: an
explicit no-dispatch attachment result may recover on the same document after
readback, with every successor injection pinned to the admitted document ID.
Replacement after readback cannot redirect it. Existing same-reservation
no-dispatch correction remains supported. A conflicting old
receipt produces an unknown paused result and unknown terminal trace, not a
new success or another dispatch.

The three permanent regressions failed against the exact archived Git-LF
`41b5440` source. The current background harness passed 102/102; the original
queue ordinal was retained, confirmed/manual counts stayed zero, unknown count
was one and alarms were cleared in all three corrected cases. Separate
Pause/restart/local-failure integration tests passed 48/48. Check and support
commands passed. The full safety command then passed: 102 background-state,
355 background-v2 and 217 Node cases, plus source guards. Commit `37edbb25`
is pushed; remote readback matches HEAD and still lists only `main`.
Browser expectation reconciliation remains in progress; no unfiltered npm pass
or installed acceptance is claimed.

The follow-up document-pinning harness passed 104/104 in the subsequent full
npm attempt, including a replacement between readback and retry injection.
The final-authorization ProseMirror batch passed 23/23, removable and
unremovable attachment cases passed independently, and launcher tests passed
8/8. That full npm attempt later failed in the manual TXT test reading its
asynchronous Blob too early. The directed corrected test passed with exact
UTF-8 bytes. The later unfiltered command's handle disappeared; no matching
test process remained, and its log ended without a final result. Do not replay
it as if still running or count it as an overall pass.

That latest log, `.artifacts/windows-recovery-npm-final-verified.log`, records
passing check, safety (104 state, 355 v2, 217 Node), support (71), device and
setup groups, Setup browser 78, adapter 27, Dot 81, file import 19 and MV3 14.
The remaining default ProseMirror cases passed separately on the same source:
`.artifacts/windows-recovery-pm-first66-final.log` 66/66 with exit zero and
`windows-recovery-pm-all-tail-final.log` 135/135 with the final result present.
The latter handle was missing on follow-up; no exact shell exit is claimed for
it. Independent editor browser checks passed 14/14 with exit zero, final-source
Dot passed 81/81 and support passed 71/71. No fixed product send deadline was
added to repair any fixture; no full final npm exit or installed acceptance is
claimed. Adapter SHA-256:
`802e63771e6bae15d6700a945299a7c9542dbf12a91b4ba1a3ec09a01da4c087`;
background SHA-256:
`9f8d99c67f3a79929af0f2d4df26f8f9487c91054c2bda340de716998fabcbe7`.

Evidence: `.artifacts/windows-recovery-accounting-regressions-red.log`,
`windows-recovery-accounting-regressions-green.log`, and
`windows-recovery-accounting-focused.log`. Follow-up reviewer/worker execution
was interrupted by workspace credit exhaustion after the initial review and
permanent test edits; the parent actually executed the RED/GREEN comparison.
Do not describe the revised implementation as independently signed off.

References inspected through the in-app browser:

- https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- https://github.com/openai/tunnel-client

Upstream source comparison also uses:

- https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/main/scripts/remote/README.md
- https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md
