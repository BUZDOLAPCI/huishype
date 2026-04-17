/**
 * Import OSM building footprints into PostGIS.
 *
 * Iterates over countries from the config registry, extracting building
 * multipolygons from each country's OSM PBF file.
 *
 * Usage:
 *   pnpm -C services/api run db:import-buildings                  # all available
 *   pnpm -C services/api run db:import-buildings -- --country NL  # just NL
 *   pnpm -C services/api run db:import-buildings -- --country all # explicit all
 */
import { execSync } from 'child_process';
import { getCountryConfig, type CountryCode } from '@huishype/shared/config';
import { getPbfPath, parseCountryArg, filterAvailableCountries } from './lib/country-pbf.js';

const DB_HOST = process.env.DB_HOST ?? 'localhost';
const DB_PORT = process.env.DB_PORT ?? '5440';
const DB_USER = process.env.DB_USER ?? 'huishype';
const DB_NAME = process.env.DB_NAME ?? 'huishype';
const DB_PASS = process.env.DB_PASS ?? 'huishype_dev';

function psql(sql: string): void {
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c ${JSON.stringify(oneLine)}`,
    { stdio: 'inherit' },
  );
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function importCountry(code: CountryCode): void {
  const cfg = getCountryConfig(code);
  const pbfPath = getPbfPath(code);

  console.log(`\n--- Importing ${code} (${cfg.name}) ---`);
  console.log(`  PBF: ${pbfPath}`);

  const stepStart = Date.now();

  // ogr2ogr into staging table
  const pgConn = `PG:host=${DB_HOST} port=${DB_PORT} dbname=${DB_NAME} user=${DB_USER} password=${DB_PASS}`;
  const ogrCmd = [
    'ogr2ogr',
    '-f', '"PostgreSQL"',
    `"${pgConn}"`,
    `"${pbfPath}"`,
    '-nln', 'osm_buildings_staging',
    '-nlt', 'PROMOTE_TO_MULTI',
    '-lco', 'GEOMETRY_NAME=geometry',
    '-lco', 'FID=ogc_fid',
    '-overwrite',
    '-progress',
    '-sql',
    '"SELECT osm_id, osm_way_id, building, other_tags FROM multipolygons WHERE building IS NOT NULL"',
  ].join(' ');

  execSync(ogrCmd, { stdio: 'inherit', timeout: 60 * 60 * 1000 });
  console.log(`  ogr2ogr completed in ${formatTime(Date.now() - stepStart)}`);

  // Insert into final table with parsed heights
  // Use substring(...FROM regex) to extract first valid number from messy OSM values
  // like "0,1", "-1.0.1.2", "12 m", etc.
  //
  // Height logic:
  //   - Explicit height tag: use as-is (just ensure > 0), e.g. garage with height=2
  //   - Levels-derived or default: enforce minimum floor height of 3.02m
  //
  // Dedup: ON CONFLICT (osm_id) DO UPDATE for idempotent re-runs
  const insertStart = Date.now();
  psql(`
    INSERT INTO osm_buildings (osm_id, render_height, render_min_height, geometry)
    SELECT
      COALESCE(
        NULLIF(osm_id, '')::bigint,
        NULLIF(osm_way_id, '')::bigint
      ),
      COALESCE(
        GREATEST(0.1, NULLIF(substring(replace(NULLIF((other_tags::hstore -> 'height'), ''), ',', '.') FROM '(-?[0-9]+\\.?[0-9]*)'), '')::real),
        GREATEST(3.02, COALESCE(
          NULLIF(substring(replace(NULLIF((other_tags::hstore -> 'building:levels'), ''), ',', '.') FROM '(-?[0-9]+\\.?[0-9]*)'), '')::real * 3.0,
          6.0
        ))
      )::real,
      GREATEST(0.0, COALESCE(
        NULLIF(substring(replace(NULLIF((other_tags::hstore -> 'min_height'), ''), ',', '.') FROM '(-?[0-9]+\\.?[0-9]*)'), '')::real,
        0.0
      ))::real,
      geometry
    FROM osm_buildings_staging
    WHERE geometry IS NOT NULL
    ON CONFLICT (osm_id) WHERE osm_id IS NOT NULL
    DO UPDATE SET
      render_height = EXCLUDED.render_height,
      render_min_height = EXCLUDED.render_min_height,
      geometry = EXCLUDED.geometry;
  `);
  console.log(`  Insert completed in ${formatTime(Date.now() - insertStart)}`);

  // Drop staging
  psql('DROP TABLE IF EXISTS osm_buildings_staging;');
}

async function main() {
  const startTime = Date.now();
  const requested = parseCountryArg();
  const countries = filterAvailableCountries(requested);

  if (countries.length === 0) {
    console.error('No countries with PBF files found. Nothing to import.');
    process.exit(1);
  }

  console.log('=== OSM Buildings Import ===');
  console.log(`Countries: ${countries.join(', ')}`);

  // Step 1: Prepare osm_buildings table (created by Drizzle migration)
  const countryFlagIndex = process.argv.indexOf('--country');
  const countryArg = countryFlagIndex === -1 ? undefined : process.argv[countryFlagIndex + 1];
  const isFullImport = requested.length === 0 || countryArg?.toUpperCase() === 'ALL';
  console.log('\n[1/4] Preparing osm_buildings table...');
  psql(`CREATE EXTENSION IF NOT EXISTS hstore;`);
  if (isFullImport) {
    console.log('  Full import — truncating existing data');
    psql(`TRUNCATE TABLE osm_buildings RESTART IDENTITY;`);
  } else {
    console.log('  Partial import — will upsert on osm_id');
  }

  // Step 2: Import each country
  console.log(`[2/4] Importing buildings from ${countries.length} country/ies...`);
  for (const code of countries) {
    importCountry(code);
  }

  // Step 3: Create spatial index
  console.log('\n[3/4] Creating spatial index...');
  const indexStart = Date.now();
  psql('CREATE INDEX IF NOT EXISTS idx_osm_buildings_geometry ON osm_buildings USING GIST (geometry);');
  console.log(`  Index created in ${formatTime(Date.now() - indexStart)}`);

  // Step 4: ANALYZE
  console.log('[4/4] ANALYZE...');
  psql('ANALYZE osm_buildings;');

  const elapsed = Date.now() - startTime;
  console.log(`\nDone in ${formatTime(elapsed)}`);

  // Report count and height stats
  const countResult = execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -t -c "SELECT COUNT(*) FROM osm_buildings;"`,
    { encoding: 'utf-8' },
  ).trim();
  console.log(`Imported ${countResult} buildings`);

  const heightStats = execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -t -c "SELECT ROUND(AVG(render_height)::numeric, 1) AS avg_h, MIN(render_height) AS min_h, MAX(render_height) AS max_h FROM osm_buildings;"`,
    { encoding: 'utf-8' },
  ).trim();
  console.log(`Height stats (avg | min | max): ${heightStats}`);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
