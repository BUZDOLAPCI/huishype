import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';

/**
 * Integration tests for GET /properties/nearby
 *
 * These tests run against the real PostGIS database with seeded Eindhoven data.
 * The database must be running and seeded before running these tests.
 */
describe('GET /properties/nearby', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('route registration', () => {
    it('should register the /properties/nearby route', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416',
      });
      // Should not be 404 (route not found)
      expect(response.statusCode).not.toBe(404);
    });
  });

  describe('parameter validation', () => {
    it('should return 400 when lon is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lat=51.4416',
      });
      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when lat is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697',
      });
      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when lon is out of range', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=200&lat=51.4416',
      });
      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when lat is out of range', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=100',
      });
      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when limit is greater than 20', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&limit=21',
      });
      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when limit is less than 1', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&limit=0',
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('response shape', () => {
    it('should return an array', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=17&limit=5',
      });

      // 200 if database has data, or could be 200 with empty array
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body)).toBe(true);
    });

    it('should return objects with the expected fields', async () => {
      // Use Eindhoven center — seeded data should have properties nearby
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=14&limit=1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body.length > 0) {
        const prop = body[0];
        expect(prop).toHaveProperty('id');
        expect(prop).toHaveProperty('address');
        expect(prop).toHaveProperty('city');
        expect(prop).toHaveProperty('postalCode');
        expect(prop).toHaveProperty('wozValue');
        expect(prop).toHaveProperty('hasListing');
        expect(prop).toHaveProperty('activityScore');
        expect(prop).toHaveProperty('distanceMeters');
        expect(prop).toHaveProperty('geometry');

        // Type checks
        expect(typeof prop.id).toBe('string');
        expect(typeof prop.address).toBe('string');
        expect(typeof prop.city).toBe('string');
        expect(typeof prop.hasListing).toBe('boolean');
        expect(typeof prop.activityScore).toBe('number');
        expect(typeof prop.distanceMeters).toBe('number');
      }
    });

    it('should include geometry as a GeoJSON Point', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=14&limit=1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body.length > 0) {
        const geom = body[0].geometry;
        expect(geom).not.toBeNull();
        expect(geom.type).toBe('Point');
        expect(Array.isArray(geom.coordinates)).toBe(true);
        expect(geom.coordinates).toHaveLength(2);
        expect(typeof geom.coordinates[0]).toBe('number');
        expect(typeof geom.coordinates[1]).toBe('number');
      }
    });
  });

  describe('KNN ordering', () => {
    it('should return results ordered by distance (closest first)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=14&limit=5',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body.length >= 2) {
        for (let i = 1; i < body.length; i++) {
          expect(body[i].distanceMeters).toBeGreaterThanOrEqual(
            body[i - 1].distanceMeters,
          );
        }
      }
    });
  });

  describe('zoom-to-radius filtering', () => {
    it('should return fewer results at high zoom (smaller radius)', async () => {
      // At zoom 19, radius is very small (~3m) — should return few or no results
      const highZoomResp = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=19&limit=20',
      });

      // At zoom 13, radius is much larger — should return more results
      const lowZoomResp = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=13&limit=20',
      });

      expect(highZoomResp.statusCode).toBe(200);
      expect(lowZoomResp.statusCode).toBe(200);

      const highZoomBody = JSON.parse(highZoomResp.body);
      const lowZoomBody = JSON.parse(lowZoomResp.body);

      // Low zoom should generally have at least as many results as high zoom
      expect(lowZoomBody.length).toBeGreaterThanOrEqual(highZoomBody.length);
    });
  });

  describe('limit parameter', () => {
    it('should respect the limit parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=14&limit=2',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.length).toBeLessThanOrEqual(2);
    });

    it('should use default limit of 5 when not specified', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=14',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.length).toBeLessThanOrEqual(5);
    });
  });

  describe('edge cases', () => {
    it('should return empty array for a location in the ocean', async () => {
      // Coordinates in the middle of the North Sea
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=3.0&lat=55.0&zoom=17&limit=5',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual([]);
    });

    it('should use default zoom of 17 when not specified', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body)).toBe(true);
    });
  });

  describe('cluster detection (cluster=true)', () => {
    it('should return a cluster at low zoom in a populated area', async () => {
      // At zoom 10, grid cells are ~0.17 degrees wide (~19km)
      // Eindhoven has many seeded active properties, so they should cluster
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=10&cluster=true',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body !== null) {
        expect(body).toHaveProperty('type');
        if (body.type === 'cluster') {
          expect(body.point_count).toBeGreaterThan(1);
          expect(typeof body.property_ids).toBe('string');
          expect(body.property_ids.split(',').length).toBe(body.point_count);
          expect(Array.isArray(body.coordinate)).toBe(true);
          expect(body.coordinate).toHaveLength(2);
          expect(typeof body.coordinate[0]).toBe('number');
          expect(typeof body.coordinate[1]).toBe('number');
          expect(typeof body.distanceMeters).toBe('number');
        } else {
          expect(body.type).toBe('single');
          expect(body).toHaveProperty('id');
        }
      }
    });

    it('should return a single property at high zoom (above clustering threshold)', async () => {
      // At zoom 18, above GHOST_NODE_THRESHOLD_ZOOM (17) — no clustering
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=18&cluster=true',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body !== null) {
        expect(body.type).toBe('single');
        expect(body).toHaveProperty('id');
        expect(body).toHaveProperty('address');
        expect(body).toHaveProperty('city');
        expect(body).toHaveProperty('distanceMeters');
        expect(body).toHaveProperty('geometry');
        expect(typeof body.distanceMeters).toBe('number');
      }
    });

    it('should return null for a location with no properties', async () => {
      // Coordinates in the middle of the North Sea
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=3.0&lat=55.0&zoom=14&cluster=true',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toBeNull();
    });

    it('should return array when cluster=false (backward compatible)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=14&cluster=false',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body)).toBe(true);
    });

    it('should return array when cluster param is absent (backward compatible)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=14',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body)).toBe(true);
    });

    it('should include valid UUIDs in cluster property_ids', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=10&cluster=true',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body !== null && body.type === 'cluster') {
        const ids = body.property_ids.split(',');
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        for (const id of ids) {
          expect(id).toMatch(uuidRegex);
        }
      }
    });
  });

  describe('OpenAPI documentation', () => {
    it('should include /properties/nearby in swagger', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/documentation/json',
      });

      expect(response.statusCode).toBe(200);
      const swagger = JSON.parse(response.body);
      expect(swagger.paths).toHaveProperty('/properties/nearby');
      expect(swagger.paths['/properties/nearby']).toHaveProperty('get');
    });

    it('should document query parameters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/documentation/json',
      });

      expect(response.statusCode).toBe(200);
      const swagger = JSON.parse(response.body);
      const nearbyPath = swagger.paths['/properties/nearby'];
      const params = nearbyPath.get.parameters;
      const paramNames = params.map((p: { name: string }) => p.name);

      expect(paramNames).toContain('lon');
      expect(paramNames).toContain('lat');
      expect(paramNames).toContain('zoom');
      expect(paramNames).toContain('limit');
      expect(paramNames).toContain('cluster');
    });
  });
});
