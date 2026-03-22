/**
 * Notification routes
 *
 * Display copy is derived from event_type + payload at the client layer.
 * The API returns structured notification data, not pre-rendered text.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  getNotifications,
  getUnreadCount,
  markAllRead,
  markOneRead,
  registerPushToken,
} from '../services/notifications.js';

// --- Schemas ---

const notificationItemSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string(),
  propertyId: z.string().uuid().nullable(),
  commentId: z.string().uuid().nullable(),
  guessId: z.string().uuid().nullable(),
  reactionId: z.string().uuid().nullable(),
  payload: z.record(z.string(), z.any()),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  actor: z
    .object({
      id: z.string().uuid(),
      displayName: z.string(),
      profilePhotoUrl: z.string().nullable(),
    })
    .nullable(),
});

const notificationsResponseSchema = z.object({
  items: z.array(notificationItemSchema),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean(),
  }),
});

const unreadCountResponseSchema = z.object({
  count: z.number(),
});

const readAllResponseSchema = z.object({
  markedCount: z.number(),
});

const readOneResponseSchema = z.object({
  success: z.boolean(),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

const registerPushTokenSchema = z.object({
  token: z.string().min(1),
  deviceId: z.string().min(1),
  platform: z.enum(['ios', 'android', 'web']),
});

// --- Routes ---

export async function notificationRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /notifications — paginated notification list
   */
  app.get(
    '/notifications',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['notifications'],
        summary: 'Get notifications for the current user',
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(50).default(20),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        response: {
          200: notificationsResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const userId = request.userId!;
      const { limit, offset } = request.query;

      const { items, total } = await getNotifications(userId, limit, offset);

      return {
        items: items.map((n) => ({
          id: n.id,
          eventType: n.eventType,
          propertyId: n.propertyId,
          commentId: n.commentId,
          guessId: n.guessId,
          reactionId: n.reactionId,
          payload: n.payload ?? {},
          readAt: n.readAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
          actor: n.actor,
        })),
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      };
    }
  );

  /**
   * GET /notifications/unread-count
   */
  app.get(
    '/notifications/unread-count',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['notifications'],
        summary: 'Get unread notification count',
        response: {
          200: unreadCountResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const userId = request.userId!;
      const count = await getUnreadCount(userId);
      return { count };
    }
  );

  /**
   * PUT /notifications/read-all
   */
  app.put(
    '/notifications/read-all',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['notifications'],
        summary: 'Mark all notifications as read',
        response: {
          200: readAllResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const userId = request.userId!;
      const markedCount = await markAllRead(userId);
      return { markedCount };
    }
  );

  /**
   * PUT /notifications/:id/read
   */
  app.put(
    '/notifications/:id/read',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['notifications'],
        summary: 'Mark a single notification as read',
        params: z.object({
          id: z.string().uuid(),
        }),
        response: {
          200: readOneResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId!;
      const { id } = request.params;

      const success = await markOneRead(id, userId);
      if (!success) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'Notification not found or already read',
        });
      }

      return { success: true };
    }
  );

  /**
   * POST /push-tokens — register a device push token
   */
  app.post(
    '/push-tokens',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['notifications'],
        summary: 'Register a push notification token for a device',
        body: registerPushTokenSchema,
        response: {
          200: z.object({ success: z.boolean() }),
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const userId = request.userId!;
      const { token, deviceId, platform } = request.body;

      await registerPushToken(userId, token, deviceId, platform);
      return { success: true };
    }
  );
}
