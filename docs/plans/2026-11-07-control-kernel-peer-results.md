# Kernel Control Peer Results

## Source Change

The current source adds CaptureControlCallerIdentity and OpenControlSession to
the existing WindowsBrowserPeer reader. The former reads and holds the actual
current medium PowerShell process. The latter checks the actual high command
process, exact original medium identity, same selected SID/OS session, fixed
argv and the held medium/Node/CMD/Chrome ancestor chain before returning a
disposable witness. No stager action calls these APIs yet.

TokenElevation and enabled/non-deny-only Administrators group attributes come
from the opened process's primary token, not its linked token or current thread.
Process/token sessions must agree. Public creation identity converts FILETIME
to UTC DateTime ticks; internal ancestry ordering retains FILETIME. These units
are intentionally distinct.

Relevant official API documentation was searched and read through Microsoft
Learn's documentation tools, without external browser UI navigation:

- [TOKEN_GROUPS](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-token_groups): enabled0x04 and deny-only0x10 are separate group attributes. A present group name alone is not enabled membership.
- [TOKEN_INFORMATION_CLASS](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ne-winnt-token_information_class): process user, groups, session, elevation and integrity are distinct information classes.
- [GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes): creation identity is FILETIME, not a DateTime ticks value copied unchanged.

These documents ground API interpretation, not proof that this implementation or
a deployed system is secure. Chrome basename/argv ancestry remains the existing
policy, not signed-browser or sealed-content attestation.

## Executed Evidence

- Initial source API probe compiled the baseline C# under PS5.1 and failed with
  the explicitly missing CaptureControlCallerIdentity API (expected RED).
- Revised PS5.1 source compiles. Actual local medium self Capture returned a live
  witness, process169796/session1; Dispose made Alive=false. This was a read-only
  test process, not a new administrator runner.
- Existing tests/windows-browser-peer-tests.ps1 passed430 assertions before and
  after the change, including native process/token/argv reads, named-pipe ACL,
  first-instance behavior, bounded cancellation and lifetime protocol cases.
  Disposable test helpers only; no sealed Chrome/Job/admin-pair acceptance.
- The three focused JS session/dispatch/cleanup files passed12/12, no skipped
  cases. They are protocol/fixture evidence, not hosted operations.
- Kepler's fresh static inspection of the frozen plan/source found no actionable
  scoped defect. The reviewer checked token ABI/bounds, same-SID/session, creation
  identity, held handles, exact argv, impersonation refusal and disposal. It did
  not execute tests or inspect installed production state.

- The new PS5.1 fixture passed191cases,10122assertions and22fixed-argv vectors.
  It reads self primary-token integrity/elevation through an independent
  fixture-only oracle, compares the production reader before selecting the
  Capture/refusal branch, and uses WindowsIdentity/Diagnostics for SID/session.
  Actual local medium=true; actual high pair=false; productionAcceptance=false.
- Fresh independent test review found a false-pass risk in the initial branch
  selection, which had trusted the reader's own elevation/integrity. That P2 was
  corrected and freshly re-reviewed with no remaining actionable scoped finding.
  Review was static, not independent test execution. The non-medium CI branch is
  implemented but was not executed in this local medium-token run.
- The combined npm test:admin-control-ledger suite passed10/10, exit0, after the
  oracle correction. Source-byte hash equality is checked by its JS wrapper.

## Frozen Inputs And Next Boundary

- native/desktop-commander/windows-browser-peer.cs:
  50bd9fca004b21484ccd498acc3f770354d25a20a565fa1e4a92b27eb595f7c8
- docs/plans/2026-11-07-control-kernel-peer.md:
  b83aee59a4f5339ecfd08b9a968e5dc04b5abfcd7aee1d61b81bd946df9e8a77
- tests/windows-admin-control-peer-tests.ps1:
  d7ad1c4bdaa5dd10c59ba3c4d917cc7e214fdb9c845e80da3419a4e9addc651a
- tests/windows-admin-control-ledger-tests.mjs:
  38eb7a4a8e19f5a0074a1c915a380860b51a0addd29e5aef276511d9284c29fd

This source is unbuilt/uninstalled. The existing builder includes this CS source
in future pinned bundles, but no new bundle/candidate identity was generated.
Do not install it with old bundle/stager digest pairs or alter accepted D940.

Next: explicit PS stager parameter/entry binding, held sealed-module/asset
verification, actual medium/high UAC handoff and protected identity publication
before ACK; then public Connect/Resume/Revoke/Fence/Recovery routing, real
candidate/browser/hosted acceptance and publication. A source witness API is not
the completed handshake, authority to run a task, capability advertisement,
automatic recovery, or a delivered Windows feature.

No production VPN/MCP/IDE/research/Process Lasso intervention, original scheduler
Pause clearing, UAC, credentials or new service/task/tunnel/install. A separate
follow-up repaired only the installed scheduler console's stale target selection;
see docs/incidents/2026-11-07-local-scheduler.md. This native source is not part
of that scheduler fix and has not been committed/pushed or released. No new
Release/Store/npm action. Full original goal remains active, not completed or
replaced by this bounded implementation step.
