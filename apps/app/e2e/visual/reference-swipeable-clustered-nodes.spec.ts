import { test, expect, type Page } from '@playwright/test';
import {
  createVisualTestContext,
  type VisualTestContext,
  waitForMapStyleLoaded,
  waitForMapIdle,
} from './helpers/visual-test-helpers';
import {
  dismissPreviewCard,
} from './helpers/screenshot-harness';
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

async function clearPreviewState(page: Page): Promise<void> {
  const dismissed = await dismissPreviewCard(page);
  if (dismissed) {
    await expect(page.locator('[data-testid="group-preview-card"]')).toBeHidden({ timeout: 5000 });
  }
}

async function openClusterPreview(page: Page): Promise<{ success: boolean; pointCount?: number }> {
  const candidates = await page.evaluate(() => {
    const LARGE_CLUSTER_THRESHOLD = 30;
    const map = (window as any).__mapInstance;
    if (!map || !map.isStyleLoaded()) {
      return [];
    }

    const canvas = map.getCanvas();
    if (!canvas || !map.getLayer('property-clusters')) {
      return [];
    }

    const features = map.queryRenderedFeatures(
      [[0, 0], [canvas.width, canvas.height]],
      { layers: ['property-clusters'] }
    ) || [];

    const rect = canvas.getBoundingClientRect();
    const edgeMargin = 40;

    return features
      .filter((feature: any) =>
        feature.geometry?.type === 'Point' &&
        Number(feature.properties?.point_count || 0) > 1 &&
        Number(feature.properties?.point_count || 0) <= LARGE_CLUSTER_THRESHOLD
      )
      .map((feature: any) => {
        const propertyIds = String(feature.properties?.property_ids || '')
          .split(',')
          .filter(Boolean);
        const point = map.project(feature.geometry.coordinates);
        return {
          pointCount: Number(feature.properties?.point_count || 0),
          propertyIdCount: propertyIds.length,
          screenX: rect.left + point.x,
          screenY: rect.top + point.y,
          inBounds:
            point.x >= edgeMargin &&
            point.x <= canvas.width - edgeMargin &&
            point.y >= edgeMargin &&
            point.y <= canvas.height - edgeMargin,
        };
      })
      .filter((candidate: any) => candidate.propertyIdCount > 1 && candidate.inBounds)
      .sort((a: any, b: any) => {
        if (a.propertyIdCount !== b.propertyIdCount) {
          return b.propertyIdCount - a.propertyIdCount;
        }
        return b.pointCount - a.pointCount;
      });
  });

  if (candidates.length === 0) {
    console.log('Cluster preview setup failed: no-multi-property-cluster-opened');
    return { success: false };
  }

  for (const candidate of candidates.slice(0, 20)) {
    await page.mouse.move(candidate.screenX, candidate.screenY);
    await page.mouse.click(candidate.screenX, candidate.screenY);
    await page.waitForTimeout(350);

    if (await page.locator('[data-testid="group-preview-page-indicator"]').isVisible().catch(() => false)) {
      return { success: true, pointCount: candidate.pointCount };
    }

    await clearPreviewState(page);
  }

  console.log('Cluster preview setup failed: no-multi-property-cluster-opened');
  return { success: false };
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

    const clickResult = await openClusterPreview(page);
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

    const clickResult = await openClusterPreview(page);
    expect(clickResult.success, 'Expected to find a rendered cluster').toBe(true);

    const pageIndicator = page.locator('[data-testid="group-preview-page-indicator"]');
    const rightNav = page.locator('[data-testid="group-preview-nav-right"]');
    const leftNav = page.locator('[data-testid="group-preview-nav-left"]');

    await expect(pageIndicator).toBeVisible({ timeout: 10000 });
    const initialText = await pageIndicator.textContent();

    await rightNav.click({ force: true });
    await page.waitForTimeout(500);
    const afterRightText = await pageIndicator.textContent();

    await leftNav.click({ force: true });
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

    const clickResult = await openClusterPreview(page);
    expect(clickResult.success, 'Expected to find a rendered cluster').toBe(true);

    const clusterPreview = page.locator('[data-testid="group-preview-card"]');
    await expect(clusterPreview).toBeVisible({ timeout: 10000 });

    await page.locator('[data-testid="property-preview-card"]').click();
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
