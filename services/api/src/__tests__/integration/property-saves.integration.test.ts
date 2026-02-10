import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users, savedProperties } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Integration tests for property save endpoints.
 *
 * Tests POST /properties/:id/save, DELETE /properties/:id/save,
 * GET /saved-properties, and verifies enriched GET /properties/:id isSaved.
 */
describe('Property save routes', () => {
  let app: FastifyInstance;
  let userId: string;
  let propertyId: string;
  let propertyId2: string;
  const testUserIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    // Create test user
    const uniqueId = `propsavetest${Date.now()}`;
    const loginResp = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
    });
    const loginBody = JSON.parse(loginResp.body);
    userId = loginBody.session.user.id;
    testUserIds.push(userId);

    // Get two real properties for testing
    const propResp = await app.inject({
      method: 'GET',
      url: '/properties?limit=2',
    });
    const propBody = JSON.parse(propResp.body);
    expect(propBody.data.length).toBeGreaterThanOrEqual(2);
    propertyId = propBody.data[0].id;
    propertyId2 = propBody.data[1].id;
  });

  afterAll(async () => {
    // Clean up saved_properties and users created by this test
    for (const uid of testUserIds) {
      try {
        await db.delete(savedProperties).where(eq(savedProperties.userId, uid));
        await db.delete(users).where(eq(users.id, uid));
      } catch {
        // Ignore
      }
    }
    await app.close();
  });

  describe('POST /properties/:id/save', () => {
    it('should return 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/save`,
      });
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('UNAUTHORIZED');
    });

    it('should save a property successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/save`,
        headers: { 'x-user-id': userId },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.saved).toBe(true);
    });

    it('should return 404 for non-existent property', async () => {
      const fakeId = 'a0000000-0000-4000-a000-000000000099';
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${fakeId}/save`,
        headers: { 'x-user-id': userId },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('NOT_FOUND');
    });

    it('should return 409 when saving again (already saved)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/save`,
        headers: { 'x-user-id': userId },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('ALREADY_SAVED');
    });
  });

  describe('GET /properties/:id (enriched isSaved after saving)', () => {
    it('should return isSaved=true with auth after saving', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}`,
        headers: { 'x-user-id': userId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(propertyId);
      expect(body.isSaved).toBe(true);
    });

    it('should return isSaved=false without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.isSaved).toBe(false);
    });
  });

  describe('GET /saved-properties', () => {
    it('should return 401 without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/saved-properties',
      });
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('UNAUTHORIZED');
    });

    it('should return saved properties with auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/saved-properties',
        headers: { 'x-user-id': userId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBe(1);
      expect(body.data[0].id).toBe(propertyId);
      // Verify property summary fields are present
      expect(body.data[0]).toHaveProperty('street');
      expect(body.data[0]).toHaveProperty('houseNumber');
      expect(body.data[0]).toHaveProperty('city');
      expect(body.data[0]).toHaveProperty('address');
      expect(body.data[0]).toHaveProperty('savedAt');
      expect(body.data[0]).toHaveProperty('hasListing');
      expect(body.data[0]).toHaveProperty('commentCount');
      expect(body.data[0]).toHaveProperty('guessCount');
    });

    it('should return saved properties ordered by savedAt DESC', async () => {
      // Save a second property
      await app.inject({
        method: 'POST',
        url: `/properties/${propertyId2}/save`,
        headers: { 'x-user-id': userId },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/saved-properties',
        headers: { 'x-user-id': userId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.length).toBe(2);
      // Most recently saved should be first
      expect(body.data[0].id).toBe(propertyId2);
      expect(body.data[1].id).toBe(propertyId);

      // Verify savedAt ordering
      const savedAt0 = new Date(body.data[0].savedAt).getTime();
      const savedAt1 = new Date(body.data[1].savedAt).getTime();
      expect(savedAt0).toBeGreaterThanOrEqual(savedAt1);
    });

    it('should respect pagination (limit and offset)', async () => {
      // Get first page with limit=1
      const page1 = await app.inject({
        method: 'GET',
        url: '/saved-properties?limit=1&offset=0',
        headers: { 'x-user-id': userId },
      });
      const body1 = JSON.parse(page1.body);
      expect(body1.data.length).toBe(1);
      expect(body1.data[0].id).toBe(propertyId2);

      // Get second page with limit=1, offset=1
      const page2 = await app.inject({
        method: 'GET',
        url: '/saved-properties?limit=1&offset=1',
        headers: { 'x-user-id': userId },
      });
      const body2 = JSON.parse(page2.body);
      expect(body2.data.length).toBe(1);
      expect(body2.data[0].id).toBe(propertyId);

      // Get third page (empty)
      const page3 = await app.inject({
        method: 'GET',
        url: '/saved-properties?limit=1&offset=2',
        headers: { 'x-user-id': userId },
      });
      const body3 = JSON.parse(page3.body);
      expect(body3.data.length).toBe(0);
    });
  });

  describe('DELETE /properties/:id/save', () => {
    it('should return 401 without auth', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/properties/${propertyId}/save`,
      });
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('UNAUTHORIZED');
    });

    it('should unsave a property successfully', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/properties/${propertyId}/save`,
        headers: { 'x-user-id': userId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.saved).toBe(false);
    });

    it('should return 404 when unsaving a property not previously saved', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/properties/${propertyId}/save`,
        headers: { 'x-user-id': userId },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('NOT_FOUND');
    });
  });

  describe('GET /properties/:id (enriched isSaved after unsaving)', () => {
    it('should return isSaved=false after unsaving', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}`,
        headers: { 'x-user-id': userId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.isSaved).toBe(false);
    });
  });

  describe('GET /saved-properties (after unsaving one)', () => {
    it('should only return the remaining saved property', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/saved-properties',
        headers: { 'x-user-id': userId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // propertyId was unsaved, only propertyId2 remains
      expect(body.data.length).toBe(1);
      expect(body.data[0].id).toBe(propertyId2);
    });
  });

  describe('GET /saved-properties (empty after unsaving all)', () => {
    it('should return empty array when no properties are saved', async () => {
      // Unsave the second property too
      await app.inject({
        method: 'DELETE',
        url: `/properties/${propertyId2}/save`,
        headers: { 'x-user-id': userId },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/saved-properties',
        headers: { 'x-user-id': userId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toEqual([]);
    });
  });
});
