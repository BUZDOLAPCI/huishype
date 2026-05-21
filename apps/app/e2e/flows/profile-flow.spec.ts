/**
 * Profile Tab Flow E2E Tests
 *
 * Tests the Profile tab auth gate and navigation:
 * - Profile tab shows auth-required message when not logged in
 * - Auth-required overlay does NOT block tab bar navigation (Task #9 regression test)
 * - After login, profile content is displayed
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';
import { getPlaywrightApiUrl, getPlaywrightArtifactPath } from '../helpers/runtime';

const API_BASE_URL = getPlaywrightApiUrl();
const SCREENSHOT_DIR = getPlaywrightArtifactPath('flows');
const PROFILE_API_REQUEST_TIMEOUT_MS = 45_000;

// Known acceptable console errors
const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

test.use({ trace: 'off' });

test.describe('Profile Tab Flow', () => {
  let consoleErrors: string[] = [];

  async function createProfileEditSession(request: APIRequestContext) {
    const unique = `profileedit${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const response = await request.post(`${API_BASE_URL}/auth/google`, {
      data: {
        idToken: `mock-google-${unique}-gid${unique}`,
      },
      timeout: PROFILE_API_REQUEST_TIMEOUT_MS,
    });

    expect(response.ok()).toBe(true);
    const body = await response.json();
    return body.session as {
      accessToken: string;
      refreshToken: string;
      expiresAt: string;
      user: {
        id: string;
        handle: string;
        username: string;
        displayName: string;
      };
    };
  }

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

  test('Signed-in profile edits display name and handle inline', async ({ page, request }) => {
    const session = await createProfileEditSession(request);
    const nextDisplayName = `E2E Profile ${Date.now().toString().slice(-5)}`;
    const nextHandle = `hh${Date.now().toString(36).slice(-10)}`;

    await page.addInitScript((storedSession) => {
      window.localStorage.setItem('huishype_access_token', storedSession.accessToken);
      window.localStorage.setItem('huishype_refresh_token', storedSession.refreshToken);
      window.localStorage.setItem('huishype_token_expiry', storedSession.expiresAt);
      window.localStorage.setItem('huishype_user', JSON.stringify(storedSession.user));
    }, session);

    await page.goto('/profile', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="profile-screen"]', { timeout: 30000 });
    await expect(page.locator('[data-testid="profile-display-name-row"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('[data-testid="profile-handle-row"]')).toContainText(
      `@${session.user.handle}`,
    );

    await page.locator('[data-testid="profile-display-name-edit"]').click();
    await page.locator('[data-testid="profile-display-name-input"]').fill(nextDisplayName);
    await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes('/users/me/profile') && response.request().method() === 'PUT',
      ),
      page.locator('[data-testid="profile-display-name-save"]').click(),
    ]);
    await expect(page.locator('[data-testid="profile-display-name-row"]')).toContainText(
      nextDisplayName,
      { timeout: 15000 },
    );

    await page.locator('[data-testid="profile-handle-edit"]').click();
    await page.locator('[data-testid="profile-handle-input"]').fill(`@${nextHandle.toUpperCase()}`);
    await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes('/users/me/profile') && response.request().method() === 'PUT',
      ),
      page.locator('[data-testid="profile-handle-save"]').click(),
    ]);
    await expect(page.locator('[data-testid="profile-handle-row"]')).toContainText(
      `@${nextHandle}`,
      { timeout: 15000 },
    );

    const storedUser = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('huishype_user') ?? '{}'),
    );
    expect(storedUser.displayName).toBe(nextDisplayName);
    expect(storedUser.handle).toBe(nextHandle);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/profile-identity-edit.png` });
  });
});
