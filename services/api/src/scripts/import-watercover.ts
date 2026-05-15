/**
 * Import closed OSM water polygons into PostGIS for decorative duck scatter.
 *
 * This is an operator-run data import, like landcover and tall buildings. It
 * refreshes the watercover table from local OSM PBFs and keeps it separate
 * from OpenFreeMap's externally served water rendering.
 *
 * Usage:
 *   pnpm -C services/api run db:seed-watercover                  # all available
 *   pnpm -C services/api run db:seed-watercover -- --country NL   # just NL
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getCountryConfig, type CountryCode } from '@huishype/shared/config';
import {
  DATA_DIR,
  filterAvailableCountries,
  getPbfPath,
  parseCountryArg,
} from './lib/country-pbf.js';

const DB_HOST = process.env.DB_HOST ?? 'localhost';
const DB_PORT = process.env.DB_PORT ?? '5440';
const DB_NAME = process.env.DB_NAME ?? 'huishype';
const DB_USER = process.env.DB_USER ?? 'huishype';
const DB_PASS = process.env.DB_PASS ?? 'huishype_dev';

/**
 * Create a custom osmconf.ini that exposes waterway on multipolygons. The
 * default config already exposes natural/landuse, but riverbank needs waterway.
 */
function createCustomOsmConf(): string {
  const defaultConf = fs.readFileSync('/usr/share/gdal/osmconf.ini', 'utf-8');

  const customConf = defaultConf.replace(
    /^(attributes=name,type,aeroway,amenity,admin_level,barrier,boundary,building,craft,geological,historic,land_area,landuse,leisure,man_made,military,natural,office,place,shop,sport,tourism)$/m,
    '$1,waterway'
  );

  const confPath = path.join(DATA_DIR, '_osmconf_watercover.ini');
  fs.writeFileSync(confPath, customConf);
  return confPath;
}

function importCountry(code: CountryCode, osmConfPath: string): void {
  const cfg = getCountryConfig(code);
  const pbfPath = getPbfPath(code);
  const stagingTable = 'watercover_staging';

  console.log(`\n--- Importing watercover for ${code} (${cfg.name}) ---`);
  console.log(`  PBF: ${pbfPath}`);
  console.log(`  Projection SRID for area: EPSG:${cfg.projectionSrid}`);

  const ogrSQL = [
    'SELECT osm_id,',
    `CASE WHEN "natural"='water' THEN 'water'`,
    "WHEN waterway='riverbank' THEN 'riverbank'",
    "WHEN landuse IN ('reservoir','basin') THEN landuse",
    "ELSE 'water' END AS type,",
    'geometry FROM multipolygons',
    `WHERE "natural"='water'`,
    "OR waterway='riverbank'",
    "OR landuse IN ('reservoir','basin')",
  ].join(' ');

  const sqlFile = path.join(DATA_DIR, `_watercover_query_${code}.sql`);
  fs.writeFileSync(sqlFile, ogrSQL);

  const pgConn = `PG:host=${DB_HOST} port=${DB_PORT} dbname=${DB_NAME} user=${DB_USER} password=${DB_PASS}`;

  try {
    execSync(
      `OSM_CONFIG_FILE="${osmConfPath}" ogr2ogr -f "PostgreSQL" "${pgConn}" "${pbfPath}" -sql @"${sqlFile}" -dialect sqlite -nln ${stagingTable} -t_srs EPSG:4326 -lco GEOMETRY_NAME=geometry -overwrite -progress`,
      {
        stdio: 'inherit',
        timeout: 1_200_000,
      }
    );
  } finally {
    try {
      fs.unlinkSync(sqlFile);
    } catch {
      /* ignore */
    }
  }

  console.log('  Computing metric area and appending water polygons...');
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "
      INSERT INTO watercover (osm_id, type, area_m2, geometry)
      SELECT
        NULLIF(osm_id, '')::BIGINT,
        type,
        ST_Area(ST_Transform(geometry, ${cfg.projectionSrid})) AS area_m2,
        geometry
      FROM ${stagingTable}
      WHERE geometry IS NOT NULL
        AND NOT ST_IsEmpty(geometry);
      DROP TABLE IF EXISTS ${stagingTable};
    "`,
    { stdio: 'inherit' }
  );
}

async function main() {
  const requested = parseCountryArg();
  const countries = filterAvailableCountries(requested);

  if (countries.length === 0) {
    console.error('No countries with PBF files found. Nothing to import.');
    process.exit(1);
  }

  console.log('=== Watercover Import ===');
  console.log(`Countries: ${countries.join(', ')}`);

  console.log('\nCreating watercover table...');
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "
      DROP TABLE IF EXISTS watercover CASCADE;
      CREATE TABLE watercover (
        id SERIAL PRIMARY KEY,
        osm_id BIGINT,
        type VARCHAR(50) NOT NULL,
        area_m2 DOUBLE PRECISION NOT NULL,
        geometry GEOMETRY(MultiPolygon, 4326) NOT NULL
      );
    "`,
    { stdio: 'inherit' }
  );

  const osmConfPath = createCustomOsmConf();

  try {
    for (const code of countries) {
      importCountry(code, osmConfPath);
    }
  } finally {
    try {
      fs.unlinkSync(osmConfPath);
    } catch {
      /* ignore */
    }
  }

  console.log('\nCreating indexes...');
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "
      CREATE INDEX IF NOT EXISTS idx_watercover_geometry ON watercover USING GIST (geometry);
      CREATE INDEX IF NOT EXISTS idx_watercover_type ON watercover (type);
      CREATE INDEX IF NOT EXISTS idx_watercover_area_m2 ON watercover (area_m2);
      ANALYZE watercover;
    "`,
    { stdio: 'inherit' }
  );

  console.log('\nVerifying import...');
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "
      SELECT type,
             COUNT(*) AS count,
             ROUND(SUM(area_m2)::numeric / 1000000, 2) AS area_km2
      FROM watercover
      GROUP BY type
      ORDER BY count DESC;
    "`,
    { stdio: 'inherit' }
  );

  console.log('Watercover import complete!');
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
