import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { waitForMapIdle, waitForMapStyleLoaded } from './helpers/visual-test-helpers';
import { getPitchForZoom } from '../../src/lib/mapPitch';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';

const EXPECTATION_NAME = 'glitchy-windows-short-buildings';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Beeldbuisring 41, Eindhoven.
// Tightened onto the short sheds so the artifact is readable in the screenshot.
const CENTER: [number, number] = [5.44592, 51.45246];
const ZOOM = 18.8;
const PITCH = getPitchForZoom(ZOOM);
const BEARING = -30;

const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

test.describe(`Reference Expectation: ${EXPECTATION_NAME}`, () => {
  test.use({ viewport: { width: 768, height: 768 } });

  let consoleErrors: string[] = [];

  test.beforeAll(async () => {
    const fullPath = path.resolve(process.cwd(), SCREENSHOT_DIR);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      const isKnown = isAllowedConsoleMessage(text, KNOWN_ACCEPTABLE_ERRORS);
      if (!isKnown) {
        consoleErrors.push(text);
      }
    });

    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`,
    ).toHaveLength(0);
  });

  test('captures the Beeldbuisring short-building window case', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    await page.evaluate(
      ({ center, zoom, pitch, bearing }) => {
        const map = (window as any).__mapInstance;
        if (!map) return false;
        map.jumpTo({ center, zoom, pitch, bearing });
        return true;
      },
      { center: CENTER, zoom: ZOOM, pitch: PITCH, bearing: BEARING },
    );

    await waitForMapIdle(page, 20000);
    await page.waitForFunction(
      ({ expectedZoom, expectedPitch }) => {
        const map = (window as any).__mapInstance;
        if (!map) {
          return false;
        }

        const canvas = map.getCanvas?.();
        if (!canvas) {
          return false;
        }

        const zoom = map.getZoom?.() ?? 0;
        const pitch = map.getPitch?.() ?? 0;
        const tilesLoaded = typeof map.areTilesLoaded === 'function' ? map.areTilesLoaded() : true;
        const buildingFeatures = map.queryRenderedFeatures?.(
          [[0, 0], [canvas.width, canvas.height]],
          { layers: ['3d-buildings'] }
        ) || [];

        return (
          tilesLoaded &&
          Math.abs(zoom - expectedZoom) <= 0.4 &&
          Math.abs(pitch - expectedPitch) <= 1 &&
          buildingFeatures.length > 0
        );
      },
      { expectedZoom: ZOOM, expectedPitch: PITCH },
      { timeout: 20000 }
    );
    await page.waitForTimeout(1000);

    const mapState = await page.evaluate(() => {
      const map = (window as any).__mapInstance;
      return map
        ? {
            zoom: map.getZoom?.() ?? 0,
            pitch: map.getPitch?.() ?? 0,
            has3DBuildings: map.getLayer?.('3d-buildings') !== undefined,
          }
        : null;
    });

    expect(mapState?.has3DBuildings).toBe(true);
    expect(mapState?.zoom).toBeGreaterThanOrEqual(17);
    expect(mapState?.pitch).toBeGreaterThan(0);
    expect(mapState?.pitch).toBeCloseTo(PITCH, 1);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });

    await expect(page.locator('canvas').first()).toBeVisible();
  });
});
