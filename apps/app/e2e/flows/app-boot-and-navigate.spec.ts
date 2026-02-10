/**
 * Flow E2E Test: App Boot & Navigation
 *
 * Tests the basic app boot sequence and tab navigation:
 * - App loads with map canvas visible
 * - Navigation between Map and Feed tabs works
 * - API health check passes
 * - No critical console errors during boot
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { waitForMapStyleLoaded } from '../visual/helpers/visual-test-helpers';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3100';

// Screenshot output directory
const SCREENSHOT_DIR = 'test-results/flows';

// Known acceptable console errors (same pattern as existing tests)
const KNOWN_ACCEPTABLE_ERRORS: RegExp[] = [
  /ResizeObserver loop/,
  /sourceMappingURL/,
  /Failed to parse source map/,
  /Fast Refresh/,
  /\[HMR\]/,
  /WebSocket connection/,
  /net::ERR_ABORTED/,
  /net::ERR_NAME_NOT_RESOLVED/,
  /AJAXError/,
  /\.pbf/,
  /tiles\.openfreemap\.org/,
  /pointerEvents is deprecated/,
  /GL Driver Message/,
  /Expected value to be of type/,
  /Failed to load resource.*\/sprites\//,
];

// Disable tracing to avoid artifact issues
test.use({ trace: 'off' });

test.describe('App Boot & Navigation', () => {
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
        if (!KNOWN_ACCEPTABLE_ERRORS.some((p) => p.test(text))) {
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
      consoleWarnings.slice(0, 10).forEach((w) => console.log(`  - ${w}`));
    }

    if (consoleErrors.length > 0) {
      console.error(`Console errors detected (${consoleErrors.length}):`);
      consoleErrors.forEach((e) => console.error(`  - ${e}`));
    }
    expect(
      consoleErrors,
      `Expected zero console errors but found ${consoleErrors.length}`
    ).toHaveLength(0);
  });

  test('app loads with map canvas visible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Map container should be visible
    const mapView = page.locator('[data-testid="map-view"]');
    await expect(mapView.first()).toBeVisible({ timeout: 30000 });

    // Canvas should render (MapLibre GL)
    const canvas = page.locator('canvas');
    await expect(canvas.first()).toBeVisible({ timeout: 15000 });

    // Canvas should have reasonable dimensions
    const canvasBox = await canvas.first().boundingBox();
    expect(canvasBox).not.toBeNull();
    if (canvasBox) {
      expect(canvasBox.width).toBeGreaterThan(100);
      expect(canvasBox.height).toBeGreaterThan(100);
    }

    // Wait for map style to load (polls until isStyleLoaded returns true)
    await waitForMapStyleLoaded(page);

    // Verify map instance exists and is functional
    const mapState = await page.evaluate(() => {
      const map = (window as any).__mapInstance;
      if (!map) return null;
      return {
        zoom: map.getZoom?.() ?? 0,
        hasCanvas: !!map.getCanvas?.(),
        layerCount: map.getStyle?.()?.layers?.length ?? 0,
      };
    });
    expect(mapState).not.toBeNull();
    expect(mapState!.hasCanvas).toBe(true);
    expect(mapState!.layerCount).toBeGreaterThan(0);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/app-boot-map.png` });
  });

  test('navigate between Map and Feed tabs', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for initial map render
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });

    // Find and click Feed tab - Expo Router renders tabs with title text
    // Tab layout uses title: 'Feed' so look for that text in tab bar
    const feedTab = page.getByRole('tab', { name: /feed/i }).or(
      page.locator('a[href*="feed"]')
    ).or(
      page.locator('[role="tablist"] >> text=Feed')
    );

    const feedTabVisible = await feedTab.first().isVisible({ timeout: 10000 }).catch(() => false);
    expect(feedTabVisible, 'Feed tab should be visible').toBe(true);

    await feedTab.first().click();

    // Should navigate to feed - wait for either URL change or feed content
    await Promise.race([
      page.waitForURL('**/feed**', { timeout: 15000 }).catch(() => null),
      page.waitForSelector('[data-testid="feed-screen"]', { timeout: 15000 }).catch(() => null),
      page.waitForSelector('[data-testid="feed-loading"]', { timeout: 15000 }).catch(() => null),
      page.waitForSelector('[data-testid="feed-empty"]', { timeout: 15000 }).catch(() => null),
    ]);

    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/app-feed-tab.png` });

    // Verify we are on the feed page - check for feed-specific content
    const feedScreen = page.locator('[data-testid="feed-screen"]');
    const feedLoading = page.locator('[data-testid="feed-loading"]');
    const feedEmpty = page.locator('[data-testid="feed-empty"]');
    const feedError = page.locator('[data-testid="feed-error"]');
    const filterChip = page.locator('[data-testid="filter-chip-trending"]');

    const onFeedPage = await Promise.race([
      feedScreen.isVisible().catch(() => false),
      feedLoading.isVisible().catch(() => false),
      feedEmpty.isVisible().catch(() => false),
      feedError.isVisible().catch(() => false),
      filterChip.isVisible().catch(() => false),
    ]);
    expect(onFeedPage, 'Should show feed content after clicking Feed tab').toBe(true);

    // Navigate back to Map tab
    const mapTab = page.getByRole('tab', { name: /map/i }).or(
      page.locator('a[href="/"]')
    ).or(
      page.locator('[role="tablist"] >> text=Map')
    );

    await mapTab.first().click();
    await page.waitForTimeout(2000);

    // Map should be visible again
    const mapView = page.locator('[data-testid="map-view"]');
    await expect(mapView.first()).toBeVisible({ timeout: 15000 });

    await page.screenshot({ path: `${SCREENSHOT_DIR}/app-map-tab.png` });
  });

  test('API health check returns valid response', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/health`);
    expect(response.ok()).toBe(true);

    const body = await response.json();
    expect(body).toHaveProperty('status');
    expect(body.status).toBe('ok');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('uptime');
  });

  test('zoom level indicator is visible on map', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for map to load
    await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
    await waitForMapStyleLoaded(page);

    // The zoom indicator shows "Zoom: X.X" text
    const zoomIndicator = page.getByText(/Zoom:\s*\d/);
    await expect(zoomIndicator).toBeVisible({ timeout: 10000 });

    // Verify the zoom text shows a reasonable value
    const zoomText = await zoomIndicator.textContent();
    expect(zoomText).toMatch(/Zoom:\s*\d+\.\d/);
  });
});
