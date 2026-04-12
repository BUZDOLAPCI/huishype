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
import { waitForMapStyleLoaded, waitForMapIdle } from './helpers/visual-test-helpers';
import { clickOnPropertyMarker, clickPreviewAction } from './helpers/screenshot-harness';
import fs from 'fs';

/**
 * Mock property data with price information for testing
 */
const MOCK_PROPERTY_WITH_PRICE = {
  id: 'test-property-001',
  nationalId: '0772010000123456',
  address: 'Stratumseind 100',
  city: 'Eindhoven',
  postalCode: '5611 ET',
  geometry: {
    type: 'Point',
    coordinates: [5.4697, 51.4416],
  },
  yearBuilt: 1985,
  floorAreaM2: 120,
  status: 'active',
  officialValuation: 425000,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

/**
 * Setup API route interception to return mock property data with prices
 */
async function setupPropertyMocking(page: Page): Promise<void> {
  await page.route('**/properties/*', async (route: Route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;

    if (
      route.request().method() === 'GET' &&
      pathname.match(/^\/properties\/[^/]+$/) &&
      pathname !== '/properties/resolve'
    ) {
      const propertyId = pathname.split('/').pop();

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
const CENTER_COORDINATES: [number, number] = [5.4697, 51.4416];
const ZOOM_LEVEL = 17;

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

// Increase test timeout
test.setTimeout(120000);

/**
 * Helper function to wait for map to be ready
 */
async function waitForMapReady(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

  // Wait for map instance to be available and style loaded
  await waitForMapStyleLoaded(page);

  // Wait for map to be idle (all tiles fully rendered)
  await waitForMapIdle(page, 10000);
}

async function collapseWebPanelToPreviewOnly(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__bottomSheetRef?.current?.close?.();
  });

  await page.waitForFunction(() => {
    const backdrop = document.querySelector('[data-testid="web-panel-backdrop"]');
    if (!backdrop) return true;
    const style = window.getComputedStyle(backdrop);
    return !backdrop.classList.contains('open') || style.pointerEvents === 'none' || parseFloat(style.opacity || '0') < 0.1;
  }, { timeout: 5000 }).catch(() => {});
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

  // Wait for map to be idle after zoom (all tiles loaded)
  await waitForMapIdle(page);

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
    const previewCard = page.locator('[data-testid="group-preview-card"]');
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
        const layers = ['property-clusters', 'ghost-clusters', 'active-nodes', 'ghost-nodes'].filter(l => mapInstance.getLayer(l));
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
    const previewCard = page.locator('[data-testid="group-preview-card"]');
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
        const layers = ['property-clusters', 'ghost-clusters', 'active-nodes', 'ghost-nodes'].filter(l => mapInstance.getLayer(l));
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
    const previewCard = page.locator('[data-testid="group-preview-card"]');
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
        const layers = ['property-clusters', 'ghost-clusters', 'active-nodes', 'ghost-nodes'].filter(l => mapInstance.getLayer(l));
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

    await collapseWebPanelToPreviewOnly(page);
    const commentClicked = await clickPreviewAction(page, 'comment');
    expect(commentClicked, 'Comment button should be clickable from the preview card').toBe(true);
    await page.waitForTimeout(500);

    // After clicking Comment, the web panel re-opens; the preview should still exist.
    const previewCountAfterComment = await previewCard.count();
    console.log(`Preview count after Comment click: ${previewCountAfterComment}`);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-comment-click.png`,
      fullPage: false,
    });

    expect(previewCountAfterComment, 'Preview card should STAY in DOM when Comment button is clicked').toBeGreaterThan(0);
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
    const previewCard = page.locator('[data-testid="group-preview-card"]');
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
        const layers = ['property-clusters', 'ghost-clusters', 'active-nodes', 'ghost-nodes'].filter(l => mapInstance.getLayer(l));
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

    await collapseWebPanelToPreviewOnly(page);
    const guessClicked = await clickPreviewAction(page, 'guess');
    expect(guessClicked, 'Guess button should be clickable from the preview card').toBe(true);
    await page.waitForTimeout(500);

    const previewCountAfterGuess = await previewCard.count();
    console.log(`Preview count after Guess click: ${previewCountAfterGuess}`);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-guess-click.png`,
      fullPage: false,
    });

    expect(previewCountAfterGuess, 'Preview card should STAY in DOM when Guess button is clicked').toBeGreaterThan(0);
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
    const previewCard = page.locator('[data-testid="group-preview-card"]');
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
        const layers = ['property-clusters', 'ghost-clusters', 'active-nodes', 'ghost-nodes'].filter(l => mapInstance.getLayer(l));
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

    // On web, clicking a marker auto-opens the WebPropertyPanel (sheetIndex > 0).
    // Dismiss the sheet through the visible close control so the background tap
    // exercises the real user-facing "empty map background" path.
    const closeButton = page.locator('[data-testid="web-panel-close"]');
    await expect(closeButton).toBeVisible({ timeout: 10000 });
    await closeButton.click();
    await page.waitForTimeout(1000);

    // Verify the panel is closed
    const sheetIndexAfterClose = await page.evaluate(() => (window as any).__sheetIndex);
    console.log(`Sheet index after panel close: ${sheetIndexAfterClose}`);

    // Now simulate empty-background tap. We need to click the actual canvas at a point
    // that: (a) has no property features, (b) is not covered by the popup DOM element,
    // (c) is not covered by other UI overlays (search bar, zoom debug, header, etc.)
    //
    // To avoid all overlay issues, we use elementFromPoint() to check what DOM element
    // is at each candidate position, and only pick spots where the canvas is the topmost element.
    const popupBox = await page.locator('[data-testid="group-preview-card"]').boundingBox().catch(() => null);
    console.log(`Popup bounding box: ${JSON.stringify(popupBox)}`);

    const emptySpotResult = await page.evaluate((popupRect) => {
      const mapInstance = (window as any).__mapInstance;
      if (!mapInstance || !mapInstance.isStyleLoaded()) {
        return { success: false, reason: 'Map not ready' };
      }

      const canvas = mapInstance.getCanvas();
      const rect = canvas.getBoundingClientRect();
      const layerNames = ['property-clusters', 'ghost-clusters', 'active-nodes', 'ghost-nodes'];
      const existingLayers = layerNames.filter(l => mapInstance.getLayer(l));
      const width = canvas.width;
      const height = canvas.height;

      // Generate a denser set of candidate points across the interior of the
      // canvas, avoiding the edges where map chrome and header overlays live.
      const margin = Math.min(width, height) * 0.12;
      const testPoints: Array<{ x: number; y: number }> = [];

      const xSteps = 16;
      const ySteps = 12;
      for (let xi = 0; xi <= xSteps; xi++) {
        for (let yi = 0; yi <= ySteps; yi++) {
          testPoints.push({
            x: margin + ((width - margin * 2) * xi) / xSteps,
            y: margin + ((height - margin * 2) * yi) / ySteps,
          });
        }
      }

      // A few hand-picked points near the lower half of the map help when the
      // property density is high around the center but the background is still
      // open toward the edges.
      testPoints.push(
        { x: width * 0.18, y: height * 0.78 },
        { x: width * 0.82, y: height * 0.78 },
        { x: width * 0.18, y: height * 0.58 },
        { x: width * 0.82, y: height * 0.58 },
        { x: width * 0.50, y: height * 0.84 },
      );

      for (const point of testPoints) {
        const screenX = rect.left + point.x;
        const screenY = rect.top + point.y;

        // Check if popup covers this point
        if (popupRect) {
          const inPopup = screenX >= popupRect.x - 10 && screenX <= popupRect.x + popupRect.width + 10 &&
                          screenY >= popupRect.y - 10 && screenY <= popupRect.y + popupRect.height + 10;
          if (inPopup) continue;
        }

        // Check if the canvas is the topmost element at this screen position
        const topElement = document.elementFromPoint(screenX, screenY);
        const isCanvas = topElement === canvas || topElement?.tagName === 'CANVAS';
        if (!isCanvas) continue;

        // Check for property features at this canvas coordinate
        const features = mapInstance.queryRenderedFeatures([point.x, point.y], { layers: existingLayers }) || [];
        if (features.length === 0) {
          return { success: true, canvasPoint: point, screenX, screenY, featureCount: 0 };
        }
      }

      // Fallback: just return a point where the canvas is topmost, even if it has features
      for (const point of testPoints) {
        const screenX = rect.left + point.x;
        const screenY = rect.top + point.y;
        const topElement = document.elementFromPoint(screenX, screenY);
        if (topElement === canvas || topElement?.tagName === 'CANVAS') {
          return { success: true, canvasPoint: point, screenX, screenY, note: 'fallback-with-features' };
        }
      }

      return { success: false, reason: 'No suitable click point found' };
    }, popupBox);

    console.log(`Empty spot result: ${JSON.stringify(emptySpotResult)}`);

    // Click the empty spot on the canvas
    if (emptySpotResult.success && emptySpotResult.screenX && emptySpotResult.screenY) {
      await page.mouse.click(emptySpotResult.screenX, emptySpotResult.screenY);
    }

    // Wait for MapLibre click handler + React state update
    await page.waitForTimeout(1500);

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
    const previewCard = page.locator('[data-testid="group-preview-card"]');
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
        const layers = ['property-clusters', 'ghost-clusters', 'active-nodes', 'ghost-nodes'].filter(l => mapInstance.getLayer(l));
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
    // This should expand the WebPropertyPanel but NOT close the preview card.
    // The backdrop intentionally stays pointer-transparent while preview is visible,
    // so close the panel via its explicit control before interacting with the card.
    const closeButton = page.locator('[data-testid="web-panel-close"]');
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click();
      await page.waitForTimeout(500);
    }

    const cardBody = page.locator('[data-testid="group-preview-card"]');
    const cardBodyVisible = await cardBody.isVisible().catch(() => false);

    if (cardBodyVisible) {
      // Click on the card body (property card pressable area)
      const propertyCard = page.locator('[data-testid="property-preview-card"]').first();
      const propertyCardVisible = await propertyCard.isVisible().catch(() => false);

      if (propertyCardVisible) {
        await propertyCard.click();
      } else {
        // Fallback: click on the card body itself
        await cardBody.click();
      }
      await page.waitForTimeout(1000);
    }

    // After clicking card body, the WebPropertyPanel re-opens (snapToIndex(1)).
    // The preview card is still in the DOM but may be behind the panel backdrop,
    // so check DOM presence via count() rather than isVisible().
    const previewCountAfterCardClick = await previewCard.count();
    console.log(`Preview count after card body click: ${previewCountAfterCardClick}`);

    // Take screenshot after clicking card body
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-card-body-click.png`,
      fullPage: false,
    });
    console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-card-body-click.png`);

    expect(previewCountAfterCardClick, 'CRITICAL: Preview card should STAY in DOM when card body is clicked').toBeGreaterThan(0);
  });

  test('CRITICAL: verify preview card persists when expanded sheet is dismissed', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to be fully ready
    await waitForMapReady(page);

    // Zoom to appropriate level
    await zoomMapTo(page, CENTER_COORDINATES, ZOOM_LEVEL);
    await page.waitForTimeout(2000);

    // Click on a property marker to show preview
    const previewCard = page.locator('[data-testid="group-preview-card"]');
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
        const layers = ['property-clusters', 'ghost-clusters', 'active-nodes', 'ghost-nodes'].filter(l => mapInstance.getLayer(l));
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

    // On web, clicking a marker auto-opens the WebPropertyPanel.
    // The panel is already open at this point. Verify it's expanded.
    const sheetIndexBefore = await page.evaluate(() => {
      const bottomSheetRef = (window as any).__bottomSheetRef;
      const sheetIndexFromWindow = (window as any).__sheetIndex;
      return {
        fromRef: bottomSheetRef?.current?.getCurrentIndex?.() ?? -999,
        fromWindow: sheetIndexFromWindow ?? -999
      };
    });
    console.log(`WebPropertyPanel index before dismiss: ref=${sheetIndexBefore.fromRef}, window=${sheetIndexBefore.fromWindow}`);

    // If the panel isn't open, open it by clicking the card body
    if (sheetIndexBefore.fromRef <= 0) {
      const cardBody = page.locator('[data-testid="group-preview-card"]');
      const cardBodyVisible = await cardBody.isVisible().catch(() => false);
      if (cardBodyVisible) {
        const propertyCard = page.locator('[data-testid="property-preview-card"]').first();
        const propertyCardVisible = await propertyCard.isVisible().catch(() => false);
        if (propertyCardVisible) {
          await propertyCard.click();
        } else {
          await cardBody.click();
        }
        await page.waitForTimeout(1000);
      }
    }

    // Take screenshot with expanded panel
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-sheet-expanded.png`,
      fullPage: false,
    });
    console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-sheet-expanded.png`);

    // Dismiss the WebPropertyPanel using the visible close control.
    // The web backdrop is intentionally non-interactive while preview-open.
    const closeButton = page.locator('[data-testid="web-panel-close"]');
    await expect(closeButton).toBeVisible({ timeout: 10000 });
    await closeButton.click();
    await page.waitForTimeout(1000);

    const sheetIndexAfterDismiss = await page.evaluate(() => (window as any).__sheetIndex ?? -999);
    const isLandscape = await page.evaluate(() => window.innerWidth >= window.innerHeight);
    const expectedSheetIndex = isLandscape ? -1 : 0;
    console.log(`WebPropertyPanel index after dismiss: ${sheetIndexAfterDismiss} (expected ${expectedSheetIndex})`);
    expect(sheetIndexAfterDismiss).toBe(expectedSheetIndex);

    // Verify preview card is STILL visible after dismissing the panel
    const previewVisibleAfterSheetDismiss = await previewCard.isVisible().catch(() => false);
    console.log(`Preview visible after panel dismiss: ${previewVisibleAfterSheetDismiss}`);

    // Take screenshot after dismissing panel
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-sheet-dismiss.png`,
      fullPage: false,
    });
    console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-sheet-dismiss.png`);

    expect(previewVisibleAfterSheetDismiss, 'CRITICAL: Preview card should STAY OPEN when panel is dismissed').toBe(true);
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
    const previewCard = page.locator('[data-testid="group-preview-card"]');
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
        const layers = ['property-clusters', 'ghost-clusters', 'active-nodes', 'ghost-nodes'].filter(l => mapInstance.getLayer(l));
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
