# Windows System Directory Casing Incident

## Reproduction

The IAB runtime70a reported Connect eligible. Its first Connect72e005ec returned
unconfirmed with no protected execution progress. A read-only diagnostic imported
the held/hash-verified65676c71 stager functions. Actual medium identity and sealed
binding passed, but launch-plan construction failed with owner_control_launch_plan.
All root/archive/stager/SID checks passed. The System-directory case-sensitive
pattern failed, while its case-insensitive equivalent passed for the actual OS
GetFolderPath(System) value. No diagnostic process was started.

## Fix And Tests

Only the launch-plan System guard changes from -cnotmatch to -notmatch. Windows
path casing is not a distinct executable identity. The anchored system-directory
shape, fixed PowerShell suffix, bundle/archive paths, caller SID, action/consent,
and hidden runas contract remain unchanged. This matches the existing anchor
and native adapter behavior; it is not permission relaxation or general path
normalization.

Regression first failed in PS5.1:76cases646checks with exactly this new case.
After correction:76cases660checks, including actual OS path, three explicit case
variants and six invalid paths. Full-verifier audit3cases56checks and Node87tests
passed. An independent reviewer confirmed the one-line source difference against
the frozen old stager and independently exercised four valid/six invalid paths.
New stager SHA2564d520da17c02ae10ec9d473808f0baaa3286eaa94122a3f2cc45ec7d45bc8866.

## Actual Test Installation

The first Unenroll/Enroll maintenance design was rejected before execution:
Unenroll requires revocation, while Enroll refuses the retained deny. No such
commands ran. The replacement exact-test helper instead held enrollment,
operation and owner exclusions, verified idle/paused and no operation history,
officially fenced72, backed up stager/public hash metadata, installed a pending
admission marker, atomically replaced both sealed files and verified them before
removing its own marker. Registry, tasks, authorization and runtime ZIP unchanged.
The helper completed00:17:04Z with no tunnel start or key-content read. Protected
report: iab-stager-system-case-20261108.readback. Normal Devices ingested72 fenced.
Post-install read-only binding/caller/launch plan completes successfully.

The next actual browser Connect is8c1fbb7af6bc44c18524c4522e1f1e96. It received
requested ACK, protected reserved receipt and advancing verifying-full progress.
Those facts establish reaching the control verifier, not tunnel readiness,
hosted tool execution or lifecycle acceptance. Never replay that ID.

Later same-ID observations: intent-saved/launch-requested and protected Ready,
generation7441760da6744382ab5948e34b17e777, broker41336/root40896. A fresh
ordinary ChatGPT chat then performed file read and scoped administrator command,
temporary file write/read and owned child start/termination. Process44620 raw
output independently read back exit0/admin=true/fileReadMatches=true/ownedPid55148/
ownedProcessExited=true; separate file read matched the fixed marker. See51.
Frontend Devices status query and current-IAB lifecycle acceptance remain open.

This is targeted test maintenance, not a generic released hot updater. A crash
after setting pending remains fail-closed and requires explicit recovery from
the preserved backups/phase receipts. Do not delete or replay unknown operations.
