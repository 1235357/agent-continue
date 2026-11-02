# Privacy and Data Handling

Scope: Agent Continue v2.1.0 release documentation. Updated: 2026-11-02.

Agent Continue processes configuration and imported documents locally. It has no developer backend, external analytics telemetry, cloud synchronization, or online document conversion. No separate extension account or API key is required. Sending a prompt submits it to your selected ChatGPT or Your dot conversation on `chatgpt.com`; that service then processes it under its own policies. Local processing does not mean that sent prompts stay on your computer.

## Data Flow

1. You type a prompt or select local files through the file picker or drag and drop.
2. The extension reads and parses those files locally. Text is imported as text; HTML, DOCX, and PDF import extract text without executing document scripts or calling a remote conversion service.
3. Prompts, queues, templates, and configuration are saved in the current browser profile's extension storage.
4. When you start a task or request a send, the scheduler passes the prompt to an isolated-world script on the bound target. Each attempt uses one submission mechanism after a background permission check. It does not use the system clipboard or activate the target tab.
5. The website receives the submitted message. The extension inspects page state and new user-message markers for confirmation; missing confirmation remains an unknown result, not proof that the service did not receive it.

Importing a file does not itself send a message or start a task. A normal first installation does not automatically start sending. An optional private preconfigured package can import its bundled prompt without automatically starting a task.

## Stored Data

| Data | Storage and purpose |
| --- | --- |
| Prompts, queues, intervals, and stop conditions | `chrome.storage.local`, for configuration and later sending |
| Templates and theme | `chrome.storage.local`, not Chrome Sync |
| Interface language | `chrome.storage.local` as `uiLanguage`; English is the default, with Simplified Chinese selectable locally |
| Current task, internal execution tokens, and run state | `chrome.storage.session`, to survive service-worker suspension; tokens are internal run identifiers, not account credentials |
| Recovery task copy | `chrome.storage.local`, including target URL, title, Dot identity markers, configuration, and counters for restart recovery |
| Activity logs | `chrome.storage.local`, limited to 200 timestamped event/status entries |
| Diagnostics | Fixed categories and elapsed times bounded to 0–120000 ms, stored in logs and user-requested JSON exports |
| Parsing buffers and displayed prompt text | Extension memory; explicitly revealed text also appears in the interface DOM |
| Exported JSON files | Your selected download location, under your control after export |

Activity logs do not include prompt bodies, imported filenames, conversation bodies, raw exceptions, or full target URLs. Recovery state does contain target metadata, and prompts must remain readable to the extension for sending. Logs still reveal task timing and status. The language preference is not sent to a telemetry service, and changing it does not translate your content.

## Hidden Text Is Not Encryption

Prompt text is hidden by default and is not placed in the hidden prompt textarea until you explicitly reveal or edit it. Importing text, switching task configuration, or leaving the prompt view hides it again. This reduces accidental exposure in screenshots, screen sharing, and routine interface inspection.

Local storage and extension memory are not encrypted vaults. Someone with browser-profile or debugging access may be able to read the data. The extension must access plaintext to send it.

## Imports and Exports

- Files are parsed locally. Imported filenames are not written to activity logs; imported queue items use generic names unless you rename them.
- Default configuration JSON exports omit prompt bodies, queue bodies, and target conversation URLs. Explicitly opting to include prompt and queue text exports that content in plaintext; the opt-in resets after export.
- Log exports contain timestamped events, status information, and bounded diagnostics, not prompt or conversation bodies.
- PDF.js modules, worker, fonts, and character maps are bundled. Runtime parsing does not load a CDN. Installing development dependencies or preparing resources from source can contact package registries separately.
- A private preconfigured package may include a plaintext original file. Do not share it as a public installation package. Public packaging is intended to exclude personal files; review any package before sharing it.

## Permissions

| Permission | Why it is used |
| --- | --- |
| `https://chatgpt.com/*` | Discover eligible targets, inspect conversation state and identity, fill the composer, submit prompts, and recover the original target |
| `activeTab` | Access a selected tab following a user action |
| `scripting` | Execute read-only checks and authorized sending logic on the target page |
| `storage` | Save local settings, language, content, logs, templates, and task/recovery state |
| `alarms` | Wake the background scheduler to check due tasks |
| Optional `power` | Request system idle-sleep prevention only when you enable it |

The manifest does not request all-site access, Cookie, clipboard, debugger, or native-messaging permissions. The extension does not send files or prompts to project maintainers, sell user data, or use external telemetry endpoints. Sending through ChatGPT is the intended website interaction, not developer telemetry.

## Pause and Deletion

Pausing revokes subsequent sending permission, clears the scheduling alarm, and releases the extension's keep-active settings. It cannot retract a submission already dispatched to the website.

The pause-and-clear-local-data command removes the task, recovery copy, configuration, templates, theme, and logs. Pending imports are invalidated so that their results cannot repopulate cleared configuration. **The current command does not remove `uiLanguage`, so the interface-language preference remains locally stored.** A private-preset processed marker may remain to prevent silent reimport. Plaintext files bundled in a private installation folder remain the folder owner's responsibility.

Clearing the extension does not delete original imported files, exported JSON, screenshots, backups, private installation files, or messages already sent to ChatGPT. Manage those at their respective locations. Uninstalling the extension removes its browser-managed storage; separately exported files and website messages remain outside that storage.

## Reporting Issues

Use synthetic prompts. Do not include credentials, Cookies, real conversation content, confidential documents, or private preconfigured packages in issues, screenshots, logs, or attachments. Redacted page structure, browser version, route type, and error status are usually sufficient.

Implementation references: [background.js](background.js), [adapter.js](adapter.js), [file-import.js](file-import.js), [popup.js](popup.js), and [i18n.js](i18n.js). Validation scope: [VALIDATION.md](VALIDATION.md).
