# Listing Ingest Reconciliation Plan

Date: 2026-04-23
Status: Proposed

## Summary

Refactor listing ingest so user-added listings and mirror scraper listings can
coexist, merge into one canonical listing record, and remain independently
recoverable.

The core change is to separate:

- canonical listing state shown by the app
- provenance-specific observations from mirrors and users
- mirror watch/validation work that keeps lifecycle state fresh

## Goals

- Keep user-added listings in HuisHype even if mirror data is replayed or
  replaced.
- Keep mirror ingest fully re-seedable without deleting user-originated data.
- Merge user discovery and mirror validation into one canonical listing layer.
- Keep long-term listing lifecycle tracking, especially sold/withdrawn state,
  owned by the mirror infrastructure.
- Let user submissions help expand mirror coverage without treating user input
  as trusted mirror data.
- Accept real supported marketplace URLs reliably, including canonical pages,
  shared links, and tracked variants that point to the same listing.
- Reject invalid property-to-listing pairings before any listing is created.

## Architecture Direction

- Treat every listing input as an observation with explicit provenance.
- Keep a single canonical listing record per real-world listing for app reads.
- Reconcile observations into canonical state using stable source identity first
  and normalized URL matching second.
- Allow provisional user-originated listings to later become mirror-backed
  without creating duplicates.
- Keep mirror-originated data separate enough that source-specific re-seeds stay
  safe and repeatable.
- Make the canonical listing read model explicit rather than assuming the
  current `listings` table can serve both the new write model and the final
  merged read surface unchanged.

## Service Boundary And Ownership

- Mirror discovery, crawling, parser maintenance, anti-bot handling, and
  source-specific extraction remain owned by the separate mirror/scraper
  service, not by the main app monorepo.
- The main app backend owns:
  - user submission preview and submit APIs
  - observation persistence and canonical reconciliation
  - ingest acceptance endpoints and durable ingest ledger
  - read APIs that expose canonical listing state and mirror follow-up state
- The mirror service owns:
  - source-specific URL parsing and canonical URL derivation rules
  - marketplace fetch/validate attempts
  - lifecycle evidence from mirrors over time
  - emitting validation and ingest results back into the main app through the
    ingest boundary
- This plan therefore changes the ingest contract between the main app and the
  mirror service; it does not move scraper logic into the main app.

## Source Responsibilities

- User add flow:
  - discovers a listing
  - captures provisional metadata
  - creates a user-originated observation
- Client-assisted extraction:
  - may help prefill richer candidate data before confirm
  - remains untrusted input until validated server-side
- Mirror scrapers:
  - validate marketplace listings using mirror infrastructure
  - provide durable source identity and lifecycle updates over time
  - remain the primary authority for sold, withdrawn, and similar status changes
  - emit validation outcomes and source-derived canonical URL / listing identity
    through the ingest contract rather than relying on in-process main-app logic
- Reconciler:
  - merges all observations into canonical listing state
  - upgrades provisional listings when mirror validation later arrives

## Data Model And Read Model Changes

- The current `listings` table is both the write path and a direct read path
  today. This plan requires splitting those responsibilities explicitly.
- Introduce provenance-aware persistence for listing observations so
  user-originated evidence and mirror-originated evidence can coexist without
  overwriting each other.
- Introduce an explicit canonical listing read model that is derived from
  observations and exposed to app reads.
- Keep mirror follow-up / validation state in a first-class persisted model
  rather than hiding it inside logs or transient jobs.
- Backfill existing `listings` rows into the new observation model before
  retiring direct-write assumptions.
- Refresh or replace any read surfaces currently driven directly from
  `listings`, including materialized views and property listing reads, so they
  derive from the canonical reconciliation output instead.

## Required New Surfaces

- Drizzle schema changes for:
  - provenance-aware listing observation storage
  - canonical listing read storage or view definition
  - mirror follow-up / watch state storage
  - any supporting mapping tables needed for normalized source identity
- Worker/job changes for:
  - reconcile observation changes into canonical listing state
  - enqueue and process mirror follow-up for user-originated submissions
  - refresh downstream listing views from the canonical read model instead of
    directly from raw listing writes
- API contract changes for:
  - preview responses that distinguish valid, invalid, and provisional states
  - submit responses that reflect provisional creation plus follow-up status
  - read surfaces that expose mirror follow-up state for product and operations
- Generated client, mock, and test updates must ship with the contract changes;
  this is not optional cleanup.

## Add Listing Flow Rules

- Supported Funda and Pararius URLs that resolve to a real listing should be
  accepted even when the shared URL shape differs from the canonical page URL.
- URL handling should normalize alternate marketplace link shapes into one
  stable listing identity before validation and deduplication.
- Source-specific canonicalization must be explicit. Stripping query strings is
  not enough; marketplace-specific shared, canonical, and ID-only URL variants
  need source-owned normalization rules.
- Submission validity must not depend only on OG title extraction.
- The preview step should determine whether the submission is valid, invalid,
  or provisional.
- A confirmed address mismatch must block submission, not merely warn.
- The submit path must re-enforce the same validity rules server-side even if
  the client UI already blocked the action.
- Existing stored source URLs may need backfill or remapping once
  source-specific canonicalization rules are introduced so historical rows
  dedupe consistently with new submissions and mirror ingest.

## Lifecycle Model

- A user-added listing should appear immediately as provisional.
- That provisional listing should trigger a mirror watch/validation nudge for
  the relevant source.
- Once a mirror validates the listing, the same canonical record becomes
  mirror-backed rather than duplicating.
- Canonical status freshness should prefer mirror evidence over user-originated
  observations.
- Listings that only have user-originated evidence should remain clearly marked
  as provisional or unverified.

## Mirror Coverage And Operations

- Mirrors remain responsible not only for steady-state scraping, but also for
  absorbing user-discovered listing candidates into normal source coverage.
- User-discovered listings should enter a mirror watch queue with explicit
  states such as pending, matched, not found, blocked, and invalid.
- Mirror validation outcomes should be visible to the product and operations
  layers so a listing is never stuck in an unexplained provisional state.
- Mirror pipelines should treat watch-queue validation and normal source
  crawling as part of one coverage system rather than as separate products.
- Re-seed and ongoing mirror sync must converge on the same canonical mirror
  observation model so replayed data and live data do not diverge.
- A listing that cannot yet be mirrored should remain in HuisHype as
  user-originated, but it must stay clearly unverified and should be eligible
  for future mirror retry.
- Source-specific URL normalization and listing identity rules should live with
  the mirror/source layer so canonical URLs, shared URLs, and alternate listing
  link shapes resolve consistently.
- Those watch states must be persisted in the main app data model and exposed by
  API reads; they cannot exist only inside mirror worker logs.

## Mirror Gap Closures

- Close the discovery gap:
  user-added listings should automatically seed mirror follow-up instead of
  waiting for a future bulk crawl to find them.
- Close the validation gap:
  mirror follow-up must produce a clear success or failure state, not silent
  best-effort behavior.
- Close the replay gap:
  mirror re-seed and live ingest must write compatible provenance so canonical
  reconciliation behaves the same after a replay.
- Close the coverage gap:
  unsupported or temporarily broken sources must degrade into provisional state
  without blocking the user flow or pretending to be validated.
- Close the observability gap:
  the system should explain whether a listing is provisional because the mirror
  has not tried yet, could not find it, was blocked, or lacks parser support.
- Close the dedupe gap:
  mirror confirmation should attach to the existing canonical listing instead of
  creating a second row when a user submission arrived first.

## Re-seed Rules

- Mirror re-seeds must operate only on mirror-originated observations.
- User-originated observations must survive mirror wipes and replays.
- Rebuilding mirror data must recompute canonical listing state rather than
  replace the whole listing surface blindly.
- If mirror data disappears but user-originated evidence remains, the canonical
  listing may persist in a provisional state.
- Mirror re-seeds and live mirror sync should share the same source-of-truth
  reconciliation rules so replayed data lands in the same canonical state as
  fresh crawl data.
- The existing bulk replay path must be updated accordingly. `db:seed-listings`
  cannot continue to bypass the ingest/reconciliation model once this design is
  live.
- Decide explicitly whether replay will:
  - emit observation rows through the same reconciliation path as live ingest
  - or write into a staging shape that is then reconciled identically
- Do not keep a long-lived second replay path that writes directly into the old
  listing shape; that would undermine re-seed safety immediately.

## Product Implications

- Add Listing becomes a discovery and provisional-ingest flow, not a direct
  final write into canonical listing state.
- Mirror coverage becomes the path from provisional to validated or official.
- The app can show one merged listing while still exposing whether it is
  user-added, mirror-validated, or both.
- Duplicate handling shifts from ad hoc table constraints to explicit
  reconciliation rules.
- The Add Listing UI should only allow confirm/submit for valid listings.
- Marketplace-specific URL quirks should be absorbed by canonicalization rather
  than exposed to the user as avoidable failures.
- Listings can move from provisional to validated without changing the visible
  listing identity shown in the product.
- Operations and support can understand why a listing is still provisional and
  whether mirror coverage is pending, broken, or unsupported.

## Sprint Scope

This should ship as one coherent sprint outcome, not as isolated partial
improvements.

- Land the provenance-aware ingest direction and the add-listing validity rules
  together.
- Land the mirror watch/validation path in the same sprint so user-added
  listings can actually become mirror-backed.
- Land mirror-state visibility in the same sprint so provisional listings have
  a clear operational reason when they are not yet validated.
- Land re-seed-safe mirror writes in the same sprint so the new model is
  operationally consistent from day one.
- Do not leave a mixed state where user-added listings use the new model but
  mirrors still behave like the old direct-write flow.
- Land the minimum schema, worker, API contract, generated-client, mock, and
  test changes needed to keep the repo contract-first and operable.

## Rollout

1. Add the new provenance-aware schema, canonical listing read model, and
   mirror follow-up state model explicitly.
2. Update preview and submit contracts, generated clients, mocks, and UI flow so
   validity is represented as valid, invalid, or provisional and confirmed
   mismatches are blocked server-side.
3. Route user submissions into observation writes plus mirror follow-up enqueue,
   while preserving current user-visible listing reads.
4. Route mirror ingest and mirror validation outcomes into the same observation
   and reconciliation pipeline.
5. Backfill existing `listings` data into the new observation model and rebuild
   canonical listing rows from it.
6. Move property listing reads, materialized views, and dependent downstream
   reads onto the canonical reconciled model.
7. Rewrite replay / re-seed flows so bulk imports converge through the same
   reconciliation rules as live ingest.
8. Retire the old direct-write assumptions once canonical reads, replay, and
   mirror follow-up visibility are stable.

## Contract And UI Implications

- `POST /listings/preview` must evolve from `addressMatch + warning` into a
  contract that clearly distinguishes valid, invalid, and provisional outcomes.
- `POST /listings/submit` must repeat server-side validation rather than
  trusting preview-time client state.
- The Add Listing UI must disable or remove confirmation for confirmed address
  mismatches instead of showing only a warning.
- OpenAPI outputs, `@huishype/api-client`, MSW handlers, frontend tests, API
  integration tests, and any worker tests that depend on listing contracts must
  be updated in the same implementation.

## Replay And Migration Notes

- Existing rows in `listings` are legacy data, not a clean canonical layer.
- Migration work must specify how legacy rows map into observations,
  canonical listings, and follow-up state.
- Materialized views or feed-support structures that currently read directly
  from `listings` must either be rebuilt from the canonical model or replaced.
- Source URL normalization upgrades may require data migration so old rows do
  not conflict with new canonicalization rules.

## Validation

- Concrete validation fixtures to test against:
  - Funda sale canonical:
    `https://www.funda.nl/detail/koop/eindhoven/huis-beeldbuisring-61/89779872/`
  - Funda sale shared:
    `https://www.funda.nl/detail/89779872?utm_source=funda&utm_medium=web&utm_campaign=share-listing-modal`
  - Funda sale ID-only:
    `https://www.funda.nl/detail/89779872`
  - Funda rent canonical:
    `https://www.funda.nl/detail/huur/eindhoven/appartement-machinekamerplein-32-327/89772524/`
  - Funda rent shared:
    `https://www.funda.nl/detail/89772524?utm_source=funda&utm_medium=web&utm_campaign=share-listing-modal`
  - Funda rent ID-only:
    `https://www.funda.nl/detail/89772524`
  - Pararius canonical:
    `https://www.pararius.com/apartment-for-rent/eindhoven/87a48057/kathodelaan`
- Supported Funda canonical URLs, shared URLs, ID-only URLs, and supported
  Pararius listing URLs resolve as the same listing when they refer to the same
  marketplace record.
- The three Funda sale fixtures above resolve to one stable listing identity.
- The three Funda rent fixtures above resolve to one stable listing identity.
- The Pararius fixture above is accepted as a supported listing URL and follows
  the same preview / submit validity rules.
- A valid listing URL no longer fails only because OG title extraction was weak
  or absent.
- A listing that points to the wrong property cannot be confirmed or submitted.
- A user-added listing creates a mirror follow-up candidate automatically.
- Mirror validation results are visible and explain why a listing is pending,
  matched, blocked, invalid, or not found.
- A later mirror replay preserves user-originated listings and converges on the
  same canonical listing outcome as live sync.
- A user-added listing appears immediately without waiting for mirror
  validation.
- The same listing later becomes mirror-backed without duplicating.
- Mirror lifecycle updates change canonical status correctly.
- Re-seeding mirror data does not remove user-added listings.
- Canonical reads stay stable while provenance remains explicit.
- Legacy replay and live ingest converge on the same canonical outcome for the
  same mirror evidence.
- Property listing reads and downstream materialized views no longer depend on
  raw direct writes to the old `listings` shape.
- Generated API clients, mocks, and contract-sensitive tests are updated with
  the new preview / submit semantics.
- Run the repo test gate before landing the implementation: `pnpm test`.
