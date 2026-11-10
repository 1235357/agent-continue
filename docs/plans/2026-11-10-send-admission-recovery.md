# Send Admission Recovery

## Problem

The existing lost-result fixture invokes the real page function before rejecting
the injection API. It does not cover a rejection before the page function starts.
`executePage` waits for that missing invocation's result indefinitely, so restoring
the renderer alone cannot recover this case. This is a source-derived hypothesis
to reproduce, not an attribution of the owner's real-site failure.

## Technical Plan

Keep the same worker run ID and unpredictable result token throughout recovery.
In the extension's ISOLATED world, synchronously register the invocation before
starting any asynchronous page action. Repeated admission of that exact token
returns the same promise or settled result; it must never execute another send.
A small read-only injected snapshot returns only admission state and the existing
bounded adapter result. Recovery checks the still-enabled exact task before any
reattachment and targets the bound document once its identity is observed.

Use a low-frequency worker retry timer, separate from renewable MAIN permits.
There is no total readiness or recovery deadline. A submitted invocation is never
replaced by a new token, another send method, or another conversation. Manual
Pause invalidates the worker run before housekeeping and remains authoritative.
This work does not alter Windows device controls, approvals, permissions, prompt
length, production connections or the currently installed extension.
Keep at most the initial unresolved admission plus one unresolved recovery
admission; a hung transport must not accumulate a new pending request on every
probe. A probe itself is serialized and can also wait without another probe.

## Alternatives

- Waiting only: preserves at-most-once, but cannot recover an absent invocation.
- Blind reinjection: unsafe when an API rejection hides a running invocation.
- New round/token: also unsafe after an unknown dispatch; rejected.
- Per-document execution registration plus reattachment: selected. Bound memory
  by pruning only settled older entries; an old evicted run still cannot pass
  current worker authorization, while an active entry must never be evicted.

## Detailed Implementation And Acceptance

Change `adapter.js`, `background.js` and the actual-MV3 ProseMirror fixtures.
Register the per-document promise before the first microtask. Return no prompt,
DOM, raw exception, file path or private token from diagnostics. Reuse existing
result-channel categories and keep normal completed execution independent from
the redundant message channel. Avoid concurrent recovery probes/admissions.

Required cases: pre-admission rejection recovers once; an initially queued or
hung API call cannot cause a second submission when released later; duplicate
admission during an active send and after its result returns the same execution;
Pause before admission prevents later dispatch; lost ordinary/message results
can be read back without replay; existing long hidden readiness, late text
replacement, attachments and at-most-once tests continue to pass. Synthetic
browser evidence is not installed real-site acceptance or release evidence.

## Observations And Review Limits

The first pre-admission fixture was run before the production change and failed
at its explicit missing-recovery assertion, exit1. Existing rejection coverage
had already called the real injection, confirming the missing distinction.
The five initial real-MV3 cases passed after the correction. Added coverage also
checks a persistently unreachable renderer, bounded outstanding admissions and
late requests after Pause. Result readback uses its own fixed `page-readback`
diagnostic category; it is not mislabeled as an extension-message response.

One independent, artifact-only reviewer was requested; the workspace-credit
error prevented it from running. No independent review or formal full-source
EGM certification is claimed. Main-agent source inspection and executable
regressions remain the available evidence, with live-site and release gates open.
