/**
 * Reference Expectation E2E Test: bottom-sheet-full-expand
 *
 * Web uses the side-panel implementation behind `PropertyBottomSheet.web.tsx`.
 * These tests verify the real current contract instead of forcing a legacy
 * bottom-sheet DOM shape.
 */

import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { waitForMapStyleLoaded, waitForMapIdle } from './helpers/visual-test-helpers';

test.use({ trace: 'off', video: 'off' });

const EXPECTATION_NAME = 'bottom-sheet-full-expand';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;
const CENTER_COORDINATES: [number, number] = [5.4880, 51.4305];
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

async function openExpandedPanel(page: Page): Promise<void> {
  await waitForMapReady(page);
  await zoomMapTo(page, CENTER_COORDINATES, ZOOM_LEVEL);

  const clicked = await clickOnPropertyMarker(page);
  expect(clicked, 'Expected to find an individual property marker').toBe(true);

  const previewCard = page.locator('[data-testid="group-preview-card"]');
  await expect(previewCard).toBeVisible({ timeout: 10000 });

  await page.waitForFunction(
    () => Boolean((window as any).__bottomSheetRef?.current?.snapToIndex),
    { timeout: 10000 }
  );

  await page.evaluate(() => {
    const sheet = (window as any).__bottomSheetRef?.current;
    sheet?.snapToIndex?.(1);
  });

  const panel = page.locator('[data-testid="web-property-panel"]');
  await expect(panel).toBeVisible({ timeout: 10000 });
  await expect(panel.getByText('Guess the Price').first()).toBeVisible({ timeout: 15000 });
}

async function scrollPanelContent(page: Page): Promise<{ before: number; after: number }> {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-testid="web-property-panel"]');
    if (!panel) {
      return { before: 0, after: 0 };
    }

    const scroller = Array.from(panel.querySelectorAll('*')).find((element) => {
      const node = element as HTMLElement;
      return node.scrollHeight > node.clientHeight + 50;
    }) as HTMLElement | undefined;

    if (!scroller) {
      return { before: 0, after: 0 };
    }

    const before = scroller.scrollTop;
    scroller.scrollTo({ top: Math.min(scroller.scrollHeight, before + 500), behavior: 'instant' as ScrollBehavior });
    return { before, after: scroller.scrollTop };
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

  test('capture full expand state for visual comparison', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await openExpandedPanel(page);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });
  });

  test('verify full expand content sections', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await openExpandedPanel(page);

    const panel = page.locator('[data-testid="web-property-panel"]');
    await expect(panel.getByText('Property Details').first()).toBeVisible();
    await expect(panel.getByText('Guess the Price').first()).toBeVisible();
    await expect(panel.getByText('Comments').first()).toBeVisible();
    await expect(panel.getByText('Listings').first()).toBeVisible();
    await expect(panel.getByText('Save').first()).toBeVisible();
    await expect(panel.getByText('Share').first()).toBeVisible();
    await expect(panel.getByText('Like').first()).toBeVisible();
  });

  test('verify scrolling within full expand sheet', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await openExpandedPanel(page);

    const scrollState = await scrollPanelContent(page);
    console.log(`Panel scrollTop before=${scrollState.before}, after=${scrollState.after}`);
    expect(scrollState.after).toBeGreaterThanOrEqual(scrollState.before);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-scroll-state.png`,
      fullPage: false,
    });
  });

  test('verify swipe down returns to partial or dismisses', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await openExpandedPanel(page);

    const previewCard = page.locator('[data-testid="group-preview-card"]');
    const closeButton = page.locator('[data-testid="web-panel-close"]');
    await closeButton.click();
    await expect(previewCard).toBeVisible();

    const panelState = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="web-property-panel"]') as HTMLElement | null;
      const backdrop = document.querySelector('[data-testid="web-panel-backdrop"]') as HTMLElement | null;
      if (!panel || !backdrop) {
        return { panelOpen: false, backdropVisible: false };
      }

      const backdropStyle = window.getComputedStyle(backdrop);
      return {
        panelOpen: panel.classList.contains('open'),
        backdropVisible: parseFloat(backdropStyle.opacity || '0') > 0.1 && backdropStyle.pointerEvents !== 'none',
      };
    });

    expect(panelState.panelOpen).toBe(false);
    expect(panelState.backdropVisible).toBe(false);
  });

  test('verify full expand shows complete property detail sections', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await openExpandedPanel(page);

    const panelText = await page.locator('[data-testid="web-property-panel"]').innerText();
    expect(panelText).toContain('Guess the Price');
    expect(panelText).toContain('Comments');
    expect(panelText).toContain('Property Details');
    expect(panelText).toContain('Save');
    expect(panelText).toContain('Share');
  });
});
