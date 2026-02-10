import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Integration tests for SSRF protection and auth on listings endpoints.
 */
describe('Listings SSRF protection + auth', () => {
  let app: FastifyInstance;
  let accessToken: string;
  const testUserIds: string[] = [];

  // A valid-format UUID that probably doesn't exist in the DB
  const fakePropertyId = 'a0000000-0000-4000-a000-000000000099';

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    // Create a test user to get an access token
    const uniqueId = `ssrftest${Date.now()}`;
    const authRes = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
    });
    const authBody = JSON.parse(authRes.body);
    accessToken = authBody.session.accessToken;
    testUserIds.push(authBody.session.user.id);
  });

  afterAll(async () => {
    for (const userId of testUserIds) {
      try {
        await db.delete(users).where(eq(users.id, userId));
      } catch { /* ignore */ }
    }
    await app.close();
  });

  // -----------------------------------------------------------------------
  // POST /listings/preview — auth required
  // -----------------------------------------------------------------------

  describe('POST /listings/preview', () => {
    it('should return 401 without auth token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        payload: {
          url: 'https://www.funda.nl/koop/amsterdam/huis-12345/',
          propertyId: fakePropertyId,
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it('should return 400 for non-whitelisted domain', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          url: 'https://evil.com/steal-data',
          propertyId: fakePropertyId,
        },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('INVALID_URL');
    });

    it('should return 400 for HTTP (non-HTTPS) funda URL', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          url: 'http://www.funda.nl/koop/amsterdam/huis-12345/',
          propertyId: fakePropertyId,
        },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('INVALID_URL');
    });

    it('should return 400 for localhost SSRF attempt', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          url: 'https://127.0.0.1:3100/health',
          propertyId: fakePropertyId,
        },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('INVALID_URL');
    });

    it('should return 400 for AWS metadata SSRF attempt', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          url: 'https://169.254.169.254/latest/meta-data/',
          propertyId: fakePropertyId,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for private IP SSRF attempt', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          url: 'https://10.0.0.1/internal-api',
          propertyId: fakePropertyId,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for domain that includes funda.nl but is not a subdomain', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          url: 'https://funda.nl.evil.com/koop/',
          propertyId: fakePropertyId,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('should accept valid funda.nl URL (returns 404 for non-existent property)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          url: 'https://www.funda.nl/koop/amsterdam/huis-12345/',
          propertyId: fakePropertyId,
        },
      });
      // 404 because the property doesn't exist, but it passes URL validation
      expect(res.statusCode).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // POST /listings/submit — auth required
  // -----------------------------------------------------------------------

  describe('POST /listings/submit', () => {
    it('should return 401 without auth token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        payload: {
          url: 'https://www.funda.nl/koop/amsterdam/huis-12345/',
          propertyId: fakePropertyId,
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it('should return 400 for non-whitelisted domain', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          url: 'https://evil.com/steal-data',
          propertyId: fakePropertyId,
        },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('INVALID_URL');
    });

    it('should return 400 for HTTP URL', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          url: 'http://www.funda.nl/koop/amsterdam/huis-12345/',
          propertyId: fakePropertyId,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for localhost SSRF attempt', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          url: 'https://127.0.0.1/',
          propertyId: fakePropertyId,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('should accept valid pararius.nl URL (returns 404 for non-existent property)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          url: 'https://www.pararius.nl/huurwoningen/amsterdam/12345/',
          propertyId: fakePropertyId,
        },
      });
      // 404 because the property doesn't exist, but it passes URL + auth validation
      expect(res.statusCode).toBe(404);
    });
  });
});
