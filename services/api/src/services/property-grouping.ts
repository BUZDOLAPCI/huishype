import { sql, type SQL } from 'drizzle-orm';
import {
  isValidCountryCode,
  PROPERTY_MAP_FOOTPRINTS,
  PROPERTY_GHOST_REVEAL_ZOOM,
  PROPERTY_PREVIEW_MEMBER_LIMIT,
} from '@huishype/shared/config';
import { db, type DbTransaction } from '../db/index.js';
import { formatDisplayAddress } from '../utils/address.js';
import {
  ACTIVE_SOCIAL_SCORE_THRESHOLD,
  buildActivityFilterPredicate,
  canonicalListingFactOrderExpression,
  buildPropertyFollowingSocialFactsJoin,
  buildPropertyListingFactsJoin,
  listingThumbnailOrderExpression,
} from './property-queries.js';
import {
  areMapFiltersDefault,
  buildPropertyMarketFilterQuery,
  createDefaultMapFilters,
  getMapFilterSignature,
  MAP_MARKET_STATES,
  type MapFilters,
  type MapMarketState,
} from './map-filters.js';
import { filterReadCanonicalGroups, type PropertyReadViewer } from './property-read-state.js';
import {
  getPropertyTileRuntimeConfig,
  PropertyTileBudgetExceededError,
  PropertyTileBuildAbortedError,
  type PropertyTileBuildOptions,
} from './property-tile-runtime.js';

export const PROPERTY_TILE_EXTENT = 4096;
const TILE_SIZE_PX = 512;
const TILE_UNITS_PER_PX = PROPERTY_TILE_EXTENT / TILE_SIZE_PX;
export const GHOST_NODE_REVEAL_ZOOM = PROPERTY_GHOST_REVEAL_ZOOM;
const SOURCE_FIRST_CANDIDATE_SCOPE_MAX_ZOOM = 14;
const DEFAULT_PROPERTY_TILE_PYRAMID_MAX_ZOOM = 10;

const ACTIVE_FOOTPRINT = PROPERTY_MAP_FOOTPRINTS.active;
const GHOST_FOOTPRINT = PROPERTY_MAP_FOOTPRINTS.ghost;
const ACTIVE_GROUPING_GAP_PX = ACTIVE_FOOTPRINT.groupingGapPx;
const GHOST_GROUPING_GAP_PX = GHOST_FOOTPRINT.groupingGapPx;
const GHOST_SUPPRESSION_PADDING_PX = GHOST_FOOTPRINT.suppressionPaddingPx;
const NEARBY_TAP_TOLERANCE_PX = PROPERTY_MAP_FOOTPRINTS.nearbyTapTolerancePx;
const DEFAULT_SHARED_CANONICAL_BUDGET_MS = 3_000;
const MVT_CLUSTER_PROPERTY_IDS_COMPLETE_MAX = PROPERTY_PREVIEW_MEMBER_LIMIT;
const MVT_CLUSTER_PROPERTY_IDS_LOW_ZOOM_MAX = 14;

type NodeClass = 'active' | 'ghost';
type GroupKind = 'single' | 'cluster';

type TileId = {
  z: number;
  x: number;
  y: number;
};

export type TileBBox = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

type WorldBBox = {
  minWorldX: number;
  minWorldY: number;
  maxWorldX: number;
  maxWorldY: number;
};

type GroupingCandidateRow = {
  id: string;
  has_active_listing: boolean;
  has_completed_listing: boolean;
  social_score: number;
  recent_social_score: number;
  comment_count: number;
  market_state: 'for-sale' | 'for-rent' | 'sold' | 'rented' | 'not-listed';
  lon: number;
  lat: number;
};

type SinglePropertyDetailRow = {
  id: string;
  country_code: string;
  street: string;
  house_number: number;
  house_number_addition: string | null;
  city: string;
  postal_code: string | null;
  asking_price: number | null;
  thumbnail_url: string | null;
  has_active_listing: boolean;
  market_state: 'for-sale' | 'for-rent' | 'sold' | 'rented' | 'not-listed';
};

export type GroupingCandidate = {
  id: string;
  hasActiveListing: boolean;
  hasCompletedListing: boolean;
  socialScore: number;
  recentSocialScore: number;
  commentCount: number;
  marketState: 'for-sale' | 'for-rent' | 'sold' | 'rented' | 'not-listed';
  lon: number;
  lat: number;
  worldX: number;
  worldY: number;
};

type SerializedBbox = [number, number, number, number];

export type CanonicalPropertyGroup = {
  nodeClass: NodeClass;
  groupKind: GroupKind;
  primaryPropertyId: string;
  pointCount: number;
  propertyIds: string[];
  previewPropertyIds: string[];
  coordinate: [number, number];
  bbox: SerializedBbox | null;
  activeListingCount: number;
  completedListingCount: number;
  socialCount: number;
  recentSocialCount: number;
  socialScoreTotal: number;
  socialScoreMax: number;
  recentSocialScoreTotal: number;
  commentCount: number;
  address: string | null;
  city: string | null;
  askingPrice: number | null;
  thumbnailUrl: string | null;
  hasActiveListing: boolean | null;
  marketState: 'for-sale' | 'for-rent' | 'sold' | 'rented' | 'not-listed' | null;
  ownerTile: TileId;
  anchorWorldX: number;
  anchorWorldY: number;
};

type SinglePropertyDetail = {
  address: string;
  city: string;
  askingPrice: number | null;
  thumbnailUrl: string | null;
  hasActiveListing: boolean;
  marketState: 'for-sale' | 'for-rent' | 'sold' | 'rented' | 'not-listed';
};

type MemberAggregateSummary = {
  propertyIds: string[];
  previewPropertyIds: string[];
  bbox: SerializedBbox | null;
  activeListingCount: number;
  completedListingCount: number;
  socialCount: number;
  recentSocialCount: number;
  socialScoreTotal: number;
  socialScoreMax: number;
  recentSocialScoreTotal: number;
  commentCount: number;
};

type SpatialHashEntry = {
  candidate: GroupingCandidate;
  radiusUnits: number;
};

type ActiveOccupancy = {
  x: number;
  y: number;
  radiusUnits: number;
};

type ActiveOccupancySpatialIndex = {
  cellSize: number;
  cells: Map<string, ActiveOccupancy[]>;
};

type ClusterBuilderConfig = {
  maxRadiusUnits: number;
  gapUnits: number;
  getRadiusUnits: (candidate: GroupingCandidate) => number;
};

type NearbyResolution = CanonicalPropertyGroup & {
  distanceMeters: number;
};

type GroupingCandidateFetcher = (
  boundsList: TileBBox[],
  zoom: number,
  filters: MapFilters,
  options?: PropertyTileBuildOptions
) => Promise<GroupingCandidate[]>;

type RadiusStop = readonly [threshold: number, radiusPx: number];

type CanonicalGroupCacheEntry = {
  expiresAt: number;
  groups: CanonicalPropertyGroup[];
};

type SharedCanonicalBuild = {
  promise: Promise<CanonicalPropertyGroup[]>;
  controller: AbortController;
  activeWaiters: number;
  uncancellableStage: boolean;
};

export type PropertyTileGroupingOptions = PropertyTileBuildOptions & {
  clusterPropertyIdRetention?: 'complete' | 'preview-only';
};

const CANONICAL_GROUP_CACHE_TTL_MS = 30_000;
const CANONICAL_GROUP_CACHE_MAX_ENTRIES = 1_024;
const canonicalGroupCache = new Map<string, CanonicalGroupCacheEntry>();
const pendingCanonicalGroupBuilds = new Map<string, SharedCanonicalBuild>();
const pendingUnhydratedCanonicalGroupBuilds = new Map<string, SharedCanonicalBuild>();

export function resetCanonicalGroupCacheForTests(): void {
  canonicalGroupCache.clear();
  for (const build of pendingCanonicalGroupBuilds.values()) {
    build.controller.abort(new PropertyTileBuildAbortedError());
  }
  for (const build of pendingUnhydratedCanonicalGroupBuilds.values()) {
    build.controller.abort(new PropertyTileBuildAbortedError());
  }
  pendingCanonicalGroupBuilds.clear();
  pendingUnhydratedCanonicalGroupBuilds.clear();
}

export type TileTransportFeature = {
  lon: number;
  lat: number;
  node_class: NodeClass;
  group_kind: GroupKind;
  primary_property_id: string;
  point_count: number;
  property_ids: string;
  preview_property_ids: string;
  membership_complete: boolean;
  read_state_coverage: 'complete' | 'partial';
  bbox_west: number | null;
  bbox_south: number | null;
  bbox_east: number | null;
  bbox_north: number | null;
  activeListingCount: number;
  completedListingCount: number;
  socialCount: number;
  recentSocialCount: number;
  socialScoreTotal: number;
  socialScoreMax: number;
  recentSocialScoreTotal: number;
  commentCount: number;
  address: string | null;
  city: string | null;
  askingPrice: number | null;
  thumbnailUrl: string | null;
  hasActiveListing: boolean | null;
  marketState: 'for-sale' | 'for-rent' | 'sold' | 'rented' | 'not-listed' | null;
  id: string | null;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function getStepRadius(pointCount: number, stops: readonly RadiusStop[]): number {
  let radius = stops[0][1];
  for (const [threshold, stopRadius] of stops) {
    if (pointCount >= threshold) {
      radius = stopRadius;
    }
  }
  return radius;
}

export function getActiveSingleRadiusPx(activityScore: number): number {
  void activityScore;
  return ACTIVE_FOOTPRINT.singleRadiusPx;
}

export function getActiveClusterRadiusPx(_pointCount: number): number {
  return ACTIVE_FOOTPRINT.clusterRadiusPx;
}

export function getGhostSingleRadiusPx(): number {
  return GHOST_FOOTPRINT.singleRadiusPx;
}

export function getGhostClusterRadiusPx(pointCount: number): number {
  return getStepRadius(pointCount, GHOST_FOOTPRINT.clusterRadiusStopsPx);
}

function getActiveGroupingRadiusPx(activityScore: number): number {
  return Math.max(getActiveSingleRadiusPx(activityScore), getActiveClusterRadiusPx(2));
}

function getGhostGroupingRadiusPx(): number {
  return Math.max(getGhostSingleRadiusPx(), getGhostClusterRadiusPx(2));
}

function pxToTileUnits(px: number): number {
  return px * TILE_UNITS_PER_PX;
}

function validateStatementTimeoutMs(timeoutMs: number | undefined): number | null {
  if (timeoutMs == null) return null;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return null;
  return Math.floor(timeoutMs);
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function assertTileBuildCanContinue(
  options: PropertyTileBuildOptions | undefined,
  startedAt: number,
  stage: string
): void {
  if (options?.signal?.aborted) {
    throw new PropertyTileBuildAbortedError(`Property tile build aborted during ${stage}`);
  }

  const now = Date.now();
  if (options?.runtimeDeadlineMs != null && now > options.runtimeDeadlineMs) {
    throw new PropertyTileBudgetExceededError(
      `Property tile runtime budget exceeded during ${stage}`
    );
  }

  const budgetStartedAt = options?.runtimeStartedAtMs ?? startedAt;
  if (options?.runtimeBudgetMs != null && now - budgetStartedAt > options.runtimeBudgetMs) {
    throw new PropertyTileBudgetExceededError(
      `Property tile runtime budget exceeded during ${stage}`
    );
  }
}

function recordTileStageTiming(
  options: PropertyTileBuildOptions | undefined,
  stage: string,
  startedAtMs: number,
  itemCount?: number
): void {
  if (!options?.onStageTiming) return;

  const finishedAtMs = Date.now();
  options.onStageTiming({
    stage,
    startedAtMs,
    finishedAtMs,
    durationMs: Math.max(0, finishedAtMs - startedAtMs),
    itemCount,
  });
}

function countRowsForTiming<TRow>(
  options: PropertyTileBuildOptions | undefined,
  rows: Iterable<TRow>
): number | undefined {
  if (!options?.onStageTiming) return undefined;
  return Array.isArray(rows) ? rows.length : undefined;
}

async function timeTileStage<T>(
  options: PropertyTileBuildOptions | undefined,
  stage: string,
  run: () => Promise<T>,
  getItemCount?: (result: T) => number | undefined
): Promise<T> {
  const startedAtMs = Date.now();
  try {
    const result = await run();
    recordTileStageTiming(options, stage, startedAtMs, getItemCount?.(result));
    return result;
  } catch (error) {
    recordTileStageTiming(options, `${stage}:error`, startedAtMs);
    throw error;
  }
}

function getSharedCanonicalBudgetMs(): number {
  return parsePositiveIntegerEnv(
    'PROPERTY_TILE_SHARED_CANONICAL_BUDGET_MS',
    getPropertyTileRuntimeConfig().publicBudgetMs || DEFAULT_SHARED_CANONICAL_BUDGET_MS
  );
}

function buildSharedCanonicalOptions(
  options: PropertyTileGroupingOptions | undefined,
  sharedBuild: SharedCanonicalBuild
): PropertyTileGroupingOptions {
  const now = Date.now();
  if (!options) {
    return {
      signal: sharedBuild.controller.signal,
      markUncancellableStage: (active) => {
        markSharedCanonicalUncancellableStage(sharedBuild, active);
      },
    };
  }

  const sharedBudgetMs = getSharedCanonicalBudgetMs();
  const callerStartedAtMs = options.runtimeStartedAtMs ?? now;
  const callerDeadlineMs =
    options.runtimeDeadlineMs ??
    (options.runtimeBudgetMs == null ? undefined : callerStartedAtMs + options.runtimeBudgetMs);
  const callerRemainingMs =
    callerDeadlineMs == null ? undefined : Math.max(1, callerDeadlineMs - now);
  const runtimeBudgetMs = Math.min(sharedBudgetMs, callerRemainingMs ?? sharedBudgetMs);
  const statementTimeoutMs =
    options.statementTimeoutMs == null
      ? runtimeBudgetMs
      : Math.min(runtimeBudgetMs, options.statementTimeoutMs);
  const runtimeDeadlineMs =
    callerDeadlineMs == null
      ? now + runtimeBudgetMs
      : Math.min(callerDeadlineMs, now + runtimeBudgetMs);

  return {
    statementTimeoutMs,
    runtimeBudgetMs,
    runtimeStartedAtMs: now,
    runtimeDeadlineMs,
    signal: sharedBuild.controller.signal,
    clusterPropertyIdRetention: options.clusterPropertyIdRetention,
    candidateSnapshotId: options.candidateSnapshotId,
    onStageTiming: options.onStageTiming,
    markUncancellableStage: (active) => {
      options.markUncancellableStage?.(active);
      markSharedCanonicalUncancellableStage(sharedBuild, active);
    },
  };
}

function createSharedCanonicalBuild(
  options: PropertyTileGroupingOptions | undefined,
  build: (sharedOptions: PropertyTileGroupingOptions) => Promise<CanonicalPropertyGroup[]>
): SharedCanonicalBuild {
  const sharedBuild: SharedCanonicalBuild = {
    promise: Promise.resolve([]),
    controller: new AbortController(),
    activeWaiters: 0,
    uncancellableStage: false,
  };
  sharedBuild.promise = build(buildSharedCanonicalOptions(options, sharedBuild));
  return sharedBuild;
}

function markSharedCanonicalUncancellableStage(
  sharedBuild: SharedCanonicalBuild,
  active: boolean
): void {
  sharedBuild.uncancellableStage = active;
  maybeAbortObsoleteSharedCanonicalBuild(sharedBuild);
}

function maybeAbortObsoleteSharedCanonicalBuild(sharedBuild: SharedCanonicalBuild): void {
  if (
    sharedBuild.activeWaiters === 0 &&
    !sharedBuild.uncancellableStage &&
    !sharedBuild.controller.signal.aborted
  ) {
    sharedBuild.controller.abort(new PropertyTileBuildAbortedError());
  }
}

async function waitForSharedCanonicalBuild(
  sharedBuild: SharedCanonicalBuild,
  options: PropertyTileBuildOptions | undefined,
  stage: string
): Promise<CanonicalPropertyGroup[]> {
  assertTileBuildCanContinue(options, Date.now(), stage);
  sharedBuild.activeWaiters += 1;
  try {
    const groups = await waitForSharedCanonicalBuildOrCallerAbort(sharedBuild, options, stage);
    assertTileBuildCanContinue(options, Date.now(), stage);
    return groups;
  } finally {
    sharedBuild.activeWaiters = Math.max(0, sharedBuild.activeWaiters - 1);
    maybeAbortObsoleteSharedCanonicalBuild(sharedBuild);
  }
}

async function waitForSharedCanonicalBuildOrCallerAbort(
  sharedBuild: SharedCanonicalBuild,
  options: PropertyTileBuildOptions | undefined,
  stage: string
): Promise<CanonicalPropertyGroup[]> {
  if (!options?.signal && options?.runtimeDeadlineMs == null) {
    return sharedBuild.promise;
  }

  let timeout: NodeJS.Timeout | null = null;
  let abortHandler: (() => void) | null = null;

  const callerAbortPromise = new Promise<never>((_, reject) => {
    if (options.signal) {
      abortHandler = () => {
        reject(new PropertyTileBuildAbortedError(`Property tile build aborted during ${stage}`));
      };
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    if (options.runtimeDeadlineMs != null) {
      const remainingMs = options.runtimeDeadlineMs - Date.now();
      if (remainingMs <= 0) {
        reject(
          new PropertyTileBudgetExceededError(
            `Property tile runtime budget exceeded during ${stage}`
          )
        );
        return;
      }
      timeout = setTimeout(() => {
        reject(
          new PropertyTileBudgetExceededError(
            `Property tile runtime budget exceeded during ${stage}`
          )
        );
      }, remainingMs);
    }
  });

  try {
    return await Promise.race([sharedBuild.promise, callerAbortPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (abortHandler) {
      options.signal?.removeEventListener('abort', abortHandler);
    }
  }
}

async function executeWithTileStatementTimeout<TRow>(
  query: SQL,
  options: PropertyTileBuildOptions | undefined,
  configure?: (tx: DbTransaction) => Promise<void>,
  stage = 'tile SQL execution'
): Promise<Iterable<TRow>> {
  assertTileBuildCanContinue(options, Date.now(), 'tile SQL preparation');
  const startedAtMs = Date.now();
  const timeoutMs = validateStatementTimeoutMs(options?.statementTimeoutMs);
  if (!timeoutMs && !configure) {
    options?.markUncancellableStage?.(true);
    try {
      const rows = (await db.execute<Record<string, unknown>>(query)) as Iterable<TRow>;
      recordTileStageTiming(options, stage, startedAtMs, countRowsForTiming(options, rows));
      return rows;
    } catch (error) {
      recordTileStageTiming(options, `${stage}:error`, startedAtMs);
      throw error;
    } finally {
      options?.markUncancellableStage?.(false);
    }
  }

  options?.markUncancellableStage?.(true);
  try {
    const rows = await db.transaction(async (tx) => {
      if (configure) {
        await configure(tx);
      }
      if (timeoutMs) {
        await tx.execute(sql`SELECT set_config('statement_timeout', ${`${timeoutMs}ms`}, true)`);
      }
      return (await tx.execute<Record<string, unknown>>(query)) as Iterable<TRow>;
    });
    recordTileStageTiming(options, stage, startedAtMs, countRowsForTiming(options, rows));
    return rows;
  } catch (error) {
    recordTileStageTiming(options, `${stage}:error`, startedAtMs);
    throw error;
  } finally {
    options?.markUncancellableStage?.(false);
  }
}

function lonToNormalizedX(lon: number): number {
  return (lon + 180) / 360;
}

function latToNormalizedY(lat: number): number {
  const sinLat = Math.sin((clamp(lat, -85.05112878, 85.05112878) * Math.PI) / 180);
  return 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
}

function normalizedXToLon(normalizedX: number): number {
  return normalizedX * 360 - 180;
}

function normalizedYToLat(normalizedY: number): number {
  const mercN = Math.PI * (1 - 2 * normalizedY);
  return (180 / Math.PI) * Math.atan(Math.sinh(mercN));
}

export function lngLatToWorldUnits(lon: number, lat: number, zoom: number): [number, number] {
  const scale = Math.pow(2, zoom) * PROPERTY_TILE_EXTENT;
  return [lonToNormalizedX(lon) * scale, latToNormalizedY(lat) * scale];
}

function worldUnitsToLngLat(worldX: number, worldY: number, zoom: number): [number, number] {
  const scale = Math.pow(2, zoom) * PROPERTY_TILE_EXTENT;
  return [normalizedXToLon(worldX / scale), normalizedYToLat(worldY / scale)];
}

function tileWorldBounds(tile: TileId) {
  return {
    minWorldX: tile.x * PROPERTY_TILE_EXTENT,
    maxWorldX: (tile.x + 1) * PROPERTY_TILE_EXTENT,
    minWorldY: tile.y * PROPERTY_TILE_EXTENT,
    maxWorldY: (tile.y + 1) * PROPERTY_TILE_EXTENT,
  };
}

function getBufferedTileWorldBounds(tile: TileId, bufferUnits: number): WorldBBox {
  const bounds = tileWorldBounds(tile);
  return {
    minWorldX: bounds.minWorldX - bufferUnits,
    minWorldY: bounds.minWorldY - bufferUnits,
    maxWorldX: bounds.maxWorldX + bufferUnits,
    maxWorldY: bounds.maxWorldY + bufferUnits,
  };
}

export function tileToBBox(tile: TileId): TileBBox {
  const [minLon, maxLat] = worldUnitsToLngLat(
    tile.x * PROPERTY_TILE_EXTENT,
    tile.y * PROPERTY_TILE_EXTENT,
    tile.z
  );
  const [maxLon, minLat] = worldUnitsToLngLat(
    (tile.x + 1) * PROPERTY_TILE_EXTENT,
    (tile.y + 1) * PROPERTY_TILE_EXTENT,
    tile.z
  );

  return { minLon, minLat, maxLon, maxLat };
}

function getBufferedTileBBox(tile: TileId, bufferUnits: number): TileBBox {
  const bounds = tileWorldBounds(tile);
  const [minLon, maxLat] = worldUnitsToLngLat(
    bounds.minWorldX - bufferUnits,
    bounds.minWorldY - bufferUnits,
    tile.z
  );
  const [maxLon, minLat] = worldUnitsToLngLat(
    bounds.maxWorldX + bufferUnits,
    bounds.maxWorldY + bufferUnits,
    tile.z
  );

  return { minLon, minLat, maxLon, maxLat };
}

export function getGroupingBufferUnits(): number {
  const maxActiveRadius = getActiveGroupingRadiusPx(100);
  const maxGhostRadius = getGhostGroupingRadiusPx();
  const maxActiveSeedOwnedClusterSpanPx =
    2 * (getActiveClusterRadiusPx(2) + ACTIVE_GROUPING_GAP_PX + getActiveClusterRadiusPx(2));
  const maxActiveSuppressionRadius =
    maxActiveRadius + GHOST_SUPPRESSION_PADDING_PX + maxGhostRadius;
  const maxGhostSeedAndNeighborRadius = maxGhostRadius + maxGhostRadius + GHOST_GROUPING_GAP_PX;

  // A seed-owned active cluster can span two active pair thresholds from a tile edge:
  // one pair to reach the seed, another to reach the furthest owned member.
  return pxToTileUnits(
    Math.max(
      maxActiveSeedOwnedClusterSpanPx,
      maxActiveSuppressionRadius,
      maxGhostSeedAndNeighborRadius
    ) + 16
  );
}

export function shouldFetchGhostCandidates(zoom: number): boolean {
  return zoom >= GHOST_NODE_REVEAL_ZOOM;
}

function compareCandidatePriority(a: GroupingCandidate, b: GroupingCandidate): number {
  return (
    b.socialScore - a.socialScore ||
    Number(b.hasActiveListing) - Number(a.hasActiveListing) ||
    Number(b.hasCompletedListing) - Number(a.hasCompletedListing) ||
    b.commentCount - a.commentCount ||
    a.id.localeCompare(b.id)
  );
}

function isGhostCandidate(candidate: GroupingCandidate): boolean {
  return (
    !candidate.hasActiveListing &&
    !candidate.hasCompletedListing &&
    candidate.socialScore < ACTIVE_SOCIAL_SCORE_THRESHOLD
  );
}

function hasActiveSocialSignal(candidate: GroupingCandidate): boolean {
  return candidate.socialScore >= ACTIVE_SOCIAL_SCORE_THRESHOLD;
}

function hasRecentActiveSocialSignal(candidate: GroupingCandidate): boolean {
  return candidate.recentSocialScore >= ACTIVE_SOCIAL_SCORE_THRESHOLD;
}

function serializeBbox(candidates: readonly GroupingCandidate[]): SerializedBbox {
  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate.lon < minLon) minLon = candidate.lon;
    if (candidate.lat < minLat) minLat = candidate.lat;
    if (candidate.lon > maxLon) maxLon = candidate.lon;
    if (candidate.lat > maxLat) maxLat = candidate.lat;
  }

  return [minLon, minLat, maxLon, maxLat];
}

function summarizeOrderedMembers(
  orderedMembers: readonly GroupingCandidate[],
  propertyIdsLimit: number | null
): MemberAggregateSummary {
  const propertyIds: string[] = [];
  const previewPropertyIds: string[] = [];
  let activeListingCount = 0;
  let completedListingCount = 0;
  let socialCount = 0;
  let recentSocialCount = 0;
  let socialScoreTotal = 0;
  let socialScoreMax = Number.NEGATIVE_INFINITY;
  let recentSocialScoreTotal = 0;
  let commentCount = 0;

  for (const member of orderedMembers) {
    if (propertyIdsLimit == null || propertyIds.length < propertyIdsLimit) {
      propertyIds.push(member.id);
    }
    if (previewPropertyIds.length < PROPERTY_PREVIEW_MEMBER_LIMIT) {
      previewPropertyIds.push(member.id);
    }
    if (member.hasActiveListing) activeListingCount += 1;
    if (member.hasCompletedListing) completedListingCount += 1;
    if (hasActiveSocialSignal(member)) socialCount += 1;
    if (hasRecentActiveSocialSignal(member)) recentSocialCount += 1;
    socialScoreTotal += member.socialScore;
    if (member.socialScore > socialScoreMax) {
      socialScoreMax = member.socialScore;
    }
    recentSocialScoreTotal += member.recentSocialScore;
    commentCount += member.commentCount;
  }

  return {
    propertyIds,
    previewPropertyIds,
    bbox: orderedMembers.length > 1 ? serializeBbox(orderedMembers) : null,
    activeListingCount,
    completedListingCount,
    socialCount,
    recentSocialCount,
    socialScoreTotal,
    socialScoreMax: Number.isFinite(socialScoreMax) ? socialScoreMax : 0,
    recentSocialScoreTotal,
    commentCount,
  };
}

function getCellKey(x: number, y: number, cellSize: number): string {
  return `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
}

function buildSpatialHash(
  candidates: GroupingCandidate[],
  cellSize: number,
  getRadiusUnits: (candidate: GroupingCandidate) => number,
  options?: PropertyTileBuildOptions,
  startedAt = Date.now()
): Map<string, SpatialHashEntry[]> {
  const index = new Map<string, SpatialHashEntry[]>();
  candidates.forEach((candidate, indexInLoop) => {
    if (indexInLoop % 128 === 0) {
      assertTileBuildCanContinue(options, startedAt, 'spatial hash build');
    }
    const key = getCellKey(candidate.worldX, candidate.worldY, cellSize);
    const bucket = index.get(key);
    const entry = { candidate, radiusUnits: getRadiusUnits(candidate) };
    if (bucket) {
      bucket.push(entry);
    } else {
      index.set(key, [entry]);
    }
  });
  return index;
}

function buildActiveOccupancySpatialIndex(
  activeOccupancies: ActiveOccupancy[],
  ghostRadiusUnits: number,
  options?: PropertyTileBuildOptions,
  startedAt = Date.now()
): ActiveOccupancySpatialIndex | null {
  if (activeOccupancies.length === 0) {
    return null;
  }

  let maxSuppressionRadiusUnits = ghostRadiusUnits;
  for (let index = 0; index < activeOccupancies.length; index += 1) {
    if (index % 128 === 0) {
      assertTileBuildCanContinue(options, startedAt, 'active occupancy spatial index');
    }
    maxSuppressionRadiusUnits = Math.max(
      maxSuppressionRadiusUnits,
      activeOccupancies[index].radiusUnits + ghostRadiusUnits
    );
  }

  const cells = new Map<string, ActiveOccupancy[]>();
  const cellSize = Math.max(maxSuppressionRadiusUnits, 1);
  for (let index = 0; index < activeOccupancies.length; index += 1) {
    if (index % 128 === 0) {
      assertTileBuildCanContinue(options, startedAt, 'active occupancy spatial index');
    }
    const occupancy = activeOccupancies[index];
    const key = getCellKey(occupancy.x, occupancy.y, cellSize);
    const bucket = cells.get(key);
    if (bucket) {
      bucket.push(occupancy);
    } else {
      cells.set(key, [occupancy]);
    }
  }

  return { cellSize, cells };
}

function isSuppressedByActiveOccupancy(
  candidate: GroupingCandidate,
  ghostRadiusUnits: number,
  index: ActiveOccupancySpatialIndex | null,
  options?: PropertyTileBuildOptions,
  startedAt = Date.now()
): boolean {
  if (!index) {
    return false;
  }

  const cellX = Math.floor(candidate.worldX / index.cellSize);
  const cellY = Math.floor(candidate.worldY / index.cellSize);
  let occupancyChecks = 0;

  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const bucket = index.cells.get(`${cellX + dx}:${cellY + dy}`);
      if (!bucket) continue;

      for (const occupancy of bucket) {
        occupancyChecks += 1;
        if (occupancyChecks % 512 === 0) {
          assertTileBuildCanContinue(options, startedAt, 'ghost suppression');
        }
        const dxWorld = candidate.worldX - occupancy.x;
        const dyWorld = candidate.worldY - occupancy.y;
        const threshold = occupancy.radiusUnits + ghostRadiusUnits;
        if (dxWorld * dxWorld + dyWorld * dyWorld <= threshold * threshold) {
          return true;
        }
      }
    }
  }

  return false;
}

function clusterCandidates(
  candidates: GroupingCandidate[],
  config: ClusterBuilderConfig,
  options?: PropertyTileBuildOptions,
  startedAt = Date.now()
): GroupingCandidate[][] {
  if (candidates.length === 0) return [];

  assertTileBuildCanContinue(options, startedAt, 'candidate clustering');
  const orderedSeeds = [...candidates].sort(compareCandidatePriority);
  const cellSize = config.maxRadiusUnits * 2 + config.gapUnits;
  const spatialHash = buildSpatialHash(
    candidates,
    cellSize,
    config.getRadiusUnits,
    options,
    startedAt
  );
  const assigned = new Set<string>();
  const groups: GroupingCandidate[][] = [];

  for (let seedIndex = 0; seedIndex < orderedSeeds.length; seedIndex += 1) {
    const seed = orderedSeeds[seedIndex];
    if (seedIndex % 128 === 0) {
      assertTileBuildCanContinue(options, startedAt, 'candidate clustering');
    }
    if (assigned.has(seed.id)) continue;

    assigned.add(seed.id);
    const seedRadius = config.getRadiusUnits(seed);
    const cellX = Math.floor(seed.worldX / cellSize);
    const cellY = Math.floor(seed.worldY / cellSize);
    const group: GroupingCandidate[] = [seed];

    let nearbyCandidateChecks = 0;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = spatialHash.get(`${cellX + dx}:${cellY + dy}`);
        if (!bucket) continue;

        for (const entry of bucket) {
          nearbyCandidateChecks += 1;
          if (nearbyCandidateChecks % 512 === 0) {
            assertTileBuildCanContinue(options, startedAt, 'candidate clustering');
          }
          if (assigned.has(entry.candidate.id)) continue;
          const dxWorld = seed.worldX - entry.candidate.worldX;
          const dyWorld = seed.worldY - entry.candidate.worldY;
          const threshold = seedRadius + entry.radiusUnits + config.gapUnits;
          if (dxWorld * dxWorld + dyWorld * dyWorld <= threshold * threshold) {
            assigned.add(entry.candidate.id);
            group.push(entry.candidate);
          }
        }
      }
    }

    groups.push(group);
  }

  return groups;
}

function selectRepresentativeAnchor(members: readonly GroupingCandidate[]): GroupingCandidate {
  const centerX = members.reduce((sum, member) => sum + member.worldX, 0) / members.length;
  const centerY = members.reduce((sum, member) => sum + member.worldY, 0) / members.length;
  let best = members[0];
  let bestDistance = Math.hypot(best.worldX - centerX, best.worldY - centerY);

  for (let index = 1; index < members.length; index += 1) {
    const candidate = members[index];
    const distance = Math.hypot(candidate.worldX - centerX, candidate.worldY - centerY);
    if (
      distance < bestDistance ||
      (distance === bestDistance && compareCandidatePriority(candidate, best) < 0)
    ) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

function worldToOwnerTile(worldX: number, worldY: number, zoom: number): TileId {
  const tileCount = Math.pow(2, zoom);
  return {
    z: zoom,
    x: clamp(Math.floor(worldX / PROPERTY_TILE_EXTENT), 0, tileCount - 1),
    y: clamp(Math.floor(worldY / PROPERTY_TILE_EXTENT), 0, tileCount - 1),
  };
}

function getTileNeighborhood(tile: TileId): TileId[] {
  const tileCount = Math.pow(2, tile.z);
  const tiles: TileId[] = [];
  const seen = new Set<string>();

  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const x = (tile.x + dx + tileCount) % tileCount;
      const y = tile.y + dy;
      if (y < 0 || y >= tileCount) continue;

      const key = `${x}:${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tiles.push({ z: tile.z, x, y });
    }
  }

  return tiles;
}

function tileKey(tile: TileId): string {
  return `${tile.z}:${tile.x}:${tile.y}`;
}

function getPropertyTilePyramidReadMaxZoom(): number {
  const raw = process.env.PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM;
  if (raw == null || raw.trim() === '') {
    return DEFAULT_PROPERTY_TILE_PYRAMID_MAX_ZOOM;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(22, parsed) : DEFAULT_PROPERTY_TILE_PYRAMID_MAX_ZOOM;
}

function buildCanonicalGroupCacheKey(
  tile: TileId,
  filters: MapFilters,
  options?: PropertyTileGroupingOptions
): string {
  return [
    `${tile.z}/${tile.x}/${tile.y}`,
    getMapFilterSignature(filters),
    options?.clusterPropertyIdRetention ?? 'complete',
    options?.candidateSnapshotId ?? 'current',
  ].join(':');
}

function pruneCanonicalGroupCache(now = Date.now()): void {
  for (const [key, entry] of canonicalGroupCache) {
    if (entry.expiresAt <= now) {
      canonicalGroupCache.delete(key);
    }
  }
}

function getCachedCanonicalGroups(
  tile: TileId,
  filters: MapFilters,
  options?: PropertyTileGroupingOptions
): CanonicalPropertyGroup[] | null {
  const now = Date.now();
  const cacheKey = buildCanonicalGroupCacheKey(tile, filters, options);
  const entry = canonicalGroupCache.get(cacheKey);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= now) {
    canonicalGroupCache.delete(cacheKey);
    return null;
  }

  canonicalGroupCache.delete(cacheKey);
  canonicalGroupCache.set(cacheKey, entry);
  return entry.groups;
}

function setCachedCanonicalGroups(
  tile: TileId,
  filters: MapFilters,
  groups: CanonicalPropertyGroup[],
  options?: PropertyTileGroupingOptions
): void {
  const now = Date.now();
  const cacheKey = buildCanonicalGroupCacheKey(tile, filters, options);

  pruneCanonicalGroupCache(now);
  if (canonicalGroupCache.has(cacheKey)) {
    canonicalGroupCache.delete(cacheKey);
  }

  while (canonicalGroupCache.size >= CANONICAL_GROUP_CACHE_MAX_ENTRIES) {
    const oldestKey = canonicalGroupCache.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }
    canonicalGroupCache.delete(oldestKey);
  }

  canonicalGroupCache.set(cacheKey, {
    expiresAt: now + CANONICAL_GROUP_CACHE_TTL_MS,
    groups,
  });
}

function buildStateList(states: readonly MapMarketState[]): SQL {
  return sql`(${sql.join(
    states.map((state) => sql`${state}`),
    sql`, `
  )})`;
}

function buildScopedPricePredicate(
  marketStateColumn: SQL,
  effectivePriceColumn: SQL,
  impactedStates: readonly MapMarketState[],
  unaffectedStates: readonly MapMarketState[],
  operator: '>=' | '<=',
  value: number
): SQL {
  return sql`(
    ${marketStateColumn} IN ${buildStateList(unaffectedStates)}
    OR (
      ${marketStateColumn} IN ${buildStateList(impactedStates)}
      AND ${effectivePriceColumn} ${sql.raw(operator)} ${value}
    )
  )`;
}

function hasPriceFilters(filters: MapFilters): boolean {
  return (
    filters.salePriceFrom != null ||
    filters.salePriceTo != null ||
    filters.rentPriceFrom != null ||
    filters.rentPriceTo != null
  );
}

function buildActivityWindowPredicate(column: SQL, activity: MapFilters['activity']): SQL {
  if (activity === 'today') {
    return sql`${column} > NOW() - INTERVAL '24 hours'`;
  }

  if (activity === '10d') {
    return sql`${column} > NOW() - INTERVAL '10 days'`;
  }

  if (activity === '30d') {
    return sql`${column} > NOW() - INTERVAL '30 days'`;
  }

  return sql`TRUE`;
}

function buildBulkMarketStatePredicate(filters: MapFilters, alias = 'lf'): SQL {
  if (filters.marketState.length === MAP_MARKET_STATES.length) {
    return sql`TRUE`;
  }

  return sql`${sql.raw(`${alias}.market_state`)} IN ${buildStateList(filters.marketState)}`;
}

function buildPriceFilterPredicate(filters: MapFilters, alias = 'lf'): SQL {
  const predicates: SQL[] = [];
  const marketStateColumn = sql.raw(`${alias}.market_state`);
  const saleEffectivePriceColumn = sql.raw(`${alias}.sale_effective_price`);
  const rentEffectivePriceColumn = sql.raw(`${alias}.rent_effective_price`);
  const saleStates: readonly MapMarketState[] = ['for-sale', 'sold', 'not-listed'];
  const rentStates: readonly MapMarketState[] = ['for-rent', 'rented'];

  if (filters.marketState.length !== MAP_MARKET_STATES.length) {
    predicates.push(sql`${marketStateColumn} IN ${buildStateList(filters.marketState)}`);
  }

  if (filters.salePriceFrom != null) {
    predicates.push(
      buildScopedPricePredicate(
        marketStateColumn,
        saleEffectivePriceColumn,
        saleStates,
        rentStates,
        '>=',
        filters.salePriceFrom
      )
    );
  }

  if (filters.salePriceTo != null) {
    predicates.push(
      buildScopedPricePredicate(
        marketStateColumn,
        saleEffectivePriceColumn,
        saleStates,
        rentStates,
        '<=',
        filters.salePriceTo
      )
    );
  }

  if (filters.rentPriceFrom != null) {
    predicates.push(
      buildScopedPricePredicate(
        marketStateColumn,
        rentEffectivePriceColumn,
        rentStates,
        saleStates,
        '>=',
        filters.rentPriceFrom
      )
    );
  }

  if (filters.rentPriceTo != null) {
    predicates.push(
      buildScopedPricePredicate(
        marketStateColumn,
        rentEffectivePriceColumn,
        rentStates,
        saleStates,
        '<=',
        filters.rentPriceTo
      )
    );
  }

  return predicates.length > 0 ? sql`${sql.join(predicates, sql` AND `)}` : sql`TRUE`;
}

async function fetchNearbyEmittedGroups(
  lon: number,
  lat: number,
  zoom: number,
  filters: MapFilters,
  fetchCandidates: GroupingCandidateFetcher,
  options?: PropertyTileBuildOptions
): Promise<CanonicalPropertyGroup[]> {
  const startedAt = Date.now();
  const [worldX, worldY] = lngLatToWorldUnits(lon, lat, zoom);
  const tapTile = worldToOwnerTile(worldX, worldY, zoom);
  const tiles = getTileNeighborhood(tapTile);
  const bufferUnits = getGroupingBufferUnits();
  const tileBounds = tiles.map((tile) => ({
    tile,
    worldBounds: getBufferedTileWorldBounds(tile, bufferUnits),
  }));
  const candidates = await fetchCandidates(
    tiles.map((tile) => getBufferedTileBBox(tile, bufferUnits)),
    zoom,
    filters,
    options
  );
  const candidatesByTile = new Map<string, GroupingCandidate[]>();
  for (const { tile } of tileBounds) {
    candidatesByTile.set(tileKey(tile), []);
  }

  candidates.forEach((candidate, candidateIndex) => {
    if (candidateIndex % 128 === 0) {
      assertTileBuildCanContinue(options, startedAt, 'nearby emitted group bucketing');
    }
    for (const { tile, worldBounds } of tileBounds) {
      if (
        candidate.worldX < worldBounds.minWorldX ||
        candidate.worldX > worldBounds.maxWorldX ||
        candidate.worldY < worldBounds.minWorldY ||
        candidate.worldY > worldBounds.maxWorldY
      ) {
        continue;
      }

      candidatesByTile.get(tileKey(tile))!.push(candidate);
    }
  });

  const tileGroups = tileBounds.flatMap(({ tile }) =>
    groupCandidatesForTile(tile, candidatesByTile.get(tileKey(tile)) ?? [], options)
  );

  return hydrateSinglePropertyDetails(tileGroups, options);
}

function buildCanonicalGroup(
  members: GroupingCandidate[],
  nodeClass: NodeClass,
  zoom: number,
  options?: PropertyTileGroupingOptions
): CanonicalPropertyGroup {
  const orderedMembers = [...members].sort(compareCandidatePriority);
  const anchor = selectRepresentativeAnchor(orderedMembers);
  const ownerTile = worldToOwnerTile(anchor.worldX, anchor.worldY, zoom);
  const propertyIdsLimit =
    options?.clusterPropertyIdRetention === 'preview-only' && members.length > 1 ? 0 : null;
  const summary = summarizeOrderedMembers(orderedMembers, propertyIdsLimit);
  const primaryProperty = anchor;

  return {
    nodeClass,
    groupKind: members.length > 1 ? 'cluster' : 'single',
    primaryPropertyId: primaryProperty.id,
    pointCount: members.length,
    propertyIds: summary.propertyIds,
    previewPropertyIds: summary.previewPropertyIds,
    coordinate: [anchor.lon, anchor.lat],
    bbox: summary.bbox,
    activeListingCount: summary.activeListingCount,
    completedListingCount: summary.completedListingCount,
    socialCount: summary.socialCount,
    recentSocialCount: summary.recentSocialCount,
    socialScoreTotal: summary.socialScoreTotal,
    socialScoreMax: summary.socialScoreMax,
    recentSocialScoreTotal: summary.recentSocialScoreTotal,
    commentCount: summary.commentCount,
    address: null,
    city: null,
    askingPrice: null,
    thumbnailUrl: null,
    hasActiveListing: primaryProperty.hasActiveListing,
    marketState: primaryProperty.marketState,
    ownerTile,
    anchorWorldX: anchor.worldX,
    anchorWorldY: anchor.worldY,
  };
}

function getActiveOccupancyRadiusUnits(group: CanonicalPropertyGroup): number {
  const pxRadius =
    group.groupKind === 'cluster'
      ? getActiveClusterRadiusPx(group.pointCount)
      : getActiveSingleRadiusPx(group.socialScoreMax);
  return pxToTileUnits(pxRadius + GHOST_SUPPRESSION_PADDING_PX);
}

function getNearbyHitRadiusUnits(group: CanonicalPropertyGroup): number {
  const pxRadius =
    group.nodeClass === 'ghost'
      ? group.groupKind === 'cluster'
        ? getGhostClusterRadiusPx(group.pointCount)
        : getGhostSingleRadiusPx()
      : group.groupKind === 'cluster'
        ? getActiveClusterRadiusPx(group.pointCount)
        : getActiveSingleRadiusPx(group.socialScoreMax);

  return pxToTileUnits(pxRadius + NEARBY_TAP_TOLERANCE_PX);
}

function toCandidate(row: GroupingCandidateRow, zoom: number): GroupingCandidate {
  const [worldX, worldY] = lngLatToWorldUnits(row.lon, row.lat, zoom);
  return {
    id: row.id,
    hasActiveListing: Boolean(row.has_active_listing),
    hasCompletedListing: Boolean(row.has_completed_listing),
    socialScore: Number(row.social_score),
    commentCount: Number(row.comment_count),
    recentSocialScore: Number(row.recent_social_score),
    marketState: row.market_state,
    lon: row.lon,
    lat: row.lat,
    worldX,
    worldY,
  };
}

function buildBoundsFilter(boundsList: TileBBox[], geometryColumn: SQL): SQL {
  return sql.join(
    boundsList.map(
      (bounds) => sql`${geometryColumn} && ST_MakeEnvelope(
          ${bounds.minLon},
          ${bounds.minLat},
          ${bounds.maxLon},
          ${bounds.maxLat},
          4326
        )`
    ),
    sql` OR `
  );
}

function buildListingOrderExpression(alias: string): SQL {
  return canonicalListingFactOrderExpression(alias);
}

function buildTileListingPriceTypeExpression(listingAlias: string): SQL {
  return sql`
    CASE
      WHEN lower(${sql.raw(`${listingAlias}.source_name`)}) = 'funda'
        AND lower(btrim(${sql.raw(`${listingAlias}.price_type`)})) = 'buy'
        THEN 'sale'
      WHEN lower(btrim(${sql.raw(`${listingAlias}.price_type`)})) IN ('sale', 'rent')
        THEN lower(btrim(${sql.raw(`${listingAlias}.price_type`)}))
      WHEN lower(${sql.raw(`${listingAlias}.source_name`)}) = 'pararius'
        THEN 'rent'
      ELSE 'sale'
    END
  `;
}

function buildTileListingFactsCte(scopeCteName: 'candidate_properties' | 'target_properties'): SQL {
  return sql`
    tile_listing_facts AS MATERIALIZED (
      SELECT
        cl.id AS listing_id,
        cl.property_id,
        cl.source_name,
        cl.status::text AS status,
        ${buildTileListingPriceTypeExpression('cl')} AS normalized_price_type,
        cl.asking_price,
        cl.first_seen_at AS listed_at,
        cl.living_area_m2,
        cl.thumbnail_url,
        cl.verification_state,
        cl.origin_summary,
        cl.submitted_by,
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
      INNER JOIN ${sql.raw(scopeCteName)} sp ON sp.id = cl.property_id
      WHERE cl.verification_state <> 'invalid'
    )
  `;
}

function candidateSnapshotFilter(alias: string, options?: PropertyTileBuildOptions): SQL {
  const requestedSnapshotId = options?.candidateSnapshotId ?? null;
  const snapshotIdColumn = sql.raw(`${alias}.snapshot_id`);
  return requestedSnapshotId
    ? sql`${snapshotIdColumn} = ${requestedSnapshotId}::uuid`
    : sql`${snapshotIdColumn} = (
        SELECT c."snapshot_id"
        FROM property_tile_candidate_source_current c
        WHERE c."coverage_id" = 'public_default_low_zoom'
          AND c."filter_signature" = 'default'
          AND c."pyramid_kind" = 'public_default_low_zoom'
        LIMIT 1
      )`;
}

function buildTileListingFactsProjectionCte(options?: PropertyTileBuildOptions): SQL {
  if (!options?.candidateSnapshotId) {
    return sql`
      latest_listing AS MATERIALIZED (
        SELECT DISTINCT ON (cl.property_id)
          cl.property_id,
          cl.status::text AS status
        FROM canonical_listings cl
        INNER JOIN candidate_properties cp ON cp.id = cl.property_id
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
          ${buildTileListingPriceTypeExpression('cl')} AS price_type
        FROM canonical_listings cl
        INNER JOIN candidate_properties cp ON cp.id = cl.property_id
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
      ),
      listing_facts AS MATERIALIZED (
        SELECT
          cp.id AS property_id,
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
          NULL::bigint AS sale_effective_price,
          NULL::bigint AS rent_effective_price
        FROM candidate_properties cp
        LEFT JOIN latest_listing ON latest_listing.property_id = cp.id
        LEFT JOIN active_listing ON active_listing.property_id = cp.id
      )
    `;
  }

  return sql`
    listing_facts AS MATERIALIZED (
      SELECT
        cp.id AS property_id,
        COALESCE(ptlf.has_active_listing, FALSE) AS has_active_listing,
        COALESCE(ptlf.has_completed_listing, FALSE) AS has_completed_listing,
        COALESCE(ptlf.market_state, 'not-listed') AS market_state,
        NULL::bigint AS sale_effective_price,
        NULL::bigint AS rent_effective_price
      FROM candidate_properties cp
      LEFT JOIN property_tile_listing_facts ptlf
        ON ptlf.property_id = cp.id
       AND ${candidateSnapshotFilter('ptlf', options)}
    )
  `;
}

export function buildGroupingCandidateScopeCtes(
  boundsList: TileBBox[],
  includeGhostCandidates: boolean,
  filters: MapFilters,
  zoom: number,
  options?: PropertyTileBuildOptions
): SQL {
  const bboxFilter = buildBoundsFilter(boundsList, sql.raw('p.geometry'));
  const listingCandidateBboxFilter = buildBoundsFilter(boundsList, sql.raw('lpc.geometry'));
  const activityCandidateFilter = buildActivityWindowPredicate(
    sql.raw('activity_at'),
    filters.activity
  );
  const activeBoundedPropertyFilter = sql`p.geometry IS NOT NULL
            AND p.status = 'active'
            AND (${bboxFilter})`;
  const canIncludeSocialOnlyCandidates = filters.marketState.includes('not-listed');
  const useSourceFirstCandidateScope =
    options?.candidateSnapshotId != null
    && !includeGhostCandidates
    && zoom <= SOURCE_FIRST_CANDIDATE_SCOPE_MAX_ZOOM;
  const useBoundedSocialCandidateScope = useSourceFirstCandidateScope && zoom >= 14;

  if (includeGhostCandidates) {
    return sql`
        candidate_properties AS MATERIALIZED (
          SELECT
            p.id,
            p.geometry,
            p.official_valuation
          FROM properties p
          WHERE p.geometry IS NOT NULL
            AND p.status = 'active'
            AND (${bboxFilter})
        )
      `;
  }

  if (!useSourceFirstCandidateScope) {
    return sql`
        bounded_properties AS MATERIALIZED (
          SELECT
            p.id,
            p.geometry,
            p.official_valuation
          FROM properties p
          WHERE p.geometry IS NOT NULL
            AND p.status = 'active'
            AND (${bboxFilter})
        ),
        listing_candidate_ids AS MATERIALIZED (
          SELECT DISTINCT cl.property_id
          FROM canonical_listings cl
          INNER JOIN bounded_properties bp ON bp.id = cl.property_id
          WHERE cl.verification_state <> 'invalid'
            AND cl.status IN ('active', 'sold', 'rented')
        )
        ${
          canIncludeSocialOnlyCandidates
            ? sql`,
        social_activity_candidate_ids AS MATERIALIZED (
          SELECT property_id
          FROM (
            SELECT c.property_id
            FROM (
              SELECT c.property_id, c.created_at AS activity_at
              FROM comments c
              INNER JOIN bounded_properties bp ON bp.id = c.property_id
            ) c
            WHERE ${activityCandidateFilter}
            UNION ALL
            SELECT r.property_id
            FROM (
              SELECT r.target_id AS property_id, r.created_at AS activity_at
              FROM reactions r
              INNER JOIN bounded_properties bp ON bp.id = r.target_id
              WHERE r.target_type = 'property'
                AND r.reaction_type = 'like'
            ) r
            WHERE ${activityCandidateFilter}
            UNION ALL
            SELECT rc.property_id
            FROM (
                SELECT c.property_id, r.created_at AS activity_at
                FROM reactions r
                INNER JOIN comments c ON c.id = r.target_id
                INNER JOIN bounded_properties bp ON bp.id = c.property_id
                WHERE r.target_type = 'comment'
                  AND r.reaction_type = 'like'
              ) rc
            WHERE ${activityCandidateFilter}
            UNION ALL
            SELECT pg.property_id
            FROM (
              SELECT
                pg.property_id,
                GREATEST(pg.created_at, pg.updated_at) AS activity_at
              FROM price_guesses pg
              INNER JOIN bounded_properties bp ON bp.id = pg.property_id
            ) pg
            WHERE ${activityCandidateFilter}
            UNION ALL
            SELECT pv.property_id
            FROM (
              SELECT
                pv.property_id,
                MAX(pv.viewed_at) AS activity_at
              FROM property_views pv
              INNER JOIN bounded_properties bp ON bp.id = pv.property_id
              GROUP BY pv.property_id
              HAVING COUNT(DISTINCT COALESCE(pv.user_id::text, pv.session_id)) >= 8
            ) pv
            WHERE ${activityCandidateFilter}
          ) social_candidates
        ),
        candidate_property_ids AS MATERIALIZED (
          SELECT DISTINCT property_id
          FROM (
            SELECT property_id
            FROM listing_candidate_ids
            UNION ALL
            SELECT property_id
            FROM social_activity_candidate_ids
          ) candidate_ids
        )`
            : sql``
        },
        candidate_properties AS MATERIALIZED (
          SELECT
            bp.id,
            bp.geometry,
            bp.official_valuation
          FROM ${
            canIncludeSocialOnlyCandidates
              ? sql`candidate_property_ids cpi`
              : sql`listing_candidate_ids cpi`
          }
          INNER JOIN bounded_properties bp ON bp.id = cpi.property_id
        )
      `;
  }

  return sql`
        listing_candidate_properties AS MATERIALIZED (
          SELECT
            lpc.property_id AS id,
            lpc.geometry,
            lpc.official_valuation
          FROM property_tile_listing_candidates lpc
          WHERE ${listingCandidateBboxFilter}
            AND ${candidateSnapshotFilter('lpc', options)}
        )
        ${
          canIncludeSocialOnlyCandidates && useBoundedSocialCandidateScope
            ? sql`,
        bounded_social_properties AS MATERIALIZED (
          SELECT
            p.id,
            p.geometry,
            p.official_valuation
          FROM properties p
          WHERE ${activeBoundedPropertyFilter}
        )`
            : sql``
        }
        ${
          canIncludeSocialOnlyCandidates
            ? sql`,
        social_activity_candidate_ids AS MATERIALIZED (
          SELECT property_id
          FROM (
            SELECT c.property_id
            FROM (
              SELECT c.property_id, c.created_at AS activity_at
              FROM comments c
              ${
                useBoundedSocialCandidateScope
                  ? sql`INNER JOIN bounded_social_properties p ON p.id = c.property_id`
                  : sql`INNER JOIN properties p ON p.id = c.property_id
              WHERE ${activeBoundedPropertyFilter}`
              }
            ) c
            WHERE ${activityCandidateFilter}
            UNION ALL
            SELECT r.property_id
            FROM (
              SELECT r.target_id AS property_id, r.created_at AS activity_at
              FROM reactions r
              ${
                useBoundedSocialCandidateScope
                  ? sql`INNER JOIN bounded_social_properties p ON p.id = r.target_id`
                  : sql`INNER JOIN properties p ON p.id = r.target_id
              WHERE ${activeBoundedPropertyFilter}`
              }
                AND r.target_type = 'property'
                AND r.reaction_type = 'like'
            ) r
            WHERE ${activityCandidateFilter}
            UNION ALL
            SELECT rc.property_id
            FROM (
                SELECT c.property_id, r.created_at AS activity_at
                FROM reactions r
                INNER JOIN comments c ON c.id = r.target_id
                ${
                  useBoundedSocialCandidateScope
                    ? sql`INNER JOIN bounded_social_properties p ON p.id = c.property_id`
                    : sql`INNER JOIN properties p ON p.id = c.property_id
                WHERE ${activeBoundedPropertyFilter}`
                }
                  AND r.target_type = 'comment'
                  AND r.reaction_type = 'like'
              ) rc
            WHERE ${activityCandidateFilter}
            UNION ALL
            SELECT pg.property_id
            FROM (
              SELECT
                pg.property_id,
                GREATEST(pg.created_at, pg.updated_at) AS activity_at
              FROM price_guesses pg
              ${
                useBoundedSocialCandidateScope
                  ? sql`INNER JOIN bounded_social_properties p ON p.id = pg.property_id`
                  : sql`INNER JOIN properties p ON p.id = pg.property_id
              WHERE ${activeBoundedPropertyFilter}`
              }
            ) pg
            WHERE ${activityCandidateFilter}
            UNION ALL
            SELECT pv.property_id
            FROM (
              SELECT
                pv.property_id,
                MAX(pv.viewed_at) AS activity_at
              FROM property_views pv
              ${
                useBoundedSocialCandidateScope
                  ? sql`INNER JOIN bounded_social_properties p ON p.id = pv.property_id`
                  : sql`INNER JOIN properties p ON p.id = pv.property_id
              WHERE ${activeBoundedPropertyFilter}`
              }
              GROUP BY pv.property_id
              HAVING COUNT(DISTINCT COALESCE(pv.user_id::text, pv.session_id)) >= 8
            ) pv
            WHERE ${activityCandidateFilter}
          ) social_candidates
        ),
        social_only_candidate_ids AS MATERIALIZED (
          SELECT DISTINCT social_activity_candidate_ids.property_id
          FROM social_activity_candidate_ids
          WHERE NOT EXISTS (
            SELECT 1
            FROM listing_candidate_properties lcp
            WHERE lcp.id = social_activity_candidate_ids.property_id
          )
        )`
            : sql``
        },
        candidate_properties AS MATERIALIZED (
          ${
            canIncludeSocialOnlyCandidates
              ? sql`
          SELECT
            lcp.id,
            lcp.geometry,
            lcp.official_valuation
          FROM listing_candidate_properties lcp
          UNION ALL
          SELECT
            p.id,
            p.geometry,
            p.official_valuation
          FROM social_only_candidate_ids soci
          ${
            useBoundedSocialCandidateScope
              ? sql`INNER JOIN bounded_social_properties p ON p.id = soci.property_id`
              : sql`INNER JOIN properties p ON p.id = soci.property_id
          WHERE ${activeBoundedPropertyFilter}`
          }`
              : sql`
          SELECT
            lcp.id,
            lcp.geometry,
            lcp.official_valuation
          FROM listing_candidate_properties lcp`
          }
        )
      `;
}

async function fetchGroupingCandidatesInBBox(
  bounds: TileBBox,
  zoom: number,
  includeGhostCandidates: boolean,
  filters: MapFilters,
  options?: PropertyTileBuildOptions
): Promise<GroupingCandidate[]> {
  return fetchGroupingCandidatesInBBoxes([bounds], zoom, includeGhostCandidates, filters, options);
}

async function fetchGroupingCandidatesInBBoxes(
  boundsList: TileBBox[],
  zoom: number,
  includeGhostCandidates: boolean,
  filters: MapFilters,
  options?: PropertyTileBuildOptions
): Promise<GroupingCandidate[]> {
  const startedAt = Date.now();
  assertTileBuildCanContinue(options, startedAt, 'candidate fetch preparation');
  const activityFilterPredicate = buildActivityFilterPredicate(filters.activity, 'sf');
  const candidateVisibilityFilter = includeGhostCandidates
    ? sql`TRUE`
    : sql`(
        COALESCE(lf.has_active_listing, FALSE)
        OR COALESCE(lf.has_completed_listing, FALSE)
        OR COALESCE(sf.social_score, 0) >= ${ACTIVE_SOCIAL_SCORE_THRESHOLD}
      )`;
  const marketStatePredicate = buildBulkMarketStatePredicate(filters, 'lf');
  const includeEffectivePrices = hasPriceFilters(filters);
  const priceFilterPredicate = includeEffectivePrices
    ? buildPriceFilterPredicate(filters, 'lf')
    : sql`TRUE`;
  const candidateScopeCtes = buildGroupingCandidateScopeCtes(
    boundsList,
    includeGhostCandidates,
    filters,
    zoom,
    options
  );
  const listingFactsCtes = includeEffectivePrices
    ? sql`
        ${buildTileListingFactsCte('candidate_properties')},
        latest_listing AS MATERIALIZED (
          SELECT DISTINCT ON (l.property_id)
            l.property_id,
            l.status
          FROM tile_listing_facts l
          ORDER BY l.property_id, ${buildListingOrderExpression('l')}
        ),
        active_listing AS MATERIALIZED (
          SELECT DISTINCT ON (l.property_id)
            l.property_id,
            l.asking_price,
            l.normalized_price_type AS price_type
          FROM tile_listing_facts l
          WHERE l.status = 'active'
          ORDER BY l.property_id, ${buildListingOrderExpression('l')}
        ),
        sold_history AS MATERIALIZED (
          SELECT DISTINCT ON (ph.property_id)
            ph.property_id,
            ph.price AS last_sold_price
          FROM price_history ph
          INNER JOIN candidate_properties cp ON cp.id = ph.property_id
          WHERE ph.event_type = 'sold'
          ORDER BY ph.property_id, ph.price_date DESC, ph.created_at DESC, ph.id DESC
        ),
        rented_history AS MATERIALIZED (
          SELECT DISTINCT ON (ph.property_id)
            ph.property_id,
            ph.price AS last_rented_price
          FROM price_history ph
          INNER JOIN candidate_properties cp ON cp.id = ph.property_id
          WHERE ph.event_type = 'rented'
          ORDER BY ph.property_id, ph.price_date DESC, ph.created_at DESC, ph.id DESC
        ),
        guess_facts AS MATERIALIZED (
          SELECT
            lpg.property_id,
            CASE
              WHEN COUNT(*) = 0 THEN NULL::bigint
              WHEN COUNT(*) <= 2 THEN ROUND(
                CASE
                  WHEN cp.official_valuation IS NOT NULL
                    THEN cp.official_valuation::numeric * 0.7
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
                  WHEN cp.official_valuation IS NOT NULL
                    THEN cp.official_valuation::numeric * 0.3
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
          INNER JOIN candidate_properties cp ON cp.id = lpg.property_id
          WHERE lpg.is_meme_guess = FALSE
          GROUP BY lpg.property_id, cp.official_valuation
        ),
        listing_facts AS MATERIALIZED (
          SELECT
            cp.id AS property_id,
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
              cp.official_valuation
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
          FROM candidate_properties cp
          LEFT JOIN latest_listing ON latest_listing.property_id = cp.id
          LEFT JOIN active_listing ON active_listing.property_id = cp.id
          LEFT JOIN sold_history ON sold_history.property_id = cp.id
          LEFT JOIN rented_history ON rented_history.property_id = cp.id
          LEFT JOIN guess_facts ON guess_facts.property_id = cp.id
        )
      `
    : buildTileListingFactsProjectionCte(options);

  const rows = await executeWithTileStatementTimeout<GroupingCandidateRow>(
    sql`
      WITH ${candidateScopeCtes},
      latest_public_guesses AS MATERIALIZED (
        SELECT DISTINCT ON (pg.property_id, pg.user_id)
          pg.property_id,
          pg.user_id,
        pg.guessed_price,
        pg.is_meme_guess,
        GREATEST(pg.created_at, pg.updated_at) AS effective_at
      FROM price_guesses pg
      INNER JOIN candidate_properties cp ON cp.id = pg.property_id
      ORDER BY
        pg.property_id,
        pg.user_id,
        GREATEST(pg.created_at, pg.updated_at) DESC,
        pg.created_at DESC,
        pg.id DESC
    ),
    ${listingFactsCtes},
    guess_activity AS MATERIALIZED (
      SELECT
        lpg.property_id,
        COUNT(*)::int AS guess_count,
        COUNT(*) FILTER (
          WHERE lpg.effective_at > NOW() - INTERVAL '7 days'
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
          WHERE c.created_at > NOW() - INTERVAL '7 days'
        )::int AS recent_count,
        MAX(c.created_at) AS latest
      FROM comments c
      INNER JOIN candidate_properties cp ON cp.id = c.property_id
      WHERE c.parent_id IS NULL
      GROUP BY c.property_id
    ),
    replies AS MATERIALIZED (
      SELECT
        c.property_id,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (
          WHERE c.created_at > NOW() - INTERVAL '7 days'
        )::int AS recent_count,
        MAX(c.created_at) AS latest
      FROM comments c
      INNER JOIN candidate_properties cp ON cp.id = c.property_id
      WHERE c.parent_id IS NOT NULL
      GROUP BY c.property_id
    ),
    property_likes AS MATERIALIZED (
      SELECT
        r.target_id AS property_id,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (
          WHERE r.created_at > NOW() - INTERVAL '7 days'
        )::int AS recent_count,
        MAX(r.created_at) AS latest
      FROM reactions r
      INNER JOIN candidate_properties cp ON cp.id = r.target_id
      WHERE r.target_type = 'property'
        AND r.reaction_type = 'like'
      GROUP BY r.target_id
    ),
    comment_likes AS MATERIALIZED (
      SELECT
        c.property_id,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (
          WHERE r.created_at > NOW() - INTERVAL '7 days'
        )::int AS recent_count,
        MAX(r.created_at) AS latest
      FROM reactions r
      INNER JOIN comments c ON c.id = r.target_id
      INNER JOIN candidate_properties cp ON cp.id = c.property_id
      WHERE r.target_type = 'comment'
        AND r.reaction_type = 'like'
      GROUP BY c.property_id
    ),
    view_facts AS MATERIALIZED (
      SELECT
        pv.property_id,
        COUNT(*)::int AS view_count,
        COUNT(*) FILTER (
          WHERE pv.viewed_at > NOW() - INTERVAL '7 days'
        )::int AS recent_view_count,
        COUNT(DISTINCT COALESCE(pv.user_id::text, pv.session_id))::int AS unique_viewer_count,
        COUNT(DISTINCT COALESCE(pv.user_id::text, pv.session_id)) FILTER (
          WHERE pv.viewed_at > NOW() - INTERVAL '7 days'
        )::int AS recent_unique_viewer_count,
        MAX(pv.viewed_at) AS latest
      FROM property_views pv
      INNER JOIN candidate_properties cp ON cp.id = pv.property_id
      GROUP BY pv.property_id
    ),
    social_facts AS MATERIALIZED (
      SELECT
        cp.id AS property_id,
        COALESCE(top_level_comments.count, 0)::int AS top_level_comment_count,
        COALESCE(replies.count, 0)::int AS reply_count,
        COALESCE(property_likes.count, 0)::int AS property_like_count,
        COALESCE(comment_likes.count, 0)::int AS comment_like_count,
        COALESCE(guess_activity.guess_count, 0)::int AS guess_count,
        COALESCE(view_facts.view_count, 0)::int AS view_count,
        COALESCE(view_facts.unique_viewer_count, 0)::int AS unique_viewer_count,
        COALESCE(top_level_comments.recent_count, 0)::int AS recent_top_level_comment_count,
        COALESCE(replies.recent_count, 0)::int AS recent_reply_count,
        COALESCE(property_likes.recent_count, 0)::int AS recent_property_like_count,
        COALESCE(comment_likes.recent_count, 0)::int AS recent_comment_like_count,
        COALESCE(guess_activity.recent_guess_count, 0)::int AS recent_guess_count,
        COALESCE(view_facts.recent_view_count, 0)::int AS recent_view_count,
        COALESCE(view_facts.recent_unique_viewer_count, 0)::int AS recent_unique_viewer_count,
        (
          COALESCE(top_level_comments.count, 0)::double precision
          + COALESCE(replies.count, 0)::double precision
          + COALESCE(property_likes.count, 0)::double precision
          + COALESCE(comment_likes.count, 0)::double precision * 0.8
          + COALESCE(guess_activity.guess_count, 0)::double precision * 0.85
          + COALESCE(view_facts.unique_viewer_count, 0)::double precision * 0.1
        )::double precision AS social_score,
        (
          COALESCE(top_level_comments.recent_count, 0)::double precision
          + COALESCE(replies.recent_count, 0)::double precision
          + COALESCE(property_likes.recent_count, 0)::double precision
          + COALESCE(comment_likes.recent_count, 0)::double precision * 0.8
          + COALESCE(guess_activity.recent_guess_count, 0)::double precision * 0.85
          + COALESCE(view_facts.recent_unique_viewer_count, 0)::double precision * 0.1
        )::double precision AS recent_social_score,
        GREATEST(
          top_level_comments.latest,
          replies.latest,
          property_likes.latest,
          comment_likes.latest,
          guess_activity.latest_guess_at,
          view_facts.latest
        ) AS last_social_at
      FROM candidate_properties cp
      LEFT JOIN top_level_comments ON top_level_comments.property_id = cp.id
      LEFT JOIN replies ON replies.property_id = cp.id
      LEFT JOIN property_likes ON property_likes.property_id = cp.id
      LEFT JOIN comment_likes ON comment_likes.property_id = cp.id
      LEFT JOIN guess_activity ON guess_activity.property_id = cp.id
      LEFT JOIN view_facts ON view_facts.property_id = cp.id
    )
    SELECT
      cp.id,
      ST_X(cp.geometry) AS lon,
      ST_Y(cp.geometry) AS lat,
      COALESCE(lf.has_active_listing, FALSE) AS has_active_listing,
      COALESCE(lf.has_completed_listing, FALSE) AS has_completed_listing,
      COALESCE(sf.social_score, 0)::double precision AS social_score,
      COALESCE(sf.recent_social_score, 0)::double precision AS recent_social_score,
      (
        COALESCE(sf.top_level_comment_count, 0)
        + COALESCE(sf.reply_count, 0)
      )::int AS comment_count,
      lf.market_state
      FROM candidate_properties cp
      INNER JOIN listing_facts lf ON lf.property_id = cp.id
      INNER JOIN social_facts sf ON sf.property_id = cp.id
      WHERE ${marketStatePredicate}
        AND ${priceFilterPredicate}
        AND ${activityFilterPredicate}
        AND ${candidateVisibilityFilter}
    `,
    options,
    async (tx) => {
      await tx.execute(sql`SET LOCAL jit = off`);
    },
    'candidate SQL'
  );

  return Array.from(rows).map((row, index) => {
    if (index % 128 === 0) {
      assertTileBuildCanContinue(options, startedAt, 'candidate fetch mapping');
    }
    return toCandidate(row, zoom);
  });
}

async function fetchFollowingGroupingCandidatesInBBoxes(
  viewerId: string,
  boundsList: TileBBox[],
  zoom: number,
  filters: MapFilters,
  options?: PropertyTileBuildOptions
): Promise<GroupingCandidate[]> {
  const startedAt = Date.now();
  assertTileBuildCanContinue(options, startedAt, 'following candidate fetch preparation');
  const marketFilterQuery = buildPropertyMarketFilterQuery(filters, 'p');
  const followingActivity = filters.activity === 'all' ? 'all-time' : filters.activity;
  const activityFilterPredicate = buildActivityFilterPredicate(followingActivity, 'fsf');
  const listingFactsJoin = areMapFiltersDefault(marketFilterQuery.filters)
    ? buildPropertyListingFactsJoin('p', 'lf')
    : marketFilterQuery.join;
  const bboxFilter = sql.join(
    boundsList.map(
      (bounds) => sql`p.geometry && ST_MakeEnvelope(
          ${bounds.minLon},
          ${bounds.minLat},
          ${bounds.maxLon},
          ${bounds.maxLat},
          4326
        )`
    ),
    sql` OR `
  );

  const rows = await executeWithTileStatementTimeout<GroupingCandidateRow>(
    sql`
      SELECT
        p.id,
        ST_X(p.geometry) AS lon,
        ST_Y(p.geometry) AS lat,
        COALESCE(lf.has_active_listing, FALSE) AS has_active_listing,
        (
          COALESCE(lf.has_active_listing, FALSE) = FALSE
          AND lf.market_state IN ('sold', 'rented')
        ) AS has_completed_listing,
        COALESCE(fsf.social_score, 0)::double precision AS social_score,
        COALESCE(fsf.recent_social_score, 0)::double precision AS recent_social_score,
        (
          COALESCE(fsf.top_level_comment_count, 0)
          + COALESCE(fsf.reply_count, 0)
        )::int AS comment_count,
        lf.market_state
      FROM properties p
      ${listingFactsJoin}
      ${buildPropertyFollowingSocialFactsJoin(viewerId, 'p', 'fsf')}
      WHERE p.geometry IS NOT NULL
        AND p.status = 'active'
        AND (${bboxFilter})
        AND ${marketFilterQuery.predicate}
        AND ${activityFilterPredicate}
    `,
    options,
    async (tx) => {
      await tx.execute(sql`SET LOCAL jit = off`);
    },
    'following candidate SQL'
  );

  return Array.from(rows).map((row, index) => {
    if (index % 128 === 0) {
      assertTileBuildCanContinue(options, startedAt, 'following candidate fetch mapping');
    }
    return toCandidate(row, zoom);
  });
}

async function fetchGroupingCandidates(
  tile: TileId,
  filters: MapFilters,
  options?: PropertyTileBuildOptions
): Promise<GroupingCandidate[]> {
  const bufferedBounds = getBufferedTileBBox(tile, getGroupingBufferUnits());
  return fetchGroupingCandidatesInBBox(
    bufferedBounds,
    tile.z,
    shouldFetchGhostCandidates(tile.z),
    filters,
    options
  );
}

async function fetchFollowingGroupingCandidates(
  tile: TileId,
  viewerId: string,
  filters: MapFilters,
  options?: PropertyTileBuildOptions
): Promise<GroupingCandidate[]> {
  const bufferedBounds = getBufferedTileBBox(tile, getGroupingBufferUnits());
  return fetchFollowingGroupingCandidatesInBBoxes(
    viewerId,
    [bufferedBounds],
    tile.z,
    filters,
    options
  );
}

function readStateIdentityPredicate(viewer: PropertyReadViewer): SQL {
  if ('userId' in viewer) {
    return sql`prs.user_id = ${viewer.userId} AND prs.session_id IS NULL`;
  }

  return sql`prs.session_id = ${viewer.sessionId} AND prs.user_id IS NULL`;
}

async function hasCurrentReadStateInTileBounds(
  tile: TileId,
  viewer: PropertyReadViewer,
  options?: PropertyTileBuildOptions
): Promise<boolean> {
  const bounds = getBufferedTileBBox(tile, getGroupingBufferUnits());
  const rows = await executeWithTileStatementTimeout<{ has_read_state: boolean }>(
    sql`
    SELECT EXISTS (
      SELECT 1
      FROM property_read_state prs
      INNER JOIN properties p ON p.id = prs.property_id
      LEFT JOIN property_change_state pcs ON pcs.property_id = prs.property_id
      WHERE ${readStateIdentityPredicate(viewer)}
        AND prs.seen_change_version >= COALESCE(pcs.change_version, 0)
        AND p.geometry IS NOT NULL
        AND p.status = 'active'
        AND p.geometry && ST_MakeEnvelope(
          ${bounds.minLon},
          ${bounds.minLat},
          ${bounds.maxLon},
          ${bounds.maxLat},
          4326
        )
      LIMIT 1
    ) AS has_read_state
    `,
    options,
    undefined,
    'read-state scope SQL'
  );

  return Array.from(rows)[0]?.has_read_state === true;
}

async function fetchSinglePropertyDetails(
  propertyIds: string[],
  options?: PropertyTileBuildOptions
): Promise<Map<string, SinglePropertyDetail>> {
  if (propertyIds.length === 0) {
    return new Map();
  }

  const startedAt = Date.now();
  assertTileBuildCanContinue(options, startedAt, 'single-property hydration preparation');
  const ids = [...new Set(propertyIds)];
  const idList = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `
  );
  const rows = await executeWithTileStatementTimeout<SinglePropertyDetailRow>(
    sql`
    WITH target_properties AS MATERIALIZED (
      SELECT
        p.id,
        p.country_code,
        p.street,
        p.house_number,
        p.house_number_addition,
        p.city,
        p.postal_code
      FROM properties p
      WHERE p.id IN (${idList})
    ),
    ${buildTileListingFactsCte('target_properties')},
    active_listing AS MATERIALIZED (
      SELECT DISTINCT ON (l.property_id)
        l.property_id,
        l.asking_price,
        l.normalized_price_type AS price_type
      FROM tile_listing_facts l
      WHERE l.status = 'active'
      ORDER BY l.property_id, ${buildListingOrderExpression('l')}
    ),
    latest_listing AS MATERIALIZED (
      SELECT DISTINCT ON (l.property_id)
        l.property_id,
        l.status
      FROM tile_listing_facts l
      ORDER BY l.property_id, ${buildListingOrderExpression('l')}
    ),
    listing_thumbnail AS MATERIALIZED (
      SELECT DISTINCT ON (l.property_id)
        l.property_id,
        l.thumbnail_url
      FROM tile_listing_facts l
      WHERE l.thumbnail_url IS NOT NULL
      ORDER BY l.property_id, ${listingThumbnailOrderExpression('l')}
    )
    SELECT
      tp.id,
      tp.country_code,
      tp.street,
      tp.house_number,
      tp.house_number_addition,
      tp.city,
      tp.postal_code,
      active_listing.asking_price,
      listing_thumbnail.thumbnail_url,
      active_listing.property_id IS NOT NULL AS has_active_listing,
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
      END AS market_state
    FROM target_properties tp
    LEFT JOIN active_listing ON active_listing.property_id = tp.id
    LEFT JOIN latest_listing ON latest_listing.property_id = tp.id
    LEFT JOIN listing_thumbnail ON listing_thumbnail.property_id = tp.id
  `,
    options,
    undefined,
    'single-property hydration SQL'
  );

  return new Map(
    Array.from(rows).map((row, index) => {
      if (index % 128 === 0) {
        assertTileBuildCanContinue(options, startedAt, 'single-property hydration mapping');
      }
      const countryCode = row.country_code;
      return [
        row.id,
        {
          address: formatDisplayAddress(
            {
              street: row.street,
              houseNumber: row.house_number,
              houseNumberAddition: row.house_number_addition,
              postalCode: row.postal_code ?? '',
              city: row.city,
            },
            isValidCountryCode(countryCode) ? countryCode : undefined
          ),
          city: row.city,
          askingPrice: row.asking_price != null ? Number(row.asking_price) : null,
          thumbnailUrl: row.thumbnail_url,
          hasActiveListing: row.has_active_listing,
          marketState: row.market_state,
        } satisfies SinglePropertyDetail,
      ];
    })
  );
}

async function hydrateSinglePropertyDetails(
  groups: CanonicalPropertyGroup[],
  options?: PropertyTileBuildOptions
): Promise<CanonicalPropertyGroup[]> {
  const startedAt = Date.now();
  assertTileBuildCanContinue(options, startedAt, 'single-property detail hydration');
  const singleIds = groups
    .filter((group) => group.groupKind === 'single')
    .map((group) => group.primaryPropertyId);

  if (singleIds.length === 0) {
    return groups;
  }

  const detailsById = await fetchSinglePropertyDetails(singleIds, options);

  return groups.map((group, index) => {
    if (index % 128 === 0) {
      assertTileBuildCanContinue(options, startedAt, 'single-property detail mapping');
    }
    if (group.groupKind !== 'single') {
      return group;
    }

    const detail = detailsById.get(group.primaryPropertyId);
    if (!detail) {
      return group;
    }

    return {
      ...group,
      address: detail.address,
      city: detail.city,
      askingPrice: detail.askingPrice,
      thumbnailUrl: detail.thumbnailUrl,
      hasActiveListing: detail.hasActiveListing,
      marketState: detail.marketState,
    };
  });
}

async function filterReadGroupsWithTileOptions<TGroup extends { propertyIds: string[] }>(
  groups: readonly TGroup[],
  viewer: PropertyReadViewer,
  options?: PropertyTileBuildOptions
): Promise<TGroup[]> {
  const startedAt = Date.now();
  assertTileBuildCanContinue(options, startedAt, 'read filtering preparation');
  const timeoutMs = validateStatementTimeoutMs(options?.statementTimeoutMs);
  if (!timeoutMs) {
    const filteredGroups = await filterReadCanonicalGroups(groups, viewer);
    assertTileBuildCanContinue(options, startedAt, 'read filtering');
    return filteredGroups;
  }

  options?.markUncancellableStage?.(true);
  try {
    const filteredGroups = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('statement_timeout', ${`${timeoutMs}ms`}, true)`);
      return filterReadCanonicalGroups(groups, viewer, tx);
    });
    assertTileBuildCanContinue(options, startedAt, 'read filtering');
    return filteredGroups;
  } finally {
    options?.markUncancellableStage?.(false);
  }
}

function buildCanonicalGroupsFromCandidates(
  zoom: number,
  candidates: GroupingCandidate[],
  options?: PropertyTileGroupingOptions
): CanonicalPropertyGroup[] {
  const startedAt = Date.now();
  assertTileBuildCanContinue(options, startedAt, 'canonical grouping preparation');
  const activeCandidates: GroupingCandidate[] = [];
  const ghostCandidates: GroupingCandidate[] = [];
  candidates.forEach((candidate, index) => {
    if (index % 128 === 0) {
      assertTileBuildCanContinue(options, startedAt, 'candidate partitioning');
    }
    if (isGhostCandidate(candidate)) {
      ghostCandidates.push(candidate);
    } else {
      activeCandidates.push(candidate);
    }
  });

  const activeGroups = clusterCandidates(
    activeCandidates,
    {
      maxRadiusUnits: pxToTileUnits(getActiveGroupingRadiusPx(100)),
      gapUnits: pxToTileUnits(ACTIVE_GROUPING_GAP_PX),
      getRadiusUnits: (candidate) =>
        pxToTileUnits(getActiveGroupingRadiusPx(candidate.socialScore)),
    },
    options,
    startedAt
  ).map((members) => buildCanonicalGroup(members, 'active', zoom, options));

  const activeOccupancies = activeGroups.map((group, index) => {
    if (index % 128 === 0) {
      assertTileBuildCanContinue(options, startedAt, 'active occupancy preparation');
    }
    return {
      x: group.anchorWorldX,
      y: group.anchorWorldY,
      radiusUnits: getActiveOccupancyRadiusUnits(group),
    };
  });
  const ghostRadiusUnits = pxToTileUnits(getGhostGroupingRadiusPx());
  const activeOccupancyIndex =
    zoom >= GHOST_NODE_REVEAL_ZOOM && ghostCandidates.length > 0
      ? buildActiveOccupancySpatialIndex(activeOccupancies, ghostRadiusUnits, options, startedAt)
      : null;

  const visibleGhostCandidates =
    zoom >= GHOST_NODE_REVEAL_ZOOM
      ? ghostCandidates.filter((candidate, candidateIndex) => {
          if (candidateIndex % 128 === 0) {
            assertTileBuildCanContinue(options, startedAt, 'ghost suppression');
          }
          return !isSuppressedByActiveOccupancy(
            candidate,
            ghostRadiusUnits,
            activeOccupancyIndex,
            options,
            startedAt
          );
        })
      : [];

  const ghostGroups = clusterCandidates(
    visibleGhostCandidates,
    {
      maxRadiusUnits: pxToTileUnits(getGhostGroupingRadiusPx()),
      gapUnits: pxToTileUnits(GHOST_GROUPING_GAP_PX),
      getRadiusUnits: () => pxToTileUnits(getGhostGroupingRadiusPx()),
    },
    options,
    startedAt
  ).map((members) => buildCanonicalGroup(members, 'ghost', zoom, options));

  return [...activeGroups, ...ghostGroups];
}

export function groupCandidatesForTile(
  tile: TileId,
  candidates: GroupingCandidate[],
  options?: PropertyTileGroupingOptions
): CanonicalPropertyGroup[] {
  const startedAt = Date.now();
  return buildCanonicalGroupsFromCandidates(tile.z, candidates, options).filter((group, index) => {
    if (index % 128 === 0) {
      assertTileBuildCanContinue(options, startedAt, 'owner tile filtering');
    }
    return group.ownerTile.x === tile.x && group.ownerTile.y === tile.y;
  });
}

async function buildUnhydratedCanonicalGroupsForTile(
  tile: TileId,
  filters: MapFilters,
  options?: PropertyTileGroupingOptions
): Promise<CanonicalPropertyGroup[]> {
  const candidates = await timeTileStage(
    options,
    'candidate fetch',
    () => fetchGroupingCandidates(tile, filters, options),
    (result) => result.length
  );
  return timeTileStage(
    options,
    'candidate grouping',
    async () => groupCandidatesForTile(tile, candidates, options),
    (result) => result.length
  );
}

async function buildUnhydratedCanonicalGroupsForTileWithCoalescing(
  tile: TileId,
  filters: MapFilters,
  options?: PropertyTileGroupingOptions
): Promise<CanonicalPropertyGroup[]> {
  assertTileBuildCanContinue(options, Date.now(), 'shared unhydrated canonical grouping');
  const cacheKey = buildCanonicalGroupCacheKey(tile, filters, options);
  const pendingBuild = pendingUnhydratedCanonicalGroupBuilds.get(cacheKey);
  if (pendingBuild) {
    if (pendingBuild.controller.signal.aborted) {
      pendingUnhydratedCanonicalGroupBuilds.delete(cacheKey);
    } else {
      return waitForSharedCanonicalBuild(
        pendingBuild,
        options,
        'shared unhydrated canonical grouping'
      );
    }
  }

  const sharedBuild = createSharedCanonicalBuild(options, (sharedOptions) =>
    buildUnhydratedCanonicalGroupsForTile(tile, filters, sharedOptions)
  );
  pendingUnhydratedCanonicalGroupBuilds.set(cacheKey, sharedBuild);
  sharedBuild.promise.then(
    () => pendingUnhydratedCanonicalGroupBuilds.delete(cacheKey),
    () => pendingUnhydratedCanonicalGroupBuilds.delete(cacheKey)
  );
  return waitForSharedCanonicalBuild(sharedBuild, options, 'shared unhydrated canonical grouping');
}

function getViablePendingCanonicalBuild(cacheKey: string): SharedCanonicalBuild | null {
  const pendingBuild = pendingCanonicalGroupBuilds.get(cacheKey);
  if (!pendingBuild) {
    return null;
  }

  if (pendingBuild.controller.signal.aborted) {
    pendingCanonicalGroupBuilds.delete(cacheKey);
    return null;
  }

  return pendingBuild;
}

async function waitForPendingCanonicalBuild(
  pendingBuild: SharedCanonicalBuild,
  options: PropertyTileBuildOptions | undefined
): Promise<CanonicalPropertyGroup[]> {
  return waitForSharedCanonicalBuild(pendingBuild, options, 'shared canonical grouping');
}

export async function buildCanonicalGroupsForTile(
  tile: TileId,
  filters: MapFilters = createDefaultMapFilters(),
  options?: PropertyTileBuildOptions
): Promise<CanonicalPropertyGroup[]> {
  assertTileBuildCanContinue(options, Date.now(), 'shared canonical grouping');
  const cachedGroups = getCachedCanonicalGroups(tile, filters, options);
  if (cachedGroups) {
    return cachedGroups;
  }

  const cacheKey = buildCanonicalGroupCacheKey(tile, filters, options);
  const pendingBuild = getViablePendingCanonicalBuild(cacheKey);
  if (pendingBuild) {
    return waitForPendingCanonicalBuild(pendingBuild, options);
  }

  const sharedBuild = createSharedCanonicalBuild(options, async (sharedOptions) => {
    const unhydratedGroups = await buildUnhydratedCanonicalGroupsForTileWithCoalescing(
      tile,
      filters,
      sharedOptions
    );
    const groups = await timeTileStage(
      sharedOptions,
      'single-property hydration',
      () => hydrateSinglePropertyDetails(unhydratedGroups, sharedOptions),
      (result) => result.length
    );
    assertTileBuildCanContinue(sharedOptions, Date.now(), 'shared canonical cache publish');
    setCachedCanonicalGroups(tile, filters, groups, options);
    return groups;
  });

  pendingCanonicalGroupBuilds.set(cacheKey, sharedBuild);
  sharedBuild.promise.then(
    () => pendingCanonicalGroupBuilds.delete(cacheKey),
    () => pendingCanonicalGroupBuilds.delete(cacheKey)
  );
  return waitForSharedCanonicalBuild(sharedBuild, options, 'shared canonical grouping');
}

export async function buildCanonicalGroupsForTileUncached(
  tile: TileId,
  filters: MapFilters = createDefaultMapFilters(),
  options?: PropertyTileGroupingOptions
): Promise<CanonicalPropertyGroup[]> {
  const unhydratedGroups = await timeTileStage(
    options,
    'pyramid uncached canonical groups',
    () => buildUnhydratedCanonicalGroupsForTile(tile, filters, options),
    (result) => result.length
  );
  return timeTileStage(
    options,
    'pyramid single-property hydration',
    () => hydrateSinglePropertyDetails(unhydratedGroups, options),
    (result) => result.length
  );
}

export async function buildFollowingCanonicalGroupsForTile(
  tile: TileId,
  viewerId: string,
  filters: MapFilters = createDefaultMapFilters(),
  options?: PropertyTileBuildOptions
): Promise<CanonicalPropertyGroup[]> {
  const candidates = await fetchFollowingGroupingCandidates(tile, viewerId, filters, options);
  const groups = groupCandidatesForTile(tile, candidates, options);
  return hydrateSinglePropertyDetails(groups, options);
}

export async function buildReadCanonicalGroupsForTile(
  tile: TileId,
  viewer: PropertyReadViewer,
  filters: MapFilters = createDefaultMapFilters(),
  options?: PropertyTileBuildOptions
): Promise<CanonicalPropertyGroup[]> {
  if (!(await hasCurrentReadStateInTileBounds(tile, viewer, options))) {
    return [];
  }

  const groupingOptions: PropertyTileGroupingOptions | undefined =
    areMapFiltersDefault(filters) && tile.z <= getPropertyTilePyramidReadMaxZoom()
      ? { ...options, clusterPropertyIdRetention: 'preview-only' }
      : options;

  const cachedGroups = getCachedCanonicalGroups(tile, filters, groupingOptions);
  if (cachedGroups) {
    return filterReadGroupsWithTileOptions(cachedGroups, viewer, groupingOptions);
  }

  const readGroups = await filterReadGroupsWithTileOptions(
    await buildUnhydratedCanonicalGroupsForTileWithCoalescing(tile, filters, groupingOptions),
    viewer,
    groupingOptions
  );

  if (readGroups.length === 0) {
    return [];
  }

  return hydrateSinglePropertyDetails(readGroups, options);
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const earthRadiusM = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const hav =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  return 2 * earthRadiusM * Math.asin(Math.sqrt(hav));
}

export async function resolveNearbyGroupedFeature(
  lon: number,
  lat: number,
  zoom: number,
  filters: MapFilters = createDefaultMapFilters(),
  options?: PropertyTileBuildOptions
): Promise<NearbyResolution | null> {
  const startedAt = Date.now();
  const [worldX, worldY] = lngLatToWorldUnits(lon, lat, zoom);
  const emittedGroups = await fetchNearbyEmittedGroups(
    lon,
    lat,
    zoom,
    filters,
    (boundsList, candidateZoom, candidateFilters) =>
      fetchGroupingCandidatesInBBoxes(
        boundsList,
        candidateZoom,
        shouldFetchGhostCandidates(candidateZoom),
        candidateFilters,
        options
      ),
    options
  );

  const tapCoordinate: [number, number] = [lon, lat];
  let bestMatch: NearbyResolution | null = null;
  let bestDistanceUnits = Number.POSITIVE_INFINITY;

  for (let index = 0; index < emittedGroups.length; index += 1) {
    if (index % 128 === 0) {
      assertTileBuildCanContinue(options, startedAt, 'nearby feature resolution');
    }
    const group = emittedGroups[index];
    const dx = group.anchorWorldX - worldX;
    const dy = group.anchorWorldY - worldY;
    const distanceUnits = Math.hypot(dx, dy);
    if (distanceUnits > getNearbyHitRadiusUnits(group)) continue;
    if (distanceUnits >= bestDistanceUnits) continue;

    bestDistanceUnits = distanceUnits;
    bestMatch = {
      ...group,
      distanceMeters: haversineMeters(tapCoordinate, group.coordinate),
    };
  }

  return bestMatch;
}

export async function resolveNearbyFollowingGroupedFeature(
  lon: number,
  lat: number,
  zoom: number,
  viewerId: string,
  filters: MapFilters = createDefaultMapFilters(),
  options?: PropertyTileBuildOptions
): Promise<NearbyResolution | null> {
  const startedAt = Date.now();
  const [worldX, worldY] = lngLatToWorldUnits(lon, lat, zoom);
  const emittedGroups = await fetchNearbyEmittedGroups(
    lon,
    lat,
    zoom,
    filters,
    (boundsList, candidateZoom, candidateFilters) =>
      fetchFollowingGroupingCandidatesInBBoxes(
        viewerId,
        boundsList,
        candidateZoom,
        candidateFilters,
        options
      ),
    options
  );

  const tapCoordinate: [number, number] = [lon, lat];
  let bestMatch: NearbyResolution | null = null;
  let bestDistanceUnits = Number.POSITIVE_INFINITY;

  for (let index = 0; index < emittedGroups.length; index += 1) {
    if (index % 128 === 0) {
      assertTileBuildCanContinue(options, startedAt, 'nearby following feature resolution');
    }
    const group = emittedGroups[index];
    const dx = group.anchorWorldX - worldX;
    const dy = group.anchorWorldY - worldY;
    const distanceUnits = Math.hypot(dx, dy);
    if (distanceUnits > getNearbyHitRadiusUnits(group)) continue;
    if (distanceUnits >= bestDistanceUnits) continue;

    bestDistanceUnits = distanceUnits;
    bestMatch = {
      ...group,
      distanceMeters: haversineMeters(tapCoordinate, group.coordinate),
    };
  }

  return bestMatch;
}

function shouldOmitClusterPropertyIds(group: CanonicalPropertyGroup, tile?: TileId): boolean {
  if (group.groupKind !== 'cluster') {
    return false;
  }
  if (tile && tile.z <= MVT_CLUSTER_PROPERTY_IDS_LOW_ZOOM_MAX) {
    return true;
  }
  return group.propertyIds.length > MVT_CLUSTER_PROPERTY_IDS_COMPLETE_MAX;
}

function serializePropertyIdsForTile(group: CanonicalPropertyGroup, tile?: TileId): string {
  if (group.groupKind === 'single') {
    return group.primaryPropertyId;
  }
  if (shouldOmitClusterPropertyIds(group, tile)) {
    return '';
  }
  return group.propertyIds.join(',');
}

function isMembershipCompleteForTile(group: CanonicalPropertyGroup, tile?: TileId): boolean {
  return group.groupKind === 'single' || !shouldOmitClusterPropertyIds(group, tile);
}

export function serializeGroupForTile(
  group: CanonicalPropertyGroup,
  tile?: TileId
): TileTransportFeature {
  const bbox = group.bbox;
  const membershipComplete = isMembershipCompleteForTile(group, tile);
  return {
    lon: group.coordinate[0],
    lat: group.coordinate[1],
    node_class: group.nodeClass,
    group_kind: group.groupKind,
    primary_property_id: group.primaryPropertyId,
    point_count: group.pointCount,
    property_ids: serializePropertyIdsForTile(group, tile),
    preview_property_ids: group.previewPropertyIds.join(','),
    membership_complete: membershipComplete,
    read_state_coverage: membershipComplete ? 'complete' : 'partial',
    bbox_west: bbox?.[0] ?? null,
    bbox_south: bbox?.[1] ?? null,
    bbox_east: bbox?.[2] ?? null,
    bbox_north: bbox?.[3] ?? null,
    activeListingCount: group.activeListingCount,
    completedListingCount: group.completedListingCount,
    socialCount: group.socialCount,
    recentSocialCount: group.recentSocialCount,
    socialScoreTotal: group.socialScoreTotal,
    socialScoreMax: group.socialScoreMax,
    recentSocialScoreTotal: group.recentSocialScoreTotal,
    commentCount: group.commentCount,
    address: group.groupKind === 'single' ? group.address : null,
    city: group.groupKind === 'single' ? group.city : null,
    askingPrice: group.groupKind === 'single' ? group.askingPrice : null,
    thumbnailUrl: group.groupKind === 'single' ? group.thumbnailUrl : null,
    hasActiveListing: group.groupKind === 'single' ? group.hasActiveListing : null,
    marketState: group.groupKind === 'single' ? group.marketState : null,
    id: group.groupKind === 'single' ? group.primaryPropertyId : null,
  };
}

function buildMvtFeatureRowsCte(features: TileTransportFeature[]): SQL {
  const rows = sql.join(
    features.map(
      (feature) => sql`(
        ${feature.lon}::double precision,
        ${feature.lat}::double precision,
        ${feature.node_class}::text,
        ${feature.group_kind}::text,
        ${feature.primary_property_id}::text,
        ${feature.point_count}::integer,
        ${feature.property_ids}::text,
        ${feature.preview_property_ids}::text,
        ${feature.membership_complete}::boolean,
        ${feature.read_state_coverage}::text,
        ${feature.bbox_west}::double precision,
        ${feature.bbox_south}::double precision,
        ${feature.bbox_east}::double precision,
        ${feature.bbox_north}::double precision,
        ${feature.activeListingCount}::integer,
        ${feature.completedListingCount}::integer,
        ${feature.socialCount}::integer,
        ${feature.recentSocialCount}::integer,
        ${feature.socialScoreTotal}::double precision,
        ${feature.socialScoreMax}::double precision,
        ${feature.recentSocialScoreTotal}::double precision,
        ${feature.commentCount}::integer,
        ${feature.address}::text,
        ${feature.city}::text,
        ${feature.askingPrice}::bigint,
        ${feature.thumbnailUrl}::text,
        ${feature.hasActiveListing}::boolean,
        ${feature.marketState}::text,
        ${feature.id}::text
      )`
    ),
    sql`, `
  );

  return sql`
    feature_rows (
      lon,
      lat,
      node_class,
      group_kind,
      primary_property_id,
      point_count,
      property_ids,
      preview_property_ids,
      membership_complete,
      read_state_coverage,
      bbox_west,
      bbox_south,
      bbox_east,
      bbox_north,
      "activeListingCount",
      "completedListingCount",
      "socialCount",
      "recentSocialCount",
      "socialScoreTotal",
      "socialScoreMax",
      "recentSocialScoreTotal",
      "commentCount",
      address,
      city,
      "askingPrice",
      "thumbnailUrl",
      "hasActiveListing",
      "marketState",
      id
    ) AS (
      VALUES ${rows}
    )
  `;
}

export async function buildMvtForGroups(
  tile: TileId,
  groups: CanonicalPropertyGroup[],
  options?: PropertyTileBuildOptions
): Promise<Buffer> {
  const startedAt = Date.now();
  assertTileBuildCanContinue(options, startedAt, 'MVT feature preparation');
  if (groups.length === 0) {
    return Buffer.alloc(0);
  }

  const serializedFeatures = groups.map((group, index) => {
    if (index % 128 === 0) {
      assertTileBuildCanContinue(options, startedAt, 'MVT feature construction');
    }
    return serializeGroupForTile(group, tile);
  });
  recordTileStageTiming(options, 'MVT feature construction', startedAt, serializedFeatures.length);
  assertTileBuildCanContinue(options, startedAt, 'MVT SQL preparation');
  const bounds = tileToBBox(tile);
  const result = await executeWithTileStatementTimeout<{ mvt: Buffer }>(
    sql`
    WITH ${buildMvtFeatureRowsCte(serializedFeatures)},
    mvt_data AS (
      SELECT
        ST_AsMVTGeom(
          ST_SetSRID(ST_MakePoint(lon, lat), 4326),
          ST_MakeEnvelope(
            ${bounds.minLon},
            ${bounds.minLat},
            ${bounds.maxLon},
            ${bounds.maxLat},
            4326
          ),
          ${PROPERTY_TILE_EXTENT},
          256,
          true
        ) AS geom,
        node_class,
        group_kind,
        primary_property_id,
        point_count,
        property_ids,
        preview_property_ids,
        membership_complete,
        read_state_coverage,
        bbox_west,
        bbox_south,
        bbox_east,
        bbox_north,
        "activeListingCount",
        "completedListingCount",
        "socialCount",
        "recentSocialCount",
        "socialScoreTotal",
        "socialScoreMax",
        "recentSocialScoreTotal",
        "commentCount",
        address,
        city,
        "askingPrice",
        "thumbnailUrl",
        "hasActiveListing",
        "marketState",
        id
      FROM feature_rows
    )
    SELECT ST_AsMVT(mvt_data, 'properties', ${PROPERTY_TILE_EXTENT}, 'geom') AS mvt
    FROM mvt_data
    WHERE geom IS NOT NULL
  `,
    options,
    undefined,
    'MVT SQL encoding'
  );

  const row = Array.from(result)[0];
  if (!row?.mvt) {
    return Buffer.alloc(0);
  }

  return Buffer.isBuffer(row.mvt) ? row.mvt : Buffer.from(row.mvt);
}

export async function buildMvtForTile(
  tile: TileId,
  filters: MapFilters = createDefaultMapFilters(),
  options?: PropertyTileBuildOptions
): Promise<Buffer> {
  const groups = await timeTileStage(
    options,
    'canonical groups',
    () => buildCanonicalGroupsForTile(tile, filters, options),
    (result) => result.length
  );
  return timeTileStage(
    options,
    'MVT encoding',
    () => buildMvtForGroups(tile, groups, options),
    (result) => result.length
  );
}

export async function buildReadMvtForTile(
  tile: TileId,
  viewer: PropertyReadViewer,
  filters: MapFilters = createDefaultMapFilters(),
  options?: PropertyTileBuildOptions
): Promise<Buffer> {
  const groups = await timeTileStage(
    options,
    'read canonical groups',
    () => buildReadCanonicalGroupsForTile(tile, viewer, filters, options),
    (result) => result.length
  );
  return timeTileStage(
    options,
    'MVT encoding',
    () => buildMvtForGroups(tile, groups, options),
    (result) => result.length
  );
}

export async function buildFollowingMvtForTile(
  tile: TileId,
  viewerId: string,
  filters: MapFilters = createDefaultMapFilters(),
  options?: PropertyTileBuildOptions
): Promise<Buffer> {
  const groups = await timeTileStage(
    options,
    'following canonical groups',
    () => buildFollowingCanonicalGroupsForTile(tile, viewerId, filters, options),
    (result) => result.length
  );
  return timeTileStage(
    options,
    'MVT encoding',
    () => buildMvtForGroups(tile, groups, options),
    (result) => result.length
  );
}
