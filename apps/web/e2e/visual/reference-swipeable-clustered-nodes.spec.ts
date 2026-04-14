import { test, expect, type Page } from '@playwright/test';
import { PROPERTY_MAP_LAYERS, PROPERTY_PREVIEW_MEMBER_LIMIT } from '@huishype/shared';
import {
  createVisualTestContext,
  type VisualTestContext,
  waitForMapStyleLoaded,
} from './helpers/visual-test-helpers';
import {
  dismissPreviewCard,
} from './helpers/screenshot-harness';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = 'test-results/reference-expectations/swipeable-clustered-nodes';
const PREVIEWABLE_CLUSTER_ZOOM = 13;
const PREVIEWABLE_CLUSTER_CENTER: [number, number] = [5.469710826873779, 51.441610133286275];

test.beforeAll(async () => {
  const baseDir = path.resolve(SCREENSHOT_DIR);
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
});

async function setMapZoom(page: Page, zoom: number): Promise<void> {
  const didSetZoom = await page.evaluate(({ targetZoom, center }) => {
    const map = (window as any).__mapInstance;
    if (!map) return false;
    map.jumpTo({
      center,
      zoom: targetZoom,
      pitch: 0,
      bearing: 0,
    });
    return true;
  }, { targetZoom: zoom, center: PREVIEWABLE_CLUSTER_CENTER });

  expect(didSetZoom).toBe(true);

  await page.waitForFunction(
    (targetZoom) => {
      const map = (window as any).__mapInstance;
      if (!map) {
        return false;
      }

      return Math.abs((map.getZoom?.() ?? 0) - targetZoom) <= 0.2;
    },
    zoom,
    { timeout: 15000 }
  );

  await page.waitForFunction(
    ({ clusterLayerId, previewLimit }) => {
      const map = (window as any).__mapInstance;
      if (!map || !map.isStyleLoaded?.()) {
        return false;
      }

      const canvas = map.getCanvas?.();
      if (!canvas || !map.getLayer?.(clusterLayerId)) {
        return false;
      }

      const features = map.queryRenderedFeatures(
        [[0, 0], [canvas.width, canvas.height]],
        { layers: [clusterLayerId] }
      ) || [];

      return features.some((feature: any) => {
        const pointCount = Number(feature.properties?.point_count || 0);
        const propertyIdCount = String(feature.properties?.property_ids || '')
          .split(',')
          .filter(Boolean)
          .length;

        return pointCount > 1 && pointCount <= previewLimit && propertyIdCount > 1;
      });
    },
    {
      clusterLayerId: PROPERTY_MAP_LAYERS.ACTIVE_CLUSTERS,
      previewLimit: PROPERTY_PREVIEW_MEMBER_LIMIT,
    },
    { timeout: 25000, polling: 500 }
  );
}

async function clearPreviewState(page: Page): Promise<void> {
  const dismissed = await dismissPreviewCard(page);
  if (dismissed) {
    await expect(page.locator('[data-testid="group-preview-card"]')).toBeHidden({ timeout: 5000 });
  }
}

async function openClusterPreview(page: Page): Promise<{ success: boolean; pointCount?: number }> {
  const candidates = await page.evaluate(
    ({ clusterLayerId, previewLimit }) => {
      const map = (window as any).__mapInstance;
      if (!map) {
        return [];
      }

      const canvas = map.getCanvas?.();
      if (!canvas || !map.getLayer?.(clusterLayerId)) {
        return [];
      }

      const features = map.queryRenderedFeatures(
        [[0, 0], [canvas.width, canvas.height]],
        { layers: [clusterLayerId] }
      ) || [];

      const rect = canvas.getBoundingClientRect();
      const edgeMargin = 40;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      return features
        .filter((feature: any) =>
          feature.geometry?.type === 'Point' &&
          Number(feature.properties?.point_count || 0) > 1 &&
          Number(feature.properties?.point_count || 0) <= previewLimit
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
            distanceToCenter: Math.hypot(point.x - centerX, point.y - centerY),
            inBounds:
              point.x >= edgeMargin &&
              point.x <= canvas.width - edgeMargin &&
              point.y >= edgeMargin &&
              point.y <= canvas.height - edgeMargin,
          };
        })
        .filter((candidate: any) => candidate.propertyIdCount > 1 && candidate.inBounds)
        .sort((a: any, b: any) => a.distanceToCenter - b.distanceToCenter);
    },
    {
      clusterLayerId: PROPERTY_MAP_LAYERS.ACTIVE_CLUSTERS,
      previewLimit: PROPERTY_PREVIEW_MEMBER_LIMIT,
    }
  );

  for (const candidate of candidates.slice(0, 10)) {
    await page.mouse.move(candidate.screenX, candidate.screenY);
    await page.mouse.click(candidate.screenX, candidate.screenY);
    const indicator = page.locator('[data-testid="group-preview-page-indicator"]');
    const indicatorVisible = await indicator
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    if (indicatorVisible) {
      return { success: true, pointCount: candidate.pointCount };
    }

    await clearPreviewState(page);
  }

  console.log('Cluster preview setup failed: no-multi-property-cluster-opened');
  return { success: false };
}

async function openPreviewableCluster(page: Page): Promise<{ success: boolean; pointCount?: number }> {
  await setMapZoom(page, PREVIEWABLE_CLUSTER_ZOOM);
  return openClusterPreview(page);
}

test.describe('Reference Expectation: Swipeable Clustered Nodes', () => {
  test.describe.configure({ mode: 'serial' });

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
    await setMapZoom(page, PREVIEWABLE_CLUSTER_ZOOM);

    const clickResult = await openPreviewableCluster(page);
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
    await setMapZoom(page, PREVIEWABLE_CLUSTER_ZOOM);

    const clickResult = await openPreviewableCluster(page);
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
    await setMapZoom(page, PREVIEWABLE_CLUSTER_ZOOM);

    const clickResult = await openPreviewableCluster(page);
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
