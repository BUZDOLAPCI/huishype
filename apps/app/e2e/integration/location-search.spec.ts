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

type SerializableMapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

type FitBoundsOptions = {
  maxZoom?: number;
  duration?: number;
  essential?: boolean;
  padding?: unknown;
};

type RecordedFitBoundsCall = {
  bounds: SerializableMapBounds;
  options: FitBoundsOptions | null;
};

type InspectableBoundsLike = {
  getWest?: () => number;
  getSouth?: () => number;
  getEast?: () => number;
  getNorth?: () => number;
  getSouthWest?: () => { lng: number; lat: number };
  getNorthEast?: () => { lng: number; lat: number };
  toArray?: () => [[number, number], [number, number]];
};

type InspectableMapInstance = {
  getCenter?: () => { lng: number; lat: number };
  fitBounds?: (bounds: unknown, options?: FitBoundsOptions) => unknown;
  getSource?: (id: string) => SerializableTileSource | null;
  isMoving?: () => boolean;
};

const MOCK_CURRENT_LOCATION = {
  latitude: 52.0907,
  longitude: 5.1214,
  radiusMeters: 5_000,
};

const CURRENT_LOCATION_AREA_TOKEN =
  `current-location:${MOCK_CURRENT_LOCATION.latitude.toFixed(6)}` +
  `:${MOCK_CURRENT_LOCATION.longitude.toFixed(6)}:${MOCK_CURRENT_LOCATION.radiusMeters}`;
const ENCODED_CURRENT_LOCATION_AREA_TOKEN = encodeURIComponent(CURRENT_LOCATION_AREA_TOKEN);

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
  await page.route('**/search/location-tokens**', async (route) => {
    const url = new URL(route.request().url());
    const areas = url.searchParams.getAll('area');
    const hydrated = areas.flatMap((area) => {
      if (area === 'city:NL:waalre') {
        return [
          {
            id: 'city:NL:waalre',
            type: 'city',
            countryCode: 'NL',
            value: 'waalre',
            label: 'Waalre',
            parentLabel: 'Noord-Brabant',
            city: 'Waalre',
            region: 'Noord-Brabant',
            coordinates: [5.444, 51.386],
            bbox: [5.39, 51.34, 5.52, 51.43],
          },
        ];
      }

      if (area === 'city:NL:eindhoven') {
        return [
          {
            id: 'city:NL:eindhoven',
            type: 'city',
            countryCode: 'NL',
            value: 'eindhoven',
            label: 'Eindhoven',
            parentLabel: 'Noord-Brabant',
            city: 'Eindhoven',
            region: 'Noord-Brabant',
            coordinates: [5.4697, 51.4416],
            bbox: [5.35, 51.36, 5.57, 51.51],
          },
        ];
      }

      return [];
    });

    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(hydrated),
    });
  });

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

async function getMapCenter(page: Page): Promise<{ lng: number; lat: number } | null> {
  return page.evaluate(() => {
    const map = (window as Window & { __mapInstance?: InspectableMapInstance }).__mapInstance;
    return map?.getCenter?.() ?? null;
  });
}

async function getMapIsMoving(page: Page): Promise<boolean | null> {
  return page.evaluate(() => {
    const map = (window as Window & { __mapInstance?: InspectableMapInstance }).__mapInstance;
    return map?.isMoving?.() ?? null;
  });
}

async function installFitBoundsRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    type RecorderWindow = Window & {
      __fitBoundsCalls?: RecordedFitBoundsCall[];
      __fitBoundsRecorderInstalled?: boolean;
      __mapInstance?: InspectableMapInstance;
    };
    const win = window as RecorderWindow;
    const map = win.__mapInstance;
    win.__fitBoundsCalls = [];

    if (!map?.fitBounds || win.__fitBoundsRecorderInstalled) {
      return;
    }

    const serializeBounds = (bounds: unknown): SerializableMapBounds | null => {
      if (Array.isArray(bounds)) {
        if (bounds.length >= 4 && bounds.every((value) => typeof value === 'number')) {
          return {
            west: bounds[0] as number,
            south: bounds[1] as number,
            east: bounds[2] as number,
            north: bounds[3] as number,
          };
        }

        const southWest = bounds[0];
        const northEast = bounds[1];
        if (Array.isArray(southWest) && Array.isArray(northEast)) {
          return {
            west: southWest[0] as number,
            south: southWest[1] as number,
            east: northEast[0] as number,
            north: northEast[1] as number,
          };
        }
      }

      const boundsLike = bounds as InspectableBoundsLike;
      const west = boundsLike.getWest?.();
      const south = boundsLike.getSouth?.();
      const east = boundsLike.getEast?.();
      const north = boundsLike.getNorth?.();
      if (
        typeof west === 'number' &&
        typeof south === 'number' &&
        typeof east === 'number' &&
        typeof north === 'number'
      ) {
        return { west, south, east, north };
      }

      const southWest = boundsLike.getSouthWest?.();
      const northEast = boundsLike.getNorthEast?.();
      if (southWest && northEast) {
        return {
          west: southWest.lng,
          south: southWest.lat,
          east: northEast.lng,
          north: northEast.lat,
        };
      }

      const arrayBounds = boundsLike.toArray?.();
      if (arrayBounds) {
        return {
          west: arrayBounds[0][0],
          south: arrayBounds[0][1],
          east: arrayBounds[1][0],
          north: arrayBounds[1][1],
        };
      }

      return null;
    };

    const originalFitBounds = map.fitBounds.bind(map);
    map.fitBounds = (bounds, options) => {
      const serializedBounds = serializeBounds(bounds);
      if (serializedBounds) {
        win.__fitBoundsCalls?.push({
          bounds: serializedBounds,
          options: options ?? null,
        });
      }

      return originalFitBounds(bounds, options);
    };
    win.__fitBoundsRecorderInstalled = true;
  });
}

function getRadiusBounds(location: typeof MOCK_CURRENT_LOCATION): SerializableMapBounds {
  const latRadiusDegrees = location.radiusMeters / 110574;
  const lonScale = Math.max(Math.cos((location.latitude * Math.PI) / 180), 0.01);
  const lonRadiusDegrees = location.radiusMeters / (111320 * lonScale);

  return {
    west: location.longitude - lonRadiusDegrees,
    south: location.latitude - latRadiusDegrees,
    east: location.longitude + lonRadiusDegrees,
    north: location.latitude + latRadiusDegrees,
  };
}

function boundsContainBounds(
  actual: SerializableMapBounds,
  expected: SerializableMapBounds,
): boolean {
  const tolerance = 0.001;
  return (
    actual.west <= expected.west + tolerance &&
    actual.south <= expected.south + tolerance &&
    actual.east >= expected.east - tolerance &&
    actual.north >= expected.north - tolerance
  );
}

async function getFitBoundsCalls(page: Page): Promise<RecordedFitBoundsCall[]> {
  return page.evaluate(
    () =>
      ((window as Window & { __fitBoundsCalls?: RecordedFitBoundsCall[] }).__fitBoundsCalls ?? []),
  );
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

    await page.addInitScript((location) => {
      Object.defineProperty(window.navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition: (success: (position: GeolocationPosition) => void) =>
            success({
              coords: {
                latitude: location.latitude,
                longitude: location.longitude,
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
    }, MOCK_CURRENT_LOCATION);

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
    await expect
      .poll(() => page.evaluate(() => window.location.search), { timeout: 15_000 })
      .toContain('area=city%3ANL%3Awaalre%3Acity%3Dwaalre%3Aregion%3Dnoord-brabant');
    await expect
      .poll(() => page.evaluate(() => window.location.search), { timeout: 15_000 })
      .toContain('area=city%3ANL%3Aeindhoven%3Acity%3Deindhoven%3Aregion%3Dnoord-brabant');
    await expect
      .poll(() => getPropertyTileUrl(page), { timeout: 15_000 })
      .toContain('area=city%3ANL%3Awaalre%3Acity%3Dwaalre%3Aregion%3Dnoord-brabant');
    await expect
      .poll(() => getPropertyTileUrl(page), { timeout: 15_000 })
      .toContain('area=city%3ANL%3Aeindhoven%3Acity%3Deindhoven%3Aregion%3Dnoord-brabant');
    await expect.poll(async () => {
      const center = await getMapCenter(page);
      return center ? `${center.lng.toFixed(1)},${center.lat.toFixed(1)}` : null;
    }, { timeout: 15_000 }).toBe('5.5,51.4');
    await expect.poll(() => getMapIsMoving(page), { timeout: 15_000 }).toBe(false);

    const searchInput = page.getByTestId('search-bar-input');
    await installFitBoundsRecorder(page);
    await searchInput.click();
    await expect(page.getByTestId('search-current-location')).toBeVisible();
    await page.getByTestId('search-current-location').click();

    await expect
      .poll(() => page.evaluate(() => window.location.search))
      .toContain(`area=${ENCODED_CURRENT_LOCATION_AREA_TOKEN}`);
    await expect
      .poll(() => getPropertyTileUrl(page))
      .toContain(`area=${ENCODED_CURRENT_LOCATION_AREA_TOKEN}`);
    await expect.poll(async () => {
      const fitBoundsCalls = await getFitBoundsCalls(page);
      const latestCall = fitBoundsCalls.at(-1);
      if (!latestCall) {
        return null;
      }

      const expectedBounds = getRadiusBounds(MOCK_CURRENT_LOCATION);
      return boundsContainBounds(latestCall.bounds, expectedBounds)
        ? 'contains-current-location-radius'
        : JSON.stringify({ fitBoundsCalls, expectedBounds });
    }, { timeout: 15_000 }).toBe('contains-current-location-radius');
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
