import { expect, test } from '@playwright/test';

import { waitForMapReady } from '../integration/helpers';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';

const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

type SerializableTileSource = {
  serialize?: () => { tiles?: string[] | null } | null;
};

type InspectableMapInstance = {
  getSource?: (id: string) => SerializableTileSource | null;
};

async function getPropertySourceTileUrl(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const map = (window as Window & { __mapInstance?: InspectableMapInstance })
      .__mapInstance;
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
      if (!isAllowedConsoleMessage(text, KNOWN_ACCEPTABLE_ERRORS)) {
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

    await page.getByTestId('map-filter-pill-price').click();
    await page.getByTestId('map-filter-input-price-sale-from').click();
    await page.getByTestId('map-filter-input-price-sale-from').fill('612345');
    await expect(page.getByTestId('map-filter-suggestions-price-sale-from')).toBeVisible();
    await page.getByTestId('map-filter-suggestion-price-sale-from-612345').click();

    await expect.poll(async () => page.evaluate(() => window.location.search)).toBe('');
    await expect.poll(() => getPropertySourceTileUrl(page)).toBe(initialTileUrl);

    await page.getByTestId('map-filter-apply-price').click();

    await expect
      .poll(async () => page.evaluate(() => window.location.search))
      .toContain('salePriceFrom=612345');
    await expect.poll(() => getPropertySourceTileUrl(page)).toContain(
      'salePriceFrom=612345',
    );

    await page.getByTestId('map-filter-pill-price-dismiss').click();

    await expect
      .poll(async () => page.evaluate(() => window.location.search))
      .not.toContain('salePriceFrom=612345');
    await expect.poll(() => getPropertySourceTileUrl(page)).not.toContain(
      'salePriceFrom=612345',
    );
  });

  test('restores committed filters from a canonical map URL on reload', async ({ page }) => {
    await page.goto(
      '/@51.4416000,5.4697000,14.00z?salePriceFrom=650000&marketState=for-sale',
      { waitUntil: 'domcontentloaded' },
    );
    await waitForMapReady(page, 60_000);
    await waitForPropertySourceTileUrl(page);

    await expect(page.getByTestId('map-filter-pill-price-dismiss')).toBeVisible();
    await expect(page.getByTestId('map-filter-pill-market-state-for-sale')).toBeVisible();

    await page.getByTestId('map-filter-pill-price').click();
    await expect(page.getByTestId('map-filter-input-price-sale-from')).toHaveValue('650000');
    await expect.poll(() => getPropertySourceTileUrl(page)).toContain(
      'salePriceFrom=650000',
    );
    await expect.poll(() => getPropertySourceTileUrl(page)).toContain(
      'marketState=for-sale',
    );
  });
});
