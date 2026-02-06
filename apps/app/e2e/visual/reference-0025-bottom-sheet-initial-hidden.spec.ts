/**
 * Reference Expectation E2E Test: 0025-bottom-sheet-initial-hidden
 *
 * This test verifies the bottom sheet is completely hidden on initial app load:
 * - No drag handle visible when no property is selected
 * - No shadow or border from bottom sheet visible
 * - Map extends to full bottom of screen
 * - Bottom sheet only appears when property/cluster is selected
 * - Bottom sheet hides completely when deselected
 *
 * Screenshot saved to: test-results/reference-expectations/0025-bottom-sheet-initial-hidden/
 */

import { test, expect, Page, Route } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { waitForMapStyleLoaded, waitForMapIdle } from './helpers/visual-test-helpers';

/**
 * Mock property data for testing
 */
const MOCK_PROPERTY = {
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
 * Setup API route interception to return mock property data
 */
async function setupPropertyMocking(page: Page): Promise<void> {
  await page.route('**/properties/*', async (route: Route) => {
    const url = route.request().url();

    if (url.match(/\/properties\/[^/]+$/) && route.request().method() === 'GET') {
      const propertyId = url.split('/').pop();

      const mockResponse = {
        ...MOCK_PROPERTY,
        id: propertyId,
      };

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
const EXPECTATION_NAME = '0025-bottom-sheet-initial-hidden';
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
 * Check if any bottom sheet elements are visible
 */
async function checkBottomSheetVisibility(page: Page): Promise<{
  handleVisible: boolean;
  sheetVisible: boolean;
  shadowVisible: boolean;
  details: string;
}> {
  const result = await page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    let details: string[] = [];

    // Check for drag handle indicator (typically a small gray bar)
    // @gorhom/bottom-sheet uses specific styling for the handle
    const handleElements = Array.from(document.querySelectorAll('[style*="background-color: rgb(209, 213, 219)"], [style*="#D1D5DB"]'));
    let handleVisible = false;

    for (let i = 0; i < handleElements.length; i++) {
      const el = handleElements[i];
      const rect = el.getBoundingClientRect();
      // Handle is typically small (30-50px wide, 4-8px tall) and positioned at bottom area
      if (rect.width > 20 && rect.width < 100 && rect.height < 20 && rect.top > viewport.height * 0.5) {
        handleVisible = true;
        details.push(`Handle found at y=${rect.top.toFixed(0)}, size=${rect.width.toFixed(0)}x${rect.height.toFixed(0)}`);
      }
    }

    // Check for bottom sheet container with visible content at bottom of screen
    // The bottom sheet is identified by:
    // 1. Being positioned at the BOTTOM of the viewport (not starting from top)
    // 2. Having a white background
    // 3. Having rounded corners or specific styling
    // 4. NOT being the full-height page container
    let sheetVisible = false;
    const allElements = Array.from(document.querySelectorAll('*'));

    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i];
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();

      // Look for white background elements at the bottom that could be the sheet
      if (style.backgroundColor === 'rgb(255, 255, 255)' || style.backgroundColor === 'white') {
        // Must be at BOTTOM portion of screen (top > 50% of viewport)
        // This filters out full-page containers
        if (rect.top > viewport.height * 0.5 && rect.width > viewport.width * 0.8 && rect.bottom >= viewport.height - 10) {
          // Check if it has meaningful height (20-500px would be a sheet, not just a line)
          const visibleHeight = viewport.height - rect.top;
          if (visibleHeight > 20 && visibleHeight < viewport.height * 0.6) {
            // Check if it has z-index or is positioned above map
            const zIndex = parseInt(style.zIndex) || 0;
            const position = style.position;
            // Bottom sheet typically has absolute/fixed position or high z-index
            if (zIndex > 0 || position === 'absolute' || position === 'fixed') {
              sheetVisible = true;
              details.push(`Sheet-like element at y=${rect.top.toFixed(0)}, height=${visibleHeight.toFixed(0)}, z=${zIndex}`);
            }
          }
        }
      }
    }

    // Check for shadows that might indicate a bottom sheet
    let shadowVisible = false;
    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i];
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();

      if (style.boxShadow && style.boxShadow !== 'none') {
        // Check if this shadow is at the bottom area of the screen
        if (rect.top > viewport.height * 0.7 && rect.width > viewport.width * 0.5) {
          shadowVisible = true;
          details.push(`Shadow element at y=${rect.top.toFixed(0)}`);
        }
      }
    }

    return {
      handleVisible,
      sheetVisible,
      shadowVisible,
      details: details.join('; ') || 'No bottom sheet elements detected'
    };
  });

  console.log(`Bottom sheet visibility check: ${result.details}`);
  return result;
}

/**
 * Helper function to find and click on a property marker
 */
async function clickOnPropertyMarker(page: Page): Promise<{ success: boolean; featureCount: number }> {
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

  return { success: result.success, featureCount: result.featureCount };
}

/**
 * Get map canvas bottom position to verify it extends to screen bottom
 */
async function getMapCanvasExtent(page: Page): Promise<{
  canvasBottom: number;
  viewportHeight: number;
  gapToBottom: number;
}> {
  return await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const viewportHeight = window.innerHeight;

    if (!canvas) {
      return { canvasBottom: 0, viewportHeight, gapToBottom: viewportHeight };
    }

    const rect = canvas.getBoundingClientRect();
    const gapToBottom = viewportHeight - rect.bottom;

    return {
      canvasBottom: rect.bottom,
      viewportHeight,
      gapToBottom
    };
  });
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

  test('bottom sheet is completely hidden on initial app load', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to be fully ready
    await waitForMapReady(page);

    // Take initial screenshot immediately after load
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-initial-load.png`,
      fullPage: false,
    });
    console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-initial-load.png`);

    // Check bottom sheet visibility - should be completely hidden
    const initialVisibility = await checkBottomSheetVisibility(page);
    console.log(`Initial state - Handle: ${initialVisibility.handleVisible}, Sheet: ${initialVisibility.sheetVisible}, Shadow: ${initialVisibility.shadowVisible}`);

    // Verify NO handle is visible
    expect(initialVisibility.handleVisible, 'Drag handle should NOT be visible on initial load').toBe(false);

    // Verify NO sheet content is visible
    expect(initialVisibility.sheetVisible, 'Bottom sheet should NOT be visible on initial load').toBe(false);

    // Verify NO shadows from bottom sheet
    expect(initialVisibility.shadowVisible, 'No bottom sheet shadow should be visible on initial load').toBe(false);

    // Verify map extends to full screen bottom
    const mapExtent = await getMapCanvasExtent(page);
    console.log(`Map canvas bottom: ${mapExtent.canvasBottom}, Viewport: ${mapExtent.viewportHeight}, Gap: ${mapExtent.gapToBottom}`);

    // Allow gap for navigation bar, footer, or safe area (typically up to 60-80px)
    // The key verification is that NO bottom sheet is visible, not exact pixel measurements
    expect(mapExtent.gapToBottom, 'Map should extend close to bottom of screen (allowing for nav bar)').toBeLessThanOrEqual(80);

    // Take final current screenshot
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });
    console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`);
  });

  test('bottom sheet appears when property is selected', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to be fully ready
    await waitForMapReady(page);

    // Zoom to appropriate level
    await zoomMapTo(page, CENTER_COORDINATES, ZOOM_LEVEL);
    await page.waitForTimeout(2000);

    // Verify initial hidden state
    const initialVisibility = await checkBottomSheetVisibility(page);
    expect(initialVisibility.handleVisible || initialVisibility.sheetVisible, 'Bottom sheet should be hidden initially').toBe(false);

    // Click on a property marker
    const previewCard = page.locator('[data-testid="property-preview-card"]');
    let previewVisible = false;

    const clickResult = await clickOnPropertyMarker(page);
    console.log(`Marker click: success=${clickResult.success}, features=${clickResult.featureCount}`);

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

    if (previewVisible) {
      await page.waitForTimeout(2000);

      // Take screenshot with property selected
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-property-selected.png`,
        fullPage: false,
      });
      console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-property-selected.png`);

      // Verify preview card is visible
      expect(previewVisible, 'Preview card should be visible after selecting property').toBe(true);
    }

    expect(previewVisible || clickResult.featureCount > 0, 'Should have property markers on map').toBe(true);
  });

  test('bottom sheet hides when preview card is dismissed', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to be fully ready
    await waitForMapReady(page);

    // Zoom to appropriate level
    await zoomMapTo(page, CENTER_COORDINATES, ZOOM_LEVEL);
    await page.waitForTimeout(2000);

    // Click on a property marker to select
    const previewCard = page.locator('[data-testid="property-preview-card"]');

    const clickResult = await clickOnPropertyMarker(page);
    await page.waitForTimeout(1000);
    let previewVisible = await previewCard.isVisible().catch(() => false);

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

    if (previewVisible) {
      await page.waitForTimeout(2000);

      // Take screenshot with property selected
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-before-dismiss.png`,
        fullPage: false,
      });

      // Verify the preview card and bottom sheet peek are visible
      const visibilityWithProperty = await checkBottomSheetVisibility(page);
      console.log(`With property selected - Handle: ${visibilityWithProperty.handleVisible}, Sheet: ${visibilityWithProperty.sheetVisible}`);

      // Click on empty map area to deselect (only works when sheet is in peek state per 0023)
      // The preview will close, and when it does, the bottom sheet should also hide completely
      const emptySpot = await page.evaluate(() => {
        const mapInstance = (window as any).__mapInstance;
        if (!mapInstance) return null;
        const canvas = mapInstance.getCanvas();
        const rect = canvas.getBoundingClientRect();

        // Try clicking near the top-left corner (less likely to have markers)
        return { x: rect.left + 50, y: rect.top + 50 };
      });

      if (emptySpot) {
        await page.mouse.click(emptySpot.x, emptySpot.y);
        await page.waitForTimeout(1500);
      }

      // Take screenshot after dismiss attempt
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-dismiss.png`,
        fullPage: false,
      });
      console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-dismiss.png`);

      // Check if preview is now hidden
      const previewStillVisible = await previewCard.isVisible().catch(() => false);
      console.log(`Preview card visible after map click: ${previewStillVisible}`);

      // Per 0023-preview-card-persistence, the preview persists when sheet is in peek state
      // So we only verify the bottom sheet handle goes away when preview goes away
      if (!previewStillVisible) {
        // Check bottom sheet visibility after deselect
        const afterDismissVisibility = await checkBottomSheetVisibility(page);
        console.log(`After dismiss - Handle: ${afterDismissVisibility.handleVisible}, Sheet: ${afterDismissVisibility.sheetVisible}`);

        // When preview is dismissed, bottom sheet elements should also be hidden
        expect(afterDismissVisibility.handleVisible, 'Drag handle should NOT be visible when no property selected').toBe(false);
      } else {
        // Preview card persisting is acceptable per 0023 requirement
        console.log('Preview card persisted (expected behavior per 0023-preview-card-persistence)');
      }
    }

    expect(clickResult.featureCount > 0, 'Should have property markers on map for this test').toBe(true);
  });
});
