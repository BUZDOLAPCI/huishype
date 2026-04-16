import { expect, test, type Page } from '@playwright/test';

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

async function getPropertySourceTileUrl(page: Page) {
  return page.evaluate(() => {
    const map = (window as any).__mapInstance;
    const source = map?.getSource?.('properties-source');
    const serialized = source?.serialize?.();
    return serialized?.tiles?.[0] ?? null;
  });
}

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

    await page.getByTestId('map-filter-pill-salePrice').click();
    await page.getByTestId('map-filter-input-salePrice-from').fill('550000');
    await page.getByTestId('map-filter-input-salePrice-to').fill('850000');
    await page.getByTestId('map-filter-apply-salePrice').click();

    await expect(page.getByTestId('map-filter-pill-salePrice-dismiss')).toBeVisible();
    await expect.poll(() => getPropertySourceTileUrl(page)).toContain(
      'salePriceFrom=550000',
    );
    await expect.poll(() => getPropertySourceTileUrl(page)).toContain(
      'salePriceTo=850000',
    );

    await page.getByTestId('map-filter-pill-salePrice').click();
    await expect(page.getByTestId('map-filter-panel-salePrice')).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath('map-filtering-sale-price-panel.png'),
      fullPage: false,
    });
  });
});
