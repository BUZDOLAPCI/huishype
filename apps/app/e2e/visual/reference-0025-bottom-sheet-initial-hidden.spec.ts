/**
 * Reference Expectation E2E Test: 0025-bottom-sheet-initial-hidden
 *
 * Verifies the current web contract:
 * - No panel or backdrop is visible on initial load
 * - Marker selection shows only the preview card
 * - Empty-map tap dismisses the preview and keeps the panel hidden
 */

import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { waitForMapStyleLoaded, waitForMapIdle } from './helpers/visual-test-helpers';

test.use({ trace: 'off', video: 'off' });

const EXPECTATION_NAME = '0025-bottom-sheet-initial-hidden';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;
const CENTER_COORDINATES: [number, number] = [5.746, 51.400];
const ZOOM_LEVEL = 17;

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

test.setTimeout(120000);

async function waitForMapReady(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
  await waitForMapStyleLoaded(page);
  await waitForMapIdle(page, 10000);
}

async function zoomMapTo(page: Page, center: [number, number], zoom: number): Promise<void> {
  await page.evaluate(
    ({ targetCenter, targetZoom }) => {
      const mapInstance = (window as any).__mapInstance;
      if (!mapInstance) return;
      mapInstance.jumpTo({ center: targetCenter, zoom: targetZoom, pitch: 0 });
    },
    { targetCenter: center, targetZoom: zoom }
  );

  await waitForMapIdle(page, 10000);
}

async function clickOnPropertyMarker(page: Page): Promise<boolean> {
  const result = await page.evaluate(() => {
    const mapInstance = (window as any).__mapInstance;
    if (!mapInstance || !mapInstance.isStyleLoaded()) {
      return { success: false, reason: 'map-not-ready' };
    }

    const canvas = mapInstance.getCanvas();
    if (!canvas) {
      return { success: false, reason: 'no-canvas' };
    }

    const layers = ['ghost-nodes', 'active-nodes', 'single-active-points']
      .filter((layer) => mapInstance.getLayer(layer));

    let features: any[] = [];
    try {
      features = mapInstance.queryRenderedFeatures(
        [[0, 0], [canvas.width, canvas.height]],
        { layers }
      ) || [];
    } catch {
      return { success: false, reason: 'query-failed' };
    }

    const feature = features.find((item: any) =>
      item.geometry?.type === 'Point' &&
      (!item.properties?.point_count || item.properties.point_count === 1)
    );

    if (!feature) {
      return { success: false, reason: 'no-point-feature' };
    }

    const coordinates = feature.geometry.coordinates;
    const point = mapInstance.project(coordinates);
    const rect = canvas.getBoundingClientRect();
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + point.x,
      clientY: rect.top + point.y,
      view: window,
    });

    mapInstance.fire('click', {
      point: { x: point.x, y: point.y },
      lngLat: { lng: coordinates[0], lat: coordinates[1] },
      originalEvent: clickEvent,
      features: [feature],
    });

    return {
      success: true,
      screenX: point.x,
      screenY: point.y,
    };
  });

  if (!result.success) {
    console.log(`Marker click setup failed: ${result.reason}`);
    return false;
  }

  await page.mouse.click(result.screenX, result.screenY);
  await page.waitForTimeout(800);
  return true;
}

async function getPanelState(page: Page): Promise<{ previewVisible: boolean; panelVisible: boolean; backdropVisible: boolean }> {
  return page.evaluate(() => {
    const preview = document.querySelector('[data-testid="group-preview-card"]') as HTMLElement | null;
    const panel = document.querySelector('[data-testid="web-property-panel"]') as HTMLElement | null;
    const backdrop = document.querySelector('[data-testid="web-panel-backdrop"]') as HTMLElement | null;

    const previewVisible = !!preview && preview.getBoundingClientRect().width > 0 && preview.getBoundingClientRect().height > 0;
    const panelVisible = !!panel && panel.getBoundingClientRect().left < window.innerWidth && panel.getBoundingClientRect().right > 0;
    const backdropStyle = backdrop ? window.getComputedStyle(backdrop) : null;
    const backdropVisible = !!backdropStyle && parseFloat(backdropStyle.opacity || '0') > 0.1 && backdropStyle.pointerEvents !== 'none';

    return { previewVisible, panelVisible, backdropVisible };
  });
}

test.describe(`Reference Expectation: ${EXPECTATION_NAME}`, () => {
  let consoleErrors: string[] = [];
  let consoleWarnings: string[] = [];

  test.beforeAll(async () => {
    const fullPath = path.resolve(process.cwd(), SCREENSHOT_DIR);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    consoleWarnings = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!KNOWN_ACCEPTABLE_ERRORS.some((pattern) => pattern.test(text))) {
          consoleErrors.push(text);
        }
      } else if (msg.type() === 'warning') {
        consoleWarnings.push(msg.text());
      }
    });

    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    if (consoleWarnings.length > 0) {
      console.log(`Console warnings (${consoleWarnings.length}):`);
      consoleWarnings.slice(0, 10).forEach((warning) => console.log(`  - ${warning}`));
      if (consoleWarnings.length > 10) {
        console.log(`  ... and ${consoleWarnings.length - 10} more`);
      }
    }

    if (consoleErrors.length > 0) {
      console.error(`Console errors detected (${consoleErrors.length}):`);
      consoleErrors.forEach((error) => console.error(`  - ${error}`));
    }

    expect(consoleErrors, `Expected zero console errors but found ${consoleErrors.length}`).toHaveLength(0);
  });

  test('bottom sheet is completely hidden on initial app load', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await waitForMapReady(page);

    const state = await getPanelState(page);
    expect(state.previewVisible).toBe(false);
    expect(state.panelVisible).toBe(false);
    expect(state.backdropVisible).toBe(false);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });
  });

  test('bottom sheet appears when property is selected', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await waitForMapReady(page);
    await zoomMapTo(page, CENTER_COORDINATES, ZOOM_LEVEL);

    const clicked = await clickOnPropertyMarker(page);
    expect(clicked, 'Expected to find a property marker').toBe(true);

    const state = await getPanelState(page);
    expect(state.previewVisible).toBe(true);
    expect(state.panelVisible).toBe(false);
    expect(state.backdropVisible).toBe(false);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-property-selected.png`,
      fullPage: false,
    });
  });

  test('bottom sheet hides when preview card is dismissed', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await waitForMapReady(page);
    await zoomMapTo(page, CENTER_COORDINATES, ZOOM_LEVEL);

    const clicked = await clickOnPropertyMarker(page);
    expect(clicked, 'Expected to find a property marker').toBe(true);

    await page.locator('[data-testid="group-preview-close-button"]').click();
    await page.waitForTimeout(800);

    const state = await getPanelState(page);
    expect(state.previewVisible).toBe(false);
    expect(state.panelVisible).toBe(false);
    expect(state.backdropVisible).toBe(false);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-dismiss.png`,
      fullPage: false,
    });
  });
});
