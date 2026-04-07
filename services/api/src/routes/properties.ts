import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db, properties as propertiesTable, savedProperties } from '../db/index.js';
import { sql, eq, and } from 'drizzle-orm';
import { formatDisplayAddress } from '../utils/address.js';
import { isValidCountryCode, getCountryConfig, type CountryCode } from '@huishype/shared';
import { calculateActivityLevel } from './views.js';
import { fetchGuessesWithKarma, calculateFmv } from '../services/fmv.js';

// Schema definitions
const coordinateSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number(), z.number()]).describe('[longitude, latitude]'),
});

const imageryCoordinateSchema = coordinateSchema.describe(
  'Geometry used for imagery framing. May snap to a nearby building surface point.',
);

const propertySchema = z.object({
  id: z.string().uuid(),
  nationalId: z.string().nullable(),
  countryCode: z.string(),
  region: z.string().nullable(),
  street: z.string(),
  houseNumber: z.number(),
  houseNumberAddition: z.string().nullable(),
  address: z.string(), // computed display string
  city: z.string(),
  postalCode: z.string().nullable(),
  geometry: coordinateSchema.nullable(),
  imageryGeometry: imageryCoordinateSchema.nullable().optional(),
  yearBuilt: z.number().nullable().describe('Year of construction'),
  floorAreaM2: z.number().nullable().describe('Floor area in m\u00B2'),
  status: z.enum(['active', 'inactive', 'demolished']),
  officialValuation: z.number().nullable().describe('Official government valuation'),
  hasListing: z.boolean(),
  askingPrice: z.number().nullable(),
  thumbnailUrl: z.string().nullable().describe('Latest available active listing thumbnail URL'),
  likeCount: z.number().describe('Total number of likes'),
  commentCount: z.number(),
  guessCount: z.number(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const propertyListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  city: z.string().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  // Bounding box for geospatial queries
  bbox: z
    .string()
    .optional()
    .describe('Bounding box as "minLon,minLat,maxLon,maxLat"'),
  // Point-based radius query
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

const propertyDetailSchema = z.object({
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
  yearBuilt: z.number().nullable().describe('Year of construction'),
  floorAreaM2: z.number().nullable().describe('Floor area in m\u00B2'),
  status: z.enum(['active', 'inactive', 'demolished']),
  officialValuation: z.number().nullable().describe('Official government valuation'),
  hasListing: z.boolean().describe('Whether property has an active listing'),
  askingPrice: z.number().nullable().describe('Active listing asking price'),
  thumbnailUrl: z.string().nullable().describe('Latest available active listing thumbnail URL'),
  likeCount: z.number().describe('Total number of likes on this property'),
  isLiked: z.boolean().describe('Whether the current user has liked this property'),
  isSaved: z.boolean().describe('Whether the current user has saved this property'),
  viewCount: z.number().describe('Total view count'),
  uniqueViewers: z.number().describe('Unique viewers count'),
  commentCount: z.number().describe('Total comments'),
  guessCount: z.number().describe('Total price guesses'),
  activityLevel: z.enum(['hot', 'warm', 'cold']).describe('Activity level based on views, comments, and guesses'),
  fmv: fmvSchema.describe('Fair Market Value calculation'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
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

const savedPropertySchema = z.object({
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
  yearBuilt: z.number().nullable().describe('Year of construction'),
  floorAreaM2: z.number().nullable().describe('Floor area in m\u00B2'),
  status: z.enum(['active', 'inactive', 'demolished']),
  officialValuation: z.number().nullable().describe('Official government valuation'),
  hasListing: z.boolean(),
  askingPrice: z.number().nullable(),
  thumbnailUrl: z.string().nullable().describe('Latest available active listing thumbnail URL'),
  commentCount: z.number(),
  guessCount: z.number(),
  savedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
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

// Schema for /properties/resolve endpoint
// Postal code validation is permissive at schema level — country-specific
// validation is done in the handler using the country-config registry.
const resolveQuerySchema = z.object({
  postalCode: z.string().min(1, 'Postal code is required').max(15),
  houseNumber: z.coerce.number().int().positive(),
  houseNumberAddition: z.string().optional(),
  countryCode: z.string().length(2).toUpperCase().default('NL'),
  street: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
});

const resolveResponseSchema = z.object({
  id: z.string().uuid(),
  address: z.string(),
  postalCode: z.string(),
  city: z.string(),
  coordinates: z.object({
    lon: z.number(),
    lat: z.number(),
  }),
  hasListing: z.boolean(),
  officialValuation: z.number().nullable(),
});

function normalizeComparableAddressPart(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .toUpperCase();
}

// Schema for /properties/nearby endpoint
const nearbyQuerySchema = z.object({
  lon: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  zoom: z.coerce.number().min(0).max(22).default(17),
  limit: z.coerce.number().int().min(1).max(20).default(5),
  cluster: z.string().optional().transform(v => v === 'true'),
});

const nearbyPropertySchema = z.object({
  id: z.string().uuid(),
  street: z.string(),
  houseNumber: z.number(),
  houseNumberAddition: z.string().nullable(),
  address: z.string(), // computed display string
  city: z.string(),
  postalCode: z.string().nullable(),
  officialValuation: z.number().nullable(),
  hasListing: z.boolean(),
  askingPrice: z.number().nullable(),
  thumbnailUrl: z.string().nullable(),
  activityScore: z.number(),
  likeCount: z.number(),
  commentCount: z.number(),
  guessCount: z.number(),
  distanceMeters: z.number(),
  geometry: coordinateSchema.nullable(),
});

const nearbyResponseSchema = z.array(nearbyPropertySchema);

// Cluster detection response schemas (used when cluster=true)
const clusterResultSchema = z.object({
  type: z.literal('cluster'),
  point_count: z.number(),
  property_ids: z.string().describe('Comma-separated UUIDs'),
  coordinate: z.tuple([z.number(), z.number()]).describe('[longitude, latitude]'),
  distanceMeters: z.number(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).describe('[west, south, east, north]'),
});

const singleResultSchema = z.object({
  type: z.literal('single'),
  id: z.string().uuid(),
  street: z.string(),
  houseNumber: z.number(),
  houseNumberAddition: z.string().nullable(),
  address: z.string(),
  city: z.string(),
  postalCode: z.string().nullable(),
  officialValuation: z.number().nullable(),
  hasListing: z.boolean(),
  askingPrice: z.number().nullable(),
  thumbnailUrl: z.string().nullable(),
  activityScore: z.number(),
  likeCount: z.number(),
  commentCount: z.number(),
  guessCount: z.number(),
  distanceMeters: z.number(),
  geometry: coordinateSchema.nullable(),
});

const nearbyClusterResponseSchema = z.nullable(
  z.discriminatedUnion('type', [clusterResultSchema, singleResultSchema])
);

/**
 * Compute search radius in degrees from a zoom level.
 * At z17 this is ~26m, at z18 ~13m, etc.
 */
function zoomToRadiusDegrees(zoom: number): number {
  return 25 * (360 / Math.pow(2, zoom) / 256);
}

/** Zoom level above which properties are shown individually (no clustering). */
const GHOST_NODE_THRESHOLD_ZOOM = 17;

/** Grid cell size in degrees, matching tiles.ts clustering logic. */
function getGridCellSize(zoom: number): number {
  const baseCellSize = 360 / Math.pow(2, zoom);
  return baseCellSize * 0.5;
}

/**
 * Build an index-friendly bounding box and exact radius filter for point searches.
 *
 * The geometry column is stored in EPSG:4326, so we prefilter with a geometry
 * bounding box that can use the existing GiST index before applying the exact
 * geography distance check for meter-accurate results.
 */
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

/**
 * Engagement count SQL fragment — single lateral subquery replacing 4 correlated
 * subqueries (comments was counted twice: once for activity_score, once for
 * comment_count; same for price_guesses).
 */
const engagementJoin = sql`LEFT JOIN LATERAL (
  SELECT
    COALESCE(c.cnt, 0)::int AS comment_count,
    COALESCE(g.cnt, 0)::int AS guess_count,
    COALESCE(lk.cnt, 0)::int AS like_count,
    (COALESCE(c.cnt, 0) + COALESCE(g.cnt, 0))::int AS activity_score
  FROM
    (SELECT 1) AS _dummy
    LEFT JOIN LATERAL (SELECT COUNT(*)::int AS cnt FROM comments WHERE property_id = p.id) c ON true
    LEFT JOIN LATERAL (SELECT COUNT(*)::int AS cnt FROM price_guesses WHERE property_id = p.id) g ON true
    LEFT JOIN LATERAL (SELECT COUNT(*)::int AS cnt FROM reactions WHERE target_type='property' AND target_id=p.id AND reaction_type='like') lk ON true
) eng ON true`;

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

const latestActiveListingJoin = sql`LEFT JOIN LATERAL (
  SELECT id, asking_price
  FROM listings
  WHERE property_id = p.id AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1
) l ON true`;

const latestThumbnailJoin = sql`LEFT JOIN LATERAL (
  SELECT thumbnail_url
  FROM listings
  WHERE property_id = p.id
    AND status = 'active'
    AND thumbnail_url IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1
) lt ON true`;

// Row type for cluster detection queries
type ClusterDetectionRow = {
  id: string;
  country_code: string;
  street: string;
  house_number: number;
  house_number_addition: string | null;
  city: string;
  postal_code: string | null;
  official_valuation: number | null;
  has_listing: boolean;
  asking_price: number | null;
  thumbnail_url: string | null;
  activity_score: number;
  like_count: number;
  comment_count: number;
  guess_count: number;
  distance_meters: number;
  lon: number;
  lat: number;
};

/** Map a DB row to a single-property cluster detection result. */
function mapToSingleResult(r: ClusterDetectionRow) {
  return {
    type: 'single' as const,
    id: r.id,
    street: r.street,
    houseNumber: r.house_number,
    houseNumberAddition: r.house_number_addition,
    address: formatDisplayAddress(
      {
        street: r.street,
        houseNumber: r.house_number,
        houseNumberAddition: r.house_number_addition,
        postalCode: r.postal_code ?? '',
        city: r.city,
      },
      isValidCountryCode(r.country_code) ? r.country_code : undefined,
    ),
    city: r.city,
    postalCode: r.postal_code,
    officialValuation: r.official_valuation != null ? Number(r.official_valuation) : null,
    hasListing: r.has_listing,
    askingPrice: r.asking_price != null ? Number(r.asking_price) : null,
    thumbnailUrl: r.thumbnail_url,
    activityScore: Number(r.activity_score),
    likeCount: Number(r.like_count),
    commentCount: Number(r.comment_count),
    guessCount: Number(r.guess_count),
    distanceMeters: Number(r.distance_meters),
    geometry:
      r.lon != null && r.lat != null
        ? { type: 'Point' as const, coordinates: [r.lon, r.lat] as [number, number] }
        : null,
  };
}

/**
 * Detect whether a tap point lands on a cluster or a single property.
 * Uses the same ST_SnapToGrid logic as tiles.ts for consistent results.
 */
async function detectCluster(lon: number, lat: number, zoom: number) {
  if (zoom >= GHOST_NODE_THRESHOLD_ZOOM) {
    // High zoom: no clustering on map, find nearest single property
    const radiusDeg = zoomToRadiusDegrees(zoom);
    const rows = await db.execute<ClusterDetectionRow>(sql`
      SELECT
        p.id,
        p.country_code,
        p.street,
        p.house_number,
        p.house_number_addition,
        p.city,
        p.postal_code,
        p.official_valuation,
        CASE WHEN l.id IS NOT NULL THEN true ELSE false END AS has_listing,
        l.asking_price,
        lt.thumbnail_url,
        eng.activity_score,
        eng.like_count,
        eng.comment_count,
        eng.guess_count,
        ST_Distance(
          p.geometry::geography,
          ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography
        ) AS distance_meters,
        ST_X(p.geometry) AS lon,
        ST_Y(p.geometry) AS lat
      FROM properties p
      ${latestActiveListingJoin}
      ${latestThumbnailJoin}
      ${engagementJoin}
      WHERE p.geometry IS NOT NULL
        AND p.status = 'active'
        AND ST_DWithin(
          p.geometry,
          ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326),
          ${radiusDeg}
        )
      ORDER BY distance_meters
      LIMIT 1
    `);

    const result = Array.from(rows);
    if (result.length === 0) return null;
    return mapToSingleResult(result[0]);
  }

  // Low zoom: cluster detection using ST_SnapToGrid (same logic as tiles.ts)
  const gridSize = getGridCellSize(zoom);
  const searchRadius = gridSize * 1.5;

  const rows = await db.execute<ClusterDetectionRow>(sql`
    WITH nearby AS (
      SELECT
        p.id,
        p.country_code,
        p.street,
        p.house_number,
        p.house_number_addition,
        p.city,
        p.postal_code,
        p.official_valuation,
        CASE WHEN l.id IS NOT NULL THEN true ELSE false END AS has_listing,
        l.asking_price,
        lt.thumbnail_url,
        eng.activity_score,
        eng.like_count,
        eng.comment_count,
        eng.guess_count,
        ST_Distance(
          p.geometry::geography,
          ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography
        ) AS distance_meters,
        ST_X(p.geometry) AS lon,
        ST_Y(p.geometry) AS lat
      FROM properties p
      ${latestActiveListingJoin}
      ${latestThumbnailJoin}
      ${engagementJoin}
      WHERE p.geometry IS NOT NULL
        AND p.status = 'active'
        AND ST_DWithin(
          p.geometry,
          ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326),
          ${searchRadius}
        )
        AND ST_SnapToGrid(p.geometry, ${gridSize}) = ST_SnapToGrid(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), ${gridSize})
    )
    SELECT * FROM nearby
    WHERE has_listing = true OR activity_score > 0
    ORDER BY distance_meters
  `);

  const result = Array.from(rows);
  if (result.length === 0) return null;
  if (result.length === 1) return mapToSingleResult(result[0]);

  // Multiple properties in the same grid cell = cluster
  const lons = result.map(r => Number(r.lon));
  const lats = result.map(r => Number(r.lat));
  const centroidLon = lons.reduce((a, b) => a + b, 0) / lons.length;
  const centroidLat = lats.reduce((a, b) => a + b, 0) / lats.length;

  const minLon = Math.min(...lons);
  const minLat = Math.min(...lats);
  const maxLon = Math.max(...lons);
  const maxLat = Math.max(...lats);

  return {
    type: 'cluster' as const,
    point_count: result.length,
    property_ids: result.map(r => r.id).join(','),
    coordinate: [centroidLon, centroidLat] as [number, number],
    distanceMeters: Number(result[0].distance_meters),
    bbox: [minLon, minLat, maxLon, maxLat] as [number, number, number, number],
  };
}

/**
 * Map common DB row fields to camelCase response fields.
 * Used by properties list, property detail, and saved-properties endpoints.
 */
function mapPropertyRow(r: {
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
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: r.id,
    nationalId: r.national_id,
    countryCode: r.country_code,
    region: r.region,
    street: r.street,
    houseNumber: r.house_number,
    houseNumberAddition: r.house_number_addition,
    address: formatDisplayAddress(
      {
        street: r.street,
        houseNumber: r.house_number,
        houseNumberAddition: r.house_number_addition,
        postalCode: r.postal_code ?? '',
        city: r.city,
      },
      isValidCountryCode(r.country_code) ? r.country_code : undefined,
    ),
    city: r.city,
    postalCode: r.postal_code,
    geometry:
      r.lon != null && r.lat != null
        ? { type: 'Point' as const, coordinates: [r.lon, r.lat] as [number, number] }
        : null,
    imageryGeometry:
      r.imagery_lon != null && r.imagery_lat != null
        ? {
            type: 'Point' as const,
            coordinates: [r.imagery_lon, r.imagery_lat] as [number, number],
          }
        : null,
    yearBuilt: r.year_built != null ? Number(r.year_built) : null,
    floorAreaM2: r.floor_area_m2 != null ? Number(r.floor_area_m2) : null,
    status: r.status as 'active' | 'inactive' | 'demolished',
    officialValuation: r.official_valuation != null ? Number(r.official_valuation) : null,
    thumbnailUrl: r.thumbnail_url,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export async function propertyRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // GET /properties - List properties with optional geospatial filters
  typedApp.get(
    '/properties',
    {
      schema: {
        tags: ['properties'],
        summary: 'List properties',
        description: 'Get a paginated list of properties with optional filtering by city, price range, or geographic bounds',
        querystring: propertyListQuerySchema,
        response: {
          200: propertyListResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { page, limit, city, minPrice, maxPrice, bbox, lat, lon, radius } = request.query;
      const offset = (page - 1) * limit;

      // Build WHERE conditions dynamically using raw SQL fragments
      const conditions: ReturnType<typeof sql>[] = [];

      if (city) {
        conditions.push(sql`p.city = ${city}`);
      }

      if (minPrice !== undefined) {
        conditions.push(sql`p.official_valuation >= ${minPrice}`);
      }

      if (maxPrice !== undefined) {
        conditions.push(sql`p.official_valuation <= ${maxPrice}`);
      }

      // Bounding box query (requires PostGIS)
      if (bbox) {
        const [minLon, minLat, maxLon, maxLat] = bbox.split(',').map(Number);
        if (minLon != null && minLat != null && maxLon != null && maxLat != null
            && !Number.isNaN(minLon) && !Number.isNaN(minLat) && !Number.isNaN(maxLon) && !Number.isNaN(maxLat)) {
          // properties.geometry is a Point in EPSG:4326, so bounding-box overlap
          // is equivalent to point-in-envelope while remaining GiST-index friendly.
          conditions.push(
            sql`p.geometry && ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)`
          );
        }
      }

      // Point + radius query (requires PostGIS)
      if (lat !== undefined && lon !== undefined) {
        conditions.push(...buildRadiusConditions(lon, lat, radius));
      }

      const whereFragment = conditions.length > 0
        ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
        : sql``;

      // Get total count with same filters
      const countRows = await db.execute<{ cnt: number }>(sql`
        SELECT COUNT(*)::int AS cnt
        FROM properties p
        ${whereFragment}
      `);
      const total = Array.from(countRows)[0]?.cnt ?? 0;

      // Get paginated results with listing, comment, and guess data
      const rows = await db.execute<{
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
        has_listing: boolean;
        asking_price: number | null;
        thumbnail_url: string | null;
        like_count: number;
        comment_count: number;
        guess_count: number;
        created_at: string;
        updated_at: string;
      }>(sql`
        WITH page_rows AS (
          SELECT
            p.id,
            p.national_id,
            p.country_code,
            p.region,
            p.street,
            p.house_number,
            p.house_number_addition,
            p.city,
            p.postal_code,
            p.geometry,
            p.year_built,
            p.floor_area_m2,
            p.status,
            p.official_valuation,
            p.created_at,
            p.updated_at
          FROM properties p
          ${whereFragment}
          ORDER BY p.created_at
          LIMIT ${limit}
          OFFSET ${offset}
        )
        SELECT
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
          CASE WHEN l.id IS NOT NULL THEN true ELSE false END AS has_listing,
          l.asking_price,
          lt.thumbnail_url,
          eng.like_count,
          eng.comment_count,
          eng.guess_count,
          p.created_at,
          p.updated_at
        FROM page_rows p
        ${latestActiveListingJoin}
        ${latestThumbnailJoin}
        ${engagementJoin}
        ${imageryJoin}
        ORDER BY p.created_at
      `);

      const results = Array.from(rows).map((r) => ({
        ...mapPropertyRow(r),
        hasListing: r.has_listing,
        askingPrice: r.asking_price != null ? Number(r.asking_price) : null,
        likeCount: Number(r.like_count),
        commentCount: Number(r.comment_count),
        guessCount: Number(r.guess_count),
      }));

      return reply.send({
        data: results,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    }
  );

  // GET /properties/resolve - Resolve an address to a local property
  typedApp.get(
    '/properties/resolve',
    {
      schema: {
        tags: ['properties'],
        summary: 'Resolve address to property',
        description:
          'Resolve a canonical address to a local property UUID and coordinates. ' +
          'Matches the multi-country uniqueness model on country code, street, postal code, house number, and house number addition.',
        querystring: resolveQuerySchema,
        response: {
          200: resolveResponseSchema,
          400: z.object({
            error: z.string(),
            message: z.string(),
          }),
          409: z.object({
            error: z.string(),
            message: z.string(),
          }),
          404: z.object({
            error: z.string(),
            message: z.string(),
          }),
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

      // Validate country code against config registry
      if (!isValidCountryCode(rawCC)) {
        return reply.status(400).send({
          error: 'BAD_REQUEST',
          message: `Unsupported country code: ${rawCC}`,
        });
      }
      const cc = rawCC as CountryCode;

      // Validate postal code against country-specific regex
      const cfg = getCountryConfig(cc);
      const stripped = postalCode.replace(/\s/g, '').toUpperCase();
      if (!cfg.postalCodeRegex.test(stripped)) {
        return reply.status(400).send({
          error: 'BAD_REQUEST',
          message: `Invalid postal code format for ${cfg.name}: "${postalCode}"`,
        });
      }
      const normalizedPostalCode = stripped;

      // Normalize addition: trim, uppercase, treat empty as null
      const normalizedAddition = houseNumberAddition?.trim().toUpperCase() || null;
      const normalizedStreet = normalizeComparableAddressPart(street);
      const normalizedCity = normalizeComparableAddressPart(city);

      // Exact match using the canonical address key. Country is always part of the
      // predicate; street/city are applied in-memory because the candidate set at a
      // fixed postal code + house number + addition is intentionally tiny.
      const additionCondition = normalizedAddition
        ? sql`p.house_number_addition = ${normalizedAddition}`
        : sql`(p.house_number_addition IS NULL OR p.house_number_addition = '')`;

      const rows = await db.execute<{
        id: string;
        country_code: string;
        street: string;
        house_number: number;
        house_number_addition: string | null;
        city: string;
        postal_code: string;
        official_valuation: number | null;
        has_listing: boolean;
        lon: number | null;
        lat: number | null;
      }>(sql`
        SELECT
          p.id,
          p.country_code,
          p.street,
          p.house_number,
          p.house_number_addition,
          p.city,
          p.postal_code,
          p.official_valuation,
          CASE WHEN l.id IS NOT NULL THEN true ELSE false END AS has_listing,
          ST_X(p.geometry) AS lon,
          ST_Y(p.geometry) AS lat
        FROM properties p
        LEFT JOIN LATERAL (
          SELECT id FROM listings
          WHERE property_id = p.id AND status = 'active'
          LIMIT 1
        ) l ON true
        WHERE p.country_code = ${cc}
          AND p.postal_code = ${normalizedPostalCode}
          AND p.house_number = ${houseNumber}
          AND ${additionCondition}
        LIMIT 10
      `);

      const result = Array.from(rows);

      const narrowed = result.filter((row) => {
        const streetMatches = !normalizedStreet
          || normalizeComparableAddressPart(row.street) === normalizedStreet;
        const cityMatches = !normalizedCity
          || normalizeComparableAddressPart(row.city) === normalizedCity;
        return streetMatches && cityMatches;
      });

      if (narrowed.length === 0) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `No property found for ${cc} ${normalizedPostalCode} ${houseNumber}${normalizedAddition ?? ''}`,
        });
      }

      if (narrowed.length > 1) {
        return reply.status(409).send({
          error: 'AMBIGUOUS_ADDRESS',
          message: 'Multiple properties matched this address. Provide street and city to disambiguate.',
        });
      }

      const r = narrowed[0];
      return reply.send({
        id: r.id,
        address: formatDisplayAddress(
          {
            street: r.street,
            houseNumber: r.house_number,
            houseNumberAddition: r.house_number_addition,
            postalCode: r.postal_code ?? '',
            city: r.city,
          },
          isValidCountryCode(r.country_code) ? r.country_code : undefined,
        ),
        postalCode: r.postal_code,
        city: r.city,
        coordinates: {
          lon: r.lon ?? 0,
          lat: r.lat ?? 0,
        },
        hasListing: r.has_listing,
        officialValuation: r.official_valuation != null ? Number(r.official_valuation) : null,
      });
    }
  );

  // GET /properties/nearby - Find nearest properties to a coordinate (KNN)
  // Used as a fallback for native map taps when queryRenderedFeatures fails
  typedApp.get(
    '/properties/nearby',
    {
      schema: {
        tags: ['properties'],
        summary: 'Find nearby properties',
        description:
          'Find the nearest properties to a given coordinate using PostGIS KNN. ' +
          'The search radius is derived from the zoom level. ' +
          'Used as a fallback for native map tap when queryRenderedFeatures is unreliable. ' +
          'When cluster=true, detects if the tap lands on a cluster or single property.',
        querystring: nearbyQuerySchema,
        response: {
          200: z.union([nearbyResponseSchema, nearbyClusterResponseSchema]),
        },
      },
    },
    async (request, reply) => {
      const { lon, lat, zoom, limit, cluster } = request.query;

      // Cluster detection mode: returns a single cluster/property or null
      if (cluster) {
        const result = await detectCluster(lon, lat, zoom);
        return reply.send(result);
      }

      const radiusDeg = zoomToRadiusDegrees(zoom);

      // PostGIS nearby query:
      // 1. ST_DWithin pre-filters to a bounding-box for GiST index usage
      // 2. ST_Distance(geography) orders by geodesic distance (matches returned distanceMeters)
      // 3. Joins with listings, comments, price_guesses for activity data
      const rows = await db.execute<{
        id: string;
        country_code: string;
        street: string;
        house_number: number;
        house_number_addition: string | null;
        city: string;
        postal_code: string | null;
        official_valuation: number | null;
        has_listing: boolean;
        asking_price: number | null;
        thumbnail_url: string | null;
        activity_score: number;
        like_count: number;
        comment_count: number;
        guess_count: number;
        distance_meters: number;
        lon: number;
        lat: number;
      }>(sql`
        SELECT
          p.id,
          p.country_code,
          p.street,
          p.house_number,
          p.house_number_addition,
          p.city,
          p.postal_code,
          p.official_valuation,
          CASE WHEN l.id IS NOT NULL THEN true ELSE false END AS has_listing,
          l.asking_price,
          lt.thumbnail_url,
          eng.activity_score,
          eng.like_count,
          eng.comment_count,
          eng.guess_count,
          ST_Distance(
            p.geometry::geography,
            ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography
          ) AS distance_meters,
          ST_X(p.geometry) AS lon,
          ST_Y(p.geometry) AS lat
        FROM properties p
        ${latestActiveListingJoin}
        ${latestThumbnailJoin}
        ${engagementJoin}
        WHERE p.geometry IS NOT NULL
          AND p.status = 'active'
          AND ST_DWithin(
            p.geometry,
            ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326),
            ${radiusDeg}
          )
        ORDER BY distance_meters
        LIMIT ${limit}
      `);

      const results = Array.from(rows).map((r) => ({
        id: r.id,
        street: r.street,
        houseNumber: r.house_number,
        houseNumberAddition: r.house_number_addition,
        address: formatDisplayAddress(
          {
            street: r.street,
            houseNumber: r.house_number,
            houseNumberAddition: r.house_number_addition,
            postalCode: r.postal_code ?? '',
            city: r.city,
          },
          isValidCountryCode(r.country_code) ? r.country_code : undefined,
        ),
        city: r.city,
        postalCode: r.postal_code,
        officialValuation: r.official_valuation != null ? Number(r.official_valuation) : null,
        hasListing: r.has_listing,
        askingPrice: r.asking_price != null ? Number(r.asking_price) : null,
        thumbnailUrl: r.thumbnail_url,
        activityScore: Number(r.activity_score),
        likeCount: Number(r.like_count),
        commentCount: Number(r.comment_count),
        guessCount: Number(r.guess_count),
        distanceMeters: Number(r.distance_meters),
        geometry:
          r.lon != null && r.lat != null
            ? { type: 'Point' as const, coordinates: [r.lon, r.lat] as [number, number] }
            : null,
      }));

      return reply.send(results);
    }
  );

  // GET /properties/batch - Fetch multiple properties by IDs
  const batchQuerySchema = z.object({
    ids: z.string().transform((val) => val.split(',')).pipe(
      z.array(z.string().uuid()).min(1).max(50)
    ),
  });

  typedApp.get(
    '/properties/batch',
    {
      schema: {
        tags: ['properties'],
        summary: 'Batch fetch properties',
        description: 'Fetch multiple properties by their IDs (comma-separated, max 50). Returns properties in the same order as the input IDs.',
        querystring: batchQuerySchema,
        response: {
          200: z.array(propertySchema),
        },
      },
    },
    async (request, reply) => {
      const { ids } = request.query;

      const rows = await db.execute<{
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
        has_listing: boolean;
        asking_price: number | null;
        thumbnail_url: string | null;
        like_count: number;
        comment_count: number;
        guess_count: number;
        created_at: string;
        updated_at: string;
      }>(sql`
        SELECT
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
          CASE WHEN l.id IS NOT NULL THEN true ELSE false END AS has_listing,
          l.asking_price,
          lt.thumbnail_url,
          eng.like_count,
          eng.comment_count,
          eng.guess_count,
          p.created_at,
          p.updated_at
        FROM properties p
        ${latestActiveListingJoin}
        ${latestThumbnailJoin}
        ${engagementJoin}
        ${imageryJoin}
        WHERE p.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      `);

      // Build a Map for O(1) lookup, then return in input order
      const rowMap = new Map<string, (typeof results)[0]>();
      const results = Array.from(rows).map((r) => ({
        ...mapPropertyRow(r),
        hasListing: r.has_listing,
        askingPrice: r.asking_price != null ? Number(r.asking_price) : null,
        likeCount: Number(r.like_count),
        commentCount: Number(r.comment_count),
        guessCount: Number(r.guess_count),
      }));
      for (const item of results) {
        rowMap.set(item.id, item);
      }

      const ordered = ids
        .map((id) => rowMap.get(id))
        .filter((item): item is NonNullable<typeof item> => item != null);

      return reply.send(ordered);
    }
  );

  // GET /properties/:id - Get a single property by ID
  typedApp.get(
    '/properties/:id',
    {
      onRequest: [app.optionalAuth],
      schema: {
        tags: ['properties'],
        summary: 'Get property by ID',
        description: 'Get detailed information about a specific property',
        params: propertyParamsSchema,
        response: {
          200: propertyDetailSchema,
          404: z.object({
            error: z.string(),
            message: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.userId;

      // Use a placeholder UUID for unauthenticated requests (will never match)
      const effectiveUserId = userId || '00000000-0000-4000-a000-000000000000';

      const rows = await db.execute<{
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
        has_listing: boolean;
        asking_price: number | null;
        thumbnail_url: string | null;
        like_count: number;
        is_liked: boolean;
        is_saved: boolean;
        view_count: number;
        unique_viewers: number;
        recent_views: number;
        comment_count: number;
        guess_count: number;
        created_at: string;
        updated_at: string;
      }>(sql`
        SELECT
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
          CASE WHEN l.id IS NOT NULL THEN true ELSE false END AS has_listing,
          l.asking_price,
          lt.thumbnail_url,
          eng.like_count,
          EXISTS(SELECT 1 FROM reactions WHERE target_type='property' AND target_id=p.id AND user_id=${effectiveUserId} AND reaction_type='like') AS is_liked,
          EXISTS(SELECT 1 FROM saved_properties WHERE property_id=p.id AND user_id=${effectiveUserId}) AS is_saved,
          pv.view_count,
          pv.unique_viewers,
          pv.recent_views,
          eng.comment_count,
          eng.guess_count,
          p.created_at,
          p.updated_at
        FROM properties p
        ${latestActiveListingJoin}
        ${latestThumbnailJoin}
        ${engagementJoin}
        ${imageryJoin}
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS view_count,
            COUNT(DISTINCT COALESCE(user_id::text, session_id, id::text))::int AS unique_viewers,
            COUNT(*) FILTER (WHERE viewed_at > NOW() - INTERVAL '7 days')::int AS recent_views
          FROM property_views WHERE property_id = p.id
        ) pv ON true
        WHERE p.id = ${id}
        LIMIT 1
      `);

      const result = Array.from(rows);
      if (result.length === 0) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Property with ID ${id} not found`,
        });
      }

      const r = result[0];
      const viewCount = Number(r.view_count);
      const uniqueViewers = Number(r.unique_viewers);
      const commentCount = Number(r.comment_count);
      const guessCount = Number(r.guess_count);
      const recentViews = Number(r.recent_views);

      // Calculate FMV — reuse official_valuation and asking_price already
      // loaded by the main query instead of re-fetching them (saves 2 DB round-trips)
      const guesses = await fetchGuessesWithKarma(id);
      const officialValuation = r.official_valuation != null ? Number(r.official_valuation) : null;
      const askingPrice = r.asking_price != null ? Number(r.asking_price) : null;
      const fmvResult = calculateFmv(guesses, officialValuation, askingPrice);

      return reply.send({
        ...mapPropertyRow(r),
        hasListing: r.has_listing,
        askingPrice: r.asking_price != null ? Number(r.asking_price) : null,
        likeCount: Number(r.like_count),
        isLiked: r.is_liked,
        isSaved: r.is_saved,
        viewCount,
        uniqueViewers,
        commentCount,
        guessCount,
        activityLevel: calculateActivityLevel(recentViews, commentCount, guessCount),
        fmv: fmvResult,
      });
    }
  );

  // POST /properties/:id/save — Save a property
  typedApp.post(
    '/properties/:id/save',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['properties'],
        summary: 'Save a property',
        description: 'Save a property to the user\'s saved list. Returns 409 if already saved.',
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

      // Verify property exists
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

      // Check if already saved
      const existing = await db
        .select({ id: savedProperties.id })
        .from(savedProperties)
        .where(
          and(
            eq(savedProperties.userId, userId),
            eq(savedProperties.propertyId, propertyId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        return reply.status(409).send({
          error: 'ALREADY_SAVED',
          message: 'You have already saved this property.',
        });
      }

      // Insert (try-catch for race condition on unique/FK constraint)
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

  // DELETE /properties/:id/save — Unsave a property
  typedApp.delete(
    '/properties/:id/save',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['properties'],
        summary: 'Unsave a property',
        description: 'Remove a property from the user\'s saved list. Returns 404 if not saved.',
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

      // Find the existing saved entry
      const existing = await db
        .select({ id: savedProperties.id })
        .from(savedProperties)
        .where(
          and(
            eq(savedProperties.userId, userId),
            eq(savedProperties.propertyId, propertyId)
          )
        )
        .limit(1);

      if (existing.length === 0) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'You have not saved this property.',
        });
      }

      await db
        .delete(savedProperties)
        .where(eq(savedProperties.id, existing[0].id));

      return reply.send({ saved: false });
    }
  );

  // GET /saved-properties — List user's saved properties (paginated)
  typedApp.get(
    '/saved-properties',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['properties'],
        summary: 'List saved properties',
        description: 'Get a paginated list of the user\'s saved properties, ordered by most recently saved.',
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

      // Total count for pagination
      const countRows = await db.execute<{ cnt: number }>(sql`
        SELECT COUNT(*)::int AS cnt FROM saved_properties WHERE user_id = ${userId}
      `);
      const total = Array.from(countRows)[0]?.cnt ?? 0;

      const rows = await db.execute<{
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
        has_listing: boolean;
        asking_price: number | null;
        thumbnail_url: string | null;
        comment_count: number;
        guess_count: number;
        saved_at: string;
        created_at: string;
        updated_at: string;
      }>(sql`
        SELECT
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
          CASE WHEN l.id IS NOT NULL THEN true ELSE false END AS has_listing,
          l.asking_price,
          lt.thumbnail_url,
          eng.comment_count,
          eng.guess_count,
          sp.created_at AS saved_at,
          p.created_at,
          p.updated_at
        FROM saved_properties sp
        INNER JOIN properties p ON p.id = sp.property_id
        ${latestActiveListingJoin}
        ${latestThumbnailJoin}
        ${engagementJoin}
        ${imageryJoin}
        WHERE sp.user_id = ${userId}
        ORDER BY sp.created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `);

      const results = Array.from(rows).map((r) => ({
        ...mapPropertyRow(r),
        hasListing: r.has_listing,
        askingPrice: r.asking_price != null ? Number(r.asking_price) : null,
        commentCount: Number(r.comment_count),
        guessCount: Number(r.guess_count),
        savedAt: new Date(r.saved_at).toISOString(),
      }));

      return reply.send({ data: results, total, hasMore: offset + limit < total });
    }
  );
}

// Export types for client usage
export type PropertyListQuery = z.infer<typeof propertyListQuerySchema>;
export type PropertyListResponse = z.infer<typeof propertyListResponseSchema>;
export type PropertyResponse = z.infer<typeof propertySchema>;
export type ResolveQuery = z.infer<typeof resolveQuerySchema>;
export type ResolveResponse = z.infer<typeof resolveResponseSchema>;
export type NearbyProperty = z.infer<typeof nearbyPropertySchema>;
export type NearbyResponse = z.infer<typeof nearbyResponseSchema>;
export type NearbyClusterResult = z.infer<typeof nearbyClusterResponseSchema>;
export type SaveResponse = z.infer<typeof saveResponseSchema>;
export type SavedPropertyResponse = z.infer<typeof savedPropertySchema>;
export type SavedPropertiesResponse = z.infer<typeof savedPropertiesResponseSchema>;
