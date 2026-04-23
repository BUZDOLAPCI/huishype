// ---------------------------------------------------------------------------
// seed-listings.ts
//
// Bulk replay of listings and price history from the Funda and Pararius mirror
// databases into the main HuisHype database.
//
// Strategy:
//   1. Preload ALL property addresses into an in-memory Map for O(1) lookups
//   2. Load matched mirror rows into listing_replay_staging
//   3. Convert staged rows into replay observations
//   4. Reconcile canonical_listings and observation links set-wise
//   5. Project listing_price_observations and compatibility price_history rows
//   6. Refresh canonical listing views and ANALYZE affected tables
//
// Usage:
//   npx tsx scripts/seed-listings.ts [--dry-run] [--source funda|pararius|both]
// ---------------------------------------------------------------------------

import postgres from 'postgres';
import dotenv from 'dotenv';
import { canonicalizeAddress } from '../src/utils/address.js';
import { resolveListingSourceUrl, type ListingSourceAlias } from '../src/services/listing-source-resolution.js';

dotenv.config();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MirrorListing {
  id: number;
  funda_id?: string;
  pararius_id?: string;
  listing_url: string;
  price_type: string | null;
  asking_price_cents: string | null; // BigInteger comes as string from postgres.js
  living_area_m2: number | null;
  num_rooms: number | null;
  energy_label: string | null;
  status: string;
  photo_urls: string[] | null;
  first_seen_at: Date | null;
  last_seen_at: Date | null;
  last_changed_at: Date | null;
  // Joined address fields
  street: string;
  house_number: string;
  house_number_addition: string | null;
  postal_code: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
}

interface MirrorPriceHistory {
  id: number;
  address_id: number;
  listing_id: number | null;
  funda_id?: string;
  pararius_id?: string;
  price_cents: string | null;
  price_date: string; // date as string
  source: string;
  status: string;
  // Joined address fields
  postal_code: string;
  house_number: string;
  house_number_addition: string | null;
}

interface SourceStats {
  matched: number;
  skipped: number;
  duplicates: number;
  priceHistoryEntries: number;
  errors: number;
}

type ListingSourceStatus = 'available' | 'sold' | 'rented' | 'withdrawn' | 'not_found' | 'blocked' | 'invalid' | 'parser_error' | 'unknown';
type ListingSourceIdKind = 'tiny_id' | 'global_id' | 'detail_id' | 'canonical_path' | 'relative_path' | 'url_path' | 'unknown';
type ListingPropertyMatchKind = 'source_exact' | 'source_spatial';
type PriceObservationEventType = 'initial' | 'price_change' | 'status_change' | 'mirror_refresh' | 'user_submission';
type SourceName = 'funda' | 'pararius';

interface SourceIdentity {
  sourceListingId: string;
  sourceListingIdKind: ListingSourceIdKind;
  sourceUrlCanonical: string;
  sourceListingAliases: ListingSourceAlias[];
}

// Batch row types for accumulation before replay
interface ReplayStagingRow {
  property_id: string;
  source_name: SourceName;
  source_listing_id: string;
  source_listing_id_kind: ListingSourceIdKind;
  source_listing_aliases: ListingSourceAlias[];
  source_url_raw: string;
  source_url_canonical: string;
  asking_price: number | null;
  price_type: string | null;
  living_area_m2: number | null;
  num_rooms: number | null;
  energy_label: string | null;
  source_status: ListingSourceStatus;
  property_match_kind: ListingPropertyMatchKind;
  mirror_listing_id: string | null;
  thumbnail_url: string | null;
  og_title: string;
  address: Record<string, unknown>;
  mirror_first_seen_at: Date | null;
  mirror_last_changed_at: Date | null;
  mirror_last_seen_at: Date | null;
}

interface PriceObservationRow {
  property_id: string;
  source_name: SourceName;
  source_listing_id: string | null;
  price: number;
  price_date: string;
  event_type: PriceObservationEventType;
  observed_at: Date | string;
}

// Unmatched listing that needs spatial fallback
interface UnmatchedListing {
  index: number; // position in the prepared rows context
  latitude: number;
  longitude: number;
  cacheKey: string;
  mirrorRow: MirrorListing;
  source: SourceName;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArgValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

const DRY_RUN = args.includes('--dry-run');
const SOURCE_FILTER = (getArgValue('--source') ?? 'both') as 'funda' | 'pararius' | 'both';
const BATCH_SIZE = 4000; // 15 cols/listing * 4000 = 60K params (under PG's 65534 limit)
const MIRROR_FETCH_SIZE = 5000;

// ---------------------------------------------------------------------------
// Database connections
// ---------------------------------------------------------------------------

const MAIN_DB_URL = process.env.DATABASE_URL || 'postgresql://huishype:huishype_dev@localhost:5440/huishype';
const FUNDA_DB_URL = process.env.FUNDA_MIRROR_URL || 'postgresql://scraper:secret@localhost:5441/funda_mirror';
const PARARIUS_DB_URL = process.env.PARARIUS_MIRROR_URL || 'postgresql://scraper:secret@localhost:5442/pararius_mirror';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format elapsed time nicely. */
function formatElapsedTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

/** Map mirror listing status to source observation status. */
function mapSourceStatus(mirrorStatus: string, source: SourceName): ListingSourceStatus {
  const s = mirrorStatus.toLowerCase();
  if (s === 'available' || s === 'active') return 'available';
  if (s === 'sold') return 'sold';
  if (s === 'rented') return 'rented';
  if (s === 'withdrawn') return 'withdrawn';
  if (s === 'not_found') return 'not_found';
  if (s === 'blocked') return 'blocked';
  if (s === 'invalid') return 'invalid';
  if (s === 'parser_error') return 'parser_error';
  // Fallback
  console.warn(`  Unknown ${source} listing status: "${mirrorStatus}", defaulting to "unknown"`);
  return 'unknown';
}

/** Map mirror price history status to listing_price_observations event_type. */
function mapPriceEventType(mirrorStatus: string): PriceObservationEventType {
  const s = mirrorStatus.toLowerCase();
  if (s === 'price_change') return 'price_change';
  if (s === 'sold' || s === 'rented') return 'status_change';
  return 'initial';
}

/** Convert cents (bigint string or number) to whole euros, or null if missing. */
function centsToEuros(cents: string | null): number | null {
  if (cents == null) return null;
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  return Math.round(n / 100);
}

/** Build an OG title from address parts and price_type. */
function buildOgTitle(
  street: string,
  houseNumber: string,
  houseNumberAddition: string | null,
  city: string,
  priceType: string | null,
): string {
  const additionSuffix = houseNumberAddition ? houseNumberAddition : '';
  const prefix = priceType === 'rent' ? 'Te huur' : 'Te koop';
  return `${prefix}: ${street} ${houseNumber}${additionSuffix}, ${city}`;
}

/** Extract first photo URL from a JSON array (or native array). */
function extractThumbnailUrl(photoUrls: string[] | null): string | null {
  if (!photoUrls || !Array.isArray(photoUrls) || photoUrls.length === 0) return null;
  return photoUrls[0] ?? null;
}

function normalizePriceType(priceType: string | null): string | null {
  if (!priceType) return null;
  const normalized = priceType.trim().toLowerCase();
  if (normalized === '') return null;
  return normalized;
}

function uniqueSourceAliases(aliases: ListingSourceAlias[]): ListingSourceAlias[] {
  const seen = new Set<string>();
  return aliases.filter((alias) => {
    const key = `${alias.kind}:${alias.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveMirrorSourceIdentity(source: SourceName, rawUrl: string, mirrorId: string | null | undefined): SourceIdentity {
  const resolution = resolveListingSourceUrl(rawUrl, source);
  const aliases: ListingSourceAlias[] = [];

  if (resolution.supported) {
    aliases.push(...resolution.aliases);
    if (mirrorId && !aliases.some((alias) => alias.value === mirrorId)) {
      aliases.push({ kind: source === 'funda' ? 'tiny_id' : 'url_path', value: mirrorId });
    }
    return {
      sourceListingId: resolution.sourceListingId,
      sourceListingIdKind: resolution.sourceListingIdKind,
      sourceUrlCanonical: resolution.canonicalUrl,
      sourceListingAliases: uniqueSourceAliases(aliases),
    };
  }

  const fallbackId = mirrorId?.trim() || rawUrl.trim();
  if (fallbackId && source === 'funda') {
    aliases.push({ kind: 'tiny_id', value: fallbackId });
  }
  if (rawUrl.trim()) {
    aliases.push({ kind: 'canonical_url', value: rawUrl.trim() });
  }

  return {
    sourceListingId: fallbackId,
    sourceListingIdKind: mirrorId ? (source === 'funda' ? 'tiny_id' : 'url_path') : 'unknown',
    sourceUrlCanonical: rawUrl.trim(),
    sourceListingAliases: uniqueSourceAliases(aliases),
  };
}

function buildReplayRow(
  row: MirrorListing,
  source: SourceName,
  propertyId: string,
  propertyMatchKind: ListingPropertyMatchKind,
): ReplayStagingRow {
  const mirrorId = source === 'funda' ? row.funda_id : row.pararius_id;
  const identity = resolveMirrorSourceIdentity(source, row.listing_url, mirrorId);
  const priceType = normalizePriceType(row.price_type);

  return {
    property_id: propertyId,
    source_name: source,
    source_listing_id: identity.sourceListingId,
    source_listing_id_kind: identity.sourceListingIdKind,
    source_listing_aliases: identity.sourceListingAliases,
    source_url_raw: row.listing_url,
    source_url_canonical: identity.sourceUrlCanonical,
    asking_price: centsToEuros(row.asking_price_cents),
    price_type: priceType,
    living_area_m2: row.living_area_m2,
    num_rooms: row.num_rooms,
    energy_label: row.energy_label,
    source_status: mapSourceStatus(row.status, source),
    property_match_kind: propertyMatchKind,
    mirror_listing_id: mirrorId ?? null,
    thumbnail_url: extractThumbnailUrl(row.photo_urls),
    og_title: buildOgTitle(row.street, row.house_number, row.house_number_addition, row.city, priceType),
    address: {
      countryCode: 'NL',
      street: row.street,
      postalCode: row.postal_code,
      houseNumber: Number.parseInt(row.house_number, 10) || null,
      houseNumberAddition: row.house_number_addition,
      city: row.city,
      latitude: row.latitude,
      longitude: row.longitude,
    },
    mirror_first_seen_at: row.first_seen_at,
    mirror_last_changed_at: row.last_changed_at,
    mirror_last_seen_at: row.last_seen_at,
  };
}

// ---------------------------------------------------------------------------
// Property lookup cache (global, populated in step 1)
// ---------------------------------------------------------------------------

const propertyMap = new Map<string, string>();

/**
 * Build a lookup key from address components.
 * Format: "POSTALCODE|HOUSENUMBER|ADDITION" (uppercase, no spaces in postal code).
 */
function buildLookupKey(postalCode: string, houseNumber: number | string, addition: string | null): string {
  const pc = String(postalCode).replace(/\s/g, '').toUpperCase();
  const hn = typeof houseNumber === 'string' ? parseInt(houseNumber, 10) : houseNumber;
  return `${pc}|${hn}|${(addition || '').toUpperCase()}`;
}

/**
 * In-memory property lookup with canonicalization + raw fallback.
 * Returns property UUID or null.
 */
function findPropertyIdSync(
  postalCode: string,
  houseNumber: string,
  houseNumberAddition: string | null,
): string | null {
  // Try canonicalize for normalized lookup
  try {
    const canon = canonicalizeAddress({
      street: '',
      houseNumber,
      houseNumberAddition,
      postalCode,
      city: '',
    });
    if (canon) {
      const key = buildLookupKey(canon.postalCode, canon.houseNumber, canon.houseNumberAddition);
      const id = propertyMap.get(key);
      if (id) return id;
    }
  } catch {
    // canonicalization failed, try raw lookup
  }

  // Fallback: try raw values (handles edge cases canonicalization misses)
  const rawHouseNum = parseInt(houseNumber, 10);
  if (!Number.isFinite(rawHouseNum)) return null;
  const rawKey = buildLookupKey(postalCode, rawHouseNum, houseNumberAddition);
  const rawId = propertyMap.get(rawKey);
  if (rawId) return rawId;

  return null;
}

/**
 * PostGIS spatial fallback for unmatched listings.
 * Loads all unmatched coordinates into a temp table with GIST index,
 * then does a single efficient spatial join using geometry (not geography)
 * with an approximate degree-based bounding box for Netherlands latitudes.
 *
 * At ~52°N: 50m ≈ 0.00073° longitude, 0.00045° latitude.
 * We use 0.001° (~80-110m) as a generous bounding box for the initial
 * GIST filter, which is very fast.
 */
async function spatialFallbackBatch(
  mainDb: postgres.Sql,
  unmatched: UnmatchedListing[],
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  if (unmatched.length === 0) return results;

  console.log(`    Loading ${unmatched.length} coordinates into temp table...`);

  // Create temp table with geometry column and index
  await mainDb`DROP TABLE IF EXISTS _spatial_lookup`;
  await mainDb.unsafe(`
    CREATE TEMP TABLE _spatial_lookup (
      cache_key text PRIMARY KEY,
      geom geometry(Point, 4326)
    )
  `);

  // Bulk insert coordinates in chunks (65534 param limit / 3 cols = 21844 max)
  const CHUNK = 10000;
  for (let i = 0; i < unmatched.length; i += CHUNK) {
    const chunk = unmatched.slice(i, i + CHUNK);
    const valueClauses: string[] = [];
    const params: unknown[] = [];

    for (let j = 0; j < chunk.length; j++) {
      const base = j * 3;
      valueClauses.push(`($${base + 1}, ST_SetSRID(ST_MakePoint($${base + 2}, $${base + 3}), 4326))`);
      params.push(chunk[j].cacheKey, chunk[j].longitude, chunk[j].latitude);
    }

    await mainDb.unsafe(
      `INSERT INTO _spatial_lookup (cache_key, geom) VALUES ${valueClauses.join(', ')} ON CONFLICT DO NOTHING`,
      params as (string | number)[],
    );
  }

  // Build GIST index on the temp table for efficient spatial join
  await mainDb.unsafe(`CREATE INDEX ON _spatial_lookup USING GIST (geom)`);

  console.log(`    Running spatial join...`);
  const start = Date.now();

  // Spatial join: use bounding box expansion (~100m) for fast GIST filter,
  // then pick closest property per listing
  const rows = await mainDb.unsafe(`
    SELECT DISTINCT ON (sl.cache_key)
      sl.cache_key,
      p.id AS property_id
    FROM _spatial_lookup sl
    JOIN properties p ON p.geometry && ST_Expand(sl.geom, 0.001)
    ORDER BY sl.cache_key, ST_Distance(p.geometry, sl.geom)
  `);

  for (const row of rows) {
    results.set(row.cache_key as string, row.property_id as string);
  }

  await mainDb`DROP TABLE IF EXISTS _spatial_lookup`;

  console.log(`    Spatial fallback matched ${results.size}/${unmatched.length} in ${formatElapsedTime(Date.now() - start)}`);
  return results;
}

// ---------------------------------------------------------------------------
// Replay helpers
// ---------------------------------------------------------------------------

async function clearReplayRun(
  mainDb: postgres.Sql,
  source: SourceName,
  runKey: string,
): Promise<void> {
  await mainDb`
    DELETE FROM listing_replay_staging
    WHERE source_name = ${source}
      AND upstream_run_key = ${runKey}
  `;
}

async function batchInsertReplayStaging(
  mainDb: postgres.Sql,
  source: SourceName,
  runKey: string,
  rows: ReplayStagingRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const COLS_PER_ROW = 17;
  const valueClauses: string[] = [];
  const params: unknown[] = [];

  for (let i = 0; i < rows.length; i++) {
    const base = i * COLS_PER_ROW;
    valueClauses.push(`(
      $${base + 1},
      $${base + 2},
      $${base + 3},
      $${base + 4}::listing_source_id_kind,
      $${base + 5}::jsonb,
      $${base + 6},
      $${base + 7},
      $${base + 8}::listing_source_status,
      $${base + 9}::uuid,
      $${base + 10}::listing_property_match_kind,
      $${base + 11},
      $${base + 12},
      $${base + 13}::jsonb,
      $${base + 14},
      $${base + 15},
      $${base + 16},
      $${base + 17}::jsonb
    )`);

    const row = rows[i];
    params.push(
      source,
      runKey,
      row.source_listing_id,
      row.source_listing_id_kind,
      JSON.stringify(row.source_listing_aliases),
      row.source_url_raw,
      row.source_url_canonical,
      row.source_status,
      row.property_id,
      row.property_match_kind,
      row.asking_price,
      'EUR',
      JSON.stringify(row.address),
      row.mirror_first_seen_at,
      row.mirror_last_seen_at,
      row.mirror_last_changed_at,
      JSON.stringify({
        mirrorListingId: row.mirror_listing_id,
        title: row.og_title,
        imageUrl: row.thumbnail_url,
        priceType: row.price_type,
        livingAreaM2: row.living_area_m2,
        numRooms: row.num_rooms,
        energyLabel: row.energy_label,
      }),
    );
  }

  const sql = `
    INSERT INTO listing_replay_staging (
      source_name,
      upstream_run_key,
      source_listing_id,
      source_listing_id_kind,
      source_listing_aliases,
      source_url_raw,
      source_url_canonical,
      source_status,
      property_id,
      property_match_kind,
      asking_price,
      price_currency,
      address_normalized,
      first_seen_at,
      last_seen_at,
      source_updated_at,
      payload
    )
    VALUES ${valueClauses.join(',\n')}
  `;

  const result = await mainDb.unsafe(sql, params as (string | number | null | Date)[]);
  return result.count;
}

async function materializeReplayObservations(
  mainDb: postgres.Sql,
  source: SourceName,
  runKey: string,
): Promise<number> {
  const inserted = await mainDb.unsafe(`
    WITH staged AS (
      SELECT *
      FROM listing_replay_staging
      WHERE source_name = $1
        AND upstream_run_key = $2
    ),
    ins AS (
      INSERT INTO listing_observations (
        source_name,
        source_listing_id,
        source_listing_id_kind,
        source_listing_aliases,
        source_url_raw,
        source_url_canonical,
        origin,
        property_id,
        property_match_kind,
        source_status,
        asking_price,
        price_currency,
        address_raw,
        address_normalized,
        postal_code,
        house_number,
        house_number_addition,
        listed_at,
        first_seen_at,
        last_seen_at,
        source_updated_at,
        observed_at,
        payload
      )
      SELECT
        staged.source_name,
        staged.source_listing_id,
        staged.source_listing_id_kind,
        staged.source_listing_aliases,
        staged.source_url_raw,
        staged.source_url_canonical,
        'replay'::listing_observation_origin,
        staged.property_id,
        staged.property_match_kind,
        staged.source_status,
        staged.asking_price,
        COALESCE(staged.price_currency, 'EUR'),
        concat_ws(
          ' ',
          staged.address_normalized->>'street',
          staged.address_normalized->>'houseNumber',
          staged.address_normalized->>'houseNumberAddition',
          staged.address_normalized->>'postalCode',
          staged.address_normalized->>'city'
        ),
        staged.address_normalized,
        staged.address_normalized->>'postalCode',
        NULLIF(staged.address_normalized->>'houseNumber', '')::integer,
        NULLIF(staged.address_normalized->>'houseNumberAddition', ''),
        staged.listed_at,
        staged.first_seen_at,
        staged.last_seen_at,
        staged.source_updated_at,
        COALESCE(staged.last_seen_at, staged.source_updated_at, staged.first_seen_at, staged.loaded_at, now()),
        staged.payload
      FROM staged
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT count(*)::int AS count FROM ins
  `, [source, runKey]);

  return Number(inserted[0]?.count ?? 0);
}

async function reconcileReplayRun(
  mainDb: postgres.Sql,
  source: SourceName,
  runKey: string,
): Promise<number> {
  const result = await mainDb.unsafe(`
    WITH staged AS (
      SELECT *
      FROM listing_replay_staging
      WHERE source_name = $1
        AND upstream_run_key = $2
    ),
    alias_rows AS (
      SELECT DISTINCT
        staged.source_name,
        alias.kind AS alias_kind,
        alias.value AS alias_value,
        staged.source_listing_id AS primary_source_listing_id,
        COALESCE(staged.first_seen_at, staged.loaded_at, now()) AS first_seen_at,
        COALESCE(staged.last_seen_at, staged.source_updated_at, staged.loaded_at, now()) AS last_seen_at
      FROM staged
      CROSS JOIN LATERAL jsonb_to_recordset(staged.source_listing_aliases) AS alias(kind text, value text)
      WHERE staged.source_listing_id IS NOT NULL
        AND alias.kind IN ('tiny_id', 'global_id', 'detail_id', 'canonical_url', 'relative_path', 'url_path')
        AND alias.value IS NOT NULL
        AND alias.value <> ''
    ),
    alias_upsert AS (
      INSERT INTO listing_source_aliases (
        source_name,
        alias_kind,
        alias_value,
        primary_source_listing_id,
        first_seen_at,
        last_seen_at
      )
      SELECT
        source_name,
        alias_kind::listing_source_alias_kind,
        alias_value,
        primary_source_listing_id,
        first_seen_at,
        last_seen_at
      FROM alias_rows
      ON CONFLICT (source_name, alias_kind, alias_value)
      DO UPDATE SET
        primary_source_listing_id = EXCLUDED.primary_source_listing_id,
        last_seen_at = GREATEST(listing_source_aliases.last_seen_at, EXCLUDED.last_seen_at)
      RETURNING 1
    ),
    candidate_observations AS (
      SELECT DISTINCT ON (obs.id)
        obs.id,
        obs.property_id,
        obs.source_name,
        obs.source_listing_id,
        obs.source_url_canonical,
        obs.source_url_raw,
        obs.submitted_by,
        obs.source_status,
        obs.asking_price,
        COALESCE(obs.price_currency, 'EUR') AS price_currency,
        obs.first_seen_at,
        obs.last_seen_at,
        obs.observed_at,
        obs.payload,
        staged.property_match_kind
      FROM staged
      JOIN listing_observations obs
        ON obs.source_name = staged.source_name
       AND obs.origin = 'replay'
       AND obs.source_listing_id = staged.source_listing_id
       AND obs.observed_at = COALESCE(staged.last_seen_at, staged.source_updated_at, staged.first_seen_at, staged.loaded_at)
    ),
    latest AS (
      SELECT DISTINCT ON (source_name, source_listing_id)
        *
      FROM candidate_observations
      ORDER BY source_name, source_listing_id, observed_at DESC, id DESC
    ),
    url_updates AS (
      UPDATE canonical_listings AS c
      SET
        property_id = latest.property_id,
        primary_source_listing_id = COALESCE(c.primary_source_listing_id, latest.source_listing_id),
        canonical_url = COALESCE(latest.source_url_canonical, c.canonical_url),
        display_url = COALESCE(latest.source_url_canonical, latest.source_url_raw, c.display_url),
        status = CASE WHEN latest.source_status = 'available' THEN 'active'::canonical_listing_status ELSE latest.source_status::text::canonical_listing_status END,
        status_source = 'mirror',
        verification_state = CASE
          WHEN latest.property_match_kind = 'source_mismatch' OR latest.source_status = 'invalid' THEN 'invalid'
          WHEN latest.source_status = 'blocked' THEN 'validation_blocked'
          WHEN latest.source_status = 'parser_error' THEN 'validation_failed'
          WHEN latest.source_status = 'unknown' THEN 'validation_pending'
          ELSE 'validated'
        END,
        origin_summary = CASE
          WHEN c.origin_summary IN ('user', 'user_and_mirror') THEN 'user_and_mirror'
          ELSE 'mirror'
        END,
        submitted_by = COALESCE(c.submitted_by, latest.submitted_by),
        thumbnail_url = COALESCE(latest.payload->>'imageUrl', c.thumbnail_url),
        title = COALESCE(latest.payload->>'title', c.title),
        description = COALESCE(latest.payload->>'description', c.description),
        asking_price = COALESCE(latest.asking_price, c.asking_price),
        price_currency = COALESCE(latest.price_currency, c.price_currency),
        price_type = COALESCE(latest.payload->>'priceType', c.price_type),
        living_area_m2 = COALESCE(NULLIF(latest.payload->>'livingAreaM2', '')::integer, c.living_area_m2),
        first_seen_at = COALESCE(c.first_seen_at, latest.first_seen_at, latest.observed_at),
        last_seen_at = GREATEST(COALESCE(c.last_seen_at, latest.observed_at), COALESCE(latest.last_seen_at, latest.observed_at)),
        last_mirror_seen_at = GREATEST(COALESCE(c.last_mirror_seen_at, latest.observed_at), COALESCE(latest.last_seen_at, latest.observed_at)),
        last_reconciled_at = now(),
        updated_at = now()
      FROM latest
      WHERE c.source_name = latest.source_name
        AND c.canonical_url IS NOT NULL
        AND c.canonical_url = latest.source_url_canonical
      RETURNING c.id
    ),
    inserted AS (
      INSERT INTO canonical_listings (
        property_id,
        source_name,
        primary_source_listing_id,
        canonical_url,
        display_url,
        status,
        status_source,
        verification_state,
        origin_summary,
        submitted_by,
        thumbnail_url,
        title,
        description,
        asking_price,
        price_currency,
        price_type,
        living_area_m2,
        first_seen_at,
        last_seen_at,
        last_mirror_seen_at,
        last_reconciled_at
      )
      SELECT
        latest.property_id,
        latest.source_name,
        latest.source_listing_id,
        latest.source_url_canonical,
        COALESCE(latest.source_url_canonical, latest.source_url_raw),
        CASE WHEN latest.source_status = 'available' THEN 'active'::canonical_listing_status ELSE latest.source_status::text::canonical_listing_status END,
        'mirror'::canonical_listing_status_source,
        CASE
          WHEN latest.property_match_kind = 'source_mismatch' OR latest.source_status = 'invalid' THEN 'invalid'::canonical_listing_verification_state
          WHEN latest.source_status = 'blocked' THEN 'validation_blocked'::canonical_listing_verification_state
          WHEN latest.source_status = 'parser_error' THEN 'validation_failed'::canonical_listing_verification_state
          WHEN latest.source_status = 'unknown' THEN 'validation_pending'::canonical_listing_verification_state
          ELSE 'validated'::canonical_listing_verification_state
        END,
        'mirror'::canonical_listing_origin_summary,
        latest.submitted_by,
        latest.payload->>'imageUrl',
        latest.payload->>'title',
        latest.payload->>'description',
        latest.asking_price,
        latest.price_currency,
        latest.payload->>'priceType',
        NULLIF(latest.payload->>'livingAreaM2', '')::integer,
        COALESCE(latest.first_seen_at, latest.observed_at),
        COALESCE(latest.last_seen_at, latest.observed_at),
        COALESCE(latest.last_seen_at, latest.observed_at),
        now()
      FROM latest
      WHERE NOT EXISTS (
        SELECT 1
        FROM canonical_listings c
        WHERE c.source_name = latest.source_name
          AND (
            (latest.source_listing_id IS NOT NULL AND c.primary_source_listing_id = latest.source_listing_id)
            OR (latest.source_url_canonical IS NOT NULL AND c.canonical_url = latest.source_url_canonical)
          )
      )
      RETURNING id
    ),
    updated AS (
      UPDATE canonical_listings AS c
      SET
        property_id = latest.property_id,
        canonical_url = COALESCE(latest.source_url_canonical, c.canonical_url),
        display_url = COALESCE(latest.source_url_canonical, latest.source_url_raw, c.display_url),
        status = CASE WHEN latest.source_status = 'available' THEN 'active'::canonical_listing_status ELSE latest.source_status::text::canonical_listing_status END,
        status_source = 'mirror',
        verification_state = CASE
          WHEN latest.property_match_kind = 'source_mismatch' OR latest.source_status = 'invalid' THEN 'invalid'
          WHEN latest.source_status = 'blocked' THEN 'validation_blocked'
          WHEN latest.source_status = 'parser_error' THEN 'validation_failed'
          WHEN latest.source_status = 'unknown' THEN 'validation_pending'
          ELSE 'validated'
        END,
        origin_summary = CASE
          WHEN c.origin_summary IN ('user', 'user_and_mirror') THEN 'user_and_mirror'
          ELSE 'mirror'
        END,
        submitted_by = COALESCE(c.submitted_by, latest.submitted_by),
        thumbnail_url = COALESCE(latest.payload->>'imageUrl', c.thumbnail_url),
        title = COALESCE(latest.payload->>'title', c.title),
        description = COALESCE(latest.payload->>'description', c.description),
        asking_price = COALESCE(latest.asking_price, c.asking_price),
        price_currency = COALESCE(latest.price_currency, c.price_currency),
        price_type = COALESCE(latest.payload->>'priceType', c.price_type),
        living_area_m2 = COALESCE(NULLIF(latest.payload->>'livingAreaM2', '')::integer, c.living_area_m2),
        first_seen_at = COALESCE(c.first_seen_at, latest.first_seen_at, latest.observed_at),
        last_seen_at = GREATEST(COALESCE(c.last_seen_at, latest.observed_at), COALESCE(latest.last_seen_at, latest.observed_at)),
        last_mirror_seen_at = GREATEST(COALESCE(c.last_mirror_seen_at, latest.observed_at), COALESCE(latest.last_seen_at, latest.observed_at)),
        last_reconciled_at = now(),
        updated_at = now()
      FROM latest
      WHERE c.source_name = latest.source_name
        AND c.primary_source_listing_id = latest.source_listing_id
      RETURNING c.id
    ),
    linked AS (
      INSERT INTO listing_observation_links (
        canonical_listing_id,
        listing_observation_id,
        link_reason
      )
      SELECT
        c.id,
        obs.id,
        CASE
          WHEN c.primary_source_listing_id = obs.source_listing_id THEN 'source_identity'::listing_observation_link_reason
          WHEN c.canonical_url = obs.source_url_canonical THEN 'canonical_url'::listing_observation_link_reason
          ELSE 'manual_repair'::listing_observation_link_reason
        END
      FROM candidate_observations obs
      JOIN canonical_listings c
        ON c.source_name = obs.source_name
       AND (
         (obs.source_listing_id IS NOT NULL AND c.primary_source_listing_id = obs.source_listing_id)
         OR (obs.source_url_canonical IS NOT NULL AND c.canonical_url = obs.source_url_canonical)
       )
      ON CONFLICT (listing_observation_id) DO NOTHING
      RETURNING 1
    ),
    price_rows AS (
      INSERT INTO listing_price_observations (
        listing_observation_id,
        canonical_listing_id,
        property_id,
        source_name,
        source_listing_id,
        origin,
        price,
        currency,
        event_type,
        price_date,
        observed_at
      )
      SELECT
        obs.id,
        c.id,
        obs.property_id,
        obs.source_name,
        obs.source_listing_id,
        obs.origin,
        obs.asking_price,
        COALESCE(obs.price_currency, 'EUR'),
        'initial'::listing_price_observation_event_type,
        (COALESCE(obs.observed_at, obs.created_at))::date,
        COALESCE(obs.observed_at, obs.created_at)
      FROM candidate_observations obs
      JOIN canonical_listings c
        ON c.source_name = obs.source_name
       AND (
         (obs.source_listing_id IS NOT NULL AND c.primary_source_listing_id = obs.source_listing_id)
         OR (obs.source_url_canonical IS NOT NULL AND c.canonical_url = obs.source_url_canonical)
       )
      WHERE obs.asking_price IS NOT NULL
        AND obs.property_id IS NOT NULL
      ON CONFLICT DO NOTHING
      RETURNING 1
    ),
    marked AS (
      UPDATE listing_replay_staging
      SET processed_at = now()
      WHERE source_name = $1
        AND upstream_run_key = $2
      RETURNING 1
    )
    SELECT (
      SELECT count(*) FROM inserted
    ) + (
      SELECT count(*) FROM updated
    ) AS count
  `, [source, runKey]);

  return Number(result[0]?.count ?? 0);
}

async function batchInsertPriceObservations(
  mainDb: postgres.Sql,
  rows: PriceObservationRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  await mainDb.unsafe('DROP TABLE IF EXISTS _seed_price_input');
  await mainDb.unsafe(`
    CREATE TEMP TABLE _seed_price_input (
      property_id uuid NOT NULL,
      source_name varchar(50) NOT NULL,
      source_listing_id varchar(255),
      price bigint NOT NULL,
      price_date date NOT NULL,
      event_type listing_price_observation_event_type NOT NULL,
      observed_at timestamptz NOT NULL
    ) ON COMMIT DROP
  `);

  const COLS_PER_ROW = 7;
  const valueClauses: string[] = [];
  const params: unknown[] = [];
  for (let i = 0; i < rows.length; i++) {
    const base = i * COLS_PER_ROW;
    valueClauses.push(`(
      $${base + 1}::uuid,
      $${base + 2},
      $${base + 3},
      $${base + 4},
      $${base + 5}::date,
      $${base + 6}::listing_price_observation_event_type,
      $${base + 7}::timestamptz
    )`);
    const row = rows[i];
    params.push(
      row.property_id,
      row.source_name,
      row.source_listing_id,
      row.price,
      row.price_date,
      row.event_type,
      row.observed_at,
    );
  }

  await mainDb.unsafe(`
    INSERT INTO _seed_price_input (
      property_id,
      source_name,
      source_listing_id,
      price,
      price_date,
      event_type,
      observed_at
    )
    VALUES ${valueClauses.join(',\n')}
  `, params as (string | number | null | Date)[]);

  const result = await mainDb.unsafe(`
    WITH linked AS (
      SELECT
        input.property_id,
        input.source_name,
        input.source_listing_id,
        input.price,
        input.price_date,
        input.event_type,
        input.observed_at,
        c.id AS canonical_listing_id,
        obs.id AS listing_observation_id,
        obs.origin
      FROM _seed_price_input input
      JOIN canonical_listings c
        ON c.property_id = input.property_id
       AND c.source_name = input.source_name
       AND (
         (input.source_listing_id IS NOT NULL AND c.primary_source_listing_id = input.source_listing_id)
         OR (
           input.source_listing_id IS NULL
           AND c.primary_source_listing_id IS NULL
         )
       )
      JOIN LATERAL (
        SELECT o.id, o.origin
        FROM listing_observation_links link
        JOIN listing_observations o ON o.id = link.listing_observation_id
        WHERE link.canonical_listing_id = c.id
          AND (
            input.source_listing_id IS NULL
            OR o.source_listing_id = input.source_listing_id
          )
        ORDER BY o.observed_at DESC, o.created_at DESC
        LIMIT 1
      ) obs ON true
    ),
    ins AS (
      INSERT INTO listing_price_observations (
        listing_observation_id,
        canonical_listing_id,
        property_id,
        source_name,
        source_listing_id,
        origin,
        price,
        currency,
        event_type,
        price_date,
        observed_at
      )
      SELECT
        listing_observation_id,
        canonical_listing_id,
        property_id,
        source_name,
        source_listing_id,
        origin,
        price,
        'EUR',
        event_type,
        price_date,
        observed_at
      FROM linked
      ON CONFLICT DO NOTHING
      RETURNING property_id
    )
    SELECT property_id FROM ins
  `);

  await mainDb.unsafe('DROP TABLE IF EXISTS _seed_price_input');
  await advancePropertyChangeState(
    mainDb,
    result.map((row) => String(row.property_id)),
  );
  return result.count;
}

async function rebuildLegacyPriceHistoryProjection(
  mainDb: postgres.Sql,
  source: SourceName,
  runKey: string,
): Promise<number> {
  const result = await mainDb.unsafe(`
    WITH staged AS (
      SELECT DISTINCT source_name, source_listing_id
      FROM listing_replay_staging
      WHERE source_name = $1
        AND upstream_run_key = $2
    ),
    relevant AS (
      SELECT
        lpo.property_id,
        NULL::uuid AS listing_id,
        lpo.price,
        lpo.price_date,
        CASE
          WHEN lpo.event_type = 'status_change' THEN
            CASE WHEN c.status = 'rented' THEN 'rented' ELSE 'sold' END
          WHEN lpo.event_type = 'price_change' THEN 'price_change'
          ELSE 'asking_price'
        END AS event_type,
        lpo.source_name AS source
      FROM listing_price_observations lpo
      JOIN canonical_listings c ON c.id = lpo.canonical_listing_id
      JOIN staged
        ON staged.source_name = lpo.source_name
       AND (
         (staged.source_listing_id IS NOT NULL AND staged.source_listing_id = lpo.source_listing_id)
         OR (staged.source_listing_id IS NULL AND lpo.source_listing_id IS NULL)
       )
    ),
    ins AS (
      INSERT INTO price_history (
        property_id,
        listing_id,
        price,
        price_date,
        event_type,
        source
      )
      SELECT
        property_id,
        listing_id,
        price,
        price_date,
        event_type,
        source
      FROM relevant
      ON CONFLICT (property_id, price_date, price, event_type) DO NOTHING
      RETURNING property_id
    )
    SELECT property_id FROM ins
  `, [source, runKey]);

  await advancePropertyChangeState(
    mainDb,
    result.map((row) => String(row.property_id)),
  );
  return result.count;
}

async function refreshMaterializedView(mainDb: postgres.Sql, name: string): Promise<void> {
  const exists = await mainDb`
    SELECT to_regclass(${`public.${name}`})::text AS name
  `;
  if (!exists[0]?.name) return;
  await mainDb.unsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${name}`);
}

async function advancePropertyChangeState(
  mainDb: postgres.Sql,
  propertyIds: string[],
): Promise<void> {
  const uniquePropertyIds = [...new Set(propertyIds)].filter((id) => id.length > 0);
  if (uniquePropertyIds.length === 0) return;

  const valueClauses = uniquePropertyIds.map((_, index) => `($${index + 1}::uuid)`);
  const sql = `
    WITH changed(property_id) AS (
      VALUES ${valueClauses.join(',\n')}
    )
    INSERT INTO property_change_state (property_id, change_version, last_changed_at)
    SELECT property_id, 1, NOW()
    FROM changed
    ON CONFLICT (property_id) DO UPDATE SET
      change_version = property_change_state.change_version + 1,
      last_changed_at = EXCLUDED.last_changed_at
  `;

  await mainDb.unsafe(sql, uniquePropertyIds);
}

// ---------------------------------------------------------------------------
// Main logic
// ---------------------------------------------------------------------------

async function seedListings() {
  const globalStartTime = Date.now();

  console.log('='.repeat(60));
  console.log('Seed Listings from Mirror Databases');
  console.log('='.repeat(60));
  console.log(`Source:   ${SOURCE_FILTER}`);
  console.log(`Dry run:  ${DRY_RUN}`);
  console.log('');

  // Connect to databases
  const mainDb = postgres(MAIN_DB_URL, { max: 10, onnotice: () => {} });
  const fundaDb = postgres(FUNDA_DB_URL, { max: 3, onnotice: () => {} });
  const parariusDb = postgres(PARARIUS_DB_URL, { max: 3, onnotice: () => {} });

  const stats: Record<SourceName, SourceStats> = {
    funda: { matched: 0, skipped: 0, duplicates: 0, priceHistoryEntries: 0, errors: 0 },
    pararius: { matched: 0, skipped: 0, duplicates: 0, priceHistoryEntries: 0, errors: 0 },
  };

  try {
    // ------------------------------------------------------------------
    // Verify connections
    // ------------------------------------------------------------------
    console.log('Connecting to databases...');
    await mainDb`SELECT 1`;
    console.log('  Main DB: connected');
    if (SOURCE_FILTER === 'funda' || SOURCE_FILTER === 'both') {
      await fundaDb`SELECT 1`;
      console.log('  Funda mirror: connected');
    }
    if (SOURCE_FILTER === 'pararius' || SOURCE_FILTER === 'both') {
      await parariusDb`SELECT 1`;
      console.log('  Pararius mirror: connected');
    }
    console.log('');

    // ------------------------------------------------------------------
    // Step 1: Preload property lookup cache
    // ------------------------------------------------------------------
    console.log('Loading property lookup cache...');
    const cacheStartTime = Date.now();

    // Stream all properties using cursor-based pagination (keyset pagination)
    // LIMIT/OFFSET is O(n^2) at scale; WHERE id > last_id is O(n) via index
    const CACHE_BATCH = 100000;
    let totalLoaded = 0;
    let lastId = '00000000-0000-0000-0000-000000000000'; // UUID min

    while (true) {
      const rows = await mainDb`
        SELECT id, postal_code, house_number, house_number_addition
        FROM properties
        WHERE id > ${lastId}
        ORDER BY id
        LIMIT ${CACHE_BATCH}
      `;

      if (rows.length === 0) break;

      for (const row of rows) {
        const key = buildLookupKey(
          row.postal_code as string,
          row.house_number as number,
          (row.house_number_addition as string | null) || '',
        );
        propertyMap.set(key, row.id as string);
      }

      totalLoaded += rows.length;
      lastId = rows[rows.length - 1].id as string;

      process.stdout.write(`\r  Loading: ${totalLoaded.toLocaleString()} properties...`);
    }

    const cacheElapsed = Date.now() - cacheStartTime;
    console.log(`\r  \u2713 Loaded ${totalLoaded.toLocaleString()} properties into memory (${formatElapsedTime(cacheElapsed)})`);
    console.log('');

    if (!DRY_RUN) {
      await mainDb.unsafe('SET statement_timeout = \'600s\'');
    }

    // ------------------------------------------------------------------
    // Process each mirror source
    // ------------------------------------------------------------------

    async function processMirrorSource(
      source: SourceName,
      mirrorDb: postgres.Sql,
    ): Promise<void> {
      const sourceStats = stats[source];
      const runKey = `seed-listings:${source}`;

      console.log('='.repeat(60));
      console.log(`Processing ${source} mirror replay...`);
      console.log('='.repeat(60));

      // Count total listings
      const countResult = await mirrorDb`
        SELECT COUNT(*) as count
        FROM listings l
        JOIN addresses a ON l.address_id = a.id
      `;
      const totalListings = Number(countResult[0].count);
      console.log(`Total mirror listings: ${totalListings.toLocaleString()}`);

      if (!DRY_RUN) {
        await clearReplayRun(mainDb, source, runKey);
      }

      // Fetch and process listings in batches
      let offset = 0;
      const startTime = Date.now();
      let replayBuffer: ReplayStagingRow[] = [];
      let unmatchedBuffer: UnmatchedListing[] = [];
      let totalStaged = 0;

      while (offset < totalListings) {
        const batch: MirrorListing[] = await mirrorDb`
          SELECT l.*, a.street, a.house_number, a.house_number_addition,
                 a.postal_code, a.city, a.latitude, a.longitude
          FROM listings l
          JOIN addresses a ON l.address_id = a.id
          ORDER BY l.id
          LIMIT ${MIRROR_FETCH_SIZE} OFFSET ${offset}
        `;

        if (batch.length === 0) break;

        for (const row of batch) {
          // Skip listings without a postal code (cannot match)
          if (!row.postal_code) {
            sourceStats.skipped++;
            continue;
          }

          // In-memory lookup
          const propertyId = findPropertyIdSync(
            row.postal_code,
            row.house_number,
            row.house_number_addition,
          );

          if (propertyId) {
            replayBuffer.push(buildReplayRow(row, source, propertyId, 'source_exact'));
            sourceStats.matched++;
          } else if (row.latitude != null && row.longitude != null) {
            // Queue for spatial fallback
            let cacheKey: string;
            try {
              const canon = canonicalizeAddress({
                street: '',
                houseNumber: row.house_number,
                houseNumberAddition: row.house_number_addition,
                postalCode: row.postal_code,
                city: '',
              });
              cacheKey = canon
                ? buildLookupKey(canon.postalCode, canon.houseNumber, canon.houseNumberAddition)
                : buildLookupKey(row.postal_code, parseInt(row.house_number, 10) || 0, row.house_number_addition);
            } catch {
              cacheKey = buildLookupKey(row.postal_code, parseInt(row.house_number, 10) || 0, row.house_number_addition);
            }

            unmatchedBuffer.push({
              index: 0, // not used directly
              latitude: row.latitude,
              longitude: row.longitude,
              cacheKey,
              mirrorRow: row,
              source,
            });
          } else {
            sourceStats.skipped++;
          }

          if (replayBuffer.length >= BATCH_SIZE) {
            if (!DRY_RUN) {
              try {
                const inserted = await batchInsertReplayStaging(mainDb, source, runKey, replayBuffer);
                totalStaged += inserted;
              } catch (err) {
                sourceStats.errors++;
                if (sourceStats.errors <= 5) {
                  console.error(`\n  Error in replay staging batch: ${err}`);
                }
              }
            }
            replayBuffer = [];
          }
        }

        offset += batch.length;

        // Progress logging
        const elapsed = Date.now() - startTime;
        const rate = offset / (elapsed / 1000);
        process.stdout.write(
          `\r  Processing: ${offset.toLocaleString()}/${totalListings.toLocaleString()} ` +
          `| Matched: ${sourceStats.matched.toLocaleString()} ` +
          `| Skipped: ${sourceStats.skipped.toLocaleString()} ` +
          `| ${rate.toFixed(0)}/s`
        );
      }

      // Process spatial fallback for unmatched listings
      if (unmatchedBuffer.length > 0) {
        process.stdout.write(`\n  Running spatial fallback for ${unmatchedBuffer.length} listings...`);
        const spatialResults = await spatialFallbackBatch(mainDb, unmatchedBuffer);

        for (const item of unmatchedBuffer) {
          const propertyId = spatialResults.get(item.cacheKey);
          if (propertyId) {
            const row = item.mirrorRow;
            replayBuffer.push(buildReplayRow(row, source, propertyId, 'source_spatial'));
            sourceStats.matched++;
            // Also populate the in-memory cache for price history lookup
            propertyMap.set(item.cacheKey, propertyId);
          } else {
            sourceStats.skipped++;
          }
        }

        console.log(`  \u2713 Spatial fallback: ${spatialResults.size} matched, ${unmatchedBuffer.length - spatialResults.size} skipped`);
      }

      while (replayBuffer.length > 0 && !DRY_RUN) {
        const chunk = replayBuffer.splice(0, BATCH_SIZE);
        try {
          const inserted = await batchInsertReplayStaging(mainDb, source, runKey, chunk);
          totalStaged += inserted;
        } catch (err) {
          sourceStats.errors++;
          if (sourceStats.errors <= 5) {
            console.error(`\n  Error in final replay staging batch: ${err}`);
          }
        }
        replayBuffer = [];
      }

      const listingElapsed = Date.now() - startTime;
      console.log(`  \u2713 ${(DRY_RUN ? sourceStats.matched : totalStaged).toLocaleString()} rows prepared for replay in ${formatElapsedTime(listingElapsed)}`);

      if (!DRY_RUN) {
        console.log(`\nMaterializing ${source} replay observations...`);
        const observationsInserted = await materializeReplayObservations(mainDb, source, runKey);
        sourceStats.duplicates += Math.max(0, totalStaged - observationsInserted);
        console.log(`  \u2713 Inserted ${observationsInserted.toLocaleString()} replay observations`);

        console.log(`Reconciling ${source} canonical listings...`);
        const reconciled = await reconcileReplayRun(mainDb, source, runKey);
        console.log(`  \u2713 Reconciled ${reconciled.toLocaleString()} canonical listing rows`);
      }

      // ----------------------------------------------------------------
      // Import price history as provenance-aware price observations
      // ----------------------------------------------------------------

      console.log(`\nImporting ${source} price history...`);

      const phCountResult = await mirrorDb`
        SELECT COUNT(*) as count
        FROM price_history ph
        JOIN addresses a ON ph.address_id = a.id
      `;
      const totalPriceHistory = Number(phCountResult[0].count);
      console.log(`Total price history entries: ${totalPriceHistory.toLocaleString()}`);

      let phOffset = 0;
      const phStartTime = Date.now();
      let priceBuffer: PriceObservationRow[] = [];
      let totalPHInserted = 0;

      while (phOffset < totalPriceHistory) {
        const phBatch: MirrorPriceHistory[] = await mirrorDb`
          SELECT ph.*, a.postal_code, a.house_number, a.house_number_addition,
                 l.listing_url, l.funda_id, l.pararius_id
          FROM price_history ph
          JOIN addresses a ON ph.address_id = a.id
          LEFT JOIN listings l ON ph.listing_id = l.id
          ORDER BY ph.id
          LIMIT ${MIRROR_FETCH_SIZE} OFFSET ${phOffset}
        `;

        if (phBatch.length === 0) break;

        for (const row of phBatch) {
          if (!row.postal_code) continue;

          const propertyId = findPropertyIdSync(
            row.postal_code,
            row.house_number,
            row.house_number_addition,
          );

          if (!propertyId) continue;

          const price = centsToEuros(row.price_cents);
          if (price == null) continue;

          const linkedMirrorId = source === 'funda' ? row.funda_id : row.pararius_id;
          const linkedIdentity = row.listing_url
            ? resolveMirrorSourceIdentity(source, row.listing_url, linkedMirrorId)
            : null;

          priceBuffer.push({
            property_id: propertyId,
            source_name: source,
            source_listing_id: linkedIdentity?.sourceListingId ?? linkedMirrorId ?? null,
            price,
            price_date: row.price_date,
            event_type: mapPriceEventType(row.status),
            observed_at: `${row.price_date}T00:00:00Z`,
          });

          if (priceBuffer.length >= BATCH_SIZE) {
            if (!DRY_RUN) {
              try {
                const inserted = await batchInsertPriceObservations(mainDb, priceBuffer);
                totalPHInserted += inserted;
                sourceStats.priceHistoryEntries += inserted;
              } catch (err) {
                sourceStats.errors++;
                if (sourceStats.errors <= 10) {
                  console.error(`\n  Error in price observation batch: ${err}`);
                }
              }
            } else {
              sourceStats.priceHistoryEntries += priceBuffer.length;
            }
            priceBuffer = [];
          }
        }

        phOffset += phBatch.length;

        const phElapsed = Date.now() - phStartTime;
        const phRate = phOffset / (phElapsed / 1000);
        process.stdout.write(
          `\r  Imported: ${phOffset.toLocaleString()}/${totalPriceHistory.toLocaleString()} ` +
          `| ${phRate.toFixed(0)}/s`
        );
      }

      // Flush remaining price history buffer
      if (priceBuffer.length > 0) {
        if (!DRY_RUN) {
          try {
            const inserted = await batchInsertPriceObservations(mainDb, priceBuffer);
            totalPHInserted += inserted;
            sourceStats.priceHistoryEntries += inserted;
          } catch (err) {
            sourceStats.errors++;
            if (sourceStats.errors <= 10) {
              console.error(`\n  Error in final price observation batch: ${err}`);
            }
          }
        } else {
          sourceStats.priceHistoryEntries += priceBuffer.length;
        }
        priceBuffer = [];
      }

      const phElapsed = Date.now() - phStartTime;
      console.log(`\n  \u2713 Inserted ${(DRY_RUN ? sourceStats.priceHistoryEntries : totalPHInserted).toLocaleString()} price observations in ${formatElapsedTime(phElapsed)}`);

      if (!DRY_RUN) {
        const projected = await rebuildLegacyPriceHistoryProjection(mainDb, source, runKey);
        console.log(`  \u2713 Projected ${projected.toLocaleString()} compatibility price_history rows`);
      }
    }

    // ------------------------------------------------------------------
    // Run sources
    // ------------------------------------------------------------------

    if (SOURCE_FILTER === 'funda' || SOURCE_FILTER === 'both') {
      await processMirrorSource('funda', fundaDb);
      console.log('');
    }

    if (SOURCE_FILTER === 'pararius' || SOURCE_FILTER === 'both') {
      await processMirrorSource('pararius', parariusDb);
      console.log('');
    }

    // ------------------------------------------------------------------
    if (!DRY_RUN) {
      console.log('Running ANALYZE...');
      await mainDb.unsafe('ANALYZE listing_replay_staging');
      await mainDb.unsafe('ANALYZE listing_observations');
      await mainDb.unsafe('ANALYZE canonical_listings');
      await mainDb.unsafe('ANALYZE listing_price_observations');
      await mainDb.unsafe('ANALYZE price_history');
      console.log('  \u2713 ANALYZE complete');
      console.log('');

      console.log('Refreshing canonical listing views...');
      await refreshMaterializedView(mainDb, 'mv_latest_active_listings');
      await refreshMaterializedView(mainDb, 'mv_price_guess_start_market_summaries');
      console.log('  \u2713 Materialized views refreshed');
      console.log('');

      await mainDb.unsafe('RESET statement_timeout');
    }

    // ------------------------------------------------------------------
    // Summary
    // ------------------------------------------------------------------

    console.log('='.repeat(60));
    console.log('Summary');
    console.log('='.repeat(60));

    if (SOURCE_FILTER === 'funda' || SOURCE_FILTER === 'both') {
      const s = stats.funda;
      console.log(`Funda: ${s.matched.toLocaleString()} matched, ${s.skipped.toLocaleString()} skipped, ${s.duplicates.toLocaleString()} duplicate observations, ${s.priceHistoryEntries.toLocaleString()} price observations`);
      if (s.errors > 0) {
        console.log(`  Errors: ${s.errors.toLocaleString()}`);
      }
    }

    if (SOURCE_FILTER === 'pararius' || SOURCE_FILTER === 'both') {
      const s = stats.pararius;
      console.log(`Pararius: ${s.matched.toLocaleString()} matched, ${s.skipped.toLocaleString()} skipped, ${s.duplicates.toLocaleString()} duplicate observations, ${s.priceHistoryEntries.toLocaleString()} price observations`);
      if (s.errors > 0) {
        console.log(`  Errors: ${s.errors.toLocaleString()}`);
      }
    }

    console.log(`Property cache entries: ${propertyMap.size.toLocaleString()}`);
    console.log(`Total time: ${formatElapsedTime(Date.now() - globalStartTime)}`);

    if (DRY_RUN) {
      console.log('\n(DRY RUN - no database changes were made)');
    }

  } finally {
    // Close all connections
    console.log('\nClosing connections...');
    await mainDb.end();
    await fundaDb.end();
    await parariusDb.end();
    console.log('Done.');
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

seedListings().catch((error) => {
  console.error('Seed listings failed:', error);
  process.exit(1);
});
