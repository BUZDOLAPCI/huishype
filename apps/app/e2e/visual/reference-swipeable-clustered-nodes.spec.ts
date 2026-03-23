import { test, expect, type Page } from '@playwright/test';
import {
  createVisualTestContext,
  type VisualTestContext,
  waitForMapStyleLoaded,
  waitForMapIdle,
} from './helpers/visual-test-helpers';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = 'test-results/reference-expectations/swipeable-clustered-nodes';

test.beforeAll(async () => {
  const baseDir = path.resolve(SCREENSHOT_DIR);
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
});

async function setMapZoom(page: Page, zoom: number): Promise<void> {
  await page.evaluate((targetZoom) => {
    const map = (window as any).__mapInstance;
    if (!map) return;
    map.setPitch(0);
    map.setZoom(targetZoom);
  }, zoom);
  await waitForMapIdle(page, 10000);
  await page.waitForTimeout(800);
}

async function clickOnCluster(page: Page): Promise<{ success: boolean; pointCount?: number }> {
  const result = await page.evaluate(() => {
    const map = (window as any).__mapInstance;
    if (!map || !map.isStyleLoaded()) {
      return { success: false, reason: 'map-not-ready' };
    }

    const canvas = map.getCanvas();
    if (!canvas || !map.getLayer('property-clusters')) {
      return { success: false, reason: 'cluster-layer-missing' };
    }

    const features = map.queryRenderedFeatures(
      [[0, 0], [canvas.width, canvas.height]],
      { layers: ['property-clusters'] }
    ) || [];

    const cluster = features.find((feature: any) =>
      feature.geometry?.type === 'Point' &&
      Number(feature.properties?.point_count || 0) > 1
    );

    if (!cluster) {
      return { success: false, reason: 'no-cluster-found' };
    }

    const coordinates = cluster.geometry.coordinates;
    const point = map.project(coordinates);
    const rect = canvas.getBoundingClientRect();
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + point.x,
      clientY: rect.top + point.y,
      view: window,
    });

    map.fire('click', {
      point: { x: point.x, y: point.y },
      lngLat: { lng: coordinates[0], lat: coordinates[1] },
      originalEvent: clickEvent,
      features: [cluster],
    });

    return {
      success: true,
      pointCount: Number(cluster.properties?.point_count || 0),
      screenX: point.x,
      screenY: point.y,
    };
  });

  if (!result.success) {
    console.log(`Cluster click setup failed: ${result.reason}`);
    return { success: false };
  }

  await page.waitForTimeout(1000);
  return { success: true, pointCount: result.pointCount };
}

test.describe('Reference Expectation: Swipeable Clustered Nodes', () => {
  let ctx: VisualTestContext;

  test.afterEach(async () => {
    if (ctx) {
      ctx.stop();
      console.log(ctx.generateReport());
    }
  });

  test('should show paginated cluster preview when clicking a cluster', async ({ page }) => {
    ctx = createVisualTestContext(page, 'swipeable-clustered-nodes');
    ctx.start();

    await page.goto('/');
    await ctx.validator.waitForReady();
    await waitForMapStyleLoaded(page);
    await setMapZoom(page, 11);

    const clickResult = await clickOnCluster(page);
    expect(clickResult.success, 'Expected to find a rendered cluster').toBe(true);

    const clusterPreview = page.locator('[data-testid="group-preview-card"]');
    await expect(clusterPreview).toBeVisible({ timeout: 10000 });

    const pageIndicator = page.locator('[data-testid="group-preview-page-indicator"]');
    const leftNav = page.locator('[data-testid="group-preview-nav-left"]');
    const rightNav = page.locator('[data-testid="group-preview-nav-right"]');
    const closeButton = page.locator('[data-testid="group-preview-close-button"]');

    await expect(pageIndicator).toBeVisible();
    await expect(leftNav).toBeVisible();
    await expect(rightNav).toBeVisible();
    await expect(closeButton).toBeVisible();

    const pageText = await pageIndicator.textContent();
    expect(pageText).toMatch(/\d+ of \d+/);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'swipeable-clustered-nodes-current.png'),
      fullPage: true,
    });

    ctx.assertNoCriticalErrors();
  });

  test('should navigate between properties using arrows', async ({ page }) => {
    ctx = createVisualTestContext(page, 'cluster-navigation');
    ctx.start();

    await page.goto('/');
    await ctx.validator.waitForReady();
    await waitForMapStyleLoaded(page);
    await setMapZoom(page, 11);

    const clickResult = await clickOnCluster(page);
    expect(clickResult.success, 'Expected to find a rendered cluster').toBe(true);

    const pageIndicator = page.locator('[data-testid="group-preview-page-indicator"]');
    const rightNav = page.locator('[data-testid="group-preview-nav-right"]');
    const leftNav = page.locator('[data-testid="group-preview-nav-left"]');

    await expect(pageIndicator).toBeVisible({ timeout: 10000 });
    const initialText = await pageIndicator.textContent();

    await rightNav.click();
    await page.waitForTimeout(500);
    const afterRightText = await pageIndicator.textContent();

    await leftNav.click();
    await page.waitForTimeout(500);
    const afterLeftText = await pageIndicator.textContent();

    expect(afterRightText).not.toBe(initialText);
    expect(afterLeftText).toBe(initialText);

    ctx.assertNoCriticalErrors();
  });

  test('should open property details when clicking on property card', async ({ page }) => {
    ctx = createVisualTestContext(page, 'cluster-property-tap');
    ctx.start();

    await page.goto('/');
    await ctx.validator.waitForReady();
    await waitForMapStyleLoaded(page);
    await setMapZoom(page, 11);

    const clickResult = await clickOnCluster(page);
    expect(clickResult.success, 'Expected to find a rendered cluster').toBe(true);

    const clusterPreview = page.locator('[data-testid="group-preview-card"]');
    await expect(clusterPreview).toBeVisible({ timeout: 10000 });

    await page.locator('[data-testid="group-preview-touch-overlay"]').click();
    await page.waitForTimeout(1000);

    const panel = page.locator('[data-testid="web-property-panel"]');
    await expect(panel).toBeVisible({ timeout: 10000 });
    await expect(panel.getByText('Property Details').first()).toBeVisible();

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '06-after-property-tap.png'),
      fullPage: true,
    });

    ctx.assertNoCriticalErrors();
  });
});
