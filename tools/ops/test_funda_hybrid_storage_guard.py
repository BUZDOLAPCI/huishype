"""Focused offline evidence storage and finite watcher tests; no SSH or services."""
import contextlib
import datetime as dt
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('storage_evidence', Path(__file__).with_name('funda-hybrid-evidence.py'))
evidence = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(evidence)


class StorageGuardTests(unittest.TestCase):
    def test_all_artifacts_and_pending_serialized_newline_count(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'logs').mkdir()
            (root / 'logs/prior.log').write_bytes(b'x' * 21)
            (root / 'other.bin').write_bytes(b'x' * 13)
            payload = evidence.json_bytes({'unicode': '🌷'})
            with evidence.OutputBudget(root, 34 + len(payload) - 1) as budget:
                with self.assertRaises(evidence.OutputBudgetExceeded):
                    budget.write('snapshot.json', payload)
            self.assertFalse((root / 'snapshot.json').exists())
            with evidence.OutputBudget(root, 34 + len(payload)) as budget:
                budget.write('snapshot.json', payload)
            self.assertEqual((root / 'snapshot.json').read_bytes(), payload)
            self.assertEqual((root / 'logs/prior.log').read_bytes(), b'x' * 21)
            self.assertEqual((root / 'snapshot.json').stat().st_mode & 0o777, 0o600)

    def test_pending_log_reserved_before_exclusive_snapshot_write(self):
        with tempfile.TemporaryDirectory() as directory:
            with evidence.OutputBudget(directory, 12) as budget:
                budget.write('watch.jsonl', b'existing')
                with self.assertRaises(evidence.OutputBudgetExceeded):
                    budget.write('snapshot.json', b'{}', journal='watch.jsonl', record=b'log')
            self.assertFalse((Path(directory) / 'snapshot.json').exists())
            self.assertEqual((Path(directory) / 'watch.jsonl').read_bytes(), b'existing')

    def test_log_ceiling_preserves_prior_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            with evidence.OutputBudget(directory, 1000) as budget:
                budget.write('watch.jsonl', b'12345')
                with patch.object(evidence, 'MAX_WATCH_LOG_BYTES', 8):
                    with self.assertRaises(evidence.WatchLogLimitExceeded):
                        budget.write('snapshot.json', b'{}', journal='watch.jsonl', record=b'1234')
            self.assertFalse((Path(directory) / 'snapshot.json').exists())
            self.assertEqual((Path(directory) / 'watch.jsonl').read_bytes(), b'12345')

    def test_existing_snapshot_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            with evidence.OutputBudget(directory) as budget:
                budget.write('snapshot.json', b'prior')
                with self.assertRaises(FileExistsError):
                    budget.write('snapshot.json', b'replacement')
            self.assertEqual((Path(directory) / 'snapshot.json').read_bytes(), b'prior')

    def test_symlink_file_directory_and_ancestor_rejected(self):
        for kind in ('file', 'directory', 'ancestor'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                external = root / 'external'
                external.mkdir()
                sentinel = external / 'sentinel'
                sentinel.write_bytes(b'unchanged')
                output = root / 'run'
                output.mkdir()
                if kind == 'ancestor':
                    (root / 'link').symlink_to(external, target_is_directory=True)
                    with self.assertRaises(OSError):
                        with evidence.OutputBudget(root / 'link/nested'):
                            self.fail('symlink accepted')
                    self.assertFalse((external / 'nested').exists())
                else:
                    (output / 'link').symlink_to(sentinel if kind == 'file' else external,
                                                target_is_directory=kind == 'directory')
                    with evidence.OutputBudget(output) as budget:
                        with self.assertRaises(ValueError):
                            budget.write('snapshot.json', b'{}')
                    self.assertFalse((output / 'snapshot.json').exists())
                self.assertEqual(sentinel.read_bytes(), b'unchanged')

    def test_error_record_is_not_appended_when_existing_directory_is_full(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            log = root / "stderr.log"
            log.write_bytes(b"prior")
            with log.open("a") as stream, contextlib.redirect_stderr(stream):
                code = evidence.main(["watch", "--output-dir", directory, "--max-output-bytes", "5"])
            self.assertEqual(code, 1)
            self.assertEqual(log.read_bytes(), b"prior")
            self.assertEqual(list(root.iterdir()), [log])

    def test_capture_budget_failure_preserves_existing_artifacts_and_hides_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = root / 'operator.log'
            old.write_bytes(b'prior')
            with self.assertRaises(evidence.OutputBudgetExceeded):
                evidence.capture(root / 'secret-missing-env', root, max_output_bytes=32)
            self.assertEqual(list(root.iterdir()), [old])
            result, path = evidence.capture(root / 'secret-missing-env', root)
            self.assertEqual(result['status'], 'partial')
            self.assertNotIn('secret-missing-env', path.read_text())


class BoundedWatchTests(unittest.TestCase):
    def run_watch(self, directory, duration=0.05, capture_cost=0, interval=60,
                  limit=evidence.DEFAULT_MAX_OUTPUT_BYTES, oversized_sample=None, interrupt=False):
        clock, samples = [0.0], []
        start = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
        def timestamp():
            return (start + dt.timedelta(seconds=clock[0])).isoformat()
        def capture(env, output, light=False, **kwargs):
            captured = timestamp()
            clock[0] += capture_cost
            body = {'status': 'complete', 'sample_kind': 'light' if light else 'full',
                    'captured_at': captured, 'completed_at': timestamp()}
            if len(samples) == oversized_sample:
                body['padding'] = 'secret sentinel' * 2000
            path = kwargs['_persist']('snapshot-' + str(len(samples)) + '.json', evidence.json_bytes(body), body)
            samples.append(body)
            return body, path
        def sleep(delay):
            if interrupt:
                raise KeyboardInterrupt
            clock[0] += delay
        output = io.StringIO()
        with patch.object(evidence.time, 'monotonic', side_effect=lambda: clock[0]), \
             patch.object(evidence.time, 'sleep', side_effect=sleep), \
             patch.object(evidence, 'utcnow', side_effect=timestamp), \
             patch.object(evidence, 'capture', side_effect=capture), contextlib.redirect_stdout(output):
            code = evidence.watch('unused', directory, interval=interval, duration_hours=duration,
                                  max_output_bytes=limit)
        return code, clock[0], samples, output.getvalue()

    def test_normal_minute_light_hourly_full_and_real_final_span(self):
        with tempfile.TemporaryDirectory() as directory:
            code, elapsed, samples, output = self.run_watch(directory, duration=1.1, capture_cost=2)
            self.assertEqual(code, 0)
            self.assertEqual([i for i, s in enumerate(samples) if s['sample_kind'] == 'full'], [0, 60, 67])
            span = evidence.timestamp(samples[-1]['captured_at']) - evidence.timestamp(samples[0]['completed_at'])
            self.assertAlmostEqual(span.total_seconds(), 1.1 * 3600)
            self.assertEqual(len(output.splitlines()), 2)
            journal = next(Path(directory).glob('watch-*.jsonl'))
            self.assertEqual(len(journal.read_text().splitlines()), len(samples) + 2)

    def test_default_and_max_duration_finite_including_final_capture(self):
        with tempfile.TemporaryDirectory() as directory:
            code, elapsed, samples, _ = self.run_watch(directory, duration=168, interval=3600, capture_cost=10)
            self.assertEqual(code, 0)
            self.assertLessEqual(elapsed, 168 * 3600)
            self.assertEqual(samples[0]['sample_kind'], 'full')
            self.assertEqual(samples[-1]['sample_kind'], 'full')
        with patch.object(evidence, 'watch', return_value=0) as watcher:
            self.assertEqual(evidence.main(['watch', '--output-dir', 'unused']), 0)
            self.assertEqual(watcher.call_args.args[3], 168)
            self.assertEqual(watcher.call_args.args[5], 2 * 1024 ** 3)

    def test_invalid_duration_and_budget_fail_before_capture(self):
        for duration in (None, 0, -1, 168.01, float('inf'), float('nan')):
            with self.subTest(duration=duration), patch.object(evidence, 'capture') as capture:
                with self.assertRaises(ValueError):
                    evidence.watch('unused', 'unused', duration_hours=duration)
                capture.assert_not_called()
        for limit in (0, -1, True, 1.5):
            with self.subTest(limit=limit), patch.object(evidence, 'capture') as capture:
                with self.assertRaises(ValueError):
                    evidence.watch('unused', 'unused', max_output_bytes=limit)
                capture.assert_not_called()

    def test_exhaustion_preserves_snapshots_and_bounds_error_log(self):
        with tempfile.TemporaryDirectory() as directory:
            code, _, samples, output = self.run_watch(directory, limit=6000, oversized_sample=1)
            self.assertEqual(code, 1)
            self.assertEqual(len(samples), 1)
            self.assertFalse((Path(directory) / 'snapshot-1.json').exists())
            self.assertEqual(json.loads((Path(directory) / 'snapshot-0.json').read_text()), samples[0])
            journal = next(Path(directory).glob('watch-*.jsonl'))
            records = [json.loads(line) for line in journal.read_text().splitlines()]
            self.assertEqual(records[-1]['error'], 'OutputBudgetExceeded')
            self.assertLessEqual(sum(f.stat().st_size for f in Path(directory).iterdir()) + len(output.encode()), 6000)
            self.assertNotIn('secret sentinel', output)
            self.assertEqual(len(output.splitlines()), 2)

    def test_interrupt_keeps_real_full_final_sample(self):
        with tempfile.TemporaryDirectory() as directory:
            code, _, samples, _ = self.run_watch(directory, capture_cost=1, interrupt=True)
            self.assertEqual(code, 130)
            self.assertEqual([s['sample_kind'] for s in samples], ['full', 'full'])
            self.assertGreater(samples[-1]['captured_at'], samples[0]['captured_at'])


if __name__ == '__main__':
    unittest.main()
