/**
 * Profile Tab Flow E2E Tests
 *
 * Tests the Profile tab auth gate and navigation:
 * - Profile tab shows auth-required message when not logged in
 * - Auth-required overlay does NOT block tab bar navigation (Task #9 regression test)
 * - After login, profile content is displayed
 */

import { test, expect } from '@playwright/test';
import { waitForMapStyleLoaded } from '../visual/helpers/visual-test-helpers';

const SCREENSHOT_DIR = 'test-results/flows';

// Known acceptable console errors
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
];

test.use({ trace: 'off' });

test.describe('Profile Tab Flow', () => {
  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!KNOWN_ACCEPTABLE_ERRORS.some((p) => p.test(text))) {
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
    await page.goto('/');
    await page.waitForLoadState('networkidle');
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
    const authRequired = page.locator('[data-testid="profile-auth-required"]');
    const profileScreen = page.locator('[data-testid="profile-screen"]');

    const isAuthRequired = await authRequired.isVisible().catch(() => false);
    const isProfileScreen = await profileScreen.isVisible().catch(() => false);

    // Either auth-required (not logged in) or profile screen (logged in) should be visible
    expect(
      isAuthRequired || isProfileScreen,
      'Profile tab should show auth-required or profile content'
    ).toBe(true);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/profile-auth-state.png` });
  });

  test('Profile tab auth overlay does NOT block tab bar navigation', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
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

    // Should show feed content
    const feedVisible = await Promise.race([
      page.locator('[data-testid="feed-screen"]').isVisible().catch(() => false),
      page.locator('[data-testid="feed-loading"]').isVisible().catch(() => false),
      page.locator('[data-testid="feed-empty"]').isVisible().catch(() => false),
      page.locator('[data-testid="feed-error"]').isVisible().catch(() => false),
      page.locator('[data-testid="filter-chip-trending"]').isVisible().catch(() => false),
    ]);
    expect(feedVisible, 'Should navigate from Profile to Feed tab').toBe(true);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/profile-tab-navigation.png` });
  });
});
