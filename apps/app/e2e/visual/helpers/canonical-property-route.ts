import { type APIRequestContext, type Page } from '@playwright/test';
import {
  buildPropertyMapRoute,
  buildPropertyRoute,
  type PropertyRouteAddressLike,
} from '@/src/utils/property-route';
import { getPlaywrightApiUrl } from '../../helpers/runtime';

const API_BASE_URL = getPlaywrightApiUrl();
const REQUEST_TIMEOUT_MS = 30_000;

export interface CanonicalPropertyFixture extends PropertyRouteAddressLike {
  id: string;
  address?: string | null;
  geometry?: { type: 'Point'; coordinates: [number, number] } | null;
  hasListing?: boolean | null;
  hasActiveListing?: boolean | null;
  marketState?: string | null;
  commentCount?: number | null;
  guessCount?: number | null;
  officialValuation?: number | null;
  askingPrice?: number | null;
}

export interface CanonicalPropertySelection {
  property: CanonicalPropertyFixture;
  route: string;
  previewRoute: string;
}

export interface CanonicalPropertyResolveInput extends PropertyRouteAddressLike {
  city: string;
  postalCode: string;
  houseNumber: string | number;
  id?: string;
  geometry?: { type: 'Point'; coordinates: [number, number] } | null;
}

export interface CanonicalPropertyRouteMockOptions {
  transformPropertyDetail?: (detail: unknown, property: CanonicalPropertyFixture) => unknown;
}

interface CanonicalPropertyResolvePayload {
  id?: string;
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
  coordinates?: {
    lon?: number | null;
    lat?: number | null;
  } | null;
  hasListing?: boolean | null;
  hasActiveListing?: boolean | null;
  officialValuation?: number | null;
}

const SYNTHETIC_CANONICAL_FIXTURE_ID = '00000000-0000-4000-8000-000000000041';

export async function fetchCanonicalPropertyFixture(
  request: APIRequestContext,
  query: string,
  pick?: (properties: CanonicalPropertyFixture[]) => CanonicalPropertyFixture | null | undefined,
): Promise<CanonicalPropertySelection | null> {
  const response = await request.get(`${API_BASE_URL}/properties?${query}`, {
    timeout: REQUEST_TIMEOUT_MS,
  });
  if (!response.ok()) {
    throw new Error(`Failed to fetch properties for canonical route selection: ${response.status()}`);
  }

  const payload = await response.json();
  const properties = Array.isArray(payload?.data)
    ? (payload.data as CanonicalPropertyFixture[])
    : [];

  if (properties.length === 0) {
    return null;
  }

  const property = pick?.(properties) ?? properties[0];
  if (!property) {
    return null;
  }

  return {
    property,
    route: buildPropertyRoute(property),
    previewRoute: buildPropertyMapRoute(property),
  };
}

export async function resolveCanonicalPropertyFixture(
  request: APIRequestContext,
  property: CanonicalPropertyResolveInput,
): Promise<CanonicalPropertySelection | null> {
  const params = new URLSearchParams({
    postalCode: property.postalCode,
    houseNumber: String(property.houseNumber),
    countryCode: property.countryCode ?? 'NL',
  });

  const street = (property.streetName ?? property.street)?.trim();
  if (street) {
    params.set('street', street);
  }

  const city = property.city?.trim();
  if (city) {
    params.set('city', city);
  }

  const houseNumberAddition = property.houseNumberAddition?.trim();
  if (houseNumberAddition) {
    params.set('houseNumberAddition', houseNumberAddition);
  }

  const response = await request.get(`${API_BASE_URL}/properties/resolve?${params.toString()}`, {
    timeout: REQUEST_TIMEOUT_MS,
  });
  if (!response.ok()) {
    throw new Error(
      `Failed to resolve canonical property fixture: ${response.status()} for ${params.toString()}`,
    );
  }

  const payload = (await response.json()) as CanonicalPropertyResolvePayload | null;
  if (!payload?.id) {
    await assertResolveDidNotMissExistingProperty(request, property);
    const fallbackAddress = buildResolvedAddress({
      ...property,
      id: property.id ?? SYNTHETIC_CANONICAL_FIXTURE_ID,
      address: null,
      geometry: property.geometry ?? null,
    });

    const fallbackProperty: CanonicalPropertyFixture = {
      ...property,
      id: property.id ?? SYNTHETIC_CANONICAL_FIXTURE_ID,
      address: fallbackAddress,
      countryCode: property.countryCode ?? 'NL',
      geometry: property.geometry ?? null,
      hasListing: null,
      officialValuation: null,
    };

    return {
      property: fallbackProperty,
      route: buildPropertyRoute(fallbackProperty),
      previewRoute: buildPropertyMapRoute(fallbackProperty),
    };
  }

  const lon = payload.coordinates?.lon;
  const lat = payload.coordinates?.lat;
  const geometry =
    typeof lon === 'number' && typeof lat === 'number'
      ? {
          type: 'Point' as const,
          coordinates: [lon, lat] as [number, number],
        }
      : null;

  const resolvedProperty: CanonicalPropertyFixture = {
    ...property,
    id: payload.id,
    address: payload.address ?? property.address ?? null,
    city: payload.city ?? property.city,
    postalCode: payload.postalCode ?? property.postalCode,
    countryCode: payload.countryCode ?? property.countryCode ?? 'NL',
    geometry,
    hasListing: payload.hasListing ?? payload.hasActiveListing ?? null,
    officialValuation: payload.officialValuation ?? null,
  };

  return {
    property: resolvedProperty,
    route: buildPropertyRoute(resolvedProperty),
    previewRoute: buildPropertyMapRoute(resolvedProperty),
  };
}

async function assertResolveDidNotMissExistingProperty(
  request: APIRequestContext,
  property: CanonicalPropertyResolveInput,
): Promise<void> {
  const coordinates = property.geometry?.coordinates;
  if (!coordinates) {
    return;
  }

  const [lon, lat] = coordinates;
  const delta = 0.003;
  const bbox = [lon - delta, lat - delta, lon + delta, lat + delta].join(',');
  const response = await request.get(
    `${API_BASE_URL}/properties?limit=100&bbox=${encodeURIComponent(bbox)}`,
    { timeout: REQUEST_TIMEOUT_MS },
  );
  if (!response.ok()) {
    return;
  }

  const payload = await response.json();
  const properties = Array.isArray(payload?.data)
    ? (payload.data as CanonicalPropertyFixture[])
    : [];
  const expectedStreet = normalizeRoutePart(property.streetName ?? property.street);
  const expectedCity = normalizeRoutePart(property.city);
  const expectedPostalCode = property.postalCode.replace(/\s/g, '').toUpperCase();
  const expectedHouseNumber = String(property.houseNumber).trim();
  const expectedAddition = normalizeAddition(property.houseNumberAddition);

  const exactMatch = properties.find((candidate) => {
    return (
      normalizeRoutePart(candidate.streetName ?? candidate.street) === expectedStreet &&
      normalizeRoutePart(candidate.city) === expectedCity &&
      String(candidate.postalCode ?? '').replace(/\s/g, '').toUpperCase() === expectedPostalCode &&
      String(candidate.houseNumber ?? '').trim() === expectedHouseNumber &&
      normalizeAddition(candidate.houseNumberAddition) === expectedAddition
    );
  });

  if (exactMatch) {
    const resolvedAddress = buildResolvedAddress({
      ...property,
      id: property.id ?? SYNTHETIC_CANONICAL_FIXTURE_ID,
      address: null,
      geometry: property.geometry ?? null,
    });
    throw new Error(
      `GET /properties/resolve returned null for ${resolvedAddress}, but /properties returned ` +
        `exact property ${exactMatch.id}. Keep this as a product-route regression.`,
    );
  }
}

function normalizeRoutePart(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeAddition(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

function buildResolvedAddress(property: CanonicalPropertyFixture): string {
  if (property.address) {
    return property.address;
  }

  const street = property.streetName?.trim() || property.street?.trim() || '';
  const houseNumber = property.houseNumber != null ? String(property.houseNumber).trim() : '';
  const addition = property.houseNumberAddition?.trim() || '';
  const postalCode = property.postalCode?.trim() || '';
  const city = property.city?.trim() || '';
  const houseLine = [street, `${houseNumber}${addition}`.trim()].filter(Boolean).join(' ');
  const cityLine = [postalCode, city].filter(Boolean).join(' ');

  return [houseLine, cityLine].filter(Boolean).join(', ');
}

async function fetchJsonOrFallback<T>(
  request: APIRequestContext,
  path: string,
  fallback: T,
): Promise<T> {
  try {
    const response = await request.get(`${API_BASE_URL}${path}`, {
      timeout: REQUEST_TIMEOUT_MS,
    });
    if (!response.ok()) {
      return fallback;
    }

    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

export async function setupCanonicalPropertyRouteMocks(
  page: Page,
  request: APIRequestContext,
  selection: CanonicalPropertySelection,
  options: CanonicalPropertyRouteMockOptions = {},
): Promise<void> {
  const { property } = selection;
  const resolvePayload = {
    id: property.id,
    address: buildResolvedAddress(property),
    postalCode: property.postalCode ?? '',
    city: property.city ?? '',
    coordinates: {
      lon: property.geometry?.coordinates?.[0] ?? 0,
      lat: property.geometry?.coordinates?.[1] ?? 0,
    },
    hasListing: Boolean((property as { hasListing?: boolean }).hasListing),
    officialValuation: property.officialValuation ?? null,
    countryCode: property.countryCode ?? 'NL',
  };

  const [basePropertyDetail, comments, guesses, listings] = await Promise.all([
    fetchJsonOrFallback(request, `/properties/${property.id}`, property),
    fetchJsonOrFallback(request, `/properties/${property.id}/comments?limit=20`, {
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 1 },
    }),
    fetchJsonOrFallback(request, `/properties/${property.id}/guesses?limit=100`, {
      data: [],
      meta: { page: 1, limit: 100, total: 0, totalPages: 1 },
      fmv: {
        fmv: null,
        confidence: 'none',
        guessCount: 0,
        distribution: null,
        officialValuation: null,
        askingPrice: null,
        divergence: null,
      },
      activeListingAskingPrice:
        property.hasActiveListing === true && property.marketState === 'for-sale'
          ? property.askingPrice ?? null
          : null,
      ...(property.hasActiveListing === true && property.marketState === 'for-sale'
        ? {}
        : property.officialValuation != null
          ? {
              priceGuessStart: {
                price: property.officialValuation,
                source: 'official_valuation',
                confidence: 'weak',
                sampleSize: property.guessCount ?? 0,
              },
            }
          : {}),
    }),
    fetchJsonOrFallback(request, `/properties/${property.id}/listings`, { data: [] }),
  ]);
  const propertyDetail =
    options.transformPropertyDetail?.(basePropertyDetail, property) ?? basePropertyDetail;

  await page.route('**/properties/resolve**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resolvePayload),
    });
  });

  await page.route(`**/properties/${property.id}`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(propertyDetail),
    });
  });

  await page.route(`**/properties/${property.id}/comments**`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(comments),
    });
  });

  await page.route(`**/properties/${property.id}/guesses**`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(guesses),
    });
  });

  await page.route(`**/properties/${property.id}/listings**`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(listings),
    });
  });

  await page.route(`**/properties/${property.id}/view**`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        viewCount: 1,
        uniqueViewers: 1,
      }),
    });
  });
}
