import { sql, type SQL } from 'drizzle-orm';
import type { MapFilters } from './map-filters.js';

type MapActivityFilter = MapFilters['activity'];

const TOP_LEVEL_COMMENT_WEIGHT = 1.0;
const REPLY_WEIGHT = 1.0;
const PROPERTY_LIKE_WEIGHT = 1.0;
const COMMENT_LIKE_WEIGHT = 0.8;
const GUESS_WEIGHT = 0.85;
const UNIQUE_VIEWER_WEIGHT = 0.5;

function propertyIdColumn(propertyAlias: string): SQL {
  return sql.raw(`${propertyAlias}.id`);
}

function officialValuationColumn(propertyAlias: string): SQL {
  return sql.raw(`${propertyAlias}.official_valuation`);
}

function listingOrderExpression(listingAlias: string): SQL {
  return sql`COALESCE(${sql.raw(`${listingAlias}.mirror_last_changed_at`)}, ${sql.raw(
    `${listingAlias}.updated_at`,
  )}, ${sql.raw(`${listingAlias}.created_at`)}) DESC, ${sql.raw(
    `${listingAlias}.created_at`,
  )} DESC, ${sql.raw(`${listingAlias}.id`)} DESC`;
}

export function buildPropertyListingFactsJoin(
  propertyAlias = 'p',
  alias = 'lf',
  options: { includeEffectivePrices?: boolean } = {},
): SQL {
  const includeEffectivePrices = options.includeEffectivePrices ?? false;
  const idColumn = propertyIdColumn(propertyAlias);
  const valuationColumn = officialValuationColumn(propertyAlias);

  const soldHistoryJoin = includeEffectivePrices
    ? sql`
        LEFT JOIN LATERAL (
          SELECT ph.price AS last_sold_price
          FROM price_history ph
          WHERE ph.property_id = ${idColumn}
            AND ph.event_type = 'sold'
          ORDER BY ph.price_date DESC, ph.created_at DESC, ph.id DESC
          LIMIT 1
        ) sold_history ON TRUE
      `
    : sql`LEFT JOIN LATERAL (SELECT NULL::bigint AS last_sold_price) sold_history ON TRUE`;

  const rentedHistoryJoin = includeEffectivePrices
    ? sql`
        LEFT JOIN LATERAL (
          SELECT ph.price AS last_rented_price
          FROM price_history ph
          WHERE ph.property_id = ${idColumn}
            AND ph.event_type = 'rented'
          ORDER BY ph.price_date DESC, ph.created_at DESC, ph.id DESC
          LIMIT 1
        ) rented_history ON TRUE
      `
    : sql`LEFT JOIN LATERAL (SELECT NULL::bigint AS last_rented_price) rented_history ON TRUE`;

  const guessFactsJoin = includeEffectivePrices
    ? sql`
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS guess_count,
            CASE
              WHEN COUNT(*) = 0 THEN NULL::bigint
              WHEN COUNT(*) <= 2 THEN ROUND(
                CASE
                  WHEN ${valuationColumn} IS NOT NULL
                    THEN ${valuationColumn}::numeric * 0.7
                      + (
                        SUM(pg.guessed_price::numeric * GREATEST(u.karma, 1)::numeric)
                        / NULLIF(SUM(GREATEST(u.karma, 1)::numeric), 0)
                      ) * 0.3
                  ELSE (
                    SUM(pg.guessed_price::numeric * GREATEST(u.karma, 1)::numeric)
                    / NULLIF(SUM(GREATEST(u.karma, 1)::numeric), 0)
                  )
                END
              )::bigint
              WHEN COUNT(*) <= 9 THEN ROUND(
                CASE
                  WHEN ${valuationColumn} IS NOT NULL
                    THEN ${valuationColumn}::numeric * 0.3
                      + (
                        SUM(pg.guessed_price::numeric * GREATEST(u.karma, 1)::numeric)
                        / NULLIF(SUM(GREATEST(u.karma, 1)::numeric), 0)
                      ) * 0.7
                  ELSE (
                    SUM(pg.guessed_price::numeric * GREATEST(u.karma, 1)::numeric)
                    / NULLIF(SUM(GREATEST(u.karma, 1)::numeric), 0)
                  )
                END
              )::bigint
              ELSE ROUND(
                SUM(pg.guessed_price::numeric * GREATEST(u.karma, 1)::numeric)
                / NULLIF(SUM(GREATEST(u.karma, 1)::numeric), 0)
              )::bigint
            END AS canonical_fmv
          FROM price_guesses pg
          INNER JOIN users u ON u.id = pg.user_id
          WHERE pg.property_id = ${idColumn}
            AND pg.is_meme_guess = FALSE
        ) guess_facts ON TRUE
      `
    : sql`LEFT JOIN LATERAL (SELECT NULL::bigint AS canonical_fmv) guess_facts ON TRUE`;

  return sql`
    LEFT JOIN LATERAL (
      SELECT
        latest_listing.status IS NOT NULL AS has_listing,
        active_listing.id IS NOT NULL AS has_active_listing,
        latest_listing.status AS latest_listing_status,
        active_listing.asking_price AS asking_price,
        active_thumbnail.thumbnail_url AS thumbnail_url,
        CASE
          WHEN active_listing.id IS NOT NULL AND COALESCE(NULLIF(active_listing.price_type, ''), 'sale') = 'rent'
            THEN 'for-rent'
          WHEN active_listing.id IS NOT NULL
            THEN 'for-sale'
          WHEN latest_listing.status = 'sold'
            THEN 'sold'
          WHEN latest_listing.status = 'rented'
            THEN 'rented'
          ELSE 'not-listed'
        END AS market_state,
        COALESCE(
          CASE
            WHEN active_listing.id IS NOT NULL
              AND COALESCE(NULLIF(active_listing.price_type, ''), 'sale') = 'sale'
              THEN active_listing.asking_price
            ELSE NULL
          END,
          sold_history.last_sold_price,
          guess_facts.canonical_fmv,
          ${valuationColumn}
        ) AS sale_effective_price,
        COALESCE(
          CASE
            WHEN active_listing.id IS NOT NULL
              AND COALESCE(NULLIF(active_listing.price_type, ''), 'sale') = 'rent'
              THEN active_listing.asking_price
            ELSE NULL
          END,
          rented_history.last_rented_price
        ) AS rent_effective_price
      FROM (SELECT 1) AS _seed
      LEFT JOIN LATERAL (
        SELECT
          l.id,
          l.asking_price,
          l.price_type
        FROM listings l
        WHERE l.property_id = ${idColumn}
          AND l.status = 'active'
        ORDER BY ${listingOrderExpression('l')}
        LIMIT 1
      ) active_listing ON TRUE
      LEFT JOIN LATERAL (
        SELECT l.status
        FROM listings l
        WHERE l.property_id = ${idColumn}
        ORDER BY ${listingOrderExpression('l')}
        LIMIT 1
      ) latest_listing ON TRUE
      LEFT JOIN LATERAL (
        SELECT l.thumbnail_url
        FROM listings l
        WHERE l.property_id = ${idColumn}
          AND l.status = 'active'
          AND l.thumbnail_url IS NOT NULL
        ORDER BY ${listingOrderExpression('l')}
        LIMIT 1
      ) active_thumbnail ON TRUE
      ${soldHistoryJoin}
      ${rentedHistoryJoin}
      ${guessFactsJoin}
    ) ${sql.raw(alias)} ON TRUE
  `;
}

export function buildPropertySocialFactsJoin(propertyAlias = 'p', alias = 'sf'): SQL {
  const idColumn = propertyIdColumn(propertyAlias);

  return sql`
    LEFT JOIN LATERAL (
      WITH top_level_comments AS (
        SELECT
          COUNT(*)::int AS count,
          COUNT(*) FILTER (
            WHERE c.created_at > NOW() - INTERVAL '7 days'
          )::int AS recent_count,
          MAX(c.created_at) AS latest
        FROM comments c
        WHERE c.property_id = ${idColumn}
          AND c.parent_id IS NULL
      ),
      replies AS (
        SELECT
          COUNT(*)::int AS count,
          COUNT(*) FILTER (
            WHERE c.created_at > NOW() - INTERVAL '7 days'
          )::int AS recent_count,
          MAX(c.created_at) AS latest
        FROM comments c
        WHERE c.property_id = ${idColumn}
          AND c.parent_id IS NOT NULL
      ),
      property_likes AS (
        SELECT
          COUNT(*)::int AS count,
          COUNT(*) FILTER (
            WHERE r.created_at > NOW() - INTERVAL '7 days'
          )::int AS recent_count,
          MAX(r.created_at) AS latest
        FROM reactions r
        WHERE r.target_type = 'property'
          AND r.reaction_type = 'like'
          AND r.target_id = ${idColumn}
      ),
      comment_likes AS (
        SELECT
          COUNT(*)::int AS count,
          COUNT(*) FILTER (
            WHERE r.created_at > NOW() - INTERVAL '7 days'
          )::int AS recent_count,
          MAX(r.created_at) AS latest
        FROM reactions r
        INNER JOIN comments c ON c.id = r.target_id
        WHERE r.target_type = 'comment'
          AND r.reaction_type = 'like'
          AND c.property_id = ${idColumn}
      ),
      guesses AS (
        SELECT
          COUNT(*)::int AS count,
          COUNT(*) FILTER (
            WHERE GREATEST(pg.created_at, pg.updated_at) > NOW() - INTERVAL '7 days'
          )::int AS recent_count,
          MAX(GREATEST(pg.created_at, pg.updated_at)) AS latest
        FROM price_guesses pg
        WHERE pg.property_id = ${idColumn}
      ),
      views AS (
        SELECT
          COUNT(*)::int AS view_count,
          COUNT(*) FILTER (
            WHERE pv.viewed_at > NOW() - INTERVAL '7 days'
          )::int AS recent_view_count,
          COUNT(DISTINCT COALESCE(pv.user_id::text, pv.session_id))::int AS unique_viewer_count,
          COUNT(DISTINCT COALESCE(pv.user_id::text, pv.session_id)) FILTER (
            WHERE pv.viewed_at > NOW() - INTERVAL '7 days'
          )::int AS recent_unique_viewer_count,
          MAX(pv.viewed_at) AS latest
        FROM property_views pv
        WHERE pv.property_id = ${idColumn}
      )
      SELECT
        COALESCE(top_level_comments.count, 0)::int AS top_level_comment_count,
        COALESCE(replies.count, 0)::int AS reply_count,
        COALESCE(property_likes.count, 0)::int AS property_like_count,
        COALESCE(comment_likes.count, 0)::int AS comment_like_count,
        COALESCE(guesses.count, 0)::int AS guess_count,
        COALESCE(views.view_count, 0)::int AS view_count,
        COALESCE(views.unique_viewer_count, 0)::int AS unique_viewer_count,
        COALESCE(top_level_comments.recent_count, 0)::int AS recent_top_level_comment_count,
        COALESCE(replies.recent_count, 0)::int AS recent_reply_count,
        COALESCE(property_likes.recent_count, 0)::int AS recent_property_like_count,
        COALESCE(comment_likes.recent_count, 0)::int AS recent_comment_like_count,
        COALESCE(guesses.recent_count, 0)::int AS recent_guess_count,
        COALESCE(views.recent_view_count, 0)::int AS recent_view_count,
        COALESCE(views.recent_unique_viewer_count, 0)::int AS recent_unique_viewer_count,
        (
          COALESCE(top_level_comments.count, 0)::double precision * ${TOP_LEVEL_COMMENT_WEIGHT}
          + COALESCE(replies.count, 0)::double precision * ${REPLY_WEIGHT}
          + COALESCE(property_likes.count, 0)::double precision * ${PROPERTY_LIKE_WEIGHT}
          + COALESCE(comment_likes.count, 0)::double precision * ${COMMENT_LIKE_WEIGHT}
          + COALESCE(guesses.count, 0)::double precision * ${GUESS_WEIGHT}
          + COALESCE(views.unique_viewer_count, 0)::double precision * ${UNIQUE_VIEWER_WEIGHT}
        )::double precision AS social_score,
        (
          COALESCE(top_level_comments.recent_count, 0)::double precision * ${TOP_LEVEL_COMMENT_WEIGHT}
          + COALESCE(replies.recent_count, 0)::double precision * ${REPLY_WEIGHT}
          + COALESCE(property_likes.recent_count, 0)::double precision * ${PROPERTY_LIKE_WEIGHT}
          + COALESCE(comment_likes.recent_count, 0)::double precision * ${COMMENT_LIKE_WEIGHT}
          + COALESCE(guesses.recent_count, 0)::double precision * ${GUESS_WEIGHT}
          + COALESCE(views.recent_unique_viewer_count, 0)::double precision * ${UNIQUE_VIEWER_WEIGHT}
        )::double precision AS recent_social_score,
        GREATEST(
          top_level_comments.latest,
          replies.latest,
          property_likes.latest,
          comment_likes.latest,
          guesses.latest,
          views.latest
        ) AS last_social_at
      FROM top_level_comments, replies, property_likes, comment_likes, guesses, views
    ) ${sql.raw(alias)} ON TRUE
  `;
}

export function buildActivityFilterPredicate(activity: MapActivityFilter, alias = 'sf'): SQL {
  if (activity === 'social') {
    return sql`${sql.raw(`${alias}.social_score`)} > 0`;
  }

  if (activity === 'recent') {
    return sql`${sql.raw(`${alias}.recent_social_score`)} > 0`;
  }

  return sql`TRUE`;
}
