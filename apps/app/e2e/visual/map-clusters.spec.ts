/**
 * Visual E2E Test: Map Clusters at Different Zoom Levels
 *
 * Captures screenshots of the map at different zoom levels to verify:
 * - Z12: Cluster circles with counts visible
 * - Z15: Single active points visible (transition zone)
 * - Z18: Individual nodes (active + ghost) visible
 *
 * Screenshots saved to: test-results/visual/map-clusters/
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { waitForMapStyleLoaded, waitForMapIdle } from './helpers/visual-test-helpers';
import { MAP_LAYER_NAMES } from './helpers/map-layer-names';

// Configuration
const SCREENSHOT_DIR = 'test-results/visual/map-clusters';

// Eindhoven center - dense area with listings
const EINDHOVEN_CENTER: [number, number] = [5.4697, 51.4416];

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
  /Failed to load resource.*\.pbf/,
  /font/i,
];

// Disable tracing to avoid artifact race conditions
test.use({ trace: 'off' });

test.describe('Map Clusters Visual Tests', () => {
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
        if (!KNOWN_ACCEPTABLE_ERRORS.some((p) => p.test(text))) {
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
      consoleWarnings.slice(0, 5).forEach((w) => console.log(`  - ${w}`));
    }
    if (consoleErrors.length > 0) {
      console.error(`Console errors (${consoleErrors.length}):`);
      consoleErrors.forEach((e) => console.error(`  - ${e}`));
    }
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('zoom 12 - cluster view with circles and counts', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    // Set map to zoom 12 centered on Eindhoven
    await page.evaluate(
      ({ center, zoom }) => {
        const map = (window as any).__mapInstance;
        if (map) {
          map.jumpTo({ center, zoom, pitch: 0, bearing: 0 });
        }
      },
      { center: EINDHOVEN_CENTER, zoom: 12 }
    );

    await waitForMapIdle(page);

    // Verify cluster layers exist
    const layerInfo = await page.evaluate(
      ({ clusterLayer, countLayer, singleActiveLayer }) => {
        const map = (window as any).__mapInstance;
        if (!map) return null;
        return {
          hasClusters: !!map.getLayer(clusterLayer),
          hasClusterCount: !!map.getLayer(countLayer),
          hasSingleActive: !!map.getLayer(singleActiveLayer),
          zoom: map.getZoom(),
        };
      },
      {
        clusterLayer: MAP_LAYER_NAMES.CLUSTERS,
        countLayer: MAP_LAYER_NAMES.CLUSTER_COUNT,
        singleActiveLayer: MAP_LAYER_NAMES.SINGLE_ACTIVE_POINTS,
      }
    );

    expect(layerInfo).not.toBeNull();
    console.log(`Z12 layers: clusters=${layerInfo?.hasClusters}, counts=${layerInfo?.hasClusterCount}, singleActive=${layerInfo?.hasSingleActive}`);

    // Query rendered cluster features
    const clusterFeatures = await page.evaluate(
      ({ layer }) => {
        const map = (window as any).__mapInstance;
        if (!map || !map.getLayer(layer)) return [];
        const features = map.queryRenderedFeatures(undefined, { layers: [layer] });
        return features.slice(0, 10).map((f: any) => ({
          point_count: f.properties?.point_count,
          has_property_ids: !!f.properties?.property_ids,
        }));
      },
      { layer: MAP_LAYER_NAMES.CLUSTERS }
    );

    console.log(`Z12: ${clusterFeatures.length} cluster features rendered`);
    if (clusterFeatures.length > 0) {
      // Verify clusters have property_ids field
      for (const feat of clusterFeatures) {
        expect(feat.has_property_ids).toBe(true);
        expect(feat.point_count).toBeGreaterThan(1);
      }
    }

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/01-zoom-12-clusters.png`,
      fullPage: false,
    });
  });

  test('zoom 15 - transition zone with single active points', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    // Set map to zoom 15 - transition zone
    await page.evaluate(
      ({ center, zoom }) => {
        const map = (window as any).__mapInstance;
        if (map) {
          map.jumpTo({ center, zoom, pitch: 0, bearing: 0 });
        }
      },
      { center: EINDHOVEN_CENTER, zoom: 15 }
    );

    await waitForMapIdle(page);

    // Check which layers are visible at this zoom
    const layerVisibility = await page.evaluate(
      ({ layers }) => {
        const map = (window as any).__mapInstance;
        if (!map) return null;
        const result: Record<string, { exists: boolean; featureCount: number }> = {};
        for (const [key, layerId] of Object.entries(layers)) {
          const exists = !!map.getLayer(layerId as string);
          let featureCount = 0;
          if (exists) {
            try {
              featureCount = map.queryRenderedFeatures(undefined, { layers: [layerId] }).length;
            } catch {
              /* layer may not be queryable */
            }
          }
          result[key] = { exists, featureCount };
        }
        return { layers: result, zoom: map.getZoom() };
      },
      { layers: MAP_LAYER_NAMES }
    );

    console.log(`Z15 layer state:`, JSON.stringify(layerVisibility, null, 2));

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/02-zoom-15-transition.png`,
      fullPage: false,
    });
  });

  test('zoom 18 - individual nodes (active + ghost)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    // Set map to zoom 18 for individual nodes
    await page.evaluate(
      ({ center, zoom }) => {
        const map = (window as any).__mapInstance;
        if (map) {
          map.jumpTo({ center, zoom, pitch: 0, bearing: 0 });
        }
      },
      { center: EINDHOVEN_CENTER, zoom: 18 }
    );

    await waitForMapIdle(page);

    // Check active and ghost node layers
    const nodeInfo = await page.evaluate(
      ({ activeLayer, ghostLayer }) => {
        const map = (window as any).__mapInstance;
        if (!map) return null;

        const hasActive = !!map.getLayer(activeLayer);
        const hasGhost = !!map.getLayer(ghostLayer);

        let activeCount = 0;
        let ghostCount = 0;

        if (hasActive) {
          activeCount = map.queryRenderedFeatures(undefined, { layers: [activeLayer] }).length;
        }
        if (hasGhost) {
          ghostCount = map.queryRenderedFeatures(undefined, { layers: [ghostLayer] }).length;
        }

        return {
          hasActive,
          hasGhost,
          activeCount,
          ghostCount,
          zoom: map.getZoom(),
        };
      },
      {
        activeLayer: MAP_LAYER_NAMES.ACTIVE_NODES,
        ghostLayer: MAP_LAYER_NAMES.GHOST_NODES,
      }
    );

    expect(nodeInfo).not.toBeNull();
    console.log(
      `Z18: activeNodes=${nodeInfo?.activeCount}, ghostNodes=${nodeInfo?.ghostCount}`
    );

    // At z18, the high-zoom layers should exist
    if (nodeInfo) {
      expect(nodeInfo.hasActive).toBe(true);
      expect(nodeInfo.hasGhost).toBe(true);
    }

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/03-zoom-18-individual-nodes.png`,
      fullPage: false,
    });
  });

  test('cluster features contain property_ids at zoom 13', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    await page.evaluate(
      ({ center, zoom }) => {
        const map = (window as any).__mapInstance;
        if (map) {
          map.jumpTo({ center, zoom, pitch: 0, bearing: 0 });
        }
      },
      { center: EINDHOVEN_CENTER, zoom: 13 }
    );

    await waitForMapIdle(page);

    // Verify cluster features include property_ids (the new field)
    const clusterData = await page.evaluate(
      ({ layer }) => {
        const map = (window as any).__mapInstance;
        if (!map || !map.getLayer(layer)) return [];
        const features = map.queryRenderedFeatures(undefined, { layers: [layer] });
        return features.slice(0, 5).map((f: any) => ({
          point_count: f.properties?.point_count,
          property_ids: f.properties?.property_ids,
          has_active_children: f.properties?.has_active_children,
        }));
      },
      { layer: MAP_LAYER_NAMES.CLUSTERS }
    );

    console.log(`Z13: ${clusterData.length} clusters queried`);

    if (clusterData.length > 0) {
      for (const cluster of clusterData) {
        // Each cluster should have property_ids as comma-separated string
        expect(cluster.property_ids).toBeTruthy();
        const ids = cluster.property_ids.split(',');
        expect(ids.length).toBeGreaterThan(0);
        // Number of IDs should match point_count (or be capped)
        console.log(
          `  Cluster: point_count=${cluster.point_count}, ids=${ids.length}, active_children=${cluster.has_active_children}`
        );
      }
    }

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/04-zoom-13-cluster-data.png`,
      fullPage: false,
    });
  });
});
