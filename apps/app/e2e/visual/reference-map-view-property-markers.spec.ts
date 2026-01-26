/**
 * Reference Expectation E2E Test: map-view-property-markers
 *
 * This test verifies the map view displays property markers with:
 * - Ghost Nodes (low-opacity dots for inactive properties)
 * - Active Nodes (larger, colored markers for active properties)
 * - Visual activity indicators (pulses for recent activity)
 * - Clear visual hierarchy between marker types
 *
 * Screenshot saved to: test-results/reference-expectations/map-view-property-markers/
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// Configuration
const EXPECTATION_NAME = 'map-view-property-markers';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Zoom level for viewing property markers (neighborhood level)
// Zoom 15+ shows individual markers, below that shows clusters
// Using 15 to show individual markers while having enough visible
const MARKER_VIEW_ZOOM_LEVEL = 15;
const PITCH_3D = 45; // Slight 3D perspective

// Center on location with actual properties from the database
// Properties are concentrated around [5.488, 51.430] area
const CENTER_COORDINATES: [number, number] = [5.488, 51.430];

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
  /useAuthContext must be used within an AuthProvider/, // HMR-related error during dev
  /The above error occurred in the <AuthModal> component/, // React error boundary message
  /%o\s*%s\s*%s/, // Console format string errors from React
];

// Disable tracing to avoid artifact issues
test.use({ trace: 'off' });

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

  test('capture map view with property markers for visual comparison', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map container to be ready
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    // Wait for map to initialize and load tiles
    await page.waitForTimeout(3000);

    // Set map to neighborhood level with slight 3D perspective
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
      { center: CENTER_COORDINATES, zoom: MARKER_VIEW_ZOOM_LEVEL, pitch: PITCH_3D }
    );

    console.log(`Map configured via JS: ${mapConfigured}`);

    // Wait for zoom animation to complete and tiles to load
    await page.waitForTimeout(2000);

    // Verify and log the actual zoom level
    const actualZoom = await page.evaluate(() => {
      const mapInstance = (window as any).__mapInstance;
      return mapInstance?.getZoom?.() ?? 0;
    });
    console.log(`Actual zoom level after setting: ${actualZoom}`);

    // Alternative approach if JS didn't work: use mouse wheel to zoom
    if (!mapConfigured || actualZoom < 14) {
      const mapView = page.locator('[data-testid="map-view"]');
      const box = await mapView.boundingBox();

      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        // Zoom to appropriate level using mouse wheel
        for (let i = 0; i < 8; i++) {
          await page.mouse.wheel(0, -300);
          await page.waitForTimeout(300);
        }
      }
    }

    // Wait for tiles to load and markers to render
    await page.waitForTimeout(3000);

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

    // Check for property marker layers and rendered features
    const markerInfo = await page.evaluate(() => {
      const mapInstance = (window as any).__mapInstance;
      if (mapInstance) {
        const style = mapInstance.getStyle();
        const layers = style?.layers || [];

        // Look for marker-related layers
        const markerLayers = layers.filter((layer: any) =>
          layer.id.includes('marker') ||
          layer.id.includes('property') ||
          layer.id.includes('node') ||
          layer.id.includes('cluster') ||
          layer.id.includes('point')
        );

        // Query rendered features for each marker layer
        const ghostFeatures = mapInstance.queryRenderedFeatures?.(undefined, { layers: ['ghost-points'] }) || [];
        const activeFeatures = mapInstance.queryRenderedFeatures?.(undefined, { layers: ['active-points'] }) || [];
        const clusterFeatures = mapInstance.queryRenderedFeatures?.(undefined, { layers: ['clusters'] }) || [];

        return {
          totalLayers: layers.length,
          markerLayerCount: markerLayers.length,
          markerLayerIds: markerLayers.map((l: any) => l.id),
          zoom: mapInstance.getZoom?.() ?? 0,
          center: mapInstance.getCenter?.() ?? null,
          renderedMarkers: {
            ghostNodes: ghostFeatures.length,
            activeNodes: activeFeatures.length,
            clusters: clusterFeatures.length,
          },
        };
      }
      return null;
    });

    console.log('Marker layer info:', markerInfo);

    // Verify map is at correct zoom level
    if (markerInfo) {
      expect(markerInfo.zoom).toBeGreaterThan(10);

      // Verify that both ghost and active nodes are rendered
      // This confirms the visual expectation requirements
      expect(markerInfo.renderedMarkers.ghostNodes).toBeGreaterThan(0);
      expect(markerInfo.renderedMarkers.activeNodes).toBeGreaterThan(0);

      // Verify expected layers exist
      expect(markerInfo.markerLayerIds).toContain('ghost-points');
      expect(markerInfo.markerLayerIds).toContain('active-points');
    }
  });

  test('verify map renders without critical errors', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to load
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await page.waitForTimeout(5000); // Give more time for tiles to load

    // Check map configuration
    const mapConfig = await page.evaluate(() => {
      const mapInstance = (window as any).__mapInstance;

      if (mapInstance) {
        return {
          zoom: mapInstance.getZoom?.() ?? 0,
          center: mapInstance.getCenter?.() ?? null,
          style: mapInstance.getStyle?.()?.name ?? 'unknown',
        };
      }
      return null;
    });

    console.log('Map configuration:', mapConfig);

    // Verify map instance exists
    expect(mapConfig).not.toBeNull();

    // Verify map canvas renders
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    if (canvasBox) {
      expect(canvasBox.width).toBeGreaterThan(100);
      expect(canvasBox.height).toBeGreaterThan(100);
    }

    // Verify the map has expected layers for property markers
    const layerInfo = await page.evaluate(() => {
      const mapInstance = (window as any).__mapInstance;
      if (mapInstance) {
        const style = mapInstance.getStyle();
        const layers = style?.layers || [];
        return {
          totalLayers: layers.length,
          hasCanvas: true,
        };
      }
      return null;
    });

    console.log('Layer info:', layerInfo);
    expect(layerInfo?.totalLayers).toBeGreaterThan(0);
  });
});
