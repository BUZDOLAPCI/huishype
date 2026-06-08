# Production Deployment

Hetzner CPX42 (8 vCPU, 16GB, 240GB disk) → Coolify PaaS → `docker-compose.prod.yml`.

Push to `main` triggers auto-deploy. Manual: Coolify dashboard at `http://94.130.105.129:8000`.

## Photon Planet DB (critical)

The `photon_data` Docker volume must be populated before Photon starts. **Use the 1.0 database URL** — the old URL (`photon-db-latest.tar.bz2`) is Elasticsearch format and won't work with Photon 1.x (OpenSearch). The app container should run Photon **1.1.0 or newer** because `/api?countrycode=XX` was added after 1.0.1.

```bash
# SSH into server, extract directly into Docker volume (streaming — no double disk space needed)
ssh root@94.130.105.129
cd /var/lib/docker/volumes/cop1e1822hijj6g3zmxhrs0k_photon-data/_data

# CORRECT (OpenSearch, ~56GB compressed → ~88GB extracted)
wget -O - https://download1.graphhopper.com/public/photon-db-planet-1.0-latest.tar.bz2 | tar xjf -

# WRONG — do NOT use (Elasticsearch format, incompatible with Photon 1.x)
# wget -O - https://download1.graphhopper.com/public/photon-db-latest.tar.bz2 | tar xjf -
```

Expected structure after extraction: `_data/photon_data/node_1/{config,data,modules,plugins}`.

## DB Seeding

No direct access to production PostgreSQL (internal Docker network). Seed via dump/restore:

```bash
# Local: dump
pg_dump -U huishype -d huishype -Fc > huishype.dump

# Transfer
scp huishype.dump root@94.130.105.129:/tmp/

# Remote: find container and restore
docker cp /tmp/huishype.dump <postgres-container>:/tmp/
docker exec <postgres-container> pg_restore -U huishype -d huishype --clean --if-exists /tmp/huishype.dump
```

## Listing Source Services

Production listing resolution and validation depend on separate scraper/source
services running on a dedicated Hetzner scraper VM. The app/prod VM should call
the scraper VM over a Hetzner private network:

- Funda source service: `http://10.42.0.2:8100`
- Pararius source service: `http://10.42.0.2:8101`
- `FUNDA_SOURCE_SERVICE_API_KEY` and `PARARIUS_SOURCE_SERVICE_API_KEY` are
  shared secrets accepted by those source services.
- `INGEST_API_KEY` is the shared secret for scraper callbacks and protected
  ingest endpoints exposed by the main API.

Keep PostgreSQL and Redis private to the app/prod VM Docker network. Do not
expose DB or Redis ports publicly for scraper access; scrapers communicate with
the main API through authenticated HTTP contracts.

Current infrastructure: the app/prod VM is `10.42.0.10` on Hetzner private
network `huishype-private`; the scraper VM is `10.42.0.2`. The scraper VM
firewall allows source-service API ports `8100` and `8101` only from
`10.42.0.10`.

Operational details, live VM paths, service names, health checks, queue checks,
and deploy commands are tracked in
[`docs/runbooks/scraper-deployment.md`](runbooks/scraper-deployment.md). Scraper
deployment/operator secrets are stored in the gitignored root file
`.env.scraper-deploy`.

## Disk Sizing

CPX32 (150GB) is too small. Photon planet DB (~88GB) + PostgreSQL (~51GB) + Docker overhead exceeds it. **CPX42 (240GB) is the minimum.** Disk-full corrupts Photon's OpenSearch index irreparably — requires full re-download.

## Gotchas

**Postgres shared memory for tile queries**: Production Postgres sets
`shm_size: "1gb"` in `docker-compose.prod.yml` so PostGIS parallel tile queries
have enough Docker `/dev/shm` headroom. Do not work around shared-memory
outages by disabling Postgres parallelism; the intended production architecture
keeps parallel query execution enabled and gives the database container enough
shared memory.

**Alpine IPv6 healthchecks**: Alpine resolves `localhost` to `::1` but services bind `0.0.0.0` (IPv4). Healthchecks must use `127.0.0.1`. Exception: Photon's JRE image handles both (healthcheck uses `localhost`).

**Traefik routing loss after deploys**: Coolify recreates containers on each deploy. Traefik can miss the replacement containers, which causes public gateway failures while the app containers themselves remain healthy.

The production fix is a guarded systemd watchdog:
- Repo source of truth: `tools/ops/traefik-watchdog.sh`, `tools/ops/traefik-watchdog.service`, `tools/ops/traefik-watchdog.timer`
- Install/sync command: `./tools/install-traefik-watchdog.sh`
- Server runtime paths:
  - `/usr/local/bin/traefik-watchdog.sh`
  - `/etc/systemd/system/traefik-watchdog.service`
  - `/etc/systemd/system/traefik-watchdog.timer`
  - `/etc/default/traefik-watchdog` - host-local config; created on first install and preserved on reruns
- Logs: `journalctl -u traefik-watchdog.service`

Behavior:
- Timer runs every 30s
- Requires 3 consecutive public failures before acting
- Checks both public routing and container-local health before recovery
- Reconnects `coolify-proxy` to the app network if needed
- Restarts `coolify-proxy` only if routing is still broken after the network repair
- Never restarts `web` or `api`; if app health is bad, the watchdog logs and exits without touching them
- Uses a 5-minute cooldown after recovery to avoid proxy restart loops

Verification:
```bash
ssh root@94.130.105.129 systemctl status traefik-watchdog.timer
ssh root@94.130.105.129 journalctl -u traefik-watchdog.service -n 50 --no-pager
curl -fsS https://huishype.nl/
curl -fsS https://api.huishype.nl/health
```

Manual fix if the watchdog isn't running:
```bash
docker network connect cop1e1822hijj6g3zmxhrs0k coolify-proxy 2>/dev/null || true
docker restart coolify-proxy
```

If the app-local health checks fail, fix `web` / `api` first and do not use the watchdog or proxy restart as a substitute.

Watchdog admin:
```bash
# Fresh host: seed config explicitly, then install.
APP_LABEL=coolify.applicationId=1 APP_NETWORK=cop1e1822hijj6g3zmxhrs0k \
PROXY_CONTAINER=coolify-proxy WEB_PUBLIC_URL=https://huishype.nl/ \
API_PUBLIC_URL=https://api.huishype.nl/health WEB_INTERNAL_URL=http://127.0.0.1:80/ \
API_INTERNAL_URL=http://127.0.0.1:3100/health ./tools/install-traefik-watchdog.sh

# Rerun on the same host: preserves /etc/default/traefik-watchdog if it already exists.
./tools/install-traefik-watchdog.sh

# Dry run once
ssh root@94.130.105.129 systemctl start traefik-watchdog.service
ssh root@94.130.105.129 journalctl -u traefik-watchdog.service -n 20 --no-pager

# Enable the timer
ssh root@94.130.105.129 systemctl enable --now traefik-watchdog.timer
```

**EXPO_PUBLIC_API_URL and EXPO_PUBLIC_GA4_MEASUREMENT_ID are build-time**: Baked into the JS bundle during `docker build`. Changing either requires a full redeploy, not just container restart. Coolify may show duplicate env vars (one with a value, one empty) — ensure the empty one doesn't override.

**Hetzner server resize**: Must power off first. Disk upgrades are irreversible.
```bash
# Via Hetzner API (token in .env.hetzner)
curl -X POST "https://api.hetzner.cloud/v1/servers/124870912/actions/poweroff" -H "Authorization: Bearer $HETZNER_API_TOKEN"
# Wait for poweroff, then:
curl -X POST "https://api.hetzner.cloud/v1/servers/124870912/actions/change_type" \
  -H "Authorization: Bearer $HETZNER_API_TOKEN" \
  -d '{"server_type":"cpx42","upgrade_disk":true}'
```

## Env Vars (set in Coolify)

Required: `DB_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET`, `EXPO_PUBLIC_API_URL`,
`INGEST_API_KEY`, `FUNDA_SOURCE_SERVICE_URL`, `FUNDA_SOURCE_SERVICE_API_KEY`,
`PARARIUS_SOURCE_SERVICE_URL`, `PARARIUS_SOURCE_SERVICE_API_KEY`

Auth:
- `GOOGLE_CLIENT_ID` — `91432986388-5qlnvk7ab5kncff4j9prms4qnec10tiq.apps.googleusercontent.com`
- `RESEND_API_KEY` — Resend full-access key (stored in `.env.resend`)
- `EMAIL_FROM` — `HuisHype <noreply@huishype.nl>`
- `EMAIL_REPLY_TO` — `support@huishype.nl`
- `MAGIC_LINK_BASE_URL` — `https://huishype.nl/auth/callback`

Optional: `CORS_ORIGINS`

Web analytics:
- `EXPO_PUBLIC_GA4_MEASUREMENT_ID` — optional GA4 web stream ID. If unset, analytics stays disabled and no Google Analytics script is loaded.

Property tile pyramid:
- `PROPERTY_TILE_PYRAMID_LEASE_SECONDS` — production default `3600`. Full
  pyramid builds can run longer than the API default lease; API and worker must
  use the same value so build claims are not marked expired mid-build.
- `PROPERTY_TILE_PYRAMID_STATEMENT_TIMEOUT_MS` — production default `600000`.
  Large replacement builds can exceed the shorter development default; keep this
  value aligned between API and worker.

Listing ingest/source services:
- `INGEST_API_KEY` — shared secret used by scraper callbacks and protected ingest routes.
- `FUNDA_SOURCE_SERVICE_URL` — private-network URL, currently `http://10.42.0.2:8100`.
- `FUNDA_SOURCE_SERVICE_API_KEY` — shared secret accepted by the Funda source service.
- `PARARIUS_SOURCE_SERVICE_URL` — private-network URL, currently `http://10.42.0.2:8101`.
- `PARARIUS_SOURCE_SERVICE_API_KEY` — shared secret accepted by the Pararius source service.

Note: web is the first production deployment target, but native stays maintained in parity with web. Apple Sign-In remains disabled for now until the Apple Developer account and related production provisioning are in place.

## API Keys

Stored in gitignored `.env.*` files in repo root. See `AGENTS.md` for the index.
