/**
 * Cluster Tap Flow E2E Tests
 *
 * Tests the cluster tap → GroupPreviewCard flow:
 * - Complete previewable clusters: tap → batch API → GroupPreviewCard
 * - Large or incomplete low-zoom clusters: tap → zoom in
 * - GroupPreviewCard navigation and property selection
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { PROPERTY_MAP_LAYERS, PROPERTY_PREVIEW_MEMBER_LIMIT } from '@huishype/shared';
import { getPlaywrightApiUrl, getPlaywrightWebOrigin } from '../helpers/runtime';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';
import type { MapFeature, WindowWithMapInstance } from '../helpers/map-instance';

const API_BASE_URL = getPlaywrightApiUrl();
const WELCOME_MODAL_DISMISSED_KEY = 'huishype_welcome_modal_dismissed_v1';

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

// Disable tracing to avoid artifact issues; increase timeout for map-heavy tests.
// These map interaction flows are not first-run welcome-modal coverage.
test.use({
  trace: 'off',
  storageState: {
    cookies: [],
    origins: [
      {
        origin: getPlaywrightWebOrigin(),
        localStorage: [
          {
            name: WELCOME_MODAL_DISMISSED_KEY,
            value: '1',
          },
        ],
      },
    ],
  },
});
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
  await page
    .waitForFunction(
      () => {
        const map = (window as WindowWithMapInstance).__mapInstance;
        return map?.loaded?.() ?? false;
      },
      { timeout: Math.min(timeout, 30000), polling: 1000 }
    )
    .catch(() => {
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

function lonLatToTile(center: [number, number], zoom: number): { z: number; x: number; y: number } {
  const [lon, lat] = center;
  const scale = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * scale);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale
  );

  return { z: zoom, x, y };
}

async function getLowZoomTileMissStatuses(request: APIRequestContext) {
  const statuses = [];

  for (const target of LOW_ZOOM_CLUSTER_TARGETS) {
    const tile = lonLatToTile(target.center, 10);
    const response = await request.get(
      `${API_BASE_URL}/tiles/properties/${tile.z}/${tile.x}/${tile.y}.pbf`,
      { timeout: 30_000 }
    );
    statuses.push({
      target: target.name,
      status: response.status(),
      tileStatus: response.headers()['x-huishype-tile-status'] ?? null,
      tileCache: response.headers()['x-tile-cache'] ?? null,
    });
  }

  return statuses;
}

/** Set the map center, zoom and pitch */
async function setMapView(page: Page, center: [number, number], zoom: number, pitch: number = 0) {
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
  previewPropertyIdCount: number;
  membershipComplete: boolean | null;
  readStateCoverage: string | null;
  hasPyramidNode: boolean;
  estimatedZoom: number | null;
  hasBbox: boolean;
  screenX: number;
  screenY: number;
  distanceToCenter: number;
};

type RenderedClusterFilters = {
  layerIds: string[];
  minPointCount: number;
  maxPointCount?: number;
  requirePreviewableIds?: boolean;
  requireCompleteMembership?: boolean;
  requireZoomableBbox?: boolean;
  currentZoom?: number;
  previewMemberLimit?: number;
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
    ({
      layerIds,
      minPointCount,
      maxPointCount,
      requirePreviewableIds,
      requireCompleteMembership,
      requireZoomableBbox,
      currentZoom,
      previewMemberLimit = 30,
    }) => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map) {
        return [];
      }

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
        if (typeof value === 'boolean') {
          return value;
        }
        if (typeof value === 'string') {
          if (value.toLowerCase() === 'true') {
            return true;
          }
          if (value.toLowerCase() === 'false') {
            return false;
          }
        }
        if (typeof value === 'number') {
          if (value === 1) {
            return true;
          }
          if (value === 0) {
            return false;
          }
        }
        return null;
      };

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
        const features =
          map.queryRenderedFeatures(
            [
              [0, 0],
              [canvas.width, canvas.height],
            ],
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

          const propertyIdCount = parseIds(feature.properties?.property_ids).length;
          const previewPropertyIdCount = parseIds(feature.properties?.preview_property_ids).length;
          const membershipComplete = parseOptionalBoolean(feature.properties?.membership_complete);
          const readStateCoverage =
            typeof feature.properties?.read_state_coverage === 'string'
              ? feature.properties.read_state_coverage
              : null;
          const hasCompleteMembership =
            membershipComplete !== false &&
            readStateCoverage !== 'partial' &&
            propertyIdCount >= Math.min(pointCount, previewMemberLimit);
          const hasPreviewableIds =
            previewPropertyIdCount > 1 || (hasCompleteMembership && propertyIdCount > 1);

          if (requirePreviewableIds && !hasPreviewableIds) {
            continue;
          }

          if (requireCompleteMembership && !hasCompleteMembership) {
            continue;
          }

          const bboxWest = Number(feature.properties?.bbox_west);
          const bboxSouth = Number(feature.properties?.bbox_south);
          const bboxEast = Number(feature.properties?.bbox_east);
          const bboxNorth = Number(feature.properties?.bbox_north);
          const hasBbox = [bboxWest, bboxSouth, bboxEast, bboxNorth].every(Number.isFinite);
          const estimatedZoom = hasBbox
            ? Math.log2(
                360 /
                  Math.max(Math.abs(bboxEast - bboxWest), Math.abs(bboxNorth - bboxSouth), 0.0001)
              ) - 1
            : null;

          if (
            requireZoomableBbox &&
            (!hasBbox ||
              estimatedZoom == null ||
              typeof currentZoom !== 'number' ||
              estimatedZoom <= currentZoom + 0.5)
          ) {
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
            String(
              feature.properties?.cluster_id ??
                feature.properties?.id ??
                `${coordinates[0]}:${coordinates[1]}`
            ),
          ].join(':');

          if (seen.has(dedupeKey)) {
            continue;
          }
          seen.add(dedupeKey);

          candidates.push({
            layerId,
            pointCount,
            propertyIdCount,
            previewPropertyIdCount,
            membershipComplete,
            readStateCoverage,
            hasPyramidNode:
              typeof feature.properties?.pyramid_version_id === 'string' &&
              feature.properties.pyramid_version_id.length > 0 &&
              typeof feature.properties?.pyramid_node_id === 'string' &&
              feature.properties.pyramid_node_id.length > 0,
            estimatedZoom,
            hasBbox,
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
    ({
      layerIds,
      minPointCount,
      maxPointCount,
      requirePreviewableIds,
      requireCompleteMembership,
      requireZoomableBbox,
      currentZoom,
      previewMemberLimit = 30,
    }) => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map || !map.isStyleLoaded?.()) {
        return false;
      }

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
        if (typeof value === 'boolean') {
          return value;
        }
        if (typeof value === 'string') {
          if (value.toLowerCase() === 'true') {
            return true;
          }
          if (value.toLowerCase() === 'false') {
            return false;
          }
        }
        if (typeof value === 'number') {
          if (value === 1) {
            return true;
          }
          if (value === 0) {
            return false;
          }
        }
        return null;
      };

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
        const features =
          map.queryRenderedFeatures(
            [
              [0, 0],
              [canvas.width, canvas.height],
            ],
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

          const propertyIdCount = parseIds(feature.properties?.property_ids).length;
          const previewPropertyIdCount = parseIds(feature.properties?.preview_property_ids).length;
          const membershipComplete = parseOptionalBoolean(feature.properties?.membership_complete);
          const readStateCoverage =
            typeof feature.properties?.read_state_coverage === 'string'
              ? feature.properties.read_state_coverage
              : null;
          const hasCompleteMembership =
            membershipComplete !== false &&
            readStateCoverage !== 'partial' &&
            propertyIdCount >= Math.min(pointCount, previewMemberLimit);
          const hasPreviewableIds =
            previewPropertyIdCount > 1 || (hasCompleteMembership && propertyIdCount > 1);

          if (requirePreviewableIds && !hasPreviewableIds) {
            return false;
          }

          if (requireCompleteMembership && !hasCompleteMembership) {
            return false;
          }

          const bboxWest = Number(feature.properties?.bbox_west);
          const bboxSouth = Number(feature.properties?.bbox_south);
          const bboxEast = Number(feature.properties?.bbox_east);
          const bboxNorth = Number(feature.properties?.bbox_north);
          const hasBbox = [bboxWest, bboxSouth, bboxEast, bboxNorth].every(Number.isFinite);
          const estimatedZoom = hasBbox
            ? Math.log2(
                360 /
                  Math.max(Math.abs(bboxEast - bboxWest), Math.abs(bboxNorth - bboxSouth), 0.0001)
              ) - 1
            : null;

          if (
            requireZoomableBbox &&
            (!hasBbox ||
              estimatedZoom == null ||
              typeof currentZoom !== 'number' ||
              estimatedZoom <= currentZoom + 0.5)
          ) {
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
    requirePreviewableIds: true,
    requireCompleteMembership: true,
    previewMemberLimit: PROPERTY_PREVIEW_MEMBER_LIMIT,
  };

  const pageIndicator = page.locator('[data-testid="group-preview-page-indicator"]');
  const attempts: Array<{ name: string; center: [number, number]; zoom: number }> = [
    { name: 'Eindhoven z14', center: EINDHOVEN_CENTER, zoom: 14 },
    { name: 'Amsterdam z14', center: [4.9041, 52.3676], zoom: 14 },
    { name: 'Rotterdam z14', center: [4.4777, 51.9244], zoom: 14 },
    { name: 'Utrecht z14', center: [5.1214, 52.0907], zoom: 14 },
    { name: 'Eindhoven z15', center: EINDHOVEN_CENTER, zoom: 15 },
  ];
  let candidatesTried = 0;

  for (const attempt of attempts) {
    await closeOpenPreview(page);
    await setMapView(page, attempt.center, attempt.zoom, 0);
    await waitForRenderedClusterCandidate(page, filters, 8000).catch(() => undefined);
    const candidates = await getRenderedClusterCandidates(page, filters);
    candidatesTried += candidates.length;
    console.log(`Previewable rendered clusters found for ${attempt.name}: ${candidates.length}`);

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
          candidatesTried,
        };
      }

      const propertyPreviewVisible = await page
        .locator('[data-testid="property-preview-card"]')
        .isVisible()
        .catch(() => false);
      console.log(
        `Cluster click did not open group preview: layer=${candidate.layerId} pointCount=${candidate.pointCount} propertyIds=${candidate.propertyIdCount} previewIds=${candidate.previewPropertyIdCount} membershipComplete=${candidate.membershipComplete} readStateCoverage=${candidate.readStateCoverage} propertyPreviewVisible=${propertyPreviewVisible}`
      );
      await closeOpenPreview(page);
    }
  }

  return { success: false, candidatesTried };
}

async function findLargeLowZoomCluster(
  page: Page
): Promise<
  | ({ success: true; targetName: string } & RenderedClusterCandidate)
  | { success: false; attempts: string[]; largestPointCount: number }
> {
  const attempts: string[] = [];
  let largestPointCount = 0;
  const targetZoom = 10;

  for (const target of LOW_ZOOM_CLUSTER_TARGETS) {
    await closeOpenPreview(page);
    await setMapView(page, target.center, targetZoom, 0);
    await waitForPropertyTilesSettled(page, 8000);

    const largeClusterFilters: RenderedClusterFilters = {
      layerIds: [PROPERTY_MAP_LAYERS.ACTIVE_CLUSTERS],
      minPointCount: PROPERTY_PREVIEW_MEMBER_LIMIT + 1,
      requireZoomableBbox: true,
      currentZoom: targetZoom,
      previewMemberLimit: PROPERTY_PREVIEW_MEMBER_LIMIT,
    };
    const allClusterCandidates = await getRenderedClusterCandidates(page, {
      layerIds: [PROPERTY_MAP_LAYERS.ACTIVE_CLUSTERS],
      minPointCount: 2,
    });
    const largestCluster = allClusterCandidates.sort(
      (a, b) => b.pointCount - a.pointCount || a.distanceToCenter - b.distanceToCenter
    )[0];
    const largeCandidates = await getRenderedClusterCandidates(page, largeClusterFilters);
    if (largestCluster) {
      largestPointCount = Math.max(largestPointCount, largestCluster.pointCount);
      attempts.push(
        `${target.name}: largest point_count=${largestCluster.pointCount}; zoomable large candidates=${largeCandidates.length}`
      );
    } else {
      attempts.push(`${target.name}: no rendered clusters`);
    }

    const [actionableCluster] = largeCandidates;
    if (actionableCluster) {
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
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, z)
    );

    // Try a few nearby tiles to find one with data
    const tilesToTry = [
      [z, x, y],
      [z, x + 1, y],
      [z, x, y + 1],
      [z, x - 1, y],
    ];

    for (const [tz, tx, ty] of tilesToTry) {
      const resp = await request.get(`${API_BASE_URL}/tiles/properties/${tz}/${tx}/${ty}.pbf`);
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
        const batchResult = await request.get(`${API_BASE_URL}/properties/batch?ids=${ids}`);
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
    await setMapView(page, EINDHOVEN_CENTER, 14, 0);
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

    await setMapView(page, EINDHOVEN_CENTER, 14, 0);
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

    await setMapView(page, EINDHOVEN_CENTER, 14, 0);
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

  test('large low-zoom cluster tap zooms in instead of opening preview', async ({
    page,
    request,
  }) => {
    await page.goto('/', { timeout: 60000 });
    await waitForMapReady(page);

    const largeCluster = await findLargeLowZoomCluster(page);
    if (!largeCluster.success) {
      const tileStatuses = await getLowZoomTileMissStatuses(request);
      console.log('Low-zoom public tile statuses with no rendered large clusters', {
        largestPointCount: largeCluster.largestPointCount,
        attempts: largeCluster.attempts,
        tileStatuses,
      });
      expect(
        tileStatuses.some(
          (status) =>
            status.status === 204 &&
            status.tileCache === 'pyramid-unavailable' &&
            typeof status.tileStatus === 'string' &&
            status.tileStatus.startsWith('pyramid-')
        ),
        [
          'Expected no-current low-zoom tiles to use the controlled pyramid miss contract',
          `when no large cluster is rendered. Statuses: ${JSON.stringify(tileStatuses)}`,
        ].join(' ')
      ).toBe(true);
      return;
    }

    const initialZoom = await getMapZoom(page);
    console.log(
      `Initial zoom: ${initialZoom}; target=${largeCluster.targetName}; point_count=${largeCluster.pointCount}`
    );

    await page.mouse.move(largeCluster.screenX, largeCluster.screenY);
    await page.mouse.click(largeCluster.screenX, largeCluster.screenY);

    await page.waitForFunction(
      ({ initialZoom }) => {
        const map = (window as WindowWithMapInstance).__mapInstance;
        return (map?.getZoom?.() ?? 0) > initialZoom + 0.5;
      },
      { initialZoom },
      { timeout: 10000, polling: 250 }
    );

    const newZoom = await getMapZoom(page);
    const clusterPreview = page.locator('[data-testid="group-preview-card"]');
    const previewVisible = await clusterPreview.isVisible().catch(() => false);

    expect(
      newZoom,
      `Expected large low-zoom cluster tap to zoom in; zoom ${initialZoom} -> ${newZoom}, point_count=${largeCluster.pointCount}`
    ).toBeGreaterThan(initialZoom + 0.5);
    expect(
      previewVisible,
      `Expected large low-zoom cluster tap not to open preview; zoom ${initialZoom} -> ${newZoom}, point_count=${largeCluster.pointCount}`
    ).toBe(false);
    console.log(
      `Large cluster zoomed in: ${initialZoom} -> ${newZoom}, previewVisible=${previewVisible} (point_count=${largeCluster.pointCount})`
    );
  });

  test('tile cluster payloads match membership completeness contract', async ({
    page,
    request,
  }) => {
    await page.goto('/', { timeout: 60000 });
    await waitForMapReady(page);

    // Complete, previewable clusters still carry enough IDs to open the batch preview.
    await setMapView(page, EINDHOVEN_CENTER, 14, 0);
    await page.waitForTimeout(3000);

    const previewableFeatures = await page.evaluate((previewMemberLimit) => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map) return [];

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

      const features = map.queryRenderedFeatures(undefined, {
        layers: ['property-clusters'].filter((layer: string) => map.getLayer(layer)),
      });

      return (features as MapFeature[])
        .filter((feature) => {
          const pointCount = Number(feature.properties?.point_count ?? 0);
          return Number.isFinite(pointCount) && pointCount > 1 && pointCount <= previewMemberLimit;
        })
        .slice(0, 5)
        .map((feature) => {
          const pointCount = Number(feature.properties?.point_count ?? 0);
          const propertyIds = parseIds(feature.properties?.property_ids);
          const previewPropertyIds = parseIds(feature.properties?.preview_property_ids);
          return {
            point_count: pointCount,
            property_ids_length: propertyIds.length,
            preview_property_ids_length: previewPropertyIds.length,
            membership_complete: feature.properties?.membership_complete ?? null,
            read_state_coverage: feature.properties?.read_state_coverage ?? null,
          };
        });
    }, PROPERTY_PREVIEW_MEMBER_LIMIT);

    console.log(`Previewable complete cluster features found: ${previewableFeatures.length}`);
    expect(
      previewableFeatures.length,
      'Expected at least one complete previewable cluster sample to assert the capped member contract.'
    ).toBeGreaterThan(0);

    for (const feature of previewableFeatures) {
      expect([false, 'false']).not.toContain(feature.membership_complete);
      expect(feature.read_state_coverage).not.toBe('partial');
      expect(feature.property_ids_length).toBeGreaterThan(1);
      expect(feature.property_ids_length).toBeGreaterThanOrEqual(
        Math.min(feature.point_count, PROPERTY_PREVIEW_MEMBER_LIMIT)
      );
      console.log(
        `Previewable cluster: point_count=${feature.point_count}, property_ids=${feature.property_ids_length}, preview_ids=${feature.preview_property_ids_length}`
      );
    }

    // Low-zoom public pyramid clusters may be partial and must not be treated as
    // complete membership payloads just because they render on the map.
    await setMapView(page, EINDHOVEN_CENTER, 10, 0);
    await waitForPropertyTilesSettled(page, 8000);

    const partialLowZoomFeatures = await page.evaluate(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map) return [];

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

      const features = map.queryRenderedFeatures(undefined, {
        layers: ['property-clusters'].filter((layer: string) => map.getLayer(layer)),
      });

      return (features as MapFeature[])
        .filter((feature) => {
          const pointCount = Number(feature.properties?.point_count ?? 0);
          return (
            Number.isFinite(pointCount) &&
            pointCount > 1 &&
            (feature.properties?.membership_complete === false ||
              feature.properties?.membership_complete === 'false' ||
              feature.properties?.read_state_coverage === 'partial' ||
              typeof feature.properties?.pyramid_node_id === 'string')
          );
        })
        .slice(0, 3)
        .map((feature) => {
          const coordinates =
            feature.geometry?.type === 'Point' && Array.isArray(feature.geometry.coordinates)
              ? feature.geometry.coordinates
              : null;
          const coordinate =
            coordinates && typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number'
              ? ([coordinates[0], coordinates[1]] as [number, number])
              : null;
          const previewPropertyIds = parseIds(feature.properties?.preview_property_ids);
          return {
            point_count: Number(feature.properties?.point_count ?? 0),
            property_ids_length: parseIds(feature.properties?.property_ids).length,
            preview_property_ids: previewPropertyIds,
            preview_property_ids_length: previewPropertyIds.length,
            membership_complete: feature.properties?.membership_complete ?? null,
            read_state_coverage: feature.properties?.read_state_coverage ?? null,
            pyramid_version_id:
              typeof feature.properties?.pyramid_version_id === 'string'
                ? feature.properties.pyramid_version_id
                : null,
            pyramid_node_id:
              typeof feature.properties?.pyramid_node_id === 'string'
                ? feature.properties.pyramid_node_id
                : null,
            coordinate,
          };
        });
    });

    console.log(`Partial low-zoom cluster features found: ${partialLowZoomFeatures.length}`);
    expect(
      partialLowZoomFeatures.length,
      'Expected at least one promoted low-zoom pyramid cluster sample to assert partial membership.'
    ).toBeGreaterThan(0);

    for (const feature of partialLowZoomFeatures) {
      expect(feature.pyramid_version_id).not.toBeNull();
      expect(feature.pyramid_node_id).not.toBeNull();
      expect(feature.coordinate).not.toBeNull();
      expect([true, 'true']).not.toContain(feature.membership_complete);
      expect(feature.read_state_coverage).toBe('partial');
      expect(feature.property_ids_length).toBe(0);
      expect(feature.preview_property_ids_length).toBeGreaterThan(0);
      expect(feature.preview_property_ids_length).toBeLessThanOrEqual(
        PROPERTY_PREVIEW_MEMBER_LIMIT
      );
      expect(feature.preview_property_ids_length).toBeLessThanOrEqual(feature.point_count);

      const [lon, lat] = feature.coordinate as [number, number];
      const byCoordinate = await request.get(
        `${API_BASE_URL}/properties/nearby?lon=${lon}&lat=${lat}&zoom=10`,
        { timeout: 30_000 }
      );
      expect(byCoordinate.status()).toBe(200);
      expect(byCoordinate.headers()['x-huishype-nearby-status']).toBe('pyramid-promoted');

      const byCoordinateBody = await byCoordinate.json();
      expect(byCoordinateBody).not.toBeNull();
      expect(byCoordinateBody.pyramidVersionId).toBe(feature.pyramid_version_id);
      expect(byCoordinateBody.pyramidNodeId).toBe(feature.pyramid_node_id);
      expect(byCoordinateBody.propertyIds).toEqual([]);
      expect(byCoordinateBody.previewPropertyIds).toEqual(feature.preview_property_ids);

      const byExactNode = await request.get(
        `${API_BASE_URL}/properties/nearby?lon=${lon}&lat=${lat}&zoom=10` +
          `&pyramidVersionId=${encodeURIComponent(feature.pyramid_version_id as string)}` +
          `&pyramidNodeId=${encodeURIComponent(feature.pyramid_node_id as string)}`,
        { timeout: 30_000 }
      );
      expect(byExactNode.status()).toBe(200);
      expect(byExactNode.headers()['x-huishype-nearby-status']).toBeUndefined();

      const byExactNodeBody = await byExactNode.json();
      expect(byExactNodeBody).not.toBeNull();
      expect(byExactNodeBody.pyramidVersionId).toBe(feature.pyramid_version_id);
      expect(byExactNodeBody.pyramidNodeId).toBe(feature.pyramid_node_id);
      expect(byExactNodeBody.propertyIds).toEqual([]);
      expect(byExactNodeBody.previewPropertyIds).toEqual(feature.preview_property_ids);
      console.log(
        `Partial low-zoom cluster: point_count=${feature.point_count}, property_ids=${feature.property_ids_length}, preview_ids=${feature.preview_property_ids_length}`
      );
    }

    const diagnostics = await page.evaluate(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map) return { layerPresent: false, clusterCount: 0 };

      const layerPresent = Boolean(map.getLayer('property-clusters'));
      const features = layerPresent
        ? map.queryRenderedFeatures(undefined, { layers: ['property-clusters'] })
        : [];
      return { layerPresent, clusterCount: features.length };
    });
    expect(diagnostics.layerPresent).toBe(true);
  });
});
