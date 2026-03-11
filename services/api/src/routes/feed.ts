import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { computeActivityLevel } from './views.js';
import { formatDisplayAddress } from '../utils/address.js';
import { isValidCountryCode } from '@huishype/shared';

// --- Zod schemas ---

const feedQuerySchema = z.object({
  filter: z
    .enum(['trending', 'recent', 'controversial', 'price-mismatch'])
    .default('trending'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  country: z.string().length(2).toUpperCase().refine(
    (val) => isValidCountryCode(val),
    { message: 'Invalid country code' }
  ).optional(),
});

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
    total: z.number(),
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

  typedApp.get(
    '/feed',
    {
      schema: {
        tags: ['feed'],
        summary: 'Get property feed',
        description:
          'Get a paginated feed of properties with active listings, sorted by various algorithms. ' +
          'Filters: trending (weighted 7-day activity), recent (last activity), ' +
          'controversial (guess variance), price-mismatch (asking vs FMV gap).',
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
      // Filter-specific WHERE for the count query (uses correlated subqueries)
      let countFilterWhere: ReturnType<typeof sql>;
      // Filter-specific ORDER BY
      let orderBy: ReturnType<typeof sql>;

      switch (filter) {
        case 'trending':
          dataFilterWhere = sql``;
          countFilterWhere = sql``;
          orderBy = sql`ORDER BY trending_score DESC, last_activity_at DESC, p.id`;
          break;
        case 'recent':
          dataFilterWhere = sql``;
          countFilterWhere = sql``;
          orderBy = sql`ORDER BY last_activity_at DESC, p.id`;
          break;
        case 'controversial':
          dataFilterWhere = sql`AND COALESCE(g.cnt, 0) >= 2`;
          countFilterWhere = sql`AND (SELECT COUNT(*) FROM price_guesses WHERE property_id = p.id) >= 2`;
          orderBy = sql`ORDER BY guess_stddev DESC NULLS LAST, p.id`;
          break;
        case 'price-mismatch':
          dataFilterWhere = sql`AND l.asking_price IS NOT NULL AND g.fmv IS NOT NULL`;
          countFilterWhere = sql`AND l.asking_price IS NOT NULL AND (SELECT CASE WHEN COUNT(*) >= 3 THEN 1 END FROM price_guesses WHERE property_id = p.id) IS NOT NULL`;
          orderBy = sql`ORDER BY ABS(l.asking_price::numeric - g.fmv::numeric) DESC, p.id`;
          break;
        default:
          dataFilterWhere = sql``;
          countFilterWhere = sql``;
          orderBy = sql`ORDER BY trending_score DESC, last_activity_at DESC, p.id`;
      }

      // --- Count query ---
      const countRows = await db.execute<{ total: number }>(sql`
        SELECT COUNT(*)::int AS total
        FROM (
          SELECT DISTINCT ON (property_id)
            property_id, asking_price
          FROM listings
          WHERE status = 'active'
          ORDER BY property_id, created_at DESC
        ) l
        INNER JOIN properties p ON p.id = l.property_id
          AND p.status = 'active'
          AND p.geometry IS NOT NULL
        WHERE 1=1
          ${spatialCondition}
          ${countryCondition}
          ${countFilterWhere}
      `);
      const total = Array.from(countRows)[0]?.total ?? 0;

      if (total === 0) {
        return reply.send({
          items: [],
          pagination: { page, limit, total: 0, hasMore: false },
        });
      }

      // --- Data query ---
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
            COALESCE(c7.cnt, 0)::numeric * 1.0
            + COALESCE(g7.cnt, 0)::numeric * 2.0
            + COALESCE(r7.cnt, 0)::numeric * 0.5
          ) AS trending_score,
          COALESCE(
            GREATEST(c.latest, g.latest, r.latest),
            l.listed_at
          ) AS last_activity_at
        FROM (
          SELECT DISTINCT ON (property_id)
            property_id, asking_price, thumbnail_url,
            created_at AS listed_at
          FROM listings
          WHERE status = 'active'
          ORDER BY property_id, created_at DESC
        ) l
        INNER JOIN properties p ON p.id = l.property_id
          AND p.status = 'active'
          AND p.geometry IS NOT NULL
        LEFT JOIN (
          SELECT property_id, COUNT(*)::int AS cnt, MAX(created_at) AS latest
          FROM comments GROUP BY property_id
        ) c ON c.property_id = p.id
        LEFT JOIN (
          SELECT property_id,
            COUNT(*)::int AS cnt,
            MAX(created_at) AS latest,
            CASE WHEN COUNT(*) >= 3
              THEN ROUND(AVG(guessed_price))::bigint
            END AS fmv,
            STDDEV(guessed_price) AS stddev
          FROM price_guesses GROUP BY property_id
        ) g ON g.property_id = p.id
        LEFT JOIN (
          SELECT target_id, COUNT(*)::int AS cnt, MAX(created_at) AS latest
          FROM reactions
          WHERE target_type = 'property' AND reaction_type = 'like'
          GROUP BY target_id
        ) r ON r.target_id = p.id
        LEFT JOIN (
          SELECT property_id, COUNT(*)::int AS cnt
          FROM comments
          WHERE created_at > NOW() - INTERVAL '7 days'
          GROUP BY property_id
        ) c7 ON c7.property_id = p.id
        LEFT JOIN (
          SELECT property_id, COUNT(*)::int AS cnt
          FROM price_guesses
          WHERE created_at > NOW() - INTERVAL '7 days'
          GROUP BY property_id
        ) g7 ON g7.property_id = p.id
        LEFT JOIN (
          SELECT target_id, COUNT(*)::int AS cnt
          FROM reactions
          WHERE target_type = 'property' AND reaction_type = 'like'
            AND created_at > NOW() - INTERVAL '7 days'
          GROUP BY target_id
        ) r7 ON r7.target_id = p.id
        LEFT JOIN (
          SELECT property_id, COUNT(*)::int AS cnt
          FROM property_views
          GROUP BY property_id
        ) v ON v.property_id = p.id
        WHERE 1=1
          ${spatialCondition}
          ${countryCondition}
          ${dataFilterWhere}
        ${orderBy}
        LIMIT ${limit}
        OFFSET ${offset}
      `);

      // --- Transform to response ---
      const items = Array.from(rows).map((r) => ({
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
          total,
          hasMore: offset + limit < total,
        },
      });
    }
  );
}

// Export types for client usage
export type FeedQuery = z.infer<typeof feedQuerySchema>;
export type FeedItem = z.infer<typeof feedItemSchema>;
export type FeedResponse = z.infer<typeof feedResponseSchema>;
