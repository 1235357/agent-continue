#!/usr/bin/env python3
"""Build public extension ZIPs; --source adds extension-scoped development files.

Only explicitly approved project paths are read. Personal bundles and user
uploads are never searched, opened, or copied by this release packager.
"""
from pathlib import Path, PurePosixPath
import argparse
from fnmatch import fnmatchcase
import hashlib
import json
import os
import re
import stat
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
REVIEWED_PDF_VERSION = "6.4.299"
REVIEWED_PDF_INTEGRITY = "sha512-AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g=="
REVIEWED_PDF_FILE_COUNT = 188
WINDOWS_PREVIEW_PRIVACY = "docs/WINDOWS-PREVIEW-PRIVACY.md"
WINDOWS_RELEASE_CSP = {
    "script-src": ["'self'"], "object-src": ["'self'"],
    "worker-src": ["'self'"], "connect-src": ["'self'"],
    "frame-src": ["'self'", "http://127.0.0.1:*"],
}
SOURCE_SCOPE = "SOURCE-SCOPE.md"
SOURCE_REPOSITORY = "https://github.com/1235357/agent-continue"

RUNTIME_FILES = (
    "manifest.json", "background.js", "browser-wake.js", "admin-browser.js", "admin-control.js", "admin-installation-pause.js", "content.js", "adapter.js", "config.js", "preset.js",
    "file-import.js", "popup.html", "popup.css", "popup.js", "README.md", "README.zh-CN.md",
    "i18n.js", "i18n-html.js", "i18n-popup.js", "i18n-runtime.js", "static-locale.js",
    "support.html", "support.css", "support.js", "support-info.js", "activity-export.js",
    "devices.html", "devices.css", "devices.js", "device-control.js",
    "setup.html", "setup.css", "setup.js", "setup-model.js", "setup-handoff.js", "setup-controller.js", "setup-client.js",
    "setup-entry.js", "setup-entry-release.js",
    "native/bootstrap/install-plan.mjs", "native/bootstrap/registration-status-view.mjs",
    "_locales/en/messages.json", "_locales/zh_CN/messages.json",
    "LICENSE", "CHANGELOG.md", "PRIVACY.md", "VALIDATION.md", "ALTERNATIVES.md",
    "CONTRIBUTING.md",
    "icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png", "icons/icon-128.png",
)
# New documentation and images require explicit review before public inclusion.
PUBLIC_DOCS = (
    "docs/COMPOSER-PRIORITY.md",
    "docs/FILE_FORMATS.md",
    "docs/ROADMAP.md",
    "docs/STORE-LISTING.en.md",
    "docs/releases/2.2.1.md",
    "docs/store-2.1.0-en-console.png",
    "docs/store-2.1.0-en-popup.png",
)
SOURCE_FILES = (
    "package.json", "package-lock.json", ".gitignore", "native/bootstrap/browser-control.mjs",
    "native/bootstrap/device-setup.mjs", "native/bootstrap/client-acquisition.mjs",
    "native/bootstrap/bootstrap.mjs", "native/bootstrap/payload-layout.mjs",
    "native/bootstrap/browser-wake-registration.mjs",
)
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
    # manifest.json is the extension release version, while package.json carries
    # the separate npm CLI version; npm only needs it to agree with its lockfile.
    npm_version = package.get("version")
    if not isinstance(npm_version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", npm_version):
        raise PackageError("The npm package version must use MAJOR.MINOR.PATCH.")
    lock_versions = (lock.get("version"), lock.get("packages", {}).get("", {}).get("version"))
    if any(candidate != npm_version for candidate in lock_versions):
        raise PackageError("package.json and both package-lock.json versions must match.")
    if manifest.get("default_locale") != "en":
        raise PackageError("The public release requires English as its default locale.")
    references = set(re.findall(r"__MSG_([A-Za-z0-9_]+)__", json.dumps(manifest)))
    for locale in ("en", "zh_CN"):
        messages = read_json(root, f"_locales/{locale}/messages.json", cache)
        for key in references:
            if not isinstance(messages.get(key, {}).get("message"), str):
                raise PackageError(f"Missing manifest translation: {locale}/{key}")
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


def validate_manifest_files(manifest, files):
    """Check local manifest resources against archive members, not the disk."""
    references = set(manifest.get("icons", {}).values())
    background = manifest.get("background", {})
    references.update(background.get("scripts", []))
    if background.get("service_worker"):
        references.add(background["service_worker"])
    if background.get("page"):
        references.add(background["page"])
    for script in manifest.get("content_scripts", []):
        references.update(script.get("js", []))
        references.update(script.get("css", []))
    for key in ("action", "browser_action", "page_action"):
        action = manifest.get(key, {})
        if action.get("default_popup"):
            references.add(action["default_popup"])
        icons = action.get("default_icon", {})
        references.update([icons] if isinstance(icons, str) else icons.values())
    for key in ("options_ui", "side_panel"):
        page = manifest.get(key, {}).get("page" if key == "options_ui" else "default_path")
        if page:
            references.add(page)
    if manifest.get("options_page"):
        references.add(manifest["options_page"])
    if manifest.get("devtools_page"):
        references.add(manifest["devtools_page"])
    references.update(manifest.get("sandbox", {}).get("pages", []))
    references.update(manifest.get("chrome_url_overrides", {}).values())
    for entry in manifest.get("web_accessible_resources", []):
        references.update(entry.get("resources", []) if isinstance(entry, dict) else [entry])
    for reference in sorted(references):
        path = reference.split("?", 1)[0].split("#", 1)[0]
        if not any(fnmatchcase(filename, path) for filename in files):
            raise PackageError(f"Manifest resource missing from public archive: {reference}")
    if any(part.lower() in BLOCKED_COMPONENTS for name in files for part in PurePosixPath(name).parts):
        raise PackageError("A blocked path appears in the public archive.")


def validate_windows_release(manifest, version):
    components = version.split(".")
    numeric = tuple(int(part) for part in components)
    if (numeric <= (2, 2, 1) or any(str(number) != part or number > 65535
                                   for part, number in zip(components, numeric))):
        raise PackageError("Public Windows release identity requires a valid version newer than scheduler 2.2.1.")
    label = manifest.get("version_name", "")
    if not isinstance(label, str):
        raise PackageError("Public Windows version_name must be a string when present.")
    if re.search(r"preview|candidate", label, re.IGNORECASE):
        raise PackageError("A preview/candidate manifest cannot be converted into a public Windows release.")
    required = manifest.get("permissions", [])
    if (not isinstance(required, list) or not all(isinstance(item, str) for item in required)
            or len(required) != 4 or set(required) != {"activeTab", "scripting", "storage", "alarms"}):
        raise PackageError("Public Windows required permission scope must remain unchanged; nativeMessaging is optional.")
    optional = manifest.get("optional_permissions", [])
    if (not isinstance(optional, list) or not all(isinstance(item, str) for item in optional)
            or len(set(optional)) != len(optional) or optional.count("nativeMessaging") != 1
            or any(permission not in {"nativeMessaging", "power"} for permission in optional)):
        raise PackageError("Public Windows scope requires optional nativeMessaging and only reviewed optional permissions.")
    policy = manifest.get("content_security_policy", {})
    if not isinstance(policy, dict) or not isinstance(policy.get("extension_pages"), str):
        raise PackageError("Public Windows CSP scope requires an extension_pages policy string.")
    directives = [part.split() for part in policy["extension_pages"].split(";") if part.strip()]
    csp = {parts[0]: parts[1:] for parts in directives}
    if len(directives) != len(csp) or csp != WINDOWS_RELEASE_CSP:
        raise PackageError("Public Windows CSP scope permits loopback only in the reviewed frame-src directive.")
    if (manifest.get("host_permissions", []) != ["https://chatgpt.com/*"]
            or manifest.get("optional_host_permissions", [])):
        raise PackageError("Public Windows host scope must not add loopback or other host permissions.")


def verify_distribution_pair(github_archive, store_archive, version):
    def inventory(archive, prefix):
        if archive.testzip() is not None:
            raise PackageError("Invalid distribution ZIP checksum.")
        files = {}
        normalized_names = set()
        for entry in archive.infolist():
            if entry.is_dir() or not entry.filename.startswith(prefix):
                raise PackageError("Unexpected distribution ZIP layout.")
            name = entry.filename.removeprefix(prefix)
            if not name or name.lower() in normalized_names:
                raise PackageError("Duplicate distribution ZIP member.")
            normalized_names.add(name.lower())
            files[name] = hashlib.sha256(archive.read(entry)).hexdigest()
        if "manifest.json" not in files:
            raise PackageError("Distribution ZIP manifest is missing.")
        manifest = json.loads(archive.read(prefix + "manifest.json"))
        if not isinstance(manifest, dict) or manifest.get("version") != version:
            raise PackageError("Distribution ZIP version does not match the release.")
        return files

    try:
        with zipfile.ZipFile(github_archive) as github, zipfile.ZipFile(store_archive) as store:
            if inventory(github, "AgentContinue/") != inventory(store, ""):
                raise PackageError("GitHub and Chrome Store packages contain different bytes.")
    except (OSError, zipfile.BadZipFile, ValueError) as error:
        if isinstance(error, PackageError):
            raise
        raise PackageError("Cannot verify both distribution ZIPs.") from error


def project_setup_entry(directory, receipt, version):
    node = shutil.which("node")
    if not node:
        raise PackageError("Node is required to verify the combined Windows setup closure.")
    try:
        result = subprocess.run([node, str(ROOT / "scripts/prepare-npm-payload.mjs"), "--setup-entry-json",
                                 "--combined-release-dir", str(Path(directory).resolve()),
                                 "--combined-release-receipt", str(Path(receipt).resolve())],
                                capture_output=True, timeout=45, check=False)
        value = json.loads(result.stdout)
        fields = {"format", "version", "releaseTag", "entryUrl", "entrySha256", "sumsSha256"}
        if (result.returncode != 0 or result.stderr or len(result.stdout) > 4096
                or not isinstance(value, dict) or set(value) != fields
                or value["format"] != "agent-continue-windows-setup-entry" or type(value["version"]) is not int
                or value["version"] != 1 or value["releaseTag"] != f"v{version}"
                or value["entryUrl"] != f"{SOURCE_REPOSITORY}/releases/download/v{version}/install.ps1"
                or any(not isinstance(value[key], str) or not re.fullmatch(r"[a-f0-9]{64}", value[key])
                       for key in ("entrySha256", "sumsSha256"))):
            raise ValueError("invalid_entry_projection")
    except (OSError, subprocess.TimeoutExpired, ValueError, KeyError, TypeError):
        raise PackageError("The combined Windows setup entry could not be verified.") from None
    return ("export const SETUP_ENTRY_RELEASE = Object.freeze(" +
            json.dumps(value, separators=(",", ":"), ensure_ascii=True) + ");\n").encode("ascii")


def package_release(root, include_source=False, store=False, output_directory=None, *,
                    windows_preview=False, windows_release=False, source_revision=None,
                    setup_release_dir=None, setup_release_receipt=None):
    """Return the requested ZIP; public Windows mode always builds a verified runtime pair.

    With --source, the additional GitHub source ZIP is extension-scoped; the
    runtime GitHub/Store pair remains free of development-only members.
    """
    if windows_preview and windows_release:
        raise PackageError("Cannot combine mutually exclusive Windows preview and public release modes.")
    if windows_release and store and include_source:
        raise PackageError("Public Windows source is a GitHub extension-scoped asset, not a Store package.")
    if source_revision is not None and not include_source:
        raise PackageError("A source revision requires --source.")
    if ((windows_release and include_source) or source_revision is not None) and (
            not isinstance(source_revision, str) or not re.fullmatch(r"[a-f0-9]{40}", source_revision)):
        raise PackageError("Windows source requires an explicit immutable 40-character source commit revision.")
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise PackageError("The project root must be a regular directory, not a symlink.")
    cache = {}
    version = validate_release(root, cache)
    if (setup_release_dir is None) != (setup_release_receipt is None):
        raise PackageError("Both combined setup release inputs are required.")
    if setup_release_dir is not None:
        if not (windows_release or windows_preview):
            raise PackageError("Setup entry projection requires an explicit Windows package mode.")
        cache["setup-entry-release.js"] = project_setup_entry(setup_release_dir, setup_release_receipt, version)
    manifest = read_json(root, "manifest.json", cache)
    if windows_release:
        validate_windows_release(manifest, version)
    device_candidate = (
        "nativeMessaging" in manifest.get("optional_permissions", [])
        or "nativeMessaging" in manifest.get("permissions", [])
        or re.search(r"https?://(?:127(?:\.\d{1,3}){3}|localhost|\[::1\])(?=[:/\s\";]|$)",
                     json.dumps([manifest.get("content_security_policy", {}),
                                 manifest.get("host_permissions", []),
                                 manifest.get("optional_host_permissions", [])]), re.IGNORECASE)
    )
    if windows_preview:
        if store or include_source or not device_candidate:
            raise PackageError("Windows device preview is an unpacked candidate, not a store or source package.")
        manifest.pop("key", None)
        manifest["version_name"] = f"{version} Windows device preview"
        cache["manifest.json"] = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")
        cache["PRIVACY.md"] = read_public(root, WINDOWS_PREVIEW_PRIVACY, cache)
    elif windows_release:
        # Drop the development identity, never promote a preview label or policy.
        manifest.pop("key", None)
        cache["manifest.json"] = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")
    elif device_candidate:
        raise PackageError("The device candidate needs an explicit mode; use --windows-preview. "
                           "A reviewed public release requires --windows-release and a new version.")
    files = set(RUNTIME_FILES) | verified_vendor_files(root, cache)
    if windows_preview:
        files.add("docs/FILE_FORMATS.md")
    else:
        files.update(PUBLIC_DOCS)
    runtime_files = files.copy()
    if include_source:
        files.update(SOURCE_FILES)
        files |= approved_tree(root, "tests", {".py", ".mjs", ".html", ".md"})
        files |= approved_tree(root, "scripts", {".py", ".mjs"})
        files |= approved_tree(root, ".github", {".yml", ".yaml", ".md"})
        files.add(SOURCE_SCOPE)
        revision = source_revision or f"v{version}"
        cache[SOURCE_SCOPE] = (
            "# Extension Source Scope\n\n"
            "This is an extension-scoped development archive, not a complete Windows "
            "native/setup reproduction kit. Included scripts and tests may require "
            "native inputs that are intentionally absent.\n\n"
            f"Full Windows native/setup reproduction requires the complete reviewed repository: "
            f"{SOURCE_REPOSITORY}/tree/{revision}\n\n"
            "The release coordinator must verify that source pin against the finalized release. "
            "This local archive does not verify remote availability, source/commit agreement, "
            "native reproduction, installation, Store acceptance, or actual publication.\n"
        ).encode("utf-8")

    # Capture and validate every member before creating/replacing an archive.
    # The cached bytes are exactly those whose preset and vendor hashes passed.
    for filename in sorted(files):
        read_public(root, filename, cache)
    validate_manifest_files(read_json(root, "manifest.json", cache), runtime_files if windows_release else files)

    output_directory = root / "dist" if output_directory is None else Path(output_directory)
    if output_directory.is_symlink():
        raise PackageError("The release output directory must not be a symlink.")
    output_directory.mkdir(exist_ok=True)
    if not stat.S_ISDIR(output_directory.lstat().st_mode):
        raise PackageError("The release output path must be a directory.")
    suffix = "-windows-device-preview" if windows_preview else ("-store" if store else "") + ("-source" if include_source else "")
    output = output_directory / f"agent-continue-{version}{suffix}.zip"
    builds = [(output, files, store)]
    if windows_release:
        github = output_directory / f"agent-continue-{version}.zip"
        store_output = output_directory / f"agent-continue-{version}-store.zip"
        builds = [(github, runtime_files, False), (store_output, runtime_files, True)]
        if include_source:
            builds.append((output, files, False))
    for destination, _, _ in builds:
        if destination.is_symlink() or (destination.exists() and not destination.is_file()):
            raise PackageError("Refusing to overwrite a non-file release output.")

    staged = {}
    try:
        for destination, members, flat in builds:
            staged[destination] = stage_archive(destination, members, cache, store=flat)
        if windows_release:
            verify_distribution_pair(staged[github], staged[store_output], version)
        for destination, temporary in staged.items():
            os.replace(temporary, destination)
    finally:
        for temporary in staged.values():
            temporary.unlink(missing_ok=True)
    return output


def stage_archive(output, files, cache, *, store):
    """Write deterministic cached bytes without replacing any final archive yet."""
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".agent-continue-public-", suffix=".tmp", dir=output.parent, delete=False) as stream:
            temporary = Path(stream.name)
            with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
                for filename in sorted(files):
                    member = zipfile.ZipInfo(filename if store else f"AgentContinue/{filename}", date_time=ZIP_TIMESTAMP)
                    member.create_system = 3
                    member.external_attr = (stat.S_IFREG | 0o644) << 16
                    member.compress_type = zipfile.ZIP_DEFLATED
                    member.extra = b""
                    member.comment = b""
                    contents = cache[filename]
                    # Git checkouts may use CRLF on Windows and LF on CI. Keep
                    # shipped first-party text identical without altering the
                    # separately hash-verified upstream PDF asset bytes.
                    if not filename.startswith("vendor/") and (
                            Path(filename).suffix in {".js", ".mjs", ".json", ".html", ".css", ".md", ".py", ".yml", ".yaml"}
                            or filename == "LICENSE"):
                        contents = contents.replace(b"\r\n", b"\n")
                    archive.writestr(member, contents, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        return temporary
    except BaseException:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", action="store_true", help="Add extension-scoped development files, not a full Windows source kit")
    parser.add_argument("--store", action="store_true", help="Build a separate Chrome Store ZIP with manifest.json at its root")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--windows-preview", action="store_true", help="Build the unpacked Windows device preview (not a Store ZIP)")
    modes.add_argument("--windows-release", action="store_true", help="Build and verify paired public Windows GitHub/Store ZIPs locally; does not publish")
    parser.add_argument("--source-revision", help="Reviewed full repository commit (40 lowercase hex characters); required for Windows --source")
    parser.add_argument("--setup-release-dir", type=Path, help="Completed combined Windows setup asset directory")
    parser.add_argument("--setup-release-receipt", type=Path, help="Matching completed combined build receipt")
    parser.add_argument("--output-dir", type=Path, help="Write to this directory instead of the project dist directory")
    args = parser.parse_args()
    try:
        output = package_release(ROOT, include_source=args.source, store=args.store, output_directory=args.output_dir,
                                 windows_preview=args.windows_preview, windows_release=args.windows_release,
                                 source_revision=args.source_revision, setup_release_dir=args.setup_release_dir,
                                 setup_release_receipt=args.setup_release_receipt)
    except (PackageError, OSError, UnicodeError) as error:
        parser.exit(1, f"Public packaging failed: {error}\n")
    if args.windows_release:
        stem = "agent-continue-" + re.search(r"[0-9]+\.[0-9]+\.[0-9]+", output.name).group()
        print(output.with_name(stem + ".zip"))
        print(output.with_name(stem + "-store.zip"))
        if args.source:
            print(output)
    else:
        print(output)


if __name__ == "__main__":
    main()

