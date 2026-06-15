/**
 * Activity routes
 *
 * GET /activity?scope=public|following
 * GET /users/me/activity
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { fetchActivityFeed } from '../services/activity-feed.js';
import { fetchGroupedPropertyActivityFeed } from '../services/grouped-property-activity-feed.js';
import { parsePropertyMarketFiltersQuery } from '../services/map-filters.js';

const publicActivityEventTypes = ['property_like', 'comment', 'price_guess'] as const;
const selfActivityEventTypes = [...publicActivityEventTypes, 'save'] as const;

const actorSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  handle: z.string(),
  profilePhotoUrl: z.string().nullable(),
});

const coordinateSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number(), z.number()]),
});

const marketStateSchema = z.enum(['for-sale', 'for-rent', 'sold', 'rented', 'not-listed']);

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

const propertyPayloadSchema = z.object({
  id: z.string().uuid(),
  address: z.string(),
  streetName: z.string(),
  houseNumber: z.number(),
  houseNumberAddition: z.string().nullable(),
  city: z.string(),
  postalCode: z.string(),
  countryCode: z.string(),
  geometry: coordinateSchema.nullable(),
  thumbnailUrl: z.string().nullable(),
});

const groupedPropertyPayloadSchema = propertyPayloadSchema.extend({
  askingPrice: z.number().nullable(),
  officialValuation: z.number().nullable(),
  officialValuationYear: z.number().nullable(),
  officialValuationSourceFetch: officialValuationSourceFetchSchema,
  marketState: marketStateSchema,
  hasListing: z.boolean(),
  yearBuilt: z.number().nullable(),
  floorAreaM2: z.number().nullable(),
  isLiked: z.boolean(),
  isSaved: z.boolean(),
});

function createActivityResponseSchema<TEventTypes extends readonly [string, ...string[]]>(
  eventTypes: TEventTypes
) {
  return z.object({
    items: z.array(
      z.object({
        id: z.string().uuid(),
        eventType: z.enum(eventTypes),
        actor: actorSchema,
        property: propertyPayloadSchema,
        createdAt: z.string().datetime(),
        meta: z.record(z.string(), z.any()).nullable(),
      })
    ),
    pagination: z.object({
      limit: z.number(),
      offset: z.number(),
      hasMore: z.boolean(),
    }),
  });
}

const publicActivityResponseSchema = createActivityResponseSchema(publicActivityEventTypes);
const selfActivityResponseSchema = createActivityResponseSchema(selfActivityEventTypes);
const groupedActivityCountsSchema = z.object({
  likeCount: z.number(),
  commentCount: z.number(),
  guessCount: z.number(),
});

const groupedActivityCommentPreviewSchema = z.object({
  kind: z.literal('comment'),
  commentId: z.string().uuid(),
  createdAt: z.string().datetime(),
  actor: actorSchema,
  contentPreview: z.string(),
  likeCount: z.number(),
  isLiked: z.boolean(),
});

const groupedActivitySummaryPreviewSchema = z.object({
  kind: z.literal('summary'),
  eventType: z.enum(publicActivityEventTypes),
  createdAt: z.string().datetime(),
  actor: actorSchema,
  summary: z.string(),
});

const groupedActivityResponseSchema = z.object({
  items: z.array(
    z.object({
      property: groupedPropertyPayloadSchema,
      lastActivityAt: z.string().datetime(),
      counts: groupedActivityCountsSchema,
      recentActors: z.array(actorSchema),
      preview: z.discriminatedUnion('kind', [
        groupedActivityCommentPreviewSchema,
        groupedActivitySummaryPreviewSchema,
      ]),
    })
  ),
  pagination: z.object({
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean(),
  }),
});

const activityQuerySchema = z.object({
  scope: z.enum(['public', 'following']).default('public'),
  activity: z.enum(['all', 'today', '10d', '30d', 'all-time']).optional().default('all'),
  listedSince: z.enum(['all', 'today', '3d', '5d', '10d', '30d']).optional().default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const groupedActivityQuerySchema = activityQuerySchema.extend({
  salePriceFrom: z.coerce.number().int().positive().optional(),
  salePriceTo: z.coerce.number().int().positive().optional(),
  rentPriceFrom: z.coerce.number().int().positive().optional(),
  rentPriceTo: z.coerce.number().int().positive().optional(),
  marketState: z.union([z.string(), z.array(z.string())]).optional(),
  area: z.union([z.string(), z.array(z.string())]).optional(),
});

const selfActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

function applyActivityCacheHeader(scope: 'public' | 'following' | 'self', userId: string | null) {
  if (scope === 'public' && userId == null) {
    return 'public, max-age=15, stale-while-revalidate=30';
  }

  return 'private, no-store';
}

export async function activityRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/activity',
    {
      onRequest: [fastify.optionalAuth],
      schema: {
        tags: ['activity'],
        summary: 'Get activity feed',
        description:
          'Returns newest-first ungrouped activity items. `scope=public` is public, while `scope=following` requires authentication and only includes activity from followed users.',
        querystring: activityQuerySchema,
        response: {
          200: publicActivityResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { scope, limit, offset } = request.query;

      if (scope === 'following' && !request.userId) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required',
        });
      }

      reply.header('Cache-Control', applyActivityCacheHeader(scope, request.userId ?? null));

      const feed = await fetchActivityFeed({
        scope,
        viewerId: request.userId ?? null,
        limit,
        offset,
      });

      return {
        ...feed,
        items: feed.items.map((item) => ({
          ...item,
          eventType: item.eventType as (typeof publicActivityEventTypes)[number],
        })),
      };
    }
  );

  app.get(
    '/activity/properties',
    {
      onRequest: [fastify.optionalAuth],
      schema: {
        tags: ['activity'],
        summary: 'Get grouped property activity feed',
        description:
          'Returns newest-first social activity posts grouped by property. `scope=public` is public, while `scope=following` requires authentication and only includes activity from followed users. Shared market, price, area, listed-since, and activity query filters are supported.',
        querystring: groupedActivityQuerySchema,
        response: {
          200: groupedActivityResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { scope, limit, offset } = request.query;

      if (scope === 'following' && !request.userId) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required',
        });
      }

      reply.header('Cache-Control', applyActivityCacheHeader(scope, request.userId ?? null));

      return fetchGroupedPropertyActivityFeed({
        scope,
        viewerId: request.userId ?? null,
        limit,
        offset,
        filters: parsePropertyMarketFiltersQuery(request.query),
      });
    }
  );

  app.get(
    '/users/me/activity',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['activity'],
        summary: 'Get current user activity history',
        description:
          'Returns newest-first ungrouped activity items for the signed-in user. This is the only activity route that includes private save events.',
        querystring: selfActivityQuerySchema,
        response: {
          200: selfActivityResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { limit, offset } = request.query;
      reply.header('Cache-Control', applyActivityCacheHeader('self', request.userId ?? null));
      return fetchActivityFeed({
        scope: 'self',
        viewerId: request.userId!,
        limit,
        offset,
      });
    }
  );

  app.get(
    '/users/:id/activity',
    {
      onRequest: [fastify.optionalAuth],
      schema: {
        tags: ['activity'],
        summary: 'Get public user activity history',
        description:
          'Returns newest-first public activity items for one user. Private save events and hidden comments are excluded.',
        params: z.object({
          id: z.string().uuid(),
        }),
        querystring: selfActivityQuerySchema,
        response: {
          200: publicActivityResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { limit, offset } = request.query;
      const user = await db.query.users.findFirst({
        where: eq(users.id, id),
        columns: { id: true },
      });

      if (!user) {
        return reply.status(404).send({
          error: 'USER_NOT_FOUND',
          message: 'User not found',
        });
      }

      reply.header('Cache-Control', applyActivityCacheHeader('public', request.userId ?? null));

      const feed = await fetchActivityFeed({
        scope: 'public',
        viewerId: request.userId ?? null,
        targetUserId: id,
        limit,
        offset,
      });

      return {
        ...feed,
        items: feed.items.map((item) => ({
          ...item,
          eventType: item.eventType as (typeof publicActivityEventTypes)[number],
        })),
      };
    }
  );
}
