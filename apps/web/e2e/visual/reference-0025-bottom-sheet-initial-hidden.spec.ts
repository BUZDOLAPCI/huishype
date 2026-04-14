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
import { clickOnPropertyMarker, dismissPreviewCard } from './helpers/screenshot-harness';

test.use({
  trace: 'off',
  video: 'off',
  viewport: { width: 390, height: 844 },
});

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

async function waitForPreviewCardVisible(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="group-preview-card"]').first()).toBeVisible({ timeout: 10000 });
}

async function waitForPreviewCloseControl(page: Page): Promise<void> {
  const closeControl = page.locator(
    '[data-testid="property-preview-close-button"], [data-testid="group-preview-close-button"], [data-testid="group-preview-close-hitzone"]'
  ).first();
  await expect(closeControl).toBeVisible({ timeout: 10000 });
}

async function getPanelState(page: Page): Promise<{
  sheetIndex: number;
  sheetHidden: boolean;
  sheetResting: boolean;
  backdropVisible: boolean;
  previewVisible: boolean;
}> {
  return page.evaluate(() => {
    const backdrop = document.querySelector('[data-testid="web-panel-backdrop"]') as HTMLElement | null;
    const previewCard = document.querySelector('[data-testid="group-preview-card"]') as HTMLElement | null;

    const sheetIndex = (window as unknown as { __sheetIndex?: number }).__sheetIndex ?? -1;
    const backdropStyle = backdrop ? window.getComputedStyle(backdrop) : null;
    const backdropVisible = !!backdropStyle && parseFloat(backdropStyle.opacity || '0') > 0.1 && backdropStyle.pointerEvents !== 'none';

    return {
      sheetIndex,
      sheetHidden: sheetIndex < 0,
      sheetResting: sheetIndex === 0,
      backdropVisible,
      previewVisible: !!previewCard,
    };
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
    expect(state.sheetHidden).toBe(true);
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

    const clickResult = await clickOnPropertyMarker(page);
    expect(clickResult.success, 'Expected to find a property marker').toBe(true);
    await page.waitForFunction(() => (window as unknown as { __sheetIndex?: number }).__sheetIndex === 0, null, {
      timeout: 10000,
    });
    await waitForPreviewCardVisible(page);

    const state = await getPanelState(page);
    expect(state.sheetResting).toBe(true);
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
    const previewCard = page.locator('[data-testid="group-preview-card"]').first();

    const clickResult = await clickOnPropertyMarker(page);
    expect(clickResult.success, 'Expected to find a property marker').toBe(true);
    await page.waitForFunction(() => (window as unknown as { __sheetIndex?: number }).__sheetIndex === 0, null, {
      timeout: 10000,
    });
    await waitForPreviewCardVisible(page);
    await waitForPreviewCloseControl(page);

    const dismissed = await dismissPreviewCard(page);
    expect(dismissed, 'Expected a visible preview close control').toBe(true);
    await page.waitForFunction(() => (window as unknown as { __sheetIndex?: number }).__sheetIndex === -1, null, {
      timeout: 10000,
    });
    await expect(previewCard).toBeHidden({ timeout: 10000 });

    const state = await getPanelState(page);
    expect(state.sheetHidden).toBe(true);
    expect(state.backdropVisible).toBe(false);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-after-dismiss.png`,
      fullPage: false,
    });
  });
});
