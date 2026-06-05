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

type RebuildLocationSearchAreasOptions = {
  logger?: RebuildLogger;
  countries?: readonly string[];
  profile?: boolean;
  rebuildOvertureMemberships?: boolean;
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
  scope_key,
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
  geometry_count,
  source,
  division_id,
  parent_division_id,
  parent_area_kind
`;

const TEXT_MATCH = (column: string) => `NULLIF(LOWER(TRIM(COALESCE(${column}, ''))), '')`;
const TOKEN_TEXT = (column: string) =>
  `NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE(${column}, ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), '')`;
const POSTCODE_MATCH = (column: string) =>
  `NULLIF(LOWER(REGEXP_REPLACE(UPPER(COALESCE(${column}, '')), '[^A-Z0-9]+', '', 'g')), '')`;
const INDEXED_TEXT_MATCH = (column: string) => `LOWER(${column})`;
const INDEXED_POSTCODE_MATCH = (column: string) =>
  `REGEXP_REPLACE(UPPER(${column}), '\\s+', '', 'g')`;

const ACTIVE_PROPERTIES_CTE = `
  WITH active_properties AS (
    SELECT
      p.id,
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
      ${POSTCODE_MATCH('p.postal_code')} AS postcode_match,
      city_membership.division_id AS parent_city_division_id
    FROM properties p
    LEFT JOIN property_location_division_memberships city_membership
      ON city_membership.property_id = p.id
     AND city_membership.area_kind = 'city'
    WHERE p.status = 'active'
      AND p.country_code IS NOT NULL
      {active_properties_country_filter}
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
    'country:' || country_code AS scope_key,
    'country' AS area_kind,
    'country' AS suggestion_type,
    country_code,
    LOWER(country_code) AS match_value,
    country_code AS label,
    NULL::varchar(100) AS city,
    NULL::varchar(255) AS region,
    NULL::varchar(32) AS postal_code,
    NULL::varchar(255) AS street,
    ${AGGREGATE_COLUMNS},
    'properties'::varchar(32) AS source,
    NULL::text AS division_id,
    NULL::text AS parent_division_id,
    NULL::varchar(16) AS parent_area_kind
  FROM active_properties
  WHERE NOT EXISTS (
    SELECT 1
    FROM property_location_division_memberships membership
    WHERE membership.property_id = active_properties.id
      AND membership.area_kind = 'country'
  )
  GROUP BY country_code
`;

const INSERT_BROAD_CITY_AREAS = `
  ${ACTIVE_PROPERTIES_CTE}
  INSERT INTO {destination} (${AREA_COLUMNS})
  SELECT
    'city:' || country_code || ':' || city_token AS area_key,
    'city:' || country_code || ':' || city_token AS scope_key,
    'city' AS area_kind,
    'city' AS suggestion_type,
    country_code,
    city_match AS match_value,
    MIN(city)::text AS label,
    MIN(city)::varchar(100) AS city,
    NULL::varchar(255) AS region,
    NULL::varchar(32) AS postal_code,
    NULL::varchar(255) AS street,
    ${AGGREGATE_COLUMNS},
    'properties'::varchar(32) AS source,
    NULL::text AS division_id,
    NULL::text AS parent_division_id,
    NULL::varchar(16) AS parent_area_kind
  FROM active_properties
  WHERE city_match IS NOT NULL
    AND city_token IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM {destination} existing
      WHERE existing.area_kind = 'city'
        AND existing.source = 'overture'
        AND existing.country_code = active_properties.country_code
        AND existing.match_value = active_properties.city_match
    )
  GROUP BY country_code, city_match, city_token
`;

const INSERT_REGIONAL_CITY_AREAS = `
  ${ACTIVE_PROPERTIES_CTE}
  INSERT INTO {destination} (${AREA_COLUMNS})
  SELECT
    'city:' || country_code || ':' || city_token || ':region=' || region_token AS area_key,
    'city:' || country_code || ':' || city_token || ':region=' || region_token AS scope_key,
    'city' AS area_kind,
    'city' AS suggestion_type,
    country_code,
    city_match AS match_value,
    MIN(city)::text AS label,
    MIN(city)::varchar(100) AS city,
    MIN(region)::varchar(255) AS region,
    NULL::varchar(32) AS postal_code,
    NULL::varchar(255) AS street,
    ${AGGREGATE_COLUMNS},
    'properties'::varchar(32) AS source,
    NULL::text AS division_id,
    NULL::text AS parent_division_id,
    NULL::varchar(16) AS parent_area_kind
  FROM active_properties
  WHERE city_match IS NOT NULL
    AND city_token IS NOT NULL
    AND region_match IS NOT NULL
    AND region_token IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM {destination} existing
      WHERE existing.area_kind = 'city'
        AND existing.source = 'overture'
        AND existing.country_code = active_properties.country_code
        AND existing.match_value = active_properties.city_match
    )
  GROUP BY country_code, city_match, city_token, region_match, region_token
`;

const INSERT_REGION_AREAS = `
  ${ACTIVE_PROPERTIES_CTE}
  INSERT INTO {destination} (${AREA_COLUMNS})
  SELECT
    'region:' || country_code || ':' || region_token AS area_key,
    'region:' || country_code || ':' || region_token AS scope_key,
    'region' AS area_kind,
    'region' AS suggestion_type,
    country_code,
    region_match AS match_value,
    MIN(region)::text AS label,
    NULL::varchar(100) AS city,
    MIN(region)::varchar(255) AS region,
    NULL::varchar(32) AS postal_code,
    NULL::varchar(255) AS street,
    ${AGGREGATE_COLUMNS},
    'properties'::varchar(32) AS source,
    NULL::text AS division_id,
    NULL::text AS parent_division_id,
    NULL::varchar(16) AS parent_area_kind
  FROM active_properties
  WHERE region_match IS NOT NULL
    AND region_token IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM property_location_division_memberships membership
      WHERE membership.property_id = active_properties.id
        AND membership.area_kind = 'region'
    )
  GROUP BY country_code, region_match, region_token
`;

const INSERT_POSTCODE_AREAS = `
  ${ACTIVE_PROPERTIES_CTE}
  INSERT INTO {destination} (${AREA_COLUMNS})
  SELECT
    'postcode:' || country_code || ':' || postcode_match
      || CASE
        WHEN parent_city_division_id IS NOT NULL
          THEN ':city=' || COALESCE(MIN(city_token), '') || ':parentDivision=' || parent_city_division_id || ':parentKind=city'
        ELSE ''
      END AS area_key,
    'postcode:' || country_code || ':' || postcode_match
      || CASE
        WHEN parent_city_division_id IS NOT NULL THEN ':parentDivision=' || parent_city_division_id
        ELSE ''
      END AS scope_key,
    'postcode' AS area_kind,
    'postcode' AS suggestion_type,
    country_code,
    postcode_match AS match_value,
    MIN(postal_code)::text AS label,
    MIN(city)::varchar(100) AS city,
    MIN(region)::varchar(255) AS region,
    MIN(postal_code)::varchar(32) AS postal_code,
    NULL::varchar(255) AS street,
    ${AGGREGATE_COLUMNS},
    'properties'::varchar(32) AS source,
    NULL::text AS division_id,
    parent_city_division_id AS parent_division_id,
    CASE WHEN parent_city_division_id IS NOT NULL THEN 'city' ELSE NULL END::varchar(16) AS parent_area_kind
  FROM active_properties
  WHERE postcode_match IS NOT NULL
  GROUP BY country_code, postcode_match, parent_city_division_id
`;

const INSERT_POSTCODE_PREFIX_AREAS = `
  ${ACTIVE_PROPERTIES_CTE}
  INSERT INTO {destination} (${AREA_COLUMNS})
  SELECT
    'postcode-prefix:' || country_code || ':' || LEFT(postcode_match, 4) AS area_key,
    'postcode-prefix:' || country_code || ':' || LEFT(postcode_match, 4) AS scope_key,
    'postcode_prefix' AS area_kind,
    'postcode' AS suggestion_type,
    country_code,
    LEFT(postcode_match, 4) AS match_value,
    LEFT(postcode_match, 4) AS label,
    MIN(city)::varchar(100) AS city,
    MIN(region)::varchar(255) AS region,
    LEFT(postcode_match, 4)::varchar(32) AS postal_code,
    NULL::varchar(255) AS street,
    ${AGGREGATE_COLUMNS},
    'properties'::varchar(32) AS source,
    NULL::text AS division_id,
    NULL::text AS parent_division_id,
    NULL::varchar(16) AS parent_area_kind
  FROM active_properties
  WHERE postcode_match ~ '^\\d{4}[a-z]{2}$'
  GROUP BY country_code, LEFT(postcode_match, 4)
`;

const INSERT_STREET_AREAS = `
  ${ACTIVE_PROPERTIES_CTE}
  INSERT INTO {destination} (${AREA_COLUMNS})
  SELECT
    'street:' || country_code || ':' || street_token || ':city=' || COALESCE(MIN(city_token), '')
      || CASE
        WHEN parent_city_division_id IS NOT NULL
          THEN ':parentDivision=' || parent_city_division_id || ':parentKind=city'
        ELSE ''
      END AS area_key,
    'street:' || country_code || ':' || street_token
      || CASE
        WHEN parent_city_division_id IS NOT NULL
          THEN ':parentDivision=' || parent_city_division_id
        ELSE ':city=' || COALESCE(MIN(city_token), '')
      END AS scope_key,
    'street' AS area_kind,
    'street' AS suggestion_type,
    country_code,
    street_match AS match_value,
    MIN(street)::text AS label,
    MIN(city)::varchar(100) AS city,
    MIN(region)::varchar(255) AS region,
    NULL::varchar(32) AS postal_code,
    MIN(street)::varchar(255) AS street,
    ${AGGREGATE_COLUMNS},
    'properties'::varchar(32) AS source,
    NULL::text AS division_id,
    parent_city_division_id AS parent_division_id,
    CASE WHEN parent_city_division_id IS NOT NULL THEN 'city' ELSE NULL END::varchar(16) AS parent_area_kind
  FROM active_properties
  WHERE street_match IS NOT NULL
    AND street_token IS NOT NULL
    AND city_match IS NOT NULL
    AND city_token IS NOT NULL
  GROUP BY country_code, street_match, street_token, parent_city_division_id, CASE WHEN parent_city_division_id IS NULL THEN city_match ELSE NULL END
`;

const INSERT_OVERTURE_COUNTRY_AREAS = `
  WITH membership_counts AS (
    SELECT
      membership.division_id,
      MIN(membership.country_code)::varchar(2) AS country_code,
      COUNT(*)::int AS property_count,
      COUNT(p.geometry)::int AS geometry_count
    FROM property_location_division_memberships membership
    JOIN properties p ON p.id = membership.property_id
    WHERE membership.area_kind = 'country'
      AND p.status = 'active'
      {membership_country_filter}
    GROUP BY membership.division_id
  ),
  area_bounds AS (
    SELECT
      area.division_id,
      ST_Collect(area.geometry) AS geometry
    FROM overture_division_areas area
    JOIN membership_counts counts ON counts.division_id = area.division_id
    WHERE area.subtype = 'country'
    GROUP BY area.division_id
  )
  INSERT INTO {destination} (${AREA_COLUMNS})
  SELECT
    'country:overture:' || division.id AS area_key,
    'country:overture:' || division.id AS scope_key,
    'country' AS area_kind,
    'country' AS suggestion_type,
    counts.country_code,
    ${TEXT_MATCH('division.name')} AS match_value,
    division.name AS label,
    NULL::varchar(100) AS city,
    NULL::varchar(255) AS region,
    NULL::varchar(32) AS postal_code,
    NULL::varchar(255) AS street,
    ST_X(ST_Centroid(bounds.geometry)) AS lon,
    ST_Y(ST_Centroid(bounds.geometry)) AS lat,
    ST_XMin(Box3D(bounds.geometry)) AS min_lon,
    ST_YMin(Box3D(bounds.geometry)) AS min_lat,
    ST_XMax(Box3D(bounds.geometry)) AS max_lon,
    ST_YMax(Box3D(bounds.geometry)) AS max_lat,
    counts.property_count,
    counts.geometry_count,
    'overture'::varchar(32) AS source,
    division.id AS division_id,
    NULL::text AS parent_division_id,
    NULL::varchar(16) AS parent_area_kind
  FROM membership_counts counts
  JOIN overture_divisions division ON division.id = counts.division_id
  JOIN area_bounds bounds ON bounds.division_id = counts.division_id
  WHERE ${TEXT_MATCH('division.name')} IS NOT NULL
`;

const INSERT_OVERTURE_REGION_AREAS = `
  WITH membership_counts AS (
    SELECT
      membership.division_id,
      MIN(membership.country_code)::varchar(2) AS country_code,
      COUNT(*)::int AS property_count,
      COUNT(p.geometry)::int AS geometry_count
    FROM property_location_division_memberships membership
    JOIN properties p ON p.id = membership.property_id
    WHERE membership.area_kind = 'region'
      AND p.status = 'active'
      {membership_country_filter}
    GROUP BY membership.division_id
  ),
  area_bounds AS (
    SELECT
      area.division_id,
      ST_Collect(area.geometry) AS geometry
    FROM overture_division_areas area
    JOIN membership_counts counts ON counts.division_id = area.division_id
    WHERE area.subtype = 'region'
    GROUP BY area.division_id
  )
  INSERT INTO {destination} (${AREA_COLUMNS})
  SELECT
    'region:overture:' || division.id AS area_key,
    'region:overture:' || division.id AS scope_key,
    'region' AS area_kind,
    'region' AS suggestion_type,
    counts.country_code,
    ${TEXT_MATCH('division.name')} AS match_value,
    division.name AS label,
    NULL::varchar(100) AS city,
    division.name::varchar(255) AS region,
    NULL::varchar(32) AS postal_code,
    NULL::varchar(255) AS street,
    ST_X(ST_Centroid(bounds.geometry)) AS lon,
    ST_Y(ST_Centroid(bounds.geometry)) AS lat,
    ST_XMin(Box3D(bounds.geometry)) AS min_lon,
    ST_YMin(Box3D(bounds.geometry)) AS min_lat,
    ST_XMax(Box3D(bounds.geometry)) AS max_lon,
    ST_YMax(Box3D(bounds.geometry)) AS max_lat,
    counts.property_count,
    counts.geometry_count,
    'overture'::varchar(32) AS source,
    division.id AS division_id,
    NULL::text AS parent_division_id,
    NULL::varchar(16) AS parent_area_kind
  FROM membership_counts counts
  JOIN overture_divisions division ON division.id = counts.division_id
  JOIN area_bounds bounds ON bounds.division_id = counts.division_id
  WHERE ${TEXT_MATCH('division.name')} IS NOT NULL
`;

const INSERT_OVERTURE_CITY_AREAS = `
  WITH membership_counts AS (
    SELECT
      membership.division_id,
      MIN(membership.country_code)::varchar(2) AS country_code,
      COUNT(*)::int AS property_count,
      COUNT(p.geometry)::int AS geometry_count
    FROM property_location_division_memberships membership
    JOIN properties p ON p.id = membership.property_id
    WHERE membership.area_kind = 'city'
      AND p.status = 'active'
      {membership_country_filter}
    GROUP BY membership.division_id
  ),
  area_bounds AS (
    SELECT
      area.division_id,
      ST_Collect(area.geometry) AS geometry
    FROM overture_division_areas area
    JOIN membership_counts counts ON counts.division_id = area.division_id
    WHERE area.subtype IN ('locality', 'localadmin')
    GROUP BY area.division_id
  )
  INSERT INTO {destination} (${AREA_COLUMNS})
  SELECT
    'city:overture:' || division.id AS area_key,
    'city:overture:' || division.id AS scope_key,
    'city' AS area_kind,
    'city' AS suggestion_type,
    counts.country_code,
    ${TEXT_MATCH('division.name')} AS match_value,
    division.name AS label,
    division.name::varchar(100) AS city,
    NULL::varchar(255) AS region,
    NULL::varchar(32) AS postal_code,
    NULL::varchar(255) AS street,
    ST_X(ST_Centroid(bounds.geometry)) AS lon,
    ST_Y(ST_Centroid(bounds.geometry)) AS lat,
    ST_XMin(Box3D(bounds.geometry)) AS min_lon,
    ST_YMin(Box3D(bounds.geometry)) AS min_lat,
    ST_XMax(Box3D(bounds.geometry)) AS max_lon,
    ST_YMax(Box3D(bounds.geometry)) AS max_lat,
    counts.property_count,
    counts.geometry_count,
    'overture'::varchar(32) AS source,
    division.id AS division_id,
    NULL::text AS parent_division_id,
    NULL::varchar(16) AS parent_area_kind
  FROM membership_counts counts
  JOIN overture_divisions division ON division.id = counts.division_id
  JOIN area_bounds bounds ON bounds.division_id = counts.division_id
  WHERE ${TEXT_MATCH('division.name')} IS NOT NULL
`;

const OVERTURE_FULL_INSERTS = [
  INSERT_OVERTURE_COUNTRY_AREAS,
  INSERT_OVERTURE_REGION_AREAS,
  INSERT_OVERTURE_CITY_AREAS,
];

const PROPERTY_FULL_INSERTS = [
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
    scope_key = EXCLUDED.scope_key,
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
    source = EXCLUDED.source,
    division_id = EXCLUDED.division_id,
    parent_division_id = EXCLUDED.parent_division_id,
    parent_area_kind = EXCLUDED.parent_area_kind,
    updated_at = NOW()
`;

function normalizeCountryCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{2}$/u.test(normalized) ? normalized : null;
}

function normalizeCountryCodes(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map(normalizeCountryCode).filter((value): value is string => value != null))];
}

function countryCodeSqlList(countryCodes: readonly string[]): string {
  return countryCodes.map((countryCode) => `'${countryCode}'`).join(', ');
}

function normalizeTextValue(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function normalizeTokenValue(value: string | null | undefined): string | null {
  const normalized = value
    ?.normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || null;
}

function normalizePostcodeValue(value: string | null | undefined): string | null {
  const normalized = value
    ?.normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .toLowerCase();
  return normalized || null;
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

function locationSearchAreaInsertSql(
  template: string,
  destination: string,
  countryCodes: readonly string[] = []
): SQL {
  const countryList = countryCodes.length > 0 ? countryCodeSqlList(countryCodes) : '';
  return sql.raw(
    template
      .replaceAll('{destination}', destination)
      .replaceAll(
        '{active_properties_country_filter}',
        countryCodes.length > 0 ? `AND p.country_code IN (${countryList})` : ''
      )
      .replaceAll(
        '{membership_country_filter}',
        countryCodes.length > 0 ? `AND membership.country_code IN (${countryList})` : ''
      )
  );
}

export function buildOvertureDivisionAreaSubdivisionsRefreshSql(
  countryCodes: readonly string[] = []
): string {
  const normalizedCountryCodes = normalizeCountryCodes(countryCodes);
  const countryPredicate =
    normalizedCountryCodes.length > 0
      ? `WHERE country_code IN (${countryCodeSqlList(normalizedCountryCodes)})`
      : '';
  const areaCountryPredicate =
    normalizedCountryCodes.length > 0
      ? `AND area.country_code IN (${countryCodeSqlList(normalizedCountryCodes)})`
      : '';

  return `
    DELETE FROM overture_division_area_subdivisions
    ${countryPredicate};

    INSERT INTO overture_division_area_subdivisions (
      division_area_id,
      division_id,
      country_code,
      subtype,
      selection_rank,
      area_sort,
      geometry
    )
    SELECT
      area.id,
      area.division_id,
      area.country_code,
      area.subtype,
      CASE area.subtype
        WHEN 'locality' THEN 0
        WHEN 'localadmin' THEN 1
        WHEN 'region' THEN 0
        WHEN 'country' THEN 0
        ELSE 9
      END,
      ST_Area(area.geometry),
      subdivided.geometry
    FROM overture_division_areas area
    CROSS JOIN LATERAL (
      SELECT (ST_Dump(ST_Subdivide(area.geometry, 256))).geom AS geometry
    ) subdivided
    WHERE area.subtype IN ('country', 'region', 'locality', 'localadmin')
      AND NOT ST_IsEmpty(subdivided.geometry)
      ${areaCountryPredicate};

    ANALYZE overture_division_area_subdivisions
  `;
}

async function refreshOvertureDivisionAreaSubdivisions(
  executor: QueryExecutor,
  countryCodes: readonly string[] = []
): Promise<void> {
  await executor.execute(sql.raw(buildOvertureDivisionAreaSubdivisionsRefreshSql(countryCodes)));
}

async function createPropertyLocationDivisionMembershipsStaging(
  executor: QueryExecutor,
  tableName: string,
  persistence: 'temp' | 'unlogged'
): Promise<void> {
  if (persistence === 'unlogged') {
    await executor.execute(sql.raw(`DROP TABLE IF EXISTS ${tableName}`));
  }
  await executor.execute(sql.raw(`
    CREATE ${persistence === 'unlogged' ? 'UNLOGGED' : 'TEMP'} TABLE ${tableName} (
      property_id uuid NOT NULL,
      area_kind varchar(16) NOT NULL,
      division_id text NOT NULL,
      division_area_id text NOT NULL,
      subtype varchar(32) NOT NULL,
      country_code varchar(2) NOT NULL,
      selection_rank integer NOT NULL,
      area_sort double precision NOT NULL,
      updated_at timestamp with time zone NOT NULL DEFAULT now(),
      PRIMARY KEY (property_id, area_kind)
    ) ${persistence === 'temp' ? 'ON COMMIT DROP' : ''}
  `));
  await executor.execute(sql.raw(`
    CREATE INDEX ${tableName}_ck_idx
      ON ${tableName} (country_code, area_kind)
  `));
}

const MEMBERSHIP_CANDIDATE_UPSERT = `
  ON CONFLICT (property_id, area_kind) DO UPDATE SET
    division_id = EXCLUDED.division_id,
    division_area_id = EXCLUDED.division_area_id,
    subtype = EXCLUDED.subtype,
    country_code = EXCLUDED.country_code,
    selection_rank = EXCLUDED.selection_rank,
    area_sort = EXCLUDED.area_sort,
    updated_at = NOW()
  WHERE
    (
      EXCLUDED.selection_rank,
      EXCLUDED.area_sort,
      EXCLUDED.division_area_id
    )
    <
    (
      {destination}.selection_rank,
      {destination}.area_sort,
      {destination}.division_area_id
    )
`;

async function insertRankedPropertyLocationDivisionMembershipCandidates(
  executor: QueryExecutor,
  destination: string,
  propertyJoinSql = '',
  countryCodes: readonly string[] = []
): Promise<void> {
  const normalizedCountryCodes = normalizeCountryCodes(countryCodes);
  const propertyCountryFilter =
    normalizedCountryCodes.length > 0
      ? `AND p.country_code IN (${countryCodeSqlList(normalizedCountryCodes)})`
      : '';
  const candidateUpsert = MEMBERSHIP_CANDIDATE_UPSERT.replaceAll('{destination}', destination);

  await executor.execute(sql.raw(`
    INSERT INTO ${destination} (
      property_id,
      area_kind,
      division_id,
      division_area_id,
      subtype,
      country_code,
      selection_rank,
      area_sort
    )
    SELECT DISTINCT ON (p.id)
      p.id,
      'city',
      subdivision.division_id,
      subdivision.division_area_id,
      subdivision.subtype,
      p.country_code,
      subdivision.selection_rank,
      subdivision.area_sort
    FROM properties p
    ${propertyJoinSql}
    JOIN overture_division_area_subdivisions subdivision
      ON subdivision.country_code = p.country_code
     AND subdivision.subtype IN ('locality', 'localadmin')
     AND subdivision.geometry && p.geometry
     AND ST_Covers(subdivision.geometry, p.geometry)
    WHERE p.status = 'active'
      AND p.geometry IS NOT NULL
      ${propertyCountryFilter}
    ORDER BY
      p.id,
      subdivision.selection_rank,
      subdivision.area_sort,
      subdivision.division_area_id
    ${candidateUpsert}
  `));

  await executor.execute(sql.raw(`
    INSERT INTO ${destination} (
      property_id,
      area_kind,
      division_id,
      division_area_id,
      subtype,
      country_code,
      selection_rank,
      area_sort
    )
    SELECT DISTINCT ON (p.id)
      p.id,
      'region',
      subdivision.division_id,
      subdivision.division_area_id,
      subdivision.subtype,
      p.country_code,
      subdivision.selection_rank,
      subdivision.area_sort
    FROM properties p
    ${propertyJoinSql}
    JOIN overture_division_area_subdivisions subdivision
      ON subdivision.country_code = p.country_code
     AND subdivision.subtype = 'region'
     AND subdivision.geometry && p.geometry
     AND ST_Covers(subdivision.geometry, p.geometry)
    WHERE p.status = 'active'
      AND p.geometry IS NOT NULL
      ${propertyCountryFilter}
    ORDER BY
      p.id,
      subdivision.selection_rank,
      subdivision.area_sort,
      subdivision.division_area_id
    ${candidateUpsert}
  `));

  await executor.execute(sql.raw(`
    WITH country_area AS (
      SELECT DISTINCT ON (area.country_code)
        area.country_code,
        area.division_id,
        area.id AS division_area_id,
        area.subtype,
        0 AS selection_rank,
        ST_Area(area.geometry) AS area_sort
      FROM overture_division_areas area
      WHERE area.subtype = 'country'
      ORDER BY area.country_code, ST_Area(area.geometry), area.id
    )
    INSERT INTO ${destination} (
      property_id,
      area_kind,
      division_id,
      division_area_id,
      subtype,
      country_code,
      selection_rank,
      area_sort
    )
    SELECT
      p.id,
      'country',
      country_area.division_id,
      country_area.division_area_id,
      country_area.subtype,
      p.country_code,
      country_area.selection_rank,
      country_area.area_sort
    FROM properties p
    ${propertyJoinSql}
    JOIN country_area
      ON country_area.country_code = p.country_code
    WHERE p.status = 'active'
      ${propertyCountryFilter}
    ${candidateUpsert}
  `));

  await executor.execute(sql.raw(`ANALYZE ${destination}`));
}

async function copyPropertyLocationDivisionMembershipsFromStaging(
  executor: QueryExecutor,
  source: string
): Promise<void> {
  await executor.execute(sql.raw(`
    INSERT INTO property_location_division_memberships (
      property_id,
      area_kind,
      division_id,
      division_area_id,
      subtype,
      country_code,
      updated_at
    )
    SELECT
      property_id,
      area_kind,
      division_id,
      division_area_id,
      subtype,
      country_code,
      updated_at
    FROM ${source}
  `));
}

async function rebuildPropertyLocationDivisionMemberships(
  executor: QueryExecutor,
  countryCodes: readonly string[] = []
): Promise<void> {
  const normalizedCountryCodes = normalizeCountryCodes(countryCodes);
  const stagingTable = 'property_location_division_memberships_rebuild_staging';
  await refreshOvertureDivisionAreaSubdivisions(executor, normalizedCountryCodes);
  await createPropertyLocationDivisionMembershipsStaging(executor, stagingTable, 'unlogged');
  await insertRankedPropertyLocationDivisionMembershipCandidates(
    executor,
    stagingTable,
    '',
    normalizedCountryCodes
  );

  if (normalizedCountryCodes.length > 0) {
    await executor.execute(sql.raw(`
      DELETE FROM property_location_division_memberships
      WHERE country_code IN (${countryCodeSqlList(normalizedCountryCodes)})
    `));
  } else {
    await executor.execute(sql`TRUNCATE property_location_division_memberships`);
  }
  await copyPropertyLocationDivisionMembershipsFromStaging(executor, stagingTable);
  await executor.execute(sql`ANALYZE property_location_division_memberships`);
  await executor.execute(sql.raw(`DROP TABLE IF EXISTS ${stagingTable}`));
}

async function refreshOvertureLocationSearchAreasForAffectedDivisions(
  executor: QueryExecutor
): Promise<void> {
  await executor.execute(sql.raw(`
    DELETE FROM location_search_areas area
    USING affected_overture_location_search_area_keys affected
    WHERE area.source = 'overture'
      AND area.area_kind = affected.area_kind
      AND area.division_id = affected.division_id
      AND affected.area_kind = 'city'
  `));

  await executor.execute(sql.raw(`
    WITH membership_counts AS (
      SELECT
        membership.division_id,
        MIN(membership.country_code)::varchar(2) AS country_code,
        COUNT(*)::int AS property_count,
        COUNT(p.geometry)::int AS geometry_count
      FROM property_location_division_memberships membership
      JOIN affected_overture_location_search_area_keys affected
        ON affected.area_kind = 'city'
       AND affected.division_id = membership.division_id
      JOIN properties p ON p.id = membership.property_id
      WHERE membership.area_kind = 'city'
        AND p.status = 'active'
      GROUP BY membership.division_id
    ),
    area_bounds AS (
      SELECT area.division_id, ST_Collect(area.geometry) AS geometry
      FROM overture_division_areas area
      JOIN membership_counts counts ON counts.division_id = area.division_id
      WHERE area.subtype IN ('locality', 'localadmin')
      GROUP BY area.division_id
    )
    INSERT INTO location_search_areas (${AREA_COLUMNS})
    SELECT
      'city:overture:' || division.id,
      'city:overture:' || division.id,
      'city',
      'city',
      counts.country_code,
      ${TEXT_MATCH('division.name')},
      division.name,
      division.name::varchar(100),
      NULL::varchar(255),
      NULL::varchar(32),
      NULL::varchar(255),
      ST_X(ST_Centroid(bounds.geometry)),
      ST_Y(ST_Centroid(bounds.geometry)),
      ST_XMin(Box3D(bounds.geometry)),
      ST_YMin(Box3D(bounds.geometry)),
      ST_XMax(Box3D(bounds.geometry)),
      ST_YMax(Box3D(bounds.geometry)),
      counts.property_count,
      counts.geometry_count,
      'overture'::varchar(32),
      division.id,
      NULL::text,
      NULL::varchar(16)
    FROM membership_counts counts
    JOIN overture_divisions division ON division.id = counts.division_id
    JOIN area_bounds bounds ON bounds.division_id = counts.division_id
    WHERE ${TEXT_MATCH('division.name')} IS NOT NULL
    ${TARGETED_AREA_UPSERT}
  `));
}

async function createAffectedLocationSearchAreaTargets(executor: QueryExecutor): Promise<void> {
  await executor.execute(sql`
    CREATE TEMP TABLE affected_location_search_area_targets (
      scope_key text PRIMARY KEY,
      country_code varchar(2) NOT NULL,
      city_match text,
      city_token text,
      region_match text,
      region_token text,
      postcode_match text,
      postcode_prefix text,
      street_match text,
      street_token text,
      parent_division_id text,
      parent_area_kind varchar(16)
    ) ON COMMIT DROP
  `);

  await executor.execute(sql`
    CREATE INDEX affected_location_search_area_targets_city_idx
      ON affected_location_search_area_targets (country_code, city_match, city_token)
  `);
  await executor.execute(sql`
    CREATE INDEX affected_location_search_area_targets_region_idx
      ON affected_location_search_area_targets (country_code, region_match, region_token)
  `);
  await executor.execute(sql`
    CREATE INDEX affected_location_search_area_targets_postcode_idx
      ON affected_location_search_area_targets (country_code, postcode_match, parent_division_id)
  `);
  await executor.execute(sql`
    CREATE INDEX affected_location_search_area_targets_street_idx
      ON affected_location_search_area_targets (
        country_code,
        street_match,
        city_match,
        parent_division_id
      )
  `);
}

async function insertAffectedLocationSearchAreaTargetsFromProperties(
  executor: QueryExecutor
): Promise<void> {
  await executor.execute(sql.raw(`
    WITH affected_properties AS (
      SELECT
        p.id,
        p.country_code,
        ${TEXT_MATCH('p.city')} AS city_match,
        ${TOKEN_TEXT('p.city')} AS city_token,
        ${TEXT_MATCH('p.region')} AS region_match,
        ${TOKEN_TEXT('p.region')} AS region_token,
        ${POSTCODE_MATCH('p.postal_code')} AS postcode_match,
        ${TEXT_MATCH('p.street')} AS street_match,
        ${TOKEN_TEXT('p.street')} AS street_token,
        city_membership.division_id AS parent_city_division_id,
        region_membership.division_id AS parent_region_division_id,
        country_membership.division_id AS parent_country_division_id
      FROM properties p
      JOIN affected_property_ids affected ON affected.id = p.id
      LEFT JOIN property_location_division_memberships city_membership
        ON city_membership.property_id = p.id
       AND city_membership.area_kind = 'city'
      LEFT JOIN property_location_division_memberships region_membership
        ON region_membership.property_id = p.id
       AND region_membership.area_kind = 'region'
      LEFT JOIN property_location_division_memberships country_membership
        ON country_membership.property_id = p.id
       AND country_membership.area_kind = 'country'
      WHERE p.country_code IS NOT NULL
    ),
    target_rows AS (
      SELECT 'country:' || country_code AS scope_key, country_code, NULL::text AS city_match, NULL::text AS city_token, NULL::text AS region_match, NULL::text AS region_token, NULL::text AS postcode_match, NULL::text AS postcode_prefix, NULL::text AS street_match, NULL::text AS street_token, NULL::text AS parent_division_id, NULL::varchar(16) AS parent_area_kind
      FROM affected_properties
      WHERE parent_country_division_id IS NULL
      UNION
      SELECT 'city:' || country_code || ':' || city_token, country_code, city_match, city_token, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM affected_properties
      WHERE parent_city_division_id IS NULL AND city_match IS NOT NULL AND city_token IS NOT NULL
      UNION
      SELECT 'city:' || country_code || ':' || city_token || ':region=' || region_token, country_code, city_match, city_token, region_match, region_token, NULL, NULL, NULL, NULL, NULL, NULL
      FROM affected_properties
      WHERE parent_city_division_id IS NULL AND city_match IS NOT NULL AND city_token IS NOT NULL AND region_match IS NOT NULL AND region_token IS NOT NULL
      UNION
      SELECT 'region:' || country_code || ':' || region_token, country_code, NULL, NULL, region_match, region_token, NULL, NULL, NULL, NULL, NULL, NULL
      FROM affected_properties
      WHERE parent_region_division_id IS NULL AND region_match IS NOT NULL AND region_token IS NOT NULL
      UNION
      SELECT
        'postcode:' || country_code || ':' || postcode_match
          || CASE WHEN parent_city_division_id IS NOT NULL THEN ':parentDivision=' || parent_city_division_id ELSE '' END,
        country_code,
        NULL,
        NULL,
        NULL,
        NULL,
        postcode_match,
        NULL,
        NULL,
        NULL,
        parent_city_division_id,
        CASE WHEN parent_city_division_id IS NOT NULL THEN 'city' ELSE NULL END::varchar(16)
      FROM affected_properties
      WHERE postcode_match IS NOT NULL
      UNION
      SELECT 'postcode-prefix:' || country_code || ':' || LEFT(postcode_match, 4), country_code, NULL, NULL, NULL, NULL, NULL, LEFT(postcode_match, 4), NULL, NULL, NULL, NULL
      FROM affected_properties
      WHERE postcode_match ~ '^\\d{4}[a-z]{2}$'
      UNION
      SELECT
        'street:' || country_code || ':' || street_token
          || CASE
            WHEN parent_city_division_id IS NOT NULL THEN ':parentDivision=' || parent_city_division_id
            ELSE ':city=' || city_token
          END,
        country_code,
        CASE WHEN parent_city_division_id IS NULL THEN city_match ELSE NULL END,
        CASE WHEN parent_city_division_id IS NULL THEN city_token ELSE NULL END,
        NULL,
        NULL,
        NULL,
        NULL,
        street_match,
        street_token,
        parent_city_division_id,
        CASE WHEN parent_city_division_id IS NOT NULL THEN 'city' ELSE NULL END::varchar(16)
      FROM affected_properties
      WHERE street_match IS NOT NULL AND street_token IS NOT NULL AND city_match IS NOT NULL AND city_token IS NOT NULL
    )
    INSERT INTO affected_location_search_area_targets (
      scope_key,
      country_code,
      city_match,
      city_token,
      region_match,
      region_token,
      postcode_match,
      postcode_prefix,
      street_match,
      street_token,
      parent_division_id,
      parent_area_kind
    )
    SELECT * FROM target_rows
    ON CONFLICT DO NOTHING
  `));

  await executor.execute(sql`ANALYZE affected_location_search_area_targets`);
}

async function refreshLocationSearchAreasForAffectedTargets(
  executor: QueryExecutor
): Promise<void> {
  await executor.execute(sql.raw(`
    DELETE FROM location_search_areas area
    USING affected_location_search_area_targets target
    WHERE area.scope_key = target.scope_key
  `));

  await executor.execute(sql.raw(`
    WITH target AS (
      SELECT DISTINCT country_code
      FROM affected_location_search_area_targets
    )
    INSERT INTO location_search_areas (${AREA_COLUMNS})
    SELECT
      'country:' || target.country_code,
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
      0,
      'properties'::varchar(32),
      NULL::text,
      NULL::text,
      NULL::varchar(16)
    FROM target
    WHERE NOT EXISTS (
      SELECT 1
      FROM location_search_areas existing
      WHERE existing.area_key = 'country:' || target.country_code
    )
    ${TARGETED_AREA_UPSERT}
  `));

  await executor.execute(sql.raw(`
    WITH target AS (
      SELECT DISTINCT country_code, city_match, city_token
      FROM affected_location_search_area_targets
      WHERE city_match IS NOT NULL AND city_token IS NOT NULL
    )
    INSERT INTO location_search_areas (${AREA_COLUMNS})
    SELECT
      'city:' || p.country_code || ':' || target.city_token,
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
      ${AGGREGATE_COLUMNS},
      'properties'::varchar(32),
      NULL::text,
      NULL::text,
      NULL::varchar(16)
    FROM properties p
    JOIN target
      ON target.country_code = p.country_code
     AND ${INDEXED_TEXT_MATCH('p.city')} = target.city_match
     AND ${TEXT_MATCH('p.city')} = target.city_match
    WHERE p.status = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM location_search_areas existing
        WHERE existing.area_kind = 'city'
          AND existing.source = 'overture'
          AND existing.country_code = p.country_code
          AND existing.match_value = target.city_match
      )
    GROUP BY p.country_code, target.city_match, target.city_token
    ${TARGETED_AREA_UPSERT}
  `));

  await executor.execute(sql.raw(`
    WITH target AS (
      SELECT DISTINCT country_code, city_match, city_token, region_match, region_token
      FROM affected_location_search_area_targets
      WHERE city_match IS NOT NULL
        AND city_token IS NOT NULL
        AND region_match IS NOT NULL
        AND region_token IS NOT NULL
    )
    INSERT INTO location_search_areas (${AREA_COLUMNS})
    SELECT
      'city:' || p.country_code || ':' || target.city_token || ':region=' || target.region_token,
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
      ${AGGREGATE_COLUMNS},
      'properties'::varchar(32),
      NULL::text,
      NULL::text,
      NULL::varchar(16)
    FROM properties p
    JOIN target
      ON target.country_code = p.country_code
     AND ${INDEXED_TEXT_MATCH('p.city')} = target.city_match
     AND ${INDEXED_TEXT_MATCH('p.region')} = target.region_match
     AND ${TEXT_MATCH('p.city')} = target.city_match
     AND ${TEXT_MATCH('p.region')} = target.region_match
    WHERE p.status = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM location_search_areas existing
        WHERE existing.area_kind = 'city'
          AND existing.source = 'overture'
          AND existing.country_code = p.country_code
          AND existing.match_value = target.city_match
      )
    GROUP BY p.country_code, target.city_match, target.city_token, target.region_match, target.region_token
    ${TARGETED_AREA_UPSERT}
  `));

  await executor.execute(sql.raw(`
    WITH target AS (
      SELECT DISTINCT country_code, region_match, region_token
      FROM affected_location_search_area_targets
      WHERE region_match IS NOT NULL AND region_token IS NOT NULL
    )
    INSERT INTO location_search_areas (${AREA_COLUMNS})
    SELECT
      'region:' || p.country_code || ':' || target.region_token,
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
      ${AGGREGATE_COLUMNS},
      'properties'::varchar(32),
      NULL::text,
      NULL::text,
      NULL::varchar(16)
    FROM properties p
    JOIN target
      ON target.country_code = p.country_code
     AND ${INDEXED_TEXT_MATCH('p.region')} = target.region_match
     AND ${TEXT_MATCH('p.region')} = target.region_match
    WHERE p.status = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM property_location_division_memberships membership
        WHERE membership.property_id = p.id
          AND membership.area_kind = 'region'
      )
    GROUP BY p.country_code, target.region_match, target.region_token
    ${TARGETED_AREA_UPSERT}
  `));

  await executor.execute(sql.raw(`
    WITH target AS (
      SELECT DISTINCT country_code, postcode_match, parent_division_id, parent_area_kind
      FROM affected_location_search_area_targets
      WHERE postcode_match IS NOT NULL
    )
    INSERT INTO location_search_areas (${AREA_COLUMNS})
    SELECT
      'postcode:' || p.country_code || ':' || target.postcode_match
        || CASE
          WHEN target.parent_division_id IS NOT NULL
            THEN ':city=' || COALESCE(MIN(${TOKEN_TEXT('p.city')}), '') || ':parentDivision=' || target.parent_division_id || ':parentKind=city'
          ELSE ''
        END,
      'postcode:' || p.country_code || ':' || target.postcode_match
        || CASE WHEN target.parent_division_id IS NOT NULL THEN ':parentDivision=' || target.parent_division_id ELSE '' END,
      'postcode',
      'postcode',
      p.country_code,
      target.postcode_match,
      MIN(p.postal_code)::text,
      MIN(p.city)::varchar(100),
      MIN(p.region)::varchar(255),
      MIN(p.postal_code)::varchar(32),
      NULL::varchar(255),
      ${AGGREGATE_COLUMNS},
      'properties'::varchar(32),
      NULL::text,
      target.parent_division_id,
      target.parent_area_kind
    FROM properties p
    LEFT JOIN property_location_division_memberships city_membership
      ON city_membership.property_id = p.id
     AND city_membership.area_kind = 'city'
    JOIN target
      ON target.country_code = p.country_code
     AND ${INDEXED_POSTCODE_MATCH('p.postal_code')} = UPPER(target.postcode_match)
     AND ${POSTCODE_MATCH('p.postal_code')} = target.postcode_match
     AND (
       (target.parent_division_id IS NULL AND city_membership.division_id IS NULL)
       OR city_membership.division_id = target.parent_division_id
     )
    WHERE p.status = 'active'
    GROUP BY p.country_code, target.postcode_match, target.parent_division_id, target.parent_area_kind
    ${TARGETED_AREA_UPSERT}
  `));

  await executor.execute(sql.raw(`
    WITH target AS (
      SELECT DISTINCT
        country_code,
        postcode_prefix,
        CASE
          WHEN postcode_prefix = '9999' THEN NULL
          ELSE LPAD((postcode_prefix::int + 1)::text, 4, '0')
        END AS postcode_prefix_upper
      FROM affected_location_search_area_targets
      WHERE postcode_prefix IS NOT NULL
    )
    INSERT INTO location_search_areas (${AREA_COLUMNS})
    SELECT
      'postcode-prefix:' || exact.country_code || ':' || target.postcode_prefix,
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
      SUM(exact.geometry_count)::int,
      'properties'::varchar(32),
      NULL::text,
      NULL::text,
      NULL::varchar(16)
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

  await executor.execute(sql.raw(`
    WITH target AS (
      SELECT DISTINCT scope_key, country_code, city_match, city_token, street_match, street_token, parent_division_id, parent_area_kind
      FROM affected_location_search_area_targets
      WHERE street_match IS NOT NULL
        AND street_token IS NOT NULL
    )
    INSERT INTO location_search_areas (${AREA_COLUMNS})
    SELECT
      'street:' || p.country_code || ':' || target.street_token || ':city=' || COALESCE(MIN(${TOKEN_TEXT('p.city')}), '')
        || CASE
          WHEN target.parent_division_id IS NOT NULL
            THEN ':parentDivision=' || target.parent_division_id || ':parentKind=city'
          ELSE ''
        END,
      target.scope_key,
      'street',
      'street',
      p.country_code,
      target.street_match,
      MIN(p.street)::text,
      MIN(p.city)::varchar(100),
      MIN(p.region)::varchar(255),
      NULL::varchar(32),
      MIN(p.street)::varchar(255),
      ${AGGREGATE_COLUMNS},
      'properties'::varchar(32),
      NULL::text,
      target.parent_division_id,
      target.parent_area_kind
    FROM properties p
    LEFT JOIN property_location_division_memberships city_membership
      ON city_membership.property_id = p.id
     AND city_membership.area_kind = 'city'
    JOIN target
      ON target.country_code = p.country_code
     AND ${INDEXED_TEXT_MATCH('p.street')} = target.street_match
     AND ${TEXT_MATCH('p.street')} = target.street_match
     AND (
       (
         target.parent_division_id IS NULL
         AND city_membership.division_id IS NULL
         AND ${INDEXED_TEXT_MATCH('p.city')} = target.city_match
         AND ${TEXT_MATCH('p.city')} = target.city_match
       )
       OR city_membership.division_id = target.parent_division_id
     )
    WHERE p.status = 'active'
    GROUP BY p.country_code, target.scope_key, target.street_match, target.street_token, target.parent_division_id, target.parent_area_kind
    ${TARGETED_AREA_UPSERT}
  `));
}

async function refreshPropertyLocationDivisionMembershipsForPropertyIds(
  propertyIds: readonly string[]
): Promise<void> {
  const ids = [...new Set(propertyIds.filter(Boolean))];
  if (ids.length === 0) {
    return;
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('location_search_areas_targeted_refresh'))`);
    await tx.execute(sql`
      CREATE TEMP TABLE affected_property_ids (
        id uuid PRIMARY KEY
      ) ON COMMIT DROP
    `);
    await tx.execute(sql`
      INSERT INTO affected_property_ids (id)
      VALUES ${sql.join(ids.map((id) => sql`(${id})`), sql`, `)}
      ON CONFLICT DO NOTHING
    `);

    await tx.execute(sql`
      CREATE TEMP TABLE affected_overture_location_search_area_keys (
        area_kind varchar(16) NOT NULL,
        division_id text NOT NULL,
        PRIMARY KEY (area_kind, division_id)
      ) ON COMMIT DROP
    `);

    await tx.execute(sql`
      INSERT INTO affected_overture_location_search_area_keys (area_kind, division_id)
      SELECT DISTINCT membership.area_kind, membership.division_id
      FROM property_location_division_memberships membership
      JOIN affected_property_ids affected ON affected.id = membership.property_id
      ON CONFLICT DO NOTHING
    `);

    await tx.execute(sql`
      DELETE FROM property_location_division_memberships membership
      USING affected_property_ids affected
      WHERE membership.property_id = affected.id
    `);

    await createPropertyLocationDivisionMembershipsStaging(
      tx,
      'affected_property_location_division_memberships',
      'temp'
    );
    await insertRankedPropertyLocationDivisionMembershipCandidates(
      tx,
      'affected_property_location_division_memberships',
      'JOIN affected_property_ids affected ON affected.id = p.id'
    );
    await copyPropertyLocationDivisionMembershipsFromStaging(
      tx,
      'affected_property_location_division_memberships'
    );

    await createAffectedLocationSearchAreaTargets(tx);
    await insertAffectedLocationSearchAreaTargetsFromProperties(tx);

    await tx.execute(sql`
      INSERT INTO affected_overture_location_search_area_keys (area_kind, division_id)
      SELECT DISTINCT membership.area_kind, membership.division_id
      FROM property_location_division_memberships membership
      JOIN affected_property_ids affected ON affected.id = membership.property_id
      ON CONFLICT DO NOTHING
    `);

    await refreshOvertureLocationSearchAreasForAffectedDivisions(tx);
    await refreshLocationSearchAreasForAffectedTargets(tx);
  });
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

async function countPropertyLocationDivisionMembershipsByKind(
  executor: QueryExecutor,
  countryCodes: readonly string[] = []
): Promise<Record<string, number>> {
  const normalizedCountryCodes = normalizeCountryCodes(countryCodes);
  const rows = Array.from(
    (await executor.execute(sql.raw(`
      SELECT area_kind, COUNT(*)::int AS count
      FROM property_location_division_memberships
      ${
        normalizedCountryCodes.length > 0
          ? `WHERE country_code IN (${countryCodeSqlList(normalizedCountryCodes)})`
          : ''
      }
      GROUP BY area_kind
      ORDER BY area_kind
    `))) as Iterable<AreaKindCountRow>
  );

  return Object.fromEntries(rows.map((row) => [row.area_kind, Number(row.count)]));
}

async function runProfiled<T>(
  label: string,
  enabled: boolean,
  logger: RebuildLogger | undefined,
  run: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    return await run();
  } finally {
    if (enabled) {
      logger?.info?.(`Location search rebuild phase: ${label}`, {
        durationMs: Date.now() - start,
      });
    }
  }
}

export async function rebuildLocationSearchAreas(
  options: RebuildLocationSearchAreasOptions = {}
): Promise<{ beforeCount: number; afterCount: number }> {
  const startedAt = Date.now();
  const countryCodes = normalizeCountryCodes(options.countries);
  const beforeCount = await countLocationSearchAreas(db);

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL synchronous_commit = off`);

    if (options.rebuildOvertureMemberships) {
      await runProfiled(
        'overture_memberships',
        options.profile ?? false,
        options.logger,
        async () => {
          await rebuildPropertyLocationDivisionMemberships(tx, countryCodes);
        }
      );
    }

    await runProfiled('search_area_staging', options.profile ?? false, options.logger, async () => {
      await tx.execute(sql`
        CREATE TEMP TABLE location_search_areas_rebuild
        (LIKE location_search_areas INCLUDING DEFAULTS)
        ON COMMIT DROP
      `);

      for (const insertTemplate of OVERTURE_FULL_INSERTS) {
        await tx.execute(
          locationSearchAreaInsertSql(
            insertTemplate,
            'location_search_areas_rebuild',
            countryCodes
          )
        );
      }

      await tx.execute(sql`
        CREATE INDEX location_search_areas_rebuild_overture_match_idx
          ON location_search_areas_rebuild (
            area_kind,
            source,
            country_code,
            match_value
          )
          WHERE source = 'overture'
      `);
      await tx.execute(sql`ANALYZE location_search_areas_rebuild`);

      for (const insertTemplate of PROPERTY_FULL_INSERTS) {
        await tx.execute(
          locationSearchAreaInsertSql(
            insertTemplate,
            'location_search_areas_rebuild',
            countryCodes
          )
        );
      }
    });

    const stagingCounts = await countLocationSearchAreasByKind(
      tx,
      'location_search_areas_rebuild'
    );
    if ((stagingCounts.country ?? 0) <= 0) {
      throw new Error('location_search_areas rebuild produced no active country coverage');
    }

    await runProfiled('search_area_swap', options.profile ?? false, options.logger, async () => {
      if (countryCodes.length > 0) {
        await tx.execute(sql.raw(`
          DELETE FROM location_search_areas
          WHERE country_code IN (${countryCodeSqlList(countryCodes)})
        `));
      } else {
        await tx.execute(sql`TRUNCATE location_search_areas`);
      }
      await tx.execute(sql.raw(`
        INSERT INTO location_search_areas (${AREA_COLUMNS})
        SELECT ${AREA_COLUMNS}
        FROM (
          SELECT DISTINCT ON (area_key)
            ${AREA_COLUMNS}
          FROM location_search_areas_rebuild
          ORDER BY
            area_key,
            CASE WHEN source = 'overture' THEN 0 ELSE 1 END,
            property_count DESC,
            match_value
        ) deduped
      `));
      await tx.execute(sql`ANALYZE location_search_areas`);
    });
    return {
      afterCount: await countLocationSearchAreas(tx),
      countsByKind: await countLocationSearchAreasByKind(tx, 'location_search_areas'),
      membershipCountsByKind: await countPropertyLocationDivisionMembershipsByKind(
        tx,
        countryCodes
      ),
    };
  });

  options.logger?.info?.('Rebuilt location search areas', {
    beforeCount,
    afterCount: result.afterCount,
    countsByKind: result.countsByKind,
    membershipCountsByKind: result.membershipCountsByKind,
    countries: countryCodes.length > 0 ? countryCodes : 'all',
    rebuiltOvertureMemberships: options.rebuildOvertureMemberships ?? false,
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
  await refreshPropertyLocationDivisionMembershipsForPropertyIds(propertyIds);
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

  const targetRows = normalizedKeys.flatMap((key) => {
    const countryCode = key.countryCode;
    if (!countryCode) {
      return [];
    }
    const rows: Array<{
      scopeKey: string;
      countryCode: string;
      cityMatch: string | null;
      cityToken: string | null;
      regionMatch: string | null;
      regionToken: string | null;
      postcodeMatch: string | null;
      postcodePrefix: string | null;
      streetMatch: string | null;
      streetToken: string | null;
    }> = [];
    const cityMatch = normalizeTextValue(key.city);
    const cityToken = normalizeTokenValue(key.city);
    const regionMatch = normalizeTextValue(key.region);
    const regionToken = normalizeTokenValue(key.region);
    const postcodeMatch = normalizePostcodeValue(key.postalCode);
    const postcodePrefix =
      postcodeMatch && /^\d{4}[a-z]{2}$/u.test(postcodeMatch)
        ? postcodeMatch.slice(0, 4)
        : null;
    const streetMatch = normalizeTextValue(key.street);
    const streetToken = normalizeTokenValue(key.street);

    rows.push({
      scopeKey: `country:${countryCode}`,
      countryCode,
      cityMatch: null,
      cityToken: null,
      regionMatch: null,
      regionToken: null,
      postcodeMatch: null,
      postcodePrefix: null,
      streetMatch: null,
      streetToken: null,
    });
    if (cityMatch && cityToken) {
      rows.push({
        scopeKey: `city:${countryCode}:${cityToken}`,
        countryCode,
        cityMatch,
        cityToken,
        regionMatch: null,
        regionToken: null,
        postcodeMatch: null,
        postcodePrefix: null,
        streetMatch: null,
        streetToken: null,
      });
    }
    if (cityMatch && cityToken && regionMatch && regionToken) {
      rows.push({
        scopeKey: `city:${countryCode}:${cityToken}:region=${regionToken}`,
        countryCode,
        cityMatch,
        cityToken,
        regionMatch,
        regionToken,
        postcodeMatch: null,
        postcodePrefix: null,
        streetMatch: null,
        streetToken: null,
      });
    }
    if (regionMatch && regionToken) {
      rows.push({
        scopeKey: `region:${countryCode}:${regionToken}`,
        countryCode,
        cityMatch: null,
        cityToken: null,
        regionMatch,
        regionToken,
        postcodeMatch: null,
        postcodePrefix: null,
        streetMatch: null,
        streetToken: null,
      });
    }
    if (postcodeMatch) {
      rows.push({
        scopeKey: `postcode:${countryCode}:${postcodeMatch}`,
        countryCode,
        cityMatch: null,
        cityToken: null,
        regionMatch: null,
        regionToken: null,
        postcodeMatch,
        postcodePrefix: null,
        streetMatch: null,
        streetToken: null,
      });
    }
    if (postcodePrefix) {
      rows.push({
        scopeKey: `postcode-prefix:${countryCode}:${postcodePrefix}`,
        countryCode,
        cityMatch: null,
        cityToken: null,
        regionMatch: null,
        regionToken: null,
        postcodeMatch: null,
        postcodePrefix,
        streetMatch: null,
        streetToken: null,
      });
    }
    if (streetMatch && streetToken && cityMatch && cityToken) {
      rows.push({
        scopeKey: `street:${countryCode}:${streetToken}:city=${cityToken}`,
        countryCode,
        cityMatch,
        cityToken,
        regionMatch: null,
        regionToken: null,
        postcodeMatch: null,
        postcodePrefix: null,
        streetMatch,
        streetToken,
      });
    }

    return rows;
  });

  if (targetRows.length === 0) {
    return;
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('location_search_areas_targeted_refresh'))`);
    await createAffectedLocationSearchAreaTargets(tx);
    await tx.execute(sql`
      INSERT INTO affected_location_search_area_targets (
        scope_key,
        country_code,
        city_match,
        city_token,
        region_match,
        region_token,
        postcode_match,
        postcode_prefix,
        street_match,
        street_token,
        parent_division_id,
        parent_area_kind
      )
      VALUES ${sql.join(
        targetRows.map(
          (row) => sql`(
            ${row.scopeKey},
            ${row.countryCode},
            ${row.cityMatch},
            ${row.cityToken},
            ${row.regionMatch},
            ${row.regionToken},
            ${row.postcodeMatch},
            ${row.postcodePrefix},
            ${row.streetMatch},
            ${row.streetToken},
            NULL,
            NULL
          )`
        ),
        sql`, `
      )}
      ON CONFLICT DO NOTHING
    `);
    await tx.execute(sql`ANALYZE affected_location_search_area_targets`);
    await refreshLocationSearchAreasForAffectedTargets(tx);
  });
}
