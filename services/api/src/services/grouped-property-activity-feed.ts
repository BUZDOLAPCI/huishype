import { sql } from 'drizzle-orm';
import {
  isValidCountryCode,
  type ActivityActor,
  type ActivityProperty,
  type GroupedActivityPreview,
  type GroupedPropertyActivityItem,
  type GroupedPropertyActivityResponse,
  type PublicActivityEventType,
} from '@huishype/shared';
import { db } from '../db/index.js';
import { formatDisplayAddress } from '../utils/address.js';
import { activityActorPredicate } from './activity-feed.js';

export type GroupedPropertyActivityFeedScope = 'public' | 'following';

interface RecentActorRow {
  id: string;
  displayName: string;
  handle: string;
  profilePhotoUrl: string | null;
}

interface GroupedPropertyActivityRow extends Record<string, unknown> {
  property_id: string;
  country_code: string;
  street: string;
  house_number: number;
  house_number_addition: string | null;
  postal_code: string;
  city: string;
  lon: number | null;
  lat: number | null;
  thumbnail_url: string | null;
  last_activity_at: string;
  like_count: number;
  comment_count: number;
  guess_count: number;
  recent_actors: RecentActorRow[] | null;
  preview_kind: 'comment' | 'summary';
  preview_comment_id: string | null;
  preview_event_type: PublicActivityEventType;
  preview_created_at: string;
  preview_actor_id: string;
  preview_actor_display_name: string;
  preview_actor_handle: string;
  preview_actor_photo_url: string | null;
  preview_content_preview: string | null;
  preview_summary: string | null;
}

function mapActivityProperty(row: GroupedPropertyActivityRow): ActivityProperty {
  return {
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
    geometry:
      row.lon != null && row.lat != null
        ? {
            type: 'Point',
            coordinates: [row.lon, row.lat],
          }
        : null,
    thumbnailUrl: row.thumbnail_url,
  };
}

function mapPreviewActor(row: GroupedPropertyActivityRow): ActivityActor {
  return {
    id: row.preview_actor_id,
    displayName: row.preview_actor_display_name,
    handle: row.preview_actor_handle,
    profilePhotoUrl: row.preview_actor_photo_url,
  };
}

function buildActivitySummary(eventType: PublicActivityEventType, actorName: string) {
  switch (eventType) {
    case 'property_like':
      return `${actorName} liked this property`;
    case 'price_guess':
      return `${actorName} made a price guess`;
    case 'comment':
    default:
      return `${actorName} commented on this property`;
  }
}

function mapPreview(row: GroupedPropertyActivityRow): GroupedActivityPreview {
  const actor = mapPreviewActor(row);

  if (row.preview_kind === 'comment' && row.preview_comment_id) {
    return {
      kind: 'comment',
      commentId: row.preview_comment_id,
      createdAt: new Date(row.preview_created_at).toISOString(),
      actor,
      contentPreview: row.preview_content_preview ?? '',
    };
  }

  return {
    kind: 'summary',
    eventType: row.preview_event_type,
    createdAt: new Date(row.preview_created_at).toISOString(),
    actor,
    summary:
      row.preview_summary ??
      buildActivitySummary(row.preview_event_type, row.preview_actor_display_name),
  };
}

function mapGroupedPropertyActivityRow(
  row: GroupedPropertyActivityRow,
): GroupedPropertyActivityItem {
  return {
    property: mapActivityProperty(row),
    lastActivityAt: new Date(row.last_activity_at).toISOString(),
    counts: {
      likeCount: row.like_count,
      commentCount: row.comment_count,
      guessCount: row.guess_count,
    },
    recentActors: Array.isArray(row.recent_actors) ? row.recent_actors : [],
    preview: mapPreview(row),
  };
}

export async function fetchGroupedPropertyActivityFeed(params: {
  scope: GroupedPropertyActivityFeedScope;
  viewerId: string | null;
  limit: number;
  offset: number;
}): Promise<GroupedPropertyActivityResponse> {
  const propertyLikeActorPredicate = activityActorPredicate(
    params.scope,
    'r.user_id',
    params.viewerId,
  );
  const commentActorPredicate = activityActorPredicate(params.scope, 'c.user_id', params.viewerId);
  const priceGuessActorPredicate = activityActorPredicate(
    params.scope,
    'pg.user_id',
    params.viewerId,
  );

  const rows = await db.execute<GroupedPropertyActivityRow>(sql`
    WITH activity_events AS (
      (
        SELECT
          r.id::text AS event_id,
          'property_like'::text AS event_type,
          r.user_id AS actor_id,
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
          CASE WHEN p.geometry IS NULL THEN NULL ELSE ST_X(p.geometry) END AS lon,
          CASE WHEN p.geometry IS NULL THEN NULL ELSE ST_Y(p.geometry) END AS lat,
          lt.thumbnail_url,
          r.created_at,
          NULL::text AS content_preview
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
          c.user_id AS actor_id,
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
          CASE WHEN p.geometry IS NULL THEN NULL ELSE ST_X(p.geometry) END AS lon,
          CASE WHEN p.geometry IS NULL THEN NULL ELSE ST_Y(p.geometry) END AS lat,
          lt.thumbnail_url,
          c.created_at,
          LEFT(c.content, 140) AS content_preview
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
          pg.user_id AS actor_id,
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
          CASE WHEN p.geometry IS NULL THEN NULL ELSE ST_X(p.geometry) END AS lon,
          CASE WHEN p.geometry IS NULL THEN NULL ELSE ST_Y(p.geometry) END AS lat,
          lt.thumbnail_url,
          GREATEST(pg.created_at, pg.updated_at) AS created_at,
          NULL::text AS content_preview
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
    ),
    grouped_events AS (
      SELECT
        ae.property_id,
        MAX(ae.created_at) AS last_activity_at,
        COUNT(*) FILTER (WHERE ae.event_type = 'property_like')::int AS like_count,
        COUNT(*) FILTER (WHERE ae.event_type = 'comment')::int AS comment_count,
        COUNT(*) FILTER (WHERE ae.event_type = 'price_guess')::int AS guess_count
      FROM activity_events ae
      GROUP BY ae.property_id
    ),
    ordered_groups AS (
      SELECT
        ge.*,
        ROW_NUMBER() OVER (ORDER BY ge.last_activity_at DESC, ge.property_id DESC) AS row_num
      FROM grouped_events ge
    ),
    paged_groups AS (
      SELECT *
      FROM ordered_groups
      WHERE row_num > ${params.offset}
        AND row_num <= ${params.offset + params.limit + 1}
    ),
    latest_property_rows AS (
      SELECT DISTINCT ON (ae.property_id)
        ae.property_id,
        ae.country_code,
        ae.street,
        ae.house_number,
        ae.house_number_addition,
        ae.postal_code,
        ae.city,
        ae.lon,
        ae.lat,
        ae.thumbnail_url
      FROM activity_events ae
      INNER JOIN paged_groups pg ON pg.property_id = ae.property_id
      ORDER BY ae.property_id, ae.created_at DESC, ae.event_id DESC
    ),
    latest_actor_rows AS (
      SELECT DISTINCT ON (ae.property_id, ae.actor_id)
        ae.property_id,
        ae.actor_id,
        ae.actor_display_name,
        ae.actor_handle,
        ae.actor_photo_url,
        ae.created_at,
        ae.event_id
      FROM activity_events ae
      INNER JOIN paged_groups pg ON pg.property_id = ae.property_id
      ORDER BY ae.property_id, ae.actor_id, ae.created_at DESC, ae.event_id DESC
    ),
    recent_actor_rows AS (
      SELECT
        lar.*,
        ROW_NUMBER() OVER (
          PARTITION BY lar.property_id
          ORDER BY lar.created_at DESC, lar.actor_id DESC
        ) AS actor_rank
      FROM latest_actor_rows lar
    ),
    recent_actor_agg AS (
      SELECT
        rar.property_id,
        jsonb_agg(
          jsonb_build_object(
            'id', rar.actor_id,
            'displayName', rar.actor_display_name,
            'handle', rar.actor_handle,
            'profilePhotoUrl', rar.actor_photo_url
          )
          ORDER BY rar.created_at DESC, rar.actor_id DESC
        ) AS recent_actors
      FROM recent_actor_rows rar
      WHERE rar.actor_rank <= 3
      GROUP BY rar.property_id
    ),
    comment_preview_rows AS (
      SELECT DISTINCT ON (ae.property_id)
        ae.property_id,
        ae.event_id AS comment_id,
        ae.created_at,
        ae.actor_id,
        ae.actor_display_name,
        ae.actor_handle,
        ae.actor_photo_url,
        ae.content_preview
      FROM activity_events ae
      INNER JOIN paged_groups pg ON pg.property_id = ae.property_id
      WHERE ae.event_type = 'comment'
      ORDER BY ae.property_id, ae.created_at DESC, ae.event_id DESC
    ),
    latest_event_rows AS (
      SELECT DISTINCT ON (ae.property_id)
        ae.property_id,
        ae.event_type,
        ae.created_at,
        ae.actor_id,
        ae.actor_display_name,
        ae.actor_handle,
        ae.actor_photo_url,
        ae.event_id
      FROM activity_events ae
      INNER JOIN paged_groups pg ON pg.property_id = ae.property_id
      ORDER BY ae.property_id, ae.created_at DESC, ae.event_id DESC
    )
    SELECT
      pg.property_id,
      lpr.country_code,
      lpr.street,
      lpr.house_number,
      lpr.house_number_addition,
      lpr.postal_code,
      lpr.city,
      lpr.lon,
      lpr.lat,
      lpr.thumbnail_url,
      pg.last_activity_at::text AS last_activity_at,
      pg.like_count,
      pg.comment_count,
      pg.guess_count,
      COALESCE(raa.recent_actors, '[]'::jsonb) AS recent_actors,
      CASE WHEN cpr.comment_id IS NOT NULL THEN 'comment' ELSE 'summary' END AS preview_kind,
      cpr.comment_id AS preview_comment_id,
      COALESCE(cpr.created_at, ler.created_at)::text AS preview_created_at,
      COALESCE(cpr.actor_id, ler.actor_id) AS preview_actor_id,
      COALESCE(cpr.actor_display_name, ler.actor_display_name) AS preview_actor_display_name,
      COALESCE(cpr.actor_handle, ler.actor_handle) AS preview_actor_handle,
      COALESCE(cpr.actor_photo_url, ler.actor_photo_url) AS preview_actor_photo_url,
      COALESCE(ler.event_type, 'comment') AS preview_event_type,
      cpr.content_preview AS preview_content_preview,
      CASE
        WHEN cpr.comment_id IS NULL THEN
          CASE ler.event_type
            WHEN 'property_like' THEN CONCAT(ler.actor_display_name, ' liked this property')
            WHEN 'price_guess' THEN CONCAT(ler.actor_display_name, ' made a price guess')
            ELSE CONCAT(ler.actor_display_name, ' commented on this property')
          END
        ELSE NULL
      END AS preview_summary
    FROM paged_groups pg
    INNER JOIN latest_property_rows lpr ON lpr.property_id = pg.property_id
    INNER JOIN latest_event_rows ler ON ler.property_id = pg.property_id
    LEFT JOIN recent_actor_agg raa ON raa.property_id = pg.property_id
    LEFT JOIN comment_preview_rows cpr ON cpr.property_id = pg.property_id
    ORDER BY pg.row_num ASC
  `);

  const allRows = Array.from(rows);
  const hasMore = allRows.length > params.limit;
  const pageRows = hasMore ? allRows.slice(0, params.limit) : allRows;

  return {
    items: pageRows.map(mapGroupedPropertyActivityRow),
    pagination: {
      limit: params.limit,
      offset: params.offset,
      hasMore,
    },
  };
}
