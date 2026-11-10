# Validation and Evidence Boundaries

## Version 3.0.12 — Unreleased Candidate, November 11, 2026

The complete current local `npm test` run exited successfully after the
held/repeated-Enter manual-takeover correction. It includes editor104/104,
background80/80, scheduler state64/64, release adapter72/72, integration14/14,
UI41/41, support59/59, official ProseMirror/MV3 57/57 and separate editor browser
11/11. The complete57-case MV3 suite also passed against a freshly extracted
runtime-only Store ZIP. No case-selection environment variable narrowed those
runs. Local page fixtures are not signed-in ChatGPT or Dot acceptance.

Additional current local runs: native285total/281pass/0fail/4platform skips;
bootstrap297total/281pass/0fail/16security/platform/cache skips; Python packaging
and release tests206total/161pass/0fail/45platform/runtime skips. The standalone
combined setup release tests passed17/17. Skipped checks are unverified, not
passed. The hosted Windows launcher passed12/12 with a freshly built preview
kit's read-only Plan; that is neither real installation nor a replacement for
fresh GitHub Actions evidence about the earlier cloud timeouts.

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
exactly-once delivery or permanent compatibility with the live website. An
unknown result is not retried immediately, but the next normal interval can
attempt another send. Pause and inspect the conversation if necessary.

The target must remain executable, signed in and reachable. Background timing,
tab freezing, network failures, browser policies and site updates can affect
operation. No universal no-focus-stealing, uptime or delivery guarantee is made.

The release contains no native host, administrator broker or Linux-control
installation. Those experimental components are a separate unfinished effort.
Historical test records remain available through Git history; earlier broad
delivery guarantees must not be treated as current evidence.
