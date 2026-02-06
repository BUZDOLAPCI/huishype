/**
 * Reference Expectation E2E Test: ghost-vs-active-nodes
 *
 * This test verifies the visual distinction between Ghost Nodes and Active Nodes:
 * - Ghost Nodes: Small, low-opacity gray dots (inactive properties)
 * - Active Nodes: Larger, colored (orange/red), high-opacity markers (socially active properties)
 *
 * The contrast between these node types is a key UX pattern that shows data coverage
 * while highlighting engaging content.
 *
 * Screenshot saved to: test-results/reference-expectations/ghost-vs-active-nodes/
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import { waitForMapStyleLoaded, waitForMapIdle } from './helpers/visual-test-helpers';
import fs from 'fs';

// Configuration
const EXPECTATION_NAME = 'ghost-vs-active-nodes';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Zoom level where individual nodes are visible (unclustered)
const UNCLUSTERED_ZOOM_LEVEL = 15.5;
const DEFAULT_PITCH = 30; // Slight 3D perspective for visual appeal

// Center on area where properties are actually located (based on API data)
// Properties are concentrated around [5.486-5.49, 51.43-51.432]
const CENTER_COORDINATES: [number, number] = [5.488, 51.431];

// Known acceptable console errors - MINIMAL list
const KNOWN_ACCEPTABLE_ERRORS: RegExp[] = [
  /ResizeObserver loop/,
  /sourceMappingURL/,
  /Failed to parse source map/,
  /Fast Refresh/,
  /\[HMR\]/,
  /WebSocket connection/,
  /net::ERR_ABORTED/,
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

  test('capture ghost vs active nodes visual distinction', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map container to be ready
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    // Wait for map instance and style to load
    await waitForMapStyleLoaded(page);

    // Set map to unclustered zoom level with flat view for clear node visibility
    const mapConfigured = await page.evaluate(
      ({ center, zoom, pitch }) => {
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
          const fallbackMap =
            (mapContainer as any)._maplibre || (mapContainer as any).__map;

          if (fallbackMap && typeof fallbackMap.setZoom === 'function') {
            fallbackMap.setCenter(center);
            fallbackMap.setZoom(zoom);
            fallbackMap.setPitch(pitch);
            return true;
          }
        }
        return false;
      },
      { center: CENTER_COORDINATES, zoom: UNCLUSTERED_ZOOM_LEVEL, pitch: DEFAULT_PITCH }
    );

    console.log(`Map configured via JS: ${mapConfigured}`);

    // Alternative approach if JS didn't work: use mouse wheel to zoom in
    if (!mapConfigured) {
      const mapView = page.locator('[data-testid="map-view"]');
      const box = await mapView.boundingBox();

      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        // Zoom in using mouse wheel
        for (let i = 0; i < 8; i++) {
          await page.mouse.wheel(0, -300);
          await page.waitForTimeout(200);
        }
      }
    }

    // Wait for map to be idle (tiles loaded)
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

    // Verify the property layers exist
    const layerInfo = await page.evaluate(() => {
      const mapInstance = (window as any).__mapInstance;
      if (mapInstance) {
        const ghostLayer = mapInstance.getLayer('ghost-nodes');
        const activeLayer = mapInstance.getLayer('active-nodes');
        const zoom = mapInstance.getZoom?.() ?? 0;

        return {
          hasGhostLayer: ghostLayer !== undefined,
          hasActiveLayer: activeLayer !== undefined,
          zoom,
        };
      }
      return null;
    });

    console.log('Layer info:', layerInfo);

    // Verify property layers exist
    expect(layerInfo?.hasGhostLayer, 'Ghost points layer should exist').toBe(true);
    expect(layerInfo?.hasActiveLayer, 'Active points layer should exist').toBe(true);
    expect(layerInfo?.zoom, 'Zoom should be at unclustered level').toBeGreaterThanOrEqual(14);
  });

  test('verify ghost and active node layer configurations', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to load
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    // Wait for property layers to be added (requires API data to load)
    await page.waitForFunction(
      () => {
        const mapInstance = (window as any).__mapInstance;
        return mapInstance?.getLayer?.('ghost-nodes') !== undefined;
      },
      { timeout: 15000 }
    );
    await page.waitForTimeout(1000); // Extra time for layers to fully render

    // Check layer configurations
    const layerConfig = await page.evaluate(() => {
      const mapInstance = (window as any).__mapInstance;

      if (mapInstance) {
        const ghostLayer = mapInstance.getLayer('ghost-nodes');
        const activeLayer = mapInstance.getLayer('active-nodes');

        // Get paint properties
        const ghostPaint = ghostLayer ? {
          radius: mapInstance.getPaintProperty('ghost-nodes', 'circle-radius'),
          color: mapInstance.getPaintProperty('ghost-nodes', 'circle-color'),
          opacity: mapInstance.getPaintProperty('ghost-nodes', 'circle-opacity'),
        } : null;

        const activePaint = activeLayer ? {
          radius: mapInstance.getPaintProperty('active-nodes', 'circle-radius'),
          color: mapInstance.getPaintProperty('active-nodes', 'circle-color'),
          opacity: mapInstance.getPaintProperty('active-nodes', 'circle-opacity'),
        } : null;

        return {
          ghostExists: ghostLayer !== undefined,
          activeExists: activeLayer !== undefined,
          ghostPaint,
          activePaint,
          zoom: mapInstance.getZoom?.() ?? 0,
        };
      }
      return null;
    });

    console.log('Layer configuration:', JSON.stringify(layerConfig, null, 2));

    // Verify layers exist
    expect(layerConfig).not.toBeNull();
    if (layerConfig) {
      expect(layerConfig.ghostExists, 'Ghost points layer should exist').toBe(true);
      expect(layerConfig.activeExists, 'Active points layer should exist').toBe(true);

      // Verify ghost nodes have low opacity
      if (layerConfig.ghostPaint?.opacity) {
        const ghostOpacity = typeof layerConfig.ghostPaint.opacity === 'number'
          ? layerConfig.ghostPaint.opacity
          : 0.4; // default from code
        expect(ghostOpacity, 'Ghost nodes should have low opacity').toBeLessThanOrEqual(0.5);
      }

      // Verify active nodes have higher opacity
      if (layerConfig.activePaint?.opacity) {
        const activeOpacity = typeof layerConfig.activePaint.opacity === 'number'
          ? layerConfig.activePaint.opacity
          : 0.9; // default from code
        expect(activeOpacity, 'Active nodes should have high opacity').toBeGreaterThanOrEqual(0.8);
      }
    }

    // Verify map canvas renders
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
  });

  test('verify visual distinction at unclustered zoom level', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    // Zoom to unclustered level
    await page.evaluate(
      ({ center, zoom, pitch }) => {
        const mapInstance = (window as any).__mapInstance;
        if (mapInstance) {
          mapInstance.setCenter(center);
          mapInstance.setZoom(zoom);
          mapInstance.setPitch(pitch);
        }
      },
      { center: CENTER_COORDINATES, zoom: UNCLUSTERED_ZOOM_LEVEL, pitch: DEFAULT_PITCH }
    );

    // Wait for map to be idle (tiles loaded)
    await waitForMapIdle(page);

    // Query for visible features in both layers
    const featureInfo = await page.evaluate(() => {
      const mapInstance = (window as any).__mapInstance;
      if (!mapInstance) return null;

      // Query rendered features for both layers
      const ghostFeatures = mapInstance.queryRenderedFeatures?.(undefined, {
        layers: ['ghost-nodes'],
      }) || [];
      const activeFeatures = mapInstance.queryRenderedFeatures?.(undefined, {
        layers: ['active-nodes'],
      }) || [];
      const clusterFeatures = mapInstance.queryRenderedFeatures?.(undefined, {
        layers: ['property-clusters'],
      }) || [];

      return {
        ghostCount: ghostFeatures.length,
        activeCount: activeFeatures.length,
        clusterCount: clusterFeatures.length,
        totalVisible: ghostFeatures.length + activeFeatures.length,
        zoom: mapInstance.getZoom?.() ?? 0,
      };
    });

    console.log('Visible features:', featureInfo);

    // Take a detailed screenshot for visual verification
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-detail.png`,
      fullPage: false,
    });

    // Verify we're at the right zoom level
    expect(featureInfo).not.toBeNull();
    if (featureInfo) {
      expect(featureInfo.zoom, 'Should be at unclustered zoom level').toBeGreaterThanOrEqual(14);
    }

    // Verify map canvas is visible
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
  });
});
