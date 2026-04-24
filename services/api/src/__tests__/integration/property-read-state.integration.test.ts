import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp } from '../../app.js';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import {
  acceptIngestBatch,
  encodeOpaqueIngestCursor,
  processIngestBatch,
} from '../../services/ingest/index.js';
import {
  ensurePropertyChangeState,
  markPropertyRead,
} from '../../services/property-read-state.js';
import {
  createIntegrationProperty,
  createIntegrationUser,
} from './helpers/fixtures.js';

describe('Property read-state change advancement', () => {
  type MutableSourceServices = {
    fundaApiKey: string;
  };

  let app: FastifyInstance;
  const cleanupPropertyIds: string[] = [];
  const cleanupUserIds: string[] = [];
  const cleanupSources = ['idealista'];
  const originalFetch = global.fetch;
  const sourceServicesConfig = config.sourceServices as MutableSourceServices;
  const originalFundaApiKey = config.sourceServices.fundaApiKey;

  beforeAll(async () => {
    await db.execute(sql`DELETE FROM price_history WHERE source IN (${sql.join(cleanupSources.map((source) => sql`${source}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM listings WHERE source_name IN (${sql.join(cleanupSources.map((source) => sql`${source}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM ingest_sources WHERE source_name IN (${sql.join(cleanupSources.map((source) => sql`${source}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM ingest_batches WHERE source_name IN (${sql.join(cleanupSources.map((source) => sql`${source}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM ingest_runs WHERE source_name IN (${sql.join(cleanupSources.map((source) => sql`${source}`), sql`, `)})`);
    app = await buildApp({ logger: false });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    sourceServicesConfig.fundaApiKey = originalFundaApiKey;
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM price_history WHERE source IN (${sql.join(cleanupSources.map((source) => sql`${source}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM listings WHERE source_name IN (${sql.join(cleanupSources.map((source) => sql`${source}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM ingest_sources WHERE source_name IN (${sql.join(cleanupSources.map((source) => sql`${source}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM ingest_batches WHERE source_name IN (${sql.join(cleanupSources.map((source) => sql`${source}`), sql`, `)})`);
    await db.execute(sql`DELETE FROM ingest_runs WHERE source_name IN (${sql.join(cleanupSources.map((source) => sql`${source}`), sql`, `)})`);

    if (cleanupPropertyIds.length > 0) {
      await db.execute(sql`DELETE FROM properties WHERE id IN (${sql.join(cleanupPropertyIds.map((id) => sql`${id}`), sql`, `)})`);
    }
    if (cleanupUserIds.length > 0) {
      await db.execute(sql`DELETE FROM users WHERE id IN (${sql.join(cleanupUserIds.map((id) => sql`${id}`), sql`, `)})`);
    }

    await app.close();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }

  async function createUser(label: string) {
    const user = await createIntegrationUser(app, { label });
    cleanupUserIds.push(user.userId);
    return user;
  }

  async function createProperty(label: string, lon: number, lat: number, countryCode = 'NL') {
    const property = await createIntegrationProperty({
      countryCode,
      street: label,
      houseNumber: 12,
      city: 'Read State City',
      postalCode: countryCode === 'ES' ? '28013' : '9300AA',
      lon,
      lat,
    });
    cleanupPropertyIds.push(property.id);
    await ensurePropertyChangeState(property.id);
    return property;
  }

  async function changeVersion(propertyId: string) {
    return (await ensurePropertyChangeState(propertyId)).changeVersion;
  }

  it('advances on comments and replies', async () => {
    const user = await createUser('read-state-commenter');
    const property = await createProperty('Read State Comment Street', 6.101, 52.101);
    const initial = await changeVersion(property.id);

    const commentResponse = await app.inject({
      method: 'POST',
      url: `/properties/${property.id}/comments`,
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: { content: 'A visible property comment' },
    });

    expect(commentResponse.statusCode).toBe(201);
    expect(await changeVersion(property.id)).toBe(initial + 1);

    const comment = JSON.parse(commentResponse.body);
    const replyResponse = await app.inject({
      method: 'POST',
      url: `/properties/${property.id}/comments`,
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: { content: 'A visible property reply', parentId: comment.id },
    });

    expect(replyResponse.statusCode).toBe(201);
    expect(await changeVersion(property.id)).toBe(initial + 2);
  });

  it('advances on new and meaningfully updated price guesses only', async () => {
    const user = await createUser('read-state-guesser');
    const property = await createProperty('Read State Guess Street', 6.102, 52.102);
    const initial = await changeVersion(property.id);

    const createResponse = await app.inject({
      method: 'POST',
      url: `/properties/${property.id}/guesses`,
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: { guessedPrice: 410000 },
    });

    expect(createResponse.statusCode).toBe(201);
    expect(await changeVersion(property.id)).toBe(initial + 1);

    const unchangedResponse = await app.inject({
      method: 'POST',
      url: `/properties/${property.id}/guesses`,
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: { guessedPrice: 410000 },
    });

    expect(unchangedResponse.statusCode).toBe(200);
    expect(await changeVersion(property.id)).toBe(initial + 1);

    const updateResponse = await app.inject({
      method: 'POST',
      url: `/properties/${property.id}/guesses`,
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: { guessedPrice: 415000 },
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(await changeVersion(property.id)).toBe(initial + 2);
  });

  it('advances on submitted listings', async () => {
    const user = await createUser('read-state-listing-submitter');
    const property = await createProperty('Read State Listing Street', 6.103, 52.103);
    const initial = await changeVersion(property.id);
    const submittedId = `${Date.now()}`.slice(-8);
    const submittedUrl = `https://www.funda.nl/detail/koop/eindhoven/huis-read-state/${submittedId}/`;
    const canonicalUrl = `https://www.funda.nl/detail/${submittedId}/`;
    const mockFetchFn = jest.fn<typeof global.fetch>()
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
          propertyId: property.id,
          matchKind: 'source_exact',
        },
        title: 'Read state listing submit',
      }));
    sourceServicesConfig.fundaApiKey = 'test-funda-source-service-key';
    global.fetch = mockFetchFn;

    const response = await app.inject({
      method: 'POST',
      url: '/listings/submit',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: {
        url: submittedUrl,
        propertyId: property.id,
        ogTitle: 'Read state listing submit',
        description: 'Read state listing description',
        thumbnailUrl: 'https://cdn.example.com/read-state-listing.jpg',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(await changeVersion(property.id)).toBe(initial + 1);
    expect(mockFetchFn).toHaveBeenCalledTimes(2);
  });

  it('advances on ingest listing writes and price history inserts', async () => {
    const property = await createProperty('Calle Read State', -3.7038, 40.4168, 'ES');
    const initial = await changeVersion(property.id);
    const now = Date.now();
    const cursorEnd = encodeOpaqueIngestCursor({
      changedAt: '2026-04-21T12:00:00.000Z',
      listingKey: `read-state-ingest-${now}`,
    });

    const accepted = await acceptIngestBatch({
      sourceName: 'idealista',
      idempotencyKey: `read-state-ingest-${now}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd,
      upstreamRunKey: `read-state-run-${now}`,
      listings: [
        {
          sourceUrl: `https://www.idealista.com/inmueble/${now}/`,
          mirrorListingId: `read-state-${now}`,
          askingPrice: 520000,
          priceType: 'sale',
          status: 'active',
          ogTitle: 'Read state ingest listing',
          mirrorLastChangedAt: '2026-04-21T12:00:00.000Z',
          address: {
            countryCode: 'ES',
            street: property.street,
            postalCode: property.postalCode,
            houseNumber: property.houseNumber,
            city: property.city,
            latitude: property.lat,
            longitude: property.lon,
          },
          priceHistory: [
            {
              price: 520000,
              priceDate: '2026-04-21',
              eventType: 'asking_price',
            },
          ],
        },
      ],
    });

    const result = await processIngestBatch({
      batchId: accepted.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    expect(result.status).toBe('completed');
    expect(await changeVersion(property.id)).toBeGreaterThan(initial);
  });

  it('does not advance on saves or read-state writes', async () => {
    const user = await createUser('read-state-saver');
    const property = await createProperty('Read State Save Street', 6.104, 52.104);
    const initial = await changeVersion(property.id);

    const saveResponse = await app.inject({
      method: 'POST',
      url: `/properties/${property.id}/save`,
      headers: { authorization: `Bearer ${user.accessToken}` },
    });

    expect(saveResponse.statusCode).toBe(201);
    expect(await changeVersion(property.id)).toBe(initial);

    await markPropertyRead(property.id, { userId: user.userId });
    expect(await changeVersion(property.id)).toBe(initial);
  });
});
