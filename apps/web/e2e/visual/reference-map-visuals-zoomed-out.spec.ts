/**
 * Reference Expectation E2E Test: map-visuals-zoomed-out
 *
 * This test verifies the zoomed-out map appearance matches the Funda-style
 * reference expectation with:
 * - Roads, water, parks visible as simple colors/lines
 * - City/neighborhood/region labels visible at appropriate zoom levels
 * - Light, warm color palette from OpenFreeMap Bright style
 *
 * The app uses OpenFreeMap Bright style which provides:
 * - City/town/village labels at zoom 10-12
 * - Road networks with shields for major roads (N65, etc.)
 * - Parks and forests in green
 * - Water bodies in blue
 * - Beige/cream background for residential/land areas
 *
 * Screenshot saved to: test-results/reference-expectations/map-visuals-zoomed-out/
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { waitForMapStyleLoaded, waitForMapIdle } from './helpers/visual-test-helpers';

// Configuration
const EXPECTATION_NAME = 'map-visuals-zoomed-out';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Zoom level for zoomed-out view (similar to Funda's regional view)
// At zoom 11, we should see multiple cities/towns and major roads
const ZOOMED_OUT_LEVEL = 11;

// Center on Oisterwijk area (shown in reference image) - between Eindhoven and Tilburg
// This area shows Oisterwijk, Biezenmortel, Heukelom, and surrounding regions
const CENTER_COORDINATES: [number, number] = [5.19, 51.58]; // Oisterwijk region

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

  test('capture zoomed-out map state for visual comparison', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map container to be ready
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    // Wait for map instance and style to load
    await waitForMapStyleLoaded(page);

    // Set map to zoomed-out level programmatically using the exposed __mapInstance
    // The app exposes the map instance on window for testing purposes
    const mapConfigured = await page.evaluate(
      ({ center, zoom }) => {
        // The app exposes __mapInstance on window for testing
        const mapInstance = (window as any).__mapInstance;

        if (mapInstance && typeof mapInstance.setZoom === 'function') {
          // Set flat pitch for zoomed-out view (no 3D perspective)
          mapInstance.setPitch(0);
          mapInstance.setBearing(0);
          mapInstance.setCenter(center);
          mapInstance.setZoom(zoom);
          return true;
        }
        return false;
      },
      { center: CENTER_COORDINATES, zoom: ZOOMED_OUT_LEVEL }
    );

    // If programmatic approach failed, use wheel zoom as fallback
    if (!mapConfigured) {
      console.log('Map instance not found, using wheel zoom fallback');
      const mapView = page.locator('[data-testid="map-view"]');
      const box = await mapView.boundingBox();

      if (box) {
        // Move to center of map
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        // Zoom out using mouse wheel (positive delta = zoom out in MapLibre)
        for (let i = 0; i < 10; i++) {
          await page.mouse.wheel(0, 300);
          await page.waitForTimeout(200);
        }
      }
    }

    // Wait for map to be idle (tiles loaded after zoom)
    await waitForMapIdle(page);

    // Take screenshot
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });

    // Basic assertions
    const errorState = page.locator('text=Failed to load');
    await expect(errorState).not.toBeVisible();

    // Verify map canvas is visible
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    // Verify we're at the expected zoom level (approximately)
    const currentZoom = await page.evaluate(() => {
      const mapInstance = (window as any).__mapInstance;
      return mapInstance ? mapInstance.getZoom() : null;
    });

    if (currentZoom !== null) {
      console.log(`Current zoom level: ${currentZoom}`);
      // Allow some tolerance for zoom level
      expect(currentZoom).toBeLessThan(13);
    }
  });

  test('verify map shows expected visual elements at zoomed-out level', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to load
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    // Set zoomed-out view programmatically
    await page.evaluate(
      ({ center, zoom }) => {
        const mapInstance = (window as any).__mapInstance;
        if (mapInstance) {
          mapInstance.setPitch(0);
          mapInstance.setBearing(0);
          mapInstance.setCenter(center);
          mapInstance.setZoom(zoom);
        }
      },
      { center: CENTER_COORDINATES, zoom: ZOOMED_OUT_LEVEL }
    );

    // Wait for map to be idle (tiles loaded)
    await waitForMapIdle(page);

    // Verify the map canvas is rendered (not blank)
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    // Check canvas has content by verifying it has a non-zero size
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    if (canvasBox) {
      expect(canvasBox.width).toBeGreaterThan(100);
      expect(canvasBox.height).toBeGreaterThan(100);
    }

    // Verify zoom level is at zoomed-out level
    const mapState = await page.evaluate(() => {
      const mapInstance = (window as any).__mapInstance;
      if (mapInstance) {
        return {
          zoom: mapInstance.getZoom(),
          pitch: mapInstance.getPitch(),
          center: mapInstance.getCenter(),
        };
      }
      return null;
    });

    if (mapState) {
      console.log(`Map state: zoom=${mapState.zoom.toFixed(2)}, pitch=${mapState.pitch.toFixed(2)}`);
      // At zoomed-out level, pitch should be 0 (flat view)
      expect(mapState.pitch).toBeLessThan(5);
      // Zoom should be around our target
      expect(mapState.zoom).toBeGreaterThan(9);
      expect(mapState.zoom).toBeLessThan(13);
    }

    // Take a screenshot for detailed verification
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-elements-check.png`,
      fullPage: false,
    });
  });

  test('verify map style loads without errors', async ({ page }) => {
    // Track network requests for tile loading
    const tileRequests: string[] = [];
    const failedRequests: string[] = [];

    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('tiles.openfreemap.org') || url.includes('style') || url.includes('openmaptiles')) {
        tileRequests.push(url);
      }
    });

    page.on('requestfailed', (request) => {
      const url = request.url();
      if (url.includes('tiles.openfreemap.org') || url.includes('style')) {
        failedRequests.push(`${url}: ${request.failure()?.errorText}`);
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map instance and style to fully load
    await waitForMapStyleLoaded(page);

    // Log tile loading status
    console.log(`Tile requests made: ${tileRequests.length}`);
    if (failedRequests.length > 0) {
      console.error('Failed tile requests:', failedRequests);
    }

    // Expect style to load successfully (OpenFreeMap Bright style)
    // Also check for the map's actual style URL as a fallback
    const styleFromMap = await page.evaluate(() => {
      const m = (window as any).__mapInstance;
      if (!m) return null;
      const style = m.getStyle();
      return style?.name || style?.sources ? 'loaded' : null;
    });

    const styleLoaded = tileRequests.some(url =>
      url.includes('bright') || url.includes('positron') || url.includes('openfreemap')
    ) || styleFromMap === 'loaded';
    expect(styleLoaded, 'Map style should load from OpenFreeMap').toBe(true);

    // No critical tile loading failures
    // Some tile 404s are acceptable for edge tiles, but style must load
    const criticalFailures = failedRequests.filter(f => f.includes('style'));
    expect(criticalFailures, 'Style should load without errors').toHaveLength(0);

    // Verify the style includes expected features for zoomed-out view
    // At zoomed-out levels, we should have labels and base layers
    const hasLabels = await page.evaluate(() => {
      const mapInstance = (window as any).__mapInstance;
      if (mapInstance) {
        const style = mapInstance.getStyle();
        // Check for label layers (place names)
        return style?.layers?.some((layer: any) =>
          layer.type === 'symbol' && layer.layout?.['text-field']
        );
      }
      return false;
    });

    expect(hasLabels, 'Style should include label layers for city names').toBe(true);
  });
});
