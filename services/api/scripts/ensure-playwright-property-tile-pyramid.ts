import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { closeConnection, db } from '../src/db/index.js';
import { getDefaultPropertyTilePyramidSlot } from '../src/services/property-tile-pyramid.js';

type TileCoord = { z: number; x: number; y: number };

const FIXTURE_BOUNDS = {
  minLon: 3.0,
  minLat: 50.6,
  maxLon: 6.4,
  maxLat: 53.8,
};
const FIXTURE_CLUSTER = {
  lon: 5.4697,
  lat: 51.4416,
  nodeId: 'playwright:eindhoven:cluster',
  pointCount: 80,
  representativePropertyId: 'a0000000-0000-4000-a000-00000000e201',
  previewPropertyIds: [
    'a0000000-0000-4000-a000-00000000e201',
    'a0000000-0000-4000-a000-00000000e202',
  ],
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lonToTileX(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

function latToTileY(lat: number, zoom: number): number {
  const clampedLat = clamp(lat, -85.05112878, 85.05112878);
  const latRad = (clampedLat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom,
  );
}

function coveredTiles(maxZoom: number): TileCoord[] {
  const tiles: TileCoord[] = [];
  for (let z = 0; z <= maxZoom; z += 1) {
    const maxCoord = 2 ** z - 1;
    const minX = clamp(lonToTileX(FIXTURE_BOUNDS.minLon, z), 0, maxCoord);
    const maxX = clamp(lonToTileX(FIXTURE_BOUNDS.maxLon, z), 0, maxCoord);
    const minY = clamp(latToTileY(FIXTURE_BOUNDS.maxLat, z), 0, maxCoord);
    const maxY = clamp(latToTileY(FIXTURE_BOUNDS.minLat, z), 0, maxCoord);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

async function main(): Promise<void> {
  const slot = getDefaultPropertyTilePyramidSlot();
  if (slot.maxZoom > 12) {
    throw new Error(
      `Refusing to create Playwright pyramid fixture for max zoom ${slot.maxZoom}; set PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM=10 for E2E.`,
    );
  }

  const versionId = randomUUID();
  const unique = randomUUID();
  const tiles = coveredTiles(slot.maxZoom);
  const clusterTile = {
    z: slot.maxZoom,
    ...lonLatToTile(FIXTURE_CLUSTER.lon, FIXTURE_CLUSTER.lat, slot.maxZoom),
  };
  if (tiles.length === 0) {
    throw new Error('Playwright pyramid fixture coverage produced no tiles');
  }

  await neutralizeTerminalFailures();

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
      coverage_snapshot_json,
      status,
      expected_tile_count,
      validated_tile_count,
      validation_summary,
      validated_at
    )
    VALUES (
      ${versionId}::uuid,
      ${slot.coverageId},
      ${slot.filterSignature},
      ${slot.maxZoom},
      ${slot.pyramidKind}::property_tile_pyramid_kind,
      ${`playwright-config-${unique}`},
      ${`playwright-inputs-${unique}`},
      ${`playwright-watermarks-${unique}`},
      ${JSON.stringify({
        coverageId: slot.coverageId,
        boundsSource: 'playwright',
        bounds: FIXTURE_BOUNDS,
        minZoom: 0,
        maxZoom: slot.maxZoom,
        filterSignature: slot.filterSignature,
      })}::jsonb,
      'validated',
      ${tiles.length},
      ${tiles.length},
      ${JSON.stringify({ expectedTileCount: tiles.length, observedTileCount: tiles.length })}::jsonb,
      now()
    )
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
      validated_at
    )
    VALUES ${sql.join(
      tiles.map(
        (tile) => sql`(
          ${versionId}::uuid,
          ${tile.z},
          ${tile.x},
          ${tile.y},
          ${tile.z === clusterTile.z && tile.x === clusterTile.x && tile.y === clusterTile.y
            ? 'valid_nodes'
            : 'valid_empty'}::property_tile_pyramid_tile_status,
          'validated'::property_tile_pyramid_tile_validation_status,
          ${tile.z === clusterTile.z && tile.x === clusterTile.x && tile.y === clusterTile.y ? 1 : 0},
          ${`playwright-empty-${versionId}-${tile.z}-${tile.x}-${tile.y}`},
          now()
        )`,
      ),
      sql`, `,
    )}
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
      node_summary_json,
      preview_properties_json,
      bbox_west,
      bbox_south,
      bbox_east,
      bbox_north,
      tap_radius_px,
      tap_priority_score
    )
    VALUES (
      ${versionId}::uuid,
      ${FIXTURE_CLUSTER.nodeId},
      ${clusterTile.z},
      ${clusterTile.x},
      ${clusterTile.y},
      ${FIXTURE_CLUSTER.lon},
      ${FIXTURE_CLUSTER.lat},
      ST_SetSRID(ST_MakePoint(${FIXTURE_CLUSTER.lon}, ${FIXTURE_CLUSTER.lat}), 4326),
      0,
      0,
      'active',
      'cluster',
      ${FIXTURE_CLUSTER.pointCount},
      ${FIXTURE_CLUSTER.representativePropertyId}::uuid,
      ARRAY[${sql.join(FIXTURE_CLUSTER.previewPropertyIds.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[],
      ${FIXTURE_CLUSTER.previewPropertyIds.length},
      ${JSON.stringify({
        primaryPropertyId: FIXTURE_CLUSTER.representativePropertyId,
        pointCount: FIXTURE_CLUSTER.pointCount,
        propertyIdsOmitted: true,
      })}::jsonb,
      '[]'::jsonb,
      ${FIXTURE_CLUSTER.lon - 0.0002},
      ${FIXTURE_CLUSTER.lat - 0.0002},
      ${FIXTURE_CLUSTER.lon + 0.0002},
      ${FIXTURE_CLUSTER.lat + 0.0002},
      36,
      0
    )
  `);

  const previousRows = Array.from(
    await db.execute<{ current_version_id: string | null }>(sql`
      SELECT current_version_id::text
      FROM property_tile_pyramid_current
      WHERE coverage_id = ${slot.coverageId}
        AND filter_signature = ${slot.filterSignature}
        AND max_zoom = ${slot.maxZoom}
        AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
      LIMIT 1
    `),
  );

  await db.execute(sql`
    SELECT promote_property_tile_pyramid_version(
      ${versionId}::uuid,
      ${previousRows[0]?.current_version_id ?? null}::uuid,
      'playwright runtime fixture',
      'playwright-runtime'
    )
  `);
}

async function neutralizeTerminalFailures(): Promise<void> {
  await db.execute(sql`
    UPDATE property_tile_pyramid_versions
    SET status = 'superseded', updated_at = now()
    WHERE status = 'failed_terminal'
  `);
}

function lonLatToTile(lon: number, lat: number, zoom: number): { x: number; y: number } {
  return {
    x: lonToTileX(lon, zoom),
    y: latToTileY(lat, zoom),
  };
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeConnection();
  });
