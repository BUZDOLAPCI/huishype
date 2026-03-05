import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

describe('Tree tiles endpoint', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /tiles/trees/:z/:x/:y.pbf returns 204 below minzoom', async () => {
    const res = await app.inject({ method: 'GET', url: '/tiles/trees/10/527/340.pbf' });
    expect(res.statusCode).toBe(204);
  });

  it('GET /tiles/trees/:z/:x/:y.pbf returns 204 above maxzoom', async () => {
    const res = await app.inject({ method: 'GET', url: '/tiles/trees/21/0/0.pbf' });
    expect(res.statusCode).toBe(204);
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

  it('tree tiles are deterministic', async () => {
    const res1 = await app.inject({ method: 'GET', url: '/tiles/trees/15/16892/10898.pbf' });
    const res2 = await app.inject({ method: 'GET', url: '/tiles/trees/15/16892/10898.pbf' });
    expect(res1.statusCode).toBe(res2.statusCode);
    if (res1.statusCode === 200) {
      expect(res1.rawPayload).toEqual(res2.rawPayload);
    }
  });

  it('tree tiles have cache headers when 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/tiles/trees/15/16892/10898.pbf' });
    if (res.statusCode === 200) {
      expect(res.headers['cache-control']).toContain('max-age');
    }
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
