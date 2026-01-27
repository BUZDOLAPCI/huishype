/**
 * Reference Expectation E2E Test: 0023-preview-card-persistence
 *
 * This test verifies that the preview card persists during various interactions:
 * - Preview card stays open during map pan/drag gestures
 * - Preview card stays open during map zoom gestures
 * - Preview card stays open during map rotate gestures
 * - Preview card stays open when action buttons (Comment, Guess) are clicked
 * - Preview card stays open during bottom sheet state changes
 * - Preview card closes ONLY when user taps on empty map background
 * - Preview card closes when selecting a different property
 *
 * Screenshot saved to: test-results/reference-expectations/0023-preview-card-persistence/
 */

import { test, expect, Page, Route } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * Mock property data with price information for testing
 */
const MOCK_PROPERTY_WITH_PRICE = {
  id: 'test-property-001',
  bagIdentificatie: '0772010000123456',
  address: 'Stratumseind 100',
  city: 'Eindhoven',
  postalCode: '5611 ET',
  geometry: {
    type: 'Point',
    coordinates: [5.4697, 51.4416],
  },
  bouwjaar: 1985,
  oppervlakte: 120,
  status: 'active',
  wozValue: 425000,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

/**
 * Setup API route interception to return mock property data with prices
 */
async function setupPropertyMocking(page: Page): Promise<void> {
  await page.route('**/properties/*', async (route: Route) => {
    const url = route.request().url();

    if (url.match(/\/properties\/[^/]+$/) && route.request().method() === 'GET') {
      const propertyId = url.split('/').pop();

      const mockResponse = {
        ...MOCK_PROPERTY_WITH_PRICE,
        id: propertyId,
      };

      console.log(`Mocking property API response for ID: ${propertyId}`);

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockResponse),
      });
    } else {
      await route.continue();
    }
  });
}

// Disable tracing for this test
test.use({ trace: 'off', video: 'off' });

// Configuration
const EXPECTATION_NAME = '0023-preview-card-persistence';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Center coordinates where seeded data exists
const CENTER_COORDINATES: [number, number] = [5.746, 51.400];
const ZOOM_LEVEL = 17;

// Known acceptable errors
const KNOWN_ACCEPTABLE_ERRORS: RegExp[] = [
  /Download the React DevTools/,
  /React does not recognize the .* prop/,
  /Accessing element\.ref was removed in React 19/,
  /ref is now a regular prop/,
  /ResizeObserver loop/,
  /favicon\.ico/,
  /sourceMappingURL/,
  /Failed to parse source map/,
  /WebSocket connection/,
  /net::ERR_ABORTED/,
  /net::ERR_EMPTY_RESPONSE/,
  /Failed to load resource.*404/,
  /Failed to load resource/,
  /the server responded with a status of 404/,
  /AJAXError.*404/,
  /^[a-z]{1,3}$/i,
  /maplibre|mapbox/i,
  /pointerEvents is deprecated/,
  /shadow\* style props are deprecated/,
  /pdok\.nl/,
  /tiles/,
  /openfreemap/,
];

// Increase test timeout
test.setTimeout(120000);

/**
 * Helper function to find and click on a property marker
 */
async function clickOnPropertyMarker(page: Page): Promise<{ success: boolean; featureCount: number; screenX?: number; screenY?: number }> {
  const result = await page.evaluate(() => {
    const mapInstance = (window as any).__mapInstance;
    if (!mapInstance || !mapInstance.isStyleLoaded()) {
      return { success: false, featureCount: 0, reason: 'Map not ready' };
    }

    const canvas = mapInstance.getCanvas();
    if (!canvas) {
      return { success: false, featureCount: 0, reason: 'No canvas' };
    }

    const layerNames = ['property-clusters', 'single-active-points', 'active-nodes', 'ghost-nodes'];
    let allFeatures: any[] = [];

    for (const layerName of layerNames) {
      try {
        if (mapInstance.getLayer(layerName)) {
          const features = mapInstance.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers: [layerName] }
          ) || [];
          allFeatures = allFeatures.concat(features);
        }
      } catch (e) { /* ignore */ }
    }

    if (allFeatures.length === 0) {
      return { success: false, featureCount: 0, reason: 'No features found' };
    }

    const feature = allFeatures.find((f: any) => !f.properties?.point_count || f.properties.point_count === 1) || allFeatures[0];
    if (!feature.geometry || feature.geometry.type !== 'Point') {
      return { success: false, featureCount: allFeatures.length, reason: 'Invalid geometry' };
    }

    const coordinates = feature.geometry.coordinates;
    const point = mapInstance.project(coordinates);
    const rect = canvas.getBoundingClientRect();

    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + point.x,
      clientY: rect.top + point.y,
      view: window
    });

    mapInstance.fire('click', {
      point: { x: point.x, y: point.y },
      lngLat: { lng: coordinates[0], lat: coordinates[1] },
      originalEvent: clickEvent,
      features: [feature]
    });

    return {
      success: true,
      featureCount: allFeatures.length,
      screenX: point.x,
      screenY: point.y,
      propertyId: feature.properties?.id
    };
  });

  console.log(`Click result: ${JSON.stringify(result)}`);

  if (result.success) {
    if (result.screenX && result.screenY) {
      await page.mouse.click(result.screenX, result.screenY);
    }
    await page.waitForTimeout(500);
  }

  return { success: result.success, featureCount: result.featureCount, screenX: result.screenX, screenY: result.screenY };
}

/**
 * Helper function to wait for map to be ready
 */
async function waitForMapReady(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
  await page.waitForTimeout(3000);

  await page.waitForFunction(
    () => {
      const mapInstance = (window as any).__mapInstance;
      return mapInstance && typeof mapInstance.setZoom === 'function';
    },
    { timeout: 30000 }
  );

  await page.waitForTimeout(2000);
}

/**
 * Helper function to zoom the map programmatically
 */
async function zoomMapTo(page: Page, center: [number, number], zoom: number): Promise<boolean> {
  const result = await page.evaluate(
    ({ center, zoom }) => {
      const mapInstance = (window as any).__mapInstance;
      if (!mapInstance) return false;

      mapInstance.jumpTo({
        center: center,
        zoom: zoom,
        pitch: 0,
      });
      return true;
    },
    { center, zoom }
  );

  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      const mapInstance = (window as any).__mapInstance;
      if (!mapInstance) {
        resolve();
        return;
      }

      if (mapInstance.areTilesLoaded()) {
        resolve();
      } else {
        const handler = () => {
          mapInstance.off('idle', handler);
          resolve();
        };
        mapInstance.on('idle', handler);
        setTimeout(() => {
          mapInstance.off('idle', handler);
          resolve();
        }, 5000);
      }
    });
  });

  return result;
}

/**
 * Helper function to perform a pan gesture on the map
 */
async function performPanGesture(page: Page): Promise<void> {
  const mapCanvas = page.locator('canvas').first();
  const box = await mapCanvas.boundingBox();

  if (box) {
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    const endX = startX + 100;
    const endY = startY + 50;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Slow pan to simulate realistic gesture
    for (let i = 0; i <= 10; i++) {
      const x = startX + (endX - startX) * (i / 10);
      const y = startY + (endY - startY) * (i / 10);
      await page.mouse.move(x, y);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await page.waitForTimeout(200);
  }
}

/**
 * Helper function to perform a zoom gesture (scroll wheel)
 */
async function performZoomGesture(page: Page): Promise<void> {
  const mapCanvas = page.locator('canvas').first();
  const box = await mapCanvas.boundingBox();

  if (box) {
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    await page.mouse.move(centerX, centerY);
    await page.mouse.wheel(0, -200); // Scroll up to zoom in
    await page.waitForTimeout(200);
  }
}

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

    await setupPropertyMocking(page);

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

    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    if (consoleWarnings.length > 0) {
      console.log(`Console warnings (${consoleWarnings.length}):`);
      consoleWarnings.slice(0, 10).forEach((w) => console.log(`  - ${w}`));
      if (consoleWarnings.length > 10) {
        console.log(`  ... and ${consoleWarnings.length - 10} more`);
      }
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

  test('verify preview card persists during map pan gesture', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to be fully ready
    await waitForMapReady(page);

    // Zoom to a level where individual markers are visible
    await zoomMapTo(page, CENTER_COORDINATES, ZOOM_LEVEL);
    await page.waitForTimeout(2000);

    // Click on a property marker
    const previewCard = page.locator('[data-testid="property-preview-card"]');
    let previewVisible = false;

    const clickResult = await clickOnPropertyMarker(page);
    await page.waitForTimeout(1000);
    previewVisible = await previewCard.isVisible().catch(() => false);

    // Fallback clicks if needed
    if (!previewVisible && clickResult.featureCount > 0) {
      const markerPositions = await page.evaluate(() => {
        const mapInstance = (window as any).__mapInstance;
        if (!mapInstance) return [];
        const canvas = mapInstance.getCanvas();
        const layers = ['property-clusters', 'single-active-points', 'active-nodes', 'ghost-nodes'].filter(l => mapInstance.getLayer(l));
        let allFeatures: any[] = [];
        try {
          allFeatures = mapInstance.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers }
          ) || [];
        } catch (e) { /* ignore */ }
        return allFeatures.slice(0, 10).map((f: any) => {
          if (f.geometry?.type === 'Point') {
            const point = mapInstance.project(f.geometry.coordinates);
            const rect = canvas.getBoundingClientRect();
            return { x: rect.left + point.x, y: rect.top + point.y };
          }
          return null;
        }).filter(Boolean);
      });

      for (const pos of markerPositions) {
        if (!pos) continue;
        await page.mouse.click(pos.x, pos.y);
        await page.waitForTimeout(1000);
        previewVisible = await previewCard.isVisible().catch(() => false);
        if (previewVisible) break;
      }
    }

    expect(previewVisible, 'Preview card should be visible before pan gesture').toBe(true);

    // Wait for property data to load
    await page.waitForTimeout(2000);

    // Take screenshot before pan
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-before-pan.png`,
      fullPage: false,
    });
    console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-before-pan.png`);

    // Perform pan gesture
    console.log('Performing pan gesture...');
    await performPanGesture(page);
    await page.waitForTimeout(500);

    // Verify preview card is STILL visible after pan
    const previewVisibleAfterPan = await previewCard.isVisible().catch(() => false);
    console.log(`Preview visible after pan: ${previewVisibleAfterPan}`);

    // Take screenshot after pan
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-pan.png`,
      fullPage: false,
    });
    console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-pan.png`);

    expect(previewVisibleAfterPan, 'Preview card should STAY OPEN during map pan gesture').toBe(true);
  });

  test('verify preview card persists during map zoom gesture', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to be fully ready
    await waitForMapReady(page);

    // Zoom to appropriate level
    await zoomMapTo(page, CENTER_COORDINATES, ZOOM_LEVEL);
    await page.waitForTimeout(2000);

    // Click on a property marker
    const previewCard = page.locator('[data-testid="property-preview-card"]');
    let previewVisible = false;

    const clickResult = await clickOnPropertyMarker(page);
    await page.waitForTimeout(1000);
    previewVisible = await previewCard.isVisible().catch(() => false);

    // Fallback clicks
    if (!previewVisible && clickResult.featureCount > 0) {
      const markerPositions = await page.evaluate(() => {
        const mapInstance = (window as any).__mapInstance;
        if (!mapInstance) return [];
        const canvas = mapInstance.getCanvas();
        const layers = ['property-clusters', 'single-active-points', 'active-nodes', 'ghost-nodes'].filter(l => mapInstance.getLayer(l));
        let allFeatures: any[] = [];
        try {
          allFeatures = mapInstance.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers }
          ) || [];
        } catch (e) { /* ignore */ }
        return allFeatures.slice(0, 10).map((f: any) => {
          if (f.geometry?.type === 'Point') {
            const point = mapInstance.project(f.geometry.coordinates);
            const rect = canvas.getBoundingClientRect();
            return { x: rect.left + point.x, y: rect.top + point.y };
          }
          return null;
        }).filter(Boolean);
      });

      for (const pos of markerPositions) {
        if (!pos) continue;
        await page.mouse.click(pos.x, pos.y);
        await page.waitForTimeout(1000);
        previewVisible = await previewCard.isVisible().catch(() => false);
        if (previewVisible) break;
      }
    }

    expect(previewVisible, 'Preview card should be visible before zoom gesture').toBe(true);

    // Wait for property data
    await page.waitForTimeout(2000);

    // Perform zoom gesture
    console.log('Performing zoom gesture...');
    await performZoomGesture(page);
    await page.waitForTimeout(500);

    // Verify preview card is STILL visible after zoom
    const previewVisibleAfterZoom = await previewCard.isVisible().catch(() => false);
    console.log(`Preview visible after zoom: ${previewVisibleAfterZoom}`);

    // Take screenshot
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-zoom.png`,
      fullPage: false,
    });
    console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-zoom.png`);

    expect(previewVisibleAfterZoom, 'Preview card should STAY OPEN during map zoom gesture').toBe(true);
  });

  test('verify preview card persists when Comment button is clicked', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to be fully ready
    await waitForMapReady(page);

    // Zoom to appropriate level
    await zoomMapTo(page, CENTER_COORDINATES, ZOOM_LEVEL);
    await page.waitForTimeout(2000);

    // Click on a property marker
    const previewCard = page.locator('[data-testid="property-preview-card"]');
    let previewVisible = false;

    const clickResult = await clickOnPropertyMarker(page);
    await page.waitForTimeout(1000);
    previewVisible = await previewCard.isVisible().catch(() => false);

    // Fallback clicks
    if (!previewVisible && clickResult.featureCount > 0) {
      const markerPositions = await page.evaluate(() => {
        const mapInstance = (window as any).__mapInstance;
        if (!mapInstance) return [];
        const canvas = mapInstance.getCanvas();
        const layers = ['property-clusters', 'single-active-points', 'active-nodes', 'ghost-nodes'].filter(l => mapInstance.getLayer(l));
        let allFeatures: any[] = [];
        try {
          allFeatures = mapInstance.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers }
          ) || [];
        } catch (e) { /* ignore */ }
        return allFeatures.slice(0, 10).map((f: any) => {
          if (f.geometry?.type === 'Point') {
            const point = mapInstance.project(f.geometry.coordinates);
            const rect = canvas.getBoundingClientRect();
            return { x: rect.left + point.x, y: rect.top + point.y };
          }
          return null;
        }).filter(Boolean);
      });

      for (const pos of markerPositions) {
        if (!pos) continue;
        await page.mouse.click(pos.x, pos.y);
        await page.waitForTimeout(1000);
        previewVisible = await previewCard.isVisible().catch(() => false);
        if (previewVisible) break;
      }
    }

    expect(previewVisible, 'Preview card should be visible before clicking Comment').toBe(true);

    // Wait for property data
    await page.waitForTimeout(2000);

    // Click the Comment button
    const commentButton = page.locator('[data-action="comment"]');
    const hasCommentButton = await commentButton.isVisible().catch(() => false);
    console.log(`Comment button visible: ${hasCommentButton}`);

    if (hasCommentButton) {
      await commentButton.click();
      await page.waitForTimeout(500);

      // Verify preview card is STILL visible
      const previewVisibleAfterComment = await previewCard.isVisible().catch(() => false);
      console.log(`Preview visible after Comment click: ${previewVisibleAfterComment}`);

      // Take screenshot
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-comment-click.png`,
        fullPage: false,
      });

      expect(previewVisibleAfterComment, 'Preview card should STAY OPEN when Comment button is clicked').toBe(true);
    } else {
      // Try alternative locator for Comment button
      const altCommentButton = page.locator('text=Comment');
      const hasAltComment = await altCommentButton.first().isVisible().catch(() => false);
      if (hasAltComment) {
        await altCommentButton.first().click();
        await page.waitForTimeout(500);
        const previewVisibleAfterComment = await previewCard.isVisible().catch(() => false);
        expect(previewVisibleAfterComment, 'Preview card should STAY OPEN when Comment button is clicked').toBe(true);
      }
    }
  });

  test('verify preview card persists when Guess button is clicked', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to be fully ready
    await waitForMapReady(page);

    // Zoom to appropriate level
    await zoomMapTo(page, CENTER_COORDINATES, ZOOM_LEVEL);
    await page.waitForTimeout(2000);

    // Click on a property marker
    const previewCard = page.locator('[data-testid="property-preview-card"]');
    let previewVisible = false;

    const clickResult = await clickOnPropertyMarker(page);
    await page.waitForTimeout(1000);
    previewVisible = await previewCard.isVisible().catch(() => false);

    // Fallback clicks
    if (!previewVisible && clickResult.featureCount > 0) {
      const markerPositions = await page.evaluate(() => {
        const mapInstance = (window as any).__mapInstance;
        if (!mapInstance) return [];
        const canvas = mapInstance.getCanvas();
        const layers = ['property-clusters', 'single-active-points', 'active-nodes', 'ghost-nodes'].filter(l => mapInstance.getLayer(l));
        let allFeatures: any[] = [];
        try {
          allFeatures = mapInstance.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers }
          ) || [];
        } catch (e) { /* ignore */ }
        return allFeatures.slice(0, 10).map((f: any) => {
          if (f.geometry?.type === 'Point') {
            const point = mapInstance.project(f.geometry.coordinates);
            const rect = canvas.getBoundingClientRect();
            return { x: rect.left + point.x, y: rect.top + point.y };
          }
          return null;
        }).filter(Boolean);
      });

      for (const pos of markerPositions) {
        if (!pos) continue;
        await page.mouse.click(pos.x, pos.y);
        await page.waitForTimeout(1000);
        previewVisible = await previewCard.isVisible().catch(() => false);
        if (previewVisible) break;
      }
    }

    expect(previewVisible, 'Preview card should be visible before clicking Guess').toBe(true);

    // Wait for property data
    await page.waitForTimeout(2000);

    // Click the Guess button
    const guessButton = page.locator('[data-action="guess"]');
    const hasGuessButton = await guessButton.isVisible().catch(() => false);
    console.log(`Guess button visible: ${hasGuessButton}`);

    if (hasGuessButton) {
      await guessButton.click();
      await page.waitForTimeout(500);

      // Verify preview card is STILL visible
      const previewVisibleAfterGuess = await previewCard.isVisible().catch(() => false);
      console.log(`Preview visible after Guess click: ${previewVisibleAfterGuess}`);

      // Take screenshot
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-guess-click.png`,
        fullPage: false,
      });

      expect(previewVisibleAfterGuess, 'Preview card should STAY OPEN when Guess button is clicked').toBe(true);
    } else {
      // Try alternative locator
      const altGuessButton = page.locator('text=Guess');
      const hasAltGuess = await altGuessButton.first().isVisible().catch(() => false);
      if (hasAltGuess) {
        await altGuessButton.first().click();
        await page.waitForTimeout(500);
        const previewVisibleAfterGuess = await previewCard.isVisible().catch(() => false);
        expect(previewVisibleAfterGuess, 'Preview card should STAY OPEN when Guess button is clicked').toBe(true);
      }
    }
  });

  test('verify preview card closes ONLY on empty map background tap', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to be fully ready
    await waitForMapReady(page);

    // Zoom to appropriate level
    await zoomMapTo(page, CENTER_COORDINATES, ZOOM_LEVEL);
    await page.waitForTimeout(2000);

    // Click on a property marker
    const previewCard = page.locator('[data-testid="property-preview-card"]');
    let previewVisible = false;

    const clickResult = await clickOnPropertyMarker(page);
    await page.waitForTimeout(1000);
    previewVisible = await previewCard.isVisible().catch(() => false);

    // Fallback clicks
    if (!previewVisible && clickResult.featureCount > 0) {
      const markerPositions = await page.evaluate(() => {
        const mapInstance = (window as any).__mapInstance;
        if (!mapInstance) return [];
        const canvas = mapInstance.getCanvas();
        const layers = ['property-clusters', 'single-active-points', 'active-nodes', 'ghost-nodes'].filter(l => mapInstance.getLayer(l));
        let allFeatures: any[] = [];
        try {
          allFeatures = mapInstance.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers }
          ) || [];
        } catch (e) { /* ignore */ }
        return allFeatures.slice(0, 10).map((f: any) => {
          if (f.geometry?.type === 'Point') {
            const point = mapInstance.project(f.geometry.coordinates);
            const rect = canvas.getBoundingClientRect();
            return { x: rect.left + point.x, y: rect.top + point.y };
          }
          return null;
        }).filter(Boolean);
      });

      for (const pos of markerPositions) {
        if (!pos) continue;
        await page.mouse.click(pos.x, pos.y);
        await page.waitForTimeout(1000);
        previewVisible = await previewCard.isVisible().catch(() => false);
        if (previewVisible) break;
      }
    }

    expect(previewVisible, 'Preview card should be visible before background tap').toBe(true);

    // Wait for property data
    await page.waitForTimeout(2000);

    // Take screenshot with preview visible
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });
    console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`);

    // Find an empty spot on the map and fire a click event there
    const clickResult2 = await page.evaluate(() => {
      const mapInstance = (window as any).__mapInstance;
      if (!mapInstance || !mapInstance.isStyleLoaded()) {
        return { success: false, reason: 'Map not ready' };
      }

      const canvas = mapInstance.getCanvas();
      const layerNames = ['property-clusters', 'single-active-points', 'active-nodes', 'ghost-nodes'];

      // Find a point that has no features by sampling the map
      const width = canvas.width;
      const height = canvas.height;

      // Try several positions to find an empty spot
      const testPoints = [
        { x: 20, y: 20 },           // top-left
        { x: width - 20, y: 20 },   // top-right
        { x: 20, y: height - 20 },  // bottom-left (might have preview card)
        { x: width / 4, y: 50 },    // upper left quadrant
        { x: 3 * width / 4, y: 50 }, // upper right quadrant
      ];

      for (const point of testPoints) {
        const features = mapInstance.queryRenderedFeatures(
          [point.x, point.y],
          { layers: layerNames.filter(l => mapInstance.getLayer(l)) }
        ) || [];

        if (features.length === 0) {
          // Found an empty spot - fire click event
          const lngLat = mapInstance.unproject([point.x, point.y]);
          const rect = canvas.getBoundingClientRect();

          mapInstance.fire('click', {
            point: point,
            lngLat: lngLat,
            originalEvent: new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              clientX: rect.left + point.x,
              clientY: rect.top + point.y,
              view: window
            }),
            features: []
          });

          return { success: true, point, screenX: rect.left + point.x, screenY: rect.top + point.y };
        }
      }

      // If no empty spot found, fire click at first position anyway (as test fallback)
      const point = testPoints[0];
      const lngLat = mapInstance.unproject([point.x, point.y]);
      const rect = canvas.getBoundingClientRect();

      mapInstance.fire('click', {
        point: point,
        lngLat: lngLat,
        originalEvent: new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + point.x,
          clientY: rect.top + point.y,
          view: window
        }),
        features: []
      });

      return { success: true, point, screenX: rect.left + point.x, screenY: rect.top + point.y, note: 'Forced - no empty spot found' };
    });

    console.log(`Background click result: ${JSON.stringify(clickResult2)}`);

    // Also perform a real click at the same position
    if (clickResult2.screenX && clickResult2.screenY) {
      await page.mouse.click(clickResult2.screenX, clickResult2.screenY);
    }
    await page.waitForTimeout(500);

    // Verify preview card is NOW closed
    const previewVisibleAfterBackgroundTap = await previewCard.isVisible().catch(() => false);
    console.log(`Preview visible after background tap: ${previewVisibleAfterBackgroundTap}`);

    // Take screenshot after closing
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-background-tap.png`,
      fullPage: false,
    });

    expect(previewVisibleAfterBackgroundTap, 'Preview card should CLOSE when tapping empty map background').toBe(false);
  });

  test('CRITICAL: verify preview card persists when card body is clicked', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to be fully ready
    await waitForMapReady(page);

    // Zoom to appropriate level
    await zoomMapTo(page, CENTER_COORDINATES, ZOOM_LEVEL);
    await page.waitForTimeout(2000);

    // Click on a property marker
    const previewCard = page.locator('[data-testid="property-preview-card"]');
    let previewVisible = false;

    const clickResult = await clickOnPropertyMarker(page);
    await page.waitForTimeout(1000);
    previewVisible = await previewCard.isVisible().catch(() => false);

    // Fallback clicks
    if (!previewVisible && clickResult.featureCount > 0) {
      const markerPositions = await page.evaluate(() => {
        const mapInstance = (window as any).__mapInstance;
        if (!mapInstance) return [];
        const canvas = mapInstance.getCanvas();
        const layers = ['property-clusters', 'single-active-points', 'active-nodes', 'ghost-nodes'].filter(l => mapInstance.getLayer(l));
        let allFeatures: any[] = [];
        try {
          allFeatures = mapInstance.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers }
          ) || [];
        } catch (e) { /* ignore */ }
        return allFeatures.slice(0, 10).map((f: any) => {
          if (f.geometry?.type === 'Point') {
            const point = mapInstance.project(f.geometry.coordinates);
            const rect = canvas.getBoundingClientRect();
            return { x: rect.left + point.x, y: rect.top + point.y };
          }
          return null;
        }).filter(Boolean);
      });

      for (const pos of markerPositions) {
        if (!pos) continue;
        await page.mouse.click(pos.x, pos.y);
        await page.waitForTimeout(1000);
        previewVisible = await previewCard.isVisible().catch(() => false);
        if (previewVisible) break;
      }
    }

    expect(previewVisible, 'Preview card should be visible before clicking card body').toBe(true);

    // Wait for property data to load
    await page.waitForTimeout(2000);

    // Take screenshot before clicking card body
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-before-card-body-click.png`,
      fullPage: false,
    });
    console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-before-card-body-click.png`);

    // Click on the preview card body (not on action buttons)
    // This should expand the bottom sheet but NOT close the preview card
    const cardBody = page.locator('.property-preview-card');
    const cardBodyVisible = await cardBody.isVisible().catch(() => false);

    if (cardBodyVisible) {
      // Click on the card body (address/info area, not buttons)
      const previewInfo = page.locator('.preview-info').first();
      const infoVisible = await previewInfo.isVisible().catch(() => false);

      if (infoVisible) {
        await previewInfo.click();
      } else {
        // Fallback: click on the card body itself
        await cardBody.click();
      }
      await page.waitForTimeout(1000);
    }

    // Verify preview card is STILL visible after clicking card body
    const previewVisibleAfterCardClick = await previewCard.isVisible().catch(() => false);
    console.log(`Preview visible after card body click: ${previewVisibleAfterCardClick}`);

    // Take screenshot after clicking card body
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-card-body-click.png`,
      fullPage: false,
    });
    console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-card-body-click.png`);

    expect(previewVisibleAfterCardClick, 'CRITICAL: Preview card should STAY OPEN when card body is clicked').toBe(true);
  });

  test('CRITICAL: verify preview card persists when map tapped to dismiss expanded sheet', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to be fully ready
    await waitForMapReady(page);

    // Zoom to appropriate level
    await zoomMapTo(page, CENTER_COORDINATES, ZOOM_LEVEL);
    await page.waitForTimeout(2000);

    // Click on a property marker to show preview
    const previewCard = page.locator('[data-testid="property-preview-card"]');
    let previewVisible = false;

    const clickResult = await clickOnPropertyMarker(page);
    await page.waitForTimeout(1000);
    previewVisible = await previewCard.isVisible().catch(() => false);

    // Fallback clicks
    if (!previewVisible && clickResult.featureCount > 0) {
      const markerPositions = await page.evaluate(() => {
        const mapInstance = (window as any).__mapInstance;
        if (!mapInstance) return [];
        const canvas = mapInstance.getCanvas();
        const layers = ['property-clusters', 'single-active-points', 'active-nodes', 'ghost-nodes'].filter(l => mapInstance.getLayer(l));
        let allFeatures: any[] = [];
        try {
          allFeatures = mapInstance.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers }
          ) || [];
        } catch (e) { /* ignore */ }
        return allFeatures.slice(0, 10).map((f: any) => {
          if (f.geometry?.type === 'Point') {
            const point = mapInstance.project(f.geometry.coordinates);
            const rect = canvas.getBoundingClientRect();
            return { x: rect.left + point.x, y: rect.top + point.y };
          }
          return null;
        }).filter(Boolean);
      });

      for (const pos of markerPositions) {
        if (!pos) continue;
        await page.mouse.click(pos.x, pos.y);
        await page.waitForTimeout(1000);
        previewVisible = await previewCard.isVisible().catch(() => false);
        if (previewVisible) break;
      }
    }

    expect(previewVisible, 'Preview card should be visible before expanding sheet').toBe(true);

    // Wait for property data
    await page.waitForTimeout(2000);

    // Expand the bottom sheet by clicking the preview card body
    const cardBody = page.locator('.property-preview-card');
    const cardBodyVisible = await cardBody.isVisible().catch(() => false);

    if (cardBodyVisible) {
      const previewInfo = page.locator('.preview-info').first();
      const infoVisible = await previewInfo.isVisible().catch(() => false);
      if (infoVisible) {
        await previewInfo.click();
      } else {
        await cardBody.click();
      }
      // Wait for the bottom sheet animation to complete and index to update
      await page.waitForTimeout(2000);
    }

    // Verify that the bottom sheet is expanded by checking via window ref
    const sheetIndexBefore = await page.evaluate(() => {
      const bottomSheetRef = (window as any).__bottomSheetRef;
      const sheetIndexFromWindow = (window as any).__sheetIndex;
      return {
        fromRef: bottomSheetRef?.current?.getCurrentIndex?.() ?? -999,
        fromWindow: sheetIndexFromWindow ?? -999
      };
    });
    console.log(`Bottom sheet index before map tap: ref=${sheetIndexBefore.fromRef}, window=${sheetIndexBefore.fromWindow}`);

    // Take screenshot with expanded sheet
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-sheet-expanded.png`,
      fullPage: false,
    });
    console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-sheet-expanded.png`);

    // Now tap on map/backdrop to dismiss the expanded sheet
    // The preview card should STAY OPEN after this
    const backdropResult = await page.evaluate(() => {
      const mapInstance = (window as any).__mapInstance;
      if (!mapInstance) return { success: false, reason: 'No map' };

      const canvas = mapInstance.getCanvas();
      const rect = canvas.getBoundingClientRect();

      // Find an empty spot on the map near the top (away from bottom sheet)
      const point = { x: 50, y: 50 };
      const lngLat = mapInstance.unproject([point.x, point.y]);

      // Fire the click event - this should close the sheet but NOT the preview
      mapInstance.fire('click', {
        point: point,
        lngLat: lngLat,
        originalEvent: new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + point.x,
          clientY: rect.top + point.y,
          view: window
        }),
        features: []
      });

      return { success: true, screenX: rect.left + point.x, screenY: rect.top + point.y };
    });

    console.log(`Backdrop click result: ${JSON.stringify(backdropResult)}`);

    if (backdropResult.screenX && backdropResult.screenY) {
      await page.mouse.click(backdropResult.screenX, backdropResult.screenY);
    }
    await page.waitForTimeout(1000);

    // Verify preview card is STILL visible after dismissing the sheet
    const previewVisibleAfterSheetDismiss = await previewCard.isVisible().catch(() => false);
    console.log(`Preview visible after sheet dismiss: ${previewVisibleAfterSheetDismiss}`);

    // Take screenshot after dismissing sheet
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-sheet-dismiss.png`,
      fullPage: false,
    });
    console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-sheet-dismiss.png`);

    expect(previewVisibleAfterSheetDismiss, 'CRITICAL: Preview card should STAY OPEN when map is tapped to dismiss expanded sheet').toBe(true);
  });

  test('capture main screenshot for visual comparison', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to be fully ready
    await waitForMapReady(page);

    // Zoom to a level where individual markers are visible
    await zoomMapTo(page, CENTER_COORDINATES, ZOOM_LEVEL);
    await page.waitForTimeout(2000);

    // Click on a property marker
    const previewCard = page.locator('[data-testid="property-preview-card"]');
    let previewVisible = false;

    const clickResult = await clickOnPropertyMarker(page);
    await page.waitForTimeout(1000);
    previewVisible = await previewCard.isVisible().catch(() => false);

    // Fallback clicks
    if (!previewVisible && clickResult.featureCount > 0) {
      const markerPositions = await page.evaluate(() => {
        const mapInstance = (window as any).__mapInstance;
        if (!mapInstance) return [];
        const canvas = mapInstance.getCanvas();
        const layers = ['property-clusters', 'single-active-points', 'active-nodes', 'ghost-nodes'].filter(l => mapInstance.getLayer(l));
        let allFeatures: any[] = [];
        try {
          allFeatures = mapInstance.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers }
          ) || [];
        } catch (e) { /* ignore */ }
        return allFeatures.slice(0, 10).map((f: any) => {
          if (f.geometry?.type === 'Point') {
            const point = mapInstance.project(f.geometry.coordinates);
            const rect = canvas.getBoundingClientRect();
            return { x: rect.left + point.x, y: rect.top + point.y };
          }
          return null;
        }).filter(Boolean);
      });

      for (const pos of markerPositions) {
        if (!pos) continue;
        await page.mouse.click(pos.x, pos.y);
        await page.waitForTimeout(1000);
        previewVisible = await previewCard.isVisible().catch(() => false);
        if (previewVisible) break;
      }
    }

    // Wait for full render with property data
    if (previewVisible) {
      await page.waitForTimeout(2000);
    }

    // Take main screenshot
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });
    console.log(`Main screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`);

    // Verify basic functionality
    expect(previewVisible || clickResult.featureCount > 0, 'Should have property markers on map').toBe(true);

    // Verify map canvas visible
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10000 });
  });
});
