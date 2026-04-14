# Web-First Architecture Switch Implementation Runbook V2

## Status

This document supersedes the first runbook draft for implementation planning.

Use this version as the source of truth for executing the architecture switch.
It describes the target state and execution plan, not the current repo reality,
unless a step explicitly says it is referencing current source material.

## Current Verified Repo State

The current repo reality at the time of this runbook is:

- the active frontend client is still `apps/app`, not `apps/web`
- the active package name is still `@huishype/app`
- the active web runtime is still Expo Router + React Native Web + Metro
- the browser auth flow is still bearer-token based and stores tokens in
  browser-readable storage
- Playwright, Docker, local docs, and root scripts still point at the Expo-era
  app/runtime

This runbook is therefore written as a migration plan from that verified
current state to the target end state below.

## Execution Notation

Use these rules when executing the work:

- until WS2 completes, concrete source edits land under `apps/app/**`
- after WS2 completes, the same surfaces live under `apps/web/**`
- until WS2 completes, treat `@huishype/app` as the live package name and
  `@huishype/web` as the target package name
- when a workstream names a target-state `apps/web/...` path, use the
  pre-cutover `apps/app/...` equivalent before the mechanical rename
- verification commands before WS2 must point at `apps/app`; final post-cutover
  verification points at `apps/web`

## Mission

This sprint converts HuisHype from an Expo-era shared frontend into a clean
web-first architecture with future-native-ready contracts.

All descriptions below are written against the target end state and the
execution order needed to reach it.

At sprint close:

- the repo has one active frontend client: `apps/web`
- the active product path no longer depends on Expo, React Native, React Native
  Web, Metro, NativeWind, Maestro, or `@maplibre/maplibre-react-native`
- docs, scripts, CI, tests, local dev, and deployment all describe the same
  web-first operating model
- shared packages contain portable contracts only
- the repo is ready for later Kotlin Android and Swift iOS apps without keeping
  dead Expo/native implementation code alive

## Enforcement Boundary

### Active-surface rule

The following rule is strict for all active product surfaces:

- no future work
- no TODOs
- no placeholders
- no temporary compatibility layers
- no skipped cleanup

This rule applies to active work surfaces and active docs, including:

- `apps/app/**` until WS2, then `apps/web/**`
- `services/**`
- `packages/**`
- root scripts/config/docs
- active docs outside `docs/archive/**`

Historical records may be kept only when they are archived or otherwise removed
from the active-doc policy surface. Closed issue logs, completed TODO docs, and
finished planning docs are not left in place as active guidance.

### Explicit exception: future native handoff docs

Future-looking notes are allowed only in:

- `apps/android/README.md`
- `apps/ios/README.md`

Those files are excluded from the no-TODO / no-future-work enforcement:

- `apps/android/README.md` and `apps/ios/README.md` are the native handoff
  contract and may describe future native build work, open items, and
  platform-specific follow-up.

No other file is exempt.

### Planning-document clarification

This runbook may describe future execution steps because it is a planning
document.

The no-TODO / no-future-work rule applies to the final shipped state of active
repo surfaces, not to the presence of sequenced implementation tasks inside
this plan.

The same distinction applies to docs and issue logs: active, ongoing, or
current-work docs must be rewritten or archived; old completed issue logs and
planning docs may be retained only when they are archived or explicitly
excluded from the active-doc policy surface.

Locked architecture docs may describe the target-state architecture and delivery
order, but they are not an exemption zone for open TODOs, deferred cleanup, or
future-work buckets. The only exempt future-looking note zones are the native
handoff docs.

## Sprint Rules

- Done means code, docs, tests, CI, scripts, and deployment all agree.
- Fix root causes only.
- If a touched surface contains unrelated breakage or contradictory guidance,
  fix it in-sprint.
- Archive or delete stale guidance instead of letting it compete with current
  docs.
- Historical issue logs and completed planning/TODO docs must be archived or
  excluded from the active-doc policy surface once they are closed.
- Do not treat the web rewrite as a small cleanup. It is a full runtime
  replacement.
- Do not use `DEFERRED-GAPS.md` to defer any part of this architecture switch.
- If unrelated active-surface issues are discovered during the sprint, fix them
  in-sprint rather than logging them as deferred cleanup.

## Locked Decisions

### Repo shape

- Rename `apps/app` to `apps/web`.
- Rename package `@huishype/app` to `@huishype/web`.
- Keep `packages/shared`, `packages/api-client`, and `packages/mocks`.
- `packages/design-tokens` is optional, not mandatory. Create it only if a
  stable portable token surface emerges during the rewrite.
- Add `apps/android/README.md` and `apps/ios/README.md` as the explicit native
  handoff contract.
- Do not keep generated Expo Android/iOS trees in the active repo shape.

### Active web stack

- **Framework:** React 19
- **Build/runtime:** Vite
- **Routing:** React Router
- **Data fetching:** TanStack Query
- **Styling:** Tailwind CSS for web utility classes + CSS variables +
  plain CSS/CSS modules for complex browser-only surfaces
- **Unit/component tests:** Vitest + Testing Library for web
- **E2E:** Playwright only
- **Map engine:** custom `maplibre-gl-js` fork only

### Shared-boundary rule

- `packages/shared` owns types, validation, formatting, country config, map
  data contracts, analytics/event contracts, and other portable business rules.
- `packages/api-client` owns generated backend contracts and request helpers.
  It must not own browser cookie/session persistence or browser-readable token
  storage. If non-browser consumers still need transient in-memory token
  support, that contract must remain explicitly separate from the browser path.
- `packages/design-tokens`, if created, may only hold raw tokens, token maps,
  and CSS-variable generation helpers.
- Shared packages must not import from `apps/web`.

### Existing-library preference

The migration must remove legacy custom glue where the repo already has a
standard library or generated-contract path that covers the need.

- Prefer existing standard libraries and generated artifacts over handwritten
  replacements.
- Do not preserve or expand custom infrastructure that exists only because of
  Expo-era constraints once the web-first stack is in place.
- If a workstream touches an area already covered by an installed library,
  generated client, or framework-native capability, the default action is to
  adopt that capability and delete the bespoke layer unless a concrete blocker
  is documented.

This rule applies explicitly to the following current repo surfaces:

- `packages/api-client/src/client.ts` is a legacy handwritten wrapper. The
  migration target is generated OpenAPI types plus a thin standard-library
  request layer, not a larger handwritten API SDK.
- `scripts/playwright/static-web-server.mjs` is legacy custom SPA-serving
  infrastructure. The migration target is Vite-native dev/preview serving or a
  minimal standard static server, not a retained custom route-matching server.
- `packages/mocks/**` already provides the mock boundary through MSW. Do not
  create parallel bespoke browser or test fetch-mocking layers.
- `services/api` already has `@fastify/cookie` and `@fastify/jwt`. Do not add a
  second bespoke browser-session subsystem unless a concrete requirement cannot
  be met by explicit cookie transport plus the existing auth/token primitives.
- Existing low-level token-verification code is not a reason to keep building
  custom auth plumbing. If token verification is revisited during the
  migration, prefer standard auth/JWT libraries over expanding handwritten
  verification logic.

### Explicit removals from the active product path

The active repo must not depend on or advertise:

- `expo`
- `expo-router`
- `react-native`
- `react-native-web`
- `nativewind`
- `react-native-css-interop`
- `react-native-gesture-handler`
- `react-native-reanimated`
- `react-native-safe-area-context`
- `react-native-screens`
- `react-native-svg`
- `react-native-worklets`
- `@maplibre/maplibre-react-native`
- `expo-auth-session`
- `expo-secure-store`
- `expo-web-browser`
- `expo-linking`
- `expo-constants`
- `expo-dev-client`
- `expo-font`
- `expo-splash-screen`
- `expo-status-bar`
- `expo-build-properties`
- `expo-crypto`
- `expo-apple-authentication`
- `expo-clipboard`
- `expo-haptics`
- `expo-blur`
- `@expo/vector-icons`
- `@expo-google-fonts/*`
- Expo web export flows
- Metro web dev/test flows
- Maestro mobile E2E as an active repo gate

## Target End State

```text
apps/
  web/                 # active production client
  android/
    README.md          # future Kotlin-native contract
  ios/
    README.md          # future Swift-native contract
services/
  api/
  worker/
packages/
  shared/
  api-client/
  mocks/
  design-tokens/       # only if justified by extracted portable tokens
docs/
  archive/
```

## Delivery Sequence

This migration should be executed in this order. Do not invert it.

### Phase 0. Policy And Doc Alignment

Before implementation lanes start:

- make this runbook the active execution document
- align the high-level plan and architecture docs with the same rules
- make the native-doc exception explicit
- define the archive boundary
- create `docs/archive/` before archive-only policy gates depend on it
- inventory active docs across `docs/issues/**`, `docs/plans/**`,
  `docs/superpowers/specs/**`, and any other non-archived docs, then rewrite,
  archive, or explicitly close out everything that conflicts with the target
  state before the final audit
- create `apps/android/README.md` and `apps/ios/README.md` up front so the
  native handoff boundary is real before cleanup starts
- capture the future-native contract now from the current Expo-era sources of
  truth before deleting them:
  `apps/app/app.json`,
  `apps/app/android/build.gradle`,
  `apps/app/ios/HuisHype/Info.plist`,
  `apps/app/ios/HuisHype/GoogleService-Info.plist` (path contract only; file is
  gitignored locally),
  plus app scheme, bundle/package IDs, location permissions, Google callback
  identifiers, and `maplibre-native` integration notes
- define a two-stage doc-policy gate:
  1. an in-flight evergreen-doc grep that targets the active operator/docs
     surface only while migration planning docs are still live
  2. a closeout grep across the remaining non-archived docs after WS10 archives
     stale plans, issue logs, and completed migration docs
- do not require the broad non-archived-doc grep to stay green during the
  sprint while architecture-switch execution docs are intentionally still live

### Phase 1. Runtime Foundation Replacement

Replace Expo/React Native/Metro with Vite + React Router + the final web
styling system while the app still lives at the existing path.

This phase intentionally happens before the repo rename so the new runtime can
be proven without simultaneously breaking every root script and path.

Existing browser-owned `.web` implementations are source material for this
phase, not throwaway compatibility leftovers. Preserve their behavior where it
represents the real web UX and rehome that behavior into the final web-only
structure.

Move the root web verification bootstrap with this phase as well:

- replace the Expo-backed Playwright/runtime bootstrap in lockstep with the
  first working Vite shell
- keep `pnpm test`, `pnpm test:e2e:web`, and the root Playwright runtime able
  to validate the new web stack as soon as the new shell exists
- do not leave Expo/Metro Playwright as the only runnable web verification path
  after the Vite shell lands

### Phase 2. Browser Auth, Env, Product Surface, And Backend Contract Cleanup

Replace Expo auth/session/browser/storage flows with browser implementations and
clean up backend auth/env assumptions accordingly.

Current verified auth reality before this phase:

- the browser app is bearer-token based today
- the browser stores tokens in browser-readable storage today
- Google sign-in currently exchanges an ID token directly with `/auth/google`
- magic-link sign-in currently lands on `/auth/callback`
- the API currently parses cookies but does not yet implement cookie-issued
  browser auth sessions

### Phase 3. Tests, Tooling, CI, And Deployment

Migrate unit tests, Playwright runtime, Docker build, and CI to the new web
stack. Only after replacement paths exist should old tooling be deleted.

### Phase 4. Mechanical Repo Cutover

Do the path/package rename only after the replacement runtime, tests, and
deployment flow are green.

This cutover must be atomic across root scripts, Docker, CI, Playwright,
workspace filters, helper scripts, and docs:

- `apps/app -> apps/web`
- `@huishype/app -> @huishype/web`
- all hardcoded path and package references

### Phase 5. Archive And Final Audit

Delete dead code, archive stale docs, and run the final policy gates.

## Workstreams

### WS1. Policy, Docs, And Archive Boundary

**Scope**

- Align active docs and plans to the web-first architecture.
- Make the native-doc exception explicit.
- Define what moves to `docs/archive/**`.
- Replace contradictory Expo/native guidance in active docs.
- Treat active docs under `docs/issues/**`, `docs/plans/**`,
  `docs/superpowers/specs/**`, and any other non-archived documentation as
  part of the policy surface, not as a narrow exception list.

**Must-update files**

- `docs/plans/2026-04-13-web-first-architecture-switch-implementation-high-level-plan.md`
- `docs/plans/2026-04-13-web-first-architecture-switch-implementation-plan-runbook.md`
- `agent-rules/platform-architecture.md`
- `agent-rules/software-stack.md`
- `agent-rules/main-spec.md`
- `agent-rules/test-requirements.md`
- `README.md`
- `AGENTS.md`
- `QUICK-COMMANDS.md`
- `CLAUDE.md`
- `GEMINI.md`
- `DEFERRED-GAPS.md`
- `docs/deploy.md`
- `.github/workflows/ci.yml`
- `tools/README.md`
- `tools/dev-android.sh`
- `tools/sync-maplibre-fork.sh`
- `apps/app/README.md` until it is replaced or archived
- `apps/web/README.md` or equivalent active web workflow doc
- `apps/android/README.md`
- `apps/ios/README.md`
- `agent-rules/SHADER-LOCAL-DEV.md`
- `agent-rules/manual-testing-mcp.md`
- `docs/visual-overhaul-artifacts.md`
- `docs/visual-overhaul-sprint-prompt.md`
- `docs/issues/visual-overhaul-review-todo.md`
- `docs/issues/_FIXED_native-shader-parity/**`
- `docs/superpowers/specs/2026-03-21-visual-overhaul-sprint-plan.md`
- every additional active doc surfaced by the repo-wide active-doc grep
  outside `docs/archive/**`

**Acceptance**

- No active doc outside `docs/archive/**` claims Expo/native regeneration is the
  current product workflow.
- `docs/archive/` exists and archive-only policy gates target the archive tree
  recursively, not as a one-level glob.
- The doc-policy gate is two-stage:
  1. evergreen active docs and active tooling docs stay clean during the sprint
  2. the broad non-archived-doc grep is enforced only at closeout after WS10
     archives stale plans, issue logs, and completed migration docs
- The current Expo/native workflow doc is replaced by `apps/web/README.md` or
  an equivalent active web workflow doc that defines local dev, build, test,
  and deploy for the active client.
- The only allowed future-native TODO zone is `apps/android/README.md` and
  `apps/ios/README.md`.
- Contradictory native/Expo docs are archived or rewritten.
- Historical issue logs and closed planning/TODO docs are archived before the
  final grep gate if they still contain legacy-runtime or migration language.
- `DEFERRED-GAPS.md` is not used to defer any part of this architecture switch.
- No active operator tool or tool README still advertises Expo/Metro Android
  bootstrap or the React Native MapLibre fork as the current workflow.
- `visual-overhaul:package` and
  `scripts/visual-overhaul/package-artifact.mjs` are explicitly resolved:
  either rewritten for web-only artifact packaging or archived/deleted. No
  ambiguous mobile-oriented packaging path remains in active docs or scripts.
- Mobile artifact and mobile E2E surfaces are explicitly resolved together:
  `test:e2e:mobile`,
  `test:all`,
  `scripts/visual-overhaul/run-mobile-e2e.mjs`,
  `scripts/visual-overhaul/finalize-mobile-artifacts.mjs`,
  `scripts/visual-overhaul/package-artifact.mjs`, and
  `apps/app/e2e/mobile/**`.
- `apps/android/README.md` and `apps/ios/README.md` exist and already contain
  the future-native contract extracted from the current Expo-era sources before
  those sources are retired.

### WS2. Mechanical Repo Cutover

**Scope**

- Rename `apps/app` to `apps/web`.
- Rename `@huishype/app` to `@huishype/web`.
- Update every hardcoded path and package reference.
- Perform the rename only after the replacement runtime, root test gate,
  Playwright runtime, and deployment path already work without Expo.
- Land the rename as one atomic cutover rather than as a partial path drift.

**Must-update surfaces**

Current-to-target path map for this workstream:

- `apps/app/** -> apps/web/**`
- `apps/app/playwright.config.ts -> apps/web/playwright.config.ts`
- `apps/app/Dockerfile.web -> apps/web/Dockerfile`
- `@huishype/app -> @huishype/web`

- `package.json`
- `pnpm-lock.yaml`
- `turbo.json`
- `playwright.config.ts`
- `apps/app/playwright.config.ts` or its replacement
- `docker-compose.prod.yml`
- `services/api/Dockerfile`
- `apps/app/Dockerfile.web` or its replacement
- `.env.production.example`
- `.env.example`
- root `index.js` or its replacement
- `scripts/playwright/run-playwright-project.mjs`
- `scripts/playwright/integration-runtime.mjs`
- `tools/sync-maplibre-gl-fork.sh`
- all docs/scripts/workflow references

**Acceptance**

- No active script or config points at `apps/app` or `@huishype/app`.
- The rename does not break `pnpm test`, Playwright, Docker build, or CI at any
  intermediate point.
- The rename happens after the replacement runtime/tooling path is already
  proven, not before.

### WS3. Web Runtime Replacement

**Scope**

- Replace Expo Router entrypoints with Vite + React Router.
- Replace RN/RNW primitives with web-native React/DOM components.
- Replace NativeWind and RN styling with the final web styling stack:
  Tailwind CSS for web utility classes, shared CSS variables, and plain
  CSS/CSS modules where utility classes are the wrong abstraction.
- Remove Metro/Babel/Expo runtime glue.
- Replace the current Expo Router shell semantics, not just the route files.
- Remove navigation/runtime coupling from shared app modules that currently
  import `expo-router` or depend on Expo tab/shell conventions.
- Replace the current navigation lifecycle semantics, including modal history,
  focus/blur behavior, route transitions, catch-all address routing, and
  browser back/forward integration.
- Treat current `.web` route/component implementations as the canonical browser
  behavior to preserve and rehome, not as dead compatibility layers to rewrite
  indiscriminately.
- Treat the current Metro stubs, `.native.*` branches, Expo Router coupling,
  and RN/RNW-only abstractions as the compatibility burden to delete.
- Audit and port the unsuffixed web-active RN components that currently still
  render through `react-native` primitives. The runtime rewrite is not complete
  until those surfaces are rehomed to DOM/web-native implementations too.

**Add**

- `apps/app/index.html` before cutover, then `apps/web/index.html`
- `apps/app/vite.config.ts` before cutover, then `apps/web/vite.config.ts`
- `apps/app/src/main.tsx` before cutover, then `apps/web/src/main.tsx`
- `apps/app/src/router/**` before cutover, then `apps/web/src/router/**`
- `apps/app/src/styles/**` before cutover, then `apps/web/src/styles/**`

**Delete/replace**

- `apps/app/app/**` before cutover, then `apps/web/app/**`
- Expo router entry glue
- root `index.js`
- `apps/app/app/+html.tsx` before cutover, then `apps/web/app/+html.tsx`
- `apps/app/app/+not-found.tsx` before cutover, then `apps/web/app/+not-found.tsx`
- `apps/app/app/_layout.tsx` before cutover, then `apps/web/app/_layout.tsx`
- `apps/app/app/(tabs)/_layout.tsx` before cutover, then `apps/web/app/(tabs)/_layout.tsx`
- `apps/app/metro.config.js` before cutover, then `apps/web/metro.config.js`
- `apps/app/babel.config.js` before cutover, then `apps/web/babel.config.js`
- Expo web-only bootstrapping files
- tailwind/nativewind wiring that exists only for RN compatibility
- `apps/app/src/bootstrap/styles.web.ts` before cutover, then `apps/web/src/bootstrap/styles.web.ts`
- Expo Router coupling inside runtime/navigation modules currently owned by:
  `apps/app/src/hooks/useMapInteraction.ts`,
  `apps/app/src/components/navigation/CustomTabBar.tsx`,
  `apps/app/src/components/navigation/ScreenHeader.tsx`, and route/layout
  modules under `apps/app/app/**` before cutover, then the corresponding
  `apps/web/**` paths
- unsuffixed RN-owned browser-active surfaces that must move to the final
  web-native runtime, including:
  `apps/app/src/components/SearchBar.tsx`,
  `apps/app/src/components/PropertyContent.tsx`,
  `apps/app/src/components/PropertyImageSurface.tsx`,
  `apps/app/src/components/NotificationBell.tsx`,
  `apps/app/src/components/navigation/MapGradient.tsx`,
  `apps/app/src/components/navigation/LocationButton.tsx`,
  `apps/app/src/components/PropertyPreviewCard.tsx`,
  `apps/app/src/components/GroupPreviewCard/GroupPreviewCard.tsx`,
  `apps/app/src/utils/api.ts`, and the corresponding `apps/web/**` paths after
  cutover
- known platform-split/browser-owned surfaces that must be rehomed into the
  final web-only structure:
  `apps/app/src/components/ui/ResponsivePanel.web.tsx`,
  `apps/app/src/components/ui/BlurContainer.web.tsx`,
  `apps/app/src/components/ui/BlurContainer.native.tsx`,
  `apps/app/src/components/ui/Icon.web.tsx`,
  `apps/app/src/components/ui/Icon.native.tsx`,
  `apps/app/src/components/PropertyBottomSheet/PropertyBottomSheet.web.tsx`,
  `apps/app/src/components/PropertyBottomSheet/PropertyBottomSheet.native.tsx`,
  and `apps/app/src/lib/currentLocation.ts`, then the corresponding
  `apps/web/**` paths after cutover

**Canonical migration inputs**

- preserve and rehome the current browser UX implemented in:
  `apps/app/app/(tabs)/index.web.tsx`,
  `apps/app/src/components/ui/ResponsivePanel.web.tsx`,
  `apps/app/src/components/ui/BlurContainer.web.tsx`, and
  `apps/app/src/components/PropertyBottomSheet/PropertyBottomSheet.web.tsx`,
  `apps/app/src/components/WebPreviewMarkerPortal.tsx`, and the browser map
  behavior currently embedded in web-only map chrome/components,
  then move that behavior to the final `apps/web/**` structure in WS2

**Acceptance**

- The app starts through Vite.
- No `expo-router`, `ExpoRoot`, `require.context`, or `react-native` imports
  remain in the active app runtime.
- Equivalent web-native replacements exist for the current HTML shell,
  not-found handling, tab shell, modal/panel navigation semantics, and
  catch-all address route behavior.
- The final route tree preserves the behavior currently implemented in the
  existing `.web` map shell, responsive panel, and property sheet.

### WS4. Portable Contract Audit And Extraction

**Scope**

- Audit app-local modules and move genuinely portable logic into shared
  packages.
- Keep rendering, DOM interaction, and browser adapters inside `apps/web`.
- Create `packages/design-tokens` only if the extracted token surface is stable
  and genuinely cross-client.

**Extraction rule**

- Do not extract modules just because they are pure or small.
- Leave React hooks, browser service adapters, router-shape helpers, and other
  web-owned implementation details in `apps/web` unless there is a clear future
  native benefit to sharing them.
- Extract only stable contracts, rules, types, validation, formatting, and
  genuinely reusable product semantics.

**Audit targets include**

- `apps/web/src/services/address-resolver.ts`
- `apps/web/src/utils/property-route.ts`
- `apps/web/src/hooks/useMapCityName.ts`
- `apps/web/src/lib/authModalCopy.ts`
- map metadata and route-encoding helpers

The list above is an audit list, not a mandatory extraction list.

**Acceptance**

- Portable rules and contracts live outside the web app where justified.
- Shared packages remain framework-free and do not import from `apps/web`.
- No forced token-package extraction happens unless it improves the final
  architecture.
- `packages/api-client` ends the sprint without owning browser session
  persistence, browser cookie management, or browser-readable token storage.
  If non-browser consumers still require transient in-memory token support,
  that behavior remains explicitly separated from the browser path and its
  contract is documented as such.
- Verification covers the final extracted surfaces in `packages/shared` and
  `packages/api-client`, including typecheck/test pass plus representative
  consumers in `apps/web` and `services/api`.
- `packages/api-client` is simplified rather than expanded: generated OpenAPI
  types remain canonical, request helpers stay thin, and browser session
  ownership does not drift back into a handwritten SDK.
- Prefer the already-installed `openapi-fetch` path for thin typed request
  helpers over growing the current handwritten wrapper.

**Verification**

- `pnpm --filter @huishype/shared typecheck`
- `pnpm --filter @huishype/api-client typecheck`
- If `packages/design-tokens` exists: `pnpm --filter @huishype/design-tokens typecheck`

### WS5. Browser Auth, Session, Env, And Backend Contract Cleanup

**Scope**

- Rewrite the current browser auth architecture from the verified bearer-token
  + browser-readable-storage model to browser-native cookie-backed sessions for
  the active web client.
- Replace `EXPO_PUBLIC_*` with `VITE_*`.
- Clean up backend auth/env assumptions that still encode Expo/native behavior
  and any browser-facing bearer-token assumptions.
- Explicitly choose and document the final browser session ownership model.

**Locked auth decision**

- The current browser client path is bearer-token based today; this sprint
  changes the browser-facing contract so the active web client uses
  cookie-backed browser sessions as the final model.
- The current browser client stores tokens in browser-readable storage today;
  the final active web client must not.
- `apps/web` does not persist access tokens or refresh tokens in
  `localStorage`, `sessionStorage`, IndexedDB, or another browser-readable
  token store.
- This cookie-backed session model is the final browser contract. If future
  native clients keep a token-based contract, that support must be explicitly
  separated from the browser path rather than hidden behind one ambiguous
  shared auth layer.
- `packages/api-client` must not own browser cookie/session persistence or
  browser-readable token storage. Any remaining non-browser transient auth
  support must be explicitly scoped and documented.
- After the rewrite, Google browser sign-in uses a web-native Google browser
  flow and exchanges the returned Google credential/ID token with
  `/auth/google`, which establishes the browser cookie-backed session.
- After the rewrite, magic-link sign-in continues to land on `/auth/callback`
  (or its equivalent final browser route), which verifies the emailed token and
  completes browser session bootstrap.
- Current verified flow before this rewrite:
  Google sign-in exchanges an ID token directly with `/auth/google`, while
  magic-link sign-in lands on `/auth/callback`.
- `/auth/callback` is not a forced shared completion route for Google unless
  the chosen final browser Google implementation genuinely requires it.
- Apple sign-in is not part of the active web client in this sprint. Any
  remaining Apple/native contract is isolated to native handoff docs and
  backend capability that does not impose Expo-era env defaults on the active
  web path.
- The backend currently has cookie parsing support but not a finished
  cookie-issued browser auth session implementation. This workstream must add
  the cookie auth/session behavior explicitly instead of assuming it already
  exists.
- The browser auth migration is coordinated across API route contracts,
  cookie issuance and clearing, cookie attributes across subdomains, CSRF/origin
  policy, OpenAPI/client/mocks/test rewrites, removal of token storage, and
  browser callback handling. Do not leave parallel bearer-token and
  cookie-session paths alive in the browser.

**Must-update surfaces**

- `apps/app/src/providers/AuthProvider.tsx` before cutover, then
  `apps/web/src/providers/AuthProvider.tsx`
- `apps/app/src/hooks/useAuth.ts` before cutover, then
  `apps/web/src/hooks/useAuth.ts`
- `apps/app/src/hooks/useApiClient.ts` before cutover, then
  `apps/web/src/hooks/useApiClient.ts`
- `apps/app/src/utils/api.ts` before cutover, then `apps/web/src/utils/api.ts`
- `packages/api-client/src/client.ts`
- `packages/mocks/src/handlers/auth.ts`
- `packages/mocks/src/handlers/email-auth.ts`
- auth routes/callback handlers
- `apps/app/app/auth/callback.tsx` before cutover, then
  `apps/web/.../auth/callback` or its replacement route module
- `services/api/src/app.ts`
- `services/api/src/routes/auth.ts`
- `services/api/src/routes/email-auth.ts`
- `services/api/src/config.ts`
- `services/api/src/plugins/swagger.ts`
- `services/api/.env.example`
- OpenAPI auth schemas and generated client artifacts
- `packages/mocks`
- Docker/build-time env wiring
- any new route-loader/session-bootstrap layer if auth responsibility moves out
  of the provider

**Required outcomes**

- Remove `expo-auth-session`, `expo-secure-store`, `expo-web-browser`,
  `expo-linking`, `expo-constants`, and `expo-crypto`.
- The final browser session lifecycle is owned explicitly by one browser
  architecture and uses cookie-backed sessions. It is not split ambiguously
  across provider state, route loaders, localStorage token persistence, a
  second token-aware API client, or a hidden bearer-token fallback path.
- The active browser request path uses `credentials: 'include'` and does not
  auto-attach `Authorization: Bearer ...` headers from browser-held token
  state.
- `packages/api-client` ends with an explicit browser-cookie request path and,
  only if still needed, a separate explicit non-browser token-aware request
  path. One ambiguous mixed browser/non-browser auth client is not allowed.
- The current browser-only bearer-token surfaces are removed together from the
  active browser path:
  provider token storage, `utils/api` authorization injection,
  `useApiClient` token refresh/sign-out coupling, and token-aware behavior in
  `packages/api-client` where that behavior is browser-owned.
- Remove backend fallbacks such as Expo-native callback assumptions from the
  active web/browser model.
- Remove Expo-era browser env conventions from the active web path only after
  the replacement browser flow is live. If native-oriented callback/env support
  remains necessary for the future native contract, isolate it from active web
  docs and browser flow rather than deleting it blindly before the rewrite is
  complete.
- Browser storage/session behavior is explicit and documented, including the
  fact that tokens are not stored in browser-readable storage for the active
  web app and that cookies are issued and cleared by the API as part of the
  session lifecycle.
- Google auth behavior is preserved end to end, including login initiation,
  credential/ID-token exchange with `/auth/google`, session establishment,
  failure handling, and the cookie/session handoff.
- Magic link behavior is preserved end to end, including email link landing on
  the active web callback route, token exchange, cookie/session issuance, and
  post-login redirect.
- API route contracts, OpenAPI output, generated client code, mocks, and tests
  all reflect the cookie-session model and no longer describe browser auth as a
  client-held bearer token flow.
- OpenAPI and generated clients explicitly document the browser cookie-session
  contract and any remaining non-browser token contract as separate auth modes,
  not one implicit bearer-only surface.
- CSRF and origin handling is explicit for cookie-authenticated browser
  requests, with no permissive Expo-era callback fallback left in the active
  web path.
- The browser auth rewrite does not introduce a second bespoke session
  framework on top of the existing Fastify cookie/JWT primitives unless a
  concrete requirement is documented first.
- If OAuth/token verification code is touched, prefer standard auth/JWT
  libraries over expanding the current handwritten verification flow.

**Verification**

- Web unit tests covering auth/session lifecycle
- Playwright auth flow
- API integration tests covering cookie issuance, cookie refresh/session
  continuity, logout clearing, and unauthorized browser request handling
- before cutover:
  `rg -n "localStorage\\.(setItem|getItem|removeItem)|sessionStorage\\.(setItem|getItem|removeItem)|indexedDB" apps/app`
- after cutover:
  `rg -n "localStorage\\.(setItem|getItem|removeItem)|sessionStorage\\.(setItem|getItem|removeItem)|indexedDB" apps/web`
- final env grep:
  `rg -n "EXPO_PUBLIC_|expo-auth-session|expo-web-browser|expo-secure-store|expo-linking|expo-constants|expo-crypto" apps packages services scripts tools docker-compose.prod.yml .env.production.example .env.example --glob '!pnpm-lock.yaml' --glob '!apps/android/README.md' --glob '!apps/ios/README.md'`

### WS6. Map Surface Port

**Scope**

- Keep the web MapLibre fork as the canonical map engine.
- Remove RN wrapper integration and Metro stubs.
- Port map-adjacent UI to web-native implementations.
- Optimize for the best final web architecture, not for minimizing rewrite
  volume. If the cleanest end state requires re-porting parts of the map
  surface, do that.

**Sequencing rule**

- Preserve the current browser map behavior first, isolate it into the new
  single web bundle, and only then delete the native wrapper/stub path.
- Do not delete `src/stubs/**` or the RN wrapper assumptions before the new
  web-only bundle proves that the browser map shell still works end to end.

**Must-update surfaces**

- map routes/components/hooks
- `src/stubs/**`
- location/current-position logic
- preview card, bottom sheet/panel, quick actions, search, clustering UI

**Acceptance**

- Web map behavior remains intact.
- No `@maplibre/maplibre-react-native`, `LocationManager`, or Metro stub path
  remains in the active app.
- Verification covers clustering, preview cards, quick actions, search, and
  bottom sheet/panel behavior on the final web runtime.

**Verification**

- Playwright integration and visual map suites
- `rg -n "@maplibre/maplibre-react-native|LocationManager|src/stubs" apps/web`

### WS7. Route And UI Port Completion

**Scope**

- Port all non-map routes to web-native components.
- Collapse `.native.*` / `.web.*` file splits into single web implementations.
- Remove RN-specific hooks/components and tests.
- Replace the current app-shell semantics, not just route file contents.
- Rehome the behavior of current `.web` implementations into the final
  unsuffixed web-only files before deleting the suffix split.
- Complete the port as one coupled browser-app migration with WS3, WS5, and
  WS6 where navigation, auth, map panels, and route history still share state
  and behavior.

**Required route coverage**

- root app shell replacement for current `_layout`
- tab shell replacement for current `(tabs)/_layout`
- `/`
- `/feed`
- `/saved`
- `/profile`
- `/property/:id`
- `/comments/:propertyId`
- `/guesses/:propertyId`
- `/leaderboard`
- `/notifications`
- `/user/:id`
- `/auth/callback`
- catch-all address route
- not-found handling
- HTML/document shell customization currently owned by `+html`
- intentional internal/showcase routes, if kept

**Known port targets**

- `apps/web/src/components/navigation/CustomTabBar.tsx`
- `apps/web/src/components/navigation/ScreenHeader.tsx`
- `apps/web/src/components/SearchBar.tsx`
- `apps/web/src/components/PropertyContent.tsx`
- `apps/web/src/components/PropertyImageSurface.tsx`
- `apps/web/src/components/NotificationBell.tsx`
- `apps/web/src/components/navigation/MapGradient.tsx`
- `apps/web/src/components/navigation/LocationButton.tsx`
- `apps/web/src/components/PropertyPreviewCard.tsx`
- `apps/web/src/components/GroupPreviewCard/GroupPreviewCard.tsx`
- `apps/web/src/components/ui/ResponsivePanel.web.tsx`
- `apps/web/src/components/ui/BlurContainer.web.tsx`
- `apps/web/src/components/ui/BlurContainer.native.tsx`
- `apps/web/src/components/ui/Icon.web.tsx`
- `apps/web/src/components/ui/Icon.native.tsx`
- `apps/web/src/components/PropertyBottomSheet/PropertyBottomSheet.web.tsx`
- `apps/web/src/components/PropertyBottomSheet/PropertyBottomSheet.native.tsx`
- `apps/web/src/lib/currentLocation.ts`

**Acceptance**

- No `react-native` import remains anywhere in `apps/web/src`.
- No `.native.*` file remains in `apps/web`.
- No `.web.*` split remains in `apps/web`; browser behaviors currently housed
  there have been rehomed into the final web-only file layout first.
- All required active routes render through web-native components and the final
  web styling system.

**Verification**

- `find apps/web -type f \\( -name '*.native.ts' -o -name '*.native.tsx' \\)`
- `find apps/web -type f \\( -name '*.web.ts' -o -name '*.web.tsx' \\)`
- web unit/component tests
- Playwright flows

### WS8. Test, Tooling, And CI Rewrite

**Scope**

- Replace Expo/Jest-RN testing setup with web-native test setup.
- Rewrite Playwright runtime around Vite.
- Remove mobile E2E from active gates.
- Only delete old helpers after replacements are proven.
- Keep `pnpm test:e2e:web`.
- Keep `pnpm test:all`, but redefine it as all active-platform checks only:
  repo gates plus active web tests. It must not call legacy mobile E2E.

**Must-update surfaces**

- `package.json`
- `apps/web/package.json`
- `apps/web/vitest.config.ts`
- `apps/web/jest.*` if retained temporarily during migration, then delete
- `playwright.config.ts`
- `apps/web/playwright.config.ts`
- `apps/app/e2e/mobile/**` before cutover, then `apps/web/e2e/mobile/**`
- `scripts/playwright/**`
- `scripts/playwright/static-web-server.mjs`
- `.github/workflows/ci.yml`
- `scripts/visual-overhaul/package-artifact.mjs`
- `scripts/visual-overhaul/run-mobile-e2e.mjs`
- `scripts/visual-overhaul/finalize-mobile-artifacts.mjs`
- `agent-rules/test-requirements.md`
- `agent-rules/manual-testing-mcp.md`
- `tools/shader-screenshot-loop.mjs`
- `tools/shader-screenshot-debug-colors.mjs`
- any helper that still edits `apps/app/**` or assumes Metro/Expo web serving

**Important sequencing rule**

Move these with the first working Vite shell rather than leaving them to a late
cleanup phase:

- root `playwright.config.ts`
- `scripts/playwright/run-playwright-project.mjs`
- `scripts/playwright/integration-runtime.mjs`
- `scripts/playwright/static-web-server.mjs`
- the direct `pnpm test` / `pnpm test:e2e:web` web bootstrap path

Do not leave Expo/Metro-backed Playwright as the only runnable web verification
path after the new runtime exists.

Do not delete these until the replacement path exists and passes:

- `scripts/visual-overhaul/run-mobile-e2e.mjs`
- `scripts/visual-overhaul/finalize-mobile-artifacts.mjs`
- `scripts/visual-overhaul/package-artifact.mjs`
- `tools/dev-android.sh`
- `tools/sync-maplibre-fork.sh`
- `tools/shader-screenshot-loop.mjs`
- `tools/shader-screenshot-debug-colors.mjs`
- `apps/app/e2e/mobile/**` before cutover, then `apps/web/e2e/mobile/**`

**Acceptance**

- `pnpm test` remains the canonical gate and is redefined so it includes the
  final web bootstrap/runtime check for the active client.
- `pnpm test:e2e:web` remains as the direct entrypoint for the full web
  bootstrap/runtime suite and is also exercised by CI.
- CI explicitly runs `pnpm test` and `pnpm test:e2e:web` on the final active
  web stack. Broader checks remain available through `pnpm test:all`.
- `pnpm test:all` runs only active-platform coverage: repo gates plus active
  web tests. It does not invoke Maestro or any retired mobile E2E path.
- Playwright no longer starts Expo or Metro.
- The root Playwright runtime and any package-local Playwright config both stop
  advertising Expo/Metro boot paths.
- Console-error gating is literal for the final web runtime; no Metro/HMR
  exemptions survive because Metro/HMR are gone.
- `visual-overhaul:package` /
  `scripts/visual-overhaul/package-artifact.mjs` is either web-only and proven
  on the final artifact flow or removed from the active toolchain.
- The Playwright/runtime rewrite does not retain or replace Expo with another
  custom SPA-serving layer when Vite-native dev/preview serving or a standard
  static file server covers the requirement.
- Shader/debug helper scripts no longer encode Metro cache clearing, Expo web
  URLs, or pnpm-store patch flows that assume the old runtime.
- Any active test or tooling docs that mention Expo-era web service names or
  Metro startup are rewritten, archived, or explicitly closed out along with
  the code change that replaced them.

### WS9. Deployment Rewrite

**Scope**

- Replace Expo static export deployment with a Vite-based build + static serve
  pipeline.
- Rewrite Docker, local-dev, systemd-service, and deploy docs accordingly.
- Replace Expo-era service and workflow references in root docs and local
  workflow docs so the web runtime is the only documented active path.

**Must-update surfaces**

- `apps/web/Dockerfile`
- `docker-compose.prod.yml`
- `services/api/Dockerfile`
- `.env.production.example`
- `.env.example`
- `docs/deploy.md`
- `README.md`
- `AGENTS.md`
- `QUICK-COMMANDS.md`
- `CLAUDE.md`
- `GEMINI.md`
- any deploy helper scripts

**Acceptance**

- Web production build does not invoke `expo export --platform web`.
- Build args and env vars use the web runtime model, not Expo conventions.
- No build or deploy path still depends on `apps/app`, Expo export, or
  `EXPO_PUBLIC_*` env names.
- Local-dev and service docs describe the Vite/web workflow, including the
  replacement for Metro/systemd assumptions and the active service name used to
  start and restart the browser dev server.
- Expo-era service references such as `huishype-expo`, Metro restart commands,
  and web-export instructions are replaced everywhere they are still active.
- The final web build/serve path uses Vite-native output handling plus standard
  serving primitives rather than a repo-specific custom SPA server.

### WS10. Legacy Surface Removal And Archive

**Scope**

- Delete dead Expo/native implementation surfaces.
- Archive historical docs.
- Archive closed historical TODO/planning docs or explicitly exclude them from
  the active-doc policy surface rather than preserving them as active work
  items.
- Leave only future-native handoff docs in `apps/android/README.md` and
  `apps/ios/README.md`.

**Delete/retire targets include**

- root `index.js` Expo entrypoint
- `apps/web/app.json`
- `apps/web/eas.json`
- `apps/web/metro.config.js`
- `apps/web/babel.config.js`
- `apps/web/jest.config.js`
- `apps/web/jest.setup.js`
- `apps/web/expo-env.d.ts`
- `apps/web/nativewind-env.d.ts`
- `apps/web/android/**`
- `apps/web/ios/**`
- `apps/web/e2e/mobile/**`
- `tools/dev-android.sh`
- `tools/sync-maplibre-fork.sh`
- `tools/shader-screenshot-loop.mjs` if not rewritten for the final web stack
- `tools/shader-screenshot-debug-colors.mjs` if not rewritten for the final web
  stack
- `scripts/visual-overhaul/package-artifact.mjs` if not kept as a web-only
  artifact packager
- Expo/RN mocks no longer needed by the final test stack

**Archive targets include**

- conflicting Expo/native plans
- completed or explicitly closed issue logs that are no longer active work
  guidance
- old visual-overhaul docs that still prescribe Android parity or Maestro as an
  active gate
- stale shader/dev notes that encode Metro workflows
- retired Expo/native helper docs for `tools/dev-android.sh` and
  `tools/sync-maplibre-fork.sh`, unless rewritten around active web-only flows

## Parallel Execution Plan

### Phase A

Run in parallel:

- WS1 Policy/docs/archive boundary
- native handoff-doc creation and contract extraction from Expo-era sources

### Phase B

While the app is still at the existing path:

- WS4 Portable contract audit may run in parallel with frontend work only when
  the write scope is clearly disjoint.
- WS3 Web runtime replacement, WS5 Auth/env/backend cleanup, WS6 Map surface
  port, and WS7 Route/UI port completion should default to a coordinated
  sequential browser-app migration unless the ownership boundaries are
  genuinely independent.

### Phase C

After the new shell exists:

- finish the coupled WS3/WS5/WS6/WS7 frontend migration
- parallelize only truly disjoint cleanup or extraction follow-up work

### Phase D

After most app surfaces land and the early Playwright/runtime bootstrap
replacement is already green:

- WS8 Test/tooling/CI rewrite
- WS9 Deployment rewrite

### Phase E

After the replacement runtime, tests, and deployment flow are green:

- WS2 Mechanical repo cutover

### Phase F

Finalize:

- WS10 Legacy removal/archive
- repo-wide grep/policy audit
- unrelated issue cleanup discovered during the sprint

## Agent Ownership Boundaries

| Lane | Write scope |
| --- | --- |
| Policy/Docs | plans, agent-rules, root docs, archive moves |
| Mechanical Cutover | path/package rename, root metadata, Docker/Playwright paths, helper-script rewrites tied to the rename |
| Runtime | Vite shell, router, global styles, runtime entrypoints |
| Shared Contracts | `packages/shared`, `packages/api-client`, optional `packages/design-tokens` |
| Auth/Env | auth providers/hooks/routes, browser session ownership, env handling, backend auth config |
| Map | map route, map hooks, search/preview/panel/location flows, map helper rewrites if needed for the best final architecture |
| Secondary Routes | feed/saved/profile/property/comments/guesses/user routes |
| Test/CI | web test setup, Playwright runtime, CI workflow |
| Cleanup/Archive | deletions, archive moves, grep gates, doc sweep |

## Final Definition Of Done

The switch is complete only when every statement below is true:

- `apps/web` is the only active frontend client in the repo.
- No active code path depends on Expo, React Native, React Native Web,
  NativeWind, Metro, Maestro, or `@maplibre/maplibre-react-native`.
- Docs, scripts, CI, local dev, and deployment all describe the same web-first
  model, and active docs outside `docs/archive/**` no longer describe Expo-era
  behavior as current.
- `apps/web/README.md` or an equivalent active web workflow doc exists, and no
  active workflow doc describes the old Expo-native app as current.
- Shared packages hold the portable contracts that are genuinely worth sharing.
- `packages/api-client` does not own browser session persistence or
  browser-readable token storage, while browser session ownership lives only in
  `apps/web`.
- The handwritten API wrapper has been removed or reduced to a thin generated
  OpenAPI request layer rather than carried forward as a growing custom SDK.
- The old Expo-native implementation is deleted or archived.
- `visual-overhaul:package` and
  `scripts/visual-overhaul/package-artifact.mjs` are either web-only or
  retired from the active toolchain.
- `pnpm test:all`, if retained, covers active-platform tests only and excludes
  legacy mobile E2E.
- No active package-local or root test/runtime helper still assumes Expo web
  export, Metro startup, Maestro as an active gate, or `apps/app` paths.
- No active package-local or root runtime helper carries forward the legacy
  custom SPA static server when Vite-native or standard serving primitives
  cover the need.
- The active web app does not persist auth tokens in browser-readable storage.
- The browser auth model is cookie-backed end to end, with API-issued cookies,
  explicit clearing on logout/session reset, and aligned OpenAPI/client/mock
  contracts.
- No parallel bespoke browser mocking layer or second custom auth/session
  framework survives alongside the existing MSW and Fastify auth primitives.
- No `.native.*` or `.web.*` split remains in the active web app.
- `apps/android/README.md` and `apps/ios/README.md` exist as the future-native
  handoff docs, and they preserve the concrete future-native contract extracted
  from the retired Expo-era implementation.
- This switch leaves no deferred architecture-switch work behind in active
  docs, scripts, code, or `DEFERRED-GAPS.md`.

## Final Verification Gate

Run all of these before closing the sprint:

Before the final grep gates run, any historical issue log, completed planning
doc, or TODO file that is no longer active work must be archived or otherwise
excluded from the active-doc policy surface. This includes architecture-switch
execution plans once the sprint is closed if they still contain migration
language or legacy-runtime references.

This verification is two-stage:

1. The evergreen active-doc grep must stay green during the sprint.
2. The broad non-archived-doc grep runs only at closeout after WS10 archives
   stale plans, issue logs, and completed migration docs.

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e:web
pnpm test:e2e:flows
pnpm test:e2e:visual
pnpm test:all
pnpm build
docker compose -f docker-compose.prod.yml build web api worker
rg -n "apps/app|@huishype/app|expo|expo-router|react-native|react-native-web|nativewind|maestro|@maplibre/maplibre-react-native|EXPO_PUBLIC_|huishype-expo|jest-expo|@testing-library/react-native|test:e2e:mobile|expo export --platform web|expo start --web|expo prebuild|expo run:android|TODO|FIXME|future work|placeholder|temporary compatibility|follow-up later" README.md AGENTS.md QUICK-COMMANDS.md CLAUDE.md GEMINI.md agent-rules package.json turbo.json playwright.config.ts docker-compose.prod.yml docs/deploy.md docs/visual-overhaul-artifacts.md docs/visual-overhaul-sprint-prompt.md tools/README.md .github/workflows/ci.yml --glob '!apps/android/README.md' --glob '!apps/ios/README.md'
find docs -path 'docs/archive' -prune -o -type f -name '*.md' -print0 | xargs -0 rg -n "apps/app|@huishype/app|expo|expo-router|react-native|react-native-web|nativewind|maestro|@maplibre/maplibre-react-native|EXPO_PUBLIC_|huishype-expo|jest-expo|@testing-library/react-native|test:e2e:mobile|expo export --platform web|expo start --web|expo prebuild|expo run:android|TODO|FIXME|future work|placeholder|temporary compatibility|follow-up later"
rg -n "EXPO_PUBLIC_|EXPO_PUBLIC_APPLE_CLIENT_ID|APP_URL|huishype://auth/callback" apps packages services scripts tools docker-compose.prod.yml .env.production.example .env.example --glob '!pnpm-lock.yaml' --glob '!apps/android/README.md' --glob '!apps/ios/README.md'
rg -n "localStorage\\.(setItem|getItem|removeItem)|sessionStorage\\.(setItem|getItem|removeItem)" apps/web
find apps/web -type f \( -name '*.native.ts' -o -name '*.native.tsx' -o -name '*.web.ts' -o -name '*.web.tsx' \)
```

Expected outcomes:

- the evergreen active-doc grep returns zero results outside the excluded files
- after WS10 archive sweep, the broad non-archived-doc grep returns zero
  results outside `docs/archive/**` and the explicitly allowed future-native
  handoff docs
- the test/tooling grep returns zero results outside the excluded files
- the deferral-marker grep returns zero results outside the excluded files
- the platform-split file search returns no files
