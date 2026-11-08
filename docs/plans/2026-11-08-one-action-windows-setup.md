# Windows Setup: One Informed Decision

## Owner Requirement

The owner approved simplifying the configuration experience on 2026-11-07
(America/Chicago): after informed consent, installation, configuration and
connection should be automated as far as the browser and operating system permit.
This refines the current active Windows release goal; it does not replace the
goal with a UI-only milestone.

## Default Experience

1. Show Windows setup first, with one recommended command and concise account-level
   access disclosure. Do not auto-install merely because a page opened.
2. Reuse compatible Node, or verify and provision the official portable Node ZIP.
   Do not introduce an AgentContinue EXE/MSI installer.
3. Coordinate installation and bridge registration in the command path. Preserve
   exact extension identity, local credential handling and recoverable receipts.
4. In Devices, show connection state, Connect and Pause. Keep Revoke accessible.
   Move hashes, operation IDs, manual recovery and alternative modes into closed
   advanced sections.
5. A manual Connect outside installation prepares read-only prerequisites before
   its informed confirmation. The combined fresh-install flow must instead
   disclose installation AND automatic connection before the copy gesture, then
   continue on the same Setup document without another application-level dialog.
   Do not reuse old install-only consent or require manual support checks.
6. Preserve mandatory Windows elevation and ChatGPT tool authorization. Extension
   consent is not installation, an elevated token, a tunnel or a chat grant.

## Safety And Usability Contracts

- Pause/Revoke cancel pending connection preparation. Late checks cannot open a
  stale Connect dialog or create a new operation after a pause.
- An unresolved operation blocks new startup; read its original receipt. Do not
  replay it or manufacture a replacement operation ID.
- Do not show a historical receipt as current readiness. A stopped Pause receipt
  may replace stale request wording only for the exact latest stored operation.
- Permission/support failures release UI busy state and provide an actionable,
  bounded error. No background reconnect loops are added.
- Keep the scheduler, prompt contents, production VPN/MCP and external Chrome
  original task unchanged.

## Work Log

Checkpoint77 independent source audit of24dd3b3 found three still-open delivery
gaps. Earlier fresh-install acceptance does not close these combined-flow gates:

- [ ] Bootstrap the setup bundle itself from exact trusted release URL/hash
  metadata. Current copied commands are relative to an already extracted bundle;
  Node provisioning alone is not clean-machine setup. Verify arbitrary working
  directories and checksum/metadata rejection before execution.
  Implementation refinement: the existing release-stamped install.ps1 already
  downloads/verifies its payload when run without adjacent source. Reuse that
  path: acquire and verify the exact entry-script bytes in the first command,
  rather than introduce a second ZIP acquisition/extraction implementation.
- [ ] Add a current-account-specific consented installation/connection continuation.
  It currently copies the command without the administrator coordinator. Preserve
  fresh-install-only admission, Pause, withdrawn consent, exact identity and
  no-replay behavior; do not remove the administrator scope guard as a shortcut.
- [x] Keep detailed receipt/recovery outcomes inside closed Advanced, with concise
  default pending/unknown/connection feedback and visible actionable warnings.
  Test requested, cancelled and unconfirmed outcomes with Advanced closed.
  Checkpoint79 source correction passed65 rendered checks across both languages
  and1100px/320px layouts. Two independent-review findings were reproduced and
  fixed: old terminal history masking a newer attempt, and blank/stale terminal
  summaries after reopening. Attempt feedback is associated with its journal
  snapshot; meaningful new evidence supersedes it, progress-only updates do not.
  Exact identities/progress remain in Advanced. This is not a changed installed
  preview or a real hosted operation/recovery result.

These are product-imposed steps to simplify, unlike mandatory nativeMessaging,
Windows UAC and chat-platform approvals. No changed live installation or complete
one-action delivery is claimed by this source review.

## Entry Bootstrap Design (Projection Implemented; Acquisition Pending)

Checkpoint81 implements only setupEntryMetadata and the read-only
prepare-npm-payload.mjs --setup-entry-json mode. It verifies the completed
six-asset closure before emitting the six-field entry/list-hash descriptor.
Parent observed the missing-feature RED (18 failures), then81/81 entry/release
checks passed after implementation and review fixes. The new22 entry tests are
included in test:setup. The regression now requires build-order markers to exist
before comparing their positions; malformed/invalid CLI receipts produce no
partial success output. Generated input files may be absent in a clean checkout.
This does not yet inject metadata into extension packages, download or launch an
entry script, pin the resolver's remote checksum list, continue Current account
setup or establish public asset availability.

### Problem

The copied default command still assumes an extracted local directory. The
release-stamped installer already has a remote payload resolver, but fresh
Current account guided setup checks for an adjacent payload before reaching it.
Simply replacing the relative path with a URL would not close that gate. This
design concerns acquisition only; Current account automatic connection remains
a separate contract and must not borrow the administrator scope's authority.

### Technical Plan

Acquire only the exact final release entry script, verify its hash and single
literal release stamp, then invoke it by absolute path. Reuse Resolve-Payload for
the payload ZIP instead of adding another downloader. Derive a closed metadata
record from the completed combined Windows build receipt: format, version1,
releaseTag, entryUrl, entrySha256 and sumsSha256. The outer sums digest pins the
whole payload closure; the entry passes it into Resolve-Payload, which verifies
the downloaded list before trusting a listed ZIP digest or extracting files.
Do not stamp this digest into the entry/ZIP/list that it authenticates.
Bind the tuple to the extension release version,
the fixed repository and exact install.ps1 asset; reject latest/raw/branch URLs,
overrides, query strings and fragments. Building a tuple does not establish
public asset availability.

Build ordering must stay acyclic:
administrator bundle/stager -> pinned helper -> final entry -> setup ZIP/sums
-> completed receipt -> extension-only entry metadata -> GitHub/Store ZIP pair.
The actual setup payload fixed lists exclude extension files. Do not inject
metadata into shared install-plan.mjs or mutate checked-in source during a build.
The checked-in metadata module should export null until packaging projects a
verified local closure. No missing metadata fallback may invent a public URL.

### Alternatives

- Keep relative commands in Advanced as an explicit local-bundle fallback, not
  as a completed clean-machine experience.
- Do not add a second archive downloader, unpinned latest/raw execution, a custom
  EXE/MSI installer, or an unverified npm publication claim.
- Do not remove the administrator-only BrowserSetupId guard to fake a Current
  account continuation. That flow needs its own receipt and consent contract.

### Detailed Implementation And Acceptance

Proposed source boundaries: native/bootstrap/windows-release.mjs projects the
validated build receipt only after read-only validateWindowsRelease verifies
the actual six-file asset closure; scripts/prepare-npm-payload.mjs exposes a
read-only setup-entry JSON mode without staging npm or compatibility payloads;
scripts/package.py injects canonical
extension-only setup-entry-release.js bytes identically in both distributions.
A pure setup-entry.js command builder is shared by setup.js previews and
setup-client.js post-BEGIN output, retaining the exact extension and setup IDs.
The builder has explicit scope and remote/local mode inputs. Missing metadata
disables remote generation before permissions, BEGIN or clipboard work; an
explicit Advanced local command remains available. There is no local fallback
after a remote verification failure. Only the install.ps1 early adjacency
rejection gets a narrow valid stamped-release exception; incomplete unstamped
source and partial adjacent bundle errors still fail.

The command must launch fixed Windows PowerShell with NoProfile, remain
interactive for existing guided inputs, preserve policy/UAC, and contain no
credentials. Entry acquisition has a90-second total deadline and a streamed4MiB
limit. Permit at most three redirects, HTTPS/default443 only, no user information;
the initial fixed github.com asset may redirect only to github.com,
release-assets.githubusercontent.com or objects.githubusercontent.com. Validate
every hop; reject credentials, downgrade and other destinations.

The local file protocol is create-new storage below a validated non-reparse
temporary ancestry, with current-user/SYSTEM/Administrators-only directory access.
Random naming is not the access-control guarantee. Read hash and data-only single
literal stamp from one file handle, then retain a read-only handle that denies
write/delete sharing through the child lifetime. Invoke a separate fixed OS
Windows PowerShell process with NoProfile, interactive inherited console and
absolute -File plus explicit arguments. No iex/ScriptBlock.Create entry execution,
NonInteractive, ExecutionPolicy Bypass, policy mutation or execution fallback.
Capture and propagate the immediate child exit code; cleanup errors must not mask
it. Remove inherited payload-base overrides only inside the bootstrap process.
Preserve no-replay, cancellation and installer-retained recovery payloads.

The complete expanded CMD command, including executable path, encoding and
quoting, must fit below8191 characters. This is not the administrator helper's
separate30000-character direct-child limit. If the complete bootstrap cannot fit,
stop implementation of the CMD transport and revise this design; do not silently
drop verification. Use the strict existing Expand-VerifiedSetupArchive path for
remote payloads as well. Entry network bounds do not establish bounds for legacy
payload or Node acquisition; those routes require separately measured limits.

Required tests: arbitrary CWD including spaces/apostrophes; unchanged CWD;
PowerShell/CMD argument equivalence and command-size limits; hash mismatch,
oversized/truncated entry and wrong/missing/duplicate stamp causing zero entry
invocations or payload downloads; invalid metadata/source-only receipts/version
mismatch rejected before copy/download; stamped-entry-only reaching the existing
resolver while existing closure guards remain effective; no source mutation or
dependency cycle; matching GitHub/Store metadata bytes; existing consent,
localization, cancellation, scope and rendered layout regressions.

No verified published tuple exists at this checkpoint. The candidate release
availability/validation sequence needs an explicit reviewed plan before this
flow can be called public clean-machine delivery. Apart from the bounded
projection/read-only CLI slice above, the bootstrap is not implemented. No
installation, public asset publication or live connection was performed by this
design and source work.

Checkpoint66: main synchronization through41d79c4 is real, but the second hosted
Windows verification still failed a later test admission/effect race. Same-PID
observation now handles that race without repeating Start. Mobile fallback-font
layout was reproduced exactly and fixed without weakening the first-viewport
assertion; parent56/56 render checks passed. Ordinary/protected package tests and
incomplete wake-fixture imports were corrected; actual hosted reruns are pending.
Five browser-wake issues now have regression repairs, but a no-reply mutation
still fences generic status/Pause indefinitely. Preserve the unresolved evidence;
do not present that behavior as a finished recovery experience or waive it for
release. See current Runtime Acceptance for precise tests and remaining gates.

Checkpoint65: fresh dedicated current-account installation actually passed;
configuration/registration succeeded without starting a duplicate connection.
The real archive-only repeat command exposed and then verified the adoption fix:
read-only existing-matched, no mutation or credential prompt. Public source review
and manual hosted-verification contracts passed; actual hosted CI and publication
remain separate. Scope selection is presentation-only; diagnostic inputs stay
closed by default. This supersedes checkpoint64's fresh-current-install gap.

The actual IAB status check also recovered the newly installed current-account
bridge without another installation: Granted, Bridge reachable, Disconnected,
Paused. The worker now supports explicit read-only reattachment after its initial
host-not-found attempt; pending handshakes are awaited, not duplicated, and
owner/mutation fences remain intact. Only the dedicated acceptance preview was
reloaded. The owner completed Store authentication; its current published and
draft versions are2.1.0, not the GitHub-only scheduler2.2.1.

Checkpoint64 current state supersedes the stopped-runtime checkpoint60 below:
the dedicated ec7 connection is ready after one checkpoint63 GUI Connect, not a
replayed operation. Current Dot completed bounded administrator/file/owned-test-
process execution, independently cross-checked; no sessions remained afterward.
Devices now presents one selected Current account / Administrator surface, with
Advanced closed and guided Revoke accessible. Existing-administrator full public
inventory/registration/task inspection passed without writes; current-account
adoption passed source fixtures, not a new live install. Full product and96/96
public-package checks passed on r4. The installer recovery-command lifetime fix
now passed362 focused checks and the full guided-install command. Closure-r5,
paired extension-r5 and npm-r5 are built; final product exit0, package103/103 and
extension packaging32/32 passed. Whole-browser administrator recovery,
Revoke, actual hosted CI and public GitHub/Store delivery remain open.

Checkpoint60 live update: fresh administrator installation and same-document
automatic Connect have now been accepted on ec7eb4e2, with ordinary-web actual
administrator/file/owned-process proof and a later actual GUI Pause. The
acceptance runtime is now stopped. One-click navigation from the installed IAB
popup is repaired with fixed extension-page destinations and a same-document
fallback; its minimum width is320px. The original suspected foreign Pause block
was disproved by new stopped receipt5ff4cb5636e947a7bc06518e198ccd91. Feedback
can arrive before shutdown; the source fix adds at most four further read-only
checks within a15-second total budget after explicit Pause.106 focused cases
pass. This followup source was installed in checkpoint60c, but it was not
exercised by a new real OS Pause; the existing receipt was only read manually.
These observations supersede the older source-only boundaries below. Neither
public release/submission nor current-account/existing-install adoption is done.

Checkpoint58 supersedes older source-only notes below: the actual worker and
page now import the coordinator/client and installation-wide Pause. The default
page hides manual setup/diagnostic controls behind closed disclosures. Full
product exit0 and rendered Setup47/47 passed; final client24/24 covers slow human
approval. This is tested candidate source, not installed combined-flow acceptance.

- [x] Native release goal created and active; publication and Store submission
  remain completion gates.
- [x] Guided-connection regression cases written before implementation; initial
  run failed because the guided control did not exist.
- [x] Integrate primary Devices layout and guided preparation; scoped111 tests
  and rendered40-check Devices suite passed. Independent review found and fixed
  a delayed-Connect/Revoke race, consent withdrawal and permission-refresh hangs.
- [x] Integrate Windows-first setup layout and default selection tests;37 rendered
  setup checks passed across both languages and desktop/mobile viewports.
- [x] Inspect the updated installed IAB candidate visually. Only six page files
  changed; retained existing authorization, scheduler and protected runtime.
- [x] Add Current account / Administrator scope selection and scope-specific
  command/consent. Late saved-consent and clipboard results cannot restore a
  previous scope. Setup44 rendered browser checks passed; the three Setup files
  were updated and visually checked in the existing IAB preview.
- [x] Implement command-only administrator orchestration: one explicit consent,
  one UAC and one fresh InstallBrowserOwner action. Add checked source snapshots,
  full closure preflight, durable exact-ID receipts and read-only Observe.
- [x] Build a local setup source ZIP plus separate pinned administrator bundle;
  verify parent/helper/stager/bundle bytes and data-only Plan. No installation or
  publication performed. Do not reuse the existing public v2.2.1 tag.
- [x] Add same-gate sealed setup receipts and fast read-only setup-status, with
  exact extension/SID/original-target checks. These are advisory observations,
  not new connection authority;589 scratch receipt checks and26 installer checks.
- [x] Add worker-wide pre-dispatch startup cancellation and a durable setup-ID to
  original-operation association committed/read back with the existing journal.
  Same-document coordinator and joint-module fixtures pass. Checkpoint58 wires
  the real worker/page; missing stop support and observer admission default deny.
- [x] Implement authenticated installation-wide Pause and actual provider wiring.
  Preserve original-ID unknown-state readback and legacy semantics; final installed
  acceptance remains separate from source/native-function fixtures.
- [x] Accept the combined installer and automatic continuation on a fresh
  administrator installation (checkpoint59); ordinary-web administrator/file/
  owned-process proof and actual GUI Pause followed in checkpoint60.
- [x] Define/read back compatible existing-install and current-account behavior
  without overwriting an active runtime.
- [x] Wire same-document consented copy/receipt/observer/one-Connect continuation
  after a verified fresh installation. The native installer itself still finishes
  paused; the unchanged initiating page's automatic Connect was actually accepted
  in checkpoint59 and ordinary-web control followed in checkpoint60.
- [x] Disclose the measured approval boundary: current Connect/Pause launch plans
  separately use runas. Installation's one UAC is not the total flow's count.
  Reuse this checked path for near-term delivery; fixed delegation is a future
  option, not a reason to block the one-command flow or bypass Windows approval.
- [ ] Complete lifecycle/revocation gates for the exact release artifacts.
- [ ] Update public release packaging, privacy and Store disclosures together.
  Candidate Windows sidecar workflow and privacy drafts exist. Hosted Windows
  runner compatibility is not established; the ordinary-token build guard must
  not be bypassed or presented as a passing CI job.
- [ ] Publish matching GitHub release and verify Store submission receipt.

## Evidence Boundary

The old70a97761 acceptance was revoked/unenrolled. The newer ec7eb4e2 acceptance
installation connected automatically from the original consented Setup page,
proved ordinary-web administrator operations and was then explicitly GUI-paused.
These are real local/browser observations, not published npm/Release delivery.
The installer itself finishes paused; the same initiating page separately admits
the consented continuation. Reopen/recovery/Revoke/Dot/final-artifact adoption and
publication gates remain open rather than being hidden by interface copy.

The first complete product run reached the MV3 stage and exposed an old fixture
assumption: diagnostic text moved inside closed Advanced details. The test now
opens the actual disclosure before reading it; all13 MV3 cases passed. A fresh
complete product run is recorded in the candidate artifact directory. Do not
replace its actual exit code with the separate scoped results.
