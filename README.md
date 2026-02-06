# HuisHype

Social real estate platform for the Netherlands. Browse properties on a map, guess prices, and discuss with the community.

## Quick Start

### Prerequisites
- Node.js 18+
- pnpm (`npm install -g pnpm`)
- Docker

### Setup

```bash
# Install dependencies
pnpm install

# Start database (Postgres + Redis)
docker compose up -d

# Seed the database with test data (500 Eindhoven properties)
pnpm --filter @huishype/api db:push
pnpm --filter @huishype/api db:seed

# Start the API server
pnpm --filter @huishype/api dev

# In another terminal, start the app
pnpm --filter @huishype/app dev
```

Open [http://localhost:8081](http://localhost:8081) for web, or use Expo Go for mobile.

## Project Structure

```
apps/app/           # Expo React Native app (iOS/Android/Web)
services/api/       # Fastify API server
packages/shared/    # Shared TypeScript types
packages/api-client/# API client
packages/mocks/     # MSW mock handlers
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all services |
| `pnpm build` | Build all packages |
| `pnpm test:unit` | Run unit tests |
| `pnpm test:e2e:web` | Run Playwright E2E tests |
| `pnpm typecheck` | TypeScript type checking |
| `docker compose up -d` | Start Postgres + Redis |
| `docker compose down` | Stop containers |

## Tech Stack

- **App**: React Native + Expo + NativeWind + TanStack Query
- **Maps**: MapLibre GL via @rnmapbox/maps
- **API**: Fastify + Drizzle ORM + OpenAPI
- **Database**: PostgreSQL + PostGIS
- **Cache**: Redis

## Environment Variables

Copy `.env.example` to `.env` in `services/api/`:

```
DATABASE_URL=postgresql://huishype:huishype_dev@localhost:5440/huishype
PORT=3100
```
