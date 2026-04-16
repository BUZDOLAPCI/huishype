import { formatPropertyPrice } from '@huishype/shared';
import type {
  MapFilterCategory,
  MapFilters,
  MapMarketState,
  RentEffectivePriceInput,
  SaleEffectivePriceInput,
} from '../../../../packages/shared/src/types/property';

export type { MapFilterCategory, MapFilters, MapMarketState };

export const MAP_FILTER_CATEGORIES = [
  'salePrice',
  'rentPrice',
  'marketState',
] as const satisfies readonly MapFilterCategory[];

export const MAP_MARKET_STATES = [
  'for-sale',
  'for-rent',
  'sold',
  'rented',
  'not-listed',
] as const satisfies readonly MapMarketState[];

const MAP_FILTER_QUERY_KEYS = [
  'salePriceFrom',
  'salePriceTo',
  'rentPriceFrom',
  'rentPriceTo',
  'marketState',
] as const;

type MapFilterQueryKey = (typeof MAP_FILTER_QUERY_KEYS)[number];

const MAP_MARKET_STATE_SET = new Set<MapMarketState>(MAP_MARKET_STATES);
const MAP_FILTER_QUERY_KEY_SET = new Set<string>(MAP_FILTER_QUERY_KEYS);
const MAP_MARKET_STATE_LABELS: Record<MapMarketState, string> = {
  'for-sale': 'For Sale',
  'for-rent': 'For Rent',
  sold: 'Sold',
  rented: 'Rented',
  'not-listed': 'Not Listed',
};

const PRICE_CATEGORY_LABELS: Record<'salePrice' | 'rentPrice', string> = {
  salePrice: 'Price',
  rentPrice: 'Rent Price',
};

export interface MapFilterDraftState {
  salePriceFrom: string;
  salePriceTo: string;
  rentPriceFrom: string;
  rentPriceTo: string;
}

export interface MapFilterMatchCandidate {
  askingPrice?: number | null;
  officialValuation?: number | null;
  canonicalFmv?: number | null;
  activeRentAskingPrice?: number | null;
  lastRentedPrice?: number | null;
  marketState?: MapMarketState | null;
  hasListing?: boolean | null;
}

function normalizePositiveInteger(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return value > 0 ? Math.round(value) : null;
}

function formatCompactPrice(value: number | null): string | null {
  if (value == null) {
    return null;
  }

  return formatPropertyPrice(value, 'NL', { compact: true }).replace(/\s+/g, ' ').trim();
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

function firstNormalizedPrice(values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    const normalized = normalizePositiveInteger(value);
    if (normalized != null) {
      return normalized;
    }
  }

  return null;
}

function formatDraftNumber(value: number | null): string {
  return value == null ? '' : String(value);
}

function isMapMarketState(value: string): value is MapMarketState {
  return MAP_MARKET_STATE_SET.has(value as MapMarketState);
}

function isMapFilterQueryKey(value: string): value is MapFilterQueryKey {
  return MAP_FILTER_QUERY_KEY_SET.has(value);
}

export function createDefaultMapFilters(): MapFilters {
  return {
    salePriceFrom: null,
    salePriceTo: null,
    rentPriceFrom: null,
    rentPriceTo: null,
    marketState: [...MAP_MARKET_STATES],
  };
}

export function createMapFilterDraftState(filters: MapFilters): MapFilterDraftState {
  return {
    salePriceFrom: formatDraftNumber(filters.salePriceFrom),
    salePriceTo: formatDraftNumber(filters.salePriceTo),
    rentPriceFrom: formatDraftNumber(filters.rentPriceFrom),
    rentPriceTo: formatDraftNumber(filters.rentPriceTo),
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

export function normalizeMapMarketState(
  values: Iterable<MapMarketState | string | null | undefined>,
): MapMarketState[] {
  const selected = new Set<MapMarketState>();

  for (const value of values) {
    if (typeof value === 'string' && isMapMarketState(value)) {
      selected.add(value);
    }
  }

  const canonical = MAP_MARKET_STATES.filter((state) => selected.has(state));
  return canonical.length > 0 ? canonical : [...MAP_MARKET_STATES];
}

export function normalizeMapFilters(filters: MapFilters): MapFilters {
  const salePriceFrom = normalizePositiveInteger(filters.salePriceFrom);
  const salePriceTo = normalizePositiveInteger(filters.salePriceTo);
  const rentPriceFrom = normalizePositiveInteger(filters.rentPriceFrom);
  const rentPriceTo = normalizePositiveInteger(filters.rentPriceTo);

  return {
    salePriceFrom:
      salePriceFrom != null &&
      salePriceTo != null &&
      salePriceFrom > salePriceTo
        ? salePriceTo
        : salePriceFrom,
    salePriceTo:
      salePriceFrom != null &&
      salePriceTo != null &&
      salePriceFrom > salePriceTo
        ? salePriceFrom
        : salePriceTo,
    rentPriceFrom:
      rentPriceFrom != null &&
      rentPriceTo != null &&
      rentPriceFrom > rentPriceTo
        ? rentPriceTo
        : rentPriceFrom,
    rentPriceTo:
      rentPriceFrom != null &&
      rentPriceTo != null &&
      rentPriceFrom > rentPriceTo
        ? rentPriceFrom
        : rentPriceTo,
    marketState: normalizeMapMarketState(filters.marketState),
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
    case 'salePrice':
      return normalized.salePriceFrom != null || normalized.salePriceTo != null;
    case 'rentPrice':
      return normalized.rentPriceFrom != null || normalized.rentPriceTo != null;
    case 'marketState':
      return normalized.marketState.length !== MAP_MARKET_STATES.length;
  }
}

export function getOrderedMapFilterCategories(
  filters: MapFilters,
): MapFilterCategory[] {
  const active = MAP_FILTER_CATEGORIES.filter((category) =>
    isMapFilterCategoryActive(filters, category),
  );
  const inactive = MAP_FILTER_CATEGORIES.filter(
    (category) => !active.includes(category),
  );

  return [...active, ...inactive];
}

export function getMapMarketStateLabel(state: MapMarketState): string {
  return MAP_MARKET_STATE_LABELS[state];
}

export function getMapFilterPillLabel(category: MapFilterCategory): string {
  if (category === 'marketState') {
    return 'Status';
  }

  return PRICE_CATEGORY_LABELS[category];
}

export function getMapFilterPillSummary(
  category: MapFilterCategory,
  filters: MapFilters,
): string | null {
  const normalized = normalizeMapFilters(filters);

  switch (category) {
    case 'salePrice':
      return summarizePriceBounds(normalized.salePriceFrom, normalized.salePriceTo);
    case 'rentPrice':
      return summarizePriceBounds(normalized.rentPriceFrom, normalized.rentPriceTo);
    case 'marketState':
      if (normalized.marketState.length === MAP_MARKET_STATES.length) {
        return null;
      }

      if (normalized.marketState.length === 1) {
        return getMapMarketStateLabel(normalized.marketState[0]!);
      }

      return `${normalized.marketState.length} selected`;
  }
}

export function resetMapFilterCategory(
  filters: MapFilters,
  category: MapFilterCategory,
): MapFilters {
  const normalized = normalizeMapFilters(filters);

  switch (category) {
    case 'salePrice':
      return { ...normalized, salePriceFrom: null, salePriceTo: null };
    case 'rentPrice':
      return { ...normalized, rentPriceFrom: null, rentPriceTo: null };
    case 'marketState':
      return { ...normalized, marketState: [...MAP_MARKET_STATES] };
  }
}

export function serializeMapFiltersToSearchParams(
  filters: MapFilters,
): URLSearchParams {
  const normalized = normalizeMapFilters(filters);
  const params = new URLSearchParams();

  if (normalized.salePriceFrom != null) {
    params.set('salePriceFrom', String(normalized.salePriceFrom));
  }
  if (normalized.salePriceTo != null) {
    params.set('salePriceTo', String(normalized.salePriceTo));
  }
  if (normalized.rentPriceFrom != null) {
    params.set('rentPriceFrom', String(normalized.rentPriceFrom));
  }
  if (normalized.rentPriceTo != null) {
    params.set('rentPriceTo', String(normalized.rentPriceTo));
  }
  if (normalized.marketState.length !== MAP_MARKET_STATES.length) {
    params.set('marketState', normalized.marketState.join(','));
  }

  return params;
}

export function updateMapFilterSearchParams(
  params: URLSearchParams,
  filters: MapFilters,
): URLSearchParams {
  const next = new URLSearchParams(params.toString());

  for (const key of MAP_FILTER_QUERY_KEYS) {
    next.delete(key);
  }

  const filterParams = serializeMapFiltersToSearchParams(filters);
  for (const [key, value] of filterParams.entries()) {
    next.append(key, value);
  }

  return next;
}

function parsePositiveIntegerFromSearchParam(value: string | null): number | null {
  if (!value?.trim()) {
    return null;
  }

  const digitsOnly = value.replace(/[^\d]/g, '');
  if (!digitsOnly) {
    return null;
  }

  const parsed = Number.parseInt(digitsOnly, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseMapFiltersFromSearchParams(params: URLSearchParams): MapFilters {
  const defaults = createDefaultMapFilters();
  const marketStateValue = params.get('marketState');

  return normalizeMapFilters({
    salePriceFrom: parsePositiveIntegerFromSearchParam(params.get('salePriceFrom')),
    salePriceTo: parsePositiveIntegerFromSearchParam(params.get('salePriceTo')),
    rentPriceFrom: parsePositiveIntegerFromSearchParam(params.get('rentPriceFrom')),
    rentPriceTo: parsePositiveIntegerFromSearchParam(params.get('rentPriceTo')),
    marketState: marketStateValue
      ? normalizeMapMarketState(
          marketStateValue.split(',').map((value) => value.trim()),
        )
      : defaults.marketState,
  });
}

export function getCanonicalMapFilterSignature(filters: MapFilters): string {
  return serializeMapFiltersToSearchParams(filters).toString();
}

export function getMapFilterSearchString(
  filters: MapFilters,
  currentSearch = '',
): string {
  const next = updateMapFilterSearchParams(
    new URLSearchParams(currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch),
    filters,
  );
  const query = next.toString();
  return query ? `?${query}` : '';
}

export function appendSearchToPath(pathname: string, search: string): string {
  return `${pathname}${search.startsWith('?') || search.length === 0 ? search : `?${search}`}`;
}

export function buildPropertyTileTemplateUrl(apiUrl: string, filters: MapFilters): string {
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
  return firstNormalizedPrice([
    input.activeSaleAskingPrice,
    input.lastSoldPrice,
    input.canonicalFmv,
    input.officialValuation,
  ]);
}

export function getRentEffectivePrice(
  input: RentEffectivePriceInput,
): number | null {
  return firstNormalizedPrice([
    input.activeRentAskingPrice,
    input.lastRentedPrice,
  ]);
}

export function inferMapMarketState(
  candidate: MapFilterMatchCandidate,
): MapMarketState | null {
  if (candidate.marketState) {
    return candidate.marketState;
  }

  if (candidate.hasListing === false) {
    return 'not-listed';
  }

  if (candidate.askingPrice != null) {
    return 'for-sale';
  }

  if (
    candidate.activeRentAskingPrice != null ||
    candidate.lastRentedPrice != null
  ) {
    return 'for-rent';
  }

  return null;
}

export function doesMapFilterCandidateMatch(
  candidate: MapFilterMatchCandidate,
  filters: MapFilters,
): boolean {
  const normalized = normalizeMapFilters(filters);
  const saleEffectivePrice = getSaleEffectivePrice({
    activeSaleAskingPrice: candidate.askingPrice,
    canonicalFmv: candidate.canonicalFmv,
    officialValuation: candidate.officialValuation,
  });
  const rentEffectivePrice = getRentEffectivePrice({
    activeRentAskingPrice: candidate.activeRentAskingPrice,
    lastRentedPrice: candidate.lastRentedPrice,
  });
  const inferredMarketState = inferMapMarketState(candidate);

  if (normalized.salePriceFrom != null) {
    if (saleEffectivePrice == null || saleEffectivePrice < normalized.salePriceFrom) {
      return false;
    }
  }

  if (normalized.salePriceTo != null) {
    if (saleEffectivePrice == null || saleEffectivePrice > normalized.salePriceTo) {
      return false;
    }
  }

  if (normalized.rentPriceFrom != null) {
    if (rentEffectivePrice == null || rentEffectivePrice < normalized.rentPriceFrom) {
      return false;
    }
  }

  if (normalized.rentPriceTo != null) {
    if (rentEffectivePrice == null || rentEffectivePrice > normalized.rentPriceTo) {
      return false;
    }
  }

  if (
    normalized.marketState.length !== MAP_MARKET_STATES.length &&
    inferredMarketState != null &&
    !normalized.marketState.includes(inferredMarketState)
  ) {
    return false;
  }

  return true;
}

export function hasOnlyAllowedMapFilterQueryParams(params: URLSearchParams): boolean {
  for (const key of params.keys()) {
    if (!isMapFilterQueryKey(key)) {
      return false;
    }
  }

  return true;
}
