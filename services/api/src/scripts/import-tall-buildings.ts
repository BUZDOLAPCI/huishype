/**
 * Import tall building footprints (>20m) from OSM into PostGIS.
 *
 * Uses ogr2ogr to extract building polygons with height data from the Netherlands
 * PBF, then filters to buildings taller than 20m. Pre-computes exclusion_geom
 * via ST_Buffer (height-proportional radius, capped at 100m) for fast
 * GIST-indexed ST_Intersects in the tree tile query.
 *
 * Requires a custom osmconf.ini to expose `height` and `building:levels` as
 * first-class columns (they're normally in `other_tags`).
 *
 * Usage: pnpm -C services/api run db:seed-tall-buildings
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

  // Add height and building:levels to multipolygons attributes
  const customConf = defaultConf.replace(
    /^(attributes=name,type,aeroway,amenity,admin_level,barrier,boundary,building,craft,geological,historic,land_area,landuse,leisure,man_made,military,natural,office,place,shop,sport,tourism)$/m,
    '$1,height,building:levels',
  );

  const confPath = path.join(DATA_DIR, '_osmconf_buildings.ini');
  fs.writeFileSync(confPath, customConf);
  return confPath;
}

async function main() {
  // Step 1: Download PBF if not cached
  if (!fs.existsSync(PBF_PATH)) {
    console.log(`Downloading Netherlands OSM PBF to ${PBF_PATH}...`);
    console.log('This is ~1.4GB and may take a few minutes.');
    execSync(`curl -L -o "${PBF_PATH}" "${PBF_URL}"`, {
      stdio: 'inherit',
      timeout: 600_000,
    });
    console.log('Download complete.');
  } else {
    console.log(`Using cached PBF: ${PBF_PATH}`);
  }

  // Step 2: Create table with exclusion_geom column
  console.log('Ensuring tall_buildings table exists...');
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "
      CREATE TABLE IF NOT EXISTS tall_buildings (
        id SERIAL PRIMARY KEY,
        osm_id BIGINT,
        height REAL NOT NULL,
        geometry GEOMETRY(MultiPolygon, 4326) NOT NULL,
        exclusion_geom GEOMETRY(Geometry, 4326) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tall_buildings_exclusion ON tall_buildings USING GIST (exclusion_geom);
    "`,
    { stdio: 'inherit' },
  );

  // Step 3: Truncate existing data (idempotent re-import)
  console.log('Truncating existing tall_buildings data...');
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "TRUNCATE tall_buildings RESTART IDENTITY;"`,
    { stdio: 'inherit' },
  );

  // Step 4: Create custom osmconf.ini to expose height/building:levels columns
  const osmConfPath = createCustomOsmConf();

  // Step 5: Import via ogr2ogr into a staging table
  // ogr2ogr launders `building:levels` → `building_levels`
  console.log('Importing building footprints via ogr2ogr...');

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

  const sqlFile = path.join(DATA_DIR, '_tall_buildings_query.sql');
  fs.writeFileSync(sqlFile, ogrSQL);

  const pgConn = `PG:host=${DB_HOST} port=${DB_PORT} dbname=${DB_NAME} user=${DB_USER} password=${DB_PASS}`;
  const stagingTable = 'tall_buildings_staging';

  try {
    execSync(
      `OSM_CONFIG_FILE="${osmConfPath}" ogr2ogr -f "PostgreSQL" "${pgConn}" "${PBF_PATH}" -sql @"${sqlFile}" -dialect sqlite -nln ${stagingTable} -t_srs EPSG:4326 -lco GEOMETRY_NAME=geometry -overwrite -progress`,
      {
        stdio: 'inherit',
        timeout: 1_200_000, // 20 minutes (buildings table is large)
      },
    );
  } finally {
    try { fs.unlinkSync(sqlFile); } catch { /* ignore */ }
    try { fs.unlinkSync(osmConfPath); } catch { /* ignore */ }
  }

  // Step 6: Filter >20m and pre-compute exclusion zones
  // Buffer computed in EPSG:28992 (Amersfoort/RD New) for accurate meter distances in NL
  console.log('Filtering to buildings >20m and computing exclusion zones...');
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "
      INSERT INTO tall_buildings (osm_id, height, geometry, exclusion_geom)
      SELECT
        NULLIF(osm_id, '')::BIGINT,
        height,
        geometry,
        ST_Transform(
          ST_Buffer(
            ST_Transform(geometry, 28992),
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

  // Step 7: Verify
  console.log('Verifying import...');
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
