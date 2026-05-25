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
async function apiFetchWithResponse<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ data: T; response: Response }> {
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

  return {
    data: await response.json(),
    response,
  };
}

export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const { data } = await apiFetchWithResponse<T>(endpoint, options);
  return data;
}

// --- Property resolve (imperative, not a hook) ---

export type PropertyResolveResult = PropertyResolveResponse & {
  countryCode?: string | null;
  hasActiveListing?: boolean;
  marketState?: MapMarketState | null;
  officialValuationSourceFetch?: OfficialValuationSourceFetch | null;
  commentsDisabled?: boolean | null;
};

export interface OfficialValuationSourceFetch {
  source: 'woz';
  expectedValuationYear: number;
  supportsClientFetch: {
    web: boolean;
    native: boolean;
  };
}

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
  pyramidVersionId?: string | null;
  pyramidNodeId?: string | null;
  membershipComplete?: boolean | null;
  readStateCoverage?: 'complete' | 'partial' | null;
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
  officialValuationYear?: number | null;
  officialValuationSourceFetch?: OfficialValuationSourceFetch | null;
  askingPrice: number | null;
  thumbnailUrl: string | null;
  yearBuilt?: number | null;
  floorAreaM2?: number | null;
  hasActiveListing?: boolean | null;
  marketState?: MapMarketState | null;
  isRead: boolean;

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
  pyramidVersionId: string | null;
  pyramidNodeId: string | null;
  membershipComplete: boolean;
  readStateCoverage: 'complete' | 'partial';
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
  officialValuationYear?: number | null;
  officialValuationSourceFetch?: OfficialValuationSourceFetch | null;
  askingPrice: number | null;
  thumbnailUrl: string | null;
  yearBuilt: number | null;
  floorAreaM2: number | null;
  hasActiveListing: boolean | null;
  marketState: MapMarketState | null;
  isRead: boolean | null;

  // Legacy compatibility while downstream consumers finish the cutover.
  hasListing: boolean;
  activityScore: number;
  activityScoreTotal: number;
  likeCount: number;
  guessCount: number;
}

export interface NearbyPropertyGroup extends Omit<NormalizedPropertyNodeGroup, 'isRead'> {
  isRead: boolean;
  distanceMeters: number;
  source?: 'nearby' | 'physical-tap' | 'house-number-tap';
  match?: PhysicalTapResolveMatch;
  previewProperties?: PhysicalTapPreviewProperty[];
}

export interface NearbyGroupLookupOptions {
  pyramidVersionId?: string | null;
  pyramidNodeId?: string | null;
}

export type PhysicalTapResolveMatch =
  | 'containing-building'
  | 'nearby-building'
  | 'nearby-property'
  | 'house-number';

export type PhysicalTapCoordinate =
  | [number, number]
  | {
      longitude?: number | null;
      latitude?: number | null;
      lon?: number | null;
      lat?: number | null;
    };

export interface PhysicalTapPreviewProperty {
  id: string;
  address?: string | null;
  street?: string | null;
  streetName?: string | null;
  houseNumber?: string | number | null;
  houseNumberAddition?: string | null;
  city?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
  country?: string | null;
  coordinate?: PhysicalTapCoordinate | null;
  coordinates?: PhysicalTapCoordinate | null;
  geometry?: { type: 'Point'; coordinates: [number, number] } | null;
  imageryCoordinate?: PhysicalTapCoordinate | null;
  imageryGeometry?: { type: 'Point'; coordinates: [number, number] } | null;
  officialValuation?: number | null;
  officialValuationYear?: number | null;
  officialValuationSourceFetch?: OfficialValuationSourceFetch | null;
  askingPrice?: number | null;
  hasActiveListing?: boolean | null;
  hasListing?: boolean | null;
  marketState?: MapMarketState | null;
  socialScore?: number | null;
  recentSocialScore?: number | null;
  activityScore?: number | null;
  activityLevel?: 'hot' | 'warm' | 'cold' | null;
  thumbnailUrl?: string | null;
  aerialImageUrl?: string | null;
  yearBuilt?: number | null;
  floorAreaM2?: number | null;
  likeCount?: number | null;
  commentCount?: number | null;
  topLevelCommentCount?: number | null;
  replyCount?: number | null;
  commentsDisabled?: boolean | null;
  guessCount?: number | null;
  isRead?: boolean | null;
}

interface PhysicalTapSingleResponse {
  kind: 'single';
  source: 'physical-tap' | 'house-number-tap';
  property: PhysicalTapPreviewProperty;
  coordinate: PhysicalTapCoordinate;
  match: PhysicalTapResolveMatch;
}

interface PhysicalTapGroupPayload {
  primaryPropertyId?: string | null;
  pointCount?: number | null;
  propertyIds?: string[] | string | null;
  previewPropertyIds?: string[] | string | null;
  previewProperties?: PhysicalTapPreviewProperty[] | null;
  coordinate?: PhysicalTapCoordinate | null;
  bbox?: [number, number, number, number] | PropertyGroupBounds | null;
  activeListingCount?: number | null;
  socialCount?: number | null;
  recentSocialCount?: number | null;
  socialScoreTotal?: number | null;
  socialScoreMax?: number | null;
  recentSocialScoreTotal?: number | null;
  commentCount?: number | null;
  streetName?: string | null;
  houseNumber?: number | null;
  houseNumberAddition?: string | null;
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
  officialValuation?: number | null;
  officialValuationYear?: number | null;
  officialValuationSourceFetch?: OfficialValuationSourceFetch | null;
  askingPrice?: number | null;
  thumbnailUrl?: string | null;
  yearBuilt?: number | null;
  floorAreaM2?: number | null;
  hasActiveListing?: boolean | null;
  marketState?: MapMarketState | null;
  isRead?: boolean | null;
}

interface PhysicalTapGroupResponse {
  kind: 'group';
  source: 'physical-tap' | 'house-number-tap';
  group: PhysicalTapGroupPayload;
  coordinate: PhysicalTapCoordinate;
  match: PhysicalTapResolveMatch;
}

type PhysicalTapResolveResponse = PhysicalTapSingleResponse | PhysicalTapGroupResponse | null;

type NearbyStatusHeader =
  | 'pyramid-promoted'
  | 'pyramid-empty'
  | 'pyramid-missing'
  | 'pyramid-stale'
  | 'pyramid-unavailable'
  | 'pyramid-build-active'
  | 'pyramid-build-enqueued'
  | 'pyramid-terminal'
  | 'pyramid-uncovered';

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

function toBoolean(value: unknown, fallback: boolean): boolean {
  return toNullableBoolean(value) ?? fallback;
}

function toReadStateCoverage(value: unknown, fallback: 'complete' | 'partial'): 'complete' | 'partial' {
  return value === 'partial' || value === 'complete' ? value : fallback;
}

export interface OfficialValuationHydrateResponse {
  propertyId: string;
  source: 'woz';
  status: 'accepted' | 'queued' | 'pending' | 'already_cached' | 'unsupported';
  valuationYear: number;
  officialValuation: number | null;
  officialValuationYear: number | null;
  officialValuationVerified: boolean;
  job: {
    id: string;
    state: 'queued' | 'running' | 'succeeded' | 'retryable' | 'failed' | 'cooldown';
    nextAttemptAt: string | null;
  } | null;
}

export interface OfficialValuationCurrentStatus {
  propertyId: string;
  source: 'woz';
  expectedValuationYear: number;
  officialValuation: number | null;
  officialValuationYear: number | null;
  officialValuationVerified: boolean;
  job: {
    id: string;
    state: 'queued' | 'running' | 'succeeded' | 'retryable' | 'failed' | 'cooldown';
    valuationYear: number;
    attemptCount: number;
    nextAttemptAt: string | null;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
  } | null;
  sourceState: {
    state: string;
    retryAfter: string | null;
    throttleUntil: string | null;
    adaptiveRequestsPerMinute: number;
    adaptiveConcurrency: number;
    lastRateLimitAt: string | null;
    lastError: string | null;
    lastObservedStatus: number | null;
  } | null;
}

export async function submitOfficialValuationHydration(
  propertyId: string,
  accessToken?: string | null,
): Promise<OfficialValuationHydrateResponse> {
  return api.post<OfficialValuationHydrateResponse>(
    `/properties/${propertyId}/official-valuations/hydrate`,
    { source: 'woz' },
    accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
  );
}

export async function fetchCurrentOfficialValuationStatus(
  propertyId: string,
  source: 'woz' = 'woz',
): Promise<OfficialValuationCurrentStatus> {
  const params = new URLSearchParams({ source });
  return api.get<OfficialValuationCurrentStatus>(
    `/properties/${propertyId}/official-valuations/current?${params.toString()}`,
  );
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

function parseOfficialValuationSourceFetch(
  properties: GeoJSON.GeoJsonProperties | Record<string, unknown>,
): OfficialValuationSourceFetch | null {
  const source = toNullableString(
    getTransportValue(
      properties,
      'officialValuationSource',
      'official_valuation_source',
    ),
  );
  const expectedValuationYear = toNullableNumber(
    getTransportValue(
      properties,
      'officialValuationExpectedYear',
      'official_valuation_expected_year',
    ),
  );

  if (source !== 'woz' || expectedValuationYear == null) {
    return null;
  }

  return {
    source,
    expectedValuationYear,
    supportsClientFetch: {
      web:
        toNullableBoolean(
          getTransportValue(
            properties,
            'officialValuationSupportsWeb',
            'official_valuation_supports_web',
          ),
        ) ?? false,
      native:
        toNullableBoolean(
          getTransportValue(
            properties,
            'officialValuationSupportsNative',
            'official_valuation_supports_native',
          ),
        ) ?? false,
    },
  };
}

function normalizeBbox(
  bbox: [number, number, number, number] | PropertyGroupBounds | null | undefined,
): PropertyGroupBounds | null {
  if (!bbox) {
    return null;
  }

  if (!Array.isArray(bbox)) {
    return bbox;
  }

  return {
    west: bbox[0],
    south: bbox[1],
    east: bbox[2],
    north: bbox[3],
  };
}

export function normalizeNearbyPropertyGroup(result: NearbyGroupedResult): NearbyPropertyGroup {
  const transport = result as NearbyGroupedResult & Record<string, unknown>;
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
  const membershipComplete = toBoolean(
    getTransportValue(transport, 'membershipComplete', 'membership_complete'),
    true,
  );
  const readStateCoverage = toReadStateCoverage(
    getTransportValue(transport, 'readStateCoverage', 'read_state_coverage'),
    membershipComplete ? 'complete' : 'partial',
  );
  const camelPropertyIds = parseTransportPropertyIds(result.propertyIds);
  const snakePropertyIds = parseTransportPropertyIds(
    transport.property_ids as string | string[] | null | undefined,
  );
  const camelPreviewPropertyIds = parseTransportPropertyIds(result.previewPropertyIds);
  const snakePreviewPropertyIds = parseTransportPropertyIds(
    transport.preview_property_ids as string | string[] | null | undefined,
  );
  const transportPropertyIds =
    camelPropertyIds.length > 0 ? camelPropertyIds : snakePropertyIds;
  const transportPreviewPropertyIds =
    camelPreviewPropertyIds.length > 0 ? camelPreviewPropertyIds : snakePreviewPropertyIds;
  const propertyIds =
    transportPropertyIds.length > 0
      ? transportPropertyIds
      : result.groupKind === 'single'
        ? [result.primaryPropertyId]
        : [];
  const previewPropertyIds =
    transportPreviewPropertyIds.length > 0 || !membershipComplete || readStateCoverage === 'partial'
      ? transportPreviewPropertyIds
      : propertyIds;

  return {
    nodeClass: result.nodeClass,
    groupKind: result.groupKind,
    primaryPropertyId: result.primaryPropertyId,
    pointCount: result.pointCount,
    propertyIds,
    previewPropertyIds,
    pyramidVersionId: result.pyramidVersionId ?? null,
    pyramidNodeId: result.pyramidNodeId ?? null,
    membershipComplete,
    readStateCoverage,
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
    officialValuationYear: result.officialValuationYear ?? null,
    officialValuationSourceFetch: result.officialValuationSourceFetch ?? null,
    askingPrice: result.askingPrice,
    thumbnailUrl: result.thumbnailUrl,
    yearBuilt: result.yearBuilt ?? null,
    floorAreaM2: result.floorAreaM2 ?? null,
    hasActiveListing,
    marketState: result.marketState ?? null,
    isRead: result.isRead,
    distanceMeters: result.distanceMeters,
  };
}

function normalizePhysicalTapCoordinate(
  coordinate: PhysicalTapCoordinate | null | undefined,
): [number, number] | null {
  if (Array.isArray(coordinate)) {
    const [lon, lat] = coordinate;
    return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
  }

  if (!coordinate) {
    return null;
  }

  const lon = coordinate.longitude ?? coordinate.lon;
  const lat = coordinate.latitude ?? coordinate.lat;
  return typeof lon === 'number' &&
    Number.isFinite(lon) &&
    typeof lat === 'number' &&
    Number.isFinite(lat)
    ? [lon, lat]
    : null;
}

function normalizePhysicalTapPreviewProperty(
  property: PhysicalTapPreviewProperty,
  fallbackCoordinate: [number, number],
): PhysicalTapPreviewProperty {
  const coordinate =
    property.geometry?.coordinates ??
    normalizePhysicalTapCoordinate(property.coordinate) ??
    normalizePhysicalTapCoordinate(property.coordinates) ??
    fallbackCoordinate;
  const imageryCoordinate = normalizePhysicalTapCoordinate(property.imageryCoordinate);
  const countryCode = property.countryCode ?? property.country ?? null;
  const streetName = property.streetName ?? property.street ?? null;

  const normalized = withDerivedPropertyImageData({
    ...property,
    address: property.address ?? '',
    streetName,
    city: property.city ?? '',
    countryCode: countryCode ?? undefined,
    geometry: property.geometry ?? { type: 'Point', coordinates: coordinate },
    imageryGeometry:
      property.imageryGeometry ??
      (imageryCoordinate ? { type: 'Point', coordinates: imageryCoordinate } : null),
  } as PhysicalTapPreviewProperty & {
    id: string;
    countryCode?: string;
    geometry: { type: 'Point'; coordinates: [number, number] };
  });

  return {
    ...normalized,
    countryCode,
    streetName,
  };
}

function normalizePhysicalTapSingleResponse(
  response: PhysicalTapSingleResponse,
): NearbyPropertyGroup | null {
  const coordinate = normalizePhysicalTapCoordinate(response.coordinate);
  if (!coordinate || !response.property?.id) {
    return null;
  }

  const property = normalizePhysicalTapPreviewProperty(response.property, coordinate);
  const hasActiveListing =
    property.hasActiveListing ?? (property.hasListing == null ? null : property.hasListing);
  const socialScoreTotal = toNumber(property.socialScore ?? property.activityScore);
  const recentSocialScoreTotal = toNumber(property.recentSocialScore);
  const socialScoreMax = toNumber(property.activityScore, socialScoreTotal);
  const commentCount = property.commentsDisabled
    ? 0
    : toNumber(
        property.commentCount ??
          ((property.topLevelCommentCount ?? 0) + (property.replyCount ?? 0)),
      );

  return {
    nodeClass: 'active',
    groupKind: 'single',
    primaryPropertyId: property.id,
    pointCount: 1,
    propertyIds: [property.id],
    previewPropertyIds: [property.id],
    pyramidVersionId: null,
    pyramidNodeId: null,
    membershipComplete: true,
    readStateCoverage: 'complete',
    coordinate,
    bbox: null,
    activeListingCount: hasActiveListing ? 1 : 0,
    socialCount: socialScoreTotal > 0 ? 1 : 0,
    recentSocialCount: recentSocialScoreTotal > 0 ? 1 : 0,
    socialScoreTotal,
    socialScoreMax,
    recentSocialScoreTotal,
    commentCount,
    hasListing: hasActiveListing ?? false,
    activityScore: socialScoreMax,
    activityScoreTotal: socialScoreTotal,
    likeCount: toNumber(property.likeCount),
    guessCount: toNumber(property.guessCount),
    streetName: property.streetName ?? null,
    houseNumber:
      typeof property.houseNumber === 'number'
        ? property.houseNumber
        : toNullableNumber(property.houseNumber),
    houseNumberAddition: property.houseNumberAddition ?? null,
    address: property.address ?? '',
    city: property.city ?? '',
    postalCode: property.postalCode ?? null,
    countryCode: property.countryCode ?? property.country ?? null,
    officialValuation: property.officialValuation ?? null,
    officialValuationYear: property.officialValuationYear ?? null,
    officialValuationSourceFetch: property.officialValuationSourceFetch ?? null,
    askingPrice: property.askingPrice ?? null,
    thumbnailUrl: property.thumbnailUrl ?? null,
    yearBuilt: property.yearBuilt ?? null,
    floorAreaM2: property.floorAreaM2 ?? null,
    hasActiveListing,
    marketState: property.marketState ?? null,
    isRead: property.isRead ?? false,
    distanceMeters: 0,
    source: response.source,
    match: response.match,
    previewProperties: [property],
  };
}

function normalizePhysicalTapGroupResponse(
  response: PhysicalTapGroupResponse,
): NearbyPropertyGroup | null {
  const coordinate =
    normalizePhysicalTapCoordinate(response.coordinate) ??
    normalizePhysicalTapCoordinate(response.group.coordinate);
  if (!coordinate) {
    return null;
  }
  const previewFallbackCoordinate =
    normalizePhysicalTapCoordinate(response.group.coordinate) ?? coordinate;

  const previewProperties = (response.group.previewProperties ?? []).map((property) =>
    normalizePhysicalTapPreviewProperty(property, previewFallbackCoordinate),
  );
  const propertyIds = parseTransportPropertyIds(response.group.propertyIds);
  const previewPropertyIds = parseTransportPropertyIds(response.group.previewPropertyIds);
  const primaryPropertyId =
    response.group.primaryPropertyId ??
    previewPropertyIds[0] ??
    propertyIds[0] ??
    previewProperties[0]?.id ??
    null;

  if (!primaryPropertyId) {
    return null;
  }

  const normalizedPreviewIds =
    previewPropertyIds.length > 0
      ? previewPropertyIds
      : previewProperties.map((property) => property.id);
  const normalizedPropertyIds =
    propertyIds.length > 0 ? propertyIds : normalizedPreviewIds;
  const activeListingCount = toNumber(response.group.activeListingCount);
  const socialScoreTotal = toNumber(response.group.socialScoreTotal);
  const socialScoreMax = toNumber(response.group.socialScoreMax, socialScoreTotal);
  const recentSocialScoreTotal = toNumber(response.group.recentSocialScoreTotal);
  const pointCount = toNumber(
    response.group.pointCount,
    Math.max(normalizedPropertyIds.length, normalizedPreviewIds.length, previewProperties.length, 1),
  );

  return {
    nodeClass: 'active',
    groupKind: 'cluster',
    primaryPropertyId,
    pointCount,
    propertyIds: normalizedPropertyIds,
    previewPropertyIds: normalizedPreviewIds,
    pyramidVersionId: null,
    pyramidNodeId: null,
    membershipComplete: normalizedPropertyIds.length >= pointCount,
    readStateCoverage: normalizedPropertyIds.length >= pointCount ? 'complete' : 'partial',
    coordinate,
    bbox: normalizeBbox(response.group.bbox ?? null),
    activeListingCount,
    socialCount: toNumber(response.group.socialCount, socialScoreTotal > 0 ? 1 : 0),
    recentSocialCount: toNumber(
      response.group.recentSocialCount,
      recentSocialScoreTotal > 0 ? 1 : 0,
    ),
    socialScoreTotal,
    socialScoreMax,
    recentSocialScoreTotal,
    commentCount: toNumber(response.group.commentCount),
    hasListing: activeListingCount > 0,
    activityScore: socialScoreMax,
    activityScoreTotal: socialScoreTotal,
    likeCount: 0,
    guessCount: 0,
    streetName: response.group.streetName ?? null,
    houseNumber: response.group.houseNumber ?? null,
    houseNumberAddition: response.group.houseNumberAddition ?? null,
    address: response.group.address ?? previewProperties[0]?.address ?? null,
    city: response.group.city ?? previewProperties[0]?.city ?? null,
    postalCode: response.group.postalCode ?? previewProperties[0]?.postalCode ?? null,
    countryCode:
      response.group.countryCode ??
      previewProperties[0]?.countryCode ??
      previewProperties[0]?.country ??
      null,
    officialValuation: response.group.officialValuation ?? null,
    officialValuationYear:
      response.group.officialValuationYear ??
      previewProperties[0]?.officialValuationYear ??
      null,
    officialValuationSourceFetch:
      response.group.officialValuationSourceFetch ??
      previewProperties[0]?.officialValuationSourceFetch ??
      null,
    askingPrice: response.group.askingPrice ?? null,
    thumbnailUrl: response.group.thumbnailUrl ?? previewProperties[0]?.thumbnailUrl ?? null,
    yearBuilt: response.group.yearBuilt ?? null,
    floorAreaM2: response.group.floorAreaM2 ?? null,
    hasActiveListing: response.group.hasActiveListing ?? (activeListingCount > 0),
    marketState: response.group.marketState ?? null,
    isRead: response.group.isRead ?? false,
    distanceMeters: 0,
    source: response.source,
    match: response.match,
    previewProperties,
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
  const membershipComplete = toBoolean(
    getTransportValue(properties, 'membershipComplete', 'membership_complete'),
    true,
  );
  const readStateCoverage = toReadStateCoverage(
    getTransportValue(properties, 'readStateCoverage', 'read_state_coverage'),
    membershipComplete ? 'complete' : 'partial',
  );
  const normalizedPropertyIds =
    propertyIds.length > 0
      ? propertyIds
      : groupKind === 'single'
        ? [primaryPropertyId]
        : [];
  const normalizedPreviewPropertyIds =
    previewPropertyIds.length > 0 || !membershipComplete || readStateCoverage === 'partial'
      ? previewPropertyIds
      : normalizedPropertyIds;

  return {
    nodeClass,
    groupKind,
    primaryPropertyId,
    pointCount: toNumber(properties.point_count, 1),
    propertyIds: normalizedPropertyIds,
    previewPropertyIds: normalizedPreviewPropertyIds,
    pyramidVersionId: toNullableString(
      getTransportValue(properties, 'pyramidVersionId', 'pyramid_version_id'),
    ),
    pyramidNodeId: toNullableString(
      getTransportValue(properties, 'pyramidNodeId', 'pyramid_node_id'),
    ),
    membershipComplete,
    readStateCoverage,
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
    officialValuationYear: toNullableNumber(
      getTransportValue(properties, 'officialValuationYear', 'official_valuation_year'),
    ),
    officialValuationSourceFetch: parseOfficialValuationSourceFetch(properties),
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
  options: NearbyGroupLookupOptions = {},
): Promise<NearbyPropertyGroup | null> {
  try {
    const path = buildNearbyGroupPath(lon, lat, zoom, filters, options);
    const { data: result, response } = await apiFetchWithResponse<NearbyGroupedResult | null>(path);
    const nearbyStatus = response.headers?.get?.('x-huishype-nearby-status') as
      | NearbyStatusHeader
      | null
      | undefined;
    if (
      !result &&
      nearbyStatus === 'pyramid-stale' &&
      options.pyramidVersionId &&
      options.pyramidNodeId
    ) {
      const { data: retryResult } = await apiFetchWithResponse<NearbyGroupedResult | null>(
        buildNearbyGroupPath(lon, lat, zoom, filters),
      );
      return retryResult ? normalizeNearbyPropertyGroup(retryResult) : null;
    }
    return result ? normalizeNearbyPropertyGroup(result) : null;
  } catch (err) {
    console.warn('[HuisHype] fetchNearbyGroup failed:', err);
    return null;
  }
}

export async function fetchPhysicalTapResolve(
  lon: number,
  lat: number,
  zoom: number,
): Promise<NearbyPropertyGroup | null> {
  try {
    const params = new URLSearchParams({
      lon: String(lon),
      lat: String(lat),
      zoom: String(zoom),
    });
    const result = await apiFetch<PhysicalTapResolveResponse>(
      `/properties/resolve-tap?${params.toString()}`,
    );

    if (!result) {
      return null;
    }

    return result.kind === 'single'
      ? normalizePhysicalTapSingleResponse(result)
      : normalizePhysicalTapGroupResponse(result);
  } catch (err) {
    console.warn('[HuisHype] fetchPhysicalTapResolve failed:', err);
    return null;
  }
}

export async function fetchHouseNumberTapResolve(
  lon: number,
  lat: number,
  zoom: number,
  houseNumber: string,
): Promise<NearbyPropertyGroup | null> {
  try {
    const params = new URLSearchParams({
      lon: String(lon),
      lat: String(lat),
      zoom: String(zoom),
      houseNumber,
    });
    const result = await apiFetch<PhysicalTapResolveResponse>(
      `/properties/resolve-house-number-tap?${params.toString()}`,
    );

    if (!result) {
      return null;
    }

    return result.kind === 'single'
      ? normalizePhysicalTapSingleResponse(result)
      : normalizePhysicalTapGroupResponse(result);
  } catch (err) {
    console.warn('[HuisHype] fetchHouseNumberTapResolve failed:', err);
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
  officialValuationYear?: number | null;
  officialValuationSourceFetch?: OfficialValuationSourceFetch | null;
  commentsDisabled?: boolean | null;
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
