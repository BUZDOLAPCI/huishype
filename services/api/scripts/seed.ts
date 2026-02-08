import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, statSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const BAG_PATH = resolve(__dirname, '../../../data_sources/bag-light.gpkg');
const CSV_PATH = '/tmp/vbo_extract.csv';

// Docker / DB constants
const DOCKER_CONTAINER = 'huishype-postgres';
const DB_USER = 'huishype';
const DB_NAME = 'huishype';

/**
 * Format elapsed time as human-readable string.
 */
function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Count lines in a file (excluding the header row).
 */
function countCsvRows(filePath: string): number {
  try {
    const output = execSync(`wc -l < "${filePath}"`, { encoding: 'utf-8' }).trim();
    const totalLines = parseInt(output, 10);
    return Math.max(0, totalLines - 1); // subtract header
  } catch {
    return 0;
  }
}

/**
 * Format a number with thousand separators.
 */
function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

// ---------------------------------------------------------------------------
// Phase 1: Extract to CSV with ogr2ogr
// ---------------------------------------------------------------------------
function phase1Extract(skipDemolished: boolean): number {
  console.log('\nPhase 1: Extract to CSV with ogr2ogr...');
  console.log(`  Extracting from bag-light.gpkg with -t_srs EPSG:4326...`);

  if (!existsSync(BAG_PATH)) {
    throw new Error(`BAG GeoPackage not found at: ${BAG_PATH}`);
  }

  // Remove existing CSV — ogr2ogr -overwrite doesn't work reliably for CSV
  if (existsSync(CSV_PATH)) {
    unlinkSync(CSV_PATH);
  }

  // Build WHERE clause
  const conditions = ['huisnummer IS NOT NULL', 'openbare_ruimte_naam IS NOT NULL'];
  if (skipDemolished) {
    conditions.push("status NOT LIKE '%ingetrokken%'");
  }
  const whereClause = conditions.join(' AND ');

  const sqlQuery = [
    'SELECT identificatie, oppervlakte, bouwjaar, status,',
    '       openbare_ruimte_naam, huisnummer, huisletter, toevoeging,',
    '       postcode, woonplaats_naam, geom',
    'FROM verblijfsobject',
    `WHERE ${whereClause}`,
  ].join(' ');

  const command = [
    'ogr2ogr',
    '-f CSV',
    `"${CSV_PATH}"`,
    `"${BAG_PATH}"`,
    `-sql "${sqlQuery}"`,
    '-t_srs EPSG:4326',
    '-lco GEOMETRY=AS_WKT',
    '--config OGR_SQLITE_SYNCHRONOUS OFF',
    '-overwrite',
  ].join(' ');

  const start = Date.now();

  try {
    execSync(command, {
      maxBuffer: 500 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30 * 60 * 1000, // 30 minutes
    });
  } catch (error) {
    console.error('  ogr2ogr extraction failed!');
    throw error;
  }

  const rows = countCsvRows(CSV_PATH);
  const size = existsSync(CSV_PATH) ? (statSync(CSV_PATH).size / (1024 * 1024)).toFixed(0) : '?';
  console.log(`  Extracted ${fmt(rows)} rows to ${CSV_PATH} (${size} MB) in ${formatTime(Date.now() - start)}`);
  return rows;
}

// ---------------------------------------------------------------------------
// Phase 2: COPY into staging table
// ---------------------------------------------------------------------------
async function phase2Copy(sql: postgres.Sql): Promise<number> {
  console.log('\nPhase 2: COPY into staging table...');

  // Create UNLOGGED staging table (visible across sessions, fast writes)
  console.log('  Creating staging table...');
  await sql`DROP TABLE IF EXISTS vbo_staging`;
  await sql`
    CREATE UNLOGGED TABLE vbo_staging (
      geom text,
      identificatie text,
      oppervlakte text,
      bouwjaar text,
      status text,
      openbare_ruimte_naam text,
      huisnummer text,
      huisletter text,
      toevoeging text,
      postcode text,
      woonplaats_naam text
    )
  `;

  // COPY via docker exec, piping CSV from host into the container's psql
  console.log('  Loading CSV into staging table...');
  const start = Date.now();

  const copyCommand = `cat "${CSV_PATH}" | docker exec -i ${DOCKER_CONTAINER} psql -U ${DB_USER} -d ${DB_NAME} -c "COPY vbo_staging FROM STDIN WITH (FORMAT csv, HEADER true)"`;

  try {
    execSync(copyCommand, {
      maxBuffer: 500 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10 * 60 * 1000, // 10 minutes
    });
  } catch (error) {
    console.error('  COPY into staging table failed!');
    throw error;
  }

  const result = await sql`SELECT COUNT(*)::int AS count FROM vbo_staging`;
  const rowCount = result[0].count;
  console.log(`  Loaded ${fmt(rowCount)} rows in ${formatTime(Date.now() - start)}`);
  return rowCount;
}

// ---------------------------------------------------------------------------
// Phase 3: Upsert into properties with dedup
// ---------------------------------------------------------------------------
async function phase3Upsert(sql: postgres.Sql, limit?: number, offset?: number): Promise<number> {
  console.log('\nPhase 3: Upsert into properties...');
  console.log('  Running INSERT INTO properties SELECT DISTINCT ON ... ON CONFLICT ...');

  const start = Date.now();

  // Build the optional LIMIT/OFFSET clause
  let limitClause = '';
  if (limit != null && offset != null && offset > 0) {
    limitClause = `LIMIT ${limit} OFFSET ${offset}`;
  } else if (limit != null) {
    limitClause = `LIMIT ${limit}`;
  } else if (offset != null && offset > 0) {
    limitClause = `OFFSET ${offset}`;
  }

  // Set a long statement timeout for this heavy query
  await sql`SET statement_timeout = '600s'`;

  // The upsert query with DISTINCT ON deduplication.
  // Built as a plain string and executed via sql.unsafe() because the entire
  // query is raw SQL (DISTINCT ON, casts, PostGIS functions, ON CONFLICT).
  const upsertQuery = `
    INSERT INTO properties (
      bag_identificatie, street, house_number, house_number_addition,
      postal_code, city, geometry, bouwjaar, oppervlakte, status
    )
    SELECT
      identificatie,
      openbare_ruimte_naam,
      huisnummer::int,
      COALESCE(
        UPPER(NULLIF(
          CONCAT_WS('-', NULLIF(huisletter, ''), NULLIF(toevoeging, '')),
          ''
        )),
        ''
      ),
      UPPER(REPLACE(postcode, ' ', '')),
      woonplaats_naam,
      ST_GeomFromText(geom, 4326),
      NULLIF(bouwjaar, '')::int,
      NULLIF(oppervlakte, '')::int,
      CASE
        WHEN status ILIKE '%ingetrokken%' THEN 'demolished'::property_status
        WHEN status ILIKE '%buiten gebruik%' THEN 'inactive'::property_status
        ELSE 'active'::property_status
      END
    FROM (
      SELECT DISTINCT ON (
        UPPER(REPLACE(postcode, ' ', '')),
        huisnummer::int,
        COALESCE(
          UPPER(NULLIF(
            CONCAT_WS('-', NULLIF(huisletter, ''), NULLIF(toevoeging, '')),
            ''
          )),
          ''
        )
      )
        identificatie,
        openbare_ruimte_naam,
        huisnummer,
        huisletter,
        toevoeging,
        postcode,
        woonplaats_naam,
        geom,
        bouwjaar,
        oppervlakte,
        status
      FROM vbo_staging
      WHERE postcode IS NOT NULL
        AND postcode != ''
        AND huisnummer IS NOT NULL
        AND huisnummer != ''
      ORDER BY
        UPPER(REPLACE(postcode, ' ', '')),
        huisnummer::int,
        COALESCE(
          UPPER(NULLIF(
            CONCAT_WS('-', NULLIF(huisletter, ''), NULLIF(toevoeging, '')),
            ''
          )),
          ''
        ),
        identificatie
      ${limitClause}
    ) AS deduped
    ON CONFLICT (postal_code, house_number, house_number_addition) DO UPDATE SET
      bag_identificatie = EXCLUDED.bag_identificatie,
      street = EXCLUDED.street,
      geometry = EXCLUDED.geometry,
      bouwjaar = EXCLUDED.bouwjaar,
      oppervlakte = EXCLUDED.oppervlakte,
      status = EXCLUDED.status,
      updated_at = NOW()
  `;

  await sql.unsafe(upsertQuery);

  // Reset statement timeout
  await sql`SET statement_timeout = '0'`;

  const result = await sql`SELECT COUNT(*)::int AS count FROM properties`;
  const totalProperties = result[0].count;
  console.log(`  Upserted to ${fmt(totalProperties)} total properties in ${formatTime(Date.now() - start)}`);
  return totalProperties;
}

// ---------------------------------------------------------------------------
// Phase 4: Analyze
// ---------------------------------------------------------------------------
async function phase4Analyze(sql: postgres.Sql): Promise<void> {
  console.log('\nPhase 4: Analyze...');
  const start = Date.now();
  await sql`ANALYZE properties`;
  console.log(`  ANALYZE complete in ${formatTime(Date.now() - start)}`);
}

// ---------------------------------------------------------------------------
// Phase 5: Drop staging table
// ---------------------------------------------------------------------------
async function phase5Cleanup(sql: postgres.Sql): Promise<void> {
  console.log('\nPhase 5: Cleanup...');
  await sql`DROP TABLE IF EXISTS vbo_staging`;
  console.log('  Staging table dropped');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
async function showValidation(sql: postgres.Sql): Promise<void> {
  const countResult = await sql`SELECT COUNT(*)::int AS count FROM properties`;
  const totalCount = countResult[0].count;

  console.log(`\nTotal properties in database: ${fmt(totalCount)}`);

  // Sample 5 random addresses
  const samples = await sql`
    SELECT street, house_number, house_number_addition, postal_code, city
    FROM properties
    ORDER BY RANDOM()
    LIMIT 5
  `;

  if (samples.length > 0) {
    console.log('\nSample addresses:');
    samples.forEach((row, i) => {
      const addition = row.house_number_addition || '';
      const addStr = addition ? addition : '';
      console.log(
        `  ${i + 1}. ${row.street} ${row.house_number}${addStr}, ${row.postal_code || 'N/A'} ${row.city}`
      );
    });
  }

  // Top 10 cities by property count
  const cityStats = await sql`
    SELECT city, COUNT(*)::int AS count
    FROM properties
    GROUP BY city
    ORDER BY count DESC
    LIMIT 10
  `;

  if (cityStats.length > 0) {
    console.log('\nTop 10 cities by property count:');
    cityStats.forEach((row, i) => {
      console.log(`  ${i + 1}. ${row.city}: ${fmt(row.count)}`);
    });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function seed() {
  const totalStart = Date.now();

  console.log('='.repeat(60));
  console.log('Netherlands BAG Database Seed');
  console.log('='.repeat(60));

  // Parse CLI flags
  const args = process.argv.slice(2);

  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : undefined;

  const offsetIdx = args.indexOf('--offset');
  const offset = offsetIdx !== -1 ? parseInt(args[offsetIdx + 1], 10) : undefined;

  const skipDemolished = args.includes('--skip-demolished');
  const dryRun = args.includes('--dry-run');
  const skipExtract = args.includes('--skip-extract');

  console.log('Source: bag-light.gpkg (verblijfsobject layer)');
  console.log('Pipeline: ogr2ogr CSV -> COPY staging -> upsert properties');
  console.log('');

  if (limit != null) console.log(`  --limit ${fmt(limit)}`);
  if (offset != null && offset > 0) console.log(`  --offset ${fmt(offset)}`);
  if (skipDemolished) console.log('  --skip-demolished');
  if (dryRun) console.log('  --dry-run (no database changes)');
  if (skipExtract) console.log('  --skip-extract (reusing existing CSV)');

  // Connect to PostgreSQL
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://huishype:huishype_dev@localhost:5440/huishype';

  const mainDb = postgres(databaseUrl, {
    max: 3,
    idle_timeout: 0,
    connect_timeout: 30,
    onnotice: () => {},
  });

  try {
    // ---- Phase 1: Extract to CSV ----
    if (!skipExtract) {
      phase1Extract(skipDemolished);
    } else {
      console.log('\nPhase 1: Skipped (--skip-extract)');
      if (!existsSync(CSV_PATH)) {
        throw new Error(`CSV not found at ${CSV_PATH}. Run without --skip-extract first.`);
      }
      const rows = countCsvRows(CSV_PATH);
      const size = (statSync(CSV_PATH).size / (1024 * 1024)).toFixed(0);
      console.log(`  Reusing existing CSV: ${fmt(rows)} rows (${size} MB)`);
    }

    if (dryRun) {
      console.log('\n  DRY RUN - stopping before database changes');
      console.log('='.repeat(60));
      return;
    }

    // ---- Phase 2: COPY into staging ----
    await phase2Copy(mainDb);

    // ---- Phase 3: Upsert ----
    await phase3Upsert(mainDb, limit, offset);

    // ---- Phase 4: Analyze ----
    await phase4Analyze(mainDb);

    // ---- Phase 5: Cleanup ----
    await phase5Cleanup(mainDb);

    // ---- Summary ----
    console.log('\n' + '='.repeat(60));
    console.log('Seed Complete');
    console.log('='.repeat(60));

    await showValidation(mainDb);

    console.log(`\nTotal time: ${formatTime(Date.now() - totalStart)}`);
  } catch (error) {
    // Attempt to clean up staging table on failure
    try {
      await mainDb`DROP TABLE IF EXISTS vbo_staging`;
    } catch {
      // ignore cleanup errors
    }
    throw error;
  } finally {
    await mainDb.end();
    console.log('\nConnection closed');
  }
}

seed().catch((error) => {
  console.error('\nSeed failed:', error);
  process.exit(1);
});
