"""Fail-closed JSON capture with bounded, private transport diagnostics.

Callers must persist CaptureFailure.diagnostic with their existing output budget.
Never print the diagnostic: its base64 stderr tail can contain private data.
"""
import base64
import hashlib
import json
import subprocess
import time

STDERR_TAIL_BYTES = 24 * 1024
DIAGNOSTIC_BYTES = 40 * 1024
REMOTE_MARKER = b"HH_CAPTURE_DIAGNOSTIC\n"


class CaptureFailure(RuntimeError):
    def __init__(self, diagnostic):
        self.diagnostic = diagnostic
        super().__init__(diagnostic["category"])


def _bytes(value):
    return value.encode("utf-8") if isinstance(value, str) else value or b""


def diagnostic_bytes(diagnostic):
    payload = (json.dumps(diagnostic, ensure_ascii=True, indent=2) + "\n").encode()
    if len(payload) > DIAGNOSTIC_BYTES:
        raise ValueError("diagnostic_record_limit")
    return payload


def _failure(category, role, started, timeout, stdout=b"", stderr=b"",
             returncode=None, partial=False, **details):
    stdout, stderr = _bytes(stdout), _bytes(stderr)
    tail = stderr[-STDERR_TAIL_BYTES:]
    diagnostic = {
        "category": category, "role": role, "returncode": returncode,
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "timeout_seconds": timeout, "output_is_partial": partial,
        "stdout_bytes": len(stdout), "stdout_sha256": hashlib.sha256(stdout).hexdigest(),
        "stderr_bytes": len(stderr), "stderr_sha256": hashlib.sha256(stderr).hexdigest(),
        "stderr_tail_base64": base64.b64encode(tail).decode("ascii"),
        "stderr_retained_bytes": len(tail), "stderr_truncated": len(tail) < len(stderr),
        **details,
    }
    if details.get("stage") == "ssh_capture" and stderr.startswith(REMOTE_MARKER) and len(stderr) <= DIAGNOSTIC_BYTES + len(REMOTE_MARKER):
        try:
            nested = json.loads(stderr[len(REMOTE_MARKER):])
            if isinstance(nested, dict) and nested.get("stage") == "remote_command" and len(diagnostic_bytes(nested)) <= 34 * 1024:
                diagnostic.update(stderr_tail_base64="", stderr_retained_bytes=0,
                                  stderr_truncated=True, remote_failure=nested)
        except (ValueError, TypeError):
            pass  # Malformed envelopes remain bounded stderr, never successful captures.
    diagnostic_bytes(diagnostic)
    return CaptureFailure(diagnostic)


def _run(command, source, role, timeout, max_output_bytes, stage):
    if role not in {"app", "scraper"}:
        raise ValueError("unknown_capture_role")
    started = time.monotonic()
    try:
        result = subprocess.run(command, input=source.encode("utf-8") if source is not None else None,
                                capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise _failure("transport_timeout", role, started, timeout,
                       exc.stdout, exc.stderr, partial=True, stage=stage) from None
    except OSError as exc:
        raise _failure("transport_launch_error", role, started, timeout,
                       os_errno=exc.errno, stage=stage) from None
    stdout, stderr = result.stdout, result.stderr
    if result.returncode:
        raise _failure("remote_exit", role, started, timeout, stdout, stderr,
                       returncode=result.returncode, stage=stage)
    if max_output_bytes is not None and len(stdout) > max_output_bytes:
        raise _failure("output_limit", role, started, timeout, stdout, stderr,
                       returncode=result.returncode, max_output_bytes=max_output_bytes, stage=stage)
    return result, started


def capture_text(command, *, role, timeout=30):
    """Nested collector command; retain its existing timeout and output behavior."""
    result, started = _run(command, None, role, timeout, None, "remote_command")
    try:
        return result.stdout.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")
    except UnicodeDecodeError:
        raise _failure("invalid_utf8", role, started, timeout, result.stdout, result.stderr,
                       returncode=result.returncode, stage="remote_command") from None


def capture_json(command, source, *, role, timeout=55, max_output_bytes=1024**2):
    """Run once; preserve existing timeout/output bounds and never retry."""
    result, started = _run(command, source, role, timeout, max_output_bytes, "ssh_capture")
    stdout, stderr = result.stdout, result.stderr
    try:
        return json.loads(stdout.decode("utf-8"))
    except UnicodeDecodeError:
        raise _failure("invalid_utf8", role, started, timeout, stdout, stderr,
                       returncode=result.returncode, stage="ssh_capture") from None
    except json.JSONDecodeError as exc:
        raise _failure("invalid_json", role, started, timeout, stdout, stderr,
                       returncode=result.returncode, json_line=exc.lineno,
                       json_column=exc.colno, stage="ssh_capture") from None
