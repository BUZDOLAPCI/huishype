import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

describe('Leaderboard routes', () => {
  let app: FastifyInstance;
  let userId: string;
  let accessToken: string;
  const testUserIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    // Create test user
    const uniqueId = `lbtest${Date.now()}`;
    const loginResp = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
    });
    const loginBody = JSON.parse(loginResp.body);
    userId = loginBody.session.user.id;
    accessToken = loginBody.session.accessToken;
    testUserIds.push(userId);
  });

  afterAll(async () => {
    for (const uid of testUserIds) {
      try {
        await db.delete(users).where(eq(users.id, uid));
      } catch {
        // Ignore
      }
    }
    await app.close();
  });

  describe('GET /leaderboard', () => {
    it('should return rankings with default period (all)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/leaderboard',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.period).toBe('all');
      expect(Array.isArray(body.rankings)).toBe(true);
      expect(body.currentUserRank).toBeNull(); // Not authenticated
      expect(body.featuredProperty).toBeNull();
    });

    it('should include currentUserRank when authenticated', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/leaderboard',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // User may or may not be in top 50, but the field should be present
      expect(body).toHaveProperty('currentUserRank');
    });

    it('should accept period=week', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/leaderboard?period=week',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.period).toBe('week');
      expect(Array.isArray(body.rankings)).toBe(true);
    });

    it('should accept period=month', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/leaderboard?period=month',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.period).toBe('month');
      expect(Array.isArray(body.rankings)).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/leaderboard?limit=5',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.rankings.length).toBeLessThanOrEqual(5);
    });

    it('should include karmaRank in each ranking entry', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/leaderboard?limit=1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      if (body.rankings.length > 0) {
        const entry = body.rankings[0];
        expect(entry).toHaveProperty('rank');
        expect(entry).toHaveProperty('userId');
        expect(entry).toHaveProperty('displayName');
        expect(entry).toHaveProperty('handle');
        expect(entry).toHaveProperty('karma');
        expect(entry).toHaveProperty('karmaRank');
        expect(entry.karmaRank).toHaveProperty('title');
        expect(entry.karmaRank).toHaveProperty('level');
      }
    });
  });
});
