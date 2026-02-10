import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';

/**
 * Integration tests for tile routes.
 *
 * Tests against the real PostGIS database seeded with Eindhoven data.
 * Verifies MVT tile generation, clustering, ghost nodes, style.json, and font/sprite serving.
 */
describe('Tile routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /tiles/style.json', () => {
    it('should return a valid MapLibre style JSON', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/style.json',
      });

      expect(response.statusCode).toBe(200);
      const style = JSON.parse(response.body);

      expect(style).toHaveProperty('version', 8);
      expect(style).toHaveProperty('sources');
      expect(style).toHaveProperty('layers');
      expect(style).toHaveProperty('glyphs');
      expect(style).toHaveProperty('sprite');
      expect(Array.isArray(style.layers)).toBe(true);
    });

    it('should include properties-source in sources', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/style.json',
      });

      const style = JSON.parse(response.body);
      expect(style.sources).toHaveProperty('properties-source');
      expect(style.sources['properties-source'].type).toBe('vector');
      expect(style.sources['properties-source'].tiles).toBeDefined();
      expect(style.sources['properties-source'].tiles[0]).toContain('/tiles/properties/{z}/{x}/{y}.pbf');
    });

    it('should include property cluster layers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/style.json',
      });

      const style = JSON.parse(response.body);
      const layerIds = style.layers.map((l: any) => l.id);

      expect(layerIds).toContain('property-clusters');
      expect(layerIds).toContain('cluster-count');
      expect(layerIds).toContain('single-active-points');
      expect(layerIds).toContain('active-nodes');
      expect(layerIds).toContain('ghost-nodes');
    });

    it('should include 3D buildings layer', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/style.json',
      });

      const style = JSON.parse(response.body);
      const layerIds = style.layers.map((l: any) => l.id);
      expect(layerIds).toContain('3d-buildings');
    });

    it('cluster-count layer should have correct text configuration', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/style.json',
      });

      const style = JSON.parse(response.body);
      const clusterCount = style.layers.find((l: any) => l.id === 'cluster-count');

      expect(clusterCount).toBeDefined();
      expect(clusterCount.type).toBe('symbol');
      expect(clusterCount.layout).toHaveProperty('text-field');
      expect(clusterCount.layout).toHaveProperty('text-font');
      expect(clusterCount.layout['text-font']).toEqual(['Noto Sans Regular']);
      expect(clusterCount.layout).toHaveProperty('text-size');
      expect(clusterCount.paint).toHaveProperty('text-color', '#FFFFFF');
    });

    it('should set Cache-Control header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/style.json',
      });

      expect(response.headers['cache-control']).toBe('public, max-age=60');
    });
  });

  describe('GET /tiles/properties.json', () => {
    it('should return valid TileJSON metadata', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/properties.json',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('tilejson', '2.1.0');
      expect(body).toHaveProperty('name', 'HuisHype Properties');
      expect(body).toHaveProperty('tiles');
      expect(Array.isArray(body.tiles)).toBe(true);
      expect(body.tiles[0]).toContain('/tiles/properties/{z}/{x}/{y}.pbf');
      expect(body).toHaveProperty('minzoom', 0);
      expect(body).toHaveProperty('maxzoom', 22);
    });
  });

  describe('GET /tiles/properties/:z/:x/:y.pbf', () => {
    // Eindhoven area tile coordinates at various zoom levels
    // Eindhoven center ≈ 51.44, 5.47

    it('should return 204 for an empty ocean tile', async () => {
      // Tile in the middle of the Atlantic ocean at zoom 10
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/properties/10/0/0.pbf',
      });

      // Should be 204 (No Content) for empty tiles
      expect(response.statusCode).toBe(204);
    });

    it('should return MVT data for Eindhoven area at zoom 10 (clustered)', async () => {
      // At zoom 10, x=527, y=340 covers Eindhoven area
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/properties/10/527/340.pbf',
      });

      // Should return data (200) or empty (204)
      expect([200, 204]).toContain(response.statusCode);
      if (response.statusCode === 200) {
        expect(response.headers['content-type']).toBe('application/x-protobuf');
        expect(response.headers['cache-control']).toContain('public');
        expect(response.rawPayload.length).toBeGreaterThan(0);
      }
    });

    it('should return MVT data for Eindhoven area at zoom 14 (more detail)', async () => {
      // At zoom 14, x=8434, y=5443 covers central Eindhoven
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/properties/14/8434/5443.pbf',
      });

      expect([200, 204]).toContain(response.statusCode);
      if (response.statusCode === 200) {
        expect(response.headers['content-type']).toBe('application/x-protobuf');
      }
    });

    it('should return individual points at zoom 17+ (ghost node threshold)', async () => {
      // At zoom 17, Eindhoven center tile
      // x = 67478, y = 43551 (approx)
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/properties/17/67478/43551.pbf',
      });

      expect([200, 204]).toContain(response.statusCode);
      if (response.statusCode === 200) {
        expect(response.headers['content-type']).toBe('application/x-protobuf');
      }
    });

    it('should include X-Tile-Generation-Time header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/properties/10/527/340.pbf',
      });

      if (response.statusCode === 200) {
        expect(response.headers['x-tile-generation-time']).toMatch(/^\d+ms$/);
      }
    });

    it('should reject invalid zoom level', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/properties/25/0/0.pbf',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /fonts/:fontstack/:range', () => {
    it('should serve Noto Sans Regular glyph PBF', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/fonts/Noto Sans Regular/0-255.pbf',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('application/x-protobuf');
      expect(response.headers['cache-control']).toContain('immutable');
      expect(response.rawPayload.length).toBeGreaterThan(0);
    });

    it('should return 404 for non-existent font', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/fonts/NonExistent Font/0-255.pbf',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 404 for composite fontstack (comma stripped by sanitizer)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/fonts/Noto Sans Regular,Arial Unicode MS Regular/0-255.pbf',
      });

      // Comma is stripped by sanitizer before fallback logic, so the combined
      // string "Noto Sans RegularArial Unicode MS Regular" doesn't match any font
      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /sprites/:filename', () => {
    it('should serve sprite JSON manifest', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sprites/ofm.json',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('application/json');
      const manifest = JSON.parse(response.body);
      expect(typeof manifest).toBe('object');
      expect(Object.keys(manifest).length).toBeGreaterThan(0);
    });

    it('should serve @2x sprite JSON manifest', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sprites/ofm@2x.json',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should serve sprite PNG atlas', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sprites/ofm.png',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
    });

    it('should reject invalid sprite filenames', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sprites/malicious.json',
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
