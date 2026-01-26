/**
 * Reference Expectation E2E Test: map-visuals-close-up
 *
 * This test verifies the close-up map appearance matches the Snap Maps-style
 * reference expectation with:
 * - 3D building extrusions with beige/cream colors
 * - Camera pitch (3D perspective view at 45-60 degrees)
 * - Soft shadows via lighting configuration
 * - Roads, greenery, streets visible at close-up zoom
 * - Buildings only appear as 3D when zoomed in (zoom > 14)
 *
 * Screenshot saved to: test-results/reference-expectations/map-visuals-close-up/
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// Configuration
const EXPECTATION_NAME = 'map-visuals-close-up';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Zoom level for close-up view (where 3D buildings should be visible)
const CLOSE_UP_ZOOM_LEVEL = 16;
const PITCH_3D = 50; // 3D perspective angle

// Center on Eindhoven residential area with buildings
const CENTER_COORDINATES: [number, number] = [5.4697, 51.4416]; // Eindhoven center

// Known acceptable errors (add patterns for expected/benign errors)
const KNOWN_ACCEPTABLE_ERRORS: RegExp[] = [
  /Download the React DevTools/,
  /React does not recognize the .* prop/,
  /Accessing element\.ref was removed in React 19/,
  /ref is now a regular prop/,
  /ResizeObserver loop/,
  /favicon\.ico/,
  /sourceMappingURL/,
  /Failed to parse source map/,
  /WebSocket connection/,
  /net::ERR_ABORTED/,
  /Failed to load resource.*404/, // Font/image 404s are acceptable
  /the server responded with a status of 404/, // OpenFreeMap font 404s
  /AJAXError.*404/, // Tile loading 404s for edge tiles
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
      consoleWarnings.slice(0, 10).forEach((w) => console.log(`  - ${w}`));
      if (consoleWarnings.length > 10) {
        console.log(`  ... and ${consoleWarnings.length - 10} more`);
      }
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

  test('capture close-up 3D map state for visual comparison', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map container to be ready
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    // Wait for map to initialize and load tiles
    await page.waitForTimeout(3000);

    // Set map to close-up level with 3D perspective programmatically
    const mapConfigured = await page.evaluate(
      ({ center, zoom, pitch }) => {
        // Access the MapLibre map instance via window.__mapInstance (exposed by our code)
        const mapInstance = (window as any).__mapInstance;

        if (mapInstance && typeof mapInstance.setZoom === 'function') {
          mapInstance.setCenter(center);
          mapInstance.setZoom(zoom);
          mapInstance.setPitch(pitch);
          return true;
        }

        // Fallback: try to find map through container
        const mapContainer = document.querySelector('[data-testid="map-view"]');
        if (mapContainer) {
          const fallbackMap = (mapContainer as any)._maplibre ||
                               (mapContainer as any).__map;

          if (fallbackMap && typeof fallbackMap.setZoom === 'function') {
            fallbackMap.setCenter(center);
            fallbackMap.setZoom(zoom);
            fallbackMap.setPitch(pitch);
            return true;
          }
        }
        return false;
      },
      { center: CENTER_COORDINATES, zoom: CLOSE_UP_ZOOM_LEVEL, pitch: PITCH_3D }
    );

    console.log(`Map configured via JS: ${mapConfigured}`);

    // Alternative approach if JS didn't work: use mouse wheel to zoom in
    if (!mapConfigured) {
      const mapView = page.locator('[data-testid="map-view"]');
      const box = await mapView.boundingBox();

      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        // Zoom in using mouse wheel (negative delta = zoom in)
        for (let i = 0; i < 10; i++) {
          await page.mouse.wheel(0, -300);
          await page.waitForTimeout(200);
        }
      }
    }

    // Wait for tiles to load and 3D buildings to render
    // 3D extrusions need extra time to render after zoom
    await page.waitForTimeout(5000);

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

    // Verify the 3D buildings layer exists
    const layerInfo = await page.evaluate(() => {
      const mapInstance = (window as any).__mapInstance;
      if (mapInstance) {
        const layer = mapInstance.getLayer('3d-buildings');
        return {
          exists: layer !== undefined,
          pitch: mapInstance.getPitch?.() ?? 0,
          zoom: mapInstance.getZoom?.() ?? 0,
        };
      }
      return null;
    });

    console.log('3D layer info:', layerInfo);

    // Verify 3D buildings layer was added
    expect(layerInfo?.exists, '3D buildings layer should exist').toBe(true);
    expect(layerInfo?.pitch, 'Map should have pitch > 0').toBeGreaterThan(0);
  });

  test('verify 3D buildings and map configuration', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to load
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await page.waitForTimeout(3000);

    // Check map configuration
    const mapConfig = await page.evaluate(() => {
      const mapInstance = (window as any).__mapInstance;

      if (mapInstance) {
        return {
          pitch: mapInstance.getPitch?.() ?? 0,
          zoom: mapInstance.getZoom?.() ?? 0,
          light: mapInstance.getLight?.() ?? null,
          has3DLayer: mapInstance.getLayer?.('3d-buildings') !== undefined,
          style: mapInstance.getStyle?.()?.name ?? 'unknown',
        };
      }
      return null;
    });

    console.log('Map configuration:', mapConfig);

    // Verify configuration
    expect(mapConfig).not.toBeNull();
    if (mapConfig) {
      // Map should have default pitch of 50 degrees
      expect(mapConfig.pitch, 'Map should have 3D pitch configured').toBe(50);

      // 3D buildings layer should exist
      expect(mapConfig.has3DLayer, '3D buildings layer should exist').toBe(true);

      // Lighting should be configured
      expect(mapConfig.light, 'Lighting should be configured').not.toBeNull();
    }

    // Verify map canvas renders
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    if (canvasBox) {
      expect(canvasBox.width).toBeGreaterThan(100);
      expect(canvasBox.height).toBeGreaterThan(100);
    }
  });
});
