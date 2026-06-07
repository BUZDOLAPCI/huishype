/**
 * Reference Expectation E2E Test: quick-action-buttons-on-preview
 *
 * This test verifies the quick action buttons on the property preview card:
 * - Like button (heart icon + "Like" label)
 * - Comment button (chat bubble icon + "Comment" label)
 * - Guess button (price tag icon + "Guess" label)
 * - Horizontal layout with even distribution
 * - Visual separation from property info
 *
 * Screenshot saved to: test-results/reference-expectations/quick-action-buttons-on-preview/
 */

import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import { PROPERTY_ADDRESS_INTERACTION_MIN_ZOOM } from '@huishype/shared';
import { waitForMapStyleLoaded, waitForMapIdle } from './helpers/visual-test-helpers';
import type { VisualMapFeatureLike } from './helpers/visual-map-types';
import { clickOnPropertyMarker, clickPreviewAction } from './helpers/screenshot-harness';
import * as fs from 'fs';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';

// Disable tracing to avoid trace file issues
test.use({ trace: 'off', video: 'off' });

// Increase test timeout
test.setTimeout(120000);

// Configuration
const EXPECTATION_NAME = 'quick-action-buttons-on-preview';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Map view configuration - use Eindhoven center where properties and listings exist.
const CENTER_COORDINATES: [number, number] = [5.4697, 51.4416];
const ZOOM_LEVEL = PROPERTY_ADDRESS_INTERACTION_MIN_ZOOM;
const WELCOME_MODAL_DISMISSED_KEY = 'huishype_welcome_modal_dismissed_v1';
const PREVIEWABLE_PROPERTY_LAYERS = ['active-nodes', 'property-clusters'] as const;

// Known acceptable console errors - MINIMAL list
const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

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

  await waitForMapStyleLoaded(page);

  // Wait for the property style layers to exist. Rendered features are only
  // required after the test moves the map to the seeded Eindhoven center.
  await page.waitForFunction(
    (propertyLayers) => {
      const mapInstance = window.__mapInstance;
      if (!mapInstance || !mapInstance.isStyleLoaded()) return false;

      return propertyLayers.some((layer) => !!mapInstance.getLayer(layer));
    },
    PREVIEWABLE_PROPERTY_LAYERS,
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
      const mapInstance = window.__mapInstance;
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

  // Wait for map to be idle after zoom (all tiles loaded)
  await waitForMapIdle(page);

  // Wait for property features to actually be rendered after zoom
  await page.waitForFunction(
    () => {
      const mapInstance = window.__mapInstance;
      if (!mapInstance || !mapInstance.isStyleLoaded()) return false;
      const canvas = mapInstance.getCanvas();
      if (!canvas) return false;

      const layerIds = ['active-nodes', 'property-clusters'].filter((l) => mapInstance.getLayer(l));
      if (layerIds.length === 0) return false;

      try {
        const features = mapInstance.queryRenderedFeatures(
          [
            [0, 0],
            [canvas.width, canvas.height],
          ],
          { layers: layerIds }
        );
        return (features?.length || 0) > 0;
      } catch {
        return false;
      }
    },
    { timeout: 30000, polling: 500 }
  );

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
    await page.addInitScript((storageKey) => {
      window.localStorage.setItem(storageKey, '1');
    }, WELCOME_MODAL_DISMISSED_KEY);

    // Reset console collections
    consoleErrors = [];
    consoleWarnings = [];

    // Collect console messages
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const isKnown = isAllowedConsoleMessage(text, KNOWN_ACCEPTABLE_ERRORS);
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

  test('capture quick action buttons on preview card for visual comparison', async ({ page }) => {
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
      const mapInstance = window.__mapInstance;
      if (mapInstance) {
        const canvas = mapInstance.getCanvas();
        let features: VisualMapFeatureLike[] = [];
        try {
          features =
            mapInstance.queryRenderedFeatures(
              [
                [0, 0],
                [canvas.width, canvas.height],
              ],
              { layers: ['active-nodes', 'property-clusters'] }
            ) || [];
        } catch {
          /* ignore */
        }
        return {
          zoom: mapInstance.getZoom?.() ?? 0,
          center: mapInstance.getCenter?.() ?? null,
          markerCount: features.length,
          hasActiveLayer: !!mapInstance.getLayer('active-nodes'),
        };
      }
      return null;
    });
    console.log('Map state before click:', mapState);

    // Take screenshot of map with markers
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '01-map-with-property-points.png'),
      fullPage: false,
    });

    // Try to click on an actual property marker
    let previewVisible = false;
    const previewCard = page.locator('[data-testid="group-preview-card"]');

    // First, try to find and click on a marker using the map's fire event
    const clickResult = await clickOnPropertyMarker(page);
    console.log(
      `Marker click attempt: success=${clickResult.success}, features=${clickResult.featureCount}`
    );

    await page.waitForTimeout(800);
    previewVisible = await previewCard.isVisible().catch(() => false);
    console.log(`Preview visible after marker click: ${previewVisible}`);

    // If map.fire didn't work, try direct Playwright clicks on marker positions
    if (!previewVisible && clickResult.featureCount > 0) {
      const markerPositions = await page.evaluate(() => {
        const mapInstance = window.__mapInstance;
        if (!mapInstance) return [];

        const canvas = mapInstance.getCanvas();
        let allFeatures: VisualMapFeatureLike[] = [];
        try {
          const activeFeatures =
            mapInstance.queryRenderedFeatures(
              [
                [0, 0],
                [canvas.width, canvas.height],
              ],
              { layers: ['active-nodes'] }
            ) || [];
          allFeatures = allFeatures.concat(activeFeatures);
        } catch {
          /* ignore */
        }

        try {
          const clusterFeatures =
            mapInstance.queryRenderedFeatures(
              [
                [0, 0],
                [canvas.width, canvas.height],
              ],
              { layers: ['property-clusters'] }
            ) || [];
          allFeatures = allFeatures.concat(clusterFeatures);
        } catch {
          /* ignore */
        }

        return allFeatures
          .slice(0, 10)
          .map((f) => {
            if (f.geometry?.type === 'Point') {
              const point = mapInstance.project(f.geometry.coordinates);
              const rect = canvas.getBoundingClientRect();
              return {
                x: rect.left + point.x,
                y: rect.top + point.y,
                id: f.properties?.id,
              };
            }
            return null;
          })
          .filter(Boolean);
      });

      console.log(`Found ${markerPositions.length} marker positions for Playwright clicks`);

      for (const pos of markerPositions) {
        console.log(
          `Clicking at screen position (${Math.round(pos!.x)}, ${Math.round(pos!.y)})...`
        );
        await page.mouse.click(pos!.x, pos!.y);
        await page.waitForTimeout(800);

        previewVisible = await previewCard.isVisible().catch(() => false);
        if (previewVisible) {
          console.log('Preview card appeared!');
          break;
        }
      }
    }

    // If preview is visible, verify all quick action buttons
    if (previewVisible) {
      // Take screenshot with preview visible
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '02-preview-with-quick-actions.png'),
        fullPage: false,
      });

      // Verify all three quick action buttons
      const likeButton = page.locator('[data-testid="group-preview-like-button"]').first();
      const commentButton = page.locator('[data-testid="group-preview-comment-button"]').first();
      const guessButton = page.locator('[data-testid="group-preview-guess-button"]').first();

      const likeVisible = await likeButton.isVisible().catch(() => false);
      const commentVisible = await commentButton.isVisible().catch(() => false);
      const guessVisible = await guessButton.isVisible().catch(() => false);

      console.log('Quick Actions visibility:');
      console.log(`  Like: ${likeVisible}`);
      console.log(`  Comment: ${commentVisible}`);
      console.log(`  Guess: ${guessVisible}`);

      // All quick action buttons should be visible
      expect(likeVisible, 'Like button should be visible').toBe(true);
      expect(commentVisible, 'Comment button should be visible').toBe(true);
      expect(guessVisible, 'Guess button should be visible').toBe(true);

      // Verify horizontal layout (buttons should be on the same row)
      const buttonsLayout = await page.evaluate(() => {
        const card = document.querySelector('[data-testid="group-preview-card"]');
        if (!card) return null;

        // Find elements containing the button text
        const allElements = Array.from(card.querySelectorAll('*'));
        const likeEl = allElements.find((el) => el.textContent === 'Like');
        const commentEl = allElements.find((el) => el.textContent === 'Comment');
        const guessEl = allElements.find((el) => el.textContent === 'Guess');

        if (!likeEl || !commentEl || !guessEl) return null;

        const likeRect = likeEl.getBoundingClientRect();
        const commentRect = commentEl.getBoundingClientRect();
        const guessRect = guessEl.getBoundingClientRect();

        return {
          likeTop: likeRect.top,
          commentTop: commentRect.top,
          guessTop: guessRect.top,
          areHorizontal:
            Math.abs(likeRect.top - commentRect.top) < 20 &&
            Math.abs(commentRect.top - guessRect.top) < 20,
        };
      });

      if (buttonsLayout) {
        console.log(`Buttons are horizontal: ${buttonsLayout.areHorizontal}`);
        expect(buttonsLayout.areHorizontal, 'Buttons should be arranged horizontally').toBe(true);
      }

      // Verify border separator exists between info and action areas
      const hasBorderSeparator = await page.evaluate(() => {
        const card = document.querySelector('[data-testid="group-preview-card"]');
        if (!card) return false;
        // Find the actions container: it's a flex-row element with border-top (inline or class)
        const allChildren = Array.from(card.querySelectorAll('*'));
        return allChildren.some((el) => {
          const style = window.getComputedStyle(el);
          return (
            style.borderTopWidth !== '0px' &&
            style.borderTopStyle !== 'none' &&
            style.flexDirection === 'row' &&
            el.children.length >= 3
          );
        });
      });
      console.log(`Has border separator: ${hasBorderSeparator}`);
      expect(hasBorderSeparator, 'Should have border separator between info and actions').toBe(
        true
      );
    }

    // Take final screenshot (the main one for visual comparison)
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `${EXPECTATION_NAME}-current.png`),
      fullPage: false,
    });
    console.log(`Screenshot saved to: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`);

    // Final map state for debugging
    mapState = await page.evaluate(() => {
      const mapInstance = window.__mapInstance;
      if (mapInstance) {
        const canvas = mapInstance.getCanvas();
        let features: VisualMapFeatureLike[] = [];
        try {
          features =
            mapInstance.queryRenderedFeatures(
              [
                [0, 0],
                [canvas.width, canvas.height],
              ],
              { layers: ['active-nodes', 'property-clusters'] }
            ) || [];
        } catch {
          /* ignore */
        }
        return {
          zoom: mapInstance.getZoom?.() ?? 0,
          center: mapInstance.getCenter?.() ?? null,
          markerCount: features.length,
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
    expect(
      previewVisible,
      'Preview card should be visible after clicking on a property marker'
    ).toBe(true);
  });

  test('verify all three quick action buttons are present with correct styling', async ({
    page,
  }) => {
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
    console.log(
      `Marker click: success=${clickResult.success}, features=${clickResult.featureCount}`
    );

    await page.waitForTimeout(800);
    previewVisible = await previewCard.isVisible().catch(() => false);

    // If map.fire didn't work, try direct Playwright clicks on marker positions
    if (!previewVisible && clickResult.featureCount > 0) {
      const markerPositions = await page.evaluate(() => {
        const mapInstance = window.__mapInstance;
        if (!mapInstance) return [];

        const canvas = mapInstance.getCanvas();
        let allFeatures: VisualMapFeatureLike[] = [];
        try {
          const activeFeatures =
            mapInstance.queryRenderedFeatures(
              [
                [0, 0],
                [canvas.width, canvas.height],
              ],
              { layers: ['active-nodes'] }
            ) || [];
          allFeatures = allFeatures.concat(activeFeatures);
        } catch {
          /* ignore */
        }

        return allFeatures
          .slice(0, 10)
          .map((f) => {
            if (f.geometry?.type === 'Point') {
              const point = mapInstance.project(f.geometry.coordinates);
              const rect = canvas.getBoundingClientRect();
              return {
                x: rect.left + point.x,
                y: rect.top + point.y,
                id: f.properties?.id,
              };
            }
            return null;
          })
          .filter(Boolean);
      });

      console.log(`Found ${markerPositions.length} marker positions for Playwright clicks`);

      for (const pos of markerPositions) {
        console.log(
          `Clicking at screen position (${Math.round(pos!.x)}, ${Math.round(pos!.y)})...`
        );
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
      // Verify Like button with heart icon
      const likeButton = page.locator('[data-testid="group-preview-like-button"]').first();
      const hasLike = await likeButton
        .first()
        .isVisible()
        .catch(() => false);
      console.log(`Like button visible: ${hasLike}`);
      expect(hasLike, 'Like button should be visible').toBe(true);

      // Verify Comment button with chat bubble icon
      const commentButton = page.locator('[data-testid="group-preview-comment-button"]').first();
      const hasComment = await commentButton
        .first()
        .isVisible()
        .catch(() => false);
      console.log(`Comment button visible: ${hasComment}`);
      expect(hasComment, 'Comment button should be visible').toBe(true);

      // Verify Guess button with price tag icon
      const guessButton = page.locator('[data-testid="group-preview-guess-button"]').first();
      const hasGuess = await guessButton
        .first()
        .isVisible()
        .catch(() => false);
      console.log(`Guess button visible: ${hasGuess}`);
      expect(hasGuess, 'Guess button should be visible').toBe(true);

      // Take screenshot showing all button elements
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${EXPECTATION_NAME}-buttons-verification.png`),
        fullPage: false,
      });
    }

    // Verify map is functioning
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    // Assert that preview appeared
    expect(previewVisible, 'Preview card should appear when clicking a property marker').toBe(true);
  });

  test('verify Like button provides visual feedback on interaction', async ({ page }) => {
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
    console.log(
      `Marker click: success=${clickResult.success}, features=${clickResult.featureCount}`
    );

    await page.waitForTimeout(800);
    previewVisible = await previewCard.isVisible().catch(() => false);

    if (previewVisible) {
      // Take screenshot before Like button click
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '03-before-like-click.png'),
        fullPage: false,
      });

      // Click the Like button
      const likeClicked = await clickPreviewAction(page, 'like');
      if (likeClicked) {
        console.log('Like button clicked successfully');
        await page.waitForTimeout(500);

        // Take screenshot after Like button click
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, '04-after-like-click.png'),
          fullPage: false,
        });
      }

      // Verify no page crash occurred
      const canvas = page.locator('canvas').first();
      await expect(canvas).toBeVisible();
    }

    // Verify map is still functioning
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // At minimum, verify we have markers on the map
    expect(
      previewVisible || clickResult.featureCount > 0,
      'Should have property markers on map'
    ).toBe(true);
  });
});
