/**
 * Import Overture Maps divisions into PostGIS for admin search areas.
 *
 * Usage:
 *   pnpm -C services/api run db:import-overture-divisions
 *   pnpm -C services/api run db:import-overture-divisions -- --country NL,DE,BE
 *   pnpm -C services/api run db:import-overture-divisions -- --release 2026-02-18.0
 *   pnpm -C services/api run db:import-overture-divisions -- --local /path/to/release
 *   pnpm -C services/api run db:import-overture-divisions -- --dry-run
 */
import { execSync } from 'child_process';
import { existsSync, statSync, unlinkSync } from 'fs';
import postgres from 'postgres';
import dotenv from 'dotenv';
import {
  getAllCountryCodes,
  isValidCountryCode,
  type CountryCode,
} from '@huishype/shared/config';
import { discoverLatestRelease } from './import-overture-addresses.js';

dotenv.config({ quiet: true });

const OVERTURE_S3_BUCKET = 's3://overturemaps-us-west-2/release';
const DIVISION_THEME_PATH = 'theme=divisions/type=division/*';
const DIVISION_AREA_THEME_PATH = 'theme=divisions/type=division_area/*';
const SUPPORTED_SUBTYPES = ['country', 'region', 'locality', 'localadmin'] as const;
const EUROPE_BBOX = { xmin: -25, xmax: 45, ymin: 34, ymax: 72 };

const DIVISIONS_CSV_PATH = '/tmp/overture_divisions.csv';
const DIVISION_AREAS_CSV_PATH = '/tmp/overture_division_areas.csv';

const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://huishype:huishype_dev@localhost:5440/huishype';

interface CliArgs {
  countries: CountryCode[];
  localPath?: string;
  release?: string;
  dryRun: boolean;
}

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
    return Math.max(0, parseInt(output, 10) - 1);
  } catch {
    return 0;
  }
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let countries: CountryCode[] = getAllCountryCodes();

  const countryIdx = args.indexOf('--country');
  if (countryIdx !== -1 && countryIdx + 1 < args.length) {
    const val = args[countryIdx + 1].toUpperCase();
    if (val !== 'ALL') {
      countries = val.split(',').map((raw) => {
        const code = raw.trim();
        if (!isValidCountryCode(code)) {
          console.error(`Unknown country code: ${code}`);
          console.error(`Valid codes: ${getAllCountryCodes().join(', ')}`);
          process.exit(1);
        }
        return code;
      });
    }
  }

  const localIdx = args.indexOf('--local');
  const localPath =
    localIdx !== -1 && localIdx + 1 < args.length ? args[localIdx + 1] : undefined;

  const releaseIdx = args.indexOf('--release');
  const release =
    releaseIdx !== -1 && releaseIdx + 1 < args.length ? args[releaseIdx + 1] : undefined;

  return {
    countries,
    localPath,
    release,
    dryRun: args.includes('--dry-run'),
  };
}

export function buildDivisionParquetSource(
  release: string,
  featureType: 'division' | 'division_area',
  localPath?: string
): string {
  const themePath = featureType === 'division' ? DIVISION_THEME_PATH : DIVISION_AREA_THEME_PATH;
  if (!localPath) {
    return `'${OVERTURE_S3_BUCKET}/${release}/${themePath}'`;
  }

  try {
    if (existsSync(localPath) && statSync(localPath).isDirectory()) {
      return `'${localPath.replace(/\/$/u, '')}/${themePath}'`;
    }
  } catch {
    /* fall through to treating --local as an explicit parquet glob */
  }

  return `'${localPath}'`;
}

export function buildDivisionCountryFilter(countries: CountryCode[]): string {
  return `country IN (${countries.map((country) => `'${country}'`).join(', ')})`;
}

function buildSubtypeFilter(): string {
  return `subtype IN (${SUPPORTED_SUBTYPES.map((subtype) => `'${subtype}'`).join(', ')})`;
}

function buildEuropeBboxOverlapFilter(): string {
  return `
        AND bbox.xmax >= ${EUROPE_BBOX.xmin}
        AND bbox.xmin <= ${EUROPE_BBOX.xmax}
        AND bbox.ymax >= ${EUROPE_BBOX.ymin}
        AND bbox.ymin <= ${EUROPE_BBOX.ymax}
  `;
}

export function buildDivisionsDuckDbQuery(
  divisionSource: string,
  divisionAreaSource: string,
  countries: CountryCode[]
): string {
  const countryFilter = buildDivisionCountryFilter(countries);
  const subtypeFilter = buildSubtypeFilter();
  const bboxFilter = buildEuropeBboxOverlapFilter();

  return `
    INSTALL spatial; LOAD spatial;
    INSTALL httpfs;  LOAD httpfs;

    SET s3_region = 'us-west-2';
    SET preserve_insertion_order = false;

    COPY (
      SELECT
        id,
        subtype,
        country,
        region,
        names.primary AS name,
        parent_division_id,
        admin_level,
        hex(ST_AsWKB(geometry)) AS geometry_wkb
      FROM read_parquet(${divisionSource}, hive_partitioning=1)
      WHERE ${countryFilter}
        AND ${subtypeFilter}
        ${bboxFilter}
        AND names.primary IS NOT NULL
        AND geometry IS NOT NULL
    ) TO '${DIVISIONS_CSV_PATH}' (HEADER, DELIMITER ',');

    COPY (
      SELECT
        id,
        division_id,
        subtype,
        country,
        region,
        names.primary AS name,
        admin_level,
        bbox.xmin AS min_lon,
        bbox.ymin AS min_lat,
        bbox.xmax AS max_lon,
        bbox.ymax AS max_lat,
        hex(ST_AsWKB(geometry)) AS geometry_wkb
      FROM read_parquet(${divisionAreaSource}, hive_partitioning=1)
      WHERE ${countryFilter}
        AND ${subtypeFilter}
        ${bboxFilter}
        AND is_land = true
        AND names.primary IS NOT NULL
        AND division_id IS NOT NULL
        AND geometry IS NOT NULL
    ) TO '${DIVISION_AREAS_CSV_PATH}' (HEADER, DELIMITER ',');
  `;
}

function phase1Extract(release: string, countries: CountryCode[], localPath?: string): {
  divisionRows: number;
  areaRows: number;
} {
  console.log('\nPhase 1: DuckDB extraction to CSV...');
  const divisionSource = buildDivisionParquetSource(release, 'division', localPath);
  const divisionAreaSource = buildDivisionParquetSource(release, 'division_area', localPath);
  const query = buildDivisionsDuckDbQuery(divisionSource, divisionAreaSource, countries);

  for (const path of [DIVISIONS_CSV_PATH, DIVISION_AREAS_CSV_PATH]) {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }

  const queryFile = '/tmp/overture_divisions_query.sql';
  execSync(`cat > "${queryFile}" << 'DUCKDB_EOF'\n${query}\nDUCKDB_EOF`, {
    stdio: 'pipe',
  });

  const start = Date.now();
  try {
    execSync(`duckdb < "${queryFile}"`, {
      stdio: 'inherit',
      timeout: 60 * 60 * 1000,
      env: { ...process.env, HOME: process.env.HOME },
    });
  } finally {
    try {
      unlinkSync(queryFile);
    } catch {
      /* ignore */
    }
  }

  if (!existsSync(DIVISIONS_CSV_PATH)) {
    throw new Error(`DuckDB did not produce ${DIVISIONS_CSV_PATH}`);
  }
  if (!existsSync(DIVISION_AREAS_CSV_PATH)) {
    throw new Error(`DuckDB did not produce ${DIVISION_AREAS_CSV_PATH}`);
  }

  const divisionRows = countCsvRows(DIVISIONS_CSV_PATH);
  const areaRows = countCsvRows(DIVISION_AREAS_CSV_PATH);
  console.log(
    `  Extracted ${fmt(divisionRows)} divisions and ${fmt(areaRows)} areas in ${formatTime(Date.now() - start)}`
  );
  return { divisionRows, areaRows };
}

async function phase2Copy(sql: postgres.Sql): Promise<void> {
  console.log('\nPhase 2: COPY CSV into staging tables...');
  await sql`DROP TABLE IF EXISTS overture_divisions_staging`;
  await sql`DROP TABLE IF EXISTS overture_division_areas_staging`;
  await sql`
    CREATE UNLOGGED TABLE overture_divisions_staging (
      id TEXT,
      subtype TEXT,
      country TEXT,
      region TEXT,
      name TEXT,
      parent_division_id TEXT,
      admin_level TEXT,
      geometry_wkb TEXT
    )
  `;
  await sql`
    CREATE UNLOGGED TABLE overture_division_areas_staging (
      id TEXT,
      division_id TEXT,
      subtype TEXT,
      country TEXT,
      region TEXT,
      name TEXT,
      admin_level TEXT,
      min_lon TEXT,
      min_lat TEXT,
      max_lon TEXT,
      max_lat TEXT,
      geometry_wkb TEXT
    )
  `;

  const start = Date.now();
  const copyDivisions = `cat "${DIVISIONS_CSV_PATH}" | docker exec -i huishype-postgres psql -U huishype -d huishype -c "COPY overture_divisions_staging FROM STDIN WITH (FORMAT csv, HEADER true)"`;
  const copyAreas = `cat "${DIVISION_AREAS_CSV_PATH}" | docker exec -i huishype-postgres psql -U huishype -d huishype -c "COPY overture_division_areas_staging FROM STDIN WITH (FORMAT csv, HEADER true)"`;
  execSync(copyDivisions, { maxBuffer: 500 * 1024 * 1024, timeout: 10 * 60 * 1000 });
  execSync(copyAreas, { maxBuffer: 500 * 1024 * 1024, timeout: 10 * 60 * 1000 });

  const divisionCount = await sql`SELECT COUNT(*)::int AS count FROM overture_divisions_staging`;
  const areaCount = await sql`SELECT COUNT(*)::int AS count FROM overture_division_areas_staging`;
  console.log(
    `  Loaded ${fmt(divisionCount[0].count)} divisions and ${fmt(areaCount[0].count)} areas in ${formatTime(Date.now() - start)}`
  );
}

export function buildOvertureDivisionsUpsertQuery(): string {
  return `
    WITH changed_divisions AS (
      INSERT INTO overture_divisions (
        id,
        subtype,
        country_code,
        region,
        name,
        parent_division_id,
        admin_level,
        geometry
      )
      SELECT DISTINCT ON (id)
        id,
        subtype,
        UPPER(country),
        NULLIF(region, ''),
        name,
        NULLIF(parent_division_id, ''),
        NULLIF(admin_level, '')::int,
        ST_SetSRID(ST_GeomFromWKB(decode(geometry_wkb, 'hex')), 4326)::geometry(Point, 4326)
      FROM overture_divisions_staging
      WHERE id IS NOT NULL
        AND name IS NOT NULL
        AND geometry_wkb IS NOT NULL
      ORDER BY id, name
      ON CONFLICT (id) DO UPDATE SET
        subtype = EXCLUDED.subtype,
        country_code = EXCLUDED.country_code,
        region = EXCLUDED.region,
        name = EXCLUDED.name,
        parent_division_id = EXCLUDED.parent_division_id,
        admin_level = EXCLUDED.admin_level,
        geometry = EXCLUDED.geometry,
        updated_at = NOW()
      WHERE overture_divisions.subtype IS DISTINCT FROM EXCLUDED.subtype
        OR overture_divisions.country_code IS DISTINCT FROM EXCLUDED.country_code
        OR overture_divisions.region IS DISTINCT FROM EXCLUDED.region
        OR overture_divisions.name IS DISTINCT FROM EXCLUDED.name
        OR overture_divisions.parent_division_id IS DISTINCT FROM EXCLUDED.parent_division_id
        OR overture_divisions.admin_level IS DISTINCT FROM EXCLUDED.admin_level
        OR overture_divisions.geometry IS DISTINCT FROM EXCLUDED.geometry
      RETURNING id
    ),
    changed_areas AS (
      INSERT INTO overture_division_areas (
        id,
        division_id,
        subtype,
        country_code,
        region,
        name,
        admin_level,
        min_lon,
        min_lat,
        max_lon,
        max_lat,
        geometry
      )
      SELECT DISTINCT ON (area.id)
        area.id,
        area.division_id,
        area.subtype,
        UPPER(area.country),
        NULLIF(area.region, ''),
        area.name,
        NULLIF(area.admin_level, '')::int,
        NULLIF(area.min_lon, '')::double precision,
        NULLIF(area.min_lat, '')::double precision,
        NULLIF(area.max_lon, '')::double precision,
        NULLIF(area.max_lat, '')::double precision,
        ST_SetSRID(ST_GeomFromWKB(decode(area.geometry_wkb, 'hex')), 4326)
      FROM overture_division_areas_staging area
      JOIN overture_divisions division ON division.id = area.division_id
      WHERE area.id IS NOT NULL
        AND area.division_id IS NOT NULL
        AND area.name IS NOT NULL
        AND area.geometry_wkb IS NOT NULL
      ORDER BY area.id, area.name
      ON CONFLICT (id) DO UPDATE SET
        division_id = EXCLUDED.division_id,
        subtype = EXCLUDED.subtype,
        country_code = EXCLUDED.country_code,
        region = EXCLUDED.region,
        name = EXCLUDED.name,
        admin_level = EXCLUDED.admin_level,
        min_lon = EXCLUDED.min_lon,
        min_lat = EXCLUDED.min_lat,
        max_lon = EXCLUDED.max_lon,
        max_lat = EXCLUDED.max_lat,
        geometry = EXCLUDED.geometry,
        updated_at = NOW()
      WHERE overture_division_areas.division_id IS DISTINCT FROM EXCLUDED.division_id
        OR overture_division_areas.subtype IS DISTINCT FROM EXCLUDED.subtype
        OR overture_division_areas.country_code IS DISTINCT FROM EXCLUDED.country_code
        OR overture_division_areas.region IS DISTINCT FROM EXCLUDED.region
        OR overture_division_areas.name IS DISTINCT FROM EXCLUDED.name
        OR overture_division_areas.admin_level IS DISTINCT FROM EXCLUDED.admin_level
        OR overture_division_areas.min_lon IS DISTINCT FROM EXCLUDED.min_lon
        OR overture_division_areas.min_lat IS DISTINCT FROM EXCLUDED.min_lat
        OR overture_division_areas.max_lon IS DISTINCT FROM EXCLUDED.max_lon
        OR overture_division_areas.max_lat IS DISTINCT FROM EXCLUDED.max_lat
        OR overture_division_areas.geometry IS DISTINCT FROM EXCLUDED.geometry
      RETURNING id
    )
    SELECT
      (SELECT COUNT(*)::int FROM changed_divisions) AS changed_divisions,
      (SELECT COUNT(*)::int FROM changed_areas) AS changed_areas
  `;
}

async function phase3Upsert(sql: postgres.Sql): Promise<{ changedDivisions: number; changedAreas: number }> {
  console.log('\nPhase 3: Upsert into Overture division tables...');
  const start = Date.now();
  await sql`SET statement_timeout = '0'`;
  const changed = await sql.unsafe(buildOvertureDivisionsUpsertQuery());
  const changedDivisions = Number(changed[0]?.changed_divisions ?? 0);
  const changedAreas = Number(changed[0]?.changed_areas ?? 0);
  console.log(
    `  Upserted ${fmt(changedDivisions)} changed divisions and ${fmt(changedAreas)} changed areas in ${formatTime(Date.now() - start)}`
  );
  return { changedDivisions, changedAreas };
}

async function rebuildLocationSearchAreasAfterDivisionImport(): Promise<void> {
  const { rebuildLocationSearchAreas } = await import('../services/location-search-areas.js');
  const { closeConnection } = await import('../db/index.js');
  try {
    const result = await rebuildLocationSearchAreas();
    console.log(
      `  Rebuilt location_search_areas after overture-division-import: ${fmt(result.beforeCount)} -> ${fmt(result.afterCount)} rows`
    );
  } finally {
    await closeConnection();
  }
}

async function phase4Cleanup(sql: postgres.Sql): Promise<void> {
  console.log('\nPhase 4: Cleanup + ANALYZE...');
  const start = Date.now();
  await sql`DROP TABLE IF EXISTS overture_divisions_staging`;
  await sql`DROP TABLE IF EXISTS overture_division_areas_staging`;
  await sql`ANALYZE overture_divisions`;
  await sql`ANALYZE overture_division_areas`;
  console.log(`  Done in ${formatTime(Date.now() - start)}`);
}

async function main(): Promise<void> {
  const totalStart = Date.now();
  const { countries, localPath, release: pinnedRelease, dryRun } = parseArgs();

  console.log('='.repeat(60));
  console.log('Overture Maps Division Import');
  console.log('='.repeat(60));

  const release = pinnedRelease ?? (localPath ? 'local' : await discoverLatestRelease());
  console.log(`  Release: ${release}`);
  console.log(`  Countries: ${countries.join(', ')}`);
  if (localPath) console.log(`  Source: ${localPath}`);
  if (dryRun) console.log('  Mode: DRY RUN');

  const { divisionRows, areaRows } = phase1Extract(release, countries, localPath);
  if (divisionRows === 0 || areaRows === 0) {
    console.log('\nNo complete division data extracted. Nothing to import.');
    return;
  }
  if (dryRun) {
    console.log('\n  DRY RUN - stopping before database changes');
    return;
  }

  const sql = postgres(DB_URL, {
    max: 3,
    idle_timeout: 0,
    connect_timeout: 30,
    onnotice: () => {},
  });

  try {
    await phase2Copy(sql);
    const { changedDivisions, changedAreas } = await phase3Upsert(sql);
    if (changedDivisions > 0 || changedAreas > 0) {
      await rebuildLocationSearchAreasAfterDivisionImport();
    }
    await phase4Cleanup(sql);
    console.log('\n' + '='.repeat(60));
    console.log('Division Import Complete');
    console.log('='.repeat(60));
    console.log(`Total time: ${formatTime(Date.now() - totalStart)}`);
  } catch (error) {
    try {
      await sql`DROP TABLE IF EXISTS overture_divisions_staging`;
      await sql`DROP TABLE IF EXISTS overture_division_areas_staging`;
    } catch {
      /* ignore */
    }
    throw error;
  } finally {
    await sql.end();
  }
}

const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].includes('import-overture-divisions') || process.argv[1].includes('tsx'));

if (isDirectRun) {
  main().catch((error) => {
    console.error('\nOverture division import failed:', error);
    process.exit(1);
  });
}
