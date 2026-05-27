import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { attachConsoleErrorCollector, expectNoConsoleErrors, NETWORK_ALLOWED_CONSOLE_PATTERNS } from '../helpers/console';
import { getPlaywrightApiUrl } from '../helpers/runtime';
import { waitForMapReady } from './helpers';

const API_BASE_URL = getPlaywrightApiUrl();

type TestProperty = {
  id: string;
  address: string;
  city: string;
  street: string;
  postalCode: string;
  houseNumber: number;
  houseNumberAddition: string | null;
};

type SerializableTileSource = {
  serialize?: () => { tiles?: readonly string[] | null } | null;
};

type InspectableMapInstance = {
  getCenter?: () => { lng: number; lat: number };
  getSource?: (id: string) => SerializableTileSource | null;
};

async function getTestProperty(request: APIRequestContext): Promise<TestProperty> {
  const response = await request.get(`${API_BASE_URL}/properties?limit=20&city=Eindhoven`);
  expect(response.ok()).toBe(true);

  const data = await response.json();
  const property = data.data.find(
    (item: Partial<TestProperty>) =>
      item.address &&
      item.city &&
      item.street &&
      item.postalCode &&
      item.houseNumber,
  ) as TestProperty | undefined;

  expect(property).toBeTruthy();
  return property!;
}

async function mockLocationSearch(page: Page, property: TestProperty): Promise<void> {
  await page.route('**/search/locations**', async (route) => {
    const url = new URL(route.request().url());
    const query = (url.searchParams.get('q') ?? '').toLowerCase();
    const propertyNeedle = property.address.toLowerCase();

    if (query.includes(propertyNeedle)) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: `property:${property.id}`,
            type: 'property',
            label: property.address,
            subtitle: `${property.postalCode} ${property.city}`,
            address: property.address,
            city: property.city,
            countryCode: 'NL',
            street: property.street,
            postalCode: property.postalCode,
            houseNumber: property.houseNumber,
            houseNumberAddition: property.houseNumberAddition,
            coordinates: [5.4697, 51.4416],
            propertyId: property.id,
          },
        ]),
      });
      return;
    }

    if (query.includes('waalre')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'city:NL:waalre',
            type: 'city',
            label: 'Waalre',
            subtitle: 'Noord-Brabant, Nederland',
            countryCode: 'NL',
            coordinates: [5.444, 51.386],
            bbox: [5.39, 51.34, 5.52, 51.43],
            filterToken: {
              type: 'city',
              countryCode: 'NL',
              value: 'waalre',
              label: 'Waalre',
              coordinates: [5.444, 51.386],
              bbox: [5.39, 51.34, 5.52, 51.43],
            },
          },
        ]),
      });
      return;
    }

    if (query.includes('eindhoven')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'city:NL:eindhoven',
            type: 'city',
            label: 'Eindhoven',
            subtitle: 'Noord-Brabant, Nederland',
            countryCode: 'NL',
            coordinates: [5.4697, 51.4416],
            bbox: [5.35, 51.36, 5.57, 51.51],
            filterToken: {
              type: 'city',
              countryCode: 'NL',
              value: 'eindhoven',
              label: 'Eindhoven',
              coordinates: [5.4697, 51.4416],
              bbox: [5.35, 51.36, 5.57, 51.51],
            },
          },
        ]),
      });
      return;
    }

    await route.fulfill({ contentType: 'application/json', body: '[]' });
  });
}

async function addAreaChip(page: Page, query: string, label: string): Promise<void> {
  const searchInput = page.getByTestId('search-bar-input');

  await searchInput.click();
  await searchInput.pressSequentially(query, { delay: 20 });
  await expect(page.getByTestId('search-result-item').filter({ hasText: label }).first()).toBeVisible({
    timeout: 10_000,
  });
  await page.getByTestId('search-result-item').filter({ hasText: label }).first().click();
  await expect(page.getByTestId('search-area-chip').filter({ hasText: label })).toBeVisible();
}

async function getPropertyTileUrl(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const map = (window as Window & { __mapInstance?: InspectableMapInstance }).__mapInstance;
    const source = map?.getSource?.('properties-source');
    const tiles = source?.serialize?.()?.tiles;
    return Array.isArray(tiles) ? (tiles[0] ?? null) : null;
  });
}

test.describe('Merged Location Search', () => {
  test.setTimeout(90_000);

  test('supports area chips, URL restore, direct address selection, and search current location', async ({
    page,
    request,
  }) => {
    const consoleErrors = attachConsoleErrorCollector(page, NETWORK_ALLOWED_CONSOLE_PATTERNS);
    const property = await getTestProperty(request);
    await mockLocationSearch(page, property);

    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition: (success: (position: GeolocationPosition) => void) =>
            success({
              coords: {
                latitude: 52.0907,
                longitude: 5.1214,
                accuracy: 10,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
                toJSON: () => ({}),
              },
              timestamp: Date.now(),
              toJSON: () => ({}),
            } as GeolocationPosition),
        },
      });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForMapReady(page, 60_000);

    await addAreaChip(page, 'Waalre', 'Waalre');
    await addAreaChip(page, 'Eindhoven', 'Eindhoven');

    await expect.poll(() => page.evaluate(() => window.location.search)).toContain('area=city%3ANL%3Awaalre');
    await expect.poll(() => page.evaluate(() => window.location.search)).toContain('area=city%3ANL%3Aeindhoven');
    await expect.poll(() => getPropertyTileUrl(page)).toContain('area=city%3ANL%3Awaalre');
    await expect.poll(() => getPropertyTileUrl(page)).toContain('area=city%3ANL%3Aeindhoven');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForMapReady(page, 60_000);
    await expect(page.getByTestId('search-area-chip').filter({ hasText: 'Waalre' })).toBeVisible();
    await expect(page.getByTestId('search-area-chip').filter({ hasText: 'Eindhoven' })).toBeVisible();

    const searchInput = page.getByTestId('search-bar-input');
    await searchInput.click();
    await expect(page.getByTestId('search-current-location')).toBeVisible();
    await page.getByTestId('search-current-location').click();

    await expect.poll(() => page.evaluate(() => window.location.search)).toContain('area=current-location%3A52.090700%3A5.121400');
    await expect.poll(() => getPropertyTileUrl(page)).toContain('area=current-location%3A52.090700%3A5.121400');
    await expect(page.getByRole('heading', { name: /Current location:/i })).toBeVisible({
      timeout: 15_000,
    });

    const chipCountBeforeAddressSearch = await page.getByTestId('search-area-chip').count();
    await searchInput.click();
    await searchInput.pressSequentially(`${property.address}, ${property.city}`, { delay: 20 });
    await page.getByTestId('search-result-item').filter({ hasText: property.address }).first().click();

    await expect(page.getByTestId('group-preview-card')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('property-preview-address').first()).toContainText(
      property.address.split(',', 1)[0] ?? property.address,
    );
    await expect(page.getByTestId('search-area-chip')).toHaveCount(chipCountBeforeAddressSearch);

    expectNoConsoleErrors(consoleErrors);
  });
});
