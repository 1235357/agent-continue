# Bounded Unicode Windows Installation Paths

## Status

Implemented source candidate with bounded local verification, not an installed
or publicly released update. The previous PowerShell/path rules rejected valid
Unicode profiles. An actual PowerShell5.1 CP437 child also corrupted Unicode
registry readback; explicit no-BOM UTF-8 output now preserves the exact value.
The path and ownership checks were retained, not removed.

## Design

1. Separate local Unicode filesystem path validation from ASCII batch-literal
   validation. Retain local-drive, component, metacharacter, canonical-path,
   reparse, ownership and create-only checks. This is bounded Unicode support,
   not arbitrary CMD metacharacter support.
2. Preserve all existing launcher bytes when the Node executable has a safe
   ASCII absolute path. The app path is UTF-8 JSON; the actual script reference
   already uses the ASCII token "%~dp0..\device-native-host.mjs".
3. For Unicode Node paths sharing the profile prefix, use a same-drive,
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

## Verification Scope

- Path/helper tests reproduced Unicode refusal and same-byte launcher identity
  replacement before the fix, then30/30 passed. Parent registry/helper/adoption/
  dispatch suite independently passed51/51 in27.683s. The PowerShell extracted
  input/adoption fixture passed44 checks; it does not install a device.
- Registry tests ran actual Windows PowerShell5.1 with isolated CP437 consoles
  and both32/64 registry views. The exact Chinese/accent/emoji value, REG_SZ kind,
  UTF-8 bytes, no BOM, no-overwrite and exact disposable-key removal were checked.
- The added Chromium test first failed both Unicode cases against old source,
  then the worker's full startup file passed6/6. It uses the unchanged generated
  CMD, a different browser CWD, exact executable/script/origin/stdio assertions,
  and a verified signed installed Node binary plus its exact copied bytes.
  Native framing is real; the echo host and old startup tunnel core are fixtures.
- Independent review reproduced distinct Kelvin-sign and ASCII-k executable
  paths falsely matching after Unicode case folding. File identity comparison
  and rechecks now reject that false match; actual pre-fix RED replay failed,
  then helper31/31 and independent combined52/52 passed. Parent52/52 passed
  in28.683s. Real executable/resolver behavior uses explicit provider/profile/
  registry doubles, not a live installation.
- Parent startup Chromium6/6 passed52.335s after the identity fix, including
  both Unicode cases; admin Chromium2/2 separately passed6.414s. Neither these
  tests nor source publication establishes fresh hosted installation,
  administrator whole-browser recovery or Store acceptance.
