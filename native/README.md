# Native Device Integration (Development)

This source is separate from the released browser scheduler. It is not a signed
installer, a registered native host, or evidence of a new device authorization.

## Problem

The extension cannot install its own first native host. Its setup request also
cannot substitute for OS consent, a protected runtime key, or ChatGPT tool
authorization. Reusing one person's existing PrivateResearchMCP paths would not
provide a reusable product. The native integration must give both ordinary
ChatGPT and Dot full access as the explicitly selected OS account, while the
target device connects directly through the official OpenAI tunnel.

## Technical Plan

Use three separate responsibilities: the extension displays the onboarding
workflow; the native coordinator owns install/lifecycle receipts; the device's
official tunnel supervises a pinned Desktop Commander stdio process. Tool
commands never pass through the browser extension or a developer relay. Runtime
credentials stay on the target device, outside these sources and browser data.

The first runnable increment is `desktop-commander/`: a locked upstream package,
explicit first-run full-account consent, private state preparation, and a fixed
stdio launch path. Preparation is not activation, and dependency integrity is
not proof of administrator ownership. Do not run this development source with
administrator/root privileges or replace an existing production installation.

## Alternatives

- The upstream commercial `remote` launcher uses a different hosted service; it
  is not the selected OpenAI direct-device tunnel.
- `npx ...@latest` at every startup can change executable code and run install
  hooks during reconnect. Production will use reviewed versions and staged updates.
- A replacement shell-only MCP would duplicate upstream file/process tools.
  Reuse the open-source core, retaining its license and reviewing its defaults.
- Extension-owned automatic reconnect would confuse browser lifecycle with
  device lifecycle. Resume after a real interactive login remains a device policy.

## Detailed Implementation and Acceptance

The Desktop Commander package is locked to 0.3.1. Dependency acquisition uses
`--ignore-scripts`; this skips install hooks and is not by itself a complete
native dependency setup. Before executing upstream code, the launcher must
establish an isolated configuration root, telemetry disabled, no hosted remote
mode, and explicit account-level access consent. The selected OS identity, not
an extension checkbox, determines actual filesystem/process privileges.

Tests must cover missing consent, conflicting/existing state, incorrect package
identity, inherited Node preload/config redirection, and sanitized failures.
An isolated real stdio exchange must initialize MCP, enumerate tools and execute
a harmless operation in an owned test directory. It must leave existing user
configuration, keys, VPN, research processes and services unchanged. Any upstream
startup network behavior must be inspected and controlled before that exchange.

Later gates remain: reusable protected installers, platform-specific bridge
registration, official tunnel provisioning/readiness, ChatGPT approval and
matching tool-call receipts, macOS implementation, updates and revocation.

## Next Increment: Local Configuration CLI

Problem: the fixed core has a real stdio path, but onboarding cannot yet turn
device-local inputs into a repeatable official-client profile. A browser setup
request must not contain a secret or arbitrary shell command.

Plan: add a strict `prepare / configure / inspect` CLI. Preparation requires
explicit full-account consent. Configuration verifies the existing state, the
pinned provider and official tunnel executable, and references an existing
device-local runtime-key file without reading or copying its contents. It writes
a create-only profile and binding receipt; a partial or changed binding is an
error, never silently overwritten. The endpoint is fixed to the official OpenAI
API, health is loopback-only, startup browser opening is off, and raw HTTP logs
are off. Inherited configuration/proxy variables must not override the profile.

Alternative: accepting a browser-supplied command, endpoint or key would turn
onboarding into another command/credential transport. This is explicitly not
the design. Automatically connecting from an `inspect` operation would also
erase the distinction between configuration and device lifecycle.

Implementation/acceptance: pure profile construction, actual write/inspect and
negative tamper cases, sanitized CLI framing, and an official-client loopback
exchange using the generated profile with only a fake runtime-key file. Unit
fixtures with synthetic executable pins are not official-binary acceptance.
The CLI does not activate the tunnel or implement pause/autostart; those remain
coordinator responsibilities. `activated: false` on prepare/configure describes
that operation only; inspection reports activation as `not-observed`, not that
the device is offline. Supported executable pins are Windows/Linux x64 for now;
macOS and other architectures are not silently accepted.

### Developer CLI (Not An Installer)

Run these from `native/desktop-commander/` as an ordinary user after the pinned
dependencies are installed. Replace the placeholders with absolute paths;
choose a new state directory and an existing device-local runtime-key file.
Do not put the key under this source tree or inside the state directory: keep
credentials separate from executable/configuration inputs. Runtime and admin
keys have different permissions; use a runtime key with the official Read/Use
scope, not an admin-management key. No real key is supplied by this repository.

```sh
node setup-cli.mjs prepare --state-dir "<absolute-new-state-directory>" --consent full-account
node setup-cli.mjs configure --state-dir "<absolute-state-directory>" --tunnel-id "<complete-service-returned-tunnel-id>" --runtime-key-file "<absolute-runtime-key-file>" --tunnel-client "<absolute-verified-official-client>"
node setup-cli.mjs inspect --state-dir "<absolute-state-directory>"
```

`configure` writes `tunnel.yaml` (JSON-compatible YAML) and `binding.json` only.
It references, but does not read/copy, the validated runtime-key file's contents.
It rejects key/client file identity overlap, reserved state/source locations,
redirected inputs, conflicting destinations and unknown executable bytes.
Unix key references must be owned by the current user and not group/world
accessible. Windows ACL protection is still a separate installer gate.

The CLI returns bounded JSON with no raw exception, local path or secret. It
has no start, install, elevation, registration or arbitrary-command subcommand.
`inspect` validates configuration only; it does not connect, clear pause,
authenticate the key, or establish a ChatGPT/Dot tool grant. It cannot report
the current active runtime's state. Changed or partial bindings require an
explicit maintenance decision; no automatic overwrite/repair is attempted.

The profile's device-to-OpenAI traffic has no developer relay. Its launch
environment drops inherited tunnel target, endpoint, proxy, tracing, raw-log
and browser-opening overrides rather than allowing them to supersede YAML.
This changes the candidate child environment, not system VPN/routes/DNS or
the user's global environment. Enterprise proxy/CA choices need a separate
explicit integration path; OS networking and trust stores remain in effect.

The profile contract follows the pinned [official configuration reference](https://github.com/openai/tunnel-client/blob/v0.0.19/docs/configuration.md).
One active stdio client per tunnel ID remains required. The official client's
`runtimes connect/status/stop` helpers are a possible lifecycle backend, but
have not yet been adopted or verified by this candidate. Initial OS/native
installation, activation, pause/resume and login policy remain unfinished.

## Next Increment: Owned Runtime Control

### Problem

The configuration CLI does not own a running client. Browser controls need a
device-side owner that can connect and pause without guessing process identities,
silently clearing pause, or starting overlapping stdio clients. A successful local
health probe is not ChatGPT authorization. This increment is an ordinary-user
library, not an installed service, native-messaging host or autostart policy.

### Technical Plan

Add `lifecycle.mjs` with `openController(root)` and explicit `reconnect()`,
`pause()`, `status()` and `dispose()` methods. One create-only lease under the
validated state root owns this controller. No stale lease is automatically
reclaimed: a crash needs explicit reconciliation before another owner can start.
The owner retains the actual child handle; it never loads a PID and kills by
name. The configured official binary supervises the existing full-account core.
Tool commands still go directly through the official tunnel, not this controller.

### Alternatives

The official `runtimes connect/status/stop` helpers were inspected, including
their profile generation and native process implementation. They rewrite their
own profiles and keep a different alias state; adopting them without checking
our pinned profile/privacy and no-window requirements would create competing
owners. This increment keeps one fixed `run --profile-file` launch. An OS service
adapter can later own this library; another periodic watchdog is not required.
PID-file takeover, lease expiry and blind restart after an observation timeout
are deliberately not recovery strategies.

### Detailed Implementation and Acceptance

- Opening/inspecting never starts a process. No saved intent defaults to paused.
  A bounded canonical `lifecycle.json` persists only the desired paused bit;
  malformed, redirected or partial state rejects without repair. Intent is
  atomically published before an OS effect; a publication failure has no launch
  or signal effect. Lease file identity and bytes are rechecked before operations;
  ownership loss forbids launches and lease deletion, not PID-name takeover.
  Ownership checks do not require an unchanged provider policy: a user-edited
  provider policy may block another launch, but cannot disable manual pause of
  the already owned client. Filesystem failures use fixed error codes.
- Explicit reconnect verifies configuration and code before launch, records the
  connected intent and launches once. A concurrent reconnect is rejected, not
  replayed. A live owned client is reused; failed readiness does not start a
  second client. Unexpected exit is observed as failed, without a retry loop.
- Pause records paused intent before signaling the owned child and interrupts
  pending readiness work. Reconnect cannot overtake pause. Stop waits are bounded;
  timeout remains unconfirmed and does not authorize force-kill or replacement.
  All elapsed budgets use a monotonic clock rather than adjustable wall time.
  A late successful readiness response after pause is discarded. Dispose cannot
  replay an unconfirmed stop and releases nothing until exit is confirmed.
- Every launch gets a new private health URL file under the state root, passed
  as `--health.url-file <new-owned-path>`. Flags override the unchanged canonical
  profile in pinned 0.0.19; the profile/binding bytes are not rewritten. Readiness
  accepts only a bounded regular file containing
  a loopback HTTP origin, follows no redirects and has a bounded request timeout.
  Only HTTP 200 from `GET /readyz` establishes local readiness. Pause cancels the
  active probe. Status performs at most one local probe, with no OpenAI request.
  No inspection path contacts OpenAI or reads a runtime-key file.
- Status returns only paused intent, owned-client state, local readiness and
  `chatAuthorization: not-observed`. It does not expose paths, command output,
  credentials, PID inventories or raw exceptions.
- Before reporting a running client, capture the direct Node core's PID, OS
  creation identity and executable, matching the configured Node executable.
  `process-observation.mjs` exposes `observeCore(parentPid, nodeExecutable)` and
  `hasExited(identity)`. Linux reads only `/proc` process metadata; Windows uses
  bounded, hidden, profile-free PowerShell to call fixed Windows APIs. A Toolhelp
  snapshot filters PID/parent PID before opening matching processes with only
  `PROCESS_QUERY_LIMITED_INFORMATION`; creation time and image path come from
  those handles. It does not use WMI/CIM, debug privileges or process-control
  access. See Microsoft's [snapshot example](https://learn.microsoft.com/en-us/windows/win32/toolhelp/taking-a-snapshot-and-viewing-processes).
  Discovery is discarded if the retained client exits before or during the
  observation; it cannot capture a reused parent PID's child after client exit.
  Neither path reads command lines, environments or other users' session files.
  Missing, ambiguous or inaccessible observation is unknown, not proof of exit.
- Dispose pauses, waits and releases only its own unchanged lease. The retained
  client handle must have exited and the captured core identity must be gone or
  replaced by a different OS creation identity. Linux additionally recognizes
  the captured process's explicit terminal `Z`/`X`/`x` state; sleeping, stopped,
  idle or missing executable metadata is not exit evidence. See the Linux
  [stat fields](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html) and
  [terminated-child semantics](https://man7.org/linux/man-pages/man2/waitpid.2.html).
  Unknown client/core exit or a
  changed lease prevents release and replacement. Only the owned tunnel client
  is signaled; the core is expected to exit when its stdio closes. Independent processes started through
  tools are not enumerated or killed; interruption of an in-flight MCP request
  remains possible and must be disclosed before eventual GUI activation.
- Tests cover conflicting ownership, changed/partial intent, pause-before-stop,
  pause during readiness, duplicate reconnect, stopped/failed/unknown distinction,
  bounded probes, no mutation from status and lease release. A finite official-
  client exchange against a loopback mock control plane must connect, pause,
  confirm both identities stopped, stay paused and reconnect without overlap on
  Windows/Linux. It must exercise the pinned executable, not just a fake child.
  Only fake keys and owned fixture state are allowed. Trusted in-process test
  adapters may replace spawn/fetch/process observation and bounded timing; none
  is exposed through browser requests or a production command/endpoint option.

Windows process hiding, protected installation, crash reconciliation, real OS
login policy, macOS execution and real per-chat authorization remain separate
gates. This library must not be used elevated or replace production runtimes.

## Current Development Checkpoint

The prototype loads the pinned package's `server.js` and filtered stdio transport,
not its default launcher. This deliberately omits startup feature-flag polling,
commercial remote mode, the welcome page and the eager Chrome download. Runtime
telemetry is disabled in both the environment and persisted configuration before
upstream imports. Dependency acquisition still requires `--ignore-scripts`:
the runtime opt-out does not disable upstream installation tracking hooks.

Windows child processes are hidden, and default PowerShell/CMD tool launches
disable interactive profiles/AutoRun. Explicit commands may still run profiles,
start applications or use the network. These choices are **not** a sandbox.
The upstream core exposes file, process and command tools with the selected OS
account's authority. Empty directory/command lists intentionally do not impose
an application-level folder or command allowlist. Tool output/history can contain
sensitive data; never attach native state or raw tool transcripts to a public
issue. This differs from the browser's content-free schema 3 diagnostic export.

Development checks, from `native/desktop-commander/`:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

The real stdio test uses disposable state, a reduced discovery PATH and test-only
JavaScript network/child-launch instrumentation. It initializes the actual core,
lists its tools, writes/reads an owned file, runs a harmless process and verifies
stdio-close exit. Instrumentation observes the Node host, not all descendant or
OS network traffic. It does not establish reliability under every user's PATH,
Python installation, shell environment or long-running workload.

`tunnel.test.mjs` is a separate opt-in Windows/Linux x64 integration fixture. It requires
`TUNNEL_CLIENT_TEST_EXE` pointing to the pinned official 0.0.19 executable, whose
digest is checked before launch. It serves a fake control plane on loopback and
uses only a fake key. No real OpenAI account, remote device or ChatGPT grant is
used. Run it only in finite owned-process containment; a failed assertion must
not leave tunnel children running. The Linux CI job downloads the pinned official
runtime into its disposable runner, verifies both archive and executable digests,
and bounds the fixture with `timeout`. This is not a real per-chat acceptance test.
The fixture's child-exit hook is not an OS process-termination receipt. Its
internal cleanup stops the tunnel parent only; an external owned-process Job on
Windows, or disposable CI isolation on Linux, must contain the complete tree on
both success and failure. Windows fixture-directory removal is asynchronous with
bounded retries so child working-directory handles can close. It does not replay
MCP calls or establish graceful production lifecycle handling. Do not run the
fixture standalone on a working machine.

The package pin verifies a 274-file inventory covering `package.json` and `dist`.
Transitive dependencies use npm lock integrity during acquisition; the startup
tree check does not rehash every transitive dependency or establish their safety.
The lock contains upstream deprecation warnings; dependency/security assessment
is still needed before a supported privileged installer. Node preloads must be
removed by the external launcher: invoking Node directly with hostile
`NODE_OPTIONS` has already executed that code before this entrypoint can react.

Preparation uses private POSIX modes where supported. Windows ACL ownership,
no-race privileged file handling, installed activation, credential provisioning,
native registration and autostart are **not implemented by this prototype**.
The owned-runtime library above is not yet connected to a production installer,
browser control surface or OS login policy.
Do not run this source as administrator/root or interpret a successful fixture
as authorization to replace a production MCP installation. No new browser
release or Chrome Web Store submission is implied by this source checkpoint.

### Observed Checks (2026-11-02)

Windows, Node 24.16.0: 73 native checks passed, with one Linux-specific process
metadata regression skipped. This includes a
real stdio initialization and five correlated RPC replies, 25 discovered tools,
an owned-file roundtrip, a harmless process, and normal exit after stdin closes.
The additional profile/CLI checks cover exact input/output contracts, unchanged
and partial bindings, dangling receipt links, key/client identity overlap and
reserved key locations. Missing/malformed pins, a missing runtime module, a missing upstream tree,
changed package bytes, redirected state and changed policy were rejected in
disposable fixtures. Mocked Windows process APIs verified the preserved
`util.promisify` stdout/stderr/child contract; this is not a real process-list
acceptance claim.

The official Windows tunnel 0.0.19 binary matched its supplied SPDX SHA-256
(`7e93a39a567c87154a0aef2091b81100d78f9093c4603412cc2b55bed3dfe5ea`).
Against a loopback-only fake control plane, three integration checks passed.
Both the fixed-argument and generated-profile paths supervised the actual core
and each completed five correlated
responses, including file write/read. The generated path exercised the strict
configuration CLI with a fake key file, resisted inherited target/raw-log/browser
overrides and returned HTTP 200 from loopback `/readyz`. Forwarded log
notifications were acknowledged separately, never counted as RPC completion.
The owned-runtime path additionally connected, paused, confirmed the retained
client and captured core identities exited, stayed paused during status probes,
then explicitly reconnected and paused again. Both launches completed five
correlated RPC replies each; the canonical profile bytes stayed unchanged.
This validates a finite local lifecycle cycle, not independent long-running
tool processes or production recovery. All three checks ran inside an owned
kill-on-close Windows Job; zero owned
processes remained before disposal. This does not verify a real OpenAI tunnel,
ChatGPT/Dot authorization, graceful production service stop or remote restart.

Independent review found and prompted fixes for a lost Windows Promise contract,
a raw startup-error path, dangling binding links and key/client input overlap.
Regression checks now cover those cases. This increment's review additionally
identified late process-identity capture after parent exit, ambiguous Linux
executable metadata, inconsistent unknown-exit classification, raw lease errors,
and adjustable-clock stop waits. Counterexamples were added before the fixes;
manual pause also remains available if the owned provider policy changes.
The Linux-specific regression covers missing executable metadata and an
unavailable `/proc` mount without treating either as a live process's exit.
An earlier Windows fixture run completed
the RPC exchange but failed directory cleanup; it was not counted as a passing
run. The subsequent asynchronous-cleanup run passed both paths, with zero owned
processes before Job disposal.

The previous configuration-CLI commit `0aae0a9` passed both Windows and Linux CI,
including its two official-client integration paths. Consult Actions for this
increment's exact commit: Linux must execute the platform-specific regression
and all three official-client paths before Linux coverage can be claimed.
Workflow configuration alone is not a completed run, and no macOS execution is
established here.

Windows CI exposed CIM queries exceeding their five-second budget on every
attempt. Failure-only probes confirmed PowerShell had started, while CIM still
had not returned after fifteen seconds with either environment variant. This
prompted replacement of CIM with the fixed native metadata helper, not a larger
production timeout. A regression also verifies that a missing helper is unknown,
never evidence that a process exited. The temporary CIM probes were removed.
The test retains timing and bounded failure flags, not process metadata or
command output. Its owned-child fixture allows at most three read-only identity
observations and never retries a wrong identity, unexpected error or exited
fixture. It creates only one child. Production query and controller budgets are
unchanged: an unavailable or slow observation can still leave the controller
`unknown`, which blocks replacement rather than proving a successful stop.
Finite fixture success is not a universal cold-start availability claim.
