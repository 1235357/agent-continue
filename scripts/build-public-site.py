"""Build the two-file public documentation site using only the standard library."""

import argparse
from html import escape
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "https://github.com/1235357/agent-continue"
EMAIL = "zhentongye2028@u.northwestern.edu"
LINKEDIN = "https://www.linkedin.com/in/tony-zhentong-ye/"
PAGE_NAMES = {"index.html", "privacy.html"}

STYLE = """
* { box-sizing: border-box; }
body { margin: 0; color: #202124; background: #fff; font: 1rem/1.65 system-ui, sans-serif; }
main { max-width: 72rem; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
h1 { font-size: 2rem; line-height: 1.2; margin: 1rem 0; }
h2 { font-size: 1.25rem; margin-top: 2rem; }
a { color: #006b58; text-underline-offset: 0.2em; overflow-wrap: anywhere; }
a:focus-visible { outline: 2px solid #202124; outline-offset: 3px; }
nav { border-bottom: 1px solid #dadce0; padding-bottom: 1rem; }
nav a { display: inline-block; margin-right: 1.5rem; }
ul { padding-left: 1.5rem; }
li { margin: 0.5rem 0; }
.policy { white-space: pre-wrap; overflow-wrap: anywhere; }
"""


def render_page(title: str, content: str) -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>{escape(title)}</title>
<style>{STYLE}</style>
</head>
<body>
<main>
<nav aria-label="Documentation"><a href="index.html">Home</a><a href="privacy.html">Privacy</a></nav>
{content}
</main>
</body>
</html>
"""


def render_index() -> str:
    return render_page("Agent Continue", f"""<h1>Agent Continue</h1>
<p>Schedule your own prompts in one existing ChatGPT or Your dot conversation.</p>
<h2>Developer and Support</h2>
<p>Developer: Zhentong Ye</p>
<ul>
<li><a href="{REPOSITORY}">GitHub source repository</a></li>
<li><a href="{REPOSITORY}/issues">GitHub issues</a></li>
<li>Email: <a href="mailto:{EMAIL}">{EMAIL}</a></li>
<li><a href="{LINKEDIN}">Zhentong Ye on LinkedIn</a></li>
<li><a href="privacy.html">Privacy and Data Handling</a></li>
</ul>""")


def render_privacy(policy: str) -> str:
    # Render the whole canonical document as text, never as active HTML/Markdown.
    return render_page("Privacy and Data Handling | Agent Continue", f"""<h1>Privacy and Data Handling</h1>
<p><a href="{REPOSITORY}/blob/main/PRIVACY.md">Canonical PRIVACY.md source</a></p>
<div id="privacy-content" class="policy">{escape(policy)}</div>""")


def build_site(output_dir: Path) -> None:
    pages = {
        "index.html": render_index(),
        "privacy.html": render_privacy((ROOT / "PRIVACY.md").read_text(encoding="utf-8")),
    }
    if output_dir.is_symlink() or (output_dir.exists() and not output_dir.is_dir()):
        raise ValueError("Site output must be a dedicated directory, not a link or file")
    if output_dir.exists():
        for entry in output_dir.iterdir():
            if entry.name not in PAGE_NAMES or entry.is_symlink() or not entry.is_file():
                raise ValueError("Site output contains unexpected entries; use a dedicated directory")
    output_dir.mkdir(parents=True, exist_ok=True)
    for name, source in pages.items():
        with (output_dir / name).open("w", encoding="utf-8", newline="\n") as output:
            output.write(source)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "dist/public-site",
                        help="Dedicated output directory (default: dist/public-site)")
    args = parser.parse_args()
    try:
        build_site(args.output)
    except (OSError, ValueError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
