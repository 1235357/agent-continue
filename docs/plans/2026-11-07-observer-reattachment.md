# Bounded Observer Reattachment

## Problem

The current admin-browser.js retains its attach promise/seal after any native
port loss. An already acknowledged observer cannot reattach while its worker
remains alive. That is a concrete component gap in the full automatic recovery
requirement. Reattaching an observer alone is not runtime recovery or hosted
delivery, and must not be reported as such.

This scoped increment changes browser source only. It does not mutate the
installed79958886 runtime, accepted D940, live extension/profile, credentials,
registration, tasks, tunnel, original scheduler task or Pause. Full original goal
remains active. EGM-style explicit contracts, test-first implementation and fresh
scoped review are an autonomous adaptation, not complete method-adoption proof.

## Technical Plan

After an exact correlated `session/attached` acknowledgement, an unexpected
native disconnect may schedule an observer-only attachment. Retry at1s,5s,15s,
with at most three replacement attempts per worker. Every replacement uses a
fresh transport ID and exactly `{version:1,action:'session',id,wake:false}`.
Never call one-shot wake, control mutation, lifecycle writes or Task.Run.

Keep the existing once-per-browser startup wake marker and initial restore/grant
semantics unchanged. Acknowledging a replacement does not refill the budget.
Only one timer/permission-check/port may be pending. Duplicate or stale disconnects
and late old-port replies cannot affect the current replacement. An initial
failure before any exact ACK is not automatically retried.

Initial malformed/unconfirmed/extra session replies remain terminal. A malformed
replacement ACK also cancels recovery. Permission removal synchronously cancels
the timer, closes the retained port and invalidates pending permission checks;
later grants do not reopen a revoked worker. Failed replacement connect/post or
replacement disconnect may consume the remaining observer-only budget. Failure
to verify permission stops recovery. Timers may be unref'd and are not a durable
alarm or exact wall-clock guarantee; new workers still attach with wake:false
because the browser-session startup marker remains consumed.

## Alternatives And Product Gap

Do not clear the session startup marker, reset attempts on every ACK, retry an
unconfirmed control, route recovery through connect, or label attached as Ready.
Do not add a resident monitor or frontmost window. Restoring saved-running high
runtime after observer loss needs its own durable admission/recovery path; the
existing manual resume-saved route can request UAC, while the old startup demand
does not supply a per-operation recovery receipt. Blindly repeating either is
not the requested seamless reliable reconnect. That product gap remains open.

## Implementation And Acceptance

Parent owns admin-browser.js and new tests/admin-browser-recovery-tests.mjs.
Use an injected timers object for deterministic tests without sleeping or native
processes. The production defaults are fixed and no new runtime message exists.
Preserve existing status/Pause/reconciliation and scheduler independence.

Test exact replacement frame/wakefalse, startup marker unchanged, finite3-attempt
budget, duplicate-loss coalescing, old reply isolation, pre-ACK failure denial,
malformed replacement denial, permission removal before and during reattach, and
replacement connect/post failures without native wake/control fallbacks. Run
existing admin-browser/control and scheduler/package regressions afterward.
Do not deploy or claim browser/runtime recovery from synthetic ports.
