/**
 * Cluster Tap Flow E2E Tests
 *
 * Tests the cluster tap → GroupPreviewCard flow:
 * - Small clusters (<=30 properties): tap → batch API → GroupPreviewCard
 * - Large clusters (>30 properties): tap → zoom in
 * - GroupPreviewCard navigation and property selection
 */

import { test, expect, Page } from '@playwright/test';
import { PROPERTY_MAP_LAYERS, PROPERTY_PREVIEW_MEMBER_LIMIT } from '@huishype/shared';
import { getPlaywrightApiUrl } from '../helpers/runtime';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';
import type { MapFeature, WindowWithMapInstance } from '../helpers/map-instance';

const API_BASE_URL = getPlaywrightApiUrl();

// Eindhoven center coordinates
const EINDHOVEN_CENTER: [number, number] = [5.4697, 51.4416];
const LOW_ZOOM_CLUSTER_TARGETS: Array<{ name: string; center: [number, number] }> = [
  { name: 'Eindhoven', center: EINDHOVEN_CENTER },
  { name: 'Amsterdam', center: [4.9041, 52.3676] },
  { name: 'Rotterdam', center: [4.4777, 51.9244] },
  { name: 'Utrecht', center: [5.1214, 52.0907] },
  { name: 'The Hague', center: [4.3007, 52.0705] },
];

// Known acceptable console errors
const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

// Disable tracing to avoid artifact issues; increase timeout for map-heavy tests
test.use({ trace: 'off' });
test.setTimeout(120000);

/** Wait for the MapLibre GL map instance to be available and loaded */
async function waitForMapReady(page: Page, timeout = 60000) {
  await page.waitForSelector('canvas', { timeout });
  // First wait for the map instance to exist
  await page.waitForFunction(
    () => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      return map && typeof map.getZoom === 'function';
    },
    { timeout, polling: 500 }
  );
  // Then wait for it to be loaded (tiles/style downloaded)
  await page.waitForFunction(
    () => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      return map?.loaded?.() ?? false;
    },
    { timeout: Math.min(timeout, 30000), polling: 1000 }
  ).catch(() => {
    console.log('Map not fully loaded yet, continuing anyway');
  });
}

/** Get the current zoom level from the map */
async function getMapZoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const map = (window as WindowWithMapInstance).__mapInstance;
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
      const map = (window as WindowWithMapInstance).__mapInstance;
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

async function waitForPropertyTilesSettled(page: Page, timeout = 30000): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const map = (window as WindowWithMapInstance).__mapInstance;
        if (!map || !map.isStyleLoaded?.()) {
          return false;
        }

        const hasPropertiesSource = !!map.getSource?.('properties-source');
        if (!hasPropertiesSource) {
          return false;
        }

        return map.isSourceLoaded?.('properties-source') ?? false;
      },
      { timeout, polling: 500 }
    )
    .catch(() => {
      console.log('Property tile source did not report fully loaded before assertion window');
    });
}

type RenderedClusterCandidate = {
  layerId: string;
  pointCount: number;
  propertyIdCount: number;
  screenX: number;
  screenY: number;
  distanceToCenter: number;
};

type RenderedClusterFilters = {
  layerIds: string[];
  minPointCount: number;
  maxPointCount?: number;
  requireMultipleProperties?: boolean;
};

async function closeOpenPreview(page: Page): Promise<void> {
  const closeButtons = page.locator(
    '[data-testid="property-preview-close-button"]:visible, [data-testid="group-preview-close-button"]:visible'
  );

  const count = await closeButtons.count();
  if (count === 0) {
    return;
  }

  await closeButtons.first().click();
  await page.waitForTimeout(500);
}

async function getRenderedClusterCandidates(
  page: Page,
  filters: RenderedClusterFilters
): Promise<RenderedClusterCandidate[]> {
  return page.evaluate(
    ({ layerIds, minPointCount, maxPointCount, requireMultipleProperties }) => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map) {
        return [];
      }

      const canvas = map.getCanvas?.();
      if (!canvas) {
        return [];
      }

      const rect = canvas.getBoundingClientRect();
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const edgeMargin = 40;
      const existingLayerIds = layerIds.filter((layerId) => map.getLayer?.(layerId));
      const candidates: RenderedClusterCandidate[] = [];
      const seen = new Set<string>();

      for (const layerId of existingLayerIds) {
        const features = map.queryRenderedFeatures(
          [[0, 0], [canvas.width, canvas.height]],
          { layers: [layerId] }
        ) || [];

        for (const feature of features as MapFeature[]) {
          if (feature.geometry?.type !== 'Point') {
            continue;
          }

          const pointCount = Number(feature.properties?.point_count || 0);
          if (!Number.isFinite(pointCount) || pointCount < minPointCount) {
            continue;
          }

          if (typeof maxPointCount === 'number' && pointCount > maxPointCount) {
            continue;
          }

          const propertyIds = feature.properties?.property_ids;
          const propertyIdCount = typeof propertyIds === 'string'
            ? propertyIds.split(',').filter(Boolean).length
            : Array.isArray(propertyIds)
              ? propertyIds.length
              : 0;

          if (requireMultipleProperties && propertyIdCount <= 1) {
            continue;
          }

          const coordinates = feature.geometry.coordinates;
          if (
            !Array.isArray(coordinates) ||
            coordinates.length < 2 ||
            typeof coordinates[0] !== 'number' ||
            typeof coordinates[1] !== 'number'
          ) {
            continue;
          }

          const point = map.project([coordinates[0], coordinates[1]]);
          const inBounds =
            point.x >= edgeMargin &&
            point.x <= canvas.width - edgeMargin &&
            point.y >= edgeMargin &&
            point.y <= canvas.height - edgeMargin;

          if (!inBounds) {
            continue;
          }

          const dedupeKey = [
            layerId,
            String(feature.properties?.cluster_id ?? feature.properties?.id ?? `${coordinates[0]}:${coordinates[1]}`),
          ].join(':');

          if (seen.has(dedupeKey)) {
            continue;
          }
          seen.add(dedupeKey);

          candidates.push({
            layerId,
            pointCount,
            propertyIdCount,
            screenX: rect.left + point.x,
            screenY: rect.top + point.y,
            distanceToCenter: Math.hypot(point.x - centerX, point.y - centerY),
          });
        }
      }

      return candidates.sort((a, b) => a.distanceToCenter - b.distanceToCenter);
    },
    filters
  );
}

async function waitForRenderedClusterCandidate(
  page: Page,
  filters: RenderedClusterFilters,
  timeout = 25000
): Promise<void> {
  await page.waitForFunction(
    ({ layerIds, minPointCount, maxPointCount, requireMultipleProperties }) => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map || !map.isStyleLoaded?.()) {
        return false;
      }

      const canvas = map.getCanvas?.();
      if (!canvas) {
        return false;
      }

      const edgeMargin = 40;
      const existingLayerIds = layerIds.filter((layerId) => map.getLayer?.(layerId));
      if (existingLayerIds.length === 0) {
        return false;
      }

      return existingLayerIds.some((layerId) => {
        const features = map.queryRenderedFeatures(
          [[0, 0], [canvas.width, canvas.height]],
          { layers: [layerId] }
        ) || [];

        return features.some((feature: MapFeature) => {
          if (feature.geometry?.type !== 'Point') {
            return false;
          }

          const pointCount = Number(feature.properties?.point_count || 0);
          if (!Number.isFinite(pointCount) || pointCount < minPointCount) {
            return false;
          }

          if (typeof maxPointCount === 'number' && pointCount > maxPointCount) {
            return false;
          }

          const propertyIds = feature.properties?.property_ids;
          const propertyIdCount = typeof propertyIds === 'string'
            ? propertyIds.split(',').filter(Boolean).length
            : Array.isArray(propertyIds)
              ? propertyIds.length
              : 0;

          if (requireMultipleProperties && propertyIdCount <= 1) {
            return false;
          }

          const coordinates = feature.geometry.coordinates;
          if (
            !Array.isArray(coordinates) ||
            coordinates.length < 2 ||
            typeof coordinates[0] !== 'number' ||
            typeof coordinates[1] !== 'number'
          ) {
            return false;
          }

          const point = map.project([coordinates[0], coordinates[1]]);
          return (
            point.x >= edgeMargin &&
            point.x <= canvas.width - edgeMargin &&
            point.y >= edgeMargin &&
            point.y <= canvas.height - edgeMargin
          );
        });
      });
    },
    filters,
    { timeout, polling: 500 }
  );
}

async function openPreviewableCluster(page: Page): Promise<{
  success: boolean;
  pointCount?: number;
  candidatesTried?: number;
}> {
  const filters: RenderedClusterFilters = {
    layerIds: [PROPERTY_MAP_LAYERS.ACTIVE_CLUSTERS],
    minPointCount: 2,
    maxPointCount: PROPERTY_PREVIEW_MEMBER_LIMIT,
    requireMultipleProperties: true,
  };

  await waitForRenderedClusterCandidate(page, filters);
  const candidates = await getRenderedClusterCandidates(page, filters);
  console.log(`Previewable rendered clusters found: ${candidates.length}`);

  const pageIndicator = page.locator('[data-testid="group-preview-page-indicator"]');
  for (const candidate of candidates.slice(0, 10)) {
    await page.mouse.move(candidate.screenX, candidate.screenY);
    await page.mouse.click(candidate.screenX, candidate.screenY);

    const indicatorVisible = await pageIndicator
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    if (indicatorVisible) {
      return {
        success: true,
        pointCount: candidate.pointCount,
        candidatesTried: candidates.length,
      };
    }

    const propertyPreviewVisible = await page
      .locator('[data-testid="property-preview-card"]')
      .isVisible()
      .catch(() => false);
    console.log(
      `Cluster click did not open group preview: layer=${candidate.layerId} pointCount=${candidate.pointCount} propertyIds=${candidate.propertyIdCount} propertyPreviewVisible=${propertyPreviewVisible}`
    );
    await closeOpenPreview(page);
  }

  return { success: false, candidatesTried: candidates.length };
}

async function getLargestRenderedCluster(page: Page): Promise<
  | ({ success: true } & RenderedClusterCandidate)
  | { success: false }
> {
  const filters: RenderedClusterFilters = {
    layerIds: [PROPERTY_MAP_LAYERS.ACTIVE_CLUSTERS],
    minPointCount: 2,
  };

  const hasRenderedCluster = await waitForRenderedClusterCandidate(page, filters)
    .then(() => true)
    .catch(() => false);
  if (!hasRenderedCluster) {
    return { success: false };
  }

  const [candidate] = (await getRenderedClusterCandidates(page, filters)).sort(
    (a, b) => b.pointCount - a.pointCount || a.distanceToCenter - b.distanceToCenter
  );
  if (!candidate) {
    return { success: false };
  }

  return { success: true, ...candidate };
}

async function findLargeLowZoomCluster(page: Page): Promise<
  | ({ success: true; targetName: string } & RenderedClusterCandidate)
  | { success: false; attempts: string[]; largestPointCount: number }
> {
  const attempts: string[] = [];
  let largestPointCount = 0;

  for (const target of LOW_ZOOM_CLUSTER_TARGETS) {
    await closeOpenPreview(page);
    await setMapView(page, target.center, 10, 0);
    await waitForPropertyTilesSettled(page);

    const largeClusterFilters: RenderedClusterFilters = {
      layerIds: [PROPERTY_MAP_LAYERS.ACTIVE_CLUSTERS],
      minPointCount: PROPERTY_PREVIEW_MEMBER_LIMIT + 1,
    };
    const hasLargeCluster = await waitForRenderedClusterCandidate(
      page,
      largeClusterFilters,
      30000
    )
      .then(() => true)
      .catch(() => false);

    const largestCluster = await getLargestRenderedCluster(page);
    const largeCandidates = await getRenderedClusterCandidates(page, largeClusterFilters);
    if (largestCluster.success) {
      largestPointCount = Math.max(largestPointCount, largestCluster.pointCount);
      attempts.push(
        `${target.name}: largest point_count=${largestCluster.pointCount}; large candidates=${largeCandidates.length}`
      );
    } else {
      attempts.push(`${target.name}: no rendered clusters`);
    }

    const [actionableCluster] = largeCandidates;
    if (hasLargeCluster && actionableCluster) {
      return {
        success: true,
        ...actionableCluster,
        targetName: target.name,
      };
    }
  }

  return { success: false, attempts, largestPointCount };
}

test.describe('Cluster Tap Flow', () => {
  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!isAllowedConsoleMessage(text, KNOWN_ACCEPTABLE_ERRORS)) {
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

    for (const [tz, tx, ty] of tilesToTry) {
      const resp = await request.get(
        `${API_BASE_URL}/tiles/properties/${tz}/${tx}/${ty}.pbf`
      );
      if (resp.status() === 200) {
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
        const ids = data.data.map((p: { id: string }) => p.id).join(',');
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

  test('small cluster tap shows GroupPreviewCard', async ({ page }) => {
    await page.goto('/', { timeout: 60000 });
    await waitForMapReady(page);

    // Monitor batch API calls
    const batchRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/properties/batch')) {
        batchRequests.push(req.url());
      }
    });

    // Set a zoom level where dense active groups still cluster.
    await setMapView(page, EINDHOVEN_CENTER, 13, 0);
    await page.waitForTimeout(3000);

    const previewResult = await openPreviewableCluster(page);
    expect(
      previewResult.success,
      `Expected to find a rendered previewable cluster. Tried ${previewResult.candidatesTried ?? 0} candidates.`
    ).toBe(true);

    // Verify batch API was called
    expect(batchRequests.length).toBeGreaterThan(0);
    console.log(
      `Batch API called ${batchRequests.length} time(s) for cluster point_count=${previewResult.pointCount}`
    );

    // Verify GroupPreviewCard elements
    const clusterPreview = page.locator('[data-testid="group-preview-card"]');
    await expect(clusterPreview).toBeVisible();

    const pageIndicator = page.locator('[data-testid="group-preview-page-indicator"]');
    await expect(pageIndicator).toBeVisible();

    const pageText = await pageIndicator.textContent();
    expect(pageText).toMatch(/\d+ of \d+/);
    console.log(`Cluster preview showing: ${pageText}`);

    // Verify navigation arrows
    await expect(page.locator('[data-testid="group-preview-nav-left"]')).toBeVisible();
    await expect(page.locator('[data-testid="group-preview-nav-right"]')).toBeVisible();
    await expect(page.locator('[data-testid="group-preview-close-button"]')).toBeVisible();
  });

  test('cluster preview navigation works', async ({ page }) => {
    await page.goto('/', { timeout: 60000 });
    await waitForMapReady(page);

    await setMapView(page, EINDHOVEN_CENTER, 13, 0);
    await page.waitForTimeout(3000);

    const previewResult = await openPreviewableCluster(page);
    expect(previewResult.success, 'Expected to find a rendered cluster for navigation test').toBe(
      true
    );

    const pageIndicator = page.locator('[data-testid="group-preview-page-indicator"]');
    const initialText = await pageIndicator.textContent();
    console.log(`Initial: ${initialText}`);

    // Extract total from "X of Y"
    const match = initialText?.match(/(\d+) of (\d+)/);
    if (match && parseInt(match[2]) > 1) {
      // Click right arrow
      const rightNav = page.locator('[data-testid="group-preview-nav-right"]');
      await rightNav.click();
      await page.waitForTimeout(500);

      const afterRightText = await pageIndicator.textContent();
      expect(afterRightText).toMatch(/2 of \d+/);
      console.log(`After right: ${afterRightText}`);

      // Click left arrow to go back
      const leftNav = page.locator('[data-testid="group-preview-nav-left"]');
      await leftNav.click();
      await page.waitForTimeout(500);

      const afterLeftText = await pageIndicator.textContent();
      expect(afterLeftText).toBe(initialText);
      console.log(`After left: ${afterLeftText}`);
    }

    // Close the preview
    const closeButton = page.locator('[data-testid="group-preview-close-button"]');
    await closeButton.click();
    await page.waitForTimeout(500);

    const clusterPreview = page.locator('[data-testid="group-preview-card"]');
    const stillVisible = await clusterPreview.isVisible().catch(() => false);
    expect(stillVisible).toBe(false);
  });

  test('cluster property tap opens property details', async ({ page }) => {
    await page.goto('/', { timeout: 60000 });
    await waitForMapReady(page);

    await setMapView(page, EINDHOVEN_CENTER, 13, 0);
    await page.waitForTimeout(3000);

    const previewResult = await openPreviewableCluster(page);
    expect(previewResult.success, 'Expected to find a rendered cluster for property tap test').toBe(
      true
    );

    // Click the property card
    const propertyCard = page.locator('[data-testid="property-preview-card"]');
    await expect(propertyCard).toBeVisible();
    await propertyCard.click();
    await page.waitForTimeout(1000);

    // Preview remains visible while the property is selected and the sheet expands.
    const clusterPreview = page.locator('[data-testid="group-preview-card"]');
    const previewVisible = await clusterPreview.isVisible().catch(() => false);
    expect(previewVisible).toBe(true);

    // Property bottom sheet should have a selected property
    const hasSelectedProperty = await page.evaluate(() => {
      // Check for selected marker
      const marker = document.querySelector('[data-testid="selected-marker"]');
      return !!marker;
    });
    // After selecting from cluster, a marker or bottom sheet should appear
    console.log(`Selected property marker visible: ${hasSelectedProperty}`);
  });

  test('large low-zoom cluster tap is handled deterministically', async ({ page }) => {
    await page.goto('/', { timeout: 60000 });
    await waitForMapReady(page);

    const largeCluster = await findLargeLowZoomCluster(page);
    expect(
      largeCluster.success,
      largeCluster.success
        ? undefined
        : [
            'Expected a rendered z10 cluster larger than the preview limit.',
            'Low-zoom property tiles must render deterministically instead of skipping this flow.',
            `Largest point_count observed: ${largeCluster.largestPointCount}`,
            `Attempts: ${largeCluster.attempts.join('; ')}`,
          ].join(' ')
    ).toBe(true);

    if (!largeCluster.success) {
      return;
    }

    const initialZoom = await getMapZoom(page);
    console.log(
      `Initial zoom: ${initialZoom}; target=${largeCluster.targetName}; point_count=${largeCluster.pointCount}`
    );

    await page.mouse.move(largeCluster.screenX, largeCluster.screenY);
    await page.mouse.click(largeCluster.screenX, largeCluster.screenY);

    await page
      .waitForFunction(
        ({ initialZoom }) => {
          const map = (window as WindowWithMapInstance).__mapInstance;
          const preview = document.querySelector('[data-testid="group-preview-card"]');
          return !!preview || (map?.getZoom?.() ?? 0) > initialZoom + 0.5;
        },
        { initialZoom },
        { timeout: 5000, polling: 250 }
      )
      .catch(() => undefined);

    const newZoom = await getMapZoom(page);
    const clusterPreview = page.locator('[data-testid="group-preview-card"]');
    const previewVisible = await clusterPreview.isVisible().catch(() => false);
    const tapHandled = previewVisible || newZoom > initialZoom + 0.5;

    expect(
      tapHandled,
      `Expected low-zoom cluster tap to open preview or zoom in; zoom ${initialZoom} -> ${newZoom}, previewVisible=${previewVisible}, point_count=${largeCluster.pointCount}`
    ).toBe(true);
    console.log(
      `Large cluster handled: ${initialZoom} -> ${newZoom}, previewVisible=${previewVisible} (point_count=${largeCluster.pointCount})`
    );
  });

  test('tiles include property_ids field for clusters', async ({ page }) => {
    await page.goto('/', { timeout: 60000 });
    await waitForMapReady(page);

    // Set zoom where clusters exist
    await setMapView(page, EINDHOVEN_CENTER, 13, 0);
    await page.waitForTimeout(3000);

    // Query cluster features and check for property_ids
    const clusterFeatures = await page.evaluate(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map) return [];

      const features = map.queryRenderedFeatures(undefined, {
        layers: ['property-clusters'].filter((layer: string) => map.getLayer(layer)),
      });

      return features.slice(0, 5).map((feature: MapFeature) => ({
        point_count: feature.properties?.point_count,
        has_property_ids: !!feature.properties?.property_ids,
        property_ids_length: (() => {
          const propertyIds = feature.properties?.property_ids;
          if (!propertyIds) {
            return 0;
          }

          if (typeof propertyIds === 'string') {
            return propertyIds.split(',').filter(Boolean).length;
          }

          return propertyIds.length;
        })(),
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
