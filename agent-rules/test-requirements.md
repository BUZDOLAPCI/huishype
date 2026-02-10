# test-stack.md — Verification stack for agent-driven development

## Goal
Agents must be able to verify changes locally + in CI with:
- **Unit tests** for all logic
- **Integration tests** for API/data boundaries
- **E2E "sim" tests** for every feature across iOS/Android/Web (happy paths + critical edge cases)
- **Deterministic environments** (seeded data, stable mocks, repeatable runs)

---

## Principles (non-negotiable)
- **No feature merges without tests** (unit + at least one E2E path)
- **Contract-first**: API + schema changes must update generated clients and tests
- **Hermetic CI**: tests do not depend on developer machines or random external services
- **One-command verification**: `test:all` runs the same suite locally and in CI

---

## Unit testing

### App (Expo / React Native / Web)
- **Test runner:** **Jest**
- **UI/component tests:** **React Native Testing Library**
- **What goes here:** pure logic, reducers/state, hooks, validation, formatting, view-model logic
- **Rules:** no network; use dependency injection and mocks

### Backend (Node.js / TypeScript)
- **Test runner:** **Jest**
- **What goes here:** service logic, scoring/trending functions, moderation rules, auth/permission helpers, subscription entitlement checks

---

## API & integration testing

### Contract tests
- **OpenAPI validation:** schema lint + breaking-change checks in CI
- **Generated client sanity tests:** compile-time type checks + smoke calls against local env

### Backend integration tests
- **Runner:** Jest
- **DB:** **Postgres/PostGIS in Docker** (ephemeral per run)
- **Approach:** run API server against real DB with migrations applied, seed deterministic fixtures

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

### Mobile E2E (iOS + Android)
- **Framework:** **Maestro**
- **Why Maestro:**
  - **Black box testing:** interacts with the screen like a user (not gray box requiring deep native build integration)
  - **RN version agnostic:** no upgrade pain when React Native versions change
  - **Simple YAML tests:** easier to write, read, and maintain; AI agents can generate/read tests easily
  - **Faster setup:** much less CI flakiness and configuration overhead
  - **No deep native integration required:** works with any app build
- **Build:** `expo run:android` dev builds for emulator
- **Structure:** 1 orchestrator (`full-flow.yaml`) + 7 sub-flows in `flows/` dir
- **Coverage:** app smoke, feed, search+navigate, bottom sheet, login, auth interactions, cleanup
- **Run from:** monorepo root, not `apps/app`

### Feature test rule (enforce "every feature has E2E")
For each user story/feature, add at least:
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
Minimum pipeline stages:
1. **Lint + typecheck** (app + backend + shared packages)
2. **Unit tests** (app + backend)
3. **Integration tests** (backend + DB)
4. **E2E web** (Playwright)
5. **E2E mobile** (Maestro Android — `maestro test apps/app/e2e/mobile/full-flow.yaml`)

Artifacts always captured:
- logs, screenshots, traces, videos, coverage reports

---

## Coverage expectations (practical)
- **Unit coverage:** prioritize pure logic; avoid brittle "snapshot everything"
- **E2E coverage:** all critical journeys + per-feature rule above

---

## One-command workflows (must exist)
- `test:unit` — app + backend
- `test:integration` — backend with DB
- `test:e2e:web` — Playwright
- `test:e2e:mobile` — Maestro (requires running emulator)
- `test:all` — runs the full stack (or a CI-equivalent subset locally)

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
- **Backend integration tests**
  - `services/api/src/__tests__/integration/*.integration.test.ts`
  - (runs against real Postgres/PostGIS DB on port 5440 with migrations + seeds)
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
- at least one E2E added/updated for the feature
- `test:all` passes locally (or CI)

---

## Agent Test Decision Tree

When deciding which tests to run after a change:

| Change Type | Tests to Run |
|------------|-------------|
| Pure logic change (hooks, utils) | `pnpm test:unit` |
| API route/endpoint change | `pnpm test:unit` + `pnpm test:integration` |
| UI component change | `pnpm test:unit` + `pnpm test:e2e:flows` |
| Map/tile rendering change | `pnpm test:e2e:visual` + `pnpm test:e2e:flows` |
| Mobile-specific change | `maestro test apps/app/e2e/mobile/full-flow.yaml` (requires emulator) |
| Cross-cutting or unsure | `pnpm test:all` |
| Before marking any task done | `pnpm test:all` + `maestro test apps/app/e2e/mobile/full-flow.yaml` if mobile touched |

### Quick Reference Commands
```
pnpm test:unit              # App + API unit tests (Jest)
pnpm test:integration       # API integration tests (runs via turbo → API jest)
pnpm test:e2e:web          # All Playwright tests (visual + integration + flows)
pnpm test:e2e:flows        # User flow E2E tests only
pnpm test:e2e:visual       # Visual reference tests only
pnpm test:e2e:integration  # Critical flow integration tests only
pnpm test:e2e:mobile       # Maestro mobile tests — run directly: maestro test apps/app/e2e/mobile/full-flow.yaml
pnpm test:all              # Unit + all Playwright E2E
```
