import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/build-windows-preview-kit.py"
sys.path.insert(0, str(SCRIPT.parent))
spec = importlib.util.spec_from_file_location("preview_kit", SCRIPT)
kit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kit)


class WindowsPreviewKitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="ac-test-preview-kit-")
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.archive = kit.build(cls.root / "first")

    def test_layout_hashes_and_rebuild(self):
        kit.verify(self.archive)
        data = self.archive.read_bytes()
        self.assertEqual(self.archive.with_suffix(".zip.sha256").read_text(encoding="ascii"),
                         f"{hashlib.sha256(data).hexdigest()}  {kit.ARCHIVE}\n")
        second = kit.build(self.root / "second")
        self.assertEqual(data, second.read_bytes())
        with zipfile.ZipFile(self.archive) as archive:
            self.assertTrue(kit.REQUIRED <= set(archive.namelist()))
            self.assertEqual((archive.getinfo("WindowsSetup/bin.mjs").external_attr >> 16) & 0o777, 0o755)
            self.assertFalse({"manifest.json", "install.ps1"}.intersection(archive.namelist()))
            self.assertTrue(all(item.date_time == kit.ZIP_TIMESTAMP for item in archive.infolist()))
        result = subprocess.run([sys.executable, str(SCRIPT), "--verify", str(self.archive)],
                                check=True, capture_output=True, text=True)
        self.assertIn("integrity verified", result.stdout)

    def test_rejects_unsafe_members_and_collisions(self):
        for name in ("WindowsSetup/setup.exe", "AgentContinue/../escape", "WindowsSetup/NUL.txt",
                     "AgentContinue/setup.html/child", "agentcontinue/SETUP.HTML"):
            with self.subTest(name=name):
                path = self.root / "unsafe.zip"
                members = kit.read_archive(self.archive)
                members.pop(kit.CHECKSUMS)
                members[name] = b"not shipped"
                self.write_archive(path, members)
                with self.assertRaisesRegex(ValueError, "invalid_preview_member"):
                    kit.verify(path)

    def test_rejects_wrong_manifest_and_mismatched_setup(self):
        for mutation, expected in (("manifest", "not_windows_preview"), ("setup", "setup_digest_mismatch")):
            with self.subTest(mutation=mutation):
                path = self.root / "mismatch.zip"
                members = kit.read_archive(self.archive)
                members.pop(kit.CHECKSUMS)
                if mutation == "manifest":
                    name = "AgentContinue/manifest.json"
                    manifest = json.loads(members[name])
                    manifest["key"] = "fixture"
                    members[name] = json.dumps(manifest).encode("utf-8")
                else:
                    members["WindowsSetup/install.ps1"] = b"tampered"
                self.write_archive(path, members)
                with self.assertRaisesRegex(ValueError, expected):
                    kit.verify(path)

    def test_rejects_mismatched_outer_member_digest(self):
        path = self.root / "digest.zip"
        members = kit.read_archive(self.archive)
        members[kit.GUIDE] = b"not the reviewed quick start"
        with zipfile.ZipFile(path, "w") as archive:
            for name, data in members.items():
                archive.writestr(name, data)
        with self.assertRaisesRegex(ValueError, "preview_digest_mismatch"):
            kit.verify(path)

    def test_ci_upload_follows_same_kit_fixture(self):
        workflow = (ROOT / ".github/workflows/native-runtime-tests.yml").read_text(encoding="utf-8")
        build = workflow.index("name: Build and verify the Windows preview kit")
        install = workflow.index("id: windows-preview-install-acceptance")
        recovery = workflow.index("id: windows-preview-browser-recovery")
        upload = workflow.index("uses: actions/upload-artifact@", recovery)
        self.assertLess(build, install)
        self.assertLess(install, recovery)
        self.assertIn("npm run vendor", workflow[build:install])
        self.assertIn("TUNNEL_CLIENT_TEST_PREVIEW_KIT", workflow[install:recovery])
        self.assertIn("../../dist/windows-preview-kit/" + kit.ARCHIVE, workflow[install:recovery])
        self.assertIn("--test-name-pattern=guided-installer-(chromium|browser-managed)", workflow[install:recovery])
        self.assertIn("windows-browser-native-startup-tests.mjs", workflow[recovery:upload])
        artifact = workflow[upload:workflow.index("  macos-bootstrap:", upload)]
        self.assertIn("refs/heads/main", artifact)
        self.assertIn("dist/windows-preview-kit/" + kit.ARCHIVE, artifact)
        self.assertIn("dist/windows-preview-kit/" + kit.ARCHIVE + ".sha256", artifact)
        self.assertNotIn("contents: write", workflow)

    def test_preview_explicitly_uses_source_only_without_relaxing_combined_delivery(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('"scripts/build-setup-release.py"), "--source-only", "--output"', source)
        self.assertNotIn('"--administrator-bundle"', source)
        with zipfile.ZipFile(self.archive) as archive:
            self.assertFalse(any(name.lower().endswith((".exe", ".msi", ".zip")) for name in archive.namelist()))
        combined = subprocess.run([sys.executable, str(ROOT / "scripts/build-setup-release.py"),
                                   "--output", str(self.root / "combined-must-not-exist")],
                                  capture_output=True, text=True, timeout=20)
        self.assertNotEqual(combined.returncode, 0)
        self.assertIn("combined_administrator_bundle_required", combined.stderr)
        self.assertFalse((self.root / "combined-must-not-exist").exists())

    @staticmethod
    def write_archive(path, members):
        with zipfile.ZipFile(path, "w") as archive:
            for name, data in members.items():
                archive.writestr(name, data)
            archive.writestr(kit.CHECKSUMS, kit.checksums(members))


if __name__ == "__main__":
    unittest.main()
