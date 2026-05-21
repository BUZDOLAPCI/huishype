import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { config } from '../../config.js';

/**
 * Integration tests for auth routes.
 *
 * Uses dev-mode mock tokens (structured `mock-google:<base64url-json>` and
 * legacy `mock-google-{email}-{googleId}`).
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
    it('should preserve unique identities for structured mock tokens with hyphenated labels', async () => {
      const buildStructuredToken = (label: string) =>
        `mock-google:${Buffer.from(
          JSON.stringify({
            email: `${label}@gmail.com`,
            googleId: `gid-${label}`,
            name: label,
          }),
          'utf8',
        ).toString('base64url')}`;

      const firstToken = buildStructuredToken(`property-saves-${Date.now()}-a`);
      const secondToken = buildStructuredToken(`property-saves-${Date.now()}-b`);

      const firstResponse = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: { idToken: firstToken },
      });
      expect(firstResponse.statusCode).toBe(200);
      const firstBody = JSON.parse(firstResponse.body);
      testUserIds.push(firstBody.session.user.id);

      const repeatResponse = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: { idToken: firstToken },
      });
      expect(repeatResponse.statusCode).toBe(200);
      const repeatBody = JSON.parse(repeatResponse.body);
      expect(repeatBody.session.user.id).toBe(firstBody.session.user.id);
      expect(repeatBody.isNewUser).toBe(false);

      const secondResponse = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: { idToken: secondToken },
      });
      expect(secondResponse.statusCode).toBe(200);
      const secondBody = JSON.parse(secondResponse.body);
      testUserIds.push(secondBody.session.user.id);

      expect(secondBody.session.user.id).not.toBe(firstBody.session.user.id);
    });

    it('should retry user creation when generated usernames collide', async () => {
      const randomValues = [
        0, 0, 0, // First user: happyhuis0
        0, 0, 0, // Second user first attempt: same username
        0.2, 0.2, 0.2, // Second user retry: different username
      ];
      const randomSpy = jest
        .spyOn(Math, 'random')
        .mockImplementation(() => randomValues.shift() ?? 0.2);

      const buildStructuredToken = (label: string) =>
        `mock-google:${Buffer.from(
          JSON.stringify({
            email: `${label}@gmail.com`,
            googleId: `gid-${label}`,
            name: label,
          }),
          'utf8',
        ).toString('base64url')}`;

      try {
        const firstToken = buildStructuredToken(`username-collision-${Date.now()}-a`);
        const secondToken = buildStructuredToken(`username-collision-${Date.now()}-b`);

        const firstResponse = await app.inject({
          method: 'POST',
          url: '/auth/google',
          payload: { idToken: firstToken },
        });
        expect(firstResponse.statusCode).toBe(200);
        const firstBody = JSON.parse(firstResponse.body);
        testUserIds.push(firstBody.session.user.id);

        const secondResponse = await app.inject({
          method: 'POST',
          url: '/auth/google',
          payload: { idToken: secondToken },
        });
        expect(secondResponse.statusCode).toBe(200);
        const secondBody = JSON.parse(secondResponse.body);
        testUserIds.push(secondBody.session.user.id);

        expect(secondBody.session.user.id).not.toBe(firstBody.session.user.id);
        expect(secondBody.session.user.username).not.toBe(firstBody.session.user.username);
      } finally {
        randomSpy.mockRestore();
      }
    });

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
      expect(user.email).toBe(`${uniqueId}@gmail.com`);
      expect(user).toHaveProperty('karma');
      expect(user).toHaveProperty('karmaRank');
      expect(user).toHaveProperty('createdAt');
      expect(user).not.toHaveProperty('isPlus');

      testUserIds.push(user.id);
    });

    it('should reuse the existing user when the insert races with a stale identity lookup', async () => {
      const uniqueId = `stale-google-${Date.now()}`;
      const email = `${uniqueId}@gmail.com`;
      const googleId = `gid${uniqueId}`;
      const username = `stalegoogle${Date.now()}`.slice(0, 50);

      const [existingUser] = await db
        .insert(users)
        .values({
          email,
          googleId,
          username,
          displayName: uniqueId,
        })
        .returning({ id: users.id });
      testUserIds.push(existingUser.id);

      const originalFindFirst = db.query.users.findFirst.bind(db.query.users);
      const findFirstSpy = jest.spyOn(db.query.users, 'findFirst');
      try {
        findFirstSpy.mockImplementationOnce(() =>
          originalFindFirst({
            where: eq(users.id, '00000000-0000-0000-0000-000000000000'),
          }),
        );

        const response = await app.inject({
          method: 'POST',
          url: '/auth/google',
          payload: {
            idToken: `mock-google:${Buffer.from(
              JSON.stringify({
                email,
                googleId,
                name: uniqueId,
              }),
              'utf8',
            ).toString('base64url')}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.isNewUser).toBe(false);
        expect(body.session.user.id).toBe(existingUser.id);
        expect(findFirstSpy).toHaveBeenCalledTimes(2);
      } finally {
        findFirstSpy.mockRestore();
      }
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

    it('should verify real Google tokens in development instead of replacing the email', async () => {
      const email = `real-google-${Date.now()}@live.com`;
      const sub = `google-real-${Date.now()}`;
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          email,
          sub,
          name: 'Real Google User',
          aud: config.auth.googleClientId,
        }),
      } as Response);

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/auth/google',
          payload: { idToken: 'real-google-id-token' },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.session.user.email).toBe(email);
        expect(body.session.user.email).not.toMatch(/^testuser\d+@gmail\.com$/);
        expect(fetchSpy).toHaveBeenCalledWith(
          'https://oauth2.googleapis.com/tokeninfo?id_token=real-google-id-token',
        );

        testUserIds.push(body.session.user.id);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('should reject non-mock invalid Google tokens in development', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      } as Response);

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/auth/google',
          payload: { idToken: 'invalid-real-google-token' },
        });

        expect(response.statusCode).toBe(401);
        expect(JSON.parse(response.body)).toMatchObject({
          error: 'INVALID_TOKEN',
          message: 'Invalid or expired Google ID token',
        });
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  describe('POST /auth/apple', () => {
    it('should create a new user with mock token and return session without isPlus', async () => {
      const uniqueId = `apple${Date.now()}`;
      const response = await app.inject({
        method: 'POST',
        url: '/auth/apple',
        payload: {
          idToken: `mock-apple-${uniqueId}-aid${uniqueId}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.isNewUser).toBe(true);
      expect(body.session.user.email).toBe(`${uniqueId}@privaterelay.appleid.com`);
      expect(body.session.user).not.toHaveProperty('isPlus');

      testUserIds.push(body.session.user.id);
    });
  });

  describe('POST /auth/email/verify', () => {
    it('should create a session without isPlus', async () => {
      const email = `email-auth-${Date.now()}@example.com`;
      const requestResponse = await app.inject({
        method: 'POST',
        url: '/auth/email/request',
        payload: { email },
      });

      expect(requestResponse.statusCode).toBe(200);
      const requestBody = JSON.parse(requestResponse.body);
      expect(requestBody).toHaveProperty('token');

      const verifyResponse = await app.inject({
        method: 'POST',
        url: '/auth/email/verify',
        payload: { token: requestBody.token },
      });

      expect(verifyResponse.statusCode).toBe(200);
      const verifyBody = JSON.parse(verifyResponse.body);

      expect(verifyBody.isNewUser).toBe(true);
      expect(verifyBody.session.user.email).toBe(email);
      expect(verifyBody.session.user).not.toHaveProperty('isPlus');

      testUserIds.push(verifyBody.session.user.id);
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

    it('should return 401 after the refresh token has been revoked', async () => {
      const uniqueId = `revoked${Date.now()}`;
      const loginResp = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
      });
      const loginBody = JSON.parse(loginResp.body);
      testUserIds.push(loginBody.session.user.id);

      const { refreshToken } = loginBody.session;

      const logoutResp = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        payload: { refreshToken },
      });
      expect(logoutResp.statusCode).toBe(204);

      const refreshResp = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken },
      });

      expect(refreshResp.statusCode).toBe(401);
      expect(JSON.parse(refreshResp.body)).toMatchObject({
        error: 'INVALID_REFRESH_TOKEN',
      });
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
      expect(body.user).not.toHaveProperty('isPlus');
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
    it('should revoke the provided refresh token and return 204 on logout', async () => {
      const uniqueId = `logout${Date.now()}`;
      const loginResp = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
      });
      expect(loginResp.statusCode).toBe(200);
      const loginBody = JSON.parse(loginResp.body);
      testUserIds.push(loginBody.session.user.id);

      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        payload: { refreshToken: loginBody.session.refreshToken },
      });
      expect(response.statusCode).toBe(204);

      const refreshResp = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: loginBody.session.refreshToken },
      });
      expect(refreshResp.statusCode).toBe(401);
    });

    it('should remain idempotent when no refresh token is provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        payload: {},
      });

      expect(response.statusCode).toBe(204);
    });
  });
});
