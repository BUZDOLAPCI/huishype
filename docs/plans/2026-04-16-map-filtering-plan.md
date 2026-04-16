# Map Filtering Plan

Date: 2026-04-16
Status: Planning

## Goal

Add a real map filtering system to the map view with:

- Filter category badges/pills directly under the search bar
- Horizontal swipe/scroll behavior
- Category-specific option panels that open when a pill is pressed
- Active filters pinned to the start of the rail
- Stronger active styling
- Inline dismiss `x` on active pills
- Shareable filter state in the URL query string
- Separate sale and rent price filtering

This must be implemented as a full map-data feature, not a client-only visual layer, because the map is driven by server-grouped vector tiles plus the nearby grouped fallback. Filtering only on the client would desync rendered clusters, preview members, and map tap behavior.

## Product Decisions

The following decisions are locked from product discussion:

- Sale effective price fallback order is:
  `active asking price > last sold price > our FMV > WOZ / official valuation`
- Rent price is a separate filter category and does not share the sale fallback chain
- `Not Listed` is a valid filter state
- Filters must be shareable via URL query parameters
- Sale and rent price fields allow freeform numeric entry
- Price panels should also offer optional quick-tap step suggestions to make common values easier to select
- Draft price edits must not reload map data on every keystroke; only committed filter state is allowed to update URL state and server-backed map requests

## UX Shape

### Filter rail

- Add a `MapFilterRail` directly under the existing map search bar.
- Keep one horizontal scroll row of category pills.
- Preserve stable category ordering, but sort active filters to the front.
- Active pills should use heavier styling than inactive pills and include an inline `x`.
- Tapping the `x` resets that category immediately to its default state without opening the panel.

### Panels

- Tapping a pill opens one shared filter panel below the rail.
- Only one category panel is open at a time.
- Tapping the active pill again closes the panel.
- Closing the panel should not reset the filter state.
- Price panels should expose an explicit `Apply` action for draft edits.

### Initial categories

#### Price

- Shows two inputs:
  - `From EUR <amount>`
  - `To EUR <amount>`
- Inputs are freeform numeric text, not locked to fixed buckets.
- Show optional quick-tap step suggestions under the inputs so users can pick common thresholds faster.
- Step suggestions are convenience helpers only; users can ignore them and type any exact value.
- Applies only to sale-side market states:
  - `For Sale`
  - `Sold`
  - `Not Listed`
- Uses the sale effective price chain:
  `active asking price > last sold price > canonical FMV > official valuation`
- Default is unset on both ends.
- Pill is active when either bound differs from default.
- Editing the field updates draft panel state only.
- Commit the draft into applied filter state when any of these happen:
  - user presses `Apply`
  - an input blurs
  - user presses Enter
  - a future slider drag ends
- Only applied filter state is allowed to update the map URL, tile/style source, and server-backed map queries.

#### Rent Price

- Shows two inputs:
  - `From EUR <amount>`
  - `To EUR <amount>`
- Inputs are freeform numeric text, not locked to fixed buckets.
- Show optional quick-tap step suggestions under the inputs so users can pick common thresholds faster.
- Step suggestions are convenience helpers only; users can ignore them and type any exact value.
- Applies only to rent-side market states:
  - `For Rent`
  - `Rented`
- Uses rent-specific price selection:
  `active rent asking price > last rented price`
- Default is unset on both ends.
- Pill is active when either bound differs from default.
- Editing the field updates draft panel state only.
- Commit the draft into applied filter state when any of these happen:
  - user presses `Apply`
  - an input blurs
  - user presses Enter
  - a future slider drag ends
- Only applied filter state is allowed to update the map URL, tile/style source, and server-backed map queries.

#### Status

- UI label can remain `Status`, but the filter field should be named `marketState`.
- Options:
  - `For Sale`
  - `For Rent`
  - `Sold`
  - `Rented`
  - `Not Listed`
- Default is all selected.
- Pill is active when the selected set differs from the full set.

## Important Naming Constraint

Do not overload the word `status` in code for this feature.

The existing property model already uses `properties.status` for:

- `active`
- `inactive`
- `demolished`

That is separate from listing-market state. The filter category should therefore be modeled as `marketState`, not `status`.

Relevant backend contract today:

- [services/api/src/routes/properties.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/properties.ts:53)

## Current Technical Constraints

### Current map UI insertion point

The current map overlay has the search bar but no map filter surface yet.

Relevant files:

- [apps/app/app/(tabs)/index.tsx](/home/caslan/dev/git_repos/hh/huishype/apps/app/app/(tabs)/index.tsx:503)
- [apps/app/app/(tabs)/index.web.tsx](/home/caslan/dev/git_repos/hh/huishype/apps/app/app/(tabs)/index.web.tsx:1368)
- [apps/app/src/components/SearchBar.tsx](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/components/SearchBar.tsx:41)

### Existing reusable chip language

There is already an existing chip primitive and feed chip row that should be reused stylistically rather than inventing a separate filter visual language.

Relevant files:

- [apps/app/src/components/FeedFilterChips.tsx](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/components/FeedFilterChips.tsx:33)
- [apps/app/src/components/ui/Chip.tsx](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/components/ui/Chip.tsx:17)

### Existing property query contract is too narrow

Today `/properties` only supports:

- `city`
- `minPrice`
- `maxPrice`
- `bbox`
- `lat`
- `lon`
- `radius`

Relevant file:

- [services/api/src/routes/properties.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/properties.ts:53)

### Map rendering is server-grouped

The map is not just rendering a client-side property list. It relies on:

- grouped vector tiles
- grouped nearby fallback for tap resolution

Relevant files:

- [services/api/src/routes/tiles.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/tiles.ts:1124)
- [services/api/src/routes/properties.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/properties.ts:817)
- [services/api/src/services/property-grouping.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/services/property-grouping.ts:659)

## Data Model Notes

The listings table already contains `priceType`, so `For Sale` vs `For Rent` can be supported without inventing a brand new concept.

Relevant schema:

- [services/api/src/db/schema.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/db/schema.ts:232)

Important fields:

- `status`: listing lifecycle state
- `priceType`: `'sale'` or `'rent'`

`price_history` also contains terminal market outcomes with prices:

- `sold`
- `rented`

However, the grouping and tile pipeline does not currently surface enough market-state information for filterable map use.

Important constraint: the current schema records `priceType`, but it does not appear to encode rent cadence/term metadata such as monthly vs weekly or included utilities. The plan should therefore treat `Rent Price` as a source-normalized assumption for current ingest, and keep rent normalization as an explicit future risk.

## FMV Constraint

There is no canonical bulk FMV source for map/tile filtering yet.

Current state:

- Property detail FMV is calculated on demand in:
  [services/api/src/services/fmv.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/services/fmv.ts:172)
- Feed has a simplified aggregate FMV shortcut in:
  [services/api/src/routes/feed.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/feed.ts:137)

That is not sufficient as the authoritative map filter source. However, this plan should not force all market facts into one canonical bulk materialized aggregate. The better fit for the current repo is:

- keep the existing focused `mv_latest_active_listings` materialized view for stable listing-derived facts
- add a second narrow terminal-state source only if query plans show that latest sold / rented lookup needs persistence
- keep FMV out of materialized storage for v1 unless profiling proves it is necessary
- compose these inputs through one shared backend market-filter query layer used by tiles, nearby, and later `/properties`

## Recommended Backend Design

### Add a shared market-filter query layer

Create one reusable backend query builder / service that exposes the market facts needed for filtering and can be consumed by:

- property tile generation / grouping
- `/properties/nearby`
- `/properties` after the map pipeline is migrated

This should compose focused sources rather than collapsing everything into one mega-view.

Recommended inputs:

- `properties`
- `mv_latest_active_listings`
- latest terminal sale / rent facts derived from `price_history` or listing state
- live guess aggregates only where FMV is actually needed

Recommended derived fields per property:

- latest active listing presence
- latest active asking price
- latest active `priceType`
- latest known terminal listing state where applicable
- latest sold price where applicable
- latest rented price where applicable
- guess count
- canonical FMV when needed
- sale effective price
- rent effective price

Recommended `saleEffectivePrice` definition:

`latest active sale askingPrice ?? lastSoldPrice ?? canonical FMV ?? officialValuation`

Recommended `rentEffectivePrice` definition:

`latest active rent askingPrice ?? lastRentedPrice`

Do not merge sale-side and rent-side prices into one generic effective price field. They are separate domains and should be filtered independently.

Operational guidance:

- do not make user-generated guess activity refresh a broad materialized view
- keep persisted sources narrow and ingest-oriented
- let the shared query layer decide when FMV joins or calculations are required for a given caller
- prefer reusable SQL fragments / service helpers over duplicating route-local filter logic

### Market state mapping

The map filter taxonomy must be mutually exclusive.

Do not model `Not Listed` as "everything without an active listing" if `Sold` and `Rented`
also exist as sibling filter values. That creates overlapping semantics and broken set logic.

Instead, derive one exclusive `marketState` per property:

- `for-sale`: has an active listing with `priceType = sale`
- `for-rent`: has an active listing with `priceType = rent`
- `sold`: no active listing, latest terminal listing state is `sold`
- `rented`: no active listing, latest terminal listing state is `rented`
- `not-listed`: no active listing, and either latest listing state is `withdrawn` or there is no known listing history

For v1, `withdrawn` should not become a first-class UI filter unless product explicitly wants it. It should be folded into the exclusive derived `not-listed` state.

## Recommended Frontend Design

### Shared filter model

Add a shared map filter model in `packages/shared`, for example:

```ts
type MapMarketState =
  | 'for-sale'
  | 'for-rent'
  | 'sold'
  | 'rented'
  | 'not-listed';

interface MapFilters {
  salePriceFrom: number | null;
  salePriceTo: number | null;
  rentPriceFrom: number | null;
  rentPriceTo: number | null;
  marketState: MapMarketState[];
}
```

Support helper functions for:

- default state creation
- active/default detection per category
- badge summary text
- stable active-first ordering
- URL encode/decode
- reset-by-category
- canonical query normalization
- map route parse/serialize across `pathname + search`

### Components

Recommended new components:

- `MapFilterRail`
- `MapFilterPill`
- `MapFilterPanel`
- `SalePriceFilterPanel`
- `RentPriceFilterPanel`
- `MarketStateFilterPanel`

These should sit under the search bar on both web and native map screens.

### Tile/style refresh contract

Keep `/tiles/style.json` effectively static and cacheable as the shared base map style.

Do not turn `style.json` into a per-filter endpoint. Filter state should instead be applied by changing only the property vector-tile source URL that already lives inside the style contract.

Recommended client contract:

- fetch the merged base style once from `/tiles/style.json?platform=...`
- keep that base style cached in memory on the client
- derive the property tile URL from committed applied filters only
- update the `properties-source` tile URL/template when filters change

Platform guidance:

- web should prefer updating the existing vector source in place rather than replacing the full style
- native may start with replacing only the in-memory `mapStyle` object when committed filters change if source-level mutation is awkward in the current stack, but this should be treated as a heavier fallback rather than the ideal steady-state mechanism

Important constraint:

- draft price edits must not trigger style or source updates
- only committed applied filter state may trigger property source URL changes

### Suggested state ownership

Own map filter state at the map screen level so it can coordinate:

- URL sync
- property source URL updates
- nearby fallback calls
- preview invalidation
- search / camera route behavior

Model price filters as two layers of state:

- `draft` state owned by the currently open price panel input controls
- `applied` state owned by the map screen and used for URL sync, property source URL updates, nearby fallback calls, and preview invalidation

Do not let per-keystroke draft changes mutate the applied map filter state.

## Endpoint Changes

### Shared filter contract first

Before changing any single endpoint, define one shared backend filter contract that tiles, nearby, and later `/properties` all consume. The server should not grow three separate implementations of sale/rent/market-state logic.

Recommended backend shape:

- shared parsed filter type
- shared SQL builder / route helper that applies:
  - market-state predicates
  - sale effective price predicates
  - rent effective price predicates
- one normalized filter-signature helper for cache keys and debugging

### `/properties`

Extend query params to support:

- `salePriceFrom`
- `salePriceTo`
- `rentPriceFrom`
- `rentPriceTo`
- `marketState`

Apply these through the shared market-filter query layer, not directly against `official_valuation`.

The price filters should be scoped by market-state family:

- `salePrice*` affects `for-sale`, `sold`, and `not-listed`
- `rentPrice*` affects `for-rent` and `rented`

Important sequencing:

- `/properties` is not the current map critical path
- do not use `/properties` as the design anchor for map filtering
- bring `/properties` onto the shared filter builder after tiles and nearby are already using it

### `/properties/nearby`

Add the same filter params as the visible map.

This is required so native fallback tap resolution matches the filtered map result set.

### `/tiles/properties/:z/:x/:y.pbf`

Accept the same filters and apply them before clustering/grouping.

If filtering happens after grouping, the map will show incorrect:

- cluster sizes
- preview membership
- active vs ghost distribution
- tap targets

### `/tiles/style.json`

Keep this endpoint base-style oriented, not filter-state oriented.

It should continue to return the merged shared style contract used by web and native clients. The filter-aware part of the system should be the property source URL/template that the client derives from committed applied filters, not a dynamically personalized `style.json` response per filter combination.

## Grouping Pipeline Changes

Filtering must be applied before candidate grouping in:

- [services/api/src/services/property-grouping.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/services/property-grouping.ts:659)

The grouping candidate query and any later hydration steps need access to:

- active listing presence
- market state
- price type
- sale effective price
- rent effective price

The tile transport shape may also need expansion if future client behavior depends on those fields.

Relevant serializer:

- [services/api/src/services/property-grouping.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/services/property-grouping.ts:952)

## Tile Cache Change

Current property tile cache key is only:

- `z/x/y`

Relevant file:

- [services/api/src/routes/tiles.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/tiles.ts:1138)

This must be changed to include a normalized filter signature, otherwise filtered and unfiltered tiles will collide in cache.

Recommended shape:

`z/x/y + serialized normalized filter signature`

Important constraint:

- the signature must be derived from applied filter state only
- draft in-panel text input must never participate in the tile cache key
- step suggestions should resolve to normal numeric filter values before signature generation

## Map Source Update Rule

The actual map refresh contract for this feature is:

`committed filter state -> property source URL -> tile requests -> grouped tile response`

That means the implementation should update the property source URL when filters are committed, not rely on client-side layer filtering and not require a dynamically rebuilt `style.json` endpoint per filter state.

Preferred behavior by platform:

- web: mutate the existing `properties-source` tile URL in place
- native: if necessary, replace only the in-memory style object with an updated `properties-source` tile URL on committed changes

Avoid full style churn on every edit. Source updates must happen only after commit points such as `Apply`, blur, or Enter.

## URL Design

Filters must be shareable in the URL.

This repo should treat map state as:

- `pathname` for camera / canonical map route
- `search` for committed filter state

Do not bolt ad hoc filter params onto the current path-only map helpers. Add typed shared helpers for parsing and serializing full map route state across `pathname + search`.

Recommended query parameters:

- `salePriceFrom=250000`
- `salePriceTo=700000`
- `rentPriceFrom=1200`
- `rentPriceTo=2500`
- `marketState=for-sale,not-listed`

Requirements:

- preserve current map route and camera behavior
- merge filter params into the existing URL state instead of replacing unrelated map params
- restore filter state on reload / shared-link open
- omit default filter values from the URL when possible
- only committed applied filter state goes into the URL
- draft panel edits must remain local UI state until commit

### `returnTo` compatibility

Property detail routes already depend on map routes being a valid `returnTo` target. The current `returnTo` normalization only allows either no search params or a nested `returnTo`.

This plan must therefore explicitly include:

- expanding shared URL validation to allow a strict whitelist of map filter query params on map routes
- reusing the same shared parse/serialize helpers for direct map navigation and `returnTo`
- rejecting unknown query params rather than allowing arbitrary search strings

Recommended rule:

- camera stays in the canonical path
- committed filter params stay in a canonical normalized query string
- `returnTo` may include only that approved canonical map query set

## Interaction Rules

### Active-first ordering

- Active pills move to the beginning of the rail
- Preserve stable category order within both active and inactive groups
- Avoid row jitter beyond that stable partition

### Dismiss behavior

- Dismissing an active pill resets only that category
- The reset should immediately update:
  - map data
  - tile requests
  - nearby fallback behavior
  - URL query params

### Price editing behavior

- Typing into `Price` or `Rent Price` inputs should update local draft state only.
- The UI should feel interactive while typing, but must not trigger live per-keystroke tile/style/source reloads.
- Show suggested step values as tappable helpers while the user is editing.
- Recommended step suggestions should be domain-appropriate and asymmetric by filter type:
  - sale price examples: `250k`, `300k`, `350k`, `400k`, `500k`
  - rent price examples: `1000`, `1250`, `1500`, `1750`, `2000`
- Step suggestions are accelerators, not constraints.
- Commit points are:
  - `Apply`
  - input blur
  - Enter
  - slider drag end if sliders are added later

### Selected preview invalidation

If the current previewed property or open bottom-sheet property no longer matches the active filters:

- close the preview card
- close the bottom sheet
- clear any stale highlighted selection

## Testing Plan

### Unit tests

Add unit coverage for:

- filter default detection
- pill active-state logic
- active-first ordering
- URL encode/decode roundtrips
- draft-to-applied commit behavior
- step suggestion selection behavior
- sale effective price fallback logic
- rent effective price fallback logic
- category reset logic

### API integration tests

Add integration coverage for:

- `/properties/nearby` with filtered combinations
- status combinations
- sale price filtering with asking / last sold / FMV / WOZ fallback order
- rent price filtering with active rent asking / last rented fallback order
- `returnTo` acceptance for canonical map URLs with approved filter params
- rejection of non-whitelisted map query params in `returnTo`

After `/properties` is migrated onto the shared filter builder, add equivalent `/properties` coverage for the same filtered combinations.

### Tile / grouping tests

Add coverage for:

- filter-aware grouping
- filter-aware nearby resolution
- cache key separation between different filter states
- filtered cluster member counts

### Web E2E

Add Playwright coverage for:

- opening the map filter rail
- expanding `Price`
- expanding `Rent Price`
- expanding `Status`
- typing draft values without immediate URL/network application
- committing values via `Apply`
- committing values via blur / Enter
- selecting suggested step values
- setting filters
- seeing active pills move to the front
- dismissing active pills with `x`
- URL query sync
- page reload restoring filter state
- zero console errors during the flow

## Suggested Execution Order

1. Add shared filter types plus canonical `pathname + search` parse/serialize helpers in `packages/shared`
2. Update shared `returnTo` normalization to allow only canonical map filter query params
3. Add the shared backend market-filter query layer used by map endpoints
4. Wire tile generation / grouping and `/properties/nearby` to that shared filter layer
5. Add shared property-source URL helpers and committed-filter source update wiring on the clients
6. Add map filter UI components plus draft-vs-applied state wiring and applied-only URL synchronization
7. Bring `/properties` onto the same shared backend filter layer after the map pipeline is already aligned
8. Add unit, integration, tile, and Playwright coverage

## Open Follow-Ups

These are still open implementation choices, not product blockers:

- Whether latest terminal sale / rent facts need their own persisted helper source after query profiling
- Whether `withdrawn` should become a future visible filter state
- Whether rent-source prices need explicit normalization metadata before this is rolled out beyond the current ingest assumptions
- What the initial suggested step sets should be for sale and rent price inputs
- Whether native can support a clean source-level property tile URL mutation path without reapplying the full style object

## Summary

This feature should be implemented as a map-wide filtering system backed by the server map pipeline, not as a local overlay.

The key architectural requirements are:

- shared market-filter query layer
- filter-aware grouping
- filter-aware nearby fallback
- filter-aware tile cache keys
- static base style plus filter-aware property source URL updates
- shareable URL state with canonical `pathname + search` handling
- `returnTo` compatibility for approved map filter params

The locked product behavior is:

- `saleEffectivePrice = active asking > last sold > FMV > WOZ`
- `rentEffectivePrice = active rent asking > last rented`
- `Not Listed` is supported
- filters are shareable by URL
- price inputs are freeform with optional quick-tap step suggestions
- only committed applied filter state updates URL state and server-backed map requests

The locked taxonomy behavior is:

- `for-sale`, `for-rent`, `sold`, `rented`, and `not-listed` are mutually exclusive derived market states
- `not-listed` means withdrawn-or-no-known-listing-history, not a superset of `sold` and `rented`
