import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users, userAchievements, reactions } from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { createIntegrationProperty } from './helpers/fixtures.js';

describe('Achievement routes', () => {
  let app: FastifyInstance;
  let userId: string;
  let accessToken: string;
  let propertyId: string;
  const testUserIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    // Create test user
    const uniqueId = `achtest${Date.now()}`;
    const loginResp = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
    });
    const loginBody = JSON.parse(loginResp.body);
    userId = loginBody.session.user.id;
    accessToken = loginBody.session.accessToken;
    testUserIds.push(userId);

    const property = await createIntegrationProperty({
      street: 'Achievement Fixture Street',
      houseNumber: 1,
      city: 'Achievement City',
      postalCode: '9010AA',
      lon: 5.4701,
      lat: 51.4401,
    });
    propertyId = property.id;
  });

  afterAll(async () => {
    for (const uid of testUserIds) {
      try {
        await db.delete(userAchievements).where(eq(userAchievements.userId, uid));
        await db.delete(reactions).where(eq(reactions.userId, uid));
        await db.delete(users).where(eq(users.id, uid));
      } catch {
        // Ignore
      }
    }
    await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
    await app.close();
  });

  describe('GET /achievements/registry', () => {
    it('should return all achievement definitions (public)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/achievements/registry',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body.achievements)).toBe(true);
      expect(body.achievements.length).toBeGreaterThan(0);

      const first = body.achievements[0];
      expect(first).toHaveProperty('key');
      expect(first).toHaveProperty('name');
      expect(first).toHaveProperty('description');
      expect(first).toHaveProperty('icon');
      expect(first).toHaveProperty('category');
    });
  });

  describe('GET /achievements', () => {
    it('should return 401 without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/achievements',
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return achievements with unlock state', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/achievements',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body.earned)).toBe(true);
      expect(Array.isArray(body.available)).toBe(true);
      expect(body.totalAvailable).toBeGreaterThan(0);
      // New user — should have few or no earned achievements
      expect(body.available.length).toBeGreaterThan(0);
    });

    it('should award first_like_given after liking a property', async () => {
      if (!propertyId) return;

      // Like a property
      await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/like`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      // Fetch achievements — should now include first_like_given
      const response = await app.inject({
        method: 'GET',
        url: '/achievements',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const earnedKeys = body.earned.map((a: { key: string }) => a.key);
      expect(earnedKeys).toContain('first_like_given');

      // Earned achievements should have awardedAt
      const firstLike = body.earned.find((a: { key: string }) => a.key === 'first_like_given');
      expect(firstLike).toBeDefined();
      expect(firstLike.awardedAt).toBeTruthy();

      // Clean up the like
      await app.inject({
        method: 'DELETE',
        url: `/properties/${propertyId}/like`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
    });

    it('should not duplicate achievements on re-evaluation', async () => {
      // Call achievements twice
      await app.inject({
        method: 'GET',
        url: '/achievements',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/achievements',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // Check for unique keys
      const earnedKeys = body.earned.map((a: { key: string }) => a.key);
      const uniqueKeys = [...new Set(earnedKeys)];
      expect(earnedKeys.length).toBe(uniqueKeys.length);
    });
  });
});
