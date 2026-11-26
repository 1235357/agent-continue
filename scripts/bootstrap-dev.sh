#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "[1/5] Checking Node.js (>=22.13.0), npm, and Python 3..."
command -v node >/dev/null 2>&1 || { echo "Node.js 22.13.0+ is required." >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required." >&2; exit 1; }

echo "[2/5] Installing locked npm dependencies (npm ci --ignore-scripts)..."
npm ci --ignore-scripts

echo "[3/5] Generating verified offline PDF.js vendor assets (npm run vendor)..."
npm run vendor
npm run test:pdf-vendor

if [[ "${SKIP_PLAYWRIGHT_INSTALL:-0}" != "1" ]]; then
  echo "[4/5] Installing Playwright Chromium browser..."
  npx playwright install --with-deps chromium || npx playwright install chromium
else
  echo "[4/5] Skipping Playwright browser install (SKIP_PLAYWRIGHT_INSTALL=1)."
fi

echo "[5/5] Running baseline checks..."
npm run check
python3 -B -m unittest discover -s tests -p "test_package.py"

echo ""
echo "Dev bootstrap complete!"
echo "Load unpacked extension in Chrome -> chrome://extensions -> Load unpacked -> $REPO_ROOT"
