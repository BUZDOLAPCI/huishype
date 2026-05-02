import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { sql } from 'drizzle-orm';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import {
  canonicalListings,
  ingestBatches,
  listingObservations,
  mirrorListingWatches,
} from '../../db/schema.js';
import {
  cleanupLegacySeededListings,
  countLegacySeededListingCleanupCandidates,
  listLegacySeededListingCleanupCandidates,
} from '../../services/legacy-seeded-listing-cleanup.js';
import { createIntegrationProperty } from './helpers/fixtures.js';

describe('legacy seeded listing cleanup', () => {
  const originalFetch = global.fetch;
  const originalFundaApiKey = config.sourceServices.fundaApiKey;
  const originalParariusApiKey = config.sourceServices.parariusApiKey;
  const propertyIds: string[] = [];
  let mockFetchFn: jest.Mock<typeof global.fetch>;

  function setSourceServiceApiKeys(fundaApiKey: string, parariusApiKey: string) {
    const sourceServices = config.sourceServices as {
      fundaApiKey: string;
      parariusApiKey: string;
    };
    sourceServices.fundaApiKey = fundaApiKey;
    sourceServices.parariusApiKey = parariusApiKey;
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }

  async function createProperty(label: string) {
    const property = await createIntegrationProperty({
      street: `Legacy Cleanup ${label} ${Date.now()}`,
      houseNumber: propertyIds.length + 10,
      city: 'Cleanup City',
      postalCode: `93${String(propertyIds.length).padStart(2, '0')}AA`,
      lon: 5.48 + propertyIds.length / 10_000,
      lat: 51.45 + propertyIds.length / 10_000,
    });
    propertyIds.push(property.id);
    return property;
  }

  async function createLegacyListing(options: {
    propertyId: string;
    sourceListingId: string;
    canonicalUrl: string;
    origin?: 'mirror' | 'replay';
    ingestBacked?: boolean;
  }) {
    let ingestBatchId: string | null = null;
    if (options.ingestBacked) {
      const rows = await db.execute<{ id: string }>(sql`
        INSERT INTO ingest_batches (
          source_name,
          batch_sequence,
          idempotency_key,
          cursor_end,
          payload_json,
          status,
          received_at,
          completed_at,
          ingested_count,
          updated_count,
          skipped_count
        )
        VALUES (
          'funda',
          0,
          ${`legacy-cleanup-ingest-${options.sourceListingId}`},
          ${`cursor-${options.sourceListingId}`},
          '{}'::jsonb,
          'completed',
          now(),
          now(),
          1,
          0,
          0
        )
        RETURNING id
      `);
      ingestBatchId = Array.from(rows)[0]?.id ?? null;
    }

    const observationRows = await db.execute<{ id: string }>(sql`
      INSERT INTO listing_observations (
        source_name,
        source_listing_id,
        source_listing_id_kind,
        source_listing_aliases,
        source_url_raw,
        source_url_canonical,
        origin,
        property_id,
        property_match_kind,
        source_status,
        asking_price,
        price_currency,
        observed_at,
        ingest_batch_id,
        payload
      )
      VALUES (
        'funda',
        ${options.sourceListingId},
        'tiny_id',
        ${JSON.stringify([{ kind: 'tiny_id', value: options.sourceListingId }])}::jsonb,
        ${options.canonicalUrl},
        ${options.canonicalUrl},
        ${options.origin ?? 'replay'}::listing_observation_origin,
        ${options.propertyId},
        'source_exact',
        'available',
        400000,
        'EUR',
        now(),
        ${ingestBatchId},
        ${JSON.stringify({ title: `Legacy ${options.sourceListingId}` })}::jsonb
      )
      RETURNING id
    `);
    const observationId = Array.from(observationRows)[0]?.id;
    if (!observationId) throw new Error('Failed to create listing observation fixture');

    const canonicalRows = await db.execute<{ id: string }>(sql`
      INSERT INTO canonical_listings (
        property_id,
        source_name,
        primary_source_listing_id,
        canonical_url,
        display_url,
        status,
        status_source,
        verification_state,
        origin_summary,
        asking_price,
        price_currency,
        first_seen_at,
        last_seen_at,
        last_mirror_seen_at,
        last_reconciled_at
      )
      VALUES (
        ${options.propertyId},
        'funda',
        ${options.sourceListingId},
        ${options.canonicalUrl},
        ${options.canonicalUrl},
        'active',
        'mirror',
        'validated',
        'mirror',
        400000,
        'EUR',
        now(),
        now(),
        now(),
        now()
      )
      RETURNING id
    `);
    const canonicalListingId = Array.from(canonicalRows)[0]?.id;
    if (!canonicalListingId) throw new Error('Failed to create canonical listing fixture');

    await db.execute(sql`
      INSERT INTO listing_observation_links (
        canonical_listing_id,
        listing_observation_id,
        link_reason
      )
      VALUES (${canonicalListingId}, ${observationId}, 'source_identity')
    `);

    return { canonicalListingId, observationId, ingestBatchId };
  }

  beforeAll(() => {
    setSourceServiceApiKeys('test-funda-key', 'test-pararius-key');
    mockFetchFn = jest.fn() as jest.Mock<typeof global.fetch>;
    global.fetch = mockFetchFn;
  });

  beforeEach(() => {
    mockFetchFn.mockReset();
  });

  afterAll(async () => {
    try {
      for (const propertyId of propertyIds) {
        await db.execute(sql`
          DELETE FROM ingest_batches
          WHERE payload_json->>'canonicalListingId' IN (
            SELECT id::text FROM canonical_listings WHERE property_id = ${propertyId}
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
      await db.execute(sql`DELETE FROM ingest_batches WHERE idempotency_key LIKE 'legacy-cleanup-ingest-%'`);
    } finally {
      global.fetch = originalFetch;
      setSourceServiceApiKeys(originalFundaApiKey, originalParariusApiKey);
    }
  });

  it('selects legacy seeded candidates and excludes ingest-backed current listings', async () => {
    const legacyProperty = await createProperty('candidate');
    const currentProperty = await createProperty('ingest-backed');

    const legacy = await createLegacyListing({
      propertyId: legacyProperty.id,
      sourceListingId: '91000001',
      canonicalUrl: 'https://www.funda.nl/detail/91000001/',
    });
    const current = await createLegacyListing({
      propertyId: currentProperty.id,
      sourceListingId: '91000002',
      canonicalUrl: 'https://www.funda.nl/detail/91000002/',
      ingestBacked: true,
    });

    const candidates = await listLegacySeededListingCleanupCandidates({ source: 'funda', limit: 20 });
    const candidateIds = candidates.map((candidate) => candidate.canonicalListingId);
    expect(candidateIds).toContain(legacy.canonicalListingId);
    expect(candidateIds).not.toContain(current.canonicalListingId);

    const counts = await countLegacySeededListingCleanupCandidates({ source: 'funda' });
    expect(counts.funda).toBeGreaterThanOrEqual(1);

    await db.execute(sql`
      UPDATE canonical_listings
      SET status = 'withdrawn'
      WHERE id = ${legacy.canonicalListingId}
    `);
  });

  it('applies strong source-service outcomes and requests maintenance refreshes', async () => {
    const notFoundProperty = await createProperty('not-found');
    const availableProperty = await createProperty('available');
    const rentedProperty = await createProperty('rented');
    const parserErrorProperty = await createProperty('parser-error');

    await createLegacyListing({
      propertyId: notFoundProperty.id,
      sourceListingId: '92000001',
      canonicalUrl: 'https://www.funda.nl/detail/92000001/',
    });
    await createLegacyListing({
      propertyId: availableProperty.id,
      sourceListingId: '92000002',
      canonicalUrl: 'https://www.funda.nl/detail/92000002/',
    });
    await createLegacyListing({
      propertyId: rentedProperty.id,
      sourceListingId: '92000003',
      canonicalUrl: 'https://www.funda.nl/detail/92000003/',
    });
    await createLegacyListing({
      propertyId: parserErrorProperty.id,
      sourceListingId: '92000004',
      canonicalUrl: 'https://www.funda.nl/detail/92000004/',
    });

    const outcomes = new Map<string, ListingOutcome>([
      ['https://www.funda.nl/detail/92000001/', { state: 'not_found', sourceStatus: 'not_found' }],
      ['https://www.funda.nl/detail/92000002/', { state: 'matched', sourceStatus: 'available' }],
      ['https://www.funda.nl/detail/92000003/', { state: 'matched', sourceStatus: 'rented' }],
      ['https://www.funda.nl/detail/92000004/', { state: 'parser_error', sourceStatus: 'parser_error' }],
    ]);
    mockFetchFn.mockImplementation(async (input, init) => {
      const requestUrl = String(input);
      const body = JSON.parse(String(init?.body)) as { rawUrl: string; property?: { id: string } };
      const sourceListingId = body.rawUrl.match(/(\d+)\/$/)?.[1] ?? 'unknown';
      if (requestUrl.endsWith('/api/v1/listings/resolve-url')) {
        return jsonResponse({
          supported: true,
          sourceName: 'funda',
          rawUrl: body.rawUrl,
          canonicalUrl: body.rawUrl,
          sourceListingId,
          sourceListingIdKind: 'tiny_id',
          aliases: [{ kind: 'tiny_id', value: sourceListingId }],
          listingPath: `/detail/${sourceListingId}/`,
          reasonCode: null,
        });
      }
      const outcome = outcomes.get(body.rawUrl);
      if (!outcome) throw new Error(`Missing fake outcome for ${body.rawUrl}`);
      return jsonResponse({
        state: outcome.state,
        sourceName: 'funda',
        rawUrl: body.rawUrl,
        canonicalUrl: body.rawUrl,
        sourceListingId,
        sourceListingIdKind: 'tiny_id',
        aliases: [{ kind: 'tiny_id', value: sourceListingId }],
        sourceStatus: outcome.sourceStatus,
        matchedPropertyEvidence: {
          propertyId: body.property?.id,
          matchKind: 'source_exact',
        },
        title: `Validated ${sourceListingId}`,
      });
    });

    const summary = await cleanupLegacySeededListings({
      source: 'funda',
      limit: 4,
      execute: true,
    });

    expect(summary.validatedCount).toBe(4);
    expect(summary.appliedCount).toBe(3);
    expect(summary.changedCount).toBe(2);
    expect(summary.keptActiveCount).toBe(1);
    expect(summary.skippedCount).toBe(1);
    expect(summary.maintenanceRefreshRequestCount).toBe(3);
    expect(summary.results.find((result) => result.validation?.state === 'parser_error')?.applied).toBe(false);

    const canonicalRows = await db
      .select({
        propertyId: canonicalListings.propertyId,
        status: canonicalListings.status,
        verificationState: canonicalListings.verificationState,
        title: canonicalListings.title,
      })
      .from(canonicalListings)
      .where(sql`${canonicalListings.propertyId} IN (${notFoundProperty.id}, ${availableProperty.id}, ${rentedProperty.id}, ${parserErrorProperty.id})`);
    const byProperty = new Map(canonicalRows.map((row) => [row.propertyId, row]));
    expect(byProperty.get(notFoundProperty.id)).toMatchObject({ status: 'withdrawn', verificationState: 'validated' });
    expect(byProperty.get(availableProperty.id)).toMatchObject({
      status: 'active',
      verificationState: 'validated',
      title: 'Validated 92000002',
    });
    expect(byProperty.get(rentedProperty.id)).toMatchObject({ status: 'rented', verificationState: 'validated' });
    expect(byProperty.get(parserErrorProperty.id)).toMatchObject({
      status: 'active',
      title: null,
    });

    const validationObservationRows = await db
      .select({ id: listingObservations.id })
      .from(listingObservations)
      .where(sql`
        ${listingObservations.propertyId} IN (${notFoundProperty.id}, ${availableProperty.id}, ${rentedProperty.id})
        AND ${listingObservations.origin} = 'validation'
      `);
    expect(validationObservationRows).toHaveLength(3);

    const watchRows = await db
      .select({ id: mirrorListingWatches.id, state: mirrorListingWatches.state })
      .from(mirrorListingWatches)
      .where(sql`${mirrorListingWatches.propertyId} IN (${notFoundProperty.id}, ${availableProperty.id}, ${rentedProperty.id}, ${parserErrorProperty.id})`);
    expect(watchRows).toHaveLength(3);
    expect(watchRows.map((row) => row.state).sort()).toEqual(['matched', 'matched', 'not_found']);

    const maintenanceRows = await db
      .select({ id: ingestBatches.id })
      .from(ingestBatches)
      .where(sql`
        ${ingestBatches.id} IN (${sql.join(summary.maintenanceBatchIds.map((id) => sql`${id}`), sql`,`)})
        AND ${ingestBatches.maintenanceCompletedAt} IS NULL
      `);
    expect(maintenanceRows).toHaveLength(3);
  });
});

type ListingOutcome = {
  state: 'matched' | 'not_found' | 'parser_error';
  sourceStatus: 'available' | 'rented' | 'not_found' | 'parser_error';
};
