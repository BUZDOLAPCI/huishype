import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import {
  getCountryConfig,
  isValidCountryCode,
  type CountryCode,
  type LocationFilterToken,
  type GeocodeSuggestion,
} from '@huishype/shared';
import { parseLocationFilterToken } from '../services/map-filters.js';

/** Photon GeoJSON feature shape (subset we use) */
interface PhotonFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
  properties: {
    osm_type?: string;
    osm_id?: number;
    name?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    locality?: string;
    district?: string;
    county?: string;
    city?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    type?: string;
  };
}

interface PhotonResponse {
  type: 'FeatureCollection';
  features: PhotonFeature[];
}

const PHOTON_COUNTRY_FILTER_MULTIPLIER = 5;
const PHOTON_COUNTRY_FILTER_MAX_LIMIT = 20;
const REVERSE_GEOCODE_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const REVERSE_GEOCODE_CACHE_MAX_ENTRIES = 2_048;
const REVERSE_GEOCODE_CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';

const searchQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(20).default(5),
  lang: z.string().optional(),
  countrycode: z.string().optional(),
  countrymode: z.enum(['soft']).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
});

const locationSearchQuerySchema = searchQuerySchema.omit({ lang: true, countrymode: true });

const locationTokenHydrationQuerySchema = z.object({
  area: z.union([z.string(), z.array(z.string())]).optional(),
  countrycode: z.union([z.string(), z.array(z.string())]).optional(),
});

const reverseQuerySchema = z.object({
  lon: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  lang: z.string().optional(),
});

const geocodeSuggestionSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  street: z.string().optional(),
  houseNumber: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  countryCode: z.string().optional(),
  coordinates: z.tuple([z.number(), z.number()]),
});

const locationFilterTokenSchema = z.object({
  id: z.string().nullable().optional(),
  type: z.enum(['street', 'postcode', 'city', 'region', 'country', 'current-location']),
  countryCode: z.string().nullable().optional(),
  value: z.string(),
  label: z.string(),
  parentLabel: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  coordinates: z.tuple([z.number(), z.number()]).nullable().optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().optional(),
  radiusMeters: z.number().nullable().optional(),
});

const locationSearchSuggestionSchema = z.object({
  id: z.string(),
  type: z.enum(['property', 'address', 'street', 'postcode', 'city', 'region', 'country']),
  label: z.string(),
  subtitle: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
  coordinates: z.tuple([z.number(), z.number()]).nullable().optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().optional(),
  propertyId: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  houseNumber: z.string().nullable().optional(),
  houseNumberAddition: z.string().nullable().optional(),
  filterToken: locationFilterTokenSchema.nullable().optional(),
});

type LocationSearchSuggestionResponse = z.infer<typeof locationSearchSuggestionSchema>;

const reverseGeocodeResponseSchema = z.nullable(
  z.object({
    locality: z.string().nullable(),
    district: z.string().nullable(),
    county: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    country: z.string().nullable(),
    countryCode: z.string().nullable(),
  })
);

type ReverseGeocodeResponse = z.infer<typeof reverseGeocodeResponseSchema>;

type ReverseGeocodeCacheEntry = {
  expiresAt: number;
  value: ReverseGeocodeResponse;
};

const reverseGeocodeCache = new Map<string, ReverseGeocodeCacheEntry>();

export function resetReverseGeocodeCacheForTests(): void {
  reverseGeocodeCache.clear();
}

function buildReverseGeocodeCacheKey(lon: number, lat: number, lang: string | undefined): string {
  return `${lon.toFixed(5)}:${lat.toFixed(5)}:${lang ?? ''}`;
}

function getCachedReverseGeocode(cacheKey: string): ReverseGeocodeResponse | undefined {
  const entry = reverseGeocodeCache.get(cacheKey);
  const now = Date.now();

  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= now) {
    reverseGeocodeCache.delete(cacheKey);
    return undefined;
  }

  reverseGeocodeCache.delete(cacheKey);
  reverseGeocodeCache.set(cacheKey, entry);
  return entry.value;
}

function setCachedReverseGeocode(cacheKey: string, value: ReverseGeocodeResponse): void {
  const now = Date.now();

  for (const [key, entry] of reverseGeocodeCache) {
    if (entry.expiresAt <= now) {
      reverseGeocodeCache.delete(key);
    }
  }

  while (reverseGeocodeCache.size >= REVERSE_GEOCODE_CACHE_MAX_ENTRIES) {
    const oldestKey = reverseGeocodeCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    reverseGeocodeCache.delete(oldestKey);
  }

  reverseGeocodeCache.set(cacheKey, {
    expiresAt: now + REVERSE_GEOCODE_CACHE_TTL_MS,
    value,
  });
}

/**
 * Format a Photon feature into a human-readable display name.
 * Constructs "Street HouseNumber, PostalCode City" style strings.
 */
function formatDisplayName(props: PhotonFeature['properties']): string {
  const parts: string[] = [];

  // Street + house number
  if (props.street) {
    let streetPart = props.street;
    if (props.housenumber) {
      streetPart += ` ${props.housenumber}`;
    }
    parts.push(streetPart);
  } else if (props.name) {
    parts.push(props.name);
  }

  // PostalCode + City
  const locationParts: string[] = [];
  if (props.postcode) locationParts.push(props.postcode);
  if (props.city) locationParts.push(props.city);
  if (locationParts.length > 0) {
    parts.push(locationParts.join(' '));
  }

  return parts.join(', ') || 'Unknown location';
}

/**
 * Transform a Photon feature into our internal GeocodeSuggestion format.
 */
function transformFeature(feature: PhotonFeature): GeocodeSuggestion {
  const { properties: props, geometry } = feature;

  return {
    id: `${props.osm_type || 'N'}_${props.osm_id || 0}`,
    displayName: formatDisplayName(props),
    street: props.street,
    houseNumber: props.housenumber,
    postalCode: props.postcode,
    city: props.city,
    region: props.state,
    countryCode: props.countrycode,
    coordinates: geometry.coordinates,
  };
}

function normalizeCountryCode(countrycode: string | undefined): CountryCode | undefined {
  const normalized = countrycode?.trim().toUpperCase();
  return normalized && isValidCountryCode(normalized) ? normalized : undefined;
}

function normalizeCountryCodeValues(
  countrycode: string | string[] | undefined
): CountryCode[] {
  const values = Array.isArray(countrycode) ? countrycode : countrycode ? [countrycode] : [];
  const deduped = new Set<CountryCode>();

  for (const value of values) {
    const normalized = normalizeCountryCode(value);
    if (normalized) {
      deduped.add(normalized);
    }
  }

  return Array.from(deduped);
}

function getSingleCountryFallback(countrycode: string | string[] | undefined): CountryCode | undefined {
  const countryCodes = normalizeCountryCodeValues(countrycode);
  return countryCodes.length === 1 ? countryCodes[0] : undefined;
}

function matchesCountryCode(
  feature: PhotonFeature,
  requestedCountryCode: CountryCode | undefined
): boolean {
  if (!requestedCountryCode) {
    return true;
  }

  return feature.properties.countrycode?.trim().toUpperCase() === requestedCountryCode;
}

type PhotonSearchOptions = {
  q: string;
  limit: number;
  lang?: string;
  countryCode?: CountryCode;
  proximity?: { lon: number; lat: number };
};

function getSearchProximity(
  lon: number | undefined,
  lat: number | undefined
): { lon: number; lat: number } | undefined {
  return lon !== undefined && lat !== undefined ? { lon, lat } : undefined;
}

function buildPhotonSearchParams({
  q,
  limit,
  lang,
  countryCode,
  proximity,
}: PhotonSearchOptions): URLSearchParams {
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (lang) params.set('lang', lang);
  if (countryCode) params.set('countrycode', countryCode.toLowerCase());

  if (proximity) {
    params.set('lon', String(proximity.lon));
    params.set('lat', String(proximity.lat));
  } else if (countryCode) {
    const [lon, lat] = getCountryConfig(countryCode).defaultCenter;
    params.set('lon', String(lon));
    params.set('lat', String(lat));
  }

  return params;
}

async function fetchPhotonFeatures(
  app: FastifyInstance,
  options: PhotonSearchOptions
): Promise<PhotonFeature[]> {
  const photonParams = buildPhotonSearchParams(options);
  const photonUrl = `${config.photon.url}/api?${photonParams.toString()}`;
  const response = await fetch(photonUrl, {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    let responseBody = '';
    try {
      responseBody = await (
        response as Response & { text?: () => Promise<string> }
      ).text?.();
    } catch {
      responseBody = '';
    }

    app.log.warn(
      {
        status: response.status,
        statusText: response.statusText,
        body: responseBody.slice(0, 500),
      },
      'Photon search request failed'
    );
    return [];
  }

  const data = (await response.json()) as PhotonResponse;
  return Array.isArray(data.features) ? data.features : [];
}

function mergeDedupedSuggestions(
  preferredFeatures: PhotonFeature[],
  fallbackFeatures: PhotonFeature[],
  limit: number
): GeocodeSuggestion[] {
  const deduped = new Map<string, GeocodeSuggestion>();

  for (const feature of [...preferredFeatures, ...fallbackFeatures]) {
    const suggestion = transformFeature(feature);
    if (!deduped.has(suggestion.id)) {
      deduped.set(suggestion.id, suggestion);
    }
    if (deduped.size >= limit) {
      break;
    }
  }

  return Array.from(deduped.values());
}

function normalizeSearchToken(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeHouseNumberAddition(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

function parseHouseNumberParts(
  raw: string | undefined
): { houseNumber: number; houseNumberAddition: string } | null {
  const match = raw?.trim().match(/^(\d+)\s*[-/]?\s*(.*)$/u);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return {
    houseNumber: parsed,
    houseNumberAddition: normalizeHouseNumberAddition(match[2]),
  };
}

async function resolvePhotonPropertyId(feature: PhotonFeature): Promise<string | null> {
  const props = feature.properties;
  const countryCode = normalizeCountryCode(props.countrycode);
  const houseNumberParts = parseHouseNumberParts(props.housenumber);
  if (!countryCode || !props.postcode || !houseNumberParts) {
    return null;
  }

  const rows = await db.execute<{ id: string }>(sql`
    SELECT p.id
    FROM properties p
    WHERE p.country_code = ${countryCode}
      AND REGEXP_REPLACE(UPPER(p.postal_code), '\\s+', '', 'g')
        = REGEXP_REPLACE(UPPER(${props.postcode}), '\\s+', '', 'g')
      AND p.house_number = ${houseNumberParts.houseNumber}
      AND REGEXP_REPLACE(UPPER(COALESCE(p.house_number_addition, '')), '[^A-Z0-9]+', '', 'g')
        = ${houseNumberParts.houseNumberAddition}
      ${props.street ? sql`AND LOWER(p.street) = LOWER(${props.street})` : sql``}
      ${props.city ? sql`AND LOWER(p.city) = LOWER(${props.city})` : sql``}
    ORDER BY p.id
    LIMIT 2
  `);

  const matches = Array.from(rows);
  return matches.length === 1 ? matches[0]!.id : null;
}

type SupportedFeatureAreaType = 'street' | 'postcode' | 'city' | 'region' | 'country';

function getFeatureAreaType(feature: PhotonFeature): SupportedFeatureAreaType | null {
  const props = feature.properties;
  const rawType = props.type?.toLowerCase();
  if (rawType === 'country') {
    return 'country';
  }
  if (rawType === 'state' || rawType === 'county' || rawType === 'region' || rawType === 'province') {
    return 'region';
  }
  if (props.postcode && !props.street && !props.housenumber) {
    return 'postcode';
  }
  if (props.street || rawType === 'street') {
    return 'street';
  }
  if (
    rawType === 'city' ||
    rawType === 'town' ||
    rawType === 'village' ||
    rawType === 'municipality' ||
    rawType === 'locality'
  ) {
    return 'city';
  }

  return null;
}

function buildLocationSuggestionDedupeKey(
  suggestion: LocationSearchSuggestionResponse | null
): string | null {
  if (!suggestion) {
    return null;
  }

  if (suggestion.filterToken) {
    const token = suggestion.filterToken;
    return [
      'area',
      token.type,
      token.countryCode ?? '',
      normalizeSearchToken(token.value || token.label),
    ].join(':');
  }

  return [suggestion.type, suggestion.propertyId ?? suggestion.id].join(':');
}

async function transformLocationFeature(
  feature: PhotonFeature
): Promise<LocationSearchSuggestionResponse | null> {
  const props = feature.properties;
  const coordinates = feature.geometry.coordinates;
  const countryCode = props.countrycode?.trim().toUpperCase() || null;
  const hasHouse = Boolean(props.housenumber && (props.street || props.name));
  const propertyId = hasHouse ? await resolvePhotonPropertyId(feature) : null;
  const houseNumberParts = parseHouseNumberParts(props.housenumber);

  if (hasHouse) {
    const label = formatDisplayName(props);
    const suggestionType: 'property' | 'address' = propertyId ? 'property' : 'address';
    return {
      id: `${suggestionType}:${props.osm_type || 'N'}_${props.osm_id || 0}`,
      type: suggestionType,
      label,
      subtitle: [props.postcode, props.city].filter(Boolean).join(' ') || null,
      countryCode,
      coordinates,
      propertyId,
      address: label,
      postalCode: props.postcode ?? null,
      city: props.city ?? null,
      region: props.state ?? null,
      street: props.street ?? props.name ?? null,
      houseNumber: props.housenumber ?? null,
      houseNumberAddition: houseNumberParts?.houseNumberAddition || null,
      filterToken: null,
    };
  }

  const type = getFeatureAreaType(feature);
  if (!type) {
    return null;
  }

  const rawLabel =
    type === 'postcode'
      ? props.postcode
      : type === 'country'
        ? props.country
        : props.name || props.street || props.city || props.locality || props.state || props.postcode;
  const label = rawLabel || formatDisplayName(props);
  const parentLabel = [props.city && props.city !== label ? props.city : null, props.state, props.country]
    .filter(Boolean)
    .join(', ');

  const filterToken: LocationFilterToken = {
    type,
    countryCode,
    value: normalizeSearchToken(label),
    label,
    parentLabel: parentLabel || null,
    city: props.city ?? props.locality ?? null,
    region: props.state ?? props.county ?? null,
    postalCode: props.postcode ?? null,
    street: props.street ?? (type === 'street' ? props.name : null) ?? null,
    coordinates,
    bbox: null,
    radiusMeters: null,
  };
  const hydratedFilterToken = await queryHydratedLocationToken(
    filterToken,
    normalizeCountryCode(countryCode ?? undefined)
  );

  return {
    id: `${type}:${countryCode ?? ''}:${normalizeSearchToken(label)}:${props.osm_type || 'N'}_${props.osm_id || 0}`,
    type,
    label,
    subtitle: parentLabel || null,
    countryCode,
    coordinates: hydratedFilterToken.coordinates ?? coordinates,
    bbox: hydratedFilterToken.bbox ?? null,
    propertyId: null,
    address: null,
    postalCode: props.postcode ?? null,
    city: props.city ?? props.locality ?? null,
    region: props.state ?? props.county ?? null,
    street: props.street ?? (type === 'street' ? props.name : null) ?? null,
    houseNumber: null,
    houseNumberAddition: null,
    filterToken: hydratedFilterToken,
  };
}

type LocationTokenHydrationRow = {
  country_code: string | null;
  label: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  street: string | null;
  center_lon: number | string | null;
  center_lat: number | string | null;
  min_lon: number | string | null;
  min_lat: number | string | null;
  max_lon: number | string | null;
  max_lat: number | string | null;
  row_count: number | string;
};

type HydratedLocationFilterToken = LocationFilterToken & { id: string };
type LocationFilterTokenWithId = LocationFilterToken & { id?: string | null };

function parseCoordinate(value: number | string | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildHydratedBbox(row: LocationTokenHydrationRow): [number, number, number, number] | null {
  const minLon = parseCoordinate(row.min_lon);
  const minLat = parseCoordinate(row.min_lat);
  const maxLon = parseCoordinate(row.max_lon);
  const maxLat = parseCoordinate(row.max_lat);
  return minLon == null || minLat == null || maxLon == null || maxLat == null
    ? null
    : [minLon, minLat, maxLon, maxLat];
}

function buildHydratedCoordinates(row: LocationTokenHydrationRow): [number, number] | null {
  const lon = parseCoordinate(row.center_lon);
  const lat = parseCoordinate(row.center_lat);
  return lon == null || lat == null ? null : [lon, lat];
}

function getCountryName(countryCode: string | null | undefined): string | null {
  const normalized = normalizeCountryCode(countryCode ?? undefined);
  return normalized ? getCountryConfig(normalized).name : null;
}

function joinParentLabel(parts: Array<string | null | undefined>): string | null {
  const label = parts.filter(Boolean).join(', ');
  return label || null;
}

function buildTokenId(token: LocationFilterToken): string {
  if (token.type === 'current-location') {
    const [lon, lat] = token.coordinates ?? [];
    const radius = Math.max(1, Math.round(token.radiusMeters ?? 5_000));
    return typeof lon === 'number' &&
      typeof lat === 'number' &&
      Number.isFinite(lon) &&
      Number.isFinite(lat)
      ? `current-location:${lat.toFixed(6)}:${lon.toFixed(6)}:${radius}`
      : `current-location:${normalizeSearchToken(token.value)}`;
  }

  const countryCode = normalizeCountryCode(token.countryCode ?? undefined) ?? '';
  const parts = [token.type, countryCode, normalizeSearchToken(token.value || token.label)];

  if (token.city) parts.push(`city=${normalizeSearchToken(token.city)}`);
  if (token.region) parts.push(`region=${normalizeSearchToken(token.region)}`);
  if (token.postalCode) parts.push(`postcode=${normalizeSearchToken(token.postalCode)}`);

  return parts.join(':');
}

function withHydratedTokenDefaults(token: LocationFilterTokenWithId): HydratedLocationFilterToken {
  const countryCode = normalizeCountryCode(token.countryCode ?? undefined);
  const normalized: LocationFilterToken = {
    ...token,
    countryCode,
    value:
      token.type === 'current-location'
        ? token.value.trim()
        : normalizeSearchToken(token.value || token.label),
    label: token.label || token.value,
    parentLabel: token.parentLabel ?? null,
    city: token.city ?? null,
    region: token.region ?? null,
    postalCode: token.postalCode ?? null,
    street: token.street ?? null,
    coordinates: token.coordinates ?? null,
    bbox: token.bbox ?? null,
    radiusMeters: token.radiusMeters ?? null,
  };

  return {
    ...normalized,
    id: token.id ?? buildTokenId(normalized),
  };
}

function buildHydratedTokenFromRow(
  token: LocationFilterTokenWithId,
  row: LocationTokenHydrationRow
): HydratedLocationFilterToken {
  const countryCode = normalizeCountryCode(row.country_code ?? token.countryCode ?? undefined);
  const countryName = getCountryName(countryCode);
  const label = row.label ?? token.label;
  const hydrated: LocationFilterToken = {
    ...token,
    countryCode,
    label,
    value: normalizeSearchToken(label || token.value),
    city: row.city,
    region: row.region,
    postalCode: row.postal_code,
    street: row.street,
    coordinates: buildHydratedCoordinates(row),
    bbox: buildHydratedBbox(row),
    radiusMeters: null,
  };

  if (token.type === 'street') {
    hydrated.parentLabel = joinParentLabel([row.city, row.region]);
  } else if (token.type === 'postcode') {
    hydrated.parentLabel = joinParentLabel([row.city, row.region]);
  } else if (token.type === 'city') {
    hydrated.parentLabel = joinParentLabel([row.region, countryName]);
  } else if (token.type === 'region') {
    hydrated.parentLabel = countryName;
  } else {
    hydrated.parentLabel = token.parentLabel ?? null;
  }

  return {
    ...hydrated,
    id: buildTokenId(hydrated),
  };
}

function buildHydrationAggregateSelect() {
  return sql`
    AVG(ST_X(p.geometry)) AS center_lon,
    AVG(ST_Y(p.geometry)) AS center_lat,
    MIN(ST_X(p.geometry)) AS min_lon,
    MIN(ST_Y(p.geometry)) AS min_lat,
    MAX(ST_X(p.geometry)) AS max_lon,
    MAX(ST_Y(p.geometry)) AS max_lat,
    COUNT(*) AS row_count
  `;
}

async function queryHydratedLocationToken(
  token: LocationFilterTokenWithId,
  requestedCountryCode: CountryCode | undefined
): Promise<HydratedLocationFilterToken> {
  if (token.type === 'current-location' || token.type === 'country') {
    const countryCode = normalizeCountryCode(token.countryCode ?? undefined) ?? requestedCountryCode ?? null;
    const countryName = getCountryName(countryCode);
    const hydrated = withHydratedTokenDefaults({
      ...token,
      countryCode,
      label: token.type === 'country' && countryName ? countryName : token.label,
      coordinates:
        token.type === 'country' && countryCode ? getCountryConfig(countryCode).defaultCenter : token.coordinates,
    });
    return hydrated;
  }

  const countryCode = normalizeCountryCode(token.countryCode ?? undefined) ?? requestedCountryCode ?? null;
  const countryPredicate = countryCode ? sql`AND p.country_code = ${countryCode}` : sql``;
  const tokenValue = normalizeSearchToken(token.value || token.label);
  const tokenPostalCode = token.postalCode ?? token.label ?? tokenValue;
  const cityLabel = token.city ?? token.label;
  const regionLabel = token.region ?? token.label;
  const streetLabel = token.street ?? token.label;
  const cityPredicate = token.city
    ? sql`AND LOWER(p.city) = LOWER(${token.city})`
    : sql``;
  const regionPredicate = token.region
    ? sql`AND LOWER(p.region) = LOWER(${token.region})`
    : sql``;
  const postalPredicate = token.postalCode
    ? sql`AND REGEXP_REPLACE(UPPER(p.postal_code), '\\s+', '', 'g')
        = REGEXP_REPLACE(UPPER(${tokenPostalCode}), '\\s+', '', 'g')`
    : sql``;

  let rows: LocationTokenHydrationRow[] = [];

  if (token.type === 'city') {
    rows = Array.from(await db.execute<LocationTokenHydrationRow>(sql`
      SELECT
        p.country_code,
        p.city AS label,
        p.city,
        MIN(p.region) AS region,
        NULL::text AS postal_code,
        NULL::text AS street,
        ${buildHydrationAggregateSelect()}
      FROM properties p
      WHERE p.geometry IS NOT NULL
        ${countryPredicate}
        AND LOWER(p.city) = LOWER(${cityLabel})
      GROUP BY p.country_code, p.city
      ORDER BY COUNT(*) DESC
      LIMIT 2
    `));
  } else if (token.type === 'region') {
    rows = Array.from(await db.execute<LocationTokenHydrationRow>(sql`
      SELECT
        p.country_code,
        p.region AS label,
        NULL::text AS city,
        p.region,
        NULL::text AS postal_code,
        NULL::text AS street,
        ${buildHydrationAggregateSelect()}
      FROM properties p
      WHERE p.geometry IS NOT NULL
        ${countryPredicate}
        AND LOWER(p.region) = LOWER(${regionLabel})
      GROUP BY p.country_code, p.region
      ORDER BY COUNT(*) DESC
      LIMIT 2
    `));
  } else if (token.type === 'postcode') {
    rows = Array.from(await db.execute<LocationTokenHydrationRow>(sql`
      SELECT
        p.country_code,
        p.postal_code AS label,
        MIN(p.city) AS city,
        MIN(p.region) AS region,
        p.postal_code,
        NULL::text AS street,
        ${buildHydrationAggregateSelect()}
      FROM properties p
      WHERE p.geometry IS NOT NULL
        ${countryPredicate}
        ${cityPredicate}
        ${regionPredicate}
        AND REGEXP_REPLACE(UPPER(p.postal_code), '\\s+', '', 'g')
          = REGEXP_REPLACE(UPPER(${tokenPostalCode}), '\\s+', '', 'g')
      GROUP BY p.country_code, p.postal_code
      ORDER BY COUNT(*) DESC
      LIMIT 2
    `));
  } else if (token.type === 'street') {
    rows = Array.from(await db.execute<LocationTokenHydrationRow>(sql`
      SELECT
        p.country_code,
        p.street AS label,
        p.city,
        MIN(p.region) AS region,
        MIN(p.postal_code) AS postal_code,
        p.street,
        ${buildHydrationAggregateSelect()}
      FROM properties p
      WHERE p.geometry IS NOT NULL
        ${countryPredicate}
        ${cityPredicate}
        ${regionPredicate}
        ${postalPredicate}
        AND LOWER(p.street) = LOWER(${streetLabel})
      GROUP BY p.country_code, p.street, p.city
      ORDER BY COUNT(*) DESC
      LIMIT 2
    `));
  }

  return rows.length === 1
    ? buildHydratedTokenFromRow(token, rows[0]!)
    : withHydratedTokenDefaults({ ...token, countryCode });
}

function getAreaQueryValues(area: string | string[] | undefined): string[] {
  if (!area) {
    return [];
  }
  return Array.isArray(area) ? area : [area];
}

export async function geocodeRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/search/location-tokens',
    {
      schema: {
        tags: ['Search'],
        summary: 'Hydrate selected location URL tokens',
        description:
          'Hydrates repeated readable area query params into structured selected location tokens for chips and map camera fitting.',
        querystring: locationTokenHydrationQuerySchema,
        response: {
          200: z.array(locationFilterTokenSchema),
        },
      },
    },
    async (request, reply) => {
      const { area, countrycode } = request.query;
      const requestedCountryCode = getSingleCountryFallback(countrycode);
      const parsedTokens = getAreaQueryValues(area)
        .map(parseLocationFilterToken)
        .filter((token): token is LocationFilterToken => token != null);

      try {
        const hydratedTokens = await Promise.all(
          parsedTokens.map((token) => queryHydratedLocationToken(token, requestedCountryCode))
        );
        return reply.send(hydratedTokens);
      } catch (error) {
        app.log.warn({ err: error }, 'Location token hydration unavailable');
        return reply.send(parsedTokens.map(withHydratedTokenDefaults));
      }
    }
  );

  app.get(
    '/search/locations',
    {
      schema: {
        tags: ['Search'],
        summary: 'Typed location search',
        description:
          'Returns typed property/address suggestions for direct navigation and area suggestions for map filtering.',
        querystring: locationSearchQuerySchema,
        response: {
          200: z.array(locationSearchSuggestionSchema),
        },
      },
    },
    async (request, reply) => {
      const { q, limit, countrycode, lon, lat } = request.query;
      const requestedCountryCode = normalizeCountryCode(countrycode);
      const proximity = getSearchProximity(lon, lat);
      const photonLimit = requestedCountryCode
        ? Math.min(
            Math.max(limit * PHOTON_COUNTRY_FILTER_MULTIPLIER, limit),
            PHOTON_COUNTRY_FILTER_MAX_LIMIT
          )
        : limit;

      try {
        const preferredFeatures = await fetchPhotonFeatures(app, {
          q,
          limit: photonLimit,
          countryCode: requestedCountryCode,
          proximity,
        });
        const features =
          requestedCountryCode && preferredFeatures.length === 0
            ? await fetchPhotonFeatures(app, {
                q,
                limit: photonLimit,
                proximity,
              })
            : preferredFeatures;
        const countryFiltered = features
          .filter((feature) => matchesCountryCode(feature, requestedCountryCode))
          .slice(0, limit);
        const transformedSuggestions = await Promise.all(countryFiltered.map(transformLocationFeature));
        const dedupedSuggestions = new Map<string, LocationSearchSuggestionResponse>();

        for (const suggestion of transformedSuggestions) {
          const key = buildLocationSuggestionDedupeKey(suggestion);
          if (suggestion && key && !dedupedSuggestions.has(key)) {
            dedupedSuggestions.set(key, suggestion);
          }
        }

        return reply.send(Array.from(dedupedSuggestions.values()).slice(0, limit));
      } catch (error) {
        app.log.warn({ err: error }, 'Typed location search unavailable');
        return reply.send([]);
      }
    }
  );

  /**
   * GET /geocode/search
   * Proxies to Photon and reformats the response.
   */
  app.get(
    '/geocode/search',
    {
      schema: {
        tags: ['Geocode'],
        summary: 'Forward geocode search',
        description: 'Proxies to Photon geocoder and returns formatted address suggestions.',
        querystring: searchQuerySchema,
        response: {
          200: z.array(geocodeSuggestionSchema),
        },
      },
    },
    async (request, reply) => {
      const { q, limit, lang, countrycode, countrymode, lon, lat } = request.query;
      const requestedCountryCode = normalizeCountryCode(countrycode);
      const proximity = getSearchProximity(lon, lat);
      const photonLimit = requestedCountryCode
        ? Math.min(
            Math.max(limit * PHOTON_COUNTRY_FILTER_MULTIPLIER, limit),
            PHOTON_COUNTRY_FILTER_MAX_LIMIT
          )
        : limit;

      try {
        if (countrymode === 'soft' && requestedCountryCode) {
          const preferredFeatures = (
            await fetchPhotonFeatures(app, {
              q,
              limit: photonLimit,
              lang,
              countryCode: requestedCountryCode,
              proximity,
            })
          )
            .filter((feature) => matchesCountryCode(feature, requestedCountryCode))
            .slice(0, limit);

          if (preferredFeatures.length >= limit) {
            return reply.send(preferredFeatures.map(transformFeature));
          }

          const fallbackFeatures = await fetchPhotonFeatures(app, {
            q,
            limit,
            lang,
            proximity,
          });

          return reply.send(mergeDedupedSuggestions(preferredFeatures, fallbackFeatures, limit));
        }

        const features = await fetchPhotonFeatures(app, {
          q,
          limit: photonLimit,
          lang,
          countryCode: requestedCountryCode,
          proximity,
        });
        const suggestions = features
          .filter((feature) => matchesCountryCode(feature, requestedCountryCode))
          .slice(0, limit)
          .map(transformFeature);

        return reply.send(suggestions);
      } catch (error) {
        // Photon unreachable — return empty results gracefully
        app.log.warn({ err: error }, 'Photon geocoder unreachable');
        return reply.send([]);
      }
    }
  );

  /**
   * GET /geocode/reverse
   * Reverse geocodes a coordinate to a location hierarchy via Photon.
   * Returns locality/district/city/state/country fields or null if nothing found.
   */
  app.get(
    '/geocode/reverse',
    {
      schema: {
        tags: ['Geocode'],
        summary: 'Reverse geocode coordinates',
        description:
          'Reverse geocodes a coordinate to a location hierarchy via Photon. ' +
          'Returns { locality, district, county, city, state, country, countryCode } or null if nothing found.',
        querystring: reverseQuerySchema,
        response: {
          200: reverseGeocodeResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { lon, lat, lang } = request.query;
      const cacheKey = buildReverseGeocodeCacheKey(lon, lat, lang);
      const cached = getCachedReverseGeocode(cacheKey);

      if (cached !== undefined) {
        return reply
          .header('Cache-Control', REVERSE_GEOCODE_CACHE_CONTROL)
          .header('X-Geocode-Cache', 'hit')
          .send(cached);
      }

      const photonParams = new URLSearchParams({
        lon: String(lon),
        lat: String(lat),
      });
      if (lang) photonParams.set('lang', lang);

      try {
        const photonUrl = `${config.photon.url}/reverse?${photonParams.toString()}`;
        const response = await fetch(photonUrl, {
          signal: AbortSignal.timeout(3000),
        });

        if (!response.ok) {
          app.log.warn(`Photon reverse returned ${response.status}: ${response.statusText}`);
          return reply.send(null);
        }

        const data = (await response.json()) as PhotonResponse;
        if (!data.features || data.features.length === 0) {
          setCachedReverseGeocode(cacheKey, null);
          return reply
            .header('Cache-Control', REVERSE_GEOCODE_CACHE_CONTROL)
            .header('X-Geocode-Cache', 'miss')
            .send(null);
        }

        const props = data.features[0].properties;
        const result: ReverseGeocodeResponse = {
          locality: props.locality || null,
          district: props.district || null,
          county: props.county || null,
          city: props.city || null,
          state: props.state || null,
          country: props.country || null,
          countryCode: props.countrycode || null,
        };
        setCachedReverseGeocode(cacheKey, result);
        return reply
          .header('Cache-Control', REVERSE_GEOCODE_CACHE_CONTROL)
          .header('X-Geocode-Cache', 'miss')
          .send(result);
      } catch (error) {
        app.log.warn({ err: error }, 'Photon reverse geocoder unreachable');
        return reply.send(null);
      }
    }
  );
}
