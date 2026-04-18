import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users, emailAuthTokens } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

describe('Email auth routes', () => {
  let app: FastifyInstance;
  const testEmail = `emailtest${Date.now()}@test.com`;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    // Clean up
    try {
      await db.delete(emailAuthTokens).where(eq(emailAuthTokens.email, testEmail));
    } catch {
      // Ignore
    }
    for (const uid of createdUserIds) {
      try {
        await db.delete(users).where(eq(users.id, uid));
      } catch {
        // Ignore
      }
    }
    await app.close();
  });

  describe('GET /auth/email/preview', () => {
    it('should render the browser preview page in dev/test mode', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/email/preview?email=previewer%40example.com&token=preview-token-123',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('Magic link email preview');
      expect(response.body).toContain('previewer@example.com');
      expect(response.body).toContain('preview-token-123');
      expect(response.body).toContain('iframe');
    });
  });

  describe('POST /auth/email/request', () => {
    it('should return a token in dev mode', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/email/request',
        payload: { email: testEmail },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.message).toBeTruthy();
      // In dev mode, token is returned
      expect(body.token).toBeTruthy();
      expect(body.token.length).toBe(64);
    });

    it('should validate email format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/email/request',
        payload: { email: 'not-an-email' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should rate limit after 3 requests', async () => {
      const rateEmail = `ratelimit${Date.now()}@test.com`;

      // Make 3 requests
      for (let i = 0; i < 3; i++) {
        await app.inject({
          method: 'POST',
          url: '/auth/email/request',
          payload: { email: rateEmail },
        });
      }

      // 4th should be rate limited
      const response = await app.inject({
        method: 'POST',
        url: '/auth/email/request',
        payload: { email: rateEmail },
      });

      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('RATE_LIMITED');

      // Clean up
      await db.delete(emailAuthTokens).where(eq(emailAuthTokens.email, rateEmail));
    });
  });

  describe('POST /auth/email/verify', () => {
    let validToken: string;

    it('should request and verify a token', async () => {
      // Request a token
      const reqResp = await app.inject({
        method: 'POST',
        url: '/auth/email/request',
        payload: { email: testEmail },
      });
      const reqBody = JSON.parse(reqResp.body);
      validToken = reqBody.token;

      // Verify the token
      const verifyResp = await app.inject({
        method: 'POST',
        url: '/auth/email/verify',
        payload: { token: validToken },
      });

      expect(verifyResp.statusCode).toBe(200);
      const verifyBody = JSON.parse(verifyResp.body);
      expect(verifyBody.session).toBeDefined();
      expect(verifyBody.session.user).toBeDefined();
      expect(verifyBody.session.accessToken).toBeTruthy();
      expect(verifyBody.session.refreshToken).toBeTruthy();
      expect(verifyBody.isNewUser).toBe(true);

      createdUserIds.push(verifyBody.session.user.id);
    });

    it('should reject an already-used token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/email/verify',
        payload: { token: validToken },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('INVALID_TOKEN');
    });

    it('should reject an invalid token', async () => {
      const fakeToken = 'a'.repeat(64);
      const response = await app.inject({
        method: 'POST',
        url: '/auth/email/verify',
        payload: { token: fakeToken },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return isNewUser=false for existing email', async () => {
      // Request another token for the same email
      const reqResp = await app.inject({
        method: 'POST',
        url: '/auth/email/request',
        payload: { email: testEmail },
      });
      const reqBody = JSON.parse(reqResp.body);
      const token = reqBody.token;

      const verifyResp = await app.inject({
        method: 'POST',
        url: '/auth/email/verify',
        payload: { token },
      });

      expect(verifyResp.statusCode).toBe(200);
      const verifyBody = JSON.parse(verifyResp.body);
      expect(verifyBody.isNewUser).toBe(false);
    });

    it('should reject token with wrong length', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/email/verify',
        payload: { token: 'short' },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
