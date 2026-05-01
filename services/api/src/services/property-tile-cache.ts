import { createHash } from 'node:crypto';

const DEFAULT_FRESH_TTL_SECONDS = 300;
const DEFAULT_STALE_TTL_SECONDS = 86_400;
const DEFAULT_MAX_ENTRIES = 1_024;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

export const PROPERTY_TILE_CACHE_TTL_SECONDS = DEFAULT_FRESH_TTL_SECONDS;
export const PROPERTY_TILE_CACHE_CONTROL = `public, max-age=${PROPERTY_TILE_CACHE_TTL_SECONDS}, stale-while-revalidate=300`;
export const PROPERTY_TILE_STALE_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
export const PROPERTY_TILE_TIMEOUT_CACHE_CONTROL = 'no-store, max-age=0';

export type PublicPropertyTileCacheEntry = {
  freshUntil: number;
  staleUntil: number;
  payload: Buffer | null;
  statusCode: 200 | 204;
  etag: string;
  byteSize: number;
  lastAccessedAt: number;
};

export type PublicPropertyTileCacheLookup =
  | { state: 'fresh'; entry: PublicPropertyTileCacheEntry }
  | { state: 'stale'; entry: PublicPropertyTileCacheEntry }
  | { state: 'miss'; entry?: never };

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getStaleTtlMs(): number {
  return (
    parsePositiveIntegerEnv('PROPERTY_TILE_STALE_TTL_SECONDS', DEFAULT_STALE_TTL_SECONDS) * 1000
  );
}

function getMaxBytes(): number {
  return parsePositiveIntegerEnv('PROPERTY_TILE_CACHE_MAX_BYTES', DEFAULT_MAX_BYTES);
}

function getMaxEntries(): number {
  return parsePositiveIntegerEnv('PROPERTY_TILE_CACHE_MAX_ENTRIES', DEFAULT_MAX_ENTRIES);
}

export function buildPropertyTileEtag(cacheKey: string, payload: Buffer | null): string {
  const hash = createHash('sha1');
  hash.update(cacheKey);
  if (payload) {
    hash.update(payload);
  } else {
    hash.update('empty');
  }
  return `"${hash.digest('hex')}"`;
}

export class PublicPropertyTileCache {
  private readonly entries = new Map<string, PublicPropertyTileCacheEntry>();
  private totalBytes = 0;

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  get(cacheKey: string, now = Date.now()): PublicPropertyTileCacheLookup {
    const entry = this.entries.get(cacheKey);
    if (!entry) {
      return { state: 'miss' };
    }

    if (entry.staleUntil <= now) {
      this.delete(cacheKey);
      return { state: 'miss' };
    }

    this.touch(cacheKey, entry, now);
    return {
      state: entry.freshUntil > now ? 'fresh' : 'stale',
      entry,
    };
  }

  getStale(cacheKey: string, now = Date.now()): PublicPropertyTileCacheEntry | null {
    const lookup = this.get(cacheKey, now);
    if (lookup.state !== 'stale') {
      return null;
    }

    return lookup.entry.statusCode === 200 && lookup.entry.payload ? lookup.entry : null;
  }

  set(
    cacheKey: string,
    entry: Pick<PublicPropertyTileCacheEntry, 'payload' | 'statusCode' | 'etag'>,
    now = Date.now()
  ): PublicPropertyTileCacheEntry {
    this.delete(cacheKey);

    const cachedEntry: PublicPropertyTileCacheEntry = {
      ...entry,
      byteSize: entry.payload?.byteLength ?? 0,
      freshUntil: now + PROPERTY_TILE_CACHE_TTL_SECONDS * 1000,
      staleUntil: now + PROPERTY_TILE_CACHE_TTL_SECONDS * 1000 + getStaleTtlMs(),
      lastAccessedAt: now,
    };

    this.entries.set(cacheKey, cachedEntry);
    this.totalBytes += cachedEntry.byteSize;
    this.prune(now);
    return cachedEntry;
  }

  private delete(cacheKey: string): void {
    const existing = this.entries.get(cacheKey);
    if (!existing) return;
    this.totalBytes -= existing.byteSize;
    this.entries.delete(cacheKey);
  }

  private touch(cacheKey: string, entry: PublicPropertyTileCacheEntry, now: number): void {
    this.entries.delete(cacheKey);
    this.entries.set(cacheKey, { ...entry, lastAccessedAt: now });
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.staleUntil <= now) {
        this.delete(key);
      }
    }

    while (this.entries.size > getMaxEntries() || this.totalBytes > getMaxBytes()) {
      const staleKey = this.findOldestKey((entry) => entry.freshUntil <= now);
      const oldestKey = staleKey ?? this.findOldestKey(() => true);
      if (!oldestKey) break;
      this.delete(oldestKey);
    }
  }

  private findOldestKey(
    predicate: (entry: PublicPropertyTileCacheEntry) => boolean
  ): string | null {
    let oldestKey: string | null = null;
    let oldestAccess = Number.POSITIVE_INFINITY;

    for (const [key, entry] of this.entries) {
      if (!predicate(entry)) continue;
      if (entry.lastAccessedAt < oldestAccess) {
        oldestAccess = entry.lastAccessedAt;
        oldestKey = key;
      }
    }

    return oldestKey;
  }
}

export const publicPropertyTileCache = new PublicPropertyTileCache();
