import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { computeActivityLevel } from './views.js';
import { formatDisplayAddress } from '../utils/address.js';
import { feedQuerySchema, isValidCountryCode, type FeedQuery } from '@huishype/shared';

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
  officialValuationYear: z.number().nullable(),
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
  official_valuation_year: number | null;
  thumbnail_url: string | null;
  has_listing: boolean;
  comment_count: number;
  guess_count: number;
  like_count: number;
  view_count: number;
  fmv: number | null;
  trending_score: number;
  last_activity_at: string;
}

function buildFeedScopedListingFactOrderExpression(scopedAlias: string) {
  return sql`${sql.raw(`${scopedAlias}.property_id`)}, ${sql.raw(
    `${scopedAlias}.active_listing_sort_at`,
  )} DESC, ${sql.raw(`${scopedAlias}.listing_created_at`)} DESC, ${sql.raw(
    `${scopedAlias}.listing_id`,
  )} DESC`;
}

function buildFeedOrderExpression(scoreAlias: string, filter: FeedQuery['filter']) {
  switch (filter) {
    case 'latest':
      return sql`${sql.raw(`${scoreAlias}.last_activity_at`)} DESC, ${sql.raw(
        `${scoreAlias}.property_id`,
      )}`;
    case 'trending':
    default:
      return sql`${sql.raw(`${scoreAlias}.trending_score`)} DESC, ${sql.raw(
        `${scoreAlias}.last_activity_at`,
      )} DESC, ${sql.raw(`${scoreAlias}.property_id`)}`;
  }
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

      const scoreOrderExpression = buildFeedOrderExpression('cs', filter);
      const pageOrderExpression = buildFeedOrderExpression('pc', filter);

      const rows = await db.execute<FeedRow>(sql`
        WITH scoped_active_listings AS MATERIALIZED (
          SELECT
            p.id AS property_id,
            p.country_code,
            p.street,
            p.house_number,
            p.house_number_addition,
            p.city,
            p.postal_code,
            p.geometry,
            p.official_valuation,
            p.official_valuation_year,
            l.listing_id,
            l.asking_price,
            l.thumbnail_url,
            l.listing_created_at,
            l.sort_at AS active_listing_sort_at
          FROM v_canonical_listing_facts l
          INNER JOIN properties p ON p.id = l.property_id
          WHERE l.status = 'active'
            AND p.status = 'active'
            AND p.geometry IS NOT NULL
            ${spatialCondition}
            ${countryCondition}
        ),
        candidate_listing_facts AS MATERIALIZED (
          SELECT DISTINCT ON (sal.property_id)
            sal.property_id,
            sal.country_code,
            sal.street,
            sal.house_number,
            sal.house_number_addition,
            sal.city,
            sal.postal_code,
            sal.geometry,
            sal.official_valuation,
            sal.official_valuation_year,
            sal.asking_price,
            sal.active_listing_sort_at
          FROM scoped_active_listings sal
          ORDER BY ${buildFeedScopedListingFactOrderExpression('sal')}
        ),
        candidate_thumbnail_facts AS MATERIALIZED (
          SELECT DISTINCT ON (sal.property_id)
            sal.property_id,
            sal.thumbnail_url
          FROM scoped_active_listings sal
          WHERE sal.thumbnail_url IS NOT NULL
          ORDER BY ${buildFeedScopedListingFactOrderExpression('sal')}
        ),
        candidate_ids AS MATERIALIZED (
          SELECT clf.property_id
          FROM candidate_listing_facts clf
        ),
        ordering_guess_rows AS MATERIALIZED (
          SELECT DISTINCT ON (pg.property_id, pg.user_id)
            pg.property_id,
            pg.user_id,
            pg.guessed_price,
            GREATEST(pg.created_at, pg.updated_at) AS effective_at
          FROM price_guesses pg
          INNER JOIN candidate_ids ci ON ci.property_id = pg.property_id
          ORDER BY
            pg.property_id,
            pg.user_id,
            GREATEST(pg.created_at, pg.updated_at) DESC,
            pg.created_at DESC,
            pg.id DESC
        ),
        ordering_guess_facts AS MATERIALIZED (
          SELECT
            ogr.property_id,
            COUNT(*)::int AS guess_count,
            COUNT(*) FILTER (
              WHERE ogr.effective_at > NOW() - INTERVAL '7 days'
            )::int AS recent_guess_count,
            MAX(ogr.effective_at) AS latest_guess_at,
            CASE WHEN COUNT(*) >= 3 THEN ROUND(AVG(ogr.guessed_price))::bigint END AS fmv
          FROM ordering_guess_rows ogr
          GROUP BY ogr.property_id
        ),
        ordering_comment_facts AS MATERIALIZED (
          SELECT
            c.property_id,
            COUNT(*)::int AS comment_count,
            COUNT(*) FILTER (
              WHERE c.parent_id IS NULL
                AND c.created_at > NOW() - INTERVAL '7 days'
            )::int AS recent_top_level_comment_count,
            MAX(c.created_at) FILTER (WHERE c.parent_id IS NULL) AS latest_top_level_comment_at,
            COUNT(*) FILTER (
              WHERE c.parent_id IS NOT NULL
                AND c.created_at > NOW() - INTERVAL '7 days'
            )::int AS recent_reply_count,
            MAX(c.created_at) FILTER (WHERE c.parent_id IS NOT NULL) AS latest_reply_at
          FROM comments c
          INNER JOIN candidate_ids ci ON ci.property_id = c.property_id
          GROUP BY c.property_id
        ),
        ordering_property_like_facts AS MATERIALIZED (
          SELECT
            r.target_id AS property_id,
            COUNT(*)::int AS property_like_count,
            COUNT(*) FILTER (
              WHERE r.created_at > NOW() - INTERVAL '7 days'
            )::int AS recent_property_like_count,
            MAX(r.created_at) AS latest_property_like_at
          FROM reactions r
          INNER JOIN candidate_ids ci ON ci.property_id = r.target_id
          WHERE r.target_type = 'property'
            AND r.reaction_type = 'like'
          GROUP BY r.target_id
        ),
        ordering_comment_like_facts AS MATERIALIZED (
          SELECT
            c.property_id,
            MAX(r.created_at) AS latest_comment_like_at
          FROM reactions r
          INNER JOIN comments c ON c.id = r.target_id
          INNER JOIN candidate_ids ci ON ci.property_id = c.property_id
          WHERE r.target_type = 'comment'
            AND r.reaction_type = 'like'
          GROUP BY c.property_id
        ),
        ordering_view_facts AS MATERIALIZED (
          SELECT
            pv.property_id,
            COUNT(*)::int AS view_count,
            MAX(pv.viewed_at) AS latest_view_at
          FROM property_views pv
          INNER JOIN candidate_ids ci ON ci.property_id = pv.property_id
          GROUP BY pv.property_id
        ),
        candidate_scores AS MATERIALIZED (
          SELECT
            ci.property_id,
            (
              (
                COALESCE(ocf.recent_top_level_comment_count, 0)
                + COALESCE(ocf.recent_reply_count, 0)
              )::numeric * 1.0
              + COALESCE(ogf.recent_guess_count, 0)::numeric * 2.0
              + COALESCE(oplf.recent_property_like_count, 0)::numeric * 0.5
            ) AS trending_score,
            COALESCE(
              GREATEST(
                ocf.latest_top_level_comment_at,
                ocf.latest_reply_at,
                oplf.latest_property_like_at,
                oclf.latest_comment_like_at,
                ogf.latest_guess_at,
                ovf.latest_view_at
              ),
              clf.active_listing_sort_at
            ) AS last_activity_at
          FROM candidate_ids ci
          INNER JOIN candidate_listing_facts clf ON clf.property_id = ci.property_id
          LEFT JOIN ordering_comment_facts ocf ON ocf.property_id = ci.property_id
          LEFT JOIN ordering_property_like_facts oplf ON oplf.property_id = ci.property_id
          LEFT JOIN ordering_comment_like_facts oclf ON oclf.property_id = ci.property_id
          LEFT JOIN ordering_guess_facts ogf ON ogf.property_id = ci.property_id
          LEFT JOIN ordering_view_facts ovf ON ovf.property_id = ci.property_id
        ),
        paged_candidates AS MATERIALIZED (
          SELECT *
          FROM candidate_scores cs
          ORDER BY ${scoreOrderExpression}
          LIMIT ${limit + 1}
          OFFSET ${offset}
        )
        SELECT
          clf.property_id AS id,
          clf.country_code,
          clf.street,
          clf.house_number,
          clf.house_number_addition,
          clf.city,
          clf.postal_code AS zip_code,
          ST_X(clf.geometry) AS lon,
          ST_Y(clf.geometry) AS lat,
          clf.asking_price,
          clf.official_valuation,
          clf.official_valuation_year,
          ctf.thumbnail_url,
          TRUE AS has_listing,
          COALESCE(ocf.comment_count, 0)::int AS comment_count,
          COALESCE(ogf.guess_count, 0)::int AS guess_count,
          COALESCE(oplf.property_like_count, 0)::int AS like_count,
          COALESCE(ovf.view_count, 0)::int AS view_count,
          ogf.fmv,
          pc.trending_score,
          pc.last_activity_at
        FROM paged_candidates pc
        INNER JOIN candidate_listing_facts clf ON clf.property_id = pc.property_id
        LEFT JOIN candidate_thumbnail_facts ctf ON ctf.property_id = pc.property_id
        LEFT JOIN ordering_comment_facts ocf ON ocf.property_id = pc.property_id
        LEFT JOIN ordering_property_like_facts oplf ON oplf.property_id = pc.property_id
        LEFT JOIN ordering_view_facts ovf ON ovf.property_id = pc.property_id
        LEFT JOIN ordering_guess_facts ogf ON ogf.property_id = pc.property_id
        ORDER BY ${pageOrderExpression}
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
        officialValuationYear:
          r.official_valuation_year != null ? Number(r.official_valuation_year) : null,
        thumbnailUrl: r.thumbnail_url,
        likeCount: Number(r.like_count),
        commentCount: Number(r.comment_count),
        guessCount: Number(r.guess_count),
        viewCount: Number(r.view_count),
        activityLevel: computeActivityLevel(
          Number(r.trending_score),
          new Date(r.last_activity_at),
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
