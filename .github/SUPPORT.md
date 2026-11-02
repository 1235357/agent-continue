# Agent Continue Support

**Developer: Zhentong Ye**

**Email: [zhentongye2028@u.northwestern.edu](mailto:zhentongye2028@u.northwestern.edu)**

[Project repository](https://github.com/1235357/agent-continue) | [Report a bug](https://github.com/1235357/agent-continue/issues/new/choose) | [Author's LinkedIn](https://www.linkedin.com/in/tony-zhentong-ye/)

Agent Continue is a free, MIT-licensed personal project. The university email address does not imply university endorsement or technical support.

This guide covers v2.2.0 developer support and schema 3 diagnostics. GitHub releases may ship ahead of Chrome Web Store review; this guide does not establish store approval or the version installed in your browser. Stable v2.2.0 excludes the unshipped device-control, setup/onboarding, and native-messaging candidates and does not request `nativeMessaging`.

## Report a Problem

Check [existing issues](https://github.com/1235357/agent-continue/issues) first. For a new report, include:

1. The installed extension version, browser version, and operating system.
2. Whether the target is ordinary ChatGPT, Your dot, or not applicable (for interface, settings, or import problems).
3. Reproduction steps using synthetic prompts, relevant settings, and expected versus actual behavior.
4. An optional, reviewed diagnostic JSON file exported manually from the extension.

**GitHub issues and attachments are public.** Review and sanitize every field and attachment before posting. Do not include credentials, cookies, private prompts, conversation URLs, private chat screenshots, or documents. Do not attach configuration backups. Logs can reveal activity patterns even with relative timings; anonymity is not guaranteed.

## Diagnostic Export in v2.2.0

Open **Developer & support** through the support link in Settings or Activity to view the developer contacts and installed extension version. The page defaults to English and offers Simplified Chinese. Browser and operating-system details are entered manually in the bug form, not auto-detected or added through fingerprinting. Choose **Not applicable / extension interface** for an interface, settings, or import problem.

The Activity export and the support page share schema 3. Reports include `extensionVersion`, allowlisted event/diagnostic categories, and bounded diagnostic durations, with at most 200 entries. Stored free-text messages and unknown fields are omitted. Logs remain timestamped locally, but exports default to relative milliseconds without exact timestamps or the export time. Only the support page offers **Include exact timestamps**, off by default; selecting it includes absolute Unix-millisecond event timestamps and the export time. The popup and full-console Activity export have no exact-timestamp option.

Exporting diagnostics does not upload a file, create an issue, or contact the developer. Use the controls available in your installed version and review the complete JSON file before sharing it. See the [privacy policy](https://github.com/1235357/agent-continue/blob/main/PRIVACY.md#diagnostic-log-export) for export fields and privacy limits.

## Suggestions

For general suggestions, select **Suggestion** on the [new issue page](https://github.com/1235357/agent-continue/issues/new/choose), or use the developer email. The suggestion form does not require a conversation target or logs. Contacting support does not grant access to your browser, accounts, conversations, or computer.
