import { type APIRequestContext, type Page } from '@playwright/test';
import {
  buildPropertyRoute,
  type PropertyRouteAddressLike,
} from '@/src/utils/property-route';
import { getPlaywrightApiUrl } from '../../helpers/runtime';

const API_BASE_URL = getPlaywrightApiUrl();

export interface CanonicalPropertyFixture extends PropertyRouteAddressLike {
  id: string;
  address?: string | null;
  geometry?: { type: 'Point'; coordinates: [number, number] } | null;
  hasListing?: boolean | null;
  commentCount?: number | null;
  guessCount?: number | null;
  officialValuation?: number | null;
  askingPrice?: number | null;
}

export interface CanonicalPropertySelection {
  property: CanonicalPropertyFixture;
  route: string;
}

export async function fetchCanonicalPropertyFixture(
  request: APIRequestContext,
  query: string,
  pick?: (properties: CanonicalPropertyFixture[]) => CanonicalPropertyFixture | null | undefined,
): Promise<CanonicalPropertySelection | null> {
  const response = await request.get(`${API_BASE_URL}/properties?${query}`);
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
  };
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
  const response = await request.get(`${API_BASE_URL}${path}`);
  if (!response.ok()) {
    return fallback;
  }

  return (await response.json()) as T;
}

export async function setupCanonicalPropertyRouteMocks(
  page: Page,
  request: APIRequestContext,
  selection: CanonicalPropertySelection,
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

  const [propertyDetail, comments, guesses, listings] = await Promise.all([
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
    }),
    fetchJsonOrFallback(request, `/properties/${property.id}/listings`, { data: [] }),
  ]);

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
