import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users, comments, reactions } from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { createIntegrationProperty } from './helpers/fixtures.js';

describe('Leaderboard routes', () => {
  let app: FastifyInstance;
  let userId: string;
  let accessToken: string;
  let propertyId: string;
  const testUserIds: string[] = [];
  const createdCommentIds: string[] = [];

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

    const property = await createIntegrationProperty({
      street: 'Leaderboard Fixture Street',
      houseNumber: 1,
      city: 'Leaderboard City',
      postalCode: '9060AA',
      lon: 5.4706,
      lat: 51.4406,
    });
    propertyId = property.id;

    // Seed engagement: add a comment and a like on this property
    const commentResp = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/comments`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { content: 'Leaderboard featured test comment' },
    });
    const commentBody = JSON.parse(commentResp.body);
    createdCommentIds.push(commentBody.id);

    await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/like`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
  });

  afterAll(async () => {
    // Clean up: unlike, delete comments, delete users
    try {
      await app.inject({
        method: 'DELETE',
        url: `/properties/${propertyId}/like`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
    } catch {
      // Ignore
    }
    for (const commentId of createdCommentIds) {
      try {
        await db.delete(comments).where(eq(comments.id, commentId));
      } catch {
        // Ignore
      }
    }
    for (const uid of testUserIds) {
      try {
        await db.delete(reactions).where(eq(reactions.userId, uid));
        await db.delete(users).where(eq(users.id, uid));
      } catch {
        // Ignore
      }
    }
    await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
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

    it('should return featuredProperty with engagement data', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/leaderboard',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // We seeded a comment and a like, so featuredProperty should not be null
      expect(body.featuredProperty).not.toBeNull();
      const fp = body.featuredProperty;
      expect(fp).toHaveProperty('id');
      expect(fp).toHaveProperty('address');
      expect(fp).toHaveProperty('city');
      expect(fp).toHaveProperty('postalCode');
      expect(fp).toHaveProperty('countryCode');
      expect(fp).toHaveProperty('geometry');
      expect(fp).toHaveProperty('imageryGeometry');
      expect(fp).toHaveProperty('thumbnailUrl');
      expect(fp).toHaveProperty('commentCount');
      expect(fp).toHaveProperty('likeCount');
      expect(fp).toHaveProperty('engagementScore');
      expect(fp.engagementScore).toBeGreaterThan(0);
      expect(typeof fp.commentCount).toBe('number');
      expect(typeof fp.likeCount).toBe('number');
      expect(fp.geometry).toMatchObject({ type: 'Point' });
      expect(fp.imageryGeometry).toMatchObject({ type: 'Point' });
    });

    it('should return featuredProperty respecting period filter', async () => {
      // The seeded engagement is recent (just created), so week should find it
      const response = await app.inject({
        method: 'GET',
        url: '/leaderboard?period=week',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.featuredProperty).not.toBeNull();
      expect(body.featuredProperty.engagementScore).toBeGreaterThan(0);
    });
  });
});
