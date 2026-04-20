import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db, properties as propertiesTable, savedProperties } from '../db/index.js';
import { sql, eq, and, type SQL } from 'drizzle-orm';
import { formatDisplayAddress } from '../utils/address.js';
import { getCountryConfig, isValidCountryCode, type CountryCode } from '@huishype/shared';
import { fetchGuessesWithKarma, calculateFmv } from '../services/fmv.js';
import { resolveNearbyGroupedFeature } from '../services/property-grouping.js';
import {
  areMapFiltersDefault,
  buildPropertyMarketFilterQuery,
  mapFiltersQuerySchema,
  normalizeMapFilters,
  parseMapFiltersQuery,
  parsePropertyMarketFiltersQuery,
  propertyMarketFiltersQuerySchema,
} from '../services/map-filters.js';
import {
  buildActivityFilterPredicate,
  buildCanonicalHouseNumberAdditionExpression,
  buildPropertyListingFactsJoin,
  buildPropertySocialFactsJoin,
} from '../services/property-queries.js';

const coordinateSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number(), z.number()]).describe('[longitude, latitude]'),
});

const imageryCoordinateSchema = coordinateSchema.describe(
  'Geometry used for imagery framing. May snap to a nearby building surface point.',
);

const marketStateSchema = z.enum(['for-sale', 'for-rent', 'sold', 'rented', 'not-listed']);
const latestListingStatusSchema = z.enum(['active', 'sold', 'rented', 'withdrawn']).nullable();

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
});

const resolveResponseSchema = z.nullable(resolveFoundResponseSchema);

const nearbyQuerySchema = z.object({
  lon: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  zoom: z.coerce.number().min(0).max(22).default(17),
  ...mapFiltersQuerySchema.shape,
});

const nearbyGroupedBaseSchema = z.object({
  nodeClass: z.enum(['active', 'ghost']),
  primaryPropertyId: z.string().uuid(),
  pointCount: z.number(),
  propertyIds: z.array(z.string().uuid()),
  previewPropertyIds: z.array(z.string().uuid()),
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

const followingViewportQuerySchema = z.object({
  bbox: z.string().describe('Bounding box as "minLon,minLat,maxLon,maxLat"'),
  ...propertyMarketFiltersQuerySchema.shape,
});

const followingViewportItemSchema = z.object({
  id: z.string().uuid(),
  coordinate: z.tuple([z.number(), z.number()]).describe('[longitude, latitude]'),
  address: z.string(),
  city: z.string(),
  postalCode: z.string().nullable(),
  countryCode: z.string(),
  askingPrice: z.number().nullable(),
  thumbnailUrl: z.string().nullable(),
  hasActiveListing: z.boolean(),
  marketState: marketStateSchema,
  activityTypes: z.array(z.enum(['property_like', 'comment', 'price_guess'])),
  actorCount: z.number(),
  lastActivityAt: z.string().datetime(),
});

const followingViewportResponseSchema = z.object({
  items: z.array(followingViewportItemSchema),
});

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
};

type PropertyDetailRow = PropertyRow & {
  is_liked: boolean;
  is_saved: boolean;
};

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
      isValidCountryCode(row.country_code) ? row.country_code : undefined,
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
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapPublicPropertyRow(row: PropertyRow) {
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
    topLevelCommentCount: Number(row.top_level_comment_count),
    replyCount: Number(row.reply_count),
    propertyLikeCount: Number(row.property_like_count),
    commentLikeCount: Number(row.comment_like_count),
    guessCount: Number(row.guess_count),
    viewCount: Number(row.view_count),
    uniqueViewerCount: Number(row.unique_viewer_count),
    recentTopLevelCommentCount: Number(row.recent_top_level_comment_count),
    recentReplyCount: Number(row.recent_reply_count),
    recentPropertyLikeCount: Number(row.recent_property_like_count),
    recentCommentLikeCount: Number(row.recent_comment_like_count),
    recentGuessCount: Number(row.recent_guess_count),
    recentViewCount: Number(row.recent_view_count),
    recentUniqueViewerCount: Number(row.recent_unique_viewer_count),
  };
}

function mapNearbyGroupedResult(result: Awaited<ReturnType<typeof resolveNearbyGroupedFeature>>) {
  if (!result) {
    return null;
  }

  const baseResult = {
    nodeClass: result.nodeClass,
    primaryPropertyId: result.primaryPropertyId,
    pointCount: result.pointCount,
    propertyIds: result.propertyIds,
    previewPropertyIds: result.previewPropertyIds,
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
  };

  if (result.groupKind === 'single') {
    if (
      result.address == null ||
      result.city == null ||
      result.hasActiveListing == null ||
      result.marketState == null
    ) {
      throw new Error(
        `Grouped nearby single ${result.primaryPropertyId} is missing required preview fields`,
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

function parseBboxString(bbox: string) {
  const [minLon, minLat, maxLon, maxLat] = bbox.split(',').map(Number);
  if (
    [minLon, minLat, maxLon, maxLat].some((value) => value == null || Number.isNaN(value))
  ) {
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
        sql`p.geometry && ST_MakeEnvelope(${parsed.minLon}, ${parsed.minLat}, ${parsed.maxLon}, ${parsed.maxLat}, 4326)`,
      );
    }
  }

  if (params.lat !== undefined && params.lon !== undefined) {
    conditions.push(...buildRadiusConditions(params.lon, params.lat, params.radius));
  }

  return conditions;
}

const PUBLIC_PROPERTY_SELECT = sql`
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
  ${imageryLonSelect} AS imagery_lon,
  ${imageryLatSelect} AS imagery_lat,
  p.year_built,
  p.floor_area_m2,
  p.status,
  p.official_valuation,
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
      const parsedMapFilters = parseMapFiltersQuery(request.query);
      const filters = normalizeMapFilters({
        ...parsedMapFilters,
        salePriceFrom: parsedMapFilters.salePriceFrom ?? minPrice ?? null,
        salePriceTo: parsedMapFilters.salePriceTo ?? maxPrice ?? null,
      });
      const mapFilterQuery = buildPropertyMarketFilterQuery(filters, 'p');
      const requiresListingFactsForMarketFilters = !areMapFiltersDefault(filters);
      const requiresSocialFactsForCount = filters.activity !== 'all';
      const activityPredicate = requiresSocialFactsForCount
        ? buildActivityFilterPredicate(filters.activity, 'sf')
        : sql`TRUE`;
      const conditions = buildPropertyWhereConditions({ city, bbox, lat, lon, radius });

      conditions.push(mapFilterQuery.predicate, activityPredicate);

      const whereFragment = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

      const countRows = await db.execute<{ cnt: number }>(sql`
        SELECT COUNT(*)::int AS cnt
        FROM properties p
        ${mapFilterQuery.join}
        ${requiresSocialFactsForCount ? buildPropertySocialFactsJoin('p', 'sf') : sql``}
        ${whereFragment}
      `);
      const total = Array.from(countRows)[0]?.cnt ?? 0;

      const rows = await db.execute<PropertyRow>(sql`
        WITH page_ids AS (
          SELECT p.id
          FROM properties p
          ${requiresListingFactsForMarketFilters ? mapFilterQuery.join : sql``}
          ${requiresSocialFactsForCount ? buildPropertySocialFactsJoin('p', 'sf') : sql``}
          ${whereFragment}
          ORDER BY p.created_at, p.id
          LIMIT ${limit}
          OFFSET ${offset}
        )
        SELECT
          ${PUBLIC_PROPERTY_SELECT}
        FROM page_ids page
        INNER JOIN properties p ON p.id = page.id
        ${buildPropertyListingFactsJoin('p', 'lf')}
        ${buildPropertySocialFactsJoin('p', 'sf')}
        ${imageryJoin}
        ORDER BY p.created_at, p.id
      `);

      return reply.send({
        data: Array.from(rows).map(mapPublicPropertyRow),
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    },
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
        has_active_listing: boolean;
        market_state: 'for-sale' | 'for-rent' | 'sold' | 'rented' | 'not-listed';
        lon: number | null;
        lat: number | null;
      }>(sql`
        SELECT
          p.id,
          p.country_code,
          p.street,
          p.house_number,
          ${buildCanonicalHouseNumberAdditionExpression('p.house_number_addition')} AS house_number_addition,
          p.city,
          p.postal_code,
          p.official_valuation,
          lf.has_active_listing,
          lf.market_state,
          ST_X(p.geometry) AS lon,
          ST_Y(p.geometry) AS lat
        FROM properties p
        ${buildPropertyListingFactsJoin('p', 'lf')}
        WHERE ${sql.join(conditions, sql` AND `)}
        LIMIT 2
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
          message: 'Multiple properties matched this address. Provide street and city to disambiguate.',
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
          isValidCountryCode(row.country_code) ? row.country_code : undefined,
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
      });
    },
  );

  typedApp.get(
    '/properties/nearby',
    {
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
      const result = await resolveNearbyGroupedFeature(lon, lat, zoom, filters);
      return reply.send(mapNearbyGroupedResult(result));
    },
  );

  const batchQuerySchema = z.object({
    ids: z.string().transform((value) => value.split(',')).pipe(z.array(z.string().uuid()).min(1).max(50)),
  });

  typedApp.get(
    '/properties/batch',
    {
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
      const rows = await db.execute<PropertyRow>(sql`
        SELECT
          ${PUBLIC_PROPERTY_SELECT}
        FROM properties p
        ${buildPropertyListingFactsJoin('p', 'lf')}
        ${buildPropertySocialFactsJoin('p', 'sf')}
        ${imageryJoin}
        WHERE p.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      `);

      const byId = new Map(Array.from(rows).map((row) => [row.id, mapPublicPropertyRow(row)]));
      return reply.send(ids.map((id) => byId.get(id)).filter((item): item is NonNullable<typeof item> => item != null));
    },
  );

  typedApp.get(
    '/properties/following-viewport',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['properties'],
        summary: 'Get followed-user viewport activity overlay',
        querystring: followingViewportQuerySchema,
        response: {
          200: followingViewportResponseSchema,
          401: errorResponseSchema,
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const viewerId = request.userId!;
      const { bbox } = request.query;
      const parsedBbox = parseBboxString(bbox);
      if (!parsedBbox) {
        return reply.status(400).send({
          error: 'BAD_REQUEST',
          message: 'Invalid bbox parameter.',
        });
      }

      const marketFilters = parsePropertyMarketFiltersQuery(request.query);
      const marketFilterQuery = buildPropertyMarketFilterQuery(marketFilters, 'p');

      const rows = await db.execute<{
        id: string;
        lon: number;
        lat: number;
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
        actor_count: number;
        last_activity_at: string;
        has_property_like: boolean;
        has_comment: boolean;
        has_price_guess: boolean;
      }>(sql`
        WITH viewport_properties AS (
          SELECT p.id
          FROM properties p
          ${marketFilterQuery.join}
          WHERE p.status = 'active'
            AND p.geometry IS NOT NULL
            AND p.geometry && ST_MakeEnvelope(
              ${parsedBbox.minLon},
              ${parsedBbox.minLat},
              ${parsedBbox.maxLon},
              ${parsedBbox.maxLat},
              4326
            )
            AND ${marketFilterQuery.predicate}
        ),
        qualifying_activity AS (
          SELECT
            event_rows.property_id,
            COUNT(DISTINCT event_rows.actor_user_id)::int AS actor_count,
            MAX(event_rows.created_at) AS last_activity_at,
            BOOL_OR(event_rows.event_type = 'property_like') AS has_property_like,
            BOOL_OR(event_rows.event_type = 'comment') AS has_comment,
            BOOL_OR(event_rows.event_type = 'price_guess') AS has_price_guess
          FROM (
            SELECT
              r.target_id AS property_id,
              r.user_id AS actor_user_id,
              r.created_at,
              'property_like'::text AS event_type
            FROM reactions r
            WHERE r.target_type = 'property'
              AND r.reaction_type = 'like'
              AND EXISTS (
                SELECT 1
                FROM user_follows uf
                WHERE uf.follower_user_id = ${viewerId}
                  AND uf.followed_user_id = r.user_id
              )
            UNION ALL
            SELECT
              c.property_id,
              c.user_id,
              c.created_at,
              'comment'::text AS event_type
            FROM comments c
            WHERE EXISTS (
              SELECT 1
              FROM user_follows uf
              WHERE uf.follower_user_id = ${viewerId}
                AND uf.followed_user_id = c.user_id
            )
            UNION ALL
            SELECT
              pg.property_id,
              pg.user_id,
              GREATEST(pg.created_at, pg.updated_at) AS created_at,
              'price_guess'::text AS event_type
            FROM price_guesses pg
            WHERE EXISTS (
              SELECT 1
              FROM user_follows uf
              WHERE uf.follower_user_id = ${viewerId}
                AND uf.followed_user_id = pg.user_id
            )
          ) event_rows
          GROUP BY event_rows.property_id
        )
        SELECT
          p.id,
          ST_X(p.geometry) AS lon,
          ST_Y(p.geometry) AS lat,
          p.country_code,
          p.street,
          p.house_number,
          p.house_number_addition,
          p.city,
          p.postal_code,
          lf.asking_price,
          lf.thumbnail_url,
          lf.has_active_listing,
          lf.market_state,
          qa.actor_count,
          qa.last_activity_at,
          qa.has_property_like,
          qa.has_comment,
          qa.has_price_guess
        FROM viewport_properties vp
        INNER JOIN properties p ON p.id = vp.id
        INNER JOIN qualifying_activity qa ON qa.property_id = p.id
        ${buildPropertyListingFactsJoin('p', 'lf')}
        ORDER BY qa.last_activity_at DESC, p.id
      `);

      return reply.send({
        items: Array.from(rows).map((row) => ({
          id: row.id,
          coordinate: [row.lon, row.lat] as [number, number],
          address: formatDisplayAddress(
            {
              street: row.street,
              houseNumber: row.house_number,
              houseNumberAddition: row.house_number_addition,
              postalCode: row.postal_code ?? '',
              city: row.city,
            },
            isValidCountryCode(row.country_code) ? row.country_code : undefined,
          ),
          city: row.city,
          postalCode: row.postal_code,
          countryCode: row.country_code,
          askingPrice: row.asking_price != null ? Number(row.asking_price) : null,
          thumbnailUrl: row.thumbnail_url,
          hasActiveListing: row.has_active_listing,
          marketState: row.market_state,
          activityTypes: [
            ...(row.has_property_like ? (['property_like'] as const) : []),
            ...(row.has_comment ? (['comment'] as const) : []),
            ...(row.has_price_guess ? (['price_guess'] as const) : []),
          ],
          actorCount: row.actor_count,
          lastActivityAt: new Date(row.last_activity_at).toISOString(),
        })),
      });
    },
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
        row.asking_price != null ? Number(row.asking_price) : null,
      );
      const commentCount =
        Number(row.top_level_comment_count) + Number(row.reply_count);

      return reply.send({
        ...publicRow,
        commentCount,
        likeCount: Number(row.property_like_count),
        uniqueViewers: Number(row.unique_viewer_count),
        isLiked: row.is_liked,
        isSaved: row.is_saved,
        fmv: fmvResult,
      });
    },
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
    },
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
    },
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
    },
  );
}

export type PropertyListQuery = z.infer<typeof propertyListQuerySchema>;
export type PropertyListResponse = z.infer<typeof propertyListResponseSchema>;
export type PropertyResponse = z.infer<typeof propertySchema>;
export type ResolveQuery = z.infer<typeof resolveQuerySchema>;
export type ResolveResponse = z.infer<typeof resolveResponseSchema>;
export type NearbyGroupedResult = z.infer<typeof nearbyGroupedResponseSchema>;
export type SaveResponse = z.infer<typeof saveResponseSchema>;
export type SavedPropertyResponse = z.infer<typeof savedPropertySchema>;
export type SavedPropertiesResponse = z.infer<typeof savedPropertiesResponseSchema>;
