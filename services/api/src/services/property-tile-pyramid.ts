import { createHash, randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import {
  PROPERTY_ADDRESS_INTERACTION_MIN_ZOOM,
  PROPERTY_MAP_FOOTPRINTS,
  PROPERTY_PREVIEW_MEMBER_LIMIT,
} from '@huishype/shared/config';
import { db, reserveDbConnection, type DbTransaction } from '../db/index.js';
import { createDefaultMapFilters, getMapFilterSignature, type MapFilters } from './map-filters.js';
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
import { getOfficialValuationSourceConfig } from './official-valuations/registry.js';

const DEFAULT_MAX_ZOOM = 10;
const DEFAULT_CHUNK_TILE_LIMIT = 128;
const DEFAULT_MEMBER_PAGE_SIZE = 5_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_LEASE_SECONDS = 900;
const DEFAULT_MAX_HEAP_MB = 1_024;
const DEFAULT_MAX_MEMBER_ROWS = 5_000_000;
const DEFAULT_MAX_WAL_BYTES_PER_CHUNK = 1_073_741_824;
const DEFAULT_MAX_WAL_BYTES_PER_BUILD = 10 * 1_073_741_824;
const PROPERTY_TILE_PYRAMID_RETENTION_CHUNK_LIMIT = 10_000;
const PROPERTY_TILE_GROUPING_FACT_INSERT_BATCH_SIZE = 10_000;
const DEFAULT_PROPERTY_TILE_PYRAMID_RETENTION_MAX_CHUNKS_PER_STEP = 25;
const PROPERTY_TILE_PYRAMID_PREFLIGHT_TILE_HEAP_BYTES = 250;
const PROPERTY_TILE_PYRAMID_PREFLIGHT_TILE_INDEX_BYTES = 80;
const PROPERTY_TILE_PYRAMID_PREFLIGHT_SOURCE_PLAN_BYTES = 24;
const PYRAMID_RETENTION_ADVISORY_LOCK = 'property_tile_pyramid_retention';
const PYRAMID_BACKFILL_ADVISORY_LOCK = 'property_tile_pyramid_backfill';
const PROPERTY_TILE_PYRAMID_MIN_ZOOM = 0;
const PROPERTY_TILE_PYRAMID_MVT_BUFFER = 256;
const PROPERTY_TILE_PYRAMID_MVT_LAYER_NAME = 'properties';
const PROPERTY_TILE_PYRAMID_SINGLE_TAP_RADIUS_PX = 24;
const PROPERTY_TILE_PYRAMID_CLUSTER_TAP_RADIUS_PX = 36;
const PROPERTY_TILE_PYRAMID_REPAIR_REASONS = new Set<string>([
  'manifest-missing',
  'payload-regeneration-error',
]);
const WOZ_SOURCE_CONFIG = getOfficialValuationSourceConfig('woz');

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

export type PropertyTilePyramidCoverageBounds = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  maxZoom: number;
};

export interface CurrentPropertyTilePyramidVersion extends PropertyTilePyramidSlot {
  versionId: string;
  buildInputsHash: string;
  sourceWatermarkHash: string;
  status: 'promoted';
  promotedAt: string | null;
  degradedAt: string | null;
  degradedReason: string | null;
  coverage?: PropertyTilePyramidCoverageBounds;
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
  status: 'enqueued' | 'coalesced' | 'backoff' | 'terminal' | 'unavailable' | 'enqueue_failed';
  versionId?: string;
  queueJobId?: string;
  existingStatus?: PropertyTilePyramidStatus;
  nextRetryAt?: string | null;
  reason?: string;
}

export type PropertyTilePyramidMutationBuildPolicy = 'listing' | 'social' | 'views';

const PROPERTY_TILE_PYRAMID_MUTATION_BUILD_POLICIES: Record<
  PropertyTilePyramidMutationBuildPolicy,
  { coalesceMs: number; maxLagMs: number; mutationThreshold?: bigint }
> = {
  listing: {
    coalesceMs: 60 * 1000,
    maxLagMs: 15 * 60 * 1000,
  },
  social: {
    coalesceMs: 5 * 60 * 1000,
    maxLagMs: 15 * 60 * 1000,
  },
  views: {
    coalesceMs: 5 * 60 * 1000,
    maxLagMs: 15 * 60 * 1000,
    mutationThreshold: 10_000n,
  },
};

const PROPERTY_TILE_PYRAMID_WORKER_RECOVERY_MUTATION_POLICIES: Array<{
  policy: PropertyTilePyramidMutationBuildPolicy;
  scopes: PropertyTilePyramidSourceWatermarkScope[];
}> = [
  { policy: 'listing', scopes: ['listing_facts', 'property_status'] },
  { policy: 'social', scopes: ['social_inputs'] },
  { policy: 'views', scopes: ['views_engagement'] },
];

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
  closedWatermarkMaxUpdatedAt: string | null;
  currentWatermarkMaxUpdatedAt: string | null;
  closedToCurrentWatermarkLagSeconds: number | null;
  lastSuccessfulPromotionAt: string | null;
  resourceControls: {
    chunkTileLimit: number;
    memberPageSize: number;
    statementTimeoutMs: number;
    leaseSeconds: number;
    maxHeapMb: number;
    maxMemberRows: number;
    maxWalBytesPerChunk: number;
    maxWalBytesPerBuild: number;
  };
}

export interface PropertyTilePyramidOpsSummary extends PropertyTilePyramidHealthSummary {
  previousVersionId: string | null;
  manifestTileCount: number | null;
  encodedTileCount: number | null;
  nodeCount: number | null;
  memberCount: number | null;
  currentBuildDurationMs: number | null;
  currentObservedWalBytes: number | null;
  activeCandidateStage: string | null;
  activeCandidateBuildDurationMs: number | null;
  activeCandidateChunkProgress: Record<string, unknown> | null;
  activeCandidateObservedWalBytes: number | null;
  activeLeaseOwner: string | null;
  activeLeaseAgeSeconds: number | null;
  lastAuditAction: string | null;
  lastAuditReason: string | null;
}

export type PropertyTilePyramidCoverageCheck = {
  z: number;
  x: number;
  y: number;
  maxZoom?: number;
};

type PropertyTilePyramidWatermarkExecutor =
  | Pick<typeof db, 'execute'>
  | Pick<DbTransaction, 'execute'>;

type PropertyTilePyramidBuildLogger = {
  warn: (bindings: Record<string, unknown>, message: string) => void;
};

type VersionBoundPropertyTilePyramidCoverage = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  maxZoom: number;
};

type VersionBoundPropertyTilePyramidBuildContext = {
  coverage: VersionBoundPropertyTilePyramidCoverage;
  filters: MapFilters;
  resourceControls: PropertyTilePyramidHealthSummary['resourceControls'];
};

type PropertyTileCandidateSourceSnapshot = {
  id: string;
  sourceWatermarkHash: string;
  comparableSourceWatermarkHash: string;
  sourceWatermarksJson: Record<string, unknown>;
};

type PropertyTilePyramidBuildLease = {
  versionId: string;
  owner: string;
  token: string;
};

type PropertyTileCandidateSourceSnapshotBuildHeartbeat = {
  lease: PropertyTilePyramidBuildLease;
  leaseSeconds: number;
};

type PropertyTilePyramidBuildCandidateRow = {
  id: string;
  status: PropertyTilePyramidStatus;
  coverage_id: string;
  filter_signature: string;
  max_zoom: number;
  pyramid_kind: string;
  config_hash: string;
  build_inputs_hash: string;
  source_watermark_hash: string;
  source_watermarks_json: Record<string, unknown> | null;
  candidate_snapshot_id: string | null;
  coverage_snapshot_json: Record<string, unknown>;
  config_snapshot_json: Record<string, unknown>;
  grouping_constants_json: Record<string, unknown>;
  pending_replacement_watermarks_json: Record<string, unknown> | null;
  requested_at: string | null;
  lease_token: string;
  backfill_lock_required: boolean;
  backfill_lock_acquired: boolean;
};

class PropertyTilePyramidLeaseLostError extends Error {
  constructor(versionId: string) {
    super(`Property tile pyramid build lease lost for version ${versionId}`);
    this.name = 'PropertyTilePyramidLeaseLostError';
  }
}

function parseIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') {
    return fallback;
  }

  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`${name} must be an integer, received "${raw}"`);
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a safe integer, received "${raw}"`);
  }

  return parsed;
}

function parseNonNegativeIntegerEnv(name: string, fallback: number, max?: number): number {
  const parsed = parseIntegerEnv(name, fallback);
  if (parsed < 0 || (max != null && parsed > max)) {
    const range = max == null ? 'a non-negative integer' : `an integer between 0 and ${max}`;
    throw new Error(`${name} must be ${range}, received "${process.env[name]}"`);
  }
  return parsed;
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = parseIntegerEnv(name, fallback);
  if (parsed <= 0) {
    throw new Error(`${name} must be a positive integer, received "${process.env[name]}"`);
  }
  return parsed;
}

export function getPropertyTilePyramidMaxZoom(): number {
  return parseNonNegativeIntegerEnv('PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM', DEFAULT_MAX_ZOOM, 22);
}

export function getDefaultPropertyTilePyramidSlot(): PropertyTilePyramidSlot {
  return {
    coverageId:
      process.env.PROPERTY_TILE_PYRAMID_COVERAGE_ID ?? DEFAULT_PROPERTY_TILE_PYRAMID_COVERAGE_ID,
    filterSignature: DEFAULT_PROPERTY_TILE_PYRAMID_FILTER_SIGNATURE,
    maxZoom: getPropertyTilePyramidMaxZoom(),
    pyramidKind: PROPERTY_TILE_PYRAMID_KIND,
  };
}

function clampPyramidTileCoordinate(value: number, zoom: number): number {
  const max = 2 ** zoom - 1;
  return Math.max(0, Math.min(max, value));
}

function lonToPyramidTileX(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

function latToPyramidTileY(lat: number, zoom: number): number {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom
  );
}

export function isDefaultPropertyTilePyramidPointCovered(input: {
  lon: number;
  lat: number;
  zoom: number;
  maxZoom?: number;
}): boolean {
  const coverage = getExpectedDefaultPropertyTileSnapshotCoverageDefinition();
  return isPropertyTilePyramidPointCoveredByCoverage({
    coverage: {
      minLon: coverage.minLon,
      minLat: coverage.minLat,
      maxLon: coverage.maxLon,
      maxLat: coverage.maxLat,
      maxZoom: input.maxZoom ?? coverage.maxZoom,
    },
    lon: input.lon,
    lat: input.lat,
    zoom: input.zoom,
  });
}

export function isPropertyTilePyramidPointCoveredByCoverage(input: {
  coverage: PropertyTilePyramidCoverageBounds;
  lon: number;
  lat: number;
  zoom: number;
}): boolean {
  return (
    input.zoom <= input.coverage.maxZoom &&
    input.lon >= input.coverage.minLon &&
    input.lon <= input.coverage.maxLon &&
    input.lat >= input.coverage.minLat &&
    input.lat <= input.coverage.maxLat
  );
}

export function isDefaultPropertyTilePyramidTileCovered(
  input: PropertyTilePyramidCoverageCheck
): boolean {
  const coverage = getExpectedDefaultPropertyTileSnapshotCoverageDefinition();
  return isPropertyTilePyramidTileCoveredByCoverage({
    coverage: {
      minLon: coverage.minLon,
      minLat: coverage.minLat,
      maxLon: coverage.maxLon,
      maxLat: coverage.maxLat,
      maxZoom: input.maxZoom ?? coverage.maxZoom,
    },
    z: input.z,
    x: input.x,
    y: input.y,
  });
}

export function isPropertyTilePyramidTileCoveredByCoverage(input: {
  coverage: PropertyTilePyramidCoverageBounds;
  z: number;
  x: number;
  y: number;
}): boolean {
  if (input.z > input.coverage.maxZoom) {
    return false;
  }

  const minX = clampPyramidTileCoordinate(
    lonToPyramidTileX(input.coverage.minLon, input.z),
    input.z
  );
  const maxX = clampPyramidTileCoordinate(
    lonToPyramidTileX(input.coverage.maxLon, input.z),
    input.z
  );
  const minY = clampPyramidTileCoordinate(
    latToPyramidTileY(input.coverage.maxLat, input.z),
    input.z
  );
  const maxY = clampPyramidTileCoordinate(
    latToPyramidTileY(input.coverage.minLat, input.z),
    input.z
  );

  return input.x >= minX && input.x <= maxX && input.y >= minY && input.y <= maxY;
}

export function getPropertyTilePyramidResourceControls(): PropertyTilePyramidHealthSummary['resourceControls'] {
  return {
    chunkTileLimit: parsePositiveIntegerEnv(
      'PROPERTY_TILE_PYRAMID_CHUNK_TILE_LIMIT',
      DEFAULT_CHUNK_TILE_LIMIT
    ),
    memberPageSize: parsePositiveIntegerEnv(
      'PROPERTY_TILE_PYRAMID_MEMBER_PAGE_SIZE',
      DEFAULT_MEMBER_PAGE_SIZE
    ),
    statementTimeoutMs: parsePositiveIntegerEnv(
      'PROPERTY_TILE_PYRAMID_STATEMENT_TIMEOUT_MS',
      DEFAULT_STATEMENT_TIMEOUT_MS
    ),
    leaseSeconds: parsePositiveIntegerEnv(
      'PROPERTY_TILE_PYRAMID_LEASE_SECONDS',
      DEFAULT_LEASE_SECONDS
    ),
    maxHeapMb: parsePositiveIntegerEnv('PROPERTY_TILE_PYRAMID_MAX_HEAP_MB', DEFAULT_MAX_HEAP_MB),
    maxMemberRows: parsePositiveIntegerEnv(
      'PROPERTY_TILE_PYRAMID_MAX_MEMBER_ROWS',
      DEFAULT_MAX_MEMBER_ROWS
    ),
    maxWalBytesPerChunk: parsePositiveIntegerEnv(
      'PROPERTY_TILE_PYRAMID_MAX_WAL_BYTES_PER_CHUNK',
      DEFAULT_MAX_WAL_BYTES_PER_CHUNK
    ),
    maxWalBytesPerBuild: parsePositiveIntegerEnv(
      'PROPERTY_TILE_PYRAMID_MAX_WAL_BYTES_PER_BUILD',
      DEFAULT_MAX_WAL_BYTES_PER_BUILD
    ),
  };
}

function getPropertyTilePyramidRetentionMaxChunksPerStep(): number {
  return parsePositiveIntegerEnv(
    'PROPERTY_TILE_PYRAMID_RETENTION_MAX_CHUNKS_PER_STEP',
    DEFAULT_PROPERTY_TILE_PYRAMID_RETENTION_MAX_CHUNKS_PER_STEP
  );
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
  return createHash('sha256').update(stableJson(rows)).digest('hex');
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

function buildRepairSourceWatermarkSnapshot(input: {
  baseSourceWatermarkHash: string;
  baseSourceWatermarksJson: Record<string, unknown>;
  reason: string;
  slot: PropertyTilePyramidSlot;
}): { sourceWatermarkHash: string; sourceWatermarksJson: Record<string, unknown> } {
  const baseComparableSourceWatermarkHash = comparableSourceWatermarkHash({
    sourceWatermarkHash: input.baseSourceWatermarkHash,
    sourceWatermarksJson: input.baseSourceWatermarksJson,
  });
  const repair = {
    baseComparableSourceWatermarkHash,
    baseSourceWatermarkHash: input.baseSourceWatermarkHash,
    reason: input.reason,
    repairId: randomUUID(),
    requestedAt: new Date().toISOString(),
    slot: input.slot,
  };
  return {
    sourceWatermarkHash: stableSha256({
      sourceWatermarkHash: input.baseSourceWatermarkHash,
      repair,
    }),
    sourceWatermarksJson: {
      ...input.baseSourceWatermarksJson,
      propertyTilePyramidRepair: repair,
    },
  };
}

function comparableSourceWatermarkHash(input: {
  sourceWatermarkHash: string;
  sourceWatermarksJson: Record<string, unknown> | null;
}): string {
  const repair = input.sourceWatermarksJson?.propertyTilePyramidRepair;
  if (repair && typeof repair === 'object' && !Array.isArray(repair)) {
    const baseComparableSourceWatermarkHash = (repair as Record<string, unknown>)
      .baseComparableSourceWatermarkHash;
    if (
      typeof baseComparableSourceWatermarkHash === 'string' &&
      baseComparableSourceWatermarkHash.length > 0
    ) {
      return baseComparableSourceWatermarkHash;
    }
  }
  const comparableHash = input.sourceWatermarksJson?.comparableSourceWatermarkHash;
  if (typeof comparableHash === 'string' && comparableHash.length > 0) {
    return comparableHash;
  }
  if (repair && typeof repair === 'object' && !Array.isArray(repair)) {
    const baseSourceWatermarkHash = (repair as Record<string, unknown>).baseSourceWatermarkHash;
    if (typeof baseSourceWatermarkHash === 'string' && baseSourceWatermarkHash.length > 0) {
      return baseSourceWatermarkHash;
    }
  }
  return input.sourceWatermarkHash;
}

function getSourceWatermarkSources(
  sourceWatermarksJson: Record<string, unknown> | null | undefined
): Array<Record<string, unknown>> {
  const sources = sourceWatermarksJson?.sources;
  return Array.isArray(sources)
    ? sources.filter(
        (source): source is Record<string, unknown> =>
          Boolean(source) && typeof source === 'object' && !Array.isArray(source)
      )
    : [];
}

function isPropertyTileProjectionFingerprintSource(source: Record<string, unknown>): boolean {
  return (
    source.source === 'property_tile_listing_candidates' ||
    source.source === 'property_tile_listing_facts' ||
    source.source === 'property_tile_social_facts' ||
    source.source === 'property_tile_grouping_facts'
  );
}

function readRollingSocialWindowCutoffAt(
  sourceWatermarksJson: Record<string, unknown> | null | undefined
): string | null {
  const rollingSource = getSourceWatermarkSources(sourceWatermarksJson).find(
    (source) => source.source === 'rolling_social_window'
  );
  const cutoffAt = rollingSource?.cutoffAt;
  return typeof cutoffAt === 'string' && cutoffAt.length > 0 ? cutoffAt : null;
}

class SourceWatermarkAdvancedBeforeCandidateSnapshotClosureError extends Error {
  constructor(
    readonly latestSourceWatermarks: {
      sourceWatermarkHash: string;
      sourceWatermarksJson: Record<string, unknown>;
    }
  ) {
    super('Source watermarks advanced before candidate source snapshot closure');
  }
}

async function readReadyPropertyTileCandidateSourceSnapshot(input: {
  slot: PropertyTilePyramidSlot;
  comparableSourceWatermarkHash: string;
}): Promise<PropertyTileCandidateSourceSnapshot | null> {
  const rows = await db.execute<{
    id: string;
    source_watermark_hash: string;
    comparable_source_watermark_hash: string;
    source_watermarks_json: Record<string, unknown> | null;
  }>(sql`
    SELECT
      id::text,
      source_watermark_hash,
      comparable_source_watermark_hash,
      source_watermarks_json
    FROM property_tile_candidate_source_snapshots
    WHERE coverage_id = ${input.slot.coverageId}
      AND filter_signature = ${input.slot.filterSignature}
      AND pyramid_kind = ${input.slot.pyramidKind}::property_tile_pyramid_kind
      AND comparable_source_watermark_hash = ${input.comparableSourceWatermarkHash}
      AND status = 'ready'
      AND social_fact_row_count IS NOT NULL
      AND grouping_fact_row_count IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const row = Array.from(rows)[0];
  return row
    ? {
        id: row.id,
        sourceWatermarkHash: row.source_watermark_hash,
        comparableSourceWatermarkHash: row.comparable_source_watermark_hash,
        sourceWatermarksJson: row.source_watermarks_json ?? {},
      }
    : null;
}

async function readReadyPropertyTileCandidateSourceSnapshotById(input: {
  snapshotId: string;
  slot: PropertyTilePyramidSlot;
}): Promise<PropertyTileCandidateSourceSnapshot | null> {
  const rows = await db.execute<{
    id: string;
    coverage_id: string;
    filter_signature: string;
    pyramid_kind: string;
    source_watermark_hash: string;
    comparable_source_watermark_hash: string;
    source_watermarks_json: Record<string, unknown> | null;
    status: string;
  }>(sql`
    SELECT
      id::text,
      coverage_id,
      filter_signature,
      pyramid_kind::text,
      source_watermark_hash,
      comparable_source_watermark_hash,
      source_watermarks_json,
      status
    FROM property_tile_candidate_source_snapshots
    WHERE id = ${input.snapshotId}::uuid
      AND social_fact_row_count IS NOT NULL
      AND grouping_fact_row_count IS NOT NULL
    LIMIT 1
  `);
  const row = Array.from(rows)[0];
  if (!row) {
    return null;
  }
  if (
    row.status !== 'ready' ||
    row.coverage_id !== input.slot.coverageId ||
    row.filter_signature !== input.slot.filterSignature ||
    row.pyramid_kind !== input.slot.pyramidKind
  ) {
    return null;
  }
  return {
    id: row.id,
    sourceWatermarkHash: row.source_watermark_hash,
    comparableSourceWatermarkHash: row.comparable_source_watermark_hash,
    sourceWatermarksJson: row.source_watermarks_json ?? {},
  };
}

function buildCandidateSourceSnapshotAudit(
  snapshot: PropertyTileCandidateSourceSnapshot
): Record<string, unknown> {
  return {
    id: snapshot.id,
    sourceWatermarkHash: snapshot.sourceWatermarkHash,
    comparableSourceWatermarkHash: snapshot.comparableSourceWatermarkHash,
    sourceWatermarksJsonHash: stableSha256(snapshot.sourceWatermarksJson),
  };
}

async function rebuildPropertyTileCandidateSourceSnapshot(input: {
  slot: PropertyTilePyramidSlot;
  sourceWatermarkHash: string;
  sourceWatermarksJson: Record<string, unknown>;
  comparableSourceWatermarkHash: string;
  heartbeat?: PropertyTileCandidateSourceSnapshotBuildHeartbeat;
}): Promise<PropertyTileCandidateSourceSnapshot> {
  const heartbeat = async (phase: string, groupingBatchesCompleted?: number) => {
    if (!input.heartbeat) {
      return;
    }
    await updatePropertyTilePyramidBuildLease({
      lease: input.heartbeat.lease,
      sql: sql`
        WITH updated AS (
          UPDATE property_tile_pyramid_versions
          SET
            lease_until = now() + (${input.heartbeat.leaseSeconds} || ' seconds')::interval,
            validation_summary = jsonb_set(
              COALESCE(validation_summary, '{}'::jsonb),
              '{candidateSourceSnapshotProgress}',
              jsonb_strip_nulls(jsonb_build_object(
                'phase', ${phase}::text,
                'groupingBatchesCompleted', ${groupingBatchesCompleted ?? null}::int,
                'updatedAt', clock_timestamp()::text
              )),
              true
            ),
            updated_at = now()
          WHERE id = ${input.heartbeat.lease.versionId}::uuid
            AND lease_owner = ${input.heartbeat.lease.owner}
            AND lease_token = ${input.heartbeat.lease.token}
            AND lease_until > now()
            AND status = 'building'
          RETURNING 1
        )
        SELECT count(*)::int AS affected FROM updated
      `,
    });
  };

  return await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
    const transactionalSourceWatermarks = await readPropertyTilePyramidSourceWatermarkSnapshot(tx);
    const transactionalComparableHash = comparableSourceWatermarkHash(
      transactionalSourceWatermarks
    );
    if (transactionalComparableHash !== input.comparableSourceWatermarkHash) {
      throw new SourceWatermarkAdvancedBeforeCandidateSnapshotClosureError(
        transactionalSourceWatermarks
      );
    }

    await tx.execute(sql`
      UPDATE property_tile_candidate_source_snapshots
      SET
        status = 'superseded',
        updated_at = clock_timestamp()
      WHERE coverage_id = ${input.slot.coverageId}
        AND filter_signature = ${input.slot.filterSignature}
        AND pyramid_kind = ${input.slot.pyramidKind}::property_tile_pyramid_kind
        AND comparable_source_watermark_hash = ${input.comparableSourceWatermarkHash}
        AND status = 'ready'
        AND (
          social_fact_row_count IS NULL
          OR grouping_fact_row_count IS NULL
        )
    `);

    const insertedRows = await tx.execute<{ id: string }>(sql`
      INSERT INTO property_tile_candidate_source_snapshots (
        coverage_id,
        filter_signature,
        pyramid_kind,
        source_watermark_hash,
        comparable_source_watermark_hash,
        source_watermarks_json,
        status,
        build_started_at,
        updated_at
      )
      VALUES (
        ${input.slot.coverageId},
        ${input.slot.filterSignature},
        ${input.slot.pyramidKind}::property_tile_pyramid_kind,
        ${input.sourceWatermarkHash},
        ${input.comparableSourceWatermarkHash},
        ${JSON.stringify(input.sourceWatermarksJson)}::jsonb,
        'building',
        clock_timestamp(),
        clock_timestamp()
      )
      RETURNING id::text
    `);
    const snapshotId = Array.from(insertedRows)[0]?.id;
    if (!snapshotId) {
      throw new Error('Failed to create property tile candidate source snapshot');
    }
    const closedSocialActivityCutoffAt =
      readRollingSocialWindowCutoffAt(input.sourceWatermarksJson) ?? new Date().toISOString();

    await tx.execute(sql`
      INSERT INTO property_tile_listing_candidates (
        snapshot_id,
        property_id,
        geometry,
        official_valuation,
        updated_at
      )
      SELECT
        ${snapshotId}::uuid,
        p.id,
        p.geometry,
        p.official_valuation,
        now()
      FROM properties p
      WHERE p.geometry IS NOT NULL
        AND p.status = 'active'
        AND EXISTS (
          SELECT 1
          FROM canonical_listings cl
          WHERE cl.property_id = p.id
            AND cl.verification_state <> 'invalid'
            AND cl.status IN ('active', 'sold', 'rented')
        )
      ON CONFLICT (snapshot_id, property_id) DO NOTHING
    `);
    await heartbeat('listing-candidates');

    await tx.execute(sql`
      WITH latest_listing AS MATERIALIZED (
        SELECT DISTINCT ON (cl.property_id)
          cl.property_id,
          cl.status::text AS status
        FROM canonical_listings cl
        WHERE cl.verification_state <> 'invalid'
        ORDER BY
          cl.property_id,
          COALESCE(
            cl.last_reconciled_at,
            cl.last_mirror_seen_at,
            cl.last_user_seen_at,
            cl.last_seen_at,
            cl.updated_at,
            cl.created_at
          ) DESC,
          cl.created_at DESC,
          cl.id DESC
      ),
      active_listing AS MATERIALIZED (
        SELECT DISTINCT ON (cl.property_id)
          cl.property_id,
          CASE
            WHEN lower(cl.source_name) = 'funda'
              AND lower(btrim(cl.price_type)) = 'buy'
              THEN 'sale'
            WHEN lower(btrim(cl.price_type)) IN ('sale', 'rent')
              THEN lower(btrim(cl.price_type))
            WHEN lower(cl.source_name) = 'pararius'
              THEN 'rent'
            ELSE 'sale'
          END AS price_type
        FROM canonical_listings cl
        WHERE cl.verification_state <> 'invalid'
          AND cl.status = 'active'
        ORDER BY
          cl.property_id,
          COALESCE(
            cl.last_reconciled_at,
            cl.last_mirror_seen_at,
            cl.last_user_seen_at,
            cl.last_seen_at,
            cl.updated_at,
            cl.created_at
          ) DESC,
          cl.created_at DESC,
          cl.id DESC
      )
      INSERT INTO property_tile_listing_facts (
        snapshot_id,
        property_id,
        has_active_listing,
        has_completed_listing,
        market_state,
        updated_at
      )
      SELECT
        ${snapshotId}::uuid,
        latest_listing.property_id,
        active_listing.property_id IS NOT NULL AS has_active_listing,
        (
          active_listing.property_id IS NULL
          AND latest_listing.status IN ('sold', 'rented')
        ) AS has_completed_listing,
        CASE
          WHEN active_listing.property_id IS NOT NULL AND active_listing.price_type = 'rent'
            THEN 'for-rent'
          WHEN active_listing.property_id IS NOT NULL
            THEN 'for-sale'
          WHEN latest_listing.status = 'sold'
            THEN 'sold'
          WHEN latest_listing.status = 'rented'
            THEN 'rented'
          ELSE 'not-listed'
        END AS market_state,
        now()
      FROM latest_listing
      LEFT JOIN active_listing ON active_listing.property_id = latest_listing.property_id
      ON CONFLICT (snapshot_id, property_id) DO NOTHING
    `);
    await heartbeat('listing-facts');

    await tx.execute(sql`
      WITH latest_public_guesses AS MATERIALIZED (
        SELECT DISTINCT ON (pg.property_id, pg.user_id)
          pg.property_id,
          pg.user_id,
          GREATEST(pg.created_at, pg.updated_at) AS effective_at
        FROM price_guesses pg
        WHERE GREATEST(pg.created_at, pg.updated_at) <= ${closedSocialActivityCutoffAt}::timestamptz
        ORDER BY
          pg.property_id,
          pg.user_id,
          GREATEST(pg.created_at, pg.updated_at) DESC,
          pg.created_at DESC,
          pg.id DESC
      ),
      guess_activity AS MATERIALIZED (
        SELECT
          lpg.property_id,
          COUNT(*)::int AS guess_count,
          COUNT(*) FILTER (
            WHERE lpg.effective_at > ${closedSocialActivityCutoffAt}::timestamptz - INTERVAL '7 days'
              AND lpg.effective_at <= ${closedSocialActivityCutoffAt}::timestamptz
          )::int AS recent_guess_count,
          MAX(lpg.effective_at) AS latest_guess_at
        FROM latest_public_guesses lpg
        GROUP BY lpg.property_id
      ),
      top_level_comments AS MATERIALIZED (
        SELECT
          c.property_id,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (
            WHERE c.created_at > ${closedSocialActivityCutoffAt}::timestamptz - INTERVAL '7 days'
              AND c.created_at <= ${closedSocialActivityCutoffAt}::timestamptz
          )::int AS recent_count,
          MAX(c.created_at) AS latest
        FROM comments c
        WHERE c.parent_id IS NULL
          AND c.hidden_at IS NULL
          AND c.created_at <= ${closedSocialActivityCutoffAt}::timestamptz
        GROUP BY c.property_id
      ),
      replies AS MATERIALIZED (
        SELECT
          c.property_id,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (
            WHERE c.created_at > ${closedSocialActivityCutoffAt}::timestamptz - INTERVAL '7 days'
              AND c.created_at <= ${closedSocialActivityCutoffAt}::timestamptz
          )::int AS recent_count,
          MAX(c.created_at) AS latest
        FROM comments c
        WHERE c.parent_id IS NOT NULL
          AND c.hidden_at IS NULL
          AND c.created_at <= ${closedSocialActivityCutoffAt}::timestamptz
        GROUP BY c.property_id
      ),
      property_likes AS MATERIALIZED (
        SELECT
          r.target_id AS property_id,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (
            WHERE r.created_at > ${closedSocialActivityCutoffAt}::timestamptz - INTERVAL '7 days'
              AND r.created_at <= ${closedSocialActivityCutoffAt}::timestamptz
          )::int AS recent_count,
          MAX(r.created_at) AS latest
        FROM reactions r
        WHERE r.target_type = 'property'
          AND r.reaction_type = 'like'
          AND r.created_at <= ${closedSocialActivityCutoffAt}::timestamptz
        GROUP BY r.target_id
      ),
      comment_likes AS MATERIALIZED (
        SELECT
          c.property_id,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (
            WHERE r.created_at > ${closedSocialActivityCutoffAt}::timestamptz - INTERVAL '7 days'
              AND r.created_at <= ${closedSocialActivityCutoffAt}::timestamptz
          )::int AS recent_count,
          MAX(r.created_at) AS latest
        FROM reactions r
        INNER JOIN comments c ON c.id = r.target_id
        WHERE r.target_type = 'comment'
          AND r.reaction_type = 'like'
          AND c.hidden_at IS NULL
          AND r.created_at <= ${closedSocialActivityCutoffAt}::timestamptz
        GROUP BY c.property_id
      ),
      view_facts AS MATERIALIZED (
        SELECT
          pv.property_id,
          COUNT(*)::int AS view_count,
          COUNT(*) FILTER (
            WHERE pv.viewed_at > ${closedSocialActivityCutoffAt}::timestamptz - INTERVAL '7 days'
              AND pv.viewed_at <= ${closedSocialActivityCutoffAt}::timestamptz
          )::int AS recent_view_count,
          COUNT(DISTINCT COALESCE(pv.user_id::text, pv.session_id))::int AS unique_viewer_count,
          COUNT(DISTINCT COALESCE(pv.user_id::text, pv.session_id)) FILTER (
            WHERE pv.viewed_at > ${closedSocialActivityCutoffAt}::timestamptz - INTERVAL '7 days'
              AND pv.viewed_at <= ${closedSocialActivityCutoffAt}::timestamptz
          )::int AS recent_unique_viewer_count,
          MAX(pv.viewed_at) AS latest
        FROM property_views pv
        WHERE pv.viewed_at <= ${closedSocialActivityCutoffAt}::timestamptz
        GROUP BY pv.property_id
      ),
      social_property_ids AS MATERIALIZED (
        SELECT property_id FROM guess_activity
        UNION
        SELECT property_id FROM top_level_comments
        UNION
        SELECT property_id FROM replies
        UNION
        SELECT property_id FROM property_likes
        UNION
        SELECT property_id FROM comment_likes
        UNION
        SELECT property_id FROM view_facts
      )
      INSERT INTO property_tile_social_facts (
        snapshot_id,
        property_id,
        geometry,
        official_valuation,
        top_level_comment_count,
        reply_count,
        property_like_count,
        comment_like_count,
        guess_count,
        view_count,
        unique_viewer_count,
        recent_top_level_comment_count,
        recent_reply_count,
        recent_property_like_count,
        recent_comment_like_count,
        recent_guess_count,
        recent_view_count,
        recent_unique_viewer_count,
        social_score,
        recent_social_score,
        last_social_at,
        updated_at
      )
      SELECT
        ${snapshotId}::uuid,
        p.id,
        p.geometry,
        p.official_valuation,
        COALESCE(top_level_comments.count, 0)::int,
        COALESCE(replies.count, 0)::int,
        COALESCE(property_likes.count, 0)::int,
        COALESCE(comment_likes.count, 0)::int,
        COALESCE(guess_activity.guess_count, 0)::int,
        COALESCE(view_facts.view_count, 0)::int,
        COALESCE(view_facts.unique_viewer_count, 0)::int,
        COALESCE(top_level_comments.recent_count, 0)::int,
        COALESCE(replies.recent_count, 0)::int,
        COALESCE(property_likes.recent_count, 0)::int,
        COALESCE(comment_likes.recent_count, 0)::int,
        COALESCE(guess_activity.recent_guess_count, 0)::int,
        COALESCE(view_facts.recent_view_count, 0)::int,
        COALESCE(view_facts.recent_unique_viewer_count, 0)::int,
        (
          COALESCE(top_level_comments.count, 0)::double precision
          + COALESCE(replies.count, 0)::double precision
          + COALESCE(property_likes.count, 0)::double precision
          + COALESCE(comment_likes.count, 0)::double precision * 0.8
          + COALESCE(guess_activity.guess_count, 0)::double precision * 0.85
          + COALESCE(view_facts.unique_viewer_count, 0)::double precision * 0.1
        )::double precision,
        (
          COALESCE(top_level_comments.recent_count, 0)::double precision
          + COALESCE(replies.recent_count, 0)::double precision
          + COALESCE(property_likes.recent_count, 0)::double precision
          + COALESCE(comment_likes.recent_count, 0)::double precision * 0.8
          + COALESCE(guess_activity.recent_guess_count, 0)::double precision * 0.85
          + COALESCE(view_facts.recent_unique_viewer_count, 0)::double precision * 0.1
        )::double precision,
        GREATEST(
          top_level_comments.latest,
          replies.latest,
          property_likes.latest,
          comment_likes.latest,
          guess_activity.latest_guess_at,
          view_facts.latest
        ),
        now()
      FROM social_property_ids spi
      INNER JOIN properties p ON p.id = spi.property_id
      LEFT JOIN top_level_comments ON top_level_comments.property_id = p.id
      LEFT JOIN replies ON replies.property_id = p.id
      LEFT JOIN property_likes ON property_likes.property_id = p.id
      LEFT JOIN comment_likes ON comment_likes.property_id = p.id
      LEFT JOIN guess_activity ON guess_activity.property_id = p.id
      LEFT JOIN view_facts ON view_facts.property_id = p.id
      WHERE p.geometry IS NOT NULL
        AND p.status = 'active'
      ON CONFLICT (snapshot_id, property_id) DO NOTHING
    `);
    await heartbeat('social-facts');

    let lastGroupingCandidatePropertyId: string | null = null;
    let groupingBatchesCompleted = 0;
    for (;;) {
      const groupingRows: Array<{
        batch_count: string | number;
        inserted_count: string | number;
        max_property_id: string | null;
      }> = await tx.execute(sql`
        WITH candidate_batch AS MATERIALIZED (
          SELECT
            lpc.property_id,
            lpc.geometry,
            lpc.official_valuation,
            p.country_code,
            p.city,
            p.region,
            p.postal_code,
            p.street,
            p.house_number,
            p.house_number_addition,
            p.official_valuation_year,
            NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE(p.city, ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), '') AS city_token,
            NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE(p.region, ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), '') AS region_token,
            NULLIF(REGEXP_REPLACE(UPPER(TRIM(COALESCE(p.postal_code, ''))), '\\s+', '', 'g'), '') AS postal_code_norm,
            NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE(p.street, ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), '') AS street_token
          FROM property_tile_listing_candidates lpc
          INNER JOIN properties p ON p.id = lpc.property_id
          WHERE lpc.snapshot_id = ${snapshotId}::uuid
            AND lpc.geometry IS NOT NULL
            AND lpc.property_id > COALESCE(
              ${lastGroupingCandidatePropertyId}::uuid,
              '00000000-0000-0000-0000-000000000000'::uuid
            )
          ORDER BY lpc.property_id
          LIMIT ${PROPERTY_TILE_GROUPING_FACT_INSERT_BATCH_SIZE}
        ),
        tile_listing_facts AS MATERIALIZED (
          SELECT
            cl.id AS listing_id,
            cl.property_id,
            cl.status::text AS status,
            CASE
              WHEN lower(cl.source_name) = 'funda'
                AND lower(btrim(cl.price_type)) = 'buy'
                THEN 'sale'
              WHEN lower(btrim(cl.price_type)) IN ('sale', 'rent')
                THEN lower(btrim(cl.price_type))
              WHEN lower(cl.source_name) = 'pararius'
                THEN 'rent'
              ELSE 'sale'
            END AS normalized_price_type,
            cl.asking_price,
            cl.thumbnail_url,
            COALESCE(
              cl.last_reconciled_at,
              cl.last_mirror_seen_at,
              cl.last_user_seen_at,
              cl.last_seen_at,
              cl.updated_at,
              cl.created_at
            ) AS sort_at,
            cl.created_at AS listing_created_at
          FROM canonical_listings cl
          INNER JOIN candidate_batch cb ON cb.property_id = cl.property_id
          WHERE cl.verification_state <> 'invalid'
        ),
        latest_listing AS MATERIALIZED (
          SELECT DISTINCT ON (l.property_id)
            l.property_id,
            l.status
          FROM tile_listing_facts l
          ORDER BY
            l.property_id,
            (l.status = 'active') DESC,
            l.sort_at DESC,
            l.listing_created_at DESC,
            l.listing_id DESC
        ),
        active_listing AS MATERIALIZED (
          SELECT DISTINCT ON (l.property_id)
            l.property_id,
            l.asking_price,
            l.normalized_price_type AS price_type
          FROM tile_listing_facts l
          WHERE l.status = 'active'
          ORDER BY
            l.property_id,
            (l.status = 'active') DESC,
            l.sort_at DESC,
            l.listing_created_at DESC,
            l.listing_id DESC
        ),
        listing_thumbnail AS MATERIALIZED (
          SELECT DISTINCT ON (l.property_id)
            l.property_id,
            l.thumbnail_url
          FROM tile_listing_facts l
          WHERE l.thumbnail_url IS NOT NULL
          ORDER BY
            l.property_id,
            (l.status = 'active') DESC,
            l.sort_at DESC,
            l.listing_created_at DESC,
            l.listing_id DESC
        ),
        sold_history AS MATERIALIZED (
          SELECT DISTINCT ON (ph.property_id)
            ph.property_id,
            ph.price AS last_sold_price
          FROM price_history ph
          INNER JOIN candidate_batch cb ON cb.property_id = ph.property_id
          WHERE ph.event_type = 'sold'
          ORDER BY ph.property_id, ph.price_date DESC, ph.created_at DESC, ph.id DESC
        ),
        rented_history AS MATERIALIZED (
          SELECT DISTINCT ON (ph.property_id)
            ph.property_id,
            ph.price AS last_rented_price
          FROM price_history ph
          INNER JOIN candidate_batch cb ON cb.property_id = ph.property_id
          WHERE ph.event_type = 'rented'
          ORDER BY ph.property_id, ph.price_date DESC, ph.created_at DESC, ph.id DESC
        ),
        latest_public_guesses AS MATERIALIZED (
          SELECT DISTINCT ON (pg.property_id, pg.user_id)
            pg.property_id,
            pg.user_id,
            pg.guessed_price,
            pg.is_meme_guess,
            GREATEST(pg.created_at, pg.updated_at) AS effective_at
          FROM price_guesses pg
          INNER JOIN candidate_batch cb ON cb.property_id = pg.property_id
          WHERE GREATEST(pg.created_at, pg.updated_at) <= ${closedSocialActivityCutoffAt}::timestamptz
          ORDER BY
            pg.property_id,
            pg.user_id,
            GREATEST(pg.created_at, pg.updated_at) DESC,
            pg.created_at DESC,
            pg.id DESC
        ),
        guess_facts AS MATERIALIZED (
          SELECT
            lpg.property_id,
            CASE
              WHEN COUNT(*) = 0 THEN NULL::bigint
              WHEN COUNT(*) <= 2 THEN ROUND(
                CASE
                  WHEN cb.official_valuation IS NOT NULL
                    THEN cb.official_valuation::numeric * 0.7
                      + (
                        SUM(lpg.guessed_price::numeric * GREATEST(u.karma, 1)::numeric)
                        / NULLIF(SUM(GREATEST(u.karma, 1)::numeric), 0)
                      ) * 0.3
                  ELSE (
                    SUM(lpg.guessed_price::numeric * GREATEST(u.karma, 1)::numeric)
                    / NULLIF(SUM(GREATEST(u.karma, 1)::numeric), 0)
                  )
                END
              )::bigint
              WHEN COUNT(*) <= 9 THEN ROUND(
                CASE
                  WHEN cb.official_valuation IS NOT NULL
                    THEN cb.official_valuation::numeric * 0.3
                      + (
                        SUM(lpg.guessed_price::numeric * GREATEST(u.karma, 1)::numeric)
                        / NULLIF(SUM(GREATEST(u.karma, 1)::numeric), 0)
                      ) * 0.7
                  ELSE (
                    SUM(lpg.guessed_price::numeric * GREATEST(u.karma, 1)::numeric)
                    / NULLIF(SUM(GREATEST(u.karma, 1)::numeric), 0)
                  )
                END
              )::bigint
              ELSE ROUND(
                SUM(lpg.guessed_price::numeric * GREATEST(u.karma, 1)::numeric)
                / NULLIF(SUM(GREATEST(u.karma, 1)::numeric), 0)
              )::bigint
            END AS canonical_fmv
          FROM latest_public_guesses lpg
          INNER JOIN users u ON u.id = lpg.user_id
          INNER JOIN candidate_batch cb ON cb.property_id = lpg.property_id
          WHERE lpg.is_meme_guess = FALSE
          GROUP BY lpg.property_id, cb.official_valuation
        ),
        listing_facts AS MATERIALIZED (
          SELECT
            cb.property_id,
            CASE
              WHEN active_listing.property_id IS NOT NULL
                THEN active_listing.asking_price
              ELSE NULL
            END AS asking_price,
            listing_thumbnail.thumbnail_url,
            active_listing.property_id IS NOT NULL AS has_active_listing,
            (
              active_listing.property_id IS NULL
              AND latest_listing.status IN ('sold', 'rented')
            ) AS has_completed_listing,
            CASE
              WHEN active_listing.property_id IS NOT NULL AND active_listing.price_type = 'rent'
                THEN 'for-rent'
              WHEN active_listing.property_id IS NOT NULL
                THEN 'for-sale'
              WHEN latest_listing.status = 'sold'
                THEN 'sold'
              WHEN latest_listing.status = 'rented'
                THEN 'rented'
              ELSE 'not-listed'
            END AS market_state,
            COALESCE(
              CASE
                WHEN active_listing.property_id IS NOT NULL
                  AND active_listing.price_type = 'sale'
                  THEN active_listing.asking_price
                ELSE NULL
              END,
              sold_history.last_sold_price,
              guess_facts.canonical_fmv,
              cb.official_valuation
            ) AS sale_effective_price,
            COALESCE(
              CASE
                WHEN active_listing.property_id IS NOT NULL
                  AND active_listing.price_type = 'rent'
                  THEN active_listing.asking_price
                ELSE NULL
              END,
              rented_history.last_rented_price
            ) AS rent_effective_price
          FROM candidate_batch cb
          LEFT JOIN latest_listing ON latest_listing.property_id = cb.property_id
          LEFT JOIN active_listing ON active_listing.property_id = cb.property_id
          LEFT JOIN listing_thumbnail ON listing_thumbnail.property_id = cb.property_id
          LEFT JOIN sold_history ON sold_history.property_id = cb.property_id
          LEFT JOIN rented_history ON rented_history.property_id = cb.property_id
          LEFT JOIN guess_facts ON guess_facts.property_id = cb.property_id
        ),
        inserted AS (
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
            thumbnail_url,
            city_token,
            region_token,
            postal_code_norm,
            street_token,
            sale_effective_price,
            rent_effective_price,
            has_active_listing,
            has_completed_listing,
            market_state,
            comment_count,
            social_score,
            recent_social_score,
            last_social_at,
            updated_at
          )
          SELECT
            ${snapshotId}::uuid,
            lpc.property_id,
            lpc.geometry,
            lpc.official_valuation,
            lpc.country_code,
            lpc.city,
            lpc.region,
            lpc.postal_code,
            lpc.street,
            lpc.house_number,
            lpc.house_number_addition,
            lpc.official_valuation_year,
            lf.asking_price,
            lf.thumbnail_url,
            lpc.city_token,
            lpc.region_token,
            lpc.postal_code_norm,
            lpc.street_token,
            lf.sale_effective_price,
            lf.rent_effective_price,
            COALESCE(lf.has_active_listing, FALSE),
            COALESCE(lf.has_completed_listing, FALSE),
            COALESCE(lf.market_state, 'not-listed'),
            (
              COALESCE(ptsf.top_level_comment_count, 0)
              + COALESCE(ptsf.reply_count, 0)
            )::int,
            COALESCE(ptsf.social_score, 0)::double precision,
            COALESCE(ptsf.recent_social_score, 0)::double precision,
            ptsf.last_social_at,
            now()
          FROM candidate_batch lpc
          LEFT JOIN listing_facts lf
            ON lf.property_id = lpc.property_id
          LEFT JOIN property_tile_social_facts ptsf
            ON ptsf.snapshot_id = ${snapshotId}::uuid
           AND ptsf.property_id = lpc.property_id
          ON CONFLICT (snapshot_id, property_id) DO NOTHING
          RETURNING property_id
        )
        SELECT
          (SELECT count(*)::bigint::text FROM candidate_batch) AS batch_count,
          (SELECT count(*)::bigint::text FROM inserted) AS inserted_count,
          (
            SELECT property_id::text
            FROM candidate_batch
            ORDER BY property_id DESC
            LIMIT 1
          ) AS max_property_id
      `);
      const groupingRow:
        | {
            batch_count: string | number;
            inserted_count: string | number;
            max_property_id: string | null;
          }
        | undefined = groupingRows[0];
      if (!groupingRow) {
        break;
      }
      const batchCount = Number(groupingRow.batch_count);
      if (batchCount <= 0) {
        break;
      }
      lastGroupingCandidatePropertyId = groupingRow.max_property_id;
      if (!lastGroupingCandidatePropertyId) {
        break;
      }
      groupingBatchesCompleted += 1;
      await heartbeat('grouping-facts', groupingBatchesCompleted);
    }

    await tx.execute(sql`
      WITH social_only_candidates AS MATERIALIZED (
        SELECT
          ptsf.property_id,
          ptsf.geometry,
          ptsf.official_valuation,
          ptsf.top_level_comment_count,
          ptsf.reply_count,
          ptsf.social_score,
          ptsf.recent_social_score,
          ptsf.last_social_at,
          p.country_code,
          p.city,
          p.region,
          p.postal_code,
          p.street,
          p.house_number,
          p.house_number_addition,
          p.official_valuation_year,
          NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE(p.city, ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), '') AS city_token,
          NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE(p.region, ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), '') AS region_token,
          NULLIF(REGEXP_REPLACE(UPPER(TRIM(COALESCE(p.postal_code, ''))), '\\s+', '', 'g'), '') AS postal_code_norm,
          NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE(p.street, ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), '') AS street_token
        FROM property_tile_social_facts ptsf
        INNER JOIN properties p ON p.id = ptsf.property_id
        WHERE ptsf.snapshot_id = ${snapshotId}::uuid
          AND ptsf.geometry IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM property_tile_grouping_facts pgf
            WHERE pgf.snapshot_id = ${snapshotId}::uuid
              AND pgf.property_id = ptsf.property_id
          )
      ),
      tile_listing_facts AS MATERIALIZED (
        SELECT
          cl.id AS listing_id,
          cl.property_id,
          cl.status::text AS status,
          CASE
            WHEN lower(cl.source_name) = 'funda'
              AND lower(btrim(cl.price_type)) = 'buy'
              THEN 'sale'
            WHEN lower(btrim(cl.price_type)) IN ('sale', 'rent')
              THEN lower(btrim(cl.price_type))
            WHEN lower(cl.source_name) = 'pararius'
              THEN 'rent'
            ELSE 'sale'
          END AS normalized_price_type,
          cl.asking_price,
          cl.thumbnail_url,
          COALESCE(
            cl.last_reconciled_at,
            cl.last_mirror_seen_at,
            cl.last_user_seen_at,
            cl.last_seen_at,
            cl.updated_at,
            cl.created_at
          ) AS sort_at,
          cl.created_at AS listing_created_at
        FROM canonical_listings cl
        INNER JOIN social_only_candidates soc ON soc.property_id = cl.property_id
        WHERE cl.verification_state <> 'invalid'
      ),
      latest_listing AS MATERIALIZED (
        SELECT DISTINCT ON (l.property_id)
          l.property_id,
          l.status
        FROM tile_listing_facts l
        ORDER BY
          l.property_id,
          (l.status = 'active') DESC,
          l.sort_at DESC,
          l.listing_created_at DESC,
          l.listing_id DESC
      ),
      active_listing AS MATERIALIZED (
        SELECT DISTINCT ON (l.property_id)
          l.property_id,
          l.asking_price,
          l.normalized_price_type AS price_type
        FROM tile_listing_facts l
        WHERE l.status = 'active'
        ORDER BY
          l.property_id,
          (l.status = 'active') DESC,
          l.sort_at DESC,
          l.listing_created_at DESC,
          l.listing_id DESC
      ),
      listing_thumbnail AS MATERIALIZED (
        SELECT DISTINCT ON (l.property_id)
          l.property_id,
          l.thumbnail_url
        FROM tile_listing_facts l
        WHERE l.thumbnail_url IS NOT NULL
        ORDER BY
          l.property_id,
          (l.status = 'active') DESC,
          l.sort_at DESC,
          l.listing_created_at DESC,
          l.listing_id DESC
      ),
      sold_history AS MATERIALIZED (
        SELECT DISTINCT ON (ph.property_id)
          ph.property_id,
          ph.price AS last_sold_price
        FROM price_history ph
        INNER JOIN social_only_candidates soc ON soc.property_id = ph.property_id
        WHERE ph.event_type = 'sold'
        ORDER BY ph.property_id, ph.price_date DESC, ph.created_at DESC, ph.id DESC
      ),
      rented_history AS MATERIALIZED (
        SELECT DISTINCT ON (ph.property_id)
          ph.property_id,
          ph.price AS last_rented_price
        FROM price_history ph
        INNER JOIN social_only_candidates soc ON soc.property_id = ph.property_id
        WHERE ph.event_type = 'rented'
        ORDER BY ph.property_id, ph.price_date DESC, ph.created_at DESC, ph.id DESC
      ),
      latest_public_guesses AS MATERIALIZED (
        SELECT DISTINCT ON (pg.property_id, pg.user_id)
          pg.property_id,
          pg.user_id,
          pg.guessed_price,
          pg.is_meme_guess,
          GREATEST(pg.created_at, pg.updated_at) AS effective_at
        FROM price_guesses pg
        INNER JOIN social_only_candidates soc ON soc.property_id = pg.property_id
        WHERE GREATEST(pg.created_at, pg.updated_at) <= ${closedSocialActivityCutoffAt}::timestamptz
        ORDER BY
          pg.property_id,
          pg.user_id,
          GREATEST(pg.created_at, pg.updated_at) DESC,
          pg.created_at DESC,
          pg.id DESC
      ),
      guess_facts AS MATERIALIZED (
        SELECT
          lpg.property_id,
          CASE
            WHEN COUNT(*) = 0 THEN NULL::bigint
            WHEN COUNT(*) <= 2 THEN ROUND(
              CASE
                WHEN soc.official_valuation IS NOT NULL
                  THEN soc.official_valuation::numeric * 0.7
                    + (
                      SUM(lpg.guessed_price::numeric * GREATEST(u.karma, 1)::numeric)
                      / NULLIF(SUM(GREATEST(u.karma, 1)::numeric), 0)
                    ) * 0.3
                ELSE (
                  SUM(lpg.guessed_price::numeric * GREATEST(u.karma, 1)::numeric)
                  / NULLIF(SUM(GREATEST(u.karma, 1)::numeric), 0)
                )
              END
            )::bigint
            WHEN COUNT(*) <= 9 THEN ROUND(
              CASE
                WHEN soc.official_valuation IS NOT NULL
                  THEN soc.official_valuation::numeric * 0.3
                    + (
                      SUM(lpg.guessed_price::numeric * GREATEST(u.karma, 1)::numeric)
                      / NULLIF(SUM(GREATEST(u.karma, 1)::numeric), 0)
                    ) * 0.7
                ELSE (
                  SUM(lpg.guessed_price::numeric * GREATEST(u.karma, 1)::numeric)
                  / NULLIF(SUM(GREATEST(u.karma, 1)::numeric), 0)
                )
              END
            )::bigint
            ELSE ROUND(
              SUM(lpg.guessed_price::numeric * GREATEST(u.karma, 1)::numeric)
              / NULLIF(SUM(GREATEST(u.karma, 1)::numeric), 0)
            )::bigint
          END AS canonical_fmv
        FROM latest_public_guesses lpg
        INNER JOIN users u ON u.id = lpg.user_id
        INNER JOIN social_only_candidates soc ON soc.property_id = lpg.property_id
        WHERE lpg.is_meme_guess = FALSE
        GROUP BY lpg.property_id, soc.official_valuation
      ),
      listing_facts AS MATERIALIZED (
        SELECT
          soc.property_id,
          CASE
            WHEN active_listing.property_id IS NOT NULL
              THEN active_listing.asking_price
            ELSE NULL
          END AS asking_price,
          listing_thumbnail.thumbnail_url,
          active_listing.property_id IS NOT NULL AS has_active_listing,
          (
            active_listing.property_id IS NULL
            AND latest_listing.status IN ('sold', 'rented')
          ) AS has_completed_listing,
          CASE
            WHEN active_listing.property_id IS NOT NULL AND active_listing.price_type = 'rent'
              THEN 'for-rent'
            WHEN active_listing.property_id IS NOT NULL
              THEN 'for-sale'
            WHEN latest_listing.status = 'sold'
              THEN 'sold'
            WHEN latest_listing.status = 'rented'
              THEN 'rented'
            ELSE 'not-listed'
          END AS market_state,
          COALESCE(
            CASE
              WHEN active_listing.property_id IS NOT NULL
                AND active_listing.price_type = 'sale'
                THEN active_listing.asking_price
              ELSE NULL
            END,
            sold_history.last_sold_price,
            guess_facts.canonical_fmv,
            soc.official_valuation
          ) AS sale_effective_price,
          COALESCE(
            CASE
              WHEN active_listing.property_id IS NOT NULL
                AND active_listing.price_type = 'rent'
                THEN active_listing.asking_price
              ELSE NULL
            END,
            rented_history.last_rented_price
          ) AS rent_effective_price
        FROM social_only_candidates soc
        LEFT JOIN latest_listing ON latest_listing.property_id = soc.property_id
        LEFT JOIN active_listing ON active_listing.property_id = soc.property_id
        LEFT JOIN listing_thumbnail ON listing_thumbnail.property_id = soc.property_id
        LEFT JOIN sold_history ON sold_history.property_id = soc.property_id
        LEFT JOIN rented_history ON rented_history.property_id = soc.property_id
        LEFT JOIN guess_facts ON guess_facts.property_id = soc.property_id
      )
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
        thumbnail_url,
        city_token,
        region_token,
        postal_code_norm,
        street_token,
        sale_effective_price,
        rent_effective_price,
        has_active_listing,
        has_completed_listing,
        market_state,
        comment_count,
        social_score,
        recent_social_score,
        last_social_at,
        updated_at
      )
      SELECT
        ${snapshotId}::uuid,
        ptsf.property_id,
        ptsf.geometry,
        ptsf.official_valuation,
        ptsf.country_code,
        ptsf.city,
        ptsf.region,
        ptsf.postal_code,
        ptsf.street,
        ptsf.house_number,
        ptsf.house_number_addition,
        ptsf.official_valuation_year,
        lf.asking_price,
        lf.thumbnail_url,
        ptsf.city_token,
        ptsf.region_token,
        ptsf.postal_code_norm,
        ptsf.street_token,
        lf.sale_effective_price,
        lf.rent_effective_price,
        COALESCE(lf.has_active_listing, FALSE),
        COALESCE(lf.has_completed_listing, FALSE),
        COALESCE(lf.market_state, 'not-listed'),
        (
          COALESCE(ptsf.top_level_comment_count, 0)
          + COALESCE(ptsf.reply_count, 0)
        )::int,
        COALESCE(ptsf.social_score, 0)::double precision,
        COALESCE(ptsf.recent_social_score, 0)::double precision,
        ptsf.last_social_at,
        now()
      FROM social_only_candidates ptsf
      LEFT JOIN listing_facts lf
        ON lf.property_id = ptsf.property_id
      ON CONFLICT (snapshot_id, property_id) DO NOTHING
    `);
    await heartbeat('counting', groupingBatchesCompleted);

    const countRows = await tx.execute<{
      candidate_count: string | number;
      fact_count: string | number;
      social_fact_count: string | number;
      grouping_fact_count: string | number;
    }>(sql`
      SELECT
        (SELECT count(*)::bigint::text FROM property_tile_listing_candidates WHERE snapshot_id = ${snapshotId}::uuid)
          AS candidate_count,
        (SELECT count(*)::bigint::text FROM property_tile_listing_facts WHERE snapshot_id = ${snapshotId}::uuid)
          AS fact_count,
        (SELECT count(*)::bigint::text FROM property_tile_social_facts WHERE snapshot_id = ${snapshotId}::uuid)
          AS social_fact_count,
        (SELECT count(*)::bigint::text FROM property_tile_grouping_facts WHERE snapshot_id = ${snapshotId}::uuid)
          AS grouping_fact_count
    `);
    const counts = Array.from(countRows)[0];
    await tx.execute(sql`
      UPDATE property_tile_candidate_source_snapshots
      SET
        status = 'ready',
        candidate_row_count = ${counts?.candidate_count ?? 0},
        fact_row_count = ${counts?.fact_count ?? 0},
        social_fact_row_count = ${counts?.social_fact_count ?? 0},
        grouping_fact_row_count = ${counts?.grouping_fact_count ?? 0},
        build_finished_at = clock_timestamp(),
        updated_at = clock_timestamp()
      WHERE id = ${snapshotId}::uuid
    `);
    await heartbeat('publishing-current', groupingBatchesCompleted);
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
        ${input.slot.coverageId},
        ${input.slot.filterSignature},
        ${input.slot.pyramidKind}::property_tile_pyramid_kind,
        ${snapshotId}::uuid,
        now(),
        now()
      )
      ON CONFLICT (coverage_id, filter_signature, pyramid_kind)
      DO UPDATE SET
        snapshot_id = EXCLUDED.snapshot_id,
        promoted_at = EXCLUDED.promoted_at,
        updated_at = now()
    `);
    await heartbeat('ready', groupingBatchesCompleted);

    return {
      id: snapshotId,
      sourceWatermarkHash: input.sourceWatermarkHash,
      comparableSourceWatermarkHash: input.comparableSourceWatermarkHash,
      sourceWatermarksJson: input.sourceWatermarksJson,
    };
  });
}

async function ensurePropertyTileCandidateSourceSnapshot(input: {
  slot: PropertyTilePyramidSlot;
  sourceWatermarkHash: string;
  sourceWatermarksJson: Record<string, unknown>;
  heartbeat?: PropertyTileCandidateSourceSnapshotBuildHeartbeat;
}): Promise<PropertyTileCandidateSourceSnapshot> {
  const comparableHash = comparableSourceWatermarkHash(input);
  const existing = await readReadyPropertyTileCandidateSourceSnapshot({
    slot: input.slot,
    comparableSourceWatermarkHash: comparableHash,
  });
  if (existing) {
    return existing;
  }
  try {
    return await rebuildPropertyTileCandidateSourceSnapshot({
      ...input,
      comparableSourceWatermarkHash: comparableHash,
    });
  } catch (error) {
    if (!isCandidateSourceSnapshotReadyUniqueViolation(error)) {
      throw error;
    }
    const raced = await readReadyPropertyTileCandidateSourceSnapshot({
      slot: input.slot,
      comparableSourceWatermarkHash: comparableHash,
    });
    if (!raced) {
      throw error;
    }
    return raced;
  }
}

export function buildPropertyTilePyramidBuildIdentitySnapshots(
  slot: PropertyTilePyramidSlot
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
    addressInteractionMinZoom: PROPERTY_ADDRESS_INTERACTION_MIN_ZOOM,
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

function readRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Property tile pyramid version is missing ${fieldName}`);
  }

  return value as Record<string, unknown>;
}

function readNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Property tile pyramid version has invalid ${fieldName}`);
  }

  return value;
}

function readString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Property tile pyramid version has invalid ${fieldName}`);
  }

  return value;
}

function readPositiveNumber(value: unknown, fieldName: string): number {
  const numberValue = readNumber(value, fieldName);
  if (numberValue <= 0) {
    throw new Error(`Property tile pyramid version has invalid ${fieldName}`);
  }

  return numberValue;
}

function readPositiveNumberOrDefault(value: unknown, fieldName: string, fallback: number): number {
  if (value == null) {
    return fallback;
  }

  return readPositiveNumber(value, fieldName);
}

function readCoverageBoundsFromSnapshot(value: unknown): PropertyTilePyramidCoverageBounds {
  const coverageSnapshot = readRecord(value, 'coverage snapshot');
  const bounds = readRecord(coverageSnapshot.bounds, 'coverage bounds');
  return {
    minLon: readNumber(bounds.minLon, 'coverage minLon'),
    minLat: readNumber(bounds.minLat, 'coverage minLat'),
    maxLon: readNumber(bounds.maxLon, 'coverage maxLon'),
    maxLat: readNumber(bounds.maxLat, 'coverage maxLat'),
    maxZoom: readNumber(coverageSnapshot.maxZoom, 'coverage maxZoom'),
  };
}

function buildVersionBoundPropertyTilePyramidContext(input: {
  slot: PropertyTilePyramidSlot;
  buildInputsHash: string;
  configHash: string;
  coverageSnapshotJson: Record<string, unknown>;
  configSnapshotJson: Record<string, unknown>;
  groupingConstantsJson: Record<string, unknown>;
}): VersionBoundPropertyTilePyramidBuildContext {
  const coverageSnapshot = readRecord(input.coverageSnapshotJson, 'coverage snapshot');
  const configSnapshot = readRecord(input.configSnapshotJson, 'config snapshot');
  const groupingConstants = readRecord(input.groupingConstantsJson, 'grouping constants');
  const bounds = readRecord(coverageSnapshot.bounds, 'coverage bounds');
  const servingSlot = readRecord(configSnapshot.servingSlot, 'config serving slot');
  const defaultFilter = readRecord(configSnapshot.defaultFilter, 'default filter snapshot');
  const filters = readRecord(defaultFilter.filters, 'default filters') as unknown as MapFilters;
  const resourceControlsSnapshot = readRecord(
    configSnapshot.resourceControls,
    'resource controls snapshot'
  );
  const defaultFilterSignature = readString(defaultFilter.signature, 'default filter signature');
  const configHash = stableSha256(configSnapshot);
  const buildInputsHash = stableSha256({
    pipelineVersion: PROPERTY_TILE_PYRAMID_PIPELINE_VERSION,
    servingSlot: {
      coverageId: input.slot.coverageId,
      filterSignature: input.slot.filterSignature,
      maxZoom: input.slot.maxZoom,
      pyramidKind: input.slot.pyramidKind,
    },
    coverageSnapshot,
    configHash,
    configSnapshot,
    groupingConstants,
  });

  if (
    servingSlot.coverageId !== input.slot.coverageId ||
    servingSlot.filterSignature !== input.slot.filterSignature ||
    servingSlot.maxZoom !== input.slot.maxZoom ||
    servingSlot.pyramidKind !== input.slot.pyramidKind
  ) {
    throw new Error('Property tile pyramid version serving slot does not match config snapshot');
  }

  if (
    coverageSnapshot.coverageId !== input.slot.coverageId ||
    coverageSnapshot.filterSignature !== input.slot.filterSignature ||
    coverageSnapshot.maxZoom !== input.slot.maxZoom
  ) {
    throw new Error('Property tile pyramid version serving slot does not match coverage snapshot');
  }

  if (defaultFilterSignature !== input.slot.filterSignature) {
    throw new Error(
      'Property tile pyramid version default filter snapshot does not match serving slot'
    );
  }

  if (configHash !== input.configHash) {
    throw new Error('Property tile pyramid version config hash does not match config snapshot');
  }

  if (buildInputsHash !== input.buildInputsHash) {
    throw new Error(
      'Property tile pyramid version build inputs hash does not match stored snapshots'
    );
  }

  return {
    coverage: {
      minLon: readNumber(bounds.minLon, 'coverage minLon'),
      minLat: readNumber(bounds.minLat, 'coverage minLat'),
      maxLon: readNumber(bounds.maxLon, 'coverage maxLon'),
      maxLat: readNumber(bounds.maxLat, 'coverage maxLat'),
      maxZoom: readNumber(coverageSnapshot.maxZoom, 'coverage maxZoom'),
    },
    filters,
    resourceControls: {
      chunkTileLimit: readPositiveNumber(
        resourceControlsSnapshot.chunkTileLimit,
        'chunk tile limit'
      ),
      memberPageSize: readPositiveNumber(
        resourceControlsSnapshot.memberPageSize,
        'member page size'
      ),
      statementTimeoutMs: readPositiveNumber(
        resourceControlsSnapshot.statementTimeoutMs,
        'statement timeout'
      ),
      leaseSeconds: readPositiveNumber(resourceControlsSnapshot.leaseSeconds, 'lease seconds'),
      maxHeapMb: readPositiveNumber(resourceControlsSnapshot.maxHeapMb, 'max heap MB'),
      maxMemberRows: readPositiveNumberOrDefault(
        resourceControlsSnapshot.maxMemberRows,
        'max member rows',
        DEFAULT_MAX_MEMBER_ROWS
      ),
      maxWalBytesPerChunk: readPositiveNumber(
        resourceControlsSnapshot.maxWalBytesPerChunk,
        'max WAL bytes per chunk'
      ),
      maxWalBytesPerBuild: readPositiveNumberOrDefault(
        resourceControlsSnapshot.maxWalBytesPerBuild,
        'max WAL bytes per build',
        DEFAULT_MAX_WAL_BYTES_PER_BUILD
      ),
    },
  };
}

export async function advancePropertyTilePyramidSourceWatermark(
  scopes: PropertyTilePyramidSourceWatermarkScope[],
  executor: PropertyTilePyramidWatermarkExecutor = db
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
        SELECT
          ${scope}::property_tile_pyramid_watermark_scope,
          'global',
          1,
          watermark_advance.advanced_at,
          '{}'::jsonb,
          watermark_advance.advanced_at
        FROM (SELECT clock_timestamp() AS advanced_at) AS watermark_advance
        ON CONFLICT (scope, scope_key) DO UPDATE SET
          watermark_value = property_tile_pyramid_source_watermarks.watermark_value + 1,
          watermark_timestamp = GREATEST(
            COALESCE(
              property_tile_pyramid_source_watermarks.watermark_timestamp,
              '-infinity'::timestamptz
            ),
            EXCLUDED.watermark_timestamp
          ),
          updated_at = EXCLUDED.updated_at
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
}>;
export async function readPropertyTilePyramidSourceWatermarkSnapshot(
  executor: PropertyTilePyramidWatermarkExecutor
): Promise<{
  sourceWatermarkHash: string;
  sourceWatermarksJson: Record<string, unknown>;
}>;
export async function readPropertyTilePyramidSourceWatermarkSnapshot(
  executor: PropertyTilePyramidWatermarkExecutor = db
): Promise<{
  sourceWatermarkHash: string;
  sourceWatermarksJson: Record<string, unknown>;
}> {
  const sources: Array<Record<string, unknown>> = [];

  try {
    const rows = await executor.execute<{
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
    sources.push(
      ...Array.from(rows).map((row) => ({
        source: 'property_tile_pyramid_source_watermarks',
        scope: row.scope,
        scopeKey: row.scope_key,
        watermarkValue: String(row.watermark_value),
        watermarkTimestamp:
          row.watermark_timestamp instanceof Date
            ? row.watermark_timestamp.toISOString()
            : row.watermark_timestamp,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
      }))
    );
  } catch (error) {
    if (!isMissingPyramidSchemaError(error)) {
      throw error;
    }
  }

  try {
    const rows = await executor.execute<{
      key: string;
      listing_watermark: string | bigint;
      social_watermark: string | bigint;
      property_watermark: string | bigint;
      coverage_watermark: string | bigint;
      updated_at: string | Date;
    }>(sql`
      SELECT
        key,
        listing_watermark::text,
        social_watermark::text,
        property_watermark::text,
        coverage_watermark::text,
        updated_at
      FROM property_tile_snapshot_watermarks
      WHERE key IN (${DEFAULT_PROPERTY_TILE_PYRAMID_COVERAGE_ID}, 'global')
      ORDER BY key
    `);
    sources.push(
      ...Array.from(rows).map((row) => ({
        source: 'property_tile_snapshot_watermarks',
        scope: PROPERTY_TILE_PYRAMID_KIND,
        key: row.key,
        listingWatermark: String(row.listing_watermark),
        socialWatermark: String(row.social_watermark),
        propertyWatermark: String(row.property_watermark),
        coverageWatermark: String(row.coverage_watermark),
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
      }))
    );
  } catch (error) {
    if (!isMissingPyramidSchemaError(error)) {
      throw error;
    }
  }

  try {
    const rows = await executor.execute<{
      source_name: string;
      last_committed_cursor: string | null;
      last_committed_changed_at: string | Date | null;
      last_committed_listing_key: string | null;
      last_batch_id: string | null;
      last_run_completed_at: string | Date | null;
      last_run_status: string | null;
    }>(sql`
      SELECT
        source_name,
        last_committed_cursor,
        last_committed_changed_at,
        last_committed_listing_key,
        last_batch_id::text,
        last_run_completed_at,
        last_run_status::text
      FROM ingest_sources
      ORDER BY source_name
    `);
    sources.push(
      ...Array.from(rows).map((row) => ({
        source: 'ingest_sources',
        sourceName: row.source_name,
        lastCommittedCursor: row.last_committed_cursor,
        lastCommittedChangedAt:
          row.last_committed_changed_at instanceof Date
            ? row.last_committed_changed_at.toISOString()
            : row.last_committed_changed_at,
        lastCommittedListingKey: row.last_committed_listing_key,
        lastBatchId: row.last_batch_id,
        lastRunCompletedAt:
          row.last_run_completed_at instanceof Date
            ? row.last_run_completed_at.toISOString()
            : row.last_run_completed_at,
        lastRunStatus: row.last_run_status,
      }))
    );
  } catch (error) {
    if (!isMissingPyramidSchemaError(error)) {
      throw error;
    }
  }

  try {
    const rows = await executor.execute<{
      source_name: string;
      scope_key: string;
      listing_type: string;
      source_high_watermark: string | Date;
      ingest_batch_id: string | null;
      updated_at: string | Date;
    }>(sql`
      SELECT
        source_name,
        scope_key,
        listing_type,
        source_high_watermark,
        ingest_batch_id::text,
        updated_at
      FROM listing_source_scope_watermarks
      ORDER BY source_name, scope_key, listing_type
    `);
    sources.push(
      ...Array.from(rows).map((row) => ({
        source: 'listing_source_scope_watermarks',
        sourceName: row.source_name,
        scopeKey: row.scope_key,
        listingType: row.listing_type,
        sourceHighWatermark:
          row.source_high_watermark instanceof Date
            ? row.source_high_watermark.toISOString()
            : row.source_high_watermark,
        ingestBatchId: row.ingest_batch_id,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
      }))
    );
  } catch (error) {
    if (!isMissingPyramidSchemaError(error)) {
      throw error;
    }
  }

  try {
    const rows = await executor.execute<{
      source_name: string;
      scope_key: string;
      listing_type: string;
      source_high_watermark: string | Date;
      source_run_completed_at: string | Date;
      coverage_status: string;
      observed_listing_count: number | string;
      stale_for_projection: boolean;
      repair_mode: boolean;
    }>(sql`
      SELECT
        source_name,
        scope_key,
        listing_type,
        max(source_high_watermark) AS source_high_watermark,
        max(source_run_completed_at) AS source_run_completed_at,
        string_agg(DISTINCT coverage_status, ',' ORDER BY coverage_status) AS coverage_status,
        sum(observed_listing_count)::bigint::text AS observed_listing_count,
        bool_or(stale_for_projection) AS stale_for_projection,
        bool_or(repair_mode) AS repair_mode
      FROM listing_scope_completions
      GROUP BY source_name, scope_key, listing_type
      ORDER BY source_name, scope_key, listing_type
    `);
    sources.push(
      ...Array.from(rows).map((row) => ({
        source: 'listing_scope_completions',
        sourceName: row.source_name,
        scopeKey: row.scope_key,
        listingType: row.listing_type,
        sourceHighWatermark:
          row.source_high_watermark instanceof Date
            ? row.source_high_watermark.toISOString()
            : row.source_high_watermark,
        sourceRunCompletedAt:
          row.source_run_completed_at instanceof Date
            ? row.source_run_completed_at.toISOString()
            : row.source_run_completed_at,
        coverageStatus: row.coverage_status,
        observedListingCount: String(row.observed_listing_count),
        staleForProjection: row.stale_for_projection,
        repairMode: row.repair_mode,
      }))
    );
  } catch (error) {
    if (!isMissingPyramidSchemaError(error)) {
      throw error;
    }
  }

  try {
    const rows = await executor.execute<{
      source: string;
      candidate_snapshot_id: string | null;
      row_count: string | number;
      max_updated_at: string | Date | null;
    }>(sql`
      WITH current_snapshot AS MATERIALIZED (
        SELECT snapshot_id
        FROM property_tile_candidate_source_current
        WHERE coverage_id = ${DEFAULT_PROPERTY_TILE_PYRAMID_COVERAGE_ID}
          AND filter_signature = ${DEFAULT_PROPERTY_TILE_PYRAMID_FILTER_SIGNATURE}
          AND pyramid_kind = ${PROPERTY_TILE_PYRAMID_KIND}::property_tile_pyramid_kind
        LIMIT 1
      )
      SELECT
        'property_tile_listing_candidates'::text AS source,
        current_snapshot.snapshot_id::text AS candidate_snapshot_id,
        count(lpc.property_id)::bigint::text AS row_count,
        max(lpc.updated_at) AS max_updated_at
      FROM current_snapshot
      LEFT JOIN property_tile_listing_candidates lpc
        ON lpc.snapshot_id = current_snapshot.snapshot_id
      GROUP BY current_snapshot.snapshot_id
      UNION ALL
      SELECT
        'property_tile_listing_facts'::text AS source,
        current_snapshot.snapshot_id::text AS candidate_snapshot_id,
        count(ptlf.property_id)::bigint::text AS row_count,
        max(ptlf.updated_at) AS max_updated_at
      FROM current_snapshot
      LEFT JOIN property_tile_listing_facts ptlf
        ON ptlf.snapshot_id = current_snapshot.snapshot_id
      GROUP BY current_snapshot.snapshot_id
      UNION ALL
      SELECT
        'property_tile_social_facts'::text AS source,
        current_snapshot.snapshot_id::text AS candidate_snapshot_id,
        count(ptsf.property_id)::bigint::text AS row_count,
        max(ptsf.updated_at) AS max_updated_at
      FROM current_snapshot
      LEFT JOIN property_tile_social_facts ptsf
        ON ptsf.snapshot_id = current_snapshot.snapshot_id
      GROUP BY current_snapshot.snapshot_id
      UNION ALL
      SELECT
        'property_tile_grouping_facts'::text AS source,
        current_snapshot.snapshot_id::text AS candidate_snapshot_id,
        count(pgf.property_id)::bigint::text AS row_count,
        max(pgf.updated_at) AS max_updated_at
      FROM current_snapshot
      LEFT JOIN property_tile_grouping_facts pgf
        ON pgf.snapshot_id = current_snapshot.snapshot_id
      GROUP BY current_snapshot.snapshot_id
      ORDER BY source
    `);
    sources.push(
      ...Array.from(rows).map((row) => ({
        source: row.source,
        scope: 'current_candidate_source_snapshot',
        candidateSnapshotId: row.candidate_snapshot_id,
        rowCount: String(row.row_count),
        maxUpdatedAt:
          row.max_updated_at instanceof Date
            ? row.max_updated_at.toISOString()
            : row.max_updated_at,
      }))
    );
  } catch (error) {
    if (!isMissingPyramidSchemaError(error)) {
      throw error;
    }
  }

  const rollingSocialWindowNowMs = Date.now();
  const rollingSocialWindowBucket = Math.floor(rollingSocialWindowNowMs / (60 * 60 * 1000));
  const rollingSocialWindowCutoffAt = new Date(
    rollingSocialWindowBucket * 60 * 60 * 1000
  ).toISOString();
  sources.push({
    source: 'rolling_social_window',
    bucket: rollingSocialWindowBucket,
    bucketUnit: 'hour',
    cutoffAt: rollingSocialWindowCutoffAt,
  });

  sources.sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
  const comparableSources = sources.filter(
    (source) => !isPropertyTileProjectionFingerprintSource(source)
  );

  return {
    sourceWatermarkHash: buildStableSourceWatermarkHash(sources),
    sourceWatermarksJson: {
      sources,
      comparableSourceWatermarkHash: buildStableSourceWatermarkHash(comparableSources),
    },
  };
}

export async function safeRequestPropertyTilePyramidBuild(
  input: Parameters<typeof requestPropertyTilePyramidBuild>[0],
  logger: PropertyTilePyramidBuildLogger,
  context: Record<string, unknown> = {},
  requestBuild: typeof requestPropertyTilePyramidBuild = requestPropertyTilePyramidBuild
): Promise<PropertyTilePyramidBuildRequest | null> {
  try {
    const sourceWatermarks = input.sourceWatermarkHash
      ? {
          sourceWatermarkHash: input.sourceWatermarkHash,
          sourceWatermarksJson: input.sourceWatermarksJson,
        }
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
      'Failed to request property tile pyramid build after commit'
    );
    return null;
  }
}

function parseTimestampMs(value: string | Date | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseWatermarkValue(value: string | bigint | number | null | undefined): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return BigInt(value);
  }
  return 0n;
}

function isMutationBuildRequestDue(input: {
  policy: PropertyTilePyramidMutationBuildPolicy;
  nowMs: number;
  lastRequestedAtMs: number | null;
  mutationDelta: bigint;
}): boolean {
  if (input.mutationDelta <= 0n) {
    return false;
  }
  if (input.lastRequestedAtMs == null) {
    return true;
  }

  const policy = PROPERTY_TILE_PYRAMID_MUTATION_BUILD_POLICIES[input.policy];
  const elapsedMs = input.nowMs - input.lastRequestedAtMs;
  if (elapsedMs < policy.coalesceMs) {
    return false;
  }
  if (elapsedMs >= policy.maxLagMs) {
    return true;
  }
  return policy.mutationThreshold != null && input.mutationDelta >= policy.mutationThreshold;
}

async function claimPropertyTilePyramidMutationBuildRequest(input: {
  reason: string;
  policy: PropertyTilePyramidMutationBuildPolicy;
  scopes: PropertyTilePyramidSourceWatermarkScope[];
}): Promise<boolean> {
  const uniqueScopes = [...new Set(input.scopes)];
  if (uniqueScopes.length === 0) {
    return false;
  }

  const scopeList = sql.join(
    uniqueScopes.map((scope) => sql`${scope}::property_tile_pyramid_watermark_scope`),
    sql`, `
  );
  const policyJsonKey = `mutationBuildCoalescing:${input.policy}`;
  const lockKey = `property_tile_pyramid_mutation_build:${input.policy}:${uniqueScopes.sort().join(',')}`;

  try {
    return await db.transaction(async (tx) => {
      const lockRows = await tx.execute<{ acquired: boolean }>(sql`
        SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS acquired
      `);
      if (!Array.from(lockRows)[0]?.acquired) {
        return false;
      }

      const rows = await tx.execute<{
        scope: string;
        watermark_value: string | bigint;
        last_requested_at: string | Date | null;
        last_requested_watermark_value: string | null;
      }>(sql`
        SELECT
          scope::text,
          watermark_value::text,
          watermark_json->${policyJsonKey}->>'lastRequestedAt' AS last_requested_at,
          watermark_json->${policyJsonKey}->>'lastRequestedWatermarkValue' AS last_requested_watermark_value
        FROM property_tile_pyramid_source_watermarks
        WHERE scope IN (${scopeList})
          AND scope_key = 'global'
        FOR UPDATE
      `);
      const watermarkRows = Array.from(rows);
      if (watermarkRows.length === 0) {
        return false;
      }

      const nowMs = Date.now();
      const lastRequestedAtMs = watermarkRows.reduce<number | null>((latest, row) => {
        const parsed = parseTimestampMs(row.last_requested_at);
        if (parsed == null) {
          return latest;
        }
        return latest == null ? parsed : Math.max(latest, parsed);
      }, null);
      const mutationDelta = watermarkRows.reduce((total, row) => {
        const current = parseWatermarkValue(row.watermark_value);
        const lastRequested = parseWatermarkValue(row.last_requested_watermark_value);
        return total + (current > lastRequested ? current - lastRequested : 0n);
      }, 0n);

      if (
        !isMutationBuildRequestDue({
          policy: input.policy,
          nowMs,
          lastRequestedAtMs,
          mutationDelta,
        })
      ) {
        return false;
      }

      await tx.execute(sql`
        UPDATE property_tile_pyramid_source_watermarks
        SET
          watermark_json = jsonb_set(
            watermark_json,
            ARRAY[${policyJsonKey}::text],
            jsonb_build_object(
              'lastRequestedAt', now()::text,
              'lastRequestedWatermarkValue', watermark_value::text,
              'reason', ${input.reason}::text
            ),
            true
          )
        WHERE scope IN (${scopeList})
          AND scope_key = 'global'
      `);

      return true;
    });
  } catch (error) {
    if (isMissingPyramidSchemaError(error)) {
      return false;
    }
    throw error;
  }
}

async function hasPropertyTilePyramidRecoveryWorkInSlot(
  slot: PropertyTilePyramidSlot
): Promise<boolean> {
  const rows = await db.execute<{ has_recovery_work: boolean }>(sql`
    SELECT (
      EXISTS (
        SELECT 1
        FROM property_tile_pyramid_versions
        WHERE coverage_id = ${slot.coverageId}
          AND filter_signature = ${slot.filterSignature}
          AND max_zoom = ${slot.maxZoom}
          AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
          AND (
            status = 'queued'
            OR (
              status IN ('building', 'validating')
              AND lease_until IS NOT NULL
              AND lease_until > now()
            )
            OR (
              status = 'failed_retryable'
              AND (
                next_retry_at IS NULL
                OR next_retry_at <= now()
              )
            )
          )
        LIMIT 1
      )
      OR NOT EXISTS (
        SELECT 1
        FROM property_tile_pyramid_current
        WHERE coverage_id = ${slot.coverageId}
          AND filter_signature = ${slot.filterSignature}
          AND max_zoom = ${slot.maxZoom}
          AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
      )
    ) AS has_recovery_work
  `);
  return Array.from(rows)[0]?.has_recovery_work === true;
}

async function claimPropertyTilePyramidWorkerRecoveryBuildRequest(
  reason: string
): Promise<boolean> {
  let claimed = false;
  for (const policy of PROPERTY_TILE_PYRAMID_WORKER_RECOVERY_MUTATION_POLICIES) {
    if (
      await claimPropertyTilePyramidMutationBuildRequest({
        reason,
        policy: policy.policy,
        scopes: policy.scopes,
      })
    ) {
      claimed = true;
    }
  }
  return claimed;
}

export async function safeRequestPropertyTilePyramidBuildAfterMutation(
  input: Parameters<typeof requestPropertyTilePyramidBuild>[0] & {
    policy: PropertyTilePyramidMutationBuildPolicy;
    watermarkScopes: PropertyTilePyramidSourceWatermarkScope[];
  },
  logger: PropertyTilePyramidBuildLogger,
  context: Record<string, unknown> = {},
  requestBuild: typeof requestPropertyTilePyramidBuild = requestPropertyTilePyramidBuild
): Promise<PropertyTilePyramidBuildRequest | null> {
  try {
    const claimed = await claimPropertyTilePyramidMutationBuildRequest({
      reason: String(input.reason),
      policy: input.policy,
      scopes: input.watermarkScopes,
    });
    if (!claimed) {
      return { status: 'coalesced', reason: 'mutation-build-throttled' };
    }

    const { policy: _policy, watermarkScopes: _watermarkScopes, ...requestInput } = input;
    return await safeRequestPropertyTilePyramidBuild(requestInput, logger, context, requestBuild);
  } catch (error) {
    logger.warn(
      {
        err: error,
        reason: input.reason,
        policy: input.policy,
        ...context,
      },
      'Failed to request property tile pyramid build after mutation'
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

function isActiveSlotUniqueViolation(error: unknown): boolean {
  const cause = (
    error as { cause?: { code?: unknown; constraint?: unknown; constraint_name?: unknown } } | null
  )?.cause;
  const code = (error as { code?: unknown } | null)?.code ?? cause?.code;
  const constraint =
    (error as { constraint?: unknown; constraint_name?: unknown } | null)?.constraint ??
    (error as { constraint?: unknown; constraint_name?: unknown } | null)?.constraint_name ??
    cause?.constraint ??
    cause?.constraint_name;
  return code === '23505' && constraint === 'property_tile_pyramid_versions_active_slot_idx';
}

function isCandidateSourceSnapshotReadyUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: unknown; constraint?: unknown } } | null)?.cause;
  const code = (error as { code?: unknown } | null)?.code ?? cause?.code;
  const constraint = (error as { constraint?: unknown } | null)?.constraint ?? cause?.constraint;
  return code === '23505' && constraint === 'property_tile_candidate_source_snapshots_ready_idx';
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

function isTimestampAfter(candidate: string | null, baseline: string | null): boolean {
  if (!candidate || !baseline) {
    return false;
  }
  const candidateTime = new Date(candidate).getTime();
  const baselineTime = new Date(baseline).getTime();
  return (
    Number.isFinite(candidateTime) && Number.isFinite(baselineTime) && candidateTime > baselineTime
  );
}

export async function lookupCurrentPropertyTilePyramidVersion(
  slot: PropertyTilePyramidSlot = getDefaultPropertyTilePyramidSlot()
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
      coverage_snapshot_json: Record<string, unknown>;
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
        v.degraded_reason,
        v.coverage_snapshot_json
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
        coverage: readCoverageBoundsFromSnapshot(row.coverage_snapshot_json),
      },
    };
  } catch (error) {
    if (isMissingPyramidSchemaError(error)) {
      return {
        state: 'none',
        tileStatus: 'pyramid-unavailable',
        reason: 'pyramid-schema-unavailable',
      };
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
    if (
      row.validation_status !== 'validated' ||
      (row.tile_status !== 'valid_empty' &&
        row.tile_status !== 'valid_nodes' &&
        row.tile_status !== 'valid_encoded')
    ) {
      return {
        state: 'missing',
        tileStatus: 'pyramid-missing',
        reason: `tile-${row.tile_status ?? 'unknown'}-${row.validation_status ?? 'unknown'}`,
      };
    }

    const existingPayload = maybeBuffer(row.payload);
    if (existingPayload && existingPayload.length > 0) {
      if (row.tile_status !== 'valid_encoded') {
        return {
          state: 'missing',
          tileStatus: 'pyramid-missing',
          reason: `tile-payload-${row.tile_status ?? 'unknown'}`,
        };
      }
      const statusCode = statusCodeFromPayload(existingPayload, row.tile_status);
      return {
        state: 'hit',
        versionId: input.version.versionId,
        payload: existingPayload,
        statusCode,
        etag:
          row.etag ??
          buildPropertyTilePyramidEtag({
            ...input,
            versionId: input.version.versionId,
            payload: existingPayload,
          }),
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
        etag:
          row.etag ??
          buildPropertyTilePyramidEtag({
            ...input,
            versionId: input.version.versionId,
            payload: null,
          }),
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
      etag: regenerated.etag,
      nodeCount,
      encodedFromNodes: true,
    };
  } catch (error) {
    if (isMissingPyramidSchemaError(error)) {
      return {
        state: 'missing',
        tileStatus: 'pyramid-unavailable',
        reason: 'pyramid-schema-unavailable',
      };
    }
    throw error;
  }
}

export async function encodePropertyTilePyramidTileFromPromotedNodes(input: {
  version: CurrentPropertyTilePyramidVersion;
  z: number;
  x: number;
  y: number;
  lease?: PropertyTilePyramidBuildLease;
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
        n.city,
        p.country_code AS "countryCode",
        asking_price AS "askingPrice",
        p.official_valuation AS "officialValuation",
        p.official_valuation_year AS "officialValuationYear",
        CASE WHEN p.country_code = 'NL' THEN ${WOZ_SOURCE_CONFIG.source}::text ELSE NULL END
          AS "officialValuationSource",
        CASE WHEN p.country_code = 'NL' THEN ${WOZ_SOURCE_CONFIG.expectedValuationYear}::integer ELSE NULL END
          AS "officialValuationExpectedYear",
        CASE WHEN p.country_code = 'NL' THEN ${WOZ_SOURCE_CONFIG.supportsClientFetch.web}::boolean ELSE NULL END
          AS "officialValuationSupportsWeb",
        CASE WHEN p.country_code = 'NL' THEN ${WOZ_SOURCE_CONFIG.supportsClientFetch.native}::boolean ELSE NULL END
          AS "officialValuationSupportsNative",
        thumbnail_url AS "thumbnailUrl",
        has_active_listing AS "hasActiveListing",
        market_state AS "marketState",
        ${input.version.versionId}::text AS pyramid_version_id,
        node_id::text AS pyramid_node_id,
        (group_kind = 'single') AS membership_complete,
        CASE WHEN group_kind = 'single' THEN 'complete' ELSE 'partial' END AS read_state_coverage
      FROM property_tile_pyramid_nodes n
      LEFT JOIN properties p
        ON p.id = COALESCE(n.representative_property_id, n.preview_property_ids[1])
      WHERE n.version_id = ${input.version.versionId}::uuid
        AND n.z = ${input.z}
        AND n.x = ${input.x}
        AND n.y = ${input.y}
    ),
    ordered_node_rows AS (
      SELECT *
      FROM node_rows
      WHERE geom IS NOT NULL
      ORDER BY
        node_class,
        group_kind,
        render_lon,
        render_lat,
        primary_property_id,
        pyramid_node_id
    )
    SELECT ST_AsMVT(ordered_node_rows, ${PROPERTY_TILE_PYRAMID_MVT_LAYER_NAME}, ${PROPERTY_TILE_EXTENT}, 'geom') AS mvt
    FROM ordered_node_rows
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

  const leaseCondition = input.lease
    ? sql`AND EXISTS (${buildLeasePredicate(input.lease)})`
    : sql``;
  const updateResult = await db.execute<{ affected: number | string }>(sql`
    WITH updated AS (
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
        ${leaseCondition}
      RETURNING 1
    )
    SELECT count(*)::int AS affected FROM updated
  `);
  if (input.lease && Number(Array.from(updateResult)[0]?.affected ?? 0) !== 1) {
    throw new PropertyTilePyramidLeaseLostError(input.version.versionId);
  }

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
  const reason = String(input.reason);
  const isWorkerRecoveryReason = reason === 'worker-recovery';
  let activeSlotConflictPendingRequest: {
    sourceWatermarkHash: string;
    sourceWatermarksJson: Record<string, unknown>;
    comparableSourceWatermarkHash: string;
  } | null = null;
  const useWorkerRecoveryMutationPolicy =
    isWorkerRecoveryReason && input.sourceWatermarkHash == null && input.buildInputsHash == null;

  try {
    const recoveredStaleBuildCount = await recoverStalePropertyTilePyramidBuildRequest({
      slot,
      reason,
    });

    if (
      useWorkerRecoveryMutationPolicy &&
      recoveredStaleBuildCount === 0 &&
      !(await hasPropertyTilePyramidRecoveryWorkInSlot(slot)) &&
      !(await claimPropertyTilePyramidWorkerRecoveryBuildRequest(reason))
    ) {
      return { status: 'coalesced', reason: 'mutation-build-throttled' };
    }

    let sourceWatermarks = input.sourceWatermarkHash
      ? {
          sourceWatermarkHash: input.sourceWatermarkHash,
          sourceWatermarksJson: input.sourceWatermarksJson ?? {},
        }
      : await readPropertyTilePyramidSourceWatermarkSnapshot();
    if (PROPERTY_TILE_PYRAMID_REPAIR_REASONS.has(reason)) {
      sourceWatermarks = buildRepairSourceWatermarkSnapshot({
        baseSourceWatermarkHash: sourceWatermarks.sourceWatermarkHash,
        baseSourceWatermarksJson: sourceWatermarks.sourceWatermarksJson,
        reason,
        slot,
      });
    }
    const { sourceWatermarkHash, sourceWatermarksJson } = sourceWatermarks;
    const comparableRequestedSourceWatermarkHash = comparableSourceWatermarkHash({
      sourceWatermarkHash,
      sourceWatermarksJson,
    });
    activeSlotConflictPendingRequest = {
      sourceWatermarkHash,
      sourceWatermarksJson,
      comparableSourceWatermarkHash: comparableRequestedSourceWatermarkHash,
    };

    if (isWorkerRecoveryReason) {
      const activeBuild = await readLeasedActivePropertyTilePyramidBuild(slot);
      if (activeBuild) {
        return {
          status: 'coalesced',
          versionId: activeBuild.id,
          existingStatus: activeBuild.status,
          nextRetryAt: activeBuild.next_retry_at,
          reason: 'active-build-in-progress',
        };
      }
    }

    await db.execute(sql`
      UPDATE property_tile_pyramid_versions
      SET
        status = 'superseded',
        terminal_reason = 'Superseded by newer property tile pyramid build request before work started',
        build_finished_at = COALESCE(build_finished_at, now()),
        superseded_at = now(),
        updated_at = now()
      WHERE coverage_id = ${slot.coverageId}
        AND filter_signature = ${slot.filterSignature}
        AND max_zoom = ${slot.maxZoom}
        AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
        AND (
          status = 'queued'
          OR (
            status = 'failed_retryable'
            AND build_started_at IS NULL
          )
        )
        AND NOT (
          build_inputs_hash = ${buildInputsHash}
          AND source_watermark_hash = ${sourceWatermarkHash}
        )
        AND NOT EXISTS (
          SELECT 1
          FROM property_tile_pyramid_versions active_replacement
          WHERE active_replacement.coverage_id = ${slot.coverageId}
            AND active_replacement.filter_signature = ${slot.filterSignature}
            AND active_replacement.max_zoom = ${slot.maxZoom}
            AND active_replacement.pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
            AND active_replacement.status IN ('building', 'validating')
            AND active_replacement.lease_until IS NOT NULL
            AND active_replacement.lease_until > now()
        )
    `);

    const rows = isWorkerRecoveryReason
      ? await db.execute<{
          id: string;
          status: PropertyTilePyramidStatus;
          next_retry_at: string | null;
          queue_eligible: boolean;
          pending_replacement: boolean;
          active_build_in_progress: boolean;
        }>(sql`
          WITH active_replacement AS MATERIALIZED (
            SELECT
              id,
              status,
              next_retry_at
            FROM property_tile_pyramid_versions
            WHERE coverage_id = ${slot.coverageId}
              AND filter_signature = ${slot.filterSignature}
              AND max_zoom = ${slot.maxZoom}
              AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
              AND status IN ('building', 'validating')
              AND lease_until IS NOT NULL
              AND lease_until > now()
            ORDER BY requested_at ASC NULLS LAST, updated_at ASC
            LIMIT 1
          ),
          inserted AS (
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
            SELECT
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
              ${reason},
              now(),
              now()
            WHERE NOT EXISTS (SELECT 1 FROM active_replacement)
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
            WHERE property_tile_pyramid_versions.status = 'queued'
              OR (
                property_tile_pyramid_versions.status = 'failed_retryable'
                AND (
                  property_tile_pyramid_versions.next_retry_at IS NULL
                  OR property_tile_pyramid_versions.next_retry_at <= now()
                )
              )
            RETURNING id::text, status, next_retry_at::text, true AS queue_eligible, false AS pending_replacement, false AS active_build_in_progress
          ),
          active_in_progress AS (
            SELECT
              a.id::text,
              a.status,
              a.next_retry_at::text,
              false AS queue_eligible,
              false AS pending_replacement,
              true AS active_build_in_progress
            FROM active_replacement a
            WHERE NOT EXISTS (SELECT 1 FROM inserted)
          )
          SELECT * FROM inserted
          UNION ALL
          SELECT * FROM active_in_progress
          LIMIT 1
        `)
      : await db.execute<{
          id: string;
          status: PropertyTilePyramidStatus;
          next_retry_at: string | null;
          queue_eligible: boolean;
          pending_replacement: boolean;
          active_build_in_progress: boolean;
        }>(sql`
      WITH active_replacement AS MATERIALIZED (
        SELECT
          id,
          status,
          next_retry_at,
          COALESCE(
            source_watermarks_json#>>'{propertyTilePyramidRepair,baseComparableSourceWatermarkHash}',
            source_watermarks_json#>>'{comparableSourceWatermarkHash}',
            source_watermarks_json#>>'{propertyTilePyramidRepair,baseSourceWatermarkHash}',
            source_watermark_hash
          ) AS comparable_source_watermark_hash
        FROM property_tile_pyramid_versions
        WHERE coverage_id = ${slot.coverageId}
          AND filter_signature = ${slot.filterSignature}
          AND max_zoom = ${slot.maxZoom}
          AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
          AND status IN ('building', 'validating')
          AND lease_until IS NOT NULL
          AND lease_until > now()
        ORDER BY requested_at ASC NULLS LAST, updated_at ASC
        LIMIT 1
      ),
      inserted AS (
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
        SELECT
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
          ${reason},
          now(),
          now()
        WHERE NOT EXISTS (SELECT 1 FROM active_replacement)
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
        WHERE property_tile_pyramid_versions.status = 'queued'
          OR (
            property_tile_pyramid_versions.status = 'failed_retryable'
            AND (
              property_tile_pyramid_versions.next_retry_at IS NULL
              OR property_tile_pyramid_versions.next_retry_at <= now()
            )
          )
        RETURNING id::text, status, next_retry_at::text, true AS queue_eligible, false AS pending_replacement, false AS active_build_in_progress
      ),
      pending AS (
        UPDATE property_tile_pyramid_versions v
        SET
          pending_replacement_watermarks_json = jsonb_build_object(
            'sourceWatermarkHash', ${sourceWatermarkHash}::text,
            'sourceWatermarksJson', ${JSON.stringify(sourceWatermarksJson)}::jsonb,
            'reason', ${reason}::text,
            'requestedAt', now()
          ),
          request_reason = ${reason}::text,
          updated_at = now()
        FROM active_replacement a
        WHERE v.id = a.id
          AND NOT EXISTS (SELECT 1 FROM inserted)
          AND a.comparable_source_watermark_hash IS DISTINCT FROM ${comparableRequestedSourceWatermarkHash}
        RETURNING v.id::text, v.status, v.next_retry_at::text, false AS queue_eligible, true AS pending_replacement, false AS active_build_in_progress
      ),
      active_same AS (
        SELECT
          a.id::text,
          a.status,
          a.next_retry_at::text,
          false AS queue_eligible,
          false AS pending_replacement,
          false AS active_build_in_progress
        FROM active_replacement a
        WHERE NOT EXISTS (SELECT 1 FROM inserted)
          AND NOT EXISTS (SELECT 1 FROM pending)
          AND a.comparable_source_watermark_hash IS NOT DISTINCT FROM ${comparableRequestedSourceWatermarkHash}
      )
      SELECT * FROM inserted
      UNION ALL
      SELECT * FROM pending
      UNION ALL
      SELECT * FROM active_same
      LIMIT 1
    `);

    let row = Array.from(rows)[0];
    if (!row) {
      const existingRows = await db.execute<{
        id: string;
        status: PropertyTilePyramidStatus;
        next_retry_at: string | null;
      }>(sql`
        SELECT id::text, status, next_retry_at::text
        FROM property_tile_pyramid_versions
        WHERE coverage_id = ${slot.coverageId}
          AND filter_signature = ${slot.filterSignature}
          AND max_zoom = ${slot.maxZoom}
          AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
          AND build_inputs_hash = ${buildInputsHash}
          AND source_watermark_hash = ${sourceWatermarkHash}
        LIMIT 1
      `);
      const existing = Array.from(existingRows)[0];
      if (!existing) {
        return { status: 'unavailable', reason: 'build-request-not-returned' };
      }
      row = {
        ...existing,
        queue_eligible: false,
        pending_replacement: false,
        active_build_in_progress: false,
      };
    }

    if (row.status === 'failed_terminal') {
      return {
        status: 'terminal',
        versionId: row.id,
        existingStatus: row.status,
        nextRetryAt: row.next_retry_at,
      };
    }

    if (
      row.status === 'failed_retryable' &&
      row.next_retry_at &&
      new Date(row.next_retry_at).getTime() > Date.now()
    ) {
      return {
        status: 'backoff',
        versionId: row.id,
        existingStatus: row.status,
        nextRetryAt: row.next_retry_at,
      };
    }

    if (!row.queue_eligible) {
      let coalescedReason: string | undefined;
      if (row.pending_replacement) {
        coalescedReason = 'pending-replacement-recorded';
      } else if (row.active_build_in_progress) {
        coalescedReason = 'active-build-in-progress';
      }
      return {
        status: 'coalesced',
        versionId: row.id,
        existingStatus: row.status,
        nextRetryAt: row.next_retry_at,
        reason: coalescedReason,
      };
    }

    const queueJobId = buildPropertyTilePyramidQueueJobId({
      slot,
      buildInputsHash,
      sourceWatermarkHash,
    });
    const enqueueResult = await enqueuePropertyTilePyramidBuildSignal({
      versionId: row.id,
      reason: String(input.reason),
      jobId: queueJobId,
    });
    if (!enqueueResult.ok) {
      return {
        status: 'enqueue_failed',
        versionId: row.id,
        existingStatus: row.status,
        queueJobId,
        nextRetryAt: row.next_retry_at,
        reason: enqueueResult.message,
      };
    }

    return {
      status:
        row.status === 'queued' || row.status === 'failed_retryable' ? 'enqueued' : 'coalesced',
      versionId: row.id,
      existingStatus: row.status,
      queueJobId,
      nextRetryAt: row.next_retry_at,
    };
  } catch (error) {
    if (isMissingPyramidSchemaError(error)) {
      return { status: 'unavailable', reason: 'pyramid-schema-unavailable' };
    }
    if (isActiveSlotUniqueViolation(error)) {
      if (activeSlotConflictPendingRequest) {
        const pendingRows = isWorkerRecoveryReason
          ? await db.execute<{
              id: string;
              status: PropertyTilePyramidStatus;
              next_retry_at: string | null;
              pending_replacement: boolean;
              active_build_in_progress: boolean;
            }>(sql`
              WITH active_replacement AS MATERIALIZED (
                SELECT
                  id,
                  status,
                  next_retry_at
                FROM property_tile_pyramid_versions
                WHERE coverage_id = ${slot.coverageId}
                  AND filter_signature = ${slot.filterSignature}
                  AND max_zoom = ${slot.maxZoom}
                  AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
                  AND status IN ('building', 'validating')
                  AND lease_until IS NOT NULL
                  AND lease_until > now()
                ORDER BY requested_at ASC NULLS LAST, updated_at ASC
                LIMIT 1
              )
              SELECT
                a.id::text,
                a.status,
                a.next_retry_at::text,
                false AS pending_replacement,
                true AS active_build_in_progress
              FROM active_replacement a
              LIMIT 1
            `)
          : await db.execute<{
              id: string;
              status: PropertyTilePyramidStatus;
              next_retry_at: string | null;
              pending_replacement: boolean;
              active_build_in_progress: boolean;
            }>(sql`
          WITH active_replacement AS MATERIALIZED (
            SELECT
              id,
              status,
              next_retry_at,
              COALESCE(
                source_watermarks_json#>>'{propertyTilePyramidRepair,baseComparableSourceWatermarkHash}',
                source_watermarks_json#>>'{comparableSourceWatermarkHash}',
                source_watermarks_json#>>'{propertyTilePyramidRepair,baseSourceWatermarkHash}',
                source_watermark_hash
              ) AS comparable_source_watermark_hash
            FROM property_tile_pyramid_versions
            WHERE coverage_id = ${slot.coverageId}
              AND filter_signature = ${slot.filterSignature}
              AND max_zoom = ${slot.maxZoom}
              AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
              AND status IN ('building', 'validating')
              AND lease_until IS NOT NULL
              AND lease_until > now()
            ORDER BY requested_at ASC NULLS LAST, updated_at ASC
            LIMIT 1
          ),
          pending AS (
            UPDATE property_tile_pyramid_versions v
            SET
              pending_replacement_watermarks_json = jsonb_build_object(
                'sourceWatermarkHash', ${activeSlotConflictPendingRequest.sourceWatermarkHash}::text,
                'sourceWatermarksJson', ${JSON.stringify(activeSlotConflictPendingRequest.sourceWatermarksJson)}::jsonb,
                'reason', ${reason}::text,
                'requestedAt', now()
              ),
              request_reason = ${reason}::text,
              updated_at = now()
            FROM active_replacement a
            WHERE v.id = a.id
              AND a.comparable_source_watermark_hash IS DISTINCT FROM ${activeSlotConflictPendingRequest.comparableSourceWatermarkHash}
            RETURNING v.id::text, v.status, v.next_retry_at::text, true AS pending_replacement, false AS active_build_in_progress
          ),
          active_same AS (
            SELECT
              a.id::text,
              a.status,
              a.next_retry_at::text,
              false AS pending_replacement,
              false AS active_build_in_progress
            FROM active_replacement a
            WHERE NOT EXISTS (SELECT 1 FROM pending)
              AND a.comparable_source_watermark_hash IS NOT DISTINCT FROM ${activeSlotConflictPendingRequest.comparableSourceWatermarkHash}
          )
          SELECT * FROM pending
          UNION ALL
          SELECT * FROM active_same
          LIMIT 1
        `);
        const pending = Array.from(pendingRows)[0];
        if (pending) {
          let coalescedReason = 'active-slot-conflict';
          if (pending.pending_replacement) {
            coalescedReason = 'pending-replacement-recorded';
          } else if (pending.active_build_in_progress) {
            coalescedReason = 'active-build-in-progress';
          }
          return {
            status: 'coalesced',
            versionId: pending.id,
            existingStatus: pending.status,
            nextRetryAt: pending.next_retry_at,
            reason: coalescedReason,
          };
        }
      }

      const activeRows = await db.execute<{
        id: string;
        status: PropertyTilePyramidStatus;
        next_retry_at: string | null;
      }>(sql`
        SELECT id::text, status, next_retry_at::text
        FROM property_tile_pyramid_versions
        WHERE coverage_id = ${slot.coverageId}
          AND filter_signature = ${slot.filterSignature}
          AND max_zoom = ${slot.maxZoom}
          AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
          AND status IN ('queued', 'building', 'validating', 'failed_retryable')
        ORDER BY requested_at ASC NULLS LAST, updated_at ASC
        LIMIT 1
      `);
      const active = Array.from(activeRows)[0];
      if (active) {
        return {
          status: 'coalesced',
          versionId: active.id,
          existingStatus: active.status,
          nextRetryAt: active.next_retry_at,
          reason: 'active-slot-conflict',
        };
      }
    }
    throw error;
  }
}

async function recoverStalePropertyTilePyramidBuildRequest(input: {
  slot: PropertyTilePyramidSlot;
  reason: string;
}): Promise<number> {
  const rows = await db.execute<{ recovered_count: number | string }>(sql`
    WITH recovered AS (
      UPDATE property_tile_pyramid_versions
      SET
        status = 'failed_retryable',
        request_reason = ${input.reason},
        failure_category = CASE
          WHEN status = 'validated' THEN 'stale_validated'
          ELSE 'lease_expired'
        END,
        failure_message = CASE
          WHEN status = 'validated' THEN 'Validated property tile pyramid build was not promoted'
          ELSE 'Property tile pyramid build lease expired before completion'
        END,
        failed_stage = status::text,
        next_retry_at = now(),
        lease_owner = NULL,
        lease_token = NULL,
        lease_until = NULL,
        build_finished_at = COALESCE(build_finished_at, now()),
        updated_at = now()
      WHERE coverage_id = ${input.slot.coverageId}
        AND filter_signature = ${input.slot.filterSignature}
        AND max_zoom = ${input.slot.maxZoom}
        AND pyramid_kind = ${input.slot.pyramidKind}::property_tile_pyramid_kind
        AND (
          (
            status IN ('building', 'validating')
            AND (lease_until IS NULL OR lease_until <= now())
          )
          OR (
            status = 'validated'
            AND (lease_until IS NULL OR lease_until <= now())
          )
        )
      RETURNING 1
    )
    SELECT count(*)::int AS recovered_count FROM recovered
  `);
  return Number(Array.from(rows)[0]?.recovered_count ?? 0);
}

async function readLeasedActivePropertyTilePyramidBuild(
  slot: PropertyTilePyramidSlot
): Promise<{
  id: string;
  status: Extract<PropertyTilePyramidStatus, 'building' | 'validating'>;
  next_retry_at: string | null;
} | null> {
  const rows = await db.execute<{
    id: string;
    status: Extract<PropertyTilePyramidStatus, 'building' | 'validating'>;
    next_retry_at: string | null;
  }>(sql`
    SELECT id::text, status, next_retry_at::text
    FROM property_tile_pyramid_versions
    WHERE coverage_id = ${slot.coverageId}
      AND filter_signature = ${slot.filterSignature}
      AND max_zoom = ${slot.maxZoom}
      AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
      AND status IN ('building', 'validating')
      AND lease_until IS NOT NULL
      AND lease_until > now()
    ORDER BY requested_at ASC NULLS LAST, updated_at ASC
    LIMIT 1
  `);
  return Array.from(rows)[0] ?? null;
}

let enqueuePropertyTilePyramidBuildSignalOverrideForTests:
  | ((input: { versionId: string; reason: string; jobId: string }) => Promise<void>)
  | null = null;

async function enqueuePropertyTilePyramidBuildSignal(input: {
  versionId: string;
  reason: string;
  jobId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    if (enqueuePropertyTilePyramidBuildSignalOverrideForTests) {
      await enqueuePropertyTilePyramidBuildSignalOverrideForTests(input);
      return { ok: true };
    }

    const { enqueuePropertyTilePyramidBuild } = await import('./ingest/queue.js');
    await enqueuePropertyTilePyramidBuild(
      {
        versionId: input.versionId,
        reason: input.reason,
      },
      input.jobId
    );
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown pyramid queue dispatch error';
    await db.execute(sql`
      UPDATE property_tile_pyramid_versions
      SET
        failure_category = 'queue_dispatch',
        failure_message = ${message},
        updated_at = now()
      WHERE id = ${input.versionId}::uuid
    `);
    return { ok: false, message };
  }
}

export function setPropertyTilePyramidBuildSignalOverrideForTests(
  override: ((input: { versionId: string; reason: string; jobId: string }) => Promise<void>) | null,
): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Property tile pyramid build signal override is only available in tests');
  }

  enqueuePropertyTilePyramidBuildSignalOverrideForTests = override;
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

  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `
  )}]::uuid[]`;
}

function jsonSql(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

async function withSessionAdvisoryLock<T>(
  lockKey: string,
  run: () => Promise<T>,
  onLocked: () => T | Promise<T>
): Promise<T> {
  const reserved = (await reserveDbConnection()) as unknown as {
    <TRow extends Record<string, unknown> = Record<string, unknown>>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<TRow[]>;
    release: () => void;
  };
  let locked = false;
  try {
    const rows = await reserved<{ locked: boolean }>`
      SELECT pg_try_advisory_lock(hashtext(${lockKey})) AS locked
    `;
    locked = rows[0]?.locked === true;
    if (!locked) {
      return await onLocked();
    }
    return await run();
  } finally {
    try {
      if (locked) {
        await reserved`SELECT pg_advisory_unlock(hashtext(${lockKey}))`;
      }
    } finally {
      reserved.release();
    }
  }
}

function readPendingReplacementWatermarkSnapshot(
  value: Record<string, unknown> | null
): { sourceWatermarkHash: string; sourceWatermarksJson: Record<string, unknown> } | null {
  if (!value || Object.keys(value).length === 0) {
    return null;
  }

  const sourceWatermarkHash = value.sourceWatermarkHash;
  if (typeof sourceWatermarkHash !== 'string' || sourceWatermarkHash.length === 0) {
    return null;
  }

  return {
    sourceWatermarkHash,
    sourceWatermarksJson: readRecord(
      value.sourceWatermarksJson ?? {},
      'pending replacement watermarks'
    ),
  };
}

function readExplainPlanRows(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const rows = readExplainPlanRows(item);
      if (rows != null) {
        return rows;
      }
    }
    return null;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const planRows = record['Plan Rows'];
  if (typeof planRows === 'number' && Number.isFinite(planRows) && planRows >= 0) {
    return planRows;
  }

  const plan = readExplainPlanRows(record.Plan);
  if (plan != null) {
    return plan;
  }

  return readExplainPlanRows(record.Plans);
}

function readQueryPlanField(row: Record<string, unknown> | undefined): unknown {
  if (!row) {
    return null;
  }
  return row['QUERY PLAN'] ?? row['QUERY_PLAN'] ?? row['query plan'] ?? null;
}

async function estimatePropertyTilePyramidPlanRows(query: SQL): Promise<number | null> {
  const rows = await db.execute<Record<string, unknown>>(query);
  const planValue = readQueryPlanField(Array.from(rows)[0]);
  if (typeof planValue === 'string') {
    try {
      return readExplainPlanRows(JSON.parse(planValue));
    } catch {
      return null;
    }
  }
  return readExplainPlanRows(planValue);
}

async function estimatePropertyTilePyramidPreflight(input: {
  coverage: VersionBoundPropertyTilePyramidCoverage;
  tileCount: number;
  controls: PropertyTilePyramidHealthSummary['resourceControls'];
  candidateSnapshotId: string;
  closedSocialActivityCutoffAt: string | Date | null;
}): Promise<{
  estimatedMemberRows: number;
  estimatedPropertySourceRows: number;
  estimatedListingCandidateRows: number;
  estimatedHeapBytes: number;
  estimatedIndexBytes: number;
  estimatedWalBytes: number;
  estimatedWalBytesPerChunk: number;
  retainedMemberRows: number;
}> {
  const envelope = sql`ST_MakeEnvelope(
    ${input.coverage.minLon},
    ${input.coverage.minLat},
    ${input.coverage.maxLon},
    ${input.coverage.maxLat},
    4326
  )`;
  const visibleCandidateRows = await estimatePropertyTilePyramidPlanRows(sql`
    EXPLAIN (FORMAT JSON)
    SELECT pgf.property_id
    FROM property_tile_grouping_facts pgf
    WHERE pgf.geometry && ${envelope}
      AND pgf.snapshot_id = ${input.candidateSnapshotId}::uuid
      AND (
        pgf.has_active_listing
        OR pgf.has_completed_listing
        OR pgf.social_score >= ${ACTIVE_SOCIAL_SCORE_THRESHOLD}
      )
  `);
  const listingCandidateRows = await estimatePropertyTilePyramidPlanRows(sql`
    EXPLAIN (FORMAT JSON)
	    SELECT pgf.property_id
	    FROM property_tile_grouping_facts pgf
	    WHERE pgf.geometry && ${envelope}
	      AND pgf.snapshot_id = ${input.candidateSnapshotId}::uuid
        AND (
          pgf.has_active_listing
          OR pgf.has_completed_listing
        )
	  `);
  const estimatedPropertySourceRows = Math.max(0, Math.ceil(visibleCandidateRows ?? 0));
  const estimatedListingCandidateRows = Math.max(0, Math.ceil(listingCandidateRows ?? 0));
  const estimatedMemberRows = Math.max(estimatedPropertySourceRows, estimatedListingCandidateRows);
  const retainedMemberRows = 0;
  const estimatedHeapBytes = Math.round(
    input.tileCount * PROPERTY_TILE_PYRAMID_PREFLIGHT_TILE_HEAP_BYTES +
      estimatedPropertySourceRows * PROPERTY_TILE_PYRAMID_PREFLIGHT_SOURCE_PLAN_BYTES
  );
  const estimatedIndexBytes = Math.round(
    input.tileCount * PROPERTY_TILE_PYRAMID_PREFLIGHT_TILE_INDEX_BYTES
  );
  const estimatedWalBytes = Math.round((estimatedHeapBytes + estimatedIndexBytes) * 2.5);
  const estimatedChunkCount = Math.max(
    1,
    Math.ceil(input.tileCount / input.controls.chunkTileLimit)
  );
  const estimatedWalBytesPerChunk = Math.ceil(estimatedWalBytes / estimatedChunkCount);
  const maxHeapBytes = input.controls.maxHeapMb * 1024 * 1024;

  if (estimatedMemberRows > input.controls.maxMemberRows) {
    throw new Error(
      `Estimated member-equivalent rows ${estimatedMemberRows} exceeds ${input.controls.maxMemberRows}`
    );
  }
  if (estimatedHeapBytes > maxHeapBytes) {
    throw new Error(`Estimated preflight heap ${estimatedHeapBytes} exceeds ${maxHeapBytes} bytes`);
  }
  if (estimatedWalBytesPerChunk > input.controls.maxWalBytesPerChunk) {
    throw new Error(
      `Estimated preflight WAL per chunk ${estimatedWalBytesPerChunk} exceeds ${input.controls.maxWalBytesPerChunk} bytes`
    );
  }
  if (estimatedWalBytes > input.controls.maxWalBytesPerBuild) {
    throw new Error(
      `Estimated preflight WAL ${estimatedWalBytes} exceeds ${input.controls.maxWalBytesPerBuild} bytes`
    );
  }

  return {
    estimatedMemberRows,
    estimatedPropertySourceRows,
    estimatedListingCandidateRows,
    estimatedHeapBytes,
    estimatedIndexBytes,
    estimatedWalBytes,
    estimatedWalBytesPerChunk,
    retainedMemberRows,
  };
}

function buildLeasePredicate(lease: PropertyTilePyramidBuildLease) {
  return sql`
    SELECT 1
    FROM property_tile_pyramid_versions v
    WHERE v.id = ${lease.versionId}::uuid
      AND v.lease_owner = ${lease.owner}
      AND v.lease_token = ${lease.token}
      AND v.lease_until > now()
      AND v.status IN ('building', 'validating')
  `;
}

async function assertPropertyTilePyramidBuildLease(
  lease: PropertyTilePyramidBuildLease
): Promise<void> {
  const rows = await db.execute<{ ok: boolean }>(sql`
    SELECT EXISTS(${buildLeasePredicate(lease)}) AS ok
  `);
  if (!Array.from(rows)[0]?.ok) {
    throw new PropertyTilePyramidLeaseLostError(lease.versionId);
  }
}

async function updatePropertyTilePyramidBuildLease(input: {
  lease: PropertyTilePyramidBuildLease;
  sql: SQL;
}): Promise<void> {
  const rows = await db.execute<{ affected: number | string }>(input.sql);
  if (Number(Array.from(rows)[0]?.affected ?? 0) !== 1) {
    throw new PropertyTilePyramidLeaseLostError(input.lease.versionId);
  }
}

function sortPyramidGroups(groups: CanonicalPropertyGroup[]): CanonicalPropertyGroup[] {
  return [...groups].sort(
    (a, b) =>
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
  lease: PropertyTilePyramidBuildLease;
}): Promise<void> {
  if (input.groups.length === 0) {
    return;
  }

  const orderedGroups = sortPyramidGroups(input.groups);
  const rows = orderedGroups.map((group, index) => {
    const bbox = group.bbox;
    return sql`(
      ${input.versionId}::uuid,
      ${buildPyramidNodeId({ ...input, ordinal: index, group })}::text,
      ${input.z}::int,
      ${input.x}::int,
      ${input.y}::int,
      ${group.coordinate[0]}::double precision,
      ${group.coordinate[1]}::double precision,
      ST_SetSRID(ST_MakePoint(${group.coordinate[0]}, ${group.coordinate[1]}), 4326),
      ${group.anchorWorldX}::double precision,
      ${group.anchorWorldY}::double precision,
      ${group.nodeClass}::property_tile_pyramid_node_class,
      ${group.groupKind}::property_tile_pyramid_group_kind,
      ${group.pointCount}::int,
      ${group.primaryPropertyId}::uuid,
      ${uuidArraySql(group.previewPropertyIds)},
      ${group.previewPropertyIds.length}::int,
      ${jsonSql({
        primaryPropertyId: group.primaryPropertyId,
        pointCount: group.pointCount,
        propertyIdsOmitted: group.groupKind === 'cluster',
      })},
      ${jsonSql([])},
      ${bbox?.[0] ?? null}::double precision,
      ${bbox?.[1] ?? null}::double precision,
      ${bbox?.[2] ?? null}::double precision,
      ${bbox?.[3] ?? null}::double precision,
      ${group.activeListingCount}::int,
      ${group.completedListingCount}::int,
      ${group.socialCount}::int,
      ${group.recentSocialCount}::int,
      ${group.socialScoreTotal}::real,
      ${group.socialScoreMax}::real,
      ${group.recentSocialScoreTotal}::real,
      ${group.commentCount}::int,
      ${group.groupKind === 'single' ? group.address : null}::text,
      ${group.groupKind === 'single' ? group.city : null}::text,
      ${group.groupKind === 'single' ? group.askingPrice : null}::bigint,
      ${group.groupKind === 'single' ? group.thumbnailUrl : null}::text,
      ${group.groupKind === 'single' ? group.hasActiveListing : null}::boolean,
      ${group.groupKind === 'single' ? group.marketState : null}::varchar(20),
      ${
        group.groupKind === 'cluster'
          ? PROPERTY_TILE_PYRAMID_CLUSTER_TAP_RADIUS_PX
          : PROPERTY_TILE_PYRAMID_SINGLE_TAP_RADIUS_PX
      }::real,
      ${group.socialScoreMax}::real
    )`;
  });

  const result = await db.execute<{ inserted_count: number | string }>(sql`
    WITH lease AS (
      ${buildLeasePredicate(input.lease)}
    ),
    rows (
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
    ) AS (
      VALUES ${sql.join(rows, sql`, `)}
    ),
    inserted AS (
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
      SELECT rows.*
      FROM rows
      CROSS JOIN lease
      RETURNING 1
    )
    SELECT count(*)::int AS inserted_count FROM inserted
  `);
  if (Number(Array.from(result)[0]?.inserted_count ?? 0) !== rows.length) {
    throw new PropertyTilePyramidLeaseLostError(input.versionId);
  }
}

async function upsertPropertyTilePyramidTileManifest(input: {
  versionId: string;
  z: number;
  x: number;
  y: number;
  nodeCount: number;
  lease: PropertyTilePyramidBuildLease;
}): Promise<void> {
  const emptyEtag = buildPropertyTilePyramidEtag({
    versionId: input.versionId,
    z: input.z,
    x: input.x,
    y: input.y,
    payload: null,
  });
  const result = await db.execute<{ affected: number | string }>(sql`
    WITH lease AS (
      ${buildLeasePredicate(input.lease)}
    ),
    upserted AS (
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
      SELECT
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
      FROM lease
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
      RETURNING 1
    )
    SELECT count(*)::int AS affected FROM upserted
  `);
  if (Number(Array.from(result)[0]?.affected ?? 0) !== 1) {
    throw new PropertyTilePyramidLeaseLostError(input.versionId);
  }
}

async function getCurrentPyramidPointerForSlot(
  slot: PropertyTilePyramidSlot,
  executor: Pick<typeof db, 'execute'> = db
): Promise<{
  currentVersionId: string | null;
  currentPromotedAt: string | null;
  sourceWatermarkHash: string | null;
  sourceWatermarksJson: Record<string, unknown> | null;
}> {
  const rows = await executor.execute<{
    current_version_id: string | null;
    current_promoted_at: string | null;
    source_watermark_hash: string | null;
    source_watermarks_json: Record<string, unknown> | null;
  }>(sql`
    SELECT
      c.current_version_id::text,
      c.current_promoted_at::text,
      v.source_watermark_hash,
      v.source_watermarks_json
    FROM property_tile_pyramid_current c
    LEFT JOIN property_tile_pyramid_versions v ON v.id = c.current_version_id
    WHERE c.coverage_id = ${slot.coverageId}
      AND c.filter_signature = ${slot.filterSignature}
      AND c.max_zoom = ${slot.maxZoom}
      AND c.pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
    LIMIT 1
  `);
  const row = Array.from(rows)[0];
  return {
    currentVersionId: row?.current_version_id ?? null,
    currentPromotedAt: row?.current_promoted_at ?? null,
    sourceWatermarkHash: row?.source_watermark_hash ?? null,
    sourceWatermarksJson: row?.source_watermarks_json ?? null,
  };
}

async function recoverExpiredPropertyTilePyramidBuildLeases(): Promise<{
  retryableVersionCount: number;
}> {
  const rows = await db.execute<{ retryable_version_count: number | string }>(sql`
    WITH recovered AS (
      UPDATE property_tile_pyramid_versions
      SET
        status = 'failed_retryable',
        failure_category = 'lease_expired',
        failure_message = 'Property tile pyramid build lease expired before completion',
        failed_stage = status::text,
        next_retry_at = now(),
        lease_owner = NULL,
        lease_token = NULL,
        lease_until = NULL,
        build_finished_at = COALESCE(build_finished_at, now()),
        updated_at = now()
      WHERE status IN ('building', 'validating', 'validated')
        AND lease_until IS NOT NULL
        AND lease_until <= now()
      RETURNING 1
    )
    SELECT count(*)::int AS retryable_version_count FROM recovered
  `);

  return {
    retryableVersionCount: Number(Array.from(rows)[0]?.retryable_version_count ?? 0),
  };
}

async function markPropertyTilePyramidBuildFailure(input: {
  versionId: string;
  category: string;
  message: string;
  stack?: string | null;
  stage: string;
  retryDelayMinutes?: number;
  lease?: PropertyTilePyramidBuildLease;
}): Promise<void> {
  const leaseCondition = input.lease
    ? sql`
      AND lease_owner = ${input.lease.owner}
      AND lease_token = ${input.lease.token}
      AND lease_until > now()
    `
    : sql``;
  const rows = await db.execute<{ affected: number | string }>(sql`
    WITH updated AS (
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
      ${leaseCondition}
    RETURNING 1
    )
    SELECT count(*)::int AS affected FROM updated
  `);
  if (input.lease && Number(Array.from(rows)[0]?.affected ?? 0) !== 1) {
    throw new PropertyTilePyramidLeaseLostError(input.versionId);
  }
}

async function requestSuccessorPropertyTilePyramidBuildIfWatermarkAdvanced(input: {
  slot: PropertyTilePyramidSlot;
  sourceWatermarkHash: string;
  sourceWatermarksJson?: Record<string, unknown> | null;
  latestSourceWatermarks?: {
    sourceWatermarkHash: string;
    sourceWatermarksJson: Record<string, unknown>;
  };
  pendingReplacementWatermarks?: {
    sourceWatermarkHash: string;
    sourceWatermarksJson: Record<string, unknown>;
  } | null;
  reason: PropertyTilePyramidBuildRequestReason;
}): Promise<PropertyTilePyramidBuildRequest | null> {
  let latestSourceWatermarks;
  try {
    latestSourceWatermarks =
      input.latestSourceWatermarks ?? (await readPropertyTilePyramidSourceWatermarkSnapshot());
  } catch (error) {
    if (isMissingPyramidSchemaError(error)) {
      latestSourceWatermarks = input.pendingReplacementWatermarks ?? null;
    } else {
      throw error;
    }
  }

  const comparableHash = comparableSourceWatermarkHash({
    sourceWatermarkHash: input.sourceWatermarkHash,
    sourceWatermarksJson: input.sourceWatermarksJson ?? null,
  });
  const comparableLatestHash = latestSourceWatermarks
    ? comparableSourceWatermarkHash(latestSourceWatermarks)
    : null;
  const comparablePendingHash = input.pendingReplacementWatermarks
    ? comparableSourceWatermarkHash(input.pendingReplacementWatermarks)
    : null;
  const successorWatermarks =
    latestSourceWatermarks && comparableLatestHash !== comparableHash
      ? latestSourceWatermarks
      : input.pendingReplacementWatermarks && comparablePendingHash !== comparableHash
        ? input.pendingReplacementWatermarks
        : null;

  if (!successorWatermarks) {
    return null;
  }

  try {
    return await requestPropertyTilePyramidBuild({
      reason: input.reason,
      slot: input.slot,
      sourceWatermarkHash: successorWatermarks.sourceWatermarkHash,
      sourceWatermarksJson: successorWatermarks.sourceWatermarksJson,
    });
  } catch (error) {
    if (isMissingPyramidSchemaError(error)) {
      return null;
    }
    throw error;
  }
}

export async function executeDuePropertyTilePyramidBuild(options: {
  leaseOwner: string;
  versionId?: string;
  reason?: string;
  logger?: {
    info?(payload: Record<string, unknown>, message: string): void;
    warn?(payload: Record<string, unknown>, message: string): void;
    error?(payload: Record<string, unknown>, message: string): void;
  };
}): Promise<Record<string, unknown>> {
  const needsBackfillLock = await isPropertyTilePyramidInitialBackfillLockRequired();
  if (needsBackfillLock) {
    return withSessionAdvisoryLock(
      PYRAMID_BACKFILL_ADVISORY_LOCK,
      () => executeDuePropertyTilePyramidBuildInternal(options),
      () => ({ status: 'noop', reason: 'backfill-lock-held' })
    );
  }
  return executeDuePropertyTilePyramidBuildInternal(options);
}

async function isPropertyTilePyramidInitialBackfillLockRequired(): Promise<boolean> {
  const reserved = (await reserveDbConnection()) as unknown as {
    <TRow extends Record<string, unknown> = Record<string, unknown>>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<TRow[]>;
    release: () => void;
  };
  try {
    const rows = await reserved<{ required: boolean }>`
      SELECT NOT EXISTS (
        SELECT 1
        FROM property_tile_pyramid_current
        LIMIT 1
      ) AS required
    `;
    return rows[0]?.required === true;
  } catch (error) {
    if (isMissingPyramidSchemaError(error)) {
      return false;
    }
    throw error;
  } finally {
    reserved.release();
  }
}

async function executeDuePropertyTilePyramidBuildInternal(options: {
  leaseOwner: string;
  versionId?: string;
  reason?: string;
  logger?: {
    info?(payload: Record<string, unknown>, message: string): void;
    warn?(payload: Record<string, unknown>, message: string): void;
    error?(payload: Record<string, unknown>, message: string): void;
  };
}): Promise<Record<string, unknown>> {
  let activeVersionId: string | null = null;
  let activeLease: PropertyTilePyramidBuildLease | null = null;
  let activeBuild: {
    slot: PropertyTilePyramidSlot;
    sourceWatermarkHash: string;
    sourceWatermarksJson: Record<string, unknown> | null;
    pendingReplacementWatermarks?: {
      sourceWatermarkHash: string;
      sourceWatermarksJson: Record<string, unknown>;
    } | null;
  } | null = null;
  try {
    const recoveredLeases = await recoverExpiredPropertyTilePyramidBuildLeases();
    if (recoveredLeases.retryableVersionCount > 0) {
      options.logger?.warn?.(
        { recoveredVersionCount: recoveredLeases.retryableVersionCount },
        'Recovered expired property tile pyramid build leases'
      );
    }

    const leaseToken = randomUUID();
    const candidateRows = await db.execute<
      Omit<PropertyTilePyramidBuildCandidateRow, 'lease_token'>
    >(sql`
      WITH candidate AS MATERIALIZED (
        SELECT id
        FROM property_tile_pyramid_versions
        WHERE status IN ('queued', 'failed_retryable')
          AND (next_retry_at IS NULL OR next_retry_at <= now())
          AND (lease_until IS NULL OR lease_until <= now())
          AND (${options.versionId ?? null}::uuid IS NULL OR id = ${options.versionId ?? null}::uuid)
        ORDER BY requested_at ASC NULLS LAST, updated_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      ),
      backfill_gate AS MATERIALIZED (
        SELECT
          c.id,
          NOT EXISTS (
            SELECT 1
            FROM property_tile_pyramid_current current
            JOIN property_tile_pyramid_versions candidate_version
              ON candidate_version.id = c.id
            WHERE current.coverage_id = candidate_version.coverage_id
              AND current.filter_signature = candidate_version.filter_signature
              AND current.max_zoom = candidate_version.max_zoom
              AND current.pyramid_kind = candidate_version.pyramid_kind
          ) AS backfill_lock_required
        FROM candidate c
	      )
	      SELECT
	        v.id::text,
	        v.status,
	        v.coverage_id,
	        v.filter_signature,
	        v.max_zoom,
	        v.pyramid_kind::text,
	        v.config_hash,
	        v.build_inputs_hash,
	        v.source_watermark_hash,
	        v.source_watermarks_json,
	        v.candidate_snapshot_id::text,
	        v.coverage_snapshot_json,
	        v.config_snapshot_json,
	        v.grouping_constants_json,
	        v.pending_replacement_watermarks_json,
	        v.requested_at::text,
	        backfill_gate.backfill_lock_required,
	        true AS backfill_lock_acquired
	      FROM property_tile_pyramid_versions v
	      JOIN backfill_gate ON backfill_gate.id = v.id
	    `);
    const candidateRow = Array.from(candidateRows)[0];
    if (!candidateRow) {
      return { status: 'noop', reason: 'no-eligible-pyramid-version' };
    }

    const slot: PropertyTilePyramidSlot = {
      coverageId: candidateRow.coverage_id,
      filterSignature: candidateRow.filter_signature,
      maxZoom: candidateRow.max_zoom,
      pyramidKind: candidateRow.pyramid_kind,
    };
    const pendingReplacementWatermarks = readPendingReplacementWatermarkSnapshot(
      candidateRow.pending_replacement_watermarks_json
    );
    const buildContext = buildVersionBoundPropertyTilePyramidContext({
      slot,
      buildInputsHash: candidateRow.build_inputs_hash,
      configHash: candidateRow.config_hash,
      coverageSnapshotJson: candidateRow.coverage_snapshot_json,
      configSnapshotJson: candidateRow.config_snapshot_json,
      groupingConstantsJson: candidateRow.grouping_constants_json,
    });
    const rowSourceWatermarksJson = candidateRow.source_watermarks_json ?? {};
    const comparableClosedSourceWatermarkHash = comparableSourceWatermarkHash({
      sourceWatermarkHash: candidateRow.source_watermark_hash,
      sourceWatermarksJson: rowSourceWatermarksJson,
    });
    let candidateSourceSnapshot: PropertyTileCandidateSourceSnapshot | null =
      candidateRow.candidate_snapshot_id
        ? await readReadyPropertyTileCandidateSourceSnapshotById({
            snapshotId: candidateRow.candidate_snapshot_id,
            slot,
          })
        : await readReadyPropertyTileCandidateSourceSnapshot({
            slot,
            comparableSourceWatermarkHash: comparableClosedSourceWatermarkHash,
          });
    if (candidateRow.candidate_snapshot_id) {
      const candidateSnapshotFailure = !candidateSourceSnapshot
        ? 'candidate source snapshot is not ready'
        : candidateSourceSnapshot.comparableSourceWatermarkHash !==
            comparableClosedSourceWatermarkHash
          ? 'candidate source snapshot does not match build source'
          : null;
      if (candidateSnapshotFailure) {
        await markPropertyTilePyramidBuildFailure({
          versionId: candidateRow.id,
          category: 'build_error',
          message: `Property tile pyramid version ${candidateRow.id} ${candidateSnapshotFailure}`,
          stage: 'candidate-source-snapshot',
          retryDelayMinutes: 15,
        });
        await requestSuccessorPropertyTilePyramidBuildIfWatermarkAdvanced({
          slot,
          sourceWatermarkHash: candidateRow.source_watermark_hash,
          sourceWatermarksJson: rowSourceWatermarksJson,
          pendingReplacementWatermarks,
          reason: 'source-watermark',
        });
        return {
          status: 'failed_retryable',
          versionId: candidateRow.id,
          failureCategory: 'build_error',
        };
      }
    }
    if (!candidateSourceSnapshot) {
      const latestAtClaimSourceWatermarks = await readPropertyTilePyramidSourceWatermarkSnapshot();
      const latestAtClaimComparableHash = comparableSourceWatermarkHash(
        latestAtClaimSourceWatermarks
      );
      if (latestAtClaimComparableHash !== comparableClosedSourceWatermarkHash) {
        await db.execute(sql`
          UPDATE property_tile_pyramid_versions
          SET
            status = 'superseded',
            terminal_reason = 'Superseded because source watermarks advanced before candidate snapshot closure',
            superseded_at = now(),
            build_finished_at = COALESCE(build_finished_at, now()),
            validation_summary = jsonb_set(
              COALESCE(validation_summary, '{}'::jsonb),
              '{superseded}',
              ${JSON.stringify({
                reason: 'source-watermark-advanced-before-candidate-snapshot',
                latestSourceWatermarkHash: latestAtClaimSourceWatermarks.sourceWatermarkHash,
              })}::jsonb,
              true
            ),
            updated_at = now()
          WHERE id = ${candidateRow.id}::uuid
            AND status IN ('queued', 'failed_retryable')
        `);
        await requestPropertyTilePyramidBuild({
          slot,
          reason: 'source-watermark',
          sourceWatermarkHash: latestAtClaimSourceWatermarks.sourceWatermarkHash,
          sourceWatermarksJson: latestAtClaimSourceWatermarks.sourceWatermarksJson,
          buildInputsHash: candidateRow.build_inputs_hash,
        });
        return {
          status: 'superseded',
          versionId: candidateRow.id,
          reason: 'source-watermark-advanced-before-candidate-snapshot',
        };
      }
    }

    const claimedRows = await db.execute<PropertyTilePyramidBuildCandidateRow>(sql`
      WITH updated AS (
        UPDATE property_tile_pyramid_versions
        SET
          status = 'building',
          lease_owner = ${options.leaseOwner},
          lease_token = ${leaseToken},
          lease_until = now() + (
            COALESCE((config_snapshot_json->'resourceControls'->>'leaseSeconds')::int, ${DEFAULT_LEASE_SECONDS})
            || ' seconds'
          )::interval,
          attempt_count = COALESCE(attempt_count, 0) + 1,
          last_attempt_at = now(),
          build_started_at = now(),
          build_finished_at = NULL,
          failure_category = NULL,
          failure_message = NULL,
          failure_stack_summary = NULL,
          failed_stage = NULL,
          terminal_reason = NULL,
          next_retry_at = NULL,
          updated_at = now()
        WHERE id = ${candidateRow.id}::uuid
          AND status IN ('queued', 'failed_retryable')
          AND (next_retry_at IS NULL OR next_retry_at <= now())
          AND (lease_until IS NULL OR lease_until <= now())
        RETURNING
          id::text,
          status,
          coverage_id,
          filter_signature,
          max_zoom,
          pyramid_kind::text,
          config_hash,
          build_inputs_hash,
          source_watermark_hash,
          source_watermarks_json,
          candidate_snapshot_id::text,
          coverage_snapshot_json,
          config_snapshot_json,
          grouping_constants_json,
          pending_replacement_watermarks_json,
          requested_at::text,
          lease_token
      )
      SELECT
        updated.*,
        ${candidateRow.backfill_lock_required}::boolean AS backfill_lock_required,
        true AS backfill_lock_acquired
      FROM updated
    `);
    const row = Array.from(claimedRows)[0];
    if (!row) {
      return {
        status: 'noop',
        reason: 'pyramid-build-lease-not-acquired',
        versionId: candidateRow.id,
      };
    }
    activeVersionId = row.id;
    const lease: PropertyTilePyramidBuildLease = {
      versionId: row.id,
      owner: options.leaseOwner,
      token: row.lease_token,
    };
    activeLease = lease;
    activeBuild = {
      slot,
      sourceWatermarkHash: row.source_watermark_hash,
      sourceWatermarksJson: row.source_watermarks_json,
      pendingReplacementWatermarks,
    };

    const supersedeActiveBuildBeforeCandidateSnapshotClosure = async (input: {
      latestSourceWatermarks: {
        sourceWatermarkHash: string;
        sourceWatermarksJson: Record<string, unknown>;
      };
    }) => {
      const supersededRows = await db.execute<{ affected: number | string }>(sql`
        WITH updated AS (
          UPDATE property_tile_pyramid_versions
          SET
            status = 'superseded',
            terminal_reason = 'Superseded because source watermarks advanced before candidate snapshot closure',
            superseded_at = now(),
            build_finished_at = COALESCE(build_finished_at, now()),
            lease_owner = NULL,
            lease_token = NULL,
            lease_until = NULL,
            validation_summary = jsonb_set(
              COALESCE(validation_summary, '{}'::jsonb),
              '{superseded}',
              ${JSON.stringify({
                reason: 'source-watermark-advanced-before-candidate-snapshot',
                latestSourceWatermarkHash: input.latestSourceWatermarks.sourceWatermarkHash,
              })}::jsonb,
              true
            ),
            updated_at = now()
          WHERE id = ${row.id}::uuid
            AND status = 'building'
            AND lease_owner = ${lease.owner}
            AND lease_token = ${lease.token}
            AND lease_until > now()
          RETURNING 1
        )
        SELECT count(*)::int AS affected FROM updated
      `);
      if (Number(Array.from(supersededRows)[0]?.affected ?? 0) !== 1) {
        throw new PropertyTilePyramidLeaseLostError(row.id);
      }
      activeVersionId = null;
      activeLease = null;
      activeBuild = null;
      await requestPropertyTilePyramidBuild({
        slot,
        reason: 'source-watermark',
        sourceWatermarkHash: input.latestSourceWatermarks.sourceWatermarkHash,
        sourceWatermarksJson: input.latestSourceWatermarks.sourceWatermarksJson,
        buildInputsHash: row.build_inputs_hash,
      });
      return {
        status: 'superseded',
        versionId: row.id,
        reason: 'source-watermark-advanced-before-candidate-snapshot',
      };
    };

    if (!candidateSourceSnapshot) {
      try {
        candidateSourceSnapshot = await ensurePropertyTileCandidateSourceSnapshot({
          slot,
          sourceWatermarkHash: row.source_watermark_hash,
          sourceWatermarksJson: row.source_watermarks_json ?? {},
          heartbeat: {
            lease,
            leaseSeconds: buildContext.resourceControls.leaseSeconds,
          },
        });
      } catch (error) {
        if (!(error instanceof SourceWatermarkAdvancedBeforeCandidateSnapshotClosureError)) {
          throw error;
        }
        return supersedeActiveBuildBeforeCandidateSnapshotClosure({
          latestSourceWatermarks: error.latestSourceWatermarks,
        });
      }
    }
    const failCandidateSourceSnapshotInvariant = async (
      stage: 'candidate-source-snapshot-attach',
      message: string
    ) => {
      await markPropertyTilePyramidBuildFailure({
        versionId: row.id,
        category: 'build_error',
        message,
        stage,
        retryDelayMinutes: 15,
        lease,
      });
      await requestSuccessorPropertyTilePyramidBuildIfWatermarkAdvanced({
        slot,
        sourceWatermarkHash: row.source_watermark_hash,
        sourceWatermarksJson: row.source_watermarks_json,
        pendingReplacementWatermarks,
        reason: 'source-watermark',
      });
      return {
        status: 'failed_retryable' as const,
        versionId: row.id,
        failureCategory: 'build_error',
      };
    };
    if (row.candidate_snapshot_id == null) {
      const attachedRows = await db.execute<{ candidate_snapshot_id: string | null }>(sql`
        UPDATE property_tile_pyramid_versions
        SET
          candidate_snapshot_id = ${candidateSourceSnapshot.id}::uuid,
          validation_summary = jsonb_set(
            COALESCE(validation_summary, '{}'::jsonb),
            '{candidateSourceSnapshot}',
            ${JSON.stringify(buildCandidateSourceSnapshotAudit(candidateSourceSnapshot))}::jsonb,
            true
          ),
          updated_at = now()
        WHERE id = ${row.id}::uuid
          AND status = 'building'
          AND lease_owner = ${lease.owner}
          AND lease_token = ${lease.token}
          AND lease_until > now()
        RETURNING candidate_snapshot_id::text
      `);
      const attached = Array.from(attachedRows);
      if (attached.length !== 1) {
        throw new PropertyTilePyramidLeaseLostError(row.id);
      }
      if (attached[0]?.candidate_snapshot_id !== candidateSourceSnapshot.id) {
        return failCandidateSourceSnapshotInvariant(
          'candidate-source-snapshot-attach',
          `Property tile pyramid version ${row.id} failed to attach candidate source snapshot ${candidateSourceSnapshot.id}`
        );
      }
    } else {
      const updatedRows = await db.execute<{ affected: number | string }>(sql`
        WITH updated AS (
        UPDATE property_tile_pyramid_versions
        SET
          validation_summary = jsonb_set(
            COALESCE(validation_summary, '{}'::jsonb),
            '{candidateSourceSnapshot}',
            ${JSON.stringify(buildCandidateSourceSnapshotAudit(candidateSourceSnapshot))}::jsonb,
            true
          ),
          updated_at = now()
        WHERE id = ${row.id}::uuid
          AND status = 'building'
          AND lease_owner = ${lease.owner}
          AND lease_token = ${lease.token}
          AND lease_until > now()
        RETURNING 1
        )
        SELECT count(*)::int AS affected FROM updated
      `);
      if (Number(Array.from(updatedRows)[0]?.affected ?? 0) !== 1) {
        throw new PropertyTilePyramidLeaseLostError(row.id);
      }
    }
    const closedSocialActivityCutoffAt = readRollingSocialWindowCutoffAt(
      candidateSourceSnapshot.sourceWatermarksJson
    );
    const tiles = computePropertyTileSnapshotCoordinatesFromCoverage(buildContext.coverage);
    const controls = buildContext.resourceControls;
    const startedAt = Date.now();
    let nodeCount = 0;
    const retainedMemberRowCount = 0;
    let pointRowCount = 0;
    let nonEmptyTileCount = 0;
    let encodedPayloadBytes = 0;

    let preflightEstimate: Awaited<ReturnType<typeof estimatePropertyTilePyramidPreflight>>;
    try {
      preflightEstimate = await estimatePropertyTilePyramidPreflight({
        coverage: buildContext.coverage,
        tileCount: tiles.length,
        controls,
        candidateSnapshotId: candidateSourceSnapshot.id,
        closedSocialActivityCutoffAt,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Property tile pyramid preflight resource estimate failed';
      await markPropertyTilePyramidBuildFailure({
        versionId: row.id,
        category: 'resource_limit',
        message,
        stage: 'resource-validation-preflight',
        retryDelayMinutes: 15,
        lease,
      });
      await requestSuccessorPropertyTilePyramidBuildIfWatermarkAdvanced({
        slot,
        sourceWatermarkHash: row.source_watermark_hash,
        sourceWatermarksJson: row.source_watermarks_json,
        pendingReplacementWatermarks,
        reason: 'source-watermark',
      });
      return {
        status: 'failed_retryable',
        versionId: row.id,
        failureCategory: 'resource_limit',
      };
    }

    await assertPropertyTilePyramidBuildLease(lease);
    await db.execute(sql`
      DELETE FROM property_tile_pyramid_nodes n
      USING property_tile_pyramid_versions v
      WHERE n.version_id = v.id
        AND v.id = ${row.id}::uuid
        AND v.lease_owner = ${lease.owner}
        AND v.lease_token = ${lease.token}
        AND v.lease_until > now()
    `);
    await db.execute(sql`
      DELETE FROM property_tile_pyramid_tiles t
      USING property_tile_pyramid_versions v
      WHERE t.version_id = v.id
        AND v.id = ${row.id}::uuid
        AND v.lease_owner = ${lease.owner}
        AND v.lease_token = ${lease.token}
        AND v.lease_until > now()
    `);

    for (let index = 0; index < tiles.length; index += 1) {
      const tile = tiles[index];
      if (index > 0 && index % controls.chunkTileLimit === 0) {
        await updatePropertyTilePyramidBuildLease({
          lease,
          sql: sql`
            WITH updated AS (
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
                AND lease_owner = ${lease.owner}
                AND lease_token = ${lease.token}
                AND lease_until > now()
                AND status = 'building'
              RETURNING 1
            )
            SELECT count(*)::int AS affected FROM updated
          `,
        });
      }

      const groups = await buildCanonicalGroupsForTileUncached(tile, buildContext.filters, {
        statementTimeoutMs: controls.statementTimeoutMs,
        clusterPropertyIdRetention: 'preview-only',
        candidateSnapshotId: candidateSourceSnapshot.id,
        closedSocialActivityCutoffAt,
      });
      nodeCount += groups.length;
      pointRowCount += groups.reduce((sum, group) => sum + group.pointCount, 0);
      if (groups.length > 0) {
        nonEmptyTileCount += 1;
      }

      await upsertPropertyTilePyramidTileManifest({
        versionId: row.id,
        z: tile.z,
        x: tile.x,
        y: tile.y,
        nodeCount: groups.length,
        lease,
      });
      await insertPropertyTilePyramidNodes({
        versionId: row.id,
        z: tile.z,
        x: tile.x,
        y: tile.y,
        groups,
        lease,
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
            coverage: buildContext.coverage,
          },
          z: tile.z,
          x: tile.x,
          y: tile.y,
          lease,
        });
        encodedPayloadBytes += encoded.payload?.byteLength ?? 0;
      }
    }

    const heapBytes = nodeCount * 600 + tiles.length * 250 + encodedPayloadBytes;
    const indexBytes = Math.round(nodeCount * 160 + tiles.length * 80);
    const walBytes = Math.round((heapBytes + indexBytes) * 2.5);
    const observedChunkCount = Math.max(1, Math.ceil(tiles.length / controls.chunkTileLimit));
    const walBytesPerChunk = Math.ceil(walBytes / observedChunkCount);
    const maxHeapBytes = controls.maxHeapMb * 1024 * 1024;
    if (
      heapBytes > maxHeapBytes ||
      walBytesPerChunk > controls.maxWalBytesPerChunk ||
      walBytes > controls.maxWalBytesPerBuild
    ) {
      await markPropertyTilePyramidBuildFailure({
        versionId: row.id,
        category: 'resource_limit',
        message:
          heapBytes > maxHeapBytes
            ? `Estimated heap ${heapBytes} exceeds ${maxHeapBytes} bytes`
            : walBytesPerChunk > controls.maxWalBytesPerChunk
              ? `Estimated WAL per chunk ${walBytesPerChunk} exceeds ${controls.maxWalBytesPerChunk} bytes`
              : `Estimated WAL ${walBytes} exceeds ${controls.maxWalBytesPerBuild} bytes`,
        stage: 'resource-validation',
        retryDelayMinutes: 15,
        lease,
      });
      await requestSuccessorPropertyTilePyramidBuildIfWatermarkAdvanced({
        slot,
        sourceWatermarkHash: row.source_watermark_hash,
        sourceWatermarksJson: row.source_watermarks_json,
        pendingReplacementWatermarks,
        reason: 'source-watermark',
      });
      return {
        status: 'failed_retryable',
        versionId: row.id,
        failureCategory: 'resource_limit',
      };
    }

    await updatePropertyTilePyramidBuildLease({
      lease,
      sql: sql`
        WITH updated AS (
          UPDATE property_tile_pyramid_versions
          SET
            status = 'validating',
            lease_until = now() + (${controls.leaseSeconds} || ' seconds')::interval,
            expected_tile_count = ${tiles.length},
            validated_tile_count = ${tiles.length},
            non_empty_tile_count = ${nonEmptyTileCount},
            node_count = ${nodeCount},
            member_row_count = ${retainedMemberRowCount},
            encoded_payload_bytes = ${encodedPayloadBytes},
            heap_bytes = ${heapBytes},
            index_bytes = ${indexBytes},
            wal_bytes = ${walBytes},
            validation_summary = ${JSON.stringify({
              expectedTileCount: tiles.length,
              observedTileCount: tiles.length,
              nonEmptyTileCount,
              nodeCount,
              retainedMemberRowCount,
              pointRowCount,
              encodedPayloadBytes,
              heapBytes,
              indexBytes,
              walBytes,
              walBytesPerChunk,
              preflight: preflightEstimate,
              wallClockMs: Date.now() - startedAt,
              chunkTileLimit: controls.chunkTileLimit,
              maxMemberRows: controls.maxMemberRows,
              maxWalBytesPerChunk: controls.maxWalBytesPerChunk,
              maxWalBytesPerBuild: controls.maxWalBytesPerBuild,
              sourceWatermarkHash: row.source_watermark_hash,
              candidateSnapshotId: candidateSourceSnapshot.id,
              buildInputsHash: row.build_inputs_hash,
              configHash: row.config_hash,
            })}::jsonb,
            build_finished_at = now(),
            updated_at = now()
          WHERE id = ${row.id}::uuid
            AND lease_owner = ${lease.owner}
            AND lease_token = ${lease.token}
            AND lease_until > now()
            AND status = 'building'
          RETURNING 1
        )
        SELECT count(*)::int AS affected FROM updated
      `,
    });
    const latestSourceWatermarks = await readPropertyTilePyramidSourceWatermarkSnapshot();
    const latestComparableSourceWatermarkHash =
      comparableSourceWatermarkHash(latestSourceWatermarks);
    const sourceWatermarkAdvanced =
      latestComparableSourceWatermarkHash !== comparableClosedSourceWatermarkHash;
    const promotion = {
      status: 'promoted' as 'promoted' | 'superseded_by_current',
    };
    let finalPendingReplacementWatermarks: {
      sourceWatermarkHash: string;
      sourceWatermarksJson: Record<string, unknown>;
    } | null = null;
    let finalPendingReplacementRecorded = false;
    await db.transaction(async (tx) => {
      const validatedRows = await tx.execute<{ affected: number | string }>(sql`
        WITH updated AS (
          UPDATE property_tile_pyramid_versions
          SET
            status = 'validated',
            validated_at = now(),
            build_duration_ms = ${Date.now() - startedAt},
            updated_at = now()
          WHERE id = ${row.id}::uuid
            AND lease_owner = ${lease.owner}
            AND lease_token = ${lease.token}
            AND lease_until > now()
            AND status = 'validating'
          RETURNING 1
        )
        SELECT count(*)::int AS affected FROM updated
      `);
      if (Number(Array.from(validatedRows)[0]?.affected ?? 0) !== 1) {
        throw new PropertyTilePyramidLeaseLostError(row.id);
      }

      const lockedRows = await tx.execute<{
        pending_replacement_watermarks_json: Record<string, unknown> | null;
      }>(sql`
        SELECT pending_replacement_watermarks_json
        FROM property_tile_pyramid_versions
        WHERE id = ${row.id}::uuid
          AND lease_owner = ${lease.owner}
          AND lease_token = ${lease.token}
          AND lease_until > now()
          AND status = 'validated'
        FOR UPDATE
      `);
      const lockedRow = Array.from(lockedRows)[0];
      if (!lockedRow) {
        throw new PropertyTilePyramidLeaseLostError(row.id);
      }
      finalPendingReplacementRecorded =
        lockedRow.pending_replacement_watermarks_json != null &&
        Object.keys(lockedRow.pending_replacement_watermarks_json).length > 0;
      finalPendingReplacementWatermarks = readPendingReplacementWatermarkSnapshot(
        lockedRow.pending_replacement_watermarks_json
      );
      const finalPendingReplacementComparableHash = finalPendingReplacementWatermarks
        ? comparableSourceWatermarkHash(finalPendingReplacementWatermarks)
        : null;
      const finalPendingReplacementAdvanced =
        finalPendingReplacementComparableHash != null &&
        finalPendingReplacementComparableHash !== comparableClosedSourceWatermarkHash;

      const currentPointer = await getCurrentPyramidPointerForSlot(slot, tx);
      const previousVersionId = currentPointer.currentVersionId;
      const currentPointerComparableSourceWatermarkHash = currentPointer.sourceWatermarkHash
        ? comparableSourceWatermarkHash({
            sourceWatermarkHash: currentPointer.sourceWatermarkHash,
            sourceWatermarksJson: currentPointer.sourceWatermarksJson,
          })
        : null;
      if (
        (sourceWatermarkAdvanced || finalPendingReplacementAdvanced) &&
        currentPointer.currentVersionId &&
        (currentPointerComparableSourceWatermarkHash === latestComparableSourceWatermarkHash ||
          (finalPendingReplacementComparableHash != null &&
            currentPointerComparableSourceWatermarkHash ===
              finalPendingReplacementComparableHash) ||
          (currentPointerComparableSourceWatermarkHash !== comparableClosedSourceWatermarkHash &&
            isTimestampAfter(currentPointer.currentPromotedAt, row.requested_at)))
      ) {
        promotion.status = 'superseded_by_current';
        const supersededRows = await tx.execute<{ affected: number | string }>(sql`
          WITH updated AS (
            UPDATE property_tile_pyramid_versions
            SET
              status = 'superseded',
              superseded_at = now(),
              lease_owner = NULL,
              lease_token = NULL,
              lease_until = NULL,
              validation_summary = jsonb_set(
                COALESCE(validation_summary, '{}'::jsonb),
                '{superseded}',
                ${JSON.stringify({
                  reason: 'newer-current-pointer',
                  latestSourceWatermarkHash: latestSourceWatermarks.sourceWatermarkHash,
                  currentVersionId: currentPointer.currentVersionId,
                })}::jsonb,
                true
              ),
              updated_at = now()
            WHERE id = ${row.id}::uuid
              AND lease_owner = ${lease.owner}
              AND lease_token = ${lease.token}
            RETURNING 1
          )
          SELECT count(*)::int AS affected FROM updated
        `);
        if (Number(Array.from(supersededRows)[0]?.affected ?? 0) !== 1) {
          throw new PropertyTilePyramidLeaseLostError(row.id);
        }
        return;
      }

      if (finalPendingReplacementRecorded) {
        const clearedPendingRows = await tx.execute<{ affected: number | string }>(sql`
          WITH updated AS (
            UPDATE property_tile_pyramid_versions
            SET
              pending_replacement_watermarks_json = '{}'::jsonb,
              validation_summary = jsonb_set(
                COALESCE(validation_summary, '{}'::jsonb),
                '{pendingReplacementClosed}',
                ${JSON.stringify({
                  reason: finalPendingReplacementAdvanced
                    ? 'successor-requested-after-promotion'
                    : finalPendingReplacementWatermarks
                      ? 'same-source-watermark-hash'
                      : 'invalid-pending-replacement-cleared',
                  sourceWatermarkHash: finalPendingReplacementWatermarks?.sourceWatermarkHash,
                })}::jsonb,
                true
              ),
              updated_at = now()
            WHERE id = ${row.id}::uuid
              AND lease_owner = ${lease.owner}
              AND lease_token = ${lease.token}
            RETURNING 1
          )
          SELECT count(*)::int AS affected FROM updated
        `);
        if (Number(Array.from(clearedPendingRows)[0]?.affected ?? 0) !== 1) {
          throw new PropertyTilePyramidLeaseLostError(row.id);
        }
      }

      await tx.execute(sql`
        SELECT promote_property_tile_pyramid_version(
          ${row.id}::uuid,
          ${previousVersionId}::uuid,
          ${options.reason ?? 'worker-build'},
          ${options.leaseOwner}
        )
      `);

      const clearedRows = await tx.execute<{ affected: number | string }>(sql`
        WITH updated AS (
          UPDATE property_tile_pyramid_versions
          SET
            lease_owner = NULL,
            lease_token = NULL,
            lease_until = NULL,
            updated_at = now()
          WHERE id = ${row.id}::uuid
            AND lease_owner = ${lease.owner}
            AND lease_token = ${lease.token}
          RETURNING 1
        )
        SELECT count(*)::int AS affected FROM updated
      `);
      if (Number(Array.from(clearedRows)[0]?.affected ?? 0) !== 1) {
        throw new PropertyTilePyramidLeaseLostError(row.id);
      }
    });

    if (promotion.status === 'superseded_by_current') {
      return {
        status: 'superseded',
        versionId: row.id,
        reason: 'newer-current-pointer',
      };
    }

    await requestSuccessorPropertyTilePyramidBuildIfWatermarkAdvanced({
      slot,
      sourceWatermarkHash: row.source_watermark_hash,
      sourceWatermarksJson: row.source_watermarks_json,
      latestSourceWatermarks,
      pendingReplacementWatermarks: finalPendingReplacementWatermarks,
      reason: 'source-watermark',
    });

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
        message:
          error instanceof Error ? error.message : 'Unknown property tile pyramid build error',
        stack: error instanceof Error ? error.stack : null,
        stage: 'full-build',
        lease: activeLease ?? undefined,
      });
      if (activeBuild) {
        await requestSuccessorPropertyTilePyramidBuildIfWatermarkAdvanced({
          ...activeBuild,
          reason: 'source-watermark',
        });
      }
    }
    throw error;
  }
}

export async function getPropertyTilePyramidHealthSummary(): Promise<PropertyTilePyramidHealthSummary> {
  const slot = getDefaultPropertyTilePyramidSlot();
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
      closed_watermark_max_updated_at: string | null;
      current_watermark_max_updated_at: string | null;
      closed_to_current_watermark_lag_seconds: number | string | null;
      last_successful_promotion_at: string | null;
    }>(sql`
      WITH current_version AS (
        SELECT v.*
        FROM property_tile_pyramid_current c
        JOIN property_tile_pyramid_versions v ON v.id = c.current_version_id
        WHERE c.coverage_id = ${slot.coverageId}
          AND c.filter_signature = ${slot.filterSignature}
          AND c.max_zoom = ${slot.maxZoom}
          AND c.pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
        LIMIT 1
      ),
      active_candidate AS (
        SELECT id, status, next_retry_at
        FROM property_tile_pyramid_versions
        WHERE coverage_id = ${slot.coverageId}
          AND filter_signature = ${slot.filterSignature}
          AND max_zoom = ${slot.maxZoom}
          AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
          AND (
            status IN ('queued', 'building', 'validating', 'failed_retryable')
            OR (
              status = 'failed_terminal'
              AND (
                (SELECT id FROM current_version) IS NULL
                OR requested_at >= (SELECT promoted_at FROM current_version)
              )
            )
          )
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1
      ),
      active_terminal_failures AS (
        SELECT count(*)::int AS count
        FROM property_tile_pyramid_versions
        WHERE coverage_id = ${slot.coverageId}
          AND filter_signature = ${slot.filterSignature}
          AND max_zoom = ${slot.maxZoom}
          AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
          AND status = 'failed_terminal'
          AND (
            (SELECT id FROM current_version) IS NULL
            OR requested_at >= (SELECT promoted_at FROM current_version)
          )
      ),
      encoded AS (
        SELECT
          CASE
            WHEN COUNT(*) = 0 THEN NULL
            ELSE COUNT(*) FILTER (WHERE payload IS NOT NULL)::float / COUNT(*)::float
          END AS ratio
        FROM property_tile_pyramid_tiles
        WHERE version_id = (SELECT id FROM current_version)
      ),
	      closed_watermark AS (
	        SELECT max(closed_values.value::timestamptz) AS max_updated_at
	        FROM current_version
	        CROSS JOIN LATERAL jsonb_array_elements(
	          COALESCE(source_watermarks_json->'sources', '[]'::jsonb)
	        ) AS entry
	        CROSS JOIN LATERAL (
	          VALUES
	            (entry->>'updatedAt'),
	            (entry->>'watermarkTimestamp'),
	            (entry->>'lastCommittedChangedAt'),
	            (entry->>'lastRunCompletedAt'),
	            (entry->>'sourceHighWatermark'),
	            (entry->>'sourceRunCompletedAt'),
	            (entry->>'maxUpdatedAt'),
	            (entry->>'cutoffAt')
	        ) AS closed_values(value)
	        WHERE entry->>'source' IN (
	            'property_tile_pyramid_source_watermarks',
	            'property_tile_snapshot_watermarks',
	            'ingest_sources',
	            'listing_source_scope_watermarks',
	            'listing_scope_completions',
	            'property_tile_listing_candidates',
	            'property_tile_listing_facts',
	            'property_tile_social_facts',
	            'property_tile_grouping_facts',
	            'rolling_social_window'
	          )
	          AND NULLIF(closed_values.value, '') IS NOT NULL
	      ),
	      current_source_timestamps AS (
	        SELECT max(updated_at) AS max_updated_at
	        FROM property_tile_pyramid_source_watermarks

	        UNION ALL

	        SELECT max(updated_at) AS max_updated_at
	        FROM property_tile_snapshot_watermarks
	        WHERE key IN (${DEFAULT_PROPERTY_TILE_PYRAMID_COVERAGE_ID}, 'global')

	        UNION ALL

	        SELECT max(source_at) AS max_updated_at
	        FROM (
	          SELECT last_committed_changed_at AS source_at
	          FROM ingest_sources
	          UNION ALL
	          SELECT last_run_completed_at AS source_at
	          FROM ingest_sources
	        ) ingest_source_times

	        UNION ALL

	        SELECT max(updated_at) AS max_updated_at
	        FROM listing_source_scope_watermarks

	        UNION ALL

	        SELECT max(source_at) AS max_updated_at
	        FROM (
	          SELECT source_high_watermark AS source_at
	          FROM listing_scope_completions
	          UNION ALL
	          SELECT source_run_completed_at AS source_at
	          FROM listing_scope_completions
	        ) listing_completion_times

	        UNION ALL

	        SELECT max(s.updated_at) AS max_updated_at
	        FROM property_tile_candidate_source_current c
	        JOIN property_tile_candidate_source_snapshots s ON s.id = c.snapshot_id
	        WHERE c.coverage_id = ${slot.coverageId}
	          AND c.filter_signature = ${slot.filterSignature}
	          AND c.pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind

	        UNION ALL

	        SELECT max(lpc.updated_at) AS max_updated_at
	        FROM property_tile_candidate_source_current c
	        JOIN property_tile_listing_candidates lpc ON lpc.snapshot_id = c.snapshot_id
	        WHERE c.coverage_id = ${slot.coverageId}
	          AND c.filter_signature = ${slot.filterSignature}
	          AND c.pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind

	        UNION ALL

	        SELECT max(ptlf.updated_at) AS max_updated_at
	        FROM property_tile_candidate_source_current c
	        JOIN property_tile_listing_facts ptlf ON ptlf.snapshot_id = c.snapshot_id
	        WHERE c.coverage_id = ${slot.coverageId}
	          AND c.filter_signature = ${slot.filterSignature}
	          AND c.pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind

	        UNION ALL

	        SELECT max(ptsf.updated_at) AS max_updated_at
	        FROM property_tile_candidate_source_current c
	        JOIN property_tile_social_facts ptsf ON ptsf.snapshot_id = c.snapshot_id
	        WHERE c.coverage_id = ${slot.coverageId}
	          AND c.filter_signature = ${slot.filterSignature}
	          AND c.pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind

	        UNION ALL

	        SELECT max(pgf.updated_at) AS max_updated_at
	        FROM property_tile_candidate_source_current c
	        JOIN property_tile_grouping_facts pgf ON pgf.snapshot_id = c.snapshot_id
	        WHERE c.coverage_id = ${slot.coverageId}
	          AND c.filter_signature = ${slot.filterSignature}
	          AND c.pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind

	        UNION ALL

	        SELECT date_trunc('hour', now()) AS max_updated_at
	      ),
	      current_watermark AS (
	        SELECT max(max_updated_at) AS max_updated_at
	        FROM current_source_timestamps
	      )
      SELECT
        (SELECT id::text FROM current_version) AS current_version_id,
        (SELECT promoted_at::text FROM current_version) AS current_promoted_at,
        (SELECT degraded_reason FROM current_version) AS degraded_reason,
        (SELECT id::text FROM active_candidate) AS active_candidate_version_id,
        (SELECT status FROM active_candidate) AS active_candidate_status,
        (SELECT next_retry_at::text FROM active_candidate WHERE status = 'failed_retryable') AS retryable_failure_due_at,
        (SELECT count FROM active_terminal_failures) AS terminal_failure_count,
        (SELECT ratio FROM encoded) AS encoded_coverage_ratio,
        (SELECT max_updated_at::text FROM closed_watermark) AS closed_watermark_max_updated_at,
        (SELECT max_updated_at::text FROM current_watermark) AS current_watermark_max_updated_at,
        (
          SELECT
            CASE
              WHEN closed_watermark.max_updated_at IS NULL OR current_watermark.max_updated_at IS NULL THEN NULL
              ELSE GREATEST(
                0,
                EXTRACT(EPOCH FROM current_watermark.max_updated_at - closed_watermark.max_updated_at)
              )
            END
          FROM closed_watermark, current_watermark
        ) AS closed_to_current_watermark_lag_seconds,
        (
          SELECT max(promoted_at)::text
          FROM property_tile_pyramid_versions
          WHERE coverage_id = ${slot.coverageId}
            AND filter_signature = ${slot.filterSignature}
            AND max_zoom = ${slot.maxZoom}
            AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
            AND status = 'promoted'
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
      encodedCoverageRatio:
        row?.encoded_coverage_ratio == null ? null : Number(row.encoded_coverage_ratio),
      closedWatermarkMaxUpdatedAt: row?.closed_watermark_max_updated_at ?? null,
      currentWatermarkMaxUpdatedAt: row?.current_watermark_max_updated_at ?? null,
      closedToCurrentWatermarkLagSeconds:
        row?.closed_to_current_watermark_lag_seconds == null
          ? null
          : Number(row.closed_to_current_watermark_lag_seconds),
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
        closedWatermarkMaxUpdatedAt: null,
        currentWatermarkMaxUpdatedAt: null,
        closedToCurrentWatermarkLagSeconds: null,
        lastSuccessfulPromotionAt: null,
        resourceControls: getPropertyTilePyramidResourceControls(),
      };
    }
    throw error;
  }
}

export async function getPropertyTilePyramidOpsSummary(): Promise<PropertyTilePyramidOpsSummary> {
  const health = await getPropertyTilePyramidHealthSummary();
  const slot = getDefaultPropertyTilePyramidSlot();
  try {
    const rows = await db.execute<{
      previous_version_id: string | null;
      manifest_tile_count: number | string | null;
      encoded_tile_count: number | string | null;
      node_count: number | string | null;
      member_count: number | string | null;
      current_build_duration_ms: number | string | null;
      current_observed_wal_bytes: number | string | null;
      active_candidate_stage: string | null;
      active_candidate_build_duration_ms: number | string | null;
      active_candidate_chunk_progress: Record<string, unknown> | null;
      active_candidate_observed_wal_bytes: number | string | null;
      active_lease_owner: string | null;
      active_lease_age_seconds: number | string | null;
      last_audit_action: string | null;
      last_audit_reason: string | null;
    }>(sql`
      WITH current_version AS (
        SELECT v.*
        FROM property_tile_pyramid_current c
        JOIN property_tile_pyramid_versions v ON v.id = c.current_version_id
        WHERE c.coverage_id = ${slot.coverageId}
          AND c.filter_signature = ${slot.filterSignature}
          AND c.max_zoom = ${slot.maxZoom}
          AND c.pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
        LIMIT 1
      ),
      current_pointer AS (
        SELECT previous_version_id
        FROM property_tile_pyramid_current
        WHERE coverage_id = ${slot.coverageId}
          AND filter_signature = ${slot.filterSignature}
          AND max_zoom = ${slot.maxZoom}
          AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
        LIMIT 1
      ),
      active_candidate AS (
        SELECT *
        FROM property_tile_pyramid_versions
        WHERE coverage_id = ${slot.coverageId}
          AND filter_signature = ${slot.filterSignature}
          AND max_zoom = ${slot.maxZoom}
          AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
          AND (
            status IN ('queued', 'building', 'validating', 'failed_retryable')
            OR (
              status = 'failed_terminal'
              AND (
                (SELECT id FROM current_version) IS NULL
                OR requested_at >= (SELECT promoted_at FROM current_version)
              )
            )
          )
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1
      )
      SELECT
        (
          SELECT previous_version_id::text
          FROM current_pointer
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
          SELECT member_row_count::text
          FROM current_version
        ) AS member_count,
        (
          SELECT build_duration_ms
          FROM current_version
        ) AS current_build_duration_ms,
        (
          SELECT NULLIF(wal_bytes, 0)::text
          FROM current_version
        ) AS current_observed_wal_bytes,
        (
          SELECT COALESCE(failed_stage, status::text)
          FROM active_candidate
        ) AS active_candidate_stage,
        (
          SELECT COALESCE(
            build_duration_ms,
            CASE
              WHEN build_started_at IS NULL THEN NULL
              ELSE EXTRACT(EPOCH FROM COALESCE(build_finished_at, now()) - build_started_at) * 1000
            END
          )
          FROM active_candidate
        ) AS active_candidate_build_duration_ms,
        (
          SELECT validation_summary->'chunkProgress'
          FROM active_candidate
          WHERE jsonb_typeof(validation_summary->'chunkProgress') = 'object'
        ) AS active_candidate_chunk_progress,
        (
          SELECT NULLIF(wal_bytes, 0)::text
          FROM active_candidate
        ) AS active_candidate_observed_wal_bytes,
        (
          SELECT lease_owner
          FROM active_candidate
          WHERE status IN ('building', 'validating')
          ORDER BY updated_at DESC NULLS LAST
          LIMIT 1
        ) AS active_lease_owner,
        (
          SELECT EXTRACT(EPOCH FROM now() - lease_until + (${getPropertyTilePyramidResourceControls().leaseSeconds} || ' seconds')::interval)
          FROM active_candidate
          WHERE status IN ('building', 'validating') AND lease_until IS NOT NULL
          ORDER BY updated_at DESC NULLS LAST
          LIMIT 1
        ) AS active_lease_age_seconds,
        (
          SELECT action
          FROM property_tile_pyramid_audit
          WHERE coverage_id = ${slot.coverageId}
            AND filter_signature = ${slot.filterSignature}
            AND max_zoom = ${slot.maxZoom}
            AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
            AND action IN ('promoted', 'rollback')
          ORDER BY created_at DESC
          LIMIT 1
        ) AS last_audit_action,
        (
          SELECT reason
          FROM property_tile_pyramid_audit
          WHERE coverage_id = ${slot.coverageId}
            AND filter_signature = ${slot.filterSignature}
            AND max_zoom = ${slot.maxZoom}
            AND pyramid_kind = ${slot.pyramidKind}::property_tile_pyramid_kind
            AND action IN ('promoted', 'rollback')
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
      currentBuildDurationMs:
        row?.current_build_duration_ms == null ? null : Number(row.current_build_duration_ms),
      currentObservedWalBytes:
        row?.current_observed_wal_bytes == null ? null : Number(row.current_observed_wal_bytes),
      activeCandidateStage: row?.active_candidate_stage ?? null,
      activeCandidateBuildDurationMs:
        row?.active_candidate_build_duration_ms == null
          ? null
          : Number(row.active_candidate_build_duration_ms),
      activeCandidateChunkProgress: row?.active_candidate_chunk_progress ?? null,
      activeCandidateObservedWalBytes:
        row?.active_candidate_observed_wal_bytes == null
          ? null
          : Number(row.active_candidate_observed_wal_bytes),
      activeLeaseOwner: row?.active_lease_owner ?? null,
      activeLeaseAgeSeconds:
        row?.active_lease_age_seconds == null ? null : Number(row.active_lease_age_seconds),
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
        currentBuildDurationMs: null,
        currentObservedWalBytes: null,
        activeCandidateStage: null,
        activeCandidateBuildDurationMs: null,
        activeCandidateChunkProgress: null,
        activeCandidateObservedWalBytes: null,
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
    return await withSessionAdvisoryLock(
      PYRAMID_RETENTION_ADVISORY_LOCK,
      async () => {
        const resetPayloads = await runPropertyTilePyramidRetentionStep({
          sql: sql`
          WITH retained AS (
            SELECT current_version_id AS id FROM property_tile_pyramid_current
            UNION
            SELECT previous_version_id AS id
            FROM property_tile_pyramid_current
            WHERE previous_version_id IS NOT NULL
          ),
          candidate_versions AS (
            SELECT v.id
            FROM property_tile_pyramid_versions v
            WHERE v.id NOT IN (SELECT id FROM retained)
              AND v.status IN ('failed_retryable', 'failed_terminal', 'superseded')
              AND COALESCE(v.updated_at, v.build_finished_at, v.superseded_at, v.created_at) < now() - interval '30 minutes'
              AND (v.lease_until IS NULL OR v.lease_until < now())
          ),
          target AS (
            SELECT t.ctid
            FROM property_tile_pyramid_tiles t
            WHERE t.version_id IN (SELECT id FROM candidate_versions)
              AND t.payload IS NOT NULL
            LIMIT ${PROPERTY_TILE_PYRAMID_RETENTION_CHUNK_LIMIT}
            FOR UPDATE SKIP LOCKED
          ),
          reset AS (
            UPDATE property_tile_pyramid_tiles t
            SET
              tile_status = CASE
                WHEN t.node_count > 0 THEN 'valid_nodes'::property_tile_pyramid_tile_status
                ELSE 'valid_empty'::property_tile_pyramid_tile_status
              END,
              payload = NULL,
              payload_sha256 = NULL,
              payload_generated_at = NULL,
              updated_at = now()
            FROM target
            WHERE t.ctid = target.ctid
            RETURNING 1
          )
          SELECT count(*)::int AS affected FROM reset
        `,
        });
        const deletedMembers = await runOptionalPropertyTilePyramidRetentionStep({
          relationName: 'property_tile_pyramid_members',
          sql: sql`
          WITH retained AS (
            SELECT current_version_id AS id FROM property_tile_pyramid_current
            UNION
            SELECT previous_version_id AS id
            FROM property_tile_pyramid_current
            WHERE previous_version_id IS NOT NULL
          ),
          candidate_versions AS (
            SELECT v.id
            FROM property_tile_pyramid_versions v
            WHERE v.id NOT IN (SELECT id FROM retained)
              AND v.status = 'promoted'
              AND COALESCE(v.updated_at, v.promoted_at, v.created_at) < now() - interval '24 hours'
              AND (v.lease_until IS NULL OR v.lease_until < now())
            UNION
            SELECT v.id
            FROM property_tile_pyramid_versions v
            WHERE v.id NOT IN (SELECT id FROM retained)
              AND v.status IN ('failed_retryable', 'failed_terminal', 'superseded')
              AND COALESCE(v.updated_at, v.build_finished_at, v.superseded_at, v.created_at) < now() - interval '30 minutes'
              AND (v.lease_until IS NULL OR v.lease_until < now())
          ),
          target AS (
            SELECT m.ctid
            FROM property_tile_pyramid_members m
            WHERE m.version_id IN (SELECT id FROM candidate_versions)
            LIMIT ${PROPERTY_TILE_PYRAMID_RETENTION_CHUNK_LIMIT}
            FOR UPDATE SKIP LOCKED
          ),
          deleted AS (
            DELETE FROM property_tile_pyramid_members m
            USING target
            WHERE m.ctid = target.ctid
            RETURNING 1
          )
          SELECT count(*)::int AS affected FROM deleted
        `,
        });
        const deletedNodes = await runPropertyTilePyramidRetentionStep({
          sql: sql`
          WITH retained AS (
            SELECT current_version_id AS id FROM property_tile_pyramid_current
            UNION
            SELECT previous_version_id AS id
            FROM property_tile_pyramid_current
            WHERE previous_version_id IS NOT NULL
          ),
          candidate_versions AS (
            SELECT v.id
            FROM property_tile_pyramid_versions v
            WHERE v.id NOT IN (SELECT id FROM retained)
              AND v.status = 'promoted'
              AND COALESCE(v.updated_at, v.promoted_at, v.created_at) < now() - interval '24 hours'
              AND (v.lease_until IS NULL OR v.lease_until < now())
            UNION
            SELECT v.id
            FROM property_tile_pyramid_versions v
            WHERE v.id NOT IN (SELECT id FROM retained)
              AND v.status IN ('failed_retryable', 'failed_terminal', 'superseded')
              AND COALESCE(v.updated_at, v.build_finished_at, v.superseded_at, v.created_at) < now() - interval '30 minutes'
              AND (v.lease_until IS NULL OR v.lease_until < now())
          ),
          target AS (
            SELECT n.ctid
            FROM property_tile_pyramid_nodes n
            WHERE n.version_id IN (SELECT id FROM candidate_versions)
            LIMIT ${PROPERTY_TILE_PYRAMID_RETENTION_CHUNK_LIMIT}
            FOR UPDATE SKIP LOCKED
          ),
          deleted AS (
            DELETE FROM property_tile_pyramid_nodes n
            USING target
            WHERE n.ctid = target.ctid
            RETURNING 1
          )
          SELECT count(*)::int AS affected FROM deleted
        `,
        });
        const deletedTiles = await runPropertyTilePyramidRetentionStep({
          sql: sql`
          WITH retained AS (
            SELECT current_version_id AS id FROM property_tile_pyramid_current
            UNION
            SELECT previous_version_id AS id
            FROM property_tile_pyramid_current
            WHERE previous_version_id IS NOT NULL
          ),
          candidate_versions AS (
            SELECT v.id
            FROM property_tile_pyramid_versions v
            WHERE v.id NOT IN (SELECT id FROM retained)
              AND v.status = 'promoted'
              AND COALESCE(v.updated_at, v.promoted_at, v.created_at) < now() - interval '24 hours'
              AND (v.lease_until IS NULL OR v.lease_until < now())
            UNION
            SELECT v.id
            FROM property_tile_pyramid_versions v
            WHERE v.id NOT IN (SELECT id FROM retained)
              AND v.status IN ('failed_retryable', 'failed_terminal', 'superseded')
              AND COALESCE(v.updated_at, v.build_finished_at, v.superseded_at, v.created_at) < now() - interval '30 minutes'
              AND (v.lease_until IS NULL OR v.lease_until < now())
          ),
          target AS (
            SELECT t.ctid
            FROM property_tile_pyramid_tiles t
            WHERE t.version_id IN (SELECT id FROM candidate_versions)
            LIMIT ${PROPERTY_TILE_PYRAMID_RETENTION_CHUNK_LIMIT}
            FOR UPDATE SKIP LOCKED
          ),
          deleted AS (
            DELETE FROM property_tile_pyramid_tiles t
            USING target
            WHERE t.ctid = target.ctid
            RETURNING 1
          )
          SELECT count(*)::int AS affected FROM deleted
        `,
        });
        const deletedVersions = await runPropertyTilePyramidRetentionStep({
          sql: sql`
          WITH retained AS (
            SELECT current_version_id AS id FROM property_tile_pyramid_current
            UNION
            SELECT previous_version_id AS id
            FROM property_tile_pyramid_current
            WHERE previous_version_id IS NOT NULL
            UNION
            SELECT id
            FROM property_tile_pyramid_versions
            WHERE status IN ('queued', 'building', 'validating', 'validated')
          ),
          candidate_versions AS (
            SELECT v.id
            FROM property_tile_pyramid_versions v
            WHERE v.id NOT IN (SELECT id FROM retained)
              AND (
                (
                  v.status = 'promoted'
                  AND COALESCE(v.updated_at, v.promoted_at, v.created_at) < now() - interval '24 hours'
                )
                OR (
                  v.status IN ('failed_retryable', 'failed_terminal', 'superseded')
                  AND COALESCE(v.updated_at, v.build_finished_at, v.superseded_at, v.created_at) < now() - interval '24 hours'
                )
              )
              AND (v.lease_until IS NULL OR v.lease_until < now())
              AND NOT EXISTS (
                SELECT 1
                FROM property_tile_pyramid_current c
                WHERE c.current_version_id = v.id OR c.previous_version_id = v.id
              )
              AND NOT EXISTS (
                SELECT 1
                FROM property_tile_pyramid_audit a
                WHERE a.version_id = v.id
                  AND a.created_at > now() - interval '24 hours'
              )
            ORDER BY COALESCE(v.updated_at, v.promoted_at, v.created_at)
            LIMIT ${PROPERTY_TILE_PYRAMID_RETENTION_CHUNK_LIMIT}
            FOR UPDATE SKIP LOCKED
          ),
          deleted AS (
            DELETE FROM property_tile_pyramid_versions v
            USING candidate_versions
            WHERE v.id = candidate_versions.id
            RETURNING 1
          )
	          SELECT count(*)::int AS affected FROM deleted
	        `,
        });
        const deletedCandidateListingCandidates = await runPropertyTilePyramidRetentionStep({
          sql: sql`
	          WITH reclaimable_snapshots AS (
	            SELECT s.id
	            FROM property_tile_candidate_source_snapshots s
		            WHERE NOT EXISTS (
		              SELECT 1
		              FROM property_tile_candidate_source_current c
		              WHERE c.snapshot_id = s.id
		            )
		              AND (
		                (
	                  s.status IN ('ready', 'failed', 'superseded')
	                  AND COALESCE(s.updated_at, s.build_finished_at, s.created_at) < now() - interval '1 hour'
                    AND (
                      NOT EXISTS (
                        SELECT 1
                        FROM property_tile_pyramid_versions v
                        WHERE v.candidate_snapshot_id = s.id
                      )
                      OR (
                        EXISTS (
                          SELECT 1
                          FROM property_tile_pyramid_versions v
                          WHERE v.candidate_snapshot_id = s.id
                            AND v.status IN ('failed_retryable', 'failed_terminal', 'superseded')
                            AND COALESCE(v.updated_at, v.build_finished_at, v.superseded_at, v.created_at) < now() - interval '1 hour'
                            AND (v.lease_until IS NULL OR v.lease_until < now())
                        )
                        AND NOT EXISTS (
                          SELECT 1
                          FROM property_tile_pyramid_versions v
                          WHERE v.candidate_snapshot_id = s.id
                            AND v.status NOT IN ('failed_retryable', 'failed_terminal', 'superseded')
                        )
                      )
                    )
	                )
	                OR (
	                  s.status = 'building'
	                  AND COALESCE(s.updated_at, s.build_started_at, s.created_at) < now() - interval '7 days'
                    AND NOT EXISTS (
                      SELECT 1
                      FROM property_tile_pyramid_versions v
                      WHERE v.candidate_snapshot_id = s.id
                    )
	                )
	              )
	          ),
	          target AS (
	            SELECT c.ctid
	            FROM property_tile_listing_candidates c
	            WHERE c.snapshot_id IN (SELECT id FROM reclaimable_snapshots)
	            LIMIT ${PROPERTY_TILE_PYRAMID_RETENTION_CHUNK_LIMIT}
	            FOR UPDATE SKIP LOCKED
	          ),
	          deleted AS (
	            DELETE FROM property_tile_listing_candidates c
	            USING target
	            WHERE c.ctid = target.ctid
	            RETURNING 1
	          )
	          SELECT count(*)::int AS affected FROM deleted
	        `,
        });
        const deletedCandidateListingFacts = await runPropertyTilePyramidRetentionStep({
          sql: sql`
	          WITH reclaimable_snapshots AS (
	            SELECT s.id
	            FROM property_tile_candidate_source_snapshots s
		            WHERE NOT EXISTS (
		              SELECT 1
		              FROM property_tile_candidate_source_current c
		              WHERE c.snapshot_id = s.id
		            )
		              AND (
	                (
	                  s.status IN ('ready', 'failed', 'superseded')
	                  AND COALESCE(s.updated_at, s.build_finished_at, s.created_at) < now() - interval '1 hour'
                    AND (
                      NOT EXISTS (
                        SELECT 1
                        FROM property_tile_pyramid_versions v
                        WHERE v.candidate_snapshot_id = s.id
                      )
                      OR (
                        EXISTS (
                          SELECT 1
                          FROM property_tile_pyramid_versions v
                          WHERE v.candidate_snapshot_id = s.id
                            AND v.status IN ('failed_retryable', 'failed_terminal', 'superseded')
                            AND COALESCE(v.updated_at, v.build_finished_at, v.superseded_at, v.created_at) < now() - interval '1 hour'
                            AND (v.lease_until IS NULL OR v.lease_until < now())
                        )
                        AND NOT EXISTS (
                          SELECT 1
                          FROM property_tile_pyramid_versions v
                          WHERE v.candidate_snapshot_id = s.id
                            AND v.status NOT IN ('failed_retryable', 'failed_terminal', 'superseded')
                        )
                      )
                    )
	                )
	                OR (
	                  s.status = 'building'
	                  AND COALESCE(s.updated_at, s.build_started_at, s.created_at) < now() - interval '7 days'
                    AND NOT EXISTS (
                      SELECT 1
                      FROM property_tile_pyramid_versions v
                      WHERE v.candidate_snapshot_id = s.id
                    )
	                )
	              )
	          ),
	          target AS (
	            SELECT f.ctid
	            FROM property_tile_listing_facts f
	            WHERE f.snapshot_id IN (SELECT id FROM reclaimable_snapshots)
	            LIMIT ${PROPERTY_TILE_PYRAMID_RETENTION_CHUNK_LIMIT}
	            FOR UPDATE SKIP LOCKED
	          ),
	          deleted AS (
	            DELETE FROM property_tile_listing_facts f
	            USING target
	            WHERE f.ctid = target.ctid
	            RETURNING 1
	          )
	          SELECT count(*)::int AS affected FROM deleted
	        `,
        });
        const deletedCandidateSocialFacts = await runPropertyTilePyramidRetentionStep({
          sql: sql`
	          WITH reclaimable_snapshots AS (
	            SELECT s.id
	            FROM property_tile_candidate_source_snapshots s
		            WHERE NOT EXISTS (
		              SELECT 1
		              FROM property_tile_candidate_source_current c
		              WHERE c.snapshot_id = s.id
		            )
		              AND (
	                (
	                  s.status IN ('ready', 'failed', 'superseded')
	                  AND COALESCE(s.updated_at, s.build_finished_at, s.created_at) < now() - interval '1 hour'
                    AND (
                      NOT EXISTS (
                        SELECT 1
                        FROM property_tile_pyramid_versions v
                        WHERE v.candidate_snapshot_id = s.id
                      )
                      OR (
                        EXISTS (
                          SELECT 1
                          FROM property_tile_pyramid_versions v
                          WHERE v.candidate_snapshot_id = s.id
                            AND v.status IN ('failed_retryable', 'failed_terminal', 'superseded')
                            AND COALESCE(v.updated_at, v.build_finished_at, v.superseded_at, v.created_at) < now() - interval '1 hour'
                            AND (v.lease_until IS NULL OR v.lease_until < now())
                        )
                        AND NOT EXISTS (
                          SELECT 1
                          FROM property_tile_pyramid_versions v
                          WHERE v.candidate_snapshot_id = s.id
                            AND v.status NOT IN ('failed_retryable', 'failed_terminal', 'superseded')
                        )
                      )
                    )
	                )
	                OR (
	                  s.status = 'building'
	                  AND COALESCE(s.updated_at, s.build_started_at, s.created_at) < now() - interval '7 days'
                    AND NOT EXISTS (
                      SELECT 1
                      FROM property_tile_pyramid_versions v
                      WHERE v.candidate_snapshot_id = s.id
                    )
	                )
	              )
	          ),
	          target AS (
	            SELECT f.ctid
	            FROM property_tile_social_facts f
	            WHERE f.snapshot_id IN (SELECT id FROM reclaimable_snapshots)
	            LIMIT ${PROPERTY_TILE_PYRAMID_RETENTION_CHUNK_LIMIT}
	            FOR UPDATE SKIP LOCKED
	          ),
	          deleted AS (
	            DELETE FROM property_tile_social_facts f
	            USING target
	            WHERE f.ctid = target.ctid
	            RETURNING 1
	          )
	          SELECT count(*)::int AS affected FROM deleted
	        `,
        });
        const deletedCandidateGroupingFacts = await runPropertyTilePyramidRetentionStep({
          sql: sql`
	          WITH reclaimable_snapshots AS (
	            SELECT s.id
	            FROM property_tile_candidate_source_snapshots s
		            WHERE NOT EXISTS (
		              SELECT 1
		              FROM property_tile_candidate_source_current c
		              WHERE c.snapshot_id = s.id
		            )
		              AND (
	                (
	                  s.status IN ('ready', 'failed', 'superseded')
	                  AND COALESCE(s.updated_at, s.build_finished_at, s.created_at) < now() - interval '1 hour'
                    AND (
                      NOT EXISTS (
                        SELECT 1
                        FROM property_tile_pyramid_versions v
                        WHERE v.candidate_snapshot_id = s.id
                      )
                      OR (
                        EXISTS (
                          SELECT 1
                          FROM property_tile_pyramid_versions v
                          WHERE v.candidate_snapshot_id = s.id
                            AND v.status IN ('failed_retryable', 'failed_terminal', 'superseded')
                            AND COALESCE(v.updated_at, v.build_finished_at, v.superseded_at, v.created_at) < now() - interval '1 hour'
                            AND (v.lease_until IS NULL OR v.lease_until < now())
                        )
                        AND NOT EXISTS (
                          SELECT 1
                          FROM property_tile_pyramid_versions v
                          WHERE v.candidate_snapshot_id = s.id
                            AND v.status NOT IN ('failed_retryable', 'failed_terminal', 'superseded')
                        )
                      )
                    )
	                )
	                OR (
	                  s.status = 'building'
	                  AND COALESCE(s.updated_at, s.build_started_at, s.created_at) < now() - interval '7 days'
                    AND NOT EXISTS (
                      SELECT 1
                      FROM property_tile_pyramid_versions v
                      WHERE v.candidate_snapshot_id = s.id
                    )
	                )
	              )
	          ),
	          target AS (
	            SELECT f.ctid
	            FROM property_tile_grouping_facts f
	            WHERE f.snapshot_id IN (SELECT id FROM reclaimable_snapshots)
	            LIMIT ${PROPERTY_TILE_PYRAMID_RETENTION_CHUNK_LIMIT}
	            FOR UPDATE SKIP LOCKED
	          ),
	          deleted AS (
	            DELETE FROM property_tile_grouping_facts f
	            USING target
	            WHERE f.ctid = target.ctid
	            RETURNING 1
	          )
	          SELECT count(*)::int AS affected FROM deleted
	        `,
        });
        const deletedCandidateSourceSnapshots = await runPropertyTilePyramidRetentionStep({
          sql: sql`
	          WITH reclaimable_snapshots AS (
	            SELECT s.id
	            FROM property_tile_candidate_source_snapshots s
	            WHERE NOT EXISTS (
	              SELECT 1
	              FROM property_tile_candidate_source_current c
	              WHERE c.snapshot_id = s.id
	            )
	              AND NOT EXISTS (
	                SELECT 1
	                FROM property_tile_pyramid_versions v
	                WHERE v.candidate_snapshot_id = s.id
	              )
	              AND NOT EXISTS (
	                SELECT 1
	                FROM property_tile_listing_candidates lpc
	                WHERE lpc.snapshot_id = s.id
	              )
	              AND NOT EXISTS (
	                SELECT 1
	                FROM property_tile_listing_facts ptlf
	                WHERE ptlf.snapshot_id = s.id
	              )
	              AND NOT EXISTS (
	                SELECT 1
	                FROM property_tile_social_facts ptsf
	                WHERE ptsf.snapshot_id = s.id
	              )
	              AND NOT EXISTS (
	                SELECT 1
	                FROM property_tile_grouping_facts pgf
	                WHERE pgf.snapshot_id = s.id
	              )
	              AND (
	                (
	                  s.status IN ('ready', 'failed', 'superseded')
	                  AND COALESCE(s.updated_at, s.build_finished_at, s.created_at) < now() - interval '1 hour'
	                )
	                OR (
	                  s.status = 'building'
	                  AND COALESCE(s.updated_at, s.build_started_at, s.created_at) < now() - interval '7 days'
	                )
	              )
	            ORDER BY COALESCE(s.updated_at, s.build_finished_at, s.build_started_at, s.created_at)
	            LIMIT ${PROPERTY_TILE_PYRAMID_RETENTION_CHUNK_LIMIT}
	            FOR UPDATE SKIP LOCKED
	          ),
	          deleted AS (
	            DELETE FROM property_tile_candidate_source_snapshots s
	            USING reclaimable_snapshots
	            WHERE s.id = reclaimable_snapshots.id
	            RETURNING 1
	          )
	          SELECT count(*)::int AS affected FROM deleted
	        `,
        });
        const stepResults = {
          resetPayloads,
          deletedMembers,
          deletedNodes,
          deletedTiles,
          deletedVersions,
          deletedCandidateListingCandidates,
          deletedCandidateListingFacts,
          deletedCandidateSocialFacts,
          deletedCandidateGroupingFacts,
          deletedCandidateSourceSnapshots,
        };
        const hasMore = Object.values(stepResults).some((result) => result.hasMore);
        return {
          status: hasMore ? 'draining' : 'completed',
          hasMore,
          resetPayloads: resetPayloads.affected,
          deletedMembers: deletedMembers.affected,
          deletedNodes: deletedNodes.affected,
          deletedTiles: deletedTiles.affected,
          deletedVersions: deletedVersions.affected,
          deletedCandidateListingCandidates: deletedCandidateListingCandidates.affected,
          deletedCandidateListingFacts: deletedCandidateListingFacts.affected,
          deletedCandidateSocialFacts: deletedCandidateSocialFacts.affected,
          deletedCandidateGroupingFacts: deletedCandidateGroupingFacts.affected,
          deletedCandidateSourceSnapshots: deletedCandidateSourceSnapshots.affected,
          chunks: Object.fromEntries(
            Object.entries(stepResults).map(([key, result]) => [key, result.chunks])
          ),
        };
      },
      () => ({
        status: 'skipped',
        reason: 'retention-lock-held',
        hasMore: true,
        resetPayloads: 0,
        deletedMembers: 0,
        deletedNodes: 0,
        deletedTiles: 0,
        deletedVersions: 0,
        deletedCandidateListingCandidates: 0,
        deletedCandidateListingFacts: 0,
        deletedCandidateSocialFacts: 0,
        deletedCandidateGroupingFacts: 0,
        deletedCandidateSourceSnapshots: 0,
        chunks: {
          resetPayloads: 0,
          deletedMembers: 0,
          deletedNodes: 0,
          deletedTiles: 0,
          deletedVersions: 0,
          deletedCandidateListingCandidates: 0,
          deletedCandidateListingFacts: 0,
          deletedCandidateSocialFacts: 0,
          deletedCandidateGroupingFacts: 0,
          deletedCandidateSourceSnapshots: 0,
        },
      })
    );
  } catch (error) {
    if (isMissingPyramidSchemaError(error)) {
      return { status: 'skipped', reason: 'pyramid-schema-unavailable' };
    }
    throw error;
  }
}

async function runOptionalPropertyTilePyramidRetentionStep(input: {
  relationName: string;
  sql: SQL;
}): Promise<{ affected: number; chunks: number; hasMore: boolean }> {
  if (!(await hasPropertyTilePyramidRelation(input.relationName))) {
    return { affected: 0, chunks: 0, hasMore: false };
  }
  return runPropertyTilePyramidRetentionStep({ sql: input.sql });
}

async function hasPropertyTilePyramidRelation(relationName: string): Promise<boolean> {
  const rows = await db.execute<{ relation_name: string | null }>(sql`
    SELECT to_regclass(${`public.${relationName}`})::text AS relation_name
  `);
  return Array.from(rows)[0]?.relation_name != null;
}

async function runPropertyTilePyramidRetentionStep(input: {
  sql: SQL;
  optional?: boolean;
}): Promise<{ affected: number; chunks: number; hasMore: boolean }> {
  const maxChunks = getPropertyTilePyramidRetentionMaxChunksPerStep();
  let affected = 0;
  let chunks = 0;

  for (; chunks < maxChunks; chunks += 1) {
    const chunkAffected = await runPropertyTilePyramidRetentionChunk(input);
    affected += chunkAffected;
    if (chunkAffected < PROPERTY_TILE_PYRAMID_RETENTION_CHUNK_LIMIT) {
      return { affected, chunks: chunks + 1, hasMore: false };
    }
  }

  return { affected, chunks, hasMore: true };
}

async function runPropertyTilePyramidRetentionChunk(input: {
  sql: SQL;
  optional?: boolean;
}): Promise<number> {
  try {
    const rows = await db.execute<{ affected: number | string }>(input.sql);
    return Number(Array.from(rows)[0]?.affected ?? 0);
  } catch (error) {
    if (input.optional && isMissingPyramidSchemaError(error)) {
      return 0;
    }
    throw error;
  }
}
