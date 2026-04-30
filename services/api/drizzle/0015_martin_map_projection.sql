CREATE SCHEMA IF NOT EXISTS martin_tiles;--> statement-breakpoint

CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint

ALTER TABLE "osm_buildings"
  ADD COLUMN IF NOT EXISTS "country_code" varchar(2) DEFAULT 'NL' NOT NULL;--> statement-breakpoint

DROP INDEX IF EXISTS "osm_buildings_osm_id_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "osm_buildings_country_osm_id_idx"
  ON "osm_buildings" USING btree ("country_code", "osm_id")
  WHERE "osm_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_osm_buildings_country"
  ON "osm_buildings" USING btree ("country_code");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "map_public_property_facts" (
  "property_id" uuid PRIMARY KEY REFERENCES "properties"("id") ON DELETE cascade,
  "country_code" varchar(2) NOT NULL,
  "geom_3857" geometry(Point, 3857) NOT NULL,
  "lon" double precision NOT NULL,
  "lat" double precision NOT NULL,
  "address" text,
  "city" varchar(100),
  "active_listing_count" integer DEFAULT 0 NOT NULL,
  "completed_listing_count" integer DEFAULT 0 NOT NULL,
  "social_count" integer DEFAULT 0 NOT NULL,
  "recent_social_count" integer DEFAULT 0 NOT NULL,
  "social_score_total" real DEFAULT 0 NOT NULL,
  "social_score_max" real DEFAULT 0 NOT NULL,
  "recent_social_score_total" real DEFAULT 0 NOT NULL,
  "comment_count" integer DEFAULT 0 NOT NULL,
  "asking_price" bigint,
  "sale_effective_price" bigint,
  "rent_effective_price" bigint,
  "thumbnail_url" text,
  "has_active_listing" boolean DEFAULT false NOT NULL,
  "market_state" varchar(20) DEFAULT 'not-listed' NOT NULL,
  "last_social_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "map_public_property_facts_country_idx"
  ON "map_public_property_facts" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "map_public_property_facts_market_idx"
  ON "map_public_property_facts" USING btree ("market_state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "map_public_property_facts_geom_3857_idx"
  ON "map_public_property_facts" USING gist ("geom_3857");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "map_public_property_facts_last_social_idx"
  ON "map_public_property_facts" USING btree ("last_social_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "map_quiet_property_points" (
  "property_id" uuid PRIMARY KEY REFERENCES "properties"("id") ON DELETE cascade,
  "country_code" varchar(2) NOT NULL,
  "geom_3857" geometry(Point, 3857) NOT NULL,
  "lon" double precision NOT NULL,
  "lat" double precision NOT NULL,
  "market_state" varchar(20) DEFAULT 'not-listed' NOT NULL,
  "sale_effective_price" bigint,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "map_quiet_property_points_country_idx"
  ON "map_quiet_property_points" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "map_quiet_property_points_market_idx"
  ON "map_quiet_property_points" USING btree ("market_state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "map_quiet_property_points_geom_3857_idx"
  ON "map_quiet_property_points" USING gist ("geom_3857");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "map_public_property_bucket_members" (
  "zoom" integer NOT NULL,
  "bucket_x" integer NOT NULL,
  "bucket_y" integer NOT NULL,
  "property_id" uuid NOT NULL REFERENCES "properties"("id") ON DELETE cascade,
  PRIMARY KEY ("zoom", "bucket_x", "bucket_y", "property_id")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "map_public_property_bucket_lookup_idx"
  ON "map_public_property_bucket_members" USING btree ("zoom", "bucket_x", "bucket_y");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "map_public_property_bucket_property_idx"
  ON "map_public_property_bucket_members" USING btree ("property_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "map_property_actor_activity" (
  "property_id" uuid NOT NULL REFERENCES "properties"("id") ON DELETE cascade,
  "actor_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "activity_kind" varchar(30) NOT NULL,
  "activity_at" timestamp with time zone NOT NULL,
  "score" real NOT NULL,
  "geom_3857" geometry(Point, 3857) NOT NULL,
  PRIMARY KEY ("property_id", "actor_user_id", "activity_kind", "activity_at")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "map_property_actor_activity_actor_idx"
  ON "map_property_actor_activity" USING btree ("actor_user_id", "activity_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "map_property_actor_activity_property_idx"
  ON "map_property_actor_activity" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "map_property_actor_activity_geom_3857_idx"
  ON "map_property_actor_activity" USING gist ("geom_3857");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "landcover" (
  "id" serial PRIMARY KEY,
  "osm_id" bigint,
  "type" varchar(50) NOT NULL,
  "geometry" geometry(MultiPolygon, 4326) NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_landcover_geometry"
  ON "landcover" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_landcover_type"
  ON "landcover" USING btree ("type");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tall_buildings" (
  "id" serial PRIMARY KEY,
  "osm_id" bigint,
  "height" real NOT NULL,
  "geometry" geometry(MultiPolygon, 4326) NOT NULL,
  "exclusion_geom" geometry(MultiPolygon, 4326) NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_tall_buildings_exclusion"
  ON "tall_buildings" USING gist ("exclusion_geom");--> statement-breakpoint

CREATE OR REPLACE FUNCTION martin_tiles.query_param_text(
  query_params json,
  param_name text,
  fallback text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  raw_value json;
  normalized text;
BEGIN
  raw_value := COALESCE(query_params, '{}'::json) -> param_name;

  IF raw_value IS NULL OR raw_value::text = 'null' THEN
    RETURN fallback;
  END IF;

  IF json_typeof(raw_value) = 'array' THEN
    raw_value := raw_value -> 0;
    IF raw_value IS NULL OR raw_value::text = 'null' THEN
      RETURN fallback;
    END IF;
  END IF;

  normalized := NULLIF(BTRIM(raw_value #>> '{}'), '');
  RETURN COALESCE(normalized, fallback);
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION martin_tiles.query_param_text_array(
  query_params json,
  param_name text
) RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT NULLIF(BTRIM(value), '')
      FROM regexp_split_to_table(
        COALESCE(martin_tiles.query_param_text(query_params, param_name), ''),
        '\s*,\s*'
      ) AS value
      WHERE NULLIF(BTRIM(value), '') IS NOT NULL
    ),
    ARRAY[]::text[]
  )
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION martin_tiles.query_param_uuid(
  query_params json,
  param_name text
) RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  raw_value text;
BEGIN
  raw_value := martin_tiles.query_param_text(query_params, param_name);
  IF raw_value IS NULL OR raw_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN raw_value::uuid;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION martin_tiles.query_param_float(
  query_params json,
  param_name text
) RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  raw_value text;
BEGIN
  raw_value := martin_tiles.query_param_text(query_params, param_name);
  IF raw_value IS NULL OR raw_value !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
    RETURN NULL;
  END IF;
  RETURN raw_value::double precision;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION martin_tiles.matches_market_price_filters(
  market_state text,
  sale_effective_price double precision,
  rent_effective_price double precision,
  sale_from double precision,
  sale_to double precision,
  rent_from double precision,
  rent_to double precision
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    (
      sale_from IS NULL
      OR market_state IN ('for-rent', 'rented')
      OR (
        market_state IN ('for-sale', 'sold', 'not-listed')
        AND sale_effective_price >= sale_from
      )
    )
    AND (
      sale_to IS NULL
      OR market_state IN ('for-rent', 'rented')
      OR (
        market_state IN ('for-sale', 'sold', 'not-listed')
        AND sale_effective_price <= sale_to
      )
    )
    AND (
      rent_from IS NULL
      OR market_state IN ('for-sale', 'sold', 'not-listed')
      OR (
        market_state IN ('for-rent', 'rented')
        AND rent_effective_price >= rent_from
      )
    )
    AND (
      rent_to IS NULL
      OR market_state IN ('for-sale', 'sold', 'not-listed')
      OR (
        market_state IN ('for-rent', 'rented')
        AND rent_effective_price <= rent_to
      )
    )
$$;--> statement-breakpoint

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
    map_quiet_property_points,
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
  ANALYZE map_quiet_property_points;
  ANALYZE map_public_property_bucket_members;
  ANALYZE map_property_actor_activity;

  RETURN QUERY SELECT 'map_public_property_facts'::text, COUNT(*)::bigint FROM map_public_property_facts;
  RETURN QUERY SELECT 'map_quiet_property_points'::text, COUNT(*)::bigint FROM map_quiet_property_points;
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
  quiet_nodes AS (
    SELECT
      q.geom_3857 AS node_geom,
      'ghost'::text AS node_class,
      'single'::text AS group_kind,
      q.property_id::text AS primary_property_id,
      1::int AS point_count,
      q.property_id::text AS property_ids,
      q.property_id::text AS preview_property_ids,
      NULL::double precision AS bbox_west,
      NULL::double precision AS bbox_south,
      NULL::double precision AS bbox_east,
      NULL::double precision AS bbox_north,
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
      q.market_state,
      q.property_id::text AS id
    FROM map_quiet_property_points q
    CROSS JOIN bounds b
    CROSS JOIN params p
    WHERE z >= 17
      AND q.geom_3857 && ST_Expand(b.geom, b.margin)
      AND (cardinality(p.market_states) = 0 OR q.market_state = ANY (p.market_states))
      AND martin_tiles.matches_market_price_filters(
        q.market_state,
        q.sale_effective_price::double precision,
        NULL::double precision,
        p.sale_from,
        p.sale_to,
        p.rent_from,
        p.rent_to
      )
      AND p.activity IN ('all', 'all-time')
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

CREATE OR REPLACE FUNCTION martin_tiles.read_property_nodes(
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
      COALESCE(
        martin_tiles.query_param_uuid(query_params, 'userId'),
        martin_tiles.query_param_uuid(query_params, 'user_id'),
        martin_tiles.query_param_uuid(query_params, 'viewerId'),
        martin_tiles.query_param_uuid(query_params, 'viewer_id')
      ) AS user_id,
      COALESCE(
        martin_tiles.query_param_text(query_params, 'sessionId'),
        martin_tiles.query_param_text(query_params, 'session_id'),
        martin_tiles.query_param_text(query_params, 'anonymousSessionId'),
        martin_tiles.query_param_text(query_params, 'anonymous_session_id')
      ) AS session_id,
      martin_tiles.query_param_text(query_params, 'read_version') AS read_version,
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
  active_members AS MATERIALIZED (
    SELECT
      f.*,
      (
        prs.seen_change_version >= COALESCE(pcs.change_version, 0)
      ) AS is_read
    FROM map_public_property_facts f
    CROSS JOIN bounds b
    CROSS JOIN params p
    LEFT JOIN property_change_state pcs ON pcs.property_id = f.property_id
    LEFT JOIN property_read_state prs
      ON prs.property_id = f.property_id
     AND (
       (p.user_id IS NOT NULL AND prs.user_id = p.user_id AND prs.session_id IS NULL)
       OR (
         p.user_id IS NULL
         AND p.session_id IS NOT NULL
         AND prs.session_id = p.session_id
         AND prs.user_id IS NULL
       )
     )
    WHERE p.read_version IS NOT NULL
      AND (p.user_id IS NOT NULL OR p.session_id IS NOT NULL)
      AND f.geom_3857 && ST_Expand(b.geom, b.margin)
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
    INNER JOIN active_members f ON f.property_id = bm.property_id
    WHERE z <= 16
      AND bm.zoom = z
    GROUP BY bm.zoom, bm.bucket_x, bm.bucket_y
    HAVING BOOL_AND(f.is_read)
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
    FROM active_members f
    WHERE z > 16
      AND f.is_read
  ),
  quiet_nodes AS (
    SELECT
      ST_Transform(prop.geometry, 3857) AS node_geom,
      'ghost'::text AS node_class,
      'single'::text AS group_kind,
      prop.id::text AS primary_property_id,
      1::int AS point_count,
      prop.id::text AS property_ids,
      prop.id::text AS preview_property_ids,
      NULL::double precision AS bbox_west,
      NULL::double precision AS bbox_south,
      NULL::double precision AS bbox_east,
      NULL::double precision AS bbox_north,
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
      'not-listed'::varchar(20) AS market_state,
      prop.id::text AS id
    FROM property_read_state prs
    INNER JOIN properties prop ON prop.id = prs.property_id
    CROSS JOIN bounds b
    CROSS JOIN params p
    LEFT JOIN property_change_state pcs ON pcs.property_id = prop.id
    LEFT JOIN map_public_property_facts f ON f.property_id = prop.id
    WHERE z > 16
      AND p.read_version IS NOT NULL
      AND (p.user_id IS NOT NULL OR p.session_id IS NOT NULL)
      AND (
        (p.user_id IS NOT NULL AND prs.user_id = p.user_id AND prs.session_id IS NULL)
        OR (
          p.user_id IS NULL
          AND p.session_id IS NOT NULL
          AND prs.session_id = p.session_id
          AND prs.user_id IS NULL
        )
      )
      AND prop.status = 'active'
      AND prop.geometry IS NOT NULL
      AND prop.geometry && ST_Transform(ST_Expand(b.geom, b.margin), 4326)
      AND f.property_id IS NULL
      AND prs.seen_change_version >= COALESCE(pcs.change_version, 0)
      AND (cardinality(p.market_states) = 0 OR 'not-listed' = ANY (p.market_states))
      AND martin_tiles.matches_market_price_filters(
        'not-listed',
        prop.official_valuation::double precision,
        NULL::double precision,
        p.sale_from,
        p.sale_to,
        p.rent_from,
        p.rent_to
      )
      AND p.activity IN ('all', 'all-time')
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

CREATE OR REPLACE FUNCTION martin_tiles.following_property_nodes(
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
      COALESCE(
        martin_tiles.query_param_uuid(query_params, 'userId'),
        martin_tiles.query_param_uuid(query_params, 'user_id'),
        martin_tiles.query_param_uuid(query_params, 'viewerId'),
        martin_tiles.query_param_uuid(query_params, 'viewer_id')
      ) AS viewer_id,
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
      lower(COALESCE(martin_tiles.query_param_text(query_params, 'activity'), 'all')) AS activity,
      martin_tiles.query_param_text(query_params, 'follow_version') AS follow_version
  ),
  bounds AS (
    SELECT
      ST_TileEnvelope(z, x, y) AS geom,
      (ST_XMax(ST_TileEnvelope(z, x, y)) - ST_XMin(ST_TileEnvelope(z, x, y))) * 256.0 / 4096.0 AS margin
  ),
  following_activity AS MATERIALIZED (
    SELECT
      a.property_id,
      COUNT(*)::int AS social_count,
      COUNT(*) FILTER (WHERE a.activity_at > NOW() - INTERVAL '7 days')::int AS recent_social_count,
      SUM(a.score)::double precision AS social_score_total,
      MAX(a.score)::double precision AS social_score_max,
      SUM(a.score) FILTER (WHERE a.activity_at > NOW() - INTERVAL '7 days')::double precision AS recent_social_score_total,
      MAX(a.activity_at) AS last_social_at
    FROM params p
    INNER JOIN user_follows uf ON uf.follower_user_id = p.viewer_id
    INNER JOIN map_property_actor_activity a ON a.actor_user_id = uf.followed_user_id
    CROSS JOIN bounds b
    WHERE p.viewer_id IS NOT NULL
      AND p.follow_version IS NOT NULL
      AND a.geom_3857 && ST_Expand(b.geom, b.margin)
    GROUP BY a.property_id
  ),
  filtered_facts AS MATERIALIZED (
    SELECT
      f.*,
      fa.social_count AS following_social_count,
      fa.recent_social_count AS following_recent_social_count,
      fa.social_score_total AS following_social_score_total,
      fa.social_score_max AS following_social_score_max,
      COALESCE(fa.recent_social_score_total, 0) AS following_recent_social_score_total,
      fa.last_social_at AS following_last_social_at
    FROM map_public_property_facts f
    INNER JOIN following_activity fa ON fa.property_id = f.property_id
    CROSS JOIN params p
    WHERE (cardinality(p.market_states) = 0 OR f.market_state = ANY (p.market_states))
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
        WHEN p.activity = 'today' THEN fa.last_social_at > NOW() - INTERVAL '1 day'
        WHEN p.activity = '10d' THEN fa.last_social_at > NOW() - INTERVAL '10 days'
        WHEN p.activity = '30d' THEN fa.last_social_at > NOW() - INTERVAL '30 days'
        WHEN p.activity = 'recent' THEN fa.last_social_at > NOW() - INTERVAL '7 days'
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
      SUM(f.following_social_count)::int AS social_count,
      SUM(f.following_recent_social_count)::int AS recent_social_count,
      SUM(f.following_social_score_total)::double precision AS social_score_total,
      MAX(f.following_social_score_max)::double precision AS social_score_max,
      SUM(f.following_recent_social_score_total)::double precision AS recent_social_score_total,
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
      f.following_social_count AS social_count,
      f.following_recent_social_count AS recent_social_count,
      f.following_social_score_total AS social_score_total,
      f.following_social_score_max AS social_score_max,
      f.following_recent_social_score_total AS recent_social_score_total,
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
  nodes AS (
    SELECT * FROM bucket_nodes
    UNION ALL SELECT * FROM single_nodes
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

CREATE OR REPLACE FUNCTION martin_tiles.buildings(
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
  WITH bounds AS (
    SELECT ST_TileEnvelope(z, x, y) AS geom
  ),
  candidate_buildings AS (
    SELECT
      ob.id,
      ob.country_code,
      GREATEST(3.02::real, ob.render_height - ob.render_min_height) AS render_height,
      ST_Transform(ob.geometry, 3857) AS geom_3857
    FROM osm_buildings ob
    CROSS JOIN bounds b
    WHERE z BETWEEN 15 AND 17
      AND ob.geometry && ST_Transform(b.geom, 4326)
  ),
  mvt_data AS (
    SELECT
      cb.id,
      cb.country_code,
      cb.render_height,
      ST_AsMVTGeom(cb.geom_3857, b.geom, 4096, 256, true) AS geom
    FROM candidate_buildings cb
    CROSS JOIN bounds b
    WHERE cb.geom_3857 && b.geom
  )
  SELECT COALESCE(ST_AsMVT(mvt_data, 'buildings', 4096, 'geom', 'id'), '\x'::bytea)
  FROM mvt_data
  WHERE geom IS NOT NULL
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION martin_tiles.trees(
  z integer,
  x integer,
  y integer,
  query_params json DEFAULT '{}'::json
) RETURNS bytea
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, martin_tiles, pg_temp
AS $$
DECLARE
  mvt bytea;
  candidate_count integer;
  exclusion_sql text;
BEGIN
  IF z < 15 OR z > 20 OR to_regclass('public.landcover') IS NULL THEN
    RETURN '\x'::bytea;
  END IF;

  candidate_count := CASE WHEN z >= 16 THEN 600 ELSE 200 END;
  exclusion_sql := CASE
    WHEN to_regclass('public.tall_buildings') IS NULL THEN ''
    ELSE 'AND NOT EXISTS (
      SELECT 1
      FROM tall_buildings b
      WHERE ST_Intersects(c.geom, b.exclusion_geom)
    )'
  END;

  EXECUTE '
    WITH bounds AS (
      SELECT
        ST_Transform(ST_TileEnvelope($1, $2, $3), 4326) AS geom_4326,
        ST_TileEnvelope($1, $2, $3) AS geom_3857
    ),
    candidates AS (
      SELECT
        i AS id,
        ST_SetSRID(
          ST_MakePoint(
            ST_XMin(b.geom_4326)
              + (
                ((''x'' || substr(md5($1::text || '':'' || $2::text || '':'' || $3::text || '':'' || i::text || '':x''), 1, 8))::bit(32)::bigint)::double precision
                / 4294967295.0
              ) * (ST_XMax(b.geom_4326) - ST_XMin(b.geom_4326)),
            ST_YMin(b.geom_4326)
              + (
                ((''x'' || substr(md5($1::text || '':'' || $2::text || '':'' || $3::text || '':'' || i::text || '':y''), 1, 8))::bit(32)::bigint)::double precision
                / 4294967295.0
              ) * (ST_YMax(b.geom_4326) - ST_YMin(b.geom_4326))
          ),
          4326
        ) AS geom,
        (
          ((''x'' || substr(md5($1::text || '':'' || $2::text || '':'' || $3::text || '':'' || i::text || '':v''), 1, 8))::bit(32)::bigint)
          % 16
        )::int AS tree_variant
      FROM bounds b
      CROSS JOIN generate_series(1, $4) AS i
    ),
    green_trees AS (
      SELECT DISTINCT ON (c.id)
        c.id,
        c.tree_variant,
        c.geom
      FROM candidates c
      INNER JOIN landcover lc ON ST_Within(c.geom, lc.geometry)
      WHERE TRUE
      ' || exclusion_sql || '
      ORDER BY c.id
    ),
    mvt_data AS (
      SELECT
        id,
        tree_variant,
        ST_AsMVTGeom(
          ST_Transform(geom, 3857),
          (SELECT geom_3857 FROM bounds),
          4096,
          256,
          true
        ) AS geom
      FROM green_trees
    )
    SELECT ST_AsMVT(mvt_data, ''scattered-trees'', 4096, ''geom'')
    FROM mvt_data
    WHERE geom IS NOT NULL
  '
  INTO mvt
  USING z, x, y, candidate_count;

  RETURN COALESCE(mvt, '\x'::bytea);
END
$$;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'martin_tile') THEN
    CREATE ROLE martin_tile LOGIN PASSWORD 'martin_tile_dev';
  ELSE
    ALTER ROLE martin_tile LOGIN PASSWORD 'martin_tile_dev';
  END IF;
END
$$;--> statement-breakpoint

ALTER ROLE martin_tile SET statement_timeout = '5000ms';--> statement-breakpoint
ALTER ROLE martin_tile SET work_mem = '32MB';--> statement-breakpoint
ALTER ROLE martin_tile SET idle_in_transaction_session_timeout = '5s';--> statement-breakpoint
ALTER ROLE martin_tile SET lock_timeout = '500ms';--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO martin_tile', current_database());
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO martin_tile;--> statement-breakpoint
GRANT USAGE ON SCHEMA martin_tiles TO martin_tile;--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA martin_tiles TO martin_tile;--> statement-breakpoint
GRANT SELECT ON
  map_public_property_facts,
  map_quiet_property_points,
  map_public_property_bucket_members,
  map_property_actor_activity,
  property_read_state,
  property_change_state,
  user_follows,
  osm_buildings
TO martin_tile;--> statement-breakpoint
