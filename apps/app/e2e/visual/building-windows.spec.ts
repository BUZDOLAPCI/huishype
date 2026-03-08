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

  const zoomLevels = [
    { zoom: 15, description: 'distance — no window detail expected' },
    { zoom: 16, description: 'mid-distance — subtle tinting/bands' },
    { zoom: 17, description: 'close — visible window grid' },
    { zoom: 18, description: 'detail — full windows with glare' },
  ];

  for (const { zoom, description } of zoomLevels) {
    test(`buildings at z${zoom} (${description})`, async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('[data-testid="map-view"]', { timeout: 60000 });
      await waitForMapStyleLoaded(page);

      // Navigate to Eindhoven center with 3D pitch
      await page.evaluate(
        ({ center, z }) => {
          const map = (window as any).__mapInstance;
          map.jumpTo({
            center,
            zoom: z,
            pitch: 60,
            bearing: -20,
          });
        },
        { center: EINDHOVEN_CENTER, z: zoom },
      );

      await waitForMapIdle(page);
      // Extra settle time for 3D building rendering + tile loading
      await page.waitForTimeout(4000);

      // Verify 3d-buildings layer exists
      const layerInfo = await page.evaluate(() => {
        const map = (window as any).__mapInstance;
        const has3DBuildings = !!map.getLayer('3d-buildings');
        const currentZoom = map.getZoom();
        return { has3DBuildings, currentZoom };
      });

      expect(layerInfo.has3DBuildings, '3d-buildings layer should exist').toBe(true);
      expect(layerInfo.currentZoom).toBeCloseTo(zoom, 0);

      // Take screenshot
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-z${zoom}.png`,
        fullPage: false,
      });

      // Verify canvas is visible
      const canvas = page.locator('canvas').first();
      await expect(canvas).toBeVisible();
    });
  }
});
