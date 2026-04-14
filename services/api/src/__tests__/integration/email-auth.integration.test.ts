import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { users, emailAuthTokens } from '../../db/schema.js';

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

describe('Email auth routes', () => {
  let app: FastifyInstance;
  const testEmail = `emailtest${Date.now()}@test.com`;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    try {
      await db.delete(emailAuthTokens).where(eq(emailAuthTokens.email, testEmail));
    } catch {
      // Ignore.
    }

    for (const uid of createdUserIds) {
      try {
        await db.delete(users).where(eq(users.id, uid));
      } catch {
        // Ignore.
      }
    }

    await app.close();
  });

  describe('POST /auth/email/request', () => {
    it('returns a token in dev mode', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/email/request',
        payload: { email: testEmail },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.message).toBeTruthy();
      expect(body.token).toBeTruthy();
      expect(body.token.length).toBe(64);
    });

    it('validates email format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/email/request',
        payload: { email: 'not-an-email' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rate limits after 3 requests', async () => {
      const rateEmail = `ratelimit${Date.now()}@test.com`;

      for (let i = 0; i < 3; i++) {
        await app.inject({
          method: 'POST',
          url: '/auth/email/request',
          payload: { email: rateEmail },
        });
      }

      const response = await app.inject({
        method: 'POST',
        url: '/auth/email/request',
        payload: { email: rateEmail },
      });

      expect(response.statusCode).toBe(429);
      expect(JSON.parse(response.body).error).toBe('RATE_LIMITED');

      await db.delete(emailAuthTokens).where(eq(emailAuthTokens.email, rateEmail));
    });
  });

  describe('browser email verification', () => {
    let validToken: string;

    it('verifies a token into a cookie-backed browser session', async () => {
      const reqResp = await app.inject({
        method: 'POST',
        url: '/auth/email/request',
        payload: { email: testEmail },
      });
      const reqBody = JSON.parse(reqResp.body);
      validToken = reqBody.token;

      const verifyResp = await app.inject({
        method: 'POST',
        url: '/auth/email/verify',
        payload: { token: validToken },
      });

      expect(verifyResp.statusCode).toBe(200);
      const verifyBody = JSON.parse(verifyResp.body);
      expectBrowserSession(verifyBody.session);
      expect(verifyBody.isNewUser).toBe(true);
      expect(verifyResp.cookies).toHaveLength(2);

      createdUserIds.push(verifyBody.session.user.id);
    });

    it('rejects an already-used token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/email/verify',
        payload: { token: validToken },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error).toBe('INVALID_TOKEN');
    });

    it('rejects an invalid token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/email/verify',
        payload: { token: 'a'.repeat(64) },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns isNewUser=false for an existing email', async () => {
      const reqResp = await app.inject({
        method: 'POST',
        url: '/auth/email/request',
        payload: { email: testEmail },
      });
      const reqBody = JSON.parse(reqResp.body);

      const verifyResp = await app.inject({
        method: 'POST',
        url: '/auth/email/verify',
        payload: { token: reqBody.token },
      });

      expect(verifyResp.statusCode).toBe(200);
      expect(JSON.parse(verifyResp.body).isNewUser).toBe(false);
    });

    it('rejects tokens with the wrong length', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/email/verify',
        payload: { token: 'short' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('explicit token email verification', () => {
    it('returns bearer tokens from /auth/token/email/verify', async () => {
      const email = `emailtoken${Date.now()}@test.com`;
      const requestResp = await app.inject({
        method: 'POST',
        url: '/auth/email/request',
        payload: { email },
      });
      const requestBody = JSON.parse(requestResp.body);

      const verifyResp = await app.inject({
        method: 'POST',
        url: '/auth/token/email/verify',
        payload: { token: requestBody.token },
      });

      expect(verifyResp.statusCode).toBe(200);
      const verifyBody = JSON.parse(verifyResp.body);
      expectTokenSession(verifyBody.session);
      expect(verifyResp.cookies).toHaveLength(0);

      createdUserIds.push(verifyBody.session.user.id);
      await db.delete(emailAuthTokens).where(eq(emailAuthTokens.email, email));
    });
  });
});
