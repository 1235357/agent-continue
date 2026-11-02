"""Offline release archive regression tests; no browser or private inputs."""
import importlib.util
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


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        cache = {}
        names = set(package.RUNTIME_FILES) | set(package.SOURCE_FILES)
        names |= package.verified_vendor_files(ROOT, cache)
        for name in names:
            destination = self.root / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(package.read_public(ROOT, name, cache))
        for folder in ("tests", "scripts", ".github"):
            (self.root / folder).mkdir(exist_ok=True)

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

    def test_windows_and_ci_line_endings_produce_identical_archive(self):
        output = package.package_release(self.root, store=True)
        before = output.read_bytes()
        target = self.root / "popup.js"
        target.write_bytes(target.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))
        self.assertEqual(before, package.package_release(self.root, store=True).read_bytes())

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


if __name__ == "__main__":
    unittest.main()
