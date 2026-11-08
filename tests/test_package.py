"""Offline release archive regression tests; no browser or private inputs."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("release_package", ROOT / "scripts/package.py")
package = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(package)

PUBLIC_DOCS = (
    "docs/COMPOSER-PRIORITY.md",
    "docs/FILE_FORMATS.md",
    "docs/ROADMAP.md",
    "docs/STORE-LISTING.en.md",
    "docs/releases/2.2.1.md",
    "docs/store-2.1.0-en-console.png",
    "docs/store-2.1.0-en-popup.png",
)


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        cache = {}
        names = set(package.RUNTIME_FILES) | set(package.SOURCE_FILES) | set(PUBLIC_DOCS)
        names |= package.verified_vendor_files(ROOT, cache)
        for name in names:
            destination = self.root / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(package.read_public(ROOT, name, cache))
        for folder in ("tests", "scripts", ".github"):
            (self.root / folder).mkdir(exist_ok=True)
        self.manifest_path = self.root / "manifest.json"
        self.device_manifest = json.loads(self.manifest_path.read_bytes())
        stable = json.loads(self.manifest_path.read_bytes())
        stable["optional_permissions"].remove("nativeMessaging")
        stable["content_security_policy"]["extension_pages"] = stable["content_security_policy"]["extension_pages"].split("; frame-src")[0]
        stable.pop("key", None)
        self.manifest_path.write_text(json.dumps(stable), encoding="utf-8")

    def test_archive_layouts_and_manifest_resources(self):
        for source in (False, True):
            for store in (False, True):
                with self.subTest(source=source, store=store):
                    output = package.package_release(self.root, include_source=source, store=store)
                    first = output.read_bytes()
                    self.assertEqual(first, package.package_release(
                        self.root, include_source=source, store=store).read_bytes())
                    with zipfile.ZipFile(output) as archive:
                        prefix = "" if store else "AgentContinue/"
                        names = archive.namelist()
                        self.assertTrue(all(name.startswith(prefix) for name in names))
                        self.assertIn(prefix + "content.js", names)
                        manifest = json.loads(archive.read(prefix + "manifest.json"))
                        relative = {name[len(prefix):] for name in names}
                        package.validate_manifest_files(manifest, relative)
                        self.assertFalse(any(part.lower() == "private" for name in names
                                             for part in Path(name).parts))
                        self.assertEqual("manifest.json" in names, store)

    def test_missing_content_file_is_rejected(self):
        (self.root / "content.js").unlink()
        with self.assertRaisesRegex(package.PackageError, "content.js"):
            package.package_release(self.root)
        self.assertFalse((self.root / "dist").exists())

    def test_only_reviewed_public_docs_are_read_and_packaged(self):
        # These ordinary eligible files are untracked in the temporary fixture.
        private_docs = (
            "docs/DEVELOPMENT-HANDOFF.md",
            "docs/RUNTIME-ACCEPTANCE.md",
            "docs/DEVICE-CONTROL.md",
            "docs/INSTALL-DESIGN.md",
            "docs/INSTALL-IMPLEMENTATION.md",
            "docs/REGISTRATION-REHEARSAL.md",
            "docs/WINDOWS-ADMIN-CONTROL-COMPLETION-DESIGN.md",
            "docs/WINDOWS-PREVIEW-START.md",
            "docs/WINDOWS-PREVIEW-PRIVACY.md",
            "docs/incidents/diagnostics.md",
            "docs/incidents/capture.png",
            "docs/plans/candidate-results.md",
            "docs/releases/next-candidate.md",
            "docs/new-public-guide.md",
        )
        for name in private_docs:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"Synthetic operational material; never publish.\n")

        read_public = package.read_public

        def checked_read(root, filename, cache):
            self.assertNotIn(filename, private_docs, "Excluded documentation must not be read")
            return read_public(root, filename, cache)

        with patch.object(package, "read_public", side_effect=checked_read):
            for source in (False, True):
                for store in (False, True):
                    with self.subTest(source=source, store=store):
                        output = package.package_release(self.root, include_source=source, store=store)
                        with zipfile.ZipFile(output) as archive:
                            prefix = "" if store else "AgentContinue/"
                            docs = {name[len(prefix):] for name in archive.namelist()
                                    if name.startswith(prefix + "docs/")}
                            self.assertEqual(docs, set(PUBLIC_DOCS))
                            for name in PUBLIC_DOCS:
                                expected = (self.root / name).read_bytes()
                                if Path(name).suffix == ".md":
                                    expected = expected.replace(b"\r\n", b"\n")
                                self.assertEqual(archive.read(prefix + name), expected)

    def test_missing_reviewed_public_doc_is_rejected_before_output(self):
        (self.root / "docs/COMPOSER-PRIORITY.md").unlink()
        with self.assertRaisesRegex(package.PackageError, "COMPOSER-PRIORITY.md"):
            package.package_release(self.root, include_source=True)
        self.assertFalse((self.root / "dist").exists())

    def test_explicit_store_output_does_not_touch_default_dist(self):
        output_directory = self.root / "isolated-artifacts"
        output = package.package_release(self.root, store=True, output_directory=output_directory)
        self.assertEqual(output.parent, output_directory)
        self.assertFalse((self.root / "dist").exists())
        with zipfile.ZipFile(output) as archive:
            self.assertIn("setup.html", archive.namelist())
            self.assertFalse(any(name.startswith("tests/") for name in archive.namelist()))

    def test_windows_and_ci_line_endings_produce_identical_archive(self):
        output = package.package_release(self.root, store=True)
        before = output.read_bytes()
        target = self.root / "popup.js"
        target.write_bytes(target.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))
        self.assertEqual(before, package.package_release(self.root, store=True).read_bytes())

    def test_github_and_store_release_payloads_match(self):
        github = package.package_release(self.root)
        store = package.package_release(self.root, store=True)
        version = self.device_manifest["version"]
        package.verify_distribution_pair(github, store, version)
        with self.assertRaisesRegex(package.PackageError, "version"):
            package.verify_distribution_pair(github, store, "999.0.0")

        source = self.root / "content.js"
        source.write_bytes(source.read_bytes() + b"\n// Store-only drift\n")
        changed = package.package_release(self.root, store=True)
        with self.assertRaisesRegex(package.PackageError, "different bytes"):
            package.verify_distribution_pair(github, changed, version)

    def test_distribution_pair_rejects_duplicate_and_case_colliding_members(self):
        github = package.package_release(self.root)
        store = package.package_release(self.root, store=True)
        version = self.device_manifest["version"]
        with zipfile.ZipFile(store, "a") as archive:
            archive.writestr("MANIFEST.JSON", archive.read("manifest.json"))
        with self.assertRaisesRegex(package.PackageError, "Duplicate"):
            package.verify_distribution_pair(github, store, version)

    def test_manifest_reference_not_in_allowlist_is_rejected(self):
        manifest_path = self.root / "manifest.json"
        manifest = json.loads(manifest_path.read_bytes())
        manifest["content_scripts"][0]["js"].append("missing-runtime.js")
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(package.PackageError, "missing-runtime.js"):
            package.package_release(self.root, store=True)
        self.assertFalse((self.root / "dist").exists())

    def test_allowlist_omission_is_rejected(self):
        with patch.object(package, "RUNTIME_FILES", tuple(
                name for name in package.RUNTIME_FILES if name != "content.js")):
            with self.assertRaisesRegex(package.PackageError, "content.js"):
                package.package_release(self.root)

    def test_private_members_are_rejected(self):
        with self.assertRaises(package.PackageError):
            package.validate_manifest_files({}, {"private/secret.txt"})
        with self.assertRaises(package.PackageError):
            package.validate_manifest_files({"background": {"service_worker": "private/secret.js"}},
                                            {"background.js"})

    def test_device_candidate_cannot_take_the_stable_or_store_filename(self):
        self.manifest_path.write_text(json.dumps(self.device_manifest), encoding="utf-8")
        for store in (False, True):
            with self.subTest(store=store), self.assertRaisesRegex(package.PackageError, "use --windows-preview"):
                package.package_release(self.root, store=store)
        self.assertFalse((self.root / "dist").exists())

    def test_windows_preview_has_its_own_identity_label_and_privacy_scope(self):
        self.manifest_path.write_text(json.dumps(self.device_manifest), encoding="utf-8")
        privacy = self.root / package.WINDOWS_PREVIEW_PRIVACY
        privacy.write_text("Synthetic Windows preview privacy statement.\n", encoding="utf-8")
        (self.root / "docs" / "DEVELOPMENT-HANDOFF.md").write_text("unshipped maintainer material", encoding="utf-8")
        output = package.package_release(self.root, windows_preview=True)
        self.assertEqual(output.name, f"agent-continue-{self.device_manifest['version']}-windows-device-preview.zip")
        with zipfile.ZipFile(output) as archive:
            self.assertNotIn("manifest.json", archive.namelist())
            manifest = json.loads(archive.read("AgentContinue/manifest.json"))
            self.assertNotIn("key", manifest)
            self.assertIn("Windows device preview", manifest["version_name"])
            self.assertEqual(manifest["optional_permissions"], self.device_manifest["optional_permissions"])
            self.assertEqual(archive.read("AgentContinue/PRIVACY.md"), b"Synthetic Windows preview privacy statement.\n")
            self.assertFalse(any(name.endswith(("DEVELOPMENT-HANDOFF.md", "DEVICE-CONTROL.md")) for name in archive.namelist()))
        for options in ({"store": True}, {"include_source": True}):
            with self.subTest(options=options), self.assertRaisesRegex(package.PackageError, "unpacked candidate"):
                package.package_release(self.root, windows_preview=True, **options)

    def prepare_windows_release(self, version="3.0.0"):
        manifest = dict(self.device_manifest, version=version)
        manifest.pop("version_name", None)
        self.manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        (self.root / "PRIVACY.md").write_text(
            f"Canonical public Windows privacy for v{version}.\n"
            "Optional nativeMessaging; selected-account file/shell/process access.\n"
            "Separate OS/platform grants, official transport, Pause and Revoke.\n",
            encoding="utf-8")
        return manifest

    def test_windows_release_builds_and_verifies_both_layouts_from_one_snapshot(self):
        manifest = self.prepare_windows_release()
        original = self.manifest_path.read_bytes()
        verify_pair = package.verify_distribution_pair

        def checked_pair(github, store, version):
            # Mutating an input after capture cannot split the two inventories.
            (self.root / "content.js").write_bytes(b"changed after capture")
            verify_pair(github, store, version)

        with patch.object(package, "verify_distribution_pair", side_effect=checked_pair) as verify:
            output = package.package_release(self.root, windows_release=True)
        store = output.with_name("agent-continue-3.0.0-store.zip")
        self.assertEqual(output.name, "agent-continue-3.0.0.zip")
        verify.assert_called_once()
        self.assertEqual(verify.call_args.args[2], "3.0.0")
        verify_pair(output, store, "3.0.0")
        self.assertEqual(self.manifest_path.read_bytes(), original)
        for path, prefix in ((output, "AgentContinue/"), (store, "")):
            with self.subTest(path=path), zipfile.ZipFile(path) as archive:
                shipped = json.loads(archive.read(prefix + "manifest.json"))
                self.assertNotIn("version_name", shipped)
                self.assertNotIn("key", shipped)
                self.assertEqual(shipped["optional_permissions"], manifest["optional_permissions"])
                self.assertEqual(shipped["content_security_policy"], manifest["content_security_policy"])
                self.assertEqual(archive.read(prefix + "PRIVACY.md"),
                                 (self.root / "PRIVACY.md").read_bytes().replace(b"\r\n", b"\n"))
                self.assertFalse(any("WINDOWS-PREVIEW" in name for name in archive.namelist()))

    def test_windows_release_store_selector_still_builds_verified_pair(self):
        self.prepare_windows_release()
        output = package.package_release(self.root, windows_release=True, store=True)
        self.assertEqual(output.name, "agent-continue-3.0.0-store.zip")
        package.verify_distribution_pair(output.with_name("agent-continue-3.0.0.zip"), output, "3.0.0")

    def test_setup_entry_projection_is_identical_in_both_archives_without_source_writes(self):
        self.prepare_windows_release()
        original = (self.root / "setup-entry-release.js").read_bytes()
        descriptor = {"format": "agent-continue-windows-setup-entry", "version": 1,
                      "releaseTag": "v3.0.0", "entryUrl": package.SOURCE_REPOSITORY + "/releases/download/v3.0.0/install.ps1",
                      "entrySha256": "a" * 64, "sumsSha256": "b" * 64}
        result = type("Result", (), {"returncode": 0, "stderr": b"", "stdout": json.dumps(descriptor).encode()})()
        with patch.object(package.shutil, "which", return_value="node"), \
                patch.object(package.subprocess, "run", return_value=result) as run:
            github = package.package_release(self.root, windows_release=True,
                setup_release_dir=self.root / "sidecars", setup_release_receipt=self.root / "receipt.json")
        self.assertIn("--setup-entry-json", run.call_args.args[0])
        self.assertEqual(run.call_args.kwargs["timeout"], 45)
        with zipfile.ZipFile(github) as archive, zipfile.ZipFile(github.with_name("agent-continue-3.0.0-store.zip")) as store:
            projected = archive.read("AgentContinue/setup-entry-release.js")
            self.assertEqual(projected, store.read("setup-entry-release.js"))
            self.assertIn(b"Object.freeze", projected)
            self.assertIn(descriptor["entrySha256"].encode(), projected)
        self.assertEqual((self.root / "setup-entry-release.js").read_bytes(), original)

    def test_setup_entry_projection_refuses_invalid_child_results_and_incomplete_options(self):
        for kwargs in ({"setup_release_dir": self.root}, {"setup_release_receipt": self.root / "receipt.json"}):
            with self.subTest(kwargs=kwargs), self.assertRaises(package.PackageError):
                package.package_release(self.root, **kwargs)
        for output, status, errors in ((b"{}", 0, b""), (b"not-json", 0, b""), (b"{}", 1, b"bad")):
            result = type("Result", (), {"returncode": status, "stderr": errors, "stdout": output})()
            with patch.object(package.shutil, "which", return_value="node"), \
                    patch.object(package.subprocess, "run", return_value=result), self.assertRaises(package.PackageError):
                package.project_setup_entry(self.root, self.root / "receipt.json", "3.0.0")

    def test_windows_release_requires_new_identity_and_preserves_scheduler_assets(self):
        output_dir = self.root / "outputs"
        output_dir.mkdir()
        scheduler = output_dir / "agent-continue-2.2.1.zip"
        scheduler.write_bytes(b"existing scheduler artifact")
        for version in ("0.9.0", "2.1.9", "2.2.0", "2.2.1", "02.2.2", "2.2.65536"):
            self.prepare_windows_release(version)
            with self.subTest(version=version), self.assertRaisesRegex(package.PackageError, "version|identity"):
                package.package_release(self.root, windows_release=True, output_directory=output_dir)
            self.assertEqual(list(output_dir.iterdir()), [scheduler])
            self.assertEqual(scheduler.read_bytes(), b"existing scheduler artifact")
        for version in ("2.2.2", "2.10.0", "3.0.0"):
            self.prepare_windows_release(version)
            output = package.package_release(self.root, windows_release=True, output_directory=output_dir)
            self.assertEqual(output.name, f"agent-continue-{version}.zip")

    def test_public_and_preview_modes_are_mutually_exclusive(self):
        self.prepare_windows_release()
        with self.assertRaisesRegex(package.PackageError, "cannot combine|mutually exclusive"):
            package.package_release(self.root, windows_preview=True, windows_release=True)
        self.assertFalse((self.root / "dist").exists())
        with patch("sys.argv", ["package.py", "--windows-preview", "--windows-release"]), \
                patch("sys.stderr", new_callable=io.StringIO), self.assertRaises(SystemExit) as error:
            package.main()
        self.assertEqual(error.exception.code, 2)

    def test_windows_release_does_not_silently_convert_a_preview(self):
        manifest = self.prepare_windows_release()
        for label in ("3.0.0 Windows device preview", "3.0.0 WINDOWS CANDIDATE"):
            self.manifest_path.write_text(json.dumps(dict(manifest, version_name=label)), encoding="utf-8")
            with self.subTest(label=label), self.assertRaisesRegex(package.PackageError, "preview|candidate"):
                package.package_release(self.root, windows_release=True)
        self.assertFalse((self.root / "dist").exists())

    def test_windows_release_rejects_unreviewed_native_and_loopback_scope(self):
        manifest = self.prepare_windows_release()
        mutations = []
        required_native = json.loads(json.dumps(manifest))
        required_native["permissions"].append("nativeMessaging")
        mutations.append(required_native)
        no_native = json.loads(json.dumps(manifest))
        no_native["optional_permissions"].remove("nativeMessaging")
        mutations.append(no_native)
        extra_optional = json.loads(json.dumps(manifest))
        extra_optional["optional_permissions"].append("debugger")
        mutations.append(extra_optional)
        for before, after in (("127.0.0.1", "localhost"),
                              ("http://127.0.0.1:*", "http://*:*"),
                              ("connect-src 'self'", "connect-src 'self' http://127.0.0.1:*"),
                              ("frame-src 'self' http://127.0.0.1:*", "frame-src 'self'")):
            changed = json.loads(json.dumps(manifest))
            changed["content_security_policy"]["extension_pages"] = (
                changed["content_security_policy"]["extension_pages"].replace(before, after))
            mutations.append(changed)
        for index, changed in enumerate(mutations):
            self.manifest_path.write_text(json.dumps(changed), encoding="utf-8")
            with self.subTest(index=index), self.assertRaisesRegex(package.PackageError, "optional|scope|CSP|nativeMessaging"):
                package.package_release(self.root, windows_release=True)
        self.assertFalse((self.root / "dist").exists())

    def test_required_native_permission_cannot_bypass_explicit_mode(self):
        manifest = self.prepare_windows_release()
        manifest["optional_permissions"].remove("nativeMessaging")
        manifest["permissions"].append("nativeMessaging")
        manifest["content_security_policy"]["extension_pages"] = (
            manifest["content_security_policy"]["extension_pages"].split("; frame-src")[0])
        self.manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(package.PackageError, "explicit|windows-preview|windows-release"):
            package.package_release(self.root, store=True)
        self.assertFalse((self.root / "dist").exists())

    def test_windows_release_preserves_all_public_input_guards(self):
        manifest = self.prepare_windows_release()
        checks = (
            ("preset.js", b"export const BUNDLED_PROMPT = 'private';", "BUNDLED_PROMPT"),
            ("_locales/zh_CN/messages.json", b"{}", "translation"),
            ("vendor/pdfjs/pdf.mjs", b"tampered", "integrity"),
            ("manifest.json", json.dumps(dict(manifest, default_locale="zh_CN")).encode(), "English"),
        )
        for name, invalid, message in checks:
            target = self.root / name
            original = target.read_bytes()
            try:
                target.write_bytes(invalid)
                with self.subTest(name=name), self.assertRaisesRegex(package.PackageError, message):
                    package.package_release(self.root, windows_release=True)
                self.assertFalse((self.root / "dist").exists())
            finally:
                target.write_bytes(original)
        (self.root / "PRIVACY.md").unlink()
        with self.assertRaisesRegex(package.PackageError, "PRIVACY.md"):
            package.package_release(self.root, windows_release=True)
        self.assertFalse((self.root / "dist").exists())

    def test_windows_source_is_extension_scoped_and_pins_full_reproduction_repository(self):
        self.prepare_windows_release()
        revision = "a1" * 20
        private = self.root / "native/bootstrap/private"
        private.mkdir()
        (private / "secret.mjs").write_text("never read", encoding="utf-8")
        (self.root / "native/bootstrap/unreviewed.mjs").write_text("never read", encoding="utf-8")
        with patch.object(package, "read_public", wraps=package.read_public) as read:
            output = package.package_release(self.root, windows_release=True, include_source=True,
                                             source_revision=revision)
        self.assertEqual(output.name, "agent-continue-3.0.0-source.zip")
        self.assertFalse(any(call.args[1].endswith(("secret.mjs", "unreviewed.mjs"))
                             for call in read.call_args_list))
        with zipfile.ZipFile(output) as archive:
            scope = archive.read("AgentContinue/SOURCE-SCOPE.md").decode()
            self.assertIn("extension-scoped", scope)
            self.assertIn("not a complete Windows", scope)
            self.assertIn(f"https://github.com/1235357/agent-continue/tree/{revision}", scope)
            self.assertIn("publication", scope)
            self.assertFalse(any(name.endswith(("secret.mjs", "unreviewed.mjs")) for name in archive.namelist()))
        github = output.with_name("agent-continue-3.0.0.zip")
        store = output.with_name("agent-continue-3.0.0-store.zip")
        package.verify_distribution_pair(github, store, "3.0.0")
        with zipfile.ZipFile(store) as archive:
            self.assertNotIn("SOURCE-SCOPE.md", archive.namelist())
            self.assertNotIn("package.json", archive.namelist())

    def test_windows_source_requires_explicit_immutable_source_pin(self):
        self.prepare_windows_release()
        for revision in (None, "main", "v3.0.0", "abc123", "../private", "g" * 40):
            with self.subTest(revision=revision), self.assertRaisesRegex(package.PackageError, "source.*revision|commit"):
                package.package_release(self.root, windows_release=True, include_source=True,
                                        source_revision=revision)
        self.assertFalse((self.root / "dist").exists())

    def test_windows_release_cli_reports_both_local_archives_not_publication(self):
        self.prepare_windows_release()
        with patch.object(package, "ROOT", self.root), \
                patch("sys.argv", ["package.py", "--windows-release"]), \
                patch("sys.stdout", new_callable=io.StringIO) as output:
            package.main()
        lines = output.getvalue().splitlines()
        self.assertEqual({Path(line).name for line in lines},
                         {"agent-continue-3.0.0.zip", "agent-continue-3.0.0-store.zip"})

    def test_pair_output_paths_are_checked_before_replacing_any_archive(self):
        self.prepare_windows_release()
        output_dir = self.root / "outputs"
        output_dir.mkdir()
        github = output_dir / "agent-continue-3.0.0.zip"
        github.write_bytes(b"previous local build")
        (output_dir / "agent-continue-3.0.0-store.zip").mkdir()
        with self.assertRaisesRegex(package.PackageError, "non-file"):
            package.package_release(self.root, windows_release=True, output_directory=output_dir)
        self.assertEqual(github.read_bytes(), b"previous local build")

    def test_windows_release_rejects_unsafe_permission_and_label_shapes(self):
        manifest = self.prepare_windows_release()
        changes = (
            {"permissions": manifest["permissions"] + ["debugger"]},
            {"optional_permissions": None},
            {"optional_permissions": "nativeMessaging"},
            {"optional_permissions": ["nativeMessaging", "power", "power"]},
            {"version_name": None},
            {"version_name": ["public"]},
            {"host_permissions": manifest["host_permissions"] + ["http://127.0.0.1/*"]},
            {"optional_host_permissions": ["<all_urls>"]},
        )
        for change in changes:
            self.manifest_path.write_text(json.dumps(dict(manifest, **change)), encoding="utf-8")
            with self.subTest(change=change), self.assertRaisesRegex(package.PackageError, "scope|optional|version_name"):
                package.package_release(self.root, windows_release=True)
        self.assertFalse((self.root / "dist").exists())

    def test_pair_verification_failure_preserves_outputs_and_removes_staging(self):
        self.prepare_windows_release()
        output_dir = self.root / "outputs"
        output_dir.mkdir()
        outputs = (output_dir / "agent-continue-3.0.0.zip",
                   output_dir / "agent-continue-3.0.0-store.zip")
        for output in outputs:
            output.write_bytes(b"previous local build")
        with patch.object(package, "verify_distribution_pair", side_effect=package.PackageError("pair rejected")):
            with self.assertRaisesRegex(package.PackageError, "pair rejected"):
                package.package_release(self.root, windows_release=True, output_directory=output_dir)
        self.assertEqual(set(output_dir.iterdir()), set(outputs))
        self.assertTrue(all(output.read_bytes() == b"previous local build" for output in outputs))
        self.assertFalse((self.root / "dist").exists())

    def test_windows_release_pair_is_deterministic_across_line_endings(self):
        self.prepare_windows_release()
        output_dir = self.root / "isolated"
        github = package.package_release(self.root, windows_release=True, output_directory=output_dir)
        store = github.with_name("agent-continue-3.0.0-store.zip")
        before = (github.read_bytes(), store.read_bytes())
        target = self.root / "popup.js"
        target.write_bytes(target.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))
        package.package_release(self.root, windows_release=True, output_directory=output_dir)
        self.assertEqual(before, (github.read_bytes(), store.read_bytes()))
        self.assertFalse((self.root / "dist").exists())

    def test_windows_release_cannot_omit_a_manifest_resource(self):
        self.prepare_windows_release()
        with patch.object(package, "RUNTIME_FILES", tuple(
                name for name in package.RUNTIME_FILES if name != "content.js")):
            with self.assertRaisesRegex(package.PackageError, "content.js"):
                package.package_release(self.root, windows_release=True)
        self.assertFalse((self.root / "dist").exists())

    def test_windows_release_manifest_cannot_borrow_source_only_members(self):
        manifest = self.prepare_windows_release()
        manifest["background"]["service_worker"] = "native/bootstrap/browser-control.mjs"
        self.manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(package.PackageError, "browser-control.mjs"):
            package.package_release(self.root, windows_release=True, include_source=True,
                                    source_revision="a1" * 20)
        self.assertFalse((self.root / "dist").exists())

    def test_windows_release_source_cli_forwards_pin_and_lists_all_three_outputs(self):
        self.prepare_windows_release()
        revision = "a1" * 20
        with patch.object(package, "ROOT", self.root), \
                patch("sys.argv", ["package.py", "--windows-release", "--source", "--source-revision", revision]), \
                patch("sys.stdout", new_callable=io.StringIO) as output:
            package.main()
        self.assertEqual({Path(line).name for line in output.getvalue().splitlines()}, {
            "agent-continue-3.0.0.zip", "agent-continue-3.0.0-store.zip", "agent-continue-3.0.0-source.zip"})
        with zipfile.ZipFile(self.root / "dist/agent-continue-3.0.0-source.zip") as archive:
            self.assertIn(revision, archive.read("AgentContinue/SOURCE-SCOPE.md").decode())

    def test_windows_source_options_cannot_be_silently_ignored_or_shipped_to_store(self):
        self.prepare_windows_release()
        for options in ({"source_revision": "a1" * 20},
                        {"include_source": True, "store": True, "source_revision": "a1" * 20}):
            with self.subTest(options=options), self.assertRaises(package.PackageError):
                package.package_release(self.root, windows_release=True, **options)
        self.assertFalse((self.root / "dist").exists())


if __name__ == "__main__":
    unittest.main()
