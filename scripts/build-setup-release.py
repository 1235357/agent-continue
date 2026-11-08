"""Build a verified combined Windows setup candidate; never install or publish it.

The default/--combined contract requires a separately built administrator ZIP.
--source-only explicitly builds a current-account source kit, not full delivery.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import zipfile

ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
SETUP_ARCHIVE = "agent-continue-setup.zip"
ADMIN_ARCHIVE = "agent-continue-windows-administrator-x64.zip"
ADMIN_INSTALLER = "install-administrator.ps1"
ADMIN_STAGER = "Stage-WindowsAdministratorBundle.ps1"
ADMIN_MANIFEST_LIMIT = 40000
ADMIN_ENTRY_LIMIT = 192 * 1024 * 1024
ADMIN_TOTAL_LIMIT = ADMIN_ARCHIVE_LIMIT = 768 * 1024 * 1024
ADMIN_METADATA_LIMIT = 65536
ADMIN_MODULES = {
    "windows-admin-owner.mjs": "windowsAdministratorOwnerSha256",
    "windows-admin-browser-host.mjs": "windowsAdministratorBrowserHostSha256",
    "windows-admin-demand.mjs": "windowsAdministratorDemandSha256",
    "windows-admin-intent.mjs": "windowsAdministratorIntentSha256",
    "windows-owner-job.cs": "windowsAdministratorJobSourceSha256",
}
ADMIN_SESSION_MODULES = ("windows-admin-browser-session.mjs", "windows-browser-peer.cs", "windows-browser-peer.ps1")
# Keep aligned with the official portable Node pins in build-windows-administrator-bundle.mjs.
NODE_PIN = {"version": "22.23.4",
            "archiveSha256": "cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20",
            "executableSha256": "dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f"}
# Existing locked search dependency, not an installer. Binary pin is from the
# owner's SHA256-pinned 70a97761 acceptance bundle; require matching npm metadata too.
RIPGREP_PACKAGE = "node_modules/@vscode/ripgrep-win32-x64"
RIPGREP_EXECUTABLE = "app/" + RIPGREP_PACKAGE + "/bin/rg.exe"
RIPGREP_PIN = {"version": "1.18.0",
               "integrity": "sha512-KNPvtElldqILHdnAetujPaowkNbpqJy3ssIGGN6F6Kve9Qi+nNLI2DN01O83JjCEVQbCzl8Ov3QZ9Eov3BR8Dg==",
               "executableSha256": "f9dde63498b3193f098355dbec97af99dc4f6b8fa0df5ed04114a03012c042cb"}
WINDOWS = os.name == "nt"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(65536):
            digest.update(chunk)
    return digest.hexdigest()


def regular_input(path, limit):
    for parent in (path, *path.parents):
        if parent.is_symlink() or getattr(parent, "is_junction", lambda: False)():
            raise ValueError("administrator_input_redirected")
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not 0 < info.st_size <= limit:
        raise ValueError("administrator_input_size_or_type")
    return info


def source_bytes(path):
    regular_input(path, 4 * 1024 * 1024)
    with path.open("rb") as stream:
        data = stream.read(4 * 1024 * 1024 + 1)
    if not 0 < len(data) <= 4 * 1024 * 1024:
        raise ValueError("administrator_source_size")
    return data


def snapshot_archive(source, destination):
    info = regular_input(source, ADMIN_ARCHIVE_LIMIT)
    with source.open("rb") as stream, destination.open("xb") as target:
        opened = os.fstat(stream.fileno())
        if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
            raise ValueError("administrator_input_changed")
        copied = 0
        while chunk := stream.read(65536):
            copied += len(chunk)
            if copied > ADMIN_ARCHIVE_LIMIT:
                raise ValueError("administrator_archive_size")
            target.write(chunk)
        if copied != info.st_size:
            raise ValueError("administrator_input_changed")


def metadata(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("administrator_metadata_duplicate")
            result[key] = value
        return result

    def nonfinite(_):
        raise ValueError("administrator_metadata_nonfinite")

    if len(data) > ADMIN_METADATA_LIMIT:
        raise ValueError("administrator_metadata_size")
    try:
        value = json.loads(data.decode("utf-8"), object_pairs_hook=pairs, parse_constant=nonfinite)
    except (UnicodeError, RecursionError) as error:
        raise ValueError("administrator_metadata_invalid") from error
    if not isinstance(value, dict):
        raise ValueError("administrator_metadata_invalid")
    return value


def verify_administrator_bundle(archive_path, payload, repo):
    """Inspect and hash ZIP data only; never extract, import, or execute its payload."""
    regular_input(archive_path, ADMIN_ARCHIVE_LIMIT)
    runtime = {"app/" + name.removeprefix("payload/"): sha256(data)
               for name, data in payload.items() if name.startswith("payload/")}
    sources = {"app/" + name: sha256(source_bytes(repo / "native/desktop-commander" / name))
               for name in (*ADMIN_MODULES, *ADMIN_SESSION_MODULES)}
    pins = metadata(payload["payload/tunnel-pins.json"])
    tunnel = pins["platforms"]["win32-x64"]
    stem = tunnel["asset"].removesuffix(".zip")
    notices = {"app/third-party-notices/" + name for name in (
        "node-LICENSE.txt", "openai-LICENSE", "openai-NOTICE", "openai-" + stem + "-licenses.txt",
        "openai-" + stem + ".spdx.json", "agent-continue-LICENSE.txt")}
    required = {*runtime, *sources, *notices, "runtime/node.exe", "client/tunnel-client-runtime.exe",
                "app/node_modules/@wonderwhy-er/desktop-commander/package.json",
                "app/node_modules/@wonderwhy-er/desktop-commander/dist/server.js",
                "app/agent-continue-build-evidence.json"}
    lock = json.loads(payload["payload/package-lock.json"])
    ripgrep = lock.get("packages", {}).get(RIPGREP_PACKAGE)
    if ripgrep is not None:
        if (not isinstance(ripgrep, dict) or ripgrep.get("version") != RIPGREP_PIN["version"]
                or ripgrep.get("integrity") != RIPGREP_PIN["integrity"] or ripgrep.get("link")
                or ripgrep.get("os") != ["win32"] or ripgrep.get("cpu") != ["x64"]):
            raise ValueError("administrator_ripgrep_lock_mismatch")
        required.update({RIPGREP_EXECUTABLE, "app/" + RIPGREP_PACKAGE + "/package.json",
                         "app/" + RIPGREP_PACKAGE + "/LICENSE"})
    executables = {"runtime/node.exe", "client/tunnel-client-runtime.exe"}
    if ripgrep is not None:
        executables.add(RIPGREP_EXECUTABLE)
    hashes, sizes, parents, entries = {}, {}, {}, {}
    with zipfile.ZipFile(archive_path) as archive:
        members = archive.infolist()
        if not len(required) <= len(members) <= ADMIN_MANIFEST_LIMIT:
            raise ValueError("administrator_bundle_incomplete_or_limit")
        total = 0
        for entry in members:
            name = entry.filename
            kind = stat.S_IFMT(entry.external_attr >> 16)
            if (entry.orig_filename != name or len(name) >= 248
                    or not re.fullmatch(r"app/[A-Za-z0-9@_.+/-]+|runtime/node\.exe|client/tunnel-client-runtime\.exe", name)
                    or kind not in (0, stat.S_IFREG) or entry.external_attr & 0x410 or entry.flag_bits & 1
                    or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                    or name.lower() in entries or not 0 <= entry.file_size <= ADMIN_ENTRY_LIMIT):
                raise ValueError("administrator_bundle_member")
            for part in name.split("/"):
                if (not part or part in (".", "..") or part.endswith(".")
                        or re.match(r"(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)", part, re.I)
                        or re.fullmatch(r"\.env(?:\..*)?|\.npmrc|runtime\.key|tunnel\.yaml|binding\.json", part, re.I)
                        or re.search(r"\.(?:pfx|p12|pem|key)$", part, re.I)):
                    raise ValueError("administrator_bundle_member")
            if name.lower().endswith((".exe", ".msi")) and name not in executables:
                raise ValueError("administrator_unexpected_binary")
            entries[name.lower()] = entry
            total += entry.file_size
            if total > ADMIN_TOTAL_LIMIT:
                raise ValueError("administrator_bundle_expanded_limit")
            parent = name
            while "/" in parent:
                parent = parent.rsplit("/", 1)[0]
                if parents.setdefault(parent.lower(), parent) != parent:
                    raise ValueError("administrator_bundle_parent_collision")
        if entries.keys() & parents.keys() or not required <= {entry.filename for entry in members}:
            raise ValueError("administrator_bundle_incomplete_or_collision")
        for entry in members:
            if entry.filename in required and entry.file_size == 0:
                raise ValueError("administrator_bundle_empty_required_member")
            digest, size = hashlib.sha256(), 0
            with archive.open(entry) as stream:
                while chunk := stream.read(65536):
                    size += len(chunk)
                    if size > entry.file_size:
                        raise ValueError("administrator_bundle_content_size")
                    digest.update(chunk)
            if size != entry.file_size:
                raise ValueError("administrator_bundle_content_size")
            hashes[entry.filename], sizes[entry.filename] = digest.hexdigest(), size
        expected_hashes = {**runtime, **sources, "runtime/node.exe": NODE_PIN["executableSha256"],
                           "client/tunnel-client-runtime.exe": tunnel["executableSha256"],
                           "app/third-party-notices/openai-" + stem + ".spdx.json": tunnel["spdxSha256"],
                           "app/third-party-notices/agent-continue-LICENSE.txt": sha256(source_bytes(repo / "LICENSE"))}
        if ripgrep is not None:
            expected_hashes[RIPGREP_EXECUTABLE] = RIPGREP_PIN["executableSha256"]
        if any(hashes[name] != digest for name, digest in expected_hashes.items()):
            raise ValueError("administrator_bundle_source_or_runtime_mismatch")
        upstream = metadata(payload["payload/upstream-pin.json"])
        provider_prefix = "app/node_modules/@wonderwhy-er/desktop-commander/"
        records = [[name[len(provider_prefix):], sizes[name], hashes[name]] for name in sorted(hashes)
                   if name == provider_prefix + "package.json" or name.startswith(provider_prefix + "dist/")]
        tree = json.dumps(records, separators=(",", ":")).encode("ascii")

        def archive_metadata(name):
            entry = entries[name.lower()]
            if entry.file_size > ADMIN_METADATA_LIMIT:
                raise ValueError("administrator_metadata_size")
            return metadata(archive.read(entry))

        provider = archive_metadata(provider_prefix + "package.json")
        if ripgrep is not None:
            search = archive_metadata("app/" + RIPGREP_PACKAGE + "/package.json")
            if (search.get("name") != "@vscode/ripgrep-win32-x64" or search.get("version") != RIPGREP_PIN["version"]
                    or search.get("os") != ["win32"] or search.get("cpu") != ["x64"]):
                raise ValueError("administrator_ripgrep_metadata_mismatch")
        if (len(records) != upstream["files"] or sha256(tree) != upstream["treeSha256"]
                or provider.get("name") != upstream["name"] or provider.get("version") != upstream["version"]):
            raise ValueError("administrator_provider_mismatch")
        evidence = archive_metadata("app/agent-continue-build-evidence.json")
        expected = {"format": "agent-continue-windows-administrator-build", "version": 1,
                    "sourcePayloadSha256": sha256(payload["payload-manifest.json"]),
                    "npmLockSha256": hashes["app/package-lock.json"],
                    **{field: sources["app/" + name] for name, field in ADMIN_MODULES.items()},
                    "windowsAdministratorBrowserSessionSources": {name: sources["app/" + name] for name in ADMIN_SESSION_MODULES},
                    "node": NODE_PIN, "provider": upstream["version"], "tunnel": pins["release"],
                    "tunnelExecutableSha256": tunnel["executableSha256"], "tunnelArchiveSha256": tunnel["archiveSha256"]}
        if type(evidence.get("version")) is not int or evidence != expected:
            raise ValueError("administrator_build_evidence_mismatch")
    return len(members)


def administrator_plan_error(code, result, receipt):
    """Expose only the data-only Plan vocabulary, never raw process output or paths."""
    phase = diagnostic = "unavailable"
    if receipt is not None:
        value = receipt.get("phase")
        phase = value if value in ("input", "anchor", "archive", "layout", "complete") else "unrecognized"
        diagnostic = "none" if receipt.get("diagnostic") == "none" else "unrecognized"
    details = {"returncode": result.returncode, "phase": phase, "diagnostic": diagnostic,
               "receipt": "invalid" if receipt is None else "valid", "stderrPresent": bool(result.stderr)}
    return ValueError(code + ": " + json.dumps(details, separators=(",", ":")))


def run_administrator_plan(stager, archive, digest, files):
    # Plan is the repository stager's data-only path, never Stage/AcceptLocal/InstallBrowserOwner.
    if not WINDOWS:
        return False
    shell = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    if not shell.is_file():
        raise ValueError("administrator_plan_shell_unavailable")
    regular_input(archive, ADMIN_ARCHIVE_LIMIT)
    # PS5.1 GetFullPath expands 8.3 aliases; Python TEMP may still contain one.
    # Reject redirects before resolving, then keep the stager's canonical-path assertion intact.
    archive = archive.resolve(strict=True)
    try:
        result = subprocess.run([str(shell), "-NoLogo", "-NoProfile", "-NonInteractive", "-File", str(stager),
                                 "-Action", "Plan", "-Archive", str(archive), "-ExpectedSha256", digest],
                                capture_output=True, text=True, timeout=180,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except subprocess.TimeoutExpired:
        raise ValueError("administrator_stager_plan_timeout") from None
    try:
        receipt = metadata(result.stdout.encode("utf-8"))
    except ValueError:
        receipt = None
    if result.returncode != 0 or result.stderr or receipt is None:
        raise administrator_plan_error("administrator_stager_plan_failed", result, receipt)
    false_flags = ("protectedFilesVerified", "administratorStateVerified", "cleanLaunchPlanVerified",
                   "administratorChildVerified", "hostedBindingPrepared", "hostedLaunchPlanVerified",
                   "activated", "registrationChanged", "tunnelStarted")
    if (receipt.get("ok") is not True or receipt.get("phase") != "complete"
            or type(receipt.get("files")) is not int or receipt["files"] != files
            or any(receipt.get(flag) is not False for flag in false_flags)):
        raise administrator_plan_error("administrator_stager_plan_receipt", result, receipt)
    return True


def pin_installer(source, version):
    if not isinstance(version, str) or not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", version):
        raise ValueError("invalid_release_version")
    marker = b"$script:acReleaseTag = ''"
    if source.count(marker) != 1:
        raise ValueError("installer_release_marker")
    return source.replace(marker, f"$script:acReleaseTag = 'v{version}'".encode("ascii"))


def pin_administrator_hash(source, variable, digest):
    if (variable not in ("acAdministratorBundleSha256", "acAdministratorStagerSha256", "acAdministratorInstallerSha256")
            or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest)):
        raise ValueError("administrator_hash_input")
    marker = f"$script:{variable} = ''".encode("ascii")
    if source.count(marker) != 1:
        raise ValueError("administrator_hash_marker")
    return source.replace(marker, f"$script:{variable} = '{digest}'".encode("ascii"))


def verify_combined_release(destination, payload, version, setup_digest, bundle_digest):
    """Read back the six local assets against the already verified build snapshot."""
    expected = {SETUP_ARCHIVE: setup_digest, ADMIN_ARCHIVE: bundle_digest,
                **{name: sha256(payload[name]) for name in ("install.ps1", ADMIN_INSTALLER, ADMIN_STAGER)}}
    if {path.name for path in destination.iterdir()} != {*expected, "SHA256SUMS.txt"}:
        raise ValueError("combined_release_asset_inventory")
    for name, digest in expected.items():
        regular_input(destination / name, ADMIN_ARCHIVE_LIMIT if name.endswith(".zip") else 4 * 1024 * 1024)
        if file_digest(destination / name) != digest:
            raise ValueError("combined_release_asset_mismatch: " + name)
    assignments = (("install.ps1", "acReleaseTag", "v" + version),
                   (ADMIN_INSTALLER, "acReleaseTag", "v" + version),
                   ("install.ps1", "acAdministratorInstallerSha256", expected[ADMIN_INSTALLER]),
                   (ADMIN_INSTALLER, "acAdministratorBundleSha256", bundle_digest),
                   (ADMIN_INSTALLER, "acAdministratorStagerSha256", expected[ADMIN_STAGER]))
    for name, variable, value in assignments:
        marker = f"$script:{variable} = '{value}'".encode("ascii")
        if (payload[name].count(marker) != 1
                or len(re.findall(rb"(?mi)^\s*\$script:" + variable.encode("ascii") + rb"\s*=", payload[name])) != 1):
            raise ValueError("combined_release_pin_mismatch: " + variable)
    payload_lines = [f"{sha256(data)}  {name}" for name, data in payload.items()]
    inner_sums = ("\n".join(payload_lines) + "\n").encode("ascii")
    with zipfile.ZipFile(destination / SETUP_ARCHIVE) as archive:
        members = {**payload, "SHA256SUMS.txt": inner_sums}
        if archive.namelist() != list(members):
            raise ValueError("combined_release_source_inventory")
        for name, data in members.items():
            if archive.read(name) != data:
                raise ValueError("combined_release_source_mismatch: " + name)
    # Outer sums include all five downloadable inputs plus extracted source files;
    # SHA256SUMS cannot hash itself. Its own pin is included in the build receipt.
    outer_sums = ("\n".join([*payload_lines, f"{setup_digest}  {SETUP_ARCHIVE}",
                            f"{bundle_digest}  {ADMIN_ARCHIVE}"]) + "\n").encode("ascii")
    sums = source_bytes(destination / "SHA256SUMS.txt")
    if sums != outer_sums:
        raise ValueError("combined_release_checksums_mismatch")
    return {**expected, "SHA256SUMS.txt": sha256(sums)}


def build_release(repo, destination, administrator_bundle=None, *, combined=True):
    if combined and administrator_bundle is None:
        raise ValueError("combined_administrator_bundle_required")
    if not combined and administrator_bundle is not None:
        raise ValueError("source_only_administrator_bundle_forbidden")
    destination = destination.absolute()
    if destination.exists() or destination.is_symlink():
        raise SystemExit("output_exists")
    version = json.loads((repo / "manifest.json").read_text(encoding="utf-8"))["version"]
    with tempfile.TemporaryDirectory(prefix="ac-setup-release-") as temporary:
        stage = Path(temporary) / "package"
        subprocess.run(["node", str(repo / "native/bootstrap/build-package.mjs"),
                        "--output", str(stage)], check=True, cwd=repo, capture_output=True, text=True)
        files = sorted((p for p in stage.rglob("*") if p.is_file()),
                       key=lambda p: p.relative_to(stage).as_posix())
        required = {"install.ps1", "install.cmd", "bin.mjs", "Prepare-ReleaseNative.ps1", "native-publishers.json",
                    "registration-execution.mjs", "registration-writer.mjs", "registry-win.mjs",
                    "browser-wake-registration.mjs"}
        names = [p.relative_to(stage).as_posix() for p in files]
        if not required <= set(names) or any(p.is_symlink() for p in stage.rglob("*")):
            raise SystemExit("payload_incomplete")
        payload = {name: file.read_bytes() for name, file in zip(names, files)}
        payload["install.ps1"] = pin_installer(payload["install.ps1"], version)
        administrator = None
        plan_verified = False
        if administrator_bundle is not None:
            payload[ADMIN_INSTALLER] = pin_installer(source_bytes(repo / "native/bootstrap" / ADMIN_INSTALLER), version)
            payload[ADMIN_STAGER] = source_bytes(repo / "scripts" / ADMIN_STAGER)
            administrator = Path(temporary) / ADMIN_ARCHIVE
            snapshot_archive(administrator_bundle.absolute(), administrator)
            count = verify_administrator_bundle(administrator, payload, repo)
            bundle_digest = file_digest(administrator)
            stager_digest = sha256(payload[ADMIN_STAGER])
            payload[ADMIN_INSTALLER] = pin_administrator_hash(payload[ADMIN_INSTALLER],
                "acAdministratorBundleSha256", bundle_digest)
            payload[ADMIN_INSTALLER] = pin_administrator_hash(payload[ADMIN_INSTALLER],
                "acAdministratorStagerSha256", stager_digest)
            payload["install.ps1"] = pin_administrator_hash(payload["install.ps1"],
                "acAdministratorInstallerSha256", sha256(payload[ADMIN_INSTALLER]))
            stager = Path(temporary) / ADMIN_STAGER
            stager.write_bytes(payload[ADMIN_STAGER])
            plan_verified = run_administrator_plan(stager, administrator, bundle_digest, count)
        if any(name.lower().endswith((".exe", ".msi", ".zip")) for name in payload):
            raise ValueError("setup_source_contains_binary_or_archive")
        destination.mkdir(parents=True, exist_ok=False)
        archive = destination / SETUP_ARCHIVE
        digest = file_digest
        payload_lines = [f"{hashlib.sha256(data).hexdigest()}  {name}" for name, data in payload.items()]
        # The embedded list checks payload files only. The outer release list
        # additionally checks the ZIP; neither list attempts to hash itself.
        inner_sums = ("\n".join(payload_lines) + "\n").encode("ascii")
        members = {**payload, "SHA256SUMS.txt": inner_sums}
        with zipfile.ZipFile(archive, "x") as bundle:
            for name, data in members.items():
                member = zipfile.ZipInfo(name, date_time=ZIP_TIMESTAMP)
                member.create_system = 3
                mode = 0o755 if name == "bin.mjs" else 0o644
                member.external_attr = (stat.S_IFREG | mode) << 16
                bundle.writestr(member, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        lines = list(payload_lines)
        setup_digest = digest(archive)
        lines.append(f"{setup_digest}  {archive.name}")
        if administrator is not None:
            target = destination / ADMIN_ARCHIVE
            shutil.copyfile(administrator, target)
            if digest(target) != digest(administrator):
                raise ValueError("administrator_bundle_copy_mismatch")
            lines.append(f"{digest(target)}  {ADMIN_ARCHIVE}")
            for name in (ADMIN_INSTALLER, ADMIN_STAGER):
                (destination / name).write_bytes(payload[name])
        (destination / "SHA256SUMS.txt").write_bytes(("\n".join(lines) + "\n").encode("ascii"))
        (destination / "install.ps1").write_bytes(payload["install.ps1"])
        with zipfile.ZipFile(archive) as bundle:
            if bundle.namelist() != list(members):
                raise ValueError("setup_source_inventory_mismatch")
            for name, data in members.items():
                if bundle.read(name) != data:
                    raise ValueError("setup_source_content_mismatch")
        delivery_receipt = {"deliveryContract": "current-account-source-only", "combinedBuilt": False,
                            "limitation": "not_full_combined_delivery"}
        if combined:
            assets = verify_combined_release(destination, payload, version, setup_digest, bundle_digest)
            delivery_receipt = {"deliveryContract": "combined-public", "combinedBuilt": True, "assets": assets}
        administrator_receipt = {} if administrator is None else {
            "administratorBundleVerified": True, "administratorStagerPlan": plan_verified,
            "administratorBundle": str(destination / ADMIN_ARCHIVE), "administratorBundleSha256": digest(administrator)}
        print(json.dumps({"built": True, "files": len(members), "archive": str(archive),
                          "sha256": setup_digest, "releaseTag": "v" + version, "installed": False, "published": False,
                          **delivery_receipt, **administrator_receipt}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--combined", "--combined-public", dest="combined", action="store_true",
                       help="Require the full pinned six-asset Windows closure (default); no install or publish")
    modes.add_argument("--source-only", dest="combined", action="store_false",
                       help="Current-account source kit only; NOT full combined Windows delivery")
    parser.set_defaults(combined=True)
    parser.add_argument("--administrator-bundle", type=Path,
                        help="Separately built Windows x64 administrator ZIP, required for combined delivery")
    args = parser.parse_args()
    try:
        build_release(Path(__file__).resolve().parents[1], args.output, args.administrator_bundle, combined=args.combined)
    except (ValueError, OSError, KeyError, zipfile.BadZipFile, subprocess.SubprocessError) as error:
        raise SystemExit(str(error)) from None


if __name__ == "__main__":
    main()
