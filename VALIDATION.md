# Validation and Evidence Boundaries

## Current Continuation, November 17, 2026

The new Store item 3.0.22 is publicly published and its live listing is accessible.
This is the previously submitted package, not the current unversioned fixes.
Main `37edbb25` fixes late replacement receipts during accounting and prevents
an outer retry after admitted MAIN authority. Three added regressions fail on
the prior commit; current safety passed 102 state, 355 v2 and 217 Node cases
plus source guards. The document-pinned follow-up passed 104 state cases,
48 focused cancellation/restart cases and 23 authorization browser cases.
Final-source check and support passed. The latest unfiltered npm process was
interrupted without a final exit result; its earlier groups passed, but it must
not be reported as a complete npm command pass. The remaining default
ProseMirror suite passed in two same-source partitions, 66/66 and 135/135;
editor-commit browser passed 14/14. No installed acceptance is established.
See `docs/WINDOWS-RECOVERY-20261117.md` for exact logs and scope.

## Version 3.1.0 — Release Candidate, November 20, 2026

Implements Exception Dialog Engine (`dialog-classifier.js`) to classify dialog contexts before auto-allow dispatch, detecting session expiration (`session-expired`), external OAuth popups (`oauth-popup`), and unrecognized blocking modals (`unknown-modal`) with optional Chrome notification support and fail-open guarantees. Passes all 9 acceptance tests in `tests/dialog-classifier-tests.mjs`.

## Version 3.0.25 — Release Candidate, November 18, 2026

Eliminates main-thread DOM scan lag on long Dot/ChatGPT conversations via turn-scoped scanning, $O(1)$ fast-rejection filters before layout/style checks, scroll-aware deferral, and `requestIdleCallback` scheduling.

## Version 3.0.24 — Release Candidate, November 18, 2026

Expands pre-send tool/permission/authorization/OAuth-login confirmation handling (`auto-allowed` / `auto-allowed-prompt`), spinner/re-render deduplication, and sequential cyclic queue UX for Your dot and ChatGPT conversations.

## Version 3.0.23 — Release Candidate, November 17, 2026

Adds pre-send tool/permission approval prompt detection and automatic allow confirmation (`auto-allowed` / `auto-allowed-prompt`) for Your dot and ChatGPT conversations.

## Version 3.0.22 — Release Candidate, November 16, 2026

Fresh continuation: GitHub v3.0.22 is public, a new Store item contains a 3.0.22
draft, and the owner's diagnostic export reports 3.0.22 with local sent events.
Complete-payload live delivery and current-build Windows lifecycle acceptance
are not established. Baseline `npm test` now reports 11 failures in its safety
test group; later stages do not execute. See the current working-tree record
`docs/CONTINUATION-20261116.md`. The following fixture results predate that rerun.

This candidate starts long text in segments of at most 1,000 UTF-16 units.
A selected 115-case isolated ProseMirror/MV3 batch passed, including
slow-write, pause and content-free unreadable-check diagnostics. Background tests
passed 261/261, check 128+8, support 69/69 and UI 65/65. A separate MV3
selection passed 28/28 after the later pause and unknown-result changes. The complete `npm test` stopped at five
finite adapter failures; Dot adapter passed 79/81, including a synthetic stale
model wrong submission. The 3.0.13 results below are historical; these fixtures
do not establish real-site acceptance. A synthetic fault-injection counterexample
still permits an already-issued MAIN operation to run before its deadline after
Pause persistence fails and cancellation is lost; no real-site occurrence is established.

## Version 3.0.13 — Unreleased Candidate, November 15, 2026

This source candidate has not been installed, released or accepted on a real
ChatGPT or Dot conversation. The latest whole-suite run stops at five scheduler
adapter failures. A selected 88-case isolated ProseMirror/MV3 batch passes,
including paragraph fidelity and stable transformed-text no-dispatch cases.
The synthetic stale external model still causes a wrong submission. The two
temporary-decoration recovery cases stop without dispatch and fail their
expectation of an exact automatic send. Dot adapter tests pass 79/81; one failure
actually sends a stale synthetic model. These are isolated fixtures, not real
site acceptance. Prior 3.0.12 results below are historical and do not validate
3.0.13.

## Version 3.0.12 — Historical Candidate, November 11, 2026

The then-current local `npm test` run exited successfully after the
held/repeated-Enter manual-takeover correction. It includes editor104/104,
background80/80, scheduler state60/60, release adapter72/72, integration14/14,
UI41/41, support59/59, official ProseMirror/MV3 57/57 and separate editor browser
11/11. The complete57-case MV3 suite also passed against a freshly extracted
runtime-only Store ZIP. No case-selection environment variable narrowed those
runs. Local page fixtures are not signed-in ChatGPT or Dot acceptance.

Additional current local runs: native285total/281pass/0fail/4platform skips;
bootstrap297total/281pass/0fail/16security/platform/cache skips; Python packaging
and release tests209total/164pass/0fail/45platform/runtime skips. The standalone
combined setup release tests passed17/17. Skipped checks are unverified, not
passed. The hosted Windows launcher passed12/12 with a freshly built preview
kit's read-only Plan; that is neither real installation nor a replacement for
fresh GitHub Actions evidence about the earlier cloud timeouts.

A targeted local Windows preview-kit run passes both isolated Chromium control
and browser-managed registration cases. Registration previously returned a
truncated receipt because the terminal driver treated foreground exit as stream
completion. It now drains registration to EOF within the unchanged deadline and
output limit. The terminal protocol tests pass18/18, including delayed-tail,
missing-tail and output-limit checks. This local correction does not prove the
cause or outcome of the failed native Actions run42925907434 on4698bc6, whose
Windows step19 failed after step18 passed; a fresh cloud run is still required.

Fresh candidate administrator, combined setup and extension package bytes have
been assembled and checked locally without installing or activating them. Final
setup-linked packaged-browser checks are tracked separately in the
[Runtime Acceptance record](https://github.com/1235357/agent-continue/blob/main/docs/RUNTIME-ACCEPTANCE.md).
Current-candidate signed-in sending, administrator file/shell/process tools,
Pause/Revoke, full browser-reopen recovery, GitHub publication and Chrome Web
Store submission all still require their own actual receipts. Historical r11 or
3.0.4 deployment evidence cannot establish those requirements for this candidate.

## Version 2.2.1 — Historical Scheduler-only Release

The scheduler patch has a fresh successful local `npm test` run covering ordinary
ChatGPT, Dot, document import, bilingual UI, real isolated MV3 loading, browser
restart recovery, and official ProseMirror fixtures. Dot adapter coverage is now
48 scenarios; MV3 integration has 10, ordinary composer coverage has 16, and UI
coverage has 15. The focused release-adapter suite passed 36 tests after the last
test-only addition. Packaging has six deterministic archive tests; canonical
release-source and create-only publication checks have seven tests.

Nine new browser-free cases cover historical key hydration and conservative
handling of recycled message nodes; the eight key-hydration reproductions failed
before the predicate fix and passed after it. Two real Chromium Dot scenarios
also cover assigning or changing the key of the same historical row.

These are synthetic-page and local build observations, not signed-in live ChatGPT
or Dot acceptance. Same-node hydration and same-key clones are rejected, but an
old message remounted with both a new node and an unseen key remains ambiguous
under DOM-only confirmation. Reusing a known node for a genuine new message also
remains unknown rather than advancing the queue. No exactly-once guarantee is made.

Stable release permissions are unchanged. Windows device/admin controls remain
excluded. GitHub Actions, Release assets, store submission and publication must
each be checked independently; a local pass does not establish any of them.

## Version 2.1.0

Validation date: November 2, 2026. The release adds English-default presentation
and optional Simplified Chinese without changing the single-submission contract.

| Suite | Scenarios |
| --- | ---: |
| Localization unit/metadata | 4 |
| Background state | 18 |
| Background concurrency/recovery | 32 |
| Release adapter safety | 13 |
| Basic browser adapter | 13 |
| Dot adapter | 38 |
| Dot keyboard | 12 |
| Local file import | 16 |
| UI, including bilingual switching | 15 |
| Real isolated MV3 extension | 9 |
| Official ProseMirror/MV3 | 5 |
| Total | 175 |

The first combined run exposed two test expectations tied to the previous
Chinese default. Those assertions were updated to the English strings, retaining
the underlying no-send/start checks; the affected MV3 group then passed. Existing
Chinese-copy fixtures explicitly select Chinese, with new coverage for English
default on a Chinese browser locale and English/Chinese/English switching.
Release-source guards, syntax checks and six deterministic archive tests are
additional checks, not included in the scenario total above.

All browser fixtures use synthetic content and separate throwaway profiles.
They do not open the user's signed-in Chrome profile or read real prompts.
The language-switch scenario checks popup, desktop and narrow layouts, preserves
user-owned Chinese prompts/queue labels/chat titles, and checks that switching
does not dispatch START or SEND requests. Screenshot assets use English synthetic
labels; the store console capture is 1280 by 800 RGB PNG without alpha.

Local tests and a generated archive do not prove GitHub publication, successful
cloud CI, store submission or store approval. Those states require their own
platform receipts. Store version 2.0.1 was observed as Published - public before
preparing this update; this does not establish publication of 2.1.0.

## Runtime Limits

Confirmation means a matching new user-message marker appeared in a supported
page fixture. It does not establish successful model inference, scientific work,
exactly-once delivery or permanent compatibility with the live website. The
current source candidate pauses an unknown result and asks the user to inspect
the conversation before resuming; this is not a live-site acceptance receipt.

The target must remain executable, signed in and reachable. Background timing,
tab freezing, network failures, browser policies and site updates can affect
operation. No universal no-focus-stealing, uptime or delivery guarantee is made.

The release contains no native host, administrator broker or Linux-control
installation. Those experimental components are a separate unfinished effort.
Historical test records remain available through Git history; earlier broad
delivery guarantees must not be treated as current evidence.
