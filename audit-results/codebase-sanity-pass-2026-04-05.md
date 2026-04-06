# HuisHype Codebase Sanity Pass

Date: 2026-04-05
Workspace: `/home/caslan/dev/git_repos/hh/huishype`

## Scope

- `apps/app`
- `services/api`
- `services/worker`
- `packages/shared`
- `packages/api-client`
- `packages/mocks`
- root scripts, CI, lint/typecheck/test setup
- `README.md`, `AGENTS.md`, `agent-rules/*`, selected repo docs

## Evidence Labels

- `reproduced` — verified by running a command in this workspace during this pass
- `code-inspection` — verified directly in tracked code, scripts, config, or docs
- `inferred` — impact/risk conclusion that is plausible but not directly reproduced as a live failure

## Executive Summary

The repo has real verification, contract, architecture, and documentation gaps, but the earlier draft mixed reproduced failures, code inspection, and inference too loosely.

The highest-confidence issues are:

1. The verification contract is misleading: root `pnpm test` is not the real full gate, CI skips tests by default, and root lint/typecheck/integration are currently red.
2. Manual contract artifacts have drifted from the live backend, and the app has a direct runtime mismatch in the listing preview/submit flow.
3. If `NODE_ENV` is unset, the API enters dev mode and relaxes secret enforcement/auth behavior.
4. Some documented architecture is still placeholder or stubbed, especially the worker and backend-exposed subscription state.
5. Docs are materially out of sync with the repo.

After validation, no finding remains `Critical`. The strongest findings are `High`.

## Addendum — Locked Corrections (2026-04-06)

This addendum locks subsequent repo decisions and post-audit clarifications into the audit record without rewriting the original April 5 findings as if they were collected on a different date.

- **Listing preview is not auth gated.**
  - `POST /listings/preview` should remain previewable without auth, consistent with the submit-gated interaction rule in `agent-rules/main-spec.md`.
  - The drift is in `services/api/src/routes/listings.ts` and the generated/exported contract, not in the app’s decision to preview before login.
  - The remaining live submit mismatch still stands: the app sends `ogImage` while the backend expects `thumbnailUrl`.

- **Integration finding is date-bounded.**
  - The April 5 reproduced teardown result remains valid as historical evidence for that pass.
  - As of April 6 follow-up verification, the integration failure is better understood as a lifecycle/concurrency problem, not only per-suite cleanup debt.
  - The exact failing-suite count is not stable enough to treat the April 5 list as a current fixed set.

- **Native reproducibility is a source-of-truth problem.**
  - The earlier “under-documented reproducibility” conclusion is too soft.
  - Ignored native folders plus required runtime wiring in generated native files create a canonical-source ambiguity that must be documented or eliminated.
  - This is still not proof that Expo prebuild is broken; it is a source-of-truth and reproducibility ownership problem.

- **Canonical test gate is now locked.**
  - `pnpm test` is the canonical repo gate.
  - `pnpm test` means the required reproducible merge gate, not every possible test path.
  - `pnpm test:all` remains the broader superset gate for additional coverage, including mobile E2E.

- **Worker finding is implementation-bound, not docs-only.**
  - The worker is no longer a “implement or de-scope” decision item.
  - The correction path is to implement the worker per `audit-results/production-worker-plan-2026-04-06.md`.

- **Subscription placeholder is resolved by removal for now.**
  - `isPlus` should be removed from exposed auth/session contracts until a real entitlement model exists.
  - Do not continue shipping a hardcoded `false` placeholder as if it were a real backend capability.

## Findings

### High

1. Verification contract is misleading.
   - Evidence: `reproduced + code-inspection`
   - `package.json:10` defines `pnpm test` as `turbo run test`, not the full verification stack.
   - `package.json:19` defines `pnpm test:all` as the broad gate.
   - `.github/workflows/ci.yml:19` hardcodes `SKIP_TESTS: 'true'`.
   - `.github/workflows/ci.yml:53` and `.github/workflows/ci.yml:93` skip unit and integration tests when `SKIP_TESTS=true`.
   - `.github/workflows/ci.yml:143-146` always skips E2E in CI.
   - `AGENTS.md:512` still describes `pnpm test` as the “complete test suite”.
   - `services/worker/package.json:10` makes root `pnpm test` look greener than it should because worker “tests” are only `echo 'No tests yet — worker service is a stub'`.
   - Reproduced in this pass:
     - `pnpm test` exited `0`
     - `pnpm test:integration` exited `1`
   - Impact: contributors can get a false sense of coverage locally and in CI.

2. Manual contract artifacts are stale relative to the live backend, and the app has a direct listing-flow contract mismatch.
   - Evidence: `code-inspection`
   - The generated OpenAPI types appear to be aligned; the drift is in the manual wrapper/shared-type/mock layer.
   - Stale manual wrapper/types:
     - `packages/api-client/src/client.ts:272-275` still calls `POST /properties/map`, but `services/api/openapi.json` has no `/properties/map` path.
     - `packages/shared/src/types/api.ts:148-170` still defines `GetMapProperties*` types for that obsolete route.
     - `packages/api-client/src/client.ts:348-352` sends `page` and `pageSize` to `/saved-properties`, while the live route expects `limit` and `offset` in `services/api/src/routes/properties.ts:158-167` and `services/api/src/routes/properties.ts:1392-1487`.
     - `packages/shared/src/types/api.ts:314-319` still models saved properties as a generic paginated envelope, while the live route returns `{ data, total, hasMore }`.
   - Stale MSW/property-listing mock envelopes:
     - `packages/mocks/src/handlers/properties.ts:319-376` still mocks `POST /properties/map`.
     - `packages/mocks/src/handlers/properties.ts:212-237` still uses `page/pageSize` and returns `{ items, pagination }` for `/saved-properties`.
     - `packages/mocks/src/handlers/listings.ts:16-104` returns listing envelopes that do not match the live routes in `services/api/src/routes/listings.ts:267-491`.
   - Direct app/backend mismatch in the live listing flow:
     - `services/api/src/routes/listings.ts:341-409` requires auth for `POST /listings/preview`, but `apps/app/src/components/PropertyBottomSheet/ListingSubmissionSheet.tsx:85-92` calls it without auth headers.
     - `services/api/src/routes/listings.ts:435-491` expects `thumbnailUrl` on submit, but `apps/app/src/components/PropertyBottomSheet/ListingSubmissionSheet.tsx:131-136` sends `ogImage`.
   - Impact: wrappers, shared types, mocks, and live app behavior are no longer describing the same API surface.

3. If `NODE_ENV` is unset, the API enters dev mode and relaxes auth/config behavior.
   - Evidence: `code-inspection + inferred`
   - `services/api/src/config.ts:5` treats an unset `NODE_ENV` as dev mode.
   - `services/api/src/config.ts:11-28` skips production-secret validation when `isDev` is true.
   - `services/api/src/routes/auth.ts:128-152` and `services/api/src/routes/auth.ts:191-214` accept arbitrary Google/Apple tokens in dev mode by minting synthetic users.
   - `services/api/src/routes/email-auth.ts:135-139` returns the magic-link token directly in dev mode.
   - `services/api/src/app.ts:70-98` also relaxes CORS/cookie behavior in dev mode.
   - Important nuance: the checked-in production wiring sets `NODE_ENV=production`, so this is a fail-open code path, not a reproduced production outage.

4. Integration tests are currently failing at teardown.
   - Evidence: `reproduced`
   - `pnpm test:integration` failed in this pass.
   - Current reproduced result:
     - `253` tests passed
     - `5` suites failed
     - failures were `afterAll` hook timeouts, not assertion failures
   - Current failing suites:
     - `services/api/src/__tests__/integration/health.integration.test.ts:12`
     - `services/api/src/__tests__/integration/geocode.integration.test.ts:63`
     - `services/api/src/__tests__/integration/notifications.integration.test.ts:43`
     - `services/api/src/__tests__/integration/listings.integration.test.ts:45`
     - `services/api/src/__tests__/integration/users.integration.test.ts:60`
   - Impact: the API integration layer has meaningful passing coverage, but teardown/resource lifecycle is unhealthy enough to keep the suite red.

5. Worker architecture is still stubbed.
   - Evidence: `code-inspection`
   - `services/worker/src/index.ts:1-3` is an empty TODO stub.
   - `services/worker/package.json:6-11` uses placeholder `dev` and `test` scripts.
   - `agent-rules/software-stack.md:53` treats queue-based background jobs as chosen architecture.
   - `services/api/src/routes/listings.ts:515` and `services/api/src/routes/listings.ts:897` already describe worker-facing ingestion/resume endpoints.
   - Impact: a documented subsystem exists mostly as scaffolding.

6. Backend-exposed subscription state is still placeholder.
   - Evidence: `code-inspection`
   - `agent-rules/software-stack.md:72-83` and `agent-rules/software-stack.md:158` treat RevenueCat-backed subscriptions as established architecture.
   - `services/api/src/routes/auth.ts:339`, `services/api/src/routes/auth.ts:463`, and `services/api/src/routes/auth.ts:621` still hardcode `isPlus: false`.
   - `services/api/src/routes/email-auth.ts:274` also hardcodes `isPlus: false`.
   - Impact: auth/session responses expose subscription state, but the current backend behavior is still placeholder.

### Medium

7. Root repo health is red, but the app-only pre-commit gate is narrower than some docs imply.
   - Evidence: `reproduced`
   - Reproduced in this pass:
     - `pnpm lint` failed with `3` errors and `69` warnings
     - `pnpm typecheck` failed on `packages/mocks/src/__tests__/handler-alignment.test.ts:53`
     - `pnpm test:integration` failed
     - `pnpm -C apps/app typecheck` passed
     - `pnpm -C apps/app test` passed
   - `AGENTS.md:350-357` defines the mandatory pre-commit gate as app-only (`pnpm -C apps/app typecheck` and `pnpm -C apps/app test`), so that narrower gate is currently achievable even though the root repo is not green.

8. Test/lint tooling is internally inconsistent.
   - Evidence: `code-inspection + reproduced`
   - `eslint.config.js:18-20` ignores `**/__tests__/**` and `**/e2e/**`.
   - The current root typecheck failure is inside `packages/mocks/src/__tests__/handler-alignment.test.ts:53`.
   - Impact: test files can drift silently under lint, then fail under TypeScript later.

9. Passing unit tests are noisy across API and app.
   - Evidence: `reproduced`
   - `pnpm test:unit` passed.
   - API unit tests emit repeated dotenv output because `services/api/src/config.ts:1-3` calls `dotenv.config()` at import time.
   - App tests emit repeated `console.error` noise, including DOM casing warnings and `act(...)` warnings, during passing runs.
   - Impact: this is signal-quality debt, not a hard gate, but it makes failures harder to interpret.

10. Contract tests are too narrow to guard the current drift.
   - Evidence: `code-inspection`
   - `packages/api-client/src/__tests__/contract-sanity.test.ts` validates route presence and `/feed` alignment, but does not catch stale manual wrappers like `getMapProperties()`.
   - `packages/mocks/src/__tests__/handler-alignment.test.ts` checks a few runtime envelopes and handler wiring, but not the stale property/listing envelopes above.
   - Impact: these tests provide useful checks, but they are incomplete and currently overstate contract confidence.

11. Native reproducibility is under-documented, not proven broken.
   - Evidence: `code-inspection`
   - `apps/app/.gitignore:39-41` ignores `/ios` and `/android`.
   - `AGENTS.md:77-83` and `AGENTS.md:168-170` reference native files as wiring points.
   - At the same time, `apps/app/app.json:42-63` and `apps/app/package.json:7-10` show an Expo prebuild-style setup where generated native folders can be intentionally ignored.
   - This supports a narrower conclusion than the earlier draft: the repo under-documents how native wiring is reproduced from a clean checkout.

## Documentation Disparities

1. README still describes a Netherlands-only product.
   - `README.md:3` says “Social real estate platform for the Netherlands.”
   - `packages/shared/src/config/country-config.ts:13-17` and `AGENTS.md:109-123` document a 19-country deployment model.

2. README still suggests Expo Go for mobile.
   - `README.md:36` says “use Expo Go for mobile.”
   - `apps/app/package.json:28-37` includes `expo-dev-client`.
   - `apps/app/app.json:42-63` uses custom plugins including `expo-build-properties` and `@maplibre/maplibre-react-native`.

3. README understates the workspace structure.
   - `README.md:42-48` omits `services/worker`.

4. README understates the verification surface.
   - `README.md:52-60` omits `test:all`, `test:integration`, `test:e2e:flows`, `test:e2e:visual`, `test:e2e:integration`, and `test:e2e:mobile`.

5. Agent/docs guidance conflicts with actual scripts.
   - `AGENTS.md:512` calls `pnpm test` the “complete test suite”.
   - `package.json:10` and `package.json:19` show that `pnpm test` and `pnpm test:all` are materially different.

6. CI docs and implementation disagree.
   - `agent-rules/test-requirements.md:135-159` describes CI stages that include unit, integration, web E2E, and mobile E2E.
   - `.github/workflows/ci.yml:19` skips tests by default.
   - `.github/workflows/ci.yml:143-146` always skips E2E.

7. Some historical notes still contain stale current-state claims and should be labeled more clearly as archival.
   - Example: `DEFERRED-GAPS.md:30-33` still says there is no CI config, which is no longer true.

8. `agent-rules/test-requirements.md` is internally inconsistent about `test:all`.
   - `agent-rules/test-requirements.md:16` and `agent-rules/test-requirements.md:159` describe `test:all` as the full-stack / CI-equivalent gate.
   - `agent-rules/test-requirements.md:247` describes `test:all` as only “Unit + all Playwright E2E”.

## Verification Performed

### Reproduced

- `git status --short`
  - Not clean in this pass: the audit file itself was untracked before revision.

- `pnpm lint`
  - Failed.
  - Reproduced result: `3` errors, `69` warnings.
  - Blocking errors are missing `react-hooks/exhaustive-deps` rule definitions in:
    - `apps/app/app/(tabs)/index.tsx:141`
    - `apps/app/src/components/AuthModal.tsx:156`
    - `apps/app/src/components/PropertyBottomSheet/PropertyBottomSheet.web.tsx:241`

- `pnpm typecheck`
  - Failed.
  - Reproduced result: `packages/mocks/src/__tests__/handler-alignment.test.ts(53,6): error TS6196`.

- `pnpm test`
  - Passed.
  - Important nuance: this is not the full gate; it excludes integration and E2E and includes a worker stub “test”.

- `pnpm test:unit`
  - Passed.

- `pnpm test:integration`
  - Failed.
  - Reproduced result: `5` failing suites, `19` passing suites, `253` tests passed, failures caused by `afterAll` hook timeouts.

- `pnpm -C apps/app typecheck`
  - Passed.

- `pnpm -C apps/app test`
  - Passed.
  - Output is noisy with repeated `console.error` warnings.

### Code Inspection

- root scripts and CI workflow
- API auth/config and route code
- worker stub and subscription state wiring
- manual/shared/generated API-contract layers
- MSW handlers and current contract tests
- README, AGENTS, `agent-rules/*`, and historical repo notes

### Inferred

- impact/risk statements about false confidence, deployment risk if `NODE_ENV` is omitted, and native reproducibility risk from under-documented prebuild/native wiring

Not run in this pass:

- `pnpm test:e2e:web`
- `pnpm test:e2e:mobile`

Reason:
- Lower-level gates were already red, so running browser/mobile suites would not change the core conclusions of this pass.

## Recommended Fix Order

1. Repair the verification contract and CI gating around the locked canonical gate.
   - Make `pnpm test` the canonical repo gate and wire scripts/docs/CI to that contract.
   - Keep `pnpm test:all` as the broader superset gate, not the default merge gate.
   - Make CI run real required tests instead of skipping by default.

2. Close the fail-open `NODE_ENV` path.
   - Make missing `NODE_ENV` fail closed for server boots that are not explicitly development/test.

3. Fix the live listing-flow contract mismatch end-to-end.
   - Remove auth from `/listings/preview` and align the route, OpenAPI export, generated client, mocks, and tests to the submit-gated product rule.
   - Keep `/listings/submit` authenticated.
   - Send `thumbnailUrl` instead of `ogImage`.

4. Reconcile the manual contract layer.
   - Remove or replace stale wrappers/types/mocks (`/properties/map`, saved-properties pagination/envelope, stale listing/property mock envelopes).
   - Add typed coverage for the live listing routes.
   - Strengthen contract tests so they assert the shapes the server actually serves.

5. Fix API integration lifecycle/concurrency failures.
   - Treat the red integration suite as a startup/shutdown boundary problem, not only a per-suite cleanup problem.
   - Make startup background work test-safe and tighten teardown where needed.

6. Implement the worker and remove the subscription placeholder.
   - Implement the worker per `audit-results/production-worker-plan-2026-04-06.md`.
   - Remove `isPlus` from exposed auth/session contracts until real entitlement wiring exists.

7. Bring docs and native reproducibility guidance back in line with the repo.
   - README, AGENTS, and `agent-rules/test-requirements.md` need to describe the repo that actually exists.
   - Clarify the canonical source of truth for native wiring in the Expo prebuild workflow and document the required override points explicitly.

## Residual Risk

- I did not run full Playwright or Maestro suites after reproducing lower-level failures.
- Some repo documents are historical planning material; I only flagged places where they materially conflict with live repo behavior.
