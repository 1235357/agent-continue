# Same-Installation Administrator Reauthorization

## Problem

The owner has now explicitly approved reauthorization of the revoked r8 test
installation, the same IAB extension and the same hosted tunnel. This supersedes
the earlier unanswered-approval checkpoint, not the recorded stopped revocation.
`AuthorizeHostedOwner` is first-create only: it creates activation files with
CreateNew and traverses fresh-state verification. It cannot safely restore a
used installation. Replaying it or deleting the deny marker is not a protocol.

## Technical Plan

Add a closed high-token maintenance action for an existing installation. It must
verify the full sealed bundle, original browser stager hash, exact SID, enrolled
origin, hosted binding and existing demand task before any change. It must name
one previously stopped Revoke operation and a fresh reauthorization ID. Under
the existing exclusive control gate, require the current revision to equal that
Revoke ID, an empty sealed deny marker, paused lifecycle, idle owner generation,
no active controller/device-operation leases and no active or queued demand
instance. Missing, conflicting or unknown evidence refuses without restoration.

Preserve all old control and revocation receipts. Persist a new authorization
record before committing, rotate the control revision to the fresh ID, and
archive the deny marker under the new authorization ID by an atomic same-volume
rename, not deletion. Refresh the public projection while holding the gate.
The resulting state is authorized but paused. Do not launch a tunnel, alter the
native registration, import credentials or auto-replay a Connect operation.
Old targets are invalid because the revision changed. Repeated invocation of a
settled ID is observation only or a refusal, never a new authorization.

## Alternatives And Limits

- A fresh installation would change the user's specifically approved identity.
- Replaying first authorization collides with existing immutable files.
- Blind marker deletion loses provenance and does not fence stale operations.
- Do not weaken Revoke or restore from an old broad permission statement.
- Commitment and receipt/projection publication are separate. After the marker
  rename, publication failure reports committed-paused, not unchanged. An old ID
  never archives a newer live Revoke marker.
- All prior reservations need terminal receipts and exited runners; existing
  execution handles are held through commit and peer runners must be exited.
  A launch-requested receipt settles a launch request, not its owner lifetime or
  tool result. The owner/task/inner-lease checks remain independently required.

## Acceptance

Pure/scratch tests must cover input closure, matching stopped revocation, foreign
SID/origin/tunnel/hash, busy/unknown owner or task, active execution lease,
write ordering, interruption and same-ID replay. Source tests must prove this
action does not enter fresh-state creation or first Bind/Authorize dispatch.
Actual UAC acceptance is limited to the exact approved r8 identity. Read back
authorized-paused state and retained historical revocation before connecting.
Then ordinary ChatGPT, browser reopen recovery and Dot need their own real
results. CI and source tests are not those results.

## Current Evidence

The additive source action follows full sealed-bundle verification and exits
before fresh-state creation. It never replaces the enrolled stager. The scratch
suite first failed on the absent function; later independent review identified
an optional projection helper masking failure. Parent reproduced that finding
using the actual helper, then required readback with `-Require`. Three focused
Node tests, including the PS5.1 scratch transaction, pass. Scratch ACL and runner
stubs do not prove actual protected ACLs or OS runner exclusion.

Read-only UAC inspection of the approved r8 identity verified its pinned archive
and enrolled stager, same SID/origin/tunnel, paused intent, empty revoke marker,
matching prior revision, no owner/controller/device lease and zero task instances.
The actual maintenance attempt is separately recorded; inspection alone did not
reauthorize or launch it. No new key or production connection is involved.
