# HuisHype

Social real estate platform. The active product surface is web-first, and the
browser client is the primary place where product behavior is defined during
this migration. Future native notes live only in:

- [apps/android/README.md](apps/android/README.md)
- [apps/ios/README.md](apps/ios/README.md)

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm (`npm install -g pnpm`)
- Docker

### Setup

```bash
pnpm install
docker compose up -d
pnpm --filter @huishype/api dev
pnpm -C apps/web dev
```

Open `http://localhost:8081` for the browser client.

## Web Workflow

The browser client lives in `apps/web`. Use the browser dev server, web E2E,
and root verification commands to validate changes.

```bash
pnpm -C apps/web dev
pnpm test:e2e:web
pnpm test:e2e:flows
pnpm test:e2e:visual
```

## Project Structure

```text
apps/web/            # browser client
services/api/        # Fastify API server
services/worker/     # background worker runtime
packages/shared/     # shared TypeScript types and utilities
packages/api-client/ # generated API client
packages/mocks/      # MSW mock handlers
```

## Commands

Unit-test runners are mixed by workspace: `services/api` uses Jest,
`services/worker` uses `node --test`, and `packages/shared`, `packages/api-client`,
and `packages/mocks` use Vitest.

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run workspace `dev` scripts via Turborepo |
| `pnpm build` | Build all packages |
| `pnpm test` | Canonical merge gate: lint + typecheck + unit + API integration + Playwright integration |
| `pnpm test:all` | Superset: `pnpm test` plus Playwright flows and visual |
| `pnpm test:unit` | Run unit tests for API, worker, shared, api-client, and mocks |
| `pnpm test:integration` | Run API integration tests |
| `pnpm test:e2e:web` | Run the root Playwright suite |
| `pnpm test:e2e:integration` | Run the Playwright integration project |
| `pnpm test:e2e:flows` | Run the Playwright flows project |
| `pnpm test:e2e:visual` | Run the Playwright visual project |
| `pnpm -C apps/web dev` | Start the browser client dev server |
| `pnpm --filter @huishype/worker dev` | Run the worker directly in watch mode |
| `docker compose up -d` | Start Postgres + Redis |
| `docker compose --profile worker up -d worker` | Start the optional local worker container |
| `docker compose down` | Stop containers |

## Web-First Source Of Truth

The active browser workflow is web-first. Native build/regeneration guidance is
kept out of the active docs surface and isolated to the native handoff readmes.

The browser client, shared packages, and backend services are the active
development surface. Do not use archived legacy workflow notes as current
instructions.

## Tech Stack

- **Browser app**: React + TypeScript + TanStack Query
- **Maps**: MapLibre GL JS fork
- **API**: Fastify + Drizzle ORM + OpenAPI
- **Database**: PostgreSQL + PostGIS
- **Cache**: Redis

## Environment Variables

Copy `.env.example` to `.env` in `services/api/`:

```env
DATABASE_URL=postgresql://huishype:huishype_dev@localhost:5440/huishype
PORT=3100
```
