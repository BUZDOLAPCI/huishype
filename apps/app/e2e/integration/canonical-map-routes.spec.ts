import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  buildCanonicalCityMapPath,
  buildCanonicalCommentsPath,
  buildCanonicalGuessesPath,
  buildCanonicalMapPreviewPath,
  buildCanonicalPostcodeMapPath,
  buildCanonicalPropertyPath,
} from '@huishype/shared';

import { waitForMapReady, waitForPropertyDetailReady } from './helpers';

const KNOWN_ACCEPTABLE_ERRORS: RegExp[] = [
  /ResizeObserver loop/,
  /sourceMappingURL/,
  /Failed to parse source map/,
  /Fast Refresh/,
  /\[HMR\]/,
  /WebSocket connection/,
  /net::ERR_ABORTED/,
  /net::ERR_NAME_NOT_RESOLVED/,
  /\.pbf/,
  /tiles\.openfreemap\.org/,
  /pointerEvents is deprecated/,
  /GL Driver Message/,
  /Failed to load resource.*\/sprites\//,
  /Failed to load resource: the server responded with a status of 404/,
];

const FIXTURE_ROUTE_INPUT = {
  city: 'Eindhoven',
  postalCode: '5651HP',
  streetName: 'Deflectiespoelstraat',
  houseNumber: '16',
  countryCode: 'NL' as const,
};

const FIXTURE = {
  cityPath: buildCanonicalCityMapPath({
    city: FIXTURE_ROUTE_INPUT.city,
    countryCode: FIXTURE_ROUTE_INPUT.countryCode,
  }),
  postcodePath: buildCanonicalPostcodeMapPath({
    city: FIXTURE_ROUTE_INPUT.city,
    postalCode: FIXTURE_ROUTE_INPUT.postalCode,
    countryCode: FIXTURE_ROUTE_INPUT.countryCode,
  }),
  previewPath: buildCanonicalMapPreviewPath(FIXTURE_ROUTE_INPUT),
  propertyPath: buildCanonicalPropertyPath(FIXTURE_ROUTE_INPUT),
  commentsPath: buildCanonicalCommentsPath(FIXTURE_ROUTE_INPUT),
  guessesPath: buildCanonicalGuessesPath(FIXTURE_ROUTE_INPUT),
  address: 'Deflectiespoelstraat 16',
};

const NON_NL_FIXTURE_ROUTE_INPUT = {
  city: 'Anderlecht',
  postalCode: '1070',
  streetName: 'Allée des Pervenches',
  houseNumber: '4',
  houseNumberAddition: '-C046',
  countryCode: 'BE' as const,
};

const NON_NL_FIXTURE = {
  cityPath: buildCanonicalCityMapPath({
    city: NON_NL_FIXTURE_ROUTE_INPUT.city,
    countryCode: NON_NL_FIXTURE_ROUTE_INPUT.countryCode,
  }),
  postcodePath: buildCanonicalPostcodeMapPath({
    city: NON_NL_FIXTURE_ROUTE_INPUT.city,
    postalCode: NON_NL_FIXTURE_ROUTE_INPUT.postalCode,
    countryCode: NON_NL_FIXTURE_ROUTE_INPUT.countryCode,
  }),
  previewPath: buildCanonicalMapPreviewPath(NON_NL_FIXTURE_ROUTE_INPUT),
  propertyPath: buildCanonicalPropertyPath(NON_NL_FIXTURE_ROUTE_INPUT),
  address: 'Allée des Pervenches 4-C046, 1070 Anderlecht',
};

const API_BASE_URL = process.env.API_URL || 'http://localhost:3100';

interface AreaResolveResponse {
  city: string;
  postalCode: string | null;
  countryCode: string;
  center: {
    lon: number;
    lat: number;
  };
  propertyCount: number;
}

async function getMapCenter(page: Page): Promise<{ lng: number; lat: number; zoom: number }> {
  return page.evaluate(() => {
    const map = (window as unknown as {
      __mapInstance?: { getCenter(): { lng: number; lat: number }; getZoom(): number };
    }).__mapInstance;
    if (!map) {
      throw new Error('Map instance not ready');
    }

    const center = map.getCenter();
    return {
      lng: center.lng,
      lat: center.lat,
      zoom: map.getZoom(),
    };
  });
}

async function resolveArea(
  request: APIRequestContext,
  area: {
    city: string;
    countryCode: string;
    postalCode?: string;
  },
): Promise<AreaResolveResponse> {
  const params = new URLSearchParams({
    city: area.city,
    countryCode: area.countryCode,
  });

  if (area.postalCode) {
    params.set('postalCode', area.postalCode);
  }

  const response = await request.get(
    `${API_BASE_URL}/properties/area-resolve?${params.toString()}`,
  );
  expect(response.ok()).toBe(true);
  return await response.json();
}

async function expectMapCenteredNear(
  page: Page,
  expected: { lat: number; lon: number },
  zoomRange: { min: number; max: number },
) {
  const camera = await getMapCenter(page);

  expect(Math.abs(camera.lat - expected.lat)).toBeLessThan(0.02);
  expect(Math.abs(camera.lng - expected.lon)).toBeLessThan(0.02);
  expect(camera.zoom).toBeGreaterThanOrEqual(zoomRange.min);
  expect(camera.zoom).toBeLessThanOrEqual(zoomRange.max);
}

test.describe('Canonical map routes', () => {
  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!KNOWN_ACCEPTABLE_ERRORS.some((pattern) => pattern.test(text))) {
          consoleErrors.push(text);
        }
      }
    });
    page.on('pageerror', (error) => {
      const text = error.message;
      if (!KNOWN_ACCEPTABLE_ERRORS.some((pattern) => pattern.test(text))) {
        consoleErrors.push(`Page Error: ${text}`);
      }
    });
  });

  test.afterEach(async () => {
    expect(consoleErrors).toHaveLength(0);
  });

  test('boots the map from canonical camera routes', async ({ page }) => {
    await page.goto('/@51.4416,5.4697,13z', { waitUntil: 'domcontentloaded' });
    await waitForMapReady(page);

    const camera = await getMapCenter(page);
    expect(Math.abs(camera.lat - 51.4416)).toBeLessThan(0.01);
    expect(Math.abs(camera.lng - 5.4697)).toBeLessThan(0.01);
    expect(camera.zoom).toBeGreaterThan(12.5);
  });

  test('boots the map from canonical city and postcode routes with resolved map state', async ({
    page,
    request,
  }) => {
    const cityArea = await resolveArea(request, {
      city: FIXTURE_ROUTE_INPUT.city,
      countryCode: FIXTURE_ROUTE_INPUT.countryCode,
    });
    const postcodeArea = await resolveArea(request, {
      city: FIXTURE_ROUTE_INPUT.city,
      postalCode: FIXTURE_ROUTE_INPUT.postalCode,
      countryCode: FIXTURE_ROUTE_INPUT.countryCode,
    });

    await page.goto(FIXTURE.cityPath, { waitUntil: 'domcontentloaded' });
    await waitForMapReady(page);
    await expect(page).toHaveURL(new RegExp(`${FIXTURE.cityPath}$`));
    await expectMapCenteredNear(page, cityArea.center, { min: 13.5, max: 14.5 });

    await page.goto(FIXTURE.postcodePath, { waitUntil: 'domcontentloaded' });
    await waitForMapReady(page);
    await expect(page).toHaveURL(new RegExp(`${FIXTURE.postcodePath}$`));
    await expectMapCenteredNear(page, postcodeArea.center, { min: 15.5, max: 16.5 });
  });

  test('boots preview routes and redirects /map and invalid address paths back to root', async ({
    page,
  }) => {
    await page.goto(FIXTURE.previewPath, { waitUntil: 'domcontentloaded' });
    await waitForMapReady(page);
    const propertyPanel = page.getByTestId('web-property-panel').last();
    await expect(propertyPanel).toBeVisible({ timeout: 20000 });
    await expect(propertyPanel.getByText('Property Details').first()).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByTestId('web-panel-close').last()).toBeVisible({ timeout: 20000 });
    await expect(page).toHaveURL(new RegExp(`${FIXTURE.previewPath}$`));
    await expect(
      propertyPanel.getByText('Deflectiespoelstraat 16, 5651HP Eindhoven'),
    ).toBeVisible({ timeout: 20000 });

    await page.goto('/map', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/$/);

    await page.goto('/definitely-not-a-real-place/0000zz', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/$/);
  });

  test('renders canonical property, comments, and guesses routes directly without redirecting to id paths', async ({
    page,
  }) => {
    await page.goto(FIXTURE.propertyPath, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('property-back-button').last()).toBeVisible({ timeout: 20000 });
    await expect(page).toHaveURL(new RegExp(`${FIXTURE.propertyPath}$`));
    await expect(page.getByText('Deflectiespoelstraat 16, 5651HP Eindhoven').last()).toBeVisible({
      timeout: 20000,
    });

    await page.goto(FIXTURE.commentsPath, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('comments-back-button').last()).toBeVisible({ timeout: 20000 });
    await expect(page).toHaveURL(new RegExp(`${FIXTURE.commentsPath}$`));

    await page.goto(FIXTURE.guessesPath, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('responsive-panel-close').last()).toBeVisible({
      timeout: 20000,
    });
    await expect(page).toHaveURL(new RegExp(`${FIXTURE.guessesPath}$`));
  });

  test('boots non-NL country-prefixed preview routes and preserves the canonical URL', async ({
    page,
  }) => {
    await page.goto(NON_NL_FIXTURE.previewPath, { waitUntil: 'domcontentloaded' });
    await waitForMapReady(page);
    const propertyPanel = page.getByTestId('web-property-panel').last();
    await expect(propertyPanel).toBeVisible({ timeout: 20000 });
    await expect(propertyPanel.getByText('Property Details').first()).toBeVisible({
      timeout: 20000,
    });
    await expect(propertyPanel.getByText(NON_NL_FIXTURE.address)).toBeVisible({
      timeout: 20000,
    });
    await expect(page).toHaveURL(new RegExp(`${NON_NL_FIXTURE.previewPath}$`));
  });

  test('supports non-NL country-prefixed map and property routes end-to-end', async ({
    page,
    request,
  }) => {
    const cityArea = await resolveArea(request, {
      city: NON_NL_FIXTURE_ROUTE_INPUT.city,
      countryCode: NON_NL_FIXTURE_ROUTE_INPUT.countryCode,
    });
    const postcodeArea = await resolveArea(request, {
      city: NON_NL_FIXTURE_ROUTE_INPUT.city,
      postalCode: NON_NL_FIXTURE_ROUTE_INPUT.postalCode,
      countryCode: NON_NL_FIXTURE_ROUTE_INPUT.countryCode,
    });

    await page.goto(NON_NL_FIXTURE.cityPath, { waitUntil: 'domcontentloaded' });
    await waitForMapReady(page);
    await expect(page).toHaveURL(new RegExp(`${NON_NL_FIXTURE.cityPath}$`));
    await expectMapCenteredNear(page, cityArea.center, { min: 13.5, max: 14.5 });

    await page.goto(NON_NL_FIXTURE.postcodePath, { waitUntil: 'domcontentloaded' });
    await waitForMapReady(page);
    await expect(page).toHaveURL(new RegExp(`${NON_NL_FIXTURE.postcodePath}$`));
    await expectMapCenteredNear(page, postcodeArea.center, { min: 15.5, max: 16.5 });

    await page.goto(NON_NL_FIXTURE.propertyPath, { waitUntil: 'domcontentloaded' });
    await waitForPropertyDetailReady(page, NON_NL_FIXTURE.address);
    await expect(page).toHaveURL(new RegExp(`${NON_NL_FIXTURE.propertyPath}$`));
  });
});
