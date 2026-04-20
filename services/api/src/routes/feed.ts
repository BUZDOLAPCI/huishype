import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { computeActivityLevel } from './views.js';
import { formatDisplayAddress } from '../utils/address.js';
import { feedQuerySchema, isValidCountryCode, type FeedQuery } from '@huishype/shared';
import {
  buildPropertyListingFactsJoin,
  buildPropertySocialFactsJoin,
} from '../services/property-queries.js';

// --- Zod schemas ---

const coordinateSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number(), z.number()]),
});

const feedItemSchema = z.object({
  id: z.string().uuid(),
  address: z.string(),
  city: z.string(),
  zipCode: z.string(),
  countryCode: z.string(),
  geometry: coordinateSchema.nullable(),
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
  lon: number | null;
  lat: number | null;
  asking_price: number | null;
  official_valuation: number | null;
  thumbnail_url: string | null;
  has_listing: boolean;
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

      const rows = await db.execute<FeedRow>(sql`
        SELECT
          p.id,
          p.country_code,
          p.street,
          p.house_number,
          p.house_number_addition,
          p.city,
          p.postal_code AS zip_code,
          ST_X(p.geometry) AS lon,
          ST_Y(p.geometry) AS lat,
          lf.asking_price,
          p.official_valuation,
          lf.thumbnail_url,
          lf.has_listing,
          (
            COALESCE(sf.top_level_comment_count, 0)
            + COALESCE(sf.reply_count, 0)
          )::int AS comment_count,
          COALESCE(sf.guess_count, 0)::int AS guess_count,
          COALESCE(sf.property_like_count, 0)::int AS like_count,
          COALESCE(sf.view_count, 0)::int AS view_count,
          guess_stats.fmv,
          guess_stats.stddev AS guess_stddev,
          (
          (
            COALESCE(sf.recent_top_level_comment_count, 0)
            + COALESCE(sf.recent_reply_count, 0)
          )::numeric * 1.0
            + COALESCE(sf.recent_guess_count, 0)::numeric * 2.0
            + COALESCE(sf.recent_property_like_count, 0)::numeric * 0.5
          ) AS trending_score,
          COALESCE(sf.last_social_at, lf.active_listing_sort_at) AS last_activity_at
        FROM properties p
        ${buildPropertyListingFactsJoin('p', 'lf')}
        ${buildPropertySocialFactsJoin('p', 'sf')}
        LEFT JOIN LATERAL (
          SELECT
            CASE WHEN COUNT(*) >= 3 THEN ROUND(AVG(pg.guessed_price))::bigint END AS fmv,
            STDDEV(pg.guessed_price) AS stddev
          FROM price_guesses pg
          WHERE pg.property_id = p.id
        ) guess_stats ON TRUE
        WHERE 1=1
          AND p.status = 'active'
          AND p.geometry IS NOT NULL
          ${spatialCondition}
          ${countryCondition}
          AND lf.has_active_listing = TRUE
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
        countryCode: r.country_code,
        geometry:
          r.lon != null && r.lat != null
            ? { type: 'Point' as const, coordinates: [r.lon, r.lat] as [number, number] }
            : null,
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
        hasListing: r.has_listing,
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
