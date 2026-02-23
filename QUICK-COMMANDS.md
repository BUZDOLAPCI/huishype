THIS FILE IS JUST FOR HUMAN USE - CODING AGENTS SHOULD IGNORE THIS FILE

# Dev Environment

# Start everything (Docker + API + Metro for Android device)
./tools/dev-android.sh

# Start services only
docker compose up -d
pnpm install
pnpm dev

# ADB port forwarding (re-run after USB reconnect)
adb reverse tcp:8081 tcp:8081 && adb reverse tcp:3100 tcp:3100

# Build & install on device
cd apps/app && npx expo run:android

# Web dev
cd apps/app && npx expo start --web

# Database

# Full reset (drop + migrate + seed properties + seed listings) — ~9 min
pnpm -C services/api run db:reset
pnpm -C services/api run db:reset -- --skip-extract  # reuse existing CSV (~9 min vs ~14 min)

# Individual steps
pnpm -C services/api run db:migrate                   # create/update tables only
pnpm -C services/api run db:seed                      # BAG properties (~9.6M, ~7.5 min)
pnpm -C services/api run db:seed -- --skip-extract    # reuse existing CSV (skip ogr2ogr)
pnpm -C services/api run db:seed-listings             # listings from funda+pararius (~144K, ~1.3 min)
pnpm -C services/api run db:seed-test-fixture         # Beeldbuisring 41 fixture

# Seed flags
pnpm -C services/api run db:seed -- --limit 10000     # insert only 10K (quick testing)
pnpm -C services/api run db:seed -- --skip-demolished  # skip demolished/withdrawn
pnpm -C services/api run db:seed -- --dry-run          # extract CSV only, don't touch DB
pnpm -C services/api run db:seed-listings -- --source funda
pnpm -C services/api run db:seed-listings -- --source pararius
pnpm -C services/api run db:seed-listings -- --dry-run

# Verify DB
docker exec huishype-postgres psql -U huishype -d huishype -c "SELECT COUNT(*) FROM properties"
docker exec huishype-postgres psql -U huishype -d huishype -c "SELECT COUNT(*) FROM listings"
docker exec huishype-postgres psql -U huishype -d huishype -c "\di properties*"

# Drizzle Studio (visual DB browser)
pnpm -C services/api run db:studio

# Prerequisites for listing seed (mirror DBs must be running)
cd ../huishype-funda-scraper && docker compose up -d    # funda mirror on :5441
cd ../huishype-pararius-scraper && docker compose up -d # pararius mirror on :5442

# Tests

# Unit tests
pnpm -C apps/app test                # app unit tests
pnpm -C services/api test            # API tests

# TypeScript check
pnpm -C apps/app typecheck

# Playwright (web e2e)
pnpm -C apps/app exec playwright test --project=visual
pnpm -C apps/app exec playwright test --project=integration
pnpm -C apps/app exec playwright test --project=flows

# Maestro (mobile e2e)
maestro test apps/app/e2e/mobile/full-flow.yaml

# Pre-commit checks (run before every commit)
pnpm -C apps/app typecheck && pnpm -C apps/app test

# MapLibre Fork (BUZDOLAPCI/maplibre-react-native, branch: huishype)

# Sync fork with latest upstream beta (one command)
./tools/sync-maplibre-fork.sh

# Manual sync (step by step)
cd ../maplibre-react-native
git fetch upstream --tags
git merge upstream/beta
yarn && npx bob build
git add -A && git commit -m "chore: sync upstream beta"
git push origin huishype
# Then update commit hash in apps/app/package.json and pnpm install

# Docker

# Start services
docker compose up -d

# Stop services
docker compose down

# Status
docker compose ps

# Logs
docker compose logs -f              # all
docker compose logs -f postgres     # postgres only
