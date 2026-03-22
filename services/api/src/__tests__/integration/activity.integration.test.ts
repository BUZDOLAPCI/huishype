import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users, reactions } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

describe('Activity routes', () => {
  let app: FastifyInstance;
  let userId: string;
  let accessToken: string;
  let propertyId: string;
  const testUserIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    // Create test user
    const uniqueId = `acttest${Date.now()}`;
    const loginResp = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
    });
    const loginBody = JSON.parse(loginResp.body);
    userId = loginBody.session.user.id;
    accessToken = loginBody.session.accessToken;
    testUserIds.push(userId);

    // Get a real property
    const propResp = await app.inject({
      method: 'GET',
      url: '/properties?limit=1',
    });
    const propBody = JSON.parse(propResp.body);
    if (propBody.data.length > 0) {
      propertyId = propBody.data[0].id;

      // Like it to create some activity
      await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/like`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
    }
  });

  afterAll(async () => {
    for (const uid of testUserIds) {
      try {
        await db.delete(reactions).where(eq(reactions.userId, uid));
        await db.delete(users).where(eq(users.id, uid));
      } catch {
        // Ignore
      }
    }
    await app.close();
  });

  describe('GET /activity (public)', () => {
    it('should return activity items', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/activity',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body.items)).toBe(true);
      expect(body).toHaveProperty('pagination');
      expect(body.pagination).toHaveProperty('limit');
      expect(body.pagination).toHaveProperty('offset');
      expect(body.pagination).toHaveProperty('hasMore');
    });

    it('should not include save events in public activity', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/activity?limit=50',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const saveEvents = body.items.filter((i: { eventType: string }) => i.eventType === 'save');
      expect(saveEvents.length).toBe(0);
    });

    it('should respect limit parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/activity?limit=2',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBeLessThanOrEqual(2);
    });

    it('should have proper item structure', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/activity?limit=1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      if (body.items.length > 0) {
        const item = body.items[0];
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('eventType');
        expect(item).toHaveProperty('actor');
        expect(item.actor).toHaveProperty('id');
        expect(item.actor).toHaveProperty('displayName');
        expect(item.actor).toHaveProperty('handle');
        expect(item).toHaveProperty('property');
        expect(item.property).toHaveProperty('id');
        expect(item.property).toHaveProperty('address');
        expect(item).toHaveProperty('createdAt');
      }
    });
  });

  describe('GET /users/me/activity (personal)', () => {
    it('should return 401 without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/users/me/activity',
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return personal activity', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/users/me/activity',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body.items)).toBe(true);
      // Should include the like we made
      if (propertyId) {
        const likeEvents = body.items.filter(
          (i: { eventType: string }) => i.eventType === 'property_like'
        );
        expect(likeEvents.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('should include save events in personal activity', async () => {
      // Save a property first
      if (propertyId) {
        await app.inject({
          method: 'POST',
          url: `/properties/${propertyId}/save`,
          headers: { authorization: `Bearer ${accessToken}` },
        });

        const response = await app.inject({
          method: 'GET',
          url: '/users/me/activity',
          headers: { authorization: `Bearer ${accessToken}` },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        const saveEvents = body.items.filter(
          (i: { eventType: string }) => i.eventType === 'save'
        );
        expect(saveEvents.length).toBeGreaterThanOrEqual(1);

        // Clean up save
        await app.inject({
          method: 'DELETE',
          url: `/properties/${propertyId}/save`,
          headers: { authorization: `Bearer ${accessToken}` },
        });
      }
    });
  });
});
