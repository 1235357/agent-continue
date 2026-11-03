# Agent Continue Development Handoff

Checkpoint: November 3, 2026, America/Chicago. Next-stage development is **paused
at the owner's request because of usage limits**. Synchronizing existing work
and preparing this handoff do not resume the product-development goal.

## Read This First

This is one project with two distinct capabilities: an existing prompt scheduler
and an unfinished direct-device integration. Do not confuse a scheduled prompt,
a running process, a configured profile, or a successful local fixture with
successful model inference, completed research, or a connected authorized device.

The public stable extension is **v2.2.0**, confirmed on GitHub at this checkpoint.
The last confirmed Chrome Web Store state was public 2.0.1 and submitted 2.1.0
Pending review, automatic publication selected. A fresh store visit required
Google identity verification, so that historical state is **not a fresh claim**.
Do not withdraw or resubmit the pending item just to synchronize development.

The newly verified device-bootstrap package is **private 0.3.0**, not extension
v0.3.0 and not an npm publication. No stable extension tag, store upload, production
activation, native registration, new OS privilege, or startup policy is implied.

The companion handoff archive preserves the complete project working-source
snapshot, including unshipped Devices/Setup candidates; a Git bundle of main and
tags; the remaining tracked-file patch; file inventories and checksums; and this
document. The local full archive additionally includes legacy prototype source
and public offline assets where available. It deliberately excludes credentials,
browser profiles, private prompts, research files, production state and npm caches.
Those are not needed to reproduce source development and must not be published.

## Product Intent And Decisions

The owner wants a free, open-source, English-default extension with optional
Simplified Chinese, one canonical `main`, and prominent developer/support links.
User prompts, imported files, labels and conversation titles stay untranslated.
GitHub may lead store review; package, CI, Release, store submission and public
availability are separate evidence levels.

The expanded goal is straightforward onboarding to full file, shell and process
access under the actual selected OS identity, including explicitly authorized
administrator/root use. It supports both ordinary ChatGPT and Your dot. It is
**not** a status-only service, VM, container, product directory sandbox or command
allowlist. One complete informed consent should describe the workflow; internal
validation receipts are not repeated mandatory approval dialogs. Real OS and
platform grants still have to exist; a browser checkbox cannot manufacture them.

The data path must be direct:

```text
Prompt scheduling: extension -> selected ChatGPT/Dot composer

Device control plane: extension -> installed native coordinator -> OS lifecycle

Device tool data path:
ChatGPT / Dot <-> official OpenAI tunnel <-> target device <-> MCP stdio core
```

No Vercel/developer command relay and no permanent Windows relay for remote
Linux. Windows may be an initial SSH deployment entrance, not a runtime dependency
for the server. Existing private production MCP deployments are predecessors,
not proof that the reusable Agent Continue product is deployed.

## History And Why The Design Changed

| Stage | Motivation, implementation and correction |
| --- | --- |
| Early 0.1 prototype | Repeat a custom prompt in one existing chat; start/pause/check, token/deadline and draft protection. Historical unknown delivery could pause the task. |
| 0.2.0, October 23 | Dot support, default 20-minute unlimited repetition, queue/file import, local console, restart recovery and bounded offline PDF resources. Unknown submission became a retained unknown cycle, not immediate replay. |
| 0.2.1 | Real reports of text filled but not submitted motivated stop/reidentify/fill/send and preservation of unrelated drafts/attachments. |
| 0.2.2 | Dot Ctrl+Enter versus ordinary ChatGPT button handling; single-mechanism keyboard contract. Native keyboard acceptance is not synthetic-event acceptance. |
| 0.2.3 / 1.0 / 1.1 | Experiments added MAIN-world/editor internals and multi-path fallback; UI widened to 650px, restart/route and message markers improved. Some historical release claims overstate guarantees and are superseded below. |
| 2.0.0, November 1 | Source and exported activity review exposed ambiguous `unconfirmed` logs and duplicate-submit risk. Returned to one permitted mechanism per attempt; removed internal React/ProseMirror replay and immediate fallback. Unknown is neither confirmed success nor definite failure. |
| 2.0.1 | Corrected outdated multi-path UI claims and generated synthetic English store assets. Fixed store packaging: root manifest and missing content.js. |
| 2.1.0, November 2 | English default/Chinese switch, docs/privacy/store copy, user text preserved, canonical main. Store submission and automatic-after-approval setting were observed separately from GitHub release. |
| 2.2.0, November 2 | Developer support, email/GitHub/LinkedIn, optional reviewed diagnostics, schema 3 export, malformed-log recovery and separate language/export errors. Native candidate excluded. |
| Private MCP predecessor | Hosted Desktop Commander Remote established the use case. The owner required private official-tunnel direct Linux/Windows operation, manual pause/revoke and no focus stealing. Private privileged prototypes and source-stage tests were not a distributable first-install product. |
| Reusable native core | Reused pinned open-source DesktopCommanderMCP 0.3.1, not its commercial hosted `remote` launcher. Added consented full-account configuration, telemetry-off before import, fixed stdio path, owned lifecycle and profile verification. |
| Bootstrap 0.1 / 0.2 | Added locked acquisition without install hooks, then six-platform pinned OpenAI runtime-only v0.0.19 acquisition. Fixed Windows npm prerequisites, bin CRLF rewrite, unconfirmed child exit, case aliases and inflater ownership/cancellation. |
| Bootstrap 0.3, this checkpoint | Browser's five-field request now composes acquisition, state and official profile in one consented setup command. Final receipt says configured, never authenticated/activated. Actual packed-installed-bin preparation passed locally. |

This reconstruction uses the current source, Git history, changelog, reviewed
notes and the owner's instructions. It is not an export of every personal chat.
`git-log.txt` and `history.bundle` preserve the available canonical code history.

## Scheduler Contracts To Preserve

1. One submission mechanism per attempt; no forced-enable button, immediate
   fallback click, internal event-handler replay or claim of exactly-once delivery.
2. Require a current background permit and matching target/conversation identity.
   Preserve drafts, user whitespace edits and detected attachments.
3. Only a matching new user-message marker confirms submission. Empty composer,
   busy spinner, process lifetime or CPU activity alone are insufficient.
4. Unknown does not increment confirmed count. Wait the full normal interval;
   another interval can still duplicate a previously accepted unknown message.
5. Pause cannot retract an already dispatched submission. Missing target recovery
   must not create or select another chat silently.
6. Do not activate user tabs, use system clipboard, add telemetry, or infer uptime
   from keepalive. Background freezing and website changes remain real limits.
7. Keep support diagnostics local/manual, bounded to 200 allowlisted records.
   Schema 3 omits stored free text and unknown fields, includes extension version,
   defaults to relative timings and requires opt-in for exact timestamps.

Earlier claims of absolute delivery, no possible focus change, in-memory
encryption or permanent browser compatibility are not current guarantees.
See [Validation](../VALIDATION.md), [Privacy](../PRIVACY.md), and the changelog.

## Current Source Map

| Location | Responsibility and status |
| --- | --- |
| background.js / config.js | Scheduler state, permits, alarms, persistence and recovery |
| adapter.js / content.js | Page checks and single submission path; not native command transport |
| popup.* / i18n* / static-locale.js | Console, English default, Chinese preference |
| support* / activity-export.js | Developer contacts and minimized diagnostic export |
| scripts/package.py | Explicit extension file allowlist; official stable artifacts come from their tag |
| device-control.js / devices.* | Unshipped separate device control page/protocol, optional nativeMessaging |
| setup-model.js | Pure canonical browser request producer; now adopted by verified bootstrap tests |
| setup.* | Unshipped browser guide, target review and explicit local request download |
| native/desktop-commander/ | Pinned provider launcher, profile, consent/state and owned lifecycle source |
| native/bootstrap/ | Private dependency-free package builder, acquisition and setup0.3.0 |
| native/bootstrap/*DESIGN.md | Acquisition/client/setup contracts and bounded failure semantics |
| .github/workflows/ | Extension CI, native platform checks, vMAJOR.MINOR.PATCH tag release pipeline |

Read [native architecture](../native/README.md),
[bootstrap usage](../native/bootstrap/README.md),
[setup design](../native/bootstrap/SETUP-DESIGN.md) and
[device candidate](DEVICE-CONTROL.md) before working on the native integration.
The latter includes historical private-prototype checkpoints; current standalone
bootstrap details supersede its older upstream-pin and consumer descriptions.

## What The Pending Browser Candidate Actually Does

Devices and Setup are independent of scheduler start/pause. Opening either page,
selecting a chat or exporting a request grants no ChatGPT tool access. The
candidate native-messaging envelope uses version/id/action and correlated state
and mutation receipts; do not substitute a generic health response for a matching
completed operation. Status, disconnect-and-pause and reconnect are control-plane
actions, not restrictions on the eventual MCP tools.

The setup request is exact UTF-8/LF pretty JSON with ordered fields:

```json
{
  "format": "agent-continue-device-setup",
  "version": 1,
  "target": "windows",
  "extensionId": "jpioilmpbolfokedaefmbfbjeaahfdkl",
  "nativeHost": "com.agentcontinue.device_control"
}
```

Other targets are macos, linux and linux-server; server nativeHost is null. The
actual installed extension ID must be used. The request contains no shell command,
path, account, credential or approval flag and is not an authentication token.
A browser extension cannot install its own first native host. Never claim that
the current guide has completed native registration or actual platform grants.

The pending Devices UI still uses per-mutation dialogs and a persisted uncertain
operation journal. This predates the owner's later preference for one complete
onboarding consent. Reconcile that experience when development resumes; do not
silently weaken request/identity matching or clear an uncertain dispatched action.
The existing private legacy native protocol and browser candidate protocol are
not drop-in compatible. A matching settled receipt is not necessarily success.
These pending UI sources have not received a fresh full browser-suite rerun at
this handoff checkpoint; preserving them is not releasing or certifying them.

## Latest Verified Native Increment

The private package is built from `native/bootstrap/build-package.mjs`, packed
with npm locally and installed into a review/test prefix. It has no lifecycle
scripts or direct dependencies; the runtime payload supplies a pinned lockfile.
Exact packed closure: **21 files**, including **12 runtime payload files**.

```sh
agent-continue-device setup --install-dir "<new-absolute-directory>" --consent full-account --setup-request "<browser-request.json>" --tunnel-id "<complete-official-id>" --runtime-key-file "<existing-device-local-key-file>"
```

This is an installed local private-package command, **not an advertised npm
registry npx command**. Node22.12+ and a trusted existing npm are prerequisites.
The command stages provider0.3.1 and official runtime0.0.19, prepares INSTALL/state
and a fixed official profile. Key metadata/reference only; no key copy. Key/input/
cache/source/toolchain collisions reject before content acquisition. Existing
destinations and partial installations are never silently repaired or replaced.

Final create-only compact setup-receipt.json reports configured=true. Activation,
authentication, native registration, chat authorization, protected installation
and native dependency usability remain false/unverified. Extension ID is retained
for future binding, not registered. No actual runtime/service/task is started.

Provider npm has a finite180s budget and disabled hooks/config inheritance. Client
acquisition has a cooperative60s budget, fixed official HTTPS/pins and a finite
worker owning decompression resources. Cancellation before receipt commit fails;
successful create-only link wins over later cancellation/temporary cleanup errors.
An unknown child exit retains files and ownership uncertainty, never a false stop.

macOS ZIP hash/profile preparation does not establish Gatekeeper approval. The
[official v0.0.19 README](https://github.com/openai/tunnel-client/blob/v0.0.19/README.md)
supports Homebrew for production. Do not bypass notarization/Gatekeeper checks.

## Bugs Found, Reproduced And Fixed

| Failure | Consequence / correction |
| --- | --- |
| Combined unconfirmed log category | Could not distinguish failure from accepted-but-unobserved submission. Added bounded classifications/timing; do not reinterpret176 rows as176 sends/failures. |
| Multi-path submit replay | Potential duplicates. One mechanism and no immediate fallback in2.0.x. |
| Store archive layout/content omission | Root manifest/content.js fixed and archive tests added. |
| DevTools copy() inside asynchronous callback | Console helper unavailable there; manual minimized export evolved into supported diagnostics UI. |
| Windows npm missing environment / notifier | Preserved required SystemRoot/ComSpec/PATH, disabled update notifier, retained typed exit diagnostics. |
| npm bin hashbang CRLF rewriting | Builder canonicalizes the hashbang before packing. |
| Hidden unzipper inflater resources | Owned finite worker with awaited termination, genuine-deflate cancellation regression. |
| macOS/case aliases and unknown nested exit | Physical dev/inode ancestry checks; no unsafe fixture deletion merely because outer CLI closed. |
| Key aliases request/archive/cache | Metadata-first exclusions before content reads; not runtime directory restrictions. |
| npm metadata symlink to key | Actual RED read attempt, then metadata redirects/nonregular files rejected before contents. |
| Key renamed onto request | Actual RED retained-fd key read, then saved key dev/inode excluded before read. |
| Profile removed during final await | Actual RED false configured success, then reinspection after final async verification. |
| Pretty versus compact final receipt | Exact byte regression retained; compact receipt fixed without changing request encoding. |

These checks are not a privileged, race-free filesystem attestation. Other
same-user mutations and unexercised dependency/platform behavior remain risks.

## Evidence At The Pause

| Evidence | Observed result and limit |
| --- | --- |
| Final local bootstrap+producer suite |122/122pass,0fail/0skip,131.34s; includes28 setup tests and6 pure producer tests |
| Actual packaged installed setup | Real browser producer; fake opaque key; official Windows ZIP;274 pinned provider files; profile inspection;25 MCP tools and owned-file roundtrip; no real account activation |
| Six official ZIPs | All six extracted/byte-verified without executing those clients; not six-architecture execution |
| Native runtime regression |75pass/1platformskip/0fail,17.17s; fixture evidence, not production/root acceptance |
| Three new code-review regressions | RED3/3fail then GREEN3/3pass, zero skips; final suite above supersedes earlier partial counts |
| Previous081072d native CI |41586868991 succeeded: Windows, Linux and macOS acquisition/MCP fixtures; applies to that exact earlier commit, not setup0.3 |
| Previous081072d extension CI |41586869010 succeeded; does not certify new candidate/native work |
| Private legacy source stage | Historical narrow CF9 Stage+Verify and per-host ordinary-user94/94 Linux tests; not reusable root installation or current production health |

The package metadata/manifest JSON records the actual handoff commit and remaining
working-tree files. A source push may trigger new CI; inspect the exact commit's
run. Never promote the earlier green run to proof about a newer revision. Tests
and review are bounded evidence, not a formal EGM certification or a correctness vote.

## Reproduce Without Touching Production

```sh
npm ci --ignore-scripts
npm run vendor
npm run check
cd native/desktop-commander
npm ci --ignore-scripts --no-audit --no-fund
npm test
cd ../bootstrap
npm test
```

The full browser suite also needs Playwright Chromium and an appropriate headed
fixture environment, documented in tests/README.md and CI. Do not attach tests
to the owner's signed-in browser profile. Runtime capabilities themselves are
not sandboxed; disposable fixtures avoid operating on unrelated real data.

For genuine provider/setup acceptance, explicitly select an ordinary writable,
populated npm cache with AGENT_CONTINUE_REAL_CACHE and either
AGENT_CONTINUE_OFFICIAL_CLIENT=1 or AGENT_CONTINUE_OFFICIAL_ARCHIVE. Optional
AGENT_CONTINUE_OFFICIAL_ASSET_DIR enables all-six ZIP checks. Missing opt-ins
produce explicit skips. Never substitute real keys for the fake fixture key.

Clone history.bundle to recover committed main offline, or inspect source/ for
the complete working-source snapshot. Apply pending-tracked.patch only to its
recorded handoff commit; overlay the explicitly listed untracked candidate
files from source/. Do not execute the entire pending browser snapshot as a
stable release. Preserve the baseline and review it first.

## Remaining Work, Not Started By This Handoff

1. Reconcile pending browser/native protocols with one standalone lifecycle owner.
2. Finish first native-host installation and exact extension-origin registration.
   Current guide/metadata is not installation; never use old private paths as product defaults.
3. Provision/bind the actual official tunnel/runtime key on each target, then
   perform real ordinary ChatGPT and Dot tool authorization and matched device-call acceptance.
4. Complete protected/elevated installer and actual Windows/Linux/macOS acceptance.
   Standard-user fixtures are not administrator/root evidence.
5. Implement policy-correct autostart and real interactive-login recovery without
   clearing pauses during automated SSH monitoring or causing foreground windows.
6. Prove update staging, single-owner switch, active-work drain, rollback and revocation.
   Never blindly restart research or overlap owners of one stdio tunnel.
7. Review privacy/store permission disclosures before shipping nativeMessaging;
   keep native candidate out of stable2.2 and do not republish2.2 bytes under its tag.
8. Consider npm publication/signing/installers only after explicit release validation.

All are backlog, **not permission to start the next stage while paused**.

## Operational Boundaries And Contacts

No VPN reconnect, manual-pause clearing, route/DNS changes, SSH/research/IDE
restarts, credential reuse or public administrator shell is authorized by a
handoff document. Preserve the owner's deliberately selected Process Lasso settings.
Use the in-app browser for web operations. Keys stay on their intended devices
and never enter Git, browser storage, logs, issue attachments or this ZIP.

Owner/developer: Zhentong Ye; zhentongye2028@u.northwestern.edu.
[GitHub](https://github.com/1235357/agent-continue) /
[Issues](https://github.com/1235357/agent-continue/issues/new/choose) /
[LinkedIn](https://www.linkedin.com/in/tony-zhentong-ye/).
Ask the owner to resume before further product development or production actions.
