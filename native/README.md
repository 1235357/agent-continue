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

`tunnel.test.mjs` is a separate opt-in Windows integration fixture. It requires
`TUNNEL_CLIENT_TEST_EXE` pointing to the pinned official 0.0.19 executable, whose
digest is checked before launch. It serves a fake control plane on loopback and
uses only a fake key. No real OpenAI account, remote device or ChatGPT grant is
used. Run it only in finite owned-process containment; a failed assertion must
not leave tunnel children running. It is intentionally not an automatic CI
download or a substitute for real per-chat acceptance.
The fixture's child-exit hook is not an OS process-termination receipt. Its
internal cleanup stops the tunnel parent only; an external owned-process Job
must confirm/terminate the complete test tree on both success and failure before
the fixture can be treated as cleaned up. Do not run it as a standalone test.

The package pin verifies a 274-file inventory covering `package.json` and `dist`.
Transitive dependencies use npm lock integrity during acquisition; the startup
tree check does not rehash every transitive dependency or establish their safety.
The lock contains upstream deprecation warnings; dependency/security assessment
is still needed before a supported privileged installer. Node preloads must be
removed by the external launcher: invoking Node directly with hostile
`NODE_OPTIONS` has already executed that code before this entrypoint can react.

Preparation uses private POSIX modes where supported. Windows ACL ownership,
no-race privileged file handling, activation, credentials, native registration,
autostart and lifecycle coordination are **not implemented by this prototype**.
Do not run this source as administrator/root or interpret a successful fixture
as authorization to replace a production MCP installation. No new browser
release or Chrome Web Store submission is implied by this source checkpoint.

### Observed Checks (2026-11-02)

Windows, Node 24.16.0: 17 native checks passed, zero skipped. This includes a
real stdio initialization and five correlated RPC replies, 25 discovered tools,
an owned-file roundtrip, a harmless process, and normal exit after stdin closes.
Missing/malformed pins, a missing runtime module, a missing upstream tree,
changed package bytes, redirected state and changed policy were rejected in
disposable fixtures. Mocked Windows process APIs verified the preserved
`util.promisify` stdout/stderr/child contract; this is not a real process-list
acceptance claim.

The official Windows tunnel 0.0.19 binary matched its supplied SPDX SHA-256
(`7e93a39a567c87154a0aef2091b81100d78f9093c4603412cc2b55bed3dfe5ea`).
Against a loopback-only fake control plane, it supervised the actual core and
completed five correlated responses, including file write/read. Forwarded log
notifications were acknowledged separately, never counted as RPC completion.
The finite test ran inside an owned kill-on-close Windows Job; zero owned
processes remained before disposal. This does not verify a real OpenAI tunnel,
ChatGPT/Dot authorization, graceful production service stop or remote restart.

Independent review found and prompted fixes for a lost Windows Promise contract
and a raw startup-error path. Regression checks now cover both. GitHub CI is
configured separately for Windows/Linux; configuration alone is not a completed
CI run, and no macOS execution is established here.
