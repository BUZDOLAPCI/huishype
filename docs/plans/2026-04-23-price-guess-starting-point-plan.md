# Price Guess Starting Point Plan

Date: 2026-04-23
Status: Proposed

## Summary

Add a lightweight, isolated, cheap price anchor used only to initialize the
Price Guess Slider. If a property has an active sale listing, the asking price
becomes the initial thumb position. If it has no active listing and no existing
user guess, a local market-summary hint avoids dropping users onto an arbitrary
`350000` slider default.

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

This works when WOZ or another official valuation is present, but it is blunt:

- old official valuations may lag current market level
- properties without official valuation fall back to a hardcoded number
- local price context already exists in `properties`, `listings`, and
  `price_history`, but the slider does not use it

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

## Woningstats Lessons To Reuse Carefully

The useful lesson from Woningstats is architectural, not the full product:

- compare a property against a realistic local asking-price anchor
- prefer local segment data over one global multiplier
- use official valuation as an anchor when available
- fall back when data is sparse instead of inventing precision

Do not copy their detailed expected-sale model for this feature. Days on market,
price drops, overbidding, condition, and "other m2" are listing-specific and are
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

The hint is only used as an initial thumb position. User interaction,
submission validation, FMV calculation, and crowd consensus stay unchanged.

The API should read this hint from a worker-maintained market-summary
materialized view. Request-time work should be limited to loading the property,
checking whether it has an active listing, and doing a small indexed lookup
against the summary rows.

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

Also ensure the slider caller has an authoritative nullable
`activeListingAskingPrice` for active sale listings. This can come from an
existing property-detail field if it is already sale-only, or from the
price-guess response if the existing field cannot distinguish sale from rent. Do
not overload `priceGuessStart` for active listings.

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

Use recent sale-listing rows from existing data, not external calls, but compute
the comparable medians in the background worker rather than during the API
request.

Summary-source filters, applied to the canonical reconciled listing read model:

- same `country_code`
- `price_type = 'sale'` or null if old rows lack `price_type`
- `asking_price > 0`
- prefer statuses in `('active', 'sold', 'withdrawn')`
- property has either `official_valuation > 0` or a usable floor-area value
- exclude extreme asking prices outside the slider-supported range

Postal-scope normalization must be country-aware. Add a shared helper such as
`getPriceGuessPostalScope(countryCode, postalCode)` and use it in both summary
generation and API lookup. Initial behavior can be:

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

Initial defaults:

- `NL`: `350000`
- other countries: `350000` until enough local data exists

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

Create one small summary materialized view:

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

Refresh policy:

- Refresh after listing ingest or listing submission through the existing
  maintenance worker path.
- Also refresh on worker startup/recovery sweep if a previous refresh was
  requested but not completed.
- Use `REFRESH MATERIALIZED VIEW CONCURRENTLY` if implemented as a materialized
  view, matching the existing `mv_latest_active_listings` pattern.
- If refresh time is too high, replace the view with an upserted summary table
  without changing the API contract.

This is still light and cheap: the worker computes coarse market anchors once
per listing-data update instead of every slider open.

Sequence this after the listing reconciliation plan is implemented. The summary
should read from the canonical reconciled listing read model, not from legacy raw
`listings` writes. If this feature is prototyped earlier, keep that dependency
explicit and do not bake direct raw-listing assumptions into long-lived service
interfaces.

## Implementation Plan

### Step 1: Summary Relation And Worker Refresh

- After listing reconciliation lands, add the summary materialized view
  migration over the canonical listing read model.
- Add a refresh helper beside the existing listing maintenance view refresh.
- Wire the worker maintenance job to refresh the price-guess summary after
  listing-data changes.
- Add unit/integration coverage for the refresh helper and lookup behavior.

### Step 2: Pure Service And API Wiring

- Add a small backend service, e.g.
  `services/api/src/services/price-guess-start.ts`.
- Implement a pure function for choosing the final start price from:
  property facts, active listing asking price, summary row, and country default.
- Add a repository/query helper that does indexed summary lookups by postal
  prefix, city, region, and country.
- Extend the price-guess read response with optional `priceGuessStart`.
- Ensure the client has a sale-only `activeListingAskingPrice` available in the
  same read path or the enclosing property-detail payload.
- Add shared/API-client type updates and mock response updates.

### Step 3: Slider Prop

- Add `initialPrice?: number` or `suggestedStartPrice?: number` to
  `PriceGuessSlider`.
- Keep `userGuess` as the strongest initializer.
- Use active sale asking price as the second initializer.
- In `PriceGuessSection`, pass a single initializer that follows the desired
  order after `userGuess`, for example:

```ts
activeListingAskingPrice ?? guessData.priceGuessStart?.price
```

- Do not render new valuation copy.
- Do not add a new marker.

### Step 4: Instrumentation

Log lightweight analytics when the slider is shown and submitted:

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
  and (l.price_type = 'sale' or l.price_type is null)
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

## Validation

Unit tests:

- uses user guess before any suggestion
- uses adjusted official valuation when local ratio samples are available
- shrinks sparse ratios toward official valuation
- falls back to comparable EUR/m2 when official valuation is missing
- falls back to official valuation when comparables are too sparse
- falls back to country default when no useful property data exists
- clamps extreme outputs to the slider range

Component tests:

- `PriceGuessSlider` initializes from `initialPrice` when no user guess exists
- `userGuess` still wins over `initialPrice`
- active sale asking price wins over `priceGuessStart`
- `PriceGuessSection` passes the combined start initializer to the slider
- no new visible "HuisHype estimate" text is rendered

API tests:

- price-guess fetch includes `priceGuessStart` for a property with no active
  listing
- response remains backward-compatible when no hint can be produced
- active listing responses omit or ignore `priceGuessStart`, and the client uses
  active sale asking price before any hint

Worker/API integration tests:

- summary refresh writes or refreshes postal-prefix, city, region, and country
  rows from listing fixtures
- API lookup chooses the most local qualifying summary row
- API falls back through the cascade when local rows are sparse or missing

Full verification before merge:

```bash
pnpm test
```

If UI rendering changes beyond the initial thumb position, also run the
price-guess visual E2E wrapper that covers the slider.

## Rollout

Ship behind a simple server-side flag or env variable:

```text
PRICE_GUESS_START_HINTS=true
```

If disabled, omit `priceGuessStart` and preserve current slider behavior.

Rollout steps:

1. Enable locally and verify slider starts closer to local anchors.
2. Enable in production for anonymous and logged-in users.
3. Monitor guess submission delta from start price.
4. Watch for anchoring bias. If too many guesses cluster tightly around the
   hint, reduce the adjustment strength or fall back to official valuation only.

## Explicitly Out Of Scope

These are not deferred work for this feature. They are different product or
architecture choices and should only be considered under a separate decision to
build a valuation product instead of a slider-start helper:

- segment-specific ratios by property type if reliable type data exists
- use recent sold/withdrawn lifecycle outcomes from mirror history
- use listing price-change history for active-listing slider starts
- train an asking-price model for internal anchoring

None of these should be presented as a standalone valuation product unless
HuisHype deliberately decides to enter that product category.
