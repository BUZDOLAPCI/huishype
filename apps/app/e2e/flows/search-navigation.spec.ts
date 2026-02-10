/**
 * Search Navigation Flow E2E Tests
 *
 * Tests the search bar functionality on the map screen:
 * - Search bar visibility and interaction
 * - PDOK address autocomplete results
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
  /AJAXError/,
  /\.pbf/,
  /tiles\.openfreemap\.org/,
  /pointerEvents is deprecated/,
  /GL Driver Message/,
  /Expected value to be of type/,
  /Failed to load resource.*\/sprites\//,
  /Failed to load resource.*api\.pdok\.nl/,
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

  test('typing in search bar shows PDOK autocomplete results', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    const searchInput = page.locator('[data-testid="search-bar-input"]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Click to focus, then type to trigger React Native Web onChangeText
    // Using pressSequentially ensures proper input events fire
    await searchInput.click();
    await searchInput.pressSequentially('Eindhoven Markt', { delay: 30 });

    // Wait for PDOK results to appear (debounce 300ms + network round trip)
    const resultItem = page.locator('[data-testid="search-result-item"]');
    await expect(resultItem.first()).toBeVisible({ timeout: 15000 });

    // Should have at least 1 result
    const resultCount = await resultItem.count();
    expect(resultCount).toBeGreaterThan(0);
    console.log(`PDOK returned ${resultCount} results for "Eindhoven Markt"`);
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

    // Search for the property by postal code and house number
    const searchQuery = `${testProp.postalCode} ${testProp.houseNumber}`;
    await searchInput.click();
    await searchInput.pressSequentially(searchQuery, { delay: 30 });

    // Wait for PDOK autocomplete results
    const resultItem = page.locator('[data-testid="search-result-item"]');
    await expect(resultItem.first()).toBeVisible({ timeout: 15000 });

    // Record initial zoom before clicking the result
    const initialZoom = await page.evaluate(() => {
      const map = (window as unknown as { __mapInstance: { getZoom(): number } })
        .__mapInstance;
      return map?.getZoom?.() ?? 0;
    });

    // Click the first result
    await resultItem.first().click();

    // The click triggers an async flow: handleResultPress -> resolveProperty (HTTP) -> onPropertyResolved -> flyTo
    // We need to wait for the zoom to actually change (flyTo target is zoom 17)
    await page.waitForFunction(
      (initZoom: number) => {
        const map = (window as unknown as { __mapInstance: { getZoom(): number } }).__mapInstance;
        return map && map.getZoom() > initZoom + 1;
      },
      initialZoom,
      { timeout: 15000, polling: 200 }
    );

    // Now wait for the fly animation to finish (map stops moving)
    await page.waitForFunction(() => {
      const map = (window as unknown as { __mapInstance: { isMoving(): boolean } }).__mapInstance;
      return map && !map.isMoving();
    }, { timeout: 10000 });

    // Verify the camera has moved (zoom should be ~17 after flyTo)
    const zoom = await page.evaluate(() => {
      const map = (window as unknown as { __mapInstance: { getZoom(): number } })
        .__mapInstance;
      return map?.getZoom?.() ?? 0;
    });
    expect(zoom).toBeGreaterThanOrEqual(15);

    // Wait for tiles to load at new position
    await waitForMapIdle(page, 10000);

    // Check if preview card or selected marker appeared
    // The marker appears once React state updates (selectedCoordinate + showPreview)
    // The popup requires property data to load via React Query
    const selectedMarker = page.locator('[data-testid="selected-marker"]');
    await expect(selectedMarker).toBeVisible({ timeout: 10000 });

    console.log('After search: marker visible, property resolved successfully');
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

    // Search for a real Dutch address that likely exists in PDOK
    // but might not be in our local Eindhoven-only database
    await searchInput.click();
    await searchInput.pressSequentially('Amsterdam Damrak 1', { delay: 30 });

    // Wait for PDOK results
    const resultItem = page.locator('[data-testid="search-result-item"]');
    await expect(resultItem.first()).toBeVisible({ timeout: 15000 });

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

    // Click the first result
    await resultItem.first().click();

    // The click triggers an async flow: handleResultPress -> resolveProperty (HTTP) ->
    // onLocationResolved (fallback for non-local) -> flyTo
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

    // No crash - graceful handling verified
    console.log(
      'Non-local search: camera moved gracefully without errors'
    );
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
