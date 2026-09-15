#!/usr/bin/env python3
"""Renew explicitly bound calibration observers without model-based polling.

This operator wrapper does not implement acquisition policy. The manifest pins
the existing watcher, capture, installer and max-one controller. Each child
retains its own finite duration, output budget and fail-closed predicates.

Run with an explicitly reviewed private manifest and its SHA256, and a new
0700 output directory: --manifest FILE --manifest-sha256 HASH --output-dir DIR.
Create DIR/STOP (or send SIGTERM) to stop admission after the owned current step
settles. Read hourly-summary.json/current.json on hourly operator check-ins;
terminal-alert.json means admission stopped and requires operator attention.
No model turn is needed between check-ins. A complete sizing result is held;
this tool never issues inventory authority or retries a failed handoff.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import traceback


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def read(path):
    return json.loads(Path(path).read_text())


def atomic(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + '.tmp')
    with temporary.open('w') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
    os.replace(temporary, path)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def owned_alive(process):
    try:
        command = Path('/proc', str(process['pid']), 'cmdline').read_bytes().split(b'\0')
    except FileNotFoundError:
        return False
    if command == [b'']:
        try:
            if Path('/proc', str(process['pid']), 'stat').read_text().rsplit(')', 1)[1].split()[0] == 'Z':
                return False
        except FileNotFoundError:
            return False
    if process['script'].encode() not in command:
        raise RuntimeError('owned_pid_command_changed')
    return True


def latest_guard(directory):
    """Only consume files whose completed write has been journaled."""
    journal = Path(directory, 'journal.jsonl')
    if not journal.exists():
        return None
    lines = journal.read_bytes().split(b'\n')[:-1]
    for line in reversed(lines):
        entry = json.loads(line)
        if entry['kind'] == 'guard':
            return Path(directory, str(entry['sequence']).zfill(4) + '-guard.json')
    return None


def settled_handoff(owner):
    """Keep old observation coverage while stopping and replacing admission."""
    owner.stop_controller()
    owner.check_previous_exit()
    successor = owner.start_watch()
    owner.stop_watch()
    owner.adopt_watch(successor)
    owner.start_controller()


class Supervisor:
    def __init__(self, manifest, output):
        self.manifest = manifest
        self.output = Path(output)
        self.controller = manifest['controller']
        self.watch = manifest['watch']
        self.cycle = 0
        self.guard_path = None
        self.last_hour = 0
        self.started = time.monotonic()
        self.end = self.started + manifest['duration_seconds']
        self.children = []

    def verify_files(self):
        for name, entry in self.manifest['files'].items():
            if Path(name).name != name or digest(entry['path']) != entry['sha256']:
                raise RuntimeError('reviewed_dependency_changed')
        if digest(self.manifest['source_authority']['path']) != self.manifest['source_authority']['sha256']:
            raise RuntimeError('source_authority_changed')

    def preserve_exception(self, exc, stage):
        # No locals, stdout, environment or command arguments are captured.
        raw = ''.join(traceback.TracebackException.from_exception(exc, capture_locals=False).format(chain=True)).encode('utf-8', errors='replace')
        tail = raw[-40 * 1024:]
        try:
            (self.output / ('exception-' + stage + '.private.log')).write_bytes(tail)
            atomic(self.output / ('exception-' + stage + '.private.json'), {'at': utc(), 'category': type(exc).__name__, 'original_bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'retained_bytes': len(tail), 'truncated': len(tail) < len(raw)})
        except OSError:
            pass  # Preserve the original exception and fail closed.

    def stop_process(self, process, seconds):
        for child in self.children:
            child.poll()
        if not owned_alive(process):
            return
        Path(process['directory'], 'STOP').write_text('finite supervision handoff ' + utc() + '\n')
        end = time.monotonic() + seconds
        while True:
            for child in self.children:
                child.poll()
            if not owned_alive(process):
                break
            if time.monotonic() >= end:
                raise RuntimeError('owned_stop_did_not_settle')
            time.sleep(1)

    def stop_controller(self):
        # Existing controller observes STOP between requests or during local wait.
        # Never signal/kill a paid subprocess or launch a competing controller.
        self.stop_process(self.controller, 420)

    def check_previous_exit(self):
        summaries = sorted(Path(self.controller['directory']).glob('*-summary.json'))
        if not summaries:
            raise RuntimeError('controller_summary_missing')
        summary = read(summaries[-1])
        if summary['completed'] or summary['reason'] == 'complete':
            raise RuntimeError('fresh_sizing_complete')
        if summary['reason'] not in ('operator_stop', 'finite_iteration_duration'):
            raise RuntimeError('controller_terminal_' + summary['reason'])
        if not summary.get('last_guard', {}).get('passed'):
            raise RuntimeError('last_settled_guard_failed')

    def stop_watch(self):
        self.stop_process(self.watch, 90)

    def watch_event(self, process):
        path = Path(process['directory'], 'events.jsonl')
        if not path.exists():
            return None
        lines = path.read_text().splitlines()
        # Writer appends a complete JSON line; tolerate only an unfinished last line.
        try:
            return json.loads(lines[-1]) if lines else None
        except json.JSONDecodeError:
            return json.loads(lines[-2]) if len(lines) > 1 else None

    def require_watch(self, process):
        event = self.watch_event(process)
        if not owned_alive(process) or not event or event.get('passed') is not True:
            raise RuntimeError('watch_not_passing')
        age = (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(event['at'])).total_seconds()
        if not 0 <= age <= 360:
            raise RuntimeError('watch_stale')

    def child(self, args, directory, log_name):
        stream = Path(directory, log_name).open('xb')
        try:
            child = subprocess.Popen(args, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        finally:
            stream.close()
        self.children.append(child)
        return child

    def start_watch(self):
        self.require_watch(self.watch)
        self.verify_files()
        self.cycle += 1
        if self.cycle > 44:
            raise RuntimeError('finite_renewal_count')
        directory = self.output / ('cycle-' + str(self.cycle).zfill(3))
        directory.mkdir(mode=0o700)
        for name, entry in self.manifest['files'].items():
            Path(directory, name).write_bytes(Path(entry['path']).read_bytes())
        installer = self.child(['python3', '-B', str(directory / 'install-normal-reader.py')], directory, 'reader-install.log')
        if installer.wait(timeout=45):
            raise RuntimeError('normal_reader_install_failed')
        script = directory / self.manifest['watch_script_name']
        spec = importlib.util.spec_from_file_location('bound_watch_' + str(self.cycle), script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        previous_path = Path(self.watch['directory'], self.watch_event(self.watch)['snapshot'])
        previous = read(previous_path)['snapshot']
        authority = read(self.manifest['source_authority']['path'])
        args = self.manifest['watch_args'][:]
        name = args[args.index('--calibration-container-name') + 1]
        config = args[args.index('--replacement-image-id') + 1]
        image = args[args.index('--replacement-manifest-id') + 1]
        with module.bounded.OutputBudget(directory / 'fresh-readiness', module.LIMIT) as budget:
            try:
                snapshot = module.capture()
                report = module.validate(snapshot, previous, name, config, image)
                module.validate_source_authority(snapshot, authority, name)
                payload = module.bounded.json_bytes({'snapshot': snapshot, 'maintenance': report})
                if len(payload) > 1024 ** 2:
                    raise RuntimeError('snapshot_record_limit')
                budget.write('snapshot.private.json', payload, reserve=module.FAILURE_RESERVE)
            except module.diag.CaptureFailure as exc:
                budget.write('capture-failure.private.json', module.diag.diagnostic_bytes(exc.diagnostic), reserve=4096)
                raise RuntimeError('fresh_capture_failed') from exc
        if not report['passed'] or not report['sizing_idle'] or report['diagnostic_cache_hold']:
            raise RuntimeError('fresh_readiness_failed')
        (directory / 'baseline.json').write_bytes(module.bounded.json_bytes(snapshot))
        watch_directory = directory / 'watch'
        args[2] = str(script)
        args[args.index('--baseline') + 1] = str(directory / 'baseline.json')
        args[args.index('--output-dir') + 1] = str(watch_directory)
        child = self.child(args, directory, 'watch-process.log')
        process = {'pid': child.pid, 'script': str(script), 'directory': str(watch_directory)}
        # Retain ownership immediately, even if first PASS fails.
        self.pending_watch = process
        end = time.monotonic() + 120
        while time.monotonic() < end:
            if child.poll() is not None:
                raise RuntimeError('successor_watch_exited')
            event = self.watch_event(process)
            if event and event.get('passed') is True:
                self.require_watch(process)
                atomic(directory / 'sizing-watch-binding.json', {'watch': str(watch_directory), 'pid': child.pid})
                return process
            if event and ('exit_code' in event or event.get('passed') is False):
                raise RuntimeError('successor_watch_failed')
            time.sleep(1)
        raise RuntimeError('successor_first_pass_timeout')

    def adopt_watch(self, successor):
        self.watch = successor
        self.pending_watch = None

    def start_controller(self):
        if (self.output / 'STOP').exists():
            raise RuntimeError('operator_stop')
        if time.monotonic() >= self.end:
            raise RuntimeError('overall_finite_duration')
        if owned_alive(self.controller):
            raise RuntimeError('previous_controller_still_running')
        self.require_watch(self.watch)
        directory = Path(self.watch['directory']).parent
        child = self.child(['python3', '-B', str(directory / 'iterate-with-pacing-successor.py')], directory, 'controller-process.log')
        self.controller = {'pid': child.pid, 'script': str(directory / 'iterate-with-pacing-successor.py'), 'directory': None}
        end = time.monotonic() + 90
        while time.monotonic() < end:
            paths = [p for p in directory.glob('paced-iteration-*') if p.is_dir()]
            if len(paths) == 1:
                self.controller['directory'] = str(paths[0])
                guard_path = latest_guard(paths[0])
                if guard_path:
                    if not read(guard_path)['passed']:
                        raise RuntimeError('new_controller_first_guard_failed')
                    self.renew_at = time.monotonic() + self.manifest['renew_after_seconds']
                    self.refresh_checkpoint(force=True)
                    return
            if child.poll() is not None:
                raise RuntimeError('new_controller_exited')
            time.sleep(1)
        raise RuntimeError('new_controller_first_guard_timeout')

    def refresh_checkpoint(self, force=False):
        if not self.controller.get('directory'):
            return
        guard_path = latest_guard(self.controller['directory'])
        if not guard_path or (str(guard_path) == self.guard_path and not force):
            return
        guard = read(guard_path)
        self.guard_path = str(guard_path)
        state = read(self.manifest['checkpoint'])
        state.update(observed_at=guard['at'], saved_guard=self.guard_path, credits=guard['credits'], search_health=guard['search_health'], work_counts=guard['allowed_work_counts'])
        state['supervision'].update(owner='deterministic_finite_supervisor', supervisor_pid=os.getpid(), supervisor_directory=str(self.output), controller_pid=self.controller['pid'], controller_session=None, controller_directory=self.controller['directory'], watch_pid=self.watch['pid'], watch_session=None, watch_directory=self.watch['directory'], watch_path=self.watch['directory'], state='finite_deterministic_supervision', controller_exited_at=None, watch_exited_at=None)
        started = dt.datetime.strptime(Path(self.controller['directory']).name, 'paced-iteration-%Y%m%dT%H%M%SZ').replace(tzinfo=dt.timezone.utc)
        state['supervision']['controller_deadline'] = (started + dt.timedelta(minutes=45)).isoformat()
        events = Path(self.watch['directory'], 'events.jsonl').read_text().splitlines()
        first = json.loads(events[0])
        event = self.watch_event(self.watch)
        if event and event.get('passed') is True:
            state['supervision'].update(last_watch_pass_at=event['at'], last_watch_snapshot=str(Path(self.watch['directory'], event['snapshot'])))
        state['supervision']['watch_deadline'] = (dt.datetime.fromisoformat(first['at']) + dt.timedelta(minutes=60)).isoformat()
        state['supervision']['next_settled_renewal'] = (started + dt.timedelta(seconds=self.manifest['renew_after_seconds'])).isoformat()
        state['live_progress'] = 'Deterministic bounded max-one acquisition; actual counts and health from saved guard. No inventory authority.'
        state['source_resource_checkpoint'] = {'observed_at': guard['at'], 'free_bytes': guard['host']['disk'], 'memory_available_bytes': guard['host']['memory'], 'margin_above_full_reserves_bytes': guard['reserve']['margin_above_required_bytes']}
        atomic(self.manifest['checkpoint'], state)
        atomic(self.output / 'current.json', {'at': utc(), 'controller': self.controller, 'watch': self.watch, 'saved_guard': self.guard_path, 'cycle': self.cycle})
        if not guard['passed']:
            raise RuntimeError('saved_guard_failed')

    def terminal(self, reason):
        cleanup = []
        try:
            if not self.controller.get('directory'):
                candidates = [p for p in Path(self.controller['script']).parent.glob('paced-iteration-*') if p.is_dir()]
                if len(candidates) == 1:
                    self.controller['directory'] = str(candidates[0])
            if self.controller.get('directory'):
                self.stop_controller()
                self.refresh_checkpoint(force=True)
        except Exception as exc:
            self.preserve_exception(exc, 'controller-cleanup')
            cleanup.append(type(exc).__name__ + ':' + str(exc))
        # Do not remove observation coverage while a paid controller may exist.
        try:
            if not owned_alive(self.controller):
                self.stop_watch()
                if getattr(self, 'pending_watch', None):
                    self.stop_process(self.pending_watch, 90)
        except Exception as exc:
            self.preserve_exception(exc, 'watch-cleanup')
            cleanup.append(type(exc).__name__ + ':' + str(exc))
        alert = {'at': utc(), 'reason': reason, 'cleanup_errors': cleanup, 'controller': self.controller, 'watch': self.watch, 'saved_guard': self.guard_path, 'provider_retry_issued': False, 'inventory_authority_issued': False}
        atomic(self.output / 'terminal-alert.json', alert)
        state = read(self.manifest['checkpoint'])
        state['supervision'].update(state='admission_stopped_' + reason, terminal_alert=str(self.output / 'terminal-alert.json'))
        atomic(self.manifest['checkpoint'], state)
        print(json.dumps(alert), flush=True)

    def run(self):
        reason = 'unknown'
        try:
            self.verify_files()
            settled_handoff(self)
            while time.monotonic() < self.end:
                for child in self.children:
                    child.poll()  # Reap exited owned children; avoid PID/zombie ambiguity.
                if (self.output / 'STOP').exists():
                    reason = 'operator_stop'
                    break
                self.require_watch(self.watch)
                self.refresh_checkpoint()
                if not owned_alive(self.controller):
                    self.check_previous_exit()
                    settled_handoff(self)
                elif time.monotonic() >= self.renew_at:
                    settled_handoff(self)
                if time.monotonic() - self.last_hour >= 3600:
                    atomic(self.output / 'hourly-summary.json', {'at': utc(), 'cycle': self.cycle, 'saved_guard': self.guard_path, 'controller': self.controller, 'watch': self.watch})
                    self.last_hour = time.monotonic()
                time.sleep(5)
            else:
                reason = 'overall_finite_duration'
        except Exception as exc:
            self.preserve_exception(exc, 'run')
            reason = str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__
        finally:
            self.terminal(reason)
        return 0 if reason in ('operator_stop', 'overall_finite_duration', 'fresh_sizing_complete') else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    if digest(args.manifest) != args.manifest_sha256:
        raise ValueError('manifest_hash_mismatch')
    manifest = read(args.manifest)
    if not manifest['reviewed'] or not manifest['execution_authorized']:
        raise ValueError('unreviewed_execution')
    if not 0 < manifest['duration_seconds'] <= 86400 or manifest['renew_after_seconds'] != 2100:
        raise ValueError('finite_bounds_required')
    args.output_dir.mkdir(mode=0o700)
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: (args.output_dir / 'STOP').write_text('operator signal ' + utc() + '\n'))
    # One run/account lock shared across all invocations of this operator tool.
    lock = Path(manifest['lock_path']).open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    atomic(args.output_dir / 'manifest.private.json', manifest)
    atomic(args.output_dir / 'started.json', {'at': utc(), 'pid': os.getpid(), 'duration_seconds': manifest['duration_seconds'], 'manifest_sha256': args.manifest_sha256})
    return Supervisor(manifest, args.output_dir).run()


if __name__ == '__main__':
    raise SystemExit(main())
