import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { waitForMapIdle, waitForMapStyleLoaded } from './helpers/visual-test-helpers';
import { getPitchForZoom } from '../../src/lib/mapPitch';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';

const EXPECTATION_NAME = 'window-polish-multistory';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;
const CENTER: [number, number] = [5.44866, 51.4501];
const ZOOM = 18.5;
const PITCH = getPitchForZoom(ZOOM);
const BEARING = 0;

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

  test('captures the current debug-camera multistory facade', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    await page.evaluate(
      ({ center, zoom, pitch, bearing }) => {
        const map = window.__mapInstance;
        if (!map) return false;
        map.jumpTo({ center, zoom, pitch, bearing });
        return true;
      },
      { center: CENTER, zoom: ZOOM, pitch: PITCH, bearing: BEARING },
    );

    await waitForMapIdle(page);
    await page.waitForTimeout(2500);

    const mapState = await page.evaluate(() => {
      const map = window.__mapInstance;
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
    expect(mapState?.pitch).toBeCloseTo(PITCH, 1);
    expect(page.locator('canvas').first()).toBeVisible();

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });
  });
});
