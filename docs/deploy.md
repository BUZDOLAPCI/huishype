# Production Deployment

Hetzner CPX42 (8 vCPU, 16GB, 240GB disk) → Coolify PaaS → `docker-compose.prod.yml`.

Push to `main` triggers auto-deploy. Manual: Coolify dashboard at `http://94.130.105.129:8000`.

## Photon Europe DB (critical)

The `photon_data` Docker volume must be populated before Photon starts. Production uses the Europe regional dump, which matches the app's European scope and is much smaller than the planet dump. **Use the 1.0 database URL** — the old URL (`photon-db-latest.tar.bz2`) is Elasticsearch format and won't work with Photon 1.x (OpenSearch). The app container should run Photon **1.1.0 or newer** because `/api?countrycode=XX` was added after 1.0.1.

```bash
# SSH into server, extract directly into Docker volume (streaming — no double disk space needed)
ssh root@94.130.105.129
cd /var/lib/docker/volumes/cop1e1822hijj6g3zmxhrs0k_photon-data/_data

# CORRECT (OpenSearch Europe dump, ~29GB compressed → ~44GB extracted as of 2026-06-10)
wget -q -O - https://download1.graphhopper.com/public/europe/photon-db-europe-1.0-latest.tar.bz2 | tar xjf -

# Avoid the planet dump on the app VM unless storage has been resized or moved.
# It was ~56GB compressed → ~88GB extracted and contributed to root disk exhaustion.
# wget -q -O - https://download1.graphhopper.com/public/photon-db-planet-1.0-latest.tar.bz2 | tar xjf -

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

CPX32 (150GB) is too small for the app database plus generated tile cache. Production currently uses the Photon Europe dump (~44GB extracted as of 2026-06-10); the planet dump was ~88GB extracted and should not share the app root disk with PostgreSQL unless storage has been resized or moved. Disk-full can corrupt Photon's OpenSearch index irreparably and can prevent PostgreSQL crash recovery.

Root disk alerting should warn at 75% used and page at 85% used. Treat 90% used
as an incident: stop nonessential rebuild/import work, check `docker system df`,
PostgreSQL volume growth, Photon volume size, and `/ops/property-tile-pyramid`
relation sizes before restarting builders. Keep at least 40GB free before a full
property tile pyramid rebuild; the rebuild writes a candidate generation before
retention can reclaim old generations.

Photon must stay on the Europe dump for the current single-VM app stack. Do not
replace it with the planet dump unless Photon data has been moved off the root
disk or the server has been resized with enough additional headroom.

## Property Tile Pyramid Operations

The production stack precomputes the public default low-zoom property tile
pyramid. Normal listing, social, view, official valuation, ingest recovery, tile
miss, and operator requests all go through the durable build gate; do not run
ad-hoc SQL updates against `property_tile_pyramid_current` or promoted versions.

Operational endpoints:
```bash
curl -fsS https://api.huishype.nl/health
curl -fsS https://api.huishype.nl/health/property-tile-pyramid
curl -fsS -H "Authorization: Bearer <operator-token>" \
  https://api.huishype.nl/ops/property-tile-pyramid
```

Full rebuild cadence: schedule manual full rebuilds only after large imports,
schema/algorithm changes, or visible low-zoom parity issues. Routine production
changes should rely on mutation-triggered coalesced rebuilds plus the worker
recovery sweep. Avoid more than one full rebuild per day unless the previous run
has promoted and retention has completed.

Safety thresholds before starting or retrying a full rebuild:
- Root disk below 75% used and at least 40GB free.
- `/ops/property-tile-pyramid.guardrails.verdict` is `ok` and
  `hostObservationAgeMs` is fresh. In production, automatic and operator
  rebuild requests are blocked by hard guardrails unless
  `PROPERTY_TILE_PYRAMID_UNSAFE_BYPASS_HARD_GUARDRAILS=true` is explicitly set
  for an operator override.
- `/ops/property-tile-pyramid.activeBuildCount` is `0`.
- Retained generation count is small, normally current + previous + at most one
  queued/validated build. If `retainedGenerationCount` is above `4`, run
  retention first and wait for `lastRetentionResult.reason` to become
  `completed`.
- Generated relation sizes are reviewed. If
  `property_tile_pyramid_tiles`, `property_tile_pyramid_nodes`,
  `property_tile_pyramid_members`, or candidate source relations are growing
  unexpectedly, pause rebuilds and investigate before increasing limits.

Production maintenance/rebuild flow:
```bash
# 1. Confirm API is up and inspect pyramid state.
curl -fsS https://api.huishype.nl/health/property-tile-pyramid
curl -fsS -H "Authorization: Bearer <operator-token>" \
  https://api.huishype.nl/ops/property-tile-pyramid

# 2. Confirm root disk headroom on the host.
ssh root@94.130.105.129 'df -h / && docker system df'

# 2b. Confirm the host watchdog has written a fresh observation.
ssh root@94.130.105.129 systemctl status property-tile-guardrail-watchdog.timer
ssh root@94.130.105.129 journalctl -u property-tile-guardrail-watchdog.service -n 50 --no-pager

# 3. Run/allow worker retention if old generations are still retained.
# Retention runs daily at WORKER_PROPERTY_TILE_PYRAMID_RETENTION_UTC_MINUTE_OF_DAY
# and retries on later sweeps while it reports "draining".

# 4. Request a rebuild through the application/operator path, not direct SQL.
# If no operator route is available for the exact operation, use the worker
# recovery sweep and mutation watermarks rather than updating promoted pointers.
docker compose -f docker-compose.prod.yml logs -f worker api
```

### Property Tile Guardrail Watchdog

Production disk guardrails use both application-side database metrics and
host-side root filesystem observations. The host observation is written by a
systemd watchdog on the app VM:

- Repo source of truth:
  `tools/ops/property-tile-guardrail-watchdog.sh`,
  `tools/ops/property-tile-guardrail-watchdog.service`,
  `tools/ops/property-tile-guardrail-watchdog.timer`
- Install/sync command: `./tools/install-property-tile-guardrail-watchdog.sh`
- Server runtime paths:
  - `/usr/local/bin/property-tile-guardrail-watchdog.sh`
  - `/etc/systemd/system/property-tile-guardrail-watchdog.service`
  - `/etc/systemd/system/property-tile-guardrail-watchdog.timer`
  - `/etc/default/property-tile-guardrail-watchdog` - host-local config;
    created on first install and preserved on reruns
- Logs: `journalctl -u property-tile-guardrail-watchdog.service`

Behavior:
- Timer runs every minute.
- Writes the latest root filesystem and Docker volume sizes into
  `property_tile_pyramid_guardrail_observations`.
- Sends Resend email alerts to `support@huishype.nl` on warning/critical state
  changes and repeated critical states. Resend credentials are read from the
  running API container environment.
- Sends a recovery email when the state returns healthy.
- Does not start, stop, or restart app containers.

Verification:
```bash
./tools/install-property-tile-guardrail-watchdog.sh
ssh root@94.130.105.129 systemctl start property-tile-guardrail-watchdog.service
ssh root@94.130.105.129 journalctl -u property-tile-guardrail-watchdog.service -n 20 --no-pager
ssh root@94.130.105.129 systemctl enable --now property-tile-guardrail-watchdog.timer
```

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
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
`R2_PUBLIC_BASE_URL`, `INGEST_API_KEY`, `FUNDA_SOURCE_SERVICE_URL`, `FUNDA_SOURCE_SERVICE_API_KEY`,
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

Profile photo storage:
- `R2_ACCOUNT_ID` — Cloudflare account ID for the R2 S3-compatible endpoint.
- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` — R2 API token with object read/write access to the media bucket.
- `R2_BUCKET` — public media bucket used for user avatars.
- `R2_PUBLIC_BASE_URL` — public origin/CDN base URL for uploaded avatar objects.
- `PROFILE_PHOTO_MAX_SOURCE_BYTES` — optional source upload limit; default `5242880` (5 MB).
- `PROFILE_PHOTO_MAX_OUTPUT_BYTES` — optional processed avatar target limit; default `1048576` (1 MB).

Property tile pyramid:
- `PROPERTY_TILE_PYRAMID_LEASE_SECONDS` — production default `3600`. Full
  pyramid builds can run longer than the API default lease; API and worker must
  use the same value so build claims are not marked expired mid-build.
- `PROPERTY_TILE_PYRAMID_STATEMENT_TIMEOUT_MS` — production default `600000`.
  Large replacement builds can exceed the shorter development default; keep this
  value aligned between API and worker.
- `PROPERTY_TILE_PYRAMID_MAX_HEAP_MB`, `PROPERTY_TILE_PYRAMID_MAX_MEMBER_ROWS`,
  `PROPERTY_TILE_PYRAMID_MAX_WAL_BYTES_PER_CHUNK`, and
  `PROPERTY_TILE_PYRAMID_MAX_WAL_BYTES_PER_BUILD` are safety rails. Raise them
  only after checking disk headroom and `/ops/property-tile-pyramid` relation
  sizes/counts.
- `PROPERTY_TILE_PYRAMID_RETENTION_MAX_CHUNKS_PER_STEP` and
  `WORKER_PROPERTY_TILE_PYRAMID_RETENTION_UTC_MINUTE_OF_DAY` control cleanup
  cadence. Production default retention time is UTC minute `200` (03:20 UTC).
- `PROPERTY_TILE_PYRAMID_GUARDRAILS_ENABLED` defaults to `true` in production.
  Keep it enabled. It requires a fresh
  `property_tile_pyramid_guardrail_observations` row from the host watchdog.
- `PROPERTY_TILE_PYRAMID_GUARDRAIL_HOST_OBSERVATION_MAX_AGE_MS`,
  `PROPERTY_TILE_PYRAMID_GUARDRAIL_ROOT_MAX_USED_PERCENT`, and
  `PROPERTY_TILE_PYRAMID_GUARDRAIL_ROOT_MIN_FREE_BYTES` block full rebuilds
  when host disk observations are stale, root disk is at least 75% used, or
  root free space is below 40GiB.
- `PROPERTY_TILE_PYRAMID_GUARDRAIL_DB_MAX_BYTES`,
  `PROPERTY_TILE_PYRAMID_GUARDRAIL_GENERATED_MAX_BYTES`, and
  `PROPERTY_TILE_PYRAMID_GUARDRAIL_RETAINED_GENERATION_MAX` block full rebuilds
  when database/generated storage or retained generation counts exceed the
  configured hard caps.
- `PROPERTY_TILE_PYRAMID_UNSAFE_BYPASS_HARD_GUARDRAILS` defaults to `false`.
  Set it only for an explicit operator override after checking disk headroom.

Listing ingest/source services:
- `INGEST_API_KEY` — shared secret used by scraper callbacks and protected ingest routes.
- `FUNDA_SOURCE_SERVICE_URL` — private-network URL, currently `http://10.42.0.2:8100`.
- `FUNDA_SOURCE_SERVICE_API_KEY` — shared secret accepted by the Funda source service.
- `PARARIUS_SOURCE_SERVICE_URL` — private-network URL, currently `http://10.42.0.2:8101`.
- `PARARIUS_SOURCE_SERVICE_API_KEY` — shared secret accepted by the Pararius source service.

Note: web is the first production deployment target, but native stays maintained in parity with web. Apple Sign-In remains disabled for now until the Apple Developer account and related production provisioning are in place.

## API Keys

Stored in gitignored `.env.*` files in repo root. See `AGENTS.md` for the index.
