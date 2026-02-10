import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db, reactions, properties } from '../db/index.js';
import { eq, and, sql } from 'drizzle-orm';

// Schema definitions
const commentParamsSchema = z.object({
  id: z.string().uuid().describe('Comment ID'),
});

const propertyParamsSchema = z.object({
  id: z.string().uuid().describe('Property ID'),
});

const likeResponseSchema = z.object({
  liked: z.boolean(),
  likeCount: z.number(),
});

const likeCreatedResponseSchema = z.object({
  message: z.string(),
  liked: z.boolean(),
  likeCount: z.number(),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

export async function reactionRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // GET /comments/:id/like - Check if user liked a comment and get like count
  typedApp.get(
    '/comments/:id/like',
    {
      schema: {
        tags: ['reactions'],
        summary: 'Check if comment is liked',
        description: 'Get the like status and count for a comment. Returns liked=false if not authenticated.',
        params: commentParamsSchema,
        response: {
          200: likeResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: commentId } = request.params;
      const userId = request.headers['x-user-id'] as string | undefined;

      // Get like count
      const countResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(reactions)
        .where(
          and(
            eq(reactions.targetType, 'comment'),
            eq(reactions.targetId, commentId),
            eq(reactions.reactionType, 'like')
          )
        );
      const likeCount = countResult[0]?.count ?? 0;

      // Check if user has liked (only if authenticated)
      let liked = false;
      if (userId) {
        const userReaction = await db
          .select({ id: reactions.id })
          .from(reactions)
          .where(
            and(
              eq(reactions.targetType, 'comment'),
              eq(reactions.targetId, commentId),
              eq(reactions.userId, userId),
              eq(reactions.reactionType, 'like')
            )
          )
          .limit(1);
        liked = userReaction.length > 0;
      }

      return reply.send({ liked, likeCount });
    }
  );

  // POST /comments/:id/like - Like a comment
  typedApp.post(
    '/comments/:id/like',
    {
      schema: {
        tags: ['reactions'],
        summary: 'Like a comment',
        description: 'Add a like reaction to a comment. Returns 409 if already liked.',
        params: commentParamsSchema,
        response: {
          201: likeCreatedResponseSchema,
          401: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: commentId } = request.params;
      const userId = request.headers['x-user-id'] as string | undefined;

      if (!userId) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required to like comments.',
        });
      }

      // Check if already liked
      const existingReaction = await db
        .select({ id: reactions.id })
        .from(reactions)
        .where(
          and(
            eq(reactions.targetType, 'comment'),
            eq(reactions.targetId, commentId),
            eq(reactions.userId, userId),
            eq(reactions.reactionType, 'like')
          )
        )
        .limit(1);

      if (existingReaction.length > 0) {
        return reply.status(409).send({
          error: 'ALREADY_LIKED',
          message: 'You have already liked this comment.',
        });
      }

      // Create the like reaction
      await db.insert(reactions).values({
        targetType: 'comment',
        targetId: commentId,
        userId,
        reactionType: 'like',
      });

      // Get updated like count
      const countResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(reactions)
        .where(
          and(
            eq(reactions.targetType, 'comment'),
            eq(reactions.targetId, commentId),
            eq(reactions.reactionType, 'like')
          )
        );
      const likeCount = countResult[0]?.count ?? 0;

      return reply.status(201).send({
        message: 'Comment liked successfully',
        liked: true,
        likeCount,
      });
    }
  );

  // DELETE /comments/:id/like - Unlike a comment
  typedApp.delete(
    '/comments/:id/like',
    {
      schema: {
        tags: ['reactions'],
        summary: 'Unlike a comment',
        description: 'Remove a like reaction from a comment. Returns 404 if not previously liked.',
        params: commentParamsSchema,
        response: {
          200: likeCreatedResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: commentId } = request.params;
      const userId = request.headers['x-user-id'] as string | undefined;

      if (!userId) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required to unlike comments.',
        });
      }

      // Find the existing reaction
      const existingReaction = await db
        .select({ id: reactions.id })
        .from(reactions)
        .where(
          and(
            eq(reactions.targetType, 'comment'),
            eq(reactions.targetId, commentId),
            eq(reactions.userId, userId),
            eq(reactions.reactionType, 'like')
          )
        )
        .limit(1);

      if (existingReaction.length === 0) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'You have not liked this comment.',
        });
      }

      // Delete the reaction
      await db
        .delete(reactions)
        .where(eq(reactions.id, existingReaction[0].id));

      // Get updated like count
      const countResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(reactions)
        .where(
          and(
            eq(reactions.targetType, 'comment'),
            eq(reactions.targetId, commentId),
            eq(reactions.reactionType, 'like')
          )
        );
      const likeCount = countResult[0]?.count ?? 0;

      return reply.send({
        message: 'Comment unliked successfully',
        liked: false,
        likeCount,
      });
    }
  );

  // POST /properties/:id/like - Like a property
  typedApp.post(
    '/properties/:id/like',
    {
      schema: {
        tags: ['reactions'],
        summary: 'Like a property',
        description: 'Add a like reaction to a property. Returns 409 if already liked.',
        params: propertyParamsSchema,
        response: {
          201: likeResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: propertyId } = request.params;
      const userId = request.headers['x-user-id'] as string | undefined;

      if (!userId) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required to like properties.',
        });
      }

      // Verify property exists (no FK constraint on reactions.target_id)
      const propertyExists = await db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .limit(1);

      if (propertyExists.length === 0) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'Property not found.',
        });
      }

      // Check if already liked
      const existingReaction = await db
        .select({ id: reactions.id })
        .from(reactions)
        .where(
          and(
            eq(reactions.targetType, 'property'),
            eq(reactions.targetId, propertyId),
            eq(reactions.userId, userId),
            eq(reactions.reactionType, 'like')
          )
        )
        .limit(1);

      if (existingReaction.length > 0) {
        return reply.status(409).send({
          error: 'ALREADY_LIKED',
          message: 'You have already liked this property.',
        });
      }

      // Atomic INSERT + COUNT using CTE (try-catch for race condition on unique constraint)
      // Note: The main SELECT runs in the same snapshot as the CTE, so it won't see
      // the newly inserted row. We add 1 to account for the inserted row.
      let likeCount: number;
      try {
        const result = await db.execute<{ like_count: number }>(sql`
          WITH inserted AS (
            INSERT INTO reactions (target_type, target_id, user_id, reaction_type)
            VALUES ('property', ${propertyId}, ${userId}, 'like')
            RETURNING id
          )
          SELECT (count(*)::int + (SELECT count(*)::int FROM inserted)) AS like_count
          FROM reactions
          WHERE target_type = 'property' AND target_id = ${propertyId} AND reaction_type = 'like'
        `);
        likeCount = Array.from(result)[0]?.like_count ?? 0;
      } catch (err: unknown) {
        const pgErr = err as { code?: string };
        if (pgErr.code === '23505') {
          return reply.status(409).send({
            error: 'ALREADY_LIKED',
            message: 'You have already liked this property.',
          });
        }
        throw err;
      }

      return reply.status(201).send({
        liked: true,
        likeCount,
      });
    }
  );

  // DELETE /properties/:id/like - Unlike a property
  typedApp.delete(
    '/properties/:id/like',
    {
      schema: {
        tags: ['reactions'],
        summary: 'Unlike a property',
        description: 'Remove a like reaction from a property. Returns 404 if not previously liked.',
        params: propertyParamsSchema,
        response: {
          200: likeResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: propertyId } = request.params;
      const userId = request.headers['x-user-id'] as string | undefined;

      if (!userId) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required to unlike properties.',
        });
      }

      // Atomic DELETE + COUNT using CTE — returns deleted_count and remaining like_count
      // Note: The main SELECT still sees the rows in the same snapshot, so we subtract
      // the deleted count to get the accurate remaining count.
      const result = await db.execute<{ deleted_count: number; like_count: number }>(sql`
        WITH deleted AS (
          DELETE FROM reactions
          WHERE target_type = 'property' AND target_id = ${propertyId} AND user_id = ${userId} AND reaction_type = 'like'
          RETURNING id
        )
        SELECT
          (SELECT count(*)::int FROM deleted) AS deleted_count,
          (count(*)::int - (SELECT count(*)::int FROM deleted)) AS like_count
        FROM reactions
        WHERE target_type = 'property' AND target_id = ${propertyId} AND reaction_type = 'like'
      `);
      const row = Array.from(result)[0];
      const deletedCount = row?.deleted_count ?? 0;
      const likeCount = row?.like_count ?? 0;

      if (deletedCount === 0) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'You have not liked this property.',
        });
      }

      return reply.send({
        liked: false,
        likeCount,
      });
    }
  );
}

// Export types for client usage
export type LikeResponse = z.infer<typeof likeResponseSchema>;
export type LikeCreatedResponse = z.infer<typeof likeCreatedResponseSchema>;
