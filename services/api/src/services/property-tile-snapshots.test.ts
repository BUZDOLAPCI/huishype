import { describe, expect, it, jest } from '@jest/globals';
import {
  buildPropertyTileSnapshotRefreshRequestResult,
  computePropertyTileSnapshotConfigHash,
  computePropertyTileSnapshotCoordinatesFromCoverage,
  getExpectedDefaultPropertyTileSnapshotCoverageDefinition,
  getPropertyTilePrecomputeConcurrency,
  getPropertyTilePrecomputeMaxZoom,
  isPropertyViewSnapshotRecoveryThrottled,
  isSnapshotRefreshRequestThrottled,
  isSnapshotTileDueForRollingWindow,
  safeRequestPropertyTileSnapshotRefresh,
  summarizePropertyTileSnapshotRefreshRun,
} from './property-tile-snapshots.js';

describe('property tile snapshots', () => {
  it('computes a stable config hash independent of country and source ordering', () => {
    const first = computePropertyTileSnapshotConfigHash({
      maxZoom: 10,
      filterSignature: 'default',
      bounds: { minLon: -1, minLat: 50, maxLon: 8, maxLat: 54 },
      countries: ['NL', 'DE', 'BE'],
      dataSources: ['funda', 'pararius', 'immoweb'],
    });
    const second = computePropertyTileSnapshotConfigHash({
      maxZoom: 10,
      filterSignature: 'default',
      bounds: { minLon: -1, minLat: 50, maxLon: 8, maxLat: 54 },
      countries: ['BE', 'NL', 'DE'],
      dataSources: ['immoweb', 'funda', 'pararius'],
    });

    expect(second).toBe(first);
  });

  it('includes coverage identity and precompute zoom in the config hash', () => {
    const base = {
      coverageId: 'coverage-a',
      boundsSource: 'env:test',
      maxZoom: 10,
      filterSignature: 'default',
      bounds: { minLon: -1, minLat: 50, maxLon: 8, maxLat: 54 },
      countries: ['NL'],
      dataSources: ['funda'],
    };

    const first = computePropertyTileSnapshotConfigHash(base);
    expect(computePropertyTileSnapshotConfigHash({ ...base, coverageId: 'coverage-b' }))
      .not.toBe(first);
    expect(computePropertyTileSnapshotConfigHash({ ...base, maxZoom: 9 }))
      .not.toBe(first);
  });

  it('aligns the config hash with the 7-day tile social scoring window', () => {
    const base = {
      maxZoom: 10,
      filterSignature: 'default',
      bounds: { minLon: -1, minLat: 50, maxLon: 8, maxLat: 54 },
      countries: ['NL'],
      dataSources: ['funda'],
    };

    expect(computePropertyTileSnapshotConfigHash(base)).toBe(
      '170969679567944f8eff54fbcce9251bb98bb0761ce5b85cb66f3dc7d8746951',
    );
  });

  it('allows max zoom zero for z0-only precompute coverage', () => {
    const previous = process.env.PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM;
    process.env.PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM = '0';

    try {
      expect(getPropertyTilePrecomputeMaxZoom()).toBe(0);
    } finally {
      if (previous == null) {
        delete process.env.PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM;
      } else {
        process.env.PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM = previous;
      }
    }
  });

  it('honors bounded snapshot precompute concurrency without crashing on non-1 config', () => {
    const previous = process.env.PROPERTY_TILE_PRECOMPUTE_CONCURRENCY;
    process.env.PROPERTY_TILE_PRECOMPUTE_CONCURRENCY = '4';

    try {
      expect(getPropertyTilePrecomputeConcurrency()).toBe(4);
    } finally {
      if (previous == null) {
        delete process.env.PROPERTY_TILE_PRECOMPUTE_CONCURRENCY;
      } else {
        process.env.PROPERTY_TILE_PRECOMPUTE_CONCURRENCY = previous;
      }
    }
  });

  it('treats quota-limited snapshot refreshes as progress, not failed placeholders', () => {
    const summary = summarizePropertyTileSnapshotRefreshRun({
      dueTileCount: 25,
      attemptedTileCount: 10,
      refreshedTileCount: 10,
      failedTileCount: 0,
    });

    expect(summary).toEqual({
      completed: false,
      skippedTileCount: 15,
      status: 'quota_exhausted',
      error: null,
    });
  });

  it('keeps throttled refresh requests anchored to the previous request time', () => {
    const requestedAt = new Date('2026-05-01T10:00:00.000Z');
    const now = new Date('2026-05-01T10:02:00.000Z');

    expect(isSnapshotRefreshRequestThrottled({
      requestedAt,
      lastError: null,
      now,
      throttleMs: 5 * 60_000,
    })).toBe(true);
    expect(isSnapshotRefreshRequestThrottled({
      requestedAt,
      lastError: 'previous failed',
      now,
      throttleMs: 5 * 60_000,
    })).toBe(false);
  });

  it('reports coalesced singleton refresh requests as not newly enqueued', () => {
    expect(buildPropertyTileSnapshotRefreshRequestResult({
      enqueueResult: {
        status: 'coalesced',
        jobId: 'property-tile-snapshot-refresh-public-default-low-zoom',
        existingState: 'waiting',
      },
    })).toEqual({
      enqueued: false,
      throttled: false,
      enqueueStatus: 'coalesced',
      queueJobId: 'property-tile-snapshot-refresh-public-default-low-zoom',
      queueJobState: 'waiting',
    });
  });

  it('reports retried singleton refresh requests as queued work', () => {
    expect(buildPropertyTileSnapshotRefreshRequestResult({
      enqueueResult: {
        status: 'retried',
        jobId: 'property-tile-snapshot-refresh-public-default-low-zoom',
        previousState: 'failed',
      },
    })).toEqual({
      enqueued: true,
      throttled: false,
      enqueueStatus: 'retried',
      queueJobId: 'property-tile-snapshot-refresh-public-default-low-zoom',
      queueJobState: 'failed',
    });
  });

  it('throttles worker recovery only for property-view social lag inside the view interval', () => {
    const requestedAt = new Date('2026-05-01T10:00:00.000Z');
    const now = new Date('2026-05-01T10:02:00.000Z');

    expect(isPropertyViewSnapshotRecoveryThrottled({
      requestReason: 'property-view',
      requestedAt,
      lastError: null,
      now,
      throttleMs: 5 * 60_000,
    })).toBe(true);
    expect(isPropertyViewSnapshotRecoveryThrottled({
      requestReason: 'price-guess',
      requestedAt,
      lastError: null,
      now,
      throttleMs: 5 * 60_000,
    })).toBe(false);
  });

  it('marks rolling-window tiles due when the last rolling refresh is missing', () => {
    expect(isSnapshotTileDueForRollingWindow({
      refreshedAt: new Date('2026-05-01T10:00:00.000Z'),
      lastWindowRefreshAt: null,
      now: new Date('2026-05-01T10:05:00.000Z'),
      maxAgeMs: 60 * 60_000,
    })).toBe(true);
  });

  it('only rebuilds rows at or before a stale rolling-window cutoff', () => {
    const lastWindowRefreshAt = new Date('2026-05-01T10:00:00.000Z');
    const now = new Date('2026-05-01T12:00:00.000Z');

    expect(isSnapshotTileDueForRollingWindow({
      refreshedAt: new Date('2026-05-01T09:59:00.000Z'),
      lastWindowRefreshAt,
      now,
      maxAgeMs: 60 * 60_000,
    })).toBe(true);
    expect(isSnapshotTileDueForRollingWindow({
      refreshedAt: new Date('2026-05-01T10:01:00.000Z'),
      lastWindowRefreshAt,
      now,
      maxAgeMs: 60 * 60_000,
    })).toBe(false);
  });

  it('reports tile build failures separately from quota spillover', () => {
    const summary = summarizePropertyTileSnapshotRefreshRun({
      dueTileCount: 25,
      attemptedTileCount: 10,
      refreshedTileCount: 9,
      failedTileCount: 1,
    });

    expect(summary.completed).toBe(false);
    expect(summary.status).toBe('failed');
    expect(summary.skippedTileCount).toBe(15);
    expect(summary.error).toContain('1 failed');
  });

  it('computes coordinates from explicit persisted coverage bounds', () => {
    const coordinates = computePropertyTileSnapshotCoordinatesFromCoverage({
      minLon: 4,
      minLat: 51,
      maxLon: 6,
      maxLat: 52,
      maxZoom: 2,
    });

    expect(coordinates.length).toBeGreaterThan(0);
    expect(coordinates.every((tile) => tile.z >= 0 && tile.z <= 2)).toBe(true);
    expect(coordinates[0]).toEqual({ z: 0, x: 0, y: 0 });
  });

  it('refuses invalid coverage instead of falling back to world coordinates', () => {
    expect(() =>
      computePropertyTileSnapshotCoordinatesFromCoverage({
        minLon: 6,
        minLat: 51,
        maxLon: 4,
        maxLat: 52,
        maxZoom: 2,
      }),
    ).toThrow(/invalid coverage bounds/);
  });

  it('exposes the expected default coverage definition without persisting it', () => {
    const definition = getExpectedDefaultPropertyTileSnapshotCoverageDefinition();

    expect(definition.coverageId).toBe('public_default_low_zoom_v1');
    expect(definition.filterSignature).toBe('default');
    expect(definition.snapshotConfigHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('logs and suppresses post-commit refresh failures', async () => {
    const warn = jest.fn();
    const requestRefresh = jest.fn(async () => {
      throw new Error('queue unavailable');
    });

    const result = await safeRequestPropertyTileSnapshotRefresh(
      { reason: 'unit-test' },
      { warn },
      { propertyId: 'property-1' },
      requestRefresh,
    );

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'unit-test',
        propertyId: 'property-1',
        err: expect.any(Error),
      }),
      'Failed to request property tile snapshot refresh after commit',
    );
  });
});
