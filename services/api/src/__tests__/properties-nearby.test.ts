import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { buildApp } from '../app.js';
import { db } from '../db/index.js';
import type { FastifyInstance } from 'fastify';
import { PROPERTY_PREVIEW_MEMBER_LIMIT } from '@huishype/shared';
import {
  ADDRESS_INTERACTION_MIN_ZOOM,
  PROPERTY_TILE_EXTENT,
  buildCanonicalGroupsForTile,
  lngLatToWorldUnits,
  resolveNearbyGroupedFeature,
} from '../services/property-grouping.js';
import {
  getDefaultPropertyTilePyramidSlot,
  getPropertyTilePyramidMaxZoom,
} from '../services/property-tile-pyramid.js';

type TestPyramidCoverage = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  maxZoom?: number;
};

async function withTemporaryEnv(
  overrides: Record<string, string | undefined>,
  run: () => Promise<void>
) {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(overrides)) {
    previous.set(key, process.env[key]);
    const next = overrides[key];
    if (next == null) {
      delete process.env[key];
    } else {
      process.env[key] = next;
    }
  }

  try {
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

const HERMETIC_NEARBY_COUNTRY_CODE = 'ZZ';

async function withHermeticNearbyActiveCluster(
  run: (fixture: { lon: number; lat: number; propertyIds: string[] }) => Promise<void>,
  coordinates: { lon: number; lat: number } = { lon: -29.812345, lat: 0.123456 }
) {
  const propertyIds = [crypto.randomUUID(), crypto.randomUUID()];
  const listingIds = [crypto.randomUUID(), crypto.randomUUID()];
  const viewIds = [crypto.randomUUID(), crypto.randomUUID()];
  const { lon, lat } = coordinates;

  await db.execute(sql`
    INSERT INTO properties (
      id,
      country_code,
      street,
      house_number,
      city,
      postal_code,
      status,
      geometry
    )
    VALUES
      (
        ${propertyIds[0]},
        ${HERMETIC_NEARBY_COUNTRY_CODE},
        'Nearby Fixture Street',
        1,
        'Fixture City',
        '1000AA',
        'active',
        ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)
      ),
      (
        ${propertyIds[1]},
        ${HERMETIC_NEARBY_COUNTRY_CODE},
        'Nearby Fixture Street',
        2,
        'Fixture City',
        '1000AA',
        'active',
        ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)
      )
  `);

  await db.execute(sql`
    INSERT INTO canonical_listings (
      id,
      property_id,
      source_name,
      canonical_url,
      display_url,
      status,
      status_source,
      verification_state,
      origin_summary,
      asking_price,
      price_type,
      first_seen_at,
      last_seen_at,
      last_reconciled_at,
      created_at,
      updated_at
    )
    VALUES
      (
        ${listingIds[0]},
        ${propertyIds[0]},
        'funda',
        ${`https://example.com/nearby-fixture-${listingIds[0]}`},
        ${`https://example.com/nearby-fixture-${listingIds[0]}`},
        'active',
        'mirror',
        'validated',
        'mirror',
        350000,
        'sale',
        NOW() - INTERVAL '2 days',
        NOW() - INTERVAL '2 days',
        NOW() - INTERVAL '2 days',
        NOW() - INTERVAL '2 days',
        NOW() - INTERVAL '2 days'
      ),
      (
        ${listingIds[1]},
        ${propertyIds[1]},
        'funda',
        ${`https://example.com/nearby-fixture-${listingIds[1]}`},
        ${`https://example.com/nearby-fixture-${listingIds[1]}`},
        'active',
        'mirror',
        'validated',
        'mirror',
        360000,
        'sale',
        NOW() - INTERVAL '1 day',
        NOW() - INTERVAL '1 day',
        NOW() - INTERVAL '1 day',
        NOW() - INTERVAL '1 day',
        NOW() - INTERVAL '1 day'
      )
  `);

  await db.execute(sql`
    INSERT INTO property_views (id, property_id, user_id, session_id, viewed_at)
    VALUES
      (${viewIds[0]}, ${propertyIds[0]}, NULL, ${`nearby-fixture-session-${viewIds[0]}`}, NOW()),
      (${viewIds[1]}, ${propertyIds[1]}, NULL, ${`nearby-fixture-session-${viewIds[1]}`}, NOW())
  `);

  try {
    await run({ lon, lat, propertyIds });
  } finally {
    await db.execute(sql`DELETE FROM property_views WHERE id IN (${viewIds[0]}, ${viewIds[1]})`);
    await db.execute(
      sql`DELETE FROM properties WHERE id IN (${propertyIds[0]}, ${propertyIds[1]})`
    );
  }
}

async function withHermeticNearbyListingOnlyProperty(
  run: (fixture: { lon: number; lat: number; propertyId: string }) => Promise<void>
) {
  const propertyId = crypto.randomUUID();
  const listingId = crypto.randomUUID();
  const lon = -29.812345;
  const lat = 0.123456;

  await db.execute(sql`
    INSERT INTO properties (
      id,
      country_code,
      street,
      house_number,
      city,
      postal_code,
      status,
      geometry
    )
    VALUES (
      ${propertyId},
      ${HERMETIC_NEARBY_COUNTRY_CODE},
      'Listing Visibility Street',
      1,
      'Fixture City',
      '1000AB',
      'active',
      ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)
    )
  `);

  await db.execute(sql`
    INSERT INTO canonical_listings (
      id,
      property_id,
      source_name,
      canonical_url,
      display_url,
      status,
      status_source,
      verification_state,
      origin_summary,
      asking_price,
      price_type,
      first_seen_at,
      last_seen_at,
      last_reconciled_at,
      created_at,
      updated_at
    )
    VALUES (
      ${listingId},
      ${propertyId},
      'funda',
      ${`https://example.com/listing-only-${listingId}`},
      ${`https://example.com/listing-only-${listingId}`},
      'active',
      'mirror',
      'validated',
      'mirror',
      350000,
      'sale',
      NOW() - INTERVAL '1 day',
      NOW() - INTERVAL '1 day',
      NOW() - INTERVAL '1 day',
      NOW() - INTERVAL '1 day',
      NOW() - INTERVAL '1 day'
    )
  `);

  try {
    await run({ lon, lat, propertyId });
  } finally {
    await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
  }
}

async function restoreCurrentPointerMetadata(input: {
  slot: ReturnType<typeof getDefaultPropertyTilePyramidSlot>;
  currentVersionId: string;
  previousVersionId: string | null;
  currentPromotedAt: Date;
  promotionReason: string | null;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const txRows = await tx.execute<{ txid: string }>(sql`
      SELECT txid_current()::bigint::text AS txid
    `);
    const txid = Array.from(txRows)[0]?.txid;
    if (!txid) {
      throw new Error('Failed to acquire transaction id for current pointer metadata restore');
    }

    await tx.execute(sql`
      INSERT INTO property_tile_pyramid_promotion_intents (
        txid,
        version_id,
        coverage_id,
        filter_signature,
        max_zoom,
        pyramid_kind,
        actor,
        reason
      )
      VALUES (
        ${txid}::bigint,
        ${input.currentVersionId}::uuid,
        ${input.slot.coverageId},
        ${input.slot.filterSignature},
        ${input.slot.maxZoom},
        ${input.slot.pyramidKind}::property_tile_pyramid_kind,
        'jest',
        'restore nearby test current pointer metadata'
      )
      ON CONFLICT (txid, version_id) DO NOTHING
    `);

    await tx.execute(sql`
      INSERT INTO property_tile_pyramid_current (
        coverage_id,
        filter_signature,
        max_zoom,
        pyramid_kind,
        current_version_id,
        previous_version_id,
        current_promoted_at,
        promotion_reason,
        updated_at
      )
      VALUES (
        ${input.slot.coverageId},
        ${input.slot.filterSignature},
        ${input.slot.maxZoom},
        ${input.slot.pyramidKind}::property_tile_pyramid_kind,
        ${input.currentVersionId}::uuid,
        NULL,
        ${input.currentPromotedAt},
        ${input.promotionReason},
        NOW()
      )
      ON CONFLICT (coverage_id, filter_signature, max_zoom, pyramid_kind)
      DO UPDATE SET
        current_version_id = EXCLUDED.current_version_id,
        previous_version_id = property_tile_pyramid_current.current_version_id,
        current_promoted_at = EXCLUDED.current_promoted_at,
        promotion_reason = EXCLUDED.promotion_reason,
        updated_at = NOW()
    `);

    await tx.execute(sql`
      UPDATE property_tile_pyramid_current
      SET
        previous_version_id = ${input.previousVersionId}::uuid,
        current_promoted_at = ${input.currentPromotedAt},
        promotion_reason = ${input.promotionReason},
        updated_at = NOW()
      WHERE coverage_id = ${input.slot.coverageId}
        AND filter_signature = ${input.slot.filterSignature}
        AND max_zoom = ${input.slot.maxZoom}
        AND pyramid_kind = ${input.slot.pyramidKind}::property_tile_pyramid_kind
    `);
  });
}

async function withHermeticCurrentPyramidNode(
  run: (fixture: {
    lon: number;
    lat: number;
    nodeId: string;
    versionId: string;
    propertyIds: string[];
  }) => Promise<void>,
  options: {
    includeTileManifest?: boolean;
    lon?: number;
    lat?: number;
    tile?: { z: number; x: number; y: number };
    manifestTile?: { z: number; x: number; y: number };
    additionalManifestTiles?: Array<{ z: number; x: number; y: number }>;
    tileStatus?: 'valid_nodes' | 'valid_encoded';
    coverage?: TestPyramidCoverage;
  } = {}
) {
  const includeTileManifest = options.includeTileManifest ?? true;
  const tileStatus = options.tileStatus ?? 'valid_nodes';
  const slot = getDefaultPropertyTilePyramidSlot();
  const versionId = crypto.randomUUID();
  const candidateSnapshotId = crypto.randomUUID();
  const nodeId = `nearby-fractional-${versionId}`;
  const propertyIds = [crypto.randomUUID(), crypto.randomUUID()];
  const lon = options.lon ?? 5.812845;
  const lat = options.lat ?? 52.123956;
  const tile = options.tile ?? tileForCoordinate(lon, lat, getPropertyTilePyramidMaxZoom());
  const manifestTile = options.manifestTile ?? tile;
  const insertedManifestTile = manifestTile;
  const payload =
    tileStatus === 'valid_encoded' ? Buffer.from(`nearby-encoded-${versionId}`) : null;
  const sameTile = (
    left: { z: number; x: number; y: number },
    right: { z: number; x: number; y: number }
  ) => left.z === right.z && left.x === right.x && left.y === right.y;
  const coveredLeafTiles = [
    insertedManifestTile,
    ...(options.additionalManifestTiles ?? []),
  ].filter(
    (candidate, index, tiles) =>
      tiles.findIndex((tileCandidate) => sameTile(tileCandidate, candidate)) === index
  );
  const manifestTiles = expandPyramidCoverageManifestTiles(coveredLeafTiles);
  const manifestRows = sql.join(
    manifestTiles.map((manifest, index) => {
      const isPrimaryManifest = sameTile(manifest, insertedManifestTile);
      const isNodeOwnerManifest = sameTile(manifest, tile);
      const manifestPayload =
        isPrimaryManifest && includeTileManifest && isNodeOwnerManifest ? payload : null;
      const status = isPrimaryManifest && isNodeOwnerManifest ? tileStatus : 'valid_empty';
      return sql`(
        ${versionId},
        ${manifest.z},
        ${manifest.x},
        ${manifest.y},
        ${status}::property_tile_pyramid_tile_status,
        'validated',
        ${isNodeOwnerManifest ? 1 : 0},
        ${`nearby-fractional-etag-${versionId}-${index}`},
        ${manifestPayload},
        ${manifestPayload ? crypto.createHash('sha256').update(manifestPayload).digest('hex') : null},
        ${manifestPayload ? sql`NOW()` : null},
        NOW()
      )`;
    }),
    sql`, `
  );
  const coverage = options.coverage ?? coverageFromTiles(coveredLeafTiles, slot.maxZoom);
  const coverageMaxZoom = coverage.maxZoom ?? slot.maxZoom;
  const coverageSnapshotJson = {
    coverageId: slot.coverageId,
    boundsSource: 'jest',
    bounds: {
      minLon: coverage.minLon,
      minLat: coverage.minLat,
      maxLon: coverage.maxLon,
      maxLat: coverage.maxLat,
    },
    minZoom: 0,
    maxZoom: coverageMaxZoom,
    filterSignature: slot.filterSignature,
  };
  const previousRows = await db.execute<{
    current_version_id: string;
    previous_version_id: string | null;
    current_promoted_at: Date;
    promotion_reason: string | null;
  }>(sql`
    SELECT current_version_id::text, previous_version_id::text, current_promoted_at, promotion_reason
    FROM property_tile_pyramid_current
    WHERE coverage_id = ${slot.coverageId}
      AND filter_signature = ${slot.filterSignature}
      AND max_zoom = ${slot.maxZoom}
      AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
  `);
  const previousCurrent = Array.from(previousRows)[0] ?? null;
  const sourceWatermarkHash = `nearby-fractional-watermark-${versionId}`;

  await db.execute(sql`
    INSERT INTO property_tile_candidate_source_snapshots (
      id,
      coverage_id,
      filter_signature,
      pyramid_kind,
      source_watermark_hash,
      comparable_source_watermark_hash,
      source_watermarks_json,
      status,
      candidate_row_count,
      fact_row_count,
      social_fact_row_count,
      build_finished_at
    )
    VALUES (
      ${candidateSnapshotId}::uuid,
      ${slot.coverageId},
      ${slot.filterSignature},
      ${slot.pyramidKind}::property_tile_pyramid_kind,
      ${sourceWatermarkHash},
      ${sourceWatermarkHash},
      ${JSON.stringify({ sources: [{ source: 'nearby-fractional-test' }] })}::jsonb,
      'ready',
      0,
      0,
      0,
      NOW()
    )
  `);

  await db.execute(sql`
    INSERT INTO property_tile_pyramid_versions (
      id,
      coverage_id,
      filter_signature,
      max_zoom,
      pyramid_kind,
      config_hash,
      build_inputs_hash,
      source_watermark_hash,
      source_watermarks_json,
      candidate_snapshot_id,
      coverage_snapshot_json,
      status,
      expected_tile_count,
      validated_tile_count,
      validation_summary,
      validated_at
    )
    VALUES (
      ${versionId},
      ${slot.coverageId},
      ${slot.filterSignature},
      ${slot.maxZoom},
      ${slot.pyramidKind}::property_tile_pyramid_kind,
      ${`nearby-fractional-config-${versionId}`},
      ${`nearby-fractional-inputs-${versionId}`},
      ${sourceWatermarkHash},
      ${JSON.stringify({ sources: [{ source: 'nearby-fractional-test' }] })}::jsonb,
      ${candidateSnapshotId}::uuid,
      ${JSON.stringify(coverageSnapshotJson)}::jsonb,
      'validated',
      ${manifestTiles.length},
      ${manifestTiles.length},
      ${JSON.stringify({
        expectedTileCount: manifestTiles.length,
        observedTileCount: manifestTiles.length,
      })}::jsonb,
      NOW()
    )
  `);

  await db.execute(sql`
    SELECT ensure_property_tile_pyramid_version_partitions(${versionId}::uuid)
  `);

  await db.execute(sql`
    INSERT INTO property_tile_pyramid_tiles (
      version_id,
      z,
      x,
      y,
      tile_status,
      validation_status,
      node_count,
      etag,
      payload,
      payload_sha256,
      payload_generated_at,
      validated_at
    )
    VALUES ${manifestRows}
  `);

  await db.execute(sql`
    INSERT INTO property_tile_pyramid_nodes (
      version_id,
      node_id,
      z,
      x,
      y,
      render_lon,
      render_lat,
      render_geometry,
      anchor_world_x,
      anchor_world_y,
      node_class,
      group_kind,
      point_count,
      representative_property_id,
      preview_property_ids,
      preview_count,
      bbox_west,
      bbox_south,
      bbox_east,
      bbox_north
    )
    VALUES (
      ${versionId},
      ${nodeId},
      ${tile.z},
      ${tile.x},
      ${tile.y},
      ${lon},
      ${lat},
      ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326),
      0,
      0,
      'active',
      'cluster',
      ${propertyIds.length},
      ${propertyIds[0]}::uuid,
      ARRAY[${propertyIds[0]}::uuid, ${propertyIds[1]}::uuid],
      ${propertyIds.length},
      ${lon - 0.0001},
      ${lat - 0.0001},
      ${lon + 0.0001},
      ${lat + 0.0001}
    )
  `);

  await db.execute(sql`
    SELECT promote_property_tile_pyramid_version(
      ${versionId}::uuid,
      ${previousCurrent?.current_version_id ?? null}::uuid,
      'nearby fractional zoom test',
      'jest'
    )
  `);

  if (!includeTileManifest) {
    await db.execute(sql`
      UPDATE property_tile_pyramid_tiles
      SET
        tile_status = 'pending'::property_tile_pyramid_tile_status,
        validation_status = 'pending'::property_tile_pyramid_tile_validation_status,
        payload = NULL,
        payload_sha256 = NULL,
        payload_generated_at = NULL
      WHERE version_id = ${versionId}::uuid
        AND z = ${tile.z}
        AND x = ${tile.x}
        AND y = ${tile.y}
    `);
  }

  try {
    await run({ lon, lat, nodeId, versionId, propertyIds });
  } finally {
    if (previousCurrent) {
      await restoreCurrentPointerMetadata({
        slot,
        currentVersionId: previousCurrent.current_version_id,
        previousVersionId: previousCurrent.previous_version_id,
        currentPromotedAt: previousCurrent.current_promoted_at,
        promotionReason: previousCurrent.promotion_reason,
      });
    } else {
      await db.execute(sql`
        DELETE FROM property_tile_pyramid_current
        WHERE coverage_id = ${slot.coverageId}
          AND filter_signature = ${slot.filterSignature}
          AND max_zoom = ${slot.maxZoom}
          AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
      `);
    }

    await db.execute(sql`
      SELECT drop_property_tile_pyramid_version_partitions(${versionId}::uuid)
    `);
    await db.execute(sql`DELETE FROM property_tile_pyramid_versions WHERE id = ${versionId}`);
    await db.execute(sql`
      DELETE FROM property_tile_candidate_source_snapshots
      WHERE id = ${candidateSnapshotId}::uuid
    `);
  }
}

async function withTemporarilyNoCurrentPyramid(
  run: (fixture: { slot: ReturnType<typeof getDefaultPropertyTilePyramidSlot> }) => Promise<void>
) {
  const slot = getDefaultPropertyTilePyramidSlot();
  const previousRows = await db.execute<{
    current_version_id: string;
    previous_version_id: string | null;
    current_promoted_at: Date;
    promotion_reason: string | null;
  }>(sql`
    SELECT current_version_id::text, previous_version_id::text, current_promoted_at, promotion_reason
    FROM property_tile_pyramid_current
    WHERE coverage_id = ${slot.coverageId}
      AND filter_signature = ${slot.filterSignature}
      AND max_zoom = ${slot.maxZoom}
      AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
  `);
  const previousCurrent = Array.from(previousRows)[0] ?? null;

  await db.execute(sql`
    DELETE FROM property_tile_pyramid_current
    WHERE coverage_id = ${slot.coverageId}
      AND filter_signature = ${slot.filterSignature}
      AND max_zoom = ${slot.maxZoom}
      AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
  `);

  try {
    await run({ slot });
  } finally {
    if (previousCurrent) {
      await restoreCurrentPointerMetadata({
        slot,
        currentVersionId: previousCurrent.current_version_id,
        previousVersionId: previousCurrent.previous_version_id,
        currentPromotedAt: previousCurrent.current_promoted_at,
        promotionReason: previousCurrent.promotion_reason,
      });
    }
  }
}

function tileForCoordinate(lon: number, lat: number, zoom: number) {
  const [worldX, worldY] = lngLatToWorldUnits(lon, lat, zoom);
  return {
    z: zoom,
    x: Math.floor(worldX / PROPERTY_TILE_EXTENT),
    y: Math.floor(worldY / PROPERTY_TILE_EXTENT),
  };
}

function expandPyramidCoverageManifestTiles(leafTiles: Array<{ z: number; x: number; y: number }>) {
  const tiles: Array<{ z: number; x: number; y: number }> = [];
  const seen = new Set<string>();

  for (const leaf of leafTiles) {
    for (let z = 0; z <= leaf.z; z += 1) {
      const scale = 2 ** (leaf.z - z);
      const tile = {
        z,
        x: Math.floor(leaf.x / scale),
        y: Math.floor(leaf.y / scale),
      };
      const key = `${tile.z}:${tile.x}:${tile.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tiles.push(tile);
    }
  }

  return tiles;
}

function worldUnitsToLngLat(worldX: number, worldY: number, zoom: number): [number, number] {
  const scale = Math.pow(2, zoom) * PROPERTY_TILE_EXTENT;
  const lon = (worldX / scale) * 360 - 180;
  const mercatorY = Math.PI * (1 - (2 * worldY) / scale);
  const lat = (Math.atan(Math.sinh(mercatorY)) * 180) / Math.PI;
  return [lon, lat];
}

function coverageFromTiles(
  tiles: Array<{ z: number; x: number; y: number }>,
  maxZoom: number
): TestPyramidCoverage {
  const tileZoom = tiles[0]?.z ?? maxZoom;
  const minX = Math.min(...tiles.map((tile) => tile.x));
  const maxX = Math.max(...tiles.map((tile) => tile.x));
  const minY = Math.min(...tiles.map((tile) => tile.y));
  const maxY = Math.max(...tiles.map((tile) => tile.y));
  const epsilon = 0.000001;
  const [minLon, maxLat] = worldUnitsToLngLat(
    minX * PROPERTY_TILE_EXTENT + epsilon,
    minY * PROPERTY_TILE_EXTENT + epsilon,
    tileZoom
  );
  const [maxLon, minLat] = worldUnitsToLngLat(
    (maxX + 1) * PROPERTY_TILE_EXTENT - epsilon,
    (maxY + 1) * PROPERTY_TILE_EXTENT - epsilon,
    tileZoom
  );

  return {
    minLon,
    minLat,
    maxLon,
    maxLat,
    maxZoom,
  };
}

/**
 * Integration tests for GET /properties/nearby
 *
 * These tests run against the real PostGIS database with seeded Eindhoven data.
 * The database must be running and seeded before running these tests.
 */
describe('GET /properties/nearby', () => {
  jest.setTimeout(30000);
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('route registration', () => {
    it('should register the /properties/nearby route', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416',
      });
      // Should not be 404 (route not found)
      expect(response.statusCode).not.toBe(404);
    });
  });

  describe('parameter validation', () => {
    it('should return 400 when lon is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lat=51.4416',
      });
      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when lat is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697',
      });
      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when lon is out of range', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=200&lat=51.4416',
      });
      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when lat is out of range', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=100',
      });
      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when pyramidVersionId is malformed', async () => {
      const response = await app.inject({
        method: 'GET',
        url:
          '/properties/nearby?lon=5.4697&lat=51.4416&zoom=10' +
          '&pyramidVersionId=not-a-uuid' +
          '&pyramidNodeId=test-node',
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when pyramidVersionId is provided without pyramidNodeId', async () => {
      const response = await app.inject({
        method: 'GET',
        url:
          '/properties/nearby?lon=5.4697&lat=51.4416&zoom=10' +
          '&pyramidVersionId=00000000-0000-4000-a000-000000000001',
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when pyramidNodeId is provided without pyramidVersionId', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=10&pyramidNodeId=test-node',
      });

      expect(response.statusCode).toBe(400);
    });

    it('accepts pyramid node identity as an exact lookup pair', async () => {
      await withTemporarilyNoCurrentPyramid(async () => {
        const response = await app.inject({
          method: 'GET',
          url:
            '/properties/nearby?lon=5.4697&lat=51.4416&zoom=10' +
            '&pyramidVersionId=00000000-0000-4000-a000-000000000001' +
            '&pyramidNodeId=test-node',
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toBeNull();
        expect(response.headers['x-huishype-nearby-status']).toMatch(/^pyramid-/);
      });
    });
  });

  describe('response shape', () => {
    it('should return a canonical grouped result or null', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=17',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body !== null) {
        expect(body).toHaveProperty('nodeClass');
        expect(body).toHaveProperty('groupKind');
        expect(body).toHaveProperty('primaryPropertyId');
        expect(body).toHaveProperty('pointCount');
        expect(Array.isArray(body.propertyIds)).toBe(true);
        expect(Array.isArray(body.previewPropertyIds)).toBe(true);
        expect(typeof body.membershipComplete).toBe('boolean');
        expect(['complete', 'partial']).toContain(body.readStateCoverage);
        expect(body).toHaveProperty('pyramidVersionId');
        expect(body).toHaveProperty('pyramidNodeId');
        expect(Array.isArray(body.coordinate)).toBe(true);
        expect(body.coordinate).toHaveLength(2);
        expect(body).not.toHaveProperty('node_class');
        expect(body).not.toHaveProperty('group_kind');
        expect(body).not.toHaveProperty('primary_property_id');
        expect(body).not.toHaveProperty('point_count');
        expect(body).not.toHaveProperty('property_ids');
        expect(body).not.toHaveProperty('preview_property_ids');
      }
    });

    it('should return grouped fields with the expected types', async () => {
      // Use Eindhoven center — seeded data should have properties nearby
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=14',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body !== null) {
        expect(typeof body.primaryPropertyId).toBe('string');
        expect(typeof body.pointCount).toBe('number');
        expect(typeof body.activeListingCount).toBe('number');
        expect(typeof body.socialCount).toBe('number');
        expect(typeof body.recentSocialCount).toBe('number');
        expect(typeof body.socialScoreTotal).toBe('number');
        expect(typeof body.socialScoreMax).toBe('number');
        expect(typeof body.recentSocialScoreTotal).toBe('number');
        expect(typeof body.distanceMeters).toBe('number');
        expect(body.membershipComplete).toBe(true);
        expect(body.readStateCoverage).toBe('complete');

        if (body.groupKind === 'single') {
          expect(typeof body.address).toBe('string');
          expect(typeof body.city).toBe('string');
          expect(typeof body.hasActiveListing).toBe('boolean');
          expect(typeof body.marketState).toBe('string');
        } else {
          expect(body.bbox).not.toBeNull();
          expect(body).not.toHaveProperty('address');
          expect(body).not.toHaveProperty('city');
          expect(body).not.toHaveProperty('hasActiveListing');
          expect(body).not.toHaveProperty('marketState');
        }
      }
    });

    it('should include grouped coordinates as a [lon, lat] tuple', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=14',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body !== null) {
        expect(Array.isArray(body.coordinate)).toBe(true);
        expect(body.coordinate).toHaveLength(2);
        expect(typeof body.coordinate[0]).toBe('number');
        expect(typeof body.coordinate[1]).toBe('number');
      }
    });
  });

  describe('zoom-to-radius filtering', () => {
    it('should resolve a grouped feature at high zoom without assuming singles', async () => {
      const highZoomResp = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=19',
      });

      const lowZoomResp = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=13',
      });

      expect(highZoomResp.statusCode).toBe(200);
      expect(lowZoomResp.statusCode).toBe(200);

      const highZoomBody = JSON.parse(highZoomResp.body);
      const lowZoomBody = JSON.parse(lowZoomResp.body);

      if (highZoomBody !== null) {
        expect(['single', 'cluster']).toContain(highZoomBody.groupKind);
        expect(highZoomBody.pointCount).toBeGreaterThanOrEqual(1);
      }

      if (lowZoomBody !== null && highZoomBody !== null) {
        expect(lowZoomBody.distanceMeters).toBeGreaterThanOrEqual(0);
        expect(highZoomBody.distanceMeters).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('edge cases', () => {
    it('should return null for a location in the ocean', async () => {
      // Coordinates in the middle of the North Sea
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=3.0&lat=55.0&zoom=17',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toBeNull();
    });

    it('should use default zoom of 17 when not specified', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body === null || typeof body === 'object').toBe(true);
    });
  });

  describe('grouped nearby fallback', () => {
    it('uses the pyramid path instead of dynamic fallback for default covered low-zoom nearby', async () => {
      await withHermeticNearbyActiveCluster(
        async ({ lon, lat }) => {
          const response = await app.inject({
            method: 'GET',
            url: `/properties/nearby?lon=${lon}&lat=${lat}&zoom=10`,
          });

          expect(response.statusCode).toBe(200);
          const nearbyStatus = response.headers['x-huishype-nearby-status'];
          expect(nearbyStatus).toMatch(/^pyramid-/);

          const body = JSON.parse(response.body);
          if (body !== null) {
            expect(nearbyStatus).toBe('pyramid-promoted');
            expect(body.pyramidVersionId).toEqual(expect.any(String));
            expect(body.pyramidVersionId.length).toBeGreaterThan(0);
            expect(body.pyramidNodeId).toEqual(expect.any(String));
            expect(body.pyramidNodeId.length).toBeGreaterThan(0);
            expect(body.groupKind).toBe('cluster');
          }
        },
        { lon: 5.812345, lat: 52.123456 }
      );
    });

    it('requests a durable pyramid build when covered low-zoom nearby has no current version', async () => {
      await withTemporarilyNoCurrentPyramid(async ({ slot }) => {
        const beforeRows = await db.execute<{ id: string }>(sql`
          SELECT id::text
          FROM property_tile_pyramid_versions
          WHERE coverage_id = ${slot.coverageId}
            AND filter_signature = ${slot.filterSignature}
            AND max_zoom = ${slot.maxZoom}
            AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
        `);
        const beforeIds = new Set(Array.from(beforeRows).map((row) => row.id));

        const response = await app.inject({
          method: 'GET',
          url: '/properties/nearby?lon=5.812345&lat=52.123456&zoom=10',
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toBeNull();
        expect(response.headers['x-huishype-nearby-status']).toBe('pyramid-unavailable');

        const afterRows = await db.execute<{ id: string; request_reason: string | null }>(sql`
          SELECT id::text, request_reason
          FROM property_tile_pyramid_versions
          WHERE coverage_id = ${slot.coverageId}
            AND filter_signature = ${slot.filterSignature}
            AND max_zoom = ${slot.maxZoom}
            AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
            AND request_reason = 'nearby-fallback-miss'
        `);
        const buildRequests = Array.from(afterRows);

        expect(buildRequests.length).toBeGreaterThan(0);

        const createdIds = buildRequests.map((row) => row.id).filter((id) => !beforeIds.has(id));
        for (const id of createdIds) {
          await db.execute(sql`
            DELETE FROM property_tile_pyramid_versions
            WHERE id = ${id}
          `);
        }
      });
    });

    it('uses the integer pyramid serving zoom for fractional default low-zoom nearby', async () => {
      await withHermeticCurrentPyramidNode(async ({ lon, lat, nodeId, versionId, propertyIds }) => {
        const response = await app.inject({
          method: 'GET',
          url: `/properties/nearby?lon=${lon}&lat=${lat}&zoom=10.75`,
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['x-huishype-nearby-status']).toBe('pyramid-promoted');
        expect(response.headers['x-huishype-pyramid-version']).toBe(versionId);

        const body = JSON.parse(response.body);
        expect(body).not.toBeNull();
        expect(body.pyramidNodeId).toBe(nodeId);
        expect(body.pyramidVersionId).toBe(versionId);
        expect(body.groupKind).toBe('cluster');
        expect(body.previewPropertyIds).toEqual(propertyIds);
      });
    });

    it('uses promoted version coverage for current nearby when env coverage no longer contains the point', async () => {
      await withHermeticCurrentPyramidNode(async ({ lon, lat, nodeId, versionId, propertyIds }) => {
        await withTemporaryEnv(
          {
            PROPERTY_TILE_PRECOMPUTE_MIN_LON: '0',
            PROPERTY_TILE_PRECOMPUTE_MIN_LAT: '0',
            PROPERTY_TILE_PRECOMPUTE_MAX_LON: '1',
            PROPERTY_TILE_PRECOMPUTE_MAX_LAT: '1',
          },
          async () => {
            const response = await app.inject({
              method: 'GET',
              url: `/properties/nearby?lon=${lon}&lat=${lat}&zoom=10.75`,
            });

            expect(response.statusCode).toBe(200);
            expect(response.headers['x-huishype-nearby-status']).toBe('pyramid-promoted');
            expect(response.headers['x-huishype-pyramid-version']).toBe(versionId);

            const body = JSON.parse(response.body);
            expect(body).not.toBeNull();
            expect(body.pyramidNodeId).toBe(nodeId);
            expect(body.pyramidVersionId).toBe(versionId);
            expect(body.previewPropertyIds).toEqual(propertyIds);
          }
        );
      });
    });

    it('uses valid encoded tile manifests for promoted point nearby nodes', async () => {
      await withHermeticCurrentPyramidNode(
        async ({ lon, lat, nodeId, versionId, propertyIds }) => {
          const response = await app.inject({
            method: 'GET',
            url: `/properties/nearby?lon=${lon}&lat=${lat}&zoom=10.75`,
          });

          expect(response.statusCode).toBe(200);
          expect(response.headers['x-huishype-nearby-status']).toBe('pyramid-promoted');

          const body = JSON.parse(response.body);
          expect(body).not.toBeNull();
          expect(body.pyramidNodeId).toBe(nodeId);
          expect(body.pyramidVersionId).toBe(versionId);
          expect(body.previewPropertyIds).toEqual(propertyIds);
        },
        { tileStatus: 'valid_encoded' }
      );
    });

    it('uses valid encoded tile manifests for exact pyramid node lookup', async () => {
      await withHermeticCurrentPyramidNode(
        async ({ lon, lat, nodeId, versionId, propertyIds }) => {
          const response = await app.inject({
            method: 'GET',
            url:
              `/properties/nearby?lon=${lon}&lat=${lat}&zoom=10.75` +
              `&pyramidVersionId=${versionId}` +
              `&pyramidNodeId=${encodeURIComponent(nodeId)}`,
          });

          expect(response.statusCode).toBe(200);
          expect(response.headers['x-huishype-nearby-status']).toBeUndefined();

          const body = JSON.parse(response.body);
          expect(body).not.toBeNull();
          expect(body.pyramidNodeId).toBe(nodeId);
          expect(body.pyramidVersionId).toBe(versionId);
          expect(body.propertyIds).toEqual([]);
          expect(body.previewPropertyIds).toEqual(propertyIds);
          expect(body.membershipComplete).toBe(false);
          expect(body.readStateCoverage).toBe('partial');
        },
        { tileStatus: 'valid_encoded' }
      );
    });

    it('hydrates promoted single pyramid nearby previews from the live property valuation cache', async () => {
      await withHermeticCurrentPyramidNode(async ({ lon, lat, nodeId, versionId, propertyIds }) => {
        await db.execute(sql`
          INSERT INTO properties (
            id,
            country_code,
            street,
            house_number,
            city,
            postal_code,
            status,
            geometry
          )
          VALUES (
            ${propertyIds[0]},
            'NL',
            'Nearby Fixture Street',
            1,
            'Fixture City',
            '1000AA',
            'active',
            ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)
          )
        `);

        await db.execute(sql`
          UPDATE properties
          SET
            official_valuation = 455000,
            official_valuation_year = 2024,
            official_valuation_verified = true
          WHERE id = ${propertyIds[0]}
        `);

        await db.execute(sql`
          UPDATE property_tile_pyramid_nodes
          SET
            group_kind = 'single'::property_tile_pyramid_group_kind,
            point_count = 1,
            preview_property_ids = ARRAY[${propertyIds[0]}::uuid],
            preview_count = 1,
            address = 'Nearby Fixture Street 1',
            city = 'Fixture City',
            has_active_listing = false,
            market_state = 'not-listed'
          WHERE version_id = ${versionId}::uuid
            AND node_id = ${nodeId}
        `);

        const response = await app.inject({
          method: 'GET',
          url:
            `/properties/nearby?lon=${lon}&lat=${lat}&zoom=10.75` +
            `&pyramidVersionId=${versionId}` +
            `&pyramidNodeId=${encodeURIComponent(nodeId)}`,
        });

        expect(response.statusCode).toBe(200);

        const body = JSON.parse(response.body);
        expect(body).toMatchObject({
          groupKind: 'single',
          countryCode: 'NL',
          officialValuation: 455000,
          officialValuationYear: 2024,
          officialValuationSourceFetch: {
            source: 'woz',
            expectedValuationYear: 2025,
          },
        });
      });
    });

    it('resolves exact current pyramid nodes outside the nearby tap radius', async () => {
      await withHermeticCurrentPyramidNode(async ({ lon, lat, nodeId, versionId, propertyIds }) => {
        const response = await app.inject({
          method: 'GET',
          url:
            `/properties/nearby?lon=${lon + 1}&lat=${lat + 1}&zoom=10.75` +
            `&pyramidVersionId=${versionId}` +
            `&pyramidNodeId=${encodeURIComponent(nodeId)}`,
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['x-huishype-nearby-status']).toBeUndefined();

        const body = JSON.parse(response.body);
        expect(body).not.toBeNull();
        expect(body.pyramidNodeId).toBe(nodeId);
        expect(body.pyramidVersionId).toBe(versionId);
        expect(body.previewPropertyIds).toEqual(propertyIds);
        expect(body.distanceMeters).toBeGreaterThan(1000);
      });
    });

    it('reports stale exact pyramid node identity without coordinate fallback', async () => {
      await withHermeticCurrentPyramidNode(async ({ lon, lat, nodeId, versionId }) => {
        const staleVersionId = crypto.randomUUID();
        const response = await app.inject({
          method: 'GET',
          url:
            `/properties/nearby?lon=${lon}&lat=${lat}&zoom=10.75` +
            `&pyramidVersionId=${staleVersionId}` +
            `&pyramidNodeId=${encodeURIComponent(nodeId)}`,
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toBeNull();
        expect(response.headers['x-huishype-nearby-status']).toBe('pyramid-stale');
        expect(response.headers['x-huishype-pyramid-version']).toBe(versionId);
      });
    });

    it('reports exact pyramid node lookup without a current version as unavailable', async () => {
      await withTemporarilyNoCurrentPyramid(async () => {
        const response = await app.inject({
          method: 'GET',
          url:
            '/properties/nearby?lon=5.812345&lat=52.123456&zoom=10.75' +
            `&pyramidVersionId=${crypto.randomUUID()}` +
            '&pyramidNodeId=missing-current-node',
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toBeNull();
        expect(response.headers['x-huishype-nearby-status']).toBe('pyramid-unavailable');
      });
    });

    it('finds promoted point nearby nodes in the tap tile neighborhood', async () => {
      const zoom = getPropertyTilePyramidMaxZoom();
      const baseTile = tileForCoordinate(5.812345, 52.123456, zoom);
      const tapWorldX = (baseTile.x + 1) * PROPERTY_TILE_EXTENT - 16;
      const nodeWorldX = (baseTile.x + 1) * PROPERTY_TILE_EXTENT + 16;
      const worldY = (baseTile.y + 0.5) * PROPERTY_TILE_EXTENT;
      const [tapLon, tapLat] = worldUnitsToLngLat(tapWorldX, worldY, zoom);
      const [nodeLon, nodeLat] = worldUnitsToLngLat(nodeWorldX, worldY, zoom);
      const neighborTile = { z: zoom, x: baseTile.x + 1, y: baseTile.y };

      await withHermeticCurrentPyramidNode(
        async ({ nodeId, versionId, propertyIds }) => {
          const response = await app.inject({
            method: 'GET',
            url: `/properties/nearby?lon=${tapLon}&lat=${tapLat}&zoom=${zoom}`,
          });

          expect(response.statusCode).toBe(200);
          expect(response.headers['x-huishype-nearby-status']).toBe('pyramid-promoted');

          const body = JSON.parse(response.body);
          expect(body).not.toBeNull();
          expect(body.pyramidNodeId).toBe(nodeId);
          expect(body.pyramidVersionId).toBe(versionId);
          expect(body.previewPropertyIds).toEqual(propertyIds);
        },
        { lon: nodeLon, lat: nodeLat, tile: neighborTile, additionalManifestTiles: [baseTile] }
      );
    });

    it('does not expose point nearby nodes when only a different owner tile manifest is serveable', async () => {
      const zoom = getPropertyTilePyramidMaxZoom();
      const baseTile = tileForCoordinate(5.812345, 52.123456, zoom);
      const tapWorldX = (baseTile.x + 1) * PROPERTY_TILE_EXTENT - 16;
      const nodeWorldX = (baseTile.x + 1) * PROPERTY_TILE_EXTENT + 16;
      const worldY = (baseTile.y + 0.5) * PROPERTY_TILE_EXTENT;
      const [tapLon, tapLat] = worldUnitsToLngLat(tapWorldX, worldY, zoom);
      const [nodeLon, nodeLat] = worldUnitsToLngLat(nodeWorldX, worldY, zoom);
      const neighborTile = { z: zoom, x: baseTile.x + 1, y: baseTile.y };

      await withHermeticCurrentPyramidNode(
        async () => {
          const response = await app.inject({
            method: 'GET',
            url: `/properties/nearby?lon=${tapLon}&lat=${tapLat}&zoom=${zoom}`,
          });

          expect(response.statusCode).toBe(200);
          expect(JSON.parse(response.body)).toBeNull();
          expect(response.headers['x-huishype-nearby-status']).toBe('pyramid-empty');
        },
        {
          lon: nodeLon,
          lat: nodeLat,
          tile: neighborTile,
          includeTileManifest: false,
          additionalManifestTiles: [baseTile],
        }
      );
    });

    it('requests a rebuild when coordinate pyramid lookup is missing the tap owner manifest', async () => {
      await withHermeticCurrentPyramidNode(
        async ({ lon, lat }) => {
          const response = await app.inject({
            method: 'GET',
            url: `/properties/nearby?lon=${lon}&lat=${lat}&zoom=10.75`,
          });

          expect(response.statusCode).toBe(200);
          expect(JSON.parse(response.body)).toBeNull();
          expect(response.headers['x-huishype-nearby-status']).toBe('pyramid-missing');
        },
        { includeTileManifest: false }
      );
    });

    it('does not expose exact pyramid nodes whose owner tile manifest is not serveable', async () => {
      await withHermeticCurrentPyramidNode(
        async ({ lon, lat, nodeId, versionId }) => {
          const response = await app.inject({
            method: 'GET',
            url:
              `/properties/nearby?lon=${lon}&lat=${lat}&zoom=10.75` +
              `&pyramidVersionId=${versionId}` +
              `&pyramidNodeId=${encodeURIComponent(nodeId)}`,
          });

          expect(response.statusCode).toBe(200);
          expect(JSON.parse(response.body)).toBeNull();
          expect(response.headers['x-huishype-nearby-status']).toBe('pyramid-missing');
        },
        { includeTileManifest: false }
      );
    });

    it('should return a grouped feature in a populated area', async () => {
      await withHermeticNearbyActiveCluster(async ({ lon, lat, propertyIds }) => {
        const response = await app.inject({
          method: 'GET',
          url: `/properties/nearby?lon=${lon}&lat=${lat}&zoom=10&marketState=for-sale`,
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);

        expect(body).not.toBeNull();
        expect(body.nodeClass).toBe('active');
        expect(body.groupKind).toBe('cluster');
        expect(body.pointCount).toBe(propertyIds.length);
        expect(body.propertyIds).toEqual(expect.arrayContaining(propertyIds));
        expect(body.propertyIds).toHaveLength(propertyIds.length);
        expect(body.previewPropertyIds).toEqual(expect.arrayContaining(propertyIds));
        expect(body.previewPropertyIds).toHaveLength(propertyIds.length);
        expect(body.primaryPropertyId).toEqual(expect.any(String));
        expect(Array.isArray(body.coordinate)).toBe(true);
        expect(body.coordinate).toHaveLength(2);
        expect(typeof body.coordinate[0]).toBe('number');
        expect(typeof body.coordinate[1]).toBe('number');
        expect(typeof body.distanceMeters).toBe('number');
        expect(body.bbox).not.toBeNull();
      });
    });

    it('should resolve a grouped feature at high zoom without assuming singles', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=18',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body !== null) {
        expect(['single', 'cluster']).toContain(body.groupKind);
        expect(body.pointCount).toBeGreaterThanOrEqual(1);
        expect(body).toHaveProperty('primaryPropertyId');
        if (body.groupKind === 'single') {
          expect(body).toHaveProperty('address');
          expect(body).toHaveProperty('city');
        }
        expect(body).toHaveProperty('distanceMeters');
        expect(typeof body.distanceMeters).toBe('number');
      }
    });

    it('should return null for a location with no properties', async () => {
      // Coordinates in the middle of the North Sea
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=3.0&lat=55.0&zoom=14',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toBeNull();
    });

    it('should expose the canonical grouped shape when the cluster query param is absent', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=14',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      if (body !== null) {
        expect(body).toHaveProperty('groupKind');
        expect(body).toHaveProperty('pointCount');
      }
    });

    it('keeps nearby resolution aligned with the canonical tile group and preview cap rules', async () => {
      await withHermeticNearbyActiveCluster(async ({ lon, lat }) => {
        const zoom = 20;
        const direct = await resolveNearbyGroupedFeature(lon, lat, zoom);
        expect(direct).not.toBeNull();
        const tileGroup = await buildCanonicalGroupsForTile(direct!.ownerTile);
        const matchingGroup = tileGroup.find(
          (group) => group.primaryPropertyId === direct?.primaryPropertyId
        );

        expect(matchingGroup).toBeDefined();
        expect(direct?.primaryPropertyId).toBe(matchingGroup?.primaryPropertyId);
        expect(direct?.groupKind).toBe(matchingGroup?.groupKind);
        expect(direct?.nodeClass).toBe(matchingGroup?.nodeClass);
        expect(direct?.pointCount).toBe(matchingGroup?.pointCount);
        expect(direct?.previewPropertyIds).toEqual(matchingGroup?.previewPropertyIds);
        expect(direct?.previewPropertyIds).toHaveLength(
          Math.min(direct?.pointCount ?? 0, PROPERTY_PREVIEW_MEMBER_LIMIT)
        );
        expect(direct?.previewPropertyIds).toEqual(
          direct?.propertyIds.slice(0, PROPERTY_PREVIEW_MEMBER_LIMIT)
        );
        expect(direct?.pointCount).toBeGreaterThanOrEqual(direct?.previewPropertyIds.length ?? 0);
      });
    });

    it('does not resolve unlisted inactive singles as nearby results', async () => {
      const propertyId = crypto.randomUUID();
      const lon = 3.15;
      const lat = 55.05;

      await db.execute(sql`
        INSERT INTO properties (
          id,
          country_code,
          street,
          house_number,
          city,
          postal_code,
          status,
          geometry,
          official_valuation,
          year_built,
          floor_area_m2
        )
        VALUES (
          ${propertyId},
          ${HERMETIC_NEARBY_COUNTRY_CODE},
          'Remote Quiet Lane',
          17,
          'Remote City',
          '9999 ZZ',
          'active',
          ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326),
          123456,
          1994,
          101
        )
      `);

      try {
        const response = await app.inject({
          method: 'GET',
          url: `/properties/nearby?lon=${lon}&lat=${lat}&zoom=${ADDRESS_INTERACTION_MIN_ZOOM}`,
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);

        expect(body).toBeNull();
      } finally {
        await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
      }
    });

    it('does not resolve selected-area active properties without listing or social facts', async () => {
      const propertyId = crypto.randomUUID();
      const lon = 3.1525;
      const lat = 55.0525;
      const area = encodeURIComponent(
        `street:${HERMETIC_NEARBY_COUNTRY_CODE}:area-nearby-visibility-street:city=area-nearby-city`
      );

      await db.execute(sql`
        INSERT INTO properties (
          id,
          country_code,
          street,
          house_number,
          city,
          postal_code,
          status,
          geometry,
          official_valuation,
          year_built,
          floor_area_m2
        )
        VALUES (
          ${propertyId},
          ${HERMETIC_NEARBY_COUNTRY_CODE},
          'Area Nearby Visibility Street',
          17,
          'Area Nearby City',
          '9998 ZZ',
          'active',
          ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326),
          234567,
          1994,
          101
        )
      `);

      try {
        const defaultResponse = await app.inject({
          method: 'GET',
          url: `/properties/nearby?lon=${lon}&lat=${lat}&zoom=${ADDRESS_INTERACTION_MIN_ZOOM}`,
        });
        const areaResponse = await app.inject({
          method: 'GET',
          url: `/properties/nearby?lon=${lon}&lat=${lat}&zoom=${ADDRESS_INTERACTION_MIN_ZOOM}&area=${area}`,
        });

        expect(defaultResponse.statusCode).toBe(200);
        expect(JSON.parse(defaultResponse.body)).toBeNull();

        expect(areaResponse.statusCode).toBe(200);
        expect(JSON.parse(areaResponse.body)).toBeNull();
      } finally {
        await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
      }
    });

    it('keeps listing-backed for-sale properties visible at low zoom without an activity filter', async () => {
      await withHermeticNearbyListingOnlyProperty(async ({ lon, lat, propertyId }) => {
        const response = await app.inject({
          method: 'GET',
          url: `/properties/nearby?lon=${lon}&lat=${lat}&zoom=${ADDRESS_INTERACTION_MIN_ZOOM - 1}&marketState=for-sale`,
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);

        expect(body).not.toBeNull();
        expect(body.nodeClass).toBe('active');
        expect(body.groupKind).toBe('single');
        expect(body.primaryPropertyId).toBe(propertyId);
        expect(body.propertyIds).toEqual([propertyId]);
        expect(body.activeListingCount).toBe(1);
        expect(body.socialCount).toBe(0);
        expect(body.recentSocialCount).toBe(0);
        expect(body.socialScoreTotal).toBe(0);
        expect(body.socialScoreMax).toBe(0);
        expect(body.hasActiveListing).toBe(true);
        expect(body.marketState).toBe('for-sale');
        expect(body.askingPrice).toBe(350000);
      });
    });

    it('applies market filters before resolving nearby grouped features', async () => {
      const propertyIds = [crypto.randomUUID(), crypto.randomUUID()];
      const listingIds = [crypto.randomUUID(), crypto.randomUUID()];
      const lon = 6.82;
      const lat = 53.24;

      await db.execute(sql`
        INSERT INTO properties (
          id,
          country_code,
          street,
          house_number,
          city,
          postal_code,
          status,
          geometry
        )
        VALUES
          (
            ${propertyIds[0]},
            'NL',
            'Nearby Filter Street',
            1,
            'Filterdam',
            '9999AB',
            'active',
            ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)
          ),
          (
            ${propertyIds[1]},
            'NL',
            'Nearby Filter Street',
            2,
            'Filterdam',
            '9999AB',
            'active',
            ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)
          )
      `);

      await db.execute(sql`
        INSERT INTO canonical_listings (
          id,
          property_id,
          source_name,
          canonical_url,
          display_url,
          status,
          status_source,
          verification_state,
          origin_summary,
          asking_price,
          price_type,
          first_seen_at,
          last_seen_at,
          last_reconciled_at,
          created_at,
          updated_at
        )
        VALUES
          (
            ${listingIds[0]},
            ${propertyIds[0]},
            'pararius',
            ${`https://example.com/nearby-filter-${listingIds[0]}`},
            ${`https://example.com/nearby-filter-${listingIds[0]}`},
            'active',
            'mirror',
            'validated',
            'mirror',
            1750,
            'rent',
            NOW() - INTERVAL '2 days',
            NOW() - INTERVAL '2 days',
            NOW() - INTERVAL '2 days',
            NOW() - INTERVAL '2 days',
            NOW() - INTERVAL '2 days'
          ),
          (
            ${listingIds[1]},
            ${propertyIds[1]},
            'pararius',
            ${`https://example.com/nearby-filter-${listingIds[1]}`},
            ${`https://example.com/nearby-filter-${listingIds[1]}`},
            'active',
            'mirror',
            'validated',
            'mirror',
            2750,
            'rent',
            NOW() - INTERVAL '1 day',
            NOW() - INTERVAL '1 day',
            NOW() - INTERVAL '1 day',
            NOW() - INTERVAL '1 day',
            NOW() - INTERVAL '1 day'
          )
      `);

      try {
        const response = await app.inject({
          method: 'GET',
          url: `/properties/nearby?lon=${lon}&lat=${lat}&zoom=20&rentPriceTo=2000&marketState=for-rent`,
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);

        expect(body).not.toBeNull();
        expect(body.groupKind).toBe('single');
        expect(body.primaryPropertyId).toBe(propertyIds[0]);
        expect(body.propertyIds).toEqual([propertyIds[0]]);
        expect(body.askingPrice).toBe(1750);
      } finally {
        await db.execute(
          sql`DELETE FROM properties WHERE id IN (${propertyIds[0]}, ${propertyIds[1]})`
        );
      }
    });

    it('should include valid UUIDs in grouped propertyIds', async () => {
      await withHermeticNearbyActiveCluster(async ({ lon, lat, propertyIds }) => {
        const response = await app.inject({
          method: 'GET',
          url: `/properties/nearby?lon=${lon}&lat=${lat}&zoom=10&marketState=for-sale`,
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);

        expect(body).not.toBeNull();
        expect(body.groupKind).toBe('cluster');
        expect(body.propertyIds).toHaveLength(propertyIds.length);
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        for (const id of body.propertyIds) {
          expect(id).toMatch(uuidRegex);
        }
      });
    });
  });

  describe('OpenAPI documentation', () => {
    it('should include /properties/nearby in swagger', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/documentation/json',
      });

      expect(response.statusCode).toBe(200);
      const swagger = JSON.parse(response.body);
      expect(swagger.paths).toHaveProperty('/properties/nearby');
      expect(swagger.paths['/properties/nearby']).toHaveProperty('get');
    });

    it('should document query parameters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/documentation/json',
      });

      expect(response.statusCode).toBe(200);
      const swagger = JSON.parse(response.body);
      const nearbyPath = swagger.paths['/properties/nearby'];
      const params = nearbyPath.get.parameters;
      const paramNames = params.map((p: { name: string }) => p.name);

      expect(paramNames).toContain('lon');
      expect(paramNames).toContain('lat');
      expect(paramNames).toContain('zoom');
      expect(paramNames).toContain('salePriceFrom');
      expect(paramNames).toContain('salePriceTo');
      expect(paramNames).toContain('rentPriceFrom');
      expect(paramNames).toContain('rentPriceTo');
      expect(paramNames).toContain('marketState');
      expect(paramNames).toContain('pyramidVersionId');
      expect(paramNames).toContain('pyramidNodeId');
      expect(paramNames).not.toContain('cluster');
      expect(paramNames).not.toContain('limit');
    });

    it('should document nearby response headers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/documentation/json',
      });

      expect(response.statusCode).toBe(200);
      const swagger = JSON.parse(response.body);
      const headers = swagger.paths['/properties/nearby'].get.responses['200'].headers;

      expect(headers).toHaveProperty('x-huishype-nearby-status');
      expect(headers['x-huishype-nearby-status'].schema.enum).toEqual(
        expect.arrayContaining(['pyramid-promoted', 'pyramid-empty', 'pyramid-stale'])
      );
      expect(headers).toHaveProperty('x-huishype-pyramid-version');
      expect(headers['x-huishype-pyramid-version'].schema.format).toBe('uuid');
    });
  });
});
