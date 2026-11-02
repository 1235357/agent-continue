# Validation and Evidence Boundaries

## Version 2.1.0

Validation date: November 2, 2026. The release adds English-default presentation
and optional Simplified Chinese without changing the single-submission contract.

| Suite | Scenarios |
| --- | ---: |
| Localization unit/metadata | 4 |
| Background state | 18 |
| Background concurrency/recovery | 32 |
| Release adapter safety | 13 |
| Basic browser adapter | 13 |
| Dot adapter | 38 |
| Dot keyboard | 12 |
| Local file import | 16 |
| UI, including bilingual switching | 15 |
| Real isolated MV3 extension | 9 |
| Official ProseMirror/MV3 | 5 |
| Total | 175 |

The first combined run exposed two test expectations tied to the previous
Chinese default. Those assertions were updated to the English strings, retaining
the underlying no-send/start checks; the affected MV3 group then passed. Existing
Chinese-copy fixtures explicitly select Chinese, with new coverage for English
default on a Chinese browser locale and English/Chinese/English switching.
Release-source guards, syntax checks and six deterministic archive tests are
additional checks, not included in the scenario total above.

All browser fixtures use synthetic content and separate throwaway profiles.
They do not open the user's signed-in Chrome profile or read real prompts.
The language-switch scenario checks popup, desktop and narrow layouts, preserves
user-owned Chinese prompts/queue labels/chat titles, and checks that switching
does not dispatch START or SEND requests. Screenshot assets use English synthetic
labels; the store console capture is 1280 by 800 RGB PNG without alpha.

Local tests and a generated archive do not prove GitHub publication, successful
cloud CI, store submission or store approval. Those states require their own
platform receipts. Store version 2.0.1 was observed as Published - public before
preparing this update; this does not establish publication of 2.1.0.

## Runtime Limits

Confirmation means a matching new user-message marker appeared in a supported
page fixture. It does not establish successful model inference, scientific work,
exactly-once delivery or permanent compatibility with the live website. An
unknown result is not retried immediately, but the next normal interval can
attempt another send. Pause and inspect the conversation if necessary.

The target must remain executable, signed in and reachable. Background timing,
tab freezing, network failures, browser policies and site updates can affect
operation. No universal no-focus-stealing, uptime or delivery guarantee is made.

The release contains no native host, administrator broker or Linux-control
installation. Those experimental components are a separate unfinished effort.
Historical test records remain available through Git history; earlier broad
delivery guarantees must not be treated as current evidence.
