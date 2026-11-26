# Agent Continue Development Setup & Colleague Onboarding

This guide lets any contributor clone [agent-continue](https://github.com/1235357/agent-continue), set up a reproducible Windows / macOS / Linux development environment in minutes, load the unpacked Chrome/Edge MV3 extension, run fast verification suites, and ship GitHub / Chrome Web Store releases safely.

## Prerequisites

- **Node.js `22.13.0+`** and `npm`
- **Python 3** (`3.10+` recommended) for packaging (`scripts/package.py`) and release sanity checks
- **Git** with full history (non-shallow checkout for `scripts/check_release_source.py`)
- Optional for native Windows tunnel / Desktop Commander development: Windows 10/11 + OpenSSH Client

## One-Command Bootstrap

### Windows (PowerShell)

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-dev.ps1
```

Optional flags:
- `-SkipPlaywrightInstall` if Chromium is already cached
- `-RunFullTests` to execute the full `npm test` suite at the end

### macOS / Linux

```bash
bash scripts/bootstrap-dev.sh
```

What bootstrap does automatically:
1. Installs locked dependencies via `npm ci --ignore-scripts`.
2. Builds and SHA-256-verifies offline PDF.js assets via `npm run vendor` and `npm run test:pdf-vendor`.
3. Installs Playwright Chromium (`npx playwright install chromium`).
4. Runs `npm run check` and `python -B -m unittest discover -s tests -p "test_package.py"`.

## Loading the Unpacked Extension Locally

1. Open `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**.
2. Click **Load unpacked** and select the repository root directory.
   > **Note:** Ignore or keep personal keys out of Chrome Store packages. Never commit `native/dev/*.pem`, `private/prompt.txt`, `.env`, or exported session dumps.
3. After pulling or modifying extension files, click **Reload** on the extension card and verify the active version in `manifest.json`.

## VS Code / Editor Integration

Committed workspace files:
- [`.editorconfig`](../.editorconfig) — UTF-8 / LF / CRLF rules aligned with `.gitattributes`
- [`.vscode/extensions.json`](../.vscode/extensions.json) — recommended ESLint, Python, PowerShell, Playwright, EditorConfig plugins
- [`.vscode/settings.json`](../.vscode/settings.json) — workspace exclusions for generated caches (`vendor/pdfjs`, `dist`, `.artifacts`, `node_modules`)
- [`.vscode/tasks.json`](../.vscode/tasks.json) — one-click tasks for Bootstrap, Syntax/Unit Check, Dot & Opt-In Browser Suites, Full `npm test`, and Packaging

## Fast Development vs. Full Verification Matrix

| Scope | Command | Typical Time | When to Run |
| --- | --- | --- | --- |
| Syntax & Core Unit Checks | `npm run check` | ~3s | Every JS/i18n/HTML edit |
| Approval / Dot Opt-In / Dialog Classifier | `node --test tests/editor-commit-tests.mjs tests/approval-boundary-tests.mjs tests/auto-allow-optin-tests.mjs tests/dialog-classifier-tests.mjs tests/delivery-diagnostics-tests.mjs` | ~5s | Any change to `adapter.js`, `content.js`, `config.js`, `dialog-classifier.js` |
| Dot Adapter & Popup UI Suites | `node tests/dot-adapter-tests.mjs && node tests/ui-v2-tests.mjs` | ~25s | Composer/DOM/popup changes |
| Real MV3 Chromium Extension E2E | `node tests/mv3-integration-tests.mjs` | ~25s | Lifecycle / service worker / MV3 changes |
| Background Scheduler State Machine | `node --test tests/background-v2-tests.mjs` | ~120s | Scheduler / alarm / recovery changes |
| Packaging & Public Docs Policy | `python -B -m unittest discover -s tests -p "test_package.py" && node --test tests/public-documentation-tests.mjs` | ~55s | Doc, asset, or release changes |
| Windows Preview Extension ZIP | `python -B scripts/package.py --windows-preview` | ~5s | Before loading/sharing local ZIP |
| Full Headed CI Suite (Linux) | `xvfb-run -a env TEST_HEADED=1 npm test` | ~15–25m | Full release validation in CI |

## Architecture Map & Handoff Context

- **Latest handoff**: [docs/handoffs/2026-11-26-v3.3.5-HANDOFF.md](handoffs/2026-11-26-v3.3.5-HANDOFF.md)
- **Colleague quick prompt**: [docs/handoffs/COLLEAGUE-PROMPT.zh-CN.md](handoffs/COLLEAGUE-PROMPT.zh-CN.md)
- **Dot full-delegation prompt templates**: [docs/prompts/FULL-DELEGATION-DOT-PROMPT.md](prompts/FULL-DELEGATION-DOT-PROMPT.md)
- **Windows direct tunnel & Desktop Commander notes**: [docs/WINDOWS-DIRECT-TUNNEL-SSH-ARCHITECTURE.md](WINDOWS-DIRECT-TUNNEL-SSH-ARCHITECTURE.md)

## Release Tagging Checklist (GitHub Releases First, Chrome Web Store Second)

1. Update `manifest.json` (`MAJOR.MINOR.PATCH`) and add a `## [X.Y.Z]` section in `CHANGELOG.md`.
2. Verify clean git status and run all relevant tests + `python -B -m unittest discover -s tests -p "test_package.py"`.
3. Commit and push to `origin/main` **first** (`scripts/check_release_source.py` enforces first-parent ancestry on `origin/main`).
4. Create tag `vX.Y.Z`, run `python -B scripts/check_release_source.py vX.Y.Z`, and push the tag (`git push origin vX.Y.Z`) to trigger GitHub Actions release builds.
5. Chrome Web Store submissions (`https://chrome.google.com/u/0/webstore/devconsole`) may trail GitHub Releases until store review clears.
