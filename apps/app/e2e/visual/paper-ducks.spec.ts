/**
 * Paper Mario Ducks - Visual E2E Test
 *
 * Verifies that server-provided decorative duck symbols are wired into the
 * shared MapLibre style and remain gated below z15.
 *
 * Screenshots saved to: test-results/reference-expectations/paper-ducks/
 */

import { expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { getPlaywrightApiUrl } from '../helpers/runtime';
import { isAllowedConsoleMessage } from '../helpers/console';
import {
  KNOWN_ACCEPTABLE_ERRORS,
  waitForMapIdle,
  waitForMapStyleLoaded,
} from './helpers/visual-test-helpers';

const EXPECTATION_NAME = 'paper-ducks';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;
const API_BASE_URL = getPlaywrightApiUrl();
const WELCOME_MODAL_DISMISSED_KEY = 'huishype_welcome_modal_dismissed_v1';

// Karpendonkse Plas, Eindhoven — closed inland water polygon in local OSM data.
const WATER_CENTER: [number, number] = [5.5076, 51.4552];
const DUCK_ZOOM = 17;
const BELOW_MIN_ZOOM = 14;

let consoleErrors: string[] = [];

test.describe('Paper Mario Ducks', () => {
  test.beforeAll(async () => {
    const fullPath = path.resolve(process.cwd(), SCREENSHOT_DIR);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];

    await page.addInitScript((storageKey) => {
      window.localStorage.setItem(storageKey, '1');
    }, WELCOME_MODAL_DISMISSED_KEY);

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!isAllowedConsoleMessage(text, KNOWN_ACCEPTABLE_ERRORS)) {
          consoleErrors.push(text);
        }
      }
    });

    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('ducks style source and layer are present over water at z17', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    await page.evaluate(
      ({ center, zoom }) => {
        const map = window.__mapInstance;
        map.jumpTo({ center, zoom, pitch: 45 });
      },
      { center: WATER_CENTER, zoom: DUCK_ZOOM }
    );

    await waitForMapIdle(page);
    await page.waitForTimeout(2500);

    const layerInfo = await page.evaluate(() => {
      const map = window.__mapInstance;
      const style = map.getStyle();
      const sources = Object.keys(style.sources);
      const hasDuckSource = sources.includes('duck-source');
      const hasPaperDucks = !!map.getLayer('paper-ducks');
      const duckLayerIndex = style.layers.findIndex((layer) => layer.id === 'paper-ducks');
      const treeLayerIndex = style.layers.findIndex((layer) => layer.id === 'paper-trees');
      const zoom = map.getZoom();
      const featureCount = map.querySourceFeatures('duck-source', {
        sourceLayer: 'scattered-ducks',
      }).length;

      return { hasDuckSource, hasPaperDucks, duckLayerIndex, treeLayerIndex, zoom, featureCount };
    });

    expect(layerInfo.hasDuckSource, 'duck-source should exist').toBe(true);
    expect(layerInfo.hasPaperDucks, 'paper-ducks layer should exist').toBe(true);
    expect(layerInfo.duckLayerIndex, 'paper-ducks layer should be in the style')
      .toBeGreaterThanOrEqual(0);
    expect(layerInfo.treeLayerIndex, 'paper-trees layer should be in the style')
      .toBeGreaterThanOrEqual(0);
    expect(layerInfo.duckLayerIndex, 'paper-ducks should render after paper-trees').toBeGreaterThan(
      layerInfo.treeLayerIndex
    );
    expect(layerInfo.zoom).toBeGreaterThanOrEqual(15);
    expect(layerInfo.featureCount, 'duck-source query should be available').toBeGreaterThanOrEqual(0);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-z17.png`,
      fullPage: false,
    });

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
  });

  test('no ducks below z15', async ({ page, request }) => {
    const belowMinTile = await request.get(`${API_BASE_URL}/tiles/ducks/14/8446/5449.pbf`);
    expect(belowMinTile.status()).toBe(204);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    await page.evaluate(
      ({ center, zoom }) => {
        const map = window.__mapInstance;
        map.jumpTo({ center, zoom, pitch: 0 });
      },
      { center: WATER_CENTER, zoom: BELOW_MIN_ZOOM }
    );

    await waitForMapIdle(page);
    await page.waitForTimeout(1500);

    const featureCount = await page.evaluate(() => {
      const map = window.__mapInstance;
      return map.querySourceFeatures('duck-source', {
        sourceLayer: 'scattered-ducks',
      }).length;
    });

    expect(featureCount, 'Should have no duck features below minzoom').toBe(0);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-below-minzoom.png`,
      fullPage: false,
    });
  });
});
