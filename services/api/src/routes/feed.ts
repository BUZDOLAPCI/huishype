import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { computeActivityLevel } from './views.js';
import { formatDisplayAddress } from '../utils/address.js';
import { feedQuerySchema, isValidCountryCode, type FeedQuery } from '@huishype/shared';
import { listingThumbnailOrderExpression } from '../services/property-queries.js';

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

const FEED_CACHE_TTL_SECONDS = 30;
const FEED_CACHE_TTL_MS = FEED_CACHE_TTL_SECONDS * 1_000;
const FEED_CACHE_MAX_ENTRIES = 512;
const FEED_CACHE_CONTROL = `public, max-age=${FEED_CACHE_TTL_SECONDS}, stale-while-revalidate=120`;

type FeedCacheEntry = {
  expiresAt: number;
  response: FeedResponse;
};

const feedCache = new Map<string, FeedCacheEntry>();

export function resetFeedCacheForTests(): void {
  feedCache.clear();
}

function buildFeedCacheKey(query: FeedQuery): string {
  return [
    query.filter,
    query.page,
    query.limit,
    query.country ?? '',
    query.lat ?? '',
    query.lon ?? '',
  ].join('|');
}

function getCachedFeedResponse(cacheKey: string): FeedResponse | null {
  const now = Date.now();
  const entry = feedCache.get(cacheKey);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= now) {
    feedCache.delete(cacheKey);
    return null;
  }

  feedCache.delete(cacheKey);
  feedCache.set(cacheKey, entry);
  return entry.response;
}

function setCachedFeedResponse(cacheKey: string, response: FeedResponse): void {
  const now = Date.now();

  for (const [key, entry] of feedCache) {
    if (entry.expiresAt <= now) {
      feedCache.delete(key);
    }
  }

  if (feedCache.has(cacheKey)) {
    feedCache.delete(cacheKey);
  }

  while (feedCache.size >= FEED_CACHE_MAX_ENTRIES) {
    const oldestKey = feedCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    feedCache.delete(oldestKey);
  }

  feedCache.set(cacheKey, {
    expiresAt: now + FEED_CACHE_TTL_MS,
    response,
  });
}

function buildFeedScopedListingOrderExpression(scopedAlias: string) {
  return sql`${sql.raw(
    `${scopedAlias}.active_listing_sort_at`
  )} DESC, ${sql.raw(`${scopedAlias}.listing_created_at`)} DESC, ${sql.raw(
    `${scopedAlias}.listing_id`
  )} DESC`;
}

function buildFeedOrderExpression(scoreAlias: string, filter: FeedQuery['filter']) {
  switch (filter) {
    case 'latest':
      return sql`${sql.raw(`${scoreAlias}.last_activity_at`)} DESC, ${sql.raw(`${scoreAlias}.id`)}`;
    case 'trending':
    default:
      return sql`${sql.raw(`${scoreAlias}.trending_score`)} DESC, ${sql.raw(
        `${scoreAlias}.last_activity_at`
      )} DESC, ${sql.raw(`${scoreAlias}.id`)}`;
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
      const cacheKey = buildFeedCacheKey(request.query);
      const cached = getCachedFeedResponse(cacheKey);

      if (cached) {
        return reply
          .header('Cache-Control', FEED_CACHE_CONTROL)
          .header('X-Feed-Cache', 'hit')
          .send(cached);
      }

      // --- Build dynamic query parts ---

      // Spatial condition (near-me filtering, 25 km radius)
      const spatialCondition =
        lat !== undefined && lon !== undefined
          ? sql`AND ST_DWithin(p.geometry::geography, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, 25000)`
          : sql``;

      // Country filter condition
      const countryCondition = country ? sql`AND p.country_code = ${country}` : sql``;

      const feedOrderExpression = buildFeedOrderExpression('cfr', filter);

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
          SELECT
            sal.property_id,
            (array_agg(sal.country_code ORDER BY ${buildFeedScopedListingOrderExpression('sal')}))[1]
              AS country_code,
            (array_agg(sal.street ORDER BY ${buildFeedScopedListingOrderExpression('sal')}))[1]
              AS street,
            (array_agg(sal.house_number ORDER BY ${buildFeedScopedListingOrderExpression('sal')}))[1]
              AS house_number,
            (
              array_agg(sal.house_number_addition ORDER BY ${buildFeedScopedListingOrderExpression(
                'sal'
              )})
            )[1] AS house_number_addition,
            (array_agg(sal.city ORDER BY ${buildFeedScopedListingOrderExpression('sal')}))[1]
              AS city,
            (array_agg(sal.postal_code ORDER BY ${buildFeedScopedListingOrderExpression('sal')}))[1]
              AS postal_code,
            (array_agg(sal.geometry ORDER BY ${buildFeedScopedListingOrderExpression('sal')}))[1]
              AS geometry,
            (
              array_agg(sal.official_valuation ORDER BY ${buildFeedScopedListingOrderExpression(
                'sal'
              )})
            )[1] AS official_valuation,
            (
              array_agg(
                sal.official_valuation_year
                ORDER BY ${buildFeedScopedListingOrderExpression('sal')}
              )
            )[1] AS official_valuation_year,
            (array_agg(sal.asking_price ORDER BY ${buildFeedScopedListingOrderExpression('sal')}))[1]
              AS asking_price,
            (
              array_agg(
                sal.active_listing_sort_at
                ORDER BY ${buildFeedScopedListingOrderExpression('sal')}
              )
            )[1] AS active_listing_sort_at,
            (
              SELECT l.thumbnail_url
              FROM v_canonical_listing_facts l
              WHERE l.property_id = sal.property_id
                AND l.thumbnail_url IS NOT NULL
              ORDER BY ${listingThumbnailOrderExpression('l')}
              LIMIT 1
            ) AS thumbnail_url
          FROM scoped_active_listings sal
          GROUP BY sal.property_id
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
        candidate_feed_rows AS MATERIALIZED (
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
            clf.thumbnail_url,
            TRUE AS has_listing,
            COALESCE(ocf.comment_count, 0)::int AS comment_count,
            COALESCE(ogf.guess_count, 0)::int AS guess_count,
            COALESCE(oplf.property_like_count, 0)::int AS like_count,
            COALESCE(ovf.view_count, 0)::int AS view_count,
            ogf.fmv,
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
          FROM candidate_listing_facts clf
          LEFT JOIN ordering_comment_facts ocf ON ocf.property_id = clf.property_id
          LEFT JOIN ordering_property_like_facts oplf ON oplf.property_id = clf.property_id
          LEFT JOIN ordering_comment_like_facts oclf ON oclf.property_id = clf.property_id
          LEFT JOIN ordering_guess_facts ogf ON ogf.property_id = clf.property_id
          LEFT JOIN ordering_view_facts ovf ON ovf.property_id = clf.property_id
        )
        SELECT
          cfr.id,
          cfr.country_code,
          cfr.street,
          cfr.house_number,
          cfr.house_number_addition,
          cfr.city,
          cfr.zip_code,
          cfr.lon,
          cfr.lat,
          cfr.asking_price,
          cfr.official_valuation,
          cfr.official_valuation_year,
          cfr.thumbnail_url,
          cfr.has_listing,
          cfr.comment_count,
          cfr.guess_count,
          cfr.like_count,
          cfr.view_count,
          cfr.fmv,
          cfr.trending_score,
          cfr.last_activity_at
        FROM candidate_feed_rows cfr
        ORDER BY ${feedOrderExpression}
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
          isValidCountryCode(r.country_code) ? r.country_code : undefined
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
        activityLevel: computeActivityLevel(Number(r.trending_score), new Date(r.last_activity_at)),
        lastActivityAt: new Date(r.last_activity_at).toISOString(),
        hasListing: r.has_listing,
      }));

      const response: FeedResponse = {
        items,
        pagination: {
          page,
          limit,
          hasMore,
        },
      };

      setCachedFeedResponse(cacheKey, response);

      return reply
        .header('Cache-Control', FEED_CACHE_CONTROL)
        .header('X-Feed-Cache', 'miss')
        .send(response);
    }
  );
}

export type FeedItem = z.infer<typeof feedItemSchema>;
export type FeedResponse = z.infer<typeof feedResponseSchema>;
