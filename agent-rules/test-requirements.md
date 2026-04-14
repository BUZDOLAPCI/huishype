# test-requirements.md - Verification stack for agent-driven development

## Goal

Agents must be able to verify changes locally and in CI with:

- Unit tests for logic
- Integration tests for API and data boundaries
- Web E2E tests for user-facing flows
- Deterministic environments with seeded data and stable mocks

## Principles

- No feature merges without tests.
- Contract-first: API and schema changes must update generated clients and tests.
- Hermetic CI: tests do not depend on developer machines or random external services.
- One-command verification: `pnpm test` is the canonical merge gate locally and in CI, and it must cover API, worker, shared, api-client, and mocks unit tests alongside API integration and Playwright integration.
- Broader verification: `pnpm test:all` is the wider superset path for extra web coverage beyond the canonical gate.

## Unit Testing

### Browser client

- Test runner: Jest
- UI/component tests: React Testing Library
- What goes here: pure logic, reducers/state, hooks, validation, formatting, and view-model logic
- Rules: no network; use dependency injection and mocks

### Backend and worker

- Test runner: Jest
- Backend packages: `services/api`
- Worker package: `services/worker`
- What goes here: service logic, scoring/trending functions, moderation rules, auth/permission helpers, subscription entitlement checks, and worker orchestration helpers

### Shared and client packages

- Test runner: Vitest
- Packages: `packages/shared`, `packages/api-client`, `packages/mocks`
- What goes here: pure utilities, generated client sanity checks, contract-aligned mock handlers, and shared helpers

## API and Integration Testing

### Contract tests

- OpenAPI validation: schema lint + breaking-change checks in CI
- Generated client sanity tests: compile-time type checks + smoke calls against local env

### Backend integration tests

- Runner: Jest
- DB: Postgres/PostGIS in Docker, ephemeral per run
- Approach: run API server against real DB with migrations applied and deterministic fixtures seeded

### API mocking

- Framework: MSW (Mock Service Worker)
- Why MSW:
  - Allows frontend development against the generated OpenAPI client before backend logic is implemented
  - Prevents blocked UI work when endpoints are still in flight
  - Intercepts requests at the network level
  - Same mocks work in tests and local development
- Usage:
  - Define handlers based on OpenAPI spec
  - Run the browser client with mocked API during parallel development
  - Use in unit and integration tests for deterministic API responses

### External dependencies

Always mocked in tests:

- Maps provider calls, Cloudflare R2, push providers, email/SMS, analytics
- RevenueCat webhooks for subscription flows
- Local fake servers, MSW handlers, or in-memory adapters with predictable responses

## Web E2E Testing

- Framework: Playwright
- Coverage: full user flows for auth, map browsing, posting, commenting, reporting, notifications UI, and settings
- Artifacts: traces, screenshots, and videos on failure

## Visual Verification

### The challenge

Agents can be code-proficient but visually blind. They cannot tell whether a map renders as an empty grid or whether a detail surface is clipped.

### Screenshot capture on failure

- Playwright: capture screenshots on test failure automatically
- All screenshot artifacts must be preserved in CI for agent inspection

### Agent rule for visual failures

If a UI test fails, inspect the screenshot artifact before attempting a code fix.

## Test Environment and Data

### Local test harness

- Docker Compose for Postgres/PostGIS, Redis, and backend services
- Deterministic seed scripts
- Feature flags for fixed clock, fixed random seed, and stable feed ordering

### Time and randomness control

- Use a mockable clock in both app and backend
- Seed randomness for ranking and trending simulations

### Subscription testing

- Mock RevenueCat responses for different subscription states
- Seed test users with various entitlements

## CI Gating

Canonical repo gate:

1. Lint + typecheck
2. Unit tests
3. Integration tests
4. Playwright integration

Broader verification:

1. Playwright flows
2. Playwright visual

Artifacts always captured:

- Logs
- Screenshots
- Traces
- Videos
- Coverage reports

## Coverage Expectations

- Unit coverage: prioritize pure logic
- E2E coverage: all critical journeys plus a failure or edge path where it matters

## One-Command Workflows

- `test` - canonical repo gate: lint + typecheck + unit + API integration + Playwright integration
- `test:unit` - API, worker, shared, api-client, and mocks unit tests
- `test:integration` - backend with DB
- `test:e2e:web` - full root Playwright suite
- `test:e2e:flows` - user flow Playwright project
- `test:e2e:visual` - visual Playwright project
- `test:e2e:integration` - Playwright integration project
- `test:all` - broader superset: `test` plus flows and visual E2E

## Folder Conventions

### Monorepo layout

- `apps/`
  - `apps/web/` - browser client
- `services/`
  - `services/api/` - Node.js API (Fastify)
  - `services/worker/` - background jobs
- `packages/`
  - `packages/shared/` - shared TS types and utilities
  - `packages/api-client/` - generated OpenAPI client and thin wrappers
  - `packages/mocks/` - MSW handlers shared across app and tests

### Test locations

- Browser client unit tests
  - `apps/web/src/**/__tests__/*`
  - `apps/web/src/**/*.test.ts(x)`
- Backend unit tests
  - `services/*/src/**/__tests__/*`
  - `services/*/src/**/*.test.ts`
  - `services/worker/src/**/*.test.ts`
- Backend integration tests
  - `services/api/src/__tests__/integration/*.integration.test.ts`
- Web E2E - User Flows
  - `apps/web/e2e/flows/**/*.spec.ts`
- Web E2E - Visual Reference Tests
  - `apps/web/e2e/visual/**/*.spec.ts`
- Web E2E - Integration Tests
  - `apps/web/e2e/integration/**/*.spec.ts`

### Naming and tagging rules

- `*.test.ts` = unit
- `*.integration.test.ts` = integration
- `*.spec.ts` = E2E
- `@smoke` = minimal critical path
- `@feature:<name>` = feature ownership
- `@slow` = heavier simulations

## Definition of Done

A change is done only if:

- unit tests are added or updated
- integration tests are added or updated when API or DB is touched
- E2E is added or updated when warranted
- `pnpm test` passes locally or in CI
- `pnpm test:all` runs when the change needs broader web coverage

## Agent Test Decision Tree

| Change Type | Tests to Run |
|------------|--------------|
| Pure logic change | `pnpm test:unit` |
| API route or endpoint change | `pnpm test:unit` + `pnpm test:integration` |
| UI component change | `pnpm test:unit` + `pnpm test:e2e:flows` |
| Map or tile rendering change | `pnpm test:e2e:visual` + `pnpm test:e2e:flows` |
| Worker orchestration change | `pnpm test:unit` |
| Cross-cutting or unsure | `pnpm test:all` |
| Before marking any task done | `pnpm test` |

## Quick Reference Commands

```text
pnpm test                 # canonical merge gate
pnpm test:unit            # API, worker, shared, api-client, and mocks unit tests
pnpm test:integration     # API integration tests
pnpm test:e2e:web         # full root Playwright suite
pnpm test:e2e:flows       # user flow Playwright project
pnpm test:e2e:visual      # visual Playwright project
pnpm test:e2e:integration # Playwright integration project
pnpm test:all             # pnpm test + flows + visual E2E
```
