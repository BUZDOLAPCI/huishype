import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Integration tests for auth routes.
 *
 * Uses dev-mode mock tokens (format: mock-google-{email}-{googleId}).
 * The auth route validates these in dev mode and creates real users in the DB.
 */
describe('Auth routes', () => {
  let app: FastifyInstance;
  const testUserIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    // Clean up test users
    for (const userId of testUserIds) {
      try {
        await db.delete(users).where(eq(users.id, userId));
      } catch {
        // Ignore cleanup errors
      }
    }
    await app.close();
  });

  describe('POST /auth/google', () => {
    it('should create a new user with mock token and return session', async () => {
      const uniqueId = `authtest${Date.now()}`;
      const response = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: {
          idToken: `mock-google-${uniqueId}-gid${uniqueId}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('session');
      expect(body).toHaveProperty('isNewUser');
      expect(body.isNewUser).toBe(true);

      const { session } = body;
      expect(session).toHaveProperty('accessToken');
      expect(session).toHaveProperty('refreshToken');
      expect(session).toHaveProperty('expiresAt');
      expect(session).toHaveProperty('user');

      expect(typeof session.accessToken).toBe('string');
      expect(typeof session.refreshToken).toBe('string');
      expect(typeof session.expiresAt).toBe('string');

      const { user } = session;
      expect(user).toHaveProperty('id');
      expect(user).toHaveProperty('username');
      expect(user).toHaveProperty('displayName');
      expect(user).toHaveProperty('karma');
      expect(user).toHaveProperty('karmaRank');
      expect(user).toHaveProperty('isPlus');
      expect(user).toHaveProperty('createdAt');

      testUserIds.push(user.id);
    });

    it('should return isNewUser=false for existing user', async () => {
      const uniqueId = `existing${Date.now()}`;
      const token = `mock-google-${uniqueId}-gid${uniqueId}`;

      // First login - creates user
      const first = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: { idToken: token },
      });
      expect(first.statusCode).toBe(200);
      const firstBody = JSON.parse(first.body);
      expect(firstBody.isNewUser).toBe(true);
      testUserIds.push(firstBody.session.user.id);

      // Second login - same user
      const second = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: { idToken: token },
      });
      expect(second.statusCode).toBe(200);
      const secondBody = JSON.parse(second.body);
      expect(secondBody.isNewUser).toBe(false);
      expect(secondBody.session.user.id).toBe(firstBody.session.user.id);
    });

    it('should return 400 when idToken is empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: { idToken: '' },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /auth/refresh', () => {
    it('should return a new access token with a valid refresh token', async () => {
      // Create a user first
      const uniqueId = `refresh${Date.now()}`;
      const loginResp = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
      });
      const loginBody = JSON.parse(loginResp.body);
      testUserIds.push(loginBody.session.user.id);

      const { refreshToken } = loginBody.session;

      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('accessToken');
      expect(body).toHaveProperty('expiresAt');
      expect(typeof body.accessToken).toBe('string');
      expect(typeof body.expiresAt).toBe('string');
    });

    it('should return 401 with an invalid refresh token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: 'invalid-token-value' },
      });
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('INVALID_REFRESH_TOKEN');
    });
  });

  describe('GET /auth/me', () => {
    it('should return user profile with a valid access token', async () => {
      const uniqueId = `me${Date.now()}`;
      const loginResp = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
      });
      const loginBody = JSON.parse(loginResp.body);
      testUserIds.push(loginBody.session.user.id);

      const { accessToken } = loginBody.session;

      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('user');
      expect(body.user.id).toBe(loginBody.session.user.id);
      expect(body.user).toHaveProperty('email');
      expect(body.user).toHaveProperty('username');
      expect(body.user).toHaveProperty('karma');
      expect(body.user).toHaveProperty('karmaRank');
    });

    it('should return 401 without a token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 401 with an invalid token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          authorization: 'Bearer invalid-jwt-token',
        },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('should return 204 on logout', async () => {
      const uniqueId = `logout${Date.now()}`;
      const loginResp = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
      });
      const loginBody = JSON.parse(loginResp.body);
      testUserIds.push(loginBody.session.user.id);

      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        payload: { refreshToken: loginBody.session.refreshToken },
      });
      expect(response.statusCode).toBe(204);
    });
  });
});
