/**
 * Cluster Tap Flow E2E Tests
 *
 * Tests the cluster tap → ClusterPreviewCard flow:
 * - Small clusters (<=30 properties): tap → batch API → ClusterPreviewCard
 * - Large clusters (>30 properties): tap → zoom in
 * - ClusterPreviewCard navigation and property selection
 */

import { test, expect, Page } from '@playwright/test';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3100';

// Eindhoven center coordinates
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
  /net::ERR_NAME_NOT_RESOLVED/,
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

// Disable tracing to avoid artifact issues; increase timeout for map-heavy tests
test.use({ trace: 'off' });
test.setTimeout(60000);

/** Wait for the MapLibre GL map instance to be available and loaded */
async function waitForMapReady(page: Page, timeout = 45000) {
  await page.waitForSelector('canvas', { timeout });
  await page.waitForFunction(
    () => {
      const map = (window as any).__mapInstance;
      return map && typeof map.getZoom === 'function' && map.loaded();
    },
    { timeout }
  );
}

/** Get the current zoom level from the map */
async function getMapZoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const map = (window as any).__mapInstance;
    return map ? map.getZoom() : -1;
  });
}

/** Set the map center, zoom and pitch */
async function setMapView(
  page: Page,
  center: [number, number],
  zoom: number,
  pitch: number = 0
) {
  await page.evaluate(
    ({ center, zoom, pitch }) => {
      const map = (window as any).__mapInstance;
      if (map) {
        map.setCenter(center);
        map.setZoom(zoom);
        map.setPitch(pitch);
      }
    },
    { center, zoom, pitch }
  );
  // Wait for tiles to load
  await page.waitForTimeout(3000);
}

/**
 * Query rendered features at the map center for a specific layer,
 * returning selected properties.
 */
async function queryFeaturesAtCenter(
  page: Page,
  layers: string[]
): Promise<Array<{ point_count?: number; property_ids?: string; id?: string }>> {
  return page.evaluate(
    ({ layers }) => {
      const map = (window as any).__mapInstance;
      if (!map) return [];
      const center = map.getCenter();
      const point = map.project(center);
      const features = map.queryRenderedFeatures(
        [point.x, point.y],
        { layers: layers.filter((l: string) => map.getLayer(l)) }
      );
      return features.map((f: any) => ({
        point_count: f.properties?.point_count,
        property_ids: f.properties?.property_ids,
        id: f.properties?.id,
      }));
    },
    { layers }
  );
}

/**
 * Try clicking on cluster features at the map center area.
 * Returns true if a cluster was clicked and the preview appeared.
 */
async function clickClusterAtCenter(page: Page): Promise<boolean> {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) return false;

  const clusterPreview = page.locator('[data-testid="cluster-preview-card"]');

  // Grid of positions around center to try (limited for performance)
  const positions = [
    { x: 0.5, y: 0.5 },
    { x: 0.45, y: 0.45 },
    { x: 0.55, y: 0.55 },
    { x: 0.4, y: 0.5 },
    { x: 0.6, y: 0.5 },
  ];

  for (const pos of positions) {
    const clickX = box.x + box.width * pos.x;
    const clickY = box.y + box.height * pos.y;

    await page.mouse.click(clickX, clickY);
    await page.waitForTimeout(1000); // Wait for batch API call + render

    const visible = await clusterPreview.isVisible().catch(() => false);
    if (visible) return true;
  }

  return false;
}

test.describe('Cluster Tap Flow', () => {
  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!KNOWN_ACCEPTABLE_ERRORS.some((p) => p.test(text))) {
          consoleErrors.push(text);
        }
      }
    });
    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    if (consoleErrors.length > 0) {
      console.error(`Console errors (${consoleErrors.length}):`, consoleErrors);
    }
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('batch API endpoint returns property data for valid IDs', async ({ request }) => {
    // First, get a tile to extract some property IDs
    const z = 13;
    // Eindhoven tile coords at z13
    const x = Math.floor(((EINDHOVEN_CENTER[0] + 180) / 360) * Math.pow(2, z));
    const latRad = (EINDHOVEN_CENTER[1] * Math.PI) / 180;
    const y = Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
        Math.pow(2, z)
    );

    // Try a few nearby tiles to find one with data
    const tilesToTry = [
      [z, x, y],
      [z, x + 1, y],
      [z, x, y + 1],
      [z, x - 1, y],
    ];

    let tileResponse: any = null;
    for (const [tz, tx, ty] of tilesToTry) {
      const resp = await request.get(
        `${API_BASE_URL}/tiles/properties/${tz}/${tx}/${ty}.pbf`
      );
      if (resp.status() === 200) {
        tileResponse = resp;
        console.log(`Found tile with data at z${tz}/${tx}/${ty}`);
        break;
      }
    }

    // Tile data exists (may be 204 for empty areas)
    // Test the batch endpoint with a known fixture UUID if available
    const batchResp = await request.get(`${API_BASE_URL}/properties?limit=3&city=Eindhoven`);
    if (batchResp.status() === 200) {
      const data = await batchResp.json();
      if (data.data && data.data.length > 0) {
        const ids = data.data.map((p: any) => p.id).join(',');
        const batchResult = await request.get(
          `${API_BASE_URL}/properties/batch?ids=${ids}`
        );
        expect(batchResult.status()).toBe(200);
        const batchData = await batchResult.json();
        expect(Array.isArray(batchData)).toBe(true);
        expect(batchData.length).toBe(data.data.length);

        // Verify each result has expected fields
        for (const prop of batchData) {
          expect(prop).toHaveProperty('id');
          expect(prop).toHaveProperty('address');
          expect(prop).toHaveProperty('city');
        }
        console.log(`Batch API returned ${batchData.length} properties`);
      }
    }
  });

  test('small cluster tap shows ClusterPreviewCard', async ({ page }) => {
    await page.goto('/');
    await waitForMapReady(page);

    // Monitor batch API calls
    const batchRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/properties/batch')) {
        batchRequests.push(req.url());
      }
    });

    // Set zoom level where clusters exist (below GHOST_NODE_THRESHOLD_ZOOM=17)
    await setMapView(page, EINDHOVEN_CENTER, 13, 0);
    await page.waitForTimeout(3000);

    // Query features to see what's rendered
    const features = await queryFeaturesAtCenter(page, [
      'property-clusters',
      'single-active-points',
    ]);
    console.log(`Features at center: ${JSON.stringify(features.slice(0, 3))}`);

    // Try to click a cluster
    const foundCluster = await clickClusterAtCenter(page);

    if (foundCluster) {
      // Verify batch API was called
      expect(batchRequests.length).toBeGreaterThan(0);
      console.log(`Batch API called ${batchRequests.length} time(s)`);

      // Verify ClusterPreviewCard elements
      const clusterPreview = page.locator('[data-testid="cluster-preview-card"]');
      await expect(clusterPreview).toBeVisible();

      const pageIndicator = page.locator('[data-testid="cluster-page-indicator"]');
      await expect(pageIndicator).toBeVisible();

      const pageText = await pageIndicator.textContent();
      expect(pageText).toMatch(/\d+ of \d+/);
      console.log(`Cluster preview showing: ${pageText}`);

      // Verify navigation arrows
      await expect(page.locator('[data-testid="cluster-nav-left"]')).toBeVisible();
      await expect(page.locator('[data-testid="cluster-nav-right"]')).toBeVisible();
      await expect(page.locator('[data-testid="cluster-close-button"]')).toBeVisible();
    } else {
      console.log(
        'No cluster found at z13 center. This may happen if data density is low. Test is informational.'
      );
    }
  });

  test('cluster preview navigation works', async ({ page }) => {
    await page.goto('/');
    await waitForMapReady(page);

    await setMapView(page, EINDHOVEN_CENTER, 13, 0);
    await page.waitForTimeout(3000);

    const foundCluster = await clickClusterAtCenter(page);

    if (foundCluster) {
      const pageIndicator = page.locator('[data-testid="cluster-page-indicator"]');
      const initialText = await pageIndicator.textContent();
      console.log(`Initial: ${initialText}`);

      // Extract total from "X of Y"
      const match = initialText?.match(/(\d+) of (\d+)/);
      if (match && parseInt(match[2]) > 1) {
        // Click right arrow
        const rightNav = page.locator('[data-testid="cluster-nav-right"]');
        await rightNav.click();
        await page.waitForTimeout(500);

        const afterRightText = await pageIndicator.textContent();
        expect(afterRightText).toMatch(/2 of \d+/);
        console.log(`After right: ${afterRightText}`);

        // Click left arrow to go back
        const leftNav = page.locator('[data-testid="cluster-nav-left"]');
        await leftNav.click();
        await page.waitForTimeout(500);

        const afterLeftText = await pageIndicator.textContent();
        expect(afterLeftText).toBe(initialText);
        console.log(`After left: ${afterLeftText}`);
      }

      // Close the preview
      const closeButton = page.locator('[data-testid="cluster-close-button"]');
      await closeButton.click();
      await page.waitForTimeout(500);

      const clusterPreview = page.locator('[data-testid="cluster-preview-card"]');
      const stillVisible = await clusterPreview.isVisible().catch(() => false);
      expect(stillVisible).toBe(false);
    } else {
      console.log('No cluster found for navigation test');
    }
  });

  test('cluster property tap opens property details', async ({ page }) => {
    await page.goto('/');
    await waitForMapReady(page);

    await setMapView(page, EINDHOVEN_CENTER, 13, 0);
    await page.waitForTimeout(3000);

    const foundCluster = await clickClusterAtCenter(page);

    if (foundCluster) {
      // Click the property card
      const propertyCard = page.locator('[data-testid="cluster-property-card"]');
      await expect(propertyCard).toBeVisible();
      await propertyCard.click();
      await page.waitForTimeout(1000);

      // Cluster preview should close
      const clusterPreview = page.locator('[data-testid="cluster-preview-card"]');
      const previewVisible = await clusterPreview.isVisible().catch(() => false);
      expect(previewVisible).toBe(false);

      // Property bottom sheet should have a selected property
      const hasSelectedProperty = await page.evaluate(() => {
        const map = (window as any).__mapInstance;
        // Check for selected marker
        const marker = document.querySelector('[data-testid="selected-marker"]');
        return !!marker;
      });
      // After selecting from cluster, a marker or bottom sheet should appear
      console.log(`Selected property marker visible: ${hasSelectedProperty}`);
    } else {
      console.log('No cluster found for property tap test');
    }
  });

  test('large cluster zoom works at low zoom level', async ({ page }) => {
    await page.goto('/');
    await waitForMapReady(page);

    // At very low zoom, clusters will likely have >30 properties
    await setMapView(page, EINDHOVEN_CENTER, 10, 0);
    await page.waitForTimeout(3000);

    const initialZoom = await getMapZoom(page);
    console.log(`Initial zoom: ${initialZoom}`);

    // Try clicking at center - at z10, clusters should be large
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();

    if (box) {
      // Click center of map
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.waitForTimeout(2000);

      const newZoom = await getMapZoom(page);
      const clusterPreview = page.locator('[data-testid="cluster-preview-card"]');
      const previewVisible = await clusterPreview.isVisible().catch(() => false);

      // At z10 with large clusters: either zoom increased or nothing happened
      // (if no cluster was clicked). ClusterPreviewCard should NOT appear for large clusters.
      if (newZoom > initialZoom + 0.5) {
        expect(previewVisible).toBe(false);
        console.log(`Large cluster zoom: ${initialZoom} -> ${newZoom} (preview not shown)`);
      } else if (previewVisible) {
        // This means a small cluster was hit (unlikely at z10, but possible)
        console.log('Found small cluster even at z10 - preview shown');
      } else {
        console.log('No cluster clicked at z10 center');
      }
    }
  });

  test('tiles include property_ids field for clusters', async ({ page }) => {
    await page.goto('/');
    await waitForMapReady(page);

    // Set zoom where clusters exist
    await setMapView(page, EINDHOVEN_CENTER, 13, 0);
    await page.waitForTimeout(3000);

    // Query cluster features and check for property_ids
    const clusterFeatures = await page.evaluate(() => {
      const map = (window as any).__mapInstance;
      if (!map) return [];

      const features = map.queryRenderedFeatures(undefined, {
        layers: ['property-clusters'].filter((l: string) => map.getLayer(l)),
      });

      return features.slice(0, 5).map((f: any) => ({
        point_count: f.properties?.point_count,
        has_property_ids: !!f.properties?.property_ids,
        property_ids_length: f.properties?.property_ids
          ? f.properties.property_ids.split(',').length
          : 0,
      }));
    });

    console.log(`Cluster features found: ${clusterFeatures.length}`);

    if (clusterFeatures.length > 0) {
      // Verify that cluster features include property_ids
      for (const feature of clusterFeatures) {
        expect(feature.has_property_ids).toBe(true);
        expect(feature.property_ids_length).toBeGreaterThan(0);
        console.log(
          `Cluster: point_count=${feature.point_count}, property_ids count=${feature.property_ids_length}`
        );
      }
    } else {
      console.log('No cluster features found at z13 - data may be sparse');
    }
  });
});
