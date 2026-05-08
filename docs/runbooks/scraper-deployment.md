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
ssh "${SCRAPER_VM_SSH_USER}@${SCRAPER_VM_PUBLIC_IP}" '
  cd /opt/huishype-scrapers/huishype-pararius-scraper
  set -a
  source .env
  set +a
  docker compose exec -T postgres psql -U scraper -d pararius_mirror -c "SELECT COUNT(*) FROM listings;"
  docker compose exec -T redis sh -c "REDISCLI_AUTH=\"$REDIS_PASSWORD\" redis-cli LLEN jobs:high"
  docker compose exec -T redis sh -c "REDISCLI_AUTH=\"$REDIS_PASSWORD\" redis-cli LLEN jobs:normal"
  docker compose exec -T redis sh -c "REDISCLI_AUTH=\"$REDIS_PASSWORD\" redis-cli LLEN jobs:low"
'
```

Main app ingest state:

```bash
ssh root@94.130.105.129 '
  postgres_container="$(docker ps --format "{{.Names}}" | grep -m1 postgres)"
  docker exec "$postgres_container" psql -U huishype -d huishype -c "
    SELECT source_name, status, verification_state, COUNT(*), MAX(updated_at)
    FROM canonical_listings
    WHERE source_name IN ('funda', 'pararius')
    GROUP BY source_name, status, verification_state
    ORDER BY source_name, status, verification_state;
  "
'
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
