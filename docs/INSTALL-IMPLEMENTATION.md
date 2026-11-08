# Install Implementation: launchers, CLI and in-extension onboarding

## Offline uninstall inspection correction (November 4)

An actual standalone PS5.1 invocation reproduced a payload HTTP request from
`-Uninstall`, despite that mode being a read-only removal plan. The corrected
entry requires adjacent local `bin.mjs` and verifies the local payload before
Node resolution. Missing inspection files produce bounded
`uninstall_inspection_unavailable`, with no payload download, Node provisioning,
installation-root write or raw local path in the error. Mutation/verify flags
cannot be combined with uninstall. The normal consented installation/download
path is unchanged. Complete local recovery inspection still requires supported
Node and remains dry-run, not an automatic uninstaller. The Windows regression
uses a loopback refusal server and owned disposable directories, not a live
installation or external download. The full root package/installer suite passes
9/9 after cold-review corrections; extracted source ZIP checks pass 2/2.
Downstream signing/native acceptance remains separate.

A present checksum list must cover the exact `bin.mjs` invoked by Node, including
its digest when a path spelling is case-folded; four ordinary Windows spellings
are accepted in both normal planning and uninstall. A private hash-observation
fixture models a case-sensitive directory; no filesystem policy was changed.
Uninstall replies are bounded, exact-case schema-checked, scalar-typed and bound
to the input root, paths and conservative step states before success is reported.
Invalid banners/results, array-valued fields and wrong-case keys were reproduced
as failures before their corrections. A complete valid plan remains accepted.
Independent re-review is bounded to this corrected installer/CLI/test scope.

The dated source-only design below is historical, not a record of real installed
native messaging or a released uninstall implementation.

Status: implemented and locally verified 2026-11-04. No registry write, no
install, no service start, no publish, no commit. Verification used only
read-only plans plus a fake-registry-free temp directory.

Design input that this file freezes:

- Chrome cannot start installers. The only honest first-run path is a command the
  user runs once (see `docs/INSTALL-DESIGN.md` §4, §6).
- The extension is the whole first-run UI: explanation, explicit consent, copy
  command, poll for the result, then an operator panel.
- Registration and other privileged steps stay in `native/bootstrap`, behind the
  existing double-consent (`consent_required`) gates.

## 1. Problem

Before this change there was no user-facing entry point: `registration-*`
modules could plan and preview, `status`/`verify` could read state, and
`Build-NativeLauncher.ps1` could compile a host launcher, but nothing produced a
command a normal user could run, nothing rendered a cross-platform command, and
the setup page ended at "export a JSON request".

## 2. Technical plan

Three entries, one shared planner.

| Entry | File | Default behaviour | Writes |
| --- | --- | --- | --- |
| PowerShell | `native/bootstrap/install.ps1` | `-Plan` (read-only): preflight, payload digest check, `install-plan` JSON | nothing |
| CMD wrapper | `native/bootstrap/install.cmd` | forwards all args to `install.ps1`, preserves exit code | nothing |
| npm bin | `cli.mjs` (`bin.agent-continue`) | `setup` prints the plan + copyable command | nothing |

Shared planner `native/bootstrap/install-plan.mjs` is browser-safe and pure:
same input produces the same bytes for the page, the CLI and the scripts. It
also owns the uninstall ordering.

Safety invariants (asserted by tests):

1. `elevation: false` in every plan; the Windows registry target is `HKCU` only
   (the string `HKLM` never appears in `install.ps1`).
2. The scripts never invoke `reg.exe`/`reg add`/`New-ItemProperty` and never use
   `Start-Process -Verb RunAs`; execution is delegated to `bin.mjs`, which keeps
   `consent_required`.
3. `-Apply` requires `-Consent accept-install` plus three explicit inputs
   (`SetupRequest`, `TunnelId`, `RuntimeKeyFile`); missing consent fails before
   any write.
4. Payload digests are checked line by line before any copy; a missing manifest
   fails `-Apply` with `payload_integrity_unverified` unless the operator passes
   `-AllowUnverifiedPayload`.
5. `finally` always restores `PATH` and the TLS setting and removes the temp
   directory.
6. Uninstall is ordered `disable-autostart → stop-runtime → unregister →
   remove-files`, and unregister refuses when the registered value does not
   equal this install root (`owned: false`).

Alternatives rejected: an MSI (needs elevation or a signing pipeline we do not
have), a bundled `.exe`-only installer (Defender classification still unresolved),
and letting the extension write the registry (impossible under the extension
permission model).

## 3. Detailed implementation

`buildInstallPlan(input)` validates: supported OS, per-OS arch set, 32-char
`[a-p]` extension id, absolute path without `..` or control characters, Node
`>= 22.13`. It returns paths, the HKCU registry descriptor (view chosen by
arch), autostart kind per OS, copy commands, and seven steps:

```
preflight → verify-payload → stage → write-manifest → register-hkcu|register-manifest → autostart → verify
```

`inspection` booleans flip the corresponding steps to `satisfied`, which makes a
second run idempotent and lets the page show progress without re-installing.

`buildUninstallPlan(input)` produces the removal order and an ownership verdict.
It is a dry-run by construction (`bin.mjs uninstall` always answers
`dryRun: true`); executing removals is intentionally still gated, because it
needs the same signed consent token as registration execution.

CLI mapping (`cli.mjs`): `setup` → plan (or `bin.mjs setup` passthrough when
`--setup-request` is given); `status|verify|install-plan|uninstall|version`
delegate to `bin.mjs`; usage errors stay short ASCII codes.

## 4. Acceptance cases actually run

| Case | Command | Result |
| --- | --- | --- |
| Planner unit suite | `node native/bootstrap/install-plan.test.mjs` | 12 pass / 0 fail |
| PowerShell syntax | `[Parser]::ParseFile('install.ps1')` | 0 parse errors |
| Windows plan, zero writes | `install.ps1 -ExtensionId a*32 -InstallDir $env:TEMP\ac-plan-<rand>` | plan JSON, `elevation:"none"`, temp dir not created |
| npm help | `node cli.mjs help` | usage, exit 0 |
| npm plan | `node cli.mjs setup --extension-id a*32` | `dryRun:true` + plan |
| npm missing id | `node cli.mjs setup` | `extension_id_required` |
| Extension UI | `npm run check && npm run test:setup` | see handoff checkpoint |

`node --test <path>` reports 0 tests when the path contains `[Develop]` (the
brackets are read as a glob), so the suite is run as `node <file>` directly.

## 5. Known limits in this round

- No macOS/Linux manifest *writer* yet; the plan and the page describe it, the
  writer module does not exist.
- Uninstall execution (file removal and `reg.exe delete`) is not wired to the
  CLI; only the dry-run plan exists.
- Payload `SHA256SUMS.txt` is not produced by the release pipeline yet, so
  `-Apply` correctly refuses until it exists.
- Signing/notarization and the Defender classification issue remain open, and
  are the reason the store build stays behind GitHub releases.
