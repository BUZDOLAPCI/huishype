import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db, reactions } from '../db/index.js';
import { eq, and, sql } from 'drizzle-orm';

// Schema definitions
const commentParamsSchema = z.object({
  id: z.string().uuid().describe('Comment ID'),
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
        description: 'Add a like reaction to a comment. Returns 400 if already liked.',
        params: commentParamsSchema,
        response: {
          201: likeCreatedResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
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
        return reply.status(400).send({
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
}

// Export types for client usage
export type LikeResponse = z.infer<typeof likeResponseSchema>;
export type LikeCreatedResponse = z.infer<typeof likeCreatedResponseSchema>;
