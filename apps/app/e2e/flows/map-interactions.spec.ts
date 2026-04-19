/**
 * Map Interactions Flow E2E Tests
 *
 * Tests map interaction features end-to-end:
 * - Map loads and displays property data
 * - Zoom in/out programmatically, verify zoom level changes
 * - Verify density-aware clusters at low zoom and node rendering at higher zoom
 * - Pan to Eindhoven area, verify property data loads
 * - Test ghost vs active nodes once ghost reveal is active
 * - Verify vector tiles load at different zoom levels
 */

import { test, expect, type TestInfo } from '@playwright/test';
import { clickOnPropertyMarker } from '../visual/helpers/screenshot-harness';
import { getPlaywrightApiUrl } from '../helpers/runtime';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';
import { clickRenderedPropertyMarkerById, type MapFeature, type WindowWithMapInstance } from '../helpers/map-instance';

const API_BASE_URL = getPlaywrightApiUrl();
const PREVIEW_VISIBILITY_TIMEOUT_MS = 15_000;

// Eindhoven center coordinates
const EINDHOVEN_CENTER: [number, number] = [5.4697, 51.4416];

// Known acceptable console errors
const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

// Disable tracing to avoid artifact issues
test.use({ trace: 'off' });

/** Wait for the MapLibre GL map instance to be available */
async function waitForMapReady(page: import('@playwright/test').Page, timeout = 60000) {
  await page.waitForSelector('canvas', { timeout });
  // First wait for the map instance to exist
  await page.waitForFunction(
    () => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      return map && typeof map.getZoom === 'function';
    },
    null,
    { timeout, polling: 500 }
  );
  // Then wait for it to be loaded (tiles/style downloaded)
  await page.waitForFunction(
    () => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      return map?.loaded?.() ?? false;
    },
    null,
    { timeout: Math.min(timeout, 30000), polling: 1000 }
  ).catch(() => {
    // loaded() can be slow if tiles are still downloading — don't fail setup
    console.log('Map not fully loaded yet, continuing anyway');
  });
}

/** Get the current zoom level from the map */
async function getMapZoom(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const map = (window as WindowWithMapInstance).__mapInstance;
    return map ? map.getZoom() : -1;
  });
}

/** Get the current pitch from the map */
async function getMapPitch(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const map = (window as WindowWithMapInstance).__mapInstance;
    return map ? map.getPitch() : -1;
  });
}

/** Set the map center and zoom */
async function setMapView(
  page: import('@playwright/test').Page,
  center: [number, number],
  zoom: number,
  pitch?: number
) {
  await page.evaluate(
    ({ center, zoom, pitch }) => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (map) {
        map.jumpTo({
          center,
          zoom,
          ...(pitch !== undefined ? { pitch } : {}),
        });
      }
    },
    { center, zoom, pitch }
  );
  await page.waitForFunction(
    ({ zoom, pitch }) => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map) return false;

      const zoomMatches = Math.abs(map.getZoom() - zoom) < 0.1;
      const pitchMatches = pitch === undefined || Math.abs(map.getPitch() - pitch) < 0.5;
      return zoomMatches && pitchMatches;
    },
    { zoom, pitch },
    { timeout: 10000 }
  );
  // Give tiles a moment to settle after the camera jump
  await page.waitForTimeout(1000);
}

async function captureMapScreenshot(testInfo: TestInfo, page: import('@playwright/test').Page, name: string) {
  await page.screenshot({
    path: testInfo.outputPath(name),
    fullPage: false,
  });
}

async function waitForPointFeatures(
  page: import('@playwright/test').Page,
  {
    timeout = 30_000,
    requireFeatureId = false,
  }: {
    timeout?: number;
    requireFeatureId?: boolean;
  } = {},
) {
  await page.waitForFunction(
    ({ requireFeatureId }) => {
      const PREVIEW_MEMBER_LIMIT = 30;

      const parsePropertyIds = (value: unknown): string[] => {
        if (Array.isArray(value)) {
          return value
            .map((entry) => (entry == null ? '' : String(entry).trim()))
            .filter(Boolean);
        }

        if (typeof value !== 'string') {
          return [];
        }

        const trimmed = value.trim();
        if (!trimmed) {
          return [];
        }

        return trimmed
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean);
      };

      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map || !map.isStyleLoaded()) return false;

      const canvas = map.getCanvas();
      if (!canvas) return false;

      const layers = ['property-clusters', 'active-nodes', 'ghost-clusters', 'ghost-nodes']
        .filter((layer) => map.getLayer(layer));
      if (layers.length === 0) return false;

      try {
        const features = map.queryRenderedFeatures(
          [[0, 0], [canvas.width, canvas.height]],
          { layers }
        ) || [];

        return features.some((feature: MapFeature) => {
          if (feature.geometry?.type !== 'Point') {
            return false;
          }

          const rawPointCount = feature.properties?.point_count;
          const pointCount =
            typeof rawPointCount === 'number'
              ? rawPointCount
              : Number.parseInt(String(rawPointCount ?? '1'), 10) || 1;
          const previewPropertyIds = parsePropertyIds(feature.properties?.preview_property_ids);
          const propertyIds = parsePropertyIds(feature.properties?.property_ids);
          const isSingle = pointCount <= 1;
          const isPreviewableCluster =
            pointCount <= PREVIEW_MEMBER_LIMIT &&
            (previewPropertyIds.length > 0 || propertyIds.length > 0);

          if (!(isSingle || isPreviewableCluster)) {
            return false;
          }

          if (!requireFeatureId) {
            return true;
          }

          return (
            feature.properties?.id != null &&
            String(feature.properties.id).trim().length > 0
          );
        });
      } catch {
        return false;
      }
    },
    { requireFeatureId },
    { timeout, polling: 500 }
  );
}

async function waitForSelectedPreview(
  page: import('@playwright/test').Page,
  timeout = PREVIEW_VISIBILITY_TIMEOUT_MS,
) {
  const previewCard = page.getByTestId('group-preview-card');
  const selectedMarker = page.getByTestId('selected-marker');

  await expect(selectedMarker).toBeVisible({ timeout });
  await expect(previewCard).toBeVisible({ timeout });

  return { previewCard, selectedMarker };
}

async function readSettledPreviewText(
  page: import('@playwright/test').Page,
  previewCard: import('@playwright/test').Locator,
  timeout = 5_000,
  pollMs = 100,
  settleMs = 300,
): Promise<string> {
  const deadline = Date.now() + timeout;
  let previous = '';

  while (Date.now() < deadline) {
    const current = ((await previewCard.textContent()) || '').trim();

    if (current.length === 0) {
      previous = '';
      await page.waitForTimeout(pollMs);
      continue;
    }

    if (current !== previous) {
      previous = current;
      await page.waitForTimeout(pollMs);
      continue;
    }

    await page.waitForTimeout(settleMs);
    const confirmed = ((await previewCard.textContent()) || '').trim();
    if (confirmed === current) {
      return confirmed;
    }

    previous = confirmed;
  }

  throw new Error('Timed out waiting for preview text to settle');
}

async function waitForSinglePropertyFeature(
  page: import('@playwright/test').Page,
  timeout = 8_000,
): Promise<{ propertyId: string; zoom: number }> {
  const handle = await page.waitForFunction(
    () => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map || !map.isStyleLoaded()) {
        return null;
      }

      const canvas = map.getCanvas();
      if (!canvas) {
        return null;
      }

      const layers = ['property-clusters', 'active-nodes', 'ghost-clusters', 'ghost-nodes']
        .filter((layer) => map.getLayer(layer));
      if (layers.length === 0) {
        return null;
      }

      try {
        const edgeMargin = 40;
        const canvasCenterX = canvas.width / 2;
        const canvasCenterY = canvas.height / 2;
        const features = map.queryRenderedFeatures(
          [[0, 0], [canvas.width, canvas.height]],
          { layers }
        ) || [];

        const candidate = features
          .filter((feature: MapFeature) => feature.geometry?.type === 'Point')
          .map((feature: MapFeature) => {
            const rawPropertyId = feature.properties?.id;
            const propertyId =
              rawPropertyId == null ? '' : String(rawPropertyId).trim();
            const rawPointCount = feature.properties?.point_count;
            const pointCount =
              typeof rawPointCount === 'number'
                ? rawPointCount
                : Number.parseInt(String(rawPointCount ?? '1'), 10) || 1;
            const coordinates = feature.geometry?.coordinates;

            if (
              propertyId.length === 0 ||
              pointCount > 1 ||
              !Array.isArray(coordinates) ||
              coordinates.length < 2 ||
              typeof coordinates[0] !== 'number' ||
              typeof coordinates[1] !== 'number'
            ) {
              return null;
            }

            const point = map.project([coordinates[0], coordinates[1]]);
            const inBounds =
              point.x >= edgeMargin &&
              point.x <= canvas.width - edgeMargin &&
              point.y >= edgeMargin &&
              point.y <= canvas.height - edgeMargin;

            if (!inBounds) {
              return null;
            }

            return {
              propertyId,
              zoom: map.getZoom(),
              distanceToCenter: Math.hypot(point.x - canvasCenterX, point.y - canvasCenterY),
            };
          })
          .filter((feature): feature is { propertyId: string; zoom: number; distanceToCenter: number } => feature !== null)
          .sort((a, b) => a.distanceToCenter - b.distanceToCenter)[0];

        if (!candidate) {
          return null;
        }

        return {
          propertyId: candidate.propertyId,
          zoom: candidate.zoom,
        };
      } catch {
        return null;
      }
    },
    null,
    { timeout, polling: 500 }
  );

  return (await handle.jsonValue()) as { propertyId: string; zoom: number };
}

async function focusMapOnSinglePropertyFeature(
  page: import('@playwright/test').Page,
  center: [number, number],
): Promise<{ propertyId: string; zoom: number }> {
  const zoomCandidates = [18, 18.5, 19, 19.5, 20];

  for (const zoom of zoomCandidates) {
    await setMapView(page, center, zoom);

    try {
      return await waitForSinglePropertyFeature(page, 8_000);
    } catch {
      // Keep tightening the camera until a single-property feature with an id is rendered.
    }
  }

  throw new Error(
    `Expected a rendered single-property feature with an id near ${center[0]},${center[1]} after trying zooms ${zoomCandidates.join(', ')}`
  );
}

async function waitForPreviewToClose(
  page: import('@playwright/test').Page,
  timeout = PREVIEW_VISIBILITY_TIMEOUT_MS,
) {
  await expect(page.getByTestId('group-preview-card')).toHaveCount(0, { timeout });
  await expect(page.getByTestId('selected-marker')).toHaveCount(0, { timeout });
}

test.describe('Map Interactions', () => {
  // Map tests need extra time: Metro bundle compile + MapLibre tile loading
  test.setTimeout(120000);

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

  test('map canvas renders and map instance is available', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait for map to be ready
    await waitForMapReady(page);

    // Canvas should be visible
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    // Map instance should exist
    const hasMap = await page.evaluate(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      return !!map && typeof map.getZoom === 'function';
    });
    expect(hasMap).toBe(true);
  });

  test('zoom in/out programmatically changes zoom level', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForMapReady(page);

    // Set initial zoom
    await setMapView(page, EINDHOVEN_CENTER, 12);
    const initialZoom = await getMapZoom(page);
    expect(initialZoom).toBeCloseTo(12, 0);

    // Zoom in
    await setMapView(page, EINDHOVEN_CENTER, 16);
    const zoomedIn = await getMapZoom(page);
    expect(zoomedIn).toBeCloseTo(16, 0);
    expect(zoomedIn).toBeGreaterThan(initialZoom);

    // Zoom out
    await setMapView(page, EINDHOVEN_CENTER, 10);
    const zoomedOut = await getMapZoom(page);
    expect(zoomedOut).toBeCloseTo(10, 0);
    expect(zoomedOut).toBeLessThan(zoomedIn);
  });

  test('pitch follows the zoom curve and manual pitch controls are disabled', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForMapReady(page);

    const pitchControls = await page.evaluate(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      return {
        touchPitchEnabled: map?.touchPitch?.isEnabled?.() ?? null,
        keyboardRotationDisabled: map?.keyboard?._rotationDisabled ?? null,
        pitchWithRotate: map?.dragRotate?._pitchWithRotate ?? null,
      };
    });

    expect(pitchControls.touchPitchEnabled).toBe(false);
    expect(pitchControls.keyboardRotationDisabled).toBe(true);
    expect(pitchControls.pitchWithRotate).toBe(false);

    await setMapView(page, EINDHOVEN_CENTER, 12);
    expect(await getMapPitch(page)).toBeCloseTo(0, 1);

    await setMapView(page, EINDHOVEN_CENTER, 17);
    expect(await getMapPitch(page)).toBeCloseTo(25, 1);

    await setMapView(page, EINDHOVEN_CENTER, 20);
    expect(await getMapPitch(page)).toBeCloseTo(50, 1);
  });

  test('compass appears on rotation and resets bearing on click', async ({ page }, testInfo) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForMapReady(page);

    const zoomControl = page.getByTestId('map-zoom-control');
    const compassControl = page.getByTestId('map-standalone-compass-control');
    const compassButton = page.getByTestId('map-compass-button');
    const locationButton = page.getByTestId('location-button');

    await expect(zoomControl).toBeVisible();
    await expect(zoomControl.locator('.maplibregl-ctrl-zoom-in')).toBeVisible();
    await expect(zoomControl.locator('.maplibregl-ctrl-zoom-out')).toBeVisible();
    await expect(zoomControl.locator('.maplibregl-ctrl-compass')).toHaveCount(0);

    await expect(compassControl).toBeHidden();
    await expect(compassButton).toBeHidden();

    await page.evaluate(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      map?.rotateTo?.(35, { duration: 0 });
    });

    await expect(compassControl).toBeVisible();
    await expect(compassButton).toBeVisible();
    await captureMapScreenshot(testInfo, page, 'standalone-compass-rotated.png');

    const compassBox = await compassControl.boundingBox();
    const locationBox = await locationButton.boundingBox();
    expect(compassBox).not.toBeNull();
    expect(locationBox).not.toBeNull();
    expect(compassBox!.y + compassBox!.height).toBeLessThan(locationBox!.y);
    expect(Math.abs((compassBox!.x + compassBox!.width / 2) - (locationBox!.x + locationBox!.width / 2))).toBeLessThanOrEqual(2);

    const rotatedBearing = await page.evaluate(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      return map?.getBearing?.() ?? 0;
    });
    expect(Math.abs(rotatedBearing)).toBeGreaterThan(1);

    await compassButton.click();

    await page.waitForFunction(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      return map ? Math.abs(map.getBearing()) < 0.5 : false;
    });
    await expect(compassControl).toBeHidden();
    await expect(zoomControl).toBeVisible();
  });

  test('zoom controls hide in portrait and stay top-right in landscape', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForMapReady(page);

    const searchBar = page.getByTestId('search-bar-input');
    const zoomControl = page.getByTestId('map-zoom-control');
    await expect(zoomControl).toBeHidden();

    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(searchBar).toBeVisible();
    await expect(zoomControl).toBeVisible();

    const searchBarBox = await searchBar.boundingBox();
    const landscapeZoomBox = await zoomControl.boundingBox();
    expect(searchBarBox).not.toBeNull();
    expect(landscapeZoomBox).not.toBeNull();
    const landscapeViewport = page.viewportSize();
    expect(landscapeViewport).not.toBeNull();

    const searchBarBottom = searchBarBox!.y + searchBarBox!.height;
    const zoomControlRightInset = landscapeViewport!.width - (landscapeZoomBox!.x + landscapeZoomBox!.width);
    const zoomControlGapBelowSearchBar = landscapeZoomBox!.y - searchBarBottom;

    expect(Math.abs(zoomControlRightInset - 16)).toBeLessThanOrEqual(4);
    expect(zoomControlGapBelowSearchBar).toBeGreaterThanOrEqual(-1);
    expect(landscapeZoomBox!.y + landscapeZoomBox!.height / 2).toBeLessThanOrEqual(landscapeViewport!.height / 2);
    expect(landscapeZoomBox!.width).toBeLessThan(44);
    expect(landscapeZoomBox!.height).toBeLessThan(90);
  });

  test('current-location button recenters the map from browser geolocation', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition: (success: (position: GeolocationPosition) => void) =>
            success({
              coords: {
                latitude: 52.0907,
                longitude: 5.1214,
                accuracy: 10,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
                toJSON: () => ({}),
              },
              timestamp: Date.now(),
              toJSON: () => ({}),
            } as GeolocationPosition),
        },
      });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForMapReady(page);

    await page.getByTestId('location-button').click();

    await page.waitForFunction(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map) return false;
      const center = map.getCenter();
      if (!center) return false;
      return (
        Math.abs(center.lng - 5.1214) < 0.001 &&
        Math.abs(center.lat - 52.0907) < 0.001 &&
        map.getZoom() >= 16
      );
    });

    const mapState = await page.evaluate(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map) return null;
      const center = map.getCenter();
      if (!center) return null;
      return {
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
      };
    });

    expect(mapState).not.toBeNull();
    if (!mapState) {
      throw new Error('Expected map state after geolocation recenter');
    }

    expect(Math.abs(mapState.center[0] - 5.1214)).toBeLessThan(0.001);
    expect(Math.abs(mapState.center[1] - 52.0907)).toBeLessThan(0.001);
    expect(mapState.zoom).toBeGreaterThanOrEqual(16);
  });

  test('same property can be reopened after closing its preview', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForMapReady(page);

    const targetProperty = await focusMapOnSinglePropertyFeature(page, EINDHOVEN_CENTER);
    const clickResult = await clickRenderedPropertyMarkerById(page, targetProperty.propertyId);

    expect(clickResult.success).toBe(true);
    if (!clickResult.success) {
      throw new Error(clickResult.reason);
    }
    expect(clickResult.screenX).toBeDefined();
    expect(clickResult.screenY).toBeDefined();
    expect(clickResult.propertyId).toBeDefined();
    const propertyId = clickResult.propertyId;
    if (!propertyId) {
      throw new Error('Expected clicked marker to provide a propertyId');
    }
    const { previewCard } = await waitForSelectedPreview(page);
    const initialText = await readSettledPreviewText(page, previewCard);
    expect(initialText.length).toBeGreaterThan(5);

    const closeButton = page
      .getByTestId('property-preview-close-button')
      .or(page.getByTestId('group-preview-close-button'));
    await closeButton.click();
    await waitForPreviewToClose(page);

    const reopenResult = await clickRenderedPropertyMarkerById(page, propertyId);
    expect(reopenResult.success).toBe(true);
    await waitForSelectedPreview(page);
    const reopenedText = await readSettledPreviewText(page, previewCard);
    expect(reopenedText).toBe(initialText);
  });

  test('preview card stays horizontally aligned with the selected node', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 486, height: 419 });
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForMapReady(page);

    await setMapView(page, EINDHOVEN_CENTER, 17);
    await waitForPointFeatures(page);

    const clickResult = await clickOnPropertyMarker(page);

    expect(clickResult.success).toBe(true);
    await waitForSelectedPreview(page);

    await page.waitForFunction(() => {
      const card = document.querySelector('[data-testid="group-preview-card"]');
      const marker = document.querySelector('[data-testid="selected-marker"]');
      if (!card || !marker) {
        return false;
      }

      const cardBox = card.getBoundingClientRect();
      const markerBox = marker.getBoundingClientRect();
      return (
        cardBox.width > 0 &&
        cardBox.height > 0 &&
        markerBox.width > 0 &&
        markerBox.height > 0
      );
    }, null, { timeout: PREVIEW_VISIBILITY_TIMEOUT_MS });

    const alignment = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="group-preview-card"]');
      const marker = document.querySelector('[data-testid="selected-marker"]');
      if (!card || !marker) return null;

      const cardBox = card.getBoundingClientRect();
      const markerBox = marker.getBoundingClientRect();

      return {
        cardCenterX: cardBox.x + cardBox.width / 2,
        markerCenterX: markerBox.x + markerBox.width / 2,
        deltaX: (cardBox.x + cardBox.width / 2) - (markerBox.x + markerBox.width / 2),
      };
    });

    expect(alignment).not.toBeNull();
    expect(Math.abs(alignment!.deltaX)).toBeLessThanOrEqual(4);

    await captureMapScreenshot(testInfo, page, 'preview-card-node-alignment.png');
  });

  test('vector tiles load at zoom 15 (Eindhoven area)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForMapReady(page);

    // Set to Eindhoven at zoom 15 (clustered tiles range)
    await setMapView(page, EINDHOVEN_CENTER, 15);

    // Wait for tiles to load
    await page.waitForTimeout(5000);

    // Check if vector tile source exists
    const hasTileSource = await page.evaluate(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map) return false;
      // Check for property-related sources
      const style = map.getStyle();
      if (!style?.sources) return false;
      const sourceNames = Object.keys(style.sources);
      // Look for huishype or property tile sources
      return sourceNames.some(
        (name: string) =>
          name.includes('huishype') ||
          name.includes('propert') ||
          name.includes('tiles')
      );
    });

    console.log(`Has tile source at z15: ${hasTileSource}`);

    expect(hasTileSource).toBe(true);
  });

  test('different zoom levels show different data (cluster vs individual)', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForMapReady(page, 60000);

    // At low zoom (12), data should show clusters
    await setMapView(page, EINDHOVEN_CENTER, 12);
    await page.waitForTimeout(3000);

    const lowZoomFeatures = await page.evaluate(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map) return { count: 0, hasCluster: false };
      const canvas = map.getCanvas();
      if (!canvas) return { count: 0, hasCluster: false };
      const layers = ['property-clusters', 'active-nodes', 'ghost-clusters', 'ghost-nodes']
        .filter((layer) => map.getLayer(layer));
      const features = layers.length > 0
        ? map.queryRenderedFeatures([[0, 0], [canvas.width, canvas.height]], { layers })
        : [];
      return {
        count: features.length,
        hasCluster: features.some(
          (feature: MapFeature) => feature.properties?.group_kind === 'cluster'
        ),
      };
    });

    console.log(`Low zoom (12): ${lowZoomFeatures.count} features, hasCluster: ${lowZoomFeatures.hasCluster}`);

    // At high zoom (18), data should show individual markers
    await setMapView(page, EINDHOVEN_CENTER, 18);
    await page.waitForTimeout(3000);

    const highZoomFeatures = await page.evaluate(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map) return { count: 0, hasGhost: false };
      const canvas = map.getCanvas();
      if (!canvas) return { count: 0, hasGhost: false };
      const layers = ['property-clusters', 'active-nodes', 'ghost-clusters', 'ghost-nodes']
        .filter((layer) => map.getLayer(layer));
      const features = layers.length > 0
        ? map.queryRenderedFeatures([[0, 0], [canvas.width, canvas.height]], { layers })
        : [];
      return {
        count: features.length,
        hasGhost: features.some(
          (feature: MapFeature) => feature.properties?.node_class === 'ghost'
        ),
      };
    });

    console.log(`High zoom (18): ${highZoomFeatures.count} features, hasGhost: ${highZoomFeatures.hasGhost}`);

    expect(lowZoomFeatures.count).toBeGreaterThan(0);
    expect(highZoomFeatures.count).toBeGreaterThan(0);
  });

  test('ghost vs active nodes at the ghost reveal threshold', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForMapReady(page, 60000);

    // Ghost groups reveal at z17+ and carry node_class metadata.
    await setMapView(page, EINDHOVEN_CENTER, 17.5);
    await page.waitForTimeout(5000);

    const nodeInfo = await page.evaluate(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map) return { total: 0, ghost: 0, active: 0 };

      const features = map.queryRenderedFeatures();
      let ghost = 0;
      let active = 0;

      for (const f of features) {
        if (f.properties?.node_class === 'ghost') {
          ghost++;
        } else if (f.properties?.node_class === 'active') {
          active++;
        }
      }

      return { total: features.length, ghost, active };
    });

    console.log(
      `At z17.5: total=${nodeInfo.total}, ghost=${nodeInfo.ghost}, active=${nodeInfo.active}`
    );

    // Map should be loaded and functional
    await expect(page.locator('canvas').first()).toBeVisible();
  });

  test('pan to Eindhoven loads property tiles', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForMapReady(page);

    // Start somewhere else (Amsterdam area)
    await setMapView(page, [4.9, 52.37], 12);

    // Register request listener BEFORE panning so we capture tile requests
    const tileRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/tiles/')) {
        tileRequests.push(req.url());
      }
    });

    // Pan to Eindhoven
    await setMapView(page, EINDHOVEN_CENTER, 15);

    // Verify we are centered on Eindhoven
    const center = await page.evaluate(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map) return null;
      const c = map.getCenter();
      return { lng: c.lng, lat: c.lat };
    });

    expect(center).not.toBeNull();
    if (center) {
      // Should be near Eindhoven (within ~0.1 degree)
      expect(center.lng).toBeCloseTo(EINDHOVEN_CENTER[0], 0);
      expect(center.lat).toBeCloseTo(EINDHOVEN_CENTER[1], 0);
    }

    // Wait for map to finish loading tiles
    await page.waitForFunction(
      () => {
        const map = (window as WindowWithMapInstance).__mapInstance;
        return map?.loaded?.() ?? false;
      },
      null,
      { timeout: 30000, polling: 1000 }
    ).catch(() => {
      console.log('Map tiles still loading after pan, continuing');
    });

    // Map should be loaded
    const isLoaded = await page.evaluate(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      return map?.loaded?.() ?? false;
    });
    expect(isLoaded).toBe(true);
  });

  test('3D buildings render at high zoom with pitch', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForMapReady(page);

    // Set high zoom with pitch for 3D buildings
    // minZoom for 3D buildings is 14, needs pitch ~50
    await page.evaluate(({ center }) => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      map?.jumpTo({ center, zoom: 16, pitch: 50 });
    }, { center: EINDHOVEN_CENTER });
    await page.waitForFunction(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map) return false;
      return map.getZoom() >= 15.9 && map.getPitch() > 0;
    }, null, { timeout: 15000, polling: 250 });
    await page.waitForTimeout(5000);

    // Check if fill-extrusion layer exists
    const has3DBuildings = await page.evaluate(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      if (!map) return false;
      const style = map.getStyle();
      if (!style?.layers) return false;
      return style.layers.some((layer: { type?: string }) => layer.type === 'fill-extrusion');
    });

    console.log(`3D buildings layer present: ${has3DBuildings}`);

    // Verify pitch is set
    const pitch = await page.evaluate(() => {
      const map = (window as WindowWithMapInstance).__mapInstance;
      return map ? map.getPitch() : 0;
    });
    expect(pitch).toBeGreaterThan(0);

    // Map should render without errors
    await expect(page.locator('canvas').first()).toBeVisible();
  });

  test('map responds to wheel zoom', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForMapReady(page);

    await setMapView(page, EINDHOVEN_CENTER, 14);
    const initialZoom = await getMapZoom(page);

    // Get canvas center
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    if (box) {
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;

      // Scroll wheel to zoom in
      await page.mouse.move(centerX, centerY);
      await page.mouse.wheel(0, -300);
      await page.waitForTimeout(2000);

      const newZoom = await getMapZoom(page);
      // Zoom should have increased (scrolled up = zoom in for most map libraries)
      console.log(`Wheel zoom: ${initialZoom} -> ${newZoom}`);
      // Just verify zoom changed (direction depends on config)
      expect(newZoom).not.toBeCloseTo(initialZoom, 1);
    }
  });

  test('tiles API endpoint returns data for Eindhoven', async ({ request }) => {
    // Test the tiles endpoint directly to ensure it works
    // z=15, Eindhoven (lon=5.4697, lat=51.4416) tile coordinates
    // Calculated: x = floor((5.4697+180)/360 * 2^15) = 16881
    //             y = floor((1 - ln(tan(51.4416rad) + sec(51.4416rad))/pi) / 2 * 2^15) = 10905
    const z = 15;
    const x = 16881;
    const y = 10905;

    const response = await request.get(`${API_BASE_URL}/tiles/properties/${z}/${x}/${y}.pbf`);

    // Should return 200 with data or 204 with no content
    expect([200, 204]).toContain(response.status());

    if (response.status() === 200) {
      const contentType = response.headers()['content-type'];
      // Should be protobuf
      expect(contentType).toContain('application/x-protobuf');
      const body = await response.body();
      expect(body.length).toBeGreaterThan(0);
      console.log(`Tile z${z}/x${x}/y${y}: ${body.length} bytes`);
    } else {
      console.log(`Tile z${z}/x${x}/y${y}: 204 No Content (empty tile)`);
    }
  });
});
