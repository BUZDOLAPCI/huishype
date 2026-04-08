import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { PROPERTY_GHOST_REVEAL_ZOOM } from '@huishype/shared';
import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { jest } from '@jest/globals';

/**
 * Integration tests for tile routes.
 *
 * Tests against the real PostGIS database seeded with Eindhoven data.
 * Verifies MVT tile generation, clustering, ghost nodes, style.json, and font/sprite serving.
 */
describe('Tile routes', () => {
  jest.setTimeout(30000);
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
      expect(layerIds).toContain('active-nodes');
      expect(layerIds).toContain('ghost-clusters');
      expect(layerIds).toContain('ghost-cluster-count');
      expect(layerIds).toContain('ghost-nodes');
    });

    it('should include 3D buildings layer with OSM source', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/style.json',
      });

      const style = JSON.parse(response.body);
      const buildings3D = style.layers.find((l: any) => l.id === '3d-buildings');
      expect(buildings3D).toBeDefined();
      expect(buildings3D.source).toBe('buildings-source');
      expect(buildings3D['source-layer']).toBe('buildings');
      expect(buildings3D.type).toBe('fill-extrusion');
    });

    it('should include buildings-source in sources', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/style.json',
      });

      const style = JSON.parse(response.body);
      expect(style.sources['buildings-source']).toBeDefined();
      expect(style.sources['buildings-source'].type).toBe('vector');
      expect(style.sources['buildings-source'].tiles[0]).toContain('/tiles/buildings/');
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

    it('should style ghost clusters and labels with subtler emphasis than active clusters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/style.json',
      });

      const style = JSON.parse(response.body);
      const activeClusters = style.layers.find((layer: any) => layer.id === 'property-clusters');
      const activeClusterCount = style.layers.find((layer: any) => layer.id === 'cluster-count');
      const ghostClusters = style.layers.find((layer: any) => layer.id === 'ghost-clusters');
      const ghostClusterCount = style.layers.find((layer: any) => layer.id === 'ghost-cluster-count');

      expect(ghostClusters).toBeDefined();
      expect(ghostClusterCount).toBeDefined();
      expect(ghostClusters.minzoom).toBe(PROPERTY_GHOST_REVEAL_ZOOM);
      expect(ghostClusterCount.minzoom).toBe(PROPERTY_GHOST_REVEAL_ZOOM);
      expect(ghostClusters.paint['circle-opacity']).toBeLessThan(
        activeClusters.paint['circle-opacity'],
      );
      expect(ghostClusters.paint['circle-stroke-width']).toBeLessThan(
        activeClusters.paint['circle-stroke-width'][2],
      );
      expect(ghostClusters.paint['circle-radius'][2]).toBeLessThan(
        activeClusters.paint['circle-radius'][2],
      );
      expect(ghostClusterCount.layout['text-size']).toBeLessThan(
        activeClusterCount.layout['text-size'][2],
      );
      expect(ghostClusterCount.paint['text-color']).toBe('#475569');
      expect(ghostClusterCount.paint['text-halo-color']).toBe('rgba(255, 255, 255, 0.85)');
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

    it('should return density-aware grouped features at zoom 17+ (ghost node threshold)', async () => {
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

    it('should serve repeated property tile requests from the server cache', async () => {
      const tileUrl = '/tiles/properties/13/4208/2686.pbf';

      const firstResponse = await app.inject({
        method: 'GET',
        url: tileUrl,
      });
      const secondResponse = await app.inject({
        method: 'GET',
        url: tileUrl,
      });

      expect([200, 204]).toContain(firstResponse.statusCode);
      expect(secondResponse.statusCode).toBe(firstResponse.statusCode);
      expect(secondResponse.headers['x-tile-cache']).toBe('hit');
      expect(secondResponse.headers['x-tile-generation-time']).toBe('0ms');
    });

    it('should reject invalid zoom level', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/properties/25/0/0.pbf',
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return non-empty clustered tiles with bbox properties at z13 for Eindhoven', async () => {
      // Eindhoven center ≈ 51.4416, 5.4697 — compute z13 tile coordinates
      const lon = 5.4697;
      const lat = 51.4416;
      const z = 13;
      const x = Math.floor(((lon + 180) / 360) * Math.pow(2, z));
      const latRad = (lat * Math.PI) / 180;
      const y = Math.floor(
        ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
          Math.pow(2, z)
      );

      // Try the computed tile and neighbors to find one with data
      const tilesToTry = [
        [z, x, y],
        [z, x + 1, y],
        [z, x, y + 1],
        [z, x - 1, y],
      ];

      let foundCluster = false;
      for (const [tz, tx, ty] of tilesToTry) {
        const response = await app.inject({
          method: 'GET',
          url: `/tiles/properties/${tz}/${tx}/${ty}.pbf`,
        });

        if (response.statusCode === 200 && response.rawPayload.length > 0) {
          // At z13 with clustering enabled, the tile should encode correctly
          // (bbox_west/south/east/north are added as MVT feature properties).
          // Full MVT property verification requires a protobuf decoder;
          // here we confirm the tile encodes without error and is non-empty.
          expect(response.headers['content-type']).toBe('application/x-protobuf');
          expect(response.rawPayload.length).toBeGreaterThan(0);
          foundCluster = true;
          break;
        }
      }

      expect(foundCluster).toBe(true);
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

  describe('GET /tiles/buildings/:z/:x/:y.pbf', () => {
    // Eindhoven center tile at z15
    const EINDHOVEN_Z15 = { z: 15, x: 16828, y: 10898 };
    // Ocean tile (no buildings)
    const OCEAN_TILE = { z: 15, x: 0, y: 0 };

    it('returns 204 below minzoom', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/tiles/buildings/14/${EINDHOVEN_Z15.x}/${EINDHOVEN_Z15.y}.pbf`,
      });
      expect(res.statusCode).toBe(204);
    });

    it('returns 204 above maxzoom', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/tiles/buildings/20/${EINDHOVEN_Z15.x}/${EINDHOVEN_Z15.y}.pbf`,
      });
      expect(res.statusCode).toBe(204);
    });

    it('returns 204 for empty ocean tile', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/tiles/buildings/${OCEAN_TILE.z}/${OCEAN_TILE.x}/${OCEAN_TILE.y}.pbf`,
      });
      expect(res.statusCode).toBe(204);
    });

    it('returns MVT for Eindhoven at z15', async () => {
      const { z, x, y } = EINDHOVEN_Z15;
      const res = await app.inject({
        method: 'GET',
        url: `/tiles/buildings/${z}/${x}/${y}.pbf`,
      });
      // May be 200 or 204 depending on whether osm_buildings is populated
      if (res.statusCode === 200) {
        expect(res.headers['content-type']).toBe('application/x-protobuf');
        expect(res.headers['cache-control']).toContain('public');
        expect(res.headers['x-tile-generation-time']).toBeDefined();
      } else {
        expect(res.statusCode).toBe(204);
      }
    });

    it('is deterministic (same tile = same bytes)', async () => {
      const { z, x, y } = EINDHOVEN_Z15;
      const url = `/tiles/buildings/${z}/${x}/${y}.pbf`;
      const res1 = await app.inject({ method: 'GET', url });
      const res2 = await app.inject({ method: 'GET', url });
      expect(res1.statusCode).toBe(res2.statusCode);
      if (res1.statusCode === 200) {
        expect(Buffer.from(res1.rawPayload)).toEqual(Buffer.from(res2.rawPayload));
      }
    });
  });

  describe('osm_buildings table', () => {
    it('exists with expected columns', async () => {
      const result = await db.execute<{ column_name: string }>(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'osm_buildings'
        ORDER BY ordinal_position
      `);
      const columns = Array.from(result).map((r) => r.column_name);
      expect(columns).toContain('geometry');
      expect(columns).toContain('render_height');
      expect(columns).toContain('render_min_height');
      expect(columns).toContain('osm_id');
    });

    it('has GIST index on geometry', async () => {
      const result = await db.execute<{ indexname: string }>(sql`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'osm_buildings' AND indexdef LIKE '%gist%'
      `);
      expect(Array.from(result).length).toBeGreaterThan(0);
    });
  });
});
