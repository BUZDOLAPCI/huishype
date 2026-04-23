# Listing Ingest Reconciliation Plan

Date: 2026-04-23
Status: Revised final-state implementation plan

## Summary

Refactor listing ingest so user-added listings, Funda mirror listings, and
Pararius mirror listings enter one provenance-aware reconciliation system and
produce one canonical listing read surface.

The implemented system keeps three responsibilities separate:

- raw provenance-specific listing observations
- durable mirror validation and watch state
- canonical listing state used by app reads, feeds, grouping, and views

The current `listings` table is a mixed write/read table. It stores user
submissions (`submitted_by`) and mirror provenance (`source_name`,
`mirror_listing_id`) in the same row, while many read paths query it directly.
The new design replaces those direct-write assumptions with explicit
observation storage and a canonical read model derived from reconciliation.

## Current Codebase Constraints

- The main backend already has ingest infrastructure:
  `/api/ingest/listings`, `/api/ingest/watermark`, `ingest_runs`,
  `ingest_batches`, `ingest_sources`, the worker runtime, and the current ingest
  processor. The implementation extends this infrastructure instead of creating
  a separate ingest stack.
- The current mirror ingest upserts by `(source_name, mirror_listing_id)`, while
  the legacy `listings.source_url` unique index is global. A user-first
  submission and a later mirror observation for the same URL can therefore
  conflict instead of merging. The new model removes that failure mode by
  deduping through source identity and observation reconciliation before
  canonical writes.
- `db:seed-listings` currently appends mirror rows with
  `ON CONFLICT (source_url) DO NOTHING`; it is not itself a destructive wipe of
  user rows. The unsafe behavior is that it bypasses the live ingest semantics
  and silently skips collisions. `db:reset` remains destructive because it drops
  schemas before reseeding.
- Funda and Pararius scraper repos already post mirror batches to
  `/api/ingest/listings`. They do not yet expose durable validation outcomes,
  source-owned URL canonicalization contracts, or watch state callbacks. This
  plan adds those source contracts explicitly.
- Funda has both tiny listing IDs and global IDs in source data. The
  implementation treats the Funda tiny ID as the primary mirror listing identity
  whenever available and persists global IDs as aliases so search-result and
  detail-result observations converge on the same listing.
- Pararius fetch currently accepts full listing URLs and supported relative
  listing paths; ID-only Pararius input is not supported in the final contract.
- Pararius detail fetch currently records fetched details as available. The
  mirror contract must emit explicit lifecycle evidence so canonical status is
  not inflated to available when the source indicates rented, withdrawn, not
  found, or blocked.

## Goals

- Keep user-added listings in HuisHype across mirror replays, source reseeds,
  and mirror data replacement.
- Keep mirror ingest fully replayable without deleting or overwriting
  user-originated evidence.
- Merge user discovery and mirror validation into one canonical listing.
- Let user submissions expand mirror coverage without treating user input as
  trusted mirror data.
- Accept real supported marketplace URLs reliably, including supported
  canonical pages, shared links, tracked variants, and Funda ID-style detail
  URLs that point to the same listing.
- Reject confirmed invalid property-to-listing pairings before a canonical
  listing is created.
- Keep source lifecycle tracking, including rented, sold, withdrawn, not found,
  blocked, and parser failure states, durable and explainable.

## Target Architecture

- Every listing input is stored as a provenance-specific observation.
- User observations and mirror observations never overwrite each other.
- A canonical listing row is derived from observations and is the only listing
  shape used by app reads.
- Source identity is the primary reconciliation key:
  `(source_name, source_listing_id)`.
- Canonical source URL is a secondary reconciliation signal after
  source-specific normalization.
- Property matching is explicit and records whether a source observation was
  exact-address matched, spatially matched, user-provided, invalid, or still
  provisional.
- User-originated listings can become mirror-backed without changing the
  visible canonical listing identity.
- Mirror validation/watch state is persisted in the main app database and
  exposed through read APIs.
- Existing ingest runs, ingest batches, ingest sources, and BullMQ worker paths
  remain the backbone of batch acceptance and asynchronous reconciliation.

## Service Boundary And Ownership

The mirror/scraper services own source-specific behavior:

- marketplace crawling, discovery, parser maintenance, anti-bot handling
- URL parsing and canonical URL derivation
- source listing identity extraction
- source lifecycle evidence
- validation attempts for user-discovered candidates
- emitting validation outcomes and mirror observations to the main backend

The main app backend owns product and persistence behavior:

- preview and submit APIs
- observation persistence
- canonical reconciliation
- durable ingest ledger
- mirror watch records and validation status
- canonical read APIs
- generated API contracts, mocks, and integration tests

Scraper logic does not move into the main monorepo. The main backend calls or
receives results from source services through explicit contracts.

## Data Model

Implement the following persisted model in Drizzle migrations.

### `listing_observations`

Stores immutable or append-only source evidence.

Required fields:

- `id`
- `source_name`
- `source_listing_id`
- `source_listing_id_kind`
- `source_listing_aliases`
- `source_url_raw`
- `source_url_canonical`
- `submitted_by`
- `origin`: `user`, `mirror`, `replay`, `validation`
- `property_id`
- `property_match_kind`: `user_selected`, `source_exact`,
  `source_spatial`, `source_unmatched`, `source_mismatch`
- `source_status`: `available`, `sold`, `rented`, `withdrawn`,
  `not_found`, `blocked`, `invalid`, `parser_error`, `unknown`
- `asking_price`
- `price_currency`
- `address_raw`
- `address_normalized`
- `postal_code`
- `house_number`
- `house_number_addition`
- `listed_at`
- `first_seen_at`
- `last_seen_at`
- `source_updated_at`
- `observed_at`
- `ingest_batch_id`
- `validation_watch_id`
- `payload`
- `created_at`

Constraints and indexes:

- Unique mirror observation idempotency key on
  `(source_name, source_listing_id, origin, observed_at)` where
  `source_listing_id` is present.
- Index on `(source_name, source_listing_id)`.
- Index on `(source_name, source_url_canonical)`.
- Index on `property_id`.
- Index on `ingest_batch_id`.
- Index on `validation_watch_id`.

### `listing_source_aliases`

Maps alternate source identifiers to one primary source identity.

Required fields:

- `id`
- `source_name`
- `alias_kind`
- `alias_value`
- `primary_source_listing_id`
- `first_seen_at`
- `last_seen_at`

Constraints:

- Unique `(source_name, alias_kind, alias_value)`.
- Unique `(source_name, primary_source_listing_id, alias_kind, alias_value)`.

For Funda, `tiny_id` is primary when present. `global_id` and any discovered
detail URL ID are stored as aliases. Search-result and detail-result data must
therefore reconcile into the same canonical listing.

### `canonical_listings`

The app read model. This replaces direct reads from raw legacy `listings`.

Required fields:

- `id`
- `property_id`
- `source_name`
- `primary_source_listing_id`
- `canonical_url`
- `display_url`
- `status`
- `status_source`: `mirror`, `user`, `system`
- `verification_state`: `provisional`, `validated`, `invalid`,
  `validation_pending`, `validation_blocked`, `validation_failed`
- `origin_summary`: `user`, `mirror`, `user_and_mirror`
- `submitted_by`
- `thumbnail_url`
- `title`
- `description`
- `asking_price`
- `price_currency`
- `first_seen_at`
- `last_seen_at`
- `last_mirror_seen_at`
- `last_user_seen_at`
- `last_reconciled_at`
- `created_at`
- `updated_at`

Constraints and indexes:

- Unique `(source_name, primary_source_listing_id)` where
  `primary_source_listing_id` is not null.
- Unique `(source_name, canonical_url)` where `canonical_url` is not null.
- Index on `property_id`.
- Index on `(property_id, status)`.
- Index on `verification_state`.

### `listing_observation_links`

Links observations to their canonical listing after reconciliation.

Required fields:

- `id`
- `canonical_listing_id`
- `listing_observation_id`
- `link_reason`: `source_identity`, `source_alias`, `canonical_url`,
  `user_provisional`, `manual_repair`
- `created_at`

Constraints:

- Unique `(listing_observation_id)`.
- Index on `canonical_listing_id`.

### `mirror_listing_watches`

Stores validation and follow-up state for user-discovered candidates.

Required fields:

- `id`
- `source_name`
- `property_id`
- `submitted_by`
- `source_url_raw`
- `source_url_canonical`
- `source_listing_id`
- `canonical_listing_id`
- `state`: `pending`, `queued`, `fetching`, `matched`, `not_found`,
  `blocked`, `invalid`, `parser_error`, `unsupported`, `retryable_error`
- `state_reason`
- `attempt_count`
- `last_attempt_at`
- `next_attempt_at`
- `last_error`
- `last_validation_observation_id`
- `created_at`
- `updated_at`

Constraints and indexes:

- Unique active watch on `(source_name, property_id, source_url_canonical)`.
- Index on `(state, next_attempt_at)`.
- Index on `canonical_listing_id`.

### `listing_price_observations`

Stores price evidence with provenance before price history is projected.

Required fields:

- `id`
- `listing_observation_id`
- `canonical_listing_id`
- `property_id`
- `source_name`
- `source_listing_id`
- `origin`
- `price`
- `currency`
- `event_type`: `initial`, `price_change`, `status_change`,
  `mirror_refresh`, `user_submission`
- `price_date`
- `observed_at`
- `created_at`

Constraints:

- Unique `(canonical_listing_id, source_name, source_listing_id, price_date,
  price, event_type)` where `source_listing_id` is not null.
- Index on `property_id`.
- Index on `listing_observation_id`.

The existing `price_history` projection is rebuilt from this provenance-aware
source so price events are not detached from the observation that produced
them.

## Legacy Data Migration

The release includes a deterministic migration from the current mixed
`listings` and `price_history` tables into the provenance-aware model.

Legacy listing mapping:

- Each legacy row with `submitted_by` creates a user-originated
  `listing_observations` row with `origin: user`, the selected `property_id`,
  the legacy `source_url`, legacy preview metadata, legacy status, and
  `legacy_listing_id` stored in `payload`.
- Each legacy row with `source_name` and `mirror_listing_id` creates a
  mirror-originated `listing_observations` row with `origin: mirror`,
  `source_listing_id` from `mirror_listing_id`, mirror timestamps, source URL,
  status, price, and `legacy_listing_id` stored in `payload`.
- A legacy row that contains both user and mirror provenance creates both
  observations and links both observations to the same canonical listing during
  reconciliation.
- Legacy mirror rows with Funda global IDs and tiny IDs populate
  `listing_source_aliases` so the backfill uses the same identity rules as live
  ingest.
- Legacy rows without mirror identity are canonicalized through the source URL
  resolver. Supported Funda URL variants receive source identity where the
  resolver can derive it; supported Pararius URLs receive the Pararius URL
  identity; unsupported URL shapes remain user-originated provisional
  observations.
- Existing canonical listing rows are derived only from migrated observations,
  never from direct legacy row reads.

Legacy price mapping:

- Existing `price_history` rows create `listing_price_observations` linked to
  the migrated observation/canonical listing that produced the price event.
- Price rows that cannot be traced to a mirror observation are linked to the
  user-originated or replay-originated observation for the same property,
  source, price date, and price.
- The public `price_history` projection is rebuilt from
  `listing_price_observations` and keeps the existing read shape while gaining
  canonical listing and observation provenance internally.

After migration, application code writes listing and price changes through
observations, watch outcomes, replay staging, and reconciliation only. The
legacy mixed `listings` write path is removed from preview, submit, live ingest,
replay, and workers.

## Reconciliation Rules

Reconciliation runs in the existing worker path after observation insert,
ingest batch acceptance, replay staging, or validation outcome receipt.

Canonical listing selection:

1. If an observation has `(source_name, source_listing_id)`, resolve aliases and
   attach to the canonical listing with the matching primary source identity.
2. If no source identity exists, attach by `(source_name, source_url_canonical)`
   when the canonicalized URL is source-owned and supported.
3. If a user observation has no mirror identity yet, create or update a
   provisional canonical listing for `(source_name, property_id,
   source_url_canonical)`.
4. When later mirror evidence arrives for the same source URL or watch, attach
   it to the existing provisional canonical listing and promote that row to
   mirror-backed.
5. If mirror evidence confirms a different property than the user-selected
   property, mark the watch and observation `invalid` and do not attach that
   evidence to the user's property listing.

Canonical field precedence:

- Status comes from the freshest mirror observation with lifecycle evidence.
- User-originated status is only used for provisional listings with no mirror
  lifecycle evidence.
- Price comes from the freshest mirror observation with a price; user price is
  used only while provisional.
- URL display prefers source canonical URL, then the user-submitted supported
  URL.
- Thumbnail, title, and description prefer mirror data, then server-fetched
  preview metadata, then client-assisted metadata.
- `origin_summary` is recomputed from linked observations.
- `verification_state` is derived from linked mirror observations and active
  watch state.

## Preview And Submit Contracts

`POST /listings/preview` returns a source-aware validation result instead of a
soft OG warning.

Request:

- `url`
- `propertyId`

Response:

- `sourceName`
- `rawUrl`
- `canonicalUrl`
- `sourceListingId`
- `sourceListingIdKind`
- `validationState`: `valid`, `invalid`, `provisional`
- `matchState`: `matched`, `mismatch`, `unverified`, `unsupported`
- `watchState`: `not_required`, `will_enqueue`, `unsupported`
- `reasonCode`: `source_identity_match`, `address_match`,
  `address_mismatch`, `source_not_supported`, `source_not_found`,
  `mirror_unavailable`, `parser_error`, `og_unavailable`,
  `validation_pending`
- `title`
- `description`
- `imageUrl`
- `address`
- `submittedPropertyId`
- `matchedPropertyId`

Rules:

- Preview performs SSRF protection and listing-domain allowlisting as today.
- Preview asks the source service to parse and canonicalize supported URLs.
- Funda canonical, shared, tracked, and supported ID-style detail URLs resolve
  through the Funda source service to the same tiny-ID-backed source identity.
- Pararius accepts full listing URLs and source-supported relative listing
  paths. ID-only Pararius values return `source_not_supported`.
- Preview requests source validation through the source service. OG metadata is
  fallback display data, not proof of validity.
- A confirmed address/property mismatch returns `validationState: invalid` and
  `matchState: mismatch`.
- Temporary source failures return `validationState: provisional` with a
  watch state that explains the follow-up.

`POST /listings/submit` repeats the server-side validation and never trusts the
client preview result.

Submit behavior:

- Invalid confirmed mismatches are rejected with a 4xx response and no
  canonical listing is created.
- Valid mirror-backed submissions write a user observation, link to or create
  the canonical listing, and record mirror-backed verification.
- Provisional submissions write a user observation, create a provisional
  canonical listing, and enqueue a `mirror_listing_watches` record.
- The response includes the canonical listing id, verification state, watch
  state, and the validation reason code.

## Mirror Source Contracts

Each scraper service exposes the same conceptual contract, implemented inside
the source repo where parser knowledge lives.

The source services expose:

- `POST /api/v1/listings/resolve-url`
- `POST /api/v1/listings/validate`

The main backend exposes the callback:

- `POST /api/ingest/listing-validation-outcomes`

### URL Resolution

Input:

- `sourceName`
- `rawUrl`

Output:

- `supported`
- `canonicalUrl`
- `sourceListingId`
- `sourceListingIdKind`
- `aliases`
- `listingPath`
- `reasonCode`

Source requirements:

- Funda extracts tiny IDs from canonical, shared, tracked, and supported
  ID-style detail URLs. It stores global IDs as aliases and never treats a
  global ID row and tiny ID row as separate real listings once both are known.
- Pararius extracts listing identity from supported listing URLs and relative
  listing paths. It returns unsupported for ID-only input.

### Validation Outcome

Input:

- `watchId`
- `sourceName`
- `rawUrl`
- `canonicalUrl`
- `sourceListingId`
- `propertyId`

Output posted to the main backend:

- `watchId`
- `state`: `matched`, `not_found`, `blocked`, `invalid`, `parser_error`,
  `unsupported`, `retryable_error`
- `sourceName`
- `sourceListingId`
- `sourceListingIdKind`
- `aliases`
- `canonicalUrl`
- `sourceStatus`
- `address`
- `matchedPropertyEvidence`
- `price`
- `currency`
- `thumbnailUrl`
- `title`
- `description`
- `firstSeenAt`
- `lastSeenAt`
- `sourceUpdatedAt`
- `payload`

The main backend stores this as a validation-origin observation, updates the
watch row, and reconciles the canonical listing.

## Mirror Lifecycle Model

Durable lifecycle states use the same vocabulary across live sync, validation,
and replay:

- `available`
- `sold`
- `rented`
- `withdrawn`
- `not_found`
- `blocked`
- `invalid`
- `parser_error`
- `unknown`

Mirror observations are the authority for canonical lifecycle state. A source
failure does not silently leave a listing as available. It produces an explicit
watch or observation state:

- `not_found` when the source confirms the listing no longer exists
- `blocked` when anti-bot or access controls prevent validation
- `parser_error` when fetched content cannot be parsed
- `retryable_error` when validation failed transiently
- `unsupported` when the URL shape or source is outside supported parser
  coverage

## Read Model Migration

All listing read surfaces move to `canonical_listings` and linked projections.

Required read surfaces:

- `/properties/:id/listings`
- `/properties/:id/price-history`
- listing preview/submit response reads
- property queries that currently join or aggregate `listings`
- feed routes that currently use listing rows
- property grouping and grouped property activity feed logic
- `mv_latest_active_listings` or its replacement
- any worker or maintenance code that reads listing status from the legacy
  mixed table

The materialized view becomes a view over `canonical_listings` filtered by
canonical status and verification state. It no longer reads raw observation
rows or legacy mixed listing rows.

The price history route reads the rebuilt `price_history` projection or a
compatibility view over `listing_price_observations`; it does not read price
events that lack canonical listing and observation provenance.

## Replay And Seed Design

Mirror replay uses a source/run-scoped staging table and set-based
reconciliation. It does not call the user-facing preview or submit routes, and
it does not write directly into the old mixed `listings` shape.

Replay flow:

1. Load source rows into `listing_replay_staging` with `source_name`,
   source-owned primary listing id, aliases, canonical URL, normalized address,
   lifecycle status, price, and raw payload.
2. Convert staging rows into mirror-origin observations through the same
   observation insert contract used by live ingest.
3. Upsert aliases before canonical reconciliation.
4. Run set-based reconciliation for the affected source/run.
5. Rebuild canonical listings and price projections for affected properties.
6. Refresh canonical listing views.

`db:seed-listings` is updated to use this replay path. Re-running it converges
with live ingest and preserves user-originated observations. `db:reset`
continues to be a destructive full database reset by design.

## API, Client, Mock, And UI Work

The implementation updates these contracts together:

- OpenAPI route definitions
- `@huishype/api-client`
- MSW handlers
- Add Listing UI preview and submit flow
- API integration tests
- worker reconciliation tests
- scraper sync contract tests in the Funda and Pararius repos

The Add Listing UI disables confirmation for confirmed mismatches and shows the
server-provided validation/watch state for provisional submissions. It does not
expose marketplace URL quirks as user-facing failure modes when the source
service can resolve the URL.

## Validation Matrix

Concrete fixture URLs:

- Funda sale canonical:
  `https://www.funda.nl/detail/koop/eindhoven/huis-beeldbuisring-61/89779872/`
- Funda sale shared:
  `https://www.funda.nl/detail/89779872?utm_source=funda&utm_medium=web&utm_campaign=share-listing-modal`
- Funda sale ID-style:
  `https://www.funda.nl/detail/89779872`
- Funda rent canonical:
  `https://www.funda.nl/detail/huur/eindhoven/appartement-machinekamerplein-32-327/89772524/`
- Funda rent shared:
  `https://www.funda.nl/detail/89772524?utm_source=funda&utm_medium=web&utm_campaign=share-listing-modal`
- Funda rent ID-style:
  `https://www.funda.nl/detail/89772524`
- Pararius canonical:
  `https://www.pararius.com/apartment-for-rent/eindhoven/87a48057/kathodelaan`

Required validation outcomes:

- The three Funda sale fixtures resolve to one source identity and one
  canonical listing.
- The three Funda rent fixtures resolve to one source identity and one
  canonical listing.
- The Pararius fixture resolves through the Pararius URL resolver and follows
  the same preview, submit, watch, and reconciliation rules.
- A valid listing no longer fails solely because OG title extraction is weak or
  absent.
- A confirmed property mismatch is rejected on preview and submit.
- A provisional submission creates a canonical listing immediately and records
  a mirror watch.
- A later mirror validation result promotes the same canonical listing without
  duplication.
- Mirror lifecycle updates change canonical status according to source
  evidence.
- `not_found`, `blocked`, `parser_error`, `unsupported`, and
  `retryable_error` are visible in watch/read APIs.
- Mirror replay preserves user-originated observations and converges to the
  same canonical listing state as live sync.
- Existing property listing reads, feeds, grouping reads, and latest-active
  listing views read from canonical listings.
- Price history projections retain observation/source provenance.
- Generated clients, mocks, API tests, worker tests, and scraper contract tests
  pass with the new contracts.
- The repo gate passes before landing: `pnpm test`.
