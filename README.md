# HuisHype

Social real estate platform. Browse properties on a map, guess prices, and discuss with the community.

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

# Start the background worker explicitly if you need ingest, maintenance
# refreshes, or any queue-backed processing locally
# docker compose --profile worker up -d worker

# Set up the database (migrate schema + seed properties and listings)
pnpm --filter @huishype/api db:migrate
pnpm --filter @huishype/api db:seed
pnpm --filter @huishype/api db:seed-listings

# Or do a full reset (drop DB, migrate, seed everything):
# pnpm --filter @huishype/api db:reset

# Start the API server (runs on port 3100)
pnpm --filter @huishype/api dev

# In another terminal, start the app web dev server on port 8081
pnpm --filter @huishype/app web
```

Open [http://localhost:8081](http://localhost:8081) for web.

### Web Workflow

Run the app's Expo web server directly from the app package:

```bash
pnpm -C apps/app web
```

This serves the web app through Expo/Metro on port `8081`.

### Native Workflow

Native runs through the generated Android/iOS projects plus a few required local override points. `apps/app/app.json` is the Expo config source of truth; `apps/app/android/` and `apps/app/ios/` are generated, gitignored output.

If the native folders are missing, stale, or you changed Expo config/plugin wiring, regenerate them and then re-apply the documented override points from `apps/app/README.md`:

```bash
pnpm -C apps/app exec expo prebuild --clean
pnpm -C apps/app android
pnpm -C apps/app ios
```

`apps/app/README.md` is the canonical workflow doc for native regeneration, local MapLibre AAR wiring, iOS URL-scheme wiring, and gitignored credential placement.

> **Note:** The API runs on port **3100** (non-default) and the Expo web dev server on port **8081**. See `services/api/.env.example` for configuration.

## Project Structure

```text
apps/app/           # Expo React Native app (iOS/Android/Web)
services/api/       # Fastify API server
services/worker/    # Background worker runtime for BullMQ ingest and maintenance jobs
packages/shared/    # Shared TypeScript types
packages/api-client/ # Generated API client
packages/mocks/     # MSW mock handlers
```

## Commands

Unit-test runners are mixed by workspace: `apps/app` and `services/api` use Jest, `services/worker` uses `node --test`, and `packages/shared`, `packages/api-client`, and `packages/mocks` use Vitest.

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run workspace `dev` scripts via Turborepo |
| `pnpm build` | Build all packages |
| `pnpm test` | Canonical merge gate: lint + typecheck + unit (app + API + worker + shared + api-client + mocks) + API integration + Playwright harness self-tests + Playwright integration |
| `pnpm test:all` | Broader superset: `pnpm test` plus Playwright flows, Playwright visual, and mobile E2E |
| `pnpm test:unit` | Run unit tests for app, API, worker, shared, api-client, and mocks |
| `pnpm test:integration` | Run API integration tests |
| `pnpm test:e2e:harness` | Run the Playwright wrapper self-tests under `scripts/playwright/*.test.mjs` |
| `pnpm test:e2e:web` | Run the full root Playwright suite via `scripts/playwright/run-playwright-project.mjs` |
| `pnpm test:e2e:integration` | Run the Playwright integration project |
| `pnpm test:e2e:flows` | Run the Playwright flows project |
| `pnpm test:e2e:visual` | Run the Playwright visual project |
| `pnpm test:e2e:mobile` | Run the mobile wrapper at `scripts/visual-overhaul/run-mobile-e2e.mjs` |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm -C apps/app web` | Start the Expo web dev server |
| `pnpm -C apps/app android` | Build and run the native Android app |
| `pnpm -C apps/app ios` | Build and run the native iOS app |
| `pnpm --filter @huishype/worker dev` | Run the worker directly in watch mode from the monorepo root |
| `docker compose up -d` | Start Postgres + Redis |
| `docker compose --profile worker up -d worker` | Start the optional local worker container |
| `docker compose down` | Stop containers |

## Native Source Of Truth

Keep Expo config in `apps/app/app.json`. Treat `apps/app/android/` and `apps/app/ios/` as regenerated output, not as the canonical configuration source.

The generated native folders still contain required override points today:

- `apps/app/android/build.gradle` adds `mavenLocal()` and pins the local MapLibre native AAR version.
- `apps/app/ios/HuisHype/Info.plist` carries the URL-scheme entries used by the app, Expo dev client, and Google OAuth callback.
- `apps/app/ios/HuisHype/GoogleService-Info.plist` is a gitignored local credential file that must be present in the generated iOS target directory.

When native config changes, regenerate first and then re-apply or verify those override points using `apps/app/README.md`.

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
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=huishype-media
R2_PUBLIC_BASE_URL=https://media.huishype.nl
```
