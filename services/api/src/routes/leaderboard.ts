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

const coordinateSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number(), z.number()]).describe('[longitude, latitude]'),
});

const imageryCoordinateSchema = coordinateSchema.describe(
  'Geometry used for imagery framing. May snap to a nearby building surface point.',
);

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

const featuredPropertySchema = z.object({
  id: z.string().uuid(),
  address: z.string(),
  city: z.string(),
  postalCode: z.string().nullable(),
  countryCode: z.string(),
  geometry: coordinateSchema.nullable(),
  imageryGeometry: imageryCoordinateSchema.nullable().optional(),
  officialValuation: z.number().nullable(),
  thumbnailUrl: z.string().nullable(),
  commentCount: z.number(),
  likeCount: z.number(),
  engagementScore: z.number(),
}).nullable();

const leaderboardResponseSchema = z.object({
  rankings: z.array(leaderboardEntrySchema),
  currentUserRank: leaderboardEntrySchema.nullable(),
  featuredProperty: featuredPropertySchema,
  period: z.enum(['week', 'month', 'all']),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

const IMAGERY_BUILDING_SEARCH_DEGREES = 0.001;
const IMAGERY_BUILDING_MAX_DISTANCE_METERS = 80;

const featuredImageryJoin = sql`LEFT JOIN LATERAL (
  SELECT
    ST_PointOnSurface(geometry) AS imagery_geom,
    ST_Distance(p.geometry::geography, geometry::geography) AS distance_to_building_m
  FROM osm_buildings
  WHERE p.geometry IS NOT NULL
    AND geometry && ST_Expand(p.geometry, ${IMAGERY_BUILDING_SEARCH_DEGREES})
  ORDER BY p.geometry <-> geometry
  LIMIT 1
) img ON true`;

const featuredImageryLonSelect = sql`CASE
  WHEN p.geometry IS NULL THEN NULL
  WHEN p.country_code = 'NL'
    AND img.imagery_geom IS NOT NULL
    AND img.distance_to_building_m <= ${IMAGERY_BUILDING_MAX_DISTANCE_METERS}
    THEN ST_X(img.imagery_geom)
  ELSE ST_X(p.geometry)
END`;

const featuredImageryLatSelect = sql`CASE
  WHEN p.geometry IS NULL THEN NULL
  WHEN p.country_code = 'NL'
    AND img.imagery_geom IS NOT NULL
    AND img.distance_to_building_m <= ${IMAGERY_BUILDING_MAX_DISTANCE_METERS}
    THEN ST_Y(img.imagery_geom)
  ELSE ST_Y(p.geometry)
END`;

const featuredThumbnailJoin = sql`LEFT JOIN LATERAL (
  SELECT thumbnail_url
  FROM listings
  WHERE property_id = p.id
    AND status = 'active'
    AND thumbnail_url IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1
) lt ON true`;

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
      let propertyViewTimeCondition = sql``;
      if (period === 'week') {
        timeCondition = sql`AND sub.created_at > NOW() - INTERVAL '7 days'`;
        propertyViewTimeCondition = sql`AND sub.viewed_at > NOW() - INTERVAL '7 days'`;
      } else if (period === 'month') {
        timeCondition = sql`AND sub.created_at > NOW() - INTERVAL '30 days'`;
        propertyViewTimeCondition = sql`AND sub.viewed_at > NOW() - INTERVAL '30 days'`;
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

      const featuredQuery = sql`
        WITH featured_events AS (
          SELECT
            sub.property_id,
            COUNT(*)::int AS comment_count,
            0::int AS like_count,
            0::int AS guess_count,
            0::int AS view_count,
            MAX(sub.created_at) AS last_at
          FROM comments sub
          WHERE 1=1 ${timeCondition}
          GROUP BY sub.property_id

          UNION ALL

          SELECT
            sub.target_id AS property_id,
            0::int AS comment_count,
            COUNT(*)::int AS like_count,
            0::int AS guess_count,
            0::int AS view_count,
            MAX(sub.created_at) AS last_at
          FROM reactions sub
          WHERE sub.target_type = 'property'
            AND sub.reaction_type = 'like'
            ${timeCondition}
          GROUP BY sub.target_id

          UNION ALL

          SELECT
            sub.property_id,
            0::int AS comment_count,
            0::int AS like_count,
            COUNT(*)::int AS guess_count,
            0::int AS view_count,
            MAX(sub.created_at) AS last_at
          FROM price_guesses sub
          WHERE sub.is_meme_guess = false
            ${timeCondition}
          GROUP BY sub.property_id

          UNION ALL

          SELECT
            sub.property_id,
            0::int AS comment_count,
            0::int AS like_count,
            0::int AS guess_count,
            COUNT(*)::int AS view_count,
            MAX(sub.viewed_at) AS last_at
          FROM property_views sub
          WHERE 1=1 ${propertyViewTimeCondition}
          GROUP BY sub.property_id
        ),
        featured_scores AS (
          SELECT
            property_id,
            SUM(comment_count)::int AS comment_count,
            SUM(like_count)::int AS like_count,
            SUM(guess_count)::int AS guess_count,
            SUM(view_count)::int AS view_count,
            MAX(last_at) AS latest_activity_at
          FROM featured_events
          GROUP BY property_id
        )
        SELECT
          p.id,
          p.street || ' ' || p.house_number ||
            CASE
              WHEN p.house_number_addition IS NULL OR p.house_number_addition = '' THEN ''
              WHEN LENGTH(p.house_number_addition) = 1 AND p.house_number_addition ~ '^[A-Z]$' THEN p.house_number_addition
              ELSE '-' || p.house_number_addition
            END AS address,
          p.city,
          p.postal_code,
          p.country_code,
          ST_X(p.geometry) AS lon,
          ST_Y(p.geometry) AS lat,
          ${featuredImageryLonSelect} AS imagery_lon,
          ${featuredImageryLatSelect} AS imagery_lat,
          p.official_valuation,
          lt.thumbnail_url,
          fs.comment_count,
          fs.like_count,
          (
            (fs.comment_count * 5)
            + (fs.guess_count * 4)
            + (fs.like_count * 2)
            + (LEAST(fs.view_count, 40) * 0.25)
            + CASE
                WHEN fs.latest_activity_at IS NULL THEN 0
                ELSE GREATEST(
                  0,
                  14 - (EXTRACT(EPOCH FROM (NOW() - fs.latest_activity_at)) / 86400.0)
                )
              END
        )::float8 AS engagement_score
        FROM featured_scores fs
        JOIN properties p ON p.id = fs.property_id
        ${featuredThumbnailJoin}
        ${featuredImageryJoin}
        ORDER BY engagement_score DESC, fs.latest_activity_at DESC
        LIMIT 1
      `;

      const featuredRows = await db.execute<{
        id: string;
        address: string;
        city: string;
        postal_code: string | null;
        country_code: string;
        lon: number | null;
        lat: number | null;
        imagery_lon: number | null;
        imagery_lat: number | null;
        official_valuation: number | null;
        thumbnail_url: string | null;
        comment_count: number;
        like_count: number;
        engagement_score: number;
      }>(featuredQuery);

      const featuredRow = Array.from(featuredRows)[0];
      const featuredProperty = featuredRow
        ? {
            id: featuredRow.id,
            address: featuredRow.address,
            city: featuredRow.city,
            postalCode: featuredRow.postal_code,
            countryCode: featuredRow.country_code,
            geometry:
              featuredRow.lon != null && featuredRow.lat != null
                ? {
                    type: 'Point' as const,
                    coordinates: [featuredRow.lon, featuredRow.lat] as [number, number],
                  }
                : null,
            imageryGeometry:
              featuredRow.imagery_lon != null && featuredRow.imagery_lat != null
                ? {
                    type: 'Point' as const,
                    coordinates: [featuredRow.imagery_lon, featuredRow.imagery_lat] as [number, number],
                  }
                : null,
            officialValuation: featuredRow.official_valuation != null
              ? Number(featuredRow.official_valuation)
              : null,
            thumbnailUrl: featuredRow.thumbnail_url,
            commentCount: Number(featuredRow.comment_count),
            likeCount: Number(featuredRow.like_count),
            engagementScore: Number(featuredRow.engagement_score),
          }
        : null;

      return {
        rankings,
        currentUserRank,
        featuredProperty,
        period,
      };
    }
  );
}
