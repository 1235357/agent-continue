# Capabilities and Roadmap

Updated: 2026-11-02. Baseline: committed v2.2.0 source.

This page describes source capabilities, not store approval, publication, or the version installed in a browser. Device-control, setup/onboarding, and native-messaging candidates remain unshipped and outside this baseline; stable v2.2.0 does not request `nativeMessaging`.

## Current Capabilities

| Area | v2.2.0 behavior | Limits |
| --- | --- | --- |
| Targets and prompts | One existing ChatGPT or Your dot conversation; repeat a prompt, loop a queue, or run it once; local templates | One task at a time; at most 50 queue items and 600,000 queue characters; no attachment queue |
| Scheduling | 1-10080 minutes, default 20; interval or reply-aware timing, optional immediate first send and local-time quiet hours | No calendar, cron, weekday, named-timezone, or random schedules |
| Sending and controls | Start, pause, resume, send once, read-only checks, stop markers and confirmed-send limits; draft and detected-attachment checks | One submission mechanism per attempt; unknown results have no immediate retry but may be retried after the normal interval; pause cannot retract a dispatched submission |
| Local import | Text, Markdown, structured text, HTML, DOCX and text-based PDF; bundled local parsing | Text extraction is not layout preservation; no OCR or online conversion; see [File Formats](FILE_FORMATS.md) |
| Interface and language | English by default, optional Simplified Chinese; popup and full console, themes, countdown, templates and settings backups | Language changes do not translate user content; no cloud sync or multi-user collaboration |
| Developer support | Developer email, GitHub bug/suggestion forms, LinkedIn and installed version on the support page | Users enter browser/OS details and manually review any public report or attachment; see [Support](../.github/SUPPORT.md) |
| Diagnostics | Up to 200 local activity entries; schema 3 exports use allowlisted metadata, omit free-text messages and default to relative timings | Exact timestamps require support-page opt-in; exports do not upload automatically and are not guaranteed anonymous |
| Background operation | Does not activate the target tab or use the system clipboard; discard protection and optional idle-sleep prevention | Computer, browser and target must remain running and executable; no exact-timing, universal focus, freeze-prevention or uptime guarantee |
| Recovery | Saved task recovery only when the original target is uniquely identified; old tab IDs are not trusted | Missing targets are not opened automatically; account, page or identity changes may block sending |
| Privacy | Prompt text hidden until explicitly revealed; no developer backend or analytics telemetry | Local storage is not encrypted; authorized prompts are sent to ChatGPT under that service's policies |

## Validation Priorities

These are validation needs, not claims of completed acceptance. Existing results remain version-specific in [Validation](../VALIDATION.md).

| Priority area | Required evidence |
| --- | --- |
| Windows Chrome / Edge | Separate test profile; installation, pause shortcut, another app's foreground input, minimization and optional power permission; record exact versions |
| Long runs | Controlled synthetic or explicitly authorized 24/72-hour runs; retain successes, unknown outcomes, delays and recovery failures |
| Lifecycle | Worker suspension, extension reload, browser crash, system sleep and tab freezing; no burst catch-up or wrong-target sending |
| Document compatibility | Synthetic multi-column PDFs, embedded fonts and DOCX tables; reject failed or oversized extraction rather than silently truncate |
| Accessibility | Native keyboard and screen-reader checks, reachable pause controls, readable layouts and private text hidden by default |

## Future Candidates

These capabilities are not included in the v2.2.0 baseline. Priorities are proposals, not release or delivery commitments.

| Priority | Candidate | Acceptance condition |
| --- | --- | --- |
| P1 | Multiple concurrent targets | Independent queues and timing, global pause, correct target recovery and no duplicate dispatch from concurrency or restart races |
| P1 | Additional website adapters | Per-site consent, read-only checks, target identity and draft protection; no default all-site access |
| P1 | Calendar, cron and timezone scheduling | Explicit daylight-saving, missed-schedule, sleep and unknown-result policies; no unconditional timing promises |
| P1 | User-configurable selectors and adapter self-diagnostics | Extend existing bounded diagnostics without conversation content or ambiguous target selection |
| P2 | Template variables and chained inputs | Opt-in substitution, visible provenance and missing-value handling; preserve literal text by default |
| P2 | Context summaries and conversation migration | Explicit new-target selection, preserved constraints and recoverable pause; summaries are not original evidence |
| P2 | Image and attachment batches | Explicit attachment lifecycle, privacy and result states; never overwrite user drafts |
| P2 | Reply and result-file export | User-selected scope and local destination, separate from content-free diagnostics; no default conversation capture |
| P2 | User-controlled local encryption | Clear key and recovery model; disclose unattended decryption limits |
| P3 | Additional languages, sidebar and layout improvements | Build on existing English/Simplified Chinese support; preserve keyboard access, pause availability and private-content visibility controls |

## Historical Scope

The 2026-10-23 roadmap described v0.2.2, a Chinese-first interface and 150 local headless scenarios plus one headed-release scenario. Those are historical statements, not v2.2.0 status or a current test total. The original 20-project comparison remains in [Alternatives](../ALTERNATIVES.md); competitor claims, source inspection and runtime evidence are distinct.

## Non-Negotiable Boundaries

Background sending is not a permanent online service. UI hiding is not encryption; a visible user-message marker is not server-side exactly-once delivery, model completion or task success. Site changes can break compatibility.

New site permissions, remote services or automatic conversation creation require explicit disclosure and user control. Keep unshipped native/device work separate from stable browser capabilities and release claims.
