/**
 * TEMPLATE: Reference Expectation E2E Test
 *
 * Copy this file and rename to: reference-{expectation-name}.spec.ts
 * Replace all {EXPECTATION_NAME} placeholders with your expectation name.
 *
 * This template provides the structure for testing reference expectations
 * and capturing screenshots for visual verification.
 *
 * IMPORTANT: Tests MUST collect console errors and FAIL if any are detected.
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// Configuration - UPDATE THESE
const EXPECTATION_NAME = '{EXPECTATION_NAME}'; // e.g., 'map-visuals-close-up'
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

test.describe(`Reference Expectation: ${EXPECTATION_NAME}`, () => {
  // Console error collection
  let consoleErrors: string[] = [];
  let consoleWarnings: string[] = [];

  test.beforeAll(async () => {
    // Ensure screenshot directory exists
    const fullPath = path.resolve(process.cwd(), SCREENSHOT_DIR);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    // Reset console collections
    consoleErrors = [];
    consoleWarnings = [];

    // Collect console messages
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

    // Collect page errors (uncaught exceptions)
    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    // Log warnings for visibility (but don't fail)
    if (consoleWarnings.length > 0) {
      console.log(`Console warnings (${consoleWarnings.length}):`);
      consoleWarnings.forEach((w) => console.log(`  - ${w}`));
    }

    // FAIL if any console errors detected
    if (consoleErrors.length > 0) {
      console.error(`Console errors detected (${consoleErrors.length}):`);
      consoleErrors.forEach((e) => console.error(`  - ${e}`));
    }
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('capture current state for visual comparison', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // =================================================================
    // CUSTOMIZE: Add steps to reach the desired state for this expectation
    // =================================================================

    // Example: Wait for map to load
    // await page.waitForSelector('canvas', { timeout: 30000 });

    // Example: Zoom to specific level
    // await page.evaluate(() => {
    //   // Custom zoom logic
    // });

    // Example: Wait for specific element
    // await page.waitForSelector('[data-testid="expected-element"]');

    // Example: Interact with the page
    // await page.click('[data-testid="some-button"]');

    // =================================================================
    // WAIT: Ensure visual state is stable before screenshot
    // =================================================================

    // Wait for animations to complete
    await page.waitForTimeout(2000);

    // =================================================================
    // SCREENSHOT: Capture current state
    // =================================================================

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false, // Set to true if full page needed
    });

    // =================================================================
    // BASIC ASSERTIONS: Ensure page loaded correctly
    // =================================================================

    // Check no error states
    const errorState = page.locator('text=Failed to load');
    await expect(errorState).not.toBeVisible();

    // Check expected elements exist (customize)
    // await expect(page.locator('canvas')).toBeVisible();
  });

  // Optional: Add more specific tests
  test('verify specific visual elements', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // =================================================================
    // CUSTOMIZE: Add assertions for specific elements from expectation.md
    // =================================================================

    // Example assertions:
    // const mapCanvas = page.locator('canvas');
    // await expect(mapCanvas).toBeVisible();

    // const header = page.locator('text=HuisHype');
    // await expect(header).toBeVisible();
  });
});

/**
 * Helper: Take screenshot at specific coordinates/zoom
 * Useful for map-based expectations
 */
async function captureMapState(
  page: import('@playwright/test').Page,
  options: {
    center?: [number, number]; // [lng, lat]
    zoom?: number;
    pitch?: number;
    bearing?: number;
    waitMs?: number;
  } = {}
) {
  const { center, zoom, pitch, bearing, waitMs = 2000 } = options;

  await page.evaluate(
    ({ center, zoom, pitch, bearing }) => {
      // Access map instance if available
      const mapContainer = document.querySelector('[data-testid="map-view"]');
      if (mapContainer && (window as any).__mapInstance) {
        const map = (window as any).__mapInstance;
        if (center) map.setCenter(center);
        if (zoom !== undefined) map.setZoom(zoom);
        if (pitch !== undefined) map.setPitch(pitch);
        if (bearing !== undefined) map.setBearing(bearing);
      }
    },
    { center, zoom, pitch, bearing }
  );

  await page.waitForTimeout(waitMs);
}
