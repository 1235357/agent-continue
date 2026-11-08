"""Manual delivery source contracts and data-only receipt checks, never builds."""

import ast
import base64
import hashlib
import json
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import textwrap
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/verify-windows-delivery.yml"
RELEASE = ROOT / ".github/workflows/release.yml"
ASSETS = {
    "agent-continue-setup.zip", "install.ps1", "SHA256SUMS.txt",
    "agent-continue-windows-administrator-x64.zip", "install-administrator.ps1",
    "Stage-WindowsAdministratorBundle.ps1",
}
RECEIPTS = {
    "agent-continue-setup-build-receipt.json",
    "agent-continue-release-ordinary-token.json",
    "agent-continue-verification-source.json",
}
PWSH = shutil.which("pwsh")


def block(source, name, indent=0):
    prefix = " " * indent
    match = re.search(
        r"^" + prefix + re.escape(name) + r":\n(.*?)(?=^" + prefix + r"\S|\Z)",
        source, re.M | re.S,
    )
    if not match:
        raise AssertionError(f"Missing block: {name}")
    return match.group(1)


def step(source, name):
    match = re.search(
        r"^      - name: " + re.escape(name) + r"\n(.*?)(?=^      - |\Z)",
        source, re.M | re.S,
    )
    if not match:
        raise AssertionError(f"Missing step: {name}")
    return match.group(1)


def run_source(source, name):
    entry = step(source, name)
    match = re.search(r"^        run: \|\n(.*)", entry, re.M | re.S)
    if not match:
        raise AssertionError(f"Missing run block: {name}")
    return textwrap.dedent(match.group(1)).strip()


def python_functions(name):
    source = run_source(WORKFLOW.read_text(encoding="utf-8"), name)
    match = re.search(r"^@'\n(.*?)^'@ \| python -B -$", source, re.M | re.S)
    if not match:
        raise AssertionError(f"Missing Python here-string: {name}")
    module = ast.parse(match.group(1))
    functions = [node for node in module.body if isinstance(node, ast.FunctionDef)]
    namespace = {"Path": Path, "re": re, "json": json, "stat": stat, "hashlib": hashlib}
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(WORKFLOW), "exec"), namespace)
    return namespace


class VerificationWorkflowSourceTests(unittest.TestCase):
    def setUp(self):
        self.source = WORKFLOW.read_text(encoding="utf-8")
        self.release = RELEASE.read_text(encoding="utf-8")

    def test_dispatch_is_the_only_trigger_and_has_no_inputs(self):
        self.assertEqual(block(self.source, "on").strip(), "workflow_dispatch:")
        for forbidden in ("inputs:", "workflow_call:", "pull_request", "schedule:", "tags:"):
            self.assertNotIn(forbidden, self.source)

    def test_only_read_permission_and_one_fixed_windows_job(self):
        self.assertEqual(block(self.source, "permissions").strip(), "contents: read")
        self.assertEqual(self.source.count("permissions:"), 1)
        jobs = block(self.source, "jobs")
        self.assertEqual(re.findall(r"^  ([\w-]+):$", jobs, re.M), ["windows-sidecar"])
        for required in ("runs-on: windows-latest", "timeout-minutes: 20", "shell: pwsh"):
            self.assertIn(required, jobs)
        self.assertNotIn("self-hosted", jobs)

    def test_disposable_main_only_preflight_precedes_checkout_and_network(self):
        preflight = step(self.source, "Require canonical manual main and a disposable Windows x64 runner")
        for required in (
            "$IsWindows", "ProcessArchitecture", "'X64'", "$PSVersionTable.PSVersion.Major -lt 7",
            "$env:GITHUB_ACTIONS -cne 'true'", "$env:RUNNER_ENVIRONMENT -cne 'github-hosted'",
            "$env:RUNNER_OS -cne 'Windows'", "$env:RUNNER_ARCH -cne 'X64'",
            "$env:GITHUB_EVENT_NAME -cne 'workflow_dispatch'", "$env:GITHUB_REF -cne 'refs/heads/main'",
            "$env:GITHUB_REPOSITORY -cne '1235357/agent-continue'", "GITHUB_WORKFLOW_REF",
            "verify-windows-delivery.yml@refs/heads/main", "WindowsIdentity]::GetCurrent()",
            "$identity.IsSystem", "-not [Security.Principal.WindowsPrincipal]", "Administrator", "throw",
        ):
            self.assertIn(required, preflight)
        self.assertLess(self.source.index("Require canonical manual main"), self.source.index("actions/checkout@"))
        self.assertLess(self.source.index("Require canonical manual main"), self.source.index("Invoke-WebRequest"))

    def test_checkout_is_fixed_main_and_retains_release_source_byte_controls(self):
        checkout = step(self.source, "Check out canonical main")
        release_checkout = step(self.release, "Check out the tagged revision")
        for line in ("uses: actions/checkout@v7", "GIT_CONFIG_COUNT: '1'",
                     "GIT_CONFIG_KEY_0: core.autocrlf", "GIT_CONFIG_VALUE_0: 'false'",
                     "fetch-depth: 0", "persist-credentials: false"):
            self.assertIn(line, checkout)
            self.assertIn(line, release_checkout)
        self.assertIn("ref: main", checkout)
        for forbidden in ("repository:", "token:", "${{", "submodules:", "lfs:"):
            self.assertNotIn(forbidden, checkout)

    def test_source_provenance_is_checked_before_dependency_acquisition(self):
        source = step(self.source, "Verify canonical main checkout and record source")
        for required in ("verify_main_source", "refs/remotes/origin/main^{commit}", "HEAD^{commit}",
                         '"--no-replace-objects"', '"--is-shallow-repository"',
                         '"remote", "get-url", "origin"', "agent-continue-verification-source.json",
                         '"--porcelain", "--untracked-files=all"', "GITHUB_WORKFLOW_SHA"):
            self.assertIn(required, source)
        self.assertLess(self.source.index("Verify canonical main checkout"), self.source.index("npm ci"))
        self.assertNotIn("check_release_source.py", source)

    def test_node_setup_and_both_pinned_acquisitions_match_release(self):
        self.assertEqual(step(self.source, "Set up Node.js"), step(self.release, "Set up Node.js"))
        self.assertEqual(step(self.source, "Acquire the pinned official tunnel archive"),
                         step(self.release, "Acquire the pinned official tunnel archive"))
        name = "Acquire pinned Node and populate the exact runtime npm cache"
        self.assertEqual(run_source(self.source, name), run_source(self.release, name))
        acquisition = step(self.source, name)
        for required in ("NODE_PIN", "archiveSha256", "Get-FileHash", "https://nodejs.org/dist/",
                         "npm ci --ignore-scripts --no-audit --no-fund --prefix native/desktop-commander"):
            self.assertIn(required, acquisition)

    def test_adapter_is_the_only_build_and_smoke_entry_and_no_context_is_forged(self):
        build = step(self.source, "Build and smoke test through the ordinary-token CI adapter")
        self.assertEqual(self.source.count("./scripts/Invoke-WindowsReleaseOrdinaryTokenCI.ps1"), 1)
        for flag in ("-NodeArchive", "-TunnelArchive", "-NpmCache"):
            self.assertIn(flag, build)
        self.assertIn("scripts/build-setup-release.py --output dist/native-setup --administrator-bundle", build)
        self.assertLess(build.index("Invoke-WindowsReleaseOrdinaryTokenCI.ps1"),
                        build.index("scripts/build-setup-release.py"))
        for forbidden in ("build-windows-administrator-bundle.mjs", "Test-WindowsAdministratorBundleSmoke.ps1",
                          "-Mode", "-WorkRoot", "-ExpectedSid"):
            self.assertNotIn(forbidden, build)
        self.assertNotRegex(self.source, r"\$env:(?:GITHUB_|ACTIONS_|RUNNER_)\w*\s*=(?!=)")
        self.assertNotRegex(self.source, r"(?m)^\s+(?:GITHUB_|ACTIONS_|RUNNER_)\w*:")
        self.assertNotIn("GITHUB_ENV", build)
        self.assertIn("tag-only adapter", build)

    def test_builder_and_smoke_ordinary_token_guards_remain_required(self):
        adapter = (ROOT / "scripts/Invoke-WindowsReleaseOrdinaryTokenCI.ps1").read_text(encoding="utf-8")
        for name in ("build-windows-administrator-bundle.mjs", "Test-WindowsAdministratorBundleSmoke.ps1"):
            self.assertIn(name, adapter)
            source = (ROOT / "scripts" / name).read_text(encoding="utf-8")
            for required in ("IsSystem", "IsInRole", "Administrator", "ordinary_windows_token_required"):
                self.assertIn(required, source)
        for required in ("Assert-CiHost", "Assert-CiResult", "$start.Environment.Clear()", "Stop-CiAccountProcesses"):
            self.assertIn(required, adapter)

    def test_only_new_source_suite_is_selected_and_failures_are_fatal(self):
        tests = step(self.source, "Test manual verification source contracts")
        self.assertIn("python -B -m unittest discover -s tests -p test_windows_delivery_verification_workflow.py", tests)
        self.assertIn("if ($LASTEXITCODE -ne 0) { throw", tests)
        self.assertIn("-p test_windows_release_ci_runner.py -k CiWorkflowRoute", tests)
        build = step(self.source, "Build and smoke test through the ordinary-token CI adapter")
        self.assertIn("$ErrorActionPreference = 'Stop'", build)
        self.assertIn("if (-not $?) { throw", build)
        self.assertIn("if ($LASTEXITCODE -ne 0 -or $report.Count -lt 1) { throw", build)
        self.assertIn("$report[-1] | Set-Content", build)

    def test_readback_precedes_both_explicit_nonempty_artifact_uploads(self):
        verification = self.source.index("Validate exact sidecars and original build receipts")
        for name, expected, prefix in (
            ("Upload verified Windows delivery sidecars", ASSETS, "dist/native-setup/"),
            ("Upload original build receipts and source identity", RECEIPTS, "${{ runner.temp }}/"),
        ):
            upload = step(self.source, name)
            for required in ("uses: actions/upload-artifact@v4", "if-no-files-found: error", "retention-days: 14"):
                self.assertIn(required, upload)
            paths = set(re.findall(r"^            " + re.escape(prefix) + r"(\S+)$", upload, re.M))
            self.assertEqual(paths, expected)
            self.assertNotIn("*", upload)
            self.assertLess(verification, self.source.index(name))
        self.assertEqual(self.source.count("uses: actions/upload-artifact@v4"), 2)

    def test_no_external_writes_publish_credentials_or_alternate_execution_paths(self):
        for forbidden in (
            "contents: write", "packages: write", "id-token:", "secrets.", "secrets:",
            "npm publish", "npm login", "npm token", "npm install", "gh release", "gh api",
            "git push", "git tag", "create-release", "upload-release-asset", "chrome-webstore",
            "Sign-WindowsRelease", "New-LocalUser", "Add-LocalGroupMember", "-Credential",
            "-Verb RunAs", "CreateRestrictedToken", "Invoke-Expression", "Start-Process",
            "continue-on-error:", "always()", "failure()", "|| true", "workflow_call:",
            "environment:", "pull_request_target", "repository_dispatch", "workflow_run:",
        ):
            self.assertNotIn(forbidden, self.source)
        self.assertEqual(re.findall(r"(?m)^\s+uses: (.+)$", self.source), [
            "actions/checkout@v7", "actions/setup-node@v7",
            "actions/upload-artifact@v4", "actions/upload-artifact@v4",
        ])

    @unittest.skipUnless(PWSH, "PowerShell 7 required for parse-only workflow checks")
    def test_every_powershell_run_block_parses_without_execution(self):
        scripts = []
        for name in re.findall(r"^      - name: (.+)$", self.source, re.M):
            entry = step(self.source, name)
            command = re.search(r"^        run: (.+)$", entry, re.M)
            if command:
                scripts.append(run_source(self.source, name) if command.group(1) == "|" else command.group(1))
        self.assertEqual(len(scripts), 7)
        script = """
$ErrorActionPreference = 'Stop'
$scripts = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
foreach ($source in $scripts) {
    $tokens = $null; $errors = $null
    $null = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw ($errors | Out-String) }
}
'parsed'
"""
        result = subprocess.run(
            [PWSH, "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
             base64.b64encode(script.encode("utf-16le")).decode("ascii")],
            input=json.dumps(scripts), capture_output=True, text=True, timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.strip(), "parsed")


class MainSourceReceiptTests(unittest.TestCase):
    def setUp(self):
        self.verify = python_functions("Verify canonical main checkout and record source")["verify_main_source"]
        self.sha = "a" * 40
        self.environment = {
            "GITHUB_REPOSITORY": "1235357/agent-continue", "GITHUB_REF": "refs/heads/main",
            "GITHUB_EVENT_NAME": "workflow_dispatch",
            "GITHUB_WORKFLOW_REF": "1235357/agent-continue/.github/workflows/verify-windows-delivery.yml@refs/heads/main",
            "GITHUB_WORKFLOW_SHA": "b" * 40, "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1",
        }
        self.answers = {
            ("remote", "get-url", "origin"): "https://github.com/1235357/agent-continue",
            ("rev-parse", "--is-shallow-repository"): "false",
            ("rev-parse", "--verify", "HEAD^{commit}"): self.sha,
            ("rev-parse", "--verify", "refs/remotes/origin/main^{commit}"): self.sha,
            ("status", "--porcelain", "--untracked-files=all"): "",
        }

    def git(self, *arguments):
        return self.answers[arguments]

    def test_records_actual_main_commit_and_distinct_workflow_identity(self):
        receipt = self.verify(self.environment, self.git)
        self.assertEqual(receipt["repository"], "1235357/agent-continue")
        self.assertEqual(receipt["ref"], "refs/heads/main")
        self.assertEqual(receipt["commit"], self.sha)
        self.assertEqual(receipt["workflowSha"], "b" * 40)
        self.assertEqual(receipt["runId"], "123")
        self.assertEqual(receipt["runAttempt"], "1")
        self.answers[("remote", "get-url", "origin")] += ".git"
        self.assertEqual(self.verify(self.environment, self.git)["commit"], self.sha)

    def test_fork_arbitrary_ref_wrong_event_and_workflow_identity_are_rejected(self):
        for field, value in (
            ("GITHUB_REPOSITORY", "other/agent-continue"), ("GITHUB_REF", "refs/heads/topic"),
            ("GITHUB_REF", "refs/tags/v1.2.3"), ("GITHUB_EVENT_NAME", "push"),
            ("GITHUB_WORKFLOW_REF", self.environment["GITHUB_WORKFLOW_REF"].replace("main", "topic")),
            ("GITHUB_WORKFLOW_SHA", "not-a-commit"), ("GITHUB_RUN_ID", ""),
            ("GITHUB_RUN_ATTEMPT", "0"),
        ):
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                self.verify({**self.environment, field: value}, self.git)

    def test_noncanonical_shallow_dirty_or_mismatched_checkout_is_rejected(self):
        for arguments, value in (
            (("remote", "get-url", "origin"), "https://github.com/other/agent-continue"),
            (("rev-parse", "--is-shallow-repository"), "true"),
            (("rev-parse", "--verify", "HEAD^{commit}"), "c" * 40),
            (("rev-parse", "--verify", "HEAD^{commit}"), "invalid"),
            (("status", "--porcelain", "--untracked-files=all"), " M scripts/builder.mjs"),
        ):
            original = self.answers[arguments]
            try:
                self.answers[arguments] = value
                with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                    self.verify(self.environment, self.git)
            finally:
                self.answers[arguments] = original


class DeliveryReceiptReadbackTests(unittest.TestCase):
    def setUp(self):
        self.verify = python_functions("Validate exact sidecars and original build receipts")["verify_delivery"]
        temporary = tempfile.TemporaryDirectory(prefix="ac-delivery-source-test-")
        self.addCleanup(temporary.cleanup)
        self.temp = Path(temporary.name)
        self.root = self.temp / "sidecars"
        self.root.mkdir()
        self.assets = {}
        for name in sorted(ASSETS):
            data = ("synthetic, non-executable fixture: " + name).encode("ascii")
            (self.root / name).write_bytes(data)
            self.assets[name] = hashlib.sha256(data).hexdigest()
        self.bundle_name = "agent-continue-windows-administrator-x64.zip"
        (self.temp / self.bundle_name).write_bytes((self.root / self.bundle_name).read_bytes())
        self.setup = {
            "built": True, "combinedBuilt": True, "deliveryContract": "combined-public",
            "administratorBundleVerified": True, "administratorStagerPlan": True,
            "installed": False, "published": False, "assets": self.assets,
            "sha256": self.assets["agent-continue-setup.zip"],
            "administratorBundleSha256": self.assets[self.bundle_name],
        }
        self.ordinary = {
            "format": "agent-continue-release-ordinary-token-ci", "version": 1,
            "accountSid": "S-1-5-21-1-2-3-1001", "windowsToken": "standard",
            "builderPassed": True, "smokePassed": True, "sha256": self.assets[self.bundle_name],
            "installed": False, "published": False,
        }
        self.source = {
            "format": "agent-continue-windows-delivery-verification-source", "version": 1,
            "repository": "1235357/agent-continue", "ref": "refs/heads/main", "commit": "a" * 40,
            "workflowRef": "1235357/agent-continue/.github/workflows/verify-windows-delivery.yml@refs/heads/main",
            "workflowSha": "b" * 40, "runId": "123", "runAttempt": "1",
        }
        self.write_receipts()

    def write_receipts(self):
        for name, receipt in (("agent-continue-setup-build-receipt.json", self.setup),
                              ("agent-continue-release-ordinary-token.json", self.ordinary),
                              ("agent-continue-verification-source.json", self.source)):
            (self.temp / name).write_text(json.dumps(receipt), encoding="utf-8-sig")

    def test_exact_assets_and_original_nonactivating_receipts_pass(self):
        self.assertEqual(self.verify(self.root, self.temp), self.assets)

    def test_each_missing_asset_extra_asset_or_nonregular_output_fails(self):
        for name in sorted(ASSETS):
            path = self.root / name
            data = path.read_bytes()
            path.unlink()
            try:
                with self.subTest(missing=name), self.assertRaises(ValueError):
                    self.verify(self.root, self.temp)
                path.mkdir()
                with self.subTest(directory=name), self.assertRaises(ValueError):
                    self.verify(self.root, self.temp)
            finally:
                if path.is_dir():
                    path.rmdir()
                path.write_bytes(data)
        (self.root / "extra.txt").write_bytes(b"extra")
        with self.assertRaises(ValueError):
            self.verify(self.root, self.temp)

    def test_empty_or_changed_output_fails(self):
        for data in (b"", b"changed"):
            (self.root / "install.ps1").write_bytes(data)
            with self.subTest(data=data), self.assertRaises(ValueError):
                self.verify(self.root, self.temp)

    def test_setup_requires_actual_success_booleans_and_no_activation(self):
        for field in ("built", "combinedBuilt", "administratorBundleVerified", "administratorStagerPlan",
                      "installed", "published"):
            original = self.setup[field]
            try:
                for value in (not original, str(original).lower(), int(original), None):
                    self.setup[field] = value
                    self.write_receipts()
                    with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                        self.verify(self.root, self.temp)
            finally:
                self.setup[field] = original
        self.setup["deliveryContract"] = "current-account-source-only"
        self.write_receipts()
        with self.assertRaises(ValueError):
            self.verify(self.root, self.temp)

    def test_asset_receipt_inventory_and_all_hashes_are_required(self):
        for replacement in ({}, {**self.assets, "extra": "0" * 64},
                            {**self.assets, "install.ps1": "0" * 64},
                            {**self.assets, "install.ps1": "not-a-hash"}, []):
            self.setup["assets"] = replacement
            self.write_receipts()
            with self.subTest(replacement=replacement), self.assertRaises(ValueError):
                self.verify(self.root, self.temp)

    def test_bundle_and_setup_hashes_bind_all_three_readbacks(self):
        for receipt, field in ((self.setup, "sha256"), (self.setup, "administratorBundleSha256"),
                               (self.ordinary, "sha256")):
            original = receipt[field]
            try:
                receipt[field] = "0" * 64
                self.write_receipts()
                with self.subTest(field=field), self.assertRaises(ValueError):
                    self.verify(self.root, self.temp)
            finally:
                receipt[field] = original
        self.write_receipts()
        (self.temp / self.bundle_name).write_bytes(b"changed original adapter bundle")
        with self.assertRaises(ValueError):
            self.verify(self.root, self.temp)

    def test_ordinary_receipt_rejects_nonstandard_failed_activated_or_malformed_results(self):
        for field, value in (
            ("format", "other"), ("version", True), ("version", "1"), ("version", 2),
            ("accountSid", "S-1-5-18"), ("accountSid", "S-1-5-21-1-2-3-1001\n"),
            ("windowsToken", "administrator"), ("builderPassed", False), ("builderPassed", 1),
            ("smokePassed", "true"), ("smokePassed", False), ("installed", True), ("published", True),
        ):
            original = self.ordinary[field]
            try:
                self.ordinary[field] = value
                self.write_receipts()
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    self.verify(self.root, self.temp)
            finally:
                self.ordinary[field] = original

    def test_ordinary_receipt_has_an_exact_schema(self):
        for receipt in ({key: value for key, value in self.ordinary.items() if key != "smokePassed"},
                        {**self.ordinary, "extra": True}):
            (self.temp / "agent-continue-release-ordinary-token.json").write_text(json.dumps(receipt), encoding="utf-8")
            with self.subTest(receipt=receipt), self.assertRaises(ValueError):
                self.verify(self.root, self.temp)

    def test_missing_empty_invalid_or_duplicate_key_receipt_fails(self):
        path = self.temp / "agent-continue-release-ordinary-token.json"
        path.unlink()
        with self.assertRaises((ValueError, FileNotFoundError)):
            self.verify(self.root, self.temp)
        for data in ("", "[]", "null", "{", json.dumps(self.ordinary)[:-1] + ', "published":false}'):
            path.write_text(data, encoding="utf-8")
            with self.subTest(data=data), self.assertRaises(ValueError):
                self.verify(self.root, self.temp)

    def test_source_receipt_requires_canonical_main_and_valid_run_identity(self):
        for field, value in (("repository", "fork/agent-continue"), ("ref", "refs/heads/topic"),
                             ("version", True), ("workflowRef", "other"), ("workflowSha", "invalid"),
                             ("commit", "invalid"), ("runId", ""), ("runAttempt", "0")):
            original = self.source[field]
            try:
                self.source[field] = value
                self.write_receipts()
                with self.subTest(field=field), self.assertRaises(ValueError):
                    self.verify(self.root, self.temp)
            finally:
                self.source[field] = original
        self.write_receipts()
        (self.temp / "agent-continue-verification-source.json").unlink()
        with self.assertRaises(FileNotFoundError):
            self.verify(self.root, self.temp)


if __name__ == "__main__":
    unittest.main()
