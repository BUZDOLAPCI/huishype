import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db, properties as propertiesTable, savedProperties } from '../db/index.js';
import { sql, eq, and, type SQL } from 'drizzle-orm';
import { formatDisplayAddress } from '../utils/address.js';
import {
  getCountryConfig,
  isValidCountryCode,
  PROPERTY_GHOST_REVEAL_ZOOM,
  PROPERTY_PREVIEW_MEMBER_LIMIT,
  type CountryCode,
} from '@huishype/shared';
import { fetchGuessesWithKarma, calculateFmv } from '../services/fmv.js';
import {
  PROPERTY_TILE_EXTENT,
  lngLatToWorldUnits,
  resolveNearbyFollowingGroupedFeature,
  resolveNearbyGroupedFeature,
} from '../services/property-grouping.js';
import {
  areMapFiltersDefault,
  buildPropertyMarketFilterQuery,
  mapFiltersQuerySchema,
  normalizeMapFilters,
  parseFollowingMapFiltersQuery,
  parseMapFiltersQuery,
  followingMapFiltersQuerySchema,
} from '../services/map-filters.js';
import {
  ACTIVE_SOCIAL_SCORE_THRESHOLD,
  buildActivityFilterPredicate,
  buildCanonicalHouseNumberAdditionExpression,
  buildPropertyListingFactsJoin,
  buildPropertySocialFactsJoin,
} from '../services/property-queries.js';
import {
  getReadPropertyIdSet,
  isPropertyReadForViewer,
  resolvePropertyReadViewer,
  type PropertyReadViewer,
} from '../services/property-read-state.js';
import {
  getOfficialValuationSourceFetchHint,
  hydrateOfficialValuationRequestSchema,
  requestOfficialValuationHydration,
} from '../services/official-valuations/index.js';
import {
  getDefaultPropertyTilePyramidSlot,
  getPropertyTilePyramidMaxZoom,
  isDefaultPropertyTilePyramidPointCovered,
  isPropertyTilePyramidPointCoveredByCoverage,
  lookupCurrentPropertyTilePyramidVersion,
  safeRequestPropertyTilePyramidBuild,
} from '../services/property-tile-pyramid.js';

const coordinateSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number(), z.number()]).describe('[longitude, latitude]'),
});

const imageryCoordinateSchema = coordinateSchema.describe(
  'Geometry used for imagery framing. May snap to a nearby building surface point.'
);

const marketStateSchema = z.enum(['for-sale', 'for-rent', 'sold', 'rented', 'not-listed']);
const latestListingStatusSchema = z.enum(['active', 'sold', 'rented', 'withdrawn']).nullable();
const officialValuationSourceFetchSchema = z
  .object({
    source: z.literal('woz'),
    expectedValuationYear: z.number(),
    supportsClientFetch: z.object({
      web: z.boolean(),
      native: z.boolean(),
    }),
  })
  .nullable();

const propertyContractFields = {
  hasListing: z.boolean(),
  hasActiveListing: z.boolean(),
  marketState: marketStateSchema,
  latestListingStatus: latestListingStatusSchema,
  askingPrice: z.number().nullable(),
  thumbnailUrl: z.string().nullable(),
  socialScore: z.number(),
  recentSocialScore: z.number(),
  lastSocialAt: z.string().datetime().nullable(),
  topLevelCommentCount: z.number(),
  replyCount: z.number(),
  propertyLikeCount: z.number(),
  commentLikeCount: z.number(),
  guessCount: z.number(),
  viewCount: z.number(),
  uniqueViewerCount: z.number(),
  recentTopLevelCommentCount: z.number(),
  recentReplyCount: z.number(),
  recentPropertyLikeCount: z.number(),
  recentCommentLikeCount: z.number(),
  recentGuessCount: z.number(),
  recentViewCount: z.number(),
  recentUniqueViewerCount: z.number(),
  isRead: z.boolean(),
};

const propertyBaseSchema = z.object({
  id: z.string().uuid(),
  nationalId: z.string().nullable(),
  countryCode: z.string(),
  region: z.string().nullable(),
  street: z.string(),
  houseNumber: z.number(),
  houseNumberAddition: z.string().nullable(),
  address: z.string(),
  city: z.string(),
  postalCode: z.string().nullable(),
  geometry: coordinateSchema.nullable(),
  imageryGeometry: imageryCoordinateSchema.nullable().optional(),
  yearBuilt: z.number().nullable(),
  floorAreaM2: z.number().nullable(),
  status: z.enum(['active', 'inactive', 'demolished']),
  officialValuation: z.number().nullable(),
  officialValuationYear: z.number().nullable(),
  officialValuationSourceFetch: officialValuationSourceFetchSchema,
  commentsDisabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const propertySchema = propertyBaseSchema.extend(propertyContractFields);

const fmvDistributionSchema = z.object({
  p10: z.number(),
  p25: z.number(),
  p50: z.number(),
  p75: z.number(),
  p90: z.number(),
  min: z.number(),
  max: z.number(),
});

const fmvSchema = z.object({
  fmv: z.number().nullable(),
  confidence: z.enum(['none', 'low', 'medium', 'high']),
  guessCount: z.number(),
  distribution: fmvDistributionSchema.nullable(),
  officialValuation: z.number().nullable(),
  askingPrice: z.number().nullable(),
  divergence: z.number().nullable(),
});

const propertyDetailSchema = propertySchema.extend({
  isLiked: z.boolean(),
  isSaved: z.boolean(),
  commentCount: z.number(),
  likeCount: z.number(),
  uniqueViewers: z.number(),
  fmv: fmvSchema,
});

const savedPropertySchema = propertySchema.extend({
  savedAt: z.string().datetime(),
  isSaved: z.literal(true),
});

const propertyListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  city: z.string().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  ...mapFiltersQuerySchema.shape,
  bbox: z.string().optional().describe('Bounding box as "minLon,minLat,maxLon,maxLat"'),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  radius: z.coerce.number().positive().default(1000).describe('Radius in meters'),
});

const propertyListResponseSchema = z.object({
  data: z.array(propertySchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

const propertyParamsSchema = z.object({
  id: z.string().uuid(),
});

const officialValuationHydrationResponseSchema = z.object({
  status: z.enum(['unsupported', 'already_cached', 'accepted', 'queued', 'pending']),
  propertyId: z.string().uuid(),
  source: z.literal('woz'),
  valuationYear: z.number(),
  officialValuation: z.number().nullable(),
  officialValuationYear: z.number().nullable(),
  officialValuationVerified: z.boolean(),
  job: z
    .object({
      id: z.string().uuid(),
      state: z.string(),
      nextAttemptAt: z.string().datetime().nullable(),
    })
    .nullable(),
});

const saveResponseSchema = z.object({
  saved: z.boolean(),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

const savedPropertiesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const savedPropertiesResponseSchema = z.object({
  data: z.array(savedPropertySchema),
  total: z.number(),
  hasMore: z.boolean(),
});

const resolveQuerySchema = z.object({
  postalCode: z.string().min(1).max(15),
  houseNumber: z.coerce.number().int().positive(),
  houseNumberAddition: z.string().optional(),
  countryCode: z.string().length(2).toUpperCase().default('NL'),
  street: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
});

const resolveFoundResponseSchema = z.object({
  id: z.string().uuid(),
  countryCode: z.string(),
  address: z.string(),
  postalCode: z.string(),
  city: z.string(),
  coordinates: z
    .object({
      lon: z.number(),
      lat: z.number(),
    })
    .nullable(),
  hasActiveListing: z.boolean(),
  marketState: marketStateSchema,
  officialValuation: z.number().nullable(),
  officialValuationYear: z.number().nullable(),
  officialValuationSourceFetch: officialValuationSourceFetchSchema,
});

const resolveResponseSchema = z.nullable(resolveFoundResponseSchema);

const nearbyQuerySchema = z
  .object({
    lon: z.coerce.number().min(-180).max(180),
    lat: z.coerce.number().min(-90).max(90),
    zoom: z.coerce.number().min(0).max(22).default(17),
    pyramidVersionId: z.string().uuid().optional(),
    pyramidNodeId: z.string().min(1).optional(),
    ...mapFiltersQuerySchema.shape,
  })
  .superRefine((query, ctx) => {
    if (Boolean(query.pyramidVersionId) !== Boolean(query.pyramidNodeId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: query.pyramidVersionId ? ['pyramidNodeId'] : ['pyramidVersionId'],
        message: 'pyramidVersionId and pyramidNodeId must be provided together',
      });
    }
  });

const resolveTapQuerySchema = z.object({
  lon: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  zoom: z.coerce.number().min(0).max(22),
});

const resolveHouseNumberTapQuerySchema = resolveTapQuerySchema.extend({
  houseNumber: z.string().min(1).max(32),
});

const resolveTapCoordinateSchema = z.object({
  longitude: z.number(),
  latitude: z.number(),
});

const resolveTapSourceSchema = z.enum(['physical-tap', 'house-number-tap']);
const resolveTapMatchSchema = z.enum([
  'containing-building',
  'nearby-building',
  'nearby-property',
  'house-number',
]);

const readStateCoverageSchema = z.enum(['complete', 'partial']);

const resolveTapPropertyPreviewSchema = z.object({
  id: z.string().uuid(),
  nationalId: z.string().nullable(),
  countryCode: z.string(),
  region: z.string().nullable(),
  street: z.string(),
  houseNumber: z.number(),
  houseNumberAddition: z.string().nullable(),
  address: z.string(),
  city: z.string(),
  postalCode: z.string().nullable(),
  coordinate: resolveTapCoordinateSchema,
  imageryCoordinate: resolveTapCoordinateSchema.nullable(),
  hasListing: z.boolean(),
  hasActiveListing: z.boolean(),
  marketState: marketStateSchema,
  latestListingStatus: latestListingStatusSchema,
  askingPrice: z.number().nullable(),
  thumbnailUrl: z.string().nullable(),
  officialValuation: z.number().nullable(),
  officialValuationYear: z.number().nullable(),
  yearBuilt: z.number().nullable(),
  floorAreaM2: z.number().nullable(),
  socialScore: z.number(),
  recentSocialScore: z.number(),
  commentCount: z.number(),
  commentsDisabled: z.boolean(),
  isRead: z.boolean(),
});

const nearbyGroupedBaseSchema = z.object({
  nodeClass: z.enum(['active', 'ghost']),
  primaryPropertyId: z.string().uuid(),
  pointCount: z.number(),
  propertyIds: z.array(z.string().uuid()),
  previewPropertyIds: z.array(z.string().uuid()),
  pyramidVersionId: z.string().nullable(),
  pyramidNodeId: z.string().nullable(),
  membershipComplete: z.boolean(),
  readStateCoverage: readStateCoverageSchema,
  coordinate: z.tuple([z.number(), z.number()]).describe('[longitude, latitude]'),
  distanceMeters: z.number(),
  bbox: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .nullable()
    .describe('[west, south, east, north]'),
  activeListingCount: z.number(),
  socialCount: z.number(),
  recentSocialCount: z.number(),
  socialScoreTotal: z.number(),
  socialScoreMax: z.number(),
  recentSocialScoreTotal: z.number(),
  commentCount: z.number(),
  isRead: z.boolean(),
});

const nearbySingleResultSchema = nearbyGroupedBaseSchema.extend({
  groupKind: z.literal('single'),
  address: z.string(),
  city: z.string(),
  askingPrice: z.number().nullable(),
  thumbnailUrl: z.string().nullable(),
  hasActiveListing: z.boolean(),
  marketState: marketStateSchema,
});

const nearbyClusterResultSchema = nearbyGroupedBaseSchema.extend({
  groupKind: z.literal('cluster'),
});

const nearbyGroupedResultSchema = z.discriminatedUnion('groupKind', [
  nearbySingleResultSchema,
  nearbyClusterResultSchema,
]);

const nearbyGroupedResponseSchema = z.nullable(nearbyGroupedResultSchema);

const resolveTapGroupPreviewSchema = nearbyGroupedBaseSchema.extend({
  groupKind: z.literal('cluster'),
  completedListingCount: z.number(),
  previewProperties: z.array(resolveTapPropertyPreviewSchema),
});

const resolveTapSingleResponseSchema = z.object({
  kind: z.literal('single'),
  source: resolveTapSourceSchema,
  property: resolveTapPropertyPreviewSchema,
  coordinate: resolveTapCoordinateSchema,
  match: resolveTapMatchSchema,
});

const resolveTapGroupResponseSchema = z.object({
  kind: z.literal('group'),
  source: resolveTapSourceSchema,
  group: resolveTapGroupPreviewSchema,
  coordinate: resolveTapCoordinateSchema,
  match: resolveTapMatchSchema,
});

const resolveTapResponseSchema = z.nullable(
  z.discriminatedUnion('kind', [resolveTapSingleResponseSchema, resolveTapGroupResponseSchema])
);

type NearbyGroupedContractResult = Awaited<ReturnType<typeof resolveNearbyGroupedFeature>> & {
  pyramidVersionId?: string | null;
  pyramidNodeId?: string | null;
  membershipComplete?: boolean;
  readStateCoverage?: 'complete' | 'partial';
};

type PyramidNearbyNodeRow = {
  node_id: string;
  primary_property_id: string | null;
  node_class: 'active' | 'ghost';
  group_kind: 'single' | 'cluster';
  point_count: number | string;
  preview_property_ids: string[] | null;
  render_lon: number | string;
  render_lat: number | string;
  distance_meters: number | string;
  bbox_west: number | string | null;
  bbox_south: number | string | null;
  bbox_east: number | string | null;
  bbox_north: number | string | null;
  active_listing_count: number | string;
  completed_listing_count: number | string;
  social_count: number | string;
  recent_social_count: number | string;
  social_score_total: number | string;
  social_score_max: number | string;
  recent_social_score_total: number | string;
  comment_count: number | string;
  address: string | null;
  city: string | null;
  asking_price: number | string | null;
  thumbnail_url: string | null;
  has_active_listing: boolean | null;
  market_state: 'for-sale' | 'for-rent' | 'sold' | 'rented' | 'not-listed' | null;
  tile_status: string | null;
  validation_status: string | null;
};

type PyramidNearbyLookupStatus =
  | 'pyramid-promoted'
  | 'pyramid-empty'
  | 'pyramid-missing'
  | 'pyramid-stale'
  | 'pyramid-unavailable'
  | 'pyramid-build-active'
  | 'pyramid-build-enqueued'
  | 'pyramid-terminal'
  | 'pyramid-uncovered';

const followingNearbyQuerySchema = z.object({
  lon: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  zoom: z.coerce.number().min(0).max(22).default(17),
  ...followingMapFiltersQuerySchema.shape,
});

const PYRAMID_NEARBY_SINGLE_TAP_RADIUS_PX = 24;
const PYRAMID_NEARBY_CLUSTER_TAP_RADIUS_PX = 36;

type PropertyRow = {
  id: string;
  national_id: string | null;
  country_code: string;
  region: string | null;
  street: string;
  house_number: number;
  house_number_addition: string | null;
  city: string;
  postal_code: string | null;
  lon: number | null;
  lat: number | null;
  imagery_lon: number | null;
  imagery_lat: number | null;
  year_built: number | null;
  floor_area_m2: number | null;
  status: string;
  official_valuation: number | null;
  official_valuation_year: number | null;
  official_valuation_verified: boolean;
  comments_disabled_at: string | Date | null;
  created_at: string;
  updated_at: string;
  has_listing: boolean;
  has_active_listing: boolean;
  market_state: 'for-sale' | 'for-rent' | 'sold' | 'rented' | 'not-listed';
  latest_listing_status: 'active' | 'sold' | 'rented' | 'withdrawn' | null;
  asking_price: number | null;
  thumbnail_url: string | null;
  social_score: number;
  recent_social_score: number;
  last_social_at: string | null;
  top_level_comment_count: number;
  reply_count: number;
  property_like_count: number;
  comment_like_count: number;
  guess_count: number;
  view_count: number;
  unique_viewer_count: number;
  recent_top_level_comment_count: number;
  recent_reply_count: number;
  recent_property_like_count: number;
  recent_comment_like_count: number;
  recent_guess_count: number;
  recent_view_count: number;
  recent_unique_viewer_count: number;
  is_read?: boolean;
};

type PropertyDetailRow = PropertyRow & {
  is_liked: boolean;
  is_saved: boolean;
};

type ResolveTapSource = z.infer<typeof resolveTapSourceSchema>;
type ResolveTapMatch = z.infer<typeof resolveTapMatchSchema>;

type ResolveTapCandidateRow = PropertyRow & {
  distance_meters: number | string;
  group_distance_meters: number | string;
  total_count: number | string;
};

type ResolveTapPropertyPreview = z.infer<typeof resolveTapPropertyPreviewSchema>;
type ResolveTapGroupPreview = z.infer<typeof resolveTapGroupPreviewSchema>;
type ResolveTapResponse = z.infer<typeof resolveTapResponseSchema>;

function normalizeComparableAddressPart(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .toUpperCase();
}

function buildComparableAddressExpression(column: string) {
  return sql`trim(upper(
    regexp_replace(
      regexp_replace(normalize(${sql.raw(column)}, NFKD), '[\\u0300-\\u036f]', '', 'g'),
      '[^[:alnum:]]+',
      ' ',
      'g'
    )
  ))`;
}

function buildComparableAddressPredicate(column: string, value: string) {
  const normalizedValue = normalizeComparableAddressPart(value);
  return sql`${buildComparableAddressExpression(column)} = ${normalizedValue}`;
}

function buildRadiusConditions(lon: number, lat: number, radiusMeters: number) {
  const latRadiusDegrees = radiusMeters / 110574;
  const lonScale = Math.max(Math.cos((lat * Math.PI) / 180), 0.000001);
  const lonRadiusDegrees = radiusMeters / (111320 * lonScale);

  const minLon = Math.max(-180, lon - lonRadiusDegrees);
  const maxLon = Math.min(180, lon + lonRadiusDegrees);
  const minLat = Math.max(-90, lat - latRadiusDegrees);
  const maxLat = Math.min(90, lat + latRadiusDegrees);

  return [
    sql`p.geometry && ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)`,
    sql`ST_DWithin(
      p.geometry::geography,
      ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography,
      ${radiusMeters}
    )`,
  ];
}

const IMAGERY_BUILDING_SEARCH_DEGREES = 0.001;
const IMAGERY_BUILDING_MAX_DISTANCE_METERS = 80;

const imageryJoin = sql`LEFT JOIN LATERAL (
  SELECT
    ST_PointOnSurface(geometry) AS imagery_geom,
    ST_Distance(p.geometry::geography, geometry::geography) AS distance_to_building_m
  FROM osm_buildings
  WHERE p.geometry IS NOT NULL
    AND geometry && ST_Expand(p.geometry, ${IMAGERY_BUILDING_SEARCH_DEGREES})
  ORDER BY p.geometry <-> geometry
  LIMIT 1
) img ON true`;

const imageryLonSelect = sql`CASE
  WHEN p.geometry IS NULL THEN NULL
  WHEN p.country_code = 'NL'
    AND img.imagery_geom IS NOT NULL
    AND img.distance_to_building_m <= ${IMAGERY_BUILDING_MAX_DISTANCE_METERS}
    THEN ST_X(img.imagery_geom)
  ELSE ST_X(p.geometry)
END`;

const imageryLatSelect = sql`CASE
  WHEN p.geometry IS NULL THEN NULL
  WHEN p.country_code = 'NL'
    AND img.imagery_geom IS NOT NULL
    AND img.distance_to_building_m <= ${IMAGERY_BUILDING_MAX_DISTANCE_METERS}
    THEN ST_Y(img.imagery_geom)
  ELSE ST_Y(p.geometry)
END`;

const propertyGeometryImageryLonSelect = sql`CASE
  WHEN p.geometry IS NULL THEN NULL
  ELSE ST_X(p.geometry)
END`;

const propertyGeometryImageryLatSelect = sql`CASE
  WHEN p.geometry IS NULL THEN NULL
  ELSE ST_Y(p.geometry)
END`;

function mapPropertyBaseRow(row: {
  id: string;
  national_id: string | null;
  country_code: string;
  region: string | null;
  street: string;
  house_number: number;
  house_number_addition: string | null;
  city: string;
  postal_code: string | null;
  lon: number | null;
  lat: number | null;
  imagery_lon?: number | null;
  imagery_lat?: number | null;
  year_built: number | null;
  floor_area_m2: number | null;
  status: string;
  official_valuation: number | null;
  official_valuation_year: number | null;
  official_valuation_verified?: boolean;
  comments_disabled_at?: string | Date | null;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: row.id,
    nationalId: row.national_id,
    countryCode: row.country_code,
    region: row.region,
    street: row.street,
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
      isValidCountryCode(row.country_code) ? row.country_code : undefined
    ),
    city: row.city,
    postalCode: row.postal_code,
    geometry:
      row.lon != null && row.lat != null
        ? { type: 'Point' as const, coordinates: [row.lon, row.lat] as [number, number] }
        : null,
    imageryGeometry:
      row.imagery_lon != null && row.imagery_lat != null
        ? {
            type: 'Point' as const,
            coordinates: [row.imagery_lon, row.imagery_lat] as [number, number],
          }
        : null,
    yearBuilt: row.year_built != null ? Number(row.year_built) : null,
    floorAreaM2: row.floor_area_m2 != null ? Number(row.floor_area_m2) : null,
    status: row.status as 'active' | 'inactive' | 'demolished',
    officialValuation: row.official_valuation != null ? Number(row.official_valuation) : null,
    officialValuationYear:
      row.official_valuation_year != null ? Number(row.official_valuation_year) : null,
    officialValuationSourceFetch: getOfficialValuationSourceFetchHint(row.country_code),
    commentsDisabled: row.comments_disabled_at != null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapPublicPropertyRow(row: PropertyRow) {
  const commentsDisabled = row.comments_disabled_at != null;

  return {
    ...mapPropertyBaseRow(row),
    hasListing: row.has_listing,
    hasActiveListing: row.has_active_listing,
    marketState: row.market_state,
    latestListingStatus: row.latest_listing_status,
    askingPrice: row.asking_price != null ? Number(row.asking_price) : null,
    thumbnailUrl: row.thumbnail_url,
    socialScore: Number(row.social_score),
    recentSocialScore: Number(row.recent_social_score),
    lastSocialAt: row.last_social_at ? new Date(row.last_social_at).toISOString() : null,
    topLevelCommentCount: commentsDisabled ? 0 : Number(row.top_level_comment_count),
    replyCount: commentsDisabled ? 0 : Number(row.reply_count),
    propertyLikeCount: Number(row.property_like_count),
    commentLikeCount: commentsDisabled ? 0 : Number(row.comment_like_count),
    guessCount: Number(row.guess_count),
    viewCount: Number(row.view_count),
    uniqueViewerCount: Number(row.unique_viewer_count),
    recentTopLevelCommentCount: commentsDisabled ? 0 : Number(row.recent_top_level_comment_count),
    recentReplyCount: commentsDisabled ? 0 : Number(row.recent_reply_count),
    recentPropertyLikeCount: Number(row.recent_property_like_count),
    recentCommentLikeCount: commentsDisabled ? 0 : Number(row.recent_comment_like_count),
    recentGuessCount: Number(row.recent_guess_count),
    recentViewCount: Number(row.recent_view_count),
    recentUniqueViewerCount: Number(row.recent_unique_viewer_count),
    isRead: Boolean(row.is_read),
  };
}

function mapNearbyGroupedResult(result: NearbyGroupedContractResult | null, isRead = false) {
  if (!result) {
    return null;
  }

  const membershipComplete = result.membershipComplete ?? true;
  const readStateCoverage =
    result.readStateCoverage ?? (membershipComplete ? 'complete' : 'partial');

  const baseResult = {
    nodeClass: result.nodeClass,
    primaryPropertyId: result.primaryPropertyId,
    pointCount: result.pointCount,
    propertyIds: result.propertyIds,
    previewPropertyIds: result.previewPropertyIds,
    pyramidVersionId: result.pyramidVersionId ?? null,
    pyramidNodeId: result.pyramidNodeId ?? null,
    membershipComplete,
    readStateCoverage,
    coordinate: result.coordinate,
    distanceMeters: result.distanceMeters,
    bbox: result.bbox,
    activeListingCount: result.activeListingCount,
    socialCount: result.socialCount,
    recentSocialCount: result.recentSocialCount,
    socialScoreTotal: result.socialScoreTotal,
    socialScoreMax: result.socialScoreMax,
    recentSocialScoreTotal: result.recentSocialScoreTotal,
    commentCount: result.commentCount,
    isRead,
  };

  if (result.groupKind === 'single') {
    if (
      result.address == null ||
      result.city == null ||
      result.hasActiveListing == null ||
      result.marketState == null
    ) {
      throw new Error(
        `Grouped nearby single ${result.primaryPropertyId} is missing required preview fields`
      );
    }

    return {
      ...baseResult,
      groupKind: 'single' as const,
      address: result.address,
      city: result.city,
      askingPrice: result.askingPrice,
      thumbnailUrl: result.thumbnailUrl,
      hasActiveListing: result.hasActiveListing,
      marketState: result.marketState,
    };
  }

  return {
    ...baseResult,
    groupKind: 'cluster' as const,
  };
}

function isPyramidSchemaUnavailable(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === '42P01' || code === '42703' || code === '42883') {
    return true;
  }
  const cause = (error as { cause?: unknown } | null)?.cause;
  if (cause && cause !== error && isPyramidSchemaUnavailable(cause)) {
    return true;
  }
  const message = error instanceof Error ? error.message : '';
  return (
    message.includes('property_tile_pyramid_') &&
    (message.includes('does not exist') || message.includes('Failed query'))
  );
}

function hasPyramidNodeQueryPair(query: {
  pyramidVersionId?: string;
  pyramidNodeId?: string;
}): query is { pyramidVersionId: string; pyramidNodeId: string } {
  return Boolean(query.pyramidVersionId && query.pyramidNodeId);
}

function pyramidOwnerTileForCoordinate(lon: number, lat: number, zoom: number) {
  const [worldX, worldY] = lngLatToWorldUnits(lon, lat, zoom);
  const maxTileCoord = 2 ** zoom - 1;
  return {
    z: zoom,
    x: Math.max(0, Math.min(maxTileCoord, Math.floor(worldX / PROPERTY_TILE_EXTENT))),
    y: Math.max(0, Math.min(maxTileCoord, Math.floor(worldY / PROPERTY_TILE_EXTENT))),
  };
}

function getPyramidOwnerTileNeighborhood(tile: { z: number; x: number; y: number }) {
  const tileCount = Math.pow(2, tile.z);
  const tiles: Array<{ z: number; x: number; y: number }> = [];
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

function mapPyramidNearbyNodeRow(
  row: PyramidNearbyNodeRow | null,
  versionId: string
): NearbyGroupedContractResult | null {
  if (!row) {
    return null;
  }

  const primaryPropertyId = row.primary_property_id ?? row.preview_property_ids?.[0] ?? null;
  if (!primaryPropertyId) {
    return null;
  }

  const bbox =
    row.bbox_west != null &&
    row.bbox_south != null &&
    row.bbox_east != null &&
    row.bbox_north != null
      ? ([
          Number(row.bbox_west),
          Number(row.bbox_south),
          Number(row.bbox_east),
          Number(row.bbox_north),
        ] as [number, number, number, number])
      : null;

  const baseResult = {
    nodeClass: row.node_class,
    primaryPropertyId,
    pointCount: Number(row.point_count),
    propertyIds: row.group_kind === 'single' ? [primaryPropertyId] : [],
    previewPropertyIds: row.preview_property_ids ?? [],
    pyramidVersionId: versionId,
    pyramidNodeId: row.node_id,
    membershipComplete: row.group_kind === 'single',
    readStateCoverage: row.group_kind === 'single' ? ('complete' as const) : ('partial' as const),
    coordinate: [Number(row.render_lon), Number(row.render_lat)] as [number, number],
    distanceMeters: Number(row.distance_meters),
    bbox,
    activeListingCount: Number(row.active_listing_count),
    completedListingCount: Number(row.completed_listing_count),
    socialCount: Number(row.social_count),
    recentSocialCount: Number(row.recent_social_count),
    socialScoreTotal: Number(row.social_score_total),
    socialScoreMax: Number(row.social_score_max),
    recentSocialScoreTotal: Number(row.recent_social_score_total),
    commentCount: Number(row.comment_count),
  };

  if (row.group_kind === 'single') {
    return {
      ...baseResult,
      groupKind: 'single' as const,
      address: row.address ?? '',
      city: row.city ?? '',
      askingPrice: row.asking_price == null ? null : Number(row.asking_price),
      thumbnailUrl: row.thumbnail_url,
      hasActiveListing: row.has_active_listing ?? false,
      marketState: row.market_state ?? 'not-listed',
      ownerTile: { z: 0, x: 0, y: 0 },
      anchorWorldX: 0,
      anchorWorldY: 0,
    };
  }

  return {
    ...baseResult,
    groupKind: 'cluster' as const,
    address: null,
    city: null,
    askingPrice: null,
    thumbnailUrl: null,
    hasActiveListing: null,
    marketState: null,
    ownerTile: { z: 0, x: 0, y: 0 },
    anchorWorldX: 0,
    anchorWorldY: 0,
  };
}

function isServeablePyramidNearbyTile(row: {
  tile_status: string | null;
  validation_status: string | null;
}): boolean {
  return (
    row.validation_status === 'validated' &&
    (row.tile_status === 'valid_empty' ||
      row.tile_status === 'valid_nodes' ||
      row.tile_status === 'valid_encoded')
  );
}

async function hasServeablePyramidTileManifest(input: {
  versionId: string;
  tile: { z: number; x: number; y: number };
}): Promise<boolean> {
  const rows = await db.execute<{
    tile_status: string | null;
    validation_status: string | null;
  }>(sql`
    SELECT t.tile_status, t.validation_status
    FROM property_tile_pyramid_tiles t
    WHERE t.version_id = ${input.versionId}::uuid
      AND t.z = ${input.tile.z}
      AND t.x = ${input.tile.x}
      AND t.y = ${input.tile.y}
    LIMIT 1
  `);
  return Array.from(rows).some(isServeablePyramidNearbyTile);
}

async function resolvePyramidNearbyNodeById(input: {
  lon: number;
  lat: number;
  pyramidVersionId: string;
  pyramidNodeId: string;
}): Promise<{
  result: NearbyGroupedContractResult | null;
  status: PyramidNearbyLookupStatus;
  versionId?: string;
}> {
  const slot = getDefaultPropertyTilePyramidSlot();
  const current = await lookupCurrentPropertyTilePyramidVersion(slot);
  if (current.state !== 'current') {
    return { result: null, status: 'pyramid-unavailable' };
  }
  if (current.version.versionId !== input.pyramidVersionId) {
    return { result: null, status: 'pyramid-stale', versionId: current.version.versionId };
  }

  const rows = await db.execute<PyramidNearbyNodeRow>(sql`
    WITH tap AS (
      SELECT ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326) AS geom
    )
    SELECT
      node_id,
      COALESCE(representative_property_id::text, preview_property_ids[1]::text) AS primary_property_id,
      node_class,
      group_kind,
      point_count,
      ARRAY(SELECT unnest(preview_property_ids)::text) AS preview_property_ids,
      render_lon,
      render_lat,
      ST_Distance(
        render_geometry::geography,
        tap.geom::geography
      ) AS distance_meters,
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
      t.tile_status,
      t.validation_status
    FROM property_tile_pyramid_nodes n
    CROSS JOIN tap
    LEFT JOIN property_tile_pyramid_tiles t
      ON t.version_id = n.version_id
     AND t.z = n.z
     AND t.x = n.x
     AND t.y = n.y
    WHERE n.version_id = ${input.pyramidVersionId}::uuid
      AND n.node_id = ${input.pyramidNodeId}
    LIMIT 1
  `);

  const row = Array.from(rows)[0] ?? null;
  if (!row) {
    return { result: null, status: 'pyramid-empty', versionId: current.version.versionId };
  }
  if (!isServeablePyramidNearbyTile(row)) {
    return { result: null, status: 'pyramid-missing', versionId: current.version.versionId };
  }

  const result = mapPyramidNearbyNodeRow(row, input.pyramidVersionId);
  return {
    result,
    status: result ? 'pyramid-promoted' : 'pyramid-empty',
    versionId: current.version.versionId,
  };
}

function pyramidNearbySearchRadiusMeters(lat: number, zoom: number): number {
  const metersPerPixel =
    (40075016.686 * Math.max(Math.cos((lat * Math.PI) / 180), 0.000001)) / (512 * 2 ** zoom);
  return PYRAMID_NEARBY_CLUSTER_TAP_RADIUS_PX * metersPerPixel;
}

function normalizePyramidNearbyServingZoom(zoom: number, maxZoom: number): number {
  return Math.max(0, Math.min(maxZoom, Math.floor(zoom)));
}

function isDefaultPyramidNearbyZoom(zoom: number, maxZoom: number): boolean {
  return Math.floor(zoom) <= maxZoom;
}

async function resolvePyramidNearbyNodeAtPoint(input: {
  lon: number;
  lat: number;
  zoom: number;
  logger: { warn(bindings: Record<string, unknown>, message: string): void };
}): Promise<{
  result: NearbyGroupedContractResult | null;
  status: PyramidNearbyLookupStatus;
  versionId?: string;
}> {
  const slot = getDefaultPropertyTilePyramidSlot();
  const maxZoom = getPropertyTilePyramidMaxZoom();
  const current = await lookupCurrentPropertyTilePyramidVersion(slot);
  if (current.state !== 'current') {
    const servingZoom = normalizePyramidNearbyServingZoom(input.zoom, maxZoom);
    if (!isDefaultPropertyTilePyramidPointCovered({ ...input, zoom: servingZoom, maxZoom })) {
      return { result: null, status: 'pyramid-uncovered' };
    }

    await safeRequestPropertyTilePyramidBuild(
      {
        reason: 'nearby-fallback-miss',
        slot,
      },
      input.logger,
      {
        lon: input.lon,
        lat: input.lat,
        zoom: input.zoom,
        servingZoom,
      }
    );
    return { result: null, status: current.tileStatus };
  }

  const versionCoverage = current.version.coverage;
  const servingZoom = normalizePyramidNearbyServingZoom(
    input.zoom,
    versionCoverage?.maxZoom ?? current.version.maxZoom
  );
  if (
    !versionCoverage ||
    !isPropertyTilePyramidPointCoveredByCoverage({
      coverage: versionCoverage,
      lon: input.lon,
      lat: input.lat,
      zoom: servingZoom,
    })
  ) {
    return { result: null, status: 'pyramid-uncovered', versionId: current.version.versionId };
  }

  const tapOwnerTile = pyramidOwnerTileForCoordinate(input.lon, input.lat, servingZoom);
  const ownerTileNeighborhood = getPyramidOwnerTileNeighborhood(tapOwnerTile);
  const hasOwnerManifest = await hasServeablePyramidTileManifest({
    versionId: current.version.versionId,
    tile: tapOwnerTile,
  });
  if (!hasOwnerManifest) {
    await safeRequestPropertyTilePyramidBuild(
      {
        reason: 'nearby-fallback-miss',
        slot,
      },
      input.logger,
      {
        lon: input.lon,
        lat: input.lat,
        zoom: input.zoom,
        servingZoom,
        missingOwnerTile: tapOwnerTile,
      }
    );
    return { result: null, status: 'pyramid-missing', versionId: current.version.versionId };
  }

  const searchRadiusMeters = pyramidNearbySearchRadiusMeters(input.lat, servingZoom);
  const ownerTileRows = sql.join(
    ownerTileNeighborhood.map(
      (tile) => sql`(${tile.z}::integer, ${tile.x}::integer, ${tile.y}::integer)`
    ),
    sql`, `
  );
  const rows = await db.execute<PyramidNearbyNodeRow>(sql`
    WITH tap AS (
      SELECT ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326) AS geom
    ),
    tap_owner_tiles(z, x, y) AS (
      VALUES ${ownerTileRows}
    )
    SELECT
      node_id,
      COALESCE(representative_property_id::text, preview_property_ids[1]::text) AS primary_property_id,
      node_class,
      group_kind,
      point_count,
      ARRAY(SELECT unnest(preview_property_ids)::text) AS preview_property_ids,
      render_lon,
      render_lat,
      ST_Distance(render_geometry::geography, tap.geom::geography) AS distance_meters,
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
      t.tile_status,
      t.validation_status
    FROM property_tile_pyramid_nodes n
    JOIN property_tile_pyramid_tiles t
      ON t.version_id = n.version_id
     AND t.z = n.z
     AND t.x = n.x
     AND t.y = n.y
     AND t.validation_status = 'validated'::property_tile_pyramid_tile_validation_status
     AND t.tile_status IN (
       'valid_empty'::property_tile_pyramid_tile_status,
       'valid_nodes'::property_tile_pyramid_tile_status,
       'valid_encoded'::property_tile_pyramid_tile_status
     )
    JOIN tap_owner_tiles ot
      ON ot.z = n.z
     AND ot.x = n.x
     AND ot.y = n.y
    CROSS JOIN tap
    WHERE n.version_id = ${current.version.versionId}::uuid
      AND n.z = ${servingZoom}
      AND ST_DWithin(render_geometry::geography, tap.geom::geography, ${searchRadiusMeters})
      AND ST_Distance(render_geometry::geography, tap.geom::geography) <=
        CASE
          WHEN group_kind = 'single'
            THEN ${PYRAMID_NEARBY_SINGLE_TAP_RADIUS_PX}::double precision / ${PYRAMID_NEARBY_CLUSTER_TAP_RADIUS_PX}::double precision * ${searchRadiusMeters}
          ELSE ${searchRadiusMeters}
        END
    ORDER BY ST_Distance(render_geometry::geography, tap.geom::geography), point_count DESC
    LIMIT 1
  `);

  return {
    result: mapPyramidNearbyNodeRow(Array.from(rows)[0] ?? null, current.version.versionId),
    status: 'pyramid-empty',
    versionId: current.version.versionId,
  };
}

function parseBboxString(bbox: string) {
  const [minLon, minLat, maxLon, maxLat] = bbox.split(',').map(Number);
  if ([minLon, minLat, maxLon, maxLat].some((value) => value == null || Number.isNaN(value))) {
    return null;
  }

  return { minLon, minLat, maxLon, maxLat };
}

function buildPropertyWhereConditions(params: {
  city?: string;
  bbox?: string;
  lat?: number;
  lon?: number;
  radius: number;
}) {
  const conditions: SQL[] = [];

  if (params.city) {
    conditions.push(sql`p.city = ${params.city}`);
  }

  if (params.bbox) {
    const parsed = parseBboxString(params.bbox);
    if (parsed) {
      conditions.push(
        sql`p.geometry && ST_MakeEnvelope(${parsed.minLon}, ${parsed.minLat}, ${parsed.maxLon}, ${parsed.maxLat}, 4326)`
      );
    }
  }

  if (params.lat !== undefined && params.lon !== undefined) {
    conditions.push(...buildRadiusConditions(params.lon, params.lat, params.radius));
  }

  return conditions;
}

function buildPublicPropertySelect(options: { useSnappedImagery?: boolean } = {}): SQL {
  const useSnappedImagery = options.useSnappedImagery ?? true;
  const imageryLonExpression = useSnappedImagery
    ? imageryLonSelect
    : propertyGeometryImageryLonSelect;
  const imageryLatExpression = useSnappedImagery
    ? imageryLatSelect
    : propertyGeometryImageryLatSelect;

  return sql`
  p.id,
  p.national_id,
  p.country_code,
  p.region,
  p.street,
  p.house_number,
  p.house_number_addition,
  p.city,
  p.postal_code,
  ST_X(p.geometry) AS lon,
  ST_Y(p.geometry) AS lat,
  ${imageryLonExpression} AS imagery_lon,
  ${imageryLatExpression} AS imagery_lat,
  p.year_built,
  p.floor_area_m2,
  p.status,
  p.official_valuation,
  p.official_valuation_year,
  p.official_valuation_verified,
  p.comments_disabled_at,
  p.created_at,
  p.updated_at,
  lf.has_listing,
  lf.has_active_listing,
  lf.market_state,
  lf.latest_listing_status,
  lf.asking_price,
  lf.thumbnail_url,
  sf.social_score,
  sf.recent_social_score,
  sf.last_social_at,
  sf.top_level_comment_count,
  sf.reply_count,
  sf.property_like_count,
  sf.comment_like_count,
  sf.guess_count,
  sf.view_count,
  sf.unique_viewer_count,
  sf.recent_top_level_comment_count,
  sf.recent_reply_count,
  sf.recent_property_like_count,
  sf.recent_comment_like_count,
  sf.recent_guess_count,
  sf.recent_view_count,
  sf.recent_unique_viewer_count
`;
}

const PUBLIC_PROPERTY_SELECT = buildPublicPropertySelect();
const PUBLIC_PROPERTY_LIST_SELECT = buildPublicPropertySelect({ useSnappedImagery: false });

const RESOLVE_TAP_BUILDING_SEARCH_RADIUS_METERS = 16;
const RESOLVE_TAP_BUILDING_PROPERTY_TOLERANCE_METERS = 3;
const RESOLVE_TAP_PROPERTY_SEARCH_RADIUS_METERS = 12;
const RESOLVE_TAP_AMBIGUOUS_PROPERTY_EPSILON_METERS = 1.5;
const RESOLVE_TAP_MAX_MEMBER_ROWS = 200;
const RESOLVE_HOUSE_NUMBER_TAP_SEARCH_RADIUS_METERS = 18;

function buildResolveTapEnvelope(lon: number, lat: number, radiusMeters: number) {
  const latRadiusDegrees = radiusMeters / 110574;
  const lonScale = Math.max(Math.cos((lat * Math.PI) / 180), 0.000001);
  const lonRadiusDegrees = radiusMeters / (111320 * lonScale);

  return {
    minLon: Math.max(-180, lon - lonRadiusDegrees),
    minLat: Math.max(-90, lat - latRadiusDegrees),
    maxLon: Math.min(180, lon + lonRadiusDegrees),
    maxLat: Math.min(90, lat + latRadiusDegrees),
  };
}

function parseHouseNumberLabel(raw: string): { houseNumber: number; addition: string | null } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(\d+)(?:\s*[-/ ]?\s*(.*))?$/u);
  if (!match) return null;

  const houseNumber = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(houseNumber) || houseNumber <= 0) return null;

  return {
    houseNumber,
    addition: match[2]?.trim().toUpperCase() || null,
  };
}

function compareResolveTapPropertyPriority(
  a: ResolveTapPropertyPreview,
  b: ResolveTapPropertyPreview
): number {
  return (
    Number(b.hasActiveListing) - Number(a.hasActiveListing) ||
    Number(b.latestListingStatus === 'sold' || b.latestListingStatus === 'rented') -
      Number(a.latestListingStatus === 'sold' || a.latestListingStatus === 'rented') ||
    b.socialScore - a.socialScore ||
    b.recentSocialScore - a.recentSocialScore ||
    b.commentCount - a.commentCount ||
    a.id.localeCompare(b.id)
  );
}

function mapResolveTapPropertyPreview(
  row: ResolveTapCandidateRow,
  isRead: boolean
): ResolveTapPropertyPreview | null {
  const property = mapPublicPropertyRow(row);
  const coordinates = property.geometry?.coordinates;
  if (!coordinates) {
    return null;
  }

  const imageryCoordinates = property.imageryGeometry?.coordinates ?? null;
  return {
    id: property.id,
    nationalId: property.nationalId,
    countryCode: property.countryCode,
    region: property.region,
    street: property.street,
    houseNumber: property.houseNumber,
    houseNumberAddition: property.houseNumberAddition,
    address: property.address,
    city: property.city,
    postalCode: property.postalCode,
    coordinate: {
      longitude: coordinates[0],
      latitude: coordinates[1],
    },
    imageryCoordinate: imageryCoordinates
      ? {
          longitude: imageryCoordinates[0],
          latitude: imageryCoordinates[1],
        }
      : null,
    hasListing: property.hasListing,
    hasActiveListing: property.hasActiveListing,
    marketState: property.marketState,
    latestListingStatus: property.latestListingStatus,
    askingPrice: property.askingPrice,
    thumbnailUrl: property.thumbnailUrl,
    officialValuation: property.officialValuation,
    officialValuationYear: property.officialValuationYear,
    yearBuilt: property.yearBuilt,
    floorAreaM2: property.floorAreaM2,
    socialScore: property.socialScore,
    recentSocialScore: property.recentSocialScore,
    commentCount: property.topLevelCommentCount + property.replyCount,
    commentsDisabled: property.commentsDisabled,
    isRead,
  };
}

function buildResolveTapGroupPreview(input: {
  rows: ResolveTapCandidateRow[];
  previews: ResolveTapPropertyPreview[];
  readIds: Set<string>;
}): ResolveTapGroupPreview {
  const sortedPreviews = [...input.previews].sort(compareResolveTapPropertyPriority);
  const propertyIds = sortedPreviews.map((property) => property.id);
  const previewProperties = sortedPreviews.slice(0, PROPERTY_PREVIEW_MEMBER_LIMIT);
  const previewPropertyIds = previewProperties.map((property) => property.id);
  const totalCount = Math.max(Number(input.rows[0]?.total_count ?? sortedPreviews.length), 0);
  const membershipComplete = input.rows.length >= totalCount;
  const completedListingCount = sortedPreviews.filter(
    (property) =>
      property.latestListingStatus === 'sold' || property.latestListingStatus === 'rented'
  ).length;
  const activeListingCount = sortedPreviews.filter((property) => property.hasActiveListing).length;
  const socialProperties = sortedPreviews.filter(
    (property) => property.socialScore >= ACTIVE_SOCIAL_SCORE_THRESHOLD
  );
  const recentSocialProperties = sortedPreviews.filter(
    (property) => property.recentSocialScore >= ACTIVE_SOCIAL_SCORE_THRESHOLD
  );
  const socialScoreTotal = sortedPreviews.reduce(
    (total, property) => total + property.socialScore,
    0
  );
  const recentSocialScoreTotal = sortedPreviews.reduce(
    (total, property) => total + property.recentSocialScore,
    0
  );
  const socialScoreMax = sortedPreviews.reduce(
    (max, property) => Math.max(max, property.socialScore),
    0
  );
  const commentCount = sortedPreviews.reduce((total, property) => total + property.commentCount, 0);
  const longitudes = sortedPreviews.map((property) => property.coordinate.longitude);
  const latitudes = sortedPreviews.map((property) => property.coordinate.latitude);
  const primaryProperty = sortedPreviews[0];
  const allRead = propertyIds.length > 0 && propertyIds.every((id) => input.readIds.has(id));

  return {
    nodeClass: 'active',
    groupKind: 'cluster',
    primaryPropertyId: primaryProperty.id,
    pointCount: totalCount,
    propertyIds,
    previewPropertyIds,
    pyramidVersionId: null,
    pyramidNodeId: null,
    membershipComplete,
    readStateCoverage: membershipComplete ? 'complete' : 'partial',
    coordinate: [primaryProperty.coordinate.longitude, primaryProperty.coordinate.latitude],
    distanceMeters: Math.min(...input.rows.map((row) => Number(row.distance_meters))),
    bbox:
      sortedPreviews.length > 1
        ? [
            Math.min(...longitudes),
            Math.min(...latitudes),
            Math.max(...longitudes),
            Math.max(...latitudes),
          ]
        : null,
    activeListingCount,
    completedListingCount,
    socialCount: socialProperties.length,
    recentSocialCount: recentSocialProperties.length,
    socialScoreTotal,
    socialScoreMax,
    recentSocialScoreTotal,
    commentCount,
    isRead: membershipComplete && allRead,
    previewProperties,
  };
}

function buildResolveTapResponse(input: {
  rows: ResolveTapCandidateRow[];
  readIds: Set<string>;
  lon: number;
  lat: number;
  match: ResolveTapMatch;
  source?: ResolveTapSource;
}): ResolveTapResponse {
  const previews = input.rows
    .map((row) => mapResolveTapPropertyPreview(row, input.readIds.has(row.id)))
    .filter((preview): preview is ResolveTapPropertyPreview => preview != null);
  if (previews.length === 0) {
    return null;
  }

  const coordinate = { longitude: input.lon, latitude: input.lat };
  if (Number(input.rows[0]?.total_count ?? previews.length) <= 1 && previews.length === 1) {
    return {
      kind: 'single',
      source: input.source ?? 'physical-tap',
      property: previews[0],
      coordinate,
      match: input.match,
    };
  }

  return {
    kind: 'group',
    source: input.source ?? 'physical-tap',
    group: buildResolveTapGroupPreview({ rows: input.rows, previews, readIds: input.readIds }),
    coordinate,
    match: input.match,
  };
}

async function buildResolveTapResponseWithReadState(input: {
  rows: ResolveTapCandidateRow[];
  viewer: PropertyReadViewer | null;
  lon: number;
  lat: number;
  match: ResolveTapMatch;
  source?: ResolveTapSource;
}): Promise<ResolveTapResponse> {
  const readIds = input.viewer
    ? await getReadPropertyIdSet(
        input.rows.map((row) => row.id),
        input.viewer
      )
    : new Set<string>();

  return buildResolveTapResponse({ ...input, readIds });
}

async function fetchResolveTapBuildingRows(input: {
  lon: number;
  lat: number;
  mode: 'containing' | 'nearby';
}): Promise<ResolveTapCandidateRow[]> {
  const envelope = buildResolveTapEnvelope(
    input.lon,
    input.lat,
    input.mode === 'containing' ? 25 : RESOLVE_TAP_BUILDING_SEARCH_RADIUS_METERS
  );
  const buildingPredicate =
    input.mode === 'containing'
      ? sql`ST_Covers(b.geometry, tap.geom)`
      : sql`ST_DWithin(b.geometry::geography, tap.geom::geography, ${RESOLVE_TAP_BUILDING_SEARCH_RADIUS_METERS})`;
  const buildingOrder =
    input.mode === 'containing'
      ? sql`ST_Area(b.geometry::geography) ASC, b.id ASC`
      : sql`ST_Distance(b.geometry::geography, tap.geom::geography) ASC, ST_Area(b.geometry::geography) ASC, b.id ASC`;

  const rows = await db.execute<ResolveTapCandidateRow>(sql`
    WITH tap AS (
      SELECT ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326) AS geom
    ),
    chosen_building AS MATERIALIZED (
      SELECT b.id, b.geometry
      FROM osm_buildings b
      CROSS JOIN tap
      WHERE b.geometry && ST_MakeEnvelope(
        ${envelope.minLon},
        ${envelope.minLat},
        ${envelope.maxLon},
        ${envelope.maxLat},
        4326
      )
        AND ${buildingPredicate}
        AND EXISTS (
          SELECT 1
          FROM properties candidate
          WHERE candidate.status = 'active'
            AND candidate.geometry IS NOT NULL
            AND candidate.geometry && ST_Envelope(b.geometry)
            AND ST_DWithin(
              candidate.geometry::geography,
              b.geometry::geography,
              ${RESOLVE_TAP_BUILDING_PROPERTY_TOLERANCE_METERS}
            )
        )
      ORDER BY ${buildingOrder}
      LIMIT 1
    ),
    candidate_ids AS MATERIALIZED (
      SELECT
        p.id,
        ST_Distance(p.geometry::geography, tap.geom::geography) AS distance_meters,
        ST_Distance(chosen_building.geometry::geography, tap.geom::geography) AS group_distance_meters,
        COUNT(*) OVER ()::int AS total_count
      FROM chosen_building
      CROSS JOIN tap
      INNER JOIN properties p
        ON p.status = 'active'
       AND p.geometry IS NOT NULL
       AND p.geometry && ST_Envelope(chosen_building.geometry)
       AND ST_DWithin(
         p.geometry::geography,
         chosen_building.geometry::geography,
         ${RESOLVE_TAP_BUILDING_PROPERTY_TOLERANCE_METERS}
       )
      ORDER BY p.id
      LIMIT ${RESOLVE_TAP_MAX_MEMBER_ROWS}
    )
    SELECT
      ${PUBLIC_PROPERTY_SELECT},
      ci.distance_meters,
      ci.group_distance_meters,
      ci.total_count
    FROM candidate_ids ci
    INNER JOIN properties p ON p.id = ci.id
    ${buildPropertyListingFactsJoin('p', 'lf')}
    ${buildPropertySocialFactsJoin('p', 'sf')}
    ${imageryJoin}
  `);

  return Array.from(rows);
}

async function fetchResolveTapNearbyPropertyRows(input: {
  lon: number;
  lat: number;
}): Promise<ResolveTapCandidateRow[]> {
  const envelope = buildResolveTapEnvelope(
    input.lon,
    input.lat,
    RESOLVE_TAP_PROPERTY_SEARCH_RADIUS_METERS
  );
  const candidateRows = await db.execute<ResolveTapCandidateRow>(sql`
    WITH tap AS (
      SELECT ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326) AS geom
    ),
    ranked AS MATERIALIZED (
      SELECT
        p.id,
        ST_Distance(p.geometry::geography, tap.geom::geography) AS distance_meters
      FROM properties p
      CROSS JOIN tap
      WHERE p.status = 'active'
        AND p.geometry IS NOT NULL
        AND p.geometry && ST_MakeEnvelope(
          ${envelope.minLon},
          ${envelope.minLat},
          ${envelope.maxLon},
          ${envelope.maxLat},
          4326
        )
        AND ST_DWithin(
          p.geometry::geography,
          tap.geom::geography,
          ${RESOLVE_TAP_PROPERTY_SEARCH_RADIUS_METERS}
        )
      ORDER BY ST_Distance(p.geometry::geography, tap.geom::geography), p.id
      LIMIT ${RESOLVE_TAP_MAX_MEMBER_ROWS}
    ),
    best AS (
      SELECT MIN(distance_meters) AS distance_meters
      FROM ranked
    ),
    candidate_ids AS MATERIALIZED (
      SELECT
        ranked.id,
        ranked.distance_meters,
        ranked.distance_meters AS group_distance_meters,
        COUNT(*) OVER ()::int AS total_count
      FROM ranked, best
      WHERE ranked.distance_meters <= best.distance_meters + ${RESOLVE_TAP_AMBIGUOUS_PROPERTY_EPSILON_METERS}
      ORDER BY ranked.distance_meters, ranked.id
    )
    SELECT
      ${PUBLIC_PROPERTY_SELECT},
      ci.distance_meters,
      ci.group_distance_meters,
      ci.total_count
    FROM candidate_ids ci
    INNER JOIN properties p ON p.id = ci.id
    ${buildPropertyListingFactsJoin('p', 'lf')}
    ${buildPropertySocialFactsJoin('p', 'sf')}
    ${imageryJoin}
  `);

  return Array.from(candidateRows);
}

async function fetchResolveHouseNumberTapRows(input: {
  lon: number;
  lat: number;
  houseNumber: number;
  addition: string | null;
}): Promise<ResolveTapCandidateRow[]> {
  const envelope = buildResolveTapEnvelope(
    input.lon,
    input.lat,
    RESOLVE_HOUSE_NUMBER_TAP_SEARCH_RADIUS_METERS
  );
  const additionCondition = input.addition
    ? sql`${buildCanonicalHouseNumberAdditionExpression('p.house_number_addition')} = ${input.addition}`
    : sql`${buildCanonicalHouseNumberAdditionExpression('p.house_number_addition')} IS NULL`;

  const candidateRows = await db.execute<ResolveTapCandidateRow>(sql`
    WITH tap AS (
      SELECT ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326) AS geom
    ),
    ranked AS MATERIALIZED (
      SELECT
        p.id,
        ST_Distance(p.geometry::geography, tap.geom::geography) AS distance_meters
      FROM properties p
      CROSS JOIN tap
      WHERE p.status = 'active'
        AND p.geometry IS NOT NULL
        AND p.house_number = ${input.houseNumber}
        AND ${additionCondition}
        AND p.geometry && ST_MakeEnvelope(
          ${envelope.minLon},
          ${envelope.minLat},
          ${envelope.maxLon},
          ${envelope.maxLat},
          4326
        )
        AND ST_DWithin(
          p.geometry::geography,
          tap.geom::geography,
          ${RESOLVE_HOUSE_NUMBER_TAP_SEARCH_RADIUS_METERS}
        )
      ORDER BY ST_Distance(p.geometry::geography, tap.geom::geography), p.id
      LIMIT ${RESOLVE_TAP_MAX_MEMBER_ROWS}
    ),
    best AS (
      SELECT MIN(distance_meters) AS distance_meters
      FROM ranked
    ),
    candidate_ids AS MATERIALIZED (
      SELECT
        ranked.id,
        ranked.distance_meters,
        ranked.distance_meters AS group_distance_meters,
        COUNT(*) OVER ()::int AS total_count
      FROM ranked, best
      WHERE ranked.distance_meters <= best.distance_meters + ${RESOLVE_TAP_AMBIGUOUS_PROPERTY_EPSILON_METERS}
      ORDER BY ranked.distance_meters, ranked.id
    )
    SELECT
      ${PUBLIC_PROPERTY_SELECT},
      ci.distance_meters,
      ci.group_distance_meters,
      ci.total_count
    FROM candidate_ids ci
    INNER JOIN properties p ON p.id = ci.id
    ${buildPropertyListingFactsJoin('p', 'lf')}
    ${buildPropertySocialFactsJoin('p', 'sf')}
    ${imageryJoin}
  `);

  return Array.from(candidateRows);
}

async function resolveHouseNumberTap(input: {
  lon: number;
  lat: number;
  zoom: number;
  houseNumber: string;
  viewer: PropertyReadViewer | null;
}): Promise<ResolveTapResponse> {
  if (input.zoom < PROPERTY_GHOST_REVEAL_ZOOM) {
    return null;
  }

  const parsed = parseHouseNumberLabel(input.houseNumber);
  if (!parsed) {
    return null;
  }

  const rows = await fetchResolveHouseNumberTapRows({
    lon: input.lon,
    lat: input.lat,
    houseNumber: parsed.houseNumber,
    addition: parsed.addition,
  });
  if (rows.length === 0) {
    return null;
  }

  return buildResolveTapResponseWithReadState({
    rows,
    viewer: input.viewer,
    lon: input.lon,
    lat: input.lat,
    match: 'house-number',
    source: 'house-number-tap',
  });
}

async function resolvePhysicalTap(input: {
  lon: number;
  lat: number;
  zoom: number;
  viewer: PropertyReadViewer | null;
}): Promise<ResolveTapResponse> {
  if (input.zoom < PROPERTY_GHOST_REVEAL_ZOOM) {
    return null;
  }

  const containingBuildingRows = await fetchResolveTapBuildingRows({
    lon: input.lon,
    lat: input.lat,
    mode: 'containing',
  });
  if (containingBuildingRows.length > 0) {
    return buildResolveTapResponseWithReadState({
      rows: containingBuildingRows,
      viewer: input.viewer,
      lon: input.lon,
      lat: input.lat,
      match: 'containing-building',
    });
  }

  const nearbyBuildingRows = await fetchResolveTapBuildingRows({
    lon: input.lon,
    lat: input.lat,
    mode: 'nearby',
  });
  if (nearbyBuildingRows.length > 0) {
    return buildResolveTapResponseWithReadState({
      rows: nearbyBuildingRows,
      viewer: input.viewer,
      lon: input.lon,
      lat: input.lat,
      match: 'nearby-building',
    });
  }

  const nearbyPropertyRows = await fetchResolveTapNearbyPropertyRows({
    lon: input.lon,
    lat: input.lat,
  });
  if (nearbyPropertyRows.length > 0) {
    return buildResolveTapResponseWithReadState({
      rows: nearbyPropertyRows,
      viewer: input.viewer,
      lon: input.lon,
      lat: input.lat,
      match: 'nearby-property',
    });
  }

  return null;
}

export async function propertyRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/properties',
    {
      schema: {
        tags: ['properties'],
        summary: 'List properties',
        querystring: propertyListQuerySchema,
        response: {
          200: propertyListResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { page, limit, city, minPrice, maxPrice, bbox, lat, lon, radius } = request.query;
      const offset = (page - 1) * limit;
      const usesSpatialPropertyListFilter = Boolean(
        bbox || (lat !== undefined && lon !== undefined)
      );
      const parsedMapFilters = parseMapFiltersQuery(request.query);
      const filters = normalizeMapFilters({
        ...parsedMapFilters,
        salePriceFrom: parsedMapFilters.salePriceFrom ?? minPrice ?? null,
        salePriceTo: parsedMapFilters.salePriceTo ?? maxPrice ?? null,
      });
      const mapFilterQuery = buildPropertyMarketFilterQuery(filters, 'p');
      const requiresListingFactsForMarketFilters = !areMapFiltersDefault(mapFilterQuery.filters);
      const requiresSocialFactsForCount = filters.activity !== 'all';
      const activityPredicate = requiresSocialFactsForCount
        ? buildActivityFilterPredicate(filters.activity, 'sf')
        : sql`TRUE`;
      const conditions = buildPropertyWhereConditions({ city, bbox, lat, lon, radius });

      conditions.push(mapFilterQuery.predicate, activityPredicate);

      const whereFragment = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

      let total = 0;
      if (!usesSpatialPropertyListFilter) {
        const countRows = await db.execute<{ cnt: number }>(sql`
          SELECT COUNT(*)::int AS cnt
          FROM properties p
          ${mapFilterQuery.join}
          ${requiresSocialFactsForCount ? buildPropertySocialFactsJoin('p', 'sf') : sql``}
          ${whereFragment}
        `);
        total = Array.from(countRows)[0]?.cnt ?? 0;
      }

      const rows = await db.execute<PropertyRow>(sql`
        WITH page_ids AS (
          SELECT p.id
          FROM properties p
          ${requiresListingFactsForMarketFilters ? mapFilterQuery.join : sql``}
          ${requiresSocialFactsForCount ? buildPropertySocialFactsJoin('p', 'sf') : sql``}
          ${whereFragment}
          ORDER BY p.id
          LIMIT ${limit}
          OFFSET ${offset}
        )
        SELECT
          ${PUBLIC_PROPERTY_LIST_SELECT}
        FROM page_ids page
        INNER JOIN properties p ON p.id = page.id
        ${buildPropertyListingFactsJoin('p', 'lf')}
        ${buildPropertySocialFactsJoin('p', 'sf')}
        ORDER BY p.id
      `);
      const rowArray = Array.from(rows);
      if (usesSpatialPropertyListFilter) {
        total = offset + rowArray.length;
      }

      return reply.send({
        data: rowArray.map(mapPublicPropertyRow),
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    }
  );

  typedApp.get(
    '/properties/resolve',
    {
      schema: {
        tags: ['properties'],
        summary: 'Resolve address to property',
        querystring: resolveQuerySchema,
        response: {
          200: resolveResponseSchema,
          400: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const {
        postalCode,
        houseNumber,
        houseNumberAddition,
        countryCode: rawCC,
        street,
        city,
      } = request.query;

      if (!isValidCountryCode(rawCC)) {
        return reply.status(400).send({
          error: 'BAD_REQUEST',
          message: `Unsupported country code: ${rawCC}`,
        });
      }
      const cc = rawCC as CountryCode;

      const cfg = getCountryConfig(cc);
      const stripped = postalCode.replace(/\s/g, '').toUpperCase();
      if (!cfg.postalCodeRegex.test(stripped)) {
        return reply.status(400).send({
          error: 'BAD_REQUEST',
          message: `Invalid postal code format for ${cfg.name}: "${postalCode}"`,
        });
      }

      const normalizedAddition = houseNumberAddition?.trim().toUpperCase() || null;
      const normalizedStreet = normalizeComparableAddressPart(street);
      const normalizedCity = normalizeComparableAddressPart(city);
      const additionCondition = normalizedAddition
        ? sql`${buildCanonicalHouseNumberAdditionExpression('p.house_number_addition')} = ${normalizedAddition}`
        : sql`${buildCanonicalHouseNumberAdditionExpression('p.house_number_addition')} IS NULL`;

      const conditions: SQL[] = [
        sql`p.country_code = ${cc}`,
        sql`p.postal_code = ${stripped}`,
        sql`p.house_number = ${houseNumber}`,
        additionCondition,
      ];

      if (street) {
        conditions.push(buildComparableAddressPredicate('p.street', street));
      }

      if (city) {
        conditions.push(buildComparableAddressPredicate('p.city', city));
      }

      const rows = await db.execute<{
        id: string;
        country_code: string;
        street: string;
        house_number: number;
        house_number_addition: string | null;
        city: string;
        postal_code: string;
        official_valuation: number | null;
        official_valuation_year: number | null;
        has_active_listing: boolean;
        market_state: 'for-sale' | 'for-rent' | 'sold' | 'rented' | 'not-listed';
        lon: number | null;
        lat: number | null;
      }>(sql`
        WITH matched_properties AS (
          SELECT
            p.id,
            p.country_code,
            p.street,
            p.house_number,
            p.house_number_addition,
            p.city,
            p.postal_code,
            p.official_valuation,
            p.official_valuation_year,
            ST_X(p.geometry) AS lon,
            ST_Y(p.geometry) AS lat
          FROM properties p
          WHERE ${sql.join(conditions, sql` AND `)}
          LIMIT 2
        )
        SELECT
          p.id,
          p.country_code,
          p.street,
          p.house_number,
          ${buildCanonicalHouseNumberAdditionExpression('p.house_number_addition')} AS house_number_addition,
          p.city,
          p.postal_code,
          p.official_valuation,
          p.official_valuation_year,
          lf.has_active_listing,
          lf.market_state,
          p.lon,
          p.lat
        FROM matched_properties p
        ${buildPropertyListingFactsJoin('p', 'lf')}
      `);

      const matches = Array.from(rows).filter((row) => {
        const streetMatches =
          !normalizedStreet || normalizeComparableAddressPart(row.street) === normalizedStreet;
        const cityMatches =
          !normalizedCity || normalizeComparableAddressPart(row.city) === normalizedCity;
        return streetMatches && cityMatches;
      });

      if (matches.length === 0) {
        return reply.send(null);
      }

      if (matches.length > 1) {
        return reply.status(409).send({
          error: 'AMBIGUOUS_ADDRESS',
          message:
            'Multiple properties matched this address. Provide street and city to disambiguate.',
        });
      }

      const row = matches[0];
      return reply.send({
        id: row.id,
        countryCode: row.country_code,
        address: formatDisplayAddress(
          {
            street: row.street,
            houseNumber: row.house_number,
            houseNumberAddition: row.house_number_addition,
            postalCode: row.postal_code,
            city: row.city,
          },
          isValidCountryCode(row.country_code) ? row.country_code : undefined
        ),
        postalCode: row.postal_code,
        city: row.city,
        coordinates:
          row.lon != null && row.lat != null
            ? {
                lon: row.lon,
                lat: row.lat,
              }
            : null,
        hasActiveListing: row.has_active_listing,
        marketState: row.market_state,
        officialValuation: row.official_valuation != null ? Number(row.official_valuation) : null,
        officialValuationYear:
          row.official_valuation_year != null ? Number(row.official_valuation_year) : null,
        officialValuationSourceFetch: getOfficialValuationSourceFetchHint(row.country_code),
      });
    }
  );

  typedApp.get(
    '/properties/resolve-house-number-tap',
    {
      onRequest: [app.optionalAuth],
      schema: {
        tags: ['properties'],
        summary: 'Resolve a clicked house-number label to a property preview',
        querystring: resolveHouseNumberTapQuerySchema,
        response: {
          200: resolveTapResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { lon, lat, zoom, houseNumber } = request.query;
      const viewer = resolvePropertyReadViewer(
        request.userId,
        request.headers['x-session-id'] as string | string[] | undefined
      );
      const result = await resolveHouseNumberTap({ lon, lat, zoom, houseNumber, viewer });
      return reply.send(result);
    }
  );

  typedApp.get(
    '/properties/resolve-tap',
    {
      onRequest: [app.optionalAuth],
      schema: {
        tags: ['properties'],
        summary: 'Resolve a street-zoom physical map tap to a property preview',
        querystring: resolveTapQuerySchema,
        response: {
          200: resolveTapResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { lon, lat, zoom } = request.query;
      const viewer = resolvePropertyReadViewer(
        request.userId,
        request.headers['x-session-id'] as string | string[] | undefined
      );
      const result = await resolvePhysicalTap({ lon, lat, zoom, viewer });
      return reply.send(result);
    }
  );

  typedApp.get(
    '/properties/nearby',
    {
      onRequest: [app.optionalAuth],
      schema: {
        tags: ['properties'],
        summary: 'Find nearby grouped property',
        querystring: nearbyQuerySchema,
        response: {
          200: nearbyGroupedResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { lon, lat, zoom } = request.query;
      const filters = parseMapFiltersQuery(request.query);
      let result: NearbyGroupedContractResult | null = null;
      if (hasPyramidNodeQueryPair(request.query) && areMapFiltersDefault(filters)) {
        try {
          const lookup = await resolvePyramidNearbyNodeById({
            lon,
            lat,
            pyramidVersionId: request.query.pyramidVersionId,
            pyramidNodeId: request.query.pyramidNodeId,
          });
          result = lookup.result;

          if (!result) {
            reply.header('X-HuisHype-Nearby-Status', lookup.status);
          }
          if (!result && lookup.versionId) {
            reply.header('X-HuisHype-Pyramid-Version', lookup.versionId);
          }
        } catch (error) {
          if (!isPyramidSchemaUnavailable(error)) {
            throw error;
          }
          reply.header('X-HuisHype-Nearby-Status', 'pyramid-unavailable');
        }
      } else if (
        areMapFiltersDefault(filters) &&
        isDefaultPyramidNearbyZoom(zoom, getPropertyTilePyramidMaxZoom())
      ) {
        try {
          const lookup = await resolvePyramidNearbyNodeAtPoint({
            lon,
            lat,
            zoom,
            logger: request.log,
          });
          result = lookup.result;
          reply.header('X-HuisHype-Nearby-Status', result ? 'pyramid-promoted' : lookup.status);
          if (lookup.versionId) {
            reply.header('X-HuisHype-Pyramid-Version', lookup.versionId);
          }
        } catch (error) {
          if (!isPyramidSchemaUnavailable(error)) {
            throw error;
          }
          reply.header('X-HuisHype-Nearby-Status', 'pyramid-unavailable');
        }
      } else {
        result = (await resolveNearbyGroupedFeature(
          lon,
          lat,
          zoom,
          filters
        )) as NearbyGroupedContractResult | null;
      }
      const viewer = resolvePropertyReadViewer(
        request.userId,
        request.headers['x-session-id'] as string | string[] | undefined
      );
      const membershipComplete = result?.membershipComplete ?? true;
      const readIds =
        result && membershipComplete
          ? await getReadPropertyIdSet(result.propertyIds, viewer)
          : new Set<string>();
      const isRead =
        result != null &&
        membershipComplete &&
        result.propertyIds.length > 0 &&
        result.propertyIds.every((propertyId) => readIds.has(propertyId));
      return reply.send(mapNearbyGroupedResult(result, isRead));
    }
  );

  const batchQuerySchema = z.object({
    ids: z
      .string()
      .transform((value) => value.split(','))
      .pipe(z.array(z.string().uuid()).min(1).max(50)),
  });

  typedApp.get(
    '/properties/batch',
    {
      onRequest: [app.optionalAuth],
      schema: {
        tags: ['properties'],
        summary: 'Batch fetch properties',
        querystring: batchQuerySchema,
        response: {
          200: z.array(propertySchema),
        },
      },
    },
    async (request, reply) => {
      const { ids } = request.query;
      const viewer = resolvePropertyReadViewer(
        request.userId,
        request.headers['x-session-id'] as string | string[] | undefined
      );
      const rows = await db.execute<PropertyRow>(sql`
        SELECT
          ${PUBLIC_PROPERTY_SELECT}
        FROM properties p
        ${buildPropertyListingFactsJoin('p', 'lf')}
        ${buildPropertySocialFactsJoin('p', 'sf')}
        ${imageryJoin}
        WHERE p.id IN (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `
        )})
      `);

      const readIds = await getReadPropertyIdSet(ids, viewer);
      const byId = new Map(
        Array.from(rows).map((row) => [
          row.id,
          {
            ...mapPublicPropertyRow(row),
            isRead: readIds.has(row.id),
          },
        ])
      );
      return reply.send(
        ids
          .map((id) => byId.get(id))
          .filter((item): item is NonNullable<typeof item> => item != null)
      );
    }
  );

  typedApp.get(
    '/properties/following-nearby',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['properties'],
        summary: 'Find nearby grouped property in Following mode',
        description:
          'Returns the personalized grouped-property hit for the signed-in viewer when Following is active.',
        querystring: followingNearbyQuerySchema,
        response: {
          200: nearbyGroupedResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { lon, lat, zoom } = request.query;
      const filters = parseFollowingMapFiltersQuery(request.query);
      const result = await resolveNearbyFollowingGroupedFeature(
        lon,
        lat,
        zoom,
        request.userId!,
        filters
      );
      const readIds = result
        ? await getReadPropertyIdSet(result.propertyIds, { userId: request.userId! })
        : new Set<string>();
      const isRead =
        result != null &&
        result.propertyIds.length > 0 &&
        result.propertyIds.every((propertyId) => readIds.has(propertyId));
      return reply.send(mapNearbyGroupedResult(result, isRead));
    }
  );

  typedApp.get(
    '/properties/:id',
    {
      onRequest: [app.optionalAuth],
      schema: {
        tags: ['properties'],
        summary: 'Get property by ID',
        params: propertyParamsSchema,
        response: {
          200: propertyDetailSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const effectiveUserId = request.userId ?? '00000000-0000-4000-a000-000000000000';
      const viewer = resolvePropertyReadViewer(
        request.userId,
        request.headers['x-session-id'] as string | string[] | undefined
      );

      const rows = await db.execute<PropertyDetailRow>(sql`
        SELECT
          ${PUBLIC_PROPERTY_SELECT},
          EXISTS(
            SELECT 1
            FROM reactions r
            WHERE r.target_type = 'property'
              AND r.target_id = p.id
              AND r.user_id = ${effectiveUserId}
              AND r.reaction_type = 'like'
          ) AS is_liked,
          EXISTS(
            SELECT 1
            FROM saved_properties sp
            WHERE sp.property_id = p.id
              AND sp.user_id = ${effectiveUserId}
          ) AS is_saved
        FROM properties p
        ${buildPropertyListingFactsJoin('p', 'lf')}
        ${buildPropertySocialFactsJoin('p', 'sf')}
        ${imageryJoin}
        WHERE p.id = ${id}
        LIMIT 1
      `);

      const row = Array.from(rows)[0];
      if (!row) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Property with ID ${id} not found`,
        });
      }

      const publicRow = mapPublicPropertyRow(row);
      const guesses = await fetchGuessesWithKarma(id);
      const fmvResult = calculateFmv(
        guesses,
        row.official_valuation != null ? Number(row.official_valuation) : null,
        row.asking_price != null ? Number(row.asking_price) : null
      );
      const commentCount = publicRow.commentsDisabled
        ? 0
        : Number(row.top_level_comment_count) + Number(row.reply_count);
      const isRead = await isPropertyReadForViewer(id, viewer);

      return reply.send({
        ...publicRow,
        isRead,
        commentCount,
        likeCount: Number(row.property_like_count),
        uniqueViewers: Number(row.unique_viewer_count),
        isLiked: row.is_liked,
        isSaved: row.is_saved,
        fmv: fmvResult,
      });
    }
  );

  typedApp.post(
    '/properties/:id/official-valuations/hydrate',
    {
      onRequest: [app.optionalAuth],
      schema: {
        tags: ['properties'],
        summary: 'Hydrate property official valuation',
        params: propertyParamsSchema,
        body: hydrateOfficialValuationRequestSchema,
        response: {
          200: officialValuationHydrationResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await requestOfficialValuationHydration({
        propertyId: request.params.id,
        request: request.body,
        submittedByUserId: request.userId ?? null,
        logger: request.log,
      });

      if (!result) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Property with ID ${request.params.id} not found`,
        });
      }

      return reply.send({
        status: result.status,
        propertyId: result.propertyId,
        source: result.source,
        valuationYear: result.valuationYear,
        officialValuation: result.cachedValuation,
        officialValuationYear: result.cachedValuationYear,
        officialValuationVerified: result.cachedVerified,
        job: result.job,
      });
    }
  );

  typedApp.post(
    '/properties/:id/save',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['properties'],
        summary: 'Save a property',
        params: propertyParamsSchema,
        response: {
          201: saveResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: propertyId } = request.params;
      const userId = request.userId!;

      const propertyExists = await db
        .select({ id: propertiesTable.id })
        .from(propertiesTable)
        .where(eq(propertiesTable.id, propertyId))
        .limit(1);

      if (propertyExists.length === 0) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'Property not found.',
        });
      }

      const existing = await db
        .select({ id: savedProperties.id })
        .from(savedProperties)
        .where(and(eq(savedProperties.userId, userId), eq(savedProperties.propertyId, propertyId)))
        .limit(1);

      if (existing.length > 0) {
        return reply.status(409).send({
          error: 'ALREADY_SAVED',
          message: 'You have already saved this property.',
        });
      }

      try {
        await db.insert(savedProperties).values({
          userId,
          propertyId,
        });
      } catch (err: unknown) {
        const pgErr = err as { code?: string };
        if (pgErr.code === '23505') {
          return reply.status(409).send({
            error: 'ALREADY_SAVED',
            message: 'You have already saved this property.',
          });
        }
        if (pgErr.code === '23503') {
          return reply.status(404).send({
            error: 'NOT_FOUND',
            message: 'Property not found.',
          });
        }
        throw err;
      }

      return reply.status(201).send({ saved: true });
    }
  );

  typedApp.delete(
    '/properties/:id/save',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['properties'],
        summary: 'Unsave a property',
        params: propertyParamsSchema,
        response: {
          200: saveResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: propertyId } = request.params;
      const userId = request.userId!;

      const existing = await db
        .select({ id: savedProperties.id })
        .from(savedProperties)
        .where(and(eq(savedProperties.userId, userId), eq(savedProperties.propertyId, propertyId)))
        .limit(1);

      if (existing.length === 0) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'You have not saved this property.',
        });
      }

      await db.delete(savedProperties).where(eq(savedProperties.id, existing[0].id));

      return reply.send({ saved: false });
    }
  );

  typedApp.get(
    '/saved-properties',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['properties'],
        summary: 'List saved properties',
        querystring: savedPropertiesQuerySchema,
        response: {
          200: savedPropertiesResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId!;
      const { limit, offset } = request.query;

      const countRows = await db.execute<{ cnt: number }>(sql`
        SELECT COUNT(*)::int AS cnt
        FROM saved_properties
        WHERE user_id = ${userId}
      `);
      const total = Array.from(countRows)[0]?.cnt ?? 0;

      const rows = await db.execute<PropertyRow & { saved_at: string }>(sql`
        SELECT
          ${PUBLIC_PROPERTY_SELECT},
          sp.created_at AS saved_at
        FROM saved_properties sp
        INNER JOIN properties p ON p.id = sp.property_id
        ${buildPropertyListingFactsJoin('p', 'lf')}
        ${buildPropertySocialFactsJoin('p', 'sf')}
        ${imageryJoin}
        WHERE sp.user_id = ${userId}
        ORDER BY sp.created_at DESC, p.id
        LIMIT ${limit}
        OFFSET ${offset}
      `);

      return reply.send({
        data: Array.from(rows).map((row) => ({
          ...mapPublicPropertyRow(row),
          savedAt: new Date(row.saved_at).toISOString(),
          isSaved: true as const,
        })),
        total,
        hasMore: offset + limit < total,
      });
    }
  );
}

export type PropertyListQuery = z.infer<typeof propertyListQuerySchema>;
export type PropertyListResponse = z.infer<typeof propertyListResponseSchema>;
export type PropertyResponse = z.infer<typeof propertySchema>;
export type ResolveQuery = z.infer<typeof resolveQuerySchema>;
export type ResolveResponse = z.infer<typeof resolveResponseSchema>;
export type ResolveTapQuery = z.infer<typeof resolveTapQuerySchema>;
export type ResolveTapRouteResponse = z.infer<typeof resolveTapResponseSchema>;
export type NearbyGroupedResult = z.infer<typeof nearbyGroupedResponseSchema>;
export type SaveResponse = z.infer<typeof saveResponseSchema>;
export type SavedPropertyResponse = z.infer<typeof savedPropertySchema>;
export type SavedPropertiesResponse = z.infer<typeof savedPropertiesResponseSchema>;
