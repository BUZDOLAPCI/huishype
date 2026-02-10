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
import { waitForMapStyleLoaded, waitForMapIdle } from './helpers/visual-test-helpers';

// Configuration
const EXPECTATION_NAME = 'map-view-property-markers';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Zoom level for viewing property markers
// The backend API returns individual points (with is_ghost field) at z17+
// At z15-z16 there's a gap between frontend layer config and backend clustering
// Use z17 to reliably see ghost-nodes and active-nodes layers
const MARKER_VIEW_ZOOM_LEVEL = 17;
const PITCH_3D = 45; // Slight 3D perspective

// Center on Eindhoven area where properties and some listings exist
const CENTER_COORDINATES: [number, number] = [5.4697, 51.4416];

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

    // Wait for map instance and style to load
    await waitForMapStyleLoaded(page);

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

    // Wait for the map to be idle and tiles to fully load after zoom
    await waitForMapIdle(page, 10000);

    // Wait for property features to render in the viewport
    await page.waitForFunction(
      () => {
        const mapInstance = (window as any).__mapInstance;
        if (!mapInstance || !mapInstance.isStyleLoaded()) return false;
        const canvas = mapInstance.getCanvas();
        if (!canvas) return false;

        // Check for any property features at the current zoom
        const layerIds = ['ghost-nodes', 'active-nodes', 'property-clusters', 'single-active-points']
          .filter(l => mapInstance.getLayer(l));
        if (layerIds.length === 0) return false;

        try {
          const features = mapInstance.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers: layerIds }
          );
          return (features?.length || 0) > 0;
        } catch { return false; }
      },
      { timeout: 30000 }
    ).catch(() => {
      console.log('Warning: Timed out waiting for property features to render');
    });

    // Additional settle time
    await page.waitForTimeout(2000);

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

        // Query rendered features using all available property layers
        const availableLayers = ['ghost-nodes', 'active-nodes', 'property-clusters', 'single-active-points']
          .filter(l => mapInstance.getLayer(l));
        const canvas = mapInstance.getCanvas();
        let ghostNodes = 0, activeNodes = 0, clusters = 0;

        try {
          const ghostFeatures = mapInstance.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers: ['ghost-nodes'].filter(l => mapInstance.getLayer(l)) }
          ) || [];
          ghostNodes = ghostFeatures.length;
        } catch { /* ignore */ }

        try {
          const activeFeatures = mapInstance.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers: ['active-nodes'].filter(l => mapInstance.getLayer(l)) }
          ) || [];
          activeNodes = activeFeatures.length;
        } catch { /* ignore */ }

        try {
          const clusterFeatures = mapInstance.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers: ['property-clusters'].filter(l => mapInstance.getLayer(l)) }
          ) || [];
          clusters = clusterFeatures.length;
        } catch { /* ignore */ }

        return {
          totalLayers: layers.length,
          markerLayerCount: markerLayers.length,
          markerLayerIds: markerLayers.map((l: any) => l.id),
          zoom: mapInstance.getZoom?.() ?? 0,
          center: mapInstance.getCenter?.() ?? null,
          renderedMarkers: {
            ghostNodes,
            activeNodes,
            clusters,
          },
        };
      }
      return null;
    });

    console.log('Marker layer info:', markerInfo);

    // Verify map is at correct zoom level (z17+)
    if (markerInfo) {
      expect(markerInfo.zoom).toBeGreaterThanOrEqual(17);

      // Verify expected layers exist
      expect(markerInfo.markerLayerIds).toContain('ghost-nodes');
      expect(markerInfo.markerLayerIds).toContain('active-nodes');

      // At z17+, ghost nodes should be visible (properties without listings/activity)
      // Active nodes may or may not be present depending on whether listings exist nearby
      // Verify that property features are rendered (ghost or active)
      const totalFeatures = markerInfo.renderedMarkers.ghostNodes +
                           markerInfo.renderedMarkers.activeNodes;
      expect(totalFeatures, 'Should have rendered property features (ghost or active nodes) on map').toBeGreaterThan(0);
    }
  });

  test('verify map renders without critical errors', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to load
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    // Wait for map instance and style to load
    await waitForMapStyleLoaded(page);

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
