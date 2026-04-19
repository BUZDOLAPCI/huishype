# 2026-04 Social Following + Map Semantics Sprint Runbook

## Purpose

This runbook is the execution guide for delivering the combined social-following sprint and map-node semantic cutover. It is intentionally phase-based and contract-first. It is not a feature summary.

Supporting repo context that constrains this sprint:

- `agent-rules/main-spec.md`: anonymous browsing remains the default product posture except for intentionally gated `Following` surfaces.
- `agent-rules/software-stack.md`: the Fastify + OpenAPI contract-first boundary and TanStack Query cache-key discipline are part of the implementation contract here.
- `agent-rules/test-requirements.md`: `pnpm test` is the canonical completion gate.

The sprint merges two parallel bodies of work:

- social-following: follow graph, `Following` feed, profile relationship/counts, notifications, and app-only map `socialScope='following'`
- map-node semantics: public map/property transport cutover, orthogonal public `activity='all' | 'social' | 'recent'` filters, parser/hydration cleanup, and additive map visuals

The key rule is separation of concerns:

1. contract-first API/OpenAPI/generated-client cutovers happen first
2. app-level map `socialScope='following'` stays app-only and authenticated
3. public map `activity='all' | 'social' | 'recent'` stays orthogonal to `marketState` and separate from following

## Non-negotiable Execution Rules

- Treat Fastify route Zod schemas as the wire-contract source of truth. The required order is: route schemas -> `services/api/openapi.json` -> `packages/api-client/generated/api.ts` -> app hooks/adapters/mocks/tests.
- Preserve the product posture from `agent-rules/main-spec.md`: anonymous browsing stays the default, and only intentionally gated `Following` surfaces require auth.
- Preserve the stack posture from `agent-rules/software-stack.md`: keep the Fastify/OpenAPI boundary authoritative and keep TanStack Query keys distinct anywhere auth/viewer scope changes response shape.
- Do not let handwritten shapes in `packages/shared`, app hooks, or mocks become the source of truth during this sprint.
- Keep public map/property transports separate from authenticated following transports. Public `GET /properties`, `GET /properties/nearby`, `GET /tiles/properties.json`, and `GET /tiles/properties/{z}/{x}/{y}.pbf` remain public/shared. `Following` uses a separate authenticated viewport endpoint.
- Lock the `Following` viewport contract up front: bbox/property-query input shape, intersection with active market-state and price filters, authenticated API caching only, overlay payload sufficient for direct property opening, no personalized nearby fallback, and no grouping or clustering in v1.
- Keep public map `activity` in shared/public `MapFilters`. Keep `socialScope` out of public filter serialization, tile URLs, nearby URLs, and shared public cache keys.
- Do not model `Following` as another `marketState`. Do not model `social` or `recent` as market states either.
- Do not start the visual/style rewrite until transport fields, parsers, hydration, and filter semantics are stable end to end.
- Do not treat the semantic cutover as complete while tile style still derives semantic hue from `point_count`; automated proof of additive composition fields is part of completion, not optional polish.
- Each phase must land with tests appropriate to the touched boundary before the next phase is treated as complete.

## Recommended Execution Order

1. Phase 1 locks every wire contract and generated artifact for public property/map transports, activity scopes, profile relationship fields, follow endpoints, and notification events. No downstream phase should proceed on stale route schemas, OpenAPI, or generated client types.
2. Phase 2 runs next and is the semantic foundation. It must land the shared listing-facts source of truth, address-addition canonicalization, tightened view identity rules, grouped/property transport fields, and public `activity='all' | 'social' | 'recent'` filter behavior before any following viewport transport is treated as stable.
3. Phase 3 may start only on work that does not depend on Phase 2 internals: `user_follows`, follow/unfollow, profile relationship/counts, follower/following lists, canonical activity schema/query cleanup, and notification canonicalization.
4. The Phase 3 authenticated following viewport endpoint is sequenced after Phase 2 exit criteria. It must reuse finalized public property identity, listing facts, and market/activity filter primitives without turning public tiles, nearby, or property routes into viewer-specific transports.
5. Phase 4 updates the app’s public parser, hydration, and public filter model against the stabilized Phase 2 contract before any following overlay UX is layered on top.
6. Phase 5 adds Following feed/profile/map UX on top of the stabilized public parser/filter model and completed social backend.
7. Phase 6 rewrites visuals and copy only after parser, hydration, and filter semantics are proven end to end.
8. Final verification always requires `pnpm test`, plus the conditionally required broader suites from `agent-rules/test-requirements.md` for every touched surface category. Do not close the sprint on targeted suites alone.

## Phase 1: Contract Lock and Generated-Type Cutover

### Objective

Lock the combined API contract before implementation fans out.

### Why This Phase Exists

Both source plans call out existing contract drift. If backend, app, and mocks move independently, the sprint will produce false greens and repeated rework.

### Exact Code Areas Likely in Scope

- `services/api/src/routes/activity.ts`
- `services/api/src/routes/users.ts`
- `services/api/src/routes/properties.ts`
- `services/api/src/routes/tiles.ts`
- `services/api/openapi.json`
- `packages/api-client/generated/api.ts`
- `packages/api-client/src/client.ts`
- `packages/shared/src/types/activity.ts`
- `packages/shared/src/types/property.ts`
- `packages/shared/src/types/api.ts`
- `packages/shared/src/utils/map-filters.ts`
- `packages/mocks/src/handlers/properties.ts`
- app hooks/parsers already consuming these routes, especially:
  - `apps/app/src/utils/api.ts`
  - `apps/app/src/hooks/useProperties.ts`
  - `apps/app/src/hooks/useSavedProperties.ts`

### Dependencies / Prerequisites

- Read both source plans and the repo rules in `agent-rules/`.
- Agree on the full locked contract before branching: grouped map fields, grouped-single thin seed fields plus hydration replacement rules, property detail/batch fields, public `MapFilters.activity`, explicit app-only `socialScope`, canonical activity payload/schema coverage for `GET /activity?scope=public`, `GET /activity?scope=following`, and `GET /users/me/activity`, optional-auth profile relationship/count fields, authenticated following viewport route shape, follow/unfollow response payloads, and the canonical notification vocabulary including `new_follower`.

### Implementation Tasks

- Finalize the public property/map transport contract:
  - grouped tile/nearby fields for `activeListingCount`, `socialCount`, `recentSocialCount`, `socialScoreTotal`, `socialScoreMax`, `recentSocialScoreTotal`
  - grouped single payloads stay thin and seed-only: identity/location, address/title snippet, price snippet, thumbnail, `hasActiveListing`, `marketState`, and lightweight badges such as `nodeClass`, `commentCount`, `socialCount`, `recentSocialCount`
  - property fields for `hasListing`, `hasActiveListing`, `marketState`, `latestListingStatus`, `socialScore`, `recentSocialScore`, `lastSocialAt` only if its public value is not save-derived, and the required public engagement breakdowns
  - public `MapFilters.activity = 'all' | 'social' | 'recent'`
- Finalize the public-vs-following separation:
  - `socialScope = 'all' | 'following'` is app state, not a public route/filter contract
  - `socialScope` stays out of public filter serialization, tile URLs, nearby URLs, and shared public cache keys
  - Following uses a separate authenticated sparse viewport endpoint, not personalized tiles or personalized nearby behavior
  - the viewport endpoint takes a bbox/property-query shape and returns the intersection of viewport bounds, followed-user qualifying activity, and active market-state/price filters
  - the viewport endpoint is authenticated API traffic with authenticated API caching only, never shared public tile caching
  - overlay payloads include enough canonical property identity and coordinate data for direct property opening
  - no grouping or clustering is allowed in the v1 overlay transport
- Finalize canonical activity coverage:
  - one canonical payload/schema/mapper/query utility shared by `GET /activity?scope=public`, `GET /activity?scope=following`, and `GET /users/me/activity`
  - `public` and `following` exclude `save`
  - `/users/me/activity` reuses the same schema and ordering and only adds private `save`
  - personalized scopes return `401` without a valid viewer rather than degrading to public behavior
- Finalize follow/profile contracts:
  - `PUT /users/:id/follow`, `DELETE /users/:id/follow`
  - both follow endpoints return the updated relationship payload
  - `GET /users/:id/profile` optional-auth `relationship`, `followerCount`, `followingCount`
  - `GET /users/me`, `GET /users/me/followers`, `GET /users/me/following`
- Finalize notification canonicalization:
  - DB/service/shared notification event names remain the source of truth
  - route schemas, exported OpenAPI, generated client, `packages/api-client/src/client.ts` if touched, app notification rendering/consumers, mocks, fixtures, and producers must conform to that vocabulary before adding `new_follower`
- Export OpenAPI with `pnpm openapi:export`.
- Regenerate generated client with `pnpm api-client:generate`.
- Cut touched app hooks, local adapters, mocks, and fixtures over to OpenAPI-derived shapes instead of stale handwritten response typing.

### Tests Required Before Phase Completion

- Route-schema/OpenAPI/generated-client sanity for every touched route, including activity scopes, profile routes, notification routes, public property/map routes, `/saved-properties`, and the following viewport route.
- Unit or smoke coverage proving touched app hooks/parsers compile against regenerated client types.
- Mock/fixture alignment assertions for property, activity, profile, notification, and saved-property routes, including canonical notification event names.
- Assertions proving public `activity` and app-only `socialScope` remain separate contracts, and that grouped-single seed semantics are replaced by authoritative batch/detail hydration rather than promoted into a second rich property contract.

### Exit Criteria

- Route schemas, `services/api/openapi.json`, `packages/api-client/generated/api.ts`, mocks, and touched callers all agree on the locked grouped/property fields, grouped-single seed boundary, canonical activity schema, profile relationship/count fields, follow endpoints, following viewport contract, and notification vocabulary.
- No touched public route has viewer-specific following behavior, and no touched caller still depends on stale handwritten shapes or non-canonical notification names.
- Backend and app work can proceed without guessing payloads, serialization boundaries, auth/public separation, or `/saved-properties` ownership.

### Handoff Notes for the Next Phase

- Phase 2 starts immediately.
- Phase 3 may begin follow-graph/profile/activity-cleanup/notification work, but the authenticated following viewport endpoint waits for Phase 2 exit criteria.
- Any schema change discovered later must repeat the full route-schema -> OpenAPI -> generated-client -> caller/mocks lockstep flow.

## Phase 2: Public Map and Property Backend Semantic Cutover

### Objective

Replace the old overloaded map/property semantics on public transports.

### Why This Phase Exists

The public map is the base layer under both the new public activity facet and the later following overlay. If its semantics remain wrong, every downstream UI will keep re-deriving bad state.

### Exact Code Areas Likely in Scope

- `services/api/src/services/property-grouping.ts`
- `services/api/src/services/map-filters.ts`
- `services/api/src/services/listings-view.ts`
- `services/api/src/routes/properties.ts`
- `services/api/src/routes/tiles.ts`
- `services/api/src/routes/feed.ts`
- `services/api/src/routes/views.ts`
- `services/api/drizzle/0003_mv_latest_active_listings.sql`
- `services/api/src/db/schema.ts`

### Dependencies / Prerequisites

- Phase 1 contract lock complete.
- Listing lifecycle rules, social-activity sources, recency window, address-addition normalization rules, and view identity rules are locked before implementation starts.

### Implementation Tasks

- Build one shared listing-facts source of truth for:
  - `hasListing`
  - `hasActiveListing`
  - `marketState`
  - `latestListingStatus`
- Define "latest" listing semantics from an explicit lifecycle-ordering source; if current schema cannot stay correct under in-place listing updates, fix the schema in this phase.
- Canonicalize address invariants:
  - normalize `house_number_addition` on insert/upsert and in fixtures/write helpers
  - treat missing addition as one canonical value, not a mix of `NULL` and `''`
  - reseed after normalization
  - rebuild the uniqueness constraint only if normalized reseeding still leaves duplicate-address ambiguity
- Tighten view invariants:
  - reject view writes that provide neither authenticated `user_id` nor anonymous `session_id`
  - count `DISTINCT COALESCE(user_id::text, session_id)` for `uniqueViewerCount` and `recentUniqueViewerCount`
  - keep raw `viewCount` for detail analytics, but use unique-viewer counts for map scoring
  - remove or reseed weak historical rows rather than preserving anonymous overcount
- Rebuild grouping candidates so social activity includes comments, replies, property likes, comment likes, price guesses, and unique viewers.
- Compute `socialScore`, `recentSocialScore`, `hasSocialActivity`, and `hasRecentSocialActivity`, then delete the old comments/guesses-only visibility and ghost logic.
- Recompute grouped outputs for tiles and `/properties/nearby` from the final composition fields.
- Keep grouped-single preview payloads explicitly thin: `hasActiveListing`, `marketState`, snippet/thumbnail fields, and lightweight badges only. Rich listing/social semantics remain batch/detail hydration responsibilities.
- Update `/properties`, `/properties/batch`, `/properties/:id`, and `/saved-properties` together so consumers stop inferring listing or social state from partial preview fields.
- Keep `/properties/resolve` lean and neutral. If it carries preview listing signal, keep it to `hasActiveListing` or `marketState`.
- Add public server-side filter support for `activity='all' | 'social' | 'recent'` as an orthogonal facet to `marketState`, with no save-derived public semantics.
- Include `lastSocialAt` in public property payloads only if its public value is not save-derived.

### Tests Required Before Phase Completion

- Update and expand:
  - `services/api/src/services/property-grouping.test.ts`
  - `services/api/src/__tests__/integration/tiles.integration.test.ts`
  - `services/api/src/__tests__/properties-nearby.test.ts`
  - `services/api/src/__tests__/integration/properties.integration.test.ts`
  - `services/api/src/__tests__/integration/batch-properties.integration.test.ts`
  - `services/api/src/__tests__/integration/resolve.integration.test.ts`
  - `services/api/src/__tests__/integration/property-views.integration.test.ts`
  - `services/api/src/__tests__/integration/property-saves.integration.test.ts`
- Assertions must cover exact composition math, not vague labels.
- Decode MVT responses and assert feature properties, not only non-empty tiles.
- Add assertions for address-addition normalization and resolve/lookup behavior after canonicalization.
- Add assertions for rejected view writes without stable identity and exact `uniqueViewerCount` / `recentUniqueViewerCount` behavior.
- Use hermetic cases for listing-only, social-only, views-only, recent-only, sold-only, and mixed properties/groups.
- Hermetic fixtures must explicitly cover replies, property likes, and comment likes in both composition math and emitted grouped/property payload fields.
- Assert that public property payloads do not leak save-derived counts or timestamps.

### Exit Criteria

- One shared listing-facts source of truth drives tiles, nearby, list, batch, detail, and saved-property semantics.
- Address-addition normalization and view identity invariants are enforced in write paths and fixtures.
- Public tiles, nearby, batch, and detail expose the locked grouped/property semantics, and `activity='social'` and `activity='recent'` are server-backed and orthogonal to `marketState`.
- Likes-only and views-only properties are socially active in public semantics when their scores are non-zero.
- `/properties/resolve` remains a lean bootstrap route rather than a second rich property contract.

### Handoff Notes for the Next Phase

- Phase 4 consumes these public transports on the app side.
- Phase 3 may now finish the authenticated following viewport endpoint on top of stabilized property identity, listing facts, and market/activity filter primitives.
- Phase 5 must not start the map following overlay until this phase is stable.

## Phase 3: Social Backend and Follow-Graph Cutover

### Objective

Implement authenticated social-following backend surfaces on top of the locked contract.

### Why This Phase Exists

Following is personalized and must not contaminate the public tile/property path. This phase isolates the social graph, viewer-aware activity scopes, profile relationships, and notifications.

### Exact Code Areas Likely in Scope

- `services/api/src/db/schema.ts`
- `services/api/src/routes/users.ts`
- `services/api/src/routes/activity.ts`
- `services/api/src/routes/notifications.ts`
- `services/api/src/services/notifications.ts`
- `services/api/src/services/map-filters.ts` for shared filter reuse in viewport SQL
- `services/api/openapi.json`
- `packages/api-client/generated/api.ts`
- `packages/api-client/src/client.ts` if touched during contract cleanup
- `packages/shared/src/types/activity.ts`
- `packages/shared/src/types/notification.ts`
- `packages/shared/src/types/user.ts`
- `packages/shared/src/types/api.ts`
- `packages/mocks/src/handlers/activity.ts`
- `packages/mocks/src/handlers/notifications.ts`
- `packages/mocks/src/handlers/users.ts`
- app notification consumers/renderers using the generated notification shapes

### Dependencies / Prerequisites

- Phase 1 contract lock complete.
- Follow endpoint semantics and notification vocabulary finalized.
- Phase 2 exit criteria are required before implementing the authenticated following viewport endpoint. Only follow-graph, profile/count, activity-schema cleanup, and notification canonicalization work may proceed earlier.

### Implementation Tasks

- Add `user_follows` table and indexes.
- Add `PUT /users/:id/follow` and `DELETE /users/:id/follow` with idempotent semantics, and make both return the updated relationship payload.
- Extend `GET /users/:id/profile` with optional-auth `relationship`, `followerCount`, and `followingCount`.
- Extend `GET /users/me` with `followerCount` and `followingCount`.
- Add `GET /users/me/followers` and `GET /users/me/following`.
- Canonicalize notification route schemas, exported OpenAPI, generated client usage, `packages/api-client/src/client.ts` if touched, app notification rendering/consumers, mocks, fixtures, and existing producers onto the existing DB/service/shared notification vocabulary, then add `new_follower`.
- Clean up activity route internals so `GET /activity?scope=public|following` and `GET /users/me/activity` share one canonical schema, mapper, ordering, and query model, with one explicit scope-to-query mapping.
- Preserve activity inclusion rules exactly:
  - `public` excludes `save`
  - `following` excludes `save`
  - `/users/me/activity` reuses the same payload and ordering and only adds private `save`
  - personalized scopes return `401` without a valid viewer
- Add the authenticated following viewport endpoint only after Phase 2 stabilizes:
  - filters by followed-user qualifying activity only
  - qualifying activity is `property_like`, `comment`, and `price_guess`
  - excludes `save`
  - accepts a bbox/property-query shape plus normal market-state and price filters, and returns their intersection with social scope
  - returns sparse property identity, coordinates, and minimal activity summary sufficient for direct property opening
  - reuses existing market-filter SQL helpers where appropriate
  - uses authenticated API caching only, not shared public tile caching
  - does not group or cluster in v1
  - does not add personalized nearby fallback behavior; overlay taps must use in-memory overlay payload data
  - does not become a personalized tile, nearby, or public property path

### Tests Required Before Phase Completion

- Unit tests for:
  - relationship-state derivation
  - canonical activity payload mapping and shared scope/query selection
  - notification event rendering against canonical event names
- API integration tests for:
  - follow/unfollow
  - self-follow rejection
  - optional-auth profile relationship/count behavior
  - `GET /activity` public vs following
  - `GET /users/me/activity`
  - `401` on personalized scopes without a valid viewer
  - following viewport auth, bbox/property-query behavior, qualifying activity rules, and intersection with market-state and price filters
  - `GET /users/me/followers`
  - `GET /users/me/following`
  - notification canonicalization plus `new_follower` creation
- Assertions that public and following share the same canonical payload and ordering, both exclude `save`, and only `/users/me/activity` includes private `save`.
- Assertions that both follow endpoints return the updated relationship payload.
- Contract-alignment assertions covering OpenAPI, generated client usage, `packages/api-client/src/client.ts` if touched, and app notification consumers for the canonicalized activity/notification shapes.
- API integration tests proving `GET /properties`, `GET /properties/nearby`, `GET /tiles/properties.json`, and `GET /tiles/properties/{z}/{x}/{y}.pbf` remain public/shared and do not gain viewer-specific behavior or cache semantics when Following exists.

### Exit Criteria

- The follow graph exists with viewer-aware profile state, follower/following counts, and self list routes.
- `GET /activity?scope=public`, `GET /activity?scope=following`, and `GET /users/me/activity` share one canonical payload/order/query model with the correct save-inclusion rules.
- Notification schemas, OpenAPI, generated client usage, `packages/api-client/src/client.ts` if touched, app notification consumers/renderers, mocks, fixtures, and producers use one canonical event vocabulary with `new_follower` added and no drift names remaining.
- The following viewport endpoint exists as an authenticated sparse overlay transport, explicitly separate from public tiles, nearby, and public filter serialization, with bbox/property-query input, authenticated API caching, direct-open payload identity, no personalized nearby fallback, and no grouping/clustering in v1.
- Personalized behavior exists only on the authenticated following viewport endpoint; public property/tile/nearby routes remain unchanged.

### Handoff Notes for the Next Phase

- Phase 5 can consume these routes once Phase 4 stabilizes public app parsers and filter state.
- Do not let app state serialize `socialScope` into public tile or nearby URLs during integration.

## Phase 4: App Public Parser, Hydration, and Filter-Model Cutover

### Objective

Update the app to consume the new public property/map semantics before layering following UX on top.

### Why This Phase Exists

The app currently re-derives stale map semantics from old grouped/property fields. Search-resolved previews, cached web preview-route state, and grouped/resolve seed data must stay neutral bootstrap data until `/properties/batch` or `/properties/:id` hydration replaces them with authoritative listing/social fields; otherwise the new backend contract will be silently flattened back into the old model.

### Exact Code Areas Likely in Scope

- `apps/app/src/utils/api.ts`
- `apps/app/src/hooks/useMapInteraction.ts`
- `apps/app/src/hooks/useAmbientCommentBubbles.ts`
- `apps/app/src/lib/sharedMapFilters.ts`
- `apps/app/src/lib/mapFilterSelection.ts`
- `apps/app/src/hooks/useMapFilterController.ts`
- `apps/app/src/lib/mapRoute.ts`
- `packages/api-client/generated/api.ts`
- shared filter/type owners that define the public property/map contract
- MSW handlers/fixtures that mirror public property, tile, nearby, and saved-property semantics
- `apps/app/src/components/GroupPreviewCard/types.ts`
- `apps/app/src/components/PropertyBottomSheet/types.ts`
- `apps/app/src/hooks/useProperties.ts`
- `apps/app/src/hooks/useSavedProperties.ts`
- `apps/app/app/(tabs)/index.tsx`
- `apps/app/app/(tabs)/index.web.tsx`
- `apps/app/src/components/map/MapFilterBar.tsx`

### Dependencies / Prerequisites

- Phase 2 complete.
- Phase 1-generated types already adopted by touched app hooks and adapters.

### Implementation Tasks

- Update grouped tile and nearby parsing to the new composition contract, and treat grouped/resolve seed data as neutral bootstrap data rather than authoritative listing/social semantics.
- Enforce the grouped-single preview seed boundary in app/runtime types: seed fields stay limited to snippet/thumbnail, `hasActiveListing`, `marketState`, and lightweight badges until hydration.
- Update batch/detail hydration so `/properties/batch` and `/properties/:id` always replace grouped, search-resolved, and cached-preview placeholders before badges, labels, or quiet/active semantics are derived.
- Remove app-local semantic re-derivations based on old `hasListing`, `activityScore`, `askingPrice`, or one-axis `activityLevel`.
- Add the public `activity='all' | 'social' | 'recent'` facet to shared/public `MapFilters`, query-string serialization, filter matching, tile URL building, nearby URL building, and filter UI.
- Keep `activity` orthogonal to `marketState`.
- Keep `/properties/resolve` lean; if resolve returns any preview listing signal, only consume `hasActiveListing` or `marketState`, and do not recreate broadened `hasListing`, `activityScore`, or one-axis `activityLevel` guesses in app adapters.
- Preserve comment-only admission for ambient comment bubbles even though likes/views now count toward broader social semantics.
- Keep `/saved-properties` in the same contract-cutover inventory across backend, shared types, generated client, api-client wrappers, app hooks, and mocks; preserve private `isSaved` behavior, but do not reintroduce public save-count or save-derived activity semantics client-side.
- Update shared filter/type owners and generated-client-derived typings in the same pass, and keep MSW handlers/fixtures aligned with the same public contract instead of letting app tests drift from route/OpenAPI behavior.

### Tests Required Before Phase Completion

- Update and expand:
  - `apps/app/src/utils/__tests__/api.test.ts`
  - direct normalization tests for `apps/app/src/utils/api.ts`
  - `apps/app/src/hooks/__tests__/useMapInteraction.test.ts`
  - `apps/app/src/lib/__tests__/mapFilterSelection.test.ts`
  - `apps/app/src/hooks/__tests__/useMapFilterController.test.ts`
  - `apps/app/src/lib/__tests__/sharedMapFilters.test.ts`
  - `apps/app/src/hooks/__tests__/useAmbientCommentBubbles.test.ts`
- Add assertions for:
  - `For Sale` + `Recently Active`
  - hydration replacing stale grouped/resolve placeholders
  - grouped-single seed fields staying thin until hydration and then being replaced by authoritative batch/detail semantics
  - selection helpers using server-provided listing lifecycle
  - likes/views not creating ambient comment bubbles
  - search-resolved and cached-web preview flows staying neutral until hydration and not inventing `hasListing: false`, `quiet`, or similar placeholders from lean resolve responses
  - `/saved-properties` consumers preserving `isSaved` while excluding public save-count semantics
  - shared filter/type owners and generated-client-driven callers staying aligned with the same `activity`/property contract
  - MSW fixtures/handlers matching the stabilized route/OpenAPI/generated-client contract

### Exit Criteria

- The app no longer collapses the new public transport into legacy semantics.
- Public map filters correctly support `activity` independently of `marketState`.
- Hydration, search-resolve, and cached preview flows stay neutral until authoritative batch/detail payloads arrive, then use server listing/social fields consistently on web and native.
- `/saved-properties` remains aligned with the same privacy and contract-ownership rules as the rest of the property cutover.
- Shared filter/type owners, generated-client-derived callers, and MSW fixtures/handlers agree on the same public property/map contract in the same pass.

### Handoff Notes for the Next Phase

- Phase 5 can now add following feed/profile/map behavior without fighting stale public parser logic.
- Any bug found in following overlay rendering should first be checked against Phase 4 parser assumptions before adding backend workarounds.

## Phase 5: App Following Feed, Profile, and Map Overlay Cutover

### Objective

Ship the user-facing following experience using the stabilized public base layer plus authenticated social endpoints.

### Why This Phase Exists

This is the feature-delivery phase for the social-following plan. It must sit on top of the stabilized contracts instead of redefining them.

### Exact Code Areas Likely in Scope

- `apps/app/app/(tabs)/feed.tsx`
- `apps/app/src/components/FeedFilterChips.tsx`
- `apps/app/src/components/ActivityFeedCard.tsx`
- `apps/app/app/user/[id].tsx`
- `apps/app/app/(tabs)/profile.tsx`
- `apps/app/src/hooks/useUserActivity.ts`
- `apps/app/src/hooks/useUserProfile.ts`
- `apps/app/src/hooks/useNotifications.ts` if unread/feed entrypoints need follow-event parity
- `apps/app/src/hooks/useMapFilterController.ts`
- `apps/app/src/lib/sharedMapFilters.ts` only where it intersects with public `activity`, not for `socialScope`
- `apps/app/src/lib/mapRoute.ts`
- `apps/app/app/(tabs)/map/index.tsx`
- `apps/app/app/(tabs)/map/[...address].tsx`
- `apps/app/app/(tabs)/map/[country]/[city]/[postcode]/[street]/[house].tsx`
- `apps/app/src/hooks/useProperties.ts` for public base-layer query reuse versus separate following overlay fetches

### Dependencies / Prerequisites

- Phase 3 complete for follow/activity/profile/viewport routes.
- Phase 4 complete for public parser/filter/runtime behavior.
- Public property identity and hydration stable enough for overlay click-through.

### Implementation Tasks

- Extend app feed mode from `trending | latest | recent-activity` to `trending | latest | recent-activity | following`.
- Parameterize activity-feed queries by scope so query keys, cache entries, and pagination stay distinct, and keep viewer-sensitive profile/activity reads separate from anonymous cache entries.
- Add signed-out gating and signed-in empty states for `Following`.
- Add follow/unfollow affordances and counts on public profiles, but keep follower/following counts tappable only on self surfaces; other-user profiles show counts as static labels.
- Anonymous public profile reads must still render the follow button in the correct unauthenticated state and gate follow taps through auth instead of hiding the affordance.
- Add dedicated own-profile followers/following list screens and navigation from self counts only.
- Split activity card press targets into main-card property navigation and actor-avatar/name profile navigation.
- Model `socialScope: 'all' | 'following'` as app-level map-view state separate from shared/public `MapFilters`, expose `Following` as a dedicated top-level rail toggle near the existing quick filters, serialize it only in committed app state on web, preserve it across refresh/share/canonical/returnTo flows, keep native parity in in-memory map-view state, and keep it out of shared/public filter serializers, tile URLs, nearby URLs, and public cache keys.
- Fetch and render the authenticated sparse following overlay separately from the unchanged public map layers; the overlay result set must be the intersection of viewport bounds, social scope, and active market-state/price filters. Do not add clustering, server-side grouping, or personalized public tiles in v1.
- Ensure overlay taps resolve from overlay payload identity and in-memory overlay data, not viewer-specific nearby or tile behavior.
- Wire the required analytics for follow created, unfollow, follow button impression, follow button click, following feed opened, following feed empty viewed, following feed item clicked, map Following enabled, map Following empty viewed, and map property click-through from Following.
- Capture overlay result counts, render cost, and interaction latency before considering any architecture change beyond the sparse overlay.

### Tests Required Before Phase Completion

- App component/query/state tests for:
  - follow button states and counts
  - anonymous public-profile follow-button rendering plus auth-gated follow taps
  - anonymous and authenticated profile reads not sharing cache entries when viewer-sensitive `relationship` data is present
  - self-only follower/following count navigation on own profile, and non-tappable counts on other-user profiles
  - split property-vs-actor activity-card taps
  - `Following` tab, query keys, signed-out gate, and empty state
  - `socialScope` web URL/state serialization while proving refresh/share/canonical/returnTo preservation, native parity, overlay-fetch triggering, and unchanged public tile URLs, nearby URLs, shared filter signatures, and public `activity` behavior
  - analytics emission/assertion coverage for the required Following events
- Web E2E minimum set:
  - happy path: sign in -> follow a user -> open `Following` -> verify activity appears
  - empty path: sign in -> follow nobody -> open `Following` -> verify empty state
  - map path: sign in -> follow user with qualifying activity -> enable following mode -> verify the public base map still renders -> verify only overlay items in the intersection of viewport + social scope + active market-state/price filters render -> verify tapping an overlay item opens the correct property via overlay payload identity, not viewer-specific nearby/tile hit testing

### Exit Criteria

- `Following` feed works as a personalized activity surface, not a property-feed variant.
- Public profiles expose follow state and counts correctly for anonymous and authenticated viewers, with self-only count navigation and static counts on other-user profiles.
- Viewer-sensitive profile/activity caches cannot contaminate anonymous reads.
- `socialScope='following'` works as app-only state driving an authenticated sparse overlay on top of unchanged public tiles, URLs, nearby behavior, and shared cache keys, with refresh/share/canonical/returnTo preservation on web, native parity, overlay-fetch triggering, runtime proof that app-only `socialScope` stays orthogonal to public `activity`, and overlay click-through resolved from overlay payload identity.

### Handoff Notes for the Next Phase

- Visual polish should not change transport or filter semantics.
- If the overlay feels dense, treat grouping/clustering as follow-up work, not as a reason to mutate the public tile path mid-sprint.
- If overlay density or interaction cost becomes a concern, review the new overlay result-count and latency instrumentation before changing architecture; do not jump to personalized tiles without measured evidence.

## Phase 6: Visual and Copy Rewrite

### Objective

Rewrite map styling and property copy to reflect the final semantics without changing the contract again.

### Why This Phase Exists

Both plans require the UI to communicate separate listing and social axes. That is impossible to do cleanly until backend fields and app parsers are stable.

### Exact Code Areas Likely in Scope

- `services/api/src/routes/tiles.ts`
- `packages/shared/src/config/property-map.ts`
- `apps/app/src/components/PropertyPreviewCard.tsx`
- `apps/app/src/components/PropertyBottomSheet/PropertyHeader.tsx`
- `apps/app/src/components/PropertyBottomSheet/PropertyDetails.tsx`
- map layer/queryable-layer assumptions shared between the app and tile route

### Dependencies / Prerequisites

- Phase 2, Phase 4, and Phase 5 complete.
- New grouped/property fields already live and verified.
- The sprint cannot be declared semantically complete until automated proof exists that tile style expressions use composition fields for semantic color and not `point_count`.

### Implementation Tasks

- Remove any semantic hue steps tied to `pointCount`; only radius and count-label sizing may depend on count.
- Use additive map language where outer treatment communicates active listing state, inner fill communicates social state/intensity, and pulse communicates recent social state only.
- Keep singles and clusters aligned:
  - listing state in the outer treatment
  - social state in the inner treatment
  - recent social state in pulse
  - labels communicate count only
- Apply single-node rules explicitly:
  - quiet, no active listing, no social activity = tiny neutral dot
  - active-listing only = subdued listing ring with quiet core and no pulse
  - social-only = socially colored core with no listing ring
  - active-listing plus social = listing ring plus social core
  - pulse only when `recentSocialScore > 0`
- Rewrite preview/header/details copy so listing lifecycle, social state, and `Recently Active` are shown separately.
- Make copy and badges consume the expanded engagement breakdown fields from hydrated batch/detail payloads instead of collapsing back to one-axis labels.
- Include `Recently Active` as a distinct public activity facet outcome, not as a synonym for listing state or following state.
- Do not reuse one-axis `Quiet / Active / Hot` language or treat `Following` as a public state.

### Tests Required Before Phase Completion

- Update visual assertions or screenshots for:
  - dense listing-heavy low-social area
  - socially intense smaller area
  - mixed area
  - high-zoom singles for listing-only, social-only, and listing+social
  - filtered `For Sale` + `Recently Active`
- Add automated proof that tile style expressions reference composition fields for semantic color and that no semantic hue expression still keys off `point_count`.
- Add assertions that preview/header/detail copy and badges consume the expanded engagement breakdown fields rather than one-axis summary labels.
- Visual verification must prove ring/fill/pulse semantics rather than count-driven hue.
- Run `pnpm test:e2e:visual` for touched web surfaces, and include `pnpm test:e2e:mobile` if the native UI changed in the same pass.

### Exit Criteria

- Map visuals no longer communicate density as meaning.
- Singles and clusters use one coherent ring/fill/pulse system for listing, social, and recent-social semantics.
- Automated proof exists that semantic style expressions use composition fields and not `point_count` for hue.
- Property copy and badges separate listing lifecycle, social state, and recent activity without collapsing back into one-axis `Quiet/Active/Hot` language, and they use the expanded engagement breakdown fields where required.

### Handoff Notes for the Next Phase

- Only tuning and verification remain. Any semantic mismatch found here should send work back to the owning earlier phase instead of being patched in styling alone.

## Cross-Cutting Risks

- Contract drift between routes, OpenAPI, generated client, mocks, and app adapters.
  Avoidance: every route-shape change repeats the full schema -> OpenAPI -> generated-client -> callers flow immediately.
- Mixing public `activity` with app-only `socialScope`.
  Avoidance: keep `activity` in shared/public `MapFilters`; keep `socialScope` in app-local map-view state only.
- Letting following requirements mutate public tile or nearby behavior.
  Avoidance: route all following map behavior through the authenticated viewport endpoint and overlay payload already in memory.
- Reintroducing legacy client-side semantic derivation.
  Avoidance: treat server listing/social fields as authoritative and remove local guesses based on `askingPrice`, old `activityScore`, or stale preview placeholders.
- Starting visual work before parser/runtime cutover.
  Avoidance: do not begin Phase 6 until Phase 4 and Phase 5 are functionally stable.
- Declaring semantic completion while style semantics still key off `point_count`.
  Avoidance: require automated style-expression proof in Phase 6 and Final Verification before calling the semantic cutover done.
- Auth cache contamination on viewer-sensitive profile/activity data.
  Avoidance: vary query keys and invalidation by viewer auth state anywhere `relationship` or personalized activity scope is involved.
- Sparse overlay turning dense during implementation.
  Avoidance: keep v1 ungrouped; if density becomes a real problem, open follow-up work instead of changing the sprint architecture.
- Shipping Following without the analytics required by the source plan.
  Avoidance: treat instrumentation as feature scope and require test coverage for emitted follow/following events.
- Regressing unchanged public-route guarantees while adding Following.
  Avoidance: prove via API integration and app URL-state tests that public property/nearby/tile routes and shared cache behavior remain unchanged and non-personalized.
- Overlay interaction silently depending on viewer-specific nearby/tile hit testing.
  Avoidance: require E2E proof that overlay taps open properties from overlay payload identity while the public base map keeps its existing behavior.
- Declaring completion without regression evidence for the changed map UI.
  Avoidance: require passing flow/visual/mobile suites when applicable and preserve screenshot/trace artifacts for the map-node states and Following map path.

## Final Verification

Before closing the sprint, run the canonical repo gate from `agent-rules/test-requirements.md`:

```bash
pnpm test
```

Use this as the required completion gate because it covers:

- lint + typecheck
- unit tests across app/API/worker/shared/api-client/mocks
- API integration tests
- Playwright harness self-tests
- Playwright web integration

For this sprint, the broader suites are conditionally required, not optional: run them whenever the touched surfaces match those categories, or run the broader superset:

```bash
pnpm test:e2e:flows
pnpm test:e2e:visual
pnpm test:e2e:mobile
```

Sprint completion criteria:

- all phase exit criteria are satisfied
- `pnpm test` passes cleanly
- required analytics from the social-following plan are implemented and covered by tests
- no public/following contract drift remains
- API and app tests prove public property/tile/nearby routes and public cache semantics remain unchanged while Following exists
- public `activity` semantics and app-only `socialScope='following'` remain explicitly separated
- retained regression evidence includes the `Following` feed happy-path E2E and empty-path E2E
- web E2E proves the public base map still renders and overlay click-through opens the correct property without viewer-specific tile hit testing
- automated proof exists that tile style semantics use composition fields rather than `point_count`
- the visual layer reflects the new semantics without reintroducing transport ambiguity
- regression-proof artifacts exist for the map-node screenshot set: dense listing-heavy, socially intense, mixed, high-zoom singles, and filtered `For Sale` + `Recently Active`

Broader superset option:

```bash
pnpm test:all
```
