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
import { enqueuePropertyTileSnapshotRefresh } from './ingest/queue.js';
import { ACTIVE_SOCIAL_SCORE_THRESHOLD } from './property-queries.js';

export const PROPERTY_TILE_SNAPSHOT_KEY = 'public_default_low_zoom';
export const PROPERTY_TILE_SNAPSHOT_REFRESH_JOB_REASON = 'snapshot-refresh';
export const DEFAULT_PROPERTY_TILE_SNAPSHOT_COVERAGE_ID = 'public_default_low_zoom_v1';

const DEFAULT_MAX_ZOOM = 10;
const DEFAULT_MAX_TILES_PER_RUN = 1_000;
const DEFAULT_MAX_SECONDS_PER_RUN = 60;
const DEFAULT_PRECOMPUTE_CONCURRENCY = 1;
const DEFAULT_LEASE_SECONDS = 15 * 60;
const DEFAULT_ROLLING_MAX_AGE_SECONDS = 60 * 60;
const DEFAULT_PROPERTY_VIEW_REFRESH_THROTTLE_MS = 5 * 60_000;

type SnapshotDb = typeof db | DbTransaction;

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
  coverageWatermark: number;
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
  durationMs?: number;
}

export interface PropertyTileSnapshotRefreshCheck {
  shouldEnqueue: boolean;
  reason: string;
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
  return parsePositiveIntegerEnv(
    'PROPERTY_TILE_PRECOMPUTE_CONCURRENCY',
    DEFAULT_PRECOMPUTE_CONCURRENCY,
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
      comments: '30 days',
      propertyLikes: '30 days',
      commentLikes: '30 days',
      guesses: '30 days',
      propertyViews: '7 days',
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
        coverageWatermark: sql<number>`
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

export function computePropertyTileSnapshotCoordinatesFromCoverage(
  coverage: Pick<PropertyTileSnapshotCoverageDefinition, 'minLon' | 'minLat' | 'maxLon' | 'maxLat' | 'maxZoom'>,
): PropertyTileCoordinate[] {
  if (!(coverage.minLon < coverage.maxLon && coverage.minLat < coverage.maxLat)) {
    throw new Error('Cannot compute property tile snapshot coordinates from invalid coverage bounds');
  }

  const coordinates: PropertyTileCoordinate[] = [];
  for (let z = 0; z <= coverage.maxZoom; z += 1) {
    const minX = clampTileCoordinate(lonToTileX(coverage.minLon, z), z);
    const maxX = clampTileCoordinate(lonToTileX(coverage.maxLon, z), z);
    const minY = clampTileCoordinate(latToTileY(coverage.maxLat, z), z);
    const maxY = clampTileCoordinate(latToTileY(coverage.minLat, z), z);

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        coordinates.push({ z, x, y });
      }
    }
  }

  return coordinates.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
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
): Promise<{ enqueued: boolean; throttled: boolean } | null> {
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

  const listingIncrement = unique.has('listing') ? 1 : 0;
  const socialIncrement = unique.has('social') ? 1 : 0;
  const propertyIncrement = unique.has('property') ? 1 : 0;
  const coverageIncrement = unique.has('coverage') ? 1 : 0;
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

export async function requestPropertyTileSnapshotRefresh(input: {
  reason: string;
  throttleMs?: number;
  enqueue?: boolean;
}): Promise<{ enqueued: boolean; throttled: boolean }> {
  const previousRows = await db
    .select({
      requestedAt: propertyTileSnapshotRefreshState.requestedAt,
      lastError: propertyTileSnapshotRefreshState.lastError,
    })
    .from(propertyTileSnapshotRefreshState)
    .where(eq(propertyTileSnapshotRefreshState.key, PROPERTY_TILE_SNAPSHOT_KEY))
    .limit(1);
  const previous = previousRows[0] ?? null;
  const watermarks = await readSnapshotWatermarks();
  const now = new Date();

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

  const throttled =
    input.throttleMs != null &&
    previous?.requestedAt != null &&
    previous.lastError == null &&
    now.getTime() - previous.requestedAt.getTime() < input.throttleMs;

  if (throttled || input.enqueue === false) {
    return { enqueued: false, throttled };
  }

  await enqueuePropertyTileSnapshotRefresh({ reason: input.reason });
  return { enqueued: true, throttled: false };
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
  watermarks: {
    listingWatermark: number;
    socialWatermark: number;
    propertyWatermark: number;
    coverageWatermark: number;
  };
  generatedAt?: Date;
}): Promise<void> {
  const statusCode = input.payload.byteLength > 0 ? 200 : 204;
  const payload = statusCode === 200 ? input.payload : null;
  const cacheKey = `${input.tile.z}/${input.tile.x}/${input.tile.y}:${input.filterSignature}`;
  const etag = buildPropertyTileEtag(cacheKey, payload);
  const generatedAt = input.generatedAt ?? new Date();

  await db
    .insert(propertyTileSnapshots)
    .values({
      z: input.tile.z,
      x: input.tile.x,
      y: input.tile.y,
      filterSignature: input.filterSignature,
      coverageId: input.coverage.coverageId,
      payload,
      statusCode,
      etag,
      generatedAt,
      sourceListingWatermark: input.watermarks.listingWatermark,
      sourceSocialWatermark: input.watermarks.socialWatermark,
      sourcePropertyWatermark: input.watermarks.propertyWatermark,
      sourceCoverageWatermark: input.watermarks.coverageWatermark,
      snapshotConfigHash: input.coverage.snapshotConfigHash,
      refreshedAt: generatedAt,
    })
    .onConflictDoUpdate({
      target: [
        propertyTileSnapshots.z,
        propertyTileSnapshots.x,
        propertyTileSnapshots.y,
        propertyTileSnapshots.filterSignature,
      ],
      set: {
        coverageId: input.coverage.coverageId,
        payload,
        statusCode,
        etag,
        generatedAt,
        sourceListingWatermark: input.watermarks.listingWatermark,
        sourceSocialWatermark: input.watermarks.socialWatermark,
        sourcePropertyWatermark: input.watermarks.propertyWatermark,
        sourceCoverageWatermark: input.watermarks.coverageWatermark,
        snapshotConfigHash: input.coverage.snapshotConfigHash,
        refreshedAt: generatedAt,
      },
    });
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
  if (
    !state ||
    watermarks.listingWatermark > state.appliedListingWatermark ||
    watermarks.socialWatermark > state.appliedSocialWatermark ||
    watermarks.propertyWatermark > state.appliedPropertyWatermark ||
    watermarks.coverageWatermark > state.appliedCoverageWatermark
  ) {
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
      last_success_at = CASE WHEN ${input.success} THEN now() ELSE last_success_at END,
      last_error = ${errorMessage},
      applied_listing_watermark = CASE WHEN ${input.success} THEN ${input.watermarks.listingWatermark} ELSE applied_listing_watermark END,
      applied_social_watermark = CASE WHEN ${input.success} THEN ${input.watermarks.socialWatermark} ELSE applied_social_watermark END,
      applied_property_watermark = CASE WHEN ${input.success} THEN ${input.watermarks.propertyWatermark} ELSE applied_property_watermark END,
      applied_coverage_watermark = CASE WHEN ${input.success} THEN ${input.watermarks.coverageWatermark} ELSE applied_coverage_watermark END,
      coverage_id = ${input.coverage.coverageId},
      snapshot_config_hash = ${input.coverage.snapshotConfigHash},
      expected_tile_count = ${input.expectedTileCount},
      refreshed_tile_count = ${input.refreshedTileCount},
      failed_tile_count = ${input.failedTileCount},
      last_window_refresh_at = CASE WHEN ${input.success} THEN now() ELSE last_window_refresh_at END
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
  sourceListingWatermark: number;
  sourceSocialWatermark: number;
  sourcePropertyWatermark: number;
  sourceCoverageWatermark: number;
};

function isSnapshotRowBehindWatermarks(
  row: ExistingSnapshotRefreshRow,
  watermarks: Awaited<ReturnType<typeof readSnapshotWatermarks>>,
): boolean {
  return (
    row.sourceListingWatermark < watermarks.listingWatermark ||
    row.sourceSocialWatermark < watermarks.socialWatermark ||
    row.sourcePropertyWatermark < watermarks.propertyWatermark ||
    row.sourceCoverageWatermark < watermarks.coverageWatermark
  );
}

async function selectDueSnapshotTiles(
  tiles: PropertyTileCoordinate[],
  coverage: PropertyTileSnapshotCoverageDefinition,
  watermarks: Awaited<ReturnType<typeof readSnapshotWatermarks>>,
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
  const rollingWindowStale =
    state?.lastWindowRefreshAt != null &&
    Date.now() - state.lastWindowRefreshAt.getTime() >
      getPropertyTileSnapshotRollingMaxAgeSeconds() * 1000;
  const rollingRefreshCutoff = rollingWindowStale ? state.lastWindowRefreshAt : null;

  return tiles
    .filter((tile) => {
      const row = existingByKey.get(`${tile.z}/${tile.x}/${tile.y}`);
      if (!row) {
        return true;
      }
      if (isSnapshotRowBehindWatermarks(row, watermarks)) {
        return true;
      }
      return rollingRefreshCutoff != null && row.refreshedAt <= rollingRefreshCutoff;
    })
    .sort((a, b) => {
      const aGeneratedAt = existingByKey.get(`${a.z}/${a.x}/${a.y}`)?.generatedAt.getTime() ?? 0;
      const bGeneratedAt = existingByKey.get(`${b.z}/${b.x}/${b.y}`)?.generatedAt.getTime() ?? 0;
      return aGeneratedAt - bGeneratedAt || a.z - b.z || a.x - b.x || a.y - b.y;
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
  if (getPropertyTilePrecomputeConcurrency() !== 1) {
    throw new Error('PROPERTY_TILE_PRECOMPUTE_CONCURRENCY currently supports only 1');
  }

  const reason = input.reason ?? PROPERTY_TILE_SNAPSHOT_REFRESH_JOB_REASON;
  const owner = input.leaseOwner ?? `${process.pid}:${randomUUID()}`;
  const startedAt = Date.now();
  const leaseClaimed = await claimRefreshLease(owner, DEFAULT_LEASE_SECONDS);
  if (!leaseClaimed) {
    return { status: 'skipped_locked', reason };
  }

  const coverage = await getDefaultPropertyTileSnapshotCoverage();
  const watermarks = await readSnapshotWatermarks();
  const allTiles = computePropertyTileSnapshotCoordinatesFromCoverage(coverage);
  const maxTiles = getPropertyTilePrecomputeMaxTilesPerRun();
  const maxRunMs = getPropertyTilePrecomputeMaxSecondsPerRun() * 1000;
  const dueTiles = await selectDueSnapshotTiles(allTiles, coverage, watermarks);
  const builder = input.builder ?? buildMvtForTile;
  let refreshedTileCount = 0;
  let failedTileCount = 0;
  let attemptedTileCount = 0;

  try {
    for (const tile of dueTiles) {
      if (attemptedTileCount >= maxTiles || Date.now() - startedAt >= maxRunMs) {
        break;
      }
      attemptedTileCount += 1;

      try {
        const payload = await builder(tile, createDefaultMapFilters(), {
          statementTimeoutMs: 1_500,
          runtimeBudgetMs: 2_000,
        });
        await upsertPropertyTileSnapshotRow({
          tile,
          filterSignature: coverage.filterSignature,
          coverage,
          payload,
          watermarks,
        });
        refreshedTileCount += 1;
      } catch {
        failedTileCount += 1;
      }
    }

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
  }
}
