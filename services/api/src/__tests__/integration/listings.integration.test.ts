import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import {
  db,
  ingestBatches,
  listings,
  propertyTileSnapshotRefreshState,
  propertyTileSnapshotWatermarks,
} from '../../db/index.js';
import {
  canonicalListings,
  listingCandidateHandoffs,
  listingObservations,
  listingPreviewResults,
  listingPriceObservations,
  priceHistory,
  users,
} from '../../db/schema.js';
import { and, eq, sql } from 'drizzle-orm';
import { acceptIngestBatch, encodeOpaqueIngestCursor, getIngestWatermark, processIngestBatch } from '../../services/ingest/index.js';
import {
  claimCandidateHandoff,
  processCandidateHandoffJob,
} from '../../services/candidate-handoffs/index.js';
import {
  createIntegrationListing,
  createIntegrationPriceHistory,
  createIntegrationProperty,
} from './helpers/fixtures.js';
import { PROPERTY_TILE_SNAPSHOT_KEY } from '../../services/property-tile-snapshots.js';

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

  async function createMatchedSubmissionFixture(label: string, askingPrice = 525000) {
    const sourceListingId = `${Date.now()}${Math.floor(Math.random() * 100_000)}`;
    const rawUrl = `https://www.funda.nl/detail/koop/eindhoven/huis-${label}/${sourceListingId}/`;
    const canonicalUrl = `https://www.funda.nl/detail/${sourceListingId}/`;
    const title = `Candidate handoff ${label}`;
    const thumbnailUrl = `https://cdn.example.com/${label}.jpg`;

    mockFetchFn
      .mockResolvedValueOnce(jsonResponse({
        supported: true,
        sourceName: 'funda',
        rawUrl,
        canonicalUrl,
        sourceListingId,
        sourceListingIdKind: 'tiny_id',
        aliases: [
          { kind: 'tiny_id', value: sourceListingId },
          { kind: 'detail_id', value: sourceListingId },
        ],
        listingPath: `/detail/${sourceListingId}/`,
        reasonCode: null,
      }))
      .mockResolvedValueOnce(jsonResponse({
        state: 'matched',
        sourceName: 'funda',
        rawUrl,
        canonicalUrl,
        sourceListingId,
        sourceListingIdKind: 'tiny_id',
        aliases: [
          { kind: 'tiny_id', value: sourceListingId },
          { kind: 'detail_id', value: sourceListingId },
        ],
        sourceStatus: 'available',
        matchedPropertyEvidence: {
          propertyId: testPropertyId,
          matchKind: 'source_exact',
        },
        thumbnailUrl,
        title,
        price: askingPrice,
        currency: 'EUR',
      }));

    const previewResponse = await app.inject({
      method: 'POST',
      url: '/listings/preview',
      payload: {
        url: rawUrl,
        propertyId: testPropertyId,
      },
    });
    expect(previewResponse.statusCode).toBe(200);
    const preview = JSON.parse(previewResponse.body) as {
      previewId: string;
      previewToken: string;
    };

    const submitResponse = await app.inject({
      method: 'POST',
      url: '/listings/submit',
      headers: {
        authorization: `Bearer ${testAccessToken}`,
      },
      payload: {
        previewToken: preview.previewToken,
      },
    });
    expect(submitResponse.statusCode).toBe(201);
    const submitted = JSON.parse(submitResponse.body) as {
      id: string;
      candidateId: string;
    };

    mockFetchFn.mockReset();
    return {
      candidateId: submitted.candidateId,
      canonicalListingId: submitted.id,
      previewId: preview.previewId,
      sourceListingId,
      rawUrl,
      canonicalUrl,
      title,
      thumbnailUrl,
      askingPrice,
    };
  }

  async function seedProjectedRentPriceArtifact(input: {
    canonicalListingId: string;
    propertyId: string;
    sourceListingId: string;
    sourceUrlCanonical: string;
    price: number;
    priceDate: string;
  }) {
    const observedAt = new Date(`${input.priceDate}T10:00:00.000Z`);
    const [observation] = await db
      .insert(listingObservations)
      .values({
        sourceName: 'funda',
        sourceListingId: `${input.sourceListingId}-rent-artifact-${input.price}`,
        sourceListingIdKind: 'tiny_id',
        sourceUrlRaw: input.sourceUrlCanonical,
        sourceUrlCanonical: input.sourceUrlCanonical,
        origin: 'mirror',
        propertyId: input.propertyId,
        propertyMatchKind: 'source_exact',
        sourceStatus: 'rented',
        askingPrice: input.price,
        priceCurrency: 'EUR',
        observedAt,
      })
      .returning();
    if (!observation) throw new Error('Failed to seed rent listing observation');

    await db
      .insert(listingPriceObservations)
      .values({
        listingObservationId: observation.id,
        canonicalListingId: input.canonicalListingId,
        propertyId: input.propertyId,
        sourceName: 'funda',
        sourceListingId: observation.sourceListingId,
        origin: 'mirror',
        price: input.price,
        currency: 'EUR',
        eventType: 'status_change',
        priceDate: input.priceDate,
        observedAt,
      });

    await db
      .insert(priceHistory)
      .values({
        propertyId: input.propertyId,
        listingId: null,
        price: input.price,
        priceDate: input.priceDate,
        eventType: 'rented',
        source: 'funda',
      })
      .onConflictDoNothing();
  }

  async function readPropertyTileSnapshotInvalidationState() {
    const [watermark] = await db
      .select()
      .from(propertyTileSnapshotWatermarks)
      .where(eq(propertyTileSnapshotWatermarks.key, PROPERTY_TILE_SNAPSHOT_KEY))
      .limit(1);
    const [refreshState] = await db
      .select()
      .from(propertyTileSnapshotRefreshState)
      .where(eq(propertyTileSnapshotRefreshState.key, PROPERTY_TILE_SNAPSHOT_KEY))
      .limit(1);

    return {
      listingWatermark: watermark?.listingWatermark ?? 0n,
      propertyWatermark: watermark?.propertyWatermark ?? 0n,
      refreshState: refreshState ?? null,
    };
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
        await db.execute(sql`DELETE FROM listing_candidate_handoffs WHERE property_id = ${propertyId}`);
        await db.execute(sql`DELETE FROM listing_preview_results WHERE property_id = ${propertyId}`);
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
    try {
      await db.execute(sql`DELETE FROM ingest_sources WHERE source_name = 'funda'`);
      await db.execute(sql`
        DELETE FROM ingest_batches
        WHERE source_name = 'funda'
          AND (
            idempotency_key LIKE 'funda-promotion-%'
            OR idempotency_key LIKE 'funda-diagnostic-pushback-%'
            OR idempotency_key LIKE 'funda-source-candidate-%'
            OR idempotency_key LIKE 'funda-addressless-candidate-outcomes-%'
            OR idempotency_key LIKE 'funda-existing-scraper-%'
            OR idempotency_key LIKE 'listing-submit:%'
          )
      `);
      await db.execute(sql`
        DELETE FROM ingest_runs
        WHERE source_name = 'funda'
          AND (
            upstream_run_key LIKE 'funda-promotion-run-%'
            OR upstream_run_key LIKE 'funda-diagnostic-pushback-run-%'
            OR upstream_run_key LIKE 'funda-source-candidate-run-%'
            OR upstream_run_key LIKE 'funda-addressless-candidate-outcomes-run-%'
            OR upstream_run_key LIKE 'funda-existing-scraper-run-%'
          )
      `);
    } catch {
      // Ignore cleanup errors
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
        expect(listing).toHaveProperty('propertyId', testPropertyId);
        expect(listing).toHaveProperty('sourceUrl');
        expect(listing).toHaveProperty('displayUrl');
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
        handoffState: 'will_create',
        reasonCode: 'source_identity_match',
        askingPrice: 487500,
        currency: 'EUR',
        submittedPropertyId: testPropertyId,
        matchedPropertyId: testPropertyId,
      });
      expect(body.title).toBe('Validated Funda listing');
      expect(body.description).toBe('Source-owned validation');
      expect(body.imageUrl).toBe('https://cdn.example.com/listing-preview.jpg');
      expect(typeof body.previewToken).toBe('string');
      expect(body.previewToken.length).toBeGreaterThan(32);
      expect(body.previewId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      const [storedPreview] = await db
        .select()
        .from(listingPreviewResults)
        .where(eq(listingPreviewResults.id, body.previewId))
        .limit(1);
      expect(storedPreview).toMatchObject({
        sourceName: 'funda',
        propertyId: testPropertyId,
        sourceUrlCanonical: 'https://www.funda.nl/detail/89779872/',
        sourceListingId: '89779872',
        validationState: 'valid',
        matchState: 'matched',
        reasonCode: 'source_identity_match',
      });
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

    it('should use deterministic display fallback instead of fetching OG metadata', async () => {
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
          state: 'matched',
          sourceName: 'funda',
          rawUrl,
          canonicalUrl,
          sourceListingId: '90210011',
          sourceListingIdKind: 'tiny_id',
          aliases: [{ kind: 'tiny_id', value: '90210011' }],
          sourceStatus: 'available',
          matchedPropertyEvidence: {
            propertyId: testPropertyId,
            matchKind: 'source_exact',
          },
        }));

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
        title: 'Funda listing',
        description: 'Listing submitted from funda.nl',
        imageUrl: null,
      });
      expect(mockFetchFn).toHaveBeenCalledTimes(2);
      expect(mockFetchFn.mock.calls.map((call) => String(call[0]))).not.toContain(canonicalUrl);
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
        validationState: 'provisional',
        matchState: 'unverified',
        handoffState: 'will_create',
        reasonCode: 'mirror_unavailable',
        title: 'Request title',
        description: 'Request description',
        imageUrl: 'https://cdn.example.com/request-display.jpg',
      });
      expect(mockFetchFn).toHaveBeenCalledTimes(2);
    });

    it('should not fetch OG metadata when source-service resolution fails', async () => {
      const rawUrl = 'https://www.funda.nl/detail/koop/eindhoven/huis-no-og/90210012/';

      mockFetchFn.mockResolvedValueOnce(jsonResponse({}, 503));

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
        matchState: 'unverified',
        handoffState: 'will_create',
        reasonCode: 'mirror_unavailable',
        title: 'Funda listing',
        description: 'Listing submitted from funda.nl',
      });
      expect(mockFetchFn).toHaveBeenCalledTimes(1);
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

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toMatchObject({
        error: 'LISTING_VALIDATION_FAILED',
        message: 'Listing validation failed: source_not_supported',
      });
      expect(mockFetchFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /listings/submit', () => {
    it('should reject unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        payload: {
          previewToken: 'a'.repeat(48),
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject invalid preview tokens', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          previewToken: 'a'.repeat(48),
        },
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('INVALID_PREVIEW_TOKEN');
    });

    it('should reject tampered preview tokens after preview succeeds', async () => {
      const submittedId = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 12);
      const submittedUrl = `https://www.funda.nl/detail/koop/eindhoven/huis-token-test/${submittedId}/`;
      const canonicalUrl = `https://www.funda.nl/detail/${submittedId}/`;

      mockFetchFn
        .mockResolvedValueOnce(jsonResponse({
          supported: true,
          sourceName: 'funda',
          rawUrl: submittedUrl,
          canonicalUrl,
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
          canonicalUrl,
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
          title: 'Tampered preview token listing',
        }));

      const previewResponse = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        payload: {
          url: submittedUrl,
          propertyId: testPropertyId,
          title: 'Tampered preview token listing',
        },
      });

      expect(previewResponse.statusCode).toBe(200);
      const preview = JSON.parse(previewResponse.body);
      const tamperedPreviewToken = `${preview.previewToken.slice(0, -1)}${
        preview.previewToken.endsWith('a') ? 'b' : 'a'
      }`;
      mockFetchFn.mockReset();

      const response = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          previewToken: tamperedPreviewToken,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('INVALID_PREVIEW_TOKEN');
      expect(mockFetchFn).not.toHaveBeenCalled();
    });

    it('should bind authenticated preview tokens to the previewing user', async () => {
      const uniqueId = `listowner${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const authResp = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: {
          idToken: `mock-google-${uniqueId}-gid${uniqueId}`,
        },
      });
      const authBody = JSON.parse(authResp.body);
      const otherAccessToken = authBody.session.accessToken;
      testUserIds.push(authBody.session.user.id);

      const submittedId = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 12);
      const submittedUrl = `https://www.funda.nl/detail/koop/eindhoven/huis-token-owner/${submittedId}/`;
      const canonicalUrl = `https://www.funda.nl/detail/${submittedId}/`;

      mockFetchFn
        .mockResolvedValueOnce(jsonResponse({
          supported: true,
          sourceName: 'funda',
          rawUrl: submittedUrl,
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
          rawUrl: submittedUrl,
          canonicalUrl,
          sourceListingId: submittedId,
          sourceListingIdKind: 'tiny_id',
          aliases: [{ kind: 'tiny_id', value: submittedId }],
          sourceStatus: 'available',
          matchedPropertyEvidence: {
            propertyId: testPropertyId,
            matchKind: 'source_exact',
          },
          title: 'Owner-bound preview listing',
        }));

      const previewResponse = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          url: submittedUrl,
          propertyId: testPropertyId,
        },
      });
      expect(previewResponse.statusCode).toBe(200);
      const preview = JSON.parse(previewResponse.body);

      const wrongUserSubmit = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${otherAccessToken}`,
        },
        payload: {
          previewToken: preview.previewToken,
        },
      });
      expect(wrongUserSubmit.statusCode).toBe(400);
      expect(JSON.parse(wrongUserSubmit.body).error).toBe('INVALID_PREVIEW_TOKEN');

      const ownerSubmit = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          previewToken: preview.previewToken,
        },
      });
      expect(ownerSubmit.statusCode).toBe(201);
    });

    it('should reject legacy submit payloads without revalidating a URL', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          url: 'https://www.funda.nl/detail/koop/eindhoven/huis-88888/88888/',
          propertyId: testPropertyId,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).not.toBe('INVALID_URL');
      expect(mockFetchFn).not.toHaveBeenCalled();
    });

    it('should not reopen a consumed preview when the same preview facts are requested again', async () => {
      const submittedId = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 12);
      const submittedUrl = `https://www.funda.nl/detail/koop/eindhoven/huis-consumed-preview/${submittedId}/`;
      const canonicalUrl = `https://www.funda.nl/detail/${submittedId}/`;
      const sourceResolution = {
        supported: true,
        sourceName: 'funda',
        rawUrl: submittedUrl,
        canonicalUrl,
        sourceListingId: submittedId,
        sourceListingIdKind: 'tiny_id',
        aliases: [{ kind: 'tiny_id', value: submittedId }],
        listingPath: `/detail/${submittedId}/`,
        reasonCode: null,
      };
      const sourceValidation = {
        state: 'matched',
        sourceName: 'funda',
        rawUrl: submittedUrl,
        canonicalUrl,
        sourceListingId: submittedId,
        sourceListingIdKind: 'tiny_id',
        aliases: [{ kind: 'tiny_id', value: submittedId }],
        sourceStatus: 'available',
        matchedPropertyEvidence: {
          propertyId: testPropertyId,
          matchKind: 'source_exact',
        },
        title: 'Consumed preview listing',
      };

      mockFetchFn
        .mockResolvedValueOnce(jsonResponse(sourceResolution))
        .mockResolvedValueOnce(jsonResponse(sourceValidation));

      const firstPreviewResponse = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        payload: {
          url: submittedUrl,
          propertyId: testPropertyId,
        },
      });
      expect(firstPreviewResponse.statusCode).toBe(200);
      const firstPreview = JSON.parse(firstPreviewResponse.body);

      const submitResponse = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          previewToken: firstPreview.previewToken,
        },
      });
      expect(submitResponse.statusCode).toBe(201);

      const [consumedBefore] = await db
        .select()
        .from(listingPreviewResults)
        .where(eq(listingPreviewResults.id, firstPreview.previewId))
        .limit(1);
      expect(consumedBefore?.consumedAt).not.toBeNull();

      mockFetchFn
        .mockResolvedValueOnce(jsonResponse(sourceResolution))
        .mockResolvedValueOnce(jsonResponse(sourceValidation));

      const secondPreviewResponse = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        payload: {
          url: submittedUrl,
          propertyId: testPropertyId,
        },
      });
      expect(secondPreviewResponse.statusCode).toBe(200);
      const secondPreview = JSON.parse(secondPreviewResponse.body);
      expect(secondPreview.previewId).not.toBe(firstPreview.previewId);

      const [consumedAfter] = await db
        .select()
        .from(listingPreviewResults)
        .where(eq(listingPreviewResults.id, firstPreview.previewId))
        .limit(1);
      expect(consumedAfter?.consumedAt?.toISOString()).toBe(consumedBefore?.consumedAt?.toISOString());
      expect(consumedAfter?.tokenHash).toBe(consumedBefore?.tokenHash);
    });

    it('should bind submit to the exact stored preview facts after preview facts change', async () => {
      const submittedId = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 12);
      const submittedUrl = `https://www.funda.nl/detail/koop/eindhoven/huis-preview-facts/${submittedId}/`;
      const canonicalUrl = `https://www.funda.nl/detail/${submittedId}/`;

      for (const title of ['Original source title', 'Updated source title']) {
        mockFetchFn
          .mockResolvedValueOnce(jsonResponse({
            supported: true,
            sourceName: 'funda',
            rawUrl: submittedUrl,
            canonicalUrl,
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
            canonicalUrl,
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
            title,
            description: `${title} description`,
            thumbnailUrl: `https://cdn.example.com/${submittedId}-${title.startsWith('Original') ? 'old' : 'new'}.jpg`,
            price: 525000,
            currency: 'EUR',
          }));
      }

      const firstPreviewResponse = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        payload: {
          url: submittedUrl,
          propertyId: testPropertyId,
        },
      });
      expect(firstPreviewResponse.statusCode).toBe(200);
      const firstPreview = JSON.parse(firstPreviewResponse.body);

      const secondPreviewResponse = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        payload: {
          url: submittedUrl,
          propertyId: testPropertyId,
        },
      });
      expect(secondPreviewResponse.statusCode).toBe(200);
      const secondPreview = JSON.parse(secondPreviewResponse.body);
      expect(secondPreview.previewId).not.toBe(firstPreview.previewId);
      expect(secondPreview.title).toBe('Updated source title');

      mockFetchFn.mockReset();
      const submitResponse = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          previewToken: secondPreview.previewToken,
        },
      });

      expect(submitResponse.statusCode).toBe(201);
      expect(mockFetchFn).not.toHaveBeenCalled();
      const submitted = JSON.parse(submitResponse.body);
      const listingsResponse = await app.inject({
        method: 'GET',
        url: `/properties/${testPropertyId}/listings`,
      });
      const listingsBody = JSON.parse(listingsResponse.body);
      const insertedListing = listingsBody.data.find((item: { id: string }) => item.id === submitted.id);
      expect(insertedListing).toMatchObject({
        ogTitle: 'Updated source title',
        description: 'Updated source title description',
        thumbnailUrl: `https://cdn.example.com/${submittedId}-new.jpg`,
      });
    });

    it('should create a validated canonical listing with candidate handoff for matched submissions', async () => {
      const thumbnailUrl = 'https://cdn.example.com/test-thumbnail.jpg';
      const submittedId = `${Date.now()}${Math.floor(Math.random() * 10000)}`.slice(0, 12);
      const submittedUrl = `https://www.funda.nl/detail/koop/eindhoven/huis-contract-test/${submittedId}/`;
      const snapshotStateBefore = await readPropertyTileSnapshotInvalidationState();

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

      const previewResponse = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        payload: {
          url: submittedUrl,
          propertyId: testPropertyId,
          title: 'Contract test listing',
          imageUrl: thumbnailUrl,
        },
      });
      expect(previewResponse.statusCode).toBe(200);
      const preview = JSON.parse(previewResponse.body);
      const [storedPreview] = await db
        .select()
        .from(listingPreviewResults)
        .where(eq(listingPreviewResults.id, preview.previewId))
        .limit(1);
      expect(storedPreview).toMatchObject({
        sourceName: 'funda',
        propertyId: testPropertyId,
        sourceListingId: submittedId,
        validationState: 'valid',
        matchState: 'matched',
        consumedAt: null,
      });
      mockFetchFn.mockReset();

      const response = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          previewToken: preview.previewToken,
        },
      });

      expect(response.statusCode).toBe(201);
      expect(mockFetchFn).not.toHaveBeenCalled();
      const created = JSON.parse(response.body);
      expect(created).toMatchObject({
        propertyId: testPropertyId,
        sourceName: 'funda',
        canonicalUrl: `https://www.funda.nl/detail/${submittedId}/`,
        sourceListingId: submittedId,
        verificationState: 'provisional',
        candidateHandoffState: 'queued',
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
      expect(insertedListing.verificationState).toBe('provisional');

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

      const snapshotStateAfter = await readPropertyTileSnapshotInvalidationState();
      expect(snapshotStateAfter.listingWatermark > snapshotStateBefore.listingWatermark).toBe(true);
      expect(snapshotStateAfter.propertyWatermark > snapshotStateBefore.propertyWatermark).toBe(true);
      expect(snapshotStateAfter.refreshState).toMatchObject({
        requestReason: 'listing-submit',
        requestedListingWatermark: snapshotStateAfter.listingWatermark,
        requestedPropertyWatermark: snapshotStateAfter.propertyWatermark,
      });

      const [handoff] = await db
        .select()
        .from(listingCandidateHandoffs)
        .where(eq(listingCandidateHandoffs.id, created.candidateId))
        .limit(1);
      expect(handoff).toMatchObject({
        id: created.candidateId,
        canonicalListingId: created.id,
        previewResultId: preview.previewId,
        sourceName: 'funda',
        propertyId: testPropertyId,
        sourceUrlCanonical: `https://www.funda.nl/detail/${submittedId}/`,
        sourceListingId: submittedId,
        state: 'queued',
      });

      const mirrorCursor = encodeOpaqueIngestCursor({
        changedAt: '2026-04-07T10:00:00.000Z',
        listingKey: `funda-promotion-${submittedId}`,
      });
      const watermark = await getIngestWatermark('funda');
      const acceptedMirror = await acceptIngestBatch({
        sourceName: 'funda',
        idempotencyKey: `funda-promotion-${submittedId}`,
        batchSequence: 0,
        cursorStart: watermark.cursor,
        cursorEnd: mirrorCursor,
        upstreamRunKey: `funda-promotion-run-${submittedId}`,
        listings: [
          {
            sourceUrl: submittedUrl,
            mirrorListingId: submittedId,
            previewResultId: preview.previewId,
            sourceListingId: submittedId,
            sourceListingIdKind: 'tiny_id',
            sourceListingAliases: [
              { kind: 'tiny_id', value: submittedId },
              { kind: 'detail_id', value: submittedId },
            ],
            canonicalUrl: `https://www.funda.nl/detail/${submittedId}/`,
            askingPrice: 530000,
            priceType: 'sale',
            status: 'active',
            sourceStatus: 'available',
            ogTitle: 'Mirror promoted listing',
            thumbnailUrl,
            mirrorFirstSeenAt: '2026-04-07T09:00:00.000Z',
            mirrorLastChangedAt: '2026-04-07T10:00:00.000Z',
            mirrorLastSeenAt: '2026-04-07T10:05:00.000Z',
            address: {
              countryCode: 'NL',
              street: 'Listings Fixture Street',
              postalCode: '9100AA',
              houseNumber: 1,
              city: 'Listings City',
              latitude: 51.441,
              longitude: 5.471,
            },
          },
        ],
      });

      await expect(
        processIngestBatch({
          batchId: acceptedMirror.batchId,
          enqueueMaintenanceRefresh: async () => {},
        }),
      ).resolves.toMatchObject({
        status: 'completed',
      });

      const [promotedCanonical] = await db
        .select()
        .from(canonicalListings)
        .where(eq(canonicalListings.id, created.id))
        .limit(1);
      expect(promotedCanonical).toMatchObject({
        verificationState: 'validated',
        originSummary: 'user_and_mirror',
        askingPrice: 530000,
        title: 'Mirror promoted listing',
      });

      const [deliveredHandoff] = await db
        .select()
        .from(listingCandidateHandoffs)
        .where(eq(listingCandidateHandoffs.id, created.candidateId))
        .limit(1);
      expect(deliveredHandoff).toMatchObject({
        state: 'delivered',
        canonicalListingId: created.id,
      });
      expect(deliveredHandoff?.observationId).toBeTruthy();
    });

    it('should reject unsupported Pararius ID-only previews before submission', async () => {
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
        url: '/listings/preview',
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

    it('should create a provisional listing and queued candidate for temporary source failures', async () => {
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

      const previewResponse = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        payload: {
          url: rawUrl,
          propertyId: testPropertyId,
          title: 'Temporary failure listing',
        },
      });
      expect(previewResponse.statusCode).toBe(200);
      const preview = JSON.parse(previewResponse.body);
      expect(preview).toMatchObject({
        validationState: 'provisional',
        matchState: 'unverified',
        handoffState: 'will_create',
        reasonCode: 'mirror_unavailable',
        title: 'Temporary failure listing',
      });

      const submitResponse = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          previewToken: preview.previewToken,
        },
      });

      expect(submitResponse.statusCode).toBe(201);
      const submitted = JSON.parse(submitResponse.body);
      expect(submitted).toMatchObject({
        propertyId: testPropertyId,
        sourceName: 'pararius',
        canonicalUrl,
        sourceListingId,
        verificationState: 'provisional',
        candidateHandoffState: 'queued',
        reasonCode: 'mirror_unavailable',
      });

      const [handoff] = await db
        .select()
        .from(listingCandidateHandoffs)
        .where(eq(listingCandidateHandoffs.sourceUrlCanonical, canonicalUrl))
        .limit(1);
      expect(handoff).toMatchObject({
        id: submitted.candidateId,
        previewResultId: preview.previewId,
        state: 'queued',
      });

      const [observation] = await db
        .select()
        .from(listingObservations)
        .where(eq(listingObservations.previewResultId, preview.previewId))
        .limit(1);
      expect(observation?.payload).toMatchObject({
        preview: expect.objectContaining({ sourceProvenance: 'user_submitted' }),
      });

      const listingsResponse = await app.inject({
        method: 'GET',
        url: `/properties/${testPropertyId}/listings`,
      });
      expect(listingsResponse.statusCode).toBe(200);
      const listingsBody = JSON.parse(listingsResponse.body);
      expect(listingsBody.data).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: submitted.id,
          verificationState: 'provisional',
          candidateHandoffState: 'queued',
        }),
      ]));
    });

    it('should avoid app-owned OG fetch for provisional temporary failure previews', async () => {
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
        }));

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
        matchState: 'unverified',
        reasonCode: 'mirror_unavailable',
        title: 'Pararius listing',
        description: 'Listing submitted from pararius.com',
      });
      expect(mockFetchFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('candidate handoff source-truth guardrails', () => {
    it('delivers submitted candidates to the source service and does not reprocess final handoffs', async () => {
      const fixture = await createMatchedSubmissionFixture('delivery');

      mockFetchFn.mockResolvedValueOnce(jsonResponse({ state: 'queued', created: true }, 202));

      const result = await processCandidateHandoffJob({
        handoffId: fixture.candidateId,
      });

      expect(result).toMatchObject({
        status: 'delivered',
        handoffId: fixture.candidateId,
        sourceName: 'funda',
        attemptCount: 1,
      });
      expect(mockFetchFn).toHaveBeenCalledTimes(1);
      expect(String(mockFetchFn.mock.calls[0]?.[0])).toContain('/api/v1/listings/candidates');
      const deliveredBody = JSON.parse(String(mockFetchFn.mock.calls[0]?.[1]?.body));
      expect(deliveredBody).toMatchObject({
        rawUrl: fixture.rawUrl,
        canonicalUrl: fixture.canonicalUrl,
        sourceListingId: fixture.sourceListingId,
        sourceCandidateId: fixture.candidateId,
        huishypePreviewId: fixture.previewId,
        huishypePropertyId: testPropertyId,
        listingType: 'unknown',
        previewFacts: {
          price: 525000,
          currency: 'EUR',
          title: fixture.title,
          thumbnailUrl: fixture.thumbnailUrl,
        },
        matchEvidence: {
          propertyId: testPropertyId,
          propertyMatchKind: 'source_exact',
          sourceListingAliases: [
            { kind: 'tiny_id', value: fixture.sourceListingId },
            { kind: 'detail_id', value: fixture.sourceListingId },
          ],
        },
        aliases: [
          { kind: 'tiny_id', value: fixture.sourceListingId },
          { kind: 'detail_id', value: fixture.sourceListingId },
        ],
      });

      const [persistedHandoff] = await db
        .select()
        .from(listingCandidateHandoffs)
        .where(eq(listingCandidateHandoffs.id, fixture.candidateId))
        .limit(1);
      expect(persistedHandoff).toMatchObject({
        state: 'delivered',
        attemptCount: 1,
        nextAttemptAt: null,
        lastError: null,
      });

      mockFetchFn.mockReset();
      await expect(processCandidateHandoffJob({ handoffId: fixture.candidateId })).resolves.toMatchObject({
        status: 'noop',
        handoffId: fixture.candidateId,
      });
      expect(mockFetchFn).not.toHaveBeenCalled();
    });

    it('schedules a retry when candidate delivery gets a retryable source-service failure', async () => {
      const fixture = await createMatchedSubmissionFixture('retry');

      mockFetchFn.mockResolvedValueOnce(jsonResponse({ error: 'temporarily unavailable' }, 503));

      const result = await processCandidateHandoffJob({
        handoffId: fixture.candidateId,
      });

      expect(result).toMatchObject({
        status: 'retryable_error',
        handoffId: fixture.candidateId,
        sourceName: 'funda',
        attemptCount: 1,
      });

      const [persistedHandoff] = await db
        .select()
        .from(listingCandidateHandoffs)
        .where(eq(listingCandidateHandoffs.id, fixture.candidateId))
        .limit(1);
      expect(persistedHandoff).toMatchObject({
        state: 'retryable_error',
        attemptCount: 1,
      });
      expect(persistedHandoff?.lastError).toContain('returned 503');
      expect(persistedHandoff?.nextAttemptAt).toBeInstanceOf(Date);

      mockFetchFn.mockReset();
      await expect(processCandidateHandoffJob({ handoffId: fixture.candidateId })).resolves.toMatchObject({
        status: 'noop',
        handoffId: fixture.candidateId,
      });
      expect(mockFetchFn).not.toHaveBeenCalled();
    });

    it('does not double-claim a queued candidate handoff across concurrent claimers', async () => {
      const fixture = await createMatchedSubmissionFixture('concurrent');

      const claims = await Promise.all([
        claimCandidateHandoff(fixture.candidateId),
        claimCandidateHandoff(fixture.candidateId),
      ]);

      const claimedHandoffIds = claims
        .filter((claim): claim is NonNullable<typeof claim> => claim !== null)
        .map((claim) => claim.id);
      expect(claimedHandoffIds).toEqual([fixture.candidateId]);

      const [persistedHandoff] = await db
        .select()
        .from(listingCandidateHandoffs)
        .where(eq(listingCandidateHandoffs.id, fixture.candidateId))
        .limit(1);
      expect(persistedHandoff).toMatchObject({
        state: 'pending',
        attemptCount: 1,
      });
    });

    it('keeps repeated user submissions idempotent for active candidate handoffs and visible listings', async () => {
      const fixture = await createMatchedSubmissionFixture('repeat-submit');

      mockFetchFn
        .mockResolvedValueOnce(jsonResponse({
          supported: true,
          sourceName: 'funda',
          rawUrl: fixture.rawUrl,
          canonicalUrl: fixture.canonicalUrl,
          sourceListingId: fixture.sourceListingId,
          sourceListingIdKind: 'tiny_id',
          aliases: [
            { kind: 'tiny_id', value: fixture.sourceListingId },
            { kind: 'detail_id', value: fixture.sourceListingId },
          ],
          listingPath: `/detail/${fixture.sourceListingId}/`,
          reasonCode: null,
        }))
        .mockResolvedValueOnce(jsonResponse({
          state: 'matched',
          sourceName: 'funda',
          rawUrl: fixture.rawUrl,
          canonicalUrl: fixture.canonicalUrl,
          sourceListingId: fixture.sourceListingId,
          sourceListingIdKind: 'tiny_id',
          aliases: [
            { kind: 'tiny_id', value: fixture.sourceListingId },
            { kind: 'detail_id', value: fixture.sourceListingId },
          ],
          sourceStatus: 'available',
          matchedPropertyEvidence: {
            propertyId: testPropertyId,
            matchKind: 'source_exact',
          },
          thumbnailUrl: fixture.thumbnailUrl,
          title: fixture.title,
          price: 525000,
          currency: 'EUR',
        }));

      const previewResponse = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        payload: {
          url: fixture.rawUrl,
          propertyId: testPropertyId,
        },
      });
      expect(previewResponse.statusCode).toBe(200);
      const preview = JSON.parse(previewResponse.body) as { previewToken: string };

      const submitResponse = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          previewToken: preview.previewToken,
        },
      });

      expect(submitResponse.statusCode).toBe(201);
      const repeatedSubmission = JSON.parse(submitResponse.body) as { id: string; candidateId: string };
      expect(repeatedSubmission.id).toBe(fixture.canonicalListingId);
      expect(repeatedSubmission.candidateId).toBe(fixture.candidateId);

      const handoffs = await db
        .select()
        .from(listingCandidateHandoffs)
        .where(eq(listingCandidateHandoffs.sourceUrlCanonical, fixture.canonicalUrl));
      expect(handoffs).toHaveLength(1);

      const listingsResponse = await app.inject({
        method: 'GET',
        url: `/properties/${testPropertyId}/listings`,
      });
      expect(listingsResponse.statusCode).toBe(200);
      const listingsBody = JSON.parse(listingsResponse.body);
      const visibleRows = listingsBody.data.filter((item: { id: string }) => item.id === fixture.canonicalListingId);
      expect(visibleRows).toHaveLength(1);
      expect(visibleRows[0]).toMatchObject({
        candidateHandoffState: 'queued',
      });
    });

    it('keeps repeated user submissions idempotent after a candidate handoff is delivered', async () => {
      const fixture = await createMatchedSubmissionFixture('repeat-submit-delivered');

      mockFetchFn.mockResolvedValueOnce(jsonResponse({ state: 'queued', created: true }, 202));
      await expect(processCandidateHandoffJob({ handoffId: fixture.candidateId })).resolves.toMatchObject({
        status: 'delivered',
        handoffId: fixture.candidateId,
      });

      mockFetchFn.mockReset();
      mockFetchFn
        .mockResolvedValueOnce(jsonResponse({
          supported: true,
          sourceName: 'funda',
          rawUrl: fixture.rawUrl,
          canonicalUrl: fixture.canonicalUrl,
          sourceListingId: fixture.sourceListingId,
          sourceListingIdKind: 'tiny_id',
          aliases: [
            { kind: 'tiny_id', value: fixture.sourceListingId },
            { kind: 'detail_id', value: fixture.sourceListingId },
          ],
          listingPath: `/detail/${fixture.sourceListingId}/`,
          reasonCode: null,
        }))
        .mockResolvedValueOnce(jsonResponse({
          state: 'matched',
          sourceName: 'funda',
          rawUrl: fixture.rawUrl,
          canonicalUrl: fixture.canonicalUrl,
          sourceListingId: fixture.sourceListingId,
          sourceListingIdKind: 'tiny_id',
          aliases: [
            { kind: 'tiny_id', value: fixture.sourceListingId },
            { kind: 'detail_id', value: fixture.sourceListingId },
          ],
          sourceStatus: 'available',
          matchedPropertyEvidence: {
            propertyId: testPropertyId,
            matchKind: 'source_exact',
          },
          thumbnailUrl: fixture.thumbnailUrl,
          title: fixture.title,
          price: 525000,
          currency: 'EUR',
        }));

      const previewResponse = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        payload: {
          url: fixture.rawUrl,
          propertyId: testPropertyId,
        },
      });
      expect(previewResponse.statusCode).toBe(200);
      const preview = JSON.parse(previewResponse.body) as { previewToken: string };

      mockFetchFn.mockReset();
      const submitResponse = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          previewToken: preview.previewToken,
        },
      });

      expect(submitResponse.statusCode).toBe(201);
      expect(mockFetchFn).not.toHaveBeenCalled();
      const repeatedSubmission = JSON.parse(submitResponse.body) as {
        id: string;
        candidateId: string;
        candidateHandoffState: string;
      };
      expect(repeatedSubmission).toMatchObject({
        id: fixture.canonicalListingId,
        candidateId: fixture.candidateId,
        candidateHandoffState: 'delivered',
      });

      const handoffs = await db
        .select()
        .from(listingCandidateHandoffs)
        .where(eq(listingCandidateHandoffs.sourceUrlCanonical, fixture.canonicalUrl));
      expect(handoffs).toHaveLength(1);
      expect(handoffs[0]).toMatchObject({
        id: fixture.candidateId,
        state: 'delivered',
      });

      const listingsResponse = await app.inject({
        method: 'GET',
        url: `/properties/${testPropertyId}/listings`,
      });
      expect(listingsResponse.statusCode).toBe(200);
      const listingsBody = JSON.parse(listingsResponse.body);
      const visibleRows = listingsBody.data.filter((item: { id: string }) => item.id === fixture.canonicalListingId);
      expect(visibleRows).toHaveLength(1);
      expect(visibleRows[0]).toMatchObject({
        candidateHandoffState: 'delivered',
      });
    });

    it('attaches user evidence to an existing scraper-backed listing without overwriting mirror truth', async () => {
      const sourceListingId = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 12);
      const rawUrl = `https://www.funda.nl/detail/koop/eindhoven/huis-existing-scraper/${sourceListingId}/`;
      const canonicalUrl = `https://www.funda.nl/detail/${sourceListingId}/`;
      const watermark = await getIngestWatermark('funda');
      const acceptedMirror = await acceptIngestBatch({
        sourceName: 'funda',
        idempotencyKey: `funda-existing-scraper-${sourceListingId}`,
        batchSequence: 0,
        cursorStart: watermark.cursor,
        cursorEnd: encodeOpaqueIngestCursor({
          changedAt: '2026-04-09T10:00:00.000Z',
          listingKey: `funda-existing-scraper-${sourceListingId}`,
        }),
        upstreamRunKey: `funda-existing-scraper-run-${sourceListingId}`,
        listings: [
          {
            sourceUrl: rawUrl,
            mirrorListingId: sourceListingId,
            sourceListingId,
            sourceListingIdKind: 'tiny_id',
            canonicalUrl,
            askingPrice: 610000,
            priceType: 'sale',
            currency: 'EUR',
            status: 'sold',
            sourceStatus: 'sold',
            ogTitle: 'Mirror-owned sold title',
            thumbnailUrl: 'https://cdn.example.com/mirror-owned.jpg',
            mirrorLastChangedAt: '2026-04-09T10:00:00.000Z',
            mirrorLastSeenAt: '2026-04-09T10:05:00.000Z',
            address: {
              countryCode: 'NL',
              street: 'Listings Fixture Street',
              postalCode: '9100AA',
              houseNumber: 1,
              city: 'Listings City',
              latitude: 51.441,
              longitude: 5.471,
            },
          },
        ],
      });
      await expect(
        processIngestBatch({
          batchId: acceptedMirror.batchId,
          enqueueMaintenanceRefresh: async () => {},
        }),
      ).resolves.toMatchObject({ status: 'completed' });

      const [mirrorCanonical] = await db
        .select()
        .from(canonicalListings)
        .where(eq(canonicalListings.primarySourceListingId, sourceListingId))
        .limit(1);
      expect(mirrorCanonical).toMatchObject({
        status: 'sold',
        statusSource: 'mirror',
        verificationState: 'validated',
        askingPrice: 610000,
        title: 'Mirror-owned sold title',
      });

      mockFetchFn
        .mockResolvedValueOnce(jsonResponse({
          supported: true,
          sourceName: 'funda',
          rawUrl,
          canonicalUrl,
          sourceListingId,
          sourceListingIdKind: 'tiny_id',
          aliases: [{ kind: 'tiny_id', value: sourceListingId }],
          listingPath: `/detail/${sourceListingId}/`,
          reasonCode: null,
        }))
        .mockResolvedValueOnce(jsonResponse({
          state: 'matched',
          sourceName: 'funda',
          rawUrl,
          canonicalUrl,
          sourceListingId,
          sourceListingIdKind: 'tiny_id',
          aliases: [{ kind: 'tiny_id', value: sourceListingId }],
          sourceStatus: 'available',
          matchedPropertyEvidence: {
            propertyId: testPropertyId,
            matchKind: 'source_exact',
          },
          title: 'User preview should not win',
          price: 499000,
          currency: 'EUR',
        }));

      const previewResponse = await app.inject({
        method: 'POST',
        url: '/listings/preview',
        payload: {
          url: rawUrl,
          propertyId: testPropertyId,
        },
      });
      expect(previewResponse.statusCode).toBe(200);
      const preview = JSON.parse(previewResponse.body) as { previewToken: string };
      mockFetchFn.mockReset();

      const submitResponse = await app.inject({
        method: 'POST',
        url: '/listings/submit',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          previewToken: preview.previewToken,
        },
      });
      expect(submitResponse.statusCode).toBe(201);
      expect(mockFetchFn).not.toHaveBeenCalled();
      expect(JSON.parse(submitResponse.body)).toMatchObject({
        id: mirrorCanonical?.id,
        status: 'sold',
        verificationState: 'validated',
      });

      const [afterSubmit] = await db
        .select()
        .from(canonicalListings)
        .where(eq(canonicalListings.id, mirrorCanonical?.id ?? '00000000-0000-0000-0000-000000000000'))
        .limit(1);
      expect(afterSubmit).toMatchObject({
        status: 'sold',
        statusSource: 'mirror',
        verificationState: 'validated',
        originSummary: 'user_and_mirror',
        askingPrice: 610000,
        title: 'Mirror-owned sold title',
      });

      const userPreviewPriceRows = await db
        .select()
        .from(priceHistory)
        .where(and(
          eq(priceHistory.propertyId, testPropertyId),
          eq(priceHistory.price, 499000),
          eq(priceHistory.source, 'funda'),
        ));
      expect(userPreviewPriceRows).toHaveLength(0);
    });

    it('reconciles mirror observations by source candidate id without preview id', async () => {
      const fixture = await createMatchedSubmissionFixture('source-candidate-observation');
      const watermark = await getIngestWatermark('funda');
      const changedSourceListingId = `${fixture.sourceListingId}-mirror`;
      const changedCanonicalUrl = `https://www.funda.nl/detail/${changedSourceListingId}`;
      const changedRawUrl = `https://www.funda.nl/detail/koop/eindhoven/huis-source-candidate/${changedSourceListingId}/`;
      const cursorEnd = encodeOpaqueIngestCursor({
        changedAt: new Date(Date.now() + 1_000).toISOString(),
        listingKey: `funda-source-candidate-observation-${fixture.sourceListingId}`,
      });
      const acceptedMirror = await acceptIngestBatch({
        sourceName: 'funda',
        idempotencyKey: `funda-source-candidate-observation-${fixture.sourceListingId}`,
        batchSequence: 0,
        cursorStart: watermark.cursor,
        cursorEnd,
        upstreamRunKey: `funda-source-candidate-run-observation-${fixture.sourceListingId}`,
        listings: [
          {
            sourceUrl: changedRawUrl,
            mirrorListingId: changedSourceListingId,
            sourceCandidateId: fixture.candidateId,
            sourceListingId: changedSourceListingId,
            sourceListingIdKind: 'tiny_id',
            sourceListingAliases: [
              { kind: 'tiny_id', value: changedSourceListingId },
              { kind: 'detail_id', value: changedSourceListingId },
            ],
            canonicalUrl: changedCanonicalUrl,
            askingPrice: 530000,
            priceType: 'sale',
            currency: 'EUR',
            status: 'active',
            lifecycleStatus: 'available',
            mirrorLastChangedAt: '2026-04-07T10:00:00.000Z',
            mirrorLastSeenAt: '2026-04-07T10:05:00.000Z',
            thumbnailUrl: 'https://cdn.example.com/source-candidate-updated.jpg',
            ogTitle: 'Source candidate updated title',
            address: {
              countryCode: 'NL',
              street: 'Listings Fixture Street',
              postalCode: '9100AA',
              houseNumber: 1,
              city: 'Listings City',
              latitude: 51.441,
              longitude: 5.471,
            },
          },
        ],
      });

      await expect(
        processIngestBatch({
          batchId: acceptedMirror.batchId,
          enqueueMaintenanceRefresh: async () => {},
        }),
      ).resolves.toEqual({
        status: 'completed',
        ingested: 1,
        updated: 0,
        skipped: 0,
      });

      const [canonical] = await db
        .select()
        .from(canonicalListings)
        .where(eq(canonicalListings.id, fixture.canonicalListingId))
        .limit(1);
      expect(canonical).toMatchObject({
        canonicalUrl: changedCanonicalUrl,
        displayUrl: changedCanonicalUrl,
        status: 'active',
        statusSource: 'mirror',
        verificationState: 'validated',
        originSummary: 'user_and_mirror',
        askingPrice: 530000,
        thumbnailUrl: 'https://cdn.example.com/source-candidate-updated.jpg',
        title: 'Source candidate updated title',
      });

      const [handoff] = await db
        .select()
        .from(listingCandidateHandoffs)
        .where(eq(listingCandidateHandoffs.id, fixture.candidateId))
        .limit(1);
      expect(handoff).toMatchObject({
        state: 'delivered',
        canonicalListingId: fixture.canonicalListingId,
      });
      expect(handoff?.observationId).toBeTruthy();

      const [observation] = await db
        .select()
        .from(listingObservations)
        .where(eq(listingObservations.id, handoff?.observationId ?? '00000000-0000-0000-0000-000000000000'))
        .limit(1);
      expect(observation).toMatchObject({
        candidateHandoffId: fixture.candidateId,
        previewResultId: null,
        sourceListingId: changedSourceListingId,
      });
    });

    it('moves a provisional listing when source candidate evidence corrects the property match', async () => {
      const fixture = await createMatchedSubmissionFixture('source-candidate-property-correction', 531111);
      const staleRentPrice = 531112;
      const oldPropertyPriceRowsBefore = await db
        .select()
        .from(priceHistory)
        .where(and(
          eq(priceHistory.propertyId, testPropertyId),
          eq(priceHistory.price, fixture.askingPrice),
          eq(priceHistory.source, 'funda'),
        ));
      expect(oldPropertyPriceRowsBefore.length).toBeGreaterThan(0);
      await seedProjectedRentPriceArtifact({
        canonicalListingId: fixture.canonicalListingId,
        propertyId: testPropertyId,
        sourceListingId: fixture.sourceListingId,
        sourceUrlCanonical: fixture.canonicalUrl,
        price: staleRentPrice,
        priceDate: '2026-04-06',
      });

      const oldPropertyRentRowsBefore = await db
        .select()
        .from(priceHistory)
        .where(and(
          eq(priceHistory.propertyId, testPropertyId),
          eq(priceHistory.price, staleRentPrice),
          eq(priceHistory.eventType, 'rented'),
          eq(priceHistory.source, 'funda'),
        ));
      expect(oldPropertyRentRowsBefore).toHaveLength(1);

      const watermark = await getIngestWatermark('funda');
      const changedSourceListingId = `${fixture.sourceListingId}-corrected`;
      const changedCanonicalUrl = `https://www.funda.nl/detail/${changedSourceListingId}/`;
      const acceptedMirror = await acceptIngestBatch({
        sourceName: 'funda',
        idempotencyKey: `funda-source-candidate-property-correction-${fixture.sourceListingId}`,
        batchSequence: 0,
        cursorStart: watermark.cursor,
        cursorEnd: encodeOpaqueIngestCursor({
          changedAt: new Date(Date.now() + 1_000).toISOString(),
          listingKey: `funda-source-candidate-property-correction-${fixture.sourceListingId}`,
        }),
        upstreamRunKey: `funda-source-candidate-property-correction-run-${fixture.sourceListingId}`,
        listings: [
          {
            sourceUrl: `https://www.funda.nl/detail/koop/eindhoven/huis-corrected/${changedSourceListingId}/`,
            mirrorListingId: changedSourceListingId,
            sourceCandidateId: fixture.candidateId,
            sourceListingId: changedSourceListingId,
            sourceListingIdKind: 'tiny_id',
            canonicalUrl: changedCanonicalUrl,
            askingPrice: 535000,
            priceType: 'sale',
            currency: 'EUR',
            status: 'active',
            sourceStatus: 'available',
            mirrorLastChangedAt: '2026-04-07T12:00:00.000Z',
            mirrorLastSeenAt: '2026-04-07T12:05:00.000Z',
            ogTitle: 'Corrected property listing',
            address: {
              countryCode: 'NL',
              street: 'Listings Mismatch Street',
              postalCode: '9100AB',
              houseNumber: 2,
              city: 'Listings City',
              latitude: 51.442,
              longitude: 5.472,
            },
          },
        ],
      });

      await expect(
        processIngestBatch({
          batchId: acceptedMirror.batchId,
          enqueueMaintenanceRefresh: async () => {},
        }),
      ).resolves.toEqual({
        status: 'completed',
        ingested: 1,
        updated: 0,
        skipped: 0,
      });

      const [canonical] = await db
        .select()
        .from(canonicalListings)
        .where(eq(canonicalListings.id, fixture.canonicalListingId))
        .limit(1);
      expect(canonical).toMatchObject({
        canonicalUrl: changedCanonicalUrl.replace(/\/$/, ''),
        status: 'active',
        statusSource: 'mirror',
        verificationState: 'validated',
        askingPrice: 535000,
        title: 'Corrected property listing',
      });
      expect(canonical?.propertyId).not.toBe(testPropertyId);

      const oldPropertyPriceRowsAfter = await db
        .select()
        .from(priceHistory)
        .where(and(
          eq(priceHistory.propertyId, testPropertyId),
          eq(priceHistory.price, fixture.askingPrice),
          eq(priceHistory.source, 'funda'),
        ));
      expect(oldPropertyPriceRowsAfter).toHaveLength(0);

      const oldPropertyRentRowsAfter = await db
        .select()
        .from(priceHistory)
        .where(and(
          eq(priceHistory.propertyId, testPropertyId),
          eq(priceHistory.price, staleRentPrice),
          eq(priceHistory.eventType, 'rented'),
          eq(priceHistory.source, 'funda'),
        ));
      expect(oldPropertyRentRowsAfter).toHaveLength(0);

      const newPropertyPriceRows = await db
        .select()
        .from(priceHistory)
        .where(and(
          eq(priceHistory.propertyId, canonical?.propertyId ?? otherPropertyId),
          eq(priceHistory.price, 535000),
          eq(priceHistory.source, 'funda'),
        ));
      expect(newPropertyPriceRows).toHaveLength(1);
    });

    it('withdraws an addressless source-candidate lifecycle outcome and cleans invalid provisional prices', async () => {
      const withdrawnFixture = await createMatchedSubmissionFixture('addressless-withdrawal', 532222);
      const invalidFixture = await createMatchedSubmissionFixture('addressless-invalid-cleanup', 533333);
      const staleRentPrice = 533334;
      await seedProjectedRentPriceArtifact({
        canonicalListingId: invalidFixture.canonicalListingId,
        propertyId: testPropertyId,
        sourceListingId: invalidFixture.sourceListingId,
        sourceUrlCanonical: invalidFixture.canonicalUrl,
        price: staleRentPrice,
        priceDate: '2026-04-07',
      });

      const staleRentRowsBefore = await db
        .select()
        .from(priceHistory)
        .where(and(
          eq(priceHistory.propertyId, testPropertyId),
          eq(priceHistory.price, staleRentPrice),
          eq(priceHistory.eventType, 'rented'),
          eq(priceHistory.source, 'funda'),
        ));
      expect(staleRentRowsBefore).toHaveLength(1);

      const watermark = await getIngestWatermark('funda');
      const acceptedMirror = await acceptIngestBatch({
        sourceName: 'funda',
        idempotencyKey: `funda-addressless-candidate-outcomes-${withdrawnFixture.sourceListingId}`,
        batchSequence: 0,
        cursorStart: watermark.cursor,
        cursorEnd: encodeOpaqueIngestCursor({
          changedAt: new Date(Date.now() + 1_000).toISOString(),
          listingKey: `funda-addressless-candidate-outcomes-${withdrawnFixture.sourceListingId}`,
        }),
        upstreamRunKey: `funda-addressless-candidate-outcomes-run-${withdrawnFixture.sourceListingId}`,
        listings: [
          {
            sourceUrl: withdrawnFixture.rawUrl,
            mirrorListingId: `${withdrawnFixture.sourceListingId}-not-found`,
            sourceCandidateId: withdrawnFixture.candidateId,
            sourceListingId: withdrawnFixture.sourceListingId,
            sourceListingIdKind: 'tiny_id',
            canonicalUrl: withdrawnFixture.canonicalUrl,
            askingPrice: null,
            priceType: 'sale',
            status: 'withdrawn',
            sourceStatus: 'not_found',
            mirrorLastChangedAt: '2026-04-07T13:00:00.000Z',
            mirrorLastSeenAt: '2026-04-07T13:05:00.000Z',
          },
          {
            sourceUrl: invalidFixture.rawUrl,
            mirrorListingId: `${invalidFixture.sourceListingId}-invalid`,
            sourceCandidateId: invalidFixture.candidateId,
            sourceListingId: invalidFixture.sourceListingId,
            sourceListingIdKind: 'tiny_id',
            canonicalUrl: invalidFixture.canonicalUrl,
            askingPrice: null,
            priceType: 'sale',
            status: 'active',
            diagnosticStatus: 'invalid',
            mirrorLastChangedAt: '2026-04-07T13:10:00.000Z',
            mirrorLastSeenAt: '2026-04-07T13:15:00.000Z',
          },
        ],
      });

      await expect(
        processIngestBatch({
          batchId: acceptedMirror.batchId,
          enqueueMaintenanceRefresh: async () => {},
        }),
      ).resolves.toEqual({
        status: 'completed',
        ingested: 1,
        updated: 1,
        skipped: 0,
      });

      const [withdrawnCanonical] = await db
        .select()
        .from(canonicalListings)
        .where(eq(canonicalListings.id, withdrawnFixture.canonicalListingId))
        .limit(1);
      expect(withdrawnCanonical).toMatchObject({
        status: 'withdrawn',
        statusSource: 'mirror',
        verificationState: 'validated',
      });

      const [invalidCanonical] = await db
        .select()
        .from(canonicalListings)
        .where(eq(canonicalListings.id, invalidFixture.canonicalListingId))
        .limit(1);
      expect(invalidCanonical).toMatchObject({
        status: 'withdrawn',
        statusSource: 'mirror',
        verificationState: 'invalid',
      });

      const invalidLegacyPrices = await db
        .select()
        .from(priceHistory)
        .where(and(
          eq(priceHistory.propertyId, testPropertyId),
          eq(priceHistory.price, invalidFixture.askingPrice),
          eq(priceHistory.source, 'funda'),
        ));
      expect(invalidLegacyPrices).toHaveLength(0);

      const staleRentRowsAfter = await db
        .select()
        .from(priceHistory)
        .where(and(
          eq(priceHistory.propertyId, testPropertyId),
          eq(priceHistory.price, staleRentPrice),
          eq(priceHistory.eventType, 'rented'),
          eq(priceHistory.source, 'funda'),
        ));
      expect(staleRentRowsAfter).toHaveLength(0);

      const invalidProjectedPrices = await db
        .select()
        .from(listingPriceObservations)
        .where(eq(listingPriceObservations.canonicalListingId, invalidFixture.canonicalListingId));
      expect(invalidProjectedPrices).toHaveLength(0);
    });

    it('keeps provisional listings active when diagnostic pushback is retryable', async () => {
      const fixture = await createMatchedSubmissionFixture('diagnostic-pushback');
      const watermark = await getIngestWatermark('funda');
      const changedSourceListingId = `${fixture.sourceListingId}-parser`;
      const changedCanonicalUrl = `https://www.funda.nl/detail/${changedSourceListingId}/`;
      const cursorEnd = encodeOpaqueIngestCursor({
        changedAt: new Date(Date.now() + 1_000).toISOString(),
        listingKey: `funda-diagnostic-pushback-${fixture.sourceListingId}`,
      });
      const acceptedMirror = await acceptIngestBatch({
        sourceName: 'funda',
        idempotencyKey: `funda-diagnostic-pushback-${fixture.sourceListingId}`,
        batchSequence: 0,
        cursorStart: watermark.cursor,
        cursorEnd,
        upstreamRunKey: `funda-diagnostic-pushback-run-${fixture.sourceListingId}`,
        listings: [
          {
            sourceUrl: `https://www.funda.nl/detail/koop/eindhoven/huis-diagnostic-pushback/${changedSourceListingId}/`,
            mirrorListingId: changedSourceListingId,
            sourceCandidateId: fixture.candidateId,
            sourceListingId: changedSourceListingId,
            sourceListingIdKind: 'tiny_id',
            sourceListingAliases: [
              { kind: 'tiny_id', value: changedSourceListingId },
              { kind: 'detail_id', value: changedSourceListingId },
            ],
            canonicalUrl: changedCanonicalUrl,
            askingPrice: null,
            priceType: 'sale',
            status: 'active',
            diagnosticStatus: 'parser_error',
            mirrorLastChangedAt: '2026-04-07T11:00:00.000Z',
            mirrorLastSeenAt: '2026-04-07T11:05:00.000Z',
          },
        ],
      });

      await expect(
        processIngestBatch({
          batchId: acceptedMirror.batchId,
          enqueueMaintenanceRefresh: async () => {},
        }),
      ).resolves.toEqual({
        status: 'completed',
        ingested: 0,
        updated: 1,
        skipped: 0,
      });

      const [canonical] = await db
        .select()
        .from(canonicalListings)
        .where(eq(canonicalListings.id, fixture.canonicalListingId))
        .limit(1);
      expect(canonical).toMatchObject({
        canonicalUrl: fixture.canonicalUrl,
        status: 'active',
        statusSource: 'user',
        verificationState: 'provisional',
        originSummary: 'user',
      });

      const [handoff] = await db
        .select()
        .from(listingCandidateHandoffs)
        .where(eq(listingCandidateHandoffs.id, fixture.candidateId))
        .limit(1);
      expect(handoff).toMatchObject({
        state: 'retryable_error',
        canonicalListingId: fixture.canonicalListingId,
      });
      expect(handoff?.lastError).toBe('Source service diagnostic: parser_error');
      expect(handoff?.observationId).toBeTruthy();

      const [observation] = await db
        .select()
        .from(listingObservations)
        .where(eq(listingObservations.id, handoff?.observationId ?? '00000000-0000-0000-0000-000000000000'))
        .limit(1);
      expect(observation).toMatchObject({
        candidateHandoffId: fixture.candidateId,
        previewResultId: null,
        sourceListingId: changedSourceListingId,
        diagnosticStatus: 'parser_error',
      });

      const listingsResponse = await app.inject({
        method: 'GET',
        url: `/properties/${testPropertyId}/listings`,
      });
      expect(listingsResponse.statusCode).toBe(200);
      const listingsBody = JSON.parse(listingsResponse.body);
      const listing = listingsBody.data.find((item: { id: string }) => item.id === fixture.canonicalListingId);
      expect(listing).toMatchObject({
        status: 'active',
        verificationState: 'provisional',
        candidateHandoffState: 'retryable_error',
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

  describe('legacy listing validation outcome endpoint', () => {
    it('should not expose the removed listing validation outcome endpoint', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ingest/listing-validation-outcomes',
        headers: {
          'x-api-key': 'test-ingest-api-key',
        },
        payload: {
          candidateId: '00000000-0000-0000-0000-000000000000',
        },
      });

      expect(response.statusCode).toBe(404);
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
