import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { LocationFilterToken, LocationFilterTokenType } from '@huishype/shared';
import { buildPropertyListingFactsJoin } from './property-queries.js';

export const MAP_MARKET_STATES = ['for-sale', 'for-rent', 'sold', 'rented', 'not-listed'] as const;

const MAP_MARKET_STATE_SET = new Set<string>(MAP_MARKET_STATES);
const DEFAULT_MARKET_STATE_ORDER = [...MAP_MARKET_STATES];
const SALE_MARKET_STATES = ['for-sale', 'sold', 'not-listed'] as const;
const RENT_MARKET_STATES = ['for-rent', 'rented'] as const;

export type MapMarketState = (typeof MAP_MARKET_STATES)[number];

export interface MapFilters {
  salePriceFrom: number | null;
  salePriceTo: number | null;
  rentPriceFrom: number | null;
  rentPriceTo: number | null;
  marketState: MapMarketState[];
  activity: MapActivityFilter;
  areas: LocationFilterToken[];
}

export type MapActivityFilter = 'all' | 'today' | '10d' | '30d' | 'all-time';

type MapFilterQueryInput = {
  salePriceFrom?: number;
  salePriceTo?: number;
  rentPriceFrom?: number;
  rentPriceTo?: number;
  marketState?: string | string[];
  activity?: MapActivityFilter;
  area?: string | string[];
};

export const mapFiltersQuerySchema = z.object({
  salePriceFrom: z.coerce.number().optional(),
  salePriceTo: z.coerce.number().optional(),
  rentPriceFrom: z.coerce.number().optional(),
  rentPriceTo: z.coerce.number().optional(),
  marketState: z.union([z.string(), z.array(z.string())]).optional(),
  activity: z.enum(['all', 'today', '10d', '30d', 'all-time']).optional().default('all'),
  area: z.union([z.string(), z.array(z.string())]).optional(),
});

export const propertyMarketFiltersQuerySchema = mapFiltersQuerySchema.omit({
  activity: true,
});

export const followingMapFiltersQuerySchema = mapFiltersQuerySchema.extend({
  activity: z.enum(['all', 'today', '10d', '30d', 'all-time']).optional().default('all-time'),
});

const LOCATION_FILTER_TOKEN_TYPES = [
  'street',
  'postcode',
  'city',
  'region',
  'country',
  'current-location',
] as const satisfies readonly LocationFilterTokenType[];
const LOCATION_FILTER_TOKEN_TYPE_SET = new Set<string>(LOCATION_FILTER_TOKEN_TYPES);
const CURRENT_LOCATION_RADIUS_METERS = 5_000;

export type PropertyMarketFilterQuery = {
  filters: MapFilters;
  join: SQL;
  predicate: SQL;
};

export function createDefaultMapFilters(): MapFilters {
  return {
    salePriceFrom: null,
    salePriceTo: null,
    rentPriceFrom: null,
    rentPriceTo: null,
    marketState: [...DEFAULT_MARKET_STATE_ORDER],
    activity: 'all',
    areas: [],
  };
}

function normalizePositiveInteger(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return value > 0 ? Math.round(value) : null;
}

function stableUniqueMarketState(values: Iterable<MapMarketState>): MapMarketState[] {
  const set = new Set(values);
  return DEFAULT_MARKET_STATE_ORDER.filter((state) => set.has(state));
}

function parseMarketStateInput(input: string | string[] | undefined): MapMarketState[] {
  if (input == null) {
    return [...DEFAULT_MARKET_STATE_ORDER];
  }

  const joined = Array.isArray(input) ? input.join(',') : input;
  const values = joined
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is MapMarketState => MAP_MARKET_STATE_SET.has(value));

  return values.length > 0 ? stableUniqueMarketState(values) : [...DEFAULT_MARKET_STATE_ORDER];
}

function normalizeTokenValue(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizePostcodeTokenValue(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeLocationTokenValue(type: LocationFilterTokenType, value: string): string {
  return type === 'postcode' ? normalizePostcodeTokenValue(value) : normalizeTokenValue(value);
}

function normalizeCountryCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{2}$/u.test(normalized) ? normalized : null;
}

function formatTokenLabel(value: string, type?: LocationFilterTokenType): string {
  if (type === 'postcode') {
    return value.toUpperCase();
  }

  return value
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function serializeTokenMetadata(key: string, value: string | null | undefined): string | null {
  const normalized = value
    ? key === 'postcode'
      ? normalizePostcodeTokenValue(value)
      : normalizeTokenValue(value)
    : '';
  return normalized ? `${key}=${normalized}` : null;
}

function parseTokenMetadata(parts: string[]): Record<string, string> {
  const metadata: Record<string, string> = {};

  for (const part of parts) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = part.slice(0, separatorIndex);
    const value =
      key === 'postcode'
        ? normalizePostcodeTokenValue(part.slice(separatorIndex + 1))
        : normalizeTokenValue(part.slice(separatorIndex + 1));
    if (value) {
      metadata[key] = value;
    }
  }

  return metadata;
}

export function parseLocationFilterToken(value: string): LocationFilterToken | null {
  const parts = value.split(':');
  const type = parts[0] as LocationFilterTokenType | undefined;
  if (!type || !LOCATION_FILTER_TOKEN_TYPE_SET.has(type)) {
    return null;
  }

  if (type === 'current-location') {
    const lat = Number(parts[1]);
    const lon = Number(parts[2]);
    const radius = Number(parts[3] ?? CURRENT_LOCATION_RADIUS_METERS);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return null;
    }
    return {
      type,
      countryCode: null,
      value: `${lat.toFixed(6)},${lon.toFixed(6)}`,
      label: 'Current location',
      coordinates: [lon, lat],
      radiusMeters:
        Number.isFinite(radius) && radius > 0
          ? Math.round(radius)
          : CURRENT_LOCATION_RADIUS_METERS,
    };
  }

  const tokenValue = normalizeLocationTokenValue(type, parts[2] ?? '');
  if (!tokenValue) {
    return null;
  }
  const metadata = parseTokenMetadata(parts.slice(3));
  const postalCode = metadata.postcode ?? (type === 'postcode' ? tokenValue : null);

  return {
    type,
    countryCode: normalizeCountryCode(parts[1]),
    value: tokenValue,
    label: formatTokenLabel(tokenValue, type),
    city: metadata.city ? formatTokenLabel(metadata.city) : null,
    region: metadata.region ? formatTokenLabel(metadata.region) : null,
    postalCode: postalCode ? postalCode.toUpperCase() : null,
    street: metadata.street ? formatTokenLabel(metadata.street) : null,
  };
}

function serializeLocationFilterToken(token: LocationFilterToken): string | null {
  if (token.type === 'current-location') {
    const coordinates = token.coordinates;
    if (!coordinates) {
      return null;
    }
    const radius = Math.max(1, Math.round(token.radiusMeters ?? CURRENT_LOCATION_RADIUS_METERS));
    return `current-location:${coordinates[1].toFixed(6)}:${coordinates[0].toFixed(6)}:${radius}`;
  }

  const value = normalizeLocationTokenValue(token.type, token.value || token.label || '');
  if (!value) {
    return null;
  }
  const postalCodeMetadata =
    token.type === 'street' ||
    (token.type === 'postcode' && normalizePostcodeTokenValue(token.postalCode ?? '') === value)
      ? null
      : token.postalCode;
  const streetMetadata =
    token.type === 'street' && normalizeTokenValue(token.street ?? '') === value
      ? null
      : token.street;
  const regionMetadata =
    token.type === 'street' || token.type === 'postcode' ? null : token.region;
  const metadata = [
    serializeTokenMetadata('city', token.city),
    serializeTokenMetadata('region', regionMetadata),
    serializeTokenMetadata('postcode', postalCodeMetadata),
    serializeTokenMetadata('street', streetMetadata),
  ].filter((part): part is string => part != null);

  return [token.type, normalizeCountryCode(token.countryCode) ?? '', value, ...metadata].join(':');
}

function parseAreaInput(input: string | string[] | undefined): LocationFilterToken[] {
  const values = Array.isArray(input) ? input : input ? [input] : [];
  return values
    .map(parseLocationFilterToken)
    .filter((token): token is LocationFilterToken => token != null);
}

function normalizeLocationFilterTokens(tokens: readonly LocationFilterToken[] | undefined): LocationFilterToken[] {
  const deduped = new Map<string, LocationFilterToken>();
  for (const token of tokens ?? []) {
    if (!LOCATION_FILTER_TOKEN_TYPE_SET.has(token.type)) {
      continue;
    }
    const value =
      token.type === 'current-location'
        ? token.value.trim()
        : normalizeLocationTokenValue(token.type, token.value || token.label || '');
    if (!value) {
      continue;
    }
    const normalized: LocationFilterToken = {
      ...token,
      countryCode: normalizeCountryCode(token.countryCode),
      value,
      label: token.label?.trim() || value,
      city: token.city?.trim() || null,
      region: token.region?.trim() || null,
      postalCode: token.postalCode
        ? normalizePostcodeTokenValue(token.postalCode).toUpperCase()
        : null,
      street: token.street?.trim() || null,
      coordinates: token.coordinates ?? null,
      bbox: token.bbox ?? null,
      radiusMeters:
        token.type === 'current-location'
          ? Math.max(1, Math.round(token.radiusMeters ?? CURRENT_LOCATION_RADIUS_METERS))
          : (token.radiusMeters ?? null),
    };
    const key = serializeLocationFilterToken(normalized);
    if (key) {
      deduped.set(key, normalized);
    }
  }
  return Array.from(deduped.values());
}

export function normalizeMapFilters(filters: Partial<MapFilters>): MapFilters {
  const salePriceFrom = normalizePositiveInteger(filters.salePriceFrom);
  const salePriceTo = normalizePositiveInteger(filters.salePriceTo);
  const rentPriceFrom = normalizePositiveInteger(filters.rentPriceFrom);
  const rentPriceTo = normalizePositiveInteger(filters.rentPriceTo);
  const marketState = stableUniqueMarketState(filters.marketState ?? DEFAULT_MARKET_STATE_ORDER);

  return {
    salePriceFrom:
      salePriceFrom != null && salePriceTo != null && salePriceFrom > salePriceTo
        ? salePriceTo
        : salePriceFrom,
    salePriceTo:
      salePriceFrom != null && salePriceTo != null && salePriceFrom > salePriceTo
        ? salePriceFrom
        : salePriceTo,
    rentPriceFrom:
      rentPriceFrom != null && rentPriceTo != null && rentPriceFrom > rentPriceTo
        ? rentPriceTo
        : rentPriceFrom,
    rentPriceTo:
      rentPriceFrom != null && rentPriceTo != null && rentPriceFrom > rentPriceTo
        ? rentPriceFrom
        : rentPriceTo,
    marketState: marketState.length > 0 ? marketState : [...DEFAULT_MARKET_STATE_ORDER],
    activity: isMapActivityFilter(filters.activity) ? filters.activity : 'all',
    areas: normalizeLocationFilterTokens(filters.areas),
  };
}

function isMapActivityFilter(value: string | null | undefined): value is MapActivityFilter {
  return (
    value === 'all' ||
    value === 'today' ||
    value === '10d' ||
    value === '30d' ||
    value === 'all-time'
  );
}

export function parseMapFiltersQuery(query: unknown): MapFilters {
  const parsed = mapFiltersQuerySchema.parse(query) as MapFilterQueryInput;

  return normalizeMapFilters({
    salePriceFrom: parsed.salePriceFrom ?? null,
    salePriceTo: parsed.salePriceTo ?? null,
    rentPriceFrom: parsed.rentPriceFrom ?? null,
    rentPriceTo: parsed.rentPriceTo ?? null,
    marketState: parseMarketStateInput(parsed.marketState),
    activity: parsed.activity ?? 'all',
    areas: parseAreaInput(parsed.area),
  });
}

export function parsePropertyMarketFiltersQuery(query: unknown): MapFilters {
  const parsed = propertyMarketFiltersQuerySchema.parse(query) as Omit<
    MapFilterQueryInput,
    'activity'
  >;

  return normalizeMapFilters({
    salePriceFrom: parsed.salePriceFrom ?? null,
    salePriceTo: parsed.salePriceTo ?? null,
    rentPriceFrom: parsed.rentPriceFrom ?? null,
    rentPriceTo: parsed.rentPriceTo ?? null,
    marketState: parseMarketStateInput(parsed.marketState),
    activity: 'all',
    areas: parseAreaInput(parsed.area),
  });
}

export function parseFollowingMapFiltersQuery(query: unknown): MapFilters {
  const parsed = followingMapFiltersQuerySchema.parse(query) as MapFilterQueryInput;
  const activity = parsed.activity === 'all' ? 'all-time' : (parsed.activity ?? 'all-time');

  return normalizeMapFilters({
    salePriceFrom: parsed.salePriceFrom ?? null,
    salePriceTo: parsed.salePriceTo ?? null,
    rentPriceFrom: parsed.rentPriceFrom ?? null,
    rentPriceTo: parsed.rentPriceTo ?? null,
    marketState: parseMarketStateInput(parsed.marketState),
    activity,
    areas: parseAreaInput(parsed.area),
  });
}

export function areMapFiltersDefault(filters: MapFilters): boolean {
  return (
    filters.salePriceFrom == null &&
    filters.salePriceTo == null &&
    filters.rentPriceFrom == null &&
    filters.rentPriceTo == null &&
    filters.activity === 'all' &&
    filters.areas.length === 0 &&
    filters.marketState.length === DEFAULT_MARKET_STATE_ORDER.length &&
    filters.marketState.every((value, index) => value === DEFAULT_MARKET_STATE_ORDER[index])
  );
}

function applyMapFiltersToSearchParams(
  params: URLSearchParams,
  filters: MapFilters
): URLSearchParams {
  const normalized = normalizeMapFilters(filters);
  const next = new URLSearchParams(params.toString());

  next.delete('salePriceFrom');
  next.delete('salePriceTo');
  next.delete('rentPriceFrom');
  next.delete('rentPriceTo');
  next.delete('marketState');
  next.delete('activity');
  next.delete('area');

  if (normalized.salePriceFrom != null) {
    next.set('salePriceFrom', String(normalized.salePriceFrom));
  }
  if (normalized.salePriceTo != null) {
    next.set('salePriceTo', String(normalized.salePriceTo));
  }
  if (normalized.rentPriceFrom != null) {
    next.set('rentPriceFrom', String(normalized.rentPriceFrom));
  }
  if (normalized.rentPriceTo != null) {
    next.set('rentPriceTo', String(normalized.rentPriceTo));
  }
  if (normalized.marketState.length !== DEFAULT_MARKET_STATE_ORDER.length) {
    next.set('marketState', normalized.marketState.join(','));
  }
  if (normalized.activity !== 'all') {
    next.set('activity', normalized.activity);
  }
  for (const area of normalized.areas) {
    const serialized = serializeLocationFilterToken(area);
    if (serialized) {
      next.append('area', serialized);
    }
  }

  return next;
}

export function serializeMapFilterQuery(filters: MapFilters): string {
  return applyMapFiltersToSearchParams(new URLSearchParams(), filters).toString();
}

export function getMapFilterSignature(filters: MapFilters): string {
  const serialized = serializeMapFilterQuery(filters);
  return serialized.length > 0 ? serialized : 'default';
}

export function buildPropertyTileTemplateUrl(baseUrl: string, filters: MapFilters): string {
  const query = serializeMapFilterQuery(filters);
  return `${baseUrl}/tiles/properties/{z}/{x}/{y}.pbf${query ? `?${query}` : ''}`;
}

function buildStateList(states: readonly MapMarketState[]): SQL {
  return sql`(${sql.join(
    states.map((state) => sql`${state}`),
    sql`, `
  )})`;
}

function buildScopedPricePredicate(
  marketStateColumn: SQL,
  effectivePriceColumn: SQL,
  impactedStates: readonly MapMarketState[],
  unaffectedStates: readonly MapMarketState[],
  operator: '>=' | '<=',
  value: number
): SQL {
  return sql`(
    ${marketStateColumn} IN ${buildStateList(unaffectedStates)}
    OR (
      ${marketStateColumn} IN ${buildStateList(impactedStates)}
      AND ${effectivePriceColumn} ${sql.raw(operator)} ${value}
    )
  )`;
}

function normalizeLowerComparisonValue(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function getLowerComparisonValues(value: string | null | undefined): string[] {
  const normalized = value ? normalizeLowerComparisonValue(value) : '';
  const slug = value ? normalizeTokenValue(value) : '';
  const values = [normalized, slug].filter(Boolean);

  return Array.from(new Set(values));
}

function buildLowerExpression(column: SQL): SQL {
  return sql`LOWER(${column})`;
}

function buildPostalCodeExpression(column: SQL): SQL {
  return sql`REGEXP_REPLACE(UPPER(${column}), '\\s+', '', 'g')`;
}

function getPostcodePrefixUpperBound(value: string): string | null {
  if (!/^\d{4}$/u.test(value)) {
    return null;
  }

  const next = Number.parseInt(value, 10) + 1;
  return next <= 9999 ? String(next).padStart(4, '0') : null;
}

function buildLocationTokenPredicate(token: LocationFilterToken, propertyAlias: string): SQL {
  const predicates: SQL[] = [];
  const countryColumn = sql.raw(`${propertyAlias}.country_code`);
  const cityColumn = sql.raw(`${propertyAlias}.city`);
  const regionColumn = sql.raw(`${propertyAlias}.region`);
  const postalCodeColumn = sql.raw(`${propertyAlias}.postal_code`);
  const streetColumn = sql.raw(`${propertyAlias}.street`);

  if (token.countryCode) {
    predicates.push(sql`${countryColumn} = ${token.countryCode}`);
  }

  const addLowerPredicate = (column: SQL, value: string | null | undefined) => {
    const values = getLowerComparisonValues(value);
    if (values.length === 1) {
      predicates.push(sql`${buildLowerExpression(column)} = ${values[0]}`);
    } else if (values.length > 1) {
      const expression = buildLowerExpression(column);
      predicates.push(sql`(${sql.join(
        values.map((candidate) => sql`${expression} = ${candidate}`),
        sql` OR `
      )})`);
    }
  };

  const addPostcodePredicate = (value: string | null | undefined) => {
    const normalized = value ? normalizePostcodeTokenValue(value).toUpperCase() : '';
    if (normalized) {
      const expression = buildPostalCodeExpression(postalCodeColumn);
      const upperBound = getPostcodePrefixUpperBound(normalized);
      predicates.push(
        upperBound
          ? sql`(${expression} >= ${normalized} AND ${expression} < ${upperBound})`
          : sql`${expression} = ${normalized}`
      );
    }
  };

  if (token.type === 'current-location') {
    const [lon, lat] = token.coordinates ?? [];
    const radius = Math.max(1, Math.round(token.radiusMeters ?? CURRENT_LOCATION_RADIUS_METERS));
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      predicates.push(sql`ST_DWithin(
        ${sql.raw(`${propertyAlias}.geometry`)}::geography,
        ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography,
        ${radius}
      )`);
    }
  }

  if (token.type === 'country') {
    if (!token.countryCode && token.value) {
      addLowerPredicate(countryColumn, token.label ?? token.value);
    }
  } else if (token.type === 'city') {
    addLowerPredicate(cityColumn, token.city ?? token.label ?? token.value);
  } else if (token.type === 'region') {
    addLowerPredicate(regionColumn, token.region ?? token.label ?? token.value);
  } else if (token.type === 'postcode') {
    addPostcodePredicate(token.postalCode ?? token.value);
  } else if (token.type === 'street') {
    addLowerPredicate(streetColumn, token.street ?? token.label ?? token.value);
  }

  if (token.type === 'street') {
    addLowerPredicate(cityColumn, token.city);
  } else if (token.type !== 'city' && token.type !== 'postcode') {
    addLowerPredicate(cityColumn, token.city);
  }
  if (token.type !== 'region' && token.type !== 'street' && token.type !== 'postcode') {
    addLowerPredicate(regionColumn, token.region);
  }
  if (token.type !== 'postcode' && token.type !== 'street') {
    addPostcodePredicate(token.postalCode);
  }
  if (token.type !== 'street') {
    addLowerPredicate(streetColumn, token.street);
  }

  return predicates.length > 0 ? sql`(${sql.join(predicates, sql` AND `)})` : sql`TRUE`;
}

export function buildLocationAreaFilterPredicate(
  tokens: readonly LocationFilterToken[],
  propertyAlias = 'p'
): SQL {
  const normalized = normalizeLocationFilterTokens(tokens);
  if (normalized.length === 0) {
    return sql`TRUE`;
  }

  return sql`(${sql.join(
    normalized.map((token) => buildLocationTokenPredicate(token, propertyAlias)),
    sql` OR `
  )})`;
}

export function buildPropertyMarketFilterQuery(
  filters: MapFilters,
  propertyAlias = 'p'
): PropertyMarketFilterQuery {
  // Property market filtering is layered separately from activity filtering, so
  // activity-only requests should not force listing/effective-price joins.
  const normalized = normalizeMapFilters({
    ...filters,
    activity: 'all',
    areas: [],
  });

  if (areMapFiltersDefault(normalized)) {
    return {
      filters: normalized,
      join: sql``,
      predicate: sql`TRUE`,
    };
  }

  const requiresEffectivePrices =
    normalized.salePriceFrom != null ||
    normalized.salePriceTo != null ||
    normalized.rentPriceFrom != null ||
    normalized.rentPriceTo != null;
  const join = buildPropertyListingFactsJoin(propertyAlias, 'lf', {
    includeEffectivePrices: requiresEffectivePrices,
  });

  const predicates: SQL[] = [];
  const marketStateColumn = sql.raw('lf.market_state');
  const saleEffectivePriceColumn = sql.raw('lf.sale_effective_price');
  const rentEffectivePriceColumn = sql.raw('lf.rent_effective_price');

  if (normalized.marketState.length !== DEFAULT_MARKET_STATE_ORDER.length) {
    predicates.push(sql`${marketStateColumn} IN ${buildStateList(normalized.marketState)}`);
  }

  if (normalized.salePriceFrom != null) {
    predicates.push(
      buildScopedPricePredicate(
        marketStateColumn,
        saleEffectivePriceColumn,
        SALE_MARKET_STATES,
        RENT_MARKET_STATES,
        '>=',
        normalized.salePriceFrom
      )
    );
  }

  if (normalized.salePriceTo != null) {
    predicates.push(
      buildScopedPricePredicate(
        marketStateColumn,
        saleEffectivePriceColumn,
        SALE_MARKET_STATES,
        RENT_MARKET_STATES,
        '<=',
        normalized.salePriceTo
      )
    );
  }

  if (normalized.rentPriceFrom != null) {
    predicates.push(
      buildScopedPricePredicate(
        marketStateColumn,
        rentEffectivePriceColumn,
        RENT_MARKET_STATES,
        SALE_MARKET_STATES,
        '>=',
        normalized.rentPriceFrom
      )
    );
  }

  if (normalized.rentPriceTo != null) {
    predicates.push(
      buildScopedPricePredicate(
        marketStateColumn,
        rentEffectivePriceColumn,
        RENT_MARKET_STATES,
        SALE_MARKET_STATES,
        '<=',
        normalized.rentPriceTo
      )
    );
  }

  return {
    filters: normalized,
    join,
    predicate: predicates.length > 0 ? sql`${sql.join(predicates, sql` AND `)}` : sql`TRUE`,
  };
}
