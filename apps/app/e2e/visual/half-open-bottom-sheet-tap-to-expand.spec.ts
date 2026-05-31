import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import {
  resolveCanonicalPropertyFixture,
  setupCanonicalPropertyRouteMocks,
} from './helpers/canonical-property-route';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';

test.use({ trace: 'off', video: 'off' });

const EXPECTATION_NAME = 'half-open-bottom-sheet-tap-to-expand';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;
const WELCOME_MODAL_DISMISSED_KEY = 'huishype_welcome_modal_dismissed_v1';
const KNOWN_PREVIEW_PROPERTY_ROUTE = '/map/eindhoven/5651ha/beeldbuisring/41';
const KNOWN_PREVIEW_PROPERTY = {
  address: 'Beeldbuisring 41',
  streetName: 'Beeldbuisring',
  houseNumber: '41',
  city: 'Eindhoven',
  postalCode: '5651HA',
  countryCode: 'NL',
  geometry: { type: 'Point', coordinates: [5.44566, 51.4523] as [number, number] },
} as const;

const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

async function waitForMapReady(page: Page, timeout = 60_000): Promise<void> {
  await page.waitForSelector('[data-testid="map-view"] canvas', { timeout });
  await page.waitForFunction(
    () => {
      const map = (window as typeof window & {
        __mapInstance?: { getZoom?: () => number };
      }).__mapInstance;
      return typeof map?.getZoom === 'function';
    },
    null,
    { timeout, polling: 500 },
  );
}

async function readSheetIndex(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const value = (window as typeof window & { __sheetIndex?: number }).__sheetIndex;
    return typeof value === 'number' ? value : null;
  });
}

test.describe(`Reference Expectation: ${EXPECTATION_NAME}`, () => {
  test.setTimeout(120_000);

  let consoleErrors: string[] = [];

  test.beforeAll(() => {
    fs.mkdirSync(path.resolve(process.cwd(), SCREENSHOT_DIR), { recursive: true });
  });

  test.beforeEach(async ({ page, request }) => {
    consoleErrors = [];

    const selection = await resolveCanonicalPropertyFixture(request, KNOWN_PREVIEW_PROPERTY);
    expect(selection).not.toBeNull();
    if (!selection) {
      throw new Error('Expected known Beeldbuisring 41 preview fixture to resolve');
    }
    expect(selection.previewRoute).toBe(KNOWN_PREVIEW_PROPERTY_ROUTE);
    await setupCanonicalPropertyRouteMocks(page, request, selection);

    await page.addInitScript((storageKey) => {
      window.localStorage.setItem(storageKey, '1');
    }, WELCOME_MODAL_DISMISSED_KEY);

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (!isAllowedConsoleMessage(text, KNOWN_ACCEPTABLE_ERRORS)) {
        consoleErrors.push(text);
      }
    });

    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });
  });

  test.afterEach(async () => {
    expect(consoleErrors, `Expected zero console errors but found ${consoleErrors.length}`).toHaveLength(0);
  });

  test('tap passive body area expands the portrait sheet from partial to full', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(KNOWN_PREVIEW_PROPERTY_ROUTE, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await waitForMapReady(page);

    await expect(page.getByTestId('group-preview-card')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('selected-marker')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('property-preview-card').first().click({ force: true });

    await expect(page.getByTestId('web-property-panel')).toHaveClass(/partial/, {
      timeout: 15_000,
    });
    await expect.poll(() => readSheetIndex(page)).toBe(1);

    const panel = page.getByTestId('web-property-panel');
    await expect(panel.getByTestId('property-header-carousel')).toBeVisible({ timeout: 15_000 });
    await panel.getByTestId('property-header-carousel').evaluate((element) => {
      element.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
    });

    await expect(panel).toHaveClass(/full/, { timeout: 15_000 });
    await expect.poll(() => readSheetIndex(page)).toBe(2);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });
  });
});
