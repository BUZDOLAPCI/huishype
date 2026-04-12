/**
 * Reference Expectation E2E Test: property-bottom-sheet-details
 *
 * Verifies the actual web contract:
 * - Marker tap shows the geo-anchored preview card
 * - Preview card tap opens the property panel
 * - Expanded panel shows property details and quick actions
 */

import { test, expect, type Page, type Route } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { waitForMapStyleLoaded, waitForMapIdle } from './helpers/visual-test-helpers';
import { clickOnPropertyMarker } from './helpers/screenshot-harness';

test.use({ trace: 'off', video: 'off' });

const EXPECTATION_NAME = 'property-bottom-sheet-details';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;
const CENTER_COORDINATES: [number, number] = [5.4880, 51.4307];
const ZOOM_LEVEL = 17;

const KNOWN_ACCEPTABLE_ERRORS: RegExp[] = [
  /ResizeObserver loop/,
  /sourceMappingURL/,
  /Failed to parse source map/,
  /Fast Refresh/,
  /\[HMR\]/,
  /WebSocket connection/,
  /net::ERR_ABORTED/,
  /net::ERR_NAME_NOT_RESOLVED/,
];

const MOCK_PROPERTY_DETAILS = {
  id: 'test-property-001',
  nationalId: '0772010000123456',
  countryCode: 'NL',
  address: 'Stratumseind 100',
  city: 'Eindhoven',
  postalCode: '5611 ET',
  geometry: {
    type: 'Point',
    coordinates: [5.4697, 51.4416],
  },
  yearBuilt: 1985,
  floorAreaM2: 120,
  status: 'active',
  officialValuation: 425000,
  askingPrice: 439000,
  activityLevel: 'hot',
  commentCount: 4,
  guessCount: 7,
  viewCount: 28,
  uniqueViewers: 22,
  likeCount: 9,
  isLiked: false,
  isSaved: false,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

async function setupPropertyMocking(page: Page): Promise<void> {
  const handlePropertyRoute = async (route: Route) => {
    const url = route.request().url();
    const pathname = new URL(url).pathname;
    const method = route.request().method();

    if (pathname === '/api/properties/resolve' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: MOCK_PROPERTY_DETAILS.id,
          countryCode: MOCK_PROPERTY_DETAILS.countryCode,
          address: `${MOCK_PROPERTY_DETAILS.address}, ${MOCK_PROPERTY_DETAILS.postalCode} ${MOCK_PROPERTY_DETAILS.city}`,
          postalCode: MOCK_PROPERTY_DETAILS.postalCode,
          city: MOCK_PROPERTY_DETAILS.city,
          coordinates: {
            lon: MOCK_PROPERTY_DETAILS.geometry.coordinates[0],
            lat: MOCK_PROPERTY_DETAILS.geometry.coordinates[1],
          },
          hasListing: false,
          officialValuation: MOCK_PROPERTY_DETAILS.officialValuation,
        }),
      });
      return;
    }

    if (pathname.match(/^\/api\/properties\/[^/]+$/i) && pathname !== '/api/properties/resolve' && method === 'GET') {
      const propertyId = pathname.split('/').pop();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...MOCK_PROPERTY_DETAILS,
          id: propertyId,
        }),
      });
      return;
    }

    if (pathname.match(/^\/api\/properties\/[^/]+\/listings$/i) && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
      return;
    }

    if (pathname.match(/^\/api\/properties\/[^/]+\/guesses$/i) && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [],
          meta: {
            page: 1,
            limit: 100,
            total: 0,
            totalPages: 1,
          },
          fmv: {
            fmv: null,
            confidence: 'none',
            guessCount: 0,
            distribution: null,
            officialValuation: MOCK_PROPERTY_DETAILS.officialValuation,
            askingPrice: null,
            divergence: null,
          },
        }),
      });
      return;
    }

    if (pathname.match(/^\/api\/properties\/[^/]+\/comments$/i) && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [],
          meta: {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 1,
          },
        }),
      });
      return;
    }

    if (pathname.match(/^\/api\/properties\/[^/]+\/view$/i) && method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          viewCount: 1,
          uniqueViewers: 1,
        }),
      });
      return;
    }

    await route.continue();
  };

  await page.route('**/api/properties/**', handlePropertyRoute);
  await page.route('**/properties/**', handlePropertyRoute);
}

async function waitForMapReady(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
  await waitForMapStyleLoaded(page);
  await waitForMapIdle(page, 10000);
}

async function zoomMapTo(page: Page, center: [number, number], zoom: number): Promise<void> {
  await page.evaluate(
    ({ targetCenter, targetZoom }) => {
      const mapInstance = (window as any).__mapInstance;
      if (!mapInstance) return;

      mapInstance.jumpTo({
        center: targetCenter,
        zoom: targetZoom,
        pitch: 0,
      });
    },
    { targetCenter: center, targetZoom: zoom }
  );

  await waitForMapIdle(page, 10000);
  await page.waitForFunction(
    () => {
      const mapInstance = (window as any).__mapInstance;
      if (!mapInstance || !mapInstance.isStyleLoaded()) return false;

      const canvas = mapInstance.getCanvas();
      if (!canvas) return false;

      const layers = ['ghost-nodes', 'active-nodes', 'ghost-clusters', 'property-clusters']
        .filter((layer) => mapInstance.getLayer(layer));
      if (layers.length === 0) return false;

      try {
        const features = mapInstance.queryRenderedFeatures(
          [[0, 0], [canvas.width, canvas.height]],
          { layers }
        );
        return (features?.length || 0) > 0;
      } catch {
        return false;
      }
    },
    { timeout: 30000, polling: 500 }
  );
}

async function openExpandedPropertyPanel(page: Page): Promise<void> {
  await waitForMapReady(page);
  await zoomMapTo(page, CENTER_COORDINATES, ZOOM_LEVEL);

  const clickResult = await clickOnPropertyMarker(page);
  expect(clickResult.success, 'Expected to find a property marker to click').toBe(true);

  const previewCard = page.locator('[data-testid="group-preview-card"]');
  await expect(previewCard).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1500);

  const previewCardBox = await previewCard.boundingBox();
  if (previewCardBox) {
    await page.mouse.click(
      previewCardBox.x + previewCardBox.width / 2,
      previewCardBox.y + previewCardBox.height / 3
    );
  } else {
    await previewCard.click({ force: true });
  }

  const panel = page.locator('[data-testid="web-property-panel"]');
  const backdrop = page.locator('[data-testid="web-panel-backdrop"]');

  await page.waitForFunction(() => {
    const panelElement = document.querySelector('[data-testid="web-property-panel"]');
    const backdropElement = document.querySelector('[data-testid="web-panel-backdrop"]');
    if (!panelElement || !backdropElement) return false;

    const backdropStyle = window.getComputedStyle(backdropElement);
    return (
      (panelElement.className.includes('partial') ||
        panelElement.className.includes('full') ||
        panelElement.className.includes('open')) &&
      backdropElement.classList.contains('open') &&
      parseFloat(backdropStyle.opacity || '0') > 0.1
    );
  }, { timeout: 10000 });

  await expect(panel).toBeVisible({ timeout: 10000 });
  await expect(backdrop).toHaveClass(/open/, { timeout: 10000 });
  await expect(panel.getByText('Property Details').first()).toBeVisible({ timeout: 10000 });
  await expect(panel.getByText('Guess the Price').first()).toBeVisible({ timeout: 15000 });
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

    await setupPropertyMocking(page);

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!KNOWN_ACCEPTABLE_ERRORS.some((pattern) => pattern.test(text))) {
          consoleErrors.push(text);
        }
      } else if (msg.type() === 'warning') {
        consoleWarnings.push(msg.text());
      }
    });

    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    if (consoleWarnings.length > 0) {
      console.log(`Console warnings (${consoleWarnings.length}):`);
      consoleWarnings.slice(0, 10).forEach((warning) => console.log(`  - ${warning}`));
      if (consoleWarnings.length > 10) {
        console.log(`  ... and ${consoleWarnings.length - 10} more`);
      }
    }

    if (consoleErrors.length > 0) {
      console.error(`Console errors detected (${consoleErrors.length}):`);
      consoleErrors.forEach((error) => console.error(`  - ${error}`));
    }

    expect(consoleErrors, `Expected zero console errors but found ${consoleErrors.length}`).toHaveLength(0);
  });

  test('capture bottom sheet for visual comparison', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await openExpandedPropertyPanel(page);

    const panel = page.locator('[data-testid="web-property-panel"]');
    const heroImage = page.getByTestId('property-header-image');
    const marker = page.getByTestId('property-header-marker');
    await expect(panel.getByText('Save').first()).toBeVisible();
    await expect(panel.getByText('Share').first()).toBeVisible();
    await expect(panel.getByText('Like').first()).toBeVisible();
    await expect(page.locator('[data-testid="web-panel-backdrop"]')).toHaveClass(/open/);
    await expect(heroImage).toBeVisible({ timeout: 10000 });
    await expect(marker).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(300);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-full-page.png`,
      fullPage: true,
    });
  });

  test('verify bottom sheet elements', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await openExpandedPropertyPanel(page);

    const panel = page.locator('[data-testid="web-property-panel"]');
    await expect(page.getByTestId('property-header-image')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('property-header-marker')).toBeVisible({ timeout: 10000 });
    await expect(panel.getByText('Property Details').first()).toBeVisible();
    await expect(panel.getByText('Guess the Price').first()).toBeVisible();
    await expect(panel.getByText('Save').first()).toBeVisible();
    await expect(panel.getByText('Share').first()).toBeVisible();
    await expect(panel.getByText('Like').first()).toBeVisible();
    await expect(panel.getByText('Postal code', { exact: true })).toBeVisible();
    await expect(panel.getByText('Activity', { exact: true })).toBeVisible();
  });

  test('verify map interaction', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await openExpandedPropertyPanel(page);

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-map-only.png`,
      fullPage: false,
    });
  });
});
