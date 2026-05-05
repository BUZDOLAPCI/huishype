import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import {
  COUNTRY_CONFIGS,
  PROPERTY_GHOST_REVEAL_ZOOM,
  PROPERTY_MAP_FOOTPRINTS,
  PROPERTY_PREVIEW_MEMBER_LIMIT,
  getAllCountryCodes,
  getAllListingSourceNames,
} from '@huishype/shared/config';
import {
  db,
  propertyTileSnapshotCoverage,
  propertyTileSnapshotRefreshState,
  propertyTileSnapshots,
  propertyTileSnapshotWatermarks,
  type DbTransaction,
} from '../db/index.js';
import { buildPropertyTileEtag } from './property-tile-cache.js';
import { buildMvtForTile, PROPERTY_TILE_EXTENT } from './property-grouping.js';
import { createDefaultMapFilters, getMapFilterSignature, type MapFilters } from './map-filters.js';
import {
  enqueuePropertyTileSnapshotRefresh,
  type PropertyTileSnapshotRefreshEnqueueResult,
} from './ingest/queue.js';
import { ACTIVE_SOCIAL_SCORE_THRESHOLD } from './property-queries.js';

export const PROPERTY_TILE_SNAPSHOT_KEY = 'public_default_low_zoom';
export const PROPERTY_TILE_SNAPSHOT_REFRESH_JOB_REASON = 'snapshot-refresh';
export const DEFAULT_PROPERTY_TILE_SNAPSHOT_COVERAGE_ID = 'public_default_low_zoom_v1';
export const PROPERTY_TILE_SNAPSHOT_PIPELINE_VERSION = 1;

const DEFAULT_MAX_ZOOM = 10;
const DEFAULT_MAX_TILES_PER_RUN = 1_000;
const DEFAULT_MAX_SECONDS_PER_RUN = 60;
const DEFAULT_PRECOMPUTE_CONCURRENCY = 1;
const MAX_PRECOMPUTE_CONCURRENCY = 16;
const DEFAULT_LEASE_SECONDS = 15 * 60;
const MIN_LEASE_RENEWAL_INTERVAL_MS = 1_000;
const DEFAULT_ROLLING_MAX_AGE_SECONDS = 60 * 60;
const DEFAULT_PROPERTY_VIEW_REFRESH_THROTTLE_MS = 5 * 60_000;
const SNAPSHOT_SOCIAL_RECENT_WINDOW_DAYS = 7;
const DENSE_PREWARM_MIN_ZOOM = 8;
const DENSE_PREWARM_MAX_ZOOM = 9;
const DENSE_PREWARM_FOLLOWUP_ZOOM = 10;
const DENSE_PREWARM_SAMPLE_STRIDE_BY_ZOOM = new Map<number, number>([
  [8, 4],
  [9, 8],
  [10, 16],
]);
const DENSE_PREWARM_CITY_CENTERS = [
  { lon: 4.9041, lat: 52.3676 }, // Amsterdam
  { lon: 5.1214, lat: 52.0907 }, // Utrecht
  { lon: 4.4777, lat: 51.9244 }, // Rotterdam
];

type SnapshotDb = typeof db | DbTransaction;
type SnapshotWatermarks = {
  listingWatermark: bigint;
  socialWatermark: bigint;
  propertyWatermark: bigint;
  coverageWatermark: bigint;
};

export type PropertyTileSnapshotWatermarkDimension =
  | 'listing'
  | 'social'
  | 'property'
  | 'coverage';

export interface PropertyTileSnapshotCoverageDefinition {
  coverageId: string;
  boundsSource: string;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  countries: string[];
  dataSources: string[];
  maxZoom: number;
  filterSignature: string;
  coverageWatermark: bigint;
  snapshotConfigHash: string;
  updatedAt: Date;
}

export interface PropertyTileCoordinate {
  z: number;
  x: number;
  y: number;
}

export interface CurrentPropertyTileSnapshot {
  z: number;
  x: number;
  y: number;
  filterSignature: string;
  coverageId: string;
  payload: Buffer | null;
  statusCode: 200 | 204;
  etag: string;
  generatedAt: Date;
  snapshotConfigHash: string;
}

export interface PropertyTileSnapshotRefreshResult {
  status: 'completed' | 'quota_exhausted' | 'failed' | 'skipped_locked' | 'skipped_current';
  reason: string;
  expectedTileCount?: number;
  refreshedTileCount?: number;
  failedTileCount?: number;
  skippedTileCount?: number;
  staleWriteSkippedTileCount?: number;
  durationMs?: number;
}

export interface PropertyTileSnapshotRefreshCheck {
  shouldEnqueue: boolean;
  reason: string;
}

export type PropertyTileSnapshotRefreshRequestResult = {
  enqueued: boolean;
  throttled: boolean;
  enqueueStatus: 'enqueued' | 'retried' | 'coalesced' | 'skipped';
  skippedReason?: 'throttled' | 'disabled';
  queueJobId?: string;
  queueJobState?: string | null;
};

export function buildPropertyTileSnapshotRefreshRequestResult(input: {
  throttled?: boolean;
  enqueueDisabled?: boolean;
  enqueueResult?: PropertyTileSnapshotRefreshEnqueueResult;
}): PropertyTileSnapshotRefreshRequestResult {
  if (input.throttled || input.enqueueDisabled) {
    return {
      enqueued: false,
      throttled: input.throttled === true,
      enqueueStatus: 'skipped',
      skippedReason: input.throttled ? 'throttled' : 'disabled',
    };
  }

  if (!input.enqueueResult) {
    throw new Error('Property tile snapshot enqueue result is required when request is not skipped');
  }

  const enqueueResult = input.enqueueResult;
  const result: PropertyTileSnapshotRefreshRequestResult = {
    enqueued: enqueueResult.status === 'enqueued' || enqueueResult.status === 'retried',
    throttled: false,
    enqueueStatus: enqueueResult.status,
    queueJobId: enqueueResult.jobId,
  };
  if (enqueueResult.status === 'coalesced') {
    result.queueJobState = enqueueResult.existingState;
  } else if (enqueueResult.status === 'retried') {
    result.queueJobState = enqueueResult.previousState;
  }
  return result;
}

export type PropertyTileSnapshotBuilder = (
  tile: PropertyTileCoordinate,
  filters?: MapFilters,
  options?: { statementTimeoutMs?: number; runtimeBudgetMs?: number },
) => Promise<Buffer>;

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getPropertyTilePrecomputeMaxZoom(): number {
  return Math.min(22, parseNonNegativeIntegerEnv('PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM', DEFAULT_MAX_ZOOM));
}

export function getPropertyTilePrecomputeMaxTilesPerRun(): number {
  return parsePositiveIntegerEnv(
    'PROPERTY_TILE_PRECOMPUTE_MAX_TILES_PER_RUN',
    DEFAULT_MAX_TILES_PER_RUN,
  );
}

export function getPropertyTilePrecomputeMaxSecondsPerRun(): number {
  return parsePositiveIntegerEnv(
    'PROPERTY_TILE_PRECOMPUTE_MAX_SECONDS_PER_RUN',
    DEFAULT_MAX_SECONDS_PER_RUN,
  );
}

export function getPropertyTilePrecomputeConcurrency(): number {
  return Math.min(
    MAX_PRECOMPUTE_CONCURRENCY,
    parsePositiveIntegerEnv(
      'PROPERTY_TILE_PRECOMPUTE_CONCURRENCY',
      DEFAULT_PRECOMPUTE_CONCURRENCY,
    ),
  );
}

export function getPropertyTileSnapshotLeaseSeconds(): number {
  return parsePositiveIntegerEnv(
    'PROPERTY_TILE_SNAPSHOT_LEASE_SECONDS',
    DEFAULT_LEASE_SECONDS,
  );
}

export function getPropertyTileSnapshotRollingMaxAgeSeconds(): number {
  return parsePositiveIntegerEnv(
    'PROPERTY_TILE_SNAPSHOT_ROLLING_MAX_AGE_SECONDS',
    DEFAULT_ROLLING_MAX_AGE_SECONDS,
  );
}

export function getPropertyViewSnapshotRefreshThrottleMs(): number {
  return parsePositiveIntegerEnv(
    'PROPERTY_TILE_VIEW_REFRESH_THROTTLE_MS',
    DEFAULT_PROPERTY_VIEW_REFRESH_THROTTLE_MS,
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

export function computePropertyTileSnapshotConfigHash(input: {
  coverageId?: string;
  boundsSource?: string;
  maxZoom: number;
  filterSignature: string;
  bounds: {
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
  };
  countries: readonly string[];
  dataSources: readonly string[];
  propertyTilePipelineVersion?: number;
}): string {
  const socialScoringConfig = {
    activeSocialScoreThreshold: ACTIVE_SOCIAL_SCORE_THRESHOLD,
    weights: {
      topLevelComment: 1,
      reply: 1,
      propertyLike: 1,
      commentLike: 0.8,
      guess: 0.85,
      uniqueViewer: 0.1,
    },
    rollingWindows: {
      comments: `${SNAPSHOT_SOCIAL_RECENT_WINDOW_DAYS} days`,
      replies: `${SNAPSHOT_SOCIAL_RECENT_WINDOW_DAYS} days`,
      propertyLikes: `${SNAPSHOT_SOCIAL_RECENT_WINDOW_DAYS} days`,
      commentLikes: `${SNAPSHOT_SOCIAL_RECENT_WINDOW_DAYS} days`,
      guesses: `${SNAPSHOT_SOCIAL_RECENT_WINDOW_DAYS} days`,
      propertyViews: `${SNAPSHOT_SOCIAL_RECENT_WINDOW_DAYS} days`,
    },
  };
  const groupingConstants = {
    propertyTileExtent: PROPERTY_TILE_EXTENT,
    activeSocialScoreThreshold: ACTIVE_SOCIAL_SCORE_THRESHOLD,
    socialScoringConfig,
    propertyMapFootprints: PROPERTY_MAP_FOOTPRINTS,
    propertyGhostRevealZoom: PROPERTY_GHOST_REVEAL_ZOOM,
    propertyPreviewMemberLimit: PROPERTY_PREVIEW_MEMBER_LIMIT,
  };

  return createHash('sha256')
    .update(stableJson({
      coverageId: input.coverageId ?? DEFAULT_PROPERTY_TILE_SNAPSHOT_COVERAGE_ID,
      boundsSource: input.boundsSource ?? 'env:europe-default',
      maxZoom: input.maxZoom,
      filterSignature: input.filterSignature,
      bounds: input.bounds,
      countries: [...input.countries].sort(),
      dataSources: [...input.dataSources].sort(),
      propertyTilePipelineVersion:
        input.propertyTilePipelineVersion ?? PROPERTY_TILE_SNAPSHOT_PIPELINE_VERSION,
      groupingConstants,
    }))
    .digest('hex');
}

function buildDefaultCoverageDefinition(): Omit<PropertyTileSnapshotCoverageDefinition, 'coverageWatermark' | 'updatedAt'> {
  const filterSignature = getMapFilterSignature(createDefaultMapFilters());
  const maxZoom = getPropertyTilePrecomputeMaxZoom();
  const bounds = {
    minLon: Number.parseFloat(process.env.PROPERTY_TILE_PRECOMPUTE_MIN_LON ?? '-11.5'),
    minLat: Number.parseFloat(process.env.PROPERTY_TILE_PRECOMPUTE_MIN_LAT ?? '34.5'),
    maxLon: Number.parseFloat(process.env.PROPERTY_TILE_PRECOMPUTE_MAX_LON ?? '32.5'),
    maxLat: Number.parseFloat(process.env.PROPERTY_TILE_PRECOMPUTE_MAX_LAT ?? '71.5'),
  };
  const countries = getAllCountryCodes().filter((code) => code in COUNTRY_CONFIGS).sort();
  const dataSources = getAllListingSourceNames().sort();

  if (!(bounds.minLon < bounds.maxLon && bounds.minLat < bounds.maxLat)) {
    throw new Error('Invalid PROPERTY_TILE_PRECOMPUTE_* bounds');
  }

  return {
    coverageId: DEFAULT_PROPERTY_TILE_SNAPSHOT_COVERAGE_ID,
    boundsSource: 'env:europe-default',
    ...bounds,
    countries,
    dataSources,
    maxZoom,
    filterSignature,
    snapshotConfigHash: computePropertyTileSnapshotConfigHash({
      coverageId: DEFAULT_PROPERTY_TILE_SNAPSHOT_COVERAGE_ID,
      boundsSource: 'env:europe-default',
      maxZoom,
      filterSignature,
      bounds,
      countries,
      dataSources,
    }),
  };
}

export function getExpectedDefaultPropertyTileSnapshotCoverageDefinition(): Omit<
  PropertyTileSnapshotCoverageDefinition,
  'coverageWatermark' | 'updatedAt'
> {
  return buildDefaultCoverageDefinition();
}

function targetDb(executor?: SnapshotDb): SnapshotDb {
  return executor ?? db;
}

export async function ensureDefaultPropertyTileSnapshotCoverage(
  executor?: SnapshotDb,
): Promise<PropertyTileSnapshotCoverageDefinition> {
  const database = targetDb(executor);
  const definition = buildDefaultCoverageDefinition();
  const previous = await database
    .select({
      snapshotConfigHash: propertyTileSnapshotCoverage.snapshotConfigHash,
    })
    .from(propertyTileSnapshotCoverage)
    .where(eq(propertyTileSnapshotCoverage.coverageId, definition.coverageId))
    .limit(1);
  const configChanged =
    previous.length > 0 && previous[0]?.snapshotConfigHash !== definition.snapshotConfigHash;
  const rows = await database
    .insert(propertyTileSnapshotCoverage)
    .values({
      coverageId: definition.coverageId,
      boundsSource: definition.boundsSource,
      minLon: definition.minLon,
      minLat: definition.minLat,
      maxLon: definition.maxLon,
      maxLat: definition.maxLat,
      countries: definition.countries,
      dataSources: definition.dataSources,
      maxZoom: definition.maxZoom,
      filterSignature: definition.filterSignature,
      snapshotConfigHash: definition.snapshotConfigHash,
    })
    .onConflictDoUpdate({
      target: propertyTileSnapshotCoverage.coverageId,
      set: {
        boundsSource: definition.boundsSource,
        minLon: definition.minLon,
        minLat: definition.minLat,
        maxLon: definition.maxLon,
        maxLat: definition.maxLat,
        countries: definition.countries,
        dataSources: definition.dataSources,
        maxZoom: definition.maxZoom,
        filterSignature: definition.filterSignature,
        snapshotConfigHash: definition.snapshotConfigHash,
        coverageWatermark: sql<bigint>`
          CASE
            WHEN property_tile_snapshot_coverage.snapshot_config_hash <> ${definition.snapshotConfigHash}
              THEN property_tile_snapshot_coverage.coverage_watermark + 1
            ELSE property_tile_snapshot_coverage.coverage_watermark
          END
        `,
        updatedAt: new Date(),
      },
    })
    .returning();

  const coverage = rows[0];
  if (!coverage) {
    throw new Error('Default property tile snapshot coverage could not be persisted');
  }

  if (configChanged) {
    await advancePropertyTileSnapshotWatermark(['coverage'], database);
  }

  return coverage;
}

export async function getDefaultPropertyTileSnapshotCoverage(): Promise<PropertyTileSnapshotCoverageDefinition> {
  return ensureDefaultPropertyTileSnapshotCoverage();
}

function lonToTileX(lon: number, zoom: number): number {
  const n = 2 ** zoom;
  return Math.floor(((lon + 180) / 360) * n);
}

function latToTileY(lat: number, zoom: number): number {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clampedLat * Math.PI) / 180;
  const n = 2 ** zoom;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
}

function clampTileCoordinate(value: number, zoom: number): number {
  const max = 2 ** zoom - 1;
  return Math.max(0, Math.min(max, value));
}

type TileRange = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

function computeCoverageTileRange(
  coverage: Pick<PropertyTileSnapshotCoverageDefinition, 'minLon' | 'minLat' | 'maxLon' | 'maxLat'>,
  zoom: number,
): TileRange {
  return {
    minX: clampTileCoordinate(lonToTileX(coverage.minLon, zoom), zoom),
    maxX: clampTileCoordinate(lonToTileX(coverage.maxLon, zoom), zoom),
    minY: clampTileCoordinate(latToTileY(coverage.maxLat, zoom), zoom),
    maxY: clampTileCoordinate(latToTileY(coverage.minLat, zoom), zoom),
  };
}

function buildCoverageTileRanges(
  coverage: Pick<PropertyTileSnapshotCoverageDefinition, 'minLon' | 'minLat' | 'maxLon' | 'maxLat' | 'maxZoom'>,
): Map<number, TileRange> {
  const ranges = new Map<number, TileRange>();
  for (let z = 0; z <= coverage.maxZoom; z += 1) {
    ranges.set(z, computeCoverageTileRange(coverage, z));
  }
  return ranges;
}

function compareCanonicalTileCoordinates(
  a: PropertyTileCoordinate,
  b: PropertyTileCoordinate,
): number {
  return a.z - b.z || a.x - b.x || a.y - b.y;
}

function isCoverageLocalSampleTile(
  tile: PropertyTileCoordinate,
  rangesByZoom: ReadonlyMap<number, TileRange>,
): boolean {
  const stride = DENSE_PREWARM_SAMPLE_STRIDE_BY_ZOOM.get(tile.z);
  if (!stride) {
    return false;
  }

  const range = rangesByZoom.get(tile.z);
  if (!range) {
    return false;
  }

  return (tile.x - range.minX) % stride === 0 && (tile.y - range.minY) % stride === 0;
}

function isTileInRange(tile: PropertyTileCoordinate, range: TileRange): boolean {
  return tile.x >= range.minX && tile.x <= range.maxX && tile.y >= range.minY && tile.y <= range.maxY;
}

function isDensePrewarmCityTile(
  tile: PropertyTileCoordinate,
  rangesByZoom: ReadonlyMap<number, TileRange>,
): boolean {
  if (tile.z < DENSE_PREWARM_MIN_ZOOM || tile.z > DENSE_PREWARM_FOLLOWUP_ZOOM) {
    return false;
  }

  const range = rangesByZoom.get(tile.z);
  if (!range || !isTileInRange(tile, range)) {
    return false;
  }

  return DENSE_PREWARM_CITY_CENTERS.some((city) => (
    lonToTileX(city.lon, tile.z) === tile.x && latToTileY(city.lat, tile.z) === tile.y
  ));
}

function getPropertyTileSnapshotCoordinatePriorityBand(
  tile: PropertyTileCoordinate,
  rangesByZoom: ReadonlyMap<number, TileRange>,
): number {
  if (tile.z < DENSE_PREWARM_MIN_ZOOM) {
    return 0;
  }

  if (
    tile.z >= DENSE_PREWARM_MIN_ZOOM &&
    tile.z <= DENSE_PREWARM_MAX_ZOOM &&
    (isDensePrewarmCityTile(tile, rangesByZoom) || isCoverageLocalSampleTile(tile, rangesByZoom))
  ) {
    return 1;
  }

  if (
    tile.z === DENSE_PREWARM_FOLLOWUP_ZOOM &&
    (isDensePrewarmCityTile(tile, rangesByZoom) || isCoverageLocalSampleTile(tile, rangesByZoom))
  ) {
    return 2;
  }

  if (tile.z >= DENSE_PREWARM_MIN_ZOOM && tile.z <= DENSE_PREWARM_MAX_ZOOM) {
    return 3;
  }

  return 4;
}

function comparePropertyTileSnapshotCoordinatePriority(
  a: PropertyTileCoordinate,
  b: PropertyTileCoordinate,
  rangesByZoom: ReadonlyMap<number, TileRange>,
): number {
  return getPropertyTileSnapshotCoordinatePriorityBand(a, rangesByZoom) -
    getPropertyTileSnapshotCoordinatePriorityBand(b, rangesByZoom);
}

export function computePropertyTileSnapshotCoordinatesFromCoverage(
  coverage: Pick<PropertyTileSnapshotCoverageDefinition, 'minLon' | 'minLat' | 'maxLon' | 'maxLat' | 'maxZoom'>,
): PropertyTileCoordinate[] {
  if (!(coverage.minLon < coverage.maxLon && coverage.minLat < coverage.maxLat)) {
    throw new Error('Cannot compute property tile snapshot coordinates from invalid coverage bounds');
  }

  const coordinates: PropertyTileCoordinate[] = [];
  const rangesByZoom = buildCoverageTileRanges(coverage);
  for (let z = 0; z <= coverage.maxZoom; z += 1) {
    const range = rangesByZoom.get(z);
    if (!range) {
      continue;
    }

    for (let x = range.minX; x <= range.maxX; x += 1) {
      for (let y = range.minY; y <= range.maxY; y += 1) {
        coordinates.push({ z, x, y });
      }
    }
  }

  return coordinates.sort((a, b) =>
    comparePropertyTileSnapshotCoordinatePriority(a, b, rangesByZoom) ||
      compareCanonicalTileCoordinates(a, b),
  );
}

export async function getPropertyTileSnapshotCoordinates(
  coverageId = DEFAULT_PROPERTY_TILE_SNAPSHOT_COVERAGE_ID,
): Promise<PropertyTileCoordinate[]> {
  const coverage = coverageId === DEFAULT_PROPERTY_TILE_SNAPSHOT_COVERAGE_ID
    ? await getDefaultPropertyTileSnapshotCoverage()
    : (await db
        .select()
        .from(propertyTileSnapshotCoverage)
        .where(eq(propertyTileSnapshotCoverage.coverageId, coverageId))
        .limit(1))[0];

  if (!coverage) {
    throw new Error(`Property tile snapshot coverage ${coverageId} is not persisted`);
  }

  return computePropertyTileSnapshotCoordinatesFromCoverage(coverage);
}

export async function lookupCurrentPropertyTileSnapshot(input: {
  z: number;
  x: number;
  y: number;
  filterSignature: string;
}): Promise<CurrentPropertyTileSnapshot | null> {
  const expectedCoverage = getExpectedDefaultPropertyTileSnapshotCoverageDefinition();
  if (
    input.filterSignature !== expectedCoverage.filterSignature ||
    input.z > expectedCoverage.maxZoom
  ) {
    return null;
  }

  const coverageRows = await db
    .select()
    .from(propertyTileSnapshotCoverage)
    .where(
      and(
        eq(propertyTileSnapshotCoverage.coverageId, expectedCoverage.coverageId),
        eq(propertyTileSnapshotCoverage.filterSignature, expectedCoverage.filterSignature),
        eq(propertyTileSnapshotCoverage.snapshotConfigHash, expectedCoverage.snapshotConfigHash),
      ),
    )
    .limit(1);
  const coverage = coverageRows[0];
  if (!coverage) {
    return null;
  }

  const rows = await db
    .select()
    .from(propertyTileSnapshots)
    .where(
      and(
        eq(propertyTileSnapshots.z, input.z),
        eq(propertyTileSnapshots.x, input.x),
        eq(propertyTileSnapshots.y, input.y),
        eq(propertyTileSnapshots.filterSignature, input.filterSignature),
        eq(propertyTileSnapshots.coverageId, coverage.coverageId),
        eq(propertyTileSnapshots.snapshotConfigHash, coverage.snapshotConfigHash),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || (row.statusCode !== 200 && row.statusCode !== 204)) {
    return null;
  }

  if (row.statusCode === 200 && (!row.payload || row.payload.byteLength === 0)) {
    return null;
  }

  if (row.statusCode === 204 && row.payload) {
    return null;
  }

  return {
    z: row.z,
    x: row.x,
    y: row.y,
    filterSignature: row.filterSignature,
    coverageId: row.coverageId,
    payload: row.payload,
    statusCode: row.statusCode,
    etag: row.etag,
    generatedAt: row.generatedAt,
    snapshotConfigHash: row.snapshotConfigHash,
  };
}

type SnapshotRefreshLogger = {
  warn: (bindings: Record<string, unknown>, message: string) => void;
};

export async function safeRequestPropertyTileSnapshotRefresh(
  input: Parameters<typeof requestPropertyTileSnapshotRefresh>[0],
  logger: SnapshotRefreshLogger,
  context: Record<string, unknown> = {},
  requestRefresh: typeof requestPropertyTileSnapshotRefresh = requestPropertyTileSnapshotRefresh,
): Promise<PropertyTileSnapshotRefreshRequestResult | null> {
  try {
    return await requestRefresh(input);
  } catch (error) {
    logger.warn(
      {
        err: error,
        reason: input.reason,
        ...context,
      },
      'Failed to request property tile snapshot refresh after commit',
    );
    return null;
  }
}

async function readSnapshotWatermarks(executor?: SnapshotDb) {
  const database = targetDb(executor);
  const rows = await database
    .insert(propertyTileSnapshotWatermarks)
    .values({ key: PROPERTY_TILE_SNAPSHOT_KEY })
    .onConflictDoNothing()
    .returning();

  if (rows[0]) {
    return rows[0];
  }

  const selected = await database
    .select()
    .from(propertyTileSnapshotWatermarks)
    .where(eq(propertyTileSnapshotWatermarks.key, PROPERTY_TILE_SNAPSHOT_KEY))
    .limit(1);

  const row = selected[0];
  if (!row) {
    throw new Error('Property tile snapshot watermark row is unavailable');
  }
  return row;
}

export async function advancePropertyTileSnapshotWatermark(
  dimensions: readonly PropertyTileSnapshotWatermarkDimension[],
  executor?: SnapshotDb,
): Promise<void> {
  const unique = new Set(dimensions);
  if (unique.size === 0) {
    return;
  }

  const listingIncrement = unique.has('listing') ? 1n : 0n;
  const socialIncrement = unique.has('social') ? 1n : 0n;
  const propertyIncrement = unique.has('property') ? 1n : 0n;
  const coverageIncrement = unique.has('coverage') ? 1n : 0n;
  const database = targetDb(executor);

  await database.execute(sql`
    INSERT INTO property_tile_snapshot_watermarks (
      key,
      listing_watermark,
      social_watermark,
      property_watermark,
      coverage_watermark,
      updated_at
    )
    VALUES (
      ${PROPERTY_TILE_SNAPSHOT_KEY},
      ${listingIncrement},
      ${socialIncrement},
      ${propertyIncrement},
      ${coverageIncrement},
      now()
    )
    ON CONFLICT (key) DO UPDATE SET
      listing_watermark = property_tile_snapshot_watermarks.listing_watermark + EXCLUDED.listing_watermark,
      social_watermark = property_tile_snapshot_watermarks.social_watermark + EXCLUDED.social_watermark,
      property_watermark = property_tile_snapshot_watermarks.property_watermark + EXCLUDED.property_watermark,
      coverage_watermark = property_tile_snapshot_watermarks.coverage_watermark + EXCLUDED.coverage_watermark,
      updated_at = now()
  `);
}

export function isSnapshotRefreshRequestThrottled(input: {
  requestedAt: Date | null | undefined;
  lastError: string | null | undefined;
  now: Date;
  throttleMs?: number;
}): boolean {
  return (
    input.throttleMs != null &&
    input.requestedAt != null &&
    input.lastError == null &&
    input.now.getTime() - input.requestedAt.getTime() < input.throttleMs
  );
}

export function isPropertyViewSnapshotRecoveryThrottled(input: {
  requestReason: string | null | undefined;
  requestedAt: Date | null | undefined;
  lastError: string | null | undefined;
  now: Date;
  throttleMs?: number;
}): boolean {
  return (
    input.requestReason === 'property-view' &&
    isSnapshotRefreshRequestThrottled(input)
  );
}

export async function requestPropertyTileSnapshotRefresh(input: {
  reason: string;
  throttleMs?: number;
  enqueue?: boolean;
}): Promise<PropertyTileSnapshotRefreshRequestResult> {
  const previousRows = await db
    .select({
      requestedAt: propertyTileSnapshotRefreshState.requestedAt,
      lastError: propertyTileSnapshotRefreshState.lastError,
    })
    .from(propertyTileSnapshotRefreshState)
    .where(eq(propertyTileSnapshotRefreshState.key, PROPERTY_TILE_SNAPSHOT_KEY))
    .limit(1);
  const previous = previousRows[0] ?? null;
  const now = new Date();
  const throttled = isSnapshotRefreshRequestThrottled({
    requestedAt: previous?.requestedAt,
    lastError: previous?.lastError,
    now,
    throttleMs: input.throttleMs,
  });

  if (throttled || input.enqueue === false) {
    return buildPropertyTileSnapshotRefreshRequestResult({
      throttled,
      enqueueDisabled: input.enqueue === false,
    });
  }

  const watermarks = await readSnapshotWatermarks();

  await db
    .insert(propertyTileSnapshotRefreshState)
    .values({
      key: PROPERTY_TILE_SNAPSHOT_KEY,
      requestedAt: now,
      requestReason: input.reason,
      requestedListingWatermark: watermarks.listingWatermark,
      requestedSocialWatermark: watermarks.socialWatermark,
      requestedPropertyWatermark: watermarks.propertyWatermark,
      requestedCoverageWatermark: watermarks.coverageWatermark,
    })
    .onConflictDoUpdate({
      target: propertyTileSnapshotRefreshState.key,
      set: {
        requestedAt: now,
        requestReason: input.reason,
        requestedListingWatermark: watermarks.listingWatermark,
        requestedSocialWatermark: watermarks.socialWatermark,
        requestedPropertyWatermark: watermarks.propertyWatermark,
        requestedCoverageWatermark: watermarks.coverageWatermark,
      },
    });

  const enqueueResult = await enqueuePropertyTileSnapshotRefresh({ reason: input.reason });
  return buildPropertyTileSnapshotRefreshRequestResult({ enqueueResult });
}

export async function invalidatePropertyTileSnapshots(input: {
  dimensions: readonly PropertyTileSnapshotWatermarkDimension[];
  reason: string;
  throttleMs?: number;
  executor?: SnapshotDb;
}): Promise<void> {
  await advancePropertyTileSnapshotWatermark(input.dimensions, input.executor);
  if (input.executor) {
    return;
  }
  await requestPropertyTileSnapshotRefresh({ reason: input.reason, throttleMs: input.throttleMs });
}

export async function upsertPropertyTileSnapshotRow(input: {
  tile: PropertyTileCoordinate;
  filterSignature: string;
  coverage: PropertyTileSnapshotCoverageDefinition;
  payload: Buffer;
  watermarks: SnapshotWatermarks;
  generatedAt?: Date;
}): Promise<{ written: boolean; skippedAsStale: boolean }> {
  const statusCode = input.payload.byteLength > 0 ? 200 : 204;
  const payload = statusCode === 200 ? input.payload : null;
  const cacheKey = `${input.tile.z}/${input.tile.x}/${input.tile.y}:${input.filterSignature}`;
  const etag = buildPropertyTileEtag(cacheKey, payload);
  const generatedAt = input.generatedAt ?? new Date();

  const rows = await db.execute<{ z: number }>(sql`
    INSERT INTO property_tile_snapshots (
      z,
      x,
      y,
      filter_signature,
      coverage_id,
      payload,
      status_code,
      etag,
      generated_at,
      source_listing_watermark,
      source_social_watermark,
      source_property_watermark,
      source_coverage_watermark,
      snapshot_config_hash,
      refreshed_at
    )
    VALUES (
      ${input.tile.z},
      ${input.tile.x},
      ${input.tile.y},
      ${input.filterSignature},
      ${input.coverage.coverageId},
      ${payload},
      ${statusCode},
      ${etag},
      ${generatedAt.toISOString()}::timestamptz,
      ${input.watermarks.listingWatermark},
      ${input.watermarks.socialWatermark},
      ${input.watermarks.propertyWatermark},
      ${input.watermarks.coverageWatermark},
      ${input.coverage.snapshotConfigHash},
      ${generatedAt.toISOString()}::timestamptz
    )
    ON CONFLICT (z, x, y, filter_signature) DO UPDATE SET
      coverage_id = EXCLUDED.coverage_id,
      payload = EXCLUDED.payload,
      status_code = EXCLUDED.status_code,
      etag = EXCLUDED.etag,
      generated_at = EXCLUDED.generated_at,
      source_listing_watermark = EXCLUDED.source_listing_watermark,
      source_social_watermark = EXCLUDED.source_social_watermark,
      source_property_watermark = EXCLUDED.source_property_watermark,
      source_coverage_watermark = EXCLUDED.source_coverage_watermark,
      snapshot_config_hash = EXCLUDED.snapshot_config_hash,
      refreshed_at = EXCLUDED.refreshed_at
    WHERE
      property_tile_snapshots.source_listing_watermark <= EXCLUDED.source_listing_watermark
      AND property_tile_snapshots.source_social_watermark <= EXCLUDED.source_social_watermark
      AND property_tile_snapshots.source_property_watermark <= EXCLUDED.source_property_watermark
      AND property_tile_snapshots.source_coverage_watermark <= EXCLUDED.source_coverage_watermark
      AND (
        property_tile_snapshots.source_listing_watermark < EXCLUDED.source_listing_watermark
        OR property_tile_snapshots.source_social_watermark < EXCLUDED.source_social_watermark
        OR property_tile_snapshots.source_property_watermark < EXCLUDED.source_property_watermark
        OR property_tile_snapshots.source_coverage_watermark < EXCLUDED.source_coverage_watermark
        OR property_tile_snapshots.generated_at <= EXCLUDED.generated_at
      )
    RETURNING z
  `);
  const written = Array.from(rows).length > 0;
  return { written, skippedAsStale: !written };
}

async function countCurrentSnapshots(coverage: PropertyTileSnapshotCoverageDefinition): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(propertyTileSnapshots)
    .where(
      and(
        eq(propertyTileSnapshots.coverageId, coverage.coverageId),
        eq(propertyTileSnapshots.filterSignature, coverage.filterSignature),
        eq(propertyTileSnapshots.snapshotConfigHash, coverage.snapshotConfigHash),
      ),
    );

  return rows[0]?.count ?? 0;
}

async function readSnapshotRefreshState() {
  const rows = await db
    .select()
    .from(propertyTileSnapshotRefreshState)
    .where(eq(propertyTileSnapshotRefreshState.key, PROPERTY_TILE_SNAPSHOT_KEY))
    .limit(1);

  return rows[0] ?? null;
}

function getBehindWatermarkDimensions(
  watermarks: SnapshotWatermarks,
  state: NonNullable<Awaited<ReturnType<typeof readSnapshotRefreshState>>>,
) {
  return {
    listing: watermarks.listingWatermark > state.appliedListingWatermark,
    social: watermarks.socialWatermark > state.appliedSocialWatermark,
    property: watermarks.propertyWatermark > state.appliedPropertyWatermark,
    coverage: watermarks.coverageWatermark > state.appliedCoverageWatermark,
  };
}

function hasAnyBehindWatermark(dimensions: ReturnType<typeof getBehindWatermarkDimensions>): boolean {
  return dimensions.listing || dimensions.social || dimensions.property || dimensions.coverage;
}

function hasOnlySocialBehindWatermark(dimensions: ReturnType<typeof getBehindWatermarkDimensions>): boolean {
  return dimensions.social && !dimensions.listing && !dimensions.property && !dimensions.coverage;
}

export async function shouldRequestPropertyTileSnapshotRefresh(): Promise<PropertyTileSnapshotRefreshCheck> {
  const coverage = await getDefaultPropertyTileSnapshotCoverage();
  const coordinates = computePropertyTileSnapshotCoordinatesFromCoverage(coverage);
  const [snapshotCount, watermarks] = await Promise.all([
    countCurrentSnapshots(coverage),
    readSnapshotWatermarks(),
  ]);
  const state = await readSnapshotRefreshState();

  if (snapshotCount === 0) {
    return { shouldEnqueue: true, reason: 'absent_snapshots' };
  }
  if (snapshotCount < coordinates.length) {
    return { shouldEnqueue: true, reason: 'incomplete_coverage' };
  }
  if (state?.lastError) {
    return { shouldEnqueue: true, reason: 'last_refresh_failed' };
  }
  if (!state) {
    return { shouldEnqueue: true, reason: 'behind_watermarks' };
  }
  const behindWatermarks = getBehindWatermarkDimensions(watermarks, state);
  if (hasAnyBehindWatermark(behindWatermarks)) {
    if (
      hasOnlySocialBehindWatermark(behindWatermarks) &&
      isPropertyViewSnapshotRecoveryThrottled({
        requestReason: state.requestReason,
        requestedAt: state.requestedAt,
        lastError: state.lastError,
        now: new Date(),
        throttleMs: getPropertyViewSnapshotRefreshThrottleMs(),
      })
    ) {
      return { shouldEnqueue: false, reason: 'property_view_throttled' };
    }
    return { shouldEnqueue: true, reason: 'behind_watermarks' };
  }
  if (state.coverageId !== coverage.coverageId || state.snapshotConfigHash !== coverage.snapshotConfigHash) {
    return { shouldEnqueue: true, reason: 'coverage_config_changed' };
  }
  if (
    !state.lastWindowRefreshAt ||
    Date.now() - state.lastWindowRefreshAt.getTime() >
      getPropertyTileSnapshotRollingMaxAgeSeconds() * 1000
  ) {
    return { shouldEnqueue: true, reason: 'rolling_window_stale' };
  }

  return { shouldEnqueue: false, reason: 'current' };
}

async function claimRefreshLease(owner: string, leaseSeconds: number): Promise<boolean> {
  await readSnapshotWatermarks();
  const leaseUntil = new Date(Date.now() + leaseSeconds * 1000);
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${PROPERTY_TILE_SNAPSHOT_KEY}))`);
    await tx
      .insert(propertyTileSnapshotRefreshState)
      .values({ key: PROPERTY_TILE_SNAPSHOT_KEY })
      .onConflictDoNothing();

    return tx.execute<{ key: string }>(sql`
      UPDATE property_tile_snapshot_refresh_state
      SET
        lease_owner = ${owner},
        lease_until = ${leaseUntil.toISOString()}::timestamptz,
        last_started_at = now(),
        last_finished_at = NULL,
        last_error = NULL
      WHERE key = ${PROPERTY_TILE_SNAPSHOT_KEY}
        AND (lease_until IS NULL OR lease_until < now() OR lease_owner = ${owner})
      RETURNING key
    `);
  });

  return Array.from(rows).length > 0;
}

async function renewRefreshLease(owner: string, leaseSeconds: number): Promise<boolean> {
  const leaseUntil = new Date(Date.now() + leaseSeconds * 1000);
  const rows = await db.execute<{ key: string }>(sql`
    UPDATE property_tile_snapshot_refresh_state
    SET lease_until = ${leaseUntil.toISOString()}::timestamptz
    WHERE key = ${PROPERTY_TILE_SNAPSHOT_KEY}
      AND lease_owner = ${owner}
    RETURNING key
  `);

  return Array.from(rows).length > 0;
}

async function finishRefresh(input: {
  owner: string;
  coverage: PropertyTileSnapshotCoverageDefinition;
  expectedTileCount: number;
  refreshedTileCount: number;
  failedTileCount: number;
  watermarks: Awaited<ReturnType<typeof readSnapshotWatermarks>>;
  success: boolean;
  error?: unknown;
}): Promise<void> {
  const errorMessage = input.error instanceof Error
    ? input.error.message.slice(0, 2_000)
    : input.error == null
      ? null
      : String(input.error).slice(0, 2_000);

  await db.execute(sql`
    UPDATE property_tile_snapshot_refresh_state
    SET
      lease_owner = NULL,
      lease_until = NULL,
      last_finished_at = now(),
      last_success_at = CASE
        WHEN ${input.success}
          AND applied_listing_watermark <= ${input.watermarks.listingWatermark}
          AND applied_social_watermark <= ${input.watermarks.socialWatermark}
          AND applied_property_watermark <= ${input.watermarks.propertyWatermark}
          AND applied_coverage_watermark <= ${input.watermarks.coverageWatermark}
          THEN now()
        ELSE last_success_at
      END,
      last_error = CASE
        WHEN applied_listing_watermark <= ${input.watermarks.listingWatermark}
          AND applied_social_watermark <= ${input.watermarks.socialWatermark}
          AND applied_property_watermark <= ${input.watermarks.propertyWatermark}
          AND applied_coverage_watermark <= ${input.watermarks.coverageWatermark}
          THEN ${errorMessage}
        ELSE last_error
      END,
      applied_listing_watermark = CASE
        WHEN ${input.success} THEN GREATEST(applied_listing_watermark, ${input.watermarks.listingWatermark})
        ELSE applied_listing_watermark
      END,
      applied_social_watermark = CASE
        WHEN ${input.success} THEN GREATEST(applied_social_watermark, ${input.watermarks.socialWatermark})
        ELSE applied_social_watermark
      END,
      applied_property_watermark = CASE
        WHEN ${input.success} THEN GREATEST(applied_property_watermark, ${input.watermarks.propertyWatermark})
        ELSE applied_property_watermark
      END,
      applied_coverage_watermark = CASE
        WHEN ${input.success} THEN GREATEST(applied_coverage_watermark, ${input.watermarks.coverageWatermark})
        ELSE applied_coverage_watermark
      END,
      coverage_id = CASE
        WHEN ${input.success}
          AND applied_listing_watermark <= ${input.watermarks.listingWatermark}
          AND applied_social_watermark <= ${input.watermarks.socialWatermark}
          AND applied_property_watermark <= ${input.watermarks.propertyWatermark}
          AND applied_coverage_watermark <= ${input.watermarks.coverageWatermark}
          THEN ${input.coverage.coverageId}
        ELSE coverage_id
      END,
      snapshot_config_hash = CASE
        WHEN ${input.success}
          AND applied_listing_watermark <= ${input.watermarks.listingWatermark}
          AND applied_social_watermark <= ${input.watermarks.socialWatermark}
          AND applied_property_watermark <= ${input.watermarks.propertyWatermark}
          AND applied_coverage_watermark <= ${input.watermarks.coverageWatermark}
          THEN ${input.coverage.snapshotConfigHash}
        ELSE snapshot_config_hash
      END,
      expected_tile_count = CASE
        WHEN applied_listing_watermark <= ${input.watermarks.listingWatermark}
          AND applied_social_watermark <= ${input.watermarks.socialWatermark}
          AND applied_property_watermark <= ${input.watermarks.propertyWatermark}
          AND applied_coverage_watermark <= ${input.watermarks.coverageWatermark}
          THEN ${input.expectedTileCount}
        ELSE expected_tile_count
      END,
      refreshed_tile_count = CASE
        WHEN applied_listing_watermark <= ${input.watermarks.listingWatermark}
          AND applied_social_watermark <= ${input.watermarks.socialWatermark}
          AND applied_property_watermark <= ${input.watermarks.propertyWatermark}
          AND applied_coverage_watermark <= ${input.watermarks.coverageWatermark}
          THEN ${input.refreshedTileCount}
        ELSE refreshed_tile_count
      END,
      failed_tile_count = CASE
        WHEN applied_listing_watermark <= ${input.watermarks.listingWatermark}
          AND applied_social_watermark <= ${input.watermarks.socialWatermark}
          AND applied_property_watermark <= ${input.watermarks.propertyWatermark}
          AND applied_coverage_watermark <= ${input.watermarks.coverageWatermark}
          THEN ${input.failedTileCount}
        ELSE failed_tile_count
      END,
      last_window_refresh_at = CASE
        WHEN ${input.success}
          AND applied_listing_watermark <= ${input.watermarks.listingWatermark}
          AND applied_social_watermark <= ${input.watermarks.socialWatermark}
          AND applied_property_watermark <= ${input.watermarks.propertyWatermark}
          AND applied_coverage_watermark <= ${input.watermarks.coverageWatermark}
          THEN now()
        ELSE last_window_refresh_at
      END
    WHERE key = ${PROPERTY_TILE_SNAPSHOT_KEY}
      AND lease_owner = ${input.owner}
  `);
}

type ExistingSnapshotRefreshRow = {
  z: number;
  x: number;
  y: number;
  generatedAt: Date;
  refreshedAt: Date;
  sourceListingWatermark: bigint;
  sourceSocialWatermark: bigint;
  sourcePropertyWatermark: bigint;
  sourceCoverageWatermark: bigint;
};

function isSnapshotRowBehindWatermarks(
  row: ExistingSnapshotRefreshRow,
  watermarks: SnapshotWatermarks,
): boolean {
  return (
    row.sourceListingWatermark < watermarks.listingWatermark ||
    row.sourceSocialWatermark < watermarks.socialWatermark ||
    row.sourcePropertyWatermark < watermarks.propertyWatermark ||
    row.sourceCoverageWatermark < watermarks.coverageWatermark
  );
}

export function isSnapshotTileDueForRollingWindow(input: {
  refreshedAt: Date;
  lastWindowRefreshAt: Date | null | undefined;
  now: Date;
  maxAgeMs: number;
}): boolean {
  if (!input.lastWindowRefreshAt) {
    return true;
  }

  if (input.now.getTime() - input.lastWindowRefreshAt.getTime() <= input.maxAgeMs) {
    return false;
  }

  return input.refreshedAt <= input.lastWindowRefreshAt;
}

async function selectDueSnapshotTiles(
  tiles: PropertyTileCoordinate[],
  coverage: PropertyTileSnapshotCoverageDefinition,
  watermarks: SnapshotWatermarks,
): Promise<PropertyTileCoordinate[]> {
  const [existing, state] = await Promise.all([
    db
      .select({
        z: propertyTileSnapshots.z,
        x: propertyTileSnapshots.x,
        y: propertyTileSnapshots.y,
        generatedAt: propertyTileSnapshots.generatedAt,
        refreshedAt: propertyTileSnapshots.refreshedAt,
        sourceListingWatermark: propertyTileSnapshots.sourceListingWatermark,
        sourceSocialWatermark: propertyTileSnapshots.sourceSocialWatermark,
        sourcePropertyWatermark: propertyTileSnapshots.sourcePropertyWatermark,
        sourceCoverageWatermark: propertyTileSnapshots.sourceCoverageWatermark,
      })
      .from(propertyTileSnapshots)
      .where(
        and(
          eq(propertyTileSnapshots.coverageId, coverage.coverageId),
          eq(propertyTileSnapshots.filterSignature, coverage.filterSignature),
          eq(propertyTileSnapshots.snapshotConfigHash, coverage.snapshotConfigHash),
        ),
      ),
    readSnapshotRefreshState(),
  ]);

  const existingByKey = new Map(
    existing.map((row) => [`${row.z}/${row.x}/${row.y}`, row]),
  );
  const rangesByZoom = buildCoverageTileRanges(coverage);
  const rollingMaxAgeMs = getPropertyTileSnapshotRollingMaxAgeSeconds() * 1000;
  const now = new Date();

  return tiles
    .filter((tile) => {
      const row = existingByKey.get(`${tile.z}/${tile.x}/${tile.y}`);
      if (!row) {
        return true;
      }
      if (isSnapshotRowBehindWatermarks(row, watermarks)) {
        return true;
      }
      return isSnapshotTileDueForRollingWindow({
        refreshedAt: row.refreshedAt,
        lastWindowRefreshAt: state?.lastWindowRefreshAt,
        now,
        maxAgeMs: rollingMaxAgeMs,
      });
    })
    .sort((a, b) => {
      const aGeneratedAt = existingByKey.get(`${a.z}/${a.x}/${a.y}`)?.generatedAt.getTime() ?? 0;
      const bGeneratedAt = existingByKey.get(`${b.z}/${b.x}/${b.y}`)?.generatedAt.getTime() ?? 0;
      return (
        comparePropertyTileSnapshotCoordinatePriority(a, b, rangesByZoom) ||
        aGeneratedAt - bGeneratedAt ||
        compareCanonicalTileCoordinates(a, b)
      );
    });
}

export function summarizePropertyTileSnapshotRefreshRun(input: {
  dueTileCount: number;
  attemptedTileCount: number;
  refreshedTileCount: number;
  failedTileCount: number;
}): {
  completed: boolean;
  skippedTileCount: number;
  status: PropertyTileSnapshotRefreshResult['status'];
  error: string | null;
} {
  const skippedTileCount = Math.max(0, input.dueTileCount - input.attemptedTileCount);
  const completed = input.failedTileCount === 0 && skippedTileCount === 0;
  const status = completed
    ? 'completed'
    : input.failedTileCount > 0
      ? 'failed'
      : 'quota_exhausted';
  const error = input.failedTileCount > 0
    ? `Snapshot refresh incomplete: ${input.failedTileCount} failed, ${skippedTileCount} unattempted due tiles remain`
    : null;

  return {
    completed,
    skippedTileCount,
    status,
    error,
  };
}

export async function executePropertyTileSnapshotRefresh(input: {
  reason?: string;
  leaseOwner?: string;
  builder?: PropertyTileSnapshotBuilder;
} = {}): Promise<PropertyTileSnapshotRefreshResult> {
  const reason = input.reason ?? PROPERTY_TILE_SNAPSHOT_REFRESH_JOB_REASON;
  const owner = input.leaseOwner ?? `${process.pid}:${randomUUID()}`;
  const startedAt = Date.now();
  const leaseSeconds = getPropertyTileSnapshotLeaseSeconds();
  const leaseClaimed = await claimRefreshLease(owner, leaseSeconds);
  if (!leaseClaimed) {
    return { status: 'skipped_locked', reason };
  }

  let leaseLost = false;
  let leaseRenewalInFlight = false;
  const renewalInterval = setInterval(() => {
    if (leaseRenewalInFlight) {
      return;
    }

    leaseRenewalInFlight = true;
    renewRefreshLease(owner, leaseSeconds)
      .then((renewed) => {
        if (!renewed) {
          leaseLost = true;
        }
      })
      .catch(() => {
        leaseLost = true;
      })
      .finally(() => {
        leaseRenewalInFlight = false;
      });
  }, Math.max(MIN_LEASE_RENEWAL_INTERVAL_MS, Math.floor((leaseSeconds * 1000) / 3)));
  renewalInterval.unref?.();

  const coverage = await getDefaultPropertyTileSnapshotCoverage();
  const watermarks = await readSnapshotWatermarks();
  const allTiles = computePropertyTileSnapshotCoordinatesFromCoverage(coverage);
  const maxTiles = getPropertyTilePrecomputeMaxTilesPerRun();
  const maxRunMs = getPropertyTilePrecomputeMaxSecondsPerRun() * 1000;
  const concurrency = getPropertyTilePrecomputeConcurrency();
  const dueTiles = await selectDueSnapshotTiles(allTiles, coverage, watermarks);
  const builder = input.builder ?? buildMvtForTile;
  let refreshedTileCount = 0;
  let failedTileCount = 0;
  let staleWriteSkippedTileCount = 0;
  let attemptedTileCount = 0;
  let nextTileIndex = 0;

  async function refreshNextDueTile(): Promise<void> {
    while (Date.now() - startedAt < maxRunMs) {
      const tileIndex = nextTileIndex;
      if (leaseLost) {
        throw new Error('Property tile snapshot refresh lease was lost');
      }
      if (tileIndex >= dueTiles.length || attemptedTileCount >= maxTiles) {
        return;
      }
      nextTileIndex += 1;
      attemptedTileCount += 1;

      const tile = dueTiles[tileIndex];
      if (!tile) {
        return;
      }

      try {
        const tileStartedAt = new Date();
        const payload = await builder(tile, createDefaultMapFilters(), {
          statementTimeoutMs: 1_500,
          runtimeBudgetMs: 2_000,
        });
        if (leaseLost) {
          throw new Error('Property tile snapshot refresh lease was lost');
        }
        const writeResult = await upsertPropertyTileSnapshotRow({
          tile,
          filterSignature: coverage.filterSignature,
          coverage,
          payload,
          watermarks,
          generatedAt: tileStartedAt,
        });
        if (writeResult.written) {
          refreshedTileCount += 1;
        } else {
          staleWriteSkippedTileCount += 1;
        }
      } catch {
        failedTileCount += 1;
      }
    }
  }

  try {
    const workerCount = Math.min(concurrency, dueTiles.length, maxTiles);
    await Promise.all(Array.from({ length: workerCount }, () => refreshNextDueTile()));

    const summary = summarizePropertyTileSnapshotRefreshRun({
      dueTileCount: dueTiles.length,
      attemptedTileCount,
      refreshedTileCount,
      failedTileCount,
    });
    await finishRefresh({
      owner,
      coverage,
      expectedTileCount: allTiles.length,
      refreshedTileCount,
      failedTileCount,
      watermarks,
      success: summary.completed,
      error: summary.error,
    });

    return {
      status: summary.status,
      reason,
      expectedTileCount: allTiles.length,
      refreshedTileCount,
      failedTileCount,
      skippedTileCount: summary.skippedTileCount,
      staleWriteSkippedTileCount,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    await finishRefresh({
      owner,
      coverage,
      expectedTileCount: allTiles.length,
      refreshedTileCount,
      failedTileCount: failedTileCount + 1,
      watermarks,
      success: false,
      error,
    });
    throw error;
  } finally {
    clearInterval(renewalInterval);
  }
}
