# Delayed Send Readiness

## Problem

The owner reports actual 3.0.4 text left in the Dot composer, zero confirmed
sends and unconfirmed status. This overrides any general stability inference
from prior synthetic package passes. Live IAB inspection sees one ProseMirror
composer and one scoped Send button; trusted Control+Enter sent one unique
diagnostic marker and received its reply. This proves that manual keyboard
submission works there, not that extension-created events work.

Source inspection finds a concrete uncovered timing case: the MAIN helper
updates the model and immediately selects an enabled button. A page may enable
the button on a later framework render; auto then tries a synthetic key which
the page can ignore. Existing model fixtures enable Send synchronously. Fresh
owner logs are unavailable; the existing Downloads export is from November 6.

## Technical Plan

Keep a single durable COMMIT_RUN reservation and at most one submission attempt.
Separate MAIN helper operations into prepare (model replacement, no submission),
observe (read-only scoped Send readiness), and commit (reassert configured model
and submit once synchronously). The extension worker, not hidden page timers,
waits for readiness and rechecks the existing run/target/Pause authorization
between observations and immediately before commit. Unknown transport or commit
results never authorize a second submission method.

Only auto/button wait for a known scoped Send to become enabled. Explicit
ctrl-enter retains its selected semantics; a genuinely absent Send can retain
the current documented keyboard fallback. Ambiguous enabled controls remain a
non-dispatch failure. No arbitrary page-global button, disabled-button click,
debugger permission or trusted-event workaround is introduced.

Preserve content-free fixed diagnostic reasons across the helper/worker/adapter
boundary, including known no-dispatch versus attempted/unconfirmed. Never count
model preparation, composer clearing or a key event as a successful message.

## Alternatives

- Retrying another method after unknown delivery can duplicate a request.
- Raising a generic timeout does not fix premature keyboard fallback.
- Synchronous DOM-only repaint may submit the wrong page model.
- Hidden-page setTimeout can be clamped; retain extension-owned observation.
- New debugger permission or native input is unnecessary for a scoped button.

## Detailed Implementation And Acceptance

First reproduce delayed activation plus ignored synthetic keys in the existing
real ProseMirror browser fixture. Then change editor-commit.js and background.js,
with narrow adapter/diagnostic propagation. Retain the configured payload,
exact conversation, attachment refusal, Pause and one-dispatch ledger.

Test the full worker-to-helper path: delayed enabled button produces one click,
zero synthetic keys and one matching receipt; Pause during preparation produces
no commit; a worker restart/duplicate request cannot repeat dispatch; a changed
composer or unknown helper result cannot authorize fallback. Existing keyboard
choice, no-owner fallback and content-rewrite regressions must continue to pass.

Package and regression results remain distinct from installed-IAB or actual
owner Chrome acceptance. Do not change the owner's running task, prompt or
interval, native runtime, VPN, production MCP or research processes. Do not
cancel Store review or publish a fix on synthetic evidence alone.

## Review And Implementation Follow-Up

Independent parallel review was an owner-authorized adaptation, not a claim of
complete formal EGM source adoption or certification. Review found a transient
disabled -> absent -> enabled gap, plus first appearance at a final no-dispatch
correction. Both now retain the scoped-button requirement. The original sender
documentId pins every stage to the same document. Explicit final correction no
longer emits another input/change event, preserving the existing single-restore
regression instead of weakening its expectation.

The owner added a requirement to remove application-set prompt limits. Config,
textarea, import and queue-text checks are updated together, with exact-text
regressions and unchanged binary document resource safeguards. Browser/platform
capacity failures remain errors, not a reason to silently truncate user content.

Do not claim Pause can retract already-admitted Chromium IPC. A matching user row
arriving during the readiness wait is an outstanding attribution edge case,
separate from this reproduced blocked-send fix. Live installed acceptance and
current-installation device lifecycle remain open, not hidden by local passes.

## Subsequent Receipt And Publication Reconciliation (2026-11-09)

The matching-message attribution edge above was addressed by a synchronous
isolated-world history snapshot at the final dispatch boundary, not by counting
preparation or clearing as success. Both the ignored-submit negative case and
actual-submit positive case passed in the disposable MV3 fixture. This does not
prove server acknowledgement, arbitrary page-script isolation, or live-site
acceptance. Source helper/capacity100/100 and worker51/51 rechecks passed.

Tag v3.0.5 at bb877e087dc2f9ed513e5de2127d57cfa894f1ad prematurely triggered
Release42576016195 before the live gate above was satisfied. That workflow was
canceled before publication; authenticated GitHub readback is Cancelled5m43s.
The successful windows-sidecar build remains evidence of a build only. No new
Store submission or installed extension update followed. The original live-site
and lifecycle gates are retained, not retroactively waived by local test passes.
