import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db, properties as propertiesTable, savedProperties } from '../db/index.js';
import { sql, eq, and } from 'drizzle-orm';
import { formatDisplayAddress } from '../utils/address.js';
import { calculateActivityLevel } from './views.js';
import { calculateFmvForProperty } from '../services/fmv.js';

// Dutch address formatting: single-letter additions concatenate directly ("13A"),
// all other additions use a hyphen separator ("105-1", "13-BIS").
const ADDRESS_SQL = sql`p.street || ' ' || p.house_number || CASE
  WHEN p.house_number_addition IS NULL OR p.house_number_addition = '' THEN ''
  WHEN LENGTH(p.house_number_addition) = 1 AND p.house_number_addition ~ '^[A-Z]$' THEN p.house_number_addition
  ELSE '-' || p.house_number_addition
END || ', ' || p.postal_code || ' ' || p.city`;

// Schema definitions
const coordinateSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number(), z.number()]).describe('[longitude, latitude]'),
});

const propertySchema = z.object({
  id: z.string().uuid(),
  bagIdentificatie: z.string().nullable(),
  street: z.string(),
  houseNumber: z.number(),
  houseNumberAddition: z.string().nullable(),
  address: z.string(), // computed display string
  city: z.string(),
  postalCode: z.string().nullable(),
  geometry: coordinateSchema.nullable(),
  bouwjaar: z.number().nullable().describe('Construction year'),
  oppervlakte: z.number().nullable().describe('Surface area in m2'),
  status: z.enum(['active', 'inactive', 'demolished']),
  wozValue: z.number().nullable().describe('Official government valuation'),
  hasListing: z.boolean(),
  askingPrice: z.number().nullable(),
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
  wozValue: z.number().nullable(),
  askingPrice: z.number().nullable(),
  divergence: z.number().nullable(),
});

const propertyDetailSchema = z.object({
  id: z.string().uuid(),
  bagIdentificatie: z.string().nullable(),
  street: z.string(),
  houseNumber: z.number(),
  houseNumberAddition: z.string().nullable(),
  address: z.string(),
  city: z.string(),
  postalCode: z.string().nullable(),
  geometry: coordinateSchema.nullable(),
  bouwjaar: z.number().nullable().describe('Construction year'),
  oppervlakte: z.number().nullable().describe('Surface area in m2'),
  status: z.enum(['active', 'inactive', 'demolished']),
  wozValue: z.number().nullable().describe('Official government valuation'),
  hasListing: z.boolean().describe('Whether property has an active listing'),
  askingPrice: z.number().nullable().describe('Active listing asking price'),
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
  bagIdentificatie: z.string().nullable(),
  street: z.string(),
  houseNumber: z.number(),
  houseNumberAddition: z.string().nullable(),
  address: z.string(),
  city: z.string(),
  postalCode: z.string().nullable(),
  geometry: coordinateSchema.nullable(),
  bouwjaar: z.number().nullable(),
  oppervlakte: z.number().nullable(),
  status: z.enum(['active', 'inactive', 'demolished']),
  wozValue: z.number().nullable(),
  hasListing: z.boolean(),
  askingPrice: z.number().nullable(),
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
const resolveQuerySchema = z.object({
  postalCode: z.string().regex(/^\d{4}\s?[A-Za-z]{2}$/, 'Invalid Dutch postal code format'),
  houseNumber: z.coerce.number().int().positive(),
  houseNumberAddition: z.string().optional(),
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
  wozValue: z.number().nullable(),
});

// Schema for /properties/nearby endpoint
const nearbyQuerySchema = z.object({
  lon: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  zoom: z.coerce.number().min(0).max(22).default(17),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

const nearbyPropertySchema = z.object({
  id: z.string().uuid(),
  street: z.string(),
  houseNumber: z.number(),
  houseNumberAddition: z.string().nullable(),
  address: z.string(), // computed display string
  city: z.string(),
  postalCode: z.string().nullable(),
  wozValue: z.number().nullable(),
  hasListing: z.boolean(),
  activityScore: z.number(),
  distanceMeters: z.number(),
  geometry: coordinateSchema.nullable(),
});

const nearbyResponseSchema = z.array(nearbyPropertySchema);

/**
 * Compute search radius in degrees from a zoom level.
 * At z17 this is ~26m, at z18 ~13m, etc.
 */
function zoomToRadiusDegrees(zoom: number): number {
  return 25 * (360 / Math.pow(2, zoom) / 256);
}

/**
 * Map common DB row fields to camelCase response fields.
 * Used by properties list, property detail, and saved-properties endpoints.
 */
function mapPropertyRow(r: {
  id: string;
  bag_identificatie: string | null;
  street: string;
  house_number: number;
  house_number_addition: string | null;
  address: string;
  city: string;
  postal_code: string | null;
  lon: number | null;
  lat: number | null;
  bouwjaar: number | null;
  oppervlakte: number | null;
  status: string;
  woz_value: number | null;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: r.id,
    bagIdentificatie: r.bag_identificatie,
    street: r.street,
    houseNumber: r.house_number,
    houseNumberAddition: r.house_number_addition,
    address: r.address,
    city: r.city,
    postalCode: r.postal_code,
    geometry:
      r.lon != null && r.lat != null
        ? { type: 'Point' as const, coordinates: [r.lon, r.lat] as [number, number] }
        : null,
    bouwjaar: r.bouwjaar != null ? Number(r.bouwjaar) : null,
    oppervlakte: r.oppervlakte != null ? Number(r.oppervlakte) : null,
    status: r.status as 'active' | 'inactive' | 'demolished',
    wozValue: r.woz_value != null ? Number(r.woz_value) : null,
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
        conditions.push(sql`p.woz_value >= ${minPrice}`);
      }

      if (maxPrice !== undefined) {
        conditions.push(sql`p.woz_value <= ${maxPrice}`);
      }

      // Bounding box query (requires PostGIS)
      if (bbox) {
        const [minLon, minLat, maxLon, maxLat] = bbox.split(',').map(Number);
        if (minLon && minLat && maxLon && maxLat) {
          conditions.push(
            sql`ST_Within(p.geometry, ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326))`
          );
        }
      }

      // Point + radius query (requires PostGIS)
      if (lat !== undefined && lon !== undefined) {
        conditions.push(
          sql`ST_DWithin(
            p.geometry::geography,
            ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography,
            ${radius}
          )`
        );
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
        bag_identificatie: string | null;
        street: string;
        house_number: number;
        house_number_addition: string | null;
        address: string;
        city: string;
        postal_code: string | null;
        lon: number | null;
        lat: number | null;
        bouwjaar: number | null;
        oppervlakte: number | null;
        status: string;
        woz_value: number | null;
        has_listing: boolean;
        asking_price: number | null;
        comment_count: number;
        guess_count: number;
        created_at: string;
        updated_at: string;
      }>(sql`
        SELECT
          p.id,
          p.bag_identificatie,
          p.street,
          p.house_number,
          p.house_number_addition,
          ${ADDRESS_SQL} AS address,
          p.city,
          p.postal_code,
          ST_X(p.geometry) AS lon,
          ST_Y(p.geometry) AS lat,
          p.bouwjaar,
          p.oppervlakte,
          p.status,
          p.woz_value,
          CASE WHEN l.id IS NOT NULL THEN true ELSE false END AS has_listing,
          l.asking_price,
          (SELECT COUNT(*)::int FROM comments WHERE property_id = p.id) AS comment_count,
          (SELECT COUNT(*)::int FROM price_guesses WHERE property_id = p.id) AS guess_count,
          p.created_at,
          p.updated_at
        FROM properties p
        LEFT JOIN LATERAL (
          SELECT id, asking_price FROM listings
          WHERE property_id = p.id AND status = 'active'
          ORDER BY created_at DESC LIMIT 1
        ) l ON true
        ${whereFragment}
        ORDER BY p.created_at
        LIMIT ${limit}
        OFFSET ${offset}
      `);

      const results = Array.from(rows).map((r) => ({
        ...mapPropertyRow(r),
        hasListing: r.has_listing,
        askingPrice: r.asking_price != null ? Number(r.asking_price) : null,
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

  // GET /properties/resolve - Resolve a Dutch address to a local property
  typedApp.get(
    '/properties/resolve',
    {
      schema: {
        tags: ['properties'],
        summary: 'Resolve address to property',
        description:
          'Resolve a Dutch address (postal code + house number) to a local property UUID and coordinates. ' +
          'Uses the existing unique index on (postal_code, house_number, house_number_addition).',
        querystring: resolveQuerySchema,
        response: {
          200: resolveResponseSchema,
          404: z.object({
            error: z.string(),
            message: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { postalCode, houseNumber, houseNumberAddition } = request.query;

      // Normalize postal code: strip whitespace, uppercase
      const normalizedPostalCode = postalCode.replace(/\s/g, '').toUpperCase();

      // Normalize addition: trim, uppercase, treat empty as null
      const normalizedAddition = houseNumberAddition?.trim().toUpperCase() || null;

      // Exact match using the unique index on (postal_code, house_number, house_number_addition)
      // Note: DB stores empty string '' for no addition (not NULL), so we match both
      const additionCondition = normalizedAddition
        ? sql`p.house_number_addition = ${normalizedAddition}`
        : sql`(p.house_number_addition IS NULL OR p.house_number_addition = '')`;

      const rows = await db.execute<{
        id: string;
        street: string;
        house_number: number;
        house_number_addition: string | null;
        address: string;
        city: string;
        postal_code: string;
        woz_value: number | null;
        has_listing: boolean;
        lon: number | null;
        lat: number | null;
      }>(sql`
        SELECT
          p.id,
          p.street,
          p.house_number,
          p.house_number_addition,
          ${ADDRESS_SQL} AS address,
          p.city,
          p.postal_code,
          p.woz_value,
          CASE WHEN l.id IS NOT NULL THEN true ELSE false END AS has_listing,
          ST_X(p.geometry) AS lon,
          ST_Y(p.geometry) AS lat
        FROM properties p
        LEFT JOIN LATERAL (
          SELECT id FROM listings
          WHERE property_id = p.id AND status = 'active'
          LIMIT 1
        ) l ON true
        WHERE p.postal_code = ${normalizedPostalCode}
          AND p.house_number = ${houseNumber}
          AND ${additionCondition}
        LIMIT 1
      `);

      const result = Array.from(rows);
      if (result.length === 0) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `No property found for ${normalizedPostalCode} ${houseNumber}${normalizedAddition ?? ''}`,
        });
      }

      const r = result[0];
      return reply.send({
        id: r.id,
        address: r.address,
        postalCode: r.postal_code,
        city: r.city,
        coordinates: {
          lon: r.lon ?? 0,
          lat: r.lat ?? 0,
        },
        hasListing: r.has_listing,
        wozValue: r.woz_value != null ? Number(r.woz_value) : null,
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
          'Used as a fallback for native map tap when queryRenderedFeatures is unreliable.',
        querystring: nearbyQuerySchema,
        response: {
          200: nearbyResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { lon, lat, zoom, limit } = request.query;
      const radiusDeg = zoomToRadiusDegrees(zoom);

      // PostGIS nearby query:
      // 1. ST_DWithin pre-filters to a bounding-box for GiST index usage
      // 2. ST_Distance(geography) orders by geodesic distance (matches returned distanceMeters)
      // 3. Joins with listings, comments, price_guesses for activity data
      const rows = await db.execute<{
        id: string;
        street: string;
        house_number: number;
        house_number_addition: string | null;
        address: string;
        city: string;
        postal_code: string | null;
        woz_value: number | null;
        has_listing: boolean;
        activity_score: number;
        distance_meters: number;
        lon: number;
        lat: number;
      }>(sql`
        SELECT
          p.id,
          p.street,
          p.house_number,
          p.house_number_addition,
          ${ADDRESS_SQL} AS address,
          p.city,
          p.postal_code,
          p.woz_value,
          CASE WHEN l.id IS NOT NULL THEN true ELSE false END AS has_listing,
          ((SELECT COUNT(*)::int FROM comments WHERE property_id = p.id) + (SELECT COUNT(*)::int FROM price_guesses WHERE property_id = p.id))::int AS activity_score,
          ST_Distance(
            p.geometry::geography,
            ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography
          ) AS distance_meters,
          ST_X(p.geometry) AS lon,
          ST_Y(p.geometry) AS lat
        FROM properties p
        LEFT JOIN LATERAL (
          SELECT id FROM listings
          WHERE property_id = p.id AND status = 'active'
          LIMIT 1
        ) l ON true
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
        address: r.address,
        city: r.city,
        postalCode: r.postal_code,
        wozValue: r.woz_value != null ? Number(r.woz_value) : null,
        hasListing: r.has_listing,
        activityScore: Number(r.activity_score),
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
        bag_identificatie: string | null;
        street: string;
        house_number: number;
        house_number_addition: string | null;
        address: string;
        city: string;
        postal_code: string | null;
        lon: number | null;
        lat: number | null;
        bouwjaar: number | null;
        oppervlakte: number | null;
        status: string;
        woz_value: number | null;
        has_listing: boolean;
        asking_price: number | null;
        comment_count: number;
        guess_count: number;
        created_at: string;
        updated_at: string;
      }>(sql`
        SELECT
          p.id,
          p.bag_identificatie,
          p.street,
          p.house_number,
          p.house_number_addition,
          ${ADDRESS_SQL} AS address,
          p.city,
          p.postal_code,
          ST_X(p.geometry) AS lon,
          ST_Y(p.geometry) AS lat,
          p.bouwjaar,
          p.oppervlakte,
          p.status,
          p.woz_value,
          CASE WHEN l.id IS NOT NULL THEN true ELSE false END AS has_listing,
          l.asking_price,
          (SELECT COUNT(*)::int FROM comments WHERE property_id = p.id) AS comment_count,
          (SELECT COUNT(*)::int FROM price_guesses WHERE property_id = p.id) AS guess_count,
          p.created_at,
          p.updated_at
        FROM properties p
        LEFT JOIN LATERAL (
          SELECT id, asking_price FROM listings
          WHERE property_id = p.id AND status = 'active'
          ORDER BY created_at DESC LIMIT 1
        ) l ON true
        WHERE p.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      `);

      // Build a Map for O(1) lookup, then return in input order
      const rowMap = new Map<string, (typeof results)[0]>();
      const results = Array.from(rows).map((r) => ({
        ...mapPropertyRow(r),
        hasListing: r.has_listing,
        askingPrice: r.asking_price != null ? Number(r.asking_price) : null,
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
        bag_identificatie: string | null;
        street: string;
        house_number: number;
        house_number_addition: string | null;
        address: string;
        city: string;
        postal_code: string | null;
        lon: number | null;
        lat: number | null;
        bouwjaar: number | null;
        oppervlakte: number | null;
        status: string;
        woz_value: number | null;
        has_listing: boolean;
        asking_price: number | null;
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
          p.bag_identificatie,
          p.street,
          p.house_number,
          p.house_number_addition,
          ${ADDRESS_SQL} AS address,
          p.city,
          p.postal_code,
          ST_X(p.geometry) AS lon,
          ST_Y(p.geometry) AS lat,
          p.bouwjaar,
          p.oppervlakte,
          p.status,
          p.woz_value,
          CASE WHEN l.id IS NOT NULL THEN true ELSE false END AS has_listing,
          l.asking_price,
          (SELECT COUNT(*)::int FROM reactions WHERE target_type='property' AND target_id=p.id AND reaction_type='like') AS like_count,
          EXISTS(SELECT 1 FROM reactions WHERE target_type='property' AND target_id=p.id AND user_id=${effectiveUserId} AND reaction_type='like') AS is_liked,
          EXISTS(SELECT 1 FROM saved_properties WHERE property_id=p.id AND user_id=${effectiveUserId}) AS is_saved,
          (SELECT COUNT(*)::int FROM property_views WHERE property_id=p.id) AS view_count,
          (SELECT COUNT(DISTINCT COALESCE(user_id::text, session_id, id::text))::int FROM property_views WHERE property_id=p.id) AS unique_viewers,
          (SELECT COUNT(*)::int FROM property_views WHERE property_id=p.id AND viewed_at > NOW() - INTERVAL '7 days') AS recent_views,
          (SELECT COUNT(*)::int FROM comments WHERE property_id=p.id) AS comment_count,
          (SELECT COUNT(*)::int FROM price_guesses WHERE property_id=p.id) AS guess_count,
          p.created_at,
          p.updated_at
        FROM properties p
        LEFT JOIN LATERAL (
          SELECT id, asking_price FROM listings
          WHERE property_id = p.id AND status = 'active'
          ORDER BY created_at DESC LIMIT 1
        ) l ON true
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

      // Calculate FMV with karma-weighting and WOZ anchoring
      const fmvResult = await calculateFmvForProperty(id);

      return reply.send({
        ...mapPropertyRow(r),
        // Override address with formatted display address
        address: formatDisplayAddress({
          street: r.street,
          houseNumber: r.house_number,
          houseNumberAddition: r.house_number_addition,
          postalCode: r.postal_code,
          city: r.city,
        }),
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
        bag_identificatie: string | null;
        street: string;
        house_number: number;
        house_number_addition: string | null;
        address: string;
        city: string;
        postal_code: string | null;
        lon: number | null;
        lat: number | null;
        bouwjaar: number | null;
        oppervlakte: number | null;
        status: string;
        woz_value: number | null;
        has_listing: boolean;
        asking_price: number | null;
        comment_count: number;
        guess_count: number;
        saved_at: string;
        created_at: string;
        updated_at: string;
      }>(sql`
        SELECT
          p.id,
          p.bag_identificatie,
          p.street,
          p.house_number,
          p.house_number_addition,
          ${ADDRESS_SQL} AS address,
          p.city,
          p.postal_code,
          ST_X(p.geometry) AS lon,
          ST_Y(p.geometry) AS lat,
          p.bouwjaar,
          p.oppervlakte,
          p.status,
          p.woz_value,
          CASE WHEN l.id IS NOT NULL THEN true ELSE false END AS has_listing,
          l.asking_price,
          (SELECT COUNT(*)::int FROM comments WHERE property_id = p.id) AS comment_count,
          (SELECT COUNT(*)::int FROM price_guesses WHERE property_id = p.id) AS guess_count,
          sp.created_at AS saved_at,
          p.created_at,
          p.updated_at
        FROM saved_properties sp
        INNER JOIN properties p ON p.id = sp.property_id
        LEFT JOIN LATERAL (
          SELECT id, asking_price FROM listings
          WHERE property_id = p.id AND status = 'active'
          ORDER BY created_at DESC LIMIT 1
        ) l ON true
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
export type SaveResponse = z.infer<typeof saveResponseSchema>;
export type SavedPropertyResponse = z.infer<typeof savedPropertySchema>;
export type SavedPropertiesResponse = z.infer<typeof savedPropertiesResponseSchema>;
