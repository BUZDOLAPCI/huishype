import { test, expect, type Page } from '@playwright/test';
import { PROPERTY_MAP_LAYERS, PROPERTY_PREVIEW_MEMBER_LIMIT } from '@huishype/shared';
import {
  createVisualTestContext,
  type VisualTestContext,
  waitForMapStyleLoaded,
} from './helpers/visual-test-helpers';
import { dismissPreviewCard } from './helpers/screenshot-harness';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = 'test-results/reference-expectations/swipeable-clustered-nodes';
const PREVIEWABLE_CLUSTER_ZOOM = 13;
const PREVIEWABLE_CLUSTER_CENTER: [number, number] = [5.469710826873779, 51.441610133286275];
const WELCOME_MODAL_DISMISSED_KEY = 'huishype_welcome_modal_dismissed_v1';

test.beforeAll(async () => {
  const baseDir = path.resolve(SCREENSHOT_DIR);
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
});

async function setMapZoom(page: Page, zoom: number): Promise<void> {
  const didSetZoom = await page.evaluate(
    ({ targetZoom, center }) => {
      const map = window.__mapInstance;
      if (!map) return false;
      map.jumpTo({
        center,
        zoom: targetZoom,
        pitch: 0,
        bearing: 0,
      });
      return true;
    },
    { targetZoom: zoom, center: PREVIEWABLE_CLUSTER_CENTER }
  );

  expect(didSetZoom).toBe(true);

  await page.waitForFunction(
    (targetZoom) => {
      const map = window.__mapInstance;
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
      const map = window.__mapInstance;
      if (!map || !map.isStyleLoaded?.()) {
        return false;
      }

      const canvas = map.getCanvas?.();
      if (!canvas || !map.getLayer?.(clusterLayerId)) {
        return false;
      }

      const parseIds = (value: unknown): string[] => {
        if (typeof value === 'string') {
          return value.split(',').filter(Boolean);
        }
        if (Array.isArray(value)) {
          return value.filter(
            (item): item is string => typeof item === 'string' && item.length > 0
          );
        }
        return [];
      };
      const parseOptionalBoolean = (value: unknown): boolean | null => {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
          if (value.toLowerCase() === 'true') return true;
          if (value.toLowerCase() === 'false') return false;
        }
        if (typeof value === 'number') {
          if (value === 1) return true;
          if (value === 0) return false;
        }
        return null;
      };

      const features =
        map.queryRenderedFeatures(
          [
            [0, 0],
            [canvas.width, canvas.height],
          ],
          { layers: [clusterLayerId] }
        ) || [];

      return features.some((feature) => {
        const pointCount = Number(feature.properties?.point_count || 0);
        const propertyIds = parseIds(feature.properties?.property_ids);
        const previewPropertyIds = parseIds(feature.properties?.preview_property_ids);
        const membershipComplete = parseOptionalBoolean(feature.properties?.membership_complete);
        const readStateCoverage =
          typeof feature.properties?.read_state_coverage === 'string'
            ? feature.properties.read_state_coverage
            : null;
        const fallbackPropertyIds =
          membershipComplete !== false && readStateCoverage !== 'partial' ? propertyIds : [];
        const previewMembershipIds =
          previewPropertyIds.length > 0 ? previewPropertyIds : fallbackPropertyIds;

        return pointCount > 1 && pointCount <= previewLimit && previewMembershipIds.length > 1;
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
      const map = window.__mapInstance;
      if (!map) {
        return [];
      }

      const canvas = map.getCanvas?.();
      if (!canvas || !map.getLayer?.(clusterLayerId)) {
        return [];
      }

      const features =
        map.queryRenderedFeatures(
          [
            [0, 0],
            [canvas.width, canvas.height],
          ],
          { layers: [clusterLayerId] }
        ) || [];

      const rect = canvas.getBoundingClientRect();
      const edgeMargin = 40;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      const parseIds = (value: unknown): string[] => {
        if (typeof value === 'string') {
          return value.split(',').filter(Boolean);
        }
        if (Array.isArray(value)) {
          return value.filter(
            (item): item is string => typeof item === 'string' && item.length > 0
          );
        }
        return [];
      };
      const parseOptionalBoolean = (value: unknown): boolean | null => {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
          if (value.toLowerCase() === 'true') return true;
          if (value.toLowerCase() === 'false') return false;
        }
        if (typeof value === 'number') {
          if (value === 1) return true;
          if (value === 0) return false;
        }
        return null;
      };

      return features
        .filter(
          (feature) =>
            feature.geometry?.type === 'Point' &&
            Number(feature.properties?.point_count || 0) > 1 &&
            Number(feature.properties?.point_count || 0) <= previewLimit
        )
        .map((feature) => {
          const propertyIds = parseIds(feature.properties?.property_ids);
          const previewPropertyIds = parseIds(feature.properties?.preview_property_ids);
          const membershipComplete = parseOptionalBoolean(feature.properties?.membership_complete);
          const readStateCoverage =
            typeof feature.properties?.read_state_coverage === 'string'
              ? feature.properties.read_state_coverage
              : null;
          const fallbackPropertyIds =
            membershipComplete !== false && readStateCoverage !== 'partial' ? propertyIds : [];
          const previewMembershipIds =
            previewPropertyIds.length > 0 ? previewPropertyIds : fallbackPropertyIds;
          const point = map.project(feature.geometry.coordinates);
          return {
            pointCount: Number(feature.properties?.point_count || 0),
            previewMembershipIdCount: previewMembershipIds.length,
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
        .filter((candidate) => candidate.previewMembershipIdCount > 1 && candidate.inBounds)
        .sort((a, b) => a.distanceToCenter - b.distanceToCenter);
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

async function openPreviewableCluster(
  page: Page
): Promise<{ success: boolean; pointCount?: number }> {
  await setMapZoom(page, PREVIEWABLE_CLUSTER_ZOOM);
  return openClusterPreview(page);
}

test.describe('Reference Expectation: Swipeable Clustered Nodes', () => {
  test.describe.configure({ mode: 'serial' });

  let ctx: VisualTestContext;

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((storageKey) => {
      window.localStorage.setItem(storageKey, '1');
    }, WELCOME_MODAL_DISMISSED_KEY);
  });

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

  test('should navigate between properties using a horizontal swipe', async ({ page }) => {
    ctx = createVisualTestContext(page, 'cluster-swipe-navigation');
    ctx.start();

    await page.goto('/');
    await ctx.validator.waitForReady();
    await waitForMapStyleLoaded(page);
    await setMapZoom(page, PREVIEWABLE_CLUSTER_ZOOM);

    const clickResult = await openPreviewableCluster(page);
    expect(clickResult.success, 'Expected to find a rendered cluster').toBe(true);

    const pageIndicator = page.locator('[data-testid="group-preview-page-indicator"]');
    const swipeSurface = page.locator('[data-testid="group-preview-swipe-surface"]');
    const activeCard = page.locator('[data-testid="group-preview-active-card"]');

    await expect(pageIndicator).toBeVisible({ timeout: 10000 });
    await expect(swipeSurface).toBeVisible();
    await expect(activeCard).toBeVisible();

    const initialText = await pageIndicator.textContent();
    expect(initialText).toMatch(/1 of \d+/);

    const activeCardBox = await activeCard.boundingBox();
    expect(activeCardBox).not.toBeNull();
    if (!activeCardBox) {
      return;
    }

    const startX = activeCardBox.x + activeCardBox.width * 0.76;
    const endX = activeCardBox.x + activeCardBox.width * 0.22;
    const y = activeCardBox.y + activeCardBox.height * 0.5;

    await page.evaluate(
      ({ startX: x1, endX: x2, y: touchY }) => {
        const target = document.querySelector('[data-testid="group-preview-swipe-surface"]');
        if (!target) {
          return false;
        }

        const dispatchTouch = (type: string, x: number) => {
          const touch = {
            identifier: 1,
            target,
            clientX: x,
            clientY: touchY,
            pageX: x,
            pageY: touchY,
            screenX: x,
            screenY: touchY,
          };
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, {
            touches: { value: type === 'touchend' ? [] : [touch] },
            targetTouches: { value: type === 'touchend' ? [] : [touch] },
            changedTouches: { value: [touch] },
          });
          target.dispatchEvent(event);
        };

        dispatchTouch('touchstart', x1);

        for (let step = 1; step <= 8; step += 1) {
          const x = x1 + ((x2 - x1) * step) / 8;
          dispatchTouch('touchmove', x);
        }

        dispatchTouch('touchend', x2);

        return true;
      },
      { startX, endX, y }
    );

    await expect(pageIndicator).not.toHaveText(initialText ?? '', { timeout: 3000 });
    await expect(pageIndicator).toHaveText(/2 of \d+/, { timeout: 3000 });

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'cluster-swipe-navigation-current.png'),
      fullPage: true,
    });

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

    await page
      .locator('[data-testid="group-preview-active-card"] [data-testid="property-preview-card"]')
      .click();
    await page.waitForTimeout(1000);

    const panel = page.locator('[data-testid="web-property-panel"]').first();
    await expect(panel).toBeVisible({ timeout: 10000 });
    await expect(panel.getByText('Property Details').first()).toBeVisible();

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '06-after-property-tap.png'),
      fullPage: true,
    });

    ctx.assertNoCriticalErrors();
  });
});
