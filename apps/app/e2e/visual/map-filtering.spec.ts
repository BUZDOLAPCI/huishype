import { expect, test } from '@playwright/test';

import { waitForMapReady } from '../integration/helpers';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';

const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

test.describe('Map Filtering Visual', () => {
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
      `Expected zero console errors but found ${consoleErrors.length}`
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

  test('renders the optioned Activity and Following filter controls', async ({
    page,
  }, testInfo) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForMapReady(page, 60_000);

    await expect(page.getByTestId('map-filter-pill-activity')).toBeVisible();
    await expect(page.getByTestId('map-filter-pill-following')).toBeVisible();
    await expect(page.getByTestId('map-filter-pill-activity-social')).toHaveCount(0);
    await expect(page.getByTestId('map-filter-pill-activity-recent')).toHaveCount(0);
    await expect(page.getByTestId('map-filter-pill-social-following')).toHaveCount(0);

    await page.getByTestId('map-filter-pill-activity-arrow').click();
    await expect(page.getByTestId('map-filter-panel-activity')).toBeVisible();
    await expect(page.getByTestId('map-filter-option-activity-today')).toHaveText('Today');
    await expect(page.getByTestId('map-filter-option-activity-10d')).toHaveText('10 Days');
    await expect(page.getByTestId('map-filter-option-activity-30d')).toHaveText('30 Days');
    await expect(page.getByTestId('map-filter-option-activity-all-time')).toHaveText('All Time');

    await page.screenshot({
      path: testInfo.outputPath('map-filtering-activity-options.png'),
      fullPage: false,
    });

    await page.getByTestId('map-filter-panel-activity-close').click();
    await page.getByTestId('map-filter-pill-following-arrow').click();
    await expect(page.getByTestId('map-filter-panel-following')).toBeVisible();
    await expect(page.getByTestId('map-filter-option-following-all-time')).toHaveText('All Time');

    await page.screenshot({
      path: testInfo.outputPath('map-filtering-following-options.png'),
      fullPage: false,
    });
  });
});
