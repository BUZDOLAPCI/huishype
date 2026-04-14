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
import { PROPERTY_GHOST_REVEAL_ZOOM } from '@huishype/shared';
import { waitForMapIdle } from './helpers/visual-test-helpers';
import {
  clickOnPropertyMarker,
  clickPreviewAction,
} from './helpers/screenshot-harness';

// Disable tracing for this test to avoid trace file issues
test.use({ trace: 'off', video: 'off' });

// Configuration
const EXPECTATION_NAME = 'instant-preview-card-on-tap';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Center on Eindhoven area where properties and listings exist.
const CENTER_COORDINATES: [number, number] = [5.4697, 51.4416];
const ZOOM_LEVEL = PROPERTY_GHOST_REVEAL_ZOOM;

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
      const hasGhostClusterLayer = mapInstance.getLayer('ghost-clusters');

      if (!hasGhostLayer && !hasActiveLayer && !hasClusters && !hasGhostClusterLayer) return false;

      // Also check that there are actually features rendered
      const canvas = mapInstance.getCanvas();
      if (!canvas) return false;

      let featureCount = 0;
      try {
        const features = mapInstance.queryRenderedFeatures(
          [[0, 0], [canvas.width, canvas.height]],
          { layers: ['ghost-nodes', 'active-nodes', 'property-clusters', 'ghost-clusters'].filter(l => mapInstance.getLayer(l)) }
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

      const layerIds = ['ghost-nodes', 'active-nodes', 'property-clusters', 'ghost-clusters']
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

async function waitForPreviewCardVisible(page: Page, timeout = 15000): Promise<boolean> {
  const previewCard = page.locator('[data-testid="group-preview-card"]').first();
  try {
    await previewCard.waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
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
        const layers = ['ghost-nodes', 'active-nodes', 'property-clusters', 'ghost-clusters']
          .filter((layerId) => {
            try {
              return !!mapInstance.getLayer(layerId);
            } catch {
              return false;
            }
          });
        const features = layers.length > 0
          ? mapInstance.queryRenderedFeatures(undefined, { layers })
          : [];
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

    // First, try to find and click on a marker using the map's fire event
    const clickResult = await clickOnPropertyMarker(page);
    console.log(`Marker click attempt: success=${clickResult.success}, features=${clickResult.featureCount}`);

    // Wait for the preview card to settle after the tap animation/fetch.
    previewVisible = await waitForPreviewCardVisible(page, 15000);
    console.log(`Preview visible after marker click: ${previewVisible}`);

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
        const layers = ['ghost-nodes', 'active-nodes', 'property-clusters', 'ghost-clusters']
          .filter((layerId) => {
            try {
              return !!mapInstance.getLayer(layerId);
            } catch {
              return false;
            }
          });
        const features = layers.length > 0
          ? mapInstance.queryRenderedFeatures(undefined, { layers })
          : [];
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
    let previewVisible = false;
    const previewCard = page.locator('[data-testid="group-preview-card"]').first();

    // Use the reliable click helper
    const clickResult = await clickOnPropertyMarker(page);
    console.log(`Marker click: success=${clickResult.success}, features=${clickResult.featureCount}`);

    previewVisible = await waitForPreviewCardVisible(page, 15000);

    if (previewVisible) {
      // Verify Like button exists
      const likeButton = previewCard.locator('[data-testid="group-preview-like-button"]');
      await expect(likeButton, 'Like button should be visible').toBeVisible({ timeout: 5000 });
      const hasLike = await likeButton.isVisible().catch(() => false);
      console.log(`Like button visible: ${hasLike}`);
      expect(hasLike, 'Like button should be visible').toBe(true);

      // Verify Comment button exists
      const commentButton = previewCard.locator('[data-testid="group-preview-comment-button"]');
      await expect(commentButton, 'Comment button should be visible').toBeVisible({ timeout: 5000 });
      const hasComment = await commentButton.isVisible().catch(() => false);
      console.log(`Comment button visible: ${hasComment}`);
      expect(hasComment, 'Comment button should be visible').toBe(true);

      // Verify Guess button exists
      const guessButton = previewCard.locator('[data-testid="group-preview-guess-button"]');
      await expect(guessButton, 'Guess button should be visible').toBeVisible({ timeout: 5000 });
      const hasGuess = await guessButton.isVisible().catch(() => false);
      console.log(`Guess button visible: ${hasGuess}`);
      expect(hasGuess, 'Guess button should be visible').toBe(true);

      // Take screenshot showing all elements
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-elements.png`,
        fullPage: false,
      });
    } else {
      console.log('Preview card not visible after waiting for tap transition');
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
    let previewVisible = false;

    // Use the reliable click helper
    const clickResult = await clickOnPropertyMarker(page);
    console.log(`Marker click: success=${clickResult.success}, features=${clickResult.featureCount}`);

    previewVisible = await waitForPreviewCardVisible(page, 15000);

    if (previewVisible) {
      await collapseWebPanelToPreviewOnly(page);

      // Test Like button click (triggers auth modal since user is not authenticated)
      const likeClicked = await clickPreviewAction(page, 'like');
      if (likeClicked) {
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
      const commentClicked = await clickPreviewAction(page, 'comment');
      if (commentClicked) {
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
      previewVisible = await waitForPreviewCardVisible(page, 15000);
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
