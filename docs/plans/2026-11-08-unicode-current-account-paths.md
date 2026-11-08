# Bounded Unicode Windows Installation Paths

## Status

Open source compatibility finding, not implemented or runtime-verified.
Current current-account setup rejects valid Unicode profile paths before any
installation, through Assert-BrowserWakeInstallPath and browser-wake-registration.
Do not remove these guards without completing the entire identity/encoding path.

## Design

1. Separate local Unicode filesystem path validation from ASCII batch-literal
   validation. Retain local-drive, component, metacharacter, canonical-path,
   reparse, ownership and create-only checks. This is bounded Unicode support,
   not arbitrary CMD metacharacter support.
2. Preserve all existing launcher bytes when the Node executable has a safe
   ASCII absolute path. The app path is UTF-8 JSON; the actual script reference
   already uses the ASCII token "%~dp0..\device-native-host.mjs".
3. For Unicode Node paths sharing the profile prefix, consider a same-drive,
   nonempty ASCII relative suffix from the launcher directory to node.exe.
   Validate each component and exact absolute round-trip, then render a quoted
   "%~dp0<relative>". Refuse Unicode remaining in the suffix, cross-drive
   fallback, noncanonical aliases and literal CMD metacharacters.
4. Update recordedWakeNode recognition as well as preflight/publication/inspect.
   Resolve only from the launcher's directory, never CWD, and regenerate and
   compare the entire exact launcher before declaring the interpreter matched.
5. Establish explicit UTF-8 stdout or ASCII-escaped JSON for the PowerShell5.1
   registry subprocess. EncodedCommand input is not stdout-encoding evidence.
   Preserve exact REG_SZ, all hive/view checks and conflict/no-repair behavior.

Do not add CALL, START, another cmd/c, percent-star forwarding, PATH-based Node
lookup, short-name aliases, a batch BOM or chcp as a shortcut.

## Acceptance

- Actual disposable Unicode app and same-profile Unicode Node directories;
  unchanged ASCII launcher bytes and existing ASCII cross-drive behavior.
- Actual CMD/native Chromium launch from a different CWD with correct origin,
  executable/script identity and binary stdio framing. No live credentials.
- Exact recorded interpreter readback, mismatch, added-command, malformed-token,
  non-ASCII-byte, redirected-path and identity-drift rejection tests.
- Actual PowerShell5.1 Unicode registry round-trip in a unique disposable key,
  including a non-UTF-8 console code page. No production registration overwrite.
- Original unsafe-path preflight remains mutation-free. Adoption must never
  treat a valid-looking final command line as proof of an exact registered bundle.

This plan does not authorize production migration or replay settled requests.
Final implementation needs source review and RED/GREEN plus real native evidence.
