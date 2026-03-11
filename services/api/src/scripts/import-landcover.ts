/**
 * Import OSM landcover (green polygons) into PostGIS.
 *
 * Iterates over countries from the config registry, extracting parks, forests,
 * grass, etc. from each country's OSM PBF file.
 *
 * Usage:
 *   pnpm -C services/api run db:seed-landcover                  # all available
 *   pnpm -C services/api run db:seed-landcover -- --country NL   # just NL
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getCountryConfig, type CountryCode } from '@huishype/shared/config';
import { DATA_DIR, getPbfPath, parseCountryArg, filterAvailableCountries } from './lib/country-pbf.js';

const DB_HOST = process.env.DB_HOST ?? 'localhost';
const DB_PORT = process.env.DB_PORT ?? '5440';
const DB_NAME = process.env.DB_NAME ?? 'huishype';
const DB_USER = process.env.DB_USER ?? 'huishype';
const DB_PASS = process.env.DB_PASS ?? 'huishype_dev';

function importCountry(code: CountryCode): void {
  const cfg = getCountryConfig(code);
  const pbfPath = getPbfPath(code);

  console.log(`\n--- Importing landcover for ${code} (${cfg.name}) ---`);
  console.log(`  PBF: ${pbfPath}`);

  const ogrSQL = [
    'SELECT osm_id,',
    "CASE WHEN leisure='park' THEN 'park'",
    "WHEN landuse IN ('forest','meadow','grass','recreation_ground','village_green') THEN landuse",
    `WHEN "natural" IN ('wood','grassland','scrub','heath') THEN "natural"`,
    "ELSE 'other' END AS type,",
    'geometry FROM multipolygons',
    "WHERE leisure='park'",
    "OR landuse IN ('forest','meadow','grass','recreation_ground','village_green')",
    `OR "natural" IN ('wood','grassland','scrub','heath')`,
  ].join(' ');

  const sqlFile = path.join(DATA_DIR, `_landcover_query_${code}.sql`);
  fs.writeFileSync(sqlFile, ogrSQL);

  const pgConn = `PG:host=${DB_HOST} port=${DB_PORT} dbname=${DB_NAME} user=${DB_USER} password=${DB_PASS}`;

  try {
    execSync(
      `ogr2ogr -f "PostgreSQL" "${pgConn}" "${pbfPath}" -sql @"${sqlFile}" -dialect sqlite -nln landcover -t_srs EPSG:4326 -lco GEOMETRY_NAME=geometry -append -progress`,
      {
        stdio: 'inherit',
        timeout: 600_000,
      },
    );
  } finally {
    try { fs.unlinkSync(sqlFile); } catch { /* ignore */ }
  }
}

async function main() {
  const requested = parseCountryArg();
  const countries = filterAvailableCountries(requested);

  if (countries.length === 0) {
    console.error('No countries with PBF files found. Nothing to import.');
    process.exit(1);
  }

  console.log('=== Landcover Import ===');
  console.log(`Countries: ${countries.join(', ')}`);

  // Create table (fresh start)
  console.log('\nCreating landcover table...');
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "
      DROP TABLE IF EXISTS landcover CASCADE;
      CREATE TABLE landcover (
        id SERIAL PRIMARY KEY,
        osm_id BIGINT,
        type VARCHAR(50) NOT NULL,
        geometry GEOMETRY(MultiPolygon, 4326) NOT NULL
      );
    "`,
    { stdio: 'inherit' },
  );

  // Import each country
  for (const code of countries) {
    importCountry(code);
  }

  // Create indexes
  console.log('\nCreating indexes...');
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "
      CREATE INDEX IF NOT EXISTS idx_landcover_geometry ON landcover USING GIST (geometry);
      CREATE INDEX IF NOT EXISTS idx_landcover_type ON landcover (type);
      ANALYZE landcover;
    "`,
    { stdio: 'inherit' },
  );

  // Verify
  console.log('\nVerifying import...');
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "SELECT type, COUNT(*) FROM landcover GROUP BY type ORDER BY count DESC;"`,
    { stdio: 'inherit' },
  );

  console.log('Landcover import complete!');
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
