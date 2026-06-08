/**
 * Reference Expectation E2E Test: property-bottom-sheet-details
 *
 * Verifies the actual web contract:
 * - Marker tap shows the geo-anchored preview card
 * - Preview card tap opens the property panel
 * - Expanded panel shows property details and quick actions
 */

import { test, expect, type Page, type Route } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { waitForMapStyleLoaded, waitForMapIdle } from './helpers/visual-test-helpers';
import { clickOnPropertyMarker } from './helpers/screenshot-harness';
import { NETWORK_ALLOWED_CONSOLE_PATTERNS, isAllowedConsoleMessage } from '../helpers/console';

test.use({ trace: 'off', video: 'off' });

const EXPECTATION_NAME = 'property-bottom-sheet-details';
const SCREENSHOT_DIR = `test-results/reference-expectations/${EXPECTATION_NAME}`;
const CENTER_COORDINATES: [number, number] = [5.4880, 51.4307];
const ZOOM_LEVEL = 17;
const WELCOME_MODAL_DISMISSED_KEY = 'huishype_welcome_modal_dismissed_v1';
const PREVIEWABLE_PROPERTY_LAYERS = ['active-nodes', 'property-clusters'] as const;
const PROPERTY_DETAIL_ROUTE =
  /\/properties\/(?!batch(?:$|[/?#])|nearby(?:$|[/?#])|resolve(?:$|[/?#]))[^/?#]+(?:\?.*)?$/;

const KNOWN_ACCEPTABLE_ERRORS = NETWORK_ALLOWED_CONSOLE_PATTERNS;

const MOCK_PROPERTY_DETAILS = {
  id: 'test-property-001',
  nationalId: '0772010000123456',
  countryCode: 'NL',
  address: 'Stratumseind 100',
  city: 'Eindhoven',
  postalCode: '5611 ET',
  geometry: {
    type: 'Point',
    coordinates: [5.4697, 51.4416],
  },
  yearBuilt: 1985,
  floorAreaM2: 120,
  status: 'active',
  officialValuation: 425000,
  askingPrice: 439000,
  fmv: {
    fmv: 431000,
    confidence: 'high',
    guessCount: 7,
    distribution: null,
    officialValuation: 425000,
    askingPrice: 439000,
    divergence: null,
  },
  activityLevel: 'hot',
  commentCount: 4,
  guessCount: 7,
  viewCount: 28,
  uniqueViewers: 22,
  likeCount: 9,
  isLiked: false,
  isSaved: false,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

async function setupPropertyMocking(page: Page): Promise<void> {
  await page.route(PROPERTY_DETAIL_ROUTE, async (route: Route) => {
    const propertyId = new URL(route.request().url()).pathname.split('/').pop();

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...MOCK_PROPERTY_DETAILS,
        id: propertyId,
      }),
    });
  });
}

async function waitForMapReady(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="map-view"]', { timeout: 30000 });
  await waitForMapStyleLoaded(page);
  await waitForMapIdle(page, 10000);
}

async function zoomMapTo(page: Page, center: [number, number], zoom: number): Promise<void> {
  await page.evaluate(
    ({ targetCenter, targetZoom }) => {
      const mapInstance = window.__mapInstance;
      if (!mapInstance) return;

      mapInstance.jumpTo({
        center: targetCenter,
        zoom: targetZoom,
        pitch: 0,
      });
    },
    { targetCenter: center, targetZoom: zoom }
  );

  await waitForMapIdle(page, 10000);
  await page.waitForFunction(
    () => {
      const mapInstance = window.__mapInstance;
      if (!mapInstance || !mapInstance.isStyleLoaded()) return false;

      const canvas = mapInstance.getCanvas();
      if (!canvas) return false;

      const layers = ['active-nodes', 'property-clusters']
        .filter((layer) => mapInstance.getLayer(layer));
      if (layers.length === 0) return false;

      try {
        const features = mapInstance.queryRenderedFeatures(
          [[0, 0], [canvas.width, canvas.height]],
          { layers }
        );
        return (features?.length || 0) > 0;
      } catch {
        return false;
      }
    },
    { timeout: 30000, polling: 500 }
  );
}

async function waitForPreviewCardVisible(page: Page, timeout = 2000): Promise<boolean> {
  const previewCard = page.locator('[data-testid="group-preview-card"]');
  const selectedMarker = page.locator('[data-testid="selected-marker"]');

  try {
    await expect(selectedMarker).toBeVisible({ timeout });
    await expect(previewCard).toBeVisible({ timeout });
    return true;
  } catch {
    return false;
  }
}

async function collectPreviewOpeningTargets(page: Page): Promise<Array<{
  screenX: number;
  screenY: number;
  propertyId?: string;
  pointCount: number;
  distanceToCenter: number;
}>> {
  return page.evaluate((layerNames) => {
    const PREVIEW_MEMBER_LIMIT = 30;

    const toNumber = (value: unknown): number | null => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }

      if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }

      return null;
    };

    const parsePropertyIds = (value: unknown): string[] => {
      if (Array.isArray(value)) {
        return value
          .map((entry) => (entry == null ? '' : String(entry).trim()))
          .filter(Boolean);
      }

      if (typeof value !== 'string') {
        return [];
      }

      const trimmed = value.trim();
      if (!trimmed) {
        return [];
      }

      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return parsed
              .map((entry) => (entry == null ? '' : String(entry).trim()))
              .filter(Boolean);
          }
        } catch {
          // Fall through to comma parsing below.
        }
      }

      return trimmed
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    };

    const mapInstance = window.__mapInstance;
    if (!mapInstance || !mapInstance.isStyleLoaded?.()) {
      return [];
    }

    const canvas = mapInstance.getCanvas();
    if (!canvas) {
      return [];
    }

    const rect = canvas.getBoundingClientRect();
    const canvasCenterX = canvas.width / 2;
    const canvasCenterY = canvas.height / 2;
    const edgeMargin = 40;
    const targets: Array<{
      screenX: number;
      screenY: number;
      propertyId?: string;
      pointCount: number;
      isSingle: boolean;
      distanceToCenter: number;
    }> = [];

    for (const layerName of layerNames) {
      try {
        if (!mapInstance.getLayer(layerName)) {
          continue;
        }

        const features = mapInstance.queryRenderedFeatures(
          [[0, 0], [canvas.width, canvas.height]],
          { layers: [layerName] }
        ) || [];

        for (const feature of features) {
          if (feature.geometry?.type !== 'Point') {
            continue;
          }

          const point = mapInstance.project(feature.geometry.coordinates);
          const pointCount = toNumber(feature.properties?.point_count) ?? 1;
          const previewPropertyIds = parsePropertyIds(feature.properties?.preview_property_ids);
          const propertyIds = parsePropertyIds(feature.properties?.property_ids);
          const isSingle = pointCount <= 1;
          const isPreviewableCluster =
            pointCount <= PREVIEW_MEMBER_LIMIT &&
            (previewPropertyIds.length > 0 || propertyIds.length > 0);
          const inBounds =
            point.x >= edgeMargin &&
            point.x <= canvas.width - edgeMargin &&
            point.y >= edgeMargin &&
            point.y <= canvas.height - edgeMargin;

          if (!inBounds || (!isSingle && !isPreviewableCluster)) {
            continue;
          }

          targets.push({
            screenX: rect.left + point.x,
            screenY: rect.top + point.y,
            propertyId:
              feature.properties?.id == null ? undefined : String(feature.properties.id),
            pointCount,
            isSingle,
            distanceToCenter: Math.hypot(point.x - canvasCenterX, point.y - canvasCenterY),
          });
        }
      } catch {
        // Keep scanning the remaining layers.
      }
    }

    return targets
      .sort((a, b) => {
        if (a.isSingle !== b.isSingle) {
          return a.isSingle ? -1 : 1;
        }

        if (a.pointCount !== b.pointCount) {
          return a.pointCount - b.pointCount;
        }

        return a.distanceToCenter - b.distanceToCenter;
      })
      .slice(0, 8)
      .map(({ isSingle: _isSingle, ...target }) => target);
  }, [...PREVIEWABLE_PROPERTY_LAYERS]);
}

async function openPreviewCard(page: Page): Promise<void> {
  if (await waitForPreviewCardVisible(page, 1500)) {
    return;
  }

  const initialClickResult = await clickOnPropertyMarker(page);
  expect(initialClickResult.success, 'Expected to find a property marker to click').toBe(true);

  if (await waitForPreviewCardVisible(page, 2500)) {
    return;
  }

  for (let round = 1; round <= 3; round += 1) {
    const targets = await collectPreviewOpeningTargets(page);
    console.log(
      `Preview-opening targets (round ${round}): ${JSON.stringify(
        targets.map((target) => ({
          x: Math.round(target.screenX),
          y: Math.round(target.screenY),
          propertyId: target.propertyId,
          pointCount: target.pointCount,
          distanceToCenter: Math.round(target.distanceToCenter),
        }))
      )}`
    );

    for (const [index, target] of targets.entries()) {
      await page.mouse.move(target.screenX, target.screenY);
      await page.mouse.click(target.screenX, target.screenY);
      console.log(
        `Preview click round=${round} target=${index + 1}/${targets.length} ` +
          `propertyId=${target.propertyId ?? 'unknown'} pointCount=${target.pointCount}`
      );

      if (await waitForPreviewCardVisible(page, 1800)) {
        return;
      }
    }

    const retryClickResult = await clickOnPropertyMarker(page);
    console.log(`Fallback marker click round=${round}: ${JSON.stringify(retryClickResult)}`);
    if (await waitForPreviewCardVisible(page, 2000)) {
      return;
    }
  }

  expect(await waitForPreviewCardVisible(page, 500), 'Preview card should appear after clicking a rendered property feature').toBe(true);
}

async function waitForPanelOpen(page: Page, timeout = 10000): Promise<boolean> {
  try {
    await page.waitForFunction(() => {
      const panelElement = document.querySelector('[data-testid="web-property-panel"]');
      const backdropElement = document.querySelector('[data-testid="web-panel-backdrop"]');
      if (!panelElement || !backdropElement) return false;

      const backdropStyle = window.getComputedStyle(backdropElement);
      return (
        (panelElement.className.includes('partial') ||
          panelElement.className.includes('full') ||
          panelElement.className.includes('open')) &&
        backdropElement.classList.contains('open') &&
        parseFloat(backdropStyle.opacity || '0') > 0.1
      );
    }, { timeout });
    return true;
  } catch {
    return false;
  }
}

async function openExpandedPanelFromPreview(page: Page): Promise<void> {
  const previewCard = page.locator('[data-testid="group-preview-card"]');
  const previewPressable = page.getByTestId('property-preview-card').first();
  const previewAddress = page.getByTestId('property-preview-address').first();

  await expect(previewCard).toBeVisible({ timeout: 10000 });
  await expect(previewPressable).toBeVisible({ timeout: 10000 });

  const clickStrategies: Array<() => Promise<void>> = [
    async () => {
      const box = await previewPressable.boundingBox();
      if (!box) {
        throw new Error('Preview pressable has no bounding box');
      }

      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
    },
    async () => {
      await previewPressable.click({ force: true });
    },
    async () => {
      await previewAddress.click({ force: true });
    },
    async () => {
      const box = await previewCard.boundingBox();
      if (!box) {
        throw new Error('Preview card has no bounding box');
      }

      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
    },
  ];

  for (let attempt = 0; attempt < clickStrategies.length; attempt += 1) {
    try {
      await clickStrategies[attempt]();
      console.log(`Preview-card tap attempt ${attempt + 1}`);
    } catch (error) {
      console.log(`Preview-card tap attempt ${attempt + 1} failed: ${String(error)}`);
      continue;
    }

    if (await waitForPanelOpen(page, 3500)) {
      return;
    }
  }

  expect(await waitForPanelOpen(page, 500), 'Property panel should open after tapping the preview card').toBe(true);
}

async function openExpandedPropertyPanel(page: Page): Promise<void> {
  await waitForMapReady(page);
  await zoomMapTo(page, CENTER_COORDINATES, ZOOM_LEVEL);
  await openPreviewCard(page);
  await page.waitForTimeout(800);
  await openExpandedPanelFromPreview(page);

  const panel = page.locator('[data-testid="web-property-panel"]');
  const backdrop = page.locator('[data-testid="web-panel-backdrop"]');

  expect(await waitForPanelOpen(page, 10000), 'Expected the property panel to be open').toBe(true);
  await expect(panel).toBeVisible({ timeout: 10000 });
  await expect(backdrop).toHaveClass(/open/, { timeout: 10000 });
  await expect(panel.getByText('Property Details').first()).toBeVisible({ timeout: 10000 });
  await expect(panel.getByText('Guess the Price').first()).toBeVisible({ timeout: 15000 });
}

test.describe(`Reference Expectation: ${EXPECTATION_NAME}`, () => {
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

    await page.addInitScript((storageKey) => {
      window.localStorage.setItem(storageKey, '1');
    }, WELCOME_MODAL_DISMISSED_KEY);

    await setupPropertyMocking(page);

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!isAllowedConsoleMessage(text, KNOWN_ACCEPTABLE_ERRORS)) {
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
      consoleWarnings.slice(0, 10).forEach((warning) => console.log(`  - ${warning}`));
      if (consoleWarnings.length > 10) {
        console.log(`  ... and ${consoleWarnings.length - 10} more`);
      }
    }

    if (consoleErrors.length > 0) {
      console.error(`Console errors detected (${consoleErrors.length}):`);
      consoleErrors.forEach((error) => console.error(`  - ${error}`));
    }

    expect(consoleErrors, `Expected zero console errors but found ${consoleErrors.length}`).toHaveLength(0);
  });

  test('capture bottom sheet for visual comparison', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await openExpandedPropertyPanel(page);

    const panel = page.locator('[data-testid="web-property-panel"]');
    const heroImage = page.getByTestId('property-header-image');
    const marker = page.getByTestId('property-header-marker');
    await expect(panel.getByText('Save').first()).toBeVisible();
    await expect(panel.getByText('Share').first()).toBeVisible();
    await expect(panel.getByText('Like').first()).toBeVisible();
    await expect(page.locator('[data-testid="web-panel-backdrop"]')).toHaveClass(/open/);
    await expect(heroImage).toBeVisible({ timeout: 10000 });
    await expect(marker).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(300);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-current.png`,
      fullPage: false,
    });

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-full-page.png`,
      fullPage: true,
    });
  });

  test('verify bottom sheet elements', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await openExpandedPropertyPanel(page);

    const panel = page.locator('[data-testid="web-property-panel"]');
    await expect(page.getByTestId('property-header-image')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('property-header-marker')).toBeVisible({ timeout: 10000 });
    await expect(panel.getByText('Property Details').first()).toBeVisible();
    await expect(panel.getByText('Guess the Price').first()).toBeVisible();
    await expect(panel.getByText('Save').first()).toBeVisible();
    await expect(panel.getByText('Share').first()).toBeVisible();
    await expect(panel.getByText('Like').first()).toBeVisible();
    await panel.getByText('Price Snapshot', { exact: true }).scrollIntoViewIfNeeded();
    await expect(panel.getByText('Crowd Estimate', { exact: true })).toBeVisible();
    await expect(panel.getByText('High confidence (7 guesses)', { exact: true })).toBeVisible();
    await expect(panel.getByText('WOZ Value', { exact: true })).toBeVisible();
    await expect(panel.getByText('Asking Price', { exact: true })).toBeVisible();
    await expect(panel.getByText('Crowd FMV', { exact: true })).toHaveCount(0);
    await panel.getByText('Year Built', { exact: true }).scrollIntoViewIfNeeded();
    await expect(panel.getByText('Year Built', { exact: true })).toBeVisible();
    await expect(panel.getByText('Floor Area', { exact: true })).toBeVisible();
  });

  test('verify map interaction', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await openExpandedPropertyPanel(page);

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${EXPECTATION_NAME}-map-only.png`,
      fullPage: false,
    });
  });
});
