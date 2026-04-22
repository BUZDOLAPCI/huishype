import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { formatDisplayAddress } from '../utils/address.js';
import { isValidCountryCode } from '@huishype/shared';

export type ActivityEventType = 'property_like' | 'comment' | 'price_guess' | 'save';
export type ActivityFeedScope = 'public' | 'following' | 'self';

export interface ActivityFeedItem {
  id: string;
  eventType: ActivityEventType;
  actor: {
    id: string;
    displayName: string;
    handle: string;
    profilePhotoUrl: string | null;
  };
  property: {
    id: string;
    address: string;
    streetName: string;
    houseNumber: number;
    houseNumberAddition: string | null;
    city: string;
    postalCode: string;
    countryCode: string;
    thumbnailUrl: string | null;
  };
  createdAt: string;
  meta: Record<string, unknown> | null;
}

export interface ActivityFeedResponse {
  items: ActivityFeedItem[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

interface ActivityRow extends Record<string, unknown> {
  event_id: string;
  event_type: ActivityEventType;
  actor_id: string;
  actor_display_name: string;
  actor_handle: string;
  actor_photo_url: string | null;
  property_id: string;
  country_code: string;
  street: string;
  house_number: number;
  house_number_addition: string | null;
  postal_code: string;
  city: string;
  thumbnail_url: string | null;
  created_at: string;
  meta: Record<string, unknown> | null;
}

function mapActivityRow(row: ActivityRow): ActivityFeedItem {
  return {
    id: row.event_id,
    eventType: row.event_type,
    actor: {
      id: row.actor_id,
      displayName: row.actor_display_name,
      handle: row.actor_handle,
      profilePhotoUrl: row.actor_photo_url,
    },
    property: {
      id: row.property_id,
      streetName: row.street,
      houseNumber: row.house_number,
      houseNumberAddition: row.house_number_addition,
      address: formatDisplayAddress(
        {
          street: row.street,
          houseNumber: row.house_number,
          houseNumberAddition: row.house_number_addition,
          postalCode: row.postal_code,
          city: row.city,
        },
        isValidCountryCode(row.country_code) ? row.country_code : undefined,
      ),
      city: row.city,
      postalCode: row.postal_code,
      countryCode: row.country_code,
      thumbnailUrl: row.thumbnail_url,
    },
    createdAt: new Date(row.created_at).toISOString(),
    meta: row.meta,
  };
}

function activityActorPredicate(
  scope: ActivityFeedScope,
  eventUserIdColumn: string,
  viewerId: string | null,
) {
  if (scope === 'self') {
    return sql`${sql.raw(eventUserIdColumn)} = ${viewerId}`;
  }

  if (scope === 'following') {
    return sql`EXISTS (
      SELECT 1
      FROM user_follows uf
      WHERE uf.follower_user_id = ${viewerId}
        AND uf.followed_user_id = ${sql.raw(eventUserIdColumn)}
    )`;
  }

  return sql`TRUE`;
}

export async function fetchActivityFeed(params: {
  scope: ActivityFeedScope;
  viewerId: string | null;
  limit: number;
  offset: number;
}): Promise<ActivityFeedResponse> {
  const includeSave = params.scope === 'self';
  const propertyLikeActorPredicate = activityActorPredicate(params.scope, 'r.user_id', params.viewerId);
  const commentActorPredicate = activityActorPredicate(params.scope, 'c.user_id', params.viewerId);
  const priceGuessActorPredicate = activityActorPredicate(params.scope, 'pg.user_id', params.viewerId);
  const savedPropertyActorPredicate = activityActorPredicate(
    params.scope,
    'sp.user_id',
    params.viewerId,
  );

  const rows = await db.execute<ActivityRow>(sql`
    WITH activity_events AS (
      (
        SELECT
          r.id::text AS event_id,
          'property_like'::text AS event_type,
          r.user_id AS event_user_id,
          COALESCE(u.display_name, u.username) AS actor_display_name,
          u.username AS actor_handle,
          u.profile_photo_url AS actor_photo_url,
          p.id AS property_id,
          p.country_code,
          p.street,
          p.house_number,
          p.house_number_addition,
          p.postal_code,
          p.city,
          lt.thumbnail_url,
          r.created_at,
          NULL::jsonb AS meta
        FROM reactions r
        INNER JOIN users u ON u.id = r.user_id
        INNER JOIN properties p ON p.id = r.target_id
        LEFT JOIN LATERAL (
          SELECT l.thumbnail_url
          FROM listings l
          WHERE l.property_id = p.id
            AND l.status = 'active'
            AND l.thumbnail_url IS NOT NULL
          ORDER BY COALESCE(l.mirror_last_changed_at, l.updated_at, l.created_at) DESC, l.created_at DESC, l.id DESC
          LIMIT 1
        ) lt ON TRUE
        WHERE r.target_type = 'property'
          AND r.reaction_type = 'like'
          AND ${propertyLikeActorPredicate}
      )
      UNION ALL
      (
        SELECT
          c.id::text AS event_id,
          'comment'::text AS event_type,
          c.user_id AS event_user_id,
          COALESCE(u.display_name, u.username) AS actor_display_name,
          u.username AS actor_handle,
          u.profile_photo_url AS actor_photo_url,
          p.id AS property_id,
          p.country_code,
          p.street,
          p.house_number,
          p.house_number_addition,
          p.postal_code,
          p.city,
          lt.thumbnail_url,
          c.created_at,
          jsonb_build_object('contentPreview', LEFT(c.content, 100)) AS meta
        FROM comments c
        INNER JOIN users u ON u.id = c.user_id
        INNER JOIN properties p ON p.id = c.property_id
        LEFT JOIN LATERAL (
          SELECT l.thumbnail_url
          FROM listings l
          WHERE l.property_id = p.id
            AND l.status = 'active'
            AND l.thumbnail_url IS NOT NULL
          ORDER BY COALESCE(l.mirror_last_changed_at, l.updated_at, l.created_at) DESC, l.created_at DESC, l.id DESC
          LIMIT 1
        ) lt ON TRUE
        WHERE ${commentActorPredicate}
      )
      UNION ALL
      (
        SELECT
          pg.id::text AS event_id,
          'price_guess'::text AS event_type,
          pg.user_id AS event_user_id,
          COALESCE(u.display_name, u.username) AS actor_display_name,
          u.username AS actor_handle,
          u.profile_photo_url AS actor_photo_url,
          p.id AS property_id,
          p.country_code,
          p.street,
          p.house_number,
          p.house_number_addition,
          p.postal_code,
          p.city,
          lt.thumbnail_url,
          GREATEST(pg.created_at, pg.updated_at) AS created_at,
          jsonb_build_object('isMemeGuess', pg.is_meme_guess) AS meta
        FROM price_guesses pg
        INNER JOIN users u ON u.id = pg.user_id
        INNER JOIN properties p ON p.id = pg.property_id
        LEFT JOIN LATERAL (
          SELECT l.thumbnail_url
          FROM listings l
          WHERE l.property_id = p.id
            AND l.status = 'active'
            AND l.thumbnail_url IS NOT NULL
          ORDER BY COALESCE(l.mirror_last_changed_at, l.updated_at, l.created_at) DESC, l.created_at DESC, l.id DESC
          LIMIT 1
        ) lt ON TRUE
        WHERE ${priceGuessActorPredicate}
      )
      ${includeSave
        ? sql`
            UNION ALL
            (
              SELECT
                sp.id::text AS event_id,
                'save'::text AS event_type,
                sp.user_id AS event_user_id,
                COALESCE(u.display_name, u.username) AS actor_display_name,
                u.username AS actor_handle,
                u.profile_photo_url AS actor_photo_url,
                p.id AS property_id,
                p.country_code,
                p.street,
                p.house_number,
                p.house_number_addition,
                p.postal_code,
                p.city,
                lt.thumbnail_url,
                sp.created_at,
                NULL::jsonb AS meta
              FROM saved_properties sp
              INNER JOIN users u ON u.id = sp.user_id
              INNER JOIN properties p ON p.id = sp.property_id
              LEFT JOIN LATERAL (
                SELECT l.thumbnail_url
                FROM listings l
                WHERE l.property_id = p.id
                  AND l.status = 'active'
                  AND l.thumbnail_url IS NOT NULL
                ORDER BY COALESCE(l.mirror_last_changed_at, l.updated_at, l.created_at) DESC, l.created_at DESC, l.id DESC
                LIMIT 1
                ) lt ON TRUE
                WHERE ${savedPropertyActorPredicate}
            )
          `
        : sql``}
    )
    SELECT
      event_id,
      event_type,
      event_user_id AS actor_id,
      actor_display_name,
      actor_handle,
      actor_photo_url,
      property_id,
      country_code,
      street,
      house_number,
      house_number_addition,
      postal_code,
      city,
      thumbnail_url,
      created_at,
      meta
    FROM activity_events
    ORDER BY created_at DESC, event_id DESC
    LIMIT ${params.limit + 1}
    OFFSET ${params.offset}
  `);

  const allRows = Array.from(rows);
  const hasMore = allRows.length > params.limit;
  const pageRows = hasMore ? allRows.slice(0, params.limit) : allRows;

  return {
    items: pageRows.map(mapActivityRow),
    pagination: {
      limit: params.limit,
      offset: params.offset,
      hasMore,
    },
  };
}
