// ---------------------------------------------------------------------------
// seed-listings.ts
//
// One-time bulk import of listings and price history from the Funda and
// Pararius mirror databases into the main HuisHype database.
//
// Usage:
//   npx tsx scripts/seed-listings.ts [--dry-run] [--source funda|pararius|both] [--city Eindhoven]
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
const CITY_FILTER = getArgValue('--city') ?? null;
const BATCH_SIZE = 500;

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

/** Cache key for property lookups by address. */
function addressCacheKey(postalCode: string, houseNumber: string, houseNumberAddition: string | null): string {
  return `${postalCode}|${houseNumber}|${houseNumberAddition ?? ''}`;
}

// ---------------------------------------------------------------------------
// Main logic
// ---------------------------------------------------------------------------

async function seedListings() {
  console.log('='.repeat(60));
  console.log('Seed Listings from Mirror Databases');
  console.log('='.repeat(60));
  console.log(`Source:   ${SOURCE_FILTER}`);
  console.log(`City:     ${CITY_FILTER ?? '(all)'}`);
  console.log(`Dry run:  ${DRY_RUN}`);
  console.log(`Batch:    ${BATCH_SIZE}`);
  console.log('');

  // Connect to databases
  const mainDb = postgres(MAIN_DB_URL, { max: 5, onnotice: () => {} });
  const fundaDb = postgres(FUNDA_DB_URL, { max: 3, onnotice: () => {} });
  const parariusDb = postgres(PARARIUS_DB_URL, { max: 3, onnotice: () => {} });

  // Property lookup cache: addressCacheKey -> property UUID (or null for "not found")
  const propertyCache = new Map<string, string | null>();

  const stats: Record<SourceName, SourceStats> = {
    funda: { matched: 0, skipped: 0, duplicates: 0, priceHistoryEntries: 0, errors: 0 },
    pararius: { matched: 0, skipped: 0, duplicates: 0, priceHistoryEntries: 0, errors: 0 },
  };

  try {
    // Verify connections
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
    // Property lookup helper
    // ------------------------------------------------------------------

    async function findPropertyId(
      postalCode: string,
      houseNumber: string,
      houseNumberAddition: string | null,
      latitude: number | null,
      longitude: number | null,
    ): Promise<string | null> {
      // Try canonicalize to get a normalized house number (integer) and addition
      let canonPostalCode: string;
      let canonHouseNumber: number;
      let canonAddition: string | null;

      try {
        const canon = canonicalizeAddress({
          street: '', // not needed for lookup
          houseNumber,
          houseNumberAddition,
          postalCode,
          city: '', // not needed for lookup
        });
        canonPostalCode = canon.postalCode;
        canonHouseNumber = canon.houseNumber;
        canonAddition = canon.houseNumberAddition;
      } catch {
        // If canonicalization fails (e.g. non-numeric house number), skip
        return null;
      }

      const cacheKey = addressCacheKey(canonPostalCode, String(canonHouseNumber), canonAddition);

      if (propertyCache.has(cacheKey)) {
        return propertyCache.get(cacheKey)!;
      }

      // Look up by address
      const rows = await mainDb`
        SELECT id FROM properties
        WHERE postal_code = ${canonPostalCode}
          AND house_number = ${canonHouseNumber}
          AND house_number_addition IS NOT DISTINCT FROM ${canonAddition}
        LIMIT 1
      `;

      if (rows.length > 0) {
        const id = rows[0].id as string;
        propertyCache.set(cacheKey, id);
        return id;
      }

      // PostGIS fallback if lat/lon available
      if (latitude != null && longitude != null) {
        const geoRows = await mainDb`
          SELECT id FROM properties
          WHERE ST_DWithin(
            geometry::geography,
            ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
            50
          )
          ORDER BY geometry::geography <-> ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
          LIMIT 1
        `;

        if (geoRows.length > 0) {
          const id = geoRows[0].id as string;
          propertyCache.set(cacheKey, id);
          return id;
        }
      }

      // Not found
      propertyCache.set(cacheKey, null);
      return null;
    }

    // ------------------------------------------------------------------
    // Process a single mirror source
    // ------------------------------------------------------------------

    async function processMirrorSource(
      source: SourceName,
      mirrorDb: postgres.Sql,
    ): Promise<void> {
      const mirrorIdField = source === 'funda' ? 'funda_id' : 'pararius_id';
      const sourceStats = stats[source];

      console.log(`\n${'='.repeat(60)}`);
      console.log(`Processing ${source} mirror listings...`);
      console.log(`${'='.repeat(60)}`);

      // Count total listings
      const cityClause = CITY_FILTER ? mirrorDb`WHERE a.city ILIKE ${CITY_FILTER}` : mirrorDb``;
      const countResult = await mirrorDb`
        SELECT COUNT(*) as count
        FROM listings l
        JOIN addresses a ON l.address_id = a.id
        ${cityClause}
      `;
      const totalListings = Number(countResult[0].count);
      console.log(`Total mirror listings: ${totalListings.toLocaleString()}`);

      // Process listings in batches
      let offset = 0;
      const startTime = Date.now();

      while (offset < totalListings) {
        const batch: MirrorListing[] = CITY_FILTER
          ? await mirrorDb`
              SELECT l.*, a.street, a.house_number, a.house_number_addition,
                     a.postal_code, a.city, a.latitude, a.longitude
              FROM listings l
              JOIN addresses a ON l.address_id = a.id
              WHERE a.city ILIKE ${CITY_FILTER}
              ORDER BY l.id
              LIMIT ${BATCH_SIZE} OFFSET ${offset}
            `
          : await mirrorDb`
              SELECT l.*, a.street, a.house_number, a.house_number_addition,
                     a.postal_code, a.city, a.latitude, a.longitude
              FROM listings l
              JOIN addresses a ON l.address_id = a.id
              ORDER BY l.id
              LIMIT ${BATCH_SIZE} OFFSET ${offset}
            `;

        if (batch.length === 0) break;

        for (const row of batch) {
          // Skip listings without a postal code (cannot match)
          if (!row.postal_code) {
            sourceStats.skipped++;
            continue;
          }

          const propertyId = await findPropertyId(
            row.postal_code,
            row.house_number,
            row.house_number_addition,
            row.latitude,
            row.longitude,
          );

          if (!propertyId) {
            sourceStats.skipped++;
            continue;
          }

          const mirrorId = source === 'funda' ? row.funda_id : row.pararius_id;
          const askingPrice = centsToEuros(row.asking_price_cents);
          const thumbnailUrl = extractThumbnailUrl(row.photo_urls);
          const ogTitle = buildOgTitle(
            row.street,
            row.house_number,
            row.house_number_addition,
            row.city,
            row.price_type,
          );
          const listingStatus = mapListingStatus(row.status, source);

          if (!DRY_RUN) {
            try {
              const result = await mainDb`
                INSERT INTO listings (
                  property_id, source_url, source_name, asking_price, price_type,
                  living_area_m2, num_rooms, energy_label, status,
                  mirror_listing_id, thumbnail_url, og_title,
                  mirror_first_seen_at, mirror_last_changed_at, mirror_last_seen_at
                ) VALUES (
                  ${propertyId}, ${row.listing_url}, ${source}, ${askingPrice}, ${row.price_type},
                  ${row.living_area_m2}, ${row.num_rooms}, ${row.energy_label}, ${listingStatus},
                  ${mirrorId ?? null}, ${thumbnailUrl}, ${ogTitle},
                  ${row.first_seen_at}, ${row.last_changed_at}, ${row.last_seen_at}
                )
                ON CONFLICT (source_url) DO NOTHING
              `;

              if (result.count === 0) {
                sourceStats.duplicates++;
              } else {
                sourceStats.matched++;
              }
            } catch (err) {
              sourceStats.errors++;
              if (sourceStats.errors <= 5) {
                console.error(`\n  Error inserting listing ${mirrorId}: ${err}`);
              }
            }
          } else {
            sourceStats.matched++;
          }
        }

        offset += batch.length;

        // Progress logging
        const elapsed = Date.now() - startTime;
        const rate = offset / (elapsed / 1000);
        const processed = sourceStats.matched + sourceStats.skipped + sourceStats.duplicates + sourceStats.errors;
        process.stdout.write(
          `\r  Processed: ${offset.toLocaleString()}/${totalListings.toLocaleString()} ` +
          `| Matched: ${sourceStats.matched.toLocaleString()} ` +
          `| Skipped: ${sourceStats.skipped.toLocaleString()} ` +
          `| Dupes: ${sourceStats.duplicates.toLocaleString()} ` +
          `| ${rate.toFixed(0)}/s`
        );
      }

      console.log(''); // newline after progress

      // ------------------------------------------------------------------
      // Import price history
      // ------------------------------------------------------------------

      console.log(`\nImporting ${source} price history...`);

      const phCountResult = await mirrorDb`
        SELECT COUNT(*) as count
        FROM price_history ph
        JOIN addresses a ON ph.address_id = a.id
        ${CITY_FILTER ? mirrorDb`WHERE a.city ILIKE ${CITY_FILTER}` : mirrorDb``}
      `;
      const totalPriceHistory = Number(phCountResult[0].count);
      console.log(`Total mirror price history entries: ${totalPriceHistory.toLocaleString()}`);

      let phOffset = 0;
      const phStartTime = Date.now();

      while (phOffset < totalPriceHistory) {
        const phBatch: MirrorPriceHistory[] = CITY_FILTER
          ? await mirrorDb`
              SELECT ph.*, a.postal_code, a.house_number, a.house_number_addition
              FROM price_history ph
              JOIN addresses a ON ph.address_id = a.id
              WHERE a.city ILIKE ${CITY_FILTER}
              ORDER BY ph.id
              LIMIT ${BATCH_SIZE} OFFSET ${phOffset}
            `
          : await mirrorDb`
              SELECT ph.*, a.postal_code, a.house_number, a.house_number_addition
              FROM price_history ph
              JOIN addresses a ON ph.address_id = a.id
              ORDER BY ph.id
              LIMIT ${BATCH_SIZE} OFFSET ${phOffset}
            `;

        if (phBatch.length === 0) break;

        for (const row of phBatch) {
          if (!row.postal_code) continue;

          const propertyId = await findPropertyId(
            row.postal_code,
            row.house_number,
            row.house_number_addition,
            null,
            null,
          );

          if (!propertyId) continue;

          const price = centsToEuros(row.price_cents);
          if (price == null) continue;

          const eventType = mapPriceEventType(row.status);

          if (!DRY_RUN) {
            try {
              const result = await mainDb`
                INSERT INTO price_history (
                  property_id, price, price_date, event_type, source
                ) VALUES (
                  ${propertyId}, ${price}, ${row.price_date}, ${eventType}, ${source}
                )
                ON CONFLICT (property_id, price_date, price, event_type) DO NOTHING
              `;

              if (result.count > 0) {
                sourceStats.priceHistoryEntries++;
              }
            } catch (err) {
              if (sourceStats.errors <= 10) {
                console.error(`\n  Error inserting price history: ${err}`);
              }
              sourceStats.errors++;
            }
          } else {
            sourceStats.priceHistoryEntries++;
          }
        }

        phOffset += phBatch.length;

        const phElapsed = Date.now() - phStartTime;
        const phRate = phOffset / (phElapsed / 1000);
        process.stdout.write(
          `\r  Price history: ${phOffset.toLocaleString()}/${totalPriceHistory.toLocaleString()} ` +
          `| Imported: ${sourceStats.priceHistoryEntries.toLocaleString()} ` +
          `| ${phRate.toFixed(0)}/s`
        );
      }

      console.log(''); // newline after progress
    }

    // ------------------------------------------------------------------
    // Run sources
    // ------------------------------------------------------------------

    if (SOURCE_FILTER === 'funda' || SOURCE_FILTER === 'both') {
      await processMirrorSource('funda', fundaDb);
    }

    if (SOURCE_FILTER === 'pararius' || SOURCE_FILTER === 'both') {
      await processMirrorSource('pararius', parariusDb);
    }

    // ------------------------------------------------------------------
    // Summary
    // ------------------------------------------------------------------

    console.log(`\n${'='.repeat(60)}`);
    console.log('Seed Listings Summary');
    console.log('='.repeat(60));

    if (SOURCE_FILTER === 'funda' || SOURCE_FILTER === 'both') {
      const s = stats.funda;
      console.log('');
      console.log('Funda:');
      console.log(`  Matched: ${s.matched.toLocaleString()} listings`);
      console.log(`  Skipped (no property): ${s.skipped.toLocaleString()}`);
      console.log(`  Duplicates: ${s.duplicates.toLocaleString()}`);
      console.log(`  Price history entries: ${s.priceHistoryEntries.toLocaleString()}`);
      if (s.errors > 0) {
        console.log(`  Errors: ${s.errors.toLocaleString()}`);
      }
    }

    if (SOURCE_FILTER === 'pararius' || SOURCE_FILTER === 'both') {
      const s = stats.pararius;
      console.log('');
      console.log('Pararius:');
      console.log(`  Matched: ${s.matched.toLocaleString()} listings`);
      console.log(`  Skipped (no property): ${s.skipped.toLocaleString()}`);
      console.log(`  Duplicates: ${s.duplicates.toLocaleString()}`);
      console.log(`  Price history entries: ${s.priceHistoryEntries.toLocaleString()}`);
      if (s.errors > 0) {
        console.log(`  Errors: ${s.errors.toLocaleString()}`);
      }
    }

    console.log('');
    console.log(`Property cache entries: ${propertyCache.size.toLocaleString()}`);

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
