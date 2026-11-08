# Read-Only Control Status Endpoint Results

## Scope And Red-To-Green Evidence

Source-only implementation on the existing main worktree; no bundle, installed
runtime or production connection was changed. The fixed native action now has a
read-only PowerShell dispatch. It verifies the enrolled selected-medium binding
through the existing sealed Pause preflight and reads only the public receipt
projection. It never advertises the unfinished mutation capability.

Initial observation fixture: 391 cases, two failures. Action strings containing
soft hyphen or BOM passed PowerShell's linguistic comparison. Eight additional
receipt/progress field-name cases reproduced the same issue in ordered-map keys:
399 cases, ten failures before the fix. Action uses StringComparison.Ordinal;
the shared closed-field validator uses Array.IndexOf for exact field spelling.
No weakened validation, raw-error exposure or pending-record fallback was added.

Independent static review then found a routing omission: ValidateSet accepts
case variants but the early guard did not, allowing a case-variant action with
both new parameters omitted to enter the general verification path. A new
400th case reproduced the failure before the fix. The entry guard now routes
case-insensitively into the still-ordinal request validator. Tests also cover
legacy requests without new parameters and explicit empty new parameters.
The condition-only AST fixture substitutes its own bound-key variable to avoid
PowerShell's automatic PSBoundParameters variable; it never runs stager dispatch.

Final tests executed locally:

- Windows PowerShell 5.1.26100.9818 and PowerShell 7.6.9: observation fixture
  400 cases, 6897 assertions, zero failures in each shell.
- npm run test:admin-control-ledger: 9/9, zero skipped, about 45 seconds. This
  runs seven PowerShell fixtures and two Node/native-framing bridge tests.
- The bridge substitutes an AST-extracted in-memory helper fixture for the
  requested installed stager. Eight hidden PS5.1 fixture children cover all
  three control kinds plus absent/corrupt/mismatched/extra-field/bad-progress
  cases. This is a contract test, not protected-state or browser acceptance.
- npm run test:admin-controls: 80/80. Existing support, durable IDs, UI parity,
  authorization/removal, unknown-result and no-replay contracts remain closed.
- PS7 affected shared-helper regressions: store266 checks, operation29/943,
  identity75, runner86/528. The same PS5.1 fixtures passed in the combined run.
- git diff --check: exit0, with existing LF/CRLF warnings; no whitespace error.

The Windows CI workflow now includes this combined suite and its fixture paths.
This workflow change has not been pushed or executed by GitHub Actions here.
Production remains Desktop/64bit gated; PS7 fixture success is not PS7 stager
dispatch support. No full stager dispatch occurred in these tests.

## Frozen Review Inputs

SHA-256 values below identify source, not deployment candidates:

| File | SHA-256 |
| --- | --- |
| scripts/Stage-WindowsAdministratorBundle.ps1 | 3477336811416167a8c4bafc8957d77f894b1f6e7b48d5828ace62fc88e8718e |
| tests/windows-admin-control-observation-tests.ps1 | 9107f6474518ccc4ae9e8727d90b4e3516940addaae7eb48dbb2a5d14cfda37f |
| tests/windows-admin-control-observation-bridge.ps1 | 775ecd7e157e56a61b98602430ae0110736a56b1350675700cf558a806f0ab35 |
| tests/windows-admin-control-observation-bridge-tests.mjs | f3acb34ce534cf9986a6131c2e92925a099a28c9d9838965bee77c555fa4fc2a |
| tests/windows-admin-control-ledger-tests.mjs | 7d6c88f29b8e22a743d805cdbbee0f67c3d5b0bd3cae9f86e8d44cad050b40dd |
| package.json | 189ef30a68c7109420c99803ae4cd7d20f89a43d2125218b8b530f8b6ae076b4 |
| .github/workflows/native-runtime-tests.yml | e68b01880be04c6841441a2d51992914b980c4d39d6d77212d26f14cc7db47ad |
| docs/plans/2026-11-07-control-status-endpoint.md | ef261ca18058cb54dab5913ee28acf0b74971490484733d135a4b63d31085c53 |

Euler's focused final static re-review found no remaining actionable scoped
issue after the P2 entry-guard correction. The reviewer checked all five source
and fixture hashes above and confirmed the other supporting inputs unchanged.
The parent executed the tests; the reviewer did not execute tests or stager.
This is not a whole-product, protected-runtime or new lifecycle certificate.

## Basic Local Extension Boundary

Fresh read-only Computer Use observation reached the existing Chrome extension
console at dcahjbghpncachlghgemfgpeggibgmbd. Its Settings page and task controls
are accessible; the toolbar and console report manual Pause, with Resume task
available and Send once now disabled under Pause. No click, tab navigation,
configuration change, grant, resumption or prompt submission was performed.

Installed background SHA25666c90c0c869ffc2f9caa8c20ee4ef8cf8ced0944253291e24fea83d31d79e4d8
and adapter67999cf08f15579cbeddf018fad792330ea85e6575e1891887b7426f3050d871
still match the repaired preview. Its exact background-v2 suite passed40/40
again without touching browser storage. The previous actual no-send diagnostic
and export remain historical bounded evidence, not a new production send.

The documented IAB bootstrap is still missing from the installed plugin's empty
skills directory, and the current trusted JS session has no bound agent. No
private runtime workaround or external website navigation was attempted. This
does not establish that IAB itself is unavailable.

## Remaining Work

CheckBrowserHostedOwnerControl and new Connect/Resume/Revoke/Fence/Recovery
mutation routing remain unavailable. Exact OS-peer admission, detached handoff,
real new-generation recovery/revocation, browser permission and new hosted
ordinary-ChatGPT/Dot candidate acceptance remain open. Do not deploy this source
using an old bundle/stager digest pair or repeat accepted D940 operations.

Full original goal remains active, not narrowed or complete. No new task,
service, UAC, tunnel, credential read, commit, push, tag, Release, Store or npm
publication. Existing main5468a72, unrelated dirty WIP, original manual scheduler
Pause, accepted/paused D940 and production VPN/MCP/IDE/research/Process Lasso
are preserved.
