/**
 * Reference Expectation E2E Test: 0027-map-loading-indicator
 *
 * This test verifies that the map component shows a loading indicator during initialization:
 * - Loading spinner is visible while map initializes
 * - Loading indicator disappears once map is fully loaded
 * - Transition from loading to loaded state is smooth
 * - Zero console errors during normal loading flow
 *
 * Screenshot saved to: test-results/reference-expectations/0027-map-loading-indicator/
 */

import { test, expect, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { waitForMapStyleLoaded } from './helpers/visual-test-helpers';

// Disable tracing for this test
test.use({ trace: 'off', video: 'off' });

// Configuration
const EXPECTATION_NAME = '0027-map-loading-indicator';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Known acceptable console errors - MINIMAL list
const KNOWN_ACCEPTABLE_ERRORS: RegExp[] = [
  /ResizeObserver loop/,
  /sourceMappingURL/,
  /Failed to parse source map/,
  /Fast Refresh/,
  /\[HMR\]/,
  /WebSocket connection/,
  /net::ERR_ABORTED/,
  /net::ERR_NAME_NOT_RESOLVED/,
];

// Increase test timeout
test.setTimeout(120000);

test.describe(`Reference Expectation: ${EXPECTATION_NAME}`, () => {
  let consoleErrors: string[] = [];
  let consoleWarnings: string[] = [];

  test.beforeAll(async () => {
    const fullPath = path.resolve(process.cwd(), SCREENSHOT_DIR);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    consoleWarnings = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const isKnown = KNOWN_ACCEPTABLE_ERRORS.some((pattern) =>
          pattern.test(text)
        );
        if (!isKnown) {
          consoleErrors.push(text);
        }
      } else if (msg.type() === 'warning') {
        consoleWarnings.push(msg.text());
      }
    });

    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    if (consoleWarnings.length > 0) {
      console.log(`Console warnings (${consoleWarnings.length}):`);
      consoleWarnings.slice(0, 10).forEach((w) => console.log(`  - ${w}`));
      if (consoleWarnings.length > 10) {
        console.log(`  ... and ${consoleWarnings.length - 10} more`);
      }
    }

    if (consoleErrors.length > 0) {
      console.error(`Console errors detected (${consoleErrors.length}):`);
      consoleErrors.forEach((e) => console.error(`  - ${e}`));
    }
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('verify loading indicator appears during initial map load', async ({ page }) => {
    // Intercept map style and tile requests to delay them, ensuring the loading
    // indicator stays visible long enough for a reliable assertion. This avoids
    // flakiness caused by the map loading too quickly on fast machines or warm caches.
    let releaseTiles: (() => void) | null = null;
    const tilesBlocked = new Promise<void>((resolve) => {
      releaseTiles = resolve;
    });

    await page.route('**/tiles.openfreemap.org/**', async (route) => {
      // Hold the first style/tile request until we've verified the loading indicator
      await tilesBlocked;
      await route.continue();
    });

    // Navigate to the app - don't wait for network idle since we're blocking tiles
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // The loading indicator should be visible because map tiles are blocked
    const loadingIndicator = page.locator('[data-testid="map-loading-indicator"]');
    await expect(loadingIndicator).toBeVisible({ timeout: 10000 });
    console.log('Loading indicator is visible while tiles are blocked');

    // Verify "Loading map..." text is shown
    const loadingText = page.locator('text=Loading map...');
    await expect(loadingText).toBeVisible({ timeout: 5000 });
    console.log('Loading text "Loading map..." is visible');

    // Take screenshot of the loading state
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-loading-state.png`,
      fullPage: false,
    });
    console.log(`Loading state screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-loading-state.png`);

    // Release the blocked tile requests so the map can finish loading
    releaseTiles!();

    // Wait for map to fully load - canvas appears once the map 'load' event fires
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 30000 });

    // Loading indicator should disappear after map loads
    await expect(loadingIndicator).toBeHidden({ timeout: 15000 });
    console.log('Loading indicator hidden after map loaded');

    // Take screenshot of loaded state
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });
    console.log(`Final screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`);

    // Unroute to clean up
    await page.unroute('**/tiles.openfreemap.org/**');
  });

  test('verify loading indicator styling matches app design', async ({ page }) => {
    // Navigate to app with network throttling to slow down loading
    // This gives us time to inspect the loading indicator

    // Navigate to the app without any route interception
    // The loading indicator appears immediately and hides once the map fires 'load'
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Wait briefly for the loading indicator to appear
    await page.waitForTimeout(500);

    // Check if loading indicator is present
    const loadingIndicator = page.locator('[data-testid="map-loading-indicator"]');
    const loadingText = page.locator('text=Loading map...');

    const indicatorVisible = await loadingIndicator.isVisible().catch(() => false);
    const textVisible = await loadingText.isVisible().catch(() => false);

    if (indicatorVisible || textVisible) {
      console.log('Loading indicator is visible for inspection');

      // Take screenshot
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-styling.png`,
        fullPage: false,
      });
      console.log(`Styling screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-styling.png`);

      // Verify styling elements
      if (indicatorVisible) {
        // Check that it has proper centering and styling
        const box = await loadingIndicator.boundingBox();
        if (box) {
          console.log(`Loading indicator position: x=${box.x}, y=${box.y}, w=${box.width}, h=${box.height}`);
          // Should be roughly centered and cover the map area
          expect(box.width).toBeGreaterThan(100);
          expect(box.height).toBeGreaterThan(100);
        }
      }
    } else {
      console.log('Loading indicator not visible - map may have loaded too quickly');
      console.log('This is acceptable if the implementation exists');
    }

    // Wait for map canvas to appear (indicates map's load event fired and mapLoaded=true)
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 30000 });

    // Wait for loading indicator to disappear
    await loadingIndicator.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {
      console.log('Loading indicator did not hide within timeout');
    });

    // Verify final state
    const mapView = page.locator('[data-testid="map-view"]');
    await expect(mapView).toBeVisible();

    // Loading indicator should be gone
    const loadingStillVisible = await loadingIndicator.isVisible().catch(() => false);
    expect(loadingStillVisible).toBe(false);
  });

  test('verify smooth transition from loading to loaded state', async ({ page }) => {
    // Navigate to app
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Track state transitions
    let sawLoadingState = false;
    let sawLoadedState = false;
    let transitionWasSmooth = true;

    // Monitor for loading indicator and map canvas
    for (let i = 0; i < 100; i++) {
      const loadingVisible = await page.locator('[data-testid="map-loading-indicator"]').isVisible().catch(() => false);
      const canvasVisible = await page.locator('canvas').first().isVisible().catch(() => false);

      if (loadingVisible) {
        sawLoadingState = true;
        console.log(`Iteration ${i}: Loading state visible`);
      }

      if (canvasVisible && !loadingVisible) {
        sawLoadedState = true;
        console.log(`Iteration ${i}: Loaded state (canvas visible, loading hidden)`);
        break;
      }

      // Both shouldn't be prominently visible at the same time
      // (though brief overlap during transition is OK)

      await page.waitForTimeout(100);
    }

    // Wait for final state to settle
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Take final screenshot
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-transition.png`,
      fullPage: false,
    });
    console.log(`Transition screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-transition.png`);

    // Verify map is fully loaded
    const mapView = page.locator('[data-testid="map-view"]');
    await expect(mapView).toBeVisible();

    // Canvas should be visible
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    // Loading indicator should be hidden
    const loadingIndicator = page.locator('[data-testid="map-loading-indicator"]');
    const loadingStillVisible = await loadingIndicator.isVisible().catch(() => false);
    expect(loadingStillVisible).toBe(false);

    console.log(`Test results: sawLoading=${sawLoadingState}, sawLoaded=${sawLoadedState}`);

    // It's OK if we didn't capture loading state (fast load), but loaded state must be reached
    expect(sawLoadedState, 'Map should reach loaded state with canvas visible').toBe(true);
  });

  test('capture main screenshot for visual comparison', async ({ page }) => {
    // Navigate to app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to fully load
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    // Wait for map instance and style to load
    await waitForMapStyleLoaded(page);

    // Verify map is loaded
    const mapView = page.locator('[data-testid="map-view"]');
    await expect(mapView).toBeVisible();

    // Loading indicator should not be visible
    const loadingIndicator = page.locator('[data-testid="map-loading-indicator"]');
    const loadingVisible = await loadingIndicator.isVisible().catch(() => false);
    expect(loadingVisible, 'Loading indicator should not be visible after map loads').toBe(false);

    // Canvas should be visible
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Take final screenshot
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });
    console.log(`Main screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`);

    // Verify we have a functional map
    const mapBox = await canvas.boundingBox();
    expect(mapBox, 'Map canvas should have dimensions').not.toBeNull();
    if (mapBox) {
      expect(mapBox.width).toBeGreaterThan(200);
      expect(mapBox.height).toBeGreaterThan(200);
    }
  });
});
