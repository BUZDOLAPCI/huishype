import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { computeActivityLevel } from './views.js';
import { formatDisplayAddress } from '../utils/address.js';
import { feedQuerySchema, isValidCountryCode } from '@huishype/shared';
import { getOfficialValuationSourceFetchHint } from '../services/official-valuations/index.js';
import {
  buildLocationAreaFilterPredicate,
  buildPropertyMarketFilterQuery,
  getMapFilterSignature,
  parsePropertyMarketFiltersQuery,
  type MapActivityFilter,
  type MapFilters,
  type MapListedSinceFilter,
} from '../services/map-filters.js';
import { activityActorPredicate } from '../services/activity-feed.js';

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
  officialValuationSourceFetch: z
    .object({
      source: z.literal('woz'),
      expectedValuationYear: z.number(),
      supportsClientFetch: z.object({
        web: z.boolean(),
        native: z.boolean(),
      }),
    })
    .nullable(),
  thumbnailUrl: z.string().nullable(),
  likeCount: z.number(),
  commentCount: z.number(),
  guessCount: z.number(),
  viewCount: z.number(),
  activityLevel: z.enum(['hot', 'warm', 'cold']),
  marketState: z.enum(['for-sale', 'for-rent', 'sold', 'rented', 'not-listed']),
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

const feedRouteQuerySchema = feedQuerySchema.extend({
  salePriceFrom: z.coerce.number().int().positive().optional(),
  salePriceTo: z.coerce.number().int().positive().optional(),
  rentPriceFrom: z.coerce.number().int().positive().optional(),
  rentPriceTo: z.coerce.number().int().positive().optional(),
  activity: z.enum(['all', 'today', '10d', '30d', 'all-time']).optional().default('all'),
  listedSince: z.enum(['all', 'today', '3d', '5d', '10d', '30d']).optional().default('all'),
  scope: z.enum(['public', 'following']).optional().default('public'),
  marketState: z.union([z.string(), z.array(z.string())]).optional(),
  area: z.union([z.string(), z.array(z.string())]).optional(),
});

type FeedRouteQuery = z.output<typeof feedRouteQuerySchema>;

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
  market_state: 'for-sale' | 'for-rent' | 'sold' | 'rented' | 'not-listed';
  comment_count: number;
  guess_count: number;
  like_count: number;
  view_count: number;
  fmv: number | null;
  trending_score: number;
  social_last_activity_at: string | null;
  last_activity_at: string;
}

const FEED_CACHE_TTL_SECONDS = 30;
const FEED_CACHE_TTL_MS = FEED_CACHE_TTL_SECONDS * 1_000;
const FEED_CACHE_MAX_ENTRIES = 512;
const FEED_CACHE_CONTROL = `public, max-age=${FEED_CACHE_TTL_SECONDS}, stale-while-revalidate=120`;
const FEED_SPATIAL_RADIUS_METERS = 25_000;
const APPROX_METERS_PER_DEGREE = 111_320;

type FeedCacheEntry = {
  expiresAt: number;
  response: FeedResponse;
};

const feedCache = new Map<string, FeedCacheEntry>();

export function resetFeedCacheForTests(): void {
  feedCache.clear();
}

function buildFeedCacheKey(query: FeedRouteQuery, filters: MapFilters): string {
  return [
    query.filter,
    query.page,
    query.limit,
    query.country ?? '',
    query.lat ?? '',
    query.lon ?? '',
    query.scope ?? 'public',
    getMapFilterSignature(filters),
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

function buildFeedOrderExpression(scoreAlias: string) {
  return sql`${sql.raw(`${scoreAlias}.trending_score`)} DESC, ${sql.raw(
    `${scoreAlias}.last_activity_at`
  )} DESC, ${sql.raw(`${scoreAlias}.id`)}`;
}

function buildListedSinceFilterPredicate(filter: MapListedSinceFilter, alias = 'lf') {
  const lifecycleColumn = sql.raw(`${alias}.displayed_listing_lifecycle_at`);

  switch (filter) {
    case 'today':
      return sql`${lifecycleColumn} >= NOW() - INTERVAL '24 hours'`;
    case '3d':
      return sql`${lifecycleColumn} >= NOW() - INTERVAL '3 days'`;
    case '5d':
      return sql`${lifecycleColumn} >= NOW() - INTERVAL '5 days'`;
    case '10d':
      return sql`${lifecycleColumn} >= NOW() - INTERVAL '10 days'`;
    case '30d':
      return sql`${lifecycleColumn} >= NOW() - INTERVAL '30 days'`;
    case 'all':
    default:
      return sql`TRUE`;
  }
}

function buildFeedActivityPredicate(activity: MapActivityFilter, requireSocialActivity: boolean) {
  const lastSocialAt = sql.raw('cfr.qualifying_social_last_activity_at');

  if (activity === 'all') {
    return requireSocialActivity ? sql`${lastSocialAt} IS NOT NULL` : sql`TRUE`;
  }

  if (activity === 'all-time') {
    return sql`${lastSocialAt} IS NOT NULL`;
  }

  if (activity === 'today') {
    return sql`${lastSocialAt} >= NOW() - INTERVAL '24 hours'`;
  }

  if (activity === '10d') {
    return sql`${lastSocialAt} >= NOW() - INTERVAL '10 days'`;
  }

  return sql`${lastSocialAt} >= NOW() - INTERVAL '30 days'`;
}

function feedCacheControl(scope: FeedRouteQuery['scope']) {
  return scope === 'following' ? 'private, no-store' : FEED_CACHE_CONTROL;
}

function buildFeedListingSortExpression(alias: string) {
  return sql`
    COALESCE(
      ${sql.raw(`${alias}.last_reconciled_at`)},
      ${sql.raw(`${alias}.last_mirror_seen_at`)},
      ${sql.raw(`${alias}.last_user_seen_at`)},
      ${sql.raw(`${alias}.last_seen_at`)},
      ${sql.raw(`${alias}.updated_at`)},
      ${sql.raw(`${alias}.created_at`)}
    ) DESC,
    ${sql.raw(`${alias}.created_at`)} DESC,
    ${sql.raw(`${alias}.id`)} DESC
  `;
}

function buildFeedListingSortValue(alias: string) {
  return sql`
    COALESCE(
      ${sql.raw(`${alias}.last_reconciled_at`)},
      ${sql.raw(`${alias}.last_mirror_seen_at`)},
      ${sql.raw(`${alias}.last_user_seen_at`)},
      ${sql.raw(`${alias}.last_seen_at`)},
      ${sql.raw(`${alias}.updated_at`)},
      ${sql.raw(`${alias}.created_at`)}
    )
  `;
}

function buildFeedListingPriceTypeExpression(alias: string) {
  return sql`
    CASE
      WHEN lower(${sql.raw(`${alias}.source_name`)}) = 'funda'
        AND lower(btrim(${sql.raw(`${alias}.price_type`)})) = 'buy'
        THEN 'sale'
      WHEN lower(btrim(${sql.raw(`${alias}.price_type`)})) IN ('sale', 'rent')
        THEN lower(btrim(${sql.raw(`${alias}.price_type`)}))
      WHEN lower(${sql.raw(`${alias}.source_name`)}) = 'pararius'
        THEN 'rent'
      ELSE 'sale'
    END
  `;
}

function buildFeedListingFactsJoin(propertyAlias = 'p', alias = 'lf') {
  const idColumn = sql.raw(`${propertyAlias}.id`);

  return sql`
    LEFT JOIN LATERAL (
      SELECT
        latest_listing.status IS NOT NULL AS has_listing,
        active_listing.id IS NOT NULL AS has_active_listing,
        latest_listing.status AS latest_listing_status,
        active_listing.asking_price AS asking_price,
        active_listing.sort_at AS active_listing_sort_at,
        latest_listing.sort_at AS latest_listing_sort_at,
        CASE
          WHEN active_listing.id IS NOT NULL
            THEN active_listing.listed_at
          WHEN latest_listing.status IN ('sold', 'rented')
            THEN latest_listing.listed_at
          ELSE NULL
        END AS displayed_listing_lifecycle_at,
        listing_thumbnail.thumbnail_url AS thumbnail_url,
        CASE
          WHEN active_listing.id IS NOT NULL AND active_listing.normalized_price_type = 'rent'
            THEN 'for-rent'
          WHEN active_listing.id IS NOT NULL
            THEN 'for-sale'
          WHEN latest_listing.status = 'sold'
            THEN 'sold'
          WHEN latest_listing.status = 'rented'
            THEN 'rented'
          ELSE 'not-listed'
        END AS market_state
      FROM (SELECT 1) AS _seed
      LEFT JOIN LATERAL (
        SELECT
          cl.id,
          cl.asking_price,
          ${buildFeedListingPriceTypeExpression('cl')} AS normalized_price_type,
          COALESCE(cl.listed_at, cl.first_seen_at, cl.created_at) AS listed_at,
          ${buildFeedListingSortValue('cl')} AS sort_at
        FROM canonical_listings cl
        WHERE cl.property_id = ${idColumn}
          AND cl.verification_state <> 'invalid'
          AND cl.status = 'active'
        ORDER BY ${buildFeedListingSortExpression('cl')}
        LIMIT 1
      ) active_listing ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          cl.status::text AS status,
          COALESCE(cl.listed_at, cl.first_seen_at, cl.created_at) AS listed_at,
          ${buildFeedListingSortValue('cl')} AS sort_at
        FROM canonical_listings cl
        WHERE cl.property_id = ${idColumn}
          AND cl.verification_state <> 'invalid'
        ORDER BY ${buildFeedListingSortExpression('cl')}
        LIMIT 1
      ) latest_listing ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          cl.thumbnail_url,
          cl.status
        FROM canonical_listings cl
        WHERE cl.property_id = ${idColumn}
          AND cl.verification_state <> 'invalid'
          AND cl.thumbnail_url IS NOT NULL
        ORDER BY
          (cl.status = 'active') DESC,
          ${buildFeedListingSortExpression('cl')}
        LIMIT 1
      ) listing_thumbnail ON TRUE
    ) ${sql.raw(alias)} ON TRUE
  `;
}

// --- Route ---

export async function feedRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get<{ Querystring: FeedRouteQuery }>(
    '/feed',
    {
      schema: {
        tags: ['feed'],
        summary: 'Get property feed',
        description:
          'Get a paginated activity feed of listing-backed and socially active properties. ' +
          'Trending is ranked with weighted activity and freshness. Shared market, price, area, activity, listed-since, and scope filters are supported.',
        querystring: feedRouteQuerySchema,
        response: {
          200: feedResponseSchema,
        },
      },
      onRequest: [app.optionalAuth],
    },
    async (request, reply) => {
      const { page, limit, lat, lon, country, scope } = request.query;
      const offset = (page - 1) * limit;
      const sharedFilters = parsePropertyMarketFiltersQuery(request.query);
      const marketFilterQuery = buildPropertyMarketFilterQuery(sharedFilters, 'p');
      const areaFilterPredicate = buildLocationAreaFilterPredicate(sharedFilters.areas, 'p');
      const listedSincePredicate = buildListedSinceFilterPredicate(
        sharedFilters.listedSince,
        'cfr'
      );
      const requireSocialActivity = scope === 'following' || sharedFilters.activity !== 'all';
      const feedActivityPredicate = buildFeedActivityPredicate(
        sharedFilters.activity,
        requireSocialActivity
      );
      const propertyLikeActorPredicate = activityActorPredicate(
        scope,
        'r.user_id',
        request.userId ?? null
      );
      const commentActorPredicate = activityActorPredicate(
        scope,
        'c.user_id',
        request.userId ?? null
      );
      const priceGuessActorPredicate = activityActorPredicate(
        scope,
        'pg.user_id',
        request.userId ?? null
      );
      const commentLikeActorPredicate = activityActorPredicate(
        scope,
        'r.user_id',
        request.userId ?? null
      );
      if (scope === 'following' && !request.userId) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required',
        });
      }

      const cacheKey = buildFeedCacheKey(request.query, sharedFilters);
      const cached = scope === 'public' ? getCachedFeedResponse(cacheKey) : null;

      if (cached) {
        return reply
          .header('Cache-Control', feedCacheControl(scope))
          .header('X-Feed-Cache', 'hit')
          .send(cached);
      }

      // --- Build dynamic query parts ---

      // Spatial condition (near-me filtering, 25 km radius)
      const spatialCondition =
        lat !== undefined && lon !== undefined
          ? sql`
              AND p.geometry && ST_Expand(
                ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326),
                ${FEED_SPATIAL_RADIUS_METERS / APPROX_METERS_PER_DEGREE}
                  / GREATEST(COS(RADIANS(${lat})), 0.01)
              )
              AND ST_DWithin(
                p.geometry::geography,
                ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography,
                ${FEED_SPATIAL_RADIUS_METERS}
              )
            `
          : sql``;

      // Country filter condition
      const countryCondition = country ? sql`AND p.country_code = ${country}` : sql``;

      const feedOrderExpression = buildFeedOrderExpression('cfr');

      const rows = await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL jit = off`);

        return tx.execute<FeedRow>(sql`
        WITH candidate_seed_ids AS MATERIALIZED (
          SELECT cl.property_id
          FROM canonical_listings cl
          WHERE cl.verification_state <> 'invalid'
            AND cl.status IN ('active', 'sold', 'rented')
          UNION
          SELECT c.property_id
          FROM comments c
          WHERE c.hidden_at IS NULL
          UNION
          SELECT r.target_id AS property_id
          FROM reactions r
          WHERE r.target_type = 'property'
            AND r.reaction_type = 'like'
          UNION
          SELECT c.property_id
          FROM reactions r
          INNER JOIN comments c ON c.id = r.target_id
          WHERE r.target_type = 'comment'
            AND r.reaction_type = 'like'
            AND c.hidden_at IS NULL
          UNION
          SELECT pg.property_id
          FROM price_guesses pg
          UNION
          SELECT pv.property_id
          FROM property_views pv
        ),
        candidate_properties AS MATERIALIZED (
          SELECT
            p.id,
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
            p.comments_disabled_at,
            p.updated_at
          FROM candidate_seed_ids csi
          INNER JOIN properties p ON p.id = csi.property_id
          ${marketFilterQuery.join}
          WHERE p.status = 'active'
            AND p.geometry IS NOT NULL
            AND ${marketFilterQuery.predicate}
            AND ${areaFilterPredicate}
            ${spatialCondition}
            ${countryCondition}
        ),
        ordering_guess_rows AS MATERIALIZED (
          SELECT DISTINCT ON (pg.property_id, pg.user_id)
            pg.property_id,
            pg.user_id,
            pg.guessed_price,
            GREATEST(pg.created_at, pg.updated_at) AS effective_at
          FROM price_guesses pg
          INNER JOIN candidate_properties cp ON cp.property_id = pg.property_id
          WHERE ${priceGuessActorPredicate}
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
          INNER JOIN candidate_properties cp ON cp.property_id = c.property_id
          WHERE cp.comments_disabled_at IS NULL
            AND c.hidden_at IS NULL
            AND ${commentActorPredicate}
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
          INNER JOIN candidate_properties cp ON cp.property_id = r.target_id
          WHERE r.target_type = 'property'
            AND r.reaction_type = 'like'
            AND ${propertyLikeActorPredicate}
          GROUP BY r.target_id
        ),
        ordering_comment_like_facts AS MATERIALIZED (
          SELECT
            c.property_id,
            MAX(r.created_at) AS latest_comment_like_at
          FROM reactions r
          INNER JOIN comments c ON c.id = r.target_id
          INNER JOIN candidate_properties cp ON cp.property_id = c.property_id
          WHERE r.target_type = 'comment'
            AND r.reaction_type = 'like'
            AND cp.comments_disabled_at IS NULL
            AND c.hidden_at IS NULL
            AND ${commentLikeActorPredicate}
          GROUP BY c.property_id
        ),
        ordering_view_facts AS MATERIALIZED (
          SELECT
            pv.property_id,
            COUNT(*)::int AS view_count,
            MAX(pv.viewed_at) AS latest_view_at
          FROM property_views pv
          INNER JOIN candidate_properties cp ON cp.property_id = pv.property_id
          GROUP BY pv.property_id
        ),
        candidate_feed_rows AS MATERIALIZED (
          SELECT
            cp.property_id AS id,
            cp.country_code,
            cp.street,
            cp.house_number,
            cp.house_number_addition,
            cp.city,
            cp.postal_code AS zip_code,
            ST_X(cp.geometry) AS lon,
            ST_Y(cp.geometry) AS lat,
            lf.asking_price,
            cp.official_valuation,
            cp.official_valuation_year,
            lf.thumbnail_url,
            lf.has_listing,
            lf.market_state,
            lf.displayed_listing_lifecycle_at,
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
            GREATEST(
              ocf.latest_top_level_comment_at,
              ocf.latest_reply_at,
              oplf.latest_property_like_at,
              oclf.latest_comment_like_at,
              ogf.latest_guess_at
            ) AS qualifying_social_last_activity_at,
            GREATEST(
              ocf.latest_top_level_comment_at,
              ocf.latest_reply_at,
              oplf.latest_property_like_at,
              oclf.latest_comment_like_at,
              ogf.latest_guess_at,
              ovf.latest_view_at
            ) AS social_last_activity_at,
            COALESCE(
              GREATEST(
                ocf.latest_top_level_comment_at,
                ocf.latest_reply_at,
                oplf.latest_property_like_at,
                oclf.latest_comment_like_at,
                ogf.latest_guess_at,
                ovf.latest_view_at
              ),
              lf.latest_listing_sort_at,
              cp.updated_at
            ) AS last_activity_at
          FROM candidate_properties cp
          ${buildFeedListingFactsJoin('cp', 'lf')}
          LEFT JOIN ordering_comment_facts ocf ON ocf.property_id = cp.property_id
          LEFT JOIN ordering_property_like_facts oplf ON oplf.property_id = cp.property_id
          LEFT JOIN ordering_comment_like_facts oclf ON oclf.property_id = cp.property_id
          LEFT JOIN ordering_guess_facts ogf ON ogf.property_id = cp.property_id
          LEFT JOIN ordering_view_facts ovf ON ovf.property_id = cp.property_id
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
          cfr.market_state,
          cfr.comment_count,
          cfr.guess_count,
          cfr.like_count,
          cfr.view_count,
          cfr.fmv,
          cfr.trending_score,
          cfr.social_last_activity_at,
          cfr.last_activity_at
        FROM candidate_feed_rows cfr
        WHERE ${listedSincePredicate}
          AND ${feedActivityPredicate}
        ORDER BY ${feedOrderExpression}
        LIMIT ${limit + 1}
        OFFSET ${offset}
      `);
      });

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
        officialValuationSourceFetch: getOfficialValuationSourceFetchHint(r.country_code),
        thumbnailUrl: r.thumbnail_url,
        likeCount: Number(r.like_count),
        commentCount: Number(r.comment_count),
        guessCount: Number(r.guess_count),
        viewCount: Number(r.view_count),
        activityLevel: computeActivityLevel(
          Number(r.trending_score),
          r.social_last_activity_at ? new Date(r.social_last_activity_at) : null
        ),
        marketState: r.market_state,
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

      if (scope === 'public') {
        setCachedFeedResponse(cacheKey, response);
      }

      return reply
        .header('Cache-Control', feedCacheControl(scope))
        .header('X-Feed-Cache', 'miss')
        .send(response);
    }
  );
}

export type FeedItem = z.infer<typeof feedItemSchema>;
export type FeedResponse = z.infer<typeof feedResponseSchema>;
