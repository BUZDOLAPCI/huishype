import { describe, expect, it } from '@jest/globals';
import { computeListingAffectedTiles, listingTileCacheRevision } from './listing-tile-updates.js';
import { getGroupingBufferUnits, PROPERTY_TILE_EXTENT } from './property-grouping.js';

describe('listing tile invalidation coverage', () => {
  it('deduplicates the world tile and wraps adjacent tiles across the antimeridian', () => {
    expect(computeListingAffectedTiles(180, 0, 0)).toEqual([{ z: 0, x: 0, y: 0 }]);
    const edge = computeListingAffectedTiles(180, 20, 3).filter(tile => tile.z === 3);
    expect(new Set(edge.map(tile => tile.x))).toEqual(new Set([0, 7]));
  });

  it('invalidates all four neighbors at a tile corner, including grouping buffer overlap', () => {
    expect(computeListingAffectedTiles(0, 0, 2).filter(tile => tile.z === 2)).toEqual([
      { z: 2, x: 1, y: 1 }, { z: 2, x: 1, y: 2 },
      { z: 2, x: 2, y: 1 }, { z: 2, x: 2, y: 2 },
    ]);
    const longitudeBuffer = getGroupingBufferUnits() / PROPERTY_TILE_EXTENT / 4 * 360;
    const overlapping = computeListingAffectedTiles(longitudeBuffer * 0.9, 20, 2).filter(tile => tile.z === 2);
    const separate = computeListingAffectedTiles(longitudeBuffer * 1.1, 20, 2).filter(tile => tile.z === 2);
    expect(overlapping.some(tile => tile.x === 1)).toBe(true);
    expect(separate.some(tile => tile.x === 1)).toBe(false);
  });

  it('clamps polar geometry and rejects invalid zooms and coordinates', () => {
    expect(computeListingAffectedTiles(5, 90, 10).every(tile => tile.y >= 0 && tile.y < 2 ** tile.z)).toBe(true);
    expect(() => computeListingAffectedTiles(NaN, 0, 10)).toThrow();
    expect(() => computeListingAffectedTiles(0, 0, 23)).toThrow();
  });

  it('changes cache identity on both dirty evidence and an atomic publication', () => {
    const before = { requestedRevision: '2', publishedRevision: '1', publishedVersionId: 'old', pendingFingerprint: 'none' };
    expect(listingTileCacheRevision(before)).not.toBe(listingTileCacheRevision({ ...before, requestedRevision: '3' }));
    expect(listingTileCacheRevision(before)).not.toBe(listingTileCacheRevision({ ...before, publishedRevision: '2' }));
    expect(listingTileCacheRevision(before)).not.toBe(listingTileCacheRevision({ ...before, publishedVersionId: 'new' }));
  });
});
