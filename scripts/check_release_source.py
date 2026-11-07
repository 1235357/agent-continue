#!/usr/bin/env python3
"""Require the checked-out tag to belong to the canonical main line."""

import re
import subprocess
import sys


def git(*arguments):
    return subprocess.run(
        ["git", "--no-replace-objects", *arguments],
        check=True, capture_output=True, text=True,
    ).stdout.strip()


def verify(tag):
    if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", tag):
        raise ValueError("Release tags must use vMAJOR.MINOR.PATCH.")
    if git("rev-parse", "--is-shallow-repository") != "false":
        raise ValueError("A full Git checkout is required.")
    try:
        tagged = git("rev-parse", "--verify", f"refs/tags/{tag}^{{commit}}")
    except subprocess.CalledProcessError as error:
        raise ValueError("The exact release tag must resolve to a commit.") from error
    if git("rev-parse", "--verify", "HEAD^{commit}") != tagged:
        raise ValueError("The release tag does not match the checkout.")
    try:
        main_line = git("rev-list", "--first-parent", "refs/remotes/origin/main", "--")
    except subprocess.CalledProcessError as error:
        raise ValueError("The checkout must include origin/main.") from error
    if tagged not in main_line.splitlines():
        raise ValueError("The tag must name a first-parent commit on origin/main.")
    return tagged


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: check_release_source.py vMAJOR.MINOR.PATCH")
    try:
        commit = verify(sys.argv[1])
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from None
    print(f"Release source verified on origin/main: {commit}")
