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

function createTreeLandcoverTable(): void {
  console.log('\nCreating tree_landcover table...');

  const watercoverExists = execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT to_regclass('public.watercover') IS NOT NULL;"`,
    { encoding: 'utf-8' },
  ).trim() === 't';

  if (!watercoverExists) {
    console.warn('  watercover table not found; tree_landcover will mirror landcover.');
  }

  const geometryExpression = watercoverExists
    ? `CASE
          WHEN water_clip.geometry IS NULL THEN ST_MakeValid(lc.geometry)
          ELSE ST_Difference(ST_MakeValid(lc.geometry), water_clip.geometry)
        END`
    : 'ST_MakeValid(lc.geometry)';

  const waterJoin = watercoverExists
    ? `LEFT JOIN LATERAL (
          SELECT ST_UnaryUnion(ST_Collect(ST_MakeValid(wc.geometry))) AS geometry
          FROM watercover wc
          WHERE ST_Intersects(lc.geometry, wc.geometry)
        ) water_clip ON TRUE`
    : '';

  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "
      DROP TABLE IF EXISTS tree_landcover CASCADE;
      CREATE TABLE tree_landcover (
        id SERIAL PRIMARY KEY,
        landcover_id INTEGER NOT NULL,
        osm_id BIGINT,
        type VARCHAR(50) NOT NULL,
        geometry GEOMETRY(MultiPolygon, 4326) NOT NULL
      );

      WITH clipped AS (
        SELECT
          lc.id AS landcover_id,
          lc.osm_id,
          lc.type,
          ST_Multi(ST_CollectionExtract(${geometryExpression}, 3)) AS geometry
        FROM landcover lc
        ${waterJoin}
      )
      INSERT INTO tree_landcover (landcover_id, osm_id, type, geometry)
      SELECT landcover_id, osm_id, type, geometry
      FROM clipped
      WHERE geometry IS NOT NULL
        AND NOT ST_IsEmpty(geometry);

      CREATE INDEX IF NOT EXISTS idx_tree_landcover_geometry ON tree_landcover USING GIST (geometry);
      CREATE INDEX IF NOT EXISTS idx_tree_landcover_type ON tree_landcover (type);
      CREATE INDEX IF NOT EXISTS idx_tree_landcover_landcover_id ON tree_landcover (landcover_id);
      ANALYZE tree_landcover;
    "`,
    { stdio: 'inherit' },
  );
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

  createTreeLandcoverTable();

  // Verify
  console.log('\nVerifying import...');
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "
      SELECT 'landcover' AS table_name, type, COUNT(*)
      FROM landcover
      GROUP BY type
      UNION ALL
      SELECT 'tree_landcover' AS table_name, type, COUNT(*)
      FROM tree_landcover
      GROUP BY type
      ORDER BY table_name, count DESC;
    "`,
    { stdio: 'inherit' },
  );

  console.log('Landcover import complete!');
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
