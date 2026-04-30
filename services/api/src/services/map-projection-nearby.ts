import { sql, type SQL } from 'drizzle-orm';
import {
  PROPERTY_GHOST_REVEAL_ZOOM,
  PROPERTY_MAP_FOOTPRINTS,
  PROPERTY_PREVIEW_MEMBER_LIMIT,
} from '@huishype/shared/config';
import { db } from '../db/index.js';
import { createDefaultMapFilters, type MapFilters } from './map-filters.js';
import type { PropertyReadViewer } from './property-read-state.js';

const TILE_SIZE_PX = 512;
const WORLD_METERS = 40075016.68557849;
const MAX_CANDIDATE_ROWS = 32;
const PREVIEW_MEMBER_LIMIT_SQL = sql.raw(String(PROPERTY_PREVIEW_MEMBER_LIMIT));
const SALE_MARKET_STATES = ['for-sale', 'sold', 'not-listed'] as const;
const RENT_MARKET_STATES = ['for-rent', 'rented'] as const;

type NodeClass = 'active' | 'ghost';
type GroupKind = 'single' | 'cluster';
type MarketState = 'for-sale' | 'for-rent' | 'sold' | 'rented' | 'not-listed';

type ProjectionNearbyRow = {
  node_class: NodeClass;
  group_kind: GroupKind;
  primary_property_id: string;
  point_count: number;
  property_ids: string;
  preview_property_ids: string;
  lon: number;
  lat: number;
  bbox_west: number | null;
  bbox_south: number | null;
  bbox_east: number | null;
  bbox_north: number | null;
  active_listing_count: number;
  completed_listing_count: number;
  social_count: number;
  recent_social_count: number;
  social_score_total: number;
  social_score_max: number;
  recent_social_score_total: number;
  comment_count: number;
  address: string | null;
  city: string | null;
  asking_price: number | null;
  thumbnail_url: string | null;
  has_active_listing: boolean | null;
  market_state: MarketState | null;
};

export type ProjectionNearbyResult = {
  nodeClass: NodeClass;
  groupKind: GroupKind;
  primaryPropertyId: string;
  pointCount: number;
  propertyIds: string[];
  previewPropertyIds: string[];
  coordinate: [number, number];
  distanceMeters: number;
  bbox: [number, number, number, number] | null;
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
  marketState: MarketState | null;
};

function buildTextList(values: readonly string[]): SQL {
  return sql`(${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  )})`;
}

function buildScopedPricePredicate(
  marketStateColumn: SQL,
  effectivePriceColumn: SQL,
  impactedStates: readonly MarketState[],
  unaffectedStates: readonly MarketState[],
  operator: '>=' | '<=',
  value: number
): SQL {
  return sql`(
    ${marketStateColumn} IN ${buildTextList(unaffectedStates)}
    OR (
      ${marketStateColumn} IN ${buildTextList(impactedStates)}
      AND ${effectivePriceColumn} ${sql.raw(operator)} ${value}
    )
  )`;
}

function buildProjectedFactFilter(alias: string, filters: MapFilters): SQL {
  const predicates: SQL[] = [];
  const marketStateColumn = sql.raw(`${alias}.market_state`);
  const salePriceColumn = sql.raw(`${alias}.sale_effective_price`);
  const rentPriceColumn = sql.raw(`${alias}.rent_effective_price`);
  const lastSocialColumn = sql.raw(`${alias}.last_social_at`);
  const socialScoreColumn = sql.raw(`${alias}.social_score_total`);

  if (filters.marketState.length < 5) {
    predicates.push(sql`${marketStateColumn} IN ${buildTextList(filters.marketState)}`);
  }
  if (filters.salePriceFrom != null) {
    predicates.push(
      buildScopedPricePredicate(
        marketStateColumn,
        salePriceColumn,
        SALE_MARKET_STATES,
        RENT_MARKET_STATES,
        '>=',
        filters.salePriceFrom
      )
    );
  }
  if (filters.salePriceTo != null) {
    predicates.push(
      buildScopedPricePredicate(
        marketStateColumn,
        salePriceColumn,
        SALE_MARKET_STATES,
        RENT_MARKET_STATES,
        '<=',
        filters.salePriceTo
      )
    );
  }
  if (filters.rentPriceFrom != null) {
    predicates.push(
      buildScopedPricePredicate(
        marketStateColumn,
        rentPriceColumn,
        RENT_MARKET_STATES,
        SALE_MARKET_STATES,
        '>=',
        filters.rentPriceFrom
      )
    );
  }
  if (filters.rentPriceTo != null) {
    predicates.push(
      buildScopedPricePredicate(
        marketStateColumn,
        rentPriceColumn,
        RENT_MARKET_STATES,
        SALE_MARKET_STATES,
        '<=',
        filters.rentPriceTo
      )
    );
  }

  if (filters.activity === 'today') {
    predicates.push(sql`${lastSocialColumn} > NOW() - INTERVAL '1 day'`);
  } else if (filters.activity === '10d') {
    predicates.push(sql`${lastSocialColumn} > NOW() - INTERVAL '10 days'`);
  } else if (filters.activity === '30d') {
    predicates.push(sql`${lastSocialColumn} > NOW() - INTERVAL '30 days'`);
  } else if (filters.activity === 'all-time') {
    predicates.push(sql`${socialScoreColumn} > 0`);
  }

  return predicates.length > 0 ? sql.join(predicates, sql` AND `) : sql`TRUE`;
}

function buildQuietPropertyFilter(filters: MapFilters): SQL {
  const predicates: SQL[] = [];

  if (filters.marketState.length < 5 && !filters.marketState.includes('not-listed')) {
    predicates.push(sql`FALSE`);
  }
  if (filters.salePriceFrom != null) {
    predicates.push(sql`p.official_valuation >= ${filters.salePriceFrom}`);
  }
  if (filters.salePriceTo != null) {
    predicates.push(sql`p.official_valuation <= ${filters.salePriceTo}`);
  }
  if (filters.activity !== 'all') {
    predicates.push(sql`FALSE`);
  }

  return predicates.length > 0 ? sql.join(predicates, sql` AND `) : sql`TRUE`;
}

function buildReadStateIdentityFilter(viewer: PropertyReadViewer): SQL {
  if ('userId' in viewer) {
    return sql`prs.user_id = ${viewer.userId} AND prs.session_id IS NULL`;
  }

  return sql`prs.session_id = ${viewer.sessionId} AND prs.user_id IS NULL`;
}

function buildFollowingActivityFilter(filters: MapFilters): SQL {
  if (filters.activity === 'today') {
    return sql`fa.last_social_at > NOW() - INTERVAL '1 day'`;
  }
  if (filters.activity === '10d') {
    return sql`fa.last_social_at > NOW() - INTERVAL '10 days'`;
  }
  if (filters.activity === '30d') {
    return sql`fa.last_social_at > NOW() - INTERVAL '30 days'`;
  }
  return sql`TRUE`;
}

function metersPerPixel(lat: number, zoom: number): number {
  const clampedLat = Math.max(Math.min(lat, 85.05112878), -85.05112878);
  return (
    (Math.cos((clampedLat * Math.PI) / 180) * WORLD_METERS) /
    (TILE_SIZE_PX * 2 ** Math.max(0, zoom))
  );
}

function searchRadiusMeters(lat: number, zoom: number): number {
  const activeRadius =
    PROPERTY_MAP_FOOTPRINTS.active.clusterRadiusPx + PROPERTY_MAP_FOOTPRINTS.nearbyTapTolerancePx;
  const ghostRadius =
    PROPERTY_MAP_FOOTPRINTS.ghost.singleRadiusPx + PROPERTY_MAP_FOOTPRINTS.nearbyTapTolerancePx;
  return Math.max(activeRadius, ghostRadius, 12) * metersPerPixel(lat, zoom) * 3;
}

function hitRadiusPx(row: ProjectionNearbyRow): number {
  const base =
    row.node_class === 'ghost'
      ? PROPERTY_MAP_FOOTPRINTS.ghost.singleRadiusPx
      : row.group_kind === 'cluster'
        ? PROPERTY_MAP_FOOTPRINTS.active.clusterRadiusPx
        : PROPERTY_MAP_FOOTPRINTS.active.singleRadiusPx;
  return base + PROPERTY_MAP_FOOTPRINTS.nearbyTapTolerancePx;
}

function lngLatToWorldPx(lon: number, lat: number, zoom: number): [number, number] {
  const sinLat = Math.sin((Math.max(Math.min(lat, 85.05112878), -85.05112878) * Math.PI) / 180);
  const worldSize = TILE_SIZE_PX * 2 ** Math.max(0, zoom);
  return [
    ((lon + 180) / 360) * worldSize,
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize,
  ];
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const earthRadiusM = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const hav = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * earthRadiusM * Math.asin(Math.sqrt(hav));
}

function splitIds(value: string): string[] {
  return value.split(',').filter(Boolean);
}

function mapRow(row: ProjectionNearbyRow, tap: [number, number]): ProjectionNearbyResult {
  const propertyIds = splitIds(row.property_ids);
  return {
    nodeClass: row.node_class,
    groupKind: row.group_kind,
    primaryPropertyId: row.primary_property_id,
    pointCount: Number(row.point_count),
    propertyIds,
    previewPropertyIds: splitIds(row.preview_property_ids).slice(0, PROPERTY_PREVIEW_MEMBER_LIMIT),
    coordinate: [Number(row.lon), Number(row.lat)],
    distanceMeters: haversineMeters(tap, [Number(row.lon), Number(row.lat)]),
    bbox:
      row.bbox_west != null &&
      row.bbox_south != null &&
      row.bbox_east != null &&
      row.bbox_north != null
        ? [
            Number(row.bbox_west),
            Number(row.bbox_south),
            Number(row.bbox_east),
            Number(row.bbox_north),
          ]
        : null,
    activeListingCount: Number(row.active_listing_count),
    completedListingCount: Number(row.completed_listing_count),
    socialCount: Number(row.social_count),
    recentSocialCount: Number(row.recent_social_count),
    socialScoreTotal: Number(row.social_score_total),
    socialScoreMax: Number(row.social_score_max),
    recentSocialScoreTotal: Number(row.recent_social_score_total),
    commentCount: Number(row.comment_count),
    address: row.address,
    city: row.city,
    askingPrice: row.asking_price != null ? Number(row.asking_price) : null,
    thumbnailUrl: row.thumbnail_url,
    hasActiveListing: row.has_active_listing,
    marketState: row.market_state,
  };
}

function pickNearbyRow(
  rows: ProjectionNearbyRow[],
  lon: number,
  lat: number,
  zoom: number
): ProjectionNearbyRow | null {
  const tapWorld = lngLatToWorldPx(lon, lat, zoom);
  let best: { row: ProjectionNearbyRow; distancePx: number } | null = null;

  for (const row of rows) {
    const rowWorld = lngLatToWorldPx(Number(row.lon), Number(row.lat), zoom);
    const distancePx = Math.hypot(rowWorld[0] - tapWorld[0], rowWorld[1] - tapWorld[1]);
    if (distancePx > hitRadiusPx(row)) {
      continue;
    }
    if (!best || distancePx < best.distancePx) {
      best = { row, distancePx };
    }
  }

  return best?.row ?? null;
}

export async function resolveNearbyProjectedFeature(
  lon: number,
  lat: number,
  zoom: number,
  filters: MapFilters = createDefaultMapFilters(),
  viewer: PropertyReadViewer | null = null
): Promise<ProjectionNearbyResult | null> {
  const radius3857 = searchRadiusMeters(lat, zoom) / Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
  const factFilter = buildProjectedFactFilter('f', filters);
  const quietPropertyFilter = buildQuietPropertyFilter(filters);
  const bucketNodes =
    zoom <= 16
      ? sql`
    SELECT
      ST_Centroid(ST_Collect(f.geom_3857)) AS node_geom,
      'active'::text AS node_class,
      CASE WHEN COUNT(*) > 1 THEN 'cluster' ELSE 'single' END AS group_kind,
      (ARRAY_AGG(f.property_id::text ORDER BY f.property_id::text))[1] AS primary_property_id,
      COUNT(*)::int AS point_count,
      STRING_AGG(f.property_id::text, ',' ORDER BY f.property_id::text) AS property_ids,
      ARRAY_TO_STRING((ARRAY_AGG(f.property_id::text ORDER BY f.property_id::text))[1:${PREVIEW_MEMBER_LIMIT_SQL}], ',') AS preview_property_ids,
      ST_XMin((ST_Extent(ST_Transform(f.geom_3857, 4326)))::box3d) AS bbox_west,
      ST_YMin((ST_Extent(ST_Transform(f.geom_3857, 4326)))::box3d) AS bbox_south,
      ST_XMax((ST_Extent(ST_Transform(f.geom_3857, 4326)))::box3d) AS bbox_east,
      ST_YMax((ST_Extent(ST_Transform(f.geom_3857, 4326)))::box3d) AS bbox_north,
      SUM(f.active_listing_count)::int AS active_listing_count,
      SUM(f.completed_listing_count)::int AS completed_listing_count,
      SUM(f.social_count)::int AS social_count,
      SUM(f.recent_social_count)::int AS recent_social_count,
      SUM(f.social_score_total)::double precision AS social_score_total,
      MAX(f.social_score_max)::double precision AS social_score_max,
      SUM(f.recent_social_score_total)::double precision AS recent_social_score_total,
      SUM(f.comment_count)::int AS comment_count,
      CASE WHEN COUNT(*) = 1 THEN MAX(f.address) ELSE NULL END AS address,
      CASE WHEN COUNT(*) = 1 THEN MAX(f.city) ELSE NULL END AS city,
      CASE WHEN COUNT(*) = 1 THEN MAX(f.asking_price) ELSE NULL END AS asking_price,
      CASE WHEN COUNT(*) = 1 THEN MAX(f.thumbnail_url) ELSE NULL END AS thumbnail_url,
      CASE WHEN COUNT(*) = 1 THEN BOOL_OR(f.has_active_listing) ELSE NULL END AS has_active_listing,
      CASE WHEN COUNT(*) = 1 THEN MAX(f.market_state) ELSE NULL END AS market_state
    FROM map_public_property_bucket_members bm
    INNER JOIN map_public_property_facts f ON f.property_id = bm.property_id
    WHERE bm.zoom = ${Math.floor(zoom)}
      AND ${factFilter}
    GROUP BY bm.zoom, bm.bucket_x, bm.bucket_y
  `
      : sql``;
  const activeSingles =
    zoom > 16
      ? sql`
    SELECT
      f.geom_3857 AS node_geom,
      'active'::text AS node_class,
      'single'::text AS group_kind,
      f.property_id::text AS primary_property_id,
      1::int AS point_count,
      f.property_id::text AS property_ids,
      f.property_id::text AS preview_property_ids,
      NULL::double precision AS bbox_west,
      NULL::double precision AS bbox_south,
      NULL::double precision AS bbox_east,
      NULL::double precision AS bbox_north,
      f.active_listing_count,
      f.completed_listing_count,
      f.social_count,
      f.recent_social_count,
      f.social_score_total::double precision,
      f.social_score_max::double precision,
      f.recent_social_score_total::double precision,
      f.comment_count,
      f.address,
      f.city,
      f.asking_price,
      f.thumbnail_url,
      f.has_active_listing,
      f.market_state
    FROM map_public_property_facts f
    WHERE ${factFilter}
  `
      : sql``;
  const quietSingles =
    zoom >= PROPERTY_GHOST_REVEAL_ZOOM && viewer
      ? sql`
    SELECT
      ST_Transform(p.geometry, 3857) AS node_geom,
      'ghost'::text AS node_class,
      'single'::text AS group_kind,
      p.id::text AS primary_property_id,
      1::int AS point_count,
      p.id::text AS property_ids,
      p.id::text AS preview_property_ids,
      NULL::double precision AS bbox_west,
      NULL::double precision AS bbox_south,
      NULL::double precision AS bbox_east,
      NULL::double precision AS bbox_north,
      0::int AS active_listing_count,
      0::int AS completed_listing_count,
      0::int AS social_count,
      0::int AS recent_social_count,
      0::double precision AS social_score_total,
      0::double precision AS social_score_max,
      0::double precision AS recent_social_score_total,
      0::int AS comment_count,
      CONCAT_WS(' ', p.street, CONCAT(p.house_number::text, COALESCE(NULLIF(BTRIM(p.house_number_addition), ''), ''))) AS address,
      p.city,
      NULL::bigint AS asking_price,
      NULL::text AS thumbnail_url,
      false AS has_active_listing,
      'not-listed'::text AS market_state
    FROM property_read_state prs
    INNER JOIN properties p ON p.id = prs.property_id
    LEFT JOIN property_change_state pcs ON pcs.property_id = p.id
    LEFT JOIN map_public_property_facts f ON f.property_id = p.id
    WHERE ${buildReadStateIdentityFilter(viewer)}
      AND p.status = 'active'
      AND p.geometry IS NOT NULL
      AND f.property_id IS NULL
      AND prs.seen_change_version >= COALESCE(pcs.change_version, 0)
      AND ${quietPropertyFilter}
  `
      : sql``;
  const unionParts: SQL[] = [];
  if (zoom <= 16) {
    unionParts.push(bucketNodes);
  }
  if (zoom > 16) {
    unionParts.push(activeSingles);
  }
  if (zoom >= PROPERTY_GHOST_REVEAL_ZOOM && viewer) {
    unionParts.push(quietSingles);
  }

  const rows = await db.execute<ProjectionNearbyRow>(sql`
    WITH tap AS (
      SELECT ST_Transform(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), 3857) AS geom_3857
    ),
    candidate_nodes AS (
      ${sql.join(unionParts, sql` UNION ALL `)}
    )
    SELECT
      n.node_class,
      n.group_kind,
      n.primary_property_id,
      n.point_count,
      n.property_ids,
      n.preview_property_ids,
      ST_X(ST_Transform(n.node_geom, 4326)) AS lon,
      ST_Y(ST_Transform(n.node_geom, 4326)) AS lat,
      n.bbox_west,
      n.bbox_south,
      n.bbox_east,
      n.bbox_north,
      n.active_listing_count,
      n.completed_listing_count,
      n.social_count,
      n.recent_social_count,
      n.social_score_total,
      n.social_score_max,
      n.recent_social_score_total,
      n.comment_count,
      n.address,
      n.city,
      n.asking_price,
      n.thumbnail_url,
      n.has_active_listing,
      n.market_state
    FROM candidate_nodes n
    CROSS JOIN tap
    WHERE ST_DWithin(n.node_geom, tap.geom_3857, ${radius3857})
    ORDER BY n.node_geom <-> tap.geom_3857
    LIMIT ${MAX_CANDIDATE_ROWS}
  `);

  const best = pickNearbyRow(Array.from(rows), lon, lat, zoom);
  return best ? mapRow(best, [lon, lat]) : null;
}

export async function resolveNearbyFollowingProjectedFeature(
  lon: number,
  lat: number,
  zoom: number,
  viewerId: string,
  filters: MapFilters = createDefaultMapFilters()
): Promise<ProjectionNearbyResult | null> {
  const radius3857 = searchRadiusMeters(lat, zoom) / Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
  const factFilter = buildProjectedFactFilter('f', filters);
  const followingActivityFilter = buildFollowingActivityFilter(filters);
  const bucketNodes =
    zoom <= 16
      ? sql`
    SELECT
      ST_Centroid(ST_Collect(f.geom_3857)) AS node_geom,
      'active'::text AS node_class,
      CASE WHEN COUNT(*) > 1 THEN 'cluster' ELSE 'single' END AS group_kind,
      (ARRAY_AGG(f.property_id::text ORDER BY f.property_id::text))[1] AS primary_property_id,
      COUNT(*)::int AS point_count,
      STRING_AGG(f.property_id::text, ',' ORDER BY f.property_id::text) AS property_ids,
      ARRAY_TO_STRING((ARRAY_AGG(f.property_id::text ORDER BY f.property_id::text))[1:${PREVIEW_MEMBER_LIMIT_SQL}], ',') AS preview_property_ids,
      ST_XMin((ST_Extent(ST_Transform(f.geom_3857, 4326)))::box3d) AS bbox_west,
      ST_YMin((ST_Extent(ST_Transform(f.geom_3857, 4326)))::box3d) AS bbox_south,
      ST_XMax((ST_Extent(ST_Transform(f.geom_3857, 4326)))::box3d) AS bbox_east,
      ST_YMax((ST_Extent(ST_Transform(f.geom_3857, 4326)))::box3d) AS bbox_north,
      SUM(f.active_listing_count)::int AS active_listing_count,
      SUM(f.completed_listing_count)::int AS completed_listing_count,
      SUM(fa.social_count)::int AS social_count,
      SUM(fa.recent_social_count)::int AS recent_social_count,
      SUM(fa.social_score_total)::double precision AS social_score_total,
      MAX(fa.social_score_max)::double precision AS social_score_max,
      SUM(fa.recent_social_score_total)::double precision AS recent_social_score_total,
      SUM(f.comment_count)::int AS comment_count,
      CASE WHEN COUNT(*) = 1 THEN MAX(f.address) ELSE NULL END AS address,
      CASE WHEN COUNT(*) = 1 THEN MAX(f.city) ELSE NULL END AS city,
      CASE WHEN COUNT(*) = 1 THEN MAX(f.asking_price) ELSE NULL END AS asking_price,
      CASE WHEN COUNT(*) = 1 THEN MAX(f.thumbnail_url) ELSE NULL END AS thumbnail_url,
      CASE WHEN COUNT(*) = 1 THEN BOOL_OR(f.has_active_listing) ELSE NULL END AS has_active_listing,
      CASE WHEN COUNT(*) = 1 THEN MAX(f.market_state) ELSE NULL END AS market_state
    FROM map_public_property_bucket_members bm
    INNER JOIN map_public_property_facts f ON f.property_id = bm.property_id
    INNER JOIN following_activity fa ON fa.property_id = f.property_id
    WHERE bm.zoom = ${Math.floor(zoom)}
      AND ${factFilter}
      AND ${followingActivityFilter}
    GROUP BY bm.zoom, bm.bucket_x, bm.bucket_y
  `
      : sql``;
  const singleNodes =
    zoom > 16
      ? sql`
    SELECT
      f.geom_3857 AS node_geom,
      'active'::text AS node_class,
      'single'::text AS group_kind,
      f.property_id::text AS primary_property_id,
      1::int AS point_count,
      f.property_id::text AS property_ids,
      f.property_id::text AS preview_property_ids,
      NULL::double precision AS bbox_west,
      NULL::double precision AS bbox_south,
      NULL::double precision AS bbox_east,
      NULL::double precision AS bbox_north,
      f.active_listing_count,
      f.completed_listing_count,
      fa.social_count,
      fa.recent_social_count,
      fa.social_score_total,
      fa.social_score_max,
      fa.recent_social_score_total,
      f.comment_count,
      f.address,
      f.city,
      f.asking_price,
      f.thumbnail_url,
      f.has_active_listing,
      f.market_state
    FROM map_public_property_facts f
    INNER JOIN following_activity fa ON fa.property_id = f.property_id
    WHERE ${factFilter}
      AND ${followingActivityFilter}
  `
      : sql``;
  const unionParts: SQL[] = [];
  if (zoom <= 16) {
    unionParts.push(bucketNodes);
  }
  if (zoom > 16) {
    unionParts.push(singleNodes);
  }

  const rows = await db.execute<ProjectionNearbyRow>(sql`
    WITH tap AS (
      SELECT ST_Transform(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), 3857) AS geom_3857
    ),
    following_activity AS MATERIALIZED (
      SELECT
        a.property_id,
        COUNT(*)::int AS social_count,
        COUNT(*) FILTER (WHERE a.activity_at > NOW() - INTERVAL '7 days')::int AS recent_social_count,
        SUM(a.score)::double precision AS social_score_total,
        MAX(a.score)::double precision AS social_score_max,
        COALESCE(SUM(a.score) FILTER (WHERE a.activity_at > NOW() - INTERVAL '7 days'), 0)::double precision AS recent_social_score_total,
        MAX(a.activity_at) AS last_social_at
      FROM user_follows uf
      INNER JOIN map_property_actor_activity a ON a.actor_user_id = uf.followed_user_id
      CROSS JOIN tap
      WHERE uf.follower_user_id = ${viewerId}
        AND ST_DWithin(a.geom_3857, tap.geom_3857, ${radius3857})
      GROUP BY a.property_id
    ),
    candidate_nodes AS (
      ${sql.join(unionParts, sql` UNION ALL `)}
    )
    SELECT
      n.node_class,
      n.group_kind,
      n.primary_property_id,
      n.point_count,
      n.property_ids,
      n.preview_property_ids,
      ST_X(ST_Transform(n.node_geom, 4326)) AS lon,
      ST_Y(ST_Transform(n.node_geom, 4326)) AS lat,
      n.bbox_west,
      n.bbox_south,
      n.bbox_east,
      n.bbox_north,
      n.active_listing_count,
      n.completed_listing_count,
      n.social_count,
      n.recent_social_count,
      n.social_score_total,
      n.social_score_max,
      n.recent_social_score_total,
      n.comment_count,
      n.address,
      n.city,
      n.asking_price,
      n.thumbnail_url,
      n.has_active_listing,
      n.market_state
    FROM candidate_nodes n
    CROSS JOIN tap
    WHERE ST_DWithin(n.node_geom, tap.geom_3857, ${radius3857})
    ORDER BY n.node_geom <-> tap.geom_3857
    LIMIT ${MAX_CANDIDATE_ROWS}
  `);

  const best = pickNearbyRow(Array.from(rows), lon, lat, zoom);
  return best ? mapRow(best, [lon, lat]) : null;
}
