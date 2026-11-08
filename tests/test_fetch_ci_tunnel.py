"""Offline execution of the CI downloader with synthetic archives and virtual time."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "native/desktop-commander/test-fixtures/fetch-ci-tunnel.ps1"
HARNESS = Path(__file__).with_name("fetch-ci-tunnel-fixture.ps1")
PWSH = shutil.which("pwsh")


@unittest.skipUnless(PWSH, "PowerShell 7 is required; no network fallback")
class FetchCiTunnelTests(unittest.TestCase):
    def run_fixture(self, steps, *, archive_kind="valid", digest="valid",
                    process_start_ms=0, sleep_overshoot_ms=0, github_actions="true", real_processes=False):
        with tempfile.TemporaryDirectory(prefix="ac-ci-download-test-") as directory:
            root = Path(directory)
            fixtures = root / "test-fixtures"
            fixtures.mkdir()
            source = SCRIPT.read_text(encoding="utf-8")
            # Only clock/process boundaries and real-test deadlines change, not worker/control logic.
            self.assertEqual(source.count("[Diagnostics.Process]::new()"), 1)
            source = source.replace("[Diagnostics.Process]::new()", "(New-FixtureProcess)")
            if not real_processes:
                self.assertEqual(source.count("[Diagnostics.Stopwatch]::StartNew()"), 1)
                source = source.replace("[Diagnostics.Stopwatch]::StartNew()", "(New-FixtureClock)")
            else:
                for name, old, new in (("request", 30000, 2000), ("total", 100000, 12000), ("reap", 5000, 1000)):
                    assignment = f"${name}LimitMs = {old}"
                    self.assertEqual(source.count(assignment), 1)
                    source = source.replace(assignment, f"${name}LimitMs = {new}")
            downloader = fixtures / SCRIPT.name
            downloader.write_text(source, encoding="utf-8")
            windows = os.name == "nt"
            executable = "tunnel-client-runtime" + (".exe" if windows else "")
            payload = b"synthetic non-executable fixture; never started"
            archive = root / "fixture.zip"
            if archive_kind == "corrupt":
                archive.write_bytes(b"this is not a ZIP")
            else:
                with zipfile.ZipFile(archive, "w") as zipped:
                    name = "nested/" + executable if archive_kind == "missing" else executable
                    entry = zipfile.ZipInfo(name)
                    entry.external_attr = (0o120777 if archive_kind == "symlink" else 0o100644) << 16
                    zipped.writestr(entry, b"" if archive_kind == "empty" else payload)
            pins = json.loads((SCRIPT.parent.parent / "tunnel-pins.json").read_text(encoding="utf-8"))
            pin = pins["platforms"]["win32-x64" if windows else "linux-x64"]
            pin["archiveSha256"] = hashlib.sha256(archive.read_bytes()).hexdigest()
            pin["executableSha256"] = hashlib.sha256(payload).hexdigest()
            if digest != "valid":
                pin["archiveSha256" if digest == "archive" else "executableSha256"] = "0" * 64
            (root / "tunnel-pins.json").write_text(json.dumps(pins), encoding="utf-8")
            scenario = root / "scenario.json"
            scenario.write_text(json.dumps({
                "steps": [{"durationMs": 0, **step} for step in steps],
                "archive": str(archive), "processStartMs": process_start_ms,
                "sleepOvershootMs": sleep_overshoot_ms,
                "realProcesses": real_processes,
            }), encoding="utf-8")
            env = {**os.environ, "GITHUB_ACTIONS": github_actions,
                   "RUNNER_TEMP": str(root), "GITHUB_ENV": str(root / "github-env")}
            result = subprocess.run(
                [PWSH, "-NoLogo", "-NoProfile", "-NonInteractive", "-File", str(HARNESS),
                 "-Downloader", str(downloader), "-Scenario", str(scenario)],
                env=env, text=True, encoding="utf-8", capture_output=True, timeout=25 if real_processes else 15,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stderr, "")
            observed = json.loads(result.stdout)
            for forbidden in ("PRIVATE_SIGNATURE", "redirect.invalid", "DO_NOT_LOG"):
                self.assertNotIn(forbidden, json.dumps(observed))
            self.assertLess(len("\n".join(observed["output"])), 2048)
            for line in observed["output"]:
                self.assertIsInstance(json.loads(line), dict)
                self.assertNotIn("https://", line)
            self.assertEqual(observed["remainingJobs"], 0)
            self.assertEqual(observed["remainingProcesses"], 0)
            self.assertTrue(all(observed["killTrees"]))
            self.assertTrue(all(0 <= wait <= (2000 if real_processes else 30000) for wait in observed["waits"]))
            self.assertTrue(all(0 <= wait <= (1000 if real_processes else 5000) for wait in observed["reaps"]))
            expected_uri = ("https://github.com/openai/tunnel-client/releases/download/v0.0.19/"
                            f"tunnel-client-runtime-v0.0.19-{'windows' if windows else 'linux'}-amd64.zip")
            self.assertTrue(all(call["uri"] == expected_uri for call in observed["calls"]))
            if observed["failure"]:
                self.assertEqual(observed["exported"], [])
            return observed

    def test_504_then_success_retries_same_official_source_and_clears_partial(self):
        result = self.run_fixture([{"kind": "http", "status": 504}, {"kind": "ok"}])
        self.assertIsNone(result["failure"])
        self.assertEqual(len(result["calls"]), 2)
        self.assertEqual(result["sleeps"], [2000])
        self.assertEqual(len(result["exported"]), 2)
        self.assertTrue(result["partialCleared"])
        for call in result["calls"]:
            self.assertEqual(call["timeout"], 30)
            self.assertEqual(call["operationTimeout"], 30)
            self.assertEqual(call["automaticRetries"], 0)

    def test_two_504s_then_success_use_last_allowed_attempt(self):
        result = self.run_fixture([{"kind": "http", "status": 504}] * 2 + [{"kind": "ok"}])
        self.assertIsNone(result["failure"])
        self.assertEqual(len(result["calls"]), 3)
        self.assertEqual(result["sleeps"], [2000, 4000])

    def test_permanent_http_is_not_retried(self):
        for status in (400, 401, 403, 404, 410, 422, 501, 505):
            with self.subTest(status=status):
                result = self.run_fixture([{"kind": "http", "status": status}, {"kind": "ok"}])
                self.assertIsNotNone(result["failure"])
                self.assertEqual(len(result["calls"]), 1)
                self.assertEqual(result["sleeps"], [])

    def test_transient_http_allowlist(self):
        for status in (408, 429, 500, 502, 503):
            with self.subTest(status=status):
                result = self.run_fixture([{"kind": "http", "status": status}, {"kind": "ok"}])
                self.assertIsNone(result["failure"])
                self.assertEqual(len(result["calls"]), 2)

    def test_network_and_timeout_retry_but_tls_and_io_fail_closed(self):
        retryable = ("network", "timeout", "http-network", "cancelled-timeout")
        for kind in (*retryable, "tls", "io", "http-tls", "cancelled", "other-http-io", "tls-timeout"):
            with self.subTest(kind=kind):
                result = self.run_fixture([{"kind": kind}, {"kind": "ok"}])
                self.assertEqual(len(result["calls"]), 2 if kind in retryable else 1)
                self.assertEqual(result["failure"] is None, kind in retryable)

    def test_http_request_exception_status_is_authoritative(self):
        for status in (404, 504):
            with self.subTest(status=status):
                result = self.run_fixture([{"kind": "http-status", "status": status}, {"kind": "ok"}])
                self.assertEqual(len(result["calls"]), 2 if status == 504 else 1)

    def test_response_ended_http_io_exception_is_explicitly_retryable(self):
        result = self.run_fixture([{"kind": "response-ended"}, {"kind": "ok"}])
        self.assertIsNone(result["failure"])
        self.assertEqual(len(result["calls"]), 2)

    def test_any_permanent_http_in_chain_vetoes_retry_without_status_overwrite(self):
        for statuses in ([404, 504], [504, 404], [404] + [504] * 10):
            with self.subTest(statuses=statuses):
                result = self.run_fixture([{"kind": "http-chain", "statuses": statuses}, {"kind": "ok"}])
                self.assertIsNotNone(result["failure"])
                self.assertEqual(len(result["calls"]), 1)
                self.assertIn("http_404", "".join(result["output"]))

    def test_tls_vetoes_even_retryable_http_status(self):
        result = self.run_fixture([{"kind": "tls-status", "status": 504}, {"kind": "ok"}])
        self.assertIsNotNone(result["failure"])
        self.assertEqual(len(result["calls"]), 1)

    def test_generic_io_with_timeout_remains_permanent(self):
        result = self.run_fixture([{"kind": "io-timeout"}, {"kind": "ok"}])
        self.assertIsNotNone(result["failure"])
        self.assertEqual(len(result["calls"]), 1)

    def test_attempt_limit_has_no_fourth_request_or_final_sleep(self):
        result = self.run_fixture([{"kind": "http", "status": 504}] * 4)
        self.assertIsNotNone(result["failure"])
        self.assertEqual(len(result["calls"]), 3)
        self.assertEqual(result["sleeps"], [2000, 4000])
        self.assertEqual(result["disposed"], 3)

    def test_digest_mismatch_after_retry_cannot_be_masked_by_another_download(self):
        for digest, message in (("archive", "CI archive digest mismatch."),
                                ("executable", "CI executable digest mismatch.")):
            with self.subTest(digest=digest):
                result = self.run_fixture(
                    [{"kind": "http", "status": 504}, {"kind": "ok"}, {"kind": "ok"}], digest=digest)
                self.assertEqual(result["failure"], message)
                self.assertEqual(len(result["calls"]), 2)

    def test_archive_validation_is_not_retried(self):
        for kind in ("corrupt", "missing", "empty", "symlink"):
            with self.subTest(kind=kind):
                result = self.run_fixture([{"kind": "ok"}, {"kind": "ok"}], archive_kind=kind)
                self.assertIsNotNone(result["failure"])
                self.assertEqual(len(result["calls"]), 1)

    def test_total_budget_exhausted_on_failure_or_success_never_exports(self):
        for kind in ("ok", "http"):
            with self.subTest(kind=kind):
                result = self.run_fixture([{"kind": kind, "status": 504, "durationMs": 100000}])
                self.assertIsNotNone(result["failure"])
                self.assertIn("budget", result["failure"].lower())
                self.assertEqual(len(result["calls"]), 1)
                self.assertEqual(result["sleeps"], [])

    def test_wait_timeout_is_clamped_to_remaining_total_budget(self):
        result = self.run_fixture([{"kind": "stall"}] * 3, sleep_overshoot_ms=10000)
        self.assertIsNotNone(result["failure"])
        self.assertTrue(result["waits"], "downloader must use an explicit bounded wait")
        self.assertEqual(result["waits"], [30000, 30000, 9000])
        self.assertLessEqual(result["elapsedMs"], 100000)

    def test_process_start_time_counts_against_each_attempt_timeout(self):
        result = self.run_fixture([{"kind": "stall"}] * 3, process_start_ms=5000)
        self.assertEqual(result["waits"], [25000, 25000, 24000])
        self.assertEqual(result["elapsedMs"], 95000)

    def test_sleep_overshoot_cannot_start_extra_attempt(self):
        result = self.run_fixture([{"kind": "http", "status": 504}, {"kind": "ok"}],
                                  sleep_overshoot_ms=98000)
        self.assertIn("budget", result["failure"].lower())
        self.assertEqual(len(result["calls"]), 1)

    def test_stalled_attempts_are_killed_and_reaped_with_bounded_waits(self):
        result = self.run_fixture([{"kind": "stall"}] * 4)
        self.assertIsNotNone(result["failure"])
        self.assertEqual(result["waits"], [30000, 30000, 29000])
        self.assertEqual(result["reaps"], [5000, 5000, 5000])
        self.assertEqual(result["killed"], 3)
        self.assertEqual(result["disposed"], 3)
        self.assertEqual(result["elapsedMs"], 95000)

    def test_full_five_second_reaps_and_backoff_fit_inside_total_budget(self):
        result = self.run_fixture([{"kind": "stall", "reapMs": 5000}] * 4)
        self.assertEqual(result["waits"], [30000, 30000, 19000])
        self.assertEqual(result["reaps"], [5000, 5000, 5000])
        self.assertEqual(result["elapsedMs"], 100000)
        self.assertEqual([call["timeout"] for call in result["calls"]], [30, 30, 19])
        self.assertEqual(result["sleeps"], [2000, 4000])
        self.assertIn("budget", result["failure"].lower())

    def test_exit_not_proven_after_kill_never_retries_or_exports(self):
        for kill_failure in (False, True):
            with self.subTest(kill_failure=kill_failure):
                result = self.run_fixture([
                    {"kind": "stall", "killFailure": kill_failure, "reapFailure": True}, {"kind": "ok"}])
                self.assertEqual(result["failure"], "CI download worker exit unverified.")
                self.assertEqual(len(result["calls"]), 1)
                self.assertEqual(result["reaps"], [5000])
                self.assertEqual(result["sleeps"], [])
                self.assertEqual(result["disposed"], 1)

    def test_start_overhead_clamps_wait_and_reap_to_remaining_budget(self):
        result = self.run_fixture([{"kind": "stall"}], process_start_ms=97000)
        self.assertEqual(result["waits"], [0])
        self.assertEqual(result["reaps"], [3000])
        self.assertLessEqual(result["elapsedMs"], 100000)
        self.assertIn("budget", result["failure"].lower())

    def test_reap_api_exception_is_redacted_and_exit_stays_unverified(self):
        result = self.run_fixture([{"kind": "stall", "reapThrows": True}, {"kind": "ok"}])
        self.assertEqual(result["failure"], "CI download worker exit unverified.")
        self.assertEqual(len(result["calls"]), 1)
        self.assertEqual(result["reaps"], [5000])
        self.assertEqual(result["sleeps"], [])

    def test_worker_start_exit_and_protocol_failures_are_redacted_and_permanent(self):
        for kind in ("start-failed", "worker-failed", "invalid-json"):
            with self.subTest(kind=kind):
                result = self.run_fixture([{"kind": kind}, {"kind": "ok"}])
                self.assertEqual(result["failure"], "CI download worker failed.")
                self.assertLessEqual(len(result["calls"]), 1)
                self.assertEqual(result["disposed"], 1)
                self.assertEqual(result["sleeps"], [])

    def test_non_ci_guard_still_refuses_before_any_download(self):
        result = self.run_fixture([{"kind": "ok"}], github_actions="false")
        self.assertEqual(result["calls"], [])
        self.assertEqual(result["failure"], "This downloader is for disposable GitHub-hosted CI only.")

    def test_real_child_processes_retry_504_and_return_only_sanitized_json(self):
        result = self.run_fixture([{"kind": "http", "status": 504}, {"kind": "ok"}], real_processes=True)
        self.assertIsNone(result["failure"])
        self.assertEqual(len(result["calls"]), 2)
        self.assertEqual(result["disposed"], 2)
        self.assertEqual(len(result["childPids"]), 2)
        self.assertEqual(len(result["exported"]), 2)

    def test_real_watchdog_kills_native_thread_sleep_and_descendant_without_orphans(self):
        for kind in ("stall", "thread-sleep", "thread-sleep-tree"):
            with self.subTest(kind=kind):
                start = time.monotonic()
                result = self.run_fixture([{"kind": kind}, {"kind": "http", "status": 404}], real_processes=True)
                elapsed = time.monotonic() - start
                self.assertIsNotNone(result["failure"])
                self.assertGreaterEqual(elapsed, 2)
                self.assertLess(elapsed, 12)
                self.assertEqual(result["killed"], 1)
                self.assertEqual(result["disposed"], 2)
                self.assertEqual(len(result["calls"]), 2)
                self.assertEqual(result["calls"][0]["kind"], kind)
                self.assertEqual(len(result["childPids"]), 3 if kind == "thread-sleep-tree" else 2)
                self.assertTrue(any(json.loads(line)["state"] == "timeout" for line in result["output"]))

    def test_downloader_has_no_job_or_unbounded_wait_or_runtime_execution(self):
        source = SCRIPT.read_text(encoding="utf-8")
        for forbidden in ("Start-Job", "Stop-Job", "Wait-Job", "WaitForExit()", "& $exe", "Start-Process"):
            self.assertNotIn(forbidden, source)
        self.assertIn("$process.Kill($true)", source)
        self.assertIn("$info.FileName = (Get-Process -Id $PID).Path", source)


if __name__ == "__main__":
    unittest.main()
