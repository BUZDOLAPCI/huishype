import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { VectorTile } from '@mapbox/vector-tile';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import Pbf from 'pbf';
import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { DUCK_VARIANTS } from '../../services/duck-scatter.js';

const TEST_WATERCOVER_OSM_ID = -900000001;

type StyleLayer = {
  id?: string;
  source?: string;
  'source-layer'?: string;
  minzoom?: number;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
};

type StyleJson = {
  sources: Record<string, { type?: string; tiles?: string[]; minzoom?: number; maxzoom?: number }>;
  layers: StyleLayer[];
};

describe('Duck tiles endpoint', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await db.execute(sql`
      DO $$
      BEGIN
        IF to_regclass('public.watercover') IS NULL THEN
          CREATE TABLE watercover (
            id SERIAL PRIMARY KEY,
            osm_id BIGINT,
            type VARCHAR(50) NOT NULL,
            area_m2 DOUBLE PRECISION NOT NULL,
            geometry GEOMETRY(MultiPolygon, 4326) NOT NULL
          );
        END IF;
      END $$;
    `);
    await db.execute(sql`
      DO $$
      BEGIN
        IF to_regclass('public.idx_watercover_geometry') IS NULL THEN
          CREATE INDEX idx_watercover_geometry ON watercover USING GIST (geometry);
        END IF;
      END $$;
    `);
    await db.execute(sql`
      DO $$
      BEGIN
        IF to_regclass('public.idx_watercover_type') IS NULL THEN
          CREATE INDEX idx_watercover_type ON watercover (type);
        END IF;
      END $$;
    `);
    await db.execute(sql`
      DO $$
      BEGIN
        IF to_regclass('public.idx_watercover_area_m2') IS NULL THEN
          CREATE INDEX idx_watercover_area_m2 ON watercover (area_m2);
        END IF;
      END $$;
    `);
    await db.execute(sql`DELETE FROM watercover WHERE osm_id = ${TEST_WATERCOVER_OSM_ID}`);
    await db.execute(sql`
      INSERT INTO watercover (osm_id, type, area_m2, geometry)
      VALUES (
        ${TEST_WATERCOVER_OSM_ID},
        'test-water',
        1000000,
        ST_Multi(ST_Transform(ST_TileEnvelope(15, 16892, 10898), 4326))
      )
    `);

    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM watercover WHERE osm_id = ${TEST_WATERCOVER_OSM_ID}`);
    await app.close();
  });

  it('GET /tiles/ducks/:z/:x/:y.pbf returns 204 below minzoom', async () => {
    const res = await app.inject({ method: 'GET', url: '/tiles/ducks/10/527/340.pbf' });
    expect(res.statusCode).toBe(204);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('GET /tiles/ducks/:z/:x/:y.pbf returns 204 above maxzoom', async () => {
    const res = await app.inject({ method: 'GET', url: '/tiles/ducks/21/0/0.pbf' });
    expect(res.statusCode).toBe(204);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('GET /tiles/ducks/:z/:x/:y.pbf returns deterministic scattered-ducks MVT at z15', async () => {
    const res1 = await app.inject({ method: 'GET', url: '/tiles/ducks/15/16892/10898.pbf' });
    const res2 = await app.inject({ method: 'GET', url: '/tiles/ducks/15/16892/10898.pbf' });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(res1.headers['content-type']).toBe('application/x-protobuf');
    expect(res1.rawPayload.length).toBeGreaterThan(0);
    expect(Buffer.from(res1.rawPayload)).toEqual(Buffer.from(res2.rawPayload));

    const tile = new VectorTile(new Pbf(res1.rawPayload));
    const layer = tile.layers['scattered-ducks'];
    expect(layer).toBeDefined();
    expect(layer.length).toBeGreaterThan(0);

    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      expect(feature.properties.duck_variant).toBeGreaterThanOrEqual(0);
      expect(feature.properties.duck_variant).toBeLessThan(DUCK_VARIANTS);
    }
  });

  it('style.json includes duck-source and paper-ducks after paper-trees', async () => {
    const res = await app.inject({ method: 'GET', url: '/tiles/style.json' });
    expect(res.statusCode).toBe(200);
    const style = JSON.parse(res.body) as StyleJson;

    expect(style.sources).toHaveProperty('duck-source');
    expect(style.sources['duck-source'].type).toBe('vector');
    expect(style.sources['duck-source'].tiles?.[0]).toContain('/tiles/ducks/{z}/{x}/{y}.pbf');
    expect(style.sources['duck-source'].minzoom).toBe(15);
    expect(style.sources['duck-source'].maxzoom).toBe(20);

    const treeLayerIndex = style.layers.findIndex((layer) => layer.id === 'paper-trees');
    const duckLayerIndex = style.layers.findIndex((layer) => layer.id === 'paper-ducks');
    const duckLayer = style.layers[duckLayerIndex];

    expect(treeLayerIndex).toBeGreaterThanOrEqual(0);
    expect(duckLayerIndex).toBeGreaterThan(treeLayerIndex);
    expect(duckLayer.source).toBe('duck-source');
    expect(duckLayer['source-layer']).toBe('scattered-ducks');
    expect(duckLayer.layout?.['icon-image']).toEqual([
      'concat',
      'duck-',
      ['to-string', ['get', 'duck_variant']],
    ]);
    expect(duckLayer.layout?.['icon-anchor']).toBe('center');
    expect(duckLayer.layout?.['icon-pitch-alignment']).toBe('viewport');
    expect(duckLayer.layout?.['icon-rotation-alignment']).toBe('viewport');
    expect(duckLayer.paint?.['icon-opacity']).toEqual([
      'interpolate',
      ['linear'],
      ['zoom'],
      15,
      0,
      15.5,
      0.9,
      18,
      1,
    ]);
  });

  it('sprite manifest includes all duck variants', async () => {
    const res = await app.inject({ method: 'GET', url: '/sprites/ofm.json' });
    expect(res.statusCode).toBe(200);
    const manifest = JSON.parse(res.body) as Record<string, unknown>;

    for (let i = 0; i < DUCK_VARIANTS; i++) {
      expect(manifest).toHaveProperty(`duck-${i}`);
    }
  });

  it('watercover indexes exist for geometry, type, and area filters', async () => {
    const result = await db.execute<{ indexname: string }>(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'watercover'
      AND indexname IN ('idx_watercover_geometry', 'idx_watercover_type', 'idx_watercover_area_m2')
    `);

    expect(new Set(result.map((row) => row.indexname))).toEqual(
      new Set(['idx_watercover_geometry', 'idx_watercover_type', 'idx_watercover_area_m2'])
    );
  });
});
