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
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';

test.use({ trace: 'off', video: 'off' });

const EXPECTATION_NAME = '0025-bottom-sheet-initial-hidden';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;
const CENTER_COORDINATES: [number, number] = [5.4697, 51.4416];
const ZOOM_LEVEL = 17;
const WELCOME_MODAL_DISMISSED_KEY = 'huishype_welcome_modal_dismissed_v1';

const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

test.setTimeout(120000);

async function waitForMapReady(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
  await waitForMapStyleLoaded(page);
  await waitForMapIdle(page, 10000);
}

async function zoomMapTo(page: Page, center: [number, number], zoom: number): Promise<void> {
  await page.evaluate(
    ({ targetCenter, targetZoom }) => {
      const mapInstance = window.__mapInstance;
      if (!mapInstance) return;
      mapInstance.jumpTo({ center: targetCenter, zoom: targetZoom, pitch: 0 });
    },
    { targetCenter: center, targetZoom: zoom }
  );

  await waitForMapIdle(page, 10000);
}


async function getPanelState(page: Page): Promise<{ previewVisible: boolean; panelVisible: boolean; backdropVisible: boolean }> {
  return page.evaluate(() => {
    const preview = document.querySelector(
      '[data-testid="group-preview-card"], [data-testid="property-preview-card"]'
    ) as HTMLElement | null;
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

    await page.addInitScript((storageKey) => {
      window.localStorage.setItem(storageKey, '1');
    }, WELCOME_MODAL_DISMISSED_KEY);

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!isAllowedConsoleMessage(text, KNOWN_ACCEPTABLE_ERRORS)) {
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

    const clickResult = await clickOnPropertyMarker(page);
    expect(clickResult.success, 'Expected to find a property marker').toBe(true);
    await page.waitForTimeout(500);

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

    const clickResult = await clickOnPropertyMarker(page);
    expect(clickResult.success, 'Expected to find a property marker').toBe(true);
    await page.waitForTimeout(500);

    const dismissed = await dismissPreviewCard(page);
    expect(dismissed, 'Expected a visible preview close control').toBe(true);
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
