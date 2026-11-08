"""Bounded, offline contracts for the public Pages artifact and workflow."""

from html import escape
from html.parser import HTMLParser
from pathlib import Path
import re
import runpy
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "scripts/build-public-site.py"
WORKFLOW = ROOT / ".github/workflows/pages.yml"
PUBLIC_LINKS = {
    "https://github.com/1235357/agent-continue",
    "https://github.com/1235357/agent-continue/issues",
    "mailto:zhentongye2028@u.northwestern.edu",
    "https://www.linkedin.com/in/tony-zhentong-ye/",
}


class Page(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.elements = []
        self.policy = []
        self.in_policy = False
        self.feed(source)
        self.close()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.elements.append((tag, attrs))
        if attrs.get("id") == "privacy-content":
            self.in_policy = True

    def handle_endtag(self, tag):
        if tag == "div":
            self.in_policy = False

    def handle_data(self, data):
        if self.in_policy:
            self.policy.append(data)


class PublicSiteTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(BUILDER.is_file(), "The public site generator is missing")
        self.builder = runpy.run_path(str(BUILDER))
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name) / "site"
        self.builder["build_site"](self.output)
        self.pages = {
            name: (self.output / name).read_text(encoding="utf-8")
            for name in ("index.html", "privacy.html")
        }

    def test_privacy_contains_the_entire_canonical_text_without_rewriting(self):
        canonical = (ROOT / "PRIVACY.md").read_text(encoding="utf-8")
        source = self.pages["privacy.html"]
        self.assertEqual("".join(Page(source).policy), canonical)
        self.assertIn(escape(canonical), source)
        self.assertIn("white-space: pre-wrap", source)
        self.assertIn("overflow-wrap: anywhere", source)

    def test_policy_markup_is_text_not_executable_html(self):
        policy = ('\n# Synthetic policy\n<script src="https://invalid.example/x.js">'
                  'alert(1)</script>\n</div><img src=x onerror="alert(2)">'
                  '\n& < > " \' \u4e2d\u6587\n<!-- comment -->\nEND\n')
        source = self.builder["render_privacy"](policy)
        page = Page(source)
        self.assertEqual("".join(page.policy), policy)
        self.assertIn(escape(policy), source)
        self.assertFalse({"script", "img"} & {tag for tag, _ in page.elements})

    def test_homepage_has_public_identity_contacts_and_local_privacy_link(self):
        source = self.pages["index.html"]
        links = {attrs.get("href") for tag, attrs in Page(source).elements if tag == "a"}
        self.assertTrue(PUBLIC_LINKS <= links)
        self.assertIn("privacy.html", links)
        self.assertIn("Agent Continue", source)
        self.assertIn("Zhentong Ye", source)
        privacy_links = {attrs.get("href") for tag, attrs in
                         Page(self.pages["privacy.html"]).elements if tag == "a"}
        self.assertIn("index.html", privacy_links)
        self.assertIn("https://github.com/1235357/agent-continue/blob/main/PRIVACY.md",
                      privacy_links)

    def test_pages_have_no_active_content_external_assets_or_credentials(self):
        forbidden_tags = {"script", "iframe", "frame", "img", "picture", "source",
                          "video", "audio", "object", "embed", "form", "link", "base"}
        for name, source in self.pages.items():
            with self.subTest(page=name):
                page = Page(source)
                self.assertTrue(source.startswith("<!doctype html>"))
                self.assertIn('<meta charset="utf-8">', source)
                self.assertIn('name="viewport"', source)
                for tag, attrs in page.elements:
                    self.assertNotIn(tag, forbidden_tags)
                    self.assertFalse(any(key.startswith("on") for key in attrs))
                    self.assertFalse({"src", "srcset", "ping", "action", "data"} & attrs.keys())
                    if "href" in attrs:
                        self.assertIn(attrs["href"], PUBLIC_LINKS | {
                            "index.html", "privacy.html",
                            "https://github.com/1235357/agent-continue/blob/main/PRIVACY.md",
                        })
                csp = [attrs["content"] for tag, attrs in page.elements
                       if tag == "meta" and attrs.get("http-equiv") == "Content-Security-Policy"]
                self.assertEqual(len(csp), 1)
                self.assertIn("default-src 'none'", csp[0])
                styles = re.findall(r"<style>(.*?)</style>", source, re.S)
                self.assertEqual(len(styles), 1)
                self.assertNotRegex(styles[0], r"(?i)url\s*\(|@import")
                self.assertNotRegex(source, r"-----BEGIN [A-Z ]*PRIVATE KEY-----")
                self.assertNotRegex(source, r"(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})")
                self.assertNotRegex(source, r"https?://[^\s<>\"]+:[^\s<>\"]+@")

    def test_artifact_is_exactly_two_small_deterministic_files(self):
        self.assertEqual({path.name for path in self.output.iterdir()}, set(self.pages))
        before = {name: (self.output / name).read_bytes() for name in self.pages}
        self.builder["build_site"](self.output)
        self.assertEqual(before, {name: (self.output / name).read_bytes() for name in self.pages})
        self.assertLess(sum(map(len, before.values())), 128 * 1024)

    def test_output_with_unexpected_files_is_rejected_without_deletion(self):
        unexpected = self.output / "runtime.key"
        unexpected.write_text("synthetic-not-a-key", encoding="utf-8")
        before = (self.output / "index.html").read_bytes()
        with self.assertRaises(ValueError):
            self.builder["build_site"](self.output)
        self.assertEqual(unexpected.read_text(encoding="utf-8"), "synthetic-not-a-key")
        self.assertEqual((self.output / "index.html").read_bytes(), before)

    def test_output_with_a_directory_named_as_a_page_is_rejected(self):
        (self.output / "privacy.html").unlink()
        (self.output / "privacy.html").mkdir()
        with self.assertRaises(ValueError):
            self.builder["build_site"](self.output)

    def test_cli_builds_from_an_unrelated_working_directory(self):
        output = Path(self.temp.name) / "cli-site"
        result = subprocess.run(
            [sys.executable, "-B", str(BUILDER), "--output", str(output)],
            cwd=self.temp.name, text=True, capture_output=True, timeout=15,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        for name in self.pages:
            self.assertEqual((output / name).read_text(encoding="utf-8"), self.pages[name])


class PagesWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(WORKFLOW.is_file(), "The Pages workflow is missing")
        self.source = WORKFLOW.read_text(encoding="utf-8")

    def test_trigger_and_both_jobs_are_main_only(self):
        self.assertIn("branches: [main]", self.source)
        self.assertIn("workflow_dispatch:", self.source)
        for path in ("PRIVACY.md", "README.md", "docs/**", "scripts/build-public-site.py",
                     "tests/test_public_site.py", ".github/workflows/pages.yml"):
            self.assertIn("- '" + path + "'", self.source)
        self.assertEqual(self.source.count("if: github.ref == 'refs/heads/main'"), 2)
        for forbidden in ("pull_request", "workflow_run:", "schedule:", "gh-pages", "tags:"):
            self.assertNotIn(forbidden, self.source)

    def test_only_official_versioned_actions_and_exact_artifact_are_used(self):
        self.assertEqual(re.findall(r"uses: (\S+)", self.source), [
            "actions/checkout@v7", "actions/upload-pages-artifact@v4",
            "actions/configure-pages@v5", "actions/deploy-pages@v4",
        ])
        self.assertIn("persist-credentials: false", self.source)
        self.assertIn("python3 -B -m unittest discover -s tests -p test_public_site.py", self.source)
        self.assertIn("python3 -B scripts/build-public-site.py --output dist/public-site", self.source)
        self.assertIn("path: dist/public-site", self.source)
        self.assertIn("needs: build", self.source)
        self.assertIn("enablement: false", self.source)
        self.assertLess(self.source.index("-m unittest"), self.source.index("scripts/build-public-site.py --output"))
        self.assertLess(self.source.index("scripts/build-public-site.py --output"), self.source.index("actions/upload-pages-artifact@"))

    def test_least_permissions_concurrency_environment_and_no_installer(self):
        permissions = re.findall(r"^\s+(contents|pages|id-token): (read|write)$", self.source, re.M)
        self.assertEqual(permissions, [("contents", "read"), ("contents", "read"),
                                      ("pages", "write"), ("id-token", "write")])
        self.assertIn("group: pages", self.source)
        self.assertIn("cancel-in-progress: false", self.source)
        self.assertIn("name: github-pages", self.source)
        self.assertIn("url: ${{ steps.deployment.outputs.page_url }}", self.source)
        for forbidden in ("npm ", "pip ", "pip3 ", "apt ", "apt-get ", "curl ", "wget ",
                          "secrets.", "git push", "gh api", "enablement: true",
                          "continue-on-error:"):
            self.assertNotIn(forbidden, self.source)


if __name__ == "__main__":
    unittest.main()
