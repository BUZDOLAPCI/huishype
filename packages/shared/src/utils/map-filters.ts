import { z } from 'zod';

import { formatPropertyPrice } from './formatting.js';
import type {
  MapActivityFilter,
  MapActivityTimeFilter,
  MapFilterCategory,
  MapFilters,
  MapListedSinceFilter,
  MapMarketState,
  MapScopeFilter,
  LocationFilterToken,
  LocationFilterTokenType,
  PropertyMarketFilters,
  FollowingPropertyFilters,
  RentEffectivePriceInput,
  SaleEffectivePriceInput,
} from '../types/property.js';

export const MAP_FILTER_CATEGORIES = [
  'price',
  'marketState',
  'activity',
  'listedSince',
] as const satisfies readonly MapFilterCategory[];

export const MAP_MARKET_STATES = [
  'for-sale',
  'for-rent',
  'sold',
  'rented',
  'not-listed',
] as const satisfies readonly MapMarketState[];

export const MAP_FILTER_QUERY_KEYS = [
  'salePriceFrom',
  'salePriceTo',
  'rentPriceFrom',
  'rentPriceTo',
  'marketState',
  'activity',
  'listedSince',
  'scope',
  'area',
] as const;

type MapFilterQueryKey = (typeof MAP_FILTER_QUERY_KEYS)[number];

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

export interface MapFilterDraftState {
  salePriceFrom: string;
  salePriceTo: string;
  rentPriceFrom: string;
  rentPriceTo: string;
}

const FILTER_QUERY_KEY_SET = new Set<string>(MAP_FILTER_QUERY_KEYS);
const MAP_MARKET_STATE_LABELS: Record<MapMarketState, string> = {
  'for-sale': 'For Sale',
  'for-rent': 'For Rent',
  sold: 'Sold',
  rented: 'Rented',
  'not-listed': 'Not Listed',
};
const MAP_ACTIVITY_LABELS: Record<MapActivityFilter, string> = {
  all: 'Any Activity',
  today: 'Today',
  '10d': '10 Days',
  '30d': '30 Days',
  'all-time': 'All Time',
};
const MAP_LISTED_SINCE_LABELS: Record<MapListedSinceFilter, string> = {
  all: 'Any time',
  today: 'Today',
  '3d': 'Last 3 days',
  '5d': 'Last 5 days',
  '10d': 'Last 10 days',
  '30d': 'Last 30 days',
};

export const MAP_ACTIVITY_TIME_FILTERS = [
  'today',
  '10d',
  '30d',
  'all-time',
] as const satisfies readonly MapActivityTimeFilter[];

const SALE_PRICE_MARKET_STATES = ['for-sale', 'sold', 'not-listed'] as const;
const RENT_PRICE_MARKET_STATES = ['for-rent', 'rented'] as const;

type MapPriceMode = 'sale' | 'rent';

function formatDraftNumber(value: number | null): string {
  return value == null ? '' : String(value);
}

function normalizeNumber(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return value > 0 ? Math.round(value) : null;
}

function stableUniqueMarketState(values: Iterable<MapMarketState>): MapMarketState[] {
  const valueSet = new Set(values);
  return MAP_MARKET_STATES.filter((state) => valueSet.has(state));
}

function normalizePriceRange(
  from: number | null,
  to: number | null
): [number | null, number | null] {
  if (from != null && to != null && from > to) {
    return [to, from];
  }

  return [from, to];
}

function getPriceBoundsForMode(
  filters: MapFilters,
  mode: MapPriceMode
): [number | null, number | null] {
  return mode === 'sale'
    ? [filters.salePriceFrom, filters.salePriceTo]
    : [filters.rentPriceFrom, filters.rentPriceTo];
}

function isPriceModeStateIncluded(
  marketState: readonly MapMarketState[],
  mode: MapPriceMode
): boolean {
  const relevantStates = mode === 'sale' ? SALE_PRICE_MARKET_STATES : RENT_PRICE_MARKET_STATES;

  return relevantStates.some((state) => marketState.includes(state));
}

function getMapVisiblePriceModes(marketState: readonly MapMarketState[]): MapPriceMode[] {
  const hasSale = isPriceModeStateIncluded(marketState, 'sale');
  const hasRent = isPriceModeStateIncluded(marketState, 'rent');

  if (hasSale && hasRent) {
    return ['sale', 'rent'];
  }

  if (hasSale) {
    return ['sale'];
  }

  if (hasRent) {
    return ['rent'];
  }

  return ['sale', 'rent'];
}

export function createDefaultMapFilters(): MapFilters {
  return {
    salePriceFrom: null,
    salePriceTo: null,
    rentPriceFrom: null,
    rentPriceTo: null,
    marketState: [...MAP_MARKET_STATES],
    activity: 'all',
    listedSince: 'all',
    scope: 'public',
    areas: [],
  };
}

export function isMapMarketState(value: string): value is MapMarketState {
  return MAP_MARKET_STATES.includes(value as MapMarketState);
}

export function isMapFilterQueryKey(value: string): value is MapFilterQueryKey {
  return FILTER_QUERY_KEY_SET.has(value);
}

export function normalizeMapMarketState(
  values: Iterable<MapMarketState | string | null | undefined>
): MapMarketState[] {
  const normalized = stableUniqueMarketState(
    Array.from(values).filter(
      (value): value is MapMarketState => typeof value === 'string' && isMapMarketState(value)
    )
  );

  return normalized.length > 0 ? normalized : [...MAP_MARKET_STATES];
}

export function createMapFilterDraftState(filters: MapFilters): MapFilterDraftState {
  const normalized = normalizeMapFilters(filters);
  return {
    salePriceFrom: formatDraftNumber(normalized.salePriceFrom),
    salePriceTo: formatDraftNumber(normalized.salePriceTo),
    rentPriceFrom: formatDraftNumber(normalized.rentPriceFrom),
    rentPriceTo: formatDraftNumber(normalized.rentPriceTo),
  };
}

export function sanitizeDraftNumber(value: string): string {
  return value.replace(/[^\d]/g, '');
}

export function parseDraftNumber(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number.parseInt(sanitizeDraftNumber(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeMapFilters(filters: Partial<MapFilters>): MapFilters {
  const defaultFilters = createDefaultMapFilters();
  const marketState = stableUniqueMarketState(filters.marketState ?? defaultFilters.marketState);
  const [salePriceFrom, salePriceTo] = normalizePriceRange(
    normalizeNumber(filters.salePriceFrom ?? defaultFilters.salePriceFrom),
    normalizeNumber(filters.salePriceTo ?? defaultFilters.salePriceTo)
  );
  const [rentPriceFrom, rentPriceTo] = normalizePriceRange(
    normalizeNumber(filters.rentPriceFrom ?? defaultFilters.rentPriceFrom),
    normalizeNumber(filters.rentPriceTo ?? defaultFilters.rentPriceTo)
  );

  return {
    salePriceFrom,
    salePriceTo,
    rentPriceFrom,
    rentPriceTo,
    marketState: marketState.length > 0 ? marketState : [...MAP_MARKET_STATES],
    activity: isMapActivityFilter(filters.activity) ? filters.activity : defaultFilters.activity,
    listedSince: isMapListedSinceFilter(filters.listedSince)
      ? filters.listedSince
      : defaultFilters.listedSince,
    scope: isMapScopeFilter(filters.scope) ? filters.scope : defaultFilters.scope,
    areas: normalizeLocationFilterTokens(filters.areas ?? defaultFilters.areas),
  };
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

export function serializeLocationFilterToken(token: LocationFilterToken): string | null {
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
  const countryCode = normalizeCountryCode(token.countryCode) ?? '';
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

  return [token.type, countryCode, value, ...metadata].join(':');
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

export function normalizeLocationFilterTokens(
  tokens: readonly LocationFilterToken[] | null | undefined
): LocationFilterToken[] {
  if (!tokens) {
    return [];
  }

  const deduped = new Map<string, LocationFilterToken>();
  for (const token of tokens) {
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
      id: token.id?.trim() || null,
      countryCode: normalizeCountryCode(token.countryCode),
      value,
      label: token.label?.trim() || value,
      parentLabel: token.parentLabel?.trim() || null,
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

export function isMapActivityFilter(value: string | null | undefined): value is MapActivityFilter {
  return (
    value === 'all' ||
    value === 'today' ||
    value === '10d' ||
    value === '30d' ||
    value === 'all-time'
  );
}

export function isMapListedSinceFilter(
  value: string | null | undefined
): value is MapListedSinceFilter {
  return (
    value === 'all' ||
    value === 'today' ||
    value === '3d' ||
    value === '5d' ||
    value === '10d' ||
    value === '30d'
  );
}

export function isMapScopeFilter(value: string | null | undefined): value is MapScopeFilter {
  return value === 'public' || value === 'following';
}

export function normalizePropertyMarketFilters(
  filters: PropertyMarketFilters
): Required<PropertyMarketFilters> {
  const normalized = normalizeMapFilters({
    ...filters,
    activity: 'all',
    scope: 'public',
  });

  return {
    salePriceFrom: normalized.salePriceFrom,
    salePriceTo: normalized.salePriceTo,
    rentPriceFrom: normalized.rentPriceFrom,
    rentPriceTo: normalized.rentPriceTo,
    marketState: normalized.marketState,
    listedSince: normalized.listedSince,
  };
}

export function areMapFiltersEqual(left: MapFilters, right: MapFilters): boolean {
  const normalizedLeft = normalizeMapFilters(left);
  const normalizedRight = normalizeMapFilters(right);

  return (
    normalizedLeft.salePriceFrom === normalizedRight.salePriceFrom &&
    normalizedLeft.salePriceTo === normalizedRight.salePriceTo &&
    normalizedLeft.rentPriceFrom === normalizedRight.rentPriceFrom &&
    normalizedLeft.rentPriceTo === normalizedRight.rentPriceTo &&
    normalizedLeft.activity === normalizedRight.activity &&
    normalizedLeft.listedSince === normalizedRight.listedSince &&
    normalizedLeft.scope === normalizedRight.scope &&
    (normalizedLeft.areas ?? []).length === (normalizedRight.areas ?? []).length &&
    (normalizedLeft.areas ?? []).every(
      (value, index) =>
        serializeLocationFilterToken(value) ===
        serializeLocationFilterToken((normalizedRight.areas ?? [])[index]!)
    ) &&
    normalizedLeft.marketState.length === normalizedRight.marketState.length &&
    normalizedLeft.marketState.every((value, index) => value === normalizedRight.marketState[index])
  );
}

export function isMapFilterCategoryActive(
  filters: MapFilters,
  category: MapFilterCategory
): boolean {
  const normalized = normalizeMapFilters(filters);

  switch (category) {
    case 'price':
      return getMapVisiblePriceModes(normalized.marketState).some((mode) => {
        const [from, to] = getPriceBoundsForMode(normalized, mode);
        return from != null || to != null;
      });
    case 'marketState':
      return normalized.marketState.length !== MAP_MARKET_STATES.length;
    case 'activity':
      return normalized.activity !== 'all';
    case 'listedSince':
      return normalized.listedSince !== 'all';
  }
}

export function isMapFilterCategoryDefault(
  filters: MapFilters,
  category: MapFilterCategory
): boolean {
  return !isMapFilterCategoryActive(filters, category);
}

export function areMapFiltersDefault(filters: MapFilters): boolean {
  return MAP_FILTER_CATEGORIES.every((category) => isMapFilterCategoryDefault(filters, category));
}

export function getOrderedMapFilterCategories(filters: MapFilters): MapFilterCategory[] {
  const activeCategories = MAP_FILTER_CATEGORIES.filter((category) =>
    isMapFilterCategoryActive(filters, category)
  );
  const inactiveCategories = MAP_FILTER_CATEGORIES.filter(
    (category) => !activeCategories.includes(category)
  );
  return [...activeCategories, ...inactiveCategories];
}

function formatCompactPrice(value: number | null): string | null {
  if (value == null) {
    return null;
  }

  return formatPropertyPrice(value, 'NL', { compact: true })
    .replace(/\s+/g, ' ')
    .replace(/([,.])0(?=\D*$)/, '')
    .trim();
}

function summarizePriceBounds(from: number | null, to: number | null): string | null {
  const fromLabel = formatCompactPrice(from);
  const toLabel = formatCompactPrice(to);

  if (fromLabel && toLabel) {
    return `${fromLabel} - ${toLabel}`;
  }

  if (fromLabel) {
    return `From ${fromLabel}`;
  }

  if (toLabel) {
    return `To ${toLabel}`;
  }

  return null;
}

export function getMapFilterPillLabel(category: MapFilterCategory): string {
  if (category === 'marketState') {
    return 'Status';
  }
  if (category === 'activity') {
    return 'Activity';
  }
  if (category === 'listedSince') {
    return 'Listed since';
  }

  return 'Price';
}

export function getMapMarketStateLabel(state: MapMarketState): string {
  return MAP_MARKET_STATE_LABELS[state];
}

export function getMapFilterPillSummary(
  category: MapFilterCategory,
  filters: MapFilters
): string | null {
  const normalized = normalizeMapFilters(filters);

  switch (category) {
    case 'price': {
      const segments = getMapVisiblePriceModes(normalized.marketState)
        .map((mode) => {
          const [from, to] = getPriceBoundsForMode(normalized, mode);
          const summary = summarizePriceBounds(from, to);

          if (!summary) {
            return null;
          }

          return mode === 'sale' ? `Sale ${summary}` : `Rent ${summary}`;
        })
        .filter((summary): summary is string => summary != null);

      return segments.length > 0 ? segments.join(' · ') : null;
    }
    case 'marketState':
      return normalized.marketState.length === MAP_MARKET_STATES.length
        ? null
        : `${normalized.marketState.length} selected`;
    case 'activity':
      return normalized.activity === 'all' ? null : MAP_ACTIVITY_LABELS[normalized.activity];
    case 'listedSince':
      return normalized.listedSince === 'all'
        ? null
        : MAP_LISTED_SINCE_LABELS[normalized.listedSince];
  }
}

export function resetMapFilterCategory(
  filters: MapFilters,
  category: MapFilterCategory
): MapFilters {
  const normalized = normalizeMapFilters(filters);

  switch (category) {
    case 'price':
      return {
        ...normalized,
        salePriceFrom: null,
        salePriceTo: null,
        rentPriceFrom: null,
        rentPriceTo: null,
      };
    case 'marketState':
      return { ...normalized, marketState: [...MAP_MARKET_STATES] };
    case 'activity':
      return { ...normalized, activity: 'all' };
    case 'listedSince':
      return { ...normalized, listedSince: 'all' };
  }
}

export const mapMarketStateSchema = z.enum(MAP_MARKET_STATES);

export const mapFiltersQuerySchema = z.object({
  salePriceFrom: z.coerce.number().int().positive().optional(),
  salePriceTo: z.coerce.number().int().positive().optional(),
  rentPriceFrom: z.coerce.number().int().positive().optional(),
  rentPriceTo: z.coerce.number().int().positive().optional(),
  marketState: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) {
        return [...MAP_MARKET_STATES];
      }

      return stableUniqueMarketState(
        value
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry): entry is MapMarketState =>
            MAP_MARKET_STATES.includes(entry as MapMarketState)
          )
      );
    }),
  activity: z.enum(['all', 'today', '10d', '30d', 'all-time']).optional().default('all'),
  listedSince: z.enum(['all', 'today', '3d', '5d', '10d', '30d']).optional().default('all'),
  scope: z.enum(['public', 'following']).optional().default('public'),
  area: z.union([z.string(), z.array(z.string())]).optional(),
});

export function hasOnlyMapFilterQueryParams(params: URLSearchParams): boolean {
  for (const key of params.keys()) {
    if (!FILTER_QUERY_KEY_SET.has(key)) {
      return false;
    }
  }

  return true;
}

export function hasOnlyAllowedMapFilterQueryParams(params: URLSearchParams): boolean {
  return hasOnlyMapFilterQueryParams(params);
}

export function parseMapFiltersFromSearchParams(params: URLSearchParams): MapFilters {
  const filters = createDefaultMapFilters();
  const marketStateValues = params.getAll('marketState');
  const marketState =
    marketStateValues.length > 0
      ? stableUniqueMarketState(
          marketStateValues
            .flatMap((value) => value.split(','))
            .map((value) => value.trim())
            .filter((value): value is MapMarketState =>
              MAP_MARKET_STATES.includes(value as MapMarketState)
            )
        )
      : filters.marketState;

  return normalizeMapFilters({
    salePriceFrom: parseDraftNumber(params.get('salePriceFrom') ?? ''),
    salePriceTo: parseDraftNumber(params.get('salePriceTo') ?? ''),
    rentPriceFrom: parseDraftNumber(params.get('rentPriceFrom') ?? ''),
    rentPriceTo: parseDraftNumber(params.get('rentPriceTo') ?? ''),
    marketState,
    activity: isMapActivityFilter(params.get('activity'))
      ? (params.get('activity') as MapActivityFilter)
      : 'all',
    listedSince: isMapListedSinceFilter(params.get('listedSince'))
      ? (params.get('listedSince') as MapListedSinceFilter)
      : filters.listedSince,
    scope: isMapScopeFilter(params.get('scope')) ? (params.get('scope') as MapScopeFilter) : filters.scope,
    areas: params
      .getAll('area')
      .map(parseLocationFilterToken)
      .filter((token): token is LocationFilterToken => token != null),
  });
}

export function serializeMapFiltersToSearchParams(filters: MapFilters): URLSearchParams {
  return updateMapFilterSearchParams(new URLSearchParams(), filters);
}

export function updatePropertyMarketFilterSearchParams(
  params: URLSearchParams,
  filters: PropertyMarketFilters
): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  const normalized = normalizePropertyMarketFilters(filters);

  next.delete('salePriceFrom');
  next.delete('salePriceTo');
  next.delete('rentPriceFrom');
  next.delete('rentPriceTo');
  next.delete('marketState');
  next.delete('activity');
  next.delete('listedSince');
  next.delete('scope');
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
  if (normalized.marketState.length !== MAP_MARKET_STATES.length) {
    next.set('marketState', normalized.marketState.join(','));
  }
  if (normalized.listedSince !== 'all') {
    next.set('listedSince', normalized.listedSince);
  }
  return next;
}

export function updateFollowingPropertyFilterSearchParams(
  params: URLSearchParams,
  filters: FollowingPropertyFilters
): URLSearchParams {
  const next = updatePropertyMarketFilterSearchParams(params, filters);
  const activity = isMapActivityFilter(filters.activity) ? filters.activity : 'all-time';
  const scope = isMapScopeFilter(filters.scope) ? filters.scope : 'following';

  next.delete('activity');
  next.delete('scope');
  if (activity !== 'all') {
    next.set('activity', activity);
  }
  if (scope !== 'public') {
    next.set('scope', scope);
  }
  for (const area of normalizeLocationFilterTokens(filters.areas)) {
    const serialized = serializeLocationFilterToken(area);
    if (serialized) {
      next.append('area', serialized);
    }
  }

  return next;
}

export function serializePropertyMarketFiltersToSearchParams(
  filters: PropertyMarketFilters
): URLSearchParams {
  return updatePropertyMarketFilterSearchParams(new URLSearchParams(), filters);
}

export function updateMapFilterSearchParams(
  params: URLSearchParams,
  filters: MapFilters
): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  const normalized = normalizeMapFilters(filters);

  for (const key of MAP_FILTER_QUERY_KEYS) {
    next.delete(key);
  }

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
  if (normalized.marketState.length !== MAP_MARKET_STATES.length) {
    next.set('marketState', normalized.marketState.join(','));
  }
  if (normalized.activity !== 'all') {
    next.set('activity', normalized.activity);
  }
  if (normalized.listedSince !== 'all') {
    next.set('listedSince', normalized.listedSince);
  }
  if (normalized.scope !== 'public') {
    next.set('scope', normalized.scope);
  }
  for (const area of normalized.areas ?? []) {
    const serialized = serializeLocationFilterToken(area);
    if (serialized) {
      next.append('area', serialized);
    }
  }

  return next;
}

export function getMapFilterSearchString(filters: MapFilters, currentSearch = ''): string {
  const params = updateMapFilterSearchParams(
    new URLSearchParams(currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch),
    filters
  );
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function normalizeMapFilterSearchString(params: URLSearchParams): string | null {
  if (!hasOnlyAllowedMapFilterQueryParams(params)) {
    return null;
  }

  return getMapFilterSearchString(parseMapFiltersFromSearchParams(params));
}

export function normalizeMapFilterQueryParams(params: URLSearchParams): URLSearchParams {
  return serializeMapFiltersToSearchParams(parseMapFiltersFromSearchParams(params));
}

export function getMapFilterSignature(filters: MapFilters): string {
  const search = getMapFilterSearchString(filters);
  return search.length > 1 ? search.slice(1) : 'default';
}

export function getCanonicalMapFilterSignature(filters: MapFilters): string {
  return serializeMapFiltersToSearchParams(filters).toString();
}

export function appendSearchToPath(pathname: string, search: string): string {
  return `${pathname}${search.startsWith('?') || search.length === 0 ? search : `?${search}`}`;
}

export function buildPropertyTileTemplateUrl(apiUrl: string, filters: MapFilters): string {
  return `${apiUrl}/tiles/properties/{z}/{x}/{y}.pbf${getMapFilterSearchString(filters)}`;
}

export function getPropertyMarketFilterSearchString(
  filters: PropertyMarketFilters,
  currentSearch = ''
): string {
  const params = updatePropertyMarketFilterSearchParams(
    new URLSearchParams(currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch),
    filters
  );
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function buildFollowingPropertyTileTemplateUrl(
  apiUrl: string,
  filters: FollowingPropertyFilters
): string {
  const params = updateFollowingPropertyFilterSearchParams(new URLSearchParams(), filters);
  const query = params.toString();
  return `${apiUrl}/tiles/following/properties/{z}/{x}/{y}.pbf${query ? `?${query}` : ''}`;
}

export function buildNearbyGroupPath(
  lon: number,
  lat: number,
  zoom: number,
  filters: MapFilters,
  pyramidNode?: {
    pyramidVersionId?: string | null;
    pyramidNodeId?: string | null;
  }
): string {
  const params = updateMapFilterSearchParams(
    new URLSearchParams({
      lon: String(lon),
      lat: String(lat),
      zoom: String(zoom),
    }),
    filters
  );
  if (pyramidNode?.pyramidVersionId && pyramidNode.pyramidNodeId) {
    params.set('pyramidVersionId', pyramidNode.pyramidVersionId);
    params.set('pyramidNodeId', pyramidNode.pyramidNodeId);
  }
  return `/properties/nearby?${params.toString()}`;
}

export function buildFollowingNearbyGroupPath(
  lon: number,
  lat: number,
  zoom: number,
  filters: FollowingPropertyFilters
): string {
  const params = updateFollowingPropertyFilterSearchParams(
    new URLSearchParams({
      lon: String(lon),
      lat: String(lat),
      zoom: String(zoom),
    }),
    filters
  );
  return `/properties/following-nearby?${params.toString()}`;
}

export function buildResolveTapPath(lon: number, lat: number, zoom: number): string {
  const params = new URLSearchParams({
    lon: String(lon),
    lat: String(lat),
    zoom: String(zoom),
  });
  return `/properties/resolve-tap?${params.toString()}`;
}

export function getSaleEffectivePrice(input: SaleEffectivePriceInput): number | null {
  return (
    normalizeNumber(input.activeSaleAskingPrice ?? null) ??
    normalizeNumber(input.lastSoldPrice ?? null) ??
    normalizeNumber(input.canonicalFmv ?? null) ??
    normalizeNumber(input.officialValuation ?? null)
  );
}

export function getRentEffectivePrice(input: RentEffectivePriceInput): number | null {
  return (
    normalizeNumber(input.activeRentAskingPrice ?? null) ??
    normalizeNumber(input.lastRentedPrice ?? null)
  );
}
