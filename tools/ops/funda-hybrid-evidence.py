#!/usr/bin/env python3
"""Read-only deployment evidence. Python standard library only.

capture --output-dir /private/evidence
watch --output-dir /private/evidence --interval 60 --duration-hours 24
verify-release --manifest release.json --snapshot /private/evidence/snapshot-*.json
verify-window --directory /private/evidence --manifest release.json --hours 24 --max-gap-minutes 2
audit-freshness --start 2026-09-14T00:00:00Z --end 2026-09-15T00:00:00Z --directory /private/evidence --output-dir /private/audits

Manifest format (all expected services and databases must be specified):
{"services":{"app.api":"sha256:<64 hex>","funda.worker":"sha256:<64 hex>"},
 "completed_services":{"funda.migrate":"sha256:<64 hex>"},
 "code_revisions":{"app.api":"<40 hex commit>"},
 "required_metrics":["app.queues","funda.evidence"],
 "migrations":{"app":["<latest drizzle hash>"],"funda":["<alembic head>"],
               "pararius":["<alembic head>"],"ledger":["20260913_credit_v1"]}}

The ledger migration head is optional for legacy snapshots and required when
the manifest includes funda.dispatcher or funda.ledger-postgres.
App queue telemetry is optional for legacy releases. required_metrics can require
"app.queues" (all aggregate metrics) or "app.queues.<metric_name>" individually.
"funda.evidence" requires complete typed source evidence; availability is distinct
from readiness, so false inventory coverage and empty-queue nulls remain valid.
"app.publications" requires retained publication aggregates for the last 24 full
minute buckets. audit-freshness measures an explicit minute-aligned interval and
its pending-work samples; inventory and budget acceptance remain separate gates.
Watch indefinitely and use the same explicit UTC-minute start/end for window
verification, freshness audit, source certificate, and ledger report. The interval
must be at least 24 hours and may be extended until the useful paid span reaches
24 hours. Stop watch after end to record a final full sample; a full sample must
complete at/before start and another must be captured at/after end.

Release verification requires every recognized running service in the manifest,
including infrastructure. Window verification checks observation coverage and records
operational reasons; it NEVER certifies inventory completeness or release
acceptance. Capture issues produce a partial file and exit 1. No logs, Docker
environment, response error bodies, or raw exception messages are persisted.
SSH uses existing trusted host keys and never forwards an agent.
"""

import argparse
import collections
import datetime as dt
import hashlib
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time
import urllib.request

DEFAULT_ENV = "/home/caslan/dev/git_repos/hh/huishype/.env.scraper-deploy"
STATUS_FIELDS = {"status", "operationalStatus", "services", "freshness", "queue",
                 "upstream", "stats", "acquisition", "planner", "credits", "inventory", "outbox", "hybrid", "recovery"}
SENSITIVE = re.compile(r"password|passwd|secret|token|api.?key|authorization|cookie|credential|dsn|database.?url", re.I)
SAFE_LABELS = {"com.docker.compose.project", "com.docker.compose.service",
               "com.docker.compose.version", "org.opencontainers.image.revision"}
SERVICES = {"api", "web", "worker", "scheduler", "sync", "candidates", "probe", "postgres", "redis", "photon",
            "migrate", "planner", "ledger-migrate", "dispatcher", "ledger-postgres"}
HEALTHY_STATUSES = {"ok", "healthy"}
APP_QUEUE_METRICS = {"expired_active_eligible", "pending_price_repairs", "pending_property_tile_updates",
                     "dirty_tile_updates", "expired_dirty_tile_leases", "dirty_tile_errors"}
FUNDA_EVIDENCE_FIELDS = {
    "delivery": {
        "oldestPendingAcquisitionObservedAt": "timestamp?", "oldestPendingAcquisitionAgeSeconds": "number?",
        "oldestPendingEventRecordedAt": "timestamp?", "oldestPendingEventAgeSeconds": "number?",
        "oldestPendingBatchCreatedAt": "timestamp?", "oldestPendingBatchAgeSeconds": "number?",
        "maximumAcquisitionReceiptLatencySeconds24h": "number?", "completedAcquisitionRecordCount24h": "count",
        "writerGeneration": "count", "deliveredSequence": "count",
    },
    "mandatoryRequests": {
        "pendingCount": "count", "oldestCreatedAt": "timestamp?", "oldestAgeSeconds": "number?",
        "earliestDeadline": "timestamp?", "maximumOverdueSeconds": "number?",
    },
    "nationalInventory": {
        "catalogVersion": "string?", "catalogCoverageVerified": "bool", "activePartitionCount": "count",
        "verifiedCompletePartitions24h": "count", "latestComponentCompletedAt": "timestamp?",
        "oldestComponentCompletedAt": "timestamp?", "latestCertificateId": "string?",
        "latestCertificateCompletedAt": "timestamp?", "certificatePartitionCount": "count",
    },
    "core": {
        "canonicalListingCount": "count", "eligibleListingCount": "count", "confirmedWithin24HoursCount": "count",
        "expiredHistoricalCount": "count", "eligibleConditionalCount": "count",
    },
}
APP_QUEUE_SQL = """
WITH expired AS (
  SELECT count(*) AS n, min(availability_expires_at) AS oldest
  FROM canonical_listings WHERE active_eligible = true AND availability_expires_at <= now()
), repairs AS (
  SELECT count(*) AS n, min(enqueued_at) AS oldest
  FROM price_evidence_repair_queue WHERE derived_recomputed_at IS NULL
), properties AS (
  SELECT count(*) AS n, min(requested_at) AS oldest FROM listing_tile_property_updates
), tiles AS (
  SELECT count(*) AS n, min(requested_at) AS oldest,
    count(*) FILTER (WHERE lease_until < now()) AS expired_n,
    min(lease_until) FILTER (WHERE lease_until < now()) AS expired_oldest,
    count(*) FILTER (WHERE last_error IS NOT NULL) AS errors_n,
    min(requested_at) FILTER (WHERE last_error IS NOT NULL) AS errors_oldest
  FROM listing_tile_updates WHERE requested_revision > published_revision
)
SELECT json_build_object(
  'expired_active_eligible', json_build_object('count', expired.n,
    'oldest_age_seconds', CASE WHEN expired.n > 0 THEN greatest(0, extract(epoch FROM now()-expired.oldest)) END),
  'pending_price_repairs', json_build_object('count', repairs.n,
    'oldest_age_seconds', CASE WHEN repairs.n > 0 THEN greatest(0, extract(epoch FROM now()-repairs.oldest)) END),
  'pending_property_tile_updates', json_build_object('count', properties.n,
    'oldest_age_seconds', CASE WHEN properties.n > 0 THEN greatest(0, extract(epoch FROM now()-properties.oldest)) END),
  'dirty_tile_updates', json_build_object('count', tiles.n,
    'oldest_age_seconds', CASE WHEN tiles.n > 0 THEN greatest(0, extract(epoch FROM now()-tiles.oldest)) END),
  'expired_dirty_tile_leases', json_build_object('count', tiles.expired_n,
    'oldest_age_seconds', CASE WHEN tiles.expired_n > 0 THEN greatest(0, extract(epoch FROM now()-tiles.expired_oldest)) END),
  'dirty_tile_errors', json_build_object('count', tiles.errors_n,
    'oldest_age_seconds', CASE WHEN tiles.errors_n > 0 THEN greatest(0, extract(epoch FROM now()-tiles.errors_oldest)) END)
) FROM expired CROSS JOIN repairs CROSS JOIN properties CROSS JOIN tiles;
"""


def utcnow():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def parse_env(content):
    """Parse literal dotenv assignments; never evaluate shell substitutions."""
    result = {}
    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, sep, value = line.partition("=")
        if not sep or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key.strip()):
            continue
        words = shlex.split(value, comments=True, posix=True)
        result[key.strip()] = " ".join(words)
    return result


def sanitize(value, secrets=(), depth=0):
    if depth > 16:
        return "[depth limit]"
    if isinstance(value, dict):
        return {sanitize(str(k), secrets, depth + 1)[:160]: sanitize(v, secrets, depth + 1)
                for k, v in list(value.items())[:500] if not SENSITIVE.search(str(k))}
    if isinstance(value, list):
        return [sanitize(v, secrets, depth + 1) for v in value[:500]]
    if isinstance(value, str):
        for secret in sorted(set(secrets), key=len, reverse=True):
            if secret:
                value = value.replace(secret, "[redacted]")
        value = re.sub(r"(?:https?|postgres(?:ql)?|redis)://\S+", "[redacted URL]", value)
        value = re.sub(r"(?i)bearer\s+\S+", "Bearer [redacted]", value)
        value = re.sub(r"(?i)(password|secret|token|api[_-]?key)\s*[=:]\s*\S+", r"\1=[redacted]", value)
        return value[:1000]
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    return "[unsupported]"


def run(command, timeout=30, input_text=None):
    completed = subprocess.run(command, input=input_text, text=True, capture_output=True,
                               timeout=timeout, check=False)
    if completed.returncode:
        raise RuntimeError("command_failed")
    return completed.stdout


def valid_queue_metric(value):
    if (not isinstance(value, dict) or type(value.get("count")) is not int or value["count"] < 0
            or "oldest_age_seconds" not in value):
        return False
    age = value.get("oldest_age_seconds")
    return ((value["count"] == 0 and age is None)
            or (value["count"] > 0 and type(age) in (int, float) and math.isfinite(age) and age >= 0))


def read_db_json(container, query):
    shell = ('exec psql -X -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" '
             '-d "$POSTGRES_DB" -c "$1"')
    command = ["docker", "exec", "-e",
               "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000",
               container["Id"], "sh", "-c", shell, "evidence", query]
    return json.loads(run(command, timeout=8))


def app_queue_telemetry(container):
    """One bounded aggregate request; unavailable legacy schema is not host failure."""
    try:
        values = read_db_json(container, APP_QUEUE_SQL)
        if not isinstance(values, dict) or any(not valid_queue_metric(values.get(key)) for key in APP_QUEUE_METRICS):
            raise ValueError("invalid_aggregate_response")
        # Explicit numeric projection, even if a malformed endpoint/fixture adds fields.
        safe = {key: {field: values[key][field] for field in ("count", "oldest_age_seconds")}
                for key in sorted(APP_QUEUE_METRICS)}
        return {"status": "available", "observed_at": utcnow(), "values": safe}
    except Exception as exc:
        return {"status": "unavailable", "reason": type(exc).__name__}


PUBLICATION_FIELDS = {"scope", "interval_start", "interval_end", "publication_count", "total_latency_ms",
                      "max_latency_ms", "bucket_count", "bucket_start_min", "bucket_start_max"}


def publication_sql(start=None, end=None):
    if (start is None) != (end is None):
        raise ValueError("both_interval_bounds_required")
    if start is None:
        lower, upper = "date_trunc('minute', now()) - interval '24 hours'", "date_trunc('minute', now())"
    else:
        start, end = audit_interval(start, end)
        # Bounds were parsed and canonicalized; no user text enters the SQL.
        lower, upper = "TIMESTAMPTZ '" + start + "'", "TIMESTAMPTZ '" + end + "'"
    return ("WITH bounds AS (SELECT " + lower + " AS lower_bound, " + upper + " AS upper_bound), "
            "totals AS (SELECT COALESCE(sum(publication_count),0) AS n, COALESCE(sum(total_latency_ms),0) AS total, "
            "max(max_latency_ms) AS maximum, count(*) AS buckets, min(bucket_start) AS first_bucket, "
            "max(bucket_start) AS last_bucket FROM listing_tile_publication_metrics CROSS JOIN bounds "
            "WHERE bucket_start >= lower_bound AND bucket_start < upper_bound) "
            "SELECT json_build_object('scope','publication_minute_buckets','interval_start',lower_bound, "
            "'interval_end',upper_bound,'publication_count',n,'total_latency_ms',total,'max_latency_ms',maximum, "
            "'bucket_count',buckets,'bucket_start_min',first_bucket,'bucket_start_max',last_bucket) FROM totals CROSS JOIN bounds;")


def valid_publications(value):
    if not isinstance(value, dict) or not PUBLICATION_FIELDS <= value.keys() or value["scope"] != "publication_minute_buckets":
        return False
    if any(type(value[k]) is not int or value[k] < 0 for k in ("publication_count", "total_latency_ms", "bucket_count")):
        return False
    try:
        start, end = timestamp(value["interval_start"]), timestamp(value["interval_end"])
        if end <= start or any(t.second or t.microsecond for t in (start, end)):
            return False
        if value["publication_count"] == 0:
            return (value["total_latency_ms"] == value["bucket_count"] == 0
                    and all(value[k] is None for k in ("max_latency_ms", "bucket_start_min", "bucket_start_max")))
        maximum = value["max_latency_ms"]
        first, last = timestamp(value["bucket_start_min"]), timestamp(value["bucket_start_max"])
        return (type(maximum) is int and 0 <= maximum <= value["total_latency_ms"]
                and 1 <= value["bucket_count"] <= value["publication_count"]
                and value["bucket_count"] <= (end - start).total_seconds() / 60
                and start <= first <= last < end and not any(t.second or t.microsecond for t in (first, last)))
    except (ValueError, TypeError, OverflowError):
        return False


def app_publication_telemetry(container, start=None, end=None):
    try:
        values = read_db_json(container, publication_sql(start, end))
        if not valid_publications(values):
            raise ValueError("invalid_publication_aggregate")
        return {"status": "available", "observed_at": utcnow(), "values": {k: values[k] for k in sorted(PUBLICATION_FIELDS)}}
    except Exception as exc:
        return {"status": "unavailable", "reason": type(exc).__name__}


def valid_source_evidence(value):
    if not isinstance(value, dict):
        return False
    for section, fields in FUNDA_EVIDENCE_FIELDS.items():
        body = value.get(section)
        if not isinstance(body, dict) or not fields.keys() <= body.keys():
            return False
        for field, kind in fields.items():
            item = body[field]
            if item is None and kind.endswith("?"):
                continue
            if kind == "count" and (type(item) is not int or item < 0):
                return False
            if kind == "bool" and type(item) is not bool:
                return False
            if kind == "number?" and (type(item) not in (int, float) or not math.isfinite(item) or item < 0):
                return False
            if kind == "string?" and (not isinstance(item, str) or not item.strip()):
                return False
            if kind == "timestamp?":
                try:
                    timestamp(item)
                except (ValueError, TypeError, OverflowError):
                    return False
    for time_key, age_key in [
        ("oldestPendingAcquisitionObservedAt", "oldestPendingAcquisitionAgeSeconds"),
        ("oldestPendingEventRecordedAt", "oldestPendingEventAgeSeconds"),
        ("oldestPendingBatchCreatedAt", "oldestPendingBatchAgeSeconds"),
    ]:
        if (value["delivery"][time_key] is None) != (value["delivery"][age_key] is None):
            return False
    delivery = value["delivery"]
    if ((delivery["maximumAcquisitionReceiptLatencySeconds24h"] is None)
            != (delivery["completedAcquisitionRecordCount24h"] == 0)):
        return False
    mandatory = value["mandatoryRequests"]
    for field in ("oldestCreatedAt", "oldestAgeSeconds", "earliestDeadline", "maximumOverdueSeconds"):
        if (mandatory[field] is None) != (mandatory["pendingCount"] == 0):
            return False
    return True


def required_metric_errors(required, snapshot):
    if not isinstance(required, list) or any(not isinstance(key, str) for key in required):
        return ["manifest:invalid_required_metrics"]
    telemetry = snapshot.get("hosts", {}).get("app", {}).get("metrics", {}).get("app_queues", {})
    errors = []
    for key in required:
        if key == "app.publications":
            publication = snapshot.get("hosts", {}).get("app", {}).get("metrics", {}).get("app_publications", {})
            if publication.get("status") != "available" or not valid_publications(publication.get("values")):
                errors.append(key + ":required_metric_unavailable")
            continue
        if key == "funda.evidence":
            source = snapshot
            for path_key in ("hosts", "scraper", "endpoints", "funda.status", "recovery", "evidence"):
                source = source.get(path_key) if isinstance(source, dict) else None
            if not valid_source_evidence(source):
                errors.append(key + ":required_metric_unavailable")
            continue
        if key == "app.queues":
            metric_names = APP_QUEUE_METRICS
        elif key.startswith("app.queues.") and key[len("app.queues."):] in APP_QUEUE_METRICS:
            metric_names = {key[len("app.queues."):]}
        else:
            errors.append("manifest:unknown_required_metric")
            continue
        if (telemetry.get("status") != "available" or any(
                not valid_queue_metric(telemetry.get("values", {}).get(name)) for name in metric_names)):
            errors.append(key + ":required_metric_unavailable")
    return errors


def service_key(name, labels, role):
    if role == "scraper":
        for source in ("funda", "pararius"):
            match = re.fullmatch(r"huishype-" + source + r"-scraper-([a-z][a-z-]*)-\d+", name)
            project = labels.get("com.docker.compose.project", "")
            service = match[1] if match else labels.get("com.docker.compose.service")
            if (match or project == "huishype-" + source + "-scraper") and service in SERVICES:
                return source + "." + service
    else:
        match = re.fullmatch(r"(api|web|worker|postgres|redis|photon|migrate)-cop1e1822hijj6g3zmxhrs0k(?:-.*)?", name)
        project = labels.get("com.docker.compose.project", "")
        service = match[1] if match else labels.get("com.docker.compose.service")
        if (match or project == "cop1e1822hijj6g3zmxhrs0k") and service in SERVICES:
            return "app." + service
    return None


def image_commit(labels, image_reference):
    """Prefer the OCI revision; otherwise recognize a full commit image tag."""
    revision = labels.get("org.opencontainers.image.revision")
    if isinstance(revision, str) and re.fullmatch(r"[0-9a-fA-F]{7,64}", revision):
        return revision.lower()
    if isinstance(image_reference, str) and "@" not in image_reference:
        _, separator, tag = image_reference.rsplit("/", 1)[-1].rpartition(":")
        if separator and re.fullmatch(r"[0-9a-fA-F]{40}", tag):
            return tag.lower()
    return None


def read_json_url(url, key=None):
    headers = {"Accept": "application/json"}
    if key:
        headers["Authorization"] = "Bearer " + key
    # Do not follow redirects with an Authorization header or use ambient proxies.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(urllib.request.Request(url, headers=headers), timeout=15) as response:
        data = response.read(2_000_001)
        if len(data) > 2_000_000:
            raise ValueError("response_too_large")
        body = json.loads(data)
        if not isinstance(body, dict):
            raise ValueError("invalid_response")
        return body


def remote_capture(role, light=False):
    evidence = {"captured_at": utcnow(), "status": "complete", "errors": [],
                "containers": [], "databases": {}, "endpoints": {}}
    secrets = []

    def attempt(label, operation):
        try:
            return operation()
        except Exception as exc:
            evidence["errors"].append({"check": label, "kind": type(exc).__name__})
            evidence["status"] = "partial"
            return None

    def resources():
        fs = os.statvfs("/")
        memory = {}
        for line in Path("/proc/meminfo").read_text().splitlines():
            key, _, value = line.partition(":")
            if key in {"MemTotal", "MemAvailable", "SwapTotal", "SwapFree"}:
                memory[key + "_bytes"] = int(value.split()[0]) * 1024
        return {"root_disk_bytes": fs.f_blocks * fs.f_frsize,
                "root_disk_available_bytes": fs.f_bavail * fs.f_frsize, "memory": memory}

    evidence["resources"] = attempt("resources", resources)
    docker_list = ["docker", "ps", "-aq"]
    if light:
        docker_list += ["--filter", "name=api-cop1e1822hijj6g3zmxhrs0k",
                        "--filter", "name=postgres-cop1e1822hijj6g3zmxhrs0k"]
    ids = attempt("docker_list", lambda: run(docker_list).split()) if not light or role == "app" else []
    inspected = attempt("docker_inspect", lambda: json.loads(run(["docker", "inspect", *ids]))) if ids else []
    selected = {}
    for container in inspected or []:
        labels = container.get("Config", {}).get("Labels") or {}
        name = container["Name"].lstrip("/")
        key = service_key(name, labels, role)
        if not key:
            continue
        selected.setdefault(key, []).append(container)
        image_reference = container.get("Config", {}).get("Image")
        evidence["containers"].append({
            "service": key, "name": name, "image_id": container["Image"],
            "image_reference": image_reference if isinstance(image_reference, str) else None,
            "labels": {k: v for k, v in labels.items() if k in SAFE_LABELS},
            "commit": image_commit(labels, image_reference),
            "running": container.get("State", {}).get("Running", False),
            "state": container.get("State", {}).get("Status"),
            "exit_code": container.get("State", {}).get("ExitCode"),
            "finished_at": container.get("State", {}).get("FinishedAt"),
            "health": container.get("State", {}).get("Health", {}).get("Status"),
        })
        if not light:
            evidence["containers"][-1]["named_volumes"] = sorted({
                mount["Name"] for mount in container.get("Mounts", [])
                if mount.get("Type") == "volume" and isinstance(mount.get("Name"), str)
                and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", mount["Name"])
            })
    if not light and not selected:
        evidence["errors"].append({"check": "containers", "kind": "NoExpectedContainers"})
        evidence["status"] = "partial"

    def record_health(source, body):
        if body is None:
            return
        healthy = isinstance(body.get("status"), str) and body["status"] in HEALTHY_STATUSES
        evidence["endpoints"][source + ".health"] = {"status": body.get("status"), "ok": healthy}
        if not healthy:
            evidence["errors"].append({"check": source + ".health", "kind": "UnhealthyResponse"})
            evidence["status"] = "partial"

    def one(key):
        matches = [c for c in selected.get(key, []) if c.get("State", {}).get("Running")]
        if len(matches) != 1:
            raise ValueError("expected_one_running_container")
        return matches[0]

    def database(source):
        container = one("funda.ledger-postgres" if source == "ledger" else source + ".postgres")
        if source == "app":
            query = ("SELECT COALESCE(json_agg(t), '[]'::json) FROM "
                     "(SELECT * FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 5) t;")
        elif source == "ledger":
            query = ("SELECT COALESCE(json_agg(t), '[]'::json) FROM "
                     "(SELECT head, fingerprint, applied_at FROM realty_schema_revision WHERE id = 1) t;")
        else:
            query = "SELECT COALESCE(json_agg(t), '[]'::json) FROM (SELECT version_num FROM alembic_version ORDER BY version_num) t;"
        # Environment stays inside the DB container; SQL is fixed and read-only.
        shell = ('exec psql -X -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" '
                 '-d "$POSTGRES_DB" -c "$1"')
        base = ["docker", "exec", "-e", "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=15000",
                container["Id"], "sh", "-c", shell, "evidence"]
        rows = json.loads(run(base + [query]))
        size = int(run(base + ["SELECT pg_database_size(current_database());"]).strip())
        column = "hash" if source == "app" else "head" if source == "ledger" else "version_num"
        heads = [r[column] for r in (rows[:1] if source == "app" else rows)]
        if not heads:
            raise ValueError("missing_migration_heads")
        result = {"migration_heads": heads, "recent_migrations": rows, "size_bytes": size}
        if source == "ledger":
            if len(heads) != 1 or not isinstance(heads[0], str) or not heads[0]:
                raise ValueError("invalid_ledger_head")
            result["head"] = heads[0]
        return result

    for source in (["app"] if role == "app" else ["funda", "pararius"]):
        db = attempt(source + ".database", lambda source=source: database(source)) if not light else None
        if db is not None:
            evidence["databases"][source] = db
        if source == "app":
            def app_health():
                container = one("app.api")
                addresses = [n.get("IPAddress") for n in container["NetworkSettings"]["Networks"].values() if n.get("IPAddress")]
                if not addresses:
                    raise ValueError("no_api_address")
                address = str(ipaddress.ip_address(addresses[0]))
                return read_json_url("http://" + address + ":3100/health")
            body = attempt("app.health", app_health)
            record_health("app", body)
            continue
        port = 8100 if source == "funda" else 8101
        base_url = "http://10.42.0.2:" + str(port)
        path = "/health" if source == "funda" else "/api/v1/health"
        body = attempt(source + ".health", lambda: read_json_url(base_url + path))
        record_health(source, body)

        def status_request():
            env_file = ".env.production" if source == "funda" else ".env"
            env = parse_env(Path("/opt/huishype-scrapers/huishype-" + source + "-scraper/" + env_file).read_text())
            secrets.extend(v for k, v in env.items() if SENSITIVE.search(k) and v)
            key = env.get("API_KEY")
            if not key:
                raise ValueError("missing_api_key")
            body = read_json_url(base_url + "/api/v1/status", key)
            return {k: v for k, v in body.items() if k in STATUS_FIELDS}
        body = attempt(source + ".status", status_request)
        if body is not None:
            evidence["endpoints"][source + ".status"] = body
    if not light and "funda.ledger-postgres" in selected:
        ledger = attempt("ledger.database", lambda: database("ledger"))
        if ledger is not None:
            evidence["databases"]["ledger"] = ledger
    if role == "app":
        try:
            telemetry = app_queue_telemetry(one("app.postgres"))
        except Exception as exc:
            telemetry = {"status": "unavailable", "reason": type(exc).__name__}
        evidence["metrics"] = {"app_queues": telemetry}
        try:
            evidence["metrics"]["app_publications"] = app_publication_telemetry(one("app.postgres"))
        except Exception as exc:
            evidence["metrics"]["app_publications"] = {"status": "unavailable", "reason": type(exc).__name__}
    evidence["completed_at"] = utcnow()
    return sanitize(evidence, secrets)


def ssh_command(env, role, light=False):
    app = str(ipaddress.ip_address(env["APP_VM_PUBLIC_IP"]))
    scraper = str(ipaddress.ip_address(env["SCRAPER_VM_PUBLIC_IP"]))
    user = env.get("SCRAPER_VM_SSH_USER", "root")
    if not re.fullmatch(r"[a-z_][a-z0-9_-]*", user):
        raise ValueError("invalid_ssh_user")
    command = ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
               "-o", "ForwardAgent=no", "-o", "ConnectTimeout=15"]
    if role == "scraper":
        command += ["-J", "root@" + app]
    command += ["root@" + app if role == "app" else user + "@" + scraper,
                "python3 - --remote " + role + (" --light" if light else "")]
    return command


def capture(env_path, output_dir, light=False):
    evidence = {"schema_version": 1, "sample_kind": "light" if light else "full", "captured_at": utcnow(), "status": "complete", "hosts": {}, "errors": []}
    try:
        env = parse_env(Path(env_path).read_text())
        script = Path(__file__).read_text()
        for role in ("app", "scraper"):
            try:
                body = json.loads(run(ssh_command(env, role, light), timeout=45, input_text=script))
                if not isinstance(body, dict) or body.get("status") not in {"complete", "partial"}:
                    raise ValueError("invalid_remote_evidence")
                evidence["hosts"][role] = body
                if body["status"] != "complete":
                    evidence["status"] = "partial"
            except Exception as exc:
                evidence["status"] = "partial"
                evidence["errors"].append({"check": role, "kind": type(exc).__name__})
        secrets = [v for k, v in env.items() if SENSITIVE.search(k) and v]
        evidence = sanitize(evidence, secrets)
    except Exception as exc:
        evidence["status"] = "partial"
        evidence["errors"].append({"check": "configuration", "kind": type(exc).__name__})
    evidence["completed_at"] = utcnow()
    directory = Path(output_dir)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    stamp = evidence["captured_at"].replace(":", "").replace("-", "")
    path = directory / ("snapshot-" + stamp + ".json")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump(evidence, handle, indent=2, allow_nan=False)
        handle.write("\n")
    return evidence, path


def snapshot_errors(snapshot, require_release=True):
    errors = []
    if snapshot.get("schema_version") != 1 or snapshot.get("status") != "complete" or snapshot.get("errors"):
        errors.append("snapshot_incomplete")
    if snapshot.get("sample_kind", "full") not in {"full", "light"}:
        errors.append("invalid_sample_kind")
    if require_release and snapshot.get("sample_kind", "full") != "full":
        errors.append("release_requires_full_snapshot")
    for role in ("app", "scraper"):
        host = snapshot.get("hosts", {}).get(role, {})
        if host.get("status") != "complete" or host.get("errors"):
            errors.append(role + ":incomplete")
        if (require_release or snapshot.get("sample_kind", "full") == "full") and any(
                c.get("service") == "funda.ledger-postgres" for c in host.get("containers", [])):
            if not host.get("databases", {}).get("ledger", {}).get("migration_heads"):
                errors.append("ledger:missing_migrations")
        for source in (["app"] if role == "app" else ["funda", "pararius"]):
            if (require_release or snapshot.get("sample_kind", "full") == "full") and not host.get("databases", {}).get(source, {}).get("migration_heads"):
                errors.append(source + ":missing_migrations")
            health = host.get("endpoints", {}).get(source + ".health", {})
            if health.get("ok") is not True or health.get("status") not in HEALTHY_STATUSES:
                errors.append(source + ":missing_health")
            if source != "app" and not host.get("endpoints", {}).get(source + ".status"):
                errors.append(source + ":missing_status")
    return errors


def verify_release(manifest, snapshot):
    errors = snapshot_errors(snapshot)
    errors.extend(required_metric_errors(manifest.get("required_metrics", []), snapshot))
    services, migrations = manifest.get("services"), manifest.get("migrations")
    if not isinstance(services, dict) or not services:
        errors.append("manifest:missing_services")
        services = {}
    completed = manifest.get("completed_services", {})
    if not isinstance(completed, dict):
        errors.append("manifest:invalid_completed_services")
        completed = {}
    required_databases = {"app", "funda", "pararius"}
    if (set(services) | set(completed)).intersection({"funda.dispatcher", "funda.ledger-postgres"}):
        required_databases.add("ledger")
    if (not isinstance(migrations, dict) or not required_databases.issubset(migrations)
            or not set(migrations).issubset({"app", "funda", "pararius", "ledger"})):
        errors.append("manifest:require_all_database_heads")
        migrations = migrations if isinstance(migrations, dict) else {}
    containers = [c for host in snapshot.get("hosts", {}).values() for c in host.get("containers", [])]
    databases = {k: v for host in snapshot.get("hosts", {}).values() for k, v in host.get("databases", {}).items()}
    for container in containers:
        service = container.get("service", "")
        source, _, role = service.partition(".") if isinstance(service, str) else ("", "", "")
        if (container.get("running") is True and source in {"app", "funda", "pararius"}
                and role in SERVICES and service not in services):
            errors.append(service + ":undeclared_running_service")
    if set(completed).intersection(services):
        errors.append("manifest:service_cannot_be_running_and_completed")
    for service, image in services.items():
        if not isinstance(image, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", image):
            errors.append(service + ":manifest_requires_immutable_image_id")
        matches = [c for c in containers if c.get("service") == service and c.get("running") is True]
        if len(matches) != 1 or matches[0].get("image_id") != image:
            errors.append(service + ":running_image_mismatch")
    for service, image in completed.items():
        if not isinstance(image, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", image):
            errors.append(service + ":manifest_requires_immutable_image_id")
        matches = [c for c in containers if c.get("service") == service]
        if (len(matches) != 1 or matches[0].get("image_id") != image
                or matches[0].get("running") is not False or matches[0].get("state") != "exited"
                or matches[0].get("exit_code") != 0):
            errors.append(service + ":completed_service_mismatch")
            continue
        try:
            if timestamp(matches[0]["finished_at"]) > timestamp(snapshot["completed_at"]):
                raise ValueError("future_completion")
        except (KeyError, ValueError, TypeError):
            errors.append(service + ":invalid_completion_timestamp")
    for source, heads in migrations.items():
        if not isinstance(heads, list) or not heads or not all(isinstance(h, str) and h for h in heads):
            errors.append(source + ":invalid_expected_heads")
        elif sorted(heads) != sorted(databases.get(source, {}).get("migration_heads", [])):
            errors.append(source + ":migration_mismatch")
    revisions = manifest.get("code_revisions", {})
    if not isinstance(revisions, dict):
        errors.append("manifest:invalid_code_revisions")
        revisions = {}
    for service, expected in revisions.items():
        if service not in services and service not in completed:
            errors.append(service + ":revision_requires_manifest_service")
            continue
        if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-fA-F]{40}", expected):
            errors.append(service + ":manifest_requires_full_commit")
            continue
        matches = [c for c in containers if c.get("service") == service
                   and (service in completed or c.get("running") is True)]
        if len(matches) != 1 or matches[0].get("commit") != expected.lower():
            errors.append(service + ":code_revision_mismatch")
    return {"passed": not errors, "scope": "manifest_images_and_migrations", "errors": errors}


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError("timestamp_string_required")
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timezone_required")
    return parsed.astimezone(dt.timezone.utc)


def audit_interval(start, end, now=None):
    parsed = []
    for value in (start, end):
        point = timestamp(value)
        original = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        if original.utcoffset() != dt.timedelta(0) or point.second or point.microsecond:
            raise ValueError("audit_bounds_require_utc_minutes")
        parsed.append(point)
    if parsed[1] - parsed[0] < dt.timedelta(hours=24) or parsed[1] > (now or dt.datetime.now(dt.timezone.utc)):
        raise ValueError("audit_requires_completed_24_hour_interval")
    return tuple(point.isoformat().replace("+00:00", "Z") for point in parsed)


SOURCE_COMPLETION_FIELDS = {"scope", "interval_start", "interval_end", "completion_count",
                            "maximum_latency_seconds", "minimum_latency_seconds", "writer_generations"}


def source_completion_sql(start, end):
    start, end = audit_interval(start, end)
    return ("SELECT json_build_object('scope','source_acquisition_receipts', 'interval_start','" + start
            + "', 'interval_end','" + end + "', 'completion_count',count(*), "
            "'maximum_latency_seconds',max(extract(epoch FROM b.delivered_at-e.observed_at)), "
            "'minimum_latency_seconds',min(extract(epoch FROM b.delivered_at-e.observed_at)), "
            "'writer_generations',COALESCE(json_agg(DISTINCT e.writer_generation),'[]'::json)) "
            "FROM source_evidence_events e JOIN source_evidence_batches b "
            "ON b.writer_generation=e.writer_generation AND e.sequence>b.cursor_start AND e.sequence<=b.cursor_end "
            "WHERE e.purpose='acquisition' AND b.state='delivered' AND b.delivered_at>=TIMESTAMPTZ '" + start
            + "' AND b.delivered_at<TIMESTAMPTZ '" + end + "';")


def valid_source_completions(value):
    if not isinstance(value, dict) or not SOURCE_COMPLETION_FIELDS <= value.keys() or value["scope"] != "source_acquisition_receipts":
        return False
    if type(value["completion_count"]) is not int or value["completion_count"] < 0:
        return False
    generations = value["writer_generations"]
    if not isinstance(generations, list) or any(type(g) is not int or g < 0 for g in generations):
        return False
    try:
        audit_interval(value["interval_start"], value["interval_end"])
    except (ValueError, TypeError, OverflowError):
        return False
    minimum, maximum = value["minimum_latency_seconds"], value["maximum_latency_seconds"]
    if value["completion_count"] == 0:
        return minimum is None and maximum is None and not generations
    return (len(generations) > 0 and all(type(n) in (int, float) and math.isfinite(n) for n in (minimum, maximum))
            and minimum <= maximum)


def remote_audit(role, start, end):
    start, end = audit_interval(start, end)
    expected = "app.postgres" if role == "app" else "funda.postgres"
    name = "postgres-cop1e1822hijj6g3zmxhrs0k" if role == "app" else "huishype-funda-scraper-postgres-1"
    try:
        ids = run(["docker", "ps", "-aq", "--filter", "name=" + name]).split()
        containers = json.loads(run(["docker", "inspect", *ids])) if ids else []
        matches = [c for c in containers if c.get("State", {}).get("Running") is True
                   and service_key(c["Name"].lstrip("/"), c.get("Config", {}).get("Labels") or {}, role) == expected]
        if len(matches) != 1:
            raise ValueError("expected_one_running_database")
        if role == "app":
            return app_publication_telemetry(matches[0], start, end)
        values = read_db_json(matches[0], source_completion_sql(start, end))
        if not valid_source_completions(values):
            raise ValueError("invalid_source_completion_aggregate")
        return {"status": "available", "observed_at": utcnow(), "values": {k: values[k] for k in sorted(SOURCE_COMPLETION_FIELDS)}}
    except Exception as exc:
        return {"status": "unavailable", "reason": type(exc).__name__}


def audit_sample_window(snapshots, start, end, manifest=None, max_gap_minutes=2, now=None):
    start, end = timestamp(start), timestamp(end)
    ordered = sorted(snapshots, key=lambda s: timestamp(s["captured_at"]))
    before = [s for s in ordered if s.get("sample_kind", "full") == "full" and timestamp(s["completed_at"]) <= start]
    after = [s for s in ordered if s.get("sample_kind", "full") == "full" and timestamp(s["captured_at"]) >= end]
    errors = []
    result = {"maximum_pending_acquisition_age_seconds": 0, "maximum_pending_property_age_seconds": 0,
              "maximum_pending_tile_age_seconds": 0, "source_writer_generations": []}
    if not before or not after:
        errors.append("full_snapshots_must_bracket_audit_interval")
        selected = [s for s in ordered if start <= timestamp(s["captured_at"]) <= end]
    else:
        lower, upper = timestamp(before[-1]["captured_at"]), timestamp(after[0]["captured_at"])
        selected = [s for s in ordered if lower <= timestamp(s["captured_at"]) <= upper]
    coverage = verify_window(selected, hours=(end-start).total_seconds()/3600, manifest=manifest,
                             max_gap_minutes=max_gap_minutes, now=now)
    errors.extend(coverage["errors"])
    result["coverage"] = {key: coverage[key] for key in ("passed", "snapshots", "elapsed_hours", "largest_gap_minutes", "release_identity")}
    result["coverage"]["full_snapshot_brackets"] = {
        "start_captured_at": before[-1]["captured_at"] if before else None,
        "start_completed_at": before[-1]["completed_at"] if before else None,
        "end_captured_at": after[0]["captured_at"] if after else None,
        "end_completed_at": after[0]["completed_at"] if after else None,
    }
    generations, measured = set(), 0
    for index, snapshot in enumerate(selected):
        missing = required_metric_errors(["funda.evidence", "app.queues"], snapshot)
        errors.extend(str(index) + ":" + error for error in missing)
        if missing or not start <= timestamp(snapshot["captured_at"]) <= end:
            continue
        measured += 1
        source = snapshot["hosts"]["scraper"]["endpoints"]["funda.status"]["recovery"]["evidence"]["delivery"]
        generations.add(source["writerGeneration"])
        queues = snapshot["hosts"]["app"]["metrics"]["app_queues"]["values"]
        for name, age in [
            ("maximum_pending_acquisition_age_seconds", source["oldestPendingAcquisitionAgeSeconds"]),
            ("maximum_pending_property_age_seconds", queues["pending_property_tile_updates"]["oldest_age_seconds"]),
            ("maximum_pending_tile_age_seconds", queues["dirty_tile_updates"]["oldest_age_seconds"]),
        ]:
            if age is not None:
                result[name] = max(result[name], age)
    if not measured:
        errors.append("no_pending_work_samples_in_interval")
    if len(generations) != 1:
        errors.append("source_writer_generation_changed_or_missing")
    result.update({"passed": not errors, "errors": list(dict.fromkeys(errors)), "measured_samples": measured,
                   "source_writer_generations": sorted(generations)})
    return result


def freshness_result(source, app, window, start, end, limit=900):
    start, end = audit_interval(start, end)
    if type(limit) not in (int, float) or not math.isfinite(limit) or limit <= 0:
        raise ValueError("positive_finite_latency_limit_required")
    errors = list(window.get("errors", []))
    if window.get("passed") is not True and not errors:
        errors.append("observation_window_incomplete")
    source_values = source.get("values") if isinstance(source, dict) else None
    app_values = app.get("values") if isinstance(app, dict) else None
    source_ok = isinstance(source, dict) and source.get("status") == "available" and valid_source_completions(source_values)
    app_ok = isinstance(app, dict) and app.get("status") == "available" and valid_publications(app_values)
    for name, valid, value in [("source", source_ok, source_values), ("app", app_ok, app_values)]:
        if not valid:
            errors.append(name + ":completion_evidence_unavailable")
        elif timestamp(value["interval_start"]) != timestamp(start) or timestamp(value["interval_end"]) != timestamp(end):
            errors.append(name + ":completion_interval_mismatch")
    bound = None
    source_count = source_values["completion_count"] if source_ok else None
    app_count = app_values["publication_count"] if app_ok else None
    if source_ok and source_count == 0:
        errors.append("source:no_actual_completions")
    if app_ok and app_count == 0:
        errors.append("app:no_actual_completions")
    if source_ok and source_count:
        if source_values["minimum_latency_seconds"] < 0:
            errors.append("source:negative_latency_invalid_provenance")
        if sorted(set(source_values["writer_generations"])) != window.get("source_writer_generations"):
            errors.append("source:completion_writer_generation_mismatch")
        if app_ok and app_count:
            bound = source_values["maximum_latency_seconds"] + app_values["max_latency_ms"] / 1000
            if bound > limit:
                errors.append("completed_latency_upper_bound_exceeded")
        for name in ("maximum_pending_property_age_seconds", "maximum_pending_tile_age_seconds"):
            age = window.get(name)
            if type(age) not in (int, float) or not math.isfinite(age) or age < 0:
                errors.append(name + ":missing_evidence")
            elif source_values["maximum_latency_seconds"] + age > limit:
                errors.append(name + ":latency_upper_bound_exceeded")
    pending = window.get("maximum_pending_acquisition_age_seconds")
    if type(pending) not in (int, float) or not math.isfinite(pending) or pending < 0:
        errors.append("pending_acquisition:missing_evidence")
    elif pending > limit:
        errors.append("pending_acquisition:latency_upper_bound_exceeded")
    return {"passed": not errors, "scope": "completed_and_sampled_pending_freshness_only",
            "inventory_certified": False, "budget_certified": False, "interval_start": start, "interval_end": end,
            "latency_limit_seconds": limit, "measured_completed_upper_bound_seconds": bound,
            "source_acquisition_completions": source_count, "app_publications": app_count,
            "source": source, "app": app, "window": window, "errors": list(dict.fromkeys(errors))}


def audit_freshness(env_path, start, end, directory, output_dir, limit=900, manifest=None):
    start, end = audit_interval(start, end)
    if not math.isfinite(limit) or limit <= 0:
        raise ValueError("positive_finite_latency_limit_required")
    captured_at = utcnow()
    try:
        snapshots = [json.loads(p.read_text()) for p in sorted(Path(directory).glob("snapshot-*.json"))]
        window = audit_sample_window(snapshots, start, end, manifest)
    except Exception as exc:
        window = {"passed": False, "errors": ["snapshot_evidence:" + type(exc).__name__]}
    collected, secrets = {}, []
    try:
        env = parse_env(Path(env_path).read_text())
        secrets = [v for k, v in env.items() if SENSITIVE.search(k) and v]
        script = Path(__file__).read_text()
        for role in ("app", "scraper"):
            try:
                command = ssh_command(env, role)
                command[-1] = "python3 - --remote-audit " + role + " --audit-start " + start + " --audit-end " + end
                collected[role] = json.loads(run(command, timeout=45, input_text=script))
            except Exception as exc:
                collected[role] = {"status": "unavailable", "reason": type(exc).__name__}
    except Exception as exc:
        collected = {role: {"status": "unavailable", "reason": type(exc).__name__} for role in ("app", "scraper")}
    result = freshness_result(collected.get("scraper"), collected.get("app"), window, start, end, limit)
    result.update({"schema_version": 1, "captured_at": captured_at, "completed_at": utcnow()})
    result = sanitize(result, secrets)
    output = Path(output_dir)
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = output / ("freshness-audit-" + captured_at.replace(":", "").replace("-", "") + ".json")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump(result, handle, indent=2, allow_nan=False)
        handle.write("\n")
    return result, path


def reason_summary(value, path=""):
    reasons = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = path + "." + key if path else key
            if key.lower() in {"status", "operationalstatus", "reason", "reasoncode", "reasons", "blockedreason"} and not isinstance(child, dict):
                reasons.append(child_path + "=" + json.dumps(child, sort_keys=True))
            else:
                reasons.extend(reason_summary(child, child_path))
    elif isinstance(value, list):
        for child in value:
            reasons.extend(reason_summary(child, path + "[]"))
    return reasons


def release_identity(snapshot):
    """Ignore process/container identity; preserve running images, code and DB heads."""
    running = collections.defaultdict(list)
    migrations = {}
    for host in snapshot.get("hosts", {}).values():
        for container in host.get("containers", []):
            if container.get("running") is True:
                running[container["service"]].append({
                    "image_id": container.get("image_id"), "commit": container.get("commit")})
        for database, state in host.get("databases", {}).items():
            migrations[database] = sorted(state.get("migration_heads", []))
    identity = {"running_services": {service: sorted(images, key=lambda v: json.dumps(v, sort_keys=True))
                                     for service, images in running.items()}, "migration_heads": migrations}
    return hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def verify_window(snapshots, hours=24, max_gap_minutes=2, now=None, manifest=None, start=None, end=None):
    if start is not None or end is not None:
        if start is None or end is None:
            raise ValueError("start_and_end_must_be_paired")
        start, end = audit_interval(start, end, now=now)
        result = audit_sample_window(snapshots, start, end, manifest, max_gap_minutes=max_gap_minutes, now=now)
        elapsed = (timestamp(end) - timestamp(start)).total_seconds()
        result.update({"scope": "explicit_interval_observation_coverage_only", "interval_start": start, "interval_end": end,
                       "measured_interval_seconds": elapsed, "measured_interval_hours": elapsed / 3600,
                       "inventory_certified": False, "budget_certified": False})
        return result
    if not math.isfinite(hours) or hours < 24 or not math.isfinite(max_gap_minutes) or max_gap_minutes <= 0:
        raise ValueError("require_at_least_24_hours_and_positive_gap")
    if manifest is not None and not isinstance(manifest, dict):
        raise ValueError("manifest_object_required")
    now = now or dt.datetime.now(dt.timezone.utc)
    ordered, errors, reasons = [], [], collections.Counter()
    full_identities = []
    for index, snapshot in enumerate(snapshots):
        try:
            start = timestamp(snapshot["captured_at"])
            end = timestamp(snapshot["completed_at"])
            if start > end or end > now or (end - start).total_seconds() > max_gap_minutes * 60:
                errors.append(str(index) + ":invalid_capture_interval")
            for host in snapshot.get("hosts", {}).values():
                remote_start, remote_end = timestamp(host["captured_at"]), timestamp(host["completed_at"])
                # Permit a small clock skew; long captures and stale remote data fail.
                if remote_start < start - dt.timedelta(minutes=2) or remote_end > end + dt.timedelta(minutes=2) or remote_end < remote_start:
                    errors.append(str(index) + ":remote_clock_or_interval_mismatch")
            ordered.append((start, end))
            errors.extend(str(index) + ":" + error for error in snapshot_errors(snapshot, require_release=False))
            if manifest is not None:
                errors.extend(str(index) + ":" + error for error in required_metric_errors(
                    manifest.get("required_metrics", []), snapshot))
            if snapshot.get("sample_kind", "full") == "full":
                full_identities.append(release_identity(snapshot))
                if manifest is not None:
                    errors.extend(str(index) + ":" + error for error in verify_release(manifest, snapshot)["errors"])
            for host in snapshot.get("hosts", {}).values():
                reasons.update(reason_summary(host.get("endpoints", {})))
        except (KeyError, ValueError, TypeError):
            errors.append(str(index) + ":invalid_timestamp")
    ordered.sort()
    elapsed = (ordered[-1][0] - ordered[0][1]).total_seconds() / 3600 if len(ordered) >= 2 else 0
    if elapsed < hours:
        errors.append("insufficient_elapsed_observation")
    gaps = [(b[0] - a[0]).total_seconds() / 60 for a, b in zip(ordered, ordered[1:])]
    if any(gap <= 0 or gap > max_gap_minutes for gap in gaps):
        errors.append("duplicate_or_excessive_snapshot_gap")
    if len(set(full_identities)) > 1:
        errors.append("release_identity_changed")
    if snapshots:
        valid = sorted((s for s in snapshots if isinstance(s.get("captured_at"), str)), key=lambda s: s["captured_at"])
        if not valid or any(s.get("sample_kind", "full") != "full" for s in [valid[0], valid[-1]]):
            errors.append("full_start_and_end_snapshots_required")
    errors = list(dict.fromkeys(errors))
    return {"passed": not errors, "scope": "observation_coverage_only", "inventory_certified": False,
            "acceptance": "insufficient_evidence", "missing_acceptance_evidence": ["inventory_completeness_and_freshness_contract"],
            "snapshots": len(snapshots), "elapsed_hours": max(0, elapsed), "required_hours": hours,
            "full_snapshots": len(full_identities),
            "release_identity": full_identities[0] if len(set(full_identities)) == 1 else None,
            "largest_gap_minutes": max(gaps, default=0), "errors": errors,
            "status_reason_counts": dict(sorted(reasons.items()))}


def watch(env_path, output_dir, interval=60, duration_hours=None, full_every=60):
    """Persist each sample immediately. Scheduling uses a monotonic clock."""
    if not math.isfinite(interval) or interval <= 0 or full_every < 1:
        raise ValueError("invalid_watch_interval")
    if duration_hours is not None and (not math.isfinite(duration_hours) or duration_hours <= 0):
        raise ValueError("invalid_watch_duration")
    started = time.monotonic()
    deadline = started + duration_hours * 3600 if duration_hours is not None else None
    sequence, failed = 0, False
    try:
        while True:
            ending = deadline is not None and time.monotonic() >= deadline
            snapshot, path = capture(env_path, output_dir, light=not ending and sequence % full_every != 0)
            failed |= snapshot["status"] != "complete"
            print(json.dumps({"snapshot": str(path), "status": snapshot["status"], "sample_kind": snapshot["sample_kind"]}), flush=True)
            if sequence == 0 and duration_hours is not None:
                # Observe a full duration after the initial evidence is complete.
                deadline = time.monotonic() + duration_hours * 3600
            if ending:
                return 1 if failed else 0
            sequence += 1
            # Skip missed schedule slots rather than inventing backdated samples.
            target = started + sequence * interval
            if target < time.monotonic():
                sequence = int((time.monotonic() - started) // interval) + 1
                target = started + sequence * interval
            if deadline is not None:
                target = min(target, deadline)
            time.sleep(max(0, target - time.monotonic()))
    except KeyboardInterrupt:
        snapshot, path = capture(env_path, output_dir)
        print(json.dumps({"snapshot": str(path), "status": snapshot["status"], "watch": "interrupted"}), flush=True)
        return 130


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--remote", choices=["app", "scraper"], help=argparse.SUPPRESS)
    parser.add_argument("--remote-audit", choices=["app", "scraper"], help=argparse.SUPPRESS)
    parser.add_argument("--audit-start", help=argparse.SUPPRESS)
    parser.add_argument("--audit-end", help=argparse.SUPPRESS)
    parser.add_argument("--light", action="store_true", help=argparse.SUPPRESS)
    sub = parser.add_subparsers(dest="command")
    cap = sub.add_parser("capture", help="append a sanitized, read-only production snapshot")
    cap.add_argument("--env-file", default=DEFAULT_ENV)
    cap.add_argument("--output-dir", required=True)
    observer = sub.add_parser("watch", help="persist periodic snapshots; Ctrl-C records a final full sample")
    observer.add_argument("--env-file", default=DEFAULT_ENV)
    observer.add_argument("--output-dir", required=True)
    observer.add_argument("--interval", "--interval60", type=float, default=60, nargs="?", const=60)
    observer.add_argument("--duration-hours", type=float)
    observer.add_argument("--full-every", type=int, default=60, help="full image/migration sample every N observations")
    release = sub.add_parser("verify-release")
    release.add_argument("--manifest", required=True)
    release.add_argument("--snapshot", required=True)
    window = sub.add_parser("verify-window")
    window.add_argument("--directory", required=True)
    window.add_argument("--manifest", help="require manifest metrics in every sample and declared release in every full sample")
    window_interval = window.add_mutually_exclusive_group()
    window_interval.add_argument("--hours", "--hours24", type=float, default=24, nargs="?", const=24,
                                 help="legacy whole-directory elapsed duration; use paired start/end for exact release intervals")
    window_interval.add_argument("--start", help="inclusive UTC minute; requires end and full snapshots bracketing the interval")
    window.add_argument("--end", help="exclusive UTC minute, at least 24 hours after start and no later than now")
    window.add_argument("--max-gap-minutes", type=float, default=2)
    audit = sub.add_parser("audit-freshness", help="audit retained completions and pending samples in an explicit interval",
                           description="Run watch indefinitely. Use exactly the same UTC-minute start/end as verify-window, the source certificate, and ledger report. The interval must be at least 24 hours and may be extended until the useful paid span reaches 24 hours. Stop watch after end to record a final full snapshot. Full snapshots must bracket the interval; inventory and budget acceptance remain separate checks.")
    audit.add_argument("--start", required=True, help="inclusive UTC minute, e.g. 2026-09-14T00:00:00Z")
    audit.add_argument("--end", required=True, help="exclusive UTC minute, at least 24 hours after start and no later than now")
    audit.add_argument("--directory", required=True, help="minute snapshots including full snapshots bracketing the interval")
    audit.add_argument("--output-dir", required=True, help="private directory for a sanitized audit JSON artifact")
    audit.add_argument("--env-file", default=DEFAULT_ENV)
    audit.add_argument("--max-latency-seconds", type=float, default=900)
    audit.add_argument("--manifest", help="also verify the declared release and required metrics across the observation window")
    args = parser.parse_args(argv)
    try:
        if args.remote_audit:
            print(json.dumps(remote_audit(args.remote_audit, args.audit_start, args.audit_end), allow_nan=False))
            return 0
        if args.remote:
            print(json.dumps(remote_capture(args.remote, args.light), allow_nan=False))
            return 0  # Partial evidence is evaluated locally, not lost on SSH failure.
        if args.command == "watch":
            return watch(args.env_file, args.output_dir, args.interval, args.duration_hours, args.full_every)
        if args.command == "capture":
            result, path = capture(args.env_file, args.output_dir)
            print(json.dumps({"snapshot": str(path), "status": result["status"]}))
            return 0 if result["status"] == "complete" else 1
        if args.command == "audit-freshness":
            manifest = json.loads(Path(args.manifest).read_text()) if args.manifest else None
            result, path = audit_freshness(args.env_file, args.start, args.end, args.directory,
                                           args.output_dir, args.max_latency_seconds, manifest)
            print(json.dumps({"audit": str(path), "passed": result["passed"],
                              "measured_completed_upper_bound_seconds": result["measured_completed_upper_bound_seconds"]}))
            return 0 if result["passed"] else 1
        if args.command == "verify-release":
            result = verify_release(json.loads(Path(args.manifest).read_text()), json.loads(Path(args.snapshot).read_text()))
        elif args.command == "verify-window":
            if (args.start is None) != (args.end is None):
                raise ValueError("start_and_end_must_be_paired")
            paths = sorted(Path(args.directory).glob("snapshot-*.json"))
            manifest = json.loads(Path(args.manifest).read_text()) if args.manifest else None
            result = verify_window([json.loads(p.read_text()) for p in paths], args.hours, args.max_gap_minutes,
                                   manifest=manifest, start=args.start, end=args.end)
        else:
            parser.error("a subcommand is required")
        print(json.dumps(sanitize(result), indent=2, allow_nan=False))
        return 0 if result["passed"] else 1
    except Exception as exc:
        print(json.dumps({"passed": False, "error": type(exc).__name__}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
