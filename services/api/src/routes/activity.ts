/**
 * Activity routes
 *
 * GET /activity?scope=public|following
 * GET /users/me/activity
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { fetchActivityFeed } from '../services/activity-feed.js';

const publicActivityEventTypes = ['property_like', 'comment', 'price_guess'] as const;
const selfActivityEventTypes = [...publicActivityEventTypes, 'save'] as const;

const actorSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  handle: z.string(),
  profilePhotoUrl: z.string().nullable(),
});

const propertyPayloadSchema = z.object({
  id: z.string().uuid(),
  address: z.string(),
  streetName: z.string(),
  houseNumber: z.number(),
  houseNumberAddition: z.string().nullable(),
  city: z.string(),
  postalCode: z.string(),
  countryCode: z.string(),
  thumbnailUrl: z.string().nullable(),
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

const activityQuerySchema = z.object({
  scope: z.enum(['public', 'following']).default('public'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const selfActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

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
    async (request) => {
      const { limit, offset } = request.query;
      return fetchActivityFeed({
        scope: 'self',
        viewerId: request.userId!,
        limit,
        offset,
      });
    }
  );
}
