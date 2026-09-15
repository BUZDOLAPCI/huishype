import base64
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("capture_diagnostics", Path(__file__).with_name("capture_diagnostics.py"))
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


class CaptureDiagnosticsTests(unittest.TestCase):
    def run_result(self, result):
        with patch.object(capture.subprocess, "run", return_value=result) as run:
            value = capture.capture_json(["ssh", "private-host"], "private input", role="scraper")
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.kwargs["timeout"], 55)
            return value

    def test_success_preserves_json(self):
        self.assertEqual(self.run_result(subprocess.CompletedProcess([], 0, b'{"ok":true}', b"")), {"ok": True})

    def test_remote_error_retains_bounded_tail_without_input_or_stdout(self):
        stderr = bytes(range(256)) * 400 + b"diagnostic end"
        with self.assertRaises(capture.CaptureFailure) as caught:
            self.run_result(subprocess.CompletedProcess([], 7, b"private stdout", stderr))
        d = caught.exception.diagnostic
        self.assertEqual((d["category"], d["returncode"], d["role"]), ("remote_exit", 7, "scraper"))
        self.assertEqual(d["stderr_bytes"], len(stderr))
        self.assertTrue(d["stderr_truncated"])
        self.assertEqual(base64.b64decode(d["stderr_tail_base64"]), stderr[-capture.STDERR_TAIL_BYTES:])
        serialized = capture.diagnostic_bytes(d).decode()
        self.assertLessEqual(len(serialized.encode()), capture.DIAGNOSTIC_BYTES)
        self.assertNotIn("private stdout", serialized)
        self.assertNotIn("private input", serialized)
        self.assertNotIn("private-host", serialized)

    def test_timeout_preserves_partial_stderr_and_does_not_retry(self):
        with patch.object(capture.subprocess, "run", side_effect=subprocess.TimeoutExpired("hidden", 55, output=b"partial", stderr=b"timed out here")) as run:
            with self.assertRaises(capture.CaptureFailure) as caught:
                capture.capture_json(["ssh"], "private input", role="app")
        d = caught.exception.diagnostic
        self.assertEqual(run.call_count, 1)
        self.assertEqual(d["category"], "transport_timeout")
        self.assertTrue(d["output_is_partial"])
        self.assertIsNone(d["returncode"])
        self.assertEqual(base64.b64decode(d["stderr_tail_base64"]), b"timed out here")

    def test_output_boundary_remains_one_mib(self):
        raw = b'"' + b"a" * (1024**2 - 2) + b'"'
        self.assertEqual(len(self.run_result(subprocess.CompletedProcess([], 0, raw, b""))), 1024**2 - 2)
        with self.assertRaises(capture.CaptureFailure) as caught:
            self.run_result(subprocess.CompletedProcess([], 0, raw + b" ", b""))
        self.assertEqual(caught.exception.diagnostic["category"], "output_limit")

    def test_invalid_json_and_utf8_have_precise_categories(self):
        for raw, category in [(b'{"truncated":', "invalid_json"), (b'"\xff"', "invalid_utf8")]:
            with self.subTest(category=category), self.assertRaises(capture.CaptureFailure) as caught:
                self.run_result(subprocess.CompletedProcess([], 0, raw, b""))
            self.assertEqual(caught.exception.diagnostic["category"], category)

    def test_nested_command_failure_retains_private_stderr(self):
        result = subprocess.CompletedProcess([], 1, b"no retained rows", b"psql: statement timeout")
        with patch.object(capture.subprocess, "run", return_value=result) as run:
            with self.assertRaises(capture.CaptureFailure) as caught:
                capture.capture_text(["docker", "exec", "private-args"], role="scraper", timeout=12)
        d = caught.exception.diagnostic
        self.assertEqual(d["stage"], "remote_command")
        self.assertEqual(run.call_args.kwargs["timeout"], 12)
        self.assertEqual(base64.b64decode(d["stderr_tail_base64"]), b"psql: statement timeout")
        self.assertNotIn("private-args", capture.diagnostic_bytes(d).decode())

    def test_nested_success_matches_text_true_newlines(self):
        result = subprocess.CompletedProcess([], 0, b"a\r\nb\rc\n\xe2\x82\xac", b"")
        with patch.object(capture.subprocess, "run", return_value=result):
            self.assertEqual(capture.capture_text(["docker"], role="scraper"), "a\nb\nc\n\u20ac")

    def test_nested_envelope_fits_final_artifact_with_arbitrary_stderr_bytes(self):
        stderr = bytes(range(256)) * 400
        nested = capture._failure("remote_exit", "scraper", capture.time.monotonic(), 12,
                                  b"private rows", stderr, returncode=3, stage="remote_command").diagnostic
        wrapped = capture.REMOTE_MARKER + capture.diagnostic_bytes(nested)
        with self.assertRaises(capture.CaptureFailure) as caught:
            self.run_result(subprocess.CompletedProcess([], 1, b"", wrapped))
        d = caught.exception.diagnostic
        self.assertEqual(d["remote_failure"], nested)
        self.assertLessEqual(len(capture.diagnostic_bytes(d)), capture.DIAGNOSTIC_BYTES)
        self.assertEqual(d["stderr_bytes"], len(wrapped))


if __name__ == "__main__":
    unittest.main()
