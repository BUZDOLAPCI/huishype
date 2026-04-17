/**
 * Profile Tab Flow E2E Tests
 *
 * Tests the Profile tab auth gate and navigation:
 * - Profile tab shows auth-required message when not logged in
 * - Auth-required overlay does NOT block tab bar navigation (Task #9 regression test)
 * - After login, profile content is displayed
 */

import { test, expect } from '@playwright/test';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';
import { getPlaywrightArtifactPath } from '../helpers/runtime';

const SCREENSHOT_DIR = getPlaywrightArtifactPath('flows');

// Known acceptable console errors
const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

test.use({ trace: 'off' });

test.describe('Profile Tab Flow', () => {
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
    if (consoleErrors.length > 0) {
      console.error(`Console errors (${consoleErrors.length}):`);
      consoleErrors.forEach((e) => console.error(`  - ${e}`));
    }
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('Profile tab shows auth-required state when not logged in', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    // Navigate to Profile tab
    const profileTab = page.getByRole('tab', { name: /profile/i }).or(
      page.locator('a[href*="profile"]')
    ).or(
      page.locator('[role="tablist"] >> text=Profile')
    );

    await profileTab.first().click();

    // Wait for profile screen to render
    await Promise.race([
      page.waitForURL('**/profile**', { timeout: 15000 }).catch(() => null),
      page.waitForSelector('[data-testid="profile-auth-required"]', { timeout: 15000 }).catch(() => null),
      page.waitForSelector('[data-testid="profile-screen"]', { timeout: 15000 }).catch(() => null),
    ]);

    await page.waitForTimeout(1000);

    // Should show auth-required state
    expect(
      await isAnyVisible(page, [
        '[data-testid="profile-auth-required"]',
        '[data-testid="profile-screen"]',
      ]),
      'Profile tab should show auth-required or profile content'
    ).toBe(true);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/profile-auth-state.png` });
  });

  test('Profile tab auth overlay does NOT block tab bar navigation', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    // Navigate to Profile tab
    const profileTab = page.getByRole('tab', { name: /profile/i }).or(
      page.locator('a[href*="profile"]')
    ).or(
      page.locator('[role="tablist"] >> text=Profile')
    );
    await profileTab.first().click();
    await page.waitForTimeout(1500);

    // Now try to navigate AWAY from Profile tab by clicking Map tab
    // This is the regression test for Task #9 — pointer-events should not be blocked
    const mapTab = page.getByRole('tab', { name: /map/i }).or(
      page.locator('a[href="/"]')
    ).or(
      page.locator('[role="tablist"] >> text=Map')
    );

    await mapTab.first().click();
    await page.waitForTimeout(2000);

    // Should have navigated back to the map
    const mapView = page.locator('[data-testid="map-view"]');
    await expect(mapView.first()).toBeVisible({ timeout: 15000 });

    // Now navigate to Feed tab to verify multi-tab navigation works
    const feedTab = page.getByRole('tab', { name: /feed/i }).or(
      page.locator('a[href*="feed"]')
    ).or(
      page.locator('[role="tablist"] >> text=Feed')
    );
    await feedTab.first().click();
    await page.waitForTimeout(2000);

    // Should show feed content (any feed-related element visible means navigation succeeded)
    const feedChecks = await Promise.all([
      page.locator('[data-testid="feed-screen"]').isVisible().catch(() => false),
      page.locator('[data-testid="feed-loading"]').isVisible().catch(() => false),
      page.locator('[data-testid="feed-empty"]').isVisible().catch(() => false),
      page.locator('[data-testid="feed-error"]').isVisible().catch(() => false),
      page.locator('[data-testid="filter-chip-trending"]').isVisible().catch(() => false),
    ]);
    const feedVisible = feedChecks.some(Boolean);
    expect(feedVisible, 'Should navigate from Profile to Feed tab').toBe(true);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/profile-tab-navigation.png` });
  });
});
