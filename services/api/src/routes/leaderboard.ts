/**
 * Leaderboard route
 *
 * Rankings based on karma (all-time) or recent activity (week/month).
 * Includes current user's rank if authenticated.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { getKarmaRank } from '../services/karma.js';

// --- Schemas ---

const leaderboardEntrySchema = z.object({
  rank: z.number(),
  userId: z.string().uuid(),
  displayName: z.string(),
  handle: z.string(),
  profilePhotoUrl: z.string().nullable(),
  karma: z.number(),
  karmaRank: z.object({
    title: z.string(),
    level: z.number(),
  }),
  guessCount: z.number(),
  commentCount: z.number(),
  likeCount: z.number(),
});

const leaderboardResponseSchema = z.object({
  rankings: z.array(leaderboardEntrySchema),
  currentUserRank: leaderboardEntrySchema.nullable(),
  featuredProperty: z.record(z.string(), z.any()).nullable(),
  period: z.enum(['week', 'month', 'all']),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

// --- Route ---

export async function leaderboardRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/leaderboard',
    {
      onRequest: [fastify.optionalAuth],
      schema: {
        tags: ['leaderboard'],
        summary: 'Get leaderboard rankings',
        description:
          'Rankings by karma (all-time) or by recent engagement activity (week/month). ' +
          'If authenticated, includes the current user\'s rank.',
        querystring: z.object({
          period: z.enum(['week', 'month', 'all']).default('all'),
          limit: z.coerce.number().int().min(1).max(50).default(50),
        }),
        response: {
          200: leaderboardResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { period, limit } = request.query;
      const userId = request.userId;

      // Time window for week/month filters
      let timeCondition = sql``;
      if (period === 'week') {
        timeCondition = sql`AND sub.created_at > NOW() - INTERVAL '7 days'`;
      } else if (period === 'month') {
        timeCondition = sql`AND sub.created_at > NOW() - INTERVAL '30 days'`;
      }

      // For 'all' period, rank by karma directly. For week/month, rank by recent activity score.
      let rankQuery: ReturnType<typeof sql>;

      if (period === 'all') {
        rankQuery = sql`
          SELECT
            u.id AS user_id,
            COALESCE(u.display_name, u.username) AS display_name,
            u.username AS handle,
            u.profile_photo_url,
            u.karma,
            COALESCE(g.cnt, 0)::int AS guess_count,
            COALESCE(c.cnt, 0)::int AS comment_count,
            COALESCE(r.cnt, 0)::int AS like_count,
            ROW_NUMBER() OVER (ORDER BY u.karma DESC, u.created_at ASC) AS rank
          FROM users u
          LEFT JOIN (
            SELECT user_id, COUNT(*)::int AS cnt FROM price_guesses GROUP BY user_id
          ) g ON g.user_id = u.id
          LEFT JOIN (
            SELECT user_id, COUNT(*)::int AS cnt FROM comments GROUP BY user_id
          ) c ON c.user_id = u.id
          LEFT JOIN (
            SELECT user_id, COUNT(*)::int AS cnt FROM reactions
            WHERE reaction_type = 'like' GROUP BY user_id
          ) r ON r.user_id = u.id
          ORDER BY u.karma DESC, u.created_at ASC
          LIMIT ${limit}
        `;
      } else {
        // Week or month: rank by combined recent activity
        rankQuery = sql`
          WITH activity AS (
            SELECT user_id, created_at FROM price_guesses
            UNION ALL
            SELECT user_id, created_at FROM comments
            UNION ALL
            SELECT user_id, created_at FROM reactions WHERE reaction_type = 'like'
          ),
          scored AS (
            SELECT
              u.id AS user_id,
              COALESCE(u.display_name, u.username) AS display_name,
              u.username AS handle,
              u.profile_photo_url,
              u.karma,
              COALESCE(g.cnt, 0)::int AS guess_count,
              COALESCE(c.cnt, 0)::int AS comment_count,
              COALESCE(r.cnt, 0)::int AS like_count,
              COALESCE(a.score, 0)::int AS activity_score
            FROM users u
            LEFT JOIN (
              SELECT sub.user_id, COUNT(*)::int AS cnt
              FROM price_guesses sub
              WHERE 1=1 ${timeCondition}
              GROUP BY sub.user_id
            ) g ON g.user_id = u.id
            LEFT JOIN (
              SELECT sub.user_id, COUNT(*)::int AS cnt
              FROM comments sub
              WHERE 1=1 ${timeCondition}
              GROUP BY sub.user_id
            ) c ON c.user_id = u.id
            LEFT JOIN (
              SELECT sub.user_id, COUNT(*)::int AS cnt
              FROM reactions sub
              WHERE sub.reaction_type = 'like'
                ${timeCondition}
              GROUP BY sub.user_id
            ) r ON r.user_id = u.id
            LEFT JOIN (
              SELECT user_id,
                (COUNT(*) FILTER (WHERE 1=1 ${timeCondition}))::int AS score
              FROM activity sub
              GROUP BY user_id
            ) a ON a.user_id = u.id
            WHERE COALESCE(a.score, 0) > 0
          )
          SELECT
            *,
            ROW_NUMBER() OVER (ORDER BY activity_score DESC, karma DESC) AS rank
          FROM scored
          ORDER BY activity_score DESC, karma DESC
          LIMIT ${limit}
        `;
      }

      const rows = await db.execute<{
        user_id: string;
        display_name: string;
        handle: string;
        profile_photo_url: string | null;
        karma: number;
        guess_count: number;
        comment_count: number;
        like_count: number;
        rank: number;
      }>(rankQuery);

      const rankings = Array.from(rows).map((r) => ({
        rank: Number(r.rank),
        userId: r.user_id,
        displayName: r.display_name,
        handle: r.handle,
        profilePhotoUrl: r.profile_photo_url,
        karma: Math.max(0, Number(r.karma)),
        karmaRank: getKarmaRank(Number(r.karma)),
        guessCount: Number(r.guess_count),
        commentCount: Number(r.comment_count),
        likeCount: Number(r.like_count),
      }));

      // Find current user's rank if authenticated
      let currentUserRank = null;
      if (userId) {
        currentUserRank = rankings.find((r) => r.userId === userId) ?? null;

        // If user not in top N, query their rank separately
        if (!currentUserRank) {
          let userRankQuery: ReturnType<typeof sql>;

          if (period === 'all') {
            userRankQuery = sql`
              SELECT rank, user_id, display_name, handle, profile_photo_url,
                     karma, guess_count, comment_count, like_count
              FROM (
                SELECT
                  u.id AS user_id,
                  COALESCE(u.display_name, u.username) AS display_name,
                  u.username AS handle,
                  u.profile_photo_url,
                  u.karma,
                  COALESCE(g.cnt, 0)::int AS guess_count,
                  COALESCE(c.cnt, 0)::int AS comment_count,
                  COALESCE(r.cnt, 0)::int AS like_count,
                  ROW_NUMBER() OVER (ORDER BY u.karma DESC, u.created_at ASC) AS rank
                FROM users u
                LEFT JOIN (
                  SELECT user_id, COUNT(*)::int AS cnt FROM price_guesses GROUP BY user_id
                ) g ON g.user_id = u.id
                LEFT JOIN (
                  SELECT user_id, COUNT(*)::int AS cnt FROM comments GROUP BY user_id
                ) c ON c.user_id = u.id
                LEFT JOIN (
                  SELECT user_id, COUNT(*)::int AS cnt FROM reactions
                  WHERE reaction_type = 'like' GROUP BY user_id
                ) r ON r.user_id = u.id
              ) ranked
              WHERE user_id = ${userId}
            `;
          } else {
            userRankQuery = sql`
              WITH activity AS (
                SELECT user_id, created_at FROM price_guesses
                UNION ALL
                SELECT user_id, created_at FROM comments
                UNION ALL
                SELECT user_id, created_at FROM reactions WHERE reaction_type = 'like'
              ),
              scored AS (
                SELECT
                  u.id AS user_id,
                  COALESCE(u.display_name, u.username) AS display_name,
                  u.username AS handle,
                  u.profile_photo_url,
                  u.karma,
                  COALESCE(g.cnt, 0)::int AS guess_count,
                  COALESCE(c.cnt, 0)::int AS comment_count,
                  COALESCE(r.cnt, 0)::int AS like_count,
                  COALESCE(a.score, 0)::int AS activity_score
                FROM users u
                LEFT JOIN (
                  SELECT sub.user_id, COUNT(*)::int AS cnt
                  FROM price_guesses sub
                  WHERE 1=1 ${timeCondition}
                  GROUP BY sub.user_id
                ) g ON g.user_id = u.id
                LEFT JOIN (
                  SELECT sub.user_id, COUNT(*)::int AS cnt
                  FROM comments sub
                  WHERE 1=1 ${timeCondition}
                  GROUP BY sub.user_id
                ) c ON c.user_id = u.id
                LEFT JOIN (
                  SELECT sub.user_id, COUNT(*)::int AS cnt
                  FROM reactions sub
                  WHERE sub.reaction_type = 'like'
                    ${timeCondition}
                  GROUP BY sub.user_id
                ) r ON r.user_id = u.id
                LEFT JOIN (
                  SELECT user_id,
                    (COUNT(*) FILTER (WHERE 1=1 ${timeCondition}))::int AS score
                  FROM activity sub
                  GROUP BY user_id
                ) a ON a.user_id = u.id
              ),
              ranked AS (
                SELECT
                  *,
                  ROW_NUMBER() OVER (ORDER BY activity_score DESC, karma DESC) AS rank
                FROM scored
              )
              SELECT rank, user_id, display_name, handle, profile_photo_url,
                     karma, guess_count, comment_count, like_count
              FROM ranked
              WHERE user_id = ${userId}
            `;
          }

          const userRows = await db.execute<{
            user_id: string;
            display_name: string;
            handle: string;
            profile_photo_url: string | null;
            karma: number;
            guess_count: number;
            comment_count: number;
            like_count: number;
            rank: number;
          }>(userRankQuery);

          const userRow = Array.from(userRows)[0];
          if (userRow) {
            currentUserRank = {
              rank: Number(userRow.rank),
              userId: userRow.user_id,
              displayName: userRow.display_name,
              handle: userRow.handle,
              profilePhotoUrl: userRow.profile_photo_url,
              karma: Math.max(0, Number(userRow.karma)),
              karmaRank: getKarmaRank(Number(userRow.karma)),
              guessCount: Number(userRow.guess_count),
              commentCount: Number(userRow.comment_count),
              likeCount: Number(userRow.like_count),
            };
          }
        }
      }

      return {
        rankings,
        currentUserRank,
        featuredProperty: null, // Scorer not implemented in this workstream
        period,
      };
    }
  );
}
