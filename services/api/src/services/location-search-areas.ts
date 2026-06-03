import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';

type QueryExecutor = {
  execute(query: SQL): Promise<unknown>;
};

export type LocationSearchAreaPropertyKey = {
  countryCode: string | null | undefined;
  city: string | null | undefined;
  region: string | null | undefined;
  postalCode: string | null | undefined;
  street: string | null | undefined;
};

type RebuildLogger = {
  info?: (message: string, details?: Record<string, unknown>) => void;
};

type CountRow = {
  count: number | string;
};

type AreaKindCountRow = {
  area_kind: string;
  count: number | string;
};

type PropertyKeyRow = {
  country_code: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  street: string | null;
};

const AREA_COLUMNS = `
  area_key,
  area_kind,
  suggestion_type,
  country_code,
  match_value,
  label,
  city,
  region,
  postal_code,
  street,
  lon,
  lat,
  min_lon,
  min_lat,
  max_lon,
  max_lat,
  property_count,
  geometry_count
`;

const TEXT_MATCH = (column: string) => `NULLIF(LOWER(TRIM(COALESCE(${column}, ''))), '')`;
const TOKEN_TEXT = (column: string) =>
  `NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE(${column}, ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), '')`;
const POSTCODE_MATCH = (column: string) =>
  `NULLIF(LOWER(REGEXP_REPLACE(UPPER(COALESCE(${column}, '')), '[^A-Z0-9]+', '', 'g')), '')`;

const ACTIVE_PROPERTIES_CTE = `
  WITH active_properties AS (
    SELECT
      p.country_code,
      p.city,
      p.region,
      p.postal_code,
      p.street,
      p.geometry,
      ${TEXT_MATCH('p.city')} AS city_match,
      ${TEXT_MATCH('p.region')} AS region_match,
      ${TEXT_MATCH('p.street')} AS street_match,
      ${TOKEN_TEXT('p.city')} AS city_token,
      ${TOKEN_TEXT('p.region')} AS region_token,
      ${TOKEN_TEXT('p.street')} AS street_token,
      ${POSTCODE_MATCH('p.postal_code')} AS postcode_match
    FROM properties p
    WHERE p.status = 'active'
      AND p.country_code IS NOT NULL
  )
`;

const AGGREGATE_COLUMNS = `
  AVG(ST_X(geometry)) FILTER (WHERE geometry IS NOT NULL) AS lon,
  AVG(ST_Y(geometry)) FILTER (WHERE geometry IS NOT NULL) AS lat,
  MIN(ST_X(geometry)) FILTER (WHERE geometry IS NOT NULL) AS min_lon,
  MIN(ST_Y(geometry)) FILTER (WHERE geometry IS NOT NULL) AS min_lat,
  MAX(ST_X(geometry)) FILTER (WHERE geometry IS NOT NULL) AS max_lon,
  MAX(ST_Y(geometry)) FILTER (WHERE geometry IS NOT NULL) AS max_lat,
  COUNT(*)::int AS property_count,
  COUNT(geometry)::int AS geometry_count
`;

const INSERT_COUNTRY_AREAS = `
  ${ACTIVE_PROPERTIES_CTE}
  INSERT INTO {destination} (${AREA_COLUMNS})
  SELECT
    'country:' || country_code AS area_key,
    'country' AS area_kind,
    'country' AS suggestion_type,
    country_code,
    LOWER(country_code) AS match_value,
    country_code AS label,
    NULL::varchar(100) AS city,
    NULL::varchar(255) AS region,
    NULL::varchar(32) AS postal_code,
    NULL::varchar(255) AS street,
    ${AGGREGATE_COLUMNS}
  FROM active_properties
  GROUP BY country_code
`;

const INSERT_BROAD_CITY_AREAS = `
  ${ACTIVE_PROPERTIES_CTE}
  INSERT INTO {destination} (${AREA_COLUMNS})
  SELECT
    'city:' || country_code || ':' || city_token AS area_key,
    'city' AS area_kind,
    'city' AS suggestion_type,
    country_code,
    city_match AS match_value,
    MIN(city)::text AS label,
    MIN(city)::varchar(100) AS city,
    NULL::varchar(255) AS region,
    NULL::varchar(32) AS postal_code,
    NULL::varchar(255) AS street,
    ${AGGREGATE_COLUMNS}
  FROM active_properties
  WHERE city_match IS NOT NULL
    AND city_token IS NOT NULL
  GROUP BY country_code, city_match, city_token
`;

const INSERT_REGIONAL_CITY_AREAS = `
  ${ACTIVE_PROPERTIES_CTE}
  INSERT INTO {destination} (${AREA_COLUMNS})
  SELECT
    'city:' || country_code || ':' || city_token || ':region=' || region_token AS area_key,
    'city' AS area_kind,
    'city' AS suggestion_type,
    country_code,
    city_match AS match_value,
    MIN(city)::text AS label,
    MIN(city)::varchar(100) AS city,
    MIN(region)::varchar(255) AS region,
    NULL::varchar(32) AS postal_code,
    NULL::varchar(255) AS street,
    ${AGGREGATE_COLUMNS}
  FROM active_properties
  WHERE city_match IS NOT NULL
    AND city_token IS NOT NULL
    AND region_match IS NOT NULL
    AND region_token IS NOT NULL
  GROUP BY country_code, city_match, city_token, region_match, region_token
`;

const INSERT_REGION_AREAS = `
  ${ACTIVE_PROPERTIES_CTE}
  INSERT INTO {destination} (${AREA_COLUMNS})
  SELECT
    'region:' || country_code || ':' || region_token AS area_key,
    'region' AS area_kind,
    'region' AS suggestion_type,
    country_code,
    region_match AS match_value,
    MIN(region)::text AS label,
    NULL::varchar(100) AS city,
    MIN(region)::varchar(255) AS region,
    NULL::varchar(32) AS postal_code,
    NULL::varchar(255) AS street,
    ${AGGREGATE_COLUMNS}
  FROM active_properties
  WHERE region_match IS NOT NULL
    AND region_token IS NOT NULL
  GROUP BY country_code, region_match, region_token
`;

const INSERT_POSTCODE_AREAS = `
  ${ACTIVE_PROPERTIES_CTE}
  INSERT INTO {destination} (${AREA_COLUMNS})
  SELECT
    'postcode:' || country_code || ':' || postcode_match
      || CASE WHEN city_token IS NOT NULL THEN ':city=' || city_token ELSE '' END
      || CASE WHEN region_token IS NOT NULL THEN ':region=' || region_token ELSE '' END
      || ':postcode=' || postcode_match AS area_key,
    'postcode' AS area_kind,
    'postcode' AS suggestion_type,
    country_code,
    postcode_match AS match_value,
    MIN(postal_code)::text AS label,
    MIN(city)::varchar(100) AS city,
    MIN(region)::varchar(255) AS region,
    MIN(postal_code)::varchar(32) AS postal_code,
    NULL::varchar(255) AS street,
    ${AGGREGATE_COLUMNS}
  FROM active_properties
  WHERE postcode_match IS NOT NULL
  GROUP BY country_code, postcode_match, city_match, city_token, region_match, region_token
`;

const INSERT_POSTCODE_PREFIX_AREAS = `
  ${ACTIVE_PROPERTIES_CTE}
  INSERT INTO {destination} (${AREA_COLUMNS})
  SELECT
    'postcode-prefix:' || country_code || ':' || LEFT(postcode_match, 4) AS area_key,
    'postcode_prefix' AS area_kind,
    'postcode' AS suggestion_type,
    country_code,
    LEFT(postcode_match, 4) AS match_value,
    LEFT(postcode_match, 4) AS label,
    MIN(city)::varchar(100) AS city,
    MIN(region)::varchar(255) AS region,
    LEFT(postcode_match, 4)::varchar(32) AS postal_code,
    NULL::varchar(255) AS street,
    ${AGGREGATE_COLUMNS}
  FROM active_properties
  WHERE postcode_match ~ '^\\d{4}[a-z]{2}$'
  GROUP BY country_code, LEFT(postcode_match, 4)
`;

const INSERT_STREET_AREAS = `
  ${ACTIVE_PROPERTIES_CTE}
  INSERT INTO {destination} (${AREA_COLUMNS})
  SELECT
    'street:' || country_code || ':' || street_token || ':city=' || city_token
      || CASE WHEN region_token IS NOT NULL THEN ':region=' || region_token ELSE '' END AS area_key,
    'street' AS area_kind,
    'street' AS suggestion_type,
    country_code,
    street_match AS match_value,
    MIN(street)::text AS label,
    MIN(city)::varchar(100) AS city,
    MIN(region)::varchar(255) AS region,
    NULL::varchar(32) AS postal_code,
    MIN(street)::varchar(255) AS street,
    ${AGGREGATE_COLUMNS}
  FROM active_properties
  WHERE street_match IS NOT NULL
    AND street_token IS NOT NULL
    AND city_match IS NOT NULL
    AND city_token IS NOT NULL
  GROUP BY country_code, street_match, street_token, city_match, city_token, region_match, region_token
`;

const FULL_INSERTS = [
  INSERT_COUNTRY_AREAS,
  INSERT_BROAD_CITY_AREAS,
  INSERT_REGIONAL_CITY_AREAS,
  INSERT_REGION_AREAS,
  INSERT_POSTCODE_AREAS,
  INSERT_POSTCODE_PREFIX_AREAS,
  INSERT_STREET_AREAS,
];

const TARGETED_AREA_UPSERT = `
  ON CONFLICT (area_key) DO UPDATE SET
    area_kind = EXCLUDED.area_kind,
    suggestion_type = EXCLUDED.suggestion_type,
    country_code = EXCLUDED.country_code,
    match_value = EXCLUDED.match_value,
    label = EXCLUDED.label,
    city = EXCLUDED.city,
    region = EXCLUDED.region,
    postal_code = EXCLUDED.postal_code,
    street = EXCLUDED.street,
    lon = EXCLUDED.lon,
    lat = EXCLUDED.lat,
    min_lon = EXCLUDED.min_lon,
    min_lat = EXCLUDED.min_lat,
    max_lon = EXCLUDED.max_lon,
    max_lat = EXCLUDED.max_lat,
    property_count = EXCLUDED.property_count,
    geometry_count = EXCLUDED.geometry_count,
    updated_at = NOW()
`;

function normalizeTextExpression(value: SQL): SQL {
  return sql`NULLIF(LOWER(TRIM(COALESCE(${value}, ''))), '')`;
}

function normalizeTokenExpression(value: SQL): SQL {
  return sql`NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE(${value}, ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), '')`;
}

function normalizePostalCodeExpression(value: SQL): SQL {
  return sql`NULLIF(LOWER(REGEXP_REPLACE(UPPER(COALESCE(${value}, '')), '[^A-Z0-9]+', '', 'g')), '')`;
}

function normalizeCountryCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{2}$/u.test(normalized) ? normalized : null;
}

function normalizePropertyKey(
  key: LocationSearchAreaPropertyKey
): Required<LocationSearchAreaPropertyKey> | null {
  const countryCode = normalizeCountryCode(key.countryCode);
  if (!countryCode) {
    return null;
  }

  return {
    countryCode,
    city: key.city?.trim() || null,
    region: key.region?.trim() || null,
    postalCode: key.postalCode?.trim() || null,
    street: key.street?.trim() || null,
  };
}

function locationSearchAreaInsertSql(template: string, destination: string): SQL {
  return sql.raw(template.replaceAll('{destination}', destination));
}

async function countLocationSearchAreas(executor: QueryExecutor): Promise<number> {
  const rows = Array.from(
    (await executor.execute(
      sql`SELECT COUNT(*)::int AS count FROM location_search_areas`
    )) as Iterable<CountRow>
  );
  return Number(rows[0]?.count ?? 0);
}

async function countLocationSearchAreasByKind(
  executor: QueryExecutor,
  tableName: string
): Promise<Record<string, number>> {
  const rows = Array.from(
    (await executor.execute(sql.raw(`
      SELECT area_kind, COUNT(*)::int AS count
      FROM ${tableName}
      GROUP BY area_kind
      ORDER BY area_kind
    `))) as Iterable<AreaKindCountRow>
  );

  return Object.fromEntries(rows.map((row) => [row.area_kind, Number(row.count)]));
}

export async function rebuildLocationSearchAreas(
  options: { logger?: RebuildLogger } = {}
): Promise<{ beforeCount: number; afterCount: number }> {
  const startedAt = Date.now();
  const beforeCount = await countLocationSearchAreas(db);

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`
      CREATE TEMP TABLE location_search_areas_rebuild
      (LIKE location_search_areas INCLUDING DEFAULTS)
      ON COMMIT DROP
    `);

    for (const insertTemplate of FULL_INSERTS) {
      await tx.execute(locationSearchAreaInsertSql(insertTemplate, 'location_search_areas_rebuild'));
    }

    const stagingCounts = await countLocationSearchAreasByKind(
      tx,
      'location_search_areas_rebuild'
    );
    if ((stagingCounts.country ?? 0) <= 0) {
      throw new Error('location_search_areas rebuild produced no active country coverage');
    }

    await tx.execute(sql`TRUNCATE location_search_areas`);
    await tx.execute(sql.raw(`
      INSERT INTO location_search_areas (${AREA_COLUMNS})
      SELECT ${AREA_COLUMNS}
      FROM location_search_areas_rebuild
    `));
    await tx.execute(sql`ANALYZE location_search_areas`);
    return {
      afterCount: await countLocationSearchAreas(tx),
      countsByKind: await countLocationSearchAreasByKind(tx, 'location_search_areas'),
    };
  });

  options.logger?.info?.('Rebuilt location search areas', {
    beforeCount,
    afterCount: result.afterCount,
    countsByKind: result.countsByKind,
    durationMs: Date.now() - startedAt,
  });

  return { beforeCount, afterCount: result.afterCount };
}

export async function getLocationSearchAreaPropertyKeysForIds(
  propertyIds: readonly string[]
): Promise<LocationSearchAreaPropertyKey[]> {
  const ids = [...new Set(propertyIds.filter(Boolean))];
  if (ids.length === 0) {
    return [];
  }

  const rows = Array.from(
    await db.execute<PropertyKeyRow>(sql`
      SELECT country_code, city, region, postal_code, street
      FROM properties
      WHERE id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})
    `)
  );

  return rows.map((row) => ({
    countryCode: row.country_code,
    city: row.city,
    region: row.region,
    postalCode: row.postal_code,
    street: row.street,
  }));
}

export async function refreshLocationSearchAreasForPropertyIds(
  propertyIds: readonly string[]
): Promise<void> {
  const keys = await getLocationSearchAreaPropertyKeysForIds(propertyIds);
  await refreshLocationSearchAreasForPropertyKeys(keys);
}

export async function refreshLocationSearchAreasForPropertyKeys(
  propertyKeys: readonly LocationSearchAreaPropertyKey[]
): Promise<void> {
  const normalizedKeys = propertyKeys
    .map(normalizePropertyKey)
    .filter((key): key is Required<LocationSearchAreaPropertyKey> => key != null);

  if (normalizedKeys.length === 0) {
    return;
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('location_search_areas_targeted_refresh'))`);
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    await tx.execute(sql`SET LOCAL jit = off`);
    await tx.execute(sql`
      CREATE TEMP TABLE affected_location_search_area_keys (
        country_code varchar(2) NOT NULL,
        city text,
        city_match text,
        city_token text,
        region text,
        region_match text,
        region_token text,
        postal_code text,
        postcode_match text,
        postcode_prefix text,
        street text,
        street_match text,
        street_token text
      ) ON COMMIT DROP
    `);

    await tx.execute(sql`
      INSERT INTO affected_location_search_area_keys (
        country_code,
        city,
        city_match,
        city_token,
        region,
        region_match,
        region_token,
        postal_code,
        postcode_match,
        postcode_prefix,
        street,
        street_match,
        street_token
      )
      VALUES ${sql.join(
        normalizedKeys.map(
          (key) => sql`(
            ${key.countryCode},
            ${key.city},
            ${normalizeTextExpression(sql`${key.city}`)},
            ${normalizeTokenExpression(sql`${key.city}`)},
            ${key.region},
            ${normalizeTextExpression(sql`${key.region}`)},
            ${normalizeTokenExpression(sql`${key.region}`)},
            ${key.postalCode},
            ${normalizePostalCodeExpression(sql`${key.postalCode}`)},
            CASE
              WHEN ${normalizePostalCodeExpression(sql`${key.postalCode}`)} ~ '^\\d{4}[a-z]{2}$'
                THEN LEFT(${normalizePostalCodeExpression(sql`${key.postalCode}`)}, 4)
              ELSE NULL
            END,
            ${key.street},
            ${normalizeTextExpression(sql`${key.street}`)},
            ${normalizeTokenExpression(sql`${key.street}`)}
          )`
        ),
        sql`, `
      )}
    `);

    await tx.execute(sql.raw(`
      WITH affected_area_keys AS (
        SELECT DISTINCT 'country:' || country_code AS area_key
        FROM affected_location_search_area_keys
        UNION
        SELECT DISTINCT 'city:' || country_code || ':' || city_token AS area_key
        FROM affected_location_search_area_keys
        WHERE city_token IS NOT NULL
        UNION
        SELECT DISTINCT 'city:' || country_code || ':' || city_token || ':region=' || region_token AS area_key
        FROM affected_location_search_area_keys
        WHERE city_token IS NOT NULL AND region_token IS NOT NULL
        UNION
        SELECT DISTINCT 'region:' || country_code || ':' || region_token AS area_key
        FROM affected_location_search_area_keys
        WHERE region_token IS NOT NULL
        UNION
        SELECT DISTINCT 'postcode:' || country_code || ':' || postcode_match
          || CASE WHEN city_token IS NOT NULL THEN ':city=' || city_token ELSE '' END
          || CASE WHEN region_token IS NOT NULL THEN ':region=' || region_token ELSE '' END
          || ':postcode=' || postcode_match AS area_key
        FROM affected_location_search_area_keys
        WHERE postcode_match IS NOT NULL
        UNION
        SELECT DISTINCT 'postcode-prefix:' || country_code || ':' || postcode_prefix AS area_key
        FROM affected_location_search_area_keys
        WHERE postcode_prefix IS NOT NULL
        UNION
        SELECT DISTINCT 'street:' || country_code || ':' || street_token || ':city=' || city_token
          || CASE WHEN region_token IS NOT NULL THEN ':region=' || region_token ELSE '' END AS area_key
        FROM affected_location_search_area_keys
        WHERE street_token IS NOT NULL AND city_token IS NOT NULL
      )
      DELETE FROM location_search_areas area
      USING affected_area_keys affected
      WHERE area.area_key = affected.area_key
    `));

    await tx.execute(sql.raw(`
      WITH target AS (
        SELECT DISTINCT country_code
        FROM affected_location_search_area_keys
      )
      INSERT INTO location_search_areas (${AREA_COLUMNS})
      SELECT
        'country:' || target.country_code,
        'country',
        'country',
        target.country_code,
        LOWER(target.country_code),
        target.country_code,
        NULL::varchar(100),
        NULL::varchar(255),
        NULL::varchar(32),
        NULL::varchar(255),
        NULL::double precision,
        NULL::double precision,
        NULL::double precision,
        NULL::double precision,
        NULL::double precision,
        NULL::double precision,
        1,
        0
      FROM target
      WHERE EXISTS (
        SELECT 1
        FROM properties p
        WHERE p.status = 'active'
          AND p.country_code = target.country_code
        LIMIT 1
      )
      ${TARGETED_AREA_UPSERT}
    `));

    await tx.execute(sql.raw(`
      WITH target AS (
        SELECT DISTINCT country_code, city_match, city_token
        FROM affected_location_search_area_keys
        WHERE city_match IS NOT NULL AND city_token IS NOT NULL
      )
      INSERT INTO location_search_areas (${AREA_COLUMNS})
      SELECT
        'city:' || p.country_code || ':' || target.city_token,
        'city',
        'city',
        p.country_code,
        target.city_match,
        MIN(p.city)::text,
        MIN(p.city)::varchar(100),
        NULL::varchar(255),
        NULL::varchar(32),
        NULL::varchar(255),
        ${AGGREGATE_COLUMNS}
      FROM properties p
      JOIN target
        ON target.country_code = p.country_code
       AND LOWER(p.city) = target.city_match
      WHERE p.status = 'active'
      GROUP BY p.country_code, target.city_match, target.city_token
      ${TARGETED_AREA_UPSERT}
    `));

    await tx.execute(sql.raw(`
      WITH target AS (
        SELECT DISTINCT country_code, city_match, city_token, region_match, region_token
        FROM affected_location_search_area_keys
        WHERE city_match IS NOT NULL
          AND city_token IS NOT NULL
          AND region_match IS NOT NULL
          AND region_token IS NOT NULL
      )
      INSERT INTO location_search_areas (${AREA_COLUMNS})
      SELECT
        'city:' || p.country_code || ':' || target.city_token || ':region=' || target.region_token,
        'city',
        'city',
        p.country_code,
        target.city_match,
        MIN(p.city)::text,
        MIN(p.city)::varchar(100),
        MIN(p.region)::varchar(255),
        NULL::varchar(32),
        NULL::varchar(255),
        ${AGGREGATE_COLUMNS}
      FROM properties p
      JOIN target
        ON target.country_code = p.country_code
       AND LOWER(p.city) = target.city_match
       AND LOWER(p.region) = target.region_match
      WHERE p.status = 'active'
      GROUP BY p.country_code, target.city_match, target.city_token, target.region_match, target.region_token
      ${TARGETED_AREA_UPSERT}
    `));

    await tx.execute(sql.raw(`
      WITH target AS (
        SELECT DISTINCT country_code, region_match, region_token
        FROM affected_location_search_area_keys
        WHERE region_match IS NOT NULL AND region_token IS NOT NULL
      )
      INSERT INTO location_search_areas (${AREA_COLUMNS})
      SELECT
        'region:' || p.country_code || ':' || target.region_token,
        'region',
        'region',
        p.country_code,
        target.region_match,
        MIN(p.region)::text,
        NULL::varchar(100),
        MIN(p.region)::varchar(255),
        NULL::varchar(32),
        NULL::varchar(255),
        ${AGGREGATE_COLUMNS}
      FROM properties p
      JOIN target
        ON target.country_code = p.country_code
       AND LOWER(p.region) = target.region_match
      WHERE p.status = 'active'
      GROUP BY p.country_code, target.region_match, target.region_token
      ${TARGETED_AREA_UPSERT}
    `));

    await tx.execute(sql.raw(`
      WITH target AS (
        SELECT DISTINCT
          country_code,
          city_match,
          city_token,
          region_match,
          region_token,
          postal_code,
          postcode_match
        FROM affected_location_search_area_keys
        WHERE postal_code IS NOT NULL
          AND postcode_match IS NOT NULL
      )
      INSERT INTO location_search_areas (${AREA_COLUMNS})
      SELECT
        'postcode:' || p.country_code || ':' || target.postcode_match
          || CASE WHEN target.city_token IS NOT NULL THEN ':city=' || target.city_token ELSE '' END
          || CASE WHEN target.region_token IS NOT NULL THEN ':region=' || target.region_token ELSE '' END
          || ':postcode=' || target.postcode_match,
        'postcode',
        'postcode',
        p.country_code,
        target.postcode_match,
        MIN(p.postal_code)::text,
        MIN(p.city)::varchar(100),
        MIN(p.region)::varchar(255),
        MIN(p.postal_code)::varchar(32),
        NULL::varchar(255),
        ${AGGREGATE_COLUMNS}
      FROM properties p
      JOIN target
        ON target.country_code = p.country_code
       AND p.postal_code = target.postal_code
       AND (
         target.city_match IS NULL
         OR LOWER(p.city) = target.city_match
       )
       AND (
         target.region_match IS NULL
         OR LOWER(p.region) = target.region_match
       )
      WHERE p.status = 'active'
      GROUP BY p.country_code, target.postcode_match, target.city_match, target.city_token, target.region_match, target.region_token
      ${TARGETED_AREA_UPSERT}
    `));

    await tx.execute(sql.raw(`
      WITH target AS (
        SELECT DISTINCT
          country_code,
          postcode_prefix,
          CASE
            WHEN postcode_prefix = '9999' THEN NULL
            ELSE LPAD((postcode_prefix::int + 1)::text, 4, '0')
          END AS postcode_prefix_upper
        FROM affected_location_search_area_keys
        WHERE postcode_prefix IS NOT NULL
      )
      INSERT INTO location_search_areas (${AREA_COLUMNS})
      SELECT
        'postcode-prefix:' || exact.country_code || ':' || target.postcode_prefix,
        'postcode_prefix',
        'postcode',
        exact.country_code,
        target.postcode_prefix,
        target.postcode_prefix,
        MIN(exact.city)::varchar(100),
        MIN(exact.region)::varchar(255),
        target.postcode_prefix::varchar(32),
        NULL::varchar(255),
        SUM(exact.lon * exact.property_count) / NULLIF(SUM(exact.property_count), 0),
        SUM(exact.lat * exact.property_count) / NULLIF(SUM(exact.property_count), 0),
        MIN(exact.min_lon),
        MIN(exact.min_lat),
        MAX(exact.max_lon),
        MAX(exact.max_lat),
        SUM(exact.property_count)::int,
        SUM(exact.geometry_count)::int
      FROM location_search_areas exact
      JOIN target
        ON target.country_code = exact.country_code
       AND exact.match_value >= target.postcode_prefix
       AND (
         target.postcode_prefix_upper IS NULL
         OR exact.match_value < target.postcode_prefix_upper
       )
      WHERE exact.area_kind = 'postcode'
        AND exact.match_value ~ '^\\d{4}[a-z]{2}$'
      GROUP BY exact.country_code, target.postcode_prefix
      ${TARGETED_AREA_UPSERT}
    `));

    await tx.execute(sql.raw(`
      WITH target AS (
        SELECT DISTINCT country_code, street_match, street_token, city_match, city_token, region_match, region_token
        FROM affected_location_search_area_keys
        WHERE street_match IS NOT NULL
          AND street_token IS NOT NULL
          AND city_match IS NOT NULL
          AND city_token IS NOT NULL
      )
      INSERT INTO location_search_areas (${AREA_COLUMNS})
      SELECT
        'street:' || p.country_code || ':' || target.street_token || ':city=' || target.city_token
          || CASE WHEN target.region_token IS NOT NULL THEN ':region=' || target.region_token ELSE '' END,
        'street',
        'street',
        p.country_code,
        target.street_match,
        MIN(p.street)::text,
        MIN(p.city)::varchar(100),
        MIN(p.region)::varchar(255),
        NULL::varchar(32),
        MIN(p.street)::varchar(255),
        ${AGGREGATE_COLUMNS}
      FROM properties p
      JOIN target
        ON target.country_code = p.country_code
       AND LOWER(p.street) = target.street_match
       AND LOWER(p.city) = target.city_match
       AND (
         (target.region_match IS NULL AND p.region IS NULL)
         OR (
           LOWER(p.region) = target.region_match
         )
       )
      WHERE p.status = 'active'
      GROUP BY p.country_code, target.street_match, target.street_token, target.city_match, target.city_token, target.region_match, target.region_token
      ${TARGETED_AREA_UPSERT}
    `));

  });
}
