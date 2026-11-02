# Chrome Web Store Listing - English

English listing copy for v2.2.0. This documentation edit does not update the store: the submitted v2.1.0 package and its locked listing are unchanged by this edit. GitHub releases may ship ahead of Chrome Web Store review. This document is not evidence of store approval, publication, a saved listing edit, or an installed v2.2.0 package.

When the listing becomes editable, copy the entire **Description** section, including the developer/support block, into the store's Description field. The copy uses plain-text URLs rather than relying on Markdown rendering. Do not withdraw an existing review merely to apply this copy.

## Name

Agent Continue - Background Prompt Scheduler

## Short Description

Schedule your own prompts in ChatGPT or Your dot, with local queues, pause controls, and English or Chinese settings.

## Description

Agent Continue schedules your own prompts in one existing ChatGPT or Your dot conversation on chatgpt.com. Start, pause, resume, and inspect a task from the extension without activating the target tab.

Repeat one prompt, loop a queue, or run a queue once. Set an interval from 1 to 10080 minutes, optionally time the next send after a reply ends, and configure quiet hours, stop markers, or a confirmed-send limit. The default repeats one prompt every 20 minutes and attempts to interrupt an active response when due; waiting for idle is an option.

Type your prompt or import local text, Markdown, structured text, HTML, DOCX, or text-based PDF. Document parsing takes place locally with bundled resources. Text extraction does not preserve every layout, and scanned PDFs require OCR elsewhere. Prompt text is hidden until explicitly revealed. Local templates and up to 200 activity entries help manage repeated work.

The interface defaults to English and offers a Simplified Chinese language switch. Your language preference is stored locally; your prompts and custom content are not translated. The Developer & support page shows the developer contacts and installed extension version and offers the same language choices.

Each attempt uses one submission mechanism. A matching new user-message marker is required for confirmation; clearing the composer alone is not success. An unknown result does not trigger an immediate retry, but another attempt may occur after the full normal interval. Delivery is not guaranteed or exactly once. Pause and inspect the conversation if a result is uncertain. Send once now submits a real message, and pause cannot retract an action already dispatched.

The computer and browser must remain running, with the target executable and signed in. Background throttling, sleeping pages, and website changes may delay or prevent sending. Optional idle-sleep prevention does not override manual sleep. The extension does not increase account quotas, extend model context, or guarantee completion of an agent task.

No separate extension account, API key, developer backend, analytics telemetry, cloud synchronization, or online document converter is used. ChatGPT sign-in is required on the target website. When you authorize sending, your prompt goes to ChatGPT and is processed under that service's policies. Local storage is not encrypted. The extension does not use the system clipboard.

Free and open source under the MIT license.

Developer and support

Developer: Zhentong Ye
Email: zhentongye2028@u.northwestern.edu
Open-source project: https://github.com/1235357/agent-continue
Bug reports and suggestions: https://github.com/1235357/agent-continue/issues/new/choose
Author's LinkedIn: https://www.linkedin.com/in/tony-zhentong-ye/

For a bug report, manually provide your extension version, browser version, operating system, steps to reproduce with synthetic prompts, and expected and actual behavior. Select ordinary ChatGPT, Your dot, or Not applicable / extension interface for an interface, settings, or import problem. Browser and OS details are not auto-detected or collected through fingerprinting. The separate Suggestion form does not require a conversation target or logs.

Activity and support-page exports share schema 3 JSON diagnostics. Reports include the installed extension version, allowlisted event/diagnostic categories, and bounded diagnostic durations, but omit stored free-text messages and unknown fields. Logs are timestamped locally; exports default to relative millisecond timings without exact timestamps or the export time. Include exact timestamps is off by default and available only on the support page, not in the Activity export. Review the complete JSON before optionally attaching a sanitized copy to the issue; exporting does not upload it, create an issue, or contact support automatically. Do not attach configuration backups.

GitHub issues and their attachments are public. Remove identifying data, private prompts, conversation URLs, credentials, cookies, and documents from report text and attachments. Task timing and status may remain identifying, so exported logs are not guaranteed to be anonymous. Support links do not introduce external telemetry.

This is an independent personal project, not an official OpenAI product. A university email address does not imply university endorsement or technical support.

## Single Purpose

Schedule and control user-authored prompt submissions to one user-selected ChatGPT or Your dot conversation on chatgpt.com. Local file import, queues, templates, status checks, and scheduling controls support this purpose.

## Permission Justifications

| Permission | Justification |
| --- | --- |
| Host access: `https://chatgpt.com/*` | Identify eligible target tabs, inspect the selected conversation and composer, fill and submit user-authorized prompts, confirm new-message markers, and reidentify the original target after restart. No all-site access is requested. |
| `activeTab` | Access the selected tab when the user invokes the extension to select or inspect a task target. |
| `scripting` | Execute page checks and authorized composer interactions in the target tab. |
| `storage` | Keep prompts, queues, templates, configuration, theme, language preference, logs, and task recovery state in browser-local/session storage. No Chrome Sync is used. |
| `alarms` | Wake the service worker for scheduled due checks and task timing. |
| Optional `power` | Prevent system idle sleep only when the user explicitly enables that setting; ordinary use does not require it. |

## Data Handling and Remote Code

Prompt and imported-document text is processed locally and stored for the user's task. Target URLs, titles, and conversation identity markers are used locally for binding and recovery. Page state is inspected for safe interaction and confirmation. Authorized prompts are submitted to ChatGPT; no content is transmitted to a developer service, advertising network, or analytics service. The extension's activity logger excludes prompt bodies, imported filenames, conversation bodies, full target URLs, and raw exceptions.

Local activity logs retain exact event timestamps and status messages, with up to 200 entries. Schema 3 diagnostic exports omit stored free-text messages, validate event/timestamp/duration fields, and include the installed extension version as extensionVersion. By default, timestampMode is relative-ms, event elapsedMs values are relative to the first retained valid event, and logs[].at and exportedAt are absent. Only explicit support-page opt-in through Include exact timestamps changes timestampMode to unix-ms, includes absolute Unix-millisecond logs[].at values, and adds the ISO 8601 UTC exportedAt value. Relative timings can still identify activity patterns; exports are not guaranteed to be anonymous.

Language choice is saved as `uiLanguage` in local storage. The current clear-local-data command removes tasks, configuration, templates, theme, and logs but retains that preference. Clearing local data does not remove imported originals, exported files, or website messages.

Executable extension code and PDF parsing resources are bundled; no remote executable code or runtime CDN is used. Source development dependency installation is separate from installed-extension operation.

## Links

- Store: https://chromewebstore.google.com/detail/jpioilmpbolfokedaefmbfbjeaahfdkl
- Source and support: https://github.com/1235357/agent-continue
- Release downloads: https://github.com/1235357/agent-continue/releases
- Privacy policy source: https://github.com/1235357/agent-continue/blob/main/PRIVACY.md

These are listing-copy links, not evidence of a v2.2.0 upload, approval, publication, or installation.

## v2.2.0 Release Scope (Not Store Copy)

Stable v2.2.0 includes developer support, schema 3 diagnostics, and support-page error recovery. It excludes unshipped device-control, setup/onboarding, and native-messaging candidates and does not request nativeMessaging. The permission table above describes the stable release, not candidate changes in a development worktree.

GitHub release availability is independent of Chrome Web Store review. Publishing a GitHub release does not establish store approval, a saved store-listing update, or the version installed in a user's browser. Existing single-submit behavior and scheduling limits remain in effect; this documentation makes no defect-free or live-site compatibility guarantee.
