# Privacy and Data Handling

Scope: Agent Continue 3.0.1, upcoming Windows-enabled release, **UNRELEASED / candidate**. Updated: 2026-11-08. This is the canonical source policy for that candidate, not a publication, Chrome Web Store submission/approval, or installed-version receipt. The separately released v2.2.1 scheduler does not include Windows device control or request `nativeMessaging`; the Windows sections below do not retroactively describe that historical release.

Agent Continue processes scheduler configuration and imported documents locally, without a developer-operated collection backend, cloud synchronization, or online document conversion. Prompt scheduling and file import require no separate extension account or API key. Sending a prompt submits it to your selected ChatGPT or Your dot conversation on `chatgpt.com`; that service then processes it under its own policies. Optional hosted Windows tools additionally require a separately installed local runtime, an OpenAI workspace/app and tunnel configuration, a local runtime-key file, and the relevant approvals. Authorized device requests and results also pass through OpenAI. Local processing does not mean that submitted prompts or device results stay on your computer.

English is the default interface language; Simplified Chinese is optional. Developer: Zhentong Ye. Contact: [zhentongye2028@u.northwestern.edu](mailto:zhentongye2028@u.northwestern.edu). [Source](https://github.com/1235357/agent-continue), [issues](https://github.com/1235357/agent-continue/issues/new/choose), and [author's LinkedIn](https://www.linkedin.com/in/tony-zhentong-ye/). Support sharing is voluntary; see [Developer and Support](#developer-and-support).

## Data Flow

The following steps describe scheduler/file-import data. Optional Windows tool transport and storage are described separately below.

1. You type a prompt or select local files through the file picker or drag and drop.
2. The extension reads and parses those files locally. Text is imported as text; HTML, DOCX, and PDF import extract text without executing document scripts or calling a remote conversion service.
3. Prompts, queues, templates, and configuration are saved in the current browser profile's extension storage.
4. When you start a task or request a send, the scheduler passes the prompt to an isolated-world script on the bound target. Each attempt uses one submission mechanism after a background permission check. It does not use the system clipboard or activate the target tab.
5. The website receives the submitted message. The extension inspects page state and new user-message markers for confirmation; missing confirmation remains an unknown result, not proof that the service did not receive it.

Importing a file does not itself send a message or start a task. A normal first installation does not automatically start sending. An optional private preconfigured package can import its bundled prompt without automatically starting a task.

Existing unsent text is preserved by default. If you explicitly enable Extension Priority for a new task, its configured prompt may replace unsent composer text, including text changed while authorization is pending. Existing attachments are not submitted by this mode. Pause, background authorization, and target-identity checks still apply; the setting does not add permissions or send drafts to the developer.

## Stored Data

Browser storage and exports are separate from Windows runtime files and hosted tool results.

| Data | Storage and purpose |
| --- | --- |
| Prompts, queues, intervals, and stop conditions | `chrome.storage.local`, for configuration and later sending |
| Templates and theme | `chrome.storage.local`, not Chrome Sync |
| Interface language | `chrome.storage.local` as `uiLanguage`; English is the default, with Simplified Chinese selectable locally |
| Current task, internal execution tokens, and run state | `chrome.storage.session`, to survive service-worker suspension; tokens are internal run identifiers, not account credentials |
| Recovery task copy | `chrome.storage.local`, including target URL, title, Dot identity markers, configuration, and counters for restart recovery |
| Activity logs | `chrome.storage.local`, limited to 200 locally timestamped event/status entries, including status `message` text; diagnostic exports omit stored `message` fields |
| Diagnostics | Fixed event/diagnostic categories, bounded timing measurements, and optional page-visibility/probe/authorization results; schema 4 exports validate these fields and default to relative event timings |
| Parsing buffers and displayed prompt text | Extension memory; explicitly revealed text also appears in the interface DOM |
| Exported JSON files | Your selected download location, under your control after export |
| Browser-managed device controls | Local pending operation IDs/revisions; current-account setup/extension/binding references and first-connection outcomes; administrator control journals, terminal-operation archives, Pause references, setup-to-connection associations, installation hashes, bounded targets, request times, outcomes and verification progress |
| Administrator browser-reopen preference | `chrome.storage.local`; restoration requires explicit opt-in and still-authorized saved-running intent, not merely an earlier Ready observation |
| Native observer and standalone pairing coordination | Browser session state for observer attempts and pending standalone control IDs; separate from persistent browser journals and Windows-side records |

The extension's scheduler activity logger does not record prompt bodies, imported filenames, conversation bodies, raw exceptions, or full target URLs. Local logs retain exact event timestamps and status messages; diagnostic exports use the reduced schema described below. These exclusions do not describe Windows tool history, prepared commands, or tool results. Recovery state does contain target metadata, and prompts must remain readable to the extension for sending. Logs still reveal task timing and status. The language preference is not sent to a telemetry service, and changing it does not translate your content.

## Hidden Text Is Not Encryption

Prompt text is hidden by default and is not placed in the hidden prompt textarea until you explicitly reveal or edit it. Importing text, switching task configuration, or leaving the prompt view hides it again. This reduces accidental exposure in screenshots, screen sharing, and routine interface inspection.

Local storage and extension memory are not encrypted vaults. Someone with browser-profile or debugging access may be able to read the data. The extension must access plaintext to send it.

## Imports and Exports

- Files are parsed locally. Imported filenames are not written to activity logs; imported queue items use generic names unless you rename them.
- Default configuration JSON exports omit prompt bodies, queue bodies, and target conversation URLs. Explicitly opting to include prompt and queue text exports that content in plaintext; the opt-in resets after export.
- Diagnostic log exports use schema 4, with relative event timings by default and no stored free-text messages. They can include timing-probe metadata and boolean results. Exact timestamps require an explicit support-page opt-in; see [Diagnostic Log Export](#diagnostic-log-export).
- PDF.js modules, worker, fonts, and character maps are bundled. Runtime parsing does not load a CDN. Installing development dependencies or preparing resources from source can contact package registries separately.
- A private preconfigured package may include a plaintext original file. Do not share it as a public installation package. Public packaging is intended to exclude personal files; review any package before sharing it.

## Diagnostic Log Export

The Activity export in the popup or full console and the **Developer & support** page use the same schema 4 builder. The support page is available through the extension's support links and shows the installed extension version. Exporting requests a local JSON download; it does not upload diagnostics, create an issue, or contact support automatically.

- Top-level fields are `format` (`agent-continue-activity`), `version` (4), `extensionVersion`, `timestampMode`, `excludedEntries`, and `logs`, plus `exportedAt` only with exact-timestamp opt-in. `extensionVersion` is the installed extension version, or `unknown` if unavailable or invalid.
- The builder processes the latest 200 stored rows. It omits invalid rows, stored free-text `message` fields, and unknown fields. Each retained row includes an allowlisted `event`, its event timing, and an optional `diagnostic`. `excludedEntries` counts all input rows not included, including older rows beyond the 200-row window.
- A diagnostic's `code` is one of `adapter-result`, `execution-exception`, `execution-timeout`, `no-valid-result`, `existing-draft`, `composer-changed`, or `timing-probe`. Its optional `durationMs` must be a finite number; it is rounded and bounded to 0–120000 ms. Invalid values are omitted, not converted from text.
- Only `timing-probe` diagnostics can additionally retain `kind` (`authorization` or `page-timers`), `status` (`result`, `invalid-result`, `api-rejected`, or `watchdog-expired`), and finite numeric `firstMs`, also rounded and bounded to 0–120000 ms. They can retain `hidden`, `ok`, and `allowed` only when those values are actual booleans. These fields describe page-hidden state and probe/authorization outcomes; false values are retained too. Other diagnostic codes do not export these extra fields.
- By default, `timestampMode` is `relative-ms` and each event uses `elapsedMs` relative to the first retained valid event. These exports contain neither `logs[].at` nor `exportedAt`. Relative event timings are distinct from the bounded diagnostic durations.
- **Include exact timestamps** is off by default and available only on the support page. Selecting it changes `timestampMode` to `unix-ms`, includes `logs[].at` as absolute Unix-millisecond timestamps, and adds `exportedAt` as an ISO 8601 UTC string. The popup and full-console Activity export have no exact-timestamp option.
- These diagnostics are locally collected activity data, including timing, page visibility and probe/authorization results when present. The report does not auto-detect browser version or operating-system details; enter those manually in the bug form. This is not a claim that no activity data is collected or that the exported metadata cannot identify a user.

Relative timings and status information can also identify activity patterns. Omitting messages, validating fields, and using relative timings do not guarantee anonymity. Review and sanitize the complete JSON file before any public attachment. Exporting does not alter the original locally timestamped logs, and uploading remains a separate, manual action.

## Optional Windows Access and Approvals

**An authorized conversation can read and write files, run PowerShell or other shell commands, and inspect, start or stop processes with the selected Windows account's authority. Access is account-wide, not confined to an imported file, the extension folder, or the installation directory.** The configured Desktop Commander provider uses empty directory and command restriction lists; these do not create a sandbox or an application-level folder/command allowlist. Operating-system protections still apply. Explicit shell commands can start applications, use the network, or deliberately detach programs.

Current-account setup uses that account's existing privileges. The separate administrator choice requests Windows elevation (UAC), verifies the elevated child identity/token, and stages the runtime under Program Files with restricted ownership and access controls. Its browser-owner enrollment uses a protected HKLM Native Messaging registration and an administrator-owner scheduled-task definition. Administrator tools can act beyond ordinary user permissions, subject to Windows protections. Do not select this scope unless you intend that access.

Local installation consent, browser `nativeMessaging` permission, Windows/UAC approval, and OpenAI workspace/app and conversation authorization are separate grants. None substitutes for another. Ordinary ChatGPT and Your dot require their own available, authorized tool entry; success in one is not proof of access in the other. Installation is not chat authorization. Browser-managed Windows installers finish paused without starting a tunnel. With fresh installation-and-connection consent, the unchanged initiating Setup page can separately request one connection after checking the matching scope, installation receipt, current intent/authorization and observer support. Current-account continuation uses its own extension/binding proof and one-time reservation, never administrator transport or an earlier install-only consent flag. An existing installation is not automatically adopted or unpaused. Withdrawal cancels preparation that has not been admitted; an already submitted operation must be checked using its original ID. Closing or reloading the page does not replay an uncertain connection. Standalone current-account setup can separately request one connection when tunnel inputs are supplied and that connection is consented to; its guided prompt requires `CONNECT`. Browser-managed current-account guided setup confirms `REGISTER` without starting the tunnel in that installer step; the consenting page requests the connection separately. Installation and connection may require separate Windows approvals; one command is not a one-UAC promise. This candidate flow still requires final installed-artifact acceptance.

Browser-managed current-account setup registers the confirmed extension's host under the user's HKCU hive; administrator enrollment uses its separate protected registration. Standalone current-account setup does not register a browser host. Setup copies a command only after consent; copying is not execution. No custom Agent Continue EXE/MSI installer is required, but Node.js, the official tunnel client and upstream dependencies execute outside the browser. Setup may acquire verified portable Node.js from nodejs.org, dependencies from the npm registry, and the official client from GitHub. These providers receive the associated download requests, separately from chat/tool traffic.

## Windows Transport and Runtime Credentials

The runtime uses the official OpenAI tunnel client, not a developer relay. Authorized tool arguments travel through OpenAI to the device, and results return through OpenAI to the authorized conversation. Arguments/results can contain command text, sensitive file contents and paths, terminal output, process details, or secrets encountered by a tool. OpenAI handles transmitted data under its applicable policies and workspace settings. The official-tunnel path does not require a public inbound management port. Optional loopback pairing is separate local control, not a chat grant.

Keep the runtime key in a locally protected file on the Windows device. Supply only its file path in the local setup terminal, never its contents in the extension, a setup request, a copied command, a chat, an issue or the clipboard. The guided setup request contains platform/extension/bridge identifiers, not the runtime key. Current-account tunnel configuration stores a reference to the key file; the official client reads it when activated. Administrator binding reads the original file locally and copies the key into the installation's protected sibling credential directory, `<bundle-root>.secrets/runtime.key`, for the official client. The original file remains your responsibility; removing that original does not remove the administrator copy. Runtime authentication necessarily uses the secret. Windows access controls are not encryption or a promise that plaintext secrets never exist on disk or in memory.

## Windows Telemetry, Logs and Durable Records

Agent Continue does not operate a collection backend or automatically upload support diagnostics. The pinned Desktop Commander dependency has upstream telemetry code and defaults to telemetry enabled when used independently. The Agent Continue wrapper instead writes `telemetryEnabled: false` in its isolated configuration and sets `DESKTOP_COMMANDER_DISABLE_TELEMETRY=1` before upstream imports. Launch validation rejects a changed required policy instead of accepting the upstream default. Dependency acquisition uses `npm ci --ignore-scripts --no-audit --no-fund`; the runtime opt-out alone does not disable upstream installation hooks in other installation paths. These are configuration/source facts, not an audit of all device traffic. They do not prevent OpenAI transport, dependency downloads, a manually opened support/feedback site, or network activity requested through an authorized shell.

Windows-side storage is separate from the extension's schema 4 activity export:

| Record | Content and limits |
| --- | --- |
| Desktop Commander tool history | The runtime's isolated `home/.claude-server-commander/tool-history.jsonl` retains tool names, arguments, timestamps, durations and results, with upstream retention/output limits. It can contain command text, private paths or returned content; limits are not redaction. Authorized history/file tools may return it through OpenAI. |
| Tunnel logs | `native-tunnel.log` in the runtime state directory; generated profiles use JSON warning-level logging with `http_raw_unsafe: false`. This is not a guarantee that all errors or metadata are nonsensitive. |
| Prepared process requests, when used | Local `prepared-processes` files retain the prepared command, shell path, timeout, operation ID, digest and expiry. Expiry/revocation prevents admission under that reference; it does not itself delete the stored command. |
| Tool-operation receipts | For supported changes with a caller-supplied ID, `mcp-operation-receipts` stores a hash of the ID and limited admission/result/error/revocation status, not tool arguments/results. A provider result receipt is not independent proof of the intended effect. |
| Local device and administrator control records | Device-operation journals, sealed installation/control receipts, terminal-operation archives, account/installation identity, lifecycle/process metadata, Pause/revocation state and browser associations support reconciliation. The bounded control journals are not command/result transcripts; tool history and prepared requests are separate sensitive stores. |

Windows tool history and prepared-command files are stored as plaintext; access controls and retention limits do not encrypt their contents. Current-account Windows setup validates the source runtime-key file's metadata but does not verify its Windows DACL; protecting that original file remains the user's responsibility. The administrator-created key copy has separate restricted ACLs, not an encryption guarantee.

Persistent browser control records can survive Clear Data so an uncertain privileged operation cannot be silently replayed. Windows-side records remain outside browser storage. A deleted or missing browser record does not cancel an operation on Windows or prove that it failed. Reconcile uncertainty using the original operation ID and observed device state rather than repeating the action. Do not attach raw runtime state, tool history, prepared commands, tunnel logs or credential directories as extension diagnostics.

Standalone pairing uses a short-lived local ticket for status, disconnect-and-pause and reconnect. The extension uses loopback on the same device, clears the ticket input after submission and does not persist the ticket. The code is not placed in a URL or sent to the loopback frame. Pairing expires after 15 minutes or can be ended from the terminal; ending pairing does not disconnect the tunnel. Pending standalone control IDs are kept in browser session memory, which browser restart/extension reload clears. The device's operation journal is separate and durable.

The optional pairing page is a cross-origin sandboxed iframe served by the separately installed runtime at a validated IPv4 loopback address. Its local inline JavaScript relay is outside the extension ZIP and has no extension API access; authenticated, bounded messages provide the pairing controls. Privileged extension scripts and document-parsing resources remain bundled. The local sandbox, separately downloaded native dependencies and privileged browser-extension code are distinct components, not a claim that all executable code ships in one extension ZIP.

## Permissions

| Permission | Why it is used |
| --- | --- |
| `https://chatgpt.com/*` | Discover eligible targets, inspect conversation state and identity, fill the composer, submit prompts, and recover the original target |
| `activeTab` | Access a selected tab following a user action |
| `scripting` | Execute read-only checks and authorized sending logic on the target page |
| `storage` | Save local settings, language, content, logs, templates, task/recovery state, and device/control evidence and preferences |
| `alarms` | Wake the background scheduler to check due tasks |
| Optional `power` | Request system idle-sleep prevention only when you enable it |
| Optional `nativeMessaging` (Windows candidate) | Communicate with the separately installed, extension-bound local bridge for bounded status, connection, Pause, Revoke, recovery and prepared-process reference checks. This permission does not install the runtime, elevate Windows, or authorize a conversation. Hosted shell/file/process requests use the official tunnel, not arbitrary command text in the browser bridge. |

The upcoming Windows manifest adds optional `nativeMessaging` to the scheduler permissions; it does not add all-site, Cookie, clipboard or debugger permissions. The Setup command-copy action can use the browser clipboard API after a user gesture; the scheduler's send path does not use the clipboard. These browser permission limits do not restrict the separately authorized Windows account-wide tools. Agent Continue does not automatically send files/prompts to project maintainers or sell user data. ChatGPT prompt submissions and hosted device requests/results are intended service traffic, not developer analytics.

## Pause and Deletion

Scheduler Pause revokes subsequent sending permission, clears the scheduling alarm, and releases the extension's keep-active settings. It cannot retract a submission already dispatched to the website. It does not pause a separately connected Windows runtime.

Use the control for the relevant Windows connection. Ordinary Disconnect and pause does not pause the separate administrator runtime. Administrator Pause requests a stop; a request/acknowledgement alone is not a stopped result. Check the exact native receipt and current observation. Revoke administrator authorization denies future starts for that installation; a revocation marker alone does not prove that every process stopped. Manual Pause/Revoke take precedence over restoration. Administrator browser-reopen restoration is off unless explicitly enabled and is limited to still-authorized saved-running intent, not a new authorization. Do not assume that reopening a browser or regranting its permission clears a pause/revocation. Final-artifact reopen and revocation acceptance remain pending, as detailed in the repository's [Runtime Acceptance](https://github.com/1235357/agent-continue/blob/main/docs/RUNTIME-ACCEPTANCE.md).

Revoke the conversation's tool access or runtime key separately through OpenAI. Local Pause/Revoke does not retract results already sent, undo earlier file writes, or necessarily stop programs deliberately detached by an authorized shell command. Removing a browser permission is not evidence of Windows shutdown or OpenAI revocation.

The pause-and-clear-local-data command removes the scheduler task, recovery copy, configuration, templates, theme and activity logs, and removes the administrator browser-restore preference. Pending imports are invalidated so their results cannot repopulate cleared configuration. **It retains `uiLanguage` and durable device/administrator operation evidence, including pending journals, Pause references and setup associations.** It does not issue a Windows Pause/Revoke. A private-preset processed marker may remain to prevent silent reimport. Plaintext files bundled in a private installation folder remain the folder owner's responsibility.

Clearing browser data or uninstalling the extension does not uninstall the separate Windows runtime, remove its task/Native Messaging registrations, erase protected credential copies or the original key file, delete Windows history/receipts/prepared commands, or revoke OpenAI access. The setup uninstall option currently produces a plan, not completed removal. Review the applicable local removal steps and verify their outcome separately; a plan is not an uninstall receipt. Browser-managed extension storage is distinct from original imported files, exported JSON, screenshots, backups, private installation files and already transmitted prompts/results. Manage each at its own location or service.

## Developer and Support

- Developer: Zhentong Ye
- Email: [zhentongye2028@u.northwestern.edu](mailto:zhentongye2028@u.northwestern.edu)
- Project: [1235357/agent-continue](https://github.com/1235357/agent-continue)
- Bug reports: [Open a GitHub issue](https://github.com/1235357/agent-continue/issues/new/choose)
- Author's LinkedIn: [Zhentong Ye](https://www.linkedin.com/in/tony-zhentong-ye/)

Support diagnostics are shared manually. Exporting activity logs creates a local JSON file; it does not upload the file, open an issue, or contact the developer automatically. You choose whether to attach a reviewed, sanitized copy to a GitHub issue. This voluntary sharing is separate from the extension's operation and is subject to the service you use.

**GitHub issues and their attachments are public.** Review the entire report and every attachment before posting. Remove identifying data, private prompts, conversation URLs, credentials, cookies, real conversation content, documents, and private preconfigured packages. Do not attach configuration backups, runtime keys, raw tool history, prepared commands or native state directories. Use synthetic prompts and provide only the diagnostic details needed to reproduce the problem. Scheduler diagnostic exports omit prompt and conversation bodies, but relative timings and status information can still reveal activity; opting into exact timestamps adds wall-clock detail. Neither export nor manual sanitization guarantees anonymity.

The support links do not add background telemetry or automatic support uploads. Contacting the developer does not authorize access to your browser, account, conversations, or local files.

This policy describes upcoming 3.0.1 source behavior, not release availability, security certification, Chrome Web Store approval or an installed-version readback. Checkpoint60 records bounded ordinary-web administrator command/file/owned-process proof and an actual GUI Pause/stopped receipt for the dedicated ec7 runtime. It does not close new-runtime Revoke, reconnect/browser-reopen restoration, authenticated Dot, current-account installation, existing-install adoption, final-artifact acceptance or publication gates. Those remain separately tracked in the repository's [Runtime Acceptance](https://github.com/1235357/agent-continue/blob/main/docs/RUNTIME-ACCEPTANCE.md). This documentation update performs none of those actions.

Implementation references: [background.js](background.js), [adapter.js](adapter.js), [file-import.js](file-import.js), [activity-export.js](activity-export.js), [support.js](support.js), [runtime policy](https://github.com/1235357/agent-continue/blob/main/native/desktop-commander/runtime.mjs), [tunnel profiles](https://github.com/1235357/agent-continue/blob/main/native/desktop-commander/profile.mjs), [tool admission/receipts](https://github.com/1235357/agent-continue/blob/main/native/desktop-commander/host.mjs), [prepared requests](https://github.com/1235357/agent-continue/blob/main/native/desktop-commander/prepared-process.mjs), [administrator staging](https://github.com/1235357/agent-continue/blob/main/scripts/Stage-WindowsAdministratorBundle.ps1), [browser administrator controls](admin-control.js), and [installation Pause](admin-installation-pause.js). Validation scope: [VALIDATION.md](VALIDATION.md).
