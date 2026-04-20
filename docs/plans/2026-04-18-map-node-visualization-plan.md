# Map Node Visualization Plan

Date: 2026-04-18
Status: Revised

## Goal

Refactor map-node transport, grouping, filtering, and rendering so the map
clearly distinguishes:

- properties that are currently listed
- properties that have social/platform activity
- properties that have both
- properties that are quiet

This is a pre-launch contract cutover. We do not need backward-compatible
payloads, careful backfills, or migration safety for user data. We should make
the cleanest contract we want, reseed as needed, and update backend route
schemas, OpenAPI, generated client types, app-local adapters, mocks, tiles,
nearby, batch, detail, and app parsing in one coordinated cutover.

## Product Decisions

The following decisions are locked for implementation:

- Listing lifecycle and social/platform activity are separate axes.
- The old `active|ghost` model may stay temporarily as a compatibility field,
  but it is no longer the semantic source of truth and must not demote
  active-listing properties into a ghost state.
- Likes, comment likes, replies, guesses, and views all count as social
  activity for map semantics.
- Saves remain user-private state and do not count toward public map semantics,
  public social scoring, or public cluster composition.
- Likes and views must count as social activity even when comments and guesses
  are zero.
- Cluster size may depend on `pointCount`.
- Cluster color may not depend on `pointCount`.
- Cluster visuals must be additive:
  active-listing signal in the outer treatment, social signal in the inner
  treatment, recent social signal in pulse.
- `hasListing` will mean "has any listing history" across property payloads.
- `hasActiveListing` will mean "has a current active listing".
- We still need exact listing lifecycle state for filters, so property payloads
  must also expose `marketState`.
- `latestListingStatus` is distinct from `marketState` and means the raw status
  of the latest listing row overall:
  `active | sold | rented | withdrawn | null`.
- Implementation must define and document what "latest" means using the current
  stable lifecycle-ordering fields first, and only add schema if the existing
  listing timestamps cannot support correct ordering when rows are updated in
  place.
- `Recently Active` is part of this refactor.
- `Recently Active` is orthogonal to `marketState`; users must be able to apply
  `For Sale` and `Recently Active` together.
- Public `activity` omission/default means `all`, not `social`.
- When public `marketState` is `for-sale` or `for-rent` and public `activity`
  is omitted or `all`, active-listing coverage must stay visible at low zoom
  even if those properties have no social activity.
- The DB is disposable, so we should also tighten weak view semantics now
  instead of designing around legacy rows.
- The DB is disposable, so we should also fix weak address/listing invariants
  now instead of carrying them into the contract redesign.

## Current Mismatch

The product spec already expects a split between inventory proof and social
activity:

- [agent-rules/main-spec.md](/home/caslan/dev/git_repos/hh/huishype/agent-rules/main-spec.md:152)

Today the implementation still collapses everything into one overloaded model.

### Backend behavior today

Current grouping logic treats a property as map-active if it has:

- an active listing, or
- comments, or
- guesses

Ghost classification is still:

- `!hasListing && activityScore === 0`

Relevant code:

- [services/api/src/services/property-grouping.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/services/property-grouping.ts:359)
- [services/api/src/services/property-grouping.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/services/property-grouping.ts:637)
- [services/api/src/services/property-grouping.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/services/property-grouping.ts:716)
- [services/api/src/routes/properties.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/properties.ts:622)
- [services/api/src/routes/properties.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/properties.ts:922)
- [services/api/src/routes/properties.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/properties.ts:1036)

That is wrong for the target model because:

- likes are counted but do not currently activate a property
- views are not part of grouping at all
- low-zoom candidate visibility ignores likes and views
- `hasListing` currently means "has active listing", not "has any listing"

### Client behavior today

The app still normalizes grouped nodes around:

- `nodeClass`
- `hasListing`
- `activityScore`

Relevant code:

- [apps/app/src/utils/api.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/utils/api.ts:408)
- [apps/app/src/hooks/useMapInteraction.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/hooks/useMapInteraction.ts:279)
- [apps/app/src/hooks/useMapInteraction.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/hooks/useMapInteraction.ts:877)
- [apps/app/src/hooks/useAmbientCommentBubbles.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/hooks/useAmbientCommentBubbles.ts:51)
- [apps/app/src/lib/mapFilterSelection.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/lib/mapFilterSelection.ts:14)
- [apps/app/src/lib/sharedMapFilters.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/lib/sharedMapFilters.ts:12)
- [apps/app/app/(tabs)/index.web.tsx](/home/caslan/dev/git_repos/hh/huishype/apps/app/app/(tabs)/index.web.tsx:1330)
- [apps/app/app/(tabs)/index.web.tsx](/home/caslan/dev/git_repos/hh/huishype/apps/app/app/(tabs)/index.web.tsx:1438)

That means even if tiles change, old semantics will survive in preview,
selection, search fallback, nearby fallback, ambient bubbles, preview hydration,
and cached web preview routes unless the whole client surface is updated.

Search-resolved previews are also explicitly forced quiet today on both native
and web, so that path must be corrected as part of the cutover rather than left
to hydration.

### Style behavior today

Cluster hue still steps by `point_count`, so color means density instead of
composition.

Relevant code:

- [services/api/src/routes/tiles.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/tiles.ts:554)

## Final Semantic Model

### 1. Listing lifecycle axis

This refactor needs three separate listing concepts:

- `hasListing`: property has any listing history, regardless of status
- `hasActiveListing`: property has a current active listing
- `marketState`: canonical map filter state

For this refactor:

- `marketState` remains the filtering concept for `for-sale`, `for-rent`,
  `sold`, `rented`, and `not-listed`
- `latestListingStatus` remains the raw status of the latest listing row
  overall: `active | sold | rented | withdrawn | null`
- detail/batch payloads should keep `latestListingStatus` wherever the UI or
  server logic needs to distinguish raw `withdrawn` from `not-listed`
- map visuals use `hasActiveListing`, not broad `hasListing`

This is intentionally different from current code, where `hasListing` is still
computed from `status = 'active'`:

- [services/api/src/routes/properties.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/properties.ts:622)
- [services/api/src/routes/properties.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/properties.ts:922)
- [services/api/src/routes/properties.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/properties.ts:1036)
- [services/api/src/services/property-grouping.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/services/property-grouping.ts:607)

Implementation note:

- do not keep re-deriving listing facts in each route or helper
- create one shared listing-facts source of truth for:
  - `hasListing`
  - `hasActiveListing`
  - `marketState`
  - `latestListingStatus`
- define "latest" in that shared source from an explicit lifecycle-ordering
  source/timestamp that stays correct even when a listing row is updated in
  place; if the current schema cannot do that safely, fix the schema as part of
  this cutover
- make tiles, nearby, list, batch, and detail consume that same source
- move existing owners onto that source as part of the cutover:
  - [services/api/src/services/map-filters.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/services/map-filters.ts)
  - [services/api/drizzle/0003_mv_latest_active_listings.sql](/home/caslan/dev/git_repos/hh/huishype/services/api/drizzle/0003_mv_latest_active_listings.sql)
  - [services/api/src/routes/feed.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/feed.ts)
  - [services/api/src/services/listings-view.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/services/listings-view.ts)
- retire duplicated listing semantics rather than layering one more join/view on
  top of them
- keep `/properties/resolve` lean; if it returns any listing signal for preview,
  it must be `hasActiveListing` or `marketState`, not broadened `hasListing`

Because the DB is disposable, this is also the right moment to strengthen the
listing-side invariants rather than layering more route-specific lateral joins on
top of today's duplicated semantics.

### 1a. Address canonicalization and uniqueness

The current property uniqueness model is weaker than it should be around
nullable house-number additions, but this should be handled proportionally.

Implementation decision:

- canonicalize `house_number_addition` before insert/upsert and in test
  fixtures/write helpers
- treat missing addition as one canonical value, not a mix of `NULL` and `''`
- reseed address data after the write-path normalization
- only rebuild the uniqueness constraint if reseeding/write normalization still
  leaves duplicate-address ambiguity or if the final listing-facts contract
  still needs storage-level tightening

This keeps `/properties/resolve` aligned with the data model without forcing a
larger index redesign unless the repo actually needs it.

### 2. Social/platform activity axis

For map semantics, "social activity" means persisted engagement on the property
or on the property's discussion:

- top-level comments
- replies
- property likes
- comment likes
- price guesses
- unique viewers

This is broader than the current implementation on purpose. The map should
reflect actual platform attention, not only comments and guesses.

### 3. Reveal tier

Keep `nodeClass` temporarily, but reinterpret it only as a compatibility field
for low-emphasis quiet nodes versus normally visible nodes:

- `active`: node has an active listing and/or social/platform activity and
  should render as a normal visible node
- `ghost`: node has no active listing and no social/platform activity and stays
  low-emphasis

This means:

- listing-only => `active`
- social-only => `active`
- listing + social => `active`
- quiet sold/rented/not-listed => `ghost` if shown by filters
- low-zoom public `for-sale` / `for-rent` coverage must keep listing-backed
  properties visible when `activity` is omitted or `all`, even with zero social
  activity

The old rule:

- `ghost = !hasListing && activityScore === 0`

must be deleted as the semantic definition.

## Social Event Contract

### Source tables

Use these sources:

- comments and replies: `comments`
- property likes: `reactions` on `target_type='property'` and
  `reaction_type='like'`
- comment likes: `reactions` on `target_type='comment'` and
  `reaction_type='like'`, rolled up through `comments.property_id`
- guesses: `price_guesses`
- views: `property_views`

Relevant schema:

- [services/api/src/db/schema.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/db/schema.ts:366)
- [services/api/src/db/schema.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/db/schema.ts:391)
- [services/api/src/db/schema.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/db/schema.ts:416)
- [services/api/src/db/schema.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/db/schema.ts:438)

### Dedupe rules

- comments and replies: each row counts once
- property likes: unique per user/target via the existing uniqueness
  constraint
- comment likes: unique per user/target via the same constraint
- guesses: count one guess per user/property, not edit history
- views for map scoring: count unique viewers, not raw view rows

Relevant current constraints:

- [services/api/src/db/schema.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/db/schema.ts:386)
- [services/api/src/db/schema.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/db/schema.ts:432)
- [services/api/src/db/schema.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/db/schema.ts:467)

### View contract

Views need to be tightened as part of this refactor.

Current write-time behavior is only lightly deduped:

- same user/session only counts once per hour
- fully anonymous rows with no stable session can still overcount

Relevant code:

- [services/api/src/routes/views.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/views.ts:62)

Implementation decision:

- keep raw `viewCount` for property detail analytics
- use `uniqueViewerCount` and `recentUniqueViewerCount` for map scoring
- keep `property_views` keyed by the existing `user_id` and `session_id`
  columns rather than adding a new `viewer_key`
- reject view writes that carry neither authenticated user ID nor anonymous
  session ID
- add a storage constraint if needed so fully anonymous rows cannot reappear
- count `DISTINCT COALESCE(user_id::text, session_id)` for
  `uniqueViewerCount` and `recentUniqueViewerCount`
- because the DB is disposable, old weakly-keyed `property_views` rows can be
  dropped or reseeded instead of carried forward
- tighten read semantics around the existing user/session identity fields, not
  fallback row IDs

This lets views count toward activity without letting raw repeated opens flood
the map.

### Recency window

Use a strict timestamp window:

- recent = last 7 days

Do not add a 30-day fallback. Pulse and `Recently Active` should stay crisp and
predictable.

For guesses, recency should use the latest meaningful event timestamp available
for the row. In the current schema that means:

- `GREATEST(created_at, updated_at)`

### Initial weights

Use the following starting weights:

- top-level comment: `1.00`
- reply: `1.00`
- property like: `1.00`
- comment like: `0.80`
- guess: `0.85`
- unique viewer: `0.50`

Notes:

- likes and comments remain the strongest family
- guesses remain slightly below comments/likes
- views stay meaningful but no longer dominate because the score uses unique
  viewers instead of raw view rows
- a single unique view should count as social activity, but should not pulse by
  itself

### Property-level scoring

```text
socialScore =
  topLevelCommentCount * 1.00 +
  replyCount * 1.00 +
  propertyLikeCount * 1.00 +
  commentLikeCount * 0.80 +
  guessCount * 0.85 +
  uniqueViewerCount * 0.50
```

```text
recentSocialScore =
  recentTopLevelCommentCount * 1.00 +
  recentReplyCount * 1.00 +
  recentPropertyLikeCount * 1.00 +
  recentCommentLikeCount * 0.80 +
  recentGuessCount * 0.85 +
  recentUniqueViewerCount * 0.50
```

Activity booleans:

- `hasSocialActivity = socialScore > 0`
- `hasRecentSocialActivity = recentSocialScore > 0`

That change is the direct fix for likes/views being ignored by the old
comments/guesses-only emphasis model.

## Transport Contract

### Grouped map payloads

Grouped payloads for vector tiles and `/properties/nearby` should carry only
the fields the renderer and grouped interactions actually need.

Keep:

- `nodeClass` as temporary reveal-tier compatibility
- `groupKind`
- `primaryPropertyId`
- `pointCount`
- `propertyIds`
- `previewPropertyIds`
- `coordinate`
- `bbox`
- `activeListingCount`
- `socialCount`
- `recentSocialCount`
- `socialScoreTotal`
- `socialScoreMax`
- `recentSocialScoreTotal`
- `commentCount`

Do not ship derived shares:

- `listingShare`
- `activeListingShare`
- `socialShare`

Those can be derived from counts in style expressions or client helpers.

Do not keep grouped payloads centered on:

- `hasListing`
- `activityScore`
- `activityScoreTotal`

because those are the old collapsed semantics.

Explicit decision for immediate single-tap preview flows:

- grouped single payloads stay intentionally thin, but they do keep the minimal
  preview seed needed for immediate render before hydration:
  - identity/location: `primaryPropertyId`, `groupKind`, `coordinate`
  - preview card seed fields already rendered from grouped data today:
    address/title snippet, price snippet, thumbnail
  - listing seed fields: `hasActiveListing`, `marketState`
  - lightweight semantic badges: `nodeClass`, `commentCount`,
    `socialCount`, `recentSocialCount`
- grouped single payloads do not grow into a second rich property contract and
  should not carry broad `hasListing`, full engagement breakdowns, or
  save-derived fields
- authoritative listing and social semantics still come from
  `/properties/batch` or `/properties/:id`, and hydration must replace grouped
  seed semantics rather than merge stale assumptions on top

### Property payloads

The property contracts used by:

- `/properties`
- `/properties/batch`
- `/properties/:id`

must be updated together.

`/properties/resolve` stays a lean address-resolution endpoint and is not part
of the rich social/listing contract cutover.

If `/properties/resolve` returns any listing signal for preview bootstrap, that
signal must be `hasActiveListing` or `marketState`, not broadened `hasListing`.
Search-resolved and cached preview flows must treat resolve data as neutral
bootstrap data and hydrate authoritative listing/social fields before deriving
badges, labels, or quiet/active semantics from it.

Required property-level fields:

- `hasListing`
- `hasActiveListing`
- `marketState`
- `latestListingStatus` where raw lifecycle detail matters
- `socialScore`
- `recentSocialScore`
- `lastSocialAt`, but only if its public value is not save-derived

Detail and batch payloads should also expose the engagement breakdown needed by
UI and preview composition:

- `topLevelCommentCount`
- `replyCount`
- `propertyLikeCount`
- `commentLikeCount`
- `guessCount`
- `viewCount`
- `uniqueViewerCount`
- recent 7-day counterparts for those fields, excluding saves from public
  payloads

Privacy rule for saves:

- saves do not contribute to public social scoring or public map semantics
- public property payloads must not expose `saveCount`, recent save counts, or
  save-derived timestamps
- `isSaved` remains user-private state on authenticated property/saved flows
- `/saved-properties` may still use private save metadata for ordering and the
  authenticated user's own list, but that metadata is not part of the public map
  semantics contract

The current single `activityLevel` field is not enough because it is still
derived from only recent views, comments, and guesses:

- [services/api/src/routes/views.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/views.ts:22)

### Types and contract ownership

Update these contract owners together:

- [packages/shared/src/types/property.ts](/home/caslan/dev/git_repos/hh/huishype/packages/shared/src/types/property.ts:249)
- [packages/shared/src/types/api.ts](/home/caslan/dev/git_repos/hh/huishype/packages/shared/src/types/api.ts:127)
- [packages/api-client/generated/api.ts](/home/caslan/dev/git_repos/hh/huishype/packages/api-client/generated/api.ts:598)
- [packages/api-client/src/client.ts](/home/caslan/dev/git_repos/hh/huishype/packages/api-client/src/client.ts:359)
- [apps/app/src/hooks/useProperties.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/hooks/useProperties.ts:12)
- [apps/app/src/utils/api.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/utils/api.ts:327)
- [services/api/src/routes/properties.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/properties.ts:1234)
- [packages/mocks/src/handlers/properties.ts](/home/caslan/dev/git_repos/hh/huishype/packages/mocks/src/handlers/properties.ts:315)
- [apps/app/src/hooks/useSavedProperties.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/hooks/useSavedProperties.ts)

Important changes:

- route schemas and OpenAPI remain the wire-contract source of truth
- generated client output must be regenerated from the updated OpenAPI spec
- shared grouped runtime types move from `hasListing/activityScore` to
  composition counts and scores
- app-local property adapters and app-local transport parsers must be updated
  alongside the wire contract
- include `/saved-properties` in the same cutover inventory across backend,
  shared types, generated client, api-client wrappers, app hooks, and mocks
- `packages/mocks` is hand-written and must be updated in lockstep; do not
  treat it as generated from OpenAPI
- do not add another hand-written raw nearby transport type to shared API types;
  keep the normalized grouped runtime shape in shared types and let the wire
  contract live in route schemas/OpenAPI/app parser code

## Filter Model

Do not overload `marketState`.

Current market-state filtering is a listing lifecycle taxonomy:

- [packages/shared/src/types/property.ts](/home/caslan/dev/git_repos/hh/huishype/packages/shared/src/types/property.ts:288)
- [apps/app/src/lib/sharedMapFilters.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/lib/sharedMapFilters.ts:12)

`Recently Active` and general social activity are not market states. Adding them
there would produce the wrong OR semantics.

Implementation decision:

- keep `marketState` for sale/rent/sold/rented/not-listed
- add a separate activity facet to `MapFilters`
- prefer one explicit facet:
  - `activity = 'all' | 'social' | 'recent'`
- stop inferring listing lifecycle from `askingPrice`, `hasListing`, or other
  legacy preview proxies in client-side filter matching

Semantics:

- market-state filters AND activity filters together
- omitted/default public `activity` is the same as `all`
- `For Sale` + `recent` means active listings with recent social activity
- `social` means any social activity
- `recent` means the strict recent-activity subset
- the filter model should not expose contradictory toggle combinations when a
  single facet can express the same intent more cleanly

This refactor includes:

- shared filter types
- filter-controller state
- query-string serialization/parsing
- tile URL and nearby URL builders
- server-side filter application
- filter pill UI
- filter-matcher helpers
- selection matching helpers

## Visual Rules

### Singles

- quiet, no active listing, no social activity:
  tiny neutral dot
- active-listing only:
  subdued listing ring, quiet core, no pulse
- social-only:
  socially colored core, no listing ring
- active-listing + social:
  listing ring plus socially colored core
- pulse:
  only when `recentSocialScore > 0`

A single unique view should count toward social state, but with the scoring
above it should not trigger pulse on its own.

### Clusters

- radius: `pointCount` only
- outer ring: derived from `activeListingCount / pointCount`
- inner fill: derived from `socialCount`, `socialScoreTotal`, and
  `socialScoreMax`
- pulse: derived from `recentSocialCount` and `recentSocialScoreTotal`
- label: communicates count only

Examples:

- a large quiet listing cluster stays listing-oriented, not hot
- a smaller socially intense cluster can look hotter than a larger quiet one
- a mixed cluster shows both ring and core composition at the same time

## Backend Plan

### 1. Rebuild grouping candidates around the final model

Relevant files:

- [services/api/src/services/property-grouping.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/services/property-grouping.ts:43)
- [services/api/src/routes/properties.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/properties.ts:250)
- [services/api/src/routes/views.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/views.ts:1)
- [services/api/src/services/map-filters.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/services/map-filters.ts)
- [services/api/src/routes/feed.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/feed.ts)
- [services/api/src/services/listings-view.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/services/listings-view.ts)
- [services/api/drizzle/0003_mv_latest_active_listings.sql](/home/caslan/dev/git_repos/hh/huishype/services/api/drizzle/0003_mv_latest_active_listings.sql)

Actions:

- broaden `hasListing` to any listing history on property payloads
- add `hasActiveListing`
- continue deriving `marketState` explicitly instead of inferring it only on the
  client
- define and centralize `latestListingStatus` as the raw latest listing-row
  status overall, using the current stable listing-ordering fields first and
  only adding schema if those fields cannot support correct ordering under
  in-place listing updates
- join comments, replies, property likes, comment likes, guesses, and unique
  viewers into grouping candidates
- compute `socialScore` and `recentSocialScore`
- treat any non-zero social score as socially active
- centralize listing facts once and retire duplicated listing semantics from
  routes, filters, feed, and listings-view composition

### 2. Replace candidate visibility and ghost logic

Actions:

- low-zoom visibility must include properties with non-zero social activity even
  if they only have likes or views
- low-zoom public visibility must also keep listing-backed `for-sale` and
  `for-rent` coverage when `activity` is omitted or `all`, even with zero
  social activity
- stop using comments/guesses-only candidate visibility
- reinterpret `nodeClass` from the new social activity booleans

### 3. Aggregate group composition

For every emitted group, calculate:

- `activeListingCount`
- `socialCount`
- `recentSocialCount`
- `socialScoreTotal`
- `socialScoreMax`
- `recentSocialScoreTotal`

### 4. Update grouped transports

Expose the new grouped contract in:

- vector tile feature properties
- `/properties/nearby`

The tile and nearby payloads must stay semantically aligned and continue to be
driven by one shared canonical group model rather than parallel transport logic.

### 5. Update property transports

Update:

- `/properties`
- `/properties/batch`
- `/properties/:id`

so the client no longer has to infer listing lifecycle or social state from
partial fields like `askingPrice != null`.

Do not expand `/properties/resolve` into a rich property endpoint. Keep it lean.
If it needs a preview listing signal, keep that to `hasActiveListing` or
`marketState`.

## Style Layer Plan

### 1. Remove color-by-count

Delete the behavior where hue steps by `point_count`:

- [services/api/src/routes/tiles.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/tiles.ts:554)

Only radius and count-label sizing may depend on `pointCount`.

### 2. Use additive style expressions

We do not need a new server style mechanism. We need new transport fields and
updated style definitions in the existing tile route.

This is not only a field change. Additive rendering may require property-layer
topology changes and updates to the shared property-layer ID / queryable-layer
assumptions that currently live in:

- [packages/shared/src/config/property-map.ts](/home/caslan/dev/git_repos/hh/huishype/packages/shared/src/config/property-map.ts:66)
- [services/api/src/routes/tiles.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/tiles.ts:536)

Required expression behavior:

- ring paint references active-listing composition fields
- fill paint references social composition/intensity fields
- pulse paint references recent-social fields
- none of those paints reference `point_count` for semantic hue

### 3. Keep single and cluster language aligned

Singles and clusters should feel like one system:

- listing state in the outer treatment
- social state in the inner treatment
- recent social state in pulse

## Client Plan

### 1. Update all grouped parsing and runtime consumers

Relevant files:

- [apps/app/src/utils/api.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/utils/api.ts:408)
- [apps/app/src/hooks/useMapInteraction.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/hooks/useMapInteraction.ts:279)
- [apps/app/src/hooks/useAmbientCommentBubbles.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/hooks/useAmbientCommentBubbles.ts:51)
- [apps/app/src/lib/mapRoute.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/lib/mapRoute.ts)
- [apps/app/src/components/GroupPreviewCard/types.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/components/GroupPreviewCard/types.ts)
- [apps/app/src/components/PropertyBottomSheet/types.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/components/PropertyBottomSheet/types.ts)
- [apps/app/src/hooks/useSavedProperties.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/hooks/useSavedProperties.ts)
- [apps/app/app/(tabs)/index.tsx](/home/caslan/dev/git_repos/hh/huishype/apps/app/app/(tabs)/index.tsx:442)
- [apps/app/app/(tabs)/index.web.tsx](/home/caslan/dev/git_repos/hh/huishype/apps/app/app/(tabs)/index.web.tsx:829)

Actions:

- update tile parsing
- update nearby parsing
- update group preview composition
- update search-resolve fallback so lean resolve payloads stay neutral/loading
  and do not hardcode quiet or listing-false placeholders that later masquerade
  as authoritative state
- update preview hydration so grouped/resolve seed semantics are always replaced
  by authoritative batch/detail semantics instead of surviving as stale fallbacks
- update cached web preview-route state with the same rule: hydrate
  authoritative listing/social fields before deriving badges or labels
- update ambient bubble candidate parsing/ranking so it no longer depends on the
  old collapsed map semantics
- keep comment presence as a requirement for comment bubbles
- do not broaden bubbles to likes-only or views-only nodes
- stop deriving semantics locally from old `activityScore` assumptions

### 2. Update property hydration consumers

Relevant surfaces:

- `/properties/batch` hydration used by cluster previews
- `/properties/:id` hydration used by the bottom sheet
- map selection helpers
- web preview route caching
- app-local property adapters and bottom-sheet data models

Specific gaps to close:

- `convertToGroupProperty()` must stop deriving score from comments + guesses
  only
- selection matching must stop inferring listing state from `askingPrice`
- web route preview state must stop hardcoding `hasListing: false`, `quiet`, or
  similar placeholders from grouped/resolve seed data
- app-local `BatchProperty`, `PropertyDetails`, and bottom-sheet types must stop
  collapsing the new contract back into legacy `activityLevel`-centric shapes
- `/saved-properties` consumers must stay aligned with the new privacy rules:
  keep `isSaved`, do not reintroduce public save-count semantics client-side

### 3. Update copy and badges

Relevant files:

- [apps/app/src/components/PropertyPreviewCard.tsx](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/components/PropertyPreviewCard.tsx:54)
- [apps/app/src/components/PropertyBottomSheet/PropertyHeader.tsx](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/components/PropertyBottomSheet/PropertyHeader.tsx:70)
- [apps/app/src/components/PropertyBottomSheet/PropertyDetails.tsx](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/components/PropertyBottomSheet/PropertyDetails.tsx:97)

Actions:

- stop using one-axis `Quiet / Active / Hot` as the semantic summary
- show listing lifecycle and social state separately
- include `Recently Active`
- include broader activity details beyond views/comments/guesses

This is a Phase 4 follow-up, not the contract-critical path. Parser, hydration,
filter, and runtime propagation come first.

### 4. Add the orthogonal activity filters

Relevant files:

- [packages/shared/src/types/property.ts](/home/caslan/dev/git_repos/hh/huishype/packages/shared/src/types/property.ts:288)
- [apps/app/src/lib/sharedMapFilters.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/lib/sharedMapFilters.ts:12)
- [apps/app/src/components/map/MapFilterBar.tsx](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/components/map/MapFilterBar.tsx:608)

Actions:

- keep the existing market-state UI
- add one explicit activity facet with values like `All`, `Social Activity`,
  and `Recently Active`
- serialize that facet explicitly in the map URL/filter model
- apply it independently of `marketState`

## Testing Plan

### Contract-first verification

This refactor must update all of the following together:

- route schemas
- OpenAPI export
- generated client types
- generated-client coverage where these routes are exposed
- shared normalized grouped runtime types
- app-local transport parsers and property adapters
- app parser tests
- MSW fixtures, handlers, and alignment assertions
- `/saved-properties` contract owners and tests in the same cutover, not as a
  follow-up

The cutover risk is contract drift, not migration risk.

Note:

- run [package.json](/home/caslan/dev/git_repos/hh/huishype/package.json:22)
  `pnpm openapi:export` and `pnpm api-client:generate` as explicit steps in the
  refactor, not as implied side effects
- the current generated-client wrapper coverage for these property routes is
  thin, so regeneration alone is not enough
- extend client and mock assertions for the affected property routes as part of
  this refactor

### Backend tests

Update and expand:

- [services/api/src/services/property-grouping.test.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/services/property-grouping.test.ts:42)
- [services/api/src/__tests__/integration/tiles.integration.test.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/__tests__/integration/tiles.integration.test.ts:129)
- [services/api/src/__tests__/properties-nearby.test.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/__tests__/properties-nearby.test.ts:143)
- [services/api/src/__tests__/integration/properties.integration.test.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/__tests__/integration/properties.integration.test.ts:473)
- [services/api/src/__tests__/integration/batch-properties.integration.test.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/__tests__/integration/batch-properties.integration.test.ts:67)
- [services/api/src/__tests__/integration/resolve.integration.test.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/__tests__/integration/resolve.integration.test.ts:139)
- [services/api/src/__tests__/integration/property-views.integration.test.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/__tests__/integration/property-views.integration.test.ts:190)
- [services/api/src/__tests__/integration/property-saves.integration.test.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/__tests__/integration/property-saves.integration.test.ts:200)

Assert exact composition math, not vague activity labels:

- likes-only property becomes socially active
- views-only property contributes social score through unique viewers
- listing-only property remains visibly listing-backed but not socially active
- mixed groups report exact `activeListingCount`, `socialCount`,
  `recentSocialCount`, `socialScoreTotal`, `socialScoreMax`, and
  `recentSocialScoreTotal`
- decode seeded MVT responses and assert actual feature properties, not only
  byte output or non-empty tiles
- tile assertions should cover grouping/listing/composition fields such as
  `groupKind`, `primaryPropertyId`, `pointCount`, `activeListingCount`,
  `socialCount`, `recentSocialCount`, `socialScoreTotal`, `socialScoreMax`,
  `recentSocialScoreTotal`, and single-preview listing seed fields where present
- ring/fill/pulse expressions reference composition fields, not `point_count`
  for semantic color

### Frontend tests

Update and expand:

- [apps/app/src/utils/__tests__/api.test.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/utils/__tests__/api.test.ts:1)
- add direct normalization tests around
  [apps/app/src/utils/api.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/utils/api.ts:408)
- [apps/app/src/hooks/__tests__/useMapInteraction.test.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/hooks/__tests__/useMapInteraction.test.ts:118)
- [apps/app/src/lib/__tests__/mapFilterSelection.test.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/lib/__tests__/mapFilterSelection.test.ts:3)
- [apps/app/src/hooks/__tests__/useMapFilterController.test.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/hooks/__tests__/useMapFilterController.test.ts:1)
- [apps/app/src/lib/__tests__/sharedMapFilters.test.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/lib/__tests__/sharedMapFilters.test.ts:1)
- [apps/app/src/hooks/__tests__/useAmbientCommentBubbles.test.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/hooks/__tests__/useAmbientCommentBubbles.test.ts:18)

Add assertions for:

- grouped response parsing of the new contract
- preview state using listing/social/recent composition instead of one
  `activityScore`
- stale grouped/resolve preview semantics are replaced on hydration rather than
  surviving into the bottom sheet or cached web route
- filter matching for `For Sale` + `Recently Active`
- selection helpers respecting server-provided listing lifecycle fields
- ambient bubbles still functioning after the grouped contract changes
- ambient bubble admission still requires comment presence
- likes-only and views-only nodes do not produce comment bubbles
- search/cached-web preview flows do not invent quiet or listing-false
  placeholders from lean resolve responses

### Hermetic fixtures

Because the DB is disposable, tests should build on the existing hermetic
integration helpers and use deterministic fixtures for:

- listing-only
- social-only
- views-only
- recent-only
- sold-only
- mixed listing + social
- replies
- property likes
- comment likes

Do not keep ambient Eindhoven-data tolerance for the core semantics of this
refactor.

This means extending the existing integration helpers and migrating nearby/tile
semantics onto owned fixtures rather than seeded city data. Add or expand
fixture builders in the current helpers for:

- comments
- replies
- reactions
- views

### Visual verification

Before calling this complete, capture screenshots for:

- dense listing-heavy, low-social area
- socially intense smaller area
- mixed area
- high-zoom singles for listing-only, social-only, and listing+social
- filtered `For Sale` + `Recently Active`

## Rollout Sequence

### Phase 1: Lock contracts

- finalize grouped payload fields
- finalize property-level listing and activity fields
- finalize filter-model additions
- update route schemas, normalized shared grouped types, app-local adapters, and
  OpenAPI/client generation plan

### Phase 2: Rebuild backend semantics

- build one shared listing-facts source of truth
- implement the new listing booleans and lifecycle fields
- define `latestListingStatus` from the current listing-ordering fields and add
  schema only if those fields prove insufficient
- compute social and recent-social aggregates
- update grouping and nearby output
- tighten view write/read semantics around the existing `user_id`/`session_id`
  fields and remove fully anonymous view rows
- normalize address additions in write paths/helpers and reseed
- rebuild the address uniqueness constraint only if the normalized reseed still
  leaves duplicate-address ambiguity

### Phase 3: Update app parsing and filter model

- update grouped parsers
- update batch/detail consumers
- update preview hydration and cached web preview-route state
- add activity filters and query serialization
- remove local semantic re-derivations

### Phase 4: Rewrite visuals and copy

- replace color-by-count
- add additive listing/social rendering
- update preview/header/details copy and badges

### Phase 5: Verify and tune

- run screenshot verification
- tune thresholds if needed
- run the canonical repo gate with `pnpm test`
- run broader visual verification with `pnpm test:e2e:visual`,
  `pnpm test:e2e:flows`, and `pnpm test:e2e:mobile`, or use `pnpm test:all`

## Non-Goals

- Do not preserve the old grouped contract for compatibility.
- Do not keep cluster hue tied to `pointCount`.
- Do not collapse listing lifecycle and social activity back into one boolean or
  one label.
- Do not treat `Recently Active` as a market state.
- Do not ship a backend-only change that leaves the client deriving old
  semantics.

## Final Outcome

After this work:

- `hasListing` means any listing history
- `hasActiveListing` means current listing presence
- sold filtering has the exact lifecycle fields it needs
- likes, comment likes, replies, guesses, and views all count toward map
  activity
- saves stay private user state and do not affect public map activity
- views are counted through unique viewer semantics instead of noisy raw totals
- listing and social state render as separate but composable signals
- `Recently Active` works as an orthogonal filter with `For Sale`
- tiles, nearby, batch, detail, types, filters, and UI all speak the same
  contract
