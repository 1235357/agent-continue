# Chrome Web Store Listing - English

Canonical English listing source for Agent Continue **3.0.2** (prepared source, not yet released or submitted). This edit does not change a saved Store listing, submit a package, publish a release or establish approval/installation. Actual availability and submission state require separate platform receipts. The 3.0.1 submission corrected after Yellow Argon remains pending review; this source update does not withdraw or replace it. Historical v2.2.1 is a separate scheduler-only release; do not replace its assets or describe it as Windows-enabled. The repository's [Windows review notes](https://github.com/1235357/agent-continue/blob/main/docs/STORE-LISTING.windows-candidate.en.md) retain the disclosure and submission checks.

After final release and disclosure gates are closed, use the entire **Description** section, including the developer/support block, for the new listing draft. The copy uses plain-text URLs rather than relying on Markdown rendering. Do not withdraw an existing review merely to apply this source copy.

## Name

Agent Continue - ChatGPT Workflow Tools

## Short Description

Schedule ChatGPT prompts and optionally connect Windows file, shell and process tools with explicit consent.

## Description

Schedule your own prompts in a chosen ChatGPT or Your dot conversation. Repeat a prompt, work through a queue, set an interval and pause whenever needed. You can type a prompt or import text from a local document. The interface defaults to English, with Simplified Chinese available in Settings; your own content is not translated.

The computer and browser must stay running, with the target conversation open and signed in. Website changes, sleep and background throttling can delay or prevent a send. Delivery is not guaranteed. The extension does not increase account quotas or guarantee that an AI task finishes. If a submission is uncertain, inspect the conversation before continuing.

Optional Windows control

Connect a separate local runtime to let an authorized conversation read and write files, run PowerShell commands and manage processes. Setup requires your configured OpenAI app and tunnel, a local runtime key, and the relevant browser, Windows and conversation approvals. Current-account tools use your existing privileges; administrator access requires Windows elevation. This is not a sandbox: authorized tools can affect the selected account's files and system. The extension alone does not install or authorize these tools.

Windows tool arguments and results travel through OpenAI's official tunnel and can include sensitive content. Prompts submitted by the scheduler also go to OpenAI. There is no developer-operated data collection backend. Local settings and activity records remain on your device, but local storage is not encrypted. Runtime tool history can retain commands, paths and results. Optional diagnostic exports include activity metadata; review them before sharing.

Scheduler Pause and device Pause are separate. Use the administrator connection's own Pause or Revoke controls when that runtime is enabled, and verify the resulting status. Reopening the browser must not override manual Pause or Revoke. Pause or Revoke may not stop detached programs. Revoke OpenAI conversation access and runtime keys separately. Stopping access cannot undo earlier actions or retract transmitted data. Removing the extension does not remove a separately installed runtime or its credentials and history.

Read the setup and privacy information before enabling Windows control:
https://github.com/1235357/agent-continue
https://github.com/1235357/agent-continue/blob/main/PRIVACY.md

Free and open source under the MIT license.

Developer: Zhentong Ye
Email: zhentongye2028@u.northwestern.edu
Open-source project: https://github.com/1235357/agent-continue
Bug reports and suggestions: https://github.com/1235357/agent-continue/issues/new/choose
Author's LinkedIn: https://www.linkedin.com/in/tony-zhentong-ye/

For a bug report, include the version, reproduction steps and expected versus actual behavior. Sanitized logs are optional. GitHub issues are public: never attach keys, private conversations or raw tool history. Support links do not upload data automatically.

Independent personal project; not an official OpenAI product. The university email does not imply university endorsement or support.

## Single Purpose

Support user-directed ChatGPT workflows through scheduled user-authored prompts and optional, explicitly authorized Windows file/shell/process tools. Local imports, queues, status checks, setup and device lifecycle controls support that workflow. Browser permission, OS elevation and conversation authorization remain separate requirements; this combined-purpose statement does not establish Store-policy approval.

## Detailed Review Reference (Not Store Copy)

The following implementation details support disclosure review and maintenance. They are not part of the Store Description. Keep technical enumerations here and in the canonical privacy policy rather than appending them to consumer-facing listing text.

Agent Continue supports user-directed workflows in ChatGPT: schedule your own prompts in one chosen ChatGPT or Your dot conversation on chatgpt.com, and optionally connect separately installed Windows file, shell and process tools. Scheduling and device connections have separate controls and authorization.

Repeat one prompt, loop a queue, or run a queue once. Set an interval from 1 to 10080 minutes, optionally time the next send after a reply ends, and configure quiet hours, stop markers, or a confirmed-send limit. The default repeats one prompt every 20 minutes and attempts to interrupt an active response when due; waiting for idle is an option.

Type your prompt or import text from a local document. Document parsing takes place locally with bundled resources. Text extraction does not preserve every layout, and scanned documents require OCR elsewhere. Prompt text is hidden until explicitly revealed. Local templates and up to 200 activity entries help manage repeated work.

The interface defaults to English and offers a Simplified Chinese language switch. Your language preference is stored locally; your prompts and custom content are not translated. The Developer & support page shows the developer contacts and installed extension version and offers the same language choices.

Each attempt uses one submission mechanism. A matching new user-message marker is required for confirmation; clearing the composer alone is not success. An unknown result does not trigger an immediate retry, but another attempt may occur after the full normal interval. Delivery is not guaranteed or exactly once. Pause and inspect the conversation if a result is uncertain. Send once now submits a real message, and pause cannot retract an action already dispatched.

The computer and browser must remain running, with the target tab open and signed in. Background throttling, sleeping pages, and website changes may delay or prevent sending. Optional idle-sleep prevention does not override manual sleep. The extension does not increase account quotas, extend model context, or guarantee completion of an agent task.

Prompt scheduling and file import need no separate extension account or API key. ChatGPT sign-in is required on the target website. Submitted prompts go to ChatGPT under that service's policies. There is no developer-operated collection backend, cloud synchronization or online document converter. Local extension storage is not encrypted. The scheduler does not use the system clipboard; Setup can copy its command after your user gesture.

Optional Windows tools require a separate local runtime, your configured OpenAI workspace/app and official tunnel, a local runtime-key file, and the relevant browser, Windows and conversation approvals. Choose current-account or administrator scope before running the reviewed setup command. Current-account tools use that account's existing privileges. Administrator setup requests Windows elevation (UAC), stages a protected runtime under Program Files, and registers its browser host and administrator-owner task. One command does not mean one UAC approval. Installation is not conversation authorization. Browser-managed installers finish paused; with fresh installation-and-connection consent, the unchanged Setup page may separately request one connection after verifying the matching installation and authority. Current-account continuation uses its own one-time proof, not administrator transport; existing installations are not automatically adopted or unpaused. Withdrawal cancels unsent preparation, not already admitted operations. Standalone current-account setup can request one connection with tunnel inputs and connection consent (CONNECT in the guided prompt); browser-managed guided setup confirms REGISTER without starting the tunnel in that installer step. Node.js and the official client run outside the browser; no custom Agent Continue EXE/MSI installer is required. Setup may download verified dependencies from nodejs.org, npm and GitHub.

Once connected and authorized, a conversation can read/write files, execute shell commands and manage processes across the selected Windows account, not only inside the extension or setup folder. Administrator tools have elevated capability, subject to Windows protections. This is not a sandbox. Tool arguments and results travel through OpenAI using its official tunnel, not a developer relay. They can contain sensitive file contents, paths, command text/output and process details. Local processing does not mean that Windows data never leaves the device. Ordinary ChatGPT and Your dot each need their own available, authorized tool entry.

Keep the runtime key in a protected file on the device and enter only its path in the local setup terminal. Never paste the key into the extension, a chat, a copied command or an issue. Current-account configuration references that file; administrator binding copies the key into its protected local credential directory. The original remains your responsibility. Access controls do not mean that plaintext secrets never exist on disk or in memory.

The pinned Desktop Commander dependency includes upstream telemetry, enabled by default when used independently. Agent Continue disables it using both telemetryEnabled:false in isolated configuration and DESKTOP_COMMANDER_DISABLE_TELEMETRY=1 before loading the provider, and validates that policy on launch. Setup dependency acquisition disables npm lifecycle scripts. This does not disable OpenAI traffic, downloads or network use by authorized shell commands, and it is not an all-traffic audit.

Windows tool history is separate from the extension's activity log and can retain arguments, returned content, command text and paths. Warning-level tunnel logs, prepared-command files when used, device-operation receipts and persistent administrator control records are also local. Bounded control journals do not store tool bodies/results; tool history and prepared-command files can. Durable control evidence can survive extension Clear Data so an uncertain operation is checked under its original ID, not silently replayed.

Use Pause for the relevant device connection; scheduler Pause and ordinary Disconnect and pause do not stop the separate administrator runtime. Administrator Pause requests a stop: verify its exact receipt and observed outcome. Revoke denies future starts for that installation; a marker alone is not proof every process stopped. Administrator browser-reopen restoration is off unless explicitly enabled, restores only still-authorized saved-running intent, and must not override manual Pause/Revoke. Revoke OpenAI conversation access or runtime keys separately. Pause/Revoke cannot undo earlier file changes, retract transmitted results or necessarily stop deliberately detached programs.

Clearing extension data or uninstalling the extension does not remove the Windows runtime, task/host registrations, protected credentials, original key, local runtime history or data already sent to OpenAI. The setup uninstall option currently produces a plan, not completed removal. Review and verify removal separately. Full privacy policy: https://github.com/1235357/agent-continue/blob/main/PRIVACY.md

Free and open source under the MIT license.

Developer and support

Developer: Zhentong Ye
Email: zhentongye2028@u.northwestern.edu
Open-source project: https://github.com/1235357/agent-continue
Bug reports and suggestions: https://github.com/1235357/agent-continue/issues/new/choose
Author's LinkedIn: https://www.linkedin.com/in/tony-zhentong-ye/

For a bug report, manually provide your extension version, browser version, operating system, steps to reproduce with synthetic prompts, and expected and actual behavior. Select ordinary ChatGPT, Your dot, or Not applicable / extension interface for an interface, settings, or import problem. Browser and OS details are not auto-detected or collected through fingerprinting. The separate Suggestion form does not require a conversation target or logs.

Activity and support-page exports share schema 4 JSON diagnostics. Reports identify format agent-continue-activity and version 4, and contain extensionVersion, timestampMode, excludedEntries and logs. Retained entries include an allowlisted event, event timing and an optional diagnostic code and finite numeric durationMs rounded and bounded to 0–120000 ms. Stored free-text messages and unknown fields are omitted, but locally collected activity metadata remains.

When a diagnostic code is timing-probe, the report can additionally include kind (authorization or page-timers), status (result, invalid-result, api-rejected or watchdog-expired), finite numeric firstMs rounded and bounded to 0–120000 ms, and actual boolean hidden, ok and allowed values, including false. These fields describe page visibility and probe/authorization outcomes; they are not a claim of no data collection or anonymity.

Logs are timestamped locally; exports default to relative millisecond timings without exact timestamps or the export time. Include exact timestamps is off by default and available only on the support page, not in the Activity export. Review the complete JSON before optionally attaching a sanitized copy to the issue; exporting does not upload it, create an issue, or contact support automatically. Do not attach configuration backups.

GitHub issues and their attachments are public. Remove identifying data, private prompts, conversation URLs, credentials, cookies, and documents from report text and attachments. Do not attach runtime keys, raw tool history, prepared commands or native state directories. Task timing and status may remain identifying, so exported logs are not guaranteed to be anonymous. Support sharing is optional; links do not automatically upload diagnostics or grant developer access.

This is an independent personal project, not an official OpenAI product. A university email address does not imply university endorsement or technical support.

## Permission Justifications

| Permission | Justification |
| --- | --- |
| Host access: `https://chatgpt.com/*` | Identify eligible target tabs, inspect the selected conversation and composer, fill and submit user-authorized prompts, confirm new-message markers, and reidentify the original target after restart. No all-site access is requested. |
| `activeTab` | Access the selected tab when the user invokes the extension to select or inspect a task target. |
| `scripting` | Execute page checks and authorized composer interactions in the target tab. |
| `storage` | Keep prompts, queues, templates, configuration, theme, language preference, logs, task recovery state, and device/control evidence and preferences in browser-local/session storage. No Chrome Sync is used. |
| `alarms` | Wake the service worker for scheduled due checks and task timing. |
| Optional `power` | Prevent system idle sleep only when the user explicitly enables that setting; ordinary use does not require it. |
| Optional `nativeMessaging` | Reach the separately installed, extension-bound Windows bridge for bounded status, connection, Pause, Revoke, recovery and prepared-process reference checks. It does not install/elevate software or grant chat access. Hosted file/shell/process requests use the official tunnel, not arbitrary commands in Native Messaging. |

## Data Handling and Remote Code

Prompt and imported-document text is processed locally and stored for the user's task. Target URLs, titles, and conversation identity markers are used locally for binding and recovery. Page state is inspected for interaction and confirmation. Authorized prompts and optional Windows tool arguments/results are transmitted through OpenAI. Agent Continue does not automatically transmit them to a developer collection/advertising service. Upstream telemetry is disabled by the wrapper configuration described above; this does not make hosted tool traffic local-only. The scheduler activity logger excludes prompt bodies, imported filenames, conversation bodies, full target URLs and raw exceptions; those exclusions do not cover Windows tool history or prepared commands.

Local activity logs retain exact event timestamps and status messages, with up to 200 entries. Schema 4 diagnostic exports omit stored free-text messages, validate event/timestamp/duration fields and timing-probe metadata as described above, and include the installed extension version as extensionVersion (unknown if unavailable or invalid). The builder processes the latest 200 stored rows; excludedEntries counts all input rows not retained, including older and invalid rows. By default, timestampMode is relative-ms, event elapsedMs values are relative to the first retained valid event, and logs[].at and exportedAt are absent. Only explicit support-page opt-in through Include exact timestamps changes timestampMode to unix-ms, includes absolute Unix-millisecond logs[].at values, and adds the ISO 8601 UTC exportedAt value. Relative timings, page visibility and authorization results can still identify activity patterns; exports are not guaranteed to be anonymous.

Language choice is saved as `uiLanguage` in local storage. Clear Data removes scheduler tasks/configuration/templates/theme/activity logs and the administrator browser-restore preference. It retains language and durable device/administrator operation evidence, does not issue Windows Pause/Revoke and does not remove Windows-side records, imported originals, exported files or website messages. Missing browser records do not prove that a native operation failed or was cancelled.

Privileged browser-extension scripts and PDF parsing resources are bundled, with no parsing CDN. Optional standalone pairing embeds a cross-origin sandboxed page served by the separately installed runtime at a validated IPv4 loopback address. That page includes a local JavaScript relay, has no extension API access, and passes bounded authenticated requests and results. It is not code bundled in the extension ZIP and must be disclosed separately in the Store's remote-code review. The separate Windows setup/runtime also downloads and executes verified native dependencies after consent. Browser-extension packaging, the loopback sandbox, native setup and source development dependencies are distinct scopes.

Before submission, reconcile actual privacy-form categories with the finalized package and canonical policy. Locally stored scheduler metadata, sensitive hosted tool arguments/results, Windows history and credential references must not be omitted by a scheduler-only or no-key declaration. This source does not certify legal compliance or saved Store-form answers.

## Links

- Store: https://chromewebstore.google.com/detail/jpioilmpbolfokedaefmbfbjeaahfdkl
- Source and support: https://github.com/1235357/agent-continue
- Release downloads: https://github.com/1235357/agent-continue/releases
- Privacy policy source: https://github.com/1235357/agent-continue/blob/main/PRIVACY.md

These are listing-copy links, not evidence of a 3.0.1 upload, approval, publication or installation.

## Reviewer Test Instructions (500-Character Form)

Use your own ChatGPT test account; no developer credentials. Select a test chat, set a harmless prompt, Send once now; verify one matching message and Pause. Switch EN/ZH; prompt text stays unchanged. Optional Windows tools: follow Settings > Setup and https://github.com/1235357/agent-continue . Consent to current-account or administrator setup with your own tunnel/key, then authorize a test chat. Use only temporary files/owned processes; test Pause and Revoke in Devices. No keys supplied here.

## Release Scope and Remaining Gates (Not Store Copy)

Version 3.0.1 combines the scheduler and optional Windows source. Historical v2.2.0 support/schema 3 changes and v2.2.1 scheduler fixes remain scheduler-only; they did not request nativeMessaging. The permission table above describes the combined version, not those older releases.

Checkpoint97 records actual r11 full-app saved-running recovery, ordinary ChatGPT and Dot administrator command/file/owned-process results, and matching Pause/Revoke stopped receipts with independent host readback. The test runtime is revoked and not running. These bounded observations do not establish current-account hosted operation, automatic adoption of an existing installation or indefinite recovery reliability. Complete matching extension/setup/npm artifact verification, actual public downloads and the real new Store submission receipt separately. See the repository's [Runtime Acceptance](https://github.com/1235357/agent-continue/blob/main/docs/RUNTIME-ACCEPTANCE.md); do not replay settled operations or turn historical Ready into a current state.

GitHub release availability is independent of Chrome Web Store review. Publishing a GitHub release does not establish store approval, a saved store-listing update, or the version installed in a user's browser. Existing single-submit behavior and scheduling limits remain in effect; this documentation makes no defect-free or live-site compatibility guarantee.
