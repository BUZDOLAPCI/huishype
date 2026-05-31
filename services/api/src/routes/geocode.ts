import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { sql, type SQL } from 'drizzle-orm';
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

type DbLocationSearchRow = {
  id: string | null;
  country_code: string | null;
  street: string | null;
  house_number: number | string | null;
  house_number_addition: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  lon: number | string | null;
  lat: number | string | null;
};

type DbPostcodeAreaSearchRow = {
  country_code: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  lon: number | string | null;
  lat: number | string | null;
  row_count: number | string;
  total_count: number | string;
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
  proximity?: SearchProximity;
};

type SearchProximity = { lon: number; lat: number };

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

function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePostalCodeForMatch(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

function normalizeLocationTokenValue(
  type: LocationFilterToken['type'],
  value: string | null | undefined
): string {
  return type === 'postcode'
    ? normalizePostalCodeForMatch(value).toLowerCase()
    : normalizeSearchToken(value);
}

function looksLikePostalCodeSearch(value: string): boolean {
  return value.length >= 3 && value.length <= 10 && /\d/u.test(value);
}

function parseSearchHouseNumber(value: string): {
  streetQuery: string;
  rawStreetQuery: string;
  houseNumber: number | null;
  houseNumberAddition: string | null;
} {
  const trimmed = value.trim();
  const normalized = normalizeSearchText(value);
  const match = normalized.match(/^(.+?[a-z])\s+(\d+)\s*([a-z0-9]*)$/u);
  if (!match) {
    return {
      streetQuery: normalized,
      rawStreetQuery: trimmed,
      houseNumber: null,
      houseNumberAddition: null,
    };
  }

  const rawMatch = trimmed.match(/^(.+?[^\d\s])\s+\d+\s*[a-z0-9]*$/iu);
  const parsed = Number.parseInt(match[2]!, 10);
  return {
    streetQuery: match[1]!.trim(),
    rawStreetQuery: rawMatch?.[1]?.trim() || match[1]!.trim(),
    houseNumber: Number.isSafeInteger(parsed) ? parsed : null,
    houseNumberAddition: normalizeHouseNumberAddition(match[3]) || null,
  };
}

function getPostalCodeSearchCandidates(
  value: string,
  requestedCountryCode: CountryCode | undefined
): string[] {
  const compact = normalizePostalCodeForMatch(value);
  if (!looksLikePostalCodeSearch(compact)) {
    return [];
  }

  const candidates = new Set<string>([compact]);
  if (requestedCountryCode) {
    candidates.add(getCountryConfig(requestedCountryCode).postalCodeNormalize(compact).toUpperCase());
  }
  const dutchPostcodeMatch = compact.match(/^(\d{4})([A-Z]{2})$/u);
  if (dutchPostcodeMatch) {
    candidates.add(`${dutchPostcodeMatch[1]} ${dutchPostcodeMatch[2]}`);
  }

  return Array.from(candidates).filter(Boolean);
}

function buildStringInPredicate(column: SQL, values: readonly string[]): SQL {
  if (values.length === 0) {
    return sql`FALSE`;
  }

  return sql`${column} IN (${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  )})`;
}

function titleCaseSearchText(value: string): string {
  return value.replace(/\p{L}[\p{L}\p{M}'-]*/gu, (word) =>
    word.charAt(0).toLocaleUpperCase('nl-NL') + word.slice(1).toLocaleLowerCase('nl-NL')
  );
}

function titleCaseHyphenatedSearchText(value: string): string {
  return titleCaseSearchText(value)
    .split('-')
    .map((part) => (part ? part.charAt(0).toLocaleUpperCase('nl-NL') + part.slice(1) : part))
    .join('-');
}

function formatDutchPostcode(value: string): string {
  const normalized = normalizePostalCodeForMatch(value);
  const match = normalized.match(/^(\d{4})([A-Z]{2})$/u);
  return match ? `${match[1]} ${match[2]}` : normalized;
}

function getTextSearchCandidates(value: string): string[] {
  const normalized = normalizeSearchText(value);
  const candidates = new Set<string>();
  const trimmed = value.trim();
  if (trimmed) {
    candidates.add(trimmed);
  }
  if (normalized) {
    candidates.add(normalized);
    candidates.add(titleCaseSearchText(normalized));
  }
  return Array.from(candidates);
}

function buildTextCandidatePredicate(column: SQL, value: string): SQL {
  const candidates = getTextSearchCandidates(value);
  if (candidates.length === 0) {
    return sql`FALSE`;
  }

  return sql`${column} IN (${sql.join(
    candidates.map((candidate) => sql`${candidate}`),
    sql`, `
  )})`;
}

function buildNormalizedPostalCodeExpression(column: SQL): SQL {
  return sql`REGEXP_REPLACE(UPPER(COALESCE(${column}, '')), '\\s+', '', 'g')`;
}

function getPostcodePrefixUpperBound(value: string): string | null {
  if (!/^\d{4}$/u.test(value)) {
    return null;
  }

  const next = Number.parseInt(value, 10) + 1;
  return next <= 9999 ? String(next).padStart(4, '0') : null;
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
  const postalCodeCandidates = getPostalCodeSearchCandidates(props.postcode, countryCode);

  const rows = await db.execute<{ id: string }>(sql`
    SELECT p.id
    FROM properties p
    WHERE p.country_code = ${countryCode}
      AND ${buildStringInPredicate(sql`p.postal_code`, postalCodeCandidates)}
      AND p.house_number = ${houseNumberParts.houseNumber}
      AND REGEXP_REPLACE(UPPER(COALESCE(p.house_number_addition, '')), '[^A-Z0-9]+', '', 'g')
        = ${houseNumberParts.houseNumberAddition}
      ${props.street ? sql`AND ${buildTextCandidatePredicate(sql`p.street`, props.street)}` : sql``}
      ${props.city ? sql`AND ${buildTextCandidatePredicate(sql`p.city`, props.city)}` : sql``}
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
  if (rawType === 'street') {
    return 'street';
  }
  if (rawType === 'house') {
    return null;
  }
  if (props.street) {
    return 'street';
  }
  if (props.postcode && !props.street && !props.housenumber) {
    return 'postcode';
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
    if (token.type === 'city' || token.type === 'region' || token.type === 'country') {
      return [
        'area',
        token.type,
        token.countryCode ?? '',
        normalizeLocationTokenValue(token.type, token.value || token.label),
      ].join(':');
    }

    if (token.type === 'street') {
      const street = token.street ?? suggestion.street ?? token.label;
      const city = token.city ?? suggestion.city;
      const region = token.region ?? suggestion.region;
      return [
        'area',
        token.type,
        token.countryCode ?? suggestion.countryCode ?? '',
        street ? `street=${normalizeSearchToken(street)}` : '',
        city ? `city=${normalizeSearchToken(city)}` : '',
        region ? `region=${normalizeSearchToken(region)}` : '',
      ].join(':');
    }

    return [
      'area',
      token.type,
      token.countryCode ?? '',
      normalizeLocationTokenValue(token.type, token.value || token.label),
      token.city ? `city=${normalizeSearchToken(token.city)}` : '',
      token.region ? `region=${normalizeSearchToken(token.region)}` : '',
      token.postalCode ? `postcode=${normalizePostalCodeForMatch(token.postalCode).toLowerCase()}` : '',
      token.street ? `street=${normalizeSearchToken(token.street)}` : '',
    ].join(':');
  }

  return [suggestion.type, suggestion.propertyId ?? suggestion.id].join(':');
}

function isDbBackedAreaSuggestion(suggestion: LocationSearchSuggestionResponse): boolean {
  return Boolean(suggestion.filterToken?.id && suggestion.id === suggestion.filterToken.id);
}

function shouldReplaceLocationSuggestion(
  existing: LocationSearchSuggestionResponse,
  candidate: LocationSearchSuggestionResponse
): boolean {
  return isDbBackedAreaSuggestion(candidate) && !isDbBackedAreaSuggestion(existing);
}

function getSuggestionDistanceScore(
  suggestion: LocationSearchSuggestionResponse | null,
  proximity: SearchProximity | undefined
): number {
  const coordinates = suggestion?.coordinates;
  if (!coordinates || !proximity) {
    return 0;
  }

  const [lon, lat] = coordinates;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return Number.POSITIVE_INFINITY;
  }

  return (lon - proximity.lon) ** 2 + (lat - proximity.lat) ** 2;
}

function sortSuggestionsByProximity(
  suggestions: Array<LocationSearchSuggestionResponse | null>,
  proximity: SearchProximity | undefined,
  q: string
): Array<LocationSearchSuggestionResponse | null> {
  if (!proximity) {
    return suggestions;
  }

  const queryToken = normalizeSearchToken(q);
  return [...suggestions].sort(
    (left, right) => {
      const leftExact = normalizeSearchToken(left?.label) === queryToken ? 0 : 1;
      const rightExact = normalizeSearchToken(right?.label) === queryToken ? 0 : 1;
      if (leftExact !== rightExact) {
        return leftExact - rightExact;
      }

      return (
        getSuggestionDistanceScore(left, proximity) -
        getSuggestionDistanceScore(right, proximity)
      );
    }
  );
}

function formatHouseNumberLabel(
  houseNumber: number | string | null,
  houseNumberAddition: string | null | undefined
): string {
  return `${houseNumber ?? ''}${houseNumberAddition ?? ''}`;
}

function formatDbAddressLabel(row: DbLocationSearchRow): string {
  return [row.street, formatHouseNumberLabel(row.house_number, row.house_number_addition)]
    .filter(Boolean)
    .join(' ');
}

function coordinatesFromDbRow(row: { lon: number | string | null; lat: number | string | null }): [number, number] | null {
  const lon = parseCoordinate(row.lon);
  const lat = parseCoordinate(row.lat);
  return lon == null || lat == null ? null : [lon, lat];
}

function buildDbLocationParentLabel(row: DbLocationSearchRow): string | null {
  return joinParentLabel([row.city, row.region]);
}

function buildDbPropertySuggestion(row: DbLocationSearchRow): LocationSearchSuggestionResponse | null {
  if (!row.id || !row.country_code || !row.street || !row.house_number || !row.city) {
    return null;
  }

  const label = formatDbAddressLabel(row);
  return {
    id: `property:${row.id}`,
    type: 'property',
    label,
    subtitle: [row.postal_code, row.city].filter(Boolean).join(' ') || null,
    countryCode: row.country_code,
    coordinates: coordinatesFromDbRow(row),
    bbox: null,
    propertyId: row.id,
    address: label,
    postalCode: row.postal_code,
    city: row.city,
    region: row.region,
    street: row.street,
    houseNumber: formatHouseNumberLabel(row.house_number, row.house_number_addition),
    houseNumberAddition: row.house_number_addition,
    filterToken: null,
  };
}

function buildDbAreaSuggestion(
  row: DbLocationSearchRow,
  type: 'street' | 'postcode' | 'city'
): LocationSearchSuggestionResponse | null {
  const countryCode = normalizeCountryCode(row.country_code ?? undefined);
  if (!countryCode) {
    return null;
  }

  const label =
    type === 'street' ? row.street : type === 'postcode' ? row.postal_code : row.city;
  if (!label) {
    return null;
  }

  const countryName = getCountryName(countryCode);
  const filterToken: HydratedLocationFilterToken = withHydratedTokenDefaults({
    type,
    countryCode,
    value: label,
    label,
    parentLabel:
      type === 'city'
        ? joinParentLabel([row.region, countryName])
        : buildDbLocationParentLabel(row),
    city: type === 'city' ? label : row.city,
    region: row.region,
    postalCode: type === 'postcode' ? label : null,
    street: type === 'street' ? label : null,
    coordinates: coordinatesFromDbRow(row),
    bbox: null,
    radiusMeters: null,
  });

  return {
    id: filterToken.id,
    type,
    label,
    subtitle: filterToken.parentLabel,
    countryCode,
    coordinates: filterToken.coordinates,
    bbox: null,
    propertyId: null,
    address: null,
    postalCode: filterToken.postalCode,
    city: filterToken.city,
    region: filterToken.region,
    street: filterToken.street,
    houseNumber: null,
    houseNumberAddition: null,
    filterToken,
  };
}

async function queryDbPropertyLocationSuggestions(
  q: string,
  limit: number,
  requestedCountryCode: CountryCode | undefined
): Promise<LocationSearchSuggestionResponse[]> {
  const postalCodeCandidates = getPostalCodeSearchCandidates(q, requestedCountryCode);
  const { rawStreetQuery, houseNumber, houseNumberAddition } = parseSearchHouseNumber(q);
  const usePostal = postalCodeCandidates.length > 0;
  const useStreet = rawStreetQuery.length >= 2 && /[a-z]/iu.test(rawStreetQuery);

  if (!usePostal && !useStreet) {
    return [];
  }

  const countryPredicate = requestedCountryCode
    ? sql`AND p.country_code = ${requestedCountryCode}`
    : sql``;
  const postalPredicate = usePostal
    ? buildStringInPredicate(sql`p.postal_code`, postalCodeCandidates)
    : sql`FALSE`;
  const streetPredicate = useStreet
    ? buildTextCandidatePredicate(sql`p.street`, rawStreetQuery)
    : sql`FALSE`;
  const houseNumberRank = houseNumber != null
    ? sql`CASE WHEN p.house_number = ${houseNumber} THEN 0 ELSE 1 END,`
    : sql``;
  const houseNumberAdditionRank = houseNumberAddition
    ? sql`CASE
        WHEN REGEXP_REPLACE(UPPER(COALESCE(p.house_number_addition, '')), '[^A-Z0-9]+', '', 'g')
          = ${houseNumberAddition} THEN 0
        ELSE 1
      END,`
    : sql``;
  const houseNumberPredicate = houseNumber != null
    ? sql`AND p.house_number = ${houseNumber}`
    : sql``;
  const houseNumberAdditionPredicate = houseNumberAddition
    ? sql`AND REGEXP_REPLACE(UPPER(COALESCE(p.house_number_addition, '')), '[^A-Z0-9]+', '', 'g')
        = ${houseNumberAddition}`
    : sql``;

  const rows = Array.from(await db.execute<DbLocationSearchRow>(sql`
    SELECT
      p.id,
      p.country_code,
      p.street,
      p.house_number,
      p.house_number_addition,
      p.city,
      p.region,
      p.postal_code,
      ST_X(p.geometry) AS lon,
      ST_Y(p.geometry) AS lat
    FROM properties p
    WHERE p.status = 'active'
      ${countryPredicate}
      ${houseNumberPredicate}
      ${houseNumberAdditionPredicate}
      AND (${postalPredicate} OR ${streetPredicate})
    ORDER BY
      CASE
        WHEN ${usePostal} AND ${buildStringInPredicate(sql`p.postal_code`, postalCodeCandidates)} THEN 0
        WHEN ${useStreet} AND ${buildTextCandidatePredicate(sql`p.street`, rawStreetQuery)} THEN 1
        WHEN ${usePostal} THEN 2
        WHEN ${useStreet} THEN 3
        ELSE 5
      END,
      ${houseNumberRank}
      ${houseNumberAdditionRank}
      p.country_code,
      p.city,
      p.street,
      p.house_number,
      p.house_number_addition NULLS FIRST
    LIMIT ${Math.max(limit, 6)}
  `));

  return rows
    .map(buildDbPropertySuggestion)
    .filter((suggestion): suggestion is LocationSearchSuggestionResponse => suggestion != null);
}

async function queryDbAreaLocationSuggestions(
  q: string,
  limit: number,
  requestedCountryCode: CountryCode | undefined
): Promise<LocationSearchSuggestionResponse[]> {
  const rawText = normalizeSearchText(q);
  const postalCodeCandidates = getPostalCodeSearchCandidates(q, requestedCountryCode);
  const { rawStreetQuery } = parseSearchHouseNumber(q);
  const countryPredicate = requestedCountryCode
    ? sql`AND p.country_code = ${requestedCountryCode}`
    : sql``;
  const suggestions: LocationSearchSuggestionResponse[] = [];

  if (postalCodeCandidates.length > 0) {
    const rows = Array.from(await db.execute<DbLocationSearchRow>(sql`
      SELECT DISTINCT ON (p.country_code, p.postal_code)
        NULL::uuid AS id,
        p.country_code,
        NULL::text AS street,
        NULL::integer AS house_number,
        NULL::text AS house_number_addition,
        p.city,
        p.region,
        p.postal_code,
        ST_X(p.geometry) AS lon,
        ST_Y(p.geometry) AS lat
      FROM properties p
      WHERE p.status = 'active'
        ${countryPredicate}
        AND ${buildStringInPredicate(sql`p.postal_code`, postalCodeCandidates)}
      ORDER BY
        p.country_code,
        p.postal_code,
        p.house_number,
        p.id
      LIMIT ${Math.max(1, Math.min(limit, 3))}
    `));
    suggestions.push(
      ...rows
        .map((row) => buildDbAreaSuggestion(row, 'postcode'))
        .filter((suggestion): suggestion is LocationSearchSuggestionResponse => suggestion != null)
    );

    if (rows.length === 0) {
      suggestions.push(
        ...(await queryDbPostcodePrefixFallbackSuggestions(
          postalCodeCandidates[0]!,
          requestedCountryCode
        ))
      );
    }
  }

  if (rawText.length >= 2 && /[a-z]/iu.test(rawText)) {
    const rows = Array.from(await db.execute<DbLocationSearchRow>(sql`
      SELECT DISTINCT ON (p.country_code, p.city)
        NULL::uuid AS id,
        p.country_code,
        NULL::text AS street,
        NULL::integer AS house_number,
        NULL::text AS house_number_addition,
        p.city,
        p.region,
        p.postal_code,
        ST_X(p.geometry) AS lon,
        ST_Y(p.geometry) AS lat
      FROM properties p
      WHERE p.status = 'active'
        ${countryPredicate}
        AND ${buildTextCandidatePredicate(sql`p.city`, rawText)}
      ORDER BY
        p.country_code,
        p.city,
        p.house_number,
        p.id
      LIMIT ${Math.max(1, Math.min(limit, 3))}
    `));
    suggestions.push(
      ...rows
        .map((row) => buildDbAreaSuggestion(row, 'city'))
        .filter((suggestion): suggestion is LocationSearchSuggestionResponse => suggestion != null)
    );
  }

  if (rawStreetQuery.length >= 2 && /[a-z]/iu.test(rawStreetQuery)) {
    const rows = Array.from(await db.execute<DbLocationSearchRow>(sql`
      SELECT DISTINCT ON (p.country_code, p.street, p.city)
        NULL::uuid AS id,
        p.country_code,
        p.street,
        NULL::integer AS house_number,
        NULL::text AS house_number_addition,
        p.city,
        p.region,
        p.postal_code,
        ST_X(p.geometry) AS lon,
        ST_Y(p.geometry) AS lat
      FROM properties p
      WHERE p.status = 'active'
        ${countryPredicate}
        AND ${buildTextCandidatePredicate(sql`p.street`, rawStreetQuery)}
      ORDER BY
        p.country_code,
        p.street,
        p.city,
        p.house_number,
        p.id
      LIMIT ${Math.max(1, Math.min(limit, 3))}
    `));
    suggestions.push(
      ...rows
        .map((row) => buildDbAreaSuggestion(row, 'street'))
        .filter((suggestion): suggestion is LocationSearchSuggestionResponse => suggestion != null)
    );
  }

  return suggestions;
}

async function queryDbLocationSuggestions(
  app: FastifyInstance,
  q: string,
  limit: number,
  requestedCountryCode: CountryCode | undefined
): Promise<LocationSearchSuggestionResponse[]> {
  try {
    const [areaSuggestions, propertySuggestions] = await Promise.all([
      queryDbAreaLocationSuggestions(q, limit, requestedCountryCode),
      queryDbPropertyLocationSuggestions(q, limit, requestedCountryCode),
    ]);
    return parseSearchHouseNumber(q).houseNumber == null
      ? [...areaSuggestions, ...propertySuggestions]
      : [...propertySuggestions, ...areaSuggestions];
  } catch (error) {
    app.log.warn({ err: error }, 'DB location search fallback unavailable');
    return [];
  }
}

function buildLocationFilterTokenFromFeature(
  feature: PhotonFeature,
  type: SupportedFeatureAreaType,
  label: string,
  requestedCountryCode: CountryCode | undefined
): LocationFilterToken {
  const props = feature.properties;
  const coordinates = feature.geometry.coordinates;
  const countryCode = normalizeCountryCode(props.countrycode) ?? requestedCountryCode ?? null;
  const city = type === 'city' ? label : props.city ?? props.locality ?? null;
  const parentLabel = [
    type !== 'city' && props.city && props.city !== label ? props.city : null,
    props.state,
    props.country,
  ]
    .filter(Boolean)
    .join(', ');

  return {
    type,
    countryCode,
    value: normalizeLocationTokenValue(type, label),
    label,
    parentLabel: parentLabel || null,
    city,
    region: type === 'street' ? null : (props.state ?? props.county ?? null),
    postalCode: type === 'street' ? null : (props.postcode ?? null),
    street: props.street ?? (type === 'street' ? props.name : null) ?? null,
    coordinates,
    bbox: null,
    radiusMeters: null,
  };
}

async function queryAreaTokenHasBackingRows(
  token: LocationFilterToken,
  requestedCountryCode: CountryCode | undefined
): Promise<boolean> {
  if (token.type === 'country') {
    return true;
  }
  if (token.type === 'current-location') {
    return false;
  }

  const countryCode = normalizeCountryCode(token.countryCode ?? undefined) ?? requestedCountryCode;
  const countryPredicate = countryCode ? sql`AND p.country_code = ${countryCode}` : sql``;
  const cityPredicate = token.city && token.type !== 'city'
    ? sql`AND ${buildTextCandidatePredicate(sql`p.city`, token.city)}`
    : sql``;
  const regionPredicate = token.region && token.type !== 'street'
    ? sql`AND ${buildTextCandidatePredicate(sql`p.region`, token.region)}`
    : sql``;
  let predicate = sql`FALSE`;

  if (token.type === 'city') {
    predicate = buildTextCandidatePredicate(sql`p.city`, token.label);
  } else if (token.type === 'region') {
    predicate = buildTextCandidatePredicate(sql`p.region`, token.label);
  } else if (token.type === 'postcode') {
    const postalCodeCandidates = getPostalCodeSearchCandidates(
      token.postalCode ?? token.label,
      countryCode
    );
    predicate = buildStringInPredicate(sql`p.postal_code`, postalCodeCandidates);
  } else if (token.type === 'street') {
    const street = token.street ?? token.label;
    predicate = buildTextCandidatePredicate(sql`p.street`, street);
  }

  const rows = Array.from(await db.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1
      FROM properties p
      WHERE p.status = 'active'
        ${countryPredicate}
        ${cityPredicate}
        ${regionPredicate}
        AND ${predicate}
      LIMIT 1
    ) AS exists
  `));

  return rows[0]?.exists === true;
}

function isNeighborhoodLikeFeature(feature: PhotonFeature, label: string): boolean {
  const props = feature.properties;
  const photonType = props.type?.toLowerCase();
  const parentCity = props.city ?? props.locality;

  return (
    (photonType === 'locality' ||
      photonType === 'neighbourhood' ||
      photonType === 'neighborhood' ||
      photonType === 'district') &&
    Boolean(parentCity) &&
    normalizeSearchToken(parentCity) !== normalizeSearchToken(label)
  );
}

function buildDbPostcodeAreaSuggestion(
  row: DbPostcodeAreaSearchRow,
  displayLabel: string
): LocationSearchSuggestionResponse | null {
  const countryCode = normalizeCountryCode(row.country_code ?? undefined);
  if (!countryCode || !row.postal_code || !row.city) {
    return null;
  }

  const postalCode = normalizePostalCodeForMatch(row.postal_code);
  const countryName = getCountryName(countryCode);
  const filterToken: HydratedLocationFilterToken = withHydratedTokenDefaults({
    type: 'postcode',
    countryCode,
    value: postalCode,
    label: displayLabel,
    parentLabel: joinParentLabel([postalCode, row.city, row.region, countryName]),
    city: row.city,
    region: row.region,
    postalCode,
    street: null,
    coordinates: coordinatesFromDbRow(row),
    bbox: null,
    radiusMeters: null,
  });

  return {
    id: filterToken.id,
    type: 'postcode',
    label: displayLabel,
    subtitle: filterToken.parentLabel,
    countryCode,
    coordinates: filterToken.coordinates,
    bbox: null,
    propertyId: null,
    address: null,
    postalCode,
    city: filterToken.city,
    region: filterToken.region,
    street: null,
    houseNumber: null,
    houseNumberAddition: null,
    filterToken,
  };
}

function buildSyntheticPostcodeAddressSuggestion(
  row: DbPostcodeAreaSearchRow,
  postalCode: string
): LocationSearchSuggestionResponse | null {
  const countryCode = normalizeCountryCode(row.country_code ?? undefined);
  if (!countryCode || !row.city) {
    return null;
  }

  const formattedPostcode = formatDutchPostcode(postalCode);
  const label = [formattedPostcode, row.city].filter(Boolean).join(' ');

  return {
    id: `address:${countryCode}:${normalizePostalCodeForMatch(postalCode).toLowerCase()}:${normalizeSearchToken(row.city)}`,
    type: 'address',
    label,
    subtitle: joinParentLabel([row.region, getCountryName(countryCode)]),
    countryCode,
    coordinates: coordinatesFromDbRow(row),
    bbox: null,
    propertyId: null,
    address: label,
    postalCode: normalizePostalCodeForMatch(postalCode),
    city: row.city,
    region: row.region,
    street: null,
    houseNumber: null,
    houseNumberAddition: null,
    filterToken: null,
  };
}

async function queryDbPostcodePrefixFallbackSuggestions(
  postalCode: string,
  requestedCountryCode: CountryCode | undefined
): Promise<LocationSearchSuggestionResponse[]> {
  const normalized = normalizePostalCodeForMatch(postalCode);
  const prefix = normalized.slice(0, 4);
  const upperBound = getPostcodePrefixUpperBound(prefix);
  if (!requestedCountryCode || !upperBound || !/^\d{4}[A-Z]{2}$/u.test(normalized)) {
    return [];
  }

  const rows = Array.from(await db.execute<DbPostcodeAreaSearchRow>(sql`
    SELECT
      p.country_code,
      MIN(p.city) AS city,
      MIN(p.region) AS region,
      ${normalized}::text AS postal_code,
      AVG(ST_X(p.geometry)) AS lon,
      AVG(ST_Y(p.geometry)) AS lat,
      COUNT(*) AS row_count,
      COUNT(*) AS total_count
    FROM properties p
    WHERE p.status = 'active'
      AND p.country_code = ${requestedCountryCode}
      AND p.geometry IS NOT NULL
      AND p.postal_code >= ${prefix}
      AND p.postal_code < ${upperBound}
      AND ${buildNormalizedPostalCodeExpression(sql`p.postal_code`)} >= ${prefix}
      AND ${buildNormalizedPostalCodeExpression(sql`p.postal_code`)} < ${upperBound}
    GROUP BY p.country_code
    ORDER BY COUNT(*) DESC
    LIMIT 1
  `));
  const row = rows[0];
  if (!row || Number(row.row_count) <= 0) {
    return [];
  }

  return [
    buildDbPostcodeAreaSuggestion(row, formatDutchPostcode(normalized)),
    buildSyntheticPostcodeAddressSuggestion(row, normalized),
  ].filter((suggestion): suggestion is LocationSearchSuggestionResponse => suggestion != null);
}

async function queryNearbyDominantPostcodeAreaSuggestion(
  feature: PhotonFeature,
  label: string,
  requestedCountryCode: CountryCode | undefined
): Promise<LocationSearchSuggestionResponse | null> {
  const countryCode =
    normalizeCountryCode(feature.properties.countrycode) ?? requestedCountryCode ?? null;
  const [lon, lat] = feature.geometry.coordinates;
  if (!countryCode || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null;
  }

  const radiusMeters = 300;
  const radiusDegrees = radiusMeters / 111_320;
  const rows = Array.from(await db.execute<DbPostcodeAreaSearchRow>(sql`
    WITH nearby AS (
      SELECT
        p.country_code,
        p.city,
        p.region,
        LEFT(${buildNormalizedPostalCodeExpression(sql`p.postal_code`)}, 4) AS postal_code,
        p.geometry
      FROM properties p
      WHERE p.status = 'active'
        AND p.country_code = ${countryCode}
        AND p.postal_code IS NOT NULL
        AND p.geometry IS NOT NULL
        AND p.geometry && ST_Expand(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), ${radiusDegrees})
        AND ST_DWithin(
          p.geometry::geography,
          ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography,
          ${radiusMeters}
        )
    ),
    grouped AS (
      SELECT
        country_code,
        MIN(city) AS city,
        MIN(region) AS region,
        postal_code,
        AVG(ST_X(geometry)) AS lon,
        AVG(ST_Y(geometry)) AS lat,
        COUNT(*) AS row_count,
        SUM(COUNT(*)) OVER () AS total_count
      FROM nearby
      WHERE postal_code <> ''
      GROUP BY country_code, postal_code
    )
    SELECT *
    FROM grouped
    ORDER BY row_count DESC, postal_code
    LIMIT 1
  `));
  const row = rows[0];
  if (!row) {
    return null;
  }

  const rowCount = Number(row.row_count);
  const totalCount = Number(row.total_count);
  if (!Number.isFinite(rowCount) || !Number.isFinite(totalCount) || rowCount < 10) {
    return null;
  }
  if (totalCount > 0 && rowCount / totalCount < 0.6) {
    return null;
  }

  return buildDbPostcodeAreaSuggestion(row, label);
}

async function queryBackedStreetSuggestionForFeatureLabel(
  feature: PhotonFeature,
  label: string,
  requestedCountryCode: CountryCode | undefined
): Promise<LocationSearchSuggestionResponse | null> {
  const props = feature.properties;
  const countryCode =
    normalizeCountryCode(props.countrycode) ?? requestedCountryCode ?? null;
  const city = props.city ?? props.locality ?? null;
  if (!countryCode || !city) {
    return null;
  }

  const region = props.state ?? props.county ?? null;
  const rows = Array.from(await db.execute<DbLocationSearchRow>(sql`
    SELECT
      NULL::uuid AS id,
      p.country_code,
      p.street,
      NULL::integer AS house_number,
      NULL::text AS house_number_addition,
      p.city,
      p.region,
      NULL::text AS postal_code,
      ST_X(p.geometry) AS lon,
      ST_Y(p.geometry) AS lat
    FROM properties p
    WHERE p.status = 'active'
      AND p.country_code = ${countryCode}
      AND ${buildTextCandidatePredicate(sql`p.street`, label)}
      AND ${buildTextCandidatePredicate(sql`p.city`, city)}
    ORDER BY
      CASE
        WHEN ${region == null} THEN 0
        WHEN ${buildTextCandidatePredicate(sql`p.region`, region ?? '')} THEN 0
        ELSE 1
      END,
      p.country_code,
      p.street,
      p.city,
      p.region,
      p.house_number,
      p.id
    LIMIT 1
  `));

  const row = rows[0];
  return row ? buildDbAreaSuggestion(row, 'street') : null;
}

async function transformLocationFeature(
  feature: PhotonFeature,
  requestedCountryCode: CountryCode | undefined,
  rawQuery: string
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
  const featureLabel = rawLabel || formatDisplayName(props);
  const neighborhoodLabel =
    props.name && normalizeSearchToken(props.name) === normalizeSearchToken(rawQuery)
      ? titleCaseHyphenatedSearchText(rawQuery.trim())
      : (props.name ?? featureLabel);
  const label = isNeighborhoodLikeFeature(feature, neighborhoodLabel)
    ? neighborhoodLabel
    : featureLabel;

  if (isNeighborhoodLikeFeature(feature, label)) {
    const backedStreetSuggestion = await queryBackedStreetSuggestionForFeatureLabel(
      feature,
      label,
      requestedCountryCode
    );
    if (backedStreetSuggestion) {
      return backedStreetSuggestion;
    }

    const nearbyPostcodeSuggestion = await queryNearbyDominantPostcodeAreaSuggestion(
      feature,
      label,
      requestedCountryCode
    );
    if (nearbyPostcodeSuggestion) {
      return nearbyPostcodeSuggestion;
    }
  }

  const filterToken = buildLocationFilterTokenFromFeature(
    feature,
    type,
    label,
    requestedCountryCode
  );
  if (type === 'street') {
    const backedStreetSuggestion = await queryBackedStreetSuggestionForFeatureLabel(
      feature,
      label,
      requestedCountryCode
    );
    if (backedStreetSuggestion) {
      return backedStreetSuggestion;
    }
  }

  const hasBackingRows = await queryAreaTokenHasBackingRows(filterToken, requestedCountryCode);

  if (!hasBackingRows) {
    if (type === 'street') {
      return {
        id: `${type}:${countryCode ?? ''}:${normalizeSearchToken(label)}:${props.osm_type || 'N'}_${props.osm_id || 0}`,
        type,
        label,
        subtitle: filterToken.parentLabel || null,
        countryCode,
        coordinates,
        bbox: null,
        propertyId: null,
        address: null,
        postalCode: null,
        city: filterToken.city,
        region: filterToken.region,
        street: props.street ?? props.name ?? label,
        houseNumber: null,
        houseNumberAddition: null,
        filterToken: withHydratedTokenDefaults(filterToken),
      };
    }
    return null;
  }

  return {
    id: `${type}:${countryCode ?? ''}:${normalizeSearchToken(label)}:${props.osm_type || 'N'}_${props.osm_id || 0}`,
    type,
    label,
    subtitle: filterToken.parentLabel || null,
    countryCode,
    coordinates,
    bbox: null,
    propertyId: null,
    address: null,
    postalCode: type === 'street' ? null : (props.postcode ?? null),
    city: filterToken.city,
    region: filterToken.region,
    street: props.street ?? (type === 'street' ? props.name : null) ?? null,
    houseNumber: null,
    houseNumberAddition: null,
    filterToken: withHydratedTokenDefaults(filterToken),
  };
}

function getStreetExpansionFeature(
  features: readonly PhotonFeature[],
  q: string
): PhotonFeature | null {
  const parsed = parseSearchHouseNumber(q);
  if (parsed.houseNumber != null) {
    return null;
  }

  return (
    features.find((feature) => {
      const props = feature.properties;
      return (
        getFeatureAreaType(feature) === 'street' &&
        !props.housenumber &&
        normalizeSearchToken(props.name ?? props.street) === normalizeSearchToken(q)
      );
    }) ?? null
  );
}

async function fetchSupplementalStreetAddressFeatures(
  app: FastifyInstance,
  features: readonly PhotonFeature[],
  q: string,
  requestedCountryCode: CountryCode | undefined,
  fallbackProximity: SearchProximity | undefined
): Promise<PhotonFeature[]> {
  const streetFeature = getStreetExpansionFeature(features, q);
  if (!streetFeature) {
    return [];
  }

  const label = streetFeature.properties.name ?? streetFeature.properties.street;
  if (!label) {
    return [];
  }

  const [lon, lat] = streetFeature.geometry.coordinates;
  const proximity =
    Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat } : fallbackProximity;
  let addressFeatures: PhotonFeature[] = [];
  try {
    addressFeatures = await fetchPhotonFeatures(app, {
      q: `${label} 1`,
      limit: 3,
      countryCode: requestedCountryCode,
      proximity,
    });
  } catch (error) {
    app.log.warn({ err: error }, 'Supplemental street address search unavailable');
    return [];
  }

  return addressFeatures.filter((feature) => {
    const props = feature.properties;
    return (
      Boolean(props.housenumber) &&
      normalizeSearchToken(props.street ?? props.name) === normalizeSearchToken(label)
    );
  });
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
  const parts = [
    token.type,
    countryCode,
    normalizeLocationTokenValue(token.type, token.value || token.label),
  ];

  if (token.city) parts.push(`city=${normalizeSearchToken(token.city)}`);
  if (token.region) parts.push(`region=${normalizeSearchToken(token.region)}`);
  if (token.type !== 'street' && token.postalCode) {
    parts.push(`postcode=${normalizePostalCodeForMatch(token.postalCode).toLowerCase()}`);
  }

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
        : normalizeLocationTokenValue(token.type, token.value || token.label),
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
  const regionPredicate = token.region && token.type !== 'street'
    ? sql`AND LOWER(p.region) = LOWER(${token.region})`
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
        NULL::text AS postal_code,
        p.street,
        ${buildHydrationAggregateSelect()}
      FROM properties p
      WHERE p.geometry IS NOT NULL
        ${countryPredicate}
        ${cityPredicate}
        ${regionPredicate}
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
        const dbSuggestions = await queryDbLocationSuggestions(
          app,
          q,
          limit,
          requestedCountryCode
        );
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
        const supplementalFeatures = await fetchSupplementalStreetAddressFeatures(
          app,
          features,
          q,
          requestedCountryCode,
          proximity
        );
        const countryFiltered = features
          .concat(supplementalFeatures)
          .filter((feature) => matchesCountryCode(feature, requestedCountryCode))
          .slice(0, Math.max(limit, limit - dbSuggestions.length));
        const transformedSuggestions = await Promise.all(
          countryFiltered.map((feature) =>
            transformLocationFeature(feature, requestedCountryCode, q)
          )
        );
        const dedupedSuggestions = new Map<string, LocationSearchSuggestionResponse>();
        const sortedTransformedSuggestions = sortSuggestionsByProximity(
          transformedSuggestions,
          proximity,
          q
        );
        const orderedSuggestions = proximity
          ? [...sortedTransformedSuggestions, ...dbSuggestions]
          : [...dbSuggestions, ...sortedTransformedSuggestions];

        for (const suggestion of orderedSuggestions) {
          const key = buildLocationSuggestionDedupeKey(suggestion);
          if (!suggestion || !key) {
            continue;
          }

          const existing = dedupedSuggestions.get(key);
          if (!existing) {
            dedupedSuggestions.set(key, suggestion);
          } else if (shouldReplaceLocationSuggestion(existing, suggestion)) {
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
