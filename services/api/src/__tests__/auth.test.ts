/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Auth routes unit tests
 *
 * These are unit tests that mock the database layer.
 * For integration tests with a real database, see services/api/test/integration/
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  getAccessTokenExpiry,
} from '../plugins/auth.js';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';
// Mock the database module
jest.mock('../db/index.js', () => ({
  db: {
    query: {
      users: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'test-user-id',
          googleId: 'google-12345',
          appleId: null,
          email: 'testuser@gmail.com',
          username: 'testuser123',
          displayName: 'Test User',
          profilePhotoUrl: null,
          karma: 100,
          internalKarma: 100,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
    },
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([{
          id: 'test-user-id',
          googleId: 'google-12345',
          appleId: null,
          email: 'testuser@gmail.com',
          username: 'testuser123',
          displayName: 'Test User',
          profilePhotoUrl: null,
          karma: 100,
          internalKarma: 100,
          createdAt: new Date(),
          updatedAt: new Date(),
        }]),
      }),
    }),
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      }),
    }),
  },
  closeConnection: jest.fn().mockResolvedValue(undefined),
}));

describe('Auth Plugin Functions', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  describe('generateAccessToken', () => {
    it('should generate a valid JWT token', () => {
      const userId = 'test-user-123';
      const token = generateAccessToken(app, userId);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should generate different tokens for different users', () => {
      const token1 = generateAccessToken(app, 'user-1');
      const token2 = generateAccessToken(app, 'user-2');

      expect(token1).not.toBe(token2);
    });
  });

  describe('generateRefreshToken', () => {
    it('should generate a valid JWT refresh token', () => {
      const userId = 'test-user-123';
      const token = generateRefreshToken(userId);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should generate different tokens for different users', () => {
      const token1 = generateRefreshToken('user-1');
      const token2 = generateRefreshToken('user-2');

      expect(token1).not.toBe(token2);
    });
  });

  describe('verifyRefreshToken', () => {
    it('should verify a valid refresh token', () => {
      const userId = 'test-user-123';
      const token = generateRefreshToken(userId);
      const payload = verifyRefreshToken(token);

      expect(payload).not.toBeNull();
      expect(payload?.userId).toBe(userId);
      expect(payload?.type).toBe('refresh');
    });

    it('should return null for invalid token', () => {
      const payload = verifyRefreshToken('invalid-token');

      expect(payload).toBeNull();
    });

    it('should return null for access token (wrong type)', async () => {
      const token = generateAccessToken(app, 'test-user-123');
      const payload = verifyRefreshToken(token);

      // verifyRefreshToken uses a different secret, so it won't verify
      expect(payload).toBeNull();
    });
  });

  describe('getAccessTokenExpiry', () => {
    it('should return a future date', () => {
      const expiry = getAccessTokenExpiry();

      expect(expiry).toBeInstanceOf(Date);
      expect(expiry.getTime()).toBeGreaterThan(Date.now());
    });

    it('should be at least 14 minutes in the future', () => {
      const expiry = getAccessTokenExpiry();
      const minExpectedTime = Date.now() + 14 * 60 * 1000; // 14 minutes

      expect(expiry.getTime()).toBeGreaterThan(minExpectedTime);
    });

    it('should be at most 16 minutes in the future', () => {
      const expiry = getAccessTokenExpiry();
      const maxExpectedTime = Date.now() + 16 * 60 * 1000; // 16 minutes

      expect(expiry.getTime()).toBeLessThan(maxExpectedTime);
    });
  });
});

describe('Auth Route Handlers', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  describe('POST /auth/google', () => {
    it('should return 400 for empty idToken', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: {
          idToken: '',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    // Skip: Requires database connection - ESM mocking doesn't work with eager module initialization
    it.skip('should accept valid mock token format in dev mode', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: {
          idToken: 'mock-google-testuser-12345',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('session');
      expect(body).toHaveProperty('isNewUser');
      expect(body.session).toHaveProperty('user');
      expect(body.session).toHaveProperty('accessToken');
      expect(body.session).toHaveProperty('refreshToken');
      expect(body.session).toHaveProperty('expiresAt');
    });
  });

  describe('POST /auth/apple', () => {
    it('should return 400 for empty idToken', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/apple',
        payload: {
          idToken: '',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    // Skip: Requires database connection - ESM mocking doesn't work with eager module initialization
    it.skip('should accept valid mock token format in dev mode', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/apple',
        payload: {
          idToken: 'mock-apple-testuser-12345',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('session');
      expect(body.session).toHaveProperty('user');
    });
  });

  describe('POST /auth/refresh', () => {
    it('should return 400 for missing refresh token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 401 for invalid refresh token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: {
          refreshToken: 'invalid-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('INVALID_REFRESH_TOKEN');
    });

    // Skip: requires full drizzle mock with proper query execution
    it.skip('should return new access token for valid refresh token', async () => {
      // First generate a valid refresh token
      const refreshToken = generateRefreshToken('test-user-id');

      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: {
          refreshToken,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('accessToken');
      expect(body).toHaveProperty('expiresAt');
    });
  });

  describe('POST /auth/logout', () => {
    it('should return 204 on logout', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        payload: {},
      });

      expect(response.statusCode).toBe(204);
    });

    it('should accept refresh token in body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        payload: {
          refreshToken: 'some-refresh-token',
        },
      });

      expect(response.statusCode).toBe(204);
    });
  });

  describe('GET /auth/me', () => {
    it('should return 401 without auth header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 401 with invalid token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          Authorization: 'Bearer invalid-token',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    // Skip: requires full drizzle mock with proper query execution
    it.skip('should return user profile with valid token', async () => {
      // Generate a valid access token
      const accessToken = generateAccessToken(app, 'test-user-id');

      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('user');
      expect(body.user).toHaveProperty('id');
      expect(body.user).toHaveProperty('username');
      expect(body.user).toHaveProperty('email');
    });
  });
});

describe('Token Properties', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  it('should generate different tokens for access and refresh', () => {
    const userId = 'test-user-123';
    const accessToken = generateAccessToken(app, userId);
    const refreshToken = generateRefreshToken(userId);

    expect(accessToken).not.toBe(refreshToken);
  });

  it('access and refresh tokens should have different signatures', () => {
    const userId = 'test-user-123';
    const accessToken = generateAccessToken(app, userId);
    const refreshToken = generateRefreshToken(userId);

    const accessSignature = accessToken.split('.')[2];
    const refreshSignature = refreshToken.split('.')[2];

    expect(accessSignature).not.toBe(refreshSignature);
  });
});
