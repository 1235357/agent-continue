# Windows Control Candidate Build And Packaged Regression

Subsequent checkpoint35 actually installed and locally token-probed this exact
candidate. See 2026-11-07-control-candidate-local-acceptance.md. The build-only
observations below retain their original scope; browser/hosted delivery is open.

Checkpoint34, 2026-11-07 13:33 UTC. The full original Windows-first native goal
remains active and unchanged. This checkpoint supersedes the previous statement
that the capability-projection source had not been built. It does not establish
installation, current browser operation, administrator lifecycle or publication.

## Actual Artifacts

All artifacts are under `.artifacts/windows-control-candidate-20261107/`:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| agent-continue-windows-admin-x64-control-candidate.zip | 107065439 | 79958886ee7a4b87bd93faa5c691097b032efdf82d29fded8c7566043c4a93e3 |
| agent-continue-2.2.1-windows-device-preview.zip | 2526744 | f65f78864f56308fea5b9959bbdc57f84a8f82fb475685a9c8ddf070032065ee |
| stager.ps1 | 268201 | 65676c7174be99cfd152d538938018253129c9616fe465a900da42c0d5c76c49 |
| runtime-inventory.json | generated | 03e0bf3e6b0e2dc2a9d5eba24a212aa2147c49c8789d626842c4ed2b9d446ac4 |

The preview is a developer ZIP with `AgentContinue/` prefix, English default and
optional nativeMessaging; no public extension key. Its 2.2.1 metadata is NOT a
new stable release or a downgrade instruction for the separately patched local
2.2.2 preview. Do not upload it as the Store package or overwrite released assets.

The runtime ZIP, browser preview and external frozen stager are a coordinated
candidate. Installing only the host into an older enrollment does not install
the new elevated control endpoints. Do not combine them with D940's old pins or
replay D940's settled operations.

## Inputs And Execution

- Official Node22.23.4 archive already present at D:/Downloads, SHA-256
  cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20.
- Official OpenAI tunnel v0.0.19 Windows AMD64 release ZIP downloaded from its
  GitHub release; SHA-256
  e8962891696bccc05f27c47cf0f383fed127e955c1b0f4866471e3d0851f2fdd.
- Existing disposable public npm cache copied by the builder; dependency restore
  was offline with installation scripts disabled. No credentials/home/profile or
  runtime state were copied. The source lock SHA-256 is
  2d01e08d37537d5d0e0153fa28e6fece8d97c670926885bb59a991a7d93d27bb.
- `node scripts/build-windows-administrator-bundle.mjs` completed exit0 with the
  pinned archives/cache and a new create-only output path. The builder used an
  ordinary Windows token, and its actual SystemPS5.1 Plan passed.
- `python scripts/package.py --windows-preview --output-dir ...` completed exit0.
  The source stager was copied byte-for-byte into the artifact directory, without
  overwriting any installed/enrolled stager.

No project EXE/MSI installer was generated. The runtime includes official Node,
official tunnel and the lockfile's upstream ripgrep executable, plus upstream
Sharp DLL/native dependencies. "No project EXE" does not mean "no executable."

## Independent Archive Readback

The parent-created `Verify-Candidate.ps1` runs under PowerShell7 and invokes only
the frozen snapshot's read-only Plan in SystemPS5.1. Final exit0 in6.878seconds:

- 24328 unique case-folded runtime members, fixed timestamps; every member was
  streamed to EOF, length checked and SHA-256 recorded, totaling287188846 bytes.
- All29 declared first-party runtime files exactly match current raw source.
- The38 fixed non-dependency members are required; remaining members are inside
  app/node_modules. Missing/extra top-level members and unexpected EXEs fail.
- Actual Node/tunnel executable hashes match their acquisition pins. Actual
  build-evidence bytes match independently reconstructed SHA-256
  b1a603a89ff84831e0ff54fdc54e500556750fb0b6b311144ed4939b32717b41.
- Preview has237 members; eight critical browser/scheduler/control files match
  current source after the packager's intentional CRLF-to-LF normalization.
- Snapshot Plan: ok=true, phase=complete, files=24328, diagnostic=none,
  hostedWindowOutcome=not-run. All verification/binding/activation/registration/
  tunnel/window-stopped booleans remain false, with actual bool types checked.

Sensitive-name checks are not a content-secret scanner, and a declared npm
namespace is not an independent per-tarball audit. Builder provider verification
and offline npm lock integrity are separate checks; do not call this a complete
supply-chain/security certification. Plan alone checks only its baseline set,
not the29-source completeness above.

Initial ad hoc preview readback assumed root admin-control.js and failed because
the actual developer package uses AgentContinue/. The verifier was corrected
after inspecting the archive and packager. This was a verification-path error,
not a missing-file or product-source fix.

A fresh read-only sidecar independently reviewed the build recipe, source set
and evidence boundaries. It reported no missing administrator runtime dependency
in that recipe, and identified the Plan/partial-manifest/EXE limits above. It did
not execute the build, tests or archive readback and did not inspect production.

## Tests Against Actual Unpacked Preview

The candidate ZIP was extracted create-only into its own artifact directory,
after validating prefix, path containment and dot segments. EXTENSION_ROOT then
selected those exact packaged files, not repository or installed-preview files:

| Suite | Result | Scope |
| --- | --- | --- |
| background-v2 | 40/40 | synthetic worker/state API |
| ui-v2 | 22/22 | rendered headless local fixtures |
| ordinary ChatGPT adapter | 16/16 | intercepted synthetic page |
| Dot adapter | 48/48 | intercepted synthetic page |
| device UI | 34/34 | rendered synthetic transport/permission responses |

Explicit extension priority replaces old and later edited text and submits the
configured prompt once. Pause, attachments and a changed conversation remain
distinct constraints. Local timers/target recovery, foreground focus, page
button replacement, unknown receipts and bilingual layouts pass their respective
cases. Device tests do not demonstrate native host registration or live controls.
No real ChatGPT/Dot request was sent by these tests. No production profile,
original task, pause or actual Chrome state was changed by them.

## Delivery Boundary And Next Step

Local original-conversation send remains unverified under its retained manual
Pause. Its previous real no-send Check and own diagnostic export are recorded in
docs/incidents/2026-11-07-local-scheduler.md, not repeated in this slice. Loaded
popup12711009/background66c90c0c/adapter67999cf0 were hash-checked unchanged.

The new coordinated candidate still needs fresh protected installation/enrollment
and positive medium/high admission, public controls, recovery/revoke, then bounded
ordinary ChatGPT and Dot hosted acceptance. An old D940 pass is not this new
candidate's pass. No new original prompt or unknown mutation may be replayed.

No UAC/install/enrollment/registry/task/service/key/tunnel or desktop/browser input
was performed. Production VPN/MCP/IDE/research/Process Lasso unchanged. Main stays
592f8d6aaa8b579a546a1b3da5607e5a11731732; no commit/push/tag/Release/Store/npm
publication. A built and tested local candidate is not user-visible restoration.
