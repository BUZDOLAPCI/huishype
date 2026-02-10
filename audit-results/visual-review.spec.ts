import { test, expect, Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

const KNOWN_ACCEPTABLE_ERRORS = [
  /Failed to load resource/,
  /maplibre|mapbox/i,
  /pointerEvents is deprecated/,
  /ERR_NAME_NOT_RESOLVED/,
  /favicon\.ico/,
  /net::ERR/,
  /Download the React DevTools/,
  /ResizeObserver loop/,
];

function isAcceptableError(msg: string): boolean {
  return KNOWN_ACCEPTABLE_ERRORS.some((re) => re.test(msg));
}

async function waitForMapReady(page: Page, timeout = 45000) {
  // Wait for map container to exist
  await page.waitForSelector('[class*="map"],.maplibregl-map', { timeout });
  // Wait for map to be loaded
  await page.waitForFunction(
    () => {
      const mapEl = document.querySelector('.maplibregl-map');
      if (!mapEl) return false;
      // Check if canvas has rendered
      const canvas = mapEl.querySelector('canvas');
      return canvas && canvas.width > 0 && canvas.height > 0;
    },
    { timeout }
  );
  // Give tiles a moment to load
  await page.waitForTimeout(3000);
}

test.describe('Visual/UX Review', () => {
  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!isAcceptableError(text)) {
          consoleErrors.push(text);
        }
      }
    });
  });

  test('1. Map screen — initial load (Netherlands view)', async ({ page }) => {
    await page.goto('/', { timeout: 60000, waitUntil: 'networkidle' });
    await waitForMapReady(page);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '01-map-initial-load.png'),
      fullPage: false,
    });
  });

  test('2. Map screen — zoomed into Eindhoven', async ({ page }) => {
    await page.goto('/', { timeout: 60000, waitUntil: 'networkidle' });
    await waitForMapReady(page);

    // Use map to zoom to Eindhoven area
    await page.evaluate(() => {
      const mapEl = document.querySelector('.maplibregl-map');
      if (!mapEl) return;
      // @ts-ignore
      const map = mapEl.__maplibregl_map || (window as any).__map;
      if (map) {
        map.flyTo({ center: [5.4697, 51.4416], zoom: 14, duration: 0 });
      }
    });
    await page.waitForTimeout(4000);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '02-map-eindhoven-zoom14.png'),
      fullPage: false,
    });
  });

  test('3. Map screen — street level zoom', async ({ page }) => {
    await page.goto('/', { timeout: 60000, waitUntil: 'networkidle' });
    await waitForMapReady(page);

    await page.evaluate(() => {
      const mapEl = document.querySelector('.maplibregl-map');
      if (!mapEl) return;
      // @ts-ignore
      const map = mapEl.__maplibregl_map || (window as any).__map;
      if (map) {
        map.flyTo({ center: [5.4697, 51.4416], zoom: 18, duration: 0 });
      }
    });
    await page.waitForTimeout(4000);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '03-map-street-level-zoom18.png'),
      fullPage: false,
    });
  });

  test('4. Map — click a property marker and check panel', async ({ page }) => {
    await page.goto('/', { timeout: 60000, waitUntil: 'networkidle' });
    await waitForMapReady(page);

    // Zoom to Eindhoven to see individual markers
    await page.evaluate(() => {
      const mapEl = document.querySelector('.maplibregl-map');
      if (!mapEl) return;
      // @ts-ignore
      const map = mapEl.__maplibregl_map || (window as any).__map;
      if (map) {
        map.flyTo({ center: [5.4697, 51.4416], zoom: 17, duration: 0 });
      }
    });
    await page.waitForTimeout(5000);

    // Try clicking on center of map to hit a marker
    const viewport = page.viewportSize()!;
    await page.mouse.click(viewport.width / 2, viewport.height / 2);
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '04-map-marker-click.png'),
      fullPage: false,
    });
  });

  test('5. Search bar interaction', async ({ page }) => {
    await page.goto('/', { timeout: 60000, waitUntil: 'networkidle' });
    await waitForMapReady(page);

    // Look for search input
    const searchInput = page.locator(
      'input[placeholder*="Search"], input[placeholder*="search"], input[placeholder*="Zoek"], input[placeholder*="adres"]'
    );
    const searchVisible = (await searchInput.count()) > 0;

    if (searchVisible) {
      await searchInput.first().click();
      await searchInput.first().fill('Beeldbuisring');
      await page.waitForTimeout(2000);
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '05-search-bar.png'),
      fullPage: false,
    });
  });

  test('6. Property panel — WebPropertyPanel content', async ({ page }) => {
    // Navigate directly to a property if possible, or search for one
    await page.goto('/', { timeout: 60000, waitUntil: 'networkidle' });
    await waitForMapReady(page);

    // Search for our test fixture
    const searchInput = page.locator(
      'input[placeholder*="Search"], input[placeholder*="search"], input[placeholder*="Zoek"], input[placeholder*="adres"]'
    );

    if ((await searchInput.count()) > 0) {
      await searchInput.first().click();
      await searchInput.first().fill('Beeldbuisring 41');
      await page.waitForTimeout(2500);

      // Click first autocomplete result
      const suggestion = page.locator(
        '[class*="suggestion"], [class*="autocomplete"], [role="option"], [class*="result"]'
      );
      if ((await suggestion.count()) > 0) {
        await suggestion.first().click();
        await page.waitForTimeout(3000);
      }
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '06-property-panel.png'),
      fullPage: false,
    });
  });

  test('7. Feed tab', async ({ page }) => {
    await page.goto('/', { timeout: 60000, waitUntil: 'networkidle' });
    await waitForMapReady(page);

    // Click Feed tab
    const feedTab = page.locator('text=Feed');
    if ((await feedTab.count()) > 0) {
      await feedTab.first().click();
      await page.waitForTimeout(3000);
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '07-feed-tab.png'),
      fullPage: false,
    });
  });

  test('8. Saved tab', async ({ page }) => {
    await page.goto('/', { timeout: 60000, waitUntil: 'networkidle' });
    await waitForMapReady(page);

    // Click Saved tab
    const savedTab = page.locator('text=Saved');
    if ((await savedTab.count()) > 0) {
      await savedTab.first().click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '08-saved-tab.png'),
      fullPage: false,
    });
  });

  test('9. Profile tab', async ({ page }) => {
    await page.goto('/', { timeout: 60000, waitUntil: 'networkidle' });
    await waitForMapReady(page);

    // Click Profile tab
    const profileTab = page.locator('text=Profile');
    if ((await profileTab.count()) > 0) {
      await profileTab.first().click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '09-profile-tab.png'),
      fullPage: false,
    });
  });

  test('10. Cluster interaction', async ({ page }) => {
    await page.goto('/', { timeout: 60000, waitUntil: 'networkidle' });
    await waitForMapReady(page);

    // Zoom to a level where clusters appear
    await page.evaluate(() => {
      const mapEl = document.querySelector('.maplibregl-map');
      if (!mapEl) return;
      // @ts-ignore
      const map = mapEl.__maplibregl_map || (window as any).__map;
      if (map) {
        map.flyTo({ center: [5.4697, 51.4416], zoom: 15, duration: 0 });
      }
    });
    await page.waitForTimeout(4000);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '10-clusters-zoom15.png'),
      fullPage: false,
    });
  });

  test('11. Overall layout — full page with panel open', async ({ page }) => {
    await page.goto('/', { timeout: 60000, waitUntil: 'networkidle' });
    await waitForMapReady(page);

    // Search and open a property to get the full layout
    const searchInput = page.locator(
      'input[placeholder*="Search"], input[placeholder*="search"], input[placeholder*="Zoek"], input[placeholder*="adres"]'
    );
    if ((await searchInput.count()) > 0) {
      await searchInput.first().click();
      await searchInput.first().fill('Beeldbuisring 41');
      await page.waitForTimeout(2500);
      const suggestion = page.locator(
        '[class*="suggestion"], [class*="autocomplete"], [role="option"], [class*="result"]'
      );
      if ((await suggestion.count()) > 0) {
        await suggestion.first().click();
        await page.waitForTimeout(3000);
      }
    }

    // Take full-page screenshot
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '11-full-layout-with-panel.png'),
      fullPage: true,
    });
  });

  test('12. Console errors report', async ({ page }) => {
    const allErrors: string[] = [];

    await page.goto('/', { timeout: 60000, waitUntil: 'networkidle' });
    await waitForMapReady(page);

    // Navigate through tabs
    for (const tabName of ['Feed', 'Saved', 'Profile', 'Map']) {
      const tab = page.locator(`text=${tabName}`);
      if ((await tab.count()) > 0) {
        await tab.first().click();
        await page.waitForTimeout(2000);
      }
    }

    allErrors.push(...consoleErrors);

    // Write error report
    const report =
      allErrors.length === 0
        ? 'NO UNEXPECTED CONSOLE ERRORS FOUND'
        : `FOUND ${allErrors.length} CONSOLE ERRORS:\n${allErrors.join('\n')}`;

    console.log(report);

    // Fail if there are unexpected errors
    if (allErrors.length > 0) {
      console.warn('Console errors detected:', allErrors);
    }
  });
});
