import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import { db, ingestBatches, listings } from '../../db/index.js';
import { canonicalListings, mirrorListingWatches, users } from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { encodeOpaqueIngestCursor } from '../../services/ingest/index.js';
import {
  createIntegrationListing,
  createIntegrationPriceHistory,
  createIntegrationProperty,
} from './helpers/fixtures.js';

/**
 * Integration tests for listing routes.
 *
 * Tests GET listings, price history, POST preview/submit against the real
 * database while mocking the external source-service boundary.
 */
describe('Listing routes', () => {
  type MutableSourceServices = {
    fundaApiKey: string;
    parariusApiKey: string;
  };

  let app: FastifyInstance;
  let testPropertyId: string;
  let otherPropertyId: string;
  let testAccessToken: string;
  const testUserIds: string[] = [];
  const legacyListingIds: string[] = [];
  const originalFetch = global.fetch;
  const originalIngestApiKey = process.env.INGEST_API_KEY;
  const sourceServicesConfig = config.sourceServices as MutableSourceServices;
  const originalSourceServiceKeys = {
    fundaApiKey: config.sourceServices.fundaApiKey,
    parariusApiKey: config.sourceServices.parariusApiKey,
  };
  let mockFetchFn: jest.Mock<typeof global.fetch>;

  function jsonResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }

  function htmlResponse(html: string): Response {
    return new Response(html, {
      headers: {
        'content-type': 'text/html',
        'content-length': String(Buffer.byteLength(html)),
      },
    });
  }

  beforeAll(async () => {
    process.env.INGEST_API_KEY = 'test-ingest-api-key';
    sourceServicesConfig.fundaApiKey = 'test-funda-source-service-key';
    sourceServicesConfig.parariusApiKey = 'test-pararius-source-service-key';
    mockFetchFn = jest.fn() as jest.Mock<typeof global.fetch>;
    global.fetch = mockFetchFn;
    app = await buildApp({ logger: false });

    const property = await createIntegrationProperty({
      street: 'Listings Fixture Street',
      houseNumber: 1,
      city: 'Listings City',
      postalCode: '9100AA',
      lon: 5.471,
      lat: 51.441,
    });
    testPropertyId = property.id;

    const otherProperty = await createIntegrationProperty({
      street: 'Listings Mismatch Street',
      houseNumber: 2,
      city: 'Listings City',
      postalCode: '9100AB',
      lon: 5.472,
      lat: 51.442,
    });
    otherPropertyId = otherProperty.id;

    const seededListing = await createIntegrationListing({
      propertyId: testPropertyId,
      askingPrice: 450000,
      thumbnailUrl: 'https://cdn.example.com/listings-seeded-thumb.jpg',
      createdAt: new Date('2026-04-01T10:00:00.000Z'),
      updatedAt: new Date('2026-04-01T10:00:00.000Z'),
    });
    legacyListingIds.push(seededListing.id);
    await createIntegrationPriceHistory({
      propertyId: testPropertyId,
      listingId: seededListing.id,
      price: 450000,
      eventType: 'listed',
      source: 'funda',
      priceDate: new Date('2026-04-01T10:00:00.000Z'),
      createdAt: new Date('2026-04-01T10:00:00.000Z'),
    });

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

  beforeEach(() => {
    mockFetchFn.mockReset();
  });

  afterAll(async () => {
    try {
      for (const propertyId of [testPropertyId, otherPropertyId]) {
        await db.execute(sql`
          DELETE FROM listing_price_observations
          WHERE property_id = ${propertyId}
        `);
        await db.execute(sql`
          DELETE FROM listing_observation_links
          WHERE canonical_listing_id IN (
            SELECT id FROM canonical_listings WHERE property_id = ${propertyId}
          )
        `);
        await db.execute(sql`DELETE FROM mirror_listing_watches WHERE property_id = ${propertyId}`);
        await db.execute(sql`DELETE FROM listing_observations WHERE property_id = ${propertyId}`);
        await db.execute(sql`DELETE FROM canonical_listings WHERE property_id = ${propertyId}`);
        await db.execute(sql`DELETE FROM price_history WHERE property_id = ${propertyId}`);
        await db.execute(sql`DELETE FROM listings WHERE property_id = ${propertyId}`);
        await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
      }
    } catch {
      // Ignore cleanup errors
    }

    for (const listingId of legacyListingIds) {
      try {
        await db.delete(listings).where(eq(listings.id, listingId));
      } catch {
        // Ignore cleanup errors
      }
    }
    for (const userId of testUserIds) {
      try {
        await db.delete(users).where(eq(users.id, userId));
      } catch {
        // Ignore cleanup errors
      }
    }

    global.fetch = originalFetch;
    process.env.INGEST_API_KEY = originalIngestApiKey;
    sourceServicesConfig.fundaApiKey = originalSourceServiceKeys.fundaApiKey;
    sourceServicesConfig.parariusApiKey = originalSourceServiceKeys.parariusApiKey;
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
      expect(JSON.parse(response.body)).toHaveProperty('error', 'NOT_FOUND');
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
    it('should allow unauthenticated requests and use source-service validation', async () => {
      mockFetchFn
        .mockResolvedValueOnce(jsonResponse({
          supported: true,
          sourceName: 'funda',
          rawUrl: 'https://www.funda.nl/detail/koop/eindhoven/huis-listings-fixture/89779872/',
          canonicalUrl: 'https://www.funda.nl/detail/89779872/',
          sourceListingId: '89779872',
          sourceListingIdKind: 'tiny_id',
          aliases: [
            { kind: 'tiny_id', value: '89779872' },
            { kind: 'detail_id', value: '89779872' },
          ],
          listingPath: '/detail/89779872/',
          reasonCode: null,
        }))
        .mockResolvedValueOnce(jsonResponse({
          state: 'matched',
          sourceName: 'funda',
          rawUrl: 'https://www.funda.nl/detail/koop/eindhoven/huis-listings-fixture/89779872/',
          canonicalUrl: 'https://www.funda.nl/detail/89779872/',
          sourceListingId: '89779872',
          sourceListingIdKind: 'tiny_id',
          aliases: [
            { kind: 'tiny_id', value: '89779872' },
            { kind: 'detail_id', value: '89779872' },
          ],
          sourceStatus: 'available',
          matchedPropertyEvidence: {
            propertyId: testPropertyId,
            matchKind: 'source_exact',
          },
          title: 'Validated Funda listing',
          description: 'Source-owned validation',
          thumbnailUrl: 'https://cdn.example.com/listing-preview.jpg',
          price: 487500,
          currency: 'EUR',
        }));

      const response = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        payload: {
          url: 'https://www.funda.nl/detail/koop/eindhoven/huis-listings-fixture/89779872/',
          propertyId: testPropertyId,
          title: 'Caller supplied title',
          description: 'Caller supplied description',
          imageUrl: 'https://cdn.example.com/caller-preview.jpg',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        sourceName: 'funda',
        rawUrl: 'https://www.funda.nl/detail/koop/eindhoven/huis-listings-fixture/89779872/',
        canonicalUrl: 'https://www.funda.nl/detail/89779872/',
        sourceListingId: '89779872',
        sourceListingIdKind: 'tiny_id',
        validationState: 'valid',
        matchState: 'matched',
        watchState: 'not_required',
        reasonCode: 'source_identity_match',
        askingPrice: 487500,
        currency: 'EUR',
        submittedPropertyId: testPropertyId,
        matchedPropertyId: testPropertyId,
      });
      expect(body.title).toBe('Validated Funda listing');
      expect(body.description).toBe('Source-owned validation');
      expect(body.imageUrl).toBe('https://cdn.example.com/listing-preview.jpg');
      expect(mockFetchFn).toHaveBeenCalledTimes(2);
      expect(JSON.parse(String(mockFetchFn.mock.calls[0]?.[1]?.body))).toEqual({
        sourceName: 'funda',
        rawUrl: 'https://www.funda.nl/detail/koop/eindhoven/huis-listings-fixture/89779872/',
      });
      expect(JSON.parse(String(mockFetchFn.mock.calls[1]?.[1]?.body))).toMatchObject({
        sourceName: 'funda',
        sourceListingId: '89779872',
        sourceListingIdKind: 'tiny_id',
        property: {
          id: testPropertyId,
          countryCode: 'NL',
          street: 'Listings Fixture Street',
          postalCode: '9100AA',
          houseNumber: 1,
          houseNumberAddition: null,
          city: 'Listings City',
          latitude: 51.441,
          longitude: 5.471,
        },
      });
    });

    it('should use OG metadata when validation and request display are empty', async () => {
      const rawUrl = 'https://www.funda.nl/detail/koop/eindhoven/huis-og-fallback/90210011/';
      const canonicalUrl = 'https://www.funda.nl/detail/90210011/';

      mockFetchFn
        .mockResolvedValueOnce(jsonResponse({
          supported: true,
          sourceName: 'funda',
          rawUrl,
          canonicalUrl,
          sourceListingId: '90210011',
          sourceListingIdKind: 'tiny_id',
          aliases: [{ kind: 'tiny_id', value: '90210011' }],
          listingPath: '/detail/90210011/',
          reasonCode: null,
        }))
        .mockResolvedValueOnce(jsonResponse({
          state: 'retryable_error',
          sourceName: 'funda',
          rawUrl,
          canonicalUrl,
          sourceListingId: '90210011',
          sourceListingIdKind: 'tiny_id',
          aliases: [{ kind: 'tiny_id', value: '90210011' }],
        }))
        .mockResolvedValueOnce(htmlResponse(`
          <html>
            <head>
              <meta property="og:title" content="OG Fallback Title">
              <meta property="og:description" content="OG fallback description">
              <meta property="og:image" content="https://cdn.example.com/og-fallback.jpg">
            </head>
          </html>
        `));

      const response = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        payload: {
          url: rawUrl,
          propertyId: testPropertyId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        validationState: 'provisional',
        matchState: 'unverified',
        watchState: 'will_enqueue',
        reasonCode: 'mirror_unavailable',
        title: 'OG Fallback Title',
        description: 'OG fallback description',
        imageUrl: 'https://cdn.example.com/og-fallback.jpg',
      });
      expect(mockFetchFn).toHaveBeenCalledTimes(3);
      expect(String(mockFetchFn.mock.calls[2]?.[0])).toBe(canonicalUrl);
    });

    it('should keep request display ahead of OG fallback when validation has no display', async () => {
      const rawUrl = 'https://www.funda.nl/detail/koop/eindhoven/huis-request-display/90210013/';
      const canonicalUrl = 'https://www.funda.nl/detail/90210013/';

      mockFetchFn
        .mockResolvedValueOnce(jsonResponse({
          supported: true,
          sourceName: 'funda',
          rawUrl,
          canonicalUrl,
          sourceListingId: '90210013',
          sourceListingIdKind: 'tiny_id',
          aliases: [{ kind: 'tiny_id', value: '90210013' }],
          listingPath: '/detail/90210013/',
          reasonCode: null,
        }))
        .mockResolvedValueOnce(jsonResponse({
          state: 'retryable_error',
          sourceName: 'funda',
          rawUrl,
          canonicalUrl,
          sourceListingId: '90210013',
          sourceListingIdKind: 'tiny_id',
          aliases: [{ kind: 'tiny_id', value: '90210013' }],
        }));

      const response = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        payload: {
          url: rawUrl,
          propertyId: testPropertyId,
          title: 'Request title',
          description: 'Request description',
          imageUrl: 'https://cdn.example.com/request-display.jpg',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        title: 'Request title',
        description: 'Request description',
        imageUrl: 'https://cdn.example.com/request-display.jpg',
      });
      expect(mockFetchFn).toHaveBeenCalledTimes(2);
    });

    it('should return deterministic display fallback when OG metadata is unavailable', async () => {
      const rawUrl = 'https://www.funda.nl/detail/koop/eindhoven/huis-no-og/90210012/';

      mockFetchFn
        .mockResolvedValueOnce(jsonResponse({}, 503))
        .mockRejectedValueOnce(new Error('OG fetch unavailable'));

      const response = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        payload: {
          url: rawUrl,
          propertyId: testPropertyId,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        validationState: 'provisional',
        reasonCode: 'mirror_unavailable',
        title: 'Funda listing',
        description: 'Listing submitted from funda.nl',
        imageUrl: null,
      });
      expect(mockFetchFn).toHaveBeenCalledTimes(2);
    });

    it('should reject non-whitelisted URLs (SSRF protection)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        payload: {
          url: 'https://evil-site.com/listing',
          propertyId: testPropertyId,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('INVALID_URL');
    });

    it('should reject HTTP URLs (non-HTTPS)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/listings/preview',
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
        payload: {
          url: 'https://192.168.1.1/admin',
          propertyId: testPropertyId,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 404 for non-existent property', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        payload: {
          url: 'https://www.funda.nl/detail/koop/eindhoven/huis-89779872/89779872/',
          propertyId: '00000000-0000-0000-0000-000000000000',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should surface unsupported Pararius id-style URLs without calling validate', async () => {
      mockFetchFn.mockResolvedValueOnce(jsonResponse({
        supported: false,
        sourceName: 'pararius',
        rawUrl: 'https://www.pararius.com/87a48057',
        reasonCode: 'id_only_unsupported',
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        payload: {
          url: 'https://www.pararius.com/87a48057',
          propertyId: testPropertyId,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        sourceName: 'pararius',
        canonicalUrl: 'https://www.pararius.com/87a48057',
        sourceListingId: null,
        validationState: 'provisional',
        matchState: 'unsupported',
        watchState: 'unsupported',
        reasonCode: 'source_not_supported',
        title: 'Pararius listing',
        description: 'Listing submitted from pararius.com',
      });
      expect(mockFetchFn).toHaveBeenCalledTimes(2);
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
      expect(JSON.parse(response.body).error).toBe('INVALID_URL');
    });

    it('should return 404 for non-existent property', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          url: 'https://www.funda.nl/detail/koop/eindhoven/huis-88888/88888/',
          propertyId: '00000000-0000-0000-0000-000000000000',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should create a validated canonical listing without a watch for matched submissions', async () => {
      const thumbnailUrl = 'https://cdn.example.com/test-thumbnail.jpg';
      const submittedId = `${Date.now()}${Math.floor(Math.random() * 10000)}`.slice(0, 12);
      const submittedUrl = `https://www.funda.nl/detail/koop/eindhoven/huis-contract-test/${submittedId}/`;

      mockFetchFn
        .mockResolvedValueOnce(jsonResponse({
          supported: true,
          sourceName: 'funda',
          rawUrl: submittedUrl,
          canonicalUrl: `https://www.funda.nl/detail/${submittedId}/`,
          sourceListingId: submittedId,
          sourceListingIdKind: 'tiny_id',
          aliases: [
            { kind: 'tiny_id', value: submittedId },
            { kind: 'detail_id', value: submittedId },
          ],
          listingPath: `/detail/${submittedId}/`,
          reasonCode: null,
        }))
        .mockResolvedValueOnce(jsonResponse({
          state: 'matched',
          sourceName: 'funda',
          rawUrl: submittedUrl,
          canonicalUrl: `https://www.funda.nl/detail/${submittedId}/`,
          sourceListingId: submittedId,
          sourceListingIdKind: 'tiny_id',
          aliases: [
            { kind: 'tiny_id', value: submittedId },
            { kind: 'detail_id', value: submittedId },
          ],
          sourceStatus: 'available',
          matchedPropertyEvidence: {
            propertyId: testPropertyId,
            matchKind: 'source_exact',
          },
          thumbnailUrl,
          title: 'Contract test listing',
          price: 525000,
          currency: 'EUR',
        }));

      const response = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          url: submittedUrl,
          propertyId: testPropertyId,
          ogTitle: 'Contract test listing',
          thumbnailUrl,
        },
      });

      expect(response.statusCode).toBe(201);
      const created = JSON.parse(response.body);
      expect(created).toMatchObject({
        propertyId: testPropertyId,
        sourceName: 'funda',
        canonicalUrl: `https://www.funda.nl/detail/${submittedId}/`,
        sourceListingId: submittedId,
        verificationState: 'validated',
        watchState: 'not_required',
        watchId: null,
        reasonCode: 'source_identity_match',
      });

      const listingsResponse = await app.inject({
        method: 'GET',
        url: `/properties/${testPropertyId}/listings`,
      });

      expect(listingsResponse.statusCode).toBe(200);
      const listingsBody = JSON.parse(listingsResponse.body);
      const insertedListing = listingsBody.data.find((item: { id: string }) => item.id === created.id);
      expect(insertedListing).toBeDefined();
      expect(insertedListing.thumbnailUrl).toBe(thumbnailUrl);
      expect(insertedListing.verificationState).toBe('validated');

      const maintenanceIdempotencyKey = `listing-submit:${created.id}`;
      const [maintenanceRow] = await db
        .select()
        .from(ingestBatches)
        .where(eq(ingestBatches.idempotencyKey, maintenanceIdempotencyKey))
        .limit(1);

      expect(maintenanceRow).toBeDefined();
      expect(maintenanceRow?.status).toBe('completed');
      expect(maintenanceRow?.maintenanceRequestedAt).not.toBeNull();
      expect(maintenanceRow?.payloadJson).toMatchObject({
        requestedBy: 'listing-submit',
        canonicalListingId: created.id,
        propertyId: testPropertyId,
        sourceUrl: `https://www.funda.nl/detail/${submittedId}/`,
        sourceName: 'funda',
        sourceListingId: submittedId,
      });

      const [watch] = await db
        .select()
        .from(mirrorListingWatches)
        .where(eq(mirrorListingWatches.canonicalListingId, created.id))
        .limit(1);
      expect(watch).toBeUndefined();
    });

    it('should reject unsupported Pararius ID-only submissions', async () => {
      mockFetchFn.mockResolvedValueOnce(jsonResponse({
        supported: false,
        sourceName: 'pararius',
        rawUrl: 'https://www.pararius.com/87a48057',
        reasonCode: 'id_only_unsupported',
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          url: 'https://www.pararius.com/87a48057',
          propertyId: testPropertyId,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('LISTING_VALIDATION_FAILED');
    });

    it('should reject confirmed source mismatches without creating a canonical listing', async () => {
      const submittedId = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 12);
      const canonicalUrl = `https://www.funda.nl/detail/${submittedId}/`;

      mockFetchFn
        .mockResolvedValueOnce(jsonResponse({
          supported: true,
          sourceName: 'funda',
          rawUrl: `https://www.funda.nl/detail/koop/eindhoven/huis-mismatch/${submittedId}/`,
          canonicalUrl,
          sourceListingId: submittedId,
          sourceListingIdKind: 'tiny_id',
          aliases: [{ kind: 'tiny_id', value: submittedId }],
          listingPath: `/detail/${submittedId}/`,
          reasonCode: null,
        }))
        .mockResolvedValueOnce(jsonResponse({
          state: 'matched',
          sourceName: 'funda',
          rawUrl: `https://www.funda.nl/detail/koop/eindhoven/huis-mismatch/${submittedId}/`,
          canonicalUrl,
          sourceListingId: submittedId,
          sourceListingIdKind: 'tiny_id',
          aliases: [{ kind: 'tiny_id', value: submittedId }],
          sourceStatus: 'available',
          matchedPropertyEvidence: {
            propertyId: otherPropertyId,
            matchKind: 'source_mismatch',
          },
        }));

      const response = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          url: `https://www.funda.nl/detail/koop/eindhoven/huis-mismatch/${submittedId}/`,
          propertyId: testPropertyId,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toMatchObject({
        error: 'LISTING_VALIDATION_FAILED',
      });

      const [canonical] = await db
        .select()
        .from(canonicalListings)
        .where(eq(canonicalListings.canonicalUrl, canonicalUrl))
        .limit(1);
      expect(canonical).toBeUndefined();
    });

    it('should create a provisional listing and durable watch on temporary source failures', async () => {
      const rawUrl = 'https://www.pararius.com/apartment-for-rent/eindhoven/87a48057/kathodelaan';
      const canonicalUrl = rawUrl;
      const sourceListingId = '/apartment-for-rent/eindhoven/87a48057/kathodelaan';

      mockFetchFn
        .mockResolvedValueOnce(jsonResponse({
          supported: true,
          sourceName: 'pararius',
          rawUrl,
          canonicalUrl,
          sourceListingId,
          sourceListingIdKind: 'canonical_path',
          aliases: [{ kind: 'url_path', value: sourceListingId }],
          listingPath: sourceListingId,
          reasonCode: null,
        }))
        .mockResolvedValueOnce(jsonResponse({
          state: 'retryable_error',
          sourceName: 'pararius',
          rawUrl,
          canonicalUrl,
          sourceListingId,
          sourceListingIdKind: 'canonical_path',
          aliases: [{ kind: 'url_path', value: sourceListingId }],
        }));

      const response = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          url: rawUrl,
          propertyId: testPropertyId,
          ogTitle: 'Temporary failure listing',
        },
      });

      expect(response.statusCode).toBe(201);
      const created = JSON.parse(response.body);
      expect(created).toMatchObject({
        sourceName: 'pararius',
        canonicalUrl,
        sourceListingId,
        verificationState: 'provisional',
        watchState: 'will_enqueue',
        reasonCode: 'mirror_unavailable',
      });
      expect(created.watchId).toBeTruthy();

      const [watch] = await db
        .select()
        .from(mirrorListingWatches)
        .where(eq(mirrorListingWatches.id, created.watchId))
        .limit(1);
      expect(watch).toBeDefined();
      expect(watch?.state).toBe('queued');
      expect(watch?.sourceName).toBe('pararius');
      expect(watch?.sourceUrlCanonical).toBe(canonicalUrl);
    });

    it('should persist OG fallback display for provisional submissions', async () => {
      const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const rawUrl = `https://www.pararius.com/apartment-for-rent/eindhoven/${suffix}/og-submit`;
      const canonicalUrl = rawUrl;
      const sourceListingId = `/apartment-for-rent/eindhoven/${suffix}/og-submit`;

      mockFetchFn
        .mockResolvedValueOnce(jsonResponse({
          supported: true,
          sourceName: 'pararius',
          rawUrl,
          canonicalUrl,
          sourceListingId,
          sourceListingIdKind: 'canonical_path',
          aliases: [{ kind: 'url_path', value: sourceListingId }],
          listingPath: sourceListingId,
          reasonCode: null,
        }))
        .mockResolvedValueOnce(jsonResponse({
          state: 'retryable_error',
          sourceName: 'pararius',
          rawUrl,
          canonicalUrl,
          sourceListingId,
          sourceListingIdKind: 'canonical_path',
          aliases: [{ kind: 'url_path', value: sourceListingId }],
        }))
        .mockResolvedValueOnce(htmlResponse(`
          <html>
            <head>
              <meta property="og:title" content="Submitted OG title">
              <meta property="og:description" content="Submitted OG description">
              <meta property="og:image" content="https://cdn.example.com/submitted-og.jpg">
            </head>
          </html>
        `));

      const response = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          url: rawUrl,
          propertyId: testPropertyId,
        },
      });

      expect(response.statusCode).toBe(201);
      const created = JSON.parse(response.body);

      const listingsResponse = await app.inject({
        method: 'GET',
        url: `/properties/${testPropertyId}/listings`,
      });

      expect(listingsResponse.statusCode).toBe(200);
      const listingsBody = JSON.parse(listingsResponse.body);
      const insertedListing = listingsBody.data.find((item: { id: string }) => item.id === created.id);
      expect(insertedListing).toMatchObject({
        id: created.id,
        ogTitle: 'Submitted OG title',
        description: 'Submitted OG description',
        thumbnailUrl: 'https://cdn.example.com/submitted-og.jpg',
      });
      expect(mockFetchFn).toHaveBeenCalledTimes(3);
    });
  });

  describe('POST /api/ingest/listing-validation-outcomes', () => {
    it('should apply a matched validation callback to a provisional listing', async () => {
      const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const rawUrl = `https://www.pararius.com/apartment-for-rent/eindhoven/${suffix}/kathodelaan`;
      const canonicalUrl = rawUrl;
      const sourceListingId = `/apartment-for-rent/eindhoven/${suffix}/kathodelaan`;

      mockFetchFn
        .mockResolvedValueOnce(jsonResponse({
          supported: true,
          sourceName: 'pararius',
          rawUrl,
          canonicalUrl,
          sourceListingId,
          sourceListingIdKind: 'canonical_path',
          aliases: [{ kind: 'url_path', value: sourceListingId }],
          listingPath: sourceListingId,
          reasonCode: null,
        }))
        .mockResolvedValueOnce(jsonResponse({
          state: 'retryable_error',
          sourceName: 'pararius',
          rawUrl,
          canonicalUrl,
          sourceListingId,
          sourceListingIdKind: 'canonical_path',
          aliases: [{ kind: 'url_path', value: sourceListingId }],
        }));

      const submitResponse = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          url: rawUrl,
          propertyId: testPropertyId,
        },
      });

      expect(submitResponse.statusCode).toBe(201);
      const submitted = JSON.parse(submitResponse.body);
      expect(submitted.watchId).toBeTruthy();

      const outcomeResponse = await app.inject({
        method: 'POST',
        url: '/api/ingest/listing-validation-outcomes',
        headers: {
          'x-api-key': 'test-ingest-api-key',
        },
        payload: {
          watchId: submitted.watchId,
          state: 'matched',
          sourceName: 'pararius',
          rawUrl,
          canonicalUrl,
          sourceListingId,
          sourceListingIdKind: 'canonical_path',
          aliases: [{ kind: 'url_path', value: sourceListingId }],
          sourceStatus: 'available',
          matchedPropertyEvidence: {
            propertyId: testPropertyId,
            matchKind: 'source_exact',
          },
          price: 2100,
          currency: 'EUR',
          thumbnailUrl: 'https://cdn.example.com/pararius-thumb.jpg',
          title: 'Validated Pararius listing',
          description: 'Validated after callback',
        },
      });

      expect(outcomeResponse.statusCode).toBe(202);
      expect(JSON.parse(outcomeResponse.body)).toMatchObject({
        canonicalListingId: submitted.id,
        watchId: submitted.watchId,
        state: 'matched',
      });

      const listingsResponse = await app.inject({
        method: 'GET',
        url: `/properties/${testPropertyId}/listings`,
      });

      expect(listingsResponse.statusCode).toBe(200);
      const listingsBody = JSON.parse(listingsResponse.body);
      const updatedListing = listingsBody.data.find((item: { id: string }) => item.id === submitted.id);
      expect(updatedListing).toMatchObject({
        id: submitted.id,
        verificationState: 'validated',
        watchState: 'matched',
        reasonCode: null,
        thumbnailUrl: 'https://cdn.example.com/pararius-thumb.jpg',
      });
    });

    it('should retain the provisional reason when a validation callback is still retryable', async () => {
      const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const rawUrl = `https://www.pararius.com/apartment-for-rent/eindhoven/${suffix}/retryable`;
      const canonicalUrl = rawUrl;
      const sourceListingId = `/apartment-for-rent/eindhoven/${suffix}/retryable`;

      mockFetchFn
        .mockResolvedValueOnce(jsonResponse({
          supported: true,
          sourceName: 'pararius',
          rawUrl,
          canonicalUrl,
          sourceListingId,
          sourceListingIdKind: 'canonical_path',
          aliases: [{ kind: 'url_path', value: sourceListingId }],
          listingPath: sourceListingId,
          reasonCode: null,
        }))
        .mockResolvedValueOnce(jsonResponse({
          state: 'retryable_error',
          sourceName: 'pararius',
          rawUrl,
          canonicalUrl,
          sourceListingId,
          sourceListingIdKind: 'canonical_path',
          aliases: [{ kind: 'url_path', value: sourceListingId }],
        }));

      const submitResponse = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          url: rawUrl,
          propertyId: testPropertyId,
        },
      });

      expect(submitResponse.statusCode).toBe(201);
      const submitted = JSON.parse(submitResponse.body);
      expect(submitted.watchId).toBeTruthy();

      const outcomeResponse = await app.inject({
        method: 'POST',
        url: '/api/ingest/listing-validation-outcomes',
        headers: {
          'x-api-key': 'test-ingest-api-key',
        },
        payload: {
          watchId: submitted.watchId,
          state: 'retryable_error',
          sourceName: 'pararius',
          rawUrl,
          canonicalUrl,
          sourceListingId,
          sourceListingIdKind: 'canonical_path',
          aliases: [{ kind: 'url_path', value: sourceListingId }],
        },
      });

      expect(outcomeResponse.statusCode).toBe(202);

      const listingsResponse = await app.inject({
        method: 'GET',
        url: `/properties/${testPropertyId}/listings`,
      });

      expect(listingsResponse.statusCode).toBe(200);
      const listingsBody = JSON.parse(listingsResponse.body);
      const updatedListing = listingsBody.data.find((item: { id: string }) => item.id === submitted.id);
      expect(updatedListing).toMatchObject({
        id: submitted.id,
        verificationState: 'validation_pending',
        watchState: 'retryable_error',
        reasonCode: 'mirror_unavailable',
      });
    });

    it('should clear stale provisional reasons when a callback resolves to a terminal state', async () => {
      const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const rawUrl = `https://www.pararius.com/apartment-for-rent/eindhoven/${suffix}/not-found`;
      const canonicalUrl = rawUrl;
      const sourceListingId = `/apartment-for-rent/eindhoven/${suffix}/not-found`;

      mockFetchFn
        .mockResolvedValueOnce(jsonResponse({
          supported: true,
          sourceName: 'pararius',
          rawUrl,
          canonicalUrl,
          sourceListingId,
          sourceListingIdKind: 'canonical_path',
          aliases: [{ kind: 'url_path', value: sourceListingId }],
          listingPath: sourceListingId,
          reasonCode: null,
        }))
        .mockResolvedValueOnce(jsonResponse({
          state: 'retryable_error',
          sourceName: 'pararius',
          rawUrl,
          canonicalUrl,
          sourceListingId,
          sourceListingIdKind: 'canonical_path',
          aliases: [{ kind: 'url_path', value: sourceListingId }],
        }));

      const submitResponse = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          url: rawUrl,
          propertyId: testPropertyId,
        },
      });

      expect(submitResponse.statusCode).toBe(201);
      const submitted = JSON.parse(submitResponse.body);
      expect(submitted.watchId).toBeTruthy();

      const outcomeResponse = await app.inject({
        method: 'POST',
        url: '/api/ingest/listing-validation-outcomes',
        headers: {
          'x-api-key': 'test-ingest-api-key',
        },
        payload: {
          watchId: submitted.watchId,
          state: 'not_found',
          sourceName: 'pararius',
          rawUrl,
          canonicalUrl,
          sourceListingId,
          sourceListingIdKind: 'canonical_path',
          aliases: [{ kind: 'url_path', value: sourceListingId }],
          sourceStatus: 'not_found',
        },
      });

      expect(outcomeResponse.statusCode).toBe(202);

      const listingsResponse = await app.inject({
        method: 'GET',
        url: `/properties/${testPropertyId}/listings`,
      });

      expect(listingsResponse.statusCode).toBe(200);
      const listingsBody = JSON.parse(listingsResponse.body);
      const updatedListing = listingsBody.data.find((item: { id: string }) => item.id === submitted.id);
      expect(updatedListing).toMatchObject({
        id: submitted.id,
        verificationState: 'validated',
        watchState: 'not_found',
        reasonCode: null,
      });
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
          sourceName: 'funda',
          idempotencyKey: `unauthorized-${Date.now()}`,
          batchSequence: 0,
          cursorStart: null,
          cursorEnd: encodeOpaqueIngestCursor({
            changedAt: '2026-04-06T12:00:00.000Z',
            listingKey: 'listing-unauthorized',
          }),
          listings: [
            {
              sourceUrl: 'https://www.funda.nl/koop/eindhoven/huis-unauthorized/',
              mirrorListingId: `unauthorized-${Date.now()}`,
              askingPrice: 450000,
              priceType: 'sale',
              address: {
                countryCode: 'NL',
                street: 'Teststraat',
                postalCode: '1234 AB',
                houseNumber: 10,
                city: 'Eindhoven',
              },
            },
          ],
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
