import { test, expect, type Page, type Route } from '@playwright/test';
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
const MOCK_RESOLVE_ID = '11111111-1111-4111-8111-111111111111';
const MOCK_PROPERTY_DETAILS = {
  id: MOCK_RESOLVE_ID,
  nationalId: '0772010000123456',
  countryCode: 'NL',
  street: 'Tile Group Street',
  streetName: 'Tile Group Street',
  houseNumber: 2,
  houseNumberAddition: null,
  address: 'Tile Group Street 2, 5611 AA Eindhoven',
  city: 'Eindhoven',
  postalCode: '5611 AA',
  geometry: {
    type: 'Point' as const,
    coordinates: PREVIEWABLE_CLUSTER_CENTER,
  },
  yearBuilt: 1985,
  floorAreaM2: 120,
  status: 'active' as const,
  officialValuation: 425000,
  hasListing: false,
  askingPrice: null,
  thumbnailUrl: null,
  likeCount: 4,
  commentCount: 3,
  guessCount: 2,
  activityScore: 5,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

function buildMockBatchProperty(propertyId: string, index: number) {
  return {
    id: propertyId,
    nationalId: `07720100001234${String(index).padStart(2, '0')}`,
    countryCode: 'NL',
    street: 'Tile Group Street',
    streetName: 'Tile Group Street',
    houseNumber: 2 + index,
    houseNumberAddition: null,
    address: `Tile Group Street ${2 + index}, 5611 AA Eindhoven`,
    city: 'Eindhoven',
    postalCode: '5611 AA',
    geometry: {
      type: 'Point' as const,
      coordinates: [
        PREVIEWABLE_CLUSTER_CENTER[0] + index * 0.00015,
        PREVIEWABLE_CLUSTER_CENTER[1] + index * 0.00015,
      ] as [number, number],
    },
    imageryGeometry: null,
    yearBuilt: 1985,
    floorAreaM2: 120,
    status: 'active' as const,
    officialValuation: 425000,
    hasListing: false,
    askingPrice: null,
    likeCount: 4,
    commentCount: 3,
    guessCount: 2,
    activityScore: 5,
    aerialImageUrl: null,
    thumbnailUrl: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

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

async function setupPropertyMocking(page: Page): Promise<void> {
  const handlePropertyRoute = async (route: Route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const method = route.request().method();

    if (pathname === '/api/properties/resolve' && method === 'GET') {
      const street = url.searchParams.get('street') ?? MOCK_PROPERTY_DETAILS.street;
      const houseNumber = url.searchParams.get('houseNumber') ?? '1';
      const houseNumberAddition = url.searchParams.get('houseNumberAddition');
      const postalCode = url.searchParams.get('postalCode') ?? '5611 AA';
      const city = url.searchParams.get('city') ?? 'Eindhoven';
      const countryCode = url.searchParams.get('countryCode') ?? MOCK_PROPERTY_DETAILS.countryCode;
      const address = `${street} ${houseNumber}${houseNumberAddition ? ` ${houseNumberAddition}` : ''}, ${postalCode} ${city}`;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: MOCK_RESOLVE_ID,
          countryCode,
          address,
          postalCode,
          city,
          coordinates: {
            lon: PREVIEWABLE_CLUSTER_CENTER[0],
            lat: PREVIEWABLE_CLUSTER_CENTER[1],
          },
          hasListing: false,
          officialValuation: null,
        }),
      });
      return;
    }

    if (method === 'GET' && /^\/api\/properties\/batch$/i.test(pathname)) {
      const ids = url.searchParams
        .get('ids')
        ?.split(',')
        .map((id) => id.trim())
        .filter(Boolean) ?? [];

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ids.map((propertyId, index) => buildMockBatchProperty(propertyId, index))),
      });
      return;
    }

    if (method === 'GET' && /^\/api\/properties\/[0-9a-f-]{36}$/i.test(pathname)) {
      const propertyId = pathname.split('/').pop() ?? MOCK_RESOLVE_ID;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...MOCK_PROPERTY_DETAILS,
          id: propertyId,
          address: MOCK_PROPERTY_DETAILS.address,
        }),
      });
      return;
    }

    if (method === 'GET' && /^\/api\/properties\/[0-9a-f-]{36}\/listings$/i.test(pathname)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
      return;
    }

    if (method === 'GET' && /^\/api\/properties\/[0-9a-f-]{36}\/comments$/i.test(pathname)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [],
          meta: {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 1,
          },
        }),
      });
      return;
    }

    if (method === 'GET' && /^\/api\/properties\/[0-9a-f-]{36}\/guesses$/i.test(pathname)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [],
          meta: {
            page: 1,
            limit: 100,
            total: 0,
            totalPages: 1,
          },
          fmv: {
            fmv: null,
            confidence: 'none',
            guessCount: 0,
            distribution: null,
            officialValuation: MOCK_PROPERTY_DETAILS.officialValuation,
            askingPrice: null,
            divergence: null,
          },
        }),
      });
      return;
    }

    if (method === 'POST' && /^\/api\/properties\/[0-9a-f-]{36}\/view$/i.test(pathname)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          viewCount: 1,
          uniqueViewers: 1,
        }),
      });
      return;
    }

    await route.continue();
  };

  await page.route('**/api/properties/**', handlePropertyRoute);
  await page.route('**/properties/**', handlePropertyRoute);
}

async function openClusterPreview(page: Page): Promise<{ success: boolean; pointCount?: number }> {
  const clusterPreviewCard = page.locator('[data-testid="group-preview-card"]');
  const indicator = page.locator('[data-testid="group-preview-page-indicator"]');
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
            feature,
            pointCount: Number(feature.properties?.point_count || 0),
            propertyIdCount: propertyIds.length,
            distanceToCenter: Math.hypot(point.x - centerX, point.y - centerY),
          };
        })
        .filter((candidate: any) => candidate.propertyIdCount > 1)
        .sort((a: any, b: any) => a.distanceToCenter - b.distanceToCenter);
    },
    {
      clusterLayerId: PROPERTY_MAP_LAYERS.ACTIVE_CLUSTERS,
      previewLimit: PROPERTY_PREVIEW_MEMBER_LIMIT,
    }
  );

  for (const candidate of candidates.slice(0, 3)) {
    const clicked = await page.evaluate((rawFeature) => {
      const map = (window as any).__mapInstance;
      if (!map || !rawFeature?.geometry?.coordinates) {
        return false;
      }

      const coordinates = rawFeature.geometry.coordinates as [number, number];
      const point = map.project(coordinates);
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
        view: window,
      });

      map.fire('click', {
        point: { x: point.x, y: point.y },
        lngLat: { lng: coordinates[0], lat: coordinates[1] },
        features: [rawFeature],
        originalEvent: clickEvent,
      });

      return true;
    }, candidate.feature);

    if (!clicked) {
      continue;
    }

    const previewVisible = await clusterPreviewCard
      .waitFor({ state: 'visible', timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (!previewVisible) {
      await clearPreviewState(page);
      continue;
    }

    const indicatorVisible = await indicator
      .waitFor({ state: 'visible', timeout: 6000 })
      .then(() => true)
      .catch(() => false);
    if (indicatorVisible) {
      return { success: true, pointCount: candidate.pointCount };
    }

    await clearPreviewState(page);
  }

  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) {
    console.log('Cluster preview setup failed: no-multi-property-cluster-opened');
    return { success: false };
  }

  const centerPositions = [
    { x: 0.5, y: 0.5 },
    { x: 0.45, y: 0.45 },
    { x: 0.55, y: 0.55 },
    { x: 0.4, y: 0.5 },
    { x: 0.6, y: 0.5 },
  ];

  for (const pos of centerPositions) {
    const screenX = box.x + box.width * pos.x;
    const screenY = box.y + box.height * pos.y;
    const clickResult = await page.evaluate(
      ({ screenX: x, screenY: y, clusterLayerId }) => {
      const map = (window as any).__mapInstance;
      if (!map) {
        return { clicked: false, pointCount: 0 };
      }

      const canvas = map.getCanvas?.();
      if (!canvas || !map?.getLayer?.(clusterLayerId)) {
        return { clicked: false, pointCount: 0 };
      }

        const point = { x, y };
        const features = map.queryRenderedFeatures([x, y], { layers: [clusterLayerId] }) || [];
        const clusterFeature = features
          .filter((feature: any) =>
            feature.geometry?.type === 'Point' &&
            Number(feature.properties?.point_count || 0) > 1
          )
          .sort((a: any, b: any) =>
            Number(b.properties?.point_count || 0) - Number(a.properties?.point_count || 0)
          )[0];

        if (!clusterFeature?.geometry?.coordinates) {
          return { clicked: false, pointCount: 0 };
        }

        const coordinates = clusterFeature.geometry.coordinates as [number, number];
        const projected = map.project(coordinates);
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: projected.x,
          clientY: projected.y,
          view: window,
        });

        map.fire('click', {
          point,
          lngLat: { lng: coordinates[0], lat: coordinates[1] },
          features: [clusterFeature],
          originalEvent: clickEvent,
        });

        return {
          clicked: true,
          pointCount: Number(clusterFeature.properties?.point_count || 0),
        };
      },
      {
        screenX,
        screenY,
        clusterLayerId: PROPERTY_MAP_LAYERS.ACTIVE_CLUSTERS,
      },
    ).catch(() => ({ clicked: false, pointCount: 0 }));

    if (!clickResult.clicked) {
      continue;
    }

    const previewVisible = await clusterPreviewCard
      .waitFor({ state: 'visible', timeout: 1200 })
      .then(() => true)
      .catch(() => false);
    if (!previewVisible) {
      continue;
    }

    const indicatorVisible = await indicator
      .waitFor({ state: 'visible', timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    if (indicatorVisible) {
      return { success: true, pointCount: clickResult.pointCount };
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
    await setupPropertyMocking(page);

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
