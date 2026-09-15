"""Affected collector transport/persistence paths only; no remote calls."""
import base64
import contextlib
import copy
import datetime as dt
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('diagnostic_evidence', Path(__file__).with_name('funda-hybrid-evidence.py'))
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)


class EvidenceDiagnosticTests(unittest.TestCase):
    def failure(self):
        with patch.object(evidence._capture_diagnostics.subprocess, 'run', return_value=
                          subprocess.CompletedProcess([], 9, b'private rows', b'private database failure')):
            with self.assertRaises(evidence.CaptureFailure) as caught:
                evidence.run(['docker', 'private arguments'], timeout=12)
        return caught.exception

    def env(self, root):
        path = root / 'env'
        path.write_text('TOKEN=private-secret\n')
        return path

    def assert_private(self, root, public, prefix):
        paths = list(root.glob(prefix + '*.private.json'))
        self.assertEqual(len(paths), 1)
        data = paths[0].read_bytes()
        diagnostic = json.loads(data)
        self.assertEqual(diagnostic['returncode'], 9)
        self.assertEqual(base64.b64decode(diagnostic['stderr_tail_base64']), b'private database failure')
        self.assertLessEqual(len(data), 40 * 1024)
        self.assertEqual(paths[0].stat().st_mode & 0o777, 0o600)
        public_text = json.dumps(public)
        for forbidden in (evidence.PRIVATE_DIAGNOSTIC_KEY, 'stderr_tail_base64', 'private database failure', 'private rows', 'private-secret'):
            self.assertNotIn(forbidden, public_text)

    def test_nested_partial_capture_retains_first_failure_privately(self):
        failed = subprocess.CompletedProcess([], 9, b'private rows', b'private database failure')
        with patch.object(evidence._capture_diagnostics.subprocess, 'run', return_value=failed):
            remote = evidence.remote_capture('app', light=True)
        self.assertEqual(remote['status'], 'partial')
        self.assertEqual(remote[evidence.PRIVATE_DIAGNOSTIC_KEY]['stage'], 'remote_command')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(evidence, 'ssh_command', return_value=['unused']), \
                 patch.object(evidence._capture_diagnostics, 'capture_json', side_effect=[copy.deepcopy(remote), {'status': 'complete'}]) as transport:
                public, path = evidence.capture(self.env(root), root / 'out')
            self.assertEqual(public['status'], 'partial')
            self.assertEqual(json.loads(path.read_text()), public)
            self.assertEqual(transport.call_args.kwargs['timeout'], 45)
            self.assertIsNone(transport.call_args.kwargs['max_output_bytes'])
            self.assert_private(root / 'out', public, 'capture-failure-')

    def test_outer_failure_is_partial_and_keeps_private_diagnostic(self):
        failure = self.failure()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(evidence, 'ssh_command', return_value=['unused']), \
                 patch.object(evidence._capture_diagnostics, 'capture_json', side_effect=[failure, {'status': 'complete'}]):
                public, _ = evidence.capture(self.env(root), root / 'out')
            self.assertEqual(public['status'], 'partial')
            self.assert_private(root / 'out', public, 'capture-failure-')

    def test_nested_audit_unavailable_and_private_artifact(self):
        failed = subprocess.CompletedProcess([], 9, b'private rows', b'private database failure')
        start, end = '2026-09-13T00:00:00+00:00', '2026-09-14T00:00:00+00:00'
        with patch.object(evidence._capture_diagnostics.subprocess, 'run', return_value=failed):
            remote = evidence.remote_audit('scraper', start, end)
        self.assertEqual(remote['status'], 'unavailable')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(evidence, 'ssh_command', return_value=['unused']), \
                 patch.object(evidence._capture_diagnostics, 'capture_json', return_value=copy.deepcopy(remote)):
                public, path = evidence.audit_freshness(self.env(root), start, end, root / 'missing', root / 'out',
                    now=dt.datetime(2026, 9, 14, 2, tzinfo=dt.timezone.utc))
            self.assertFalse(public['passed'])
            self.assertEqual(json.loads(path.read_text()), public)
            self.assert_private(root / 'out', public, 'audit-failure-')

    def test_payload_embeds_shared_utility_without_remote_files(self):
        namespace = {'__name__': 'offline_remote_fixture', '__file__': '<stdin>'}
        exec(evidence.remote_script(), namespace)
        self.assertEqual(namespace['_capture_diagnostics'].DIAGNOSTIC_BYTES, 40 * 1024)
        with patch.object(namespace['_capture_diagnostics'].subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, b'a\r\nb\rc', b'')):
            self.assertEqual(namespace['run'](['unused']), 'a\nb\nc')

    def test_failure_artifact_survives_snapshot_budget_exhaustion(self):
        failure = self.failure()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def capture(*args, **kwargs):
                snapshot = {'status': 'partial', 'sample_kind': 'full', 'padding': 'x' * 50000}
                kwargs['_persist']('snapshot-failure.json', evidence.json_bytes(snapshot), snapshot, failure.diagnostic)
            output = io.StringIO()
            with patch.object(evidence, 'capture', side_effect=capture), contextlib.redirect_stdout(output):
                code = evidence.watch('unused', root, max_output_bytes=48 * 1024, duration_hours=0.05)
            self.assertEqual(code, 1)
            self.assertFalse((root / 'snapshot-failure.json').exists())
            self.assert_private(root, output.getvalue(), 'capture-failure-')
            records = [json.loads(line) for line in next(root.glob('watch-*.jsonl')).read_text().splitlines()]
            self.assertEqual(records[-1]['watch'], 'failed')
            self.assertLessEqual(sum(p.stat().st_size for p in root.iterdir()) + len(output.getvalue().encode()), 48 * 1024)

    def test_diagnostic_budget_failure_does_not_return_public_success(self):
        failure = self.failure()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(evidence, 'ssh_command', return_value=['unused']), \
                 patch.object(evidence._capture_diagnostics, 'capture_json', side_effect=failure):
                with self.assertRaises(evidence.OutputBudgetExceeded):
                    evidence.capture(self.env(root), root / 'out', max_output_bytes=100)
            self.assertFalse(list((root / 'out').glob('snapshot-*.json')))


if __name__ == '__main__':
    unittest.main()
