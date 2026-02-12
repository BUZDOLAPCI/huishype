/**
 * Flow E2E Test: Map to Property
 *
 * Tests the map interaction flow leading to property selection:
 * - Zoom to property level (z17+) and see rendered property markers
 * - Click on map at property location to trigger preview card
 * - Preview card shows real address data (not placeholders)
 * - Property layers exist at correct zoom levels
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { waitForMapStyleLoaded, waitForMapIdle } from '../visual/helpers/visual-test-helpers';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3100';

// Screenshot output directory
const SCREENSHOT_DIR = 'test-results/flows';

// Eindhoven center where seeded data exists
const EINDHOVEN_CENTER: [number, number] = [5.4697, 51.4416];

// z17+ shows individual property points with is_ghost
const PROPERTY_ZOOM = 17;

// Known acceptable console errors
const KNOWN_ACCEPTABLE_ERRORS: RegExp[] = [
  /ResizeObserver loop/,
  /sourceMappingURL/,
  /Failed to parse source map/,
  /Fast Refresh/,
  /\[HMR\]/,
  /WebSocket connection/,
  /net::ERR_ABORTED/,
  /net::ERR_NAME_NOT_RESOLVED/,
  /AJAXError/,
  /\.pbf/,
  /tiles\.openfreemap\.org/,
  /pointerEvents is deprecated/,
  /GL Driver Message/,
  /Expected value to be of type/,
  /Failed to load resource.*\/sprites\//,
];

// Disable tracing to avoid artifact issues
test.use({ trace: 'off' });

test.describe('Map to Property Flow', () => {
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

  test('zoom to property level and see markers', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    // Wait for map style to load
    await waitForMapStyleLoaded(page);

    // Zoom to property level centered on Eindhoven
    const mapConfigured = await page.evaluate(
      ({ center, zoom }) => {
        const map = (window as any).__mapInstance;
        if (map && typeof map.setZoom === 'function') {
          map.setCenter(center);
          map.setZoom(zoom);
          return true;
        }
        return false;
      },
      { center: EINDHOVEN_CENTER, zoom: PROPERTY_ZOOM }
    );
    expect(mapConfigured, 'Map instance should be available for JS control').toBe(true);

    // Wait for tiles to load after zoom change
    await waitForMapIdle(page, 10000);
    await page.waitForTimeout(2000);

    // Verify zoom level
    const actualZoom = await page.evaluate(() => {
      const map = (window as any).__mapInstance;
      return map?.getZoom?.() ?? 0;
    });
    expect(actualZoom).toBeGreaterThanOrEqual(17);

    // Wait for property features to render
    await page.waitForFunction(
      () => {
        const map = (window as any).__mapInstance;
        if (!map || !map.isStyleLoaded()) return false;
        const canvas = map.getCanvas();
        if (!canvas) return false;

        const layerIds = ['ghost-nodes', 'active-nodes', 'property-clusters', 'single-active-points']
          .filter((l) => map.getLayer(l));
        if (layerIds.length === 0) return false;

        try {
          const features = map.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers: layerIds }
          );
          return (features?.length || 0) > 0;
        } catch {
          return false;
        }
      },
      { timeout: 30000 }
    );

    await page.screenshot({ path: `${SCREENSHOT_DIR}/map-zoomed-markers.png` });

    // Query for rendered features count
    const featureCounts = await page.evaluate(() => {
      const map = (window as any).__mapInstance;
      if (!map) return { ghost: 0, active: 0, clusters: 0 };
      const canvas = map.getCanvas();

      let ghost = 0, active = 0, clusters = 0;
      try {
        if (map.getLayer('ghost-nodes')) {
          ghost = (map.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers: ['ghost-nodes'] }
          ) || []).length;
        }
      } catch { /* ignore */ }
      try {
        if (map.getLayer('active-nodes')) {
          active = (map.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers: ['active-nodes'] }
          ) || []).length;
        }
      } catch { /* ignore */ }
      try {
        if (map.getLayer('property-clusters')) {
          clusters = (map.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers: ['property-clusters'] }
          ) || []).length;
        }
      } catch { /* ignore */ }

      return { ghost, active, clusters };
    });

    console.log('Feature counts at z17:', featureCounts);

    // At z17+ in Eindhoven, we should have property features rendered
    const totalFeatures = featureCounts.ghost + featureCounts.active;
    expect(totalFeatures, 'Should have rendered property features at z17+').toBeGreaterThan(0);
  });

  test('property layers exist in map style', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    // Zoom to property level to trigger layer loading
    await page.evaluate(({ center, zoom }) => {
      const map = (window as any).__mapInstance;
      if (map) {
        map.setCenter(center);
        map.setZoom(zoom);
      }
    }, { center: EINDHOVEN_CENTER, zoom: PROPERTY_ZOOM });

    await waitForMapIdle(page, 10000);
    await page.waitForTimeout(2000);

    // Check that the expected property layers exist
    const layerInfo = await page.evaluate(() => {
      const map = (window as any).__mapInstance;
      if (!map) return null;
      const style = map.getStyle();
      const layers = style?.layers || [];

      const propertyLayers = layers.filter((l: any) =>
        l.id === 'ghost-nodes' ||
        l.id === 'active-nodes' ||
        l.id === 'property-clusters' ||
        l.id === 'single-active-points' ||
        l.id === 'cluster-count'
      );

      return {
        totalLayers: layers.length,
        propertyLayerIds: propertyLayers.map((l: any) => l.id),
        sources: Object.keys(style?.sources || {}),
      };
    });

    console.log('Layer info:', layerInfo);

    expect(layerInfo).not.toBeNull();
    expect(layerInfo!.propertyLayerIds).toContain('ghost-nodes');
    expect(layerInfo!.propertyLayerIds).toContain('active-nodes');
    expect(layerInfo!.sources).toContain('properties-source');
  });

  test('click on property marker shows preview card', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    // Zoom to Eindhoven property level with flat view for accurate click positioning
    await page.evaluate(({ center, zoom }) => {
      const map = (window as any).__mapInstance;
      if (map) {
        map.jumpTo({ center, zoom, pitch: 0, bearing: 0 });
      }
    }, { center: EINDHOVEN_CENTER, zoom: PROPERTY_ZOOM });

    await waitForMapIdle(page, 10000);
    await page.waitForTimeout(3000);

    // Find a rendered feature to click on
    const featureInfo = await page.evaluate(() => {
      const map = (window as any).__mapInstance;
      if (!map) return null;
      const canvas = map.getCanvas();
      const canvasRect = canvas.getBoundingClientRect();

      const layerIds = ['ghost-nodes', 'active-nodes', 'single-active-points', 'property-clusters']
        .filter((l: string) => map.getLayer(l));
      if (layerIds.length === 0) return null;

      const features = map.queryRenderedFeatures(
        [[0, 0], [canvas.width, canvas.height]],
        { layers: layerIds }
      );
      if (!features || features.length === 0) return null;

      // Find a point feature well within the viewport
      for (const feature of features) {
        if (feature.geometry?.type !== 'Point') continue;
        const point = map.project(feature.geometry.coordinates);
        // Must be well within the visible canvas (not on edges)
        if (point.x > 50 && point.x < canvas.clientWidth - 50 &&
            point.y > 50 && point.y < canvas.clientHeight - 50) {
          return {
            // Viewport coordinates = map-relative + canvas offset
            viewportX: Math.round(point.x + canvasRect.x),
            viewportY: Math.round(point.y + canvasRect.y),
            id: feature.properties?.id || feature.properties?.property_ids?.split(',')[0],
            layerId: feature.layer?.id,
          };
        }
      }
      return null;
    });

    console.log('Feature to click:', featureInfo);
    expect(featureInfo, 'Should find a clickable property feature').not.toBeNull();

    // Click at the feature's viewport coordinates
    await page.mouse.click(featureInfo!.viewportX, featureInfo!.viewportY);

    // Wait for the preview card to appear (API fetch + render)
    await page.waitForSelector('[data-testid="group-preview-card"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid="selected-marker"]', { timeout: 5000 });

    await page.screenshot({ path: `${SCREENSHOT_DIR}/map-click-preview.png` });

    // Verify preview card has real property data
    const previewCard = page.locator('[data-testid="group-preview-card"]');
    await expect(previewCard).toBeVisible();

    const cardText = await previewCard.textContent() || '';
    // Card should contain an address (not empty, not a BAG ID)
    expect(cardText.length).toBeGreaterThan(5);
    expect(cardText).not.toMatch(/^0\d{15}$/);

    // Verify the selected marker (pulsing dot) is visible
    const selectedMarker = page.locator('[data-testid="selected-marker"]');
    await expect(selectedMarker).toBeVisible();

    // Verify the preview card persists (not immediately dismissed)
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid="group-preview-card"]')).toBeVisible();
  });

  test('API properties endpoint returns data for Eindhoven', async ({ request }) => {
    // Verify the API has Eindhoven properties (prerequisite for map tests)
    // Spatial queries can be slow under load, so use a generous timeout
    const response = await request.get(
      `${API_BASE_URL}/properties?lat=51.4416&lon=5.4697&radius=2000&limit=10`,
      { timeout: 60000 }
    );
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty('data');
    expect(data.data.length).toBeGreaterThan(0);

    // Verify properties have addresses
    const firstProperty = data.data[0];
    expect(firstProperty).toHaveProperty('address');
    expect(firstProperty).toHaveProperty('city');
    expect(firstProperty.address).toBeTruthy();

    console.log(
      `API returned ${data.data.length} properties near Eindhoven center. ` +
      `First: ${firstProperty.address}, ${firstProperty.city}`
    );
  });
});
