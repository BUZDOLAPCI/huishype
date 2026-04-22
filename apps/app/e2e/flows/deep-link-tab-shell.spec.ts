import { test, expect } from '@playwright/test';
import { waitForMapStyleLoaded } from '../visual/helpers/visual-test-helpers';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';
import { getPlaywrightArtifactPath } from '../helpers/runtime';

const SCREENSHOT_DIR = getPlaywrightArtifactPath('flows');

const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

test.use({ trace: 'off' });

test.describe('Deep Link Tab Shell', () => {
  let consoleErrors: string[] = [];

  async function isAnyVisible(
    page: import('@playwright/test').Page,
    selectors: string[],
  ): Promise<boolean> {
    const visibilities = await Promise.all(
      selectors.map((selector) => page.locator(selector).first().isVisible().catch(() => false)),
    );
    return visibilities.some(Boolean);
  }

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!isAllowedConsoleMessage(text, KNOWN_ACCEPTABLE_ERRORS)) {
          consoleErrors.push(text);
        }
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

  const cases = [
    {
      name: 'coordinate urls keep the tab shell visible',
      url: '/@51.4405702,5.4707418,13z',
      screenshot: `${SCREENSHOT_DIR}/deep-link-coordinate-tab-shell.png`,
    },
    {
      name: 'address urls keep the tab shell visible',
      url: '/map/eindhoven/5651ha/beeldbuisring/41',
      screenshot: `${SCREENSHOT_DIR}/deep-link-address-tab-shell.png`,
    },
  ] as const;

  for (const testCase of cases) {
    test(testCase.name, async ({ page }) => {
      await page.goto(testCase.url, { waitUntil: 'domcontentloaded' });

      await expect(page.locator('[data-testid="map-view"]').first()).toBeVisible({
        timeout: 30000,
      });
      await waitForMapStyleLoaded(page);

      const tabBar = page.locator('[data-testid="custom-tab-bar"]');
      await expect(tabBar).toBeVisible({ timeout: 15000 });

      const mapTab = page.locator('[data-testid="tab-index"]');
      await expect(mapTab).toBeVisible({ timeout: 15000 });

      const feedTab = page.getByRole('tab', { name: /feed/i }).or(
        page.locator('a[href*="feed"]')
      );
      await feedTab.first().click();

      await expect(page).toHaveURL(/\/feed(?:[/?#]|$)/, { timeout: 15000 });

      expect(
        await isAnyVisible(page, [
          '[data-testid="feed-screen"]',
          '[data-testid="feed-loading"]',
          '[data-testid="feed-empty"]',
          '[data-testid="feed-error"]',
          '[data-testid="filter-chip-trending"]',
        ]),
        'Expected tab navigation to work after loading a deep link'
      ).toBe(true);

      await page.screenshot({ path: testCase.screenshot });
    });
  }
});
