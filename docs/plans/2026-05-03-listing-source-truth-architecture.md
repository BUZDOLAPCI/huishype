# Listing Source Truth Architecture Plan

Date: 2026-05-03
Status: Revised 2026-05-05 for scraper-owned freshness and push-based ingest

## Situation

The application currently has stale active Funda and Pararius listings that came
from legacy mirror seed/replay data. A one-off cleanup command was explored and
reverted because it would only patch canonical application state after the fact.
That does not solve the ownership problem: marketplace freshness must originate
in the scraper/source-service layer and flow into the application as auditable
source evidence.

The current risk is that legacy mirror evidence can say "this listing existed"
without proving "this listing is still active." If the application treats that
evidence as current truth, stale active canonical listings can remain or be
reintroduced by later seed/replay jobs.

Do not run broad production cleanup or aggressive marketplace validation until
the scraper-aware architecture below is implemented. Temporary source failures,
blocking, parser errors, retryable errors, and unsupported URLs must never
deactivate listings.

## Desired Architecture

Use a two-layer truth model:

- Scraper/source services own marketplace truth for Funda and Pararius.
- The application owns canonical product state derived from source evidence.

The source services maintain their own mirrors as the authoritative
source-service state for marketplace freshness. They are responsible for keeping
those mirrors up to date through crawls, state checks, and source-specific
lifecycle detection. Mirror rows are the source layer's durable truth and
provenance. They are not direct canonical application truth until they are
delivered to HuisHype as source observations and reconciled.

The source services push fresh observations to the application whenever crawler
runs, state checks, or mirror changes produce meaningful listing updates. The
application does not scrape marketplaces and does not ask source services for
normal listing freshness. It consumes authenticated ingest batches, stores the
observations, reconciles canonical listing state, and refreshes read models.

Source observations should include:

- listing identity and aliases
- canonical source URL
- property/address match evidence
- listing type / transaction type such as `sale`, `rent`, or `unknown`
- lifecycle status: `available`, `sold`, `rented`, `withdrawn`, `not_found`
- diagnostic status: `blocked`, `parser_error`,
  `retryable_error`, `unsupported`, `invalid`, `unknown`, and
  `mirror_unavailable`
- listing facts owned by the source mirror, including price, currency, media,
  title, description, and source timestamps
- mirror provenance such as `crawler_discovered`, `user_submitted`, and
  replay/import origins where needed
- crawl batch/run metadata that makes absence meaningful only for completed,
  scoped source runs
- sync cursor or watermark metadata for replay and recovery

The application should persist listing evidence in `listing_observations`,
persist scoped completion evidence in a dedicated app-side table such as
`listing_scope_completions`, reconcile into `canonical_listings`, and refresh
read models such as `mv_latest_active_listings` and property tile listing facts.

## Source Boundary

Scraper/source services provide the marketplace-specific behavior:

- crawling and rate control
- parser maintenance and anti-bot handling
- source URL normalization
- source listing identity extraction
- lifecycle and absence evidence
- mirror freshness, provenance, and sync watermarks
- batch completion metadata

The application should not duplicate routine source freshness scraping logic.
Its boundary is the ingest contract, observation storage, canonical
reconciliation, read-model refresh, operator recovery tooling, and the single
user-submission preview preflight described below. That preview is a
user-confirmation gate for one submitted URL, not a parallel long-term
marketplace truth system.

## Target Flow

1. A scraper run discovers or refreshes listings for a scoped source area/query.
2. The source service updates its mirror with lifecycle state, match evidence,
   timestamps, and provenance such as `crawler_discovered`.
3. The source service sync worker pushes changed mirror rows as ingest batches
   with source identities, canonical URLs, lifecycle state, match evidence, run
   metadata, and watermarks.
4. The application stores listing rows as observations, stores scoped
   completions in `listing_scope_completions`, and reconciles affected
   canonical listings.
5. Completed source batches may mark previously active canonical listings as
   stale only when absence is meaningful for that source scope.
6. If application state is missing, corrupted, newly bootstrapped, or out of
   sync, an operator can run the full mirror seed/replay flow from the latest
   scraper mirrors.
7. Full mirror seed/replay must feed the same observation/reconciliation path as
   normal push ingest. It must not write canonical listing state directly or
   invent source truth that is not present in the scraper mirrors.
8. Read models are refreshed only after canonical state changes.

## Full Mirror Seed And Replay

HuisHype needs a first-class seed function that processes whole scraper mirror
state, not a legacy shortcut that writes application listing state directly.
Whole-mirror replay is the default mode for recovery and bootstrap. Scoped
replay is an explicit repair or dry-run mode and must require source, scope,
reason, and operator confirmation before execution.

Use cases:

- first application bootstrap from existing Funda and Pararius mirrors
- rebuilding canonical application state after application-side data loss or
  corruption
- backfilling observation history after ingest contract changes
- recovery from missed source-service pushes
- production-safe dry runs before source-scoped repair operations

Requirements:

- Seed reads a consistent snapshot of each selected source mirror.
- Default seed/replay reads the complete selected source mirror. Scoped replay
  must be named `--scope` or equivalent, report the excluded mirror range, and
  be used only for repair, validation, or dry-run analysis.
- Seed imports every current mirror row in scope and preserves source-service
  provenance, source identity, canonical URL, lifecycle status, listing type,
  timestamps, price, currency, media, match evidence, and sync watermark data.
- Seed can import scoped completion records into `listing_scope_completions` so
  absence semantics are replayed with the same safeguards as normal pushed
  ingest.
- Seed must allow empty scoped completions. A completed source scope with zero
  listings is meaningful evidence; a listing batch with zero rows must not be
  rejected by the ingest contract.
- Seed writes listing observations and scoped completions, then invokes
  reconciliation. It does not directly insert, update, withdraw, or reactivate
  canonical listing rows.
- Seed is idempotent by source, source listing identity, canonical URL, source
  run id, and observation timestamp.
- Seed and replay must apply source observations in source-time order. Delayed
  replay or out-of-order pushed batches must not overwrite newer lifecycle,
  price, media, or match state with older evidence.
- Seed and replay must still persist out-of-order batches whose source
  high-watermark is lower than the stored source/scope high-watermark. These
  rows are immutable audit evidence, must be marked `stale_for_projection`, and
  must be excluded from canonical and read-model mutation unless the run is an
  explicit operator repair with a reason.
- Seed has a `--dry-run` mode that reports inserted observations, promoted
  provisional listings, terminal lifecycle changes, ignored diagnostic states,
  scoped absence effects, `stale_for_projection` rows, read-model refreshes,
  and skipped rows.
- Dry-run output must include source, scope, mirror snapshot id, source
  high-watermark, oldest/newest source timestamp, affected canonical count,
  examples for each transition class, stale-for-projection count, and whether
  execute or repair-mode execute would be allowed.
- Execute must abort when dry-run thresholds fail: more than 1% unexpected
  reactivation, more than 0.1% duplicate canonical candidates, any absence
  without scoped completion, any terminal change from diagnostic status,
  or any non-repair attempt to project a stale batch.
- `db:seed-listings` should become the operator entrypoint for this flow, while
  source-service push ingest remains the normal freshness mechanism.
- `db:seed-listings` must call the same shared ingest parser, observation
  persistence, reconciliation, idempotency, and read-model refresh code as
  source-service push ingest. The only allowed difference is the source of the
  batch stream: mirror snapshot instead of pushed outbox delivery.

## User-Submitted Listing Flow

User-submitted listing URLs are a combined preview-and-provisional creation
flow. The preview is the only marketplace fetch, parse, and validation pass that
HuisHype performs for user submission; submit consumes the exact preview result
and must not re-fetch or re-validate the source page.

1. A user asks HuisHype to preview a marketplace URL for a property.
2. HuisHype runs one preview preflight/fetch/validation function before submit.
   It collects the user-approval data for that exact URL and property: source
   identity, normalized and canonical URL, source listing id if available,
   address/property match evidence, price, currency, price type when available
   or required, title, description, thumbnail, Open Graph metadata, and a
   diagnostic reason when invalid.
3. The preview result is persisted durably or encoded in a signed preview token
   with enough idempotency and integrity metadata to prove submit is using that
   exact preflight. The token/result must bind source, canonical URL, submitted
   property id, match evidence, listing facts, preview timestamp, user/session
   scope as needed, and an idempotency key.
4. If preview cannot fetch, parse, or validate the listing because the page is
   invalid, not found, an unsupported source URL shape, blocked source, parser
   error, address/property mismatch, missing required facts, or any similar
   terminal diagnostic, HuisHype rejects with a user-facing error. It does not
   create a provisional listing and does not send a candidate to any
   scraper/source service.
5. If preview succeeds and HuisHype already has the listing, the confirmed
   submission is stored as user evidence or ignored idempotently. It must not
   create a duplicate canonical listing or overwrite scraper-owned mirror truth.
6. If preview succeeds, HuisHype does not already have the listing, and the user
   confirms, submit creates a provisional listing record immediately from the
   stored/signed preview result. Submit must not re-fetch or re-validate the
   source page. The provisional row must be visibly distinct in storage from
   scraper-backed source truth, but it is treated as valid product state for all
   listing-facing read models until source-service mirror observations promote,
   correct, replace, or withdraw it. Projection is not scoped to the submitting
   user's property detail flow; map tiles, property details, feed/search/filter
   results, saved/search result views, price history, and price-start summaries
   must all see the provisional listing immediately.
7. After provisional creation, HuisHype sends a durable candidate/nudge to the
   relevant source service. This handoff tells the scraper that a user approved
   the preview snapshot and that the mirror should ingest the source page and
   push canonical state later. The nudge must be stored in an application outbox
   or equivalent retryable handoff before returning submit success to the user.
8. The source service records the candidate in a durable candidate/intake table
   with provenance `user_submitted`, preserving the raw URL, normalized and
   canonical URL, source listing id if known, submitted property id, preview
   facts, match evidence, submitted-at timestamp, and HuisHype preview/candidate
   id. Candidate rows are not mirror truth by themselves.
9. The source service scrapes or validates the candidate using normal
   marketplace-specific logic, then updates its mirror with source identity,
   lifecycle state, listing type, address/match evidence, price, currency,
   media, and validation diagnostics.
10. The source service pushes the resulting mirror observation back to HuisHype.
11. HuisHype reconciles that mirror observation into the existing provisional
   listing when it matches by source identity, canonical URL, alias, source
   candidate id, preview id, or property match evidence. Scraper-backed mirror
   observations become authoritative for lifecycle status, listing type, price,
   currency, URL, media, and match evidence. The source-backed observation
   promotes, corrects, replaces, or withdraws the provisional snapshot rather
   than creating a duplicate listing.

The source-service mirror should keep enough `user_submitted` provenance to
debug missed crawler coverage later. When a user-submitted listing was not
previously crawler-discovered, operators should be able to answer whether the
crawler missed the relevant area/query, normalized the URL differently, failed
to parse the listing, was blocked, saw a terminal lifecycle state, or had not
yet covered that source scope.

## Rules

- Scraper/source services are the only normal freshness mechanism for Funda and
  Pararius listings.
- The application does not poll source services for routine listing updates.
- HuisHype performs exactly one marketplace fetch/parse/validation pass for a
  user-submitted URL: the pre-submit preview preflight. That preview is a
  user-approved provisional snapshot and must not be treated as long-term source
  truth.
- Submit must only consume a signed/durable/idempotent preview token or stored
  preview result from the exact preflight the user approved. Submit must not
  re-fetch the marketplace page, re-run parser validation, or silently refresh
  listing facts.
- A failed preview with terminal diagnostics such as invalid page, listing not
  found, unsupported URL shape, blocked source, parser error, address/property
  mismatch, or missing required facts rejects the user submission before
  provisional creation and before source-service candidate handoff.
- After a successful preview and user confirmation, the application can submit
  durable scrape candidates to source services. Those candidates are
  coverage-expansion nudges for scraper-backed canonical mirror ingestion, not
  a second validation attempt by HuisHype.
- A fresh positive source observation can keep or move a canonical listing to
  `active`.
- A source-confirmed terminal lifecycle can move a canonical listing to `sold`,
  `rented`, or `withdrawn`.
- A confirmed `not_found` can withdraw an active listing when source identity is
  known.
- Absence can withdraw listings only when tied to a completed scoped scraper
  batch with reliable coverage semantics.
- `blocked`, `parser_error`, `retryable_error`, `unsupported`, `invalid`,
  `unknown`, and `mirror_unavailable` are diagnostic status values, stored
  separately from lifecycle status. Diagnostic status must never directly
  project into canonical lifecycle.
- Diagnostic states are persisted as observations, diagnostics, and operational
  backlog. They must not project into public active, sold, rented, withdrawn,
  or not-found canonical lifecycle changes by themselves.
- A failed user-submission preview rejects that provisional submission, but it
  cannot withdraw an existing scraper-backed canonical listing unless
  accompanied by source-confirmed lifecycle or scoped absence evidence.
- `user_submitted` is reserved for listings inserted into a source-service
  mirror or intake table because a HuisHype user submitted the listing URL.
  Operator repair and controlled imports should use their own explicit
  provenance values instead of sharing this bucket.
- A successful user-approved preview can create a provisional canonical listing
  in HuisHype immediately at submit. It is valid user-facing product state until
  promoted, corrected, replaced, or withdrawn by source-service mirror
  observations, and must be visible in every listing-facing surface that would
  show a scraper-backed listing. It does not become scraper-backed truth until
  the source service pushes source-owned evidence back through ingest.
- When mirror evidence arrives for a user-submitted candidate, reconciliation
  should promote or correct the existing provisional canonical listing instead
  of creating a replacement row.
- Provisional user-submitted rows must carry enough identity to merge later:
  submitted raw URL, normalized URL, canonical URL, source, source listing id
  when available, property id, submitting user id where available, preview id or
  preview token hash, candidate id, submitted-at timestamp, preview fact
  snapshot, and current handoff state.
- Legacy seed data without fresh mirror state or batch linkage must not be
  treated as current availability.
- `db:seed-listings` is a recovery replay tool. It must converge through the
  same observation/reconciliation path and must not blindly reactivate legacy
  mirror rows.

## Ingest Contract Requirements

The application ingest contract must support both normal pushed changes and full
mirror seed/replay.

Payload requirements:

- source identity: source name, source listing id when known, canonical source
  URL, normalized URL aliases, and optional source candidate id
- lifecycle status: `available`, `sold`, `rented`, `withdrawn`, `not_found`
- diagnostic status: `blocked`, `parser_error`, `retryable_error`,
  `unsupported`, `invalid`, `unknown`, `mirror_unavailable`
- provenance: `crawler_discovered`, `user_submitted`, `replay`, `import`, and
  source-specific repair origins where needed
- property/address match evidence and confidence
- listing type / transaction type, price, currency, media, title, description,
  and other listing facts owned by the source mirror
- observation timestamp, source run id, optional scoped completion reference,
  upstream run key if still needed during migration, cursor/high-watermark data,
  and idempotency key
- scoped completion metadata for absence: source, country/region/query/scope
  identity, listing type, normalized filters, run id, started-at, completed-at,
  page coverage, success/partial-failure flags, total listings observed, and
  source-side high-watermark
- absence-only payloads: batch kind `completion`, source, scope identity,
  listing type, normalized filters, run id, started-at, completed-at,
  success/partial-failure flags, observed listing count, source high-watermark,
  idempotency key, and optional diagnostics; no listing rows are required
- app-assigned projection eligibility: batches older than the stored
  source/scope high-watermark are persisted with `stale_for_projection=true`
  and cannot drive canonical/read-model mutation outside explicit operator
  repair mode

The contract must allow absence-only completion records. A completed scope can
contain zero listing rows, and that must still be valid ingest evidence.
Absence-only records must be stored durably in `listing_scope_completions`
before reconciliation runs. Listing observations may reference the completion,
run, and scope where relevant, but absence itself is run/scope evidence, not a
listing observation. Reconciliation may withdraw only listings whose source,
listing type, normalized filters, and prior source timestamps fall inside that
completed scope and at or below the completion high-watermark.

Status vocabularies must be separated into distinct fields and then frozen
before migration:

- lifecycle status: `available`, `sold`, `rented`, `withdrawn`, `not_found`
- diagnostic status: `blocked`, `parser_error`, `retryable_error`,
  `unsupported`, `invalid`, `unknown`, `mirror_unavailable`
- operational/candidate status: queue, retry, dead-letter, handoff, and
  pushed-back states that never project directly into canonical lifecycle

Each repo must use the same names for the same vocabulary class, and ingest
observations must store lifecycle status and diagnostic status as separate
fields, not as one overloaded enum. Migrations must include an explicit mapping
table from legacy validation, sync, and mirror values that remain in historical
data. After the mapping lands, adding or renaming a status requires a contract
change and tests in the app repo and both scraper repos.

## Projection And Absence Semantics

Canonical listing projection must be deterministic from stored observations.

- Source-backed lifecycle observations can update canonical lifecycle.
- User-submitted provisional observations can create or update provisional app
  rows only from successful user-approved preview results. They project into
  all market-facing read models as valid until promoted, corrected, replaced,
  or withdrawn by source-service mirror evidence. They remain storage-distinct
  from scraper-backed observations and do not prove source-owned availability.
  Projection must be global to listing-facing surfaces, not limited to the
  submitting user's current property detail request.
- `blocked`, `parser_error`, `retryable_error`, `unsupported`, `invalid`,
  `unknown`, and `mirror_unavailable` are diagnostic observations only; they
  never withdraw, sell, rent, or reactivate a scraper-backed listing by
  themselves.
- `not_found` can withdraw only when tied to a known source listing identity or
  canonical source URL.
- Absence can withdraw only after a `listing_scope_completions` row proves a
  completed scoped source run had reliable coverage for the listing's source
  scope.
- Partial runs, blocked runs, parser failures, pagination gaps, changed-row-only
  syncs, mirror-unavailable runs, or missing batch completion records never
  imply absence.
- Completion scope must include source, geography/query identity, listing type,
  normalized filters, run id, coverage status, completion timestamp, observed
  count, and source high-watermark.
- Reconciliation must compare observation timestamps, source run order, and
  source high-watermarks. Older replayed or delayed observations must not
  overwrite newer lifecycle, price, media, or match state.
- Reconciliation may use observation references to completion/run/scope data for
  audit, but absence decisions must read the scoped completion table directly.
- Source-time ordering is authoritative over ingest-time ordering. Store both,
  but resolve conflicts by source observation timestamp, source run order, and
  per-source high-watermark.
- A batch whose high-watermark is lower than the stored source high-watermark
  for that source/scope must be stored for immutable audit evidence with
  `stale_for_projection=true`. It must not mutate canonical listings or refresh
  listing read models unless explicitly run as operator repair with a reason.
- Read-model refresh must be driven from the reconciled canonical diff, not from
  raw ingest row count, so idempotent replay does not churn projections.
- Reconciliation must merge scraper-backed observations into matching
  provisional user-submitted rows by candidate id, source listing id, canonical
  URL, URL aliases, and property match evidence.
- Reconciliation must preserve the observation trail even when scraper-backed
  data corrects URL normalization, property matching, lifecycle status, price,
  or media from the provisional user-submitted row.
- Confirmed rejection, unsupported diagnostic status, invalid URL, or
  address/property mismatch from the source service must remove or correct the
  provisional listing everywhere it was projected, including map tiles, feed,
  search/filter views, saved/search result views, property details,
  price-start summaries, and price history. This candidate cleanup must not
  directly mutate scraper-backed canonical lifecycle.
- Provisional listings must be covered by every market-facing projection that
  can show scraper-backed listings: `mv_latest_active_listings`, property tile
  facts, map tile payloads, property details, feed/search/filter queries,
  saved/search result views, price history, `v_canonical_listing_facts`, and
  `mv_price_guess_start_market_summaries`. Each projection must also have
  rejection and correction cleanup coverage.

## Source-Service Candidate Intake

Each source service needs a durable candidate intake path backed by a separate
candidate/intake table. Do not insert user-submitted candidates directly into
the mirror as if they were source-discovered listings.

Minimum behavior:

- authenticated endpoint or queue consumer that accepts only successful
  user-approved preview candidates from HuisHype: raw source URL, normalized and
  canonical URL, source listing id if known, HuisHype property id, expected
  listing type if known, source candidate id, HuisHype preview id, submitted-at
  timestamp, preview fact snapshot, address/property match evidence, and
  idempotency key
- durable source-service storage for candidates before scrape/validation starts
- idempotent upsert by canonical URL, normalized aliases, source listing id when
  known, HuisHype preview id, and source candidate id
- retry and dead-letter handling for app-to-source handoff failures
- candidate lifecycle states for queued, accepted, scraped, linked to crawler
  discovery, blocked, parser_error, retryable_error, unsupported, invalid,
  mismatch, terminal, and pushed back to HuisHype
- mirror linkage that preserves `user_submitted` provenance after the candidate
  becomes a normal mirror listing
- mirror rows are created or linked only after source validation, source listing
  identity extraction, crawler discovery, or a source-confirmed terminal outcome
- pushback to HuisHype through the same ingest contract used for crawler
  discoveries
- no intake row for preview failures that HuisHype already rejected before
  submit, including invalid pages, listing not found, unsupported URL shapes,
  blocked sources, parser errors, address/property mismatch, missing required
  facts, or similar terminal diagnostics

## Source-Service Outbox And Push

Normal freshness is push-based. Each source service must persist outgoing
HuisHype observations in a durable outbox before delivery.

Requirements:

- outbox row per ingest batch or batch chunk with source, scope, run id,
  payload hash, idempotency key, source high-watermark, created-at,
  last-attempt-at, delivered-at, attempt count, and dead-letter reason
- at-least-once delivery to HuisHype with idempotent application ingest
- retry with bounded backoff and operator-visible dead-letter queue
- push ordering by source high-watermark within each source/scope
- replay from outbox after HuisHype downtime without regenerating source truth
- no direct database writes from scraper services into HuisHype application
  tables

The existing app-owned preview/submit path must be reshaped into exactly one
pre-submit preview preflight/fetch/validation function plus tokenized or stored
preview-result submission. Preview performs the only HuisHype marketplace
fetch/parse/validation pass for user submission. Submit performs duplicate
checks, creates the provisional row from that exact preview result, and enqueues
durable candidate handoff, but must not fetch or validate the source page again.

## Current Repo Touchpoints

The sprint implementation should start with a delta audit because the repo
already contains parts of the ingest/reconciliation architecture.

Application touchpoints:

- `services/api/src/routes/listings.ts`: `/listings/preview`,
  `/listings/submit`, preview token or stored preview result handling,
  `/api/ingest/listings`, and `/api/ingest/watermark`;
  `/api/ingest/listing-validation-outcomes` must be deleted in this sprint
- `services/api/src/services/ingest/contracts.ts`: source status vocabulary,
  batch shape, idempotency, `listing_scope_completions` payloads,
  observation-to-completion references, and zero-listing batch support
- `services/api/src/services/ingest/processor.ts`: observation persistence,
  `listing_scope_completions` persistence, optional observation references to
  completions, and reconciliation invocation
- `services/api/src/services/listing-reconciliation.ts`: canonical projection,
  provisional merge, terminal lifecycle, and diagnostic status handling
- `services/api/src/services/listing-source-resolution.ts`: current
  app-owned validation/preview behavior that must become the single preview
  preflight boundary with terminal diagnostics, durable/signed preview results,
  and submit-time no-refetch enforcement
- `services/worker/src/runtime.ts`: app-owned validation/watch processing to
  remove; only durable candidate handoff retries may remain
- `services/api/scripts/seed-listings.ts`: conversion from direct canonical
  writes to full mirror observation replay
- `services/api/src/db/schema.ts` and migrations: `listing_observations`,
  `listing_scope_completions`, observation-to-completion/run/scope references,
  canonical listing, candidate, removal of `mirror_listing_watches`, and status
  enum changes
- read models: `mv_latest_active_listings`, property tile facts, property
  details, map tile payloads, feed/search/filter queries, saved/search result
  views, price history, `v_canonical_listing_facts`, and
  `mv_price_guess_start_market_summaries`

`mirror_listing_watches` and `/api/ingest/listing-validation-outcomes` are
retired immediately by this sprint. Source-service candidate intake and
source-service outbox pushback are the replacement. The application must remove
the table, route, worker processing, and reconciliation dependencies in the
same sprint; no legacy path may project or feed canonical listing state.

Source-service touchpoints:

- `/home/caslan/dev/git_repos/hh/huishype-funda-scraper`
- `/home/caslan/dev/git_repos/hh/huishype-pararius-scraper`
- mirror listing models and migrations
- source sync workers and ingest clients
- candidate intake endpoints or queue consumers
- URL canonicalization and source listing identity extraction
- lifecycle and diagnostic status mapping, especially cases that currently
  default unknown or unsupported diagnostics to active
- run completion, scoped coverage, cursor, and watermark persistence

## Implementation Workstreams

Phase 0, delta audit:

1. Audit the current app repo and both scraper repos before implementation.
   Update the work checklist when current code has already implemented,
   renamed, or contradicted part of this plan.
2. Audit current replay/reconciliation behavior in
   `services/api/scripts/seed-listings.ts`,
   `services/api/src/services/ingest/`, and
   `services/api/src/services/listing-reconciliation.ts`.
3. Audit Funda and Pararius source-service contracts and mirror schemas for
   lifecycle state, batch coverage, URL canonicalization, provenance,
   watermarks, outbox support, and validation leftovers.

Phase 1, contract freeze:

4. Freeze lifecycle, diagnostic, and operational status vocabularies across all
   repos, including legacy mapping migrations and contract tests.
5. Define ingest payloads for listing observations, `listing_scope_completions`,
   source high-watermarks, scoped replay, and outbox push delivery.

Phase 2, source services:

6. Extend scraper/source sync payloads so pushed batches carry source-owned
   lifecycle observations, provenance, freshness timestamps, run metadata, sync
   cursors, and high-watermarks.
7. Add durable source-service outboxes with at-least-once push semantics and
   dead-letter reporting.
8. Add durable user-submitted candidate intake that accepts only successful
   HuisHype preview candidates, records `user_submitted` provenance, and later
   links the candidate to crawler discovery, validation, parser, blocked,
   terminal, invalid, mismatch, or unsupported outcomes.
9. Emit explicit diagnostic failure states without allowing those states to
   imply absence or canonical lifecycle changes.

Phase 3, application preview, ingest, and projection:

10. Implement a single user-submission preview preflight/fetch/validation
    function that returns user-approval data, terminal diagnostics, and a
    signed/durable/idempotent preview token or stored preview result.
11. Change submit so it consumes only the exact successful preview result the
    user approved, performs duplicate checks, creates the provisional listing
    from that preview snapshot, and enqueues durable candidate handoff without
    re-fetching or re-validating the marketplace page.
12. Extend application ingest/reconciliation to apply only source-backed
    lifecycle outcomes, persist absence-only completions in
    `listing_scope_completions`, enforce source-time ordering, and preserve
    listing auditability in `listing_observations`, including
    `stale_for_projection` on lower-watermark batches.
13. Add scoped batch completion and absence semantics so missing listings only
    withdraw canonical rows when source coverage is reliable and represented by
    a completion row.
14. Ensure provisional listings project immediately to every listing-facing
    read model and API response, including map tiles, property details,
    feed/search/filter views, saved/search result views, price history, and
    price-start summaries; source-service rejection or correction must remove
    or update the same projections.
15. Remove `mirror_listing_watches` and
    `/api/ingest/listing-validation-outcomes` from schema, routes, workers,
    reconciliation, and tests. Candidate intake plus source-service outbox
    pushback are the only canonical replacement.

Phase 4, replay and operations:

16. Refactor `db:seed-listings` into whole-mirror replay by default, with
    scoped replay only for repair or dry-run. It must write observations and
    `listing_scope_completions`, then invoke reconciliation through the shared
    ingest path.
17. Add operational reports for ingest lag, stale scraper mirrors,
    user-submitted candidates not yet crawler-discovered, replay results,
    dry-run thresholds, outbox dead letters, `stale_for_projection` batches,
    high-watermark regressions, and diagnostic source failures.

Phase 5, release gate:

18. Run production-safe dry runs and small source-scoped batches. Execute only
    after the acceptance matrix passes and abort thresholds are clean.

## Production Safety

- Rollout is one-pass, not a staged migration with temporary user-facing legacy
  behavior. Do not ship an intermediate state where legacy active marketplace
  rows remain trusted while the scraper-owned architecture is only partially in
  place.
- Production mutation is out of scope until dry-run reports have been reviewed.
- Dry runs must report row counts and examples for every status transition type.
- Dry-run reports must be measurable and machine-readable. Include counts and
  sampled ids for active-to-terminal, terminal-to-active, provisional promote,
  provisional reject, absence withdrawal, ignored diagnostic, duplicate match,
  `stale_for_projection`, skipped stale observation, high-watermark regression,
  and read-model refresh.
- Production execution should run only after app ingest, reconciliation,
  read-model refresh, source-service push, source-service candidate intake, and
  full mirror seed/replay are implemented and verified together.
- Small source-scoped dry runs are allowed for validation, but production
  cutover must apply the final architecture coherently rather than relying on a
  transition phase.
- Abort criteria: unexpected active reactivation, terminal status applied from
  diagnostic evidence, absence applied without `listing_scope_completions`
  evidence, duplicate
  canonical rows for one source listing, or read-model divergence after
  reconciliation.
- Numeric abort thresholds for any execute run: active reactivation count
  greater than dry-run-approved count, more than 1% of scoped active listings
  withdrawn by absence, more than 0.1% duplicate canonical candidates, any
  non-repair projection from `stale_for_projection` evidence, any lifecycle
  mutation from diagnostic status, any unauthenticated or replayed idempotency
  key accepted twice, or any read-model count mismatch after refresh.
- Rollback must be based on stored observations and migrations, not ad hoc
  production cleanup commands.

## Verification Goals

- The first sprint step produces a current-code delta audit covering the app
  repo and both scraper repos.
- Scraper-discovered state changes are pushed through ingest and reflected in
  canonical listings.
- Current ingest-backed listings are not changed by legacy cleanup logic.
- Legacy active listings without fresh mirror evidence stop being treated as
  current truth.
- Fresh source observations keep active listings active.
- `not_found`, `sold`, `rented`, and `withdrawn` update canonical lifecycle only
  when tied to source identity or reliable `listing_scope_completions` absence
  evidence.
- Diagnostic statuses such as `blocked`, `parser_error`, `retryable_error`,
  `unsupported`, `invalid`, `unknown`, and `mirror_unavailable` never directly
  project canonical lifecycle or deactivate listings.
- User-submitted preview performs exactly one HuisHype marketplace fetch, parse,
  and validation pass before submit, returns source identity, canonical URL,
  source listing id when available, match evidence, price facts, metadata, and
  terminal diagnostics, and stores or signs the result for submit.
- Terminal preview diagnostics reject the submission before provisional
  creation and before any source-service candidate handoff.
- Submit reuses the exact approved preview token or stored result without
  re-fetching or re-validating the source page.
- Successfully confirmed user-submitted listings appear immediately as
  provisional canonical listings across all listing-facing surfaces, not only
  the submitting property detail flow, and are later promoted, corrected,
  replaced, or withdrawn by source-service mirror observations.
- `mirror_listing_watches` and `/api/ingest/listing-validation-outcomes` are
  deleted or fully disconnected from the canonical flow in the sprint.
- `user_submitted` provenance is visible in source-service mirror/intake data
  and can be used to investigate crawler coverage gaps.
- Re-running mirror seed/replay is idempotent and cannot reintroduce stale
  active listings.
- Lower-watermark pushed or replayed batches are persisted as immutable audit
  evidence with `stale_for_projection=true` and do not mutate canonical
  listings or listing read models outside explicit operator repair mode.
- Manual `db:seed-listings` replay can reconstruct application state from the
  latest scraper mirrors after missed ingest or application-side corruption.
- `mv_latest_active_listings`, property tile listing facts, map tile payloads,
  property details, feed/search/filter views, saved/search result views, price
  history, and price-start summaries all reflect canonical state after
  reconciliation.

Required test coverage:

- contract tests for source push ingest, zero-listing `listing_scope_completions`
  payloads, separated lifecycle/diagnostic status fields, diagnostic failure
  states, and idempotent replay
- contract tests for absence-only payloads, observation-to-completion
  references, source high-watermark regressions stored as
  `stale_for_projection`, out-of-order replay, outbox redelivery, and shared
  push/replay parsing
- reconciliation tests for active, terminal, `not_found`, scoped absence backed
  by `listing_scope_completions`, temporary failure, duplicate source URL, and
  provisional promotion cases
- reconciliation negative tests proving diagnostic statuses, partial runs,
  changed-row-only syncs, stale high-watermarks marked `stale_for_projection`,
  malformed scopes, and unknown source identities cannot project canonical
  lifecycle, withdraw, reactivate scraper-backed listings, or refresh read
  models
- route/API tests for preview preflight success facts, terminal preview
  diagnostics, signed or stored preview result integrity, submit no-refetch
  behavior, user submit duplicate handling, provisional creation from the exact
  approved preview, immediate read-model projection, durable candidate handoff
  only after successful preview confirmation, source pushback merge,
  source-confirmed correction/withdrawal cleanup, and removal of the legacy
  outcome endpoint
- security tests for ingest authentication, source allowlists, idempotency key
  replay, preview token tampering, stale preview reuse, payload tampering,
  oversized batches, source/scope mismatch, and unauthorized candidate intake
- seed/replay tests proving `db:seed-listings --dry-run` and execute paths use
  observations/reconciliation instead of direct canonical writes
- seed/replay idempotency tests for whole-mirror default replay, scoped repair
  replay, `listing_scope_completions` replay, stale source-time replay, and
  repeated dry-run/execute pairs, including explicit repair-mode override for
  stale batches
- source-service tests in both scraper repos for successful-preview-only
  candidate intake, mirror provenance, lifecycle mapping, completion metadata,
  outbox pushback, and push payloads
- source-service outbox tests for durable enqueue, retry, dead-letter,
  high-watermark ordering, duplicate delivery, and replay after HuisHype
  downtime
- read-model tests for latest active listings, property tile facts, property
  details, map tile payloads, feed/search/filter visibility, saved/search result
  views, price history, and price-guess summaries, including provisional
  projection plus rejection and correction cleanup
- full repo gate: `pnpm test`
- relevant E2E coverage for any changed listing submission or listing display
  flow

## Acceptance Matrix

| Area | Acceptance |
|------|------------|
| Whole-mirror replay | Default `db:seed-listings --dry-run` covers the full selected mirror and reports snapshot, watermark, transitions, and abort status. |
| Scoped replay | Requires explicit scope and reason; lower-watermark batches persist as `stale_for_projection` and cannot project unless explicitly executed in operator repair mode; excluded rows are always reported. |
| Absence-only ingest | Zero-row completion batches store `listing_scope_completions`; absence withdraws only listings covered by a successful completion scope and watermark. |
| Status vocabulary | Lifecycle status and diagnostic status are stored as separate fields, operational status is separate, legacy values are mapped explicitly, and all vocabularies are covered by contract tests in all repos. |
| Source-time ordering | Older pushed or replayed observations are audit-stored with `stale_for_projection=true` and cannot overwrite newer canonical lifecycle, facts, or read models outside explicit repair mode. |
| Preview/submission boundary | Preview is the only HuisHype marketplace fetch/parse/validation pass for user submission; terminal preview diagnostics reject without provisional creation or source-service candidate handoff; submit accepts only the exact signed/durable/idempotent preview result and never re-fetches or re-validates the source page. |
| Provisional projection | Successfully previewed and confirmed user-submitted provisional listings appear immediately in every listing-facing projection, including map tiles, property details, feed/search/filter views, saved/search result views, price history, and price-start summaries, and are promoted, corrected, replaced, or withdrawn everywhere after source-service mirror observations. |
| Watch/outcome retirement | `mirror_listing_watches` and `/api/ingest/listing-validation-outcomes` are removed or fully disconnected from canonical flow, with candidate intake and source-service outbox pushback covered by tests. |
| Shared ingest path | Source push and `db:seed-listings` use the same parser, observation/completion persistence, reconciliation, idempotency, and projection refresh code. |
| Source outbox | Funda and Pararius persist outgoing batches, retry at least once, expose dead letters, and preserve high-watermark ordering. |
| Security/idempotency | Duplicate, tampered, unauthorized, stale, oversized, and scope-mismatched payloads or preview tokens are rejected or stored without unsafe mutation; stale source evidence remains auditable. |
| Production safety | Dry-run thresholds are machine-readable and execution aborts on any threshold breach or any non-repair stale projection attempt. |

## Cross-Repo Verification Commands

Run from `/home/caslan/dev/git_repos/hh/huishype`:

```bash
pnpm test
pnpm --filter @huishype/api test:integration
pnpm --filter @huishype/api db:seed-listings -- --dry-run
pnpm --filter @huishype/api db:seed-listings -- --source funda --dry-run
pnpm --filter @huishype/api db:seed-listings -- --source pararius --dry-run
pnpm test:e2e:integration
```

Run from `/home/caslan/dev/git_repos/hh/huishype-funda-scraper`:

```bash
uv run pytest
uv run pytest tests/test_source_contract.py tests/test_sync.py tests/test_api.py
uv run pytest tests/test_candidate_intake.py tests/test_outbox.py
```

Run from `/home/caslan/dev/git_repos/hh/huishype-pararius-scraper`:

```bash
uv run pytest
uv run pytest tests/test_source_contract.py tests/test_sync.py tests/test_api.py
uv run pytest tests/test_candidate_intake.py tests/test_outbox.py
```

## Related Docs

- `docs/plans/2026-04-23-listing-ingest-reconciliation-plan.md`
- `docs/runbooks/scraper-deployment.md`
