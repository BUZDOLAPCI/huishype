import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  PROPERTY_GHOST_REVEAL_ZOOM,
  PROPERTY_MAP_FOOTPRINTS,
  PROPERTY_PREVIEW_MEMBER_LIMIT,
} from '@huishype/shared/config';
import { db, type DbTransaction } from '../db/index.js';
import { createDefaultMapFilters, getMapFilterSignature } from './map-filters.js';
import {
  buildCanonicalGroupsForTileUncached,
  PROPERTY_TILE_EXTENT,
  type CanonicalPropertyGroup,
} from './property-grouping.js';
import {
  computePropertyTileSnapshotCoordinatesFromCoverage,
  computePropertyTileSnapshotConfigHash,
  getExpectedDefaultPropertyTileSnapshotCoverageDefinition,
} from './property-tile-snapshots.js';
import { ACTIVE_SOCIAL_SCORE_THRESHOLD } from './property-queries.js';

const DEFAULT_MAX_ZOOM = 10;
const DEFAULT_CHUNK_TILE_LIMIT = 128;
const DEFAULT_MEMBER_PAGE_SIZE = 5_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_LEASE_SECONDS = 900;
const DEFAULT_MAX_HEAP_MB = 1_024;
const DEFAULT_MAX_WAL_BYTES_PER_CHUNK = 1_073_741_824;
const PYRAMID_CURRENT_ADVISORY_LOCK = 'property_tile_pyramid_retention';
const PROPERTY_TILE_PYRAMID_MIN_ZOOM = 0;
const PROPERTY_TILE_PYRAMID_MVT_BUFFER = 256;
const PROPERTY_TILE_PYRAMID_MVT_LAYER_NAME = 'properties';
const PROPERTY_TILE_PYRAMID_SINGLE_TAP_RADIUS_PX = 24;
const PROPERTY_TILE_PYRAMID_CLUSTER_TAP_RADIUS_PX = 36;

export const PROPERTY_TILE_PYRAMID_KIND = 'public_default_low_zoom';
export const DEFAULT_PROPERTY_TILE_PYRAMID_COVERAGE_ID = 'public_default_low_zoom';
export const DEFAULT_PROPERTY_TILE_PYRAMID_FILTER_SIGNATURE = 'default';
export const PROPERTY_TILE_PYRAMID_PIPELINE_VERSION = 'property-tile-pyramid:v1';

export type PropertyTilePyramidStatus =
  | 'queued'
  | 'building'
  | 'validating'
  | 'validated'
  | 'promoted'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'superseded';

export type PropertyTilePyramidUnavailableStatus =
  | 'pyramid-unavailable'
  | 'pyramid-missing'
  | 'pyramid-build-active'
  | 'pyramid-build-enqueued'
  | 'pyramid-terminal';

export type PropertyTilePyramidBuildRequestReason =
  | 'tile-miss'
  | 'manifest-missing'
  | 'payload-regeneration-error'
  | 'worker-recovery'
  | 'ingest-batch'
  | 'listing-submit'
  | 'official-valuation'
  | 'source-watermark'
  | 'operator';

export type PropertyTilePyramidSourceWatermarkScope =
  | 'snapshot_watermarks'
  | 'ingest_source'
  | 'listing_source_scope'
  | 'listing_scope_completion'
  | 'listing_candidates'
  | 'listing_facts'
  | 'property_geometry'
  | 'property_status'
  | 'social_inputs'
  | 'official_valuations'
  | 'views_engagement'
  | 'rolling_social_window'
  | 'coverage';

export interface PropertyTilePyramidSlot {
  coverageId: string;
  filterSignature: string;
  maxZoom: number;
  pyramidKind: string;
}

export interface CurrentPropertyTilePyramidVersion extends PropertyTilePyramidSlot {
  versionId: string;
  buildInputsHash: string;
  sourceWatermarkHash: string;
  status: 'promoted';
  promotedAt: string | null;
  degradedAt: string | null;
  degradedReason: string | null;
}

export type PropertyTilePyramidCurrentLookup =
  | { state: 'current'; version: CurrentPropertyTilePyramidVersion }
  | { state: 'none'; tileStatus: PropertyTilePyramidUnavailableStatus; reason: string };

export type PropertyTilePyramidTileLookup =
  | {
      state: 'hit';
      versionId: string;
      payload: Buffer | null;
      statusCode: 200 | 204;
      etag: string;
      nodeCount: number;
      encodedFromNodes: boolean;
    }
  | { state: 'missing'; tileStatus: PropertyTilePyramidUnavailableStatus; reason: string };

export interface PropertyTilePyramidBuildRequest {
  status: 'enqueued' | 'coalesced' | 'backoff' | 'terminal' | 'unavailable';
  versionId?: string;
  queueJobId?: string;
  existingStatus?: PropertyTilePyramidStatus;
  nextRetryAt?: string | null;
  reason?: string;
}

export interface PropertyTilePyramidBuildIdentitySnapshots {
  buildInputsHash: string;
  configHash: string;
  coverageSnapshot: Record<string, unknown>;
  configSnapshot: Record<string, unknown>;
  groupingConstants: Record<string, unknown>;
}

export interface PropertyTilePyramidHealthSummary {
  enabled: boolean;
  status: 'ok' | 'degraded';
  currentVersionId: string | null;
  currentPromotedAt: string | null;
  degradedReason: string | null;
  activeCandidateVersionId: string | null;
  activeCandidateStatus: PropertyTilePyramidStatus | null;
  retryableFailureDueAt: string | null;
  terminalFailureCount: number;
  encodedCoverageRatio: number | null;
  lastSuccessfulPromotionAt: string | null;
  resourceControls: {
    chunkTileLimit: number;
    memberPageSize: number;
    statementTimeoutMs: number;
    leaseSeconds: number;
    maxHeapMb: number;
    maxWalBytesPerChunk: number;
  };
}

export interface PropertyTilePyramidOpsSummary extends PropertyTilePyramidHealthSummary {
  previousVersionId: string | null;
  manifestTileCount: number | null;
  encodedTileCount: number | null;
  nodeCount: number | null;
  memberCount: number | null;
  activeLeaseOwner: string | null;
  activeLeaseAgeSeconds: number | null;
  lastAuditAction: string | null;
  lastAuditReason: string | null;
}

type PropertyTilePyramidWatermarkExecutor =
  | Pick<typeof db, 'execute'>
  | Pick<DbTransaction, 'execute'>;

type PropertyTilePyramidBuildLogger = {
  warn: (bindings: Record<string, unknown>, message: string) => void;
};

function parseNonNegativeIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getPropertyTilePyramidMaxZoom(): number {
  return Math.min(22, parseNonNegativeIntegerEnv('PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM', DEFAULT_MAX_ZOOM));
}

export function getDefaultPropertyTilePyramidSlot(): PropertyTilePyramidSlot {
  return {
    coverageId: process.env.PROPERTY_TILE_PYRAMID_COVERAGE_ID ?? DEFAULT_PROPERTY_TILE_PYRAMID_COVERAGE_ID,
    filterSignature: DEFAULT_PROPERTY_TILE_PYRAMID_FILTER_SIGNATURE,
    maxZoom: getPropertyTilePyramidMaxZoom(),
    pyramidKind: PROPERTY_TILE_PYRAMID_KIND,
  };
}

export function getPropertyTilePyramidResourceControls(): PropertyTilePyramidHealthSummary['resourceControls'] {
  return {
    chunkTileLimit: parsePositiveIntegerEnv(
      'PROPERTY_TILE_PYRAMID_CHUNK_TILE_LIMIT',
      DEFAULT_CHUNK_TILE_LIMIT,
    ),
    memberPageSize: parsePositiveIntegerEnv(
      'PROPERTY_TILE_PYRAMID_MEMBER_PAGE_SIZE',
      DEFAULT_MEMBER_PAGE_SIZE,
    ),
    statementTimeoutMs: parsePositiveIntegerEnv(
      'PROPERTY_TILE_PYRAMID_STATEMENT_TIMEOUT_MS',
      DEFAULT_STATEMENT_TIMEOUT_MS,
    ),
    leaseSeconds: parsePositiveIntegerEnv(
      'PROPERTY_TILE_PYRAMID_LEASE_SECONDS',
      DEFAULT_LEASE_SECONDS,
    ),
    maxHeapMb: parsePositiveIntegerEnv(
      'PROPERTY_TILE_PYRAMID_MAX_HEAP_MB',
      DEFAULT_MAX_HEAP_MB,
    ),
    maxWalBytesPerChunk: parsePositiveIntegerEnv(
      'PROPERTY_TILE_PYRAMID_MAX_WAL_BYTES_PER_CHUNK',
      DEFAULT_MAX_WAL_BYTES_PER_CHUNK,
    ),
  };
}

export function buildPropertyTilePyramidCacheKey(input: {
  versionId: string;
  z: number;
  x: number;
  y: number;
}): string {
  return `pyramid:${input.versionId}:${input.z}/${input.x}/${input.y}`;
}

export function buildPropertyTilePyramidEtag(input: {
  versionId: string;
  z: number;
  x: number;
  y: number;
  payload: Buffer | null;
}): string {
  const hash = createHash('sha1');
  hash.update(input.versionId);
  hash.update(':');
  hash.update(`${input.z}/${input.x}/${input.y}`);
  hash.update(':');
  hash.update(input.payload ?? 'empty');
  return `"pyramid-${hash.digest('hex')}"`;
}

function buildStableSourceWatermarkHash(rows: Array<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }

  if (typeof value === 'bigint') {
    return JSON.stringify(value.toString());
  }

  if (value === undefined) {
    return 'null';
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
}

function stableSha256(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function buildPropertyTilePyramidBuildIdentitySnapshots(
  slot: PropertyTilePyramidSlot,
): PropertyTilePyramidBuildIdentitySnapshots {
  const defaultFilters = createDefaultMapFilters();
  const defaultFilterSignature = getMapFilterSignature(defaultFilters);
  const coverageDefinition = getExpectedDefaultPropertyTileSnapshotCoverageDefinition();
  const bounds = {
    minLon: coverageDefinition.minLon,
    minLat: coverageDefinition.minLat,
    maxLon: coverageDefinition.maxLon,
    maxLat: coverageDefinition.maxLat,
  };
  const countries = [...coverageDefinition.countries].sort();
  const dataSources = [...coverageDefinition.dataSources].sort();
  const resolvedSnapshotConfigHash = computePropertyTileSnapshotConfigHash({
    coverageId: slot.coverageId,
    boundsSource: coverageDefinition.boundsSource,
    maxZoom: slot.maxZoom,
    filterSignature: slot.filterSignature,
    bounds,
    countries,
    dataSources,
  });
  const coverageSnapshot = {
    coverageId: slot.coverageId,
    sourceCoverageDefinitionId: coverageDefinition.coverageId,
    boundsSource: coverageDefinition.boundsSource,
    bounds,
    countries,
    dataSources,
    minZoom: PROPERTY_TILE_PYRAMID_MIN_ZOOM,
    maxZoom: slot.maxZoom,
    filterSignature: slot.filterSignature,
    expectedDefaultFilterSignature: coverageDefinition.filterSignature,
    sourceSnapshotConfigHash: coverageDefinition.snapshotConfigHash,
    resolvedSnapshotConfigHash,
  };
  const resourceControls = getPropertyTilePyramidResourceControls();
  const configSnapshot = {
    pipelineVersion: PROPERTY_TILE_PYRAMID_PIPELINE_VERSION,
    servingSlot: {
      coverageId: slot.coverageId,
      filterSignature: slot.filterSignature,
      maxZoom: slot.maxZoom,
      pyramidKind: slot.pyramidKind,
    },
    defaultFilter: {
      signature: defaultFilterSignature,
      filters: defaultFilters,
    },
    coverageConfigHash: resolvedSnapshotConfigHash,
    resourceControls,
  };
  const configHash = stableSha256(configSnapshot);
  const groupingConstants = {
    pipelineVersion: PROPERTY_TILE_PYRAMID_PIPELINE_VERSION,
    canonicalGrouping: {
      builder: 'buildCanonicalGroupsForTileUncached',
      filterSignature: defaultFilterSignature,
      minZoom: PROPERTY_TILE_PYRAMID_MIN_ZOOM,
      maxZoom: slot.maxZoom,
    },
    mvtEncoding: {
      layerName: PROPERTY_TILE_PYRAMID_MVT_LAYER_NAME,
      extent: PROPERTY_TILE_EXTENT,
      buffer: PROPERTY_TILE_PYRAMID_MVT_BUFFER,
    },
    mapFootprints: PROPERTY_MAP_FOOTPRINTS,
    ghostRevealZoom: PROPERTY_GHOST_REVEAL_ZOOM,
    previewMemberLimit: PROPERTY_PREVIEW_MEMBER_LIMIT,
    activeSocialScoreThreshold: ACTIVE_SOCIAL_SCORE_THRESHOLD,
    nodeExposure: {
      single: {
        membershipComplete: true,
        readStateCoverage: 'complete',
        propertyIds: 'representative',
        tapRadiusPx: PROPERTY_TILE_PYRAMID_SINGLE_TAP_RADIUS_PX,
      },
      cluster: {
        membershipComplete: false,
        readStateCoverage: 'partial',
        propertyIds: 'omitted',
        previewPropertyIdsLimit: PROPERTY_PREVIEW_MEMBER_LIMIT,
        tapRadiusPx: PROPERTY_TILE_PYRAMID_CLUSTER_TAP_RADIUS_PX,
      },
    },
  };
  const buildInputs = {
    pipelineVersion: PROPERTY_TILE_PYRAMID_PIPELINE_VERSION,
    servingSlot: {
      coverageId: slot.coverageId,
      filterSignature: slot.filterSignature,
      maxZoom: slot.maxZoom,
      pyramidKind: slot.pyramidKind,
    },
    coverageSnapshot,
    configHash,
    configSnapshot,
    groupingConstants,
  };

  return {
    buildInputsHash: stableSha256(buildInputs),
    configHash,
    coverageSnapshot,
    configSnapshot,
    groupingConstants,
  };
}

export async function advancePropertyTilePyramidSourceWatermark(
  scopes: PropertyTilePyramidSourceWatermarkScope[],
  executor: PropertyTilePyramidWatermarkExecutor = db,
): Promise<void> {
  const uniqueScopes = [...new Set(scopes)];
  try {
    for (const scope of uniqueScopes) {
      await executor.execute(sql`
        INSERT INTO property_tile_pyramid_source_watermarks (
          scope,
          scope_key,
          watermark_value,
          watermark_timestamp,
          watermark_json,
          updated_at
        )
        VALUES (
          ${scope}::property_tile_pyramid_watermark_scope,
          'global',
          1,
          now(),
          '{}'::jsonb,
          now()
        )
        ON CONFLICT (scope, scope_key) DO UPDATE SET
          watermark_value = property_tile_pyramid_source_watermarks.watermark_value + 1,
          watermark_timestamp = now(),
          updated_at = now()
      `);
    }
  } catch (error) {
    if (isMissingPyramidSchemaError(error)) {
      return;
    }
    throw error;
  }
}

export async function readPropertyTilePyramidSourceWatermarkSnapshot(): Promise<{
  sourceWatermarkHash: string;
  sourceWatermarksJson: Record<string, unknown>;
}> {
  let rows;
  try {
    rows = await db.execute<{
      scope: string;
      scope_key: string;
      watermark_value: string | bigint;
      watermark_timestamp: string | Date | null;
      updated_at: string | Date;
    }>(sql`
      SELECT
        scope::text,
        scope_key,
        watermark_value::text,
        watermark_timestamp,
        updated_at
      FROM property_tile_pyramid_source_watermarks
      ORDER BY scope::text, scope_key
    `);
  } catch (error) {
    if (isMissingPyramidSchemaError(error)) {
      return {
        sourceWatermarkHash: buildStableSourceWatermarkHash([]),
        sourceWatermarksJson: { watermarks: [] },
      };
    }
    throw error;
  }
  const watermarks = Array.from(rows).map((row) => ({
    scope: row.scope,
    scopeKey: row.scope_key,
    watermarkValue: String(row.watermark_value),
    watermarkTimestamp: row.watermark_timestamp instanceof Date
      ? row.watermark_timestamp.toISOString()
      : row.watermark_timestamp,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  }));

  return {
    sourceWatermarkHash: buildStableSourceWatermarkHash(watermarks),
    sourceWatermarksJson: { watermarks },
  };
}

export async function safeRequestPropertyTilePyramidBuild(
  input: Parameters<typeof requestPropertyTilePyramidBuild>[0],
  logger: PropertyTilePyramidBuildLogger,
  context: Record<string, unknown> = {},
  requestBuild: typeof requestPropertyTilePyramidBuild = requestPropertyTilePyramidBuild,
): Promise<PropertyTilePyramidBuildRequest | null> {
  try {
    const sourceWatermarks = input.sourceWatermarkHash
      ? { sourceWatermarkHash: input.sourceWatermarkHash, sourceWatermarksJson: input.sourceWatermarksJson }
      : await readPropertyTilePyramidSourceWatermarkSnapshot();
    return await requestBuild({
      ...input,
      ...sourceWatermarks,
    });
  } catch (error) {
    logger.warn(
      {
        err: error,
        reason: input.reason,
        ...context,
      },
      'Failed to request property tile pyramid build after commit',
    );
    return null;
  }
}

export function buildPropertyTilePyramidBuildInputsHash(slot: PropertyTilePyramidSlot): string {
  return buildPropertyTilePyramidBuildIdentitySnapshots(slot).buildInputsHash;
}

function isMissingPyramidSchemaError(error: unknown): boolean {
  const code =
    (error as { code?: unknown } | null)?.code ??
    (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return code === '42P01' || code === '42703' || code === '42704' || code === '42883';
}

function maybeBuffer(value: unknown): Buffer | null {
  if (value == null) {
    return null;
  }
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  return Buffer.from(value as never);
}

function statusCodeFromPayload(payload: Buffer | null, rowStatusCode: unknown): 200 | 204 {
  if (rowStatusCode === 200 || rowStatusCode === '200' || rowStatusCode === 'valid_encoded') {
    return 200;
  }
  if (rowStatusCode === 204 || rowStatusCode === '204' || rowStatusCode === 'valid_empty') {
    return 204;
  }
  return payload && payload.length > 0 ? 200 : 204;
}

export async function lookupCurrentPropertyTilePyramidVersion(
  slot: PropertyTilePyramidSlot = getDefaultPropertyTilePyramidSlot(),
): Promise<PropertyTilePyramidCurrentLookup> {
  try {
    const rows = await db.execute<{
      version_id: string;
      coverage_id: string;
      filter_signature: string;
      max_zoom: number;
      pyramid_kind: string;
      build_inputs_hash: string;
      source_watermark_hash: string;
      promoted_at: string | null;
      degraded_at: string | null;
      degraded_reason: string | null;
    }>(sql`
      SELECT
        v.id::text AS version_id,
        v.coverage_id,
        v.filter_signature,
        v.max_zoom,
        v.pyramid_kind,
        v.build_inputs_hash,
        v.source_watermark_hash,
        v.promoted_at::text AS promoted_at,
        v.degraded_at::text AS degraded_at,
        v.degraded_reason
      FROM property_tile_pyramid_current c
      JOIN property_tile_pyramid_versions v
        ON v.id = c.current_version_id
       AND v.coverage_id = c.coverage_id
       AND v.filter_signature = c.filter_signature
       AND v.max_zoom = c.max_zoom
       AND v.pyramid_kind = c.pyramid_kind
      WHERE c.coverage_id = ${slot.coverageId}
        AND c.filter_signature = ${slot.filterSignature}
        AND c.max_zoom = ${slot.maxZoom}
        AND c.pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
        AND v.status = 'promoted'
      LIMIT 1
    `);
    const row = Array.from(rows)[0];
    if (!row) {
      return { state: 'none', tileStatus: 'pyramid-unavailable', reason: 'no-current-version' };
    }

    return {
      state: 'current',
      version: {
        versionId: row.version_id,
        coverageId: row.coverage_id,
        filterSignature: row.filter_signature,
        maxZoom: row.max_zoom,
        pyramidKind: row.pyramid_kind,
        buildInputsHash: row.build_inputs_hash,
        sourceWatermarkHash: row.source_watermark_hash,
        status: 'promoted',
        promotedAt: row.promoted_at,
        degradedAt: row.degraded_at,
        degradedReason: row.degraded_reason,
      },
    };
  } catch (error) {
    if (isMissingPyramidSchemaError(error)) {
      return { state: 'none', tileStatus: 'pyramid-unavailable', reason: 'pyramid-schema-unavailable' };
    }
    throw error;
  }
}

export async function lookupPromotedPropertyTilePyramidTile(input: {
  version: CurrentPropertyTilePyramidVersion;
  z: number;
  x: number;
  y: number;
}): Promise<PropertyTilePyramidTileLookup> {
  try {
    const rows = await db.execute<{
      payload: unknown;
      etag: string | null;
      node_count: number | string | null;
      tile_status: string | null;
      validation_status: string | null;
    }>(sql`
      SELECT
        payload,
        etag,
        node_count,
        tile_status,
        validation_status
      FROM property_tile_pyramid_tiles
      WHERE version_id = ${input.version.versionId}::uuid
        AND z = ${input.z}
        AND x = ${input.x}
        AND y = ${input.y}
      LIMIT 1
    `);
    const row = Array.from(rows)[0];
    if (!row) {
      return { state: 'missing', tileStatus: 'pyramid-missing', reason: 'manifest-missing' };
    }

    const nodeCount = Number(row.node_count ?? 0);
    if (row.tile_status === 'pending' || row.tile_status === 'failed' || row.validation_status === 'failed') {
      return { state: 'missing', tileStatus: 'pyramid-missing', reason: `tile-${row.tile_status}` };
    }

    const existingPayload = maybeBuffer(row.payload);
    if (existingPayload && existingPayload.length > 0) {
      const statusCode = statusCodeFromPayload(existingPayload, row.tile_status);
      return {
        state: 'hit',
        versionId: input.version.versionId,
        payload: existingPayload,
        statusCode,
        etag: row.etag ?? buildPropertyTilePyramidEtag({ ...input, versionId: input.version.versionId, payload: existingPayload }),
        nodeCount,
        encodedFromNodes: false,
      };
    }

    if (nodeCount <= 0) {
      return {
        state: 'hit',
        versionId: input.version.versionId,
        payload: null,
        statusCode: 204,
        etag: row.etag ?? buildPropertyTilePyramidEtag({ ...input, versionId: input.version.versionId, payload: null }),
        nodeCount: 0,
        encodedFromNodes: false,
      };
    }

    const regenerated = await encodePropertyTilePyramidTileFromPromotedNodes(input);
    return {
      state: 'hit',
      versionId: input.version.versionId,
      payload: regenerated.payload,
      statusCode: regenerated.statusCode,
      etag: row.etag ?? regenerated.etag,
      nodeCount,
      encodedFromNodes: true,
    };
  } catch (error) {
    if (isMissingPyramidSchemaError(error)) {
      return { state: 'missing', tileStatus: 'pyramid-unavailable', reason: 'pyramid-schema-unavailable' };
    }
    throw error;
  }
}

export async function encodePropertyTilePyramidTileFromPromotedNodes(input: {
  version: CurrentPropertyTilePyramidVersion;
  z: number;
  x: number;
  y: number;
}): Promise<{ payload: Buffer | null; statusCode: 200 | 204; etag: string }> {
  const result = await db.execute<{ mvt: unknown }>(sql`
    WITH node_rows AS (
      SELECT
        ST_AsMVTGeom(
          ST_Transform(ST_SetSRID(ST_MakePoint(render_lon, render_lat), 4326), 3857),
          ST_TileEnvelope(${input.z}, ${input.x}, ${input.y}),
          ${PROPERTY_TILE_EXTENT},
          ${PROPERTY_TILE_PYRAMID_MVT_BUFFER},
          true
        ) AS geom,
        representative_property_id AS primary_property_id,
        CASE
          WHEN group_kind = 'single' THEN representative_property_id::text
          ELSE ''
        END AS property_ids,
        array_to_string(preview_property_ids, ',') AS preview_property_ids,
        point_count,
        node_class,
        group_kind,
        bbox_west,
        bbox_south,
        bbox_east,
        bbox_north,
        active_listing_count AS "activeListingCount",
        completed_listing_count AS "completedListingCount",
        social_count AS "socialCount",
        recent_social_count AS "recentSocialCount",
        social_score_total AS "socialScoreTotal",
        social_score_max AS "socialScoreMax",
        recent_social_score_total AS "recentSocialScoreTotal",
        comment_count AS "commentCount",
        render_lon,
        render_lat,
        address,
        city,
        asking_price AS "askingPrice",
        thumbnail_url AS "thumbnailUrl",
        has_active_listing AS "hasActiveListing",
        market_state AS "marketState",
        ${input.version.versionId}::text AS pyramid_version_id,
        node_id::text AS pyramid_node_id,
        (group_kind = 'single') AS membership_complete,
        CASE WHEN group_kind = 'single' THEN 'complete' ELSE 'partial' END AS read_state_coverage
      FROM property_tile_pyramid_nodes
      WHERE version_id = ${input.version.versionId}::uuid
        AND z = ${input.z}
        AND x = ${input.x}
        AND y = ${input.y}
    )
    SELECT ST_AsMVT(node_rows, ${PROPERTY_TILE_PYRAMID_MVT_LAYER_NAME}, ${PROPERTY_TILE_EXTENT}, 'geom') AS mvt
    FROM node_rows
    WHERE geom IS NOT NULL
  `);

  const payload = maybeBuffer(Array.from(result)[0]?.mvt);
  const normalizedPayload = payload && payload.length > 0 ? payload : null;
  const statusCode = normalizedPayload ? 200 : 204;
  const etag = buildPropertyTilePyramidEtag({
    versionId: input.version.versionId,
    z: input.z,
    x: input.x,
    y: input.y,
    payload: normalizedPayload,
  });

    await db.execute(sql`
      UPDATE property_tile_pyramid_tiles
      SET
        payload = ${normalizedPayload},
        tile_status = ${statusCode === 200 ? 'valid_encoded' : 'valid_empty'}::property_tile_pyramid_tile_status,
        etag = ${etag},
        payload_sha256 = ${normalizedPayload ? createHash('sha256').update(normalizedPayload).digest('hex') : null},
        payload_generated_at = now()
    WHERE version_id = ${input.version.versionId}::uuid
      AND z = ${input.z}
      AND x = ${input.x}
      AND y = ${input.y}
  `);

  return { payload: normalizedPayload, statusCode, etag };
}

export async function markPropertyTilePyramidVersionDegraded(input: {
  version: CurrentPropertyTilePyramidVersion;
  reason: string;
  details?: Record<string, unknown>;
  actor?: string;
}): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE property_tile_pyramid_versions
      SET
        degraded_at = COALESCE(degraded_at, now()),
        degraded_reason = ${input.reason},
        validation_summary = jsonb_set(
          COALESCE(validation_summary, '{}'::jsonb),
          '{degraded}',
          ${stableJson({
            reason: input.reason,
            details: input.details ?? {},
          })}::jsonb,
          true
        ),
        updated_at = now()
      WHERE id = ${input.version.versionId}::uuid
        AND status = 'promoted'
    `);

    await db.execute(sql`
      INSERT INTO property_tile_pyramid_audit (
        version_id,
        coverage_id,
        filter_signature,
        max_zoom,
        pyramid_kind,
        action,
        actor,
        from_status,
        to_status,
        current_version_id,
        reason,
        details_json
      )
      VALUES (
        ${input.version.versionId}::uuid,
        ${input.version.coverageId},
        ${input.version.filterSignature},
        ${input.version.maxZoom},
        ${input.version.pyramidKind}::property_tile_pyramid_kind,
        'degraded',
        ${input.actor ?? 'system'},
        'promoted',
        'promoted',
        ${input.version.versionId}::uuid,
        ${input.reason},
        ${stableJson(input.details ?? {})}::jsonb
      )
    `);
  } catch (error) {
    if (isMissingPyramidSchemaError(error)) {
      return;
    }
    throw error;
  }
}

export async function requestPropertyTilePyramidBuild(input: {
  reason: PropertyTilePyramidBuildRequestReason | string;
  slot?: PropertyTilePyramidSlot;
  sourceWatermarkHash?: string;
  sourceWatermarksJson?: Record<string, unknown>;
  buildInputsHash?: string;
}): Promise<PropertyTilePyramidBuildRequest> {
  const slot = input.slot ?? getDefaultPropertyTilePyramidSlot();
  const buildIdentity = buildPropertyTilePyramidBuildIdentitySnapshots(slot);
  const buildInputsHash = input.buildInputsHash ?? buildIdentity.buildInputsHash;
  const sourceWatermarks = input.sourceWatermarkHash
    ? {
        sourceWatermarkHash: input.sourceWatermarkHash,
        sourceWatermarksJson: input.sourceWatermarksJson ?? {},
      }
    : await readPropertyTilePyramidSourceWatermarkSnapshot();
  const { sourceWatermarkHash, sourceWatermarksJson } = sourceWatermarks;

  try {
    const rows = await db.execute<{
      id: string;
      status: PropertyTilePyramidStatus;
      next_retry_at: string | null;
    }>(sql`
      INSERT INTO property_tile_pyramid_versions (
        coverage_id,
        filter_signature,
        max_zoom,
        pyramid_kind,
        config_hash,
        build_inputs_hash,
        source_watermark_hash,
        source_watermarks_json,
        coverage_snapshot_json,
        config_snapshot_json,
        grouping_constants_json,
        status,
        request_reason,
        requested_at,
        updated_at
      )
      VALUES (
        ${slot.coverageId},
        ${slot.filterSignature},
        ${slot.maxZoom},
        ${slot.pyramidKind}::property_tile_pyramid_kind,
        ${buildIdentity.configHash},
        ${buildInputsHash},
        ${sourceWatermarkHash},
        ${JSON.stringify(sourceWatermarksJson)}::jsonb,
        ${stableJson(buildIdentity.coverageSnapshot)}::jsonb,
        ${stableJson(buildIdentity.configSnapshot)}::jsonb,
        ${stableJson(buildIdentity.groupingConstants)}::jsonb,
        'queued',
        ${input.reason},
        now(),
        now()
      )
      ON CONFLICT (
        coverage_id,
        filter_signature,
        max_zoom,
        pyramid_kind,
        build_inputs_hash,
        source_watermark_hash
      )
      DO UPDATE SET
        request_reason = EXCLUDED.request_reason,
        updated_at = now()
      RETURNING id::text, status, next_retry_at::text
    `);

    const row = Array.from(rows)[0];
    if (!row) {
      return { status: 'unavailable', reason: 'build-request-not-returned' };
    }

    if (row.status === 'failed_terminal') {
      return {
        status: 'terminal',
        versionId: row.id,
        existingStatus: row.status,
        nextRetryAt: row.next_retry_at,
      };
    }

    if (row.status === 'failed_retryable' && row.next_retry_at && new Date(row.next_retry_at).getTime() > Date.now()) {
      return {
        status: 'backoff',
        versionId: row.id,
        existingStatus: row.status,
        nextRetryAt: row.next_retry_at,
      };
    }

    const queueJobId = buildPropertyTilePyramidQueueJobId({
      slot,
      buildInputsHash,
      sourceWatermarkHash,
    });
    await enqueuePropertyTilePyramidBuildSignal({
      versionId: row.id,
      reason: String(input.reason),
      jobId: queueJobId,
    });

    return {
      status: row.status === 'queued' ? 'enqueued' : 'coalesced',
      versionId: row.id,
      existingStatus: row.status,
      queueJobId,
      nextRetryAt: row.next_retry_at,
    };
  } catch (error) {
    if (isMissingPyramidSchemaError(error)) {
      return { status: 'unavailable', reason: 'pyramid-schema-unavailable' };
    }
    throw error;
  }
}

async function enqueuePropertyTilePyramidBuildSignal(input: {
  versionId: string;
  reason: string;
  jobId: string;
}): Promise<void> {
  try {
    const { enqueuePropertyTilePyramidBuild } = await import('./ingest/queue.js');
    await enqueuePropertyTilePyramidBuild(
      {
        versionId: input.versionId,
        reason: input.reason,
      },
      input.jobId,
    );
  } catch (error) {
    await db.execute(sql`
      UPDATE property_tile_pyramid_versions
      SET
        failure_category = 'queue_dispatch',
        failure_message = ${error instanceof Error ? error.message : 'Unknown pyramid queue dispatch error'},
        updated_at = now()
      WHERE id = ${input.versionId}::uuid
    `);
  }
}

export function buildPropertyTilePyramidQueueJobId(input: {
  slot: PropertyTilePyramidSlot;
  buildInputsHash: string;
  sourceWatermarkHash: string;
}): string {
  const hash = createHash('sha1');
  hash.update(input.slot.coverageId);
  hash.update(':');
  hash.update(input.slot.filterSignature);
  hash.update(':');
  hash.update(String(input.slot.maxZoom));
  hash.update(':');
  hash.update(input.slot.pyramidKind);
  hash.update(':');
  hash.update(input.buildInputsHash);
  hash.update(':');
  hash.update(input.sourceWatermarkHash);
  return `property-tile-pyramid-${hash.digest('hex')}`;
}

function uuidArraySql(ids: readonly string[]) {
  if (ids.length === 0) {
    return sql`ARRAY[]::uuid[]`;
  }

  return sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[]`;
}

function jsonSql(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

function sortPyramidGroups(groups: CanonicalPropertyGroup[]): CanonicalPropertyGroup[] {
  return [...groups].sort((a, b) =>
    a.ownerTile.z - b.ownerTile.z ||
    a.ownerTile.x - b.ownerTile.x ||
    a.ownerTile.y - b.ownerTile.y ||
    a.nodeClass.localeCompare(b.nodeClass) ||
    a.groupKind.localeCompare(b.groupKind) ||
    a.coordinate[0] - b.coordinate[0] ||
    a.coordinate[1] - b.coordinate[1] ||
    a.primaryPropertyId.localeCompare(b.primaryPropertyId)
  );
}

function buildPyramidNodeId(input: {
  z: number;
  x: number;
  y: number;
  ordinal: number;
  group: CanonicalPropertyGroup;
}): string {
  const hash = createHash('sha1');
  hash.update(`${input.z}/${input.x}/${input.y}`);
  hash.update(':');
  hash.update(input.group.nodeClass);
  hash.update(':');
  hash.update(input.group.groupKind);
  hash.update(':');
  hash.update(input.group.primaryPropertyId);
  hash.update(':');
  hash.update(String(input.ordinal));
  return `${input.z}:${input.x}:${input.y}:${hash.digest('hex').slice(0, 16)}`;
}

async function insertPropertyTilePyramidNodes(input: {
  versionId: string;
  z: number;
  x: number;
  y: number;
  groups: CanonicalPropertyGroup[];
}): Promise<void> {
  if (input.groups.length === 0) {
    return;
  }

  const orderedGroups = sortPyramidGroups(input.groups);
  const rows = orderedGroups.map((group, index) => {
    const bbox = group.bbox;
    return sql`(
      ${input.versionId}::uuid,
      ${buildPyramidNodeId({ ...input, ordinal: index, group })},
      ${input.z},
      ${input.x},
      ${input.y},
      ${group.coordinate[0]},
      ${group.coordinate[1]},
      ST_SetSRID(ST_MakePoint(${group.coordinate[0]}, ${group.coordinate[1]}), 4326),
      ${group.anchorWorldX},
      ${group.anchorWorldY},
      ${group.nodeClass}::property_tile_pyramid_node_class,
      ${group.groupKind}::property_tile_pyramid_group_kind,
      ${group.pointCount},
      ${group.primaryPropertyId}::uuid,
      ${uuidArraySql(group.previewPropertyIds)},
      ${group.previewPropertyIds.length},
      ${jsonSql({
        primaryPropertyId: group.primaryPropertyId,
        pointCount: group.pointCount,
        propertyIdsOmitted: group.groupKind === 'cluster',
      })},
      ${jsonSql([])},
      ${bbox?.[0] ?? null},
      ${bbox?.[1] ?? null},
      ${bbox?.[2] ?? null},
      ${bbox?.[3] ?? null},
      ${group.activeListingCount},
      ${group.completedListingCount},
      ${group.socialCount},
      ${group.recentSocialCount},
      ${group.socialScoreTotal},
      ${group.socialScoreMax},
      ${group.recentSocialScoreTotal},
      ${group.commentCount},
      ${group.groupKind === 'single' ? group.address : null},
      ${group.groupKind === 'single' ? group.city : null},
      ${group.groupKind === 'single' ? group.askingPrice : null},
      ${group.groupKind === 'single' ? group.thumbnailUrl : null},
      ${group.groupKind === 'single' ? group.hasActiveListing : null},
      ${group.groupKind === 'single' ? group.marketState : null},
      ${group.groupKind === 'cluster'
        ? PROPERTY_TILE_PYRAMID_CLUSTER_TAP_RADIUS_PX
        : PROPERTY_TILE_PYRAMID_SINGLE_TAP_RADIUS_PX},
      ${group.socialScoreMax}
    )`;
  });

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
      active_listing_count,
      completed_listing_count,
      social_count,
      recent_social_count,
      social_score_total,
      social_score_max,
      recent_social_score_total,
      comment_count,
      address,
      city,
      asking_price,
      thumbnail_url,
      has_active_listing,
      market_state,
      tap_radius_px,
      tap_priority_score
    )
    VALUES ${sql.join(rows, sql`, `)}
  `);
}

async function upsertPropertyTilePyramidTileManifest(input: {
  versionId: string;
  z: number;
  x: number;
  y: number;
  nodeCount: number;
}): Promise<void> {
  const emptyEtag = buildPropertyTilePyramidEtag({
    versionId: input.versionId,
    z: input.z,
    x: input.x,
    y: input.y,
    payload: null,
  });
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
      validated_at,
      updated_at
    )
    VALUES (
      ${input.versionId}::uuid,
      ${input.z},
      ${input.x},
      ${input.y},
      ${input.nodeCount > 0 ? 'valid_nodes' : 'valid_empty'}::property_tile_pyramid_tile_status,
      'validated'::property_tile_pyramid_tile_validation_status,
      ${input.nodeCount},
      ${emptyEtag},
      now(),
      now()
    )
    ON CONFLICT (version_id, z, x, y) DO UPDATE SET
      tile_status = EXCLUDED.tile_status,
      validation_status = EXCLUDED.validation_status,
      node_count = EXCLUDED.node_count,
      etag = EXCLUDED.etag,
      payload = NULL,
      payload_sha256 = NULL,
      payload_generated_at = NULL,
      validated_at = now(),
      last_error = NULL,
      updated_at = now()
  `);
}

async function getCurrentVersionIdForSlot(slot: PropertyTilePyramidSlot): Promise<string | null> {
  const rows = await db.execute<{ current_version_id: string | null }>(sql`
    SELECT current_version_id::text
    FROM property_tile_pyramid_current
    WHERE coverage_id = ${slot.coverageId}
      AND filter_signature = ${slot.filterSignature}
      AND max_zoom = ${slot.maxZoom}
      AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
    LIMIT 1
  `);
  return Array.from(rows)[0]?.current_version_id ?? null;
}

async function markPropertyTilePyramidBuildFailure(input: {
  versionId: string;
  category: string;
  message: string;
  stack?: string | null;
  stage: string;
  retryDelayMinutes?: number;
}): Promise<void> {
  await db.execute(sql`
    UPDATE property_tile_pyramid_versions
    SET
      status = CASE
        WHEN attempt_count >= max_attempts THEN 'failed_terminal'::property_tile_pyramid_version_status
        ELSE 'failed_retryable'::property_tile_pyramid_version_status
      END,
      failure_category = ${input.category},
      failure_message = ${input.message},
      failure_stack_summary = ${input.stack?.slice(0, 4000) ?? null},
      failed_stage = ${input.stage},
      terminal_reason = CASE
        WHEN attempt_count >= max_attempts THEN ${input.message}
        ELSE terminal_reason
      END,
      next_retry_at = CASE
        WHEN attempt_count >= max_attempts THEN NULL
        ELSE now() + (${input.retryDelayMinutes ?? 5} || ' minutes')::interval
      END,
      lease_owner = NULL,
      lease_token = NULL,
      lease_until = NULL,
      build_finished_at = now(),
      updated_at = now()
    WHERE id = ${input.versionId}::uuid
  `);
}

export async function executeDuePropertyTilePyramidBuild(options: {
  leaseOwner: string;
  reason?: string;
  logger?: {
    info?(payload: Record<string, unknown>, message: string): void;
    warn?(payload: Record<string, unknown>, message: string): void;
    error?(payload: Record<string, unknown>, message: string): void;
  };
}): Promise<Record<string, unknown>> {
  let activeVersionId: string | null = null;
  try {
    const rows = await db.execute<{
      id: string;
      status: PropertyTilePyramidStatus;
      coverage_id: string;
      filter_signature: string;
      max_zoom: number;
      pyramid_kind: string;
      build_inputs_hash: string;
      source_watermark_hash: string;
    }>(sql`
      UPDATE property_tile_pyramid_versions
      SET
        status = 'building',
        lease_owner = ${options.leaseOwner},
        lease_until = now() + (${getPropertyTilePyramidResourceControls().leaseSeconds} || ' seconds')::interval,
        attempt_count = COALESCE(attempt_count, 0) + 1,
        last_attempt_at = now(),
        build_started_at = COALESCE(build_started_at, now()),
        updated_at = now()
      WHERE id = (
        SELECT id
        FROM property_tile_pyramid_versions
        WHERE status IN ('queued', 'failed_retryable')
          AND (next_retry_at IS NULL OR next_retry_at <= now())
          AND (lease_until IS NULL OR lease_until <= now())
        ORDER BY requested_at ASC NULLS LAST, updated_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        id::text,
        status,
        coverage_id,
        filter_signature,
        max_zoom,
        pyramid_kind::text,
        build_inputs_hash,
        source_watermark_hash
    `);
    const row = Array.from(rows)[0];
    if (!row) {
      return { status: 'noop', reason: 'no-eligible-pyramid-version' };
    }
    activeVersionId = row.id;

    const slot: PropertyTilePyramidSlot = {
      coverageId: row.coverage_id,
      filterSignature: row.filter_signature,
      maxZoom: row.max_zoom,
      pyramidKind: row.pyramid_kind,
    };
    const coverage = {
      ...getExpectedDefaultPropertyTileSnapshotCoverageDefinition(),
      maxZoom: slot.maxZoom,
    };
    const tiles = computePropertyTileSnapshotCoordinatesFromCoverage(coverage);
    const controls = getPropertyTilePyramidResourceControls();
    const startedAt = Date.now();
    let nodeCount = 0;
    let nonEmptyTileCount = 0;
    let encodedPayloadBytes = 0;

    await db.execute(sql`
      DELETE FROM property_tile_pyramid_nodes
      WHERE version_id = ${row.id}::uuid
    `);
    await db.execute(sql`
      DELETE FROM property_tile_pyramid_tiles
      WHERE version_id = ${row.id}::uuid
    `);

    for (let index = 0; index < tiles.length; index += 1) {
      const tile = tiles[index];
      if (index > 0 && index % controls.chunkTileLimit === 0) {
        await db.execute(sql`
          UPDATE property_tile_pyramid_versions
          SET
            lease_until = now() + (${controls.leaseSeconds} || ' seconds')::interval,
            validation_summary = jsonb_set(
              COALESCE(validation_summary, '{}'::jsonb),
              '{chunkProgress}',
              ${JSON.stringify({ completedTiles: index, totalTiles: tiles.length })}::jsonb,
              true
            ),
            updated_at = now()
          WHERE id = ${row.id}::uuid
        `);
      }

      const groups = await buildCanonicalGroupsForTileUncached(
        tile,
        createDefaultMapFilters(),
        {
          statementTimeoutMs: controls.statementTimeoutMs,
        },
      );
      nodeCount += groups.length;
      if (groups.length > 0) {
        nonEmptyTileCount += 1;
      }

      await upsertPropertyTilePyramidTileManifest({
        versionId: row.id,
        z: tile.z,
        x: tile.x,
        y: tile.y,
        nodeCount: groups.length,
      });
      await insertPropertyTilePyramidNodes({
        versionId: row.id,
        z: tile.z,
        x: tile.x,
        y: tile.y,
        groups,
      });

      if (groups.length > 0) {
        const encoded = await encodePropertyTilePyramidTileFromPromotedNodes({
          version: {
            ...slot,
            versionId: row.id,
            buildInputsHash: row.build_inputs_hash,
            sourceWatermarkHash: row.source_watermark_hash,
            status: 'promoted',
            promotedAt: null,
            degradedAt: null,
            degradedReason: null,
          },
          z: tile.z,
          x: tile.x,
          y: tile.y,
        });
        encodedPayloadBytes += encoded.payload?.byteLength ?? 0;
      }
    }

    const heapBytes = nodeCount * 600 + tiles.length * 250 + encodedPayloadBytes;
    const indexBytes = Math.round(nodeCount * 160 + tiles.length * 80);
    const walBytes = Math.round((heapBytes + indexBytes) * 2.5);
    if (walBytes > 10_000_000_000) {
      await markPropertyTilePyramidBuildFailure({
        versionId: row.id,
        category: 'resource_limit',
        message: `Estimated WAL ${walBytes} exceeds 10000000000 bytes`,
        stage: 'resource-validation',
        retryDelayMinutes: 15,
      });
      return {
        status: 'failed_retryable',
        versionId: row.id,
        failureCategory: 'resource_limit',
      };
    }

    await db.execute(sql`
      UPDATE property_tile_pyramid_versions
      SET
        status = 'validating',
        expected_tile_count = ${tiles.length},
        validated_tile_count = ${tiles.length},
        non_empty_tile_count = ${nonEmptyTileCount},
        node_count = ${nodeCount},
        encoded_payload_bytes = ${encodedPayloadBytes},
        heap_bytes = ${heapBytes},
        index_bytes = ${indexBytes},
        wal_bytes = ${walBytes},
        validation_summary = ${JSON.stringify({
          expectedTileCount: tiles.length,
          observedTileCount: tiles.length,
          nonEmptyTileCount,
          nodeCount,
          memberRowCount: 0,
          encodedPayloadBytes,
          heapBytes,
          indexBytes,
          walBytes,
          wallClockMs: Date.now() - startedAt,
          chunkTileLimit: controls.chunkTileLimit,
        })}::jsonb,
        build_finished_at = now(),
        updated_at = now()
      WHERE id = ${row.id}::uuid
    `);
    await db.execute(sql`
      UPDATE property_tile_pyramid_versions
      SET
        status = 'validated',
        validated_at = now(),
        build_duration_ms = ${Date.now() - startedAt},
        lease_owner = NULL,
        lease_token = NULL,
        lease_until = NULL,
        updated_at = now()
      WHERE id = ${row.id}::uuid
    `);

    const previousVersionId = await getCurrentVersionIdForSlot(slot);
    await db.execute(sql`
      SELECT promote_property_tile_pyramid_version(
        ${row.id}::uuid,
        ${previousVersionId}::uuid,
        ${options.reason ?? 'worker-build'},
        ${options.leaseOwner}
      )
    `);

    return {
      status: 'promoted',
      versionId: row.id,
      expectedTileCount: tiles.length,
      nonEmptyTileCount,
      nodeCount,
      encodedPayloadBytes,
    };
  } catch (error) {
    if (isMissingPyramidSchemaError(error)) {
      return { status: 'noop', reason: 'pyramid-schema-unavailable' };
    }
    if (activeVersionId) {
      await markPropertyTilePyramidBuildFailure({
        versionId: activeVersionId,
        category: 'build_error',
        message: error instanceof Error ? error.message : 'Unknown property tile pyramid build error',
        stack: error instanceof Error ? error.stack : null,
        stage: 'full-build',
      });
    }
    throw error;
  }
}

export async function getPropertyTilePyramidHealthSummary(): Promise<PropertyTilePyramidHealthSummary> {
  try {
    const rows = await db.execute<{
      current_version_id: string | null;
      current_promoted_at: string | null;
      degraded_reason: string | null;
      active_candidate_version_id: string | null;
      active_candidate_status: PropertyTilePyramidStatus | null;
      retryable_failure_due_at: string | null;
      terminal_failure_count: number | string | null;
      encoded_coverage_ratio: number | string | null;
      last_successful_promotion_at: string | null;
    }>(sql`
      WITH current_version AS (
        SELECT v.*
        FROM property_tile_pyramid_current c
        JOIN property_tile_pyramid_versions v ON v.id = c.current_version_id
        WHERE c.coverage_id = ${getDefaultPropertyTilePyramidSlot().coverageId}
          AND c.filter_signature = ${getDefaultPropertyTilePyramidSlot().filterSignature}
          AND c.max_zoom = ${getDefaultPropertyTilePyramidSlot().maxZoom}
          AND c.pyramid_kind = ${getDefaultPropertyTilePyramidSlot().pyramidKind}::property_tile_pyramid_kind
        LIMIT 1
      ),
      active_candidate AS (
        SELECT id, status, next_retry_at
        FROM property_tile_pyramid_versions
        WHERE coverage_id = ${getDefaultPropertyTilePyramidSlot().coverageId}
          AND filter_signature = ${getDefaultPropertyTilePyramidSlot().filterSignature}
          AND max_zoom = ${getDefaultPropertyTilePyramidSlot().maxZoom}
          AND pyramid_kind = ${getDefaultPropertyTilePyramidSlot().pyramidKind}::property_tile_pyramid_kind
          AND status IN ('queued', 'building', 'validating', 'failed_retryable')
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1
      ),
      encoded AS (
        SELECT
          CASE
            WHEN COUNT(*) = 0 THEN NULL
            ELSE COUNT(*) FILTER (WHERE payload IS NOT NULL)::float / COUNT(*)::float
          END AS ratio
        FROM property_tile_pyramid_tiles
        WHERE version_id = (SELECT id FROM current_version)
      )
      SELECT
        (SELECT id::text FROM current_version) AS current_version_id,
        (SELECT promoted_at::text FROM current_version) AS current_promoted_at,
        (SELECT degraded_reason FROM current_version) AS degraded_reason,
        (SELECT id::text FROM active_candidate) AS active_candidate_version_id,
        (SELECT status FROM active_candidate) AS active_candidate_status,
        (SELECT next_retry_at::text FROM active_candidate WHERE status = 'failed_retryable') AS retryable_failure_due_at,
        (
          SELECT count(*)::int
          FROM property_tile_pyramid_versions
          WHERE status = 'failed_terminal'
        ) AS terminal_failure_count,
        (SELECT ratio FROM encoded) AS encoded_coverage_ratio,
        (
          SELECT max(promoted_at)::text
          FROM property_tile_pyramid_versions
          WHERE status = 'promoted'
        ) AS last_successful_promotion_at
    `);

    const row = Array.from(rows)[0];
    const currentVersionId = row?.current_version_id ?? null;
    const degradedReason = row?.degraded_reason ?? null;
    const terminalFailureCount = Number(row?.terminal_failure_count ?? 0);
    return {
      enabled: true,
      status: currentVersionId && !degradedReason && terminalFailureCount === 0 ? 'ok' : 'degraded',
      currentVersionId,
      currentPromotedAt: row?.current_promoted_at ?? null,
      degradedReason: degradedReason ?? (currentVersionId ? null : 'no-current-promoted-pyramid'),
      activeCandidateVersionId: row?.active_candidate_version_id ?? null,
      activeCandidateStatus: row?.active_candidate_status ?? null,
      retryableFailureDueAt: row?.retryable_failure_due_at ?? null,
      terminalFailureCount,
      encodedCoverageRatio: row?.encoded_coverage_ratio == null ? null : Number(row.encoded_coverage_ratio),
      lastSuccessfulPromotionAt: row?.last_successful_promotion_at ?? null,
      resourceControls: getPropertyTilePyramidResourceControls(),
    };
  } catch (error) {
    if (isMissingPyramidSchemaError(error)) {
      return {
        enabled: true,
        status: 'degraded',
        currentVersionId: null,
        currentPromotedAt: null,
        degradedReason: 'pyramid-schema-unavailable',
        activeCandidateVersionId: null,
        activeCandidateStatus: null,
        retryableFailureDueAt: null,
        terminalFailureCount: 0,
        encodedCoverageRatio: null,
        lastSuccessfulPromotionAt: null,
        resourceControls: getPropertyTilePyramidResourceControls(),
      };
    }
    throw error;
  }
}

export async function getPropertyTilePyramidOpsSummary(): Promise<PropertyTilePyramidOpsSummary> {
  const health = await getPropertyTilePyramidHealthSummary();
  try {
    const rows = await db.execute<{
      previous_version_id: string | null;
      manifest_tile_count: number | string | null;
      encoded_tile_count: number | string | null;
      node_count: number | string | null;
      member_count: number | string | null;
      active_lease_owner: string | null;
      active_lease_age_seconds: number | string | null;
      last_audit_action: string | null;
      last_audit_reason: string | null;
    }>(sql`
      WITH current_version AS (
        SELECT ${health.currentVersionId}::uuid AS id
        WHERE ${health.currentVersionId} IS NOT NULL
      )
      SELECT
        (
          SELECT id::text
          FROM property_tile_pyramid_versions
          WHERE status = 'promoted'
            AND id <> (SELECT id FROM current_version)
          ORDER BY promoted_at DESC NULLS LAST
          LIMIT 1
        ) AS previous_version_id,
        (
          SELECT count(*)::int
          FROM property_tile_pyramid_tiles
          WHERE version_id = (SELECT id FROM current_version)
        ) AS manifest_tile_count,
        (
          SELECT count(*)::int
          FROM property_tile_pyramid_tiles
          WHERE version_id = (SELECT id FROM current_version)
            AND payload IS NOT NULL
        ) AS encoded_tile_count,
        (
          SELECT count(*)::int
          FROM property_tile_pyramid_nodes
          WHERE version_id = (SELECT id FROM current_version)
        ) AS node_count,
        (
          SELECT to_regclass('property_tile_pyramid_members') IS NOT NULL
        )::int AS member_count,
        (
          SELECT lease_owner
          FROM property_tile_pyramid_versions
          WHERE status IN ('building', 'validating')
          ORDER BY updated_at DESC NULLS LAST
          LIMIT 1
        ) AS active_lease_owner,
        (
          SELECT EXTRACT(EPOCH FROM now() - lease_until + (${getPropertyTilePyramidResourceControls().leaseSeconds} || ' seconds')::interval)
          FROM property_tile_pyramid_versions
          WHERE status IN ('building', 'validating') AND lease_until IS NOT NULL
          ORDER BY updated_at DESC NULLS LAST
          LIMIT 1
        ) AS active_lease_age_seconds,
        (
          SELECT action
          FROM property_tile_pyramid_audit
          ORDER BY created_at DESC
          LIMIT 1
        ) AS last_audit_action,
        (
          SELECT reason
          FROM property_tile_pyramid_audit
          ORDER BY created_at DESC
          LIMIT 1
        ) AS last_audit_reason
    `);
    const row = Array.from(rows)[0];
    return {
      ...health,
      previousVersionId: row?.previous_version_id ?? null,
      manifestTileCount: row?.manifest_tile_count == null ? null : Number(row.manifest_tile_count),
      encodedTileCount: row?.encoded_tile_count == null ? null : Number(row.encoded_tile_count),
      nodeCount: row?.node_count == null ? null : Number(row.node_count),
      memberCount: row?.member_count == null ? null : Number(row.member_count),
      activeLeaseOwner: row?.active_lease_owner ?? null,
      activeLeaseAgeSeconds: row?.active_lease_age_seconds == null ? null : Number(row.active_lease_age_seconds),
      lastAuditAction: row?.last_audit_action ?? null,
      lastAuditReason: row?.last_audit_reason ?? null,
    };
  } catch (error) {
    if (isMissingPyramidSchemaError(error)) {
      return {
        ...health,
        previousVersionId: null,
        manifestTileCount: null,
        encodedTileCount: null,
        nodeCount: null,
        memberCount: null,
        activeLeaseOwner: null,
        activeLeaseAgeSeconds: null,
        lastAuditAction: null,
        lastAuditReason: null,
      };
    }
    throw error;
  }
}

export async function runPropertyTilePyramidRetention(): Promise<Record<string, unknown>> {
  try {
    const lock = await db.execute<{ locked: boolean }>(sql`
      SELECT pg_try_advisory_lock(hashtext(${PYRAMID_CURRENT_ADVISORY_LOCK})) AS locked
    `);
    if (!Array.from(lock)[0]?.locked) {
      return { status: 'skipped', reason: 'retention-lock-held' };
    }

    try {
      const result = await db.execute<{ deleted_versions: number }>(sql`
        WITH retained AS (
          SELECT current_version_id AS id
          FROM property_tile_pyramid_current
          UNION
          SELECT id
          FROM (
            SELECT
              id,
              row_number() OVER (
                PARTITION BY coverage_id, filter_signature, max_zoom, pyramid_kind
                ORDER BY promoted_at DESC NULLS LAST
              ) AS retained_rank
            FROM property_tile_pyramid_versions
            WHERE status = 'promoted'
          ) promoted
          WHERE retained_rank <= 2
        ),
        deleted AS (
          DELETE FROM property_tile_pyramid_versions v
          WHERE v.id NOT IN (SELECT id FROM retained)
            AND v.status IN ('failed_retryable', 'failed_terminal', 'superseded')
            AND COALESCE(v.updated_at, now()) < now() - interval '24 hours'
            AND (v.lease_until IS NULL OR v.lease_until < now())
          RETURNING 1
        )
        SELECT count(*)::int AS deleted_versions FROM deleted
      `);
      return {
        status: 'completed',
        deletedVersions: Number(Array.from(result)[0]?.deleted_versions ?? 0),
      };
    } finally {
      await db.execute(sql`SELECT pg_advisory_unlock(hashtext(${PYRAMID_CURRENT_ADVISORY_LOCK}))`);
    }
  } catch (error) {
    if (isMissingPyramidSchemaError(error)) {
      return { status: 'skipped', reason: 'pyramid-schema-unavailable' };
    }
    throw error;
  }
}
