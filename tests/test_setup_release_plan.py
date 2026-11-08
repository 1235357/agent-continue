"""Packaging Plan regressions: synthetic ZIP data only, no installation or registry writes."""

import ctypes
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("setup_release_plan", ROOT / "scripts/build-setup-release.py")
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)
FALSE_FLAGS = (
    "protectedFilesVerified", "administratorStateVerified", "cleanLaunchPlanVerified",
    "administratorChildVerified", "hostedBindingPrepared", "hostedLaunchPlanVerified",
    "activated", "registrationChanged", "tunnelStarted",
)
REQUIRED = (
    "runtime/node.exe", "client/tunnel-client-runtime.exe", "app/host.mjs", "app/runtime.mjs",
    "app/lifecycle.mjs", "app/profile.mjs", "app/tunnel-pins.json", "app/upstream-pin.json",
    "app/package-lock.json", "app/node_modules/@wonderwhy-er/desktop-commander/dist/server.js",
)


def plan_receipt(**changes):
    return {"ok": True, "phase": "complete", "files": len(REQUIRED), "diagnostic": "none",
            **dict.fromkeys(FALSE_FLAGS, False), **changes}


class PlanDiagnosticTests(unittest.TestCase):
    """Mock only process transport; receipts must still pass all original checks."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="ac-plan-diagnostic-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.archive = self.root / "bundle.zip"
        self.archive.write_bytes(b"not executable; subprocess is mocked")
        self.stager = self.root / release.ADMIN_STAGER
        self.shell = self.root / "Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
        self.shell.parent.mkdir(parents=True)
        self.shell.write_bytes(b"not executable; subprocess is mocked")
        for patch in (mock.patch.object(release, "WINDOWS", True),
                      mock.patch.dict(os.environ, {"SystemRoot": str(self.root / "Windows")})):
            patch.start()
            self.addCleanup(patch.stop)

    def invoke(self):
        return release.run_administrator_plan(self.stager, self.archive, "a" * 64, len(REQUIRED))

    def failure(self, stdout, *, returncode=2, stderr="", code="administrator_stager_plan_failed"):
        result = subprocess.CompletedProcess([], returncode, stdout, stderr)
        with mock.patch.object(release.subprocess, "run", return_value=result) as run:
            with self.assertRaises(ValueError) as caught:
                self.invoke()
        prefix, diagnostic = str(caught.exception).split(": ", 1)
        self.assertEqual(prefix, code)
        command = run.call_args.args[0]
        self.assertEqual(command[command.index("-Action") + 1], "Plan")
        self.assertNotIn("-Consent", command)
        self.assertEqual(run.call_count, 1)
        return json.loads(diagnostic)

    def test_failed_plan_preserves_each_data_only_phase_and_exit_status(self):
        for phase in ("input", "anchor", "archive", "layout", "complete"):
            with self.subTest(phase=phase):
                diagnostic = self.failure(json.dumps(plan_receipt(ok=False, phase=phase)))
                self.assertEqual(diagnostic, {"returncode": 2, "phase": phase, "diagnostic": "none",
                                              "receipt": "valid", "stderrPresent": False})

    def test_stderr_still_fails_closed_without_exposing_its_content(self):
        diagnostic = self.failure(json.dumps(plan_receipt()), returncode=0,
                                  stderr="private path C:\\Users\\private and credential must not escape")
        self.assertEqual(diagnostic["phase"], "complete")
        self.assertEqual(diagnostic["returncode"], 0)
        self.assertIs(diagnostic["stderrPresent"], True)
        self.assertNotIn("private", json.dumps(diagnostic))

    def test_invalid_receipts_never_echo_stdout_or_stderr(self):
        for value in ("", "private output", "[]", "null", '{"phase":"input","phase":"anchor"}',
                      '{"ok":NaN}', '{"phase":"' + "x" * release.ADMIN_METADATA_LIMIT + '"}'):
            with self.subTest(value=value[:50]):
                diagnostic = self.failure(value, stderr="private error")
                self.assertEqual(diagnostic["receipt"], "invalid")
                self.assertEqual(diagnostic["phase"], "unavailable")
                self.assertNotIn("private", json.dumps(diagnostic))

    def test_untrusted_phase_and_diagnostic_are_not_log_injection_channels(self):
        for value in ("C:\\Users\\private", "::error::forged", "anchor\nsecret", ["input"], None):
            with self.subTest(value=value):
                diagnostic = self.failure(json.dumps(plan_receipt(ok=False, phase=value, diagnostic=value)))
                self.assertEqual(diagnostic["phase"], "unrecognized")
                self.assertEqual(diagnostic["diagnostic"], "unrecognized")

    def test_zero_exit_invalid_json_is_not_a_success(self):
        diagnostic = self.failure("not JSON", returncode=0)
        self.assertEqual(diagnostic["receipt"], "invalid")

    def test_success_receipt_retains_every_false_flag_and_exact_count_check(self):
        changes = [{flag: value} for flag in FALSE_FLAGS for value in (True, None, 0, "false")]
        changes += [{"ok": False}, {"ok": 1}, {"phase": "layout"}, {"files": True}, {"files": 0}]
        for change in changes:
            with self.subTest(change=change):
                self.failure(json.dumps(plan_receipt(**change)), returncode=0,
                             code="administrator_stager_plan_receipt")

    def test_missing_false_flags_are_rejected(self):
        for flag in FALSE_FLAGS:
            with self.subTest(flag=flag):
                receipt = plan_receipt()
                del receipt[flag]
                self.failure(json.dumps(receipt), returncode=0, code="administrator_stager_plan_receipt")

    def test_timeout_is_bounded_diagnostic_and_never_retries(self):
        error = subprocess.TimeoutExpired(["private command"], 180, output=b"private output", stderr=b"private error")
        with mock.patch.object(release.subprocess, "run", side_effect=error) as run:
            with self.assertRaisesRegex(ValueError, "^administrator_stager_plan_timeout$"):
                self.invoke()
        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args.kwargs["timeout"], 180)

    def test_valid_read_only_plan_runs_once_with_canonical_archive_and_same_digest(self):
        result = subprocess.CompletedProcess([], 0, json.dumps(plan_receipt()), "")
        with mock.patch.object(release.subprocess, "run", return_value=result) as run:
            self.assertIs(self.invoke(), True)
        command = run.call_args.args[0]
        self.assertEqual(command[command.index("-Archive") + 1], str(self.archive.resolve(strict=True)))
        self.assertEqual(command[command.index("-ExpectedSha256") + 1], "a" * 64)
        self.assertEqual(run.call_count, 1)

    def test_redirected_archive_is_not_hidden_by_path_normalization(self):
        with mock.patch.object(release.Path, "is_symlink", return_value=True), \
                mock.patch.object(release.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "administrator_input_redirected"):
                self.invoke()
        run.assert_not_called()

    def test_cli_preserves_bounded_failure_without_a_success_receipt(self):
        failure = release.administrator_plan_error("administrator_stager_plan_failed",
            subprocess.CompletedProcess([], 2, "", ""), plan_receipt(ok=False, phase="anchor"))
        with mock.patch("sys.argv", ["build-setup-release.py", "--output", str(self.root / "absent")]), \
                mock.patch.object(release, "build_release", side_effect=failure), \
                mock.patch("builtins.print") as printed:
            with self.assertRaises(SystemExit) as caught:
                release.main()
        self.assertEqual(str(caught.exception), str(failure))
        self.assertIn('"phase":"anchor"', str(caught.exception))
        printed.assert_not_called()
        self.assertFalse((self.root / "absent").exists())


@unittest.skipUnless(os.name == "nt", "Native Windows PowerShell 5.1 read-only Plan")
class WindowsPlanPathTests(unittest.TestCase):
    """Execute only the unchanged repository stager's Plan action on inert ZIP data."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="ac-plan-long-directory-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve(strict=True)
        self.archive = self.root / release.ADMIN_ARCHIVE
        with zipfile.ZipFile(self.archive, "w") as archive:
            for name in REQUIRED:
                archive.writestr(name, b"synthetic, not executable\n")
        self.digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.shell = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"

    def short_path(self, path):
        function = ctypes.WinDLL("kernel32", use_last_error=True).GetShortPathNameW
        function.argtypes = (ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint32)
        function.restype = ctypes.c_uint32
        buffer = ctypes.create_unicode_buffer(32768)
        length = function(str(path), buffer, len(buffer))
        if not 0 < length < len(buffer):
            self.fail(f"GetShortPathNameW failed: {ctypes.get_last_error()}")
        short = Path(buffer.value)
        if str(short).casefold() == str(path).casefold():
            self.skipTest("This test volume has no 8.3 alias; no short-name reproduction claimed")
        return short

    def raw_plan(self, stager, archive, digest=None):
        return subprocess.run([str(self.shell), "-NoLogo", "-NoProfile", "-NonInteractive",
                               "-File", str(stager), "-Action", "Plan", "-Archive", str(archive),
                               "-ExpectedSha256", digest or self.digest],
                              capture_output=True, text=True, timeout=30)

    def stager(self, newline):
        source = (ROOT / "scripts" / release.ADMIN_STAGER).read_bytes().replace(b"\r\n", b"\n")
        if newline == "crlf":
            source = source.replace(b"\n", b"\r\n")
        stager = self.root / (newline + ".ps1")
        stager.write_bytes(source)
        return stager

    def test_native_plan_long_path_accepts_both_lf_and_crlf(self):
        for newline in ("lf", "crlf"):
            with self.subTest(newline=newline):
                result = self.raw_plan(self.stager(newline), self.archive)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(result.stderr, "")
                receipt = json.loads(result.stdout)
                self.assertIs(receipt["ok"], True)
                self.assertEqual(receipt["phase"], "complete")
                self.assertEqual(receipt["files"], len(REQUIRED))
                for flag in FALSE_FLAGS:
                    self.assertIs(receipt[flag], False)

    def test_native_plan_short_archive_alias_is_input_failure_before_fix(self):
        short = self.short_path(self.archive)
        self.assertEqual(short.resolve(strict=True), self.archive)
        result = self.raw_plan(self.stager("lf"), short)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        receipt = json.loads(result.stdout)
        self.assertIs(receipt["ok"], False)
        self.assertEqual(receipt["phase"], "input")
        for flag in FALSE_FLAGS:
            self.assertIs(receipt[flag], False)

    def test_wrapper_normalizes_short_temp_parent_without_bypassing_plan(self):
        short_parent = self.short_path(self.root)
        for newline in ("lf", "crlf"):
            with self.subTest(newline=newline):
                stager = self.stager(newline)
                self.assertIs(release.run_administrator_plan(
                    short_parent / stager.name, short_parent / self.archive.name,
                    self.digest, len(REQUIRED)), True)

    def test_existing_short_alias_reaches_archive_checks_only_after_normalization(self):
        # Read an existing license with a deliberately wrong hash. Never change
        # filesystem policy or create a short-name alias to make the test pass.
        license_file = Path(os.environ["ProgramFiles"]) / "Git/LICENSE.txt"
        if not license_file.is_file():
            self.skipTest("Git license unavailable for the existing short-name witness")
        license_file = license_file.resolve(strict=True)
        try:
            release.regular_input(license_file, release.ADMIN_ARCHIVE_LIMIT)
        except ValueError:
            self.skipTest("Existing license is not a regular single-link witness")
        short = self.short_path(license_file)
        stager = self.stager("lf")
        short_result = self.raw_plan(stager, short, "0" * 64)
        long_result = self.raw_plan(stager, license_file, "0" * 64)
        self.assertEqual(short_result.returncode, 2)
        self.assertEqual(json.loads(short_result.stdout)["phase"], "input")
        self.assertEqual(long_result.returncode, 2)
        self.assertEqual(json.loads(long_result.stdout)["phase"], "archive")
        with self.assertRaises(ValueError) as caught:
            release.run_administrator_plan(stager, short, "0" * 64, len(REQUIRED))
        code, details = str(caught.exception).split(": ", 1)
        self.assertEqual(code, "administrator_stager_plan_failed")
        self.assertEqual(json.loads(details)["phase"], "archive")

    def test_real_archive_hash_failure_is_exposed_and_not_retried(self):
        with self.assertRaises(ValueError) as caught:
            release.run_administrator_plan(self.stager("lf"), self.archive, "0" * 64, len(REQUIRED))
        code, details = str(caught.exception).split(": ", 1)
        self.assertEqual(code, "administrator_stager_plan_failed")
        self.assertEqual(json.loads(details)["phase"], "archive")


class PlanWorkflowContractTests(unittest.TestCase):
    def test_manual_and_release_test_diagnostics_before_building(self):
        command = "python -B -m unittest discover -s tests -p test_setup_release_plan.py"
        refusal = "if ($LASTEXITCODE -ne 0) { throw 'Setup release Plan diagnostics contracts failed' }"
        for name in ("verify-windows-delivery.yml", "release.yml"):
            with self.subTest(workflow=name):
                source = (ROOT / ".github/workflows" / name).read_text(encoding="utf-8")
                self.assertEqual(source.count(command), 1)
                self.assertIn(command + "\n          " + refusal, source)
                self.assertLess(source.index(command), source.index("- name: Acquire pinned Node"))


if __name__ == "__main__":
    unittest.main()
