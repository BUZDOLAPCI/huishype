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
  listingCandidateHandoffs,
  listings,
  listingObservations,
  listingPriceObservations,
  listingScopeCompletions,
  listingSourceScopeWatermarks,
  priceHistory,
  properties,
  propertyTileSnapshotRefreshState,
  propertyTileSnapshotWatermarks,
} from '../../db/schema.js';
import {
  acceptIngestBatch,
  collectRecoveryDispatchWork,
  encodeOpaqueIngestCursor,
  processIngestBatch,
  createMaintenanceRefreshRequest,
  forceRecoverSkippedCompletedIngestBatches,
  refreshLatestListingsMaintenance,
  requeueBlockedSourceBatchesAtWatermark,
  SKIPPED_BATCH_RECOVERY_COOLDOWN_MS,
} from '../../services/ingest/index.js';
import { persistMirrorObservationForIngest, upsertListingSourceAliases } from '../../services/listing-reconciliation.js';
import { PROPERTY_TILE_SNAPSHOT_KEY } from '../../services/property-tile-snapshots.js';

describe('Durable ingest API contract', () => {
  let app: FastifyInstance;
  const originalIngestApiKey = process.env.INGEST_API_KEY;
  const cleanupPropertyIds: string[] = [];
  const cleanupSourceNames = ['idealista', 'fotocasa'];

  function encodeRawCursor(payload: { changedAt: string; listingKey: string }): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  function fullMirrorReplayCursor(sourceName: string, sequence: number, offset: number): string {
    return encodeOpaqueIngestCursor({
      changedAt: '2026-04-09T08:00:00.000Z',
      listingKey: `${sourceName}:full-mirror:${sequence}:${offset}`,
    });
  }

  async function resetIngestSourceState(sourceName: string) {
    await db.delete(priceHistory).where(eq(priceHistory.source, sourceName));
    await db.delete(listings).where(eq(listings.sourceName, sourceName));
    await db.delete(listingPriceObservations).where(eq(listingPriceObservations.sourceName, sourceName));
    await db.delete(listingCandidateHandoffs).where(eq(listingCandidateHandoffs.sourceName, sourceName));
    await db.delete(listingObservations).where(eq(listingObservations.sourceName, sourceName));
    await db.delete(canonicalListings).where(eq(canonicalListings.sourceName, sourceName));
    await db.delete(listingScopeCompletions).where(eq(listingScopeCompletions.sourceName, sourceName));
    await db.delete(listingSourceScopeWatermarks).where(eq(listingSourceScopeWatermarks.sourceName, sourceName));
    await db.delete(ingestBatches).where(eq(ingestBatches.sourceName, sourceName));
    await db.delete(ingestRuns).where(eq(ingestRuns.sourceName, sourceName));
    await db.delete(ingestSources).where(eq(ingestSources.sourceName, sourceName));
  }

  async function drainGlobalMaintenanceState() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const dispatch = await collectRecoveryDispatchWork(new Date());
      if (!dispatch.maintenancePending) {
        return;
      }

      await refreshLatestListingsMaintenance(async () => {}, {
        skippedBatchRecoveryLimit: 100,
      });
    }

    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(false);
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
    for (const sourceName of cleanupSourceNames) {
      await resetIngestSourceState(sourceName);
    }
    await drainGlobalMaintenanceState();
  });

  afterAll(async () => {
    try {
      await db.delete(priceHistory).where(inArray(priceHistory.source, cleanupSourceNames));
      await db.delete(listings).where(inArray(listings.sourceName, cleanupSourceNames));
      await db.delete(listingPriceObservations).where(inArray(listingPriceObservations.sourceName, cleanupSourceNames));
      await db.delete(listingObservations).where(inArray(listingObservations.sourceName, cleanupSourceNames));
      await db.delete(canonicalListings).where(inArray(canonicalListings.sourceName, cleanupSourceNames));
      await db.delete(listingScopeCompletions).where(inArray(listingScopeCompletions.sourceName, cleanupSourceNames));
      await db.delete(listingSourceScopeWatermarks).where(inArray(listingSourceScopeWatermarks.sourceName, cleanupSourceNames));
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

  it('processes candidate callback batches independently from the source cursor', async () => {
    const sourceName = 'idealista';
    const stamp = Date.now();
    const street = `Candidate Cursorlaan ${stamp}`;
    await resetIngestSourceState(sourceName);
    const propertyId = await seedProperty({
      street,
      houseNumber: 41,
      postalCode: '5611AA',
      city: 'Eindhoven',
    });
    const firstCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T13:00:00.000Z',
      listingKey: `idealista-mirror-${stamp}`,
    });
    const candidateCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T13:05:00.000Z',
      listingKey: `idealista-candidate-${stamp}`,
    });

    const mirrorAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-mirror-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: firstCursor,
      upstreamRunKey: `idealista-mirror-run-${stamp}`,
      listings: [
        {
          sourceUrl: `https://www.idealista.com/en/koop/eindhoven/huis-${stamp}/`,
          mirrorListingId: `idealista-mirror-${stamp}`,
          askingPrice: 515000,
          priceType: 'sale' as const,
          status: 'active' as const,
          address: {
            countryCode: 'NL',
            street,
            postalCode: '5611 AA',
            houseNumber: 41,
            city: 'Eindhoven',
          },
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: mirrorAccepted.batchId,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 1,
      updated: 0,
      skipped: 0,
    });

    const [sourceAfterMirror] = await db
      .select()
      .from(ingestSources)
      .where(eq(ingestSources.sourceName, sourceName))
      .limit(1);

    expect(sourceAfterMirror?.lastCommittedCursor).toBe(firstCursor);
    expect(sourceAfterMirror?.lastBatchId).toBe(mirrorAccepted.batchId);

    const scraperRunId = `idealista-candidate-run-${stamp}`;
    const candidatePayload = {
      sourceName,
      idempotencyKey: `idealista-candidate-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: candidateCursor,
      runId: scraperRunId,
      batchKind: 'observations' as const,
      scopeKey: 'candidate',
      listings: [
        {
          sourceUrl: `https://www.idealista.com/en/koop/eindhoven/diagnostic-partial-${stamp}/`,
          mirrorListingId: `idealista-candidate-partial-${stamp}`,
          sourceCandidateId: 'candidate-partial',
          askingPrice: null,
          listingType: 'unknown' as const,
          diagnosticStatus: 'unknown' as const,
          status: 'active' as const,
          address: {
            countryCode: 'NL',
            city: 'Eindhoven',
          },
        },
        {
          sourceUrl: `https://www.idealista.com/en/koop/eindhoven/diagnostic-omitted-${stamp}/`,
          mirrorListingId: `idealista-candidate-omitted-${stamp}`,
          sourceCandidateId: 'candidate-omitted',
          askingPrice: null,
          priceType: 'unknown' as const,
          diagnosticStatus: 'parser_error' as const,
          status: 'active' as const,
        },
      ],
    };

    const candidateResponse = await app.inject({
      method: 'POST',
      url: '/api/ingest/listings',
      headers: {
        'x-api-key': 'test-ingest-api-key',
      },
      payload: candidatePayload,
    });

    expect(candidateResponse.statusCode).toBe(202);
    const candidateAccepted = JSON.parse(candidateResponse.body);
    expect(candidateAccepted.runId).toBeTruthy();

    await expect(
      processIngestBatch({
        batchId: candidateAccepted.batchId,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 0,
      updated: 2,
      skipped: 0,
    });

    const [candidateBatch] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, candidateAccepted.batchId))
      .limit(1);

    expect(candidateBatch?.payloadJson).toMatchObject({
      sourceName,
      upstreamRunKey: scraperRunId,
      scopeKey: 'candidate',
      listings: [
        expect.objectContaining({
          mirrorListingId: `idealista-candidate-partial-${stamp}`,
          priceType: 'unknown',
        }),
        expect.objectContaining({
          mirrorListingId: `idealista-candidate-omitted-${stamp}`,
          priceType: 'unknown',
        }),
      ],
    });

    const [runState] = await db
      .select()
      .from(ingestRuns)
      .where(eq(ingestRuns.id, candidateAccepted.runId as string))
      .limit(1);

    expect(runState?.upstreamRunKey).toBe(scraperRunId);
    expect(runState?.status).toBe('completed');

    const observations = await db
      .select({
        sourceListingId: listingObservations.sourceListingId,
        propertyId: listingObservations.propertyId,
        diagnosticStatus: listingObservations.diagnosticStatus,
        addressNormalized: listingObservations.addressNormalized,
        payload: listingObservations.payload,
      })
      .from(listingObservations)
      .where(eq(listingObservations.ingestBatchId, candidateAccepted.batchId));

    expect(observations).toHaveLength(2);
    expect(observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceListingId: `idealista-candidate-partial-${stamp}`,
        propertyId: null,
        diagnosticStatus: 'unknown',
        addressNormalized: expect.objectContaining({
          countryCode: 'NL',
          city: 'Eindhoven',
        }),
        payload: expect.objectContaining({
          scopeKey: 'candidate',
          priceType: 'unknown',
          diagnosticOnly: true,
        }),
      }),
      expect.objectContaining({
        sourceListingId: `idealista-candidate-omitted-${stamp}`,
        propertyId: null,
        diagnosticStatus: 'parser_error',
        addressNormalized: null,
        payload: expect.objectContaining({
          scopeKey: 'candidate',
          priceType: 'unknown',
          diagnosticOnly: true,
        }),
      }),
    ]));

    const [sourceAfterCandidate] = await db
      .select()
      .from(ingestSources)
      .where(eq(ingestSources.sourceName, sourceName))
      .limit(1);

    expect(sourceAfterCandidate?.lastCommittedCursor).toBe(firstCursor);
    expect(sourceAfterCandidate?.lastCommittedListingKey).toBe(`idealista-mirror-${stamp}`);
    expect(sourceAfterCandidate?.lastBatchId).toBe(mirrorAccepted.batchId);

    const canonicalRows = await db
      .select()
      .from(canonicalListings)
      .where(eq(canonicalListings.propertyId, propertyId));

    expect(canonicalRows).toHaveLength(1);
    expect(canonicalRows[0]?.primarySourceListingId).toBe(`idealista-mirror-${stamp}`);
  });

  it('keeps mixed candidate and mirror batches bound to the source cursor', async () => {
    const sourceName = 'idealista';
    const stamp = Date.now();
    const street = `Mixed Candidate Cursorlaan ${stamp}`;
    await resetIngestSourceState(sourceName);
    await seedProperty({
      street,
      houseNumber: 42,
      postalCode: '5611AB',
      city: 'Eindhoven',
    });

    const firstCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T13:10:00.000Z',
      listingKey: `idealista-mixed-cursor-first-${stamp}`,
    });
    const firstAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-mixed-cursor-first-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: firstCursor,
      upstreamRunKey: `idealista-mixed-cursor-run-${stamp}-first`,
      listings: [
        {
          sourceUrl: `https://www.idealista.com/en/koop/eindhoven/first-${stamp}/`,
          mirrorListingId: `idealista-mixed-cursor-first-${stamp}`,
          askingPrice: 515000,
          priceType: 'sale',
          status: 'active',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '5611 AB',
            houseNumber: 42,
            city: 'Eindhoven',
          },
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: firstAccepted.batchId,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toMatchObject({
      status: 'completed',
    });

    const mixedCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T13:20:00.000Z',
      listingKey: `idealista-mixed-cursor-second-${stamp}`,
    });
    const mixedAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-mixed-cursor-second-${stamp}`,
      batchSequence: 1,
      cursorStart: null,
      cursorEnd: mixedCursor,
      upstreamRunKey: `idealista-mixed-cursor-run-${stamp}-second`,
      listings: [
        {
          sourceUrl: `https://www.idealista.com/en/koop/eindhoven/candidate-${stamp}/`,
          mirrorListingId: `idealista-mixed-cursor-candidate-${stamp}`,
          sourceCandidateId: `candidate-${stamp}`,
          askingPrice: null,
          priceType: 'unknown',
          diagnosticStatus: 'unknown',
          status: 'active',
        },
        {
          sourceUrl: `https://www.idealista.com/en/koop/eindhoven/mirror-${stamp}/`,
          mirrorListingId: `idealista-mixed-cursor-mirror-${stamp}`,
          askingPrice: 520000,
          priceType: 'sale',
          status: 'active',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '5611 AB',
            houseNumber: 42,
            city: 'Eindhoven',
          },
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: mixedAccepted.batchId,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toEqual({
      status: 'noop',
      ingested: 0,
      updated: 0,
      skipped: 0,
    });

    const [sourceAfterMixed] = await db
      .select()
      .from(ingestSources)
      .where(eq(ingestSources.sourceName, sourceName))
      .limit(1);
    expect(sourceAfterMixed?.lastCommittedCursor).toBe(firstCursor);

    const [mixedBatch] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, mixedAccepted.batchId))
      .limit(1);
    expect(mixedBatch?.status).toBe('accepted');

    await resetIngestSourceState(sourceName);
  });

  it('processes zero-row filtered completion batches without advancing coarse scope watermarks', async () => {
    const sourceName = 'idealista';
    const cursorEnd = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T13:00:00.000Z',
      listingKey: 'idealista-empty-sale-scope',
    });

    const accepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-empty-scope-${Date.now()}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd,
      upstreamRunKey: `idealista-empty-scope-run-${Date.now()}`,
      batchKind: 'completion',
      sourceHighWatermark: '2026-04-06T13:00:00.000Z',
      completions: [
        {
          scopeKey: 'sale',
          listingType: 'sale',
          normalizedFilters: { listingType: 'sale' },
          sourceRunCompletedAt: '2026-04-06T13:00:00.000Z',
          coverageStatus: 'complete',
          observedListingCount: 0,
          sourceHighWatermark: '2026-04-06T13:00:00.000Z',
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
      skipped: 0,
    });

    const [completion] = await db
      .select()
      .from(listingScopeCompletions)
      .where(eq(listingScopeCompletions.ingestBatchId, accepted.batchId))
      .limit(1);
    expect(completion).toMatchObject({
      sourceName,
      scopeKey: 'sale',
      listingType: 'sale',
      observedListingCount: 0,
      staleForProjection: false,
    });

    const [scopeWatermark] = await db
      .select()
      .from(listingSourceScopeWatermarks)
      .where(eq(listingSourceScopeWatermarks.sourceName, sourceName))
      .limit(1);
    expect(scopeWatermark).toBeUndefined();
  });

  it('keeps serial replay runs in progress until an explicit completion batch is processed', async () => {
    const stamp = Date.now();
    const sourceName = 'idealista';
    const runKey = `idealista-serial-replay-run-${stamp}`;
    const scopeKey = 'full-mirror';
    const street = `Serial Replaylaan ${stamp}`;
    const observationCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T14:00:00.000Z',
      listingKey: `idealista-serial-replay-observation-${stamp}`,
    });
    const completionCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T14:00:00.000Z',
      listingKey: `idealista-serial-replay-completion-${stamp}`,
    });
    await seedProperty({ street, houseNumber: 19 });

    const observationBatch = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-serial-replay-observation-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: observationCursor,
      upstreamRunKey: runKey,
      batchKind: 'observations',
      scopeKey,
      sourceHighWatermark: '2026-04-06T14:00:00.000Z',
      sourceProvenance: 'import',
      listings: [
        {
          sourceUrl: `https://www.idealista.com/inmueble/serial-replay-${stamp}/`,
          mirrorListingId: `idealista-serial-replay-${stamp}`,
          askingPrice: 450000,
          priceType: 'sale',
          status: 'active',
          scopeKey,
          sourceHighWatermark: '2026-04-06T14:00:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 19,
            city: 'Eindhoven',
          },
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: observationBatch.batchId,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 1,
      updated: 0,
      skipped: 0,
    });

    const [runAfterObservation] = await db
      .select()
      .from(ingestRuns)
      .where(eq(ingestRuns.id, observationBatch.runId as string))
      .limit(1);

    expect(runAfterObservation?.status).toBe('in_progress');
    expect(runAfterObservation?.processedBatchCount).toBe(1);
    expect(runAfterObservation?.completedAt).toBeNull();

    const completionBatch = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-serial-replay-completion-${stamp}`,
      batchSequence: 1,
      cursorStart: observationCursor,
      cursorEnd: completionCursor,
      upstreamRunKey: runKey,
      batchKind: 'completion',
      scopeKey,
      sourceHighWatermark: '2026-04-06T14:00:00.000Z',
      sourceProvenance: 'import',
      completions: [
        {
          scopeKey,
          listingType: 'sale',
          sourceRunId: runKey,
          sourceRunCompletedAt: '2026-04-06T14:00:00.000Z',
          coverageStatus: 'complete',
          observedListingCount: 1,
          sourceHighWatermark: '2026-04-06T14:00:00.000Z',
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: completionBatch.batchId,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 0,
      updated: 0,
      skipped: 0,
    });

    const [runAfterCompletion] = await db
      .select()
      .from(ingestRuns)
      .where(eq(ingestRuns.id, observationBatch.runId as string))
      .limit(1);

    expect(runAfterCompletion?.status).toBe('completed');
    expect(runAfterCompletion?.processedBatchCount).toBe(2);
    expect(runAfterCompletion?.completedAt).not.toBeNull();
  });

  it('persists separate scope completions for the same run and watermark with different normalized filters', async () => {
    const sourceName = 'idealista';
    const stamp = Date.now();
    const accepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-filter-idempotency-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T13:30:00.000Z',
        listingKey: `idealista-filter-idempotency-${stamp}`,
      }),
      upstreamRunKey: `idealista-filter-idempotency-run-${stamp}`,
      batchKind: 'completion',
      completions: [
        {
          scopeKey: 'city:eindhoven',
          listingType: 'sale',
          normalizedFilters: { rooms: 3 },
          sourceRunCompletedAt: '2026-04-06T13:30:00.000Z',
          observedListingCount: 0,
          sourceHighWatermark: '2026-04-06T13:30:00.000Z',
        },
        {
          scopeKey: 'city:eindhoven',
          listingType: 'sale',
          normalizedFilters: { rooms: 4 },
          sourceRunCompletedAt: '2026-04-06T13:30:00.000Z',
          observedListingCount: 0,
          sourceHighWatermark: '2026-04-06T13:30:00.000Z',
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
      skipped: 0,
    });

    const completions = await db
      .select({
        normalizedFilters: listingScopeCompletions.normalizedFilters,
      })
      .from(listingScopeCompletions)
      .where(eq(listingScopeCompletions.ingestBatchId, accepted.batchId));

    expect(completions.map((row) => row.normalizedFilters)).toEqual(
      expect.arrayContaining([{ rooms: 3 }, { rooms: 4 }]),
    );
    expect(completions).toHaveLength(2);
  });

  it('withdraws active listings absent from a completed scope-only batch and requests read-model refresh', async () => {
    const sourceName = 'idealista';
    const stamp = Date.now();
    const street = `Absence Scope Street ${stamp}`;
    const propertyId = await seedProperty({ street, houseNumber: 42 });
    const mirrorListingId = `idealista-absence-${stamp}`;
    const sourceUrl = `https://www.idealista.com/inmueble/absence-${stamp}/`;
    const firstCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T14:00:00.000Z',
      listingKey: `${mirrorListingId}-active`,
    });

    const firstAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-absence-active-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: firstCursor,
      upstreamRunKey: `idealista-absence-run-${stamp}`,
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          scopeKey: 'city:eindhoven',
          askingPrice: 420000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-06T14:00:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 42,
            city: 'Eindhoven',
          },
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: firstAccepted.batchId,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 1,
      updated: 0,
      skipped: 0,
    });

    let maintenanceCalls = 0;
    const completionAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-absence-completion-${stamp}`,
      batchSequence: 1,
      cursorStart: firstCursor,
      cursorEnd: encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T15:00:00.000Z',
        listingKey: `${mirrorListingId}-completion`,
      }),
      upstreamRunKey: `idealista-absence-run-${stamp}`,
      batchKind: 'completion',
      completions: [
        {
          scopeKey: 'city:eindhoven',
          listingType: 'sale',
          sourceRunCompletedAt: '2026-04-06T15:00:00.000Z',
          observedListingCount: 0,
          sourceHighWatermark: '2026-04-06T15:00:00.000Z',
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: completionAccepted.batchId,
        enqueueMaintenanceRefresh: async () => {
          maintenanceCalls += 1;
        },
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
      .where(eq(canonicalListings.propertyId, propertyId))
      .limit(1);
    expect(canonical).toMatchObject({
      sourceName,
      primarySourceListingId: mirrorListingId,
      status: 'withdrawn',
      statusSource: 'mirror',
    });

    const [absenceObservation] = await db
      .select()
      .from(listingObservations)
      .where(eq(listingObservations.ingestBatchId, completionAccepted.batchId))
      .limit(1);
    expect(absenceObservation).toMatchObject({
      sourceName,
      sourceListingId: mirrorListingId,
      sourceStatus: 'not_found',
      propertyId,
      staleForProjection: false,
    });
    expect(maintenanceCalls).toBe(1);
  });

  it('does not let an older completion withdraw a newer active observation', async () => {
    const sourceName = 'idealista';
    const stamp = Date.now();
    const street = `Older Completion Street ${stamp}`;
    const propertyId = await seedProperty({ street, houseNumber: 44 });
    const mirrorListingId = `idealista-older-completion-${stamp}`;
    const sourceUrl = `https://www.idealista.com/inmueble/older-completion-${stamp}/`;
    const activeCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T16:00:00.000Z',
      listingKey: `${mirrorListingId}-active`,
    });

    const activeAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-older-completion-active-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: activeCursor,
      upstreamRunKey: `idealista-older-completion-active-run-${stamp}`,
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          scopeKey: 'city:eindhoven',
          askingPrice: 431000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-06T16:00:00.000Z',
          sourceHighWatermark: '2026-04-06T16:00:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 44,
            city: 'Eindhoven',
          },
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: activeAccepted.batchId,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 1,
      updated: 0,
      skipped: 0,
    });

    const olderCompletion = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-older-completion-${stamp}`,
      batchSequence: 1,
      cursorStart: activeCursor,
      cursorEnd: encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T17:00:00.000Z',
        listingKey: `${mirrorListingId}-older-completion`,
      }),
      upstreamRunKey: `idealista-older-completion-repair-run-${stamp}`,
      batchKind: 'completion',
      repairMode: true,
      repairReason: 'test older completion ordering',
      completions: [
        {
          scopeKey: 'city:eindhoven',
          listingType: 'sale',
          sourceRunCompletedAt: '2026-04-06T15:00:00.000Z',
          observedListingCount: 0,
          sourceHighWatermark: '2026-04-06T15:00:00.000Z',
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: olderCompletion.batchId,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 0,
      updated: 0,
      skipped: 0,
    });

    const [canonical] = await db
      .select()
      .from(canonicalListings)
      .where(eq(canonicalListings.propertyId, propertyId))
      .limit(1);
    expect(canonical).toMatchObject({
      sourceName,
      primarySourceListingId: mirrorListingId,
      status: 'active',
      lastMirrorSeenAt: new Date('2026-04-06T16:00:00.000Z'),
    });

    const absenceRows = await db
      .select()
      .from(listingObservations)
      .where(and(
        eq(listingObservations.ingestBatchId, olderCompletion.batchId),
        eq(listingObservations.sourceStatus, 'not_found'),
      ));
    expect(absenceRows).toHaveLength(0);
  });

  it('does not apply scoped absence across different normalized filters', async () => {
    const sourceName = 'idealista';
    const stamp = Date.now();
    const street = `Filtered Absence Street ${stamp}`;
    const propertyId = await seedProperty({ street, houseNumber: 43 });
    const mirrorListingId = `idealista-filtered-absence-${stamp}`;
    const sourceUrl = `https://www.idealista.com/inmueble/filtered-absence-${stamp}/`;
    const firstCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T14:30:00.000Z',
      listingKey: `${mirrorListingId}-active-filtered`,
    });

    const firstAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-filtered-absence-active-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: firstCursor,
      upstreamRunKey: `idealista-filtered-absence-run-${stamp}`,
      batchKind: 'observations_and_completion',
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          scopeKey: 'city:eindhoven',
          askingPrice: 420000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-06T14:30:00.000Z',
          sourceHighWatermark: '2026-04-06T14:30:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 43,
            city: 'Eindhoven',
          },
        },
      ],
      completions: [
        {
          scopeKey: 'city:eindhoven',
          listingType: 'sale',
          normalizedFilters: { rooms: 3 },
          sourceRunCompletedAt: '2026-04-06T14:30:00.000Z',
          observedListingCount: 1,
          sourceHighWatermark: '2026-04-06T14:30:00.000Z',
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: firstAccepted.batchId,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      ingested: 1,
    });

    const otherFilterCompletion = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-filtered-absence-other-filter-${stamp}`,
      batchSequence: 1,
      cursorStart: firstCursor,
      cursorEnd: encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T15:30:00.000Z',
        listingKey: `${mirrorListingId}-other-filter-completion`,
      }),
      upstreamRunKey: `idealista-filtered-absence-run-${stamp}`,
      batchKind: 'completion',
      completions: [
        {
          scopeKey: 'city:eindhoven',
          listingType: 'sale',
          normalizedFilters: { rooms: 4 },
          sourceRunCompletedAt: '2026-04-06T15:30:00.000Z',
          observedListingCount: 0,
          sourceHighWatermark: '2026-04-06T15:30:00.000Z',
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: otherFilterCompletion.batchId,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 0,
      updated: 0,
      skipped: 0,
    });

    const [canonical] = await db
      .select()
      .from(canonicalListings)
      .where(eq(canonicalListings.propertyId, propertyId))
      .limit(1);
    expect(canonical).toMatchObject({
      sourceName,
      primarySourceListingId: mirrorListingId,
      status: 'active',
    });

    const absenceRows = await db
      .select()
      .from(listingObservations)
      .where(and(
        eq(listingObservations.ingestBatchId, otherFilterCompletion.batchId),
        eq(listingObservations.sourceStatus, 'not_found'),
      ));
    expect(absenceRows).toHaveLength(0);
  });

  it('does not withdraw listings observed in earlier batches of the same completed replay', async () => {
    const sourceName = 'idealista';
    const stamp = Date.now();
    const street = `Multi Batch Absence Street ${stamp}`;
    const propertyId = await seedProperty({ street, houseNumber: 52 });
    const mirrorListingId = `idealista-multi-batch-absence-${stamp}`;
    const sourceUrl = `https://www.idealista.com/inmueble/multi-batch-absence-${stamp}/`;
    const firstCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T14:00:00.000Z',
      listingKey: `${mirrorListingId}-initial`,
    });
    const replayObservationCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T16:00:00.000Z',
      listingKey: `${mirrorListingId}-replay-0`,
    });
    const replayCompletionCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T16:00:00.000Z',
      listingKey: `${mirrorListingId}-replay-1`,
    });
    const replayRunKey = `idealista-multi-batch-absence-run-${stamp}`;

    const firstAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-multi-batch-absence-initial-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: firstCursor,
      upstreamRunKey: `idealista-multi-batch-absence-initial-run-${stamp}`,
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          scopeKey: 'city:eindhoven',
          askingPrice: 420000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-06T14:00:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 52,
            city: 'Eindhoven',
          },
        },
      ],
    });
    await processIngestBatch({
      batchId: firstAccepted.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    const observationBatch = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-multi-batch-absence-observations-${stamp}`,
      batchSequence: 0,
      cursorStart: firstCursor,
      cursorEnd: replayObservationCursor,
      upstreamRunKey: replayRunKey,
      batchKind: 'observations',
      scopeKey: 'city:eindhoven',
      sourceHighWatermark: '2026-04-06T16:00:00.000Z',
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          scopeKey: 'city:eindhoven',
          askingPrice: 420000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-06T16:00:00.000Z',
          sourceHighWatermark: '2026-04-06T16:00:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 52,
            city: 'Eindhoven',
          },
        },
      ],
    });
    await processIngestBatch({
      batchId: observationBatch.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    const completionBatch = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-multi-batch-absence-completion-${stamp}`,
      batchSequence: 1,
      cursorStart: replayObservationCursor,
      cursorEnd: replayCompletionCursor,
      upstreamRunKey: replayRunKey,
      batchKind: 'completion',
      scopeKey: 'city:eindhoven',
      sourceHighWatermark: '2026-04-06T16:00:00.000Z',
      completions: [
        {
          scopeKey: 'city:eindhoven',
          listingType: 'sale',
          sourceRunId: replayRunKey,
          sourceRunCompletedAt: '2026-04-06T16:00:00.000Z',
          observedListingCount: 1,
          sourceHighWatermark: '2026-04-06T16:00:00.000Z',
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: completionBatch.batchId,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 0,
      updated: 0,
      skipped: 0,
    });

    const [canonical] = await db
      .select()
      .from(canonicalListings)
      .where(eq(canonicalListings.propertyId, propertyId))
      .limit(1);
    expect(canonical).toMatchObject({
      sourceName,
      primarySourceListingId: mirrorListingId,
      status: 'active',
    });

    const notFoundRows = await db
      .select()
      .from(listingObservations)
      .where(
        and(
          eq(listingObservations.sourceName, sourceName),
          eq(listingObservations.sourceListingId, mirrorListingId),
          eq(listingObservations.sourceStatus, 'not_found'),
        ),
      );
    expect(notFoundRows).toHaveLength(0);
  });

  it('does not withdraw present sale listings from unknown full-mirror completions', async () => {
    const sourceName = 'idealista';
    const stamp = Date.now();
    const street = `Unknown Completion Street ${stamp}`;
    const propertyId = await seedProperty({ street, houseNumber: 45 });
    const mirrorListingId = `idealista-unknown-completion-${stamp}`;
    const sourceUrl = `https://www.idealista.com/inmueble/unknown-completion-${stamp}/`;
    const firstCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T16:00:00.000Z',
      listingKey: `${mirrorListingId}-active`,
    });

    const firstAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-unknown-completion-active-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: firstCursor,
      upstreamRunKey: `idealista-unknown-completion-run-${stamp}`,
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          scopeKey: 'full-mirror',
          askingPrice: 440000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-06T16:00:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 45,
            city: 'Eindhoven',
          },
        },
      ],
    });

    await processIngestBatch({
      batchId: firstAccepted.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    const replayAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-unknown-completion-replay-${stamp}`,
      batchSequence: 1,
      cursorStart: firstCursor,
      cursorEnd: encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T17:00:00.000Z',
        listingKey: `${mirrorListingId}-full-mirror`,
      }),
      upstreamRunKey: `idealista-unknown-completion-run-${stamp}`,
      batchKind: 'observations_and_completion',
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          scopeKey: 'full-mirror',
          askingPrice: 440000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-06T17:00:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 45,
            city: 'Eindhoven',
          },
        },
      ],
      completions: [
        {
          scopeKey: 'full-mirror',
          listingType: 'unknown',
          sourceRunCompletedAt: '2026-04-06T17:00:00.000Z',
          observedListingCount: 1,
          sourceHighWatermark: '2026-04-06T17:00:00.000Z',
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: replayAccepted.batchId,
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
      .where(eq(canonicalListings.propertyId, propertyId))
      .limit(1);
    expect(canonical).toMatchObject({
      sourceName,
      primarySourceListingId: mirrorListingId,
      status: 'active',
    });

    const observations = await db
      .select()
      .from(listingObservations)
      .where(eq(listingObservations.sourceListingId, mirrorListingId));
    expect(observations.map((observation) => observation.sourceStatus)).not.toContain('not_found');
  });

  it('does not infer absence when the current completion only has diagnostic identity evidence', async () => {
    const sourceName = 'idealista';
    const stamp = Date.now();
    const street = `Diagnostic Present Completion ${stamp}`;
    const propertyId = await seedProperty({ street, houseNumber: 56 });
    const mirrorListingId = `idealista-diagnostic-present-${stamp}`;
    const sourceUrl = `https://www.idealista.com/inmueble/diagnostic-present-${stamp}/`;
    const firstCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T16:00:00.000Z',
      listingKey: `${mirrorListingId}-active`,
    });

    const firstAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-diagnostic-present-active-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: firstCursor,
      upstreamRunKey: `idealista-diagnostic-present-run-${stamp}`,
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          scopeKey: 'full-mirror',
          askingPrice: 440000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-06T16:00:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 56,
            city: 'Eindhoven',
          },
        },
      ],
    });
    await processIngestBatch({
      batchId: firstAccepted.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    const replayAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-diagnostic-present-replay-${stamp}`,
      batchSequence: 1,
      cursorStart: firstCursor,
      cursorEnd: encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T17:00:00.000Z',
        listingKey: `${mirrorListingId}-diagnostic`,
      }),
      upstreamRunKey: `idealista-diagnostic-present-run-${stamp}`,
      batchKind: 'observations_and_completion',
      sourceProvenance: 'import',
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          sourceListingId: mirrorListingId,
          scopeKey: 'full-mirror',
          askingPrice: null,
          priceType: 'sale',
          status: 'active',
          diagnosticStatus: 'unknown',
          observedAt: '2026-04-06T17:00:00.000Z',
          sourceHighWatermark: '2026-04-06T17:00:00.000Z',
        },
      ],
      completions: [
        {
          scopeKey: 'full-mirror',
          listingType: 'unknown',
          sourceRunCompletedAt: '2026-04-06T17:00:00.000Z',
          observedListingCount: 1,
          sourceHighWatermark: '2026-04-06T17:00:00.000Z',
        },
      ],
    });

    await processIngestBatch({
      batchId: replayAccepted.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    const [canonical] = await db
      .select()
      .from(canonicalListings)
      .where(eq(canonicalListings.propertyId, propertyId))
      .limit(1);
    expect(canonical).toMatchObject({
      sourceName,
      primarySourceListingId: mirrorListingId,
      status: 'active',
    });

    const observations = await db
      .select()
      .from(listingObservations)
      .where(eq(listingObservations.sourceListingId, mirrorListingId));
    expect(observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        diagnosticStatus: 'unknown',
        sourceStatus: null,
        payload: expect.objectContaining({ sourceProvenance: 'import' }),
      }),
    ]));
    expect(observations.map((observation) => observation.sourceStatus)).not.toContain('not_found');
  });

  it('stores stale scoped replay observations without projecting or regressing scope watermarks', async () => {
    const sourceName = 'idealista';
    const street = `Stale Scope Street ${Date.now()}`;
    const propertyId = await seedProperty({ street, houseNumber: 41 });
    const newerCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T20:00:00.000Z',
      listingKey: 'idealista-stale-scope-newer',
    });
    const olderCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T19:00:00.000Z',
      listingKey: 'idealista-stale-scope-older',
    });

    const newerCompletion = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-stale-newer-${Date.now()}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: newerCursor,
      upstreamRunKey: `idealista-stale-run-${Date.now()}`,
      batchKind: 'completion',
      completions: [
        {
          scopeKey: 'sale',
          listingType: 'sale',
          sourceRunCompletedAt: '2026-04-06T20:00:00.000Z',
          observedListingCount: 0,
          sourceHighWatermark: '2026-04-06T20:00:00.000Z',
        },
      ],
    });
    await processIngestBatch({
      batchId: newerCompletion.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    const staleAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-stale-older-${Date.now()}`,
      batchSequence: 1,
      cursorStart: newerCursor,
      cursorEnd: olderCursor,
      upstreamRunKey: `idealista-stale-run-${Date.now()}-older`,
      batchKind: 'observations_and_completion',
      scopeKey: 'sale',
      listings: [
        {
          sourceUrl: `https://www.idealista.com/inmueble/stale-${Date.now()}/`,
          mirrorListingId: `idealista-stale-${Date.now()}`,
          scopeKey: 'sale',
          askingPrice: 390000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-06T19:00:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 41,
            city: 'Eindhoven',
          },
        },
      ],
      completions: [
        {
          scopeKey: 'sale',
          listingType: 'sale',
          sourceRunCompletedAt: '2026-04-06T19:00:00.000Z',
          observedListingCount: 1,
          sourceHighWatermark: '2026-04-06T19:00:00.000Z',
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: staleAccepted.batchId,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 0,
      updated: 1,
      skipped: 0,
    });

    const [observation] = await db
      .select()
      .from(listingObservations)
      .where(eq(listingObservations.ingestBatchId, staleAccepted.batchId))
      .limit(1);
    expect(observation).toMatchObject({
      propertyId,
      staleForProjection: true,
    });

    const [canonical] = await db
      .select()
      .from(canonicalListings)
      .where(eq(canonicalListings.propertyId, propertyId))
      .limit(1);
    expect(canonical).toBeUndefined();

    const [scopeWatermark] = await db
      .select()
      .from(listingSourceScopeWatermarks)
      .where(eq(listingSourceScopeWatermarks.sourceName, sourceName))
      .limit(1);
    expect(scopeWatermark?.sourceHighWatermark).toEqual(new Date('2026-04-06T20:00:00.000Z'));
    expect(scopeWatermark?.ingestBatchId).toBe(newerCompletion.batchId);
  });

  it('stores lower source-cursor replay as stale evidence without regressing the committed cursor', async () => {
    const sourceName = 'idealista';
    const stamp = Date.now();
    const street = `Source Cursor Stale Street ${stamp}`;
    const propertyId = await seedProperty({ street, houseNumber: 54 });
    const mirrorListingId = `idealista-source-cursor-stale-${stamp}`;
    const sourceUrl = `https://www.idealista.com/inmueble/source-cursor-stale-${stamp}/`;
    const newerCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T20:00:00.000Z',
      listingKey: `${mirrorListingId}-newer`,
    });
    const olderCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T19:00:00.000Z',
      listingKey: `${mirrorListingId}-older`,
    });

    const newerAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-source-cursor-stale-newer-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: newerCursor,
      upstreamRunKey: `idealista-source-cursor-stale-run-newer-${stamp}`,
      sourceHighWatermark: '2026-04-06T20:00:00.000Z',
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          scopeKey: 'city:eindhoven',
          askingPrice: 500000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-06T20:00:00.000Z',
          sourceHighWatermark: '2026-04-06T20:00:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 54,
            city: 'Eindhoven',
          },
        },
      ],
    });
    await processIngestBatch({
      batchId: newerAccepted.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    const staleAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-source-cursor-stale-older-${stamp}`,
      batchSequence: 1,
      cursorStart: newerCursor,
      cursorEnd: olderCursor,
      upstreamRunKey: `idealista-source-cursor-stale-run-older-${stamp}`,
      sourceHighWatermark: '2026-04-06T19:00:00.000Z',
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          scopeKey: 'city:eindhoven',
          askingPrice: 390000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-06T19:00:00.000Z',
          sourceHighWatermark: '2026-04-06T19:00:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 54,
            city: 'Eindhoven',
          },
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: staleAccepted.batchId,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 0,
      updated: 1,
      skipped: 0,
    });

    const [staleObservation] = await db
      .select()
      .from(listingObservations)
      .where(eq(listingObservations.ingestBatchId, staleAccepted.batchId))
      .limit(1);
    expect(staleObservation).toMatchObject({
      propertyId,
      staleForProjection: true,
      askingPrice: 390000,
    });

    const [canonical] = await db
      .select()
      .from(canonicalListings)
      .where(eq(canonicalListings.propertyId, propertyId))
      .limit(1);
    expect(canonical).toMatchObject({
      status: 'active',
      askingPrice: 500000,
    });

    const [sourceState] = await db
      .select()
      .from(ingestSources)
      .where(eq(ingestSources.sourceName, sourceName))
      .limit(1);
    expect(sourceState?.lastCommittedCursor).toBe(newerCursor);
    expect(sourceState?.lastCommittedChangedAt).toEqual(new Date('2026-04-06T20:00:00.000Z'));
    expect(sourceState?.lastBatchId).toBe(newerAccepted.batchId);
  });

  it('projects fresh replay facts by source high-watermark even when listing updated-at is old', async () => {
    const sourceName = 'idealista';
    const stamp = Date.now();
    const street = `Fresh Highwater Street ${stamp}`;
    const propertyId = await seedProperty({ street, houseNumber: 59 });
    const mirrorListingId = `idealista-fresh-highwater-${stamp}`;
    const sourceUrl = `https://www.idealista.com/inmueble/fresh-highwater-${stamp}/`;
    const firstCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T20:00:00.000Z',
      listingKey: `${mirrorListingId}-first`,
    });
    const secondCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T21:00:00.000Z',
      listingKey: `${mirrorListingId}-second`,
    });

    const firstAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-fresh-highwater-first-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: firstCursor,
      upstreamRunKey: `idealista-fresh-highwater-run-${stamp}-first`,
      sourceHighWatermark: '2026-04-06T20:00:00.000Z',
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          askingPrice: 500000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-06T20:00:00.000Z',
          sourceHighWatermark: '2026-04-06T20:00:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 59,
            city: 'Eindhoven',
          },
        },
      ],
    });
    await processIngestBatch({ batchId: firstAccepted.batchId, enqueueMaintenanceRefresh: async () => {} });

    const secondAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-fresh-highwater-second-${stamp}`,
      batchSequence: 1,
      cursorStart: firstCursor,
      cursorEnd: secondCursor,
      upstreamRunKey: `idealista-fresh-highwater-run-${stamp}-second`,
      sourceHighWatermark: '2026-04-06T21:00:00.000Z',
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          askingPrice: 525000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-06T19:00:00.000Z',
          sourceHighWatermark: '2026-04-06T21:00:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 59,
            city: 'Eindhoven',
          },
        },
      ],
    });

    await expect(
      processIngestBatch({ batchId: secondAccepted.batchId, enqueueMaintenanceRefresh: async () => {} }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 1,
      updated: 0,
      skipped: 0,
    });

    const [canonical] = await db
      .select()
      .from(canonicalListings)
      .where(eq(canonicalListings.propertyId, propertyId))
      .limit(1);
    expect(canonical).toMatchObject({
      askingPrice: 525000,
      status: 'active',
    });
  });

  it('merges canonical listings by alias provenance when source id and URL change', async () => {
    const sourceName = 'idealista';
    const stamp = Date.now();
    const street = `Alias Merge Street ${stamp}`;
    const propertyId = await seedProperty({ street, houseNumber: 60 });
    const oldListingId = `idealista-alias-old-${stamp}`;
    const newListingId = `idealista-alias-new-${stamp}`;
    const oldUrl = `https://www.idealista.com/inmueble/alias-old-${stamp}/`;
    const newUrl = `https://www.idealista.com/inmueble/alias-new-${stamp}/`;
    const firstCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T20:10:00.000Z',
      listingKey: `${oldListingId}-first`,
    });
    const secondCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T20:20:00.000Z',
      listingKey: `${newListingId}-second`,
    });

    const firstAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-alias-merge-first-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: firstCursor,
      upstreamRunKey: `idealista-alias-merge-run-${stamp}-first`,
      sourceHighWatermark: '2026-04-06T20:10:00.000Z',
      listings: [
        {
          sourceUrl: oldUrl,
          canonicalUrl: oldUrl,
          mirrorListingId: oldListingId,
          sourceListingId: oldListingId,
          sourceListingIdKind: 'url_path',
          sourceListingAliases: [{ kind: 'url_path', value: oldListingId }],
          askingPrice: 500000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          sourceHighWatermark: '2026-04-06T20:10:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 60,
            city: 'Eindhoven',
          },
        },
      ],
    });
    await processIngestBatch({ batchId: firstAccepted.batchId, enqueueMaintenanceRefresh: async () => {} });

    const secondAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-alias-merge-second-${stamp}`,
      batchSequence: 1,
      cursorStart: firstCursor,
      cursorEnd: secondCursor,
      upstreamRunKey: `idealista-alias-merge-run-${stamp}-second`,
      sourceHighWatermark: '2026-04-06T20:20:00.000Z',
      listings: [
        {
          sourceUrl: newUrl,
          canonicalUrl: newUrl,
          mirrorListingId: newListingId,
          sourceListingId: newListingId,
          sourceListingIdKind: 'url_path',
          sourceListingAliases: [
            { kind: 'url_path', value: newListingId },
            { kind: 'url_path', value: oldListingId },
            { kind: 'canonical_url', value: oldUrl },
          ],
          askingPrice: 510000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          sourceHighWatermark: '2026-04-06T20:20:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 60,
            city: 'Eindhoven',
          },
        },
      ],
    });

    await expect(
      processIngestBatch({ batchId: secondAccepted.batchId, enqueueMaintenanceRefresh: async () => {} }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 1,
      updated: 0,
      skipped: 0,
    });

    const canonicalRows = await db
      .select()
      .from(canonicalListings)
      .where(eq(canonicalListings.propertyId, propertyId));

    expect(canonicalRows).toHaveLength(1);
    expect(canonicalRows[0]).toMatchObject({
      sourceName,
      primarySourceListingId: oldListingId,
      canonicalUrl: newUrl.replace(/\/$/, ''),
      askingPrice: 510000,
    });
  });

  it('prefers resolved primary source identity over newer alias matches when legacy duplicate canonicals exist', async () => {
    const sourceName = 'idealista';
    const stamp = Date.now();
    const street = `Alias Duplicate Canonical Street ${stamp}`;
    const propertyId = await seedProperty({ street, houseNumber: 61 });
    const primaryListingId = `idealista-alias-primary-${stamp}`;
    const legacyListingId = `idealista-alias-legacy-${stamp}`;
    const primaryUrl = `https://www.idealista.com/inmueble/alias-primary-${stamp}`;
    const legacyUrl = `https://www.idealista.com/inmueble/alias-legacy-${stamp}`;
    const firstBatchId = await seedCompletedBatchRecord({
      sourceName,
      stamp,
      suffix: 'alias-primary',
      completedAt: '2026-04-06T20:30:00.000Z',
    });
    const secondBatchId = await seedCompletedBatchRecord({
      sourceName,
      stamp,
      suffix: 'alias-legacy',
      completedAt: '2026-04-06T20:40:00.000Z',
    });

    await persistMirrorObservationForIngest(db, {
      batchId: firstBatchId,
      sourceName,
      sourceUrl: primaryUrl,
      sourceListingId: primaryListingId,
      sourceListingIdKind: 'tiny_id',
      aliases: [{ kind: 'tiny_id', value: primaryListingId }],
      propertyId,
      propertyMatchKind: 'source_exact',
      sourceStatus: 'available',
      askingPrice: 500000,
      priceCurrency: 'EUR',
      address: {
        countryCode: 'NL',
        street,
        postalCode: '1234 AB',
        houseNumber: 61,
        city: 'Eindhoven',
      },
      firstSeenAt: '2026-04-06T20:30:00.000Z',
      lastSeenAt: '2026-04-06T20:30:00.000Z',
      sourceUpdatedAt: '2026-04-06T20:30:00.000Z',
      observedAt: '2026-04-06T20:30:00.000Z',
      sourceHighWatermark: '2026-04-06T20:30:00.000Z',
      payload: { priceType: 'sale' },
    });

    const [legacyCanonical] = await db
      .insert(canonicalListings)
      .values({
        propertyId,
        sourceName,
        primarySourceListingId: legacyListingId,
        canonicalUrl: legacyUrl,
        displayUrl: legacyUrl,
        status: 'active',
        statusSource: 'mirror',
        verificationState: 'validated',
        originSummary: 'mirror',
        askingPrice: 490000,
        priceCurrency: 'EUR',
        priceType: 'sale',
        firstSeenAt: new Date('2026-04-06T20:35:00.000Z'),
        lastSeenAt: new Date('2026-04-06T20:35:00.000Z'),
        lastMirrorSeenAt: new Date('2026-04-06T20:35:00.000Z'),
        lastReconciledAt: new Date('2026-04-06T20:35:00.000Z'),
        updatedAt: new Date('2026-04-06T20:35:00.000Z'),
      })
      .returning({ id: canonicalListings.id });

    await upsertListingSourceAliases(sourceName, primaryListingId, [
      { kind: 'tiny_id', value: primaryListingId },
      { kind: 'tiny_id', value: legacyListingId },
      { kind: 'canonical_url', value: primaryUrl },
    ], db);

    await expect(
      persistMirrorObservationForIngest(db, {
        batchId: secondBatchId,
        sourceName,
        sourceUrl: primaryUrl,
        sourceListingId: legacyListingId,
        sourceListingIdKind: 'tiny_id',
        aliases: [
          { kind: 'tiny_id', value: legacyListingId },
          { kind: 'tiny_id', value: primaryListingId },
          { kind: 'canonical_url', value: primaryUrl },
        ],
        propertyId,
        propertyMatchKind: 'source_exact',
        sourceStatus: 'available',
        askingPrice: 510000,
        priceCurrency: 'EUR',
        address: {
          countryCode: 'NL',
          street,
          postalCode: '1234 AB',
          houseNumber: 61,
          city: 'Eindhoven',
        },
        firstSeenAt: '2026-04-06T20:40:00.000Z',
        lastSeenAt: '2026-04-06T20:40:00.000Z',
        sourceUpdatedAt: '2026-04-06T20:40:00.000Z',
        observedAt: '2026-04-06T20:40:00.000Z',
        sourceHighWatermark: '2026-04-06T20:40:00.000Z',
        payload: { priceType: 'sale' },
      }),
    ).resolves.toMatchObject({
      canonicalListing: {
        id: expect.any(String),
        primarySourceListingId: primaryListingId,
      },
    });

    const canonicalRows = await db
      .select()
      .from(canonicalListings)
      .where(eq(canonicalListings.propertyId, propertyId))
      .orderBy(canonicalListings.primarySourceListingId);

    expect(canonicalRows).toHaveLength(2);
    expect(canonicalRows.find((row) => row.primarySourceListingId === primaryListingId)).toMatchObject({
      canonicalUrl: primaryUrl,
      askingPrice: 510000,
    });
    expect(canonicalRows.find((row) => row.id === legacyCanonical?.id)).toMatchObject({
      primarySourceListingId: legacyListingId,
      canonicalUrl: legacyUrl,
      askingPrice: 490000,
    });
  });

  it('appends stale replay evidence without mutating prior projected observations', async () => {
    const sourceName = 'idealista';
    const stamp = Date.now();
    const street = `Immutable Stale Replay ${stamp}`;
    const propertyId = await seedProperty({ street, houseNumber: 55 });
    const mirrorListingId = `idealista-immutable-stale-${stamp}`;
    const sourceUrl = `https://www.idealista.com/inmueble/immutable-stale-${stamp}/`;
    const observedAt = '2026-04-06T19:00:00.000Z';
    const newerCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T20:00:00.000Z',
      listingKey: `${mirrorListingId}-newer`,
    });
    const olderCursor = encodeOpaqueIngestCursor({
      changedAt: observedAt,
      listingKey: `${mirrorListingId}-older`,
    });

    const newerAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-immutable-stale-newer-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: newerCursor,
      upstreamRunKey: `idealista-immutable-stale-run-newer-${stamp}`,
      sourceHighWatermark: '2026-04-06T20:00:00.000Z',
      sourceProvenance: 'crawler_discovered',
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          askingPrice: 510000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: observedAt,
          observedAt,
          sourceHighWatermark: '2026-04-06T20:00:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 55,
            city: 'Eindhoven',
          },
        },
      ],
    });
    await processIngestBatch({
      batchId: newerAccepted.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    const staleAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-immutable-stale-older-${stamp}`,
      batchSequence: 1,
      cursorStart: newerCursor,
      cursorEnd: olderCursor,
      upstreamRunKey: `idealista-immutable-stale-run-older-${stamp}`,
      sourceHighWatermark: observedAt,
      sourceProvenance: 'replay',
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          askingPrice: 470000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: observedAt,
          observedAt,
          sourceHighWatermark: observedAt,
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 55,
            city: 'Eindhoven',
          },
        },
      ],
    });
    await processIngestBatch({
      batchId: staleAccepted.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    const observations = await db
      .select()
      .from(listingObservations)
      .where(eq(listingObservations.sourceListingId, mirrorListingId));
    expect(observations).toHaveLength(2);
    expect(observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ingestBatchId: newerAccepted.batchId,
        origin: 'mirror',
        staleForProjection: false,
        askingPrice: 510000,
        payload: expect.objectContaining({ sourceProvenance: 'crawler_discovered' }),
      }),
      expect.objectContaining({
        ingestBatchId: staleAccepted.batchId,
        origin: 'replay',
        staleForProjection: true,
        askingPrice: 470000,
        payload: expect.objectContaining({ sourceProvenance: 'replay' }),
      }),
    ]));

    const [canonical] = await db
      .select()
      .from(canonicalListings)
      .where(eq(canonicalListings.propertyId, propertyId))
      .limit(1);
    expect(canonical).toMatchObject({
      status: 'active',
      askingPrice: 510000,
    });
  });

  it('preserves diagnostic mirror observations that do not have address fields', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const mirrorListingId = `fotocasa-diagnostic-no-address-${stamp}`;
    const cursorEnd = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T19:30:00.000Z',
      listingKey: mirrorListingId,
    });

    const accepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-diagnostic-no-address-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd,
      upstreamRunKey: `fotocasa-diagnostic-no-address-run-${stamp}`,
      sourceHighWatermark: '2026-04-06T19:30:00.000Z',
      listings: [
        {
          sourceUrl: `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/diagnostic-${stamp}`,
          mirrorListingId,
          sourceListingId: mirrorListingId,
          askingPrice: null,
          priceType: 'sale',
          status: 'active',
          diagnosticStatus: 'blocked',
          sourceHighWatermark: '2026-04-06T19:30:00.000Z',
          observedAt: '2026-04-06T19:30:00.000Z',
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
      updated: 1,
      skipped: 0,
    });

    const [observation] = await db
      .select()
      .from(listingObservations)
      .where(eq(listingObservations.ingestBatchId, accepted.batchId))
      .limit(1);
    expect(observation).toMatchObject({
      sourceName,
      sourceListingId: mirrorListingId,
      diagnosticStatus: 'blocked',
      propertyId: null,
      addressRaw: null,
      addressNormalized: null,
      staleForProjection: false,
    });
  });

  it('uses addressless terminal source identity to retire an existing canonical listing', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const street = `Terminal Identity Street ${stamp}`;
    const propertyId = await seedProperty({ street, houseNumber: 57 });
    const mirrorListingId = `fotocasa-terminal-identity-${stamp}`;
    const sourceUrl = `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/terminal-${stamp}`;
    const activeCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T19:40:00.000Z',
      listingKey: `${mirrorListingId}-active`,
    });

    const activeAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-terminal-identity-active-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: activeCursor,
      upstreamRunKey: `fotocasa-terminal-identity-run-${stamp}`,
      sourceHighWatermark: '2026-04-06T19:40:00.000Z',
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          sourceListingId: mirrorListingId,
          askingPrice: 450000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          sourceHighWatermark: '2026-04-06T19:40:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 57,
            city: 'Eindhoven',
          },
        },
      ],
    });
    await processIngestBatch({ batchId: activeAccepted.batchId, enqueueMaintenanceRefresh: async () => {} });

    const terminalAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-terminal-identity-not-found-${stamp}`,
      batchSequence: 1,
      cursorStart: activeCursor,
      cursorEnd: encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T19:50:00.000Z',
        listingKey: `${mirrorListingId}-not-found`,
      }),
      upstreamRunKey: `fotocasa-terminal-identity-run-${stamp}`,
      sourceHighWatermark: '2026-04-06T19:50:00.000Z',
      listings: [
        {
          sourceUrl,
          canonicalUrl: sourceUrl,
          mirrorListingId,
          sourceListingId: mirrorListingId,
          reasonCode: 'source_identity_terminal',
          matchEvidence: { sourceListingId: mirrorListingId, previousPropertyId: propertyId },
          askingPrice: null,
          priceType: 'unknown',
          status: 'active',
          lifecycleStatus: 'not_found',
          observedAt: '2026-04-06T19:50:00.000Z',
          sourceHighWatermark: '2026-04-06T19:50:00.000Z',
        },
      ],
    });

    await expect(
      processIngestBatch({ batchId: terminalAccepted.batchId, enqueueMaintenanceRefresh: async () => {} }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 1,
      updated: 0,
      skipped: 0,
    });

    const [canonical] = await db
      .select()
      .from(canonicalListings)
      .where(eq(canonicalListings.primarySourceListingId, mirrorListingId))
      .limit(1);
    expect(canonical).toMatchObject({
      sourceName,
      propertyId,
      status: 'withdrawn',
      statusSource: 'mirror',
    });

    const [terminalObservation] = await db
      .select()
      .from(listingObservations)
      .where(eq(listingObservations.ingestBatchId, terminalAccepted.batchId))
      .limit(1);
    expect(terminalObservation).toMatchObject({
      propertyId: null,
      sourceStatus: 'not_found',
      diagnosticStatus: null,
      payload: expect.objectContaining({
        reasonCode: 'source_identity_terminal',
        matchEvidence: { sourceListingId: mirrorListingId, previousPropertyId: propertyId },
        sourceEvidenceOnly: true,
      }),
    });
  });

  it('retires legacy active mirror canonical rows from source-wide full-mirror completion absence', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const propertyId = await seedProperty({
      street: `Legacy Full Mirror Street ${stamp}`,
      houseNumber: 58,
    });
    const mirrorListingId = `fotocasa-legacy-full-mirror-${stamp}`;
    const sourceUrl = `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/legacy-${stamp}`;
    await db.insert(canonicalListings).values({
      propertyId,
      sourceName,
      primarySourceListingId: mirrorListingId,
      canonicalUrl: sourceUrl,
      displayUrl: sourceUrl,
      status: 'active',
      statusSource: 'mirror',
      verificationState: 'validated',
      originSummary: 'mirror',
      askingPrice: 470000,
      priceCurrency: 'EUR',
      priceType: 'sale',
      lastMirrorSeenAt: new Date('2026-04-06T18:00:00.000Z'),
    });

    const accepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-legacy-full-mirror-completion-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T20:00:00.000Z',
        listingKey: `fotocasa-legacy-full-mirror-completion-${stamp}`,
      }),
      upstreamRunKey: `fotocasa-legacy-full-mirror-run-${stamp}`,
      batchKind: 'completion',
      completions: [
        {
          scopeKey: 'full-mirror',
          listingType: 'unknown',
          normalizedFilters: { replayScope: 'full-mirror' },
          sourceRunCompletedAt: '2026-04-06T20:00:00.000Z',
          observedListingCount: 0,
          sourceHighWatermark: '2026-04-06T20:00:00.000Z',
        },
      ],
    });

    await expect(
      processIngestBatch({ batchId: accepted.batchId, enqueueMaintenanceRefresh: async () => {} }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 1,
      updated: 0,
      skipped: 0,
    });

    const [canonical] = await db
      .select()
      .from(canonicalListings)
      .where(eq(canonicalListings.primarySourceListingId, mirrorListingId))
      .limit(1);
    expect(canonical).toMatchObject({
      status: 'withdrawn',
      statusSource: 'mirror',
    });
  });

  it('marks lower source-cursor replay stale even when the typed scope watermark is fresh', async () => {
    const sourceName = 'idealista';
    const stamp = Date.now();
    const street = `Typed Watermark Street ${stamp}`;
    const propertyId = await seedProperty({ street, houseNumber: 43 });
    const newerRentCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T21:00:00.000Z',
      listingKey: 'idealista-typed-rent-newer',
    });
    const saleReplayCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T20:30:00.000Z',
      listingKey: 'idealista-typed-sale-replay',
    });

    const newerRentCompletion = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-typed-rent-newer-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: newerRentCursor,
      upstreamRunKey: `idealista-typed-run-${stamp}`,
      batchKind: 'completion',
      completions: [
        {
          scopeKey: 'city:eindhoven',
          listingType: 'rent',
          sourceRunCompletedAt: '2026-04-06T21:00:00.000Z',
          observedListingCount: 0,
          sourceHighWatermark: '2026-04-06T21:00:00.000Z',
        },
      ],
    });
    await processIngestBatch({
      batchId: newerRentCompletion.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    const saleReplay = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-typed-sale-replay-${stamp}`,
      batchSequence: 1,
      cursorStart: newerRentCursor,
      cursorEnd: saleReplayCursor,
      upstreamRunKey: `idealista-typed-run-${stamp}-sale`,
      batchKind: 'observations_and_completion',
      listings: [
        {
          sourceUrl: `https://www.idealista.com/inmueble/typed-sale-${stamp}/`,
          mirrorListingId: `idealista-typed-sale-${stamp}`,
          scopeKey: 'city:eindhoven',
          askingPrice: 430000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-06T20:30:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 43,
            city: 'Eindhoven',
          },
        },
      ],
      completions: [
        {
          scopeKey: 'city:eindhoven',
          listingType: 'sale',
          sourceRunCompletedAt: '2026-04-06T20:30:00.000Z',
          observedListingCount: 1,
          sourceHighWatermark: '2026-04-06T20:30:00.000Z',
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: saleReplay.batchId,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 0,
      updated: 1,
      skipped: 0,
    });

    const [saleObservation] = await db
      .select()
      .from(listingObservations)
      .where(eq(listingObservations.ingestBatchId, saleReplay.batchId))
      .limit(1);
    expect(saleObservation).toMatchObject({
      propertyId,
      staleForProjection: true,
    });

    const [canonical] = await db
      .select()
      .from(canonicalListings)
      .where(eq(canonicalListings.propertyId, propertyId))
      .limit(1);
    expect(canonical).toBeUndefined();

    const saleWatermarks = await db
      .select()
      .from(listingSourceScopeWatermarks)
      .where(eq(listingSourceScopeWatermarks.sourceName, sourceName));
    expect(saleWatermarks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scopeKey: 'city:eindhoven',
          listingType: 'rent',
          sourceHighWatermark: new Date('2026-04-06T21:00:00.000Z'),
        }),
      ]),
    );
    expect(saleWatermarks.find((row) => row.listingType === 'sale')).toBeUndefined();
  });

  it('treats older concrete sale and rent observations as stale after an unknown full-mirror watermark', async () => {
    const sourceName = 'idealista';
    const stamp = Date.now();
    const salePropertyId = await seedProperty({ street: `Unknown Watermark Sale ${stamp}`, houseNumber: 47 });
    const rentPropertyId = await seedProperty({ street: `Unknown Watermark Rent ${stamp}`, houseNumber: 48 });
    const newerCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T22:00:00.000Z',
      listingKey: `idealista-unknown-watermark-newer-${stamp}`,
    });

    const newerCompletion = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-unknown-watermark-newer-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: newerCursor,
      upstreamRunKey: `idealista-unknown-watermark-run-${stamp}`,
      batchKind: 'completion',
      completions: [
        {
          scopeKey: 'full-mirror',
          listingType: 'unknown',
          sourceRunCompletedAt: '2026-04-06T22:00:00.000Z',
          observedListingCount: 0,
          sourceHighWatermark: '2026-04-06T22:00:00.000Z',
        },
      ],
    });
    await processIngestBatch({
      batchId: newerCompletion.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    const staleAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-unknown-watermark-older-${stamp}`,
      batchSequence: 1,
      cursorStart: newerCursor,
      cursorEnd: encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T21:30:00.000Z',
        listingKey: `idealista-unknown-watermark-older-${stamp}`,
      }),
      upstreamRunKey: `idealista-unknown-watermark-run-${stamp}-older`,
      batchKind: 'observations_and_completion',
      listings: [
        {
          sourceUrl: `https://www.idealista.com/inmueble/unknown-watermark-sale-${stamp}/`,
          mirrorListingId: `idealista-unknown-watermark-sale-${stamp}`,
          scopeKey: 'full-mirror',
          askingPrice: 455000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-06T21:30:00.000Z',
          address: {
            countryCode: 'NL',
            street: `Unknown Watermark Sale ${stamp}`,
            postalCode: '1234 AB',
            houseNumber: 47,
            city: 'Eindhoven',
          },
        },
        {
          sourceUrl: `https://www.idealista.com/inmueble/unknown-watermark-rent-${stamp}/`,
          mirrorListingId: `idealista-unknown-watermark-rent-${stamp}`,
          scopeKey: 'full-mirror',
          askingPrice: 1800,
          priceType: 'rent',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-06T21:30:00.000Z',
          address: {
            countryCode: 'NL',
            street: `Unknown Watermark Rent ${stamp}`,
            postalCode: '1234 AB',
            houseNumber: 48,
            city: 'Eindhoven',
          },
        },
      ],
      completions: [
        {
          scopeKey: 'full-mirror',
          listingType: 'unknown',
          sourceRunCompletedAt: '2026-04-06T21:30:00.000Z',
          observedListingCount: 2,
          sourceHighWatermark: '2026-04-06T21:30:00.000Z',
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: staleAccepted.batchId,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 0,
      updated: 2,
      skipped: 0,
    });

    const observations = await db
      .select()
      .from(listingObservations)
      .where(eq(listingObservations.ingestBatchId, staleAccepted.batchId));
    expect(observations).toHaveLength(2);
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ propertyId: salePropertyId, staleForProjection: true }),
        expect.objectContaining({ propertyId: rentPropertyId, staleForProjection: true }),
      ]),
    );

    const canonicals = await db
      .select()
      .from(canonicalListings)
      .where(inArray(canonicalListings.propertyId, [salePropertyId, rentPropertyId]));
    expect(canonicals).toHaveLength(0);
  });

  it('promotes compatible stale source evidence when the same observation replays as fresh', async () => {
    const sourceName = 'idealista';
    const stamp = Date.now();
    const street = `Observation Metadata Replay ${stamp}`;
    const propertyId = await seedProperty({ street, houseNumber: 49 });
    const mirrorListingId = `idealista-metadata-replay-${stamp}`;
    const sourceUrl = `https://www.idealista.com/inmueble/metadata-replay-${stamp}/`;
    const newerCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T23:00:00.000Z',
      listingKey: `${mirrorListingId}-newer-watermark`,
    });
    const observedAt = '2026-04-06T22:30:00.000Z';

    const newerCompletion = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-metadata-replay-newer-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: newerCursor,
      upstreamRunKey: `idealista-metadata-replay-run-${stamp}`,
      batchKind: 'completion',
      completions: [
        {
          scopeKey: 'full-mirror',
          listingType: 'unknown',
          sourceRunCompletedAt: '2026-04-06T23:00:00.000Z',
          observedListingCount: 0,
          sourceHighWatermark: '2026-04-06T23:00:00.000Z',
        },
      ],
    });
    await processIngestBatch({
      batchId: newerCompletion.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    const staleCursor = encodeOpaqueIngestCursor({
      changedAt: observedAt,
      listingKey: `${mirrorListingId}-stale`,
    });
    const staleAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-metadata-replay-stale-${stamp}`,
      batchSequence: 1,
      cursorStart: newerCursor,
      cursorEnd: staleCursor,
      upstreamRunKey: `idealista-metadata-replay-run-${stamp}-stale`,
      batchKind: 'observations_and_completion',
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          scopeKey: 'full-mirror',
          askingPrice: 465000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: observedAt,
          mirrorLastSeenAt: observedAt,
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 49,
            city: 'Eindhoven',
          },
        },
      ],
      completions: [
        {
          scopeKey: 'full-mirror',
          listingType: 'unknown',
          sourceRunCompletedAt: observedAt,
          observedListingCount: 1,
          sourceHighWatermark: observedAt,
        },
      ],
    });
    await processIngestBatch({
      batchId: staleAccepted.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    const [candidate] = await db
      .insert(listingCandidateHandoffs)
      .values({
        sourceName,
        propertyId,
        sourceUrlRaw: sourceUrl,
        sourceUrlCanonical: sourceUrl,
        sourceListingId: mirrorListingId,
        previewFacts: { title: 'metadata replay' },
        matchEvidence: { propertyId },
        state: 'queued',
      })
      .returning();
    expect(candidate?.id).toBeTruthy();

    const freshAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-metadata-replay-fresh-${stamp}`,
      batchSequence: 2,
      cursorStart: newerCursor,
      cursorEnd: encodeOpaqueIngestCursor({
        changedAt: '2026-04-07T00:00:00.000Z',
        listingKey: `${mirrorListingId}-fresh`,
      }),
      upstreamRunKey: `idealista-metadata-replay-run-${stamp}-fresh`,
      batchKind: 'observations_and_completion',
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          sourceCandidateId: candidate?.id,
          scopeKey: 'full-mirror',
          askingPrice: 465000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: observedAt,
          mirrorLastSeenAt: observedAt,
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 49,
            city: 'Eindhoven',
          },
        },
      ],
      completions: [
        {
          scopeKey: 'full-mirror',
          listingType: 'unknown',
          sourceRunCompletedAt: '2026-04-07T00:00:00.000Z',
          observedListingCount: 1,
          sourceHighWatermark: '2026-04-07T00:00:00.000Z',
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: freshAccepted.batchId,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 0,
      updated: 1,
      skipped: 0,
    });

    const observations = await db
      .select()
      .from(listingObservations)
      .where(eq(listingObservations.sourceListingId, mirrorListingId));
    expect(observations).toHaveLength(1);
    const freshObservation = observations[0];
    expect(freshObservation).toMatchObject({
      propertyId,
      origin: 'mirror',
      staleForProjection: false,
      ingestBatchId: freshAccepted.batchId,
      candidateHandoffId: candidate?.id,
      sourceHighWatermark: new Date('2026-04-07T00:00:00.000Z'),
    });
    expect(freshObservation?.scopeCompletionId).toBeTruthy();

    const [canonical] = await db
      .select()
      .from(canonicalListings)
      .where(eq(canonicalListings.propertyId, propertyId))
      .limit(1);
    expect(canonical).toMatchObject({
      sourceName,
      primarySourceListingId: mirrorListingId,
      status: 'active',
    });

    const [handoff] = await db
      .select()
      .from(listingCandidateHandoffs)
      .where(eq(listingCandidateHandoffs.id, candidate?.id ?? '00000000-0000-0000-0000-000000000000'))
      .limit(1);
    expect(handoff).toMatchObject({
      state: 'delivered',
      canonicalListingId: canonical?.id,
      observationId: freshObservation?.id,
    });
  });

  it('persists diagnostic observations as no-op projections', async () => {
    const sourceName = 'fotocasa';
    const street = `Diagnostic Street ${Date.now()}`;
    const propertyId = await seedProperty({ street, houseNumber: 44 });
    const cursorEnd = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T13:30:00.000Z',
      listingKey: 'fotocasa-diagnostic-noop',
    });
    const accepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-diagnostic-${Date.now()}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd,
      upstreamRunKey: `fotocasa-diagnostic-run-${Date.now()}`,
      listings: [
        {
          sourceUrl: `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/diagnostic-${Date.now()}`,
          mirrorListingId: `fotocasa-diagnostic-${Date.now()}`,
          askingPrice: 410000,
          priceType: 'sale',
          status: 'active',
          diagnosticStatus: 'blocked',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 44,
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
      updated: 1,
      skipped: 0,
    });

    const [observation] = await db
      .select()
      .from(listingObservations)
      .where(eq(listingObservations.ingestBatchId, accepted.batchId))
      .limit(1);
    expect(observation).toMatchObject({
      propertyId,
      diagnosticStatus: 'blocked',
      sourceStatus: null,
    });

    const [canonical] = await db
      .select()
      .from(canonicalListings)
      .where(eq(canonicalListings.propertyId, propertyId))
      .limit(1);
    expect(canonical).toBeUndefined();

    const [batch] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, accepted.batchId))
      .limit(1);
    expect(batch?.maintenanceRequestedAt).toBeNull();
  });

  it('retains source reason metadata on matched mirror observation payloads', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const street = `Reason Metadata Street ${stamp}`;
    const propertyId = await seedProperty({ street, houseNumber: 45 });
    const cursorEnd = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T13:40:00.000Z',
      listingKey: 'fotocasa-reason-metadata',
    });
    const accepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-reason-metadata-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd,
      upstreamRunKey: `fotocasa-reason-metadata-run-${stamp}`,
      listings: [
        {
          sourceUrl: `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/reason-metadata-${stamp}`,
          mirrorListingId: `fotocasa-reason-metadata-${stamp}`,
          sourceListingId: `fotocasa-reason-metadata-${stamp}`,
          reasonCode: 'source_identity_match',
          matchEvidence: {
            sourceListingId: `fotocasa-reason-metadata-${stamp}`,
            propertyId,
            score: 0.98,
          },
          askingPrice: 420000,
          priceType: 'sale',
          status: 'active',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 45,
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
      ingested: 1,
      updated: 0,
      skipped: 0,
    });

    const [observation] = await db
      .select()
      .from(listingObservations)
      .where(eq(listingObservations.ingestBatchId, accepted.batchId))
      .limit(1);
    expect(observation?.payload).toEqual(expect.objectContaining({
      reasonCode: 'source_identity_match',
      matchEvidence: expect.objectContaining({
        sourceListingId: `fotocasa-reason-metadata-${stamp}`,
        propertyId,
        score: 0.98,
      }),
    }));
  });

  it('persists diagnostic observations without an address or property match', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const cursorEnd = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T13:45:00.000Z',
      listingKey: 'fotocasa-diagnostic-unmatched',
    });
    const accepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-diagnostic-unmatched-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd,
      upstreamRunKey: `fotocasa-diagnostic-unmatched-run-${stamp}`,
      listings: [
        {
          sourceUrl: `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/diagnostic-unmatched-${stamp}`,
          mirrorListingId: `fotocasa-diagnostic-unmatched-${stamp}`,
          reasonCode: 'parser_failed',
          matchEvidence: { parser: 'detail-page', blockedBy: 'captcha' },
          askingPrice: null,
          priceType: 'sale',
          status: 'active',
          diagnosticStatus: 'parser_error',
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
      updated: 1,
      skipped: 0,
    });

    const [observation] = await db
      .select()
      .from(listingObservations)
      .where(eq(listingObservations.ingestBatchId, accepted.batchId))
      .limit(1);
    expect(observation).toMatchObject({
      sourceName,
      sourceListingId: `fotocasa-diagnostic-unmatched-${stamp}`,
      propertyId: null,
      propertyMatchKind: 'source_unmatched',
      diagnosticStatus: 'parser_error',
      sourceStatus: null,
      addressRaw: null,
      addressNormalized: null,
    });
    expect(observation?.payload).toEqual(expect.objectContaining({
      reasonCode: 'parser_failed',
      matchEvidence: { parser: 'detail-page', blockedBy: 'captcha' },
    }));

    const [batch] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, accepted.batchId))
      .limit(1);
    expect(batch?.skippedCount).toBe(0);
    expect(batch?.maintenanceRequestedAt).toBeNull();
  });

  it('reuses compatible mirror observations that hit the source observation idempotency key', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const street = `Observation Replay Street ${stamp}`;
    const propertyId = await seedProperty({ street, houseNumber: 46 });
    const mirrorListingId = `fotocasa-observation-replay-${stamp}`;
    const sourceUrl = `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/observation-replay-${stamp}`;
    const firstCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T16:30:00.000Z',
      listingKey: `${mirrorListingId}-first`,
    });

    const firstAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-observation-replay-first-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: firstCursor,
      upstreamRunKey: `fotocasa-observation-replay-run-${stamp}`,
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          askingPrice: 415000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-06T16:30:00.000Z',
          mirrorLastSeenAt: '2026-04-06T16:35:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 46,
            city: 'Eindhoven',
          },
        },
      ],
    });

    await processIngestBatch({
      batchId: firstAccepted.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    const replayAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-observation-replay-second-${stamp}`,
      batchSequence: 1,
      cursorStart: firstCursor,
      cursorEnd: encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T16:45:00.000Z',
        listingKey: `${mirrorListingId}-second`,
      }),
      upstreamRunKey: `fotocasa-observation-replay-run-${stamp}`,
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          askingPrice: 415000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-06T16:30:00.000Z',
          mirrorLastSeenAt: '2026-04-06T16:35:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 46,
            city: 'Eindhoven',
          },
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: replayAccepted.batchId,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 0,
      updated: 1,
      skipped: 0,
    });

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
    expect(observations[0]).toMatchObject({
      propertyId,
      ingestBatchId: replayAccepted.batchId,
    });

    const canonicals = await db
      .select()
      .from(canonicalListings)
      .where(
        and(
          eq(canonicalListings.sourceName, sourceName),
          eq(canonicalListings.primarySourceListingId, mirrorListingId),
        ),
      );
    expect(canonicals).toHaveLength(1);
  });

  it('refreshes legacy-compatible source observation metadata during idempotent replay', async () => {
    const sourceName = 'funda';
    const stamp = Date.now();
    const street = `Legacy Observation Replay Street ${stamp}`;
    const propertyId = await seedProperty({ street, houseNumber: 97 });
    const mirrorListingId = `7974737-${stamp}`;
    const observedAt = '2026-04-25T14:19:14.381Z';
    const firstBatchId = await seedCompletedBatchRecord({
      sourceName,
      stamp,
      suffix: 'legacy-observation-first',
      completedAt: observedAt,
    });
    const replayBatchId = await seedCompletedBatchRecord({
      sourceName,
      stamp,
      suffix: 'legacy-observation-replay',
      completedAt: '2026-05-06T12:31:12.990Z',
    });

    const first = await persistMirrorObservationForIngest(db, {
      batchId: firstBatchId,
      sourceName,
      sourceUrl: `https://www.funda.nl/detail/${mirrorListingId}`,
      sourceListingId: mirrorListingId,
      sourceListingIdKind: 'unknown',
      aliases: [],
      propertyId,
      propertyMatchKind: 'source_exact',
      sourceStatus: 'available',
      askingPrice: 2150000,
      priceCurrency: 'EUR',
      address: {
        countryCode: 'NL',
        street,
        postalCode: '1082MX',
        houseNumber: 97,
        city: 'Amsterdam',
      },
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
      sourceUpdatedAt: observedAt,
      observedAt,
      payload: {
        priceType: 'rent',
        livingAreaM2: 207,
        numRooms: 4,
        energyLabel: 'A',
        mirrorListingId,
      },
    });

    const replay = await persistMirrorObservationForIngest(db, {
      batchId: replayBatchId,
      sourceName,
      sourceUrl: `https://www.funda.nl/detail/${mirrorListingId}/`,
      sourceListingId: mirrorListingId,
      sourceListingIdKind: 'tiny_id',
      aliases: [
        { kind: 'tiny_id', value: mirrorListingId },
        { kind: 'canonical_url', value: `https://www.funda.nl/detail/${mirrorListingId}/` },
      ],
      propertyId,
      propertyMatchKind: 'source_exact',
      sourceStatus: 'available',
      askingPrice: 2150000,
      priceCurrency: 'EUR',
      address: {
        countryCode: 'NL',
        street,
        postalCode: '1082MX',
        houseNumber: 97,
        city: 'Amsterdam',
      },
      title: `Te huur: ${street}: Amsterdam`,
      firstSeenAt: observedAt,
      lastSeenAt: '2026-05-06T11:52:09.878Z',
      sourceUpdatedAt: observedAt,
      observedAt,
      sourceHighWatermark: '2026-05-06T12:31:12.990Z',
      sourceProvenance: 'import',
      payload: {
        priceType: 'rent',
        livingAreaM2: 207,
        numRooms: 4,
        energyLabel: 'A',
        mirrorListingId,
      },
    });

    expect(replay.observationId).toBe(first.observationId);
    const [observation] = await db
      .select()
      .from(listingObservations)
      .where(eq(listingObservations.id, first.observationId))
      .limit(1);

    expect(observation).toMatchObject({
      ingestBatchId: replayBatchId,
      sourceListingIdKind: 'tiny_id',
      sourceListingAliases: [
        { kind: 'tiny_id', value: mirrorListingId },
        { kind: 'canonical_url', value: `https://www.funda.nl/detail/${mirrorListingId}/` },
      ],
    });
    expect(observation?.lastSeenAt?.toISOString()).toBe('2026-05-06T11:52:09.878Z');
    expect(observation?.payload).toEqual(expect.objectContaining({
      title: `Te huur: ${street}: Amsterdam`,
      sourceProvenance: 'import',
      mirrorListingId,
    }));
  });

  it('reuses compatible URL-only source observations for idempotent replay', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const street = `URL Only Replay Street ${stamp}`;
    const propertyId = await seedProperty({ street, houseNumber: 47 });
    const sourceUrl = `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/url-only-replay-${stamp}`;
    const observedAt = '2026-04-06T16:40:00.000Z';
    const firstBatchId = await seedCompletedBatchRecord({
      sourceName,
      stamp,
      suffix: 'url-only-observation-first',
      completedAt: observedAt,
    });
    const replayBatchId = await seedCompletedBatchRecord({
      sourceName,
      stamp,
      suffix: 'url-only-observation-replay',
      completedAt: '2026-04-06T16:50:00.000Z',
    });

    const first = await persistMirrorObservationForIngest(db, {
      batchId: firstBatchId,
      sourceName,
      sourceUrl,
      sourceListingId: null,
      sourceListingIdKind: null,
      propertyId,
      propertyMatchKind: 'source_exact',
      sourceStatus: 'available',
      askingPrice: 395000,
      priceCurrency: 'EUR',
      observedAt,
      lastSeenAt: observedAt,
      sourceUpdatedAt: observedAt,
      sourceProvenance: 'replay',
      payload: { priceType: 'sale' },
    });
    const replay = await persistMirrorObservationForIngest(db, {
      batchId: replayBatchId,
      sourceName,
      sourceUrl,
      sourceListingId: null,
      sourceListingIdKind: null,
      propertyId,
      propertyMatchKind: 'source_exact',
      sourceStatus: 'available',
      askingPrice: 395000,
      priceCurrency: 'EUR',
      observedAt,
      lastSeenAt: observedAt,
      sourceUpdatedAt: observedAt,
      sourceProvenance: 'replay',
      payload: { priceType: 'sale' },
    });

    expect(replay.observationId).toBe(first.observationId);
    const observations = await db
      .select()
      .from(listingObservations)
      .where(
        and(
          eq(listingObservations.sourceName, sourceName),
          eq(listingObservations.sourceUrlCanonical, sourceUrl),
        ),
      );
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      sourceListingId: null,
      propertyId,
      ingestBatchId: replayBatchId,
      staleForProjection: false,
    });

    const canonicals = await db
      .select()
      .from(canonicalListings)
      .where(
        and(
          eq(canonicalListings.sourceName, sourceName),
          eq(canonicalListings.canonicalUrl, sourceUrl),
        ),
      );
    expect(canonicals).toHaveLength(1);
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

  it('operator recovery requeues only the newest failed batch at the current source watermark', async () => {
    const stamp = Date.now();
    const olderCursorEnd = encodeOpaqueIngestCursor({
      changedAt: '2026-04-09T03:40:00.000Z',
      listingKey: `idealista-operator-requeue-older-${stamp}`,
    });
    const cursorEnd = encodeOpaqueIngestCursor({
      changedAt: '2026-04-09T03:50:00.000Z',
      listingKey: `idealista-operator-requeue-${stamp}`,
    });
    const olderAccepted = await acceptIngestBatch({
      sourceName: 'idealista',
      idempotencyKey: `idealista-operator-requeue-older-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: olderCursorEnd,
      upstreamRunKey: `idealista-operator-requeue-run-${stamp}`,
      listings: [
        {
          sourceUrl: `https://www.idealista.com/inmueble/operator-requeue-older-${stamp}/`,
          mirrorListingId: `idealista-operator-requeue-older-listing-${stamp}`,
          askingPrice: 520000,
          priceType: 'sale',
          status: 'active' as const,
          address: {
            countryCode: 'ES',
            street: 'Calle Operator',
            postalCode: '28013',
            houseNumber: 7,
            city: 'Madrid',
          },
        },
      ],
    });
    const accepted = await acceptIngestBatch({
      sourceName: 'idealista',
      idempotencyKey: `idealista-operator-requeue-${stamp}`,
      batchSequence: 1,
      cursorStart: null,
      cursorEnd,
      upstreamRunKey: `idealista-operator-requeue-run-${stamp}`,
      listings: [
        {
          sourceUrl: `https://www.idealista.com/inmueble/operator-requeue-${stamp}/`,
          mirrorListingId: `idealista-operator-requeue-listing-${stamp}`,
          askingPrice: 520000,
          priceType: 'sale',
          status: 'active' as const,
          address: {
            countryCode: 'ES',
            street: 'Calle Operator',
            postalCode: '28013',
            houseNumber: 8,
            city: 'Madrid',
          },
        },
      ],
    });

    await db
      .update(ingestBatches)
      .set({
        status: 'failed',
        errorJson: {
          message: 'fixed production failure',
        },
        lastErrorAt: new Date('2026-04-09T03:55:00.000Z'),
      })
      .where(inArray(ingestBatches.id, [olderAccepted.batchId, accepted.batchId]));

    const result = await requeueBlockedSourceBatchesAtWatermark('idealista', 10);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: accepted.batchId,
      previousStatus: 'failed',
      status: 'retryable',
      cursorStart: null,
    });

    const batchRows = await db
      .select({
        id: ingestBatches.id,
        status: ingestBatches.status,
        startedAt: ingestBatches.startedAt,
        completedAt: ingestBatches.completedAt,
        errorJson: ingestBatches.errorJson,
      })
      .from(ingestBatches)
      .where(inArray(ingestBatches.id, [olderAccepted.batchId, accepted.batchId]));
    const updatedBatch = batchRows.find((row) => row.id === accepted.batchId);
    const olderBatch = batchRows.find((row) => row.id === olderAccepted.batchId);

    expect(updatedBatch?.status).toBe('retryable');
    expect(updatedBatch?.startedAt).toBeNull();
    expect(updatedBatch?.completedAt).toBeNull();
    expect(updatedBatch?.errorJson).toMatchObject({
      message: 'Requeued by operator recovery at current watermark',
      previousStatus: 'failed',
      previousError: {
        message: 'fixed production failure',
      },
    });
    expect(olderBatch?.status).toBe('superseded');
    expect(olderBatch?.completedAt).not.toBeNull();
    expect(olderBatch?.errorJson).toMatchObject({
      message: 'Superseded by newer overlapping batch during operator recovery at current watermark',
      previousStatus: 'failed',
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

  it('dispatches and processes the next batch when cursor precision differs but position is equal', async () => {
    const stamp = Date.now();
    const listingKey = `idealista-equivalent-cursor-1-${stamp}`;
    const committedCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-09T05:00:47.016Z',
      listingKey,
    });
    const equivalentCursor = encodeRawCursor({
      changedAt: '2026-04-09T05:00:47.016000Z',
      listingKey,
    });
    const nextCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-09T05:10:00.000Z',
      listingKey: `idealista-equivalent-cursor-2-${stamp}`,
    });

    const firstAccepted = await acceptIngestBatch({
      sourceName: 'idealista',
      idempotencyKey: `idealista-equivalent-cursor-first-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: committedCursor,
      upstreamRunKey: `idealista-equivalent-cursor-run-${stamp}`,
      listings: [
        {
          sourceUrl: `https://www.idealista.com/inmueble/equivalent-cursor-${stamp}/`,
          mirrorListingId: `idealista-equivalent-cursor-listing-${stamp}`,
          askingPrice: 520000,
          priceType: 'sale',
          status: 'active' as const,
          address: {
            countryCode: 'ES',
            street: 'Calle Precision',
            postalCode: '28013',
            houseNumber: 10,
            city: 'Madrid',
          },
        },
      ],
    });
    await processIngestBatch({ batchId: firstAccepted.batchId, enqueueMaintenanceRefresh: async () => {} });

    const secondAccepted = await acceptIngestBatch({
      sourceName: 'idealista',
      idempotencyKey: `idealista-equivalent-cursor-second-${stamp}`,
      batchSequence: 1,
      cursorStart: equivalentCursor,
      cursorEnd: nextCursor,
      upstreamRunKey: `idealista-equivalent-cursor-run-${stamp}`,
      listings: [
        {
          sourceUrl: `https://www.idealista.com/inmueble/equivalent-cursor-${stamp + 1}/`,
          mirrorListingId: `idealista-equivalent-cursor-listing-${stamp + 1}`,
          askingPrice: 530000,
          priceType: 'sale',
          status: 'active' as const,
          address: {
            countryCode: 'ES',
            street: 'Calle Precision',
            postalCode: '28013',
            houseNumber: 11,
            city: 'Madrid',
          },
        },
      ],
    });

    await db.update(ingestBatches).set({ status: 'queued' }).where(eq(ingestBatches.id, secondAccepted.batchId));

    const recovery = await collectRecoveryDispatchWork(new Date('2026-04-09T05:15:00.000Z'));
    expect(recovery.recoverableBatchIds).toContain(secondAccepted.batchId);

    await expect(
      processIngestBatch({ batchId: secondAccepted.batchId, enqueueMaintenanceRefresh: async () => {} }),
    ).resolves.toMatchObject({
      status: 'completed',
    });

    const [sourceState] = await db
      .select({ lastCommittedCursor: ingestSources.lastCommittedCursor })
      .from(ingestSources)
      .where(eq(ingestSources.sourceName, 'idealista'))
      .limit(1);

    expect(sourceState?.lastCommittedCursor).toBe(nextCursor);
  });

  it('dispatches queued evidence batches already covered by the committed watermark as stale audit work', async () => {
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

    expect(result.recoverableBatchIds).toEqual(
      expect.arrayContaining([firstAccepted.batchId, secondAccepted.batchId]),
    );

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
      expect(batch.status).toBe('queued');
      expect(batch.completedAt).toBeNull();
      expect(batch.errorJson).toBeNull();
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

    expect(activeRows).toHaveLength(2);

    const [runState] = await db
      .select()
      .from(ingestRuns)
      .where(eq(ingestRuns.id, firstAccepted.runId as string))
      .limit(1);

    expect(runState?.status).toBe('in_progress');
    expect(runState?.processedBatchCount).toBe(0);
    expect(runState?.completedAt).toBeNull();
    expect(runState?.errorSummary).toBeNull();
  });

  it('does not dispatch future full-mirror replay batches as stale evidence during recovery', async () => {
    const sourceName = 'idealista';
    const stamp = Date.now();
    const committedCursor = fullMirrorReplayCursor('funda', 2, 3000);
    const futureStartCursor = fullMirrorReplayCursor('funda', 9, 10000);
    const batchTenCursor = fullMirrorReplayCursor('funda', 10, 11000);
    const coveredEndCursor = fullMirrorReplayCursor('funda', 1, 1000);

    const batchTenAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-full-mirror-recovery-ten-${stamp}`,
      batchSequence: 10,
      cursorStart: futureStartCursor,
      cursorEnd: batchTenCursor,
      upstreamRunKey: `idealista-full-mirror-recovery-ten-run-${stamp}`,
      batchKind: 'observations_and_completion',
      sourceHighWatermark: '2026-04-09T08:00:00.000Z',
      listings: [
        {
          sourceUrl: `https://www.idealista.com/inmueble/full-mirror-recovery-ten-${stamp}/`,
          mirrorListingId: `idealista-full-mirror-recovery-ten-${stamp}`,
          scopeKey: 'full-mirror',
          askingPrice: 520000,
          priceType: 'sale',
          status: 'active' as const,
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-09T08:00:00.000Z',
          sourceHighWatermark: '2026-04-09T08:00:00.000Z',
          address: {
            countryCode: 'ES',
            street: 'Calle Recovery Future',
            postalCode: '28013',
            houseNumber: 10,
            city: 'Madrid',
          },
        },
      ],
    });

    const futureStartCoveredEndAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-full-mirror-recovery-covered-${stamp}`,
      batchSequence: 11,
      cursorStart: batchTenCursor,
      cursorEnd: coveredEndCursor,
      upstreamRunKey: `idealista-full-mirror-recovery-covered-run-${stamp}`,
      batchKind: 'observations_and_completion',
      sourceHighWatermark: '2026-04-09T08:00:00.000Z',
      listings: [
        {
          sourceUrl: `https://www.idealista.com/inmueble/full-mirror-recovery-covered-${stamp}/`,
          mirrorListingId: `idealista-full-mirror-recovery-covered-${stamp}`,
          scopeKey: 'full-mirror',
          askingPrice: 525000,
          priceType: 'sale',
          status: 'active' as const,
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-09T08:00:00.000Z',
          sourceHighWatermark: '2026-04-09T08:00:00.000Z',
          address: {
            countryCode: 'ES',
            street: 'Calle Recovery Future',
            postalCode: '28013',
            houseNumber: 11,
            city: 'Madrid',
          },
        },
      ],
    });

    await db
      .update(ingestSources)
      .set({
        lastCommittedCursor: committedCursor,
        lastCommittedChangedAt: new Date('2026-04-09T08:00:00.000Z'),
        lastCommittedListingKey: 'funda:full-mirror:2:3000',
      })
      .where(eq(ingestSources.sourceName, sourceName));

    const result = await collectRecoveryDispatchWork(new Date('2026-04-09T09:00:00.000Z'));

    expect(result.recoverableBatchIds).not.toContain(batchTenAccepted.batchId);
    expect(result.recoverableBatchIds).not.toContain(futureStartCoveredEndAccepted.batchId);

    const batchRows = await db
      .select({
        id: ingestBatches.id,
        status: ingestBatches.status,
        completedAt: ingestBatches.completedAt,
        errorJson: ingestBatches.errorJson,
      })
      .from(ingestBatches)
      .where(inArray(ingestBatches.id, [
        batchTenAccepted.batchId,
        futureStartCoveredEndAccepted.batchId,
      ]));

    expect(batchRows).toHaveLength(2);
    for (const batch of batchRows) {
      expect(batch.status).toBe('accepted');
      expect(batch.completedAt).toBeNull();
      expect(batch.errorJson).toBeNull();
    }
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
    await db
      .update(ingestBatches)
      .set({ skippedCount: 0 })
      .where(eq(ingestBatches.id, batchId));
    const snapshotStateBefore = await readPropertyTileSnapshotInvalidationState();

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

    const snapshotStateAfter = await readPropertyTileSnapshotInvalidationState();
    expect(snapshotStateAfter.listingWatermark > snapshotStateBefore.listingWatermark).toBe(true);
    expect(snapshotStateAfter.propertyWatermark > snapshotStateBefore.propertyWatermark).toBe(true);
    expect(snapshotStateAfter.refreshState).toMatchObject({
      requestReason: 'skipped-ingest-recovery',
      requestedListingWatermark: snapshotStateAfter.listingWatermark,
      requestedPropertyWatermark: snapshotStateAfter.propertyWatermark,
    });

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
    await db
      .update(ingestBatches)
      .set({ skippedCount: 0 })
      .where(eq(ingestBatches.id, batchId));
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

  it('recovers at most one skipped completed batch per bounded maintenance call', async () => {
    const firstSourceName = 'fotocasa';
    const secondSourceName = 'idealista';
    const stamp = Date.now();
    const firstStreet = `Recoverylimiet-${stamp}`;
    const secondStreet = `Recoverylimiet-${stamp + 1}`;
    const firstMirrorListingId = `fotocasa-recovery-limit-first-${stamp}`;
    const secondMirrorListingId = `idealista-recovery-limit-second-${stamp}`;
    const firstSourceUrl = `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/recovery-limit-first-${stamp}`;
    const secondSourceUrl = `https://www.idealista.com/inmueble/recovery-limit-second-${stamp}/`;
    const firstBatch = await createSkippedCompletedBatch({
      sourceName: firstSourceName,
      stamp,
      street: firstStreet,
      houseNumber: 65,
      mirrorListingId: firstMirrorListingId,
      sourceUrl: firstSourceUrl,
    });
    const secondBatch = await createSkippedCompletedBatch({
      sourceName: secondSourceName,
      stamp: stamp + 1,
      street: secondStreet,
      houseNumber: 66,
      mirrorListingId: secondMirrorListingId,
      sourceUrl: secondSourceUrl,
    });

    await seedProperty({ street: firstStreet, houseNumber: 65 });
    await seedProperty({ street: secondStreet, houseNumber: 66 });
    await db
      .update(ingestBatches)
      .set({ skippedCount: 0 })
      .where(inArray(ingestBatches.id, [firstBatch.batchId, secondBatch.batchId]));

    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(true);

    let refreshCalls = 0;
    const firstRefreshCount = await refreshLatestListingsMaintenance(
      async () => {
        refreshCalls += 1;
      },
      { skippedBatchRecoveryLimit: 1 },
    );

    expect(firstRefreshCount).toBeGreaterThanOrEqual(1);
    expect(refreshCalls).toBe(1);

    const observationsAfterFirstRefresh = await db
      .select({
        sourceListingId: listingObservations.sourceListingId,
        ingestBatchId: listingObservations.ingestBatchId,
      })
      .from(listingObservations)
      .where(
        and(
          inArray(listingObservations.sourceName, [firstSourceName, secondSourceName]),
          inArray(listingObservations.sourceListingId, [firstMirrorListingId, secondMirrorListingId]),
          eq(listingObservations.origin, 'mirror'),
        ),
      );

    expect(observationsAfterFirstRefresh).toHaveLength(1);
    expect([firstBatch.batchId, secondBatch.batchId]).toContain(
      observationsAfterFirstRefresh[0]?.ingestBatchId,
    );

    const recoveredBatchId = observationsAfterFirstRefresh[0]?.ingestBatchId;
    const unrecoveredBatchId =
      recoveredBatchId === firstBatch.batchId ? secondBatch.batchId : firstBatch.batchId;
    const [unrecoveredBatchAfterFirstRefresh] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, unrecoveredBatchId))
      .limit(1);

    expect(unrecoveredBatchAfterFirstRefresh?.ingestedCount).toBe(0);
    expect(unrecoveredBatchAfterFirstRefresh?.skippedCount).toBe(0);
    expect(unrecoveredBatchAfterFirstRefresh?.maintenanceRequestedAt).toBeNull();
    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(true);

    refreshCalls = 0;
    const secondRefreshCount = await refreshLatestListingsMaintenance(
      async () => {
        refreshCalls += 1;
      },
      { skippedBatchRecoveryLimit: 1 },
    );

    expect(secondRefreshCount).toBeGreaterThanOrEqual(1);
    expect(refreshCalls).toBe(1);

    const observationsAfterSecondRefresh = await db
      .select({
        sourceListingId: listingObservations.sourceListingId,
        ingestBatchId: listingObservations.ingestBatchId,
      })
      .from(listingObservations)
      .where(
        and(
          inArray(listingObservations.sourceName, [firstSourceName, secondSourceName]),
          inArray(listingObservations.sourceListingId, [firstMirrorListingId, secondMirrorListingId]),
          eq(listingObservations.origin, 'mirror'),
        ),
      );

    expect(observationsAfterSecondRefresh).toHaveLength(2);
    expect(observationsAfterSecondRefresh.map((observation) => observation.ingestBatchId).sort()).toEqual(
      [firstBatch.batchId, secondBatch.batchId].sort(),
    );
  });

  it('recovers missing observations from a zero-skipped completed batch without duplicating existing same-batch observations', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const existingStreet = `Recoverylaan-${stamp}`;
    const existingPriorStreet = `Recoverydreef-${stamp}`;
    const missingStreet = `Recoveryhof-${stamp}`;
    const existingMirrorListingId = `fotocasa-recovery-zero-existing-${stamp}`;
    const missingMirrorListingId = `fotocasa-recovery-zero-missing-${stamp}`;
    const existingSourceUrl = `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/recovery-zero-existing-${stamp}`;
    const missingSourceUrl = `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/recovery-zero-missing-${stamp}`;
    const existingPriorPropertyId = await seedProperty({ street: existingPriorStreet, houseNumber: 71 });
    const missingPropertyId = await seedProperty({ street: missingStreet, houseNumber: 72 });
    await seedProperty({ street: existingStreet, houseNumber: 71 });
    const cursorEnd = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T15:00:00.000Z',
      listingKey: `fotocasa-recovery-zero-${stamp}`,
    });
    const payload = {
      sourceName,
      idempotencyKey: `fotocasa-recovery-zero-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd,
      upstreamRunKey: `fotocasa-recovery-zero-run-${stamp}`,
      listings: [
        {
          sourceUrl: existingSourceUrl,
          mirrorListingId: existingMirrorListingId,
          askingPrice: 515000,
          priceType: 'sale' as const,
          status: 'active' as const,
          mirrorFirstSeenAt: '2026-04-05T15:00:00.000Z',
          mirrorLastChangedAt: '2026-04-06T15:00:00.000Z',
          mirrorLastSeenAt: '2026-04-06T15:10:00.000Z',
          address: {
            countryCode: 'NL',
            street: existingStreet,
            postalCode: '1234 AB',
            houseNumber: 71,
            city: 'Eindhoven',
          },
        },
        {
          sourceUrl: missingSourceUrl,
          mirrorListingId: missingMirrorListingId,
          askingPrice: 525000,
          priceType: 'sale' as const,
          status: 'active' as const,
          mirrorFirstSeenAt: '2026-04-05T15:00:00.000Z',
          mirrorLastChangedAt: '2026-04-06T15:00:00.000Z',
          mirrorLastSeenAt: '2026-04-06T15:10:00.000Z',
          address: {
            countryCode: 'NL',
            street: missingStreet,
            postalCode: '1234 AB',
            houseNumber: 72,
            city: 'Eindhoven',
          },
        },
      ],
    };

    const [batch] = await db
      .insert(ingestBatches)
      .values({
        sourceName,
        batchSequence: 0,
        idempotencyKey: payload.idempotencyKey,
        cursorEnd,
        payloadJson: payload,
        status: 'completed',
        receivedAt: new Date('1999-01-01T00:00:00.000Z'),
        completedAt: new Date('1999-01-01T00:00:00.000Z'),
        ingestedCount: 1,
        skippedCount: 0,
      })
      .returning({ id: ingestBatches.id });

    expect(batch?.id).toBeTruthy();
    const batchId = batch?.id as string;

    await db.insert(listingObservations).values({
      sourceName,
      sourceListingId: existingMirrorListingId,
      sourceListingIdKind: 'unknown',
      sourceUrlRaw: existingSourceUrl,
      sourceUrlCanonical: existingSourceUrl,
      origin: 'mirror',
      propertyId: existingPriorPropertyId,
      propertyMatchKind: 'source_exact',
      sourceStatus: 'available',
      askingPrice: 515000,
      priceCurrency: 'EUR',
      ingestBatchId: batchId,
      observedAt: new Date('2026-04-06T15:10:00.000Z'),
    });

    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(true);

    let refreshCalls = 0;
    const refreshedCount = await refreshLatestListingsMaintenance(async () => {
      refreshCalls += 1;
    });

    expect(refreshedCount).toBe(1);
    expect(refreshCalls).toBe(1);

    const observations = await db
      .select({
        sourceListingId: listingObservations.sourceListingId,
        propertyId: listingObservations.propertyId,
        ingestBatchId: listingObservations.ingestBatchId,
      })
      .from(listingObservations)
      .where(
        and(
          eq(listingObservations.sourceName, sourceName),
          inArray(listingObservations.sourceListingId, [existingMirrorListingId, missingMirrorListingId]),
          eq(listingObservations.origin, 'mirror'),
        ),
      );

    expect(observations).toHaveLength(2);
    expect(observations.filter((observation) => observation.sourceListingId === existingMirrorListingId)).toHaveLength(1);
    expect(observations.filter((observation) => observation.sourceListingId === missingMirrorListingId)).toHaveLength(1);
    expect(observations.find((observation) => observation.sourceListingId === existingMirrorListingId)?.propertyId)
      .toBe(existingPriorPropertyId);
    expect(observations.find((observation) => observation.sourceListingId === missingMirrorListingId)?.propertyId)
      .toBe(missingPropertyId);
    expect(observations.every((observation) => observation.ingestBatchId === batchId)).toBe(true);

    const [batchState] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, batchId))
      .limit(1);

    expect(batchState?.ingestedCount).toBe(2);
    expect(batchState?.updatedCount).toBe(0);
    expect(batchState?.skippedCount).toBe(0);
    expect(batchState?.maintenanceRequestedAt).not.toBeNull();
    expect(batchState?.maintenanceCompletedAt).not.toBeNull();
    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(false);
  });

  it('does not schedule a fully observed batch solely because skipped accounting is stale or only URL identity exists', async () => {
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
      sourceListingId: null,
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

    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(false);

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
          eq(listingObservations.sourceUrlCanonical, sourceUrl),
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
    expect(batchState?.skippedCount).toBe(1);
    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(false);
  });

  it('does not duplicate same-batch observations when a recovered listing rematches to a different property', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const street = `Recoverylaan-${stamp}`;
    const priorStreet = `Recoverydreef-${stamp}`;
    const mirrorListingId = `fotocasa-recovery-drift-${stamp}`;
    const sourceUrl = `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/recovery-drift-${stamp}`;
    const { batchId } = await createSkippedCompletedBatch({
      sourceName,
      stamp,
      street,
      houseNumber: 73,
      mirrorListingId,
      sourceUrl,
    });

    const priorPropertyId = await seedProperty({ street: priorStreet, houseNumber: 73 });
    const currentPropertyId = await seedProperty({ street, houseNumber: 73 });

    await db.insert(listingObservations).values({
      sourceName,
      sourceListingId: mirrorListingId,
      sourceListingIdKind: 'unknown',
      sourceUrlRaw: sourceUrl,
      sourceUrlCanonical: sourceUrl,
      origin: 'mirror',
      propertyId: priorPropertyId,
      propertyMatchKind: 'source_exact',
      sourceStatus: 'available',
      askingPrice: 515000,
      priceCurrency: 'EUR',
      ingestBatchId: batchId,
      observedAt: new Date('2026-04-06T14:10:00.000Z'),
    });

    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(false);

    let refreshCalls = 0;
    const refreshedCount = await refreshLatestListingsMaintenance(async () => {
      refreshCalls += 1;
    });

    expect(refreshedCount).toBe(0);
    expect(refreshCalls).toBe(0);

    const observations = await db
      .select({
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

    expect(observations).toHaveLength(1);
    expect(observations[0]?.propertyId).toBe(priorPropertyId);
    expect(observations[0]?.propertyId).not.toBe(currentPropertyId);
    expect(observations[0]?.ingestBatchId).toBe(batchId);
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
    await db
      .update(ingestBatches)
      .set({ skippedCount: 0 })
      .where(eq(ingestBatches.id, batchId));

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

  it('does not select a fully accounted unmatched skipped batch initially or after cooldown', async () => {
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

    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(false);

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
    expect(batchState?.maintenanceRequestedAt).toBeNull();
    expect(batchState?.maintenanceCompletedAt).toBeNull();
    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(false);

    const cooldownElapsedAt = new Date(Date.now() - SKIPPED_BATCH_RECOVERY_COOLDOWN_MS - 1_000);
    await db
      .update(ingestBatches)
      .set({ maintenanceCompletedAt: cooldownElapsedAt })
      .where(eq(ingestBatches.id, batchId));

    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(false);

    const refreshedCountAfterCooldown = await refreshLatestListingsMaintenance(async () => {
      refreshCalls += 1;
    });

    expect(refreshedCountAfterCooldown).toBe(0);
    expect(refreshCalls).toBe(0);
    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(false);
  });

  it('force-recovers a completed batch with missing observations even when skipped accounting is fully counted', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const street = `Forceherstel-${stamp}`;
    const mirrorListingId = `fotocasa-force-recovery-${stamp}`;
    const sourceUrl = `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/force-recovery-${stamp}`;
    const { batchId } = await createSkippedCompletedBatch({
      sourceName,
      stamp,
      street,
      houseNumber: 74,
      mirrorListingId,
      sourceUrl,
    });

    const propertyId = await seedProperty({ street, houseNumber: 74 });
    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(false);

    const result = await forceRecoverSkippedCompletedIngestBatches(sourceName, 10);

    expect(result.sourceName).toBe(sourceName);
    expect(result.candidateCount).toBeGreaterThanOrEqual(1);
    expect(result.recoveredObservationCount).toBe(1);
    expect(result.recoveredBatchIds).toContain(batchId);
    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(true);

    const observations = await db
      .select({
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

    expect(observations).toHaveLength(1);
    expect(observations[0]?.propertyId).toBe(propertyId);
    expect(observations[0]?.ingestBatchId).toBe(batchId);

    const [batchState] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, batchId))
      .limit(1);

    expect(batchState?.ingestedCount).toBe(1);
    expect(batchState?.updatedCount).toBe(0);
    expect(batchState?.skippedCount).toBe(0);
    expect(batchState?.maintenanceRequestedAt).not.toBeNull();
    expect(batchState?.maintenanceCompletedAt).toBeNull();
  });

  it('marks an under-accounted unmatched skipped batch and stops recurring', async () => {
    const sourceName = 'idealista';
    const stamp = Date.now();
    const street = `Recoverylaan-under-accounted-${stamp}`;
    const mirrorListingId = `idealista-recovery-under-accounted-${stamp}`;
    const sourceUrl = `https://www.idealista.com/inmueble/recovery-under-accounted-${stamp}/`;
    const { batchId } = await createSkippedCompletedBatch({
      sourceName,
      stamp,
      street,
      houseNumber: 65,
      mirrorListingId,
      sourceUrl,
    });

    const cooldownElapsedAt = new Date(Date.now() - SKIPPED_BATCH_RECOVERY_COOLDOWN_MS - 1_000);
    await db
      .update(ingestBatches)
      .set({
        ingestedCount: 0,
        updatedCount: 4,
        skippedCount: 0,
        maintenanceCompletedAt: cooldownElapsedAt,
      })
      .where(eq(ingestBatches.id, batchId));

    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(true);

    let refreshCalls = 0;
    const recoveredCount = await refreshLatestListingsMaintenance(async () => {
      refreshCalls += 1;
    });

    expect(recoveredCount).toBe(0);
    expect(refreshCalls).toBe(0);

    const observations = await db
      .select()
      .from(listingObservations)
      .where(
        and(
          eq(listingObservations.sourceName, sourceName),
          eq(listingObservations.sourceListingId, mirrorListingId),
          eq(listingObservations.origin, 'mirror'),
        ),
      );

    expect(observations).toHaveLength(0);

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

    await db
      .update(ingestBatches)
      .set({ maintenanceCompletedAt: cooldownElapsedAt })
      .where(eq(ingestBatches.id, batchId));

    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(false);

    const recoveredCountAfterCooldown = await refreshLatestListingsMaintenance(async () => {
      refreshCalls += 1;
    });

    expect(recoveredCountAfterCooldown).toBe(0);
    expect(refreshCalls).toBe(0);
    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(false);
  });

  it('recovers only the matchable missing observation from a mixed skipped batch and stops recurring', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const matchedStreet = `Recoverylaan-mixed-match-${stamp}`;
    const unmatchedStreet = `Recoverylaan-mixed-skip-${stamp}`;
    const matchedMirrorListingId = `fotocasa-recovery-mixed-match-${stamp}`;
    const unmatchedMirrorListingId = `fotocasa-recovery-mixed-skip-${stamp}`;
    const matchedSourceUrl = `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/recovery-mixed-match-${stamp}`;
    const unmatchedSourceUrl = `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/recovery-mixed-skip-${stamp}`;
    const cursorEnd = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T16:00:00.000Z',
      listingKey: `fotocasa-recovery-mixed-${stamp}`,
    });

    const accepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-recovery-mixed-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd,
      upstreamRunKey: `fotocasa-recovery-mixed-run-${stamp}`,
      listings: [
        {
          sourceUrl: matchedSourceUrl,
          mirrorListingId: matchedMirrorListingId,
          askingPrice: 515000,
          priceType: 'sale',
          status: 'active',
          mirrorFirstSeenAt: '2026-04-05T16:00:00.000Z',
          mirrorLastChangedAt: '2026-04-06T16:00:00.000Z',
          mirrorLastSeenAt: '2026-04-06T16:10:00.000Z',
          address: {
            countryCode: 'NL',
            street: matchedStreet,
            postalCode: '1234 AB',
            houseNumber: 66,
            city: 'Eindhoven',
          },
        },
        {
          sourceUrl: unmatchedSourceUrl,
          mirrorListingId: unmatchedMirrorListingId,
          askingPrice: 525000,
          priceType: 'sale',
          status: 'active',
          mirrorFirstSeenAt: '2026-04-05T16:00:00.000Z',
          mirrorLastChangedAt: '2026-04-06T16:00:00.000Z',
          mirrorLastSeenAt: '2026-04-06T16:10:00.000Z',
          address: {
            countryCode: 'NL',
            street: unmatchedStreet,
            postalCode: '1234 AB',
            houseNumber: 67,
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
      skipped: 2,
    });

    const matchedPropertyId = await seedProperty({ street: matchedStreet, houseNumber: 66 });
    const cooldownElapsedAt = new Date(Date.now() - SKIPPED_BATCH_RECOVERY_COOLDOWN_MS - 1_000);
    await db
      .update(ingestBatches)
      .set({
        skippedCount: 1,
        maintenanceCompletedAt: cooldownElapsedAt,
      })
      .where(eq(ingestBatches.id, accepted.batchId));

    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(true);

    let refreshCalls = 0;
    const refreshedCount = await refreshLatestListingsMaintenance(async () => {
      refreshCalls += 1;
    });

    expect(refreshedCount).toBe(1);
    expect(refreshCalls).toBe(1);

    const observations = await db
      .select({
        sourceListingId: listingObservations.sourceListingId,
        propertyId: listingObservations.propertyId,
        ingestBatchId: listingObservations.ingestBatchId,
      })
      .from(listingObservations)
      .where(
        and(
          eq(listingObservations.sourceName, sourceName),
          inArray(listingObservations.sourceListingId, [matchedMirrorListingId, unmatchedMirrorListingId]),
          eq(listingObservations.origin, 'mirror'),
        ),
      );

    expect(observations).toHaveLength(1);
    expect(observations[0]?.sourceListingId).toBe(matchedMirrorListingId);
    expect(observations[0]?.propertyId).toBe(matchedPropertyId);
    expect(observations[0]?.ingestBatchId).toBe(accepted.batchId);

    const [batchState] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, accepted.batchId))
      .limit(1);

    expect(batchState?.ingestedCount).toBe(1);
    expect(batchState?.updatedCount).toBe(0);
    expect(batchState?.skippedCount).toBe(1);
    expect(batchState?.maintenanceRequestedAt).not.toBeNull();
    expect(batchState?.maintenanceCompletedAt).not.toBeNull();
    expect((await collectRecoveryDispatchWork(new Date())).maintenancePending).toBe(false);
  });

  it('withdraws an existing canonical listing when a later mirror ingest reports withdrawn or not_found', async () => {
    const sourceName = 'fotocasa';

    for (const terminalSourceStatus of ['withdrawn', 'not_found'] as const) {
      await resetIngestSourceState(sourceName);

      const stamp = `${Date.now()}-${terminalSourceStatus}`;
      const street = `Withdrawnlaan-${stamp}`;
      const mirrorListingId = `fotocasa-withdrawn-${stamp}`;
      const sourceUrl = `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/withdrawn-${stamp}`;
      const runKey = `fotocasa-withdrawn-run-${stamp}`;
      const propertyId = await seedProperty({ street, houseNumber: 70 });

      const firstCursor = encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T17:00:00.000Z',
        listingKey: `${mirrorListingId}-active`,
      });

      const firstAccepted = await acceptIngestBatch({
        sourceName,
        idempotencyKey: `fotocasa-withdrawn-active-${stamp}`,
        batchSequence: 0,
        cursorStart: null,
        cursorEnd: firstCursor,
        upstreamRunKey: runKey,
        listings: [
          {
            sourceUrl,
            mirrorListingId,
            askingPrice: 410000,
            priceType: 'sale',
            status: 'active',
            sourceStatus: 'available',
            mirrorFirstSeenAt: '2026-04-05T17:00:00.000Z',
            mirrorLastChangedAt: '2026-04-06T17:00:00.000Z',
            mirrorLastSeenAt: '2026-04-06T17:10:00.000Z',
            address: {
              countryCode: 'NL',
              street,
              postalCode: '1234 AB',
              houseNumber: 70,
              city: 'Eindhoven',
            },
          },
        ],
      });

      await expect(
        processIngestBatch({
          batchId: firstAccepted.batchId,
          enqueueMaintenanceRefresh: async () => {},
        }),
      ).resolves.toEqual({
        status: 'completed',
        ingested: 1,
        updated: 0,
        skipped: 0,
      });

      const [activeCanonical] = await db
        .select()
        .from(canonicalListings)
        .where(
          and(
            eq(canonicalListings.sourceName, sourceName),
            eq(canonicalListings.primarySourceListingId, mirrorListingId),
          ),
        )
        .limit(1);

      expect(activeCanonical).toBeDefined();
      expect(activeCanonical?.propertyId).toBe(propertyId);
      expect(activeCanonical?.status).toBe('active');

      const secondAccepted = await acceptIngestBatch({
        sourceName,
        idempotencyKey: `fotocasa-withdrawn-later-${stamp}`,
        batchSequence: 1,
        cursorStart: firstCursor,
        cursorEnd: encodeOpaqueIngestCursor({
          changedAt: '2026-04-06T18:00:00.000Z',
          listingKey: `${mirrorListingId}-${terminalSourceStatus}`,
        }),
        upstreamRunKey: runKey,
        listings: [
          {
            sourceUrl,
            mirrorListingId,
            askingPrice: 410000,
            priceType: 'sale',
            status: 'withdrawn',
            sourceStatus: terminalSourceStatus,
            mirrorFirstSeenAt: '2026-04-05T17:00:00.000Z',
            mirrorLastChangedAt: '2026-04-06T18:00:00.000Z',
            mirrorLastSeenAt: '2026-04-06T17:10:00.000Z',
            address: {
              countryCode: 'NL',
              street,
              postalCode: '1234 AB',
              houseNumber: 70,
              city: 'Eindhoven',
            },
          },
        ],
      });

      await expect(
        processIngestBatch({
          batchId: secondAccepted.batchId,
          enqueueMaintenanceRefresh: async () => {},
        }),
      ).resolves.toEqual({
        status: 'completed',
        ingested: 1,
        updated: 0,
        skipped: 0,
      });

      const canonicals = await db
        .select()
        .from(canonicalListings)
        .where(
          and(
            eq(canonicalListings.sourceName, sourceName),
            eq(canonicalListings.primarySourceListingId, mirrorListingId),
          ),
        );

      expect(canonicals).toHaveLength(1);
      expect(canonicals[0]?.id).toBe(activeCanonical?.id);
      expect(canonicals[0]?.status).toBe('withdrawn');
      expect(canonicals[0]?.statusSource).toBe('mirror');

      const observations = await db
        .select({
          sourceStatus: listingObservations.sourceStatus,
          observedAt: listingObservations.observedAt,
          ingestBatchId: listingObservations.ingestBatchId,
        })
        .from(listingObservations)
        .where(
          and(
            eq(listingObservations.sourceName, sourceName),
            eq(listingObservations.sourceListingId, mirrorListingId),
          ),
        );

      expect(observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceStatus: 'available',
            observedAt: new Date('2026-04-06T17:00:00.000Z'),
            ingestBatchId: firstAccepted.batchId,
          }),
          expect.objectContaining({
            sourceStatus: terminalSourceStatus,
            observedAt: new Date('2026-04-06T18:00:00.000Z'),
            ingestBatchId: secondAccepted.batchId,
          }),
        ]),
      );
    }
  });

  it('does not let older source facts overwrite a newer canonical projection', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const street = `Ordering Source Time Street ${stamp}`;
    const mirrorListingId = `fotocasa-source-time-${stamp}`;
    const sourceUrl = `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/source-time-${stamp}`;
    const propertyId = await seedProperty({ street, houseNumber: 72 });
    const firstCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T18:00:00.000Z',
      listingKey: `${mirrorListingId}-fresh`,
    });
    const secondCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T19:00:00.000Z',
      listingKey: `${mirrorListingId}-older-facts`,
    });

    const fresh = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-source-time-fresh-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: firstCursor,
      upstreamRunKey: `fotocasa-source-time-run-${stamp}`,
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          askingPrice: 520000,
          priceType: 'sale',
          status: 'active',
          sourceStatus: 'available',
          ogTitle: 'Fresh mirror title',
          mirrorLastChangedAt: '2026-04-06T18:00:00.000Z',
          mirrorLastSeenAt: '2026-04-06T18:05:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 72,
            city: 'Eindhoven',
          },
        },
      ],
    });
    await processIngestBatch({
      batchId: fresh.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    const older = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-source-time-older-${stamp}`,
      batchSequence: 1,
      cursorStart: firstCursor,
      cursorEnd: secondCursor,
      upstreamRunKey: `fotocasa-source-time-run-${stamp}`,
      listings: [
        {
          sourceUrl,
          mirrorListingId,
          askingPrice: 480000,
          priceType: 'sale',
          status: 'sold',
          sourceStatus: 'sold',
          ogTitle: 'Older stale title',
          mirrorLastChangedAt: '2026-04-06T17:00:00.000Z',
          mirrorLastSeenAt: '2026-04-06T17:05:00.000Z',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 72,
            city: 'Eindhoven',
          },
        },
      ],
    });
    await processIngestBatch({
      batchId: older.batchId,
      enqueueMaintenanceRefresh: async () => {},
    });

    const [canonical] = await db
      .select()
      .from(canonicalListings)
      .where(
        and(
          eq(canonicalListings.sourceName, sourceName),
          eq(canonicalListings.primarySourceListingId, mirrorListingId),
        ),
      )
      .limit(1);

    expect(canonical).toMatchObject({
      propertyId,
      status: 'active',
      askingPrice: 520000,
      title: 'Fresh mirror title',
      lastMirrorSeenAt: new Date('2026-04-06T18:05:00.000Z'),
    });

    const observations = await db
      .select({
        sourceStatus: listingObservations.sourceStatus,
        observedAt: listingObservations.observedAt,
        staleForProjection: listingObservations.staleForProjection,
        ingestBatchId: listingObservations.ingestBatchId,
      })
      .from(listingObservations)
      .where(
        and(
          eq(listingObservations.sourceName, sourceName),
          eq(listingObservations.sourceListingId, mirrorListingId),
        ),
      );
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceStatus: 'available',
          observedAt: new Date('2026-04-06T18:00:00.000Z'),
          staleForProjection: false,
          ingestBatchId: fresh.batchId,
        }),
        expect.objectContaining({
          sourceStatus: 'sold',
          observedAt: new Date('2026-04-06T17:00:00.000Z'),
          staleForProjection: true,
          ingestBatchId: older.batchId,
        }),
      ]),
    );

    const [olderBatch] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, older.batchId))
      .limit(1);
    expect(olderBatch?.maintenanceRequestedAt).toBeNull();
  });

  it('tracks run lifecycle completion across multiple batches and links price history to listings', async () => {
    const stamp = Date.now();
    const runKey = `fotocasa-run-${stamp}`;
    const alphaStreet = `Alphaweg ${stamp}`;
    const betaStreet = `Betaweg ${stamp}`;
    const alphaUrl = `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/alpha-${stamp}`;
    const betaUrl = `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/beta-${stamp}`;
    const firstMirrorListingId = `fotocasa-listing-a-${stamp}`;
    const secondMirrorListingId = `fotocasa-listing-b-${stamp}`;
    const propertySeed = await db
      .insert(properties)
      .values([
        {
          countryCode: 'NL',
          street: alphaStreet,
          houseNumber: 10,
          houseNumberAddition: null,
          city: 'Eindhoven',
          postalCode: '1234AB',
          status: 'active',
        },
        {
          countryCode: 'NL',
          street: betaStreet,
          houseNumber: 12,
          houseNumberAddition: null,
          city: 'Eindhoven',
          postalCode: '1234AB',
          status: 'active',
        },
      ])
      .returning({ id: properties.id, street: properties.street });

    cleanupPropertyIds.push(...propertySeed.map((row) => row.id));

    const alphaProperty = propertySeed.find((row) => row.street === alphaStreet);
    const betaProperty = propertySeed.find((row) => row.street === betaStreet);
    expect(alphaProperty).toBeDefined();
    expect(betaProperty).toBeDefined();

    const firstAccepted = await acceptIngestBatch({
      sourceName: 'fotocasa',
      idempotencyKey: `fotocasa-first-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T15:00:00.000Z',
        listingKey: `fotocasa-1-${stamp}`,
      }),
      upstreamRunKey: runKey,
      listings: [
        {
          sourceUrl: alphaUrl,
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
            street: alphaStreet,
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
      idempotencyKey: `fotocasa-second-${stamp}`,
      batchSequence: 1,
      cursorStart: encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T15:00:00.000Z',
        listingKey: `fotocasa-1-${stamp}`,
      }),
      cursorEnd: encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T15:30:00.000Z',
        listingKey: `fotocasa-2-${stamp}`,
      }),
      upstreamRunKey: runKey,
      listings: [
        {
          sourceUrl: betaUrl,
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
            street: betaStreet,
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
    expect(matchedListing?.canonicalUrl).toBe(alphaUrl);

    const [legacyListing] = await db
      .select()
      .from(listings)
      .where(eq(listings.sourceName, 'fotocasa'))
      .limit(1);
    expect(legacyListing).toBeUndefined();

    const [historyRow] = await db
      .select()
      .from(priceHistory)
      .where(and(
        eq(priceHistory.source, 'fotocasa'),
        eq(priceHistory.propertyId, alphaProperty?.id ?? ''),
      ))
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
    expect(midSourceState?.lastCommittedListingKey).toBe(`fotocasa-1-${stamp}`);
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
    expect(sourceState?.lastCommittedListingKey).toBe(`fotocasa-2-${stamp}`);
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
    const stamp = Date.now();
    const street = `Deltaweg-${stamp}`;
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
        idempotencyKey: `listing-submit-${stamp}`,
        payload: {
          propertyId,
        },
      });
    });

    const cursorEnd = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T18:00:00.000Z',
      listingKey: `fotocasa-real-1-${stamp}`,
    });

    const accepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-real-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd,
      upstreamRunKey: `fotocasa-real-run-${stamp}`,
      listings: [
        {
          sourceUrl: `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/delta-${stamp}`,
          mirrorListingId: `fotocasa-real-listing-${stamp}`,
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
    expect(sourceState?.lastCommittedListingKey).toBe(`fotocasa-real-1-${stamp}`);
    expect(sourceState?.lastBatchId).toBe(accepted.batchId);
  });

  it('skips listings with invalid source house numbers while completing the batch', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const street = `Invalid House Numberweg ${stamp}`;
    const debugLogs: Array<{ payload: Record<string, unknown>; message: string }> = [];
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
        logger: {
          info: () => {},
          debug: (payload, message) => debugLogs.push({ payload, message }),
          warn: () => {},
          error: () => {},
        },
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
    expect(debugLogs).toContainEqual({
      message: 'Ingest batch skipped listing diagnostics',
      payload: expect.objectContaining({
        batchId: accepted.batchId,
        sourceName,
        skippedCount: 2,
        skipReasons: {
          invalid_house_number_without_spatial_candidate: 2,
        },
        skippedListings: expect.arrayContaining([
          expect.objectContaining({
            reason: 'invalid_house_number_without_spatial_candidate',
            mirrorListingId: `fotocasa-invalid-house-number-none-${stamp}`,
          }),
          expect.objectContaining({
            reason: 'invalid_house_number_without_spatial_candidate',
            mirrorListingId: `fotocasa-invalid-house-number-empty-${stamp}`,
          }),
        ]),
      }),
    });

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

  it('spatially matches listings with an empty source house number when coordinates are present', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const street = `Pararius Coordinateweg ${stamp}`;
    const longitude = 5.223456;
    const latitude = 51.223456;
    const cursorEnd = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T18:45:00.000Z',
      listingKey: `fotocasa-empty-house-number-spatial-${stamp}`,
    });
    const propertySeed = await db
      .insert(properties)
      .values({
        countryCode: 'NL',
        street,
        houseNumber: 88,
        houseNumberAddition: null,
        city: 'Eindhoven',
        postalCode: '1234AB',
        geometry: { type: 'Point', coordinates: [longitude, latitude] },
        status: 'active',
      })
      .returning({ id: properties.id });

    const propertyId = propertySeed[0]?.id;
    expect(propertyId).toBeTruthy();
    cleanupPropertyIds.push(propertyId as string);

    const accepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-empty-house-number-spatial-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd,
      upstreamRunKey: `fotocasa-empty-house-number-spatial-run-${stamp}`,
      listings: [
        {
          sourceUrl: `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/empty-spatial-${stamp}`,
          mirrorListingId: `fotocasa-empty-house-number-spatial-${stamp}`,
          askingPrice: 480000,
          priceType: 'sale' as const,
          status: 'active' as const,
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: '',
            city: 'Eindhoven',
            latitude,
            longitude,
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
      ingested: 1,
      updated: 0,
      skipped: 0,
    });

    const canonicalRows = await db
      .select()
      .from(canonicalListings)
      .where(eq(canonicalListings.sourceName, sourceName));

    expect(canonicalRows).toHaveLength(1);
    expect(canonicalRows[0]?.propertyId).toBe(propertyId);
    expect(canonicalRows[0]?.primarySourceListingId).toBe(`fotocasa-empty-house-number-spatial-${stamp}`);
  });

  it('keeps malformed unit-shaped source house numbers skipped until the source sends corrected fields', async () => {
    const sourceName = 'idealista';
    const stamp = Date.now();
    const street = `Funda Unitvormweg ${stamp}`;
    const longitude = 5.323456;
    const latitude = 51.323456;
    const firstCursorEnd = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T19:00:00.000Z',
      listingKey: `idealista-malformed-unit-${stamp}-1`,
    });
    const secondCursorEnd = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T19:05:00.000Z',
      listingKey: `idealista-malformed-unit-${stamp}-2`,
    });
    const propertySeed = await db
      .insert(properties)
      .values({
        countryCode: 'NL',
        street,
        houseNumber: 32,
        houseNumberAddition: '327',
        city: 'Eindhoven',
        postalCode: '1234AB',
        geometry: { type: 'Point', coordinates: [longitude, latitude] },
        status: 'active',
      })
      .returning({ id: properties.id });

    const propertyId = propertySeed[0]?.id;
    expect(propertyId).toBeTruthy();
    cleanupPropertyIds.push(propertyId as string);

    const malformed = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-malformed-unit-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: firstCursorEnd,
      upstreamRunKey: `idealista-malformed-unit-run-${stamp}`,
      listings: [
        {
          sourceUrl: `https://www.idealista.com/inmueble/malformed-unit-${stamp}/`,
          mirrorListingId: `idealista-malformed-unit-${stamp}`,
          askingPrice: 1500,
          priceType: 'rent' as const,
          status: 'active' as const,
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 'Appartement 32-327',
            city: 'Eindhoven',
            latitude,
            longitude,
          },
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: malformed.batchId,
        maxAttempts: 1,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 0,
      updated: 0,
      skipped: 1,
    });

    const corrected = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `idealista-corrected-unit-${stamp}`,
      batchSequence: 1,
      cursorStart: firstCursorEnd,
      cursorEnd: secondCursorEnd,
      upstreamRunKey: `idealista-malformed-unit-run-${stamp}`,
      listings: [
        {
          sourceUrl: `https://www.idealista.com/inmueble/corrected-unit-${stamp}/`,
          mirrorListingId: `idealista-corrected-unit-${stamp}`,
          askingPrice: 1500,
          priceType: 'rent' as const,
          status: 'active' as const,
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 32,
            houseNumberAddition: '327',
            city: 'Eindhoven',
          },
        },
      ],
    });

    await expect(
      processIngestBatch({
        batchId: corrected.batchId,
        maxAttempts: 1,
        enqueueMaintenanceRefresh: async () => {},
      }),
    ).resolves.toEqual({
      status: 'completed',
      ingested: 1,
      updated: 0,
      skipped: 0,
    });

    const canonicalRows = await db
      .select()
      .from(canonicalListings)
      .where(eq(canonicalListings.sourceName, sourceName));

    expect(canonicalRows).toHaveLength(1);
    expect(canonicalRows[0]?.propertyId).toBe(propertyId);
    expect(canonicalRows[0]?.primarySourceListingId).toBe(`idealista-corrected-unit-${stamp}`);
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

  it('does not process future full-mirror replay batches as stale evidence at the same changedAt watermark', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const committedCursor = fullMirrorReplayCursor('funda', 2, 3000);
    const futureStartCursor = fullMirrorReplayCursor('funda', 9, 10000);
    const batchTenCursor = fullMirrorReplayCursor('funda', 10, 11000);
    const coveredEndCursor = fullMirrorReplayCursor('funda', 1, 1000);

    const batchTenAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-full-mirror-batch-ten-${stamp}`,
      batchSequence: 10,
      cursorStart: futureStartCursor,
      cursorEnd: batchTenCursor,
      upstreamRunKey: `fotocasa-full-mirror-batch-ten-run-${stamp}`,
      batchKind: 'observations_and_completion',
      sourceHighWatermark: '2026-04-09T08:00:00.000Z',
      listings: [
        {
          sourceUrl: `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/full-mirror-ten-${stamp}`,
          mirrorListingId: `fotocasa-full-mirror-ten-${stamp}`,
          scopeKey: 'full-mirror',
          askingPrice: 510000,
          priceType: 'sale',
          status: 'active' as const,
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-09T08:00:00.000Z',
          sourceHighWatermark: '2026-04-09T08:00:00.000Z',
          address: {
            countryCode: 'NL',
            street: `Full Mirror Ten Street ${stamp}`,
            postalCode: '1234 AB',
            houseNumber: 10,
            city: 'Eindhoven',
          },
        },
      ],
    });

    const futureStartCoveredEndAccepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-full-mirror-future-start-covered-end-${stamp}`,
      batchSequence: 11,
      cursorStart: batchTenCursor,
      cursorEnd: coveredEndCursor,
      upstreamRunKey: `fotocasa-full-mirror-future-start-covered-end-run-${stamp}`,
      batchKind: 'observations_and_completion',
      sourceHighWatermark: '2026-04-09T08:00:00.000Z',
      listings: [
        {
          sourceUrl: `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/full-mirror-covered-${stamp}`,
          mirrorListingId: `fotocasa-full-mirror-covered-${stamp}`,
          scopeKey: 'full-mirror',
          askingPrice: 515000,
          priceType: 'sale',
          status: 'active' as const,
          sourceStatus: 'available',
          mirrorLastChangedAt: '2026-04-09T08:00:00.000Z',
          sourceHighWatermark: '2026-04-09T08:00:00.000Z',
          address: {
            countryCode: 'NL',
            street: `Full Mirror Covered Street ${stamp}`,
            postalCode: '1234 AB',
            houseNumber: 11,
            city: 'Eindhoven',
          },
        },
      ],
    });

    await db
      .update(ingestSources)
      .set({
        lastCommittedCursor: committedCursor,
        lastCommittedChangedAt: new Date('2026-04-09T08:00:00.000Z'),
        lastCommittedListingKey: 'funda:full-mirror:2:3000',
      })
      .where(eq(ingestSources.sourceName, sourceName));

    await expect(processIngestBatch({
      batchId: batchTenAccepted.batchId,
      enqueueMaintenanceRefresh: async () => {},
    })).resolves.toEqual({
      status: 'noop',
      ingested: 0,
      updated: 0,
      skipped: 0,
    });

    await expect(processIngestBatch({
      batchId: futureStartCoveredEndAccepted.batchId,
      enqueueMaintenanceRefresh: async () => {},
    })).resolves.toEqual({
      status: 'noop',
      ingested: 0,
      updated: 0,
      skipped: 0,
    });

    const deferredRows = await db
      .select({
        id: ingestBatches.id,
        status: ingestBatches.status,
        attemptCount: ingestBatches.attemptCount,
      })
      .from(ingestBatches)
      .where(inArray(ingestBatches.id, [
        batchTenAccepted.batchId,
        futureStartCoveredEndAccepted.batchId,
      ]));

    expect(deferredRows).toHaveLength(2);
    for (const row of deferredRows) {
      expect(row.status).toBe('accepted');
      expect(row.attemptCount).toBe(0);
    }
  });

  it('advances a raw exact cursor match beyond the old global page', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const street = `CursorExactPageweg-${stamp}`;
    await seedProperty({
      street,
      houseNumber: 26,
    });
    const currentCursor = encodeRawCursor({
      changedAt: '2026-04-06T21:00:00.000000Z',
      listingKey: `fotocasa-exact-page-current-${stamp}`,
    });
    const nextCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T21:30:00.000Z',
      listingKey: `fotocasa-exact-page-next-${stamp}`,
    });

    await db.insert(ingestSources).values({
      sourceName,
      lastCommittedCursor: currentCursor,
      lastCommittedChangedAt: new Date('2026-04-06T21:00:00.000Z'),
      lastCommittedListingKey: `fotocasa-exact-page-current-${stamp}`,
    });

    const oldReceivedAt = new Date('2026-04-06T08:00:00.000Z').getTime();
    const staleRows = Array.from({ length: 1005 }, (_, index) => {
      const staleCursorEnd = encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T20:00:00.000Z',
        listingKey: `fotocasa-exact-page-stale-${stamp}-${index}`,
      });
      const receivedAt = new Date(oldReceivedAt + index * 1000);

      return {
        sourceName,
        batchSequence: index,
        idempotencyKey: `fotocasa-exact-page-stale-${stamp}-${index}`,
        cursorStart: currentCursor,
        cursorEnd: staleCursorEnd,
        payloadJson: {
          sourceName,
          idempotencyKey: `fotocasa-exact-page-stale-${stamp}-${index}`,
          batchSequence: index,
          cursorStart: currentCursor,
          cursorEnd: staleCursorEnd,
          upstreamRunKey: `fotocasa-exact-page-stale-run-${stamp}`,
          listings: [],
        },
        status: 'completed' as const,
        attemptCount: 1,
        receivedAt,
        startedAt: receivedAt,
        completedAt: receivedAt,
        ingestedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
      };
    });

    for (let offset = 0; offset < staleRows.length; offset += 250) {
      await db.insert(ingestBatches).values(staleRows.slice(offset, offset + 250));
    }

    const accepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-exact-page-next-${stamp}`,
      batchSequence: staleRows.length,
      cursorStart: currentCursor,
      cursorEnd: nextCursor,
      upstreamRunKey: `fotocasa-exact-page-run-${stamp}`,
      listings: [
        {
          sourceUrl: `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/cursor-exact-page-${stamp}`,
          mirrorListingId: `fotocasa-exact-page-listing-${stamp}`,
          askingPrice: 475000,
          priceType: 'sale',
          status: 'active' as const,
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 26,
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
      ingested: 1,
      updated: 0,
      skipped: 0,
    });

    const [sourceState] = await db
      .select()
      .from(ingestSources)
      .where(eq(ingestSources.sourceName, sourceName))
      .limit(1);

    expect(sourceState?.lastCommittedCursor).toBe(nextCursor);
    expect(sourceState?.lastCommittedListingKey).toBe(`fotocasa-exact-page-next-${stamp}`);
    expect(sourceState?.lastBatchId).toBe(accepted.batchId);
  });

  it('prefers an earlier semantic cursor match over a later exact match', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const street = `CursorSemanticPageweg-${stamp}`;
    await seedProperty({
      street,
      houseNumber: 28,
    });
    const currentCursorPayload = {
      changedAt: '2026-04-06T22:00:00.000Z',
      listingKey: `fotocasa-semantic-page-current-${stamp}`,
    };
    const currentCursor = encodeOpaqueIngestCursor(currentCursorPayload);
    const equivalentCurrentCursor = encodeRawCursor({
      changedAt: '2026-04-06T22:00:00.000000Z',
      listingKey: currentCursorPayload.listingKey,
    });
    const semanticNextCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T22:20:00.000Z',
      listingKey: `fotocasa-semantic-page-next-${stamp}`,
    });
    const exactNextCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T22:30:00.000Z',
      listingKey: `fotocasa-exact-page-next-${stamp}`,
    });

    await db.insert(ingestSources).values({
      sourceName,
      lastCommittedCursor: currentCursor,
      lastCommittedChangedAt: new Date(currentCursorPayload.changedAt),
      lastCommittedListingKey: currentCursorPayload.listingKey,
    });

    const receivedAt = new Date('2026-04-06T09:00:00.000Z');
    const [semanticBatch] = await db
      .insert(ingestBatches)
      .values({
        sourceName,
        batchSequence: 0,
        idempotencyKey: `fotocasa-semantic-page-next-${stamp}`,
        cursorStart: equivalentCurrentCursor,
        cursorEnd: semanticNextCursor,
        payloadJson: {
          sourceName,
          idempotencyKey: `fotocasa-semantic-page-next-${stamp}`,
          batchSequence: 0,
          cursorStart: equivalentCurrentCursor,
          cursorEnd: semanticNextCursor,
          upstreamRunKey: `fotocasa-semantic-page-run-${stamp}`,
          listings: [],
        },
        status: 'completed' as const,
        attemptCount: 1,
        receivedAt,
        startedAt: receivedAt,
        completedAt: receivedAt,
        ingestedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
      })
      .returning({ id: ingestBatches.id });

    const accepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-exact-page-next-${stamp}`,
      batchSequence: 1,
      cursorStart: currentCursor,
      cursorEnd: exactNextCursor,
      upstreamRunKey: `fotocasa-semantic-page-run-${stamp}`,
      listings: [
        {
          sourceUrl: `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/cursor-semantic-page-${stamp}`,
          mirrorListingId: `fotocasa-semantic-page-listing-${stamp}`,
          askingPrice: 485000,
          priceType: 'sale',
          status: 'active' as const,
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 28,
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
      ingested: 1,
      updated: 0,
      skipped: 0,
    });

    const [sourceState] = await db
      .select()
      .from(ingestSources)
      .where(eq(ingestSources.sourceName, sourceName))
      .limit(1);

    expect(sourceState?.lastCommittedCursor).toBe(semanticNextCursor);
    expect(sourceState?.lastCommittedListingKey).toBe(`fotocasa-semantic-page-next-${stamp}`);
    expect(sourceState?.lastBatchId).toBe(semanticBatch?.id);
  });

  it('finds a semantic cursor match after the old bounded fallback scan limit', async () => {
    const sourceName = 'fotocasa';
    const stamp = Date.now();
    const street = `CursorSemanticDeepPageweg-${stamp}`;
    await seedProperty({
      street,
      houseNumber: 30,
    });
    const currentCursorPayload = {
      changedAt: '2026-04-06T23:00:00.000Z',
      listingKey: `fotocasa-semantic-deep-current-${stamp}`,
    };
    const currentCursor = encodeOpaqueIngestCursor(currentCursorPayload);
    const equivalentCurrentCursor = encodeRawCursor({
      changedAt: '2026-04-06T23:00:00.000000Z',
      listingKey: currentCursorPayload.listingKey,
    });
    const semanticNextCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T23:20:00.000Z',
      listingKey: `fotocasa-semantic-deep-next-${stamp}`,
    });
    const exactNextCursor = encodeOpaqueIngestCursor({
      changedAt: '2026-04-06T23:30:00.000Z',
      listingKey: `fotocasa-exact-deep-next-${stamp}`,
    });

    await db.insert(ingestSources).values({
      sourceName,
      lastCommittedCursor: currentCursor,
      lastCommittedChangedAt: new Date(currentCursorPayload.changedAt),
      lastCommittedListingKey: currentCursorPayload.listingKey,
    });

    const oldReceivedAt = new Date('2026-04-06T10:00:00.000Z').getTime();
    const nonMatchingRows = Array.from({ length: 2005 }, (_, index) => {
      const nonMatchingCursorStart = encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T22:30:00.000Z',
        listingKey: `fotocasa-semantic-deep-nonmatch-start-${stamp}-${index}`,
      });
      const nonMatchingCursorEnd = encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T22:45:00.000Z',
        listingKey: `fotocasa-semantic-deep-nonmatch-end-${stamp}-${index}`,
      });
      const receivedAt = new Date(oldReceivedAt + index * 1000);

      return {
        sourceName,
        batchSequence: index,
        idempotencyKey: `fotocasa-semantic-deep-nonmatch-${stamp}-${index}`,
        cursorStart: nonMatchingCursorStart,
        cursorEnd: nonMatchingCursorEnd,
        payloadJson: {
          sourceName,
          idempotencyKey: `fotocasa-semantic-deep-nonmatch-${stamp}-${index}`,
          batchSequence: index,
          cursorStart: nonMatchingCursorStart,
          cursorEnd: nonMatchingCursorEnd,
          upstreamRunKey: `fotocasa-semantic-deep-nonmatch-run-${stamp}`,
          listings: [],
        },
        status: 'completed' as const,
        attemptCount: 1,
        receivedAt,
        startedAt: receivedAt,
        completedAt: receivedAt,
        ingestedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
      };
    });

    for (let offset = 0; offset < nonMatchingRows.length; offset += 500) {
      await db.insert(ingestBatches).values(nonMatchingRows.slice(offset, offset + 500));
    }

    const semanticReceivedAt = new Date(oldReceivedAt + nonMatchingRows.length * 1000);
    const [semanticBatch] = await db
      .insert(ingestBatches)
      .values({
        sourceName,
        batchSequence: nonMatchingRows.length,
        idempotencyKey: `fotocasa-semantic-deep-next-${stamp}`,
        cursorStart: equivalentCurrentCursor,
        cursorEnd: semanticNextCursor,
        payloadJson: {
          sourceName,
          idempotencyKey: `fotocasa-semantic-deep-next-${stamp}`,
          batchSequence: nonMatchingRows.length,
          cursorStart: equivalentCurrentCursor,
          cursorEnd: semanticNextCursor,
          upstreamRunKey: `fotocasa-semantic-deep-run-${stamp}`,
          listings: [],
        },
        status: 'completed' as const,
        attemptCount: 1,
        receivedAt: semanticReceivedAt,
        startedAt: semanticReceivedAt,
        completedAt: semanticReceivedAt,
        ingestedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
      })
      .returning({ id: ingestBatches.id });

    const accepted = await acceptIngestBatch({
      sourceName,
      idempotencyKey: `fotocasa-exact-deep-next-${stamp}`,
      batchSequence: nonMatchingRows.length + 1,
      cursorStart: currentCursor,
      cursorEnd: exactNextCursor,
      upstreamRunKey: `fotocasa-semantic-deep-run-${stamp}`,
      listings: [
        {
          sourceUrl: `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/cursor-semantic-deep-${stamp}`,
          mirrorListingId: `fotocasa-semantic-deep-listing-${stamp}`,
          askingPrice: 495000,
          priceType: 'sale',
          status: 'active' as const,
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 30,
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
      ingested: 1,
      updated: 0,
      skipped: 0,
    });

    const [sourceState] = await db
      .select()
      .from(ingestSources)
      .where(eq(ingestSources.sourceName, sourceName))
      .limit(1);

    expect(sourceState?.lastCommittedCursor).toBe(semanticNextCursor);
    expect(sourceState?.lastCommittedListingKey).toBe(`fotocasa-semantic-deep-next-${stamp}`);
    expect(sourceState?.lastBatchId).toBe(semanticBatch?.id);
  });

  it('merges duplicate mirror URL observations without writing legacy listings', async () => {
    const stamp = Date.now();
    const runKey = `fotocasa-failure-run-${stamp}`;
    const street = `Gammaweg ${stamp}`;
    const sourceUrl = `https://www.fotocasa.es/es/comprar/vivienda/eindhoven/failure-${stamp}`;
    const failureProperty = await db
      .insert(properties)
      .values([
        {
          countryCode: 'NL',
          street,
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
      idempotencyKey: `fotocasa-failure-${stamp}`,
      batchSequence: 0,
      cursorStart: null,
      cursorEnd: encodeOpaqueIngestCursor({
        changedAt: '2026-04-06T17:00:00.000Z',
        listingKey: `fotocasa-failure-1-${stamp}`,
      }),
      upstreamRunKey: runKey,
      listings: [
        {
          sourceUrl,
          mirrorListingId: `fotocasa-failure-listing-${stamp}`,
          askingPrice: 510000,
          priceType: 'sale' as const,
          status: 'active' as const,
          ogTitle: 'Failure path listing',
          address: {
            countryCode: 'NL',
            street,
            postalCode: '1234 AB',
            houseNumber: 14,
            city: 'Eindhoven',
          },
        },
        {
          sourceUrl,
          mirrorListingId: `fotocasa-failure-listing-dup-${stamp}`,
          askingPrice: 515000,
          priceType: 'sale' as const,
          status: 'active' as const,
          ogTitle: 'Failure path duplicate listing',
          address: {
            countryCode: 'NL',
            street,
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
          eq(canonicalListings.canonicalUrl, sourceUrl),
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
