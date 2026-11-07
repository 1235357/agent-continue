"""Exercise release source checks against actual Git histories."""

import subprocess
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path


CHECK = Path(__file__).resolve().parents[1] / "scripts/check_release_source.py"


class ReleaseSourceTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory(prefix="ac-release-source-")
        self.addCleanup(folder.cleanup)
        self.repo = Path(folder.name) / "checkout"
        self.repo.mkdir()
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.git("config", "tag.gpgsign", "false")
        self.git("commit", "-qm", "First", "--allow-empty")
        self.first = self.git("rev-parse", "HEAD").strip()
        self.git("switch", "-qc", "feature")
        self.git("commit", "-qm", "Feature", "--allow-empty")
        self.side = self.git("rev-parse", "HEAD").strip()
        self.git("tag", "v1.0.1", self.side)
        self.git("switch", "-q", "main")
        self.git("merge", "-q", "--no-ff", "-m", "Merge feature", "feature")
        self.git("tag", "-a", "v1.1.0", "-m", "release")
        self.git("tag", "v1.0.0", self.first)
        self.git("update-ref", "refs/remotes/origin/main", "HEAD")

    def git(self, *arguments):
        return subprocess.run(["git", *arguments], cwd=self.repo, check=True,
                              text=True, capture_output=True).stdout

    def check(self, tag):
        return subprocess.run([sys.executable, str(CHECK), tag], cwd=self.repo,
                              text=True, capture_output=True)

    def test_main_merge_and_historical_first_parent_tags_pass(self):
        for tag in ("v1.1.0", "v1.0.0"):
            with self.subTest(tag=tag):
                self.git("switch", "-q", "--detach", tag)
                result = self.check(tag)
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_merged_feature_commit_is_not_a_main_line_release(self):
        self.git("switch", "-q", "--detach", "v1.0.1")
        result = self.check("v1.0.1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("first-parent", result.stderr)

    def test_missing_origin_main_is_not_substituted_with_local_main(self):
        self.git("update-ref", "-d", "refs/remotes/origin/main")
        result = self.check("v1.1.0")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("origin/main", result.stderr)

    def test_head_must_match_tag_and_tag_must_use_exact_name(self):
        for tag, message in (("v1.0.0", "checkout"), ("v9.0.0", "tag"), ("v1.1", "vMAJOR")):
            with self.subTest(tag=tag):
                result = self.check(tag)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message, result.stderr)

    def test_release_workflow_checks_source_before_setup(self):
        workflow = (CHECK.parents[1] / ".github/workflows/release.yml").read_text(encoding="utf-8")
        self.assertIn("fetch-depth: 0", workflow)
        self.assertIn('python3 scripts/check_release_source.py "$RELEASE_TAG"', workflow)
        self.assertLess(workflow.index("scripts/check_release_source.py"), workflow.index("npm ci"))

    def test_release_workflow_never_updates_existing_release_assets(self):
        workflow = (CHECK.parents[1] / ".github/workflows/release.yml").read_text(encoding="utf-8")
        self.assertIn('gh release create "$RELEASE_TAG"', workflow)
        self.assertIn("Existing release or draft must be reconciled", workflow)
        for command in ("gh release upload", "gh release edit", "--clobber"):
            self.assertNotIn(command, workflow)

    def test_create_step_has_no_write_when_existing_or_lookup_failed(self):
        if os.name == "nt":
            bash = Path(shutil.which("git")).resolve().parents[1] / "bin/bash.exe"
        else:
            bash = shutil.which("bash")
        if not bash or not Path(bash).is_file():
            self.skipTest("Bash is not installed")
        workflow = (CHECK.parents[1] / ".github/workflows/release.yml").read_text(encoding="utf-8")
        run_block = workflow.split("      - name: Create the GitHub Release", 1)[1].split("        run: |\n", 1)[1]
        command = "\n".join(line[10:] for line in run_block.splitlines() if line.strip())
        fake_cli = """
gh() {
  printf '%s\\n' "$*" >> "$GH_CALLS"
  case "$1 $2" in
    'api --paginate') printf '%s\\n' "$KNOWN_TAGS"; return "$LOOKUP_EXIT";;
    'release create') return 0;;
    *) return 99;;
  esac
}
"""
        cases = (
            ("published", "v1.1.0", 0, False),
            ("draft", "v1.1.0", 0, False),
            ("lookup unavailable", "", 1, False),
            ("new tag", "v1.1.01\nv0.1.0", 0, True),
        )
        for label, tags, lookup, created in cases:
            with self.subTest(label=label):
                calls = self.repo / "gh-calls"
                calls.unlink(missing_ok=True)
                env = {**os.environ, "GH_CALLS": calls.as_posix(), "GH_REPO": "fixture/agent-continue",
                       "KNOWN_TAGS": tags, "LOOKUP_EXIT": str(lookup), "RELEASE_TAG": "v1.1.0",
                       "RELEASE_VERSION": "1.1.0", "RUNNER_TEMP": self.repo.as_posix()}
                result = subprocess.run([str(bash), "--noprofile", "--norc", "-e", "-c", fake_cli + command],
                                        cwd=self.repo, env=env, text=True, capture_output=True)
                self.assertEqual(result.returncode == 0, created, result.stderr)
                issued = calls.read_text(encoding="utf-8").splitlines()
                self.assertTrue(issued[0].startswith("api --paginate"))
                self.assertEqual(len(issued), 2 if created else 1)
                if created:
                    self.assertTrue(issued[1].startswith("release create v1.1.0 "))


if __name__ == "__main__":
    unittest.main()
