# Production Deployment

Hetzner CPX42 (8 vCPU, 16GB, 240GB disk) -> Coolify PaaS ->
`docker-compose.prod.yml`.

Push to `main` triggers auto-deploy. Manual access is through the Coolify
dashboard at `http://94.130.105.129:8000`.

## Photon Planet DB

The `photon_data` Docker volume must be populated before Photon starts.

```bash
ssh root@94.130.105.129
cd /var/lib/docker/volumes/cop1e1822hijj6g3zmxhrs0k_photon-data/_data
wget -O - https://download1.graphhopper.com/public/photon-db-planet-1.0-latest.tar.bz2 | tar xjf -
```

Expected structure after extraction: `_data/photon_data/node_1/{config,data,modules,plugins}`.

## DB Seeding

Production PostgreSQL is only reachable through the Docker network. Seed via
dump/restore:

```bash
pg_dump -U huishype -d huishype -Fc > huishype.dump
scp huishype.dump root@94.130.105.129:/tmp/
docker cp /tmp/huishype.dump <postgres-container>:/tmp/
docker exec <postgres-container> pg_restore -U huishype -d huishype --clean --if-exists /tmp/huishype.dump
```

## Disk Sizing

CPX32 is too small. Photon plus PostgreSQL plus Docker overhead fits safely on
CPX42, and disk-full corruption requires a full Photon re-download.

## Gotchas

- Alpine healthchecks should use `127.0.0.1` when services bind IPv4 only.
- Coolify can drop proxy routing after deploys; the guarded watchdog in
  `tools/ops/` is the source of truth for the fix.
- The web build is the active production path. Use Vite build-time env names
  only.

## Env Vars (set in Coolify)

Required: `DB_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET`,
`VITE_API_URL`

Auth:

- `GOOGLE_CLIENT_ID` - `91432986388-5qlnvk7ab5kncff4j9prms4qnec10tiq.apps.googleusercontent.com`
- `RESEND_API_KEY` - Resend full-access key
- `EMAIL_FROM` - `HuisHype <noreply@huishype.nl>`
- `EMAIL_REPLY_TO` - `support@huishype.nl`
- `MAGIC_LINK_BASE_URL` - `https://huishype.nl/auth/callback`

Optional: `CORS_ORIGINS`

## API Keys

Stored in gitignored `.env.*` files in the repo root. See `AGENTS.md` for the
index.
