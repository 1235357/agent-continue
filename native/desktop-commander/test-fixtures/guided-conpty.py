"""Drive the extracted guided installer inside the Node parent's Windows fixture."""

import hmac
from http.client import HTTPConnection, HTTPException
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
from urllib.parse import unquote
from uuid import uuid4


CONFIG_KEYS = {"shell", "packageDir", "installDir", "nodePath",
               "keyPath", "tunnelId", "extensionId"}
PROMPTS = (
    "OpenAI tunnel ID (blank cancels):",
    "Absolute runtime-key FILE PATH, not the key itself (masked; blank cancels):",
    "Type CONNECT to install under this account and request one tunnel connection; Enter cancels:",
)
PAIR_PROMPT = b"Type PAIR to open extension controls; Enter keeps the connection without pairing:"
REGISTER_PROMPT = b"Type REGISTER to install under this account and register browser-managed startup; Enter cancels:"
CLOSE_NOTICE = "Press Enter or Ctrl+C to close local controls; the tunnel is unchanged."
PAIRING_NOTICE = "Paste the next line into local controls only (do not share):"
PAIRING_TICKET = re.compile(r"ACPAIR1:([1-9][0-9]{3,4}):([A-Za-z0-9_-]{43})")
LOOPBACK_ORIGIN = re.compile(r"http://127\.0\.0\.1:([1-9][0-9]{0,4})")
LOOPBACK_HOST = "127.0.0.1"
SESSION_SECONDS = 900
MAX_REPLY_BYTES = 1024
MAX_CONFIG_BYTES = 32 * 1024
MAX_STAGE_BYTES = 64 * 1024
PROMPT_SECONDS = 20
CLOSE_SECONDS = 10
BROWSER_READY_SECONDS = 20
BROWSER_RUN_SECONDS = 50
DRIVE_SECONDS = 255  # Leave time for cleanup before the Node parent's watchdog.
VT_SEQUENCE = re.compile(rb"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))")
PROMPT_BYTES = tuple(prompt.encode("ascii") for prompt in PROMPTS)
OPERATION_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
SAFE_INSTALL_ERRORS = {
    b"node_download_failed", b"node_archive_digest_mismatch", b"node_archive_invalid",
    b"payload_digest_mismatch", b"dependency_acquisition_failed", b"client_acquisition_failed",
    b"manager_profile_mismatch", b"manager_start_unconfirmed", b"bootstrap_failed_exit_1",
    b"setup_configuration_failed", b"local_install_failed",
}


class FixtureError(Exception):
    """An error whose message is safe to report without child or config data."""


def unique_object(pairs):
    value = dict(pairs)
    if len(value) != len(pairs):
        raise ValueError("duplicate JSON field")
    return value


def read_config(path):
    try:
        with open(path, "rb") as source:
            raw = source.read(MAX_CONFIG_BYTES + 1)
        if len(raw) > MAX_CONFIG_BYTES:
            raise ValueError("oversized config")
        config = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)
        if not isinstance(config, dict) or config.keys() - {"pair", "browser", "cmd", "browserManaged"} != CONFIG_KEYS:
            raise ValueError("wrong config fields")
        if type(config.setdefault("pair", False)) is not bool:
            raise ValueError("invalid pair flag")
        if type(config.setdefault("browser", False)) is not bool or (config["browser"] and not config["pair"]):
            raise ValueError("invalid browser flag")
        if type(config.setdefault("cmd", False)) is not bool:
            raise ValueError("invalid cmd flag")
        if (type(config.setdefault("browserManaged", False)) is not bool
                or config["browserManaged"] and any(config[name] for name in ("pair", "browser", "cmd"))):
            raise ValueError("invalid browser-managed fixture")
        for field in CONFIG_KEYS:
            value = config[field]
            if not isinstance(value, str) or not value or re.search(r'["\x00-\x1f\x7f-\x9f]', value):
                raise ValueError("invalid config value")
            if len(value.encode("utf-8")) > 4096:
                raise ValueError("oversized config value")
        for field in ("packageDir", "installDir", "nodePath", "keyPath"):
            if not re.match(r"[A-Za-z]:\\[^\\]", config[field]):
                raise ValueError("expected a local absolute path")
        if not re.fullmatch(r"[a-p]{32}", config["extensionId"]):
            raise ValueError("invalid extension ID")
        if not re.fullmatch(r"tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}", config["tunnelId"]):
            raise ValueError("invalid tunnel ID")
    except (OSError, ValueError, RecursionError) as exc:
        raise FixtureError("invalid_config") from exc
    return config


def require_fixture(config):
    root = Path(os.environ.get("AC_GUIDED_ROOT", ""))
    install = Path(config["installDir"])
    preload = Path(__file__).resolve().with_name("guided-loopback-preload.mjs")
    options = os.environ.get("NODE_OPTIONS", "")
    if not root.is_absolute() or root.resolve(strict=True) != root:
        raise FixtureError("private_fixture_root_noncanonical")
    if install != Path(os.environ.get("AC_GUIDED_INSTALL", "")):
        raise FixtureError("private_fixture_install_mismatch")
    if unquote(options) != "--import=" + unquote(preload.as_uri()):
        raise FixtureError("private_fixture_preload_mismatch")
    if not preload.is_file():
        raise FixtureError("private_fixture_preload_missing")
    for name in ("packageDir", "installDir", "keyPath"):
        candidate = Path(config[name])
        if root not in candidate.parents or ".." in candidate.parts:
            raise FixtureError("path_outside_private_fixture")
    for directory in (Path(config["packageDir"]), install.parent):
        if directory.resolve(strict=True) != directory:
            raise FixtureError("redirected_fixture_path")
    return root


def read_stage(terminal, deadline, stage, *, prompt=None, line_count=None, echo=None):
    raw = bytearray()
    cursor_queries = 0
    # PyWinPTY's socket reader supports a deadline even if the console goes quiet.
    while (remaining := deadline - time.monotonic()) > 0:
        terminal.fileobj.settimeout(remaining)
        try:
            chunk = terminal.fileobj.recv(4096)
        except TimeoutError:
            break
        if not chunk:
            if prompt is not None:
                if stage == "pair":
                    transcript = VT_SEQUENCE.sub(b"", raw)
                    match = re.search(rb"agent_continue_install_failed: ([a-z0-9_]+)", transcript)
                    if match and match.group(1) in SAFE_INSTALL_ERRORS:
                        raise FixtureError("installer_failed_" + match.group(1).decode("ascii"))
                    if b'"error":"manager_start_unconfirmed"' in transcript:
                        raise FixtureError("installer_failed_manager_start_unconfirmed")
                raise FixtureError(f"installer_ended_before_prompt_{stage}")
            if line_count is not None:
                raise FixtureError(f"installer_ended_before_output_{stage}")
            return VT_SEQUENCE.sub(b"", raw).decode("utf-8")
        raw.extend(chunk)
        if len(raw) > MAX_STAGE_BYTES:
            raise FixtureError("terminal_output_limit")
        if stage == 1:
            queries = list(re.finditer(rb"\x1b\[(\?)?6n", raw))
            if len(queries) > 8:
                raise FixtureError("terminal_cursor_query_limit")
            for query in queries[cursor_queries:]:
                # A fresh ConPTY surface starts at 1;1. Answer its startup
                # inheritance query before waiting for application text.
                prefix = re.sub(rb"\x1b\[(?:\??6n|\?25[hl]|[0-9;]*m)", b"", raw[:query.start()])
                if prefix:
                    raise FixtureError("terminal_late_cursor_query")
                reply = "\x1b[" + ("?" if query[1] else "") + "1;1R"
                if terminal.write(reply) != len(reply):
                    raise FixtureError("terminal_cursor_reply_failed")
            cursor_queries = len(queries)
            terminal.initial_cursor_replies = cursor_queries
        if prompt is not None or line_count is not None:
            output = VT_SEQUENCE.sub(b"", raw)
            complete, _, tail = output.rpartition(b"\n")
            if prompt is not None:
                line = tail.strip(b" \t\r")
                if line == prompt:
                    return complete.decode("utf-8")
                if line in PROMPT_BYTES or line in (PAIR_PROMPT, REGISTER_PROMPT):
                    raise FixtureError("unexpected_prompt")
            elif len(output_lines(complete.decode("utf-8"), echo)) >= line_count:
                return output.decode("utf-8")
    observed = VT_SEQUENCE.sub(b"", raw)
    state = "no_bytes" if not raw else "control_only" if not observed.strip() else "prompt_present" if prompt and prompt in observed else "other_output"
    raise FixtureError(f"terminal_timeout_{stage}_{state}")


def output_lines(output, echo=None):
    lines = [line.strip(" \t\r") for line in output.split("\n") if line.strip(" \t\r")]
    if lines and lines[0] == echo:
        lines.pop(0)
    return lines


def write_answer(terminal, answer, stage):
    reply = answer + "\r"
    if terminal.write(reply) != len(reply.encode("utf-8")):
        raise FixtureError(f"prompt_write_failed_{stage}")


def success_line(output):
    lines = output_lines(output, "CONNECT")
    try:
        if len(lines) != 1:
            raise ValueError("expected one result line")
        result = json.loads(lines[0], object_pairs_hook=unique_object)
        expected = {"ok": True, "action": "install-local", "mode": "command-only",
                    "configured": True, "registered": False, "connected": True,
                    "chatAuthorizationVerified": False}
        if not isinstance(result, dict) or result.keys() != expected.keys() | {"manager"}:
            raise ValueError("unexpected result fields")
        manager = result["manager"]
        manager_expected = {"ok": True, "managerRunning": True, "connected": True,
                            "paused": False, "operationStatus": "settled"}
        if not isinstance(manager, dict) or manager.keys() != manager_expected.keys() | {"operationId"}:
            raise ValueError("unexpected manager fields")
        for actual, fields in ((result, expected), (manager, manager_expected)):
            if any(type(actual[key]) is not type(value) or actual[key] != value
                   for key, value in fields.items()):
                raise ValueError("installer did not confirm connection")
        operation = manager["operationId"]
        if not isinstance(operation, str) or not OPERATION_ID.fullmatch(operation):
            raise ValueError("invalid operation ID")
    except (ValueError, RecursionError) as exc:
        raise FixtureError("invalid_installer_result") from exc
    return lines[0]


def pairing_result(output):
    # ConPTY merges the two streams. Require the ticket, notices and closed
    # JSON receipt, but don't depend on when the notice reaches the console.
    lines = output_lines(output, "PAIR")
    try:
        if len(lines) != 4:
            raise ValueError("unexpected browser output")
        lines.remove(CLOSE_NOTICE)
        if lines.pop(0) != PAIRING_NOTICE:
            raise ValueError("missing pairing notice")
        ticket = PAIRING_TICKET.fullmatch(lines[0])
        result = json.loads(lines[1], object_pairs_hook=unique_object)
        if (ticket is None or not isinstance(result, dict)
                or result.keys() != {"ok", "url", "expiresInSeconds"}
                or result["ok"] is not True or not isinstance(result["url"], str)
                or type(result["expiresInSeconds"]) is not int
                or result["expiresInSeconds"] != SESSION_SECONDS):
            raise ValueError("invalid browser receipt")
        origin = LOOPBACK_ORIGIN.fullmatch(result["url"])
        if origin is None or not 1024 <= int(origin[1]) <= 65535 or origin[1] != ticket[1]:
            raise ValueError("invalid browser origin")
        return ticket[0], ticket[2], origin[0], int(origin[1])
    except (ValueError, RecursionError) as exc:
        raise FixtureError("invalid_pairing_output") from exc


def compact_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def verify_signed_status(code, origin, port, deadline):
    nonce, request_id = str(uuid4()), str(uuid4())
    action = "status"
    # The HMAC key is the ASCII pairing code, not its base64url-decoded bytes.
    def sign(fields):
        return hmac.digest(code.encode("ascii"), compact_json(fields), "sha256").hex()

    timeout = min(deadline - time.monotonic(), 15)
    if timeout <= 0:
        raise FixtureError("signed_status_timeout")
    request = {"nonce": nonce, "id": request_id, "action": action,
               "mac": sign(["ac-request-v1", origin, nonce, request_id, action])}
    # HTTPConnection goes straight to this socket (no proxy or redirects).
    conn = HTTPConnection(LOOPBACK_HOST, port, timeout=timeout)
    try:
        conn.request("POST", "/v1/signed-control", compact_json(request),
                     {"Origin": origin, "Sec-Fetch-Site": "same-origin",
                      "Content-Type": "application/json"})
        with conn.getresponse() as response:
            if response.status != 200:
                raise ValueError("status request rejected")
            raw = response.read(MAX_REPLY_BYTES + 1)
        if len(raw) > MAX_REPLY_BYTES:
            raise ValueError("oversized status response")
        envelope = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)
        if (not isinstance(envelope, dict) or envelope.keys() != {"payload", "mac"}
                or not isinstance(envelope["payload"], str) or not isinstance(envelope["mac"], str)
                or not re.fullmatch(r"[0-9a-f]{64}", envelope["mac"])):
            raise ValueError("invalid status envelope")
        payload = envelope["payload"]
        tag = sign(["ac-reply-v1", origin, nonce, request_id, action, payload])
        if not hmac.compare_digest(tag, envelope["mac"]):
            raise ValueError("unauthenticated status response")
        result = json.loads(payload, object_pairs_hook=unique_object)
        if (not isinstance(result, dict)
                or result.keys() != {"ok", "id", "connection", "paused", "operationStatus", "expiresAt"}
                or result["ok"] is not True or result["id"] != request_id
                or result["connection"] != "ready" or result["paused"] is not False
                or type(result["expiresAt"]) is not int
                or not 0 < result["expiresAt"] - time.time_ns() // 1_000_000 <= SESSION_SECONDS * 1000):
            raise ValueError("signed status did not confirm a ready connection")
    except (OSError, HTTPException, ValueError, RecursionError) as exc:
        raise FixtureError("invalid_signed_status") from exc
    finally:
        conn.close()


def verify_guided_browser(config, root, ticket, origin, deadline):
    marker = root / "guided-roundtrip-ready"
    ready_deadline = min(deadline, time.monotonic() + BROWSER_READY_SECONDS)
    while (remaining := ready_deadline - time.monotonic()) > 0:
        if marker.exists():
            break
        time.sleep(min(remaining, 0.05))
    else:
        raise FixtureError("guided_browser_ready_timeout")

    helper = Path(__file__).resolve().parents[3] / "tests" / "guided-extension-control.mjs"
    extension = root / "extension" / "AgentContinue"
    profile = root / "chromium-profile"
    if not helper.is_file() or helper.resolve() != helper:
        raise FixtureError("guided_browser_helper_unavailable")
    if extension.resolve() != extension or profile.resolve() != profile:
        raise FixtureError("redirected_fixture_path")

    payload = {"extensionDir": str(extension), "profileDir": str(profile),
               "extensionId": config["extensionId"], "origin": origin, "ticket": ticket}
    # Keep the parent's Playwright cache setting, but not the installer preload.
    env = {key: value for key, value in os.environ.items() if key.upper() != "NODE_OPTIONS"}
    timeout = min(deadline - time.monotonic(), BROWSER_RUN_SECONDS)
    if timeout <= 0:
        raise FixtureError("guided_browser_timeout")
    try:
        result = subprocess.run([config["nodePath"], str(helper)], input=compact_json(payload),
                                capture_output=True, timeout=timeout, env=env,
                                creationflags=subprocess.CREATE_NO_WINDOW)
    except subprocess.TimeoutExpired:
        raise FixtureError("guided_browser_timeout") from None
    except OSError:
        raise FixtureError("guided_browser_launch_failed") from None
    if (result.returncode != 0 or result.stderr
            or result.stdout not in (b"guided_browser_pass", b"guided_browser_pass\n", b"guided_browser_pass\r\n")):
        label = result.stderr.strip()
        if re.fullmatch(rb"guided_browser_(input|scope|manifest|launch|identity|setup|pair|pause|reconnect|persistence|close)_(failed|timeout)", label):
            raise FixtureError(label.decode("ascii"))
        raise FixtureError("guided_browser_failed")


def require_listener_stopped(port, deadline):
    while (remaining := deadline - time.monotonic()) > 0:
        try:
            # Windows can take about two seconds to report a loopback refusal.
            with socket.create_connection((LOOPBACK_HOST, port), timeout=min(remaining, 3)):
                pass
        except ConnectionRefusedError:
            return
        except TimeoutError:
            pass  # Only a refusal proves the loopback listener stopped.
        time.sleep(0.05)
    raise FixtureError("browser_listener_stop_unconfirmed")


def drive(config):
    from winpty import Backend, PtyProcess

    root = require_fixture(config)
    if config["browserManaged"] != (os.environ.get("AC_GUIDED_CAPTURE_WAKE_REGISTRATION") == "1"):
        raise FixtureError("registry_capture_required")
    shell = shutil.which(config["shell"])
    if shell is None or Path(shell).name.lower() not in {"powershell.exe", "pwsh.exe"}:
        raise FixtureError("powershell_unavailable")
    installer = Path(config["packageDir"]) / "install.ps1"
    for entry in (installer, installer.with_name("bin.mjs")):
        if not entry.is_file() or entry.resolve(strict=True) != entry:
            raise FixtureError("installer_unavailable")
    args = [shell, "-NoLogo", "-NoProfile", "-File", str(installer),
            "-InstallLocal", "-Consent", "accept-install", "-PromptForConnection",
            "-ExtensionId", config["extensionId"], "-InstallDir", config["installDir"],
            "-NodePath", config["nodePath"]]
    prompts, confirmation = PROMPT_BYTES, "CONNECT"
    if config["browserManaged"]:
        args.append("-BrowserManaged")
        prompts, confirmation = PROMPT_BYTES[:2] + (REGISTER_PROMPT,), "REGISTER"
    if config["cmd"]:
        local = Path(os.environ.get("LOCALAPPDATA", ""))
        batch = installer.with_suffix(".cmd")
        if (not local.is_absolute() or root not in local.parents or local.resolve(strict=True) != local
                or local / "AgentContinue" != Path(config["installDir"])
                or not batch.is_file() or batch.resolve(strict=True) != batch):
            raise FixtureError("invalid_cmd_fixture")
        cmd = Path(os.environ["SystemRoot"]) / "System32" / "cmd.exe"
        args = [str(cmd), "/d", "/c", "install.cmd", "guided", config["extensionId"]]
    answers = (config["tunnelId"], f'"{config["keyPath"]}"', confirmation)
    # A wide terminal keeps the console's result JSON on one physical line.
    deadline = time.monotonic() + DRIVE_SECONDS
    # Inherit the parent's fixture cwd and environment, including its private roots.
    terminal = PtyProcess.spawn(args, cwd=str(installer.parent) if config["cmd"] else None,
                                dimensions=(30, 4096), backend=Backend.ConPTY)
    try:
        for stage, (prompt, answer) in enumerate(zip(prompts, answers), 1):
            output = read_stage(terminal, min(deadline, time.monotonic() + PROMPT_SECONDS), stage, prompt=prompt)
            if stage == 1 and f'Chrome extension ID: {config["extensionId"]}' not in output_lines(output):
                raise FixtureError("installer_extension_identity_missing")
            if stage == 1:
                (root / "guided-terminal-protocol.json").write_text(
                    json.dumps({"initialPromptObserved": True,
                                "cursorReplies": terminal.initial_cursor_replies}), encoding="utf-8")
            write_answer(terminal, answer, stage)
        if config["browserManaged"]:
            lines = output_lines(read_stage(terminal, deadline, "register"), "REGISTER")
            if terminal.exitstatus != 0 or len(lines) != 1:
                raise FixtureError("browser_managed_installer_failed")
            return lines[0]
        result = success_line(read_stage(terminal, deadline, "pair", prompt=PAIR_PROMPT))
        port = None
        if config["pair"]:
            write_answer(terminal, "PAIR", "pair")
            try:
                output = read_stage(terminal, min(deadline, time.monotonic() + PROMPT_SECONDS),
                                    "browser", line_count=4, echo="PAIR")
                ticket, code, origin, port = pairing_result(output)
                verify_signed_status(code, origin, port, deadline)
                if config["browser"]:
                    verify_guided_browser(config, root, ticket, origin, deadline - CLOSE_SECONDS)
            finally:
                # Close only the foreground browser session, not the tunnel.
                if terminal.pty.isalive():
                    write_answer(terminal, "", "browser_close")
                    tail = read_stage(terminal, min(deadline, time.monotonic() + CLOSE_SECONDS), "browser_close")
                else:
                    tail = None
        else:
            write_answer(terminal, "", "skip_pair")
            tail = read_stage(terminal, min(deadline, time.monotonic() + CLOSE_SECONDS), "skip_pair")
        if terminal.exitstatus != 0:
            raise FixtureError("installer_exit_not_successful")
        if tail is None or output_lines(tail):
            raise FixtureError("unexpected_post_pair_output")
        if port is not None:
            require_listener_stopped(port, min(deadline, time.monotonic() + CLOSE_SECONDS))
        return result
    finally:
        # Do not signal the console group or touch detached manager/tunnel children.
        if terminal.pty.isalive():
            os.kill(terminal.pid, signal.SIGTERM)
            cleanup_deadline = time.monotonic() + 2
            while terminal.pty.isalive():
                if time.monotonic() >= cleanup_deadline:
                    raise FixtureError("powershell_exit_unconfirmed")
                time.sleep(0.02)
        terminal.close()


def main():
    try:
        if sys.platform != "win32" or len(sys.argv) != 2:
            raise FixtureError("expected_windows_and_one_config_path")
        result = drive(read_config(sys.argv[1]))
        print(result)
    except FixtureError as exc:
        print(f"guided_conpty: {exc}", file=sys.stderr)
        return 1
    except (Exception, KeyboardInterrupt):
        print("guided_conpty: terminal_driver_failed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
