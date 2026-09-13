#!/usr/bin/env python3
"""Exercise actual production Compose startup gates using isolated cheap images.

The image substitution avoids building the product merely to verify Compose's
migration dependency semantics. This checks migration failure, success and
re-running an exited migration container; product migration SQL is tested by the
API's PostgreSQL integration suite.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import uuid


def run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, text=True, capture_output=True, **kwargs)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="redis:7-alpine")
    args = parser.parse_args()
    repository = Path(__file__).resolve().parents[2]
    env = os.environ.copy()
    required = (
        "DB_PASSWORD JWT_SECRET JWT_REFRESH_SECRET COOKIE_SECRET R2_ACCOUNT_ID "
        "R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET R2_PUBLIC_BASE_URL "
        "INGEST_API_KEY FUNDA_SOURCE_SERVICE_URL FUNDA_SOURCE_SERVICE_API_KEY "
        "PARARIUS_SOURCE_SERVICE_URL PARARIUS_SOURCE_SERVICE_API_KEY "
        "EXPO_PUBLIC_API_URL COOLIFY_RESOURCE_UUID"
    ).split()
    env.update({name: "migration-gate-validation" for name in required})
    rendered = run([
        "docker", "compose", "-f", str(repository / "docker-compose.prod.yml"),
        "config", "--format", "json",
    ], env=env)
    if rendered.returncode:
        raise SystemExit(rendered.stderr)
    source = json.loads(rendered.stdout)["services"]
    assert source["migrate"]["restart"] == "no"
    assert source["migrate"]["healthcheck"]["disable"] is True
    assert source["migrate"]["environment"]["RUN_MIGRATIONS"] == "true"
    assert source["migrate"]["command"] == [
        "node", "services/api/dist/scripts/reconcile-source-identities.js",
        "--source", "funda", "--execute", "--once",
    ]
    assert source["api"]["environment"]["RUN_MIGRATIONS"] == "false"
    assert source["migrate"]["build"] == source["api"]["build"]
    for role in ("api", "worker"):
        assert source[role]["depends_on"]["migrate"]["condition"] == "service_completed_successfully"
    assert source["web"]["depends_on"]["api"]["condition"] == "service_healthy"

    for outcome in (7, 0):
        project = f"hh-migration-gate-{uuid.uuid4().hex[:10]}"
        with tempfile.TemporaryDirectory(prefix=project) as directory:
            path = Path(directory) / "compose.json"
            services = {}
            for role in ("postgres", "redis", "migrate", "api", "worker", "web"):
                services[role] = {
                    "image": args.image,
                    "entrypoint": ["sh", "-ec"],
                    "command": [f"exit {outcome}" if role == "migrate" else "exec sleep 90"],
                    "restart": "no",
                    "stop_grace_period": "1s",
                    "depends_on": source[role].get("depends_on", {}),
                    "healthcheck": {"test": ["CMD", "true"], "interval": "1s", "timeout": "1s", "retries": 2},
                }
            services["migrate"]["healthcheck"] = {"disable": True}
            path.write_text(json.dumps({"services": services}))
            command = ["docker", "compose", "-p", project, "-f", str(path)]
            try:
                result = run(command + ["up", "-d", "api", "worker", "web"], timeout=45)
                inspected = run(command + ["ps", "--all", "--format", "json"], check=True)
                rows = [json.loads(line) for line in inspected.stdout.splitlines() if line]
                state = {row["Service"]: row for row in rows}
                if outcome:
                    assert result.returncode != 0, "failed migration must reject startup"
                    assert state["migrate"]["ExitCode"] == outcome
                    for role in ("api", "worker", "web"):
                        assert state.get(role, {}).get("State") != "running", f"{role} started after migration failed"
                else:
                    assert result.returncode == 0, result.stderr
                    assert state["migrate"]["ExitCode"] == 0
                    for role in ("api", "worker", "web"):
                        assert state[role]["State"] == "running"
                    container = state["migrate"]["ID"]
                    before = run(["docker", "inspect", "--format", "{{.State.StartedAt}}", container], check=True).stdout
                    rerun = run(command + ["up", "--no-deps", "migrate"], timeout=20)
                    assert rerun.returncode == 0, rerun.stderr
                    after = run(["docker", "inspect", "--format", "{{.State.StartedAt}}", container], check=True).stdout
                    assert before != after, "an exited migration must execute again when explicitly started"
                print(json.dumps({"migration_exit": outcome, "gate_passed": True}))
            finally:
                cleaned = run(command + ["down", "--volumes", "--remove-orphans"], timeout=30)
                if cleaned.returncode:
                    raise RuntimeError(f"isolated test cleanup failed: {cleaned.stderr}")


if __name__ == "__main__":
    main()
