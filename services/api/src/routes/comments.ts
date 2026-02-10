import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db, comments, properties, users } from '../db/index.js';
import { eq, sql } from 'drizzle-orm';

// Type for comment rows from raw SQL
type CommentRow = {
  id: string;
  property_id: string;
  user_id: string;
  parent_id: string | null;
  content: string;
  created_at: Date;
  updated_at: Date;
  user_username: string;
  user_display_name: string | null;
  user_profile_photo_url: string | null;
  user_karma: number;
  like_count: number;
  comment_score?: number;
  [key: string]: unknown;
};

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

/** Calculate recency bonus for TikTok-style comment sorting */
export function calculateRecencyBonus(createdAt: Date, now: Date = new Date()): number {
  const ageMs = now.getTime() - createdAt.getTime();
  if (ageMs < ONE_HOUR_MS) return 10;
  if (ageMs < ONE_DAY_MS) return 5;
  if (ageMs < SEVEN_DAYS_MS) return 2;
  return 0;
}

/** Calculate hybrid comment score: (likeCount * 2) + recencyBonus */
export function calculateCommentScore(likeCount: number, createdAt: Date, now: Date = new Date()): number {
  return likeCount * 2 + calculateRecencyBonus(createdAt, now);
}

// Schema definitions
const commentUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string().nullable(),
  profilePhotoUrl: z.string().nullable(),
  karma: z.number(),
});

const baseCommentSchema = z.object({
  id: z.string().uuid(),
  propertyId: z.string().uuid(),
  userId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  content: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  user: commentUserSchema,
  likeCount: z.number(),
});

// Comments with replies (1 level deep, like TikTok/YouTube)
const commentWithRepliesSchema = baseCommentSchema.extend({
  replies: z.array(baseCommentSchema),
});

const createCommentSchema = z.object({
  content: z.string().min(1).max(1000).describe('Comment content'),
  parentId: z.string().uuid().optional().describe('Parent comment ID for replies'),
});

const propertyParamsSchema = z.object({
  id: z.string().uuid(),
});

const commentListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  sort: z.enum(['recent', 'popular']).default('recent'),
});

const commentListResponseSchema = z.object({
  data: z.array(commentWithRepliesSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

// Helper to format a comment row
function formatComment(c: CommentRow) {
  return {
    id: c.id,
    propertyId: c.property_id,
    userId: c.user_id,
    parentId: c.parent_id,
    content: c.content,
    createdAt: new Date(c.created_at).toISOString(),
    updatedAt: new Date(c.updated_at).toISOString(),
    user: {
      id: c.user_id,
      username: c.user_username,
      displayName: c.user_display_name,
      profilePhotoUrl: c.user_profile_photo_url,
      karma: c.user_karma,
    },
    likeCount: c.like_count,
  };
}

export async function commentRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // GET /properties/:id/comments - Get comments for a property
  typedApp.get(
    '/properties/:id/comments',
    {
      schema: {
        tags: ['comments'],
        summary: 'Get comments for a property',
        description: 'Get paginated comments for a property with replies (1 level deep). Sorting options: recent (newest first) or popular (most liked first).',
        params: propertyParamsSchema,
        querystring: commentListQuerySchema,
        response: {
          200: commentListResponseSchema,
          404: z.object({
            error: z.string(),
            message: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id: propertyId } = request.params;
      const { page, limit, sort } = request.query;
      const offset = (page - 1) * limit;

      // Check if property exists
      const propertyExists = await db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .limit(1);

      if (propertyExists.length === 0) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Property with ID ${propertyId} not found`,
        });
      }

      // Get total count of top-level comments
      const countResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(comments)
        .where(
          sql`${comments.propertyId} = ${propertyId} AND ${comments.parentId} IS NULL`
        );
      const total = countResult[0]?.count ?? 0;

      // Get top-level comments with user info and like count
      // For 'popular' sort: hybrid score = (like_count * 2) + recency_bonus
      // Recency bonus: <1hr: +10, <24hr: +5, <7days: +2, older: 0
      const topLevelComments = sort === 'popular'
        ? await db.execute<CommentRow>(sql`
            SELECT *, (
              like_count * 2 + CASE
                WHEN created_at > NOW() - INTERVAL '1 hour' THEN 10
                WHEN created_at > NOW() - INTERVAL '24 hours' THEN 5
                WHEN created_at > NOW() - INTERVAL '7 days' THEN 2
                ELSE 0
              END
            ) as comment_score
            FROM (
              SELECT
                c.id,
                c.property_id,
                c.user_id,
                c.parent_id,
                c.content,
                c.created_at,
                c.updated_at,
                u.username as user_username,
                u.display_name as user_display_name,
                u.profile_photo_url as user_profile_photo_url,
                u.karma as user_karma,
                COALESCE(
                  (SELECT COUNT(*) FROM reactions r
                   WHERE r.target_type = 'comment' AND r.target_id = c.id AND r.reaction_type = 'like'),
                  0
                )::int as like_count
              FROM comments c
              INNER JOIN users u ON c.user_id = u.id
              WHERE c.property_id = ${propertyId} AND c.parent_id IS NULL
            ) sub
            ORDER BY comment_score DESC, created_at DESC
            LIMIT ${limit}
            OFFSET ${offset}
          `)
        : await db.execute<CommentRow>(sql`
            SELECT
              c.id,
              c.property_id,
              c.user_id,
              c.parent_id,
              c.content,
              c.created_at,
              c.updated_at,
              u.username as user_username,
              u.display_name as user_display_name,
              u.profile_photo_url as user_profile_photo_url,
              u.karma as user_karma,
              COALESCE(
                (SELECT COUNT(*) FROM reactions r
                 WHERE r.target_type = 'comment' AND r.target_id = c.id AND r.reaction_type = 'like'),
                0
              )::int as like_count
            FROM comments c
            INNER JOIN users u ON c.user_id = u.id
            WHERE c.property_id = ${propertyId} AND c.parent_id IS NULL
            ORDER BY c.created_at DESC
            LIMIT ${limit}
            OFFSET ${offset}
          `);

      // Convert to array for easier manipulation
      const commentsArray = Array.from(topLevelComments) as CommentRow[];
      const commentIds = commentsArray.map((c) => c.id);

      const repliesMap = new Map<string, CommentRow[]>();

      if (commentIds.length > 0) {
        const replies = await db.execute<CommentRow>(sql`
          SELECT
            c.id,
            c.property_id,
            c.user_id,
            c.parent_id,
            c.content,
            c.created_at,
            c.updated_at,
            u.username as user_username,
            u.display_name as user_display_name,
            u.profile_photo_url as user_profile_photo_url,
            u.karma as user_karma,
            COALESCE(
              (SELECT COUNT(*) FROM reactions r
               WHERE r.target_type = 'comment' AND r.target_id = c.id AND r.reaction_type = 'like'),
              0
            )::int as like_count
          FROM comments c
          INNER JOIN users u ON c.user_id = u.id
          WHERE c.parent_id IN (${sql.join(commentIds.map(id => sql`${id}`), sql`, `)})
          ORDER BY c.created_at ASC
        `);

        // Group replies by parent
        for (const reply of replies) {
          if (reply.parent_id) {
            if (!repliesMap.has(reply.parent_id)) {
              repliesMap.set(reply.parent_id, []);
            }
            repliesMap.get(reply.parent_id)!.push(reply);
          }
        }
      }

      const data = commentsArray.map((comment) => ({
        ...formatComment(comment),
        replies: (repliesMap.get(comment.id) ?? []).map(formatComment),
      }));

      return reply.send({
        data,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    }
  );

  // POST /properties/:id/comments - Add a comment
  typedApp.post(
    '/properties/:id/comments',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['comments'],
        summary: 'Add a comment',
        description: 'Add a comment to a property. Set parentId to reply to another comment (1 level deep only).',
        params: propertyParamsSchema,
        body: createCommentSchema,
        response: {
          201: baseCommentSchema.extend({
            message: z.string(),
          }),
          400: z.object({
            error: z.string(),
            message: z.string(),
          }),
          401: z.object({
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
      const { id: propertyId } = request.params;
      const { content, parentId } = request.body;

      const userId = request.userId!;

      // Check if property exists
      const propertyExists = await db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .limit(1);

      if (propertyExists.length === 0) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Property with ID ${propertyId} not found`,
        });
      }

      // If replying, validate parent comment
      if (parentId) {
        const parentComment = await db
          .select()
          .from(comments)
          .where(eq(comments.id, parentId))
          .limit(1);

        if (parentComment.length === 0) {
          return reply.status(404).send({
            error: 'NOT_FOUND',
            message: `Parent comment with ID ${parentId} not found`,
          });
        }

        // Enforce 1-level deep replies (no replies to replies)
        if (parentComment[0].parentId !== null) {
          return reply.status(400).send({
            error: 'INVALID_PARENT',
            message: 'Cannot reply to a reply. Only top-level comments can have replies.',
          });
        }
      }

      // Get user info
      const userResult = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (userResult.length === 0) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'User not found.',
        });
      }

      const user = userResult[0];

      // Create the comment
      const newComment = await db
        .insert(comments)
        .values({
          propertyId,
          userId,
          parentId: parentId ?? null,
          content,
        })
        .returning();

      const created = newComment[0];

      return reply.status(201).send({
        id: created.id,
        propertyId: created.propertyId,
        userId: created.userId,
        parentId: created.parentId,
        content: created.content,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          profilePhotoUrl: user.profilePhotoUrl,
          karma: user.karma,
        },
        likeCount: 0,
        message: 'Comment added successfully',
      });
    }
  );
}

// Export types for client usage
export type CommentResponse = z.infer<typeof baseCommentSchema>;
export type CommentWithRepliesResponse = z.infer<typeof commentWithRepliesSchema>;
export type CommentListResponse = z.infer<typeof commentListResponseSchema>;
export type CreateCommentRequest = z.infer<typeof createCommentSchema>;
