# test-requirements.md — Verification stack for agent-driven development

## Goal

Agents must be able to verify changes locally + in CI with:

- **Unit tests** for all logic
- **Integration tests** for API/data boundaries
- **E2E "sim" tests** for every feature across iOS/Android/Web (happy paths + critical edge cases)
- **Deterministic environments** (suite-owned fixtures where practical, stable mocks, repeatable runs)

---

## Principles

- **No feature merges without tests** (unit + at least one E2E path if it merits)
- **Contract-first**: API + schema changes must update generated clients and tests
- **Hermetic CI**: tests do not depend on developer machines or random external services
- **One-command verification**: `pnpm test` is the canonical merge gate locally and in CI, and it must cover lint, typecheck, app/API/worker/shared/api-client/mocks unit tests, API integration, the Playwright harness checks, and the Playwright integration project
- **Broader verification**: `pnpm test:all` is the wider superset path for extra web and mobile coverage beyond the canonical gate

---

## Unit testing

### App (Expo / React Native / Web)

- **Test runner:** **Jest**
- **UI/component tests:** **React Native Testing Library**
- **What goes here:** pure logic, reducers/state, hooks, validation, formatting, view-model logic
- **Rules:** no network; use dependency injection and mocks

### Backend and worker

- **Backend runner:** **Jest** (`services/api`)
- **Worker runner:** **node:test** via `node --import tsx --test` (`services/worker`)
- **What goes here:** service logic, scoring/trending functions, moderation rules, auth/permission helpers, subscription entitlement checks, worker orchestration helpers

### Shared and client packages

- **Test runner:** **Vitest**
- **Packages:** `packages/shared`, `packages/api-client`, `packages/mocks`
- **What goes here:** pure utilities, generated client sanity checks, contract-aligned mock handlers, and shared helpers

---

## API & integration testing

### Contract tests

- **OpenAPI workflow:** update the exported schema, generated client, and related tests when API contracts change; there is no standalone schema-lint or breaking-change CI gate enforced today
- **Generated client sanity tests:** compile-time type checks + smoke calls against local env

### Backend integration tests

- **Runner:** Jest
- **DB:** **Postgres/PostGIS in Docker** (ephemeral per run)
- **Approach:** run the API against the real schema with migrations applied. Prefer suite-local hermetic fixtures created inside the test via helpers in `services/api/src/__tests__/integration/helpers/fixtures.ts`, and clean them up in-suite. If a broader integration suite intentionally validates shared dataset or materialized-view behavior, document that dependency explicitly in the file header instead of assuming generic seeded rows.

### API Mocking (Frontend Development)

- **Framework:** **MSW (Mock Service Worker)**
- **Why MSW:**
  - Allows frontend development against the generated OpenAPI client before backend logic is implemented
  - Prevents "blocked" states where agents can't verify UI because server endpoints return 404
  - Intercepts requests at the network level — works with any HTTP client
  - Same mocks work in tests, Storybook, and local development
- **Usage:**
  - Define handlers based on OpenAPI spec
  - Run frontend with mocked API during parallel development
  - Use in unit/integration tests for deterministic API responses

### External dependencies (always mocked in tests)

- Maps provider calls, Cloudflare R2, push providers (FCM/APNs), email/SMS, analytics
- **RevenueCat webhooks** (mock subscription events for testing subscription flows)
- Provide **local fake servers**, **MSW handlers**, or **in-memory adapters** with predictable responses

---

## E2E "sim" testing (feature verification)

### Web E2E

- **Framework:** **Playwright**
- **Coverage:** full user flows (auth, map browsing, posting, commenting, reporting, notifications UI, settings)
- **Artifacts:** traces, screenshots, videos on failure
- **Harness:** run from the monorepo root via `scripts/playwright/run-playwright-project.mjs`, which boots the shared static-export web runtime and API process. `apps/app/playwright.config.ts` is a compatibility entrypoint, not a separate harness.

### Mobile E2E (iOS + Android)

- **Framework:** **Maestro**
- **Why Maestro:**
  - **Black box testing:** interacts with the screen like a user (not gray box requiring deep native build integration)
  - **RN version agnostic:** no upgrade pain when React Native versions change
  - **Simple YAML tests:** easier to write, read, and maintain; AI agents can generate/read tests easily
  - **Faster setup:** much less CI flakiness and configuration overhead
  - **No deep native integration required:** works with any app build
- **Build:** `expo run:android` dev builds for emulator
- **Structure:** 1 orchestrator (`full-flow.yaml`) + 8 sub-flows in `flows/` dir
- **Coverage:** app smoke, feed, search+navigate, bottom sheet, login, auth interactions, cleanup, cluster-preview
- **Run from:** monorepo root, not `apps/app`

### Prefer e2e Feature tests

For each user story/feature, if it makes sense, prefer adding:

- **1 happy-path E2E**
- **1 critical failure/edge-path E2E** (auth denied, network failure, permission denied, invalid input, etc.)

---

## Visual Verification

### The Challenge

Agents are code-proficient but "visually blind." They cannot see if a map renders as a empty grid or if a 3D model is floating in the sky.

### Screenshot Capture on Failure

- **Playwright (Web):** Configure to capture screenshots on test failure automatically
- **Maestro (Mobile):** Capture screenshots on assertion failures
- All screenshot artifacts must be preserved in CI for agent inspection

### Agent Rule for Visual Failures

**If a UI test fails, the agent MUST inspect the screenshot artifact using vision capabilities before attempting a code fix.**

This prevents blind code changes that don't address the actual visual problem.

For All new UI implementations and changes, implement an e2e test that screenshots the said work to provide a feedback loop to the ai agent for verification of said work. E.g if we implemented a 'price guess slider', the agent should also implement an e2e test that opens up that UI, screenshots it, and check that screenshot in agent flow to verify the intentions were achieved.

---

## Test environment & data

### Local "Test Harness"

- **Docker Compose** for: Postgres/PostGIS + Redis + backend + optional fake services
- **Seed & reset**
  - deterministic seed scripts
  - per-test-run DB reset (truncate + reseed or fresh container)
- **Feature flags**
  - allow tests to force deterministic behavior (fixed clock, fixed random seed, stable feed ordering)

### Time & randomness control

- Use a **mockable clock** in both app and backend
- Seeded randomness for ranking/heat/trending simulations

### Subscription Testing

- **Mock RevenueCat responses** for different subscription states
- Seed test users with various entitlements:
  - Free user (no subscription)
  - HuisHype Plus subscriber (active)
  - Expired subscriber (grace period)
  - Subscriber with add-ons (extra slots, premium designs)
- Test subscription state sync via mocked webhook events

---

## CI gating (agent verification pipeline)

Canonical repo gate:

1. **Lint + typecheck** (app + backend + worker + shared + api-client + mocks)
2. **Unit tests** (app + backend + worker + shared + api-client + mocks)
3. **Integration tests** (API + DB)
4. **Playwright harness checks** (runtime config + wrapper tests)
5. **E2E web integration** (Playwright integration project)

Broader verification:

1. **E2E web flows** (Playwright flows project)
2. **E2E web visual** (Playwright visual project)
3. **E2E mobile** (wrapper script around Maestro Android flow execution)

Artifacts always captured:

- logs, screenshots, traces, videos, coverage reports

---

## Coverage expectations (practical)

- **Unit coverage:** prioritize pure logic; avoid brittle "snapshot everything"
- **E2E coverage:** all critical journeys + per-feature rule above

---

## One-command workflows (must exist)

- `test` — canonical repo gate: lint + typecheck + unit + API integration + Playwright harness self-tests + Playwright integration
- `test:unit` — app + API + worker + shared + api-client + mocks
- `test:integration` — backend with DB
- `test:e2e:harness` — Node tests for the shared Playwright runtime wrapper
- `test:e2e:web` — full root Playwright suite via `scripts/playwright/run-playwright-project.mjs`
- `test:e2e:flows` — Playwright flows project via the root wrapper
- `test:e2e:visual` — Playwright visual project via the root wrapper
- `test:e2e:integration` — Playwright integration project via the root wrapper
- `test:e2e:mobile` — mobile wrapper at `scripts/visual-overhaul/run-mobile-e2e.mjs`, which bootstraps the device and invokes Maestro
- `test:all` — broader superset: `test` plus flows, visual, and mobile E2E

---

## Folder conventions (where things live)

### Monorepo layout (recommended)

- `apps/`
  - `apps/app/` — Expo app (iOS/Android/Web)
- `services/`
  - `services/api/` — Node.js API (Fastify)
  - `services/worker/` — background jobs
- `packages/`
  - `packages/shared/` — shared TS types + utilities
  - `packages/api-client/` — generated OpenAPI client (and thin wrappers)
  - `packages/mocks/` — MSW handlers (generated from OpenAPI spec, shared across app + tests)

### Test locations

- **App unit tests**
  - `apps/app/src/**/__tests__/*`
  - `apps/app/src/**/*.test.ts(x)`
- **Backend unit tests**
  - `services/*/src/**/__tests__/*`
  - `services/*/src/**/*.test.ts`
  - `services/worker/src/**/*.test.ts`
- **Backend integration tests**
  - `services/api/src/__tests__/integration/*.integration.test.ts`
  - (runs against the real Postgres/PostGIS schema; stabilized suites should create and clean up their own fixtures unless the suite explicitly documents a shared dataset/materialized-view dependency)
- **Web E2E — User Flows (Playwright)**
  - `apps/app/e2e/flows/**/*.spec.ts`
- **Web E2E — Visual Reference Tests (Playwright)**
  - `apps/app/e2e/visual/**/*.spec.ts`
- **Web E2E — Integration Tests (Playwright)**
  - `apps/app/e2e/integration/**/*.spec.ts`
- **Mobile E2E (Maestro)**
  - `apps/app/e2e/mobile/**/*.yaml`
  - (Maestro uses YAML flow files, not TypeScript)

### Naming & tagging rules

- Use suffixes to make intent obvious:
  - `*.test.ts` = unit
  - `*.integration.test.ts` = integration
  - `*.spec.ts` = E2E (Playwright)
  - `*.yaml` = E2E (Maestro mobile flows)
- Tag/label tests for selective runs:
  - `@smoke` minimal critical path
  - `@feature:<name>` feature ownership
  - `@slow` for heavier sims

### "What tier do I add?" quick rule

- Pure logic change → **unit test**
- API/DB behavior change → **integration test**
- User-visible behavior / flow → **E2E sim test**
- If unsure → add **E2E** (and a unit test if there's logic)

---

## Definition of Done (agent-friendly)

A change is "done" only if:

- unit tests added/updated
- integration tests added/updated when API/DB touched
- E2E added/updated **when warranted**
- `pnpm test` passes locally (or CI)
- `pnpm test:all` runs when the change needs the broader flow/visual/mobile coverage

---

## Agent Test Decision Tree

When deciding which tests to run after a change:

| Change Type                         | Tests to Run                                           |
| ----------------------------------- | ------------------------------------------------------ |
| Pure logic change (hooks, utils)    | `pnpm test:unit`                                       |
| API route/endpoint change           | `pnpm test:unit` + `pnpm test:integration`             |
| UI component change                 | `pnpm test:unit` + `pnpm test:e2e:flows`               |
| Map/tile rendering change           | `pnpm test:e2e:visual` + `pnpm test:e2e:flows`         |
| Worker/runtime orchestration change | `pnpm test:unit`                                       |
| Mobile-specific change              | `pnpm test:e2e:mobile`                                 |
| Cross-cutting or unsure             | `pnpm test:all`                                        |
| Before marking any task done        | `pnpm test` + `pnpm test:e2e:mobile` if mobile touched |

### Quick Reference Commands

```
pnpm test                   # Canonical merge gate: lint + typecheck + unit (app + API + worker + shared + api-client + mocks) + API integration + Playwright harness self-tests + Playwright integration
pnpm test:unit              # App + API + worker + shared + api-client + mocks unit tests (Jest / Vitest / node:test)
pnpm test:integration       # API integration tests via @huishype/api Jest with NODE_ENV=test
pnpm test:e2e:web           # Full Playwright suite via the root wrapper
pnpm test:e2e:flows         # User flow Playwright project
pnpm test:e2e:visual        # Visual Playwright project
pnpm test:e2e:integration   # Playwright integration project
pnpm test:e2e:mobile        # Mobile wrapper script that bootstraps the device and runs Maestro
pnpm test:all               # Broader superset: pnpm test + flows + visual + mobile
```
