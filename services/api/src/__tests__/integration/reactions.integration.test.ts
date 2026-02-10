import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users, comments, reactions } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Integration tests for reaction (like) routes.
 *
 * Creates a test user via auth, fetches a real property,
 * creates a comment, then exercises the like/unlike API.
 */
describe('Reaction routes', () => {
  let app: FastifyInstance;
  let userId: string;
  let accessToken: string;
  let commentId: string;
  let propertyId: string;
  const testUserIds: string[] = [];
  const testCommentIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    // Create test user
    const uniqueId = `reacttest${Date.now()}`;
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
    expect(propBody.data.length).toBeGreaterThan(0);
    propertyId = propBody.data[0].id;

    // Create a comment to like/unlike
    const commentResp = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/comments`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { content: 'Comment for reaction tests' },
    });
    const commentBody = JSON.parse(commentResp.body);
    commentId = commentBody.id;
    testCommentIds.push(commentId);
  });

  afterAll(async () => {
    // Clean up reactions (cascade from comment delete should handle this,
    // but clean explicitly just in case)
    for (const cId of testCommentIds) {
      try {
        await db.delete(reactions).where(eq(reactions.targetId, cId));
        await db.delete(comments).where(eq(comments.id, cId));
      } catch {
        // Ignore
      }
    }
    for (const uid of testUserIds) {
      try {
        await db.delete(users).where(eq(users.id, uid));
      } catch {
        // Ignore
      }
    }
    await app.close();
  });

  describe('GET /comments/:id/like (before liking)', () => {
    it('should return liked=false and likeCount=0 when not liked', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/comments/${commentId}/like`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.liked).toBe(false);
      expect(body.likeCount).toBe(0);
    });

    it('should return liked=false without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/comments/${commentId}/like`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.liked).toBe(false);
    });
  });

  describe('POST /comments/:id/like', () => {
    it('should return 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/comments/${commentId}/like`,
      });
      expect(response.statusCode).toBe(401);
    });

    it('should like a comment successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/comments/${commentId}/like`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.liked).toBe(true);
      expect(body.likeCount).toBe(1);
      expect(body.message).toContain('liked');
    });

    it('should return liked=true after liking', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/comments/${commentId}/like`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.liked).toBe(true);
      expect(body.likeCount).toBe(1);
    });

    it('should return 409 when liking again (already liked)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/comments/${commentId}/like`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('ALREADY_LIKED');
    });
  });

  describe('DELETE /comments/:id/like', () => {
    it('should return 401 without auth', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/comments/${commentId}/like`,
      });
      expect(response.statusCode).toBe(401);
    });

    it('should unlike a comment successfully', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/comments/${commentId}/like`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.liked).toBe(false);
      expect(body.likeCount).toBe(0);
    });

    it('should return liked=false after unliking', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/comments/${commentId}/like`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.liked).toBe(false);
      expect(body.likeCount).toBe(0);
    });

    it('should return 404 when unliking a comment not previously liked', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/comments/${commentId}/like`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('NOT_FOUND');
    });
  });
});
