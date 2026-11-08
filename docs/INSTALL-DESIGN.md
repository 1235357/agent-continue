# Install Design: One-Click Install and In-Extension Onboarding

Status: design only, 2026-11-04. Nothing here was executed. No registry write, no
service start, no installer run, no credential handling, no commit.

Scope: how a user gets from "extension installed, no native host" to "host
registered, tunnel runtime running, first device task works" on Windows first,
then macOS and Linux; what the extension itself may and may not do after the user
clicks **Agree**; how to verify and how to roll back.

Evidence base:

- `wonderwhy-er/DesktopCommanderMCP` at `main` — launchers, setup and uninstall
  read from source (see [Appendix A](#appendix-a--evidence-index)).
- `openai/tunnel-client` at `master` — README deployment/service sections,
  `docs/configuration.md`, `docs/health.md`, `docs/permissions.md`,
  `docs/deployment/systemd-vm.md`.
- Chrome for Developers, "Native messaging"
  (<https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging>).
- This repository: `native/bootstrap/*`, `native/desktop-commander/*`,
  `setup.html`, `setup.js`, `manifest.json`, `docs/DEVICE-CONTROL.md`,
  `docs/DEVELOPMENT-HANDOFF.md`.

---

## 1. Conclusions first

| Question | Conclusion |
| --- | --- |
| Minimal steps and failure points of the three launchers | All three converge on one Node command; they differ only in how Node is found and installed. Failure points are Node absence/version, network/proxy, TLS on old PowerShell, SmartScreen, unreadable prompt under `irm \| iex`, and a mutated shared app config with no backup. |
| Which suits a Windows first install | A per-user PowerShell installer that (a) prompts once, (b) verifies a pinned SHA-256 digest, (c) never elevates except for an OS package install, and (d) can run with no Node at all if Node is bundled in the payload. Elevation-free is the default; the `.cmd` wrapper is only a convenience shell. |
| What the extension can do after **Agree** | Ask for the `nativeMessaging` optional permission, open a setup tab, download a file, and speak to a host that an external installer already registered. It cannot execute PowerShell, launch an arbitrary process, write the registry, install itself, or bypass UAC / enterprise policy. Every one of those needs a human-run installer. |
| Is official tunnel auth user-level or machine-level | Two layers. The daemon side is a machine/OS-account-level static credential: an organization-scoped tunnel ID plus a runtime API key stored as a `file:` reference with `0600`. The ChatGPT side is a per-user connector created in ChatGPT settings while the daemon is healthy. There is no per-login OAuth handshake on the daemon, so "sign in again" never re-authorizes the tunnel; the service must be restarted and the runtime reconnects. |
| Verification and rollback | Registry read-back, manifest byte compare, launcher origin check, host handshake, `tunnel-client doctor`, `/readyz`, receipt hash recompute. Rollback = stop runtime, delete registration, remove autostart, delete install dir, revoke key/tunnel server-side. |
| Gap vs this repo | Registration is plan/dry-run/preview only; there is no installer, no mac/Linux manifest writer, no autostart, no `verify`, no `uninstall`, no post-install UI state. |

---

## 2. Reference implementation: DesktopCommanderMCP

### 2.1 What the repository actually ships

The premise "cmd + PowerShell + Node one-click installers" is true but the three
are not independent installers — they are three entry shells over the same Node
setup:

| Entry | File | What it really does |
| --- | --- | --- |
| CMD | `scripts/remote/remote-windows.cmd` | One line: `powershell.exe -NoProfile -Command "irm ... remote-windows.ps1 \| iex"`, then `exit /b %ERRORLEVEL%`. |
| PowerShell | `scripts/remote/remote-windows.ps1` | All the logic: platform check, Node discovery, consent prompt, MSI download + SHA-256 verify, elevation of `msiexec` only, version gate, then `npx.cmd --yes ... remote`. |
| Node | `npx @wonderwhy-er/desktop-commander@latest setup` (also `install.sh` on macOS) | Writes `~/.claude-server-commander/config.json`, edits Claude Desktop's `claude_desktop_config.json`, restarts Claude. |

`install.ps1` does not exist. The only Windows PowerShell script besides the
remote launcher is `install-docker.ps1`, which needs Docker Desktop and is a
different product path.

`install.sh` is macOS-only: it checks Node ≥ 22.12, otherwise downloads
`node-v22.14.0.pkg` and runs `sudo installer -pkg ... -target /`.

### 2.2 Minimal steps of the PowerShell launcher (the useful pattern)

1. Guard the caller: body runs in a child scope (`& { ... }`), a `trap` adds
   support text but rethrows, `PipelineStoppedException` (Ctrl+C) exits quietly.
   `$ErrorActionPreference='Stop'`, `ProgressPreference='SilentlyContinue'`.
2. Refuse the wrong OS (checks `$env:OS -eq 'Windows_NT'`).
3. Detect architecture from `PROCESSOR_ARCHITECTURE` and
   `PROCESSOR_ARCHITEW6432`, so a 32-bit shell still picks the 64-bit MSI.
4. Find `node.exe`; if absent, re-read `Machine` + `User` PATH into this shell
   before giving up (a previous installer may have changed PATH after the
   terminal opened).
5. Ask once: `Read-Host` with Enter = Yes; an unreadable answer aborts and prints
   the two manual options instead of installing.
6. Enable TLS 1.2 for old PowerShell, download `SHASUMS256.txt`, regex-match
   `(sha256) (node-v24.x.y-<arch>.msi)`, download the MSI.
7. `Get-FileHash -Algorithm SHA256` compare **before** handing bytes to Windows.
8. Elevate only the OS package:
   `Start-Process msiexec /i <msi> /passive /norestart -Verb RunAs -Wait`.
   Exit 1641/3010 mean "installed, reboot required" and return cleanly; other
   non-zero is a hard failure.
9. Reload PATH from Machine + User again, then verify `node.exe` and `npx.cmd`
   exist; version gate 22.12 is enforced by running node itself.
10. Run the device command **unelevated**: `npx.cmd --yes @... remote`.
11. `finally` restores the caller's PATH and TLS setting and deletes the temp
    directory, including after Ctrl+C.

That is the whole "one-click": one prompt, one checksum, one elevation for the
package only, one child-process launch, and a guaranteed cleanup path.

### 2.3 Setup path (`setup-claude-server.js`)

- Config lives at `~/.claude-server-commander/config.json`
  (`CONFIG_DIR = path.join(homedir(), '.claude-server-commander')`).
- Claude config candidates: `%APPDATA%\Claude\claude_desktop_config.json`,
  `~/Library/Application Support/Claude/claude_desktop_config.json`,
  `~/.config/Claude/claude_desktop_config.json`, then `~/.claude_desktop_config.json`.
- It writes the whole file with `writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2))`
  and deletes a legacy `desktopCommander` key. There is **no backup** on setup.
- It kills the app to release the config: `taskkill /F /IM "Claude.exe"` on
  Windows, `pkill -f "claude"` on macOS, then relaunches it.
- Uninstall is the only path that makes a backup:
  `<config>.backup.<timestamp>`, restores it on failure, and then removes the
  `desktop-commander` entry.

### 2.4 Failure points worth copying as test cases

| Failure | Why it happens | Evidence |
| --- | --- | --- |
| Node missing / too old | Package engine requires ≥ 22.12 | `remote-windows.ps1` version gate |
| Unreadable consent | `irm \| iex` has no TTY; `Read-Host` throws | `remote-windows.ps1` `catch` on `Read-Host` |
| TLS handshake failure | Old PowerShell defaults | comment on TLS defaults in `scripts/remote/README.md` |
| Silent no-op after install | PATH updated after shell start | explicit PATH reload step |
| Partial elevation | Whole script elevated instead of the MSI | `-Verb RunAs` only on `msiexec` |
| Shared config mutation | Direct overwrite of an app-owned JSON | `setup-claude-server.js` write path |
| App lock | App holds config / process | `taskkill` + `pkill` before write |

---

## 3. Reference implementation: openai/tunnel-client

### 3.1 Artifacts and install channels

- macOS: Homebrew tap `openai/tools/tunnel-client` is the supported channel.
  Directly downloaded ZIPs are **not notarized** and can be blocked by Gatekeeper;
  the README explicitly forbids working around it with `xattr`/`spctl`/"Open
  Anyway".
- Everywhere: release ZIPs per platform. Asset naming used by this repo's pin is
  `tunnel-client-runtime-v0.0.19-windows-amd64.zip` (see
  `native/bootstrap/client-acquisition.mjs` L14-L19 for the six platform map).
- Release evidence: per-ZIP `.spdx.json` sidecar, `SHA256SUMS.txt`, Sigstore
  provenance bundle, vulnerability report. Validation is
  `gh attestation verify ... --signer-workflow openai/tunnel-client/.github/workflows/release.yml`.
- Docker / Kubernetes sidecar / dedicated / systemd VM are separate deployment
  guides; the desktop app only needs the single binary.

### 3.2 Configuration and secrets

- Precedence: flags > environment > YAML config > defaults.
- Config: `--config <path>` or `TUNNEL_CLIENT_CONFIG`; named profiles via
  `--profile-file` or `TUNNEL_CLIENT_PROFILE_DIR` (`~/.config/tunnel-client/`).
- Required: control-plane API key, tunnel ID, and one `main` MCP binding.
- Secret-bearing fields accept only `env:VAR` or `file:/path`; literal tokens are
  rejected. Admin key is separate (`OPENAI_ADMIN_KEY`) and must not be used for
  the long-lived runtime.

### 3.3 Service, login, pause and resume — official semantics

macOS Homebrew service (`brew services`):

- Supervises `tunnel-client run` with a profile at
  `$(brew --prefix)/etc/tunnel-client.yaml`; starts **at login**, restarts the
  runtime when the process exits.
- Install/upgrade never create or replace that profile.
- The service definition contains the profile path, not the key; the key stays in
  a `0600` file referenced as `control_plane.api_key: file:/...`.
- Runs as the logged-in user, **without sudo**; it runs during the login session,
  not before login or after logout.
- Sleep suspends work; wake lets the runtime's network retries resume.
- launchd restarts an **exited** process, but does **not** restart one merely
  because readiness fails. A dead MCP child can leave the process alive and
  unready; the fix is a restart after the child is back.
- `brew services stop` stops the runtime and disables login autostart.
- `runtimes connect` writes its own profile and starts a *detached* runtime; the
  CLI does not discover or control the Homebrew service. Running both for one
  tunnel creates two connectors — pick one owner.

Health and logs:

- `tunnel-client health --url http://127.0.0.1:8080 --json`, or `--url-file`.
- `/healthz` liveness, `/readyz` readiness (503 while gated), `/health`,
  `/health/mcp`; the `/health` family is loopback/Unix-socket only and returns
  403 to other peers, even with `--allow-remote-ui`.
- An active service alone does not mean the tunnel is ready.
- Log: `$(brew --prefix)/var/log/tunnel-client.log` and any `log.file` in the
  profile.

Because the credential is a static runtime key and the supervisor is a per-user
service, "pause then sign in again" is not an auth event. Recovery is: service
restart at login + network retry on wake + a fresh `doctor`/`health` check. If
the key was rotated or revoked, the profile's secret file must be replaced and
the service restarted; there is no interactive re-login inside the tunnel.

---

## 4. Reference implementation: Chrome native messaging

Facts that constrain the whole design (quoted behaviour from the official page):

- The extension must declare `nativeMessaging`; the API is available only in
  extension pages and the service worker, not in content scripts.
- The host manifest is JSON with `name`, `description`, `path`, `type: "stdio"`,
  and `allowed_origins` (no wildcards).
- Windows: the manifest may live anywhere, but **the application installer must
  create** `HKEY_LOCAL_MACHINE\SOFTWARE\Google\Chrome\NativeMessagingHosts\<name>`
  or `HKEY_CURRENT_USER\...` and set the default value to the absolute manifest
  path. Chrome queries the 32-bit registry view first, then the 64-bit view.
- macOS user scope: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/<name>.json`;
  system scope `/Library/Google/Chrome/NativeMessagingHosts/`; Chromium and
  Chrome-for-Testing use different directories.
- Linux user scope: `~/.config/google-chrome/NativeMessagingHosts/<name>.json`;
  system scope `/etc/opt/chrome/native-messaging-hosts/`.
- Transport: JSON, UTF-8, 32-bit length prefix in native byte order. Max host →
  Chrome message **1 MB**; max Chrome → host message **64 MiB**.
- First argument is the caller origin `chrome-extension://<id>`; Windows also
  passes `--parent-window=<handle>`.
- `connectNative()` keeps one host process alive until the port dies;
  `sendNativeMessage()` starts a new host process per message and ignores every
  reply after the first.

Consequences for AgentContinue:

1. A native host is a **pre-registered executable**, not a capability the
   extension can mint. There is no API to register, no API to run a command line,
   no API to write the registry.
2. `path` on macOS/Linux must be absolute and executable; on Windows it may be
   relative to the manifest directory, and the host starts with CWD set to the
   binary's directory — a relative layout is possible but fragile.
3. Multiple browsers/channels mean multiple registrations (Chrome, Chromium,
   Chrome-for-Testing, and Edge's own `Microsoft\Edge` tree).
4. The 1 MB host→Chrome cap bounds status payloads; never push logs through the
   port.
5. `allowed_origins` pins the extension ID. An unpacked dev extension and the
   store build have different IDs, so the manifest is a release-time artifact,
   not a template with a wildcard.

---

## 5. Target design for AgentContinue

### 5.1 Payload layout (per user, no admin)

```
%LOCALAPPDATA%\AgentContinue\          (Windows; ~/Library/Application Support/AgentContinue on macOS;
                                        ~/.local/share/agent-continue on Linux)
  install.json          install receipt (format, version, hashes, timestamps)
  app\                  bootstrap + desktop-commander modules (existing payload)
  runtime\              node.exe (Windows) / bundled node (macOS, Linux)  [optional]
  bin\native-launcher.sh (macOS, Linux); Windows keeps `native-launcher.exe` at
  the install root, beside the manifest it is named in
  state\                state + tunnel profile + logs
    tunnel-client.yaml
    runtime.key         0600 / owner-only ACL
    logs\tunnel.ndjson
    setup-receipt.json
  host-manifest.json    Chrome native messaging manifest (copy of the installed one)
```

The launcher binds three values at build time — absolute Node path, absolute
`device-native-host.mjs` path, and the expected origin — exactly as
`NativeLauncher.cs` already does (`LocalFile(...)` checks, origin check, 30 s
lifetime). Registration only ever points at `<INSTALL_ROOT>\native-host.json`,
never at a `.mjs` file; that manifest names `<INSTALL_ROOT>\native-launcher.exe`
as its `path`.

### 5.2 Windows first install (primary path)

Chosen channel: a per-user PowerShell installer distributed inside a ZIP, with
a signed `.exe` wrapper added later. No MSI, no admin, no machine-wide state.

Steps:

1. **Preflight (read-only).** Detect OS/arch, Chrome channel presence, existing
   install dir, existing HKCU key for `com.agentcontinue.device_control`, existing
   runtime process. Refuse to continue if a foreign host with the same name is
   registered to a different path.
2. **Consent screen.** One screen states: what will be copied, where, that a
   registry value will be created under HKCU, whether autostart is on, and that
   the tunnel key is read from an existing file or entered once. Enter = No (unlike
   the DesktopCommander prompt where Enter = Yes); an installer must default to
   the safe answer when input is unreadable.
3. **Verify payload.** Compare every file against `SHA256SUMS` shipped in the
   archive, and refuse to run if any mismatch is found. This is the analogue of
   `Get-FileHash` before `msiexec`.
4. **Stage.** Copy `app\`, `bin\`, and the bundled node to the install dir with
   `-Force` off (fail if present), write `install.json` last. Copy uses a temp
   name + rename so a crash cannot leave a half-installed tree.
5. **Configure.** Build `state\tunnel-client.yaml` from the pinned schema:
   `control_plane.api_key: file:<abs runtime.key>`, `tunnel_id`,
   `mcp.command` pointing at the absolute host script path. Never inline the key.
   Set owner-only ACL on `state\` and `runtime.key` (Windows has no POSIX mode;
   use `icacls` equivalent in the installer, not in the extension).
6. **Register.** Write `host-manifest.json`
   (`name: com.agentcontinue.device_control`, `path: <abs launcher.exe>`,
   `type: stdio`, `allowed_origins: ["chrome-extension://<id>/"]`), then set
   `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control`
   default value to the absolute manifest path. Write both 32-bit and 64-bit
   views are not required — Chrome queries 32-bit first — but the existing
   `registration-plan.mjs` already models hive × view, so keep the plan as the
   single source of truth and execute exactly its rendered arguments.
7. **Autostart (optional, default on).** `HKCU\...\Run` is the simplest but has no
   restart policy; a per-user scheduled task (`schtasks /create /sc onlogon`,
   no admin) gives restart-on-failure and a visible entry the user can delete.
   Prefer the scheduled task; document the Run-key variant as the low-friction
   fallback.
8. **Start and verify.** Start the tunnel runtime once (`run` with
   `--health.listen-addr 127.0.0.1:0` and `--health.url-file`), poll
   `/readyz` for a bounded window, then write `setup-receipt.json`.
9. **Hand off to the extension.** The setup page polls the host through
   `connectNative`; the host answers `status` with: installed version, receipt
   hash, registration status, runtime state, last health result. Green means
   "host registered + runtime ready"; yellow means "installed but not registered";
   red means "no host" (show the download/consent instructions again).

Failure handling: every step is idempotent and reports an error code, not a raw
exception; nothing is deleted on failure except the temp copy; a partial install
is always uninstallable by the same script.

Why this beats the MSI/Node path on Windows: no admin prompt (SmartScreen still
applies to the signed/unsigned installer itself), no dependence on the user's
Node version, no PATH mutation, no shared-app config rewriting, and no elevation
beyond the OS package in the one case where the user asks for a system Node.

### 5.3 macOS

1. Distribute a notarized `.pkg` (or a signed `.app`-less archive) — an unnotarized
   ZIP is blocked by Gatekeeper, and the tunnel README forbids bypassing it.
2. Install under `~/Library/Application Support/AgentContinue`; manifest at
   `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.agentcontinue.device_control.json`
   with an absolute `path` to an executable launcher script (must be `chmod +x`,
   shebang, `exec` the bundled node with the absolute host script).
3. Autostart via a per-user launchd `LaunchAgent`
   (`~/Library/LaunchAgents/com.agentcontinue.tunnel.plist`, `RunAtLoad`,
   `KeepAlive` on exit), which mirrors the Homebrew formula behaviour: start at
   login, restart on exit, do **not** restart merely because readiness failed.
4. Tunnel runtime: either the pinned release ZIP extracted into `runtime\`
   (verify `SHA256SUMS` + attestation) or the Homebrew formula if present — but
   only one owner per tunnel. If `brew services` is active, the installer must
   refuse to also start its own runtime.
5. Verification: `tunnel-client doctor --profile-file ...`, `health --url-file`,
   `launchctl print gui/$UID/com.agentcontinue.tunnel`.
6. Uninstall: `launchctl bootout`, delete the LaunchAgent, delete the manifest,
   delete the app dir, optionally `brew services stop` if Homebrew owned it.

### 5.4 Linux (desktop and remote server differ)

Desktop (local Chrome):

1. Install under `~/.local/share/agent-continue`; manifest at
   `~/.config/google-chrome/NativeMessagingHosts/com.agentcontinue.device_control.json`,
   absolute executable path.
2. Autostart via a systemd **user** unit
   `~/.config/systemd/user/agent-continue-tunnel.service`
   (`Restart=on-failure`, `WantedBy=default.target`), enabled with
   `systemctl --user enable --now`. `loginctl enable-linger` is optional and
   changes the security story (runtime survives logout) — default off.
3. Secrets: `runtime.key` at `0600` in a `0700` directory; systemd
   `EnvironmentFile` must not carry the key, only the file path.
4. Verification: `systemctl --user status`, `journalctl --user -u ...`,
   `tunnel-client doctor`, `health --url-file`.

Remote server (no Chrome on the box):

- There is no native messaging host to register; the extension cannot reach a
  host on another machine. This stays a separate SSH enrollment path already
  modeled by `enroll-ssh` and the `linux-server` target; it must not be described
  as "one-click inside the browser".
- The equivalent of a one-click install is a server-side script that installs the
  tunnel runtime, writes the profile, and installs a **system** unit — that is
  an admin action and must be presented as such.

---

## 6. Permission and consent boundary

### 6.1 What the extension can do after **Agree**

| Allowed | Mechanism | Notes |
| --- | --- | --- |
| Request `nativeMessaging` as an optional permission | `chrome.permissions.request` from a user gesture | Must be in `optional_permissions`; a denial is a normal state, not an error. |
| Open the setup tab / instructions | `chrome.tabs.create` | This is the only way to get the user to an installer. |
| Download the installer archive | `chrome.downloads` (new permission) | Downloads, never executes; a `file://` link cannot be opened by script. |
| Talk to an already-registered host | `connectNative` / `sendNativeMessage` | Fails with a plain error if the host or manifest is missing; that failure is the "not installed" signal. |
| Show status and let the user re-check | host `status` method + a poll loop with backoff | Keep payloads far below the 1 MB host→Chrome cap. |

### 6.2 What it cannot do (and must not pretend to)

- Execute PowerShell, `cmd`, `reg.exe`, `schtasks`, `msiexec`, `systemctl`,
  `launchctl`, or any process. There is no such extension API.
- Launch the downloaded installer. Chrome's download UI can open a file, but the
  click is the user's; script cannot press it.
- Create or edit the native messaging manifest, or write
  `HKCU\...\NativeMessagingHosts`. The official page states the **application
  installer** must create the registry key.
- Elevate. No UAC prompt can be raised from an extension; an `elevated: true`
  host is a Chrome Apps concept, not an extension one.
- Modify another extension's or the browser's own settings; `management` is not a
  substitute for installation.
- Bypass enterprise policy. `NativeMessagingBlocklist` /
  `NativeMessagingAllowlist` can block every host regardless of what the user
  agreed to; force-installed extensions may also be locked. The setup page must
  detect "host missing after a successful install" and name policy as a possible
  cause, without instructing users to defeat it.
- Silently run at install time. Anything that starts a resident process is an
  installer action with its own consent, visible in Task Manager / Activity
  Monitor / systemd.

### 6.3 Consent model to implement

- Three separate consents: (1) install files + registry value, (2) start at login,
  (3) connect this browser profile to the tunnel. Never bundle (2) into (1)
  silently; make it a checkbox with a visible default.
- The extension's **Agree** covers only (3): "this browser may talk to the local
  device host". It must not imply the host exists.
- Re-consent after an ID change (dev vs store) or after the user switches Chrome
  channels.
- Store the consent record in `chrome.storage.local` with the extension ID, host
  name, and timestamp; show it on the setup page and allow revoke (which closes
  the port and clears the flag, without touching the install).

---

## 7. Verification and rollback

### 7.1 Verification ladder (cheap → expensive)

| Level | Check | Pass condition |
| --- | --- | --- |
| L0 files | Recompute hashes from `install.json` / `setup-receipt.json` | Every listed digest matches |
| L1 registration (Windows) | Read `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agentcontinue.device_control` | Default value is `REG_SZ`, absolute, points at an existing manifest |
| L1 registration (macOS/Linux) | Stat the manifest path | File exists, `path` absolute, launcher executable bit set |
| L2 manifest | Parse `host-manifest.json` | `name` exact, `type: stdio`, `allowed_origins` contains exactly the installed ID |
| L3 launcher | Run launcher with the wrong origin | Exits non-zero, no frame written (the `NativeLauncher` origin check) |
| L4 host handshake | Extension `connectNative` → `status` | Round-trip < 1 s, version and receipt hash echo back |
| L5 runtime | `tunnel-client doctor --profile-file ...` | Exit 0, key/tunnel/MCP binding all resolved |
| L6 readiness | `/readyz` (loopback only) | HTTP 200; a 503 means the process is alive but gated |
| L7 end-to-end | One read-only device task from the extension | Result arrives; no duplicate connector in the tunnel list |

Logs: `<install>\state\logs\tunnel.ndjson` (set `log.file` explicitly), plus
whatever the supervisor captures. Never rely on stdout — the host's stdout is the
native messaging channel and must stay clean JSON.

### 7.2 Uninstall / rollback

Order matters; stop writers before deleting storage.

1. Stop the runtime **we** own (PID/health URL from the receipt); if Homebrew
   owns it, require an explicit `--brew` acknowledgement instead of guessing.
2. Disable autostart (delete the scheduled task / LaunchAgent / user unit) before
   removing files, otherwise the next login relaunches a half-deleted install.
3. Close the native port from the extension side (the host exits when stdin
   closes); a hung host is a bug, not a reason to `taskkill /F`.
4. Delete the registry value (Windows) or the manifest file (macOS/Linux). Record
   the deleted value in the receipt first.
5. Delete the install directory, except a `--keep-data` mode that preserves
   `state\` and receipts for support.
6. Server-side: revoke the runtime key and delete the tunnel if the device is
   retired; local uninstall cannot do this.
7. Keep `uninstall-receipt.json` with per-step status (mirroring the
   DesktopCommander uninstall step log) so a failed step is diagnosable.

Rollback must be possible at every step: after a failed L1–L2 the fix is to
re-run registration; after a failed L5 the fix is profile/key repair; after a
failed L7 the device stays installed but "not connected", which is a supported
state.

---

## 8. Risk register

| # | Risk | Impact | Mitigation |
| --- | --- | --- | --- |
| 1 | Unsigned installer triggers SmartScreen / AV | Install abandoned | Sign the launcher and the wrapper; publish hashes; never instruct users to bypass |
| 2 | Chrome enterprise policy blocks native messaging | Host never starts, no error surfaced | Detect missing-host-after-install and name policy; provide support text, not workarounds |
| 3 | 32/64-bit registry view mismatch | Chrome cannot find the manifest | Follow the plan's hive × view model; verify by reading back both views |
| 4 | Dev vs store extension ID mismatch | `allowed_origins` rejects the port | Build the manifest per channel; re-register on ID change; expose the actual ID in the setup page |
| 5 | Path with spaces / non-ASCII | Host fails to launch | Always quote; write absolute paths; test a CJK user profile |
| 6 | Node version drift or PATH hijack | Wrong runtime, silent failure | Bundle node, bind its absolute path in the launcher, never use PATH in production |
| 7 | Runtime key leakage | Tunnel takeover | `file:` reference only, owner-only ACL, never in argv/env of the host, never in logs |
| 8 | Two owners for one tunnel | Duplicate connectors, double-delivery risk | Single-owner rule; installer refuses when `brew services` or `runtimes` already owns it |
| 9 | Autostart before login expectations | "It doesn't work after reboot" | Document login-session semantics; default autostart on, but say it only runs while logged in |
| 10 | Readiness mistaken for liveness | Green UI, dead MCP child | Always `/readyz`, never "process exists"; show last health timestamp |
| 11 | Uninstall leaves orphan registration | Stale host launched by Chrome | Uninstall deletes the key; setup page also offers "registration still present" repair |
| 12 | Shared app config mutation | User loses other MCP servers | AgentContinue never edits another app's config; only writes its own manifest + key |
| 13 | Extension uninstalled, host remains | Resident process the user can't find | Autostart entry is user-visible (Task Scheduler / LaunchAgents / systemd user); uninstall doc names it |
| 14 | Telemetry defaults | Trust break | Opt-in only; the reference implementation's default-on telemetry is explicitly not copied |
| 15 | Multi-browser | Chrome works, Edge/Chromium don't | Register per browser tree; do not claim "works in any Chromium browser" |

---

## 9. Gap analysis against this repository

| Capability | Current state | Missing for "install and it works" |
| --- | --- | --- |
| Payload staging | `bootstrap.mjs` `stage`/`acquire`, hashed receipts, atomic writes | No single user-facing installer entry; no bundled node decision |
| Tunnel acquisition | `client-acquisition.mjs` pins `v0.0.19`, six platforms, archive + exe + spdx SHA-256 | No Windows/Linux/macOS install-step wrapper, no `gh attestation` equivalent |
| Profile | `profile.mjs`: `api_key: file:...`, fixed `base_url` | No key creation/ACL step, no log file/health URL defaults in the profile |
| Launcher | `Build-NativeLauncher.ps1` + `NativeLauncher.cs` (origin check, absolute node/host binding, SHA-256 readback) | No macOS/Linux launcher, no signing step, not shipped as a release artifact |
| Registration plan/render | `registration-plan.mjs`, `registration-render.mjs` (HKCU/HKLM × 32/64, exact `reg.exe` args) | Windows-only; no manifest-file writer for macOS/Linux; not executed by anything |
| Registration write | `registration-writer.mjs`, `registration-execution.mjs` exist and are tested | No consent token wired from a real installer; no post-write read-back verification surfaced to the UI |
| Guidance | `registration-guidance.mjs` returns a 7-line preview; `setup.html` renders it once | Preview is static; no step-by-step with copy buttons, no failure branch, no re-detect |
| Setup UI | `setup.html` target select, request export, handoff text | No install progress, no polling of host status, no green/yellow/red states, no uninstall/repair entry |
| Autostart | none anywhere in the repo | Scheduled task / LaunchAgent / systemd user unit all absent |
| Verify | receipts only; no command | `verify` / `status` / `doctor` verbs absent from `bin.mjs` (which exposes `help, version, stage, acquire, setup, setup-manager, enroll-ssh`) |
| Uninstall | none | No stop/remove/revoke flow, no `uninstall-receipt.json` |
| macOS/Linux | Linux server path is SSH-only; `linux-server` sets `nativeHost: null` | No desktop manifest writer, no launchd/systemd units |

---

## 10. Prioritized implementation list

| P | Item | Acceptance |
| --- | --- | --- |
| P0 | **Windows per-user installer** (`Install-AgentContinue.ps1` + ZIP payload, consent, SHA-256 verify, copy-then-receipt, no admin) | On a clean Windows 11 + Chrome profile: one prompt, zero UAC for the default path, `install.json` written last, rerun is idempotent |
| P0 | **Registration execution wiring** — take `registration-render` output and execute exactly those `reg.exe` args behind an explicit consent token, then read back and verify | Dry-run and executed runs produce byte-identical argument lists; read-back value matches; abort leaves no key |
| P0 | **`verify` / `status` verb** in `bin.mjs` covering L0–L6 above | Exits non-zero with a named failing level; no secrets in output; safe to run repeatedly |
| P0 | **`uninstall` verb** — stop owned runtime, delete autostart, delete registration, delete dir, write `uninstall-receipt.json` | Leaves no key, no autostart entry, no process; `--keep-data` preserves receipts only |
| P1 | **Autostart per OS** (scheduled task with restart policy; launchd `RunAtLoad` + `KeepAlive`; systemd user unit) | Survives logout/login; does not restart on readiness failure; one owner per tunnel enforced |
| P1 | **macOS/Linux manifest writer** (+ executable launcher script) | Manifest at the documented path, absolute `path`, executable bit, `allowed_origins` exact |
| P1 | **Setup page state machine** (not-installed → installing → registered → ready → error, each with one action) | A user who closes the tab mid-install can resume; "re-detect" works without reload |
| P1 | **Bundled runtime decision** (ship node vs require system node) with a version-gate check | Documented size/latency trade-off; no PATH dependency in production |
| P2 | Signing / notarization pipeline + release artifacts for installers | Windows signature verifies; macOS notarized (Gatekeeper clean); hashes published with the release |
| P2 | Doctor/repair flow (key rotate, profile repair, connector duplicate detection) | Repair fixes each named failure without a reinstall |
| P3 | Edge / Chromium / Chrome-for-Testing registration matrix | Per-browser keys; setup page names the channel it detected |
| P3 | Remote-server install script distinct from desktop | Admin actions labelled; never presented as browser one-click |

Fix order rationale: without P0-1 there is nothing to run; without P0-2 the
installer cannot make Chrome see the host; without P0-3/P0-4 the user has no way
to tell a success from a half-install or to get back out. Autostart and the UI
state machine improve first-run success but are not required for a first manual
verification.

---

## Appendix A — Evidence index

DesktopCommanderMCP (`main`):

- `scripts/remote/remote-windows.ps1` — consent, SHA-256, `msiexec -Verb RunAs`,
  exit codes, version gate, `npx.cmd`, cleanup.
- `scripts/remote/remote-windows.cmd` — CMD wrapper (`irm ... | iex`, `exit /b`).
- `scripts/remote/remote-macos.sh` — `installer -pkg` / `sudo installer`, PATH
  handling, `npx --yes ... remote`.
- `scripts/remote/README.md` — pinned Node links, what is elevated, TLS caveat.
- `install.sh` — Node ≥ 22.12, `.pkg` download, `sudo installer -target /`.
- `setup-claude-server.js` — config dir, app config paths, kill/restart, direct
  overwrite without backup.
- `uninstall-claude-server.js` — `.backup.<timestamp>`, restore, restart.
- `install-docker.ps1` — Docker Desktop path (the only other Windows script).

openai/tunnel-client (`master`):

- `README.md` — Homebrew-only macOS support, unnotarized ZIP warning, service
  profile path, `api_key: file:`, `0600`, `doctor`/`health`/log paths,
  `brew services` start/stop, single-owner warning, login-session and sleep/wake
  semantics, release validation with `gh attestation verify`.
- `docs/configuration.md` — precedence, `--config`/`TUNNEL_CLIENT_CONFIG`,
  profile dir, `env:`/`file:` references.
- `docs/health.md` — `/healthz`, `/readyz`, `/health`, loopback-only, 403.
- `docs/permissions.md` — runtime key scope vs admin key.
- `docs/deployment/overview.md`, `docs/deployment/systemd-vm.md`.

Chrome:

- `developer.chrome.com/docs/extensions/develop/concepts/native-messaging` —
  `nativeMessaging` permission, manifest fields, registry requirement, per-OS
  paths, 1 MB / 64 MiB limits, origin argument, `connectNative` vs
  `sendNativeMessage` lifetime.

This repository:

- `native/bootstrap/registration-plan.mjs` (host name, key root, hive × view).
- `native/bootstrap/registration-render.mjs`, `registration-guidance.mjs`.
- `native/bootstrap/registration-writer.mjs`, `registration-execution.mjs`.
- `native/bootstrap/Build-NativeLauncher.ps1`, `NativeLauncher.cs`.
- `native/bootstrap/client-acquisition.mjs` (release pin, platform map, digests).
- `native/bootstrap/device-setup.mjs` (receipts and state paths).
- `native/desktop-commander/profile.mjs` (`api_key: 'file:' + ...`).
- `native/bootstrap/bin.mjs` (command surface).
- `setup.html`, `setup.js`, `manifest.json`.
