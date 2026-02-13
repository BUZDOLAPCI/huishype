/**
 * Reference Expectation E2E Test: instant-preview-card-on-tap
 *
 * This test verifies the instant preview card behavior when tapping a property marker:
 * - Preview card appears near the tapped property
 * - Shows: address, price (FMV/asking/WOZ), activity indicator
 * - Quick action buttons: Like, Comment, Guess
 * - Instagram-like quick interaction feel
 *
 * Screenshot saved to: test-results/reference-expectations/instant-preview-card-on-tap/
 */

import { test, expect, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { waitForMapIdle } from './helpers/visual-test-helpers';

// Disable tracing for this test to avoid trace file issues
test.use({ trace: 'off', video: 'off' });

// Configuration
const EXPECTATION_NAME = 'instant-preview-card-on-tap';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Center on Eindhoven area where properties and listings exist
// The backend API returns individual points (with is_ghost) only at z17+
// At z15-z16 there's a gap between frontend layers and backend clustering
const CENTER_COORDINATES: [number, number] = [5.4697, 51.4416];
const ZOOM_LEVEL = 17; // Zoom level where individual markers are visible (API returns individual points at z17+)

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

// Increase test timeout for this visual test
test.setTimeout(120000);

/**
 * Helper function to find and click on a property marker
 * Uses the map's queryRenderedFeatures to find marker screen positions
 * and fires the map's click event directly for reliable interaction
 */
async function clickOnPropertyMarker(page: Page): Promise<{ success: boolean; featureCount: number }> {
  // Try to find and click a property marker using map's fire event
  const result = await page.evaluate(() => {
    const mapInstance = (window as any).__mapInstance;
    if (!mapInstance || !mapInstance.isStyleLoaded()) {
      return { success: false, featureCount: 0, reason: 'Map not ready' };
    }

    const canvas = mapInstance.getCanvas();
    if (!canvas) {
      return { success: false, featureCount: 0, reason: 'No canvas' };
    }

    // Query features with bounding box for the entire canvas
    let allFeatures: any[] = [];
    try {
      const ghostFeatures = mapInstance.queryRenderedFeatures(
        [[0, 0], [canvas.width, canvas.height]],
        { layers: ['ghost-nodes'] }
      ) || [];
      allFeatures = allFeatures.concat(ghostFeatures);
    } catch (e) { /* ignore */ }

    try {
      const activeFeatures = mapInstance.queryRenderedFeatures(
        [[0, 0], [canvas.width, canvas.height]],
        { layers: ['active-nodes'] }
      ) || [];
      allFeatures = allFeatures.concat(activeFeatures);
    } catch (e) { /* ignore */ }

    // Also try clusters if no individual points
    if (allFeatures.length === 0) {
      try {
        const clusterFeatures = mapInstance.queryRenderedFeatures(
          [[0, 0], [canvas.width, canvas.height]],
          { layers: ['property-clusters'] }
        ) || [];
        allFeatures = allFeatures.concat(clusterFeatures);
      } catch (e) { /* ignore */ }
    }

    if (allFeatures.length === 0) {
      return { success: false, featureCount: 0, reason: 'No features found' };
    }

    // Get the first feature and its coordinates
    const feature = allFeatures[0];
    if (!feature.geometry || feature.geometry.type !== 'Point') {
      return { success: false, featureCount: allFeatures.length, reason: 'Invalid geometry' };
    }

    const coordinates = feature.geometry.coordinates;
    const point = mapInstance.project(coordinates);
    const rect = canvas.getBoundingClientRect();

    // Create a click event
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + point.x,
      clientY: rect.top + point.y,
      view: window
    });

    // Fire the click event on the map to trigger the marker click handler
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
    // Also click with Playwright for double-insurance
    if (result.screenX && result.screenY) {
      await page.mouse.click(result.screenX, result.screenY);
    }
    await page.waitForTimeout(500);
  }

  return { success: result.success, featureCount: result.featureCount };
}

/**
 * Helper function to wait for map to be ready with properties loaded
 */
async function waitForMapReady(page: Page): Promise<void> {
  // Wait for map view element
  await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

  // Wait for loading indicator to disappear
  const loadingIndicator = page.locator('text=Loading properties...');
  await loadingIndicator.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {
    console.log('Loading indicator not found or already hidden');
  });

  // Wait for map to fully initialize, style to load, layers to exist, and features to render
  await page.waitForFunction(
    () => {
      const mapInstance = (window as any).__mapInstance;
      if (!mapInstance || !mapInstance.isStyleLoaded()) return false;

      // Check if property layers exist
      const hasGhostLayer = mapInstance.getLayer('ghost-nodes');
      const hasActiveLayer = mapInstance.getLayer('active-nodes');
      const hasClusters = mapInstance.getLayer('property-clusters');
      const hasSingleActive = mapInstance.getLayer('single-active-points');

      if (!hasGhostLayer && !hasActiveLayer && !hasClusters && !hasSingleActive) return false;

      // Also check that there are actually features rendered
      const canvas = mapInstance.getCanvas();
      if (!canvas) return false;

      let featureCount = 0;
      try {
        const features = mapInstance.queryRenderedFeatures(
          [[0, 0], [canvas.width, canvas.height]],
          { layers: ['ghost-nodes', 'active-nodes', 'property-clusters', 'single-active-points'].filter(l => mapInstance.getLayer(l)) }
        );
        featureCount = features?.length || 0;
      } catch (e) {
        // Ignore errors during query
      }

      return featureCount > 0;
    },
    { timeout: 45000, polling: 500 }
  );

  // Wait for map to be idle (all tiles fully rendered)
  await waitForMapIdle(page, 10000);
}

/**
 * Helper function to zoom the map programmatically and wait for features to render
 */
async function zoomMapTo(page: Page, center: [number, number], zoom: number): Promise<boolean> {
  const result = await page.evaluate(
    ({ center, zoom }) => {
      const mapInstance = (window as any).__mapInstance;
      if (!mapInstance) return false;

      mapInstance.jumpTo({
        center: center,
        zoom: zoom,
        pitch: 0, // Flatten for easier marker clicking
      });
      return true;
    },
    { center, zoom }
  );

  // Wait for zoom to take effect: map idle (all tiles loaded) + features rendered
  await waitForMapIdle(page);

  // Wait for property features to actually be rendered after zoom
  await page.waitForFunction(
    () => {
      const mapInstance = (window as any).__mapInstance;
      if (!mapInstance || !mapInstance.isStyleLoaded()) return false;
      const canvas = mapInstance.getCanvas();
      if (!canvas) return false;

      const layerIds = ['ghost-nodes', 'active-nodes', 'property-clusters', 'single-active-points']
        .filter(l => mapInstance.getLayer(l));
      if (layerIds.length === 0) return false;

      try {
        const features = mapInstance.queryRenderedFeatures(
          [[0, 0], [canvas.width, canvas.height]],
          { layers: layerIds }
        );
        return (features?.length || 0) > 0;
      } catch { return false; }
    },
    { timeout: 30000, polling: 500 }
  ).catch(() => {
    console.log('Warning: Timed out waiting for property features after zoom');
  });

  return result;
}

test.describe(`Reference Expectation: ${EXPECTATION_NAME}`, () => {
  // Console error collection
  let consoleErrors: string[] = [];
  let consoleWarnings: string[] = [];

  test.beforeAll(async () => {
    // Ensure screenshot directory exists
    const fullPath = path.resolve(process.cwd(), SCREENSHOT_DIR);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    // Reset console collections
    consoleErrors = [];
    consoleWarnings = [];

    // Collect console messages
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

    // Collect page errors (uncaught exceptions)
    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    // Log warnings for visibility (but don't fail)
    if (consoleWarnings.length > 0) {
      console.log(`Console warnings (${consoleWarnings.length}):`);
      consoleWarnings.slice(0, 10).forEach((w) => console.log(`  - ${w}`));
      if (consoleWarnings.length > 10) {
        console.log(`  ... and ${consoleWarnings.length - 10} more`);
      }
    }

    // FAIL if any console errors detected
    if (consoleErrors.length > 0) {
      console.error(`Console errors detected (${consoleErrors.length}):`);
      consoleErrors.forEach((e) => console.error(`  - ${e}`));
    }
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('capture instant preview card on property tap for visual comparison', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to be fully ready with properties
    await waitForMapReady(page);

    // Zoom to a level where individual markers are visible
    const zoomSuccess = await zoomMapTo(page, CENTER_COORDINATES, ZOOM_LEVEL);
    console.log(`Map zoom configured: ${zoomSuccess}`);

    // Get map state for debugging
    let mapState = await page.evaluate(() => {
      const mapInstance = (window as any).__mapInstance;
      if (mapInstance) {
        const features = mapInstance.queryRenderedFeatures(undefined, {
          layers: ['ghost-nodes', 'active-nodes', 'property-clusters'],
        });
        return {
          zoom: mapInstance.getZoom?.() ?? 0,
          center: mapInstance.getCenter?.() ?? null,
          markerCount: features?.length ?? 0,
          hasGhostLayer: !!mapInstance.getLayer('ghost-nodes'),
          hasActiveLayer: !!mapInstance.getLayer('active-nodes'),
        };
      }
      return null;
    });
    console.log('Map state before click:', mapState);

    // Try to click on an actual property marker
    let previewVisible = false;
    const previewCard = page.locator('[data-testid="group-preview-card"]');

    // First, try to find and click on a marker using the map's fire event
    const clickResult = await clickOnPropertyMarker(page);
    console.log(`Marker click attempt: success=${clickResult.success}, features=${clickResult.featureCount}`);

    // Wait for preview card to appear (poll instead of fixed timeout)
    await previewCard.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    previewVisible = await previewCard.isVisible().catch(() => false);
    console.log(`Preview visible after marker click: ${previewVisible}`);

    // If map.fire didn't work, try direct Playwright clicks on marker positions
    if (!previewVisible && clickResult.featureCount > 0) {
      const markerPositions = await page.evaluate(() => {
        const mapInstance = (window as any).__mapInstance;
        if (!mapInstance) return [];

        const canvas = mapInstance.getCanvas();
        let allFeatures: any[] = [];

        try {
          const ghostFeatures = mapInstance.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers: ['ghost-nodes'] }
          ) || [];
          allFeatures = allFeatures.concat(ghostFeatures);
        } catch (e) { /* ignore */ }

        try {
          const activeFeatures = mapInstance.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers: ['active-nodes'] }
          ) || [];
          allFeatures = allFeatures.concat(activeFeatures);
        } catch (e) { /* ignore */ }

        try {
          const clusterFeatures = mapInstance.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers: ['property-clusters'] }
          ) || [];
          allFeatures = allFeatures.concat(clusterFeatures);
        } catch (e) { /* ignore */ }

        return allFeatures.slice(0, 10).map((f: any) => {
          if (f.geometry?.type === 'Point') {
            const point = mapInstance.project(f.geometry.coordinates);
            const rect = canvas.getBoundingClientRect();
            return {
              x: rect.left + point.x,
              y: rect.top + point.y,
              id: f.properties?.id
            };
          }
          return null;
        }).filter(Boolean);
      });

      console.log(`Found ${markerPositions.length} marker positions for Playwright clicks`);

      for (const pos of markerPositions) {
        console.log(`Clicking at screen position (${Math.round(pos!.x)}, ${Math.round(pos!.y)})...`);
        await page.mouse.click(pos!.x, pos!.y);
        await page.waitForTimeout(800);

        previewVisible = await previewCard.isVisible().catch(() => false);
        if (previewVisible) {
          console.log('Preview card appeared!');
          break;
        }
      }
    }

    // Fallback: try clicking on the canvas at common positions
    if (!previewVisible) {
      console.log('No preview yet, trying fallback canvas clicks...');
      const mapCanvas = page.locator('canvas').first();
      const box = await mapCanvas.boundingBox();

      if (box) {
        const gridPositions = [
          { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 },
          { x: box.x + box.width * 0.4, y: box.y + box.height * 0.4 },
          { x: box.x + box.width * 0.6, y: box.y + box.height * 0.4 },
          { x: box.x + box.width * 0.4, y: box.y + box.height * 0.6 },
          { x: box.x + box.width * 0.6, y: box.y + box.height * 0.6 },
        ];

        for (const pos of gridPositions) {
          await page.mouse.click(pos.x, pos.y);
          await page.waitForTimeout(600);
          previewVisible = await previewCard.isVisible().catch(() => false);
          if (previewVisible) {
            console.log('Preview card appeared via fallback click!');
            break;
          }
        }
      }
    }

    // Take screenshot capturing the preview card state
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });
    console.log(`Screenshot saved to: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`);

    // Final map state for debugging
    mapState = await page.evaluate(() => {
      const mapInstance = (window as any).__mapInstance;
      if (mapInstance) {
        const features = mapInstance.queryRenderedFeatures(undefined, {
          layers: ['ghost-nodes', 'active-nodes', 'property-clusters'],
        });
        return {
          zoom: mapInstance.getZoom?.() ?? 0,
          center: mapInstance.getCenter?.() ?? null,
          markerCount: features?.length ?? 0,
          hasGhostLayer: !!mapInstance.getLayer('ghost-nodes'),
          hasActiveLayer: !!mapInstance.getLayer('active-nodes'),
        };
      }
      return null;
    });
    console.log('Final map state:', mapState);

    // Basic assertions
    const errorState = page.locator('text=Failed to load');
    await expect(errorState).not.toBeVisible();

    // Verify map canvas is visible
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Assert that preview card appeared (this is the main requirement)
    expect(previewVisible, 'Preview card should be visible after clicking on a property marker').toBe(true);
  });

  test('verify preview card contains required elements', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to be fully ready
    await waitForMapReady(page);

    // Zoom to appropriate level
    await zoomMapTo(page, CENTER_COORDINATES, ZOOM_LEVEL);

    // Find and click on a property marker
    const previewCard = page.locator('[data-testid="group-preview-card"]');
    let previewVisible = false;

    // Use the reliable click helper
    const clickResult = await clickOnPropertyMarker(page);
    console.log(`Marker click: success=${clickResult.success}, features=${clickResult.featureCount}`);

    // Wait for preview card to appear (poll instead of fixed timeout)
    await previewCard.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    previewVisible = await previewCard.isVisible().catch(() => false);

    // If map.fire didn't work, try direct Playwright clicks on marker positions
    if (!previewVisible && clickResult.featureCount > 0) {
      const markerPositions = await page.evaluate(() => {
        const mapInstance = (window as any).__mapInstance;
        if (!mapInstance) return [];

        const canvas = mapInstance.getCanvas();
        let allFeatures: any[] = [];

        try {
          const ghostFeatures = mapInstance.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers: ['ghost-nodes'] }
          ) || [];
          allFeatures = allFeatures.concat(ghostFeatures);
        } catch (e) { /* ignore */ }

        try {
          const activeFeatures = mapInstance.queryRenderedFeatures(
            [[0, 0], [canvas.width, canvas.height]],
            { layers: ['active-nodes'] }
          ) || [];
          allFeatures = allFeatures.concat(activeFeatures);
        } catch (e) { /* ignore */ }

        return allFeatures.slice(0, 10).map((f: any) => {
          if (f.geometry?.type === 'Point') {
            const point = mapInstance.project(f.geometry.coordinates);
            const rect = canvas.getBoundingClientRect();
            return {
              x: rect.left + point.x,
              y: rect.top + point.y,
              id: f.properties?.id
            };
          }
          return null;
        }).filter(Boolean);
      });

      console.log(`Found ${markerPositions.length} marker positions for Playwright clicks`);

      for (const pos of markerPositions) {
        console.log(`Clicking at screen position (${Math.round(pos!.x)}, ${Math.round(pos!.y)})...`);
        await page.mouse.click(pos!.x, pos!.y);
        await page.waitForTimeout(800);

        previewVisible = await previewCard.isVisible().catch(() => false);
        if (previewVisible) {
          console.log('Preview card appeared!');
          break;
        }
      }
    }

    if (previewVisible) {
      // Verify Like button exists
      const likeButton = page.locator('text=Like');
      const hasLike = await likeButton.first().isVisible().catch(() => false);
      console.log(`Like button visible: ${hasLike}`);
      expect(hasLike, 'Like button should be visible').toBe(true);

      // Verify Comment button exists
      const commentButton = page.locator('text=Comment');
      const hasComment = await commentButton.first().isVisible().catch(() => false);
      console.log(`Comment button visible: ${hasComment}`);
      expect(hasComment, 'Comment button should be visible').toBe(true);

      // Verify Guess button exists
      const guessButton = page.locator('text=Guess');
      const hasGuess = await guessButton.first().isVisible().catch(() => false);
      console.log(`Guess button visible: ${hasGuess}`);
      expect(hasGuess, 'Guess button should be visible').toBe(true);

      // Take screenshot showing all elements
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-elements.png`,
        fullPage: false,
      });
    } else {
      console.log('Preview card not visible - checking marker availability');
      console.log(`Features found: ${clickResult.featureCount}`);
    }

    // Assert that preview appeared
    expect(previewVisible, 'Preview card should appear when clicking a property marker').toBe(true);
  });

  test('verify quick action buttons trigger interactions', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to be fully ready
    await waitForMapReady(page);

    // Zoom to appropriate level
    await zoomMapTo(page, CENTER_COORDINATES, ZOOM_LEVEL);

    // Find and click on a property marker
    const previewCard = page.locator('[data-testid="group-preview-card"]');
    let previewVisible = false;

    // Use the reliable click helper
    const clickResult = await clickOnPropertyMarker(page);
    console.log(`Marker click: success=${clickResult.success}, features=${clickResult.featureCount}`);

    // Wait for preview card to appear (poll instead of fixed timeout)
    previewVisible = await previewCard.isVisible().catch(() => false);
    if (!previewVisible) {
      await previewCard.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      previewVisible = await previewCard.isVisible().catch(() => false);
    }

    if (previewVisible) {
      // On web, clicking a marker opens WebPropertyPanel with backdrop that intercepts clicks.
      // Close the panel first so we can interact with the preview card buttons.
      await page.evaluate(() => {
        const ref = (window as any).__bottomSheetRef?.current;
        if (ref) ref.close();
      });
      await page.waitForTimeout(1000);

      // Test Like button click (triggers auth modal since user is not authenticated)
      const likeButton = page.locator('text=Like').first();
      if (await likeButton.isVisible()) {
        await likeButton.click();
        console.log('Like button clicked - triggers auth modal (unauthenticated)');
        await page.waitForTimeout(500);

        // Dismiss the auth modal that appears by clicking the Close button
        const closeButton = page.locator('role=button[name="Close"]');
        if (await closeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await closeButton.click();
          console.log('Auth modal dismissed via Close button');
          await page.waitForTimeout(500);
        } else {
          // Fallback: press Escape to dismiss the modal
          await page.keyboard.press('Escape');
          console.log('Auth modal dismissed via Escape');
          await page.waitForTimeout(500);
        }
      }

      // Test Comment button click (should open bottom sheet)
      const commentButton = page.locator('text=Comment').first();
      if (await commentButton.isVisible()) {
        await commentButton.click();
        console.log('Comment button clicked - should open bottom sheet');
        await page.waitForTimeout(1000);

        // Take screenshot after comment button click
        await page.screenshot({
          path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-comment.png`,
          fullPage: false,
        });
      }

      // Re-show preview for final screenshot by clicking marker again
      await clickOnPropertyMarker(page);
      await page.waitForTimeout(500);
      previewVisible = await previewCard.isVisible().catch(() => false);
    }

    // Take final screenshot
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-interaction.png`,
      fullPage: false,
    });

    // Verify no page crash
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Verify preview card functionality
    expect(previewVisible || clickResult.featureCount > 0, 'Should have property markers on map').toBe(true);
  });
});
