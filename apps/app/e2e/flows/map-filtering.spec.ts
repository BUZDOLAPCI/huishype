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

async function getPropertySourceTileUrl(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const map = (window as any).__mapInstance;
    const source = map?.getSource?.('properties-source');
    const serialized = source?.serialize?.();
    return serialized?.tiles?.[0] ?? null;
  });
}

async function waitForPropertySourceTileUrl(page: import('@playwright/test').Page) {
  await expect.poll(() => getPropertySourceTileUrl(page), {
    message: 'Expected properties-source tile URL to be available',
    timeout: 30_000,
  }).not.toBeNull();

  return await getPropertySourceTileUrl(page);
}

test.describe('Map Filtering', () => {
  test.setTimeout(90_000);

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

  test('draft price edits do not sync until apply, then mutate URL and live source', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForMapReady(page, 60_000);

    const initialTileUrl = await waitForPropertySourceTileUrl(page);
    expect(initialTileUrl).toContain('/tiles/properties/{z}/{x}/{y}.pbf');

    await page.getByTestId('map-filter-pill-salePrice').click();
    await page.getByTestId('map-filter-input-salePrice-from').fill('500000');

    await expect.poll(async () => page.evaluate(() => window.location.search)).toBe('');
    await expect.poll(() => getPropertySourceTileUrl(page)).toBe(initialTileUrl);

    await page.getByTestId('map-filter-apply-salePrice').click();

    await expect
      .poll(async () => page.evaluate(() => window.location.search))
      .toContain('salePriceFrom=500000');
    await expect.poll(() => getPropertySourceTileUrl(page)).toContain(
      'salePriceFrom=500000',
    );

    await page.getByTestId('map-filter-pill-salePrice-dismiss').click();

    await expect
      .poll(async () => page.evaluate(() => window.location.search))
      .not.toContain('salePriceFrom=500000');
    await expect.poll(() => getPropertySourceTileUrl(page)).not.toContain(
      'salePriceFrom=500000',
    );
  });

  test('restores committed filters from a canonical map URL on reload', async ({ page }) => {
    await page.goto(
      '/@51.4416000,5.4697000,14.00z?salePriceFrom=650000&marketState=for-sale',
      { waitUntil: 'domcontentloaded' },
    );
    await waitForMapReady(page, 60_000);
    await waitForPropertySourceTileUrl(page);

    await expect(page.getByTestId('map-filter-pill-salePrice-dismiss')).toBeVisible();
    await expect(page.getByTestId('map-filter-pill-marketState-dismiss')).toBeVisible();

    await page.getByTestId('map-filter-pill-salePrice').click();
    await expect(page.getByTestId('map-filter-input-salePrice-from')).toHaveValue('650000');
    await expect.poll(() => getPropertySourceTileUrl(page)).toContain(
      'salePriceFrom=650000',
    );
    await expect.poll(() => getPropertySourceTileUrl(page)).toContain(
      'marketState=for-sale',
    );
  });
});
