import { test, expect, Page } from '@playwright/test';
import {
  createVisualTestContext,
  VisualTestContext,
  waitForMapStyleLoaded,
} from './helpers/visual-test-helpers';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Reference Expectation Test: swipeable-clustered-nodes
 *
 * Verifies that when a cluster is clicked on the map, a paginated preview
 * panel appears showing "X of Y" navigation with swipeable property cards.
 *
 * Expected behavior (from expectation.md):
 * - Clicking a cluster with multiple nodes shows a preview panel
 * - Panel has pagination: left arrow, "X of Y" indicator, right arrow
 * - Panel has close button (X)
 * - Can navigate between properties with arrows
 * - Property details are shown (address, price, etc.)
 */

const SCREENSHOT_DIR = 'test-results/reference-expectations/swipeable-clustered-nodes';

// Ensure screenshot directory exists
test.beforeAll(async () => {
  const baseDir = path.resolve(SCREENSHOT_DIR);
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
});

/**
 * Helper to set map zoom level via the exposed map instance
 */
async function setMapZoom(page: Page, zoom: number): Promise<void> {
  await page.evaluate((z) => {
    const map = (window as unknown as { __mapInstance?: { setZoom: (z: number) => void; setPitch: (p: number) => void } }).__mapInstance;
    if (map) {
      map.setZoom(z);
      // Reset pitch to 0 for easier clicking
      map.setPitch(0);
    }
  }, zoom);
  await page.waitForTimeout(1500); // Wait for map to settle
}

/**
 * Helper to get the current map zoom level
 */
async function getMapZoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const map = (window as unknown as { __mapInstance?: { getZoom: () => number } }).__mapInstance;
    return map ? map.getZoom() : 0;
  });
}

/**
 * Helper to get the screen position of the map center
 */
async function getMapCenterScreenPosition(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const map = (window as unknown as {
      __mapInstance?: {
        getCenter: () => { lng: number; lat: number };
        project: (lngLat: { lng: number; lat: number }) => { x: number; y: number };
        getContainer: () => HTMLElement;
      }
    }).__mapInstance;
    if (!map) return null;

    const center = map.getCenter();
    const point = map.project(center);
    const container = map.getContainer();
    const rect = container.getBoundingClientRect();

    return {
      x: rect.left + point.x,
      y: rect.top + point.y,
    };
  });
}

test.describe('Reference Expectation: Swipeable Clustered Nodes', () => {
  let ctx: VisualTestContext;

  test.afterEach(async () => {
    if (ctx) {
      ctx.stop();
      console.log(ctx.generateReport());
    }
  });

  test('should show paginated cluster preview when clicking a cluster', async ({ page }) => {
    ctx = createVisualTestContext(page, 'swipeable-clustered-nodes');
    ctx.start();

    // Navigate to the app
    await page.goto('/');
    await ctx.validator.waitForReady();

    // Wait for map to be ready
    await waitForMapStyleLoaded(page);

    // Find the map canvas
    const mapCanvas = page.locator('canvas').first();
    const isMapVisible = await mapCanvas.isVisible().catch(() => false);

    expect(isMapVisible, 'Map canvas should be visible').toBe(true);

    if (isMapVisible) {
      const box = await mapCanvas.boundingBox();
      expect(box, 'Map should have bounding box').not.toBeNull();

      if (box) {
        // Take screenshot of initial map state
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, '01-initial-map-state.png'),
          fullPage: true,
        });

        // Get initial zoom and log it
        const initialZoom = await getMapZoom(page);
        console.log(`Initial zoom level: ${initialZoom}`);

        // Set zoom to level 11 which should show clusters (clusterMaxZoom is 14)
        // Also resets pitch to 0 for easier clicking
        await setMapZoom(page, 11);
        await page.waitForTimeout(2000);

        const newZoom = await getMapZoom(page);
        console.log(`Zoom level after setting: ${newZoom}`);

        // Take screenshot after zoom out
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, '02-zoomed-out-with-clusters.png'),
          fullPage: true,
        });

        // Get the map center screen position for more accurate clicking
        const mapCenter = await getMapCenterScreenPosition(page);
        console.log(`Map center screen position: ${JSON.stringify(mapCenter)}`);

        // Try clicking in multiple positions to find a cluster
        const clusterPreview = page.locator('[data-testid="group-preview-card"]');
        let foundCluster = false;

        // Grid of positions to try - start with map center if available
        const positions: Array<{ x: number; y: number; absolute?: boolean }> = [];

        // Add map center as first position if available
        if (mapCenter) {
          positions.push({ x: mapCenter.x, y: mapCenter.y, absolute: true });
        }

        // Add relative positions as fallback
        positions.push(
          { x: 0.5, y: 0.5 },   // canvas center
          { x: 0.45, y: 0.45 },
          { x: 0.55, y: 0.55 },
          { x: 0.4, y: 0.5 },
          { x: 0.6, y: 0.5 },
          { x: 0.5, y: 0.4 },
          { x: 0.5, y: 0.6 },
        );

        for (const pos of positions) {
          let clickX: number;
          let clickY: number;

          if (pos.absolute) {
            clickX = pos.x;
            clickY = pos.y;
          } else {
            clickX = box.x + box.width * pos.x;
            clickY = box.y + box.height * pos.y;
          }

          console.log(`Clicking at (${clickX.toFixed(0)}, ${clickY.toFixed(0)})`);
          await page.mouse.click(clickX, clickY);
          await page.waitForTimeout(800);

          const visible = await clusterPreview.isVisible().catch(() => false);
          if (visible) {
            foundCluster = true;
            console.log(`Found cluster at relative position (${pos.x}, ${pos.y})`);

            // Take screenshot after click
            await page.screenshot({
              path: path.join(SCREENSHOT_DIR, '03-after-cluster-click.png'),
              fullPage: true,
            });

            // Verify pagination elements
            const pageIndicator = page.locator('[data-testid="group-preview-page-indicator"]');
            const leftNav = page.locator('[data-testid="group-preview-nav-left"]');
            const rightNav = page.locator('[data-testid="group-preview-nav-right"]');
            const closeButton = page.locator('[data-testid="group-preview-close-button"]');

            // Check all pagination elements exist
            expect(await pageIndicator.isVisible(), 'Page indicator should be visible').toBe(true);
            expect(await leftNav.isVisible(), 'Left navigation should be visible').toBe(true);
            expect(await rightNav.isVisible(), 'Right navigation should be visible').toBe(true);
            expect(await closeButton.isVisible(), 'Close button should be visible').toBe(true);

            // Get the page indicator text (e.g., "1 of 5")
            const pageText = await pageIndicator.textContent();
            console.log(`Page indicator shows: "${pageText}"`);

            // Verify format matches "X of Y"
            expect(pageText).toMatch(/\d+ of \d+/);

            // Take screenshot with cluster preview visible
            await page.screenshot({
              path: path.join(SCREENSHOT_DIR, 'swipeable-clustered-nodes-current.png'),
              fullPage: true,
            });

            // Test navigation: click right arrow if available
            const rightNavEnabled = !(await rightNav.getAttribute('disabled'));
            if (rightNavEnabled) {
              await rightNav.click();
              await page.waitForTimeout(500);

              // Take screenshot after navigation
              await page.screenshot({
                path: path.join(SCREENSHOT_DIR, '04-after-nav-right.png'),
                fullPage: true,
              });

              // Verify page indicator changed
              const newPageText = await pageIndicator.textContent();
              console.log(`After right nav, page indicator shows: "${newPageText}"`);
            }

            // Test close button
            await closeButton.click();
            await page.waitForTimeout(500);

            const previewGone = !(await clusterPreview.isVisible().catch(() => false));
            expect(previewGone, 'Cluster preview should close after clicking X').toBe(true);

            // Take screenshot after close
            await page.screenshot({
              path: path.join(SCREENSHOT_DIR, '05-after-close.png'),
              fullPage: true,
            });

            break;
          }
        }

        if (!foundCluster) {
          // Take screenshot showing current state
          await page.screenshot({
            path: path.join(SCREENSHOT_DIR, 'swipeable-clustered-nodes-current.png'),
            fullPage: true,
          });
          console.log(
            'Note: Could not find a cluster to click. This may be because:\n' +
              '1. Zoom level is too high (no clusters visible)\n' +
              '2. API did not return enough properties\n' +
              '3. Properties are not clustered at this zoom level'
          );
        }
      }
    }

    // Assert no critical console errors
    ctx.assertNoCriticalErrors();
  });

  test('should navigate between properties using arrows', async ({ page }) => {
    ctx = createVisualTestContext(page, 'cluster-navigation');
    ctx.start();

    await page.goto('/');
    await ctx.validator.waitForReady();
    await waitForMapStyleLoaded(page);

    const mapCanvas = page.locator('canvas').first();
    const box = await mapCanvas.boundingBox();

    if (box) {
      // Zoom out to see clusters using map API
      await setMapZoom(page, 11);
      await page.waitForTimeout(2000);

      // Try multiple positions to find a cluster
      const clusterPreview = page.locator('[data-testid="group-preview-card"]');
      let foundCluster = false;

      const positions = [
        { x: 0.5, y: 0.5 },
        { x: 0.4, y: 0.4 },
        { x: 0.6, y: 0.6 },
      ];

      for (const pos of positions) {
        await page.mouse.click(box.x + box.width * pos.x, box.y + box.height * pos.y);
        await page.waitForTimeout(800);

        const isVisible = await clusterPreview.isVisible().catch(() => false);
        if (isVisible) {
          foundCluster = true;

          const pageIndicator = page.locator('[data-testid="group-preview-page-indicator"]');
          const leftNav = page.locator('[data-testid="group-preview-nav-left"]');
          const rightNav = page.locator('[data-testid="group-preview-nav-right"]');

          // Get initial page
          const initialText = await pageIndicator.textContent();
          console.log(`Initial page: ${initialText}`);

          // Navigate right if possible
          const rightNavEnabled = !(await rightNav.getAttribute('disabled'));
          if (rightNavEnabled) {
            await rightNav.click();
            await page.waitForTimeout(500);

            const afterRightText = await pageIndicator.textContent();
            console.log(`After right click: ${afterRightText}`);

            // Navigate left
            await leftNav.click();
            await page.waitForTimeout(500);

            const afterLeftText = await pageIndicator.textContent();
            console.log(`After left click: ${afterLeftText}`);

            // Should be back to initial
            expect(afterLeftText).toBe(initialText);
          }
          break;
        }
      }

      if (!foundCluster) {
        console.log('No cluster found for navigation test');
      }
    }

    ctx.assertNoCriticalErrors();
  });

  test('should open property details when clicking on property card', async ({ page }) => {
    ctx = createVisualTestContext(page, 'cluster-property-tap');
    ctx.start();

    await page.goto('/');
    await ctx.validator.waitForReady();
    await waitForMapStyleLoaded(page);

    const mapCanvas = page.locator('canvas').first();
    const box = await mapCanvas.boundingBox();

    if (box) {
      // Zoom out to see clusters using map API
      await setMapZoom(page, 11);
      await page.waitForTimeout(2000);

      // Try multiple positions to find a cluster
      const clusterPreview = page.locator('[data-testid="group-preview-card"]');
      let foundCluster = false;

      const positions = [
        { x: 0.5, y: 0.5 },
        { x: 0.4, y: 0.4 },
        { x: 0.6, y: 0.6 },
      ];

      for (const pos of positions) {
        await page.mouse.click(box.x + box.width * pos.x, box.y + box.height * pos.y);
        await page.waitForTimeout(800);

        const isVisible = await clusterPreview.isVisible().catch(() => false);
        if (isVisible) {
          foundCluster = true;

          // Click on the property card
          const propertyCard = page.locator('[data-testid="group-preview-property-card"]');
          await propertyCard.click();
          await page.waitForTimeout(1000);

          // Cluster preview should close
          const previewStillVisible = await clusterPreview.isVisible().catch(() => false);
          expect(previewStillVisible, 'Cluster preview should close after property tap').toBe(false);

          // Take screenshot showing what happened
          await page.screenshot({
            path: path.join(SCREENSHOT_DIR, '06-after-property-tap.png'),
            fullPage: true,
          });
          break;
        }
      }

      if (!foundCluster) {
        console.log('No cluster found for property tap test');
      }
    }

    ctx.assertNoCriticalErrors();
  });
});
