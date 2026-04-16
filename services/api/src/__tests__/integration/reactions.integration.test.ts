import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users, comments, reactions } from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { createIntegrationProperty } from './helpers/fixtures.js';

/**
 * Integration tests for comment like routes backed by the reactions table.
 *
 * Creates a test user via auth, seeds a hermetic property, creates a comment,
 * then exercises the comment like/unlike API.
 */
describe('Reaction routes', () => {
  let app: FastifyInstance;
  let userId: string;
  let accessToken: string;
  let commentId: string;
  let propertyId: string;
  const testUserIds: string[] = [];
  const testCommentIds: string[] = [];

  async function createAuthenticatedTestUser(label: string) {
    const uniqueId = `${label}${Date.now()}`;
    const loginResp = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
    });

    expect(loginResp.statusCode).toBe(200);

    const loginBody = JSON.parse(loginResp.body);
    expect(loginBody).toMatchObject({
      session: {
        user: {
          id: expect.any(String),
        },
        accessToken: expect.any(String),
      },
    });

    return {
      userId: loginBody.session.user.id as string,
      accessToken: loginBody.session.accessToken as string,
    };
  }

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    const auth = await createAuthenticatedTestUser('reacttest');
    userId = auth.userId;
    accessToken = auth.accessToken;
    testUserIds.push(userId);

    const property = await createIntegrationProperty({
      street: 'Reactions Fixture Street',
      houseNumber: 1,
      city: 'Reactions City',
      postalCode: '9110AA',
      lon: 5.4711,
      lat: 51.4411,
    });
    propertyId = property.id;

    // Create a comment to like/unlike
    const commentResp = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/comments`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { content: 'Comment for reaction tests' },
    });
    expect(commentResp.statusCode).toBe(201);
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
    await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
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
