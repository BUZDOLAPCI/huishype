# Web-First Architecture Switch Implementation Plan

## Summary

This document defines the high-level implementation plan for moving HuisHype
from the current Expo-era shared frontend into a web-first architecture with
separate future native apps.

The target is not a partial cleanup. The target is a clean architectural
switch:

- web becomes the only active product client in the repo for now
- Expo / React Native stop being active product constraints
- Android and iOS are cleared out as current implementations
- the repo is left with a clean web app plus stable shared contracts for later
  Kotlin and Swift ports

This plan is intentionally high-level. It defines the migration shape,
workstreams, sequencing, and done state rather than a low-level task list.

## Desired End State

When this switch is complete:

- the repo has a dedicated web app with a web-native runtime and tooling stack
- product decisions, docs, scripts, and tests all describe web as the active
  frontend
- no active Expo, React Native, or mobile-runtime burden remains in the web
  path
- shared packages contain only genuinely portable contracts and business rules
- Android and iOS are no longer represented as half-maintained implementations
- the future native path is explicit: Kotlin Android app, Swift iOS app, shared
  backend contracts, shared `maplibre-native` fork

## Scope

This switch includes five kinds of change:

- documentation alignment
- frontend architecture reshaping
- web runtime simplification
- native decommissioning
- future-native readiness

This switch does not include building the actual Android or iOS apps yet.

The only allowed future-looking implementation notes are the native handoff
documents at:

- `apps/android/README.md`
- `apps/ios/README.md`

Those files are intentionally excluded from the no-TODO / no-future-work
enforcement that applies to active product surfaces.

## Architecture Target

### Product model

HuisHype becomes:

- one backend platform
- one product model
- one canonical web implementation
- two later native ports

### Client model

Target repo shape:

- `apps/web` — primary production client
- `apps/android` — future Kotlin-native app
- `apps/ios` — future Swift-native app
- `packages/shared` — portable business rules, types, formatting, validation,
  analytics schema, design tokens where appropriate
- `packages/api-client` — generated backend contract surface

### Map model

Map rendering remains product IP:

- web keeps the custom `maplibre-gl-js` fork
- Android and iOS later share the custom `maplibre-native` fork directly
- the React Native MapLibre wrapper leaves the architecture with Expo

## Migration Principles

- Do not preserve cross-platform UI abstractions once they stop helping web.
- Do not keep Android and iOS as implied parity targets during web completion.
- Do not leave behind half-supported mobile scripts, tests, or docs that imply
  active support.
- Do not move product logic into web-only implementation details if it must be
  portable later.
- Do not keep temporary compatibility layers as the final state.

## Workstreams

### 1. Source-Of-Truth Alignment

All architecture-facing docs must describe the same reality.

This pass should update at minimum:

- `agent-rules/platform-architecture.md`
- `agent-rules/software-stack.md`
- `agent-rules/main-spec.md`
- `agent-rules/test-requirements.md`
- `README.md`
- `apps/app/README.md` or its replacement in the new web app location
- any deployment, CI, or local-dev docs that still describe Expo/native as the
  active frontend model

The goal is not wording cleanup alone. The goal is to remove contradictory
guidance:

- web is the active product client
- Android and iOS are future native ports, not current parity commitments
- verification, local workflow, and repo structure should reflect that

### 2. Client Boundary Reset

The repo should stop presenting the current app as one shared runtime serving
web and native equally.

High-level changes:

- define a dedicated web app package as the only active frontend client
- either rename `apps/app` to `apps/web` directly or simplify in place first
  and rename once stable
- remove root-level assumptions that active mobile app builds are part of
  day-to-day product development
- update workspace scripts, package naming, build orchestration, and developer
  commands to make web the default frontend path

The end state should make the frontend topology obvious from the repo itself,
not just from architecture docs.

### 3. Web Runtime Simplification

This is the core engineering work of the switch.

The current web client still carries Expo / React Native decisions that were
made for cross-platform ambitions. Those should be removed where they are no
longer earning their keep.

This simplification pass should address:

- routing: move toward a web-native routing model rather than Expo router
- auth flow: replace Expo-specific auth/browser/storage abstractions with web
  implementations suitable for the standalone web app
- UI runtime: remove React Native Web compatibility layers that only exist to
  preserve mobile sharing
- styling: move toward a web-native styling approach where current RN-oriented
  tooling adds friction
- component structure: collapse `.native` / `.web` splits when only web remains
  active
- map integration: keep the web MapLibre fork, remove native map wrapper
  dependencies and stubs from the active web path
- tests: evolve component and UI tests to match the web runtime rather than the
  old shared renderer assumptions

The rule is simple: if a layer exists mainly to preserve Expo-era portability,
remove it.

### 4. Shared Contract Extraction

The web app should not become a dead-end implementation.

Before or during the cleanup, portable concerns should be made explicit and
kept outside web-only UI code:

- API contracts and generated clients
- domain models
- formatting and validation rules
- analytics event schema
- design tokens that should survive the port
- map data contracts and feature metadata

The goal is a clean split:

- web owns rendering and interaction implementation
- shared packages own reusable product contracts

This is what makes later Kotlin and Swift ports straightforward rather than
speculative rewrites.

### 5. Native Decommissioning

The current Expo-native path should be removed as an active product surface.

That includes:

- generated Android and iOS project workflows tied to Expo prebuild
- Expo-native README guidance
- mobile-specific root scripts and CI expectations that imply current support
- React Native and Expo dependencies that only exist for the old shared-client
  strategy
- `@maplibre/maplibre-react-native` from the long-term product path
- obsolete native E2E/test harness assumptions tied to the Expo app

This is not an archival exercise. The repo should clearly stop pretending that
the old Android and iOS implementation is still the current plan.

### 6. Future-Native Readiness

Removing the current native implementation should not create ambiguity about
what comes next.

The repo and docs should preserve a clear future-native contract:

- Android will be built as a Kotlin-native app
- iOS will be built as a Swift-native app
- both will consume the shared backend contracts
- both will align to the canonical product behavior defined by web
- both will integrate directly with the shared `maplibre-native` fork

This workstream should end with explicit native handoff docs in
`apps/android/README.md` and `apps/ios/README.md`, but not actual app builds
yet. Future-looking notes belong there only, not in active web/backend/shared
surfaces.

## Delivery Sequence

### Phase 1: Lock The Docs And Repo Direction

- finish the architecture alignment pass
- make the root README and developer workflow web-first
- define the target repo shape and migration boundaries
- remove contradictory statements about active native parity

### Phase 2: Extract Portable Contracts

- identify what must survive into future native ports
- move those concerns into shared packages or generated contract surfaces
- reduce accidental coupling between product rules and Expo-era app code

### Phase 3: Simplify The Web App In Place

- remove Expo/native burden from the active web path
- replace cross-platform-only abstractions with web-native choices
- collapse platform forks and delete dead branches
- keep the map experience intact on the custom web MapLibre fork

### Phase 4: Reshape The Repo Around Web

- finalize the dedicated web app package and naming
- update scripts, workspace metadata, testing paths, and CI assumptions
- make web the obvious default path for local development and deployment

### Phase 5: Decommission Legacy Native Surface

- remove Expo-native implementation remnants
- delete or archive obsolete native workflows and mobile verification paths
- leave only future-native architecture notes and shared contracts

## Definition Of Done

This switch is complete when all of the following are true:

- the repo has one clearly active frontend client: web
- no root doc describes Expo / React Native as the active frontend strategy
- no active build/test/dev workflow assumes Android or iOS parity in the
  current app
- the web app no longer depends on compatibility layers whose primary purpose
  was cross-platform reuse
- shared packages hold the portable contracts needed for later native ports
- the old Expo-native implementation is removed or clearly retired
- the future native direction is explicit, documented, and technically grounded

## Non-Goals

- building Kotlin Android screens now
- building Swift iOS screens now
- preserving React Native as an intermediate architecture out of inertia
- keeping mobile test lanes alive before there is a real native app to test
- preserving implementation-level parity with the retired Expo app

## Final Outcome

After this migration, HuisHype should feel architecturally simple again:

- one web app under active development
- one backend and one product contract
- one clear path for future Android and iOS ports

That is the intended shape: a clean, unburdened web product now, and a
future-ready foundation for Kotlin and Swift clients later.
