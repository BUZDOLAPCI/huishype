import { afterAll, describe, expect, it } from '@jest/globals';
import { eq, sql } from 'drizzle-orm';
import {
  db,
  ingestBatches,
  officialValuationSourceStates,
  properties,
  propertyOfficialValuationHydrationJobs,
  propertyOfficialValuations,
  propertyTilePyramidSourceWatermarks,
} from '../../db/index.js';
import {
  acceptOfficialValuationHydrationRequest,
  getCurrentOfficialValuationStatus,
  markOfficialValuationHydrationSucceeded,
  markOfficialValuationSourceFailure,
  releaseOfficialValuationSourceRequest,
  reserveOfficialValuationSourceRequest,
} from '../../services/official-valuations/store.js';
import { createIntegrationProperty } from './helpers/fixtures.js';

describe('official valuation hydration requests', () => {
  const propertyIds: string[] = [];
  const maintenanceBatchIds: string[] = [];

  async function readOfficialValuationPyramidWatermark(): Promise<bigint> {
    const [watermark] = await db
      .select({ watermarkValue: propertyTilePyramidSourceWatermarks.watermarkValue })
      .from(propertyTilePyramidSourceWatermarks)
      .where(eq(propertyTilePyramidSourceWatermarks.scope, 'official_valuations'))
      .limit(1);

    return watermark?.watermarkValue ?? 0n;
  }

  afterAll(async () => {
    if (maintenanceBatchIds.length > 0) {
      await db.execute(sql`
        DELETE FROM ingest_batches
        WHERE id IN (${sql.join(maintenanceBatchIds.map((id) => sql`${id}`), sql`, `)})
      `);
    }

    await db
      .delete(officialValuationSourceStates)
      .where(eq(officialValuationSourceStates.source, 'woz'));

    if (propertyIds.length === 0) {
      return;
    }

    await db.execute(sql`
      DELETE FROM properties
      WHERE id IN (${sql.join(propertyIds.map((id) => sql`${id}`), sql`, `)})
    `);
  });

  it('returns the verified cached DB row when client-observed upsert is blocked', async () => {
    const property = await createIntegrationProperty({
      street: 'Official Valuation Fixture',
      houseNumber: 41,
      postalCode: '1234AB',
      city: 'Eindhoven',
    });
    propertyIds.push(property.id);

    await db.insert(propertyOfficialValuations).values({
      propertyId: property.id,
      valuation: 475_000,
      valuationYear: 2025,
      source: 'woz',
      verified: true,
      verifiedAt: new Date(),
      origin: 'server_verified',
    });
    const pyramidWatermarkBefore = await readOfficialValuationPyramidWatermark();

    const result = await acceptOfficialValuationHydrationRequest({
      propertyId: property.id,
      source: 'woz',
      observed: {
        valuation: 300_000,
        valuationYear: 2025,
        referenceDate: '2025-01-01',
      },
      submittedByUserId: null,
    });

    expect(result).toMatchObject({
      status: 'already_cached',
      cachedValuation: 475_000,
      cachedValuationYear: 2025,
      cachedVerified: true,
    });

    const [valuationRow] = await db
      .select()
      .from(propertyOfficialValuations)
      .where(eq(propertyOfficialValuations.propertyId, property.id))
      .limit(1);
    expect(valuationRow).toMatchObject({
      valuation: 475_000,
      valuationYear: 2025,
      verified: true,
      origin: 'server_verified',
    });

    const [propertyRow] = await db
      .select({
        officialValuation: properties.officialValuation,
        officialValuationYear: properties.officialValuationYear,
        officialValuationVerified: properties.officialValuationVerified,
      })
      .from(properties)
      .where(eq(properties.id, property.id))
      .limit(1);
    expect(propertyRow).toEqual({
      officialValuation: 475_000,
      officialValuationYear: 2025,
      officialValuationVerified: true,
    });
    const pyramidWatermarkAfter = await readOfficialValuationPyramidWatermark();
    expect(pyramidWatermarkAfter > pyramidWatermarkBefore).toBe(true);
  });

  it('enqueues one server hydration job for missing WOZ and reuses pending jobs', async () => {
    const property = await createIntegrationProperty({
      street: 'Official Valuation Queue Fixture',
      houseNumber: 43,
      postalCode: '1234AD',
      city: 'Eindhoven',
    });
    propertyIds.push(property.id);

    const first = await acceptOfficialValuationHydrationRequest({
      propertyId: property.id,
      source: 'woz',
      observed: null,
      submittedByUserId: null,
    });
    const second = await acceptOfficialValuationHydrationRequest({
      propertyId: property.id,
      source: 'woz',
      observed: null,
      submittedByUserId: null,
    });

    expect(first).toMatchObject({
      status: 'queued',
      cachedValuation: null,
      cachedVerified: false,
    });
    expect(first?.dispatchJob).toMatchObject({
      propertyId: property.id,
      source: 'woz',
      valuationYear: 2025,
    });
    expect(second).toMatchObject({
      status: 'queued',
      cachedValuation: null,
      cachedVerified: false,
      dispatchJob: first?.dispatchJob,
    });

    const jobs = await db
      .select()
      .from(propertyOfficialValuationHydrationJobs)
      .where(eq(propertyOfficialValuationHydrationJobs.propertyId, property.id));
    expect(jobs).toHaveLength(1);
  });

  it('reports cached valuation and retry metadata without fetching the source', async () => {
    const property = await createIntegrationProperty({
      street: 'Official Valuation Status Fixture',
      houseNumber: 44,
      postalCode: '1234AE',
      city: 'Eindhoven',
      officialValuation: 400_000,
      officialValuationYear: 2024,
    });
    propertyIds.push(property.id);
    const nextAttemptAt = new Date(Date.now() + 60_000);

    const [job] = await db
      .insert(propertyOfficialValuationHydrationJobs)
      .values({
        propertyId: property.id,
        source: 'woz',
        valuationYear: 2025,
        state: 'retryable',
        attemptCount: 2,
        nextAttemptAt,
        lastError: 'source_minute_rate_limit',
      })
      .returning();

    const status = await getCurrentOfficialValuationStatus({
      propertyId: property.id,
      source: 'woz',
    });

    expect(status).toMatchObject({
      propertyId: property.id,
      source: 'woz',
      expectedValuationYear: 2025,
      officialValuation: 400_000,
      officialValuationYear: 2024,
      officialValuationVerified: false,
      job: {
        id: job.id,
        state: 'retryable',
        valuationYear: 2025,
        attemptCount: 2,
        nextAttemptAt: nextAttemptAt.toISOString(),
        lastError: 'source_minute_rate_limit',
      },
    });
  });

  it('enforces WOZ source concurrency through durable source state', async () => {
    await db
      .delete(officialValuationSourceStates)
      .where(eq(officialValuationSourceStates.source, 'woz'));

    const first = await reserveOfficialValuationSourceRequest('woz');
    const second = await reserveOfficialValuationSourceRequest('woz');

    expect(first).toEqual({ allowed: true });
    expect(second.allowed).toBe(false);
    if (!second.allowed) {
      expect(second.reason).toBe('source_concurrency_limit');
    }

    const [busyState] = await db
      .select({
        requestsInFlight: officialValuationSourceStates.requestsInFlight,
      })
      .from(officialValuationSourceStates)
      .where(eq(officialValuationSourceStates.source, 'woz'))
      .limit(1);
    expect(busyState?.requestsInFlight).toBe(1);

    await releaseOfficialValuationSourceRequest('woz');

    const third = await reserveOfficialValuationSourceRequest('woz');
    expect(third).toEqual({ allowed: true });

    await releaseOfficialValuationSourceRequest('woz');

    const [releasedState] = await db
      .select({
        requestsInFlight: officialValuationSourceStates.requestsInFlight,
        leaseExpiresAt: officialValuationSourceStates.requestsInFlightLeaseExpiresAt,
      })
      .from(officialValuationSourceStates)
      .where(eq(officialValuationSourceStates.source, 'woz'))
      .limit(1);
    expect(releasedState).toEqual({
      requestsInFlight: 0,
      leaseExpiresAt: null,
    });
  });

  it('records non-rate-limited source failures without tripping nullable SQL bindings', async () => {
    await db
      .delete(officialValuationSourceStates)
      .where(eq(officialValuationSourceStates.source, 'woz'));

    await expect(
      markOfficialValuationSourceFailure({
        source: 'woz',
        error: 'fetch failed',
        rateLimited: false,
      }),
    ).resolves.toBeUndefined();

    const [sourceState] = await db
      .select({
        state: officialValuationSourceStates.state,
        consecutiveFailureCount: officialValuationSourceStates.consecutiveFailureCount,
        lastFailureAt: officialValuationSourceStates.lastFailureAt,
        lastRateLimitAt: officialValuationSourceStates.lastRateLimitAt,
        lastError: officialValuationSourceStates.lastError,
        circuitHalfOpenAt: officialValuationSourceStates.circuitHalfOpenAt,
      })
      .from(officialValuationSourceStates)
      .where(eq(officialValuationSourceStates.source, 'woz'))
      .limit(1);

    expect(sourceState).toMatchObject({
      state: 'healthy',
      consecutiveFailureCount: 1,
      lastRateLimitAt: null,
      lastError: 'fetch failed',
      circuitHalfOpenAt: null,
    });
    expect(sourceState?.lastFailureAt).toBeInstanceOf(Date);
  });

  it('creates a durable maintenance refresh request when server hydration updates the valuation cache', async () => {
    const property = await createIntegrationProperty({
      street: 'Official Valuation Maintenance Fixture',
      houseNumber: 42,
      postalCode: '1234AC',
      city: 'Eindhoven',
    });
    propertyIds.push(property.id);

    const [job] = await db
      .insert(propertyOfficialValuationHydrationJobs)
      .values({
        propertyId: property.id,
        source: 'woz',
        valuationYear: 2025,
        state: 'running',
        attemptCount: 1,
        lastAttemptAt: new Date(),
      })
      .returning();
    const pyramidWatermarkBefore = await readOfficialValuationPyramidWatermark();

    const maintenance = await markOfficialValuationHydrationSucceeded(job.id, {
      valuation: 512_000,
      valuationYear: 2025,
      referenceDate: '2025-01-01',
      sourceRecordId: 'woz-object-42',
      sourceDatasetVersion: '2025',
      sourceUrl: 'https://example.test/woz-object-42',
      rawPayload: { fixture: true },
    });
    maintenanceBatchIds.push(maintenance.batchId);

    const [propertyRow] = await db
      .select({
        officialValuation: properties.officialValuation,
        officialValuationYear: properties.officialValuationYear,
        officialValuationVerified: properties.officialValuationVerified,
      })
      .from(properties)
      .where(eq(properties.id, property.id))
      .limit(1);
    expect(propertyRow).toEqual({
      officialValuation: 512_000,
      officialValuationYear: 2025,
      officialValuationVerified: true,
    });

    const [maintenanceRow] = await db
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.id, maintenance.batchId))
      .limit(1);
    expect(maintenanceRow).toBeDefined();
    expect(maintenanceRow?.sourceName).toBe('official-valuation-woz');
    expect(maintenanceRow?.maintenanceRequestedAt).not.toBeNull();
    expect(maintenanceRow?.maintenanceCompletedAt).toBeNull();
    expect(maintenanceRow?.payloadJson).toMatchObject({
      requestedBy: 'official-valuation',
      propertyId: property.id,
      source: 'woz',
      valuation: 512_000,
      valuationYear: 2025,
      origin: 'server_verified',
    });
    const pyramidWatermarkAfter = await readOfficialValuationPyramidWatermark();
    expect(pyramidWatermarkAfter > pyramidWatermarkBefore).toBe(true);
  });
});
