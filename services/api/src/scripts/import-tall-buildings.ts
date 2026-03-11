/**
 * Import tall building footprints (>20m) from OSM into PostGIS.
 *
 * Iterates over countries from the config registry. Pre-computes exclusion_geom
 * via ST_Buffer (height-proportional radius, capped at 100m) for fast
 * GIST-indexed ST_Intersects in the tree tile query.
 *
 * Uses each country's projectionSrid for accurate meter-based buffer distances.
 *
 * Usage:
 *   pnpm -C services/api run db:seed-tall-buildings                  # all available
 *   pnpm -C services/api run db:seed-tall-buildings -- --country NL   # just NL
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

/** Minimum building height (meters) to create an exclusion zone */
const MIN_HEIGHT_THRESHOLD = 20;
/** Maximum exclusion radius (meters), caps the buffer size */
const MAX_EXCLUSION_RADIUS = 100;

/**
 * Create a custom osmconf.ini that exposes `height` and `building:levels`
 * as first-class columns on multipolygons (normally they're in `other_tags`).
 * ogr2ogr launders `:` to `_`, so `building:levels` becomes `building_levels`.
 */
function createCustomOsmConf(): string {
  const defaultConf = fs.readFileSync('/usr/share/gdal/osmconf.ini', 'utf-8');

  const customConf = defaultConf.replace(
    /^(attributes=name,type,aeroway,amenity,admin_level,barrier,boundary,building,craft,geological,historic,land_area,landuse,leisure,man_made,military,natural,office,place,shop,sport,tourism)$/m,
    '$1,height,building:levels',
  );

  const confPath = path.join(DATA_DIR, '_osmconf_buildings.ini');
  fs.writeFileSync(confPath, customConf);
  return confPath;
}

function importCountry(code: CountryCode, osmConfPath: string): void {
  const cfg = getCountryConfig(code);
  const pbfPath = getPbfPath(code);

  console.log(`\n--- Importing tall buildings for ${code} (${cfg.name}) ---`);
  console.log(`  PBF: ${pbfPath}`);
  console.log(`  Projection SRID for buffer: EPSG:${cfg.projectionSrid}`);

  const ogrSQL = [
    'SELECT osm_id,',
    'CAST(COALESCE(',
    "  NULLIF(CAST(REPLACE(REPLACE(height, 'm', ''), ' ', '') AS REAL), 0),",
    '  NULLIF(building_levels * 3.0, 0)',
    ') AS REAL) AS height,',
    'geometry FROM multipolygons',
    'WHERE building IS NOT NULL',
    'AND (height IS NOT NULL OR building_levels IS NOT NULL)',
  ].join(' ');

  const sqlFile = path.join(DATA_DIR, `_tall_buildings_query_${code}.sql`);
  fs.writeFileSync(sqlFile, ogrSQL);

  const pgConn = `PG:host=${DB_HOST} port=${DB_PORT} dbname=${DB_NAME} user=${DB_USER} password=${DB_PASS}`;
  const stagingTable = 'tall_buildings_staging';

  try {
    execSync(
      `OSM_CONFIG_FILE="${osmConfPath}" ogr2ogr -f "PostgreSQL" "${pgConn}" "${pbfPath}" -sql @"${sqlFile}" -dialect sqlite -nln ${stagingTable} -t_srs EPSG:4326 -lco GEOMETRY_NAME=geometry -overwrite -progress`,
      {
        stdio: 'inherit',
        timeout: 1_200_000,
      },
    );
  } finally {
    try { fs.unlinkSync(sqlFile); } catch { /* ignore */ }
  }

  // Filter >20m and pre-compute exclusion zones using country's projection SRID
  console.log(`  Filtering to buildings >${MIN_HEIGHT_THRESHOLD}m and computing exclusion zones...`);
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "
      INSERT INTO tall_buildings (osm_id, height, geometry, exclusion_geom)
      SELECT
        NULLIF(osm_id, '')::BIGINT,
        height,
        geometry,
        ST_Transform(
          ST_Buffer(
            ST_Transform(geometry, ${cfg.projectionSrid}),
            LEAST(height, ${MAX_EXCLUSION_RADIUS})
          ),
          4326
        ) AS exclusion_geom
      FROM ${stagingTable}
      WHERE height > ${MIN_HEIGHT_THRESHOLD};
      DROP TABLE IF EXISTS ${stagingTable};
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

  console.log('=== Tall Buildings Import ===');
  console.log(`Countries: ${countries.join(', ')}`);

  // Create table (fresh start)
  console.log('\nCreating tall_buildings table...');
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "
      DROP TABLE IF EXISTS tall_buildings CASCADE;
      CREATE TABLE tall_buildings (
        id SERIAL PRIMARY KEY,
        osm_id BIGINT,
        height REAL NOT NULL,
        geometry GEOMETRY(MultiPolygon, 4326) NOT NULL,
        exclusion_geom GEOMETRY(Geometry, 4326) NOT NULL
      );
    "`,
    { stdio: 'inherit' },
  );

  // Create custom osmconf.ini once for all countries
  const osmConfPath = createCustomOsmConf();

  try {
    // Import each country
    for (const code of countries) {
      importCountry(code, osmConfPath);
    }
  } finally {
    try { fs.unlinkSync(osmConfPath); } catch { /* ignore */ }
  }

  // Create index and analyze
  console.log('\nCreating index...');
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "
      CREATE INDEX IF NOT EXISTS idx_tall_buildings_exclusion ON tall_buildings USING GIST (exclusion_geom);
      ANALYZE tall_buildings;
    "`,
    { stdio: 'inherit' },
  );

  // Verify
  console.log('\nVerifying import...');
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "
      SELECT COUNT(*) AS total,
             ROUND(AVG(height)::numeric, 1) AS avg_height,
             ROUND(MAX(height)::numeric, 1) AS max_height,
             ROUND(MIN(height)::numeric, 1) AS min_height
      FROM tall_buildings;
    "`,
    { stdio: 'inherit' },
  );

  console.log('Tall buildings import complete!');
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
