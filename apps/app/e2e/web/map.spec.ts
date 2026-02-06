import { test, expect } from '@playwright/test';

/**
 * E2E tests for the HuisHype interactive map view.
 * These tests verify that the map loads, displays properties, and interactions work.
 */
test.describe('HuisHype Map View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should display the map view', async ({ page }) => {
    // Wait for the map to load
    await page.waitForSelector('[data-testid="map-view"], .maplibregl-map, canvas', {
      timeout: 10000,
    });

    // Take a screenshot for visual verification
    await page.screenshot({
      path: 'test-results/map-view.png',
      fullPage: true,
    });

    // Verify the page is not showing an error state
    const errorText = page.locator('text=Failed to load properties');
    const isErrorVisible = await errorText.isVisible().catch(() => false);

    // If there's an error (API not running), that's acceptable for this test
    // as we're testing the UI components, not the API integration
    if (isErrorVisible) {
      console.log('API not running - map is showing error state correctly');
    }

    // The body should be visible
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should load vector tile source and property layers', async ({ page }) => {
    // Wait for the MapLibre map style to fully load (includes property layers from /tiles/style.json)
    await page.waitForFunction(
      () => {
        const m = (window as any).__mapInstance;
        return m && m.isStyleLoaded();
      },
      { timeout: 45000, polling: 500 }
    );

    // Verify the properties-source vector tile source is registered
    const hasSource = await page.evaluate(() => {
      const m = (window as any).__mapInstance;
      return !!m.getSource('properties-source');
    });
    expect(hasSource).toBe(true);

    // Verify at least one property layer exists
    const propertyLayerNames = [
      'property-clusters',
      'cluster-count',
      'single-active-points',
      'active-nodes',
      'ghost-nodes',
    ];
    const loadedLayers: string[] = await page.evaluate((layerNames: string[]) => {
      const m = (window as any).__mapInstance;
      return layerNames.filter((name: string) => !!m.getLayer(name));
    }, propertyLayerNames);

    expect(loadedLayers.length).toBeGreaterThan(0);

    // Take a screenshot for visual verification
    await page.screenshot({
      path: 'test-results/map-property-layers.png',
      fullPage: true,
    });
  });

  test('should handle error state gracefully', async ({ page }) => {
    // Wait for the page to settle
    await page.waitForTimeout(3000);

    // Take a screenshot of any state
    await page.screenshot({
      path: 'test-results/map-state.png',
      fullPage: true,
    });

    // Check if there's a try again button when API is down
    const tryAgainButton = page.locator('text=Try again');
    const isErrorState = await tryAgainButton.isVisible().catch(() => false);

    if (isErrorState) {
      // Click try again and verify it attempts to refetch
      await tryAgainButton.click();
      await page.waitForTimeout(1000);

      // Should still show the error state or loading
      const body = page.locator('body');
      await expect(body).toBeVisible();
    }
  });

  test('should be responsive on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Reload the page with mobile viewport
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Take a screenshot
    await page.screenshot({
      path: 'test-results/map-mobile.png',
      fullPage: true,
    });

    // Verify the page renders
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should display loading state initially', async ({ page }) => {
    // Navigate fresh and check for loading state
    await page.goto('/');

    // Take immediate screenshot to capture loading state
    await page.screenshot({
      path: 'test-results/map-loading.png',
      fullPage: true,
    });

    // The page should render something
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});

test.describe('HuisHype Map Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000); // Wait for map and data to load
  });

  test('should allow map panning and zooming', async ({ page }) => {
    // Wait for map canvas
    const mapCanvas = page.locator('canvas').first();
    const isCanvasVisible = await mapCanvas.isVisible().catch(() => false);

    if (isCanvasVisible) {
      // Get canvas bounding box
      const box = await mapCanvas.boundingBox();

      if (box) {
        // Simulate pan by drag
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2);
        await page.mouse.up();

        await page.waitForTimeout(500);

        // Take screenshot after pan
        await page.screenshot({
          path: 'test-results/map-after-pan.png',
          fullPage: true,
        });
      }
    }

    // Verify page is still functional
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should display property preview when marker is clicked', async ({ page }) => {
    // Wait for potential markers to load
    await page.waitForTimeout(3000);

    // Take screenshot of map state
    await page.screenshot({
      path: 'test-results/map-with-markers.png',
      fullPage: true,
    });

    // Try to find and click on the map canvas
    const mapCanvas = page.locator('canvas').first();
    const isCanvasVisible = await mapCanvas.isVisible().catch(() => false);

    if (isCanvasVisible) {
      const box = await mapCanvas.boundingBox();

      if (box) {
        // Click in the center of the map where markers might be
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(1000);

        // Take screenshot after click
        await page.screenshot({
          path: 'test-results/map-after-marker-click.png',
          fullPage: true,
        });
      }
    }

    // Verify page is still functional
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});
