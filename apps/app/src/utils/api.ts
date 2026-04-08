import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type {
  PropertyGroupBounds,
  PropertyNodeGroup,
  PropertyResolveResponse,
} from '@huishype/shared';
import { withDerivedPropertyImageData } from './property-image';

const DEFAULT_API_PORT = '3100';

// Extract the port from a URL string, or return undefined if none is present.
const extractPort = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);
    return parsed.port || undefined;
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

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'An error occurred' }));
    throw new Error(error.message || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

// --- Property resolve (imperative, not a hook) ---

export type PropertyResolveResult = PropertyResolveResponse & {
  countryCode?: string | null;
};

export interface PropertyResolveRequest {
  postalCode: string;
  houseNumber: string | number;
  houseNumberAddition?: string | null;
  countryCode?: string | null;
  street?: string | null;
  city?: string | null;
}

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
  request: PropertyResolveRequest,
): Promise<PropertyResolveResult | null> {
  try {
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

    const result = await apiFetch<PropertyResolveResult>(
      `/properties/resolve?${params.toString()}`,
    );
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
    if (err instanceof Error && err.message.includes('404')) {
      return null;
    }
    console.warn('[HuisHype] resolveProperty failed:', err);
    return null;
  }
}

// --- Cluster-aware nearby lookup (imperative, not a hook) ---

/** Density-aware grouped result from GET /properties/nearby */
export interface NearbyGroupedResult {
  node_class: 'active' | 'ghost';
  group_kind: 'single' | 'cluster';
  primary_property_id: string;
  point_count: number;
  property_ids: string[];
  preview_property_ids: string[];
  coordinate: [number, number];
  distanceMeters: number;
  bbox: [number, number, number, number] | null;
  activityScore: number;
  activityScoreTotal: number;
  likeCount: number;
  commentCount: number;
  guessCount: number;
  hasListing: boolean;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  countryCode: string | null;
  officialValuation: number | null;
  askingPrice: number | null;
  thumbnailUrl: string | null;
  yearBuilt?: number | null;
  floorAreaM2?: number | null;
}

export type NearbyPropertyGroup = PropertyNodeGroup & {
  distanceMeters: number;
};

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
  return {
    nodeClass: result.node_class,
    groupKind: result.group_kind,
    primaryPropertyId: result.primary_property_id,
    pointCount: result.point_count,
    propertyIds: result.property_ids,
    previewPropertyIds: result.preview_property_ids,
    coordinate: result.coordinate,
    bbox: normalizeBbox(result.bbox),
    hasListing: result.hasListing,
    activityScore: result.activityScore,
    activityScoreTotal: result.activityScoreTotal,
    likeCount: result.likeCount,
    commentCount: result.commentCount,
    guessCount: result.guessCount,
    address: result.address,
    city: result.city,
    postalCode: result.postalCode,
    countryCode: result.countryCode,
    officialValuation: result.officialValuation,
    askingPrice: result.askingPrice,
    thumbnailUrl: result.thumbnailUrl,
    yearBuilt: result.yearBuilt ?? null,
    floorAreaM2: result.floorAreaM2 ?? null,
    distanceMeters: result.distanceMeters,
  };
}

export function normalizeRenderedPropertyGroup(
  feature: GeoJSON.Feature,
): PropertyNodeGroup | null {
  const properties = feature.properties;
  const geometry = feature.geometry;

  if (!properties || geometry?.type !== 'Point') {
    return null;
  }

  const nodeClass = toNullableString(properties.node_class);
  const groupKind = toNullableString(properties.group_kind);
  const propertyIds = parseTransportPropertyIds(
    (properties.property_ids as string | string[] | undefined) ?? null,
  );
  const previewPropertyIds = parseTransportPropertyIds(
    (properties.preview_property_ids as string | string[] | undefined) ?? null,
  );
  const primaryPropertyId =
    toNullableString(properties.primary_property_id) ??
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

  return {
    nodeClass,
    groupKind,
    primaryPropertyId,
    pointCount: toNumber(properties.point_count, 1),
    propertyIds,
    previewPropertyIds: previewPropertyIds.length > 0 ? previewPropertyIds : propertyIds,
    coordinate: geometry.coordinates as [number, number],
    bbox:
      toNullableNumber(properties.bbox_west) != null &&
      toNullableNumber(properties.bbox_south) != null &&
      toNullableNumber(properties.bbox_east) != null &&
      toNullableNumber(properties.bbox_north) != null
        ? {
            west: toNumber(properties.bbox_west),
            south: toNumber(properties.bbox_south),
            east: toNumber(properties.bbox_east),
            north: toNumber(properties.bbox_north),
          }
        : null,
    hasListing: Boolean(properties.hasListing),
    activityScore: toNumber(properties.activityScore),
    activityScoreTotal: toNumber(properties.activityScoreTotal, toNumber(properties.activityScore)),
    likeCount: toNumber(properties.likeCount),
    commentCount: toNumber(properties.commentCount),
    guessCount: toNumber(properties.guessCount),
    address: toNullableString(properties.address),
    city: toNullableString(properties.city),
    postalCode: toNullableString(properties.postalCode),
    countryCode: toNullableString(properties.countryCode),
    officialValuation: toNullableNumber(properties.officialValuation),
    askingPrice: toNullableNumber(properties.askingPrice),
    thumbnailUrl: toNullableString(properties.thumbnailUrl),
    yearBuilt: toNullableNumber(properties.yearBuilt),
    floorAreaM2: toNullableNumber(properties.floorAreaM2),
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
): Promise<NearbyPropertyGroup | null> {
  try {
    const result = await apiFetch<NearbyGroupedResult | null>(
      `/properties/nearby?lon=${lon}&lat=${lat}&zoom=${zoom}`,
    );
    return result ? normalizeNearbyPropertyGroup(result) : null;
  } catch (err) {
    console.warn('[HuisHype] fetchNearbyGroup failed:', err);
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
  askingPrice: number | null;
  likeCount: number;
  commentCount: number;
  guessCount: number;
  activityScore?: number;
  aerialImageUrl?: string | null;
  thumbnailUrl?: string | null;
  createdAt: string;
  updatedAt: string;
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
  return result.map((property) => withDerivedPropertyImageData(property));
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
