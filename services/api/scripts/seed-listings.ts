// ---------------------------------------------------------------------------
// seed-listings.ts
//
// Bulk import of listings and price history from the Funda and Pararius mirror
// databases into the main HuisHype database.
//
// Strategy:
//   1. Preload ALL property addresses into an in-memory Map for O(1) lookups
//   2. Drop listing + price_history indexes before bulk inserts
//   3. Batch INSERT listings with multi-row VALUES (batch size 5000)
//   4. Batch INSERT price_history similarly
//   5. Recreate indexes after all inserts
//   6. ANALYZE affected tables
//
// Usage:
//   npx tsx scripts/seed-listings.ts [--dry-run] [--source funda|pararius|both]
// ---------------------------------------------------------------------------

import postgres from 'postgres';
import dotenv from 'dotenv';
import { canonicalizeAddress } from '../src/utils/address.js';

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

type ListingStatus = 'active' | 'sold' | 'rented' | 'withdrawn';
type SourceName = 'funda' | 'pararius';

// Batch row types for accumulation before INSERT
interface ListingRow {
  property_id: string;
  source_url: string;
  source_name: SourceName;
  asking_price: number | null;
  price_type: string | null;
  living_area_m2: number | null;
  num_rooms: number | null;
  energy_label: string | null;
  status: ListingStatus;
  mirror_listing_id: string | null;
  thumbnail_url: string | null;
  og_title: string;
  mirror_first_seen_at: Date | null;
  mirror_last_changed_at: Date | null;
  mirror_last_seen_at: Date | null;
}

interface PriceHistoryRow {
  property_id: string;
  price: number;
  price_date: string;
  event_type: string;
  source: string;
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

/** Map mirror listing status to main DB listing status. */
function mapListingStatus(mirrorStatus: string, source: SourceName): ListingStatus {
  const s = mirrorStatus.toLowerCase();
  if (s === 'available') return 'active';
  if (s === 'sold') return 'sold';
  if (s === 'rented') return 'rented';
  if (s === 'withdrawn') return 'withdrawn';
  // Fallback
  console.warn(`  Unknown ${source} listing status: "${mirrorStatus}", defaulting to "active"`);
  return 'active';
}

/** Map mirror price history status to main DB event_type. */
function mapPriceEventType(mirrorStatus: string): string {
  const s = mirrorStatus.toLowerCase();
  if (s === 'asking_price') return 'asking_price';
  if (s === 'sold') return 'sold';
  if (s === 'rented') return 'rented';
  return s; // pass through if unknown
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
// Index management
// ---------------------------------------------------------------------------

// Only drop non-unique indexes. Keep unique indexes needed for ON CONFLICT:
//   listings_source_url_idx (ON CONFLICT source_url)
//   price_history_dedup_idx (ON CONFLICT property_id, price_date, price, event_type)
const DROP_INDEXES_SQL = `
DROP INDEX IF EXISTS listings_property_id_idx;
DROP INDEX IF EXISTS listings_mirror_dedup_idx;
DROP INDEX IF EXISTS listings_source_status_idx;
DROP INDEX IF EXISTS listings_mirror_last_changed_idx;
DROP INDEX IF EXISTS listings_mirror_last_seen_idx;
DROP INDEX IF EXISTS price_history_property_date_idx;
DROP INDEX IF EXISTS price_history_listing_idx;
`;

const CREATE_INDEXES_SQL = [
  `CREATE INDEX IF NOT EXISTS listings_property_id_idx ON listings USING btree (property_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS listings_mirror_dedup_idx ON listings USING btree (source_name, mirror_listing_id) WHERE mirror_listing_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS listings_source_status_idx ON listings USING btree (source_name, status)`,
  `CREATE INDEX IF NOT EXISTS listings_mirror_last_changed_idx ON listings USING btree (mirror_last_changed_at)`,
  `CREATE INDEX IF NOT EXISTS listings_mirror_last_seen_idx ON listings USING btree (mirror_last_seen_at) WHERE status = 'active'`,
  `CREATE INDEX IF NOT EXISTS price_history_property_date_idx ON price_history USING btree (property_id, price_date)`,
  `CREATE INDEX IF NOT EXISTS price_history_listing_idx ON price_history USING btree (listing_id)`,
];

async function dropIndexes(mainDb: postgres.Sql): Promise<void> {
  // Execute each DROP individually since postgres.js unsafe doesn't support multi-statement
  const statements = DROP_INDEXES_SQL
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.startsWith('DROP'));

  for (const stmt of statements) {
    await mainDb.unsafe(stmt);
  }
}

async function createIndexes(mainDb: postgres.Sql): Promise<void> {
  for (const stmt of CREATE_INDEXES_SQL) {
    await mainDb.unsafe(stmt);
  }
}

// ---------------------------------------------------------------------------
// Batch INSERT helpers
// ---------------------------------------------------------------------------

async function batchInsertListings(
  mainDb: postgres.Sql,
  rows: ListingRow[],
): Promise<{ inserted: number; duplicates: number }> {
  if (rows.length === 0) return { inserted: 0, duplicates: 0 };

  const columns = [
    'property_id', 'source_url', 'source_name', 'asking_price', 'price_type',
    'living_area_m2', 'num_rooms', 'energy_label', 'status',
    'mirror_listing_id', 'thumbnail_url', 'og_title',
    'mirror_first_seen_at', 'mirror_last_changed_at', 'mirror_last_seen_at',
  ] as const;

  // Build parameterized multi-row VALUES
  const COLS_PER_ROW = columns.length; // 15
  const valueClauses: string[] = [];
  const params: unknown[] = [];

  for (let i = 0; i < rows.length; i++) {
    const base = i * COLS_PER_ROW;
    const placeholders = [];
    for (let j = 1; j <= COLS_PER_ROW; j++) {
      placeholders.push(`$${base + j}`);
    }
    valueClauses.push(`(${placeholders.join(', ')})`);

    const r = rows[i];
    params.push(
      r.property_id, r.source_url, r.source_name, r.asking_price, r.price_type,
      r.living_area_m2, r.num_rooms, r.energy_label, r.status,
      r.mirror_listing_id, r.thumbnail_url, r.og_title,
      r.mirror_first_seen_at, r.mirror_last_changed_at, r.mirror_last_seen_at,
    );
  }

  const sql = `
    INSERT INTO listings (${columns.join(', ')})
    VALUES ${valueClauses.join(',\n')}
    ON CONFLICT (source_url) DO NOTHING
  `;

  const result = await mainDb.unsafe(sql, params as (string | number | null | Date)[]);
  const inserted = result.count;
  const duplicates = rows.length - inserted;
  return { inserted, duplicates };
}

async function batchInsertPriceHistory(
  mainDb: postgres.Sql,
  rows: PriceHistoryRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const columns = ['property_id', 'price', 'price_date', 'event_type', 'source'] as const;
  const COLS_PER_ROW = columns.length; // 5
  const valueClauses: string[] = [];
  const params: unknown[] = [];

  for (let i = 0; i < rows.length; i++) {
    const base = i * COLS_PER_ROW;
    const placeholders = [];
    for (let j = 1; j <= COLS_PER_ROW; j++) {
      placeholders.push(`$${base + j}`);
    }
    valueClauses.push(`(${placeholders.join(', ')})`);

    const r = rows[i];
    params.push(r.property_id, r.price, r.price_date, r.event_type, r.source);
  }

  const sql = `
    INSERT INTO price_history (${columns.join(', ')})
    VALUES ${valueClauses.join(',\n')}
    ON CONFLICT (property_id, price_date, price, event_type) DO NOTHING
  `;

  const result = await mainDb.unsafe(sql, params as (string | number | null)[]);
  return result.count;
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

    // ------------------------------------------------------------------
    // Step 2: Drop indexes (skip in dry run)
    // ------------------------------------------------------------------
    if (!DRY_RUN) {
      console.log('Dropping listing/price_history indexes...');
      const dropStart = Date.now();
      await dropIndexes(mainDb);
      console.log(`  \u2713 Indexes dropped (${formatElapsedTime(Date.now() - dropStart)})`);
      console.log('');

      // Set a generous statement timeout for bulk operations
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

      console.log('='.repeat(60));
      console.log(`Processing ${source} mirror listings...`);
      console.log('='.repeat(60));

      // Count total listings
      const countResult = await mirrorDb`
        SELECT COUNT(*) as count
        FROM listings l
        JOIN addresses a ON l.address_id = a.id
      `;
      const totalListings = Number(countResult[0].count);
      console.log(`Total mirror listings: ${totalListings.toLocaleString()}`);

      // Fetch and process listings in batches
      let offset = 0;
      const startTime = Date.now();
      let listingBuffer: ListingRow[] = [];
      let unmatchedBuffer: UnmatchedListing[] = [];
      let totalInserted = 0;
      let totalDuplicates = 0;

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
            // Prepare listing row for batch insert
            const mirrorId = source === 'funda' ? row.funda_id : row.pararius_id;
            listingBuffer.push({
              property_id: propertyId,
              source_url: row.listing_url,
              source_name: source,
              asking_price: centsToEuros(row.asking_price_cents),
              price_type: row.price_type,
              living_area_m2: row.living_area_m2,
              num_rooms: row.num_rooms,
              energy_label: row.energy_label,
              status: mapListingStatus(row.status, source),
              mirror_listing_id: mirrorId ?? null,
              thumbnail_url: extractThumbnailUrl(row.photo_urls),
              og_title: buildOgTitle(row.street, row.house_number, row.house_number_addition, row.city, row.price_type),
              mirror_first_seen_at: row.first_seen_at,
              mirror_last_changed_at: row.last_changed_at,
              mirror_last_seen_at: row.last_seen_at,
            });
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

          // Flush listing buffer when it hits batch size
          if (listingBuffer.length >= BATCH_SIZE) {
            if (!DRY_RUN) {
              try {
                const result = await batchInsertListings(mainDb, listingBuffer);
                totalInserted += result.inserted;
                totalDuplicates += result.duplicates;
                sourceStats.duplicates += result.duplicates;
              } catch (err) {
                sourceStats.errors++;
                if (sourceStats.errors <= 5) {
                  console.error(`\n  Error in batch insert: ${err}`);
                }
              }
            }
            listingBuffer = [];
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
            const mirrorId = source === 'funda' ? row.funda_id : row.pararius_id;
            listingBuffer.push({
              property_id: propertyId,
              source_url: row.listing_url,
              source_name: source,
              asking_price: centsToEuros(row.asking_price_cents),
              price_type: row.price_type,
              living_area_m2: row.living_area_m2,
              num_rooms: row.num_rooms,
              energy_label: row.energy_label,
              status: mapListingStatus(row.status, source),
              mirror_listing_id: mirrorId ?? null,
              thumbnail_url: extractThumbnailUrl(row.photo_urls),
              og_title: buildOgTitle(row.street, row.house_number, row.house_number_addition, row.city, row.price_type),
              mirror_first_seen_at: row.first_seen_at,
              mirror_last_changed_at: row.last_changed_at,
              mirror_last_seen_at: row.last_seen_at,
            });
            sourceStats.matched++;
            // Also populate the in-memory cache for price history lookup
            propertyMap.set(item.cacheKey, propertyId);
          } else {
            sourceStats.skipped++;
          }
        }

        console.log(`  \u2713 Spatial fallback: ${spatialResults.size} matched, ${unmatchedBuffer.length - spatialResults.size} skipped`);
      }

      // Flush remaining listing buffer
      if (listingBuffer.length > 0 && !DRY_RUN) {
        try {
          const result = await batchInsertListings(mainDb, listingBuffer);
          totalInserted += result.inserted;
          totalDuplicates += result.duplicates;
          sourceStats.duplicates += result.duplicates;
        } catch (err) {
          sourceStats.errors++;
          if (sourceStats.errors <= 5) {
            console.error(`\n  Error in final batch insert: ${err}`);
          }
        }
        listingBuffer = [];
      }

      const listingElapsed = Date.now() - startTime;
      console.log(`  \u2713 Inserted ${(DRY_RUN ? sourceStats.matched : totalInserted).toLocaleString()} listings in ${formatElapsedTime(listingElapsed)}`);

      // ----------------------------------------------------------------
      // Import price history
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
      let priceBuffer: PriceHistoryRow[] = [];
      let totalPHInserted = 0;

      while (phOffset < totalPriceHistory) {
        const phBatch: MirrorPriceHistory[] = await mirrorDb`
          SELECT ph.*, a.postal_code, a.house_number, a.house_number_addition
          FROM price_history ph
          JOIN addresses a ON ph.address_id = a.id
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

          const eventType = mapPriceEventType(row.status);

          priceBuffer.push({
            property_id: propertyId,
            price,
            price_date: row.price_date,
            event_type: eventType,
            source,
          });

          // Flush price buffer when it hits batch size
          if (priceBuffer.length >= BATCH_SIZE) {
            if (!DRY_RUN) {
              try {
                const inserted = await batchInsertPriceHistory(mainDb, priceBuffer);
                totalPHInserted += inserted;
                sourceStats.priceHistoryEntries += inserted;
              } catch (err) {
                sourceStats.errors++;
                if (sourceStats.errors <= 10) {
                  console.error(`\n  Error in price history batch: ${err}`);
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
            const inserted = await batchInsertPriceHistory(mainDb, priceBuffer);
            totalPHInserted += inserted;
            sourceStats.priceHistoryEntries += inserted;
          } catch (err) {
            sourceStats.errors++;
            if (sourceStats.errors <= 10) {
              console.error(`\n  Error in final price history batch: ${err}`);
            }
          }
        } else {
          sourceStats.priceHistoryEntries += priceBuffer.length;
        }
        priceBuffer = [];
      }

      const phElapsed = Date.now() - phStartTime;
      console.log(`\n  \u2713 Inserted ${(DRY_RUN ? sourceStats.priceHistoryEntries : totalPHInserted).toLocaleString()} price history entries in ${formatElapsedTime(phElapsed)}`);
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
    // Step 5: Recreate indexes (skip in dry run)
    // ------------------------------------------------------------------
    if (!DRY_RUN) {
      console.log('Recreating indexes...');
      const idxStart = Date.now();
      await createIndexes(mainDb);
      console.log(`  \u2713 Indexes recreated in ${formatElapsedTime(Date.now() - idxStart)}`);
      console.log('');

      // Step 6: ANALYZE
      console.log('Running ANALYZE...');
      await mainDb.unsafe('ANALYZE listings');
      await mainDb.unsafe('ANALYZE price_history');
      console.log('  \u2713 ANALYZE complete');
      console.log('');

      // Reset statement_timeout
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
      console.log(`Funda: ${s.matched.toLocaleString()} matched, ${s.skipped.toLocaleString()} skipped, ${s.duplicates.toLocaleString()} duplicates, ${s.priceHistoryEntries.toLocaleString()} price_history`);
      if (s.errors > 0) {
        console.log(`  Errors: ${s.errors.toLocaleString()}`);
      }
    }

    if (SOURCE_FILTER === 'pararius' || SOURCE_FILTER === 'both') {
      const s = stats.pararius;
      console.log(`Pararius: ${s.matched.toLocaleString()} matched, ${s.skipped.toLocaleString()} skipped, ${s.duplicates.toLocaleString()} duplicates, ${s.priceHistoryEntries.toLocaleString()} price_history`);
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
