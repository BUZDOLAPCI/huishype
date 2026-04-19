# Social Following Plan

Date: 2026-04-18
Status: Proposed

## Summary

Add a lightweight social graph to HuisHype centered on:

- one-way user follows
- a new `Following` section in the Feed tab
- a new `Following` map mode based on followed-user activity
- follow-aware profile affordances
- follow notifications

This plan also includes the small contract cleanup needed to make the feature safe to implement in this repo:

- align activity payloads with what the app actually consumes
- align profile responses with viewer-aware follow state
- canonically expose the existing notification event vocabulary through route schemas/OpenAPI, app rendering, mocks, and any test/runtime producers that already exist
- treat Fastify Zod schemas, exported OpenAPI, and generated API types as the canonical API contract because some manual shared/api-client response shapes are already stale today

This should extend the existing activity, profile, and map-filter architecture rather than create a separate social subsystem. The current app already has:

- property feed filters in [apps/app/app/(tabs)/feed.tsx](/home/caslan/dev/git_repos/hh/huishype/apps/app/app/(tabs)/feed.tsx:41)
- feed chips in [apps/app/src/components/FeedFilterChips.tsx](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/components/FeedFilterChips.tsx:22)
- actor-based activity items in [packages/shared/src/types/activity.ts](/home/caslan/dev/git_repos/hh/huishype/packages/shared/src/types/activity.ts:8)
- a public activity feed endpoint in [services/api/src/routes/activity.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/activity.ts:117)
- public profile surfaces in [services/api/src/routes/users.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/users.ts:24) and [apps/app/app/user/[id].tsx](/home/caslan/dev/git_repos/hh/huishype/apps/app/app/user/[id].tsx:31)
- map-filter plumbing in [apps/app/src/lib/sharedMapFilters.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/lib/sharedMapFilters.ts:1), [apps/app/src/hooks/useMapFilterController.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/hooks/useMapFilterController.ts:1), and [services/api/src/services/map-filters.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/services/map-filters.ts:1)

This is coordinated app work across public profile, own profile, follower/following list screens, feed/activity-card navigation, and map state/UI. It should not be treated as a tiny isolated follow-button tweak.

## Goals

- Make the product feel more socially alive without adding messaging or group features.
- Let users build a trusted graph around housing taste and activity.
- Create a more personal feed that is distinct from global recent activity.
- Let users explore the map through the actions of people they follow.
- Improve profile utility and repeat engagement through social notifications.

## Non-Goals

- Direct messages
- Shared lists or collaborative property workspaces
- Private accounts or activity visibility settings
- Close-friends lists
- Save or bookmark sharing
- Public follower and following list browsing across other users
- Algorithmic “people you may know” beyond basic empty-state suggestions

## Product Decisions

The following decisions are locked:

- `Follow` is one-way.
- There is no separate `friend` action or separate `friends` table.
- Mutual follow is derived relationship state only. It is not a separate product surface in v1.
- The new feed entry is named `Following`, not `Friends`.
- The `Following` feed shows activity from followed users only.
- The map filter rail includes a `Following` filter that shows only properties with qualifying activity from followed users.
- Included activity event types:
  - `property_like`
  - `comment`
  - `price_guess`
- `save` is excluded from the `Following` feed.
- `save` is excluded from the map `Following` filter.
- Profiles show follower and following counts.
- Counts on other users' profiles are static labels.
- On your own profile, follower and following counts open your own list views.
- Follow notifications only say that someone followed you. There is no separate `new_friend` notification.
- No settings surface is part of this feature.
- Anonymous browsing remains the default product behavior.
- Auth gating for `Following` feed and `Following` map filtering is intentional because those are personalized surfaces, not generic browsing surfaces.

## UX Shape

### Feed

Add a fourth feed chip:

- `Trending`
- `Latest`
- `Recent Activity`
- `Following`

Behavior:

- `Trending` and `Latest` remain property feeds.
- `Recent Activity` remains the global public activity stream.
- `Following` is a personalized activity stream requiring authentication.
- `Following` uses the same activity card family as `Recent Activity`, but only includes activity from followed users.
- The feed keeps the current default-to-`Trending` behavior on a fresh session. No chip-persistence work is required.
- This is an intentional exception to the general anonymous-browsing rule because the content is viewer-specific.

If the user is signed out:

- tapping `Following` should open auth gating instead of showing an empty screen
- copy should explain that this feed shows activity from followed users

If the user is signed in but follows no one:

- show a dedicated empty state
- point users toward public profiles and activity cards as the initial follow entry points

### Map filters

Add a `Following` option to the top-level map filter rail alongside the existing quick filters.

Behavior:

- `Following` is a social-scope filter, not a `marketState` value
- when enabled, the app keeps the existing public property tile pipeline unchanged and renders a separate authenticated sparse overlay for followed-user activity inside the current viewport
- qualifying interactions are:
  - `property_like`
  - `comment`
  - `price_guess`
- `save` does not qualify a property for this filter
- this filter can be combined with market-state filters and price filters
- the overlay result set is the intersection of the normal property filters, the current viewport, and the social-scope filter
- signed-out users who try to enable `Following` should hit auth gating
- signed-in users who follow nobody should see an empty-state treatment in the map results UI

Presentation:

- keep the visual placement close to the existing top-level quick filters because that is where users already expect quick narrowing controls
- model it separately in code so it does not become another `marketState` value
- this is the recommended and optimal v1 architecture because followed-user activity is expected to be sparse, so a viewer-specific overlay is materially simpler and cheaper than personalized tiles
- do not add clustering or server-side grouping for this overlay in v1
- if real usage later proves density or performance issues, server-side grouping or clustering can be added as a follow-up without disturbing the public tile path

### Public profile

Extend the public profile page with:

- follow or unfollow button
- follower count
- following count
- relationship state for the current viewer

Implementation note:

- `GET /users/:id/profile` should remain public but become optional-auth aware so the server can derive viewer-specific relationship state when a token is present.
- The client should send the access token when available, but anonymous callers should still receive a valid profile payload and be treated as `relationship = 'none'` for follow-button rendering and auth-gated follow taps.
- Self-count affordances belong on your own profile surfaces only. Other users' profiles show the counts as static labels.

Relationship states:

- `self`
- `none`
- `following`
- `followed_by`
- `mutual`

Counts behavior:

- on your own profile, follower and following counts are tappable and open list views
- on another user's profile, counts are visible but not tappable

### Activity cards

The current activity cards are still mostly property-centric. This plan should explicitly add:

- tapping the main card body opens the property
- tapping actor avatar or name opens the actor profile

No new visual card family is required. Reuse the current `ActivityFeedCard` and extend it.

Implementation note:

- The existing card is a single top-level press target today. This feature should split it into separate press targets with explicit `onPropertyPress` and `onActorPress` behaviors rather than trying to overload the current one-press wrapper.

### Discovery entry points

Initial follow discovery should be limited to surfaces with clear actor context:

- public profile page
- activity feed cards

Comments and leaderboard can remain follow-adjacent later work, but they are not required in this first pass.

## Data Model

Add a new table:

### `user_follows`

Fields:

- `follower_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `followed_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Constraints and indexes:

- composite primary key on `(follower_user_id, followed_user_id)`
- check constraint preventing self-follow
- index on `(follower_user_id, created_at DESC, followed_user_id)` for newest-first following lists
- index on `(followed_user_id, created_at DESC, follower_user_id)` for newest-first follower lists

Add an app-level map view state alongside the existing public `MapFilters` contract:

- `socialScope: 'all' | 'following'`

Important design choices:

- Do not add a separate `friends` table.
- Do not add a settings table for this feature.
- Do not model map `Following` as a fake `marketState`.
- Do not add `socialScope` to any shared/public map-filter serializer, shared public filter signature, or public tile URL.
- Keep the existing public property tile pipeline unchanged.
- Do not add personalized or authenticated property tiles in v1.
- Do not change the shared public server tile cache behavior in v1.
- Use a separate authenticated viewport API plus sparse client overlay for map `Following`.

## API Contract

### Canonical contract source of truth

For this feature, the canonical API contract flow is:

- Fastify route Zod schemas
- exported `services/api/openapi.json`
- generated API client/types derived from that OpenAPI in `packages/api-client/generated/api.ts`

The implementation must update those first and then align:

- app hooks
- app API usage
- mocks and test fixtures
- any shared domain-model adapters that intentionally sit above raw API types
- the thin API client wrapper in `packages/api-client/src/client.ts`, if touched, as adjacent hygiene rather than a prerequisite for this feature

Do not treat the current manual API wrappers in `packages/shared` or the current handwritten profile response typing as extendable source-of-truth contracts. Some of those shapes are already stale today. Route Zod/OpenAPI comes first, generated client/types come next, and existing app fetch hooks can consume those generated/OpenAPI-derived types directly without first migrating onto `packages/api-client/src/client.ts`.

### Activity contract cleanup prerequisite

Before adding social follow scopes, clean up the activity contract so the repo has shared activity schema/mapper/query utilities reused by:

- `GET /activity` for `scope=public`
- `GET /activity` for `scope=following`
- `GET /users/me/activity` for the current user's own history

Rules:

- `public` and `following` must share the same response schema, ordering, and event inclusion rules except for the viewer filter.
- `/users/me/activity` should reuse that same schema and mapper, with only the authenticated self scope adding private `save` events.
- Personalized activity scopes must not silently degrade to anonymous behavior. If no valid viewer is present, they must return `401`.
- This cleanup is a prerequisite because the current schema/OpenAPI under-declare the richer property payload already returned by the mapper, and the public activity contract currently advertises `save` even though the public query excludes it.

### New endpoints and route extensions

#### `PUT /users/:id/follow`

Authenticated.

Behavior:

- creates a follow edge
- no-op or idempotent success if already following
- rejects self-follow
- returns updated relationship payload
- creates a `new_follower` notification

Contract note:

- These follow endpoints are intentionally idempotent even though some older toggle routes in the repo use conflict/not-found semantics. Follow is relationship state, and `PUT`/`DELETE` semantics are the better fit here.

#### `DELETE /users/:id/follow`

Authenticated.

Behavior:

- removes the follow edge
- idempotent if not currently following
- returns updated relationship payload

#### `GET /activity`

Extend the existing activity route instead of adding a separate `/activity/following` endpoint.

Behavior:

- default scope remains the current public activity feed
- add `scope: 'public' | 'following'` query behavior
- `scope=following` requires authentication and returns `401` when no valid viewer is present
- `scope=following` returns recent activity created by users the current user follows
- both scopes exclude `save`
- both scopes use the same pagination model and canonical activity payload
- sorts newest first

Canonical activity payload:

- actor:
  - `id`
  - `displayName`
  - `handle`
  - `profilePhotoUrl`
- property:
  - `id`
  - `address`
  - `streetName`
  - `houseNumber`
  - `houseNumberAddition`
  - `city`
  - `postalCode`
  - `countryCode`
  - `thumbnailUrl`

Implementation note:

- Back the public and following activity scopes with the same shared activity schema, row mapper, and query utilities used by `/users/me/activity` so event inclusion, payload shape, and ordering cannot drift between modes.

#### `GET /users/me/followers`

Authenticated.

Behavior:

- returns the signed-in user's followers
- supports pagination
- powers the tappable follower count on the user's own profile

#### `GET /users/me/following`

Authenticated.

Behavior:

- returns the signed-in user's following list
- supports pagination
- powers the tappable following count on the user's own profile

These routes also power dedicated own-profile list screens. This feature should include those screens and navigation, not just the counts.

### Extended responses

#### Public profile

Extend `GET /users/:id/profile` with:

- `followerCount`
- `followingCount`
- `relationship`

The route currently returns basic public stats only. It should be enriched rather than replaced, and should use optional auth so the relationship can resolve when the viewer is signed in. A separate `GET /users/:id/relationship` endpoint is not needed in v1.

Client/cache note:

- Because `relationship` is viewer-sensitive, anonymous and authenticated profile reads must not share the same cache entry.
- Profile query keys and invalidation need to vary by viewer auth state, or the relationship field must be loaded separately from the anonymous public-profile cache.

#### My profile

Extend `GET /users/me` with:

- `followerCount`
- `followingCount`

Do not add settings fields here as part of this feature.

### Property and map-backed routes

Keep the existing public property tile and generic property query pipeline unchanged for v1 map `Following`.

Routes in scope:

- `GET /properties`
- `GET /properties/nearby`
- `GET /tiles/properties.json`
- `GET /tiles/properties/{z}/{x}/{y}.pbf`
- add one new authenticated viewport route for map `Following`

Behavior:

- the existing public routes continue to serve the same anonymous/shared property data they serve today
- they do not become viewer-specific
- they do not gain viewer-specific tile or nearby behavior for v1
- add a separate authenticated viewport endpoint, for example `GET /properties/following-viewport`, that returns sparse property activity items for the current visible bounds
- the viewport endpoint filters to properties with at least one qualifying interaction from a followed user
- the viewport endpoint excludes `save`
- the viewport endpoint accepts the same normal market-state and price filters so the overlay remains the intersection of social scope plus existing property filters
- the viewport endpoint should take a bbox/property-query shape and reuse the existing market-filter SQL helpers where possible, not the tile-generation or property-grouping path
- the app renders those returned items as a separate map overlay/layer on top of the unchanged public property tiles

Viewport overlay and cache behavior:

- `socialScope` participates in committed app map-view state, not the shared public `MapFilters` serializer
- the public property tile URL, public filter serializers/signatures, and public tile cache behavior remain unchanged
- the viewer-specific viewport endpoint uses the normal authenticated API path rather than the public tile path
- any caching for that viewport endpoint must be treated as authenticated API caching, not shared public tile caching

Map tap and nearby behavior:

- tapping a public base-layer property continues to use the existing public property and nearby behavior
- tapping a `Following` overlay item should resolve via the overlay payload itself, which must include enough canonical property identity and coordinate data to open the property directly without requiring viewer-specific tile hit testing
- the app should not retrofit `GET /properties/nearby` into a viewer-specific following resolver in v1
- if a native fallback is still needed for overlay hit handling, use the authenticated viewport payload already in memory rather than adding personalized nearby semantics to the public property route

## Feed Contract Changes

The current app-level feed mode type is:

- `trending | latest | recent-activity`

Extend this to:

- `trending | latest | recent-activity | following`

Relevant shared contract:

- [services/api/src/routes/activity.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/activity.ts:1)
- [services/api/openapi.json](/home/caslan/dev/git_repos/hh/huishype/services/api/openapi.json:7900)
- [packages/api-client/generated/api.ts](/home/caslan/dev/git_repos/hh/huishype/packages/api-client/generated/api.ts:3604)

The app feed screen should branch like this:

- property query for `trending`
- property query for `latest`
- public activity query for `recent-activity`
- authenticated follow activity query for `following`

Do not broaden `/feed` property request filters to include `following`. `recent-activity` and `following` remain activity-feed modes, not property-feed modes.

Implementation note:

- Keep the property-feed backend contract as `filter = trending | latest`.
- Treat `following` as an app feed-mode addition plus an authenticated activity-query mode, not as an expansion of the property-feed API.
- `Following` is a gated feed mode with its own signed-out gate state and signed-in-empty state; it should not fall through to the generic property-feed empty state.
- Parameterize the activity-feed hook/query by scope, for example `useActivityFeed({ scope: 'public' | 'following' })`, so query keys, cache entries, and pagination stay distinct by mode.
- The implementation must update the concrete feed UI surfaces, not just the type alias:
  - feed chips
  - feed screen title mapping
  - feed branching logic
  - feed empty states
  - feed tests and E2E coverage

## Map View State Changes

The current public map-filter model is market-state and price based. Keep that public filter contract intact and add a separate app-level social-view state rather than overloading `marketState`.

Relevant current contracts and plumbing:

- [packages/shared/src/utils/map-filters.ts](/home/caslan/dev/git_repos/hh/huishype/packages/shared/src/utils/map-filters.ts:10)
- [apps/app/src/lib/sharedMapFilters.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/lib/sharedMapFilters.ts:1)
- [apps/app/src/hooks/useMapFilterController.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/hooks/useMapFilterController.ts:1)
- [services/api/src/services/map-filters.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/services/map-filters.ts:14)

The app-level map view state should add:

- `socialScope: 'all' | 'following'`

Expected behavior:

- default is `all`
- `following` requires authentication
- `following` changes the app's map presentation mode by enabling the authenticated sparse overlay of followed-user activity
- `following` is serialized in committed app URL/state on web so refresh/share/canonical/returnTo behavior preserves the selected mode
- native should carry the same `socialScope` in app map-view state even though there is no browser URL
- `following` must not be pushed into the public property tile URL, public `MapFilters` serializer, or shared public tile signatures in v1

Implementation note:

- This is a cross-cutting app-state and API change, but it is intentionally not a public tile/filter-contract change.
- In the app UI, `Following` should be modeled as a dedicated top-level rail toggle near the existing quick filters, not as another generic filter-panel category or fake market-state value.
- In web, `socialScope=following` is a committed app URL state that drives the authenticated viewport overlay fetch separately from public tile URL building, and all web URL/share/canonical/returnTo helpers must preserve it as app state without turning it into a public filter parameter.
- In native, the same `socialScope` drives overlay fetch behavior from in-memory app state.
- Because the overlay is expected to be sparse in v1, do not add clustering, server-side grouping, or personalized vector-tile generation.

## Notifications

Add one new notification event type:

- `new_follower`

This is a coordinated contract change across:

- shared notification types
- API notification service types
- the database notification-event enum
- app notification rendering copy

Before adding `new_follower`, do a full canonicalization pass using the already-canonical DB/service/shared event names as the source of truth. The broken layers to fix first are:

- route Zod schemas and exported OpenAPI
- generated client usage and app notification rendering
- mocks and fixtures
- any test/runtime notification producers that already exist and still emit non-canonical names

Do not rename the existing DB enum, notification service type union, or shared notification type union just to accommodate drift elsewhere. Instead, make the broken route/app/mock/producer layers conform to those canonical names, then add `new_follower` to that same vocabulary.

Behavior:

- `new_follower` fires when someone starts following you
- no separate notification is sent for mutual follow
- reciprocity is reflected in profile relationship state and list views, not in notification copy

## Ranking and Feed Behavior

### Following feed ordering

Ordering should stay simple:

- reverse chronological by activity creation time

This is enough to validate the feature without introducing a separate ranking model.

### Grouping

Do not build grouped activity bundles.

### Deduplication

Rely on the existing underlying uniqueness rules for reactions and activity records.

No extra dedupe layer is required beyond ensuring the shared activity query builder unions the same event sources for public and following scopes and applies the follow filter consistently.

### Map filter semantics

For the map `Following` filter, a property qualifies when at least one followed user has a:

- `property_like`
- `comment`
- `price_guess`

This should be implemented as an existence test over qualifying activity in the authenticated viewport query, not as duplicated property rows or property-card grouping.

Implementation note:

- Because `property_like` qualifies a property for `Following`, the overlay payload should include the minimal activity summary needed to render it intentionally rather than inheriting the public tile pipeline's generic grouping semantics.
- Do not add clustering or server-side grouping for v1.
- If later usage shows that the overlay becomes dense enough to hurt rendering or interaction, migrate the viewport endpoint to return grouped results or graduate it to a dedicated personalized tile path in a later version. That should be a measured follow-up based on observed density and performance, not a v1 assumption.

## Analytics

Track at least:

- follow created
- unfollow
- follow button impression
- follow button click
- following feed opened
- following feed empty viewed
- following feed item clicked
- map following filter enabled
- map following filter empty viewed
- map property click-through from following filter

Success metrics:

- share of active users following at least one person
- repeat opens of `Following`
- click-through from following activity to property detail
- retained engagement of users with at least one mutual follow

## Implementation Sequence

- clean up the activity contract first in Fastify Zod schemas and OpenAPI:
  - one canonical activity response schema
  - one row mapper
  - shared query/schema utilities for `/activity` scopes and `/users/me/activity`
- export `services/api/openapi.json`
- regenerate `packages/api-client/generated/api.ts`
- update app hooks, app API usage, mocks, and fixtures onto generated/OpenAPI-derived route shapes
- clean up `packages/api-client/src/client.ts` only where it is directly touched or continues to leak stale handwritten response typing
- clean up profile route contracts in Fastify Zod schemas and OpenAPI, including optional-auth viewer relationship fields
- adjust profile query keys/invalidation so viewer-sensitive relationship state cannot reuse anonymous cache entries
- canonicalize notification route schemas/OpenAPI, app rendering, mocks, and any existing test/runtime producers onto the existing DB/service/shared event vocabulary
- add `user_follows` schema
- add `PUT /users/:id/follow` and `DELETE /users/:id/follow`
- extend `GET /users/:id/profile` with optional-auth viewer relationship resolution plus counts
- extend `GET /users/me` with follower and following counts
- add `GET /users/me/followers` and `GET /users/me/following`
- add `new_follower` notification support on top of that normalized contract
- extend the app feed mode contract with `following` while keeping `/feed` property-only
- introduce app-level `socialScope` map-view state separate from the public `MapFilters` contract
- extend `GET /activity` with `scope=public|following` on top of the shared activity schema/mapper/query utilities
- add the authenticated map following viewport endpoint and keep the public property/tile pipeline unchanged
- add app query hooks for parameterized activity scopes and self follow lists
- wire `Following` into feed chips and feed screen
- wire `Following` into committed app map-view state, web URL state, native state, and authenticated overlay fetching
- add follow affordances and counts to the public profile screen
- add follower/following count affordances plus dedicated own-profile list screens
- split activity-card property and actor press targets, then add actor-profile navigation
- add signed-out auth-gated states for personalized `Following` surfaces and signed-in empty states

## Testing Requirements

This work should include:

- unit tests for relationship-state derivation
- unit tests for canonical activity payload mapping and shared scope/query selection
- unit tests for notification event rendering against canonical event names
- app map-view-state tests for `socialScope` URL/state serialization while proving public tile URL serialization is unchanged
- API integration tests for follow and unfollow endpoints
- API integration tests for enriched optional-auth `GET /users/:id/profile`
- API integration tests for `GET /activity` with `scope=public` and `scope=following`
- API integration tests for `401` behavior on personalized activity scopes when no valid viewer is present
- API integration tests for the authenticated following viewport endpoint across viewport bounds, auth, and qualifying-activity rules
- API integration tests proving the public property tile and nearby endpoints remain unchanged when `Following` mode exists
- API integration tests for `new_follower` notification creation
- API integration tests for `GET /users/me/followers` and `GET /users/me/following`
- app component tests for follow button states and profile counts
- app query/state tests proving public profile cache entries vary correctly by viewer auth state
- app component tests for own-profile follower/following list navigation
- app component tests for split property-vs-actor activity-card taps
- feed tests for the `Following` tab, signed-out gate, signed-in-empty state, and parameterized activity query keys
- map view-state tests for the `Following` option, web URL serialization, and overlay-fetch triggering semantics
- one web E2E happy path:
  - sign in
  - follow a user
  - open `Following`
  - verify activity appears
- one web E2E empty-state path:
  - sign in
  - follow nobody
  - open `Following`
  - verify empty state
- one web E2E map path:
  - sign in
  - follow a user with qualifying activity
  - enable the map `Following` filter
  - verify the public base map still renders
  - verify the authenticated overlay renders only qualifying followed-user properties
  - verify tapping an overlay item opens the correct property without viewer-specific tile hit testing

If density later increases:

- add instrumentation around overlay result counts, render cost, and interaction latency before changing architecture
- if usage proves the sparse overlay is no longer sufficient, first consider server-side grouping on the authenticated viewport endpoint
- only consider a dedicated personalized tile path after real usage demonstrates that viewport payloads and client overlay rendering are no longer adequate

Repo-level verification should still run through the canonical harnesses in [agent-rules/test-requirements.md](/home/caslan/dev/git_repos/hh/huishype/agent-rules/test-requirements.md:1):

- `pnpm test`
- relevant Playwright follow-up coverage such as `pnpm test:e2e:flows` and `pnpm test:e2e:visual`
- `pnpm test:e2e:mobile` if the native UI is changed in the same implementation pass
