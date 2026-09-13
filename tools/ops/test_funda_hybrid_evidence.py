"""Offline security, SSH boundary, partial capture and verification tests."""
import contextlib
import datetime as dt
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("evidence", Path(__file__).with_name("funda-hybrid-evidence.py"))
evidence = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(evidence)
IMAGE = "sha256:" + "a" * 64
START = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)


def snapshot(minute=0, light=False):
    stamp = (START + dt.timedelta(minutes=minute)).isoformat()
    body = {"schema_version": 1, "sample_kind": "light" if light else "full",
            "status": "complete", "captured_at": stamp, "completed_at": stamp,
            "errors": [], "hosts": {}}
    for role, sources in [("app", ["app"]), ("scraper", ["funda", "pararius"])]:
        host = {"status": "complete", "captured_at": stamp, "completed_at": stamp,
                "errors": [], "containers": [], "databases": {}, "endpoints": {}}
        for source in sources:
            if not light:
                host["containers"].append({"service": source + ".api", "image_id": IMAGE, "running": True})
                host["databases"][source] = {"migration_heads": [source + "-head"]}
            host["endpoints"][source + ".health"] = {"ok": True, "status": "ok"}
            if source != "app":
                host["endpoints"][source + ".status"] = {"status": "ok", "inventory": {"status": "incomplete", "reason": "pending_inventory"}}
        body["hosts"][role] = host
    return body


class EvidenceTests(unittest.TestCase):
    def test_dotenv_never_executes_or_expands(self):
        parsed = evidence.parse_env('export APP_VM_PUBLIC_IP="192.0.2.1" # comment\nAPI_KEY=\'$(touch /tmp/not-created)\'\nBAD LINE\nVALUE=${HOME}\n')
        self.assertEqual(parsed["API_KEY"], "$(touch /tmp/not-created)")
        self.assertEqual(parsed["VALUE"], "${HOME}")
        self.assertEqual(parsed["APP_VM_PUBLIC_IP"], "192.0.2.1")

    def test_recursive_sanitization_removes_sensitive_keys_and_values(self):
        payload = {"inventory": {"password": "bad", "reason": "Bearer hidden https://host/?key=hidden", "detail": "known-value"},
                   "known-value": ["token=unexpected", {"API_KEY": "hidden"}]}
        result = evidence.sanitize(payload, ["known-value"])
        serialized = json.dumps(result)
        for secret in ["bad", "hidden", "unexpected", "known-value", "API_KEY"]:
            self.assertNotIn(secret, serialized)
        self.assertIn("inventory", result)

    def test_ssh_has_jump_and_strict_hosts_no_secrets(self):
        env = {"APP_VM_PUBLIC_IP": "192.0.2.1", "SCRAPER_VM_PUBLIC_IP": "192.0.2.2", "API_KEY": "invisible"}
        command = evidence.ssh_command(env, "scraper", True)
        self.assertIn("root@192.0.2.1", command)
        self.assertIn("StrictHostKeyChecking=yes", command)
        self.assertIn("ForwardAgent=no", command)
        self.assertNotIn("invisible", str(command))
        self.assertEqual(command[-1], "python3 - --remote scraper --light")
        env["SCRAPER_VM_SSH_USER"] = "root; touch /tmp/a"
        with self.assertRaises(ValueError):
            evidence.ssh_command(env, "scraper")

    def test_service_discovery_rejects_unrelated_projects(self):
        self.assertEqual(evidence.service_key("huishype-funda-scraper-probe-1", {}, "scraper"), "funda.probe")
        self.assertEqual(evidence.service_key("api-cop1e1822hijj6g3zmxhrs0k-123", {}, "app"), "app.api")
        self.assertIsNone(evidence.service_key("other-api-1", {"com.docker.compose.service": "api"}, "app"))
        for role in ["migrate", "planner", "ledger-migrate", "dispatcher", "ledger-postgres"]:
            self.assertEqual(evidence.service_key("huishype-funda-scraper-" + role + "-1", {}, "scraper"), "funda." + role)

    def test_partial_capture_persists_without_exception_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / "env"
            env.write_text("APP_VM_PUBLIC_IP=192.0.2.1\nSCRAPER_VM_PUBLIC_IP=192.0.2.2\nAPI_KEY=supersecret\n")
            with patch.object(evidence, "run", side_effect=[RuntimeError("supersecret"), snapshot()["hosts"]["scraper"]]):
                # Both malformed remote data and SSH failures must remain partial.
                result, path = evidence.capture(env, Path(directory) / "evidence")
            self.assertEqual(result["status"], "partial")
            self.assertNotIn("supersecret", path.read_text())
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with patch.object(evidence, "run", side_effect=RuntimeError("secret")):
                _, second_path = evidence.capture(env, path.parent)
            self.assertNotEqual(path, second_path)
            self.assertTrue(path.exists())

    def test_config_failure_also_persists_partial_file(self):
        with tempfile.TemporaryDirectory() as directory:
            result, path = evidence.capture(Path(directory) / "missing", directory)
            self.assertTrue(path.exists())
            self.assertEqual(result["errors"][0]["check"], "configuration")

    def test_remote_failure_is_sanitized_partial(self):
        with patch.object(evidence, "run", side_effect=RuntimeError("password-leak")):
            result = evidence.remote_capture("app")
        self.assertEqual(result["status"], "partial")
        self.assertNotIn("password-leak", json.dumps(result))

    def test_empty_container_inventory_is_partial(self):
        with patch.object(evidence, "run", return_value=""):
            result = evidence.remote_capture("app")
        self.assertEqual(result["status"], "partial")
        self.assertIn({"check": "containers", "kind": "NoExpectedContainers"}, result["errors"])

    def test_http_200_unhealthy_or_missing_status_is_partial(self):
        for status in ["degraded", None, "failed"]:
            with patch.object(evidence, "read_json_url", return_value={"status": status}), \
                 patch.object(Path, "read_text", return_value="API_KEY=secret\n"):
                result = evidence.remote_capture("scraper", light=True)
            self.assertEqual(result["status"], "partial")
            self.assertFalse(result["endpoints"]["funda.health"]["ok"])

    def test_release_accepts_only_successfully_completed_one_shots(self):
        body, manifest = snapshot(), self.manifest()
        manifest["completed_services"] = {"funda.ledger-migrate": IMAGE}
        job = {"service": "funda.ledger-migrate", "image_id": IMAGE, "running": False,
               "state": "exited", "exit_code": 0, "finished_at": START.isoformat()}
        body["hosts"]["scraper"]["containers"].append(job)
        self.assertTrue(evidence.verify_release(manifest, body)["passed"])
        for key, bad_value in [("exit_code", 1), ("running", True), ("state", "created"), ("finished_at", None)]:
            previous = job[key]
            job[key] = bad_value
            self.assertFalse(evidence.verify_release(manifest, body)["passed"])
            job[key] = previous

    def test_verification_rejects_http_success_with_degraded_body(self):
        body = snapshot()
        body["hosts"]["app"]["endpoints"]["app.health"] = {"ok": True, "status": "degraded"}
        self.assertFalse(evidence.verify_release(self.manifest(), body)["passed"])

    def test_light_scraper_has_no_docker_or_database_calls(self):
        with patch.object(evidence, "run", side_effect=AssertionError("must not run")) as command, \
             patch.object(evidence, "read_json_url", return_value={"status": "ok", "API_KEY": "hidden", "hybrid": {"planner": {"status": "ready"}}}), \
             patch.object(Path, "read_text", return_value="API_KEY=secret\n"):
            result = evidence.remote_capture("scraper", light=True)
        command.assert_not_called()
        self.assertEqual(result["status"], "complete")
        self.assertIn("hybrid", result["endpoints"]["funda.status"])
        self.assertNotIn("hidden", json.dumps(result))

    def manifest(self):
        return {"services": {source + ".api": IMAGE for source in ["app", "funda", "pararius"]},
                "migrations": {source: [source + "-head"] for source in ["app", "funda", "pararius"]}}

    def test_release_requires_exact_image_and_migration_heads(self):
        body, manifest = snapshot(), self.manifest()
        self.assertTrue(evidence.verify_release(manifest, body)["passed"])
        body["hosts"]["app"]["containers"][0]["image_id"] = "sha256:" + "b" * 64
        body["hosts"]["scraper"]["databases"]["funda"]["migration_heads"] = ["old"]
        result = evidence.verify_release(manifest, body)
        self.assertIn("app.api:running_image_mismatch", result["errors"])
        self.assertIn("funda:migration_mismatch", result["errors"])

    def test_release_rejects_duplicate_running_service(self):
        body = snapshot()
        body["hosts"]["app"]["containers"] *= 2
        self.assertFalse(evidence.verify_release(self.manifest(), body)["passed"])

    def test_release_rejects_empty_manifest_mutable_image_and_light(self):
        self.assertFalse(evidence.verify_release({}, snapshot())["passed"])
        manifest = self.manifest()
        manifest["services"]["app.api"] = "latest"
        self.assertFalse(evidence.verify_release(manifest, snapshot())["passed"])
        self.assertFalse(evidence.verify_release(self.manifest(), snapshot(light=True))["passed"])

    def test_window_requires_real_elapsed_24_hours_and_bounded_gaps(self):
        bodies = [snapshot(minute, light=minute not in (0, 1440)) for minute in range(0, 1441, 2)]
        result = evidence.verify_window(bodies)
        self.assertTrue(result["passed"], result["errors"])
        self.assertFalse(result["inventory_certified"])
        self.assertEqual(result["acceptance"], "insufficient_evidence")
        self.assertTrue(any("pending_inventory" in reason for reason in result["status_reason_counts"]))
        self.assertFalse(evidence.verify_window(bodies[:-1])["passed"])
        del bodies[10]
        self.assertIn("duplicate_or_excessive_snapshot_gap", evidence.verify_window(bodies)["errors"])

    def test_window_cannot_lower_24_hour_requirement(self):
        for hours in [0, 1, 23.9, float("nan")]:
            with self.assertRaises(ValueError):
                evidence.verify_window([], hours=hours)

    def test_window_rejects_fake_future_or_naive_timestamps(self):
        body = snapshot()
        self.assertFalse(evidence.verify_window([body], now=START - dt.timedelta(days=1))["passed"])
        body["captured_at"] = "2026-01-01T00:00:00"
        self.assertIn("0:invalid_timestamp", evidence.verify_window([body])["errors"])

    def test_window_rejects_partial_health_only_and_missing_full_end(self):
        bodies = [snapshot(minute, light=minute != 0) for minute in range(0, 1441, 2)]
        result = evidence.verify_window(bodies)
        self.assertIn("full_start_and_end_snapshots_required", result["errors"])
        bodies[-1] = snapshot(1440)
        bodies[5]["hosts"]["scraper"]["endpoints"].pop("funda.status")
        self.assertIn("5:funda:missing_status", evidence.verify_window(bodies)["errors"])

    def test_watch_uses_light_samples_then_final_full_and_real_time(self):
        clock = [0.0]
        kinds = []
        def fake_capture(env, output, light=False):
            kinds.append(light)
            return {"status": "complete", "sample_kind": "light" if light else "full"}, Path("sample.json")
        with patch.object(evidence.time, "monotonic", side_effect=lambda: clock[0]), \
             patch.object(evidence.time, "sleep", side_effect=lambda delay: clock.__setitem__(0, clock[0] + delay)), \
             patch.object(evidence, "capture", side_effect=fake_capture), contextlib.redirect_stdout(io.StringIO()):
            code = evidence.watch("env", "output", interval=60, duration_hours=0.05)
        self.assertEqual(code, 0)
        self.assertEqual(kinds, [False, True, True, False])
        self.assertEqual(clock[0], 180)

    def test_cli_invalid_json_returns_failure_without_body(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.json"
            path.write_text("secret invalid JSON")
            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                code = evidence.main(["verify-release", "--manifest", str(path), "--snapshot", str(path)])
            self.assertEqual(code, 1)
            self.assertNotIn("secret", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
