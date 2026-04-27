import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import {
  attachConsoleErrorCollector,
  expectNoConsoleErrors,
  NETWORK_ALLOWED_CONSOLE_PATTERNS,
} from '../helpers/console';

const SCREENSHOT_DIR = 'test-results/ui-backgrounds';

test.describe('UI backgrounds', () => {
  test.beforeAll(() => {
    fs.mkdirSync(path.resolve(process.cwd(), SCREENSHOT_DIR), { recursive: true });
  });

  test('uses the portrait background on narrow screens', async ({ page }) => {
    const consoleErrors = attachConsoleErrorCollector(
      page,
      NETWORK_ALLOWED_CONSOLE_PATTERNS,
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/saved');

    await expect(page.locator('[data-testid="screen-background-portrait"]').first())
      .toBeAttached();
    await expect(page.locator('[data-testid="screen-background-landscape"]'))
      .toHaveCount(0);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/ui-backgrounds-portrait.png`,
      fullPage: false,
    });

    expectNoConsoleErrors(consoleErrors);
  });

  test('renders the background on wide screens', async ({ page }) => {
    const consoleErrors = attachConsoleErrorCollector(
      page,
      NETWORK_ALLOWED_CONSOLE_PATTERNS,
    );

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/profile');

    await expect(page.locator('[data-testid^="screen-background-"]').first())
      .toBeAttached();

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/ui-backgrounds-wide.png`,
      fullPage: false,
    });

    expectNoConsoleErrors(consoleErrors);
  });

  test('uses the background while the map is loading', async ({ page }) => {
    const consoleErrors = attachConsoleErrorCollector(
      page,
      NETWORK_ALLOWED_CONSOLE_PATTERNS,
    );
    const delayedStyleRequest: { release: (() => void) | null } = {
      release: null,
    };

    await page.route(/\/tiles\/style\.json/, async (route) => {
      await new Promise<void>((resolve) => {
        delayedStyleRequest.release = resolve;
      });
      await route.continue().catch(() => {
        // The page may be torn down immediately after the loading-state
        // screenshot; at that point Playwright can already have handled it.
      });
    });

    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/');

      await expect(page.locator('[data-testid="map-loading-indicator"]'))
        .toBeVisible();
      await expect(page.locator('[data-testid^="screen-background-"]').first())
        .toBeAttached();

      await page.screenshot({
        path: `${SCREENSHOT_DIR}/ui-backgrounds-map-loading.png`,
        fullPage: false,
      });
    } finally {
      delayedStyleRequest.release?.();
      await page.unroute(/\/tiles\/style\.json/);
    }

    expectNoConsoleErrors(consoleErrors);
  });
});
