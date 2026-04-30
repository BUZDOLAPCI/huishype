CREATE OR REPLACE FUNCTION martin_tiles.rebuild_map_projections(
  min_zoom integer DEFAULT 0,
  max_zoom integer DEFAULT 16
) RETURNS TABLE(projection_name text, row_count bigint)
LANGUAGE plpgsql
AS $$
DECLARE
  world_width constant double precision := 40075016.68557849;
  world_half constant double precision := 20037508.342789244;
  normalized_min_zoom integer;
  normalized_max_zoom integer;
BEGIN
  normalized_min_zoom := GREATEST(0, LEAST(COALESCE(min_zoom, 0), 22));
  normalized_max_zoom := GREATEST(normalized_min_zoom, LEAST(COALESCE(max_zoom, 16), 22));

  TRUNCATE TABLE
    map_public_property_bucket_members,
    map_property_actor_activity,
    map_public_property_facts;

  WITH latest_public_guesses AS MATERIALIZED (
    SELECT DISTINCT ON (pg.property_id, pg.user_id)
      pg.property_id,
      pg.user_id,
      pg.guessed_price,
      pg.is_meme_guess,
      GREATEST(pg.created_at, pg.updated_at) AS effective_at
    FROM price_guesses pg
    ORDER BY
      pg.property_id,
      pg.user_id,
      GREATEST(pg.created_at, pg.updated_at) DESC,
      pg.created_at DESC,
      pg.id DESC
  ),
  listing_ordered AS MATERIALIZED (
    SELECT
      l.*,
      ROW_NUMBER() OVER (
        PARTITION BY l.property_id
        ORDER BY l.sort_at DESC, l.listing_created_at DESC, l.listing_id DESC
      ) AS latest_rank,
      CASE
        WHEN l.status = 'active' THEN ROW_NUMBER() OVER (
          PARTITION BY l.property_id, (l.status = 'active')
          ORDER BY l.sort_at DESC, l.listing_created_at DESC, l.listing_id DESC
        )
        ELSE NULL
      END AS active_rank,
      CASE
        WHEN l.thumbnail_url IS NOT NULL THEN ROW_NUMBER() OVER (
          PARTITION BY l.property_id, (l.thumbnail_url IS NOT NULL)
          ORDER BY (l.status = 'active') DESC, l.sort_at DESC, l.listing_created_at DESC, l.listing_id DESC
        )
        ELSE NULL
      END AS thumbnail_rank
    FROM v_canonical_listing_facts l
  ),
  listing_agg AS MATERIALIZED (
    SELECT
      l.property_id,
      COUNT(*) FILTER (WHERE l.status = 'active')::int AS active_listing_count,
      COUNT(*) FILTER (WHERE l.status IN ('sold', 'rented'))::int AS completed_listing_count,
      MAX(l.status) FILTER (WHERE l.latest_rank = 1) AS latest_status,
      MAX(l.normalized_price_type) FILTER (WHERE l.active_rank = 1) AS active_price_type,
      MAX(l.asking_price) FILTER (WHERE l.active_rank = 1) AS asking_price,
      MAX(l.thumbnail_url) FILTER (WHERE l.thumbnail_rank = 1) AS thumbnail_url
    FROM listing_ordered l
    GROUP BY l.property_id
  ),
  sold_history AS MATERIALIZED (
    SELECT DISTINCT ON (ph.property_id)
      ph.property_id,
      ph.price AS last_sold_price
    FROM price_history ph
    WHERE ph.event_type = 'sold'
    ORDER BY ph.property_id, ph.price_date DESC, ph.created_at DESC, ph.id DESC
  ),
  rented_history AS MATERIALIZED (
    SELECT DISTINCT ON (ph.property_id)
      ph.property_id,
      ph.price AS last_rented_price
    FROM price_history ph
    WHERE ph.event_type = 'rented'
    ORDER BY ph.property_id, ph.price_date DESC, ph.created_at DESC, ph.id DESC
  ),
  guess_facts AS MATERIALIZED (
    SELECT
      lpg.property_id,
      CASE
        WHEN COUNT(*) = 0 THEN NULL::bigint
        WHEN COUNT(*) <= 2 THEN ROUND(
          CASE
            WHEN p.official_valuation IS NOT NULL
              THEN p.official_valuation::numeric * 0.7
                + (
                  SUM(lpg.guessed_price::numeric * GREATEST(u.karma, 1)::numeric)
                  / NULLIF(SUM(GREATEST(u.karma, 1)::numeric), 0)
                ) * 0.3
            ELSE (
              SUM(lpg.guessed_price::numeric * GREATEST(u.karma, 1)::numeric)
              / NULLIF(SUM(GREATEST(u.karma, 1)::numeric), 0)
            )
          END
        )::bigint
        WHEN COUNT(*) <= 9 THEN ROUND(
          CASE
            WHEN p.official_valuation IS NOT NULL
              THEN p.official_valuation::numeric * 0.3
                + (
                  SUM(lpg.guessed_price::numeric * GREATEST(u.karma, 1)::numeric)
                  / NULLIF(SUM(GREATEST(u.karma, 1)::numeric), 0)
                ) * 0.7
            ELSE (
              SUM(lpg.guessed_price::numeric * GREATEST(u.karma, 1)::numeric)
              / NULLIF(SUM(GREATEST(u.karma, 1)::numeric), 0)
            )
          END
        )::bigint
        ELSE ROUND(
          SUM(lpg.guessed_price::numeric * GREATEST(u.karma, 1)::numeric)
          / NULLIF(SUM(GREATEST(u.karma, 1)::numeric), 0)
        )::bigint
      END AS canonical_fmv
    FROM latest_public_guesses lpg
    INNER JOIN users u ON u.id = lpg.user_id
    INNER JOIN properties p ON p.id = lpg.property_id
    WHERE lpg.is_meme_guess = FALSE
    GROUP BY lpg.property_id, p.official_valuation
  ),
  comment_facts AS MATERIALIZED (
    SELECT
      c.property_id,
      COUNT(*)::int AS count,
      COUNT(*) FILTER (WHERE c.created_at > NOW() - INTERVAL '7 days')::int AS recent_count,
      MAX(c.created_at) AS latest
    FROM comments c
    GROUP BY c.property_id
  ),
  property_like_facts AS MATERIALIZED (
    SELECT
      r.target_id AS property_id,
      COUNT(*)::int AS count,
      COUNT(*) FILTER (WHERE r.created_at > NOW() - INTERVAL '7 days')::int AS recent_count,
      MAX(r.created_at) AS latest
    FROM reactions r
    WHERE r.target_type = 'property'
      AND r.reaction_type = 'like'
    GROUP BY r.target_id
  ),
  comment_like_facts AS MATERIALIZED (
    SELECT
      c.property_id,
      COUNT(*)::int AS count,
      COUNT(*) FILTER (WHERE r.created_at > NOW() - INTERVAL '7 days')::int AS recent_count,
      MAX(r.created_at) AS latest
    FROM reactions r
    INNER JOIN comments c ON c.id = r.target_id
    WHERE r.target_type = 'comment'
      AND r.reaction_type = 'like'
    GROUP BY c.property_id
  ),
  guess_activity AS MATERIALIZED (
    SELECT
      lpg.property_id,
      COUNT(*)::int AS count,
      COUNT(*) FILTER (WHERE lpg.effective_at > NOW() - INTERVAL '7 days')::int AS recent_count,
      MAX(lpg.effective_at) AS latest
    FROM latest_public_guesses lpg
    GROUP BY lpg.property_id
  ),
  view_facts AS MATERIALIZED (
    SELECT
      pv.property_id,
      COUNT(DISTINCT COALESCE(pv.user_id::text, pv.session_id))::int AS unique_viewer_count,
      COUNT(DISTINCT COALESCE(pv.user_id::text, pv.session_id)) FILTER (
        WHERE pv.viewed_at > NOW() - INTERVAL '7 days'
      )::int AS recent_unique_viewer_count,
      MAX(pv.viewed_at) AS latest
    FROM property_views pv
    GROUP BY pv.property_id
  ),
  public_candidate_property_ids AS MATERIALIZED (
    SELECT property_id FROM listing_agg
    UNION
    SELECT property_id FROM comment_facts
    UNION
    SELECT property_id FROM property_like_facts
    UNION
    SELECT property_id FROM comment_like_facts
    UNION
    SELECT property_id FROM guess_activity
    UNION
    SELECT property_id FROM view_facts
  ),
  property_facts AS MATERIALIZED (
    SELECT
      p.id AS property_id,
      p.country_code,
      ST_Transform(p.geometry, 3857) AS geom_3857,
      ST_X(p.geometry) AS lon,
      ST_Y(p.geometry) AS lat,
      CONCAT_WS(
        ' ',
        p.street,
        CONCAT(p.house_number::text, COALESCE(NULLIF(BTRIM(p.house_number_addition), ''), ''))
      ) AS address,
      p.city,
      COALESCE(la.active_listing_count, 0)::int AS active_listing_count,
      COALESCE(la.completed_listing_count, 0)::int AS completed_listing_count,
      (
        COALESCE(cf.count, 0)
        + COALESCE(plf.count, 0)
        + COALESCE(clf.count, 0)
        + COALESCE(ga.count, 0)
        + COALESCE(vf.unique_viewer_count, 0)
      )::int AS social_count,
      (
        COALESCE(cf.recent_count, 0)
        + COALESCE(plf.recent_count, 0)
        + COALESCE(clf.recent_count, 0)
        + COALESCE(ga.recent_count, 0)
        + COALESCE(vf.recent_unique_viewer_count, 0)
      )::int AS recent_social_count,
      (
        COALESCE(cf.count, 0)::double precision
        + COALESCE(plf.count, 0)::double precision
        + COALESCE(clf.count, 0)::double precision * 0.8
        + COALESCE(ga.count, 0)::double precision * 0.85
        + COALESCE(vf.unique_viewer_count, 0)::double precision * 0.1
      )::real AS social_score_total,
      (
        COALESCE(cf.recent_count, 0)::double precision
        + COALESCE(plf.recent_count, 0)::double precision
        + COALESCE(clf.recent_count, 0)::double precision * 0.8
        + COALESCE(ga.recent_count, 0)::double precision * 0.85
        + COALESCE(vf.recent_unique_viewer_count, 0)::double precision * 0.1
      )::real AS recent_social_score_total,
      (
        COALESCE(cf.count, 0)
      )::int AS comment_count,
      la.asking_price,
      COALESCE(
        CASE
          WHEN COALESCE(la.active_listing_count, 0) > 0 AND la.active_price_type = 'sale'
            THEN la.asking_price
          ELSE NULL
        END,
        sh.last_sold_price,
        gf.canonical_fmv,
        p.official_valuation
      ) AS sale_effective_price,
      COALESCE(
        CASE
          WHEN COALESCE(la.active_listing_count, 0) > 0 AND la.active_price_type = 'rent'
            THEN la.asking_price
          ELSE NULL
        END,
        rh.last_rented_price
      ) AS rent_effective_price,
      la.thumbnail_url,
      COALESCE(la.active_listing_count, 0) > 0 AS has_active_listing,
      CASE
        WHEN COALESCE(la.active_listing_count, 0) > 0 AND la.active_price_type = 'rent'
          THEN 'for-rent'
        WHEN COALESCE(la.active_listing_count, 0) > 0
          THEN 'for-sale'
        WHEN la.latest_status = 'sold'
          THEN 'sold'
        WHEN la.latest_status = 'rented'
          THEN 'rented'
        ELSE 'not-listed'
      END AS market_state,
      GREATEST(cf.latest, plf.latest, clf.latest, ga.latest, vf.latest) AS last_social_at
    FROM public_candidate_property_ids pc
    INNER JOIN properties p ON p.id = pc.property_id
    LEFT JOIN listing_agg la ON la.property_id = p.id
    LEFT JOIN sold_history sh ON sh.property_id = p.id
    LEFT JOIN rented_history rh ON rh.property_id = p.id
    LEFT JOIN guess_facts gf ON gf.property_id = p.id
    LEFT JOIN comment_facts cf ON cf.property_id = p.id
    LEFT JOIN property_like_facts plf ON plf.property_id = p.id
    LEFT JOIN comment_like_facts clf ON clf.property_id = p.id
    LEFT JOIN guess_activity ga ON ga.property_id = p.id
    LEFT JOIN view_facts vf ON vf.property_id = p.id
    WHERE p.status = 'active'
      AND p.geometry IS NOT NULL
  )
  INSERT INTO map_public_property_facts (
    property_id,
    country_code,
    geom_3857,
    lon,
    lat,
    address,
    city,
    active_listing_count,
    completed_listing_count,
    social_count,
    recent_social_count,
    social_score_total,
    social_score_max,
    recent_social_score_total,
    comment_count,
    asking_price,
    sale_effective_price,
    rent_effective_price,
    thumbnail_url,
    has_active_listing,
    market_state,
    last_social_at,
    updated_at
  )
  SELECT
    property_id,
    country_code,
    geom_3857,
    lon,
    lat,
    address,
    city,
    active_listing_count,
    completed_listing_count,
    social_count,
    recent_social_count,
    social_score_total,
    social_score_total,
    recent_social_score_total,
    comment_count,
    asking_price,
    sale_effective_price,
    rent_effective_price,
    thumbnail_url,
    has_active_listing,
    market_state,
    last_social_at,
    NOW()
  FROM property_facts
  WHERE active_listing_count > 0
    OR completed_listing_count > 0
    OR social_score_total >= 0.75;

  INSERT INTO map_public_property_bucket_members (zoom, bucket_x, bucket_y, property_id)
  SELECT
    z.zoom,
    FLOOR((ST_X(f.geom_3857) + world_half) / ((world_width / POWER(2.0, z.zoom)) / 16.0))::integer,
    FLOOR((world_half - ST_Y(f.geom_3857)) / ((world_width / POWER(2.0, z.zoom)) / 16.0))::integer,
    f.property_id
  FROM map_public_property_facts f
  CROSS JOIN generate_series(normalized_min_zoom, normalized_max_zoom) AS z(zoom);

  WITH latest_public_guesses AS MATERIALIZED (
    SELECT DISTINCT ON (pg.property_id, pg.user_id)
      pg.property_id,
      pg.user_id,
      GREATEST(pg.created_at, pg.updated_at) AS effective_at
    FROM price_guesses pg
    WHERE pg.is_meme_guess = FALSE
    ORDER BY
      pg.property_id,
      pg.user_id,
      GREATEST(pg.created_at, pg.updated_at) DESC,
      pg.created_at DESC,
      pg.id DESC
  )
  INSERT INTO map_property_actor_activity (
    property_id,
    actor_user_id,
    activity_kind,
    activity_at,
    score,
    geom_3857
  )
  SELECT c.property_id, c.user_id, 'comment', c.created_at, 1.0::real, ST_Transform(p.geometry, 3857)
  FROM comments c
  INNER JOIN properties p ON p.id = c.property_id
  WHERE p.geometry IS NOT NULL
  UNION ALL
  SELECT r.target_id, r.user_id, 'property_like', r.created_at, 1.0::real, ST_Transform(p.geometry, 3857)
  FROM reactions r
  INNER JOIN properties p ON p.id = r.target_id
  WHERE r.target_type = 'property'
    AND r.reaction_type = 'like'
    AND p.geometry IS NOT NULL
  UNION ALL
  SELECT lpg.property_id, lpg.user_id, 'price_guess', lpg.effective_at, 0.85::real, ST_Transform(p.geometry, 3857)
  FROM latest_public_guesses lpg
  INNER JOIN properties p ON p.id = lpg.property_id
  WHERE p.geometry IS NOT NULL;

  ANALYZE map_public_property_facts;
  ANALYZE map_public_property_bucket_members;
  ANALYZE map_property_actor_activity;

  RETURN QUERY SELECT 'map_public_property_facts'::text, COUNT(*)::bigint FROM map_public_property_facts;
  RETURN QUERY SELECT 'map_public_property_bucket_members'::text, COUNT(*)::bigint FROM map_public_property_bucket_members;
  RETURN QUERY SELECT 'map_property_actor_activity'::text, COUNT(*)::bigint FROM map_property_actor_activity;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION martin_tiles.validate_map_projections()
RETURNS TABLE(check_name text, ok boolean, detail text)
LANGUAGE sql
STABLE
AS $$
  SELECT
    'map_public_property_facts_have_3857',
    NOT EXISTS (SELECT 1 FROM map_public_property_facts WHERE geom_3857 IS NULL),
    COUNT(*)::text
  FROM map_public_property_facts
  WHERE geom_3857 IS NULL
  UNION ALL
  SELECT
    'map_public_property_bucket_members_are_resolvable',
    NOT EXISTS (
      SELECT 1
      FROM map_public_property_bucket_members bm
      LEFT JOIN map_public_property_facts f ON f.property_id = bm.property_id
      WHERE f.property_id IS NULL
    ),
    COUNT(*)::text
  FROM map_public_property_bucket_members bm
  LEFT JOIN map_public_property_facts f ON f.property_id = bm.property_id
  WHERE f.property_id IS NULL
  UNION ALL
  SELECT
    'quiet_ghosts_are_tile_derived',
    pg_get_functiondef('martin_tiles.rebuild_map_projections(integer, integer)'::regprocedure) NOT ILIKE '%map_quiet_property_points%'
      AND pg_get_functiondef('martin_tiles.property_nodes(integer, integer, integer, json)'::regprocedure) NOT ILIKE '%map_quiet_property_points%',
    'public ghost nodes are derived from indexed properties at z17+'
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION martin_tiles.property_nodes(
  z integer,
  x integer,
  y integer,
  query_params json DEFAULT '{}'::json
) RETURNS bytea
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, martin_tiles, pg_temp
AS $$
  WITH params AS (
    SELECT
      martin_tiles.query_param_text_array(query_params, 'marketState') AS market_states,
      COALESCE(
        martin_tiles.query_param_float(query_params, 'salePriceFrom'),
        martin_tiles.query_param_float(query_params, 'priceFrom')
      ) AS sale_from,
      COALESCE(
        martin_tiles.query_param_float(query_params, 'salePriceTo'),
        martin_tiles.query_param_float(query_params, 'priceTo')
      ) AS sale_to,
      martin_tiles.query_param_float(query_params, 'rentPriceFrom') AS rent_from,
      martin_tiles.query_param_float(query_params, 'rentPriceTo') AS rent_to,
      lower(COALESCE(martin_tiles.query_param_text(query_params, 'activity'), 'all')) AS activity
  ),
  bounds AS (
    SELECT
      ST_TileEnvelope(z, x, y) AS geom,
      (ST_XMax(ST_TileEnvelope(z, x, y)) - ST_XMin(ST_TileEnvelope(z, x, y))) * 256.0 / 4096.0 AS margin
  ),
  filtered_facts AS MATERIALIZED (
    SELECT f.*
    FROM map_public_property_facts f
    CROSS JOIN bounds b
    CROSS JOIN params p
    WHERE f.geom_3857 && ST_Expand(b.geom, b.margin)
      AND (cardinality(p.market_states) = 0 OR f.market_state = ANY (p.market_states))
      AND martin_tiles.matches_market_price_filters(
        f.market_state,
        f.sale_effective_price::double precision,
        f.rent_effective_price::double precision,
        p.sale_from,
        p.sale_to,
        p.rent_from,
        p.rent_to
      )
      AND CASE
        WHEN p.activity = 'today' THEN f.last_social_at > NOW() - INTERVAL '1 day'
        WHEN p.activity = '10d' THEN f.last_social_at > NOW() - INTERVAL '10 days'
        WHEN p.activity = '30d' THEN f.last_social_at > NOW() - INTERVAL '30 days'
        WHEN p.activity = 'recent' THEN f.last_social_at > NOW() - INTERVAL '7 days'
        WHEN p.activity = 'social' THEN f.social_score_total >= 0.75
        ELSE TRUE
      END
  ),
  bucket_nodes AS (
    SELECT
      ST_Centroid(ST_Collect(f.geom_3857)) AS node_geom,
      'active'::text AS node_class,
      CASE WHEN COUNT(*) > 1 THEN 'cluster' ELSE 'single' END AS group_kind,
      (ARRAY_AGG(f.property_id::text ORDER BY f.property_id::text))[1] AS primary_property_id,
      COUNT(*)::int AS point_count,
      STRING_AGG(f.property_id::text, ',' ORDER BY f.property_id::text) AS property_ids,
      ARRAY_TO_STRING((ARRAY_AGG(f.property_id::text ORDER BY f.property_id::text))[1:8], ',') AS preview_property_ids,
      ST_XMin((ST_Extent(ST_Transform(f.geom_3857, 4326)))::box3d) AS bbox_west,
      ST_YMin((ST_Extent(ST_Transform(f.geom_3857, 4326)))::box3d) AS bbox_south,
      ST_XMax((ST_Extent(ST_Transform(f.geom_3857, 4326)))::box3d) AS bbox_east,
      ST_YMax((ST_Extent(ST_Transform(f.geom_3857, 4326)))::box3d) AS bbox_north,
      SUM(f.active_listing_count)::int AS active_listing_count,
      SUM(f.completed_listing_count)::int AS completed_listing_count,
      SUM(f.social_count)::int AS social_count,
      SUM(f.recent_social_count)::int AS recent_social_count,
      SUM(f.social_score_total)::double precision AS social_score_total,
      MAX(f.social_score_max)::double precision AS social_score_max,
      SUM(f.recent_social_score_total)::double precision AS recent_social_score_total,
      SUM(f.comment_count)::int AS comment_count,
      CASE WHEN COUNT(*) = 1 THEN MAX(f.address) ELSE NULL END AS address,
      CASE WHEN COUNT(*) = 1 THEN MAX(f.city) ELSE NULL END AS city,
      CASE WHEN COUNT(*) = 1 THEN MAX(f.asking_price) ELSE NULL END AS asking_price,
      CASE WHEN COUNT(*) = 1 THEN MAX(f.thumbnail_url) ELSE NULL END AS thumbnail_url,
      CASE WHEN COUNT(*) = 1 THEN BOOL_OR(f.has_active_listing) ELSE NULL END AS has_active_listing,
      CASE WHEN COUNT(*) = 1 THEN MAX(f.market_state) ELSE NULL END AS market_state,
      CASE WHEN COUNT(*) = 1 THEN (ARRAY_AGG(f.property_id::text ORDER BY f.property_id::text))[1] ELSE NULL END AS id
    FROM map_public_property_bucket_members bm
    INNER JOIN filtered_facts f ON f.property_id = bm.property_id
    WHERE z <= 16
      AND bm.zoom = z
    GROUP BY bm.zoom, bm.bucket_x, bm.bucket_y
  ),
  single_nodes AS (
    SELECT
      f.geom_3857 AS node_geom,
      'active'::text AS node_class,
      'single'::text AS group_kind,
      f.property_id::text AS primary_property_id,
      1::int AS point_count,
      f.property_id::text AS property_ids,
      f.property_id::text AS preview_property_ids,
      NULL::double precision AS bbox_west,
      NULL::double precision AS bbox_south,
      NULL::double precision AS bbox_east,
      NULL::double precision AS bbox_north,
      f.active_listing_count,
      f.completed_listing_count,
      f.social_count,
      f.recent_social_count,
      f.social_score_total::double precision,
      f.social_score_max::double precision,
      f.recent_social_score_total::double precision,
      f.comment_count,
      f.address,
      f.city,
      f.asking_price,
      f.thumbnail_url,
      f.has_active_listing,
      f.market_state,
      f.property_id::text AS id
    FROM filtered_facts f
    WHERE z > 16
  ),
  quiet_seed AS MATERIALIZED (
    SELECT
      p.id AS property_id,
      ST_Transform(p.geometry, 3857) AS geom_3857,
      'not-listed'::varchar(20) AS market_state,
      p.official_valuation AS sale_effective_price,
      FLOOR(
        (ST_X(ST_Transform(p.geometry, 3857)) - ST_XMin(b.geom))
        / NULLIF(((ST_XMax(b.geom) - ST_XMin(b.geom)) / 512.0) * 44.0, 0)
      )::integer AS ghost_bucket_x,
      FLOOR(
        (ST_Y(ST_Transform(p.geometry, 3857)) - ST_YMin(b.geom))
        / NULLIF(((ST_YMax(b.geom) - ST_YMin(b.geom)) / 512.0) * 44.0, 0)
      )::integer AS ghost_bucket_y
    FROM properties p
    CROSS JOIN bounds b
    CROSS JOIN params params
    WHERE z >= 17
      AND p.status = 'active'
      AND p.geometry IS NOT NULL
      AND p.geometry && ST_Transform(ST_Expand(b.geom, b.margin), 4326)
      AND NOT EXISTS (
        SELECT 1
        FROM map_public_property_facts f
        WHERE f.property_id = p.id
      )
      AND (cardinality(params.market_states) = 0 OR 'not-listed' = ANY (params.market_states))
      AND martin_tiles.matches_market_price_filters(
        'not-listed',
        p.official_valuation::double precision,
        NULL::double precision,
        params.sale_from,
        params.sale_to,
        params.rent_from,
        params.rent_to
      )
      AND params.activity IN ('all', 'all-time')
  ),
  quiet_nodes AS (
    SELECT
      ST_Centroid(ST_Collect(q.geom_3857)) AS node_geom,
      'ghost'::text AS node_class,
      CASE WHEN COUNT(*) > 1 THEN 'cluster' ELSE 'single' END AS group_kind,
      (ARRAY_AGG(q.property_id::text ORDER BY q.property_id::text))[1] AS primary_property_id,
      COUNT(*)::int AS point_count,
      STRING_AGG(q.property_id::text, ',' ORDER BY q.property_id::text) AS property_ids,
      ARRAY_TO_STRING((ARRAY_AGG(q.property_id::text ORDER BY q.property_id::text))[1:8], ',') AS preview_property_ids,
      CASE WHEN COUNT(*) > 1 THEN ST_XMin((ST_Extent(ST_Transform(q.geom_3857, 4326)))::box3d) ELSE NULL END AS bbox_west,
      CASE WHEN COUNT(*) > 1 THEN ST_YMin((ST_Extent(ST_Transform(q.geom_3857, 4326)))::box3d) ELSE NULL END AS bbox_south,
      CASE WHEN COUNT(*) > 1 THEN ST_XMax((ST_Extent(ST_Transform(q.geom_3857, 4326)))::box3d) ELSE NULL END AS bbox_east,
      CASE WHEN COUNT(*) > 1 THEN ST_YMax((ST_Extent(ST_Transform(q.geom_3857, 4326)))::box3d) ELSE NULL END AS bbox_north,
      0::int AS active_listing_count,
      0::int AS completed_listing_count,
      0::int AS social_count,
      0::int AS recent_social_count,
      0::double precision AS social_score_total,
      0::double precision AS social_score_max,
      0::double precision AS recent_social_score_total,
      0::int AS comment_count,
      NULL::text AS address,
      NULL::varchar(100) AS city,
      NULL::bigint AS asking_price,
      NULL::text AS thumbnail_url,
      false AS has_active_listing,
      CASE WHEN COUNT(*) = 1 THEN MAX(q.market_state) ELSE NULL END AS market_state,
      CASE WHEN COUNT(*) = 1 THEN (ARRAY_AGG(q.property_id::text ORDER BY q.property_id::text))[1] ELSE NULL END AS id
    FROM quiet_seed q
    GROUP BY q.ghost_bucket_x, q.ghost_bucket_y
  ),
  nodes AS (
    SELECT * FROM bucket_nodes
    UNION ALL SELECT * FROM single_nodes
    UNION ALL SELECT * FROM quiet_nodes
  ),
  mvt_data AS (
    SELECT
      ST_AsMVTGeom(n.node_geom, b.geom, 4096, 256, true) AS geom,
      n.node_class,
      n.group_kind,
      n.primary_property_id,
      n.point_count,
      n.property_ids,
      n.preview_property_ids,
      n.bbox_west,
      n.bbox_south,
      n.bbox_east,
      n.bbox_north,
      n.active_listing_count AS "activeListingCount",
      n.completed_listing_count AS "completedListingCount",
      n.social_count AS "socialCount",
      n.recent_social_count AS "recentSocialCount",
      n.social_score_total AS "socialScoreTotal",
      n.social_score_max AS "socialScoreMax",
      n.recent_social_score_total AS "recentSocialScoreTotal",
      n.comment_count AS "commentCount",
      n.address,
      n.city,
      n.asking_price AS "askingPrice",
      n.thumbnail_url AS "thumbnailUrl",
      n.has_active_listing AS "hasActiveListing",
      n.market_state AS "marketState",
      n.id
    FROM nodes n
    CROSS JOIN bounds b
  )
  SELECT COALESCE(ST_AsMVT(mvt_data, 'properties', 4096, 'geom'), '\x'::bytea)
  FROM mvt_data
  WHERE geom IS NOT NULL
$$;--> statement-breakpoint
