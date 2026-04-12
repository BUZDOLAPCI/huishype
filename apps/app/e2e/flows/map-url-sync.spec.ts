import { expect, test, type Page } from '@playwright/test';
import { buildCanonicalMapPreviewPath } from '@huishype/shared';

import { waitForMapReady } from '../integration/helpers';

const FIXTURE_ROUTE_INPUT = {
  city: 'Eindhoven',
  postalCode: '5651HP',
  streetName: 'Deflectiespoelstraat',
  houseNumber: '16',
  countryCode: 'NL' as const,
};

const FIXTURE = {
  address: 'Deflectiespoelstraat 16',
  searchQuery: 'Deflectiespoelstraat 16, 5651HP Eindhoven',
  previewPath: buildCanonicalMapPreviewPath(FIXTURE_ROUTE_INPUT),
};

const KNOWN_ACCEPTABLE_ERRORS: RegExp[] = [
  /ResizeObserver loop/,
  /sourceMappingURL/,
  /Failed to parse source map/,
  /Fast Refresh/,
  /\[HMR\]/,
  /WebSocket connection/,
  /net::ERR_ABORTED/,
  /net::ERR_NAME_NOT_RESOLVED/,
  /\.pbf/,
  /tiles\.openfreemap\.org/,
  /pointerEvents is deprecated/,
  /GL Driver Message/,
  /Failed to load resource.*\/sprites\//,
];

test.describe('Map URL sync', () => {
  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    await page.addInitScript(() => {
      const win = window as typeof window & {
        __historyOps?: {
          pushCount: number;
          replaceCount: number;
        };
      };

      if (win.__historyOps) {
        return;
      }

      win.__historyOps = {
        pushCount: 0,
        replaceCount: 0,
      };

      const originalPushState = window.history.pushState.bind(window.history);
      const originalReplaceState = window.history.replaceState.bind(window.history);

      window.history.pushState = ((...args: Parameters<History['pushState']>) => {
        win.__historyOps!.pushCount += 1;
        return originalPushState(...args);
      }) as History['pushState'];

      window.history.replaceState = ((...args: Parameters<History['replaceState']>) => {
        win.__historyOps!.replaceCount += 1;
        return originalReplaceState(...args);
      }) as History['replaceState'];
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!KNOWN_ACCEPTABLE_ERRORS.some((pattern) => pattern.test(text))) {
          consoleErrors.push(text);
        }
      }
    });
    page.on('pageerror', (error) => {
      const text = error.message;
      if (!KNOWN_ACCEPTABLE_ERRORS.some((pattern) => pattern.test(text))) {
        consoleErrors.push(`Page Error: ${text}`);
      }
    });
  });

  test.afterEach(async () => {
    expect(consoleErrors).toHaveLength(0);
  });

  async function resetHistoryOps(page: Page) {
    return await page.evaluate(() => {
      const win = window as typeof window & {
        __historyOps?: {
          pushCount: number;
          replaceCount: number;
        };
      };

      if (!win.__historyOps) {
        throw new Error('History instrumentation missing');
      }

      win.__historyOps.pushCount = 0;
      win.__historyOps.replaceCount = 0;

      return window.history.length;
    });
  }

  async function readHistoryOps(page: Page) {
    return await page.evaluate(() => {
      const win = window as typeof window & {
        __historyOps?: {
          pushCount: number;
          replaceCount: number;
        };
      };

      if (!win.__historyOps) {
        throw new Error('History instrumentation missing');
      }

      return {
        pushCount: win.__historyOps.pushCount,
        replaceCount: win.__historyOps.replaceCount,
        historyLength: window.history.length,
      };
    });
  }

  async function closePreviewCard(page: Page) {
    const closeButton = page
      .getByTestId('property-preview-close-button')
      .or(page.getByTestId('group-preview-close-button'));

    await expect(closeButton).toBeVisible({ timeout: 20000 });
    await closeButton.scrollIntoViewIfNeeded();
    await closeButton.evaluate((button) => {
      (button as HTMLButtonElement).click();
    });
  }

  test('replaces passive camera browsing with /@... URLs', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForMapReady(page);
    const baselineHistoryLength = await resetHistoryOps(page);

    await page.evaluate(() => {
      const map = (window as unknown as {
        __mapInstance?: { jumpTo(opts: { center: [number, number]; zoom: number }): void };
      }).__mapInstance;
      if (!map) {
        throw new Error('Map instance not ready');
      }

      map.jumpTo({
        center: [5.4897, 51.4516],
        zoom: 15.25,
      });
    });

    await page.waitForURL(/\/@51\.4516\d*,5\.4897\d*,15\.25z$/, { timeout: 15000 });

    const historyOps = await readHistoryOps(page);
    expect(historyOps.replaceCount).toBeGreaterThan(0);
    expect(historyOps.pushCount).toBe(0);
    expect(historyOps.historyLength).toBe(baselineHistoryLength);
  });

  test('swaps preview URLs with replace semantics and restores the latest camera URL on close', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForMapReady(page);

    await page.evaluate(() => {
      const map = (window as unknown as {
        __mapInstance?: { jumpTo(opts: { center: [number, number]; zoom: number }): void };
      }).__mapInstance;
      if (!map) {
        throw new Error('Map instance not ready');
      }

      map.jumpTo({
        center: [5.4797, 51.4466],
        zoom: 14.5,
      });
    });

    await page.waitForURL(/\/@51\.4466\d*,5\.4797\d*,14\.5z$/, { timeout: 15000 });
    const baselineHistoryLength = await resetHistoryOps(page);

    const searchInput = page.getByTestId('search-bar-input');
    await searchInput.click();
    await searchInput.focus();
    await searchInput.pressSequentially(FIXTURE.searchQuery, { delay: 30 });

    const resultItem = page.locator('[data-testid="search-result-item"]').filter({
      hasText: FIXTURE.address,
    }).first();
    await expect(resultItem).toBeVisible({ timeout: 30000 });
    await resultItem.click();

    await expect(page.getByTestId('group-preview-card')).toBeVisible({ timeout: 20000 });
    await page.waitForURL(new RegExp(`${FIXTURE.previewPath}$`), { timeout: 15000 });

    await closePreviewCard(page);

    await expect(page.getByTestId('group-preview-card')).toHaveCount(0);
    await page.waitForURL(/\/@51\.\d+,5\.\d+,1[4-9](?:\.\d+)?z$/, { timeout: 15000 });

    const historyOps = await readHistoryOps(page);
    expect(historyOps.replaceCount).toBeGreaterThanOrEqual(2);
    expect(historyOps.pushCount).toBe(0);
    expect(historyOps.historyLength).toBe(baselineHistoryLength);
  });
});
