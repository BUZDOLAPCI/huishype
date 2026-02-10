import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db, properties, propertyViews } from '../db/index.js';
import { sql, eq, and } from 'drizzle-orm';

// Schema definitions
const propertyParamsSchema = z.object({
  id: z.string().uuid().describe('Property ID'),
});

const viewResponseSchema = z.object({
  viewCount: z.number(),
  uniqueViewers: z.number(),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

/**
 * Calculate activity level based on views, comments, and guesses.
 *
 * - hot: >50 views in 7 days OR >10 comments OR >5 guesses
 * - warm: >10 views in 7 days OR >3 comments OR >1 guess
 * - cold: everything else
 */
export function calculateActivityLevel(
  recentViews: number,
  commentCount: number,
  guessCount: number
): 'hot' | 'warm' | 'cold' {
  if (recentViews > 50 || commentCount > 10 || guessCount > 5) {
    return 'hot';
  }
  if (recentViews > 10 || commentCount > 3 || guessCount > 1) {
    return 'warm';
  }
  return 'cold';
}

/**
 * Compute activity level from trending score and last activity date.
 * Used by the feed endpoint.
 */
export function computeActivityLevel(
  trendingScore: number,
  lastActivityAt: Date
): 'hot' | 'warm' | 'cold' {
  if (trendingScore >= 5) return 'hot';
  if (trendingScore > 0) return 'warm';
  const daysSince =
    (Date.now() - lastActivityAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince <= 30) return 'warm';
  return 'cold';
}

export async function viewRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // POST /properties/:id/view - Record a view
  typedApp.post(
    '/properties/:id/view',
    {
      onRequest: [app.optionalAuth],
      schema: {
        tags: ['views'],
        summary: 'Record a property view',
        description:
          'Record a view for a property. Authenticated or anonymous. ' +
          'Deduplicates: same user/session only counts once per hour.',
        params: propertyParamsSchema,
        response: {
          200: viewResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: propertyId } = request.params;
      const userId = request.userId;
      const sessionId = (request.headers['x-session-id'] as string | undefined) || null;

      // Verify property exists
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

      // Dedup: check if same user/session viewed within the last hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      let alreadyViewed = false;

      if (userId) {
        // Authenticated user dedup
        const existing = await db.execute<{ cnt: number }>(sql`
          SELECT COUNT(*)::int AS cnt FROM property_views
          WHERE property_id = ${propertyId}
            AND user_id = ${userId}
            AND viewed_at > ${oneHourAgo}::timestamptz
        `);
        alreadyViewed = (Array.from(existing)[0]?.cnt ?? 0) > 0;
      } else if (sessionId) {
        // Anonymous session dedup
        const existing = await db.execute<{ cnt: number }>(sql`
          SELECT COUNT(*)::int AS cnt FROM property_views
          WHERE property_id = ${propertyId}
            AND session_id = ${sessionId}
            AND viewed_at > ${oneHourAgo}::timestamptz
        `);
        alreadyViewed = (Array.from(existing)[0]?.cnt ?? 0) > 0;
      }

      // Only insert if not deduped
      if (!alreadyViewed) {
        await db.insert(propertyViews).values({
          propertyId,
          userId: userId || null,
          sessionId,
        });
      }

      // Get current counts
      const counts = await db.execute<{ view_count: number; unique_viewers: number }>(sql`
        SELECT
          COUNT(*)::int AS view_count,
          COUNT(DISTINCT COALESCE(user_id::text, session_id, id::text))::int AS unique_viewers
        FROM property_views
        WHERE property_id = ${propertyId}
      `);

      const row = Array.from(counts)[0];
      return reply.send({
        viewCount: row?.view_count ?? 0,
        uniqueViewers: row?.unique_viewers ?? 0,
      });
    }
  );
}

// Export types for client usage
export type ViewResponse = z.infer<typeof viewResponseSchema>;
