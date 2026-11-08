# Browser Control Progress Under Uncertain Operations

## Problem

The browser wake port owns a Windows current-account runtime. Its one-command
transport slot and durable mutation fence currently share a lifetime. A14.5s
waiter timeout preserves the slot forever. The native host also awaits each
owner request before reading another frame. Consequently neither freeing the
JavaScript slot nor raising a timeout can make status or Pause progress while
Reconnect is awaiting a result. Device UI admission separately forbids Pause
when any operation is pending. Native device operations already permit one new
Pause over an unresolved Reconnect; the browser must expose it without erasing
the earlier operation. This is not permission to replay Connect or clear fences.

The desired guarantee is limited to a living owner with a responsive event loop
and IPC. Owner death, a blocked event loop, or missing stop/receipt proof remains
unavailable, not a successful disconnection. No additional service, task, monitor,
public port or production-runtime change is part of this source implementation.

## Technical Plan

Use the same registered native wake host, exact extension origin and existing
authenticated owner IPC. Add a single-shot first-frame route before startOwner:

```json
{"version":2,"action":"attach-control","ownerId":"original-wake-id","request":{"version":1,"id":"original-or-new-pause-id","action":"status"}}
```

Only status and disconnect-and-pause are allowed. Reconnect, arbitrary arguments,
paths and prepared mutation dispatch are forbidden on this route. The host must
pin binding and channel identity/bytes, require the recorded browserOwnerId to
match ownerId, and reuse the existing MAC-authenticated IPC. Failure must never
fall through to wake/start/startSavedIntent. Existing legacy channels without a
browser owner association are not silently adopted.

Pass the validated initial wake ID into browser-owned channel construction.
Record browserOwnerId only for that mode. Ordinary channel formats remain valid;
an attach request requires the new exact association. Responses are bounded
metadata tied to the original request, not proof of chat authorization.

Frozen API: sendExistingBrowserControl(binding, ownerId, request, { timeoutMs })
returns the original v1 control response. It verifies browserOwnerId on the same
pinned channel snapshot used to send/authenticate, with no replacement adoption.
The host success envelope is exactly {version:2, action:'attach-control', ownerId,
response}. Failure is sanitized unavailable and never falls back to startup.

The original long port and unresolved command remain correlated. Read-only
status and a separate priority Pause can use the new single-shot route while
that port is occupied, or after worker/port loss using the persisted owner ID.
They never call connectNative(wake) to get around an uncertain mutation.

Persist primary mutation and priority Pause independently, before transport, at
both page and worker boundaries. Preserve exact owner/id/action and existing
revision/ambiguous-write checks. A Pause receipt only settles Pause; a primary
receipt only settles primary. New Reconnect remains forbidden until both settle.
An unresolved Pause cannot be duplicated. Generic negative responses are never
terminal proof. A newer Pause observation must not be overwritten by a late
Reconnect snapshot. A status action may perform at most two original-ID reads
to reconcile the two retained records; no mutation is automatically dispatched.

Owner shutdown must initiate non-persisting lifecycle quiescence/stop before
waiting for active requests to drain. Quiescence prevents new Reconnect and late
launch/readiness, but preserves saved user intent and leases until shutdown is
proved. Explicit Pause still persists pause first. Bound status observation by
an internal deadline and return null/unknown observation with the actual journal
row, never terminalize an operation due to that timeout.

## Alternatives

- Clearing a timed-out mutation or assigning a new Connect ID is rejected.
- Freeing the browser slot alone leaves the native head-of-line block and is
  insufficient. Blindly multiplexing readFrame is also invalid: its existing
  framing deliberately rejects multiple complete frames in one read.
- Starting another owner or assuming device_control names the same installation
  is rejected. The new one-shot route uses the already registered wake host.
- A general multiplexed transport or independent OS supervisor would be larger
  follow-up designs. This bounded change does not promise control of a dead or
  synchronously blocked owner.

## Implementation And Acceptance

Native ownership: device-owner.mjs, device-native-host.mjs, device-operations.mjs,
lifecycle.mjs and focused native tests. Browser bridge: browser-wake.js and its
focused tests. Page controller: device-control.js, devices.js and focused tests.
Central integration must review the shared frame/association contract before
connecting these slices. No existing installed candidate is updated until this
source passes current tests and independent review.

Required cases: delayed and never-returning Reconnect; status/Pause before and
after the UI deadline; no duplicate Pause; exact separate terminal receipts;
out-of-order late replies; revoked permission; conflicting owner/channel; missing
legacy association; worker restart and original owner alive/dead; ambiguous
storage writes; no fallback startup; native fsync then lost reply; port loss
starts quiescence before drain; delayed launch cannot override Pause; status
observation timeout remains unknown; and both layers retain unresolved evidence.
Native fixtures use deferred promises and disposable state, not real tunnels or
registry. Browser fixtures use fake time and exact messages before any real UI
acceptance. Existing scheduler and administrator-control semantics are outside
this change. Review findings and actual passes must be recorded separately.

## Readiness Clarifications

Independent design criticism found no need for a general multiplexed protocol
provided these interfaces remain fixed. This is design readiness, not acceptance.
beginQuiesce synchronously latches shutdown and starts non-persisting stop before
its first await, immediately on browser lifetime loss rather than after a hung
request finally block. Authenticated status/Pause remain admitted while quiescing;
only finalization closes them after drain and positive stop proof. An unresolved
active request can retain that restricted owner and lease indefinitely.

canPause is separate from primary eligibility, paused-state certainty and busy
status checks. It still requires permission, healthy journaling, the shared lock
and exact owner identity. Any unresolved Pause forbids another Pause. A status
action has one14.5s total UI budget, at most two original-ID queries, at most5s
per attach (or the remaining budget), and at most1s native state observation.
Revalidate each record; retiring the first must not invalidate an exact second
receipt. No lock may be held over IPC. These details govern the bounded workers.

## Checkpoint68 Progress

1. Page controller/UI:60 controller and41 rendered synthetic cases pass. The
   independently reproduced two-page terminal-quarantine resurrection is fixed.
2. Worker: same-owner attach and dual records implemented. Rejected retirement
   before/after commit now reconciles exact live/durable proof; independent fix
   re-review found no remaining P1/P2. No generic error clears an uncertain record.
3. Native: pinned association, attach and immediate quiescence implemented. The
   late positively verified exit reports stopped during quiescence without
   changing saved-running intent; arbitrary failed state still cannot finalize.
4. Integration: first full product and269/4skip native runs passed; later focused
   repairs passed133 controller/worker/source and23 native cases. Final full
   product rerun/build in progress; installed candidate unchanged.
5. CI: earlier512bd875 Windows delivery and extension suites passed; native
   Windows recovery step timed out. Async diagnostics and disjoint35-case groups
   passed locally without relaxed case/child/step bounds. New source requires
   fresh hosted checks; the older passes do not cover these bytes.
6. Release/Store: not tagged, published or submitted for the new version.
