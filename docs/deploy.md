# Production Deployment

Hetzner CPX42 (8 vCPU, 16GB, 240GB disk) → Coolify PaaS → `docker-compose.prod.yml`.

Push to `main` triggers auto-deploy. Manual: Coolify dashboard at `http://94.130.105.129:8000`.

## Photon Planet DB (critical)

The `photon_data` Docker volume must be populated before Photon starts. **Use the 1.0 URL** — the old URL (`photon-db-latest.tar.bz2`) is Elasticsearch format and won't work with Photon 1.0.x (OpenSearch).

```bash
# SSH into server, extract directly into Docker volume (streaming — no double disk space needed)
ssh root@94.130.105.129
cd /var/lib/docker/volumes/cop1e1822hijj6g3zmxhrs0k_photon-data/_data

# CORRECT (OpenSearch, ~56GB compressed → ~88GB extracted)
wget -O - https://download1.graphhopper.com/public/photon-db-planet-1.0-latest.tar.bz2 | tar xjf -

# WRONG — do NOT use (Elasticsearch format, incompatible with Photon 1.0.x)
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

## Disk Sizing

CPX32 (150GB) is too small. Photon planet DB (~88GB) + PostgreSQL (~51GB) + Docker overhead exceeds it. **CPX42 (240GB) is the minimum.** Disk-full corrupts Photon's OpenSearch index irreparably — requires full re-download.

## Gotchas

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

**EXPO_PUBLIC_API_URL is build-time**: Baked into the JS bundle during `docker build`. Changing it requires a full redeploy, not just container restart. Coolify may show duplicate env vars (one with a value, one empty) — ensure the empty one doesn't override.

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

Required: `DB_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET`, `EXPO_PUBLIC_API_URL`

Auth:
- `GOOGLE_CLIENT_ID` — `91432986388-5qlnvk7ab5kncff4j9prms4qnec10tiq.apps.googleusercontent.com`
- `RESEND_API_KEY` — Resend full-access key (stored in `.env.resend`)
- `EMAIL_FROM` — `HuisHype <noreply@huishype.nl>`
- `EMAIL_REPLY_TO` — `support@huishype.nl`
- `MAGIC_LINK_BASE_URL` — `https://huishype.nl/auth/callback`

Optional: `CORS_ORIGINS`

Note: web is the first production deployment target, but native stays maintained in parity with web. Apple Sign-In remains disabled for now until the Apple Developer account and related production provisioning are in place.

## API Keys

Stored in gitignored `.env.*` files in repo root. See `AGENTS.md` for the index.
