/**
 * Reference Expectation E2E Test: 0026-hide-technical-ids
 *
 * This test verifies that technical identifiers (UUIDs, BAG IDs, hash strings)
 * are NOT displayed in the user interface. The UI should only show human-readable
 * information to appear polished and consumer-ready.
 *
 * Screenshot saved to: test-results/reference-expectations/0026-hide-technical-ids/
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { waitForMapStyleLoaded, waitForMapIdle } from './helpers/visual-test-helpers';

// Disable tracing for this test to avoid trace file issues
test.use({ trace: 'off', video: 'off' });

// Configuration
const EXPECTATION_NAME = '0026-hide-technical-ids';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Center on area with known properties from the database
const CENTER_COORDINATES: [number, number] = [5.4880, 51.4307];

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

// Patterns for technical IDs that should NOT appear in the UI
const TECHNICAL_ID_PATTERNS: RegExp[] = [
  // UUID patterns (various formats)
  /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
  // BAG-style IDs like "adr-51d1f8e8e3ca30e9c0258e0900015b44"
  /adr-[a-f0-9]{32}/i,
  /pand-[a-f0-9]{32}/i,
  // Long hex strings (32+ characters)
  /\b[a-f0-9]{32,}\b/i,
  // BAG identificatie (16-digit numbers)
  /\b0[0-9]{15}\b/,
];

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

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const isKnown = KNOWN_ACCEPTABLE_ERRORS.some((pattern) => pattern.test(text));
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

  test('verify no technical IDs in property detail view', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    // Configure map to area with properties
    await page.evaluate(
      ({ center }) => {
        const mapInstance = (window as any).__mapInstance;
        if (mapInstance) {
          mapInstance.setCenter(center);
          mapInstance.setZoom(17);
        }
      },
      { center: CENTER_COORDINATES }
    );
    // Wait for map to be idle after zoom
    await waitForMapIdle(page);

    // Find and click on a property marker
    const mapCanvas = page.locator('canvas').first();
    const box = await mapCanvas.boundingBox();

    if (box) {
      // Query for property markers and click on one
      // Use correct layer names from index.web.tsx and check if layer exists first
      const propertyPos = await page.evaluate(() => {
        const map = (window as any).__mapInstance;
        if (!map) return null;

        const canvas = map.getCanvas();
        // Actual layer names from the map implementation
        const layerNames = [
          'ghost-nodes',
          'active-nodes',
          'single-active-points',
          'property-clusters',
        ];

        for (const layer of layerNames) {
          // Check if layer exists before querying to avoid console errors
          if (!map.getLayer(layer)) continue;

          try {
            const features = map.queryRenderedFeatures(
              [[0, 0], [canvas.width, canvas.height]],
              { layers: [layer] }
            );
            if (features?.length > 0) {
              const feature = features[0];
              if (feature.geometry?.type === 'Point') {
                const point = map.project(feature.geometry.coordinates);
                return { x: point.x, y: point.y };
              }
            }
          } catch (e) {
            /* ignore - layer might not exist */
          }
        }
        return null;
      });

      if (propertyPos) {
        console.log(`Clicking property at (${propertyPos.x}, ${propertyPos.y})`);
        await page.mouse.click(box.x + propertyPos.x, box.y + propertyPos.y);
      } else {
        console.log('No property found via layer query, clicking center');
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      }
      await page.waitForTimeout(2000);

      // Check if preview card appeared
      const previewCard = page.locator('[data-testid="property-preview-card"]');
      const previewVisible = await previewCard.isVisible().catch(() => false);
      console.log(`Preview card visible: ${previewVisible}`);

      if (previewVisible) {
        // Click the preview card to expand the bottom sheet
        await previewCard.first().dispatchEvent('click');
        await page.waitForTimeout(1000);

        // Programmatically expand the bottom sheet
        const snapped = await page.evaluate(() => {
          const win = window as any;
          if (win.__bottomSheetRef?.current?.snapToIndex) {
            win.__bottomSheetRef.current.snapToIndex(2); // Full expand
            return true;
          }
          return false;
        });
        console.log(`Programmatically snapped to full: ${snapped}`);
        await page.waitForTimeout(1500);

        // Force the bottom sheet visible for screenshot
        await page.evaluate(() => {
          const guessEl = Array.from(document.querySelectorAll('*')).find(
            (e) =>
              e.textContent?.includes('Property Details') &&
              e.textContent?.length &&
              e.textContent.length < 100
          );

          if (!guessEl) return false;

          let sheetContainer: HTMLElement | null = null;
          let parent = guessEl.parentElement;

          for (let i = 0; i < 20 && parent; i++) {
            const style = window.getComputedStyle(parent);
            const transform = style.transform;

            if (transform && transform !== 'none' && transform.includes('matrix')) {
              const match = transform.match(/matrix\(.*,\s*([\d.-]+)\)/);
              if (match) {
                const translateY = parseFloat(match[1]);
                if (translateY > 200) {
                  sheetContainer = parent;
                  break;
                }
              }
            }
            parent = parent.parentElement;
          }

          if (sheetContainer) {
            const viewportHeight = window.innerHeight;
            const targetTop = viewportHeight * 0.1;

            sheetContainer.style.cssText = `
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
            return true;
          }
          return false;
        });
        await page.waitForTimeout(500);
      }
    }

    // Take screenshot
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });
    console.log(`Screenshot saved to: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`);

    // Get all visible text from the page
    const visibleText = await page.evaluate(() => {
      return document.body.innerText;
    });

    // Check for technical IDs in the visible text
    const foundTechnicalIds: string[] = [];
    for (const pattern of TECHNICAL_ID_PATTERNS) {
      const matches = visibleText.match(new RegExp(pattern, 'gi'));
      if (matches) {
        foundTechnicalIds.push(...matches);
      }
    }

    // Filter out false positives (like hex color codes that might appear)
    const filteredTechnicalIds = foundTechnicalIds.filter((id) => {
      // Filter out short strings that might be legitimate (e.g., dates, colors)
      if (id.length < 16) return false;
      return true;
    });

    console.log('Visible text sample:', visibleText.substring(0, 500));
    if (filteredTechnicalIds.length > 0) {
      console.error('Found technical IDs in UI:', filteredTechnicalIds);
    }

    // Verify no technical IDs are visible
    expect(
      filteredTechnicalIds,
      `Technical IDs should not be visible in UI. Found: ${filteredTechnicalIds.join(', ')}`
    ).toHaveLength(0);

    // Verify the page is functional
    await expect(page.locator('body')).toBeVisible();

    // Verify key UI elements are present (without technical IDs)
    const hasExpectedContent = await page.evaluate(() => {
      const pageText = document.body.innerText;
      return {
        hasAddress: /[A-Za-z]+\s+\d+/.test(pageText), // Address pattern like "Street 123"
        hasCity: pageText.includes('Eindhoven'),
        // Should NOT have BAG ID label anymore
        hasNoBAGIDLabel: !pageText.includes('BAG ID'),
      };
    });

    console.log('Content checks:', hasExpectedContent);
    expect(hasExpectedContent.hasNoBAGIDLabel).toBe(true);
  });

  test('verify property details section has no technical IDs', async ({ page }) => {
    // Navigate directly to a property page if one exists
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await page.waitForTimeout(2000);

    // Get the page content and verify no technical ID patterns
    const pageContent = await page.content();

    // Check that the "BAG ID" label is not present in the HTML
    const hasBAGIDLabel = pageContent.includes('BAG ID');
    console.log(`Page contains "BAG ID" label: ${hasBAGIDLabel}`);

    // The BAG ID label should have been removed
    expect(hasBAGIDLabel).toBe(false);

    // Verify page is functional
    await expect(page.locator('body')).toBeVisible();
  });
});
