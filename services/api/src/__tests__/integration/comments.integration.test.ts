import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users, comments, reactions } from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { createIntegrationProperty } from './helpers/fixtures.js';

/**
 * Integration tests for comment routes.
 *
 * Creates test users via auth, inserts a suite-owned property fixture,
 * then exercises the comments CRUD API.
 */
describe('Comment routes', () => {
  let app: FastifyInstance;
  let userId: string;
  let accessToken: string;
  let likerAccessToken: string;
  let propertyId: string;
  const createdCommentIds: string[] = [];
  const testUserIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    // Create test user via auth
    const uniqueId = `commtest${Date.now()}`;
    const loginResp = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
    });
    const loginBody = JSON.parse(loginResp.body);
    userId = loginBody.session.user.id;
    accessToken = loginBody.session.accessToken;
    testUserIds.push(userId);

    const likerUniqueId = `commtestliker${Date.now()}`;
    const likerResp = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: `mock-google-${likerUniqueId}-gid${likerUniqueId}` },
    });
    const likerBody = JSON.parse(likerResp.body);
    likerAccessToken = likerBody.session.accessToken;
    testUserIds.push(likerBody.session.user.id);

    const property = await createIntegrationProperty({
      street: 'Comments Fixture Street',
      houseNumber: 1,
      city: 'Comments City',
      postalCode: '9030AA',
      lon: 5.4703,
      lat: 51.4403,
    });
    propertyId = property.id;
  });

  afterAll(async () => {
    for (const commentId of createdCommentIds) {
      try {
        await db.delete(reactions).where(eq(reactions.targetId, commentId));
      } catch {
        // Ignore cleanup errors
      }
    }
    // Clean up test comments
    for (const commentId of createdCommentIds) {
      try {
        await db.delete(comments).where(eq(comments.id, commentId));
      } catch {
        // Ignore cleanup errors
      }
    }
    // Clean up test users
    for (const uid of testUserIds) {
      try {
        await db.delete(users).where(eq(users.id, uid));
      } catch {
        // Ignore cleanup errors
      }
    }
    await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
    await app.close();
  });

  describe('POST /properties/:id/comments', () => {
    it('should create a comment with auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/comments`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { content: 'Integration test comment' },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('id');
      expect(body.content).toBe('Integration test comment');
      expect(body.propertyId).toBe(propertyId);
      expect(body.userId).toBe(userId);
      expect(body.parentId).toBeNull();
      expect(body).toHaveProperty('user');
      expect(body.user.id).toBe(userId);
      expect(body.likeCount).toBe(0);
      expect(body.isLiked).toBe(false);
      expect(body.message).toBe('Comment added successfully');

      createdCommentIds.push(body.id);
    });

    it('should return 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/comments`,
        payload: { content: 'No auth comment' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for non-existent property', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${fakeId}/comments`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { content: 'Comment on fake property' },
      });
      expect(response.statusCode).toBe(404);
    });

    it('should create a reply to a top-level comment', async () => {
      // First create a top-level comment
      const topResp = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/comments`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { content: 'Parent comment for reply test' },
      });
      const topBody = JSON.parse(topResp.body);
      createdCommentIds.push(topBody.id);

      // Now reply to it
      const replyResp = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/comments`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          content: 'This is a reply',
          parentId: topBody.id,
        },
      });

      expect(replyResp.statusCode).toBe(201);
      const replyBody = JSON.parse(replyResp.body);
      expect(replyBody.parentId).toBe(topBody.id);
      expect(replyBody.content).toBe('This is a reply');

      createdCommentIds.push(replyBody.id);
    });

    it('should reject a reply to a reply (only 1-level deep allowed)', async () => {
      // Create top-level
      const topResp = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/comments`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { content: 'Top-level for nesting test' },
      });
      const topBody = JSON.parse(topResp.body);
      createdCommentIds.push(topBody.id);

      // Create reply
      const replyResp = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/comments`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { content: 'Reply level 1', parentId: topBody.id },
      });
      const replyBody = JSON.parse(replyResp.body);
      createdCommentIds.push(replyBody.id);

      // Try to reply to the reply
      const nestedResp = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/comments`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { content: 'Nested reply attempt', parentId: replyBody.id },
      });
      expect(nestedResp.statusCode).toBe(400);
      const nestedBody = JSON.parse(nestedResp.body);
      expect(nestedBody.error).toBe('INVALID_PARENT');
    });
  });

  describe('GET /properties/:id/comments', () => {
    it('should return paginated comments with user info', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}/comments`,
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

      if (body.data.length > 0) {
        const comment = body.data[0];
        expect(comment).toHaveProperty('id');
        expect(comment).toHaveProperty('content');
        expect(comment).toHaveProperty('user');
        expect(comment).toHaveProperty('likeCount');
        expect(comment).toHaveProperty('isLiked');
        expect(comment).toHaveProperty('replies');
        expect(Array.isArray(comment.replies)).toBe(true);
        expect(comment.user).toHaveProperty('username');
      }
    });

    it('should support sort=recent', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}/comments?sort=recent`,
      });
      expect(response.statusCode).toBe(200);
    });

    it('should support sort=popular', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}/comments?sort=popular`,
      });
      expect(response.statusCode).toBe(200);
    });

    it('should support pagination params', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}/comments?page=1&limit=2`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.meta.page).toBe(1);
      expect(body.meta.limit).toBe(2);
      expect(body.data.length).toBeLessThanOrEqual(2);
    });

    it('should return 404 for non-existent property', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${fakeId}/comments`,
      });
      expect(response.statusCode).toBe(404);
    });

    it('should include replies nested under parent comments', async () => {
      // Create a new parent comment
      const parentResp = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/comments`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { content: 'Parent for replies test GET' },
      });
      const parentBody = JSON.parse(parentResp.body);
      createdCommentIds.push(parentBody.id);

      // Create a reply
      const replyResp = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/comments`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { content: 'Reply for replies test GET', parentId: parentBody.id },
      });
      const replyBody = JSON.parse(replyResp.body);
      createdCommentIds.push(replyBody.id);

      // Fetch comments
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}/comments?limit=50`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Find our parent comment
      const parent = body.data.find((c: { id: string }) => c.id === parentBody.id);
      expect(parent).toBeDefined();
      expect(parent.replies.length).toBeGreaterThanOrEqual(1);
      const reply = parent.replies.find((r: { id: string }) => r.id === replyBody.id);
      expect(reply).toBeDefined();
      expect(reply.content).toBe('Reply for replies test GET');
    });

    it('should return viewer-aware isLiked state for comments and replies', async () => {
      const parentResp = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/comments`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { content: 'Parent for viewer state test' },
      });
      const parentBody = JSON.parse(parentResp.body);
      createdCommentIds.push(parentBody.id);

      const replyResp = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/comments`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { content: 'Reply for viewer state test', parentId: parentBody.id },
      });
      const replyBody = JSON.parse(replyResp.body);
      createdCommentIds.push(replyBody.id);

      await app.inject({
        method: 'POST',
        url: `/comments/${parentBody.id}/like`,
        headers: { authorization: `Bearer ${likerAccessToken}` },
      });

      await app.inject({
        method: 'POST',
        url: `/comments/${replyBody.id}/like`,
        headers: { authorization: `Bearer ${likerAccessToken}` },
      });

      const anonymousResponse = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}/comments?limit=50`,
      });
      expect(anonymousResponse.statusCode).toBe(200);
      const anonymousBody = JSON.parse(anonymousResponse.body);
      const anonymousParent = anonymousBody.data.find(
        (c: { id: string }) => c.id === parentBody.id
      );
      expect(anonymousParent.isLiked).toBe(false);
      expect(anonymousParent.likeCount).toBe(1);
      const anonymousReply = anonymousParent.replies.find(
        (r: { id: string }) => r.id === replyBody.id
      );
      expect(anonymousReply.isLiked).toBe(false);
      expect(anonymousReply.likeCount).toBe(1);

      const viewerResponse = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}/comments?limit=50`,
        headers: { authorization: `Bearer ${likerAccessToken}` },
      });
      expect(viewerResponse.statusCode).toBe(200);
      const viewerBody = JSON.parse(viewerResponse.body);
      const viewerParent = viewerBody.data.find((c: { id: string }) => c.id === parentBody.id);
      expect(viewerParent.isLiked).toBe(true);
      const viewerReply = viewerParent.replies.find((r: { id: string }) => r.id === replyBody.id);
      expect(viewerReply.isLiked).toBe(true);
    });
  });
});
