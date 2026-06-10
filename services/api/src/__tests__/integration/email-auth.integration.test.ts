import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users, emailAuthTokens } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

describe('Email auth routes', () => {
  let app: FastifyInstance;
  const testEmail = `emailtest${Date.now()}@test.com`;
  const createdEmails = new Set<string>([testEmail]);
  const createdUserIds: string[] = [];

  function uniqueEmail(prefix: string): string {
    const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
    createdEmails.add(email);
    return email;
  }

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    // Clean up
    try {
      for (const email of createdEmails) {
        await db.delete(emailAuthTokens).where(eq(emailAuthTokens.email, email));
      }
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
      expect(body.code).toMatch(/^\d{6}$/);
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
      expect(verifyBody.session.user.email).toBe(testEmail);
      expect(verifyBody.session.user.handle).toBeTruthy();
      expect(verifyBody.session.user).not.toHaveProperty('username');
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

  describe('POST /auth/email/verify-code', () => {
    it('should verify a sign-in code and consume the shared token row', async () => {
      const email = uniqueEmail('code-auth');
      const reqResp = await app.inject({
        method: 'POST',
        url: '/auth/email/request',
        payload: { email },
      });
      const reqBody = JSON.parse(reqResp.body);

      expect(reqBody.token).toHaveLength(64);
      expect(reqBody.code).toMatch(/^\d{6}$/);

      const verifyResp = await app.inject({
        method: 'POST',
        url: '/auth/email/verify-code',
        payload: { email, code: `${reqBody.code.slice(0, 3)}-${reqBody.code.slice(3)}` },
      });

      expect(verifyResp.statusCode).toBe(200);
      const verifyBody = JSON.parse(verifyResp.body);
      expect(verifyBody.session.user.email).toBe(email);
      expect(verifyBody.session.accessToken).toBeTruthy();
      createdUserIds.push(verifyBody.session.user.id);

      const linkResp = await app.inject({
        method: 'POST',
        url: '/auth/email/verify',
        payload: { token: reqBody.token },
      });
      expect(linkResp.statusCode).toBe(401);
    });

    it('should reject a code after the magic link consumes the token row', async () => {
      const email = uniqueEmail('link-first');
      const reqResp = await app.inject({
        method: 'POST',
        url: '/auth/email/request',
        payload: { email },
      });
      const reqBody = JSON.parse(reqResp.body);

      const linkResp = await app.inject({
        method: 'POST',
        url: '/auth/email/verify',
        payload: { token: reqBody.token },
      });
      expect(linkResp.statusCode).toBe(200);
      const linkBody = JSON.parse(linkResp.body);
      createdUserIds.push(linkBody.session.user.id);

      const codeResp = await app.inject({
        method: 'POST',
        url: '/auth/email/verify-code',
        payload: { email, code: reqBody.code },
      });
      expect(codeResp.statusCode).toBe(401);
    });

    it('should reject an expired code with a generic invalid response', async () => {
      const email = uniqueEmail('expired-code');
      const reqResp = await app.inject({
        method: 'POST',
        url: '/auth/email/request',
        payload: { email },
      });
      const reqBody = JSON.parse(reqResp.body);

      await db
        .update(emailAuthTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(emailAuthTokens.token, reqBody.token));

      const response = await app.inject({
        method: 'POST',
        url: '/auth/email/verify-code',
        payload: { email, code: reqBody.code },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('INVALID_CODE');
    });

    it('should increment failed code attempts and lock out after five wrong codes', async () => {
      const email = uniqueEmail('wrong-code');
      const reqResp = await app.inject({
        method: 'POST',
        url: '/auth/email/request',
        payload: { email },
      });
      const reqBody = JSON.parse(reqResp.body);
      const wrongCode = reqBody.code === '000000' ? '111111' : '000000';

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const response = await app.inject({
          method: 'POST',
          url: '/auth/email/verify-code',
          payload: { email, code: wrongCode },
        });
        expect(response.statusCode).toBe(401);
      }

      const lockoutResponse = await app.inject({
        method: 'POST',
        url: '/auth/email/verify-code',
        payload: { email, code: wrongCode },
      });
      expect(lockoutResponse.statusCode).toBe(429);
      expect(JSON.parse(lockoutResponse.body).error).toBe('TOO_MANY_CODE_ATTEMPTS');

      const validAfterLockout = await app.inject({
        method: 'POST',
        url: '/auth/email/verify-code',
        payload: { email, code: reqBody.code },
      });
      expect(validAfterLockout.statusCode).toBe(429);
    });
  });
});
