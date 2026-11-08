"""Release source contracts and disposable sidecar transport checks; no publishing."""

import ast
import importlib.util
import json
from pathlib import Path
import re
import stat
import tempfile
import unittest
from unittest import mock
import zipfile


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/release.yml"
ASSETS = {
    "agent-continue-setup.zip", "install.ps1", "SHA256SUMS.txt",
    "agent-continue-windows-administrator-x64.zip", "install-administrator.ps1",
    "Stage-WindowsAdministratorBundle.ps1",
}


def job(source, name):
    match = re.search(r"^  " + re.escape(name) + r":\n(.*?)(?=^  [\w-]+:|\Z)", source, re.M | re.S)
    if not match:
        raise AssertionError(f"Missing job: {name}")
    return match.group(1)


def step(source, name):
    match = re.search(r"^      - name: " + re.escape(name) + r"\n(.*?)(?=^      - |\Z)", source, re.M | re.S)
    if not match:
        raise AssertionError(f"Missing step: {name}")
    return match.group(1)


def verifier_source(source):
    block = step(job(source, "release"), "Verify downloaded Windows sidecar closure")
    match = re.search(r"python3 -B - <<'PY'\n(.*?)^          PY$", block, re.M | re.S)
    if not match:
        raise AssertionError("Missing executable sidecar verification block")
    return "\n".join(line[10:] for line in match.group(1).splitlines())


class WindowsReleaseWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.source = WORKFLOW.read_text(encoding="utf-8")

    def test_control_ledger_step_budget_preserves_individual_fixture_limits(self):
        source = (ROOT / ".github/workflows/native-runtime-tests.yml").read_text(encoding="utf-8")
        core = job(source, "core")
        block = step(core, "Verify read-only control projections, durable IDs and native-to-PowerShell contract")
        timeout = int(re.search(r"^        timeout-minutes: (\d+)$", block, re.M).group(1))
        self.assertEqual(timeout, 20)
        self.assertGreater(timeout * 60, 17 * 60 + 10)
        self.assertIn("if: runner.os == 'Windows'", block)
        self.assertIn("working-directory: .", block)
        self.assertIn("run: npm run test:admin-control-ledger", block)
        job_timeout = re.search(r"^    timeout-minutes: (\d+)$", core, re.M)
        if job_timeout:
            self.assertGreaterEqual(int(job_timeout.group(1)), timeout)
        fixture = (ROOT / "tests/windows-admin-control-ledger-tests.mjs").read_text(encoding="utf-8")
        self.assertIn("const windows = { skip: process.platform !== 'win32', timeout: 65_000 };", fixture)
        self.assertIn("    timeout: 60_000,", fixture)
        self.assertIn("timeout: 10_000,", fixture)

    def test_standalone_zip_refusals_run_once_before_expensive_native_phases(self):
        source = (ROOT / ".github/workflows/native-runtime-tests.yml").read_text(encoding="utf-8")
        core = job(source, "core")
        name = "Verify standalone installer ZIP after extraction"
        self.assertEqual(core.count("- name: " + name), 1)
        self.assertEqual(step(core, name).strip(), "working-directory: .\n        run: python tests/setup-release-tests.py")
        self.assertLess(core.index("uses: actions/setup-python@v6"), core.index("- name: " + name))
        self.assertLess(core.index("- name: " + name), core.index("- name: Verify pinned download retries"))
        self.assertLess(core.index("- name: " + name), core.index("- name: Verify read-only control projections"))

    def test_complete_protocol_fixture_runs_early_without_duplicate_or_weakened_bounds(self):
        source = (ROOT / ".github/workflows/native-runtime-tests.yml").read_text(encoding="utf-8")
        core = job(source, "core")
        acquire = "Acquire pinned official runtime for isolated protocol fixtures"
        windows = "Windows packaged manager IPC and official tunnel loopback exchange"
        linux = "Generated-profile exchange in the disposable CI runner"
        for name in (acquire, windows, linux):
            self.assertEqual(core.count("- name: " + name), 1)
        self.assertLess(core.index("- name: " + acquire), core.index("- name: " + windows))
        self.assertLess(core.index("- name: " + windows), core.index("- name: Verify pinned download retries"))
        block = step(core, windows)
        self.assertIn("timeout-minutes: 7", block)
        self.assertIn("$env:TUNNEL_CLIENT_TEST_PACKAGED = '1'", block)
        self.assertIn("node --test --test-concurrency=1 tunnel.test.mjs", block)
        self.assertNotIn("--test-skip", block)
        self.assertNotIn("--test-name-pattern", block)
        self.assertIn("if ($LASTEXITCODE -ne 0)", block)

    def test_current_account_protocol_fixtures_explicitly_request_source_only_bundles(self):
        source = (ROOT / "native/desktop-commander/tunnel.test.mjs").read_text(encoding="utf-8")
        calls = re.findall(r"await run\(python, \[([^\n]*'[^'\n]*build-setup-release\.py'[^\n]*)\]", source)
        self.assertEqual(len(calls), 2)
        for call in calls:
            self.assertIn("'--source-only'", call)
            self.assertIn("'--output', release", call)

    def test_guided_protocol_uses_canonical_fixture_paths_and_runs_before_long_bootstrap(self):
        fixture = (ROOT / "native/desktop-commander/tunnel.test.mjs").read_text(encoding="utf-8")
        self.assertIn("fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'agentcontinue-tunnel-')))", fixture)
        source = (ROOT / ".github/workflows/native-runtime-tests.yml").read_text(encoding="utf-8")
        core = job(source, "core")
        name = "Windows guided install, cold CMD provisioning, and pause over loopback"
        self.assertEqual(core.count("- name: " + name), 1)
        self.assertLess(core.index("- name: Windows packaged manager"), core.index("- name: " + name))
        self.assertLess(core.index("- name: " + name), core.index("- name: Verify pinned download retries"))
        block = step(core, name)
        self.assertIn("timeout-minutes: 8", block)
        self.assertIn("$env:TUNNEL_CLIENT_TEST_GUIDED_CMD_COLD = '1'", block)
        self.assertIn("--test-name-pattern=guided-installer tunnel.test.mjs", block)
        self.assertIn("if ($LASTEXITCODE -ne 0)", block)

    def test_native_bootstrap_phases_cover_each_original_file_once_with_bounded_children(self):
        ordinary = (ROOT / ".github/workflows/native-runtime-tests.yml").read_text(encoding="utf-8")
        core = job(ordinary, "core")
        for event in ("push", "pull_request"):
            trigger = re.search(r"^  " + event + r":\n(.*?)(?=^  [\w-]+:|\Z)", ordinary, re.M | re.S)
            self.assertIsNotNone(trigger)
            self.assertIn("      - 'tests/test_windows_release_workflow.py'", trigger.group(1))
        groups = {
            "Zero-dependency bootstrap and pinned client acquisition":
                ["bootstrap.test.mjs", "client-acquisition.test.mjs"],
            "Zero-dependency browser control and device setup":
                ["browser-control.test.mjs", "device-setup.test.mjs"],
            "Official assets and installed-tarball acquisition":
                ["official-assets.test.mjs", "packed.test.mjs", "../../tests/setup-model-tests.mjs"],
        }
        seen = []
        for name, expected in groups.items():
            block = step(core, name)
            self.assertIn("timeout-minutes: 8", block)
            self.assertIn("shell: pwsh", block)
            self.assertIn("working-directory: native/bootstrap", block)
            self.assertIn("$env:AGENT_CONTINUE_REAL_CACHE = (npm config get cache).Trim()", block)
            self.assertIn("$env:AGENT_CONTINUE_OFFICIAL_CLIENT = '1'", block)
            self.assertIn("if ($LASTEXITCODE -ne 0)", block)
            command = re.findall(r"^          node --test --test-concurrency=1 (.+)$", block, re.M)
            self.assertEqual(len(command), 1)
            files = command[0].split()
            self.assertEqual(files, expected)
            self.assertNotIn("--test-skip", block)
            seen.extend(files)
        self.assertEqual(len(seen), 7)
        self.assertEqual(len(set(seen)), 7)

    def test_current_account_continuation_is_in_regular_and_native_checks(self):
        ordinary = (ROOT / ".github/workflows/native-runtime-tests.yml").read_text(encoding="utf-8")
        for event in ("push", "pull_request"):
            trigger = re.search(r"^  " + event + r":\n(.*?)(?=^  [\w-]+:|\Z)", ordinary, re.M | re.S)
            self.assertIsNotNone(trigger)
            for item in ("current-account-setup.js", "tests/current-account-*"):
                self.assertIn("      - '" + item + "'", trigger.group(1))
        entry = step(job(ordinary, "core"), "Verify fresh current-account setup with local fixtures only")
        scripts = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["scripts"]
        self.assertIn("npm run test:current-account-setup", scripts["test:setup"])
        for fixture in ("current-account-setup-tests.mjs", "current-account-native-protocol-tests.mjs",
                        "current-account-setup-integration-tests.mjs", "current-account-installer-runner-tests.mjs"):
            self.assertIn("../../tests/" + fixture, entry)
            self.assertIn("tests/" + fixture, scripts["test:current-account-setup"])

    def test_offline_payload_fixture_changes_trigger_native_checks(self):
        ordinary = (ROOT / ".github/workflows/native-runtime-tests.yml").read_text(encoding="utf-8")
        for event in ("push", "pull_request"):
            with self.subTest(event=event):
                trigger = re.search(r"^  " + event + r":\n(.*?)(?=^  [\w-]+:|\Z)", ordinary, re.M | re.S)
                self.assertIsNotNone(trigger)
                self.assertIn("      - 'tests/windows-offline-payload-tests.mjs'", trigger.group(1))

    def test_pinned_publisher_checkout_rule_changes_trigger_native_checks(self):
        attributes = (ROOT / ".gitattributes").read_text(encoding="ascii")
        self.assertIn("native/bootstrap/native-publishers.json text eol=lf", attributes.splitlines())
        ordinary = (ROOT / ".github/workflows/native-runtime-tests.yml").read_text(encoding="utf-8")
        for event in ("push", "pull_request"):
            trigger = re.search(r"^  " + event + r":\n(.*?)(?=^  [\w-]+:|\Z)", ordinary, re.M | re.S)
            self.assertIsNotNone(trigger)
            self.assertIn("      - '.gitattributes'", trigger.group(1))

    def test_public_npm_gate_receives_original_builder_receipt_and_keeps_the_real_tarball_case(self):
        windows = job(self.source, "windows-sidecar")
        upload = step(windows, "Upload the original Windows build receipt")
        self.assertIn("agent-continue-windows-build-receipt", upload)
        self.assertIn("agent-continue-setup-build-receipt.json", upload)
        release = job(self.source, "release")
        self.assertIn("Download the original Windows build receipt", release)
        for name in ("Verify actual npm delivery package", "Build matching npm CLI archive"):
            entry = step(release, name)
            self.assertIn("AGENT_CONTINUE_WINDOWS_RELEASE_DIR", entry)
            self.assertIn("AGENT_CONTINUE_WINDOWS_RELEASE_RECEIPT", entry)
            self.assertNotIn("skip-pattern", entry)
        ordinary = (ROOT / ".github/workflows/native-runtime-tests.yml").read_text(encoding="utf-8")
        self.assertIn('test-skip-pattern "^actual root npm tarball contains verified payload and a runnable CLI$"', ordinary)
        self.assertIn("release.yml runs it without this exclusion", ordinary)

    def test_windows_job_is_read_only_x64_and_checks_the_tagged_source(self):
        windows = job(self.source, "windows-sidecar")
        for text in ("runs-on: windows-latest", "contents: read", "fetch-depth: 0",
                     "persist-credentials: false", "actions/checkout@v7", "actions/setup-node@v7",
                     "architecture: x64", "package-manager-cache: false"):
            self.assertIn(text, windows)
        self.assertLess(windows.index("scripts/check_release_source.py"), windows.index("npm ci"))
        self.assertIn("test_windows_release_workflow.py", windows)

    def test_windows_checkout_preserves_the_same_source_bytes_as_linux(self):
        windows = job(self.source, "windows-sidecar")
        checkout = step(windows, "Check out the tagged revision")
        self.assertIn("GIT_CONFIG_COUNT: '1'", checkout)
        self.assertIn("GIT_CONFIG_KEY_0: core.autocrlf", checkout)
        self.assertIn("GIT_CONFIG_VALUE_0: 'false'", checkout)

    def test_disposable_host_preflight_allows_admin_parent_not_a_guard_bypass(self):
        windows = job(self.source, "windows-sidecar")
        preflight = step(windows, "Require a disposable GitHub-hosted Windows x64 runner")
        for text in ("WindowsIdentity]::GetCurrent()", "IsSystem", "IsInRole", "Administrator",
                     "ProcessArchitecture", "RUNNER_ENVIRONMENT", "github-hosted", "throw"):
            self.assertIn(text, preflight)
        self.assertIn("-not [Security.Principal.WindowsPrincipal]", preflight)
        self.assertLess(windows.index("Require a disposable"), windows.index("actions/checkout@v7"))
        self.assertLess(windows.index("Require a disposable"), windows.index("Invoke-WebRequest"))
        for forbidden in ("New-LocalUser", "-Credential", "-Verb RunAs", "CreateRestrictedToken", "Invoke-Expression"):
            self.assertNotIn(forbidden, windows)

    def test_ci_adapter_is_the_only_builder_and_smoke_entry(self):
        windows = job(self.source, "windows-sidecar")
        build = step(windows, "Build and smoke test the reviewed Windows x64 administrator runtime")
        self.assertIn("./scripts/Invoke-WindowsReleaseOrdinaryTokenCI.ps1", build)
        for flag in ("-NodeArchive", "-TunnelArchive", "-NpmCache"):
            self.assertIn(flag, build)
        self.assertNotIn("node scripts/build-windows-administrator-bundle.mjs", build)
        self.assertNotIn("-File scripts/Test-WindowsAdministratorBundleSmoke.ps1", build)
        self.assertIn("test_windows_release_ci_runner.py", windows)
        self.assertLess(build.index("Invoke-WindowsReleaseOrdinaryTokenCI.ps1"), build.index("scripts/build-setup-release.py"))

    def test_existing_builder_cli_and_lock_are_used_without_guard_bypasses(self):
        windows = job(self.source, "windows-sidecar")
        adapter = (ROOT / "scripts/Invoke-WindowsReleaseOrdinaryTokenCI.ps1").read_text(encoding="utf-8")
        self.assertIn("scripts/build-windows-administrator-bundle.mjs", adapter)
        for flag in ("--node-archive", "--tunnel-archive", "--npm-cache", "--out"):
            self.assertIn(flag, adapter)
        self.assertIn("native/desktop-commander", windows)
        self.assertIn("npm ci --ignore-scripts --no-audit --no-fund", windows)
        self.assertIn("fetch-ci-tunnel.ps1", windows)
        self.assertIn("archiveSha256", windows)
        self.assertIn("Get-FileHash", windows)
        self.assertIn("scripts/Test-WindowsAdministratorBundleSmoke.ps1", adapter)
        for relative in ("scripts/build-windows-administrator-bundle.mjs", "scripts/Test-WindowsAdministratorBundleSmoke.ps1"):
            guarded = (ROOT / relative).read_text(encoding="utf-8")
            for marker in ("IsSystem", "IsInRole", "Administrator", "ordinary_windows_token_required"):
                self.assertIn(marker, guarded)
        self.assertIn("scripts/build-setup-release.py --output dist/native-setup", windows)
        self.assertIn("--administrator-bundle", windows)
        self.assertNotIn("scripts/build-setup-release.py --output", job(self.source, "release"))

    def test_windows_readback_checks_success_plan_and_nonactivation_before_upload(self):
        windows = job(self.source, "windows-sidecar")
        readback = step(windows, "Validate setup build receipt and sidecar inventory")
        for field in ("built", "combinedBuilt", "deliveryContract", "administratorBundleVerified", "administratorStagerPlan", "installed", "published"):
            self.assertIn(field, readback)
        for text in ("Compare-Object", "-CaseSensitive", "Get-FileHash", "SHA256SUMS.txt",
                     "GITHUB_OUTPUT", "sidecar-sha256"):
            self.assertIn(text, readback)
        self.assertLess(windows.index("Validate setup build receipt"), windows.index("actions/upload-artifact@v4"))

    def test_upload_lists_exactly_the_six_required_assets(self):
        upload = step(job(self.source, "windows-sidecar"), "Upload verified Windows sidecars")
        self.assertIn("uses: actions/upload-artifact@v4", upload)
        self.assertIn("if-no-files-found: error", upload)
        paths = set(re.findall(r"^            dist/native-setup/(\S+)$", upload, re.M))
        self.assertEqual(paths, ASSETS)
        self.assertNotIn("*", upload)

    def test_release_depends_on_and_downloads_only_this_jobs_artifact(self):
        release = job(self.source, "release")
        self.assertIn("needs: windows-sidecar", release)
        download = step(release, "Download verified Windows sidecars")
        self.assertIn("uses: actions/download-artifact@v4", download)
        self.assertIn("name: agent-continue-windows-release-sidecars", download)
        self.assertIn("path: dist/native-setup", download)
        for option in ("run-id:", "repository:", "merge-multiple:", "pattern:"):
            self.assertNotIn(option, download)
        check = step(release, "Verify downloaded Windows sidecar closure")
        self.assertIn("${{ needs.windows-sidecar.outputs.sidecar-sha256 }}", check)
        self.assertLess(release.index("Download verified Windows"), release.index("Verify downloaded Windows"))
        self.assertLess(release.index("Verify downloaded Windows"), release.index("gh release create"))
        self.assertIn("verify_administrator_bundle", check)

    def test_release_uploads_the_exact_sidecars_and_preserves_ordinary_assets(self):
        create = step(job(self.source, "release"), "Create the GitHub Release without replacing assets")
        command = create.split('gh release create "$RELEASE_TAG"', 1)[1]
        self.assertEqual(set(re.findall(r"dist/native-setup/([^\s\\]+)", command)), ASSETS)
        for text in ('"$archive"', '"$store"', "dist/SHA256SUMS", "dist/npm-cli/*.tgz",
                     "dist/npm-cli/NPM-SHA256SUMS.txt", "--verify-tag"):
            self.assertIn(text, command)
        self.assertIn("Existing release or draft must be reconciled", create)
        self.assertIn("if ! existing=", create)
        self.assertIn("verify_distribution_pair", self.source)

    def test_notes_separate_extension_install_from_optional_runtime(self):
        self.assertIn("No Node.js or build tools are required to install the extension", self.source)
        self.assertIn("Optional Windows x64 device runtime", self.source)
        self.assertIn("Node.js", self.source)
        self.assertIn("Windows consent", self.source)
        self.assertIn("standard-account", self.source)

    def test_public_windows_extension_and_npm_use_verified_combined_delivery(self):
        release = job(self.source, "release")
        package = step(release, "Package the loadable extension")
        self.assertIn("scripts/package.py --windows-release", package)
        self.assertNotIn("scripts/package.py --store", package)
        npm = step(release, "Build matching npm CLI archive")
        self.assertIn("AGENT_CONTINUE_WINDOWS_RELEASE_DIR", npm)
        self.assertIn("dist/native-setup", npm)
        self.assertLess(release.index("Verify downloaded Windows sidecar closure"),
                        release.index("Verify actual npm delivery package"))

    def test_no_custom_launcher_signing_mutable_upload_or_ignored_failures(self):
        for forbidden in ("Build-NativeLauncher", "Build-ReleaseNativeLauncher", "NativeLauncher.cs",
                          "Sign-WindowsRelease", "AGENT_CONTINUE_WINDOWS_LAUNCHER", "--clobber",
                          "gh release upload", "continue-on-error:", "if: always()", "|| true"):
            self.assertNotIn(forbidden, self.source)


class SidecarReadbackTests(unittest.TestCase):
    """Execute the workflow verifier, mocking only the separate runtime-closure validator."""

    def setUp(self):
        source = verifier_source(WORKFLOW.read_text(encoding="utf-8"))
        module = ast.parse(source)
        functions = [node for node in module.body if isinstance(node, ast.FunctionDef)]
        self.assertTrue(any(node.name == "verify_windows_sidecars" for node in functions))
        spec = importlib.util.spec_from_file_location("setup_release", ROOT / "scripts/build-setup-release.py")
        self.release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.release)
        namespace = {"json": json, "Path": Path, "re": re,
                     "stat": stat, "zipfile": zipfile, "release": self.release}
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(WORKFLOW), "exec"), namespace)
        self.verify = namespace["verify_windows_sidecars"]
        temporary = tempfile.TemporaryDirectory(prefix="ac-workflow-sidecars-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.runtime = mock.patch.object(self.release, "verify_administrator_bundle", return_value=1).start()
        self.addCleanup(mock.patch.stopall)
        version = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
        bundle = self.root / self.release.ADMIN_ARCHIVE
        bundle.write_bytes(b"synthetic runtime transport fixture, never executable")
        stager = (ROOT / "scripts" / self.release.ADMIN_STAGER).read_bytes()
        helper = self.release.pin_installer((ROOT / "native/bootstrap" / self.release.ADMIN_INSTALLER).read_bytes(), version)
        helper = self.release.pin_administrator_hash(helper, "acAdministratorBundleSha256", self.release.file_digest(bundle))
        helper = self.release.pin_administrator_hash(helper, "acAdministratorStagerSha256", self.release.sha256(stager))
        parent = self.release.pin_installer((ROOT / "native/bootstrap/install.ps1").read_bytes(), version)
        parent = self.release.pin_administrator_hash(parent, "acAdministratorInstallerSha256", self.release.sha256(helper))
        self.payload = {"install.ps1": parent, self.release.ADMIN_INSTALLER: helper,
                        self.release.ADMIN_STAGER: stager, "bin.mjs": b"// synthetic source\n"}
        self.write_source_zip()

    def write_source_zip(self):
        inner = "".join(f"{self.release.sha256(data)}  {name}\n" for name, data in self.payload.items())
        with zipfile.ZipFile(self.root / "agent-continue-setup.zip", "w") as archive:
            for name, data in self.payload.items():
                archive.writestr(name, data)
            archive.writestr("SHA256SUMS.txt", inner)
        for name in ("install.ps1", self.release.ADMIN_INSTALLER, self.release.ADMIN_STAGER):
            (self.root / name).write_bytes(self.payload[name])
        self.sums = inner + "".join(f"{self.release.file_digest(self.root / name)}  {name}\n" for name in (
            "agent-continue-setup.zip", self.release.ADMIN_ARCHIVE))
        self.write_sums(self.sums)

    def write_sums(self, sums):
        path = self.root / "SHA256SUMS.txt"
        path.write_text(sums, encoding="ascii", newline="\n")
        self.expected = self.release.file_digest(path)

    def test_matching_transport_reaches_the_real_runtime_validation_boundary(self):
        self.verify(self.root, self.expected, ROOT)
        self.runtime.assert_called_once()

    def test_missing_or_extra_asset_fails_closed(self):
        for name in sorted(ASSETS):
            with self.subTest(missing=name):
                path = self.root / name
                original = path.read_bytes()
                path.unlink()
                try:
                    with self.assertRaisesRegex(ValueError, "sidecar_inventory"):
                        self.verify(self.root, self.expected, ROOT)
                finally:
                    path.write_bytes(original)
        (self.root / "unexpected.txt").write_bytes(b"extra")
        with self.assertRaisesRegex(ValueError, "sidecar_inventory"):
            self.verify(self.root, self.expected, ROOT)
        self.runtime.assert_not_called()

    def test_changed_download_or_missing_job_digest_fails_closed(self):
        for digest in ("", "0" * 64, "A" * 64, self.expected + "\n"):
            with self.subTest(digest=digest), self.assertRaisesRegex(ValueError, "sidecar_digest"):
                self.verify(self.root, digest, ROOT)
        (self.root / "install.ps1").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "sidecar_checksum"):
            self.verify(self.root, self.expected, ROOT)
        self.runtime.assert_not_called()

    def test_duplicate_malformed_or_traversing_checksum_is_rejected(self):
        for suffix in (self.sums.splitlines()[0] + "\n", "not a checksum\n", "0" * 64 + "  ../escape\n"):
            with self.subTest(suffix=suffix):
                self.write_sums(self.sums + suffix)
                with self.assertRaisesRegex(ValueError, "sidecar_checksum"):
                    self.verify(self.root, self.expected, ROOT)
        self.runtime.assert_not_called()

    def test_corrupted_source_zip_is_hashed_before_parsing(self):
        (self.root / "agent-continue-setup.zip").write_bytes(b"corrupted archive")
        with self.assertRaisesRegex(ValueError, "sidecar_checksum_download"):
            self.verify(self.root, self.expected, ROOT)
        self.runtime.assert_not_called()

    def test_forged_manifest_cannot_replace_the_embedded_installer(self):
        self.payload["install.ps1"] += b"# changed but rehashed\n"
        self.write_source_zip()
        with self.assertRaisesRegex(ValueError, "sidecar_installer_pin"):
            self.verify(self.root, self.expected, ROOT)
        self.runtime.assert_not_called()

    def test_runtime_closure_failure_is_not_swallowed(self):
        self.runtime.side_effect = ValueError("administrator_bundle_source_or_runtime_mismatch")
        with self.assertRaisesRegex(ValueError, "administrator_bundle_source_or_runtime_mismatch"):
            self.verify(self.root, self.expected, ROOT)


if __name__ == "__main__":
    unittest.main()
