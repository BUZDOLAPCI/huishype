import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { VectorTile } from '@mapbox/vector-tile';
import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import Pbf from 'pbf';
import { resetPropertyTileCacheForTests } from '../../routes/tiles.js';

const TEST_LANDCOVER_OSM_ID = -900000101;
const TEST_TREE_LANDCOVER_OSM_ID = -900000102;

describe('Tree tiles endpoint', () => {
  let app: FastifyInstance;
  let landcoverTableExistedBefore = false;
  let treeLandcoverTableExistedBefore = false;
  let tallBuildingsTableExistedBefore = false;

  beforeAll(async () => {
    const tableState = Array.from(
      await db.execute<{
        hasLandcover: boolean;
        hasTreeLandcover: boolean;
        hasTallBuildings: boolean;
      }>(sql`
        SELECT
          to_regclass('public.landcover') IS NOT NULL AS "hasLandcover",
          to_regclass('public.tree_landcover') IS NOT NULL AS "hasTreeLandcover",
          to_regclass('public.tall_buildings') IS NOT NULL AS "hasTallBuildings"
      `)
    )[0];
    landcoverTableExistedBefore = Boolean(tableState?.hasLandcover);
    treeLandcoverTableExistedBefore = Boolean(tableState?.hasTreeLandcover);
    tallBuildingsTableExistedBefore = Boolean(tableState?.hasTallBuildings);

    await db.execute(sql`
      DO $$
      BEGIN
        IF to_regclass('public.landcover') IS NULL THEN
          CREATE TABLE landcover (
            id SERIAL PRIMARY KEY,
            osm_id BIGINT,
            type VARCHAR(50) NOT NULL,
            geometry GEOMETRY(MultiPolygon, 4326) NOT NULL
          );
        END IF;
      END $$;
    `);
    await db.execute(sql`
      DO $$
      BEGIN
        IF to_regclass('public.tree_landcover') IS NULL THEN
          CREATE TABLE tree_landcover (
            id SERIAL PRIMARY KEY,
            landcover_id INTEGER NOT NULL,
            osm_id BIGINT,
            type VARCHAR(50) NOT NULL,
            geometry GEOMETRY(MultiPolygon, 4326) NOT NULL
          );
        END IF;
      END $$;
    `);
    await db.execute(sql`
      DO $$
      BEGIN
        IF to_regclass('public.tall_buildings') IS NULL THEN
          CREATE TABLE tall_buildings (
            id SERIAL PRIMARY KEY,
            osm_id BIGINT,
            height REAL NOT NULL,
            geometry GEOMETRY(MultiPolygon, 4326) NOT NULL,
            exclusion_geom GEOMETRY(Geometry, 4326) NOT NULL
          );
        END IF;
      END $$;
    `);
    await db.execute(sql`
      DO $$
      BEGIN
        IF to_regclass('public.idx_tree_landcover_geometry') IS NULL THEN
          CREATE INDEX idx_tree_landcover_geometry ON tree_landcover USING GIST (geometry);
        END IF;
        IF to_regclass('public.idx_tall_buildings_exclusion') IS NULL THEN
          CREATE INDEX idx_tall_buildings_exclusion ON tall_buildings USING GIST (exclusion_geom);
        END IF;
      END $$;
    `);
    await db.execute(sql`DELETE FROM landcover WHERE osm_id = ${TEST_LANDCOVER_OSM_ID}`);
    await db.execute(sql`
      DELETE FROM tree_landcover
      WHERE osm_id IN (${TEST_LANDCOVER_OSM_ID}, ${TEST_TREE_LANDCOVER_OSM_ID})
    `);
    await db.execute(sql`
      INSERT INTO landcover (osm_id, type, geometry)
      VALUES (
        ${TEST_LANDCOVER_OSM_ID},
        'test-park-covered-by-water',
        ST_Multi(ST_Transform(ST_TileEnvelope(15, 1, 1), 4326))
      )
    `);
    resetPropertyTileCacheForTests();
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    if (landcoverTableExistedBefore) {
      await db.execute(sql`DELETE FROM landcover WHERE osm_id = ${TEST_LANDCOVER_OSM_ID}`);
    } else {
      await db.execute(sql`DROP TABLE IF EXISTS landcover CASCADE`);
    }
    if (treeLandcoverTableExistedBefore) {
      await db.execute(sql`
        DELETE FROM tree_landcover
        WHERE osm_id IN (${TEST_LANDCOVER_OSM_ID}, ${TEST_TREE_LANDCOVER_OSM_ID})
      `);
    } else {
      await db.execute(sql`DROP TABLE IF EXISTS tree_landcover CASCADE`);
    }
    if (!tallBuildingsTableExistedBefore) {
      await db.execute(sql`DROP TABLE IF EXISTS tall_buildings CASCADE`);
    }
    await app.close();
  });

  it('GET /tiles/trees/:z/:x/:y.pbf returns 204 below minzoom', async () => {
    const res = await app.inject({ method: 'GET', url: '/tiles/trees/10/527/340.pbf' });
    expect(res.statusCode).toBe(204);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('GET /tiles/trees/:z/:x/:y.pbf returns 204 above maxzoom', async () => {
    const res = await app.inject({ method: 'GET', url: '/tiles/trees/21/0/0.pbf' });
    expect(res.statusCode).toBe(204);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('GET /tiles/trees/:z/:x/:y.pbf returns MVT or 204 at z15', async () => {
    // Eindhoven area tile
    const res = await app.inject({ method: 'GET', url: '/tiles/trees/15/16892/10898.pbf' });
    // May be 200 (if landcover exists in tile) or 204 (no green areas)
    expect([200, 204]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.headers['content-type']).toBe('application/x-protobuf');
      expect(res.rawPayload.length).toBeGreaterThan(0);
    }
  });

  it('uses water-subtracted tree_landcover instead of raw overlapping landcover', async () => {
    const res = await app.inject({ method: 'GET', url: '/tiles/trees/15/1/1.pbf' });

    expect(res.statusCode).toBe(204);
  });

  it('still emits trees from dry tree_landcover polygons', async () => {
    await db.execute(sql`DELETE FROM tree_landcover WHERE osm_id = ${TEST_TREE_LANDCOVER_OSM_ID}`);
    await db.execute(sql`
      INSERT INTO tree_landcover (landcover_id, osm_id, type, geometry)
      VALUES (
        -1,
        ${TEST_TREE_LANDCOVER_OSM_ID},
        'test-dry-park',
        ST_Multi(ST_Transform(ST_TileEnvelope(15, 2, 2), 4326))
      )
    `);

    const res = await app.inject({ method: 'GET', url: '/tiles/trees/15/2/2.pbf' });

    expect(res.statusCode).toBe(200);
    const tile = new VectorTile(new Pbf(res.rawPayload));
    const layer = tile.layers['scattered-trees'];
    expect(layer).toBeDefined();
    expect(layer.length).toBeGreaterThan(0);
  });

  it('tree tiles are deterministic', async () => {
    const res1 = await app.inject({ method: 'GET', url: '/tiles/trees/15/16892/10898.pbf' });
    const res2 = await app.inject({ method: 'GET', url: '/tiles/trees/15/16892/10898.pbf' });
    expect(res1.statusCode).toBe(res2.statusCode);
    if (res1.statusCode === 200) {
      expect(res1.rawPayload).toEqual(res2.rawPayload);
    }
  });

  it('tree tiles have cache headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/tiles/trees/15/16892/10898.pbf' });
    expect(res.headers['cache-control']).toContain('max-age');
  });

  it('style.json includes tree-source', async () => {
    const res = await app.inject({ method: 'GET', url: '/tiles/style.json' });
    expect(res.statusCode).toBe(200);
    const style = JSON.parse(res.body);
    expect(style.sources).toHaveProperty('tree-source');
    expect(style.sources['tree-source'].type).toBe('vector');
    expect(style.sources['tree-source'].tiles[0]).toContain('/tiles/trees/{z}/{x}/{y}.pbf');
    expect(style.sources['tree-source'].minzoom).toBe(15);
    expect(style.sources['tree-source'].maxzoom).toBe(20);
    const treeLayerIndex = style.layers.findIndex(
      (layer: { id?: string }) => layer.id === 'paper-trees'
    );
    const buildings3DIndex = style.layers.findIndex(
      (layer: { id?: string }) => layer.id === '3d-buildings'
    );
    expect(treeLayerIndex).toBeGreaterThanOrEqual(0);
    expect(buildings3DIndex).toBeGreaterThanOrEqual(0);
    expect(treeLayerIndex).toBeGreaterThan(buildings3DIndex);
  });

  it('tall_buildings table exists and tree tile query works with exclusion', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/tiles/trees/15/16892/10898.pbf',
    });
    // Query should not error — verifies tall_buildings table exists
    // (query would fail with "relation tall_buildings does not exist" otherwise)
    expect([200, 204]).toContain(res.statusCode);
  });

  it('GIST index on exclusion_geom exists (prevents sequential scan)', async () => {
    const result = await db.execute<{ indexname: string }>(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'tall_buildings'
      AND indexdef LIKE '%exclusion_geom%'
    `);
    expect(result.length).toBeGreaterThan(0);
  });
});
