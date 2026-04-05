import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { computeActivityLevel } from './views.js';
import { formatDisplayAddress } from '../utils/address.js';
import { feedQuerySchema, isValidCountryCode, type FeedQuery } from '@huishype/shared';

// --- Zod schemas ---

const feedItemSchema = z.object({
  id: z.string().uuid(),
  address: z.string(),
  city: z.string(),
  zipCode: z.string(),
  askingPrice: z.number().nullable(),
  fmv: z.number().nullable(),
  officialValuation: z.number().nullable(),
  thumbnailUrl: z.string().nullable(),
  likeCount: z.number(),
  commentCount: z.number(),
  guessCount: z.number(),
  viewCount: z.number(),
  activityLevel: z.enum(['hot', 'warm', 'cold']),
  lastActivityAt: z.string().datetime(),
  hasListing: z.boolean(),
});

const feedResponseSchema = z.object({
  items: z.array(feedItemSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    hasMore: z.boolean(),
  }),
});

// --- SQL row type ---

interface FeedRow extends Record<string, unknown> {
  id: string;
  country_code: string;
  street: string;
  house_number: number;
  house_number_addition: string | null;
  city: string;
  zip_code: string;
  asking_price: number | null;
  official_valuation: number | null;
  thumbnail_url: string | null;
  comment_count: number;
  guess_count: number;
  like_count: number;
  view_count: number;
  fmv: number | null;
  guess_stddev: number | null;
  trending_score: number;
  last_activity_at: string;
}

// --- Route ---

export async function feedRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get<{ Querystring: FeedQuery }>(
    '/feed',
    {
      schema: {
        tags: ['feed'],
        summary: 'Get property feed',
        description:
          'Get a paginated feed of properties with active listings. ' +
          'Filters: trending (weighted 7-day activity) and latest (most recent activity).',
        querystring: feedQuerySchema,
        response: {
          200: feedResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { filter, page, limit, lat, lon, country } = request.query;
      const offset = (page - 1) * limit;

      // --- Build dynamic query parts ---

      // Spatial condition (near-me filtering, 25 km radius)
      const spatialCondition =
        lat !== undefined && lon !== undefined
          ? sql`AND ST_DWithin(p.geometry::geography, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, 25000)`
          : sql``;

      // Country filter condition
      const countryCondition = country
        ? sql`AND p.country_code = ${country}`
        : sql``;

      // Filter-specific WHERE for the data query (can reference join aliases)
      let dataFilterWhere: ReturnType<typeof sql>;
      // Filter-specific ORDER BY
      let orderBy: ReturnType<typeof sql>;

      switch (filter) {
        case 'trending':
          dataFilterWhere = sql``;
          orderBy = sql`ORDER BY trending_score DESC, last_activity_at DESC, p.id`;
          break;
        case 'latest':
          dataFilterWhere = sql``;
          orderBy = sql`ORDER BY last_activity_at DESC, p.id`;
          break;
        default:
          dataFilterWhere = sql``;
          orderBy = sql`ORDER BY trending_score DESC, last_activity_at DESC, p.id`;
      }

      // --- Data query ---
      // Reads from mv_latest_active_listings — a materialized view that
      // pre-computes the latest active listing per property.  Avoids a
      // full DISTINCT ON scan of the listings table on every request.
      // The view is refreshed after listing mutations (insert/update/status change).
      //
      // Social data uses pre-aggregated GROUP BY subqueries.
      // With current small social tables (<10K rows), full-table GROUP BY + hash join
      // is cheaper than thousands of per-property LATERAL index seeks.
      // FILTER(WHERE ...) combines all-time and 7-day counts in a single pass.
      const rows = await db.execute<FeedRow>(sql`
        SELECT
          p.id,
          p.country_code,
          p.street,
          p.house_number,
          p.house_number_addition,
          p.city,
          p.postal_code AS zip_code,
          l.asking_price,
          p.official_valuation,
          l.thumbnail_url,
          COALESCE(c.cnt, 0)::int AS comment_count,
          COALESCE(g.cnt, 0)::int AS guess_count,
          COALESCE(r.cnt, 0)::int AS like_count,
          COALESCE(v.cnt, 0)::int AS view_count,
          g.fmv,
          g.stddev AS guess_stddev,
          (
            COALESCE(c.cnt_7d, 0)::numeric * 1.0
            + COALESCE(g.cnt_7d, 0)::numeric * 2.0
            + COALESCE(r.cnt_7d, 0)::numeric * 0.5
          ) AS trending_score,
          COALESCE(
            GREATEST(c.latest, g.latest, r.latest),
            l.listed_at
          ) AS last_activity_at
        FROM mv_latest_active_listings l
        INNER JOIN properties p ON p.id = l.property_id
          AND p.status = 'active'
          AND p.geometry IS NOT NULL
        LEFT JOIN (
          SELECT property_id, COUNT(*) AS cnt, MAX(created_at) AS latest,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS cnt_7d
          FROM comments GROUP BY property_id
        ) c ON c.property_id = p.id
        LEFT JOIN (
          SELECT property_id, COUNT(*) AS cnt, MAX(created_at) AS latest,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS cnt_7d,
            CASE WHEN COUNT(*) >= 3 THEN ROUND(AVG(guessed_price))::bigint END AS fmv,
            STDDEV(guessed_price) AS stddev
          FROM price_guesses GROUP BY property_id
        ) g ON g.property_id = p.id
        LEFT JOIN (
          SELECT target_id AS property_id, COUNT(*) AS cnt, MAX(created_at) AS latest,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS cnt_7d
          FROM reactions WHERE target_type = 'property' AND reaction_type = 'like'
          GROUP BY target_id
        ) r ON r.property_id = p.id
        LEFT JOIN (
          SELECT property_id, COUNT(*) AS cnt
          FROM property_views GROUP BY property_id
        ) v ON v.property_id = p.id
        WHERE 1=1
          ${spatialCondition}
          ${countryCondition}
          ${dataFilterWhere}
        ${orderBy}
        LIMIT ${limit + 1}
        OFFSET ${offset}
      `);

      const allRows = Array.from(rows);
      const hasMore = allRows.length > limit;
      const pageRows = hasMore ? allRows.slice(0, limit) : allRows;

      // --- Transform to response ---
      const items = pageRows.map((r) => ({
        id: r.id,
        address: formatDisplayAddress(
          {
            street: r.street,
            houseNumber: r.house_number,
            houseNumberAddition: r.house_number_addition,
            postalCode: r.zip_code ?? '',
            city: r.city,
          },
          isValidCountryCode(r.country_code) ? r.country_code : undefined,
        ),
        city: r.city,
        zipCode: r.zip_code,
        askingPrice: r.asking_price != null ? Number(r.asking_price) : null,
        fmv: r.fmv != null ? Number(r.fmv) : null,
        officialValuation: r.official_valuation != null ? Number(r.official_valuation) : null,
        thumbnailUrl: r.thumbnail_url,
        likeCount: Number(r.like_count),
        commentCount: Number(r.comment_count),
        guessCount: Number(r.guess_count),
        viewCount: Number(r.view_count),
        activityLevel: computeActivityLevel(
          Number(r.trending_score),
          new Date(r.last_activity_at)
        ),
        lastActivityAt: new Date(r.last_activity_at).toISOString(),
        hasListing: true,
      }));

      return reply.send({
        items,
        pagination: {
          page,
          limit,
          hasMore,
        },
      });
    }
  );
}

export type FeedItem = z.infer<typeof feedItemSchema>;
export type FeedResponse = z.infer<typeof feedResponseSchema>;
