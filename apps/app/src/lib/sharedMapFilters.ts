import { formatPropertyPrice } from '@huishype/shared';
import type {
  MapActivityFilter,
  MapActivityTimeFilter,
  MapFilterCategory,
  MapFilters,
  MapMarketState,
  LocationFilterToken,
  LocationFilterTokenType,
  RentEffectivePriceInput,
  SaleEffectivePriceInput,
} from '../../../../packages/shared/src/types/property';

export type {
  MapActivityFilter,
  MapActivityTimeFilter,
  MapFilterCategory,
  MapFilters,
  MapMarketState,
  LocationFilterToken,
  LocationFilterTokenType,
};

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

export const MAP_STATUS_PILL_STATES = [
  'for-sale',
  'for-rent',
  'sold',
  'rented',
] as const satisfies readonly MapMarketState[];

const MAP_FILTER_QUERY_KEYS = [
  'salePriceFrom',
  'salePriceTo',
  'rentPriceFrom',
  'rentPriceTo',
  'marketState',
  'activity',
  'area',
] as const;
const PRIVATE_MAP_STATE_QUERY_KEYS = ['socialScope'] as const;

type MapFilterQueryKey = (typeof MAP_FILTER_QUERY_KEYS)[number];

const MAP_MARKET_STATE_SET = new Set<MapMarketState>(MAP_MARKET_STATES);
const MAP_STATUS_PILL_STATE_SET = new Set<MapMarketState>(MAP_STATUS_PILL_STATES);
const MAP_FILTER_QUERY_KEY_SET = new Set<string>(MAP_FILTER_QUERY_KEYS);
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
export const MAP_ACTIVITY_TIME_FILTERS = [
  'today',
  '10d',
  '30d',
  'all-time',
] as const satisfies readonly MapActivityTimeFilter[];
export const MAP_ACTIVITY_FILTERS = MAP_ACTIVITY_TIME_FILTERS;
const MAP_MARKET_STATE_LABELS: Record<MapMarketState, string> = {
  'for-sale': 'For Sale',
  'for-rent': 'For Rent',
  sold: 'Sold',
  rented: 'Rented',
  'not-listed': 'Not Listed',
};
const MAP_ACTIVITY_FILTER_LABELS: Record<MapActivityFilter, string> = {
  all: 'Any Activity',
  today: 'Today',
  '10d': '10 Days',
  '30d': '30 Days',
  'all-time': 'All Time',
};

const SALE_PRICE_MARKET_STATES = ['for-sale', 'sold', 'not-listed'] as const;
const RENT_PRICE_MARKET_STATES = ['for-rent', 'rented'] as const;

export type MapPriceMode = 'sale' | 'rent';
export type MapStatusPillState = (typeof MAP_STATUS_PILL_STATES)[number];

const SALE_PRICE_SUGGESTION_VALUES = [
  0, 50000, 75000, 100000, 125000, 150000, 175000, 200000, 225000, 250000, 275000, 300000, 325000,
  350000, 375000, 400000, 450000, 500000, 550000, 600000, 650000, 700000, 750000, 800000, 900000,
  1000000, 1250000, 1500000, 2000000, 2500000, 3000000, 3500000, 4000000, 4500000, 5000000,
] as const;

const RENT_PRICE_SUGGESTION_VALUES = [
  500, 750, 1000, 1250, 1500, 1750, 2000, 2250, 2500, 3000, 3500, 4000, 5000, 7500, 10000,
] as const;

export interface MapFilterDraftState {
  salePriceFrom: string;
  salePriceTo: string;
  rentPriceFrom: string;
  rentPriceTo: string;
}

export interface MapPriceSuggestion {
  key: string;
  label: string;
  value: string;
  custom: boolean;
}

export interface MapPriceSuggestionOptions {
  filterByPrefix?: boolean;
}

export interface MapFilterMatchCandidate {
  askingPrice?: number | null;
  officialValuation?: number | null;
  canonicalFmv?: number | null;
  activeRentAskingPrice?: number | null;
  lastRentedPrice?: number | null;
  marketState?: MapMarketState | null;
  hasActiveListing?: boolean | null;
  socialScore?: number | null;
  recentSocialScore?: number | null;
  lastSocialAt?: string | null;
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

function getActivePriceModes(filters: MapFilters): MapPriceMode[] {
  return getMapVisiblePriceModes(filters.marketState);
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

function isMapStatusPillState(value: MapMarketState): value is MapStatusPillState {
  return MAP_STATUS_PILL_STATE_SET.has(value);
}

function isMapFilterQueryKey(value: string): value is MapFilterQueryKey {
  return MAP_FILTER_QUERY_KEY_SET.has(value);
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

export function createDefaultMapFilters(): MapFilters {
  return {
    salePriceFrom: null,
    salePriceTo: null,
    rentPriceFrom: null,
    rentPriceTo: null,
    marketState: [...MAP_MARKET_STATES],
    activity: 'all',
    areas: [],
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

function normalizeCountryCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{2}$/u.test(normalized) ? normalized : null;
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

  const value = normalizeTokenValue(token.value || token.label || '');
  if (!value) {
    return null;
  }
  const countryCode = normalizeCountryCode(token.countryCode) ?? '';
  return `${token.type}:${countryCode}:${value}`;
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

  const tokenValue = normalizeTokenValue(parts.slice(2).join(':'));
  if (!tokenValue) {
    return null;
  }

  return {
    type,
    countryCode: normalizeCountryCode(parts[1]),
    value: tokenValue,
    label: tokenValue
      .split('-')
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' '),
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
        : normalizeTokenValue(token.value || token.label || '');
    if (!value) {
      continue;
    }
    const normalized: LocationFilterToken = {
      ...token,
      countryCode: normalizeCountryCode(token.countryCode),
      value,
      label: token.label?.trim() || value,
      parentLabel: token.parentLabel?.trim() || null,
      city: token.city?.trim() || null,
      region: token.region?.trim() || null,
      postalCode: token.postalCode?.trim() || null,
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

function formatSuggestionPrice(value: number): string {
  return formatPropertyPrice(value, 'NL').replace(/\s+/g, ' ').trim();
}

export function getMapPriceSuggestions(
  mode: MapPriceMode,
  bound: 'from' | 'to',
  draftValue: string,
  options: MapPriceSuggestionOptions = {}
): MapPriceSuggestion[] {
  const baseValues = mode === 'sale' ? SALE_PRICE_SUGGESTION_VALUES : RENT_PRICE_SUGGESTION_VALUES;
  const suggestions: MapPriceSuggestion[] = [];
  const sanitizedDraft = sanitizeDraftNumber(draftValue);
  const parsedDraft = sanitizedDraft.length > 0 ? Number.parseInt(sanitizedDraft, 10) : Number.NaN;
  const normalizedDraft =
    sanitizedDraft.length > 0 && Number.isFinite(parsedDraft)
      ? String(parsedDraft)
      : sanitizedDraft;
  const visibleBaseValues = baseValues.filter((value) => !(bound === 'to' && value === 0));
  const shouldFilterByPrefix =
    options.filterByPrefix === true &&
    (Number.isFinite(parsedDraft) ? parsedDraft > 0 : normalizedDraft.length > 0);
  const filteredBaseValues = visibleBaseValues.filter((value) =>
    shouldFilterByPrefix ? String(value).startsWith(normalizedDraft) : true
  );

  if (
    normalizedDraft.length > 0 &&
    Number.isFinite(parsedDraft) &&
    parsedDraft >= 0 &&
    !visibleBaseValues.some((value) => String(value) === normalizedDraft)
  ) {
    suggestions.push({
      key: `custom-${normalizedDraft}`,
      label: formatSuggestionPrice(parsedDraft),
      value: normalizedDraft,
      custom: true,
    });
  }

  for (const value of filteredBaseValues) {
    suggestions.push({
      key: `preset-${value}`,
      label: formatSuggestionPrice(value),
      value: String(value),
      custom: false,
    });
  }

  if (bound === 'to' && !shouldFilterByPrefix) {
    suggestions.push({
      key: 'empty',
      label: 'No max',
      value: '',
      custom: false,
    });
  }

  return suggestions;
}

export function getMapVisiblePriceModes(marketState: readonly MapMarketState[]): MapPriceMode[] {
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

export function normalizeMapMarketState(
  values: Iterable<MapMarketState | string | null | undefined>
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
    salePriceFrom,
    salePriceTo,
    rentPriceFrom,
    rentPriceTo,
    marketState: normalizeMapMarketState(filters.marketState),
    activity: isMapActivityFilter(filters.activity) ? filters.activity : 'all',
    areas: normalizeLocationFilterTokens(filters.areas),
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
      return getActivePriceModes(normalized).some((mode) => {
        const [from, to] = getPriceBoundsForMode(normalized, mode);
        return from != null || to != null;
      });
    case 'marketState':
      return normalized.marketState.length !== MAP_MARKET_STATES.length;
    case 'activity':
      return normalized.activity !== 'all';
  }
}

export function getOrderedMapFilterCategories(filters: MapFilters): MapFilterCategory[] {
  const active = MAP_FILTER_CATEGORIES.filter((category) =>
    isMapFilterCategoryActive(filters, category)
  );
  const inactive = MAP_FILTER_CATEGORIES.filter((category) => !active.includes(category));

  return [...active, ...inactive];
}

export function getMapMarketStateLabel(state: MapMarketState): string {
  return MAP_MARKET_STATE_LABELS[state];
}

export function getMapActivityFilterLabel(activity: MapActivityFilter): string {
  return MAP_ACTIVITY_FILTER_LABELS[activity];
}

export function isMapStatusPillActive(filters: MapFilters, state: MapStatusPillState): boolean {
  const normalized = normalizeMapFilters(filters);

  if (normalized.marketState.length === MAP_MARKET_STATES.length) {
    return false;
  }

  return normalized.marketState.includes(state);
}

export function toggleMapActivityFilter(
  filters: MapFilters,
  activity: Exclude<MapActivityFilter, 'all'>
): MapFilters {
  const normalized = normalizeMapFilters(filters);

  return {
    ...normalized,
    activity: normalized.activity === activity ? 'all' : activity,
  };
}

function isWithinActivityWindow(lastSocialAt: string | null | undefined, days: number): boolean {
  if (!lastSocialAt) {
    return false;
  }

  const timestamp = Date.parse(lastSocialAt);
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  return timestamp >= Date.now() - days * 24 * 60 * 60 * 1000;
}

export function toggleMapStatusPill(filters: MapFilters, state: MapStatusPillState): MapFilters {
  const normalized = normalizeMapFilters(filters);
  const selectedStates = new Set<MapStatusPillState>(
    normalized.marketState.length === MAP_MARKET_STATES.length
      ? []
      : normalized.marketState.filter(isMapStatusPillState)
  );

  if (selectedStates.has(state)) {
    selectedStates.delete(state);
  } else {
    selectedStates.add(state);
  }

  return {
    ...normalized,
    marketState:
      selectedStates.size > 0
        ? MAP_STATUS_PILL_STATES.filter((value) => selectedStates.has(value))
        : [...MAP_MARKET_STATES],
  };
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

export function getMapFilterPillSummary(
  category: MapFilterCategory,
  filters: MapFilters
): string | null {
  const normalized = normalizeMapFilters(filters);

  switch (category) {
    case 'price': {
      const segments = getActivePriceModes(normalized)
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
      if (normalized.marketState.length === MAP_MARKET_STATES.length) {
        return null;
      }

      if (normalized.marketState.length === 1) {
        return getMapMarketStateLabel(normalized.marketState[0]!);
      }

      return `${normalized.marketState.length} selected`;
    case 'activity':
      return normalized.activity === 'all' ? null : getMapActivityFilterLabel(normalized.activity);
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
  }
}

export function serializeMapFiltersToSearchParams(filters: MapFilters): URLSearchParams {
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
  if (normalized.activity !== 'all') {
    params.set('activity', normalized.activity);
  }
  for (const area of normalized.areas ?? []) {
    const serialized = serializeLocationFilterToken(area);
    if (serialized) {
      params.append('area', serialized);
    }
  }

  return params;
}

export function updateMapFilterSearchParams(
  params: URLSearchParams,
  filters: MapFilters
): URLSearchParams {
  const next = new URLSearchParams(params.toString());

  for (const key of MAP_FILTER_QUERY_KEYS) {
    next.delete(key);
  }
  for (const key of PRIVATE_MAP_STATE_QUERY_KEYS) {
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
      ? normalizeMapMarketState(marketStateValue.split(',').map((value) => value.trim()))
      : defaults.marketState,
    activity: isMapActivityFilter(params.get('activity'))
      ? (params.get('activity') as MapActivityFilter)
      : defaults.activity,
    areas: params
      .getAll('area')
      .map(parseLocationFilterToken)
      .filter((token): token is LocationFilterToken => token != null),
  });
}

export function getCanonicalMapFilterSignature(filters: MapFilters): string {
  return serializeMapFiltersToSearchParams(filters).toString();
}

export function getMapFilterSearchString(filters: MapFilters, currentSearch = ''): string {
  const next = updateMapFilterSearchParams(
    new URLSearchParams(currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch),
    filters
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

export function getSaleEffectivePrice(input: SaleEffectivePriceInput): number | null {
  return firstNormalizedPrice([
    input.activeSaleAskingPrice,
    input.lastSoldPrice,
    input.canonicalFmv,
    input.officialValuation,
  ]);
}

export function getRentEffectivePrice(input: RentEffectivePriceInput): number | null {
  return firstNormalizedPrice([input.activeRentAskingPrice, input.lastRentedPrice]);
}

export function inferMapMarketState(candidate: MapFilterMatchCandidate): MapMarketState | null {
  if (candidate.marketState) {
    return candidate.marketState;
  }

  if (candidate.askingPrice != null) {
    return 'for-sale';
  }

  if (candidate.activeRentAskingPrice != null || candidate.lastRentedPrice != null) {
    return 'for-rent';
  }

  return null;
}

export function doesMapFilterCandidateMatch(
  candidate: MapFilterMatchCandidate,
  filters: MapFilters
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
  const shouldApplySaleFilters =
    inferredMarketState == null || isPriceModeStateIncluded([inferredMarketState], 'sale');
  const shouldApplyRentFilters =
    inferredMarketState == null || isPriceModeStateIncluded([inferredMarketState], 'rent');

  if (shouldApplySaleFilters && normalized.salePriceFrom != null) {
    if (saleEffectivePrice == null || saleEffectivePrice < normalized.salePriceFrom) {
      return false;
    }
  }

  if (shouldApplySaleFilters && normalized.salePriceTo != null) {
    if (saleEffectivePrice == null || saleEffectivePrice > normalized.salePriceTo) {
      return false;
    }
  }

  if (shouldApplyRentFilters && normalized.rentPriceFrom != null) {
    if (rentEffectivePrice == null || rentEffectivePrice < normalized.rentPriceFrom) {
      return false;
    }
  }

  if (shouldApplyRentFilters && normalized.rentPriceTo != null) {
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

  if (normalized.activity === 'all-time' && (candidate.socialScore ?? 0) <= 0) {
    return false;
  }

  if (normalized.activity === 'today' && !isWithinActivityWindow(candidate.lastSocialAt, 1)) {
    return false;
  }

  if (normalized.activity === '10d' && !isWithinActivityWindow(candidate.lastSocialAt, 10)) {
    return false;
  }

  if (normalized.activity === '30d' && !isWithinActivityWindow(candidate.lastSocialAt, 30)) {
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
