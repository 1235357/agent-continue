# Privacy and Data Handling

Scope: Agent Continue v2.2.1 stable release documentation. Updated: 2026-11-06.

Agent Continue processes configuration and imported documents locally. It has no developer backend, external analytics telemetry, cloud synchronization, or online document conversion. No separate extension account or API key is required. Sending a prompt submits it to your selected ChatGPT or Your dot conversation on `chatgpt.com`; that service then processes it under its own policies. Local processing does not mean that sent prompts stay on your computer.

## Data Flow

1. You type a prompt or select local files through the file picker or drag and drop.
2. The extension reads and parses those files locally. Text is imported as text; HTML, DOCX, and PDF import extract text without executing document scripts or calling a remote conversion service.
3. Prompts, queues, templates, and configuration are saved in the current browser profile's extension storage.
4. When you start a task or request a send, the scheduler passes the prompt to an isolated-world script on the bound target. Each attempt uses one submission mechanism after a background permission check. It does not use the system clipboard or activate the target tab.
5. The website receives the submitted message. The extension inspects page state and new user-message markers for confirmation; missing confirmation remains an unknown result, not proof that the service did not receive it.

Importing a file does not itself send a message or start a task. A normal first installation does not automatically start sending. An optional private preconfigured package can import its bundled prompt without automatically starting a task.

Existing unsent text is preserved by default. If you explicitly enable Extension Priority for a new task, its configured prompt may replace unsent composer text, including text changed while authorization is pending. Existing attachments are not submitted by this mode. Pause, background authorization, and target-identity checks still apply; the setting does not add permissions or send drafts to the developer.

## Stored Data

| Data | Storage and purpose |
| --- | --- |
| Prompts, queues, intervals, and stop conditions | `chrome.storage.local`, for configuration and later sending |
| Templates and theme | `chrome.storage.local`, not Chrome Sync |
| Interface language | `chrome.storage.local` as `uiLanguage`; English is the default, with Simplified Chinese selectable locally |
| Current task, internal execution tokens, and run state | `chrome.storage.session`, to survive service-worker suspension; tokens are internal run identifiers, not account credentials |
| Recovery task copy | `chrome.storage.local`, including target URL, title, Dot identity markers, configuration, and counters for restart recovery |
| Activity logs | `chrome.storage.local`, limited to 200 locally timestamped event/status entries, including status `message` text; diagnostic exports omit stored `message` fields |
| Diagnostics | Fixed categories and diagnostic durations bounded to 0–120000 ms in local logs; schema 3 exports validate these fields and default to relative event timings |
| Parsing buffers and displayed prompt text | Extension memory; explicitly revealed text also appears in the interface DOM |
| Exported JSON files | Your selected download location, under your control after export |

The extension's activity logger does not record prompt bodies, imported filenames, conversation bodies, raw exceptions, or full target URLs. Local logs retain exact event timestamps and status messages; diagnostic exports use the reduced schema described below. Recovery state does contain target metadata, and prompts must remain readable to the extension for sending. Logs still reveal task timing and status. The language preference is not sent to a telemetry service, and changing it does not translate your content.

## Hidden Text Is Not Encryption

Prompt text is hidden by default and is not placed in the hidden prompt textarea until you explicitly reveal or edit it. Importing text, switching task configuration, or leaving the prompt view hides it again. This reduces accidental exposure in screenshots, screen sharing, and routine interface inspection.

Local storage and extension memory are not encrypted vaults. Someone with browser-profile or debugging access may be able to read the data. The extension must access plaintext to send it.

## Imports and Exports

- Files are parsed locally. Imported filenames are not written to activity logs; imported queue items use generic names unless you rename them.
- Default configuration JSON exports omit prompt bodies, queue bodies, and target conversation URLs. Explicitly opting to include prompt and queue text exports that content in plaintext; the opt-in resets after export.
- Diagnostic log exports use schema 3, with relative event timings by default and no stored free-text messages. Exact timestamps require an explicit support-page opt-in; see [Diagnostic Log Export](#diagnostic-log-export).
- PDF.js modules, worker, fonts, and character maps are bundled. Runtime parsing does not load a CDN. Installing development dependencies or preparing resources from source can contact package registries separately.
- A private preconfigured package may include a plaintext original file. Do not share it as a public installation package. Public packaging is intended to exclude personal files; review any package before sharing it.

## Diagnostic Log Export

The Activity export in the popup or full console and the **Developer & support** page use the same schema 3 builder. The support page is available through the extension's support links and shows the installed extension version. Exporting requests a local JSON download; it does not upload diagnostics, create an issue, or contact support automatically.

- The report identifies its schema with `version: 3` and includes the installed extension version as `extensionVersion`, or `unknown` if that value is unavailable or invalid.
- The builder processes the latest 200 stored rows. It omits invalid rows, stored free-text `message` fields, and unknown fields, and copies only allowlisted event and diagnostic categories. Finite diagnostic durations are rounded and bounded to 0–120000 ms. The exported `excludedEntries` count reports rows not included.
- By default, `timestampMode` is `relative-ms` and each event uses `elapsedMs` relative to the first retained valid event. These exports contain neither `logs[].at` nor `exportedAt`. Relative event timings are distinct from the bounded diagnostic durations.
- **Include exact timestamps** is off by default and available only on the support page. Selecting it changes `timestampMode` to `unix-ms`, includes `logs[].at` as absolute Unix-millisecond timestamps, and adds `exportedAt` as an ISO 8601 UTC string. The popup and full-console Activity export have no exact-timestamp option.
- Diagnostics do not auto-detect browser or operating-system details or fingerprint the browser. Enter browser and OS details manually in the bug form.

Relative timings and status information can also identify activity patterns. Omitting messages, validating fields, and using relative timings do not guarantee anonymity. Review and sanitize the complete JSON file before any public attachment. Exporting does not alter the original locally timestamped logs, and uploading remains a separate, manual action.

## Permissions

| Permission | Why it is used |
| --- | --- |
| `https://chatgpt.com/*` | Discover eligible targets, inspect conversation state and identity, fill the composer, submit prompts, and recover the original target |
| `activeTab` | Access a selected tab following a user action |
| `scripting` | Execute read-only checks and authorized sending logic on the target page |
| `storage` | Save local settings, language, content, logs, templates, and task/recovery state |
| `alarms` | Wake the background scheduler to check due tasks |
| Optional `power` | Request system idle-sleep prevention only when you enable it |

The stable v2.2.1 release manifest does not request all-site access, Cookie, clipboard, debugger, or `nativeMessaging` permissions. Unshipped device-control, setup/onboarding, and native-messaging candidates are excluded from this release. The extension does not send files or prompts to project maintainers, sell user data, or use external telemetry endpoints. Sending through ChatGPT is the intended website interaction, not developer telemetry.

## Pause and Deletion

Pausing revokes subsequent sending permission, clears the scheduling alarm, and releases the extension's keep-active settings. It cannot retract a submission already dispatched to the website.

The pause-and-clear-local-data command removes the task, recovery copy, configuration, templates, theme, and logs. Pending imports are invalidated so that their results cannot repopulate cleared configuration. **The current command does not remove `uiLanguage`, so the interface-language preference remains locally stored.** A private-preset processed marker may remain to prevent silent reimport. Plaintext files bundled in a private installation folder remain the folder owner's responsibility.

Clearing the extension does not delete original imported files, exported JSON, screenshots, backups, private installation files, or messages already sent to ChatGPT. Manage those at their respective locations. Uninstalling the extension removes its browser-managed storage; separately exported files and website messages remain outside that storage.

## Developer and Support

- Developer: Zhentong Ye
- Email: [zhentongye2028@u.northwestern.edu](mailto:zhentongye2028@u.northwestern.edu)
- Project: [1235357/agent-continue](https://github.com/1235357/agent-continue)
- Bug reports: [Open a GitHub issue](https://github.com/1235357/agent-continue/issues/new/choose)
- Author's LinkedIn: [Zhentong Ye](https://www.linkedin.com/in/tony-zhentong-ye/)

Support diagnostics are shared manually. Exporting activity logs creates a local JSON file; it does not upload the file, open an issue, or contact the developer automatically. You choose whether to attach a reviewed, sanitized copy to a GitHub issue. This voluntary sharing is separate from the extension's operation and is subject to the service you use.

**GitHub issues and their attachments are public.** Review the entire report and every attachment before posting. Remove identifying data, private prompts, conversation URLs, credentials, cookies, real conversation content, documents, and private preconfigured packages. Do not attach configuration backups. Use synthetic prompts and provide only the diagnostic details needed to reproduce the problem. Log exports omit prompt and conversation bodies, but relative timings and status information can still reveal activity; opting into exact timestamps adds wall-clock detail. Neither export nor manual sanitization guarantees anonymity.

The support links do not add background telemetry or automatic support uploads. Contacting the developer does not authorize access to your browser, account, conversations, or local files.

This policy describes the stable v2.2.1 data flow, not Chrome Web Store approval or an installed-version readback. GitHub releases may ship before store review completes; consult the corresponding listing and your browser's extension details for their versions.

Implementation references: [background.js](background.js), [adapter.js](adapter.js), [file-import.js](file-import.js), [popup.js](popup.js), [activity-export.js](activity-export.js), [support.js](support.js), and [i18n.js](i18n.js). Validation scope: [VALIDATION.md](VALIDATION.md).
