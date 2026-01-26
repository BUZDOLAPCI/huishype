import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db, properties } from '../db/index.js';
import { eq, sql, and, gte, lte } from 'drizzle-orm';

// Schema definitions
const coordinateSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number(), z.number()]).describe('[longitude, latitude]'),
});

const propertySchema = z.object({
  id: z.string().uuid(),
  bagIdentificatie: z.string().nullable(),
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

const propertyParamsSchema = z.object({
  id: z.string().uuid(),
});

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

      // Build where conditions
      const conditions = [];

      if (city) {
        conditions.push(eq(properties.city, city));
      }

      if (minPrice !== undefined) {
        conditions.push(gte(properties.wozValue, minPrice));
      }

      if (maxPrice !== undefined) {
        conditions.push(lte(properties.wozValue, maxPrice));
      }

      // Bounding box query (requires PostGIS)
      if (bbox) {
        const [minLon, minLat, maxLon, maxLat] = bbox.split(',').map(Number);
        if (minLon && minLat && maxLon && maxLat) {
          conditions.push(
            sql`ST_Within(${properties.geometry}, ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326))`
          );
        }
      }

      // Point + radius query (requires PostGIS)
      if (lat !== undefined && lon !== undefined) {
        conditions.push(
          sql`ST_DWithin(
            ${properties.geometry}::geography,
            ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography,
            ${radius}
          )`
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Get total count
      const countResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(properties)
        .where(whereClause);
      const total = countResult[0]?.count ?? 0;

      // Get paginated results
      const results = await db
        .select()
        .from(properties)
        .where(whereClause)
        .limit(limit)
        .offset(offset)
        .orderBy(properties.createdAt);

      return reply.send({
        data: results.map((p) => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        })),
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
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
          200: propertySchema,
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
