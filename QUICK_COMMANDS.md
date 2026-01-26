THIS FILE IS JUST FOR HUMAN USE - CODING AGENTS SHOULD IGNORE THIS FILE

# Start in dev:
docker-compose up -d
pnpm install
pnpm dev

Seed database:
# Eindhoven area (~140K addresses, ~2min)
cd services/api && pnpm run db:seed

# Full Netherlands (~6.5M addresses, ~45min)
cd services/api && pnpm run db:seed -- --full

# Reset and re-seed (truncate properties, then seed fresh)
docker exec huishype-postgres psql -U huishype -d huishype -c "TRUNCATE TABLE properties CASCADE;" && cd services/api && pnpm run db:seed