# Agent Continue 3.0.22 Continuation

## Latest Windows Continuation (2026-11-17 UTC)

Current source is `main` / `666b006`, not the original 3.0.22 release snapshot.
It includes `37edbb25` late-receipt accounting, `11b4207` document-pinned
no-dispatch retry and `cb839d7` empty-draft/initial-selection recovery.
The canonical Git-LF Windows six-asset closure, matching extension pair and npm
tarball are built locally; clean package tests passed 115/115 and temporary
native IPC passed 12/12. Fresh Store readback: new 3.0.22 and original 3.0.20
are both Published - public; the new public page and profile links were read.
This supersedes the earlier pending-review observation below.
See the recovery checklist for actual
installed/browser lifecycle gates; no new Release or Store write was made.

The full Windows-first goal is now active again. This supersedes the historical
paused-goal statements below. See [the Windows recovery checkpoint](WINDOWS-RECOVERY-20261117.md)
for live read-only inventory, native registration and Setup UI fixes, test
results and the remaining package/lifecycle acceptance gates. The in-app
browser currently works; Chrome selection returns unavailable.
Extension pages are legitimate, but the explicit automation protocol restriction
was not bypassed. The owner requests refresh of the existing development
installation, not repeated installation; no Reload click is claimed yet.

New native/setup fixes are scoped source changes, separate from permissive
3.0.22 sender behavior and the submitted Store package. The older strict
whole-payload requirement remains superseded by the owner's explicit policy.

## Final User Clarification and Submission

This section supersedes the strict-fidelity release hold described later in
this chronological record. The user explicitly accepts adoption of changed
prepared composer text and heuristic/partial receipt confirmation as intended
3.0.22 behavior, prioritizing continued submission. Do not reintroduce strict
whole-payload matching as a release gate without a new product decision.
Manual Pause, current authorization and the bound conversation remain required.

The new item's English description now discloses changed/normalized prepared
text and approximate/partial local confirmation. At the user's direct request,
item `jgjoeiidbnpmgbbhhmphicehbcdgbhga`, package 3.0.22, was formally submitted.
The platform displayed **Your extension was submitted for review** and
**Pending review**. **Publish automatically after review** was checked during
submission. Proof: `.artifacts/resume-20261116-store-proof/review-submitted.jpg`.
This is a submission receipt, not an approval or public Store release.

Only this turn's strict adapter and Dot-test changes were mechanically reversed
back to acquired HEAD `a27de6e`; `git diff --exit-code -- adapter.js
tests/dot-adapter-tests.mjs` returned 0. The independently scoped popup Clear
late-reply fix and its UI tests were preserved. Existing GitHub Release assets,
the original Store item, production connections and user tasks were not changed.
The broad Windows-first goal remains paused; this direct Store request was
completed separately. No worker test session remained running at checkpoint.

Public documentation was committed and pushed to the sole working branch
`main` as `41ca04a` (`docs(store): record 3.0.22 submission and delivery policy`).
That commit contains only `PRIVACY.md` and `docs/STORE-LISTING.en.md`; it does
not include the owner diagnostics, this private continuation record, or the
uncommitted popup fix. Final support/diagnostic/public-documentation checks
passed 69/69. The final submission copy is 3405 characters. No new binary
package or Release was published in this continuation; public v3.0.22 remains
unchanged.

## Scope and Source Identity

Work resumed at `main`, commit `a27de6e3b788beb3ab079b65e066945d3b2ce2ba`,
tag `v3.0.22`. The extension is 3.0.22; the separately versioned npm CLI is
0.3.0. Source changes made after this checkpoint are not the uploaded package.
The full Windows-first goal remains active, not complete.

GitHub's release API independently reports public, non-prerelease `v3.0.22`,
release ID `447757627`, published at `2026-11-16T23:41:56Z`. Its Store ZIP
digest is `050f476e7b82dc00d8eba03484ce7e8fc59167ee68f3cc775c38037403e2cd01`;
the standard ZIP digest is
`0e42a335197a176366e210be8b186147daaae4daaf313a18fef15aa036594755`.
These match the independently inspected local artifacts. Existing Release
assets were not replaced. Release availability is not a successful full test
run or Store approval.

User priorities remain background sending of the configured prompt, preparation
recovery without a fixed overall waiting limit, no application prompt-length
cap, explicit Pause, and useful content-free diagnostics. These requirements do
not permit sending into another conversation, treating arbitrary draft text as
the configured prompt, inventing a receipt or blindly replaying a submission
whose result is unknown. A successful local receipt is not proof of model task
completion.

## Chrome Web Store Observation

The user-uploaded item is a **new draft**:
`jgjoeiidbnpmgbbhhmphicehbcdgbhga`. Its Package page reports version 3.0.22,
English and Chinese, and no published version. It is not an in-place update of
the original item `jpioilmpbolfokedaefmbfbjeaahfdkl`. The original item's
Status page reports Published / Public; it was inspected without modification.
Do not delete either item or withdraw another review merely to consolidate IDs.

The new draft's English description, Workflow & Planning category, project
homepage, support URL and privacy policy URL have been saved through the
in-app browser. Its description includes:

- Developer: Zhentong Ye
- Email: `zhentongye2028@u.northwestern.edu`
- Personal GitHub: `https://github.com/1235357`
- Project: `https://github.com/1235357/agent-continue`
- LinkedIn: `https://www.linkedin.com/in/tony-zhentong-ye/`

Permission explanations cover activeTab, scripting, storage, alarms, optional
power, optional nativeMessaging and the chatgpt.com host permission. Disclosures
include account-wide optional Windows tools, OpenAI transport, local plaintext
storage, separate scheduler/device Pause and runtime-removal limitations.

Data handling categories selected: personally identifiable information,
authentication information, personal communications, web history, user
activity and website content. These include local handling and the separately
authorized runtime, not a claim that the developer collects user content.
The user expressly confirmed the three limited-use developer declarations;
they were checked and saved. This confirmation only authorized saving the
draft, not submitting it for review.

The 128x128 project icon and a freshly regenerated 1280x800 RGB English console
screenshot have been uploaded. The screenshot uses only synthetic content;
SHA-256 `f81b7d81795dc2138d3f4bb0376adabee15bf25ee52115a11a23d0a10ab01801`.
Its generator retains the legacy filename `store-2.1.0-en-console.png`; that
filename is not the source version. The 499-character reviewer instructions
were saved with no developer login, password, runtime key or owner log.
Distribution was observed as Free of charge / Public / All regions and left
unchanged.

An uploaded package, saved fields, a Git tag and a local ZIP do not constitute
a Store review submission or approval. No new review was submitted in this
continuation checkpoint.

Final UI readback: Save draft disabled, Submit for review enabled, item still
Draft. The in-app draft tab was retained. Proof screenshot:
`.artifacts/resume-20261116-store-proof/listing-saved.jpg`.

## Owner Diagnostic Export

Input: `D:\Downloads\agent-continue-activity (14).json`, 121359 bytes,
schema 5, reported extension version 3.0.22, relative timestamps.

The export retains 94 activity rows and 20 delivery snapshots, with no reported
omitted rows/snapshots and no observed diagnostic persistence failure. Activity
events include 11 `sent`, 11 `unconfirmed`, 21 `busy`, 23 `browser-restored`,
20 `started`, four `blocked`, three `paused` and one `interrupted`.
The latest three retained deliveries report hidden-page operation, one fill,
one dispatch attempt, one receipt check, 53 chunks/DOM writes, one slow chunk,
and no chunk or prefix-rewrite restart. They report `receipt-confirmed`.

These are local observations, not an independent comparison of the complete
configured prompt with the resulting user message. The 3.0.22 matcher accepts
substring/head-tail similarity, and persistent preparation can adopt changed
composer text. Both need regression coverage before trusting the count as
complete-payload proof. Do not upload the owner's diagnostic file to the Store
or a public issue.

## Fresh Verification and Remaining Gates

Baseline `npm test` exited 1 in `test:safety`; the captured Node test group
reports **11 failures**, including NBSP/space receipt ambiguity and repeated
composer edits during authorization. Later npm stages did not run through this
command. Evidence: `.artifacts/resume-20261116-full-suite.log`.

An independent local audit passed 477 administrator-control tests, 79
administrator-browser tests and 282 device/control tests without failure or
skip. These are synthetic/scratch tests, not fresh hosted Windows acceptance.
Historical ordinary ChatGPT/Dot file/PowerShell/owned-process and lifecycle
receipts apply only to their original native bundle identities. Current 3.0.22
Windows lifecycle and complete-payload hosted acceptance remain unestablished.

Remaining work: repair the open sending/receipt regressions without weakening
receipt evidence, then freeze and validate the exact final artifacts. Completed
Clear/late-write and Store-asset work is recorded below. Keep production
VPN/MCP/IDE/research and the external
Chrome original task unchanged. Never repeat a native operation with an
unknown result under a new operation ID.

## Clear/Save Race Repair and UI Verification

The continuation reproduced two popup late-reply defects: an obsolete conflict
reply can rewind the post-Clear revision, and an obsolete save completion can
replace successful Clear feedback with a failure. Old-prompt resurrection was
not reproduced on the acquired baseline. The popup fix captures the dispatched
generation and rejects obsolete replies before processing success/conflict
metadata; autosave feedback is fenced by its originating content epoch.
No background storage schema or stored user prompt was changed.

Deterministic late-success, conflict and transport-rejection regressions were
RED before the fix and GREEN afterward, with same-generation edit and genuine
save-failure controls retained. Focused tests passed 6/6; background state
86/86; background v2 355/355; syntax/check 128 + 11. The full UI suite passed
70/70 after updating a stale English-copy assertion to its current equivalent
sentence without removing unknown-result Pause or inspect-before-Resume checks.
Support/diagnostic/public-documentation tests passed 69/69 after the final copy
update. These changes remain an uncommitted source candidate; they are not
inside the already published v3.0.22 ZIP or the already uploaded Store package.

## Paused Goal and Conditional Submission Checkpoint

The user paused the full goal, then directly authorized formal Store submission
only after accuracy was confirmed. The broad goal remains paused; this is not
a new authorization to continue the entire native lifecycle backlog. The
submission condition is not currently met, and no Submit action was performed.

The parent reran `node --test tests/release-adapter-tests.mjs` against the local
WIP: **76/81 passed, five failed**, zero skips. The six original NBSP/space
receipt failures now pass. The remaining five still return `blocked` where
the tests expect configured-prompt recovery and one dispatch after repeated
composer edits/reauthorization. No expectation was weakened to obtain a pass.

Independent read-only review of adapter SHA-256
`51146f2927c00e5bf1d7b6299fa7de0ebf911a650ec36a0528f9ac095fb5c355`
also identified two source-derived counterexamples, not yet live-site proofs:

1. P1: occurrence-unbound Markdown evidence can accept changed identifiers.
   Configured `data_value_ and _value_` can normalize to the text from
   `<p>datavalue and <em>value</em></p>` because the same emphasis evidence is
   reused for both source occurrences. Payload and receipt admission share
   this helper. Resolve or disprove before publishing this WIP.
2. P2: nested `**bold _italic_**` is not normalized compositionally and can
   reject legitimate nested strong/emphasis markup.

These findings and remaining tests prevent describing either the uploaded
3.0.22 or the local successor as fully verified. The published assets and
uploaded package were not replaced with uncommitted changes. Preserve all
WIP, original operation IDs, and the saved Store draft for the next explicitly
resumed development step.
