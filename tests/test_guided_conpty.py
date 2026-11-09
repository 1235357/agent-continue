"""Content-free terminal protocol regressions; no child process or network."""

import importlib.util
from pathlib import Path
import time
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "native/desktop-commander/test-fixtures/guided-conpty.py"
SPEC = importlib.util.spec_from_file_location("guided_conpty_fixture", SOURCE)
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)


class Terminal:
    def __init__(self, query, response, replies=1):
        self.fileobj = self
        self.chunks = [query[:2], query[2:]]
        self.response = response
        self.replies = replies
        self.writes = []

    def settimeout(self, remaining):
        if remaining <= 0:
            raise AssertionError("invalid deadline")

    def recv(self, size):
        if self.chunks:
            return self.chunks.pop(0)
        if self.writes != [self.response] * self.replies:
            raise TimeoutError()
        return b"fixture ready\r\n" + FIXTURE.PROMPT_BYTES[0]

    def write(self, text):
        self.writes.append(text)
        return len(text.encode("utf-8"))


class GuidedTerminalTests(unittest.TestCase):
    def test_initial_cursor_query_is_answered_before_waiting_for_the_prompt(self):
        for query, response in ((b"\x1b[6n", "\x1b[1;1R"), (b"\x1b[?6n", "\x1b[?1;1R")):
            with self.subTest(query=query):
                terminal = Terminal(query, response)
                result = FIXTURE.read_stage(terminal, time.monotonic() + 1, 1,
                                            prompt=FIXTURE.PROMPT_BYTES[0])
                self.assertEqual(result, "fixture ready\r")
                self.assertEqual(terminal.writes, [response])

    def test_sgr_before_startup_query_is_harmless(self):
        for sgr in (b"\x1b[m", b"\x1b[0m", b"\x1b[1;31m"):
            for query, reply in ((b"\x1b[6n", "\x1b[1;1R"),
                                 (b"\x1b[?6n", "\x1b[?1;1R")):
                raw = sgr + query
                for split in range(1, len(raw)):
                    with self.subTest(sgr=sgr, query=query, split=split):
                        terminal = Terminal(raw, reply)
                        terminal.chunks = [raw[:split], raw[split:]]
                        result = FIXTURE.read_stage(terminal, time.monotonic() + 1, 1,
                                                    prompt=FIXTURE.PROMPT_BYTES[0])
                        self.assertEqual(result, "fixture ready\r")
                        self.assertEqual(terminal.writes, [reply])

    def test_plain_prompt_requires_no_input(self):
        terminal = Terminal(b"", "unused")
        terminal.chunks = [b"fixture ready\r\n" + FIXTURE.PROMPT_BYTES[0]]
        self.assertEqual(FIXTURE.read_stage(terminal, time.monotonic() + 1, 1,
                                          prompt=FIXTURE.PROMPT_BYTES[0]), "fixture ready\r")
        self.assertEqual(terminal.writes, [])

    def test_queries_after_visible_text_are_not_answered_with_a_guessed_position(self):
        for prefix in (b"visible text", b"\x1b[2;5H", b"\r\n", b" ",
                       b"\x1b[0m\x1b[2;5H", b"\x1b[0m "):
            with self.subTest(prefix=prefix):
                terminal = Terminal(prefix + b"\x1b[6n", "unused")
                with self.assertRaisesRegex(FIXTURE.FixtureError, "^terminal_late_cursor_query$"):
                    FIXTURE.read_stage(terminal, time.monotonic() + 1, 1, prompt=FIXTURE.PROMPT_BYTES[0])
                self.assertEqual(terminal.writes, [])

    def test_query_flood_is_bounded_before_responses(self):
        terminal = Terminal(b"\x1b[6n" * 9, "unused")
        with self.assertRaisesRegex(FIXTURE.FixtureError, "^terminal_cursor_query_limit$"):
            FIXTURE.read_stage(terminal, time.monotonic() + 1, 1, prompt=FIXTURE.PROMPT_BYTES[0])
        self.assertEqual(terminal.writes, [])

    def test_eight_startup_queries_are_each_answered_once(self):
        terminal = Terminal(b"\x1b[6n" * 8, "\x1b[1;1R", replies=8)
        FIXTURE.read_stage(terminal, time.monotonic() + 1, 1, prompt=FIXTURE.PROMPT_BYTES[0])
        self.assertEqual(terminal.writes, ["\x1b[1;1R"] * 8)

    def test_incremental_ninth_query_does_not_receive_a_reply(self):
        terminal = Terminal(b"", "\x1b[1;1R")
        terminal.chunks = [b"\x1b[6n"] * 9
        with self.assertRaisesRegex(FIXTURE.FixtureError, "^terminal_cursor_query_limit$"):
            FIXTURE.read_stage(terminal, time.monotonic() + 1, 1, prompt=FIXTURE.PROMPT_BYTES[0])
        self.assertEqual(terminal.writes, ["\x1b[1;1R"] * 8)

    def test_partial_cursor_reply_is_a_fixed_protocol_failure(self):
        terminal = Terminal(b"\x1b[6n", "unused")
        terminal.write = lambda text: 0
        with self.assertRaisesRegex(FIXTURE.FixtureError, "^terminal_cursor_reply_failed$"):
            FIXTURE.read_stage(terminal, time.monotonic() + 1, 1, prompt=FIXTURE.PROMPT_BYTES[0])

    def test_timeouts_report_no_transcript(self):
        for raw, suffix in ((b"", "no_bytes"), (b"\x1b[?25l", "control_only"),
                            (b"PRIVATE_TEXT", "other_output"),
                            (FIXTURE.PROMPT_BYTES[0] + b"\r\nPRIVATE_TEXT", "prompt_present")):
            with self.subTest(suffix=suffix):
                terminal = Terminal(raw, "unused")
                terminal.chunks = [chunk for chunk in terminal.chunks if chunk]
                with self.assertRaisesRegex(FIXTURE.FixtureError, f"^terminal_timeout_1_{suffix}$"):
                    FIXTURE.read_stage(terminal, time.monotonic() + 1, 1, prompt=FIXTURE.PROMPT_BYTES[0])


if __name__ == "__main__":
    unittest.main()
