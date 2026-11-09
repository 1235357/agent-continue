# Agent Continue Windows Device Preview: Privacy and Data Handling

Updated: 2026-11-08. This notice applies to the Windows device development candidate, not the separately released scheduler-only Agent Continue v2.2.1. A preview archive is not a Chrome Web Store submission. Local readiness does not establish tool access in a particular ChatGPT or Your dot conversation; verify each one separately. The candidate includes consented, same-page continuation after a verified fresh administrator installation. Full installed-browser acceptance of that combined flow is still pending; this notice does not activate it.

## Prompt Scheduling

The extension parses imported files on your device. Importing a file does not send it or start a task. Prompts, queues, templates, settings, and recovery data (including target conversation metadata) are stored in the current browser profile, not synced by Agent Continue. Local storage is not an encrypted vault. Submitted prompts go to the selected ChatGPT or Your dot conversation on chatgpt.com and are handled under that service's policies. Pausing scheduling prevents future sends but cannot retract a submitted prompt.

Activity logs are local and do not record prompt bodies, imported filenames, or conversation bodies. Default configuration exports omit prompt and queue text and target URLs. Agent Continue does not operate a data collection backend or send external analytics telemetry.

## Diagnostic Log Export

Diagnostic exports omit stored free-text messages and use relative timings by default. Exact timestamps can be included only by explicitly selecting that option on the Support page. Even relative timing can reveal activity patterns. Exports are local downloads, not automatic uploads. Review them before sharing.

Execution diagnostics can include a fixed local stage (page, prepare, readiness, dispatch or receipt), result channel (none, execute-script or extension-message), and a bounded integer lease-renewal count. Internal run tokens, document identifiers and cancellation messages are not exported. These fields do not prove service acceptance.

## Windows Setup and Credentials

You run the Windows setup command yourself from a verified, extracted source bundle. Copying a command does not execute it. There is no custom Agent Continue EXE/MSI installer. This does not mean there are no executables: Node.js, the official tunnel client and locked upstream dependencies execute outside the browser.

**Current-account setup** runs with the Windows account's existing privileges. It reuses compatible Node.js or downloads and verifies the official portable Node.js ZIP from nodejs.org, without changing the system PATH. Dependencies come from the npm registry and the official tunnel client from GitHub. Standalone mode does not register a browser host. Browser-managed current-account mode registers the selected extension's local Chrome host under that user's HKCU registry hive after confirmation.

**Administrator setup** is a separate, explicit choice. Its command requests Windows elevation (UAC), verifies the actual child token, and stages a hash-pinned runtime under Program Files with restricted ownership and access controls. The browser-owner registration uses the selected extension origin and a protected HKLM Native Messaging registration; it also creates the installation's administrator-owner scheduled-task definition. Installation is not tool authorization in a chat. The installer finishes paused/ready-to-connect. In the candidate's combined flow, the initiating Setup page can then request one browser-owned connection, only after checking its exact installation receipt and installation-wide Pause support. Windows may request approval separately for installation and connection; one command is not a one-UAC guarantee. Administrator mode can act beyond the current user's ordinary file permissions, subject to Windows protections; choose it only if you intend that access.

The runtime uses the official client to connect directly to OpenAI, not through a project relay. No incoming public management port is required by this path. The optional local-control pairing described below is separate loopback-only access.

The current-account browser-managed option writes a current-user Chrome Native Messaging registration for the confirmed extension ID; the separate administrator option uses its protected registration as described above. Both require an optional browser permission. The browser can then start the installed local runtime and restore an enabled connection. It can show a paused device's status without reconnecting its tunnel.

Keep the OpenAI runtime-key file on the Windows device in a location protected by your account. Enter only its file path when prompted, not the key itself. The key is not included in the extension, setup JSON or copied setup command. Do not put the key on the clipboard or paste it into a chat. Current-account configuration stores a reference to the file; administrator binding copies the key into its protected local credential directory for the official client. The original key file remains your responsibility. Windows access controls are not a claim that plaintext secrets never exist in memory or on disk.

## What an Authorized Chat Can Access

Local setup, browser permission or pairing does not grant a chat access. The private MCP app must be configured separately in the relevant OpenAI workspace and authorized for the intended conversation. Ordinary ChatGPT and Your dot have the same local capability boundary, but availability and approval are separate for each conversation. Once connected and authorized, tool requests travel through OpenAI to your device, and results go back through OpenAI to that conversation. Tools can read or change files, execute arbitrary authorized PowerShell commands and manage processes as the selected runtime account, not just inside the archive folder. In administrator mode the command process has administrator privileges. Results can include sensitive file contents, paths, terminal output and process information. Do not authorize a conversation unless you intend this access.

The bundled Desktop Commander runtime can retain tool arguments and results in its local tool history. This is separate from the extension's activity log, and it can contain file paths, command text, or returned content. Do not share raw runtime history as an extension diagnostic. For supported changes with a caller-supplied operation ID, Agent Continue also keeps a local hash of that ID and a limited receipt status. The receipt contains no tool arguments or output and does not prove whether the intended effect occurred.

## Local Controls and Revocation

Standalone mode's optional pairing uses a short-lived ticket containing a local port and pairing code for status, disconnect-and-pause, and reconnect. The extension connects only to the same device over loopback, clears the input on submission, and does not save the ticket. The code is not included in a URL or sent to the loopback frame. The session expires after 15 minutes or can be ended from the terminal. Ending pairing does not disconnect the tunnel. Browser-managed mode requires a separately granted Chrome Native Messaging permission after bridge registration. A browser permission grant does not authorize a chat.

The standalone pairing panel keeps a pending control action's random ID in browser session memory. Re-pair with the original device to check that ID without sending the action again. That pairing ID is not synced or written to persistent extension storage. A browser restart or extension reload clears that session memory. The device keeps its separate operation journal.

Browser-managed administrator controls additionally retain a persistent local operation journal and terminal-operation archives. These contain installation hashes, random operation IDs, bounded control targets, request times, action/outcome/state and verification progress, not PowerShell bodies or tool results. A separate local Pause reference and restore preference are retained. Pending operation evidence can survive extension Clear Data so an uncertain privileged operation cannot be silently replayed. Deleting a browser record does not cancel a Windows operation. The combined flow adds a random setup identifier to its sealed local installation receipt and a persistent association with the original connection operation. Installation-wide Pause retains original-ID routing, including a bounded active index and settled per-ID archives. These records contain no credentials or command bodies. The setup receipt alone is not authority to connect or a chat grant: the worker also requires the initiating tab/document's unexpired intent and unchanged authorization. Closing or reloading the page does not replay an unknown connection request.

Use the control for the relevant connection: ordinary Disconnect and pause does not pause the separate administrator runtime. Administrator Pause requests a stop; only its exact native receipt and independent current observation can establish the result. Revoke administrator authorization denies future starts for that installation; a revocation marker alone is not proof that every process stopped. Browser reopen restoration is opt-in and limited to a still-authorized saved-running intent; it must not undo manual pause or revocation. A full browser-reopen/revocation acceptance trial for the final public artifact is still pending.

Revoke the chat's tool access or runtime key separately through OpenAI. Pausing cannot retract results already sent, undo earlier file writes, or necessarily stop programs deliberately detached by an authorized shell command. Clearing browser data or uninstalling the extension does not uninstall the separate Windows runtime, task/host registration, protected credentials, original key file, exported files or data already sent to ChatGPT. Follow the reviewed local removal procedure and verify its receipt separately.

## Developer and Support

Developer: Zhentong Ye. Contact: [zhentongye2028@u.northwestern.edu](mailto:zhentongye2028@u.northwestern.edu).
Source and issues: [1235357/agent-continue](https://github.com/1235357/agent-continue).
Author: [LinkedIn](https://www.linkedin.com/in/tony-zhentong-ye/).

No diagnostics are uploaded automatically. Review any log before voluntarily sharing it. GitHub issues and attachments are public: do not include runtime keys, account cookies, configuration backups, private documents, conversation text or raw tool history. This notice is a source-candidate disclosure, not a security certification, publication receipt or Chrome Web Store approval.
