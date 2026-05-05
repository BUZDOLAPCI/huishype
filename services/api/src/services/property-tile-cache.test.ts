import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  PROPERTY_TILE_CACHE_TTL_SECONDS,
  PublicPropertyTileCache,
  buildPropertyTileEtag,
} from './property-tile-cache.js';

describe('PublicPropertyTileCache', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('prunes stale entries before fresh entries when the byte cap is exceeded', () => {
    process.env.PROPERTY_TILE_CACHE_MAX_BYTES = '10';
    process.env.PROPERTY_TILE_CACHE_MAX_ENTRIES = '10';
    const cache = new PublicPropertyTileCache();
    const now = Date.now();
    const stalePayload = Buffer.from('stale123');
    const freshPayload = Buffer.from('fresh123');
    const staleKey = '10/1/1:default';
    const freshKey = '10/1/2:default';

    cache.set(
      staleKey,
      {
        payload: stalePayload,
        statusCode: 200,
        etag: buildPropertyTileEtag(staleKey, stalePayload),
      },
      now - PROPERTY_TILE_CACHE_TTL_SECONDS * 1000 - 1_000,
    );
    cache.set(
      freshKey,
      {
        payload: freshPayload,
        statusCode: 200,
        etag: buildPropertyTileEtag(freshKey, freshPayload),
      },
      now,
    );

    expect(cache.get(staleKey, now).state).toBe('miss');
    expect(cache.get(freshKey, now).state).toBe('fresh');
  });
});
