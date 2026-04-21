import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type {
  PropertyResolveRequest as SharedPropertyResolveRequest,
  PropertyGroupBounds,
  PropertyResolveResponse,
} from '@huishype/shared';
import { withDerivedPropertyImageData } from './property-image';
import {
  buildNearbyGroupPath,
  createDefaultMapFilters,
  updateMapFilterSearchParams,
  type MapActivityFilter,
  type MapFilters,
  type MapMarketState,
} from '@/src/lib/sharedMapFilters';

const DEFAULT_API_PORT = '3100';
type ApiAccessTokenResolver = () => Promise<string | null>;
type WebRuntimeConfig = {
  apiUrl?: string;
};

let apiAccessTokenResolver: ApiAccessTokenResolver | null = null;

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function setApiAccessTokenResolver(
  resolver: ApiAccessTokenResolver | null,
): void {
  apiAccessTokenResolver = resolver;
}

// Extract the port from a URL string, or return undefined if none is present.
const extractPort = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);
    return parsed.port || undefined;
  } catch {
    return undefined;
  }
};

const getWebRuntimeApiUrl = (): string | undefined => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return undefined;
  }

  const runtimeConfig = (
    window as typeof window & {
      __HUISHYPE_RUNTIME_CONFIG__?: WebRuntimeConfig;
    }
  ).__HUISHYPE_RUNTIME_CONFIG__;
  const apiUrl = runtimeConfig?.apiUrl?.trim();

  if (!apiUrl) {
    return undefined;
  }

  try {
    return new URL(apiUrl).toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
};

// Get the API URL, resolving to the correct host for the current environment:
// - If EXPO_PUBLIC_API_URL is set to a non-localhost address, use it as-is
// - Native: use the hostname from Expo's hostUri (same host that serves Metro)
//   This works universally: LAN IP, localhost (adb reverse), 10.0.2.2 (emulator)
// - Android without hostUri: fallback to 10.0.2.2 (emulator host alias)
// - iOS simulator / web / fallback: localhost
//
// When an explicit URL is configured (EXPO_PUBLIC_API_URL or extra.apiUrl),
// its port is preserved during host rewriting. The hardcoded default port is
// only used when no URL is configured at all.
const getApiUrl = (): string => {
  const runtimeUrl = getWebRuntimeApiUrl();
  if (runtimeUrl) {
    return runtimeUrl;
  }

  const envUrl = process.env.EXPO_PUBLIC_API_URL || '';
  const configUrl = Constants.expoConfig?.extra?.apiUrl as string | undefined;
  const url = envUrl || configUrl || '';

  // Determine which port to use: prefer the port from the configured URL,
  // fall back to the default only when no URL is configured.
  const port = (url && extractPort(url)) || DEFAULT_API_PORT;

  // If explicitly configured to a non-loopback address, use it directly
  if (url && !url.includes('localhost') && !url.includes('127.0.0.1')) {
    return url;
  }

  // For native platforms, try to resolve a reachable host
  if (Platform.OS === 'android' || Platform.OS === 'ios') {
    // Expo dev server exposes the dev machine's address via hostUri (e.g. "192.168.1.5:8081").
    // Whatever hostname Metro is reachable at, the API is reachable at the same hostname:
    // - LAN IP (192.168.x.x) → device on same network
    // - localhost/127.0.0.1  → physical device with adb reverse (ports forwarded)
    // - 10.0.2.2             → Android emulator host alias
    const hostUri = Constants.expoConfig?.hostUri;
    if (hostUri) {
      const host = hostUri.split(':')[0];
      if (host) {
        return `http://${host}:${port}`;
      }
    }

    // No hostUri at all — likely Android emulator where hostUri isn't set
    if (Platform.OS === 'android') {
      return `http://10.0.2.2:${port}`;
    }
  }

  // Web: if the page is served from a non-localhost address (e.g. LAN IP),
  // use that same host for the API so mobile browsers on the same network work.
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const pageHost = window.location.hostname;
    if (pageHost && pageHost !== 'localhost' && pageHost !== '127.0.0.1') {
      return `http://${pageHost}:${port}`;
    }
  }

  // iOS simulator, web (localhost), or no detection: localhost works
  return url || `http://localhost:${port}`;
};

export const API_URL = getApiUrl();

// Base fetch wrapper with common configuration
export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  const headers = new Headers(options.headers);

  const isFormDataBody =
    typeof FormData !== 'undefined' && options.body instanceof FormData;

  if (!headers.has('Content-Type') && !isFormDataBody) {
    headers.set('Content-Type', 'application/json');
  }

  if (!headers.has('Authorization') && apiAccessTokenResolver) {
    const accessToken = await apiAccessTokenResolver();
    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: `HTTP error! status: ${response.status}` }));
    throw new ApiError(
      response.status,
      error.message || `HTTP error! status: ${response.status}`,
      error.error,
    );
  }

  return response.json();
}

// --- Property resolve (imperative, not a hook) ---

export type PropertyResolveResult = PropertyResolveResponse & {
  countryCode?: string | null;
  hasActiveListing?: boolean;
  marketState?: MapMarketState | null;
};

export type PropertyResolveRequest = Omit<
  SharedPropertyResolveRequest,
  'houseNumberAddition' | 'countryCode' | 'street' | 'city'
> & {
  houseNumberAddition?: string | null;
  countryCode?: string | null;
  street?: string | null;
  city?: string | null;
};

type PropertyResolveRequestInput = Omit<PropertyResolveRequest, 'houseNumber'> & {
  houseNumber: number | string;
};

function normalizePostalCodeForCompare(value: string): string {
  return value.replace(/\s/g, '').toUpperCase();
}

function normalizeComparableText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function containsComparableText(haystack: string, needle: string): boolean {
  return (
    haystack === needle ||
    haystack.startsWith(`${needle} `) ||
    haystack.endsWith(` ${needle}`) ||
    haystack.includes(` ${needle} `)
  );
}

function resolvedPropertyMatchesRequest(
  result: PropertyResolveResult,
  request: PropertyResolveRequest,
): boolean {
  const requestCountryCode = request.countryCode?.trim().toUpperCase();
  if (requestCountryCode && result.countryCode?.trim().toUpperCase() !== requestCountryCode) {
    return false;
  }

  if (
    normalizePostalCodeForCompare(result.postalCode) !==
    normalizePostalCodeForCompare(request.postalCode)
  ) {
    return false;
  }

  if (
    request.city &&
    normalizeComparableText(result.city) !== normalizeComparableText(request.city)
  ) {
    return false;
  }

  const normalizedResultAddress = normalizeComparableText(result.address);

  if (request.street) {
    const normalizedStreet = normalizeComparableText(request.street);
    if (
      normalizedStreet &&
      !containsComparableText(normalizedResultAddress, normalizedStreet) &&
      !normalizedResultAddress.includes(`${normalizedStreet} `)
    ) {
      return false;
    }
  }

  const houseNumber = String(request.houseNumber).trim();
  const houseCandidates = request.houseNumberAddition
    ? [
        `${houseNumber}${request.houseNumberAddition}`,
        `${houseNumber} ${request.houseNumberAddition}`,
        `${houseNumber}-${request.houseNumberAddition}`,
      ]
    : [houseNumber];

  const hasMatchingHouseToken = houseCandidates.some((candidate) => {
    const normalizedCandidate = normalizeComparableText(candidate);
    return (
      !!normalizedCandidate &&
      (containsComparableText(normalizedResultAddress, normalizedCandidate) ||
        normalizedResultAddress.includes(`${normalizedCandidate} `))
    );
  });

  return hasMatchingHouseToken;
}

/**
 * Resolve a canonical address to a local property.
 * Returns null if the property is not found or the resolved property does not
 * match the structured address that was requested.
 *
 * This is an imperative async function (NOT a hook) — call it from search
 * result tap handlers.
 */
export async function resolveProperty(
  requestInput: PropertyResolveRequestInput,
): Promise<PropertyResolveResult | null> {
  try {
    const normalizedHouseNumber = Number.parseInt(
      String(requestInput.houseNumber).trim(),
      10,
    );

    if (!Number.isSafeInteger(normalizedHouseNumber) || normalizedHouseNumber <= 0) {
      return null;
    }

    const request: PropertyResolveRequest = {
      ...requestInput,
      houseNumber: normalizedHouseNumber,
      houseNumberAddition: requestInput.houseNumberAddition ?? undefined,
      countryCode: requestInput.countryCode ?? undefined,
      street: requestInput.street ?? undefined,
      city: requestInput.city ?? undefined,
    };

    const params = new URLSearchParams({
      postalCode: request.postalCode,
      houseNumber: String(request.houseNumber),
    });
    if (request.houseNumberAddition) {
      params.set('houseNumberAddition', request.houseNumberAddition);
    }
    if (request.countryCode) {
      params.set('countryCode', request.countryCode);
    }
    if (request.street) {
      params.set('street', request.street);
    }
    if (request.city) {
      params.set('city', request.city);
    }

    const result = await apiFetch<PropertyResolveResult | null>(
      `/properties/resolve?${params.toString()}`,
    );
    if (!result) {
      return null;
    }
    if (!resolvedPropertyMatchesRequest(result, request)) {
      console.warn('[HuisHype] resolveProperty mismatch for canonical input:', {
        request,
        result,
      });
      return null;
    }
    return result;
  } catch (err) {
    // 404 means property not found — return null
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    console.warn('[HuisHype] resolveProperty failed:', err);
    return null;
  }
}

// --- Cluster-aware nearby lookup (imperative, not a hook) ---

/** Density-aware grouped result from GET /properties/nearby */
export interface NearbyGroupedResult {
  nodeClass: 'active' | 'ghost';
  groupKind: 'single' | 'cluster';
  primaryPropertyId: string;
  pointCount: number;
  propertyIds: string[];
  previewPropertyIds: string[];
  coordinate: [number, number];
  distanceMeters: number;
  bbox: [number, number, number, number] | null;
  activeListingCount: number;
  socialCount: number;
  recentSocialCount: number;
  socialScoreTotal: number;
  socialScoreMax: number;
  recentSocialScoreTotal: number;
  commentCount: number;
  streetName: string | null;
  houseNumber: number | null;
  houseNumberAddition: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  countryCode: string | null;
  officialValuation: number | null;
  askingPrice: number | null;
  thumbnailUrl: string | null;
  yearBuilt?: number | null;
  floorAreaM2?: number | null;
  hasActiveListing?: boolean | null;
  marketState?: MapMarketState | null;
  isRead?: boolean | null;

  // Temporary compatibility while backend tile payloads finish the cutover.
  activityScore?: number;
  activityScoreTotal?: number;
  hasListing?: boolean;
}

export interface NormalizedPropertyNodeGroup {
  nodeClass: 'active' | 'ghost';
  groupKind: 'single' | 'cluster';
  primaryPropertyId: string;
  pointCount: number;
  propertyIds: string[];
  previewPropertyIds: string[];
  coordinate: [number, number];
  bbox: PropertyGroupBounds | null;
  activeListingCount: number;
  socialCount: number;
  recentSocialCount: number;
  socialScoreTotal: number;
  socialScoreMax: number;
  recentSocialScoreTotal: number;
  commentCount: number;
  streetName: string | null;
  houseNumber: number | null;
  houseNumberAddition: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  countryCode: string | null;
  officialValuation: number | null;
  askingPrice: number | null;
  thumbnailUrl: string | null;
  yearBuilt: number | null;
  floorAreaM2: number | null;
  hasActiveListing: boolean | null;
  marketState: MapMarketState | null;
  isRead?: boolean | null;

  // Legacy compatibility while downstream consumers finish the cutover.
  hasListing: boolean;
  activityScore: number;
  activityScoreTotal: number;
  likeCount: number;
  guessCount: number;
}

export interface NearbyPropertyGroup extends NormalizedPropertyNodeGroup {
  distanceMeters: number;
}

export function parseTransportPropertyIds(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toNumber(value: unknown, fallback = 0): number {
  return toNullableNumber(value) ?? fallback;
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toNullableBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
  }
  return null;
}

function toNullableMarketState(value: unknown): MapMarketState | null {
  return value === 'for-sale' ||
    value === 'for-rent' ||
    value === 'sold' ||
    value === 'rented' ||
    value === 'not-listed'
    ? value
    : null;
}

function getTransportValue(
  properties: GeoJSON.GeoJsonProperties | Record<string, unknown>,
  ...keys: string[]
): unknown {
  if (!properties) {
    return undefined;
  }

  for (const key of keys) {
    const value = properties[key];
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function normalizeBbox(
  bbox: [number, number, number, number] | null | undefined,
): PropertyGroupBounds | null {
  if (!bbox) {
    return null;
  }

  return {
    west: bbox[0],
    south: bbox[1],
    east: bbox[2],
    north: bbox[3],
  };
}

export function normalizeNearbyPropertyGroup(result: NearbyGroupedResult): NearbyPropertyGroup {
  const activeListingCount = toNumber(
    result.activeListingCount,
    result.hasActiveListing ? 1 : 0,
  );
  const socialScoreTotal = toNumber(result.socialScoreTotal);
  const socialScoreMax = toNumber(result.socialScoreMax, socialScoreTotal);
  const recentSocialScoreTotal = toNumber(result.recentSocialScoreTotal);
  const socialCount = toNumber(result.socialCount, socialScoreTotal > 0 ? 1 : 0);
  const recentSocialCount = toNumber(
    result.recentSocialCount,
    recentSocialScoreTotal > 0 ? 1 : 0,
  );
  const hasActiveListing =
    result.hasActiveListing ?? (activeListingCount > 0 ? true : false);

  return {
    nodeClass: result.nodeClass,
    groupKind: result.groupKind,
    primaryPropertyId: result.primaryPropertyId,
    pointCount: result.pointCount,
    propertyIds: result.propertyIds,
    previewPropertyIds: result.previewPropertyIds,
    coordinate: result.coordinate,
    bbox: normalizeBbox(result.bbox),
    activeListingCount,
    socialCount,
    recentSocialCount,
    socialScoreTotal,
    socialScoreMax,
    recentSocialScoreTotal,
    commentCount: result.commentCount,
    hasListing: hasActiveListing,
    activityScore: socialScoreMax,
    activityScoreTotal: socialScoreTotal,
    likeCount: 0,
    guessCount: 0,
    streetName: result.streetName,
    houseNumber: result.houseNumber,
    houseNumberAddition: result.houseNumberAddition,
    address: result.address,
    city: result.city,
    postalCode: result.postalCode,
    countryCode: result.countryCode,
    officialValuation: result.officialValuation,
    askingPrice: result.askingPrice,
    thumbnailUrl: result.thumbnailUrl,
    yearBuilt: result.yearBuilt ?? null,
    floorAreaM2: result.floorAreaM2 ?? null,
    hasActiveListing,
    marketState: result.marketState ?? null,
    isRead: result.isRead ?? null,
    distanceMeters: result.distanceMeters,
  };
}

export function normalizeRenderedPropertyGroup(
  feature: GeoJSON.Feature,
): NormalizedPropertyNodeGroup | null {
  const properties = feature.properties;
  const geometry = feature.geometry;

  if (!properties || geometry?.type !== 'Point') {
    return null;
  }

  const nodeClass = toNullableString(properties.node_class);
  const groupKind = toNullableString(properties.group_kind);
  const propertyIds = parseTransportPropertyIds(
    getTransportValue(properties, 'property_ids') as string | string[] | null | undefined,
  );
  const previewPropertyIds = parseTransportPropertyIds(
    getTransportValue(properties, 'preview_property_ids') as
      | string
      | string[]
      | null
      | undefined,
  );
  const primaryPropertyId =
    toNullableString(getTransportValue(properties, 'primary_property_id')) ??
    toNullableString(properties.id) ??
    propertyIds[0] ??
    null;

  if (
    (nodeClass !== 'active' && nodeClass !== 'ghost') ||
    (groupKind !== 'single' && groupKind !== 'cluster') ||
    !primaryPropertyId
  ) {
    return null;
  }

  const activeListingCount = toNumber(
    getTransportValue(properties, 'activeListingCount', 'active_listing_count'),
    toNullableBoolean(getTransportValue(properties, 'hasActiveListing', 'has_active_listing'))
      ? 1
      : 0,
  );
  const socialScoreTotal = toNumber(
    getTransportValue(properties, 'socialScoreTotal', 'social_score_total'),
  );
  const socialScoreMax = toNumber(
    getTransportValue(properties, 'socialScoreMax', 'social_score_max'),
    socialScoreTotal,
  );
  const recentSocialScoreTotal = toNumber(
    getTransportValue(properties, 'recentSocialScoreTotal', 'recent_social_score_total'),
  );
  const socialCount = toNumber(
    getTransportValue(properties, 'socialCount', 'social_count'),
    socialScoreTotal > 0 ? 1 : 0,
  );
  const recentSocialCount = toNumber(
    getTransportValue(properties, 'recentSocialCount', 'recent_social_count'),
    recentSocialScoreTotal > 0 ? 1 : 0,
  );
  const hasActiveListing =
    toNullableBoolean(getTransportValue(properties, 'hasActiveListing', 'has_active_listing')) ??
    (activeListingCount > 0 ? true : false);

  return {
    nodeClass,
    groupKind,
    primaryPropertyId,
    pointCount: toNumber(properties.point_count, 1),
    propertyIds,
    previewPropertyIds: previewPropertyIds.length > 0 ? previewPropertyIds : propertyIds,
    coordinate: geometry.coordinates as [number, number],
    bbox:
      toNullableNumber(getTransportValue(properties, 'bbox_west')) != null &&
      toNullableNumber(getTransportValue(properties, 'bbox_south')) != null &&
      toNullableNumber(getTransportValue(properties, 'bbox_east')) != null &&
      toNullableNumber(getTransportValue(properties, 'bbox_north')) != null
        ? {
            west: toNumber(getTransportValue(properties, 'bbox_west')),
            south: toNumber(getTransportValue(properties, 'bbox_south')),
            east: toNumber(getTransportValue(properties, 'bbox_east')),
            north: toNumber(getTransportValue(properties, 'bbox_north')),
          }
        : null,
    activeListingCount,
    socialCount,
    recentSocialCount,
    socialScoreTotal,
    socialScoreMax,
    recentSocialScoreTotal,
    commentCount: toNumber(getTransportValue(properties, 'commentCount', 'comment_count')),
    hasListing: hasActiveListing,
    activityScore: socialScoreMax,
    activityScoreTotal: socialScoreTotal,
    likeCount: toNumber(getTransportValue(properties, 'likeCount', 'like_count')),
    guessCount: toNumber(getTransportValue(properties, 'guessCount', 'guess_count')),
    streetName: toNullableString(getTransportValue(properties, 'streetName', 'street_name')),
    houseNumber: toNullableNumber(getTransportValue(properties, 'houseNumber', 'house_number')),
    houseNumberAddition: toNullableString(
      getTransportValue(properties, 'houseNumberAddition', 'house_number_addition'),
    ),
    address: toNullableString(getTransportValue(properties, 'address')),
    city: toNullableString(getTransportValue(properties, 'city')),
    postalCode: toNullableString(getTransportValue(properties, 'postalCode', 'postal_code')),
    countryCode: toNullableString(getTransportValue(properties, 'countryCode', 'country_code')),
    officialValuation: toNullableNumber(
      getTransportValue(properties, 'officialValuation', 'official_valuation'),
    ),
    askingPrice: toNullableNumber(getTransportValue(properties, 'askingPrice', 'asking_price')),
    thumbnailUrl: toNullableString(getTransportValue(properties, 'thumbnailUrl', 'thumbnail_url')),
    yearBuilt: toNullableNumber(getTransportValue(properties, 'yearBuilt', 'year_built')),
    floorAreaM2: toNullableNumber(getTransportValue(properties, 'floorAreaM2', 'floor_area_m2')),
    hasActiveListing,
    marketState: toNullableMarketState(
      getTransportValue(properties, 'marketState', 'market_state'),
    ),
    isRead: toNullableBoolean(getTransportValue(properties, 'isRead', 'is_read')),
  };
}

/**
 * Fetch cluster-aware nearby result for a tap coordinate.
 * Returns a discriminated union: either a cluster (multiple properties in
 * the same grid cell) or a single property, or null if nothing is nearby.
 */
export async function fetchNearbyGroup(
  lon: number,
  lat: number,
  zoom: number,
  filters: MapFilters = createDefaultMapFilters(),
): Promise<NearbyPropertyGroup | null> {
  try {
    const result = await apiFetch<NearbyGroupedResult | null>(
      buildNearbyGroupPath(lon, lat, zoom, filters),
    );
    return result ? normalizeNearbyPropertyGroup(result) : null;
  } catch (err) {
    console.warn('[HuisHype] fetchNearbyGroup failed:', err);
    return null;
  }
}

function buildFollowingNearbyGroupPath(
  lon: number,
  lat: number,
  zoom: number,
  filters: MapFilters,
  followingActivity: MapActivityFilter,
): string {
  const params = updateMapFilterSearchParams(
    new URLSearchParams({
      lon: String(lon),
      lat: String(lat),
      zoom: String(zoom),
    }),
    filters,
  );

  params.delete('activity');
  if (followingActivity !== 'all') {
    params.set('activity', followingActivity);
  }

  return `/properties/following-nearby?${params.toString()}`;
}

export async function fetchFollowingNearbyGroup(
  lon: number,
  lat: number,
  zoom: number,
  filters: MapFilters = createDefaultMapFilters(),
  followingActivity: MapActivityFilter = 'all-time',
): Promise<NearbyPropertyGroup | null> {
  try {
    const result = await apiFetch<NearbyGroupedResult | null>(
      buildFollowingNearbyGroupPath(lon, lat, zoom, filters, followingActivity),
    );
    return result ? normalizeNearbyPropertyGroup(result) : null;
  } catch (err) {
    console.warn('[HuisHype] fetchFollowingNearbyGroup failed:', err);
    return null;
  }
}

// --- Batch property lookup (imperative, not a hook) ---

/** Shape returned by GET /properties/batch */
export interface BatchProperty {
  id: string;
  nationalId: string | null;
  countryCode: string;
  address: string;
  city: string;
  postalCode: string | null;
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
  imageryGeometry?: { type: 'Point'; coordinates: [number, number] } | null;
  yearBuilt: number | null;
  floorAreaM2: number | null;
  status: string;
  officialValuation: number | null;
  hasListing: boolean;
  hasActiveListing?: boolean;
  marketState?: MapMarketState;
  latestListingStatus?: 'active' | 'sold' | 'rented' | 'withdrawn' | null;
  askingPrice: number | null;
  socialScore?: number;
  recentSocialScore?: number;
  lastSocialAt?: string | null;
  topLevelCommentCount?: number;
  replyCount?: number;
  propertyLikeCount?: number;
  commentLikeCount?: number;
  guessCount: number;
  viewCount?: number;
  uniqueViewerCount?: number;
  recentTopLevelCommentCount?: number;
  recentReplyCount?: number;
  recentPropertyLikeCount?: number;
  recentCommentLikeCount?: number;
  recentGuessCount?: number;
  recentViewCount?: number;
  recentUniqueViewerCount?: number;
  likeCount?: number;
  commentCount?: number;
  activityScore?: number;
  isRead?: boolean | null;
  aerialImageUrl?: string | null;
  thumbnailUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

function normalizeBatchPropertiesResponse(
  response: BatchProperty[],
): BatchProperty[] {
  return response.map((property) => withDerivedPropertyImageData(property));
}

/**
 * Fetch multiple properties by their IDs.
 * The API preserves input order and caps at 50 IDs per request.
 */
export async function fetchBatchProperties(
  ids: string[],
): Promise<BatchProperty[]> {
  if (ids.length === 0) return [];
  const result = await apiFetch<BatchProperty[]>(
    `/properties/batch?ids=${ids.join(',')}`,
  );
  return normalizeBatchPropertiesResponse(result);
}

// Convenience methods
export const api = {
  get: <T>(endpoint: string, options?: RequestInit) =>
    apiFetch<T>(endpoint, { ...options, method: 'GET' }),

  post: <T>(endpoint: string, data: unknown, options?: RequestInit) =>
    apiFetch<T>(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(data),
    }),

  put: <T>(endpoint: string, data: unknown, options?: RequestInit) =>
    apiFetch<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: <T>(endpoint: string, options?: RequestInit) =>
    apiFetch<T>(endpoint, { ...options, method: 'DELETE' }),
};
