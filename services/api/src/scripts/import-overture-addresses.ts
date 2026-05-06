/**
 * Import Overture Maps address data into PostGIS.
 *
 * Uses DuckDB to query GeoParquet files (remote S3 or local) and bulk-loads
 * addresses into the properties table via a staging table + upsert.
 *
 * Usage:
 *   pnpm -C services/api run db:seed-overture                           # all European countries
 *   pnpm -C services/api run db:seed-overture -- --country NL           # just NL
 *   pnpm -C services/api run db:seed-overture -- --country NL,DE,BE     # multiple countries
 *   pnpm -C services/api run db:seed-overture -- --local /path/to/parquet  # use local file
 *   pnpm -C services/api run db:seed-overture -- --release 2026-02-18.0 # pin release version
 *   pnpm -C services/api run db:seed-overture -- --dry-run              # preview without DB changes
 */
import { execSync } from 'child_process';
import { existsSync, unlinkSync, statSync } from 'fs';
import postgres from 'postgres';
import dotenv from 'dotenv';
import {
  getAllCountryCodes,
  isValidCountryCode,
  type CountryCode,
} from '@huishype/shared/config';

dotenv.config({ quiet: true });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OVERTURE_S3_BUCKET = 's3://overturemaps-us-west-2/release';
const OVERTURE_THEME_PATH = 'theme=addresses/type=address/*';
const STAC_CATALOG_URL = 'https://stac.overturemaps.org/';
const FALLBACK_RELEASE = '2026-02-18.0';

/** Europe bbox for Parquet row-group pruning */
const EUROPE_BBOX = { xmin: -25, xmax: 45, ymin: 34, ymax: 72 };

const CSV_PATH = '/tmp/overture_addresses.csv';

const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://huishype:huishype_dev@localhost:5440/huishype';

// BAG identifiers are 16-digit numeric strings. When an NL property row already
// carries one, BAG is the authoritative source for geometry and should not be
// downgraded by a later Overture address-point refresh.
const NL_BAG_ROW_PRESERVE_CONDITION =
  "properties.country_code = 'NL' AND properties.national_id ~ '^[0-9]{16}$' AND properties.geometry IS NOT NULL";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function countCsvRows(filePath: string): number {
  try {
    const output = execSync(`wc -l < "${filePath}"`, { encoding: 'utf-8' }).trim();
    return Math.max(0, parseInt(output, 10) - 1); // subtract header
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  countries: CountryCode[];
  localPath?: string;
  release?: string;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  // --country NL or --country NL,DE,BE
  let countries: CountryCode[] = getAllCountryCodes();
  const countryIdx = args.indexOf('--country');
  if (countryIdx !== -1 && countryIdx + 1 < args.length) {
    const val = args[countryIdx + 1].toUpperCase();
    if (val !== 'ALL') {
      countries = val.split(',').map((c) => {
        const code = c.trim();
        if (!isValidCountryCode(code)) {
          console.error(`Unknown country code: ${code}`);
          console.error(`Valid codes: ${getAllCountryCodes().join(', ')}`);
          process.exit(1);
        }
        return code;
      });
    }
  }

  // --local /path/to/file.parquet
  const localIdx = args.indexOf('--local');
  const localPath =
    localIdx !== -1 && localIdx + 1 < args.length
      ? args[localIdx + 1]
      : undefined;

  // --release 2026-02-18.0
  const releaseIdx = args.indexOf('--release');
  const release =
    releaseIdx !== -1 && releaseIdx + 1 < args.length
      ? args[releaseIdx + 1]
      : undefined;

  const dryRun = args.includes('--dry-run');

  return { countries, localPath, release, dryRun };
}

// ---------------------------------------------------------------------------
// STAC catalog discovery
// ---------------------------------------------------------------------------

export async function discoverLatestRelease(): Promise<string> {
  try {
    const res = await fetch(STAC_CATALOG_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(`  STAC catalog returned ${res.status}, using fallback release`);
      return FALLBACK_RELEASE;
    }

    const catalog = (await res.json()) as {
      links?: Array<{ rel: string; href: string; title?: string }>;
    };

    // STAC catalogs list releases as child links
    const childLinks = (catalog.links ?? []).filter(
      (l) => l.rel === 'child',
    );

    if (childLinks.length === 0) {
      console.warn('  No child links in STAC catalog, using fallback release');
      return FALLBACK_RELEASE;
    }

    // Release titles are date-based: "2026-02-18.0", "2026-01-22.0", etc.
    // Sort descending to get the latest
    const releases = childLinks
      .map((l) => l.title || l.href.split('/').filter(Boolean).pop() || '')
      .filter((t) => /^\d{4}-\d{2}-\d{2}\.\d+$/.test(t))
      .sort()
      .reverse();

    if (releases.length > 0) {
      return releases[0];
    }

    console.warn('  Could not parse releases from STAC catalog, using fallback');
    return FALLBACK_RELEASE;
  } catch (err) {
    console.warn(`  STAC discovery failed: ${(err as Error).message}`);
    return FALLBACK_RELEASE;
  }
}

// ---------------------------------------------------------------------------
// DuckDB query construction
// ---------------------------------------------------------------------------

export function buildParquetSource(
  release: string,
  localPath?: string,
): string {
  if (localPath) {
    return `'${localPath}'`;
  }
  return `'${OVERTURE_S3_BUCKET}/${release}/${OVERTURE_THEME_PATH}'`;
}

export function buildCountryFilter(countries: CountryCode[]): string {
  const quoted = countries.map((c) => `'${c}'`).join(', ');
  return `country IN (${quoted})`;
}

/**
 * Build the DuckDB SQL query that extracts addresses from Overture GeoParquet.
 *
 * Overture address schema (as of 2025+):
 *   id, geometry, country, street, number, unit, postcode, postal_city,
 *   address_levels (list of {value, type})
 */
export function buildDuckDbQuery(
  parquetSource: string,
  countries: CountryCode[],
): string {
  const countryFilter = buildCountryFilter(countries);

  return `
    INSTALL spatial; LOAD spatial;
    INSTALL httpfs;  LOAD httpfs;

    SET s3_region = 'us-west-2';
    SET preserve_insertion_order = false;

    COPY (
      SELECT
        id,
        country,
        street,
        number AS house_number,
        unit,
        postcode,
        postal_city,
        -- Extract region from address_levels (first element, usually most general)
        CASE
          WHEN address_levels IS NOT NULL AND len(address_levels) > 0
          THEN address_levels[1].value
          ELSE NULL
        END AS region,
        ST_X(geometry) AS longitude,
        ST_Y(geometry) AS latitude
      FROM read_parquet(${parquetSource}, hive_partitioning=1)
      WHERE bbox.xmin BETWEEN ${EUROPE_BBOX.xmin} AND ${EUROPE_BBOX.xmax}
        AND bbox.ymin BETWEEN ${EUROPE_BBOX.ymin} AND ${EUROPE_BBOX.ymax}
        AND ${countryFilter}
        AND street IS NOT NULL
        AND number IS NOT NULL
    ) TO '${CSV_PATH}' (HEADER, DELIMITER ',');
  `;
}

// ---------------------------------------------------------------------------
// House number parsing
// ---------------------------------------------------------------------------

/**
 * Parse Overture's string house number into integer + addition.
 *
 * Examples:
 *   "42"    → { num: 42, addition: "" }
 *   "12a"   → { num: 12, addition: "A" }
 *   "12-14" → { num: 12, addition: "-14" }
 *   "3 bis" → { num: 3, addition: "BIS" }
 *   "abc"   → null (not parseable)
 */
export function parseHouseNumber(
  raw: string,
): { num: number; addition: string } | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Match leading digits
  const match = trimmed.match(/^(\d+)\s*(.*)/);
  if (!match) return null;

  const num = parseInt(match[1], 10);
  if (isNaN(num) || num <= 0) return null;

  const rest = match[2].trim().toUpperCase();
  return { num, addition: rest };
}

// ---------------------------------------------------------------------------
// Phase 1: DuckDB extraction to CSV
// ---------------------------------------------------------------------------

function phase1Extract(
  release: string,
  countries: CountryCode[],
  localPath?: string,
): number {
  console.log('\nPhase 1: DuckDB extraction to CSV...');

  const parquetSource = buildParquetSource(release, localPath);
  const query = buildDuckDbQuery(parquetSource, countries);

  console.log(`  Source: ${localPath || `${OVERTURE_S3_BUCKET}/${release}/...`}`);
  console.log(`  Countries: ${countries.join(', ')}`);

  // Remove existing CSV
  if (existsSync(CSV_PATH)) {
    unlinkSync(CSV_PATH);
  }

  const start = Date.now();

  // Write query to temp file to avoid shell escaping issues
  const queryFile = '/tmp/overture_query.sql';
  execSync(`cat > "${queryFile}" << 'DUCKDB_EOF'\n${query}\nDUCKDB_EOF`, {
    stdio: 'pipe',
  });

  try {
    execSync(`duckdb < "${queryFile}"`, {
      stdio: 'inherit',
      timeout: 60 * 60 * 1000, // 60 min for large remote queries
      env: {
        ...process.env,
        HOME: process.env.HOME, // DuckDB needs HOME for extension cache
      },
    });
  } catch (error) {
    console.error('  DuckDB extraction failed!');
    throw error;
  } finally {
    try {
      unlinkSync(queryFile);
    } catch {
      /* ignore */
    }
  }

  if (!existsSync(CSV_PATH)) {
    throw new Error(`DuckDB did not produce output CSV at ${CSV_PATH}`);
  }

  const rows = countCsvRows(CSV_PATH);
  const size = (statSync(CSV_PATH).size / (1024 * 1024)).toFixed(0);
  console.log(
    `  Extracted ${fmt(rows)} rows to ${CSV_PATH} (${size} MB) in ${formatTime(Date.now() - start)}`,
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Phase 2: COPY into staging table
// ---------------------------------------------------------------------------

async function phase2Copy(sql: postgres.Sql): Promise<number> {
  console.log('\nPhase 2: COPY CSV into staging table...');

  // Create UNLOGGED staging table
  await sql`DROP TABLE IF EXISTS overture_staging`;
  await sql`
    CREATE UNLOGGED TABLE overture_staging (
      id TEXT,
      country TEXT,
      street TEXT,
      house_number TEXT,
      unit TEXT,
      postcode TEXT,
      postal_city TEXT,
      region TEXT,
      longitude TEXT,
      latitude TEXT
    )
  `;

  const start = Date.now();

  // COPY via docker exec
  const copyCmd = `cat "${CSV_PATH}" | docker exec -i huishype-postgres psql -U huishype -d huishype -c "COPY overture_staging FROM STDIN WITH (FORMAT csv, HEADER true)"`;

  try {
    execSync(copyCmd, {
      maxBuffer: 500 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10 * 60 * 1000,
    });
  } catch (error) {
    console.error('  COPY into staging table failed!');
    throw error;
  }

  const result = await sql`SELECT COUNT(*)::int AS count FROM overture_staging`;
  const rowCount = result[0].count;
  console.log(
    `  Loaded ${fmt(rowCount)} rows in ${formatTime(Date.now() - start)}`,
  );
  return rowCount;
}

// ---------------------------------------------------------------------------
// Phase 3: Upsert into properties
// ---------------------------------------------------------------------------

async function phase3Upsert(sql: postgres.Sql): Promise<number> {
  console.log('\nPhase 3: Upsert into properties...');
  const start = Date.now();

  // Long statement timeout for heavy upsert
  await sql`SET statement_timeout = '0'`; // No timeout for heavy imports

  // Parse house_number string into integer + addition, then upsert.
  // We use the address-based unique index (country_code, postal_code, house_number, house_number_addition)
  // for deduplication. national_id is also set for Overture GERS tracking.
  const upsertQuery = buildOvertureUpsertQuery();

  const changedRows = await sql.unsafe(upsertQuery);
  const changedCount = Number(changedRows[0]?.changed_count ?? 0);

  await sql`SET statement_timeout = '0'`;

  const result = await sql`SELECT COUNT(*)::int AS count FROM properties`;
  const totalProperties = result[0].count;
  console.log(
    `  Upserted ${fmt(changedCount)} changed properties to ${fmt(totalProperties)} total properties in ${formatTime(Date.now() - start)}`,
  );
  if (changedCount > 0) {
    await requestPropertyTileSnapshotRefreshAfterBulkImport('overture-address-import');
  }
  return totalProperties;
}

export function buildOvertureUpsertQuery(): string {
  return `
    WITH changed_properties AS (
    INSERT INTO properties (
      country_code, national_id, street, house_number, house_number_addition,
      postal_code, city, region, geometry
    )
    SELECT
      UPPER(deduped.country),
      deduped.id,
      deduped.street,
      parsed.parsed_num,
      COALESCE(parsed.parsed_addition, ''),
      UPPER(REPLACE(COALESCE(deduped.postcode, ''), ' ', '')),
      COALESCE(deduped.postal_city, deduped.region, 'Unknown'),
      deduped.region,
      ST_SetSRID(ST_MakePoint(deduped.longitude::double precision, deduped.latitude::double precision), 4326)
    FROM (
      SELECT DISTINCT ON (
        UPPER(country),
        street,
        UPPER(REPLACE(COALESCE(postcode, ''), ' ', '')),
        (regexp_match(house_number, '^(\\d+)'))[1]::int,
        COALESCE(UPPER(NULLIF(
          CONCAT_WS('',
            NULLIF(regexp_replace(house_number, '^\\d+\\s*', ''), ''),
            CASE WHEN unit IS NOT NULL AND unit != '' THEN '-' || unit ELSE '' END
          ), ''
        )), '')
      )
        id, country, street, house_number, unit, postcode, postal_city, region,
        longitude, latitude
      FROM overture_staging
      WHERE house_number ~ '^\\d+'
        AND postcode IS NOT NULL
        AND postcode != ''
      ORDER BY
        UPPER(country),
        street,
        UPPER(REPLACE(COALESCE(postcode, ''), ' ', '')),
        (regexp_match(house_number, '^(\\d+)'))[1]::int,
        COALESCE(UPPER(NULLIF(
          CONCAT_WS('',
            NULLIF(regexp_replace(house_number, '^\\d+\\s*', ''), ''),
            CASE WHEN unit IS NOT NULL AND unit != '' THEN '-' || unit ELSE '' END
          ), ''
        )), ''),
        id
    ) AS deduped
    CROSS JOIN LATERAL (
      SELECT
        (regexp_match(deduped.house_number, '^(\\d+)'))[1]::int AS parsed_num,
        COALESCE(UPPER(NULLIF(
          CONCAT_WS('',
            NULLIF(regexp_replace(deduped.house_number, '^\\d+\\s*', ''), ''),
            CASE WHEN deduped.unit IS NOT NULL AND deduped.unit != '' THEN '-' || deduped.unit ELSE '' END
          ), ''
        )), '') AS parsed_addition
    ) AS parsed
    ON CONFLICT (country_code, street, postal_code, house_number, house_number_addition) DO UPDATE SET
      national_id = CASE
        WHEN ${NL_BAG_ROW_PRESERVE_CONDITION} THEN properties.national_id
        ELSE EXCLUDED.national_id
      END,
      city = EXCLUDED.city,
      region = EXCLUDED.region,
      geometry = CASE
        WHEN ${NL_BAG_ROW_PRESERVE_CONDITION} THEN properties.geometry
        ELSE EXCLUDED.geometry
      END,
      updated_at = NOW()
      WHERE properties.national_id IS DISTINCT FROM CASE
          WHEN ${NL_BAG_ROW_PRESERVE_CONDITION} THEN properties.national_id
          ELSE EXCLUDED.national_id
        END
        OR properties.city IS DISTINCT FROM EXCLUDED.city
        OR properties.region IS DISTINCT FROM EXCLUDED.region
        OR properties.geometry IS DISTINCT FROM CASE
          WHEN ${NL_BAG_ROW_PRESERVE_CONDITION} THEN properties.geometry
          ELSE EXCLUDED.geometry
        END
      RETURNING id
    ),
    changed_read_state AS (
      INSERT INTO property_change_state (property_id, change_version, last_changed_at)
      SELECT id, 1, NOW()
      FROM changed_properties
      ON CONFLICT (property_id) DO UPDATE SET
        change_version = property_change_state.change_version + 1,
        last_changed_at = EXCLUDED.last_changed_at
      RETURNING property_id
    )
    SELECT COUNT(*)::int AS changed_count
    FROM changed_read_state
  `;
}

async function requestPropertyTileSnapshotRefreshAfterBulkImport(
  reason: string,
): Promise<void> {
  const { requestPropertyTileSnapshotRefreshAfterBulkImport: requestRefresh } = await import(
    '../services/property-tile-snapshots.js'
  );
  const result = await requestRefresh(reason);
  console.log(
    `  Requested property tile snapshot refresh (reason: ${reason}, enqueue: ${result.enqueueStatus})`,
  );
}

// ---------------------------------------------------------------------------
// Phase 4: Cleanup + ANALYZE
// ---------------------------------------------------------------------------

async function phase4Cleanup(sql: postgres.Sql): Promise<void> {
  console.log('\nPhase 4: Cleanup + ANALYZE...');
  const start = Date.now();
  await sql`DROP TABLE IF EXISTS overture_staging`;
  await sql`ANALYZE properties`;
  console.log(`  Done in ${formatTime(Date.now() - start)}`);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

async function showValidation(sql: postgres.Sql): Promise<void> {
  const countResult = await sql`SELECT COUNT(*)::int AS count FROM properties`;
  console.log(`\nTotal properties in database: ${fmt(countResult[0].count)}`);

  // Per-country breakdown
  const countryStats = await sql`
    SELECT country_code, COUNT(*)::int AS count
    FROM properties
    GROUP BY country_code
    ORDER BY count DESC
    LIMIT 20
  `;

  if (countryStats.length > 0) {
    console.log('\nProperties by country:');
    countryStats.forEach((row) => {
      console.log(`  ${row.country_code}: ${fmt(row.count)}`);
    });
  }

  // Sample addresses
  const samples = await sql`
    SELECT street, house_number, house_number_addition, postal_code, city, country_code
    FROM properties
    ORDER BY RANDOM()
    LIMIT 5
  `;

  if (samples.length > 0) {
    console.log('\nSample addresses:');
    samples.forEach((row, i) => {
      const addition = row.house_number_addition || '';
      console.log(
        `  ${i + 1}. [${row.country_code}] ${row.street} ${row.house_number}${addition}, ${row.postal_code} ${row.city}`,
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const totalStart = Date.now();
  const { countries, localPath, release: pinnedRelease, dryRun } = parseArgs();

  console.log('='.repeat(60));
  console.log('Overture Maps Address Import');
  console.log('='.repeat(60));

  // Discover or use pinned release
  let release: string;
  if (pinnedRelease) {
    release = pinnedRelease;
    console.log(`  Release: ${release} (pinned via --release)`);
  } else if (localPath) {
    release = 'local';
    console.log(`  Source: ${localPath}`);
  } else {
    console.log('  Discovering latest Overture release...');
    release = await discoverLatestRelease();
    console.log(`  Release: ${release}`);
  }

  console.log(`  Countries: ${countries.join(', ')}`);
  if (dryRun) console.log('  Mode: DRY RUN');

  // Phase 1: Extract
  const rowCount = phase1Extract(release, countries, localPath);

  if (rowCount === 0) {
    console.log('\nNo addresses extracted. Nothing to import.');
    return;
  }

  if (dryRun) {
    console.log('\n  DRY RUN — stopping before database changes');
    return;
  }

  // Connect to PostgreSQL
  const sql = postgres(DB_URL, {
    max: 3,
    idle_timeout: 0,
    connect_timeout: 30,
    onnotice: () => {},
  });

  try {
    // Phase 2: COPY into staging
    await phase2Copy(sql);

    // Phase 3: Upsert
    await phase3Upsert(sql);

    // Phase 4: Cleanup
    await phase4Cleanup(sql);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('Import Complete');
    console.log('='.repeat(60));

    await showValidation(sql);

    console.log(`\nTotal time: ${formatTime(Date.now() - totalStart)}`);
  } catch (error) {
    // Clean up staging on failure
    try {
      await sql`DROP TABLE IF EXISTS overture_staging`;
    } catch {
      /* ignore */
    }
    throw error;
  } finally {
    await sql.end();
  }
}

// Only run when executed directly (not when imported for testing)
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].includes('import-overture-addresses') ||
    process.argv[1].includes('tsx'));

if (isDirectRun) {
  main().catch((error) => {
    console.error('\nOverture import failed:', error);
    process.exit(1);
  });
}
