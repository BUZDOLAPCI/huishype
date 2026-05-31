# Location Search And Shared Filter Root Causes

Date: 2026-05-31

Branch context: location-search and shared-filter overhaul.

This note records the verified root causes and proposed fixes for the issues found while testing the location-search and shared-filter work. No product code fixes were applied during this investigation.

## Summary

Issues covered:

- Duplicate city suggestions for `Eindhoven`, also seen for `Geldrop` and `Veldhoven`.
- Feed price filter opens duplicate panels after Map -> Feed navigation and blocks Apply.
- Selecting a property search result logs a React render/update warning.
- `/properties?area=city:NL:eindhoven&activity=30d` is much slower than the same area query without activity.
- `Zwaanstraat` ranking is weak when the request has no explicit `lon`/`lat` bias.
- Address/property result selection leaves unclear visible state when an area chip is already active.
- Generated API client/OpenAPI contracts do not fully expose the new shared feed/activity filter params.
- Read/following tile source query keys omit area tokens even though their tile URLs include them.

## Duplicate City Suggestions

### Repro

```text
GET /search/locations?q=Eindhoven&limit=10&countrycode=NL
```

Observed city rows:

```text
Eindhoven / Eindhoven, Netherlands
Eindhoven / Noord-Brabant, Netherlands
Eindhoven / Netherlands
```

Observed token ids:

```text
city:NL:eindhoven:city=eindhoven:region=eindhoven
city:NL:eindhoven:city=eindhoven:region=noord-brabant
city:NL:eindhoven:city=eindhoven
```

### Root Cause

The backend treats same-city region variants as different area suggestions.

`services/api/src/services/location-search.ts` groups DB city suggestions by region:

```sql
SELECT DISTINCT ON (p.country_code, p.city, p.region)
```

`buildDbAreaSuggestion()`, `buildTokenId()`, `buildLocationSuggestionDedupeKey()`, and token hydration then preserve that region value for city suggestions. The local data contains multiple region shapes for the same city, for example `Eindhoven`, `Noord-Brabant`, and `NULL`. Photon and Overture also use different administrative labels, so Photon only dedupes with one variant instead of collapsing all same-city rows.

The map filter predicate already allows a regionless city token to match all regions for that city. The duplicate suggestions are therefore a suggestion/hydration modeling problem, not a filtering capability problem.

### Proposed Fix

Make regionless city tokens the canonical representation for ordinary city suggestions.

For city suggestions and city-token hydration, aggregate by `(country_code, normalized_city)` instead of `(country_code, normalized_city, normalized_region)`. Emit one broad city token with `region: null`, an internal aggregated result count for ranking, and an aggregate point/bounds from the matching city rows. Continue to include `country_code` in the key so same-name cities across countries remain distinct.

Do not add `resultCount` or similar public response fields unless the API contract is intentionally expanded. The current suggestion/token contract does not expose an aggregate count.

Only emit or hydrate a region-specific city token when the input token explicitly contains a region and needs to round-trip that exact token. Search suggestions for a plain city query should not expose raw `properties.region` variants.

### Test Coverage

- Add an API integration fixture with one city represented by municipality-like region, province-like region, and `NULL`; assert exactly one city suggestion.
- Tighten the existing `returns one city area suggestion...` integration test to assert `citySuggestions.length === 1`, not only `arrayContaining`.
- Assert the emitted city token has no region and still matches all backing city rows through `map-filters`.
- Update any web E2E expectations that currently assume a hydrated city URL token round-trips with `region=noord-brabant`; canonical ordinary city tokens should hydrate regionless.

## Feed Price Filter Opens Duplicate Panels

### Repro

1. Open Map.
2. Add/select an `Eindhoven` area chip.
3. Navigate Map -> Feed.
4. Click Feed `Price`.
5. Enter sale min `500000`.
6. Click Apply.

Observed:

- Two `map-filter-rail` nodes after Map -> Feed.
- Two `map-filter-pill-price` nodes.
- Two `map-filter-panel-price` nodes after opening Feed Price.
- Two `map-filter-panel-backdrop` nodes.
- Two `map-filter-apply-price` nodes.
- Apply can be blocked by `map-filter-panel-backdrop`.

### Root Cause

The shared filter controller mixes persistent filter data with transient UI state.

`apps/app/app/(tabs)/_layout.tsx` wraps the tab tree in `PropertyFilterProvider`, and `PropertyFilterProvider` creates one shared `useLocalMapFilterController()`. Both Map and Feed consume that controller through `useMapFilterController()`.

That shared controller owns both:

- `appliedFilters`, which should be shared across Map and Feed.
- `draftFilters`, `openCategory`, and panel interaction state, which are per-filter-bar UI state.

On web, the Map screen remains mounted behind Feed after tab navigation. Clicking Feed `Price` sets shared `openCategory = 'price'`, so both the active Feed filter bar and the inactive Map filter bar render a price panel and backdrop.

There is also an inline layout stacking bug in `MapFilterBar`: the backdrop has a higher z-index than the inline container, so even a direct Feed load can place the backdrop above the Apply button.

### Proposed Fix

Share only committed filter state through `PropertyFilterProvider`.

Keep `appliedFilters` and filter commit/reset APIs shared, but move `openCategory` and all panel draft UI state into each `MapFilterBar` instance. A filter bar should create its own local draft from the latest shared `appliedFilters` when a panel opens, then commit back to shared `appliedFilters` only when Apply is pressed. Closing/canceling a panel should discard only that instance's local draft.

Render panel/backdrop UI only from the local `MapFilterBar` state. For `layout="inline"`, keep the backdrop below the inline panel controls, or use an inline-contained backdrop that cannot intercept Apply.

### Test Coverage

- Web E2E: Map -> Feed -> open Price renders exactly one price panel and one backdrop.
- Web E2E: Feed Price Apply is clickable and updates the shared applied filter.
- Component test: two filter bars can share committed filters without opening each other's panels.

## Property Result Selection React Warning

### Repro

1. Search `Deflectiespoelstraat`.
2. Select `Deflectiespoelstraat 8`.

Observed route:

```text
/map/eindhoven/5651hp/deflectiespoelstraat/8
```

Observed console warning:

```text
Cannot update a component (MapScreen) while rendering ...
```

The warning occurs while detail child rendering triggers query activity from `PropertyContent`, `PriceGuessSection`, and `CommentsSection`.

### Root Cause

`useMapInteraction()` mounts `usePropertyLike()` and `usePropertySave()` for the selected property. `PropertyContent` also mounts those hooks for its own like/save controls. Both hooks subscribe to the entire TanStack Query cache through `useSyncExternalStore` and `queryClient.getQueryCache().subscribe(...)`.

When the selected property detail tree renders, unrelated queries are created or updated:

- `PropertyContent` calls `useListings`.
- `PriceGuessSection` calls `useFetchPriceGuess`.
- `CommentsSection` calls `useComments`.

Because the like/save hooks listen to the whole query cache, those unrelated query events can synchronously notify the MapScreen subscription while child components are rendering. That produces the React "Cannot update a component while rendering" warning.

### Proposed Fix

Replace the broad cache subscriptions in `usePropertyLike()` and `usePropertySave()` with key-filtered subscriptions, or with a small exact-key TanStack Query observer/cache-read helper if that preserves the current no-fetch behavior.

Create a shared helper that subscribes to the query cache but calls the external-store listener only for data-affecting events on the relevant property detail query hash. The hook should compute the expected hash from the exact property detail query key, including the viewer key, and ignore all events whose `event.query.queryHash` does not match. It should also ignore non-data events where possible, notifying only for matching `updated` and `removed` events.

This keeps optimistic like/save state synchronized with the property detail cache while preventing listing, price-guess, comment, and other unrelated query activity from updating MapScreen or `PropertyContent` during detail rendering.

### Test Coverage

- Hook test: unrelated query cache updates do not notify `usePropertyLike()`.
- Hook test: unrelated query cache updates do not notify `usePropertySave()`.
- Browser or integration E2E: selecting a property search result opens details with no console errors.

## Slow Properties Area + Activity Query

### Repro

```text
GET /properties?limit=3&area=city:NL:eindhoven&activity=30d
```

Observed timings from local API probes:

```text
/properties?limit=3&area=city:NL:eindhoven                         ~0.04s, total 153015
/properties?limit=3&area=city:NL:eindhoven&marketState=for-sale     ~4.6s, total 323
/properties?limit=3&area=city:NL:eindhoven&activity=30d             ~15.8s, total 5
```

The activity query returned `200` in the latest probe rather than timing out, but the performance problem is confirmed.

### Root Cause

`/properties` applies per-property lateral social aggregation to a large area candidate set when `activity !== 'all'`.

In `services/api/src/routes/properties.ts`, activity filtering sets `requiresSocialFactsForCount`, then injects `buildPropertySocialFactsJoin('p', 'sf')` into both the exact count query and the page id query. `buildPropertySocialFactsJoin()` in `services/api/src/services/property-queries.ts` performs lateral aggregation over comments, reactions, guesses, and views per candidate property.

For `city:NL:eindhoven`, the non-spatial area predicate produces roughly 153k candidates. The count and page-id stages then run social aggregation across that large candidate set before the final limited result page is selected. Skipping exact count alone would not fix the issue because the page-id query still performs the same lateral social facts join.

### Proposed Fix

Replace the per-row lateral activity filtering in the `/properties` count and page-id paths with one candidate-first, set-based activity CTE.

The query should:

1. Build the base candidate set first using area, market state, price, base property filters, and any existing list predicates.
2. Aggregate social facts once per candidate `property_id` with grouped joins or CTEs, following the set-based pattern already used in `services/api/src/services/property-grouping.ts`.
3. Apply the activity predicate to that grouped social-facts result.
4. Use the resulting active candidate set for both exact count and ordered page ids.
5. Keep the existing lateral `buildPropertySocialFactsJoin()` only for the final limited page rows, where it runs against a small result set.

Do not rely on tile snapshot tables as the source for this list filter; the list endpoint should remain live and consistent with property detail/social state.

### Test Coverage

- API regression test for `/properties?limit=3&area=city:NL:eindhoven&activity=30d` that asserts a fast successful response and the expected filter semantics.
- SQL-shape or unit test proving the activity-filtered list count/page-id paths no longer include per-row `buildPropertySocialFactsJoin()`.
- Existing list filter integration tests should verify activity combines correctly with area, market state, and price.

## Zwaanstraat Ranking Without Bias

### Repro

```text
GET /search/locations?q=Zwaanstraat&limit=10&countrycode=NL
```

Observed:

- Without `lon`/`lat`, non-Eindhoven `Zwaanstraat` results can rank first.
- With Eindhoven-ish `lon`/`lat`, the Eindhoven `Zwaanstraat` result ranks first.

### Root Cause

Street suggestions with the same street name across many cities are primarily disambiguated by proximity, but final merged suggestion sorting only applies when the request includes explicit `lon` and `lat`.

The UI already passes useful bias in many paths:

- Map search forwards viewport bias through `SearchBar` and `useLocationSearch`.
- Feed search falls back through map search bias, user-location bias, and country default bias.

Photon already receives a country-default center when `countrycode` is present and no explicit `lon`/`lat` is supplied. The gap is narrower: DB-backed suggestions and the final merged suggestion ordering still use no fallback proximity, so direct API calls and any UI surface without explicit bias can fall back to weaker text/count ordering. That is not enough for common Dutch street names such as `Zwaanstraat`.

### Proposed Fix

Give backend search a deterministic ranking fallback proximity when the request has no explicit `lon`/`lat`.

For country-scoped searches, compute ranking proximity as:

```text
explicit request lon/lat, else requested country's configured default center
```

Use that ranking proximity for DB-backed suggestions and final merged ordering. Photon can keep using the same country-default center it already receives, but the final merged sort should use the same fallback so DB and Photon results are compared consistently. Keep the API semantics clear by treating this as ranking-only fallback bias, not as an explicit user location. If telemetry needs the distinction, record whether proximity was explicit or defaulted.

This preserves strong map/feed behavior when real viewport or user-location bias exists, while making no-bias country-scoped searches stable and country-relevant. The Feed currently tries to obtain user location on mount for search bias; avoid introducing new permission prompts just to improve fallback ranking.

### Test Coverage

- API test: no-bias `Zwaanstraat` with `countrycode=NL` ranks the country-default-near result deterministically.
- API test: explicit Eindhoven `lon`/`lat` still ranks Eindhoven `Zwaanstraat` first.
- API test: explicit non-Eindhoven `lon`/`lat` can override the country default.

## Address And Property Result Selection State

### Repro

1. Add an `Eindhoven` area chip.
2. Search `Beeldbuisring`.
3. Select the first address/property result.

Observed:

- URL can stay on the existing Eindhoven area filter.
- No address or street chip appears.
- Search text can remain visible.
- Property detail-related network calls fire, but the visible selected target state is unclear.

### Root Cause

The search bar has two different result contracts, but the UI does not make the direct-result contract visibly clear.

Area suggestions call `onAreaSelected()` and intentionally update area filter chips. Direct `property` and `address` suggestions call `handleResultPress(toResolvedAddress(...))` instead. That path resolves or opens a target address/property and does not create an area token.

On Map, resolved property/address selections generally do open a visible preview or detail target. On Feed, `handlePropertyPress()` navigates to the property route, but `handleFeedSearchLocationResolved()` is a no-op for unresolved address selections. That means an address result can fire resolution/detail work without producing a clear route, chip, panel, or cleared search state. Existing tests already encode that direct address selection should not create area chips, so the bug is ambiguous visible state, especially on Feed, not missing chip creation.

### Proposed Fix

Define direct address/property search results as preview/navigation actions, not filters.

When a user selects a direct property or address result:

- Leave existing area chips unchanged.
- Do not create an area, street, or address chip.
- Clear transient search text and close the suggestion list after selection.
- On Map, focus/fit the camera to the selected target and open the property/address preview so the selection is visible.
- On Feed, navigate to the same visible property/detail preview flow when a property can be resolved; for unresolved addresses, navigate to the map preview/focus flow rather than silently staying on the filtered feed.

This keeps area tokens reserved for filterable area suggestions and makes direct search results behave like visible target selection.

### Test Coverage

- E2E: selecting a direct property result while an area chip is active keeps the chip, clears search text, and opens the property preview/detail route.
- E2E: selecting a direct address result while an area chip is active keeps the chip, clears search text, and focuses/opens a visible address preview.
- Feed E2E: selecting an unresolved direct address while an area chip is active navigates to a visible map focus/preview flow instead of remaining silently on Feed.
- Component test: direct address/property suggestions do not call `onAreaSelected()`.

## Shared Filter Contract Drift

### Repro

Inspect generated and hand-written API client contracts for the new shared feed/activity filters.

Observed:

- Runtime `/feed` accepts shared market/price/area params.
- Runtime `/activity/properties` accepts shared market/price/area params.
- `packages/api-client/generated/api.ts` does not expose the same params for those endpoints.
- `packages/api-client/src/client.ts` does not send those params from `getFeed()` or `getGroupedPropertyActivity()`.

The app currently bypasses the stale client surface for these paths with direct fetch calls from app hooks, so this does not necessarily break the current UI. It does leave the public repo contract inconsistent with runtime behavior.

### Root Cause

The shared-filter route schemas were updated without regenerating or manually updating all API client surfaces.

This conflicts with the repo's contract-first expectation: API route schemas, generated OpenAPI types, and client helpers should describe the same query model. A future caller using the package client would not be able to send the same filters the app sends today.

Also note that Feed and grouped activity intentionally parse market/price/area filters but ignore the map `activity` filter. That can be correct because these endpoints are already activity/listing feeds and the Feed UI hides the activity filter, but it should be explicit rather than an accidental mismatch.

### Proposed Fix

Regenerate or update the API client after the route schemas settle.

Ensure the generated and hand-written client methods for `/feed` and `/activity/properties` accept and serialize the shared market/price/area query params that runtime routes support. If `activity` is intentionally ignored by these endpoints, document that endpoint-specific behavior in the route/client docs and tests.

### Test Coverage

- Contract test or generated snapshot proving `/feed` exposes shared price, market state, and area params.
- Contract test or generated snapshot proving `/activity/properties` exposes shared price, market state, and area params.
- API/client test proving the hand-written client serializes those params.
- Explicit test or doc assertion that Feed/grouped activity ignore map `activity` by design, if that behavior is retained.

## Read/Following Tile Source Cache Keys Omit Areas

### Repro

Select or remove an area/current-location filter while read/following tile overlays are enabled.

Observed from code inspection:

- `useReadTileSource()` and `useFollowingTileSource()` query keys include some filter dimensions.
- Their tile URLs are built from filter objects that include `areas`.
- The query keys do not include `areas`.

That means a change from `area=city:NL:eindhoven` to another area, or to a current-location radius token, can reuse stale read/following tile source data even though the URL that should be fetched has changed.

### Root Cause

The shared filter model was extended with `areas`, but the read/following tile source query keys were not extended with the same canonical area signature used by the URL builder.

Public map tiles include the full serialized map filter model. Read/following overlays need the same cache-key discipline for any filter field that changes their tile URL.

### Proposed Fix

Include a canonical area/filter signature in the read and following tile source query keys.

Prefer reusing the existing canonical map filter signature helpers rather than manually listing fields in multiple query keys. If a narrower key is still needed, include `areas` through a stable serialized token signature so current-location coordinates/radius and regular area tokens invalidate correctly.

### Test Coverage

- Unit test: `useReadTileSource()` query key changes when `areas` changes.
- Unit test: `useFollowingTileSource()` query key changes when `areas` changes.
- Unit test: current-location area tokens with different lat/lon/radius produce different read/following tile source keys.
