/**
 * Achievement routes
 *
 * Merges the shared registry with per-user unlock state.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import {
  ACHIEVEMENT_REGISTRY,
  getUserAchievements,
  evaluateAchievements,
} from '../services/achievements.js';

// --- Schemas ---

const achievementDefSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  category: z.enum(['social', 'guessing', 'exploration', 'milestone']),
});

const earnedAchievementSchema = achievementDefSchema.extend({
  awardedAt: z.string().datetime(),
});

const achievementsResponseSchema = z.object({
  earned: z.array(earnedAchievementSchema),
  available: z.array(achievementDefSchema),
  totalAvailable: z.number(),
});

const publicAchievementsResponseSchema = z.object({
  earned: z.array(earnedAchievementSchema),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

// --- Routes ---

export async function achievementRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /achievements — list all achievements with user unlock state
   */
  app.get(
    '/achievements',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['achievements'],
        summary: 'Get all achievements with unlock state',
        description: 'Returns earned and available achievements for the current user.',
        response: {
          200: achievementsResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const userId = request.userId!;

      // Re-evaluate achievements (catches any newly earned ones)
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { karma: true },
      });

      if (user) {
        await evaluateAchievements(userId, user.karma);
      }

      const { earned, available } = await getUserAchievements(userId);

      return {
        earned,
        available,
        totalAvailable: ACHIEVEMENT_REGISTRY.length,
      };
    }
  );

  /**
   * GET /achievements/registry — list all achievement definitions (public)
   */
  app.get(
    '/achievements/registry',
    {
      schema: {
        tags: ['achievements'],
        summary: 'Get achievement registry',
        description: 'Returns all available achievement definitions without user state.',
        response: {
          200: z.object({
            achievements: z.array(achievementDefSchema),
          }),
        },
      },
    },
    async () => {
      return {
        achievements: ACHIEVEMENT_REGISTRY.map((a) => ({
          key: a.key,
          name: a.name,
          description: a.description,
          icon: a.icon,
          category: a.category,
        })),
      };
    }
  );

  app.get(
    '/users/:id/achievements',
    {
      schema: {
        tags: ['achievements'],
        summary: 'Get public user achievements',
        description: 'Returns earned achievements for a public user profile.',
        params: z.object({
          id: z.string().uuid(),
        }),
        response: {
          200: publicAchievementsResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
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

      const { earned } = await getUserAchievements(id);
      return { earned };
    }
  );
}
