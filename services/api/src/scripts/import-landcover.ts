/**
 * Import OSM landcover (green polygons) into PostGIS.
 *
 * Downloads Netherlands OSM PBF from Geofabrik if not cached, then uses ogr2ogr
 * to extract parks, forests, grass, etc. into the `landcover` table.
 *
 * Usage: npx tsx src/scripts/import-landcover.ts
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(import.meta.dirname, '../../../../data_sources');
const PBF_PATH = path.join(DATA_DIR, 'netherlands-latest.osm.pbf');
const PBF_URL = 'https://download.geofabrik.de/europe/netherlands-latest.osm.pbf';

const DB_HOST = process.env.DB_HOST ?? 'localhost';
const DB_PORT = process.env.DB_PORT ?? '5440';
const DB_NAME = process.env.DB_NAME ?? 'huishype';
const DB_USER = process.env.DB_USER ?? 'huishype';
const DB_PASS = process.env.DB_PASS ?? 'huishype_dev';

async function main() {
  // Step 1: Download PBF if not cached
  if (!fs.existsSync(PBF_PATH)) {
    console.log(`Downloading Netherlands OSM PBF to ${PBF_PATH}...`);
    console.log('This is ~1.4GB and may take a few minutes.');
    execSync(`curl -L -o "${PBF_PATH}" "${PBF_URL}"`, {
      stdio: 'inherit',
      timeout: 600_000, // 10 minutes
    });
    console.log('Download complete.');
  } else {
    console.log(`Using cached PBF: ${PBF_PATH}`);
  }

  // Step 2: Create table if not exists
  console.log('Ensuring landcover table exists...');
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "CREATE TABLE IF NOT EXISTS landcover (id SERIAL PRIMARY KEY, osm_id BIGINT, type VARCHAR(50) NOT NULL, geometry GEOMETRY(MultiPolygon, 4326) NOT NULL); CREATE INDEX IF NOT EXISTS idx_landcover_geometry ON landcover USING GIST (geometry); CREATE INDEX IF NOT EXISTS idx_landcover_type ON landcover (type);"`,
    { stdio: 'inherit' },
  );

  // Step 3: Truncate existing data (idempotent re-import)
  console.log('Truncating existing landcover data...');
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "TRUNCATE landcover RESTART IDENTITY;"`,
    { stdio: 'inherit' },
  );

  // Step 4: Import green polygons via ogr2ogr
  // Write SQL to a temp file to avoid shell quoting issues
  console.log('Importing landcover polygons via ogr2ogr...');

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

  const sqlFile = path.join(DATA_DIR, '_landcover_query.sql');
  fs.writeFileSync(sqlFile, ogrSQL);

  const pgConn = `PG:host=${DB_HOST} port=${DB_PORT} dbname=${DB_NAME} user=${DB_USER} password=${DB_PASS}`;

  try {
    execSync(
      `ogr2ogr -f "PostgreSQL" "${pgConn}" "${PBF_PATH}" -sql @"${sqlFile}" -dialect sqlite -nln landcover -t_srs EPSG:4326 -lco GEOMETRY_NAME=geometry -overwrite -progress`,
      {
        stdio: 'inherit',
        timeout: 600_000, // 10 minutes
      },
    );
  } finally {
    // Clean up temp SQL file
    try { fs.unlinkSync(sqlFile); } catch { /* ignore */ }
  }

  // Step 5: Verify
  console.log('Verifying import...');
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
