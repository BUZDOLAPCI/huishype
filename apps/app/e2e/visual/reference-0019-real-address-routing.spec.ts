/**
 * Reference Expectation: 0019-real-address-routing
 *
 * V2 contract:
 * - canonical property URLs load directly into the property detail surface
 * - partial city/postcode URLs hydrate the map session, not placeholder pages
 * - invalid address-style entries collapse back to `/`
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import {
  buildCanonicalCityMapPath,
  buildCanonicalPostcodeMapPath,
  isCanonicalMapRoutePath,
} from '@huishype/shared';
import { buildPropertyRoute } from '@/src/utils/property-route';
import { waitForPropertyDetailReady } from '../integration/helpers';
import { getPlaywrightApiUrl } from '../helpers/runtime';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';

const EXPECTATION_NAME = '0019-real-address-routing';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;
const API_BASE_URL = getPlaywrightApiUrl();
const REAL_ADDRESS_BBOX = '5.47,51.48,5.49,51.50';

const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

function getVisibleMapView(page: Page) {
  return page.getByRole('region', { name: 'Map' }).first();
}

async function expectRootMapSessionUrl(page: Page) {
  await expect
    .poll(() => {
      const pathname = new URL(page.url()).pathname;
      return pathname === '/' || isCanonicalMapRoutePath(pathname);
    }, {
      message: `Expected ${page.url()} to resolve to the root map session`,
      timeout: 5000,
    })
    .toBe(true);
}

interface TestProperty {
  id: string;
  address: string;
  city: string;
  postalCode: string;
  countryCode?: string | null;
  street?: string | null;
  streetName?: string | null;
  houseNumber?: string | number | null;
  houseNumberAddition?: string | null;
}

async function getCanonicalTestProperty(
  request: APIRequestContext,
): Promise<TestProperty> {
  const response = await request.get(
    `${API_BASE_URL}/properties?limit=1&bbox=${REAL_ADDRESS_BBOX}`,
  );
  expect(response.ok()).toBe(true);

  const payload = await response.json();
  expect(payload.data?.length).toBeGreaterThan(0);

  const property = payload.data[0] as TestProperty;
  expect(property.address).toBeTruthy();
  expect(property.city).toBeTruthy();
  expect(property.postalCode).toBeTruthy();

  return property;
}

test.describe(`Reference Expectation: ${EXPECTATION_NAME}`, () => {
  let consoleErrors: string[] = [];
  let consoleWarnings: string[] = [];

  test.beforeAll(async () => {
    const fullPath = path.resolve(process.cwd(), SCREENSHOT_DIR);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    consoleWarnings = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const isKnown = isAllowedConsoleMessage(text, KNOWN_ACCEPTABLE_ERRORS);
        if (!isKnown) {
          consoleErrors.push(text);
        }
      } else if (msg.type() === 'warning') {
        consoleWarnings.push(msg.text());
      }
    });

    page.on('pageerror', (error) => {
      const text = error.message;
      const isKnown = isAllowedConsoleMessage(text, KNOWN_ACCEPTABLE_ERRORS);
      if (!isKnown) {
        consoleErrors.push(`Page Error: ${text}`);
      }
    });
  });

  test.afterEach(async () => {
    if (consoleWarnings.length > 0) {
      console.log(`Console warnings (${consoleWarnings.length}):`);
      consoleWarnings.slice(0, 10).forEach((warning) =>
        console.log(`  - ${warning.slice(0, 200)}`),
      );
    }

    if (consoleErrors.length > 0) {
      console.error(`Console errors detected (${consoleErrors.length}):`);
      consoleErrors.forEach((error) => console.error(`  - ${error}`));
    }

    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`,
    ).toHaveLength(0);
  });

  test('navigate to full canonical address URL and display property details', async ({
    page,
    request,
  }) => {
    const property = await getCanonicalTestProperty(request);
    const propertyRoute = buildPropertyRoute(property);

    await page.goto(propertyRoute);
    await page.waitForLoadState('networkidle');

    await waitForPropertyDetailReady(page, property.address, 10000);
    await expect(page).toHaveURL(new RegExp(`${propertyRoute.replace(/\//g, '\\/')}(?:\\?.*)?$`));

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: true,
    });
  });

  test('display map state for partial URL (city only)', async ({ page, request }) => {
    const property = await getCanonicalTestProperty(request);
    const cityRoute = buildCanonicalCityMapPath({
      city: property.city,
      countryCode: property.countryCode ?? 'NL',
    });

    await page.goto(cityRoute);
    await page.waitForLoadState('networkidle');

    const cityMapView = getVisibleMapView(page);
    await cityMapView.waitFor({ state: 'visible', timeout: 10000 });
    await expect(page.getByTestId('property-header-carousel')).toHaveCount(0);
    await expectRootMapSessionUrl(page);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-city-view.png`,
      fullPage: true,
    });
  });

  test('display map state for partial URL (city + postcode)', async ({ page, request }) => {
    const property = await getCanonicalTestProperty(request);
    const postcodeRoute = buildCanonicalPostcodeMapPath({
      city: property.city,
      postalCode: property.postalCode,
      countryCode: property.countryCode ?? 'NL',
    });

    await page.goto(postcodeRoute);
    await page.waitForLoadState('networkidle');

    const postcodeMapView = getVisibleMapView(page);
    await postcodeMapView.waitFor({ state: 'visible', timeout: 10000 });
    await expect(page.getByTestId('property-header-carousel')).toHaveCount(0);
    await expectRootMapSessionUrl(page);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-postcode-view.png`,
      fullPage: true,
    });
  });

  test('collapse non-existent address entries back to root', async ({ page }) => {
    await page.goto('/eindhoven/9999xx/fakestraat/999');
    await page.waitForLoadState('networkidle');

    const rootMapView = getVisibleMapView(page);
    await rootMapView.waitFor({ state: 'visible', timeout: 10000 });
    await expectRootMapSessionUrl(page);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-404.png`,
      fullPage: true,
    });
  });

  test('verify address styling uses the real property address', async ({
    page,
    request,
  }) => {
    const property = await getCanonicalTestProperty(request);
    const propertyRoute = buildPropertyRoute(property);

    await page.goto(propertyRoute);
    await page.waitForLoadState('networkidle');

    await waitForPropertyDetailReady(page, property.address, 10000);

    const header = page.getByTestId('property-header-carousel');
    await header.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-address-header.png`,
    });
  });

  test('deep linking works - direct canonical property URLs open the detail page', async ({
    page,
    request,
  }) => {
    const property = await getCanonicalTestProperty(request);
    const propertyRoute = buildPropertyRoute(property);

    await page.goto(propertyRoute);
    await page.waitForLoadState('networkidle');

    await waitForPropertyDetailReady(page, property.address, 10000);
    await expect(page.locator('[data-testid="map-view"]')).toHaveCount(0);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-deep-link.png`,
      fullPage: true,
    });
  });
});
