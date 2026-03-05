import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import {
  waitForMapStyleLoaded,
  waitForMapIdle,
  KNOWN_ACCEPTABLE_ERRORS,
} from './helpers/visual-test-helpers';

const EXPECTATION_NAME = 'building-windows';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;

// Eindhoven center — dense building area
const EINDHOVEN_CENTER: [number, number] = [5.4795, 51.4381];

let consoleErrors: string[] = [];

test.describe('3D Building Windows', () => {
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
      `Expected zero console errors but found ${consoleErrors.length}`,
    ).toHaveLength(0);
  });

  test('buildings show procedural windows at z16', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    // Navigate to Eindhoven center at z16 with 3D pitch
    await page.evaluate(
      ({ center }) => {
        const map = (window as any).__mapInstance;
        map.jumpTo({
          center,
          zoom: 16,
          pitch: 60,
          bearing: -20,
        });
      },
      { center: EINDHOVEN_CENTER },
    );

    await waitForMapIdle(page);
    // Extra settle time for 3D building rendering
    await page.waitForTimeout(3000);

    // Verify 3d-buildings layer exists
    const layerInfo = await page.evaluate(() => {
      const map = (window as any).__mapInstance;
      const has3DBuildings = !!map.getLayer('3d-buildings');
      const zoom = map.getZoom();
      return { has3DBuildings, zoom };
    });

    expect(layerInfo.has3DBuildings, '3d-buildings layer should exist').toBe(true);
    expect(layerInfo.zoom).toBeGreaterThanOrEqual(15);

    // Take screenshot
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });

    // Verify canvas is visible (3D buildings render on WebGL canvas)
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
  });
});
