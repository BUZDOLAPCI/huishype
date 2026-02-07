import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';

/**
 * Integration tests for property routes.
 *
 * Tests against the real PostGIS database seeded with Eindhoven data.
 */
describe('Property routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /properties', () => {
    it('should return paginated data', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('meta');
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.meta).toHaveProperty('page');
      expect(body.meta).toHaveProperty('limit');
      expect(body.meta).toHaveProperty('total');
      expect(body.meta).toHaveProperty('totalPages');
      expect(body.meta.page).toBe(1);
      expect(body.meta.total).toBeGreaterThan(0);
    });

    it('should return properties with expected fields', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties?limit=1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.length).toBeGreaterThan(0);

      const prop = body.data[0];
      expect(prop).toHaveProperty('id');
      expect(prop).toHaveProperty('address');
      expect(prop).toHaveProperty('city');
      expect(prop).toHaveProperty('status');
      expect(prop).toHaveProperty('createdAt');
      expect(prop).toHaveProperty('updatedAt');

      expect(typeof prop.id).toBe('string');
      expect(typeof prop.address).toBe('string');
      expect(typeof prop.city).toBe('string');
    });

    it('should filter by city=Eindhoven', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties?city=Eindhoven&limit=5',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.length).toBeGreaterThan(0);

      for (const prop of body.data) {
        expect(prop.city).toBe('Eindhoven');
      }
    });

    it('should respect limit parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties?limit=5',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.length).toBeLessThanOrEqual(5);
      expect(body.meta.limit).toBe(5);
    });

    it('should support pagination (page 2 returns 200)', async () => {
      const page1Resp = await app.inject({
        method: 'GET',
        url: '/properties?page=1&limit=5',
      });
      const page2Resp = await app.inject({
        method: 'GET',
        url: '/properties?page=2&limit=5',
      });

      expect(page1Resp.statusCode).toBe(200);
      expect(page2Resp.statusCode).toBe(200);

      const page1 = JSON.parse(page1Resp.body);
      const page2 = JSON.parse(page2Resp.body);

      expect(page1.meta.page).toBe(1);
      expect(page2.meta.page).toBe(2);

      // Both pages should have data (DB has thousands of properties)
      expect(page1.data.length).toBeGreaterThan(0);
      expect(page2.data.length).toBeGreaterThan(0);
    });

    it('should filter by bounding box (Eindhoven area)', async () => {
      // Eindhoven bounding box (approx)
      const bbox = '5.43,51.40,5.52,51.47';
      const response = await app.inject({
        method: 'GET',
        url: `/properties?bbox=${bbox}&limit=5`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.length).toBeGreaterThan(0);
    });

    it('should return 400 for limit > 100', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties?limit=500',
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /properties/:id', () => {
    it('should return a single property by ID', async () => {
      // First get any property ID
      const listResp = await app.inject({
        method: 'GET',
        url: '/properties?limit=1',
      });
      const listBody = JSON.parse(listResp.body);
      const propertyId = listBody.data[0].id;

      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(propertyId);
      expect(body).toHaveProperty('address');
      expect(body).toHaveProperty('city');
    });

    it('should return 404 for non-existent property', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${fakeId}`,
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /properties/nearby', () => {
    it('should return nearby properties for Eindhoven center', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=14&limit=5',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);

      const prop = body[0];
      expect(prop).toHaveProperty('id');
      expect(prop).toHaveProperty('address');
      expect(prop).toHaveProperty('distanceMeters');
      expect(prop).toHaveProperty('hasListing');
      expect(prop).toHaveProperty('activityScore');
    });
  });
});
