/**
 * Paper Mario Trees - Visual E2E Test
 *
 * Verifies that billboard tree quads render correctly on the web map:
 * - Trees visible at z15+ over green/park areas
 * - No trees below z15 (minzoom gate)
 * - tree-source and paper-trees layer present in map style
 * - No console errors during rendering
 *
 * Screenshots saved to: test-results/reference-expectations/paper-trees/
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import {
  waitForMapStyleLoaded,
  waitForMapIdle,
  KNOWN_ACCEPTABLE_ERRORS,
} from './helpers/visual-test-helpers';

const EXPECTATION_NAME = 'paper-trees';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Stadswandelpark, Eindhoven — dense park with many trees
const PARK_CENTER: [number, number] = [5.478, 51.433];
const TREE_ZOOM = 17;
const BELOW_MIN_ZOOM = 14;

let consoleErrors: string[] = [];

test.describe(`Paper Mario Trees`, () => {
  test.beforeAll(async () => {
    const fullPath = path.resolve(process.cwd(), SCREENSHOT_DIR);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const isKnown = KNOWN_ACCEPTABLE_ERRORS.some((p) =>
          text.toLowerCase().includes(p.toLowerCase())
        );
        if (!isKnown) {
          consoleErrors.push(text);
        }
      }
    });

    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    if (consoleErrors.length > 0) {
      console.error(`Console errors (${consoleErrors.length}):`);
      consoleErrors.forEach((e) => console.error(`  - ${e}`));
    }
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('trees render at z17 over park area', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    // Jump to park at z17 with 3D pitch
    await page.evaluate(
      ({ center, zoom }) => {
        const map = (window as any).__mapInstance;
        map.jumpTo({ center, zoom, pitch: 50 });
      },
      { center: PARK_CENTER, zoom: TREE_ZOOM }
    );

    await waitForMapIdle(page);
    // Extra settle time for the symbol layer to render
    await page.waitForTimeout(3000);

    // Verify tree source and symbol layer exist
    const layerInfo = await page.evaluate(() => {
      const map = (window as any).__mapInstance;
      const style = map.getStyle();
      const sources = Object.keys(style.sources);
      const hasTreeSource = sources.includes('tree-source');
      const hasPaperTrees = !!map.getLayer('paper-trees');
      const treeLayerIndex = style.layers.findIndex((layer: any) => layer.id === 'paper-trees');
      const buildingLayerIndex = style.layers.findIndex((layer: any) => layer.id === '3d-buildings');
      const zoom = map.getZoom();
      return { hasTreeSource, hasPaperTrees, treeLayerIndex, buildingLayerIndex, zoom };
    });

    expect(layerInfo.hasTreeSource, 'tree-source should exist').toBe(true);
    expect(layerInfo.hasPaperTrees, 'paper-trees layer should exist').toBe(true);
    expect(layerInfo.treeLayerIndex, 'paper-trees layer should be in the style').toBeGreaterThanOrEqual(0);
    expect(layerInfo.buildingLayerIndex, '3d-buildings layer should be in the style').toBeGreaterThanOrEqual(0);
    expect(layerInfo.treeLayerIndex, 'paper-trees should render above 3d-buildings').toBeGreaterThan(
      layerInfo.buildingLayerIndex
    );
    expect(layerInfo.zoom).toBeGreaterThanOrEqual(15);

    // Query tree features to confirm tiles loaded
    const featureCount = await page.evaluate(() => {
      const map = (window as any).__mapInstance;
      const features = map.querySourceFeatures('tree-source', {
        sourceLayer: 'scattered-trees',
      });
      return features.length;
    });

    console.log(`Tree features in viewport: ${featureCount}`);
    expect(featureCount, 'Should have tree features loaded in park area').toBeGreaterThan(0);

    // Take screenshot
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-z17.png`,
      fullPage: false,
    });

    // Verify canvas is visible (trees render on WebGL canvas)
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
  });

  test('no trees below z15 (minzoom gate)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    // Jump to same park area but at z14 (below tree minzoom of 15)
    await page.evaluate(
      ({ center, zoom }) => {
        const map = (window as any).__mapInstance;
        map.jumpTo({ center, zoom, pitch: 0 });
      },
      { center: PARK_CENTER, zoom: BELOW_MIN_ZOOM }
    );

    await waitForMapIdle(page);
    await page.waitForTimeout(2000);

    // tree-source has minzoom:15, so no tiles fetched at z14
    const featureCount = await page.evaluate(() => {
      const map = (window as any).__mapInstance;
      const features = map.querySourceFeatures('tree-source', {
        sourceLayer: 'scattered-trees',
      });
      return features.length;
    });

    console.log(`Tree features at z${BELOW_MIN_ZOOM}: ${featureCount}`);
    expect(featureCount, 'Should have no tree features below minzoom').toBe(0);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-below-minzoom.png`,
      fullPage: false,
    });
  });
});
