/**
 * Import 3DBAG building footprints (~10.8M) into PostGIS.
 *
 * Source: data_sources/3dbag_nl.gpkg (104GB), layer `lod12_2d`
 * - 2D polygons with LIDAR-measured heights from AHN point cloud
 * - EPSG:7415 (RD New + NAP height) → EPSG:4326 (WGS84)
 *
 * Usage: pnpm -C services/api run db:import-buildings
 */
import { execSync } from 'child_process';
import path from 'path';

const DB_HOST = process.env.DB_HOST ?? 'localhost';
const DB_PORT = process.env.DB_PORT ?? '5440';
const DB_USER = process.env.DB_USER ?? 'huishype';
const DB_NAME = process.env.DB_NAME ?? 'huishype';
const DB_PASS = process.env.DB_PASS ?? 'huishype_dev';

const GPKG_PATH = path.resolve(
  import.meta.dirname,
  '../../../../data_sources/3dbag_nl.gpkg',
);

function psql(sql: string): void {
  // Collapse multiline SQL to single line to avoid psql interpreting \n as commands
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

async function main() {
  const startTime = Date.now();
  console.log('=== 3DBAG Buildings Import ===');
  console.log(`Source: ${GPKG_PATH}`);

  // Step 1: Create final table
  console.log('\n[1/6] Creating bag_buildings table...');
  psql(`
    DROP TABLE IF EXISTS bag_buildings CASCADE;
    CREATE TABLE bag_buildings (
      id SERIAL PRIMARY KEY,
      identificatie VARCHAR(32) NOT NULL,
      render_height REAL NOT NULL DEFAULT 10.0,
      render_min_height REAL NOT NULL DEFAULT 0.0,
      geometry GEOMETRY(Geometry, 4326) NOT NULL
    );
  `);

  // Step 2: Import lod12_2d via ogr2ogr into staging table
  // Source CRS is EPSG:7415 (compound: RD New + NAP height).
  // Force -s_srs EPSG:28992 to strip the vertical component for 2D transform.
  console.log('[2/6] Extracting lod12_2d layer with ogr2ogr (this takes ~6 min)...');
  const stepStart = Date.now();

  const pgConn = `PG:host=${DB_HOST} port=${DB_PORT} dbname=${DB_NAME} user=${DB_USER} password=${DB_PASS}`;
  const ogrCmd = [
    'ogr2ogr',
    '-f', '"PostgreSQL"',
    `"${pgConn}"`,
    `"${GPKG_PATH}"`,
    '-nln', 'bag_buildings_staging',
    '-nlt', 'PROMOTE_TO_MULTI',
    '-s_srs', 'EPSG:28992',
    '-t_srs', 'EPSG:4326',
    '-lco', 'GEOMETRY_NAME=geometry',
    '-lco', 'FID=ogc_fid',
    '-overwrite',
    '-progress',
    '-sql', '"SELECT identificatie, b3_h_70p, b3_h_min, geom FROM lod12_2d"',
  ].join(' ');

  execSync(ogrCmd, { stdio: 'inherit', timeout: 60 * 60 * 1000 });
  console.log(`  ogr2ogr completed in ${formatTime(Date.now() - stepStart)}`);

  // Step 3: Insert single-part buildings (99.9%) directly — fast, no ST_Union needed.
  // Then merge multi-part buildings (~0.1%) with ST_Union in a separate pass.
  // Split avoids PostgreSQL memory issues from ST_Union on the full 10.8M row set.
  console.log('[3/6] Inserting single-part buildings...');
  const insertStart = Date.now();
  psql(`
    INSERT INTO bag_buildings (identificatie, render_height, render_min_height, geometry)
    SELECT s.identificatie,
      GREATEST(3.0, COALESCE(s.b3_h_70p, 10.0))::real,
      COALESCE(s.b3_h_min, 0.0)::real,
      s.geometry
    FROM bag_buildings_staging s
    INNER JOIN (
      SELECT identificatie FROM bag_buildings_staging
      WHERE geometry IS NOT NULL
      GROUP BY identificatie HAVING COUNT(*) = 1
    ) single ON s.identificatie = single.identificatie
    WHERE s.geometry IS NOT NULL;
  `);
  console.log(`  Single-part insert completed in ${formatTime(Date.now() - insertStart)}`);

  // Step 4: Insert multi-part buildings with ST_Union to merge building parts.
  console.log('[4/6] Merging multi-part buildings with ST_Union...');
  const mergeStart = Date.now();
  psql(`
    INSERT INTO bag_buildings (identificatie, render_height, render_min_height, geometry)
    SELECT s.identificatie,
      GREATEST(3.0, COALESCE(MAX(s.b3_h_70p), 10.0))::real,
      COALESCE(MIN(s.b3_h_min), 0.0)::real,
      ST_Union(s.geometry)
    FROM bag_buildings_staging s
    INNER JOIN (
      SELECT identificatie FROM bag_buildings_staging
      WHERE geometry IS NOT NULL
      GROUP BY identificatie HAVING COUNT(*) > 1
    ) multi ON s.identificatie = multi.identificatie
    WHERE s.geometry IS NOT NULL
    GROUP BY s.identificatie;
  `);
  console.log(`  Multi-part merge completed in ${formatTime(Date.now() - mergeStart)}`);

  // Step 5: Create spatial index
  console.log('[5/6] Creating spatial index...');
  const indexStart = Date.now();
  psql(`
    CREATE INDEX IF NOT EXISTS idx_bag_buildings_geometry ON bag_buildings USING GIST (geometry);
  `);
  console.log(`  Index created in ${formatTime(Date.now() - indexStart)}`);

  // Step 6: Cleanup staging and analyze
  console.log('[6/6] Cleanup and ANALYZE...');
  psql(`
    DROP TABLE IF EXISTS bag_buildings_staging;
    ANALYZE bag_buildings;
  `);

  const elapsed = Date.now() - startTime;
  console.log(`\nDone in ${formatTime(elapsed)}`);

  // Report count and height stats
  const countResult = execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -t -c "SELECT COUNT(*) FROM bag_buildings;"`,
    { encoding: 'utf-8' },
  ).trim();
  console.log(`Imported ${countResult} buildings`);

  const heightStats = execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -t -c "SELECT ROUND(AVG(render_height)::numeric, 1) AS avg_h, MIN(render_height) AS min_h, MAX(render_height) AS max_h FROM bag_buildings;"`,
    { encoding: 'utf-8' },
  ).trim();
  console.log(`Height stats (avg | min | max): ${heightStats}`);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
