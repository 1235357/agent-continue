"""Exercise the extracted setup ZIP without installing or registering a host."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import shutil
import stat
import sys
import tempfile
import time
import unittest
from unittest import mock
import warnings
import zipfile

REPO = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("setup_release", REPO / "scripts/build-setup-release.py")
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class AdministratorSetupReleaseTests(unittest.TestCase):
    """Synthetic archive fixtures, never runnable runtimes or installation proof."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ac-admin-release-fixture-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.payload = {name: b"synthetic source\n" for name in (
            "install.cmd", "bin.mjs", "Prepare-ReleaseNative.ps1", "native-publishers.json",
            "registration-execution.mjs", "registration-writer.mjs", "registry-win.mjs",
            "browser-wake-registration.mjs")}
        self.payload["install.ps1"] = (b"$script:acReleaseTag = ''\n"
                                       b"$script:acAdministratorInstallerSha256 = ''\n"
                                       b"# synthetic installer, never executed\n")
        self.members = {"runtime/node.exe": b"synthetic Node, not executable",
                        "client/tunnel-client-runtime.exe": b"synthetic tunnel, not executable"}
        provider = "app/node_modules/@wonderwhy-er/desktop-commander/"
        provider_files = {"package.json": b'{"name":"@wonderwhy-er/desktop-commander","version":"0.3.1"}',
                          "dist/server.js": b"throw new Error('synthetic fixture must not execute');\n"}
        self.members.update({provider + name: data for name, data in provider_files.items()})
        tree = [[name, len(data), self.digest(data)] for name, data in sorted(provider_files.items())]
        self.node_pin = {"version": "22.23.4", "archiveSha256": "a" * 64,
                         "executableSha256": self.digest(self.members["runtime/node.exe"])}
        self.tunnel_pin = {"asset": "tunnel-client-runtime-v0.0.19-windows-amd64.zip",
                           "archiveSha256": "b" * 64,
                           "executableSha256": self.digest(self.members["client/tunnel-client-runtime.exe"]),
                           "spdxSha256": self.digest(b"synthetic SPDX")}
        runtime = {name: b"// synthetic runtime, never executed\n" for name in
                   ("host.mjs", "runtime.mjs", "lifecycle.mjs", "profile.mjs", "extra-runtime.mjs")}
        runtime.update({
            "package-lock.json": b'{"lockfileVersion":3}',
            "tunnel-pins.json": self.encode({"release": "v0.0.19", "platforms": {"win32-x64": self.tunnel_pin}}),
            "upstream-pin.json": self.encode({"name": "@wonderwhy-er/desktop-commander", "version": "0.3.1",
                "files": len(tree), "treeSha256": self.digest(self.encode(tree).rstrip(b"\n"))}),
        })
        self.payload.update({"payload/" + name: data for name, data in runtime.items()})
        self.members.update({"app/" + name: data for name, data in runtime.items()})
        self.payload["payload-manifest.json"] = self.encode({"files": [
            {"path": name, "bytes": len(data), "sha256": self.digest(data)} for name, data in sorted(runtime.items())]})
        for name in ("windows-admin-owner.mjs", "windows-admin-browser-host.mjs", "windows-admin-demand.mjs",
                     "windows-admin-intent.mjs", "windows-owner-job.cs", "windows-admin-browser-session.mjs",
                     "windows-browser-peer.cs", "windows-browser-peer.ps1"):
            data = ("synthetic source for " + name + "\n").encode("ascii")
            self.write(self.repo / "native/desktop-commander" / name, data)
            self.members["app/" + name] = data
        notices = "app/third-party-notices/"
        for name in ("node-LICENSE.txt", "openai-LICENSE", "openai-NOTICE",
                     "openai-tunnel-client-runtime-v0.0.19-windows-amd64-licenses.txt"):
            self.members[notices + name] = b"synthetic notice, not upstream license evidence\n"
        self.members[notices + "openai-tunnel-client-runtime-v0.0.19-windows-amd64.spdx.json"] = b"synthetic SPDX"
        self.members[notices + "agent-continue-LICENSE.txt"] = b"synthetic repository license\n"
        self.write(self.repo / "LICENSE", self.members[notices + "agent-continue-LICENSE.txt"])
        self.version = "3.0.0"
        self.write(self.repo / "manifest.json", self.encode({"version": self.version}))
        self.write(self.repo / "native/bootstrap/install-administrator.ps1",
                   b"$script:acReleaseTag = ''\n$script:acAdministratorBundleSha256 = ''\n"
                   b"$script:acAdministratorStagerSha256 = ''\n# synthetic helper, never executed\n")
        self.write(self.repo / "scripts/Stage-WindowsAdministratorBundle.ps1",
                   (REPO / "scripts/Stage-WindowsAdministratorBundle.ps1").read_bytes())
        hashes = {name: self.digest(data) for name, data in self.members.items()}
        self.evidence = {
            "format": "agent-continue-windows-administrator-build", "version": 1,
            "sourcePayloadSha256": self.digest(self.payload["payload-manifest.json"]),
            "npmLockSha256": hashes["app/package-lock.json"],
            "windowsAdministratorOwnerSha256": hashes["app/windows-admin-owner.mjs"],
            "windowsAdministratorBrowserHostSha256": hashes["app/windows-admin-browser-host.mjs"],
            "windowsAdministratorDemandSha256": hashes["app/windows-admin-demand.mjs"],
            "windowsAdministratorIntentSha256": hashes["app/windows-admin-intent.mjs"],
            "windowsAdministratorJobSourceSha256": hashes["app/windows-owner-job.cs"],
            "windowsAdministratorBrowserSessionSources": {name: hashes["app/" + name] for name in
                ("windows-admin-browser-session.mjs", "windows-browser-peer.cs", "windows-browser-peer.ps1")},
            "node": self.node_pin, "provider": "0.3.1", "tunnel": "v0.0.19",
            "tunnelExecutableSha256": self.tunnel_pin["executableSha256"],
            "tunnelArchiveSha256": self.tunnel_pin["archiveSha256"],
        }
        self.members["app/agent-continue-build-evidence.json"] = self.encode(self.evidence)
        self.archive = self.root / "synthetic.zip"

    @staticmethod
    def digest(data):
        return hashlib.sha256(data).hexdigest()

    @staticmethod
    def encode(value):
        return (json.dumps(value, separators=(",", ":")) + "\n").encode("ascii")

    @staticmethod
    def write(path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def archive_fixture(self, extras=()):
        with warnings.catch_warnings(), zipfile.ZipFile(self.archive, "w") as archive:
            warnings.simplefilter("ignore", UserWarning)
            for name, data in list(self.members.items()) + list(extras):
                if isinstance(name, str):
                    member = zipfile.ZipInfo(name)
                    # Preserve adversarial names that Windows ZipInfo normally normalizes.
                    member.filename = member.orig_filename = name
                else:
                    member = name
                archive.writestr(member, data)
        return self.archive

    def verify(self):
        with mock.patch.object(release, "NODE_PIN", self.node_pin):
            return release.verify_administrator_bundle(self.archive, self.payload, self.repo)

    def package(self, command, **kwargs):
        self.assertEqual(command[0], "node")
        stage = Path(command[command.index("--output") + 1])
        for name, data in self.payload.items():
            self.write(stage / name, data)
        return subprocess.CompletedProcess(command, 0)

    def build_combined(self, output, report=None):
        with mock.patch.object(release.subprocess, "run", side_effect=self.package), \
                mock.patch.object(release, "NODE_PIN", self.node_pin), \
                mock.patch.object(release, "run_administrator_plan", return_value=True), \
                mock.patch("sys.stdout", report if report is not None else io.StringIO()) as report:
            release.build_release(self.repo, output, self.archive)
        return json.loads(report.getvalue())

    def test_default_combined_requires_bundle_before_packaging_or_output(self):
        output = self.root / "missing-bundle"
        with mock.patch.object(release.subprocess, "run", side_effect=self.package) as package, \
                mock.patch("sys.stdout", new_callable=io.StringIO) as report:
            with self.assertRaisesRegex(ValueError, "combined_administrator_bundle_required"):
                release.build_release(self.repo, output)
        package.assert_not_called()
        self.assertEqual(report.getvalue(), "")
        self.assertFalse(output.exists())

    def test_combined_receipt_requires_exact_six_asset_closure(self):
        self.archive_fixture()
        output = self.root / "combined"
        receipt = self.build_combined(output)
        expected = {"agent-continue-setup.zip", "install.ps1", release.ADMIN_INSTALLER,
                    release.ADMIN_STAGER, release.ADMIN_ARCHIVE, "SHA256SUMS.txt"}
        self.assertEqual({path.name for path in output.iterdir()}, expected)
        self.assertEqual(receipt["deliveryContract"], "combined-public")
        self.assertIs(receipt["combinedBuilt"], True)
        self.assertEqual(receipt["releaseTag"], "v" + self.version)
        self.assertEqual(receipt["assets"], {name: self.digest((output / name).read_bytes()) for name in expected})
        self.assertIs(receipt["installed"], False)
        self.assertIs(receipt["published"], False)

    def test_combined_without_windows_reports_unavailable_plan_but_still_verifies_bundle(self):
        self.archive_fixture()
        output = self.root / "unverified-plan"
        with mock.patch.object(release.subprocess, "run", side_effect=self.package), \
                mock.patch.object(release, "NODE_PIN", self.node_pin), \
                mock.patch.object(release, "WINDOWS", False), \
                mock.patch("sys.stdout", new_callable=io.StringIO) as report:
            release.build_release(self.repo, output, self.archive)
        receipt = json.loads(report.getvalue())
        self.assertIs(receipt["administratorStagerPlan"], False)
        self.assertIs(receipt["administratorBundleVerified"], True)
        self.assertIs(receipt["combinedBuilt"], True)

    def test_missing_or_duplicate_installer_pins_never_create_combined_output(self):
        helper_path = self.repo / "native/bootstrap" / release.ADMIN_INSTALLER
        helper = helper_path.read_bytes()
        cases = [("parent", b"$script:acReleaseTag = ''"),
                 ("parent", b"$script:acAdministratorInstallerSha256 = ''"),
                 ("helper", b"$script:acReleaseTag = ''"),
                 ("helper", b"$script:acAdministratorBundleSha256 = ''"),
                 ("helper", b"$script:acAdministratorStagerSha256 = ''")]
        parent = self.payload["install.ps1"]
        self.archive_fixture()
        for index, (target, marker) in enumerate(cases):
            for duplicate in (False, True):
                with self.subTest(target=target, marker=marker, duplicate=duplicate):
                    original = parent if target == "parent" else helper
                    changed = original + marker if duplicate else original.replace(marker, b"# missing pin")
                    self.payload["install.ps1"] = changed if target == "parent" else parent
                    helper_path.write_bytes(changed if target == "helper" else helper)
                    output = self.root / f"bad-pin-{index}-{duplicate}"
                    with self.assertRaisesRegex(ValueError, "installer_release_marker|administrator_hash_marker"):
                        self.build_combined(output)
                    self.assertFalse(output.exists())

    def test_each_missing_or_changed_final_asset_suppresses_combined_success(self):
        self.archive_fixture()
        names = ("agent-continue-setup.zip", "install.ps1", release.ADMIN_INSTALLER,
                 release.ADMIN_STAGER, release.ADMIN_ARCHIVE, "SHA256SUMS.txt")
        original_open = zipfile.ZipFile
        original_read = zipfile.ZipFile.read
        for index, name in enumerate(names):
            for mutation in ("missing", "changed"):
                with self.subTest(name=name, mutation=mutation):
                    output = self.root / f"bad-output-{index}-{mutation}"
                    mutated = False

                    def read_then_mutate(bundle, member, *args, **kwargs):
                        nonlocal mutated
                        data = original_read(bundle, member, *args, **kwargs)
                        if not mutated and Path(bundle.filename).parent == output and member == "SHA256SUMS.txt":
                            mutated = True
                            target = output / name
                            if mutation == "missing":
                                target.unlink()
                            else:
                                target.write_bytes(target.read_bytes() + b"tampered")
                        return data

                    # Corrupt the completed outputs during the existing final ZIP readback.
                    # No payload, installer, runtime or protected state is executed here.
                    with mock.patch.object(original_open, "read", new=read_then_mutate), \
                            mock.patch("sys.stdout", new_callable=io.StringIO) as report:
                        with self.assertRaises((ValueError, OSError, zipfile.BadZipFile)):
                            self.build_combined(output, report=report)
                    self.assertTrue(mutated)
                    self.assertEqual(report.getvalue(), "")

    def test_source_only_cannot_accept_an_administrator_bundle(self):
        self.archive_fixture()
        output = self.root / "ambiguous"
        with mock.patch.object(release.subprocess, "run") as package:
            with self.assertRaisesRegex(ValueError, "source_only_administrator_bundle_forbidden"):
                release.build_release(self.repo, output, self.archive, combined=False)
        package.assert_not_called()
        self.assertFalse(output.exists())

    def test_final_readback_rejects_incorrect_generated_pins(self):
        self.archive_fixture()
        pin_hash = release.pin_administrator_hash
        for variable in ("acAdministratorInstallerSha256", "acAdministratorBundleSha256",
                         "acAdministratorStagerSha256"):
            with self.subTest(variable=variable):
                def wrong_hash(source, name, digest):
                    return pin_hash(source, name, "0" * 64 if name == variable else digest)

                with mock.patch.object(release, "pin_administrator_hash", side_effect=wrong_hash), \
                        mock.patch("sys.stdout", new_callable=io.StringIO) as report:
                    with self.assertRaisesRegex(ValueError, "combined_release_pin_mismatch"):
                        self.build_combined(self.root / variable, report=report)
                self.assertEqual(report.getvalue(), "")
        pin_tag = release.pin_installer
        with mock.patch.object(release, "pin_installer", side_effect=lambda source, version: pin_tag(source, "9.9.9")), \
                mock.patch("sys.stdout", new_callable=io.StringIO) as report:
            with self.assertRaisesRegex(ValueError, "combined_release_pin_mismatch: acReleaseTag"):
                self.build_combined(self.root / "wrong-tag", report=report)
        self.assertEqual(report.getvalue(), "")

    def test_exact_inner_and_outer_checksums_and_source_bytes_are_required(self):
        self.archive_fixture()
        output = self.root / "checksum-readback"
        receipt = self.build_combined(output)
        with zipfile.ZipFile(output / "agent-continue-setup.zip") as archive:
            members = {name: archive.read(name) for name in archive.namelist()}
        payload = {name: data for name, data in members.items() if name != "SHA256SUMS.txt"}
        outer_path = output / "SHA256SUMS.txt"
        outer = outer_path.read_bytes()

        def verify(setup_digest=receipt["sha256"]):
            return release.verify_combined_release(output, payload, self.version,
                setup_digest, receipt["administratorBundleSha256"])

        for name in ("install.ps1", release.ADMIN_INSTALLER, release.ADMIN_STAGER, release.ADMIN_ARCHIVE,
                     "agent-continue-setup.zip", "payload/runtime.mjs"):
            line = next(line for line in outer.splitlines(keepends=True) if line.endswith(b"  " + name.encode("ascii") + b"\n"))
            for altered in (outer.replace(line, b""), outer + line,
                            outer.replace(line, b"0" * 64 + line[64:])):
                with self.subTest(name=name, altered=altered[-100:]):
                    outer_path.write_bytes(altered)
                    with self.assertRaisesRegex(ValueError, "combined_release_checksums_mismatch"):
                        verify()
        outer_path.write_bytes(outer)

        for change in ({"SHA256SUMS.txt": b"0" * 64 + b"  install.ps1\n"},
                       {"payload/runtime.mjs": b"different source"}, {"unexpected-source.txt": b"extra"}):
            with self.subTest(change=tuple(change)):
                with zipfile.ZipFile(output / "agent-continue-setup.zip", "w") as archive:
                    for name, data in {**members, **change}.items():
                        archive.writestr(name, data)
                # Even accepting a freshly computed ZIP hash cannot hide incorrect
                # embedded source/checksums from the verified payload snapshot.
                with self.assertRaisesRegex(ValueError, "combined_release_source_"):
                    verify(self.digest((output / "agent-continue-setup.zip").read_bytes()))

    def test_missing_helper_stager_and_bundle_are_rejected_before_output(self):
        self.archive_fixture()
        for source in (self.repo / "native/bootstrap" / release.ADMIN_INSTALLER,
                       self.repo / "scripts" / release.ADMIN_STAGER, self.archive):
            original = source.read_bytes()
            source.unlink()
            output = self.root / ("missing-" + source.name)
            with self.subTest(source=source.name), self.assertRaises(OSError):
                self.build_combined(output)
            self.assertFalse(output.exists())
            source.write_bytes(original)

    def test_source_only_binary_and_archive_rejection_is_preserved(self):
        for name in ("native-launcher.exe", "custom.MSI", "nested.ZIP"):
            with self.subTest(name=name):
                self.payload[name] = b"synthetic prohibited payload"
                output = self.root / name
                with mock.patch.object(release.subprocess, "run", side_effect=self.package), \
                        mock.patch("sys.stdout", new_callable=io.StringIO) as report:
                    with self.assertRaisesRegex(ValueError, "setup_source_contains_binary_or_archive"):
                        release.build_release(self.repo, output, combined=False)
                self.assertFalse(output.exists())
                self.assertEqual(report.getvalue(), "")
                self.payload.pop(name)

    def test_source_pin_and_output_path_redirection_checks_are_preserved(self):
        self.archive_fixture()
        stager = self.repo / "scripts" / release.ADMIN_STAGER
        is_symlink = release.Path.is_symlink

        def redirected(path):
            return path == stager or is_symlink(path)

        with mock.patch.object(release.Path, "is_symlink", new=redirected):
            with self.assertRaisesRegex(ValueError, "administrator_input_redirected"):
                self.build_combined(self.root / "redirected-source")

        output = self.root / "redirected-output"
        receipt = self.build_combined(output)
        with zipfile.ZipFile(output / "agent-continue-setup.zip") as archive:
            payload = {name: archive.read(name) for name in archive.namelist() if name != "SHA256SUMS.txt"}
        for name in receipt["assets"]:
            with self.subTest(name=name):
                target = output / name

                def redirected(path):
                    return path == target or is_symlink(path)

                with mock.patch.object(release.Path, "is_symlink", new=redirected):
                    with self.assertRaisesRegex(ValueError, "administrator_input_redirected"):
                        release.verify_combined_release(output, payload, self.version,
                            receipt["sha256"], receipt["administratorBundleSha256"])

    def test_extra_release_asset_cannot_qualify_as_combined(self):
        self.archive_fixture()
        output = self.root / "extra-asset"
        receipt = self.build_combined(output)
        with zipfile.ZipFile(output / "agent-continue-setup.zip") as archive:
            payload = {name: archive.read(name) for name in archive.namelist() if name != "SHA256SUMS.txt"}
        self.write(output / "custom-installer.exe", b"synthetic extra, never executed")
        with self.assertRaisesRegex(ValueError, "combined_release_asset_inventory"):
            release.verify_combined_release(output, payload, self.version,
                receipt["sha256"], receipt["administratorBundleSha256"])

    def test_complete_synthetic_metadata_is_accepted_without_execution(self):
        self.archive_fixture()
        with mock.patch.object(release.subprocess, "run", side_effect=AssertionError("payload must not run")):
            self.assertEqual(self.verify(), len(self.members))

    def test_locked_upstream_ripgrep_is_hashed_but_never_executed(self):
        package = "node_modules/@vscode/ripgrep-win32-x64"
        executable = "app/" + package + "/bin/rg.exe"
        data = b"synthetic ripgrep, never executable"
        pin = {"version": "1.18.0", "integrity": "synthetic integrity", "executableSha256": self.digest(data)}
        lock = self.encode({"packages": {package: {"version": pin["version"], "integrity": pin["integrity"],
                                                "os": ["win32"], "cpu": ["x64"]}}})
        self.payload["payload/package-lock.json"] = self.members["app/package-lock.json"] = lock
        manifest = json.loads(self.payload["payload-manifest.json"])
        for entry in manifest["files"]:
            if entry["path"] == "package-lock.json":
                entry.update(bytes=len(lock), sha256=self.digest(lock))
        self.payload["payload-manifest.json"] = self.encode(manifest)
        self.evidence.update(sourcePayloadSha256=self.digest(self.payload["payload-manifest.json"]),
                             npmLockSha256=self.digest(lock))
        self.members["app/agent-continue-build-evidence.json"] = self.encode(self.evidence)
        self.members.update({executable: data, "app/" + package + "/LICENSE": b"synthetic license",
            "app/" + package + "/package.json": self.encode({"name": "@vscode/ripgrep-win32-x64",
                "version": pin["version"], "os": ["win32"], "cpu": ["x64"]})})
        with mock.patch.object(release, "RIPGREP_PIN", pin), \
                mock.patch.object(release.subprocess, "run", side_effect=AssertionError("must not execute")):
            self.archive_fixture()
            self.assertEqual(self.verify(), len(self.members))
            for name in (executable, "app/" + package + "/LICENSE", "app/" + package + "/package.json"):
                original = self.members[name]
                for mutation in (b"", None):
                    with self.subTest(name=name, mutation=mutation):
                        if mutation is None:
                            self.members.pop(name, None)
                        else:
                            self.members[name] = mutation
                        self.archive_fixture()
                        with self.assertRaises(ValueError):
                            self.verify()
                self.members[name] = original
            self.members[executable] += b"tampered"
            self.archive_fixture()
            with self.assertRaisesRegex(ValueError, "administrator_bundle_source_or_runtime_mismatch"):
                self.verify()

    def test_unlocked_dependency_executable_is_not_accepted(self):
        self.archive_fixture([("app/node_modules/@vscode/ripgrep-win32-x64/bin/rg.exe", b"unlocked binary")])
        with self.assertRaisesRegex(ValueError, "administrator_unexpected_binary"):
            self.verify()

    def test_every_required_member_must_be_present_and_nonempty(self):
        for name in list(self.members):
            original = self.members.pop(name)
            with self.subTest(name=name, mutation="missing"):
                self.archive_fixture()
                with self.assertRaises(ValueError):
                    self.verify()
            self.members[name] = b""
            with self.subTest(name=name, mutation="empty"):
                self.archive_fixture()
                with self.assertRaises(ValueError):
                    self.verify()
            self.members[name] = original

    def test_same_source_runtime_administrator_provider_and_license_hashes_are_required(self):
        for name in ("app/extra-runtime.mjs", "app/windows-admin-owner.mjs", "app/windows-browser-peer.ps1",
                     "app/node_modules/@wonderwhy-er/desktop-commander/dist/server.js", "runtime/node.exe",
                     "client/tunnel-client-runtime.exe", "app/third-party-notices/agent-continue-LICENSE.txt",
                     "app/third-party-notices/openai-tunnel-client-runtime-v0.0.19-windows-amd64.spdx.json"):
            with self.subTest(name=name):
                original = self.members[name]
                self.members[name] += b"tampered"
                self.archive_fixture()
                with self.assertRaises(ValueError):
                    self.verify()
                self.members[name] = original

    def test_build_evidence_must_match_the_bundle_and_source_snapshot(self):
        for key in self.evidence:
            with self.subTest(key=key):
                self.members["app/agent-continue-build-evidence.json"] = self.encode({**self.evidence, key: None})
                self.archive_fixture()
                with self.assertRaises(ValueError):
                    self.verify()

    def test_duplicate_and_malformed_metadata_is_refused(self):
        for data in (b"[]", b"null", b"{", b'{"version":1,"version":1}',
                     b'{"version":NaN}', self.encode({**self.evidence, "version": True})):
            with self.subTest(data=data):
                self.members["app/agent-continue-build-evidence.json"] = data
                self.archive_fixture()
                with self.assertRaises(ValueError):
                    self.verify()

    def test_unsafe_zip_names_and_windows_collisions_are_refused(self):
        names = ("app/../escape", "app/./dot", "app//double", "app/CON.txt", "app/trailing.",
                 "app/a/../../escape", "app/a\\escape", "app/a:stream", "/app/absolute", "C:/app/drive",
                 "app/.env", "app/deep/.env.local", "app/.npmrc", "app/runtime.key", "app/tunnel.yaml",
                 "app/binding.json", "app/key.PEM", "app/a.p12", "app/a.pfx", "app/setup.exe", "app/setup.msi",
                 "runtime/other.exe", "app/HOST.mjs", "app/host.mjs", "app/profile.mjs/child",
                 "app/Parent/a", "app/parent/b", "app/" + "a" * 250, "app/embedded\x00name")
        for name in names:
            with self.subTest(name=name):
                extras = [(name, b"bad")]
                if name == "app/Parent/a":
                    extras.append(("app/parent/b", b"collision"))
                if name == "app/parent/b":
                    extras.append(("app/Parent/a", b"collision"))
                self.archive_fixture(extras)
                with self.assertRaises(ValueError):
                    self.verify()

    def test_nonregular_encrypted_and_unsupported_zip_entries_are_refused(self):
        for attrs in ((stat.S_IFLNK | 0o777) << 16, (stat.S_IFDIR | 0o755) << 16, 0x400, 0x10):
            with self.subTest(attrs=attrs):
                member = zipfile.ZipInfo("app/unsafe")
                member.create_system = 3
                member.external_attr = attrs
                self.archive_fixture([(member, b"target")])
                with self.assertRaises(ValueError):
                    self.verify()
        self.archive_fixture()
        raw = self.archive.read_bytes()
        encrypted = bytearray(raw)
        encrypted[raw.index(b"PK\x01\x02") + 8] |= 1
        self.archive.write_bytes(encrypted)
        with self.assertRaises(ValueError):
            self.verify()
        compressed = zipfile.ZipInfo("app/unsupported-compression")
        compressed.compress_type = zipfile.ZIP_BZIP2
        self.archive_fixture([(compressed, b"unsupported")])
        with self.assertRaises(ValueError):
            self.verify()

    def test_archive_entry_count_expanded_size_and_metadata_bounds_are_enforced(self):
        self.archive_fixture()
        for constant in ("ADMIN_ARCHIVE_LIMIT", "ADMIN_ENTRY_LIMIT", "ADMIN_TOTAL_LIMIT", "ADMIN_MANIFEST_LIMIT",
                         "ADMIN_METADATA_LIMIT"):
            with self.subTest(constant=constant), mock.patch.object(release, constant, 1):
                with self.assertRaises(ValueError):
                    self.verify()

    def test_corrupt_archive_and_crc_are_refused(self):
        for data in (b"not a ZIP", self.archive_fixture().read_bytes().replace(b"synthetic Node", b"synthetic N0de", 1)):
            with self.subTest(size=len(data)):
                self.archive.write_bytes(data)
                with self.assertRaises((ValueError, zipfile.BadZipFile)):
                    self.verify()

    def test_combined_release_keeps_bundle_separate_and_hashes_both_sidecars(self):
        self.archive_fixture()
        original_archive = self.archive.read_bytes()
        self.write(self.repo / "docs/operational-diagnostic.md", b"synthetic operational doc must not ship\n")
        self.write(self.repo / ".artifacts/fixture-receipt.json", b"synthetic receipt must not ship\n")
        forged_sums = ("0" * 64 + "  " + release.ADMIN_ARCHIVE + "\n" +
                       "1" * 64 + "  " + release.ADMIN_STAGER + "\n").encode("ascii")
        self.write(self.root / "SHA256SUMS.txt", forged_sums)
        self.write(self.repo / "SHA256SUMS.txt", forged_sums)

        def package(command, **kwargs):
            self.assertEqual(command[0], "node")
            stage = Path(command[command.index("--output") + 1])
            for name, data in self.payload.items():
                self.write(stage / name, data)
            return subprocess.CompletedProcess(command, 0)

        with mock.patch.object(release.subprocess, "run", side_effect=package), \
                mock.patch.object(release, "NODE_PIN", self.node_pin), \
                mock.patch.object(release, "run_administrator_plan", return_value=True) as plan:
            outputs = [self.root / "output", self.root / "repeat"]
            for output in outputs:
                with mock.patch("sys.stdout", new_callable=io.StringIO) as report:
                    release.build_release(self.repo, output, self.archive)
                    receipt = json.loads(report.getvalue())
                self.assertIs(receipt["administratorBundleVerified"], True)
                self.assertIs(receipt["administratorStagerPlan"], True)
                self.assertIs(receipt["installed"], False)
                self.assertIs(receipt["published"], False)
                sums = dict(line.split("  ", 1)[::-1] for line in (output / "SHA256SUMS.txt").read_text().splitlines())
                with zipfile.ZipFile(output / "agent-continue-setup.zip") as source:
                    self.assertFalse(any(name.lower().endswith((".exe", ".msi", ".zip")) for name in source.namelist()))
                    self.assertEqual(set(source.namelist()), {*self.payload, release.ADMIN_INSTALLER,
                                                              release.ADMIN_STAGER, "SHA256SUMS.txt"})
                    for name in ("install-administrator.ps1", "Stage-WindowsAdministratorBundle.ps1"):
                        self.assertEqual(source.read(name), (output / name).read_bytes())
                        self.assertEqual(self.digest(source.read(name)), sums[name])
                    self.assertIn(f"$script:acReleaseTag = 'v{self.version}'".encode("ascii"), source.read("install-administrator.ps1"))
                    helper = source.read("install-administrator.ps1")
                    expected_parent = release.pin_administrator_hash(release.pin_installer(self.payload["install.ps1"], self.version),
                        "acAdministratorInstallerSha256", self.digest(helper))
                    self.assertEqual(source.read("install.ps1"), expected_parent)
                    self.assertIn(f"$script:acAdministratorBundleSha256 = '{self.digest(original_archive)}'".encode("ascii"), helper)
                    self.assertIn(f"$script:acAdministratorStagerSha256 = '{self.digest(source.read(release.ADMIN_STAGER))}'".encode("ascii"), helper)
                    self.assertNotIn(b"$script:acAdministratorInstallerSha256", helper)
                    self.assertNotIn(b"$script:acAdministratorBundleSha256", source.read("install.ps1"))
                    inner = dict(line.split("  ", 1)[::-1] for line in source.read("SHA256SUMS.txt").decode("ascii").splitlines())
                    self.assertEqual(set(inner), set(source.namelist()) - {"SHA256SUMS.txt"})
                    self.assertTrue(all(self.digest(source.read(name)) == digest for name, digest in inner.items()))
                    self.assertTrue(all(entry.date_time == release.ZIP_TIMESTAMP for entry in source.infolist()))
                name = "agent-continue-windows-administrator-x64.zip"
                self.assertEqual((output / name).read_bytes(), original_archive)
                self.assertEqual(sums[name], self.digest(original_archive))
                # Rewriting a writable checksum file cannot change immutable pins.
                (output / "SHA256SUMS.txt").write_bytes(b"0" * 64 + b"  " + name.encode("ascii") + b"\n")
                self.assertIn(self.digest(original_archive).encode("ascii"), (output / release.ADMIN_INSTALLER).read_bytes())
                self.assertIn(self.digest(helper).encode("ascii"), (output / "install.ps1").read_bytes())
                (output / "SHA256SUMS.txt").write_bytes(("\n".join(f"{digest}  {name}" for name, digest in sums.items()) + "\n").encode("ascii"))
            self.assertEqual(plan.call_count, 2)
            self.assertEqual(sorted(path.name for path in outputs[0].iterdir()), sorted(path.name for path in outputs[1].iterdir()))
            for path in outputs[0].iterdir():
                self.assertEqual(path.read_bytes(), (outputs[1] / path.name).read_bytes())

    def test_bad_optional_bundle_never_creates_release_output(self):
        self.members.pop("app/windows-browser-peer.ps1")
        self.archive_fixture()

        def package(command, **kwargs):
            stage = Path(command[command.index("--output") + 1])
            for name, data in self.payload.items():
                self.write(stage / name, data)

        output = self.root / "output"
        with mock.patch.object(release.subprocess, "run", side_effect=package), mock.patch.object(release, "NODE_PIN", self.node_pin), \
                mock.patch.object(release, "run_administrator_plan", side_effect=AssertionError("must validate first")):
            with self.assertRaises(ValueError):
                release.build_release(self.repo, output, self.archive)
        self.assertFalse(output.exists())

    def test_explicit_source_only_preserves_bytes_but_disclaims_combined_delivery(self):
        def package(command, **kwargs):
            stage = Path(command[command.index("--output") + 1])
            for name, data in self.payload.items():
                self.write(stage / name, data)

        output = self.root / "ordinary"
        with mock.patch.object(release.subprocess, "run", side_effect=package), \
                mock.patch.object(release, "source_bytes", side_effect=AssertionError("ordinary build must not read sidecars")), \
                mock.patch.object(release, "run_administrator_plan", side_effect=AssertionError("ordinary build must not Plan")), \
                mock.patch("sys.stdout", new_callable=io.StringIO) as report:
            release.build_release(self.repo, output, combined=False)
        receipt = json.loads(report.getvalue())
        self.assertNotIn("administratorBundleVerified", receipt)
        self.assertIs(receipt["combinedBuilt"], False)
        self.assertEqual(receipt["deliveryContract"], "current-account-source-only")
        self.assertEqual(receipt["limitation"], "not_full_combined_delivery")
        legacy_payload = {name: self.payload[name] for name in sorted(self.payload)}
        legacy_payload["install.ps1"] = release.pin_installer(legacy_payload["install.ps1"], self.version)
        lines = [f"{self.digest(data)}  {name}" for name, data in legacy_payload.items()]
        members = {**legacy_payload, "SHA256SUMS.txt": ("\n".join(lines) + "\n").encode("ascii")}
        expected = io.BytesIO()
        with zipfile.ZipFile(expected, "w") as archive:
            for name, data in members.items():
                member = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                member.create_system = 3
                member.external_attr = (stat.S_IFREG | (0o755 if name == "bin.mjs" else 0o644)) << 16
                archive.writestr(member, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        self.assertEqual((output / "agent-continue-setup.zip").read_bytes(), expected.getvalue())
        lines.append(f"{self.digest(expected.getvalue())}  agent-continue-setup.zip")
        self.assertEqual((output / "SHA256SUMS.txt").read_bytes(), ("\n".join(lines) + "\n").encode("ascii"))
        self.assertEqual(sorted(path.name for path in output.iterdir()), ["SHA256SUMS.txt", "agent-continue-setup.zip", "install.ps1"])

    @unittest.skipUnless(os.name == "nt", "Windows PowerShell read-only stager Plan")
    def test_repository_stager_plan_accepts_synthetic_layout_without_installing(self):
        self.archive_fixture()
        self.assertIs(release.run_administrator_plan(REPO / "scripts/Stage-WindowsAdministratorBundle.ps1",
            self.archive, self.digest(self.archive.read_bytes()), len(self.members)), True)

    def test_plan_receipt_must_prove_read_only_completion_and_exact_file_count(self):
        receipt = {"ok": True, "phase": "complete", "files": len(self.members), "protectedFilesVerified": False,
                   "administratorStateVerified": False, "cleanLaunchPlanVerified": False, "administratorChildVerified": False,
                   "hostedBindingPrepared": False, "hostedLaunchPlanVerified": False, "activated": False,
                   "registrationChanged": False, "tunnelStarted": False, "diagnostic": "none"}
        shell = self.root / "Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
        self.write(shell, b"not executable; subprocess mocked")
        self.archive_fixture()
        for change in ({}, {"ok": False}, {"phase": "layout"}, {"files": 0}, {"files": True},
                       {"activated": True}, {"registrationChanged": True}, {"tunnelStarted": True},
                       {"protectedFilesVerified": True}, {"administratorChildVerified": True}):
            with self.subTest(change=change), mock.patch.object(release, "WINDOWS", True), \
                    mock.patch.dict(os.environ, {"SystemRoot": str(self.root / "Windows")}), \
                    mock.patch.object(release.subprocess, "run", return_value=subprocess.CompletedProcess(
                        [], 0, self.encode({**receipt, **change}).decode("ascii"), "")) as run:
                args = (self.repo / "scripts/Stage-WindowsAdministratorBundle.ps1", self.archive,
                        self.digest(self.archive.read_bytes()), len(self.members))
                if change:
                    with self.assertRaises(ValueError):
                        release.run_administrator_plan(*args)
                else:
                    self.assertIs(release.run_administrator_plan(*args), True)
                self.assertEqual(run.call_args.args[0][run.call_args.args[0].index("-Action") + 1], "Plan")
                self.assertNotIn("-Consent", run.call_args.args[0])

    def test_unavailable_windows_plan_is_explicit_and_never_executes_a_fallback(self):
        with mock.patch.object(release, "WINDOWS", False), \
                mock.patch.object(release.subprocess, "run", side_effect=AssertionError("no fallback execution")):
            self.assertIs(release.run_administrator_plan(self.repo / "scripts/Stage-WindowsAdministratorBundle.ps1",
                self.archive, "a" * 64, len(self.members)), False)

    def test_failed_plan_never_creates_release_output(self):
        self.archive_fixture()

        def package(command, **kwargs):
            stage = Path(command[command.index("--output") + 1])
            for name, data in self.payload.items():
                self.write(stage / name, data)

        output = self.root / "output"
        with mock.patch.object(release.subprocess, "run", side_effect=package), mock.patch.object(release, "NODE_PIN", self.node_pin), \
                mock.patch.object(release, "run_administrator_plan", side_effect=ValueError("administrator_stager_plan_failed")):
            with self.assertRaisesRegex(ValueError, "administrator_stager_plan_failed"):
                release.build_release(self.repo, output, self.archive)
        self.assertFalse(output.exists())

    def test_linked_input_archives_are_refused_before_snapshotting(self):
        self.archive_fixture()
        with mock.patch.object(release.Path, "is_symlink", return_value=True):
            with self.assertRaisesRegex(ValueError, "administrator_input_redirected"):
                release.snapshot_archive(self.archive, self.root / "copy.zip")
        linked = self.root / "hardlink.zip"
        os.link(self.archive, linked)
        with self.assertRaisesRegex(ValueError, "administrator_input_size_or_type"):
            release.snapshot_archive(self.archive, self.root / "copy.zip")
        self.assertFalse((self.root / "copy.zip").exists())


class SetupReleaseCliContractTests(unittest.TestCase):
    def test_invalid_combined_cli_does_not_report_the_source_subbuild_as_success(self):
        with tempfile.TemporaryDirectory(prefix="ac-combined-cli-refusal-") as temporary:
            root = Path(temporary)
            output = root / "output"
            result = subprocess.run([sys.executable, "-B", str(REPO / "scripts/build-setup-release.py"),
                "--combined", "--output", str(output), "--administrator-bundle", str(root / "missing.zip")],
                capture_output=True, text=True, timeout=30)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "")
            self.assertFalse(output.exists())

    def test_real_source_only_cli_produces_one_explicitly_limited_receipt(self):
        with tempfile.TemporaryDirectory(prefix="ac-source-only-cli-") as temporary:
            output = Path(temporary) / "output"
            result = subprocess.run([sys.executable, "-B", str(REPO / "scripts/build-setup-release.py"),
                "--source-only", "--output", str(output)], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(len(result.stdout.splitlines()), 1)
            receipt = json.loads(result.stdout)
            self.assertEqual(receipt["deliveryContract"], "current-account-source-only")
            self.assertIs(receipt["combinedBuilt"], False)
            self.assertEqual(receipt["limitation"], "not_full_combined_delivery")
            self.assertIs(receipt["installed"], False)
            self.assertIs(receipt["published"], False)
            version = json.loads((REPO / "manifest.json").read_text(encoding="utf-8"))["version"]
            self.assertEqual(receipt["releaseTag"], "v" + version)
            parent = (output / "install.ps1").read_bytes()
            self.assertIn(f"$script:acReleaseTag = 'v{version}'".encode("ascii"), parent)
            with zipfile.ZipFile(output / "agent-continue-setup.zip") as archive:
                self.assertFalse(any(name.lower().endswith((".exe", ".msi", ".zip")) for name in archive.namelist()))
                self.assertEqual(archive.read("install.ps1"), parent)

    def test_default_and_explicit_combined_and_source_only_modes(self):
        for flags, combined in (([], True), (["--combined"], True), (["--combined-public"], True),
                                (["--source-only"], False)):
            with self.subTest(flags=flags), mock.patch.object(sys, "argv", ["build-setup-release.py",
                    "--output", "synthetic-output", *flags]), mock.patch.object(release, "build_release") as build:
                release.main()
                build.assert_called_once_with(REPO, Path("synthetic-output"), None, combined=combined)

    def test_cli_default_and_explicit_combined_fail_without_bundle(self):
        for flags in ([], ["--combined"], ["--combined-public"]):
            with self.subTest(flags=flags), mock.patch.object(sys, "argv", ["build-setup-release.py",
                    "--output", "synthetic-output", *flags]), mock.patch.object(release.subprocess, "run") as package:
                with self.assertRaisesRegex(SystemExit, "combined_administrator_bundle_required"):
                    release.main()
                package.assert_not_called()

    def test_conflicting_delivery_modes_are_rejected(self):
        with mock.patch.object(sys, "argv", ["build-setup-release.py", "--output", "synthetic-output",
                "--combined", "--source-only"]), mock.patch.object(release, "build_release") as build, \
                mock.patch("sys.stderr", new_callable=io.StringIO):
            with self.assertRaises(SystemExit) as error:
                release.main()
            self.assertEqual(error.exception.code, 2)
            build.assert_not_called()


class SetupReleaseTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "Windows PowerShell explicit OS-module initialization")
    def test_guided_module_initialization_precedes_adjacent_hashing(self):
        source = (REPO / "native/bootstrap/install.ps1").read_text(encoding="utf-8-sig")
        refusal = source.index("if ($Host.Name -cne 'ConsoleHost' -or [Console]::IsInputRedirected)")
        initialize = source.index("Initialize-InstallerModules", refusal)
        adjacent = source.index("(Get-AdjacentSetupArchive)", refusal)
        self.assertLess(initialize, adjacent, "valid guided ZIP hashing needs OS Utility first")
        with tempfile.TemporaryDirectory(prefix="ac-guided-modules-") as temporary:
            root = Path(temporary).resolve()
            payload = root / "inert.txt"
            payload.write_bytes(b"not executable")
            code = """
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
Import-Module ([IO.Path]::Combine($PSHOME,'Modules/Microsoft.PowerShell.Management/Microsoft.PowerShell.Management.psd1')) -ErrorAction Stop
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($env:AC_MODULE_INSTALLER,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'parse_failed' }
$definition=$ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Initialize-InstallerModules'},$true)
if ($definition.Count -ne 1) { throw 'initializer_missing' }
. ([scriptblock]::Create($definition[0].Extent.Text))
if (Get-Command Get-FileHash -ErrorAction SilentlyContinue) { throw 'utility_already_loaded' }
Initialize-InstallerModules
$hash=Get-FileHash -LiteralPath $env:AC_MODULE_FIXTURE -Algorithm SHA256
$json=ConvertFrom-Json -InputObject '{"ok":true}'
if ($hash.Hash -cne $env:AC_MODULE_EXPECTED -or -not $json.ok -or
    -not (Get-Command Expand-Archive -ErrorAction Stop)) { throw 'module_resolution_failed' }
[Console]::Out.WriteLine('exact-os-modules-ready')
"""
            env = {**os.environ, "AC_MODULE_INSTALLER": str(REPO / "native/bootstrap/install.ps1"),
                "AC_MODULE_FIXTURE": str(payload), "AC_MODULE_EXPECTED": hashlib.sha256(payload.read_bytes()).hexdigest().upper(),
                "PSModulePath": str(root / "absent-modules"), "PSModuleAnalysisCachePath": "NUL"}
            ps = str(Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe")
            result = subprocess.run([ps, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", code],
                cwd=root, env=env, capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stdout.strip(), "exact-os-modules-ready")
            self.assertEqual(result.stderr, "")

    @unittest.skipUnless(os.name == "nt", "Windows PowerShell refusal before module loading")
    def test_refused_guided_input_does_not_load_installer_modules(self):
        source = (REPO / "native/bootstrap/install.ps1").read_text(encoding="utf-8-sig")
        anchor = "$script:acPath = $env:PATH"
        self.assertEqual(source.count(anchor), 1)
        with tempfile.TemporaryDirectory(prefix="ac-refusal-import-") as temporary:
            root = Path(temporary).resolve()
            marker = root / "module-imported.txt"
            probe = root / "install.ps1"
            # A child-only command shadow makes premature imports observable;
            # the original installer and the machine's system modules stay intact.
            hook = "function Import-Module { [IO.File]::WriteAllText('" + str(marker).replace("'", "''") + \
                "', 'unexpected import'); throw 'module_import_before_refusal' }\n"
            probe.write_text(source.replace(anchor, hook + anchor), encoding="utf-8-sig")
            ps = str(Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe")
            local = root / "local"
            local.mkdir()
            env = {**os.environ, "LOCALAPPDATA": str(local), "PSModuleAnalysisCachePath": "NUL"}
            guided = ["-InstallLocal", "-Consent", "accept-install", "-PromptForConnection", "-ExtensionId", "a" * 32]
            cases = [
                (guided, "interactive_terminal_required"),
                (guided[:-1] + ["z" * 32], "invalid_extension_id"),
                (guided + ["-BrowserManaged"], "interactive_terminal_required"),
                (guided + ["-Verify"], "invalid_manager_arguments"),
                (["-InstallLocal", "-PromptForConnection", "-ExtensionId", "a" * 32], "consent_required"),
                (["-Administrator", "-Apply", "-PromptForConnection"], "consent_required"),
                (["-Administrator", "-Apply", "-Consent", "accept-administrator-browser-installation",
                  "-PromptForConnection", "-ExtensionId", "z" * 32], "invalid_extension_id"),
            ]
            for args, code in cases:
                with self.subTest(code=code, args=args):
                    result = subprocess.run([ps, "-NoLogo", "-NoProfile", "-File", str(probe), *args],
                        cwd=root, env=env, input="must not be read\n", capture_output=True, text=True, timeout=20)
                    self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                    self.assertEqual(result.stderr.strip(), "agent_continue_install_failed: " + code)
                    self.assertEqual(result.stdout, "")
                    self.assertFalse(marker.exists(), "refusal loaded installer modules")
                    self.assertFalse((local / "AgentContinue").exists())
                    self.assertFalse((local / "AgentContinueToolchain").exists())

    def check_guided_cmd(self, ps, extracted, root):
        sandbox = root / "guided-cmd"
        local = sandbox / "AppData/Local"
        roaming = sandbox / "AppData/Roaming"
        scratch = sandbox / "temp"
        startup_cache = local / "Microsoft/Windows/PowerShell"
        # PowerShell can rewrite its own startup profile even on a refused invocation.
        startup_files = {startup_cache / f"StartupProfileData-{mode}" for mode in ("Interactive", "NonInteractive")}
        for directory in (startup_cache, local / "Microsoft/Windows/Caches", roaming, scratch):
            directory.mkdir(parents=True)
        system_root = Path(os.environ["SystemRoot"])
        system32 = system_root / "System32"
        cmd = str(system32 / "cmd.exe")
        env = {
            "SystemRoot": str(system_root), "ComSpec": cmd, "OS": "Windows_NT",
            "PATH": os.pathsep.join((str(system32), str(ps.parent))), "PATHEXT": ".COM;.EXE;.BAT;.CMD",
            "USERPROFILE": str(sandbox), "LOCALAPPDATA": str(local), "APPDATA": str(roaming),
            "TEMP": str(scratch), "TMP": str(scratch),
            # Suppress the engine's asynchronous cache, not installer writes under test.
            "PSModuleAnalysisCachePath": "NUL",
        }
        self.assertIsNone(shutil.which("node", path=env["PATH"]), "guided fixture must not have Node on PATH")

        def snapshot():
            return {path.relative_to(root): hashlib.sha256(path.read_bytes()).digest() if path.is_file() else None
                    for tree in (sandbox, extracted) for path in tree.rglob("*") if path not in startup_files}

        def fixture_changes(before):
            after = snapshot()
            changed = before.keys() ^ after.keys()
            changed.update(path for path in before.keys() & after.keys() if before[path] != after[path])
            return sorted(map(str, changed))

        def assert_unchanged(before):
            self.assertEqual(fixture_changes(before), [], "guided command changed the fixture tree")

        def bounded_output(value):
            if isinstance(value, bytes):
                value = value.decode("utf-8", errors="backslashreplace")
            return (value or "")[:4096]

        def timeout_diagnostic(error, args, started, before):
            report = {"rootCause": "unresolved", "args": args, "timeoutSeconds": 20,
                      "elapsedSeconds": round(time.monotonic() - started, 3),
                      "originalPhase": "CMD/PowerShell refusal boundary; internal phase not observed",
                      "stdout": bounded_output(error.stdout), "stderr": bounded_output(error.stderr)}
            # A separate read-only probe, not an installer replay or an observation
            # of the timed-out process. ParseFile never executes the installer.
            probe_source = """
$ErrorActionPreference = 'Stop'
[Console]::Out.WriteLine('engine-entered')
$tokens = $null; $parseErrors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile(
    $env:AC_GUIDED_CMD_PROBE_INSTALLER, [ref]$tokens, [ref]$parseErrors)
[Console]::Out.WriteLine(('installer-parsed:' + $parseErrors.Count))
$null = [Net.ServicePointManager]::SecurityProtocol
[Console]::Out.WriteLine('tls-ready')
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')
[Console]::Out.WriteLine('utility-imported')
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Archive/Microsoft.PowerShell.Archive.psd1')
[Console]::Out.WriteLine('archive-imported')
[Console]::Out.WriteLine(('stdin-redirected:' + [Console]::IsInputRedirected))
"""
            probe_env = {**env, "AC_GUIDED_CMD_PROBE_INSTALLER": str(extracted / "install.ps1")}
            try:
                probe = subprocess.run([str(ps), "-NoLogo", "-NoProfile", "-Command", probe_source],
                                       cwd=extracted, env=probe_env, input="", capture_output=True, text=True, timeout=3)
                report["postTimeoutEngineProbe"] = {"status": "completed", "returncode": probe.returncode,
                    "stdout": bounded_output(probe.stdout), "stderr": bounded_output(probe.stderr)}
            except subprocess.TimeoutExpired as probe_error:
                report["postTimeoutEngineProbe"] = {"status": "timeout",
                    "stdout": bounded_output(probe_error.stdout), "stderr": bounded_output(probe_error.stderr)}
            except OSError as probe_error:
                report["postTimeoutEngineProbe"] = {"status": "launch", "error": type(probe_error).__name__}
            try:
                report["fixtureChanges"] = fixture_changes(before)
            except OSError as snapshot_error:
                report["fixtureSnapshotError"] = type(snapshot_error).__name__
            return "guided_cmd_timeout: " + json.dumps(report, ensure_ascii=True, sort_keys=True)

        base = [cmd, "/d", "/c", "install.cmd", "guided"]
        extension_id = "a" * 32
        before = snapshot()
        for args in ([extension_id], ["z" * 32], [extension_id, "-Verify"]):
            with self.subTest(guided_cmd_args=args):
                started = time.monotonic()
                try:
                    result = subprocess.run([*base, *args], cwd=extracted, env=env,
                                            input="must not be read\n", capture_output=True, text=True, timeout=20)
                except subprocess.TimeoutExpired as error:
                    self.fail(timeout_diagnostic(error, args, started, before))
                diagnostic = result.stdout + result.stderr
                self.assertNotEqual(result.returncode, 0, diagnostic)
                if args == [extension_id]:
                    self.assertIn("agent_continue_install_failed: interactive_terminal_required", result.stderr)
                else:
                    self.assertNotIn("interactive_terminal_required", diagnostic)
                if args[-1] == "-Verify":
                    self.assertNotIn("agent_continue_install_failed:", diagnostic, "extra switch reached PowerShell")
                self.assertNotIn("exported Agent Continue setup JSON", diagnostic)
                self.assertNotIn("must not be read", diagnostic)
                assert_unchanged(before)

        if os.environ.get("AGENT_CONTINUE_TEST_GUIDED_PTY") != "1":
            return
        from winpty import Backend, PtyProcess

        key_path = sandbox / "synthetic key path must stay masked.txt"
        key_bytes = b"fixture-content-not-a-runtime-key"
        key_path.write_bytes(key_bytes)
        before = snapshot()
        prompts = ("OpenAI tunnel ID", "runtime-key FILE PATH", "Type CONNECT")
        answers = ("tunnel_" + "a" * 32, f'"{key_path}"', "")
        for supplied in (("",), answers):
            with self.subTest(guided_cmd_cancel_at_prompt=len(supplied)):
                deadline = time.monotonic() + 20
                terminal = PtyProcess.spawn([*base, extension_id], cwd=str(extracted), env=env,
                                            dimensions=(30, 240), backend=Backend.ConPTY)
                transcript = ""

                def read_until(marker):
                    nonlocal transcript
                    while marker not in transcript:
                        remaining = deadline - time.monotonic()
                        if remaining <= 0 or len(transcript) >= 65536:
                            self.fail(f"ConPTY did not reach {marker!r}: {transcript!r}")
                        terminal.fileobj.settimeout(remaining)
                        try:
                            transcript += terminal.read()
                        except (EOFError, TimeoutError) as exc:
                            self.fail(f"ConPTY stopped before {marker!r}: {exc}; {transcript!r}")

                try:
                    for marker, answer in zip(prompts, supplied):
                        read_until(marker)
                        terminal.write(answer + "\r")
                    read_until("agent_continue_install_failed: setup_cancelled")
                    while terminal.pty.isalive() and time.monotonic() < deadline:
                        time.sleep(0.05)
                    self.assertFalse(terminal.pty.isalive(), "cmd.exe did not exit after cancellation")
                    self.assertEqual(terminal.exitstatus, 1, transcript)
                finally:
                    terminal.close(force=True)
                self.assertNotIn(key_path.name, transcript)
                self.assertNotIn(key_bytes.decode("ascii"), transcript)
                self.assertIn(f"Chrome extension ID: {extension_id}", transcript)
                self.assertNotIn("exported Agent Continue setup JSON", transcript)
                assert_unchanged(before)

    def check_guided_windows(self, ps, extracted, root, request):
        local = root / "guided-local-data"
        destination = root / "guided-manager"
        key_path = root / "fixture path not a credential.txt"
        key_path.write_bytes(b"test-fixture-not-a-key")
        base = ["-NoProfile", "-File", str(extracted / "install.ps1"),
                "-InstallLocal", "-PromptForConnection", "-InstallDir", str(destination)]
        binding = ["-ExtensionId", "a" * 32, "-Consent", "accept-install"]
        env = {**os.environ, "LOCALAPPDATA": str(local)}
        for supplied, error in [
            ([], "consent_required"), (binding[2:], "invalid_extension_id"),
            (binding[:-1] + ["ACCEPT-INSTALL"], "consent_required"),
            (binding, "interactive_terminal_required"),
            (binding + ["-SetupRequest", str(request)], "invalid_manager_arguments"),
        ]:
            refused = subprocess.run([str(ps), "-NonInteractive", *base, *supplied],
                                     env=env, input="must not be read\n", capture_output=True, text=True, timeout=20)
            self.assertEqual(refused.returncode, 1, refused.stdout + refused.stderr)
            self.assertIn(f"agent_continue_install_failed: {error}", refused.stderr)
            self.assertNotIn("must not be read", refused.stdout + refused.stderr)
            self.assertFalse(destination.exists())
            self.assertFalse(local.exists())

        swapped = subprocess.run(["node", str(extracted / "bin.mjs"), "install-local",
            "--consent", "accept-install", "--install-dir", str(destination),
            "--setup-request", str(request), "--tunnel-id", "tunnel_" + "a" * 32,
            "--runtime-key-file", str(key_path), "--expected-extension-id", "b" * 32],
            env=env, capture_output=True, text=True, timeout=20)
        self.assertEqual(swapped.returncode, 1, swapped.stdout + swapped.stderr)
        self.assertEqual(json.loads(swapped.stdout), {"ok": False, "error": "setup_identity_mismatch"})
        self.assertFalse(destination.exists())

        command = ["node", str(extracted / "bin.mjs"), "install-local",
                   "--consent", "accept-install", "--install-dir", str(destination),
                   "--tunnel-id", "tunnel_" + "a" * 32, "--runtime-key-file", str(root / "missing-key")]
        for args, error in [
            ([], "invalid_arguments"),
            (["--guided-extension-id", "z" * 32], "setup_input_invalid"),
            (["--guided-extension-id", "a" * 32, "--setup-request", str(request)], "invalid_arguments"),
            (["--guided-extension-id", "a" * 32, "--expected-extension-id", "a" * 32], "invalid_arguments"),
            (["--guided-extension-id", "a" * 32], "setup_input_invalid"),
        ]:
            with self.subTest(guided_binding=args):
                refused = subprocess.run([*command, *args], env=env, capture_output=True, text=True, timeout=20)
                self.assertEqual(refused.returncode, 1, refused.stdout + refused.stderr)
                self.assertEqual(json.loads(refused.stdout), {"ok": False, "error": error})
                self.assertFalse(destination.exists())
                self.assertFalse(local.exists())

        if os.environ.get("AGENT_CONTINUE_TEST_GUIDED_PTY") != "1":
            return
        from winpty import PtyProcess
        # ConPTY reaches the real Read-Host branches, without a key, download or child launch.
        prompts = ["OpenAI tunnel ID", "runtime-key FILE PATH", "Type CONNECT"]
        answers = ["tunnel_" + "a" * 32, f'"{key_path}"']
        for shell in [str(ps), *filter(None, [shutil.which("pwsh")])]:
            for supplied, error in [([""], "setup_cancelled"),
                (["not-a-tunnel"], "setup_input_invalid"),
                ([answers[0], "C:relative.txt"], "setup_input_invalid"),
                ([answers[0], r"\\example.invalid\share\key.txt"], "setup_input_invalid"),
                ([answers[0], ""], "setup_cancelled"),
                (answers + ["no"], "setup_cancelled"),
                (answers + ["CONNECT"], "node_not_found")]:
                with self.subTest(shell=shell, error=error, prompts=len(supplied)):
                    offer_download = supplied[-1] == "no"
                    node_path = [] if offer_download else ["-NodePath", str(root / "missing-node.exe")]
                    terminal = PtyProcess.spawn([shell, *base, *binding, *node_path],
                                               env=env, dimensions=(30, 240))
                    terminal.fileobj.settimeout(10)
                    out = ""
                    try:
                        for marker, value in zip(prompts, supplied):
                            while marker not in out:
                                out += terminal.read()
                            terminal.write(value + "\r")
                        while f"agent_continue_install_failed: {error}" not in out:
                            out += terminal.read()
                        deadline = time.monotonic() + 5
                        while terminal.pty.isalive() and time.monotonic() < deadline:
                            time.sleep(0.05)
                        self.assertFalse(terminal.pty.isalive(), "PowerShell did not exit after reporting refusal")
                        self.assertEqual(terminal.exitstatus, 1, out)
                    except (EOFError, TimeoutError) as exc:
                        self.fail(f"{exc}: {out!r}")
                    finally:
                        terminal.close(force=True)
                    if offer_download:
                        self.assertIn("downloads and verifies the official portable Node ZIP", out)
                        self.assertIn("No EXE/MSI installer", out)
                        self.assertLess(out.index("official portable Node ZIP"), out.index("Type CONNECT"))
                    self.assertNotIn(key_path.name, out)
                    self.assertIn("Chrome extension ID: " + "a" * 32, out)
                    self.assertNotIn("exported Agent Continue setup JSON", out)
                    self.assertFalse(destination.exists())
                    self.assertFalse(local.exists())

    def test_guided_refusal_disables_engine_cache_but_still_detects_installer_writes(self):
        for write_kind in ("engine-cache", "installer-marker"):
            with self.subTest(write_kind=write_kind), tempfile.TemporaryDirectory(prefix="ac-guided-cache-") as temporary:
                root = Path(temporary).resolve()
                extracted = root / "extracted"
                extracted.mkdir()
                calls = []

                def refused(command, **kwargs):
                    env = kwargs["env"]
                    calls.append(command)
                    local = Path(env["LOCALAPPDATA"])
                    if write_kind == "installer-marker" or env.get("PSModuleAnalysisCachePath") != "NUL":
                        relative = "AgentContinue/installed.marker" if write_kind == "installer-marker" else \
                            "Microsoft/Windows/PowerShell/ModuleAnalysisCache"
                        target = local / relative
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(b"synthetic write")
                    error = "agent_continue_install_failed: interactive_terminal_required" if command[-1] == "a" * 32 else "invalid_arguments"
                    return subprocess.CompletedProcess(command, 1, "", error)

                probe = unittest.TestCase()
                with mock.patch.dict(os.environ, {"SystemRoot": str(root / "system"), "AGENT_CONTINUE_TEST_GUIDED_PTY": "0"}), \
                        mock.patch.object(shutil, "which", return_value=None), \
                        mock.patch.object(subprocess, "run", side_effect=refused):
                    run = lambda: SetupReleaseTests.check_guided_cmd(probe, root / "powershell/powershell.exe", extracted, root)
                    if write_kind == "installer-marker":
                        with self.assertRaisesRegex(AssertionError, "guided command changed the fixture tree"):
                            run()
                    else:
                        run()
                        self.assertEqual(len(calls), 3)
                        self.assertFalse((root / "guided-cmd/AppData/Local/Microsoft/Windows/PowerShell/ModuleAnalysisCache").exists())

    def test_guided_cmd_timeout_keeps_original_evidence_and_does_not_retry_installer(self):
        with tempfile.TemporaryDirectory(prefix="ac-guided-timeout-") as temporary:
            root = Path(temporary).resolve()
            extracted = root / "extracted"
            extracted.mkdir()
            calls = []

            def timed_out(command, **kwargs):
                calls.append((command, kwargs))
                if len(calls) == 1:
                    raise subprocess.TimeoutExpired(command, 20, output=b"original partial stdout\xff",
                                                    stderr=b"original partial stderr")
                return subprocess.CompletedProcess(command, 0, "engine-entered\ninstaller-parsed:0\n", "")

            observed = None
            with mock.patch.dict(os.environ, {"SystemRoot": str(root / "system")}), \
                    mock.patch.object(shutil, "which", return_value=None), \
                    mock.patch.object(subprocess, "run", side_effect=timed_out):
                try:
                    SetupReleaseTests.check_guided_cmd(unittest.TestCase(), root / "powershell/powershell.exe", extracted, root)
                except Exception as error:
                    observed = error
            self.assertIsInstance(observed, AssertionError, "timeout must include bounded phase diagnostics")
            report = json.loads(str(observed).split("guided_cmd_timeout: ", 1)[1])
            self.assertEqual(report["rootCause"], "unresolved")
            self.assertEqual(report["args"], ["a" * 32])
            self.assertEqual(report["timeoutSeconds"], 20)
            self.assertGreaterEqual(report["elapsedSeconds"], 0)
            self.assertIn("original partial stdout", report["stdout"])
            self.assertEqual(report["stderr"], "original partial stderr")
            self.assertEqual(report["fixtureChanges"], [])
            self.assertEqual(report["postTimeoutEngineProbe"]["stdout"], "engine-entered\ninstaller-parsed:0\n")
            self.assertEqual(report["postTimeoutEngineProbe"]["returncode"], 0)
            self.assertEqual(len(calls), 2, "the original installer must never be retried")
            original, probe = calls
            self.assertEqual(original[1]["timeout"], 20)
            self.assertEqual(original[1]["input"], "must not be read\n")
            self.assertEqual(probe[1]["timeout"], 3)
            self.assertEqual(probe[1]["input"], "")
            self.assertIn("-Command", probe[0])
            self.assertNotIn("-File", probe[0])
            self.assertEqual(probe[1]["env"]["AC_GUIDED_CMD_PROBE_INSTALLER"], str(extracted / "install.ps1"))
            self.assertNotIn("AC_GUIDED_CMD_PROBE_INSTALLER", original[1]["env"])
            for name in ("USERPROFILE", "LOCALAPPDATA", "APPDATA", "TEMP", "TMP", "PATH", "PSModuleAnalysisCachePath"):
                self.assertEqual(original[1]["env"][name], probe[1]["env"][name])

    def test_guided_cmd_timeout_probe_failure_preserves_original_and_fixture_changes(self):
        for probe_failure in ("timeout", "launch"):
            with self.subTest(probe_failure=probe_failure), tempfile.TemporaryDirectory(prefix="ac-guided-timeout-") as temporary:
                root = Path(temporary).resolve()
                extracted = root / "extracted"
                extracted.mkdir()
                calls = []

                def timed_out(command, **kwargs):
                    calls.append(command)
                    if len(calls) == 1:
                        local = Path(kwargs["env"]["LOCALAPPDATA"])
                        marker = local / "AgentContinue/installed.marker"
                        marker.parent.mkdir()
                        marker.write_bytes(b"synthetic forbidden write")
                        (local / "Microsoft/Windows/PowerShell/StartupProfileData-Interactive").write_bytes(b"engine startup")
                        raise subprocess.TimeoutExpired(command, 20, stderr=b"original refusal stalled")
                    if probe_failure == "timeout":
                        raise subprocess.TimeoutExpired(command, 3, output=b"engine-entered\n" + b"x" * 9000,
                                                        stderr=b"probe partial stderr")
                    raise OSError("synthetic probe launch failure")

                observed = None
                with mock.patch.dict(os.environ, {"SystemRoot": str(root / "system")}), \
                        mock.patch.object(shutil, "which", return_value=None), \
                        mock.patch.object(subprocess, "run", side_effect=timed_out):
                    try:
                        SetupReleaseTests.check_guided_cmd(unittest.TestCase(), root / "powershell/powershell.exe", extracted, root)
                    except Exception as error:
                        observed = error
                self.assertIsInstance(observed, AssertionError, "probe failure must not hide original timeout")
                report = json.loads(str(observed).split("guided_cmd_timeout: ", 1)[1])
                self.assertEqual(report["stderr"], "original refusal stalled")
                self.assertTrue(any(name.endswith("installed.marker") for name in report["fixtureChanges"]))
                self.assertFalse(any("StartupProfileData" in name for name in report["fixtureChanges"]))
                probe = report["postTimeoutEngineProbe"]
                self.assertEqual(probe["status"], probe_failure)
                self.assertLessEqual(len(probe.get("stdout", "")), 4096)
                if probe_failure == "timeout":
                    self.assertTrue(probe["stdout"].startswith("engine-entered\n"))
                    self.assertEqual(probe["stderr"], "probe partial stderr")
                self.assertEqual(len(calls), 2)

    def assert_guided_probe_observation(self, report, marker):
        probe = report["postTimeoutEngineProbe"]
        expected = ["engine-entered", "installer-parsed:0", "tls-ready", "utility-imported",
                    "archive-imported", "stdin-redirected:True"]
        self.assertIn(probe["status"], ("completed", "timeout"), probe)
        lines = probe["stdout"].splitlines()
        if probe["status"] == "completed":
            self.assertEqual(probe["returncode"], 0, probe)
            self.assertEqual(lines, expected)
        else:
            # The diagnostic budget is not a system-module performance contract.
            # A partial observation must still prove real parsing, not an empty timeout.
            self.assertNotIn("returncode", probe)
            self.assertGreaterEqual(len(lines), 2, probe)
            self.assertLessEqual(len(lines), len(expected), probe)
            self.assertEqual(lines, expected[:len(lines)])
        self.assertFalse(marker.exists(), "the phase probe must only parse the fixture installer")
        self.assertEqual(report["fixtureChanges"], [])

    def test_guided_cmd_timeout_retains_parsed_partial_probe_without_claiming_completion(self):
        with tempfile.TemporaryDirectory(prefix="ac-guided-probe-contract-") as temporary:
            marker = Path(temporary) / "must-not-execute.txt"
            observed_ci = {"status": "timeout", "stderr": "",
                           "stdout": "engine-entered\ninstaller-parsed:0\ntls-ready\n"}
            report = {"postTimeoutEngineProbe": observed_ci, "fixtureChanges": []}
            self.assert_guided_probe_observation(report, marker)
            self.assertEqual(observed_ci["status"], "timeout")
            self.assertNotIn("returncode", observed_ci)

    def test_guided_cmd_probe_contract_rejects_unobserved_parse_false_completion_and_writes(self):
        with tempfile.TemporaryDirectory(prefix="ac-guided-probe-contract-") as temporary:
            marker = Path(temporary) / "must-not-execute.txt"
            for probe in (
                    {"status": "timeout", "stdout": ""},
                    {"status": "timeout", "stdout": "engine-entered\n"},
                    {"status": "timeout", "stdout": "engine-entered\ninstaller-parsed:1\n"},
                    {"status": "timeout", "stdout": "installer-parsed:0\nengine-entered\n"},
                    {"status": "timeout", "stdout": "engine-entered\ninstaller-parsed:0\n", "returncode": 0},
                    {"status": "completed", "stdout": "engine-entered\ninstaller-parsed:0\n", "returncode": 0},
                    {"status": "completed", "stdout": "", "returncode": 1},
                    {"status": "launch", "stdout": "engine-entered\ninstaller-parsed:0\n"}):
                with self.subTest(probe=probe), self.assertRaises(AssertionError):
                    self.assert_guided_probe_observation({"postTimeoutEngineProbe": probe, "fixtureChanges": []}, marker)
            valid = {"status": "timeout", "stdout": "engine-entered\ninstaller-parsed:0\ntls-ready\n"}
            with self.assertRaises(AssertionError):
                self.assert_guided_probe_observation({"postTimeoutEngineProbe": valid,
                                                     "fixtureChanges": ["installed.marker"]}, marker)
            marker.write_text("synthetic forbidden execution")
            with self.assertRaises(AssertionError):
                self.assert_guided_probe_observation({"postTimeoutEngineProbe": valid, "fixtureChanges": []}, marker)

    @unittest.skipUnless(os.name == "nt", "Windows PowerShell read-only timeout phase probe")
    def test_guided_cmd_timeout_engine_probe_parses_but_never_executes_installer(self):
        with tempfile.TemporaryDirectory(prefix="ac-guided-timeout-") as temporary:
            root = Path(temporary).resolve()
            extracted = root / "extracted"
            extracted.mkdir()
            marker = extracted / "must-not-execute.txt"
            installer = extracted / "install.ps1"
            installer.write_text("[IO.File]::WriteAllText('" + str(marker).replace("'", "''") + "', 'unsafe')\n")
            ps = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
            real_run = subprocess.run
            calls = []

            def timed_out(command, **kwargs):
                calls.append(command)
                if len(calls) == 1:
                    raise subprocess.TimeoutExpired(command, 20)
                return real_run(command, **kwargs)

            observed = None
            with mock.patch.object(subprocess, "run", side_effect=timed_out):
                try:
                    SetupReleaseTests.check_guided_cmd(unittest.TestCase(), ps, extracted, root)
                except Exception as error:
                    observed = error
            self.assertIsInstance(observed, AssertionError)
            report = json.loads(str(observed).split("guided_cmd_timeout: ", 1)[1])
            self.assert_guided_probe_observation(report, marker)
            self.assertEqual(len(calls), 2)

    def test_release_workflow_carries_matching_setup_assets(self):
        workflow = (REPO / ".github/workflows/release.yml").read_text(encoding="utf-8")
        self.assertIn("scripts/build-setup-release.py --output dist/native-setup", workflow)
        self.assertIn('npm_config_pack_destination="$PWD/dist/npm-cli" npm pack', workflow)
        self.assertNotIn('gh release upload', workflow)
        for section in [workflow.split('gh release create', 1)[1]]:
            for name in ["agent-continue-setup.zip", "install.ps1", "SHA256SUMS.txt"]:
                self.assertIn("dist/native-setup/" + name, section)
            self.assertIn("dist/npm-cli/*.tgz", section)
            self.assertIn("dist/npm-cli/NPM-SHA256SUMS.txt", section)

    def test_extracted_release(self):
        with tempfile.TemporaryDirectory(prefix="ac-release-test-") as temporary:
            root = Path(temporary)
            output = root / "release"
            subprocess.run([sys.executable, str(REPO / "scripts/build-setup-release.py"),
                            "--source-only", "--output", str(output)], check=True, capture_output=True)
            sums = dict(line.split("  ", 1)[::-1] for line in
                        (output / "SHA256SUMS.txt").read_text().splitlines())
            archive = output / "agent-continue-setup.zip"
            release_version = json.loads((REPO / "manifest.json").read_text(encoding="utf-8"))["version"]
            installer = (output / "install.ps1").read_text(encoding="utf-8")
            self.assertIn(f"$script:acReleaseTag = 'v{release_version}'", installer)
            self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), sums[archive.name])
            extracted = root / "extracted"
            with zipfile.ZipFile(archive) as bundle:
                self.assertFalse(any(name.lower().endswith((".exe", ".msi")) for name in bundle.namelist()))
                self.assertTrue(all(info.date_time == (1980, 1, 1, 0, 0, 0) for info in bundle.infolist()))
                self.assertEqual((bundle.getinfo("bin.mjs").external_attr >> 16) & 0o777, 0o755)
                bundle.extractall(extracted)
                self.assertEqual(bundle.read("install.ps1"), (output / "install.ps1").read_bytes())
                inner_sums = dict(line.split("  ", 1)[::-1] for line in
                                  bundle.read("SHA256SUMS.txt").decode("ascii").splitlines())
                self.assertNotIn(archive.name, inner_sums)
                self.assertEqual(inner_sums, {name: value for name, value in sums.items() if name != archive.name})
            for name, digest in sums.items():
                if name != archive.name:
                    self.assertEqual(hashlib.sha256((extracted / name).read_bytes()).hexdigest(), digest)
            repeated = root / "repeated"
            subprocess.run([sys.executable, str(REPO / "scripts/build-setup-release.py"),
                            "--source-only", "--output", str(repeated)], check=True, capture_output=True)
            for name in (archive.name, "SHA256SUMS.txt", "install.ps1"):
                self.assertEqual((output / name).read_bytes(), (repeated / name).read_bytes())
            def cli(*args):
                return subprocess.run(["node", str(extracted / "bin.mjs"), *args],
                                      cwd=extracted, capture_output=True, text=True, timeout=20)
            help_result = cli("help")
            self.assertEqual(help_result.returncode, 0)
            self.assertIn("register", json.loads(help_result.stdout)["commands"])
            self.assertIn("install-local", json.loads(help_result.stdout)["commands"])
            self.assertIn("setup-server", json.loads(help_result.stdout)["commands"])
            self.assertIn("manager-control", json.loads(help_result.stdout)["commands"])
            self.assertIn("manager-browser", json.loads(help_result.stdout)["commands"])
            self.assertIn("register-browser-wake", json.loads(help_result.stdout)["commands"])
            self.assertIn("browser-control.mjs", inner_sums)
            self.assertIn("browser-wake-registration.mjs", inner_sums)
            unconsented_wake = cli("register-browser-wake", "--install-dir", str(root / "absent"),
                                   "--extension-id", "a" * 32, "--consent", "no")
            self.assertEqual(unconsented_wake.returncode, 1)
            self.assertEqual(json.loads(unconsented_wake.stdout), {"ok": False, "error": "consent_required"})
            unconsented_browser = cli("manager-browser", "--install-dir", str(root / "absent"), "--consent", "no")
            self.assertEqual(unconsented_browser.returncode, 1)
            self.assertEqual(json.loads(unconsented_browser.stdout), {"ok": False, "error": "consent_required"})
            registration = root / "fixture"
            registration.mkdir()
            (registration / "native-host.json").write_text("{}")
            plan = cli("register", "--os", "windows", "--install-dir", str(registration),
                       "--extension-id", "a" * 32, "--view", "64")
            self.assertEqual(plan.returncode, 0, plan.stdout)
            self.assertEqual(json.loads(plan.stdout)["mode"], "dry-run")
            if os.name == "nt":
                unattended = cli("manager-browser", "--install-dir", str(root / "absent"), "--consent", "accept-control")
                self.assertEqual(unattended.returncode, 1)
                self.assertEqual(json.loads(unattended.stdout), {"ok": False, "error": "interactive_terminal_required"})
                ps = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
                wrong_consent = subprocess.run([str(ps), "-NoProfile", "-NonInteractive", "-File",
                    str(extracted / "install.ps1"), "-DeviceAction", "register-browser-wake",
                    "-ExtensionId", "a" * 32, "-Consent", "accept-control"],
                    capture_output=True, text=True, timeout=20)
                self.assertEqual(wrong_consent.returncode, 1)
                self.assertIn("consent_required", wrong_consent.stderr)
                cmd = subprocess.run(["cmd.exe", "/d", "/c", "install.cmd", "help"],
                                     cwd=extracted, capture_output=True, text=True, timeout=20)
                self.assertEqual(cmd.returncode, 0, cmd.stderr)
                self.assertIn("install-local", json.loads(cmd.stdout)["commands"])
                request = root / "setup-request.json"
                request.write_bytes((json.dumps({
                    "format": "agent-continue-device-setup", "version": 1, "target": "windows",
                    "extensionId": "a" * 32, "nativeHost": "com.agentcontinue.device_control"
                }, indent=2) + "\n").encode("utf-8"))
                self.check_guided_cmd(ps, extracted, root)
                self.check_guided_windows(ps, extracted, root, request)
                cache = os.environ.get("AGENT_CONTINUE_TEST_NPM_CACHE")
                if cache:
                    installed = root / "command-install"
                    staged = subprocess.run([
                        "node", str(extracted / "bin.mjs"), "install-local", "--consent", "accept-install",
                        "--setup-request", str(request), "--install-dir", str(installed), "--offline-cache", cache
                    ], cwd=extracted, capture_output=True, text=True, timeout=75)
                    self.assertEqual(staged.returncode, 0, staged.stdout + staged.stderr)
                    self.assertEqual(json.loads(staged.stdout), {
                        "ok": True, "action": "install-local", "mode": "command-only", "configured": False,
                        "registered": False, "connected": False, "manager": None,
                        "chatAuthorizationVerified": False
                    })
                    self.assertTrue((installed / "manager-receipt.json").is_file())
                    for name in ("native-host.json", "native-launcher.exe", "state/device-channel.json", "client"):
                        self.assertFalse((installed / name).exists(), name)
                    observed = subprocess.run([str(ps), "-NoProfile", "-NonInteractive", "-File",
                        str(extracted / "install.ps1"), "-DeviceAction", "status", "-InstallDir", str(installed),
                        "-NodePath", shutil.which("node")], capture_output=True, text=True, timeout=25)
                    self.assertEqual(observed.returncode, 1, observed.stdout + observed.stderr)
                    status = json.loads(observed.stdout)
                    self.assertEqual(status["error"], "manager_control_unconfirmed")
                    self.assertFalse((installed / "state/device-channel.json").exists())
                # Optional live check: a broken Node shim is visible only to this child.
                # The fixture uses no tunnel or credentials and cannot register a host.
                if os.environ.get("AGENT_CONTINUE_TEST_PORTABLE_INSTALL") == "1":
                    shim = root / "broken-node"
                    shim.mkdir()
                    (shim / "node.cmd").write_bytes(b"@echo off\r\necho broken Node shim\r\nexit /b 1\r\n")
                    local = root / "portable-local-data"
                    installed = local / "AgentContinue"
                    env = {**os.environ, "PATH": os.pathsep.join((str(shim), str(ps.parent),
                           str(Path(os.environ["SystemRoot"]) / "System32"))), "LOCALAPPDATA": str(local)}
                    provisioned = subprocess.run([str(ps), "-NoProfile", "-NonInteractive", "-File",
                        str(extracted / "install.ps1"), "-InstallLocal", "-Consent", "accept-install",
                        "-SetupRequest", str(request)], cwd=extracted, env=env, capture_output=True,
                        text=True, timeout=220)
                    self.assertEqual(provisioned.returncode, 0, provisioned.stdout + provisioned.stderr)
                    receipt = json.loads(provisioned.stdout)
                    self.assertTrue(receipt["ok"])
                    self.assertEqual(receipt["mode"], "command-only")
                    for key in ("registered", "connected", "chatAuthorizationVerified"):
                        self.assertIs(receipt[key], False)
                    self.assertTrue((installed / "manager-receipt.json").is_file())
                    self.assertEqual(len(list((local / "AgentContinueToolchain").glob("node-*/node.exe"))), 1)
                    self.assertFalse((installed / "native-host.json").exists())
                result = subprocess.run([str(ps), "-NoProfile", "-NonInteractive", "-File",
                    str(extracted / "install.ps1"), "-InstallLocal", "-InstallDir", str(root / "absent")],
                    capture_output=True, text=True, timeout=20)
                self.assertEqual(result.returncode, 1)
                self.assertIn("consent_required", result.stderr)
                self.assertFalse((root / "absent").exists())
                planned = subprocess.run([str(ps), "-NoProfile", "-NonInteractive", "-File",
                    str(extracted / "install.ps1"), "-ExtensionId", "a" * 32,
                    "-NodePath", shutil.which("node"), "-InstallDir", str(root / "absent")],
                    capture_output=True, text=True, timeout=20)
                self.assertEqual(planned.returncode, 0, planned.stderr)
                planned_receipt = json.loads(planned.stdout)
                self.assertEqual(planned_receipt["action"], "plan")
                self.assertEqual(planned_receipt["payloadChecked"], len(sums) - 1)
                self.assertFalse((root / "absent").exists())
                modified = extracted / "payload/runtime.mjs"
                modified.write_bytes(modified.read_bytes() + b"\n// fixture tamper\n")
                refused = subprocess.run([str(ps), "-NoProfile", "-NonInteractive", "-File",
                    str(extracted / "install.ps1"), "-ExtensionId", "a" * 32,
                    "-NodePath", shutil.which("node"), "-InstallDir", str(root / "absent")],
                    capture_output=True, text=True, timeout=20)
                self.assertEqual(refused.returncode, 1)
                self.assertIn("payload_digest_mismatch", refused.stderr)
                self.assertFalse((root / "absent").exists())

                local = root / "local-app-data"
                refused_install = subprocess.run([str(ps), "-NoProfile", "-NonInteractive", "-File",
                    str(extracted / "install.ps1"), "-InstallLocal", "-Consent", "accept-install",
                    "-SetupRequest", str(request), "-NodePath", str(root / "missing-node.exe"),
                    "-InstallDir", str(root / "absent")], env={**os.environ, "LOCALAPPDATA": str(local)},
                    capture_output=True, text=True, timeout=20)
                self.assertEqual(refused_install.returncode, 1)
                self.assertIn("payload_digest_mismatch", refused_install.stderr)
                self.assertFalse(local.exists())
                self.assertFalse((root / "absent").exists())


if __name__ == "__main__":
    unittest.main()
