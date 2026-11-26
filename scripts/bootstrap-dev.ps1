#requires -Version 5.1
<#
.SYNOPSIS
One-command local development environment bootstrap for Agent Continue on Windows.
Installs locked npm packages, generates verified offline PDF.js assets, installs Playwright Chromium,
verifies syntax/unit/package checks, and prints unpacked Chrome loading instructions.
#>
[CmdletBinding()]
param(
    [switch]$SkipPlaywrightInstall,
    [switch]$RunFullTests
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $RepoRoot
try {
    Write-Host "[1/5] Checking Node.js (>=22.13.0), npm, and Python 3..."
    $nodeVersionRaw = (& node -v).Trim()
    if (-not $nodeVersionRaw) { throw "Node.js 22.13.0+ is required." }
    $nodeVersion = [Version]($nodeVersionRaw.TrimStart('v') -replace '-.*$', '')
    if ($nodeVersion -lt [Version]'22.13.0') {
        throw "Found Node $nodeVersionRaw; please upgrade to Node.js 22.13.0+."
    }
    $pyCmd = if (Get-Command py -ErrorAction SilentlyContinue) { @('py', '-3') }
             elseif (Get-Command python -ErrorAction SilentlyContinue) { @('python') }
             elseif (Get-Command python3 -ErrorAction SilentlyContinue) { @('python3') }
             else { throw "Python 3 is required for packaging and unit tests." }

    Write-Host "[2/5] Installing locked npm dependencies (npm ci --ignore-scripts)..."
    & npm ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }

    Write-Host "[3/5] Generating verified offline PDF.js vendor assets (npm run vendor)..."
    & npm run vendor
    if ($LASTEXITCODE -ne 0) { throw "npm run vendor failed with exit code $LASTEXITCODE" }

    & npm run test:pdf-vendor
    if ($LASTEXITCODE -ne 0) { throw "test:pdf-vendor failed with exit code $LASTEXITCODE" }

    if (-not $SkipPlaywrightInstall) {
        Write-Host "[4/5] Installing Playwright Chromium browser..."
        & npx playwright install chromium
        if ($LASTEXITCODE -ne 0) { throw "Playwright Chromium install failed with exit code $LASTEXITCODE" }
    } else {
        Write-Host "[4/5] Skipping Playwright browser install (-SkipPlaywrightInstall)."
    }

    Write-Host "[5/5] Running baseline verification..."
    & npm run check
    if ($LASTEXITCODE -ne 0) { throw "npm run check failed with exit code $LASTEXITCODE" }

    & $pyCmd[0] @($pyCmd[1..($pyCmd.Length - 1)] + @('-B', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_package.py'))
    if ($LASTEXITCODE -ne 0) { throw "test_package.py failed with exit code $LASTEXITCODE" }

    if ($RunFullTests) {
        & npm test
        if ($LASTEXITCODE -ne 0) { throw "npm test failed with exit code $LASTEXITCODE" }
    }

    Write-Host ""
    Write-Host "Dev bootstrap complete!" -ForegroundColor Green
    Write-Host "Load unpacked extension in Chrome/Edge:"
    Write-Host "  1. Open chrome://extensions and enable Developer mode."
    Write-Host "  2. Click 'Load unpacked' and select:"
    Write-Host "     $RepoRoot"
    Write-Host "  (Note: Do NOT commit personal prompts in private/ or keys in native/dev/.)"
} finally {
    Pop-Location
}
