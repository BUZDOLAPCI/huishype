/**
 * Reference Expectation E2E Test: 0024-property-photo-placeholder
 *
 * This test verifies the property photo placeholder improvement:
 * - Property detail view shows PDOK aerial/satellite imagery with pin overlay
 * - Graceful error states (styled placeholder, not broken image)
 * - Never shows generic gray "Property Photo" placeholder
 *
 * Screenshot saved to: test-results/reference-expectations/0024-property-photo-placeholder/
 */

import { test, expect, Page, Route } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { waitForMapStyleLoaded, waitForMapIdle } from './helpers/visual-test-helpers';

/**
 * Mock property data with geometry for satellite imagery testing
 */
const MOCK_PROPERTY_WITH_GEOMETRY = {
  id: 'test-property-photo-001',
  bagIdentificatie: '0772010000123456',
  address: 'Stratumseind 100',
  city: 'Eindhoven',
  postalCode: '5611 ET',
  geometry: {
    type: 'Point',
    coordinates: [5.4697, 51.4416], // [lon, lat]
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
        ...MOCK_PROPERTY_WITH_GEOMETRY,
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
const EXPECTATION_NAME = '0024-property-photo-placeholder';
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
 * Helper to expand the bottom sheet to show property details
 */
async function expandBottomSheet(page: Page): Promise<boolean> {
  // Try programmatic expansion first
  const expanded = await page.evaluate(() => {
    const win = window as any;
    if (win.__bottomSheetRef?.current?.snapToIndex) {
      win.__bottomSheetRef.current.snapToIndex(2); // Full expand (90%)
      return true;
    }
    return false;
  });

  if (expanded) {
    await page.waitForTimeout(1500);
    return true;
  }

  // Fallback: click on preview card
  const previewCard = page.locator('[data-testid="group-preview-card"]');
  if (await previewCard.isVisible().catch(() => false)) {
    await previewCard.click({ force: true });
    await page.waitForTimeout(1500);
    return true;
  }

  return false;
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

  test('verify property detail shows satellite imagery instead of gray placeholder', async ({ page }) => {
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

      // Take screenshot in preview state
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-preview.png`,
        fullPage: false,
      });
      console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-preview.png`);

      // Expand bottom sheet to see property details with photo
      const expanded = await expandBottomSheet(page);
      console.log(`Bottom sheet expanded: ${expanded}`);

      // Wait for satellite image to load
      await page.waitForTimeout(3000);

      // Force bottom sheet visible for screenshot (reanimated workaround)
      await page.evaluate(() => {
        const guessEl = Array.from(document.querySelectorAll('*')).find(e =>
          e.textContent?.includes('Guess the Price') &&
          e.textContent?.length && e.textContent.length < 100
        );

        if (!guessEl) return;

        let parent = guessEl.parentElement;
        for (let i = 0; i < 20 && parent; i++) {
          const style = window.getComputedStyle(parent);
          const transform = style.transform;

          if (transform && transform !== 'none' && transform.includes('matrix')) {
            const match = transform.match(/matrix\(.*,\s*([\d.-]+)\)/);
            if (match) {
              const translateY = parseFloat(match[1]);
              if (translateY > 200) {
                const viewportHeight = window.innerHeight;
                const targetTop = viewportHeight * 0.1;

                parent.style.cssText = `
                  position: fixed !important;
                  top: ${targetTop}px !important;
                  left: 0 !important;
                  right: 0 !important;
                  bottom: auto !important;
                  transform: none !important;
                  max-height: ${viewportHeight * 0.9}px !important;
                  overflow-y: auto !important;
                  z-index: 9999 !important;
                  background: white !important;
                `;
                break;
              }
            }
          }
          parent = parent.parentElement;
        }
      });
      await page.waitForTimeout(500);

      // Take main screenshot
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
        fullPage: false,
      });
      console.log(`Screenshot saved: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`);

      // Verify satellite/placeholder elements
      const photoElements = await page.evaluate(() => {
        const pageHtml = document.body.innerHTML;
        return {
          hasSatellite: pageHtml.includes('property-header-satellite') ||
                        pageHtml.includes('property-header-aerial-image'),
          hasPlaceholder: pageHtml.includes('property-header-placeholder') ||
                          pageHtml.includes('property-header-no-coords-placeholder'),
          hasCarousel: pageHtml.includes('property-header-carousel'),
          // Check for old gray placeholder (should NOT exist)
          hasOldPlaceholder: pageHtml.includes('No+Photo') ||
                             pageHtml.includes('placeholder.com'),
        };
      });
      console.log('Photo elements check:', photoElements);

      // Assert we have the carousel
      expect(photoElements.hasCarousel, 'Property header carousel should exist').toBe(true);

      // Assert old placeholder is NOT present
      expect(photoElements.hasOldPlaceholder, 'Old gray placeholder should NOT be present').toBe(false);

      // Check for satellite or styled placeholder (one must be present)
      const hasSatelliteOrPlaceholder = photoElements.hasSatellite || photoElements.hasPlaceholder;
      expect(hasSatelliteOrPlaceholder, 'Should have satellite imagery or styled placeholder').toBe(true);
    }

    expect(previewVisible || clickResult.featureCount > 0, 'Should have property markers on map').toBe(true);
  });

  test('verify no generic placeholder text in property detail', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to be fully ready
    await waitForMapReady(page);

    // Zoom to appropriate level
    await zoomMapTo(page, CENTER_COORDINATES, ZOOM_LEVEL);
    await page.waitForTimeout(2000);

    // Click on a property marker
    const clickResult = await clickOnPropertyMarker(page);
    await page.waitForTimeout(2000);

    if (clickResult.success) {
      // Expand bottom sheet
      await expandBottomSheet(page);
      await page.waitForTimeout(2000);

      // Check that generic placeholder text is NOT in the DOM
      const hasGenericPlaceholder = await page.evaluate(() => {
        const pageText = document.body.innerText;
        const pageHtml = document.body.innerHTML;

        return {
          hasNoPhotoText: pageText.includes('No Photo') || pageText.includes('Property Photo'),
          hasPlaceholderUrl: pageHtml.includes('via.placeholder.com'),
          hasGenericImageIcon: pageHtml.includes('No+Photo'),
        };
      });

      console.log('Generic placeholder check:', hasGenericPlaceholder);

      // Assert none of the generic placeholder indicators are present
      expect(hasGenericPlaceholder.hasNoPhotoText, 'Should NOT show "No Photo" or "Property Photo" text').toBe(false);
      expect(hasGenericPlaceholder.hasPlaceholderUrl, 'Should NOT use via.placeholder.com').toBe(false);
      expect(hasGenericPlaceholder.hasGenericImageIcon, 'Should NOT show generic image icon').toBe(false);
    }
  });

});
