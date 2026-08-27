# Scraper Deployment Runbook

This runbook is the source of truth for operating the production Funda and
Pararius scraper/source-service stacks. The scrapers run on a separate Hetzner
CX23 VM so scraper traffic and upstream rate behavior do not share the public
IP of the HuisHype app/prod VM.

## Secrets

Operator secrets are recorded in the gitignored root file:

```bash
/home/caslan/dev/git_repos/hh/huishype/.env.scraper-deploy
```

That file mirrors the deployment/API keys needed to operate the scraper VM and
records where the live runtime env files live on the VM. Do not commit it and do
not copy its values into tracked docs. The live stack secrets remain on the VM:

- Funda: `/opt/huishype-scrapers/huishype-funda-scraper/.env.production`
- Pararius: `/opt/huishype-scrapers/huishype-pararius-scraper/.env`

The app/prod Coolify env must use the scraper API keys from
`.env.scraper-deploy` as `FUNDA_SOURCE_SERVICE_API_KEY` and
`PARARIUS_SOURCE_SERVICE_API_KEY`, and must use the shared
`HUISHYPE_INGEST_API_KEY` value as `INGEST_API_KEY`.

## Current Infrastructure

| Item                  | Value                                                     |
| --------------------- | --------------------------------------------------------- |
| Scraper VM            | `huishype-scrapers-cx23-nbg1`                             |
| Hetzner server ID     | `127989278`                                               |
| Plan                  | `CX23`                                                    |
| Datacenter            | `nbg1-dc3`                                                |
| Public IPv4           | `178.104.119.167`                                         |
| Private IPv4          | `10.42.0.2`                                               |
| SSH user              | `root`                                                    |
| Runtime root          | `/opt/huishype-scrapers`                                  |
| App/prod VM           | `huishype-coolify-ubuntu-8gb-nbg1`, server ID `124870912` |
| App/prod private IPv4 | `10.42.0.10`                                              |
| App/prod public IPv4  | `94.130.105.129`                                          |
| Private network       | `huishype-private`, ID `12161934`, range `10.42.0.0/16`   |
| Scraper firewall      | `huishype-scraper-vm`, ID `10889637`                      |

The scraper firewall allows:

- TCP `22` from the operator workstation and app/prod public IP.
- TCP `8100-8101` only from `10.42.0.10/32`.
- ICMP from the operator workstation, app/prod public IP, and `10.42.0.0/16`.

The scraper VM also runs UFW with matching inbound restrictions for SSH and
source-service ports. When operator SSH access changes, keep the Hetzner
firewall and the VM-local UFW `22/tcp` allow list in sync.

No third-party outbound proxy is configured in the checked env files. Scraper
upstream egress currently leaves through `178.104.119.167`, not through the
HuisHype app/prod public IP.

## Services

| Source   | Local repo                                                | VM path                                            | Compose file              | Private API             |
| -------- | --------------------------------------------------------- | -------------------------------------------------- | ------------------------- | ----------------------- |
| Funda    | `/home/caslan/dev/git_repos/hh/huishype-funda-scraper`    | `/opt/huishype-scrapers/huishype-funda-scraper`    | `docker-compose.prod.yml` | `http://10.42.0.2:8100` |
| Pararius | `/home/caslan/dev/git_repos/hh/huishype-pararius-scraper` | `/opt/huishype-scrapers/huishype-pararius-scraper` | `docker-compose.yml`      | `http://10.42.0.2:8101` |

Expected containers:

- `huishype-funda-scraper-api-1`
- `huishype-funda-scraper-sync-1`
- `huishype-funda-scraper-scheduler-1`
- `huishype-funda-scraper-worker-1`
- `huishype-funda-scraper-candidates-1`
- `huishype-funda-scraper-probe-1`
- `huishype-funda-scraper-postgres-1`
- `huishype-funda-scraper-redis-1`
- `huishype-pararius-scraper-api-1`
- `huishype-pararius-scraper-sync-1`
- `huishype-pararius-scraper-scheduler-1`
- `huishype-pararius-scraper-worker-1`
- `huishype-pararius-scraper-candidates-1`
- `huishype-pararius-scraper-probe-1`
- `huishype-pararius-scraper-postgres-1`
- `huishype-pararius-scraper-redis-1`

## Status Checks

Load the operator env locally:

```bash
cd /home/caslan/dev/git_repos/hh/huishype
set -a
source .env.scraper-deploy
set +a
```

Check VM and containers:

```bash
ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" hostname
ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" 'docker ps --format "{{.Names}} {{.Status}} {{.Ports}}"'
```

Check source-service health from the app/prod VM path:

```bash
ssh root@94.130.105.129 'curl -fsS http://10.42.0.2:8100/health'
ssh root@94.130.105.129 'curl -fsS http://10.42.0.2:8101/api/v1/health'
```

Check authenticated source-service status:

```bash
ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" '
  set -a
  source /opt/huishype-scrapers/huishype-funda-scraper/.env.production
  set +a
  curl -fsS -H "Authorization: Bearer ${API_KEY}" "http://${SCRAPER_API_BIND_IP}:8100/api/v1/status"
'

ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" '
  set -a
  source /opt/huishype-scrapers/huishype-pararius-scraper/.env
  set +a
  curl -fsS -H "Authorization: Bearer ${API_KEY}" "http://${API_HOST_BIND}:8101/api/v1/status"
'
```

The `/api/v1/status` responses are owned by the individual scraper/source-service
repos, not by the HuisHype app API. The app API currently only consumes source
observations and exposes app health under `/health`; do not add a compatibility
breaking app route for scraper diagnostics here. The Pararius source-service
status must expose operator-visible throttle/refresh health fields:

Both status responses also expose `operationalStatus`, `services`, `freshness`,
`upstream.capabilities`, and priority-level `queue` counts. Treat top-level
`status=degraded` as authoritative when a producer heartbeat is missing, a
capability is open/recovering, or available mirror observations are stale. The
unauthenticated health routes remain shallow infrastructure liveness only.

- `upstream_throttle.active`
- `upstream_throttle.blocked`
- `upstream_throttle.cooling_down`
- `upstream_throttle.cooldown_until`
- `upstream_throttle.seconds_remaining`
- `upstream_throttle.consecutive_block_count`
- `upstream_throttle.total_block_count`
- `upstream_throttle.last_blocked_at`
- `upstream_throttle.last_success_at`
- `upstream_throttle.last_block_error`
- `available_stale_count`
- `oldest_available_last_seen_at`
- `refresh_backlog_count`
- `refresh_backoff_count`
- `refresh_leased_count`
- `recent_terminal_transitions`

Treat `upstream_throttle.cooling_down = true`, increasing
`upstream_throttle.consecutive_block_count`, increasing `refresh_backoff_count`,
a nonzero `refresh_backlog_count` that does not drain, or an old
`oldest_available_last_seen_at` as evidence that the Pararius mirror is being
throttled, blocked, or under-provisioned. If these fields are missing from the
JSON response, fix/deploy the Pararius scraper repo and then re-run this check;
do not add a HuisHype app API compatibility route for scraper diagnostics.

## Logs

```bash
ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" '
  cd /opt/huishype-scrapers/huishype-funda-scraper
  docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=200 scheduler worker sync api
'

ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" '
  cd /opt/huishype-scrapers/huishype-pararius-scraper
  docker compose logs --tail=200 scheduler worker sync api
'
```

## Queue And Data Checks

Funda:

```bash
ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" '
  cd /opt/huishype-scrapers/huishype-funda-scraper
  docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
    psql -U scraper -d funda_mirror -c "SELECT COUNT(*) FROM listings;"
  docker compose --env-file .env.production -f docker-compose.prod.yml exec -T redis \
    redis-cli LLEN jobs:high
  docker compose --env-file .env.production -f docker-compose.prod.yml exec -T redis \
    redis-cli LLEN jobs:normal
  docker compose --env-file .env.production -f docker-compose.prod.yml exec -T redis \
    redis-cli LLEN jobs:low
'
```

Pararius:

```bash
ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" bash -s <<'REMOTE'
  cd /opt/huishype-scrapers/huishype-pararius-scraper
  set -a
  source .env
  set +a
  docker compose exec -T postgres psql -U scraper -d pararius_mirror -c "SELECT COUNT(*) FROM listings;"
  docker compose exec -T redis sh -c "REDISCLI_AUTH=\"$REDIS_PASSWORD\" redis-cli LLEN jobs:high"
  docker compose exec -T redis sh -c "REDISCLI_AUTH=\"$REDIS_PASSWORD\" redis-cli LLEN jobs:normal"
  docker compose exec -T redis sh -c "REDISCLI_AUTH=\"$REDIS_PASSWORD\" redis-cli LLEN jobs:low"
  docker compose exec -T redis sh -c "REDISCLI_AUTH=\"$REDIS_PASSWORD\" redis-cli --scan --pattern \"*backoff*\""
  docker compose exec -T postgres psql -U scraper -d pararius_mirror <<'SQL'
    WITH listing_rows AS (
      SELECT to_jsonb(l) AS row_json
      FROM listings l
    )
    SELECT
      COUNT(*) FILTER (WHERE row_json->>'status' = 'available') AS available_count,
      MIN((row_json->>'last_seen_at')::timestamptz)
        FILTER (WHERE row_json->>'status' = 'available' AND row_json ? 'last_seen_at')
        AS oldest_available_last_seen_at,
      COUNT(*) FILTER (
        WHERE row_json->>'status' = 'available'
          AND row_json ? 'last_seen_at'
          AND (row_json->>'last_seen_at')::timestamptz < now() - interval '24 hours'
      ) AS stale_available_24h_count,
      COUNT(*) FILTER (WHERE row_json->>'status' IN ('rented', 'withdrawn', 'not_found')) AS terminal_count
    FROM listing_rows;
SQL
  docker compose exec -T postgres psql -U scraper -d pararius_mirror <<'SQL'
    SELECT to_jsonb(l) AS sentinel_5104ad06
    FROM listings l
    WHERE to_jsonb(l)::text ILIKE '%5104ad06%'
    LIMIT 5;
SQL
  docker compose exec -T postgres psql -U scraper -d pararius_mirror <<'SQL'
    SELECT
      id,
      pararius_id,
      listing_url,
      status,
      last_seen_at,
      last_changed_at,
      refresh_last_success_at,
      next_refresh_at,
      refresh_error_count,
      refresh_last_error,
      refresh_next_attempt_at,
      refresh_lease_expires_at
    FROM listings
    WHERE pararius_id = '5104ad06'
       OR listing_url ILIKE '%5104ad06%'
    ORDER BY last_changed_at DESC NULLS LAST, updated_at DESC NULLS LAST;
SQL
  docker compose exec -T postgres psql -U scraper -d pararius_mirror <<'SQL'
    SELECT
      h.id,
      h.change_type,
      h.old_value,
      h.new_value,
      h.recorded_at
    FROM listing_history h
    JOIN listings l ON l.id = h.listing_id
    WHERE l.pararius_id = '5104ad06'
       OR l.listing_url ILIKE '%5104ad06%'
    ORDER BY h.recorded_at DESC
    LIMIT 20;
SQL
REMOTE
```

Sentinel `5104ad06` audit criterion: the sentinel is healthy only when the
mirror has a row for that source ID/URL and the row has a fresh
`last_seen_at`, or a terminal `status` (`rented`, `withdrawn`, or `not_found`)
with a matching recent `listing_history` status change and `last_changed_at`.
If it remains `available` while `last_seen_at` is older than the configured
update interval and `refresh_backoff_count` is nonzero, treat the repair drain
as incomplete.

Main app ingest state:

```bash
ssh root@94.130.105.129 bash -s <<'REMOTE'
  postgres_container="$(docker ps --format "{{.Names}}" | grep -m1 postgres)"
  docker exec -i "$postgres_container" psql -U huishype -d huishype <<'SQL'
    SELECT source_name, status, verification_state, COUNT(*), MAX(updated_at)
    FROM canonical_listings
    WHERE source_name IN ('funda', 'pararius')
    GROUP BY source_name, status, verification_state
    ORDER BY source_name, status, verification_state;
SQL
  docker exec -i "$postgres_container" psql -U huishype -d huishype <<'SQL'
    SELECT
      COUNT(*) FILTER (WHERE status = 'active') AS active_pararius_count,
      MIN(last_mirror_seen_at) FILTER (WHERE status = 'active') AS oldest_active_last_mirror_seen_at,
      COUNT(*) FILTER (
        WHERE status = 'active'
          AND last_mirror_seen_at < now() - interval '24 hours'
      ) AS stale_active_24h_count
    FROM canonical_listings
    WHERE source_name = 'pararius'
      AND verification_state <> 'invalid';
SQL
  docker exec -i "$postgres_container" psql -U huishype -d huishype <<'SQL'
    SELECT source_status, COUNT(*), MAX(observed_at) AS latest_observed_at
    FROM listing_observations
    WHERE source_name = 'pararius'
      AND source_status IN ('rented', 'withdrawn', 'not_found')
      AND observed_at >= now() - interval '7 days'
      AND stale_for_projection = false
    GROUP BY source_status
    ORDER BY source_status;
SQL
  docker exec -i "$postgres_container" psql -U huishype -d huishype <<'SQL'
    SELECT
      source_name,
      primary_source_listing_id,
      canonical_url,
      status,
      status_source,
      verification_state,
      last_mirror_seen_at,
      updated_at
    FROM canonical_listings
    WHERE source_name = 'pararius'
      AND (
        primary_source_listing_id = '5104ad06'
        OR canonical_url ILIKE '%5104ad06%'
        OR display_url ILIKE '%5104ad06%'
      )
    ORDER BY updated_at DESC;
SQL
  docker exec -i "$postgres_container" psql -U huishype -d huishype <<'SQL'
    SELECT
      id,
      source_name,
      primary_source_listing_id,
      canonical_url,
      display_url,
      status,
      status_source,
      verification_state,
      last_mirror_seen_at,
      updated_at
    FROM canonical_listings
    WHERE id = 'fe190439-443e-49c1-a69c-026092f9055a';
SQL
  docker exec -i "$postgres_container" psql -U huishype -d huishype <<'SQL'
    SELECT
      id,
      canonical_listing_id,
      source_name,
      source_status,
      observed_at,
      stale_for_projection,
      source_url_raw,
      source_url_canonical
    FROM listing_observations
    WHERE canonical_listing_id = 'fe190439-443e-49c1-a69c-026092f9055a'
    ORDER BY observed_at DESC
    LIMIT 20;
SQL
REMOTE
```

Canonical listing `fe190439-443e-49c1-a69c-026092f9055a` verification
criterion: the canonical row should point at Pararius source identity
`5104ad06` in `primary_source_listing_id`, `canonical_url`, or `display_url`;
`status`, `status_source`, `verification_state`, and `last_mirror_seen_at` must
match the latest non-stale Pararius observation. A terminal mirror result should
be visible in `listing_observations` with `stale_for_projection = false` before
the canonical row is considered repaired.

## Pararius Repair Drain

Use this flow when Pararius available listings are stale or the source-service
status shows refresh backlog/backoff. These runtime knobs belong to the
Pararius scraper VM `.env`, not to the HuisHype app/prod environment.

1. Pause automatic expansion so repair work drains predictably:

```bash
ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" bash -s <<'REMOTE'
  cd /opt/huishype-scrapers/huishype-pararius-scraper
  cp .env ".env.backup.$(date -u +%Y%m%dT%H%M%SZ)"
  python3 - <<'PY'
from pathlib import Path

path = Path(".env")
lines = path.read_text().splitlines()
updates = {
    "BOOTSTRAP_MODE": "false",
    "REQUEST_DELAY_SECONDS": "8",
    "REQUEST_DELAY_JITTER_SECONDS": "8",
    "WORKER_CONCURRENCY": "1",
}
seen = set()
out = []
for line in lines:
    key = line.split("=", 1)[0] if "=" in line and not line.lstrip().startswith("#") else None
    if key in updates:
        out.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        out.append(line)
for key, value in updates.items():
    if key not in seen:
        out.append(f"{key}={value}")
path.write_text("\n".join(out) + "\n")
PY
  docker compose up -d scheduler worker sync api
REMOTE
```

`REQUEST_DELAY_SECONDS=8` and `REQUEST_DELAY_JITTER_SECONDS=8` are the safe
repair-drain target values. If the deployed Pararius scraper build does not yet
read `REQUEST_DELAY_JITTER_SECONDS`, keeping it in `.env` is harmless but it
will not affect behavior until the scraper repo supports that setting. Do not
increase worker concurrency while upstream throttle evidence is present.

2. Enqueue a controlled Eindhoven full-sync:

```bash
ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" bash -s <<'REMOTE'
  cd /opt/huishype-scrapers/huishype-pararius-scraper
  docker compose exec -T worker python - <<'PY'
from scraper.queue import create_full_sync_job

print(create_full_sync_job("eindhoven", priority="low"))
PY
REMOTE
```

Keep the scope to Eindhoven for the first repair pass. Do not enqueue all-city
or all-country full-sync work until `refresh_backlog_count`, queue lengths, and
terminal transitions show the Eindhoven drain completed without renewed
backoff.

3. Force-refresh the sentinel listing if the full-sync does not settle it:

```bash
ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" bash -s <<'REMOTE'
  set -a
  source /opt/huishype-scrapers/huishype-pararius-scraper/.env
  set +a
  curl -fsS -X POST \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "Content-Type: application/json" \
    "http://${API_HOST_BIND}:8101/api/v1/fetch" \
    -d '{"pararius_id":"5104ad06","listing_url":"https://www.pararius.com/apartment-for-rent/eindhoven/5104ad06","priority":"high"}'
REMOTE
```

4. Watch the drain:

```bash
ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" bash -s <<'REMOTE'
  cd /opt/huishype-scrapers/huishype-pararius-scraper
  docker compose logs --tail=200 -f worker sync api
REMOTE
```

Re-run the authenticated Pararius `/api/v1/status`, Pararius queue/data checks,
and main app ingest checks above. The repair is complete only when the sentinel
`5104ad06` and canonical listing `fe190439-443e-49c1-a69c-026092f9055a` meet
their criteria, queue lengths stop growing, `refresh_backoff_count` is stable or
falling, and the sync service has projected the newest mirror observation into
HuisHype.

## Pararius-Only VM/IP Migration Fallback

Use this only if Pararius remains throttled or blocked after the repair drain.
Do not move Funda unless Funda has independent upstream/IP evidence.

1. Provision a replacement Hetzner VM in the same private network
   (`huishype-private`) with UFW and Hetzner firewall rules equivalent to the
   current scraper VM, but expose only Pararius port `8101` to
   `10.42.0.10/32`.
2. Sync only `/opt/huishype-scrapers/huishype-pararius-scraper` and its
   `.env` to the new VM. Preserve secrets out of tracked docs. Keep
   `BOOTSTRAP_MODE=false`, `REQUEST_DELAY_SECONDS=8`,
   `REQUEST_DELAY_JITTER_SECONDS=8`, and `WORKER_CONCURRENCY=1` for the initial
   drain on the new IP.
3. Restore or migrate the Pararius Postgres volume before starting sync, or run
   a narrowly scoped Eindhoven full-sync first and treat the mirror as degraded
   until coverage is rebuilt.
4. Update app/prod Coolify `PARARIUS_SOURCE_SERVICE_URL` to the new private
   `http://<new-private-ip>:8101` value. Leave
   `FUNDA_SOURCE_SERVICE_URL=http://10.42.0.2:8100` unchanged.
5. Update `.env.scraper-deploy` locally with the new Pararius VM/IP facts, then
   update this runbook's Current Infrastructure and Services tables in a tracked
   commit. Do not commit actual API keys or VM-local `.env` contents.
6. Verify from the app/prod VM:

```bash
ssh root@94.130.105.129 'curl -fsS http://<new-private-ip>:8101/api/v1/health'
```

Then re-run the authenticated Pararius status checks and the main app ingest
checks above. Roll back by restoring the old `PARARIUS_SOURCE_SERVICE_URL` only
if the old VM still has healthier status/backlog behavior.

## Access-Circuit Recovery

The scrapers use persistent Redis circuits: Funda has separate `search` and
`detail` capabilities and Pararius has one `web` capability. Access blocks use
30-minute, 1-hour, 2-hour, 4-hour, 8-hour, then 24-hour cooldowns. When due,
only the `probe` container can obtain the Redis canary lease. Ten consecutive
successful probes are required before a capability becomes healthy. Never use
these controls to bypass App Check, CAPTCHA, Cloudflare, or another WAF.

Pause only upstream-producing Funda roles while preserving APIs, sync, queues,
Redis, Postgres, and mirror data:

```bash
cd /opt/huishype-scrapers/huishype-funda-scraper
docker compose --env-file .env.production -f docker-compose.prod.yml \
  stop scheduler worker candidates
```

Guard capabilities before a deploy or rollback, then start only API and sync.
Start the continuous probe after the explicit one-shot canary so it cannot race
the operator command:

```bash
# Funda
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm \
  probe python -m scraper.probe --guard all --reason deployment_guard
docker compose --env-file .env.production -f docker-compose.prod.yml \
  up -d api sync

# Pararius
docker compose run --rm probe python -m scraper.probe \
  --guard --reason deployment_guard
docker compose up -d api sync
```

Run one due canary manually. A command reporting `"attempted": false` means a
cooldown or another probe lease is active; do not force another request.

```bash
# Funda search and detail are independent
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm probe \
  python -m scraper.probe --once search
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm probe \
  python -m scraper.probe --once detail

# Pararius Eindhoven search canary
docker compose run --rm probe python -m scraper.probe --once

# Then start the continuous leased probe loops.
docker compose --env-file .env.production -f docker-compose.prod.yml up -d probe
docker compose up -d probe
```

Workers move blocked work to `jobs:deferred:<capability>` without consuming an
attempt or releasing a Funda scheduler uniqueness reservation. The probe loop
returns at most 25 deferred jobs per capability per minute after the circuit is
healthy. Inspect the sets without clearing them:

```bash
redis-cli ZCARD jobs:deferred:search
redis-cli ZCARD jobs:deferred:detail
redis-cli ZCARD jobs:deferred:web
redis-cli ZCARD jobs:failed:index
```

Funda retained access failures must always be previewed before execution. The
execute token binds the action to exactly the jobs shown by the dry run:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api \
  python manage_jobs.py recover-access --since 2026-08-20

# Copy DRY_RUN_TOKEN from the unchanged dry-run output.
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api \
  python manage_jobs.py recover-access --since 2026-08-20 \
  --execute --dry-run-token '<token>'
```

Filters can be narrowed with repeated `--type` arguments and `--error`. This
command only recovers classified 401/403/429, App Check, CAPTCHA, Cloudflare,
WAF, or access-denied failures and deduplicates by stable job signature. Every
retained match enters the seven-day failed index; only one job per signature is
deferred, and duplicates remain failed and visible in status. It never clears
or bulk-recreates a queue.

After the first canary has recorded circuit state, start the guarded producers
at concurrency one. An open or recovering circuit causes workers to defer jobs
without contacting the source; the scheduler does not advance its timestamps.
Funda's normal delay after recovery is five seconds; Pararius uses an
eight-second delay plus up to eight seconds of jitter:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  up -d scheduler worker candidates
docker compose up -d scheduler worker candidates
```

Before deploy, save `pg_dump -Fc --no-owner --no-acl` backups of both mirror
databases and tag the currently running image IDs. For rollback, guard all
capabilities, stop producers, retag the recorded `pre-recovery-*` images to the
compose image names, start API and sync, run the explicit one-shot canaries, and
only then start the continuous probe. Do not restore a database unless the
deployment changed data incompatibly. Return Funda deferred jobs to their
original priority queues in bounded batches. This also requires an exact dry-run
token and never releases more than 25 jobs per command:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api \
  python manage_jobs.py release-deferred --capability search --limit 25

# Copy DRY_RUN_TOKEN from the unchanged dry-run output.
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api \
  python manage_jobs.py release-deferred --capability search --limit 25 \
  --execute --dry-run-token '<token>'
```

Repeat for `detail` only when the prior batch is safely queued. Retained failed
access jobs still use `recover-access`; its execute mode moves them to the
deferred set rather than directly flooding a priority queue.

## Deploy

The live VM runtime directories are not Git working trees. Source changes are
made in the local repos, committed and pushed there, then synced to the VM while
preserving each VM-local env file.

Funda:

```bash
set -a
source /home/caslan/dev/git_repos/hh/huishype/.env.scraper-deploy
set +a

rsync -az --delete \
  -e "ssh -J root@${APP_VM_PUBLIC_IP}" \
  --exclude .git --exclude .venv --exclude .pytest_cache --exclude .ruff_cache \
  --exclude .env --exclude .env.production \
  /home/caslan/dev/git_repos/hh/huishype-funda-scraper/ \
  "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}:/opt/huishype-scrapers/huishype-funda-scraper/"

ssh -J "root@${APP_VM_PUBLIC_IP}" "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" '
  cd /opt/huishype-scrapers/huishype-funda-scraper
  docker compose --env-file .env.production -f docker-compose.prod.yml build
  docker compose --env-file .env.production -f docker-compose.prod.yml up -d
  docker compose --env-file .env.production -f docker-compose.prod.yml ps
'
```

Pararius:

```bash
set -a
source /home/caslan/dev/git_repos/hh/huishype/.env.scraper-deploy
set +a

rsync -az --delete \
  -e "ssh -J root@${APP_VM_PUBLIC_IP}" \
  --exclude .git --exclude .venv --exclude .pytest_cache --exclude .ruff_cache \
  --exclude .env \
  /home/caslan/dev/git_repos/hh/huishype-pararius-scraper/ \
  "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}:/opt/huishype-scrapers/huishype-pararius-scraper/"

ssh -J "root@${APP_VM_PUBLIC_IP}" "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" '
  cd /opt/huishype-scrapers/huishype-pararius-scraper
  docker compose build
  docker compose up -d
  docker compose ps
'
```

After deploy, run the status, logs, queue, and main app ingest checks above.
