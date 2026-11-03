# Agent Continue

English | [简体中文](README.zh-CN.md)

Schedule your own prompts in one existing ChatGPT or Your dot conversation, with local controls to start, pause, resume, and inspect activity.

**v2.2.0 release documentation · Manifest V3 · Free and MIT-licensed**

[Chrome Web Store](https://chromewebstore.google.com/detail/jpioilmpbolfokedaefmbfbjeaahfdkl) · [GitHub Releases](https://github.com/1235357/agent-continue/releases) · [Source](https://github.com/1235357/agent-continue) · [Changelog](CHANGELOG.md) · [Privacy](PRIVACY.md)

This document describes v2.2.0 developer support, schema 3 diagnostics, and support-page error recovery, alongside the existing single-submit behavior introduced in v2.0.x. GitHub releases may ship ahead of Chrome Web Store review. Store availability and downloadable versions are determined by their respective listings; neither this README nor a GitHub release establishes store approval or the version installed in your browser.

Development is paused at the owner's request as of November 3, 2026. The
[complete development handoff](docs/DEVELOPMENT-HANDOFF.md) separates stable
releases, verified native source and pending browser candidates; it also records
the architecture, history, known limits and remaining work. A handoff archive is
not a new stable extension or an installer.

## Developer and Support

- **Developer:** Zhentong Ye
- **Email:** [zhentongye2028@u.northwestern.edu](mailto:zhentongye2028@u.northwestern.edu)
- **Project:** [1235357/agent-continue](https://github.com/1235357/agent-continue)
- **Bug reports:** [Open a GitHub issue](https://github.com/1235357/agent-continue/issues/new/choose) or [check existing issues](https://github.com/1235357/agent-continue/issues)
- **Author's LinkedIn:** [Zhentong Ye](https://www.linkedin.com/in/tony-zhentong-ye/)

Open **Developer & support** from the support link in Settings or Activity to view these contacts and the installed extension version. The page defaults to English and offers Simplified Chinese. For a bug report, manually provide the extension version, browser version, operating system, and steps to reproduce with synthetic prompts. Describe the expected and actual behavior, and select ordinary ChatGPT, Your dot, or **Not applicable / extension interface** for an interface, settings, or import problem. The separate **Suggestion** form does not require a conversation target or logs.

If diagnostics would help, manually export them from Activity or the support page and review the JSON file before sharing it. Both use schema 3, include the installed extension version, and omit stored free-text messages and unknown fields. You may attach a sanitized copy in the GitHub issue's optional diagnostics field. **GitHub issues and their attachments are public.** Remove identifying data, private prompts, conversation URLs, credentials, cookies, and documents from all report text and attachments. Do not attach configuration backups. Logs can reveal task timing and status; an export is not guaranteed to be anonymous. Exporting logs does not upload them or contact support automatically.

Logs are timestamped locally, but diagnostic exports use relative millisecond timings by default, without exact timestamps or the export time. Only the support page offers **Include exact timestamps**, off by default; the Activity export has no exact-timestamp option. Relative timings can also identify activity patterns. See [diagnostic export details and privacy limits](PRIVACY.md#diagnostic-log-export).

![English control console with synthetic demonstration data](docs/store-2.1.0-en-console.png)

The screenshot shows the v2.1.0 console with synthetic content, not a private conversation or evidence of a v2.2.0 installation.

## Install

Use the [Chrome Web Store listing](https://chromewebstore.google.com/detail/jpioilmpbolfokedaefmbfbjeaahfdkl), or select an available packaged ZIP from [GitHub Releases](https://github.com/1235357/agent-continue/releases).

For a packaged ZIP, extract it to a permanent folder, open `chrome://extensions` or `edge://extensions`, enable Developer mode, and choose **Load unpacked**. Select the `AgentContinue` folder containing `manifest.json`. Do not select the ZIP or its parent folder. Chromium 120 or later is declared in the manifest; this is not a claim that every browser/platform combination has been tested.

GitHub's automatic source archives are not prepared installation packages: PDF resources must be assembled using the repository's development instructions. See [CONTRIBUTING.md](CONTRIBUTING.md) and [VALIDATION.md](VALIDATION.md) for build and validation scope.

## Start a Task

1. Open an existing ChatGPT or Your dot conversation on `chatgpt.com`, sign in there, and wait for its composer to load.
2. Open the extension and enter a prompt or import a local file.
3. Select the target tab and review the interval and delivery settings. Defaults are a 20-minute interval, repeated use of the same prompt, no confirmed-send limit, and interruption of an active response when due.
4. Run the read-only page check, then bind the target and start. The first send waits a full interval unless you enable immediate first sending.
5. Pause from the extension or with `Ctrl+Shift+Y`. **Send once now** submits a real message; it is not a simulation.

The interface defaults to English. Select Simplified Chinese in **Settings → Language / 语言**. The preference is saved locally; switching languages does not translate your prompts, imported text, or custom labels.

Resume retains the original task's prompt, target, interval, and counters. To apply edited settings, bind and start a new task; its counters reset. Importing a document alone does not start a task or send a message.

## Current Capabilities

| Area | Behavior |
| --- | --- |
| Target | One task at a time, bound to a ChatGPT or Your dot conversation |
| Prompts | Repeat one prompt, loop a queue, or run a queue once; local templates |
| Timing | 1–10080 minutes; interval or reply-aware timing; optional local-time quiet hours |
| Controls | Start, pause, resume, send once, read-only checks, optional confirmed-send limit and stop markers |
| Page handling | Target identity checks, draft and detected-attachment checks, optional wait-for-idle behavior |
| Background operation | Does not activate the target tab or use the system clipboard |
| Local interface | English and Simplified Chinese; system, light, and dark themes; prompt text hidden until explicitly shown |
| Records | Up to 200 locally timestamped activity entries; diagnostic JSON exports default to relative timings and omit stored free-text messages |
| Support | Developer contacts, installed version, and schema 3 diagnostics; exact-timestamp export requires support-page opt-in |
| Recovery | Saved task recovery when the original target is uniquely identified; no automatic opening of a missing target |

### One Submission Mechanism per Attempt

Each attempt requires a current background permit and uses one submission mechanism. In automatic mode, Your dot uses Ctrl+Enter; ordinary ChatGPT uses a send button when found, otherwise Enter. Explicit button-only and Ctrl+Enter-only modes are also available. There is no subsequent switch to another mechanism within that attempt.

A matching new user-message marker is required for confirmation. An empty composer or a busy indicator alone is not success. If confirmation is unavailable, the result remains **unknown**, the confirmed-send count does not increase, and no immediate retry occurs. A later attempt may occur after the full normal interval. This is not exactly-once delivery: an unconfirmed message may already have reached ChatGPT. Pause and inspect the conversation when the result is uncertain. Pausing cannot retract a submission already dispatched.

### Runtime Limits

The computer and browser must be running, and the target page must remain executable and signed in. Alarm-based scheduling, background ports, and tab discard protection do not guarantee exact timing or prevent all freezing. Missed intervals are not replayed in a burst. Optional idle-sleep prevention uses the `power` permission; it does not override manual sleep or lid-close behavior.

Page changes can break compatibility. This extension sends messages; it does not extend account quotas or model context, and it does not guarantee that an agent continues working or completes a goal. Test and browser-validation records have the specific scope stated in [VALIDATION.md](VALIDATION.md), not permanent live-site acceptance.

## Local File Import

Text and Markdown files, structured text, HTML, DOCX, and text-based PDF are processed locally. HTML is reduced to text without executing its scripts; DOCX and PDF import extract text rather than preserve layout. PDF parsing uses bundled PDF.js resources, not an online converter or runtime CDN. Scanned PDFs need OCR elsewhere; legacy `.doc`, encrypted documents, and password-protected PDFs are not supported.

Limits: 5 MiB per file, 100,000 characters per prompt, 50 queue items and 600,000 queue characters in total; DOCX body XML is limited to 4 MiB and PDF import to 100 pages. Encoding detection and reading order can be imperfect. Review extracted text before using sensitive or layout-dependent documents. See [File Formats](docs/FILE_FORMATS.md).

## Privacy and Permissions

No extension account, API key, developer backend, analytics telemetry, or cloud synchronization is used. ChatGPT sign-in is still required on the target website. When you authorize sending, your prompt is submitted to ChatGPT and handled under that service's policies.

| Permission | Purpose |
| --- | --- |
| `https://chatgpt.com/*` | Identify the target, inspect its state, fill its composer, submit prompts, and recover the original target |
| `activeTab` | Access the selected tab through a user action |
| `scripting` | Run target-page checks and sending logic |
| `storage` | Store configuration, prompts, queues, templates, language, theme, logs, and recovery state locally |
| `alarms` | Wake the scheduler for due checks |
| Optional `power` | Prevent system idle sleep when explicitly enabled |

Stable v2.2.0 does not request `nativeMessaging` and does not include the unshipped device-control, setup/onboarding, or native-messaging candidates.

Local storage is not encrypted. Hiding prompt text reduces accidental on-screen exposure but is not a security boundary. Configuration exports omit prompt and queue bodies unless explicitly included. Clearing local data does not remove original files, exported files, or messages already sent to ChatGPT. See [PRIVACY.md](PRIVACY.md) for storage, deletion, and disclosure details.

## Project

Contributions: [1235357/agent-continue](https://github.com/1235357/agent-continue). Licensed under [MIT](LICENSE).
