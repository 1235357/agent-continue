# Read-Only Support Projection Results

Checkpoint33, 2026-11-07 UTC. Full original Windows-first goal remains active.
This supersedes the missing source capability-projection statement, not actual
installation, native high admission, recovery/revoke or release acceptance.

## Implemented Source

- Exact CheckBrowserHostedOwnerControl entry before the observation/mutation
  guards; only Action/Archive/ExpectedSha256/ControlKind. Extra caller, consent,
  target or operation parameters fail before preflight.
- Existing sealed medium identity, registry, committed enrollment and pinned
  archive/stager preflight. The query starts no runtime/connect-check child or
  task and prompts no UAC. It does not read credentials, repair state or write
  a projection.
- Elevated existing pause-target publication now also atomically replaces the
  bounded canonical control-owner.json. It exposes digest/target/ownerState only.
  Revocation presence wins; exact saved lifecycle intent maps to paused/running,
  otherwise unobserved. Running means last published saved intent, not Ready.
- Medium surrounds the state row with matching pause-target reads. Missing,
  malformed or mixed rows deny startup but do not disable targetless Revoke
  after successful sealed preflight. Connect requires paused+idle; resume-saved
  requires saved-running+idle. Active generation never offers new startup.
- Legacy revocation refreshes the advisory projection only under its existing
  guard after durable denial. Failed publication cannot undo denial. A missing
  guard does not trigger acquisition, repair or projection creation.
- Support-only budgets: native20seconds, worker25seconds, Devices30seconds,
  including pre-submit recheck. Existing status/mutation deadlines unchanged.

Public rows are LAST PUBLISHED advisory observations, not guaranteed fresh OS
state or permission. Separate files cannot form an authorization transaction.
Protected high admission still checks live revision/generation and private deny;
stale or missing public state cannot authorize startup. No legacy candidate is
promoted to supported merely because source/tests now implement the contract.

## Reproductions And Review

The new fixture first failed missing_api:Assert-AdministratorControlSupportParameters.
Independent review found the outer4.5/5second deadlines would discard a longer
sealed preflight. Three failing Node cases reproduced that mismatch; native/
worker/page budgets were coordinated and passed. A second review found canonical
lifecycle rewrites may inherit the exact private ACL accepted by the existing
stager. New exact_acl_form:inherited test failed before the source fix. Reader
now accepts either existing exact protected or exact inherited-private validator,
inside sealed parents; malformed ACL forms remain unobserved.

Test-review follow-ups closed: assert an actually absent destination for initial
File.Move, distinguish replacement, exercise legacy deny-before-refresh with a
real exclusive scratch guard, and prove the injected optional publication failure
was reached exactly once (not an earlier swallowed exception). Absent-guard case
must not reach it again. Fixture-only fixes: parenthesize a concatenated array
entry; make absence stub use actual scratch filesystem except denial simulation;
include Combine/Substring in the closed read-only AST member whitelist. These
were test harness corrections, not production fixes.

One fresh independent read-only sidecar statically reviewed the scoped source,
reported the deadline/ACL issues and test gaps, and re-reviewed their fixes.
Final assertion-delta review closed the last finding. No independent test
execution, comprehensive product review or security certification is claimed.
Only skill entry sections were read this slice; autonomous EGM-style adaptation
does not certify complete source-method adoption or author-course mastery.

## Executed Checks

- Actual System32 PowerShell5.1:113cases/267checks PASS. Real bounded public-file
  parser, atomic create/replace and exclusive legacy guard; ACL and owner intent
  are explicitly substituted. No positive high/protected/installed acceptance.
- 24 emitted PS support projections pass both browser and native JS decoders.
- Observation guards417cases/7093assertions PASS.
- Control/UI/protocol83/83 PASS. Device logic62/62 and synthetic headless browser
  UI34/34 PASS. The device command also reran the83 control cases; do not sum
  overlapping runs as independent test coverage.
- Existing BrowserPauseFixturesOnly5 groups PASS, including actual medium token
  and native anchors. This is not a new high-pair or installed control acceptance.
- Full ledger final refined run16/16 PASS, exit0,64.0644067seconds, no skipped or
  cancelled tests. It requires113/267,24 wire vectors and the failure-reached
  counter. Earlier runs16/16 in62.895/64.540seconds were provisional before the
  final oracle assertions. The initial15/16 run exposed missing Combine/Substring
  in the test-only read-member whitelist; no source change was needed for it.
- Full npm check syntax and4 bilingual catalog tests PASS.
- Exact currently loaded scheduler files freshly pass synthetic background40/40,
  UI22/22, ordinary adapter16/16 and Dot adapter48/48. This includes extension
  priority replacing changed text and sending only once. Real original chat
  submission, actual Chrome final UI state and live delivery remain unverified.

## Frozen SHA-256 Inputs

| File | SHA-256 |
| --- | --- |
| scripts/Stage-WindowsAdministratorBundle.ps1 | 65676c7174be99cfd152d538938018253129c9616fe465a900da42c0d5c76c49 |
| native/desktop-commander/windows-admin-browser-host.mjs | 3d7134f35f7ee106f76eec785083d6ee605f52ad8e79a7265b29ef8dcf7ac048 |
| admin-control.js | b2e64e62ef62130897d676e84d7314ab2d6062697576cba76a4efca68b5a8097 |
| devices.js | da8cfafc9a649179d68dec44e525805748cc3f0163419023203d4efed25768dc |
| tests/windows-admin-control-support-tests.ps1 | b5270225c749fb8f5fec2f04d63124a0532b3ae280848ccc2fd23cc24a3d782e |
| tests/windows-admin-control-ledger-tests.mjs | 24d3acb06297eb0c1d84055c99a7143722bda78b47808012c163048f98017086 |

Existing peer source50bd9fca unchanged. Loaded scheduler popup12711009,
background66c90c0c, adapter67999cf0 unchanged. Last original manual Pause remains
authoritative; no production prompt was sent, no Pause cleared and no user data
read by these isolated synthetic fixtures. No live desktop/browser operation.

## Remaining Delivery

Rebuild/enroll a new reviewed candidate with new pins, then actual new positive
high/CLI/browser lifecycle, recovery/revoke and hosted acceptance. Do not reuse
old digest pairs or replay settled paused D940. No build/install/UAC/key/task/
service/registry/tunnel action this slice. No production VPN/MCP/IDE/research/
Process Lasso change. No commit/push/tag/Release/Store/npm publication; unique
main stays592f8d6aaa8b579a546a1b3da5607e5a11731732. Browser policy stop honored.
