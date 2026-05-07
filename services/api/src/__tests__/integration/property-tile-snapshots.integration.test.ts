import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  DEFAULT_PROPERTY_TILE_SNAPSHOT_COVERAGE_ID,
  PROPERTY_TILE_SNAPSHOT_KEY,
  advancePropertyTileSnapshotWatermark,
  ensureDefaultPropertyTileSnapshotCoverage,
  executePropertyTileSnapshotRefresh,
  requestPropertyTileSnapshotRefreshAfterBulkImport,
  requestPropertyTileSnapshotRefresh,
  upsertPropertyTileSnapshotRow,
  type PropertyTileCoordinate,
} from '../../services/property-tile-snapshots.js';

const tile: PropertyTileCoordinate = { z: 0, x: 0, y: 0 };

type SnapshotRow = {
  payload: Buffer | null;
  source_listing_watermark: string;
  applied_listing_watermark: string;
  coverage_count: number;
};

async function resetSnapshotState(): Promise<void> {
  await db.execute(sql`
    DELETE FROM property_tile_snapshots
    WHERE coverage_id = ${DEFAULT_PROPERTY_TILE_SNAPSHOT_COVERAGE_ID}
  `);
  await db.execute(sql`
    DELETE FROM property_tile_snapshot_coverage
    WHERE coverage_id = ${DEFAULT_PROPERTY_TILE_SNAPSHOT_COVERAGE_ID}
  `);
  await db.execute(sql`
    DELETE FROM property_tile_snapshot_refresh_state
    WHERE key = ${PROPERTY_TILE_SNAPSHOT_KEY}
  `);
  await db.execute(sql`
    INSERT INTO property_tile_snapshot_watermarks (key)
    VALUES (${PROPERTY_TILE_SNAPSHOT_KEY})
    ON CONFLICT (key) DO UPDATE SET
      listing_watermark = 0,
      social_watermark = 0,
      property_watermark = 0,
      coverage_watermark = 0,
      updated_at = now()
  `);
}

async function readSnapshotRow(): Promise<SnapshotRow | null> {
  const rows = await db.execute<SnapshotRow>(sql`
    SELECT
      s.payload,
      s.source_listing_watermark::text,
      r.applied_listing_watermark::text,
      (
        SELECT count(*)::int
        FROM property_tile_snapshot_coverage
        WHERE coverage_id = ${DEFAULT_PROPERTY_TILE_SNAPSHOT_COVERAGE_ID}
      ) AS coverage_count
    FROM property_tile_snapshots s
    LEFT JOIN property_tile_snapshot_refresh_state r
      ON r.key = ${PROPERTY_TILE_SNAPSHOT_KEY}
    WHERE s.coverage_id = ${DEFAULT_PROPERTY_TILE_SNAPSHOT_COVERAGE_ID}
      AND s.z = ${tile.z}
      AND s.x = ${tile.x}
      AND s.y = ${tile.y}
  `);
  return Array.from(rows)[0] ?? null;
}

describe('property tile snapshot persistence', () => {
  jest.setTimeout(30000);
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env = {
      ...originalEnv,
      PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM: '0',
      PROPERTY_TILE_PRECOMPUTE_MAX_TILES_PER_RUN: '1',
      PROPERTY_TILE_PRECOMPUTE_MAX_SECONDS_PER_RUN: '30',
      PROPERTY_TILE_PRECOMPUTE_CONCURRENCY: '1',
    };
    await resetSnapshotState();
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await resetSnapshotState();
  });

  it('does not let an older snapshot watermark overwrite a newer last-good row', async () => {
    const coverage = await ensureDefaultPropertyTileSnapshotCoverage();
    const newerPayload = Buffer.from('newer-snapshot');
    const olderPayload = Buffer.from('older-snapshot');

    await upsertPropertyTileSnapshotRow({
      tile,
      filterSignature: coverage.filterSignature,
      coverage,
      payload: newerPayload,
      watermarks: {
        listingWatermark: 2n,
        socialWatermark: 0n,
        propertyWatermark: 0n,
        coverageWatermark: coverage.coverageWatermark,
      },
      generatedAt: new Date('2026-05-01T10:00:00.000Z'),
    });
    const staleWrite = await upsertPropertyTileSnapshotRow({
      tile,
      filterSignature: coverage.filterSignature,
      coverage,
      payload: olderPayload,
      watermarks: {
        listingWatermark: 1n,
        socialWatermark: 0n,
        propertyWatermark: 0n,
        coverageWatermark: coverage.coverageWatermark,
      },
      generatedAt: new Date('2026-05-01T10:05:00.000Z'),
    });

    const row = await readSnapshotRow();

    expect(staleWrite).toEqual({ written: false, skippedAsStale: true });
    expect(row?.payload).toEqual(newerPayload);
    expect(row?.source_listing_watermark).toBe('2');
  });

  it('executes a refresh, persists coverage, and advances applied watermarks', async () => {
    await ensureDefaultPropertyTileSnapshotCoverage();
    await advancePropertyTileSnapshotWatermark(['listing']);
    const builderOptions: unknown[] = [];

    const result = await executePropertyTileSnapshotRefresh({
      reason: 'integration-refresh',
      leaseOwner: 'integration-refresh-owner',
      builder: async (_tile, _filters, options) => {
        builderOptions.push(options);
        return Buffer.from('refresh-payload');
      },
    });
    const row = await readSnapshotRow();

    expect(result.status).toBe('completed');
    expect(result.refreshedTileCount).toBe(1);
    expect(builderOptions[0]).toEqual(
      expect.objectContaining({
        statementTimeoutMs: 1500,
        runtimeBudgetMs: 2000,
        runtimeStartedAtMs: expect.any(Number),
        runtimeDeadlineMs: expect.any(Number),
      }),
    );
    expect(
      (builderOptions[0] as { runtimeDeadlineMs: number }).runtimeDeadlineMs -
        (builderOptions[0] as { runtimeStartedAtMs: number }).runtimeStartedAtMs,
    ).toBe(2000);
    expect(row?.payload).toEqual(Buffer.from('refresh-payload'));
    expect(row?.source_listing_watermark).toBe('1');
    expect(row?.applied_listing_watermark).toBe('1');
    expect(row?.coverage_count).toBe(1);
  });

  it('bootstraps default coverage when a fresh DB runs snapshot refresh', async () => {
    const result = await executePropertyTileSnapshotRefresh({
      reason: 'missing-coverage',
      leaseOwner: 'missing-coverage-owner',
      builder: async () => Buffer.from('bootstrapped-coverage'),
    });
    const row = await readSnapshotRow();

    expect(result.status).toBe('completed');
    expect(row?.payload).toEqual(Buffer.from('bootstrapped-coverage'));
    expect(row?.coverage_count).toBe(1);
  });

  it('keeps default coverage unmodified when legacy snapshot refresh requests are disabled', async () => {
    const result = await requestPropertyTileSnapshotRefresh({
      reason: 'bulk-import',
      enqueue: false,
      initializeDefaultCoverage: true,
    });
    const rows = await db.execute<{ coverage_count: number }>(sql`
      SELECT count(*)::int AS coverage_count
      FROM property_tile_snapshot_coverage
      WHERE coverage_id = ${DEFAULT_PROPERTY_TILE_SNAPSHOT_COVERAGE_ID}
    `);

    expect(result).toEqual({
      enqueued: false,
      throttled: false,
      enqueueStatus: 'skipped',
      skippedReason: 'disabled',
      queueJobId: 'property-tile-snapshot-refresh-public-default-low-zoom',
    });
    expect(Array.from(rows)[0]?.coverage_count ?? 0).toBe(0);
  });

  it('bulk import refresh requests use the disabled legacy request path without advancing snapshot watermarks', async () => {
    const requestRefresh = jest.fn<typeof requestPropertyTileSnapshotRefresh>().mockResolvedValue({
      enqueued: false,
      throttled: false,
      enqueueStatus: 'skipped',
      skippedReason: 'disabled',
      queueJobId: 'property-tile-snapshot-refresh-public-default-low-zoom',
    });

    const result = await requestPropertyTileSnapshotRefreshAfterBulkImport(
      'bulk-import-test',
      requestRefresh,
    );
    const rows = await db.execute<{
      property_watermark: string;
      coverage_watermark: string;
    }>(sql`
      SELECT property_watermark::text, coverage_watermark::text
      FROM property_tile_snapshot_watermarks
      WHERE key = ${PROPERTY_TILE_SNAPSHOT_KEY}
    `);
    const row = Array.from(rows)[0];

    expect(result).toEqual({
      enqueued: false,
      throttled: false,
      enqueueStatus: 'skipped',
      skippedReason: 'disabled',
      queueJobId: 'property-tile-snapshot-refresh-public-default-low-zoom',
    });
    expect(requestRefresh).toHaveBeenCalledWith({
      reason: 'bulk-import-test',
      enqueue: false,
      initializeDefaultCoverage: false,
    });
    expect(row?.property_watermark ?? '0').toBe('0');
    expect(row?.coverage_watermark ?? '0').toBe('0');
  });

  it('does not mutate refresh state for disabled legacy snapshot requests', async () => {
    const requestedAt = new Date(Date.now() - 1_000);
    await db.execute(sql`
      INSERT INTO property_tile_snapshot_refresh_state (
        key,
        requested_at,
        request_reason,
        last_error
      )
      VALUES (
        ${PROPERTY_TILE_SNAPSHOT_KEY},
        ${requestedAt.toISOString()}::timestamptz,
        'listing-maintenance',
        NULL
      )
      ON CONFLICT (key) DO UPDATE SET
        requested_at = EXCLUDED.requested_at,
        request_reason = EXCLUDED.request_reason,
        last_error = NULL
    `);

    const result = await requestPropertyTileSnapshotRefresh({
      reason: 'snapshot-lookup-miss',
      throttleMs: 60_000,
    });
    const rows = await db.execute<{
      request_reason: string | null;
      requested_at: Date | string | null;
    }>(sql`
      SELECT request_reason, requested_at
      FROM property_tile_snapshot_refresh_state
      WHERE key = ${PROPERTY_TILE_SNAPSHOT_KEY}
      LIMIT 1
    `);
    const row = Array.from(rows)[0];

    expect(result).toEqual({
      enqueued: false,
      throttled: false,
      enqueueStatus: 'skipped',
      skippedReason: 'disabled',
      queueJobId: 'property-tile-snapshot-refresh-public-default-low-zoom',
    });
    expect(row?.request_reason).toBe('listing-maintenance');
    expect(new Date(row?.requested_at ?? 0).getTime()).toBe(requestedAt.getTime());
  });

  it('uses configured per-tile runtime and statement budgets for refresh builds', async () => {
    process.env.PROPERTY_TILE_PRECOMPUTE_TILE_BUDGET_MS = '3456';
    process.env.PROPERTY_TILE_PRECOMPUTE_STATEMENT_TIMEOUT_MS = '2345';
    const builderOptions: unknown[] = [];

    const result = await executePropertyTileSnapshotRefresh({
      reason: 'integration-refresh-budget',
      leaseOwner: 'integration-refresh-budget-owner',
      builder: async (_tile, _filters, options) => {
        builderOptions.push(options);
        return Buffer.from('budget-payload');
      },
    });

    expect(result.status).toBe('completed');
    expect(builderOptions[0]).toEqual(
      expect.objectContaining({
        statementTimeoutMs: 2345,
        runtimeBudgetMs: 3456,
        runtimeStartedAtMs: expect.any(Number),
        runtimeDeadlineMs: expect.any(Number),
      }),
    );
    expect(
      (builderOptions[0] as { runtimeDeadlineMs: number }).runtimeDeadlineMs -
        (builderOptions[0] as { runtimeStartedAtMs: number }).runtimeStartedAtMs,
    ).toBe(3456);
  });

  it('returns bounded structured details for per-tile snapshot refresh failures', async () => {
    await ensureDefaultPropertyTileSnapshotCoverage();
    const warn = jest.fn();
    const sqlError = Object.assign(new Error('canceling statement due to statement timeout'), {
      code: '57014',
    });

    const result = await executePropertyTileSnapshotRefresh({
      reason: 'integration-refresh-failure',
      leaseOwner: 'integration-refresh-failure-owner',
      logger: { warn },
      builder: async () => {
        throw sqlError;
      },
    });

    expect(result.status).toBe('failed');
    expect(result.failedTileCount).toBe(1);
    expect(result.failureSummary).toEqual({
      total: 1,
      byClassification: { statement_timeout: 1 },
      byErrorCode: { '57014': 1 },
      byErrorName: { Error: 1 },
    });
    expect(result.failureSamples).toEqual([
      {
        tile: '0/0/0',
        classification: 'statement_timeout',
        errorName: 'Error',
        errorCode: '57014',
        message: 'canceling statement due to statement timeout',
      },
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'integration-refresh-failure',
        tile: '0/0/0',
        classification: 'statement_timeout',
        errorCode: '57014',
        err: sqlError,
      }),
      'Property tile snapshot refresh tile failed',
    );
  });

  it('keeps a lease-expired older refresh from overwriting a newer refresh', async () => {
    await ensureDefaultPropertyTileSnapshotCoverage();
    let releaseOlder!: () => void;
    let markOlderStarted!: () => void;
    const olderStarted = new Promise<void>((resolve) => {
      markOlderStarted = resolve;
    });

    const olderRun = executePropertyTileSnapshotRefresh({
      reason: 'older-refresh',
      leaseOwner: 'older-owner',
      builder: async () => {
        markOlderStarted();
        await new Promise<void>((resolve) => {
          releaseOlder = resolve;
        });
        return Buffer.from('older-payload');
      },
    });
    await olderStarted;

    await advancePropertyTileSnapshotWatermark(['listing']);
    await db.execute(sql`
      UPDATE property_tile_snapshot_refresh_state
      SET lease_until = now() - interval '1 second'
      WHERE key = ${PROPERTY_TILE_SNAPSHOT_KEY}
    `);

    const newerResult = await executePropertyTileSnapshotRefresh({
      reason: 'newer-refresh',
      leaseOwner: 'newer-owner',
      builder: async () => Buffer.from('newer-payload'),
    });
    releaseOlder();
    const olderResult = await olderRun;
    const row = await readSnapshotRow();

    expect(newerResult.status).toBe('completed');
    expect(newerResult.refreshedTileCount).toBe(1);
    expect(olderResult.status).toBe('completed');
    expect(olderResult.staleWriteSkippedTileCount).toBe(1);
    expect(row?.payload).toEqual(Buffer.from('newer-payload'));
    expect(row?.source_listing_watermark).toBe('1');
    expect(row?.applied_listing_watermark).toBe('1');
  });

  it('does not publish snapshot rows after the refresh lease has expired', async () => {
    await ensureDefaultPropertyTileSnapshotCoverage();
    let releaseBuilder!: () => void;
    let markBuilderStarted!: () => void;
    const builderStarted = new Promise<void>((resolve) => {
      markBuilderStarted = resolve;
    });

    const refreshRun = executePropertyTileSnapshotRefresh({
      reason: 'expired-lease-write',
      leaseOwner: 'expired-lease-owner',
      builder: async () => {
        markBuilderStarted();
        await new Promise<void>((resolve) => {
          releaseBuilder = resolve;
        });
        return Buffer.from('expired-lease-payload');
      },
    });
    await builderStarted;

    await db.execute(sql`
      UPDATE property_tile_snapshot_refresh_state
      SET lease_until = now() - interval '1 second'
      WHERE key = ${PROPERTY_TILE_SNAPSHOT_KEY}
    `);

    releaseBuilder();
    const result = await refreshRun;
    const row = await readSnapshotRow();

    expect(result.status).toBe('completed');
    expect(result.refreshedTileCount).toBe(0);
    expect(result.staleWriteSkippedTileCount).toBe(1);
    expect(row).toBeNull();
  });
});
