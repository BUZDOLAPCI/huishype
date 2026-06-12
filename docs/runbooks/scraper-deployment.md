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

| Item | Value |
|------|-------|
| Scraper VM | `huishype-scrapers-cx23-nbg1` |
| Hetzner server ID | `127989278` |
| Plan | `CX23` |
| Datacenter | `nbg1-dc3` |
| Public IPv4 | `178.104.119.167` |
| Private IPv4 | `10.42.0.2` |
| SSH user | `root` |
| Runtime root | `/opt/huishype-scrapers` |
| App/prod VM | `huishype-coolify-ubuntu-8gb-nbg1`, server ID `124870912` |
| App/prod private IPv4 | `10.42.0.10` |
| App/prod public IPv4 | `94.130.105.129` |
| Private network | `huishype-private`, ID `12161934`, range `10.42.0.0/16` |
| Scraper firewall | `huishype-scraper-vm`, ID `10889637` |

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

| Source | Local repo | VM path | Compose file | Private API |
|--------|------------|---------|--------------|-------------|
| Funda | `/home/caslan/dev/git_repos/hh/huishype-funda-scraper` | `/opt/huishype-scrapers/huishype-funda-scraper` | `docker-compose.prod.yml` | `http://10.42.0.2:8100` |
| Pararius | `/home/caslan/dev/git_repos/hh/huishype-pararius-scraper` | `/opt/huishype-scrapers/huishype-pararius-scraper` | `docker-compose.yml` | `http://10.42.0.2:8101` |

Expected containers:

- `huishype-funda-scraper-api-1`
- `huishype-funda-scraper-sync-1`
- `huishype-funda-scraper-scheduler-1`
- `huishype-funda-scraper-worker-1`
- `huishype-funda-scraper-postgres-1`
- `huishype-funda-scraper-redis-1`
- `huishype-pararius-scraper-api-1`
- `huishype-pararius-scraper-sync-1`
- `huishype-pararius-scraper-scheduler-1`
- `huishype-pararius-scraper-worker-1`
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
status should expose stale listing diagnostics including available stale count,
oldest available `last_seen_at`, refresh backlog/backoff counts, and recent
terminal transitions. If those fields are missing from the JSON response, fix
the Pararius scraper repo and then re-run this check.

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
REMOTE
```

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
REMOTE
```

## Deploy

The live VM runtime directories are not Git working trees. Source changes are
made in the local repos, committed and pushed there, then synced to the VM while
preserving each VM-local env file.

Funda:

```bash
rsync -az --delete \
  --exclude .git --exclude .venv --exclude .pytest_cache --exclude .ruff_cache \
  --exclude .env --exclude .env.production \
  /home/caslan/dev/git_repos/hh/huishype-funda-scraper/ \
  root@178.104.119.167:/opt/huishype-scrapers/huishype-funda-scraper/

ssh root@178.104.119.167 '
  cd /opt/huishype-scrapers/huishype-funda-scraper
  docker compose --env-file .env.production -f docker-compose.prod.yml build
  docker compose --env-file .env.production -f docker-compose.prod.yml up -d
  docker compose --env-file .env.production -f docker-compose.prod.yml ps
'
```

Pararius:

```bash
rsync -az --delete \
  --exclude .git --exclude .venv --exclude .pytest_cache --exclude .ruff_cache \
  --exclude .env \
  /home/caslan/dev/git_repos/hh/huishype-pararius-scraper/ \
  root@178.104.119.167:/opt/huishype-scrapers/huishype-pararius-scraper/

ssh root@178.104.119.167 '
  cd /opt/huishype-scrapers/huishype-pararius-scraper
  docker compose build
  docker compose up -d
  docker compose ps
'
```

After deploy, run the status, logs, queue, and main app ingest checks above.
