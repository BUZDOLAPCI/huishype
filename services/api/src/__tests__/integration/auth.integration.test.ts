import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';

type InjectCookie = {
  name: string;
  value: string;
  httpOnly?: boolean;
  sameSite?: string;
};

function toCookieHeader(cookies: InjectCookie[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

function getCookieValue(cookies: InjectCookie[], name: string): string | undefined {
  return cookies.find((cookie) => cookie.name === name)?.value;
}

function expectBrowserSession(session: Record<string, unknown>) {
  expect(session).toHaveProperty('user');
  expect(session).toHaveProperty('expiresAt');
  expect(session).not.toHaveProperty('accessToken');
  expect(session).not.toHaveProperty('refreshToken');
}

function expectTokenSession(session: Record<string, unknown>) {
  expect(session).toHaveProperty('user');
  expect(session).toHaveProperty('expiresAt');
  expect(session).toHaveProperty('accessToken');
  expect(session).toHaveProperty('refreshToken');
}

describe('Auth routes', () => {
  let app: FastifyInstance;
  const testUserIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    for (const userId of testUserIds) {
      try {
        await db.delete(users).where(eq(users.id, userId));
      } catch {
        // Ignore cleanup errors for already-deleted rows.
      }
    }

    await app.close();
  });

  describe('browser session endpoints', () => {
    it('creates a cookie-backed browser session for Google login', async () => {
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
      expect(body).toHaveProperty('isNewUser', true);
      expectBrowserSession(body.session);
      expect(body.session.user).not.toHaveProperty('isPlus');

      expect(response.cookies).toHaveLength(2);
      expect(getCookieValue(response.cookies, 'huishype_access')).toBeTruthy();
      expect(getCookieValue(response.cookies, 'huishype_refresh')).toBeTruthy();
      expect(response.cookies.every((cookie) => cookie.httpOnly)).toBe(true);

      testUserIds.push(body.session.user.id);
    });

    it('returns isNewUser=false for an existing browser user', async () => {
      const uniqueId = `existing${Date.now()}`;
      const token = `mock-google-${uniqueId}-gid${uniqueId}`;

      const first = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: { idToken: token },
      });
      expect(first.statusCode).toBe(200);
      const firstBody = JSON.parse(first.body);
      testUserIds.push(firstBody.session.user.id);

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

    it('creates a cookie-backed browser session for Apple login', async () => {
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
      expectBrowserSession(body.session);
      expect(getCookieValue(response.cookies, 'huishype_access')).toBeTruthy();
      expect(getCookieValue(response.cookies, 'huishype_refresh')).toBeTruthy();

      testUserIds.push(body.session.user.id);
    });

    it('refreshes the browser session from the refresh cookie', async () => {
      const uniqueId = `refresh${Date.now()}`;
      const loginResp = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
      });
      const loginBody = JSON.parse(loginResp.body);
      testUserIds.push(loginBody.session.user.id);

      const cookieHeader = toCookieHeader(loginResp.cookies);

      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: {
          cookie: cookieHeader,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expectBrowserSession(body.session);
      expect(getCookieValue(response.cookies, 'huishype_access')).toBeTruthy();
      expect(getCookieValue(response.cookies, 'huishype_refresh')).toBeTruthy();
    });

    it('returns 401 when the browser refresh cookie is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toMatchObject({
        error: 'INVALID_REFRESH_TOKEN',
      });
    });

    it('returns 401 after browser logout revokes the refresh cookie', async () => {
      const uniqueId = `logout${Date.now()}`;
      const loginResp = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
      });
      const loginBody = JSON.parse(loginResp.body);
      testUserIds.push(loginBody.session.user.id);

      const cookieHeader = toCookieHeader(loginResp.cookies);

      const logoutResp = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: {
          cookie: cookieHeader,
        },
      });
      expect(logoutResp.statusCode).toBe(204);

      const refreshResp = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: {
          cookie: cookieHeader,
        },
      });

      expect(refreshResp.statusCode).toBe(401);
      expect(JSON.parse(refreshResp.body)).toMatchObject({
        error: 'INVALID_REFRESH_TOKEN',
      });
    });

    it('authenticates /auth/me from browser cookies', async () => {
      const uniqueId = `me-cookie${Date.now()}`;
      const loginResp = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
      });
      const loginBody = JSON.parse(loginResp.body);
      testUserIds.push(loginBody.session.user.id);

      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          cookie: toCookieHeader(loginResp.cookies),
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('user');
      expect(body.user.id).toBe(loginBody.session.user.id);
      expect(body.user).toHaveProperty('email');
      expect(body.user).not.toHaveProperty('isPlus');
    });

    it('returns user=null for /auth/session without authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/session',
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        user: null,
      });
    });

    it('returns the active user for /auth/session from browser cookies', async () => {
      const uniqueId = `session-cookie${Date.now()}`;
      const loginResp = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
      });
      const loginBody = JSON.parse(loginResp.body);
      testUserIds.push(loginBody.session.user.id);

      const response = await app.inject({
        method: 'GET',
        url: '/auth/session',
        headers: {
          cookie: toCookieHeader(loginResp.cookies),
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('user');
      expect(body.user.id).toBe(loginBody.session.user.id);
      expect(body.user).toHaveProperty('email');
    });

    it('keeps browser logout idempotent without cookies', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
      });

      expect(response.statusCode).toBe(204);
    });
  });

  describe('explicit token endpoints', () => {
    it('creates a bearer-token session for non-browser Google clients', async () => {
      const uniqueId = `token-google${Date.now()}`;
      const response = await app.inject({
        method: 'POST',
        url: '/auth/token/google',
        payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expectTokenSession(body.session);
      expect(response.cookies).toHaveLength(0);

      testUserIds.push(body.session.user.id);
    });

    it('creates a bearer-token session for non-browser Apple clients', async () => {
      const uniqueId = `token-apple${Date.now()}`;
      const response = await app.inject({
        method: 'POST',
        url: '/auth/token/apple',
        payload: { idToken: `mock-apple-${uniqueId}-aid${uniqueId}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expectTokenSession(body.session);

      testUserIds.push(body.session.user.id);
    });

    it('refreshes an explicit token session with /auth/token/refresh', async () => {
      const uniqueId = `token-refresh${Date.now()}`;
      const loginResp = await app.inject({
        method: 'POST',
        url: '/auth/token/google',
        payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
      });
      const loginBody = JSON.parse(loginResp.body);
      testUserIds.push(loginBody.session.user.id);

      const response = await app.inject({
        method: 'POST',
        url: '/auth/token/refresh',
        payload: { refreshToken: loginBody.session.refreshToken },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expectTokenSession(body.session);
      expect(body.session.accessToken).toBeTruthy();
      expect(body.session.refreshToken).toBeTruthy();
    });

    it('returns 401 with an invalid explicit refresh token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/token/refresh',
        payload: { refreshToken: 'invalid-token-value' },
      });
      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error).toBe('INVALID_REFRESH_TOKEN');
    });

    it('revokes explicit token sessions via /auth/token/logout', async () => {
      const uniqueId = `token-logout${Date.now()}`;
      const loginResp = await app.inject({
        method: 'POST',
        url: '/auth/token/google',
        payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
      });
      const loginBody = JSON.parse(loginResp.body);
      testUserIds.push(loginBody.session.user.id);

      const response = await app.inject({
        method: 'POST',
        url: '/auth/token/logout',
        payload: { refreshToken: loginBody.session.refreshToken },
      });
      expect(response.statusCode).toBe(204);

      const refreshResp = await app.inject({
        method: 'POST',
        url: '/auth/token/refresh',
        payload: { refreshToken: loginBody.session.refreshToken },
      });
      expect(refreshResp.statusCode).toBe(401);
    });

    it('authenticates /auth/me from a bearer token', async () => {
      const uniqueId = `me-bearer${Date.now()}`;
      const loginResp = await app.inject({
        method: 'POST',
        url: '/auth/token/google',
        payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
      });
      const loginBody = JSON.parse(loginResp.body);
      testUserIds.push(loginBody.session.user.id);

      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          authorization: `Bearer ${loginBody.session.accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.user.id).toBe(loginBody.session.user.id);
    });
  });

  describe('shared auth validation', () => {
    it('returns 400 when browser idToken is empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: { idToken: '' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 401 without any auth for /auth/me', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 with an invalid bearer token for /auth/me', async () => {
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
});
