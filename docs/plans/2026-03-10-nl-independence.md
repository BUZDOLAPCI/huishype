# NL Independence Plan — Portable Data Pipeline

**Date**: 2026-03-10
**Branch**: `dev/osm-buildings` (buildings phase), future branches for remaining phases
**Goal**: Eliminate all Netherlands-specific data dependencies and build a single-deployment, multi-country architecture serving 30+ countries simultaneously. No per-country deployments — one app, one database, one API, all countries.

---

## Current NL Dependencies (Audit)

| # | Dependency | Severity | Files affected | Current source |
|---|-----------|----------|---------------|----------------|
| 1 | **Building footprints + heights** | CRITICAL | `import-bag-buildings.ts`, `tiles.ts` | 3DBAG GeoPackage (104GB) |
| 2 | **Address/property data** | CRITICAL | `seed.ts`, `address.ts`, `listings.ts`, `og-fetcher.ts` | BAG GeoPackage (7GB, ~9.9M verblijfsobjecten, ~6.5M with addresses loaded) |
| 3 | **Search/geocoding** | CRITICAL | `address-resolver.ts` (frontend, direct PDOK calls), `pdok/imagery.ts` | PDOK Locatieserver v3 |
| 4 | **Listing domain whitelist** | HIGH | `listings.ts`, `og-fetcher.ts`, `validation.ts` (shared), `fixtures.ts` (mocks) | Hardcoded `funda.nl`, `pararius.nl` |
| 5 | **Postal code validation** | HIGH | `validation.ts` (shared), `address.ts`, `properties.ts` | Dutch format regex `^\d{4}\s?[A-Z]{2}$` |
| 6 | **Address formatting** | MEDIUM | `address.ts` | Dutch convention (addition rules) |
| 7 | **Default coordinates** | MEDIUM | `mapDefaults.ts`, ~45 test files, 8 Maestro flows | Eindhoven center, Beeldbuisring 41 |
| 8 | **RD New projection** | MEDIUM | `pdok/imagery.ts`, `import-tall-buildings.ts`, `import-bag-buildings.ts` | EPSG:28992 |
| 9 | **Landcover/trees** | LOW | `import-landcover.ts`, `tree-scatter.ts` | NL PBF extract (code portable, but PBF URL/path hardcoded — needs env-var override) |
| 10 | **Currency + locale** | MEDIUM | `formatting.ts` (6 functions), ~12 components | Hardcoded `EUR` currency, `nl-NL` locale |
| 11 | **Tall building exclusion** | LOW | `import-tall-buildings.ts` | OSM-based but hardcodes NL PBF URL + EPSG:28992 projection — needs config |
| 12 | **BAG property metrics** | MEDIUM | `seed.ts`, `properties.ts`, `schema.ts` | `bouwjaar`, `oppervlakte`, `wozValue` — Dutch-named columns for universal concepts (year built, floor area) + NL-specific WOZ valuation. Rename to `year_built`, `floor_area_m2`, `official_valuation` |

---

## Phase 1: Buildings → OSM (current branch `dev/osm-buildings`)

### 1. New import script
- Extract `building=*` polygons from PBF via `ogr2ogr` into PostGIS `osm_buildings` table
- Height resolution: `height` tag → `building:levels * 3` → `6m` default
- Keep `min_height` if present, else `0`

### 2. Replace building tile endpoint
- Point existing `GET /tiles/buildings/:z/:x/:y.pbf` at `osm_buildings` instead of `bag_buildings`
- Same MVT format, same zoom range — shaders consume it identically

### 3. Remove 3DBAG from pipeline
- Drop `bag_buildings` table, delete `import-bag-buildings.ts`
- Remove 3DBAG references from `db:reset` pipeline
- Keep `3dbag_nl.gpkg` on disk (not deleted)

### 4. Update tests & docs
- Adjust integration tests and visual e2e baselines
- Update AGENTS.md, MEMORY.md, data-sources.md

---

## Phase 2: Addresses → Overture Maps

### Why Overture Maps (not OSM addr:* or OpenAddresses)

| Criterion | Overture Maps | OSM addr:* | OpenAddresses |
|-----------|:------------:|:----------:|:-------------:|
| Global coverage | 455M+ from 30+ countries | ~100-200M, very uneven | ~600M, patchy |
| Schema consistency | Structured `address_levels[]` | No enforced standard | Varies by source |
| Update cadence | Monthly releases | Continuous but uncontrolled | Irregular |
| Institutional backing | Meta, Microsoft, AWS, TomTom | Community volunteers | Modest community |
| NL quality | BAG-derived (~9.9M) | BAG-derived (~9.5M) | BAG-derived (~9.9M) |
| Format | GeoParquet (DuckDB-queryable) | PBF | GeoJSON |

**Key insight**: All sources derive their NL data from BAG. For NL, quality is equivalent. The differentiator is global expansion capability.

### What changes

- New import script: download Overture addresses GeoParquet for **all active countries** via a single DuckDB query with Europe-wide bbox + `country IN (...)` filter, extract to CSV, load into `properties` table
- **Release discovery**: Use Overture's STAC catalog (`https://stac.overturemaps.org/`) to discover the latest release path rather than hardcoding S3 bucket paths. Overture fully embraced STAC as of Feb 2026 specifically to prevent path breakage across releases. Pin the discovered release version in a config variable for reproducibility.
- **DuckDB multi-country bbox pre-filtering**: Overture files are spatially partitioned by geohash, NOT by country. The import query MUST use explicit `WHERE bbox.xmin BETWEEN ... AND bbox.ymin BETWEEN ...` clauses on Overture's bbox struct column to trigger Parquet row-group pruning, combined with `country IN ('NL','DE','BE',...)` for logical filtering. `ST_Intersects()` alone does NOT trigger this optimization — DuckDB doesn't auto-decompose geometry predicates into struct filters. Example for Europe:
  ```sql
  SELECT id, number, street, postcode, country, address_levels, geometry
  FROM read_parquet('s3://overturemaps-us-west-2/release/.../theme=addresses/type=address/*')
  WHERE bbox.xmin BETWEEN -25 AND 45
    AND bbox.ymin BETWEEN 34 AND 72
    AND country IN ('NL','DE','BE','FR','AT','CH','LU','DK','SE','NO','FI','PL','CZ','SK','IT','ES','PT','IE','GB')
  ```
  The bbox filter is the primary pruning mechanism (~1-2GB downloaded for Europe out of ~8-10GB global). The `country` column (ISO 3166-1 alpha-2) is a secondary filter. Optionally add `ST_Within(geometry, ...)` after bbox+country filters for precise border clipping. For geographically scattered target countries (e.g., NL + Australia + Brazil), use separate per-region bbox queries and union results.
- **Scale**: ~460M addresses globally, ~50-100M for Europe. DuckDB handles this in a single pass with `SET preserve_insertion_order = false;` and 16-32GB RAM. Consider downloading raw Parquet locally first for ~5x faster queries vs. remote S3.
- Schema changes:
  - Add `country_code CHAR(2) NOT NULL` to `properties` — the anchor for all country-keyed logic
  - Add `region` column (currently only has `city`), map Overture's `address_levels[]` (variable depth) to `city`/`region` via country-specific mapping. Using `region` as it's internationally neutral (works for states, provinces, prefectures, departments).
  - **Partition `properties` table by `LIST (country_code)`** for query performance, per-partition GIST indexes, independent VACUUM, and zero-downtime country additions (DETACH/ATTACH). Composite PK becomes `(id, country_code)`.
  - Replace `bagIdentificatie` with generic `national_id VARCHAR(50)` + unique index `(country_code, national_id)`. Overture GERS UUIDs replace BAG IDs (note: Overture converted all GERS IDs to UUID v4 in June 2025, a one-time breaking change). DB will be dropped and recreated — no migration needed for existing data.
  - Unique address index becomes `(country_code, postal_code, house_number, house_number_addition)` — without `country_code`, postal codes collide across countries (e.g., Belgium's 4-digit codes overlap with other formats).
  - Change `listing_source` from enum `('funda','pararius','other')` to `VARCHAR(50)` for extensibility across 30+ countries' portals — no migration needed per new scraper. Alternatively, a `listing_sources` reference table `(id, name, country_code, base_url, domain_whitelist[])` moves the SSRF domain allowlist from code to data.
- **Column renames for portability**: `bouwjaar` → `year_built`, `oppervlakte` → `floor_area_m2`, `wozValue` → `official_valuation`. All three remain as nullable columns on `properties`. For NL, continue parsing from BAG GeoPackage as a supplementary data source after Overture address import. Other countries leave these NULL until equivalent sources are identified.
- **Dutch status field** (`ingetrokken` → demolished, `buiten gebruik` → inactive): NL-specific BAG status mapping stays in NL seed path. Overture-imported records default to `active`
- **Seed pipeline redesign**: The current seed pipeline loads ALL 9.6M property addresses into a JavaScript `Map` for O(1) lookups — this won't scale to 50-100M multi-country records (~50GB heap). Redesign to use per-country cursors or database-side lookups (e.g., `INSERT ... SELECT ... FROM staging JOIN properties USING (country_code, postal_code, house_number)`)
- **User model**: Add `home_country CHAR(2)` to `users` table (default from device locale, user-editable). Used for feed scoping, default camera, search scope.
- Remove BAG GeoPackage as the primary seed source (kept as supplementary for NL property metrics)
- Keep `bag-light.gpkg` on disk (not deleted)

### Overture caveats

- **Alpha status**: Addresses theme is still alpha as of Feb 2026 (GA anticipated ~Q2 2026). Buildings, places, transportation, divisions are GA. Schema may change between monthly releases
- **GERS ID stability**: GERS IDs converted to UUID v4 in June 2025 (one-time breaking change with 100% ID churn). Bridge files mapping old→new IDs are published with each release at `s3://overturemaps-extras-us-west-2/`. Post-migration, IDs are stable across releases.
- **60-day data retention**: Must download and store releases ourselves (Overture deletes old releases)
- **Partial US coverage**: Some countries still incomplete
- **No geocoding service**: Just raw data — need separate geocoder (Phase 3)

---

## Phase 3: Geocoding → Photon (self-hosted)

### Why Photon (not Nominatim, Pelias, or OSMNames)

| Criterion | Photon | Nominatim | Pelias | OSMNames |
|-----------|:------:|:---------:|:------:|:--------:|
| **Autocomplete** | Native (built for it) | No (expensive FTS) | Yes (`/autocomplete`) | Places only, no addresses |
| **Reverse geocoding** | Yes | Yes | Yes | No |
| **Self-host complexity** | 1 container | 1 container | 8+ containers | 1 container |
| **Planet RAM** | 64 GB (recommended) | 64+ GB | ~32 GB | N/A (places only) |
| **Planet disk** | 95 GB (190 GB with swap headroom) | ~500 GB | ~200 GB | N/A |
| **Setup time** | ~1 hour (download pre-built) | ~24-48 hours (planet import) | ~12-24 hours | ~30 min |
| **Latency (local)** | ~10-50ms | ~100-500ms | <100ms | ~10-50ms |
| **Per-query country filter** | `&countrycode=XX` | `&countrycodes=XX` | `/search?boundary.country=XX` | No |
| **Multi-country from single instance** | Yes (planet DB) | Yes (planet import) | Yes (planet import) | No |

**Photon wins** because it's purpose-built for autocomplete (our primary use case), single-container deployment, pre-built planet database available (weekly updates, 60GB download), and native per-query country filtering.

### What changes

- Add Photon container to `docker-compose.yml` with the **planet database** (serves all countries simultaneously):
  ```yaml
  photon:
    image: komoot/photon:latest
    container_name: huishype-photon
    ports:
      - "2322:2322"
    volumes:
      - photon_data:/photon/data
    environment:
      - JAVA_OPTS=-Xmx48G  # tune to available RAM
    # Download pre-built planet extract on first start (~60GB compressed, ~95GB on disk)
    # URL: https://download1.graphhopper.com/public/photon-db-planet-1.0-latest.tar.bz2
    # Updated weekly by GraphHopper. Includes names in English, German, French, and local languages.
  ```
- **Port**: 2322 (Photon default). Add to AGENTS.md ports table
- **Resource requirements**: 95GB disk (190GB during update swaps), 64GB RAM recommended for smooth global operation. SSD/NVMe strongly recommended. Java 21+ (Temurin).
- **Note**: Photon 1.0 (Feb 2026) halved the database size vs v0.7 by migrating from Elasticsearch to OpenSearch. The planet database is the only option for multi-country — per-country extracts **cannot be merged**. If you only need a subset of countries, use a custom Nominatim import with `-country-codes NL,DE,BE,...` instead of the full planet.
- **Per-query country filtering**: Photon 1.1.0+ supports `&countrycode=XX` (single ISO 3166-1 alpha-2 code per query) on `/api` to scope search to the user's current context. Additional filters: `bbox`, `osm_tag`, `state`, `city`, `postcode`, `district`.
- Add thin backend proxy endpoint: `GET /geocode/search?q=...&limit=5&lang=...&countrycode=...` that forwards to Photon and reformats the response. The `countrycode` parameter is derived from the user's `home_country` or explicit viewport context. This proxy is necessary because: (1) the native mobile app can only reach the API server (port 3100) — Photon at port 2322 is not accessible from the device without additional adb reverse setup, (2) in production, Photon should not be publicly exposed (no auth, DDoS surface), (3) the latency overhead of the extra hop is negligible (~2-3ms) for a self-hosted service on the same machine. No caching layer needed — autocomplete queries have near-zero cache hit rate.
- Create geocoder adapter interface in the frontend: `IGeocoder { search, suggest }` (reverse geocoding not needed — current `reverseGeocode()` only resolves BAG Pand placeholder names, which should be eliminated at the source by ensuring properties have proper addresses during import)
- Implement `ApiGeocoder` adapter that calls the backend proxy endpoint (GeoJSON response → our internal format)
- Replace hardcoded PDOK URLs in `address-resolver.ts` (frontend) with `IGeocoder` adapter calls to the backend proxy
- Update mock handlers in `packages/mocks/` — add `photonHandlers` alongside existing `pdokHandlers` during transition, then remove PDOK handlers once migration complete
- Delete `reverseGeocode()`, `isBagPandPlaceholder()`, and `useReverseGeocode()` hook once Phase 2 ensures no placeholder addresses are imported

### Photon response format

```json
{
  "type": "FeatureCollection",
  "features": [{
    "geometry": { "coordinates": [5.4557, 51.4300], "type": "Point" },
    "properties": {
      "name": "Deflectiespoelstraat 16",
      "housenumber": "16",
      "street": "Deflectiespoelstraat",
      "postcode": "5651HP",
      "city": "Eindhoven",
      "state": "Noord-Brabant",
      "country": "Netherlands",
      "countrycode": "NL",
      "osm_type": "N",
      "osm_id": 12345
    }
  }]
}
```

Maps cleanly to our existing address fields. No PDOK-specific fields like `weergavenaam` or `centroide_ll` (WKT) — standard GeoJSON coordinates instead.

---

## Phase 0: Multi-country architecture design

Before Phase 4a begins, design the multi-country architecture. **No per-country deployments** — a single deployment serves all countries simultaneously.

### Country context model

Three distinct concepts that must be modeled separately:

| Concept | Determined by | Used for |
|---------|--------------|----------|
| **Property country** | `properties.country_code` (immutable, set at import) | Currency, address format, listing domain validation, postal code validation |
| **Browsing context** | Map viewport (which countries are visible) | Which tiles/features to show, cross-border seamless browsing |
| **User home country** | `users.home_country` (user preference, falls back to device locale) | Default map camera, feed scoping, search scope |

### Country config registry

Create `country-config.ts` as a `Record<CountryCode, CountryConfig>` registry loaded at module import time. **All country configs are loaded simultaneously** — no env var selector:

```ts
export interface CountryConfig {
  code: CountryCode;
  name: string;
  locale: string;           // Intl locale tag (nl-NL, de-DE, etc.)
  currency: string;         // ISO 4217 (EUR, GBP, SEK, etc.)
  postalCodeRegex: RegExp;
  postalCodeNormalize: (raw: string) => string;
  listingDomains: string[]; // allowed listing URL domains for this country
  defaultCenter: [number, number]; // [lng, lat] for initial camera
  defaultZoom: number;
  projectionSrid: number;   // for import scripts (28992 RD New, 27700 OSGB, etc.)
  pbfUrl: string;           // Geofabrik OSM PBF download URL
  addressFormatter: (parts: AddressParts) => string;
}

const COUNTRY_CONFIGS: Record<CountryCode, CountryConfig> = {
  NL: { locale: 'nl-NL', currency: 'EUR', listingDomains: ['funda.nl', 'pararius.nl'], ... },
  DE: { locale: 'de-DE', currency: 'EUR', listingDomains: ['immobilienscout24.de', 'immowelt.de'], ... },
  BE: { locale: 'nl-BE', currency: 'EUR', listingDomains: ['immoweb.be'], ... },
  // ... 30+ countries
};
```

### Cross-border map browsing

A seamless cross-border map view (e.g., NL + DE properties visible near Maastricht/Aachen) is a genuine differentiator — **no existing property app does this**. Tile serving is inherently country-agnostic (spatial bbox queries return whatever geometry is in the viewport). No special handling needed.

### Feed and search scoping

With 30+ countries in one database, unscoped feed/search queries would be dominated by countries with more data. Scope by:
- **Feed** (`GET /feed`): User's `home_country` by default, with optional `country` query parameter override
- **Search** (`GET /geocode/search`): Photon's `&countrycode=XX` parameter scoped to user's current viewport or home country
- **Properties list endpoints**: Add optional `country` filter parameter

## Phase 4a.1: Configuration portability — safe early (no schema dependency)

### Listing domain whitelist → config-driven

- Consolidate duplicated constants: `ALLOWED_LISTING_DOMAINS` in `listings.ts` AND `ALLOWED_ROOT_DOMAINS` in `og-fetcher.ts` into the country config registry
- Also update `validation.ts` (shared package) and `fixtures.ts` (mocks)
- Two validation moments in multi-country mode:
  - **User submits URL for a known property**: Validate against `getCountryConfig(property.country_code).listingDomains` — a Rightmove URL for a Dutch property is rejected
  - **User submits URL before property association** (new listing flow): Validate against `getAllListingDomains()` (union of all countries' domains). After property is resolved, re-validate domain matches the property's country.
- `og-fetcher.ts` SSRF guard uses `getAllListingDomains()` from the registry

### Currency + locale → property-driven

In multi-country mode, **the property's country determines price display currency** (a Dutch house costs EUR, always). UI chrome (dates, numbers) follows user's device locale.

- `formatting.ts` has 6 functions with hardcoded `nl-NL` (4 as parameter defaults, 2 inline) and 1 with `EUR` — refactor to accept `countryCode` parameter, dispatch through `getCountryConfig(countryCode)`
- ~12 components use `toLocaleString('nl-NL')` directly — refactor to use `formatPropertyPrice(price, property.country_code)` which calls `new Intl.NumberFormat(config.locale, { style: 'currency', currency: config.currency })`
- Non-property formatting (relative dates, karma numbers): change default from `nl-NL` to `undefined` (lets `Intl` use device locale)
- **No currency conversion in v1** — properties display in their native currency. Cross-country price comparison is a separate feature (exchange rate feeds, staleness, display UX) — defer it.

### Import scripts → multi-country loop

In multi-country mode, import scripts iterate over all active countries in the config registry:

- `import-landcover.ts` and `import-tall-buildings.ts` hardcode `netherlands-latest.osm.pbf` URL — refactor to read `pbfUrl` from each `CountryConfig` and loop:
  ```ts
  for (const config of Object.values(COUNTRY_CONFIGS)) {
    await importBuildings(config);  // ogr2ogr from config.pbfUrl
    await importLandcover(config);  // ogr2ogr from config.pbfUrl
  }
  ```
- PBF files organized by country: `data_sources/NL/netherlands-latest.osm.pbf`, `data_sources/DE/germany-latest.osm.pbf`, etc.
- `osm_buildings` and `landcover` tables do NOT need a `country_code` column — geometry is the country discriminator (tile queries use spatial bbox, which naturally returns only features in the viewport). This also correctly handles cross-border rendering (buildings in Baarle-Nassau/Baarle-Hertog span NL/BE).
- Consider parallelizing per-country imports for speed (Germany's PBF is ~4GB → ~50M building polygons)

## Phase 4a.2: Configuration portability — after Phase 2 schema settles

### Postal code validation → pluggable

- Create country-keyed validator: `postalCodeValidators: Record<CountryCode, RegExp>`
- NL: `^\d{4}\s?[A-Z]{2}$`, UK: `^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$`, US: `^\d{5}(-\d{4})?$`, etc.
- Three validators to unify: `validation.ts` (shared, strict), `address.ts` (API, strict), `properties.ts` (API, case-insensitive) — consolidate to single dispatch
- `normalizePostalCode()` dispatches to country-specific normalizer

### Address formatting → pluggable

- Interface: `formatDisplayAddress(addr, countryCode) → string`
- NL: `"Straat 13A, 5658DP Eindhoven"`, UK: `"13A High Street, London SW1A 1AA"`, etc.
- `formatAddition()` becomes NL-specific implementation
- **Library consideration**: Evaluate `@fragaria/address-formatter` (npm, ~46K weekly downloads, 251 territories, OpenCage YAML templates) for display formatting when Photon integration lands — its input format matches Photon's GeoJSON output. Note: only handles display formatting, not our canonical address parsing/normalization/dedup logic in `address.ts` which remains domain-specific per country.

### Projection → country config

- Remove hardcoded EPSG:28992 (RD New)
- `import-tall-buildings.ts`: use country-specific SRID from config for accurate meter-distance buffer calculations (RD New for NL, OSGB for UK, etc.)
- PDOK imagery (`pdok/imagery.ts`): gate behind country=NL check, skip otherwise

## Phase 4b: Coordinates + test migration (higher effort)

### Default coordinates → user-preference-driven

- `mapDefaults.ts`: read default center from `getCountryConfig(user.home_country).defaultCenter` at runtime
- Fallback chain: user's `home_country` preference → device locale → `NL` (hardcoded fallback)
- No single hardcoded center — each country config specifies its own default center

### Test fixture migration

- **~45 test files** hardcode Eindhoven coordinates (26 visual e2e, 9 flow e2e, 1 integration, 9 unit tests)
- **8 Maestro mobile flows** (`apps/app/e2e/mobile/flows/`) with hardcoded Eindhoven addresses and coordinates
- **Seed fixture script** (`scripts/seed-test-fixture.ts`) with Beeldbuisring 41 data
- Parameterize by country config constants imported from a shared test fixture file
- Visual e2e baselines will need recapture if coordinates change

---

## Phase 5: Test portability

- Create per-country test fixture sets (address, coordinates, postal codes)
- NL fixture: current Beeldbuisring 41 data
- Default fixture: generic test data that works without country-specific setup
- Update ~45 test files + 8 Maestro flows that hardcode Eindhoven coordinates (see Phase 4b)
- Mock geocoder responses for Photon format

---

## Remaining per-country specifics (intentionally kept)

| Component | Why it stays per-country |
|-----------|------------------------|
| Listing scrapers | Listing sources are inherently per-country (Funda/Pararius for NL, ImmoScout24/Immowelt for DE, Immoweb for BE, etc.). Adding new countries means adding new scraper adapters. The `listing_sources` reference table (or VARCHAR `listing_source` column) accommodates this without schema changes. |
| Aerial imagery | `pdok/imagery.ts` — NL-only satellite imagery (PDOK). Other countries need equivalent services (BKG for DE, IGN for FR, etc.). Gate behind `country_code` check, skip for countries without a configured imagery provider. |
| Supplementary property data | BAG GeoPackage for NL enrichment (`year_built`, `floor_area_m2`, `official_valuation`). Each country may have its own enrichment source (UK: EPC certificates, DE: Energieausweis) — these are per-country adapter scripts that populate the same nullable columns. |

---

## Execution order

```
Phase 1   (buildings)    ████░░░░░░░░░░  ← current branch, in progress
Phase 0   (architecture) ░██░░░░░░░░░░░  ← country-config.ts registry, multi-country design
Phase 4a.1 (config-lite)  ░░███░░░░░░░░  ← domains, currency, formatting, import scripts (no schema dep)
Phase 2   (addresses)     ░░░░░████░░░░  ← biggest change: multi-country Overture import, partitioned schema, user model
Phase 3   (geocoding)     ░░░░░░░████░░  ← Photon planet DB, backend proxy, frontend adapter
Phase 4a.2 (config+)      ░░░░░░░░░██░░  ← postal codes, address formatting, projections (needs Phase 2 schema)
Phase 4b  (test coords)   ░░░░░░░░░░███  ← ~45 test files + 8 Maestro flows + visual baseline recapture
Phase 5   (test fixtures)  ░░░░░░░░░░░██  ← continuous, alongside each phase
```

Phase 0 now designs the multi-country registry (not a per-deployment env var). Phase 4a.1 can start early since it's pure refactoring. Phase 2 is the heavy lift — partitioned schema, multi-country Overture import, seed pipeline redesign, user model changes. Phase 3 uses the Photon planet database instead of a country extract. Phase 4a.2 deferred until Phase 2 settles the address schema. Phase 4b deferred until Phases 2-3 settle.

---

## Data source summary (after all phases)

| Data | Before | After |
|------|--------|-------|
| Buildings | 3DBAG GeoPackage (NL-only, 104GB) | OSM PBF extracts (all active countries, imported in parallel) |
| Addresses | BAG GeoPackage (NL-only, 7GB) | Overture Maps GeoParquet (single query for all active countries, ~50-100M for Europe) |
| Geocoding | PDOK Locatieserver (NL-only, hosted) | Photon planet DB (self-hosted, 95GB, serves all countries, per-query `&countrycode` filtering) |
| Landcover | NL PBF extract (hardcoded URL) | Per-country PBF extracts (looped via config registry) |
| Base map | OpenFreeMap Positron | OpenFreeMap Positron (already global) |
| Listing sites | funda.nl, pararius.nl | Config-driven per country (country config registry) |
| **Database** | Single-country, ~9.6M properties | **Multi-country, partitioned by `country_code`**, ~50-100M properties (Europe) |
| **User model** | No country awareness | `home_country` on users table, device locale fallback |
