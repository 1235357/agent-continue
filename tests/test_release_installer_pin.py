"""Check release installer stamping without installing or downloading."""

import importlib.util
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("setup_release", ROOT / "scripts/build-setup-release.py")
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class ReleaseInstallerPinTests(unittest.TestCase):
    def test_administrator_artifact_pins_are_exact_and_not_self_referential(self):
        helper = (b"$script:acReleaseTag = ''\r\n$script:acAdministratorBundleSha256 = ''\r\n"
                  b"$script:acAdministratorStagerSha256 = ''\r\n")
        parent = b"$script:acReleaseTag = ''\r\n$script:acAdministratorInstallerSha256 = ''\r\n"
        helper = release.pin_installer(helper, "2.2.1")
        helper = release.pin_administrator_hash(helper, "acAdministratorBundleSha256", "a" * 64)
        helper = release.pin_administrator_hash(helper, "acAdministratorStagerSha256", "b" * 64)
        parent = release.pin_administrator_hash(release.pin_installer(parent, "2.2.1"),
            "acAdministratorInstallerSha256", release.sha256(helper))
        self.assertIn(b"$script:acAdministratorBundleSha256 = '" + b"a" * 64 + b"'", helper)
        self.assertIn(b"$script:acAdministratorStagerSha256 = '" + b"b" * 64 + b"'", helper)
        self.assertIn(release.sha256(helper).encode("ascii"), parent)
        self.assertNotIn(b"acAdministratorInstallerSha256", helper)

    def test_administrator_hash_pins_reject_missing_repeated_or_stamped_markers(self):
        for variable in ("acAdministratorBundleSha256", "acAdministratorStagerSha256", "acAdministratorInstallerSha256"):
            marker = f"$script:{variable} = ''".encode("ascii")
            stamped = release.pin_administrator_hash(marker, variable, "a" * 64)
            for source in (b"no marker", marker + b"\n" + marker, stamped):
                with self.subTest(variable=variable, source=source), self.assertRaisesRegex(ValueError, "administrator_hash_marker"):
                    release.pin_administrator_hash(source, variable, "a" * 64)

    def test_administrator_hash_pins_cannot_inject_or_use_untrusted_digest_names(self):
        for digest in ("", "latest", "A" * 64, "a" * 63, "a" * 64 + "\n", "';exit 0;'", None, 1):
            with self.subTest(digest=digest), self.assertRaisesRegex(ValueError, "administrator_hash_input"):
                release.pin_administrator_hash(b"$script:acAdministratorBundleSha256 = ''", "acAdministratorBundleSha256", digest)
        with self.assertRaisesRegex(ValueError, "administrator_hash_input"):
            release.pin_administrator_hash(b"$script:other = ''", "other", "a" * 64)

    def test_administrator_sidecar_uses_the_same_exact_release_stamp(self):
        original = b"# synthetic administrator wrapper, never executed\r\n$script:acReleaseTag = ''\r\n"
        stamped = release.pin_installer(original, "2.2.1")
        self.assertEqual(stamped, original.replace(b"$script:acReleaseTag = ''", b"$script:acReleaseTag = 'v2.2.1'"))
        with self.assertRaisesRegex(ValueError, "installer_release_marker"):
            release.pin_installer(stamped, "2.2.1")

    def test_official_node_pins_match_the_administrator_bundle_builder(self):
        builder = (ROOT / "scripts/build-windows-administrator-bundle.mjs").read_text(encoding="utf-8")
        for value in release.NODE_PIN.values():
            self.assertIn("'" + value + "'", builder)

    def test_current_administrator_wrapper_marker_and_sidecar_names_match(self):
        source = (ROOT / "native/bootstrap/install-administrator.ps1").read_bytes()
        version = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
        self.assertEqual(source.count(b"$script:acReleaseTag = ''"), 1)
        stamped = release.pin_installer(source, version)
        self.assertEqual(stamped, source.replace(b"$script:acReleaseTag = ''",
            f"$script:acReleaseTag = 'v{version}'".encode("ascii")))
        for name in (release.ADMIN_ARCHIVE, release.ADMIN_STAGER):
            self.assertIn(("'" + name + "'").encode("ascii"), source)
        for variable in ("acAdministratorBundleSha256", "acAdministratorStagerSha256"):
            self.assertEqual(source.count(f"$script:{variable} = ''".encode("ascii")), 1)
        parent = (ROOT / "native/bootstrap/install.ps1").read_bytes()
        self.assertEqual(parent.count(b"$script:acAdministratorInstallerSha256 = ''"), 1)

    def test_locked_ripgrep_version_and_integrity_match_the_source_runtime(self):
        lock = json.loads((ROOT / "native/desktop-commander/package-lock.json").read_text(encoding="utf-8"))
        record = lock["packages"][release.RIPGREP_PACKAGE]
        self.assertEqual(record["version"], release.RIPGREP_PIN["version"])
        self.assertEqual(record["integrity"], release.RIPGREP_PIN["integrity"])

    def test_administrator_bundle_is_required_for_the_noninstalling_combined_builder(self):
        help_result = subprocess.run([sys.executable, "-B", str(ROOT / "scripts/build-setup-release.py"), "--help"],
                                     capture_output=True, text=True, timeout=15)
        self.assertEqual(help_result.returncode, 0, help_result.stderr)
        self.assertIn("--administrator-bundle", help_result.stdout)
        self.assertIn("never install or publish", help_result.stdout)
        self.assertIn("--source-only", help_result.stdout)
        self.assertIn("required for combined delivery", help_result.stdout)

    def test_stamp_exact_release_preserves_the_rest(self):
        original = b"prefix\r\n$script:acReleaseTag = ''\r\nsuffix\r\n"
        self.assertEqual(
            release.pin_installer(original, "2.2.1"),
            b"prefix\r\n$script:acReleaseTag = 'v2.2.1'\r\nsuffix\r\n",
        )

    def test_missing_or_repeated_marker_is_rejected(self):
        for source in (b"no marker", b"$script:acReleaseTag = ''\n" * 2):
            with self.subTest(source=source), self.assertRaises(ValueError):
                release.pin_installer(source, "2.2.1")

    def test_version_cannot_inject_script_or_select_latest(self):
        for version in ("latest", "v2.2.1", "2.2", "2.2.1\n", "2.2.1';whoami;'", None, 2):
            with self.subTest(version=version), self.assertRaises(ValueError):
                release.pin_installer(b"$script:acReleaseTag = ''", version)

    @unittest.skipUnless(os.name == "nt", "Windows PowerShell fixture")
    def test_windows_resolves_the_stamped_default_without_running_installer(self):
        source = (ROOT / "native/bootstrap/install.ps1").read_bytes()
        shell = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
        with tempfile.TemporaryDirectory(prefix="ac-release-default-") as folder:
            script = Path(folder) / "install.ps1"
            for version, override, expected in (
                ("2.2.1", "", "https://github.com/1235357/agent-continue/releases/download/v2.2.1"),
                (None, "", "https://github.com/1235357/agent-continue/releases/latest/download"),
                ("2.2.1", "https://fixture.invalid/local", "https://fixture.invalid/local"),
            ):
                with self.subTest(version=version, override=override):
                    script.write_bytes(release.pin_installer(source, version) if version else source)
                    encoded_path = base64.b64encode(str(script).encode("utf-8")).decode("ascii")
                    code = f"""
$ErrorActionPreference = 'Stop'
$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{encoded_path}'))
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($p, [ref]$null, [ref]$errors)
if ($errors.Count) {{ throw 'installer_parse_failed' }}
$body = $ast.Find({{param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Get-DefaultPayloadBase'}}, $false)
$assign = $ast.Find({{param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -ceq '$script:acReleaseTag'}}, $false)
if (-not $body -or -not $assign) {{ throw 'missing_release_resolver' }}
. ([scriptblock]::Create($assign.Extent.Text))
. ([scriptblock]::Create($body.Extent.Text))
Get-DefaultPayloadBase | ConvertTo-Json -Compress
"""
                    result = subprocess.run([str(shell), "-NoLogo", "-NoProfile", "-NonInteractive",
                        "-EncodedCommand", base64.b64encode(code.encode("utf-16le")).decode("ascii")],
                        env={**os.environ, "AGENT_CONTINUE_PAYLOAD_BASE": override},
                        text=True, capture_output=True, timeout=15)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(json.loads(result.stdout), expected)

    @unittest.skipUnless(os.name == "nt", "Windows PowerShell fixture")
    def test_stamped_installer_cannot_accept_an_unverified_adjacent_source(self):
        shell = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
        with tempfile.TemporaryDirectory(prefix="ac-release-adjacent-") as folder:
            root = Path(folder)
            script = root / "install.ps1"
            script.write_bytes(release.pin_installer((ROOT / "native/bootstrap/install.ps1").read_bytes(), "2.2.1"))
            (root / "bin.mjs").write_text("throw new Error('must not run');", encoding="utf-8")
            encoded_path = base64.b64encode(str(script).encode("utf-8")).decode("ascii")
            for tag, override, apply, expected in (
                ("v2.2.1", False, True, "payload_integrity_unverified"),
                ("", False, True, "payload_integrity_unverified"),
                ("v2.2.1", True, True, "payload_integrity_unverified"),
                ("", True, True, "payload_integrity_unverified"),
                ("v2.2.1", True, False, "payload_integrity_unverified"),
                ("", False, False, "payload_integrity_unverified"),
                ("", True, False, "0"),
            ):
                with self.subTest(tag=tag, override=override, apply=apply):
                    code = f"""
$ErrorActionPreference = 'Stop'
$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{encoded_path}'))
$ast = [Management.Automation.Language.Parser]::ParseFile($p, [ref]$null, [ref]$null)
$body = $ast.Find({{param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Assert-Payload'}}, $true)
$inspection = $ast.Find({{param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Test-UnverifiedPayloadInspection'}}, $true)
. ([scriptblock]::Create($inspection.Extent.Text))
. ([scriptblock]::Create($body.Extent.Text))
$script:acPayloadRoot = Split-Path -Parent $p
$script:acReleaseTag = '{tag}'
$script:acRemote = $false
$Apply = ${str(apply).lower()}
$DeviceAction = ''
$AllowUnverifiedPayload = ${str(override).lower()}
try {{ [string](Assert-Payload) | ConvertTo-Json -Compress }}
catch {{ $_.Exception.Message | ConvertTo-Json -Compress }}
"""
                    result = subprocess.run([str(shell), "-NoLogo", "-NoProfile", "-NonInteractive",
                        "-EncodedCommand", base64.b64encode(code.encode("utf-16le")).decode("ascii")],
                        text=True, capture_output=True, timeout=15)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(json.loads(result.stdout), expected)
            self.assertEqual(sorted(path.name for path in root.iterdir()), ["bin.mjs", "install.ps1"])


if __name__ == "__main__":
    unittest.main()
