import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { sql } from 'drizzle-orm';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { canonicalListings, mirrorListingWatches } from '../../db/schema.js';
import { createIntegrationProperty } from './helpers/fixtures.js';

type ListingReconciliationModule = typeof import('../../services/listing-reconciliation.js');

describe('background listing watch validation', () => {
  const originalFetch = global.fetch;
  const originalFundaApiKey = config.sourceServices.fundaApiKey;
  const originalParariusApiKey = config.sourceServices.parariusApiKey;
  let mockFetchFn: jest.Mock<typeof global.fetch>;
  let claimDueListingValidationWatches: ListingReconciliationModule['claimDueListingValidationWatches'];
  let createOrUpdateMirrorWatch: ListingReconciliationModule['createOrUpdateMirrorWatch'];
  let processDueListingValidationWatches: ListingReconciliationModule['processDueListingValidationWatches'];
  const propertyIds: string[] = [];

  function jsonResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }

  function setSourceServiceApiKeys(fundaApiKey: string, parariusApiKey: string) {
    const sourceServices = config.sourceServices as {
      fundaApiKey: string;
      parariusApiKey: string;
    };
    sourceServices.fundaApiKey = fundaApiKey;
    sourceServices.parariusApiKey = parariusApiKey;
  }

  async function createProperty() {
    const property = await createIntegrationProperty({
      street: `Watch Validation Street ${Date.now()} ${propertyIds.length}`,
      houseNumber: propertyIds.length + 1,
      city: 'Watch City',
      postalCode: `92${String(propertyIds.length).padStart(2, '0')}AA`,
      lon: 5.47 + propertyIds.length / 10_000,
      lat: 51.44 + propertyIds.length / 10_000,
    });
    propertyIds.push(property.id);
    return property;
  }

  beforeAll(async () => {
    setSourceServiceApiKeys('test-funda-key', 'test-pararius-key');
    mockFetchFn = jest.fn() as jest.Mock<typeof global.fetch>;
    global.fetch = mockFetchFn;

    const reconciliation = await import('../../services/listing-reconciliation.js');
    claimDueListingValidationWatches = reconciliation.claimDueListingValidationWatches;
    createOrUpdateMirrorWatch = reconciliation.createOrUpdateMirrorWatch;
    processDueListingValidationWatches = reconciliation.processDueListingValidationWatches;
  });

  beforeEach(() => {
    mockFetchFn.mockReset();
  });

  afterAll(async () => {
    try {
      for (const propertyId of propertyIds) {
        await db.execute(sql`
          DELETE FROM ingest_batches
          WHERE payload_json->>'watchId' IN (
            SELECT id::text FROM mirror_listing_watches WHERE property_id = ${propertyId}
          )
        `);
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
        await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
      }
    } finally {
      global.fetch = originalFetch;
      setSourceServiceApiKeys(originalFundaApiKey, originalParariusApiKey);
    }
  });

  it('claims a queued watch and persists a terminal validation outcome', async () => {
    const property = await createProperty();
    const rawUrl = 'https://www.funda.nl/detail/koop/watch-city/huis-watch-validation/92345001/';
    const canonicalUrl = 'https://www.funda.nl/detail/92345001/';

    const watch = await createOrUpdateMirrorWatch({
      sourceName: 'funda',
      propertyId: property.id,
      sourceUrlRaw: rawUrl,
      sourceUrlCanonical: canonicalUrl,
      sourceListingId: '92345001',
      state: 'queued',
      stateReason: 'mirror_unavailable',
    });

    mockFetchFn
      .mockResolvedValueOnce(jsonResponse({
        supported: true,
        sourceName: 'funda',
        rawUrl,
        canonicalUrl,
        sourceListingId: '92345001',
        sourceListingIdKind: 'tiny_id',
        aliases: [{ kind: 'tiny_id', value: '92345001' }],
        listingPath: '/detail/92345001/',
        reasonCode: null,
      }))
      .mockResolvedValueOnce(jsonResponse({
        state: 'matched',
        sourceName: 'funda',
        rawUrl,
        canonicalUrl,
        sourceListingId: '92345001',
        sourceListingIdKind: 'tiny_id',
        aliases: [{ kind: 'tiny_id', value: '92345001' }],
        sourceStatus: 'available',
        matchedPropertyEvidence: {
          propertyId: property.id,
          matchKind: 'source_exact',
        },
        price: 525000,
        currency: 'EUR',
        title: 'Worker validated listing',
      }));

    const summary = await processDueListingValidationWatches({
      limit: 5,
      retryDelayMs: () => 60_000,
    });

    expect(summary).toMatchObject({
      claimedCount: 1,
      terminalCount: 1,
      retryableCount: 0,
    });
    expect(summary.results[0]).toMatchObject({
      watchId: watch.id,
      outcome: 'terminal',
      state: 'matched',
      propertyId: property.id,
      sourceName: 'funda',
    });

    const validateBody = JSON.parse(String(mockFetchFn.mock.calls[1]?.[1]?.body));
    expect(validateBody).toMatchObject({
      watchId: null,
      sourceName: 'funda',
      rawUrl,
      canonicalUrl,
      sourceListingId: '92345001',
      sourceListingIdKind: 'tiny_id',
      aliases: [{ kind: 'tiny_id', value: '92345001' }],
      property: {
        id: property.id,
        countryCode: 'NL',
        street: property.street,
        postalCode: property.postalCode,
        houseNumber: property.houseNumber,
        houseNumberAddition: null,
        city: property.city,
      },
    });

    const [persistedWatch] = await db
      .select()
      .from(mirrorListingWatches)
      .where(sql`${mirrorListingWatches.id} = ${watch.id}`)
      .limit(1);
    expect(persistedWatch).toMatchObject({
      state: 'matched',
      attemptCount: 1,
      stateReason: null,
      lastError: null,
    });
    expect(persistedWatch?.lastValidationObservationId).toBeTruthy();

    const [canonical] = await db
      .select()
      .from(canonicalListings)
      .where(sql`${canonicalListings.id} = ${persistedWatch?.canonicalListingId}`)
      .limit(1);
    expect(canonical).toMatchObject({
      propertyId: property.id,
      verificationState: 'validated',
      title: 'Worker validated listing',
      askingPrice: 525000,
    });
  });

  it('schedules a retry when validation returns retryable_error', async () => {
    const property = await createProperty();
    const rawUrl = 'https://www.pararius.com/apartment-for-rent/watch-city/92345002/retryable';
    const now = new Date('2026-04-24T10:00:00.000Z');

    const watch = await createOrUpdateMirrorWatch({
      sourceName: 'pararius',
      propertyId: property.id,
      sourceUrlRaw: rawUrl,
      sourceUrlCanonical: rawUrl,
      sourceListingId: '/apartment-for-rent/watch-city/92345002/retryable',
      state: 'queued',
      stateReason: 'mirror_unavailable',
    });

    mockFetchFn
      .mockResolvedValueOnce(jsonResponse({
        supported: true,
        sourceName: 'pararius',
        rawUrl,
        canonicalUrl: rawUrl,
        sourceListingId: '/apartment-for-rent/watch-city/92345002/retryable',
        sourceListingIdKind: 'canonical_path',
        aliases: [{ kind: 'url_path', value: '/apartment-for-rent/watch-city/92345002/retryable' }],
        listingPath: '/apartment-for-rent/watch-city/92345002/retryable',
        reasonCode: null,
      }))
      .mockResolvedValueOnce(jsonResponse({
        state: 'retryable_error',
        reasonCode: 'source_temporarily_blocked',
        sourceName: 'pararius',
        rawUrl,
        canonicalUrl: rawUrl,
        sourceListingId: '/apartment-for-rent/watch-city/92345002/retryable',
        sourceListingIdKind: 'canonical_path',
        aliases: [{ kind: 'url_path', value: '/apartment-for-rent/watch-city/92345002/retryable' }],
      }));

    const summary = await processDueListingValidationWatches({
      limit: 5,
      now,
      retryDelayMs: () => 123_000,
    });

    expect(summary).toMatchObject({
      claimedCount: 1,
      terminalCount: 0,
      retryableCount: 1,
    });
    expect(summary.results[0]).toMatchObject({
      watchId: watch.id,
      outcome: 'retryable',
      state: 'retryable_error',
      attemptCount: 1,
      error: 'source_temporarily_blocked',
    });

    const [persistedWatch] = await db
      .select()
      .from(mirrorListingWatches)
      .where(sql`${mirrorListingWatches.id} = ${watch.id}`)
      .limit(1);
    expect(persistedWatch).toMatchObject({
      state: 'retryable_error',
      attemptCount: 1,
      lastError: 'source_temporarily_blocked',
      lastValidationObservationId: null,
    });
    expect(persistedWatch?.nextAttemptAt?.toISOString()).toBe('2026-04-24T10:02:03.000Z');
  });

  it('does not claim already-final watches', async () => {
    const property = await createProperty();

    await createOrUpdateMirrorWatch({
      sourceName: 'funda',
      propertyId: property.id,
      sourceUrlRaw: 'https://www.funda.nl/detail/koop/watch-city/final/92345003/',
      sourceUrlCanonical: 'https://www.funda.nl/detail/92345003/',
      sourceListingId: '92345003',
      state: 'matched',
      stateReason: null,
    });

    const summary = await processDueListingValidationWatches({
      limit: 5,
      retryDelayMs: () => 60_000,
    });

    expect(summary).toMatchObject({
      claimedCount: 0,
      terminalCount: 0,
      retryableCount: 0,
    });
    expect(mockFetchFn).not.toHaveBeenCalled();
  });

  it('does not double-claim a due watch across concurrent claimers', async () => {
    const property = await createProperty();

    const watch = await createOrUpdateMirrorWatch({
      sourceName: 'funda',
      propertyId: property.id,
      sourceUrlRaw: 'https://www.funda.nl/detail/koop/watch-city/concurrent/92345004/',
      sourceUrlCanonical: 'https://www.funda.nl/detail/92345004/',
      sourceListingId: '92345004',
      state: 'queued',
      stateReason: 'mirror_unavailable',
    });

    const claims = await Promise.all([
      claimDueListingValidationWatches(1),
      claimDueListingValidationWatches(1),
    ]);

    const claimedWatchIds = claims.flat().map((claimed) => claimed.id);
    expect(claimedWatchIds).toEqual([watch.id]);

    const [persistedWatch] = await db
      .select()
      .from(mirrorListingWatches)
      .where(sql`${mirrorListingWatches.id} = ${watch.id}`)
      .limit(1);
    expect(persistedWatch).toMatchObject({
      state: 'fetching',
      attemptCount: 1,
    });
  });
});
