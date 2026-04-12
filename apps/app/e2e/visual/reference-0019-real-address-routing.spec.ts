import fs from 'fs';
import path from 'path';

import { expect, test } from '@playwright/test';
import { buildCanonicalPropertyPath } from '@huishype/shared';

import { waitForPropertyDetailReady } from '../integration/helpers';

const EXPECTATION_NAME = '0019-real-address-routing';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

const FIXTURE_ROUTE_INPUT = {
  city: 'Eindhoven',
  postalCode: '5651HP',
  streetName: 'Deflectiespoelstraat',
  houseNumber: '16',
  countryCode: 'NL' as const,
};

const FIXTURE = {
  address: 'Deflectiespoelstraat 16, 5651HP Eindhoven',
  propertyPath: buildCanonicalPropertyPath(FIXTURE_ROUTE_INPUT),
};

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
];

test.describe(`Reference Expectation: ${EXPECTATION_NAME}`, () => {
  let consoleErrors: string[] = [];

  test.beforeAll(async () => {
    fs.mkdirSync(path.resolve(process.cwd(), SCREENSHOT_DIR), { recursive: true });
  });

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

  test('captures the canonical property route with the expected address styling', async ({
    page,
  }) => {
    await page.goto(FIXTURE.propertyPath, { waitUntil: 'domcontentloaded' });
    await waitForPropertyDetailReady(page, FIXTURE.address);

    await expect(page.getByTestId('property-header-carousel')).toBeVisible({
      timeout: 15000,
    });
    await expect(page).toHaveURL(new RegExp(`${FIXTURE.propertyPath}$`));

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: true,
    });
  });
});
