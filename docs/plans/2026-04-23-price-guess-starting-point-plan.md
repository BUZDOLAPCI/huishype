# Price Guess Starting Point Plan

Date: 2026-04-23
Status: Proposed

## Summary

Add a lightweight, isolated, cheap price anchor used only to initialize the
Price Guess Slider. If a property has an active sale listing, the asking price
becomes the initial thumb position. If it has no active sale listing and no
existing user guess, a local market-summary hint avoids dropping users onto an
arbitrary `350000` slider default.

This is not an AVM product, not a public algorithmic price estimate, and not a
Woningstats clone. The goal is only to choose a better starting point when
HuisHype already has enough free local context.

## Product Intent

The slider default should help users start guessing faster. It should not tell
users what the property is worth.

Keep the user-facing framing as:

- "What do you think this property is worth?"
- reference markers like official valuation, asking price, and crowd FMV
- internal analytics about where the slider started

Do not add a visible "estimated value", "HuisHype valuation", confidence badge,
or price advice copy. The feature is complete when the slider starts from a
better internal anchor without turning that anchor into a user-facing valuation.

## Requirements And Scope Boundaries

- No paid APIs.
- No per-request WOZ API calls.
- No paid Kadaster transaction-price dependency.
- No scraped Woningstats dependency.
- No ML model training.
- No heavy offline valuation pipeline.
- No public valuation page or "expected sale price" feature.
- No image or photo condition scoring.
- No listing-text condition scoring for non-listing properties.
- No per-request comparable scans.
- Keep the implementation isolated to the price-guess read path and slider
  initialization.

## Current State

`PriceGuessSlider` currently initializes from:

```ts
userGuess ?? officialValuation ?? 350000
```

It already receives `askingPrice` in the bottom-sheet and guesses-route entry
points, but that value is currently used only as a reference marker and is not
part of slider initialization. The component also only re-syncs its thumb when
the submitted `userGuess` changes, so an asynchronously loaded non-user
initializer will not reliably move the thumb unless the component is updated to
handle that case.

This works when WOZ or another official valuation is present, but it is blunt:

- old official valuations may lag current market level
- properties without official valuation fall back to a hardcoded number
- local asking-price context already exists in `properties` and `listings`, but
  the slider does not use it

Relevant existing fields:

- `properties.country_code`
- `properties.postal_code`
- `properties.city`
- `properties.region`
- `properties.geometry`
- `properties.year_built`
- `properties.floor_area_m2`
- `properties.official_valuation`
- `listings.asking_price`
- `listings.status`
- `listings.price_type`
- `listings.living_area_m2`
- `price_history.price`
- `price_history.event_type`

Important current-code caveats:

- the canonical reconciled listing read model does not exist yet; current app
  reads still use the legacy mixed `listings` table
- `property.askingPrice` is not a dedicated sale-only field; it is safe as a
  sale initializer only when the property read also says `marketState =
  'for-sale'`
- the current FMV helper loads the newest active listing without filtering
  `price_type`; the implementation must query active sale asking price directly
  instead of reusing `fmv.askingPrice`
- `price_history` is supported by the main schema, but live scraper sync does
  not reliably send price-history payloads today
- Funda mirror rows may store `price_type = 'buy'` before sync normalization;
  market-summary inputs must normalize `buy` to `sale`
- Pararius is rent-first in practice and must not feed sale market summaries

## Woningstats Lessons To Reuse Carefully

The useful lesson from Woningstats is architectural, not the full product:

- compare a property against a realistic local asking-price anchor
- prefer local segment data over one global multiplier
- use official valuation as an anchor when available
- fall back when data is sparse instead of inventing precision

Do not copy their detailed expected-sale model for this feature. Days on market,
price drops, overbidding, condition are listing-specific and are
out of scope for a non-listing slider starting point.

## Proposed Behavior

Add a derived `priceGuessStart` hint to the price-guess read path.

Slider initialization order should become:

```ts
userGuess
  ?? activeListingAskingPrice
  ?? priceGuessStart.price
  ?? officialValuation
  ?? countryDefaultGuessStart
```

The active-listing asking price initializer is an explicit product goal. The
derived `priceGuessStart` hint is only for properties without an active sale
listing; it should be omitted or ignored when `activeListingAskingPrice` exists.
An active rent listing must never initialize the sale price-guess slider.

The hint is only used as an initial thumb position. User interaction,
submission validation, FMV calculation, and crowd consensus stay unchanged.

The API should read this hint from a worker-maintained market-summary
materialized view. Request-time work should be limited to loading the property,
checking whether it has an active listing, and doing a small indexed lookup
against the summary rows.

This sprint deliverable includes the sale-only canonical listing facts needed
by this feature. If the broader listing-ingest reconciliation work is not fully
merged first, add a narrow compatibility adapter in the API/worker that exposes
the same canonical fields used below:

- property id
- country code
- active sale status
- normalized price type
- sale-capable source name
- asking price
- listed-at timestamp
- living area when available

Long-lived service contracts must use those canonical field names rather than
raw scraper-row semantics.

## API Shape

Add an optional object to the existing price-guess fetch response:

```ts
type PriceGuessStart = {
  price: number;
  source:
    | 'official_valuation_adjusted'
    | 'local_comparable_price_per_m2'
    | 'official_valuation'
    | 'country_default';
  confidence: 'weak' | 'usable';
  sampleSize: number; // relevant sample size for the chosen source
};
```

Recommended placement:

- extend `GET /properties/:id/guesses`
- avoid adding a new endpoint
- avoid changing property map/tile payloads

This keeps the feature isolated to the place that already powers the slider.

Also add an authoritative nullable `activeListingAskingPrice` for active sale
listings. Prefer returning it in the same price-guess response so both the
bottom-sheet slider and the dedicated guesses route use the same source of
truth:

```ts
type GetPropertyGuessesResponse = {
  data: PriceGuessWithUser[];
  meta: PaginationMeta;
  fmv: FmvResponse;
  activeListingAskingPrice?: number | null;
  priceGuessStart?: PriceGuessStart;
};
```

`activeListingAskingPrice` must come from canonical listing facts filtered to
active sale listings. Do not derive it from `fmv.askingPrice`, and do not treat
`property.askingPrice` as sale-only unless the same read proves `marketState =
'for-sale'`. Do not overload `priceGuessStart` for active listings.

The response shape change must update:

- route schema and API tests
- generated API client/OpenAPI contract
- app-local `usePriceGuess` types and mapping
- shared API types
- mocks and test fixtures, including the current mock guesses handler shape
- both slider entry points: bottom sheet and `/guesses` route

## Heuristic

Use existing persisted data only.

### Step 1: Determine The Property Anchor

If `officialValuation` exists and is positive:

```text
base_anchor = officialValuation
```

If not, but `floorAreaM2` exists:

```text
base_anchor = null
```

If neither exists, return the country default.

### Step 2: Read Local Market Summary Rows

Use sale-listing rows from existing persisted data, not external calls, but
compute the comparable medians in the background worker rather than during the
API request.

Summary-source filters, applied to the canonical reconciled listing read model:

- same `country_code`
- source is Funda
- normalized price type is sale; treat legacy Funda `buy` as sale
- do not include Pararius rows
- `asking_price > 0`
- use active canonical listings only
- property has either `official_valuation > 0` or a usable floor-area value
- exclude extreme asking prices outside the slider-supported range

Do not include `sold`, `withdrawn`, or `price_history` rows in the summary.
Current scraper coverage is not reliable enough for this feature: Funda sold
rows mostly come from detail/backward-scan paths, Funda has no withdrawn status,
Pararius status handling is rent-oriented, and live scraper sync does not
reliably send `priceHistory`.

Postal-scope normalization must be country-aware. Add a shared helper such as
`getPriceGuessPostalScope(countryCode, postalCode)` and use it in both summary
generation and API lookup. Behavior:

- `NL`: postcode4, e.g. `5611`
- countries without a reliable postal-prefix rule: skip postal scope and fall
  through to city, region, and country

Do not add Dutch-only prefix slicing in the API or SQL.

Store rows for these geography levels:

1. normalized postal prefix, e.g. NL `postcode4`, minimum 8 samples
2. city, minimum 20 samples
3. region, minimum 40 samples
4. country, minimum 100 samples

The API uses the most local qualifying row and falls back through the cascade.
Do not over-filter. This is a slider seed, not a valuation model.

### Step 3: Prefer An Official-Valuation Market Multiplier

When the target has an official valuation and the selected summary row has
enough ratio samples:

```text
raw_ratio = median(comparable.asking_price / comparable.official_valuation)
```

Shrink sparse local ratios back toward `1.0`:

```text
weight = ratioSampleSize / (ratioSampleSize + 20)
adjusted_ratio = 1 + ((raw_ratio - 1) * weight)
```

Clamp aggressively:

```text
adjusted_ratio = clamp(adjusted_ratio, 0.80, 1.35)
```

Then:

```text
price = officialValuation * adjusted_ratio
```

This gives a cheap "WOZ plus local market drift" anchor without presenting it as
a valuation.

### Step 4: Comparable Price-Per-M2 Fallback

When official valuation is missing, `floorAreaM2` exists, and the selected
summary row has enough per-m2 samples:

```text
median_eur_per_m2 = median(comparable.asking_price / comparable.floor_area_m2)
price = median_eur_per_m2 * floorAreaM2
```

Use listing `livingAreaM2` if property `floorAreaM2` is missing for a comparable.

Clamp the output to the slider-supported range and round to a friendly amount:

```text
price = round(price / 5000) * 5000
```

### Step 5: Conservative Final Guards

Apply final guards before returning:

- clamp to current slider range, currently `50000..2000000`
- if based on official valuation, clamp final price to `0.65x..1.65x` of
  official valuation
- reject results where fewer than the minimum samples were found
- reject results with obviously broken median ratios, e.g. `< 0.5` or `> 2.0`

If rejected, fall back to:

```text
officialValuation ?? countryDefaultGuessStart
```

## Country Defaults

Use conservative defaults only as the last fallback.

Defaults:

- `NL`: `350000`
- other countries: `350000`

Keep this config-driven through country config or a small shared helper. Do not
hardcode Dutch-only assumptions inside the component.

## Confidence

Confidence is internal for now.

Use:

- `usable`: official valuation adjusted with enough local samples, or
  comparable EUR/m2 with enough local samples
- `weak`: official valuation only or country default

Do not expose this as a UI badge. It exists for logging, debugging, and product
measurement.

## Background Summary Design

Create one small summary materialized view. Do not
reuse `mv_latest_active_listings`: that view is intentionally narrow, active
status-only, and lacks the country, price-type, source, area, and sample data
needed here.

Relation name:

```text
mv_price_guess_start_market_summaries
```

Shape:

```text
country_code
scope_type              -- postal_prefix | city | region | country
scope_key               -- normalized key
median_asking_to_official_ratio
ratio_sample_size
median_asking_per_m2
per_m2_sample_size
refreshed_at
```

Indexes:

```text
unique(country_code, scope_type, scope_key)
index(country_code, scope_type, scope_key)
```

For concurrent refresh, all indexed key columns must be non-null and the unique
index must cover every row. When a scope cannot produce a valid `scope_key`,
skip that row rather than inserting a null key.

Refresh policy:

- Refresh after listing ingest or listing submission through the existing
  maintenance worker path.
- Also refresh on worker startup/recovery sweep if a previous refresh was
  requested but not completed.
- Use `REFRESH MATERIALIZED VIEW CONCURRENTLY`, matching the existing
  `mv_latest_active_listings` pattern.

This is still light and cheap: the worker computes coarse market anchors once
per listing-data update instead of every slider open.

The summary reads from canonical sale-listing facts, not directly from legacy
raw `listings` writes. The sprint must either consume the broad listing read
model or add the narrow compatibility adapter described above and use it
consistently from the API and worker.

The worker hook point is the existing durable maintenance path. Generalize the
maintenance job so the listing maintenance refresh and price-guess summary
refresh must both succeed before pending maintenance rows are marked complete.

## Implementation Plan

### Step 1: Summary Relation And Worker Refresh

- Add or consume the narrow canonical active-sale listing read model required by
  this feature.
- Add the summary materialized view migration over that canonical read model.
- Add a shared helper, e.g. `getPriceGuessPostalScope(countryCode, postalCode)`,
  beside country config/shared formatting utilities so the API and worker use
  identical country-aware postal normalization.
- Add a refresh helper beside the existing listing maintenance view refresh.
- Wire the worker maintenance job to refresh the price-guess summary after
  listing-data changes.
- Keep the source filter to active Funda sale listings, with `buy` normalized to
  `sale`; do not include Pararius rent listings, unverified sold rows, or sparse
  `price_history` rows in the summary.
- Add unit/integration coverage for the refresh helper and lookup behavior.

### Step 2: Pure Service And API Wiring

- Add a small backend service, e.g.
  `services/api/src/services/price-guess-start.ts`.
- Implement a pure function for choosing the final start price from:
  property facts, active listing asking price, summary row, and country default.
- Query active sale asking price explicitly from canonical listing facts. Do not
  reuse `fmv.askingPrice`.
- Add a repository/query helper that does indexed summary lookups by postal
  prefix, city, region, and country.
- Extend the price-guess read response with optional `priceGuessStart`.
- Add nullable `activeListingAskingPrice` to the same response.
- Add shared/API-client type updates, OpenAPI generation, app hook type updates,
  mock response updates, and route-specific test-fixture updates.

### Step 3: Slider Prop

- Add `initialPrice?: number` or `suggestedStartPrice?: number` to
  `PriceGuessSlider`.
- Keep `userGuess` as the strongest initializer.
- Use active sale asking price as the second initializer.
- Make the slider handle asynchronously loaded initializers without overwriting
  a user who already dragged or typed a price. The existing sync effect only
  watches `userGuess`; extend it with a "has user interacted" guard or remount
  key so late `activeListingAskingPrice` / `priceGuessStart` data can initialize
  the thumb exactly once.
- In `PriceGuessSection` and `GuessesRouteScreen`, pass a single initializer
  that follows the desired order after `userGuess`, for example:

```ts
activeListingAskingPrice ?? guessData.priceGuessStart?.price
```

- Do not render new valuation copy.
- Do not add a new marker.

### Step 4: Instrumentation

Choose one instrumentation mode before implementation:

- client-only diagnostic events, matching existing lightweight analytics event
  patterns
- persisted product analytics, matching API-backed event tables such as property
  views

Then log when the slider is shown and submitted:

- start source
- start confidence
- start price bucket
- submitted guess bucket
- absolute and percentage delta from start

Include `active_listing_asking_price` as a possible start source in analytics,
even though it is not a `priceGuessStart.source` value.

Use this to evaluate whether better starting points reduce friction or bias
guesses too strongly.

## Suggested SQL Shape

The worker summary can be implemented as a union of geography-level aggregate
queries.

Conceptual shape:

```sql
select
  p.country_code,
  'postal_prefix' as scope_type,
  <normalized postal prefix> as scope_key,
  percentile_cont(0.5) within group (
    order by l.asking_price::numeric / nullif(p.official_valuation, 0)
  ) as median_asking_to_official_ratio,
  count(*) filter (
    where p.official_valuation > 0
  ) as ratio_sample_size,
  percentile_cont(0.5) within group (
    order by l.asking_price::numeric / nullif(coalesce(l.living_area_m2, p.floor_area_m2), 0)
  ) as median_asking_per_m2,
  count(*) filter (
    where coalesce(l.living_area_m2, p.floor_area_m2) > 0
  ) as per_m2_sample_size
from <canonical_listing_read_model> l
join properties p on p.id = l.property_id
where l.asking_price between 50000 and 2000000
  and l.source_name = 'funda'
  and normalize_price_type(l.price_type) = 'sale'
  and l.status = 'active'
group by p.country_code, <normalized postal prefix>
having
  count(*) filter (where p.official_valuation > 0) >= 8
  or count(*) filter (where coalesce(l.living_area_m2, p.floor_area_m2) > 0) >= 8
union all
...
```

The API lookup should not run this aggregate. It should only query summary rows
by exact `(country_code, scope_type, scope_key)` keys in cascade order.

Keep the implementation readable rather than clever. This is a bounded slider
initialization feature, not a reusable valuation engine.

`normalize_price_type` is conceptual here: implement it as a shared adapter or
SQL expression that maps explicit legacy Funda `buy` to `sale`. Do not treat
blank or missing `price_type` as sale for the summary.

The implemented query should use canonical status, verification-state, source,
and normalized-price-type fields. The `source_name`, `price_type`, and `status`
names in the SQL above are placeholders only if the sprint uses a compatibility
adapter over legacy rows.

## Validation

Unit tests:

- uses user guess before any suggestion
- uses active sale asking price before any market-summary hint
- ignores active rent asking price for sale price guesses
- uses adjusted official valuation when local ratio samples are available
- shrinks sparse ratios toward official valuation
- falls back to comparable EUR/m2 when official valuation is missing
- falls back to official valuation when comparables are too sparse
- falls back to country default when no useful property data exists
- clamps extreme outputs to the slider range
- normalizes Funda `buy` to sale for summary generation
- excludes Pararius rent rows from sale market summaries

Component tests:

- `PriceGuessSlider` initializes from `initialPrice` when no user guess exists
- `userGuess` still wins over `initialPrice`
- asynchronously loaded `initialPrice` moves the thumb if the user has not
  interacted yet
- asynchronously loaded `initialPrice` does not overwrite an in-progress user
  edit
- active sale asking price wins over `priceGuessStart`
- active rent asking price does not initialize the sale slider
- `PriceGuessSection` passes the combined start initializer to the slider
- `GuessesRouteScreen` passes the same combined start initializer to the slider
- no new visible "HuisHype estimate" text is rendered

API tests:

- price-guess fetch includes `priceGuessStart` for a property with no active
  listing
- price-guess fetch includes `activeListingAskingPrice` only for active sale
  listings
- active rent listings return `activeListingAskingPrice: null`
- response remains backward-compatible when no hint can be produced
- active listing responses omit or ignore `priceGuessStart`, and the client uses
  active sale asking price before any hint

Worker/API integration tests:

- summary refresh writes or refreshes postal-prefix, city, region, and country
  rows from listing fixtures
- summary refresh uses only active Funda sale-compatible fixtures
- summary refresh excludes Pararius rent fixtures and Funda rows with non-sale
  normalized price types
- API lookup chooses the most local qualifying summary row
- API falls back through the cascade when local rows are sparse or missing
- maintenance marks pending refresh rows complete only after all required
  listing and price-guess summary refreshes succeed

Full verification before merge:

```bash
pnpm test
```

If UI rendering changes beyond the initial thumb position, also run the
price-guess visual E2E wrapper that covers the slider.

## Explicitly Out Of Scope

These are separate product or architecture choices and are not part of this
slider-start feature:

- segment-specific ratios by property type
- use recent sold/withdrawn lifecycle outcomes from mirror history
- use listing price-change history for active-listing slider starts
- train an asking-price model for internal anchoring

Do not present any slider-start behavior as a standalone valuation product.
