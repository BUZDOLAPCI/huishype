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


def queue_values():
    return {name: {"count": 2, "oldest_age_seconds": 12.5} for name in evidence.APP_QUEUE_METRICS}


def source_values():
    return {
        "delivery": {
            "oldestPendingAcquisitionObservedAt": None, "oldestPendingAcquisitionAgeSeconds": None,
            "oldestPendingEventRecordedAt": START.isoformat(), "oldestPendingEventAgeSeconds": 5.5,
            "oldestPendingBatchCreatedAt": None, "oldestPendingBatchAgeSeconds": None,
            "maximumAcquisitionReceiptLatencySeconds24h": 20.5, "completedAcquisitionRecordCount24h": 4,
            "writerGeneration": 1, "deliveredSequence": 30,
        },
        "mandatoryRequests": {"pendingCount": 0, "oldestCreatedAt": None, "oldestAgeSeconds": None,
                              "earliestDeadline": None, "maximumOverdueSeconds": None},
        "nationalInventory": {
            "catalogVersion": "catalog-v1", "catalogCoverageVerified": False, "activePartitionCount": 4,
            "verifiedCompletePartitions24h": 0, "latestComponentCompletedAt": None, "oldestComponentCompletedAt": None,
            "latestCertificateId": None, "latestCertificateCompletedAt": None, "certificatePartitionCount": 0,
        },
        "core": {"canonicalListingCount": 100, "eligibleListingCount": 90, "confirmedWithin24HoursCount": 60,
                 "expiredHistoricalCount": 10, "eligibleConditionalCount": 20},
    }


def publication_values(empty=False):
    return {"scope": "publication_minute_buckets", "interval_start": START.isoformat(),
            "interval_end": (START + dt.timedelta(days=1)).isoformat(),
            "publication_count": 0 if empty else 2, "total_latency_ms": 0 if empty else 600000,
            "max_latency_ms": None if empty else 500000, "bucket_count": 0 if empty else 2,
            "bucket_start_min": None if empty else START.isoformat(),
            "bucket_start_max": None if empty else (START + dt.timedelta(hours=23, minutes=59)).isoformat()}


def completion_values(empty=False):
    return {"scope": "source_acquisition_receipts", "interval_start": START.isoformat(),
            "interval_end": (START + dt.timedelta(days=1)).isoformat(), "completion_count": 0 if empty else 10,
            "minimum_latency_seconds": None if empty else 1, "maximum_latency_seconds": None if empty else 400,
            "writer_generations": [] if empty else [1]}


def audit_samples():
    bodies = [snapshot(minute, light=minute not in (0, 1440)) for minute in range(0, 1441, 2)]
    for body in bodies:
        body["hosts"]["scraper"]["endpoints"]["funda.status"]["recovery"] = {"evidence": source_values()}
        body["hosts"]["app"]["metrics"] = {"app_queues": {"status": "available", "values": queue_values()}}
    return bodies


class EvidenceTests(unittest.TestCase):
    def test_publication_aggregate_validates_shape_and_is_optional_for_legacy(self):
        for empty in [False, True]:
            values = publication_values(empty)
            with patch.object(evidence, "run", return_value=json.dumps(values)) as command:
                result = evidence.app_publication_telemetry({"Id": "app-db"})
            self.assertEqual(result["status"], "available")
            command.assert_called_once()
            sql = command.call_args.args[0][-1]
            self.assertIn("bucket_start >= lower_bound AND bucket_start < upper_bound", sql)
            self.assertIn("date_trunc('minute', now()) - interval '24 hours'", sql)
            self.assertIn("sum(total_latency_ms)", sql)
            self.assertIn("max(max_latency_ms)", sql)
        with patch.object(evidence, "run", side_effect=RuntimeError("secret-schema-detail")):
            self.assertEqual(evidence.app_publication_telemetry({"Id": "app-db"}),
                             {"status": "unavailable", "reason": "RuntimeError"})
        values = publication_values()
        values["max_latency_ms"] = None
        self.assertFalse(evidence.valid_publications(values))

    def test_required_publication_metrics_fail_missing_or_malformed(self):
        body, manifest = snapshot(), self.manifest()
        manifest["required_metrics"] = ["app.publications"]
        self.assertIn("app.publications:required_metric_unavailable", evidence.verify_release(manifest, body)["errors"])
        body["hosts"]["app"]["metrics"] = {"app_publications": {"status": "available", "values": publication_values()}}
        self.assertTrue(evidence.verify_release(manifest, body)["passed"])
        body["hosts"]["app"]["metrics"]["app_publications"]["values"]["publication_count"] = True
        self.assertFalse(evidence.verify_release(manifest, body)["passed"])

    def test_audit_interval_rejects_future_unaligned_short_or_non_utc_bounds(self):
        end = START + dt.timedelta(days=1)
        self.assertEqual(evidence.audit_interval(START.isoformat(), end.isoformat(), now=end),
                         ("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"))
        for start, finish in [
            (START.isoformat(), (end - dt.timedelta(minutes=1)).isoformat()),
            ((START + dt.timedelta(seconds=1)).isoformat(), end.isoformat()),
            (START.isoformat(), (end + dt.timedelta(minutes=1)).isoformat()),
            ("2026-01-01T01:00:00+01:00", end.isoformat()),
            ("2026-01-01T00:00:00", end.isoformat()),
            ("2026-01-01T00:00:00Z'; DROP TABLE source_evidence_events;--", end.isoformat()),
        ]:
            with self.assertRaises(ValueError):
                evidence.audit_interval(start, finish, now=end)

    def test_explicit_verify_window_requires_paired_valid_completed_minute_bounds(self):
        now = START + dt.timedelta(days=2)
        end = START + dt.timedelta(days=1)
        for start, finish in [
            (START.isoformat(), None), (None, end.isoformat()),
            (START.isoformat(), (now + dt.timedelta(minutes=1)).isoformat()),
            ((START + dt.timedelta(seconds=1)).isoformat(), (end + dt.timedelta(minutes=1)).isoformat()),
            (START.isoformat(), (end - dt.timedelta(minutes=1)).isoformat()),
        ]:
            with self.assertRaises(ValueError):
                evidence.verify_window([], start=start, end=finish, now=now)
        for option, value in [("--start", START.isoformat()), ("--end", end.isoformat())]:
            with contextlib.redirect_stderr(io.StringIO()):
                code = evidence.main(["verify-window", "--directory", "/nonexistent-test-snapshots", option, value])
            self.assertEqual(code, 1)

    def test_explicit_verify_window_reports_exact_longer_interval_and_separate_brackets(self):
        bodies = []
        for minute in range(-10, 1513, 2):
            body = snapshot(minute, light=minute not in (-10, 0, 1502, 1512))
            body["hosts"]["app"]["metrics"] = {"app_queues": {"status": "available", "values": queue_values()}}
            body["hosts"]["scraper"]["endpoints"]["funda.status"]["recovery"] = {"evidence": source_values()}
            if minute in (-10, 1512):
                body["hosts"]["app"]["containers"][0]["image_id"] = "different-release-outside-brackets"
                body["status"] = "partial"
            bodies.append(body)
        start, end = START + dt.timedelta(minutes=1), START + dt.timedelta(minutes=1501)
        result = evidence.verify_window(bodies, start=start.isoformat(), end=end.isoformat(), manifest=self.manifest())
        self.assertTrue(result["passed"], result["errors"])
        self.assertEqual(result["interval_start"], "2026-01-01T00:01:00Z")
        self.assertEqual(result["interval_end"], "2026-01-02T01:01:00Z")
        self.assertEqual(result["measured_interval_hours"], 25)
        self.assertEqual(result["measured_interval_seconds"], 90000)
        self.assertGreater(result["coverage"]["elapsed_hours"], 25)
        brackets = result["coverage"]["full_snapshot_brackets"]
        self.assertLess(evidence.timestamp(brackets["start_completed_at"]), start)
        self.assertGreater(evidence.timestamp(brackets["end_captured_at"]), end)

    def test_explicit_verify_window_honors_custom_maximum_gap(self):
        bodies = audit_samples()
        del bodies[360]
        kwargs = {"start": START.isoformat(), "end": (START + dt.timedelta(days=1)).isoformat()}
        self.assertIn("duplicate_or_excessive_snapshot_gap", evidence.verify_window(bodies, **kwargs)["errors"])
        result = evidence.verify_window(bodies, max_gap_minutes=4, **kwargs)
        self.assertTrue(result["passed"], result["errors"])
        self.assertEqual(result["coverage"]["largest_gap_minutes"], 4)

    def test_source_audit_query_uses_retained_acquisition_receipts_only(self):
        query = evidence.source_completion_sql(START.isoformat(), (START + dt.timedelta(days=1)).isoformat())
        for fragment in ["e.purpose='acquisition'", "b.state='delivered'", "b.writer_generation=e.writer_generation",
                         "e.sequence>b.cursor_start", "e.sequence<=b.cursor_end", "b.delivered_at>=TIMESTAMPTZ",
                         "b.delivered_at<TIMESTAMPTZ", "min(extract(epoch FROM b.delivered_at-e.observed_at))"]:
            self.assertIn(fragment, query)
        self.assertNotIn("greatest", query.lower())

    def test_freshness_audit_gates_completed_and_pending_bounds(self):
        start, end = START.isoformat(), (START + dt.timedelta(days=1)).isoformat()
        window = evidence.audit_sample_window(audit_samples(), start, end)
        source, app = {"status": "available", "values": completion_values()}, {"status": "available", "values": publication_values()}
        result = evidence.freshness_result(source, app, window, start, end)
        self.assertTrue(result["passed"], result["errors"])
        self.assertEqual(result["measured_completed_upper_bound_seconds"], 900)
        self.assertFalse(result["inventory_certified"])
        self.assertFalse(result["budget_certified"])
        app["values"]["max_latency_ms"] += 1
        self.assertIn("completed_latency_upper_bound_exceeded", evidence.freshness_result(source, app, window, start, end)["errors"])
        app["values"]["max_latency_ms"] -= 1
        for key, age, expected in [
            ("maximum_pending_acquisition_age_seconds", 901, "pending_acquisition:latency_upper_bound_exceeded"),
            ("maximum_pending_property_age_seconds", 501, "maximum_pending_property_age_seconds:latency_upper_bound_exceeded"),
            ("maximum_pending_tile_age_seconds", 501, "maximum_pending_tile_age_seconds:latency_upper_bound_exceeded"),
        ]:
            mutated = {**window, key: age}
            self.assertIn(expected, evidence.freshness_result(source, app, mutated, start, end)["errors"])

    def test_freshness_audit_rejects_empty_history_negative_provenance_and_generation_changes(self):
        start, end = START.isoformat(), (START + dt.timedelta(days=1)).isoformat()
        window = evidence.audit_sample_window(audit_samples(), start, end)
        source, app = {"status": "available", "values": completion_values()}, {"status": "available", "values": publication_values()}
        empty_source = {"status": "available", "values": completion_values(True)}
        self.assertIn("source:no_actual_completions", evidence.freshness_result(empty_source, app, window, start, end)["errors"])
        empty_app = {"status": "available", "values": publication_values(True)}
        self.assertIn("app:no_actual_completions", evidence.freshness_result(source, empty_app, window, start, end)["errors"])
        source["values"]["minimum_latency_seconds"] = -1
        self.assertIn("source:negative_latency_invalid_provenance", evidence.freshness_result(source, app, window, start, end)["errors"])
        source["values"]["minimum_latency_seconds"] = 1
        source["values"]["writer_generations"] = [1, 2]
        self.assertIn("source:completion_writer_generation_mismatch", evidence.freshness_result(source, app, window, start, end)["errors"])

    def test_freshness_audit_rejects_other_intervals_and_exclusive_end_buckets(self):
        start, end = START.isoformat(), (START + dt.timedelta(days=1)).isoformat()
        window = evidence.audit_sample_window(audit_samples(), start, end)
        source, app = {"status": "available", "values": completion_values()}, {"status": "available", "values": publication_values()}
        source["values"]["interval_start"] = (START - dt.timedelta(minutes=1)).isoformat()
        self.assertIn("source:completion_interval_mismatch", evidence.freshness_result(source, app, window, start, end)["errors"])
        app["values"]["bucket_start_max"] = end
        self.assertFalse(evidence.valid_publications(app["values"]))

    def test_audit_pending_samples_require_brackets_coverage_and_every_metric(self):
        start, end = START.isoformat(), (START + dt.timedelta(days=1)).isoformat()
        bodies = audit_samples()
        del bodies[360]["hosts"]["app"]["metrics"]["app_queues"]["values"]["dirty_tile_updates"]
        self.assertIn("360:app.queues:required_metric_unavailable", evidence.audit_sample_window(bodies, start, end)["errors"])
        bodies = audit_samples()
        del bodies[360]
        self.assertIn("duplicate_or_excessive_snapshot_gap", evidence.audit_sample_window(bodies, start, end)["errors"])
        bodies = audit_samples()
        self.assertIn("full_snapshots_must_bracket_audit_interval", evidence.audit_sample_window(bodies[1:], start, end)["errors"])

    def test_remote_audit_discovers_database_and_projects_numeric_fields(self):
        container = {"Id": "funda-db", "Name": "/huishype-funda-scraper-postgres-1", "Config": {"Labels": {}}, "State": {"Running": True}}
        values = completion_values()
        values["payload"] = "private-address"
        with patch.object(evidence, "run", side_effect=["funda-db", json.dumps([container]), json.dumps(values)]) as command:
            result = evidence.remote_audit("scraper", START.isoformat(), (START + dt.timedelta(days=1)).isoformat())
        self.assertEqual(result["status"], "available")
        self.assertNotIn("private-address", json.dumps(result))
        self.assertIn("PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000", command.call_args.args[0])

    def test_failed_audit_persists_private_sanitized_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / "env"
            env.write_text("APP_VM_PUBLIC_IP=192.0.2.1\nSCRAPER_VM_PUBLIC_IP=192.0.2.2\nAPI_KEY=supersecret\n")
            with patch.object(evidence, "run", side_effect=RuntimeError("supersecret")):
                result, path = evidence.audit_freshness(env, START.isoformat(), (START + dt.timedelta(days=1)).isoformat(),
                                                       directory, Path(directory) / "audits")
            self.assertFalse(result["passed"])
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertNotIn("supersecret", path.read_text())
            self.assertEqual(json.loads(path.read_text())["interval_start"], "2026-01-01T00:00:00Z")

    def test_source_evidence_completeness_accepts_false_coverage_and_empty_queues(self):
        self.assertTrue(evidence.valid_source_evidence(source_values()))
        value = source_values()
        value["nationalInventory"]["catalogVersion"] = None
        value["delivery"]["maximumAcquisitionReceiptLatencySeconds24h"] = None
        value["delivery"]["completedAcquisitionRecordCount24h"] = 0
        value["mandatoryRequests"] = {"pendingCount": 1, "oldestCreatedAt": START.isoformat(), "oldestAgeSeconds": 0,
                                     "earliestDeadline": START.isoformat(), "maximumOverdueSeconds": 0}
        self.assertTrue(evidence.valid_source_evidence(value))

    def test_source_evidence_requires_each_field_and_correct_types(self):
        for section, fields in source_values().items():
            for field in fields:
                value = source_values()
                del value[section][field]
                self.assertFalse(evidence.valid_source_evidence(value), section + "." + field)
        for section, field, bad in [
            ("delivery", "writerGeneration", True), ("delivery", "deliveredSequence", -1),
            ("delivery", "completedAcquisitionRecordCount24h", 0),
            ("delivery", "maximumAcquisitionReceiptLatencySeconds24h", None),
            ("delivery", "oldestPendingEventAgeSeconds", None), ("delivery", "oldestPendingEventAgeSeconds", float("inf")),
            ("delivery", "oldestPendingEventRecordedAt", "not-a-time"),
            ("delivery", "oldestPendingEventRecordedAt", "2026-01-01T00:00:00"),
            ("nationalInventory", "catalogCoverageVerified", 0), ("nationalInventory", "activePartitionCount", 1.5),
            ("nationalInventory", "latestCertificateId", 123), ("core", "eligibleListingCount", "12"),
            ("mandatoryRequests", "pendingCount", 1),
        ]:
            value = source_values()
            value[section][field] = bad
            self.assertFalse(evidence.valid_source_evidence(value), (section, field, bad))

    def test_window_requires_source_evidence_in_intermediate_light_samples(self):
        bodies = [snapshot(minute, light=minute not in (0, 1440)) for minute in range(0, 1441, 2)]
        for body in bodies:
            body["hosts"]["scraper"]["endpoints"]["funda.status"]["recovery"] = {"evidence": source_values()}
        manifest = self.manifest()
        manifest["required_metrics"] = ["funda.evidence"]
        result = evidence.verify_window(bodies, manifest=manifest)
        self.assertTrue(result["passed"], result["errors"])
        del bodies[360]["hosts"]["scraper"]["endpoints"]["funda.status"]["recovery"]["evidence"]["core"]["eligibleListingCount"]
        result = evidence.verify_window(bodies, manifest=manifest)
        self.assertFalse(result["passed"])
        self.assertIn("360:funda.evidence:required_metric_unavailable", result["errors"])

    def test_app_queue_query_is_one_bounded_readonly_numeric_aggregate(self):
        values = queue_values()
        values["dirty_tile_errors"] = {"count": 0, "oldest_age_seconds": None, "last_error": "private-detail"}
        values["listing_rows"] = ["private-address"]
        with patch.object(evidence, "run", return_value=json.dumps(values)) as run:
            result = evidence.app_queue_telemetry({"Id": "postgres-id"})
        run.assert_called_once()
        args, kwargs = run.call_args
        self.assertIn("PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000", args[0])
        self.assertEqual(kwargs["timeout"], 8)
        self.assertEqual(result["status"], "available")
        self.assertEqual(result["values"]["dirty_tile_errors"], {"count": 0, "oldest_age_seconds": None})
        self.assertEqual(result["values"]["pending_price_repairs"]["count"], 2)
        self.assertNotIn("private", json.dumps(result))

    def test_app_queue_unavailable_or_malformed_response_has_no_error_body(self):
        with patch.object(evidence, "run", side_effect=RuntimeError("private SQL detail")):
            result = evidence.app_queue_telemetry({"Id": "postgres-id"})
        self.assertEqual(result, {"status": "unavailable", "reason": "RuntimeError"})
        for invalid in [{}, {**queue_values(), "dirty_tile_errors": {"count": -1, "oldest_age_seconds": 0}}]:
            with patch.object(evidence, "run", return_value=json.dumps(invalid)):
                self.assertEqual(evidence.app_queue_telemetry({"Id": "postgres-id"})["status"], "unavailable")

    def test_light_app_samples_query_queues_without_migration_queries(self):
        containers = [{"Id": service, "Name": "/" + service + "-cop1e1822hijj6g3zmxhrs0k", "Image": IMAGE,
                       "Config": {"Labels": {}}, "State": {"Running": True},
                       "NetworkSettings": {"Networks": {"app": {"IPAddress": "192.0.2.10"}}}}
                      for service in ["api", "postgres"]]
        for available in [True, False]:
            requests = []
            def command(args, **kwargs):
                if args[:3] == ["docker", "ps", "-aq"]:
                    self.assertIn("name=postgres-cop1e1822hijj6g3zmxhrs0k", args)
                    return "api postgres"
                if args[:2] == ["docker", "inspect"]:
                    return json.dumps(containers)
                requests.append(args)
                if "listing_tile_publication_metrics" in args[-1]:
                    if not available:
                        raise RuntimeError("legacy missing publication table")
                    return json.dumps(publication_values())
                self.assertIn("price_evidence_repair_queue", args[-1])
                self.assertNotIn("drizzle", args[-1])
                if not available:
                    raise RuntimeError("legacy missing tables")
                return json.dumps(queue_values())
            with patch.object(evidence, "run", side_effect=command), \
                 patch.object(evidence, "read_json_url", return_value={"status": "ok"}):
                result = evidence.remote_capture("app", light=True)
            self.assertEqual(len(requests), 2)
            self.assertEqual(result["status"], "complete", result["errors"])
            self.assertEqual(result["metrics"]["app_queues"]["status"], "available" if available else "unavailable")
            self.assertEqual(result["metrics"]["app_publications"]["status"], "available" if available else "unavailable")
            self.assertNotIn("legacy missing tables", json.dumps(result))

    def test_release_required_app_queue_metrics_fail_missing_evidence(self):
        body, manifest = snapshot(), self.manifest()
        self.assertTrue(evidence.verify_release(manifest, body)["passed"])
        manifest["required_metrics"] = ["app.queues"]
        self.assertIn("app.queues:required_metric_unavailable", evidence.verify_release(manifest, body)["errors"])
        body["hosts"]["app"]["metrics"] = {"app_queues": {"status": "available", "values": queue_values()}}
        self.assertTrue(evidence.verify_release(manifest, body)["passed"])
        body["hosts"]["app"]["metrics"]["app_queues"]["status"] = "unavailable"
        self.assertFalse(evidence.verify_release(manifest, body)["passed"])
        body["hosts"]["app"]["metrics"]["app_queues"] = {
            "status": "available", "values": {"dirty_tile_updates": {"count": 0, "oldest_age_seconds": None}}}
        self.assertFalse(evidence.verify_release(manifest, body)["passed"])
        manifest["required_metrics"] = ["app.queues.dirty_tile_updates"]
        self.assertTrue(evidence.verify_release(manifest, body)["passed"])
        manifest["required_metrics"] = ["app.queues.misspelled"]
        self.assertIn("manifest:unknown_required_metric", evidence.verify_release(manifest, body)["errors"])

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

    def test_image_commit_prefers_oci_revision_then_full_commit_tag(self):
        commit, other = "a" * 40, "b" * 40
        self.assertEqual(evidence.image_commit({}, "uuid_api:" + commit), commit)
        self.assertEqual(evidence.image_commit({}, "registry:5000/project/api:" + commit.upper()), commit)
        self.assertEqual(evidence.image_commit({"org.opencontainers.image.revision": other}, "uuid_api:" + commit), other)
        for reference in ["api:latest", "api:abcdef0", "api@sha256:" + "a" * 64, "api:" + commit + "@sha256:" + "a" * 64, None]:
            self.assertIsNone(evidence.image_commit({}, reference))

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
        status = {"status": "ok", "API_KEY": "hidden", "hybrid": {"planner": {"status": "ready"}},
                  "recovery": {"catalog": {"remaining": 123}, "planner": {"status": "ready"}, "outbox": {"pending": 4}},
                  "upstream": {"creditDispatcher": {"availableCredits": 150, "API_KEY": "hidden"}}}
        with patch.object(evidence, "run", side_effect=AssertionError("must not run")) as command, \
             patch.object(evidence, "read_json_url", return_value=status), \
             patch.object(Path, "read_text", return_value="API_KEY=secret\n"):
            result = evidence.remote_capture("scraper", light=True)
        command.assert_not_called()
        self.assertEqual(result["status"], "complete")
        self.assertIn("hybrid", result["endpoints"]["funda.status"])
        self.assertEqual(result["endpoints"]["funda.status"]["recovery"], status["recovery"])
        self.assertEqual(result["endpoints"]["funda.status"]["upstream"]["creditDispatcher"], {"availableCredits": 150})
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

    def test_release_rejects_legacy_scheduler_running_alongside_declared_planner(self):
        body, manifest = snapshot(), self.manifest()
        manifest["services"]["funda.planner"] = IMAGE
        body["hosts"]["scraper"]["containers"].extend([
            {"service": "funda.planner", "image_id": IMAGE, "running": True},
            {"service": "funda.scheduler", "image_id": IMAGE, "running": True},
        ])
        result = evidence.verify_release(manifest, body)
        self.assertFalse(result["passed"])
        self.assertIn("funda.scheduler:undeclared_running_service", result["errors"])
        manifest["services"]["funda.scheduler"] = IMAGE
        self.assertTrue(evidence.verify_release(manifest, body)["passed"])

    def test_release_ignores_undeclared_stopped_legacy_service(self):
        body = snapshot()
        body["hosts"]["scraper"]["containers"].append({"service": "funda.scheduler", "image_id": IMAGE, "running": False})
        self.assertTrue(evidence.verify_release(self.manifest(), body)["passed"])

    def test_release_checks_running_and_completed_code_revisions(self):
        body, manifest = snapshot(), self.manifest()
        commit = "a" * 40
        manifest["completed_services"] = {"funda.migrate": IMAGE}
        job = {"service": "funda.migrate", "image_id": IMAGE, "running": False,
               "state": "exited", "exit_code": 0, "finished_at": START.isoformat(), "commit": commit}
        body["hosts"]["scraper"]["containers"].append(job)
        body["hosts"]["app"]["containers"][0]["commit"] = commit
        manifest["code_revisions"] = {"app.api": commit, "funda.migrate": commit}
        self.assertTrue(evidence.verify_release(manifest, body)["passed"])
        for service in ["app.api", "funda.migrate"]:
            manifest["code_revisions"][service] = "b" * 40
            self.assertIn(service + ":code_revision_mismatch", evidence.verify_release(manifest, body)["errors"])
            manifest["code_revisions"][service] = commit
        manifest["code_revisions"]["app.api"] = "abcdef0"
        self.assertIn("app.api:manifest_requires_full_commit", evidence.verify_release(manifest, body)["errors"])
        manifest["code_revisions"]["unknown"] = commit
        self.assertIn("unknown:revision_requires_manifest_service", evidence.verify_release(manifest, body)["errors"])

    def test_release_requires_ledger_head_for_dispatcher_and_ledger(self):
        for service in ["funda.dispatcher", "funda.ledger-postgres"]:
            body, manifest = snapshot(), self.manifest()
            manifest["services"][service] = IMAGE
            body["hosts"]["scraper"]["containers"].append({"service": service, "image_id": IMAGE, "running": True})
            body["hosts"]["scraper"]["databases"]["ledger"] = {"migration_heads": ["20260913_credit_v1"]}
            self.assertIn("manifest:require_all_database_heads", evidence.verify_release(manifest, body)["errors"])
            manifest["migrations"]["ledger"] = ["20260913_credit_v1"]
            self.assertTrue(evidence.verify_release(manifest, body)["passed"])
            manifest["migrations"]["ledger"] = ["wrong"]
            self.assertIn("ledger:migration_mismatch", evidence.verify_release(manifest, body)["errors"])

    def test_release_allows_optional_ledger_head_without_ledger_service(self):
        body, manifest = snapshot(), self.manifest()
        manifest["migrations"]["ledger"] = ["20260913_credit_v1"]
        body["hosts"]["scraper"]["databases"]["ledger"] = {"migration_heads": ["20260913_credit_v1"]}
        self.assertTrue(evidence.verify_release(manifest, body)["passed"])

    def test_full_capture_ledger_is_optional_and_reads_independent_schema(self):
        for has_ledger in [False, True]:
            names = ["huishype-funda-scraper-postgres-1", "huishype-pararius-scraper-postgres-1"]
            if has_ledger:
                names.append("huishype-funda-scraper-ledger-postgres-1")
            containers = [{"Id": name, "Name": "/" + name, "Image": IMAGE,
                           "Mounts": [{"Type": "volume", "Name": "huishype-funda-scraper_postgres_data"},
                                      {"Type": "bind", "Source": "/private/path"}],
                           "Config": {"Labels": {}, "Image": "repo:" + "a" * 40}, "State": {"Running": True}} for name in names]
            queries = []
            def command(args, **kwargs):
                if args[:3] == ["docker", "ps", "-aq"]:
                    return " ".join(names)
                if args[:2] == ["docker", "inspect"]:
                    return json.dumps(containers)
                self.assertIn("PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=15000", args)
                query = args[-1]
                queries.append(query)
                if "pg_database_size" in query:
                    return "1234"
                if "realty_schema_revision" in query:
                    self.assertIn("WHERE id = 1", query)
                    return json.dumps([{"head": "20260913_credit_v1", "fingerprint": "abcd", "applied_at": START.isoformat()}])
                return json.dumps([{"version_num": "scraper_head"}])
            with patch.object(evidence, "run", side_effect=command), \
                 patch.object(evidence, "read_json_url", return_value={"status": "healthy"}), \
                 patch.object(Path, "read_text", return_value="API_KEY=secret\n"):
                result = evidence.remote_capture("scraper")
            self.assertEqual(result["status"], "complete", result["errors"])
            self.assertEqual(result["containers"][0]["image_reference"], "repo:" + "a" * 40)
            self.assertEqual(result["containers"][0]["commit"], "a" * 40)
            self.assertEqual(result["containers"][0]["named_volumes"], ["huishype-funda-scraper_postgres_data"])
            self.assertNotIn("/private/path", json.dumps(result))
            self.assertEqual("ledger" in result["databases"], has_ledger)
            self.assertEqual(any("realty_schema_revision" in q for q in queries), has_ledger)
            if has_ledger:
                self.assertEqual(result["databases"]["ledger"]["migration_heads"], ["20260913_credit_v1"])
                self.assertEqual(result["databases"]["ledger"]["head"], "20260913_credit_v1")
                self.assertEqual(result["databases"]["ledger"]["recent_migrations"][0]["fingerprint"], "abcd")

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

    def test_window_manifest_requires_metrics_in_every_light_sample(self):
        bodies = [snapshot(minute, light=minute not in (0, 1440)) for minute in range(0, 1441, 2)]
        for body in bodies:
            body["hosts"]["app"]["metrics"] = {"app_queues": {"status": "available", "values": queue_values()}}
        manifest = self.manifest()
        manifest["required_metrics"] = ["app.queues"]
        result = evidence.verify_window(bodies, manifest=manifest)
        self.assertTrue(result["passed"], result["errors"])
        del bodies[360]["hosts"]["app"]["metrics"]["app_queues"]["values"]["dirty_tile_updates"]
        result = evidence.verify_window(bodies, manifest=manifest)
        self.assertFalse(result["passed"])
        self.assertIn("360:app.queues:required_metric_unavailable", result["errors"])
        self.assertTrue(evidence.verify_window(bodies)["passed"])

    def test_window_manifest_binds_each_full_sample_to_declared_release(self):
        bodies = [snapshot(minute, light=minute not in (0, 720, 1440)) for minute in range(0, 1441, 2)]
        manifest = self.manifest()
        manifest["services"]["app.api"] = "sha256:" + "b" * 64
        result = evidence.verify_window(bodies, manifest=manifest)
        self.assertFalse(result["passed"])
        for index in [0, 360, 720]:
            self.assertIn(str(index) + ":app.api:running_image_mismatch", result["errors"])
        self.assertNotIn("release_identity_changed", result["errors"])

    def test_window_cannot_lower_24_hour_requirement(self):
        for hours in [0, 1, 23.9, float("nan")]:
            with self.assertRaises(ValueError):
                evidence.verify_window([], hours=hours)

    def test_window_rejects_image_code_or_migration_changes_in_full_samples(self):
        for change in ["image_id", "commit", "migration_heads", "removed_service"]:
            bodies = [snapshot(minute, light=minute not in (0, 720, 1440)) for minute in range(0, 1441, 2)]
            middle = bodies[360]["hosts"]["app"]
            if change in ["image_id", "commit"]:
                middle["containers"][0][change] = "b" * 40
            elif change == "migration_heads":
                middle["databases"]["app"]["migration_heads"] = ["new-head"]
            else:
                middle["containers"] = []
            result = evidence.verify_window(bodies)
            self.assertIn("release_identity_changed", result["errors"], change)
            self.assertFalse(result["passed"])
            self.assertIsNone(result["release_identity"])

    def test_window_allows_process_restarts_and_ignores_light_identity(self):
        bodies = [snapshot(minute, light=minute not in (0, 720, 1440)) for minute in range(0, 1441, 2)]
        for index in [0, 360, 720]:
            container = bodies[index]["hosts"]["app"]["containers"][0]
            container.update({"name": "api-restarted-" + str(index), "id": "container-" + str(index), "pid": index})
        bodies[1]["hosts"]["app"]["containers"] = [{"service": "app.api", "running": True, "image_id": "partial-light-data"}]
        result = evidence.verify_window(bodies)
        self.assertTrue(result["passed"], result["errors"])
        self.assertEqual(result["full_snapshots"], 3)
        self.assertRegex(result["release_identity"], r"^[0-9a-f]{64}$")

    def test_release_identity_is_independent_of_container_and_head_order(self):
        body = snapshot()
        body["hosts"]["scraper"]["databases"]["funda"]["migration_heads"] = ["b", "a"]
        before = evidence.release_identity(body)
        body["hosts"]["scraper"]["containers"].reverse()
        body["hosts"]["scraper"]["databases"]["funda"]["migration_heads"].reverse()
        self.assertEqual(evidence.release_identity(body), before)

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
