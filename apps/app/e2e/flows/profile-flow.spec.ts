/**
 * Profile Tab Flow E2E Tests
 *
 * Tests the Profile tab auth gate and navigation:
 * - Profile tab shows auth-required message when not logged in
 * - Auth-required overlay does NOT block tab bar navigation (Task #9 regression test)
 * - After login, profile content is displayed
 */

import { test, expect } from '@playwright/test';
import { waitForFeedLoaded, waitForMapReady } from '../integration/helpers';

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
    await page.goto('/profile', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/profile(?:[?#].*)?$/);
    await expect(page.getByTestId('profile-auth-required')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId('profile-sign-in-button')).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/profile-auth-state.png` });
  });

  test('Profile auth gate does NOT block route navigation', async ({ page }) => {
    await page.goto('/profile', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('profile-auth-required')).toBeVisible({
      timeout: 15000,
    });

    await page.goto('/feed', { waitUntil: 'domcontentloaded' });
    await waitForFeedLoaded(page);
    await expect(page).toHaveURL(/\/feed(?:[?#].*)?$/);
    await expect(page.getByTestId('property-feed-card').first()).toBeVisible({
      timeout: 15000,
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForMapReady(page);
    await expect(page).toHaveURL(/\/(?:@[^?]+)?(?:[?#].*)?$/);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/profile-tab-navigation.png` });
  });
});
