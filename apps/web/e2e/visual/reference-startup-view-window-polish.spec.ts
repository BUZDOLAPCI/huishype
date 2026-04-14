import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  KNOWN_ACCEPTABLE_ERRORS,
  waitForMapIdle,
  waitForMapStyleLoaded,
} from './helpers/visual-test-helpers';

const EXPECTATION_NAME = 'startup-view-window-polish';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

test.describe(`Reference Expectation: ${EXPECTATION_NAME}`, () => {
  test.use({ viewport: { width: 1280, height: 720 } });

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
      const isKnown = KNOWN_ACCEPTABLE_ERRORS.some((pattern) =>
        text.toLowerCase().includes(pattern.toLowerCase()),
      );

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

  test('captures the actual default startup view', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 60000 });
    await waitForMapStyleLoaded(page);
    await waitForMapIdle(page);
    await page.waitForTimeout(3000);

    const mapState = await page.evaluate(() => {
      const map = (window as any).__mapInstance;
      if (!map) return null;

      const center = map.getCenter?.();

      return {
        center: center ? [center.lng, center.lat] : null,
        zoom: map.getZoom?.() ?? null,
        pitch: map.getPitch?.() ?? null,
        bearing: map.getBearing?.() ?? null,
        has3DBuildings: map.getLayer?.('3d-buildings') !== undefined,
      };
    });

    expect(mapState).not.toBeNull();
    expect(mapState?.has3DBuildings).toBe(true);
    await expect(page.locator('canvas').first()).toBeVisible();

    test.info().annotations.push({
      type: 'map-state',
      description: JSON.stringify(mapState),
    });

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });
  });
});
