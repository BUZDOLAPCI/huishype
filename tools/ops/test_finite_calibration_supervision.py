"""One synthetic handoff/stop check; no subprocess, source or provider access."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('supervision', Path(__file__).with_name('finite-calibration-supervision.py'))
supervision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervision)


class HandoffCheck(unittest.TestCase):
    def test_settlement_coverage_and_fail_closed_start(self):
        class Owner:
            def __init__(self, failure=None):
                self.controller_active = True
                self.old_watch_active = True
                self.successor_pass = False
                self.starts = 0
                self.failure = failure

            def stop_controller(self):
                # STOP is observed only after the fake in-flight step settles.
                self.settled = True
                self.controller_active = False

            def check_previous_exit(self):
                assert self.settled and not self.controller_active
                if self.failure == 'semantic_hold':
                    raise RuntimeError('controller_terminal_post_step_guard_failed')

            def start_watch(self):
                assert self.old_watch_active and not self.controller_active
                if self.failure == 'watch_failure':
                    raise RuntimeError('successor_watch_failed')
                self.successor_pass = True
                return 'new-watch'

            def stop_watch(self):
                assert self.successor_pass and not self.controller_active
                self.old_watch_active = False

            def adopt_watch(self, successor):
                assert successor == 'new-watch' and self.successor_pass

            def start_controller(self):
                assert not self.controller_active and not self.old_watch_active and self.successor_pass
                self.starts += 1
                self.controller_active = True

        clean = Owner()
        supervision.settled_handoff(clean)
        self.assertEqual(clean.starts, 1)
        for failure in ('semantic_hold', 'watch_failure'):
            held = Owner(failure)
            with self.assertRaises(RuntimeError):
                supervision.settled_handoff(held)
            self.assertEqual(held.starts, 0)
            self.assertFalse(held.controller_active)
            self.assertTrue(held.old_watch_active)


if __name__ == '__main__':
    unittest.main()
