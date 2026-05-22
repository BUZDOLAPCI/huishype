/**
 * Visual E2E Test: Map Clusters at Different Zoom Levels
 *
 * Captures screenshots of the map at different zoom levels to verify:
 * - Z12: Cluster circles with counts visible
 * - Z15: Single active points visible (transition zone)
 * - Z18: Individual active nodes visible, with public ghost layers absent
 *
 * Screenshots saved to: test-results/visual/map-clusters/
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { PROPERTY_PREVIEW_MEMBER_LIMIT } from '@huishype/shared';
import { waitForMapStyleLoaded, waitForMapIdle } from './helpers/visual-test-helpers';
import { MAP_LAYER_NAMES } from './helpers/map-layer-names';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';
import { getPlaywrightArtifactPath } from '../helpers/runtime';

// Configuration
const SCREENSHOT_DIR = getPlaywrightArtifactPath('visual', 'map-clusters');

// Eindhoven center - dense area with listings
const EINDHOVEN_CENTER: [number, number] = [5.4697, 51.4416];

// Known acceptable console errors
const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

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
        if (!isAllowedConsoleMessage(text, KNOWN_ACCEPTABLE_ERRORS)) {
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
        const map = window.__mapInstance;
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
        const map = window.__mapInstance;
        if (!map) return null;
        return {
          hasClusters: !!map.getLayer(clusterLayer),
          hasClusterCount: !!map.getLayer(countLayer),
          hasGhostClusters: !!map.getLayer(singleActiveLayer),
          zoom: map.getZoom(),
        };
      },
      {
        clusterLayer: MAP_LAYER_NAMES.CLUSTERS,
        countLayer: MAP_LAYER_NAMES.CLUSTER_COUNT,
        singleActiveLayer: MAP_LAYER_NAMES.GHOST_CLUSTERS,
      }
    );

    expect(layerInfo).not.toBeNull();
    console.log(
      `Z12 layers: clusters=${layerInfo?.hasClusters}, counts=${layerInfo?.hasClusterCount}, ghostClusters=${layerInfo?.hasGhostClusters}`
    );

    // Query rendered cluster features
    const clusterFeatures = await page.evaluate(
      ({ layer, previewLimit }) => {
        const map = window.__mapInstance;
        if (!map || !map.getLayer(layer)) return [];
        const parseIds = (value: unknown): string[] => {
          if (typeof value === 'string') {
            return value.split(',').filter(Boolean);
          }
          if (Array.isArray(value)) {
            return value.filter(
              (item): item is string => typeof item === 'string' && item.length > 0
            );
          }
          return [];
        };
        const parseOptionalBoolean = (value: unknown): boolean | null => {
          if (typeof value === 'boolean') return value;
          if (typeof value === 'string') {
            if (value.toLowerCase() === 'true') return true;
            if (value.toLowerCase() === 'false') return false;
          }
          if (typeof value === 'number') {
            if (value === 1) return true;
            if (value === 0) return false;
          }
          return null;
        };
        const features = map.queryRenderedFeatures(undefined, { layers: [layer] });
        return features.slice(0, 10).map((f) => {
          const pointCount = Number(f.properties?.point_count ?? 0);
          const membershipComplete = parseOptionalBoolean(f.properties?.membership_complete);
          const readStateCoverage =
            typeof f.properties?.read_state_coverage === 'string'
              ? f.properties.read_state_coverage
              : membershipComplete === true
                ? 'complete'
                : 'partial';
          return {
            node_class: f.properties?.node_class,
            group_kind: f.properties?.group_kind,
            primary_property_id: f.properties?.primary_property_id,
            point_count: pointCount,
            property_ids_length: parseIds(f.properties?.property_ids).length,
            preview_property_ids_length: parseIds(f.properties?.preview_property_ids).length,
            membership_complete: membershipComplete ?? readStateCoverage === 'complete',
            read_state_coverage: readStateCoverage,
            is_previewable: pointCount > 1 && pointCount <= previewLimit,
          };
        });
      },
      { layer: MAP_LAYER_NAMES.CLUSTERS, previewLimit: PROPERTY_PREVIEW_MEMBER_LIMIT }
    );

    console.log(`Z12: ${clusterFeatures.length} cluster features rendered`);
    if (clusterFeatures.length > 0) {
      // Public low-zoom pyramid clusters may expose only preview IDs plus
      // partial membership metadata; full property_ids are not guaranteed.
      for (const feat of clusterFeatures) {
        expect(feat.node_class).toBe('active');
        expect(feat.group_kind).toBe('cluster');
        expect(feat.primary_property_id).toBeTruthy();
        expect(feat.point_count).toBeGreaterThan(1);
        expect(['complete', 'partial']).toContain(feat.read_state_coverage);

        if (feat.is_previewable) {
          expect(feat.preview_property_ids_length).toBeGreaterThan(1);
          expect(feat.preview_property_ids_length).toBeLessThanOrEqual(feat.point_count);
        }

        if (feat.membership_complete === true || feat.read_state_coverage === 'complete') {
          expect(feat.property_ids_length).toBeGreaterThan(1);
        }
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
        const map = window.__mapInstance;
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
        const map = window.__mapInstance;
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

  test('zoom 18 - individual active nodes', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    // Set map to zoom 18 for individual nodes
    await page.evaluate(
      ({ center, zoom }) => {
        const map = window.__mapInstance;
        if (map) {
          map.jumpTo({ center, zoom, pitch: 0, bearing: 0 });
        }
      },
      { center: EINDHOVEN_CENTER, zoom: 18 }
    );

    await waitForMapIdle(page);

    // Check active node layer and verify public ghost layers remain absent.
    const nodeInfo = await page.evaluate(
      ({ activeLayer, ghostLayer }) => {
        const map = window.__mapInstance;
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
    console.log(`Z18: activeNodes=${nodeInfo?.activeCount}, ghostNodes=${nodeInfo?.ghostCount}`);

    // At z18, the high-zoom layers should exist
    if (nodeInfo) {
      expect(nodeInfo.hasActive).toBe(true);
      expect(nodeInfo.hasGhost).toBe(false);
    }

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/03-zoom-18-individual-nodes.png`,
      fullPage: false,
    });
  });

  test('cluster features expose the canonical grouped metadata at zoom 13', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    await page.evaluate(
      ({ center, zoom }) => {
        const map = window.__mapInstance;
        if (map) {
          map.jumpTo({ center, zoom, pitch: 0, bearing: 0 });
        }
      },
      { center: EINDHOVEN_CENTER, zoom: 13 }
    );

    await waitForMapIdle(page);

    // Verify cluster features expose the canonical grouped metadata contract.
    const clusterData = await page.evaluate(
      ({ layer, previewLimit }) => {
        const map = window.__mapInstance;
        if (!map || !map.getLayer(layer)) return [];
        const parseIds = (value: unknown): string[] => {
          if (typeof value === 'string') {
            return value.split(',').filter(Boolean);
          }
          if (Array.isArray(value)) {
            return value.filter(
              (item): item is string => typeof item === 'string' && item.length > 0
            );
          }
          return [];
        };
        const parseOptionalBoolean = (value: unknown): boolean | null => {
          if (typeof value === 'boolean') return value;
          if (typeof value === 'string') {
            if (value.toLowerCase() === 'true') return true;
            if (value.toLowerCase() === 'false') return false;
          }
          if (typeof value === 'number') {
            if (value === 1) return true;
            if (value === 0) return false;
          }
          return null;
        };
        const features = map.queryRenderedFeatures(undefined, { layers: [layer] });
        return features.slice(0, 5).map((f) => {
          const pointCount = Number(f.properties?.point_count ?? 0);
          const membershipComplete = parseOptionalBoolean(f.properties?.membership_complete);
          const readStateCoverage =
            typeof f.properties?.read_state_coverage === 'string'
              ? f.properties.read_state_coverage
              : membershipComplete === true
                ? 'complete'
                : 'partial';
          return {
            node_class: f.properties?.node_class,
            group_kind: f.properties?.group_kind,
            primary_property_id: f.properties?.primary_property_id,
            point_count: pointCount,
            property_ids_length: parseIds(f.properties?.property_ids).length,
            preview_property_ids_length: parseIds(f.properties?.preview_property_ids).length,
            membership_complete: membershipComplete ?? readStateCoverage === 'complete',
            read_state_coverage: readStateCoverage,
            is_previewable: pointCount > 1 && pointCount <= previewLimit,
          };
        });
      },
      { layer: MAP_LAYER_NAMES.CLUSTERS, previewLimit: PROPERTY_PREVIEW_MEMBER_LIMIT }
    );

    console.log(`Z13: ${clusterData.length} clusters queried`);

    if (clusterData.length > 0) {
      for (const cluster of clusterData) {
        expect(cluster.node_class).toBe('active');
        expect(cluster.group_kind).toBe('cluster');
        expect(cluster.primary_property_id).toBeTruthy();
        expect(cluster.point_count).toBeGreaterThan(1);
        expect(['complete', 'partial']).toContain(cluster.read_state_coverage);

        if (cluster.is_previewable) {
          expect(cluster.preview_property_ids_length).toBeGreaterThan(1);
          expect(cluster.preview_property_ids_length).toBeLessThanOrEqual(cluster.point_count);
        }

        if (cluster.membership_complete === true || cluster.read_state_coverage === 'complete') {
          expect(cluster.property_ids_length).toBeGreaterThan(1);
        }

        console.log(
          `  Cluster: point_count=${cluster.point_count}, property_ids=${cluster.property_ids_length}, preview_ids=${cluster.preview_property_ids_length}, membership_complete=${cluster.membership_complete}, read_state_coverage=${cluster.read_state_coverage}, primary=${cluster.primary_property_id}`
        );
      }
    }

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/04-zoom-13-cluster-data.png`,
      fullPage: false,
    });
  });
});
