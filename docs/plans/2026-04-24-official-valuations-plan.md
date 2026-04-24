# Official Valuations Storage And Hydration Plan

Date: 2026-04-24
Status: Proposed

## Summary

Keep the current display valuation on `properties` for fast product reads, and
add a dedicated `property_official_valuations` table for complete observed and
verified records, history, provenance, and future source metadata.

For cache misses, optimize UX with lazy hydration:

1. The client fetches the official value directly from the public source when a
   user opens a property that has no cached valuation.
2. The client may show that value immediately as the WOZ/official value.
3. In parallel, the client submits the fetched source data to our backend.
4. The backend stores that submitted row immediately after basic sanity checks,
   marks it `verified = false`, and can serve it from cache on future reads.
5. The backend enqueues verification, fetches the same official source under
   our rate limits, replaces the row if the official source returns different
   data, and flips it to `verified = true`.

There are no broad automatic workers that crawl official valuation sources.
Backend official-source fetches happen only after a user requests a property
that is missing or stale in our cache.

WOZ hydration is NL-only. The app and backend must never call Kadaster WOZ
endpoints for non-NL properties.

## Decisions

- Keep `properties.official_valuation` as the fast current display-value field
  used by property detail, FMV anchoring, price guess initialization, feed
  cards, filters, mocks, and app-side previews after detail/resolve enrichment.
  Current grouped/tile map payloads do not consistently hydrate this field.
- Add `properties.official_valuation_year` so fast reads can label the cached
  display value without joining the history table.
- Add `properties.official_valuation_verified` so backend logic can distinguish
  client-observed cached values from server-confirmed official values. This is a
  safety/provenance flag, not a general usage gate.
- Add `property_official_valuations` as the per-source history table for both
  client-observed and backend-verified official valuations such as Dutch WOZ
  values.
- Treat `properties.official_valuation` and
  `properties.official_valuation_year` as a denormalized cache of the best
  display row in `property_official_valuations`, with
  `properties.official_valuation_verified` carrying whether the backend has
  independently confirmed the cached row.
- Allow client-side source fetches only as an immediate UX optimization on
  cache miss. Client-fetched values are valid for display and may be cached,
  and product/backend features should use them when they are the best available
  official valuation. Backend verification is a safety pass that corrects or
  confirms the cached value.
- Add a backend hydration enqueue endpoint. The backend independently fetches,
  validates, rate-limits, deduplicates, and marks cached rows as verified.
- Add durable hydration job state in Postgres. BullMQ job existence alone is not
  enough for cooldowns, recently completed dedupe, retry state, or circuit
  breaker behavior.
- If server verification returns different source data than the client
  submitted, the server-fetched data simply replaces the cached row. We do not
  persist rejected client-submitted variants.
- Keep `verified = false` rows displayable and usable indefinitely. They do not
  expire because they still came from the official source as observed by the
  client. If the backend later verifies a different value, the server-observed
  row replaces the cached value.
- Do not store official valuation history in `price_history`. Official
  valuations are not listing price events and need different provenance,
  reference-date, and source-record fields.
- Keep the schema multi-country. Use country-neutral names in the DB and map
  country-specific labels like "WOZ Value" through the existing country config.
- Keep each official source explicitly country-scoped. `source = 'woz'` is
  supported only for `country_code = 'NL'`; non-NL properties must not trigger
  client-side or backend WOZ fetches.
- Do not run yearly bulk refresh workers by default. Renewal is lazy:
  user-requested properties are hydrated when the cache is missing or stale for
  the currently expected valuation year.

## Current State

`properties` already has:

```ts
officialValuation: bigint('official_valuation', { mode: 'number' })
```

The shared property type already has:

```ts
officialValuation?: number;
officialValuationYear?: number;
```

That field exists only on the broad shared property/domain type and in some mock
fixtures. It is not yet part of the live shared API contracts, OpenAPI output,
generated API client, or app-local property types.

The database does not yet have `properties.official_valuation_year` or
`properties.official_valuation_verified`, and there is no table that preserves
source metadata, hydration state, or historical official valuation records.

## Target Schema

Extend `properties`:

```ts
officialValuation: bigint('official_valuation', { mode: 'number' }),
officialValuationYear: integer('official_valuation_year'),
officialValuationVerified: boolean('official_valuation_verified').notNull().default(false),
```

Add a new child table:

```ts
export const propertyOfficialValuations = pgTable(
  'property_official_valuations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    valuation: bigint('valuation', { mode: 'number' }).notNull(),
    valuationYear: integer('valuation_year').notNull(),
    referenceDate: date('reference_date'),
    source: varchar('source', { length: 50 }).notNull(),
    sourceRecordId: varchar('source_record_id', { length: 100 }),
    sourceDatasetVersion: varchar('source_dataset_version', { length: 100 }),
    sourceUrl: text('source_url'),
    rawPayload: jsonb('raw_payload'),
    verified: boolean('verified').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    origin: varchar('origin', { length: 30 }).notNull().default('server_verified'),
    submittedByUserId: uuid('submitted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    clientRuntime: varchar('client_runtime', { length: 20 }),
    sourceRequestFingerprint: varchar('source_request_fingerprint', { length: 128 }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('property_official_valuations_unique_idx').on(
      table.propertyId,
      table.valuationYear,
      table.source
    ),
    index('property_official_valuations_property_year_idx').on(
      table.propertyId,
      table.valuationYear
    ),
    index('property_official_valuations_year_idx').on(table.valuationYear),
    index('property_official_valuations_source_idx').on(table.source),
  ]
);
```

Add a durable hydration job/state table:

```ts
export const propertyOfficialValuationHydrationJobs = pgTable(
  'property_official_valuation_hydration_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 50 }).notNull(),
    valuationYear: integer('valuation_year').notNull(),
    state: varchar('state', { length: 30 }).notNull().default('queued'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastError: text('last_error'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: varchar('locked_by', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('property_official_valuation_hydration_unique_idx').on(
      table.propertyId,
      table.source,
      table.valuationYear
    ),
    index('property_official_valuation_hydration_due_idx').on(
      table.state,
      table.nextAttemptAt
    ),
  ]
);
```

Notes:

- `source` should use values like `woz` for Dutch WOZ imports and
  country-specific official source names for future countries.
- `source = 'woz'` is valid only when the referenced property has
  `country_code = 'NL'`.
- `reference_date` is the official value reference date when a source provides
  it.
- `source_record_id`, `source_dataset_version`, `source_url`, and `raw_payload`
  are optional because not every country/source will expose the same metadata.
- `raw_payload` must have a strict payload size limit. Store only the official
  source response and source metadata needed for audit/debugging.
- `verified = false` means the row is accepted for cache/display/use but has
  not yet been confirmed by our backend source fetch.
- `verified = true` means the backend independently fetched the official source
  and replaced the row, if needed, with the server-observed value.
- There is no rejected state in this table. A contradictory server fetch
  overwrites the existing `(property_id, valuation_year, source)` row and
  completes verification.
- Client-submitted upserts must not overwrite or downgrade an existing
  `verified = true` row. Server verification may overwrite client-observed data.
- `origin` should use values like `client_observed`, `server_verified`, and
  `import` so we can audit how the row entered the cache. `submitted_by_user_id`
  is nullable because anonymous browsing may still be supported.
- Currency is derived from the property country through existing country config
  unless a future source proves this assumption wrong.
- Hydration job rows are the durable source of truth for queued/running/recently
  completed state, retry timing, cooldowns, and worker recovery. BullMQ can be
  used for dispatch, but job existence in Redis must not be the only state.

## Client-Side Flow

The client has two delivery paths for the same displayed valuation:

- `server_cache`: returned from our API, regardless of whether the backend has
  already verified it.
- `client_fetched`: fetched directly by the client from the public official
  source on cache miss.

All paths can be shown to the user as the property's WOZ/official valuation.
The client does not need to know whether the cached value is verified. The
verified state only records whether our backend safety pass has independently
confirmed the source data.

When a user opens a property:

1. Client requests the property from the HuisHype API.
2. If `officialValuation` and `officialValuationYear` are present and current,
   display them.
3. If the server cache is missing or stale, and the country/source supports
   client-side fetch, the client fetches the public source directly. For WOZ,
   this is allowed only when `countryCode === 'NL'`.
4. If the client fetch succeeds, display the value immediately as the
   WOZ/official valuation.
5. In parallel, send the fetched source data to the backend hydration endpoint.
6. The backend caches the submitted value as `verified = false` and enqueues
   verification.
7. When the property is later fetched again, the value comes from our API as
   cached data. The client displays it the same way before and after backend
   verification.

Client code does not write directly to the database, but it may submit the full
client-fetched source result to the backend. The backend may cache that payload
after validating shape, source support, property identity, year, and basic value
sanity. The cached value is usable immediately. The backend still fetches the
official source itself before setting `verified = true`, and overwrites the
cached value if the server-observed source data differs.

For web, direct source fetch depends on the official source allowing browser
CORS. Native app fetches may work even when browser CORS does not. If a source
cannot be called directly from a client runtime, that country/source should skip
the immediate client-side fetch and rely on backend hydration instead. The
backend hydration endpoint must therefore support a request with no
client-observed valuation payload; in that mode it only enqueues a server-side
source fetch when the property's country/source supports it.

NL WOZ feasibility check, 2026-04-24:

- The official WOZ-waardeloket frontend loads its API base from
  `https://www.wozwaardeloket.nl/assets/endpoints.json`, currently
  `https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1`.
- A browser-style request to the Kadaster WOZ API returned
  `Access-Control-Allow-Origin` for the requesting origin, so browser direct
  fetch is feasible for web as of this check.
- The WOZ-waardeloket app uses browser endpoints such as
  `/wozwaarde/nummeraanduiding/:id`, `/wozwaarde/wozobjectnummer/:id`, and
  `/suggest`.
- Observed request shapes include `GET /suggest?q=...`,
  `GET /suggest?straat=...`, `GET /suggest?aotids=...`,
  `POST /suggest/filter`, `GET /wozwaarde/wozobjectnummer/:id`, and
  `GET /wozwaarde/nummeraanduiding/:id`. `GET /suggest?search=...` returned a
  bad request and should not be used.
- WOZ value responses include `wozObject`, `wozWaarden`, `panden`, and
  `kadastraleObjecten`. `wozWaarden[]` contains `peildatum` and
  `vastgesteldeWaarde`; use the `peildatum` year as `valuationYear` and keep
  `peildatum` as `referenceDate`.
- Woningstats public frontend inspection did not show direct Kadaster WOZ API
  calls in its visible JavaScript. It appears to rely on its own server routes
  and preloaded/internal property data for WOZ values. Treat Woningstats as
  supporting evidence for the product pattern, not as proof of WOZ API CORS.

NL WOZ identity resolution:

1. Only attempt WOZ resolution when the property country is `NL`.
2. Prefer an existing BAG `nummeraanduidingid` if available and call
   `/wozwaarde/nummeraanduiding/:id` with the 16-digit padded identifier.
3. If no usable `nummeraanduidingid` exists, resolve through Kadaster suggest
   endpoints using known address fields, preferably postal code plus
   house-number data or street-level suggestions narrowed locally.
4. Accept a WOZ result only when the returned address fields match the property
   identity after normalization: postcode, house number, house-number addition,
   street, and city where available.
5. Store `wozobjectnummer` as `source_record_id` when available. Store the
   full relevant source response in bounded `raw_payload`.

## Server-Side Flow

Add a focused endpoint such as:

```text
POST /properties/:id/official-valuations/hydrate
```

Request shape may include the client-observed source data when available:

```ts
{
  source: 'woz',
  valuation?: number,
  valuationYear?: number,
  referenceDate?: string,
  sourceRecordId?: string,
  sourceUrl?: string,
  rawPayload?: unknown
}
```

If the request has no client-observed valuation payload, the endpoint should
only create or refresh the durable hydration job. This supports runtimes or
future countries where direct client-side official-source fetches are not
available.

Client-observed fields are accepted as immediately usable cache data after
validation. They remain `verified = false` until the backend independently
fetches and validates against the official source.

Backend hydration behavior:

1. Load the property and confirm country/source support.
   - For `source = 'woz'`, require `property.country_code = 'NL'`.
   - For all non-NL properties, return an unsupported/no-op response and do not
     call Kadaster.
2. Check whether a cached value already exists for the requested or current
   expected valuation year.
3. If current cached data already exists, return `already_cached` and do not
   require the client to fetch WOZ itself. If the cached row is not verified,
   the backend may still enqueue verification subject to cooldown rules.
4. If no current cached value exists and the request includes client-observed
   source data, validate that data.
5. If client-observed data is present and valid, upsert it into
   `property_official_valuations` with `verified = false` and
   `origin = 'client_observed'`. The upsert must not overwrite or downgrade an
   existing `verified = true` row.
6. Update `properties.official_valuation`,
   `properties.official_valuation_year`, and
   `properties.official_valuation_verified = false` if this is the best current
   display row.
7. Create or refresh one durable hydration job keyed by property, source, and
   valuation year. If a matching job is queued, running, in cooldown, or
   recently completed, return the appropriate cached/pending status without
   adding duplicate BullMQ work.
8. Enqueue BullMQ dispatch only when the durable job is due and not already
   running.
9. The worker fetches the official source under server-side rate limits.
10. On success, update the row with the server-observed value if needed, set
    `origin = 'server_verified'`, set `verified = true`, set `verified_at`, and
    refresh the cached `properties` columns with
    `official_valuation_verified = true`.
11. If verification fails because the official source is unavailable or
    rate-limited, leave the cached `verified = false` value in place and retry
    according to the queue policy. Pending cache rows do not expire.

The server only fetches official source data when a user has requested a
property that needs hydration. It does not proactively crawl all properties.

## Cache Rule

For each property, `properties.official_valuation`,
`properties.official_valuation_year`, and
`properties.official_valuation_verified` should mirror the preferred latest
displayable official valuation row:

1. Prefer the highest `valuation_year`.
2. If there are multiple rows for the same year, prefer `verified = true`.
3. If still tied, prefer the source configured
   as authoritative for that country.
4. If there is still a tie, prefer the newest `fetched_at`.

This rule belongs in the backend hydration/import path, not in normal property
reads. Normal reads should continue using the cached `properties` columns.

## Rate Limits

Published/publicly observable WOZ limits:

- The official Waarderingskamer guidance says WOZ-waardeloket is free for
  individual consultation, but mass or automated extraction is not allowed and
  only a limited number of properties can be requested within a time period.
- The live Kadaster WOZ API responses observed on 2026-04-24 returned
  `X-Rate-Limit-Limit: 60`, `X-Rate-Limit-Reset`, and
  `X-Rate-Limit-Remaining` headers.
- The same responses returned `Kadaster-RateLimit-DayLimit: 5000`,
  `Kadaster-RateLimit-DayLimit-Remaining`, and
  `Kadaster-RateLimit-DayLimit-Reset`.
- Treat those response headers as the source limit envelope, not as permission
  to bulk extract. HuisHype behavior remains user-triggered and cache-first.

Client-side source fetches do not consume the backend worker's own rate-limit
bucket, but they are still HuisHype-triggered source traffic and must be used
sparingly:

- only on property detail/open interactions;
- only when the HuisHype API response has no current server-cached valuation;
- only for properties whose country/source config explicitly supports that
  client runtime;
- for WOZ, only when `countryCode === 'NL'`;
- no background client crawling;
- no viewport prefetching, no map-tile crawling, and no batch hydration from
  client devices;
- debounce repeat opens for the same property in one app session;
- cache the client-fetched response in memory for the session;
- stop client-side source fetches for the session if the WOZ API returns 429.

Backend cache submission must be protected by:

- authentication or anonymous abuse controls, depending on the endpoint's
  product requirements;
- per-user/IP/property submission limits:
  - max 10 submissions per user per minute;
  - max 60 submissions per IP per hour;
  - max 3 submissions per property/source/year per day;
- strict source/country support checks;
- value/year sanity checks;
- payload size limits;
- dedupe by `propertyId + source + valuationYear`;
- conflict guards so client submissions cannot overwrite `verified = true`
  server rows;
- no TTL for pending unverified rows. They remain displayable and usable
  indefinitely unless a newer year/source row replaces them.

Backend official-source verification fetches must be protected by:

- a queue rather than direct request-time fetching;
- durable DB job state for `queued`, `running`, `succeeded`, retryable failure,
  terminal failure, cooldown, and worker recovery;
- per-source concurrency limit of 1 for NL WOZ to start;
- per-source request-per-minute limit of 30 for NL WOZ, deliberately below the
  observed 60/minute header;
- per-source daily limit of 3000 for NL WOZ, deliberately below the observed
  5000/day header;
- dedupe by `propertyId + source + valuationYear`;
- retry with backoff for transient failures;
- a 24-hour cooldown after a successful hydration attempt for the same
  property/source/year;
- a 1-hour cooldown after a failed hydration attempt, increasing with backoff;
- source-specific circuit breaker behavior if errors spike.

The hydration endpoint should return quickly after enqueueing. Property detail
reads must not block on backend WOZ/API fetch latency.

The legal/product constraint is stricter than the observed technical rate
headers: WOZ-waardeloket values are for per-object consultation, and mass or
automated extraction is not allowed. Treat the observed headers as a maximum
technical envelope for user-triggered cache misses, not as permission to bulk
collect WOZ values.

## Yearly Renewal

Renewal is lazy, not bulk scheduled by default.

Each official source config should define the currently expected valuation year
or a rule for deriving it. For NL WOZ, this can be maintained in country/source
config and updated when a new WOZ year is available. The same source config
must define supported countries and runtimes; `woz` supports only `NL`.

When a user opens a property:

1. If cached `officialValuationYear` matches the expected current year, no
   client source fetch is needed.
2. If cached data is missing or older than the expected current year, the client
   may fetch the public source for immediate display.
3. The client submits the fetched value to our backend.
4. The backend stores the new year as `verified = false` and enqueues
   verification.
5. The backend switches the row to `verified = true` after its own source fetch.
6. Older observed and verified years remain in `property_official_valuations`.

This keeps source traffic proportional to actual user interest and avoids
fetching valuations for properties nobody opens.

## API Shape

Keep existing hot payloads as simple scalar fields:

```ts
officialValuation: number | null;
officialValuationYear: number | null;
```

Add only the minimal client-facing source-fetch hints where needed:

```ts
officialValuationExpectedYear?: number | null;
officialValuationHydrationSupported?: boolean;
```

Those fields help the app decide whether to do a client-side source fetch. Do
not expose `officialValuationVerified` or pending/verified cache status in
normal client DTOs. The app does not branch display behavior on backend
verification state.

Update these read surfaces to include `officialValuationYear` where they
already include `officialValuation`:

- property resolve/detail routes
- property list, batch, and saved-property payloads
- feed and leaderboard property payloads when relevant
- app utility mappers
- shared API types
- generated API client
- mocks and fixtures

Do not add the full valuation history to map node payloads or grouped tile
payloads. Those paths need compact records. Current grouped/tile map payloads
do not consistently hydrate `officialValuation`; do not assume this schema work
requires valuation fields in vector tiles unless a separate product change asks
for it.

If the UI later needs the full verified history, add a focused detail endpoint
such as:

```text
GET /properties/:id/official-valuations
```

That endpoint should return rows ordered by `valuationYear DESC, fetchedAt DESC`
and stay out of the map/tile read path.

## Migration Plan

1. Add `official_valuation_year integer` and
   `official_valuation_verified boolean not null default false` to
   `properties`.
2. Create `property_official_valuations`.
3. Create `property_official_valuation_hydration_jobs` for durable source-fetch
   state, retry/cooldown bookkeeping, and worker recovery.
4. Keep `valuation_year` not null in the child table.
5. Backfill child rows only when a known source-backed valuation year is
   available from the source data or fixture. Existing cached values without a
   known year remain on `properties.official_valuation` with
   `official_valuation_verified = false` until hydrated from a proper source.
6. Add backend hydration endpoint code that accepts optional client-observed
   values, writes the child table with `verified = false`, and refreshes the
   cached display columns in one transaction.
7. Add backend-only enqueue support for cases where client-side source fetch is
   unavailable.
8. Add client-side cache-miss source fetch for supported sources, starting with
   NL WOZ only when `countryCode === 'NL'` and direct client fetch is allowed by
   the public source runtime.
9. Regenerate OpenAPI/API client after route schema changes.

Because historical cached values may not have a known source year, do not invent
one during migration. If a fixture or seed has an explicit year, backfill it.
Update fixtures that intentionally test year-aware behavior to seed explicit
years and child valuation rows.

## Implementation Steps

1. Update Drizzle schema in `services/api/src/db/schema.ts`.
2. Generate the next Drizzle migration and review the SQL for indexes and
   cascade behavior.
3. Update API route schemas and SQL selects to expose `officialValuationYear`
   and the minimal source-fetch hints needed by property detail.
4. Add the backend hydration endpoint that stores client-observed data as
   `verified = false`, supports backend-only enqueue, and enqueues verification
   through durable job state.
5. Implement source-specific backend verification for NL WOZ first, guarded so
   non-NL properties never call Kadaster.
6. Add client-side cache-miss WOZ fetch for immediate display, guarded so it
   runs only for NL properties and only when source config says the runtime
   supports direct fetch.
7. Implement WOZ identity resolution using BAG identifiers when available and
   normalized address matching when falling back to suggest endpoints.
8. Update shared types in `packages/shared` where API/property shapes are
   explicit.
9. Update generated API client and app-side mappers.
10. Update mocks, fixtures, and API integration fixture helpers.
11. Add tests for schema-backed API responses, pending cache submission,
    hydration enqueue behavior, rate-limit/dedupe behavior, mapper behavior,
    server-overwrite behavior, verified-row conflict guards, non-NL WOZ no-op
    behavior, WOZ identity matching, durable job cooldown/retry behavior, and
    backend cache selection.

## Verification

Run the canonical repo gate before considering the implementation complete:

```bash
pnpm test
```

For targeted development, run narrower checks first:

```bash
pnpm --filter @huishype/api test
pnpm --filter @huishype/shared test
pnpm --filter @huishype/api-client test
pnpm --filter @huishype/mocks test
```

If UI surfaces start displaying client-fetched values or valuation years,
add/update the relevant app unit tests and any existing visual/e2e coverage
that exercises that surface.

Tests must not call live Kadaster/WOZ endpoints. Use mocked official-source
clients or local fake responses for WOZ success, mismatch, 404, 429, malformed
payload, and non-NL unsupported cases.

## Remaining Decisions

No product architecture decisions are currently open for the NL WOZ path after
the usage and NL-only source guards above. Implementation still needs to
encode the observed request/response shape in a source adapter, keep the
source-specific rate-limit config adjustable, and treat CORS/rate-limit behavior
as runtime-configurable in case Kadaster changes the observed headers.
