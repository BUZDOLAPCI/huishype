import { test, expect, type Page } from '@playwright/test';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';

const AMSTERDAM_CENTER: [number, number] = [4.8952, 52.3702];

const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

async function waitForMapReady(page: Page, timeout = 60_000) {
  await page.waitForSelector('canvas', { timeout });
  await page.waitForFunction(
    () => {
      const map = (window as any).__mapInstance;
      return map && typeof map.getZoom === 'function';
    },
    { timeout, polling: 500 },
  );
  await page.waitForFunction(
    () => {
      const map = (window as any).__mapInstance;
      if (!map) return false;
      return typeof map.isStyleLoaded === 'function' ? map.isStyleLoaded() : !!map.getStyle?.();
    },
    { timeout, polling: 500 },
  );
  await page.locator('text=Loading map...').waitFor({ state: 'hidden', timeout }).catch(() => {});
}

async function setMapView(page: Page, center: [number, number], zoom: number) {
  await page.evaluate(
    ({ center: targetCenter, zoom: targetZoom }) => {
      const map = (window as any).__mapInstance;
      map?.jumpTo({ center: targetCenter, zoom: targetZoom, pitch: 0, bearing: 0 });
    },
    { center, zoom },
  );

  await page.waitForFunction(
    ({ zoom: targetZoom }) => {
      const map = (window as any).__mapInstance;
      return map && Math.abs(map.getZoom() - targetZoom) < 0.1;
    },
    { zoom },
    { timeout: 10_000 },
  );

  await page.waitForTimeout(1500);
}

async function expectHeaderLocation(page: Page, label: string) {
  await expect
    .poll(
      async () =>
        (await page.getByTestId('map-header-row').textContent())?.replace(/\s+/g, ' ').trim() ?? '',
      { timeout: 10_000 },
    )
    .toContain(label);
}

test.describe('Map Header Location Label', () => {
  test.setTimeout(120_000);

  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];

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
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`,
    ).toHaveLength(0);
  });

  test('header label follows zoom level from country to city to locality', async ({ page }) => {
    await page.goto('/');
    await waitForMapReady(page);

    await setMapView(page, AMSTERDAM_CENTER, 5);
    await expectHeaderLocation(page, 'Nederland');

    await setMapView(page, AMSTERDAM_CENTER, 11);
    await expectHeaderLocation(page, 'Amsterdam');

    await setMapView(page, AMSTERDAM_CENTER, 17);
    await expectHeaderLocation(page, 'Burgwallen-Oude Zijde');
  });
});
