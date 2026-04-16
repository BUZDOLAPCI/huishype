import { sql } from 'drizzle-orm';
import {
  isValidCountryCode,
  PROPERTY_MAP_FOOTPRINTS,
  PROPERTY_GHOST_REVEAL_ZOOM,
  PROPERTY_PREVIEW_MEMBER_LIMIT,
} from '@huishype/shared/config';
import { db } from '../db/index.js';
import { formatDisplayAddress } from '../utils/address.js';
import {
  buildPropertyMarketFilterQuery,
  createDefaultMapFilters,
  type MapFilters,
} from './map-filters.js';

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
  has_listing: boolean;
  activity_score: number;
  like_count: number;
  comment_count: number;
  guess_count: number;
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
  official_valuation: number | null;
  year_built: number | null;
  floor_area_m2: number | null;
  asking_price: number | null;
  thumbnail_url: string | null;
};

export type GroupingCandidate = {
  id: string;
  hasListing: boolean;
  activityScore: number;
  likeCount: number;
  commentCount: number;
  guessCount: number;
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
  activityScore: number;
  activityScoreTotal: number;
  likeCount: number;
  commentCount: number;
  guessCount: number;
  hasListing: boolean;
  streetName: string | null;
  houseNumber: number | null;
  houseNumberAddition: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  countryCode: string | null;
  officialValuation: number | null;
  askingPrice: number | null;
  thumbnailUrl: string | null;
  yearBuilt: number | null;
  floorAreaM2: number | null;
  ownerTile: TileId;
  anchorWorldX: number;
  anchorWorldY: number;
};

type SinglePropertyDetail = {
  streetName: string;
  houseNumber: number;
  houseNumberAddition: string | null;
  address: string;
  city: string;
  postalCode: string | null;
  countryCode: string;
  officialValuation: number | null;
  askingPrice: number | null;
  thumbnailUrl: string | null;
  yearBuilt: number | null;
  floorAreaM2: number | null;
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

type RadiusStop = readonly [threshold: number, radiusPx: number];

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
  activityScore: number;
  activityScoreTotal: number;
  likeCount: number;
  commentCount: number;
  guessCount: number;
  hasListing: boolean;
  streetName: string | null;
  houseNumber: number | null;
  houseNumberAddition: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  countryCode: string | null;
  officialValuation: number | null;
  askingPrice: number | null;
  thumbnailUrl: string | null;
  yearBuilt: number | null;
  floorAreaM2: number | null;
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

function interpolateRadius(value: number, stops: readonly RadiusStop[]): number {
  if (stops.length === 0) return 0;
  if (value <= stops[0][0]) return stops[0][1];

  for (let index = 1; index < stops.length; index += 1) {
    const [currentThreshold, currentRadius] = stops[index];
    if (value <= currentThreshold) {
      const [previousThreshold, previousRadius] = stops[index - 1];
      const progress = (value - previousThreshold) / (currentThreshold - previousThreshold);
      return previousRadius + progress * (currentRadius - previousRadius);
    }
  }

  return stops[stops.length - 1][1];
}

export function getActiveSingleRadiusPx(activityScore: number): number {
  return interpolateRadius(activityScore, ACTIVE_FOOTPRINT.singleRadiusStopsPx);
}

export function getActiveClusterRadiusPx(pointCount: number): number {
  return getStepRadius(pointCount, ACTIVE_FOOTPRINT.clusterRadiusStopsPx);
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
    tile.z,
  );
  const [maxLon, minLat] = worldUnitsToLngLat(
    (tile.x + 1) * PROPERTY_TILE_EXTENT,
    (tile.y + 1) * PROPERTY_TILE_EXTENT,
    tile.z,
  );

  return { minLon, minLat, maxLon, maxLat };
}

function getBufferedTileBBox(tile: TileId, bufferUnits: number): TileBBox {
  const bounds = tileWorldBounds(tile);
  const [minLon, maxLat] = worldUnitsToLngLat(
    bounds.minWorldX - bufferUnits,
    bounds.minWorldY - bufferUnits,
    tile.z,
  );
  const [maxLon, minLat] = worldUnitsToLngLat(
    bounds.maxWorldX + bufferUnits,
    bounds.maxWorldY + bufferUnits,
    tile.z,
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
      maxGhostSeedAndNeighborRadius,
    ) + 16,
  );
}

export function shouldFetchGhostCandidates(zoom: number): boolean {
  return zoom >= GHOST_NODE_REVEAL_ZOOM;
}

function compareCandidatePriority(a: GroupingCandidate, b: GroupingCandidate): number {
  return (
    b.activityScore - a.activityScore ||
    Number(b.hasListing) - Number(a.hasListing) ||
    b.likeCount - a.likeCount ||
    a.id.localeCompare(b.id)
  );
}

function isGhostCandidate(candidate: GroupingCandidate): boolean {
  return !candidate.hasListing && candidate.activityScore === 0;
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
  getRadiusUnits: (candidate: GroupingCandidate) => number,
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
  config: ClusterBuilderConfig,
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
  const centerX =
    members.reduce((sum, member) => sum + member.worldX, 0) / members.length;
  const centerY =
    members.reduce((sum, member) => sum + member.worldY, 0) / members.length;
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

async function fetchNearbyEmittedGroups(
  lon: number,
  lat: number,
  zoom: number,
  filters: MapFilters,
): Promise<CanonicalPropertyGroup[]> {
  const [worldX, worldY] = lngLatToWorldUnits(lon, lat, zoom);
  const tapTile = worldToOwnerTile(worldX, worldY, zoom);
  const tiles = getTileNeighborhood(tapTile);
  const bufferUnits = getGroupingBufferUnits();
  const tileBounds = tiles.map((tile) => ({
    tile,
    worldBounds: getBufferedTileWorldBounds(tile, bufferUnits),
  }));
  const candidates = await fetchGroupingCandidatesInBBoxes(
    tiles.map((tile) => getBufferedTileBBox(tile, bufferUnits)),
    zoom,
    shouldFetchGhostCandidates(zoom),
    filters,
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
    groupCandidatesForTile(tile, candidatesByTile.get(tileKey(tile)) ?? []),
  );

  return hydrateSinglePropertyDetails(tileGroups);
}

function buildCanonicalGroup(
  members: GroupingCandidate[],
  nodeClass: NodeClass,
  zoom: number,
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
    previewPropertyIds: orderedMembers.slice(0, PROPERTY_PREVIEW_MEMBER_LIMIT).map((member) => member.id),
    coordinate: [anchor.lon, anchor.lat],
    bbox,
    activityScore: Math.max(...members.map((member) => member.activityScore)),
    activityScoreTotal: members.reduce((sum, member) => sum + member.activityScore, 0),
    likeCount: members.reduce((sum, member) => sum + member.likeCount, 0),
    commentCount: members.reduce((sum, member) => sum + member.commentCount, 0),
    guessCount: members.reduce((sum, member) => sum + member.guessCount, 0),
    hasListing: members.some((member) => member.hasListing),
    streetName: null,
    houseNumber: null,
    houseNumberAddition: null,
    address: null,
    city: null,
    postalCode: null,
    countryCode: null,
    officialValuation: null,
    askingPrice: null,
    thumbnailUrl: null,
    yearBuilt: null,
    floorAreaM2: null,
    ownerTile,
    anchorWorldX: anchor.worldX,
    anchorWorldY: anchor.worldY,
  };
}

function getActiveOccupancyRadiusUnits(group: CanonicalPropertyGroup): number {
  const pxRadius =
    group.groupKind === 'cluster'
      ? getActiveClusterRadiusPx(group.pointCount)
      : getActiveSingleRadiusPx(group.activityScore);
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
        : getActiveSingleRadiusPx(group.activityScore);

  return pxToTileUnits(pxRadius + NEARBY_TAP_TOLERANCE_PX);
}

function toCandidate(row: GroupingCandidateRow, zoom: number): GroupingCandidate {
  const [worldX, worldY] = lngLatToWorldUnits(row.lon, row.lat, zoom);
  return {
    id: row.id,
    hasListing: row.has_listing,
    activityScore: Number(row.activity_score),
    likeCount: Number(row.like_count),
    commentCount: Number(row.comment_count),
    guessCount: Number(row.guess_count),
    lon: row.lon,
    lat: row.lat,
    worldX,
    worldY,
  };
}

async function fetchGroupingCandidatesInBBox(
  bounds: TileBBox,
  zoom: number,
  includeGhostCandidates: boolean,
  filters: MapFilters,
): Promise<GroupingCandidate[]> {
  return fetchGroupingCandidatesInBBoxes([bounds], zoom, includeGhostCandidates, filters);
}

async function fetchGroupingCandidatesInBBoxes(
  boundsList: TileBBox[],
  zoom: number,
  includeGhostCandidates: boolean,
  filters: MapFilters,
): Promise<GroupingCandidate[]> {
  const marketFilterQuery = buildPropertyMarketFilterQuery(filters, 'p');
  const candidateVisibilityFilter = includeGhostCandidates
    ? sql`TRUE`
    : sql`(
        EXISTS (
          SELECT 1
          FROM listings l
          WHERE l.property_id = p.id
            AND l.status = 'active'
        )
        OR EXISTS (
          SELECT 1
          FROM comments c
          WHERE c.property_id = p.id
        )
        OR EXISTS (
          SELECT 1
          FROM price_guesses g
          WHERE g.property_id = p.id
      )
    )`;

  const bboxFilter = sql.join(
    boundsList.map(
      (bounds) => sql`p.geometry && ST_MakeEnvelope(
          ${bounds.minLon},
          ${bounds.minLat},
          ${bounds.maxLon},
          ${bounds.maxLat},
          4326
        )`,
    ),
    sql` OR `,
  );

  const rows = await db.execute<GroupingCandidateRow>(sql`
    WITH candidate_properties AS (
      SELECT
        p.id,
        ST_X(p.geometry) AS lon,
        ST_Y(p.geometry) AS lat
      FROM properties p
      ${marketFilterQuery.join}
      WHERE p.geometry IS NOT NULL
        AND p.status = 'active'
        AND (${bboxFilter})
        AND ${candidateVisibilityFilter}
        AND ${marketFilterQuery.predicate}
    ),
    latest_active_listing AS (
      SELECT DISTINCT ON (l.property_id)
        l.property_id,
        l.id,
        l.asking_price,
        l.thumbnail_url
      FROM listings l
      INNER JOIN candidate_properties cp ON cp.id = l.property_id
      WHERE l.status = 'active'
      ORDER BY l.property_id, l.created_at DESC
    ),
    comment_counts AS (
      SELECT c.property_id, COUNT(*)::int AS comment_count
      FROM comments c
      INNER JOIN candidate_properties cp ON cp.id = c.property_id
      GROUP BY c.property_id
    ),
    guess_counts AS (
      SELECT g.property_id, COUNT(*)::int AS guess_count
      FROM price_guesses g
      INNER JOIN candidate_properties cp ON cp.id = g.property_id
      GROUP BY g.property_id
    ),
    like_counts AS (
      SELECT r.target_id AS property_id, COUNT(*)::int AS like_count
      FROM reactions r
      INNER JOIN candidate_properties cp ON cp.id = r.target_id
      WHERE r.target_type = 'property'
        AND r.reaction_type = 'like'
      GROUP BY r.target_id
    )
    SELECT
      cp.id,
      CASE WHEN l.id IS NOT NULL THEN true ELSE false END AS has_listing,
      (COALESCE(cc.comment_count, 0) + COALESCE(gc.guess_count, 0))::int AS activity_score,
      COALESCE(lc.like_count, 0)::int AS like_count,
      COALESCE(cc.comment_count, 0)::int AS comment_count,
      COALESCE(gc.guess_count, 0)::int AS guess_count,
      cp.lon,
      cp.lat
    FROM candidate_properties cp
    LEFT JOIN latest_active_listing l ON l.property_id = cp.id
    LEFT JOIN comment_counts cc ON cc.property_id = cp.id
    LEFT JOIN guess_counts gc ON gc.property_id = cp.id
    LEFT JOIN like_counts lc ON lc.property_id = cp.id
  `);

  return Array.from(rows).map((row) => toCandidate(row, zoom));
}

async function fetchGroupingCandidates(
  tile: TileId,
  filters: MapFilters,
): Promise<GroupingCandidate[]> {
  const bufferedBounds = getBufferedTileBBox(tile, getGroupingBufferUnits());
  return fetchGroupingCandidatesInBBox(
    bufferedBounds,
    tile.z,
    shouldFetchGhostCandidates(tile.z),
    filters,
  );
}

async function fetchSinglePropertyDetails(
  propertyIds: string[],
): Promise<Map<string, SinglePropertyDetail>> {
  if (propertyIds.length === 0) {
    return new Map();
  }

  const ids = [...new Set(propertyIds)];
  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = await db.execute<SinglePropertyDetailRow>(sql`
    WITH latest_active_listing AS (
      SELECT DISTINCT ON (l.property_id)
        l.property_id,
        l.asking_price
      FROM listings l
      WHERE l.status = 'active'
        AND l.property_id IN (${idList})
      ORDER BY l.property_id, l.created_at DESC
    ),
    latest_thumbnail AS (
      SELECT DISTINCT ON (l.property_id)
        l.property_id,
        l.thumbnail_url
      FROM listings l
      WHERE l.status = 'active'
        AND l.thumbnail_url IS NOT NULL
        AND l.property_id IN (${idList})
      ORDER BY l.property_id, l.created_at DESC
    )
    SELECT
      p.id,
      p.country_code,
      p.street,
      p.house_number,
      p.house_number_addition,
      p.city,
      p.postal_code,
      p.official_valuation,
      p.year_built,
      p.floor_area_m2,
      l.asking_price,
      lt.thumbnail_url
    FROM properties p
    LEFT JOIN latest_active_listing l ON l.property_id = p.id
    LEFT JOIN latest_thumbnail lt ON lt.property_id = p.id
    WHERE p.id IN (${idList})
  `);

  return new Map(
    Array.from(rows).map((row) => {
      const countryCode = row.country_code;
      return [
        row.id,
        {
          streetName: row.street,
          houseNumber: row.house_number,
          houseNumberAddition: row.house_number_addition,
          address: formatDisplayAddress(
            {
              street: row.street,
              houseNumber: row.house_number,
              houseNumberAddition: row.house_number_addition,
              postalCode: row.postal_code ?? '',
              city: row.city,
            },
            isValidCountryCode(countryCode) ? countryCode : undefined,
          ),
          city: row.city,
          postalCode: row.postal_code,
          countryCode,
          officialValuation: row.official_valuation != null ? Number(row.official_valuation) : null,
          askingPrice: row.asking_price != null ? Number(row.asking_price) : null,
          thumbnailUrl: row.thumbnail_url,
          yearBuilt: row.year_built != null ? Number(row.year_built) : null,
          floorAreaM2: row.floor_area_m2 != null ? Number(row.floor_area_m2) : null,
        } satisfies SinglePropertyDetail,
      ];
    }),
  );
}

async function hydrateSinglePropertyDetails(
  groups: CanonicalPropertyGroup[],
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
      streetName: detail.streetName,
      houseNumber: detail.houseNumber,
      houseNumberAddition: detail.houseNumberAddition,
      address: detail.address,
      city: detail.city,
      postalCode: detail.postalCode,
      countryCode: detail.countryCode,
      officialValuation: detail.officialValuation,
      askingPrice: detail.askingPrice,
      thumbnailUrl: detail.thumbnailUrl,
      yearBuilt: detail.yearBuilt,
      floorAreaM2: detail.floorAreaM2,
    };
  });
}

function buildCanonicalGroupsFromCandidates(
  zoom: number,
  candidates: GroupingCandidate[],
): CanonicalPropertyGroup[] {
  const activeCandidates = candidates.filter((candidate) => !isGhostCandidate(candidate));
  const ghostCandidates = candidates.filter(isGhostCandidate);

  const activeGroups = clusterCandidates(activeCandidates, {
    maxRadiusUnits: pxToTileUnits(getActiveGroupingRadiusPx(100)),
    gapUnits: pxToTileUnits(ACTIVE_GROUPING_GAP_PX),
    getRadiusUnits: (candidate) => pxToTileUnits(getActiveGroupingRadiusPx(candidate.activityScore)),
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
  candidates: GroupingCandidate[],
): CanonicalPropertyGroup[] {
  return buildCanonicalGroupsFromCandidates(tile.z, candidates).filter(
    (group) => group.ownerTile.x === tile.x && group.ownerTile.y === tile.y,
  );
}

export async function buildCanonicalGroupsForTile(
  tile: TileId,
  filters: MapFilters = createDefaultMapFilters(),
): Promise<CanonicalPropertyGroup[]> {
  const candidates = await fetchGroupingCandidates(tile, filters);
  const groups = groupCandidatesForTile(tile, candidates);
  return hydrateSinglePropertyDetails(groups);
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const earthRadiusM = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const hav =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) *
      Math.sin(dLon / 2) *
      Math.cos(lat1) *
      Math.cos(lat2);
  return 2 * earthRadiusM * Math.asin(Math.sqrt(hav));
}

export async function resolveNearbyGroupedFeature(
  lon: number,
  lat: number,
  zoom: number,
  filters: MapFilters = createDefaultMapFilters(),
): Promise<NearbyResolution | null> {
  const [worldX, worldY] = lngLatToWorldUnits(lon, lat, zoom);
  const emittedGroups = await fetchNearbyEmittedGroups(lon, lat, zoom, filters);

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
    activityScore: group.activityScore,
    activityScoreTotal: group.activityScoreTotal,
    likeCount: group.likeCount,
    commentCount: group.commentCount,
    guessCount: group.guessCount,
    hasListing: group.hasListing,
    streetName: group.groupKind === 'single' ? group.streetName : null,
    houseNumber: group.groupKind === 'single' ? group.houseNumber : null,
    houseNumberAddition: group.groupKind === 'single' ? group.houseNumberAddition : null,
    address: group.groupKind === 'single' ? group.address : null,
    city: group.groupKind === 'single' ? group.city : null,
    postalCode: group.groupKind === 'single' ? group.postalCode : null,
    countryCode: group.groupKind === 'single' ? group.countryCode : null,
    officialValuation: group.groupKind === 'single' ? group.officialValuation : null,
    askingPrice: group.groupKind === 'single' ? group.askingPrice : null,
    thumbnailUrl: group.groupKind === 'single' ? group.thumbnailUrl : null,
    yearBuilt: group.groupKind === 'single' ? group.yearBuilt : null,
    floorAreaM2: group.groupKind === 'single' ? group.floorAreaM2 : null,
    id: group.groupKind === 'single' ? group.primaryPropertyId : null,
  };
}

export async function buildMvtForTile(
  tile: TileId,
  filters: MapFilters = createDefaultMapFilters(),
): Promise<Buffer> {
  const groups = await buildCanonicalGroupsForTile(tile, filters);
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
        (feature->>'activityScore')::integer AS "activityScore",
        (feature->>'activityScoreTotal')::integer AS "activityScoreTotal",
        (feature->>'likeCount')::integer AS "likeCount",
        (feature->>'commentCount')::integer AS "commentCount",
        (feature->>'guessCount')::integer AS "guessCount",
        (feature->>'hasListing')::boolean AS "hasListing",
        NULLIF(feature->>'streetName', 'null') AS "streetName",
        NULLIF(feature->>'houseNumber', 'null')::integer AS "houseNumber",
        NULLIF(feature->>'houseNumberAddition', 'null') AS "houseNumberAddition",
        NULLIF(feature->>'address', 'null') AS address,
        NULLIF(feature->>'city', 'null') AS city,
        NULLIF(feature->>'postalCode', 'null') AS "postalCode",
        NULLIF(feature->>'countryCode', 'null') AS "countryCode",
        NULLIF(feature->>'officialValuation', 'null')::bigint AS "officialValuation",
        NULLIF(feature->>'askingPrice', 'null')::bigint AS "askingPrice",
        NULLIF(feature->>'thumbnailUrl', 'null') AS "thumbnailUrl",
        NULLIF(feature->>'yearBuilt', 'null')::integer AS "yearBuilt",
        NULLIF(feature->>'floorAreaM2', 'null')::double precision AS "floorAreaM2",
        NULLIF(feature->>'id', 'null') AS id
      FROM jsonb_array_elements(${features}::jsonb) AS feature
    ),
    mvt_data AS (
      SELECT
        ST_AsMVTGeom(
          ST_SetSRID(ST_MakePoint(lon, lat), 4326),
          ST_MakeEnvelope(
            ${(tileToBBox(tile)).minLon},
            ${(tileToBBox(tile)).minLat},
            ${(tileToBBox(tile)).maxLon},
            ${(tileToBBox(tile)).maxLat},
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
        "activityScore",
        "activityScoreTotal",
        "likeCount",
        "commentCount",
        "guessCount",
        "hasListing",
        address,
        city,
        "postalCode",
        "countryCode",
        "officialValuation",
        "askingPrice",
        "thumbnailUrl",
        "yearBuilt",
        "floorAreaM2",
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
