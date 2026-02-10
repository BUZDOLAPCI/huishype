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

# Set up the database (migrate schema + seed properties and listings)
pnpm --filter @huishype/api db:migrate
pnpm --filter @huishype/api db:seed
pnpm --filter @huishype/api db:seed-listings

# Or do a full reset (drop DB, migrate, seed everything):
# pnpm --filter @huishype/api db:reset

# Start the API server (runs on port 3100)
pnpm --filter @huishype/api dev

# In another terminal, start the app (Expo web dev server on port 8081)
pnpm --filter @huishype/app dev
```

Open [http://localhost:8081](http://localhost:8081) for web, or use Expo Go for mobile.

> **Note:** The API runs on port **3100** (non-default) and the Expo web dev server on port **8081**. See `services/api/.env.example` for configuration.

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
- **Maps**: MapLibre GL via @maplibre/maplibre-react-native
- **API**: Fastify + Drizzle ORM + OpenAPI
- **Database**: PostgreSQL + PostGIS
- **Cache**: Redis

## Environment Variables

Copy `.env.example` to `.env` in `services/api/`:

```
DATABASE_URL=postgresql://huishype:huishype_dev@localhost:5440/huishype
PORT=3100
```
