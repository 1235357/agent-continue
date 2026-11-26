# Windows Device Control and Official Tunnel Architecture

## Scope and Status

Agent Continue separates prompt scheduling from optional Windows device tools.
This document describes the supported design and its acceptance criteria. It
does not certify a particular installed build, an institutional deployment, or
Chrome Web Store policy compliance. Linux and macOS remain deferred. A Linux
host is not automatically enrolled or reached through Windows in this release.

## Components and Trust Boundaries

| Component | Responsibility | What its evidence establishes |
| --- | --- | --- |
| ChatGPT or Your dot | Accept prompts; expose tools to conversations through the platform's authorization UI | A grant on one surface does not prove a grant on the other. |
| Manifest V3 extension | Bind a scheduler job to the selected conversation; present Setup and Devices; exchange local lifecycle commands | An extension permission or UI status is not Windows elevation or hosted tool execution. |
| Windows native messaging host | Observe and manage a separately installed runtime for an explicitly permitted extension origin | A registered manifest identifies an endpoint; a stale pointer can remain after an installation changes. |
| Official OpenAI tunnel client | Carry authorized tool requests and responses between the OpenAI service and the configured local MCP endpoint | A ready client does not prove a particular tool ran or a conversation can call it. |
| Local Windows MCP provider | Execute tools with the Windows identity and privileges of the runtime | An independent local readback proves the effect of the specific accepted operation. |

The [official tunnel client](https://github.com/openai/tunnel-client) documents
outbound HTTPS polling and responses through the OpenAI control plane. There is
no Agent Continue-operated relay. This is not peer-to-peer SSH from a browser
and it does not mean tool arguments and results stay on the Windows machine.
The local provider is based on [Desktop Commander MCP](https://github.com/wonderwhy-er/DesktopCommanderMCP).
Chrome [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
starts an already registered local host and exchanges messages using stdio;
the browser permission alone does not install or register a native program.

## Installation, SSH Preflight, and Recovery

1. In Setup, choose current-account or administrator scope, review its risk,
   and copy the appropriate verified PowerShell or CMD bootstrap. For administrator
   setup, the verified Windows command uses explicit flags:
   `-Administrator -Apply -Consent accept-administrator-browser-installation -PromptForConnection -ExtensionId '<extensionId>'`.
   A verified npm package is a separate delivery route. Do not use an unpublished
   version URL as an installer source.
2. Run the command in a local terminal. Provide the official tunnel information
   and path to the local key file; do not paste the key into chat or the
   extension. The ordinary path uses the existing Windows account and can
   provision verified portable Node without changing the system PATH.
3. Administrator setup is a distinct opt-in path and requires native Windows
   elevation. Installation errors do not trigger automatic escalation,
   firewall changes, or an execution-policy bypass.
4. Once the Windows local MCP runtime (`DesktopCommanderMCP`) and OpenAI official
   tunnel client (`tunnel-client`) are connected, run the read-only SSH preflight
   before instructing ChatGPT or Dot to SSH into remote Linux research hosts from Windows:
   ```powershell
   npx agent-continue ssh-preflight
   ```
   (or `node native/bootstrap/bin.mjs ssh-preflight`). This checks `ssh.exe`,
   parses `~/.ssh/config` (skipping `ProxyJump` inner hops from direct LAN TCP probes),
   inspects WMI `Win32_NetworkAdapter.NetConnectionStatus === 2` for Sangfor /
   EasyConnect VNIC adapters, and runs bounded TCP probes. EasyConnect still
   requires interactive user login (`"欢迎访问"`) before private research IPs are reachable.
5. Browser-managed setup installs paused. After fresh consent and matching
   installation readback, the initiating Setup page may request one connection.
   Unknown or partially installed states require inspection of the original
   operation; do not delete, overwrite, rerun, or silently adopt a different
   binding. A user pause or revoke is not cleared on restart.
6. Grant tools in the selected ChatGPT or Dot conversation separately. By default,
   the scheduler keeps tool confirmations and browser handover manual; optional
   opt-in settings (`autoAllow`, `autoAuthorizeTakeover`) are disabled unless
   explicitly enabled in Settings and still pause on OAuth/login dialogs or
   CAPTCHA/2FA prompts.

The current-account and administrator installation receipts are not
interchangeable. The scheduler's manual Pause remains independent of device
Pause and Revoke. Review [data handling](../PRIVACY.md) before enabling access.

## Release Acceptance

For an exact candidate source and installation, record these observations
separately:

1. Verified extension and matching Windows artifacts, checksums, and source
   identity; clean installation and known refusal paths in isolation.
2. Ordinary ChatGPT before Dot: verify the actual effects of an authorized
   temporary-file operation, local shell operation and owned-process operation.
3. Verify Pause and Revoke against the same installation, and reopen the
   isolated browser. Confirm that saved running state may recover but a manual
   pause or revoked grant does not, and that unknown outcomes are not replayed.
4. Verify background sends and accounting separately: busy composer, pending
   approval, manual Send takeover, and resume after readiness. A local send
   count is not a delivery acknowledgement from the platform.
5. The tag workflow stages a GitHub Release draft, not a public release. A
   maintainer downloads the exact assets from the authenticated draft for
   acceptance. Use the extracted local installer in this phase; do not assume
   public release download URLs work before publication. The Git tag and its
   source archive may already be visible.
6. After live acceptance, recheck the draft tag and every asset digest
   against the tested set, then publish that same draft separately. If a
   draft is incomplete after an upload failure, reconcile the original
   draft before any retry; the workflow never replaces assets. Verify public
   download and submit only the matching Store ZIP. GitHub publication,
   Store submission, Store approval, and public Store listing are separate
   observations.

See [runtime acceptance](RUNTIME-ACCEPTANCE.md) for dated receipts and
[Windows recovery](WINDOWS-RECOVERY-20261117.md) for the local preflight record.
