# 2026-04-08 Density-Aware Node Grouping Session Summary

This document records the full scope of work completed during the long-running
session that started from
`docs/plans/2026-04-08-density-aware-node-grouping-plan.md`.

It is intended as a review artifact: what changed, why it changed, what was
verified, what was reverted, and what is currently present in the uncommitted
workspace at the time of writing.

## Source Plan

Primary plan:

- `docs/plans/2026-04-08-density-aware-node-grouping-plan.md`

Core plan goal:

- Replace the hard `z17` map-node split with one canonical density-aware
  grouping system shared by vector tiles and `/properties/nearby`.
- Keep grouping server-side for web/native parity.
- Separate active and ghost grouping behavior.
- Migrate the backend contract, shared types, app interaction layer, OpenAPI,
  generated client, tests, and supporting tooling atomically.

## Final Status Snapshot

As of this write-up:

- The density-aware grouping migration itself is implemented across backend,
  shared contract, generated API client, app interaction code, mocks, and
  tests.
- The Android auth-transition stale-sheet/runtime issue found during the sprint
  was fixed at the root cause in `useMapInteraction` and the map tabs.
- Several app/runtime and harness fixes were made alongside the plan work to
  keep web/native flows testable and consistent.
- A later immersive map-surface visual experiment was explicitly reverted on
  request.
- Additional late-arriving preview-card and bottom-sheet visual refinements from
  subagents are currently present in the workspace and are summarized below.
- Current spot verification performed at the end of this write-up:
  - `pnpm -C apps/app typecheck` passed.
  - `pnpm -C apps/app test -- --runInBand src/components/__tests__/PropertyPreviewCard.test.tsx src/components/GroupPreviewCard/__tests__/GroupPreviewCard.test.tsx` passed (`55/55`).
  - `pnpm -C apps/app test -- --runInBand src/components/PropertyBottomSheet/__tests__/PropertyHeader.test.tsx src/components/PropertyBottomSheet/__tests__/PropertyContent.test.tsx src/components/PropertyBottomSheet/__tests__/PropertyBottomSheet.test.tsx app/property/__tests__/[id].test.tsx` passed for the three matching bottom-sheet suites (`28/28`).
- The full top-level `pnpm test` gate had passed earlier in the session before
  the later immersive experiment and before the final late-arriving visual
  edits; it was not rerun after those later changes.

## What Was Implemented

## 1. Canonical density-aware grouping backend

Root cause addressed:

- The old system hard-switched at `z17` from grouped active points to fully
  ungrouped active plus ghost singles.
- Tile rendering and `/properties/nearby` did not share one grouping engine.
- Grouping semantics were grid-based in geographic space rather than based on
  visual footprint in tile-local space.

What changed:

- Added a new canonical grouping engine in
  `services/api/src/services/property-grouping.ts`.
- The engine projects candidates into tile-local world/MVT space instead of
  relying on `ST_SnapToGrid` as the final grouping primitive.
- Grouping now uses one active pass and one ghost-only pass.
- Ghost grouping remains gated behind the existing ghost reveal zoom.
- Ghosts are never merged into active groups.
- Active occupancy suppresses conflicting ghosts before ghost grouping.
- Final grouped features choose a representative anchor and tile ownership is
  determined from the anchor inside the unbuffered tile bounds.
- The engine computes preview members, counts, aggregate activity, and bounds
  for grouped results.
- `/tiles` and `/properties/nearby` now both consume this same engine instead of
  reimplementing separate grouping rules.

Why this is the correct fix:

- It removes the binary zoom split called out in the plan.
- It keeps web/native parity by making the backend the single source of truth.
- It makes cluster vs single behavior data-driven from final emitted metadata
  rather than inferred from zoom.

Key files:

- `services/api/src/services/property-grouping.ts`
- `services/api/src/services/property-grouping.test.ts`
- `services/api/src/routes/tiles.ts`
- `services/api/src/routes/properties.ts`
- `services/api/src/__tests__/properties-nearby.test.ts`
- `services/api/src/__tests__/integration/tiles.integration.test.ts`

## 2. Final map contract migration

Root cause addressed:

- The old layer contract and feature metadata assumed the old zoom split.
- Web/native queryable layer lists and helper code still depended on legacy
  assumptions.

What changed:

- Added shared map configuration in
  `packages/shared/src/config/property-map.ts`.
- Centralized the final layer IDs:
  - `property-clusters`
  - `cluster-count`
  - `active-nodes`
  - `ghost-clusters`
  - `ghost-cluster-count`
  - `ghost-nodes`
- Centralized shared map behavior constants:
  - active single/cluster footprint stops
  - ghost single/cluster footprint stops
  - ghost reveal zoom
  - nearby tap tolerance
  - preview member limit
- Updated shared property grouping types in
  `packages/shared/src/types/property.ts`.
- Re-exported the new config and types through the shared package index files.
- Updated OpenAPI and regenerated the API client.

Why this is the correct fix:

- It removes contract drift between backend, app code, tests, and mocks.
- The same constants now drive grouping semantics and client expectations.

Key files:

- `packages/shared/src/config/property-map.ts`
- `packages/shared/src/config/index.ts`
- `packages/shared/src/types/property.ts`
- `packages/shared/src/types/index.ts`
- `packages/shared/package.json`
- `services/api/openapi.json`
- `packages/api-client/generated/api.ts`

## 3. App interaction migration to grouped metadata

Root cause addressed:

- The app still carried old zoom-split assumptions in feature handling and layer
  querying.
- Nearby fallback results and rendered feature results did not normalize into
  one shared model.

What changed:

- Reworked `apps/app/src/utils/api.ts` to:
  - replace the old `fetchNearbyProperty` and `fetchNearbyCluster` assumptions
    with grouped nearby results,
  - normalize `/properties/nearby` transport into a shared grouped node shape
    that matches the API's camelCase JSON contract,
  - normalize rendered vector-tile features into the same shape.
- `apps/app/src/hooks/useMapInteraction.ts` was updated so cluster vs single
  behavior is driven by final feature metadata rather than the old zoom split.
- Map layer helper code and visual helpers were updated to the final layer
  contract.
- Web/native map screens were updated to use the new queryable layers and
  shared interaction semantics.

Why this is the correct fix:

- App behavior now follows the final grouped contract instead of guessing from
  zoom thresholds.
- The transport contract is now explicit: internal grouped semantics stay
  canonical, while JSON transport follows the API's camelCase field names.
- Nearby fallback and rendered-feature taps resolve through the same conceptual
  shape.

Key files:

- `apps/app/src/utils/api.ts`
- `apps/app/src/hooks/useMapInteraction.ts`
- `apps/app/src/hooks/useClusterPreview.ts`
- `apps/app/app/(tabs)/index.tsx`
- `apps/app/app/(tabs)/index.web.tsx`
- `apps/app/e2e/visual/helpers/map-layer-names.ts`

## 4. Android auth-transition and stale-selection fix

Root cause addressed:

- During auth-gated actions, transient preview/bottom-sheet state could survive
  into the auth transition and leave stale property selection or crash-prone UI
  behavior on native.

What changed:

- Added `handleAuthStarting()` and `resetTransientUI()` to
  `useMapInteraction`.
- `selectedPropertyForSheet` now returns `null` when there is no selected
  property ID or no loaded property, preventing stale sheet data from leaking
  through.
- Map tab cleanup now clears transient UI on blur/focus transitions.
- Added focused regression coverage for the stale-sheet/auth-start path.

Why this is the correct fix:

- It clears the transient state at the actual lifecycle boundary that was
  causing the issue, instead of hiding symptoms later.

Key files:

- `apps/app/src/hooks/useMapInteraction.ts`
- `apps/app/src/hooks/__tests__/useMapInteraction.test.ts`
- `apps/app/app/(tabs)/index.tsx`

## 5. Search, geocode, and map-surface support fixes

These changes were not optional side polish. They were made because the sprint
surfaced real gaps in the map/search interaction and its testability.

What changed:

- `SearchBar` was reworked to improve native focus behavior.
  - Added an explicit native focus target when the blurred unfocused state is
    shown.
  - Delayed native focus until after interactions to avoid lost focus.
  - Updated search-shell visuals and related tests.
- `SearchResults` was updated to match the revised search-shell behavior.
- Geocode search now applies stronger requested-country filtering in the API
  proxy and matching mock handler.
- Search/navigation flows and integration tests were updated accordingly.

Why this matters:

- The revised grouped map behavior still depends on reliable search-to-map and
  search-to-property resolution.
- Native focus and geocode consistency problems would otherwise undermine the
  flows used to exercise the new grouping behavior.

Key files:

- `apps/app/src/components/SearchBar.tsx`
- `apps/app/src/components/SearchResults.tsx`
- `apps/app/src/components/__tests__/SearchBar.test.tsx`
- `services/api/src/routes/geocode.ts`
- `packages/mocks/src/handlers/geocode.ts`
- `services/api/src/__tests__/integration/geocode.integration.test.ts`

## 6. Property-detail navigation return-target fix

Root cause addressed:

- Property detail screens opened from tab surfaces did not preserve a stable
  return destination, especially for hardware back on native.

What changed:

- Added `apps/app/src/utils/property-route.ts` with supported `returnTo`
  targets.
- Feed, saved, profile, notifications, and leaderboard now push property routes
  with an explicit return target.
- `apps/app/app/property/[id].tsx` now normalizes the return target and uses it
  for back navigation, including Android hardware back handling.

Why this matters:

- It keeps navigation deterministic after map/search/property deep links and
  related test flows.

Key files:

- `apps/app/src/utils/property-route.ts`
- `apps/app/app/property/[id].tsx`
- `apps/app/app/(tabs)/feed.tsx`
- `apps/app/app/(tabs)/saved.tsx`
- `apps/app/app/(tabs)/profile.tsx`
- `apps/app/app/notifications.tsx`
- `apps/app/app/leaderboard.tsx`

## 7. Address-route stabilization

Root cause addressed:

- Dynamic address route resolution could render too early before navigation
  readiness and cause an unstable initial state.

What changed:

- `apps/app/app/[...address].tsx` now waits for mount before resolving the
  address surface and shows a loading state during early resolution.

Why this matters:

- The grouped map/property flows depend on reliable route resolution when moving
  between address-based and property-based screens.

## 8. Playwright and mobile E2E runtime hardening

These were auxiliary systems improved during the sprint because the existing
tooling was not reliable enough for the required verification loop.

What changed:

- Added `scripts/playwright/run-playwright-project.mjs`.
  - Boots API and exported web runtime for Playwright.
  - Cleans stale listeners on occupied ports.
  - Terminates stale runtime supervisors.
- Added `scripts/playwright/static-web-server.mjs`.
  - Serves the exported Expo web output.
  - Resolves file-based and dynamic Expo Router routes instead of relying on a
    naive static server.
- Reworked Playwright runtime helper code.
- Reworked `scripts/visual-overhaul/run-mobile-e2e.mjs`.
  - Added a lock file so parallel mobile flows do not step on each other.
  - Added bootstrap/retry handling for transient Maestro driver transport
    failures.
- Updated root `package.json` scripts to route Playwright invocations through
  the new runtime supervisor.
- Added root `index.js` and app bootstrap style imports to support exported-web
  test/runtime behavior.
- Updated Metro config to stub web-only/native-only map libraries on the wrong
  platform, which matters because Expo Router evaluates both route files.

Why this matters:

- The session required repeated Playwright and Maestro verification.
- Without stabilizing the runtime bootstrap, port ownership, route serving, and
  native/web bundling, the visual and flow verification loop was not reliable.

Key files:

- `scripts/playwright/run-playwright-project.mjs`
- `scripts/playwright/static-web-server.mjs`
- `scripts/playwright/integration-runtime.mjs`
- `scripts/visual-overhaul/run-mobile-e2e.mjs`
- `playwright.config.ts`
- `package.json`
- `index.js`
- `apps/app/src/bootstrap/styles.ts`
- `apps/app/src/bootstrap/styles.web.ts`
- `apps/app/metro.config.js`

## 9. Mocks, tests, and integration coverage expansion

What changed:

- Updated property mocks to the grouped nearby contract.
- Removed the unused request parameter from the mock nearby handler.
- Updated visual helpers and map layer name utilities to the new contract.
- Expanded web Playwright coverage for vector tiles, property previews,
  clustered previews, bottom-sheet details, and layer-name expectations.
- Updated mobile Maestro flows for smoke, search, auth, bottom sheet, and
  cluster-preview coverage.
- Added dedicated density-aware mobile flow definitions:
  - `density-aware-grouping-surfaces.yaml`
  - `density-cluster-surfaces.yaml`
  - `density-login-surfaces.yaml`
  - `density-search-sheet-surfaces.yaml`

Why this matters:

- The migration changed the actual contract of map features and nearby results.
- The supporting harness and tests had to move with the contract or the suite
  would validate the wrong system.

## Visual and UX Work Performed

## 10. Preview-card and clustered-preview redesign

Late in the session, a parallel worker returned additional uncommitted visual
refinement work for:

- `apps/app/src/components/PropertyPreviewCard.tsx`
- `apps/app/src/components/GroupPreviewCard/GroupPreviewCard.tsx`

Reported intent:

- Match the pen exports more closely.
- Tighten shell, hierarchy, spacing, badge treatment, stat row, pager chrome,
  and cluster controls.
- Improve Android interaction resilience by registering native hit-test zones
  against the real buttons rather than hidden markers.

Reported verification:

- `pnpm -C apps/app test -- --runInBand src/components/__tests__/PropertyPreviewCard.test.tsx src/components/GroupPreviewCard/__tests__/GroupPreviewCard.test.tsx` passed (`55/55`).
- `pnpm -C apps/app exec playwright test e2e/visual/reference-0021-map-property-preview.spec.ts e2e/visual/reference-swipeable-clustered-nodes.spec.ts --project=visual` reportedly passed (`7/7`).
- Current re-check at the end of this summary confirmed the unit test slice and
  current `apps/app` typecheck still pass.

Important status note:

- Android spot checks for these surfaces did not cleanly complete. The worker
  reported Maestro driver disconnects and missing preview surfacing during those
  attempts.

## 11. Search shell and map chrome visual refinement

Late in the session, a parallel worker returned additional uncommitted visual
refinement work for:

- `apps/app/src/components/SearchBar.tsx`
- `apps/app/src/components/SearchResults.tsx`
- `apps/app/app/(tabs)/index.tsx`
- `apps/app/app/(tabs)/index.web.tsx`
- `apps/app/e2e/mobile/flows/01-smoke.yaml`
- `apps/app/e2e/mobile/flows/03-search-navigate.yaml`

Reported intent:

- Tighten the search shell toward the pen with stronger radius, warmer glass,
  cleaner focus treatment, and less generic sizing.
- Bring search results closer to the pen with cleaner card/border/shadow and
  row spacing.
- Reduce the debug/tooling feel of the map surface through a subtler warm veil
  and lighter control composition.
- Fix the narrow Android smoke/search flows so they no longer rely on a debug
  zoom label absent in normal runs.

Reported verification:

- `pnpm -C apps/app test -- --runInBand src/components/__tests__/SearchBar.test.tsx` reportedly passed (`10/10`).
- A focused Playwright flows run on search-navigation reportedly passed (`3/3`).
- Android captures were refreshed through
  `apps/app/e2e/mobile/density-aware-grouping-surfaces.yaml` for map/search
  surfaces before Maestro orchestration became transport-flaky again.

Important status note:

- That worker reported a typecheck failure attributed to pre-existing
  `SectionCard.tsx` state.
- Current re-check at the end of this summary supersedes that intermediate
  report: `pnpm -C apps/app typecheck` now passes in the present workspace.

## 12. Property bottom-sheet visual redesign

Late in the session, a parallel worker returned additional uncommitted visual
refinement work for:

- `apps/app/src/components/PropertyBottomSheet/CommentsSection.tsx`
- `apps/app/src/components/PropertyBottomSheet/ListingLinks.tsx`
- `apps/app/src/components/PropertyBottomSheet/PriceGuessSection.tsx`
- `apps/app/src/components/PropertyBottomSheet/PriceSection.tsx`
- `apps/app/src/components/PropertyBottomSheet/PropertyContent.tsx`
- `apps/app/src/components/PropertyBottomSheet/PropertyDetails.tsx`
- `apps/app/src/components/PropertyBottomSheet/PropertyHeader.tsx`
- `apps/app/src/components/PropertyBottomSheet/QuickActions.tsx`
- `apps/app/src/components/PropertyBottomSheet/SectionCard.tsx`

Reported intent:

- Replace flat border-separated sections with stronger card framing.
- Rebuild the header into a larger hero plus overlapping summary card.
- Rework pricing hierarchy and supporting comparison visuals.
- Make listings, guesses, comments, and detail/activity blocks read as
  intentional sections.

Reported verification:

- `pnpm -C apps/app typecheck` reportedly passed.
- `pnpm -C apps/app test -- --runInBand src/components/PropertyBottomSheet/__tests__/PropertyHeader.test.tsx src/components/PropertyBottomSheet/__tests__/PropertyContent.test.tsx src/components/PropertyBottomSheet/__tests__/PropertyBottomSheet.test.tsx app/property/__tests__/[id].test.tsx` reportedly passed for the matching bottom-sheet suites (`28/28`).
- `pnpm exec playwright test apps/app/e2e/visual/reference-property-bottom-sheet-details.spec.ts --project=visual` reportedly passed (`3/3`) and refreshed the web artifact.
- Current re-check at the end of this summary confirmed the current
  `apps/app` typecheck and the matching bottom-sheet unit-test slice still pass.

Important status note:

- The same worker reported Android verification failure caused by transient
  Maestro transport errors on `localhost:7001` and then an address-visibility
  assertion, so there is no clean fresh Android visual pass recorded for this
  bottom-sheet work.

## Visual Verification Findings and Iterations

## 13. Reference-expectation verification work

During the session, visual-capable workers were used to compare rendered output
against pen/reference exports for key surfaces.

What they found before the immersive experiment:

- Several surfaces were still not visually aligned with the pen exports.
- Reported `NO-SHIP`/`FAIL` findings included:
  - map screen
  - search results
  - property preview
  - clustered preview
  - property detail/bottom sheet
- Both web and Android were reviewed where possible, but Android verification
  was repeatedly undermined by Maestro/device-driver instability.

What changed as a consequence:

- A later immersive visual map-surface experiment was attempted to close the
  visual gap more aggressively.

## 14. Immersive visual map-surface experiment

A later experiment changed the map surfaces to a more immersive presentation.
This was not part of the final requested state.

Experiment characteristics:

- Hid or suppressed parts of the standard header/search/control surface while
  preview/detail surfaces were visible.
- Added an immersive scrim/overlay treatment.
- Changed some sheet/web panel behavior for the same visual direction.

The experiment touched:

- `apps/app/app/(tabs)/index.tsx`
- `apps/app/app/(tabs)/index.web.tsx`
- `apps/app/src/components/PropertyBottomSheet/PropertyBottomSheet.web.tsx`

## 15. Revert of the immersive experiment

The user explicitly requested:

- revert the last immersive visual changes

That revert was performed.

What was reverted:

- The immersive scrim/overlay behavior in the native/web map tabs.
- The conditional hiding of standard map chrome while preview/detail surfaces
  were visible.
- The landscape floating-sheet web treatment in
  `PropertyBottomSheet.web.tsx`.

What remained after the revert:

- The density-aware grouping migration and related runtime/test/tooling work.
- The auth-transition fix.
- The navigation/search/geocode/harness fixes.

Important chronology note:

- After that revert, separate parallel workers later completed and returned the
  preview-card and bottom-sheet component visual revisions described above.
- Those later revisions are currently present in the workspace and were not part
  of the reverted immersive map-surface pass.

## Verification History

## 16. Full-repo gate that passed earlier in the session

Before the later immersive experiment, the following had already been run and
passed:

- `pnpm -C apps/app typecheck`
- `pnpm -C apps/app test`
- `pnpm test`

The earlier passing `pnpm test` included:

- lint
- typecheck
- unit tests
- API integration tests
- Playwright integration coverage

## 17. Targeted checks run after reverting the immersive pass

After reverting the immersive pass, a targeted check was run and passed:

- `pnpm -C apps/app exec jest src/hooks/__tests__/useMapInteraction.test.ts src/components/PropertyBottomSheet/__tests__/PropertyBottomSheet.web.test.tsx --runInBand`

That was used to confirm the revert had not broken the touched auth/map/sheet
areas.

## 18. Current spot verification run at the time of this summary

I reran these against the current workspace before writing this document:

- `pnpm -C apps/app typecheck`
  - passed
- `pnpm -C apps/app test -- --runInBand src/components/__tests__/PropertyPreviewCard.test.tsx src/components/GroupPreviewCard/__tests__/GroupPreviewCard.test.tsx`
  - passed
  - `55/55`
- `pnpm -C apps/app test -- --runInBand src/components/PropertyBottomSheet/__tests__/PropertyHeader.test.tsx src/components/PropertyBottomSheet/__tests__/PropertyContent.test.tsx src/components/PropertyBottomSheet/__tests__/PropertyBottomSheet.test.tsx app/property/__tests__/[id].test.tsx`
  - passed for the three matching bottom-sheet suites
  - `28/28`

What was not rerun at the time of this summary:

- the full top-level `pnpm test` gate after the late preview-card/bottom-sheet
  visual edits
- a clean Android visual pass for every affected surface

## Current Uncommitted Workspace Inventory

The uncommitted changes at the time of writing are all from this session.

Grouped inventory:

Backend and shared contract:

- `packages/shared/src/config/property-map.ts`
- `packages/shared/src/config/index.ts`
- `packages/shared/src/types/property.ts`
- `packages/shared/src/types/index.ts`
- `packages/shared/package.json`
- `packages/api-client/generated/api.ts`
- `services/api/openapi.json`
- `services/api/src/routes/geocode.ts`
- `services/api/src/routes/properties.ts`
- `services/api/src/routes/tiles.ts`
- `services/api/src/services/property-grouping.ts`
- `services/api/src/services/property-grouping.test.ts`
- `services/api/src/__tests__/integration/geocode.integration.test.ts`
- `services/api/src/__tests__/integration/properties.integration.test.ts`
- `services/api/src/__tests__/integration/tiles.integration.test.ts`
- `services/api/src/__tests__/properties-nearby.test.ts`
- `packages/mocks/src/handlers/geocode.ts`
- `packages/mocks/src/handlers/properties.ts`

App runtime, map, search, and navigation:

- `apps/app/app/(tabs)/index.tsx`
- `apps/app/app/(tabs)/index.web.tsx`
- `apps/app/src/hooks/useMapInteraction.ts`
- `apps/app/src/hooks/__tests__/useMapInteraction.test.ts`
- `apps/app/src/hooks/useClusterPreview.ts`
- `apps/app/src/hooks/useIsLandscape.ts`
- `apps/app/src/utils/api.ts`
- `apps/app/src/utils/property-route.ts`
- `apps/app/src/components/SearchBar.tsx`
- `apps/app/src/components/SearchResults.tsx`
- `apps/app/src/components/__tests__/SearchBar.test.tsx`
- `apps/app/app/[...address].tsx`
- `apps/app/app/property/[id].tsx`
- `apps/app/app/property/__tests__/[id].test.tsx`
- `apps/app/app/(tabs)/feed.tsx`
- `apps/app/app/(tabs)/saved.tsx`
- `apps/app/app/(tabs)/profile.tsx`
- `apps/app/app/notifications.tsx`
- `apps/app/app/leaderboard.tsx`
- `apps/app/app/_layout.tsx`

Late visual component work:

- `apps/app/src/components/PropertyPreviewCard.tsx`
- `apps/app/src/components/GroupPreviewCard/GroupPreviewCard.tsx`
- `apps/app/src/components/PropertyBottomSheet/CommentsSection.tsx`
- `apps/app/src/components/PropertyBottomSheet/ListingLinks.tsx`
- `apps/app/src/components/PropertyBottomSheet/PriceGuessSection.tsx`
- `apps/app/src/components/PropertyBottomSheet/PriceSection.tsx`
- `apps/app/src/components/PropertyBottomSheet/PropertyContent.tsx`
- `apps/app/src/components/PropertyBottomSheet/PropertyDetails.tsx`
- `apps/app/src/components/PropertyBottomSheet/PropertyHeader.tsx`
- `apps/app/src/components/PropertyBottomSheet/QuickActions.tsx`
- `apps/app/src/components/PropertyBottomSheet/SectionCard.tsx`
- `apps/app/src/components/AerialImageCard.tsx`
- `apps/app/src/components/AuthModal.tsx`
- `apps/app/src/components/PropertyFeedCard.tsx`

Playwright, mobile flows, and verification harness:

- `playwright.config.ts`
- `scripts/playwright/integration-runtime.mjs`
- `scripts/playwright/run-playwright-project.mjs`
- `scripts/playwright/static-web-server.mjs`
- `scripts/visual-overhaul/run-mobile-e2e.mjs`
- `apps/app/e2e/flows/app-boot-and-navigate.spec.ts`
- `apps/app/e2e/flows/auth-flow.spec.ts`
- `apps/app/e2e/flows/cluster-tap.spec.ts`
- `apps/app/e2e/flows/map-interactions.spec.ts`
- `apps/app/e2e/flows/map-to-property.spec.ts`
- `apps/app/e2e/flows/price-guess-flow.spec.ts`
- `apps/app/e2e/flows/profile-flow.spec.ts`
- `apps/app/e2e/flows/saved-screen-flow.spec.ts`
- `apps/app/e2e/flows/search-navigation.spec.ts`
- `apps/app/e2e/integration/cluster-tap.spec.ts`
- `apps/app/e2e/integration/critical-flows.spec.ts`
- `apps/app/e2e/integration/map-header-location-label.spec.ts`
- `apps/app/e2e/mobile/flows/01-smoke.yaml`
- `apps/app/e2e/mobile/flows/02-feed.yaml`
- `apps/app/e2e/mobile/flows/03-search-navigate.yaml`
- `apps/app/e2e/mobile/flows/04-bottom-sheet.yaml`
- `apps/app/e2e/mobile/flows/05-login.yaml`
- `apps/app/e2e/mobile/flows/06-auth-interactions.yaml`
- `apps/app/e2e/mobile/flows/07-cleanup.yaml`
- `apps/app/e2e/mobile/flows/08-cluster-preview.yaml`
- `apps/app/e2e/mobile/flows/09-preview-card-interactions.yaml`
- `apps/app/e2e/mobile/density-aware-grouping-surfaces.yaml`
- `apps/app/e2e/mobile/density-cluster-surfaces.yaml`
- `apps/app/e2e/mobile/density-login-surfaces.yaml`
- `apps/app/e2e/mobile/density-search-sheet-surfaces.yaml`
- `apps/app/e2e/mobile/full-flow.yaml`
- `apps/app/e2e/visual/app-visual.spec.ts`
- `apps/app/e2e/visual/helpers/map-layer-names.ts`
- `apps/app/e2e/visual/helpers/screenshot-harness.ts`
- `apps/app/e2e/visual/helpers/visual-test-helpers.ts`
- `apps/app/e2e/visual/map-clusters.spec.ts`
- `apps/app/e2e/visual/reference-0020-vector-tiles.spec.ts`
- `apps/app/e2e/visual/reference-0021-map-property-preview.spec.ts`
- `apps/app/e2e/visual/reference-0022-bottom-sheet-peek-behavior.spec.ts`
- `apps/app/e2e/visual/reference-0023-preview-card-persistence.spec.ts`
- `apps/app/e2e/visual/reference-0027-map-loading-indicator.spec.ts`
- `apps/app/e2e/visual/reference-0028-e2e-test-layer-names.spec.ts`
- `apps/app/e2e/visual/reference-glitchy-windows-short-buildings.spec.ts`
- `apps/app/e2e/visual/reference-hide-technical-ids.spec.ts`
- `apps/app/e2e/visual/reference-instant-preview-card-on-tap.spec.ts`
- `apps/app/e2e/visual/reference-map-view-property-markers.spec.ts`
- `apps/app/e2e/visual/reference-map-visuals-close-up.spec.ts`
- `apps/app/e2e/visual/reference-property-bottom-sheet-details.spec.ts`
- `apps/app/e2e/visual/reference-quick-action-buttons-on-preview.spec.ts`
- `apps/app/e2e/visual/reference-swipeable-clustered-nodes.spec.ts`
- `apps/app/e2e/visual/reference-window-polish-multistory.spec.ts`

Bootstrap, config, and root runtime support:

- `apps/app/src/bootstrap/styles.ts`
- `apps/app/src/bootstrap/styles.web.ts`
- `apps/app/metro.config.js`
- `apps/app/package.json`
- `package.json`
- `index.js`

Plan and review docs:

- `docs/plans/2026-04-08-density-aware-node-grouping-plan.md`
- `docs/plans/2026-04-08-density-aware-node-grouping-session-summary.md`

## Reviewer Notes

The most important distinctions for review are:

- The density-aware grouping migration is the main delivered functional work.
- The auth-transition fix is a separate runtime bug fix discovered and resolved
  during the sprint.
- Search/geocode/navigation/runtime-harness fixes were made because they were
  real blockers or reliability gaps exposed by the sprint.
- The immersive map-surface visual pass was attempted and then explicitly
  reverted.
- Separate preview-card and bottom-sheet visual revisions landed later via
  parallel workers and are currently present in the workspace with current
  typecheck and targeted test slices passing, but without a clean fresh Android
  visual verification pass recorded for every surface.
