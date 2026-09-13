import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, type DbTransaction } from '../db/index.js';
import {
  buildCanonicalGroupsForTileUncached,
  getGroupingBufferUnits,
  lngLatToWorldUnits,
  PROPERTY_TILE_EXTENT,
  type CanonicalPropertyGroup,
} from './property-grouping.js';
import { createDefaultMapFilters } from './map-filters.js';
import {
  getDefaultPropertyTilePyramidSlot,
  getPropertyTilePyramidMaxZoom,
  publishListingUpdatedPyramidTile,
} from './property-tile-pyramid.js';

export type ListingUpdateTile = { z: number; x: number; y: number };
type Executor = Pick<DbTransaction, 'execute'>;
const PROPERTY_BATCH_LIMIT = 5_000;
const LEASE_SECONDS = 180;
const BUILD_BUDGET_MS = 120_000;

export interface ListingTileServingState {
  requestedRevision: string;
  publishedRevision: string;
  publishedVersionId: string | null;
  pendingFingerprint: string;
}

export interface ListingTileUpdateClaim extends ListingUpdateTile {
  versionId: string;
  revision: string;
  leaseToken: string;
}

/** Invert the grouping engine's buffered tile bounds, including wrapped edges. */
export function computeListingAffectedTiles(
  lon: number,
  lat: number,
  maxZoom: number,
): ListingUpdateTile[] {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isInteger(maxZoom) || maxZoom < 0 || maxZoom > 22) {
    throw new Error('Invalid listing tile coordinates or maximum zoom');
  }
  const tiles: ListingUpdateTile[] = [];
  const seen = new Set<string>();
  const buffer = getGroupingBufferUnits();
  for (let z = 0; z <= maxZoom; z += 1) {
    const count = 2 ** z;
    const [worldX, worldY] = lngLatToWorldUnits(lon, Math.max(-85.05112878, Math.min(85.05112878, lat)), z);
    const minX = Math.ceil((worldX - buffer) / PROPERTY_TILE_EXTENT - 1);
    const maxX = Math.floor((worldX + buffer) / PROPERTY_TILE_EXTENT);
    const minY = Math.max(0, Math.ceil((worldY - buffer) / PROPERTY_TILE_EXTENT - 1));
    const maxY = Math.min(count - 1, Math.floor((worldY + buffer) / PROPERTY_TILE_EXTENT));
    for (let unwrappedX = minX; unwrappedX <= maxX; unwrappedX += 1) {
      const x = ((unwrappedX % count) + count) % count;
      for (let y = minY; y <= maxY; y += 1) {
        const key = `${z}/${x}/${y}`;
        if (!seen.has(key)) {
          seen.add(key);
          tiles.push({ z, x, y });
        }
      }
    }
  }
  return tiles;
}

function coarseTile(tile: ListingUpdateTile, maxZoom: number): ListingUpdateTile {
  if (tile.z <= maxZoom) return tile;
  const scale = 2 ** (tile.z - maxZoom);
  return { z: maxZoom, x: Math.floor(tile.x / scale), y: Math.floor(tile.y / scale) };
}

/** Buffered geometry also catches dirty property events not yet expanded to tiles. */
function affectedGeometryPredicate(tile: ListingUpdateTile) {
  const count = 2 ** tile.z;
  const ratio = getGroupingBufferUnits() / PROPERTY_TILE_EXTENT;
  const minLon = (tile.x-ratio)/count*360-180;
  const maxLon = (tile.x+1+ratio)/count*360-180;
  const latitude = (y: number) => 180/Math.PI*Math.atan(Math.sinh(Math.PI*(1-2*y/count)));
  const minLat = latitude(Math.min(count,tile.y+1+ratio));
  const maxLat = latitude(Math.max(0,tile.y-ratio));
  const intervals = [[Math.max(-180,minLon),Math.min(180,maxLon)]];
  if (minLon < -180) intervals.push([Math.max(-180,minLon+360),180]);
  if (maxLon > 180) intervals.push([-180,Math.min(180,maxLon-360)]);
  return sql`(${sql.join(intervals.map(([west,east]) => sql`
    p.geometry && ST_MakeEnvelope(${west},${minLat},${east},${maxLat},4326)
  `),sql` OR `)})`;
}

/** A coarse parent revision invalidates dynamic higher-zoom/filter caches too. */
export async function getListingTileServingState(
  tile: ListingUpdateTile,
  maxZoom = getPropertyTilePyramidMaxZoom(),
): Promise<ListingTileServingState> {
  const parent = coarseTile(tile, maxZoom);
  const rows = await db.execute<{
    requested_revision: string;
    published_revision: string;
    published_version_id: string | null;
    pending_fingerprint: string;
  }>(sql`
    SELECT
      GREATEST(COALESCE(q.requested_revision,0),COALESCE(pending.revision,0))::text AS requested_revision,
      COALESCE(q.published_revision,0)::text AS published_revision,
      q.published_version_id::text,
      COALESCE(pending.fingerprint,'none') AS pending_fingerprint
    FROM (SELECT 1) one
    LEFT JOIN listing_tile_updates q ON q.z=${parent.z} AND q.x=${parent.x} AND q.y=${parent.y}
    CROSS JOIN LATERAL (
      SELECT max(p.revision) AS revision,
        md5(string_agg(p.property_id::text || ':' || p.revision::text,',' ORDER BY p.property_id)) AS fingerprint
      FROM listing_tile_property_updates p WHERE ${affectedGeometryPredicate(parent)}
    ) pending
  `);
  const row = Array.from(rows)[0];
  return {
    requestedRevision: row?.requested_revision ?? '0',
    publishedRevision: row?.published_revision ?? '0',
    publishedVersionId: row?.published_version_id ?? null,
    pendingFingerprint: row?.pending_fingerprint ?? 'none',
  };
}

export function listingTileCacheRevision(state: ListingTileServingState): string {
  return `${state.requestedRevision}:${state.publishedRevision}:${state.publishedVersionId ?? 'base'}:${state.pendingFingerprint}`;
}

export async function getListingTileCacheRevision(tile: ListingUpdateTile, maxZoom?: number): Promise<string> {
  return listingTileCacheRevision(await getListingTileServingState(tile, maxZoom));
}

async function readCurrentVersion(tx: Executor) {
  const slot = getDefaultPropertyTilePyramidSlot();
  const rows = await tx.execute<{ version_id: string; max_zoom: number }>(sql`
    SELECT current_version_id::text AS version_id,max_zoom
    FROM property_tile_pyramid_current
    WHERE coverage_id=${slot.coverageId} AND filter_signature=${slot.filterSignature}
      AND pyramid_kind=${slot.pyramidKind}::property_tile_pyramid_kind AND max_zoom=${slot.maxZoom}
    FOR SHARE
  `);
  return Array.from(rows)[0] ?? null;
}

/** Short transaction: coalesce thousands of property events before any tile build. */
export async function expandListingTilePropertyUpdates(limit = PROPERTY_BATCH_LIMIT): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > PROPERTY_BATCH_LIMIT) throw new Error('Invalid property expansion limit');
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtextextended('listing_tile_publication',0))`);
    const current = await readCurrentVersion(tx);
    if (!current) return 0;
    const rows = Array.from(await tx.execute<{
      property_id: string; lon: number; lat: number; requested_at: string; requested_at_us: string;
    }>(sql`
      SELECT property_id::text,ST_X(geometry) AS lon,ST_Y(geometry) AS lat,
        requested_at::text,(extract(epoch FROM requested_at)*1000000)::bigint::text AS requested_at_us
      FROM listing_tile_property_updates ORDER BY revision LIMIT ${limit} FOR UPDATE SKIP LOCKED
    `));
    if (rows.length === 0) return 0;
    // Sequence allocation happens before the source transaction commits. Give
    // each expansion its own newer generation so late commits with a smaller
    // source revision cannot disappear behind an already-published tile.
    const generation = Array.from(await tx.execute<{ revision: string }>(sql`
      SELECT nextval('listing_tile_update_revision_seq')::text AS revision
    `))[0].revision;
    const tiles = new Map<string, ListingUpdateTile & { requestedAt: string; requestedAtUs: bigint }>();
    for (const row of rows) {
      for (const tile of computeListingAffectedTiles(Number(row.lon), Number(row.lat), current.max_zoom)) {
        const key = `${tile.z}/${tile.x}/${tile.y}`;
        const previous = tiles.get(key);
        const requestedAtUs = BigInt(row.requested_at_us);
        if (!previous || requestedAtUs < previous.requestedAtUs) {
          tiles.set(key, { ...tile, requestedAt: row.requested_at, requestedAtUs });
        }
      }
    }
    const pendingTiles = Array.from(tiles.values());
    // Keep well below PostgreSQL's bind-parameter limit, including broad
    // multi-country batches and installations using a higher precompute zoom.
    for (let offset = 0; offset < pendingTiles.length; offset += 2_000) {
      await tx.execute(sql`
      INSERT INTO listing_tile_updates(z,x,y,requested_revision,requested_at)
      VALUES ${sql.join(pendingTiles.slice(offset,offset+2_000).map((tile) => sql`(
        ${tile.z},${tile.x},${tile.y},${generation}::bigint,${tile.requestedAt}::timestamptz
      )`), sql`, `)}
      ON CONFLICT(z,x,y) DO UPDATE SET
        requested_revision=GREATEST(listing_tile_updates.requested_revision,EXCLUDED.requested_revision),
        requested_at=CASE WHEN listing_tile_updates.requested_revision>listing_tile_updates.published_revision
          THEN LEAST(listing_tile_updates.requested_at,EXCLUDED.requested_at) ELSE EXCLUDED.requested_at END,
        next_attempt_at=LEAST(listing_tile_updates.next_attempt_at,clock_timestamp())
      `);
    }
    await tx.execute(sql`
      DELETE FROM listing_tile_property_updates
      WHERE property_id IN (${sql.join(rows.map((row) => sql`${row.property_id}::uuid`),sql`, `)})
    `);
    return rows.length;
  });
}

export async function claimListingTileUpdate(): Promise<ListingTileUpdateClaim | null> {
  return db.transaction(async (tx) => {
    const current = await readCurrentVersion(tx);
    if (!current) return null;
    const token = randomUUID();
    const rows = await tx.execute<{ z: number; x: number; y: number; revision: string }>(sql`
      WITH due AS (
        SELECT z,x,y FROM listing_tile_updates
        WHERE z <= ${current.max_zoom}
          AND (requested_revision>published_revision OR published_version_id IS DISTINCT FROM ${current.version_id}::uuid)
          AND next_attempt_at <= clock_timestamp()
          AND (lease_until IS NULL OR lease_until <= clock_timestamp())
        ORDER BY requested_at,z DESC,x,y LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      UPDATE listing_tile_updates q SET
        lease_token=${token}::uuid,lease_until=clock_timestamp()+${LEASE_SECONDS}*interval '1 second',
        claimed_revision=q.requested_revision,attempt_count=q.attempt_count+1
      FROM due WHERE (q.z,q.x,q.y)=(due.z,due.x,due.y)
      RETURNING q.z,q.x,q.y,q.claimed_revision::text AS revision
    `);
    const row = Array.from(rows)[0];
    return row ? { ...row, versionId: current.version_id, leaseToken: token } : null;
  });
}

/** Fence current promotion, expired/replaced leases, and unexpanded newer evidence. */
export async function publishClaimedListingTileUpdate(
  claim: ListingTileUpdateClaim,
  groups: CanonicalPropertyGroup[],
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('listing_tile_publication',0))`);
    const current = await readCurrentVersion(tx);
    if (!current || current.version_id !== claim.versionId) return false;
    const owned = Array.from(await tx.execute<{ revision: string }>(sql`
      SELECT requested_revision::text AS revision FROM listing_tile_updates
      WHERE z=${claim.z} AND x=${claim.x} AND y=${claim.y}
        AND lease_token=${claim.leaseToken}::uuid AND claimed_revision=${claim.revision}::bigint
        AND lease_until>clock_timestamp()
      FOR UPDATE
    `));
    if (owned[0]?.revision !== claim.revision) return false;
    const pending = Array.from(await tx.execute<{ pending: boolean }>(sql`
      SELECT EXISTS(SELECT 1 FROM listing_tile_property_updates p
        WHERE ${affectedGeometryPredicate(claim)}) AS pending
    `));
    if (pending[0]?.pending) return false;
    await publishListingUpdatedPyramidTile(tx, {
      versionId: claim.versionId,
      tile: claim,
      groups,
      revision: claim.revision,
    });
    // Sample only a completed dirty generation. Moving an unchanged overlay to
    // a newly promoted base version is not another listing publication. Keep
    // this in the same transaction as nodes, MVT, and the durable queue fence.
    await tx.execute(sql`
      WITH completed AS MATERIALIZED (
        SELECT requested_at,clock_timestamp() AS published_at
        FROM listing_tile_updates
        WHERE z=${claim.z} AND x=${claim.x} AND y=${claim.y}
          AND requested_revision>published_revision
      ), sample AS (
        SELECT requested_at,published_at,
          GREATEST(0,floor(extract(epoch FROM (published_at-requested_at))*1000))::bigint AS latency_ms
        FROM completed
      )
      INSERT INTO listing_tile_publication_metrics
        (bucket_start,publication_count,total_latency_ms,max_latency_ms,last_latency_ms,last_published_at,last_requested_at)
      SELECT date_trunc('minute',published_at),1,latency_ms,latency_ms,latency_ms,published_at,requested_at FROM sample
      ON CONFLICT(bucket_start) DO UPDATE SET
        publication_count=listing_tile_publication_metrics.publication_count+EXCLUDED.publication_count,
        total_latency_ms=listing_tile_publication_metrics.total_latency_ms+EXCLUDED.total_latency_ms,
        max_latency_ms=GREATEST(listing_tile_publication_metrics.max_latency_ms,EXCLUDED.max_latency_ms),
        last_latency_ms=EXCLUDED.last_latency_ms,
        last_published_at=EXCLUDED.last_published_at,
        last_requested_at=EXCLUDED.last_requested_at
    `);
    await tx.execute(sql`
      UPDATE listing_tile_updates SET
        published_revision=${claim.revision}::bigint,published_version_id=${claim.versionId}::uuid,
        published_at=clock_timestamp(),lease_token=NULL,lease_until=NULL,claimed_revision=NULL,
        next_attempt_at=clock_timestamp(),last_error=NULL
      WHERE z=${claim.z} AND x=${claim.x} AND y=${claim.y}
        AND lease_token=${claim.leaseToken}::uuid
    `);
    return true;
  });
}

async function releaseClaim(claim: ListingTileUpdateClaim, error?: unknown): Promise<void> {
  await db.execute(sql`
    UPDATE listing_tile_updates SET lease_token=NULL,lease_until=NULL,claimed_revision=NULL,
      next_attempt_at=clock_timestamp()+${error ? 30 : 0}*interval '1 second',
      last_error=${error ? String(error).slice(0,2000) : null}
    WHERE z=${claim.z} AND x=${claim.x} AND y=${claim.y} AND lease_token=${claim.leaseToken}::uuid
  `);
}

export async function runListingTileUpdates(limit = 50): Promise<{
  expandedProperties: number; publishedTiles: number; fencedTiles: number; failedTiles: number;
}> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Listing tile limit must be between 1 and 500');
  const result = { expandedProperties: 0, publishedTiles: 0, fencedTiles: 0, failedTiles: 0 };
  const startedAt = Date.now();
  for (let batch = 0; batch < 20; batch += 1) {
    const expanded = await expandListingTilePropertyUpdates();
    result.expandedProperties += expanded;
    if (expanded < PROPERTY_BATCH_LIMIT) break;
  }
  for (let processed = 0; processed < limit && Date.now()-startedAt < 60_000; processed += 1) {
    const claim = await claimListingTileUpdate();
    if (!claim) break;
    try {
      const groups = await buildCanonicalGroupsForTileUncached(claim, createDefaultMapFilters(), {
        liveListingUpdates: true,
        clusterPropertyIdRetention: 'complete',
        runtimeBudgetMs: BUILD_BUDGET_MS,
        statementTimeoutMs: BUILD_BUDGET_MS,
      });
      if (await publishClaimedListingTileUpdate(claim, groups)) result.publishedTiles += 1;
      else {
        result.fencedTiles += 1;
        await releaseClaim(claim);
      }
    } catch (error) {
      result.failedTiles += 1;
      await releaseClaim(claim,error);
    }
  }
  return result;
}
