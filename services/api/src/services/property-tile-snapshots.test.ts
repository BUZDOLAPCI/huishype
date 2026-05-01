import { describe, expect, it, jest } from '@jest/globals';
import {
  computePropertyTileSnapshotConfigHash,
  computePropertyTileSnapshotCoordinatesFromCoverage,
  getExpectedDefaultPropertyTileSnapshotCoverageDefinition,
  safeRequestPropertyTileSnapshotRefresh,
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
