/**
 * Real PostgreSQL optional-import coverage. Existing imported relations are moved
 * aside and restored; absent-source cases run with no substitute tables/views.
 * Run serially with the API integration suites that own landcover fixtures.
 */
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp } from '../../app.js';
import { db, reserveDbConnection } from '../../db/index.js';

const optionalTables = ['landcover', 'tree_landcover', 'watercover', 'tall_buildings'] as const;
type OptionalTable = typeof optionalTables[number];
const savedSchema = `optional_map_${randomUUID().replaceAll('-', '')}`;
const brokenSchema = `${savedSchema}_broken`;
const tileGeometry = 'ST_Multi(ST_Transform(ST_TileEnvelope(15, 16892, 10898), 4326))';
const treesUrl = '/tiles/trees/15/16892/10898.pbf';
const ducksUrl = '/tiles/ducks/15/16892/10898.pbf';

describe('Optional map imports on fresh and partially imported PostgreSQL schemas', () => {
  let app: FastifyInstance;
  const savedTables: OptionalTable[] = [];
  const fixtureTables = new Set<OptionalTable>();

  async function clearFixtures(): Promise<void> {
    for (const tableName of fixtureTables) {
      await db.execute(sql.raw(`DROP TABLE public.${tableName}`));
      fixtureTables.delete(tableName);
    }
  }

  async function importPolygon(tableName: OptionalTable): Promise<void> {
    const additionalColumns = tableName === 'watercover'
      ? ', area_m2 DOUBLE PRECISION NOT NULL'
      : tableName === 'tall_buildings'
        ? ', exclusion_geom GEOMETRY(Geometry, 4326) NOT NULL'
        : '';
    await db.execute(sql.raw(`
      CREATE TABLE public.${tableName} (
        id SERIAL PRIMARY KEY,
        geometry GEOMETRY(MultiPolygon, 4326) NOT NULL
        ${additionalColumns}
      )
    `));
    fixtureTables.add(tableName);
    const additionalNames = tableName === 'watercover' ? ', area_m2'
      : tableName === 'tall_buildings' ? ', exclusion_geom' : '';
    const additionalValues = tableName === 'watercover' ? ', 1000000'
      : tableName === 'tall_buildings' ? `, ${tileGeometry}` : '';
    await db.execute(sql.raw(`
      INSERT INTO public.${tableName} (geometry${additionalNames})
      VALUES (${tileGeometry}${additionalValues})
    `));
  }

  async function treeCount(): Promise<number> {
    const response = await app.inject({ method: 'GET', url: treesUrl });
    expect(response.headers['cache-control']).toBe('public, max-age=3600');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/x-protobuf');
    const layer = new VectorTile(new Pbf(response.rawPayload)).layers['scattered-trees'];
    expect(layer).toBeDefined();
    expect(layer.length).toBeGreaterThan(0);
    return layer.length;
  }

  async function expectEmpty(url = treesUrl): Promise<void> {
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(204);
    expect(response.rawPayload.length).toBe(0);
    expect(response.headers['cache-control']).toBe('public, max-age=3600');
  }

  beforeAll(async () => {
    await db.execute(sql.raw(`CREATE SCHEMA ${savedSchema}`));
    await db.execute(sql.raw(`CREATE SCHEMA ${brokenSchema}`));
    for (const tableName of optionalTables) {
      const rows = await db.execute<{ present: boolean }>(sql`
        SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS present
      `);
      if (Array.from(rows)[0].present) {
        await db.execute(sql.raw(`ALTER TABLE public.${tableName} SET SCHEMA ${savedSchema}`));
        savedTables.push(tableName);
      }
    }
    app = await buildApp({ logger: false });
  });

  beforeEach(clearFixtures);

  afterAll(async () => {
    await clearFixtures();
    for (const tableName of savedTables) {
      await db.execute(sql.raw(`ALTER TABLE ${savedSchema}.${tableName} SET SCHEMA public`));
    }
    await db.execute(sql.raw(`DROP SCHEMA ${savedSchema} CASCADE`));
    await db.execute(sql.raw(`DROP SCHEMA ${brokenSchema} CASCADE`));
    await app?.close();
  });

  it('returns empty tree and duck tiles before any optional import exists', async () => {
    const rows = await db.execute<{ absent: boolean }>(sql`
      SELECT bool_and(to_regclass('public.' || name) IS NULL) AS absent
      FROM unnest(ARRAY['landcover', 'tree_landcover', 'watercover', 'tall_buildings']) AS name
    `);
    expect(Array.from(rows)[0].absent).toBe(true);
    await expectEmpty();
    await expectEmpty(ducksUrl);
  });

  it.each(['landcover', 'tree_landcover'] as const)(
    'emits deterministic trees from populated %s without water or building imports',
    async (source) => {
      await importPolygon(source);
      const firstCount = await treeCount();
      expect(await treeCount()).toBe(firstCount);
      const first = await app.inject({ method: 'GET', url: treesUrl });
      const second = await app.inject({ method: 'GET', url: treesUrl });
      expect(first.rawPayload).toEqual(second.rawPayload);
    }
  );

  it('returns empty trees with only water/building imports while retaining populated duck tiles', async () => {
    await importPolygon('watercover');
    await importPolygon('tall_buildings');
    await expectEmpty();
    const response = await app.inject({ method: 'GET', url: ducksUrl });
    expect(response.statusCode).toBe(200);
    expect(new VectorTile(new Pbf(response.rawPayload)).layers['scattered-ducks'].length).toBeGreaterThan(0);
  });

  it('applies available water exclusion to raw landcover without requiring buildings', async () => {
    await importPolygon('landcover');
    await treeCount();
    await importPolygon('watercover');
    await expectEmpty();
  });

  it.each(['landcover', 'tree_landcover'] as const)(
    'applies populated building exclusions to %s without requiring water',
    async (source) => {
      await importPolygon(source);
      await treeCount();
      await importPolygon('tall_buildings');
      await expectEmpty();
    }
  );

  it('discovers completed/rebuilt imports without restart and prefers precomputed tree landcover', async () => {
    await expectEmpty();
    await importPolygon('landcover');
    const rawCount = await treeCount();
    await importPolygon('watercover');
    await expectEmpty();
    await importPolygon('tree_landcover');
    // Precomputed tree landcover remains authoritative, as in the import contract.
    expect(await treeCount()).toBe(rawCount);
    await importPolygon('tall_buildings');
    await expectEmpty();
    await clearFixtures();
    await expectEmpty();
    await importPolygon('tree_landcover');
    expect(await treeCount()).toBe(rawCount);
  });

  it('returns an empty tile when an importer drops a discovered source before its query acquires the table', async () => {
    await importPolygon('landcover');
    const importer = await reserveDbConnection();
    let inTransaction = false;
    let request: Promise<LightMyRequestResponse> | undefined;
    try {
      await importer`BEGIN`;
      inTransaction = true;
      await importer`LOCK TABLE public.landcover IN ACCESS EXCLUSIVE MODE`;
      request = app.inject({ method: 'GET', url: treesUrl });
      // Start the request, then observe its real relation lock wait in PostgreSQL.
      void request.then(() => undefined);
      let blocked = false;
      const deadline = Date.now() + 5000;
      while (!blocked && Date.now() < deadline) {
        await importer`SELECT pg_stat_clear_snapshot()`;
        const rows = await importer<{ blocked: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock' AND query LIKE '%WITH candidates%'
          ) AS blocked
        `;
        blocked = rows[0].blocked;
        if (!blocked) await delay(20);
      }
      expect(blocked).toBe(true);
      await importer`DROP TABLE public.landcover`;
      await importer`COMMIT`;
      inTransaction = false;
      fixtureTables.delete('landcover');
      const response = await request;
      expect(response.statusCode).toBe(204);
      expect(response.headers['cache-control']).toBe('public, max-age=3600');
    } finally {
      if (inTransaction) await importer`ROLLBACK`;
      importer.release();
      await request;
    }
  });

  it('surfaces malformed existing import schemas instead of hiding query failures', async () => {
    await importPolygon('landcover');
    await db.execute(sql`ALTER TABLE public.landcover RENAME COLUMN geometry TO malformed_geometry`);
    expect((await app.inject({ method: 'GET', url: treesUrl })).statusCode).toBe(500);
    await importPolygon('watercover');
    await db.execute(sql`ALTER TABLE public.watercover RENAME COLUMN geometry TO malformed_geometry`);
    expect((await app.inject({ method: 'GET', url: ducksUrl })).statusCode).toBe(500);
  });

  it('surfaces unrelated undefined-table errors from imported geometry processing', async () => {
    await importPolygon('landcover');
    await importPolygon('watercover');
    // A real database function simulates a broken imported geometry dependency.
    // The route must not reinterpret every PostgreSQL 42P01 as absent watercover.
    await db.execute(sql.raw(`
      CREATE FUNCTION ${savedSchema}.broken_geometry(geometry) RETURNS geometry
      LANGUAGE plpgsql VOLATILE AS $$
      BEGIN
        PERFORM 1 FROM optional_map_unrelated_missing_relation;
        RETURN $1;
      END $$
    `));
    for (const tableName of ['landcover', 'watercover'] as const) {
      await db.execute(sql.raw(`ALTER TABLE public.${tableName} RENAME TO fixture_${tableName}`));
      await db.execute(sql.raw(`ALTER TABLE public.fixture_${tableName} SET SCHEMA ${brokenSchema}`));
      fixtureTables.delete(tableName);
      await db.execute(sql.raw(`
        CREATE VIEW public.${tableName} AS
        SELECT id, ${savedSchema}.broken_geometry(geometry) AS geometry
          ${tableName === 'watercover' ? ', area_m2' : ''}
        FROM ${brokenSchema}.fixture_${tableName}
      `));
    }
    try {
      expect((await app.inject({ method: 'GET', url: treesUrl })).statusCode).toBe(500);
      expect((await app.inject({ method: 'GET', url: ducksUrl })).statusCode).toBe(500);
    } finally {
      for (const tableName of ['landcover', 'watercover'] as const) {
        await db.execute(sql.raw(`DROP VIEW public.${tableName}`));
        await db.execute(sql.raw(`DROP TABLE ${brokenSchema}.fixture_${tableName}`));
      }
    }
  });
});
