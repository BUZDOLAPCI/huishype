# Feed And Map Filter Unification Plan

Date: 2026-06-13
Status: Proposed

## Goal

Make feed and map discovery use the same mental model:

- Feed tabs choose the content mode.
- Shared filters apply the same predicates across map and feed wherever that
  predicate is meaningful.
- There is no feed-only recency tab that duplicates filter behavior.
- Shared filter state is URL/share-state, including following scope.

## Product Direction

Use two feed tabs:

- `Trending`: ranked property discovery based on interest, interaction, and freshness.
- `Activity`: newest social, listing, and property lifecycle activity as an
  event-style feed.

Remove `Latest` as a feed tab. Recency should be handled through shared filters,
not through a separate feed mode. Do not preserve `Latest` as a compatibility
mode or emulate its current `last_activity_at` ordering. The final model is:

- `Listed since` filters listing lifecycle recency.
- The `Activity` filter constrains social recency.
- `Trending` remains ranked discovery.
- `Activity` remains an activity-oriented feed.

Move `Following` out of the feed tab row. Reuse the existing map `Following`
filter as the shared map/feed scope toggle, so users can view both map and feed
through:

- everyone/public activity
- people they follow

This deliberately reverses the current private/non-shareable following-scope
model. Going forward, following scope must be serialized in shared filter state
and shared URLs as a normal viewer-relative filter. Remove the extra private
map-session/history behavior and the deprecated special handling that keeps
following scope out of public route state. The filter model should have one
normal `scope` value that map, feed, API requests, and URL helpers all
understand.

Shared URLs with `scope=following` are literal and auth-gated. If a logged-out
viewer opens one, keep the URL state and show a sign-in/auth-required state; do
not silently fall back to public results. Results are evaluated relative to the
authenticated viewer's follow graph, so the same URL can legitimately resolve
to different result sets for different signed-in users.

## Unified Filters

All map filters should also apply to feed pages. The target state is one
canonical filter model shared by both surfaces.

The shared filter set should include:

- area / location
- market state
- sale price
- rent price
- activity window
- following scope via the existing map `Following` filter
- listed since

This makes map and feed different views over the same discovery state. Changing
a shared filter in one surface should apply the same predicate semantics in the
other surface, but the surfaces do not need to return identical rows or use the
same ordering:

- Map remains spatial and tile-oriented.
- `Trending` remains ranked property discovery.
- `Activity` remains activity-oriented.

The important invariant is that shared filters mean the same thing everywhere:
area, market state, price, activity window, following scope, and listed-since
must not have divergent map/feed interpretations.

Feed tabs are the only feed-specific control. They choose presentation/ranking
mode, not filtering scope.

## Listed Since

Add a shared `Listed since` filter for listing recency.

Suggested options:

- Any time
- Today
- Last 3 days
- Last 5 days
- Last 10 days
- Last 30 days

`Listed since` filters listing lifecycle recency only. It is not a replacement
for the old `Latest` sorting semantics, and it should not be implemented using
social activity, property update, or feed `last_activity_at` timestamps.

Use the current canonical listing's lifecycle timestamp:

1. `canonical_listings.listed_at`
2. fallback to `canonical_listings.first_seen_at`
3. fallback to `canonical_listings.created_at`

`Current canonical listing` means the same canonical listing record that is used
to derive the property's current market state and displayed price on that
surface. Do not let a property qualify because a different, non-displayed
historical listing happens to be inside the selected window.

The filter applies only to listing-backed market states. When `listedSince` is
active:

- `for-sale` and `for-rent` listings are eligible if their lifecycle timestamp
  is inside the selected window.
- `sold` and `rented` listings use the original listed date, not the sold date
  or rented date.
- `not-listed` properties are excluded, because they do not have a listing
  lifecycle timestamp.

Example combinations:

- `Trending` + `Listed since: Last 3 days` = interesting newly listed homes
- `Activity` + `Listed since: Last 3 days` = recent activity on newly listed homes

The label should avoid source-specific wording like `Days on Funda`, because
HuisHype is multi-source and multi-country.

## Activity Filter

Bring the map `activity` filter into feed behavior as a first-class shared
filter.

The filter should constrain results by social activity recency while remaining
orthogonal to listing lifecycle and listed-since recency.

Qualifying social activity means visible user actions:

- property likes
- comments
- price guesses

Passive property views do not qualify a property for the `Activity` filter and
do not create Activity feed events. Views may still contribute to trending,
interest, or attention metrics where those rankings explicitly use them, but
they must not be used as the social-activity predicate for shared filters.

Keep the current `all` versus `all-time` distinction:

- `activity=all` means no social-activity constraint.
- `activity=all-time` means require qualifying social activity at any time.
- `activity=today` and windowed values require qualifying social activity within
  that window.

Default behavior:

- Public map defaults to `activity=all`.
- `Trending` defaults to `activity=all`.
- `Activity` feed with omitted/default `activity=all` shows social events plus
  public `just-listed` lifecycle events.
- `Activity` feed with an active activity filter (`today`, `10d`, `30d`, or
  `all-time`) shows only social events that satisfy the social-activity
  predicate. Listing lifecycle events are not included while an activity filter
  is active.
- `Activity` feed with `scope=following` shows only qualifying social events
  from followed users. It does not include `just-listed` lifecycle events,
  because following scope is about people the viewer follows.

The `Activity` tab should not emit sold/rented lifecycle events and should not
emit synthetic lifecycle milestone events such as `listed 10 days ago`. Those
states remain available through market-state and `listedSince` filters.

Example combinations:

- `Trending` + `Activity: Today`
- `Trending` + `For sale` + `Activity: Last 10 days`
- `Activity` + `Following` + `Activity: Last 30 days`
- `Activity` + default filters = social events plus public just-listed events
- `Activity` + `Listed since: Last 3 days` = social events on newly listed
  homes plus public just-listed events for homes listed in the selected window

## Backend Shape

Rework the backend around the unified filter model directly. Do not keep the
current feed-specific exclusion of activity filtering, and do not add an
intermediate compatibility layer that preserves the old split.

Target backend behavior:

- Shared request parsing accepts area, market state, sale/rent price, activity,
  following scope, and listed-since for map, feed, and activity feed routes.
- `/feed` applies shared predicates before ranking `Trending` results.
- Activity feed routes apply the same shared predicates before selecting and
  ordering activity events.
- Tile/grouping routes apply the same shared predicates where they are relevant
  to spatial candidates.
- Following scope is a normal serialized filter value. Auth is still required to
  resolve followed users/properties, but URL/share-state should no longer hide
  or special-case the selected scope.
- Following-scoped shared URLs serialize the selected scope, but results are
  evaluated relative to the authenticated viewer's follow graph.
- Logged-out following-scoped requests should fail or return an auth-required
  response/state; they must not be rewritten to public scope.
- Activity predicate builders must exclude passive views from qualifying social
  activity, even if views remain available for trending or attention metrics.
- Listed-since predicate builders must use the selected market-state/display
  listing's lifecycle timestamp and indexed/precomputed facts for tile paths
  where needed.

Implementation should remove old guardrails that intentionally stripped or
ignored shared feed activity filters, and should simplify URL/filter utilities
that previously kept following scope private.

## Implementation Cleanup

Remove the old feed modes and split-state plumbing as part of the unification:

- Remove `latest` from feed tabs, shared feed tab types, validation schemas, URL
  parsing, and API feed filter options.
- Remove `following` as a feed tab. Following becomes shared filter scope only.
- Add `listedSince` to shared filter types, URL serialization, request
  validation, client query construction, and backend predicate builders.
- Carry `activity` through feed and activity-feed client queries instead of
  stripping it before the API boundary.
- Serialize following scope in the same shared filter state used by map and
  feed URLs. Delete deprecated behavior that ignores, hides, or privately
  persists the selected following scope.
- Keep auth checks at the API layer for resolving following-scoped results. A
  shared URL may contain following scope, but the viewer still needs permission
  to evaluate that scope.
- Remove or rename social-activity internals that treat property views as
  qualifying activity. Keep view metrics only in ranking/attention contexts.
- Add listing lifecycle timestamp facts/indexes needed for `listedSince` on map
  tile/grouping paths.

## UX Principles

- Keep the feed tab row short and stable.
- Avoid overlapping labels such as `Latest` and `Recent Activity`.
- Use filters for constraints and tabs for content modes.
- Preserve shareable URL/filter state across web feed and map, including
  following scope.
- Avoid separate feed-only filters unless there is a strong product reason.
- Keep following scope literal. If a URL says following and the viewer is not
  signed in, show that the view requires sign-in instead of changing the
  selected scope.

## Target End State

The feed top row becomes:

- `Trending`
- `Activity`

The common filter rail handles:

- following scope via the existing map `Following` filter
- listed recency
- social activity recency
- market and price constraints
- area constraints

The result should feel like one product surface with two views: map and feed.
The map and feed do not need identical rows or ordering, but shared filters must
use the same predicates and the same URL/share-state semantics.
