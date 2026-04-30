CREATE OR REPLACE FUNCTION martin_tiles.tree_js_int32(value bigint) RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  WITH normalized AS (
    SELECT mod(mod(value, 4294967296::bigint) + 4294967296::bigint, 4294967296::bigint) AS n
  )
  SELECT CASE
    WHEN n >= 2147483648::bigint THEN (n - 4294967296::bigint)::integer
    ELSE n::integer
  END
  FROM normalized
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION martin_tiles.tree_js_uint32(value integer) RETURNS bigint
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN value < 0 THEN value::bigint + 4294967296::bigint
    ELSE value::bigint
  END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION martin_tiles.tree_js_urshift(value integer, bits integer) RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT floor(martin_tiles.tree_js_uint32(value)::double precision / power(2.0, bits))::integer
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION martin_tiles.tree_js_imul(left_value integer, right_value integer) RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT martin_tiles.tree_js_int32(left_value::bigint * right_value::bigint)
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION martin_tiles.tree_tile_seed(
  z integer,
  x integer,
  y integer
) RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    martin_tiles.tree_js_int32(z::bigint * 73856093::bigint)
    # martin_tiles.tree_js_int32(x::bigint * 19349663::bigint)
    # martin_tiles.tree_js_int32(y::bigint * 83492791::bigint)
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION martin_tiles.tree_scatter_candidates(
  z integer,
  x integer,
  y integer
) RETURNS TABLE(id integer, tree_variant integer, geom geometry(Point, 4326))
LANGUAGE plpgsql
STABLE
SET search_path = public, martin_tiles, pg_temp
AS $$
DECLARE
  anchor_z constant integer := 15;
  level1_count constant integer := 200;
  level2_count constant integer := 400;
  level2_seed_offset constant integer := -559038737;
  shift integer;
  ancestor_x integer;
  ancestor_y integer;
  ancestor_bbox geometry;
  current_bbox geometry;
  ancestor_min_lon double precision;
  ancestor_max_lon double precision;
  ancestor_min_lat double precision;
  ancestor_max_lat double precision;
  current_min_lon double precision;
  current_max_lon double precision;
  current_min_lat double precision;
  current_max_lat double precision;
  ancestor_seed integer;
  level_index integer;
  candidate_total integer;
  candidate_offset integer;
  rng_state integer;
  candidate_index integer;
  t integer;
  lon_random double precision;
  lat_random double precision;
  variant_random double precision;
  candidate_lon double precision;
  candidate_lat double precision;
BEGIN
  IF z < anchor_z OR z > 20 THEN
    RETURN;
  END IF;

  shift := z - anchor_z;
  ancestor_x := CASE WHEN shift = 0 THEN x ELSE floor(x::double precision / power(2.0, shift))::integer END;
  ancestor_y := CASE WHEN shift = 0 THEN y ELSE floor(y::double precision / power(2.0, shift))::integer END;

  ancestor_bbox := ST_Transform(ST_TileEnvelope(anchor_z, ancestor_x, ancestor_y), 4326);
  current_bbox := ST_Transform(ST_TileEnvelope(z, x, y), 4326);

  ancestor_min_lon := ST_XMin(ancestor_bbox);
  ancestor_max_lon := ST_XMax(ancestor_bbox);
  ancestor_min_lat := ST_YMin(ancestor_bbox);
  ancestor_max_lat := ST_YMax(ancestor_bbox);
  current_min_lon := ST_XMin(current_bbox);
  current_max_lon := ST_XMax(current_bbox);
  current_min_lat := ST_YMin(current_bbox);
  current_max_lat := ST_YMax(current_bbox);
  ancestor_seed := martin_tiles.tree_tile_seed(anchor_z, ancestor_x, ancestor_y);

  FOR level_index IN 1..CASE WHEN z >= anchor_z + 1 THEN 2 ELSE 1 END LOOP
    candidate_total := CASE WHEN level_index = 1 THEN level1_count ELSE level2_count END;
    candidate_offset := CASE WHEN level_index = 1 THEN 0 ELSE level1_count END;
    rng_state := CASE WHEN level_index = 1 THEN ancestor_seed ELSE ancestor_seed # level2_seed_offset END;

    FOR candidate_index IN 1..candidate_total LOOP
      rng_state := martin_tiles.tree_js_int32(rng_state::bigint + 1831565813::bigint);
      t := martin_tiles.tree_js_imul(
        rng_state # martin_tiles.tree_js_urshift(rng_state, 15),
        1 | rng_state
      );
      t := martin_tiles.tree_js_int32(
        t::bigint + martin_tiles.tree_js_imul(
          t # martin_tiles.tree_js_urshift(t, 7),
          61 | t
        )::bigint
      ) # t;
      lon_random := martin_tiles.tree_js_uint32(t # martin_tiles.tree_js_urshift(t, 14))::double precision / 4294967296.0;

      rng_state := martin_tiles.tree_js_int32(rng_state::bigint + 1831565813::bigint);
      t := martin_tiles.tree_js_imul(
        rng_state # martin_tiles.tree_js_urshift(rng_state, 15),
        1 | rng_state
      );
      t := martin_tiles.tree_js_int32(
        t::bigint + martin_tiles.tree_js_imul(
          t # martin_tiles.tree_js_urshift(t, 7),
          61 | t
        )::bigint
      ) # t;
      lat_random := martin_tiles.tree_js_uint32(t # martin_tiles.tree_js_urshift(t, 14))::double precision / 4294967296.0;

      rng_state := martin_tiles.tree_js_int32(rng_state::bigint + 1831565813::bigint);
      t := martin_tiles.tree_js_imul(
        rng_state # martin_tiles.tree_js_urshift(rng_state, 15),
        1 | rng_state
      );
      t := martin_tiles.tree_js_int32(
        t::bigint + martin_tiles.tree_js_imul(
          t # martin_tiles.tree_js_urshift(t, 7),
          61 | t
        )::bigint
      ) # t;
      variant_random := martin_tiles.tree_js_uint32(t # martin_tiles.tree_js_urshift(t, 14))::double precision / 4294967296.0;

      candidate_lon := ancestor_min_lon + lon_random * (ancestor_max_lon - ancestor_min_lon);
      candidate_lat := ancestor_min_lat + lat_random * (ancestor_max_lat - ancestor_min_lat);

      IF z = anchor_z OR (
        candidate_lon >= current_min_lon
        AND candidate_lon <= current_max_lon
        AND candidate_lat >= current_min_lat
        AND candidate_lat <= current_max_lat
      ) THEN
        id := candidate_offset + candidate_index;
        tree_variant := floor(variant_random * 16.0)::integer;
        geom := ST_SetSRID(ST_MakePoint(candidate_lon, candidate_lat), 4326);
        RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;
END
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
  exclusion_sql text;
BEGIN
  IF z < 15 OR z > 20 OR to_regclass('public.landcover') IS NULL THEN
    RETURN '\x'::bytea;
  END IF;

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
      SELECT ST_TileEnvelope($1, $2, $3) AS geom_3857
    ),
    candidates AS MATERIALIZED (
      SELECT id, tree_variant, geom
      FROM martin_tiles.tree_scatter_candidates($1, $2, $3)
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
  USING z, x, y;

  RETURN COALESCE(mvt, '\x'::bytea);
END
$$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'martin_tile') THEN
    GRANT EXECUTE ON FUNCTION martin_tiles.trees(integer, integer, integer, json) TO martin_tile;
  END IF;
END
$$;
