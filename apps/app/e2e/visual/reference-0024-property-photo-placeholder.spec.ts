/**
 * Reference Expectation E2E Test: 0024-property-photo-placeholder
 *
 * This test verifies the property photo placeholder improvement:
 * - Property detail view shows PDOK aerial/satellite imagery with pin overlay
 * - Graceful error states (styled placeholder, not broken image)
 * - Never shows generic gray "Property Photo" placeholder
 *
 * Screenshot saved to: test-results/reference-expectations/0024-property-photo-placeholder/
 */

import { test, expect, Page, Route } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { buildPropertyRoute } from '@/src/utils/property-route';

/**
 * Mock property data with geometry for satellite imagery testing
 */
const MOCK_PROPERTY_WITH_GEOMETRY = {
  id: 'test-property-photo-001',
  nationalId: '0772010000123456',
  address: 'Stratumseind 100',
  city: 'Eindhoven',
  postalCode: '5611 ET',
  countryCode: 'NL',
  geometry: {
    type: 'Point',
    coordinates: [5.4697, 51.4416], // [lon, lat]
  },
  yearBuilt: 1985,
  floorAreaM2: 120,
  status: 'active',
  officialValuation: 425000,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

/**
 * Setup API route interception to return mock property data
 */
async function setupPropertyMocking(page: Page): Promise<void> {
  await page.route('**/properties/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const method = request.method();

    if (pathname === '/properties/resolve' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: MOCK_PROPERTY_WITH_GEOMETRY.id,
          address: `${MOCK_PROPERTY_WITH_GEOMETRY.address}, ${MOCK_PROPERTY_WITH_GEOMETRY.postalCode} ${MOCK_PROPERTY_WITH_GEOMETRY.city}`,
          postalCode: MOCK_PROPERTY_WITH_GEOMETRY.postalCode,
          city: MOCK_PROPERTY_WITH_GEOMETRY.city,
          coordinates: {
            lon: MOCK_PROPERTY_WITH_GEOMETRY.geometry.coordinates[0],
            lat: MOCK_PROPERTY_WITH_GEOMETRY.geometry.coordinates[1],
          },
          hasListing: false,
          officialValuation: MOCK_PROPERTY_WITH_GEOMETRY.officialValuation,
          countryCode: MOCK_PROPERTY_WITH_GEOMETRY.countryCode,
        }),
      });
      return;
    }

    if (pathname.match(/^\/properties\/[^/]+$/) && method === 'GET') {
      const propertyId = pathname.split('/').pop();

      const mockResponse = {
        ...MOCK_PROPERTY_WITH_GEOMETRY,
        id: propertyId,
      };

      console.log(`Mocking property API response for ID: ${propertyId}`);

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockResponse),
      });
      return;
    }

    if (pathname.match(/^\/properties\/[^/]+\/guesses$/) && method === 'GET') {
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
            officialValuation: null,
            askingPrice: null,
            divergence: null,
          },
        }),
      });
      return;
    }

    if (pathname.match(/^\/properties\/[^/]+\/comments$/) && method === 'GET') {
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

    if (pathname.match(/^\/properties\/[^/]+\/listings$/) && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
      return;
    }

    if (pathname.match(/^\/properties\/[^/]+\/view$/) && method === 'POST') {
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
  });

  // Mock the PDOK aerial tile request so the spec stays deterministic and
  // does not depend on the external tile service returning a 200.
  await page.route('**/hwh/luchtfotorgb/wms/v1_0**', async (route: Route) => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
        <defs>
          <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#B8D4E8" />
            <stop offset="100%" stop-color="#DCE9CF" />
          </linearGradient>
          <pattern id="roads" width="120" height="120" patternUnits="userSpaceOnUse">
            <rect width="120" height="120" fill="url(#sky)" />
            <path d="M0 22 H120 M0 60 H120 M0 98 H120" stroke="#D9C6A3" stroke-width="6" opacity="0.35" />
            <path d="M24 0 V120 M72 0 V120" stroke="#A9B39A" stroke-width="4" opacity="0.25" />
          </pattern>
        </defs>
        <rect width="800" height="600" fill="url(#roads)" />
        <rect x="110" y="110" width="190" height="110" rx="16" fill="#B68E5A" opacity="0.72" />
        <rect x="370" y="240" width="250" height="140" rx="20" fill="#7F9C74" opacity="0.68" />
        <rect x="190" y="380" width="330" height="120" rx="20" fill="#D8C49A" opacity="0.72" />
      </svg>
    `.trim();

    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: svg,
    });
  });
}

// Disable tracing for this test
test.use({ trace: 'off', video: 'off' });

// Configuration
const EXPECTATION_NAME = '0024-property-photo-placeholder';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Known acceptable console errors - MINIMAL list
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

// Increase test timeout
test.setTimeout(120000);

async function openMockPropertyDetail(page: Page): Promise<void> {
  await page.goto(buildPropertyRoute(MOCK_PROPERTY_WITH_GEOMETRY));
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('property-header-carousel')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1000);
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

    page.on('requestfailed', (request) => {
      const failure = request.failure();
      if (failure) {
        console.log(`Request failed: ${request.url()} :: ${failure.errorText}`);
      }
    });

    page.on('response', (response) => {
      if (response.status() >= 400) {
        console.log(`HTTP ${response.status()}: ${response.url()}`);
      }
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const isKnown = KNOWN_ACCEPTABLE_ERRORS.some((pattern) =>
          pattern.test(text)
        );
        if (!isKnown) {
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
      consoleWarnings.slice(0, 10).forEach((w) => console.log(`  - ${w}`));
      if (consoleWarnings.length > 10) {
        console.log(`  ... and ${consoleWarnings.length - 10} more`);
      }
    }

    if (consoleErrors.length > 0) {
      console.error(`Console errors detected (${consoleErrors.length}):`);
      consoleErrors.forEach((e) => console.error(`  - ${e}`));
    }
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('verify property detail shows satellite imagery instead of gray placeholder', async ({ page }) => {
    await openMockPropertyDetail(page);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });

    const carousel = page.getByTestId('property-header-carousel');
    const satellite = page.getByTestId('property-header-satellite');
    const aerialImage = page.getByTestId('property-header-image');
    const placeholder = page.getByTestId('property-header-placeholder');
    const noCoordsPlaceholder = page.getByTestId('property-header-no-coords-placeholder');

    await expect(carousel).toBeVisible();
    await expect(satellite).toBeVisible();
    await expect(aerialImage).toBeVisible();
    await expect(placeholder).toHaveCount(0);
    await expect(noCoordsPlaceholder).toHaveCount(0);

    await expect(page.locator('body')).not.toContainText(/No Photo|Property Photo/i);

    const pageHtml = await page.locator('body').innerHTML();
    expect(pageHtml.includes('placeholder.com'), 'Old gray placeholder URL should not be present').toBe(false);
    expect(pageHtml.includes('No+Photo'), 'Old gray placeholder asset should not be present').toBe(false);
  });

  test('verify no generic placeholder text in property detail', async ({ page }) => {
    await openMockPropertyDetail(page);

    await expect(page.locator('body')).not.toContainText(/No Photo|Property Photo/i);

    const pageHtml = await page.locator('body').innerHTML();
    expect(pageHtml.includes('via.placeholder.com'), 'Should NOT use via.placeholder.com').toBe(false);
    expect(pageHtml.includes('No+Photo'), 'Should NOT show generic placeholder asset').toBe(false);
  });

});
