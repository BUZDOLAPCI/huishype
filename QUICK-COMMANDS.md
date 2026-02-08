THIS FILE IS JUST FOR HUMAN USE - CODING AGENTS SHOULD IGNORE THIS FILE

# Database Reset (full rebuild from scratch, ~9 min)
cd services/api
pnpm run db:reset                    # drop + migrate + seed properties + seed listings
pnpm run db:reset -- --skip-extract  # reuse existing CSV (~9 min vs ~14 min)

# Individual seed steps
pnpm run db:migrate                  # create/update tables only
pnpm run db:seed                     # BAG properties (~9.6M, ~7.5 min)
pnpm run db:seed -- --skip-extract   # reuse existing CSV (skip ogr2ogr, saves ~5 min)
pnpm run db:seed-listings            # listings from funda+pararius mirrors (~144K, ~1.3 min)

# Seed flags
pnpm run db:seed -- --limit 10000    # insert only 10K properties (for quick testing)
pnpm run db:seed -- --skip-demolished # skip demolished/withdrawn properties
pnpm run db:seed -- --dry-run        # extract CSV only, don't touch DB
pnpm run db:seed-listings -- --source funda     # funda only
pnpm run db:seed-listings -- --source pararius  # pararius only
pnpm run db:seed-listings -- --dry-run          # don't modify DB

# Docker
docker compose up -d                 # start postgres + redis
docker compose down                  # stop
docker compose ps                    # status

# Verify DB
docker exec huishype-postgres psql -U huishype -d huishype -c "SELECT COUNT(*) FROM properties"
docker exec huishype-postgres psql -U huishype -d huishype -c "SELECT COUNT(*) FROM listings"
docker exec huishype-postgres psql -U huishype -d huishype -c "\di properties*"

# Drizzle Studio (visual DB browser)
cd services/api
pnpm run db:studio

# Tests
cd services/api
pnpm test

# Prerequisites (all three postgres containers must be running)
cd ../huishype-funda-scraper && docker compose up -d    # funda mirror on :5441
cd ../huishype-pararius-scraper && docker compose up -d # pararius mirror on :5442
