import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import {
  ingestBatches,
  ingestRuns,
  ingestSources,
  listings,
  priceHistory,
  properties,
} from '../../db/schema.js';
import {
  acceptIngestBatch,
  collectRecoveryDispatchWork,
  encodeOpaqueIngestCursor,
  processIngestBatch,
  createMaintenanceRefreshRequest,
  refreshLatestListingsMaintenance,
} from '../../services/ingest/index.js';

describe('Durable ingest API contract', () => {
  let app: FastifyInstance;
  const originalIngestApiKey = process.env.INGEST_API_KEY;
  const cleanupPropertyIds: string[] = [];
  const cleanupSourceNames = ['idealista', 'fotocasa'];

  async function resetIngestSourceState(sourceName: string) {
    await db.delete(priceHistory).where(eq(priceHistory.source, sourceName));
    await db.delete(listings).where(eq(listings.sourceName, sourceName));
    await db.delete(ingestBatches).where(eq(ingestBatches.sourceName, sourceName));
    await db.delete(ingestRuns).where(eq(ingestRuns.sourceName, sourceName));
    await db.delete(ingestSources).where(eq(ingestSources.sourceName, sourceName));
  }

  beforeAll(async () => {
    process.env.INGEST_API_KEY = 'test-ingest-api-key';
    app = await buildApp({ logger: false });
  });

  beforeEach(async () => {
    await resetIngestSourceState('idealista');
    await resetIngestSourceState('fotocasa');
  });

  afterAll(async () => {
    try {
      await db.delete(priceHistory).where(inArray(priceHistory.source, cleanupSourceNames));
      await db.delete(listings).where(inArray(listings.sourceName, cleanupSourceNames));
      await db.delete(ingestSources).where(inArray(ingestSources.sourceName, cleanupSourceNames));
      await db.delete(ingestBatches).where(inArray(ingestBatches.sourceName, cleanupSourceNames));
      await db.delete(ingestRuns).where(inArray(ingestRuns.sourceName, cleanupSourceNames));

      if (cleanupPropertyIds.length > 0) {
        await db.delete(properties).where(inArray(properties.id, cleanupPropertyIds));
      }
    } finally {
      process.env.INGEST_API_KEY = originalIngestApiKey;
      await app.close();
    }
  });

  it('accepts ingest batches durably and returns the durable watermark state', async () => {
    const cursorEnd = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T12:34:56.000Z',
      listingKey: 'idealista-acceptance-1',
    });

    const payload = {
      sourceName: 'idealista',
      idempotencyKey: `idealista-batch-${Date.now()}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd,
      upstreamRunKey: `idealista-run-${Date.now()}`,
      listings: [
        {
          sourceUrl: 'https://www.idealista.com/inmueble/123456/',
          mirrorListingId: `idealista-acceptance-${Date.now()}`,
          askingPrice: 520000,
          priceType: 'sale' as const,
          ogTitle: 'Exact match acceptance test',
          address: {
            countryCode: 'ES',
            street: 'Calle Mayor',
            postalCode: '28013',
            houseNumber: 12,
            city: 'Madrid',
          },
        },
      ],
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/ingest/listings',
      headers: {
        'x-api-key': 'test-ingest-api-key',
      },
      payload,
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body);
    expect(body.sourceName).toBe('idealista');
    expect(body.idempotencyKey).toBe(payload.idempotencyKey);
    expect(body.duplicate).toBe(false);
    expect(['accepted', 'queued']).toContain(body.status);
    expect(body.batchId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const duplicateResponse = await app.inject({
      method: 'POST',
      url: '/api/ingest/listings',
      headers: {
        'x-api-key': 'test-ingest-api-key',
      },
      payload,
    });

    expect(duplicateResponse.statusCode).toBe(202);
    const duplicateBody = JSON.parse(duplicateResponse.body);
    expect(duplicateBody.batchId).toBe(body.batchId);
    expect(duplicateBody.duplicate).toBe(true);

    const [storedBatch] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, body.batchId))
      .limit(1);

    expect(storedBatch).toBeDefined();
    expect(storedBatch?.sourceName).toBe('idealista');
    expect(storedBatch?.idempotencyKey).toBe(payload.idempotencyKey);
    expect(storedBatch?.cursorEnd).toBe(cursorEnd);
    expect(storedBatch?.payloadJson).toMatchObject({
      sourceName: 'idealista',
      listings: [
        {
          mirrorListingId: payload.listings[0].mirrorListingId,
          address: {
            countryCode: 'ES',
            street: 'Calle Mayor',
            postalCode: '28013',
            houseNumber: 12,
          },
        },
      ],
    });

    await db
      .update(ingestSources)
      .set({
        lastCommittedCursor: cursorEnd,
        lastCommittedChangedAt: new Date('2026-04-06T12:34:56.000Z'),
        lastCommittedListingKey: 'idealista-acceptance-1',
        lastBatchId: body.batchId,
      })
      .where(eq(ingestSources.sourceName, 'idealista'));

    const watermarkResponse = await app.inject({
      method: 'GET',
      url: '/api/ingest/watermark?source=idealista',
      headers: {
        'x-api-key': 'test-ingest-api-key',
      },
    });

    expect(watermarkResponse.statusCode).toBe(200);
    expect(JSON.parse(watermarkResponse.body)).toEqual({
      sourceName: 'idealista',
      cursor: cursorEnd,
      lastCommittedChangedAt: '2026-04-06T12:34:56.000Z',
      lastCommittedListingKey: 'idealista-acceptance-1',
      lastBatchId: body.batchId,
    });
  });

  it('requeues stale processing batches during the recovery sweep', async () => {
    const staleStartedAt = new Date('2026-04-09T03:30:00.000Z');
    const cutoff = new Date('2026-04-09T03:45:00.000Z');
    const idempotencyKey = `idealista-stale-${Date.now()}`;

    const [staleBatch] = await db
      .insert(ingestBatches)
      .values({
        sourceName: 'idealista',
        batchSequence: 0,
        idempotencyKey,
        cursorEnd: encodeOpaqueIngestCursor({
          changedAt: staleStartedAt.toISOString(),
          listingKey: idempotencyKey,
        }),
        payloadJson: {
          sourceName: 'idealista',
          listings: [],
        },
        status: 'processing',
        startedAt: staleStartedAt,
      })
      .returning({ id: ingestBatches.id });

    const result = await collectRecoveryDispatchWork(cutoff);

    expect(result.staleProcessingBatchIds).toContain(staleBatch.id);

    const [updatedBatch] = await db
      .select({
        status: ingestBatches.status,
        errorJson: ingestBatches.errorJson,
      })
      .from(ingestBatches)
      .where(eq(ingestBatches.id, staleBatch.id))
      .limit(1);

    expect(updatedBatch?.status).toBe('retryable');
    expect(updatedBatch?.errorJson).toMatchObject({
      message: 'Requeued by recovery sweep after stale processing window',
    });
  });

  it('rejects conflicting idempotency replays before mutating run or source state', async () => {
    const runKey = `idealista-conflict-run-${Date.now()}`;
    const idempotencyKey = `idealista-conflict-${Date.now()}`;
    const originalCursorEnd = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T13:00:00.000Z',
      listingKey: 'idealista-conflict-1',
    });
    const conflictingCursorEnd = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T14:00:00.000Z',
      listingKey: 'idealista-conflict-2',
    });

    const accepted = await acceptIngestBatch({
      sourceName: 'idealista',
      idempotencyKey,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: originalCursorEnd,
      upstreamRunKey: runKey,
      listings: [
        {
          sourceUrl: 'https://www.idealista.com/inmueble/999999/',
          mirrorListingId: `idealista-conflict-original-${Date.now()}`,
          askingPrice: 610000,
          priceType: 'sale',
          status: 'active' as const,
          address: {
            countryCode: 'ES',
            street: 'Calle del Conflict',
            postalCode: '28001',
            houseNumber: 1,
            city: 'Madrid',
          },
        },
      ],
    });

    expect(accepted.duplicate).toBe(false);
    expect(accepted.runId).toBeTruthy();

    const replay = {
      sourceName: 'idealista',
      idempotencyKey,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: conflictingCursorEnd,
      upstreamRunKey: runKey,
      listings: [
        {
          sourceUrl: 'https://www.idealista.com/inmueble/999999/',
          mirrorListingId: `idealista-conflict-original-${Date.now()}`,
          askingPrice: 610000,
          priceType: 'sale' as const,
          status: 'active' as const,
          address: {
            countryCode: 'ES',
            street: 'Calle del Conflict',
            postalCode: '28001',
            houseNumber: 1,
            city: 'Madrid',
          },
        },
      ],
    };

    await expect(acceptIngestBatch(replay)).rejects.toThrow('Idempotency key');

    const [runState] = await db
      .select()
      .from(ingestRuns)
      .where(eq(ingestRuns.id, accepted.runId as string))
      .limit(1);

    expect(runState).toBeDefined();
    expect(runState?.upstreamCursorEnd).toBe(originalCursorEnd);

    const [sourceState] = await db
      .select()
      .from(ingestSources)
      .where(eq(ingestSources.sourceName, 'idealista'))
      .limit(1);

    expect(sourceState).toBeDefined();
    expect(sourceState?.lastRunStatus).toBe('in_progress');
  });

  it('only completes maintenance rows that were pending when the refresh started', async () => {
    const maintenanceSourceName = `maintenance-test-${Date.now()}`;
    const beforeRequest = await db.transaction(async (tx) =>
      createMaintenanceRefreshRequest(tx, {
        sourceName: maintenanceSourceName,
        requestedBy: 'listing-submit',
        idempotencyKey: `${maintenanceSourceName}-before`,
        payload: {
          reason: 'before-refresh',
        },
      }),
    );

    let duringRequestId: string | null = null;

    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const refreshedCount = await refreshLatestListingsMaintenance(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        await db.transaction(async (tx) => {
          const duringRequest = await createMaintenanceRefreshRequest(tx, {
            sourceName: maintenanceSourceName,
            requestedBy: 'listing-submit',
            idempotencyKey: `${maintenanceSourceName}-during`,
            payload: {
              reason: 'during-refresh',
            },
          });

          duringRequestId = duringRequest.batchId;
        });
      });

      expect(refreshedCount).toBeGreaterThanOrEqual(1);
      expect(duringRequestId).toBeTruthy();

      const [beforeRow] = await db
        .select()
        .from(ingestBatches)
        .where(eq(ingestBatches.id, beforeRequest.batchId))
        .limit(1);

      const [duringRow] = await db
        .select()
        .from(ingestBatches)
        .where(eq(ingestBatches.id, duringRequestId!))
        .limit(1);

      expect(beforeRow).toBeDefined();
      expect(beforeRow?.maintenanceRequestedAt).not.toBeNull();
      expect(beforeRow?.maintenanceCompletedAt).not.toBeNull();

      expect(duringRow).toBeDefined();
      expect(duringRow?.maintenanceRequestedAt).not.toBeNull();
      expect(duringRow?.maintenanceCompletedAt).toBeNull();
    } finally {
      const cleanupIds = [beforeRequest.batchId, duringRequestId].filter(
        (value): value is string => typeof value === 'string',
      );

      if (cleanupIds.length > 0) {
        await db.delete(ingestBatches).where(inArray(ingestBatches.id, cleanupIds));
      }
    }
  });

  it('tracks run lifecycle completion across multiple batches and links price history to listings', async () => {
    const runKey = `fotocasa-run-${Date.now()}`;
    const firstMirrorListingId = `fotocasa-listing-a-${Date.now()}`;
    const secondMirrorListingId = `fotocasa-listing-b-${Date.now()}`;
    const propertySeed = await db
      .insert(properties)
      .values([
        {
          countryCode: 'NL',
          street: 'Alphaweg',
          houseNumber: 10,
          houseNumberAddition: null,
          city: 'Eindhoven',
          postalCode: '1234AB',
          status: 'active',
        },
        {
          countryCode: 'NL',
          street: 'Betaweg',
          houseNumber: 12,
          houseNumberAddition: null,
          city: 'Eindhoven',
          postalCode: '1234AB',
          status: 'active',
        },
      ])
      .returning({ id: properties.id, street: properties.street });

    cleanupPropertyIds.push(...propertySeed.map((row) => row.id));

    const alphaProperty = propertySeed.find((row) => row.street === 'Alphaweg');
    const betaProperty = propertySeed.find((row) => row.street === 'Betaweg');
    expect(alphaProperty).toBeDefined();
    expect(betaProperty).toBeDefined();

    const firstAccepted = await acceptIngestBatch({
      sourceName: 'fotocasa',
      idempotencyKey: `fotocasa-first-${Date.now()}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T15:00:00.000Z',
        listingKey: 'fotocasa-1',
      }),
      upstreamRunKey: runKey,
      listings: [
        {
          sourceUrl: 'https://www.fotocasa.es/es/comprar/vivienda/eindhoven/alpha',
          mirrorListingId: firstMirrorListingId,
          askingPrice: 399000,
          priceType: 'sale',
          livingAreaM2: 88,
          numRooms: 4,
          energyLabel: 'A',
          status: 'active',
          mirrorFirstSeenAt: '2026-04-05T15:00:00.000Z',
          mirrorLastChangedAt: '2026-04-06T15:00:00.000Z',
          mirrorLastSeenAt: '2026-04-06T15:10:00.000Z',
          address: {
            countryCode: 'NL',
            street: 'Alphaweg',
            postalCode: '1234 AB',
            houseNumber: 10,
            houseNumberAddition: null,
            city: 'Eindhoven',
            latitude: 5.478,
            longitude: 51.44,
          },
          priceHistory: [
            {
              price: 399000,
              priceDate: '2026-04-06',
              eventType: 'asking_price',
            },
          ],
        },
      ],
    });

    const secondAccepted = await acceptIngestBatch({
      sourceName: 'fotocasa',
      idempotencyKey: `fotocasa-second-${Date.now()}`,
      batchSequence: 1,
      cursorStart: encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T15:00:00.000Z',
        listingKey: 'fotocasa-1',
      }),
      cursorEnd: encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T15:30:00.000Z',
        listingKey: 'fotocasa-2',
      }),
      upstreamRunKey: runKey,
      listings: [
        {
          sourceUrl: 'https://www.fotocasa.es/es/comprar/vivienda/eindhoven/beta',
          mirrorListingId: secondMirrorListingId,
          askingPrice: 425000,
          priceType: 'sale',
          livingAreaM2: 92,
          numRooms: 5,
          energyLabel: 'B',
          status: 'active',
          mirrorFirstSeenAt: '2026-04-05T16:00:00.000Z',
          mirrorLastChangedAt: '2026-04-06T16:00:00.000Z',
          mirrorLastSeenAt: '2026-04-06T16:10:00.000Z',
          address: {
            countryCode: 'NL',
            street: 'Betaweg',
            postalCode: '1234 AB',
            houseNumber: 12,
            houseNumberAddition: null,
            city: 'Eindhoven',
            latitude: 5.479,
            longitude: 51.441,
          },
          priceHistory: [
            {
              price: 425000,
              priceDate: '2026-04-06',
              eventType: 'asking_price',
            },
          ],
        },
      ],
    });

    expect(firstAccepted.runId).toBe(secondAccepted.runId);

    const firstResult = await processIngestBatch({
      batchId: firstAccepted.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    expect(firstResult).toEqual({
      status: 'completed',
      ingested: 1,
      updated: 0,
      skipped: 0,
    });

    const [storedListing] = await db
      .select()
      .from(listings)
      .where(
        and(
          eq(listings.sourceName, 'fotocasa'),
          eq(listings.mirrorListingId, firstMirrorListingId),
        ),
      )
      .limit(1);

    expect(storedListing).toBeDefined();
    const matchedListing = storedListing;
    expect(matchedListing?.propertyId).toBe(alphaProperty?.id);
    expect(matchedListing?.sourceUrl).toBe('https://www.fotocasa.es/es/comprar/vivienda/eindhoven/alpha');

    const [historyRow] = await db
      .select()
      .from(priceHistory)
      .where(eq(priceHistory.source, 'fotocasa'))
      .limit(1);

    expect(historyRow).toBeDefined();
    expect(historyRow?.propertyId).toBe(alphaProperty?.id);
    expect(historyRow?.listingId).toBe(matchedListing?.id);

    expect(firstAccepted.runId).toBeTruthy();
    const runId = firstAccepted.runId as string;

    const [midRunState] = await db
      .select()
      .from(ingestRuns)
      .where(eq(ingestRuns.id, runId))
      .limit(1);

    expect(midRunState).toBeDefined();
    expect(midRunState?.status).toBe('in_progress');
    expect(midRunState?.processedBatchCount).toBe(1);
    expect(midRunState?.completedAt).toBeNull();
    expect(midRunState?.errorSummary).toBeNull();

    const [midSourceState] = await db
      .select()
      .from(ingestSources)
      .where(eq(ingestSources.sourceName, 'fotocasa'))
      .limit(1);

    expect(midSourceState).toBeDefined();
    expect(midSourceState?.lastCommittedListingKey).toBe('fotocasa-1');
    expect(midSourceState?.lastBatchId).toBe(firstAccepted.batchId);
    expect(midSourceState?.lastRunStatus).toBe('in_progress');
    expect(midSourceState?.lastRunCompletedAt).toBeNull();

    const secondResult = await processIngestBatch({
      batchId: secondAccepted.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    expect(secondResult).toEqual({
      status: 'completed',
      ingested: 1,
      updated: 0,
      skipped: 0,
    });

    const [runState] = await db
      .select()
      .from(ingestRuns)
      .where(eq(ingestRuns.id, runId))
      .limit(1);

    expect(runState).toBeDefined();
    expect(runState?.status).toBe('completed');
    expect(runState?.processedBatchCount).toBe(2);
    expect(runState?.completedAt).not.toBeNull();
    expect(runState?.errorSummary).toBeNull();

    const [sourceState] = await db
      .select()
      .from(ingestSources)
      .where(eq(ingestSources.sourceName, 'fotocasa'))
      .limit(1);

    expect(sourceState).toBeDefined();
    expect(sourceState?.lastCommittedListingKey).toBe('fotocasa-2');
    expect(sourceState?.lastBatchId).toBe(secondAccepted.batchId);
    expect(sourceState?.lastRunStatus).toBe('completed');
    expect(sourceState?.lastRunCompletedAt).not.toBeNull();

    const [batchState] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, secondAccepted.batchId))
      .limit(1);

    expect(batchState?.status).toBe('completed');
    expect(batchState?.ingestedCount).toBe(1);
    expect(batchState?.updatedCount).toBe(0);
    expect(batchState?.maintenanceRequestedAt).not.toBeNull();
  });

  it('does not let listing-submit maintenance rows advance the committed ingest cursor', async () => {
    const sourceName = 'fotocasa';
    const street = `Deltaweg-${Date.now()}`;
    const propertySeed = await db
      .insert(properties)
      .values({
        countryCode: 'NL',
        street,
        houseNumber: 16,
        houseNumberAddition: null,
        city: 'Eindhoven',
        postalCode: '1234AB',
        status: 'active',
      })
      .returning({ id: properties.id });

    const propertyId = propertySeed[0]?.id;
    expect(propertyId).toBeTruthy();
    cleanupPropertyIds.push(propertyId as string);

    await db.transaction(async (tx) => {
      await createMaintenanceRefreshRequest(tx, {
        sourceName,
        requestedBy: 'listing-submit',
        idempotencyKey: `listing-submit-${Date.now()}`,
        payload: {
          propertyId,
        },
      });
    });

    const cursorEnd = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T18:00:00.000Z',
      listingKey: 'fotocasa-real-1',
    });

    const accepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-real-${Date.now()}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd,
      upstreamRunKey: `fotocasa-real-run-${Date.now()}`,
      listings: [
        {
          sourceUrl: 'https://www.fotocasa.es/es/comprar/vivienda/eindhoven/delta',
          mirrorListingId: `fotocasa-real-listing-${Date.now()}`,
          askingPrice: 440000,
          priceType: 'sale',
          status: 'active' as const,
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 16,
            city: 'Eindhoven',
          },
        },
      ],
    });

    await processIngestBatch({
      batchId: accepted.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    const [sourceState] = await db
      .select()
      .from(ingestSources)
      .where(eq(ingestSources.sourceName, sourceName))
      .limit(1);

    expect(sourceState?.lastCommittedCursor).toBe(cursorEnd);
    expect(sourceState?.lastCommittedListingKey).toBe('fotocasa-real-1');
    expect(sourceState?.lastBatchId).toBe(accepted.batchId);
  });

  it('defers out-of-order batches until their predecessor commits', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const firstStreet = `Orderweg-${stamp}`;
    const secondStreet = `Orderweg-${stamp + 1}`;
    const propertiesSeed = await db
      .insert(properties)
      .values([
        {
          countryCode: 'NL',
          street: firstStreet,
          houseNumber: 20,
          houseNumberAddition: null,
          city: 'Eindhoven',
          postalCode: '1234AB',
          status: 'active',
        },
        {
          countryCode: 'NL',
          street: secondStreet,
          houseNumber: 22,
          houseNumberAddition: null,
          city: 'Eindhoven',
          postalCode: '1234AB',
          status: 'active',
        },
      ])
      .returning({ id: properties.id });

    cleanupPropertyIds.push(...propertiesSeed.map((row) => row.id));

    const firstCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T19:00:00.000Z',
      listingKey: 'fotocasa-order-1',
    });
    const secondCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T19:30:00.000Z',
      listingKey: 'fotocasa-order-2',
    });

    const firstAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-order-first-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: firstCursor,
      upstreamRunKey: `fotocasa-order-run-${stamp}`,
      listings: [
        {
          sourceUrl: `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/order-${stamp}`,
          mirrorListingId: `fotocasa-order-listing-${stamp}`,
          askingPrice: 450000,
          priceType: 'sale',
          status: 'active' as const,
          address: {
            countryCode: 'NL',
            street: firstStreet,
            postalCode: '1234 AB',
            houseNumber: 20,
            city: 'Eindhoven',
          },
        },
      ],
    });

    const secondAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-order-second-${stamp}`,
      batchSequence: 1,
      cursorStart: firstCursor,
      cursorEnd: secondCursor,
      upstreamRunKey: `fotocasa-order-run-${stamp}`,
      listings: [
        {
          sourceUrl: `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/order-${stamp + 1}`,
          mirrorListingId: `fotocasa-order-listing-${stamp + 1}`,
          askingPrice: 460000,
          priceType: 'sale',
          status: 'active' as const,
          address: {
            countryCode: 'NL',
            street: secondStreet,
            postalCode: '1234 AB',
            houseNumber: 22,
            city: 'Eindhoven',
          },
        },
      ],
    });

    const outOfOrderResult = await processIngestBatch({
      batchId: secondAccepted.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    expect(outOfOrderResult).toEqual({
      status: 'noop',
      ingested: 0,
      updated: 0,
      skipped: 0,
    });

    const [deferredBatch] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, secondAccepted.batchId))
      .limit(1);

    expect(deferredBatch?.status).toBe('accepted');
    expect(deferredBatch?.attemptCount).toBe(0);

    await processIngestBatch({
      batchId: firstAccepted.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    const secondResult = await processIngestBatch({
      batchId: secondAccepted.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    expect(secondResult).toEqual({
      status: 'completed',
      ingested: 1,
      updated: 0,
      skipped: 0,
    });
  });

  it('marks a terminal ingest failure on the run and source ledger', async () => {
    const runKey = `fotocasa-failure-run-${Date.now()}`;
    const failureProperty = await db
      .insert(properties)
      .values([
        {
          countryCode: 'NL',
          street: 'Gammaweg',
          houseNumber: 14,
          houseNumberAddition: null,
          city: 'Eindhoven',
          postalCode: '1234AB',
          status: 'active',
        },
      ])
      .returning({ id: properties.id });

    cleanupPropertyIds.push(...failureProperty.map((row) => row.id));

    const accepted = await acceptIngestBatch({
      sourceName: 'fotocasa',
      idempotencyKey: `fotocasa-failure-${Date.now()}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T17:00:00.000Z',
        listingKey: 'fotocasa-failure-1',
      }),
      upstreamRunKey: runKey,
      listings: [
        {
          sourceUrl: 'https://www.fotocasa.es/es/comprar/vivienda/eindhoven/failure',
          mirrorListingId: `fotocasa-failure-listing-${Date.now()}`,
          askingPrice: 510000,
          priceType: 'sale' as const,
          status: 'active' as const,
          ogTitle: 'Failure path listing',
          address: {
            countryCode: 'NL',
            street: 'Gammaweg',
            postalCode: '1234 AB',
            houseNumber: 14,
            city: 'Eindhoven',
          },
        },
        {
          sourceUrl: 'https://www.fotocasa.es/es/comprar/vivienda/eindhoven/failure',
          mirrorListingId: `fotocasa-failure-listing-dup-${Date.now()}`,
          askingPrice: 515000,
          priceType: 'sale' as const,
          status: 'active' as const,
          ogTitle: 'Failure path duplicate listing',
          address: {
            countryCode: 'NL',
            street: 'Gammaweg',
            postalCode: '1234 AB',
            houseNumber: 14,
            city: 'Eindhoven',
          },
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: accepted.batchId,
        maxAttempts: 1,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).rejects.toThrow();

    const [failedBatch] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, accepted.batchId))
      .limit(1);

    expect(failedBatch?.status).toBe('failed');
    expect(failedBatch?.errorJson).toBeTruthy();

    expect(accepted.runId).toBeTruthy();
    const failedRunId = accepted.runId as string;

    const [failedRun] = await db
      .select()
      .from(ingestRuns)
      .where(eq(ingestRuns.id, failedRunId))
      .limit(1);

    expect(failedRun).toBeDefined();
    expect(failedRun?.status).toBe('failed');
    expect(failedRun?.processedBatchCount).toBe(1);
    expect(failedRun?.completedAt).not.toBeNull();
    expect(failedRun?.errorSummary).toMatchObject({
      terminalBatchId: accepted.batchId,
      runId: failedRunId,
      sourceName: 'fotocasa',
      status: 'failed',
    });

    const [failedSource] = await db
      .select()
      .from(ingestSources)
      .where(eq(ingestSources.sourceName, 'fotocasa'))
      .limit(1);

    expect(failedSource).toBeDefined();
    expect(failedSource?.lastRunStatus).toBe('failed');
    expect(failedSource?.lastRunCompletedAt).not.toBeNull();
  });
});
