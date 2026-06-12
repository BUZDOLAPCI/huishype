import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { config } from '../src/config.js';
import { closeConnection, db } from '../src/db/index.js';
import {
  DEFAULT_PROPERTY_TILE_PYRAMID_COVERAGE_ID,
  getDefaultPropertyTilePyramidSlot,
  type PropertyTilePyramidSlot,
} from '../src/services/property-tile-pyramid.js';
import {
  PLAYWRIGHT_PROPERTY_TILE_FIXTURE_BOUNDS as FIXTURE_BOUNDS,
  PLAYWRIGHT_PROPERTY_TILE_FIXTURE_CLUSTER as FIXTURE_CLUSTER,
  PLAYWRIGHT_PROPERTY_TILE_PYRAMID_COVERAGE_ID,
  PLAYWRIGHT_PROPERTY_TILE_PYRAMID_FIXTURE_ALLOW_ENV,
} from '../../../scripts/playwright/property-tile-fixture.mjs';

type TileCoord = { z: number; x: number; y: number };

const FIXTURE_LOCK_KEY = 'playwright-property-tile-pyramid-fixture';
const FIXTURE_ALLOW_ENV = PLAYWRIGHT_PROPERTY_TILE_PYRAMID_FIXTURE_ALLOW_ENV;
const FIXTURE_ALLOW_PUBLIC_SLOT_ENV =
  'PLAYWRIGHT_I_UNDERSTAND_THIS_WILL_OVERWRITE_PUBLIC_PROPERTY_TILE_PYRAMID_SLOT';
const FIXTURE_ALLOW_PUBLIC_SLOT_VALUE = 'overwrite-public-property-tile-pyramid-slot';
const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const LOCAL_DATABASE_ADDRESSES = new Set(['127.0.0.1', '::1']);
const PRIVATE_IPV4_ADDRESS_PATTERNS = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];
const PRODUCTION_DATABASE_NAME_PATTERN = /\b(prod|production|coolify)\b/i;

type DatabaseTarget = {
  databaseUrl: string;
  host: string;
  port: string;
  databaseName: string;
};

type ConnectedDatabaseTarget = {
  database_name: string;
  server_addr: string | null;
  server_port: number;
  user_name: string;
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
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom
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

function parseDatabaseTarget(databaseUrl: string): DatabaseTarget {
  let parsed: URL;

  try {
    parsed = new URL(databaseUrl);
  } catch (error) {
    throw new Error(
      `Refusing to create Playwright pyramid fixture: DATABASE_URL is not a valid URL (${error instanceof Error ? error.message : String(error)})`
    );
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error(
      `Refusing to create Playwright pyramid fixture: DATABASE_URL must use postgres/postgresql, received ${parsed.protocol}`
    );
  }

  return {
    databaseUrl,
    host: parsed.hostname,
    port: parsed.port || '5432',
    databaseName: decodeURIComponent(parsed.pathname.replace(/^\/+/, '')),
  };
}

function assertFixtureDatabaseUrlIsSafe(): DatabaseTarget {
  if (process.env[FIXTURE_ALLOW_ENV] !== '1') {
    throw new Error(
      `Refusing to create Playwright pyramid fixture: ${FIXTURE_ALLOW_ENV}=1 is required and should only be set by a verified local Playwright wrapper.`
    );
  }

  if (config.env !== 'development' && config.env !== 'test') {
    throw new Error(
      `Refusing to create Playwright pyramid fixture: NODE_ENV=${config.env} is not allowed.`
    );
  }

  const target = parseDatabaseTarget(config.database.url);
  const normalizedHost = target.host.toLowerCase();

  if (!LOCAL_DATABASE_HOSTS.has(normalizedHost)) {
    throw new Error(
      `Refusing to create Playwright pyramid fixture: database host "${target.host}" is not local.`
    );
  }

  if (!target.databaseName) {
    throw new Error(
      'Refusing to create Playwright pyramid fixture: DATABASE_URL does not name a database.'
    );
  }

  if (PRODUCTION_DATABASE_NAME_PATTERN.test(target.databaseName)) {
    throw new Error(
      `Refusing to create Playwright pyramid fixture: database name "${target.databaseName}" looks production-like.`
    );
  }

  return target;
}

async function assertConnectedDatabaseIsSafe(target: DatabaseTarget): Promise<void> {
  const rows = Array.from(
    await db.execute<ConnectedDatabaseTarget>(sql`
      SELECT
        current_database()::text AS database_name,
        inet_server_addr()::text AS server_addr,
        inet_server_port()::integer AS server_port,
        current_user::text AS user_name
    `)
  );
  const connected = rows[0];

  if (!connected) {
    throw new Error('Refusing to create Playwright pyramid fixture: unable to inspect database.');
  }

  if (connected.database_name !== target.databaseName) {
    throw new Error(
      `Refusing to create Playwright pyramid fixture: connected database "${connected.database_name}" does not match DATABASE_URL database "${target.databaseName}".`
    );
  }

  const serverAddress = connected.server_addr?.replace(/\/\d+$/, '') ?? null;
  const isAllowedServerAddress =
    serverAddress == null ||
    LOCAL_DATABASE_ADDRESSES.has(serverAddress) ||
    PRIVATE_IPV4_ADDRESS_PATTERNS.some((pattern) => pattern.test(serverAddress));

  if (!isAllowedServerAddress) {
    throw new Error(
      `Refusing to create Playwright pyramid fixture: connected server address "${connected.server_addr}" is not local or private Docker/network address.`
    );
  }

  console.log(
    `Verified local Playwright pyramid fixture database ${connected.database_name} at ${target.host}:${target.port} as ${connected.user_name}.`
  );
}

function assertFixtureCoverageSlotIsSafe(slot: PropertyTilePyramidSlot): void {
  if (slot.coverageId === PLAYWRIGHT_PROPERTY_TILE_PYRAMID_COVERAGE_ID) {
    return;
  }

  const hasScaryOverride =
    process.env[FIXTURE_ALLOW_PUBLIC_SLOT_ENV] === FIXTURE_ALLOW_PUBLIC_SLOT_VALUE;
  if (slot.coverageId === DEFAULT_PROPERTY_TILE_PYRAMID_COVERAGE_ID && !hasScaryOverride) {
    throw new Error(
      `Refusing to create Playwright pyramid fixture in the public "${DEFAULT_PROPERTY_TILE_PYRAMID_COVERAGE_ID}" coverage slot. Set PROPERTY_TILE_PYRAMID_COVERAGE_ID=${PLAYWRIGHT_PROPERTY_TILE_PYRAMID_COVERAGE_ID}; only set ${FIXTURE_ALLOW_PUBLIC_SLOT_ENV}=${FIXTURE_ALLOW_PUBLIC_SLOT_VALUE} if you intentionally want to overwrite the public tile pyramid slot.`
    );
  }
}

async function selectFixturePreviewPropertyIds(): Promise<[string, string]> {
  const rows = Array.from(
    await db.execute<{ id: string }>(sql`
      SELECT id::text
      FROM properties
      WHERE country_code = 'NL'
        AND city = 'Eindhoven'
        AND status = 'active'
        AND geometry IS NOT NULL
        AND ST_Intersects(
          geometry,
          ST_MakeEnvelope(
            ${FIXTURE_BOUNDS.minLon},
            ${FIXTURE_BOUNDS.minLat},
            ${FIXTURE_BOUNDS.maxLon},
            ${FIXTURE_BOUNDS.maxLat},
            4326
          )
        )
      ORDER BY geometry <-> ST_SetSRID(
        ST_MakePoint(${FIXTURE_CLUSTER.lon}, ${FIXTURE_CLUSTER.lat}),
        4326
      )
      LIMIT 2
    `)
  );

  if (rows.length < 2) {
    throw new Error(
      `Refusing to create Playwright pyramid fixture: expected at least two seeded Eindhoven properties for real preview hydration, found ${rows.length}. Run the local test seed first.`
    );
  }

  return [rows[0].id, rows[1].id];
}

async function main(): Promise<void> {
  const databaseTarget = assertFixtureDatabaseUrlIsSafe();
  await assertConnectedDatabaseIsSafe(databaseTarget);

  const slot = getDefaultPropertyTilePyramidSlot();
  assertFixtureCoverageSlotIsSafe(slot);
  if (slot.maxZoom > 12) {
    throw new Error(
      `Refusing to create Playwright pyramid fixture for max zoom ${slot.maxZoom}; set PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM=10 for E2E.`
    );
  }

  const versionId = randomUUID();
  const candidateSnapshotId = randomUUID();
  const unique = randomUUID();
  const sourceWatermarkHash = `playwright-watermarks-${unique}`;
  const tiles = coveredTiles(slot.maxZoom);
  const previewPropertyIds = await selectFixturePreviewPropertyIds();
  const representativePropertyId = previewPropertyIds[0];
  const clusterTile = {
    z: slot.maxZoom,
    ...lonLatToTile(FIXTURE_CLUSTER.lon, FIXTURE_CLUSTER.lat, slot.maxZoom),
  };
  if (tiles.length === 0) {
    throw new Error('Playwright pyramid fixture coverage produced no tiles');
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${FIXTURE_LOCK_KEY})::bigint)`);

    await tx.execute(sql`
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
        grouping_fact_row_count,
        build_finished_at
      )
      VALUES (
        ${candidateSnapshotId}::uuid,
        ${slot.coverageId},
        ${slot.filterSignature},
        ${slot.pyramidKind}::property_tile_pyramid_kind,
        ${sourceWatermarkHash},
        ${sourceWatermarkHash},
        ${JSON.stringify({ sources: [{ source: 'playwright-runtime' }] })}::jsonb,
        'ready',
        ${previewPropertyIds.length},
        ${previewPropertyIds.length},
        0,
        ${previewPropertyIds.length},
        now()
      )
    `);

    await tx.execute(sql`
      SELECT ensure_property_tile_candidate_source_partitions(${candidateSnapshotId}::uuid)
    `);

    await tx.execute(sql`
      INSERT INTO property_tile_grouping_facts (
        snapshot_id,
        property_id,
        geometry,
        official_valuation,
        country_code,
        city,
        region,
        postal_code,
        street,
        house_number,
        house_number_addition,
        official_valuation_year,
        asking_price,
        sale_effective_price,
        has_active_listing,
        has_completed_listing,
        market_state,
        updated_at
      )
      SELECT
        ${candidateSnapshotId}::uuid,
        p.id,
        p.geometry,
        p.official_valuation,
        p.country_code,
        p.city,
        p.region,
        p.postal_code,
        p.street,
        p.house_number,
        p.house_number_addition,
        p.official_valuation_year,
        p.official_valuation,
        p.official_valuation,
        TRUE,
        FALSE,
        'for-sale',
        now()
      FROM properties p
      WHERE p.id IN (${sql.join(
        previewPropertyIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )})
      ON CONFLICT (snapshot_id, property_id) DO NOTHING
    `);

    await tx.execute(sql`
      INSERT INTO property_tile_candidate_source_current (
        coverage_id,
        filter_signature,
        pyramid_kind,
        snapshot_id,
        promoted_at,
        updated_at
      )
      VALUES (
        ${slot.coverageId},
        ${slot.filterSignature},
        ${slot.pyramidKind}::property_tile_pyramid_kind,
        ${candidateSnapshotId}::uuid,
        now(),
        now()
      )
      ON CONFLICT (coverage_id, filter_signature, pyramid_kind)
      DO UPDATE SET
        snapshot_id = EXCLUDED.snapshot_id,
        promoted_at = EXCLUDED.promoted_at,
        updated_at = now()
    `);

    await tx.execute(sql`
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
        ${versionId}::uuid,
        ${slot.coverageId},
        ${slot.filterSignature},
        ${slot.maxZoom},
        ${slot.pyramidKind}::property_tile_pyramid_kind,
        ${`playwright-config-${unique}`},
        ${`playwright-inputs-${unique}`},
        ${sourceWatermarkHash},
        ${JSON.stringify({ sources: [{ source: 'playwright-runtime' }] })}::jsonb,
        ${candidateSnapshotId}::uuid,
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

    await tx.execute(sql`
      SELECT ensure_property_tile_pyramid_version_partitions(${versionId}::uuid)
    `);

    await tx.execute(sql`
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
            ${
              tile.z === clusterTile.z && tile.x === clusterTile.x && tile.y === clusterTile.y
                ? 'valid_nodes'
                : 'valid_empty'
            }::property_tile_pyramid_tile_status,
            'validated'::property_tile_pyramid_tile_validation_status,
            ${tile.z === clusterTile.z && tile.x === clusterTile.x && tile.y === clusterTile.y ? 1 : 0},
            ${`playwright-empty-${versionId}-${tile.z}-${tile.x}-${tile.y}`},
            now()
          )`
        ),
        sql`, `
      )}
    `);

    await tx.execute(sql`
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
        ${representativePropertyId}::uuid,
        ARRAY[${sql.join(
          previewPropertyIds.map((id) => sql`${id}::uuid`),
          sql`, `
        )}]::uuid[],
        ${previewPropertyIds.length},
        ${JSON.stringify({
          primaryPropertyId: representativePropertyId,
          pointCount: FIXTURE_CLUSTER.pointCount,
          propertyIdsOmitted: true,
          previewPropertyIds,
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
      await tx.execute<{ current_version_id: string | null }>(sql`
        SELECT current_version_id::text
        FROM property_tile_pyramid_current
        WHERE coverage_id = ${slot.coverageId}
          AND filter_signature = ${slot.filterSignature}
          AND max_zoom = ${slot.maxZoom}
          AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
        LIMIT 1
      `)
    );
    const txRows = Array.from(
      await tx.execute<{ txid: string }>(sql`
        SELECT txid_current()::bigint::text AS txid
      `)
    );
    const txid = txRows[0]?.txid;
    if (!txid) {
      throw new Error('Failed to acquire transaction id for Playwright pyramid fixture');
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
        ${versionId}::uuid,
        ${slot.coverageId},
        ${slot.filterSignature},
        ${slot.maxZoom},
        ${slot.pyramidKind}::property_tile_pyramid_kind,
        'playwright-runtime',
        'playwright runtime fixture'
      )
      ON CONFLICT (txid, version_id) DO NOTHING
    `);

    await tx.execute(sql`
      SELECT set_config(
        'huishype.property_tile_pyramid_promotion_version_id',
        ${versionId},
        true
      )
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
        ${slot.coverageId},
        ${slot.filterSignature},
        ${slot.maxZoom},
        ${slot.pyramidKind}::property_tile_pyramid_kind,
        ${versionId}::uuid,
        ${previousRows[0]?.current_version_id ?? null}::uuid,
        now(),
        'playwright runtime fixture',
        now()
      )
      ON CONFLICT (coverage_id, filter_signature, max_zoom, pyramid_kind)
      DO UPDATE SET
        current_version_id = EXCLUDED.current_version_id,
        previous_version_id = property_tile_pyramid_current.current_version_id,
        current_promoted_at = EXCLUDED.current_promoted_at,
        promotion_reason = EXCLUDED.promotion_reason,
        updated_at = now()
    `);

    await tx.execute(sql`
      UPDATE property_tile_pyramid_versions
      SET
        status = 'promoted',
        promoted_at = COALESCE(promoted_at, now()),
        build_finished_at = COALESCE(build_finished_at, now()),
        updated_at = now()
      WHERE id = ${versionId}::uuid
    `);
  });
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
