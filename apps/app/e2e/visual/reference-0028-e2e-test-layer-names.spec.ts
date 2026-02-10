/**
 * Reference Expectation E2E Test: 0028-e2e-test-layer-names
 *
 * This test verifies that all E2E tests use correct MapLibre layer names
 * that match the actual layer definitions in index.web.tsx.
 *
 * Expected layers (from addPropertyLayers() in index.web.tsx):
 * - property-clusters: Cluster circles (Z0-Z14)
 * - cluster-count: Cluster count labels (Z0-Z14)
 * - single-active-points: Single active points at low zoom (Z0-Z14)
 * - active-nodes: Active nodes at high zoom (Z15+)
 * - ghost-nodes: Ghost nodes at high zoom (Z15+)
 *
 * Screenshot saved to: test-results/reference-expectations/0028-e2e-test-layer-names/
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import {
  MAP_LAYER_NAMES,
  ALL_PROPERTY_LAYERS,
  LOW_ZOOM_LAYERS,
  HIGH_ZOOM_LAYERS,
  GHOST_NODE_ZOOM_THRESHOLD,
} from './helpers/map-layer-names';

// Disable tracing for this test to avoid trace file issues
test.use({ trace: 'off', video: 'off' });

// Configuration
const EXPECTATION_NAME = '0028-e2e-test-layer-names';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Center on area with known properties from the database
const CENTER_COORDINATES: [number, number] = [5.4880, 51.4307];

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
        const isKnown = KNOWN_ACCEPTABLE_ERRORS.some((pattern) => pattern.test(text));
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

  test('verify all expected property layers exist at low zoom', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    // Wait for the map instance and property layers to be available
    await page.waitForFunction(
      (layerNames) => {
        const mapInstance = (window as any).__mapInstance;
        if (!mapInstance) return false;
        // Verify all expected property layers are added
        return layerNames.every((name: string) => mapInstance.getLayer(name) !== undefined);
      },
      [...ALL_PROPERTY_LAYERS, MAP_LAYER_NAMES.CLUSTER_COUNT],
      { timeout: 30000, polling: 500 }
    );

    // Configure map to low zoom (where clusters are visible)
    const LOW_ZOOM = 13;
    await page.evaluate(
      ({ center, zoom }) => {
        const mapInstance = (window as any).__mapInstance;
        if (mapInstance) {
          mapInstance.setCenter(center);
          mapInstance.setZoom(zoom);
        }
      },
      { center: CENTER_COORDINATES, zoom: LOW_ZOOM }
    );

    // Wait for the map to settle at the new zoom/center
    await page.waitForFunction(
      (expectedZoom) => {
        const mapInstance = (window as any).__mapInstance;
        if (!mapInstance) return false;
        return Math.abs(mapInstance.getZoom() - expectedZoom) < 0.5 && !mapInstance.isMoving();
      },
      LOW_ZOOM,
      { timeout: 15000, polling: 500 }
    );

    // Check which layers exist
    const layerInfo = await page.evaluate((expectedLayers) => {
      const mapInstance = (window as any).__mapInstance;
      if (!mapInstance) return { error: 'No map instance' };

      const result: Record<string, boolean> = {};
      for (const layerId of expectedLayers) {
        result[layerId] = mapInstance.getLayer(layerId) !== undefined;
      }

      // Also get all layer IDs for debugging
      const allLayers = mapInstance.getStyle()?.layers?.map((l: { id: string }) => l.id) || [];
      const propertyRelatedLayers = allLayers.filter(
        (id: string) =>
          id.includes('property') ||
          id.includes('cluster') ||
          id.includes('point') ||
          id.includes('node')
      );

      return {
        expectedLayerStatus: result,
        propertyRelatedLayers,
        currentZoom: mapInstance.getZoom(),
      };
    }, [...LOW_ZOOM_LAYERS, MAP_LAYER_NAMES.ACTIVE_NODES, MAP_LAYER_NAMES.GHOST_NODES]);

    console.log('Layer info at low zoom:', JSON.stringify(layerInfo, null, 2));

    // Verify low-zoom layers exist
    expect(layerInfo.expectedLayerStatus[MAP_LAYER_NAMES.CLUSTERS], 'property-clusters layer should exist').toBe(true);
    expect(layerInfo.expectedLayerStatus[MAP_LAYER_NAMES.SINGLE_ACTIVE_POINTS], 'single-active-points layer should exist').toBe(true);

    // Take screenshot
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-low-zoom.png`,
      fullPage: false,
    });

    console.log(`Screenshot saved to: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-low-zoom.png`);
  });

  test('verify all expected property layers exist at high zoom', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    // Wait for the map instance and property layers to be available
    await page.waitForFunction(
      (layerNames) => {
        const mapInstance = (window as any).__mapInstance;
        if (!mapInstance) return false;
        return layerNames.every((name: string) => mapInstance.getLayer(name) !== undefined);
      },
      [...ALL_PROPERTY_LAYERS, MAP_LAYER_NAMES.CLUSTER_COUNT],
      { timeout: 30000, polling: 500 }
    );

    // Configure map to high zoom (where ghost/active nodes are visible)
    const HIGH_ZOOM = 17;
    await page.evaluate(
      ({ center, zoom }) => {
        const mapInstance = (window as any).__mapInstance;
        if (mapInstance) {
          mapInstance.setCenter(center);
          mapInstance.setZoom(zoom);
        }
      },
      { center: CENTER_COORDINATES, zoom: HIGH_ZOOM }
    );

    // Wait for the map to settle at the new zoom/center
    await page.waitForFunction(
      (expectedZoom) => {
        const mapInstance = (window as any).__mapInstance;
        if (!mapInstance) return false;
        return Math.abs(mapInstance.getZoom() - expectedZoom) < 0.5 && !mapInstance.isMoving();
      },
      HIGH_ZOOM,
      { timeout: 15000, polling: 500 }
    );

    // Check which layers exist
    const layerInfo = await page.evaluate((expectedLayers) => {
      const mapInstance = (window as any).__mapInstance;
      if (!mapInstance) return { error: 'No map instance' };

      const result: Record<string, boolean> = {};
      for (const layerId of expectedLayers) {
        result[layerId] = mapInstance.getLayer(layerId) !== undefined;
      }

      // Also get all layer IDs for debugging
      const allLayers = mapInstance.getStyle()?.layers?.map((l: { id: string }) => l.id) || [];
      const propertyRelatedLayers = allLayers.filter(
        (id: string) =>
          id.includes('property') ||
          id.includes('cluster') ||
          id.includes('point') ||
          id.includes('node')
      );

      return {
        expectedLayerStatus: result,
        propertyRelatedLayers,
        currentZoom: mapInstance.getZoom(),
      };
    }, [...HIGH_ZOOM_LAYERS, MAP_LAYER_NAMES.CLUSTERS, MAP_LAYER_NAMES.SINGLE_ACTIVE_POINTS]);

    console.log('Layer info at high zoom:', JSON.stringify(layerInfo, null, 2));

    // Verify high-zoom layers exist
    expect(layerInfo.expectedLayerStatus[MAP_LAYER_NAMES.ACTIVE_NODES], 'active-nodes layer should exist').toBe(true);
    expect(layerInfo.expectedLayerStatus[MAP_LAYER_NAMES.GHOST_NODES], 'ghost-nodes layer should exist').toBe(true);

    // Take screenshot
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-high-zoom.png`,
      fullPage: false,
    });

    console.log(`Screenshot saved to: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-high-zoom.png`);
  });

  test('verify querying layers does not produce console errors', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    // Wait for the map instance and property layers to be available
    await page.waitForFunction(
      (layerNames) => {
        const mapInstance = (window as any).__mapInstance;
        if (!mapInstance) return false;
        return layerNames.every((name: string) => mapInstance.getLayer(name) !== undefined);
      },
      [...ALL_PROPERTY_LAYERS, MAP_LAYER_NAMES.CLUSTER_COUNT],
      { timeout: 30000, polling: 500 }
    );

    // Configure map to high zoom
    await page.evaluate(
      ({ center }) => {
        const mapInstance = (window as any).__mapInstance;
        if (mapInstance) {
          mapInstance.setCenter(center);
          mapInstance.setZoom(17);
        }
      },
      { center: CENTER_COORDINATES }
    );

    // Wait for the map to settle at zoom 17
    await page.waitForFunction(
      () => {
        const mapInstance = (window as any).__mapInstance;
        if (!mapInstance) return false;
        return Math.abs(mapInstance.getZoom() - 17) < 0.5 && !mapInstance.isMoving();
      },
      undefined,
      { timeout: 15000, polling: 500 }
    );

    // Query features from all property layers (should not produce errors)
    const queryResult = await page.evaluate((layerNames) => {
      const mapInstance = (window as any).__mapInstance;
      if (!mapInstance) return { error: 'No map instance' };

      const canvas = mapInstance.getCanvas();
      const results: Record<string, number> = {};

      for (const layerId of layerNames) {
        if (mapInstance.getLayer(layerId)) {
          try {
            const features = mapInstance.queryRenderedFeatures(
              [[0, 0], [canvas.width, canvas.height]],
              { layers: [layerId] }
            );
            results[layerId] = features?.length || 0;
          } catch (e) {
            results[layerId] = -1; // Error
          }
        } else {
          results[layerId] = -2; // Layer doesn't exist
        }
      }

      return {
        featureCounts: results,
        zoom: mapInstance.getZoom(),
      };
    }, ALL_PROPERTY_LAYERS);

    console.log('Query results:', JSON.stringify(queryResult, null, 2));

    // Verify we can query at least one layer successfully
    const successfulQueries = Object.values(queryResult.featureCounts as Record<string, number>).filter(
      (count) => count >= 0
    );
    expect(successfulQueries.length, 'Should be able to query at least one layer').toBeGreaterThan(0);

    // Take final screenshot
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });

    console.log(`Screenshot saved to: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`);
  });

  test('verify layer name constants match actual implementation', async ({ page }) => {
    // This test ensures the constants file stays in sync with the actual implementation

    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    // Wait for the map instance and all property layers to be available (polling, no fixed timeout)
    await page.waitForFunction(
      (layerNames) => {
        const mapInstance = (window as any).__mapInstance;
        if (!mapInstance) return false;
        return layerNames.every((name: string) => mapInstance.getLayer(name) !== undefined);
      },
      [...ALL_PROPERTY_LAYERS, MAP_LAYER_NAMES.CLUSTER_COUNT],
      { timeout: 30000, polling: 500 }
    );

    // Get all property-related layers from the map
    const actualLayers = await page.evaluate(() => {
      const mapInstance = (window as any).__mapInstance;
      if (!mapInstance) return [];

      const allLayers = mapInstance.getStyle()?.layers?.map((l: { id: string }) => l.id) || [];
      return allLayers.filter(
        (id: string) =>
          id.includes('property') ||
          id.includes('cluster') ||
          id.includes('point') ||
          id.includes('node') ||
          id.includes('active') ||
          id.includes('ghost')
      );
    });

    console.log('Actual property-related layers:', actualLayers);

    // Verify our constants include all the actual layers
    const expectedLayerIds = [
      MAP_LAYER_NAMES.CLUSTERS,
      MAP_LAYER_NAMES.CLUSTER_COUNT,
      MAP_LAYER_NAMES.SINGLE_ACTIVE_POINTS,
      MAP_LAYER_NAMES.ACTIVE_NODES,
      MAP_LAYER_NAMES.GHOST_NODES,
    ];

    for (const expectedId of expectedLayerIds) {
      expect(
        actualLayers.includes(expectedId),
        `Layer "${expectedId}" should exist in the map`
      ).toBe(true);
    }

    console.log('All expected layers verified!');

    // Take screenshot showing successful verification
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-verification.png`,
      fullPage: false,
    });
  });
});
