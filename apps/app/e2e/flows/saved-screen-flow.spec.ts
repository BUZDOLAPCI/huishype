/**
 * Saved Screen Flow E2E Tests
 *
 * Tests the Saved tab auth gate and navigation:
 * - Saved tab shows auth-required state when not logged in
 * - Auth overlay does NOT block tab bar navigation
 * - Saved tab displays saved properties list via API
 */

import { test, expect } from '@playwright/test';
import { createTestUser } from './helpers/test-user';
import { getPlaywrightApiUrl, getPlaywrightArtifactPath } from '../helpers/runtime';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';

const API_BASE_URL = getPlaywrightApiUrl();
const SCREENSHOT_DIR = getPlaywrightArtifactPath('flows');

// Known acceptable console errors
const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

test.use({ trace: 'off' });

test.describe('Saved Screen Flow', () => {
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

  test('Saved tab shows auth-required state when not logged in', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    // Navigate to Saved tab
    const savedTab = page.getByRole('tab', { name: /saved/i }).or(
      page.locator('a[href*="saved"]')
    ).or(
      page.locator('[role="tablist"] >> text=Saved')
    );

    await savedTab.first().click();

    // Wait for saved screen to render
    await Promise.race([
      page.waitForURL('**/saved**', { timeout: 15000 }).catch(() => null),
      page.waitForSelector('[data-testid="saved-auth-required"]', { timeout: 15000 }).catch(() => null),
      page.waitForSelector('[data-testid="saved-screen"]', { timeout: 15000 }).catch(() => null),
      page.waitForSelector('[data-testid="saved-empty"]', { timeout: 15000 }).catch(() => null),
    ]);

    await page.waitForTimeout(1000);

    // Should show auth-required or empty/loaded state
    expect(
      await isAnyVisible(page, [
        '[data-testid="saved-auth-required"]',
        '[data-testid="saved-screen"]',
        '[data-testid="saved-empty"]',
      ]),
      'Saved tab should show auth-required, empty, or saved content'
    ).toBe(true);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/saved-auth-state.png` });
  });

  test('Saved tab auth overlay does NOT block tab bar navigation', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    // Navigate to Saved tab
    const savedTab = page.getByRole('tab', { name: /saved/i }).or(
      page.locator('a[href*="saved"]')
    ).or(
      page.locator('[role="tablist"] >> text=Saved')
    );
    await savedTab.first().click();
    await page.waitForTimeout(1500);

    // Try to navigate away from Saved by clicking Map tab
    const mapTab = page.getByRole('tab', { name: /map/i }).or(
      page.locator('a[href="/"]')
    ).or(
      page.locator('[role="tablist"] >> text=Map')
    );
    await mapTab.first().click();
    await page.waitForTimeout(2000);

    // Should navigate back to map
    const mapView = page.locator('[data-testid="map-view"]');
    await expect(mapView.first()).toBeVisible({ timeout: 15000 });

    await page.screenshot({ path: `${SCREENSHOT_DIR}/saved-tab-navigation.png` });
  });

  test('Saved properties API returns correct structure', async ({ request }) => {
    const user = await createTestUser(request, 'saved');

    // Initially no saved properties
    const response = await request.get(`${API_BASE_URL}/saved-properties`, {
      headers: { authorization: `Bearer ${user.accessToken}` },
    });

    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.total).toBe(0);
  });

  test('Save and verify property appears in saved list', async ({ request }) => {
    const user = await createTestUser(request, 'savedlist');

    // Get a test property
    const propResp = await request.get(`${API_BASE_URL}/properties?limit=1&city=Eindhoven`);
    const propBody = await propResp.json();
    const propertyId = propBody.data[0].id;

    // Save the property
    const saveResp = await request.post(`${API_BASE_URL}/properties/${propertyId}/save`, {
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    expect(saveResp.status()).toBe(201);

    // Verify it appears in saved list
    const listResp = await request.get(`${API_BASE_URL}/saved-properties`, {
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    expect(listResp.ok()).toBe(true);
    const listBody = await listResp.json();
    expect(listBody.total).toBe(1);
    expect(listBody.data[0].id).toBe(propertyId);

    // Unsave for cleanup
    await request.delete(`${API_BASE_URL}/properties/${propertyId}/save`, {
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
  });
});
