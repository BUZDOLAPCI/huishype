THIS FILE IS JUST FOR HUMAN USE - CODING AGENTS SHOULD IGNORE THIS FILE

Start in dev:

docker-compose up -d
pnpm install
pnpm dev

Seed database:

cd services/api && pnpm run db:seed              # Eindhoven area (~645K, ~2min)
cd services/api && pnpm run db:seed -- --full    # Full Netherlands (11.3M, ~45min)