import { z } from 'zod';

import { formatPropertyPrice } from './formatting.js';
import type {
  MapActivityFilter,
  MapFilterCategory,
  MapFilters,
  MapMarketState,
  RentEffectivePriceInput,
  SaleEffectivePriceInput,
} from '../types/property.js';

export const MAP_FILTER_CATEGORIES = [
  'price',
  'marketState',
  'activity',
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
] as const;

type MapFilterQueryKey = (typeof MAP_FILTER_QUERY_KEYS)[number];

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
  all: 'All Activity',
  social: 'Social',
  recent: 'Recently Active',
};

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
  to: number | null,
): [number | null, number | null] {
  if (from != null && to != null && from > to) {
    return [to, from];
  }

  return [from, to];
}

function getPriceBoundsForMode(
  filters: MapFilters,
  mode: MapPriceMode,
): [number | null, number | null] {
  return mode === 'sale'
    ? [filters.salePriceFrom, filters.salePriceTo]
    : [filters.rentPriceFrom, filters.rentPriceTo];
}

function isPriceModeStateIncluded(
  marketState: readonly MapMarketState[],
  mode: MapPriceMode,
): boolean {
  const relevantStates =
    mode === 'sale' ? SALE_PRICE_MARKET_STATES : RENT_PRICE_MARKET_STATES;

  return relevantStates.some((state) => marketState.includes(state));
}

function getMapVisiblePriceModes(
  marketState: readonly MapMarketState[],
): MapPriceMode[] {
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
  };
}

export function isMapMarketState(value: string): value is MapMarketState {
  return MAP_MARKET_STATES.includes(value as MapMarketState);
}

export function isMapFilterQueryKey(value: string): value is MapFilterQueryKey {
  return FILTER_QUERY_KEY_SET.has(value);
}

export function normalizeMapMarketState(
  values: Iterable<MapMarketState | string | null | undefined>,
): MapMarketState[] {
  const normalized = stableUniqueMarketState(
    Array.from(values).filter(
      (value): value is MapMarketState =>
        typeof value === 'string' && isMapMarketState(value),
    ),
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
  const marketState = stableUniqueMarketState(
    filters.marketState ?? defaultFilters.marketState,
  );
  const [salePriceFrom, salePriceTo] = normalizePriceRange(
    normalizeNumber(filters.salePriceFrom ?? defaultFilters.salePriceFrom),
    normalizeNumber(filters.salePriceTo ?? defaultFilters.salePriceTo),
  );
  const [rentPriceFrom, rentPriceTo] = normalizePriceRange(
    normalizeNumber(filters.rentPriceFrom ?? defaultFilters.rentPriceFrom),
    normalizeNumber(filters.rentPriceTo ?? defaultFilters.rentPriceTo),
  );

  return {
    salePriceFrom,
    salePriceTo,
    rentPriceFrom,
    rentPriceTo,
    marketState: marketState.length > 0 ? marketState : [...MAP_MARKET_STATES],
    activity:
      filters.activity === 'social' || filters.activity === 'recent'
        ? filters.activity
        : defaultFilters.activity,
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
    normalizedLeft.marketState.length === normalizedRight.marketState.length &&
    normalizedLeft.marketState.every(
      (value, index) => value === normalizedRight.marketState[index],
    )
  );
}

export function isMapFilterCategoryActive(
  filters: MapFilters,
  category: MapFilterCategory,
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
  }
}

export function isMapFilterCategoryDefault(
  filters: MapFilters,
  category: MapFilterCategory,
): boolean {
  return !isMapFilterCategoryActive(filters, category);
}

export function areMapFiltersDefault(filters: MapFilters): boolean {
  return MAP_FILTER_CATEGORIES.every((category) =>
    isMapFilterCategoryDefault(filters, category),
  );
}

export function getOrderedMapFilterCategories(filters: MapFilters): MapFilterCategory[] {
  const activeCategories = MAP_FILTER_CATEGORIES.filter((category) =>
    isMapFilterCategoryActive(filters, category),
  );
  const inactiveCategories = MAP_FILTER_CATEGORIES.filter(
    (category) => !activeCategories.includes(category),
  );
  return [...activeCategories, ...inactiveCategories];
}

function formatCompactPrice(value: number | null): string | null {
  if (value == null) {
    return null;
  }

  return formatPropertyPrice(value, 'NL', { compact: true })
    .replace(/\s+/g, ' ')
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

  return 'Price';
}

export function getMapMarketStateLabel(state: MapMarketState): string {
  return MAP_MARKET_STATE_LABELS[state];
}

export function getMapFilterPillSummary(
  category: MapFilterCategory,
  filters: MapFilters,
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
  }
}

export function resetMapFilterCategory(
  filters: MapFilters,
  category: MapFilterCategory,
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
            MAP_MARKET_STATES.includes(entry as MapMarketState),
          ),
      );
    }),
  activity: z.enum(['all', 'social', 'recent']).optional().default('all'),
});

export function hasOnlyMapFilterQueryParams(params: URLSearchParams): boolean {
  for (const key of params.keys()) {
    if (!FILTER_QUERY_KEY_SET.has(key)) {
      return false;
    }
  }

  return true;
}

export function hasOnlyAllowedMapFilterQueryParams(
  params: URLSearchParams,
): boolean {
  return hasOnlyMapFilterQueryParams(params);
}

export function parseMapFiltersFromSearchParams(params: URLSearchParams): MapFilters {
  const filters = createDefaultMapFilters();
  const marketStateValues = params.getAll('marketState');
  const marketState = marketStateValues.length > 0
    ? stableUniqueMarketState(
        marketStateValues
          .flatMap((value) => value.split(','))
          .map((value) => value.trim())
          .filter((value): value is MapMarketState =>
            MAP_MARKET_STATES.includes(value as MapMarketState),
          ),
      )
    : filters.marketState;

  return normalizeMapFilters({
    salePriceFrom: parseDraftNumber(params.get('salePriceFrom') ?? ''),
    salePriceTo: parseDraftNumber(params.get('salePriceTo') ?? ''),
    rentPriceFrom: parseDraftNumber(params.get('rentPriceFrom') ?? ''),
    rentPriceTo: parseDraftNumber(params.get('rentPriceTo') ?? ''),
    marketState,
    activity:
      params.get('activity') === 'social' || params.get('activity') === 'recent'
        ? (params.get('activity') as MapActivityFilter)
        : 'all',
  });
}

export function serializeMapFiltersToSearchParams(
  filters: MapFilters,
): URLSearchParams {
  return updateMapFilterSearchParams(new URLSearchParams(), filters);
}

export function updateMapFilterSearchParams(
  params: URLSearchParams,
  filters: MapFilters,
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

  return next;
}

export function getMapFilterSearchString(
  filters: MapFilters,
  currentSearch = '',
): string {
  const params = updateMapFilterSearchParams(
    new URLSearchParams(
      currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch,
    ),
    filters,
  );
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function normalizeMapFilterSearchString(
  params: URLSearchParams,
): string | null {
  if (!hasOnlyAllowedMapFilterQueryParams(params)) {
    return null;
  }

  return getMapFilterSearchString(parseMapFiltersFromSearchParams(params));
}

export function normalizeMapFilterQueryParams(
  params: URLSearchParams,
): URLSearchParams {
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
  return `${pathname}${
    search.startsWith('?') || search.length === 0 ? search : `?${search}`
  }`;
}

export function buildPropertyTileTemplateUrl(
  apiUrl: string,
  filters: MapFilters,
): string {
  return `${apiUrl}/tiles/properties/{z}/{x}/{y}.pbf${getMapFilterSearchString(filters)}`;
}

export function buildNearbyGroupPath(
  lon: number,
  lat: number,
  zoom: number,
  filters: MapFilters,
): string {
  const params = updateMapFilterSearchParams(
    new URLSearchParams({
      lon: String(lon),
      lat: String(lat),
      zoom: String(zoom),
    }),
    filters,
  );
  return `/properties/nearby?${params.toString()}`;
}

export function getSaleEffectivePrice(
  input: SaleEffectivePriceInput,
): number | null {
  return (
    normalizeNumber(input.activeSaleAskingPrice ?? null) ??
    normalizeNumber(input.lastSoldPrice ?? null) ??
    normalizeNumber(input.canonicalFmv ?? null) ??
    normalizeNumber(input.officialValuation ?? null)
  );
}

export function getRentEffectivePrice(
  input: RentEffectivePriceInput,
): number | null {
  return (
    normalizeNumber(input.activeRentAskingPrice ?? null) ??
    normalizeNumber(input.lastRentedPrice ?? null)
  );
}
