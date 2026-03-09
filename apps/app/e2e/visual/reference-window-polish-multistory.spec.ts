import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { waitForMapIdle, waitForMapStyleLoaded } from './helpers/visual-test-helpers';

const EXPECTATION_NAME = 'window-polish-multistory';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

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
      const isKnown = KNOWN_ACCEPTABLE_ERRORS.some((pattern) => pattern.test(text));
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
    await waitForMapIdle(page);
    await page.waitForTimeout(2500);

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
    expect(page.locator('canvas').first()).toBeVisible();

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });
  });
});
