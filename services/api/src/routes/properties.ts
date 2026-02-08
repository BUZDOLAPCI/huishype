import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db, properties } from '../db/index.js';
import { eq, sql } from 'drizzle-orm';
import { formatDisplayAddress } from '../utils/address.js';

const ADDRESS_SQL = sql`p.street || ' ' || p.house_number || COALESCE(p.house_number_addition, '') || ', ' || p.postal_code || ' ' || p.city`;

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
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const propertyParamsSchema = z.object({
  id: z.string().uuid(),
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
          COALESCE(cc.cnt, 0)::int AS comment_count,
          COALESCE(gc.cnt, 0)::int AS guess_count,
          p.created_at,
          p.updated_at
        FROM properties p
        LEFT JOIN LATERAL (
          SELECT id, asking_price FROM listings
          WHERE property_id = p.id AND status = 'active'
          ORDER BY created_at DESC LIMIT 1
        ) l ON true
        LEFT JOIN (
          SELECT property_id, COUNT(*)::int AS cnt
          FROM comments GROUP BY property_id
        ) cc ON cc.property_id = p.id
        LEFT JOIN (
          SELECT property_id, COUNT(*)::int AS cnt
          FROM price_guesses GROUP BY property_id
        ) gc ON gc.property_id = p.id
        ${whereFragment}
        ORDER BY p.created_at
        LIMIT ${limit}
        OFFSET ${offset}
      `);

      const results = Array.from(rows).map((r) => ({
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
        hasListing: r.has_listing,
        askingPrice: r.asking_price != null ? Number(r.asking_price) : null,
        commentCount: Number(r.comment_count),
        guessCount: Number(r.guess_count),
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
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

      // PostGIS KNN query:
      // 1. ST_DWithin pre-filters to a bounding-box for index usage
      // 2. <-> operator orders by distance (KNN index scan)
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
          (COALESCE(cc.cnt, 0) + COALESCE(gc.cnt, 0))::int AS activity_score,
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
        LEFT JOIN (
          SELECT property_id, COUNT(*)::int AS cnt
          FROM comments
          GROUP BY property_id
        ) cc ON cc.property_id = p.id
        LEFT JOIN (
          SELECT property_id, COUNT(*)::int AS cnt
          FROM price_guesses
          GROUP BY property_id
        ) gc ON gc.property_id = p.id
        WHERE p.geometry IS NOT NULL
          AND p.status = 'active'
          AND ST_DWithin(
            p.geometry,
            ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326),
            ${radiusDeg}
          )
        ORDER BY p.geometry <-> ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)
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

  // GET /properties/:id - Get a single property by ID
  typedApp.get(
    '/properties/:id',
    {
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

      const result = await db
        .select()
        .from(properties)
        .where(eq(properties.id, id))
        .limit(1);

      if (result.length === 0) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Property with ID ${id} not found`,
        });
      }

      const property = result[0];
      return reply.send({
        ...property,
        address: formatDisplayAddress({
          street: property.street,
          houseNumber: property.houseNumber,
          houseNumberAddition: property.houseNumberAddition,
          postalCode: property.postalCode,
          city: property.city,
        }),
        createdAt: property.createdAt.toISOString(),
        updatedAt: property.updatedAt.toISOString(),
      });
    }
  );
}

// Export types for client usage
export type PropertyListQuery = z.infer<typeof propertyListQuerySchema>;
export type PropertyListResponse = z.infer<typeof propertyListResponseSchema>;
export type PropertyResponse = z.infer<typeof propertySchema>;
export type NearbyProperty = z.infer<typeof nearbyPropertySchema>;
export type NearbyResponse = z.infer<typeof nearbyResponseSchema>;
