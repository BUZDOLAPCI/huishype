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
  officialValuationSourceFetch?: OfficialValuationSourceFetch | null;
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
  coordinate: [number, number];
  distanceMeters: number;
  bbox: [number, number, number, number] | null;
  activeListingCount: number;
  completedListingCount?: number | null;
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
  completedListingCount: number;
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

export interface OfficialValuationSourceFetchInput {
  propertyId: string;
  countryCode: string;
  nationalId: string | null;
  address: string;
  city: string;
  postalCode: string | null;
  street?: string | null;
  houseNumber?: number | null;
  houseNumberAddition?: string | null;
}

export interface OfficialValuationSourceResult {
  source: 'woz';
  valuation: number;
  valuationYear: number;
  referenceDate?: string;
  sourceRecordId?: string;
  sourceUrl?: string;
  rawPayload?: unknown;
}

export interface OfficialValuationHydrateResponse {
  propertyId: string;
  source: 'woz';
  status: 'accepted' | 'queued' | 'already_cached' | 'unsupported';
  officialValuation: number | null;
  officialValuationYear: number | null;
}

type OfficialValuationSourceFetcher = (
  input: OfficialValuationSourceFetchInput,
) => Promise<OfficialValuationSourceResult | null>;

let officialValuationSourceFetcher: OfficialValuationSourceFetcher = fetchWozOfficialValuation;
let wozSourceRateLimitedUntil = 0;

const WOZ_API_BASE_URL = 'https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1';
const DEFAULT_WOZ_RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1_000;

function normalizeBagNumberDesignationId(value: string | null): string | null {
  const digits = value?.trim();
  if (!digits || !/^\d{1,16}$/.test(digits)) {
    return null;
  }
  return digits.padStart(16, '0');
}

function normalizeOfficialValuationText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '')
    .toUpperCase();
}

function yearFromDate(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const year = Number(value.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

function collectPayloadObjects(value: unknown, output: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPayloadObjects(item, output);
    }
    return output;
  }

  if (value && typeof value === 'object') {
    output.push(value as Record<string, unknown>);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectPayloadObjects(nested, output);
    }
  }

  return output;
}

function getPayloadStringField(object: Record<string, unknown>, names: readonly string[]): string | null {
  for (const name of names) {
    const value = object[name];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function extractSuggestedWozIdentifier(payload: Record<string, unknown>): {
  kind: 'nummeraanduiding' | 'wozobjectnummer';
  id: string;
} | null {
  for (const object of collectPayloadObjects(payload)) {
    const nummeraanduidingId = getPayloadStringField(object, [
      'nummeraanduidingid',
      'nummeraanduidingId',
      'aotid',
    ]);
    const normalizedNummeraanduidingId = normalizeBagNumberDesignationId(nummeraanduidingId);
    if (normalizedNummeraanduidingId) {
      return { kind: 'nummeraanduiding', id: normalizedNummeraanduidingId };
    }

    const wozObjectnummer = getPayloadStringField(object, [
      'wozobjectnummer',
      'wozObjectnummer',
      'wozObjectNummer',
    ]);
    if (wozObjectnummer) {
      return { kind: 'wozobjectnummer', id: wozObjectnummer };
    }
  }

  return null;
}

function parseAddressLine(address: string): {
  street: string | null;
  houseNumber: number | null;
  houseNumberAddition: string | null;
} {
  const firstLine = address.split(',')[0]?.trim() ?? '';
  const match = firstLine.match(/^(.+?)\s+(\d+)\s*([A-Za-z0-9-]+)?$/);
  if (!match) {
    return { street: null, houseNumber: null, houseNumberAddition: null };
  }

  return {
    street: match[1]?.trim() || null,
    houseNumber: Number.parseInt(match[2] ?? '', 10),
    houseNumberAddition: match[3]?.trim() || null,
  };
}

function getWozAddressParts(input: OfficialValuationSourceFetchInput): {
  street: string | null;
  houseNumber: number | null;
  houseNumberAddition: string | null;
} {
  const parsedAddress = parseAddressLine(input.address);
  return {
    street: input.street ?? parsedAddress.street,
    houseNumber: input.houseNumber ?? parsedAddress.houseNumber,
    houseNumberAddition: input.houseNumberAddition ?? parsedAddress.houseNumberAddition,
  };
}

function payloadMatchesWozInput(
  payload: Record<string, unknown>,
  input: OfficialValuationSourceFetchInput,
): boolean {
  const addressParts = getWozAddressParts(input);
  const propertyPostcode = normalizeOfficialValuationText(input.postalCode);
  const propertyHouseNumber = addressParts.houseNumber;
  const propertyAddition = normalizeOfficialValuationText(addressParts.houseNumberAddition);
  const propertyStreet = normalizeOfficialValuationText(addressParts.street);
  const propertyCity = normalizeOfficialValuationText(input.city);

  if (!propertyPostcode || !propertyHouseNumber) {
    return true;
  }

  let sawAddressIdentity = false;
  for (const object of collectPayloadObjects(payload)) {
    const postcode = getPayloadStringField(object, ['postcode', 'postCode', 'postalCode']);
    const houseNumber = getPayloadStringField(object, ['huisnummer', 'houseNumber']);
    if (!postcode || !houseNumber) {
      continue;
    }

    sawAddressIdentity = true;
    const addition = getPayloadStringField(object, [
      'huisletter',
      'huisnummertoevoeging',
      'toevoeging',
      'houseNumberAddition',
    ]);
    const street = getPayloadStringField(object, [
      'straat',
      'straatnaam',
      'street',
      'openbareRuimteNaam',
      'openbareruimtenaam',
    ]);
    const city = getPayloadStringField(object, [
      'woonplaats',
      'woonplaatsnaam',
      'plaats',
      'plaatsnaam',
      'city',
    ]);
    const payloadStreet = normalizeOfficialValuationText(street);
    const payloadCity = normalizeOfficialValuationText(city);

    if (
      normalizeOfficialValuationText(postcode) === propertyPostcode &&
      Number.parseInt(houseNumber, 10) === propertyHouseNumber &&
      normalizeOfficialValuationText(addition) === propertyAddition &&
      (!payloadStreet || !propertyStreet || payloadStreet === propertyStreet) &&
      (!payloadCity || !propertyCity || payloadCity === propertyCity)
    ) {
      return true;
    }
  }

  return !sawAddressIdentity;
}

function parseWozRetryUntil(response: Response): number {
  const retryAfter = response.headers?.get?.('retry-after');
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds)) {
      return Date.now() + seconds * 1_000;
    }

    const timestamp = Date.parse(retryAfter);
    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  }

  const reset =
    response.headers?.get?.('x-rate-limit-reset') ??
    response.headers?.get?.('Kadaster-RateLimit-DayLimit-Reset');
  if (reset) {
    const resetNumber = Number.parseInt(reset, 10);
    if (Number.isFinite(resetNumber)) {
      return resetNumber > 10_000_000_000 ? resetNumber : resetNumber * 1_000;
    }

    const resetDate = Date.parse(reset);
    if (Number.isFinite(resetDate)) {
      return resetDate;
    }
  }

  return Date.now() + DEFAULT_WOZ_RATE_LIMIT_BACKOFF_MS;
}

async function fetchWozJson(path: string): Promise<
  | { status: 'ok'; payload: Record<string, unknown> }
  | { status: 'not_found' | 'rate_limited' | 'error' }
> {
  const response = await fetch(`${WOZ_API_BASE_URL}${path}`, {
    headers: {
      Accept: 'application/json',
    },
  }).catch(() => null);

  if (!response) {
    return { status: 'error' };
  }

  if (response.status === 429) {
    wozSourceRateLimitedUntil = Math.max(wozSourceRateLimitedUntil, parseWozRetryUntil(response));
    return { status: 'rate_limited' };
  }

  if (response.status === 404) {
    return { status: 'not_found' };
  }

  if (!response.ok) {
    return { status: 'error' };
  }

  const payload = await response.json().catch(() => null);
  return payload && typeof payload === 'object'
    ? { status: 'ok', payload: payload as Record<string, unknown> }
    : { status: 'error' };
}

function extractWozValuationResult(
  payload: Record<string, unknown>,
  sourceUrl: string,
): OfficialValuationSourceResult | null {
  const latest = (
    (payload?.wozWaarden as Array<{ peildatum?: string; vastgesteldeWaarde?: number }> | undefined)
      ?.filter((row) => typeof row.vastgesteldeWaarde === 'number')
      .sort((left, right) =>
        String(right.peildatum ?? '').localeCompare(String(left.peildatum ?? '')),
      ) ?? []
  )[0];
  const valuationYear = yearFromDate(latest?.peildatum);

  const valuation = latest?.vastgesteldeWaarde;
  if (typeof valuation !== 'number' || valuationYear === null) {
    return null;
  }

  const sourceRecordId = getPayloadStringField(
    (payload.wozObject && typeof payload.wozObject === 'object'
      ? payload.wozObject
      : payload) as Record<string, unknown>,
    ['wozobjectnummer', 'wozObjectnummer', 'wozObjectNummer'],
  );

  return {
    source: 'woz',
    valuation,
    valuationYear,
    referenceDate: latest.peildatum,
    sourceRecordId: sourceRecordId ?? undefined,
    sourceUrl,
    rawPayload: payload,
  };
}

async function fetchWozValuationPath(
  input: OfficialValuationSourceFetchInput,
  sourcePath: string,
): Promise<OfficialValuationSourceResult | null> {
  const sourceUrl = `${WOZ_API_BASE_URL}${sourcePath}`;
  const valueResponse = await fetchWozJson(sourcePath);
  if (valueResponse.status !== 'ok') {
    return null;
  }

  if (!payloadMatchesWozInput(valueResponse.payload, input)) {
    return null;
  }

  return extractWozValuationResult(valueResponse.payload, sourceUrl);
}

function buildWozSuggestQuery(input: OfficialValuationSourceFetchInput): string | null {
  const addressParts = getWozAddressParts(input);
  const houseNumberPart = addressParts.houseNumber
    ? `${addressParts.houseNumber}${addressParts.houseNumberAddition ?? ''}`
    : null;

  const query = input.postalCode && houseNumberPart
    ? `${input.postalCode} ${houseNumberPart}`
    : [addressParts.street, houseNumberPart, input.postalCode, input.city]
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .join(' ');

  return query.trim() || null;
}

async function fetchWozValuationBySuggest(
  input: OfficialValuationSourceFetchInput,
): Promise<OfficialValuationSourceResult | null> {
  const query = buildWozSuggestQuery(input);
  if (!query) {
    return null;
  }

  const suggestionResponse = await fetchWozJson(`/suggest?q=${encodeURIComponent(query)}`);
  if (suggestionResponse.status !== 'ok') {
    return null;
  }

  const suggested = extractSuggestedWozIdentifier(suggestionResponse.payload);
  if (!suggested) {
    return null;
  }

  return fetchWozValuationPath(input, buildWozValuationPath(suggested));
}

function buildWozValuationPath(identifier: {
  kind: 'nummeraanduiding' | 'wozobjectnummer';
  id: string;
}): string {
  return identifier.kind === 'nummeraanduiding'
    ? `/wozwaarde/nummeraanduiding/${identifier.id}`
    : `/wozwaarde/wozobjectnummer/${encodeURIComponent(identifier.id)}`;
}

async function fetchWozValuationByValidatedNummeraanduiding(
  input: OfficialValuationSourceFetchInput,
  nummeraanduidingId: string,
): Promise<OfficialValuationSourceResult | null> {
  const suggestionResponse = await fetchWozJson(
    `/suggest?aotids=${encodeURIComponent(nummeraanduidingId)}`,
  );
  if (suggestionResponse.status !== 'ok') {
    return null;
  }

  const suggested = extractSuggestedWozIdentifier(suggestionResponse.payload);
  if (!suggested) {
    return null;
  }

  return fetchWozValuationPath(input, buildWozValuationPath(suggested));
}

async function fetchWozOfficialValuation(
  input: OfficialValuationSourceFetchInput,
): Promise<OfficialValuationSourceResult | null> {
  if (input.countryCode !== 'NL') {
    return null;
  }

  if (Date.now() < wozSourceRateLimitedUntil) {
    return null;
  }

  const nummeraanduidingId = normalizeBagNumberDesignationId(input.nationalId);
  if (nummeraanduidingId) {
    const result = await fetchWozValuationByValidatedNummeraanduiding(input, nummeraanduidingId);
    if (result || Date.now() < wozSourceRateLimitedUntil) {
      return result;
    }
  }

  return fetchWozValuationBySuggest(input);
}

export function setOfficialValuationSourceFetcher(
  fetcher: OfficialValuationSourceFetcher | null,
): void {
  wozSourceRateLimitedUntil = 0;
  officialValuationSourceFetcher = fetcher ?? fetchWozOfficialValuation;
}

export async function fetchOfficialValuationFromSource(
  input: OfficialValuationSourceFetchInput,
): Promise<OfficialValuationSourceResult | null> {
  if (input.countryCode !== 'NL') {
    return null;
  }

  return officialValuationSourceFetcher(input);
}

export async function submitOfficialValuationHydration(
  propertyId: string,
  result: OfficialValuationSourceResult | null,
  accessToken?: string | null,
): Promise<OfficialValuationHydrateResponse> {
  return api.post<OfficialValuationHydrateResponse>(
    `/properties/${propertyId}/official-valuations/hydrate`,
    result
      ? {
          source: result.source,
          valuation: result.valuation,
          valuationYear: result.valuationYear,
          referenceDate: result.referenceDate,
          sourceRecordId: result.sourceRecordId,
          sourceUrl: result.sourceUrl,
          rawPayload: result.rawPayload,
        }
      : {
          source: 'woz',
        },
    accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
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
  const completedListingCount = toNumber(result.completedListingCount);
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
    completedListingCount,
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
  const completedListingCount = toNumber(
    getTransportValue(properties, 'completedListingCount', 'completed_listing_count'),
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
    completedListingCount,
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
  officialValuationYear?: number | null;
  officialValuationSourceFetch?: OfficialValuationSourceFetch | null;
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
