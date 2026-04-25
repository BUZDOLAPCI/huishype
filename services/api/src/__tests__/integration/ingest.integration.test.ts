import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import {
  ingestBatches,
  ingestRuns,
  ingestSources,
  canonicalListings,
  listings,
  listingObservations,
  listingPriceObservations,
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
  SKIPPED_BATCH_RECOVERY_COOLDOWN_MS,
} from '../../services/ingest/index.js';

describe('Durable ingest API contract', () => {
  let app: FastifyInstance;
  const originalIngestApiKey = process.env.INGEST_API_KEY;
  const cleanupPropertyIds: string[] = [];
  const cleanupSourceNames = ['idealista', 'fotocasa'];

  async function resetIngestSourceState(sourceName: string) {
    await db.delete(priceHistory).where(eq(priceHistory.source, sourceName));
    await db.delete(listings).where(eq(listings.sourceName, sourceName));
    await db.delete(listingPriceObservations).where(eq(listingPriceObservations.sourceName, sourceName));
    await db.delete(listingObservations).where(eq(listingObservations.sourceName, sourceName));
    await db.delete(canonicalListings).where(eq(canonicalListings.sourceName, sourceName));
    await db.delete(ingestBatches).where(eq(ingestBatches.sourceName, sourceName));
    await db.delete(ingestRuns).where(eq(ingestRuns.sourceName, sourceName));
    await db.delete(ingestSources).where(eq(ingestSources.sourceName, sourceName));
  }

  async function seedProperty(input: {
    street: string;
    houseNumber: number;
    postalCode?: string;
    city?: string;
  }): Promise<string> {
    const inserted = await db
      .insert(properties)
      .values({
        countryCode: 'NL',
        street: input.street,
        houseNumber: input.houseNumber,
        houseNumberAddition: null,
        city: input.city ?? 'Eindhoven',
        postalCode: input.postalCode ?? '1234AB',
        status: 'active',
      })
      .returning({ id: properties.id });

    const propertyId = inserted[0]?.id;
    expect(propertyId).toBeTruthy();
    cleanupPropertyIds.push(propertyId as string);
    return propertyId as string;
  }

  async function createSkippedCompletedBatch(input: {
    sourceName: string;
    stamp: number;
    street: string;
    houseNumber: number;
    mirrorListingId: string;
    sourceUrl: string;
  }): Promise<{ batchId: string; cursorEnd: string }> {
    const cursorEnd = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T14:00:00.000Z',
      listingKey: `${input.sourceName}-recovery-${input.stamp}`,
    });

    const accepted = await acceptIngestBatch({
      sourceName: input.sourceName,
      idempotencyKey: `${input.sourceName}-recovery-${input.stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd,
      upstreamRunKey: `${input.sourceName}-recovery-run-${input.stamp}`,
      listings: [
        {
          sourceUrl: input.sourceUrl,
          mirrorListingId: input.mirrorListingId,
          askingPrice: 515000,
          priceType: 'sale',
          status: 'active' as const,
          mirrorFirstSeenAt: '2026-04-05T14:00:00.000Z',
          mirrorLastChangedAt: '2026-04-06T14:00:00.000Z',
          mirrorLastSeenAt: '2026-04-06T14:10:00.000Z',
          address: {
            countryCode: 'NL',
            street: input.street,
            postalCode: '1234 AB',
            houseNumber: input.houseNumber,
            city: 'Eindhoven',
          },
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: accepted.batchId,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 0,
      updated: 0,
      skipped: 1,
    });

    return {
      batchId: accepted.batchId,
      cursorEnd,
    };
  }

  async function seedCompletedBatchRecord(input: {
    sourceName: string;
    stamp: number;
    suffix: string;
    completedAt: string;
  }): Promise<string> {
    const [inserted] = await db
      .insert(ingestBatches)
      .values({
        sourceName: input.sourceName,
        batchSequence: 0,
        idempotencyKey: `${input.sourceName}-${input.suffix}-${input.stamp}`,
        cursorEnd: encodeOpaqueIngestCursor({
          changedAt: input.completedAt,
          listingKey: `${input.sourceName}-${input.suffix}-${input.stamp}`,
        }),
        payloadJson: {
          sourceName: input.sourceName,
          listings: [],
        },
        status: 'completed',
        completedAt: new Date(input.completedAt),
      })
      .returning({ id: ingestBatches.id });

    const batchId = inserted?.id;
    expect(batchId).toBeTruthy();
    return batchId as string;
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
      await db.delete(listingPriceObservations).where(inArray(listingPriceObservations.sourceName, cleanupSourceNames));
      await db.delete(listingObservations).where(inArray(listingObservations.sourceName, cleanupSourceNames));
      await db.delete(canonicalListings).where(inArray(canonicalListings.sourceName, cleanupSourceNames));
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

  it('dispatches only the next cursor batch for a source during recovery', async () => {
    const stamp = Date.now();
    const runKey = `idealista-recovery-order-run-${stamp}`;
    const firstCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-09T04:00:00.000Z',
      listingKey: `idealista-recovery-order-1-${stamp}`,
    });
    const secondCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-09T04:30:00.000Z',
      listingKey: `idealista-recovery-order-2-${stamp}`,
    });

    const firstAccepted = await acceptIngestBatch({
      sourceName: 'idealista',
      idempotencyKey: `idealista-recovery-order-first-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: firstCursor,
      upstreamRunKey: runKey,
      listings: [
        {
          sourceUrl: `https://www.idealista.com/inmueble/recovery-order-${stamp}/`,
          mirrorListingId: `idealista-recovery-order-listing-${stamp}`,
          askingPrice: 520000,
          priceType: 'sale',
          status: 'active' as const,
          address: {
            countryCode: 'ES',
            street: 'Calle Recovery',
            postalCode: '28013',
            houseNumber: 1,
            city: 'Madrid',
          },
        },
      ],
    });

    const secondAccepted = await acceptIngestBatch({
      sourceName: 'idealista',
      idempotencyKey: `idealista-recovery-order-second-${stamp}`,
      batchSequence: 1,
      cursorStart: firstCursor,
      cursorEnd: secondCursor,
      upstreamRunKey: runKey,
      listings: [
        {
          sourceUrl: `https://www.idealista.com/inmueble/recovery-order-${stamp + 1}/`,
          mirrorListingId: `idealista-recovery-order-listing-${stamp + 1}`,
          askingPrice: 530000,
          priceType: 'sale',
          status: 'active' as const,
          address: {
            countryCode: 'ES',
            street: 'Calle Recovery',
            postalCode: '28013',
            houseNumber: 2,
            city: 'Madrid',
          },
        },
      ],
    });

    await db
      .update(ingestBatches)
      .set({ status: 'queued' })
      .where(inArray(ingestBatches.id, [firstAccepted.batchId, secondAccepted.batchId]));

    const result = await collectRecoveryDispatchWork(new Date('2026-04-09T05:00:00.000Z'));

    expect(result.recoverableBatchIds).toContain(firstAccepted.batchId);
    expect(result.recoverableBatchIds).not.toContain(secondAccepted.batchId);
  });

  it('supersedes queued batches already covered by the committed watermark', async () => {
    const stamp = Date.now();
    const runKey = `idealista-superseded-run-${stamp}`;
    const firstCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-09T06:00:00.000Z',
      listingKey: `idealista-superseded-1-${stamp}`,
    });
    const committedCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-09T06:30:00.000Z',
      listingKey: `idealista-superseded-2-${stamp}`,
    });

    const firstAccepted = await acceptIngestBatch({
      sourceName: 'idealista',
      idempotencyKey: `idealista-superseded-first-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: firstCursor,
      upstreamRunKey: runKey,
      listings: [
        {
          sourceUrl: `https://www.idealista.com/inmueble/superseded-${stamp}/`,
          mirrorListingId: `idealista-superseded-listing-${stamp}`,
          askingPrice: 540000,
          priceType: 'sale',
          status: 'active' as const,
          address: {
            countryCode: 'ES',
            street: 'Calle Superseded',
            postalCode: '28013',
            houseNumber: 3,
            city: 'Madrid',
          },
        },
      ],
    });

    const secondAccepted = await acceptIngestBatch({
      sourceName: 'idealista',
      idempotencyKey: `idealista-superseded-second-${stamp}`,
      batchSequence: 1,
      cursorStart: firstCursor,
      cursorEnd: committedCursor,
      upstreamRunKey: runKey,
      listings: [
        {
          sourceUrl: `https://www.idealista.com/inmueble/superseded-${stamp + 1}/`,
          mirrorListingId: `idealista-superseded-listing-${stamp + 1}`,
          askingPrice: 550000,
          priceType: 'sale',
          status: 'active' as const,
          address: {
            countryCode: 'ES',
            street: 'Calle Superseded',
            postalCode: '28013',
            houseNumber: 4,
            city: 'Madrid',
          },
        },
      ],
    });

    await db
      .update(ingestBatches)
      .set({ status: 'queued' })
      .where(inArray(ingestBatches.id, [firstAccepted.batchId, secondAccepted.batchId]));

    await db
      .update(ingestSources)
      .set({
        lastCommittedCursor: committedCursor,
        lastCommittedChangedAt: new Date('2026-04-09T06:30:00.000Z'),
        lastCommittedListingKey: `idealista-superseded-2-${stamp}`,
        lastBatchId: secondAccepted.batchId,
      })
      .where(eq(ingestSources.sourceName, 'idealista'));

    const result = await collectRecoveryDispatchWork(new Date('2026-04-09T07:00:00.000Z'));

    expect(result.recoverableBatchIds).not.toContain(firstAccepted.batchId);
    expect(result.recoverableBatchIds).not.toContain(secondAccepted.batchId);

    const batchRows = await db
      .select({
        id: ingestBatches.id,
        status: ingestBatches.status,
        completedAt: ingestBatches.completedAt,
        errorJson: ingestBatches.errorJson,
      })
      .from(ingestBatches)
      .where(inArray(ingestBatches.id, [firstAccepted.batchId, secondAccepted.batchId]));

    expect(batchRows).toHaveLength(2);
    for (const batch of batchRows) {
      expect(batch.status).toBe('superseded');
      expect(batch.completedAt).not.toBeNull();
      expect(batch.errorJson).toMatchObject({
        message: 'Superseded by committed ingest watermark',
      });
    }

    const activeRows = await db
      .select({ id: ingestBatches.id })
      .from(ingestBatches)
      .where(
        and(
          eq(ingestBatches.sourceName, 'idealista'),
          inArray(ingestBatches.status, ['accepted', 'queued', 'processing', 'retryable']),
        ),
      );

    expect(activeRows).toHaveLength(0);

    const [runState] = await db
      .select()
      .from(ingestRuns)
      .where(eq(ingestRuns.id, firstAccepted.runId as string))
      .limit(1);

    expect(runState?.status).toBe('completed');
    expect(runState?.processedBatchCount).toBe(2);
    expect(runState?.completedAt).not.toBeNull();
    expect(runState?.errorSummary).toBeNull();
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

  it('marks maintenance complete only after all refreshers succeed', async () => {
    const maintenanceSourceName = `maintenance-all-refreshes-${Date.now()}`;
    const request = await db.transaction(async (tx) =>
      createMaintenanceRefreshRequest(tx, {
        sourceName: maintenanceSourceName,
        requestedBy: 'listing-submit',
        idempotencyKey: `${maintenanceSourceName}-before`,
        payload: {
          reason: 'all-refreshes-success',
        },
      }),
    );

    try {
      await expect(
        refreshLatestListingsMaintenance([
          async () => undefined,
          async () => {
            throw new Error('price summary refresh failed');
          },
        ]),
      ).rejects.toThrow('price summary refresh failed');

      const [failedRow] = await db
        .select()
        .from(ingestBatches)
        .where(eq(ingestBatches.id, request.batchId))
        .limit(1);
      expect(failedRow?.maintenanceCompletedAt).toBeNull();

      const refreshedCount = await refreshLatestListingsMaintenance([
        async () => undefined,
        async () => undefined,
      ]);

      expect(refreshedCount).toBeGreaterThanOrEqual(1);

      const [completedRow] = await db
        .select()
        .from(ingestBatches)
        .where(eq(ingestBatches.id, request.batchId))
        .limit(1);
      expect(completedRow?.maintenanceCompletedAt).not.toBeNull();
    } finally {
      await db.delete(ingestBatches).where(eq(ingestBatches.id, request.batchId));
    }
  });

  it('backfills a mirror observation when only a canonical listing already exists', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const street = `Recoverylaan-${stamp}`;
    const mirrorListingId = `fotocasa-recovery-match-${stamp}`;
    const sourceUrl = `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/recovery-match-${stamp}`;
    const { batchId, cursorEnd } = await createSkippedCompletedBatch({
      sourceName,
      stamp,
      street,
      houseNumber: 61,
      mirrorListingId,
      sourceUrl,
    });

    const propertyId = await seedProperty({ street, houseNumber: 61 });

    await db.insert(canonicalListings).values({
      propertyId,
      sourceName,
      primarySourceListingId: mirrorListingId,
      canonicalUrl: sourceUrl,
      displayUrl: sourceUrl,
      askingPrice: 515000,
      priceCurrency: 'EUR',
      priceType: 'sale',
    });

    const firstDispatch = await collectRecoveryDispatchWork(new Date());
    expect(firstDispatch.maintenancePending).toBe(true);

    let refreshCalls = 0;
    const refreshedCount = await refreshLatestListingsMaintenance(async () => {
      refreshCalls += 1;
    });

    expect(refreshedCount).toBe(1);
    expect(refreshCalls).toBe(1);

    const recoveredObservations = await db
      .select()
      .from(listingObservations)
      .where(
        and(
          eq(listingObservations.sourceName, sourceName),
          eq(listingObservations.sourceListingId, mirrorListingId),
        ),
      );

    expect(recoveredObservations).toHaveLength(1);
    expect(recoveredObservations[0]?.propertyId).toBe(propertyId);
    expect(recoveredObservations[0]?.ingestBatchId).toBe(batchId);

    const recoveredCanonicals = await db
      .select()
      .from(canonicalListings)
      .where(
        and(
          eq(canonicalListings.sourceName, sourceName),
          eq(canonicalListings.primarySourceListingId, mirrorListingId),
        ),
      );

    expect(recoveredCanonicals).toHaveLength(1);
    expect(recoveredCanonicals[0]?.propertyId).toBe(propertyId);
    expect(recoveredCanonicals[0]?.canonicalUrl).toBe(sourceUrl);

    const [recoveredBatch] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, batchId))
      .limit(1);

    expect(recoveredBatch?.ingestedCount).toBe(1);
    expect(recoveredBatch?.updatedCount).toBe(0);
    expect(recoveredBatch?.skippedCount).toBe(0);
    expect(recoveredBatch?.maintenanceRequestedAt).not.toBeNull();
    expect(recoveredBatch?.maintenanceCompletedAt).not.toBeNull();

    const [sourceState] = await db
      .select()
      .from(ingestSources)
      .where(eq(ingestSources.sourceName, sourceName))
      .limit(1);

    expect(sourceState?.lastCommittedCursor).toBe(cursorEnd);
    expect(sourceState?.lastBatchId).toBe(batchId);
    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(false);
  });

  it('recovers a skipped batch even when matching observations already exist outside that batch', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const street = `Recoverylaan-${stamp}`;
    const mirrorListingId = `fotocasa-recovery-prior-${stamp}`;
    const sourceUrl = `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/recovery-prior-${stamp}`;
    const { batchId } = await createSkippedCompletedBatch({
      sourceName,
      stamp,
      street,
      houseNumber: 62,
      mirrorListingId,
      sourceUrl,
    });

    const propertyId = await seedProperty({ street, houseNumber: 62 });
    const olderBatchId = await seedCompletedBatchRecord({
      sourceName,
      stamp: stamp + 1,
      suffix: 'older-observation',
      completedAt: '2026-04-05T14:00:00.000Z',
    });

    await db.insert(listingObservations).values([
      {
        sourceName,
        sourceListingId: mirrorListingId,
        sourceListingIdKind: 'unknown',
        sourceUrlRaw: sourceUrl,
        sourceUrlCanonical: sourceUrl,
        origin: 'mirror',
        propertyId,
        propertyMatchKind: 'source_exact',
        sourceStatus: 'available',
        askingPrice: 515000,
        priceCurrency: 'EUR',
        ingestBatchId: olderBatchId,
        observedAt: new Date('2026-04-05T14:10:00.000Z'),
      },
      {
        sourceName,
        sourceListingId: mirrorListingId,
        sourceListingIdKind: 'unknown',
        sourceUrlRaw: sourceUrl,
        sourceUrlCanonical: sourceUrl,
        origin: 'user',
        propertyId,
        propertyMatchKind: 'source_exact',
        sourceStatus: 'available',
        askingPrice: 515000,
        priceCurrency: 'EUR',
        observedAt: new Date('2026-04-05T14:20:00.000Z'),
      },
    ]);

    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(true);

    let refreshCalls = 0;
    const refreshedCount = await refreshLatestListingsMaintenance(async () => {
      refreshCalls += 1;
    });

    expect(refreshedCount).toBe(1);
    expect(refreshCalls).toBe(1);

    const observations = await db
      .select({
        id: listingObservations.id,
        origin: listingObservations.origin,
        propertyId: listingObservations.propertyId,
        ingestBatchId: listingObservations.ingestBatchId,
      })
      .from(listingObservations)
      .where(
        and(
          eq(listingObservations.sourceName, sourceName),
          eq(listingObservations.sourceListingId, mirrorListingId),
        ),
      );

    expect(observations).toHaveLength(3);
    expect(
      observations.filter(
        (observation) => observation.origin === 'mirror' && observation.ingestBatchId === olderBatchId,
      ),
    ).toHaveLength(1);
    expect(observations.filter((observation) => observation.origin === 'user')).toHaveLength(1);

    const recoveredObservations = observations.filter(
      (observation) => observation.origin === 'mirror' && observation.ingestBatchId === batchId,
    );

    expect(recoveredObservations).toHaveLength(1);
    expect(recoveredObservations[0]?.propertyId).toBe(propertyId);

    const [batchState] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, batchId))
      .limit(1);

    expect(batchState?.ingestedCount).toBe(1);
    expect(batchState?.updatedCount).toBe(0);
    expect(batchState?.skippedCount).toBe(0);
  });

  it('resolves skipped recovery accounting from an existing observation without duplicating it', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const street = `Recoverylaan-${stamp}`;
    const mirrorListingId = `fotocasa-recovery-existing-${stamp}`;
    const sourceUrl = `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/recovery-existing-${stamp}`;
    const { batchId } = await createSkippedCompletedBatch({
      sourceName,
      stamp,
      street,
      houseNumber: 62,
      mirrorListingId,
      sourceUrl,
    });

    const propertyId = await seedProperty({ street, houseNumber: 62 });

    await db.insert(listingObservations).values({
      sourceName,
      sourceListingId: mirrorListingId,
      sourceListingIdKind: 'unknown',
      sourceUrlRaw: sourceUrl,
      sourceUrlCanonical: sourceUrl,
      origin: 'mirror',
      propertyId,
      propertyMatchKind: 'source_exact',
      sourceStatus: 'available',
      askingPrice: 515000,
      priceCurrency: 'EUR',
      ingestBatchId: batchId,
      observedAt: new Date('2026-04-06T14:10:00.000Z'),
    });

    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(true);

    let refreshCalls = 0;
    const refreshedCount = await refreshLatestListingsMaintenance(async () => {
      refreshCalls += 1;
    });

    expect(refreshedCount).toBe(0);
    expect(refreshCalls).toBe(0);

    const observations = await db
      .select()
      .from(listingObservations)
      .where(
        and(
          eq(listingObservations.sourceName, sourceName),
          eq(listingObservations.sourceListingId, mirrorListingId),
        ),
      );

    expect(observations).toHaveLength(1);

    const [batchState] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, batchId))
      .limit(1);

    expect(batchState?.ingestedCount).toBe(0);
    expect(batchState?.updatedCount).toBe(0);
    expect(batchState?.skippedCount).toBe(0);
    expect(batchState?.maintenanceRequestedAt).not.toBeNull();
    expect(batchState?.maintenanceCompletedAt).not.toBeNull();
    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(false);
  });

  it('does not duplicate a recovered mirror observation when the same batch is retried', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const street = `Recoverylaan-${stamp}`;
    const mirrorListingId = `fotocasa-recovery-rerun-${stamp}`;
    const sourceUrl = `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/recovery-rerun-${stamp}`;
    const { batchId } = await createSkippedCompletedBatch({
      sourceName,
      stamp,
      street,
      houseNumber: 63,
      mirrorListingId,
      sourceUrl,
    });

    await seedProperty({ street, houseNumber: 63 });

    let refreshCalls = 0;
    const firstRefreshCount = await refreshLatestListingsMaintenance(async () => {
      refreshCalls += 1;
    });

    expect(firstRefreshCount).toBe(1);
    expect(refreshCalls).toBe(1);

    const loadRecoveredMirrorObservations = async () =>
      db
        .select({
          id: listingObservations.id,
          propertyId: listingObservations.propertyId,
          ingestBatchId: listingObservations.ingestBatchId,
        })
        .from(listingObservations)
        .where(
          and(
            eq(listingObservations.sourceName, sourceName),
            eq(listingObservations.sourceListingId, mirrorListingId),
            eq(listingObservations.origin, 'mirror'),
          ),
        );

    const initialRecoveredObservations = await loadRecoveredMirrorObservations();
    expect(initialRecoveredObservations).toHaveLength(1);
    expect(initialRecoveredObservations[0]?.ingestBatchId).toBe(batchId);

    await db
      .update(ingestBatches)
      .set({
        skippedCount: 1,
        maintenanceCompletedAt: new Date(Date.now() - SKIPPED_BATCH_RECOVERY_COOLDOWN_MS - 1_000),
      })
      .where(eq(ingestBatches.id, batchId));

    refreshCalls = 0;
    const rerunRefreshCount = await refreshLatestListingsMaintenance(async () => {
      refreshCalls += 1;
    });

    expect(rerunRefreshCount).toBe(0);
    expect(refreshCalls).toBe(0);

    const rerunRecoveredObservations = await loadRecoveredMirrorObservations();
    expect(rerunRecoveredObservations).toHaveLength(1);
    expect(rerunRecoveredObservations[0]?.id).toBe(initialRecoveredObservations[0]?.id);

    const [batchState] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, batchId))
      .limit(1);

    expect(batchState?.ingestedCount).toBe(1);
    expect(batchState?.updatedCount).toBe(0);
    expect(batchState?.skippedCount).toBe(0);
    expect(batchState?.maintenanceRequestedAt).not.toBeNull();
    expect(batchState?.maintenanceCompletedAt).not.toBeNull();
  });

  it('does not call refreshers for a no-op skipped recovery scan and resolves churn', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const street = `Recoverylaan-${stamp}`;
    const mirrorListingId = `fotocasa-recovery-miss-${stamp}`;
    const sourceUrl = `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/recovery-miss-${stamp}`;
    const { batchId } = await createSkippedCompletedBatch({
      sourceName,
      stamp,
      street,
      houseNumber: 64,
      mirrorListingId,
      sourceUrl,
    });

    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(true);

    let refreshCalls = 0;
    const refreshedCount = await refreshLatestListingsMaintenance(async () => {
      refreshCalls += 1;
    });

    expect(refreshedCount).toBe(0);
    expect(refreshCalls).toBe(0);

    const [batchState] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, batchId))
      .limit(1);

    expect(batchState?.ingestedCount).toBe(0);
    expect(batchState?.updatedCount).toBe(0);
    expect(batchState?.skippedCount).toBe(1);
    expect(batchState?.maintenanceRequestedAt).not.toBeNull();
    expect(batchState?.maintenanceCompletedAt).not.toBeNull();
    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(false);

    const cooldownElapsedAt = new Date(Date.now() - SKIPPED_BATCH_RECOVERY_COOLDOWN_MS - 1_000);
    await db
      .update(ingestBatches)
      .set({ maintenanceCompletedAt: cooldownElapsedAt })
      .where(eq(ingestBatches.id, batchId));

    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(true);

    const refreshedCountAfterCooldown = await refreshLatestListingsMaintenance(async () => {
      refreshCalls += 1;
    });

    expect(refreshedCountAfterCooldown).toBe(0);
    expect(refreshCalls).toBe(0);
    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(false);
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
      .from(canonicalListings)
      .where(
        and(
          eq(canonicalListings.sourceName, 'fotocasa'),
          eq(canonicalListings.primarySourceListingId, firstMirrorListingId),
        ),
      )
      .limit(1);

    expect(storedListing).toBeDefined();
    const matchedListing = storedListing;
    expect(matchedListing?.propertyId).toBe(alphaProperty?.id);
    expect(matchedListing?.canonicalUrl).toBe('https://www.fotocasa.es/es/comprar/vivienda/eindhoven/alpha');

    const [legacyListing] = await db
      .select()
      .from(listings)
      .where(eq(listings.sourceName, 'fotocasa'))
      .limit(1);
    expect(legacyListing).toBeUndefined();

    const [historyRow] = await db
      .select()
      .from(priceHistory)
      .where(eq(priceHistory.source, 'fotocasa'))
      .limit(1);

    expect(historyRow).toBeDefined();
    expect(historyRow?.propertyId).toBe(alphaProperty?.id);
    expect(historyRow?.listingId).toBeNull();

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

  it('skips listings with invalid source house numbers while completing the batch', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const street = 'Invalid House Numberweg';
    const cursorEnd = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T18:30:00.000Z',
      listingKey: `fotocasa-invalid-house-number-${stamp}`,
    });
    const propertySeed = await db
      .insert(properties)
      .values({
        countryCode: 'NL',
        street,
        houseNumber: 18,
        houseNumberAddition: null,
        city: 'Eindhoven',
        postalCode: '1234AB',
        geometry: { type: 'Point', coordinates: [5.123456, 51.123456] },
        status: 'active',
      })
      .returning({ id: properties.id });

    const propertyId = propertySeed[0]?.id;
    expect(propertyId).toBeTruthy();
    cleanupPropertyIds.push(propertyId as string);

    const accepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-invalid-house-number-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd,
      upstreamRunKey: `fotocasa-invalid-house-number-run-${stamp}`,
      listings: [
        {
          sourceUrl: `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/valid-${stamp}`,
          mirrorListingId: `fotocasa-invalid-house-number-valid-${stamp}`,
          askingPrice: 470000,
          priceType: 'sale' as const,
          status: 'active' as const,
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 18,
            city: 'Eindhoven',
            latitude: 51.123456,
            longitude: 5.123456,
          },
        },
        {
          sourceUrl: `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/none-${stamp}`,
          mirrorListingId: `fotocasa-invalid-house-number-none-${stamp}`,
          askingPrice: 471000,
          priceType: 'sale' as const,
          status: 'active' as const,
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 'None',
            city: 'Eindhoven',
          },
        },
        {
          sourceUrl: `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/empty-${stamp}`,
          mirrorListingId: `fotocasa-invalid-house-number-empty-${stamp}`,
          askingPrice: 472000,
          priceType: 'sale' as const,
          status: 'active' as const,
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: '',
            city: 'Eindhoven',
          },
        },
      ],
    });

    const [acceptedBatch] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, accepted.batchId))
      .limit(1);

    expect(acceptedBatch).toBeDefined();

    await expect(
      processIngestBatch({
        batchId: accepted.batchId,
        maxAttempts: 1,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 1,
      updated: 0,
      skipped: 2,
    });

    const [batchState] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, accepted.batchId))
      .limit(1);

    expect(batchState?.status).toBe('completed');
    expect(batchState?.ingestedCount).toBe(1);
    expect(batchState?.updatedCount).toBe(0);
    expect(batchState?.skippedCount).toBe(2);
    expect(batchState?.errorJson).toBeNull();
    expect(batchState?.lastErrorAt).toBeNull();

    const canonicalRows = await db
      .select()
      .from(canonicalListings)
      .where(eq(canonicalListings.sourceName, sourceName));

    expect(canonicalRows).toHaveLength(1);
    expect(canonicalRows[0]?.propertyId).toBe(propertyId);
    expect(canonicalRows[0]?.primarySourceListingId).toBe(`fotocasa-invalid-house-number-valid-${stamp}`);
    expect(canonicalRows[0]?.canonicalUrl).toBe(
      `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/valid-${stamp}`,
    );

    const [sourceState] = await db
      .select()
      .from(ingestSources)
      .where(eq(ingestSources.sourceName, sourceName))
      .limit(1);

    expect(sourceState?.lastCommittedCursor).toBe(cursorEnd);
    expect(sourceState?.lastCommittedListingKey).toBe(`fotocasa-invalid-house-number-${stamp}`);
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

  it('merges duplicate mirror URL observations without writing legacy listings', async () => {
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
    ).resolves.toEqual({
      status: 'completed',
      ingested: 2,
      updated: 0,
      skipped: 0,
    });

    const [completedBatch] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, accepted.batchId))
      .limit(1);

    expect(completedBatch?.status).toBe('completed');
    expect(completedBatch?.errorJson).toBeNull();

    const canonicalRows = await db
      .select()
      .from(canonicalListings)
      .where(
        and(
          eq(canonicalListings.sourceName, 'fotocasa'),
          eq(canonicalListings.canonicalUrl, 'https://www.fotocasa.es/es/comprar/vivienda/eindhoven/failure'),
        ),
      );
    expect(canonicalRows).toHaveLength(1);

    const [legacyListing] = await db
      .select()
      .from(listings)
      .where(eq(listings.sourceName, 'fotocasa'))
      .limit(1);
    expect(legacyListing).toBeUndefined();

    expect(accepted.runId).toBeTruthy();
    const completedRunId = accepted.runId as string;

    const [completedRun] = await db
      .select()
      .from(ingestRuns)
      .where(eq(ingestRuns.id, completedRunId))
      .limit(1);

    expect(completedRun).toBeDefined();
    expect(completedRun?.status).toBe('completed');
    expect(completedRun?.processedBatchCount).toBe(1);
    expect(completedRun?.completedAt).not.toBeNull();
    expect(completedRun?.errorSummary).toBeNull();

    const [completedSource] = await db
      .select()
      .from(ingestSources)
      .where(eq(ingestSources.sourceName, 'fotocasa'))
      .limit(1);

    expect(completedSource).toBeDefined();
    expect(completedSource?.lastRunStatus).toBe('completed');
    expect(completedSource?.lastRunCompletedAt).not.toBeNull();
  });
});
