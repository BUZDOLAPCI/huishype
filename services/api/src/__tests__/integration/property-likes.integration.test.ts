import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users, reactions } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Integration tests for property like endpoints and enriched GET /properties/:id.
 *
 * Tests POST/DELETE /properties/:id/like and verifies the enriched
 * property detail endpoint returns likeCount, isLiked, isSaved.
 */
describe('Property like routes', () => {
  let app: FastifyInstance;
  let userId: string;
  let propertyId: string;
  const testUserIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    // Create test user
    const uniqueId = `propliketest${Date.now()}`;
    const loginResp = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
    });
    const loginBody = JSON.parse(loginResp.body);
    userId = loginBody.session.user.id;
    testUserIds.push(userId);

    // Get a real property
    const propResp = await app.inject({
      method: 'GET',
      url: '/properties?limit=1',
    });
    const propBody = JSON.parse(propResp.body);
    expect(propBody.data.length).toBeGreaterThan(0);
    propertyId = propBody.data[0].id;
  });

  afterAll(async () => {
    // Clean up reactions for this property by this user
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

  describe('GET /properties/:id (enriched, before liking)', () => {
    it('should return likeCount=0, isLiked=false, isSaved=false without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(propertyId);
      expect(body.likeCount).toBe(0);
      expect(body.isLiked).toBe(false);
      expect(body.isSaved).toBe(false);
    });

    it('should return likeCount=0, isLiked=false, isSaved=false with auth (not yet liked)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}`,
        headers: { 'x-user-id': userId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.likeCount).toBe(0);
      expect(body.isLiked).toBe(false);
      expect(body.isSaved).toBe(false);
    });
  });

  describe('POST /properties/:id/like', () => {
    it('should return 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/like`,
      });
      expect(response.statusCode).toBe(401);
    });

    it('should like a property successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/like`,
        headers: { 'x-user-id': userId },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.liked).toBe(true);
      expect(body.likeCount).toBe(1);
    });

    it('should return 404 for non-existent property', async () => {
      const fakeId = 'a0000000-0000-4000-a000-000000000099';
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${fakeId}/like`,
        headers: { 'x-user-id': userId },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('NOT_FOUND');
    });

    it('should return 409 when liking again (already liked)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/like`,
        headers: { 'x-user-id': userId },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('ALREADY_LIKED');
    });
  });

  describe('GET /properties/:id (enriched, after liking)', () => {
    it('should return isLiked=true and likeCount=1 with auth after liking', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}`,
        headers: { 'x-user-id': userId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.likeCount).toBe(1);
      expect(body.isLiked).toBe(true);
      expect(body.isSaved).toBe(false);
    });

    it('should return isLiked=false without auth (likeCount still 1)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.likeCount).toBe(1);
      expect(body.isLiked).toBe(false);
      expect(body.isSaved).toBe(false);
    });
  });

  describe('DELETE /properties/:id/like', () => {
    it('should return 401 without auth', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/properties/${propertyId}/like`,
      });
      expect(response.statusCode).toBe(401);
    });

    it('should unlike a property successfully', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/properties/${propertyId}/like`,
        headers: { 'x-user-id': userId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.liked).toBe(false);
      expect(body.likeCount).toBe(0);
    });

    it('should return 404 when unliking a property not previously liked', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/properties/${propertyId}/like`,
        headers: { 'x-user-id': userId },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('NOT_FOUND');
    });
  });

  describe('GET /properties/:id (enriched, after unliking)', () => {
    it('should return likeCount=0 and isLiked=false after unliking', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}`,
        headers: { 'x-user-id': userId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.likeCount).toBe(0);
      expect(body.isLiked).toBe(false);
    });
  });
});
