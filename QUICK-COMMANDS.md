## Web-First Quick Commands

This file is for human use. The active workflow is web-first; native handoff
details live only in `apps/android/README.md` and `apps/ios/README.md`.

## Setup

```bash
pnpm install
docker compose up -d
```

## API / Worker

```bash
pnpm --filter @huishype/api dev
pnpm --filter @huishype/worker dev

systemctl --user restart huishype-api
journalctl --user -u huishype-api -f
docker logs huishype-photon -f
docker logs huishype-worker -f
```

## Database

```bash
pnpm -C services/api run db:reset
pnpm -C services/api run db:reset -- --skip-extract
pnpm -C services/api run db:migrate
pnpm -C services/api run db:seed
pnpm -C services/api run db:seed -- --skip-extract
pnpm -C services/api run db:seed-listings
pnpm -C services/api run db:seed-test-fixture
pnpm -C services/api run db:seed-overture -- --country NL
pnpm -C services/api run db:import-buildings -- --country NL

docker exec huishype-postgres psql -U huishype -d huishype -c "SELECT COUNT(*) FROM properties"
docker exec huishype-postgres psql -U huishype -d huishype -c "SELECT COUNT(*) FROM listings"
pnpm -C services/api run db:studio
```

## Verification

```bash
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:e2e:web
pnpm test:e2e:integration
pnpm test:e2e:flows
pnpm test:e2e:visual
pnpm build
```

## Docker

```bash
docker compose up -d
docker compose --profile worker up -d worker
docker compose down
docker compose ps
docker compose logs -f
docker compose logs -f postgres
```

## MapLibre GL JS Fork

```bash
./tools/sync-maplibre-gl-fork.sh

cd /home/caslan/dev/git_repos/hh/maplibre-gl-js
npm run generate-shaders
npm run build-dist
```

The active product workflow is web-only. Do not use archived native
regeneration or retired mobile commands from older docs.
