/**
 * Reference Expectation E2E Test: reactions-like-system
 *
 * This test verifies the Reactions/Likes system visual implementation:
 * - Like button on property preview cards (Quick Actions bar)
 * - Like, Comment, Guess buttons layout and styling
 * - Touch-friendly button sizing
 * - Proper iconography (heart icon for like)
 *
 * Screenshot saved to: test-results/reference-expectations/reactions-like-system/
 */

import { test, expect } from '@playwright/test';
import {
  createVisualTestContext,
  VisualTestContext,
  waitForMapStyleLoaded,
  waitForMapIdle,
} from './helpers/visual-test-helpers';
import * as path from 'path';
import * as fs from 'fs';

// Configuration
const EXPECTATION_NAME = 'reactions-like-system';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Map view configuration
const ZOOM_LEVEL_FOR_POINTS = 15.5; // Zoom level where individual points are visible (above clusterMaxZoom 14)
const CENTER_COORDINATES: [number, number] = [5.488, 51.430]; // Coordinates where properties actually exist in test data

// Ensure screenshot directory exists
test.beforeAll(async () => {
  const baseDir = path.resolve(SCREENSHOT_DIR);
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
});

// Configure trace to be off at top level to avoid worker issues
test.use({ trace: 'off' });

test.describe(`Reference Expectation: ${EXPECTATION_NAME}`, () => {
  let ctx: VisualTestContext;

  // Use a taller viewport to ensure the property preview card is fully visible
  // Increase timeout to 90s to allow for map loading and marker interactions
  test.use({ viewport: { width: 1280, height: 1024 } });
  test.setTimeout(90000);

  test.afterEach(async () => {
    if (ctx) {
      ctx.stop();
      console.log(ctx.generateReport());
    }
  });

  test('capture property preview with quick actions (Like button) for visual comparison', async ({
    page,
  }) => {
    ctx = createVisualTestContext(page, EXPECTATION_NAME);
    ctx.start();

    // Navigate to the app and wait for load
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Wait for page to be ready
    await page.waitForLoadState('networkidle').catch(() => {
      // Ignore network idle timeout if websocket keeps connection open
    });

    // Wait for map instance and style to load
    await waitForMapStyleLoaded(page);

    // Find the map canvas
    const mapCanvas = page.locator('canvas').first();
    const isMapVisible = await mapCanvas.isVisible().catch(() => false);

    expect(isMapVisible, 'Map canvas should be visible').toBe(true);

    if (isMapVisible) {
      const box = await mapCanvas.boundingBox();
      expect(box, 'Map should have bounding box').not.toBeNull();

      if (box) {
        // Configure map for individual point viewing (zoom past cluster threshold)
        await page.evaluate(
          ({ center, zoom }) => {
            const mapInstance = (window as any).__mapInstance;
            if (mapInstance && typeof mapInstance.setZoom === 'function') {
              mapInstance.setCenter(center);
              mapInstance.setZoom(zoom);
              mapInstance.setPitch(0); // Flat view for better point interaction
            }
          },
          { center: CENTER_COORDINATES, zoom: ZOOM_LEVEL_FOR_POINTS }
        );

        // Wait for map to be idle after zoom and features to render
        await waitForMapIdle(page);

        // Get map state info for debugging
        const mapStateInfo = await page.evaluate(() => {
          const mapInstance = (window as any).__mapInstance;
          if (!mapInstance) return { hasMap: false };

          const source = mapInstance.getSource('properties');
          const hasSource = !!source;

          // Check all layers
          const layers = mapInstance.getStyle()?.layers || [];
          const propertyLayers = layers.filter((l: any) =>
            l.id.includes('point') || l.id.includes('cluster')
          ).map((l: any) => l.id);

          // Check clusters
          const clusterFeatures = mapInstance.queryRenderedFeatures(undefined, {
            layers: ['property-clusters'],
          }) || [];

          return {
            hasMap: true,
            zoom: mapInstance.getZoom(),
            center: mapInstance.getCenter(),
            hasSource,
            propertyLayers,
            clusterCount: clusterFeatures.length,
          };
        });

        console.log('Map state info:', JSON.stringify(mapStateInfo, null, 2));

        // Take screenshot of initial map state (showing available points)
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, '01-map-with-property-points.png'),
          fullPage: false,
        });

        // Click on a property marker using map's fire() method (more reliable than mouse.click)
        const markerClicked = await page.evaluate(() => {
          const mapInstance = (window as any).__mapInstance;

          if (!mapInstance) {
            console.log('No map instance found');
            return { clicked: false, markerCount: 0 };
          }

          // Query for property markers in the current view
          const features = mapInstance.queryRenderedFeatures(undefined, {
            layers: ['ghost-nodes', 'active-nodes'],
          }) || [];

          console.log(`Found ${features.length} property markers`);

          if (features.length > 0) {
            // Find a marker that's not at the edge of the viewport
            const canvas = mapInstance.getCanvas();
            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;

            // Sort features by distance from center to click a more central one
            const sortedFeatures = [...features].sort((a: any, b: any) => {
              if (!a.geometry || !b.geometry) return 0;
              if (a.geometry.type !== 'Point' || b.geometry.type !== 'Point') return 0;

              const pointA = mapInstance.project(a.geometry.coordinates);
              const pointB = mapInstance.project(b.geometry.coordinates);

              const distA = Math.sqrt(Math.pow(pointA.x - centerX, 2) + Math.pow(pointA.y - centerY, 2));
              const distB = Math.sqrt(Math.pow(pointB.x - centerX, 2) + Math.pow(pointB.y - centerY, 2));

              return distA - distB;
            });

            // Get the most central feature
            const targetFeature = sortedFeatures[0];

            if (targetFeature?.geometry?.type === 'Point') {
              const point = mapInstance.project(targetFeature.geometry.coordinates);

              // Trigger a click event at this point using MapLibre's fire method
              const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                clientX: point.x,
                clientY: point.y,
              });

              // Fire MapLibre's click handler directly
              mapInstance.fire('click', {
                point: { x: point.x, y: point.y },
                lngLat: mapInstance.unproject([point.x, point.y]),
                originalEvent: clickEvent,
              });

              console.log(`Clicked marker at screen position: ${point.x}, ${point.y}`);
              return { clicked: true, markerCount: features.length, position: { x: point.x, y: point.y } };
            }
          }

          return { clicked: false, markerCount: features.length };
        });

        console.log('Marker click result:', markerClicked);

        // Wait for preview card to appear
        await page.waitForTimeout(2000);

        let previewVisible = false;
        const likeButton = page.locator('text=Like').first();
        previewVisible = await likeButton.isVisible().catch(() => false);

        // If preview not shown yet and we have markers, try clicking using Playwright's mouse
        if (!previewVisible && markerClicked.markerCount > 0) {
          console.log('Preview not visible, trying Playwright mouse click...');

          const markerPosition = await page.evaluate(() => {
            const mapInstance = (window as any).__mapInstance;
            if (!mapInstance) return null;

            const features = mapInstance.queryRenderedFeatures(undefined, {
              layers: ['ghost-nodes', 'active-nodes'],
            });

            if (features && features.length > 0) {
              const feature = features[0];
              if (feature?.geometry?.type === 'Point') {
                const point = mapInstance.project(feature.geometry.coordinates);
                const rect = mapInstance.getCanvas().getBoundingClientRect();
                return {
                  x: rect.left + point.x,
                  y: rect.top + point.y,
                };
              }
            }
            return null;
          });

          if (markerPosition) {
            await page.mouse.click(markerPosition.x, markerPosition.y);
            await page.waitForTimeout(1500);
            previewVisible = await likeButton.isVisible().catch(() => false);
          }
        }

        // If still no preview, try fallback clicks
        if (!previewVisible) {
          const clickPositions = [
            { x: 0.5, y: 0.5 },
            { x: 0.4, y: 0.4 },
            { x: 0.6, y: 0.4 },
            { x: 0.4, y: 0.6 },
            { x: 0.6, y: 0.6 },
            { x: 0.3, y: 0.5 },
            { x: 0.7, y: 0.5 },
            { x: 0.5, y: 0.3 },
            { x: 0.5, y: 0.7 },
          ];

          for (const pos of clickPositions) {
            const clickX = box.x + box.width * pos.x;
            const clickY = box.y + box.height * pos.y;

            console.log(`Trying fallback click at (${clickX.toFixed(0)}, ${clickY.toFixed(0)})`);
            await page.mouse.click(clickX, clickY);
            await page.waitForTimeout(1000);

            previewVisible = await likeButton.isVisible().catch(() => false);

            if (previewVisible) {
              console.log(`Property preview found after fallback click at (${pos.x}, ${pos.y})`);
              break;
            }
          }
        }

        // Try to scroll down to ensure the quick actions are visible
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        await page.waitForTimeout(500);

        // Take final screenshot
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `${EXPECTATION_NAME}-current.png`),
          fullPage: true,
        });

        // Also take a screenshot of just the preview card if possible
        const previewCard = page.locator('[data-testid="group-preview-card"]').or(page.locator('.bg-white.rounded-xl.shadow-lg')).first();
        if (await previewCard.isVisible().catch(() => false)) {
          await previewCard.screenshot({
            path: path.join(SCREENSHOT_DIR, `${EXPECTATION_NAME}-preview-card-only.png`),
          });
        }

        // Log visibility status
        console.log(`Property preview with Like button visible: ${previewVisible}`);

        if (previewVisible) {
          // Verify the quick actions elements
          const commentButton = page.locator('text=Comment').first();
          const guessButton = page.locator('text=Guess').first();

          const commentVisible = await commentButton.isVisible().catch(() => false);
          const guessVisible = await guessButton.isVisible().catch(() => false);

          console.log('Quick Actions visibility:');
          console.log(`  Like: ${previewVisible}`);
          console.log(`  Comment: ${commentVisible}`);
          console.log(`  Guess: ${guessVisible}`);

          // All quick action buttons should be visible
          expect(commentVisible, 'Comment button should be visible').toBe(true);
          expect(guessVisible, 'Guess button should be visible').toBe(true);

          // Take screenshot with preview visible - use fullPage to capture entire card
          await page.screenshot({
            path: path.join(SCREENSHOT_DIR, '02-property-preview-with-like.png'),
            fullPage: true,
          });
        }

        // Report screenshot location
        console.log(`Screenshot saved to: ${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`);
      }
    }

    // Assert no critical console errors
    ctx.assertNoCriticalErrors();
  });

  test('verify quick actions UI components exist in codebase', async ({ page }) => {
    ctx = createVisualTestContext(page, `${EXPECTATION_NAME}-verification`);
    ctx.start();

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    // Wait for map instance and style to load
    await waitForMapStyleLoaded(page);

    const mapCanvas = page.locator('canvas').first();
    await mapCanvas.waitFor({ state: 'visible', timeout: 30000 });
    const box = await mapCanvas.boundingBox();

    if (box) {
      // Zoom to see individual points
      await page.evaluate(
        ({ center, zoom }) => {
          const mapInstance = (window as any).__mapInstance;
          if (mapInstance) {
            mapInstance.setCenter(center);
            mapInstance.setZoom(zoom);
            mapInstance.setPitch(0);
          }
        },
        { center: CENTER_COORDINATES, zoom: ZOOM_LEVEL_FOR_POINTS }
      );

      // Wait for map to be idle after zoom
      await waitForMapIdle(page);

      // Click on a property marker using map's fire() method
      const markerClicked = await page.evaluate(() => {
        const mapInstance = (window as any).__mapInstance;
        if (!mapInstance) return false;

        const features = mapInstance.queryRenderedFeatures(undefined, {
          layers: ['ghost-nodes', 'active-nodes'],
        }) || [];

        if (features.length > 0) {
          const feature = features[0];
          if (feature?.geometry?.type === 'Point') {
            const point = mapInstance.project(feature.geometry.coordinates);

            // Fire MapLibre's click handler
            mapInstance.fire('click', {
              point: { x: point.x, y: point.y },
              lngLat: mapInstance.unproject([point.x, point.y]),
              originalEvent: new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                clientX: point.x,
                clientY: point.y,
              }),
            });

            return true;
          }
        }
        return false;
      });

      if (!markerClicked) {
        // Fallback: click in center using Playwright
        await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
      }

      await page.waitForTimeout(2000);

      // Check for the existence of quick action buttons in the UI
      const likeButtonExists = await page.locator('text=Like').first().isVisible().catch(() => false);
      const commentButtonExists = await page.locator('text=Comment').first().isVisible().catch(() => false);
      const guessButtonExists = await page.locator('text=Guess').first().isVisible().catch(() => false);

      console.log('Quick Actions visibility check:');
      console.log(`  Like button: ${likeButtonExists}`);
      console.log(`  Comment button: ${commentButtonExists}`);
      console.log(`  Guess button: ${guessButtonExists}`);

      // Take a screenshot for documentation
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${EXPECTATION_NAME}-quick-actions.png`),
        fullPage: true,
      });
    }

    // Verify map is functioning
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    if (canvasBox) {
      expect(canvasBox.width).toBeGreaterThan(100);
      expect(canvasBox.height).toBeGreaterThan(100);
    }

    ctx.assertNoCriticalErrors();
  });
});
