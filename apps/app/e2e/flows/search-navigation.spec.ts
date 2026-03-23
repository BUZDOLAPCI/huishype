/**
 * Search Navigation Flow E2E Tests
 *
 * Tests the search bar functionality on the map screen:
 * - Search bar visibility and interaction
 * - Geocoder (Photon) address autocomplete results
 * - Property navigation after selecting a result
 * - Graceful handling when no local property is found
 * - Clear/reset functionality
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { waitForMapStyleLoaded, waitForMapIdle } from '../visual/helpers/visual-test-helpers';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3100';

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

// Disable tracing to avoid artifact issues
test.use({ trace: 'off' });

/** Fetch a real property with known postal code from the API */
async function getTestPropertyWithPostalCode(request: APIRequestContext) {
  const response = await request.get(
    `${API_BASE_URL}/properties?limit=10&city=Eindhoven`
  );
  expect(response.ok()).toBe(true);
  const data = await response.json();
  expect(data.data.length).toBeGreaterThan(0);

  // Find a property with a postal code and house number
  const prop = data.data.find(
    (p: { postalCode: string | null; houseNumber: number | null }) =>
      p.postalCode && p.houseNumber
  );
  expect(prop).toBeTruthy();

  return {
    id: prop.id as string,
    address: prop.address as string,
    city: prop.city as string,
    postalCode: prop.postalCode as string,
    houseNumber: prop.houseNumber as number,
    houseNumberAddition: prop.houseNumberAddition as string | null,
  };
}

test.describe('Search Navigation Flow', () => {
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
      console.error(`Console errors detected (${consoleErrors.length}):`);
      consoleErrors.forEach((e) => console.error(`  - ${e}`));
    }
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('search bar is visible on map screen', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    // Search bar should be visible
    const searchInput = page.locator('[data-testid="search-bar-input"]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Should have placeholder
    await expect(searchInput).toHaveAttribute('placeholder', 'Search address...');
  });

  test('typing in search bar shows geocoder autocomplete results', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    const searchInput = page.locator('[data-testid="search-bar-input"]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Click to focus and wait for focus to take effect
    await searchInput.click();
    await searchInput.focus();

    // Type to trigger React Native Web onChangeText
    // Using pressSequentially ensures proper input events fire
    await searchInput.pressSequentially('Eindhoven Markt', { delay: 30 });

    // Wait for geocoder results to appear (debounce 300ms + network round trip)
    // Use 30s timeout — Photon geocoder can be slow under load
    const resultItem = page.locator('[data-testid="search-result-item"]');
    await expect(resultItem.first()).toBeVisible({ timeout: 30000 });

    // Should have at least 1 result
    const resultCount = await resultItem.count();
    expect(resultCount).toBeGreaterThan(0);
    console.log(`Geocoder returned ${resultCount} results for "Eindhoven Markt"`);
  });

  test('selecting search result navigates to property', async ({
    page,
    request,
  }) => {
    // Get a real property from our database to search for
    const testProp = await getTestPropertyWithPostalCode(request);
    console.log(
      `Testing with property: ${testProp.address} (${testProp.postalCode} ${testProp.houseNumber})`
    );

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    const searchInput = page.locator('[data-testid="search-bar-input"]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Search by street address + city (Photon geocoder doesn't support bare postal codes)
    const searchQuery = `${testProp.address}, ${testProp.city}`;
    console.log(`Searching for: "${searchQuery}"`);
    await searchInput.click();
    await searchInput.focus();
    await searchInput.pressSequentially(searchQuery, { delay: 30 });

    // Wait for geocoder autocomplete results
    // Use 30s timeout — Photon geocoder can be slow under load
    const resultItem = page.locator('[data-testid="search-result-item"]');
    await expect(resultItem.first()).toBeVisible({ timeout: 30000 });
    const matchingResult = resultItem.filter({ hasText: testProp.address }).first();

    // Record initial center before clicking the result
    const initialCenter = await page.evaluate(() => {
      const map = (window as unknown as { __mapInstance: { getCenter(): { lng: number; lat: number } } })
        .__mapInstance;
      const c = map?.getCenter?.();
      return c ? { lng: c.lng, lat: c.lat } : null;
    });
    expect(initialCenter).toBeTruthy();

    const resolveResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/properties/resolve?') &&
      response.request().method() === 'GET'
    );

    await matchingResult.click();

    const resolveResponse = await resolveResponsePromise;
    expect(resolveResponse.status()).toBe(200);
    const resolvedProperty = await resolveResponse.json() as { id: string };
    expect(resolvedProperty.id).toBe(testProp.id);

    // The click triggers an async flow: handleResultPress -> resolveProperty (HTTP) -> onPropertyResolved -> flyTo
    // Wait for the camera center to change (flyTo moves to the property location).
    // We check center change rather than zoom, because the initial zoom may already be
    // at or above the flyTo target (e.g. debug camera starts at z20.1, flyTo targets z17).
    await page.waitForFunction(
      (init: { lng: number; lat: number }) => {
        const map = (window as unknown as { __mapInstance: { getCenter(): { lng: number; lat: number } } }).__mapInstance;
        if (!map) return false;
        const center = map.getCenter();
        return (
          Math.abs(center.lng - init.lng) > 0.001 ||
          Math.abs(center.lat - init.lat) > 0.001
        );
      },
      initialCenter!,
      { timeout: 20000, polling: 200 }
    );

    // Now wait for the fly animation to finish (map stops moving)
    await page.waitForFunction(() => {
      const map = (window as unknown as { __mapInstance: { isMoving(): boolean } }).__mapInstance;
      return map && !map.isMoving();
    }, { timeout: 10000 });

    // Verify the camera is at a reasonable zoom after flyTo (target is z17)
    const zoom = await page.evaluate(() => {
      const map = (window as unknown as { __mapInstance: { getZoom(): number } })
        .__mapInstance;
      return map?.getZoom?.() ?? 0;
    });
    expect(zoom).toBeGreaterThanOrEqual(15);

    // Wait for tiles to load at new position
    await waitForMapIdle(page, 10000);

    const selectedMarker = page.locator('[data-testid="selected-marker"]');
    const previewCard = page.locator('[data-testid="group-preview-card"]');
    await expect(selectedMarker).toBeVisible({ timeout: 5000 });
    await expect(previewCard).toBeVisible({ timeout: 5000 });
    await expect(previewCard).toContainText(testProp.address);
  });

  test('search for non-existent local property handles gracefully', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    const searchInput = page.locator('[data-testid="search-bar-input"]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Search for a real Dutch address that likely exists in the geocoder
    // but might not be in our local Eindhoven-only database
    await searchInput.click();
    await searchInput.focus();
    await searchInput.pressSequentially('Amsterdam Damrak 1', { delay: 30 });

    // Wait for geocoder results
    // Use 30s timeout — Photon geocoder can be slow under load
    const resultItem = page.locator('[data-testid="search-result-item"]');
    await expect(resultItem.first()).toBeVisible({ timeout: 30000 });

    // Get initial map center before selecting
    const initialCenter = await page.evaluate(() => {
      const map = (
        window as unknown as {
          __mapInstance: { getCenter(): { lng: number; lat: number } };
        }
      ).__mapInstance;
      const center = map?.getCenter?.();
      return center ? { lng: center.lng, lat: center.lat } : null;
    });
    expect(initialCenter).toBeTruthy();

    await resultItem.first().click();

    // The click triggers an async flow: handleResultPress -> fallback onLocationResolved -> flyTo
    // We must wait for the center to actually change before checking isMoving,
    // otherwise isMoving() returns false because flyTo hasn't started yet.
    await page.waitForFunction(
      (init: { lng: number; lat: number }) => {
        const map = (
          window as unknown as {
            __mapInstance: { getCenter(): { lng: number; lat: number } };
          }
        ).__mapInstance;
        if (!map) return false;
        const center = map.getCenter();
        return (
          Math.abs(center.lng - init.lng) > 0.001 ||
          Math.abs(center.lat - init.lat) > 0.001
        );
      },
      initialCenter!,
      { timeout: 15000, polling: 200 }
    );

    // Now wait for fly animation to complete
    await page.waitForFunction(() => {
      const map = (window as unknown as { __mapInstance: { isMoving(): boolean } }).__mapInstance;
      return map && !map.isMoving();
    }, { timeout: 10000 });

    await expect(page.locator('[data-testid="selected-marker"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="group-preview-card"]')).toHaveCount(0);
  });

  test('clear search resets the search bar', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    const searchInput = page.locator('[data-testid="search-bar-input"]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Type something
    await searchInput.click();
    await searchInput.pressSequentially('Eindhoven', { delay: 30 });

    // Wait for results to appear
    await page.waitForTimeout(500);

    // Clear button should be visible
    const clearButton = page.locator('[data-testid="search-clear-button"]');
    await expect(clearButton).toBeVisible({ timeout: 5000 });

    // Click clear
    await clearButton.click();

    // Input should be empty
    await expect(searchInput).toHaveValue('');

    // Results should be hidden
    const resultsList = page.locator('[data-testid="search-results-list"]');
    await expect(resultsList).not.toBeVisible();

    // Clear button should be gone
    await expect(clearButton).not.toBeVisible();
  });
});
