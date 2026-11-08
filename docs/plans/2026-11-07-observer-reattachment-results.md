# Observer Reattachment Results

Checkpoint36, 2026-11-07 UTC. Full original goal remains active and its native
objective body is unchanged. This is one source/candidate increment, not proof
that the user's running Chrome or Windows controls have been restored.

## Reproduced Defect And Change

Before implementation, tests/admin-browser-recovery-tests.mjs had seven tests:
six failed because no recovery timer was created after a correlated attachment
was lost. One pre-ACK rejection case passed. These were assertion failures, not
an unavailable test runner.

admin-browser.js now permits at most three replacement observers at1/5/15s.
Each uses a fresh ID and wake:false. Startup demand/session marker are not
replayed. Exact ACK admission, stale-port rejection, finite budget, cancellation
on permission removal and terminal malformed replies remain separate from
runtime readiness. No lifecycle writes or one-shot control fallback are added.
An injected timers dependency makes the recovery cases deterministic. The npm
device-test chain now includes the dedicated admin-browser suite.

## Observed Checks

- Final admin-browser suite:61 passed,0 failed;12 new recovery cases plus49
  existing/expanded status/Pause/native-protocol cases. New final cases include
  platform-detection revocation and in-flight Status/Pause overlap.
- npm run test:devices completed:62 logic/dialog/source tests,34 synthetic
  device-UI checks,83 admin-control/protocol tests and then the browser suite.
  That run preceded the final three added tests; its browser count was58.
- npm run test:safety:35 background-state cases,40 background-v2 cases,
  38 release-adapter cases and source guards passed. npm run check passed.
- Exact prior local-preview directory, without writing or reloading it:
  background-v2 40/40, UI22/22, ordinary adapter16/16 and Dot adapter48/48 pass.
  All page traffic is intercepted synthetic data, not an actual user send.
- New unpacked preview:13/13 actual MV3 extension scenarios passed in a
  disposable headless Chromium profile. ChatGPT/Dot pages were intercepted
  fixtures, native permission ungranted; no production browser used.
- Offline release archive tests:11 passed in18.048s, including preview/stable
  separation and archive resources. This is not a Store submission.

The fresh no-history sidecar found no actionable implementation issue within
its scope and ran58 tests. It also ran the suite's unsealed temporary PowerShell
fixture despite its no-native-activity instruction; this was a review-boundary
deviation, not installed-runtime or production activity. Parent subsequently
added and passed the three specific race/isolation tests; implementation source
did not change after the review. This is not whole-product or EGM certification.

## Built Artifact

Directory:.artifacts/observer-reattachment-20261107/

- agent-continue-2.2.1-windows-device-preview.zip
- SHA-256:77bccd3bb1070c708dcba2cfcc70d89d68f0befff5f29cdbd70072d6aafe6af3
- Bytes:2527075; members:237; developer preview only, not a Store package.
- Two independent builds yielded the same digest. Nine critical packaged
  files match source with the packager's LF normalization. English default,
  optional nativeMessaging, no manifest public key.

The2.2.1 developer metadata is not an instruction to downgrade the user's patched
local2.2.2. No package or loaded extension was replaced. Native ZIP79958886 and
frozen stager65676c71 remain byte-identical; old previews remain historical.
The older Verify-Candidate.ps1 compares old preview bytes to live browser source,
so that particular live-source comparison is now intentionally stale. Never
overwrite its frozen artifact or installed runtime to force that check to pass.

## Actual Delivery Gap And Stop Rules

The previously loaded dcahjbghpncachlghgemfgpeggibgmbd directory has no
admin-control.js and still contains older device/background code. Its popup,
background and adapter hashes remain12711009/66c90c0c/67999cf0. This is a current
file readback, not a fresh read of Chrome's running worker, saved Pause or page.
Previously recorded manual Pause was not changed or reinterpreted as failure.

The current trusted browser runtime has agentAvailable=false and
browserAvailable=false after its documented setup attempt. Its installed skills
directory is empty. No private API/source workaround, alternate web browser,
desktop action, registration/enrollment, key handling, task/tunnel action or
production VPN/MCP/IDE/research change was used in this increment.

The supplied exports are historical:Downloads/agent-continue-activity.json
last modified2026-11-06T07:58:03Z; Develop export2026-11-01T08:41:12Z. These cannot
establish a new current-page failure after the local repair.

Next critical path is actual browser-managed registration/enrollment and public
Connect/Pause/Revoke/reopen/hosted acceptance using the coordinated new native
candidate, while preserving unknown-operation receipts and existing Pause.
Observer reattachment alone is not runtime automatic recovery; repeating
wake:true/Task.Run or replaying a lost operation is not a substitute. Do not spend
another turn merely recounting these synthetic passes as user-visible progress.
No commit, push, Release, Store submission or npm publish occurred. main remains
592f8d6aaa8b579a546a1b3da5607e5a11731732.
