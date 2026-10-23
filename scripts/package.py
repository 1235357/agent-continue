#!/usr/bin/env python3
"""Build a public, loadable ZIP; --source adds reproducible development files.

Only explicitly approved project paths are read. Personal bundles and user
uploads are never searched, opened, or copied by this release packager.
"""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import json
import os
import re
import stat
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
REVIEWED_PDF_VERSION = "6.4.299"
REVIEWED_PDF_INTEGRITY = "sha512-AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g=="
REVIEWED_PDF_FILE_COUNT = 188

RUNTIME_FILES = (
    "manifest.json", "background.js", "adapter.js", "config.js", "preset.js",
    "file-import.js", "popup.html", "popup.css", "popup.js", "README.md",
    "LICENSE", "CHANGELOG.md", "PRIVACY.md", "VALIDATION.md", "ALTERNATIVES.md",
    "CONTRIBUTING.md", "docs/FILE_FORMATS.md",
    "icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png", "icons/icon-128.png",
)
SOURCE_FILES = ("package.json", "package-lock.json", ".gitignore")
BLOCKED_COMPONENTS = frozenset({
    "node_modules", "dist", "private", "upload", "uploads", ".git",
    "__pycache__", "test-results", "playwright-report",
})
PDF_PATH = re.compile(
    r"(?:pdf(?:\.worker)?\.mjs|LICENSE|cmaps/(?:LICENSE|[A-Za-z0-9_-]+\.bcmap)"
    r"|standard_fonts/(?:LICENSE_(?:FOXIT|LIBERATION)|[A-Za-z0-9_-]+\.(?:pfb|ttf)))"
)


class PackageError(ValueError):
    """A release input did not pass the public packaging checks."""


def safe_path(root, filename, *, directory=False):
    """Reject traversal and every symlink component before opening a path."""
    relative = PurePosixPath(filename)
    if (not filename or relative.is_absolute() or relative.as_posix() != filename
            or any(part in ("", ".", "..") for part in relative.parts)
            or any(part.lower() in BLOCKED_COMPONENTS for part in relative.parts)
            or "\\" in filename or ":" in filename
            or any(ord(character) < 32 for character in filename)
            or relative.suffix.lower() == ".zip"):
        raise PackageError("A path outside the public release allowlist was requested.")
    current = root
    for index, part in enumerate(relative.parts):
        current = current / part
        try:
            metadata = current.lstat()
        except FileNotFoundError:
            raise PackageError(f"Missing required public release input: {filename}") from None
        if stat.S_ISLNK(metadata.st_mode):
            raise PackageError(f"Symlinks are forbidden in release inputs: {filename}")
        must_be_directory = index < len(relative.parts) - 1 or directory
        if must_be_directory and not stat.S_ISDIR(metadata.st_mode):
            raise PackageError(f"Expected a release directory: {filename}")
        if not must_be_directory and not stat.S_ISREG(metadata.st_mode):
            raise PackageError(f"Expected a regular release file: {filename}")
    return current


def read_public(root, filename, cache):
    if filename not in cache:
        file = safe_path(root, filename)
        descriptor = os.open(file, os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise PackageError(f"Expected a regular release file: {filename}")
            cache[filename] = stream.read()
    return cache[filename]


def read_json(root, filename, cache):
    try:
        value = json.loads(read_public(root, filename, cache))
    except (UnicodeError, json.JSONDecodeError):
        raise PackageError(f"Invalid JSON in public release input: {filename}") from None
    if not isinstance(value, dict):
        raise PackageError(f"Expected a JSON object: {filename}")
    return value


def approved_tree(root, folder, suffixes):
    """Scan only an allowlisted public tree, without following symlinks."""
    files = set()
    pending = [folder]
    while pending:
        relative = pending.pop()
        directory = safe_path(root, relative, directory=True)
        with os.scandir(directory) as entries:
            for entry in sorted(entries, key=lambda item: item.name):
                # Never descend into excluded trees, even if someone creates
                # one inside an otherwise approved documentation/test folder.
                if entry.name.lower() in BLOCKED_COMPONENTS or entry.name.startswith("."):
                    continue
                child = f"{relative}/{entry.name}"
                if entry.is_symlink():
                    raise PackageError(f"Symlinks are forbidden in release inputs: {child}")
                if entry.is_dir(follow_symlinks=False):
                    pending.append(child)
                elif entry.is_file(follow_symlinks=False) and Path(entry.name).suffix.lower() in suffixes:
                    files.add(child)
    return files


def validate_release(root, cache):
    manifest = read_json(root, "manifest.json", cache)
    package = read_json(root, "package.json", cache)
    lock = read_json(root, "package-lock.json", cache)
    version = manifest.get("version")
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise PackageError("The release version must use MAJOR.MINOR.PATCH.")
    versions = (
        package.get("version"), lock.get("version"),
        lock.get("packages", {}).get("", {}).get("version"),
    )
    if any(candidate != version for candidate in versions):
        raise PackageError("manifest.json, package.json and both package-lock.json versions must match.")
    preset = read_public(root, "preset.js", cache).decode("utf-8")
    effective_preset = "\n".join(line for line in preset.splitlines() if not line.lstrip().startswith("//")).strip()
    if not re.fullmatch(r"export\s+const\s+BUNDLED_PROMPT\s*=\s*false\s*;", effective_preset):
        raise PackageError("Public releases require preset.js to contain only BUNDLED_PROMPT = false (plus comments).")
    dependency = lock.get("packages", {}).get("node_modules/pdfjs-dist", {})
    if (package.get("devDependencies", {}).get("pdfjs-dist") != REVIEWED_PDF_VERSION
            or dependency.get("version") != REVIEWED_PDF_VERSION
            or dependency.get("integrity") != REVIEWED_PDF_INTEGRITY):
        raise PackageError("The PDF.js dependency and lockfile must match the reviewed offline assets.")
    return version


def verified_vendor_files(root, cache):
    metadata_path = "vendor/pdfjs/SOURCE.json"
    source = read_json(root, metadata_path, cache)
    if (source.get("package") != "pdfjs-dist" or source.get("version") != REVIEWED_PDF_VERSION
            or source.get("integrity") != REVIEWED_PDF_INTEGRITY or source.get("license") != "Apache-2.0"):
        raise PackageError("PDF.js SOURCE.json does not match the reviewed dependency.")
    entries = source.get("files")
    if not isinstance(entries, list) or len(entries) != REVIEWED_PDF_FILE_COUNT:
        raise PackageError(f"PDF.js SOURCE.json must describe exactly {REVIEWED_PDF_FILE_COUNT} reviewed files.")
    names = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise PackageError("Invalid PDF.js asset manifest entry.")
        name, size, digest = entry.get("path"), entry.get("size"), entry.get("sha256")
        if (not isinstance(name, str) or not PDF_PATH.fullmatch(name) or name in names
                or type(size) is not int or size < 1
                or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest)):
            raise PackageError("An invalid, duplicate or unapproved asset appears in PDF.js SOURCE.json.")
        names.add(name)
        filename = f"vendor/pdfjs/{name}"
        contents = read_public(root, filename, cache)
        if len(contents) != size or hashlib.sha256(contents).hexdigest() != digest:
            raise PackageError(f"PDF.js asset integrity mismatch: {filename}. Run npm run vendor to restore reviewed assets.")
    required = {"pdf.mjs", "pdf.worker.mjs", "LICENSE", "cmaps/LICENSE", "standard_fonts/LICENSE_FOXIT", "standard_fonts/LICENSE_LIBERATION"}
    if not required.issubset(names):
        raise PackageError("The PDF.js runtime or its required licenses are missing from SOURCE.json.")
    return {metadata_path, *(f"vendor/pdfjs/{name}" for name in names)}


def package_release(root, include_source=False):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise PackageError("The project root must be a regular directory, not a symlink.")
    cache = {}
    version = validate_release(root, cache)
    files = set(RUNTIME_FILES) | verified_vendor_files(root, cache)
    files |= approved_tree(root, "docs", {".md", ".png", ".svg", ".webp", ".jpg", ".jpeg"})
    if include_source:
        files.update(SOURCE_FILES)
        files |= approved_tree(root, "tests", {".mjs", ".html", ".md"})
        files |= approved_tree(root, "scripts", {".py", ".mjs"})
        files |= approved_tree(root, ".github", {".yml", ".yaml", ".md"})

    # Capture and validate every member before creating/replacing an archive.
    # The cached bytes are exactly those whose preset and vendor hashes passed.
    for filename in sorted(files):
        read_public(root, filename, cache)

    output_directory = root / "dist"
    if output_directory.is_symlink():
        raise PackageError("The release output directory must not be a symlink.")
    output_directory.mkdir(exist_ok=True)
    if not stat.S_ISDIR(output_directory.lstat().st_mode):
        raise PackageError("The release output path must be a directory.")
    suffix = "-source" if include_source else ""
    output = output_directory / f"agent-continue-{version}{suffix}.zip"
    if output.is_symlink() or (output.exists() and not output.is_file()):
        raise PackageError("Refusing to overwrite a non-file release output.")

    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".agent-continue-public-", suffix=".tmp", dir=output_directory, delete=False) as stream:
            temporary = Path(stream.name)
            with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
                for filename in sorted(files):
                    member = zipfile.ZipInfo(f"AgentContinue/{filename}", date_time=ZIP_TIMESTAMP)
                    member.create_system = 3
                    member.external_attr = (stat.S_IFREG | 0o644) << 16
                    member.compress_type = zipfile.ZIP_DEFLATED
                    member.extra = b""
                    member.comment = b""
                    archive.writestr(member, cache[filename], compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        # Atomic replacement prevents an interrupted build from publishing a
        # partial ZIP. Fixed ordering, timestamps and permissions remove host
        # filesystem metadata from the archive.
        os.replace(temporary, output)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", action="store_true", help="Also include tests, build scripts and repository configuration")
    args = parser.parse_args()
    try:
        output = package_release(ROOT, include_source=args.source)
    except (PackageError, OSError, UnicodeError) as error:
        parser.exit(1, f"Public packaging failed: {error}\n")
    print(output)


if __name__ == "__main__":
    main()

