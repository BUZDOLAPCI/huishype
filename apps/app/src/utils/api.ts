import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { PropertyResolveResponse } from '@huishype/shared';

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

// --- Nearby property lookup (imperative, not a hook) ---

export interface NearbyProperty {
  id: string;
  address: string;
  city: string;
  postalCode: string | null;
  officialValuation: number | null;
  hasListing: boolean;
  activityScore: number;
  distanceMeters: number;
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
}

/** Maximum distance (meters) to consider a nearby result as a valid tap target. */
const NEARBY_MAX_DISTANCE_M = 50;

/**
 * Fetch the closest property to a given coordinate.
 * Returns null if nothing is found within the distance threshold.
 *
 * This is an imperative async function (NOT a hook) — call it from tap
 * handlers only. It exists as a fallback for native Android where
 * queryRenderedFeatures doesn't reliably find custom vector tile features.
 */
export async function fetchNearbyProperty(
  lon: number,
  lat: number,
  zoom: number,
): Promise<NearbyProperty | null> {
  try {
    const results = await apiFetch<NearbyProperty[]>(
      `/properties/nearby?lon=${lon}&lat=${lat}&zoom=${zoom}&limit=1`,
    );

    if (!results || results.length === 0) return null;

    const closest = results[0];
    if (closest.distanceMeters > NEARBY_MAX_DISTANCE_M) return null;

    return closest;
  } catch (err) {
    console.warn('[HuisHype] fetchNearbyProperty failed:', err);
    return null;
  }
}

// --- Property resolve (imperative, not a hook) ---

export type PropertyResolveResult = PropertyResolveResponse;

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

/** Cluster detection result from GET /properties/nearby?cluster=true */
export type NearbyClusterResult =
  | {
      type: 'cluster';
      point_count: number;
      property_ids: string;
      coordinate: [number, number];
      distanceMeters: number;
      bbox: [number, number, number, number]; // [west, south, east, north]
    }
  | {
      type: 'single';
      id: string;
      address: string;
      city: string;
      postalCode: string | null;
      officialValuation: number | null;
      hasListing: boolean;
      askingPrice: number | null;
      activityScore: number;
      likeCount: number;
      commentCount: number;
      guessCount: number;
      distanceMeters: number;
      geometry: { type: 'Point'; coordinates: [number, number] } | null;
    };

/**
 * Fetch cluster-aware nearby result for a tap coordinate.
 * Returns a discriminated union: either a cluster (multiple properties in
 * the same grid cell) or a single property, or null if nothing is nearby.
 */
export async function fetchNearbyCluster(
  lon: number,
  lat: number,
  zoom: number,
): Promise<NearbyClusterResult | null> {
  try {
    const result = await apiFetch<NearbyClusterResult | null>(
      `/properties/nearby?lon=${lon}&lat=${lat}&zoom=${zoom}&cluster=true`,
    );
    return result;
  } catch (err) {
    console.warn('[HuisHype] fetchNearbyCluster failed:', err);
    return null;
  }
}

// --- Batch property lookup (imperative, not a hook) ---

/** Shape returned by GET /properties/batch */
export interface BatchProperty {
  id: string;
  nationalId: string | null;
  address: string;
  city: string;
  postalCode: string | null;
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
  yearBuilt: number | null;
  floorAreaM2: number | null;
  status: string;
  officialValuation: number | null;
  hasListing: boolean;
  askingPrice: number | null;
  likeCount: number;
  commentCount: number;
  guessCount: number;
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
  return result;
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
