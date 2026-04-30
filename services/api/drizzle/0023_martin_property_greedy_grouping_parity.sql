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
  tile_params AS (
    SELECT
      40075016.68557849::double precision AS world_width,
      20037508.342789244::double precision AS world_half,
      power(2.0, z)::double precision AS tile_count
  ),
  bounds AS (
    SELECT
      ST_TileEnvelope(z, x, y) AS geom,
      (ST_XMax(ST_TileEnvelope(z, x, y)) - ST_XMin(ST_TileEnvelope(z, x, y))) * 544.0 / 4096.0 AS grouping_margin,
      (ST_XMax(ST_TileEnvelope(z, x, y)) - ST_XMin(ST_TileEnvelope(z, x, y))) * 256.0 / 4096.0 AS render_margin
  ),
  filtered_facts AS MATERIALIZED (
    SELECT f.*
    FROM map_public_property_facts f
    CROSS JOIN bounds b
    CROSS JOIN params p
    WHERE z >= 8
      AND f.geom_3857 && ST_Expand(b.geom, b.grouping_margin)
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
  active_candidates AS MATERIALIZED (
    SELECT
      ROW_NUMBER() OVER (
        ORDER BY
          f.social_score_total DESC,
          f.has_active_listing DESC,
          (f.completed_listing_count > 0) DESC,
          f.comment_count DESC,
          f.property_id::text
      )::integer AS priority_rank,
      f.*,
      (((ST_X(f.geom_3857) + tp.world_half) / tp.world_width) * tp.tile_count * 4096.0) AS world_x_units,
      (((tp.world_half - ST_Y(f.geom_3857)) / tp.world_width) * tp.tile_count * 4096.0) AS world_y_units,
      FLOOR(((((ST_X(f.geom_3857) + tp.world_half) / tp.world_width) * tp.tile_count * 4096.0) / 208.0))::integer AS cell_x,
      FLOOR(((((tp.world_half - ST_Y(f.geom_3857)) / tp.world_width) * tp.tile_count * 4096.0) / 208.0))::integer AS cell_y
    FROM filtered_facts f
    CROSS JOIN tile_params tp
    WHERE z <= 16
  ),
  root_seed_candidates AS MATERIALIZED (
    SELECT c.*
    FROM active_candidates c
    WHERE NOT EXISTS (
      SELECT 1
      FROM active_candidates higher
      WHERE higher.priority_rank < c.priority_rank
        AND higher.cell_x BETWEEN c.cell_x - 1 AND c.cell_x + 1
        AND higher.cell_y BETWEEN c.cell_y - 1 AND c.cell_y + 1
        AND higher.world_x_units BETWEEN c.world_x_units - 208.0 AND c.world_x_units + 208.0
        AND higher.world_y_units BETWEEN c.world_y_units - 208.0 AND c.world_y_units + 208.0
        AND (
          ((higher.world_x_units - c.world_x_units) * (higher.world_x_units - c.world_x_units))
          + ((higher.world_y_units - c.world_y_units) * (higher.world_y_units - c.world_y_units))
        ) <= (208.0 * 208.0)
    )
  ),
  seed_matches AS (
    SELECT DISTINCT ON (f.property_id)
      f.property_id,
      s.property_id AS seed_property_id
    FROM active_candidates f
    INNER JOIN root_seed_candidates s
      ON s.cell_x BETWEEN f.cell_x - 1 AND f.cell_x + 1
      AND s.cell_y BETWEEN f.cell_y - 1 AND f.cell_y + 1
      AND s.world_x_units BETWEEN f.world_x_units - 208.0 AND f.world_x_units + 208.0
      AND s.world_y_units BETWEEN f.world_y_units - 208.0 AND f.world_y_units + 208.0
      AND (
        ((s.world_x_units - f.world_x_units) * (s.world_x_units - f.world_x_units))
        + ((s.world_y_units - f.world_y_units) * (s.world_y_units - f.world_y_units))
      ) <= (208.0 * 208.0)
    ORDER BY f.property_id, s.priority_rank
  ),
  cluster_members AS (
    SELECT
      COALESCE(seed_matches.seed_property_id, f.property_id) AS seed_property_id,
      f.*
    FROM active_candidates f
    LEFT JOIN seed_matches ON seed_matches.property_id = f.property_id
  ),
  active_groups AS (
    SELECT
      cm.seed_property_id,
      COUNT(*)::int AS point_count,
      STRING_AGG(
        cm.property_id::text,
        ','
        ORDER BY
          cm.social_score_total DESC,
          cm.has_active_listing DESC,
          (cm.completed_listing_count > 0) DESC,
          cm.comment_count DESC,
          cm.property_id::text
      ) AS property_ids,
      ARRAY_TO_STRING(
        (ARRAY_AGG(
          cm.property_id::text
          ORDER BY
            cm.social_score_total DESC,
            cm.has_active_listing DESC,
            (cm.completed_listing_count > 0) DESC,
            cm.comment_count DESC,
            cm.property_id::text
        ))[1:8],
        ','
      ) AS preview_property_ids,
      AVG(cm.world_x_units) AS center_world_x_units,
      AVG(cm.world_y_units) AS center_world_y_units,
      CASE WHEN COUNT(*) > 1 THEN ST_XMin((ST_Extent(ST_Transform(cm.geom_3857, 4326)))::box3d) ELSE NULL END AS bbox_west,
      CASE WHEN COUNT(*) > 1 THEN ST_YMin((ST_Extent(ST_Transform(cm.geom_3857, 4326)))::box3d) ELSE NULL END AS bbox_south,
      CASE WHEN COUNT(*) > 1 THEN ST_XMax((ST_Extent(ST_Transform(cm.geom_3857, 4326)))::box3d) ELSE NULL END AS bbox_east,
      CASE WHEN COUNT(*) > 1 THEN ST_YMax((ST_Extent(ST_Transform(cm.geom_3857, 4326)))::box3d) ELSE NULL END AS bbox_north,
      SUM(cm.active_listing_count)::int AS active_listing_count,
      SUM(cm.completed_listing_count)::int AS completed_listing_count,
      SUM(cm.social_count)::int AS social_count,
      SUM(cm.recent_social_count)::int AS recent_social_count,
      SUM(cm.social_score_total)::double precision AS social_score_total,
      MAX(cm.social_score_max)::double precision AS social_score_max,
      SUM(cm.recent_social_score_total)::double precision AS recent_social_score_total,
      SUM(cm.comment_count)::int AS comment_count
    FROM cluster_members cm
    GROUP BY cm.seed_property_id
  ),
  bucket_nodes AS (
    SELECT
      representative.geom_3857 AS node_geom,
      'active'::text AS node_class,
      CASE WHEN ag.point_count > 1 THEN 'cluster' ELSE 'single' END AS group_kind,
      representative.property_id::text AS primary_property_id,
      ag.point_count,
      ag.property_ids,
      ag.preview_property_ids,
      ag.bbox_west,
      ag.bbox_south,
      ag.bbox_east,
      ag.bbox_north,
      ag.active_listing_count,
      ag.completed_listing_count,
      ag.social_count,
      ag.recent_social_count,
      ag.social_score_total,
      ag.social_score_max,
      ag.recent_social_score_total,
      ag.comment_count,
      CASE WHEN ag.point_count = 1 THEN representative.address ELSE NULL END AS address,
      CASE WHEN ag.point_count = 1 THEN representative.city ELSE NULL END AS city,
      CASE WHEN ag.point_count = 1 THEN representative.asking_price ELSE NULL END AS asking_price,
      CASE WHEN ag.point_count = 1 THEN representative.thumbnail_url ELSE NULL END AS thumbnail_url,
      CASE WHEN ag.point_count = 1 THEN representative.has_active_listing ELSE NULL END AS has_active_listing,
      CASE WHEN ag.point_count = 1 THEN representative.market_state ELSE NULL END AS market_state,
      CASE WHEN ag.point_count = 1 THEN representative.property_id::text ELSE NULL END AS id
    FROM active_groups ag
    CROSS JOIN LATERAL (
      SELECT f.*
      FROM cluster_members f
      WHERE f.seed_property_id = ag.seed_property_id
      ORDER BY
        (
          SQRT(
            ((f.world_x_units - ag.center_world_x_units) * (f.world_x_units - ag.center_world_x_units))
            + ((f.world_y_units - ag.center_world_y_units) * (f.world_y_units - ag.center_world_y_units))
          ) * 1000.0
        ) + f.priority_rank,
        f.social_score_total DESC,
        f.has_active_listing DESC,
        (f.completed_listing_count > 0) DESC,
        f.comment_count DESC,
        f.property_id::text
      LIMIT 1
    ) representative
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
      AND p.geometry && ST_Transform(ST_Expand(b.geom, b.render_margin), 4326)
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
  quiet_groups AS (
    SELECT
      q.ghost_bucket_x,
      q.ghost_bucket_y,
      COUNT(*)::int AS point_count,
      STRING_AGG(q.property_id::text, ',' ORDER BY q.property_id::text) AS property_ids,
      ARRAY_TO_STRING((ARRAY_AGG(q.property_id::text ORDER BY q.property_id::text))[1:8], ',') AS preview_property_ids,
      ST_X( ST_Centroid(ST_Collect(q.geom_3857)) ) AS center_x,
      ST_Y( ST_Centroid(ST_Collect(q.geom_3857)) ) AS center_y,
      CASE WHEN COUNT(*) > 1 THEN ST_XMin((ST_Extent(ST_Transform(q.geom_3857, 4326)))::box3d) ELSE NULL END AS bbox_west,
      CASE WHEN COUNT(*) > 1 THEN ST_YMin((ST_Extent(ST_Transform(q.geom_3857, 4326)))::box3d) ELSE NULL END AS bbox_south,
      CASE WHEN COUNT(*) > 1 THEN ST_XMax((ST_Extent(ST_Transform(q.geom_3857, 4326)))::box3d) ELSE NULL END AS bbox_east,
      CASE WHEN COUNT(*) > 1 THEN ST_YMax((ST_Extent(ST_Transform(q.geom_3857, 4326)))::box3d) ELSE NULL END AS bbox_north
    FROM quiet_seed q
    GROUP BY q.ghost_bucket_x, q.ghost_bucket_y
  ),
  quiet_nodes AS (
    SELECT
      representative.geom_3857 AS node_geom,
      'ghost'::text AS node_class,
      CASE WHEN qg.point_count > 1 THEN 'cluster' ELSE 'single' END AS group_kind,
      representative.property_id::text AS primary_property_id,
      qg.point_count,
      qg.property_ids,
      qg.preview_property_ids,
      qg.bbox_west,
      qg.bbox_south,
      qg.bbox_east,
      qg.bbox_north,
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
      CASE WHEN qg.point_count = 1 THEN representative.market_state ELSE NULL END AS market_state,
      CASE WHEN qg.point_count = 1 THEN representative.property_id::text ELSE NULL END AS id
    FROM quiet_groups qg
    CROSS JOIN LATERAL (
      SELECT q.*
      FROM quiet_seed q
      WHERE q.ghost_bucket_x = qg.ghost_bucket_x
        AND q.ghost_bucket_y = qg.ghost_bucket_y
      ORDER BY
        ST_Distance(q.geom_3857, ST_SetSRID(ST_MakePoint(qg.center_x, qg.center_y), 3857)),
        q.property_id::text
      LIMIT 1
    ) representative
  ),
  nodes AS (
    SELECT * FROM bucket_nodes
    UNION ALL SELECT * FROM single_nodes
    UNION ALL SELECT * FROM quiet_nodes
  ),
  owned_nodes AS (
    SELECT
      n.*,
      GREATEST(
        0,
        LEAST(
          (tp.tile_count::integer - 1),
          FLOOR(((ST_X(n.node_geom) + tp.world_half) / tp.world_width) * tp.tile_count)::integer
        )
      ) AS owner_x,
      GREATEST(
        0,
        LEAST(
          (tp.tile_count::integer - 1),
          FLOOR(((tp.world_half - ST_Y(n.node_geom)) / tp.world_width) * tp.tile_count)::integer
        )
      ) AS owner_y
    FROM nodes n
    CROSS JOIN tile_params tp
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
    FROM owned_nodes n
    CROSS JOIN bounds b
    WHERE n.owner_x = x
      AND n.owner_y = y
  )
  SELECT COALESCE(ST_AsMVT(mvt_data, 'properties', 4096, 'geom'), '\x'::bytea)
  FROM mvt_data
  WHERE geom IS NOT NULL
$$;--> statement-breakpoint
