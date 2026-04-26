import { sql, type SQL } from 'drizzle-orm';
import {
  isValidCountryCode,
  PROPERTY_MAP_FOOTPRINTS,
  PROPERTY_GHOST_REVEAL_ZOOM,
  PROPERTY_PREVIEW_MEMBER_LIMIT,
} from '@huishype/shared/config';
import { db } from '../db/index.js';
import { formatDisplayAddress } from '../utils/address.js';
import {
  ACTIVE_SOCIAL_SCORE_THRESHOLD,
  buildActivityFilterPredicate,
  canonicalListingFactOrderExpression,
  buildPropertyFollowingSocialFactsJoin,
  buildPropertyListingFactsJoin,
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

export const PROPERTY_TILE_EXTENT = 4096;
const TILE_SIZE_PX = 512;
const TILE_UNITS_PER_PX = PROPERTY_TILE_EXTENT / TILE_SIZE_PX;
export const GHOST_NODE_REVEAL_ZOOM = PROPERTY_GHOST_REVEAL_ZOOM;

const ACTIVE_FOOTPRINT = PROPERTY_MAP_FOOTPRINTS.active;
const GHOST_FOOTPRINT = PROPERTY_MAP_FOOTPRINTS.ghost;
const ACTIVE_GROUPING_GAP_PX = ACTIVE_FOOTPRINT.groupingGapPx;
const GHOST_GROUPING_GAP_PX = GHOST_FOOTPRINT.groupingGapPx;
const GHOST_SUPPRESSION_PADDING_PX = GHOST_FOOTPRINT.suppressionPaddingPx;
const NEARBY_TAP_TOLERANCE_PX = PROPERTY_MAP_FOOTPRINTS.nearbyTapTolerancePx;

type NodeClass = 'active' | 'ghost';
type GroupKind = 'single' | 'cluster';

type TileId = {
  z: number;
  x: number;
  y: number;
};

type TileBBox = {
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

type SpatialHashEntry = {
  candidate: GroupingCandidate;
  radiusUnits: number;
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
  filters: MapFilters
) => Promise<GroupingCandidate[]>;

type RadiusStop = readonly [threshold: number, radiusPx: number];

type CanonicalGroupCacheEntry = {
  expiresAt: number;
  groups: CanonicalPropertyGroup[];
};

const CANONICAL_GROUP_CACHE_TTL_MS = 30_000;
const CANONICAL_GROUP_CACHE_MAX_ENTRIES = 1_024;
const canonicalGroupCache = new Map<string, CanonicalGroupCacheEntry>();
const pendingCanonicalGroupBuilds = new Map<string, Promise<CanonicalPropertyGroup[]>>();

export function resetCanonicalGroupCacheForTests(): void {
  canonicalGroupCache.clear();
  pendingCanonicalGroupBuilds.clear();
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

function serializeBbox(candidates: GroupingCandidate[]): SerializedBbox {
  return [
    Math.min(...candidates.map((candidate) => candidate.lon)),
    Math.min(...candidates.map((candidate) => candidate.lat)),
    Math.max(...candidates.map((candidate) => candidate.lon)),
    Math.max(...candidates.map((candidate) => candidate.lat)),
  ];
}

function getCellKey(x: number, y: number, cellSize: number): string {
  return `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
}

function buildSpatialHash(
  candidates: GroupingCandidate[],
  cellSize: number,
  getRadiusUnits: (candidate: GroupingCandidate) => number
): Map<string, SpatialHashEntry[]> {
  const index = new Map<string, SpatialHashEntry[]>();
  for (const candidate of candidates) {
    const key = getCellKey(candidate.worldX, candidate.worldY, cellSize);
    const bucket = index.get(key);
    const entry = { candidate, radiusUnits: getRadiusUnits(candidate) };
    if (bucket) {
      bucket.push(entry);
    } else {
      index.set(key, [entry]);
    }
  }
  return index;
}

function clusterCandidates(
  candidates: GroupingCandidate[],
  config: ClusterBuilderConfig
): GroupingCandidate[][] {
  if (candidates.length === 0) return [];

  const orderedSeeds = [...candidates].sort(compareCandidatePriority);
  const cellSize = config.maxRadiusUnits * 2 + config.gapUnits;
  const spatialHash = buildSpatialHash(candidates, cellSize, config.getRadiusUnits);
  const assigned = new Set<string>();
  const groups: GroupingCandidate[][] = [];

  for (const seed of orderedSeeds) {
    if (assigned.has(seed.id)) continue;

    assigned.add(seed.id);
    const seedRadius = config.getRadiusUnits(seed);
    const cellX = Math.floor(seed.worldX / cellSize);
    const cellY = Math.floor(seed.worldY / cellSize);
    const group: GroupingCandidate[] = [seed];

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = spatialHash.get(`${cellX + dx}:${cellY + dy}`);
        if (!bucket) continue;

        for (const entry of bucket) {
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

function selectRepresentativeAnchor(members: GroupingCandidate[]): GroupingCandidate {
  const centerX = members.reduce((sum, member) => sum + member.worldX, 0) / members.length;
  const centerY = members.reduce((sum, member) => sum + member.worldY, 0) / members.length;
  const byPriority = [...members].sort(compareCandidatePriority);
  const priorityRank = new Map(byPriority.map((member, index) => [member.id, index]));

  return [...members].sort((a, b) => {
    const aDistance = Math.hypot(a.worldX - centerX, a.worldY - centerY);
    const bDistance = Math.hypot(b.worldX - centerX, b.worldY - centerY);
    const aScore = aDistance * 1000 + (priorityRank.get(a.id) ?? 0);
    const bScore = bDistance * 1000 + (priorityRank.get(b.id) ?? 0);
    return aScore - bScore || compareCandidatePriority(a, b);
  })[0];
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

function buildCanonicalGroupCacheKey(tile: TileId, filters: MapFilters): string {
  return `${tile.z}/${tile.x}/${tile.y}:${getMapFilterSignature(filters)}`;
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
  filters: MapFilters
): CanonicalPropertyGroup[] | null {
  const now = Date.now();
  const cacheKey = buildCanonicalGroupCacheKey(tile, filters);
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
  groups: CanonicalPropertyGroup[]
): void {
  const now = Date.now();
  const cacheKey = buildCanonicalGroupCacheKey(tile, filters);

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
  fetchCandidates: GroupingCandidateFetcher
): Promise<CanonicalPropertyGroup[]> {
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
    filters
  );
  const candidatesByTile = new Map<string, GroupingCandidate[]>();
  for (const { tile } of tileBounds) {
    candidatesByTile.set(tileKey(tile), []);
  }

  for (const candidate of candidates) {
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
  }

  const tileGroups = tileBounds.flatMap(({ tile }) =>
    groupCandidatesForTile(tile, candidatesByTile.get(tileKey(tile)) ?? [])
  );

  return hydrateSinglePropertyDetails(tileGroups);
}

function buildCanonicalGroup(
  members: GroupingCandidate[],
  nodeClass: NodeClass,
  zoom: number
): CanonicalPropertyGroup {
  const orderedMembers = [...members].sort(compareCandidatePriority);
  const anchor = selectRepresentativeAnchor(orderedMembers);
  const ownerTile = worldToOwnerTile(anchor.worldX, anchor.worldY, zoom);
  const bbox = members.length > 1 ? serializeBbox(members) : null;
  const primaryProperty = anchor;

  return {
    nodeClass,
    groupKind: members.length > 1 ? 'cluster' : 'single',
    primaryPropertyId: primaryProperty.id,
    pointCount: members.length,
    propertyIds: orderedMembers.map((member) => member.id),
    previewPropertyIds: orderedMembers
      .slice(0, PROPERTY_PREVIEW_MEMBER_LIMIT)
      .map((member) => member.id),
    coordinate: [anchor.lon, anchor.lat],
    bbox,
    activeListingCount: members.filter((member) => member.hasActiveListing).length,
    completedListingCount: members.filter((member) => member.hasCompletedListing).length,
    socialCount: members.filter(hasActiveSocialSignal).length,
    recentSocialCount: members.filter(hasRecentActiveSocialSignal).length,
    socialScoreTotal: members.reduce((sum, member) => sum + member.socialScore, 0),
    socialScoreMax: Math.max(...members.map((member) => member.socialScore)),
    recentSocialScoreTotal: members.reduce((sum, member) => sum + member.recentSocialScore, 0),
    commentCount: members.reduce((sum, member) => sum + member.commentCount, 0),
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

async function fetchGroupingCandidatesInBBox(
  bounds: TileBBox,
  zoom: number,
  includeGhostCandidates: boolean,
  filters: MapFilters
): Promise<GroupingCandidate[]> {
  return fetchGroupingCandidatesInBBoxes([bounds], zoom, includeGhostCandidates, filters);
}

async function fetchGroupingCandidatesInBBoxes(
  boundsList: TileBBox[],
  zoom: number,
  includeGhostCandidates: boolean,
  filters: MapFilters
): Promise<GroupingCandidate[]> {
  const activityFilterPredicate = buildActivityFilterPredicate(filters.activity, 'sf');
  const bboxFilter = buildBoundsFilter(boundsList, sql.raw('p.geometry'));
  const candidateVisibilityFilter = includeGhostCandidates
    ? sql`TRUE`
    : sql`(
        COALESCE(lf.has_active_listing, FALSE)
        OR COALESCE(lf.has_completed_listing, FALSE)
        OR COALESCE(sf.social_score, 0) >= ${ACTIVE_SOCIAL_SCORE_THRESHOLD}
      )`;
  const marketStatePredicate = buildBulkMarketStatePredicate(filters, 'lf');
  const includeEffectivePrices = hasPriceFilters(filters);
  const requiresMarketStateFacts = filters.marketState.length !== MAP_MARKET_STATES.length;
  const priceFilterPredicate = includeEffectivePrices
    ? buildPriceFilterPredicate(filters, 'lf')
    : sql`TRUE`;
  const activityCandidateFilter = buildActivityWindowPredicate(
    sql.raw('activity_at'),
    filters.activity
  );
  const candidateScopeCtes = includeGhostCandidates
    ? sql`
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
      `
    : sql`
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
        active_listing_candidate_ids AS MATERIALIZED (
          SELECT DISTINCT l.property_id
          FROM v_canonical_listing_facts l
          INNER JOIN bounded_properties bp ON bp.id = l.property_id
          WHERE l.status = 'active'
        ),
        completed_listing_candidate_ids AS MATERIALIZED (
          SELECT DISTINCT l.property_id
          FROM v_canonical_listing_facts l
          INNER JOIN bounded_properties bp ON bp.id = l.property_id
          WHERE l.status IN ('sold', 'rented')
        ),
        social_activity_candidate_ids AS MATERIALIZED (
          SELECT property_id
          FROM (
            SELECT c.property_id
            FROM (
              SELECT c.property_id, c.created_at AS activity_at
              FROM comments c
            ) c
            INNER JOIN bounded_properties bp ON bp.id = c.property_id
            WHERE ${activityCandidateFilter}
            UNION
            SELECT r.property_id
            FROM (
              SELECT r.target_id AS property_id, r.created_at AS activity_at
              FROM reactions r
              WHERE r.target_type = 'property'
            ) r
            INNER JOIN bounded_properties bp ON bp.id = r.property_id
            WHERE ${activityCandidateFilter}
            UNION
            SELECT rc.property_id
            FROM (
              SELECT c.property_id, r.created_at AS activity_at
              FROM reactions r
              INNER JOIN comments c ON c.id = r.target_id
              WHERE r.target_type = 'comment'
            ) rc
            INNER JOIN bounded_properties bp ON bp.id = rc.property_id
            WHERE ${activityCandidateFilter}
            UNION
            SELECT pg.property_id
            FROM (
              SELECT
                pg.property_id,
                GREATEST(pg.created_at, pg.updated_at) AS activity_at
              FROM price_guesses pg
            ) pg
            INNER JOIN bounded_properties bp ON bp.id = pg.property_id
            WHERE ${activityCandidateFilter}
            UNION
            SELECT pv.property_id
            FROM (
              SELECT
                pv.property_id,
                MAX(pv.viewed_at) AS activity_at
              FROM property_views pv
              GROUP BY pv.property_id
              HAVING COUNT(DISTINCT COALESCE(pv.user_id::text, pv.session_id)) >= 8
            ) pv
            INNER JOIN bounded_properties bp ON bp.id = pv.property_id
            WHERE ${activityCandidateFilter}
          ) social_candidates
        ),
        candidate_property_ids AS MATERIALIZED (
          SELECT property_id
          FROM active_listing_candidate_ids
          UNION
          SELECT property_id
          FROM completed_listing_candidate_ids
          UNION
          SELECT property_id
          FROM social_activity_candidate_ids
        ),
        candidate_properties AS MATERIALIZED (
          SELECT
            bp.id,
            bp.geometry,
            bp.official_valuation
          FROM bounded_properties bp
          INNER JOIN candidate_property_ids cpi ON cpi.property_id = bp.id
        )
      `;
  const listingFactsCtes = includeEffectivePrices
    ? sql`
        latest_listing AS MATERIALIZED (
          SELECT DISTINCT ON (l.property_id)
            l.property_id,
            l.status
          FROM v_canonical_listing_facts l
          INNER JOIN candidate_properties cp ON cp.id = l.property_id
          ORDER BY l.property_id, ${buildListingOrderExpression('l')}
        ),
        active_listing AS MATERIALIZED (
          SELECT DISTINCT ON (l.property_id)
            l.property_id,
            l.asking_price,
            l.normalized_price_type AS price_type
          FROM v_canonical_listing_facts l
          INNER JOIN candidate_properties cp ON cp.id = l.property_id
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
    : requiresMarketStateFacts
      ? sql`
          latest_listing AS MATERIALIZED (
            SELECT DISTINCT ON (l.property_id)
              l.property_id,
              l.status
            FROM v_canonical_listing_facts l
            INNER JOIN candidate_properties cp ON cp.id = l.property_id
            ORDER BY l.property_id, ${buildListingOrderExpression('l')}
          ),
          active_listing AS MATERIALIZED (
            SELECT DISTINCT ON (l.property_id)
              l.property_id,
              l.normalized_price_type AS price_type
            FROM v_canonical_listing_facts l
            INNER JOIN candidate_properties cp ON cp.id = l.property_id
            WHERE l.status = 'active'
            ORDER BY l.property_id, ${buildListingOrderExpression('l')}
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
        `
      : sql`
        latest_listing AS MATERIALIZED (
          SELECT DISTINCT ON (l.property_id)
            l.property_id,
            l.status
          FROM v_canonical_listing_facts l
          INNER JOIN candidate_properties cp ON cp.id = l.property_id
          ORDER BY l.property_id, ${buildListingOrderExpression('l')}
        ),
        active_listing AS MATERIALIZED (
          SELECT DISTINCT ON (l.property_id)
            l.property_id,
            l.normalized_price_type AS price_type
          FROM v_canonical_listing_facts l
          INNER JOIN candidate_properties cp ON cp.id = l.property_id
          WHERE l.status = 'active'
          ORDER BY l.property_id, ${buildListingOrderExpression('l')}
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

  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL jit = off`);

    return tx.execute<GroupingCandidateRow>(sql`
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
    `);
  });

  return Array.from(rows).map((row) => toCandidate(row, zoom));
}

async function fetchFollowingGroupingCandidatesInBBoxes(
  viewerId: string,
  boundsList: TileBBox[],
  zoom: number,
  filters: MapFilters
): Promise<GroupingCandidate[]> {
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

  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL jit = off`);

    return tx.execute<GroupingCandidateRow>(sql`
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
    `);
  });

  return Array.from(rows).map((row) => toCandidate(row, zoom));
}

async function fetchGroupingCandidates(
  tile: TileId,
  filters: MapFilters
): Promise<GroupingCandidate[]> {
  const bufferedBounds = getBufferedTileBBox(tile, getGroupingBufferUnits());
  return fetchGroupingCandidatesInBBox(
    bufferedBounds,
    tile.z,
    shouldFetchGhostCandidates(tile.z),
    filters
  );
}

async function fetchFollowingGroupingCandidates(
  tile: TileId,
  viewerId: string,
  filters: MapFilters
): Promise<GroupingCandidate[]> {
  const bufferedBounds = getBufferedTileBBox(tile, getGroupingBufferUnits());
  return fetchFollowingGroupingCandidatesInBBoxes(viewerId, [bufferedBounds], tile.z, filters);
}

function readStateIdentityPredicate(viewer: PropertyReadViewer): SQL {
  if ('userId' in viewer) {
    return sql`prs.user_id = ${viewer.userId} AND prs.session_id IS NULL`;
  }

  return sql`prs.session_id = ${viewer.sessionId} AND prs.user_id IS NULL`;
}

async function hasCurrentReadStateInTileBounds(
  tile: TileId,
  viewer: PropertyReadViewer
): Promise<boolean> {
  const bounds = getBufferedTileBBox(tile, getGroupingBufferUnits());
  const rows = await db.execute<{ has_read_state: boolean }>(sql`
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
  `);

  return Array.from(rows)[0]?.has_read_state === true;
}

async function fetchSinglePropertyDetails(
  propertyIds: string[]
): Promise<Map<string, SinglePropertyDetail>> {
  if (propertyIds.length === 0) {
    return new Map();
  }

  const ids = [...new Set(propertyIds)];
  const idList = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `
  );
  const rows = await db.execute<SinglePropertyDetailRow>(sql`
    SELECT
      p.id,
      p.country_code,
      p.street,
      p.house_number,
      p.house_number_addition,
      p.city,
      p.postal_code,
      lf.asking_price,
      lf.thumbnail_url,
      lf.has_active_listing,
      lf.market_state
    FROM properties p
    ${buildPropertyListingFactsJoin('p', 'lf')}
    WHERE p.id IN (${idList})
  `);

  return new Map(
    Array.from(rows).map((row) => {
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
  groups: CanonicalPropertyGroup[]
): Promise<CanonicalPropertyGroup[]> {
  const singleIds = groups
    .filter((group) => group.groupKind === 'single')
    .map((group) => group.primaryPropertyId);

  if (singleIds.length === 0) {
    return groups;
  }

  const detailsById = await fetchSinglePropertyDetails(singleIds);

  return groups.map((group) => {
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

function buildCanonicalGroupsFromCandidates(
  zoom: number,
  candidates: GroupingCandidate[]
): CanonicalPropertyGroup[] {
  const activeCandidates = candidates.filter((candidate) => !isGhostCandidate(candidate));
  const ghostCandidates = candidates.filter(isGhostCandidate);

  const activeGroups = clusterCandidates(activeCandidates, {
    maxRadiusUnits: pxToTileUnits(getActiveGroupingRadiusPx(100)),
    gapUnits: pxToTileUnits(ACTIVE_GROUPING_GAP_PX),
    getRadiusUnits: (candidate) => pxToTileUnits(getActiveGroupingRadiusPx(candidate.socialScore)),
  }).map((members) => buildCanonicalGroup(members, 'active', zoom));

  const activeOccupancies = activeGroups.map((group) => ({
    x: group.anchorWorldX,
    y: group.anchorWorldY,
    radiusUnits: getActiveOccupancyRadiusUnits(group),
  }));

  const visibleGhostCandidates =
    zoom >= GHOST_NODE_REVEAL_ZOOM
      ? ghostCandidates.filter((candidate) => {
          const ghostRadiusUnits = pxToTileUnits(getGhostGroupingRadiusPx());
          return !activeOccupancies.some((occupancy) => {
            const dx = candidate.worldX - occupancy.x;
            const dy = candidate.worldY - occupancy.y;
            const threshold = occupancy.radiusUnits + ghostRadiusUnits;
            return dx * dx + dy * dy <= threshold * threshold;
          });
        })
      : [];

  const ghostGroups = clusterCandidates(visibleGhostCandidates, {
    maxRadiusUnits: pxToTileUnits(getGhostGroupingRadiusPx()),
    gapUnits: pxToTileUnits(GHOST_GROUPING_GAP_PX),
    getRadiusUnits: () => pxToTileUnits(getGhostGroupingRadiusPx()),
  }).map((members) => buildCanonicalGroup(members, 'ghost', zoom));

  return [...activeGroups, ...ghostGroups];
}

export function groupCandidatesForTile(
  tile: TileId,
  candidates: GroupingCandidate[]
): CanonicalPropertyGroup[] {
  return buildCanonicalGroupsFromCandidates(tile.z, candidates).filter(
    (group) => group.ownerTile.x === tile.x && group.ownerTile.y === tile.y
  );
}

async function buildUnhydratedCanonicalGroupsForTile(
  tile: TileId,
  filters: MapFilters
): Promise<CanonicalPropertyGroup[]> {
  const candidates = await fetchGroupingCandidates(tile, filters);
  return groupCandidatesForTile(tile, candidates);
}

export async function buildCanonicalGroupsForTile(
  tile: TileId,
  filters: MapFilters = createDefaultMapFilters()
): Promise<CanonicalPropertyGroup[]> {
  const cachedGroups = getCachedCanonicalGroups(tile, filters);
  if (cachedGroups) {
    return cachedGroups;
  }

  const cacheKey = buildCanonicalGroupCacheKey(tile, filters);
  const pendingBuild = pendingCanonicalGroupBuilds.get(cacheKey);
  if (pendingBuild) {
    return pendingBuild;
  }

  const buildPromise = (async () => {
    const groups = await hydrateSinglePropertyDetails(
      await buildUnhydratedCanonicalGroupsForTile(tile, filters)
    );
    setCachedCanonicalGroups(tile, filters, groups);
    return groups;
  })();

  pendingCanonicalGroupBuilds.set(cacheKey, buildPromise);
  try {
    return await buildPromise;
  } finally {
    pendingCanonicalGroupBuilds.delete(cacheKey);
  }
}

export async function buildFollowingCanonicalGroupsForTile(
  tile: TileId,
  viewerId: string,
  filters: MapFilters = createDefaultMapFilters()
): Promise<CanonicalPropertyGroup[]> {
  const candidates = await fetchFollowingGroupingCandidates(tile, viewerId, filters);
  const groups = groupCandidatesForTile(tile, candidates);
  return hydrateSinglePropertyDetails(groups);
}

export async function buildReadCanonicalGroupsForTile(
  tile: TileId,
  viewer: PropertyReadViewer,
  filters: MapFilters = createDefaultMapFilters()
): Promise<CanonicalPropertyGroup[]> {
  if (!(await hasCurrentReadStateInTileBounds(tile, viewer))) {
    return [];
  }

  const cachedGroups = getCachedCanonicalGroups(tile, filters);
  if (cachedGroups) {
    return filterReadCanonicalGroups(cachedGroups, viewer);
  }

  const readGroups = await filterReadCanonicalGroups(
    await buildUnhydratedCanonicalGroupsForTile(tile, filters),
    viewer
  );

  if (readGroups.length === 0) {
    return [];
  }

  return hydrateSinglePropertyDetails(readGroups);
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
  filters: MapFilters = createDefaultMapFilters()
): Promise<NearbyResolution | null> {
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
        candidateFilters
      )
  );

  const tapCoordinate: [number, number] = [lon, lat];
  let bestMatch: NearbyResolution | null = null;
  let bestDistanceUnits = Number.POSITIVE_INFINITY;

  for (const group of emittedGroups) {
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
  filters: MapFilters = createDefaultMapFilters()
): Promise<NearbyResolution | null> {
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
        candidateFilters
      )
  );

  const tapCoordinate: [number, number] = [lon, lat];
  let bestMatch: NearbyResolution | null = null;
  let bestDistanceUnits = Number.POSITIVE_INFINITY;

  for (const group of emittedGroups) {
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

export function serializeGroupForTile(group: CanonicalPropertyGroup): TileTransportFeature {
  const bbox = group.bbox;
  return {
    lon: group.coordinate[0],
    lat: group.coordinate[1],
    node_class: group.nodeClass,
    group_kind: group.groupKind,
    primary_property_id: group.primaryPropertyId,
    point_count: group.pointCount,
    property_ids: group.propertyIds.join(','),
    preview_property_ids: group.previewPropertyIds.join(','),
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

async function buildMvtForGroups(tile: TileId, groups: CanonicalPropertyGroup[]): Promise<Buffer> {
  if (groups.length === 0) {
    return Buffer.alloc(0);
  }

  const features = JSON.stringify(groups.map(serializeGroupForTile));
  const result = await db.execute<{ mvt: Buffer }>(sql`
    WITH feature_rows AS (
      SELECT
        (feature->>'lon')::double precision AS lon,
        (feature->>'lat')::double precision AS lat,
        feature->>'node_class' AS node_class,
        feature->>'group_kind' AS group_kind,
        feature->>'primary_property_id' AS primary_property_id,
        (feature->>'point_count')::integer AS point_count,
        feature->>'property_ids' AS property_ids,
        feature->>'preview_property_ids' AS preview_property_ids,
        NULLIF(feature->>'bbox_west', 'null')::double precision AS bbox_west,
        NULLIF(feature->>'bbox_south', 'null')::double precision AS bbox_south,
        NULLIF(feature->>'bbox_east', 'null')::double precision AS bbox_east,
        NULLIF(feature->>'bbox_north', 'null')::double precision AS bbox_north,
        (feature->>'activeListingCount')::integer AS "activeListingCount",
        (feature->>'completedListingCount')::integer AS "completedListingCount",
        (feature->>'socialCount')::integer AS "socialCount",
        (feature->>'recentSocialCount')::integer AS "recentSocialCount",
        (feature->>'socialScoreTotal')::double precision AS "socialScoreTotal",
        (feature->>'socialScoreMax')::double precision AS "socialScoreMax",
        (feature->>'recentSocialScoreTotal')::double precision AS "recentSocialScoreTotal",
        (feature->>'commentCount')::integer AS "commentCount",
        NULLIF(feature->>'address', 'null') AS address,
        NULLIF(feature->>'city', 'null') AS city,
        NULLIF(feature->>'askingPrice', 'null')::bigint AS "askingPrice",
        NULLIF(feature->>'thumbnailUrl', 'null') AS "thumbnailUrl",
        NULLIF(feature->>'hasActiveListing', 'null')::boolean AS "hasActiveListing",
        NULLIF(feature->>'marketState', 'null') AS "marketState",
        NULLIF(feature->>'id', 'null') AS id
      FROM jsonb_array_elements(${features}::jsonb) AS feature
    ),
    mvt_data AS (
      SELECT
        ST_AsMVTGeom(
          ST_SetSRID(ST_MakePoint(lon, lat), 4326),
          ST_MakeEnvelope(
            ${tileToBBox(tile).minLon},
            ${tileToBBox(tile).minLat},
            ${tileToBBox(tile).maxLon},
            ${tileToBBox(tile).maxLat},
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
  `);

  const row = Array.from(result)[0];
  if (!row?.mvt) {
    return Buffer.alloc(0);
  }

  return Buffer.isBuffer(row.mvt) ? row.mvt : Buffer.from(row.mvt);
}

export async function buildMvtForTile(
  tile: TileId,
  filters: MapFilters = createDefaultMapFilters()
): Promise<Buffer> {
  return buildMvtForGroups(tile, await buildCanonicalGroupsForTile(tile, filters));
}

export async function buildReadMvtForTile(
  tile: TileId,
  viewer: PropertyReadViewer,
  filters: MapFilters = createDefaultMapFilters()
): Promise<Buffer> {
  return buildMvtForGroups(tile, await buildReadCanonicalGroupsForTile(tile, viewer, filters));
}

export async function buildFollowingMvtForTile(
  tile: TileId,
  viewerId: string,
  filters: MapFilters = createDefaultMapFilters()
): Promise<Buffer> {
  return buildMvtForGroups(
    tile,
    await buildFollowingCanonicalGroupsForTile(tile, viewerId, filters)
  );
}
