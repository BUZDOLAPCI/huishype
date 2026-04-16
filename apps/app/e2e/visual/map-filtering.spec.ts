import { expect, test } from '@playwright/test';

import { waitForMapReady } from '../integration/helpers';

const KNOWN_ACCEPTABLE_ERRORS: RegExp[] = [
  /ResizeObserver loop/,
  /sourceMappingURL/,
  /Failed to parse source map/,
  /Fast Refresh/,
  /\[HMR\]/,
  /WebSocket connection/,
  /net::ERR_ABORTED/,
  /net::ERR_NAME_NOT_RESOLVED/,
  /AJAXError/,
  /\.pbf/,
  /tiles\.openfreemap\.org/,
  /pointerEvents is deprecated/,
  /GL Driver Message/,
  /Expected value to be of type/,
  /Failed to load resource.*\/sprites\//,
  /Failed to load resource.*\.pbf/,
  /font/i,
];

test.describe('Map Filtering Visual', () => {
  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];

    page.on('console', (msg) => {
      if (msg.type() !== 'error') {
        return;
      }

      const text = msg.text();
      if (!KNOWN_ACCEPTABLE_ERRORS.some((pattern) => pattern.test(text))) {
        consoleErrors.push(text);
      }
    });

    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`,
    ).toHaveLength(0);
  });

  test('renders the filter rail and committed sale-price panel state', async ({
    page,
  }, testInfo) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForMapReady(page, 60_000);

    await page.getByTestId('map-filter-pill-price').click();
    await page.getByTestId('map-filter-input-price-sale-from').click();
    await page.getByTestId('map-filter-input-price-sale-from').fill('125');
    await expect(page.getByTestId('map-filter-suggestions-price-sale-from')).toBeVisible();
    await expect(page.getByTestId('map-filter-suggestion-price-sale-from-125')).toBeVisible();
    await expect(page.getByTestId('map-filter-suggestion-price-sale-from-125000')).toBeVisible();
    await expect(page.getByTestId('map-filter-suggestion-price-sale-from-1250000')).toBeVisible();

    await expect(page.getByTestId('map-filter-panel-price')).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath('map-filtering-sale-price-panel.png'),
      fullPage: false,
    });
  });
});
