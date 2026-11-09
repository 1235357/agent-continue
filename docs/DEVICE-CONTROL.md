# Device Control Design And History

## Current Reading Order

For the command-only Windows setup and current evidence, start with the root
[README](../README.md), [Windows setup commands](../native/bootstrap/README.md#windows-command-installation),
[Runtime Acceptance](RUNTIME-ACCEPTANCE.md) and
[Development Handoff](DEVELOPMENT-HANDOFF.md). No custom Agent Continue EXE/MSI
installer is required. Ordinary ChatGPT and Dot execution against the protected
3.0.4-matching native runtime has been observed; current-installation browser
Pause/Revoke and full-browser-reopen recovery remain separate unverified gates.
The follow-up legacy-Pause fix on `main` is not an update to immutable 3.0.4 assets.

The dated sections below preserve the earlier v2.2.0-era designs and experiments,
including superseded installation alternatives. They are not current setup
instructions, authorization to deploy, or proof that Linux/macOS or every listed
proposal has been delivered. Historical acceptance belongs to its exact tested
installation; follow the newer checkpoints before acting.

## Proposed Continuation Design — 2026-11-03

**Status: owner requested continuation via `/goal continue` after the proposed
architecture was presented.** The original goal is now active. Proceed with the
source/test integration slice below; first-install/production/privilege/startup
effects remain separate. This section supersedes conflicting current-action
pointers below, not historical test observations or sealed handoff archives.
No production runtime, installer, native registration, account, credential or
login policy has been changed by this continuation.

### Evidence And Corrections

The in-app browser actually displayed the following upstream material on
2026-11-03. GitHub repository pages redirected to login; raw Markdown pages were
read through visible screenshots when DOM extraction and scrolling failed. Only
the displayed sections were reviewed, not every linked file or the full upstream
repositories. These are observations of upstream `main`/`master`, not validation
that the pinned provider0.3.1/runtimev0.0.19 support every current-doc command.

- [DesktopCommander remote launchers](https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/main/scripts/remote/README.md): macOS/Linux shell launchers, PowerShell5.1+ and a CMD wrapper; when Node is missing the launcher explains installation and asks Yes/No, stops if input cannot be read, and offers manual downloads. The displayed text targets Node24 and links24.22.1 downloads. A compatible existing Node avoids another installation. This is a reusable onboarding pattern, not code to run unchanged in our product.
- [DesktopCommander README](https://github.com/wonderwhy-er/DesktopCommanderMCP#readme): `npx @wonderwhy-er/desktop-commander@latest setup` configures Claude Desktop; the separate `remote` path uses DesktopCommander's service. The installed0.3.1 README additionally documents temporary server-side argument/result retention. Reuse the open-source stdio core, not that hosted remote route. Our release must pin reviewed artifacts rather than fetch executable `@latest` at each start.
- [Official onboarding](https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md): requires an MCP endpoint or stdio command, a provisioned tunnel ID and a runtime/control-plane API key. Runtime principal needs tunnel Read+Use; tunnel creation/editing requires Read+Manage; the admin API key is for admin commands, not the long-lived daemon. Existing bootstrap requires the tunnel and device-local runtime-key file to exist; it does not provision them.
- [Official connector behavior](https://github.com/openai/tunnel-client/blob/master/docs/connectors.md): the product calls the OpenAI-hosted MCP endpoint; the service queues work, the client polls using the runtime key, dispatches to its configured MCP binding, and posts results/notifications back. This is **not peer-to-peer SSH**. “Direct” here means target device to the official OpenAI service with no developer relay or permanent Windows forwarding.
- [Official Homebrew installation](https://github.com/openai/tunnel-client#install-with-homebrew): `brew install openai/tools/tunnel-client` is the supported macOS route. Direct ZIPs are not notarized; do not use `xattr`, `spctl` or Open Anyway to bypass Gatekeeper. A current unversioned formula is not automatically our pinned release; production packaging must reconcile its exact executable version/digest before claiming support.
- [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging): Chrome launches a registered native application in another process and exchanges stdin/stdout messages. Installing an extension does not create that application or its OS registration. First install remains a user-run native installer; later consented lifecycle operations can be driven by the installed extension.

Node.js is a runtime, not an account service. Installing a public npm package does
not require an npm account. A maintainer needs publishing authorization for our
own registry package; the existing private0.3.0 package is not published, so do
not advertise a runnable public `npx agent-continue-…` command yet. No account was
registered, package published or upstream install command executed here.

### Alternatives And Recommendation

1. **Recommended: extension + installed coordinator + per-target official runtime.** First-install OS approval is visible; later lifecycle/configuration is managed in the extension. One target owns one runtime/MCP pair. A remote Linux target runs independently of the Windows deployment entrance. This needs a real native installer and browser-to-owner integration, but meets the requested final state.
2. **CLI-first installation with extension status only.** Least new integration: use reviewed PowerShell/CMD/shell/npm entry points for configuration, then manage manually. Useful for validating installation, but not an acceptable final substitute for the requested browser control center.
3. **Extension-only shell execution or hosted DesktopCommander Remote.** A clean Chrome extension cannot execute its own first PowerShell process without installed native support; the hosted remote route adds a third-party service. Neither meets the requested installation/data-path constraints. Do not implement a public shell endpoint or content-script command bridge as a shortcut.

### Product Workflow And Boundaries

Reuse Setup and Devices, separate from scheduler controls. Proposed setup stages:

1. Choose local Windows/macOS/Linux or a remote Linux server; show the selected actual OS identity, full file/shell/process capability, startup policy, component sources, tool-history exposure and revoke mechanism. Administrator/root is an explicit OS choice, never a browser label for a standard user.
2. Give one complete workflow consent, then offer a verified native installer plus PowerShell/CMD/shell and, after actual publication, npm alternatives. All entry points compose the same bootstrap instead of maintaining different setup logic. Check Node/version/platform before acquisition; missing prerequisites are explained, not installed through silent default acceptance. Preserve platform-required browser, OS and ChatGPT grants.
3. Install and register the native messaging host for the exact installed extension origin. The untrusted five-field setup JSON remains metadata, not approval, a shell command or a credential. No native process, elevated task or resident service is created merely by opening a guide or selecting a target.
4. Guide the user through official tunnel creation/selection and runtime-key creation. Keep the long-lived runtime key in protected storage on the target, absent from extension storage, chat, command-line values, diagnostics and Git. Any elevated management/admin key is not a daemon key. Do not scrape authenticated cookies or invent an unsupported auto-provisioning flow.
5. Prepare pinned provider/client/profile, register the actual platform lifecycle owner, and activate only after the relevant OS/platform prerequisites. For macOS use the supported installation route without weakening Gatekeeper. Windows scheduled-task, Linux systemd and macOS launchd policies are platform strategies, not already implemented capabilities or permission to install them now.
6. Open the actual official ChatGPT connector/plugin setup, then grant tools in the intended ordinary ChatGPT or Dot context. Binding a conversation in our extension is navigation metadata, not a platform grant. Do not promise a generic conversation-scoped ACL unless the current official platform actually exposes it; show the real grant scope instead. Platform/account entitlement and pinned-version compatibility require separate live acceptance.
7. Verify a harmless unique device-tool call against its device-side receipt. Show separate states for configured, host registered, runtime authenticated/ready, platform authorized and tool call matched. A healthy loopback probe or settled control receipt is not end-to-end completion.

Full-account MCP capability remains in the open-source provider. A narrow native
**lifecycle** protocol does not restrict the MCP's file/shell/process operations.
No product command allowlist, directory sandbox, container or rewritten status-only
MCP is proposed. Host and OS policy still determine actual process permissions.

For remote Linux, the local coordinator may use authenticated SSH **on demand for
installation and lifecycle management**, using a device-local agent or secure local
credential entry and verified host identity. It does not forward model tool calls,
keep a permanent command relay, or require the Windows PC to stay on. If the server
is paused, its tunnel cannot carry a reconnect request; the extension must have a
working management path such as authorized SSH, or report that local intervention
is required. Server tools remain usable through the official tunnel with Windows
off, while extension-driven remote administration requires an available manager.
This SSH management adapter remains a source-only continuation; the exact next
contract and its evidence are recorded below. No trusted target has been enrolled
or real SSH connection made by this source work.

### Pause, Login Recovery And Revocation

The owner's explicit recovery requirement must not be reduced to permanent
manual-only reconnect. The preserved 2026-11-01 direct-policy checkpoint is more
specific: next real interactive Windows login and each real interactive Linux SSH
login resume; noninteractive monitoring does not. The latest request repeats that
requirement. Do not ask again whether “login” means ChatGPT reauthentication. The
private prototype's historical login-hook evidence is not implementation evidence
for this reusable product, and was not rerun here. macOS implementation and the
new lifecycle design still need validation.

A login must not silently override an explicitly stay-disconnected choice. Propose
three clearly distinct intents in the product:

- **Temporary pause until next interactive login:** persist a pause with its login generation. No background probe/page load clears it. A later genuine Windows interactive login or Linux interactive SSH login, as already requested, clears only this temporary pause once and reconciles one runtime owner. Noninteractive SSH checks and boot alone are not interactive login; opening ChatGPT or reauthenticating its account is not proof of OS login. Review and test macOS's corresponding interactive-login strategy before claiming support.
- **Stay disconnected:** persist pause across browser restart, OS login and reboot; resume only through an explicit Reconnect action. Existing boolean-paused installations retain this meaning unless the owner deliberately migrates them.
- **Revoke/remove:** stop new admission and retire the selected binding/grants through supported mechanisms; no automatic reconnect. Deleting browser metadata alone is not proof that a key, official tunnel or platform grant was revoked.

This proposal does not alter VPN pause behavior or existing production markers.
Connection-loss recovery is separate: only the already authorized desired-running
state may be reconciled, with bounded backoff and one owner. Revoked/paused state
always wins. Reconnecting transport never replays an unknown shell/file operation.
Task-drain and unknown-child handling must be proven before distribution; do not
kill unrelated or escaped research processes to obtain a clean status.

### Direct Linux configuration candidate, 2026-11-05

The setup guide now exposes a separate `setup-server` source command and its
consent boundary. It accepts only the exported `linux-server` request, stages
the pinned runtime in a fresh local directory, and leaves activation to the
same-account owner. See [Configure a direct Linux server](../native/bootstrap/README.md#configure-a-direct-linux-server).
No Windows relay, Chrome binding, service or SSH login hook is required for
configuration. The old experimental login verbs were removed because an
arbitrary request ID was enough to bypass a persistent pause.

### Direct Server Owner Entry Increment — 2026-11-04

The approved per-target-owner architecture still has a concrete deployment gap:
`setupDevice` accepts `linux-server` and prepares its official profile/state,
deliberately without a local Chrome binding. The existing owner CLI, however,
requires adjacent `device-native-binding.json`. Do not manufacture a Chrome
registration/binding for a headless server or create an owner per request.

Continue that architecture with an explicit foreground server owner and a narrow
same-account management CLI, reusing the existing owner, authenticated local IPC,
controller lease and durable operation journal. This is an intermediate piece
for the extension's later authorized SSH management adapter, not a CLI-only
replacement for the final browser control center. It neither forwards MCP tool
calls nor requires Windows to remain online for server tools.

1. Add `device-server.mjs` to the runtime source closure. Trusted server-side CLI
   accepts `serve --state-dir ABS` or `request --state-dir ABS --id ID --action
   status|reconnect|disconnect-and-pause`. Require exact closed flags, absolute
   local state, the existing ID/action validator and bounded/sanitized JSON
   results; no command, endpoint, key or tool payload. Status/request never starts
   an owner. `serve` starts one foreground management owner only, not a tunnel;
   setup still never activates it or installs a service/login hook.
2. Reuse `device-owner.mjs`'s implementation behind native and server wrappers,
   rather than duplicating IPC/cleanup. A server wrapper validates the configured
   private state root/identity using existing `readState` and local path checks,
   with logical IPC origin `agent-continue-local://server/` and null extension ID.
   Keep native binding/schema/origin validation unchanged; channel authentication
   must not allow a native bridge to switch into server identity. One shared state
   still permits only one channel/controller/operation owner. Root replacement,
   redirected paths, stale descriptors, unknown outcomes and graceful disposal
   retain their existing stop/preserve semantics.
3. Write failing API/CLI tests first. Then exercise actual Node foreground owner
   plus independent request processes, status/pause, duplicate IDs, clean signal
   shutdown and no owner start on status. Use existing controlled readiness-child
   fixtures for real process connect/pause where possible; do not fake official
   authentication. Add runtime source to explicit package/pin closure, verifying
   the actual tarball/install bytes. All files/processes remain temporary owned
   fixtures; never use production keys/profiles or start resident services.
4. Windows named-pipe/process evidence is not Linux Unix-socket/process/login
   evidence. `wsl.exe --list --quiet` on this host reported WSL not installed;
   do not install it or claim Linux acceptance. Remote management SSH, trusted
   interactive-login recovery, official platform grants and real Linux deployment
   remain separate full-goal requirements. Preserve the Windows Defender EXE
   blocker and do not run compiled launcher tests as part of this work.

Alternative one-shot controllers lose ownership; fake Chrome bindings mislabel a
remote server as a local browser host. Neither is used. The shared foreground
owner is the next implementation of the existing architecture, with no additional
production effects authorized by this source increment.

Implementation checklist (inline continuation plan, source-only):

- [x] Re-read current owner/operations/lifecycle and the above approved contract; preserve native behavior and preexisting WIP.
- [x] Add `native/desktop-commander/device-server.test.mjs`: missing exports/entrypoint RED, then private-root, closed-CLI, independent-process, shared-channel and native/server-identity cases. Run `node --test device-server.test.mjs` from the literal native package directory via a Node spawn wrapper.
- [x] Factor the existing owner body behind `startDeviceOwner` and `startServerOwner`; add `readServerBinding` with retained directory identity and repeated existing state/path checks. Add `device-server.mjs` with closed serve/request arguments, sanitized output and foreground shutdown. Run server and existing operation/owner suites after each change.
- [x] Add the new runtime entry to both explicit packaging expectations and observe actual-tarball RED before updating `payload-layout.mjs`. Update source/dev test inclusion and verify installed bytes: 27 package files,16 runtime files expected.
- [x] Run native/Devices/default-bootstrap regressions with Windows EXE opt-in unset; obtain independent review, reproduce any material defect before fixing, and update the handoff/AGENTS/task-relevant memories with exact evidence and unverified Linux/live-platform boundaries. No commit/release/installation is part of this slice.

Current source evidence: the missing-API/CLI and missing16th-runtime-file tests
both failed before implementation. Actual local npm pack/install now verifies27
package files/16 runtime files. Independent first review prompted race coverage:
concurrent serve admits one owner; corrected startup-signal fixture reproduced
listening-after-stop against the original CLI, then early signal handlers fixed
it. Final native130 total/126 pass/4 explicit Unix/Linux skips and bootstrap143
total/129 pass/14 explicit skips/0 fail; Devices58 Node+12 synthetic UI and check4
also passed. Live-root-rename testing is explicitly Unix-only after Windows EPERM
with an open journal; Windows signal events do not prove real Unix delivery.
Final independent read-only review reran the54-case control subset:51 pass,
3 explicit Unix skips,0 fail;0 Critical/Important findings. It confirmed the
startup-stop test actually gates the asynchronous startup and checks disposal,
not only absent output. SIGINT, repeated signals and stop during the outer
module import are still untested minor boundaries. No installed-origin,
production SSH, official auth or real-login result is implied by these counts.

### Authorized SSH Management Wiring Increment — 2026-11-04

**Goal:** implement the already approved on-demand SSH management path as a
source-only adapter into the existing server owner, not a tool relay or a new
production deployment. The existing local/native v1 protocol and server owner
remain unchanged. No first-use installer, registered host or real SSH acceptance
is implied by this increment.

- Keep the five-field Setup export unchanged. A separate private adjacent
  `device-ssh-targets.json`, provisioned by trusted local installation (not a
  website/request), binds the exact extension ID, absolute local SSH executable
  and enrolled target descriptors. Each target contains host/port/OS user,
  absolute remote Node/server-entry/state paths and a private known-hosts file
  plus its SHA256. Its opaque64hex target ID is the SHA256 of that complete
  descriptor and extension identity; changing host/account/root/host-key evidence
  changes the ID instead of reusing another device's pending operation.
- Native v2 accepts only `{version:2,target,id,action}` for an enrolled target;
  actions remain status/reconnect/disconnect-and-pause. Convert only that bounded
  lifecycle request to the existing v1 server request; return a target-correlated
  v2 envelope after validating the complete v1 reply. Never accept host, path,
  credential, shell command, endpoint or MCP tool arguments from the browser.
- Invoke one local OpenSSH child with `shell:false`, no PTY, agent forwarding,
  proxies, connection sharing or port forwarding. Ignore SSH config, require
  strict verified host keys, disable password/keyboard-interactive/askpass, use
  the existing OS agent without exporting it, and send one shell-quoted fixed
  remote `device-server.mjs request` command. No owner autostart, retry, login
  interpretation or service installation. Bound output/time, suppress raw
  diagnostics, recheck retained registry/known-host identity after awaits, and
  treat timeout/SSH death as unknown remote outcome, not rollback/not-executed.
- Scope Devices pending/revision/lock metadata by the immutable target ID while
  preserving local v1 storage and locks. A selected remote target cannot consume
  a local/other-target receipt; reload only queries its retained ID, never replays
  a mutation. UI wiring must retain no automatic checks or permission prompts.

Implementation plan (Node ESM, Chrome MV3; no new dependency):

- [x] Write missing-module/API RED in `device-ssh.test.mjs`, including private
  descriptor/host-key changes, fixed SSH argv, closed input/output, timeout and
  real temporary Node request-process/owner receipts through an injected SSH
  process boundary. This is not real OpenSSH or Linux evidence.
- [x] Add `device-ssh.mjs`, reuse the owner's exact response validator, and route
  only v2 after the existing native origin/frame check. Keep native v1 unchanged.
  Run the new tests and existing operations/owner/server tests from the literal
  native directory with `node --test` via an exact-cwd Node spawn wrapper.
- [x] First add failing target-correlation/isolation tests in the existing
  `device-control-tests.mjs`, then extend its transport/controller with immutable
  target scope. Connect selected-target metadata without putting SSH details in
  the browser, keeping source/UI tests honest about unavailable enrollment.
- [x] Add the adapter to explicit runtime/package closure only after observing
  actual-tarball missing-file RED; run affected native/Devices/bootstrap checks,
  obtain independent exact-byte review, and update this contract, handoff, AGENTS
  and task-relevant memory. Keep Defender EXE opt-in unset and all live
  SSH/Linux/macOS/platform/login/release requirements separately unverified.

Current bounded outcome: initial missing API RED, remote correlation/isolation
RED, UI selection RED, actual tarball missing-file RED, and default-test-inclusion
RED were observed before their respective changes. Independent review additionally
found that OpenSSH token/environment expansion in UserKnownHostsFile can defeat
literal-byte binding; `%h keys` rejection reproduced RED, then enrollment rejects
those expansion/control/quote characters. A fixture cleanup-order failure was
corrected without weakening production identity checks. The second review found
a stale16 runtime count in launcher source tests, which was corrected after the
full-bootstrap failure. Fresh fullnative142/138pass/4Unix-or-LinuxSkip/0fail,
bootstrap143/129pass/14explicitSkip/0fail (11blockedEXE+3existingplatform/assets/cache),
Devices60Node+13syntheticUI and extensioncheck4 passed. Actual npm tarball/install
now verifies28package/17runtime bytes. Final independent follow-up reran SSH12/12
and defaultlauncher3pass/11blockedSkip, no remaining Critical/Important in scope.
No real OpenSSH/Linux or installed Chrome enrollment was exercised. Windows DACL,
remote login-shell/agent behavior, actual SSH host-key authentication, remote
outcome after local SSH termination, production enrollment/installer/login hooks
and official platform tool grants remain separately unverified. New target links
are source wiring, not a claim that their trusted first-use producer is released.

The CS310 course notes' exact-resource/repeated-effect examples motivate binding
both target and operation identity; CS381 layering notes motivate preserving the
lifecycle/transport/UI boundaries. These are engineering applications, not claims
that either course teaches this particular SSH implementation or that restricted
coursework was generated. Browser-visible official connector docs again confirm
OpenAI-hosted queuing/polling, not peer-to-peer SSH; native messaging still needs
an independently installed application. The current browser DOM extraction failed
on that raw page; visible screenshots, not invented DOM text, provided evidence.

### Trusted Local SSH Enrollment — Source/Fixture Checkpoint 2026-11-04

The missing registry producer now exists in the private bootstrap:
`device-enrollment.mjs` / `enroll-ssh`. It accepts only trusted local fields,
requires full-account consent, derives extension identity from the staged
manager's fixed binding, checks an independently supplied known-hosts digest
using the installed production reader, and publishes a first registry create-only.
It returns a fixed opaque `devices.html?target=` link and false verification/
authorization/activation flags. It neither authenticates SSH nor starts an owner
or tunnel. Manager-only private-state/binding preparation is now provided by the
source/private-package increment below; protected first installation/native
registration remains unfinished. See `native/bootstrap/SETUP-DESIGN.md` Trusted
SSH Enrollment for that registry contract.

Setup's existing five-field export remains unchanged. The optional remote-
management guide is bilingual and Linux-server-only; host/key/command data are
not new browser fields. Server MCP traffic independently reaches the official
OpenAI service; a local manager plus on-demand authenticated SSH is only for
optional lifecycle control. No public installer/npm command is claimed.

Fresh fullbootstrap161 total/146 pass/15 explicit skips/0 fail includes an actual
29-file local npm tarball/install (17 runtime files) and installed CLI registry
accepted by its actual packaged reader. Native142/138pass/4 Unix-or-Linux skips;
Devices60 Node+13 syntheticUI; Setup15 Node+19 syntheticUI; check4 all pass. The
in-app browser additionally selected Linux server, switched English→Chinese,
observed the guide/link/no-input boundary and empty simulated native-call log,
then selected Windows and verified the guide hidden. This uses the owned
loopback fixture, not registered Chrome, real SSH or platform authentication.
The first short-lived fixture child exited with its parent; a bounded Shell-owned
server then supplied the actual UI evidence and was stopped. Both temporary tabs
were closed, with zero matching fixture Node processes after cleanup.

Independent spec, quality and final gate/UI reviews found no confirmed production
Critical/Important. The final reviewer reran17 enrollment (16 pass/1 blocked skip)
and9 source/VM (9 pass), confirmed skip-before-spawn and unchanged production
bytes. Supplemental publication-failure branches passed. The Windows fresh-import
side-effect probe itself is not accepted: Defender1116/1117 named its exact owned
Node command line `Trojan:Win32/SuspExec.SE` / Remove; status null then EPERM. Keep
`AGENT_CONTINUE_IMPORT_EFFECT_PROBE` unset; no retry/re-encoding/moving for evasion,
restoration, exclusion or weakened protection. This separate blocked skip does
not prove effect-free import, and neither it nor the EXE quarantine is a proven
false positive. Real OpenSSH/agent/host-key, Unix platforms, installed Chrome,
full representative tools, official grants and actual interactive-login recovery
remain unverified parts of the unchanged active goal.

### Key-Free Local Manager Preparation — Source/Fixture Checkpoint 2026-11-04

The private bootstrap now provides `setupManager` / `setup-manager` for optional
remote management. It consumes a second local-platform five-field request (never
the headless server request), one full-account consent and a new destination.
It reuses the pinned provider acquisition and the installed state/binding reader,
without a local OpenAI runtime key, tunnel client or profile. Server ownership and
its direct official OpenAI MCP data path remain independent. It does not start an
owner, connect SSH, register a native host, elevate or install a service/login hook.

The create-only `manager-receipt.json` reports prepared, not connected, with
localTunnelConfigured:false and false verification/activation flags. Existing or
partial targets are not repaired. Tests cover request/binding/state mutation,
install/app/state directory replacement, helper overclaims, private pending fd
identity, cancellation before commitment and successful commitment winning over
later cancellation/cleanup. A RED-found shared verifier gap now rechecks copied
payload/lock/receipt after its awaited runtime import. Independent review found a
non-enumerable-field loss; ordinary test-runner RED2→GREEN2 now verifies all
validated data properties survive cloning, including pre-abort/offline cache.

Actual local npm tarball/install acceptance uses installed setup-manager→enroll-
ssh and actual packaged readers (29 package/17 runtime files). Its pinned genuine
provider bytes are copied by a disposable npm fixture; it does not prove a live
registry install, genuine SSH or a registered extension. Setup16 Node+19 synthetic
UI, native142/138pass/4UnixLinuxSkip, Devices60 Node+13 syntheticUI, check4 passed.
Fresh post-fix full bootstrap passed176 total/161pass/15explicitSkip/0fail
(11 blocked EXE,1 blocked import probe,3 existing platform/assets/cache cases).
A fresh independent final reader reran both correction tests (2pass/0fail) and
found no remaining confirmed C/I in scope; this does not certify real platforms.
The in-app owned-loopback page actually showed both commands and the bilingual
local-request/key-free/registration boundaries without authority calls; switching
to Windows hid the guide. Owned tab/server closed and fixture process scan0.

Real native registration/protected first installation, OS SSH agent/known-host
identity, Linux/macOS, official account/tool authorization and interactive-login
recovery remain unverified. Both Defender-blocked acceptance probes stay disabled
by default and must not be retried or re-encoded to evade detection. This source
increment advances but does not complete the unchanged active full-access goal.

### Shutdown/Intent Separation Increment — Contract 2026-11-04

The pre-increment source audit found `lifecycle.mjs::dispose` called `pause`,
rewriting the persisted user intent to paused during every ordinary owner shutdown. This blocks
the original login-recovery requirement even before a genuine OS login source is
installed. Separate runtime shutdown from user intent as the next prerequisite;
do not treat this as implementing the full login policy or completing the goal.

- Existing `pause()` remains an explicit persistent pause before signaling. Its
  closed browser operation, journal correlation, schemas and UI are unchanged.
- `dispose()` reserves closure before its first awaited observation, stops only
  its owned run using the same bounded stop/captured-core-exit rules, and releases
  only its owned lease after confirmed parent/core stop. It never writes lifecycle
  intent, creates a missing lifecycle record, starts a child, polls a login source
  or replays an operation. Preserve exact existing connected/paused bytes.
- An explicit pause racing with disposal must still persist manual pause, even if
  runtime stopping is already in progress. A newer shutdown cancels readiness;
  stale readiness cannot restart or erase manual pause. Stop/lease uncertainty
  retains ownership and fixed errors, not an invented successful disconnect.
- Reopening preserves the observed existing intent but never autostarts. Missing
  lifecycle remains paused; existing v1 paused:true remains long-term pause, not
  retroactively granted temporary permission. V2 resumeAfterInteractiveLogin vs
  stay-disconnected, genuine Windows token/session and Linux interactive SSH OS
  evidence, deduplication, startup hooks and actual login acceptance remain missing.
- Alternatives rejected: retaining pause-on-close destroys the saved user intent;
  saving/restoring intent around shutdown can overwrite a newer explicit pause.
  Instead extract the existing bounded runtime-stop path, with no persistence in
  that helper. Explicit pause persists first even when sharing an already-running
  stop; dispose alone never persists. The existing stop timeout starts when the
  first shared runtime-stop begins; a second explicit pause does not reset/extend
  it. Reserve disposal's promise before invoking any async or reentrant observer,
  following reconnect's existing reservation pattern. Reserve the shared stop
  promise before abort listeners or a child-signaling callback can synchronously
  reenter pause; repeated explicit pause still persists but signals only once.
  Keep the old unknown-core precheck and stop-confirmation/release rules.
- Design review is a finite autonomous adaptation authorized for this ongoing
  source/test work, not human installation approval. Freeze this contract before
  fresh comprehension/criticism/readiness reviews; reviewers get only this artifact
  and code/test paths, not prior verdicts. No Python completion adapter is claimed
  for this Node task. Changes to intent format/login authority remain out of scope.
- Implement in the existing lifecycle module with no new runtime/package files.
  TDD updates the old dispose-overwrites-intent assertion, covers absent/paused
  intent, in-flight readiness, explicit-pause-during-close and confirmed/unconfirmed
  stop reservation. Acceptance commands from native/desktop-commander are
  `node --test lifecycle.test.mjs device-server.test.mjs` then `npm test`;
  bootstrap runtime-copy/package consumers are covered by `npm test` from
  native/bootstrap with both blocked opt-ins unset. Root `npm run test:devices`
  and `npm run check` retain envelope/UI/syntax coverage; no UI change is intended.
  Use literal cwd/git -C/npm --prefix for the Windows path containing brackets.
  Expected0fail; label platform/security/assets skips, never count them as pass.
  Independent read-only review and fresh final evidence. No production owner/host,
  key, SSH, registration/service/elevation, Defender probe or commit/publication.

### Shutdown/Intent Increment Evidence — 2026-11-04

Implemented in existing lifecycle.mjs without wire/UI/schema/package additions.
Explicit pause persists before sharing a no-persist runtime stop; dispose retains
exact intent/missing state and reserves before observer awaits. Shared stop now
also reserves before cancellation/signaling callbacks. Observed6dispose+1default-
controller server RED→GREEN. Shared budget and both uncertain/confirmed-core
observer reentry covered; another RED reproduced synchronous callback pause
sending2signals rather than1, then GREEN after pre-reserving the shared stop.
The stop deadline is not restarted and no child automatically resumes.

Fresh final native150/146pass/4UnixLinuxSkip/0fail, lifecycle33 pass, combined
lifecycle+server49/46pass/3platformSkip. Devices60Node13syntheticUI/check4 passed.
Final full bootstrap176/161pass/15explicitSkip/0fail also passed against the final
lifecycle bytes, including actual29/17 npm package and installed CLI consumers.
Its skips remain11blockedEXE/1blockedimportprobe/3existingplatform-assets-cache.
Fresh final independent reader found no confirmed C/I in scope and ran the49
lifecycle/server tests once:46pass/0fail/3platformSkip. Current14path vector and
exact lifecycle hash are in DEVELOPMENT-HANDOFF; interim149/145 is historical.
This bounded prerequisite is not the V2 temporary/manual-disconnect policy, a real
OS login event, startup installation or official ChatGPT/Dot authorization. The
full original goal stays active; no blocked probe or production operation occurred.

### Explicit Pause Intent V2 — Source Contract 2026-11-04

#### Problem And Scope

The product needs temporary pause until a later genuine interactive OS login,
not only a boolean that remains paused forever. Preserve stay-disconnected and
revocation as different intentions. Existing v1 true (and absent intent) means
stay-disconnected; opening, status, disposal and migration must not rewrite it.
This source increment advances the active full goal, not deployed login recovery.
The actual trusted Windows/Linux/macOS login source, installation/startup and
operation-journal-aware event orchestration remain separate required work. No
browser-supplied login event or production policy migration is permitted.

#### Technical Plan

Keep transport versions (local1, remote2), envelope identity and journal version1;
these are unreleased closed contracts. Extend the allowed lifecycle actions with
`pause-until-login`; `disconnect-and-pause` retains its persistent meaning. Keep
full MCP file/shell/process capability and official target-to-OpenAI data path.

The controller writes version 2 only for an explicit temporary pause, with
canonical key order `{format,version,paused,resumeOnLogin,loginGeneration}`.
Format stays `agent-continue-lifecycle`. Version 2 requires true/true/a
nonnegative safe integer; reject other combinations, unknown fields/versions
and noncanonical bytes. Ordinary running and stay-disconnected writes keep the
version 1 boolean format for rollback compatibility. Retain exact intent bytes
(or absence) during dispose. Internal snapshots expose the mode and capability,
not the raw generation.

Add a trusted in-process dependency `readInteractiveLoginGeneration`, synchronous,
returning a nonnegative safe integer or null. Default returns null. Its future
production implementation must authenticate the actual selected OS account and
real interactive Windows/Linux-SSH/macOS login, durably order/deduplicate events
across owner restarts, and exclude boot, unlock-as-login, noninteractive management
SSH and browser/account activity. A number from a test callback does not meet that
OS-source requirement. No CLI, native message, webpage, setup export or SSH target
record accepts or creates this generation. No hook is installed by this slice.

`pause()` preserves synchronous persist-before-signal, writing persistent V2.
`pauseUntilLogin()` requires a currently valid trusted generation; unavailable
source throws only `login_recovery_unavailable` before intent write or stop.
Otherwise persist its generation before sharing the existing bounded stop.
`resumeAfterInteractiveLogin()` takes no caller payload. It does nothing beyond
status unless the current temporary record has a strictly older generation than
the trusted source. Reserve through the existing single-start path; recheck owner,
transition and exact logical intent after every old-core await before publishing
running or spawning. A newer persistent/temporary pause or dispose wins. Same/old/
missing/invalid source never starts; duplicate events do not start another child.
Only trusted in-process callers may invoke these controller methods. No
production owner, IPC or browser uses the temporary pause or recovery method yet.
Future event orchestration must also respect unresolved operation journal entries;
this seam alone does not certify that integration or saved-running startup.

Future transport changes must require closed native states
`{paused,pauseMode,loginRecoveryAvailable,connection,operation?}`. Unknown observation
has null/null/null; otherwise pauseMode must agree with paused, and capability is
boolean. Capability means the controller currently reads a valid source, not that
OS hooks are installed or end-to-end acceptance passed. Keep generation private.
The current public receipt remains unchanged.
The operation owner requires the new controller method, durably admits the new
mutation, dispatches it once and treats only its specific pre-effect unavailable
error as `not-executed`. Other failures remain unknown. Stop actions share the
existing one-pause preemption and unknown-outcome gates; duplicate IDs retain
receipts, changed actions reject, and queries never replay mutations.

#### Alternatives

A renamed boolean cannot distinguish the requested behavior. Browser-reported
login, a wall clock or environment variable cannot authenticate a real login.
Silently treating old pauses as temporary changes user authority. Shipping an
always-enabled temporary button before a trusted source would promise recovery
that cannot occur. Use explicit V2 plus a disabled/unavailable capability instead;
this is a visible prerequisite, not a final fallback to manual-only recovery.

#### Detailed Implementation And Acceptance

On November 5, controller tests verified the private V2 record, single-start
recovery, fail-closed evidence and superseding user intent. The legacy startup
flag cannot clear a V2 temporary pause. Delayed failure of a prior saved-running
startup is fenced so it cannot overwrite a newer pause. No OS event source is
wired and no scheduler, server, or browser action was enabled by these changes.

For the Windows adapter, Microsoft's
[session-data reference](https://learn.microsoft.com/en-us/windows/win32/api/ntsecapi/ns-ntsecapi-security_logon_session_data)
provides session ID, logon time and account SID; its
[logon-type reference](https://learn.microsoft.com/en-us/windows/win32/api/ntsecapi/ne-ntsecapi-security_logon_type)
distinguishes interactive, remote-interactive, unlock, batch and service
logons. Use these as candidate inputs, not proof from a type or timestamp
alone. Verify the selected account and actual interactive desktop session, then
deduplicate and durably order observations. Before activation, verify a new
same-account login advances the generation, while unlock, restarting the
manager in the same session, and another account's login do not.

The maintainer-only `scripts/Read-WindowsInteractiveSessionEvidence.ps1`
now provides one read-only Windows snapshot. It checks the current process's
active desktop session, the WTS account and client protocol, and the primary
token's matching LSA account/session/SID. It rechecks the desktop snapshot
after the token query, never enumerates other sessions, and emits only a
versioned session tag plus console/RDP kind, or a fixed unavailable result.
The session tag deliberately excludes client connection and last-input times.
It identifies equal session snapshots, not ordering, an unlock event, or
human presence. See Microsoft's [WTS session structure](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/ns-wtsapi32-wtsinfow)
and [WTS query classes](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/ne-wtsapi32-wts_info_class).

The local Windows x64 test ran independent Windows PowerShell 5.1 and
PowerShell 7 processes against the same active console session. The tag was
stable even with spoofed environment identity fields. A constrained process
that could not load the probe returned only the fixed unavailable receipt.
No logout, second account or RDP test occurred. Do not use this snapshot as
the controller's monotonic generation; an ordered login event adapter and
its owned startup integration are still required.

The same probe's `-RequireLogonAnchor` option now correlates that snapshot with
one retained LocalSessionManager/Operational logon event. The local Windows
publisher manifest labels event 21 as session logon and event 25 as session
reconnect. Match provider GUID, channel, event 21/version 0, typed payload,
desktop account and session ID in a bounded UTC window around WTS LogonTime.
Read the record back by ID and require the same sole candidate in a repeated
scan. Then recheck the desktop tag. Return only the private record locator,
fingerprint and a separate SID-derived owner tag; missing, inaccessible, changed
or ambiguous records fail closed.
The non-elevated local Windows token could not read the Security log, but
both PowerShell hosts independently matched the same retained desktop event.

For diagnostic comparison, pass the prior receipt's four fields together:
`-PriorRecordId`, `-PriorRecordTag`, `-PriorSessionTag` and `-PriorOwnerTag`.
The probe returns `same` for the identical anchor and session, or `later` only
for a different session with a strictly higher record number and later UTC
event time. The previous record must match the current account name and the
stored fingerprint, and must still match after the current anchor is
revalidated. This comparison assumes the prior receipt came from trusted
local state; the tags are identifiers, not an authentication mechanism.
Microsoft documents [EventRecordID](https://learn.microsoft.com/en-us/windows/win32/wes/eventschema-eventrecordid-systempropertiestype-element)
as an event record number, not a generation spanning cleared or rotated logs.
If the older record is gone or its number now identifies different content,
the probe returns only `logon_anchor_unavailable`.

With `-RequireLogonAnchor -CapturePauseBoundary`, the diagnostic now captures
the newest validated event 21 in that channel (not necessarily the current
account's event) and samples UTC between retained and repeated head reads.
It checks the current anchor remains readable and the desktop is unchanged.
The optional `pauseBoundary` receipt contains the head's record ID and
fingerprint, and decimal-string UTC ticks (preserving all 100-ns units when
read by JavaScript). Neither raw event contents nor account identity is output.
To compare, supply the four prior anchor arguments plus `-PauseRecordId`,
`-PauseRecordTag`, and `-PauseObservedUtcTicks`. A different session is only
a `candidate-after-pause` if its record number advances past the head,
both event time and WTS login time are strictly after the UTC sample, and
the pause head still reads back unchanged before and after current verification.
An identical session stays `same`; partial, inconsistent or unverifiable
input fails closed. The separate no-boundary comparison keeps its old contract.

This probe does not write or arm a pause and must not trigger reconnection.
An earlier clock correction and delayed event publication can defeat the
UTC comparison because WTS and event timestamps share the system clock.
[WTS enumeration](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtsenumeratesessionsw)
is permission-dependent, so non-admin enumeration alone cannot establish
the absence of another session. The owner must first commit an unarmed
pause, then capture under the same pause instance, and require an independently
ordered OS login signal before consumption. Pending recovery must survive
restart without bypassing the existing operation journal or starting twice.
The read-only checkpoint passed on the same live Windows desktop in
PowerShell 5.1 and 7; older sessions, delayed events, and retention failures
were fixtures, not actual logouts, clock changes, or log deletion.

Edit existing runtime modules/tests only: lifecycle, device-operations,
device-owner, device-ssh tests and device-server/owner process fixtures. Extend the
existing browser device-control, devices.js/html, dialog/UI/browser fixtures and
tests. No new runtime module, package dependency, public action carrying login,
installer, registry entry, service, credential or release. Preserve preexisting WIP.

Devices has separate Pause until next login / Stay disconnected / Reconnect
actions, current pause behavior and login-source availability in both languages.
Temporary action is enabled only after a fresh correlated boolean capability and
all existing multi-page/revision/pending gates. Opening, language change, status,
page reload and cancelling never trigger a mutation. Recheck temporary eligibility
when confirming; capability loss invalidates its open review. Retain pending
metadata by action/target, query matching receipts after reload and show unavailable
recovery honestly. No scheduler or platform-grant changes.

- [ ] TDD lifecycle: missing/v1 exact-byte preservation, valid/invalid V2, temporary
  generation persisted before signal, unavailable source no effect, later/same/old
  generation, restart/dedup, explicit persistent pause, late readiness, changed
  intent while awaiting old core, no autostart and no caller event argument.
- [ ] TDD operations/IPC/server/SSH: new action dispatch and durable admission,
  unavailable not-executed, duplicate/action mismatch, unknown stop reconciliation,
  strict state/capability consistency and browser-forged login rejection. Real
  spawned native/server fixtures must cross actual serializers and readers, not
  only test doubles. No real SSH/OS/login acceptance is inferred.
- [ ] TDD browser: closed new state, target correlation, pending reload/status-only
  recovery, capability gating and confirmation recheck. Synthetic bilingual320px/
  desktop rendering and an actual in-app owned-loopback view confirm separate
  controls and honest unavailable text without native/OS effects.
- [ ] Run `node --test lifecycle.test.mjs device-operations.test.mjs
  device-owner.test.mjs device-server.test.mjs device-ssh.test.mjs`, then full native
  `npm test`, root `npm run test:devices` / `npm run check`, and full bootstrap
  `npm test` including actual29/17 package/install closure. Use literal cwd through
  Node spawn / npm --prefix; leave both Defender opt-ins unset. Require0fail and
  enumerate security/platform/assets skips. No compiled EXE/import probe retry.
- [ ] Freeze contract/current inputs, fresh sequential comprehension then criticism/
  readiness reviews before code. Record changes, first failing tests, final actual
  bytes and fresh independent implementation review. Autonomous source-work
  adaptation, not human installation approval or Python-adapter certification.

### Original Operation/IPC Implementation Slice — Completed In Fixtures

The slice below is retained as its original implementation contract, not the
current next action. Operation receipts, the one-shot native bridge/shared owner
and the new server entry now have source/fixture verification. Current remaining
full-goal work is installed first-use/bootstrap/registration and owner startup,
authorized extension-to-server SSH management, actual Linux/macOS and Windows
launcher acceptance, official ChatGPT/Dot grants/tool calls and real login
recovery. Keep the Defender EXE blocker; do not repeat completed receipt/IPC code
or silently turn fixture success into installed-origin/platform acceptance.

The original slice was to close **Devices → native message host → single lifecycle owner →
correlated operation receipt → Devices** loop in a disposable ordinary-user
fixture. Current `device-control.js` expects `{version,id,action}` with exact
correlation/state/operation fields. Current `lifecycle.mjs` exposes
`{paused,runtime,ready,chatAuthorization}` in-process; `host.mjs` is MCP stdio, not
a Chrome native-message host. Do not merely rename fields or launch an owner for
each one-shot `sendNativeMessage`: that would release/lose ownership between
calls and cannot manage one persistent runtime. Define the native framing,
installed-origin validation, authenticated local IPC to one lifecycle owner and
device-side operation journal as one reviewed contract before coding.

Preserve the browser's uncertain-operation journal. A timed-out dispatched action
remains unknown until a matching durable owner receipt settles it; generic status
or a fresh browser session cannot clear it. Reject reused IDs with changed intent;
repeated identical IDs return the retained result, not a second OS mutation.
Settlement and successful readiness remain separate. The contract must cover
browser host death, owner death, stale leases, multi-page requests, pause during
start, and in-flight update/revocation without adding a tool-command relay.

After that loop, finish first-install wrappers/Node acquisition/exact origin
registration; validate Windows, direct remote Linux, local Linux and macOS;
then live ordinary ChatGPT/Dot authorization and matched tool calls; then login
recovery, updates/drain/rollback/revocation. Cross-platform packaging and GitHub
release validation may proceed independently of store review. Do not replace
stable2.2 bytes or claim native support from a source push.

### Original Source/Test Slice — Owner `/goal continue` (Historical Contract)

Implementation proceeds in the canonical source tree without moving or dropping
its preexisting tracked/untracked work. Test state, generated fixtures, logs and
processes belong only under `os.tmpdir()`; no git worktree/branch, registry entry,
protected installation, credential or resident production service is created.
The first baseline run through `npm --prefix native/desktop-commander test`
actually executed76 tests:75 passed,1 Linux-only skip,0 failed on Node24.16.0.
An earlier absolute-path `node --test` invocation treated `[Develop]` as a glob
and executed0 tests; it is invalid evidence. Use npm's explicit prefix, or a
Node launcher that sets the literal working directory before test discovery.

**Goal:** existing Devices can exchange real framed messages with one explicitly
started test-owned control process and receive durable, correlated lifecycle
receipts across short-lived message bridges. This is a necessary integration
slice, not replacement of the complete multi-platform/direct-Linux objective.

**Architecture:** the browser sends only fixed action/ID/version. A registered
origin is checked by a native bridge. The bridge speaks authenticated local IPC
to one explicitly started process that retains the controller lease; it never
launches a tunnel itself. The owner keeps append-only bounded metadata records
before/after mutation. No tool arguments/results, keys or user paths travel to
the browser. Unknown operations block replay, not independent read-only status.

**Concrete local protocol for this slice:** Google native messaging was read again
in the in-app browser on2026-11-03: UTF-8 JSON with a32-bit native-byte-order length,
1MiB host-output/64MiB browser-input maxima, caller origin as the first argument,
and an optional Windows `--parent-window` argument. Our closed lifecycle messages
use a stricter4096-byte bound and one response per bridge process. A second frame
is never dispatched as another action.

The installer-owned adjacent `device-native-binding.json` contains only format,
version, extensionId and absolute stateRoot; Chrome cannot supply a state path or
change this binding. The source fixture writes it locally but does not register
it. The explicitly started owner exclusively creates a private channel descriptor
inside that state root. Windows uses a random local named pipe; Unix uses a socket
inside the private state directory. A stale descriptor/lease is a stop, not an
auto-reclamation signal. The bridge never starts an owner or runtime on demand.

Each IPC connection receives a fresh random challenge. Request and response MACs
bind that challenge, canonical origin, exact request and response, with separate
domains and a device-local random secret that is never transmitted. Frame bounds,
time limits and concurrent-connection bounds apply before admission. Changed
binding/channel identity fails closed. Losing the bridge/socket does not cancel or
replay an already durably admitted lifecycle action; another bridge queries the
same ID. Graceful owner shutdown stops admission, drains admitted operations and
uses the existing controller's stop/release checks; unknown stop retains fences.
POSIX ownership/private-mode checks and Windows ordinary-user fixtures do not
establish a protected Windows DACL or cross-account/elevated installation. Those
remain installer/platform acceptance gates.

**Files and ordered checks:**

- `native/desktop-commander/device-operations.mjs` and adjacent `.test.mjs`: new operation admission/receipt layer, using an injected existing lifecycle controller and a state-root journal. First write a failing existence/strict-envelope test, then duplicate-ID, different-intent, concurrent admission, durable-before-effect, journal-corruption, process-reopen and unknown-outcome tests. Verify the RED test fails because the API is absent; then implement only those contracts. Receipt settlement means a lifecycle request completed, not authentication or end-to-end tool success.
- Keep `lifecycle.mjs` as the single runtime owner and preserve its pause/stop/lease invariants. Use real temporary `prepareState` fixtures, never production profile/key files. Reuse existing local fake control-plane/inert-client patterns for testing; do not change the production official API URL.
- `device-owner.mjs` plus `device-native-host.mjs` and focused tests: one explicit owner entry and one one-shot native-message bridge, closed configuration from an installed binding, authenticated bounded local IPC, exact native little-endian framing and installed extension-origin validation. Windows ACL/protected registration remains a later installer responsibility; do not claim privileged cross-account security from current-user fixture code. No public/HTTP shell or auto-start-on-status endpoint.
- `device-control.js` and existing device tests: retain closed request schema and uncertain-operation journal. When polling a retained pending operation, use that operation's ID in the status request; the owner returns its matching retained receipt rather than an unrelated newest operation. No extra command/path/key field is introduced. Test two browser pages/profiles and an older lost response before enabling mutation after settlement.
- `native/desktop-commander/package.json`: explicitly include the new tests only after RED is observed; existing native/Devices/scheduler tests must still execute a nonzero count. Add spawned-process framing/owner persistence and final cleanup checks; browser transport fixtures do not prove an actually installed Chrome native host.
- Update this document and the existing continuation note with exact fresh results, scoped independent review, remaining installation/auth/login gaps and owned-process cleanup. No commit or release is created just to mark a task complete.

**Current verified source milestone:** the new operation layer was written after
its missing-implementation RED, then15 operation tests passed with0 skips. An
independent read-only reviewer found admission-fsync rejection settlement,
awaited-status journal replacement and browser pending-ID polling gaps; each was
reproduced with failing tests before correction. The same living owner can now
persist a known-unsent terminal receipt after durability recovers; an interrupted
owner still cannot infer non-execution or replay. Journal mutation during an
awaited query or mutation prevents a settled reply and keeps the owner fence on
close. A durable known-unsent recovery permits new work in the same living owner
only after all records are settled and an additional journal check/fsync succeeds.
Browser status now queries its retained pending ID rather than a fresh random one.

Fresh Windows source results after the final fixes: native91 total /90 pass /
1 Linux-only skip /0 fail;
Devices57 Node tests /57 pass /0 skips plus11 synthetic UI checks. Native stdio
also exercised pinned provider0.3.1,25 tools, owned file read/write and one harmless
process. These are source/fixture evidence, not an installed Chrome host, live
OpenAI authentication or ChatGPT/Dot authorization. The follow-up reviewer read
both final fixes and found those reported issues resolved without a directly
introduced major regression; that review did not rerun the suite or cover
installation/ACL/live devices. These counts describe the completed operation-layer
checkpoint, superseded for the current source by the IPC increment below. Test
output and fixture cleanup never authorize deleting a stale live-owner lease or
replaying uncertain work.

**IPC/native bridge increment,2026-11-03:** `device-owner.mjs` now owns the
controller/operations and a private local named-pipe/socket endpoint. A one-shot
`device-native-host.mjs` reads only its adjacent fixed binding, verifies the exact
Chrome origin (plus the documented optional Windows parent-window argument),
exchanges nonce-bound request/response MACs and emits a single reduced lifecycle
response. It never spawns an owner or a tunnel. `host.mjs` remains the separate
full-capability MCP stdio entry. Idle/truncated/oversized/non-UTF8/extra-action
frames reject before operation admission; one message bridge never dispatches a
second action. The bridge closes its own stdin after its awaited response so a
still-open Chrome input pipe cannot keep this short-lived process alive.

Final current Windows native package run:108 total,107 pass,1 Linux-only skip,
0 fail. Its seventeen IPC tests pass with no skips, including real owner/bridge
child processes, existing Devices controller reload plus lost-reply reconciliation,
nonce/replay authentication, descriptor replacement, owner death/stale fences,
closing admission and draining a disconnected active request. The real lifecycle
integration starts one finite test-owned readiness process, retains it across
multiple bridges and confirms pause/exit/lease cleanup. That process replaces
the official client/control plane, and its injected direct-child observation is
not proof of official tunnel/Core tree ownership. No private production state,
registry, native-host registration, service or login hook is touched.

Independent read-only review reproduced a shutdown ordering issue: changed IPC
metadata previously skipped `controller.dispose()`. A new failing test confirmed
dispose was never called; the fix now attempts only this owner's controller stop
before IPC cleanup validation, retains altered channel/operation fences, and
closes its own channel fd on failure. Follow-up review and the test confirm one
stop attempt and no directly introduced important regression within that scope.
A separate new open-stdin test reproduced a20-second one-shot bridge hang; closing
only bridge stdin fixed it without disposing the persistent owner. An incremental
independent static review confirmed the awaited stdout write precedes stdin
closure, stdout is not forced closed and the owner remains separately managed;
that final review did not rerun tests.

Bootstrap packaging now carries fifteen rather than twelve pinned runtime source/
lock/pin files. Its import-closure test and actual npm tarball/installed-byte test
include all three new runtime modules, never a local binding, channel secret or
journal. Current bootstrap run:122 total,120 pass,0 fail,2 explicit opt-in skips
because no six-official-archive directory or real offline-provider cache was
supplied. The synthetic installed package and fixture setup ran; historical
no-skip real-provider/archive evidence is not replaced or claimed fresh. This
bootstrap count predates the next completed setup-binding increment.

**Setup binding increment,2026-11-03:** local-target `setupDevice` now creates
`INSTALL/app/device-native-binding.json` with only the validated extension ID and
fixed `INSTALL/state` reference, using private create-only writes. It preserves
existing files and rechecks original identity/bytes/private POSIX mode after the
last asynchronous provider verification and again after pending-receipt creation,
before final commitment. New binding reads use the saved-key identity exclusion;
a key renamed into that path must never be consumed. Remote Linux with
`nativeHost:null` creates no local Chrome binding. Setup still starts no owner,
channel, operation journal, service or registry entry; all authentication,
registration,activation,protected-install and chat-grant flags remain false.

Five binding cases were observed RED before implementation, then GREEN. An
additional test now configures an actual disposable package, explicitly supplies
a fixture controller to its owner and reaches it through that package's own
spawned bridge without manually constructing a binding; the open stdin closes
normally after one complete response. It does not establish Chrome registration
or official-runtime authentication. Independent static review found no important
increment defect in consumer compatibility,key exclusion,commit order or partial
state preservation; it did not run tests.

Latest bootstrap suite:129 total,126 pass,0 fail,3 explicit skips: Linux-only
remote-target execution on this Windows host, six official archives not supplied,
and real offline-provider cache not supplied. Earlier122/120/2skip and128/125/3skip
runs are historical checkpoints. Next is source-only first-install platform
wrappers/registration, followed by the real installed Chrome path and remaining
Windows/macOS/Linux/direct-server/tool-grant/login-recovery acceptance.

### Course Application And Acceptance

This is an independent engineering project, not coursework completion. The actual
local CS381 notes distinguish responsibility from deployment tiers and explain
Strategy as holding/delegating a variable algorithm; CS310 API notes explain
stable resource IDs and repeated-request effects. Apply them as follows:

- Presentation renders Setup/Devices; domain logic owns consent/intent/operation state; platform adapters own installation/IPC/login mechanics. Logical layers do not require another cloud tier.
- Windows/Linux/macOS platform strategies share an actual install/lifecycle contract; remote SSH is a management adapter, not a second tool-data transport.
- Persisted request identity and observed effects enable reconciliation, not exactly-once shell execution. New transport connections do not authorize command replay.

Acceptance must be current and scoped: no-native-host behavior; first-install and
origin binding; one actual owner; browser-to-device matched receipts; crash and
unknown-operation recovery; full-account representative file/process/shell work;
explicit admin/root checks when chosen; direct server operation while Windows is
off; temporary versus persistent pause across real login; revoke/update/drain;
ordinary ChatGPT and Dot tool grants. Synthetic fixtures and historical122/75-test
snapshots do not prove these deployment requirements. The source/IPC/bootstrap
reruns above are current fixture evidence; real platform installation and
ChatGPT/Dot grants have not been rerun or established by this continuation.

## Scope

Settings links to a separate local Devices page. Its English-default interface
shares the scheduler's optional Simplified Chinese preference, but not task
controls. Opening Devices, checking browser permission, or selecting a chat does
not start, pause, or resume a scheduled prompt job and does not authorize MCP
tools in a chat. Dot and ordinary ChatGPT conversations follow the same rule.

The candidate uses optional `nativeMessaging`, requested only after an explicit
risk acknowledgement and button click. The user can decline it and continue to
use scheduling. No external website messaging API, native content-script relay,
public shell endpoint, or credential-storage facility is added.

### Research Loop

The owner sets a goal, acceptance criteria, device identity and resource budget
up front, and retains pause, revocation and final sign-off. The ordinary ChatGPT
or Dot session reviews a run's actual evidence and proposes a next run. A local
Trae/CLI adapter executes on the authorized device; the Chrome extension
manages the connection and approvals, not model prompts or the command stream.
The same official tunnel transports device tool calls. Keep scheduling prompts,
executing device commands, and admitting research work as separate capabilities.

1. **Execute:** reserve a stable run ID in the device owner journal before
   launching, with the project, revision, budget and expected output. Return
   a handle; a hosted MCP timeout must not imply the process exited.
2. **Report:** emit a versioned report with observed termination, metric values
   and named artifact hashes. Artifact resolution and file hash readback belong
   to the local adapter. A path or log string is not an instruction to execute.
3. **Review:** bind the reasoning decision to the exact report hash. An
   unsettled run can only be reconciled, and a retry uses a new ID after
   confirmed non-success. The owner still enforces pause, authorization,
   concurrent resource limits and globally unique run IDs before admission.
4. **Accept:** after verifying output bytes and owner-set criteria, present
   evidence for owner sign-off. A successful exit does not approve the work.
   Measure supported concurrency instead of promising a specific model limit.

`native/desktop-commander/research-handoff.mjs` implements the report and review
contract. The source-only companion `research-runner.mjs` can explicitly run
one local plan at a time per project, using the current Windows account and a
combined stdout/stderr capture budget. It records a create-only admission
before spawning. A same-ID duplicate observes the stored result and a changed
plan is rejected. A reviewed child run must name its parent's retained report
digest, with logs checked against the original artifact hashes. While holding
the project fence, the runner commits a create-only successor claim before
launch. The claim binds the parent report digest, child ID and child plan
digest. The exact child remains readable by ID, but a different ID cannot
dispatch a second continuation for the same parent, including after upgrade
from a ledger that predates claims. An orphaned claim or uncertain launch
requires reconciliation; the runner does not clear the claim or replay the
run. This is local process-interruption protection, not a guarantee against
storage loss or old runner versions writing concurrently.

Use `node research-runner.mjs run --state-dir ABS_STATE --plan ABS_JSON` or
`node research-runner.mjs status --state-dir ABS_STATE --project UUID --run UUID`.
The first plan has `parentRunId: null` and `review: null`. A continuation plan
includes the exact review with its new run ID. `run` is foreground; `status`
does not dispatch. The result reports the child's exit code separately from
whether the runner recorded it. An output truncated by the local byte budget
is not accepted as complete output.

An owner can opt into quantitative acceptance by adding nonempty
`acceptanceCriteria` to the initial plan, for example
`[{"metric":"accuracy","operator":"gte","threshold":0.9}]`. A governed
executor emits one UTF-8 JSON object on stdout, for example
`{"metrics":[{"name":"accuracy","value":0.95}]}`, and writes diagnostic
output to stderr. Report metrics are extracted again from the hashed stdout
artifact on readback. Malformed, incomplete, or capture-truncated output
cannot satisfy the criteria. Retries carry the original criteria unchanged
and reference the prior report digest, including when the process exited
zero but the evidence did not meet the criteria.

`node research-runner.mjs review --state-dir ABS_STATE --proposal ABS_JSON`
validates a proposal against read-back evidence and the original criteria.
`ready-for-owner-review` is not owner approval. The command neither runs
the next plan nor records owner acceptance. These criteria verify consistency
with executor output, not that the executor measured the metric correctly.

This is not yet a research owner with authenticated remote admission, a
background task API, Trae integration, OS CPU/GPU budget enforcement,
crash-safe streaming output or a Windows administrator runtime. The
project fence assumes the prepared current-user state is not writable by
an adversary; it is not a boundary against that same account. The next
integration must return a durable handle promptly, reconcile owned processes
after reconnect and verify real revision, rerun and final artifact review
from both authorized chat surfaces. A transport-only test does not count.

## Installation Boundary

### Prepared Command References

For commands whose text must survive the model/transport unchanged, create a
local UTF-8 JSON file containing only `command`, `shell` (absolute path), and
`timeout_ms` (positive integer). Review the command locally and run:

```text
node ABS_APP/prepared-process.mjs inspect --request-file ABS_REQUEST_JSON
node ABS_APP/prepared-process.mjs stage --state-dir ABS_DEVICE_STATE --request-file ABS_REQUEST_JSON --reviewed-sha256 REVIEWED_SHA256
```

The digest covers UTF-8 `JSON.stringify([command, shell, timeout_ms])`.
Staging checks the digest again, creates a device-local record, and starts
nothing. In a conversation already authorized for that device, call
`agent_continue_start_prepared_process` with only the returned
`agent_continue_operation_id` and `agent_continue_process_sha256`. The host
checks those values, the retained command, and the 30-minute validity window
before reserving the same durable operation receipt used by exact execution.
Never create a new ID as a retry after an uncertain result. A duplicate can
query `agent_continue_operation_status` for its original receipt; the
`prepared-process` kind denotes admission through this exact path.

To withdraw a pending prepared operation locally, use the same UUID and
reviewed digest:

```text
node ABS_APP/prepared-process.mjs revoke --state-dir ABS_DEVICE_STATE --operation-id UUID --reviewed-sha256 REVIEWED_SHA256
```

`revoked: true` means the owner claimed the same create-only receipt slot
before admission. A later call with that UUID is refused, even after the
MCP host restarts or the client reconnects. Repeating revoke returns the
same result. Exit code 2 with `revoked: false` means the CLI could not
establish withdrawal; a command already admitted is not stopped by this
operation. Use the retained operation status to distinguish a result from
an unresolved admission. Revocation is for that UUID, not for independently
staged commands or a different tool grant.

The unpublished **Devices > Browser-managed Windows > Prepared command**
section can check the same UUID and digest and explicitly revoke a pending
operation. It requires a fresh device status and a matching native owner.
The native bridge returns only the receipt status and expiry, not command
text or output. The confirmation shows the complete reference. Review the
actual command in its local request file; checking the reference in Devices
does not replace reviewing the command. If the revoke reply is lost, check
the original reference again. The page never retries the mutation.

This is an integrity check, not chat authorization, a sandbox, or proof of
elevation. The UUID and digest do not say what the operation does; the owner
must review the local command before approval. Staging retains plaintext
under `prepared-processes` in the chosen device state. Expiry blocks a new
start but does not delete that file. Do not put credentials in staged
commands. The CLI does not provide record pruning. Do not hand-edit a plan to
renew it.

### Integrated Product Design

The intended capability is full file, terminal and process access as the
explicitly selected OS identity, not a status-only tool or directory sandbox.
Administrator/root execution must be stated before OS consent; a standard-user
installation must not be relabeled administrator access. Both ordinary ChatGPT
and Dot use the same device MCP and the platform's actual tool authorization.
Selecting a chat is navigation/binding metadata, not that authorization itself.

```text
Extension Setup / Devices  ->  installed native coordinator  ->  OS lifecycle
                                                                |
ChatGPT / Dot  <->  official OpenAI tunnel  <->  device runtime  <->  MCP stdio
```

The extension is the control plane, never the tool-command data path. A remote
Linux runtime lives on that server; Windows is used at most for initial SSH
bootstrap, not continued forwarding. No Vercel relay or public admin endpoint
is needed. The MCP implementation is intended to reuse the reviewed open-source
Desktop Commander core; its commercial `remote` launcher is a different service.

The eventual wizard has six checkpoints: choose the device and account scope;
review/install the native coordinator with OS approval; keep the runtime key in
protected device storage; create and validate the official tunnel profile;
install/authorize its ChatGPT plugin; verify a representative tool call against
the device receipt. Subsequent explicit operations can use the installed
coordinator without repeated shell copy/paste. A browser extension cannot bootstrap
its own first native host, silently approve UAC, or grant a ChatGPT plugin itself.

Setup rendering, request validation and filesystem verification are separate
layers. `setup.js` displays choices; `setup-model.js` builds the closed request;
the platform consumer validates it before calling its package reader. Platform
strategies isolate Windows native messaging, direct Linux lifecycle, and future
macOS support without moving shell execution into page/content scripts. The
existing scheduler is not a device supervisor.

This applies selected CS381 L04 layering and L09 Strategy material, and CS310
October 22 request-response/idempotency material, to an independent project.
It is an engineering adaptation, not an assignment solution or a claim that
native messaging is REST. Persisted intent plus a request ID supports
reconciliation, not exactly-once OS effects after a crash. An uncertain mutation
must be observed before retrying. Source-only Plan is repeatable; activation,
reconnect, update and removal require separate operation receipts.

One runtime may own a given stdio tunnel. Updates must stage and verify a pinned
version, inspect active work, stop the previous owner, and then start its
replacement; no overlap or blind replay. Manual pause and revocation remain
available. Optional resume on the next real interactive login belongs to the
device lifecycle policy; an automated SSH probe must never clear pause.

Upstream review on 2026-11-02 found Desktop Commander main package version 0.3.1,
MIT license, Node >=22.12.0 and a `dist/index.js` stdio entry. This observation is
not a selected production pin. Its package has installation scripts, and its
[privacy policy](https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/main/PRIVACY.md)
states telemetry is enabled by default. The integration must configure and test
telemetry-off behavior before first execution, review install hooks, retain
licenses, and use fixed reviewed artifacts rather than execute `@latest` at
each startup. Raw upstream tool history can include arguments/results and must
not be exported as AgentContinue's reduced diagnostics. macOS should retain the
official tunnel client's supported Homebrew path without bypassing Gatekeeper.

### Setup Handoff Contract

The next candidate adds a separate English-default, Chinese-optional Setup page.
It does not change device control or scheduling. The user explicitly chooses
Windows, macOS, local Linux or a remote Linux server. Target choice is guidance,
not proof of the current operating system or an enrolled device. No installer is
advertised as released or runnable when the corresponding implementation is not
available.

An explicit review-and-download gesture may export one local JSON request with
exactly five fields: `format: "agent-continue-device-setup"`, `version: 1`,
`target`, the actual 32-character `extensionId`, and `nativeHost`. The host is
`com.agentcontinue.device_control` for local targets and `null` for remote Linux.
The request has no command, path, key, account, machine identity, timestamp or
approval flag. It does not authorize installation, elevation or tools.

The Windows source installer may consume a Windows request as bounded, strictly
validated untrusted data to select its extension binding. Explicit conflicting
extension arguments reject. Default behavior stays read-only Plan; Stage still
requires separate administrator approval and a matching reviewed fingerprint.
Other target requests reject in this Windows installer, without a fallback.
The request is not copied into the protected application or executed.

The new remote Linux source consumer is `linux/setup_plan.py` in the separately
reviewed private MCP bootstrap. It accepts only `linux-server` with `nativeHost:
null`; other targets and extra fields reject before package access. Its three
explicit arguments are `--request-file`, `--package-root` and
`--manifest-sha256`. Package location and independently retained digest stay on
the server, outside the five-field request. It imports no payload, performs no
installation or network operation, and always returns `readyToApply: false`,
`installationVerified: false`, `tunnelReadiness: "not-observed"` and
`chatAuthorizationVerified: false` even after source verification succeeds.

On 2026-11-02 the in-app browser actually downloaded a remote Linux request.
Each ordinary-user temporary fixture on .15 and .18 then passed all 32 consumer
tests with zero skips, and separately accepted those exact browser-produced
bytes through the native Linux reader and an inert source package. The owned
temporary directories were removed. This is producer/consumer and native-reader
evidence, not root installation, dependency installation, tunnel activation or
ChatGPT tool authorization. Local Windows tests still skip the three native-only
cases. The current pure Node device/dialog/setup suites pass 67 tests; isolated
in-app browser checks found and fixed a narrow-screen command overflow.

Opening the guide, changing target, exporting the request or following a fixed
official documentation link must not prompt for native permission, call the
native host, inspect chats or alter scheduler data. Browser permission remains
an explicit operation on Devices. Remote Linux remains a direct device tunnel,
not a Windows relay. Official tunnel setup, private plugin installation and
per-chat authorization remain separate gates; no self-check box marks them ready.

A browser extension cannot install its own first native host. Initial local
installation and any elevation require a separately reviewed installer and OS
approval. No native installer download is currently published or linked here.
Do not paste or upload runtime keys into the extension.
The page displays the actual installed extension ID. An installer must bind to
that exact ID; an unpacked development copy can have a different ID from the
store version. This identifier is not an API key or a chat authorization.

The Windows source installer separates read-only `Plan`, protected versioned
`Stage`, independent `Verify`, read-only `RegistrationPlan`, and explicit
`Register`. A reviewed fingerprint binds the source, exact origin, current user
and Node runtime. Staging does not register or activate anything. Registration
requires revalidated staged files and creates only a new user-level Chrome
entry; any existing/shadowing entry blocks it, even an identical one. Partial
outcomes are retained without replay or automatic deletion. Automatic removal
is not implemented by this candidate. None of these modes overwrites the live
Private Research MCP runtime, creates a service/task, or copies credentials.
Production registration, rollback, broker lifecycle and actual administrator
browser control remain required before distribution. The bounded local staging
evidence below is not evidence of those later gates.
macOS/Linux native installation is not yet implemented by this Windows candidate.

### Local Protected Stage Evidence

On 2026-11-02, the owner explicitly approved only Stage and Verify for fingerprint
`cf9f40f12c2f6f486eacf9d63a51038f34301d6431723462c342da20bd9c72d4`.
One hidden elevated maintenance process completed both operations and exited 0.
An independent fresh PS5.1 Verify, invoked from the protected staged installer,
also returned Verified=true. The versioned Program Files directory contains the
25 reviewed sources and five generated artifacts, including an unregistered,
disabled task XML and an unexecuted GUI-subsystem native launcher. The directory
and evidence receipt have protected DACLs and Administrators ownership; SYSTEM
and Administrators have full control and the bound owner has read/execute access.

The maintenance runner used retained, hash-checked source/ancestor read leases
through child execution and exclusive evidence-directory allocation. Actual
nonadministrator primitive tests checked bounded reads, denied writes while held,
write access after release and rejection of an existing evidence directory.
The UAC command embedded the reviewed runner text and checked its complete
command-line bound, without a second pathname execution or nested Base64 layer.

The protected receipt reports Activated=false, NativeRegistrationChanged=false,
ServicesCreated=false, TasksCreated=false and CredentialsCopied=false. No live
MCP was overwritten. This is source staging/build/ACL verification only: no
native-host registration, broker provisioning, browser permission or end-to-end
device-control acceptance is established by it. Candidate changes remain outside
the published v2.1.0 release.

The current Windows staging source now includes the broker's full source
inventory and a deterministic, initially disabled task XML artifact. This local
broker is intended to remain available after the MCP runtime is paused; starting
it does not itself reconnect the remote MCP. Its definition has passed an
in-memory native Task Scheduler import, not task registration, administrator
execution or lifecycle acceptance. The stage explicitly leaves installed control
dependencies unverified and does not create, enable or start any task.

A separate Linux offline source-kit candidate now supports explicit packaging
and retained-digest verification without the historical host-bound temporary
paths. Its separate Python source stager now implements native root-gated
Plan/Stage/Verify without activation. On 2026-11-02 its ordinary-user native test
fixtures on both .15 and .18 passed 94 tests each with zero skips, including
source validation, exact paused staging mechanics, real ACLs and bounded query
process behavior. These are temporary synthetic fixtures, not protected-root
installation or service activation evidence. The candidate includes no
credentials/dependencies and is not invoked by this Devices page. Root
installation, direct-device onboarding and end-to-end platform authorization
still require separate work.

Later on 2026-11-02, an actual Windows CJS source package was transported to two
authorized Linux hosts and read by the separately pinned Python verifier on
Python 3.12.3 and 3.10.12. Both hosts verified all 28 allowlisted files and
rejected wrong manifest digests, modified payloads and unexpected files. The
ordinary-user, identity-bound temporary trees and local package work tree were
removed, with successful readback receipts. Payload code was not executed or
imported; only the separate verifier bootstrap was imported. This establishes a
source-package handoff, not root staging, dependency provenance, service
activation or platform tool grants. The one-shot Windows test driver also has
owned-Job process containment, sticky cancellation and typed result validation;
its final 18 process and 8 driver cases passed, including 410 malformed-value
rejections. Pause checks are not atomic coordination with an independent writer,
and terminating SSH is not evidence of remote process exit or rollback.

The fresh Windows read-only RegistrationPlan returned CanRegister=true on
2026-11-02: all four exact Chrome registration slots were observed absent/safe.
This neither reserves them nor grants registration authority. A separate ordinary
user prerequisite probe did not find the protected control adapter, journal
directory or receipt registry path. Access to the installed administrator-runtime
control file was denied and remains NotObserved, not absent. Dependency
verification/provisioning is still necessary before a usable broker activation;
registering the native host alone would not establish administrator control.

### Windows Administrator Bundle Boundary

The per-user preview is never an administrator bootstrap. The separate
maintainer-only `scripts/Stage-WindowsAdministratorBundle.ps1` accepts a reviewed
ZIP and its independently obtained SHA-256. `Plan` opens the ZIP read-only and
checks the fixed Windows Program Files anchor and entry layout. Explicit
`Stage` must run from a trusted copy of the stager in an already elevated,
non-impersonating Windows PowerShell 5.1 session. It takes a create-only
reservation, extracts into a version directory selected by the archive hash,
and verifies the exact tree. `Verify` repeats the content and ACL checks
against the same archive, without changing either side. It is never called by
a browser message. Partial staging remains fenced for manual review.

Code, Node and the official tunnel runtime are separate from device state and
credentials. The ZIP has only `app/`, `runtime/node.exe` and
`client/tunnel-client-runtime.exe` paths. Both directories and files are
created with Administrators ownership and an explicit protected DACL:
Administrators/SYSTEM full control and standard Users read/execute. The
archive hash is a reviewed input, not a publisher signature; these checks
establish the installed bytes and their ACL, not dependency provenance or
that those bytes are appropriate to execute. Never stage from an
unreviewed build, or execute the stager from a location modifiable by a
different process you do not trust.

To build an x64 candidate, supply the official Node 22.23.4 ZIP, the official
OpenAI Windows amd64 runtime-only v0.0.19 ZIP and an npm cache populated
for the exact runtime lock. Run these build/acceptance commands **without**
elevation from a reviewed checkout:

```powershell
node scripts/build-windows-administrator-bundle.mjs --node-archive $nodeZip --tunnel-archive $tunnelZip --npm-cache $cache --out $candidate
powershell.exe -NoProfile -NonInteractive -File scripts/Test-WindowsAdministratorBundleSmoke.ps1 -Archive $candidate -ExpectedSha256 $candidateSha256
```

The build replays the npm lock with installation scripts disabled, copies only
the disposable application tree and the two pinned executables, and includes
license/notice files and a build evidence record. The smoke test rechecks the
ZIP hash and exercises the extracted runtime locally under a standard token,
without any tunnel key or network transport. A locally generated hash is not
an independently reviewed release digest.

After a positive Stage, `PrepareState` accepts the same archive and digest,
the selected Windows account SID, and explicit
`accept-administrator-state-preparation` consent. It verifies the installed
bundle and the current native account before creating a separate state
directory. The fresh state is paused and tied to the full digest and SID;
Administrators/SYSTEM control it and its newly created children do not
inherit ordinary Users access. `VerifyState` is read-only, and rejects any
extra or changed item in this **fresh** state. Do not use it as a replacement
for inspecting an already-running owner's journal.

The generated launch plan clears inherited environment variables, assigns
known system and pinned Node paths, and loads a private startup import
guard. The guard permits Node built-ins and real files within the packaged
app, but rejects falling back to an ancestor `node_modules`. This protects
dependency resolution, not the actions of an authorized tool; it does not
sandbox user-approved PowerShell. Pass `-ExercisePreparedLaunch` to the local
smoke script to test these arguments against the extracted runtime under a
standard token. The plan does not launch a production process.

Before any administrator activation, provide independently reviewed release
evidence and a separately protected tunnel profile/key, then exercise the
launcher from the native elevated owner.
Only that launch path may use Windows consent to start an elevated execution
owner. Verify the actual child SID, elevation and integrity through both web
surfaces, including pause/revocation and no replay. None of this stager's
operations starts a worker, requests UAC, writes a Chrome registration or
creates a service/task.

## Manual Control

The native protocol accepts exactly `status`, `disconnect-and-pause`, and
`reconnect`, with a fresh bounded request ID. It accepts no command, file path,
hostname, shell input, or credential from the extension. A protected local
broker, not a website or user-provided executable, is the intended privileged
control boundary. Reconnect requires explicit local confirmation and can
restore remote MCP access; the corresponding chat platform still controls
actual tool availability and approvals.

Unknown tunnel readiness is displayed as unknown, not successful access. A fresh
boolean pause observation may permit confirmed manual control; unavailable or
invalid pause evidence does not. Native-host absence, browser permission denial,
transport failure, and rejected requests remain distinct states.

Before a mutation, the page durably records its request under a cross-page
lock. A timeout, reload, or generic healthy status does not erase an uncertain
operation. Only matching settled-operation evidence releases that lock;
settlement does not prove successful connection. Status remains available while
the mutation is pending. There is no automatic mutation replay or reconnect.
Local operator diagnosis is still needed if a matching receipt is unavailable.
Each shared journal transition has a separately persisted revision marker under
the same cross-page Web Lock. A delayed reply cannot revive an operation after
another page completes an empty-to-pending-to-empty cycle. An unread journal
invalidates the observation rather than assigning it the cached current revision;
storage recovery alone does not restore mutation eligibility.

If an admission write fails before native transport, the original live controller
retains bounded, in-memory evidence that this exact intent was not sent. Under
the shared lock, it can retire only its own metadata after storage recovers,
without overwriting foreign work or sending a mutation. An explicit fresh status
can then restore controls; no fictitious host settlement is required. This proof
is not inferred from a transport failure and is not persisted across reloads.
Actually dispatched unknown operations remain locked until matching settlement.
If the originating page disappears with committed metadata, another page cannot
infer that it was unsent. Durable cross-reload reconciliation remains unfinished;
do not delete the pending key or interpret generic healthy status as settlement.

Cancel and native Escape synchronously invalidate dialog consent. Confirmation
requires the currently open review, consumes its action once and rechecks current
eligibility. A queued close event from an older review cannot clear a newer one.

## Validation

The local Setup page exports a closed five-field JSON handoff after a separate
review and consent gesture. It uses the actual runtime extension ID; it never
substitutes the store ID. The Windows source consumer accepts only Windows
requests with a 4,096-byte limit, rejects conflicting explicit origins, and
defaults to read-only Plan. Export is not installation or authorization. The
inline Windows handoff section names that source consumer without inventing a
released installer. Remote Linux shows a direct-server sequence rather than
local browser-bridge instructions.

An earlier 2026-11-02 `npm test` snapshot passed, including six setup-model tests, eighteen
synthetic setup-UI checks and eleven isolated real-MV3 scenarios. The real-MV3
handoff check observed native browser download completion and read the resulting
owned file bytes; UI feedback alone was not treated as a saved-file receipt.
Synthetic setup screenshots cover English/Chinese, light/dark and 1100/320-pixel
widths. A queued old dialog-close event cannot clear a newly reopened review.
These checks do not establish installed native control or real platform grants.

After the manual-control changes above, the current pure-Node controller,
dialog, setup-model and source-integration suites passed 62 tests with zero
failures or skips. Independent re-review exercised four additional synthetic
cross-page/storage-failure combinations without new findings in that scope.
The in-app browser loaded current device sources against a simulated bridge:
Cancel/Escape sent no mutation, confirmed pause and reconnect each submitted
once, and English desktop plus 360-pixel Chinese layout were inspected without
control overflow. The fixture contains no real native-host, scheduler or OS
control. These checks do not establish real Chrome storage/crash recovery,
installed-extension privileges or production device control. The entire current
`npm test` command was not rerun because its UI suites launch a separate Chromium;
this run used only the requested in-app browser for UI actions.

A Windows PowerShell 5.1 producer-to-consumer test exercised the actual JavaScript
metadata model and actual default Plan without Stage or registration. Independent
review identified a path-replacement window between metadata checks and opening
the request pathname. The source consumer now anchors a local volume, opens
each child relative to its retained parent handle, and parses the bounded bytes
from that exact final handle without reopening the pathname. Native owned-file
fixtures verify ordinary write/delete/rename/junction refusal and lock release;
source review confirms the byte handoff. This closes that identified reader
route, not every filesystem or privileged-installer threat. A real extended
POSIX leaf replacement succeeded without a lease and was blocked with sharing
violation 32 while the lease was held; successful replacement under a held
lease was not exercised. Production installation/lifecycle acceptance remains
separately scoped.
The candidate remains
unpublished and does not replace the released scheduler or live MCP runtime.

`npm run test:devices` exercises strict schemas, correlation, permission timing,
cross-page coordination, pending receipts, bilingual UI and synthetic layouts.
The existing MV3 suite continues to test scheduling on isolated Dot and ordinary
chat fixtures. These tests do not contact a production native host or prove
administrator execution, real chat grants, Linux access, first installation,
restart recovery, updates, or revocation. Those are separate acceptance gates.

A separate Windows test has exercised real browser native messaging through the
actual-source GUI launcher and Node relay to a fixed PowerShell fixture backend.
Its temporary random host registration, synthetic profile and owned processes
were cleaned up. That result verifies this transport boundary, not the released
Devices page, protected installation, administrator broker or production access.

## Administrator browser pause design

The administrator native host handles `wake`, `status`, `pause`, `pause-reconcile`, and the
read-only `pause-support` and `pause-status` actions. Browser standard-device
pause uses a different owner; neither that action,
unchecking browser restore, nor removing Chrome permission proves an elevated
owner stopped. Browser-initiated Pause must use a separate fixed action,
not extend the existing Wake action.

**Implemented in source:** A local, explicitly authorized
`PauseHostedOwner -PauseOperationId <32 lowercase hex>` reserves the ID
before changing intent. The unchanged legacy invocation has no operation
receipt. An operation with only a reservation is unknown and is not replayed.
The read-only `ObserveHostedOwnerPause` command projects
`{operationId,state}` into the exact Devices page via the native bridge.
The allowed states are `unconfirmed`, `pause-recorded`, `stopped`,
`superseded`, and `fenced`.
`stopped` is historical: the owned runtime was idle or its exact
Job generation drained before recording. It is not a claim about the
current connection after a later Connect. A new browser preview can request
the fixed local action as described below. No task, custom launcher or remote
elevation API was added.

1. After explicit owner confirmation, the exact top-level Devices extension
   page sends a fixed action without arguments. The worker checks support
   before allocating an operation ID, captures the sealed control revision
   and Job generation, serializes requests across pages and persists the ID
   before dispatch. Unknown IDs are queried, not replayed. A verified
   `pause-recorded` already consumes its ID; it permits a new explicit Pause
   without falsely treating the earlier generation as stopped.
2. The ordinary-token preflight checks the interactive account, active
   native registration, protected paths, bundle hash and enrolled stager
   hash. Old or incomplete enrollments cannot request Pause. The only
   elevation transport is Windows `runas` of built-in PowerShell with the
   fixed, sealed `PauseBrowserHostedOwner` or `FenceBrowserHostedOwnerPause`
   command. The child independently verifies high integrity and exact SID,
   then rechecks active registration under the owner control guard. No elevation
   through MCP, general-purpose broker or wake-task fallback.
3. Under the protected owner guard, admit each UUID once. A stale target or
   revoked owner produces `superseded` before changing pause intent. Actual
   Job admission advances the control revision so an old idle target cannot
   become valid again when a later Job exits. For a matching target, save the
   pause and associate it with that exact generation.
   The target is initialized before enrollment commits. A stale commit attempt
   refreshes the projection without applying Pause; the fixed local-only
   `RepairBrowserHostedOwnerPauseTarget` action can rebuild missing readback
   under the same guard without changing intent.
   Publish minimal, protected, owner-readable readback: pause recorded is
   distinct from stopped. Verify drain, root exit and lease clearance before
   reporting stopped; handle the already-idle case independently under the
   guard. A later Connect supersedes old pause state.
4. A process-launch response does not prove pause; Windows error 1223
   confirms cancellation only. On a lost response or deadline, read that
   ID's receipt without resending the action. For a still-unconfirmed current
   ID, the owner may explicitly request local reconciliation. With Windows
   authorization it atomically consumes that exact ID under the same guard and records
   `fenced` without changing running intent. That state means the operation
   cannot run again; it does not claim a previous effect did not occur.
   An already recorded pause keeps its original receipt. A new Pause requires
   a new explicit confirmation. Reconnect and device revocation remain
   separate explicit operations; browser permission is not device authority.

The source and disposable tests cover launch-plan validation, cancellation
classification, wrong identities and modified assets, late or lost replies,
duplicate operations and exact Job drain. The Windows 5.1 test also reads a
real ordinary interactive token. Before shipping, verify both UAC cancellation
and approval from a real Chrome extension with an enrolled test owner; then
verify the protected receipt, Chrome reopen and hosted revocation. The
candidate is not deployed to the existing browser-managed owner.
