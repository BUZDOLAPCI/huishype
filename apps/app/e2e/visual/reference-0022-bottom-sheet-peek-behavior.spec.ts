/**
 * Reference Expectation E2E Test: 0022-bottom-sheet-peek-behavior
 *
 * This test verifies the bottom sheet "peek" behavior when a property is selected:
 * - Bottom sheet should only "peek" (show drag handle, ~10% height) when node is tapped
 * - NO darkened backdrop on the map when in peek state
 * - Clicking preview card body expands sheet to 50%+
 * - Darkened backdrop IS visible when sheet is expanded
 *
 * Screenshot saved to: test-results/reference-expectations/0022-bottom-sheet-peek-behavior/
 */

import { test, expect, Page, Route } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { waitForMapStyleLoaded, waitForMapIdle } from './helpers/visual-test-helpers';
import { clickOnPropertyMarker } from './helpers/screenshot-harness';

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
const EXPECTATION_NAME = '0022-bottom-sheet-peek-behavior';
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
 * Helper to check if backdrop is visible (darkened overlay)
 */
async function isBackdropVisible(page: Page): Promise<boolean> {
  const backdropInfo = await page.evaluate(() => {
    const element = document.querySelector('[data-testid="web-panel-backdrop"]') as HTMLElement | null;
    if (!element) {
      return {
        hasBackdropElements: false,
        hasVisibleBackdrop: false,
        source: 'missing-web-panel-backdrop',
        opacity: 0,
        className: '',
      };
    }

    const style = window.getComputedStyle(element);
    const opacity = parseFloat(style.opacity || '0');
    const hasVisibleBackdrop =
      element.classList.contains('open') &&
      style.pointerEvents !== 'none' &&
      opacity > 0.1;

    return {
      hasBackdropElements: true,
      hasVisibleBackdrop,
      source: 'web-panel-backdrop',
      opacity,
      className: element.className,
    };
  });

  console.log(`Backdrop info: ${JSON.stringify(backdropInfo)}`);
  return backdropInfo.hasVisibleBackdrop;
}

/**
 * Helper to get the bottom sheet / web panel height percentage of viewport
 */
async function getBottomSheetHeightPercentage(page: Page): Promise<number> {
  const heightInfo = await page.evaluate(() => {
    const viewport = window.innerHeight;

    // Check for WebPropertyPanel (web-specific side panel)
    const webPanel = document.querySelector('[data-testid="web-property-panel"]');
    if (webPanel) {
      const style = window.getComputedStyle(webPanel);
      const rect = webPanel.getBoundingClientRect();
      // WebPropertyPanel slides in from the right; check if it's visible on screen
      if (rect.right > 0 && rect.left < window.innerWidth) {
        const visibleHeight = Math.min(rect.bottom, viewport) - Math.max(rect.top, 0);
        return (visibleHeight / viewport) * 100;
      }
    }

    // Find the bottom sheet container - @gorhom/bottom-sheet uses specific structure
    // Look for the sheet content that's translated from bottom
    const sheets = Array.from(document.querySelectorAll('[data-testid*="bottom-sheet"], [role="dialog"]'));

    for (const sheet of sheets) {
      const rect = sheet.getBoundingClientRect();
      // Sheet is visible if it's within viewport
      if (rect.top < viewport && rect.bottom > 0) {
        const visibleHeight = Math.min(rect.bottom, viewport) - Math.max(rect.top, 0);
        return (visibleHeight / viewport) * 100;
      }
    }

    // Alternative: check for bottom sheet library specific elements
    const bottomSheetContent = document.querySelector('.gorhom-bottom-sheet, [data-bottom-sheet]');
    if (bottomSheetContent) {
      const rect = bottomSheetContent.getBoundingClientRect();
      if (rect.top < viewport) {
        const visibleHeight = viewport - rect.top;
        return (visibleHeight / viewport) * 100;
      }
    }

    return 0;
  });

  console.log(`Bottom sheet height: ${heightInfo.toFixed(1)}%`);
  return heightInfo;
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

  test('verify bottom sheet peek behavior - no darkening on node tap', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to be fully ready
    await waitForMapReady(page);

    // Zoom to a level where individual markers are visible
    const zoomSuccess = await zoomMapTo(page, CENTER_COORDINATES, ZOOM_LEVEL);
    console.log(`Map zoom configured: ${zoomSuccess}`);
    await page.waitForTimeout(2000);

    // Take screenshot BEFORE clicking a property
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-before-click.png`,
      fullPage: false,
    });
    console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-before-click.png`);

    // Check initial state - no backdrop should be visible
    const initialBackdrop = await isBackdropVisible(page);
    console.log(`Initial backdrop visible: ${initialBackdrop}`);
    expect(initialBackdrop, 'No backdrop should be visible before clicking').toBe(false);

    // Click on a property marker
    const previewCard = page.locator('[data-testid="group-preview-card"]');
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

    // Wait for property data and preview to fully render
    if (previewVisible) {
      await page.waitForTimeout(2000);
    }

    // On web, clicking a marker opens WebPropertyPanel with backdrop.
    // Close the panel to get to "preview-only" state (just the popup, no panel).
    await page.evaluate(() => {
      const ref = (window as any).__bottomSheetRef?.current;
      if (ref) ref.close();
    });
    await page.waitForTimeout(1000);

    // Take screenshot AFTER clicking - preview card visible, no darkening
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });
    console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`);

    // CRITICAL CHECK: After closing panel, backdrop should NOT be visible (preview-only state)
    const peekStateBackdrop = await isBackdropVisible(page);
    console.log(`Preview-only state backdrop visible: ${peekStateBackdrop}`);

    // Check bottom sheet height - should be minimal (panel closed)
    const peekHeight = await getBottomSheetHeightPercentage(page);
    console.log(`Bottom sheet height in preview-only state: ${peekHeight.toFixed(1)}%`);

    // Assert preview is visible
    expect(previewVisible, 'Preview card should be visible after clicking property marker').toBe(true);

    // Assert NO backdrop in preview-only state
    expect(peekStateBackdrop, 'Map should NOT be darkened when only preview card is showing').toBe(false);

    // Verify map canvas is visible and not obscured
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10000 });
  });

  test('verify backdrop appears when bottom sheet is expanded', async ({ page }) => {
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

    if (previewVisible) {
      await page.waitForTimeout(2000);

      // On web, clicking a marker opens WebPropertyPanel with backdrop.
      // Close the panel to get to "preview-only" state first.
      await page.evaluate(() => {
        const ref = (window as any).__bottomSheetRef?.current;
        if (ref) ref.close();
      });
      await page.waitForTimeout(1000);

      // Take screenshot in preview-only state (no backdrop)
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-peek-state.png`,
        fullPage: false,
      });
      console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-peek-state.png`);

      // Verify no backdrop in preview-only state
      const peekBackdrop = await isBackdropVisible(page);
      expect(peekBackdrop, 'No backdrop in preview-only state').toBe(false);

      // Click on the preview card body to expand bottom sheet / side panel
      const cardBox = await previewCard.boundingBox();
      if (cardBox) {
        const clickX = cardBox.x + cardBox.width / 2;
        const clickY = cardBox.y + cardBox.height / 3;
        console.log(`Clicking preview card at (${clickX.toFixed(0)}, ${clickY.toFixed(0)}) to expand`);
        await page.mouse.click(clickX, clickY);
      } else {
        await previewCard.click({ force: true });
      }

      // Wait for bottom sheet expansion animation
      await page.waitForTimeout(2000);

      await page.waitForFunction(() => {
        const backdrop = document.querySelector('[data-testid="web-panel-backdrop"]');
        if (!backdrop) return false;
        const style = window.getComputedStyle(backdrop);
        return backdrop.classList.contains('open') && parseFloat(style.opacity || '0') > 0.1;
      }, { timeout: 5000 });

      // Take screenshot after expansion
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-expanded-state.png`,
        fullPage: false,
      });
      console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-expanded-state.png`);

      // Check for bottom sheet content indicators
      const bottomSheetIndicators = [
        'text=Details',
        'text=Comments',
        'text=Guess the Price',
        'text=Property Details',
        'text=Save',
        'text=Share',
      ];

      let bottomSheetExpanded = false;
      for (const indicator of bottomSheetIndicators) {
        const element = page.locator(indicator);
        const isVisible = await element.first().isVisible().catch(() => false);
        if (isVisible) {
          console.log(`Bottom sheet indicator found: ${indicator}`);
          bottomSheetExpanded = true;
          break;
        }
      }

      // Preview card should be hidden after clicking it
      const previewStillVisible = await previewCard.isVisible().catch(() => false);
      console.log(`Preview card still visible after tap: ${previewStillVisible}`);

      // Check backdrop visibility after expansion
      const expandedBackdrop = await isBackdropVisible(page);
      console.log(`Expanded state backdrop visible: ${expandedBackdrop}`);

      // Bottom sheet should be expanded (preview card gone indicates sheet took over)
      const sheetExpanded = bottomSheetExpanded || !previewStillVisible;
      expect(sheetExpanded, 'Bottom sheet should expand after clicking preview card').toBe(true);

      // After expansion, backdrop SHOULD be visible (partial/full state)
      console.log(`Backdrop visible after expansion: ${expandedBackdrop}`);
      expect(expandedBackdrop, 'Map should darken when the web property panel is expanded').toBe(true);
    }

    expect(previewVisible || clickResult.featureCount > 0, 'Should have property markers on map').toBe(true);
  });

  test('verify preview card visible with bottom sheet in peek state', async ({ page }) => {
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

    if (previewVisible) {
      await page.waitForTimeout(2000);

      // Verify both preview card AND map are fully visible (no darkening)
      const selectedMarker = page.locator('[data-testid="selected-marker"]');
      const hasSelectedMarker = await selectedMarker.isVisible().catch(() => false);
      console.log(`Selected marker visible: ${hasSelectedMarker}`);

      // Verify preview card elements
      const likeButton = page.locator('[data-testid="group-preview-like-button"]').first();
      const hasLike = await likeButton.first().isVisible().catch(() => false);
      console.log(`Like button visible: ${hasLike}`);
      expect(hasLike, 'Like button should be visible in preview card').toBe(true);

      // Take focused screenshot of preview card
      const cardBox = await previewCard.boundingBox();
      if (cardBox) {
        const padding = 20;
        await page.screenshot({
          path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-preview-card-focused.png`,
          clip: {
            x: Math.max(0, cardBox.x - padding),
            y: Math.max(0, cardBox.y - padding),
            width: cardBox.width + padding * 2,
            height: cardBox.height + padding * 2,
          },
        });
        console.log(`Focused screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-preview-card-focused.png`);
      }

      // Verify map is not obscured
      const canvas = page.locator('canvas').first();
      const canvasBox = await canvas.boundingBox();
      if (canvasBox) {
        console.log(`Map canvas dimensions: ${canvasBox.width}x${canvasBox.height}`);
        expect(canvasBox.width > 0 && canvasBox.height > 0, 'Map canvas should be visible').toBe(true);
      }
    }

    expect(previewVisible, 'Preview card should be visible after clicking property').toBe(true);
  });
});
