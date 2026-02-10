import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Integration tests for listing routes.
 *
 * Tests GET listings, price history, POST preview (SSRF protection),
 * and POST submit against the real database.
 */
describe('Listing routes', () => {
  let app: FastifyInstance;
  let testPropertyId: string;
  let testAccessToken: string;
  const testUserIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    // Get a real property ID from Eindhoven
    const propResp = await app.inject({
      method: 'GET',
      url: '/properties?limit=1&city=Eindhoven',
    });
    const propBody = JSON.parse(propResp.body);
    testPropertyId = propBody.data[0].id;

    // Create a test user for authenticated endpoints
    const uniqueId = `listtest${Date.now()}`;
    const authResp = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: {
        idToken: `mock-google-${uniqueId}-gid${uniqueId}`,
      },
    });
    const authBody = JSON.parse(authResp.body);
    testAccessToken = authBody.session.accessToken;
    testUserIds.push(authBody.session.user.id);
  });

  afterAll(async () => {
    for (const userId of testUserIds) {
      try {
        await db.delete(users).where(eq(users.id, userId));
      } catch {
        // Ignore cleanup errors
      }
    }
    await app.close();
  });

  describe('GET /properties/:id/listings', () => {
    it('should return listings array for a valid property', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${testPropertyId}/listings`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);

      // If there are listings, verify schema
      if (body.data.length > 0) {
        const listing = body.data[0];
        expect(listing).toHaveProperty('id');
        expect(listing).toHaveProperty('sourceUrl');
        expect(listing).toHaveProperty('sourceName');
        expect(listing).toHaveProperty('status');
        expect(listing).toHaveProperty('createdAt');
        expect(['funda', 'pararius', 'other']).toContain(listing.sourceName);
        expect(['active', 'sold', 'rented', 'withdrawn']).toContain(listing.status);
      }
    });

    it('should return 404 for non-existent property', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${fakeId}/listings`,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('error', 'NOT_FOUND');
    });

    it('should return 400 for invalid UUID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/not-a-uuid/listings',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /properties/:id/price-history', () => {
    it('should return price history array for a valid property', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${testPropertyId}/price-history`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body)).toBe(true);

      // If there's price history, verify schema
      if (body.length > 0) {
        const entry = body[0];
        expect(entry).toHaveProperty('price');
        expect(entry).toHaveProperty('priceDate');
        expect(entry).toHaveProperty('eventType');
        expect(entry).toHaveProperty('source');
        expect(typeof entry.price).toBe('number');
      }
    });

    it('should return 404 for non-existent property', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${fakeId}/price-history`,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /listings/preview', () => {
    it('should reject unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        payload: {
          url: 'https://www.funda.nl/koop/eindhoven/huis-12345/',
          propertyId: testPropertyId,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject non-whitelisted URLs (SSRF protection)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          url: 'https://evil-site.com/listing',
          propertyId: testPropertyId,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('INVALID_URL');
    });

    it('should reject HTTP URLs (non-HTTPS)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          url: 'http://www.funda.nl/koop/test/',
          propertyId: testPropertyId,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject private IP addresses', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          url: 'https://192.168.1.1/admin',
          propertyId: testPropertyId,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 404 for non-existent property', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          url: 'https://www.funda.nl/koop/eindhoven/huis-12345/',
          propertyId: fakeId,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /listings/submit', () => {
    it('should reject unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        payload: {
          url: 'https://www.funda.nl/koop/eindhoven/huis-99999/',
          propertyId: testPropertyId,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject non-whitelisted URLs (SSRF protection)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          url: 'https://malicious-site.com/phishing',
          propertyId: testPropertyId,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('INVALID_URL');
    });

    it('should return 404 for non-existent property', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          url: 'https://www.funda.nl/koop/eindhoven/huis-88888/',
          propertyId: fakeId,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/ingest/watermark', () => {
    it('should reject unauthenticated requests (no API key)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/ingest/watermark?source=funda',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject invalid API key', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/ingest/watermark?source=funda',
        headers: {
          'x-api-key': 'wrong-key',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /api/ingest/listings', () => {
    it('should reject unauthenticated requests (no API key)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ingest/listings',
        payload: {
          listings: [],
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
