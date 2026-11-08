#!/usr/bin/env python3
"""Build and verify one Windows preview ZIP from the two existing packagers."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tempfile
import zipfile

from package import ROOT, ZIP_TIMESTAMP, package_release, read_public

ARCHIVE = "agent-continue-windows-preview-kit.zip"
CHECKSUMS = "SHA256SUMS.txt"
GUIDE = "START-HERE.md"
MAX_EXPANDED_BYTES = 32 * 1024 * 1024
REQUIRED = {GUIDE, "AgentContinue/manifest.json", "AgentContinue/setup.html",
            "WindowsSetup/install.ps1", "WindowsSetup/install.cmd", "WindowsSetup/bin.mjs",
            "WindowsSetup/SHA256SUMS.txt"}
BLOCKED_SUFFIXES = {".exe", ".msi", ".dll", ".pem", ".pfx", ".key", ".crx", ".lnk"}
RESERVED_NAME = re.compile(r"CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9]", re.IGNORECASE)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def checksums(members):
    return "".join(f"{digest(data)}  {name}\n" for name, data in sorted(members.items())).encode("ascii")


def fail(code):
    raise ValueError(code)


def member_path(name):
    relative = PurePosixPath(name)
    if (relative.as_posix() != name or relative.is_absolute()
            or any(not re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9_.-]*", part)
                   or part.endswith(".") or RESERVED_NAME.fullmatch(part.split(".", 1)[0])
                   for part in relative.parts)
            or relative.suffix.lower() in BLOCKED_SUFFIXES):
        fail("invalid_preview_member")
    return relative


def read_archive(filename, prefix=None):
    members = {}
    seen = set()
    with zipfile.ZipFile(filename) as archive:
        entries = archive.infolist()
        if len(entries) > 512 or sum(entry.file_size for entry in entries) > MAX_EXPANDED_BYTES:
            fail("preview_zip_too_large")
        for entry in entries:
            name = entry.filename if prefix is None else prefix + "/" + entry.filename
            relative = member_path(name)
            mode = entry.external_attr >> 16
            if (relative.as_posix().lower() in seen or entry.is_dir()
                    or (stat.S_IFMT(mode) and not stat.S_ISREG(mode)) or entry.flag_bits & 1):
                fail("invalid_preview_member")
            seen.add(name.lower())
            members[name] = archive.read(entry)
    if any(str(parent).lower() in seen for name in members for parent in PurePosixPath(name).parents):
        fail("invalid_preview_member")
    return members


def validate(members):
    if not REQUIRED <= members.keys():
        fail("preview_incomplete")
    if any(name != GUIDE and not name.startswith(("AgentContinue/", "WindowsSetup/")) for name in members):
        fail("unexpected_preview_member")
    manifest = json.loads(members["AgentContinue/manifest.json"])
    if (not isinstance(manifest, dict) or manifest.get("manifest_version") != 3 or "key" in manifest
            or manifest.get("version_name") != f'{manifest.get("version")} Windows device preview'):
        fail("not_windows_preview")
    setup = {name.removeprefix("WindowsSetup/"): data for name, data in members.items()
             if name.startswith("WindowsSetup/") and name != "WindowsSetup/SHA256SUMS.txt"}
    if members["WindowsSetup/SHA256SUMS.txt"] != checksums(setup):
        fail("setup_digest_mismatch")


def verify(filename):
    members = read_archive(filename)
    if members.pop(CHECKSUMS, None) != checksums(members):
        fail("preview_digest_mismatch")
    validate(members)


def build(destination):
    if destination.exists() or destination.is_symlink():
        fail("output_exists")
    with tempfile.TemporaryDirectory(prefix="agent-continue-kit-") as temporary:
        stage = Path(temporary)
        extension = package_release(ROOT, output_directory=stage / "extension", windows_preview=True)
        installer = stage / "setup"
        subprocess.run([sys.executable, str(ROOT / "scripts/build-setup-release.py"), "--source-only", "--output", str(installer)],
                       cwd=ROOT, check=True, capture_output=True)
        members = {**read_archive(extension), **read_archive(installer / "agent-continue-setup.zip", "WindowsSetup")}
        members[GUIDE] = read_public(ROOT, "docs/WINDOWS-PREVIEW-START.md", {}).replace(b"\r\n", b"\n")
        validate(members)
        members[CHECKSUMS] = checksums(members)
        # Verify the complete ZIP before publishing it to the requested directory.
        prepared = stage / ARCHIVE
        with zipfile.ZipFile(prepared, "x") as archive:
            for name, data in sorted(members.items()):
                member = zipfile.ZipInfo(name, date_time=ZIP_TIMESTAMP)
                member.create_system = 3
                mode = 0o755 if name == "WindowsSetup/bin.mjs" else 0o644
                member.external_attr = (stat.S_IFREG | mode) << 16
                archive.writestr(member, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        verify(prepared)
        data = prepared.read_bytes()
        destination.mkdir(parents=True, exist_ok=False)
        output = destination / ARCHIVE
        with output.open("xb") as stream:
            stream.write(data)
        (destination / f"{ARCHIVE}.sha256").write_bytes(checksums({ARCHIVE: data}))
        return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--output", type=Path)
    mode.add_argument("--verify", type=Path)
    args = parser.parse_args()
    try:
        if args.verify is not None:
            verify(args.verify)
            print("Windows preview kit integrity verified.")
        else:
            print(build(args.output))
    except (ValueError, OSError, zipfile.BadZipFile, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from None


if __name__ == "__main__":
    main()
