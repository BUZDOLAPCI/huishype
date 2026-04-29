# Martin-Centered Map Serving Migration

Date: 2026-04-29
Status: Revised pre-launch migration plan after codebase/Martin review

## Goal

Move HuisHype map serving to a Martin-centered architecture in one complete
pre-launch migration.

The app has not launched and there is no user data that must be preserved. The
migration should therefore optimize for the clean final architecture, not for
online dual writes, incremental compatibility with the current Fastify tile
routes, or preserving a partially migrated production state. It is acceptable to
stop services, rebuild projections, drop/reseed source tables when that is the
most reproducible path, and delete old tile-serving code once parity is proven.
Use destructive reset deliberately for schema/import changes or clean
reproducibility, and document the exact command sequence needed to recreate the
same state.

Final outcome:

- Martin is the only service that generates vector-tile bytes.
- A first-class tile gateway/proxy validates private tile-session tokens,
  strips spoofable trusted parameters, injects server-trusted viewer/session
  parameters, and streams Martin responses. This gateway is implemented as
  Fastify API-process proxy routes in this migration, but it must not generate
  or assemble MVT bytes.
- Low-zoom property nodes are generated from indexed map-serving projections,
  not broad scans of `properties`.
- Buildings, trees, public property nodes, read overlays, following nodes,
  styles, sprites, fonts, and base tile archives are served through Martin.
- Fastify remains the product control plane for authentication, writes, preview
  and detail APIs, geocoding, search, tile-session issuance, and health checks.
- Web and native use one explicit app-facing MapLibre tile contract.
- Normal map usage cannot execute the old broad `property-grouping.ts` low-zoom
  SQL path.
- The cutover closes all compatibility and operations gaps in this document.
  Nothing in this plan is intentionally deferred past the migration.

## Why This Direction

Martin is a good data-plane fit because it serves vector tiles from PostGIS
tables/functions, PMTiles/MBTiles sources, TileJSON, styles, sprites, fonts, and
cached map resources.

Martin does not make bad SQL fast. The cold benchmark at
`@52.1789115,5.7257405,7.25z` exposed the real failure mode: wide low-zoom tile
requests can scan/materialize a broad active-property candidate set before
narrowing it to listing/social-eligible rows, spill to disk, and keep Postgres
busy after the browser no longer needs the tile. Quiet address rows are usually
not emitted at low/mid zoom unless they become listing/social eligible, but the
current `bounded_properties` path is still too broad for the map-serving hot
path. Moving that same query behind Martin would keep the bottleneck.

The migration therefore has two equally important parts:

1. Build compact map-serving projections that contain exactly the rows and
   fields needed for map display.
2. Serve those projections through Martin using explicit PostGIS tile functions
   and a stable app-facing contract.

## Non-Negotiables

- This is a complete pre-launch cutover; the initial migration is bulk
  rebuild-first, not online dual-write-first. Destructive drop/reseed is allowed
  and may be preferred when it produces a cleaner reproducible source state than
  elaborate backfills.
- Public low-zoom tiles never read broad quiet-address candidate sets.
- Public low/mid zoom starts from all non-ghost map objects: active listings,
  completed/listing-history objects matching map filters, and socially active
  properties. Quiet/ghost address coverage remains a separate high-zoom path.
- Quiet address coverage remains high-zoom only.
- Martin config uses explicit source definitions; production auto-discovery is
  disabled.
- Martin connects to Postgres through a read-only tile role with statement
  timeouts.
- Private tile functions never trust client-supplied viewer ids or versions.
- Private Martin routes are never exposed directly to clients before a trusted
  gateway/proxy is in place. Header-authenticated MapLibre requests are replaced
  by signed URL tile sessions during this migration.
- App-facing source ids, source-layer names, promoted ids, and feature aliases
  are explicit and tested.
- Old Fastify tile-generation routes are removed from normal app usage and
  deleted after parity tests pass. Fastify may only stream Martin responses
  through the new gateway routes.
- Current read/following semantics and current source/layer/promote-id
  contracts are preserved unless this plan explicitly replaces them and adds the
  matching web, native, API, and test changes in the same cutover.
- The migration may replace current radius-based public grouping with
  deterministic bucket grouping for non-ghost public map objects. That is an
  accepted product/implementation change only if ghost nodes remain separate,
  counts/bounds/representatives are deterministic, and web/native/API tests are
  updated to assert the new behavior.
- The final gate is `pnpm test` plus map-specific Martin, web, and mobile
  verification.

Web is the first launch target, but this sprint plan has no native-only
deferrals. The migration is not complete until the final web/native tile
contract, loaded-style behavior, and map smoke coverage all pass.

## Final Service Boundaries

Martin owns tile/resource data-plane endpoints using Martin-native route shapes.
With `route_prefix: /tiles`, tile source ids are single path segments. The
public app-facing proxy preserves `/tiles` end-to-end; it does not strip this
prefix before forwarding to Martin. Because the prefix is preserved, Martin
`base_path` is also `/tiles` so TileJSON emits the same public route shape.

- `/tiles/public_property_nodes` TileJSON
- `/tiles/public_property_nodes/{z}/{x}/{y}` tiles
- `/tiles/private_read_property_nodes/{z}/{x}/{y}` private tiles
- `/tiles/private_following_property_nodes/{z}/{x}/{y}` private tiles
- `/tiles/buildings/{z}/{x}/{y}` tiles
- `/tiles/trees/{z}/{x}/{y}` tiles
- `/tiles/style/huishype` style
- `/tiles/style/huishype-native` native-expanded style, if served directly
- `/tiles/sprite/huishype.{json,png}` and `/tiles/sprite/huishype@2x.{json,png}`
- `/tiles/sdf_sprite/huishype.{json,png}` when SDF icons are needed
- `/tiles/font/{fontstack}/{range}` glyph ranges
- `/tiles/catalog`, `/tiles/health`, and `/tiles/_/metrics`

This migration chooses prefix preservation. Do not implement a prefix-stripping
proxy in this sprint unless the plan is updated in the same change with the
matching `base_path`, deployment, and startup smoke-test changes.

Martin serves extensionless tile routes. `.pbf` tile URLs work through redirects,
but they add avoidable 301s and must not be used by the final app contract.
Martin also exposes unprefixed `/health` alongside `/tiles/health`; product
readiness should use the proxied/prefixed path and aggregate checks described
below. This is a real app-facing URL-shape change, not a Martin config-only
change: update shared URL builders, app source helpers, MSW mocks,
OpenAPI/client expectations, and web/native tests in the same cutover.

Private routes require an app-facing gateway in front of Martin. The gateway
owns token verification and trusted query-param injection; Martin remains
internal and only receives sanitized requests. The gateway must:

- validate the signed tile-session token and audience
- reject missing, malformed, expired, mismatched, and replayed/stale tokens
  according to the final token rules
- strip all client-supplied trusted params such as `viewer_id`,
  `anonymous_session_id`, `read_version`, and `follow_version`
- append trusted params when proxying to Martin over the internal network
- preserve public filter params only after canonical normalization
- set private no-store cache headers unless versioned private caching is fully
  implemented
- stream Martin bytes without decoding, rebuilding, or re-encoding MVT

The gateway is implemented as API routes that proxy to the internal Martin
service. Wire those routes locally, in tests, and in production. Do not rely on
Coolify/Traefik labels alone for private tile authorization; current deployment
has no programmable path verifier.

Fastify owns:

- authentication and sessions
- writes for listings, comments, reactions, guesses, views, follows, and read
  state
- projection rebuild orchestration and post-cutover maintenance
- property preview, detail, batch, search, and geocoding APIs
- `/properties/nearby` and `/properties/following-nearby`
- OpenAPI contracts and generated clients
- private tile-session issuance
- health checks that verify Martin, Postgres, Redis, and projection freshness
- tile-gateway routes that validate/proxy only and must not import old tile
  builders or call `ST_AsMVT`

`/properties/nearby` and `/properties/following-nearby` stay Fastify APIs
because native tap fallback needs typed product responses, but they must be
rewritten to use the same projection-backed grouping logic as Martin. They must
not call the old broad low-zoom grouping path.

## Client Tile Contract

The cutover preserves the existing app-facing MapLibre contract. Any contract
break must be handled inside this migration by updating every affected
web/native caller, parser, style, mock, and test.

App-facing source ids remain:

- `properties-source`
- `read-properties-source`
- `tree-source`
- `buildings-source`

App-facing MVT source-layer names remain:

- `properties` for public property nodes, read overlays, and following nodes
- `scattered-trees` for tree sprites
- `buildings` for 3D building extrusions

Public and following map modes both render through `properties-source`.
Following mode replaces the `properties-source` tile template with the
authorized following template. Do not introduce a separate following source in
this migration unless all queryable-layer and interaction code is migrated in
the same cutover.

Read state remains an overlay source named `read-properties-source` whose MVT
source-layer is also `properties`. Web may continue using the read overlay for
feature-state probing; native may render the overlay directly.

Private read/following tile access changes from the current header-authenticated
TileJSON/tile request model to signed URL tile sessions. Current web
`transformRequest` and native `NetworkManager.addRequestHeader` paths are
removed for Martin private tiles unless they are still needed for unrelated
non-Martin resources. The app fetches a Fastify tile session, receives stable
and cache-busted private templates, and uses only the signed token/template
contract for private Martin routes. MSW mocks, generated clients, source
helpers, and web/native tests must be updated to this new contract.

Property MVT features keep `primary_property_id` as the promoted feature id.
Aggregated buckets also emit `bucket_key`, but `bucket_key` is not a replacement
for `primary_property_id` in this cutover.

Public property MVT payloads stay intentionally thin. They emit the fields
needed by styles, grouping/tap parsing, preview seeding, read overlays, and
following mode. Full address and metadata fields are hydrated through Fastify
preview/detail/batch APIs unless a specific style or interaction test proves a
field must be in the tile.

The current frontend normalizer does not parse `completedListingCount` even
though backend tile/grouping code emits it and this plan keeps it as a core MVT
field. This migration must add `completedListingCount` to the web/native decoded
feature normalizers, shared types, and tests so the client cannot silently drop
it.

Every public, read, and following property feature must preserve the current
MVT contract shape. Coordinates are carried by the MVT geometry; `lon` and
`lat` are transport-only inputs in the current Fastify builder and are not MVT
properties. Do not add them as tile properties unless this migration
deliberately changes the decoded contract and updates every parser/test that
asserts property payload shape.

Every property feature must emit these core fields:

- `node_class`
- `group_kind`
- `primary_property_id`
- `point_count`
- `property_ids`
- `preview_property_ids`
- `bbox_west`
- `bbox_south`
- `bbox_east`
- `bbox_north`
- `activeListingCount`
- `completedListingCount`
- `socialCount`
- `recentSocialCount`
- `socialScoreTotal`
- `socialScoreMax`
- `recentSocialScoreTotal`
- `commentCount`

Single-property features may additionally emit these preview seed fields:

- `id`
- `askingPrice`
- `thumbnailUrl`
- `hasActiveListing`
- `marketState`
- `address`
- `city`

The tile function may add narrow fields such as `bucket_key` or
`dominantMarketState` if tests prove they are useful for interaction or
debugging. Do not add broad address/metadata aliases such as `streetName`,
`houseNumber`, `postalCode`, `countryCode`, `officialValuation`, `yearBuilt`, or
`floorAreaM2` to every public tile feature unless the client is deliberately
migrated to consume them from MVT and decoded-tile payload budgets still pass.

Fields meaningful only for single-property preview seeds, such as `id`,
`address`, `city`, `askingPrice`, `thumbnailUrl`, `hasActiveListing`, and
`marketState`, are single-feature fields. On aggregate features they may decode
as absent or `null`; tests must accept the exact representation produced by
`ST_AsMVT` rather than assuming JSON-style `null` fields survive encoding.
Private overlay fields, such as `isRead`, should stay out of public tiles unless
the read-overlay rendering path explicitly requires them. The decoded MVT
contract tests must lock this down per feature type.

`primary_property_id` must remain a string-valued MVT property because the app
uses it as `promoteId`. Do not rely on the PostGIS `ST_AsMVT` feature-id column
as a replacement for this property; feature ids have different type/support
constraints and do not satisfy the current MapLibre contract on their own.
The final loaded MapLibre style must also set `promoteId: "primary_property_id"`
on the property sources, either directly in the Martin-served style/expanded
TileJSON or through the existing client-side source mutation path.

All style fallback paths must preserve the same `promoteId`. The current native
minimal fallback style and web string-style fallback can bypass the normal source
mutation path; this migration must either remove those bypasses or add loaded
style tests proving fallback styles still include `promoteId` on
`properties-source` and `read-properties-source`. Read feature-state behavior is
not considered migrated until this is proven.

The intentionally thin public MVT payload is accepted only with a verified
preview hydration path. Grouped and single preview tests must prove the app can
hydrate rich address, metadata, listing image, and detail fields through
Fastify preview/detail/batch APIs when those fields are absent from tile
features. Do not delete broad tile fields until those tests are green.

## Canonical Map Projections

### `map_public_property_facts`

One row per non-ghost public map object. This projection includes every active
property that can appear at low/mid zoom because it has an active listing,
completed listing/history state relevant to filters, or public social activity
at or above the active threshold. It does not include quiet/ghost addresses.

Following and read overlays may join this projection for listing/price/display
facts, but they must not infer following eligibility from public eligibility.
Listing and price facts must be built from the canonical listing model/view
used by current property APIs, not from legacy `listings` rows, duplicated
inline listing CTEs, or an active-listing-only shortcut. If the current
canonical listing facts are expressed only inside existing query builders, first
factor that logic into a shared SQL view/helper that projections and product
APIs both consume. Public listing eligibility, active/completed counts, display
prices, and thumbnails must stay aligned with the canonical listing facts used
by previews and details.

Required columns:

- `property_id uuid primary key`
- `country_code varchar(2) not null`
- thin display fields for single-preview seeds: `address`, `city`
- `geom_4326 geometry(Point, 4326) not null`
- `geom_3857 geometry(Point, 3857) not null`
- `longitude double precision not null`
- `latitude double precision not null`
- `min_public_zoom smallint not null`
- `has_listing boolean not null`
- `has_active_listing boolean not null`
- `has_completed_listing boolean not null`
- `latest_listing_status text`
- `active_listing_id uuid`
- `latest_listing_id uuid`
- `listing_source varchar(50)`
- `market_state text not null`
- `active_asking_price bigint`
- `active_price_type varchar(10)`
- `sale_effective_price bigint`
- `rent_effective_price bigint`
- `thumbnail_url text`
- `top_level_comment_count integer not null`
- `reply_count integer not null`
- `property_like_count integer not null`
- `comment_like_count integer not null`
- `guess_count integer not null`
- `view_count integer not null`
- `unique_viewer_count integer not null`
- `recent_social_score double precision not null`
- `social_score double precision not null`
- `last_social_at timestamptz`
- `map_rank double precision not null`
- `source_updated_at timestamptz`
- `projection_updated_at timestamptz not null`

Required indexes:

- GiST on `geom_3857`
- btree on `(country_code, market_state)`
- partial btree on `(sale_effective_price) where sale_effective_price is not null`
- partial btree on `(rent_effective_price) where rent_effective_price is not null`
- partial btree on `(last_social_at) where social_score >= 0.75`
- btree on `map_rank desc`

Geometry migration requirements:

- Add Drizzle/custom geometry support for `geometry(Point, 3857)` and
  `geometry(MultiPolygon, 3857)` instead of hiding Web Mercator columns behind
  untyped raw SQL.
- For projection tables, bulk load `geom_3857` from source coordinates with
  `ST_Transform(geom_4326, 3857)` during the projection rebuild.
- For source tables such as `properties` and `osm_buildings`, either add stored
  generated/backfilled `geom_3857` columns or keep Web Mercator only in
  projections. The selected option must be represented in Drizzle migrations,
  import scripts, reset/reseed commands, and tests.
- If stored generated columns are used, verify Postgres/PostGIS supports the
  expression as immutable in the target runtime. If not, use explicit backfill
  and import-time maintenance.
- Add validation that `geom_4326` and `geom_3857` stay non-null and spatially
  equivalent within a small tolerance for sampled rows.

### `map_quiet_property_points`

One row per active quiet address that is not a non-ghost public map object.
Quiet addresses are high-zoom only and must never participate in public low/mid
zoom bucket scans.

Required columns:

- `property_id uuid primary key`
- `country_code varchar(2) not null`
- `geom_4326 geometry(Point, 4326) not null`
- `geom_3857 geometry(Point, 3857) not null`
- `longitude double precision not null`
- `latitude double precision not null`
- `address text`
- `city text`
- `min_zoom smallint not null`
- `projection_updated_at timestamptz not null`

Required indexes:

- GiST on `geom_3857`
- btree on `(country_code, min_zoom)`

The high-zoom quiet path may instead use `properties.geom_3857` plus a partial
index if benchmarks show a separate projection adds no benefit. The final
implementation still must prevent quiet rows from being scanned by public
low/mid zoom functions.

### `map_public_property_bucket_members`

Precomputed or generated bucket membership for low/mid zoom aggregation over
`map_public_property_facts` only. Do not create bucket rows for quiet addresses.
Precompute this table when benchmarks show it is faster than calculating bucket
keys on the fly over the compact fact table; otherwise implement it as an
optimized SQL expression/view inside the Martin function.

Fixed bucket grouping is an accepted replacement for the current radius-based
public grouping if ghost nodes remain separate and the new bucket behavior is
documented, tested, and visually accepted. It is not treated as parity with the
old `property-grouping.ts` clustering algorithm.

Required columns:

- `property_id uuid not null references map_public_property_facts(property_id)`
- `render_z smallint not null`
- `bucket_z smallint not null`
- `bucket_x integer not null`
- `bucket_y integer not null`
- `bucket_key text not null`
- `owner_x integer not null`
- `owner_y integer not null`
- `bucket_centroid_3857 geometry(Point, 3857)`
- primary key on `(property_id, render_z)`

Required indexes:

- btree on `(render_z, owner_x, owner_y)`
- btree on `(render_z, bucket_key)`

### `map_property_actor_activity`

Compact following-overlay facts, one row per actor/property with map-relevant
activity. Following tiles must join this projection, not raw `comments`,
`reactions`, `price_guesses`, or `property_views`.

Required columns:

- `actor_user_id uuid not null`
- `property_id uuid not null`
- `top_level_comment_count integer not null`
- `reply_count integer not null`
- `property_like_count integer not null`
- `guess_count integer not null`
- `recent_social_score double precision not null`
- `social_score double precision not null`
- `last_activity_at timestamptz`
- `projection_updated_at timestamptz not null`
- primary key on `(actor_user_id, property_id)`

Required indexes:

- btree on `(property_id, actor_user_id)`
- btree on `(actor_user_id, last_activity_at desc)`

### Read-State Facts

Read tiles are viewer-specific and must not be folded into
`map_public_property_facts` or `map_quiet_property_points`. Use the existing
read-state tables if they are already compact and indexed enough; otherwise add
a compact read projection keyed by viewer or anonymous session and property id.

Read overlay grouping must preserve current semantics: a grouped read feature is
emitted only when every member property in the group is read for the viewer or
anonymous session.

The plan must also add explicit read/follow invalidation state before private
tile caching is enabled. Current tables store per-property read/change state and
follow edges, but they do not provide viewer-level `read_version` or
`follow_version` values. The migration must therefore implement one of these
complete options:

1. Add durable viewer/session-level read and follow version tables updated by
   every read-state and follow/unfollow write, inject those verified versions in
   the private tile session, and include them in any private cache key.
2. Disable shared caching for private read/following tiles and rely on short
   token expiry until equivalent version state exists.

The final system may choose either option, but it must not assume unimplemented
`read_version` or `follow_version` fields exist.

### Tree Source

Serve trees through an optimized Martin PostGIS function. Prefer SQL generation
against indexed/projected `landcover` and `tall_buildings` data over fully
materializing every deterministic tree point, unless sizing proves materialized
points are smaller and faster.

The tree function or projection must preserve the current MVT contract,
including `tree_variant`, source-layer `scattered-trees`, zoom visibility, and
tall-building exclusion behavior. The migration must also move the current
script-created `landcover` and `tall_buildings` schemas into Drizzle migrations
or document them as explicit import prerequisites for every reset/test path.

Tree strategy requirements:

- deterministic seed inputs and documented density caps
- optimized Martin SQL function when it outperforms materialization
- no new tree import step unless the migration explicitly chooses to
  materialize `map_tree_points`; the current behavior generates deterministic
  candidates per tile and filters them with landcover and tall-building data
- chunked rebuild command with resumable progress output if materialized points
  are chosen
- validation for count by zoom/landcover class, tall-building exclusions,
  duplicate ids, geometry validity, and decoded tile feature counts
- rebuild or refresh triggered by landcover, tall-building, or tree-density
  source changes, not by ordinary property, listing, social, read, or follow
  writes

Required columns only if materializing `map_tree_points`:

- `tree_point_id bigint primary key`
- `geom_4326 geometry(Point, 4326) not null`
- `geom_3857 geometry(Point, 3857) not null`
- `tree_variant integer not null`
- `landcover_class text`
- `min_zoom smallint not null`
- `size_seed double precision not null`
- `rotation_seed double precision not null`
- `projection_updated_at timestamptz not null`

Required indexes:

- GiST on `geom_3857`
- btree on `(min_zoom)`
- btree on `(tree_variant)`

### Building Source

`osm_buildings` remains the canonical source table if it has the required
geometry and render fields. Because the app is pre-launch and imports can be
rerun, prefer improving the import/source model over adding request-time
workarounds.

Required building-source improvements:

- add or backfill `geom_3857 geometry(MultiPolygon, 3857)` and a GiST index
- add or backfill `effective_render_height real not null` using
  `GREATEST(3.02, render_height - render_min_height)`
- add `country_code varchar(2)` when available from import context, plus an
  index if country-filtered building tiles or validation uses it
- keep the Martin hot path free of per-row `ST_Transform` when benchmarks show
  Web Mercator storage is faster

Serve buildings through an optimized Martin function or table source. Use a
direct Martin table source only if it can emit the exact `buildings` source-layer,
feature id, render fields, zoom bounds, and performance profile without extra
SQL logic; otherwise use `martin_tiles.buildings`.

The emitted building tile contract keeps the property name `render_height`.
`effective_render_height` is an internal stored/source column only; the Martin
function or table-view must alias it back to `render_height` unless the style and
all loaded-style/render tests are deliberately changed in the same cutover.

## Pre-Launch Rebuild And Cutover

Initial migration sequence:

1. Stop API, worker, ingest, scraper/source-service sync, and scheduled imports
   before any schema or import step that can invalidate map projections.
2. Run Drizzle migrations for projection tables, source-table improvements,
   `martin_tiles` functions, read-only roles/grants, and any formerly
   script-created schemas that Martin will depend on.
3. Decide whether a destructive reset is required. Because there is no user data,
   prefer reset/reseed when source-table shape, generated geometry columns,
   import backfills, or validation cost make it the cleaner reproducible path.
   Use in-place migrations only when they produce the same state with less risk.
4. If reset/reseed is required, document and run the exact command sequence,
   including Overture country flags, listing seed, OSM buildings, landcover, tall
   buildings, and projection rebuilds. The command log must be enough for another
   agent to reproduce the same database state.
5. Seed/import or backfill source data as needed: properties, canonical listings,
   listing observations, price history, social fixtures/data, OSM buildings,
   landcover, tall buildings, and any generated map-serving columns.
6. Bulk rebuild all map projections from source tables.
7. Create indexes after bulk load where faster, then `ANALYZE` all source and
   projection tables.
8. Run projection validation: row counts by country/eligibility, deterministic
   checksums, null geometry checks, orphan checks, bucket/member checks, and
   sampled filter parity.
9. Start Martin against the read-only tile role and explicit config.
10. Run decoded MVT contract tests, Martin endpoint tests, benchmarks, web map
    checks, mobile map smoke checks, and `pnpm test`.
11. Start API/worker with post-cutover projection maintenance enabled.

Post-cutover writes update projections synchronously for low-volume product
writes and through worker jobs for bulk ingest/reconciliation. Rebuild commands
remain canonical and idempotent; write-through code is validated against rebuild
output.

Because this is pre-launch and there is no user data to preserve, the initial
cutover does not need online dual writes. It still must include post-cutover
maintenance before launch: every listing, listing-history, comment, reaction,
guess, view, follow, read-state, coordinate, address, and property metadata
write that can affect map tiles must update or enqueue the relevant
projection/version maintenance path.

Reset/backfill runbook requirements:

- Preferred path for this pre-launch migration is a clean destructive reset
  whenever source-table shape, generated map-serving columns, imported building
  fields, or projection semantics change. There is no user data to preserve, so
  reset/reseed is usually simpler and more reproducible than one-off backfills.
  Use the non-destructive path only when it produces the exact same source and
  projection state with less risk.
- Non-destructive path, when chosen: run migrations, run source-table backfills,
  rebuild projections, `ANALYZE`, then run validation.
- Destructive reset must drop every schema and database object this migration
  owns, not just `public` and `drizzle`. At minimum, update the reset path to
  drop/recreate `martin_tiles`, projection schemas if any, function comments,
  grants, read-only tile roles or role settings when safe in the local/test
  database, and any migration-managed landcover/tall-building schemas. Stale
  Martin functions from a previous reset are a release blocker.
- Because the app is pre-launch, destructive drop/reseed is acceptable and often
  preferable to elaborate one-off backfills when it gives a cleaner,
  reproducible source state. If destructive reset is required for
  reproducibility or import shape changes, the baseline current full reset
  command is:

```bash
cd /home/caslan/dev/git_repos/hh/huishype/services/api
pnpm run db:reset -- --with-overture
```

- Today this command is not sufficient for a pinned, reproducible full
  Overture reseed: `db:reset` does not forward Overture `--release` or `--local`
  flags, and it wraps child commands in a 60-minute timeout that may be too
  short for full Overture imports. Before relying on reset/reseed as the
  canonical migration path, update `db:reset` or replace it in the runbook with
  explicit child commands that pin the Overture release/local parquet path and
  use a timeout budget proven against the full country set.
- For a scoped available-source reset, the command must name the exact country
  set using commands that exist at the time of execution. Today `db:reset`
  forwards one `--country` value to multiple import scripts, and the OSM PBF
  parser accepts one country code or `all`. Do not document comma-separated
  reset countries until every forwarded script supports them. `db:seed-overture`
  itself accepts comma-separated countries, but forwarding the same value to OSM,
  landcover, and tall-building importers is unsafe until those parsers support
  comma lists consistently. A currently valid single-country reset example is:

```bash
cd /home/caslan/dev/git_repos/hh/huishype/services/api
pnpm run db:reset -- --with-overture --country NL
```

- For multiple available countries before comma-list support exists, either use
  the full available-source reset with no `--country` flag or first implement
  and test comma-list parsing consistently across `db:reset`, OSM building
  import, landcover import, tall-building import, Overture import, and any
  reset-time helper scripts. The runbook must not show
  `--country NL,DE,BE,FR,GB` as valid until that code exists.
- The migration must add the final projection rebuild command(s) and run them
  immediately after reset/backfill. The final runbook must record the exact
  command strings, country set, Overture release, local data paths when used,
  row counts, projection counts, and validation output. Do not mark the cutover
  complete with an undocumented reset variant.

## Filter Semantics

Projection rebuilds and Martin SQL must preserve current map filter semantics:

- Public map tiles and following map tiles have distinct activity semantics.
- Public social eligibility is computed from the public activity sources the
  current map considers visible: comments, replies, property likes, comment
  likes, guesses, and views. Do not replace this with a narrower
  followed-actor activity projection.
- Public map filters keep the existing public behavior: `activity=all` applies
  no social threshold to eligible public map objects, while recent activity
  filters require both `last_social_at` inside the selected window and
  `recent_social_score >= 0.75`.
- Following APIs currently default to `all-time`; legacy `activity=all` is
  normalized to `all-time` for following mode. Following tile sessions,
  following nearby APIs, OpenAPI schemas, generated clients, and tests must keep
  that behavior unless the same cutover deliberately changes all following
  callers and fixtures.
- Following tiles include only map-relevant activity from followed actors. They
  must not fall back to public listing eligibility or global public social
  eligibility when followed-actor activity is absent.
- Following social facts are intentionally narrower than public social facts and
  must be sourced from followed actors through `map_property_actor_activity` or
  an equivalent compact projection.
- `activity=all-time` requires `social_score >= 0.75` for both public and
  following activity-scoped views.
- Sale filters use `sale_effective_price`.
- Rent filters use `rent_effective_price`.
- Active listing display uses `active_asking_price` and `active_price_type`.
- Filters are applied before aggregation.
- Public low/mid zoom excludes quiet addresses even when `activity=all`.
- Quiet addresses become eligible only at their configured high zoom.
- Public default map visibility must still include listing-backed properties
  even without social activity when market filters make them eligible.
- Add parity tests for public filters and following filters separately; do not
  infer following behavior from public tile behavior.

## Martin PostGIS Functions

Create functions in a dedicated `martin_tiles` schema.

Use optimized Martin PostGIS functions whenever the layer needs filtering,
aggregation, security checks, geometry transformation avoidance, feature limits,
or compatibility field shaping. Use direct Martin table sources only for simple
static layers where table-source configuration can prove the same source-layer
name, fields, feature ids, zoom bounds, and performance. The default for
property nodes, read overlays, following nodes, and trees is a tuned function,
not generic auto-discovered table serving.

Required function signatures:

- `martin_tiles.property_nodes(z integer, x integer, y integer, query_params jsonb) returns bytea`
- `martin_tiles.read_property_nodes(z integer, x integer, y integer, query_params jsonb) returns bytea`
- `martin_tiles.following_property_nodes(z integer, x integer, y integer, query_params jsonb) returns bytea`
- `martin_tiles.trees(z integer, x integer, y integer, query_params jsonb) returns bytea`
- `martin_tiles.buildings(z integer, x integer, y integer, query_params jsonb) returns bytea`

Martin also accepts `json` for the fourth argument and permits the zoom argument
to be named `z` or `zoom`. Query values arrive as parsed JSON from URL query
parameters. Functions must cast defensively and provide defaults for missing
keys.

Function requirements:

- `SECURITY INVOKER`
- fixed `search_path`
- granted only to the Martin read-only tile role
- `STABLE STRICT PARALLEL SAFE` when valid for the function body
- bbox predicates against indexed `geom_3857` where available
- no per-row `ST_Transform` on hot paths when a source/projection can store
  Web Mercator geometry
- explicit zoom guards and SQL-side row/feature limits
- no reliance on Martin `max_feature_count` for custom function safety
- stable primitive MVT fields; encode sample/property id lists as comma-separated
  text unless native/web support for array MVT fields is verified
- explicit `ST_AsMVT(..., '<layer>', 4096, 'geom')` layer names, with
  `primary_property_id` emitted as an MVT property for MapLibre `promoteId`
- optional `ST_AsMVT` feature-id columns only when they are type-safe and proven
  compatible; they are additive and cannot replace `primary_property_id`

Decoded MVT tests are required infrastructure, not optional verification prose.
Add a shared test helper under `services/api/src/__tests__/helpers/` or `tools/`
using a maintained decoder such as `@mapbox/vector-tile` plus `pbf`, or an
equivalent dependency already accepted by the repo. Use that helper for SQL
function tests, Martin endpoint tests, and client contract fixtures. Existing
tests that only assert non-empty PBF payloads are not sufficient for this
migration.

App-facing MVT source-layer names:

- `properties` for public property nodes
- `properties` for read property overlay nodes
- `properties` for following property nodes
- `scattered-trees` for tree points
- `buildings` for building extrusions

The Martin source/function ids can be versioned internally, but MVT source-layer
names stay stable for MapLibre style and `queryRenderedFeatures` compatibility.

Function source metadata:

- Martin config supplies `minzoom`, `maxzoom`, `bounds`, and cache policy.
- SQL comments may supply TileJSON merge fields such as `vector_layers`,
  `attribution`, and optional `content_type`.
- `vector_layers[].id` must exactly match the layer name used in `ST_AsMVT`.

## Property Node Algorithm

For each property-node tile request:

1. Build `tile_bounds_3857 := ST_TileEnvelope(z, x, y)`.
2. For public low/mid zoom, select indexed rows from
   `map_public_property_facts`. This includes all non-ghost public map objects
   and excludes quiet addresses.
3. Apply country, market, scoped sale/rent price, listing, and activity filters
   before aggregation.
4. Join `map_public_property_bucket_members` for `render_z = z` when
   precomputed membership exists and benchmarks show it is faster than computing
   bucket keys inside the function. Otherwise compute the same deterministic
   bucket key in SQL from `geom_3857`.
5. Group by `bucket_key` for public aggregate zooms.
6. Choose the representative deterministically: social priority first, then
   active listing, completed listing, comment count, and property id
   tie-breakers. `map_rank` may encode this ordering. Bucket anchor coordinates
   are the group centroid or representative-near-centroid strategy chosen by the
   implementation and locked by tests.
7. Emit the group only from `(owner_x, owner_y) = (x, y)` to prevent duplicate
   buffered features.
8. At and above the single-node threshold, emit one feature per non-ghost public
   property from `map_public_property_facts`.
9. At high quiet zooms, query `map_quiet_property_points` or the indexed
   `properties.geom_3857` quiet path separately and emit ghost features. Ghosts
   never group with non-ghost public features.
10. Compute centroid, bbox, counts, dominant market state, max/sum scores,
   active/completed listing counts, and ordered sample ids inside SQL.

Initial bucket policy:

| Map Zoom | Bucket Precision |
| ---: | ---: |
| 0-7 | 9 |
| 8 | 10 |
| 9 | 11 |
| 10 | 12 |
| 11 | 13 |
| 12 | 14 |
| 13 | 15 |
| 14 | 16 |
| 15+ | single-node or density-aware local grouping |

The bucket policy is a starting point, not a hidden compatibility promise.
Benchmarks and visual tests decide the final thresholds. Because fixed buckets
are an accepted replacement for the current radius-based public grouping, tests
must assert the new behavior directly instead of claiming old grouping parity.

Changing representative choice, anchor coordinates, sample ordering, bucket
precision, or owner tile assignment changes visible previews and tap behavior.
Update web/native interaction tests, preview tests, and product expectations in
this migration rather than leaving the difference implicit.

The representative contract must define and test all fields it controls:
`primary_property_id`, feature coordinate, thumbnail/listing preview fields,
single-property fields that become `null` on clusters, `preview_property_ids`
ordering, large-bucket zoom-to-bounds, small-bucket grouped preview, and tap
fallback responses from `/properties/nearby` and
`/properties/following-nearby`.

## Private Tile Security

Martin does not authenticate requests. Private read and following tile routes
are protected by the tile gateway plus Fastify-issued tile sessions.

Flow:

1. App requests a tile session from Fastify.
2. Fastify validates the user/session and returns a short-lived signed token,
   expiry, stable tile templates, and cache-busted replacement templates.
3. App includes only the signed token on private Martin tile URLs.
4. The tile gateway validates the token, strips any client-supplied trusted
   parameters, and injects trusted internal parameters such as `viewer_id`,
   `anonymous_session_id`, and, if implemented, verified `read_version` and
   `follow_version`.
5. Martin forwards those parameters into SQL as `query_params`.
6. SQL functions filter through compact indexed relationship/projection tables.

Rules:

- Public tiles need no session.
- Following tiles require an authenticated tile session.
- Read tile-session issuance supports either an authenticated user or anonymous
  `x-session-id`; the resulting Martin tile URL still uses the signed token
  template, not raw `x-session-id` tile headers.
- Clients never send `viewer_id`.
- Clients never send trusted read/follow versions; versions are derived by
  Fastify or the tile gateway from server-side state.
- Private tile responses bypass shared CDN/proxy caching, or the cache key must
  include verified viewer identity plus read/follow versions.
- Read/follow versions must be created as part of this migration if any shared
  private caching depends on them. The current schema does not already provide
  viewer/session-level versions.
- The first production-safe implementation should disable shared/private Martin
  caching unless viewer/session identity and read/follow versions are injected
  by the gateway and included in the cache key. Do not rely on request headers
  for Martin cache isolation; Martin's source cache only distinguishes URL query
  strings and source ids.
- Public filter query params are normalized to prevent unnecessary cache
  fragmentation.
- Token tests cover missing, malformed, expired, spoofed, and valid tokens.
- Private cache tests cover read-state changes, follow/unfollow changes, token
  renewal, anonymous-session read overlays, and cache-key isolation between two
  viewers.
- URL/source detection for cache reset must not rely on the legacy substring
  `"/following/"`; it must identify the configured following source/template
  explicitly so renamed Martin sources such as
  `/tiles/private_following_property_nodes/...` still trigger the correct
  invalidation and source replacement.
- Tile-session responses must describe stable templates and cache-busted
  replacement templates for read and following overlays. App code keeps the
  previous visible tiles while a token/filter refresh is pending, but switches
  to the new trusted template as soon as the session refresh succeeds.

## Martin Configuration

Add Martin to local and production deployment. Production Martin is
internal-only behind the public reverse proxy; port `3111` is not exposed
directly.

Configuration requirements:

- `route_prefix: /tiles`
- `base_path: /tiles` because this migration preserves `/tiles` through the
  public proxy; no prefix-stripping proxy is part of the final cutover
- checked-in config path is `martin/config.yaml`; local, test, and production
  deployment docs define the exact container mount path for that file and all
  asset directories
- explicit `postgres.functions` entries
- `auto_publish: false`
- `auto_bounds: skip`
- read-only `MARTIN_DATABASE_URL`
- bounded Postgres pool size
- tile cache sized deliberately
- metrics labels configured
- style, sprite, font, PMTiles, and MBTiles paths mounted read-only
- private Martin source cache disabled, or made viewer/version-specific through
  gateway-injected query params that are included in Martin's URL query cache key
- source names for PMTiles/MBTiles are stable and documented; production mount
  layout distinguishes read-only style/assets from generated cache/state
- base tile archive source ids, file/remote paths, and mount locations are
  explicit. Completion requires the final Martin-served base archive; leaving
  OpenFreeMap or another external base source in the final app contract is a
  plan violation.
- Fastify aggregate health checks Martin reachability, Postgres/Redis health,
  projection freshness, and required style/sprite/font/base-tile resources.
  Martin's own `/tiles/health` endpoint is only a shallow service health check
  and is not sufficient as the product readiness check.
- Martin config validation includes schema validation and a log gate that fails
  deployment when Martin logs ignored or unrecognized configuration keys.
- health/readiness checks include catalog/source availability, representative
  public/private tile fetches, and verification that Martin uses the read-only
  database role with the configured statement timeout.
- Startup smoke tests are required because Martin config validation and log
  checks can miss typo classes. The smoke suite must fetch `/tiles/catalog`,
  TileJSON for every configured dynamic source, `/tiles/style/huishype`, sprite
  JSON and PNG, SDF sprite resources if configured, a glyph/font range, and at
  least one real vector tile for public properties, buildings, trees, read
  overlay, and following overlay.

Representative config sketch:

```yaml
listen_addresses: "0.0.0.0:3111"
route_prefix: /tiles
base_path: /tiles
preferred_encoding: gzip
web_ui: disable

cache:
  size_mb: 512
  tile_size_mb: 384
  expiry: 10m
  tile_expiry: 5m
  minzoom: 0
  maxzoom: 16

observability:
  metrics:
    add_labels:
      service: martin
      app: huishype

postgres:
  connection_string: ${MARTIN_DATABASE_URL}
  default_srid: 4326
  pool_size: 10
  auto_publish: false
  auto_bounds: skip
  functions:
    public_property_nodes:
      schema: martin_tiles
      function: property_nodes
      minzoom: 0
      maxzoom: 22
      bounds: [-180, -85.0511, 180, 85.0511]
      cache: { minzoom: 0, maxzoom: 14 }
    private_read_property_nodes:
      schema: martin_tiles
      function: read_property_nodes
      minzoom: 0
      maxzoom: 22
      bounds: [-180, -85.0511, 180, 85.0511]
      cache: disable
    private_following_property_nodes:
      schema: martin_tiles
      function: following_property_nodes
      minzoom: 0
      maxzoom: 22
      bounds: [-180, -85.0511, 180, 85.0511]
      cache: disable
    trees:
      schema: martin_tiles
      function: trees
      minzoom: 15
      maxzoom: 17
      bounds: [-180, -85.0511, 180, 85.0511]
    buildings:
      schema: martin_tiles
      function: buildings
      minzoom: 14
      maxzoom: 17
      bounds: [-180, -85.0511, 180, 85.0511]

styles:
  sources:
    huishype: /config/styles/huishype.json
    huishype-native: /config/styles/huishype-native.json
sprites:
  sources:
    huishype: /config/sprites/huishype
fonts:
  sources:
    app-fonts: /config/fonts
pmtiles:
  sources:
    base:
      path: /data/tiles/base.pmtiles
```

Validate `martin/config.yaml` against
`/home/caslan/dev/git_repos/martin/schemas/config.json`, then start Martin in a
validation mode or test container and fail on startup warnings such as ignored
configuration keys. Schema validation alone is not enough because Martin may
ignore some unknown keys at runtime; schema/log validation is necessary but not
sufficient without the endpoint smoke tests above.

PMTiles/MBTiles rules:

- PMTiles may be local or remote HTTP/S3/GCS/Azure.
- Remote PMTiles may be configured as explicit named sources or through
  supported `pmtiles.paths`, but production should use explicit names for stable
  source ids. Remote directory autodiscovery and hot reload are not supported.
- MBTiles are local SQLite files.
- `mbtiles.paths` directories support hot reload; named `mbtiles.sources` are
  snapshotted at startup.

Martin metrics at `/tiles/_/metrics` include HTTP duration and cache counters.
They do not provide per-SQL timing, query plans, or decoded feature counts; those
belong in benchmark tooling with `pg_stat_statements`, `EXPLAIN (ANALYZE,
BUFFERS)`, response byte capture, and decoded MVT inspection.

Martin does not expose a `statement_timeout` config key. Implement the timeout
with a database role/database setting, for example `ALTER ROLE martin_tile
SET statement_timeout = '2s'`, or with a verified connection-string
`options=-c statement_timeout=...` value. Readiness tests must fetch a diagnostic
query or tile-path assertion proving `current_user` is the read-only tile role
and `SHOW statement_timeout` returns the configured value.

## Style And Asset Ownership

Move map style ownership out of Fastify route code.

Styles are served by Martin as `/tiles/style/{style_id}`. MapLibre style JSON
uses Martin-native resource templates:

- `"sprite": "/tiles/sprite/huishype"` or `"/tiles/sdf_sprite/huishype"`
- `"glyphs": "/tiles/font/{fontstack}/{range}"`
- vector source TileJSON URLs such as `"/tiles/public_property_nodes"` for web
  style variants

Do not use `/fonts/...` or glyph `.pbf` suffixes unless a proxy explicitly
normalizes them. Martin serves style JSON as stored and does not rewrite
sprite, SDF sprite, glyph, or TileJSON URLs; checked-in style JSON must therefore
contain the final `/tiles/sprite`, `/tiles/sdf_sprite`, and `/tiles/font`
resource URLs before deployment.

Platform loading rules:

- The app currently hardcodes `/tiles/style.json` on web and
  `/tiles/style.json?platform=native` for native. Switching to
  `/tiles/style/huishype` and `/tiles/style/huishype-native` requires explicit
  app, mock, and test changes, or deliberate compatibility aliases at the proxy
  or Fastify layer during the cutover. Do not assume Martin style routes are
  consumed automatically just because Martin serves them.
- Web may fetch a Martin-served style JSON, but the current app must still apply
  its client-side source mutations before map construction: replace
  `properties-source` tile templates when filters/following mode change, inject
  `read-properties-source`, preserve read feature-state styling, and keep
  `transformRequest` behavior only where private tile/session auth still needs
  it.
- Native must receive a style object whose vector sources contain inline `tiles`
  arrays. Do not rely on native resolving TileJSON `url` references inside style
  sources.
- If Martin serves TileJSON-backed sources, the native style variant or client
  loader must expand them before passing the style to
  `@maplibre/maplibre-react-native`.
- The native style variant must preserve existing native workarounds: flattened
  unsupported zoom expressions, self-hosted glyph/sprite URLs, property source
  tile replacement, and read overlay injection.
- Martin serves font ranges from font files/directories, not from the current
  Fastify pre-generated `/fonts/{fontstack}/{range}.pbf` directory shape. Move or
  add source font files into `martin/fonts/`, update glyph URLs to
  `/tiles/font/{fontstack}/{range}`, and verify a real glyph range response.
- Preserve the current read-overlay platform split unless the same cutover
  proves and implements a replacement: web uses cache-busted read tile URLs for
  refreshes, while native keeps a stable read tile URL and reloads the source via
  style/source mutation. Do not flatten both platforms into one cache-reset
  strategy accidentally.
- Web/native parity tests must assert the final loaded style, not only the
  static Martin style file: source ids, `promoteId`, tile templates, read overlay
  source, following replacement behavior, glyph/sprite URLs, and absence of
  `.pbf` tile redirects.
- Loaded-style tests must assert `buildings-source` uses MVT source-layer
  `buildings` and that the 3D building layer reads the emitted `render_height`
  field. Current visual tests that only assert a `3d-buildings` layer exists are
  insufficient.

## Fastify Tile Route Removal

Fastify stops generating MVT bytes in normal app usage.

Remove normal usage of:

- `/tiles/properties/:z/:x/:y.pbf`
- `/tiles/properties/read/:z/:x/:y.pbf`
- `/tiles/following/properties/:z/:x/:y.pbf`
- `/tiles/trees/:z/:x/:y.pbf`
- `/tiles/buildings/:z/:x/:y.pbf`
- `/tiles/style.json`

After Martin parity tests pass, delete the old Node tile builders and route
registrations. Tests must prove app network traces contain no requests to old
Fastify tile-generation endpoints and no extension-based Martin redirects.

Keep only the new gateway/proxy routes for private and/or public Martin
forwarding. These routes must not import `property-grouping.ts`, tree builders,
building SQL builders, or any Node-side MVT generation helper. A grep/static
test must prove old tile builders are unreachable from normal app usage.

Keep Fastify APIs for previews, details, search, geocoding, writes, nearby tap
fallback, following nearby tap fallback, and tile sessions.

## Serialized Implementation Phases

The migration is implemented in serialized phases. Each phase closes its own
gaps before the next phase depends on it. No gap is intentionally deferred past
the migration; if an auxiliary system blocks the final contract, include it in
the relevant phase.

### Phase 1: Foundations

- Add Martin to local Docker Compose and production deployment config.
- Add `martin/config.yaml` with explicit source definitions and no production
  auto-discovery.
- Implement the concrete tile gateway/proxy architecture as Fastify API-process
  proxy routes. Wire it locally, in tests, and in production before any private
  Martin tile route is exposed.
- Ensure the public proxy preserves `/tiles` end-to-end and prove TileJSON URL
  generation through smoke tests.
- Add read-only Postgres tile role, grants, statement timeout, and tests proving
  Martin uses that role. Implement statement timeout through role/database
  settings or connection-string `options`, not a nonexistent Martin config key.
- Add reverse-proxy/gateway routes for public/private Martin paths. Private
  paths must validate signed tile-session tokens, strip trusted params, inject
  server-derived viewer/session params, and set private no-store headers.
- Add shallow Martin health checks for `/tiles/health`.
- Add Fastify aggregate readiness checks for Martin, Postgres, Redis,
  projection freshness, and required map resources.
- Add metrics scraping for `/tiles/_/metrics`.
- Validate config against Martin schema and fail deployment on ignored-key
  startup warnings.
- Add Martin startup smoke tests for catalog, TileJSON, style, sprite, SDF
  sprite when configured, font/glyph range, and real public/private/sample
  vector tiles.
- Keep the old Fastify tile routes available only as an implementation fallback
  until Martin parity, benchmark, and app tests pass.

### Phase 2: Source Schema And Imports

- Add migrations for map projections, source-table improvements, and any
  currently script-created table schemas that Martin functions depend on.
- Add Drizzle/custom geometry support and migration/backfill/import behavior for
  `geometry(Point, 3857)` and `geometry(MultiPolygon, 3857)` where selected.
- Improve `osm_buildings` import/backfill with `geom_3857`,
  `effective_render_height`, and country/index fields when available. Preserve
  emitted tile field `render_height` through a function/view alias.
- Make `landcover` and `tall_buildings` either migration-managed or explicitly
  required by reset/import test fixtures.
- Add or backfill Web Mercator geometry for property map-serving paths where
  benchmarks show it is faster than request-time transforms.
- Factor canonical listing facts into a shared view/helper if needed so
  projections and existing product APIs consume the same listing eligibility,
  count, price, and thumbnail logic.
- Document the exact non-destructive backfill path.
- Document the exact destructive reset path if required, including
  a pinned Overture release or local parquet path, timeout budget, listing seed,
  OSM buildings, landcover, tall buildings, and projection rebuild. Do not rely
  on current `db:reset --with-overture` alone until it forwards Overture
  `--release`/`--local` and has a proven timeout for the selected import scope.
- Update destructive reset to drop/recreate `martin_tiles`, grants/role settings,
  and any migration-owned auxiliary schemas so stale functions cannot survive a
  reset.

### Phase 3: Map Projections

- Add `map_public_property_facts` for all non-ghost public map objects.
- Add `map_quiet_property_points` or a proven equivalent indexed quiet path.
- Add `map_public_property_bucket_members` only if benchmarks beat on-the-fly
  bucket key calculation over `map_public_property_facts`.
- Add `map_property_actor_activity` for following tiles.
- Add compact read projection only if existing read-state tables are not indexed
  enough for private read tiles.
- Add projection rebuild commands and validation output: counts, checksums,
  freshness, null geometry, orphan checks, bucket/member checks, and sampled
  filter parity.
- Add post-cutover projection maintenance for listing, listing-history, social,
  read, follow, view, coordinate, address, and property metadata writes.
- Add viewer/session read-version or follow-version tables only if shared
  private caching is implemented. Otherwise, explicitly configure and test
  no-shared-cache private tiles.

### Phase 4: Martin SQL Tile Functions

- Add `martin_tiles` schema.
- Implement optimized public property-node MVT function over
  `map_public_property_facts` and the selected bucket strategy.
- Implement high-zoom quiet/ghost emission as a separate path inside the public
  property function or as a dedicated helper that never mixes ghosts with
  non-ghost buckets.
- Implement read overlay MVT function.
- Implement following MVT function over `map_property_actor_activity`.
- Implement tree MVT function using the chosen optimized SQL/materialization
  strategy.
- Implement building MVT function or proven table source.
- Add SQL comments/config metadata for vector layers, attribution, content type,
  and TileJSON fields.
- Add decoded MVT test helper/dependency and use it for all property, read,
  following, tree, and building tile contract assertions.
- Add database-level tests for filters, buckets, owner-tile dedupe, bounds,
  feature properties, private viewer behavior, and no broad quiet scans.
- Add decoded MVT tests for the intentionally thin field contract.

### Phase 5: Martin Style And Resources

- Move checked-in style sources to Martin-served files.
- Convert or relocate sprites/fonts into Martin-compatible asset directories.
- Add or mount final base PMTiles/MBTiles archives with explicit source ids and
  read-only paths; do not leave the base map on an external provider at
  completion.
- Add `huishype` web style and native-expanded style handling.
- Preserve source ids, source-layer names, render layer ids, and `promoteId`.
- Remove or fix web/native fallback style paths that can omit `promoteId`.
- Add loaded-style assertions for `buildings-source`, source-layer `buildings`,
  and emitted `render_height`.
- Ensure TileJSON version/shape differences from Fastify are reflected in
  tests, clients, and mocks, or add a compatibility facade deliberately.
- Delete Node-side style assembly only after app tests consume Martin styles.

### Phase 6: Fastify Control Plane

- Add tile-session endpoint and OpenAPI schemas.
- Add token signing, expiry, audience binding, gateway validation contract,
  trusted-param injection contract, and no-shared-cache or versioned-cache
  behavior.
- Update generated clients and MSW mocks.
- Reimplement `/properties/nearby` and `/properties/following-nearby` against
  projection-backed grouping and bucket semantics.
- Preserve public-vs-following activity normalization in API schemas, tile
  sessions, nearby endpoints, and generated clients.
- Remove OpenAPI tile-byte routes generated from Fastify after app usage moves
  to Martin.

### Phase 7: App Integration

- Point public map sources to Martin tile templates.
- Replace header-authenticated private TileJSON/tile requests with signed
  private tile-session handling for read and following overlays.
- Keep previous tiles visible while token/filter refresh is pending; tests must
  prove the app does not temporarily replace `properties-source` with an empty
  tile array during following/read session refresh.
- Normalize filter query serialization for cache stability.
- Update following/read source detection and reset logic so it keys off explicit
  source/template identity instead of legacy URL substrings such as
  `"/following/"`.
- Preserve web `transformRequest` and native NetworkManager scoped auth behavior
  only where still required.
- Update feature parsing for the intentionally thin Martin-emitted fields.
- Parse `completedListingCount` in the frontend normalizer and lock it in shared
  types/tests.
- Update preview hydration for grouped sample ids through existing preview/detail
  APIs rather than bloating public MVT payloads. Prove grouped and single
  previews still render rich fields when tile features are thin.
- Update source/layer/URL shape tests.
- Update web/native loaded-style tests to verify runtime mutations after Martin
  style fetch, including source ids, source-layer ids, render layer ids,
  `promoteId`, rendered properties/following/read overlays/buildings/trees, and
  the web-vs-native read overlay refresh behavior.

### Phase 8: Removal, Performance, And Regression Closure

- Remove Fastify MVT generation from normal map usage.
- Delete obsolete Node tile builders and old route tests after Martin and app
  parity tests pass.
- Benchmark the original wide-load route:
  `@52.1789115,5.7257405,7.25z`.
- Benchmark public nodes, read tiles, following tiles, trees, buildings, style
  load, and private token refresh.
- Capture cold/warm latency, response bytes, decoded feature counts, cache
  hit/miss, Postgres query plans, buffer usage, and statement-timeout behavior.
- Enable `pg_stat_statements` for tile query analysis.
- Add alerts/checks for slow tile functions and stale projections.
- Add private-cache isolation benchmarks/tests for viewer A vs viewer B,
  read-state changes, follow changes, token renewal, and anonymous read state.
- Run projection rebuild integration tests with suite-local fixtures.
- Run SQL function tests that decode PBFs and assert layer ids, feature ids,
  field names, buckets, filters, and private behavior.
- Run Martin endpoint tests for `/tiles/catalog`, `/tiles/health`, style,
  sprite, SDF sprite when configured, font, TileJSON, and sample tile endpoints.
- Run no-301 tests for extensionless Martin tile URLs.
- Run loaded-style rendered-behavior tests for properties, following mode, read
  overlay, buildings, and trees on web and native.
- Run client unit tests, web map E2E wrappers, mobile Maestro map smoke tests,
  and `pnpm test`.

## Acceptance Criteria

Performance:

- Cold wide-map public node visible tile set completes locally under 500 ms
  browser network time on the seeded dataset.
- Cold public property-node tile p95 is under 150 ms locally.
- Warm public property-node tile p95 is under 40 ms locally.
- Individual public node tile payloads stay under 80 KB compressed.
- Visible wide-map public node payload stays under 300 KB compressed.
- No normal low-zoom map action can execute the old broad property grouping SQL.
- No public low/mid zoom tile function scans quiet/ghost address rows.

Correctness:

- Active listings appear at low zoom without requiring social activity.
- All non-ghost properties eligible by listing/history/social criteria are
  represented in `map_public_property_facts`.
- Socially active properties appear at low zoom without requiring active
  listings.
- Quiet addresses do not flood low/mid zoom.
- Ghost features are emitted only by the high-zoom quiet path and never grouped
  with non-ghost public features.
- Market, price, country, listing, and activity filters are applied before
  aggregation.
- Bucket counts match filtered source rows.
- Bucket centroids, bounds, representatives, and sample ids are deterministic.
- Read overlays expose only authorized viewer/session data and group only fully
  read member sets.
- Following overlays expose only authorized followed-actor activity.
- Buildings and trees match the existing visual/source-layer contract.

Client:

- Web and native use the same app-facing source-layer contract.
- `properties-source`, `read-properties-source`, `tree-source`, and
  `buildings-source` remain stable.
- Property features promote by `primary_property_id`.
- Public property tiles use the intentionally thin MVT field contract; rich
  address/metadata is hydrated through preview/detail/batch APIs unless a tested
  client path requires otherwise.
- Large buckets zoom predictably into bounds.
- Small buckets open grouped previews.
- Singles open standard property previews.
- Filter changes update public and private sources consistently.
- Native tap fallback returns the same grouped contract as rendered tiles.
- Private read/following map sources use signed tile-session templates, not
  Authorization or `x-session-id` tile request headers.
- Token/filter refresh preserves previous visible tiles until replacement
  templates are ready.
- Loaded styles, including fallback paths, preserve `promoteId:
  "primary_property_id"` on property sources.
- Thin tile features still hydrate rich grouped and single previews through
  Fastify APIs.

Operational:

- Martin runs locally and in production with explicit config.
- Martin is internal-only in production behind the reverse proxy.
- A tile gateway/proxy validates private signed tile-session tokens, strips
  trusted params supplied by clients, injects server-derived viewer/session
  params, and streams Martin bytes without generating MVT.
- Martin uses a read-only database role with statement timeout.
- Martin config validation fails on schema errors and ignored-key startup
  warnings.
- Product readiness verifies Martin reachability, catalog/source availability,
  representative tile fetches, Postgres/Redis health, projection freshness,
  required map resources, read-only role usage, and statement timeout.
- Private routes reject missing, bad, expired, and spoofed tokens.
- Public routes cache predictably; private routes do not leak through shared
  caches.
- Private caching is either disabled or keyed by verified viewer/session
  identity plus implemented read/follow version state.
- Projection rebuild is deterministic and idempotent.
- Non-destructive backfill commands are documented. If destructive reset is used,
  the exact reset/import/rebuild command sequence is documented and reproducible.
- Destructive reset drops/recreates `martin_tiles`, migration-owned auxiliary
  schemas, grants, and tile role settings so no stale Martin SQL survives.
- Base PMTiles/MBTiles archives, style files, sprites, and source font files are
  mounted read-only with explicit source ids and smoke-tested through Martin.
- Tree serving strategy has measured storage/query budgets, deterministic
  rebuilds, density caps, and validation.
- `pnpm test` and map-specific verification pass.

## Files Expected To Change

Backend and database:

- `services/api/src/db/schema.ts`
- `services/api/drizzle/*`
- projection rebuild scripts/services
- listing, comment, reaction, guess, view, follow, read-state, and property
  write services
- SQL migration files creating `martin_tiles` functions
- OSM/landcover/tall-building import scripts when source schemas or stored
  Web Mercator columns change
- `services/api/src/routes/tiles.ts`
- `services/api/src/routes/properties.ts`
- Fastify app registration and OpenAPI outputs
- Fastify tile gateway/proxy routes
- tile-session signing/verification services
- API integration tests

Martin and deployment:

- `martin/config.yaml`
- `martin/styles/*`
- `martin/sprites/*`
- `martin/fonts/*`
- `martin/tiles/*` or documented read-only PMTiles/MBTiles mount paths
- `docker-compose.yml`
- production service config
- reverse-proxy config
- deployment docs

Shared and client contracts:

- `packages/shared/src/utils/map-filters.ts`
- `packages/shared/src/types/property.ts`
- `packages/api-client/*`
- `packages/mocks/*`

App:

- map source helpers
- tile-session hooks
- map style loading code
- map interaction hooks
- preview hydration helpers
- web and native map tests
- Playwright and Maestro map tests

Tools:

- projection rebuild scripts
- Martin config validation scripts
- decoded MVT contract scripts
- tile gateway smoke/security scripts
- benchmark scripts under `tools/` or `scripts/`

## Cutover Sequence

1. Complete Phase 1 foundations, including the concrete tile gateway/proxy, and
   verify Martin can start with explicit config.
2. Complete Phase 2 source schema/import work. Use in-place backfill if it
   produces the same state; if reset is required, run and record the exact
   reset/import sequence.
3. Complete Phase 3 projections, rebuild them, analyze tables, and run
   projection validation.
4. Complete Phase 4 Martin SQL functions and decoded MVT/database tests.
5. Complete Phase 5 style/resource migration and verify TileJSON, style, sprite,
   font, and no-redirect contracts.
6. Complete Phase 6 Fastify control-plane changes, tile-session handling,
   gateway validation/injection, and nearby/following-nearby projection-backed
   fallbacks.
7. Complete Phase 7 app integration for web and native.
8. Run representative web map checks and mobile smoke checks against Martin.
9. Remove Fastify MVT generation from normal app usage.
10. Run benchmarks, app map checks, gateway private-token/security checks,
    private-cache isolation checks, and `pnpm test`.
11. Delete obsolete Node tile builders and old route tests once Martin usage,
    benchmarks, and regression tests pass.

## Definition Of Done

This migration is complete when Martin serves every HuisHype map tile and map
resource, Fastify generates no vector-tile bytes during normal app usage,
low-zoom property nodes come from indexed projections, private overlays are
authorized through signed tile sessions and a trusted gateway/proxy, web and
native interactions use the same app-facing source-layer contract, the old broad
low-zoom grouping path is unreachable from normal map usage, all non-ghost public
map objects are covered by the compact public projection, quiet/ghost rows are
high-zoom only, cold-cache performance budgets are met on the seeded dataset, all
reset/backfill commands needed to reproduce the state are documented, and
`pnpm test` plus map-specific web/native verification pass.

## MLT Decision

This migration uses MVT/PBF for dynamic PostGIS tiles. The older Martin/MLT
blockers do not block this plan because Martin can call PostGIS functions that
return MVT bytes with query parameters. They still block dynamic MLT from
PostGIS: Martin can serve static/raw MLT sources and can label returned `bytea`
as MLT via `content_type`, but it does not provide a PostGIS MLT encoder that
replaces `ST_AsMVT`. Native MLT FastPFOR support also remains outside the
web-first critical path. Do not introduce MLT into this migration unless dynamic
PostGIS MLT encoding and native client support are both verified in the same
cutover.

## Martin References Checked

- Local Martin repo: `/home/caslan/dev/git_repos/martin`
- Martin configuration docs: `/home/caslan/dev/git_repos/martin/docs/content/config-file/index.md`
- Martin PostgreSQL function docs: `/home/caslan/dev/git_repos/martin/docs/content/sources-pg-functions.md`
- Martin generated config reference: `/home/caslan/dev/git_repos/martin/docs/content/files/generated_config.md`
- Martin config schema: `/home/caslan/dev/git_repos/martin/schemas/config.json`
