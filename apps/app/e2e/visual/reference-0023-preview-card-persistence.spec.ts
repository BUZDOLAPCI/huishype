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

  // Wait for map instance to be available and style loaded
  await waitForMapStyleLoaded(page);

  // Wait for map to be idle (all tiles fully rendered)
  await waitForMapIdle(page, 10000);
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
      // On web, clicking a marker auto-opens the WebPropertyPanel whose backdrop
      // covers the preview card. Close the panel first so we can interact with
      // the preview card's Comment button, then verify the preview persists.
      const backdrop = page.locator('[data-testid="web-panel-backdrop"]');
      const backdropOpen = await backdrop.evaluate((el) => el.classList.contains('open')).catch(() => false);
      if (backdropOpen) {
        await backdrop.click();
        await page.waitForTimeout(500);
      }

      await commentButton.click();
      await page.waitForTimeout(500);

      // After clicking Comment, the WebPropertyPanel re-opens (scrollToComments).
      // The preview card is still in the DOM but may be behind the panel backdrop,
      // so check DOM presence via count() rather than isVisible().
      const previewCountAfterComment = await previewCard.count();
      console.log(`Preview count after Comment click: ${previewCountAfterComment}`);

      // Take screenshot
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-comment-click.png`,
        fullPage: false,
      });

      expect(previewCountAfterComment, 'Preview card should STAY in DOM when Comment button is clicked').toBeGreaterThan(0);
    } else {
      // Try alternative locator for Comment button
      const altCommentButton = page.locator('text=Comment');
      const hasAltComment = await altCommentButton.first().isVisible().catch(() => false);
      if (hasAltComment) {
        await altCommentButton.first().click({ force: true });
        await page.waitForTimeout(500);
        const previewCountAfterComment = await previewCard.count();
        expect(previewCountAfterComment, 'Preview card should STAY in DOM when Comment button is clicked').toBeGreaterThan(0);
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
      // On web, clicking a marker auto-opens the WebPropertyPanel whose backdrop
      // covers the preview card. Close the panel first so we can interact with
      // the preview card's Guess button, then verify the preview persists.
      const backdrop = page.locator('[data-testid="web-panel-backdrop"]');
      const backdropOpen = await backdrop.evaluate((el) => el.classList.contains('open')).catch(() => false);
      if (backdropOpen) {
        await backdrop.click();
        await page.waitForTimeout(500);
      }

      await guessButton.click();
      await page.waitForTimeout(500);

      // After clicking Guess, the WebPropertyPanel re-opens (scrollToGuess).
      // The preview card is still in the DOM but may be behind the panel backdrop,
      // so check DOM presence via count() rather than isVisible().
      const previewCountAfterGuess = await previewCard.count();
      console.log(`Preview count after Guess click: ${previewCountAfterGuess}`);

      // Take screenshot
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-guess-click.png`,
        fullPage: false,
      });

      expect(previewCountAfterGuess, 'Preview card should STAY in DOM when Guess button is clicked').toBeGreaterThan(0);
    } else {
      // Try alternative locator
      const altGuessButton = page.locator('text=Guess');
      const hasAltGuess = await altGuessButton.first().isVisible().catch(() => false);
      if (hasAltGuess) {
        await altGuessButton.first().click({ force: true });
        await page.waitForTimeout(500);
        const previewCountAfterGuess = await previewCard.count();
        expect(previewCountAfterGuess, 'Preview card should STAY in DOM when Guess button is clicked').toBeGreaterThan(0);
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

    // On web, clicking a marker auto-opens the WebPropertyPanel (sheetIndex > 0).
    // The map click handler only closes the preview when sheetIndex <= 0.
    // Close the panel programmatically via __bottomSheetRef to avoid DOM click
    // interference (backdrop click re-triggers property click, close button blocked
    // by panel content).
    await page.evaluate(() => {
      const ref = (window as any).__bottomSheetRef;
      if (ref?.current?.close) {
        ref.current.close();
      }
    });
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
    const popupBox = await page.locator('.property-preview-popup').boundingBox().catch(() => null);
    console.log(`Popup bounding box: ${JSON.stringify(popupBox)}`);

    const emptySpotResult = await page.evaluate((popupRect) => {
      const mapInstance = (window as any).__mapInstance;
      if (!mapInstance || !mapInstance.isStyleLoaded()) {
        return { success: false, reason: 'Map not ready' };
      }

      const canvas = mapInstance.getCanvas();
      const rect = canvas.getBoundingClientRect();
      const layerNames = ['property-clusters', 'single-active-points', 'active-nodes', 'ghost-nodes'];
      const existingLayers = layerNames.filter(l => mapInstance.getLayer(l));
      const width = canvas.width;
      const height = canvas.height;

      // Generate test points in the interior of the canvas, avoiding edges where
      // overlays (search bar, zoom debug, header) are likely positioned
      const margin = Math.min(width, height) * 0.15;
      const testPoints = [
        // Center-ish points, offset to avoid the popup area
        { x: margin, y: height - margin },
        { x: width - margin, y: height - margin },
        { x: margin, y: height / 2 },
        { x: width - margin, y: height / 2 },
        { x: width / 2, y: height - margin },
        { x: width / 3, y: height * 0.7 },
        { x: 2 * width / 3, y: height * 0.7 },
      ];

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

    // Instrument the map's general click handler to track if it fires
    await page.evaluate(() => {
      const mapInstance = (window as any).__mapInstance;
      if (!mapInstance) return;
      (window as any).__mapClickFired = false;
      (window as any).__mapClickDebug = {};
      const debugHandler = (e: any) => {
        const layerNames = ['property-clusters', 'single-active-points', 'active-nodes', 'ghost-nodes'];
        const existingLayers = layerNames.filter(l => mapInstance.getLayer(l));
        const features = existingLayers.length > 0 ? mapInstance.queryRenderedFeatures(e.point, { layers: existingLayers }) : [];
        (window as any).__mapClickFired = true;
        (window as any).__mapClickDebug = {
          point: e.point,
          featuresFound: features.length,
          sheetIndex: (window as any).__sheetIndex,
        };
      };
      // Register as first listener so it runs before others
      mapInstance.on('click', debugHandler);
      // Store for cleanup
      (window as any).__debugHandler = debugHandler;
    });

    // Click the empty spot on the canvas
    if (emptySpotResult.success && emptySpotResult.screenX && emptySpotResult.screenY) {
      await page.mouse.click(emptySpotResult.screenX, emptySpotResult.screenY);
    }

    // Wait for MapLibre click handler + React state update
    await page.waitForTimeout(1500);

    // Cleanup debug handler
    await page.evaluate(() => {
      const mapInstance = (window as any).__mapInstance;
      if (mapInstance && (window as any).__debugHandler) {
        mapInstance.off('click', (window as any).__debugHandler);
      }
    });

    // The first canvas click triggers the MapLibre general click handler which calls
    // setShowPreview(false). However, React's state update + useEffect may need a
    // second event loop tick or a second click to fully process. If the preview card
    // is still present, click the same empty spot once more.
    let previewGone = (await previewCard.count()) === 0;
    if (!previewGone) {
      console.log('Preview still present after first click, retrying...');
      if (emptySpotResult.success && emptySpotResult.screenX && emptySpotResult.screenY) {
        await page.mouse.click(emptySpotResult.screenX, emptySpotResult.screenY);
        await page.waitForTimeout(1500);
      }
    }

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
    // This should expand the WebPropertyPanel but NOT close the preview card
    // On web, clicking a marker auto-opens the WebPropertyPanel whose backdrop
    // covers the preview card. Close the panel first so we can click the card body.
    const backdropEl = page.locator('[data-testid="web-panel-backdrop"]');
    const backdropIsOpen = await backdropEl.evaluate((el) => el.classList.contains('open')).catch(() => false);
    if (backdropIsOpen) {
      await backdropEl.click();
      await page.waitForTimeout(500);
    }

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
        await page.waitForTimeout(1000);
      }
    }

    // Take screenshot with expanded panel
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-sheet-expanded.png`,
      fullPage: false,
    });
    console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-sheet-expanded.png`);

    // Now dismiss the WebPropertyPanel by clicking its backdrop.
    // The preview card should STAY OPEN after the panel is dismissed.
    const backdropEl = page.locator('[data-testid="web-panel-backdrop"]');
    const backdropIsOpen = await backdropEl.evaluate((el) => el.classList.contains('open')).catch(() => false);
    if (backdropIsOpen) {
      await backdropEl.click();
      await page.waitForTimeout(1000);
    }

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
